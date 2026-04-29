const TWITCH_API_BASE_URL = "https://7tv.io/v3/users/twitch";

// IndexedDB wrapper for emote storage - stores blobs directly as values
const emoteDB = {
  db: null,
  dbName: 'MojifyEmotes',
  version: 3,

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
        console.log('[IndexedDB] Creating fresh database...');

        // Create emote blobs object store (stores blob directly as value)
        if (!db.objectStoreNames.contains('emoteBlobs')) {
          const blobsStore = db.createObjectStore('emoteBlobs');
          console.log('[IndexedDB] Created emoteBlobs object store');
        }

        // Create emote metadata object store
        if (!db.objectStoreNames.contains('emoteMetadata')) {
          const metadataStore = db.createObjectStore('emoteMetadata', { keyPath: 'key' });
          metadataStore.createIndex('channel', 'channel', { unique: false });
          metadataStore.createIndex('url', 'url', { unique: false });
          metadataStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('[IndexedDB] Created emoteMetadata object store');
        }
      };
    });
  },

  async storeEmote(key, url, blob, metadata = {}) {
    if (!this.db) await this.init();

    // Validate blob before storing
    if (!blob || !(blob instanceof Blob) || blob.size === 0) {
      console.error(`[IndexedDB] Cannot store emote ${key}: invalid or empty blob`);
      throw new Error(`Invalid blob for emote ${key}`);
    }

    console.log(`[IndexedDB] Storing emote ${key}: ${blob.size} bytes, type: ${blob.type}`);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readwrite');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');

      // Store metadata separately
      const metadataData = {
        key: key,
        url: url,
        filename: key + (blob.type === 'image/gif' ? '.gif' : '.png'),
        mimeType: blob.type || 'image/png',
        size: blob.size,
        timestamp: Date.now(),
        ...metadata
      };

      let blobStored = false;
      let metadataStored = false;

      const checkComplete = () => {
        if (blobStored && metadataStored) {
          console.log(`[IndexedDB] Successfully stored emote ${key}`);
          resolve();
        }
      };

      // Store blob directly as value (key-value pair)
      const blobRequest = blobsStore.put(blob, key);
      blobRequest.onsuccess = () => {
        blobStored = true;
        checkComplete();
      };
      blobRequest.onerror = () => {
        console.error(`[IndexedDB] Failed to store blob for ${key}:`, blobRequest.error);
        reject(blobRequest.error);
      };

      // Store metadata
      const metadataRequest = metadataStore.put(metadataData);
      metadataRequest.onsuccess = () => {
        metadataStored = true;
        checkComplete();
      };
      metadataRequest.onerror = () => {
        console.error(`[IndexedDB] Failed to store metadata for ${key}:`, metadataRequest.error);
        reject(metadataRequest.error);
      };
    });
  },

  async getEmote(key) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readonly');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');

      let blob = null;
      let metadataResult = null;
      let blobComplete = false;
      let metadataComplete = false;

      const checkComplete = () => {
        if (blobComplete && metadataComplete) {
          if (blob && metadataResult) {
            // Validate blob
            if (!(blob instanceof Blob) || blob.size === 0) {
              console.error(`[IndexedDB] Emote ${key} has corrupted or missing blob`);
              resolve(null);
              return;
            }

            console.log(`[IndexedDB] Retrieved emote ${key}: ${blob.size} bytes, type: ${blob.type}`);

            // Return combined result with blob directly accessible
            resolve({
              key: key,
              blob: blob,
              ...metadataResult
            });
          } else {
            console.warn(`[IndexedDB] Emote ${key} not found or incomplete`);
            resolve(null);
          }
        }
      };

      // Get blob directly (it's stored as the value)
      const blobRequest = blobsStore.get(key);
      blobRequest.onsuccess = () => {
        blob = blobRequest.result;
        blobComplete = true;
        checkComplete();
      };
      blobRequest.onerror = () => {
        console.error(`[IndexedDB] Failed to retrieve blob for ${key}:`, blobRequest.error);
        blobComplete = true;
        checkComplete();
      };

      // Get metadata
      const metadataRequest = metadataStore.get(key);
      metadataRequest.onsuccess = () => {
        metadataResult = metadataRequest.result;
        metadataComplete = true;
        checkComplete();
      };
      metadataRequest.onerror = () => {
        console.error(`[IndexedDB] Failed to retrieve metadata for ${key}:`, metadataRequest.error);
        metadataComplete = true;
        checkComplete();
      };
    });
  },

  async getAllEmotes() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readonly');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');

      // First get all metadata
      const metadataRequest = metadataStore.getAll();
      metadataRequest.onsuccess = () => {
        const metadataResults = metadataRequest.result || [];

        if (metadataResults.length === 0) {
          resolve([]);
          return;
        }

        const results = [];
        let completed = 0;

        // Get blobs for each metadata entry
        metadataResults.forEach(metadata => {
          const blobRequest = blobsStore.get(metadata.key);
          blobRequest.onsuccess = () => {
            const blob = blobRequest.result;
            if (blob && blob instanceof Blob) {
              results.push({
                ...metadata,
                blob: blob
              });
            }
            completed++;
            if (completed === metadataResults.length) {
              resolve(results);
            }
          };
          blobRequest.onerror = () => {
            completed++;
            if (completed === metadataResults.length) {
              resolve(results);
            }
          };
        });
      };
      metadataRequest.onerror = () => reject(metadataRequest.error);
    });
  },

  async getAllEmoteKeys() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteMetadata'], 'readonly');
      const metadataStore = transaction.objectStore('emoteMetadata');
      const request = metadataStore.getAllKeys();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async getEmoteCount() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteMetadata'], 'readonly');
      const metadataStore = transaction.objectStore('emoteMetadata');
      const request = metadataStore.count();

      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  },

  async deleteEmote(key) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readwrite');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');

      let blobDeleted = false;
      let metadataDeleted = false;

      const checkComplete = () => {
        if (blobDeleted && metadataDeleted) {
          resolve();
        }
      };

      // Delete blob
      const blobRequest = blobsStore.delete(key);
      blobRequest.onsuccess = () => {
        blobDeleted = true;
        checkComplete();
      };
      blobRequest.onerror = () => {
        blobDeleted = true; // Continue even if blob delete fails
        checkComplete();
      };

      // Delete metadata
      const metadataRequest = metadataStore.delete(key);
      metadataRequest.onsuccess = () => {
        metadataDeleted = true;
        checkComplete();
      };
      metadataRequest.onerror = () => {
        metadataDeleted = true; // Continue even if metadata delete fails
        checkComplete();
      };
    });
  },

  async clearAll() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readwrite');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');

      let blobsCleared = false;
      let metadataCleared = false;

      const checkComplete = () => {
        if (blobsCleared && metadataCleared) {
          resolve();
        }
      };

      // Clear blobs
      const blobsRequest = blobsStore.clear();
      blobsRequest.onsuccess = () => {
        blobsCleared = true;
        checkComplete();
      };
      blobsRequest.onerror = () => {
        blobsCleared = true; // Continue even if clear fails
        checkComplete();
      };

      // Clear metadata
      const metadataRequest = metadataStore.clear();
      metadataRequest.onsuccess = () => {
        metadataCleared = true;
        checkComplete();
      };
      metadataRequest.onerror = () => {
        metadataCleared = true; // Continue even if clear fails
        checkComplete();
      };
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

let discordImportState = {
  isImporting: false,
  current: 0,
  total: 0,
  guildId: '',
  guildName: '',
  startedAt: null
};

// Reset download state on service worker startup
async function resetDownloadState() {
  console.log('[Service Worker] Resetting download state on startup');

  downloadState.isDownloading = false;
  downloadState.current = 0;
  downloadState.total = 0;
  downloadState.startTime = null;

  try {
    await chrome.storage.local.set({
      downloadInProgress: false,
      downloadProgress: {
        current: 0,
        total: 0,
        completed: false,
        reset: true
      }
    });
    console.log('[Service Worker] Download state reset successfully');
  } catch (error) {
    console.error('[Service Worker] Error resetting download state:', error);
  }
}

async function resetDiscordImportState() {
  discordImportState = {
    isImporting: false,
    current: 0,
    total: 0,
    guildId: '',
    guildName: '',
    startedAt: null
  };

  try {
    await chrome.storage.local.set({
      discordImportInProgress: false,
      discordImportProgress: {
        current: 0,
        total: 0,
        completed: false,
        reset: true
      }
    });
  } catch (error) {
    console.error('[Service Worker] Error resetting Discord import state:', error);
  }
}

// Initialize service worker
(async function initServiceWorker() {
  try {
    await resetDownloadState();
    await resetDiscordImportState();
    console.log('[Service Worker] Initialization complete');
  } catch (error) {
    console.error('[Service Worker] Initialization error:', error);
  }
})();

