let emoteMapping = {};
let emoteImageData = {};

// Debug mode
const DEBUG = true;

// Helper function to log debug messages
function debugLog(...args) {
  if (DEBUG) {
    console.log("[Mojify Debug]", ...args);
  }
}

// Load emote mapping from storage
chrome.storage.local.get(['emoteMapping', 'emoteImageData'], (result) => {
  if (result.emoteMapping) {
    emoteMapping = result.emoteMapping;
    debugLog("Loaded emote mapping with", Object.keys(emoteMapping).length, "emotes");
  } else {
    debugLog("No emote mapping found in storage");
  }

  if (result.emoteImageData) {
    emoteImageData = result.emoteImageData;
    debugLog("Loaded emote image data with", Object.keys(emoteImageData).length, "emotes");
  } else {
    debugLog("No emote image data found in storage");
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.emoteMapping) {
    emoteMapping = changes.emoteMapping.newValue;
    debugLog("Updated emote mapping with", Object.keys(emoteMapping).length, "emotes");
  }
  if (changes.emoteImageData) {
    emoteImageData = changes.emoteImageData.newValue;
    debugLog("Updated emote image data with", Object.keys(emoteImageData).length, "emotes");
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

        // Check if we have cached image data
        let blob;
        let mimeType;

        if (emoteImageData[emoteTrigger] && emoteImageData[emoteTrigger].data) {
            debugLog("Using cached image data");
            const cachedData = emoteImageData[emoteTrigger];
            const base64Response = await fetch(cachedData.data);
            blob = await base64Response.blob();
            mimeType = cachedData.type || 'image/png';
        } else {
            debugLog("Downloading image data...");
            const response = await fetch(emoteUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch emote: ${response.status}`);
            }
            blob = await response.blob();
            mimeType = blob.type || 'image/png';

            // Cache for future use
            try {
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                emoteImageData[emoteTrigger] = {
                    url: emoteUrl,
                    data: base64,
                    type: mimeType,
                    size: blob.size
                };

                // Update storage
                chrome.storage.local.get(['emoteImageData'], (result) => {
                    const currentData = result.emoteImageData || {};
                    currentData[emoteTrigger] = emoteImageData[emoteTrigger];
                    chrome.storage.local.set({ emoteImageData: currentData });
                });

                debugLog("Cached image data");
            } catch (error) {
                debugLog("Could not cache image:", error);
            }
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
