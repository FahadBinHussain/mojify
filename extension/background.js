const TWITCH_API_BASE_URL = "https://7tv.io/v3/users/twitch";

// IndexedDB wrapper for emote storage
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
        console.log('[IndexedDB] Database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create emotes object store
        if (!db.objectStoreNames.contains('emotes')) {
          const emotesStore = db.createObjectStore('emotes', { keyPath: 'key' });
          emotesStore.createIndex('channel', 'channel', { unique: false });
          emotesStore.createIndex('url', 'url', { unique: false });
          console.log('[IndexedDB] Created emotes object store');
        }
      };
    });
  },

  async storeEmote(key, url, blob, metadata = {}) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emotes'], 'readwrite');
      const store = transaction.objectStore('emotes');

      const emoteData = {
        key: key,
        url: url,
        blob: blob,
        type: blob.type,
        size: blob.size,
        timestamp: Date.now(),
        ...metadata
      };

      const request = store.put(emoteData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
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
  },

  async getAllEmotes() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emotes'], 'readonly');
      const store = transaction.objectStore('emotes');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async deleteEmote(key) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emotes'], 'readwrite');
      const store = transaction.objectStore('emotes');
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async clearAll() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emotes'], 'readwrite');
      const store = transaction.objectStore('emotes');
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};

async function get7TVEmotes(channelId) {
  const url = `${TWITCH_API_BASE_URL}/${channelId}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mojify Extension/1.0'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const emoteList = data.emote_set?.emotes || [];
    const username = data.user?.username || data.user?.display_name || channelId;

    const emotes = {};
    emoteList.forEach((emote, index) => {
      try {
        if (emote.name && emote.data && emote.data.host) {
          const emoteKey = `:${emote.name}:`;
          const hostUrl = emote.data.host.url.replace(/^\/\//, '');
          const files = emote.data.host.files;
          if (files && files.length > 0) {
            const fileName = files[files.length - 1].name;
            emotes[emoteKey] = `https://${hostUrl}/${fileName}`;
          }
        }
      } catch (emoteError) {
        console.warn(`[DEBUG] Error processing emote ${emote.name}:`, emoteError);
      }
    });

    console.log(`[DEBUG] Successfully processed ${Object.keys(emotes).length} emotes for ${username}`);
    return {
      username,
      emotes
    };
  } catch (error) {
    console.error(`[DEBUG] Error fetching emotes for ${channelId}:`, error);
    if (error.name === 'AbortError') {
      console.error(`[DEBUG] Request timeout for ${channelId}`);
    }
    return { username: channelId, emotes: {} };
  }
}

// Simple download state tracking
let downloadState = {
  isDownloading: false,
  current: 0,
  total: 0,
  startTime: null
};

