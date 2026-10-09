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

## Git identity

The repo's local `user.email` was the `your-email@example.com` placeholder
before any agent touched it (workaround: pass `-c user.email=...` per
command). Other repos in `Downloads/` use `fahadbinhussain001@gmail.com`
consistent with the GitHub account `FahadBinHussain`.
