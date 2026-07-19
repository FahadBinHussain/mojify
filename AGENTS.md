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

## Git identity

The repo's local `user.email` was the `your-email@example.com` placeholder
before any agent touched it (workaround: pass `-c user.email=...` per
command). Other repos in `Downloads/` use `fahadbinhussain001@gmail.com`
consistent with the GitHub account `FahadBinHussain`.
