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

- Emotes workspace is positioned as a command deck with provider tabs, sorting, and scoped browsing.
- README now documents source support, insertion targets, privacy model, and release workflow.
- Backup is now v3.0: it stores the full emote listing (channels, per-emote source URLs, `emoteMapping`, `triggerToStorageKey`) instead of the empty `indexedDBEmotes` section. Media blobs (~1.8 GB) are not embedded — a restore re-downloads them from the stored source URLs, and the options page now says so.

### Fixed

- Typing `:name:` no longer deletes the text without inserting the emote: the background insert resolved trigger keys (`:pepe:`) directly against IndexedDB, whose keys are storage keys (`7tv:...`), so the lookup always missed. It now resolves through `triggerToStorageKey` like the rest of the extension (fixes auto-replace on every platform, not just Instagram).
- Source provider chips (All/Twitch/Discord/Telegram/Giphy/Klipy/Pixabay) no longer vanish when switching to the Giphy, Klipy, or Pixabay tab — only sort, scope, and local stats hide there now.
- Emote count no longer falls back to the stale `emoteMapping` listing, and the Emotes grid no longer renders a blank card when IndexedDB media is missing: it now shows how many items are listed versus present, with a "run Refresh All" instruction.
- Media downloads send cookies (`credentials: 'include'`): `cdn.7tv.app` stalls on cookie-less GETs from the extension, which produced the "Timed out after 30000ms" failures during Refresh All.
- Master restore no longer writes media into a database nothing reads: the `EmoteExtensionDB` wrapper in `options.js` is gone, and a restore now re-downloads media through the normal background pipeline instead of silently losing it.

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
