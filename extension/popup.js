
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

      // Check if the current tab is messenger.com
      if (!currentTab.url.includes('messenger.com')) {
        showToast('This feature only works on messenger.com', 'error');
        if (emoteElement) resetEmoteLoadingState(emoteElement);

        // Add diagnostic info
        const diagInfo = document.createElement('div');
        diagInfo.className = 'diagnostic-info';
        diagInfo.innerHTML = `
          <div class="diagnostic-header">
            <h3>Not on Messenger</h3>
            <p>Current URL: <code>${currentTab.url}</code></p>
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
          showToast('Emote not found', 'error');
          if (emoteElement) resetEmoteLoadingState(emoteElement);
          return;
        }

        const emoteUrl = result.emoteMapping[emoteTrigger];

        // Show loading indicator
        showToast('Downloading and inserting emote...', 'loading');

        try {
          // Send message to content script to handle the insertion
          chrome.tabs.sendMessage(currentTab.id, {
            action: 'insertEmote',
            emoteTrigger: emoteTrigger
          }, (response) => {
            // Reset loading state
            if (emoteElement) resetEmoteLoadingState(emoteElement);

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
                  <p>Make sure you're on messenger.com and try clicking in the message input field first</p>
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
  function loadEmotes() {
    chrome.storage.local.get(['emoteMapping', 'channels', 'emoteImageData'], (result) => {
      console.log('Loaded data:', result);
      console.log('Image data keys:', result.emoteImageData ? Object.keys(result.emoteImageData).length : 0);

      // Store image data globally for easy access
      window.emoteImageData = result.emoteImageData || {};

      if (result.emoteMapping && Object.keys(result.emoteMapping).length > 0) {
        allEmotes = result.emoteMapping;
        channels = result.channels || [];

        console.log('All emotes count:', Object.keys(allEmotes).length);
        console.log('Channels count:', channels.length);
        console.log('Image data count:', Object.keys(window.emoteImageData).length);

        // Merge image data into channels for easier access
        if (channels.length > 0) {
          channels.forEach(channel => {
            if (channel.emotes) {
              Object.keys(channel.emotes).forEach(emoteKey => {
                const imageData = window.emoteImageData[emoteKey];
                if (imageData && imageData.data) {
                  // Update channel emote with base64 data for immediate display
                  channel.emotes[emoteKey] = {
                    url: channel.emotes[emoteKey],
                    imageData: imageData
                  };
                } else {
                  // Keep as string URL if no image data
                  channel.emotes[emoteKey] = {
                    url: channel.emotes[emoteKey],
                    imageData: null
                  };
                }
              });
            }
          });
        }

        // If we have emotes but no channels (for backward compatibility)
        if (channels.length === 0) {
          chrome.storage.local.get(['channelIds'], (result) => {
            if (result.channelIds && result.channelIds.length > 0) {
              // Create a single channel with all emotes
              const processedEmotes = {};
              Object.keys(allEmotes).forEach(emoteKey => {
                const imageData = window.emoteImageData[emoteKey];
                processedEmotes[emoteKey] = {
                  url: allEmotes[emoteKey],
                  imageData: imageData || null
                };
              });

              channels = [{
                id: 'all',
                username: 'All Emotes',
                emotes: processedEmotes
              }];
              console.log('Created fallback channel with all emotes');
            }
            updateEmoteCount();
            filterAndDisplayEmotes();
            updateStorageInfo();
            updateChannelManagement();
          });
        } else {
          // Log channel data
          channels.forEach(channel => {
            const emoteCount = Object.keys(channel.emotes || {}).length;
            const imageDataCount = Object.values(channel.emotes || {}).filter(e => e.imageData).length;
            console.log(`Channel ${channel.username} has ${emoteCount} emotes, ${imageDataCount} with image data`);
          });

          updateEmoteCount();
          filterAndDisplayEmotes();
          updateStorageInfo();
          updateChannelManagement();
        }

        noEmotesMessage.style.display = 'none';
      } else {
        emoteGrid.innerHTML = '';
        noEmotesMessage.style.display = 'flex';
        loadMoreContainer.classList.add('hidden');
        emoteCount.textContent = '0';
        updateStorageInfo();
        updateChannelManagement();
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
        const emoteData = allEmotes[key];
        const emoteUrl = typeof emoteData === 'string' ? emoteData : emoteData.url;
        const emoteName = key.replace(/:/g, '');

        const emoteItem = document.createElement('div');
        emoteItem.className = 'emote-item';
        emoteItem.setAttribute('data-emote-key', key);

        // Set initial content
        emoteItem.innerHTML = `
          <div class="emote-img-container">
            <img src="${emoteUrl}" alt="${emoteName}" class="emote-img">
          </div>
          <div class="emote-details">
            <div class="emote-name">${emoteName}</div>
            <div class="emote-trigger">${key}</div>
            <div class="emote-test-info" style="font-size: 10px; color: #666; margin-top: 2px;">
              URL: ${String(emoteUrl).substring(0, 30)}...<br>
              Loading image data...
            </div>
          </div>
        `;

        // Get image data and update asynchronously
        chrome.storage.local.get(['emoteImageData'], (result) => {
          const imageData = result.emoteImageData?.[key];
          const hasImageData = imageData?.data && imageData.data.startsWith('data:');
          const testInfo = imageData ? `Data: ${hasImageData ? 'YES' : 'NO'}, Size: ${imageData.size || 'Unknown'}, Type: ${imageData.type || 'Unknown'}` : 'No data';

          // Update test info
          const testInfoElement = emoteItem.querySelector('.emote-test-info');
          if (testInfoElement) {
            testInfoElement.innerHTML = `
              URL: ${String(emoteUrl).substring(0, 30)}...<br>
              ${testInfo}
            `;
          }

          // Update image source if we have base64 data
          const img = emoteItem.querySelector('.emote-img');
          if (img && hasImageData) {
            img.src = imageData.data;
          }

          // Add error handling for images
          if (img) {
            img.addEventListener('error', () => {
              console.error(`[Popup] Image load failed for ${key}, falling back to URL`);
              if (img.src !== emoteUrl) {
                img.src = emoteUrl;
              } else {
                console.error(`[Popup] Both base64 and URL failed for ${key}`);
                img.style.backgroundColor = '#ff6b6b';
                img.style.color = 'white';
                img.style.fontSize = '10px';
                img.alt = 'Failed to load';
              }
            });

            img.addEventListener('load', () => {
              console.log(`[Popup] Image loaded successfully for ${key}`, {
                src: img.src.substring(0, 50) + '...',
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight
              });
            });
          }
        });

        // Add click event to insert emote
        emoteItem.addEventListener('click', () => {
          insertEmoteIntoActiveTab(key, emoteItem);
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

        Object.entries(channel.emotes).forEach(([key, emoteData]) => {
          const emoteName = key.replace(/:/g, '');
          const url = typeof emoteData === 'string' ? emoteData : emoteData.url;
          const imageData = typeof emoteData === 'object' ? emoteData.imageData : null;

          const emoteItem = document.createElement('div');
          emoteItem.className = 'emote-item';
          emoteItem.setAttribute('data-emote-key', key);

          // Determine which image source to use
          const hasImageData = imageData?.data && imageData.data.startsWith('data:');
          const imageSrc = hasImageData ? imageData.data : url;
          const testInfo = imageData ? `Data: ${hasImageData ? 'YES' : 'NO'}, Size: ${imageData.size || 'Unknown'}, Type: ${imageData.type || 'Unknown'}` : 'No data';

          // Set content with proper image source
          emoteItem.innerHTML = `
            <div class="emote-img-container">
              <img src="${imageSrc}" alt="${emoteName}" class="emote-img">
            </div>
            <div class="emote-details">
              <div class="emote-name">${emoteName}</div>
              <div class="emote-trigger">${key}</div>
              <div class="emote-test-info" style="font-size: 10px; color: #666; margin-top: 2px;">
                URL: ${String(url).substring(0, 30)}...<br>
                ${testInfo}
              </div>
            </div>
          `;

          // Add error handling for images
          const img = emoteItem.querySelector('.emote-img');
          if (img) {
            img.addEventListener('error', () => {
              console.error(`[Popup] Image load failed for ${key}, falling back to URL`);
              if (img.src !== url) {
                img.src = url;
              } else {
                console.error(`[Popup] Both base64 and URL failed for ${key}`);
                img.style.backgroundColor = '#ff6b6b';
                img.style.color = 'white';
                img.style.fontSize = '10px';
                img.alt = 'Failed to load';
              }
            });

            img.addEventListener('load', () => {
              console.log(`[Popup] Image loaded successfully for ${key}`, {
                src: img.src.substring(0, 50) + '...',
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight
              });
            });
          }

          // Add click event to insert emote
          emoteItem.addEventListener('click', () => {
            insertEmoteIntoActiveTab(key, emoteItem);
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

          // Listen for progress updates from the automatic download
          const progressListener = (message) => {
            if (message.type === 'downloadProgress') {
              const { current, total, currentEmote, completed, newEmote, channel, batch, percentage } = message;
              const progressPercent = percentage || (total > 0 ? (current / total) * 100 : 0);

              progressFill.style.width = `${progressPercent}%`;
              progressCount.textContent = `${current}/${total}`;

              let progressMessage = 'Downloading emotes...';
              if (currentEmote) {
                progressMessage = `${currentEmote}`;
                if (channel) progressMessage += ` (${channel})`;
                if (batch) progressMessage += ` - Batch ${batch}`;
              }
              progressText.textContent = progressMessage;

              // Real-time emote display - reload emotes when new one is downloaded
              if (newEmote) {
                console.log(`[Popup] New emote downloaded: ${newEmote}, reloading emotes`);
                loadEmotes();
              }

              if (completed) {
                // Download completed
                setTimeout(() => {
                  downloadProgress.classList.add('hidden');
                  chrome.runtime.onMessage.removeListener(progressListener);
                  loadEmotes(); // Final reload
                  showToast('Emotes downloaded successfully');
                }, 1000);
              }
            }

            // Handle channel completion for better feedback
            if (message.type === 'channelCompleted') {
              const { username, emoteCount } = message;
              console.log(`[Popup] Channel ${username} completed with ${emoteCount} emotes`);
              loadEmotes(); // Refresh display after each channel
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
  clearAllStorageBtn.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear all emote data and channel IDs? This action cannot be undone.')) {
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
        // Listen for progress updates from the automatic download
        const progressListener = (message) => {
          if (message.type === 'downloadProgress') {
            const { current, total, currentEmote, completed, newEmote, channel, batch, percentage } = message;
            const progressPercent = percentage || (total > 0 ? (current / total) * 100 : 0);

            progressFill.style.width = `${progressPercent}%`;
            progressCount.textContent = `${current}/${total}`;

            let progressMessage = 'Downloading emotes...';
            if (currentEmote) {
              progressMessage = `${currentEmote}`;
              if (channel) progressMessage += ` (${channel})`;
              if (batch) progressMessage += ` - Batch ${batch}`;
            }
            progressText.textContent = progressMessage;

            // Real-time emote display - reload emotes when new one is downloaded
            if (newEmote) {
              console.log(`[Popup] New emote downloaded: ${newEmote}, reloading emotes`);
              loadEmotes();
            }

            if (completed) {
              // Download completed
              setTimeout(() => {
                downloadButton.disabled = false;
                downloadButton.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh Emotes</span>';
                downloadProgress.classList.add('hidden');
                chrome.runtime.onMessage.removeListener(progressListener);
                loadEmotes(); // Final reload
              }, 1000);
            }
          }

          // Handle channel completion for better feedback
          if (message.type === 'channelCompleted') {
            const { username, emoteCount } = message;
            console.log(`[Popup] Channel ${username} completed with ${emoteCount} emotes`);
            loadEmotes(); // Refresh display after each channel
          }
        };

        chrome.runtime.onMessage.addListener(progressListener);

        // Start polling for progress in case popup closes and reopens
        startProgressPolling();

        chrome.runtime.sendMessage({ type: 'downloadEmotes' }, (response) => {
          if (response && response.success) {
            showToast('Emotes downloaded successfully');
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

  function deleteChannel(channelId) {
    if (!confirm('Are you sure you want to delete this channel and all its emotes?')) {
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
  clearAllStorageBtn.addEventListener('click', () => {
    if (!confirm('Are you sure you want to delete ALL emote data? This cannot be undone.')) {
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
        // Download is in progress, show progress bar
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

        // Start polling for progress updates
        startProgressPolling();
      } else if (result.downloadProgress && result.downloadProgress.completed) {
        // Download completed, refresh the UI
        loadEmotes();
        showToast('Emotes downloaded successfully');

        // Clear completed status
        chrome.storage.local.remove(['downloadProgress']);
      } else if (result.downloadProgress && result.downloadProgress.error) {
        // Download failed
        showToast(`Download failed: ${result.downloadProgress.error}`, 'error');

        // Clear error status
        chrome.storage.local.remove(['downloadProgress']);
      }
    });
  }

  function startProgressPolling() {
    const pollInterval = setInterval(() => {
      chrome.storage.local.get(['downloadInProgress', 'downloadProgress'], (result) => {
        if (!result.downloadInProgress) {
          // Download finished
          clearInterval(pollInterval);
          downloadButton.disabled = false;
          downloadButton.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh Emotes</span>';
          downloadProgress.classList.add('hidden');

          if (result.downloadProgress) {
            if (result.downloadProgress.completed) {
              loadEmotes();
              showToast('Emotes downloaded successfully');
            } else if (result.downloadProgress.error) {
              showToast(`Download failed: ${result.downloadProgress.error}`, 'error');
            }
          }

          // Clear progress status
          chrome.storage.local.remove(['downloadProgress']);
        } else if (result.downloadProgress) {
          // Update progress and check for real-time updates
          const { current, total, currentEmote, channel, batch } = result.downloadProgress;
          const percentage = total > 0 ? (current / total) * 100 : 0;

          progressFill.style.width = `${percentage}%`;
          progressCount.textContent = `${current}/${total}`;

          let progressMessage = 'Downloading emotes...';
          if (currentEmote) {
            progressMessage = `${currentEmote}`;
            if (channel) progressMessage += ` (${channel})`;
            if (batch) progressMessage += ` - Batch ${batch}`;
          }
          progressText.textContent = progressMessage;

          // Refresh emotes periodically during download for real-time display
          if (current > 0 && current % 5 === 0) {
            loadEmotes();
          }
        }
      });
    }, 1000);
  }

  // Listen for automatic download notifications from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    // Handle real-time download progress updates
    if (message.type === 'downloadProgress') {
      const { current, total, currentEmote, newEmote, completed, channel, batch, percentage } = message;

      // Update progress if UI is visible
      if (!downloadProgress.classList.contains('hidden')) {
        const progressPercent = percentage || (total > 0 ? (current / total) * 100 : 0);
        progressFill.style.width = `${progressPercent}%`;
        progressCount.textContent = `${current}/${total} (${progressPercent}%)`;

        let progressMessage = 'Downloading emotes...';
        if (currentEmote) {
          progressMessage = `${currentEmote}`;
          if (channel) progressMessage += ` (${channel})`;
          if (batch) progressMessage += ` - Batch ${batch}`;
        }
        progressText.textContent = progressMessage;
      }

      // Real-time emote display
      if (newEmote) {
        console.log(`[Popup] Real-time update: New emote ${newEmote} downloaded`);
        loadEmotes();
      }

      // Handle completion
      if (completed) {
        setTimeout(() => {
          if (!downloadProgress.classList.contains('hidden')) {
            downloadProgress.classList.add('hidden');
          }
          loadEmotes();
          showToast('Download completed successfully');
        }, 1000);
      }
    }

    // Handle channel completion
    if (message.type === 'channelCompleted') {
      const { username, emoteCount } = message;
      console.log(`[Popup] Channel ${username} completed with ${emoteCount} emotes`);
      showToast(`${username} emotes ready (${emoteCount} emotes)`);
      loadEmotes();
    }
  });

  // Initialize
  function init() {
    initTabs();
    loadEmotes();
    loadChannelIds();
    addButtonEffects();
    initDebugSection();
    checkDownloadStatus();
  }

  init();
});
