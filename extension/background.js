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

// Initialize service worker
(async function initServiceWorker() {
  try {
    await resetDownloadState();
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

      const allEmotes = await emoteDB.getAllEmotes();
      return {
        success: true,
        message: "Skipped download - emotes restored from backup",
        totalEmotes: allEmotes.length,
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

    // Pre-fetch channel names and create channels immediately
    const channelEmotes = [];
    let totalNewEmotes = 0;

    // First pass: fetch channel info and create channels with real names
    for (const channelId of channelIds) {
      const trimmedChannelId = channelId.trim();
      if (!trimmedChannelId) continue;

      try {
        const result = await get7TVEmotes(trimmedChannelId);

        // Update or create channel with real username immediately
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

        if (Object.keys(result.emotes).length > 0) {
          // INCREMENTAL CHECK: Compare server emotes vs locally stored emotes
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
        }
      } catch (error) {
        console.error(`[Download] Error fetching emotes for ${trimmedChannelId}:`, error);
        // Create channel with ID as fallback name
        const existingChannelIndex = channels.findIndex(ch => ch.id === trimmedChannelId);
        if (existingChannelIndex === -1) {
          channels.push({
            id: trimmedChannelId,
            username: trimmedChannelId,
            emotes: {}
          });
        }
      }
    }

    // Save channels with real names immediately before download starts
    await chrome.storage.local.set({
      channels: channels,
      downloadInProgress: true
    });

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
            return { success: true, key, url, channel, responseTime, size: blob.size };
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
        return { success: false, key, url, channel, error: error.message, responseTime };
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

        // Update progress after each emote
        if (downloadState.current % 3 === 0 || downloadState.current === downloadState.total) {
          await chrome.storage.local.set({
            emoteMapping: globalEmoteMapping,
            downloadProgress: {
              current: downloadState.current,
              total: downloadState.total,
              currentEmote: `Batch ${currentBatch} completed`
            }
          });

          try {
            chrome.runtime.sendMessage({
              type: 'downloadProgress',
              current: downloadState.current,
              total: downloadState.total,
              currentEmote: `Downloading batch ${currentBatch}...`,
              newEmote: true
            });
          } catch (e) {
            // Popup is closed, continue silently
          }
        }
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
        const { key, url, channel } = emoteData;

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
    const allEmotes = await emoteDB.getAllEmotes();
    console.log(`[Download] Completed! Downloaded ${totalNewEmotes} new emotes. Total stored: ${allEmotes.length}`);
    return { success: true, totalEmotes: allEmotes.length };

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
          if (result.skipped) {
            // Don't show notification for skipped downloads
            console.log('[Auto-Download] Download was already in progress, skipped notification');
          } else {
            chrome.runtime.sendMessage({
              type: 'showToast',
              message: result.success ?
                `Emotes downloaded successfully (${result.totalEmotes} total)` :
                `Download failed: ${result.error}`,
              toastType: result.success ? 'success' : 'error'
            });
          }
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
      .then(result => {
        if (sendResponse) sendResponse(result);
      })
      .catch(error => {
        if (sendResponse) sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }

  // Handle emote insertion
  if (request.type === 'insertEmote') {
    insertEmoteIntoMessenger(sender.tab.id, request.emoteUrl, request.emoteTrigger)
      .then(result => {
        if (sendResponse) sendResponse(result);
      })
      .catch(error => {
        if (sendResponse) sendResponse({ success: false, error: error.message });
      });
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

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Mojify] Extension installed/updated:", details.reason);
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
// Message handlers for content script communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getEmote') {
    emoteDB.getEmote(request.key)
      .then(result => sendResponse(result))
      .catch(error => sendResponse(null));
    return true; // Keep the message channel open for async response
  }

  if (request.action === 'getAllEmotes') {
    emoteDB.getAllEmotes()
      .then(result => sendResponse(result))
      .catch(error => sendResponse([]));
    return true; // Keep the message channel open for async response
  }
});

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

  // Handle emote detection trigger
  if (request.type === 'checkForEmotes') {
    detectAndReplaceEmotes(sender.tab.id)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        console.error("[Mojify] Error in checkForEmotes:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
});

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

// Message handler for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadEmotes') {
    downloadEmotes().then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Will respond asynchronously
  }
});