async function downloadEmotes() {
  // Check if already downloading
  if (downloadState.isDownloading) {
    console.log("[Download] Already downloading, skipping");
    return { success: true, message: "Download already in progress", skipped: true };
  }

  try {
    downloadState.isDownloading = true;
    downloadState.startTime = Date.now();

    // Reset performance metrics
    downloadState.performanceMetrics = {
      totalBytes: 0,
      avgResponseTime: 0,
      successRate: 0,
      batchTimes: [],
      memoryUsage: []
    };

    console.log("[Download] Starting emote download");

    // Check if we should skip download due to recent restore
    const storageCheck = await chrome.storage.local.get(['channelIds', 'skipNextDownload', 'lastRestoreTime', 'manualRefresh']);
    const { channelIds, skipNextDownload, lastRestoreTime, manualRefresh } = storageCheck;

    // Skip download if restored within last 10 minutes AND it's not a manual refresh
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if ((skipNextDownload || (lastRestoreTime && lastRestoreTime > tenMinutesAgo)) && !manualRefresh) {
      console.log("[Download] Skipping download - emotes recently restored from backup");
      downloadState.isDownloading = false;

      // Clear the skip flag
      await chrome.storage.local.remove(['skipNextDownload']);

      return {
        success: true,
        message: "Skipped download - emotes restored from backup",
        totalEmotes: await emoteDB.getEmoteCount(),
        skipped: true
      };
    }

    // Clear manual refresh flag if it was set
    if (manualRefresh) {
      await chrome.storage.local.remove(['manualRefresh']);
    }

    if (!channelIds || channelIds.length === 0) {
      downloadState.isDownloading = false;
      return { success: false, error: "No channel IDs configured" };
    }

    const uniqueChannelIds = [...new Set(
      channelIds
        .map((channelId) => String(channelId || '').trim())
        .filter(Boolean)
    )];

    if (uniqueChannelIds.length === 0) {
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
    const channelsById = new Map();
    // Load ALL existing channels first (not just current ones)
    (existing.channels || []).forEach((channel) => {
      const id = String(channel?.id || '').trim();
      if (id) {
        channelsById.set(id, channel);
      }
    });

    // Get existing emote keys from IndexedDB metadata only
    const existingEmoteKeys = new Set(await emoteDB.getAllEmoteKeys());

    // Pre-fetch channel names and create channels immediately
    const channelEmotes = [];
    let totalNewEmotes = 0;

    let successfulChannelFetches = 0;
    let totalResolvedEmotes = 0;

    const channelResults = await Promise.allSettled(
      uniqueChannelIds.map(async (channelId) => ({
        channelId,
        result: await get7TVEmotes(channelId)
      }))
    );

    channelResults.forEach((channelResult) => {
      if (channelResult.status !== 'fulfilled') {
        console.error('[Download] Error resolving channel:', channelResult.reason);
        return;
      }

      const { channelId, result } = channelResult.value;
      const resolvedEmoteCount = Object.keys(result.emotes || {}).length;
      if (resolvedEmoteCount > 0 || result.username !== channelId) {
        successfulChannelFetches++;
      }
      totalResolvedEmotes += resolvedEmoteCount;

      channelsById.set(channelId, {
        id: channelId,
        username: result.username,
        emotes: result.emotes,
        sourceType: 'twitch'
      });

      if (resolvedEmoteCount > 0) {
        const newEmotes = {};
        Object.entries(result.emotes).forEach(([key, url]) => {
          if (!existingEmoteKeys.has(key)) {
            newEmotes[key] = url;
          }
        });

        if (Object.keys(newEmotes).length > 0) {
          channelEmotes.push({
            channelId,
            username: result.username,
            emotes: newEmotes,
            allEmotes: result.emotes
          });
          totalNewEmotes += Object.keys(newEmotes).length;
        }
      }
    });

    // Create channels array from ALL channels (existing + new)
    const channels = Array.from(channelsById.values());

    // Save channels with real names immediately before download starts
    await chrome.storage.local.set({
      channels: channels,
      downloadInProgress: true
    });

    downloadState.total = totalNewEmotes;
    downloadState.current = 0;

    if (successfulChannelFetches === 0 && totalResolvedEmotes === 0) {
      console.log("[Download] No valid channels resolved from configured identifiers");
      downloadState.isDownloading = false;
      await chrome.storage.local.set({ channels, downloadInProgress: false });
      return { success: false, error: "No valid 7TV channels found" };
    }

    if (totalNewEmotes === 0) {
      console.log("[Download] No new emotes to download - all emotes already cached locally");
      downloadState.isDownloading = false;
      await chrome.storage.local.set({ channels, downloadInProgress: false });
      return { success: true, totalEmotes: await emoteDB.getEmoteCount(), message: "All emotes up to date" };
    }

    console.log(`[Download] Found ${totalNewEmotes} new emotes to download (skipping ${existingEmoteKeys.size} already cached)`);

    // Set download progress
    await chrome.storage.local.set({
      downloadInProgress: true,
      downloadProgress: {
        current: 0,
        total: totalNewEmotes,
        currentEmote: null
      }
    });

    // Intelligent pre-loading and cache optimization
    const urlCache = new Map(); // Cache for URL analysis
    const sizeEstimates = new Map(); // Size estimates for prioritization

    // Analyze URLs for optimization hints
    const analyzeUrls = (emotes) => {
      emotes.forEach(emote => {
        const url = new URL(emote.url);
        const pathSegments = url.pathname.split('/');

        // Extract format and potential size info from URL
        const format = pathSegments[pathSegments.length - 1].split('.').pop()?.toLowerCase();
        const sizeHint = url.searchParams.get('size') || '1x';

        // Estimate download priority (smaller files first for quick wins)
        let priority = 1;
        if (format === 'webp') priority += 0.5; // WebP is typically smaller
        if (sizeHint.includes('1x') || sizeHint.includes('28')) priority += 0.3;
        if (url.hostname.includes('cdn')) priority += 0.2; // CDN likely faster

        sizeEstimates.set(emote.key, {
          format,
          sizeHint,
          priority,
          url: emote.url
        });
      });
    };

    // Adaptive concurrent download implementation with optimized batching
    let BATCH_SIZE = 10; // Start with smaller batches to avoid throttling
    let BATCH_DELAY = 200; // Start with longer delay
    const MIN_BATCH_SIZE = 2; // Minimum batch size for heavily throttled connections
    const MAX_BATCH_SIZE = 15; // Maximum batch size (reduced to prevent throttling)
    const BASE_TIMEOUT = 15000; // Base timeout in milliseconds

    // Performance tracking for adaptive optimization
    let batchFailureRates = [];
    let avgResponseTimes = [];
    let totalSuccessfulDownloads = 0;
    let totalFailedDownloads = 0;
    let consecutiveTimeouts = 0;
    let throttlingDetected = false;

    // Connection pool management
    const activeConnections = new Set();
    const MAX_CONCURRENT_CONNECTIONS = 15;

    // Memory optimization tracking
    let memoryCheckInterval = null;

    // Start memory monitoring
    const startMemoryMonitoring = () => {
      if (typeof performance !== 'undefined' && performance.memory) {
        memoryCheckInterval = setInterval(() => {
          const memInfo = {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize,
            limit: performance.memory.jsHeapSizeLimit,
            timestamp: Date.now()
          };
          downloadState.performanceMetrics.memoryUsage.push(memInfo);

          // Keep only last 10 memory readings
          if (downloadState.performanceMetrics.memoryUsage.length > 10) {
            downloadState.performanceMetrics.memoryUsage.shift();
          }

          // Log warning if memory usage is high
          const usagePercent = (memInfo.used / memInfo.limit) * 100;
          if (usagePercent > 80) {
            console.warn(`[Download] High memory usage: ${usagePercent.toFixed(1)}%`);
          }
        }, 5000);
      }
    };

    startMemoryMonitoring();

    // Prepare all emotes for download with metadata and optimization
    const allEmotesToDownload = [];
    for (const channelData of channelEmotes) {
      console.log(`[Download] Preparing ${channelData.username}: ${Object.keys(channelData.emotes).length} new emotes`);

      for (const [key, url] of Object.entries(channelData.emotes)) {
        allEmotesToDownload.push({
          key,
          url,
          channel: channelData.username,
          channelId: channelData.channelId
        });
      }
    }

    // Analyze URLs for intelligent optimization
    analyzeUrls(allEmotesToDownload);

    // Sort emotes by priority (smaller/faster downloads first for quick progress)
    allEmotesToDownload.sort((a, b) => {
      const aPriority = sizeEstimates.get(a.key)?.priority || 1;
      const bPriority = sizeEstimates.get(b.key)?.priority || 1;
      return bPriority - aPriority; // Higher priority first
    });

    console.log(`[Download] Starting concurrent download of ${allEmotesToDownload.length} emotes in batches of ${BATCH_SIZE} (prioritized by size/speed)`);

    // Function to download a single emote with adaptive timeout and caching
    const downloadSingleEmote = async (emoteData, batchNumber, totalBatches) => {
      const { key, url, channel, channelId } = emoteData;
      const startTime = Date.now();

      try {
        // Check cache first for URL analysis
        let cacheEntry = urlCache.get(url);
        if (!cacheEntry) {
          cacheEntry = { attempts: 0, lastAttempt: 0, avgResponseTime: 0 };
          urlCache.set(url, cacheEntry);
        }

        // Calculate adaptive timeout based on multiple factors
        const progressFactor = Math.min(batchNumber / totalBatches, 1);
        const avgFailureRate = batchFailureRates.length > 0 ?
          batchFailureRates.reduce((a, b) => a + b, 0) / batchFailureRates.length : 0;

        // Factor in URL-specific performance history
        const urlPerformanceFactor = cacheEntry.avgResponseTime > 5000 ? 1.5 : 1.0;
        const attemptFactor = Math.min(cacheEntry.attempts * 0.2, 1.0);

        // Scale timeout: start at base, increase for later batches and higher failure rates
        const adaptiveTimeout = BASE_TIMEOUT +
          (progressFactor * 8000) + // Add up to 8s for batch progression
          (avgFailureRate * 10000) + // Add up to 10s for high failure rates
          (urlPerformanceFactor * 3000) + // Add time for slow URLs
          (attemptFactor * 2000); // Add time for previously failed URLs

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), adaptiveTimeout);

        // Enhanced headers for better cache control and performance
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/webp,image/avif,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br'
        };

        // Use cache-control strategically based on batch progression
        if (batchNumber <= 3) {
          headers['Cache-Control'] = 'no-cache'; // Fresh data for early batches
        } else {
          headers['Cache-Control'] = 'max-age=300'; // Allow some caching for later batches
        }

        cacheEntry.attempts++;
        cacheEntry.lastAttempt = Date.now();

        const response = await fetch(url, {
          signal: controller.signal,
          headers
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const blob = await response.blob();
          console.log(`[Download] Downloaded ${key}: ${blob.size} bytes, type: ${blob.type}`);

          if (blob.size > 0) {
            await emoteDB.storeEmote(key, url, blob, {
              channel: channel,
              channelId: channelId
            });

            globalEmoteMapping[key] = url;
            const responseTime = Date.now() - startTime;

            // Update URL cache with successful response time
            cacheEntry.avgResponseTime = cacheEntry.avgResponseTime === 0 ?
              responseTime : (cacheEntry.avgResponseTime + responseTime) / 2;

            // Update performance metrics
            downloadState.performanceMetrics.totalBytes += blob.size;
            totalSuccessfulDownloads++;

            // Update size estimates with actual data
            if (sizeEstimates.has(key)) {
              sizeEstimates.get(key).actualSize = blob.size;
            }

            console.log(`[Download] ✓ ${key} (${blob.size} bytes, ${responseTime}ms, attempt ${cacheEntry.attempts})`);
            return { success: true, key, url, channel, channelId, responseTime, size: blob.size };
          } else {
            throw new Error("Empty blob received");
          }
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        totalFailedDownloads++;
console.log(`[Download] ✗ ${key}: ${error.message} (${responseTime}ms)`);
        return { success: false, key, url, channel, channelId, error: error.message, responseTime };
      }
    };

    // Process emotes in adaptive concurrent batches
    const failedQueue = [];
    let currentBatch = 0;
    const totalBatches = Math.ceil(allEmotesToDownload.length / BATCH_SIZE);
    let consecutiveHighFailureBatches = 0;

    for (let i = 0; i < allEmotesToDownload.length; i += BATCH_SIZE) {
      const batch = allEmotesToDownload.slice(i, i + BATCH_SIZE);
      currentBatch++;

      console.log(`[Download] Processing batch ${currentBatch}/${totalBatches} (${batch.length} emotes, batch size: ${BATCH_SIZE}, delay: ${BATCH_DELAY}ms)`);

      const batchStartTime = Date.now();

      // Limit concurrent connections for better stability
      const connectionLimitedBatch = [];
      for (const emoteData of batch) {
        if (activeConnections.size < MAX_CONCURRENT_CONNECTIONS) {
          const connectionId = `${emoteData.key}_${Date.now()}`;
          activeConnections.add(connectionId);

          const downloadPromise = downloadSingleEmote(emoteData, currentBatch, totalBatches)
            .finally(() => activeConnections.delete(connectionId));

          connectionLimitedBatch.push(downloadPromise);
        } else {
          // Queue for next micro-batch if too many connections
          await new Promise(resolve => setTimeout(resolve, 50));
          connectionLimitedBatch.push(downloadSingleEmote(emoteData, currentBatch, totalBatches));
        }
      }

      // Download batch concurrently with connection limiting
      const batchResults = await Promise.allSettled(connectionLimitedBatch);

      // Analyze batch performance
      let batchFailures = 0;
      let batchResponseTimes = [];
      let batchTotalBytes = 0;

      // Process results and detect throttling patterns
      let timeoutCount = 0;
      let successfulInBatch = 0;

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const emoteResult = result.value;
          if (!emoteResult.success) {
            failedQueue.push(emoteResult);
            batchFailures++;

            // Detect throttling pattern: timeouts after successful downloads
            if (emoteResult.error && emoteResult.error.includes('Failed to fetch') &&
                emoteResult.responseTime > 30000) {
              timeoutCount++;
            }
          } else {
            successfulInBatch++;
          }
          if (emoteResult.responseTime) {
            batchResponseTimes.push(emoteResult.responseTime);
          }
          if (emoteResult.size) {
            batchTotalBytes += emoteResult.size;
          }
        } else {
          console.error(`[Download] Batch promise rejected:`, result.reason);
          batchFailures++;
        }

        downloadState.current++;
      }

      // Record batch completion time
      const batchDuration = Date.now() - batchStartTime;
      downloadState.performanceMetrics.batchTimes.push({
        batchNumber: currentBatch,
        duration: batchDuration,
        emoteCount: batch.length,
        failures: batchFailures,
        totalBytes: batchTotalBytes
      });

      // Keep only last 10 batch records
      if (downloadState.performanceMetrics.batchTimes.length > 10) {
        downloadState.performanceMetrics.batchTimes.shift();
      }

      await chrome.storage.local.set({
        downloadProgress: {
          current: downloadState.current,
          total: downloadState.total,
          currentEmote: `Batch ${currentBatch}/${totalBatches}`
        }
      });

      try {
        chrome.runtime.sendMessage({
          type: 'downloadProgress',
          current: downloadState.current,
          total: downloadState.total,
          currentEmote: `Downloading batch ${currentBatch}/${totalBatches}...`
        });
      } catch (e) {
        // Popup is closed, continue silently
      }

      // Detect server throttling pattern: successful downloads followed by timeouts
      if (successfulInBatch > 0 && timeoutCount > 0 &&timeoutCount >= successfulInBatch){
        throttlingDetected = true;
        consecutiveTimeouts += timeoutCount;
        console.warn(`[Download] Throttling detected! ${successfulInBatch} succeeded, then ${timeoutCount} timeouts`);
      } else if (timeoutCount === 0) {
        consecutiveTimeouts = 0;
        throttlingDetected = false;
      }

      // Calculate and store batch performance metrics
      const batchFailureRate = batchFailures / batch.length;
      batchFailureRates.push(batchFailureRate);

      if (batchResponseTimes.length > 0) {
        const avgResponseTime = batchResponseTimes.reduce((a, b) => a + b, 0) / batchResponseTimes.length;
        avgResponseTimes.push(avgResponseTime);
      }

      // Keep only last 5 batches for rolling average
      if (batchFailureRates.length > 5) batchFailureRates.shift();
      if (avgResponseTimes.length > 5) avgResponseTimes.shift();

      console.log(`[Download] Batch ${currentBatch} stats: ${batchFailureRate.toFixed(2)} failure rate, ${batchResponseTimes.length > 0 ? Math.round(batchResponseTimes.reduce((a, b) => a + b, 0) / batchResponseTimes.length) : 'N/A'}ms avg response`);

      // Aggressive throttling response
      if (throttlingDetected || consecutiveTimeouts > 5) {
        BATCH_SIZE = MIN_BATCH_SIZE;
        BATCH_DELAY = Math.max(BATCH_DELAY * 2, 1000);
        console.log(`[Download] AGGRESSIVE: Throttling detected, reducing to ${BATCH_SIZE} batch size and ${BATCH_DELAY}ms delay`);
        consecutiveHighFailureBatches = 0; // Reset other counter
      }
      // Adaptive optimization based on performance
      else if (batchFailureRate > 0.3) { // High failure rate
        consecutiveHighFailureBatches++;

        if (consecutiveHighFailureBatches >= 1 && BATCH_SIZE > MIN_BATCH_SIZE) {
          BATCH_SIZE = Math.max(MIN_BATCH_SIZE, Math.floor(BATCH_SIZE * 0.6));
          BATCH_DELAY = Math.min(BATCH_DELAY * 1.8, 3000);
          console.log(`[Download] Reducing batch size to ${BATCH_SIZE} and increasing delay to ${BATCH_DELAY}ms due to failures`);
        }
      } else if (batchFailureRate < 0.1 && consecutiveHighFailureBatches === 0 && !throttlingDetected) {
        // Low failure rate and no recent issues - can try to optimize
        if (avgResponseTimes.length > 0) {
          const avgResponseTime = avgResponseTimes.reduce((a, b) => a + b, 0) / avgResponseTimes.length;
          if (avgResponseTime < 5000 && BATCH_SIZE < MAX_BATCH_SIZE) {
            BATCH_SIZE = Math.min(MAX_BATCH_SIZE, BATCH_SIZE + 1);
            BATCH_DELAY = Math.max(200, Math.floor(BATCH_DELAY * 0.95));
            console.log(`[Download] Increasing batch size to ${BATCH_SIZE} and reducing delay to ${BATCH_DELAY}ms due to good performance`);
          }
        }
        consecutiveHighFailureBatches = 0;
      } else {
        consecutiveHighFailureBatches = Math.max(0, consecutiveHighFailureBatches - 1);
      }

      // Adaptive delay between batches
      if (i + BATCH_SIZE < allEmotesToDownload.length) {
        // Calculate progressive delay with aggressive throttling response
        let progressiveDelay = BATCH_DELAY + (currentBatch * 30) + (batchFailureRate * 1000);

        // Much longer delays if throttling detected
        if (throttlingDetected) {
          progressiveDelay = Math.max(progressiveDelay * 3, 2000);
          console.log(`[Download] Throttling delay: ${progressiveDelay}ms`);
        }

        await new Promise(resolve => setTimeout(resolve, Math.min(progressiveDelay, 5000)));

        // Memory optimization: Clear completed downloads from memory periodically
        if (currentBatch % 5 === 0) {
          // Clear old batch performance data to free memory
          if (downloadState.performanceMetrics.batchTimes.length > 5) {
            downloadState.performanceMetrics.batchTimes = downloadState.performanceMetrics.batchTimes.slice(-5);
          }

          // Force garbage collection hint for memory optimization
          if (typeof global !== 'undefined' && global.gc) {
            global.gc();
          }
        }
      }
    }

    // Stop memory monitoring
    if (memoryCheckInterval) {
      clearInterval(memoryCheckInterval);
    }

    // Calculate final performance metrics
    const totalDownloads = totalSuccessfulDownloads + totalFailedDownloads;
    downloadState.performanceMetrics.successRate = totalDownloads > 0 ?
      (totalSuccessfulDownloads / totalDownloads) * 100 : 0;

    if (avgResponseTimes.length > 0) {
      downloadState.performanceMetrics.avgResponseTime =
        avgResponseTimes.reduce((a, b) => a + b, 0) / avgResponseTimes.length;
    }

    console.log(`[Download] Concurrent download completed. ${failedQueue.length} failures to retry.`);
    console.log(`[Download] Performance: ${downloadState.performanceMetrics.successRate.toFixed(1)}% success rate, ${Math.round(downloadState.performanceMetrics.avgResponseTime)}ms avg response, ${Math.round(downloadState.performanceMetrics.totalBytes / 1024)}KB total`);

    // Clear active connections tracking
    activeConnections.clear();

    // Second pass: retry failed emotes with smaller concurrent batches
    if (failedQueue.length > 0) {
      console.log(`[Download] Retrying ${failedQueue.length} failed emotes with smaller batches...`);

      const RETRY_BATCH_SIZE = 5; // Smaller batches for retries
      const retryDownload = async (emoteData, retryAttempt = 1) => {
        const { key, url, channel, channelId } = emoteData;

        try {
          // Exponential timeout for retries: 20s, 30s, 45s for multiple attempts
          const retryTimeout = 20000 + (retryAttempt * 10000) + Math.min(retryAttempt * retryAttempt * 5000, 25000);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), retryTimeout);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const blob = await response.blob();
            if (blob.size > 0) {
              await emoteDB.storeEmote(key, url, blob, {
                channel: channel,
                channelId: channelId,
                retried: true
              });

              globalEmoteMapping[key] = url;
              console.log(`[Download] ✓ Retry successful: ${key}`);
              return { success: true, key };
            }
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (error) {
          console.log(`[Download] ✗ Retry failed: ${key} - ${error.message}`);
          // Still store URL mapping for fallback
          globalEmoteMapping[key] = url;
          return { success: false, key, error: error.message };
        }
      };

      // Process retry queue in smaller concurrent batches with exponential backoff
      const retryBatchSize = Math.max(2, Math.floor(RETRY_BATCH_SIZE * 0.7)); // Smaller retry batches

      for (let i = 0; i < failedQueue.length; i += retryBatchSize) {
        const retryBatch = failedQueue.slice(i, i + retryBatchSize);
        const retryBatchNum = Math.floor(i/retryBatchSize) + 1;
        const totalRetryBatches = Math.ceil(failedQueue.length/retryBatchSize);

        console.log(`[Download] Retry batch ${retryBatchNum}/${totalRetryBatches} (${retryBatch.length} emotes)`);

        await Promise.allSettled(
          retryBatch.map(emoteData => retryDownload(emoteData, retryBatchNum))
        );

        // Exponential backoff delay between retry batches
        if (i + retryBatchSize < failedQueue.length) {
          const exponentialDelay = 800 + (retryBatchNum * 400) + Math.min(retryBatchNum * retryBatchNum * 200, 2000);
await new Promise(resolve => setTimeout(resolve, exponentialDelay));
        }
      }

      console.log(`[Download] Completed concurrent retry processing`);

      // Final performance report with cache analysis
      const finalMetrics = downloadState.performanceMetrics;
      const cacheStats = {
        totalUrls: urlCache.size,
        avgAttempts: Array.from(urlCache.values()).reduce((sum, entry) => sum + entry.attempts, 0) / urlCache.size,
        slowUrls: Array.from(urlCache.values()).filter(entry => entry.avgResponseTime > 5000).length
      };

      console.log(`[Download] Final metrics - Success rate: ${finalMetrics.successRate.toFixed(1)}%, Total data: ${Math.round(finalMetrics.totalBytes / 1024)}KB, Avg response: ${Math.round(finalMetrics.avgResponseTime)}ms`);
      console.log(`[Download] Cache stats - ${cacheStats.totalUrls} URLs cached, ${cacheStats.avgAttempts.toFixed(1)} avg attempts, ${cacheStats.slowUrls} slow URLs`);

      // Clear cache to free memory
      urlCache.clear();
      sizeEstimates.clear();
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
    const totalStoredEmotes = await emoteDB.getEmoteCount();
    console.log(`[Download] Completed! Downloaded ${totalNewEmotes} new emotes. Total stored: ${totalStoredEmotes}`);
    return { success: true, totalEmotes: totalStoredEmotes };

  } catch (error) {
    console.error("[Download] Error:", error);
    downloadState.isDownloading = false;

    try {
      await chrome.storage.local.set({
        downloadInProgress: false,
        downloadProgress: { error: error.message }
      });
    } catch (storageError) {
      console.error("[Download] Error updating storage:", storageError);
    }

    return { success: false, error: error.message };
  }
}

