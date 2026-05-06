# Contributing to Mojify

Thanks for helping make Mojify better. The project moves fastest when contributions are small, testable, and honest about platform quirks.

## Good First Contribution Areas

- Fix a platform insertion bug with a clear reproduction.
- Improve popup performance for large emote libraries.
- Add or refine provider import behavior.
- Improve docs, screenshots, and troubleshooting notes.
- Reduce noisy logging while keeping useful diagnostics.
- Improve accessibility and keyboard behavior in the popup.

## Local Setup

1. Clone the repository.
2. Load `extension/` as an unpacked Chrome extension.
3. Open the extension popup and configure providers as needed.
4. Use DevTools for the popup, background service worker, and content scripts while testing.

## Validation

Run syntax checks before opening a pull request:

```bash
node --check extension/background.js
node --check extension/content.js
node --check extension/popup.js
node --check extension/options.js
```

If you touch the web app, also validate it from `web/`:

```bash
pnpm install
pnpm build
pnpm dev
```

If a command is unavailable in the current package, mention that in the pull request instead of hiding it.

## Pull Request Standard

A strong pull request includes:

- A short explanation of the bug or feature.
- The files changed and why.
- Manual test steps with browser and platform names.
- Screenshots or screen recordings for UI changes.
- Any known limitations or follow-up work.

## Code Style

- Keep extension code dependency-light.
- Prefer small helper functions over large inline blocks.
- Avoid broad rewrites when fixing platform-specific bugs.
- Keep comments rare and useful.
- Treat WhatsApp, Discord, Messenger, Facebook, and Telegram as separate adapters.
- Never commit secrets, exported provider keys, local backups, or signing keys.

## Testing Platform Adapters

When testing insertion behavior, include:

- Browser name and version.
- Target platform and URL shape.
- Media type: PNG, GIF, MP4, sticker, or remote media.
- Whether the target composer was focused.
- Any console errors from the page, popup, and service worker.

## Commit Messages

Use direct messages that describe the change:

```text
Fix Discord scope pagination reset
Add Discord sticker import progress copy
Polish workspace scope drawer styles
```

## Release Notes

User-facing changes should be added to `CHANGELOG.md` under `Unreleased`.


