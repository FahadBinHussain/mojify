# Changelog

All notable changes to Mojify are tracked here.

The format is inspired by Keep a Changelog, and this project follows practical semantic versioning while it is still moving quickly.

## Unreleased

### Added

- Instagram DM support: emotes insert into `instagram.com/direct` chats through Instagram's hidden media file input (`input[type=file]` with image `accept`), verified against the site's own "Remove attachment: <filename>" signal before reporting success, with paste and drag/drop as secondary routes. Typing `:name:` in a DM composer auto-replaces with the emote, same as the other platforms.
- Active Channels tree: every source now branches `platform > channel/server > emote set` with connector lines, per-branch expand/collapse, and counts at each level (`Twitch > xQc > Halloween Emotes 2026`), for Discord the same (`Discord > server > Emojis/Stickers`).
- Emote sets render inside a bordered nested box under their channel (brighter accent lines, 32px indent, parent rows styled as group headers) so sets can't read as siblings of their parent.
- Discord server media import for custom emojis and stickers.
- Parent/child scope browsing for Twitch channels, 7TV sets, Discord emojis, and Discord stickers.
- Recent item pagination for larger recent histories.
- Scope-aware pagination guard so switching channels or sets cannot land on an empty page.
- Repository community files, issue templates, security policy, and refreshed README.

### Changed

- Copy now leads with the gui deck, not typing: the readme tagline, the feature table (deck first), the manifest description and the repo description all say the same thing — type `:emote:` or search the deck and click to insert, no memorizing names. The old framing ("replaces trigger words") made it sound like typing was the only way in.
- Emotes workspace is positioned as a command deck with provider tabs, sorting, and scoped browsing.
- README now documents source support, insertion targets, privacy model, and release workflow.
- Backup is now v3.0: it stores the full emote listing (channels, per-emote source URLs, `emoteMapping`, `triggerToStorageKey`) instead of the empty `indexedDBEmotes` section. Media blobs (~1.8 GB) are not embedded — a restore re-downloads them from the stored source URLs, and the options page now says so.

### Fixed

- The emotes tab fits the 600px popup without scrolling: the popup is already at the browser's 800x600 maximum, so the layout is stacked tighter instead — header, tab bar, search deck, toolbar and pane padding are all smaller, emote previews are 38px instead of 48px, and the scope drawer rows are single-line (name left, count right) with a 360px cap so all three Discord servers show at once. Measured live in Edge with real data: the default view's pane went from 72px of overflow to exactly 0, and the drawer's internal scroll went from 250px to 0. The drawer-open state still scrolls the pane to reach results (drawer + full results cannot both fit in 518px), which is expected — picking a server closes the drawer and the view fits.
- Prevent emote eviction during low host disk space: added `unlimitedStorage` permission in `manifest.json` and explicit `navigator.storage.persist()` calls in `background.js` and `options.js` so IndexedDB media blobs are not purged as best-effort storage by Chromium's quota manager.
- Restore no longer wipes the recents screen: `restoreBackup` merges the backup's `recentItems` into the live list (live first, deduped by `dedupeKey`, capped at 150) instead of overwriting it, so a backup exported with empty recents keeps the current history. The emote library still restores fully from the backup — only the recents history is merged.
- Restore no longer wipes favorites: same fix as recents, for `favoriteEmotes` — `restoreBackup` merges the backup's favorites into the live list (union of emote keys, live first) instead of overwriting, so an emote favorited after the backup was exported stays favorited. No cap — favorites have none in the popup.
- The popup's search bar is focused on open: the popup opens on recents, but nothing focused `#search-recent`, so typing needed a click first. `focusSearchInputIfVisible` now focuses whichever search input belongs to the visible tab (recents or emotes), it runs at the end of `init()`, and switching back to the recents tab focuses it too — same `requestAnimationFrame` pattern the emotes tab already used.
- Discord refresh now names the real cause instead of always saying "logged out": a frozen (sleeping) Discord tab is detected with a `setTimeout(0)` liveness probe and reported as "your Discord tab is asleep — click it once to wake it up", a browser where Discord's storage is blocked (`localStorage`/`sessionStorage` both undefined on discord.com) is reported as "Discord cannot save its session in this browser" with the extension-bisect fix, and the import is raced against a 20s service-worker timeout so a tab that freezes mid-import surfaces an error instead of hanging forever. A genuinely signed-out browser still says "not signed in".
- Discord refresh no longer blames extensions for blocked storage: the 1.3.10 "Discord cannot save its session in this browser" error was wrong — Discord's own client removes `localStorage`/`sessionStorage` from the main world at boot on every tab (proven with a clean profile and zero extensions), so their absence is normal and proves nothing. The storage check is removed; a tab with no usable session now says "Discord has no session — sign in to Discord in this browser", and a fresh tab landing on `/login` still says "not signed in". The frozen-tab probe and 20s timeout are unchanged.
- The scope drawer shows the server name above every Discord server's sets: the parent guild record is stored with empty emotes, so it was filtered out before grouping and the drawer rendered bare "Emojis"/"Stickers" rows with nothing saying which server they belong to. The parent header now renders for parent-less groups too, resolving the name from the first set record (which carries the guild name), and Discord set rows show the Discord meta ("326 items") instead of the generic "326 emotes | saved". The tree is also compact now: shorter rows, smaller radius, lighter borders, a source icon on each server header, and a divider between servers.

