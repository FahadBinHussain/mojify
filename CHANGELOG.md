# Changelog

All notable changes to Mojify are tracked here.

The format is inspired by Keep a Changelog, and this project follows practical semantic versioning while it is still moving quickly.

## Unreleased

### Added

- Discord server media import for custom emojis and stickers.
- Parent/child scope browsing for Twitch channels, 7TV sets, Discord emojis, and Discord stickers.
- Recent item pagination for larger recent histories.
- Scope-aware pagination guard so switching channels or sets cannot land on an empty page.
- Repository community files, issue templates, security policy, and refreshed README.

### Changed

- Emotes workspace is positioned as a command deck with provider tabs, sorting, and scoped browsing.
- README now documents source support, insertion targets, privacy model, and release workflow.

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
