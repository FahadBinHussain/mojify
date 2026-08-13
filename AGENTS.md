# mojify local agent notes

## Build / reload

No build step — `extension/{content.js, popup.js, background.js}` are loaded
raw by `extension/manifest.json`. After any edit, reload the unpacked
extension with Extensions Reloader (`start msedge http://reload.extensions`).
JS/CSS/HTML hot-reload automatically; `manifest.json` changes need a manual
reload on `edge://extensions`.

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

## Git identity

The repo's local `user.email` was the `your-email@example.com` placeholder
before any agent touched it (workaround: pass `-c user.email=...` per
command). Other repos in `Downloads/` use `fahadbinhussain001@gmail.com`
consistent with the GitHub account `FahadBinHussain`.
