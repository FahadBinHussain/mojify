// ===== CONTENT SCRIPT INJECTION TEST =====
console.error("🚀 MOJIFY CONTENT SCRIPT LOADED!", window.location.href);
console.error("🚀 MOJIFY TIMESTAMP:", new Date().toISOString());
console.error("🚀 MOJIFY User Agent:", navigator.userAgent.substring(0, 50));


let emoteMapping = {};

// IndexedDB wrapper for emote storage (same as background.js)
const emoteDB = {
  async getEmote(key) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'getEmote',
        key: key
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  },

  async getAllEmotes() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'getAllEmotes'
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response || []);
        }
      });
    });
  }
};

// Debug mode - force to true
const DEBUG = true;

// Helper function to log debug messages
function debugLog(...args) {
  console.log("[Mojify Debug]", ...args);
}

// Load emote mapping from storage - retry mechanism
function loadEmoteMapping() {
  chrome.storage.local.get(['emoteMapping'], (result) => {
    if (result.emoteMapping) {
      emoteMapping = result.emoteMapping;
      debugLog("Loaded emote mapping with", Object.keys(emoteMapping).length, "emotes");
      debugLog("Sample emotes:", Object.keys(emoteMapping).slice(0, 5));
      debugLog("Full emote mapping:", emoteMapping);
    } else {
      debugLog("No emote mapping found in storage");
      // Retry after a short delay in case background script is still initializing
      setTimeout(() => {
        chrome.storage.local.get(['emoteMapping'], (retryResult) => {
          if (retryResult.emoteMapping) {
            emoteMapping = retryResult.emoteMapping;
            debugLog("Retry loaded emote mapping with", Object.keys(emoteMapping).length, "emotes");
          } else {
            debugLog("No emotes available after retry - user may need to configure channels");
          }
        });
      }, 2000);
    }
  });
}

// Initial load
loadEmoteMapping();

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.emoteMapping) {
    emoteMapping = changes.emoteMapping.newValue;
    debugLog("Updated emote mapping with", Object.keys(emoteMapping).length, "emotes");
    debugLog("Updated sample emotes:", Object.keys(emoteMapping).slice(0, 5));
  }
});

// Platform-specific input field selectors
const platformSelectors = {
    messenger: [
        'div[aria-label="Message"][contenteditable="true"][data-lexical-editor="true"]',
        '.xzsf02u.notranslate[contenteditable="true"][role="textbox"]',
        '.notranslate[contenteditable="true"][data-lexical-editor="true"]',
        '[aria-label="Message"][contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][data-lexical-editor="true"]',
        '.xzsf02u[role="textbox"]',
        '[aria-label="Message"]',
        '[placeholder="Aa"]',
        '.notranslate[contenteditable="true"]',
        'div[role="textbox"][spellcheck="true"]',
        'form [contenteditable="true"]',
        '[contenteditable="true"]'
    ],
    discord: [
        'div[role="textbox"][data-slate-editor="true"]',
        'div[contenteditable="true"][role="textbox"][data-slate-editor="true"]',
        '[aria-label="Message #"][role="textbox"]',
        'div[class*="slateTextArea"][role="textbox"]',
        'div[data-slate-node="element"][contenteditable="true"]',
        'div[contenteditable="true"][data-slate-editor="true"]',
        '[contenteditable="true"][data-slate-editor="true"]',
        'div[role="textbox"][contenteditable="true"]'
    ],
    facebook: [
        'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
        '[aria-label*="Write a comment"][contenteditable="true"]',
        '[aria-label*="Write something"][contenteditable="true"]',
        '[placeholder*="Write a comment"][contenteditable="true"]',
        '[placeholder*="What\'s on your mind"][contenteditable="true"]',
        'div[data-lexical-editor="true"][contenteditable="true"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        '.notranslate[contenteditable="true"][data-lexical-editor="true"]',
        '[contenteditable="true"][role="textbox"]'
    ]
};

// Detect current platform
function getCurrentPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('messenger.com')) return 'messenger';
    if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) return 'discord';
    if (hostname.includes('facebook.com')) return 'facebook';
    return null;
}

