// Early exit check for unsupported sites
(function() {
  const hostname = window.location.hostname;
  const supportedSites = [
    'messenger.com',
    'discord.com',
    'discordapp.com',
    'facebook.com',
    'telegram.org',
    'web.whatsapp.com'
  ];

  const isSupported = supportedSites.some(site => hostname.includes(site));
  if (!isSupported) {
    // Silently exit without loading Mojify on unsupported sites
    return;
  }

  // Error handling function
  function handleRuntimeError(context, error) {
    if (error.message && error.message.includes('chrome://')) {
      // Silently handle chrome:// URL errors
      return;
    }
    if (error.message && error.message.includes('edge://')) {
      // Silently handle edge:// URL errors
      return;
    }
    // Log other errors normally
    debugLog(`Error in ${context}:`, error);
  }

  // Content script loaded on supported platform

  let emoteMapping = {};

  // Discord-specific variables for text interceptor
  let discordState = 'NORMAL'; // 'NORMAL' or 'INTERCEPTING'
  let discordBuffer = '';
  let discordMinibar = null;
  let discordEditor = null;

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

try {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.emoteMapping) {
      emoteMapping = changes.emoteMapping.newValue;
      debugLog("Updated emote mapping with", Object.keys(emoteMapping).length, "emotes");
      debugLog("Updated sample emotes:", Object.keys(emoteMapping).slice(0, 5));
    }
  });
} catch (error) {
  handleRuntimeError("storage listener setup", error);
}

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
    ],
    telegram: [
        'div[contenteditable="true"].input-message-input',
        '.input-message-input[contenteditable="true"]',
        'div[contenteditable="true"][data-entity-type="messageEntityMention"]',
        '.input-field-input[contenteditable="true"]',
        'div[contenteditable="true"].composer-input',
        '[contenteditable="true"][placeholder*="Message"]',
        '[contenteditable="true"][class*="input"]',
        'div[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]'
    ],
    whatsapp: [
        'div[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][role="textbox"][data-tab="10"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        '[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][class*="textInput"]',
        'div[contenteditable="true"][class*="input"]',
        'div[contenteditable="true"][spellcheck="true"]',
        'div[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]'
    ]
};

// Detect current platform
function getCurrentPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('messenger.com')) return 'messenger';
    if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) return 'discord';
    if (hostname.includes('facebook.com')) return 'facebook';
    if (hostname.includes('web.telegram.org') || hostname.includes('telegram.org')) return 'telegram';
    if (hostname.includes('web.whatsapp.com')) return 'whatsapp';
    return null;
}

// Discord-specific text interceptor functions
function findReactProps(dom) {
    const key = Object.keys(dom).find(key => key.startsWith('__reactFiber$'));
    if (!key) return null;
    let fiber = dom[key];
    while (fiber) {
        if (fiber.memoizedProps && typeof fiber.memoizedProps.setQuery === 'function') {
            return fiber.memoizedProps;
        }
        fiber = fiber.return;
    }
    return null;
}

function createDiscordMinibar() {
    if (document.getElementById('discord-text-interceptor-minibar')) {
        return document.getElementById('discord-text-interceptor-minibar');
    }

    const bar = document.createElement('div');
    bar.id = 'discord-text-interceptor-minibar';
    bar.style.cssText = `
        position: absolute;
        background-color: #2b2d31;
        color: #dbdee1;
        border: 1px solid #1e1f22;
        padding: 4px 8px;
        border-radius: 4px;
        font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 1rem;
        z-index: 9999;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.1s ease-in-out;
    `;
    document.body.appendChild(bar);
    return bar;
}

function updateDiscordMinibar() {
    if (!discordMinibar) return;

    if (discordState === 'INTERCEPTING') {
        discordMinibar.textContent = discordBuffer;
        discordMinibar.style.opacity = '1';

        if (discordEditor) {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                discordMinibar.style.left = `${rect.left + window.scrollX}px`;
                discordMinibar.style.top = `${rect.top + window.scrollY - discordMinibar.offsetHeight - 4}px`;
            }
        }

        // Trigger emote suggestions based on the buffer
        if (discordBuffer.length > 1) {
            const query = discordBuffer.substring(1); // Remove the ':'
            debugLog("Discord interceptor showing suggestions for query:", query);
            showDiscordEmoteSuggestions(query);
        }
    } else {
        discordMinibar.style.opacity = '0';
        hideDiscordSuggestions();
    }
}

