# mojify local agent notes

## Build / reload

No build step — `extension/{content.js, popup.js, background.js}` are loaded
raw by `extension/manifest.json`. After any edit (bump `version` patch in the
same edit), reload with `pwsh tools/reload-extension.ps1` — it opens
`extension/reload.html`, which messages bg to blank its tab + call
`chrome.runtime.reload()`, so manifest bumps are picked up too. Extensions
Reloader (`start msedge http://reload.extensions`) is JS-only and never
re-reads the manifest; the manual button on `edge://extensions` is fallback.

## Messenger double-insert gotcha

When an emote is clicked in the popup on `messenger.com` / `facebook.com`,
the flow is:

1. `popup.js` injects `insertEmoteFromBase64` into the page via
   `chrome.scripting.executeScript`.
2. That function dispatches `dragenter` / `dragover` / `drop` with the file
   → composer attaches the image (file #1).
3. `withOptionalNameResult` then calls `insertNameText`, which types
   `:name:` into the contenteditable via `execCommand('insertText')`.
4. The typed `:` triggers `background.js`'s injected `mojifyInputListener`
   (fires on `event.data === ':'`), which sends `checkForEmotes` →
   `detectAndReplaceEmotes` matches `/:name:/` in the last 50 chars → calls
   `insertEmoteIntoMessenger` → a SECOND drag/drop file gets attached
   (file #2).

The fix keeps the name insert (Messenger UI actually expects the `:name:`
text next to the image — removing it was reverted) and instead gates the
background listener:

- `popup.js`'s `insertEmoteFromBase64` sets `window.__mojifyLastUpload =
  Date.now()` right before returning `withOptionalNameResult`, i.e. just
  before `insertNameText` types the text.
- `background.js`'s injected `mojifyInputListener` checks
  `window.__mojifyLastUpload` and skips `checkForEmotes` for 1000ms after
  that timestamp, so the synthetic `:` characters from `insertNameText`
  don't trigger a second auto-replace drop.

Real user typing is unaffected — the marker is only set by the popup
insert path.

If a similar "doubles" bug shows up on a new platform, first check whether
`background.js`'s `mojifyInputListener` + `detectAndReplaceEmotes` would
fire from the synthetically-typed `:name:` text, and gate the listener
using the same `__mojifyLastUpload` window.

## Discord pending-name lost after unsent emote (fixed 2026-08-13, v1.0.1)

Reported: popup-insert emote A, don't send it, then insert emote B and send
→ B's name never appended. Two independent causes, both fixed in v1.0.1:

1. `mojify-discord-send.js` `isMessageSend` regex had NO `$` anchor, so
   `POST /api/v9/channels/{id}/messages/{id}/ack` (read receipts — Discord
   fires these constantly) also matched and `getPending()` CONSUMED the
   pending name into the ack body. The slot was empty by the time the user
   pressed Enter. Fixed with `.../messages$` — only exact message-send POSTs
   consume pending. Verified: real send matches, ack/reaction/edit don't.
2. `popup.js` `insertFileOnDiscord` only called `withOptionalNameResult`
   (which sets `#mojify-pending-content`) AFTER
   `waitForDiscordAttachment` proved a visibleCount increase. With emote A
   still attached, B's insert can replace-in-place (count never increases) →
   all three routes time out → name never set. Fixed by setting the pending
   name up front, right after `findDiscordComposer`, before the route
   attempts.

Known trade-off of fix 2: if every insert route truly fails, the pending
name leaks into the next message send (previously it could leak stale too).
Keep the early-set + signal-check combo if this is ever revisited.

Format inconsistency (intentional, unchanged): popup.js sets pending WITH
colons (`:pepe:`), content.js `setPendingEmoteNameForDiscord` (~line 1603)
sets it WITHOUT colons (`.replace(/^:+|:+$/g, '')`), and
`insertEmoteNameViaEditor` sets WITH colons. The XHR interceptor appends
whatever is in the slot verbatim.

## WhatsApp send path + wa-js bundle (updated 2026-08-13, v1.0.2)

WhatsApp is NOT the drag/drop path — popup click → `sendWhatsAppInternalMedia`
(popup.js) → `ensureWhatsAppInternalBridge` injects
`extension/vendor/wppconnect-wa.js` into the page MAIN world (the wppconnect
wa-js bundle that probes WhatsApp Web's webpack module store), waits up to 30s
for `WPP.isReady` + `WPP.chat.sendFileMessage` + `getActiveChat`, then calls
`WPP.chat.sendFileMessage(chatId, base64DataUrl, {type, filename, mimetype,
caption, waitForAck: false})` with a 30s timeout. Animated GIFs are converted
to MP4 first and sent with `isGif: true`.

`waitForAck: false` means wa-js resolves as soon as the message is created in
the store — the actual upload runs async inside WhatsApp's own pipeline, so
the popup shows success while the bubble may still be spinning.

Known breakage signature (reported 2026-08-13): every emote send "succeeds",
bubble spins forever → "something went wrong / your message was not sent" →
try again keeps failing → reload page → try again works. That = wa-js built a
message incompatible with current WhatsApp Web internals; the store keeps a
wedged media upload state until reload rebuilds it from IndexedDB. Fix =
update `vendor/wppconnect-wa.js` from
https://github.com/wppconnect-team/wa-js/releases (bumped 2026-07-01 build
→ v4.5.0 on 2026-08-13). WA changes internals constantly, so the bundle WILL
break again — when it does, first try a fresh wa-js release, then flip
`waitForAck` to `true` for honest failure surfaced in the popup (it was kept
`false` deliberately for speed).

## Instagram send path (v1.2.0)

Instagram DMs (`instagram.com/direct`) attach media through a **hidden file
input** (`input[type=file]`, `accept="audio/*,.mp4,.mov,.png,.jpg,.jpeg"`,
`multiple` — class names are obfuscated and change, filter by accept, not
class). That is the same input the composer's "Add Photo or Video" button
feeds after the system picker. The proven insert route:

1. find the input (accept contains an image extension; there is usually a
   decoy `.json` input on the page — accept filtering skips it);
2. `assignFilesToInput` = `value=''` + `HTMLInputElement.prototype.files`
   setter + synthetic `input` + `change` events (React needs both);
3. **verify** before reporting success: the attachment signal is
   `aria-label="Remove attachment: <filename>"` (label includes the exact
   filename) plus the count of `blob:`-src preview images. No route reports
   success blindly — if all three routes (file input → paste event →
   drag/drop on the composer) time out (~4.5s each), the popup shows
   "Instagram did not accept the media". The wait loop ends with one final
   post-timeout signal check: in a hidden tab Chromium clamps `sleep(120)`
   to ~60s, so a poll-only loop would exit blind and falsely fail (observed
   as the paste route getting credit for the file-input route's attachment).

The composer itself is `div[contenteditable="true"][role="textbox"].notranslate`
and stays present after attaching (its placeholder says "Type message or
paste image..." — paste is a real Instagram feature, hence route 2). No
separate caption input exists in the DOM; emote name text (the
`sendEmoteNameWithMedia` setting, on by default) is typed into the same
composer, so it rides along as the image caption if Instagram sends it that
way.

Three copies of this logic exist, deliberately (same pattern as Discord):
`content.js` `insertFileOnInstagram` (insertEmote flow),
`popup.js` `insertFileOnInstagram` inside `insertEmoteFromBase64` (the
popup-click flow, uses the shared `assignFilesToInput`/`isVisible`/`sleep`
helpers), and `background.js`'s `insertEmoteWithDragDrop` which has the
Instagram branch **fully inlined** — `chrome.scripting.executeScript`
serializes only the function it is given, so no top-level helper references
are allowed inside it. When changing the signal or routes, change all three.

The `:name:` auto-replace path is the shared machinery (background
`startMonitoringTab` site list → `mojifyInputListener` on `event.data === ':'`
→ `detectAndReplaceEmotes` → `insertEmoteWithDragDrop`), and the popup path
sets `window.__mojifyLastUpload` before `insertNameText` so the synthetic
colons don't double-insert (same Messenger gate).

Key resolution (v1.2.1): `emoteMapping`/auto-replace passes trigger-style
keys (`:pepe:`), but IndexedDB keys are storage keys (`7tv:7tv-set:...`).
`insertEmoteIntoMessenger` now falls back to `triggerToStorageKey` when the
direct `getEmote(trigger)` misses — without it the auto-replace deleted the
typed text and inserted nothing on every platform. Keep that resolution if
this function is ever rewritten; the `getEmote` message handler
(`request.action === 'getEmote'`) resolves the same way.

### Testing Instagram insert without sending anything

- Never press Enter in a DM composer during automated tests — Enter sends.
  Typing text and attaching media are both local until the user hits Send.
- Auto-replace test (real machinery end to end): focus the composer, type
  `:emote_name:` **character by character** (CDP per-char input events, or
  `Input.insertText` per char) — a single insertText of the whole string
  produces one `input` event whose `data` is the whole string, which the
  `event.data === ':'` gate ignores. Then check the Remove-attachment label
  appeared and the `:name:` text is gone. Two environment gotchas found
  2026-10-10: CDP `Input.dispatchKeyEvent` is **dropped entirely** on a
  `visibilityState: 'hidden'` tab (no events fire at all), and
  `execCommand('insertText')` inserts but Instagram's controlled editor
  synchronously wipes the text. Workaround that works hidden: write the
  `:name:` text into the composer directly, then dispatch the trigger
  `InputEvent('input', {data: ':'})` from a throwaway dummy element outside
  the React tree — the document-level `mojifyInputListener` sees it while
  Instagram's handlers (target-based, no state change) leave the text alone.
- The harness's `cdp(method, **params)` takes keyword params only — passing
  a dict positionally lands in `session_id` and fails with "Message may
  have string 'sessionId' property".
- Two Instagram-specific test facts: a real typing insert persists the
  attachment as an unsent **draft**, so a page reload RESTORES it (a
  "clean reload" does not clear test attachments — remove them via the
  control instead), and that remove control is a bare 9×9
  `svg[aria-label="Remove attachment"]` with no `click()` method and no
  button ancestor — dispatch a `pointerdown/mousedown/pointerup/mouseup/
  click` sequence on it. The bare label resolves to the svg; the
  `Remove attachment: <filename>` labels are the preview images.
- The popup cannot be end-to-end tested when it is open as a TAB (its own
  chrome-extension URL is the active tab, so the "unsupported platform"
  gate trips by design). The injected `insertEmoteFromBase64` can be
  extracted from popup.js source and evaluated directly in the Instagram
  page to test the exact code the toolbar popup would run.

## Count vs grid consistency + empty IndexedDB (v1.0.5)

Symptom reported 2026-10-09: popup showed `2530` in the counter while the
Emotes grid was blank.

Two compounding causes:

1. `updateEmoteCount()` fell back to `Object.keys(allEmotes).length`
   (`emoteMapping` in chrome.storage) when the channel-derived count was 0.
   The listing survives independently of IndexedDB, so it kept reporting the
   old total after the media was gone.
2. `ensureEmoteLibraryLoaded()` finishes with `renderEmoteGrid(true)`, which
   overwrote the empty-state message from `filterAndDisplayEmotes()` with a
   bare `.channel-section` containing zero items.

Fix: the count only reflects channel entries that have IndexedDB assets, and
`renderLibraryEmptyState()` is the single place that renders "nothing to
show" — including a loud branch when `emoteMapping` is non-empty but
`emoteDataMap` is empty ("N items listed, but the media files are missing…
Run Refresh All").

Diagnosis when this recurs (any extension page, e.g. popup opened as a tab):

```js
indexedDB.databases()                                   // expect MojifyEmotes@v5
// then count stores emoteBlobs + emoteMetadata
chrome.storage.local.get(['emoteMapping','channels'])   // the listing side
```

blobs 0 + mapping > 0 = the media is gone, the listing isn't → recovery is
Refresh All (re-downloads from saved sources), not a re-import.

Related: the master backup/restore used to touch `EmoteExtensionDB`/`emotes`,
a database nothing else reads — that is why restores never brought media back.
Fixed in v1.0.7, see "Master backup is a listing, not a media archive" below.

## Master backup is a listing, not a media archive (v1.0.7)

`options.js` no longer touches any IndexedDB. Backup v3.0 = apiKeys +
`chrome.storage.local` (which holds `channels` with per-emote source URLs,
`emoteMapping`, `triggerToStorageKey`) + localStorage, plus a `data.media`
block that says `included: false`.

Media is deliberately not embedded: `MojifyEmotes.emoteBlobs` was measured at
**1.83 GB / 4264 files** (1985 png, 2279 gif). A JSON file cannot carry that
(base64 → ~2.4 GB string, and `JSON.parse` would blow the page up).

So a restore's contract is: storage back instantly, then `startMediaRedownload()`
sets the one-shot `manualRefresh` flag and messages `redownloadMissingMedia`,
which is a background action that maps the stored `channels` listing into
source objects (`buildDownloadSourcesFromStoredChannels`) and hands them to
`downloadEmotes({ sources })`. It must go through that action — bare
`downloadEmotes` only knows `channelIds` (Twitch), which most setups leave
empty, so it would bail with "No 7TV sources configured". The pipeline only
fetches media missing from IndexedDB, so restoring onto a profile that already
has the files costs nothing. Discord/Telegram media still needs the popup's
Refresh All with those sites open, and the restore status message says exactly
that.

Restore also deletes `skipNextDownload` / `lastRestoreTime` / `manualRefresh` /
`downloadInProgress` out of the incoming payload, because those flags gate the
re-download and a backup taken mid-download must not trip them.

v2.0 backups (with the `indexedDBEmotes` array) still restore fine: that array
was always empty, so it is ignored with a console warning, never written.

If a future change makes the library small again (say, <100 MB of media),
embedding blobs becomes possible — until then, do not "fix" this by adding
them to the JSON.

## 7tv media CDN needs cookies (v1.0.6)

`fetchBlobWithTimeout()` in `background.js` defaults to
`credentials: 'include'`. Without it, `cdn.7tv.app` (Cloudflare) answers
HEAD requests normally but never sends the body of a cookie-less GET from the
extension — the request sits there until the abort fires. That is what showed
up as hundreds of `Timed out after 30000ms` failures on Refresh All while a
normal web page could download the very same file.

One-line check from any extension page:

```js
await fetch(url, { credentials: 'include' }) // resolves, 200
await fetch(url)                              // hangs until abort
```

If a future provider starts timing out like this, test both forms before
blaming rate limits — HEAD success + GET hang is the cookie stall signature.
Individual emotes are also large (7TV `4x.gif` is routinely 2-3 MB), so keep
media timeouts at 30s+ even with cookies on.

## Media-tab toolbar visibility (v1.0.4)

`updateSortToolbarVisibility()` (popup.js) used to hide the whole
`#workspace-controls` wrapper whenever `isLocalLibraryTab()` was false, i.e.
on Giphy/Klipy/Pixabay. That wrapper also contains the `.media-tabs` source
chips (All/Twitch/Discord/Telegram/Giphy/Klipy/Pixabay), so selecting an
external provider made every chip disappear and there was no way back short
of reopening the popup.

Rule: the chips row is never hidden — only `.sort-toolbar` and
`#scope-toggle` are toggled by `isLocalLibraryTab()`, and
`.emote-stats-compact` is hidden by the CSS attribute selectors on
`#emotes-tab[data-media-tab="giphy|klipy|pixabay"]`. If a new provider tab
needs extra controls hidden, add a control, not its container.

## Active Channels tree (v1.1.0)

`updateChannelManagement()` (popup.js) renders `source > channel/server >
emote set` with branch lines. Grouping is display-only — storage is never
rewritten:

- a record is a **child** when `is7TVSetChannel()` or its `parentChannelId`
  differs from its own id → bucketed under `normalize(parentChannelId ||
  platformChannelId)`;
- plain records are **parent nodes**, keyed by `platformChannelId || id`;
- a bucket with no plain record gets a synthesized parent (xQc's five sets
  have no standalone xQc record — node name is derived from the children's
  shared username prefix, single child splits on `" - "`);
- **a node's source group comes from its children, not its own record**: the
  six Discord server parent records carry `sourceType: 'twitch'` in storage
  (import-time default). Trusting them would park every Discord branch under
  Twitch. If that storage default is ever fixed at the source, keep the
  children-first rule anyway — it also survives orphans.

Branch geometry lives in popup.css under "Branch lines" and depends on
`--tree-row-h: 38px` (elbow at row center, last child's column stops at
`calc(var(--tree-row-h) / 2)`). Keep new row heights on that var instead of
raw px, or the connector lines drift off-center.

Level geometry (v1.1.1): level 1 draws a 1px column at `row.left - 16` (=
the source row's 20px padding minus 4, matching the root stub at `left:3px`
+ its 1px border). Level 2 is NOT lines-only — it is a bordered box
(`.channel-tree-children`: `margin-left:10px`, `border-left:2px`, `padding
20px`) so sets can't read as siblings of their channel; the parent row's
`::after` stub is `left:10px; width:2px` and must stay flush with that
border. Both stay aligned only if margin, border, and stub move together.

Collapse state = the `collapsedChannelTreeNodes` Set in popup.js — in-memory
on purpose (resets open when the popup closes; nothing to migrate).

## Verifying popup UI via browser-use screenshots (learned v1.1.1)

The popup opened as a tab is usually a BACKGROUND tab → Chromium pauses its
rendering → `capture_screenshot()` returns a stale frame (byte-identical PNG,
old version badge) even though `js()` probes show the new DOM. `switch_tab()`
alone only moves the harness marker; call `activate_tab(targetId)` to actually
foreground the tab, then confirm freshness before trusting the image (file
length/timestamp of `~\.config\browser-harness\tmp\shot.png` changed, or the
DOM probe printed right before the capture matches the expected version).
`document.hasFocus()` can read true while `visibilityState` is still `'hidden'`
for a beat after activation — re-probe rather than assuming.

## Git identity

The repo's local `user.email` was the `your-email@example.com` placeholder
before any agent touched it (workaround: pass `-c user.email=...` per
command). Other repos in `Downloads/` use `fahadbinhussain001@gmail.com`
consistent with the GitHub account `FahadBinHussain`.
