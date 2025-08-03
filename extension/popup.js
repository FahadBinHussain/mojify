
document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const channelIdsInput = document.getElementById('channel-ids');
  const saveButton = document.getElementById('save-button');
  const downloadButton = document.getElementById('download-button');
  const emoteGrid = document.getElementById('emote-grid');
  const emoteCount = document.getElementById('emote-count');
  const noEmotesMessage = document.getElementById('no-emotes-message');
  const loadMoreContainer = document.getElementById('load-more');
  const loadMoreBtn = document.getElementById('load-more-btn');
  const searchInput = document.getElementById('search-emotes');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const tabIndicator = document.querySelector('.tab-indicator');
  const toast = document.getElementById('toast');
  
  // Constants
  const ITEMS_PER_PAGE = 30;
  
  // State variables
  let allEmotes = {};
  let channels = [];
  let displayedEmotes = [];
  let currentPage = 1;
  let searchTerm = '';
  
  // Initialize tab indicator position
  function initTabs() {
    const activeTab = document.querySelector('.tab-btn.active');
    const tabWidth = 100 / tabButtons.length;
    const activeIndex = Array.from(tabButtons).findIndex(tab => tab.classList.contains('active'));
    
    tabIndicator.style.width = `${tabWidth}%`;
    tabIndicator.style.transform = `translateX(${activeIndex * 100}%)`;
    
    tabButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabPanes.forEach(pane => pane.classList.remove('active'));
        
        button.classList.add('active');
        document.getElementById(`${button.dataset.tab}-tab`).classList.add('active');
        
        tabIndicator.style.transform = `translateX(${index * 100}%)`;
      });
    });
  }
  
  // Show toast notification
  function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.className = 'toast hidden';
    }, 3000);
  }
  
  // Insert emote into active text field on messenger.com
  function insertEmoteIntoActiveTab(emoteTrigger) {
    // Find active tab
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs.length === 0) {
        showToast('No active tab found', 'error');
        return;
      }
      
      const currentTab = tabs[0];
      
      // Check if the current tab is messenger.com
      if (!currentTab.url.includes('messenger.com')) {
        showToast('This feature only works on messenger.com', 'error');
        
        // Add diagnostic info
        const diagInfo = document.createElement('div');
        diagInfo.className = 'diagnostic-info';
        diagInfo.innerHTML = `
          <div class="diagnostic-header">
            <h3>Diagnostic Information</h3>
            <p>You tried to insert an emote on: <code>${new URL(currentTab.url).hostname}</code></p>
            <p>This feature only works on <code>messenger.com</code></p>
          </div>
        `;
        
        // Show diagnostics in a modal
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.appendChild(diagInfo);
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.innerHTML = 'Close';
        closeBtn.addEventListener('click', () => {
          document.body.removeChild(modal);
        });
        
        diagInfo.appendChild(closeBtn);
        document.body.appendChild(modal);
        
        return;
      }

      // Get emote URL from storage
      chrome.storage.local.get(['emoteMapping'], async (result) => {
        if (!result.emoteMapping || !result.emoteMapping[emoteTrigger]) {
          showToast('Emote not found in mapping', 'error');
          return;
        }

        const emoteUrl = result.emoteMapping[emoteTrigger];
        
        // Show loading indicator
        showToast('Inserting emote...', 'loading');
        
        try {
          // Fetch the image
          const response = await fetch(emoteUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch emote: ${response.status}`);
          }
          
          const blob = await response.blob();
          
          // Copy the image to clipboard
          try {
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);
            console.log("Image copied to clipboard");
          } catch (clipboardError) {
            console.error("Clipboard error:", clipboardError);
            showToast(`Clipboard error: ${clipboardError.message}`, 'error');
            return;
          }
          
          // Send message to background script to handle the insertion
          chrome.runtime.sendMessage({
            type: 'insertEmote',
            tabId: currentTab.id,
            emoteUrl,
            emoteTrigger
          }, (response) => {
            if (response && response.success) {
              showToast('Emote inserted!');
              // Close popup after successful insertion
              setTimeout(() => window.close(), 800);
            } else {
              const error = response && response.error ? response.error : 'Unknown error';
              showToast(`Error: ${error}`, 'error');
              
              // Add diagnostic info for insertion error
              const diagInfo = document.createElement('div');
              diagInfo.className = 'diagnostic-info';
              diagInfo.innerHTML = `
                <div class="diagnostic-header">
                  <h3>Diagnostic Information</h3>
                  <p>Failed to insert emote</p>
                  <p>Error: <code>${error}</code></p>
                  <p>You can try reloading the page and trying again</p>
                </div>
              `;
              
              // Show diagnostics in a modal
              const modal = document.createElement('div');
              modal.className = 'modal';
              modal.appendChild(diagInfo);
              
              const closeBtn = document.createElement('button');
              closeBtn.className = 'close-btn';
              closeBtn.innerHTML = 'Close';
              closeBtn.addEventListener('click', () => {
                document.body.removeChild(modal);
              });
              
              const reloadBtn = document.createElement('button');
              reloadBtn.className = 'reload-btn';
              reloadBtn.innerHTML = 'Reload Page';
              reloadBtn.addEventListener('click', () => {
                chrome.tabs.reload(currentTab.id);
                window.close();
              });
              
              const buttonContainer = document.createElement('div');
              buttonContainer.className = 'button-container';
              buttonContainer.appendChild(closeBtn);
              buttonContainer.appendChild(reloadBtn);
              
              diagInfo.appendChild(buttonContainer);
              document.body.appendChild(modal);
            }
          });
        } catch (error) {
          console.error("Error:", error);
          showToast(`Error: ${error.message}`, 'error');
        }
      });
    });
  }
  
  // Load emotes from storage
  function loadEmotes() {
    chrome.storage.local.get(['emoteMapping', 'channels'], (result) => {
      console.log('Loaded data:', result);
      
      if (result.emoteMapping && Object.keys(result.emoteMapping).length > 0) {
        allEmotes = result.emoteMapping;
        channels = result.channels || [];
        
        console.log('All emotes count:', Object.keys(allEmotes).length);
        console.log('Channels count:', channels.length);
        
        // If we have emotes but no channels (for backward compatibility)
        if (channels.length === 0) {
          chrome.storage.local.get(['channelIds'], (result) => {
            if (result.channelIds && result.channelIds.length > 0) {
              // Create a single channel with all emotes
              channels = [{
                id: 'all',
                username: 'All Emotes',
                emotes: allEmotes
              }];
              console.log('Created fallback channel with all emotes');
            }
            updateEmoteCount();
            filterAndDisplayEmotes();
          });
        } else {
          // Log channel data
          channels.forEach(channel => {
            console.log(`Channel ${channel.username} has ${Object.keys(channel.emotes || {}).length} emotes`);
          });
          
          updateEmoteCount();
          filterAndDisplayEmotes();
        }
        
        noEmotesMessage.style.display = 'none';
      } else {
        emoteGrid.innerHTML = '';
        noEmotesMessage.style.display = 'flex';
        loadMoreContainer.classList.add('hidden');
        emoteCount.textContent = '0';
      }
    });
  }
  
  // Update emote count
  function updateEmoteCount() {
    const count = Object.keys(allEmotes).length;
    emoteCount.textContent = count;
  }
  
  // Filter emotes based on search term
  function filterAndDisplayEmotes(resetPage = true) {
    if (resetPage) {
      currentPage = 1;
    }
    
    const emoteKeys = Object.keys(allEmotes);
    if (emoteKeys.length === 0) return;
    
    // Filter based on search term
    if (searchTerm === '') {
      // If no search term, we'll display by channel in renderEmoteGrid
      displayedEmotes = [];
      // Always hide load more button in channel view
      loadMoreContainer.classList.add('hidden');
      renderEmoteGrid();
    } else {
      // If searching, filter all emotes
      displayedEmotes = emoteKeys
        .filter(key => {
          const emoteName = key.replace(/:/g, '').toLowerCase();
          return emoteName.includes(searchTerm.toLowerCase());
        })
        .sort((a, b) => {
          // Sort alphabetically
          return a.localeCompare(b);
        });
      
      // Display a subset of emotes for the current page
      renderEmoteGrid();
    }
  }
  
  // Render the emote grid
  function renderEmoteGrid() {
    emoteGrid.innerHTML = '';
    
    console.log('Rendering emote grid. Search term:', searchTerm);
    
    // If no search term, ensure load more button is hidden
    if (searchTerm === '') {
      loadMoreContainer.classList.add('hidden');
    }
    
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    
    // If no emotes match the search
    if (displayedEmotes.length === 0 && searchTerm !== '' && Object.keys(allEmotes).length > 0) {
      emoteGrid.innerHTML = `
        <div class="no-emotes-message" style="grid-column: 1 / -1;">
          <p>No emotes found for "${searchTerm}"</p>
        </div>
      `;
      loadMoreContainer.classList.add('hidden');
      return;
    }
    
    // If we're searching, show emotes with pagination
    if (searchTerm !== '') {
      const emotesToShow = displayedEmotes.slice(startIndex, endIndex);
      
      console.log(`Showing search results: ${emotesToShow.length} emotes (${startIndex}-${endIndex} of ${displayedEmotes.length})`);
      
      emotesToShow.forEach(key => {
        const emoteUrl = allEmotes[key];
        const emoteName = key.replace(/:/g, '');
        
        const emoteItem = document.createElement('div');
        emoteItem.className = 'emote-item';
        emoteItem.setAttribute('data-emote-key', key);
        emoteItem.innerHTML = `
          <div class="emote-img-container">
            <img src="${emoteUrl}" alt="${emoteName}" class="emote-img">
          </div>
          <div class="emote-details">
            <div class="emote-name">${emoteName}</div>
            <div class="emote-trigger">${key}</div>
          </div>
        `;
        
        // Add click event to insert emote
        emoteItem.addEventListener('click', () => {
          insertEmoteIntoActiveTab(key);
        });
        
        emoteGrid.appendChild(emoteItem);
      });
      
      // Update "Load More" button visibility
      if (endIndex < displayedEmotes.length) {
        loadMoreContainer.classList.remove('hidden');
        loadMoreBtn.textContent = `Load More (${displayedEmotes.length - endIndex} remaining)`;
      } else {
        loadMoreContainer.classList.add('hidden');
      }
    } else {
      // Group emotes by channel - show all emotes for each channel
      console.log(`Showing emotes by channel. Total channels: ${channels.length}`);
      
      // Always hide load more button in channel view
      loadMoreContainer.classList.add('hidden');
      
      channels.forEach(channel => {
        if (!channel.emotes || Object.keys(channel.emotes).length === 0) {
          console.log(`Channel ${channel.username} has no emotes, skipping`);
          return;
        }
        
        // Count emotes for this channel
        const emoteCount = Object.keys(channel.emotes).length;
        console.log(`Rendering channel ${channel.username} with ${emoteCount} emotes`);
        
        // Create channel section
        const channelSection = document.createElement('div');
        channelSection.className = 'channel-section';
        channelSection.setAttribute('data-channel-id', channel.id);
        
        // Create channel header with username
        const channelHeader = document.createElement('div');
        channelHeader.className = 'channel-header';
        
        channelHeader.innerHTML = `
          <div class="channel-header-content">
            <span class="channel-name">${channel.username}</span>
            <span class="channel-emote-count">${emoteCount} emotes</span>
          </div>
          <div class="channel-toggle-icon"></div>
        `;
        
        // Create channel emotes container
        const channelEmotes = document.createElement('div');
        channelEmotes.className = 'channel-emotes';
        
        // Add ALL emotes for this channel - no pagination
        const channelEmoteKeys = Object.keys(channel.emotes);
        console.log(`Channel ${channel.username} emote keys:`, channelEmoteKeys);
        
        Object.entries(channel.emotes).forEach(([key, url]) => {
          const emoteName = key.replace(/:/g, '');
          
          const emoteItem = document.createElement('div');
          emoteItem.className = 'emote-item';
          emoteItem.setAttribute('data-emote-key', key);
          emoteItem.innerHTML = `
            <div class="emote-img-container">
              <img src="${url}" alt="${emoteName}" class="emote-img">
            </div>
            <div class="emote-details">
              <div class="emote-name">${emoteName}</div>
              <div class="emote-trigger">${key}</div>
            </div>
          `;
          
          // Add click event to insert emote
          emoteItem.addEventListener('click', () => {
            insertEmoteIntoActiveTab(key);
          });
          
          channelEmotes.appendChild(emoteItem);
        });
        
        // Add toggle functionality to channel header
        channelHeader.addEventListener('click', (e) => {
          // Don't toggle if clicking on an emote
          if (e.target.closest('.emote-item')) {
            return;
          }
          
          channelSection.classList.toggle('collapsed');
          
          // Save collapsed state to storage
          chrome.storage.local.get(['collapsedChannels'], (result) => {
            const collapsedChannels = result.collapsedChannels || {};
            collapsedChannels[channel.id] = channelSection.classList.contains('collapsed');
            chrome.storage.local.set({ collapsedChannels });
          });
        });
        
        // Add channel header and emotes to section
        channelSection.appendChild(channelHeader);
        channelSection.appendChild(channelEmotes);
        
        // Check if this channel should be collapsed
        chrome.storage.local.get(['collapsedChannels'], (result) => {
          const collapsedChannels = result.collapsedChannels || {};
          if (collapsedChannels[channel.id]) {
            channelSection.classList.add('collapsed');
          }
        });
        
        // Add section to grid
        emoteGrid.appendChild(channelSection);
      });
      
      // Hide load more button since we're showing all emotes grouped by channel
      loadMoreContainer.classList.add('hidden');
    }
  }
  
  // Load more emotes when button is clicked
  loadMoreBtn.addEventListener('click', () => {
    currentPage++;
    renderEmoteGrid();
  });
  
  // Search functionality
  searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    filterAndDisplayEmotes();
  });
  
  // Load saved channel IDs
  function loadChannelIds() {
    chrome.storage.local.get(['channelIds'], (result) => {
      if (result.channelIds) {
        channelIdsInput.value = result.channelIds.join('\n');
      }
    });
  }
  
  // Save channel IDs
  saveButton.addEventListener('click', () => {
    const text = channelIdsInput.value.trim();
    let channelIds;
    
    // Handle both comma-separated and newline-separated formats
    if (text.includes(',')) {
      channelIds = text.split(',').map(id => id.trim()).filter(id => id);
    } else {
      channelIds = text.split('\n').map(id => id.trim()).filter(id => id);
    }
    
    if (channelIds.length === 0) {
      showToast('Please enter at least one channel ID', 'error');
      return;
    }
    
    chrome.storage.local.set({ channelIds }, () => {
      showToast('Channel IDs saved successfully');
    });
  });
  
  // Download/refresh emotes
  downloadButton.addEventListener('click', () => {
    // Check if there are channel IDs configured
    chrome.storage.local.get(['channelIds'], (result) => {
      if (!result.channelIds || result.channelIds.length === 0) {
        showToast('No channel IDs configured', 'error');
        
        // Switch to settings tab
        document.querySelector('.tab-btn[data-tab="settings"]').click();
        return;
      }
      
      // Show loading state
      downloadButton.disabled = true;
      downloadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Loading...</span>';
      
      chrome.runtime.sendMessage({ type: 'downloadEmotes' }, (response) => {
        // Reset button state
        downloadButton.disabled = false;
        downloadButton.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh Emotes</span>';
        
        if (response && response.success) {
          showToast('Emotes downloaded successfully');
          loadEmotes(); // Reload emotes
          searchInput.value = ''; // Clear search
          searchTerm = '';
        } else {
          showToast('Error downloading emotes', 'error');
        }
      });
    });
  });
  
  // Button press effect for all buttons
  function addButtonEffects() {
    const buttons = document.querySelectorAll('button');
    
    buttons.forEach(button => {
      button.addEventListener('mousedown', () => {
        if (!button.disabled) {
          button.style.transform = 'scale(0.97)';
        }
      });
      
      button.addEventListener('mouseup', () => {
        button.style.transform = '';
      });
      
      button.addEventListener('mouseleave', () => {
        button.style.transform = '';
      });
    });
  }
  
  // Add to the document ready event after initialization code
  function initDebugSection() {
    const toggleDebugBtn = document.getElementById('toggle-debug');
    const debugContent = document.getElementById('debug-content');
    const findFieldBtn = document.getElementById('debug-find-field');
    const insertTextBtn = document.getElementById('debug-insert-text');
    const detectPageBtn = document.getElementById('debug-detect-page');
    const debugResultContent = document.querySelector('.debug-result-content');
    
    // Toggle debug section visibility
    toggleDebugBtn.addEventListener('click', () => {
      if (debugContent.style.display === 'none') {
        debugContent.style.display = 'block';
        toggleDebugBtn.textContent = 'Hide';
      } else {
        debugContent.style.display = 'none';
        toggleDebugBtn.textContent = 'Show';
      }
    });
    
    // Find text field debug
    findFieldBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          setDebugResult('No active tab found', 'error');
          return;
        }
        
        const currentTab = tabs[0];
        
        setDebugResult('Finding text field...', 'loading');
        
        chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: debugFindTextField
        }).then((results) => {
          if (results && results[0] && results[0].result) {
            setDebugResult(results[0].result, results[0].result.includes('Found') ? 'success' : 'error');
          } else {
            setDebugResult('No result returned', 'error');
          }
        }).catch((error) => {
          setDebugResult(`Error: ${error.message}`, 'error');
        });
      });
    });
    
    // Insert test text
    insertTextBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          setDebugResult('No active tab found', 'error');
          return;
        }
        
        const currentTab = tabs[0];
        
        setDebugResult('Inserting test text...', 'loading');
        
        chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: debugInsertTestText
        }).then((results) => {
          if (results && results[0] && results[0].result) {
            setDebugResult(results[0].result, results[0].result.includes('Success') ? 'success' : 'error');
          } else {
            setDebugResult('No result returned', 'error');
          }
        }).catch((error) => {
          setDebugResult(`Error: ${error.message}`, 'error');
        });
      });
    });
    
    // Detect page structure
    detectPageBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          setDebugResult('No active tab found', 'error');
          return;
        }
        
        const currentTab = tabs[0];
        
        setDebugResult('Analyzing page...', 'loading');
        
        chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: debugAnalyzePage
        }).then((results) => {
          if (results && results[0] && results[0].result) {
            setDebugResult(results[0].result);
          } else {
            setDebugResult('No result returned', 'error');
          }
        }).catch((error) => {
          setDebugResult(`Error: ${error.message}`, 'error');
        });
      });
    });
    
    function setDebugResult(text, type) {
      debugResultContent.textContent = text;
      debugResultContent.className = 'debug-result-content';
      if (type) {
        debugResultContent.classList.add(type);
      }
    }
  }

  // Debug functions that will be executed in the page context
  function debugFindTextField() {
    try {
      let log = "DEBUG: Finding Text Field\n";
      log += "-----------------------\n";
      
      // Target messenger.com input fields with various selectors
      const selectors = [
        '.x78zum5.x13a6bvl',
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[aria-label*="message" i]',
        '[placeholder*="message" i]',
        '[data-testid="messenger_composer_text"]',
        '[role="textbox"]'
      ];
      
      log += `Page URL: ${window.location.href}\n`;
      log += `Document Ready: ${document.readyState}\n\n`;
      
      let foundAny = false;
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        log += `Selector: ${selector}\n`;
        log += `Found: ${elements.length} elements\n`;
        
        if (elements.length > 0) {
          foundAny = true;
          for (let i = 0; i < Math.min(elements.length, 3); i++) {
            const el = elements[i];
            log += `- Element ${i + 1}: ${el.tagName}\n`;
            log += `  Visible: ${el.offsetParent !== null}\n`;
            log += `  ContentEditable: ${el.isContentEditable}\n`;
            
            // Try to focus
            try {
              el.focus();
              log += `  Focus: Success\n`;
              // Check if active
              log += `  Active: ${document.activeElement === el}\n`;
            } catch (e) {
              log += `  Focus: Failed (${e.message})\n`;
            }
            log += '\n';
          }
        } else {
          log += '\n';
        }
      }
      
      if (foundAny) {
        log += "Found potential text fields";
      } else {
        log += "No text fields found";
      }
      
      return log;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  function debugInsertTestText() {
    try {
      let log = "DEBUG: Insert Test Text\n";
      log += "---------------------\n";
      
      const activeElement = document.activeElement;
      log += `Active Element: ${activeElement ? activeElement.tagName : 'None'}\n`;
      
      if (!activeElement) {
        log += "No active element found. Finding text field...\n";
        
        // Try to find and focus the text field
        const selector = '.x78zum5.x13a6bvl, [contenteditable="true"], [role="textbox"]';
        const elements = document.querySelectorAll(selector);
        
        if (elements.length > 0) {
          for (const el of elements) {
            if (el.offsetParent !== null) {
              el.focus();
              log += `Found and focused: ${el.tagName}\n`;
              break;
            }
          }
        } else {
          log += "No input fields found\n";
          return log + "Failed to insert test text";
        }
      }
      
      // Now try to insert text into the active element
      const testText = "🧪 Mojify Test Text 🧪";
      
      if (document.activeElement.isContentEditable) {
        log += "Using contentEditable method\n";
        
        // Try execCommand
        if (document.queryCommandSupported('insertText')) {
          document.execCommand('insertText', false, testText);
          log += "Used execCommand\n";
        }
        // Fallback to Selection API
        else {
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const textNode = document.createTextNode(testText);
            range.insertNode(textNode);
            range.collapse(false);
            log += "Used Selection API\n";
          } else {
            log += "No selection range\n";
          }
        }
        
        document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        return log + "Success: Text inserted into contentEditable element";
      }
      // For input or textarea
      else if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') {
        log += "Using input/textarea method\n";
        
        const pos = document.activeElement.selectionStart || 0;
        const value = document.activeElement.value || '';
        document.activeElement.value = value.slice(0, pos) + testText + value.slice(pos);
        document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        
        return log + "Success: Text inserted into input/textarea";
      }
      else {
        return log + "Failed: Element is not editable";
      }
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  function debugAnalyzePage() {
    try {
      let log = "DEBUG: Page Analysis\n";
      log += "-------------------\n";
      
      log += `URL: ${window.location.href}\n`;
      log += `Is Messenger: ${window.location.href.includes('messenger.com')}\n\n`;
      
      // Check for various Messenger elements
      const containers = [
        { name: "Main content", selector: '[role="main"]' },
        { name: "Complementary section", selector: '[role="complementary"]' },
        { name: "Form", selector: '[role="form"]' },
        { name: "Navigation", selector: '[role="navigation"]' }
      ];
      
      log += "Page Structure:\n";
      containers.forEach(container => {
        const elements = document.querySelectorAll(container.selector);
        log += `${container.name}: ${elements.length} found\n`;
      });
      
      // Check for editable elements
      const editables = document.querySelectorAll('[contenteditable="true"]');
      log += `\nEditable elements: ${editables.length}\n`;
      
      // Check for focus handling
      log += "\nFocus Test:\n";
      const activeBeforeTest = document.activeElement;
      log += `Active element before test: ${activeBeforeTest ? activeBeforeTest.tagName : 'None'}\n`;
      
      try {
        // Try to create a temporary input
        const tempInput = document.createElement('input');
        tempInput.style.position = 'absolute';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.focus();
        log += `Focus test result: ${document.activeElement === tempInput ? 'Success' : 'Failed'}\n`;
        document.body.removeChild(tempInput);
      } catch (e) {
        log += `Focus test error: ${e.message}\n`;
      }
      
      // List potential text entry fields
      log += "\nPotential Message Fields:\n";
      const messageSelectors = [
        '[placeholder*="message" i]',
        '[aria-label*="message" i]',
        '[aria-label*="type" i]',
        '.x78zum5.x13a6bvl'
      ];
      
      let found = false;
      for (const selector of messageSelectors) {
        const fields = document.querySelectorAll(selector);
        if (fields.length > 0) {
          found = true;
          log += `${selector}: ${fields.length} found\n`;
          // Detail the first found field
          const field = fields[0];
          log += `  Tag: ${field.tagName}\n`;
          log += `  Classes: ${field.className}\n`;
          log += `  Content Editable: ${field.isContentEditable}\n`;
          log += `  Visible: ${field.offsetParent !== null}\n`;
          break;
        }
      }
      
      if (!found) {
        log += "No message fields found with common selectors\n";
      }
      
      return log;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }
  
  // Initialize
  function init() {
    initTabs();
    loadEmotes();
    loadChannelIds();
    addButtonEffects();
    initDebugSection(); // Add this line
  }
  
  init();
}); 