function flushDiscordBuffer() {
    if (!discordEditor) return;

    const props = findReactProps(discordEditor);
    if (props && discordBuffer.length > 0) {
        props.setQuery(props.query + discordBuffer);
    }
    resetDiscordState();
}

function resetDiscordState() {
    discordState = 'NORMAL';
    discordBuffer = '';
    updateDiscordMinibar();
    hideDiscordSuggestions();
}

function setupDiscordTextInterceptor() {
    console.log("[Mojify] Discord text interceptor v1.0 loaded. Waiting for editor.");

    const bodyObserver = new MutationObserver(() => {
        const editor = document.querySelector('div[role="textbox"][data-slate-editor="true"]');
        if (editor && !editor.dataset.mojifyAttached) {
            editor.dataset.mojifyAttached = 'true';
            discordEditor = editor;
            discordMinibar = createDiscordMinibar();
            console.log("%c[Mojify] Discord editor found! Attaching text interceptor.", "color: green; font-weight: bold;");

            editor.addEventListener('keydown', (event) => {
                if (discordState === 'NORMAL') {
                    if (event.key === ':') {
                        event.preventDefault();
                        discordState = 'INTERCEPTING';
                        discordBuffer = ':';
                        updateDiscordMinibar();
                    }
                    return;
                }

                if (discordState === 'INTERCEPTING') {
                    // Handle double colon case
                    if (discordBuffer === ':' && event.key === ':') {
                        console.log("[Mojify] Double colon detected. Flushing and allowing pass-through.");
                        flushDiscordBuffer();
                        return;
                    }

                    event.preventDefault();

                    switch (event.key) {
                        case 'Backspace':
                            discordBuffer = discordBuffer.slice(0, -1);
                            if (discordBuffer.length === 0) {
                                resetDiscordState();
                            } else {
                                updateDiscordMinibar();
                            }
                            break;

                        case 'Enter':
                        case ' ':
                        case 'Tab':
                            flushDiscordBuffer();
                            const props = findReactProps(editor);
                            if (props) props.setQuery(props.query + event.key);
                            break;

                        case 'Escape':
                            resetDiscordState();
                            break;

                        default:
                            if (event.key.length === 1) {
                                discordBuffer += event.key;
                                updateDiscordMinibar();
                            }
                            break;
                    }
                }
            }, true);

            editor.addEventListener('blur', () => {
                if (discordState === 'INTERCEPTING') {
                    flushDiscordBuffer();
                }
            }, true);

            bodyObserver.disconnect();
        }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
}

// Discord-specific emote suggestion functions
function showDiscordEmoteSuggestions(query) {
    debugLog("showDiscordEmoteSuggestions called with query:", query);
    const suggestionBar = document.getElementById('mojify-suggestion-bar') || createEmoteSuggestionBar();
    const emoteList = document.getElementById('mojify-emote-list');

    if (!emoteMapping || Object.keys(emoteMapping).length === 0) {
        debugLog("No emote mapping available for Discord suggestions");
        hideDiscordSuggestions();
        return;
    }

    // Filter emotes based on query
    const filteredEmotes = Object.keys(emoteMapping).filter(key => {
        const cleanKey = key.replace(/:/g, '').toLowerCase();
        const cleanQuery = query.toLowerCase();
        return cleanKey.includes(cleanQuery);
    }).slice(0, 6); // Limit to 6 suggestions

    if (filteredEmotes.length === 0) {
        debugLog("No filtered emotes found for query:", query);
        hideDiscordSuggestions();
        return;
    }

    debugLog("Found filtered emotes:", filteredEmotes);

    // Clear previous suggestions
    emoteList.innerHTML = '';

    // Add emote suggestions
    filteredEmotes.forEach((emoteKey, index) => {
        const emoteItem = document.createElement('div');
        emoteItem.style.cssText = `
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 6px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            flex-shrink: 0;
            min-width: 56px;
        `;

        // First set fallback text
        emoteItem.textContent = emoteKey.replace(/:/g, '');
        emoteItem.style.fontSize = '12px';
        emoteItem.style.color = '#b9bbbe';

        debugLog("Discord suggestions: Loading emote", emoteKey);

        // Try to get cached emote for preview
        emoteDB.getEmote(emoteKey).then(result => {
            debugLog("Discord suggestions: Emote result for", emoteKey, result ? "found" : "not found");
            if (result) {
                let imageUrl;

                // Check if result is already a blob URL or base64 data URL
                if (typeof result === 'string') {
                    if (result.startsWith('blob:') || result.startsWith('data:')) {
                        imageUrl = result;
                    } else {
                        // Assume it's a regular URL
                        imageUrl = result;
                    }
                } else if (result instanceof Blob) {
                    // Convert blob to object URL
                    imageUrl = URL.createObjectURL(result);
                } else {
                    debugLog("Discord suggestions: Unknown result type for", emoteKey, typeof result);
                    return;
                }

                // Clear text content
                emoteItem.textContent = '';

                const img = document.createElement('img');
                img.src = imageUrl;
                img.style.cssText = `
                    width: 40px;
                    height: 40px;
                    object-fit: contain;
                    transition: transform 0.2s ease;
                `;

                img.onload = () => {
                    debugLog("Discord suggestions: Image loaded for", emoteKey);
                    emoteItem.appendChild(img);
                };

                img.onerror = () => {
                    debugLog("Discord suggestions: Image failed to load for", emoteKey);
                    // Restore text fallback if image fails
                    emoteItem.textContent = emoteKey.replace(/:/g, '');
                };

                emoteItem.addEventListener('mouseenter', () => {
                    if (img.parentNode) {
                        img.style.transform = 'scale(1.2)';
                    }
                    emoteItem.style.background = 'rgba(79, 84, 92, 0.16)';
                });

                emoteItem.addEventListener('mouseleave', () => {
                    if (img.parentNode) {
                        img.style.transform = 'scale(1)';
                    }
                    emoteItem.style.background = 'transparent';
                });
            }
        }).catch((error) => {
            debugLog("Discord suggestions: Error getting emote", emoteKey, error);
            // Text fallback is already set above
        });

        // Click handler for Discord interceptor
        emoteItem.addEventListener('click', () => {
            insertEmoteFromDiscordInterceptor(emoteKey);
        });

        emoteList.appendChild(emoteItem);
    });

    // Position and show the suggestion bar near the Discord minibar
    if (discordMinibar) {
        const minibarRect = discordMinibar.getBoundingClientRect();
        suggestionBar.style.left = `${minibarRect.left + window.scrollX}px`;
        suggestionBar.style.top = `${minibarRect.bottom + window.scrollY + 4}px`;
    }

    suggestionBar.style.display = 'block';
    debugLog("Discord suggestion bar displayed with", filteredEmotes.length, "emotes");
}

function hideDiscordSuggestions() {
    const suggestionBar = document.getElementById('mojify-suggestion-bar');
    if (suggestionBar) {
        suggestionBar.style.display = 'none';
    }
}

function hideSuggestions() {
    // Don't hide suggestions if Discord interceptor is active
    if (getCurrentPlatform() === 'discord' && discordState === 'INTERCEPTING') {
        debugLog("Discord interceptor active - preventing suggestion hiding");
        return;
    }

    debugLog("Hiding suggestions - Discord state:", discordState);
    const suggestionBar = document.getElementById('mojify-suggestion-bar');
    if (suggestionBar) {
        suggestionBar.style.display = 'none';
    }
    // Clear partial text info when hiding suggestions
    currentPartialTextInfo = null;
}

async function insertEmoteFromDiscordInterceptor(emoteKey) {
    try {
        // Clear the current buffer and minibar
        resetDiscordState();

        // Insert the emote
        await insertEmote(emoteKey, discordEditor);

        debugLog(`Inserted emote from Discord interceptor: ${emoteKey}`);
    } catch (error) {
        debugLog("Error inserting emote from Discord interceptor:", error);
    }
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
async function insertFileOnPlatform(file, targetElement, platform) {
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
    } else if (platform === 'telegram') {
        // Telegram needs to target upper area for uncompressed images
        return await insertFileOnTelegram(file, targetElement);
    } else if (platform === 'whatsapp') {
        // WhatsApp needs special handling like Discord
        return insertFileOnWhatsApp(file, targetElement);
    } else {
        // Fallback to drag and drop
        return simulateFileDrop(file, targetElement);
    }
}

// Telegram-specific file insertion (target upper area for uncompressed)
async function insertFileOnTelegram(file, targetElement) {
    debugLog("Using Telegram-specific insertion method (upper area for uncompressed)");

    try {
        // Method 1: Try clipboard paste approach
        debugLog("Attempting Telegram clipboard paste method");
        try {
            // Focus the input field first
            targetElement.focus();
            await new Promise(resolve => setTimeout(resolve, 100));

            // Create clipboard data
            const clipboardData = new DataTransfer();
            clipboardData.items.add(file);

            // Try paste event
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: clipboardData
            });

            const pasteResult = targetElement.dispatchEvent(pasteEvent);
            debugLog("Telegram paste event result:", pasteResult);

            if (pasteResult) {
                debugLog("Telegram paste method succeeded");
                return true;
            }
        } catch (pasteError) {
            debugLog("Telegram paste method failed:", pasteError);
        }

        // Method 2: Try input event with files
        debugLog("Attempting Telegram input event method");
        try {
            targetElement.focus();
            await new Promise(resolve => setTimeout(resolve, 100));

            // Create input event with files
            const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromDrop',
                data: null
            });

            // Try to set files property
            Object.defineProperty(inputEvent, 'dataTransfer', {
                value: (() => {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    return dt;
                })(),
                writable: false
            });

            const inputResult = targetElement.dispatchEvent(inputEvent);
            debugLog("Telegram input event result:", inputResult);

            if (inputResult) {
                debugLog("Telegram input method succeeded");
                return true;
            }
        } catch (inputError) {
            debugLog("Telegram input method failed:", inputError);
        }

        // Method 3: Enhanced drag and drop with better targeting
        debugLog("Attempting enhanced Telegram drag and drop method");

        // Get the bounding rect of the input field
        const rect = targetElement.getBoundingClientRect();

        // Target the very top of the input area for uncompressed
        const targetX = rect.left + (rect.width / 2);
        const targetY = rect.top + 10; // Just 10px from the top

        debugLog("Telegram enhanced drop coordinates:", { x: targetX, y: targetY, rect });

        // Focus first
        targetElement.focus();
        await new Promise(resolve => setTimeout(resolve, 200));

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Set the dropEffect and effectAllowed
        dataTransfer.dropEffect = 'copy';
        dataTransfer.effectAllowed = 'copy';

        // Create a more realistic drag sequence
        const dragEnterEvent = new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: targetX,
            clientY: targetY,
            screenX: targetX,
            screenY: targetY
        });
        targetElement.dispatchEvent(dragEnterEvent);
        await new Promise(resolve => setTimeout(resolve, 100));

        const dragOverEvent = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: targetX,
            clientY: targetY,
            screenX: targetX,
            screenY: targetY
        });

        // Prevent default on dragover
        dragOverEvent.preventDefault();
        targetElement.dispatchEvent(dragOverEvent);
        await new Promise(resolve => setTimeout(resolve, 100));

        const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: targetX,
            clientY: targetY,
            screenX: targetX,
            screenY: targetY
        });

        // Prevent default on drop
        dropEvent.preventDefault();
        const dropResult = targetElement.dispatchEvent(dropEvent);
        debugLog("Telegram enhanced drop event result:", dropResult);

        return true;
    } catch (error) {
        debugLog("Telegram insertion error:", error);
        // Fallback to standard method
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

// WhatsApp-specific file insertion
async function insertFileOnWhatsApp(file, targetElement) {
    debugLog("Using WhatsApp-specific insertion method");

    try {
        // Focus the input field first
        targetElement.focus();
        await new Promise(resolve => setTimeout(resolve, 200));

        // Method 1: Try paste event with files
        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData.items.add(file);
        const pasteResult = targetElement.dispatchEvent(pasteEvent);
        debugLog("WhatsApp paste method result:", pasteResult);

        // Method 2: Enhanced drag and drop
        const rect = targetElement.getBoundingClientRect();
        const targetX = rect.left + (rect.width / 2);
        const targetY = rect.top + (rect.height / 2);

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        dataTransfer.dropEffect = 'copy';
        dataTransfer.effectAllowed = 'copy';

        // Create realistic drag sequence
        const dragEnterEvent = new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: targetX,
            clientY: targetY
        });
        targetElement.dispatchEvent(dragEnterEvent);
        await new Promise(resolve => setTimeout(resolve, 100));

        const dragOverEvent = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: targetX,
            clientY: targetY
        });
        dragOverEvent.preventDefault();
        targetElement.dispatchEvent(dragOverEvent);
        await new Promise(resolve => setTimeout(resolve, 100));

        const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: targetX,
            clientY: targetY
        });
        dropEvent.preventDefault();
        const dropResult = targetElement.dispatchEvent(dropEvent);
        debugLog("WhatsApp drop event result:", dropResult);

        return true;
    } catch (error) {
        debugLog("WhatsApp insertion error:", error);
        return simulateFileDrop(file, targetElement);
    }
}