// Function to insert emote into messenger.com using drag and drop
async function insertEmoteIntoMessenger(tabId, emoteUrl, emoteTrigger) {
  console.log(`[Mojify] Attempting to insert emote ${emoteTrigger} into tab ${tabId} using drag and drop`);

  try {
    // Get the emote blob from IndexedDB
    const emoteData = await emoteDB.getEmote(emoteTrigger);

    if (!emoteData || !emoteData.blob) {
      throw new Error(`Emote ${emoteTrigger} not found in cache. Please download emotes first.`);
    }

    const imageBlob = emoteData.blob;
    console.log(`[Mojify] Using cached blob for ${emoteTrigger}`);

    // Execute script to drag and drop the emote
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: insertEmoteWithDragDrop,
      args: [imageBlob, emoteTrigger, emoteUrl]
    });

    if (result && result[0] && result[0].result) {
      console.log(`[Mojify] Successfully inserted emote ${emoteTrigger} via drag and drop`);
      return { success: true };
    } else {
      throw new Error('Drag and drop insertion failed');
    }
  } catch (error) {
    console.error("[Mojify] Error inserting emote:", error);
    return { success: false, error: error.message };
  }
}

// Injected function for drag and drop emote insertion
function insertEmoteWithDragDrop(imageBlob, emoteTrigger, emoteUrl) {
  console.log("Mojify: Starting drag and drop insertion for:", emoteTrigger);

  try {
    // Find messenger input field
    const inputSelectors = [
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[role="textbox"][aria-label*="message" i]',
      '[role="textbox"][data-testid*="composer" i]',
      'div[aria-label*="message" i]',
      '.x1ed109x.x1orsw6y.x78zum5.x1q0g3np.x1a02dak.x1yrsyyn',
      '[class*="composer"] [contenteditable="true"]'
    ];

    let inputField = null;
    for (const selector of inputSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (element.offsetParent !== null && element.isContentEditable) {
          inputField = element;
          break;
        }
      }
      if (inputField) break;
    }

    if (!inputField) {
      console.error("[Mojify] No messenger input field found");
      return false;
    }

    console.log("[Mojify] Found input field:", inputField);

    // Create a File object from the blob
    const file = new File([imageBlob], `${emoteTrigger}.webp`, {
      type: imageBlob.type || 'image/webp'
    });

    // Create DataTransfer object for drag and drop
    const dataTransfer = new DataTransfer();
    dataTransfer.files.add ? dataTransfer.files.add(file) : dataTransfer.items.add(file);

    // Focus the input field
    inputField.focus();
    inputField.click();

    // Create and dispatch drag events
    const dragStartEvent = new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dataTransfer
    });

    const dragOverEvent = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dataTransfer
    });

    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dataTransfer
    });

    // Simulate drag and drop sequence
    document.dispatchEvent(dragStartEvent);

    setTimeout(() => {
      inputField.dispatchEvent(dragOverEvent);

      setTimeout(() => {
        inputField.dispatchEvent(dropEvent);

        // Also try paste event as fallback
        setTimeout(() => {
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer
          });
          inputField.dispatchEvent(pasteEvent);
        }, 100);

      }, 100);
    }, 100);

    // Alternative approach: try input event with files
    setTimeout(() => {
      const inputEvent = new Event('input', {
        bubbles: true,
        cancelable: true
      });

      // Try to set files property if available
      if (inputField.files !== undefined) {
        Object.defineProperty(inputField, 'files', {
          value: dataTransfer.files,
          configurable: true
        });
      }

      inputField.dispatchEvent(inputEvent);
    }, 200);

    console.log("[Mojify] Drag and drop events dispatched for:", emoteTrigger);
    return true;

  } catch (error) {
    console.error("[Mojify] Error in drag and drop insertion:", error);
    return false;
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

function sendRuntimeMessage(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch (error) {
    console.log('[Mojify] Runtime message skipped:', error.message);
  }
}

async function updateDiscordImportProgress(progress = {}) {
  const payload = {
    current: Number(progress.current || 0),
    total: Number(progress.total || 0),
    guildId: progress.guildId || discordImportState.guildId || '',
    guildName: progress.guildName || discordImportState.guildName || '',
    currentEmoji: progress.currentEmoji || '',
    statusText: progress.statusText || '',
    importedCount: Number(progress.importedCount || 0),
    skippedCount: Number(progress.skippedCount || 0),
    completed: Boolean(progress.completed),
    error: progress.error || '',
    channelId: progress.channelId || '',
    toastMessage: progress.toastMessage || ''
  };

  await chrome.storage.local.set({
    discordImportInProgress: Boolean(progress.inProgress),
    discordImportProgress: payload
  });

  sendRuntimeMessage({
    type: 'discordImportProgress',
    ...payload
  });
}

function sanitizeDiscordEmojiName(name, fallback = 'emoji') {
  const sanitized = String(name || fallback)
    .trim()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return sanitized || fallback;
}

function buildDiscordEmojiCdnUrl(emojiId, animated = false) {
  const extension = animated ? 'gif' : 'png';
  return `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=128&quality=lossless`;
}

function buildUniqueDiscordEmojiKey(name, guildName, reservedKeys) {
  const baseName = sanitizeDiscordEmojiName(name);
  const guildSuffix = sanitizeDiscordEmojiName(guildName, 'discord').toLowerCase();
  const baseKey = `:${baseName}:`;

  if (!reservedKeys.has(baseKey)) {
    reservedKeys.add(baseKey);
    return baseKey;
  }

  const guildKey = `:${baseName}_${guildSuffix}:`;
  if (!reservedKeys.has(guildKey)) {
    reservedKeys.add(guildKey);
    return guildKey;
  }

  let counter = 2;
  while (true) {
    const candidate = `:${baseName}_${guildSuffix}_${counter}:`;
    if (!reservedKeys.has(candidate)) {
      reservedKeys.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

async function extractDiscordGuildFromTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      const pathMatch = window.location.pathname.match(/^\/channels\/([^/]+)/);
      if (!pathMatch || pathMatch[1] === '@me') {
        return { error: 'Open a Discord server, not direct messages' };
      }

      const guildId = pathMatch[1];

      const getWebpackRequire = () => {
        try {
          let webpackRequire = null;
          window.webpackChunkdiscord_app.push([
            [Symbol('mojify-discord-import')],
            {},
            (req) => {
              webpackRequire = req;
            }
          ]);
          return webpackRequire;
        } catch (error) {
          return null;
        }
      };

      const findWebpackModule = (predicate) => {
        const webpackRequire = getWebpackRequire();
        if (!webpackRequire?.c) return null;

        const seen = new Set();
        const candidatesFrom = (value) => {
          const candidates = [];
          if (!value) return candidates;
          candidates.push(value);
          if (typeof value === 'object') {
            ['default', 'Z', 'ZP'].forEach((key) => {
              if (value[key]) candidates.push(value[key]);
            });
            Object.values(value).forEach((entry) => {
              if (entry && (typeof entry === 'object' || typeof entry === 'function')) {
                candidates.push(entry);
              }
            });
          }
          return candidates;
        };

        for (const moduleRecord of Object.values(webpackRequire.c)) {
          const exportsValue = moduleRecord?.exports;
          for (const candidate of candidatesFrom(exportsValue)) {
            if (!candidate || seen.has(candidate)) continue;
            seen.add(candidate);
            try {
              if (predicate(candidate)) {
                return candidate;
              }
            } catch (error) {
              // Ignore probe failures and continue scanning.
            }
          }
        }

        return null;
      };

      const getMethodNames = (value) => {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
          return [];
        }

        const names = new Set();
        let current = value;
        let depth = 0;

        while (current && depth < 3) {
          if (current === Object.prototype || current === Function.prototype) {
            break;
          }

          try {
            Object.getOwnPropertyNames(current).forEach((name) => names.add(name));
          } catch (error) {
            // Ignore prototype probing failures.
          }

          current = Object.getPrototypeOf(current);
          depth += 1;
        }

        return Array.from(names);
      };

      const sanitizeDiscordToken = (token) => String(token || '').replace(/^"|"$/g, '').trim();

      const readDiscordToken = () => {
        try {
          const moduleCache = [];
          window.webpackChunkdiscord_app.push([
            [Math.random()],
            {},
            (runtime) => {
              if (runtime?.c) {
                moduleCache.push(...Object.values(runtime.c));
              }
            }
          ]);

          const knownTokenModule = moduleCache.find((moduleRecord) => (
            !moduleRecord?.exports?.messagesLoader &&
            typeof moduleRecord?.exports?.default?.getToken === 'function'
          ));

          const tokenFromKnownMethod = sanitizeDiscordToken(
            knownTokenModule?.exports?.default?.getToken?.()
          );

          if (tokenFromKnownMethod) {
            return tokenFromKnownMethod;
          }
        } catch (error) {
          // Fall through to other strategies.
        }

        try {
          const raw = window.localStorage.getItem('token');
          const token = sanitizeDiscordToken(raw);
          if (token) {
            return token;
          }
        } catch (error) {
          // Fall through to broader runtime store lookup.
        }

        const authStore = findWebpackModule((candidate) => {
          const methodNames = getMethodNames(candidate);
          return (
            typeof candidate?.getToken === 'function' ||
            typeof candidate?.getNonImpersonatedToken === 'function' ||
            methodNames.includes('getToken') ||
            methodNames.includes('getNonImpersonatedToken')
          );
        });

        try {
          const runtimeToken = sanitizeDiscordToken(
            authStore?.getToken?.() || authStore?.getNonImpersonatedToken?.()
          );
          if (runtimeToken) {
            return runtimeToken;
          }
        } catch (error) {
          // Ignore runtime token lookup failures and fall through.
        }

        return '';
      };

      const performGuildFetch = async (token = '') => {
        const headers = token ? { authorization: token } : {};
        return fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
          credentials: 'include',
          headers
        });
      };

      const readGuildFromWebpackState = () => {
        const guildStore = findWebpackModule((candidate) => (
          typeof candidate?.getGuild === 'function'
        ));

        const guild = guildStore?.getGuild?.(guildId);
        if (guild?.emojis && Array.isArray(guild.emojis)) {
          return {
            guildId: String(guild.id || guildId),
            guildName: guild.name,
            emojis: guild.emojis.map((emoji) => ({
              id: emoji.id,
              name: emoji.name,
              animated: Boolean(emoji.animated)
            }))
          };
        }

        const emojiStore = findWebpackModule((candidate) => {
          const keys = Object.keys(candidate || {});
          return keys.some((key) => /emoji/i.test(key)) &&
            keys.some((key) => typeof candidate[key] === 'function');
        });

        const possibleMethods = [
          'getGuildEmojiMap',
          'getGuildEmojis',
          'getEmojiMap',
          'getCustomEmojiById'
        ];

        if (emojiStore) {
          for (const methodName of possibleMethods) {
            const method = emojiStore[methodName];
            if (typeof method !== 'function') continue;

            try {
              const result = method.call(emojiStore, guildId);
              if (result && typeof result === 'object') {
                const values = Array.isArray(result) ? result : Object.values(result);
                const emojis = values
                  .filter((emoji) => emoji?.id && emoji?.name)
                  .map((emoji) => ({
                    id: emoji.id,
                    name: emoji.name,
                    animated: Boolean(emoji.animated)
                  }));

                if (emojis.length > 0) {
                  return {
                    guildId,
                    guildName: guild?.name || document.title.replace(/\s*\|\s*Discord\s*$/i, '').trim() || 'Discord Server',
                    emojis
                  };
                }
              }
            } catch (error) {
              // Try the next candidate method.
            }
          }
        }

        return null;
      };

      try {
        let response = await performGuildFetch();

        if (response.status === 401) {
          const token = readDiscordToken();
          if (token) {
            response = await performGuildFetch(token);
          } else {
            const fallbackGuild = readGuildFromWebpackState();
            if (fallbackGuild) {
              return fallbackGuild;
            }
            return { error: 'Discord session token not found and guild data was unavailable from the current Discord page.' };
          }
        }

        if (!response.ok) {
          const fallbackGuild = readGuildFromWebpackState();
          if (fallbackGuild) {
            return fallbackGuild;
          }
          return { error: `Discord API responded with ${response.status}` };
        }

        const guild = await response.json();
        return {
          guildId,
          guildName: guild.name,
          emojis: Array.isArray(guild.emojis)
            ? guild.emojis.map((emoji) => ({
                id: emoji.id,
                name: emoji.name,
                animated: Boolean(emoji.animated)
              }))
            : []
        };
      } catch (error) {
        return { error: error?.message || 'Failed to read Discord server data' };
      }
    }
  });

  if (!result?.result) {
    throw new Error('Could not access the Discord server tab');
  }

  if (result.result.error) {
    throw new Error(result.result.error);
  }

  return result.result;
}

