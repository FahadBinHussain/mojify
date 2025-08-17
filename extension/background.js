
const TWITCH_API_BASE_URL = "https://7tv.io/v3/users/twitch";

async function get7TVEmotes(channelId) {
  const url = `${TWITCH_API_BASE_URL}/${channelId}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    const emoteList = data.emote_set?.emotes || [];
    const username = data.user?.username || channelId;

    const emotes = {};
    emoteList.forEach(emote => {
      if (emote.name && emote.data) {
        const emoteKey = `:${emote.name}:`;
        emotes[emoteKey] = `https://${emote.data.host.url.replace(/^\/\//, '')}/${emote.data.host.files.slice(-1)[0].name}`;
      }
    });

    return {
      username,
      emotes
    };
  } catch (error) {
    console.error(`Error fetching emotes for ${channelId}:`, error);
    return { username: channelId, emotes: {} };
  }
}

async function downloadEmotes() {
  try {
    console.log("[DEBUG] Starting emote download with image data...");

    const { channelIds } = await chrome.storage.local.get(['channelIds']);
    console.log("[DEBUG] Retrieved channelIds from storage:", channelIds);

    if (!channelIds || channelIds.length === 0) {
      console.log("No channel IDs configured.");
      return { success: false, error: "No channel IDs configured" };
    }

    console.log("Downloading emotes with image data for channels:", channelIds);

    // New structure: each channel has its own emotes
    const channels = [];
    const globalEmoteMapping = {};
    const emoteImageData = {}; // Store actual image data
    let totalEmotesCount = 0;
    const channelEmotes = [];

    // First, collect all emote URLs
    console.log("[DEBUG] Getting emotes for each channel...");
    for (const channelId of channelIds) {
      console.log(`[DEBUG] Fetching emotes for channel: ${channelId}`);
      try {
        const result = await get7TVEmotes(channelId);
        console.log(`[DEBUG] Got result for ${channelId}:`, { username: result.username, emoteCount: Object.keys(result.emotes).length });

        channelEmotes.push({ channelId, username: result.username, emotes: result.emotes });
        totalEmotesCount += Object.keys(result.emotes).length;
      } catch (error) {
        console.error(`[DEBUG] Error fetching emotes for ${channelId}:`, error);
        // Continue with other channels
      }
    }

    console.log(`[DEBUG] Total emotes to download: ${totalEmotesCount}`);

    // Store download state in storage for popup to check
    await chrome.storage.local.set({
      downloadInProgress: true,
      downloadProgress: {
        current: 0,
        total: totalEmotesCount,
        currentEmote: null
      }
    });

    // Send initial progress
    try {
      chrome.runtime.sendMessage({
        type: 'downloadProgress',
        current: 0,
        total: totalEmotesCount,
        currentEmote: null
      });
    } catch (error) {
      console.log("[DEBUG] Could not send progress message (popup might be closed) - continuing download");
    }

    let globalDownloadedCount = 0;

    // Function to download a single emote
    async function downloadSingleEmote(key, url) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
          signal: controller.signal,
          method: 'GET'
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const blob = await response.blob();

          if (blob.size === 0) {
            throw new Error("Empty blob received");
          }

          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          return {
            key,
            success: true,
            data: {
              url: url,
              data: base64,
              type: blob.type,
              size: blob.size
            }
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        console.error(`[DEBUG] Failed to download ${key}:`, error.message);
        return {
          key,
          success: false,
          data: { url: url }
        };
      }
    }

    // Process downloads in batches
    async function processBatch(batch) {
      const results = await Promise.all(
        batch.map(async ({ key, url }) => {
          try {
            return await downloadSingleEmote(key, url);
          } catch (error) {
            console.warn(`[DEBUG] Failed to download ${key}:`, error.message);
            return {
              key,
              success: false,
              data: { url: url }
            };
          }
        })
      );
      return results;
    }

    // Download with concurrency
    const BATCH_SIZE = 20; // Download 20 emotes concurrently

    for (const { channelId, username, emotes } of channelEmotes) {
      console.log(`Processing channel: ${username} (${Object.keys(emotes).length} emotes)`);

      const emotesWithData = {};
      let downloadedCount = 0;

      // Create batches for concurrent processing
      const emoteEntries = Object.entries(emotes);
      const batches = [];

      for (let i = 0; i < emoteEntries.length; i += BATCH_SIZE) {
        batches.push(emoteEntries.slice(i, i + BATCH_SIZE).map(([key, url]) => ({ key, url })));
      }

      // Process batches
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const results = await processBatch(batch);

        // Process results
        for (const result of results) {
          if (result.success) {
            emotesWithData[result.key] = result.data;
            emoteImageData[result.key] = result.data;
            downloadedCount++;
          } else {
            emotesWithData[result.key] = result.data;
            emoteImageData[result.key] = result.data;
          }

          globalDownloadedCount++;

          // Update progress
          try {
            await chrome.storage.local.set({
              downloadProgress: {
                current: globalDownloadedCount,
                total: totalEmotesCount,
                currentEmote: result.key
              }
            });

            chrome.runtime.sendMessage({
              type: 'downloadProgress',
              current: globalDownloadedCount,
              total: totalEmotesCount,
              currentEmote: result.key
            });
          } catch (error) {
            console.log("[DEBUG] Could not send progress update");
          }
        }

        // Small delay between batches
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`Downloaded ${downloadedCount}/${emoteEntries.length} images for ${username}`);

      // Store channel info with emotes including image data
      channels.push({
        id: channelId,
        username: username,
        emotes: emotesWithData
      });

      // Also maintain a global mapping for backward compatibility
      Object.entries(emotesWithData).forEach(([key, emoteData]) => {
        globalEmoteMapping[key] = emoteData.url;
      });
    }

    // Store all data
    await chrome.storage.local.set({
      emoteMapping: globalEmoteMapping, // For backward compatibility (URLs only)
      channels: channels, // New structure with image data
      emoteImageData: emoteImageData // Global image data mapping
    });

    // Mark download as complete
    await chrome.storage.local.set({
      downloadInProgress: false,
      downloadProgress: {
        current: totalEmotesCount,
        total: totalEmotesCount,
        currentEmote: null,
        completed: true
      }
    });

    // Send final progress update
    try {
      chrome.runtime.sendMessage({
        type: 'downloadProgress',
        current: totalEmotesCount,
        total: totalEmotesCount,
        currentEmote: null,
        completed: true
      });
    } catch (error) {
      console.log("[DEBUG] Could not send final progress message - download still completed");
    }

    console.log("Emote mapping updated with image data. Total emotes:", Object.keys(emoteImageData).length);
    console.log("[DEBUG] Download completed successfully");
    return { success: true, totalEmotes: Object.keys(emoteImageData).length };

  } catch (error) {
    console.error("[DEBUG] Error in downloadEmotes:", error);

    // Mark download as failed in storage
    await chrome.storage.local.set({
      downloadInProgress: false,
      downloadProgress: {
        current: 0,
        total: 0,
        currentEmote: null,
        error: error.message
      }
    });

    return { success: false, error: error.message };
  }
}