// Create emote suggestion minibar
function createEmoteSuggestionBar() {
    if (document.getElementById('mojify-suggestion-bar')) return;

    const suggestionBar = document.createElement('div');
    suggestionBar.id = 'mojify-suggestion-bar';
    suggestionBar.style.cssText = `
        position: fixed;
        background: transparent;
        border: none;
        border-radius: 16px;
        overflow: visible;
        z-index: 10000;
        display: none;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: move;
    `;

    // No header needed for minimal design

    const emoteList = document.createElement('div');
    emoteList.id = 'mojify-emote-list';
    emoteList.style.cssText = `
        display: flex;
        flex-direction: row;
        gap: 8px;
        padding: 12px;
        background: transparent;
        overflow-x: auto;
        max-width: 450px;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding-bottom: 30px;
    `;

    // Hide scrollbar for webkit browsers
    const style = document.createElement('style');
    style.textContent = `
        #mojify-emote-list::-webkit-scrollbar {
            display: none;
        }
    `;
    document.head.appendChild(style);
    suggestionBar.appendChild(emoteList);

    // Make draggable using the suggestion bar itself
    makeDraggable(suggestionBar, suggestionBar);

    document.body.appendChild(suggestionBar);
    return suggestionBar;
}

// Global variable to store partial text info for suggestions
let currentPartialTextInfo = null;