async function importDiscordServerEmojis(tabId) {
  if (discordImportState.isImporting) {
    throw new Error('A Discord import is already in progress');
  }

  discordImportState.isImporting = true;
  discordImportState.current = 0;
  discordImportState.total = 0;
  discordImportState.guildId = '';
  discordImportState.guildName = '';
  discordImportState.startedAt = Date.now();

  if (!tabId) {
    discordImportState.isImporting = false;
    throw new Error('No active Discord tab found');
  }

  let guildId = '';
  let guildName = '';
  let importedCount = 0;
  let skippedCount = 0;

  try {
    await updateDiscordImportProgress({
      inProgress: true,
      current: 0,
      total: 0,
      statusText: 'Reading current Discord server...'
    });

    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url || !/discord(app)?\.com\/channels\//.test(tab.url)) {
      throw new Error('Open a Discord server in Discord web first');
    }

    const guildData = await extractDiscordGuildFromTab(tabId);
    guildId = String(guildData.guildId || '').trim();
    guildName = guildData.guildName || 'Discord Server';
    const guildEmojis = Array.isArray(guildData.emojis) ? guildData.emojis.filter((emoji) => emoji?.id) : [];

    discordImportState.guildId = guildId;
    discordImportState.guildName = guildName;
    discordImportState.total = guildEmojis.length;

    if (!guildId) {
      throw new Error('Could not determine the current Discord server');
    }

    if (guildEmojis.length === 0) {
      throw new Error('This Discord server has no custom emojis to import');
    }

    await updateDiscordImportProgress({
      inProgress: true,
      current: 0,
      total: guildEmojis.length,
      guildId,
      guildName,
      statusText: `Found ${guildEmojis.length} emoji${guildEmojis.length === 1 ? '' : 's'} in ${guildName}`
    });

    if (!emoteDB.db) {
      await emoteDB.init();
    }

    const existing = await chrome.storage.local.get(['emoteMapping', 'channels']);
    const globalEmoteMapping = { ...(existing.emoteMapping || {}) };
    const channelsById = new Map();

    (existing.channels || []).forEach((channel) => {
      const id = String(channel?.id || '').trim();
      if (id) {
        channelsById.set(id, {
          ...channel,
          sourceType: channel?.sourceType || 'twitch'
        });
      }
    });

    const existingGuildChannel = channelsById.get(guildId);
    const previousGuildKeys = new Set(Object.keys(existingGuildChannel?.emotes || {}));
    const reservedKeys = new Set(Object.keys(globalEmoteMapping));
    previousGuildKeys.forEach((key) => reservedKeys.delete(key));

    const importedEmotes = {};

    for (const emoji of guildEmojis) {
      const key = buildUniqueDiscordEmojiKey(emoji.name, guildName, reservedKeys);
      const url = buildDiscordEmojiCdnUrl(emoji.id, emoji.animated);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (!(blob instanceof Blob) || blob.size === 0) {
          throw new Error('Empty emoji asset');
        }

        await emoteDB.storeEmote(key, url, blob, {
          channel: guildName,
          channelId: guildId,
          sourceType: 'discord',
          sourceLabel: 'Discord',
          guildName,
          discordEmojiId: emoji.id,
          animated: emoji.animated,
          filename: `${sanitizeDiscordEmojiName(emoji.name)}.${emoji.animated ? 'gif' : 'png'}`
        });

        importedEmotes[key] = url;
        globalEmoteMapping[key] = url;
        importedCount += 1;
      } catch (error) {
        console.warn('[Discord Import] Skipping emoji:', emoji?.name, error?.message || error);
        skippedCount += 1;
      }

      discordImportState.current = importedCount + skippedCount;
      await updateDiscordImportProgress({
        inProgress: true,
        current: discordImportState.current,
        total: guildEmojis.length,
        guildId,
        guildName,
        currentEmoji: emoji.name,
        statusText: `Importing emojis from ${guildName}`,
        importedCount,
        skippedCount
      });
    }

    if (importedCount === 0) {
      throw new Error('Could not import any emojis from this server');
    }

    for (const oldKey of previousGuildKeys) {
      if (Object.prototype.hasOwnProperty.call(importedEmotes, oldKey)) continue;
      delete globalEmoteMapping[oldKey];
      await emoteDB.deleteEmote(oldKey);
    }

    channelsById.set(guildId, {
      id: guildId,
      username: guildName,
      emotes: importedEmotes,
      sourceType: 'discord'
    });

    await chrome.storage.local.set({
      emoteMapping: globalEmoteMapping,
      channels: Array.from(channelsById.values())
    });

    discordImportState.isImporting = false;

    const toastMessage = `Imported ${importedCount} emoji${importedCount === 1 ? '' : 's'} from ${guildName}`;
    await updateDiscordImportProgress({
      inProgress: false,
      completed: true,
      current: guildEmojis.length,
      total: guildEmojis.length,
      guildId,
      guildName,
      importedCount,
      skippedCount,
      channelId: guildId,
      toastMessage
    });

    return {
      success: true,
      guildName,
      channelId: guildId,
      importedCount,
      skippedCount
    };
  } catch (error) {
    discordImportState.isImporting = false;
    await updateDiscordImportProgress({
      inProgress: false,
      current: discordImportState.current,
      total: discordImportState.total,
      guildId,
      guildName,
      importedCount,
      skippedCount,
      error: error.message
    });
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTempFilename(filename = 'mojify-upload.bin') {
  const cleaned = String(filename)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return cleaned || 'mojify-upload.bin';
}

async function waitForDownloadCompletion(downloadId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      chrome.downloads.onChanged.removeListener(handleChange);
    };

    const finishWithSearch = () => {
      chrome.downloads.search({ id: downloadId }, (items) => {
        const item = items && items[0];
        if (!item || !item.filename) {
          cleanup();
          reject(new Error('Downloaded file path unavailable'));
          return;
        }
        cleanup();
        resolve(item);
      });
    };

    const handleChange = (delta) => {
      if (delta.id !== downloadId || !delta.state) {
        return;
      }

      if (delta.state.current === 'complete') {
        finishWithSearch();
      } else if (delta.state.current === 'interrupted') {
        cleanup();
        reject(new Error('Temp file download interrupted'));
      }
    };

    chrome.downloads.onChanged.addListener(handleChange);
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out preparing temp upload file'));
    }, timeoutMs);

    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items && items[0];
      if (item?.state === 'complete' && item.filename) {
        cleanup();
        resolve(item);
      }
    });
  });
}