// Function to insert emote into messenger.com
async function insertEmoteIntoMessenger(tabId, emoteUrl, emoteTrigger) {
  console.log(`[Mojify] Attempting to insert emote ${emoteTrigger} into tab ${tabId}`);

  try {
    // Execute script to directly insert emote using the new method
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: insertEmoteDirectly,
      args: [emoteUrl, emoteTrigger]
    });

    if (result && result[0] && result[0].result) {
      console.log(`[Mojify] Successfully inserted emote ${emoteTrigger}`);
      return { success: true };
    } else {
      throw new Error('Emote insertion failed');
    }
  } catch (error) {
    console.error("[Mojify] Error inserting emote:", error);
    return { success: false, error: error.message };
  }
}

// Injected function for direct emote insertion
function insertEmoteDirectly(emoteUrl, emoteTrigger) {
  console.log("Mojify: Inserting emote directly:", emoteTrigger, emoteUrl);

  // Find input fields using the same logic as content script
  function findMessengerInputFields() {
    const selectors = [
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="message" i]',
      'textarea[aria-label*="message" i]',
      'div[role="textbox"]',
      '.xzsf02u.x78zum5.xdt5ytf.x1iyjqo2.xs83m0k.x1xzczws',
      '.x1ed109x.x1orsw6y.x78zum5.x1q0g3np.x1a02dak.x1yrsyyn',
      '[role="textbox"][class*="x78zum5"]',
      'div[aria-label*="message"]',
      'textarea[placeholder*="Aa" i]',
      'textarea'
    ];

    const results = [];
    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        results.push(...elements);
      }
    });

    return results;
  }

  function insertTextDirectly(inputField, html) {
    if (inputField.isContentEditable) {
      if (window.getSelection && window.getSelection().rangeCount > 0) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        range.deleteContents();

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        while (tempDiv.firstChild) {
          range.insertNode(tempDiv.firstChild);
        }

        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        inputField.insertAdjacentHTML('beforeend', html);
      }
    } else if (inputField.tagName === 'TEXTAREA' || inputField.tagName === 'INPUT') {
      const textContent = html.replace(/<[^>]*>/g, '');
      const start = inputField.selectionStart;
      const end = inputField.selectionEnd;
      inputField.value = inputField.value.substring(0, start) + textContent + inputField.value.substring(end);
      inputField.selectionStart = inputField.selectionEnd = start + textContent.length;
    }
  }

  function positionCursorAtEnd(element) {
    if (element.isContentEditable) {
      element.focus();
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }

  // Find the active input field
  let activeElement = document.activeElement;

  if (!activeElement || !(activeElement.isContentEditable || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
    const inputFields = findMessengerInputFields();
    if (inputFields.length > 0) {
      activeElement = inputFields[inputFields.length - 1];
      activeElement.focus();
    }
  }

  if (activeElement) {
    // Create img HTML for the emote
    const imgHtml = `<img src="${emoteUrl}" alt="${emoteTrigger}" style="height: 1.5em; vertical-align: middle;" />`;

    // Focus the target element
    activeElement.focus();

    // Insert the emote directly
    insertTextDirectly(activeElement, imgHtml);
    positionCursorAtEnd(activeElement);

    console.log("Mojify: Emote inserted successfully");
    return true;
  } else {
    console.error("Mojify: No suitable input field found");
    return false;
  }
}

// Helper function to convert blob to data URL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
}