// Find input field for any supported platform
function findInputField() {
    const platform = getCurrentPlatform();
    if (!platform) {
        debugLog("Unsupported platform:", window.location.hostname);
        return null;
    }

    const selectors = platformSelectors[platform];
    debugLog("Searching for input field on platform:", platform);

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            if (elements.length > 1) {
                let maxBottom = 0;
                let bestElement = null;
                for (const el of elements) {
                    const rect = el.getBoundingClientRect();
                    if (rect.bottom > maxBottom && rect.width > 50) {
                        maxBottom = rect.bottom;
                        bestElement = el;
                    }
                }
                if (bestElement) {
                    debugLog("Found input field using selector:", selector, "on platform:", platform);
                    return bestElement;
                }
            } else {
                debugLog("Found input field using selector:", selector, "on platform:", platform);
                return elements[0];
            }
        }
    }

    debugLog("No input field found for platform:", platform);
    return null;
}

// Legacy function for backward compatibility
function findMessengerInputField() {
    return findInputField();
}

// Platform-specific file insertion methods
function insertFileOnPlatform(file, targetElement, platform) {
    debugLog("Inserting file on platform:", platform);

    if (platform === 'discord') {
        // Discord-specific insertion method
        return insertFileOnDiscord(file, targetElement);
    } else if (platform === 'messenger') {
        // Messenger uses drag and drop
        return simulateFileDrop(file, targetElement);
    } else if (platform === 'facebook') {
        // Facebook uses similar method to messenger
        return simulateFileDrop(file, targetElement);
    } else {
        // Fallback to drag and drop
        return simulateFileDrop(file, targetElement);
    }
}

// Discord-specific file insertion
function insertFileOnDiscord(file, targetElement) {
    debugLog("Using Discord-specific insertion method");

    // Try multiple Discord insertion methods
    try {
        // Method 1: Try paste event with files
        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData.items.add(file);
        const pasteResult = targetElement.dispatchEvent(pasteEvent);
        debugLog("Discord paste method result:", pasteResult);

        // Method 2: Try input event
        const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            data: null,
            inputType: 'insertFromPaste'
        });
        const inputResult = targetElement.dispatchEvent(inputEvent);
        debugLog("Discord input method result:", inputResult);

        // Method 3: Fallback to drag and drop
        simulateFileDrop(file, targetElement);

        return true;
    } catch (error) {
        debugLog("Discord insertion error:", error);
        // Fallback to standard method
        return simulateFileDrop(file, targetElement);
    }
}

// Simulate file drop (exact copy from example)
function simulateFileDrop(file, targetElement) {
    debugLog("Using drag and drop method");
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    ['dragenter', 'dragover', 'drop'].forEach(eventType => {
        const event = new DragEvent(eventType, {
            bubbles: true,
            cancelable: true,
            dataTransfer
        });
        const result = targetElement.dispatchEvent(event);
        debugLog(`${eventType} event result:`, result);
    });
}