async function createDebuggerUploadFile(dataUrl, filename) {
  const safeFilename = sanitizeTempFilename(filename);
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: `MojifyTemp/${Date.now()}-${safeFilename}`,
    saveAs: false,
    conflictAction: 'overwrite'
  });

  const downloadItem = await waitForDownloadCompletion(downloadId);
  return {
    downloadId,
    filePath: downloadItem.filename
  };
}

async function attachDebugger(tabId) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (error) {
    if (!String(error?.message || '').includes('Another debugger is already attached')) {
      throw error;
    }
  }

  return target;
}

async function detachDebugger(target) {
  try {
    await chrome.debugger.detach(target);
  } catch (error) {
    console.log('[Mojify] Debugger detach skipped:', error.message);
  }
}

async function sendDebuggerCommand(target, method, params = {}) {
  return chrome.debugger.sendCommand(target, method, params);
}

async function clickWhatsAppAttachButton(target) {
  const expression = `(() => {
    const selectors = [
      'button[title*="Attach"]',
      'button[aria-label*="Attach"]',
      'div[title*="Attach"]',
      'div[aria-label*="Attach"]',
      'span[data-icon="plus"]'
    ];

    for (const selector of selectors) {
      const match = document.querySelector(selector);
      if (!match) continue;
      const clickable = match.closest('button,[role="button"],div') || match;
      if (clickable && typeof clickable.click === 'function') {
        clickable.click();
        return { clicked: true, selector };
      }
    }

    return { clicked: false };
  })();`;

  const result = await sendDebuggerCommand(target, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });

  return result?.result?.value || { clicked: false };
}

