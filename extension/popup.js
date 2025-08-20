
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

  async storeEmote(key, url, dataUrl, metadata = {}) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emotes'], 'readwrite');
      const store = transaction.objectStore('emotes');

      const emoteData = {
        key: key,
        url: url,
        html: `<img src="${dataUrl}">`,
        dataUrl: dataUrl,
        timestamp: Date.now(),
        ...metadata
      };

      const request = store.put(emoteData);
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
  // Remove this line as it's declared too early

  // Progress and storage elements
  const downloadProgress = document.getElementById('download-progress');
  const progressText = document.getElementById('progress-text');
  const progressCount = document.getElementById('progress-count');
  const progressFill = document.getElementById('progress-fill');
  const channelManagement = document.getElementById('channel-management');
  const channelList = document.getElementById('channel-list');
  const totalEmotesCount = document.getElementById('total-emotes-count');
  const storageUsed = document.getElementById('storage-used');
  const channelsCount = document.getElementById('channels-count');
  const clearAllStorageBtn = document.getElementById('clear-all-storage');

  // Constants
  const ITEMS_PER_PAGE = 30;

  // State variables
  let allEmotes = {};
  let channels = [];
  let displayedEmotes = [];
  let currentPage = 1;
  let searchTerm = '';
  let emoteDataMap = new Map();

  // Notification function
  function showToast(message, type = 'info') {
    console.log('showToast called:', message, type);
    const notification = document.getElementById('notification');
    console.log('notification element:', notification);

    if (!notification) {
      console.error('Notification element not found');
      return;
    }

    notification.textContent = message;
    notification.className = 'notification';

    if (type === 'success') {
      notification.classList.add('notification-success');
    } else if (type === 'error') {
      notification.classList.add('notification-error');
    } else {
      notification.classList.add('notification-info');
    }

    notification.classList.remove('hidden');
    console.log('Notification should be visible now');

    setTimeout(() => {
      notification.classList.add('hidden');
      notification.className = 'notification hidden';
      console.log('Notification hidden');
    }, 3000);
  }

  // Custom modal confirmation function
  function showConfirmDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel', isDangerous = false) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmation-modal');
      const modalTitle = document.getElementById('modal-title');
      const modalMessage = document.getElementById('modal-message');
      const confirmBtn = document.getElementById('modal-confirm');
      const cancelBtn = document.getElementById('modal-cancel');

      modalTitle.textContent = title;
      modalMessage.textContent = message;
      confirmBtn.innerHTML = `<span>${confirmText}</span>`;
      cancelBtn.innerHTML = `<span>${cancelText}</span>`;

      // Style confirm button based on action type
      confirmBtn.className = isDangerous ? 'danger-button' : 'primary-button';

      modal.classList.remove('hidden');

      const handleConfirm = () => {
        modal.classList.add('hidden');
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        modal.classList.add('hidden');
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleOverlayClick);
      };

      const handleOverlayClick = (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      modal.addEventListener('click', handleOverlayClick);
    });
  }

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



  // Reset emote loading state
  function resetEmoteLoadingState(emoteElement) {
    if (emoteElement) {
      emoteElement.classList.remove('loading');
      const img = emoteElement.querySelector('.emote-image');
      if (img) {
        img.style.opacity = '';
      }
      const spinner = emoteElement.querySelector('.emote-loading-spinner');
      if (spinner) {
        spinner.remove();
      }
    }
  }

  // Insert emote into active text field on messenger.com
  function insertEmoteIntoActiveTab(emoteTrigger, emoteElement = null) {
    // Show loading state on the emote element
    if (emoteElement) {
      emoteElement.classList.add('loading');
      const img = emoteElement.querySelector('.emote-image');
      if (img) {
        img.style.opacity = '0.5';
      }
      const loadingSpinner = document.createElement('div');
      loadingSpinner.className = 'emote-loading-spinner';
      loadingSpinner.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      emoteElement.appendChild(loadingSpinner);
    }

    // Find active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        showToast('No active tab found', 'error');
        if (emoteElement) resetEmoteLoadingState(emoteElement);
        return;
      }

      const currentTab = tabs[0];

      // Detect platform and show warnings
      let currentPlatform = null;
      if (currentTab.url.includes('messenger.com')) currentPlatform = 'messenger';
      else if (currentTab.url.includes('discord.com') || currentTab.url.includes('discordapp.com')) currentPlatform = 'discord';
      else if (currentTab.url.includes('facebook.com')) currentPlatform = 'facebook';
      else if (currentTab.url.includes('telegram.org')) currentPlatform = 'telegram';
      else if (currentTab.url.includes('web.whatsapp.com')) currentPlatform = 'whatsapp';

      // Show platform-specific warnings
      showPlatformWarning(currentPlatform, currentTab.url);

      // Check if the current tab is on a supported platform
      const isSupportedPlatform = currentPlatform !== null;

      if (!isSupportedPlatform) {
        showToast('This feature only works on supported platforms', 'error');
        if (emoteElement) resetEmoteLoadingState(emoteElement);

        // Add diagnostic info
        const diagInfo = document.createElement('div');
        diagInfo.className = 'diagnostic-info';
        diagInfo.innerHTML = `
          <div class="diagnostic-header">
            <h3>Unsupported Platform</h3>
            <p>Current URL: <code>${currentTab.url}</code></p>
            <p>This feature works on:</p>
            <ul>
              <li><code>messenger.com</code></li>
              <li><code>discord.com</code></li>
              <li><code>facebook.com</code></li>
              <li><code>telegram.org</code></li>
              <li><code>web.whatsapp.com</code> (Note: GIFs may not work due to WhatsApp limitations)</li>
            </ul>
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
          showToast('Emote not found', 'error');
          if (emoteElement) resetEmoteLoadingState(emoteElement);
          return;
        }

        const emoteUrl = result.emoteMapping[emoteTrigger];

        // Show loading indicator
        showToast('Inserting emote...', 'loading');

        try {
          // Send message to content script to handle the insertion
          chrome.tabs.sendMessage(currentTab.id, {
            action: 'insertEmote',
            emoteTrigger: emoteTrigger
          }, (response) => {
            // Reset loading state
            if (emoteElement) resetEmoteLoadingState(emoteElement);

            // Check for connection errors
            if (chrome.runtime.lastError) {
              console.error('[Mojify] Connection error:', chrome.runtime.lastError);
              showToast('Connection error - try refreshing the page', 'error');
              return;
            }

            if (response && response.success) {
              showToast('Emote inserted successfully!');
            } else {
              const error = response && response.error ? response.error : 'Unknown error';
              showToast(`Error: ${error}`, 'error');

              // Add diagnostic info for insertion error
              const diagInfo = document.createElement('div');
              diagInfo.className = 'diagnostic-info';
              diagInfo.innerHTML = `
                <div class="diagnostic-header">
                  <h3>Insertion Failed</h3>
                  <p>Error: ${error}</p>
                  <p>Make sure you're on a supported platform (Messenger, Discord, Facebook, Telegram, or WhatsApp) and try clicking in the message input field first</p>
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
          console.error('Mojify Error:', error);
          showToast(`Error: ${error.message}`, 'error');
          if (emoteElement) resetEmoteLoadingState(emoteElement);
        }
      });
    });
  }

  // Load emotes from storage
  async function loadEmotes() {
    try {
      // Initialize IndexedDB if needed
      if (!emoteDB.db) {
        await emoteDB.init();
      }

      // Get metadata from chrome.storage
      const storageData = await new Promise((resolve) => {
        chrome.storage.local.get(['emoteMapping', 'channels'], resolve);
      });

      console.log('Loaded storage data:', storageData);

      if (storageData.emoteMapping && Object.keys(storageData.emoteMapping).length > 0) {
        allEmotes = storageData.emoteMapping;
        channels = storageData.channels || [];

        console.log('All emotes count:', Object.keys(allEmotes).length);
        console.log('Channels count:', channels.length);

        // Get all emotes from IndexedDB
        const indexedDBEmotes = await emoteDB.getAllEmotes();
        console.log('IndexedDB emotes count:', indexedDBEmotes.length);

        // Update global emoteDataMap for quick lookup
        emoteDataMap.clear();
        indexedDBEmotes.forEach(emote => {
          emoteDataMap.set(emote.key, emote);
        });

        // Process channels using only IndexedDB data
        if (channels.length > 0) {
          channels.forEach(channel => {
            if (channel.emotes) {
              const processedEmotes = {};
              Object.entries(channel.emotes).forEach(([key, url]) => {
                const emoteData = emoteDataMap.get(key);
                // Only include emotes that exist in IndexedDB
                if (emoteData) {
                  processedEmotes[key] = {
                    url: emoteData.url,
                    hasImageData: true,
                    dataUrl: emoteData.dataUrl
                  };
                }
              });
              channel.emotes = processedEmotes;
            }
          });
        }

        // If we have emotes but no channels (for backward compatibility)
        if (channels.length === 0) {
          const channelIds = await new Promise((resolve) => {
            chrome.storage.local.get(['channelIds'], (result) => resolve(result.channelIds));
          });

          if (channelIds && channelIds.length > 0) {
            // Create a single channel with emotes from IndexedDB only
            const processedEmotes = {};
            indexedDBEmotes.forEach(emoteData => {
              if (emoteData.key && emoteData.dataUrl) {
                processedEmotes[emoteData.key] = {
                  url: emoteData.url,
                  hasImageData: true,
                  dataUrl: emoteData.dataUrl
                };
              }
            });

            channels = [{
              id: 'all',
              username: 'All Emotes',
              emotes: processedEmotes
            }];
            console.log('Created fallback channel with all emotes');
          }
        }

        updateEmoteCount();
        filterAndDisplayEmotes();
        updateStorageInfo();
        updateChannelManagement();
        noEmotesMessage.style.display = 'none';
      } else {
        emoteGrid.innerHTML = '';
        noEmotesMessage.style.display = 'flex';
        loadMoreContainer.classList.add('hidden');
        emoteCount.textContent = '0';
        updateStorageInfo();
        updateChannelManagement();
      }
    } catch (error) {
      console.error('Error loading emotes:', error);
      emoteGrid.innerHTML = '';
      noEmotesMessage.style.display = 'flex';
      loadMoreContainer.classList.add('hidden');
      emoteCount.textContent = '0';
    }
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

    // If we're searching, show search results in channel format
    if (searchTerm !== '') {
      const emotesToShow = displayedEmotes.slice(startIndex, endIndex);

      console.log(`Showing search results: ${emotesToShow.length} emotes (${startIndex}-${endIndex} of ${displayedEmotes.length})`);

      // Create a search results section similar to channel format
      const searchSection = document.createElement('div');
      searchSection.className = 'channel-section';

      // Create search header
      const searchHeader = document.createElement('div');
      searchHeader.className = 'channel-header';
      searchHeader.innerHTML = `
        <div class="channel-header-content">
          <span class="channel-name">Search Results</span>
          <span class="channel-emote-count">${emotesToShow.length} emotes</span>
        </div>
      `;

      // Create search emotes container
      const searchEmotes = document.createElement('div');
      searchEmotes.className = 'channel-emotes';

      emotesToShow.forEach(key => {
        const emoteName = key.replace(/:/g, '');

        // Get emote data from IndexedDB
        const emoteDbData = emoteDataMap.get(key);

        // Only render if we have IndexedDB data
        if (emoteDbData?.dataUrl) {
          const emoteItem = document.createElement('div');
          emoteItem.className = 'emote-item';
          emoteItem.setAttribute('data-emote-key', key);

          emoteItem.innerHTML = `
            <div class="emote-img-container">
              <img src="${emoteDbData.dataUrl}" alt="${emoteName}" class="emote-img">
            </div>
            <div class="emote-details">
              <div class="emote-name">${emoteName}</div>
              <div class="emote-trigger">${key}</div>
            </div>
          `;

          // Add click event to insert emote
          emoteItem.addEventListener('click', () => {
            insertEmoteIntoActiveTab(key, emoteItem);
          });

          searchEmotes.appendChild(emoteItem);
        }
      });

      searchSection.appendChild(searchHeader);
      searchSection.appendChild(searchEmotes);
      emoteGrid.appendChild(searchSection);

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

        Object.entries(channel.emotes).forEach(([key, emoteData]) => {
          const emoteName = key.replace(/:/g, '');

          // Get emote data from IndexedDB
          const emoteDbData = emoteDataMap.get(key);

          // Only render if we have IndexedDB data
          if (emoteDbData?.dataUrl) {
            const emoteItem = document.createElement('div');
            emoteItem.className = 'emote-item';
            emoteItem.setAttribute('data-emote-key', key);

            emoteItem.innerHTML = `
              <div class="emote-img-container">
                <img src="${emoteDbData.dataUrl}" alt="${emoteName}" class="emote-img">
              </div>
              <div class="emote-details">
                <div class="emote-name">${emoteName}</div>
              <div class="emote-trigger">${key}</div>
            `;

            // Add click event to insert emote
            emoteItem.addEventListener('click', () => {
              insertEmoteIntoActiveTab(key, emoteItem);
            });

            channelEmotes.appendChild(emoteItem);
          }
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

      // Update related UI components
      updateChannelManagement();
      updateStorageInfo();
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
      if (channelIds.length === 0) {
        // Channel IDs were cleared
        showToast('Channel IDs cleared');

        // Clear any existing download progress
        downloadProgress.classList.add('hidden');

        // Clear storage data
        chrome.storage.local.remove(['downloadInProgress', 'downloadProgress'], () => {
          loadEmotes(); // Reload emotes (will show empty state)
          updateChannelManagement();
          updateStorageInfo();
        });
      } else {
        // Channel IDs were saved
        showToast('Channel IDs saved - emotes will download automatically');

        // Set up progress monitoring for the automatic download that will be triggered by storage listener
        setTimeout(() => {
          // Show loading state and progress
          downloadProgress.classList.remove('hidden');
          progressFill.style.width = '0%';
          progressText.textContent = 'Starting automatic download...';
          progressCount.textContent = '0/0';

          const progressListener = (message) => {
            if (message.type === 'downloadProgress') {
              const { current, total, currentEmote, completed, newEmote } = message;
              const percentage = total > 0 ? (current / total) * 100 : 0;

              progressFill.style.width = `${percentage}%`;
              progressCount.textContent = `${current}/${total}`;
              progressText.textContent = currentEmote ? `Downloading: ${currentEmote}` : 'Downloading emotes...';

              if (newEmote) {
                loadEmotes();
              }

              if (completed) {
                setTimeout(() => {
                  downloadProgress.classList.add('hidden');
                  chrome.runtime.onMessage.removeListener(progressListener);
                  loadEmotes();
                  showToast('Emotes downloaded successfully');
                }, 1000);
              }
            }
          };

          chrome.runtime.onMessage.addListener(progressListener);

          // Start polling for progress in case popup closes and reopens
          startProgressPolling();
        }, 500); // Small delay to show the save success message first
      }
    });
  });

  // Clear all storage
  clearAllStorageBtn.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'Clear All Data',
      'This will delete all emote data and channel IDs permanently.',
      'Clear All',
      'Cancel',
      true
    );

    if (!confirmed) {
      return;
    }

    // Clear all storage including channelIds - this will trigger automatic cleanup via storage listener
    chrome.storage.local.clear(() => {
      // Also clear the channel IDs input field
      channelIdsInput.value = '';

      // Hide progress if showing
      downloadProgress.classList.add('hidden');

      // Reset UI
      loadEmotes();
      updateChannelManagement();
      updateStorageInfo();

      showToast('All data cleared successfully');
    });
  });

  // Download/refresh emotes
  downloadButton.addEventListener('click', () => {
    // Check if download is already in progress
    chrome.storage.local.get(['downloadInProgress'], (result) => {
      if (result.downloadInProgress) {
        showToast('Download already in progress', 'error');
        return;
      }

      // Check if there are channel IDs configured
      chrome.storage.local.get(['channelIds'], (checkResult) => {
        if (!checkResult.channelIds || checkResult.channelIds.length === 0) {
          showToast('No channel IDs configured', 'error');

          // Switch to settings tab
          document.querySelector('.tab-btn[data-tab="settings"]').click();
          return;
        }

        // Show loading state and progress
        downloadButton.disabled = true;
        downloadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Downloading...</span>';
        downloadProgress.classList.remove('hidden');
        progressFill.style.width = '0%';
        progressText.textContent = 'Starting download...';
        progressCount.textContent = '0/0';

        // Listen for progress updates
        const progressListener = (message) => {
          if (message.type === 'downloadProgress') {
            const { current, total, currentEmote, completed, newEmote } = message;
            const percentage = total > 0 ? (current / total) * 100 : 0;

            progressFill.style.width = `${percentage}%`;
            progressCount.textContent = `${current}/${total}`;
            progressText.textContent = currentEmote ? `Downloading: ${currentEmote}` : 'Downloading emotes...';

            if (newEmote) {
              loadEmotes();
            }

            if (completed) {
              setTimeout(() => {
                downloadButton.disabled = false;
                downloadButton.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh Emotes</span>';
                downloadProgress.classList.add('hidden');
                chrome.runtime.onMessage.removeListener(progressListener);
                loadEmotes();
              }, 1000);
            }
          }
        };

        chrome.runtime.onMessage.addListener(progressListener);

        // Start polling for progress in case popup closes and reopens
        startProgressPolling();

        chrome.runtime.sendMessage({ type: 'downloadEmotes' }, (response) => {
          if (response && response.success) {
            if (response.message === "All emotes up to date") {
              showToast('All emotes are up to date - no new downloads needed');
            } else {
              showToast('Emotes downloaded successfully');
            }
            loadEmotes(); // Reload emotes
            searchInput.value = ''; // Clear search
            searchTerm = '';
          } else {
            showToast(`Error downloading emotes: ${response?.error || 'Unknown error'}`, 'error');
            downloadButton.disabled = false;
            downloadButton.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh Emotes</span>';
            downloadProgress.classList.add('hidden');
          }

          // Remove progress listener
          chrome.runtime.onMessage.removeListener(progressListener);
        });
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
    const testDragDropBtn = document.getElementById('debug-test-dragdrop');
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

    // Test drag and drop functionality
    testDragDropBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          setDebugResult('No active tab found', 'error');
          return;
        }

        const currentTab = tabs[0];

        setDebugResult('Testing drag and drop...', 'loading');

        chrome.tabs.sendMessage(currentTab.id, { action: 'testDragDrop' }, (response) => {
          if (response && response.success) {
            setDebugResult('Drag and drop test completed successfully', 'success');
          } else {
            const error = response && response.error ? response.error : 'Test failed';
            setDebugResult(`Drag and drop test failed: ${error}`, 'error');
          }
        });
      });
    });

    // Test basic functionality
    const testBasicBtn = document.getElementById('debug-test-basic');
    testBasicBtn.addEventListener('click', () => {
      setDebugResult('Testing basic functionality...', 'loading');

      chrome.runtime.sendMessage({ type: 'testBasicFunctionality' }, (response) => {
        if (response && response.success) {
          setDebugResult('Basic functionality test passed: ' + response.message, 'success');
        } else {
          const error = response && response.error ? response.error : response.message || 'Test failed';
          setDebugResult(`Basic functionality test failed: ${error}`, 'error');
        }
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

  // Storage and channel management functions
  function updateStorageInfo() {
    chrome.storage.local.get(['emoteMapping', 'channels', 'emoteImageData'], (result) => {
      const emoteCount = result.emoteMapping ? Object.keys(result.emoteMapping).length : 0;
      const channelCount = result.channels ? result.channels.length : 0;

      totalEmotesCount.textContent = emoteCount;
      channelsCount.textContent = channelCount;

      // Calculate storage usage
      let totalSize = 0;
      if (result.emoteImageData) {
        Object.values(result.emoteImageData).forEach(emote => {
          if (emote.size) {
            totalSize += emote.size;
          }
        });
      }

      // Convert bytes to appropriate unit
      let sizeText = '0 KB';
      if (totalSize > 0) {
        if (totalSize < 1024) {
          sizeText = `${totalSize} B`;
        } else if (totalSize < 1024 * 1024) {
          sizeText = `${(totalSize / 1024).toFixed(1)} KB`;
        } else {
          sizeText = `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
        }
      }

      storageUsed.textContent = sizeText;
    });
  }

  function updateChannelManagement() {
    chrome.storage.local.get(['channels'], (result) => {
      const channels = result.channels || [];

      if (channels.length > 0) {
        channelManagement.style.display = 'block';
        channelList.innerHTML = '';

        channels.forEach(channel => {
          const emoteCount = channel.emotes ? Object.keys(channel.emotes).length : 0;

          const channelItem = document.createElement('div');
          channelItem.className = 'channel-item';
          channelItem.innerHTML = `
            <div class="channel-info">
              <div class="channel-name">${channel.username}</div>
              <div class="channel-stats">${emoteCount} emotes</div>
            </div>
            <div class="channel-actions">
              <button class="delete-channel-btn" data-channel-id="${channel.id}">
                <i class="fas fa-trash"></i> Delete
              </button>
            </div>
          `;

          channelList.appendChild(channelItem);
        });

        // Add delete channel handlers
        channelList.querySelectorAll('.delete-channel-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const channelId = e.target.closest('.delete-channel-btn').dataset.channelId;
            deleteChannel(channelId);
          });
        });
      } else {
        channelManagement.style.display = 'none';
      }
    });
  }

  async function deleteChannel(channelId) {
    const confirmed = await showConfirmDialog(
      'Delete Channel',
      'Are you sure you want to delete this channel and all its emotes? This action cannot be undone.',
      'Delete',
      'Cancel',
      true
    );

    if (!confirmed) {
      return;
    }

    chrome.storage.local.get(['channels', 'emoteMapping', 'emoteImageData'], (result) => {
      const channels = result.channels || [];
      const emoteMapping = result.emoteMapping || {};
      const emoteImageData = result.emoteImageData || {};

      // Find the channel to delete
      const channelIndex = channels.findIndex(c => c.id === channelId);
      if (channelIndex === -1) return;

      const channel = channels[channelIndex];

      // Remove emotes from global mappings
      if (channel.emotes) {
        Object.keys(channel.emotes).forEach(emoteKey => {
          delete emoteMapping[emoteKey];
          delete emoteImageData[emoteKey];
        });
      }

      // Remove channel
      channels.splice(channelIndex, 1);

      // Save updated data
      chrome.storage.local.set({
        channels,
        emoteMapping,
        emoteImageData
      }, () => {
        showToast(`Channel "${channel.username}" deleted successfully`);
        loadEmotes();
      });
    });
  }

  // Clear all storage handler
  clearAllStorageBtn.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'Delete All Emote Data',
      'This will permanently delete all emote data.',
      'Delete All',
      'Cancel',
      true
    );

    if (!confirmed) {
      return;
    }

    chrome.storage.local.clear(() => {
      showToast('All emote data cleared');
      loadEmotes();
    });
  });

  // Check for ongoing downloads
  function checkDownloadStatus() {
    chrome.storage.local.get(['downloadInProgress', 'downloadProgress'], (result) => {
      if (result.downloadInProgress) {
        downloadButton.disabled = true;
        downloadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Downloading...</span>';
        downloadProgress.classList.remove('hidden');

        if (result.downloadProgress) {
          const { current, total, currentEmote } = result.downloadProgress;
          const percentage = total > 0 ? (current / total) * 100 : 0;
          progressFill.style.width = `${percentage}%`;
          progressCount.textContent = `${current}/${total}`;
          progressText.textContent = currentEmote ? `Downloading: ${currentEmote}` : 'Downloading emotes...';
        }

        startProgressPolling();
      } else if (result.downloadProgress?.completed) {
        loadEmotes();
        showToast('Emotes downloaded successfully');
        chrome.storage.local.remove(['downloadProgress']);
      } else if (result.downloadProgress?.error) {
        showToast(`Download failed: ${result.downloadProgress.error}`, 'error');
        chrome.storage.local.remove(['downloadProgress']);
      }
    });
  }

  function startProgressPolling() {
    const pollInterval = setInterval(() => {
      chrome.storage.local.get(['downloadInProgress', 'downloadProgress'], (result) => {
        if (!result.downloadInProgress) {
          clearInterval(pollInterval);
          downloadButton.disabled = false;
          downloadButton.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh Emotes</span>';
          downloadProgress.classList.add('hidden');

          if (result.downloadProgress?.completed) {
            loadEmotes();
            showToast('Emotes downloaded successfully');
          } else if (result.downloadProgress?.error) {
            showToast(`Download failed: ${result.downloadProgress.error}`, 'error');
          }

          chrome.storage.local.remove(['downloadProgress']);
        } else if (result.downloadProgress) {
          const { current, total, currentEmote } = result.downloadProgress;
          const percentage = total > 0 ? (current / total) * 100 : 0;
          progressFill.style.width = `${percentage}%`;
          progressCount.textContent = `${current}/${total}`;
          progressText.textContent = currentEmote ? `Downloading: ${currentEmote}` : 'Downloading emotes...';

          if (current > 0 && current % 5 === 0) {
            loadEmotes();
          }
        }
      });
    }, 1000);
  }

  // Listen for automatic download notifications from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Add error handling for message listeners
    try {
      if (message.type === 'automaticDownloadStarted') {
        showToast(`Starting automatic download for ${message.channelIds.length} channel(s)`);

        // Show progress UI if not already shown
        if (downloadProgress.classList.contains('hidden')) {
          downloadProgress.classList.remove('hidden');
          progressFill.style.width = '0%';
          progressText.textContent = 'Starting automatic download...';
          progressCount.textContent = '0/0';
        }
      }

    // Handle download progress updates
    if (message.type === 'downloadProgress') {
      const { current, total, currentEmote, newEmote, completed } = message;

      if (!downloadProgress.classList.contains('hidden')) {
        const percentage = total > 0 ? (current / total) * 100 : 0;
        progressFill.style.width = `${percentage}%`;
        progressCount.textContent = `${current}/${total}`;
        progressText.textContent = currentEmote ? `Downloading: ${currentEmote}` : 'Downloading emotes...';
      }

      if (newEmote) {
        loadEmotes();
      }

      if (completed) {
        setTimeout(() => {
          downloadProgress.classList.add('hidden');
          loadEmotes();
          showToast('Download completed successfully');
        }, 1000);
      }
    }

      // Handle toast notifications from background script
      if (message.type === 'showToast') {
        showToast(message.message, message.toastType || 'success');
      }
    } catch (error) {
      console.error('[Mojify] Error in message listener:', error);
    }
  });

  // Check download status and reset UI if needed
  function checkDownloadStatus() {
    chrome.storage.local.get(['downloadInProgress', 'downloadProgress'], (result) => {
      const downloadInProgress = result.downloadInProgress;
      const downloadProgressData = result.downloadProgress;

      // If download progress has reset flag or no actual download in progress
      if (downloadProgressData?.reset || !downloadInProgress) {
        console.log('[Popup] Clearing stuck download progress UI');

        // Hide progress UI
        downloadProgress.classList.add('hidden');

        // Reset progress elements
        progressFill.style.width = '0%';
        progressText.textContent = '';
        progressCount.textContent = '0/0';

        // Clear the reset flag
        if (downloadProgressData?.reset) {
          chrome.storage.local.set({
            downloadProgress: {
              current: 0,
              total: 0,
              completed: false,
              reset: false
            }
          });
        }
      } else if (downloadInProgress && downloadProgressData) {
        // Resume showing progress if actually downloading
        console.log('[Popup] Resuming download progress display');
        downloadProgress.classList.remove('hidden');

        const { current, total, currentEmote } = downloadProgressData;
        const percentage = total > 0 ? (current / total) * 100 : 0;

        progressFill.style.width = `${percentage}%`;
        progressCount.textContent = `${current}/${total}`;
        progressText.textContent = currentEmote || 'Downloading emotes...';
      }
    });
  }

  // Show platform-specific warnings
  function showPlatformWarning(platform, url) {
    // Remove any existing warning
    const existingWarning = document.querySelector('.platform-warning');
    if (existingWarning) {
      existingWarning.remove();
    }

    if (platform === 'whatsapp') {
      const warningDiv = document.createElement('div');
      warningDiv.className = 'platform-warning';
      warningDiv.style.cssText = `
        background-color: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 4px;
        padding: 10px;
        margin: 10px 0;
        color: #856404;
        font-size: 12px;
        text-align: center;
      `;
      warningDiv.innerHTML = `
        <strong>WhatsApp Limitation:</strong><br>
        GIFs may not work properly due to WhatsApp's restrictions.<br>
        This is a WhatsApp limitation, not an extension issue.
      `;

      // Insert above the emotes container
      const emotesContainer = document.querySelector('.emotes-container');
      if (emotesContainer) {
        emotesContainer.parentNode.insertBefore(warningDiv, emotesContainer);
      } else {
        // Fallback: insert after the emote stats
        const emoteStats = document.querySelector('.emote-stats');
        if (emoteStats && emoteStats.parentNode) {
          emoteStats.parentNode.insertBefore(warningDiv, emoteStats.nextSibling);
        }
      }
    }
  }

  // Initialize
  function init() {
    initTabs();
    loadEmotes();
    loadChannelIds();
    addButtonEffects();
    initDebugSection();
    checkDownloadStatus();
    initSaveButton();

    // Check current platform and show warnings
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const currentTab = tabs[0];
        let currentPlatform = null;
        if (currentTab.url.includes('messenger.com')) currentPlatform = 'messenger';
        else if (currentTab.url.includes('discord.com') || currentTab.url.includes('discordapp.com')) currentPlatform = 'discord';
        else if (currentTab.url.includes('facebook.com')) currentPlatform = 'facebook';
        else if (currentTab.url.includes('telegram.org')) currentPlatform = 'telegram';
        else if (currentTab.url.includes('web.whatsapp.com')) currentPlatform = 'whatsapp';

        showPlatformWarning(currentPlatform, currentTab.url);
      }
    });
  }

  init();
  initBackupRestore();
  initDownloadButton();
  // Backup and Restore functionality
  function initBackupRestore() {
    const createBackupBtn = document.getElementById('create-backup');
    const restoreBackupBtn = document.getElementById('restore-backup');
    const restoreFileInput = document.getElementById('restore-file');

    createBackupBtn.addEventListener('click', createBackup);
    restoreBackupBtn.addEventListener('click', () => restoreFileInput.click());
    restoreFileInput.addEventListener('change', handleRestoreFile);
  }

  // Download button functionality
  function initDownloadButton() {
    const downloadButton = document.getElementById('download-button');

    if (downloadButton) {
      downloadButton.addEventListener('click', handleManualRefresh);
    }
  }

  async function handleManualRefresh() {
    const downloadButton = document.getElementById('download-button');

    try {
      downloadButton.disabled = true;
      downloadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Refreshing...</span>';

      // Set manual refresh flag to bypass restore skip logic
      await new Promise((resolve) => {
        chrome.storage.local.set({ manualRefresh: true }, resolve);
      });

      // Trigger download
      chrome.runtime.sendMessage({ action: 'downloadEmotes' }, (response) => {
        if (response && response.success) {
          if (response.skipped) {
            showToast(response.message, 'info');
          } else {
            showToast('Emotes refresh started', 'success');
            startProgressPolling();
          }
        } else {
          showToast('Refresh failed: ' + (response?.error || 'Unknown error'), 'error');
        }
      });

    } catch (error) {
      console.error('Manual refresh failed:', error);
      showToast('Refresh failed: ' + error.message, 'error');
    } finally {
      downloadButton.disabled = false;
      downloadButton.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh Emotes</span>';
    }
  }

// Save button functionality
function initSaveButton() {
  const saveButton = document.getElementById('save-button');
  const channelIdsInput = document.getElementById('channel-ids');
  const clearStorageButton = document.getElementById('clear-all-storage');

  if (saveButton) {
    saveButton.addEventListener('click', saveChannelIds);
  }

  if (clearStorageButton) {
    clearStorageButton.addEventListener('click', clearAllStorage);
  }
}

async function saveChannelIds() {
  const saveButton = document.getElementById('save-button');
  const channelIdsInput = document.getElementById('channel-ids');

  if (!channelIdsInput || !saveButton) return;

  const input = channelIdsInput.value.trim();
  if (!input) {
    showToast('Please enter at least one channel ID', 'error');
    return;
  }

  try {
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Saving...</span>';

    // Parse channel IDs (support both newline and comma separation)
    const channelIds = input
      .split(/[,\n]/)
      .map(id => id.trim())
      .filter(id => id.length > 0);

    if (channelIds.length === 0) {
      showToast('Please enter valid channel IDs', 'error');
      return;
    }

    // Check if emotes were recently restored
    const { skipNextDownload, lastRestoreTime } = await new Promise((resolve) => {
      chrome.storage.local.get(['skipNextDownload', 'lastRestoreTime'], resolve);
    });

    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    const shouldSkipDownload = skipNextDownload || (lastRestoreTime && lastRestoreTime > tenMinutesAgo);

    // Save channel IDs
    await new Promise((resolve) => {
      chrome.storage.local.set({ channelIds }, resolve);
    });

    showToast(`Saved ${channelIds.length} channel ID(s)`, 'success');

    if (shouldSkipDownload) {
      showToast('Skipping download - emotes recently restored', 'info');
    } else {
      // Trigger download
      chrome.runtime.sendMessage({ action: 'downloadEmotes' }, (response) => {
        if (response && response.success) {
          if (response.skipped) {
            showToast(response.message, 'info');
          } else {
            showToast('Emotes download started', 'success');
            startProgressPolling();
          }
        } else {
          showToast('Download failed: ' + (response?.error || 'Unknown error'), 'error');
        }
      });
    }

    // Update UI
    updateChannelManagement();
    updateStorageInfo();

  } catch (error) {
    console.error('Save failed:', error);
    showToast('Save failed: ' + error.message, 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = '<i class="fas fa-save"></i> <span>Save Channel IDs</span>';
  }
}

async function clearAllStorage() {
  const clearButton = document.getElementById('clear-all-storage');

  const confirmed = await showConfirmDialog(
    'Clear All Data',
    'This will permanently delete ALL emotes, channels, settings, and minibar positions. This action cannot be undone.',
    'Delete All',
    'Cancel',
    true
  );

  if (!confirmed) {
    return;
  }

  try {
    clearButton.disabled = true;
    clearButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Clearing...</span>';

    // Clear Chrome storage
    await new Promise((resolve) => {
      chrome.storage.local.clear(resolve);
    });

    // Clear IndexedDB
    if (emoteDB.db) {
      await emoteDB.clearAll();
    }

    // Clear localStorage positions
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mojify-suggestion-pos-')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    showToast('All data cleared successfully', 'success');

    // Reset UI
    document.getElementById('channel-ids').value = '';
    loadEmotes();
    updateChannelManagement();
    updateStorageInfo();
  } catch (error) {
    console.error('Clear storage failed:', error);
    showToast('Clear failed: ' + error.message, 'error');
  } finally {
    clearButton.disabled = false;
    clearButton.innerHTML = '<i class="fas fa-trash"></i> <span>Clear All Data</span>';
  }
}

  async function createBackup() {
  const backupBtn = document.getElementById('create-backup');
  const progressContainer = document.getElementById('backup-progress');
  const progressText = document.getElementById('backup-progress-text');
  const progressFill = document.getElementById('backup-progress-fill');

  try {
    backupBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    progressText.textContent = 'Preparing backup...';
    progressFill.style.width = '10%';

    const backupData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      data: {}
    };

    // Get Chrome storage data
    progressText.textContent = 'Backing up settings...';
    progressFill.style.width = '20%';

    const chromeStorageData = await new Promise((resolve) => {
      chrome.storage.local.get(null, resolve);
    });

    // Process chrome storage to reduce size
    const processedChromeStorage = {};
    for (const [key, value] of Object.entries(chromeStorageData)) {
      if (key === 'emoteImageData') {
        // Skip large image data, we'll get it from IndexedDB
        continue;
      }
      processedChromeStorage[key] = value;
    }
    backupData.data.chromeStorage = processedChromeStorage;

    // Get IndexedDB emote data in chunks
    progressText.textContent = 'Backing up emotes...';
    progressFill.style.width = '40%';

    const emoteData = [];
    if (emoteDB.db) {
      try {
        const allEmotes = await emoteDB.getAllEmotes();
        // Process emotes to include only essential data
        for (const emote of allEmotes) {
          emoteData.push({
            key: emote.key,
            url: emote.url,
            dataUrl: emote.dataUrl,
            channel: emote.channel,
            timestamp: emote.timestamp
          });
        }
        backupData.data.indexedDBEmotes = emoteData;
      } catch (dbError) {
        console.warn('Could not backup IndexedDB emotes:', dbError);
        backupData.data.indexedDBEmotes = [];
      }
    }

    // Get localStorage data (minibar positions)
    progressText.textContent = 'Backing up positions...';
    progressFill.style.width = '60%';

    const localStorageData = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('mojify-suggestion-pos-')) {
          localStorageData[key] = localStorage.getItem(key);
        }
      }
    } catch (lsError) {
      console.warn('Could not access localStorage:', lsError);
    }
    backupData.data.localStorage = localStorageData;

    // Create backup file with compression
    progressText.textContent = 'Creating backup file...';
    progressFill.style.width = '80%';

    // Convert to JSON string without pretty printing to reduce size
    const jsonString = JSON.stringify(backupData);

    // Check size and warn if too large
    const sizeInMB = new Blob([jsonString]).size / (1024 * 1024);
    if (sizeInMB > 50) {
      const confirmed = await showConfirmDialog(
        'Large Backup File',
        `Backup file is ${sizeInMB.toFixed(1)}MB. This may take time to download. Continue?`,
        'Download',
        'Cancel'
      );
      if (!confirmed) {
        throw new Error('Backup cancelled by user');
      }
    }

    const blob = new Blob([jsonString], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mojify-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    progressText.textContent = 'Backup completed!';
    progressFill.style.width = '100%';

    showToast(`Backup created successfully! (${sizeInMB.toFixed(1)}MB)`, 'success');

    setTimeout(() => {
      progressContainer.classList.add('hidden');
      progressFill.style.width = '0%';
    }, 2000);

  } catch (error) {
    console.error('Backup failed:', error);
    showToast('Backup failed: ' + error.message, 'error');
    progressContainer.classList.add('hidden');
  } finally {
    backupBtn.disabled = false;
  }
  }

  async function handleRestoreFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const progressContainer = document.getElementById('backup-progress');
  const progressText = document.getElementById('backup-progress-text');
  const progressFill = document.getElementById('backup-progress-fill');

  try {
    progressContainer.classList.remove('hidden');
    progressText.textContent = 'Reading backup file...';
    progressFill.style.width = '5%';

    // Check file size
    const fileSizeInMB = file.size / (1024 * 1024);
    if (fileSizeInMB > 100) {
      const confirmed = await showConfirmDialog(
        'Large Backup File',
        `Large backup file (${fileSizeInMB.toFixed(1)}MB). This may take time to process. Continue?`,
        'Process',
        'Cancel'
      );
      if (!confirmed) {
        throw new Error('Restore cancelled by user');
      }
    }

    const fileContent = await file.text();
    progressFill.style.width = '15%';

    let backupData;
    try {
      backupData = JSON.parse(fileContent);
    } catch (parseError) {
      throw new Error('Invalid JSON format in backup file');
    }

    if (!backupData.version || !backupData.data) {
      throw new Error('Invalid backup file format');
    }

    // Show backup info
    const emoteCount = backupData.data.indexedDBEmotes ? backupData.data.indexedDBEmotes.length : 0;
    const channelCount = backupData.data.chromeStorage && backupData.data.chromeStorage.channels ?
                        backupData.data.chromeStorage.channels.length : 0;
    const positionCount = backupData.data.localStorage ? Object.keys(backupData.data.localStorage).length : 0;

    const confirmMessage = `Restore backup from ${new Date(backupData.timestamp).toLocaleString()}?\n\n` +
                          `• ${emoteCount} emotes\n` +
                          `• ${channelCount} channels\n` +
                          `• ${positionCount} minibar positions\n\n` +
                          `This will replace ALL current data!`;

    const confirmed = await showConfirmDialog(
      'Restore Backup',
      confirmMessage,
      'Restore',
      'Cancel',
      true
    );

    if (!confirmed) {
      progressContainer.classList.add('hidden');
      return;
    }

    // Clear existing data
    progressText.textContent = 'Clearing existing data...';
    progressFill.style.width = '25%';

    // Clear Chrome storage
    await new Promise((resolve) => {
      chrome.storage.local.clear(resolve);
    });

    // Clear IndexedDB
    try {
      if (emoteDB.db) {
        await emoteDB.clearAll();
      }
    } catch (dbError) {
      console.warn('Could not clear IndexedDB:', dbError);
    }

    // Clear localStorage (minibar positions)
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('mojify-suggestion-pos-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (lsError) {
      console.warn('Could not clear localStorage:', lsError);
    }

    // Restore Chrome storage data
    progressText.textContent = 'Restoring settings...';
    progressFill.style.width = '40%';

    if (backupData.data.chromeStorage) {
      try {
        // Add restore metadata to prevent automatic downloads
        const restoreData = {
          ...backupData.data.chromeStorage,
          lastRestoreTime: Date.now(),
          restoreSource: 'backup',
          skipNextDownload: true
        };

        await new Promise((resolve, reject) => {
          chrome.storage.local.set(restoreData, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
      } catch (storageError) {
        console.warn('Could not restore Chrome storage:', storageError);
      }
    }

    // Restore IndexedDB data
    progressText.textContent = 'Restoring emotes...';
    progressFill.style.width = '60%';

    if (backupData.data.indexedDBEmotes && backupData.data.indexedDBEmotes.length > 0) {
      try {
        await emoteDB.init();
        const emotes = backupData.data.indexedDBEmotes;
        for (let i = 0; i < emotes.length; i++) {
          const emote = emotes[i];
          if (emote.key && emote.dataUrl) {
            await emoteDB.storeEmote(
              emote.key,
              emote.url || '',
              emote.dataUrl,
              {
                channel: emote.channel || 'unknown',
                timestamp: emote.timestamp || Date.now()
              }
            );
          }

          // Update progress for large emote collections
          if (i % 50 === 0) {
            const progress = 60 + (i / emotes.length) * 20;
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `Restoring emotes... (${i + 1}/${emotes.length})`;
            await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to update UI
          }
        }
      } catch (dbError) {
        console.warn('Could not restore IndexedDB emotes:', dbError);
      }
    }

    // Restore localStorage data
    progressText.textContent = 'Restoring positions...';
    progressFill.style.width = '85%';

    if (backupData.data.localStorage) {
      try {
        Object.entries(backupData.data.localStorage).forEach(([key, value]) => {
          if (key.startsWith('mojify-suggestion-pos-')) {
            localStorage.setItem(key, value);
          }
        });
      } catch (lsError) {
        console.warn('Could not restore localStorage:', lsError);
      }
    }

    progressText.textContent = 'Finalizing restore...';
    progressFill.style.width = '95%';

    // Mark restoration complete and disable auto-download
    try {
      await new Promise((resolve) => {
        chrome.storage.local.set({
          restorationComplete: true,
          lastRestoreTime: Date.now(),
          skipNextDownload: true
        }, resolve);
      });
    } catch (error) {
      console.warn('Could not set restoration flags:', error);
    }

    // Refresh UI
    await new Promise(resolve => setTimeout(resolve, 500));

    progressText.textContent = 'Restore completed!';
    progressFill.style.width = '100%';

    showToast(`Backup restored successfully! (${emoteCount} emotes, ${channelCount} channels)`, 'success');

    // Refresh UI components
    setTimeout(() => {
      loadEmotes();
      loadChannelIds();
      updateStorageInfo();
      updateChannelManagement();
      progressContainer.classList.add('hidden');
      progressFill.style.width = '0%';

      // Clear the skip flag after UI refresh
      setTimeout(() => {
        chrome.storage.local.remove(['skipNextDownload']);
      }, 2000);
    }, 1500);

  } catch (error) {
    console.error('Restore failed:', error);
    showToast('Restore failed: ' + error.message, 'error');
    progressContainer.classList.add('hidden');
    progressFill.style.width = '0%';
  }

    // Reset file input
    event.target.value = '';
  }
});