- Typing `:name:` no longer deletes the text without inserting the emote: the background insert resolved trigger keys (`:pepe:`) directly against IndexedDB, whose keys are storage keys (`7tv:...`), so the lookup always missed. It now resolves through `triggerToStorageKey` like the rest of the extension (fixes auto-replace on every platform, not just Instagram).
- Source provider chips (All/Twitch/Discord/Telegram/Giphy/Klipy/Pixabay) no longer vanish when switching to the Giphy, Klipy, or Pixabay tab — only sort, scope, and local stats hide there now.
- Emote count no longer falls back to the stale `emoteMapping` listing, and the Emotes grid no longer renders a blank card when IndexedDB media is missing: it now shows how many items are listed versus present, with a "run Refresh All" instruction.
- Media downloads send cookies (`credentials: 'include'`): `cdn.7tv.app` stalls on cookie-less GETs from the extension, which produced the "Timed out after 30000ms" failures during Refresh All.
- Master restore no longer writes media into a database nothing reads: the `EmoteExtensionDB` wrapper in `options.js` is gone, and a restore now re-downloads media through the normal background pipeline instead of silently losing it.
- Refreshing Discord no longer looks servers up on 7TV (`7TV lookup failed: <guild id>: HTTP error! status: 404`): the 7TV download pipeline used to overwrite a Discord server's parent record with a `sourceType: 'twitch'` one, and the guild id leaked into `channelIds` where the Twitch refresh fed it to the 7TV API. Stored records are now healed from their children on startup, the download path refuses to overwrite non-Twitch records, and Discord/Telegram ids are filtered out of every Twitch source list (refresh-all, refresh-source, refresh-channel, restore).
- Deleting all Discord or Telegram sources no longer wipes the whole library: an empty `channelIds` was treated as a full clear, but those platforms never live in that list. The cleanup now only runs when the channel listing is empty too.
- Refresh All now refreshes each Discord server once — the parent, Emojis set, and Stickers set records all resolve to the same server and used to be imported three times.
- Refreshing a Discord row auto-opens the server again: the row's refresh button now finds any open Discord tab with that server (background tabs included) and opens one in the background when none exists, instead of refusing with "open the server first". A server that cannot be reached fails loudly and specifically — "was not found — you may not be a member of it, or the id is wrong", or "did not finish loading — server not found or Discord is unreachable".
- Refreshing a Discord row no longer fails for signed-in members: the resolver sampled the tab URL once after a fixed 2.5s wait, but a freshly opened background Discord tab boots its SPA afterwards and parks on `/channels/@me` first, so a member looked like a stranger ("but im logged in"). It now polls until the guild actually routes, resolves the guild from the id it was given instead of the URL, maps 403/401/404 to their real causes ("not a member" / "session expired" / "server deleted"), and `waitForTabLoaded` no longer misreports an already-complete cached tab as a load timeout.
- Refreshing a Discord row now uses your already-open Discord tab: it previously only reused a tab sitting on the exact target guild, so with any other Discord tab open it opened a fresh background tab — which has not booted Discord's client yet, leaving no session token and producing "the session token was unavailable and the page had no guild data yet". One booted Discord tab can read any guild by id, so any Discord tab is now used before a new one is ever opened.

### Known Limitations

- WhatsApp Web media insertion remains experimental because the site applies stricter trusted-event and media-format checks.
- Some provider tabs require user-supplied API keys.
- Discord imports require the target server to be open in Discord Web.

## 1.0.0

### Added

- Initial Mojify browser extension foundation.
- Twitch/7TV emote downloading and local IndexedDB caching.
- Popup library browsing, search, settings, backup, and restore flows.
- Minibar suggestions while typing emote triggers.
- Platform adapters for common chat and social surfaces.