// Show emote suggestions
function showEmoteSuggestions(query, inputElement) {
    const suggestionBar = document.getElementById('mojify-suggestion-bar') || createEmoteSuggestionBar();
    const emoteList = document.getElementById('mojify-emote-list');

    // Store current partial text info for later removal
    let cursorPos;
    let currentText;

    if (inputElement.isContentEditable) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            cursorPos = range.startOffset;
            currentText = range.startContainer.textContent || '';
        }
    } else {
        cursorPos = inputElement.selectionStart;
        currentText = inputElement.value;
    }

    if (typeof cursorPos !== 'undefined') {
        const textBeforeCursor = currentText.substring(0, cursorPos);
        const lastColonIndex = textBeforeCursor.lastIndexOf(':');

        if (lastColonIndex !== -1) {
            currentPartialTextInfo = {
                startIndex: lastColonIndex,
                endIndex: cursorPos,
                inputElement: inputElement,
                fullText: currentText
            };
        }
    }

    if (!emoteMapping || Object.keys(emoteMapping).length === 0) {
        hideSuggestions();
        return;
    }

    // Filter emotes based on query
    const filteredEmotes = Object.keys(emoteMapping).filter(key => {
        const cleanKey = key.replace(/:/g, '').toLowerCase();
        const cleanQuery = query.toLowerCase();
        return cleanKey.includes(cleanQuery);
    }).slice(0, 6); // Limit to 6 suggestions

    if (filteredEmotes.length === 0) {
        hideSuggestions();
        return;
    }

    // Clear previous suggestions
    emoteList.innerHTML = '';

    // Add emote suggestions
    filteredEmotes.forEach((emoteKey, index) => {
        const emoteItem = document.createElement('div');
        emoteItem.style.cssText = `
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 6px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            flex-shrink: 0;
            min-width: 56px;
        `;

        // Try to get cached emote for preview
        const emoteImg = document.createElement('img');
        emoteImg.style.cssText = `
            width: 40px;
            height: 40px;
            object-fit: contain;
        `;

        // Load emote preview if available
        if (typeof emoteDB !== 'undefined') {
            emoteDB.getEmote(emoteKey).then(cachedEmote => {
                if (cachedEmote && cachedEmote.dataUrl) {
                    emoteImg.src = cachedEmote.dataUrl;
                } else {
                    // Fallback to placeholder icon
                    emoteImg.style.display = 'none';
                    const placeholderIcon = document.createElement('i');
                    placeholderIcon.className = 'fas fa-smile';
                    placeholderIcon.style.cssText = `
                        font-size: 24px;
                        color: #9ca3af;
                    `;
                    emoteItem.appendChild(placeholderIcon);
                }
            }).catch(() => {
                // Fallback to placeholder icon
                emoteImg.style.display = 'none';
                const placeholderIcon = document.createElement('i');
                placeholderIcon.className = 'fas fa-smile';
                placeholderIcon.style.cssText = `
                    font-size: 24px;
                    color: #9ca3af;
                `;
                emoteItem.appendChild(placeholderIcon);
            });
        }

        emoteItem.appendChild(emoteImg);

        // Create floating command tooltip
        const commandTooltip = document.createElement('div');
        commandTooltip.style.cssText = `
            position: absolute;
            bottom: -22px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            font-size: 9px;
            font-family: 'Courier New', monospace;
            padding: 3px 6px;
            border-radius: 4px;
            white-space: nowrap;
            opacity: 1;
            pointer-events: none;
            transition: opacity 0.2s;
            backdrop-filter: blur(10px);
            z-index: 1001;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            max-width: 70px;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        commandTooltip.textContent = emoteKey;

        emoteItem.appendChild(commandTooltip);

        // Hover effects
        emoteItem.addEventListener('mouseenter', () => {
            emoteItem.style.transform = 'translateY(-3px) scale(1.1)';
            emoteItem.style.filter = 'drop-shadow(0 6px 12px rgba(112, 80, 199, 0.3))';
            commandTooltip.style.opacity = '1';
            commandTooltip.style.transform = 'translateX(-50%) translateY(2px)';
        });

        emoteItem.addEventListener('mouseleave', () => {
            emoteItem.style.transform = 'translateY(0) scale(1)';
            emoteItem.style.filter = 'none';
            commandTooltip.style.opacity = '1';
            commandTooltip.style.transform = 'translateX(-50%) translateY(0px)';
        });

        // Click to insert emote
        emoteItem.addEventListener('click', () => {
            // Add click feedback
            emoteItem.style.transform = 'scale(0.9)';
            setTimeout(() => {
                emoteItem.style.transform = 'translateY(-3px) scale(1.1)';
            }, 150);

            insertEmoteFromSuggestion(emoteKey, inputElement);
            hideSuggestions();
        });

        emoteList.appendChild(emoteItem);
    });

    // Position the suggestion bar using saved position or default
    positionSuggestionBarFromStorage(inputElement);
    suggestionBar.style.display = 'block';
}



// Get saved position for current site
function getSavedPosition() {
    const hostname = window.location.hostname;
    const storageKey = `mojify-suggestion-pos-${hostname}`;
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : null;
}

// Save position for current site
function savePosition(x, y) {
    const hostname = window.location.hostname;
    const storageKey = `mojify-suggestion-pos-${hostname}`;
    localStorage.setItem(storageKey, JSON.stringify({ x, y }));
}

// Position suggestion bar using saved position or default above input
function positionSuggestionBarFromStorage(inputElement) {
    const suggestionBar = document.getElementById('mojify-suggestion-bar');
    if (!suggestionBar) return;

    const savedPos = getSavedPosition();

    if (savedPos) {
        // Use saved position
        suggestionBar.style.left = `${savedPos.x}px`;
        suggestionBar.style.top = `${savedPos.y}px`;
        suggestionBar.style.width = '300px';
    } else {
        // Default position above input
        if (inputElement) {
            const rect = inputElement.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

            suggestionBar.style.left = `${rect.left + scrollLeft}px`;
            suggestionBar.style.top = `${rect.top + scrollTop - 220}px`; // Above input
            suggestionBar.style.width = `${Math.min(300, rect.width)}px`;
        } else {
            // Fallback to center screen
            suggestionBar.style.left = '50px';
            suggestionBar.style.top = '50px';
            suggestionBar.style.width = '300px';
        }
    }
}

// Make element draggable
function makeDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = parseInt(element.style.left) || 0;
        initialTop = parseInt(element.style.top) || 0;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    function onMouseMove(e) {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const newLeft = initialLeft + deltaX;
        const newTop = initialTop + deltaY;

        // Keep within viewport bounds
        const maxLeft = window.innerWidth - element.offsetWidth;
        const maxTop = window.innerHeight - element.offsetHeight;

        const boundedLeft = Math.max(0, Math.min(newLeft, maxLeft));
        const boundedTop = Math.max(0, Math.min(newTop, maxTop));

        element.style.left = `${boundedLeft}px`;
        element.style.top = `${boundedTop}px`;
    }

    function onMouseUp(e) {
        if (isDragging) {
            isDragging = false;
            // Save position
            const finalLeft = parseInt(element.style.left);
            const finalTop = parseInt(element.style.top);
            savePosition(finalLeft, finalTop);
        }

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

// Insert emote from suggestion
async function insertEmoteFromSuggestion(emoteKey, inputElement) {
    try {
        const platform = getCurrentPlatform();
        if (!platform) return;

        // Focus the input element first
        inputElement.focus();

        // Use stored partial text info if available
        if (currentPartialTextInfo && currentPartialTextInfo.inputElement === inputElement) {
            if (inputElement.isContentEditable) {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const textNode = range.startContainer;

                    if (textNode.nodeType === Node.TEXT_NODE) {
                        // Discord-specific handling - skip text deletion
                        if (getCurrentPlatform() === 'discord') {
                            // For Discord, just position cursor and skip deletion
                            // Let the emote insert at current position
                            const newRange = document.createRange();
                            newRange.setStart(textNode, currentPartialTextInfo.startIndex);
                            newRange.collapse(true);
                            selection.removeAllRanges();
                            selection.addRange(newRange);
                        } else {
                            // Standard approach for other platforms
                            const deleteRange = document.createRange();
                            deleteRange.setStart(textNode, currentPartialTextInfo.startIndex);
                            deleteRange.setEnd(textNode, currentPartialTextInfo.endIndex);
                            deleteRange.deleteContents();

                            // Update selection to position where emote will be inserted
                            const newRange = document.createRange();
                            newRange.setStart(textNode, currentPartialTextInfo.startIndex);
                            newRange.collapse(true);
                            selection.removeAllRanges();
                            selection.addRange(newRange);
                        }
                    }
                }
            } else {
                // For regular input fields, use stored info to remove partial text
                const beforePartial = currentPartialTextInfo.fullText.substring(0, currentPartialTextInfo.startIndex);
                const afterPartial = currentPartialTextInfo.fullText.substring(currentPartialTextInfo.endIndex);
                inputElement.value = beforePartial + afterPartial;

                // Set cursor position where emote will be inserted
                const newPos = beforePartial.length;
                inputElement.setSelectionRange(newPos, newPos);

                // Trigger input event to notify the platform of the change
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else {
            // Fallback to old method if no stored info
            if (inputElement.isContentEditable) {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const textNode = range.startContainer;

                    if (textNode.nodeType === Node.TEXT_NODE) {
                        const text = textNode.textContent;
                        const colonIndex = text.lastIndexOf(':', range.startOffset);

                        if (colonIndex !== -1) {
                            const deleteRange = document.createRange();
                            deleteRange.setStart(textNode, colonIndex);
                            deleteRange.setEnd(textNode, range.startOffset);
                            deleteRange.deleteContents();

                            const newRange = document.createRange();
                            newRange.setStart(textNode, colonIndex);
                            newRange.collapse(true);
                            selection.removeAllRanges();
                            selection.addRange(newRange);
                        }
                    }
                }
            } else {
                const text = inputElement.value;
                const cursorPos = inputElement.selectionStart;
                const colonIndex = text.lastIndexOf(':', cursorPos);

                if (colonIndex !== -1) {
                    const beforeColon = text.substring(0, colonIndex);
                    const afterCursor = text.substring(cursorPos);
                    inputElement.value = beforeColon + afterCursor;

                    const newPos = beforeColon.length;
                    inputElement.setSelectionRange(newPos, newPos);
                    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }

        // Clear the stored partial text info
        currentPartialTextInfo = null;

        // Always use remote insertion for all platforms
        await insertEmote(emoteKey);

    } catch (error) {
        debugLog("Error inserting emote from suggestion:", error);
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
            return { success: false, error: 'This feature only works on supported platforms (Messenger, Discord, Facebook, Telegram, WhatsApp)' };
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
            const insertResult = await insertFileOnPlatform(file, inputField, platform);
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
try {
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
} catch (error) {
  handleRuntimeError("message listener setup", error);
}

// Auto-replace emote codes as user types
let typingBuffer = '';
let lastInputTime = 0;
let isProcessingEmote = false;

// Function to handle input events
async function handleInputEvent(event) {
  const { target } = event;

  // Check if processing is blocked

  if (isProcessingEmote) return;

  // Skip regular input handling if Discord interceptor is active
  if (getCurrentPlatform() === 'discord' && discordState === 'INTERCEPTING') {
    return;
  }

  // Only process in text fields
  if (!(target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    return;
  }

  // Get current text content
  const currentText = target.isContentEditable ?
    (target.textContent || target.innerText || '') :
    target.value;

  // Handle emote suggestions
  handleEmoteSuggestions(event, target, currentText);

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

                // Discord-specific handling - skip text deletion
                if (getCurrentPlatform() === 'discord') {
                  // For Discord, just position cursor and skip deletion
                  // Let the emote insert at current position
                  const newRange = document.createRange();
                  newRange.setStart(node, actualStart);
                  newRange.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(newRange);
                } else {
                  // Standard approach for other platforms
                  const deleteRange = document.createRange();
                  deleteRange.setStart(node, actualStart);
                  deleteRange.setEnd(node, actualStart + fullCommand.length);
                  deleteRange.deleteContents();
                }

                // Insert the emote using existing function with the correct key
                await insertEmote(emoteKeyForInsertion);
                // Hide suggestions since we successfully processed a complete emote
                hideSuggestions();
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
            // Hide suggestions since we successfully processed a complete emote
            hideSuggestions();
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

// Handle emote suggestions
function handleEmoteSuggestions(event, target, currentText) {
  try {
    // Get cursor position
    let cursorPos;
    if (target.isContentEditable) {
      const selection = window.getSelection();
      if (selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      cursorPos = range.startOffset;
    } else {
      cursorPos = target.selectionStart;
    }

    // Look for colon followed by text (incomplete emote)
    const textBeforeCursor = currentText.substring(0, cursorPos);
    const lastColonIndex = textBeforeCursor.lastIndexOf(':');

    if (lastColonIndex !== -1) {
      const textAfterColon = textBeforeCursor.substring(lastColonIndex + 1);

      // Check if it's a valid emote query (no spaces, reasonable length)
      if (textAfterColon.length >= 0 && textAfterColon.length <= 20 && !textAfterColon.includes(' ')) {
        // Check if there's another colon after (complete emote)
        const nextColonIndex = currentText.indexOf(':', lastColonIndex + 1);

        if (nextColonIndex === -1 || nextColonIndex >= cursorPos) {
          // Incomplete emote, show suggestions
          showEmoteSuggestions(textAfterColon, target);
          return;
        }
      }
    }

    // Hide suggestions if not in emote context (but not for Discord interceptor)
    if (getCurrentPlatform() !== 'discord' || discordState !== 'INTERCEPTING') {
        hideSuggestions();
    }
  } catch (error) {
    debugLog("Error handling emote suggestions:", error);
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

// Hide suggestions when clicking outside
document.addEventListener('click', (event) => {
  const suggestionBar = document.getElementById('mojify-suggestion-bar');
  if (suggestionBar && !suggestionBar.contains(event.target)) {
    hideSuggestions();
  }
});

// Hide suggestions on escape key
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideSuggestions();
  }
});

debugLog("Mojify content script loaded on supported platform:", hostname);

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
}, 2000);

// Continue with Mojify initialization

// Initialize Discord text interceptor if on Discord
if (getCurrentPlatform() === 'discord') {
  debugLog("Discord platform detected - initializing text interceptor");
  window.addEventListener('load', setupDiscordTextInterceptor, false);
  // Also try immediate setup in case page is already loaded
  if (document.readyState === 'complete') {
    setupDiscordTextInterceptor();
  }
}

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

})(); // End of early exit function