// Main emote insertion function (adapted from example)
async function insertEmote(emoteTrigger) {
    debugLog("=== INSERTING EMOTE ===", emoteTrigger);

    try {
        // Check if we're on a supported platform
        const platform = getCurrentPlatform();
        if (!platform) {
            debugLog("Not on a supported platform:", window.location.hostname);
            return { success: false, error: 'This feature only works on supported platforms (Messenger, Discord, Facebook)' };
        }
        debugLog("Platform detected:", platform);

        // Get emote URL
        if (!emoteMapping || !emoteMapping[emoteTrigger]) {
            debugLog("Emote not found in mapping:", emoteTrigger);
            return { success: false, error: 'Emote not found' };
        }

        const emoteUrl = emoteMapping[emoteTrigger];
        debugLog("Emote URL:", emoteUrl);

        // Get cached image data from background script IndexedDB
        let dataUrl;
        let blob;
        let mimeType;

        // Try both formats - with and without colons
        debugLog("Looking for emote with key:", emoteTrigger);

        debugLog("Step 1: Starting emote lookup process");

        let cachedEmote;
        try {
            debugLog("Step 2: Attempting first lookup");
            cachedEmote = await emoteDB.getEmote(emoteTrigger);
            debugLog("Step 3: First lookup result:", cachedEmote ? "FOUND" : "NOT FOUND");

            if (!cachedEmote && !emoteTrigger.startsWith(':')) {
                const colonKey = ':' + emoteTrigger + ':';
                debugLog("Step 4: Trying with colons:", colonKey);
                cachedEmote = await emoteDB.getEmote(colonKey);
                debugLog("Step 5: Second lookup result:", cachedEmote ? "FOUND" : "NOT FOUND");
            }

            debugLog("Step 6: Skipping getAllEmotes debug to avoid hanging");
        } catch (error) {
            debugLog("❌ Error in lookup phase:", error);
            return { success: false, error: 'Failed to access emote storage: ' + error.message };
        }

        debugLog("Step 9: Processing cached emote:", cachedEmote);

        if (cachedEmote && cachedEmote.dataUrl) {
            debugLog("Step 10: ✅ Using cached data URL from IndexedDB - FAST!");
            try {
                dataUrl = cachedEmote.dataUrl;
                debugLog("Step 11: Data URL length:", dataUrl.length);

                // Convert data URL to blob for file creation
                debugLog("Step 12: Converting data URL to blob");
                const base64Data = dataUrl.split(',')[1];
                const mimeMatch = dataUrl.match(/data:([^;]+)/);
                mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                debugLog("Step 13: Detected MIME type:", mimeType);

                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                blob = new Blob([byteArray], { type: mimeType });

                debugLog("Step 14: Converted data URL to blob:", blob.size, "bytes, type:", mimeType);
            } catch (conversionError) {
                debugLog("❌ Error converting data URL to blob:", conversionError);
                return { success: false, error: 'Failed to convert emote data: ' + conversionError.message };
            }
        } else {
            debugLog("❌ Emote not found in IndexedDB cache or missing dataUrl");
            if (cachedEmote) {
                debugLog("Cached emote exists but missing dataUrl. Has keys:", Object.keys(cachedEmote));
            }
            return { success: false, error: 'Emote not cached. Please download emotes first.' };
        }

        // Create File object
        debugLog("Step 15: Creating file object");
        try {
            const fileName = mimeType.includes('gif') ? `${emoteTrigger}.gif` : `${emoteTrigger}.png`;
            const file = new File([blob], fileName, { type: mimeType });
            debugLog("Step 16: Created file:", fileName, file.size, "bytes");

            // Find input field for current platform
            debugLog("Step 17: Looking for input field on platform:", getCurrentPlatform());
            const inputField = findInputField();
            if (!inputField) {
                debugLog("❌ Could not find input field");
                return { success: false, error: 'Could not find input field on this platform' };
            }

            debugLog("Step 18: Found input field:", inputField.tagName, inputField.className);

            // Use platform-specific insertion method
            debugLog("Step 19: About to insert file using platform-specific method...");
            const insertResult = insertFileOnPlatform(file, inputField, platform);
            debugLog("Step 20: File insertion result:", insertResult, "- insertion should be complete");

            return { success: true };
        } catch (fileError) {
            debugLog("❌ Error in file creation/insertion phase:", fileError);
            return { success: false, error: 'Failed to create or insert file: ' + fileError.message };
        }

    } catch (error) {
        debugLog("Error inserting emote:", error);
        return { success: false, error: error.message };
    }
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    debugLog("Message received:", request);

    if (request.action === 'insertEmote') {
        insertEmote(request.emoteTrigger)
            .then(result => {
                debugLog("Insert result:", result);
                sendResponse(result);
            })
            .catch(error => {
                debugLog("Insert error:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Async response
    }

    return false;
});

// Auto-replace emote codes as user types
let typingBuffer = '';
let lastInputTime = 0;
let isProcessingEmote = false;

// Function to handle input events
async function handleInputEvent(event) {
  const { target } = event;

  // Check if processing is blocked

  if (isProcessingEmote) return;

  // Only process in text fields
  if (!(target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    return;
  }

  // Get current text content
  const currentText = target.isContentEditable ?
    (target.textContent || target.innerText || '') :
    target.value;

  debugLog("Input event - current text:", currentText);
  debugLog("Input event - event data:", event.data);
  debugLog("Input event - input type:", event.inputType);

  // Look for emote pattern in the last 50 characters
  const recentText = currentText.slice(-50);
  debugLog("Recent text for emote detection:", recentText);

  const emotePattern = /:([a-zA-Z0-9_!]+):/g;
  let match;



  // Find the last complete emote command
  while ((match = emotePattern.exec(recentText)) !== null) {
    const emoteName = match[1];
    const fullCommand = match[0];



    // Check both with and without colons since emotes might be stored either way
    const hasEmoteWithoutColons = emoteMapping && emoteMapping[emoteName];
    const hasEmoteWithColons = emoteMapping && emoteMapping[fullCommand];



    // Check if this emote exists in our mapping (try both formats)
    if (hasEmoteWithoutColons || hasEmoteWithColons) {
      // Determine which emote key to use for insertion
      const emoteKeyForInsertion = hasEmoteWithoutColons ? emoteName : fullCommand;



      isProcessingEmote = true;

      try {
        // For contenteditable (like messenger), remove the text and insert emote
        if (target.isContentEditable) {
          const selection = window.getSelection();
          const range = selection.getRangeAt(0);

          // Find the emote command text to remove
          const textNode = range.startContainer;
          const offset = range.startOffset;

          // Look backwards from cursor to find the emote command
          let searchText = '';
          let node = textNode;
          let searchOffset = offset;

          while (node && searchText.length < 50) {
            if (node.nodeType === Node.TEXT_NODE) {
              const nodeText = node.textContent;
              const startPos = node === textNode ? Math.max(0, searchOffset - 20) : 0;
              const endPos = node === textNode ? searchOffset : nodeText.length;
              searchText = nodeText.slice(startPos, endPos) + searchText;

              if (searchText.includes(fullCommand)) {
                const commandStart = searchText.lastIndexOf(fullCommand);
                const actualStart = startPos + commandStart;

                // Create range to select the emote command
                const deleteRange = document.createRange();
                deleteRange.setStart(node, actualStart);
                deleteRange.setEnd(node, actualStart + fullCommand.length);
                deleteRange.deleteContents();

                // Insert the emote using existing function with the correct key
                await insertEmote(emoteKeyForInsertion);
                break;
              }
            }

            // Move to previous node
            if (node.previousSibling) {
              node = node.previousSibling;
              searchOffset = node.textContent ? node.textContent.length : 0;
            } else {
              node = node.parentNode;
              searchOffset = 0;
            }
          }
        } else {
          // For regular input/textarea fields
          const commandIndex = currentText.lastIndexOf(fullCommand);
          if (commandIndex !== -1) {
            const newValue = currentText.substring(0, commandIndex) +
                            `[${emoteKeyForInsertion}]` +
                            currentText.substring(commandIndex + fullCommand.length);
            target.value = newValue;
            target.selectionStart = target.selectionEnd = commandIndex + emoteKeyForInsertion.length + 2;
          }
        }

      } catch (error) {
        debugLog("Error processing emote:", error);
      } finally {
        isProcessingEmote = false;
      }

      // Stop processing after first match
      break;
    }
  }
}

// Add multiple event listeners to catch different input types
document.addEventListener('input', handleInputEvent);
document.addEventListener('keyup', handleInputEvent);
document.addEventListener('textInput', handleInputEvent);
document.addEventListener('compositionend', handleInputEvent);

// Also listen on document body with event delegation
document.body.addEventListener('input', handleInputEvent, true);
document.body.addEventListener('keyup', handleInputEvent, true);


debugLog("Mojify content script loaded");

// Add startup check and ensure emotes are loaded
setTimeout(() => {
  debugLog("=== STARTUP CHECK ===");
  debugLog("Current URL:", window.location.href);
  debugLog("EmoteMapping exists:", !!emoteMapping);
  debugLog("EmoteMapping keys count:", emoteMapping ? Object.keys(emoteMapping).length : 0);
  debugLog("First 5 emote keys:", emoteMapping ? Object.keys(emoteMapping).slice(0, 5) : []);

  // Test if we can detect input field for current platform
  const platform = getCurrentPlatform();
  const inputField = findInputField();
  debugLog("Platform:", platform);
  debugLog("Input field found:", !!inputField);
  if (inputField) {
    debugLog("Input field type:", inputField.tagName, inputField.className);
  }

  // If no emotes loaded, try again
  if (!emoteMapping || Object.keys(emoteMapping).length === 0) {
    debugLog("No emotes loaded, attempting reload...");
    loadEmoteMapping();
  }

  // Add test for specific emotes that user might try
  if (emoteMapping && (emoteMapping['AlienPls'] || emoteMapping[':AlienPls:'])) {
    debugLog("✓ AlienPls emote found in mapping");
  } else if (emoteMapping && (emoteMapping['!join'] || emoteMapping[':!join:'])) {
    debugLog("✓ !join emote found in mapping");
  } else {
    debugLog("✗ Test emotes NOT found - available emotes:", Object.keys(emoteMapping || {}).slice(0, 10));
  }
}, 1000);

// Additional check after longer delay
setTimeout(() => {
  debugLog("=== EXTENDED CHECK ===");
  debugLog("Final emote count:", emoteMapping ? Object.keys(emoteMapping).length : 0);
  if (!emoteMapping || Object.keys(emoteMapping).length === 0) {
    debugLog("⚠️ Still no emotes loaded. User may need to:");
    debugLog("1. Open extension popup");
    debugLog("2. Add channel IDs in Settings");
    debugLog("3. Click 'Refresh Emotes'");
  }
}, 5000);
