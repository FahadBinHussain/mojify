
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
  const ITEMS_PER_PAGE = 12;
  
  // State
  let allEmotes = {}; // All emotes from storage
  let displayedEmotes = []; // Emotes currently displayed
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
  
  // Load emotes from storage
  function loadEmotes() {
    chrome.storage.local.get(['emoteMapping'], (result) => {
      if (result.emoteMapping && Object.keys(result.emoteMapping).length > 0) {
        allEmotes = result.emoteMapping;
        updateEmoteCount();
        filterAndDisplayEmotes();
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
    displayedEmotes = emoteKeys
      .filter(key => {
        const emoteName = key.replace(/:/g, '').toLowerCase();
        return searchTerm === '' || emoteName.includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => {
        // Sort alphabetically
        return a.localeCompare(b);
      });
    
    // Display a subset of emotes for the current page
    renderEmoteGrid();
  }
  
  // Render the emote grid
  function renderEmoteGrid() {
    emoteGrid.innerHTML = '';
    
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const emotesToShow = displayedEmotes.slice(startIndex, endIndex);
    
    // If no emotes match the search
    if (displayedEmotes.length === 0 && searchTerm !== '') {
      emoteGrid.innerHTML = `
        <div class="no-emotes-message" style="grid-column: 1 / -1;">
          <p>No emotes found for "${searchTerm}"</p>
        </div>
      `;
      loadMoreContainer.classList.add('hidden');
      return;
    }
    
    // Create emote items
    emotesToShow.forEach(key => {
      const emoteUrl = allEmotes[key];
      const emoteName = key.replace(/:/g, '');
      
      const emoteItem = document.createElement('div');
      emoteItem.className = 'emote-item';
      emoteItem.innerHTML = `
        <div class="emote-img-container">
          <img src="${emoteUrl}" alt="${emoteName}" class="emote-img">
        </div>
        <div class="emote-details">
          <div class="emote-name">${emoteName}</div>
          <div class="emote-trigger">${key}</div>
        </div>
      `;
      
      emoteGrid.appendChild(emoteItem);
    });
    
    // Update "Load More" button visibility
    if (endIndex < displayedEmotes.length) {
      loadMoreContainer.classList.remove('hidden');
      loadMoreBtn.textContent = `Load More (${displayedEmotes.length - endIndex} remaining)`;
    } else {
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
  
  // Initialize
  function init() {
    initTabs();
    loadEmotes();
    loadChannelIds();
    addButtonEffects();
  }
  
  init();
}); 