// Function to find and focus the input field on messenger.com
function findAndFocusInputField() {
  console.log("[Mojify] Finding input field");

  // Debug information about the page
  console.log("[Mojify] Page URL:", window.location.href);
  console.log("[Mojify] Document ready state:", document.readyState);

  // Messenger uses specific class names that may change, so we need to be flexible
  try {
    // Try multiple approaches to find the text field

    // Approach 1: Use Facebook's known class patterns (they use multiple classes)
    const messengerPatterns = [
      // Most recent class names for Messenger composer
      '.xzsf02u.x78zum5.xdt5ytf.x1iyjqo2.xs83m0k.x1xzczws',
      '.x1ed109x.x1orsw6y.x78zum5.x1q0g3np.x1a02dak.x1yrsyyn',
      '.x78zum5.x13a6bvl',
      // Common Facebook class patterns
      '[class*="xzsf02u"][class*="x1r8uery"]',
      '[class*="xjbqb8w"][class*="x76ihet"]',
      // More specific patterns based on recent Messenger DOM
      '[role="textbox"][class*="x78zum5"]',
      'div[role="textbox"][class*="x1ed109x"]',
      'div[aria-label*="message"]'
    ];

    // Try direct DOM traversal approach for Messenger's specific structure
    const chatContainer = document.querySelector('[role="main"]') ||
                         document.querySelector('[role="region"]') ||
                         document.querySelector('[data-pagelet="MWThreadHeader"]');

    if (chatContainer) {
      console.log("[Mojify] Found chat container");

      // Look for editable elements within the chat container
      const editables = chatContainer.querySelectorAll('[contenteditable="true"]');
      if (editables.length > 0) {
        // Most likely the last one is the input field
        const inputField = editables[editables.length - 1];
        console.log("[Mojify] Found input field via DOM traversal");
        inputField.focus();
        return true;
      }

      // Try to find the footer area that typically contains the composer
      const footer = document.querySelector('[role="complementary"]') ||
                    document.querySelector('[role="contentinfo"]') ||
                    chatContainer.querySelector('[role="form"]');

      if (footer) {
        console.log("[Mojify] Found footer area");

        // Look for contenteditable elements within the footer
        const footerEditables = footer.querySelectorAll('[contenteditable="true"]');
        if (footerEditables.length > 0) {
          const inputField = footerEditables[footerEditables.length - 1];
          console.log("[Mojify] Found input field in footer");
          inputField.focus();
          return true;
        }

        // Look for form elements that might contain the textbox
        const formElements = footer.querySelectorAll('[role="textbox"], textarea, input[type="text"]');
        if (formElements.length > 0) {
          formElements[formElements.length - 1].focus();
          console.log("[Mojify] Found form element in footer");
          return true;
        }
      }
    }

    // Try direct class patterns
    for (const pattern of messengerPatterns) {
      const elements = document.querySelectorAll(pattern);
      console.log(`[Mojify] Found ${elements.length} elements for pattern: ${pattern}`);

      if (elements.length > 0) {
        // Try to identify which one is the input field (prefer the visible ones)
        for (const el of elements) {
          if (el.offsetParent !== null &&
              (el.isContentEditable ||
               el.getAttribute('contenteditable') === 'true' ||
               el.role === 'textbox' ||
               el.getAttribute('role') === 'textbox')) {
            console.log("[Mojify] Found input field via class pattern");
            el.focus();
            return true;
          }
        }
      }
    }

    // Approach 2: Try role-based selection
    const roleSelectors = [
      '[role="textbox"]',
      '[contenteditable="true"]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="Aa" i]',  // Messenger often uses "Aa" as placeholder
      'textarea[aria-label*="message" i]',
      'textarea'
    ];

    for (const selector of roleSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`[Mojify] Found ${elements.length} elements for selector: ${selector}`);

      // Find visible elements within or near chat area
      if (elements.length > 0) {
        // First look for elements in a composer area
        for (const el of elements) {
          if (el.offsetParent !== null) { // Check if visible
            const isInComposer =
              el.closest('[role="form"]') ||
              el.closest('[role="complementary"]') ||
              el.closest('[role="region"]') ||
              el.closest('[role="main"]') ||
              el.closest('[aria-label*="conversation" i]');

            if (isInComposer) {
              console.log("[Mojify] Found input in composer via role");
              el.focus();
              return true;
            }
          }
        }

        // Fallback to first visible element
        for (const el of elements) {
          if (el.offsetParent !== null) {
            console.log("[Mojify] Found input via visibility check");
            el.focus();
            return true;
          }
        }
      }
    }

    // Approach 3: Search for elements by aria attributes often used in chat applications
    const ariaSelectors = [
      '[aria-label*="message" i]',
      '[aria-label*="type" i]',
      '[aria-label*="chat" i]',
      '[aria-label*="write" i]',
      '[placeholder*="message" i]',
      '[placeholder*="Aa" i]'
    ];

    for (const selector of ariaSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        for (const el of elements) {
          if (el.offsetParent !== null &&
              (el.tagName === 'INPUT' ||
               el.tagName === 'TEXTAREA' ||
               el.isContentEditable)) {
            console.log(`[Mojify] Found input via aria selector: ${selector}`);
            el.focus();
            return true;
          }
        }
      }
    }

    // Approach 4: Find by traditional CSS identifiers that may be used
    const cssSelectors = [
      '.public-DraftEditor-content',  // Draft.js editor
      '.notranslate',                 // Often used on contenteditable areas
      '.editor-container',
      '.message-input',
      '.chat-input'
    ];

    for (const selector of cssSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        for (const el of elements) {
          if (el.offsetParent !== null &&
              (el.isContentEditable ||
               el.querySelector('[contenteditable="true"]'))) {
            console.log(`[Mojify] Found input via CSS selector: ${selector}`);

            // Focus the element or its contenteditable child
            if (el.isContentEditable) {
              el.focus();
            } else {
              const editableChild = el.querySelector('[contenteditable="true"]');
              if (editableChild) editableChild.focus();
            }
            return true;
          }
        }
      }
    }

    console.log("[Mojify] No input field found, all approaches failed");
    return false;
  } catch (error) {
    console.error("[Mojify] Error finding input field:", error);
    return false;
  }
}

