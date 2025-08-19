# Mojify - Browser Extension

<img src="https://wakapi-qt1b.onrender.com/api/badge/fahad/interval:any/project:Mojify"
     alt="Wakapi Time Tracking"
     title="Time spent on this project">

A powerful browser extension that brings Twitch emotes to any website with intelligent suggestions and seamless integration.

![Mojify Demo](animation.gif)

## ✨ Features

### 🎯 **Smart Emote Integration**
- **Universal Emote Support**: Use Twitch emotes anywhere on the web
- **Intelligent Minibar**: Real-time emote suggestions with modern floating UI
- **Auto-Complete**: Type `:emote_name:` and watch it transform into the actual emote
- **Click-to-Insert**: Select emotes from the suggestion bar with a single click

### 🌐 **Platform Support**
- **Messenger** (Facebook Messenger)
- **Discord** 
- **WhatsApp Web**
- **Telegram Web**
- **Facebook**
- And more platforms being added regularly!

### 🎨 **Modern User Experience**
- **Glassmorphism Design**: Beautiful, modern UI with blur effects
- **Minimal Floating Bar**: Clean emote picker that stays out of your way
- **Responsive Suggestions**: Instant emote filtering as you type
- **Position Memory**: Remembers minibar position per website
- **Smooth Animations**: Elegant hover effects and transitions

### ⚡ **Advanced Technology**
- **Intelligent Caching**: Fast emote loading with IndexedDB storage
- **Real-time Updates**: Automatic background emote syncing
- **Progressive Downloads**: Smart batching and priority-based downloading
- **Cross-platform File Insertion**: Advanced drag-and-drop simulation

## 🚀 Quick Start

### Installation

1. **Load the Extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `extension` folder

2. **Configure Channels**:
   - Click the Mojify extension icon
   - Go to "Settings" tab
   - Add Twitch channel IDs (e.g., `xqc`, `forsen`, `sodapoppin`)
   - Click "Save Channel IDs"

3. **Download Emotes**:
   - Click "Refresh Emotes" to download emote library
   - Wait for download completion

### Usage

#### **Method 1: Auto-Complete Typing**
```
Type: :kappa:
Result: 🐸 (actual Kappa emote image)
```

#### **Method 2: Smart Suggestions**
1. Start typing `:angry` on any supported website
2. Minibar appears with matching emotes
3. Click any emote to insert it instantly
4. Partial text is automatically cleaned up

#### **Method 3: Extension Popup**
1. Click the extension icon
2. Browse or search emotes
3. Click any emote to insert on supported sites

## 🔧 Technical Architecture

### Core Components

- **Content Script** (`content.js`): Handles page interaction and emote insertion
- **Background Service** (`background.js`): Manages downloads and storage
- **Popup Interface** (`popup.html/js/css`): Extension configuration and browsing
- **Manifest V3**: Modern extension architecture

### Smart Features

#### **Intelligent Minibar**
- **Real-time Filtering**: Suggests emotes as you type
- **Position Persistence**: Remembers location per domain using localStorage
- **Collision Detection**: Prevents text overlap with smart spacing
- **Performance Optimized**: Efficient DOM manipulation and caching

#### **Advanced Download System**
- **Incremental Updates**: Only downloads new/changed emotes
- **Progress Tracking**: Real-time download status with detailed feedback
- **Error Recovery**: Robust handling of network issues
- **Batch Processing**: Intelligent grouping for optimal performance

#### **Cross-Platform Insertion**
- **Multiple Methods**: File dropping, clipboard simulation, direct injection
- **Platform Detection**: Automatic adaptation to different websites
- **Input Field Discovery**: Smart detection of text input areas
- **Fallback Systems**: Multiple insertion strategies for reliability

## 🎨 Customization

### Minibar Appearance
The minibar automatically adapts to each website while maintaining its minimal design:
- Transparent background with blur effects
- Floating emote previews with command tooltips
- Smooth scaling and hover animations
- Compact horizontal layout

### Adding Custom Channels
1. Open extension popup
2. Navigate to Settings tab
3. Add channel IDs (usernames) in the text area
4. Save and refresh emotes

### Position Adjustment
- Drag the minibar to your preferred position
- Position is automatically saved per website
- Reset by refreshing the page

## 🔍 Debugging

### Debug Tools (Built-in)
The extension includes comprehensive debugging tools:

1. **Open Extension Popup**
2. **Go to Settings > Debug Tools**
3. **Available Tools**:
   - **Find Text Field**: Locate input areas on current page
   - **Insert Test Text**: Verify text insertion works
   - **Analyze Page**: Get detailed page information
   - **Test Drag & Drop**: Verify file insertion capability
   - **Test Basic Functionality**: Overall system check

### Console Logging
Enable detailed logging by opening browser DevTools:
```javascript
// Check for errors in console
console.log("Mojify debug info appears here")
```

## 🛠️ Development

### Project Structure
```
Mojify/
├── extension/           # Browser extension files
│   ├── manifest.json   # Extension manifest
│   ├── content.js      # Page interaction logic
│   ├── background.js   # Service worker
│   ├── popup.html      # Extension popup UI
│   ├── popup.js        # Popup functionality
│   ├── popup.css       # Modern styling
│   └── icons/          # Extension icons
├── desktop/            # Future desktop app
├── python/             # Python utilities
└── README.md
```

### Key Technologies
- **Manifest V3**: Modern extension framework
- **IndexedDB**: Client-side emote storage
- **7TV API**: Twitch emote data source
- **Advanced DOM Manipulation**: Cross-platform compatibility
- **Modern CSS**: Glassmorphism and smooth animations

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on multiple platforms
5. Submit a pull request

## 🔒 Privacy & Security

- **Local Storage Only**: All emotes stored locally in your browser
- **No Data Collection**: Extension doesn't track or store personal data
- **Secure Downloads**: Direct connection to 7TV API only
- **Minimal Permissions**: Only requests necessary browser permissions

## 🐛 Known Issues & Solutions

### **Emotes Not Appearing**
- Verify you've added channel IDs in settings
- Check that "Refresh Emotes" completed successfully
- Ensure you're on a supported platform

### **Minibar Not Showing**
- Make sure you're typing in a text input field
- Verify the website is supported
- Check browser console for errors

### **Position Not Saving**
- Ensure localStorage is enabled in your browser
- Try refreshing the page after repositioning

## 📝 Changelog

### Latest Updates
- ✅ **Improved Minibar**: Ultra-minimal floating design
- ✅ **Better Messaging**: Accurate download status feedback
- ✅ **Enhanced Performance**: Faster emote loading and insertion
- ✅ **Position Memory**: Per-site minibar position saving
- ✅ **Smart Cleanup**: Automatic partial text removal
- ✅ **Modern UI**: Glassmorphism design with smooth animations

## 🤝 Support

- **Issues**: Report bugs on GitHub Issues
- **Feature Requests**: Submit enhancement ideas
- **Documentation**: Check this README for detailed info

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgements

- **7TV**: For providing the emote API and data
- **Twitch Community**: For creating amazing emotes
- **Browser Extension APIs**: For enabling cross-platform functionality
- **Modern Web Standards**: For making advanced features possible

---

Made with ❤️ for the emote community

**Ready to bring your favorite Twitch emotes everywhere? Install Mojify today!** 🚀