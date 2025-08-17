# Automatic Download System Test

This document outlines tests to verify the automatic download functionality in the Mojify extension.

## Test Overview

The automatic download system should:
1. Start downloading emotes automatically when channel IDs are saved
2. Show progress feedback in the popup
3. Clean up storage when channel IDs are cleared
4. Handle errors gracefully
5. Notify users of download status

## Test Cases

### Test 1: Basic Automatic Download
**Steps:**
1. Open the Mojify extension popup
2. Navigate to Settings tab
3. Enter valid channel IDs (e.g., "xqc, forsen")
4. Click "Save Channel IDs"

**Expected Results:**
- Toast shows "Channel IDs saved - emotes will download automatically"
- Progress bar appears with "Starting automatic download..."
- Download progresses automatically without manual trigger
- Progress updates show current emote being downloaded
- On completion: "Emotes downloaded successfully" toast
- Emotes tab shows downloaded emotes

### Test 2: Progress Monitoring
**Steps:**
1. Save channel IDs with many emotes (e.g., "xqc, sodapoppin, forsen")
2. Observe progress bar during download

**Expected Results:**
- Progress bar shows percentage completion
- Current/total count updates (e.g., "45/120")
- Current emote name shows in progress text
- Progress persists if popup is closed and reopened

### Test 3: Channel ID Clearing
**Steps:**
1. Have channel IDs saved with emotes downloaded
2. Clear the channel IDs text area
3. Click "Save Channel IDs"

**Expected Results:**
- Toast shows "Channel IDs cleared"
- Progress bar hides
- Storage is cleaned up automatically
- Emotes tab shows "No emotes loaded"
- Storage info shows 0 emotes

### Test 4: Clear All Storage
**Steps:**
1. Have channel IDs and emotes loaded
2. Click "Clear All Data" button
3. Confirm the action

**Expected Results:**
- Confirmation dialog appears
- All data is cleared including channel IDs
- Channel IDs text area is cleared
- UI resets to empty state
- Toast shows "All data cleared successfully"

### Test 5: Multiple Channel ID Updates
**Steps:**
1. Save initial channel IDs (e.g., "xqc")
2. Wait for download to complete
3. Add more channel IDs (e.g., "xqc, forsen, sodapoppin")
4. Save again

**Expected Results:**
- Second save triggers new automatic download
- Only new/changed emotes are downloaded
- Progress shows for the new download
- Final emote count includes all channels

### Test 6: Error Handling
**Steps:**
1. Enter invalid channel ID (e.g., "invalidchannel123456")
2. Save channel IDs

**Expected Results:**
- Download starts but handles invalid channels gracefully
- Valid channels still download successfully
- Error is logged in console but doesn't crash extension
- User sees completion message for successful downloads

### Test 7: Popup Closed During Download
**Steps:**
1. Start downloading by saving channel IDs
2. Close popup while download is in progress
3. Reopen popup

**Expected Results:**
- Progress resumes where it left off
- Progress bar shows current status
- Download continues in background
- Completion is detected when popup reopens

### Test 8: Background Storage Listener
**Steps:**
1. Use browser developer tools to manually set channelIds in storage:
   ```javascript
   chrome.storage.local.set({channelIds: ['xqc', 'forsen']})
   ```

**Expected Results:**
- Background script detects the change
- Automatic download starts
- Console logs show "Channel IDs changed, automatically starting download"

## Edge Cases

### Empty Channel IDs
- Saving empty string should clear storage
- No download should be triggered

### Duplicate Channel IDs
- Should handle duplicates gracefully
- Should not download same emotes twice

### Very Large Channel Lists
- Should handle many channels (10+)
- Progress should work correctly
- Memory usage should be reasonable

## Verification Points

### Console Logs
Check browser console for these messages:
- `[Mojify] Channel IDs changed, automatically starting download: [...]`
- `[DEBUG] Starting emote download with image data...`
- `[Mojify] Automatic download completed successfully`

### Storage Inspection
Use browser developer tools to verify:
- `channelIds` array is correctly stored
- `channels` array contains downloaded data
- `emoteImageData` contains base64 image data
- `downloadProgress` is properly managed

### UI State
- Progress bar shows/hides appropriately
- Button states change correctly
- Toast messages are informative
- Emote count updates correctly

## Performance Tests

### Large Downloads
- Test with channels having 100+ emotes
- Verify concurrent download limit (20 per batch)
- Check memory usage doesn't spike excessively

### Network Issues
- Test with slow network connection
- Test with intermittent connectivity
- Verify timeout handling (10 second timeout per emote)

## Cleanup Tests

### Storage Cleanup
- Verify old emote data is removed when channels are removed
- Check that unused storage keys are cleaned up
- Confirm storage size is reasonable

## Success Criteria

✅ All automatic downloads work without manual intervention
✅ Progress feedback is accurate and helpful
✅ Storage is properly managed and cleaned
✅ Error conditions are handled gracefully
✅ UI provides clear feedback at all stages
✅ Background processing works even when popup is closed
✅ Performance is acceptable for typical usage patterns

## Notes

- The automatic download system uses Chrome's storage.onChanged listener
- Downloads happen with 20 concurrent emotes per batch
- Each emote has a 10-second download timeout
- Progress is persisted in storage for popup restoration
- The system is designed to be resilient to popup closures and reopens