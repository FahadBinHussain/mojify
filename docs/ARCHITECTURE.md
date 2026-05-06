# Architecture

Mojify is a Chrome Manifest V3 extension with a local-first media library. The extension is built around four runtime surfaces.

## Runtime Surfaces

### Background Service Worker

File: `extension/background.js`

Responsibilities:

- Download Twitch/7TV emote data and media.
- Import Discord server emojis and stickers.
- Manage long-running progress state in `chrome.storage.local`.
- Store emote metadata and blobs in IndexedDB.
- Coordinate platform-specific insertion flows.
- Package context menu actions.

### Content Script

File: `extension/content.js`

Responsibilities:

- Observe active web pages.
- Detect composer/input fields.
- Render and position the typing minibar.
- Relay insert actions to the page context where needed.
- Keep per-site interaction behavior isolated from the popup.

### Popup App

Files: `extension/popup.html`, `extension/popup.css`, `extension/popup.js`

Responsibilities:

- Browse local and remote media sources.
- Search, sort, favorite, and page through emote collections.
- Manage provider tabs and scope filters.
- Start imports/downloads and display progress.
- Trigger insertion into the active tab.
- Manage settings, backup, restore, debug, and storage panels.

### Options Page

Files: `extension/options.html`, `extension/options.css`, `extension/options.js`

Responsibilities:

- Store provider API keys.
- Export/import provider key configuration.
- Keep sensitive setup away from the main popup flow.

## Data Model

Mojify stores two categories of data:

- Metadata in `chrome.storage.local`, such as configured channels, progress state, provider keys, sort mode, recent items, and favorites.
- Media records in IndexedDB, including emote keys, source metadata, filenames, MIME types, and blobs.

The popup hydrates metadata first, then creates object URLs from blobs only when previews are needed.

## Provider Model

Providers are grouped by behavior:

- Local library providers: Twitch/7TV and Discord. These produce cached media that can be browsed without repeating network requests.
- Remote search providers: Giphy, Klipy, and Pixabay. These fetch result pages on demand and require API keys.

## Scope Model

The emote workspace uses hierarchical scope controls:

- `All Channels` or `All Servers`.
- Twitch parent channels.
- 7TV child emote sets.
- Discord server parents.
- Discord child media types: Emotes and Stickers.

The grid should always reset or clamp pagination when the active scope changes.

## Insertion Model

Mojify does not assume every website accepts the same insertion method. Adapters may use different strategies depending on platform behavior:

- Clipboard paths for static images where supported.
- File/drop simulation for platforms that accept file-like input.
- Debugger-assisted routes only for platforms that need privileged automation.
- DOM/text fallbacks for simple trigger insertion.

## Design Constraints

- Browser extension permissions must stay explainable.
- Runtime code should avoid large dependencies unless they unlock a clear feature.
- Imported media should be cached locally and not bundled into the extension.
- UI changes should stay fast with thousands of emotes.
- Platform-specific fixes should not break other platforms.