// Function to insert an image from a data URL
function insertImageFromDataUrl(dataUrl, altText) {
  console.log("[Mojify] Inserting image from data URL");

  try {
    // Create an image element
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = altText || '';
    img.style.height = '1.5em';
    img.style.verticalAlign = 'middle';

    // Try different insertion methods
    const activeElement = document.activeElement;

    if (!activeElement) {
      console.log("[Mojify] No active element");
      return false;
    }

    console.log("[Mojify] Active element:",
                activeElement.tagName,
                "ContentEditable:", activeElement.isContentEditable,
                "Attributes:",
                Array.from(activeElement.attributes).map(attr => `${attr.name}="${attr.value}"`).join(' '));

    // Method 1: Try execCommand (works in most browsers)
    if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
      console.log("[Mojify] Using execCommand method");
      const imgHtml = img.outerHTML;
      const result = document.execCommand('insertHTML', false, imgHtml);
      console.log("[Mojify] execCommand result:", result);

      // Trigger input event for Messenger to detect the change
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    // Method 2: Try clipboard API if available
    if (navigator.clipboard && navigator.clipboard.write) {
      console.log("[Mojify] Attempting to use clipboard API");
      try {
        // Insert a placeholder text that we can replace later
        const placeholder = `[${altText}]`;

        // For contentEditable elements
        if (activeElement.isContentEditable) {
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const placeholderNode = document.createTextNode(placeholder);
            range.insertNode(placeholderNode);

            // Trigger input event
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            console.log("[Mojify] Inserted placeholder text");
            return true;
          }
        }
        // For input/textarea elements
        else if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
          const pos = activeElement.selectionStart;
          activeElement.value =
            activeElement.value.slice(0, pos) +
            placeholder +
            activeElement.value.slice(pos);

          // Update cursor position
          activeElement.selectionStart = activeElement.selectionEnd = pos + placeholder.length;

          // Trigger input event
          activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          console.log("[Mojify] Inserted placeholder in input/textarea");
          return true;
        }
      } catch (clipErr) {
        console.error("[Mojify] Clipboard API error:", clipErr);
      }
    }

    // Method 3: Fallback to Selection API
    console.log("[Mojify] Using Selection API fallback");

    if (activeElement.isContentEditable) {
      const selection = window.getSelection();

      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);

        // For Messenger, sometimes we need to clear any selections first
        try {
          range.deleteContents();
        } catch (e) {
          console.log("[Mojify] Could not delete contents:", e);
        }

        try {
          // Insert node
          range.insertNode(img);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);

          // Trigger input event
          activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          console.log("[Mojify] Inserted image using Selection API");
          return true;
        } catch (rangeErr) {
          console.error("[Mojify] Range insertion error:", rangeErr);
        }
      } else {
        console.log("[Mojify] No selection range");

        // Try to create a range
        try {
          const newRange = document.createRange();
          newRange.selectNodeContents(activeElement);
          newRange.collapse(false);

          // Insert at the end
          newRange.insertNode(img);
          selection.removeAllRanges();
          selection.addRange(newRange);

          // Trigger input event
          activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          console.log("[Mojify] Created new range and inserted image");
          return true;
        } catch (newRangeErr) {
          console.error("[Mojify] New range error:", newRangeErr);
        }
      }
    }

    // Last resort - just try to add it to the innerHTML
    try {
      if (activeElement.isContentEditable) {
        const currentHtml = activeElement.innerHTML;
        activeElement.innerHTML = currentHtml + img.outerHTML;

        // Trigger input event
        activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        console.log("[Mojify] Added to innerHTML");
        return true;
      }
    } catch (innerErr) {
      console.error("[Mojify] innerHTML error:", innerErr);
    }

    console.log("[Mojify] All insertion methods failed");
    return false;
  } catch (error) {
    console.error("[Mojify] Error inserting image:", error);
    return false;
  }
}

