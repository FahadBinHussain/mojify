# Mojify

A sleek, modern emoji and emote clipboard manager built with Tauri and Next.js.

![Mojify Screenshot](animation.gif)

## Features

- 🎨 **Modern, glass-like UI**: Beautiful, sleek design inspired by Windows 11
- 🔍 **Instant search**: Quickly find any emoji or emote
- ⌨️ **Global shortcut**: Access emojis from anywhere with `Alt+Space`
- 🌓 **Dark/Light mode**: Switch between themes based on your preference
- 🔄 **System tray integration**: Always accessible from your taskbar
- 📋 **Windows Clipboard-like experience**: Pop up when needed, hide when not in use
- 🚀 **Fast and lightweight**: Built with performance in mind

## Technology Stack

- **[Tauri](https://tauri.app/)**: Lightweight, secure desktop framework
- **[Next.js](https://nextjs.org/)**: React framework for enhanced developer experience
- **[Tailwind CSS](https://tailwindcss.com/)**: Utility-first CSS framework
- **[Framer Motion](https://www.framer.com/motion/)**: Animation library for smooth transitions
- **[Lucide Icons](https://lucide.dev/)**: Beautiful, consistent icons

## Getting Started

### Prerequisites

- Node.js 18 or higher
- Rust and Cargo (for Tauri)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/mojify.git
   cd mojify
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run tauri dev
   ```

### Building for Production

```bash
npm run tauri build
```

The built application will be in the `src-tauri/target/release` directory.

## Usage

- **Global Shortcut**: Press `Alt+Space` to open Mojify from anywhere
- **System Tray**: Click the Mojify icon in your system tray to show/hide the app
- **Search**: Type to instantly filter emojis
- **Categories**: Browse emojis by category
- **Copy to Clipboard**: Click any emoji to copy it to your clipboard and dismiss the app

## Customization

### Adding Custom Emotes

You can add custom emotes by modifying the `EMOJIS` object in `src/app/page.tsx` to include your own collections.

### Changing the Global Shortcut

To change the global shortcut, modify the `register` call in `src-tauri/src/main.rs`:

```rust
app.global_shortcut_manager()
    .register("YOUR_CUSTOM_SHORTCUT", move || {
        // ...
    })
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- Inspired by Windows Clipboard and modern UI design principles
- Special thanks to the Tauri and Next.js communities for their excellent documentation

---

Made with ❤️ by [Your Name]