async function markWhatsAppFileInput(target, mediaKind = 'image') {
  const expression = `(() => {
    const mediaKind = "__MOJIFY_MEDIA_KIND__";
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const score = (input) => {
      const accept = String(input.accept || '').toLowerCase();
      let value = 0;

      if (accept.includes('json') || accept.includes('.json')) value -= 100;
      if (accept.includes('text/') || accept.includes('.txt')) value -= 60;
      if (accept.includes('application/')) value -= 40;
      if (accept.includes('sticker')) value -= 40;
      if (accept.includes('image/*') || accept.includes('video/*')) value += 8;
      if (accept.includes('video/mp4')) value += 10;
      if (accept.includes('video/3gpp')) value += 6;
      if (!input.disabled) value += 5;
      if (input.offsetWidth > 0 || input.offsetHeight > 0) value += 3;
      if (input.closest('[role="dialog"]')) value += 10;
      if (input.closest('footer')) value += 6;
      if (accept.includes('image')) value += 4;
      if (accept.includes('video')) value += 4;
      if (mediaKind === 'video' && accept.includes('video')) value += 20;
      if (mediaKind === 'image' && accept.includes('image')) value += 20;
      if (mediaKind === 'video' && accept.includes('image') && !accept.includes('video')) value -= 25;
      if (mediaKind === 'image' && accept.includes('video') && !accept.includes('image')) value -= 5;
      return value;
    };

    const ranked = inputs
      .map((input) => ({ input, score: score(input) }))
      .filter(({ score }) => score > -20)
      .sort((a, b) => b.score - a.score);

    const pick = ranked[0]?.input || inputs[0] || null;
    if (!pick) {
      return { found: false, count: inputs.length };
    }

    const marker = 'mojify-debugger-target-' + Math.random().toString(36).slice(2);
    pick.setAttribute('data-mojify-debugger-target', marker);
    return {
      found: true,
      marker,
      accept: pick.accept || '',
      multiple: !!pick.multiple,
      score: ranked[0]?.score || 0
    };
  })();`.replace('__MOJIFY_MEDIA_KIND__', mediaKind);

  const result = await sendDebuggerCommand(target, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });

  return result?.result?.value || { found: false };
}

