
let emoteMapping = {};

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

let typedText = '';
const MAX_BUFFER = 30;

// Find all potential messenger.com input fields
function findMessengerInputFields() {
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[placeholder*="message" i]',
    'textarea[aria-label*="message" i]',
    'div[role="textbox"]',
    // Additional messenger-specific selectors
    '.xzsf02u.x78zum5.xdt5ytf.x1iyjqo2.xs83m0k.x1xzczws', // Latest Messenger composer class
    '.x1ed109x.x1orsw6y.x78zum5.x1q0g3np.x1a02dak.x1yrsyyn', // Alternative Messenger composer
    '[role="textbox"][class*="x78zum5"]',
    'div[aria-label*="message"]',
    'textarea[placeholder*="Aa" i]', // Messenger's typical placeholder
    'textarea'
  ];
  
  const results = [];
  selectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      results.push(...elements);
      debugLog(`Found ${elements.length} elements matching selector: ${selector}`);
    }
  });
  
  // If we still don't have results, try looking in specific containers
  if (results.length === 0) {
    const containers = [
      document.querySelector('[role="main"]'),
      document.querySelector('[role="region"]'),
      document.querySelector('[role="complementary"]'),
      document.querySelector('[aria-label*="conversation" i]')
    ].filter(Boolean);
    
    containers.forEach(container => {
      const editables = container.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]');
      if (editables.length > 0) {
        results.push(...editables);
        debugLog(`Found ${editables.length} editable elements in container`);
      }
    });
  }
  
  return results;
}

// Handle emote insertion from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog("Received message:", request);
  
  if (request.action === 'insertEmote') {
    const emoteTrigger = request.emoteTrigger;
    debugLog("Attempting to insert emote:", emoteTrigger);
    
    // Check if we're on messenger.com
    const isOnMessenger = window.location.href.includes('messenger.com');
    debugLog("Is on messenger.com:", isOnMessenger);
    
    if (!isOnMessenger) {
      sendResponse({ success: false, error: 'Not on messenger.com' });
      return true;
    }
    
    if (!emoteMapping || !emoteMapping[emoteTrigger]) {
      debugLog("Emote not found in mapping:", emoteTrigger);
      sendResponse({ success: false, error: 'Emote not found in mapping' });
      return true;
    }
    
    try {
      const emoteUrl = emoteMapping[emoteTrigger];
      debugLog("Emote URL:", emoteUrl);
      
      // Find the active input field on messenger.com
      let activeElement = document.activeElement;
      debugLog("Active element:", activeElement);
      
      // If no active element or not the right type, try to find the message input
      if (!activeElement || !(activeElement.isContentEditable || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
        debugLog("No valid active element, searching for input fields...");
        
        const inputFields = findMessengerInputFields();
        debugLog("Found input fields:", inputFields);
        
        if (inputFields.length > 0) {
          // Use the last one as it's likely the main chat input
          activeElement = inputFields[inputFields.length - 1];
          debugLog("Selected input field:", activeElement);
          activeElement.focus();
        } else {
          debugLog("No suitable input fields found");
        }
      }
      
      if (activeElement) {
        debugLog("Using active element:", activeElement);
        
        // Just request paste simulation from background script
        chrome.runtime.sendMessage({
          type: 'insertEmote',
          emoteUrl: emoteUrl,
          emoteTrigger: emoteTrigger
        }, (response) => {
          debugLog("Background response:", response);
          sendResponse(response);
        });
        
        return true; // Async response
      } else {
        debugLog("No active element found after all attempts");
        sendResponse({ success: false, error: 'No input field found' });
        return true;
      }
    } catch (error) {
      console.error('Mojify Error:', error);
      debugLog("Error inserting emote:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }
  return false;
});

// Automatically replace emote codes as user types
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