async function downloadEmotes() {
  // Check if already downloading
  if (downloadState.isDownloading) {
    console.log("[Download] Already downloading, skipping");
    return { success: false, error: "Download already in progress" };
  }

  try {
    downloadState.isDownloading = true;
    downloadState.startTime = Date.now();

    console.log("[Download] Starting emote download");

    const { channelIds } = await chrome.storage.local.get(['channelIds']);
    if (!channelIds || channelIds.length === 0) {
      downloadState.isDownloading = false;
      return { success: false, error: "No channel IDs configured" };
    }

    // INCREMENTAL DOWNLOAD LOGIC:
    // 1. Get existing downloaded emotes from local storage
    // 2. Compare with server emotes to find what's missing
    // 3. Only download new/missing emotes (not re-download existing ones)

    // Initialize IndexedDB
    if (!emoteDB.db) {
      await emoteDB.init();
    }

    // Get existing data from chrome.storage (metadata only) and IndexedDB (images)
    const existing = await chrome.storage.local.get(['emoteMapping', 'channels']);
    const globalEmoteMapping = existing.emoteMapping || {};
    const channels = existing.channels || [];

    // Get existing emotes from IndexedDB
    const existingEmotes = await emoteDB.getAllEmotes();
    const existingEmoteKeys = new Set(existingEmotes.map(e => e.key));

    // Collect only NEW emotes that need downloading
    let totalNewEmotes = 0;
    const channelEmotes = [];

    for (const channelId of channelIds) {
      const trimmedChannelId = channelId.trim();
      if (!trimmedChannelId) continue;

      try {
        const result = await get7TVEmotes(trimmedChannelId);
        if (Object.keys(result.emotes).length > 0) {
          // INCREMENTAL CHECK: Compare server emotes vs locally stored emotes
          // Only include emotes that are either:
          // - Not in local storage at all (!emoteImageData[key])
          // - In storage but failed to download properly (!emoteImageData[key].data)
          const newEmotes = {};
          Object.entries(result.emotes).forEach(([key, url]) => {
            if (!existingEmoteKeys.has(key)) {
              newEmotes[key] = url;
            }
          });

          if (Object.keys(newEmotes).length > 0) {
            channelEmotes.push({
              channelId: trimmedChannelId,
              username: result.username,
              emotes: newEmotes,
              allEmotes: result.emotes
            });
            totalNewEmotes += Object.keys(newEmotes).length;
          }

          // Update channel in existing channels or add new
          const existingChannelIndex = channels.findIndex(ch => ch.id === trimmedChannelId);
          if (existingChannelIndex >= 0) {
            channels[existingChannelIndex] = {
              id: trimmedChannelId,
              username: result.username,
              emotes: result.emotes
            };
          } else {
            channels.push({
              id: trimmedChannelId,
              username: result.username,
              emotes: result.emotes
            });
          }
        }
      } catch (error) {
        console.error(`[Download] Error fetching emotes for ${trimmedChannelId}:`, error);
      }
    }

    downloadState.total = totalNewEmotes;
    downloadState.current = 0;

    if (totalNewEmotes === 0) {
      console.log("[Download] No new emotes to download - all emotes already cached locally");
      downloadState.isDownloading = false;
      await chrome.storage.local.set({ channels, downloadInProgress: false });
      const allEmotes = await emoteDB.getAllEmotes();
      return { success: true, totalEmotes: allEmotes.length, message: "All emotes up to date" };
    }

    console.log(`[Download] Found ${totalNewEmotes} new emotes to download (skipping ${existingEmotes.length} already cached)`);

    // Set download progress
    await chrome.storage.local.set({
      downloadInProgress: true,
      downloadProgress: {
        current: 0,
        total: totalNewEmotes,
        currentEmote: null
      }
    });

    // Download new emotes with failed emote retry queue
    const failedQueue = [];

    // First pass: download all emotes, add failures to queue
    for (const channelData of channelEmotes) {
      console.log(`[Download] Processing ${channelData.username}: ${Object.keys(channelData.emotes).length} new emotes`);

      for (const [key, url] of Object.entries(channelData.emotes)) {
        try {
          // Use manual timeout that's more tolerant of browser state changes
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, 20000); // 20 second timeout for first attempt

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const blob = await response.blob();
            if (blob.size > 0) {
              // Store blob directly in IndexedDB (no base64 conversion needed)
              await emoteDB.storeEmote(key, url, blob, {
                channel: channelData.username,
                channelId: channelData.channelId
              });

              globalEmoteMapping[key] = url;
              console.log(`[Download] Stored ${key} in IndexedDB (${blob.size} bytes)`);
            } else {
              throw new Error("Empty blob received");
            }
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (error) {
          // Add to failed queue for retry later
          failedQueue.push({ key, url, channel: channelData.username, error: error.message });
          console.log(`[Download] Added ${key} to retry queue (${error.message})`);
        }

        downloadState.current++;

        // Update progress every 5 emotes (only store URL mapping, not image data)
        if (downloadState.current % 5 === 0) {
          await chrome.storage.local.set({
            emoteMapping: globalEmoteMapping,
            downloadProgress: {
              current: downloadState.current,
              total: downloadState.total,
              currentEmote: key
            }
          });

          try {
            chrome.runtime.sendMessage({
              type: 'downloadProgress',
              current: downloadState.current,
              total: downloadState.total,
              currentEmote: key,
              newEmote: key
            });
          } catch (e) {
            // Popup is closed, continue silently
          }
        }

        // Small delay to prevent overwhelming
        if (downloadState.current % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }

    // Second pass: retry failed emotes
    if (failedQueue.length > 0) {
      console.log(`[Download] Retrying ${failedQueue.length} failed emotes...`);

      for (const { key, url, channel } of failedQueue) {
        try {
          // Longer timeout for retry attempts
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, 30000); // 30 second timeout for retries

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const blob = await response.blob();
            if (blob.size > 0) {
              // Store successful retry in IndexedDB
              await emoteDB.storeEmote(key, url, blob, {
                channel: channel,
                retried: true
              });

              globalEmoteMapping[key] = url;
              console.log(`[Download] Successfully retried ${key}`);
            }
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (error) {
          // Final failure - just store URL mapping
          globalEmoteMapping[key] = url;
          console.log(`[Download] Final failure for ${key}: ${error.message}`);
        }

        // Longer delay between retry attempts
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`[Download] Completed retry queue processing`);
    }

    // Final storage update (images are now in IndexedDB, only store metadata)
    await chrome.storage.local.set({
      emoteMapping: globalEmoteMapping,
      channels: channels,
      downloadInProgress: false,
      downloadProgress: {
        current: downloadState.total,
        total: downloadState.total,
        completed: true
      }
    });

    downloadState.isDownloading = false;

    try {
      chrome.runtime.sendMessage({
        type: 'downloadProgress',
        current: downloadState.total,
        total: downloadState.total,
        completed: true
      });
    } catch (e) {
      // Popup is closed, continue silently
    }

    // Get final count from IndexedDB
    const allEmotes = await emoteDB.getAllEmotes();
    console.log(`[Download] Completed! Downloaded ${totalNewEmotes} new emotes. Total stored: ${allEmotes.length}`);
    return { success: true, totalEmotes: allEmotes.length };

  } catch (error) {
    console.error("[Download] Error:", error);
    downloadState.isDownloading = false;

    await chrome.storage.local.set({
      downloadInProgress: false,
      downloadProgress: { error: error.message }
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

// Storage change listener for automatic downloads
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.channelIds) {
    const oldChannelIds = changes.channelIds.oldValue || [];
    const newChannelIds = changes.channelIds.newValue || [];

    console.log('[Auto-Download] Channel IDs changed:', { old: oldChannelIds, new: newChannelIds });

    // If channelIds were cleared, clean up storage
    if (newChannelIds.length === 0 && oldChannelIds.length > 0) {
      console.log('[Auto-Download] Channel IDs cleared, cleaning up storage');
      try {
        await emoteDB.clearAll();
        await chrome.storage.local.remove(['channels', 'emoteMapping', 'downloadInProgress', 'downloadProgress']);

        // Notify popup
        try {
          chrome.runtime.sendMessage({
            type: 'showToast',
            message: 'Channel IDs cleared - storage cleaned up',
            toastType: 'success'
          });
        } catch (e) {
          // Popup closed, continue silently
        }
      } catch (error) {
        console.error('[Auto-Download] Error cleaning up storage:', error);
      }
      return;
    }

    // If channelIds were added/changed and not empty, start automatic download
    if (newChannelIds.length > 0) {
      console.log('[Auto-Download] Starting automatic download for channel IDs:', newChannelIds);

      // Notify popup that automatic download is starting
      try {
        chrome.runtime.sendMessage({
          type: 'automaticDownloadStarted',
          channelIds: newChannelIds
        });
      } catch (e) {
        // Popup closed, continue silently
      }

      // Start download in background
      try {
        const result = await downloadEmotes();

        // Notify popup of completion
        try {
          chrome.runtime.sendMessage({
            type: 'showToast',
            message: result.success ?
              `Emotes downloaded successfully (${result.totalEmotes} total)` :
              `Download failed: ${result.error}`,
            toastType: result.success ? 'success' : 'error'
          });
        } catch (e) {
          // Popup closed, continue silently
        }
      } catch (error) {
        console.error('[Auto-Download] Error during automatic download:', error);

        try {
          chrome.runtime.sendMessage({
            type: 'showToast',
            message: `Automatic download failed: ${error.message}`,
            toastType: 'error'
          });
        } catch (e) {
          // Popup closed, continue silently
        }
      }
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "downloadEmotes",
      title: "Download Emotes",
      contexts: ["action"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "downloadEmotes") {
    downloadEmotes();
  }
});

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle downloading emotes
  if (request.type === 'downloadEmotes') {
    downloadEmotes()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  // Handle emote insertion
  if (request.type === 'insertEmote') {
    insertEmoteIntoMessenger(sender.tab.id, request.emoteUrl, request.emoteTrigger)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});



// Storage change listener for automatic downloads
chrome.storage.onChanged.addListener((changes, area) => {
  console.log("[Mojify] Storage changed:", { area, changes: Object.keys(changes) });

  if (area === 'local' && changes.channelIds) {
    const newChannelIds = changes.channelIds.newValue;
    const oldChannelIds = changes.channelIds.oldValue;

    console.log("[Mojify] Channel IDs storage change detected:", {
      oldValue: oldChannelIds,
      newValue: newChannelIds,
      oldStringified: JSON.stringify(oldChannelIds),
      newStringified: JSON.stringify(newChannelIds)
    });

    // Check if channel IDs actually changed
    if (JSON.stringify(newChannelIds) !== JSON.stringify(oldChannelIds)) {
      console.log("[Mojify] Channel IDs changed, processing...");

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
          console.log("[Mojify] Sent automatic download notification to popup");
        } catch (error) {
          console.log("[Mojify] Could not send automatic download notification (popup might be closed):", error.message);
        }

        // Add a small delay to ensure storage is fully committed
        setTimeout(() => {
          console.log("[Mojify] Starting automatic download after delay...");

          // Start download automatically
          downloadEmotes().then((result) => {
            console.log("[Mojify] Download result:", result);
            if (result.success) {
              console.log("[Mojify] Automatic download completed successfully, total emotes:", result.totalEmotes);
            } else {
              console.error("[Mojify] Automatic download failed:", result.error);
            }
          }).catch((error) => {
            console.error("[Mojify] Automatic download error:", error);
            console.error("[Mojify] Error stack:", error.stack);
          });
        }, 100);
      }
    } else {
      console.log("[Mojify] Channel IDs did not actually change (same JSON), skipping download");
    }
  } else {
    console.log("[Mojify] Storage change not for channelIds or not local area");
  }
});

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle downloading emotes
  if (request.type === 'downloadEmotes') {
    downloadEmotes()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  // Handle emote insertion
  if (request.type === 'insertEmote') {
    insertEmoteIntoMessenger(sender.tab.id, request.emoteUrl, request.emoteTrigger)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});
