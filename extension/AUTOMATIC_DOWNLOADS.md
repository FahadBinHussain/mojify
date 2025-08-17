# Automatic Downloads Feature

## Overview

Mojify now features **automatic emote downloads** that make using the extension even more seamless. When you save channel IDs in the settings, emotes are automatically downloaded in the background without any additional action required.

## How It Works

### 1. Save Channel IDs
- Open the Mojify extension
- Go to the **Settings** tab
- Enter channel IDs (one per line or comma-separated)
- Click **"Save Channel IDs"**

### 2. Automatic Download Starts
- As soon as you save channel IDs, emotes begin downloading automatically
- You'll see a notification: *"Channel IDs saved - emotes will download automatically"*
- A progress bar appears showing download status

### 3. Real-Time Progress
- Watch the progress bar fill up as emotes download
- See which emote is currently being downloaded
- View current/total count (e.g., "45/120")

### 4. Completion
- Get notified when download completes: *"Emotes downloaded successfully"*
- Emotes are immediately available in the **Emotes** tab
- Ready to use on messenger.com!

## Key Benefits

✅ **No Manual Downloads** - No need to click "Refresh Emotes" anymore  
✅ **Instant Setup** - Save channels and emotes download immediately  
✅ **Background Processing** - Downloads continue even if popup is closed  
✅ **Smart Progress** - Resume progress tracking if popup is reopened  
✅ **Storage Cleanup** - Automatically cleans up when channels are removed  

## Visual Indicators

### Progress Bar
- **Blue progress bar** shows download percentage
- **Counter** displays current progress (e.g., "23/87")
- **Status text** shows current emote being downloaded

### Toast Notifications
- **"Channel IDs saved"** - Confirms save and announces auto-download
- **"Starting automatic download"** - Download has begun
- **"Emotes downloaded successfully"** - All emotes ready to use
- **"Channel IDs cleared"** - Storage cleaned up

## Managing Downloads

### Adding More Channels
1. Add new channel IDs to your existing list
2. Click "Save Channel IDs"
3. Only new emotes will be downloaded automatically

### Removing Channels
1. Delete channel IDs from the text area
2. Click "Save Channel IDs"
3. Associated emotes are automatically cleaned up

### Clearing Everything
1. Use the **"Clear All Data"** button in settings
2. Confirms before removing all channels and emotes
3. Resets extension to fresh state

## Performance & Reliability

### Concurrent Downloads
- Downloads up to **20 emotes simultaneously** for speed
- Batches downloads to prevent overwhelming servers
- Small delays between batches for stability

### Error Handling
- Invalid channels are skipped gracefully
- Individual emote failures don't stop entire download
- Retry logic for temporary network issues

### Timeout Protection
- Each emote has a **10-second download timeout**
- Prevents hanging on slow/broken image URLs
- Continues with remaining emotes if some fail

## Troubleshooting

### Download Not Starting
- **Check channel IDs**: Ensure they're valid Twitch usernames
- **Verify internet connection**: Downloads require network access
- **Look for notifications**: Toast messages provide status updates

### Slow Downloads
- **Large channels**: Channels with many emotes take longer
- **Network speed**: Slower connections affect download time
- **Server load**: 7TV servers may be busy during peak times

### Progress Not Showing
- **Reopen popup**: Progress resumes where it left off
- **Check storage**: Browser may have storage limits
- **Console logs**: Developer tools show detailed progress

### Missing Emotes
- **Wait for completion**: Ensure download finished fully
- **Refresh emotes tab**: Switch tabs to trigger refresh
- **Check channel validity**: Some channels may have no emotes

## Storage Information

### What's Stored
- **Channel IDs**: Your saved channel list
- **Emote metadata**: Names, URLs, and channel associations
- **Image data**: Base64-encoded emote images for fast insertion
- **Progress data**: Temporary download status (auto-cleaned)

### Storage Cleanup
- **Automatic**: Removing channels cleans associated emotes
- **Manual**: "Clear All Data" removes everything
- **Smart**: Only stores data for currently configured channels

## Tips for Best Experience

1. **Start small**: Add 1-2 channels first to test
2. **Wait for completion**: Let downloads finish before adding more
3. **Monitor progress**: Keep popup open to watch progress
4. **Check notifications**: Toast messages provide important updates
5. **Use valid channels**: Verify channel names exist on Twitch

## Technical Details

### Background Processing
- Downloads happen in the **background service worker**
- Continues even when popup is closed
- Uses Chrome's **storage change listeners** for automation

### Storage Events
- Saving channel IDs triggers automatic download
- Clearing channel IDs triggers automatic cleanup
- Changes are detected instantly via Chrome storage API

### Data Format
- Emotes stored with full image data for instant insertion
- Concurrent batch processing for optimal performance
- Proper error handling and timeout management

## Privacy & Security

- **No personal data collected**: Only stores chosen channel IDs
- **Local storage only**: All data stays in your browser
- **7TV API only**: Only connects to 7TV servers for emotes
- **No tracking**: No analytics or user behavior monitoring

---

**Enjoy seamless emote downloading with Mojify! 🎉**

*For issues or questions, check the browser console for detailed logs or create an issue on the project repository.*