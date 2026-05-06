# Support

Need help with Mojify? Start here.

## Before Opening an Issue

1. Reload the extension from `chrome://extensions/`.
2. Refresh the target website.
3. Make sure the message composer is focused before inserting media.
4. Check the popup, page, and service worker consoles for errors.
5. Try a small static PNG before testing animated media.

## Useful Details To Include

- Browser name and version.
- Mojify version or commit SHA.
- Target platform: Discord, Messenger, WhatsApp, Telegram, Facebook, or other.
- Media type: PNG, GIF, MP4, Discord emoji, Discord sticker, Giphy, Klipy, or Pixabay.
- Whether the media appears in Mojify but fails when clicked.
- Screenshots or short recordings when UI is involved.

## Common Issues

### Emotes show in the popup but click says not found

The metadata may exist while the blob is missing or stale. Try refreshing the provider/channel, then reload the extension.

### WhatsApp accepts PNG but rejects GIF

WhatsApp Web treats animated media differently from static images and may reject synthetic file insertion. This area is experimental.

### Discord import cannot find the server

Open Discord Web in a normal tab and navigate to the server before starting the import. Direct messages do not expose a guild import target.

### Twitch usernames do not resolve

Add Twitch Client ID and Client Secret in the options page, or use numeric Twitch channel IDs directly.