// Function to simulate paste operation using Chrome debugger API
// Removed simulatePasteWithDebugger - using direct insertion instead

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "downloadEmotes",
    title: "Download Emotes",
    contexts: ["action"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "downloadEmotes") {
    downloadEmotes();
  }
});

// Add a listener for paste action requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle downloading emotes
  if (request.type === 'downloadEmotes') {
    downloadEmotes()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Indicates that the response is sent asynchronously
  }

  // Handle emote insertion
  if (request.type === 'insertEmote') {
    const { tabId, emoteUrl, emoteTrigger } = request;

    insertEmoteIntoMessenger(tabId, emoteUrl, emoteTrigger)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message || 'Unknown error'
      }));

    return true; // Indicates that the response is sent asynchronously
  }

  // Handle paste action
  if (request.action === "paste") {
    const tabId = sender.tab.id;
    if (!tabId) {
      console.error("[Mojify] Paste action failed: Could not get sender tab ID.");
      sendResponse({ success: false, error: "No tab ID" });
      return true;
    }

    simulatePasteWithDebugger(tabId)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true; // Indicates that the response is sent asynchronously
  }
});

// Add storage change listener to automatically download emotes when channel IDs are saved
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.channelIds) {
    const newChannelIds = changes.channelIds.newValue;
    const oldChannelIds = changes.channelIds.oldValue;

    // Check if channel IDs actually changed
    if (JSON.stringify(newChannelIds) !== JSON.stringify(oldChannelIds)) {
      console.log("[Mojify] Channel IDs changed:", {
        old: oldChannelIds,
        new: newChannelIds
      });

      // If channel IDs were cleared or set to empty
      if (!newChannelIds || newChannelIds.length === 0) {
        console.log("[Mojify] Channel IDs cleared, cleaning up storage");

        // Clear all emote-related data
        chrome.storage.local.remove([
          'emoteMapping',
          'channels',
          'emoteImageData',
          'downloadInProgress',
          'downloadProgress'
        ]).then(() => {
          console.log("[Mojify] Storage cleaned up successfully");
        }).catch((error) => {
          console.error("[Mojify] Error cleaning up storage:", error);
        });
      }
      // If new channel IDs were added
      else if (newChannelIds.length > 0) {
        console.log("[Mojify] New channel IDs detected, automatically starting download:", newChannelIds);

        // Notify popup that automatic download is starting
        try {
          chrome.runtime.sendMessage({
            type: 'automaticDownloadStarted',
            channelIds: newChannelIds
          });
        } catch (error) {
          console.log("[Mojify] Could not send automatic download notification (popup might be closed)");
        }

        // Start download automatically
        downloadEmotes().then((result) => {
          if (result.success) {
            console.log("[Mojify] Automatic download completed successfully");
          } else {
            console.error("[Mojify] Automatic download failed:", result.error);
          }
        }).catch((error) => {
          console.error("[Mojify] Automatic download error:", error);
        });
      }
    }
  }
});