async function getNodeIdForMarker(target, marker) {
  const documentRoot = await sendDebuggerCommand(target, 'DOM.getDocument', {});
  const rootNodeId = documentRoot?.root?.nodeId;
  if (!rootNodeId) {
    throw new Error('Could not access WhatsApp DOM root');
  }

  const selector = `[data-mojify-debugger-target="${marker}"]`;
  const queryResult = await sendDebuggerCommand(target, 'DOM.querySelector', {
    nodeId: rootNodeId,
    selector
  });

  if (!queryResult?.nodeId) {
    throw new Error('WhatsApp file input marker not found');
  }

  return queryResult.nodeId;
}

async function findWhatsAppDropPoint(target) {
  const expression = `(() => {
    const candidates = [
      'footer [contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'footer',
      '#main footer',
      '#main'
    ];

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none';
    };

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + Math.min(rect.height / 2, 24));
      return {
        found: true,
        selector,
        x,
        y,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }

    return { found: false };
  })();`;

  const result = await sendDebuggerCommand(target, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });

  return result?.result?.value || { found: false };
}

async function focusWhatsAppComposer(target) {
  const expression = `(() => {
    const selectors = [
      'footer [contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ];

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none';
    };

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!isVisible(el)) continue;
      el.focus();
      if (typeof el.click === 'function') {
        el.click();
      }
      const rect = el.getBoundingClientRect();
      return {
        focused: true,
        x: Math.round(rect.left + Math.min(rect.width / 2, 40)),
        y: Math.round(rect.top + Math.min(rect.height / 2, 20))
      };
    }

    return { focused: false };
  })();`;

  const result = await sendDebuggerCommand(target, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });

  return result?.result?.value || { focused: false };
}

async function dispatchWhatsAppPasteShortcut(target, point = null) {
  if (point?.focused && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    await sendDebuggerCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1
    });
    await sendDebuggerCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1
    });
    await sleep(75);
  }

  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    windowsVirtualKeyCode: 17,
    code: 'ControlLeft',
    key: 'Control',
    modifiers: 2
  });
  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    windowsVirtualKeyCode: 86,
    code: 'KeyV',
    key: 'v',
    text: 'v',
    unmodifiedText: 'v',
    modifiers: 2
  });
  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    windowsVirtualKeyCode: 86,
    code: 'KeyV',
    key: 'v',
    modifiers: 2
  });
  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    windowsVirtualKeyCode: 17,
    code: 'ControlLeft',
    key: 'Control',
    modifiers: 0
  });
}

async function dispatchWhatsAppFileDrop(target, dropPoint, downloadInfo, filename, mimeType = '') {
  const dragData = {
    items: [
      {
        mimeType: mimeType || 'application/octet-stream',
        data: ''
      }
    ],
    files: [downloadInfo.filePath],
    dragOperationsMask: 1
  };

  await sendDebuggerCommand(target, 'Input.dispatchDragEvent', {
    type: 'dragEnter',
    x: dropPoint.x,
    y: dropPoint.y,
    data: dragData,
    modifiers: 0
  });

  await sendDebuggerCommand(target, 'Input.dispatchDragEvent', {
    type: 'dragOver',
    x: dropPoint.x,
    y: dropPoint.y,
    data: dragData,
    modifiers: 0
  });

  await sleep(100);

  await sendDebuggerCommand(target, 'Input.dispatchDragEvent', {
    type: 'drop',
    x: dropPoint.x,
    y: dropPoint.y,
    data: dragData,
    modifiers: 0
  });
}

async function waitForWhatsAppPreview(target, timeoutMs = 6000) {
  const expression = `(() => {
    const selectors = [
      '[data-animate-modal-popup="true"]',
      'div[role="dialog"]',
      '[data-icon="media-send"]',
      '[data-icon="send"]',
      'button[aria-label*="Send"]',
      'button[title*="Send"]',
      'video',
      'canvas',
      'img[src^="blob:"]'
    ];

    const hasVisibleMatch = selectors.some((selector) => {
      const match = document.querySelector(selector);
      if (!match) return false;
      const rect = match.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (hasVisibleMatch) return true;

    const composerImages = Array.from(document.querySelectorAll('img')).some((img) => {
      const src = String(img.getAttribute('src') || '');
      const rect = img.getBoundingClientRect();
      return rect.width > 40 &&
        rect.height > 40 &&
        (src.startsWith('blob:') || src.startsWith('data:image/'));
    });

    return composerImages;
  })();`;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await sendDebuggerCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true
    });

    if (result?.result?.value === true) {
      return true;
    }

    await sleep(150);
  }

  return false;
}

async function insertMediaIntoWhatsAppWithDebugger(tabId, dataUrl, filename, mimeType = '') {
  let target = null;
  let downloadInfo = null;

  try {
    downloadInfo = await createDebuggerUploadFile(dataUrl, filename);
    target = await attachDebugger(tabId);

    await sendDebuggerCommand(target, 'DOM.enable');
    await sendDebuggerCommand(target, 'Runtime.enable');
    const mediaKind = String(mimeType).startsWith('video/') ? 'video' : 'image';

    if (mediaKind === 'image') {
      await clickWhatsAppAttachButton(target);
      await sleep(450);

      const inputInfo = await markWhatsAppFileInput(target, mediaKind);
      if (!inputInfo.found) {
        return { success: false, error: 'WhatsApp file input not found' };
      }

      const nodeId = await getNodeIdForMarker(target, inputInfo.marker);
      await sendDebuggerCommand(target, 'DOM.setFileInputFiles', {
        nodeId,
        files: [downloadInfo.filePath]
      });
    } else {
      const dropPoint = await findWhatsAppDropPoint(target);
      if (!dropPoint.found) {
        return { success: false, error: 'WhatsApp drop target not found' };
      }

      await dispatchWhatsAppFileDrop(target, dropPoint, downloadInfo, filename, mimeType);
    }

    const previewOpened = await waitForWhatsAppPreview(target);
    if (!previewOpened) {
      return { success: false, error: 'WhatsApp did not open media preview' };
    }

    return { success: true };
  } catch (error) {
    console.error('[Mojify] WhatsApp debugger insert failed:', error);
    return { success: false, error: error.message || 'WhatsApp debugger insert failed' };
  } finally {
    if (target) {
      await detachDebugger(target);
    }
    if (downloadInfo?.downloadId) {
      try {
        await chrome.downloads.erase({ id: downloadInfo.downloadId });
      } catch (error) {
        console.log('[Mojify] Temp download erase skipped:', error.message);
      }
    }
  }
}

async function pasteMediaIntoWhatsAppWithDebugger(tabId) {
  let target = null;

  try {
    target = await attachDebugger(tabId);
    await sendDebuggerCommand(target, 'Runtime.enable');

    const composerPoint = await focusWhatsAppComposer(target);
    if (!composerPoint.focused) {
      return { success: false, error: 'WhatsApp message box not found' };
    }

    await dispatchWhatsAppPasteShortcut(target, composerPoint);

    const previewOpened = await waitForWhatsAppPreview(target);
    if (!previewOpened) {
      return { success: false, error: 'WhatsApp did not open media preview after paste' };
    }

    return { success: true };
  } catch (error) {
    console.error('[Mojify] WhatsApp debugger paste failed:', error);
    return { success: false, error: error.message || 'WhatsApp debugger paste failed' };
  } finally {
    if (target) {
      await detachDebugger(target);
    }
  }
}

async function handleChannelIdsChanged(oldChannelIds = [], newChannelIds = []) {
  console.log('[Auto-Download] Channel IDs changed:', { old: oldChannelIds, new: newChannelIds });

  if (JSON.stringify(newChannelIds) === JSON.stringify(oldChannelIds)) {
    console.log('[Auto-Download] Channel IDs unchanged, skipping');
    return;
  }

  if (newChannelIds.length === 0 && oldChannelIds.length > 0) {
    console.log('[Auto-Download] Channel IDs cleared, cleaning up storage');
    try {
      await emoteDB.clearAll();
      await chrome.storage.local.remove([
        'channels',
        'emoteMapping',
        'downloadInProgress',
        'downloadProgress',
        'emoteImageData'
      ]);
      sendRuntimeMessage({
        type: 'showToast',
        message: 'Channel IDs cleared - storage cleaned up',
        toastType: 'success'
      });
    } catch (error) {
      console.error('[Auto-Download] Error cleaning up storage:', error);
    }
    return;
  }

  if (newChannelIds.length === 0) {
    return;
  }

  sendRuntimeMessage({
    type: 'automaticDownloadStarted',
    channelIds: newChannelIds
  });

  try {
    const result = await downloadEmotes();
    if (!result?.success) {
      sendRuntimeMessage({
        type: 'showToast',
        message: `Download failed: ${result.error}`,
        toastType: 'error'
      });
    } else if (result?.skipped) {
      console.log('[Auto-Download] Download already in progress, skipping duplicate notification');
    }
  } catch (error) {
    console.error('[Auto-Download] Error during automatic download:', error);
    sendRuntimeMessage({
      type: 'showToast',
      message: `Automatic download failed: ${error.message}`,
      toastType: 'error'
    });
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'downloadEmotes',
      title: 'Download Emotes',
      contexts: ['action']
    });
  });

  console.log('[Mojify] Extension installed/updated:', details.reason);
  initializeEmoteMapping();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'downloadEmotes') {
    downloadEmotes();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  console.log('[Mojify] Storage changed:', { area, changes: Object.keys(changes) });

  if (area !== 'local' || !changes.channelIds) {
    console.log('[Mojify] Storage change not for channelIds or not local area');
    return;
  }

  const oldChannelIds = changes.channelIds.oldValue || [];
  const newChannelIds = changes.channelIds.newValue || [];
  handleChannelIdsChanged(oldChannelIds, newChannelIds);
});

