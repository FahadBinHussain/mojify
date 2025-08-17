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

// Debug mode
const DEBUG = true;

// Helper function to log debug messages
function debugLog(...args) {
  if (DEBUG) {
    console.log("[Mojify Debug]", ...args);
  }
}

// Load emote mapping from storage
chrome.storage.local.get(['emoteMapping'], (result) => {
  if (result.emoteMapping) {
    emoteMapping = result.emoteMapping;
    debugLog("Loaded emote mapping with", Object.keys(emoteMapping).length, "emotes");
  } else {
    debugLog("No emote mapping found in storage");
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.emoteMapping) {
    emoteMapping = changes.emoteMapping.newValue;
    debugLog("Updated emote mapping with", Object.keys(emoteMapping).length, "emotes");
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

            const cachedEmote = await emoteDB.getEmote(emoteTrigger);
            if (cachedEmote && cachedEmote.blob) {
                debugLog("Using cached blob from IndexedDB");
                blob = cachedEmote.blob;
                mimeType = cachedEmote.type || 'image/png';
            } else {
                debugLog("Downloading image data...");
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
let typedText = '';
const MAX_BUFFER = 30;

document.addEventListener('input', (event) => {
  const { target } = event;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
    if (event.data) {
      typedText += event.data;
    } else if (event.inputType === 'deleteContentBackward') {
      typedText = typedText.slice(0, -1);
    }
    if (typedText.length > MAX_BUFFER) {
      typedText = typedText.slice(-MAX_BUFFER);
    }

    const words = typedText.split(/\s+/);
    const lastWord = words[words.length - 1];

    if (emoteMapping && emoteMapping[lastWord]) {
      const emoteUrl = emoteMapping[lastWord];
      const emoteImg = `<img src="${emoteUrl}" alt="${lastWord}" style="height: 1.5em; vertical-align: middle;" />`;

      if (target.isContentEditable) {
        const range = window.getSelection().getRangeAt(0);
        range.setStart(range.startContainer, range.startOffset - lastWord.length);
        range.deleteContents();
        range.insertNode(range.createContextualFragment(emoteImg));
        range.collapse(false);
      } else {
        const value = target.value;
        const selectionStart = target.selectionStart;
        const newValue = value.slice(0, selectionStart - lastWord.length) + emoteImg + value.slice(selectionStart);
        target.value = newValue;
      }
      typedText = '';
    }
  }
});

debugLog("Mojify content script loaded");
