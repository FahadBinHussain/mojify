// ===== CONTENT SCRIPT INJECTION TEST =====
console.error("🚀 MOJIFY CONTENT SCRIPT LOADED!", window.location.href);
console.error("🚀 MOJIFY TIMESTAMP:", new Date().toISOString());
console.error("🚀 MOJIFY User Agent:", navigator.userAgent.substring(0, 50));
alert("Mojify content script loaded on " + window.location.href);

let emoteMapping = {};

// IndexedDB wrapper for emote storage (same as background.js)
const emoteDB = {
  db: null,
  dbName: 'MojifyEmoteDB',
  version: 1,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('emotes')) {
          const emotesStore = db.createObjectStore('emotes', { keyPath: 'key' });
          emotesStore.createIndex('channel', 'channel', { unique: false });
          emotesStore.createIndex('url', 'url', { unique: false });
        }
      };
    });
  },

  async getEmote(key) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emotes'], 'readonly');
      const store = transaction.objectStore('emotes');
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
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

// Find messenger input field (copied from example)
function findMessengerInputField() {
    const possibleSelectors = [
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
    ];

    for (const selector of possibleSelectors) {
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
                if (bestElement) return bestElement;
            } else {
                return elements[0];
            }
        }
    }
    return null;
}

// Simulate file drop (exact copy from example)
function simulateFileDrop(file, targetElement) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    ['dragenter', 'dragover', 'drop'].forEach(eventType => {
        const event = new DragEvent(eventType, {
            bubbles: true,
            cancelable: true,
            dataTransfer
        });
        targetElement.dispatchEvent(event);
    });
}

// Main emote insertion function (adapted from example)
async function insertEmote(emoteTrigger) {
    debugLog("=== INSERTING EMOTE ===", emoteTrigger);

    try {
        // Check if we're on messenger.com
        if (!window.location.href.includes('messenger.com')) {
            debugLog("Not on messenger.com");
            return { success: false, error: 'This feature only works on messenger.com' };
        }

        // Get emote URL
        if (!emoteMapping || !emoteMapping[emoteTrigger]) {
            debugLog("Emote not found in mapping:", emoteTrigger);
            return { success: false, error: 'Emote not found' };
        }

        const emoteUrl = emoteMapping[emoteTrigger];
        debugLog("Emote URL:", emoteUrl);

        // Check if we have cached image data in IndexedDB
        let blob;
        let mimeType;

        try {
            // Initialize IndexedDB if needed
            if (!emoteDB.db) {
                await emoteDB.init();
            }

            // Try both formats - with and without colons
            let cachedEmote = await emoteDB.getEmote(emoteTrigger);
            if (!cachedEmote && !emoteTrigger.startsWith(':')) {
                cachedEmote = await emoteDB.getEmote(':' + emoteTrigger + ':');
            }
            if (cachedEmote && cachedEmote.blob) {
                debugLog("✅ Using cached blob from IndexedDB - FAST!");
                blob = cachedEmote.blob;
                mimeType = cachedEmote.type || 'image/png';
            } else {
                debugLog("⏳ Downloading image data...");
                const response = await fetch(emoteUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch emote: ${response.status}`);
                }
                blob = await response.blob();
                mimeType = blob.type || 'image/png';
                debugLog("Downloaded fresh image data");
            }
        } catch (error) {
            debugLog("Error accessing IndexedDB, falling back to direct download:", error);
            const response = await fetch(emoteUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch emote: ${response.status}`);
            }
            blob = await response.blob();
            mimeType = blob.type || 'image/png';
        }

        // Create File object
        const fileName = mimeType.includes('gif') ? `${emoteTrigger}.gif` : `${emoteTrigger}.png`;
        const file = new File([blob], fileName, { type: mimeType });
        debugLog("Created file:", fileName, file.size, "bytes");

        // Find messenger input field
        const inputField = findMessengerInputField();
        if (!inputField) {
            debugLog("Could not find message input field");
            return { success: false, error: 'Could not find message input field' };
        }

        debugLog("Found input field:", inputField.tagName, inputField.className);

        // Simulate file drop (exact same as example extension)
        simulateFileDrop(file, inputField);
        debugLog("File drop simulated");

        return { success: true };

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

  // ALWAYS log input events to verify listener is working
  console.error("🎯 MOJIFY INPUT EVENT:", event.type, target.tagName, target.className, "data:", event.data);
  console.error("🎯 MOJIFY PROCESSING:", isProcessingEmote ? "BLOCKED" : "ACTIVE");

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

  console.error("🔍 MOJIFY PATTERN SEARCH in:", recentText);
  console.error("🔍 MOJIFY REGEX:", emotePattern);

  // Find the last complete emote command
  while ((match = emotePattern.exec(recentText)) !== null) {
    const emoteName = match[1];
    const fullCommand = match[0];

    console.error("🎯 MOJIFY FOUND MATCH:", fullCommand, "emoteName:", emoteName);
    console.error("🎯 MOJIFY Available keys sample:", emoteMapping ? Object.keys(emoteMapping).slice(0, 5) : "No mapping");

    // Check both with and without colons since emotes might be stored either way
    const hasEmoteWithoutColons = emoteMapping && emoteMapping[emoteName];
    const hasEmoteWithColons = emoteMapping && emoteMapping[fullCommand];

    console.error("🎯 MOJIFY Check '" + emoteName + "':", hasEmoteWithoutColons ? "YES" : "NO");
    console.error("🎯 MOJIFY Check '" + fullCommand + "':", hasEmoteWithColons ? "YES" : "NO");

    // Check if this emote exists in our mapping (try both formats)
    if (hasEmoteWithoutColons || hasEmoteWithColons) {
      // Determine which emote key to use for insertion
      const emoteKeyForInsertion = hasEmoteWithoutColons ? emoteName : fullCommand;

      console.error("✅ MOJIFY MATCH FOUND! Command:", fullCommand, "-> using key:", emoteKeyForInsertion);
      console.error("✅ MOJIFY STARTING REPLACEMENT PROCESS...");

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

console.error("✅ MOJIFY CONTENT SCRIPT FULLY LOADED");
console.error("✅ MOJIFY MULTIPLE INPUT LISTENERS ATTACHED");
debugLog("Mojify content script loaded");

// Add startup check and ensure emotes are loaded
setTimeout(() => {
  debugLog("=== STARTUP CHECK ===");
  debugLog("Current URL:", window.location.href);
  debugLog("EmoteMapping exists:", !!emoteMapping);
  debugLog("EmoteMapping keys count:", emoteMapping ? Object.keys(emoteMapping).length : 0);
  debugLog("First 5 emote keys:", emoteMapping ? Object.keys(emoteMapping).slice(0, 5) : []);

  // Test if we can detect messenger input
  const messengerInput = findMessengerInputField();
  debugLog("Messenger input found:", !!messengerInput);
  if (messengerInput) {
    debugLog("Messenger input type:", messengerInput.tagName, messengerInput.className);
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
