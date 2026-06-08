# Mojify Telegram TGS Native Host

This host gives Mojify a high-quality local conversion path for Telegram `.tgs`
animated stickers.

The extension tries this host first. When it is installed, animated Telegram
stickers are rendered frame-by-frame at the source animation frame rate, encoded
with ffmpeg/libvpx-vp9 in lossless WebM mode, then returned to the extension in
Native Messaging chunks. If the host is not installed or a conversion fails,
Mojify skips animated TGS stickers so lower-quality browser conversions do not
mix into the library.

## Requirements

- Node.js installed; the installer records the current `node` path
- ffmpeg on `PATH`
- Chrome, Edge, or another Chromium executable

On Windows with Scoop:

```powershell
scoop install nodejs ffmpeg
```

## Install

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File native\telegram-tgs-host\install-native-host.ps1 -Browser Both
```

Reload the unpacked extension after installing because `nativeMessaging` is a
manifest permission.

## Test

```powershell
node native\telegram-tgs-host\mojify-native-host.js --self-test
```

The self-test renders a tiny generated Lottie animation through the same
headless-browser and ffmpeg path used by the extension.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File native\telegram-tgs-host\install-native-host.ps1 -Browser Both -Uninstall
```

The installer only writes the current user's Chrome/Edge Native Messaging
registry keys, a generated local host manifest, and a tiny generated `.exe`
launcher for the Node host.