// Initialize emote mapping on startup
async function initializeEmoteMapping() {
  console.log("[Mojify] Initializing emote mapping on startup...");

  try {
    // Get stored emote mapping
    const result = await chrome.storage.local.get(['emoteMapping', 'channels']);

    if (result.emoteMapping && Object.keys(result.emoteMapping).length > 0) {
      console.log("[Mojify] Found existing emote mapping with", Object.keys(result.emoteMapping).length, "emotes");
      console.log("[Mojify] Sample emotes:", Object.keys(result.emoteMapping).slice(0, 5));
    } else {
      console.log("[Mojify] No emote mapping found - user needs to add channels");
    }

    if (result.channels && result.channels.length > 0) {
      console.log("[Mojify] Found", result.channels.length, "configured channels");
    } else {
      console.log("[Mojify] No channels configured");
    }
  } catch (error) {
    console.error("[Mojify] Error initializing emote mapping:", error);
  }
}

// Extension startup listeners
chrome.runtime.onStartup.addListener(() => {
  console.log("[Mojify] Extension startup detected");
  initializeEmoteMapping();
});

// Text detection and auto-replace functionality
async function detectAndReplaceEmotes(tabId) {
  try {
    // Get current emote mapping
    const result = await chrome.storage.local.get(['emoteMapping']);
    if (!result.emoteMapping || Object.keys(result.emoteMapping).length === 0) {
      console.log("[Mojify] No emotes available for auto-replace");
      return;
    }

    const emoteMapping = result.emoteMapping;
    console.log("[Mojify] Auto-replace checking with", Object.keys(emoteMapping).length, "emotes");

    // Inject detection script into the current tab
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: () => {
        // Get focused element text content
        const activeElement = document.activeElement;
        if (!activeElement) return null;

        let textContent = '';
        if (activeElement.isContentEditable) {
          textContent = activeElement.textContent || activeElement.innerText || '';
        } else if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
          textContent = activeElement.value || '';
        } else {
          return null;
        }

        // Look for emote pattern in the last 50 characters
        const recentText = textContent.slice(-50);
        const emotePattern = /:([a-zA-Z0-9_!]+):/g;
        const matches = [...recentText.matchAll(emotePattern)];

        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1];
          const emoteName = lastMatch[1];
          const fullCommand = lastMatch[0];

          return {
            emoteName: emoteName,
            fullCommand: fullCommand,
            textContent: textContent,
            elementType: activeElement.tagName,
            isContentEditable: activeElement.isContentEditable
          };
        }

        return null;
      }
    });

    if (results && results[0] && results[0].result) {
      const detection = results[0].result;
      console.log("[Mojify] Detected emote command:", detection.fullCommand);

      // Check if emote exists (try both with and without colons)
      const hasEmoteWithoutColons = emoteMapping[detection.emoteName];
      const hasEmoteWithColons = emoteMapping[detection.fullCommand];

      if (hasEmoteWithoutColons || hasEmoteWithColons) {
        const emoteKey = hasEmoteWithoutColons ? detection.emoteName : detection.fullCommand;
        console.log("[Mojify] Found matching emote, attempting to replace:", emoteKey);

        // Clear the emote command text and insert emote
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          function: (fullCommand) => {
            const activeElement = document.activeElement;
            if (!activeElement) return false;

            if (activeElement.isContentEditable) {
              const textContent = activeElement.textContent || activeElement.innerText || '';
              const commandIndex = textContent.lastIndexOf(fullCommand);

              if (commandIndex !== -1) {
                // Create selection to remove the emote command
                const selection = window.getSelection();
                const range = document.createRange();

                // Find the text node containing the command
                const walker = document.createTreeWalker(
                  activeElement,
                  NodeFilter.SHOW_TEXT,
                  null,
                  false
                );

                let textNode;
                let currentPos = 0;

                while (textNode = walker.nextNode()) {
                  const nodeLength = textNode.textContent.length;
                  if (currentPos + nodeLength > commandIndex) {
                    const startOffset = commandIndex - currentPos;
                    const endOffset = Math.min(startOffset + fullCommand.length, nodeLength);

                    range.setStart(textNode, startOffset);
                    range.setEnd(textNode, endOffset);
                    range.deleteContents();

                    // Position cursor at deletion point
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    return true;
                  }
                  currentPos += nodeLength;
                }
              }
            } else if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
              const value = activeElement.value;
              const commandIndex = value.lastIndexOf(fullCommand);
              if (commandIndex !== -1) {
                const newValue = value.substring(0, commandIndex) + value.substring(commandIndex + fullCommand.length);
                activeElement.value = newValue;
                activeElement.selectionStart = activeElement.selectionEnd = commandIndex;
                return true;
              }
            }
            return false;
          },
          args: [detection.fullCommand]
        });

        // Insert the emote using existing function
        const emoteUrl = emoteMapping[emoteKey];
        await insertEmoteIntoMessenger(tabId, emoteUrl, emoteKey);
      }
    }
  } catch (error) {
    console.error("[Mojify] Error in auto-replace:", error);
  }
}

// Set up input monitoring for active tabs
async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to convert blob to base64'));
    reader.readAsDataURL(blob);
  });
}

async function serializeStoredEmote(result) {
  if (result && result.blob) {
    return { ...result, dataUrl: await blobToDataUrl(result.blob), blob: null };
  }

  return result;
}

let monitoringTabs = new Set();

async function startMonitoringTab(tabId) {
  if (monitoringTabs.has(tabId)) return;

  try {
    // Check if tab is on a supported site first
    const tab = await chrome.tabs.get(tabId);
    const supportedSites = [
      'messenger.com',
      'discord.com',
      'discordapp.com',
      'facebook.com',
      'telegram.org',
      'web.whatsapp.com'
    ];

    const isSupported = supportedSites.some(site => tab.url.includes(site));
    if (!isSupported) {
      // Silently skip unsupported sites
      return;
    }
    // Inject input listener
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: () => {
        if (window.mojifyInputListener) return; // Already injected

        window.mojifyInputListener = async (event) => {
          // Only trigger on colon character to complete emote commands
          if (event.data === ':') {
            setTimeout(() => {
              chrome.runtime.sendMessage({
                type: 'checkForEmotes',
                tabId: chrome.runtime.id
              });
            }, 50); // Small delay to ensure text is updated
          }
        };

        document.addEventListener('input', window.mojifyInputListener);
        console.log("[Mojify] Input monitoring started on tab");
      }
    });

    monitoringTabs.add(tabId);
    console.log("[Mojify] Started monitoring tab:", tabId);
  } catch (error) {
    // Handle restricted URLs and unsupported sites gracefully
    if (error.message && (error.message.includes('chrome://') ||
                         error.message.includes('edge://') ||
                         error.message.includes('Cannot access contents') ||
                         error.message.includes('Extension manifest must request permission'))) {
      // Silently ignore restricted URL errors
      return;
    }
    console.error("[Mojify] Error setting up tab monitoring:", error);
  }
}

function handleRuntimeMessage(request, sender, sendResponse) {
  if (request.action === 'getEmote') {
    emoteDB.getEmote(request.key)
      .then(serializeStoredEmote)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse(null));
    return true;
  }

  if (request.action === 'getAllEmotes') {
    emoteDB.getAllEmotes()
      .then(async (result) => {
        if (!result || result.length === 0) return result;
        return Promise.all(result.map(serializeStoredEmote));
      })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse([]));
    return true;
  }

  if (request.type === 'downloadEmotes' || request.action === 'downloadEmotes') {
    downloadEmotes()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'importDiscordServerEmojis') {
    importDiscordServerEmojis(request.tabId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'deleteStoredEmotes') {
    Promise.all((request.keys || []).map((key) => emoteDB.deleteEmote(key)))
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'insertEmote') {
    insertEmoteIntoMessenger(sender.tab.id, request.emoteUrl, request.emoteTrigger)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'whatsappDebuggerInsert') {
    insertMediaIntoWhatsAppWithDebugger(request.tabId, request.dataUrl, request.filename, request.mimeType)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'whatsappDebuggerPaste') {
    pasteMediaIntoWhatsAppWithDebugger(request.tabId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'checkForEmotes') {
    detectAndReplaceEmotes(sender.tab.id)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error("[Mojify] Error in checkForEmotes:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  return false;
}

// Auto-start monitoring when tabs become active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      await startMonitoringTab(activeInfo.tabId);
    }
  } catch (error) {
    console.error("[Mojify] Error setting up active tab monitoring:", error);
  }
});

// Monitor tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
    monitoringTabs.delete(tabId); // Reset monitoring for this tab
    await startMonitoringTab(tabId);
  }
});

// Initialize on script load as well (for service worker reactivation)
initializeEmoteMapping();

chrome.runtime.onMessage.addListener(handleRuntimeMessage);
