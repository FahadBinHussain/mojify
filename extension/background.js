let detectedTelegramStickerSet = null;
try { chrome.action.setBadgeText({ text: '' }); } catch (e) {}

const SEVEN_TV_API_ORIGIN = "https://api.7tv.app";
const SEVEN_TV_V3_BASE_URL = `${SEVEN_TV_API_ORIGIN}/v3`;
const TWITCH_API_BASE_URL = `${SEVEN_TV_V3_BASE_URL}/users/twitch`;
const SEVEN_TV_EMOTE_SET_BASE_URL = `${SEVEN_TV_V3_BASE_URL}/emote-sets`;
const SEVEN_TV_GQL_URL = `${SEVEN_TV_API_ORIGIN}/v4/gql`;
const SEVEN_TV_RESOLVE_TIMEOUT_MS = 45000;
const TELEGRAM_BOT_API_ORIGIN = 'https://api.telegram.org';
const TELEGRAM_IMPORT_TIMEOUT_MS = 45000;
const TELEGRAM_TGS_NATIVE_HOST = 'com.mojify.tgs_host';
const TELEGRAM_TGS_NATIVE_TIMEOUT_MS = 180000;
const SEVEN_TV_USER_EMOTE_SETS_QUERY = `
  query UserEmoteSets($id: Id!) {
    users {
      user(id: $id) {
        emoteSets {
          id
          name
          capacity
          kind
          emotes(page: 1, perPage: 12) {
            totalCount
            items {
              emote {
                images {
                  url
                  mime
                  size
                  scale
                  width
                  height
                  frameCount
                }
              }
            }
          }
        }
      }
    }
  }
`;

function createTimeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(createTimeoutError(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const requestPromise = (async () => {
    const fetchOptions = Object.assign({}, options, { signal: controller.signal });
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  })();

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchBlobWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(createTimeoutError(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const requestPromise = (async () => {
    const fetchOptions = Object.assign({}, options, { signal: controller.signal });
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.blob();
  })();

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// IndexedDB wrapper for emote storage - stores blobs directly as values
const emoteDB = {
  db: null,
  dbName: 'MojifyEmotes',
  version: 5,

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

        // Create emote blobs object store (stores blob directly as value)
        if (!db.objectStoreNames.contains('emoteBlobs')) {
          db.createObjectStore('emoteBlobs');
        }

        // Create emote metadata object store
        if (!db.objectStoreNames.contains('emoteMetadata')) {
          const metadataStore = db.createObjectStore('emoteMetadata', { keyPath: 'key' });
          metadataStore.createIndex('channel', 'channel', { unique: false });
          metadataStore.createIndex('url', 'url', { unique: false });
          metadataStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (db.objectStoreNames.contains('emoteSources')) {
          db.deleteObjectStore('emoteSources');
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
            // Return combined result with blob directly accessible
            resolve({
              key: key,
              blob: blob,
              ...metadataResult
            });
          } else {
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

  async getAllEmoteMetadata() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteMetadata'], 'readonly');
      const metadataStore = transaction.objectStore('emoteMetadata');
      const request = metadataStore.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async deleteEmotesByChannelIds(channelIds) {
    if (!this.db) await this.init();
    if (!channelIds || channelIds.length === 0) return 0;

    const channelIdSet = new Set(channelIds.map(String));

    // Find all keys whose metadata channelId matches
    const allMetadata = await this.getAllEmoteMetadata();
    const keysToDelete = [];

    for (const meta of allMetadata) {
      const metaChannelId = String(meta?.channelId || '');
      const metaKey = String(meta?.key || '');

      // Match by channelId in metadata, or by channelId in the storage key prefix
      if (channelIdSet.has(metaChannelId)) {
        keysToDelete.push(meta.key);
      } else {
        // Check if the storage key contains any of the channel IDs
        for (const cid of channelIdSet) {
          if (metaKey.includes(cid)) {
            keysToDelete.push(meta.key);
            break;
          }
        }
      }
    }

    if (keysToDelete.length === 0) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readwrite');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');
      let deleted = 0;

      transaction.oncomplete = () => resolve(deleted);
      transaction.onerror = () => reject(transaction.error);

      for (const key of keysToDelete) {
        blobsStore.delete(key);
        metadataStore.delete(key);
        deleted++;
      }
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



function extract7TVEmotes(emoteList = []) {
  const emotes = {};

  emoteList.forEach((emote) => {
    try {
      if (emote.name && emote.data && emote.data.host) {
        const emoteKey = `:${emote.name}:`;
        const hostUrl = emote.data.host.url.replace(/^\/\//, '');
        const files = emote.data.host.files;
        if (files && files.length > 0) {
          const fileName = files[files.length - 1].name;
          emotes[emoteKey] = {
            url: `https://${hostUrl}/${fileName}`,
            emoteId: emote.id || '',
            name: emote.name
          };
        }
      }
    } catch (emoteError) {
      // Skip malformed emote entries without breaking the whole source.
    }
  });

  return emotes;
}

function get7TVSetStorageChannelId(channelId, setId, activeSetId) {
  const cleanChannelId = String(channelId || '').trim();
  const cleanSetId = String(setId || '').trim();
  const cleanActiveSetId = String(activeSetId || '').trim();

  if (cleanChannelId && cleanSetId && cleanSetId === cleanActiveSetId && /^\d+$/.test(cleanChannelId)) {
    return cleanChannelId;
  }

  return `7tv-set:${cleanSetId || cleanChannelId}`;
}

function normalize7TVSetSummary(set, activeSetId = '') {
  const previewImages = [];
  const items = set?.emotes?.items || [];

  items.forEach((item) => {
    const images = item?.emote?.images || [];
    const image = images.find((candidate) => candidate?.mime === 'image/webp' && candidate?.scale === 2) ||
      images.find((candidate) => candidate?.mime?.startsWith('image/')) ||
      images[0];

    if (image?.url) {
      previewImages.push(image.url);
    }
  });

  return {
    id: set.id,
    name: set.name || set.id,
    capacity: Number(set.capacity || 0),
    kind: set.kind || 'NORMAL',
    totalCount: Number(set?.emotes?.totalCount || 0),
    previewImages: previewImages.slice(0, 4),
    isActive: Boolean(activeSetId && set.id === activeSetId)
  };
}

async function fetch7TVUserEmoteSets(sevenTvUserId, activeSetId = '') {
  if (!sevenTvUserId) {
    throw new Error('Missing 7TV user ID');
  }

  const response = await fetchJsonWithTimeout(SEVEN_TV_GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      operationName: 'UserEmoteSets',
      variables: { id: sevenTvUserId },
      query: SEVEN_TV_USER_EMOTE_SETS_QUERY
    })
  }, SEVEN_TV_RESOLVE_TIMEOUT_MS);

  const sets = response?.data?.users?.user?.emoteSets;
  if (!Array.isArray(sets)) {
    const apiError = response?.errors?.[0]?.message || '7TV did not return emote sets';
    throw new Error(apiError);
  }

  return sets.map((set) => normalize7TVSetSummary(set, activeSetId));
}

async function get7TVChannelEmoteSets(channelId, knownSevenTvUserId = '', knownActiveSetId = '') {
  let sevenTvUserId = String(knownSevenTvUserId || '').trim();
  let activeSetId = String(knownActiveSetId || '').trim();
  let username = String(channelId || '').trim();
  let fallbackSets = [];

  if (!sevenTvUserId || !activeSetId || /^\d+$/.test(String(channelId || '').trim())) {
    const channelData = await fetchJsonWithTimeout(`${TWITCH_API_BASE_URL}/${channelId}`, {}, SEVEN_TV_RESOLVE_TIMEOUT_MS);
    sevenTvUserId = sevenTvUserId || channelData?.user?.id || channelData?.emote_set_id || '';
    activeSetId = activeSetId || channelData?.emote_set_id || '';
    username = channelData?.display_name || channelData?.username || channelData?.user?.display_name || channelData?.user?.username || username;
    fallbackSets = Array.isArray(channelData?.user?.emote_sets) ? channelData.user.emote_sets : [];
  }

  let sets = [];
  try {
    sets = await fetch7TVUserEmoteSets(sevenTvUserId, activeSetId);
  } catch (error) {
    if (fallbackSets.length === 0) throw error;
    sets = fallbackSets.map((set) => ({
      id: set.id,
      name: set.name || set.id,
      capacity: Number(set.capacity || 0),
      kind: 'NORMAL',
      totalCount: Number(set.emote_count || 0),
      previewImages: [],
      isActive: Boolean(activeSetId && set.id === activeSetId)
    }));
  }

  return {
    success: true,
    channelId,
    sevenTvUserId,
    activeSetId,
    username,
    sets
  };
}

async function get7TVEmoteSet(setId, options = {}) {
  const cleanSetId = String(setId || '').trim();
  if (!cleanSetId) {
    throw new Error('Missing 7TV emote set ID');
  }

  const data = await fetchJsonWithTimeout(`${SEVEN_TV_EMOTE_SET_BASE_URL}/${cleanSetId}`, {}, SEVEN_TV_RESOLVE_TIMEOUT_MS);
  const emoteList = data.emotes || [];
  const emotes = extract7TVEmotes(emoteList);
  const parentName = options.username || data?.owner?.display_name || data?.owner?.username || '7TV';
  const setName = data.name || options.setName || cleanSetId;
  const activeSetId = options.activeSetId || '';
  const channelId = get7TVSetStorageChannelId(options.channelId, cleanSetId, activeSetId);
  const isActiveSet = Boolean(activeSetId && cleanSetId === activeSetId);

  return {
    channelId,
    platformChannelId: options.channelId || '',
    username: isActiveSet ? parentName : `${parentName} - ${setName}`,
    baseUsername: parentName,
    emoteSetId: cleanSetId,
    activeSetId,
    emoteSetName: setName,
    emoteSetKind: data.kind || options.kind || 'NORMAL',
    sevenTvUserId: options.sevenTvUserId || data?.owner?.id || '',
    isEmoteSet: !isActiveSet,
    emotes
  };
}

async function get7TVEmotes(channelId) {
  // Use /users/twitch/:id for Twitch numeric IDs, /users/:id for 7TV user IDs
  const is7tvUserId = /^[0-9A-Z]{26}$/.test(channelId);
  const url = is7tvUserId
    ? `${SEVEN_TV_V3_BASE_URL}/users/${channelId}`
    : `${TWITCH_API_BASE_URL}/${channelId}`;
  try {
    const data = await fetchJsonWithTimeout(url, {}, SEVEN_TV_RESOLVE_TIMEOUT_MS);
    const emoteList = data.emote_set?.emotes || [];
    const username = data.display_name || data.username || data.user?.display_name || data.user?.username || channelId;
    const emotes = extract7TVEmotes(emoteList);

    return {
      channelId,
      platformChannelId: channelId,
      username,
      baseUsername: username,
      sevenTvUserId: data.user?.id || data.emote_set_id || '',
      activeSetId: data.emote_set_id || '',
      emoteSetId: data.emote_set_id || '',
      emoteSetName: data.emote_set?.name || `${username}'s Emotes`,
      emoteSetKind: 'NORMAL',
      isEmoteSet: false,
      emotes
    };
  } catch (error) {
    const errorMessage = error?.message || String(error);
    return { username: channelId, emotes: {}, error: errorMessage };
  }
}

// Simple download state tracking
let downloadState = {
  isDownloading: false,
  cancelled: false,
  current: 0,
  total: 0,
  startTime: null
};

let retryState = {
  isRetrying: false,
  current: 0,
  total: 0
};

function logDownload(event, data = {}) {
  console.log(`[Mojify Download] ${event}`, data);
}

function warnDownload(event, data = {}) {
  console.warn(`[Mojify Download] ${event}`, data);
}

let discordImportState = {
  isImporting: false,
  current: 0,
  total: 0,
  guildId: '',
  guildName: '',
  startedAt: null
};

let telegramImportState = {
  isImporting: false,
  current: 0,
  total: 0,
  setName: '',
  setTitle: '',
  startedAt: null
};

let se7enTvImportState = {
  isImporting: false,
  userId: '',
  username: '',
  startedAt: null
};

// Reset download state on service worker startup
async function resetDownloadState() {
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

async function resetTelegramImportState(options = {}) {
  const stale = Boolean(options.stale);

  telegramImportState = {
    isImporting: false,
    current: 0,
    total: 0,
    setName: '',
    setTitle: '',
    startedAt: null
  };

  try {
    await chrome.storage.local.set({
      telegramImportInProgress: false,
      telegramImportProgress: {
        current: 0,
        total: 0,
        completed: false,
        reset: true,
        stale,
        resetAt: Date.now()
      }
    });
  } catch (error) {
    console.error('[Service Worker] Error resetting Telegram import state:', error);
  }
}

async function getTelegramImportStatus() {
  const result = await chrome.storage.local.get(['telegramImportInProgress', 'telegramImportProgress']);
  const storageInProgress = Boolean(result.telegramImportInProgress);
  const progress = result.telegramImportProgress || null;

  if (storageInProgress && !telegramImportState.isImporting) {
    await resetTelegramImportState({ stale: true });
    return {
      success: true,
      inProgress: false,
      active: false,
      stale: true,
      progress: {
        ...(progress || {}),
        reset: true,
        stale: true,
        resetAt: Date.now()
      }
    };
  }

  return {
    success: true,
    inProgress: Boolean(storageInProgress || telegramImportState.isImporting),
    active: Boolean(telegramImportState.isImporting),
    stale: false,
    progress
  };
}

async function publishDownloadProgress(progress = {}) {
  const safeCount = (value) => {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  };

  const payload = {
    current: safeCount(progress.current !== undefined ? progress.current : downloadState.current),
    total: safeCount(progress.total !== undefined ? progress.total : downloadState.total),
    currentEmote: progress.currentEmote || ''
  };

  await chrome.storage.local.set({
    downloadInProgress: progress.inProgress !== false,
    downloadProgress: payload
  });

  sendRuntimeMessage({
    type: 'downloadProgress',
    ...payload
  });
}

async function downloadEmotes(options = {}) {
  // Check if already downloading
  if (downloadState.isDownloading) {
    const storedProgress = await chrome.storage.local.get(['downloadProgress']);
    const activeProgress = storedProgress.downloadProgress || {};
    logDownload('already-running', {
      current: downloadState.current || activeProgress.current || 0,
      total: downloadState.total || activeProgress.total || 0,
      status: activeProgress.currentEmote || ''
    });

    await publishDownloadProgress({
      current: downloadState.total > 0 ? downloadState.current : activeProgress.current,
      total: downloadState.total > 0 ? downloadState.total : activeProgress.total,
      currentEmote: activeProgress.currentEmote || "Download already in progress"
    });

    return {
      success: true,
      message: "Download already in progress",
      skipped: true,
      inProgress: true
    };
  }

  try {
    downloadState.isDownloading = true;
    downloadState.cancelled = false;
    downloadState.startTime = Date.now();
    downloadState.current = 0;
    downloadState.total = 0;
    logDownload('start');
    await publishDownloadProgress({
      current: 0,
      total: 0,
      currentEmote: 'Preparing download...'
    });

    // Reset performance metrics
    downloadState.performanceMetrics = {
      totalBytes: 0,
      avgResponseTime: 0,
      successRate: 0,
      batchTimes: [],
      memoryUsage: []
    };

    // Check if we should skip download due to recent restore
    const requestedSources = Array.isArray(options.sources) ? options.sources : [];
    const isTargetedDownload = requestedSources.length > 0;
    const storageCheck = await chrome.storage.local.get(['channelIds', 'skipNextDownload', 'lastRestoreTime', 'manualRefresh']);
    const { channelIds, skipNextDownload, lastRestoreTime, manualRefresh } = storageCheck;

    // Skip download if restored within last 10 minutes AND it's not a manual refresh
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if ((skipNextDownload || (lastRestoreTime && lastRestoreTime > tenMinutesAgo)) && !manualRefresh && !isTargetedDownload) {
      downloadState.isDownloading = false;
      logDownload('skipped-after-restore');

      // Clear the skip flag
      await chrome.storage.local.remove(['skipNextDownload']);
      await chrome.storage.local.set({
        downloadInProgress: false,
        downloadProgress: {
          current: 0,
          total: 0,
          completed: true,
          currentEmote: 'Skipped download'
        }
      });

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

    const downloadSources = isTargetedDownload
      ? requestedSources
        .map((source) => ({
          type: source.type || 'twitch-channel',
          channelId: String(source.channelId || '').trim(),
          setId: String(source.setId || '').trim(),
          setName: source.setName || '',
          username: source.username || '',
          sevenTvUserId: source.sevenTvUserId || '',
          activeSetId: source.activeSetId || ''
        }))
        .filter((source) => source.type === '7tv-set' ? source.setId : source.channelId)
      : (channelIds || [])
        .map((channelId) => String(channelId || '').trim())
        .filter(Boolean)
        .map((channelId) => ({ type: 'twitch-channel', channelId }));

    if (downloadSources.length === 0) {
      downloadState.isDownloading = false;
      await chrome.storage.local.set({
        downloadInProgress: false,
        downloadProgress: { error: "No 7TV sources configured" }
      });
      return { success: false, error: "No 7TV sources configured" };
    }

    const seenSourceKeys = new Set();
    const uniqueDownloadSources = downloadSources.filter((source) => {
      const sourceKey = source.type === '7tv-set'
        ? `set:${source.setId}`
        : `channel:${source.channelId}`;
      if (seenSourceKeys.has(sourceKey)) return false;
      seenSourceKeys.add(sourceKey);
      return true;
    });

    logDownload('channels-loaded', {
      count: uniqueDownloadSources.length,
      targeted: isTargetedDownload,
      channels: uniqueDownloadSources.map((source) => source.setId || source.channelId)
    });

    downloadState.current = 0;
    downloadState.total = uniqueDownloadSources.length;
    await publishDownloadProgress({
      current: 0,
      total: uniqueDownloadSources.length,
      currentEmote: 'Checking local cache...'
    });

    // INCREMENTAL DOWNLOAD LOGIC:
    // 1. Get existing downloaded emotes from local storage
    // 2. Compare with server emotes to find what's missing
    // 3. Only download new/missing emotes (not re-download existing ones)

    // Initialize IndexedDB
    if (!emoteDB.db) {
      await emoteDB.init();
    }

    // Get existing data from chrome.storage (metadata only) and IndexedDB (images)
    const existing = await chrome.storage.local.get(['emoteMapping', 'triggerToStorageKey', 'channels']);
    const globalEmoteMapping = existing.emoteMapping || {};
    const globalTriggerToStorageKey = existing.triggerToStorageKey || {};
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
    logDownload('cache-ready', {
      cachedEmotes: existingEmoteKeys.size
    });

    // Pre-fetch channel names and create channels immediately
    const channelEmotes = [];
    let totalNewEmotes = 0;

    let successfulChannelFetches = 0;
    let totalResolvedEmotes = 0;
    const channelResolveErrors = [];

    const channelResults = [];

    for (let index = 0; index < uniqueDownloadSources.length; index += 1) {
      const source = uniqueDownloadSources[index];
      const channelId = source.channelId || source.setId;
      const sourceLabel = source.setName || source.username || channelId;
      const resolveStartedAt = Date.now();
      logDownload('channel-resolve-start', {
        channelId,
        type: source.type,
        index: index + 1,
        total: uniqueDownloadSources.length
      });

      downloadState.current = index;
      downloadState.total = uniqueDownloadSources.length;
      await publishDownloadProgress({
        current: index,
        total: uniqueDownloadSources.length,
        currentEmote: `Resolving ${index + 1}/${uniqueDownloadSources.length} (${sourceLabel})`
      });

      try {
        const result = source.type === '7tv-set'
          ? await get7TVEmoteSet(source.setId, source)
          : await get7TVEmotes(channelId);
        channelResults.push({
          status: 'fulfilled',
          value: { channelId, source, result }
        });
      } catch (error) {
        channelResults.push({
          status: 'rejected',
          reason: error
        });
      }

      downloadState.current = index + 1;
      const resolvedResult = channelResults[channelResults.length - 1];
      const failed = resolvedResult?.status !== 'fulfilled' || resolvedResult?.value?.result?.error;
      const resolvedEmoteCount = Object.keys(resolvedResult?.value?.result?.emotes || {}).length;
      logDownload(failed ? 'channel-resolve-failed' : 'channel-resolve-done', {
        channelId,
        type: source.type,
        emotes: resolvedEmoteCount,
        durationMs: Date.now() - resolveStartedAt,
        error: resolvedResult?.value?.result?.error || resolvedResult?.reason?.message || ''
      });
      await publishDownloadProgress({
        current: index + 1,
        total: uniqueDownloadSources.length,
        currentEmote: failed
          ? `Failed source ${index + 1}/${uniqueDownloadSources.length}`
          : `Resolved ${index + 1}/${uniqueDownloadSources.length} sources`
      });
    }

    channelResults.forEach((channelResult) => {
      if (channelResult.status !== 'fulfilled') {
        console.error('[Download] Error resolving channel:', channelResult.reason);
        return;
      }

      const { channelId, source, result } = channelResult.value;
      const storageChannelId = result.channelId || channelId;
      const resolvedEmoteCount = Object.keys(result.emotes || {}).length;
      if (result.error) {
        channelResolveErrors.push(`${channelId}: ${result.error}`);
      }
      if (resolvedEmoteCount > 0 || result.username !== channelId) {
        successfulChannelFetches++;
      }
      totalResolvedEmotes += resolvedEmoteCount;

      channelsById.set(storageChannelId, {
        id: storageChannelId,
        username: result.username,
        emotes: result.emotes,
        sourceType: 'twitch',
        platformChannelId: result.platformChannelId || source.channelId || storageChannelId,
        baseUsername: result.baseUsername || source.username || result.username,
        sevenTvUserId: result.sevenTvUserId || source.sevenTvUserId || '',
        activeSetId: result.activeSetId || source.activeSetId || '',
        emoteSetId: result.emoteSetId || source.setId || '',
        emoteSetName: result.emoteSetName || source.setName || '',
        emoteSetKind: result.emoteSetKind || source.kind || 'NORMAL',
        isEmoteSet: Boolean(result.isEmoteSet),
        parentChannelId: source.channelId || result.platformChannelId || ''
      });

      if (resolvedEmoteCount > 0) {
        // Build ALL emotes for channel metadata (includes already-cached ones)
        const allChannelEmotes = {};
        const newEmotes = {};

        Object.entries(result.emotes).forEach(([triggerKey, emoteInfo]) => {
          const emoteId = emoteInfo.emoteId || triggerKey;
          const storageKey = `7tv:${storageChannelId}:${result.activeSetId || result.emoteSetId || ''}:${emoteId}`;
          allChannelEmotes[triggerKey] = { ...emoteInfo, storageKey, url: emoteInfo.url };
          if (!existingEmoteKeys.has(storageKey)) {
            newEmotes[triggerKey] = { ...emoteInfo, storageKey, url: emoteInfo.url };
          }
        });

        // Always add to channelEmotes for download (even if empty — metadata still needs updating)
        channelEmotes.push({
          channelId: storageChannelId,
          username: result.username,
          emotes: newEmotes,
          allEmotes: allChannelEmotes
        });

        // Update the channel's emotes with ALL resolved emotes (not just new ones)
        const channelData = channelsById.get(storageChannelId);
        if (channelData) {
          channelData.emotes = allChannelEmotes;
        }

        totalNewEmotes += Object.keys(newEmotes).length;
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
      const resolveError = channelResolveErrors.length > 0
        ? `7TV lookup failed: ${channelResolveErrors.slice(0, 2).join('; ')}`
        : "No valid 7TV channels found";
      downloadState.isDownloading = false;
      warnDownload('no-valid-channels', {
        error: resolveError
      });
      await chrome.storage.local.set({
        channels,
        downloadInProgress: false,
        downloadProgress: { error: resolveError }
      });
      return { success: false, error: resolveError };
    }

    if (totalNewEmotes === 0) {
      downloadState.isDownloading = false;
      logDownload('up-to-date', {
        resolvedEmotes: totalResolvedEmotes,
        cachedEmotes: existingEmoteKeys.size
      });
      await chrome.storage.local.set({
        channels,
        downloadInProgress: false,
        downloadProgress: {
          current: 0,
          total: 0,
          completed: true,
          currentEmote: 'All emotes up to date'
        }
      });
      return { success: true, totalEmotes: await emoteDB.getEmoteCount(), message: "All emotes up to date" };
    }


    // Set download progress
    await publishDownloadProgress({
      current: 0,
      total: totalNewEmotes,
      currentEmote: 'Starting downloads...'
    });
    logDownload('download-plan', {
      newEmotes: totalNewEmotes,
      resolvedEmotes: totalResolvedEmotes,
      channels: channelEmotes.length
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

    // Prepare all emotes for download
    const allEmotesToDownload = [];
    for (const channelData of channelEmotes) {
      for (const [triggerKey, emoteInfo] of Object.entries(channelData.emotes)) {
        allEmotesToDownload.push({
          key: emoteInfo.storageKey || triggerKey,
          triggerKey,
          url: emoteInfo.url,
          channel: channelData.username,
          channelId: channelData.channelId
        });
      }
    }

    // Download all emotes — continuous pool, no chunk waiting
    logDownload('download-start', {
      total: allEmotesToDownload.length
    });

    const POOL_SIZE = 100;
    const failedQueue = [];
    let poolIndex = 0;
    let lastReport = 0;

    const worker = async () => {
      while (true) {
        if (downloadState.cancelled) return;
        const myIndex = poolIndex++;
        if (myIndex >= allEmotesToDownload.length) return;

        const { key, triggerKey, url, channel, channelId } = allEmotesToDownload[myIndex];

        try {
          const blob = await fetchBlobWithTimeout(url, {}, 30000);
          if (downloadState.cancelled) return;
          if (blob.size > 0) {
            await emoteDB.storeEmote(key, url, blob, {
              channel, channelId, triggerKey: triggerKey || key
            });
            if (triggerKey) {
              globalEmoteMapping[triggerKey] = url;
              globalTriggerToStorageKey[triggerKey] = key;
            } else {
              globalEmoteMapping[key] = url;
            }
            downloadState.performanceMetrics.totalBytes += blob.size;
          } else {
            throw new Error("Empty blob received");
          }
        } catch (error) {
          failedQueue.push({ success: false, key, triggerKey, url, channel, channelId, error: error.message });
        }

        downloadState.current++;

        // Throttled progress reporting
        const now = Date.now();
        if (now - lastReport > 500) {
          lastReport = now;
          await chrome.storage.local.set({
            downloadProgress: {
              current: downloadState.current,
              total: downloadState.total,
              currentEmote: `Downloading ${downloadState.current}/${downloadState.total}`
            },
            emoteMapping: { ...globalEmoteMapping },
            triggerToStorageKey: { ...globalTriggerToStorageKey }
          });
          try {
            chrome.runtime.sendMessage({
              type: 'downloadProgress',
              current: downloadState.current,
              total: downloadState.total,
              currentEmote: `Downloading ${downloadState.current}/${downloadState.total}...`
            });
          } catch (e) {}
        }
      }
    };

    // Launch POOL_SIZE workers — each grabs next emote as soon as it finishes
    await Promise.all(Array.from({ length: Math.min(POOL_SIZE, allEmotesToDownload.length) }, () => worker()));

    // If cancelled, skip retry and finalize immediately
    if (downloadState.cancelled) {
      logDownload('cancelled-before-retry');

      await chrome.storage.local.set({
        emoteMapping: { ...globalEmoteMapping },
        triggerToStorageKey: { ...globalTriggerToStorageKey },
        channels,
        downloadInProgress: false,
        downloadProgress: {
          current: downloadState.current,
          total: downloadState.total,
          completed: true,
          cancelled: true
        }
      });

      downloadState.isDownloading = false;
      try {
        chrome.runtime.sendMessage({
          type: 'downloadProgress',
          current: downloadState.current,
          total: downloadState.total,
          completed: true,
          cancelled: true
        });
      } catch (e) {}

      const totalStoredEmotes = await emoteDB.getEmoteCount();
      return { success: true, totalEmotes: totalStoredEmotes, cancelled: true };
    }

    // Final progress report after main pool completes
    await publishDownloadProgress({
      current: downloadState.total,
      total: downloadState.total,
      currentEmote: failedQueue.length > 0
        ? `Finalizing — ${failedQueue.length} to retry in background...`
        : 'Finalizing...'
    });

    // Final storage update — merge with current channels to respect mid-download deletions
    const currentStorage = await chrome.storage.local.get(['channels', 'emoteMapping', 'triggerToStorageKey']);
    const currentChannels = Array.isArray(currentStorage.channels) ? currentStorage.channels : [];
    const currentChannelIds = new Set(currentChannels.map((c) => String(c?.id || '')));

    const mergedChannels = [...currentChannels];
    for (const ch of channels) {
      if (!currentChannelIds.has(String(ch.id))) {
        mergedChannels.push(ch);
      }
    }

    const mergedEmoteMapping = { ...(currentStorage.emoteMapping || {}), ...globalEmoteMapping };
    const mergedTriggerToStorageKey = { ...(currentStorage.triggerToStorageKey || {}), ...globalTriggerToStorageKey };

    await chrome.storage.local.set({
      emoteMapping: mergedEmoteMapping,
      triggerToStorageKey: mergedTriggerToStorageKey,
      channels: mergedChannels,
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

    // Clear cache to free memory
    urlCache.clear();
    sizeEstimates.clear();

    // Fire retry as a detached background task — doesn't block new imports
    if (failedQueue.length > 0) {
      runBackgroundRetry([...failedQueue]);
    }

    // Get final count from IndexedDB
    const totalStoredEmotes = await emoteDB.getEmoteCount();
    logDownload('complete', {
      downloaded: totalNewEmotes,
      stored: totalStoredEmotes,
      successRate: Number(downloadState.performanceMetrics.successRate.toFixed(1)),
      avgResponseMs: Math.round(downloadState.performanceMetrics.avgResponseTime || 0),
      totalBytes: downloadState.performanceMetrics.totalBytes
    });
    return { success: true, totalEmotes: totalStoredEmotes };

  } catch (error) {
    console.error("[Mojify Download] error", error);
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

// Background retry — runs detached after main download completes
// Reads fresh storage before each write so it never clobbers new imports
async function runBackgroundRetry(failedQueue) {
  if (!failedQueue || failedQueue.length === 0) return;

  retryState.isRetrying = true;
  retryState.current = 0;
  retryState.total = failedQueue.length;

  warnDownload('retry-start', { failed: failedQueue.length });

  const RETRY_BATCH_SIZE = 10;

  const retryDownload = async (emoteData) => {
    const { key, triggerKey, url, channel, channelId } = emoteData;

    try {
      const blob = await fetchBlobWithTimeout(url, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }, 30000);

      if (blob.size > 0) {
        await emoteDB.storeEmote(key, url, blob, {
          channel: channel,
          channelId: channelId,
          triggerKey: triggerKey || key,
          retried: true
        });

        return { success: true, key, triggerKey, url };
      }

      return { success: false, key, triggerKey, url };
    } catch (error) {
      return { success: false, key, triggerKey, url };
    }
  };

  for (let i = 0; i < failedQueue.length; i += RETRY_BATCH_SIZE) {
    const retryBatch = failedQueue.slice(i, i + RETRY_BATCH_SIZE);

    const results = await Promise.allSettled(
      retryBatch.map(emoteData => retryDownload(emoteData))
    );

    // Merge successful retries into current storage (don't clobber other writes)
    const freshStorage = await chrome.storage.local.get(['emoteMapping', 'triggerToStorageKey']);
    const freshMapping = { ...(freshStorage.emoteMapping || {}) };
    const freshTrigger = { ...(freshStorage.triggerToStorageKey || {}) };

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { success, key, triggerKey, url } = result.value;
      if (success) {
        if (triggerKey) {
          freshMapping[triggerKey] = url;
          freshTrigger[triggerKey] = key;
        } else {
          freshMapping[key] = url;
        }
      }
    }

    retryState.current += retryBatch.length;

    await chrome.storage.local.set({
      emoteMapping: freshMapping,
      triggerToStorageKey: freshTrigger
    });

    try {
      chrome.runtime.sendMessage({
        type: 'retryProgress',
        current: retryState.current,
        total: retryState.total
      });
    } catch (e) {}
  }

  // Persist still-failed emotes for the dashboard
  const stillFailed = [];
  for (let i = 0; i < failedQueue.length; i += RETRY_BATCH_SIZE) {
    const batch = failedQueue.slice(i, i + RETRY_BATCH_SIZE);
    for (const emoteData of batch) {
      try {
        const stored = await emoteDB.getEmote(emoteData.key);
        if (!stored || !stored.blob || stored.blob.size === 0) {
          stillFailed.push(emoteData);
        }
      } catch (e) {
        stillFailed.push(emoteData);
      }
    }
  }

  await chrome.storage.local.set({ failedEmotes: stillFailed });

  retryState.isRetrying = false;
  logDownload('retry-complete', { stillFailed: stillFailed.length });
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
    currentEmoji: progress.currentItem || progress.currentEmoji || '',
    currentItem: progress.currentItem || progress.currentEmoji || '',
    statusText: progress.statusText || '',
    importedCount: Number(progress.importedCount || 0),
    importedEmojiCount: Number(progress.importedEmojiCount || 0),
    importedStickerCount: Number(progress.importedStickerCount || 0),
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

async function updateTelegramImportProgress(progress = {}) {
  const payload = {
    current: Number(progress.current || 0),
    total: Number(progress.total || 0),
    setName: progress.setName || telegramImportState.setName || '',
    setTitle: progress.setTitle || telegramImportState.setTitle || '',
    currentItem: progress.currentItem || '',
    statusText: progress.statusText || '',
    importedCount: Number(progress.importedCount || 0),
    importedStickerCount: Number(progress.importedStickerCount || 0),
    importedAnimatedCount: Number(progress.importedAnimatedCount || 0),
    importedVideoCount: Number(progress.importedVideoCount || 0),
    skippedCount: Number(progress.skippedCount || 0),
    importedPreviewCount: Number(progress.importedPreviewCount || 0),
    skippedAnimatedCount: Number(progress.skippedAnimatedCount || 0),
    skippedUnsupportedCount: Number(progress.skippedUnsupportedCount || 0),
    completed: Boolean(progress.completed),
    error: progress.error || '',
    channelId: progress.channelId || '',
    toastMessage: progress.toastMessage || '',
    startedAt: progress.startedAt || telegramImportState.startedAt || null,
    updatedAt: Date.now()
  };

  await chrome.storage.local.set({
    telegramImportInProgress: Boolean(progress.inProgress),
    telegramImportProgress: payload
  });

  sendRuntimeMessage({
    type: 'telegramImportProgress',
    ...payload
  });
}

async function update7TVImportProgress(progress = {}) {
  const payload = {
    userId: progress.userId || se7enTvImportState.userId || '',
    username: progress.username || se7enTvImportState.username || '',
    statusText: progress.statusText || '',
    importedCount: Number(progress.importedCount || 0),
    completed: Boolean(progress.completed),
    error: progress.error || '',
    startedAt: progress.startedAt || se7enTvImportState.startedAt || null,
    updatedAt: Date.now()
  };

  await chrome.storage.local.set({
    se7tvImportInProgress: Boolean(progress.inProgress),
    se7tvImportProgress: payload
  });

  sendRuntimeMessage({
    type: 'se7tvImportProgress',
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

function getDiscordStickerFileInfo(sticker = {}) {
  const formatType = Number(sticker.formatType || sticker.format_type || 1);
  if (formatType === 3) {
    return null;
  }

  if (formatType === 4) {
    return {
      url: `https://media.discordapp.net/stickers/${sticker.id}.gif`,
      extension: 'gif',
      mimeType: 'image/gif'
    };
  }

  return {
    url: `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
    extension: 'png',
    mimeType: 'image/png'
  };
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

function sanitizeTelegramStickerSetName(input) {
  const rawInput = String(input || '').trim();
  if (!rawInput) {
    throw new Error('Paste a Telegram sticker set link or short name first');
  }

  const patterns = [
    /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/add(?:stickers|emoji)\/([A-Za-z][A-Za-z0-9_]{0,63})/i,
    /(?:^|\/)add(?:stickers|emoji)\/([A-Za-z][A-Za-z0-9_]{0,63})/i,
    /^@?([A-Za-z][A-Za-z0-9_]{0,63})$/
  ];

  for (const pattern of patterns) {
    const match = rawInput.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error('Could not read a Telegram sticker set short name from that value');
}

function sanitizeTelegramEmoteName(name, fallback = 'telegram') {
  const sanitized = String(name || fallback)
    .trim()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44);

  return sanitized || fallback;
}

function buildUniqueTelegramStickerKey(stickerSetName, index, reservedKeys) {
  const baseName = sanitizeTelegramEmoteName(`${stickerSetName}_${String(index + 1).padStart(2, '0')}`, 'telegram');
  const baseKey = `:${baseName}:`;

  if (!reservedKeys.has(baseKey)) {
    reservedKeys.add(baseKey);
    return baseKey;
  }

  let counter = 2;
  while (true) {
    const candidate = `:${baseName}_${counter}:`;
    if (!reservedKeys.has(candidate)) {
      reservedKeys.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

function getTelegramFileExtension(filePath = '') {
  const match = String(filePath || '').match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match ? match[1].toLowerCase() : '';
}

function getTelegramMimeType(filePath = '', sticker = {}) {
  const extension = getTelegramFileExtension(filePath);
  const mimeByExtension = {
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webm: 'video/webm',
    tgs: 'application/x-tgsticker'
  };

  if (mimeByExtension[extension]) {
    return mimeByExtension[extension];
  }

  if (sticker?.is_video) return 'video/webm';
  if (sticker?.is_animated) return 'application/x-tgsticker';
  return 'image/webp';
}

function getTelegramStoredReference(sticker = {}) {
  const stableId = sticker.file_unique_id || sticker.file_id || '';
  return stableId ? `telegram://file/${encodeURIComponent(stableId)}` : 'telegram://file/unknown';
}

function getTelegramStickerThumbnail(sticker = {}) {
  const thumbnail = sticker.thumbnail || sticker.thumb || null;
  return thumbnail?.file_id ? thumbnail : null;
}

function getTelegramItemLabel(stickerSetName, index, sticker = {}) {
  const emoji = String(sticker.emoji || '').trim();
  return emoji ? `${stickerSetName} ${index + 1} ${emoji}` : `${stickerSetName} ${index + 1}`;
}

function isTelegramStickerSupported(sticker = {}, filePath = '') {
  const extension = getTelegramFileExtension(filePath);
  if (sticker.is_animated || extension === 'tgs') {
    return {
      supported: false,
      reason: 'animated'
    };
  }

  const mimeType = getTelegramMimeType(filePath, sticker);
  if (mimeType.startsWith('image/') || mimeType === 'video/webm') {
    return {
      supported: true,
      mimeType,
      extension: extension || (mimeType === 'video/webm' ? 'webm' : 'webp')
    };
  }

  return {
    supported: false,
    reason: 'unsupported'
  };
}

async function fetchTelegramBotApi(botToken, methodName, params = {}) {
  const cleanToken = String(botToken || '').trim();
  if (!cleanToken) {
    throw new Error('Add a Telegram bot token in API Key Settings first');
  }

  const url = new URL(`${TELEGRAM_BOT_API_ORIGIN}/bot${cleanToken}/${methodName}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_IMPORT_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.description || `Telegram API responded with ${response.status}`);
    }

    return payload.result;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createTimeoutError(`Telegram API timed out after ${TELEGRAM_IMPORT_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function convertTelegramTgsDataUrlWithNativeHost(tgsDataUrl, { label = 'Telegram sticker' } = {}) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.connectNative) {
      reject(new Error('Native Messaging is not available in this browser'));
      return;
    }

    const requestId = `telegram-tgs-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const chunks = [];
    let expectedChunks = null;
    let receivedChunkCount = 0;
    let completeMessage = null;
    let settled = false;
    let port = null;

    const timeoutId = setTimeout(() => {
      fail(new Error('Native TGS conversion timed out'));
    }, TELEGRAM_TGS_NATIVE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeoutId);
      if (port) {
        try {
          port.disconnect();
        } catch (error) {
          // Best-effort cleanup.
        }
      }
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    async function maybeFinish() {
      if (settled || !completeMessage || expectedChunks === null || receivedChunkCount !== expectedChunks) {
        return;
      }

      settled = true;
      cleanup();

      try {
        const base64Payload = chunks.join('');
        const response = await fetch(`data:${completeMessage.mimeType || 'video/webm'};base64,${base64Payload}`);
        const blob = await response.blob();

        if (!(blob instanceof Blob) || blob.size === 0) {
          throw new Error('Native TGS conversion returned empty media');
        }

        resolve({
          blob: blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: 'video/webm' }),
          mimeType: blob.type || completeMessage.mimeType || 'video/webm',
          extension: 'webm',
          width: Number(completeMessage.width || 0),
          height: Number(completeMessage.height || 0),
          durationMs: Number(completeMessage.durationMs || 0),
          frameRate: Number(completeMessage.frameRate || 0),
          frameCount: Number(completeMessage.frameCount || 0),
          size: Number(completeMessage.size || blob.size),
          renderer: completeMessage.renderer || '',
          encoder: completeMessage.encoder || '',
          lossless: Boolean(completeMessage.lossless),
          conversionMethod: 'native-lossless'
        });
      } catch (error) {
        reject(error);
      }
    }

    try {
      port = chrome.runtime.connectNative(TELEGRAM_TGS_NATIVE_HOST);
    } catch (error) {
      fail(error);
      return;
    }

    port.onMessage.addListener((message) => {
      if (!message || message.id !== requestId) {
        return;
      }

      if (message.type === 'conversionError' || message.success === false) {
        fail(new Error(message.error || 'Native TGS conversion failed'));
        return;
      }

      if (message.type === 'conversionChunk') {
        const seq = Number(message.seq);
        const total = Number(message.total);
        if (!Number.isInteger(seq) || seq < 0 || !Number.isInteger(total) || total < 1) {
          fail(new Error('Native TGS conversion returned an invalid chunk'));
          return;
        }

        if (expectedChunks === null) {
          expectedChunks = total;
        } else if (expectedChunks !== total) {
          fail(new Error('Native TGS conversion returned mismatched chunks'));
          return;
        }

        if (typeof chunks[seq] !== 'string') {
          receivedChunkCount += 1;
        }
        chunks[seq] = String(message.data || '');
        maybeFinish();
        return;
      }

      if (message.type === 'conversionComplete') {
        completeMessage = message;
        maybeFinish();
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      const errorMessage = chrome.runtime.lastError?.message || 'Native TGS helper disconnected';
      fail(new Error(errorMessage));
    });

    try {
      port.postMessage({
        id: requestId,
        type: 'convertTelegramTgsToWebm',
        tgsDataUrl,
        label
      });
    } catch (error) {
      fail(error);
    }
  });
}

async function convertTelegramTgsBlobToWebm(tgsBlob, { label = 'Telegram sticker' } = {}) {
  const tgsDataUrl = await blobToDataUrl(tgsBlob);
  return convertTelegramTgsDataUrlWithNativeHost(tgsDataUrl, { label });
}

async function fetchTelegramFileBlob(botToken, filePath, mimeType = 'application/octet-stream') {
  const downloadUrl = `${TELEGRAM_BOT_API_ORIGIN}/file/bot${String(botToken || '').trim()}/${filePath}`;
  let blob = await fetchBlobWithTimeout(downloadUrl, {}, TELEGRAM_IMPORT_TIMEOUT_MS);
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('Telegram returned an empty sticker file');
  }

  if (!blob.type || blob.type === 'application/octet-stream') {
    blob = new Blob([await blob.arrayBuffer()], { type: mimeType });
  }

  return blob;
}

async function fetchTelegramThumbnailFallback(botToken, sticker = {}, {
  filePath = '',
  reason = 'unsupported',
  conversionError = ''
} = {}) {
  const thumbnail = getTelegramStickerThumbnail(sticker);
  if (!thumbnail?.file_id) {
    return {
      skipped: true,
      reason,
      filePath,
      conversionError
    };
  }

  const thumbnailInfo = await fetchTelegramBotApi(botToken, 'getFile', {
    file_id: thumbnail.file_id
  });
  const thumbnailFilePath = thumbnailInfo?.file_path || '';
  if (!thumbnailFilePath) {
    return {
      skipped: true,
      reason,
      filePath,
      conversionError
    };
  }

  const mimeType = getTelegramMimeType(thumbnailFilePath, {});
  const extension = getTelegramFileExtension(thumbnailFilePath) || (mimeType === 'image/jpeg' ? 'jpg' : 'webp');
  const blob = await fetchTelegramFileBlob(botToken, thumbnailFilePath, mimeType);

  return {
    skipped: false,
    blob,
    filePath: thumbnailFilePath,
    originalFilePath: filePath,
    extension,
    mimeType,
    thumbnail: true,
    conversionError
  };
}

async function fetchTelegramStickerBlob(botToken, sticker = {}) {
  const fileInfo = await fetchTelegramBotApi(botToken, 'getFile', {
    file_id: sticker.file_id
  });
  const filePath = fileInfo?.file_path || '';
  if (!filePath) {
    throw new Error('Telegram did not return a downloadable file path');
  }

  const support = isTelegramStickerSupported(sticker, filePath);
  if (support.supported) {
    return {
      skipped: false,
      blob: await fetchTelegramFileBlob(botToken, filePath, support.mimeType),
      filePath,
      extension: support.extension,
      mimeType: support.mimeType
    };
  }

  const originalMimeType = getTelegramMimeType(filePath, sticker);
  const originalExtension = getTelegramFileExtension(filePath);
  const isTgsSticker = support.reason === 'animated' || sticker.is_animated || originalExtension === 'tgs';

  if (isTgsSticker) {
    try {
      const originalBlob = await fetchTelegramFileBlob(botToken, filePath, originalMimeType || 'application/x-tgsticker');
      const converted = await convertTelegramTgsBlobToWebm(originalBlob, {
        label: sticker.emoji ? `Telegram sticker ${sticker.emoji}` : 'Telegram animated sticker'
      });

      return {
        skipped: false,
        blob: converted.blob,
        filePath,
        extension: converted.extension || 'webm',
        mimeType: converted.mimeType || 'video/webm',
        converted: true,
        convertedFrom: 'tgs',
        width: converted.width,
        height: converted.height,
        durationMs: converted.durationMs,
        frameRate: converted.frameRate,
        frameCount: converted.frameCount,
        size: converted.size,
        renderer: converted.renderer || '',
        encoder: converted.encoder || '',
        lossless: Boolean(converted.lossless),
        conversionMethod: converted.conversionMethod || ''
      };
    } catch (error) {
      console.warn('[Telegram Import] Native TGS conversion failed; skipping animated sticker:', error?.message || error);
      return {
        skipped: true,
        filePath,
        reason: 'animated',
        conversionError: error?.message || 'Native TGS conversion failed'
      };
    }
  }

  return fetchTelegramThumbnailFallback(botToken, sticker, {
    filePath,
    reason: support.reason || 'unsupported'
  });
}

async function publishTelegramImportLibrarySnapshot({
  channelsById,
  channelId,
  setName = '',
  setTitle,
  importedEmotes,
  globalEmoteMapping,
  importedStickerCount = 0,
  importedAnimatedCount = 0,
  importedVideoCount = 0,
  importedPreviewCount = 0,
  skippedCount = 0,
  skippedAnimatedCount = 0,
  importInProgress = true
} = {}) {
  const resolvedSetName = String(setName || '').trim() || String(channelId || '').replace(/^telegram:/i, '');

  channelsById.set(channelId, {
    id: channelId,
    username: setTitle,
    emotes: { ...importedEmotes },
    parentChannelId: '',
    isEmoteSet: true,
    emoteSetId: channelId,
    emoteSetName: setTitle || resolvedSetName,
    emoteSetKind: 'NORMAL',
    mediaCounts: {
      stickers: importedStickerCount,
      animatedStickers: importedAnimatedCount,
      videoStickers: importedVideoCount,
      animatedPreviews: importedPreviewCount,
      skipped: skippedCount,
      skippedAnimated: skippedAnimatedCount
    },
    sourceType: 'telegram',
    telegramStickerSetName: resolvedSetName,
    telegramStickerSetTitle: setTitle,
    telegramStickerSetLink: resolvedSetName ? `https://t.me/addstickers/${resolvedSetName}` : '',
    importInProgress,
    updatedAt: Date.now()
  });

  await chrome.storage.local.set({
    emoteMapping: { ...globalEmoteMapping },
    channels: Array.from(channelsById.values())
  });
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
      const normalizeDiscordEmoji = (emoji) => ({
        id: String(emoji?.id || ''),
        name: emoji?.name || 'emoji',
        animated: Boolean(emoji?.animated)
      });
      const normalizeDiscordSticker = (sticker) => ({
        id: String(sticker?.id || ''),
        name: sticker?.name || 'sticker',
        formatType: Number(sticker?.format_type || sticker?.formatType || 1),
        description: sticker?.description || '',
        tags: sticker?.tags || '',
        available: sticker?.available !== false,
        guildId: String(sticker?.guild_id || sticker?.guildId || guildId)
      });
      const collectionValues = (value) => {
        if (Array.isArray(value)) return value;
        if (value instanceof Map) return Array.from(value.values());
        return Object.values(value || {});
      };
      const normalizeEmojiList = (emojis) => collectionValues(emojis)
        .filter((emoji) => emoji?.id && emoji?.name)
        .map(normalizeDiscordEmoji);
      const normalizeStickerList = (stickers) => collectionValues(stickers)
        .filter((sticker) => sticker?.id && sticker?.name)
        .map(normalizeDiscordSticker);

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

      const performGuildStickersFetch = async (token = '') => {
        const headers = token ? { authorization: token } : {};
        return fetch(`https://discord.com/api/v10/guilds/${guildId}/stickers`, {
          credentials: 'include',
          headers
        });
      };

      const readGuildFromWebpackState = () => {
        const guildStore = findWebpackModule((candidate) => (
          typeof candidate?.getGuild === 'function'
        ));

        const guild = guildStore?.getGuild?.(guildId);
        const guildName = guild?.name || document.title.replace(/\s*\|\s*Discord\s*$/i, '').trim() || 'Discord Server';
        let emojis = normalizeEmojiList(guild?.emojis);
        let stickers = normalizeStickerList(guild?.stickers);

        const emojiStore = findWebpackModule((candidate) => {
          const keys = Object.keys(candidate || {});
          return keys.some((key) => /emoji/i.test(key)) &&
            keys.some((key) => typeof candidate[key] === 'function');
        });

        const possibleEmojiMethods = [
          'getGuildEmojiMap',
          'getGuildEmojis',
          'getEmojiMap',
          'getCustomEmojiById'
        ];

        if (emojiStore && emojis.length === 0) {
          for (const methodName of possibleEmojiMethods) {
            const method = emojiStore[methodName];
            if (typeof method !== 'function') continue;

            try {
              const result = method.call(emojiStore, guildId);
              if (result && typeof result === 'object') {
                emojis = normalizeEmojiList(result);
                if (emojis.length > 0) break;
              }
            } catch (error) {
              // Try the next candidate method.
            }
          }
        }

        const stickerStore = findWebpackModule((candidate) => {
          const methodNames = getMethodNames(candidate);
          return methodNames.some((name) => /sticker/i.test(name)) &&
            methodNames.some((name) => /guild/i.test(name));
        });
        const possibleStickerMethods = [
          'getStickersForGuild',
          'getGuildStickers',
          'getStickersByGuildId',
          'getStickersByGuild',
          'getStickerPackForGuild'
        ];

        if (stickerStore && stickers.length === 0) {
          for (const methodName of possibleStickerMethods) {
            const method = stickerStore[methodName];
            if (typeof method !== 'function') continue;

            try {
              const result = method.call(stickerStore, guildId);
              if (result && typeof result === 'object') {
                const guildStickerResult = result?.[guildId]?.stickers || result?.[guildId] || result?.stickers || result;
                stickers = normalizeStickerList(guildStickerResult);
                if (stickers.length > 0) break;
              }
            } catch (error) {
              // Try the next candidate method.
            }
          }
        }

        if (emojis.length > 0 || stickers.length > 0) {
          return {
            guildId: String(guild?.id || guildId),
            guildName,
            emojis,
            stickers
          };
        }

        return null;
      };

      try {
        let token = '';
        let response = await performGuildFetch();

        if (response.status === 401) {
          token = readDiscordToken();
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
        let stickers = normalizeStickerList(guild.stickers);
        try {
          if (!token && stickers.length === 0) {
            token = readDiscordToken();
          }
          const stickerResponse = await performGuildStickersFetch(token);
          if (stickerResponse.ok) {
            stickers = normalizeStickerList(await stickerResponse.json());
          }
        } catch (error) {
          // Keep emoji import working even if the sticker endpoint is unavailable.
        }

        return {
          guildId,
          guildName: guild.name,
          emojis: normalizeEmojiList(guild.emojis),
          stickers
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
  let importedEmojiCount = 0;
  let importedStickerCount = 0;
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
    const guildStickers = Array.isArray(guildData.stickers) ? guildData.stickers.filter((sticker) => sticker?.id) : [];
    const guildItems = [
      ...guildEmojis.map((emoji) => ({ type: 'emoji', ...emoji })),
      ...guildStickers.map((sticker) => ({ type: 'sticker', ...sticker }))
    ];

    discordImportState.guildId = guildId;
    discordImportState.guildName = guildName;
    discordImportState.total = guildItems.length;

    if (!guildId) {
      throw new Error('Could not determine the current Discord server');
    }

    if (guildItems.length === 0) {
      throw new Error('This Discord server has no custom emojis or stickers to import');
    }

    const foundParts = [];
    if (guildEmojis.length > 0) {
      foundParts.push(`${guildEmojis.length} emoji${guildEmojis.length === 1 ? '' : 's'}`);
    }
    if (guildStickers.length > 0) {
      foundParts.push(`${guildStickers.length} sticker${guildStickers.length === 1 ? '' : 's'}`);
    }

    await updateDiscordImportProgress({
      inProgress: true,
      current: 0,
      total: guildItems.length,
      guildId,
      guildName,
      statusText: `Found ${foundParts.join(' and ')} in ${guildName}`
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
    const existingEmojisSet = channelsById.get(`discord:${guildId}:emojis`);
    const existingStickersSet = channelsById.get(`discord:${guildId}:stickers`);
    const previousGuildKeys = new Set([
      ...Object.keys(existingGuildChannel?.emotes || {}),
      ...Object.keys(existingEmojisSet?.emotes || {}),
      ...Object.keys(existingStickersSet?.emotes || {})
    ]);
    const reservedKeys = new Set(Object.keys(globalEmoteMapping));
    previousGuildKeys.forEach((key) => reservedKeys.delete(key));

    const importedEmojis = {};
    const importedStickers = {};

    for (const item of guildItems) {
      const isSticker = item.type === 'sticker';
      const key = buildUniqueDiscordEmojiKey(item.name, guildName, reservedKeys);
      const stickerFileInfo = isSticker ? getDiscordStickerFileInfo(item) : null;
      const url = isSticker ? stickerFileInfo?.url : buildDiscordEmojiCdnUrl(item.id, item.animated);
      const extension = isSticker ? stickerFileInfo?.extension : (item.animated ? 'gif' : 'png');
      const fallbackMimeType = isSticker ? stickerFileInfo?.mimeType : (item.animated ? 'image/gif' : 'image/png');

      try {
        if (!url) {
          throw new Error('Unsupported sticker format');
        }

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        let blob = await response.blob();
        if (!(blob instanceof Blob) || blob.size === 0) {
          throw new Error(`Empty ${isSticker ? 'sticker' : 'emoji'} asset`);
        }
        if (!blob.type && fallbackMimeType) {
          blob = new Blob([await blob.arrayBuffer()], { type: fallbackMimeType });
        }

        await emoteDB.storeEmote(key, url, blob, {
          channel: guildName,
          channelId: guildId,
          sourceType: 'discord',
          sourceLabel: isSticker ? 'Discord Sticker' : 'Discord Emoji',
          guildName,
          discordAssetType: isSticker ? 'sticker' : 'emoji',
          discordEmojiId: isSticker ? '' : item.id,
          discordStickerId: isSticker ? item.id : '',
          discordStickerFormatType: isSticker ? Number(item.formatType || 1) : 0,
          animated: isSticker ? Number(item.formatType || 1) === 4 : Boolean(item.animated),
          filename: `${sanitizeDiscordEmojiName(item.name, isSticker ? 'sticker' : 'emoji')}.${extension || 'png'}`
        });

        if (isSticker) {
          importedStickers[key] = url;
        } else {
          importedEmojis[key] = url;
        }
        globalEmoteMapping[key] = url;
        importedCount += 1;
        if (isSticker) {
          importedStickerCount += 1;
        } else {
          importedEmojiCount += 1;
        }
      } catch (error) {
        console.warn(`[Discord Import] Skipping ${isSticker ? 'sticker' : 'emoji'}:`, item?.name, error?.message || error);
        skippedCount += 1;
      }

      discordImportState.current = importedCount + skippedCount;
      await updateDiscordImportProgress({
        inProgress: true,
        current: discordImportState.current,
        total: guildItems.length,
        guildId,
        guildName,
        currentItem: item.name,
        statusText: `Importing Discord media from ${guildName}`,
        importedCount,
        importedEmojiCount,
        importedStickerCount,
        skippedCount
      });
    }

    if (importedCount === 0) {
      throw new Error('Could not import any Discord emojis or stickers from this server');
    }

    for (const oldKey of previousGuildKeys) {
      if (Object.prototype.hasOwnProperty.call(importedEmojis, oldKey)) continue;
      if (Object.prototype.hasOwnProperty.call(importedStickers, oldKey)) continue;
      delete globalEmoteMapping[oldKey];
      await emoteDB.deleteEmote(oldKey);
    }

    channelsById.set(guildId, {
      id: guildId,
      username: guildName,
      emotes: {},
      parentChannelId: '',
      isEmoteSet: false,
      mediaCounts: {
        emojis: importedEmojiCount,
        stickers: importedStickerCount
      },
      sourceType: 'discord',
      discordGuildId: guildId,
      discordGuildName: guildName,
      discordGuildLink: `https://discord.com/channels/${guildId}`
    });

    const emojisSetId = `discord:${guildId}:emojis`;
    if (Object.keys(importedEmojis).length > 0) {
      channelsById.set(emojisSetId, {
        id: emojisSetId,
        username: `${guildName} - Emojis`,
        baseUsername: guildName,
        emotes: importedEmojis,
        parentChannelId: guildId,
        platformChannelId: guildId,
        isEmoteSet: true,
        emoteSetId: emojisSetId,
        emoteSetName: 'Emojis',
        emoteSetKind: 'NORMAL',
        sourceType: 'discord',
        discordGuildId: guildId,
        discordGuildName: guildName,
        discordGuildLink: `https://discord.com/channels/${guildId}`,
        discordAssetType: 'emoji'
      });
    } else {
      channelsById.delete(emojisSetId);
    }

    const stickersSetId = `discord:${guildId}:stickers`;
    if (Object.keys(importedStickers).length > 0) {
      channelsById.set(stickersSetId, {
        id: stickersSetId,
        username: `${guildName} - Stickers`,
        baseUsername: guildName,
        emotes: importedStickers,
        parentChannelId: guildId,
        platformChannelId: guildId,
        isEmoteSet: true,
        emoteSetId: stickersSetId,
        emoteSetName: 'Stickers',
        emoteSetKind: 'NORMAL',
        sourceType: 'discord',
        discordGuildId: guildId,
        discordGuildName: guildName,
        discordGuildLink: `https://discord.com/channels/${guildId}`,
        discordAssetType: 'sticker'
      });
    } else {
      channelsById.delete(stickersSetId);
    }

    await chrome.storage.local.set({
      emoteMapping: globalEmoteMapping,
      channels: Array.from(channelsById.values())
    });

    discordImportState.isImporting = false;

    const importedParts = [];
    if (importedEmojiCount > 0) {
      importedParts.push(`${importedEmojiCount} emoji${importedEmojiCount === 1 ? '' : 's'}`);
    }
    if (importedStickerCount > 0) {
      importedParts.push(`${importedStickerCount} sticker${importedStickerCount === 1 ? '' : 's'}`);
    }
    if (importedParts.length === 0) {
      importedParts.push(`${importedCount} Discord item${importedCount === 1 ? '' : 's'}`);
    }
    const toastMessage = `Imported ${importedParts.join(' and ')} from ${guildName}`;
    await updateDiscordImportProgress({
      inProgress: false,
      completed: true,
      current: guildItems.length,
      total: guildItems.length,
      guildId,
      guildName,
      importedCount,
      importedEmojiCount,
      importedStickerCount,
      skippedCount,
      channelId: guildId,
      toastMessage
    });

    return {
      success: true,
      guildName,
      channelId: guildId,
      importedCount,
      importedEmojiCount,
      importedStickerCount,
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
      importedEmojiCount,
      importedStickerCount,
      skippedCount,
      error: error.message
    });
    throw error;
  }
}

function waitForTabLoaded(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function batchRefreshDiscordServers(serverIds) {
  const results = { refreshed: 0, skipped: 0, errors: [] };

  if (!Array.isArray(serverIds) || serverIds.length === 0) {
    return results;
  }

  await updateDiscordImportProgress({
    inProgress: true,
    current: 0,
    total: serverIds.length,
    statusText: `Refreshing ${serverIds.length} Discord server${serverIds.length === 1 ? '' : 's'}...`
  });

  const allTabs = await chrome.tabs.query({});
  const openGuildTabs = new Map();
  for (const tab of allTabs) {
    const match = String(tab?.url || '').match(/discord(?:app)?\.com\/channels\/(\d+)/i);
    if (match && tab.id) {
      openGuildTabs.set(match[1], tab.id);
    }
  }

  for (let i = 0; i < serverIds.length; i++) {
    const serverId = String(serverIds[i]);
    let tabId = openGuildTabs.get(serverId);
    let openedByUs = false;

    if (!tabId) {
      const tab = await new Promise((resolve) => {
        chrome.tabs.create({ url: `https://discord.com/channels/${serverId}`, active: false }, resolve);
      });
      if (!tab?.id) {
        results.skipped++;
        results.errors.push(`Could not open tab for server ${serverId}`);
        continue;
      }
      tabId = tab.id;
      openedByUs = true;

      const loaded = await waitForTabLoaded(tabId, 15000);
      if (!loaded) {
        try { chrome.tabs.remove(tabId); } catch {}
        results.skipped++;
        results.errors.push(`Tab did not load for server ${serverId}`);
        continue;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    await updateDiscordImportProgress({
      inProgress: true,
      current: i,
      total: serverIds.length,
      statusText: `Refreshing server ${i + 1} of ${serverIds.length}...`
    });

    try {
      const response = await new Promise((resolve, reject) => {
        importDiscordServerEmojis(tabId)
          .then((result) => resolve(result))
          .catch((error) => reject(error));
      });
      if (response?.success) results.refreshed++;
      else results.skipped++;
    } catch (error) {
      results.skipped++;
      results.errors.push(error.message || `Failed for server ${serverId}`);
    } finally {
      if (openedByUs) {
        try { chrome.tabs.remove(tabId); } catch {}
      }
    }
  }

  await updateDiscordImportProgress({
    inProgress: false,
    completed: true,
    current: serverIds.length,
    total: serverIds.length,
    statusText: `Discord refresh complete: ${results.refreshed} refreshed, ${results.skipped} skipped`
  });

  return results;
}

async function importTelegramStickerSet(stickerSetInput) {
  if (telegramImportState.isImporting) {
    throw new Error('A Telegram import is already in progress');
  }

  const setName = sanitizeTelegramStickerSetName(stickerSetInput);

  telegramImportState.isImporting = true;
  telegramImportState.current = 0;
  telegramImportState.total = 0;
  telegramImportState.setName = setName;
  telegramImportState.setTitle = setName;
  telegramImportState.startedAt = Date.now();

  let setTitle = setName;
  let channelId = `telegram:${setName}`;
  let importedCount = 0;
  let importedStickerCount = 0;
  let importedAnimatedCount = 0;
  let importedVideoCount = 0;
  let importedPreviewCount = 0;
  let skippedCount = 0;
  let skippedAnimatedCount = 0;
  let skippedUnsupportedCount = 0;

  try {
    await updateTelegramImportProgress({
      inProgress: true,
      current: 0,
      total: 0,
      setName,
      setTitle,
      statusText: 'Reading Telegram sticker set...'
    });

    const { apiKeys = {} } = await chrome.storage.local.get(['apiKeys']);
    const botToken = String(apiKeys.telegramBotToken || '').trim();
    if (!botToken) {
      throw new Error('Add a Telegram bot token in API Key Settings first');
    }

    const stickerSet = await fetchTelegramBotApi(botToken, 'getStickerSet', { name: setName });
    const stickers = Array.isArray(stickerSet?.stickers)
      ? stickerSet.stickers.filter((sticker) => sticker?.file_id)
      : [];

    setTitle = stickerSet?.title || setName;
    channelId = `telegram:${stickerSet?.name || setName}`;
    telegramImportState.setTitle = setTitle;
    telegramImportState.total = stickers.length;

    if (stickers.length === 0) {
      throw new Error('Telegram returned no stickers for that set');
    }

    await updateTelegramImportProgress({
      inProgress: true,
      current: 0,
      total: stickers.length,
      setName,
      setTitle,
      channelId,
      statusText: `Found ${stickers.length} Telegram item${stickers.length === 1 ? '' : 's'} in ${setTitle}`
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

    const existingTelegramChannel = channelsById.get(channelId);
    const previousTelegramKeys = new Set(Object.keys(existingTelegramChannel?.emotes || {}));
    const reservedKeys = new Set(Object.keys(globalEmoteMapping));
    previousTelegramKeys.forEach((key) => reservedKeys.delete(key));

    const importedEmotes = {};

    for (let index = 0; index < stickers.length; index += 1) {
      const sticker = stickers[index];
      const itemLabel = getTelegramItemLabel(stickerSet?.name || setName, index, sticker);

      try {
        const fileResult = await fetchTelegramStickerBlob(botToken, sticker);
        if (fileResult.skipped) {
          skippedCount += 1;
          if (fileResult.reason === 'animated') {
            skippedAnimatedCount += 1;
          } else {
            skippedUnsupportedCount += 1;
          }
        } else {
          const key = buildUniqueTelegramStickerKey(stickerSet?.name || setName, index, reservedKeys);
          const url = getTelegramStoredReference(sticker);
          const extension = fileResult.extension || 'webp';
          const isConverted = Boolean(fileResult.converted);
          const isVideo = fileResult.mimeType === 'video/webm';
          const isPreview = Boolean(fileResult.thumbnail) && !isConverted;
          const filename = `${key.replace(/:/g, '')}${isPreview ? '_preview' : isConverted ? '_animated' : ''}.${extension}`;
          const sourceLabel = isConverted
            ? 'Telegram Animated Sticker'
            : isPreview
              ? 'Telegram Animated Sticker Preview'
              : isVideo
                ? 'Telegram Video Sticker'
                : 'Telegram Sticker';

          await emoteDB.storeEmote(key, url, fileResult.blob, {
            channel: setTitle,
            channelId,
            sourceType: 'telegram',
            sourceLabel,
            telegramStickerSetName: stickerSet?.name || setName,
            telegramStickerSetTitle: setTitle,
            telegramStickerFileId: sticker.file_id || '',
            telegramStickerFileUniqueId: sticker.file_unique_id || '',
            telegramStickerEmoji: sticker.emoji || '',
            telegramStickerType: stickerSet?.sticker_type || '',
            telegramAssetType: isConverted ? 'animated-sticker' : isPreview ? 'animated-preview' : isVideo ? 'video-sticker' : 'sticker',
            telegramOriginalFilePath: fileResult.originalFilePath || fileResult.filePath || '',
            telegramConvertedFrom: fileResult.convertedFrom || '',
            telegramConversionMethod: fileResult.conversionMethod || '',
            telegramConversionRenderer: fileResult.renderer || '',
            telegramConversionEncoder: fileResult.encoder || '',
            telegramConversionDurationMs: Number(fileResult.durationMs || 0),
            telegramConversionFrameRate: Number(fileResult.frameRate || 0),
            telegramConversionFrameCount: Number(fileResult.frameCount || 0),
            telegramConversionWidth: Number(fileResult.width || 0),
            telegramConversionHeight: Number(fileResult.height || 0),
            telegramConversionLossless: Boolean(fileResult.lossless),
            telegramConversionError: fileResult.conversionError || '',
            animated: Boolean(sticker.is_animated || isConverted),
            video: Boolean(sticker.is_video || isVideo),
            previewOnly: isPreview,
            convertedFromTgs: isConverted,
            filename
          });

          importedEmotes[key] = url;
          globalEmoteMapping[key] = url;
          importedCount += 1;
          if (isConverted) {
            importedAnimatedCount += 1;
          } else if (isPreview) {
            importedPreviewCount += 1;
          } else if (isVideo) {
            importedVideoCount += 1;
          } else {
            importedStickerCount += 1;
          }

          await publishTelegramImportLibrarySnapshot({
            channelsById,
            channelId,
            setName: stickerSet?.name || setName,
            setTitle,
            importedEmotes,
            globalEmoteMapping,
            importedStickerCount,
            importedAnimatedCount,
            importedVideoCount,
            importedPreviewCount,
            skippedCount,
            skippedAnimatedCount,
            importInProgress: true
          });
        }
      } catch (error) {
        console.warn('[Telegram Import] Skipping sticker:', itemLabel, error?.message || error);
        skippedCount += 1;
        skippedUnsupportedCount += 1;
      }

      telegramImportState.current = importedCount + skippedCount;
      await updateTelegramImportProgress({
        inProgress: true,
        current: telegramImportState.current,
        total: stickers.length,
        setName,
        setTitle,
        currentItem: itemLabel,
        statusText: `Importing Telegram stickers from ${setTitle}`,
        importedCount,
        importedStickerCount,
        importedAnimatedCount,
        importedVideoCount,
        importedPreviewCount,
        skippedCount,
        skippedAnimatedCount,
        skippedUnsupportedCount,
        channelId
      });
    }

    if (importedCount === 0) {
      const skipReason = skippedAnimatedCount > 0 && skippedAnimatedCount === skippedCount
        ? 'This pack only has animated TGS stickers, but Mojify could not convert them with the native helper.'
        : 'No supported Telegram stickers were imported from this set.';
      throw new Error(skipReason);
    }

    for (const oldKey of previousTelegramKeys) {
      if (Object.prototype.hasOwnProperty.call(importedEmotes, oldKey)) continue;
      delete globalEmoteMapping[oldKey];
      await emoteDB.deleteEmote(oldKey);
    }

    await publishTelegramImportLibrarySnapshot({
      channelsById,
      channelId,
      setName: stickerSet?.name || setName,
      setTitle,
      importedEmotes,
      globalEmoteMapping,
      importedStickerCount,
      importedAnimatedCount,
      importedVideoCount,
      importedPreviewCount,
      skippedCount,
      skippedAnimatedCount,
      importInProgress: false
    });

    telegramImportState.isImporting = false;

    const importedParts = [];
    if (importedStickerCount > 0) {
      importedParts.push(`${importedStickerCount} sticker${importedStickerCount === 1 ? '' : 's'}`);
    }
    if (importedAnimatedCount > 0) {
      importedParts.push(`${importedAnimatedCount} animated sticker${importedAnimatedCount === 1 ? '' : 's'}`);
    }
    if (importedVideoCount > 0) {
      importedParts.push(`${importedVideoCount} video sticker${importedVideoCount === 1 ? '' : 's'}`);
    }
    if (importedPreviewCount > 0) {
      importedParts.push(`${importedPreviewCount} animated preview${importedPreviewCount === 1 ? '' : 's'}`);
    }

    const skippedNote = skippedAnimatedCount > 0
      ? ` (${skippedAnimatedCount} animated TGS skipped)`
      : '';
    const toastMessage = `Imported ${importedParts.join(' and ')} from ${setTitle}${skippedNote}`;

    await updateTelegramImportProgress({
      inProgress: false,
      completed: true,
      current: stickers.length,
      total: stickers.length,
      setName,
      setTitle,
      importedCount,
      importedStickerCount,
      importedAnimatedCount,
      importedVideoCount,
      importedPreviewCount,
      skippedCount,
      skippedAnimatedCount,
      skippedUnsupportedCount,
      channelId,
      toastMessage
    });

    return {
      success: true,
      setName,
      setTitle,
      channelId,
      importedCount,
      importedStickerCount,
      importedAnimatedCount,
      importedVideoCount,
      importedPreviewCount,
      skippedCount,
      skippedAnimatedCount,
      skippedUnsupportedCount
    };
  } catch (error) {
    telegramImportState.isImporting = false;
    await updateTelegramImportProgress({
      inProgress: false,
      current: telegramImportState.current,
      total: telegramImportState.total,
      setName,
      setTitle,
      importedCount,
      importedStickerCount,
      importedAnimatedCount,
      importedVideoCount,
      importedPreviewCount,
      skippedCount,
      skippedAnimatedCount,
      skippedUnsupportedCount,
      error: error.message
    });
    throw error;
  }
}

async function handleChannelIdsChanged(oldChannelIds = [], newChannelIds = []) {
  if (JSON.stringify(newChannelIds) === JSON.stringify(oldChannelIds)) {
    return;
  }

  if (newChannelIds.length === 0 && oldChannelIds.length > 0) {
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
      console.error('[Mojify] Error cleaning up channel storage:', error);
    }
  }
}

let _menuSetupInProgress = false;
let _menuSetupPendingUrl = null;

function setupContextMenusForUrl(url) {
  if (_menuSetupInProgress) {
    _menuSetupPendingUrl = url;
    return;
  }
  _menuSetupInProgress = true;

  chrome.contextMenus.removeAll(() => {
    if (/discord(?:app)?\.com\/channels\//.test(url || '')) {
      chrome.contextMenus.create({
        id: 'importDiscordServer',
        title: 'Import Discord Server',
        contexts: ['action']
      });
    }

    if (/7tv\.app\/users\//.test(url || '')) {
      chrome.contextMenus.create({
        id: 'import7TVChannel',
        title: 'Import 7TV Channel',
        contexts: ['action']
      });
    }

    if (/t\.me\/add(?:stickers|emoji)\//.test(url || '') || (/web\.telegram\.org/.test(url || '') && detectedTelegramStickerSet)) {
      chrome.contextMenus.create({
        id: 'importTelegramStickerSet',
        title: 'Import Telegram Sticker Set',
        contexts: ['action']
      });
    }

    _menuSetupInProgress = false;
    if (_menuSetupPendingUrl !== null) {
      const pending = _menuSetupPendingUrl;
      _menuSetupPendingUrl = null;
      setupContextMenusForUrl(pending);
    }
  });
}

function isImportSupportedUrl(url) {
  const u = url || '';
  if (/discord(?:app)?\.com\/channels\//.test(u)) return true;
  if (/7tv\.app\/users\//.test(u)) return true;
  if (/t\.me\/add(?:stickers|emoji)\//.test(u)) return true;
  if (/web\.telegram\.org/.test(u) && detectedTelegramStickerSet) return true;
  return false;
}

function updateBadgeForUrl(url) {
  if (isImportSupportedUrl(url)) {
    chrome.action.setBadgeBackgroundColor({ color: '#229ED9' });
    chrome.action.setBadgeText({ text: '+' });
  } else {
    if (!isImportSupportedUrl(url)) detectedTelegramStickerSet = null;
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    updateBadgeForUrl(tab?.url);
    setupContextMenusForUrl(tab?.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (/web\.telegram\.org/.test(tab?.url || '') && detectedTelegramStickerSet) {
    detectedTelegramStickerSet = null;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id === tabId) {
      updateBadgeForUrl(tab?.url);
      setupContextMenusForUrl(tab?.url);
    }
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  detectedTelegramStickerSet = null;
  chrome.action.setBadgeText({ text: '' });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    setupContextMenusForUrl(tabs[0]?.url);
  });
  resetDownloadState();
});

chrome.runtime.onStartup.addListener(() => {
  detectedTelegramStickerSet = null;
  chrome.action.setBadgeText({ text: '' });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    setupContextMenusForUrl(tabs[0]?.url);
  });
  resetDownloadState();
});

async function getContextMenuTargetTab(tab) {
  if (tab?.id) return tab;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function extract7TVUserIdFromUrl(url) {
  const match = url.match(/7tv\.app\/users\/([a-zA-Z0-9]+)/i);
  return match ? match[1] : '';
}

async function import7TVChannelEmotes(userId) {
  if (se7enTvImportState.isImporting) {
    throw new Error('A 7TV import is already in progress');
  }

  se7enTvImportState.isImporting = true;
  se7enTvImportState.userId = userId;
  se7enTvImportState.startedAt = Date.now();

  try {
    await update7TVImportProgress({
      inProgress: true,
      current: 0,
      total: 0,
      statusText: 'Fetching 7TV user data...'
    });

    const userData = await fetchJsonWithTimeout(`${SEVEN_TV_API_ORIGIN}/v3/users/${userId}`, {}, SEVEN_TV_RESOLVE_TIMEOUT_MS);
    const username = userData?.display_name || userData?.username || userId;
    const emoteSets = Array.isArray(userData?.emote_sets) ? userData.emote_sets : [];

    if (emoteSets.length === 0) {
      throw new Error('No emote sets found for this 7TV user');
    }

    se7enTvImportState.username = username;

    await update7TVImportProgress({
      inProgress: true,
      current: 0,
      total: emoteSets.length,
      username,
      statusText: `Found ${emoteSets.length} set${emoteSets.length === 1 ? '' : 's'} for ${username}`
    });

    const sources = emoteSets.map((set) => ({
      type: '7tv-set',
      channelId: userId,
      setId: set.id,
      setName: set.name || set.id,
      username,
      sevenTvUserId: userId,
      activeSetId: emoteSets[0]?.id || ''
    }));

    const result = await downloadEmotes({ sources });

    se7enTvImportState.isImporting = false;

    await update7TVImportProgress({
      inProgress: false,
      current: emoteSets.length,
      total: emoteSets.length,
      username,
      importedCount: result?.totalEmotes || 0,
      completed: true,
      statusText: `Imported emotes from ${username}`
    });

    return { success: true, importedCount: result?.totalEmotes || 0, username, userId };
  } catch (error) {
    se7enTvImportState.isImporting = false;
    await update7TVImportProgress({
      inProgress: false,
      current: 0,
      total: 0,
      username: se7enTvImportState.username,
      error: error.message,
      statusText: `Import failed: ${error.message}`
    });
    throw error;
  }
}

async function import7TVChannelFromContextMenu(tab) {
  const targetTab = await getContextMenuTargetTab(tab);
  if (!targetTab?.url || !/7tv\.app\/users\//.test(targetTab.url || '')) {
    sendRuntimeMessage({
      type: 'showToast',
      message: 'Open a 7TV user page before importing',
      toastType: 'error'
    });
    return;
  }

  const userId = extract7TVUserIdFromUrl(targetTab.url);
  if (!userId) {
    sendRuntimeMessage({
      type: 'showToast',
      message: 'Could not extract 7TV user ID from this page',
      toastType: 'error'
    });
    return;
  }

  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#7523D6' });
    await chrome.action.setBadgeText({ text: 'IMP' });
    const result = await import7TVChannelEmotes(userId);
    sendRuntimeMessage({
      type: 'showToast',
      message: result?.importedCount
        ? `Imported ${result.importedCount} emote${result.importedCount === 1 ? '' : 's'} from ${result.username}`
        : '7TV import completed',
      toastType: 'success'
    });
  } catch (error) {
    sendRuntimeMessage({
      type: 'showToast',
      message: `7TV import failed: ${error.message}`,
      toastType: 'error'
    });
  } finally {
    await chrome.action.setBadgeText({ text: '' });
  }
}

async function importDiscordServerFromContextMenu(tab) {
  const targetTab = await getContextMenuTargetTab(tab);
  if (!targetTab?.id || !/discord(app)?\.com\/channels\//.test(targetTab.url || '')) {
    sendRuntimeMessage({
      type: 'showToast',
      message: 'Open a Discord server tab before importing',
      toastType: 'error'
    });
    return;
  }

  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#5865F2' });
    await chrome.action.setBadgeText({ text: 'IMP' });
    const result = await importDiscordServerEmojis(targetTab.id);
    sendRuntimeMessage({
      type: 'showToast',
      message: result?.importedCount
        ? `Imported ${result.importedCount} Discord item${result.importedCount === 1 ? '' : 's'}`
        : 'Discord import completed',
      toastType: 'success'
    });
  } catch (error) {
    sendRuntimeMessage({
      type: 'showToast',
      message: error?.message || 'Discord import failed',
      toastType: 'error'
    });
  } finally {
    await chrome.action.setBadgeText({ text: '' });
  }
}

async function importTelegramStickerSetFromContextMenu(tab) {
  const targetTab = await getContextMenuTargetTab(tab);
  const url = String(targetTab?.url || '');

  let setName = '';
  const urlMatch = url.match(/t\.me\/add(?:stickers|emoji)\/([A-Za-z][A-Za-z0-9_]*)/i);
  if (urlMatch) {
    setName = urlMatch[1];
  } else if (/web\.telegram\.org/.test(url)) {
    if (detectedTelegramStickerSet) {
      setName = detectedTelegramStickerSet;
    }
    if (!setName) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: () => {
            const modal = document.querySelector('.StickerSetModal.shown.open, .StickerSetModal.open');
            if (!modal) return '';
            const titleEl = modal.querySelector('.modal-title');
            if (!titleEl) return '';
            const title = titleEl.textContent.replace(/@\w+/, '').trim();
            const chatLinks = [...document.querySelectorAll('a')].filter(a =>
              a.href.includes('t.me/addemoji/') || a.href.includes('t.me/addstickers/')
            );
            for (const link of chatLinks) {
              const sn = link.href.split('/').pop();
              const norm = sn.replace(/_/g, '').replace(/by.*$/i, '').toLowerCase();
              const normTitle = title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
              if (normTitle && (normTitle.includes(norm) || norm.includes(normTitle))) return sn;
            }
            return '';
          }
        });
        setName = result?.result || '';
      } catch {}
    }
  }

  if (!setName) {
    sendRuntimeMessage({
      type: 'showToast',
      message: 'Open a sticker set in Telegram web first, then try again',
      toastType: 'error'
    });
    return;
  }

  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#229ED9' });
    await chrome.action.setBadgeText({ text: 'IMP' });
    await importTelegramStickerSet(setName);
    sendRuntimeMessage({
      type: 'showToast',
      message: 'Telegram sticker set imported',
      toastType: 'success'
    });
  } catch (error) {
    sendRuntimeMessage({
      type: 'showToast',
      message: error?.message || 'Telegram import failed',
      toastType: 'error'
    });
  } finally {
    detectedTelegramStickerSet = null;
    await chrome.action.setBadgeText({ text: '' });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'importDiscordServer') {
    importDiscordServerFromContextMenu(tab);
  }

  if (info.menuItemId === 'import7TVChannel') {
    import7TVChannelFromContextMenu(tab);
  }

  if (info.menuItemId === 'importTelegramStickerSet') {
    importTelegramStickerSetFromContextMenu(tab);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.channelIds) {
    return;
  }

  const oldChannelIds = changes.channelIds.oldValue || [];
  const newChannelIds = changes.channelIds.newValue || [];
  handleChannelIdsChanged(oldChannelIds, newChannelIds);
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
  if (request.type === 'telegramStickerSetDetected' && request.setName) {
    detectedTelegramStickerSet = request.setName;
    chrome.action.setBadgeBackgroundColor({ color: '#229ED9' });
    chrome.action.setBadgeText({ text: '+' });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setupContextMenusForUrl(tabs[0]?.url);
    });
    return;
  }

  if (request.type === 'telegramStickerSetClosed') {
    detectedTelegramStickerSet = null;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      updateBadgeForUrl(tabs[0]?.url);
      setupContextMenusForUrl(tabs[0]?.url);
    });
    return;
  }

  if (request.action === 'cleanOrphanedEmotes') {
    (async () => {
      const data = await chrome.storage.local.get(['channels']);
      const channels = data.channels || [];

      // Collect all valid channel IDs and all trigger keys from channels
      const validChannelIds = new Set();
      const referencedTriggers = new Set();
      for (const ch of channels) {
        if (ch.id) validChannelIds.add(String(ch.id));
        if (ch.parentChannelId) validChannelIds.add(String(ch.parentChannelId));
        if (ch.platformChannelId) validChannelIds.add(String(ch.platformChannelId));
        if (ch.emotes) Object.keys(ch.emotes).forEach(k => referencedTriggers.add(k));
      }

      // Get all IndexedDB metadata
      const allMeta = await emoteDB.getAllEmoteMetadata();
      console.log('[Mojify] Orphan scan:', allMeta.length, 'emotes in IndexedDB,', validChannelIds.size, 'valid channel IDs,', referencedTriggers.size, 'referenced triggers');
      if (allMeta.length > 0) {
        console.log('[Mojify] Sample metadata:', JSON.stringify(allMeta[0]));
        console.log('[Mojify] Sample old-format:', JSON.stringify(allMeta.find(m => String(m.key||'').startsWith(':') && !String(m.key).includes('7tv:'))));
      }

      const orphanKeys = [];

      for (const meta of allMeta) {
        const metaChannelId = String(meta?.channelId || '');
        const metaKey = String(meta?.key || '');
        const metaTriggerKey = String(meta?.triggerKey || '');

        let isOrphan = true;

        // Referenced by a current channel via trigger key?
        if (metaTriggerKey && referencedTriggers.has(metaTriggerKey)) {
          isOrphan = false;
        }

        // Referenced by key directly?
        if (isOrphan && referencedTriggers.has(metaKey)) {
          isOrphan = false;
        }

        // channelId in metadata matches a current channel?
        if (isOrphan && metaChannelId && metaChannelId !== 'undefined' && validChannelIds.has(metaChannelId)) {
          isOrphan = false;
        }

        // Storage key contains a valid channel ID?
        if (isOrphan) {
          for (const cid of validChannelIds) {
            if (metaKey.includes(cid)) {
              isOrphan = false;
              break;
            }
          }
        }

        if (isOrphan) {
          orphanKeys.push(meta.key);
        }
      }

      // Delete orphans
      for (const key of orphanKeys) {
        try { await emoteDB.deleteEmote(key); } catch (e) {}
      }

      return { success: true, deleted: orphanKeys.length };
    })()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'cancelDownload') {
    downloadState.cancelled = true;
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'getDashboardState') {
    (async () => {
      try {
        const storage = await chrome.storage.local.get([
          'channels', 'emoteMapping', 'triggerToStorageKey',
          'downloadInProgress', 'downloadProgress',
          'discordImportInProgress', 'discordImportProgress',
          'telegramImportInProgress', 'telegramImportProgress',
          'failedEmotes'
        ]);

        let emoteCount = 0;
        let failedBlobCount = 0;
        try {
          if (!emoteDB.db) await emoteDB.init();
          emoteCount = await emoteDB.getEmoteCount();
          const allMeta = await emoteDB.getAllEmoteMetadata();
          for (const meta of allMeta) {
            const blob = await emoteDB.getEmote(meta.key);
            if (!blob || !blob.blob || blob.blob.size === 0) {
              failedBlobCount++;
            }
          }
        } catch (e) {}

        const channels = storage.channels || [];
        const byPlatform = { twitch: [], discord: [], telegram: [] };
        for (const ch of channels) {
          const st = ch?.sourceType || 'twitch';
          if (!byPlatform[st]) byPlatform[st] = [];
          byPlatform[st].push({
            id: ch.id,
            username: ch.username || ch.baseUsername || ch.id,
            emoteCount: ch.emotes ? Object.keys(ch.emotes).length : 0,
            isEmoteSet: Boolean(ch.isEmoteSet),
            parentChannelId: ch.parentChannelId || '',
            emoteSetName: ch.emoteSetName || '',
            discordGuildName: ch.discordGuildName || '',
            telegramStickerSetName: ch.telegramStickerSetName || '',
            telegramStickerSetTitle: ch.telegramStickerSetTitle || '',
            mediaCounts: ch.mediaCounts || {},
            updatedAt: ch.updatedAt || null
          });
        }

        sendResponse({
          success: true,
          download: {
            isDownloading: downloadState.isDownloading,
            cancelled: downloadState.cancelled,
            current: downloadState.current,
            total: downloadState.total,
            progress: storage.downloadProgress || null
          },
          retry: {
            isRetrying: retryState.isRetrying,
            current: retryState.current,
            total: retryState.total
          },
          discord: {
            isImporting: discordImportState.isImporting,
            current: discordImportState.current,
            total: discordImportState.total,
            guildName: discordImportState.guildName,
            progress: storage.discordImportProgress || null
          },
          telegram: {
            isImporting: telegramImportState.isImporting,
            current: telegramImportState.current,
            total: telegramImportState.total,
            setTitle: telegramImportState.setTitle,
            progress: storage.telegramImportProgress || null
          },
          sevenTv: {
            isImporting: se7enTvImportState.isImporting,
            username: se7enTvImportState.username
          },
          emoteCount,
          failedBlobCount,
          mappingCount: storage.emoteMapping ? Object.keys(storage.emoteMapping).length : 0,
          triggerCount: storage.triggerToStorageKey ? Object.keys(storage.triggerToStorageKey).length : 0,
          channelCount: channels.length,
          channels: byPlatform,
          failedEmotes: storage.failedEmotes || []
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'clearFailedEmotes') {
    chrome.storage.local.remove(['failedEmotes']);
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'retryFailedEmotes') {
    (async () => {
      const { failedEmotes = [] } = await chrome.storage.local.get(['failedEmotes']);
      if (failedEmotes.length === 0) {
        sendResponse({ success: false, error: 'No failed emotes to retry' });
        return;
      }
      runBackgroundRetry(failedEmotes);
      sendResponse({ success: true, count: failedEmotes.length });
    })();
    return true;
  }

  if (request.action === 'injectDiscordSendInterceptor') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No sender tab' });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['mojify-discord-send.js'],
      world: 'MAIN',
    }).then(() => sendResponse({ success: true }))
      .catch((e) => { console.error('[Mojify] Send interceptor inject failed:', e); sendResponse({ success: false, error: e.message }); });
    return true;
  }

  if (request.action === 'setPendingEmoteText') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (text) => { window.__mojifyPendingContent = text; },
      args: [request.text || ''],
    }).then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (request.action === 'getEmote') {
    const resolveEmote = async () => {
      let storageKey = request.key;
      const mapping = await chrome.storage.local.get(['triggerToStorageKey']);
      if (mapping.triggerToStorageKey && mapping.triggerToStorageKey[request.key]) {
        storageKey = mapping.triggerToStorageKey[request.key];
      }
      const emote = await emoteDB.getEmote(storageKey);
      return serializeStoredEmote(emote);
    };
    resolveEmote()
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
    downloadEmotes(request.options || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'get7TVChannelEmoteSets') {
    get7TVChannelEmoteSets(request.channelId, request.sevenTvUserId, request.activeSetId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'download7TVEmoteSet') {
    downloadEmotes({
      sources: [{
        type: '7tv-set',
        channelId: request.channelId,
        setId: request.setId,
        setName: request.setName,
        username: request.username,
        sevenTvUserId: request.sevenTvUserId,
        activeSetId: request.activeSetId
      }]
    })
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

  if (request.action === 'import7TVChannelEmotes') {
    import7TVChannelEmotes(request.userId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'get7TVImportStatus') {
    sendResponse({
      success: true,
      isImporting: se7enTvImportState.isImporting,
      userId: se7enTvImportState.userId,
      username: se7enTvImportState.username
    });
    return false;
  }

  if (request.action === 'batchRefreshDiscordServers') {
    batchRefreshDiscordServers(request.serverIds || [])
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'importTelegramStickerSet') {
    importTelegramStickerSet(request.stickerSet)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getTelegramImportStatus') {
    getTelegramImportStatus()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'resetTelegramImportState') {
    resetTelegramImportState()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'deleteStoredEmotes') {
    (async () => {
      const keys = request.keys || [];
      const channelIds = request.channelIds || [];
      let deleted = 0;

      // Delete by channel IDs (most reliable — scans metadata)
      if (channelIds.length > 0) {
        deleted += await emoteDB.deleteEmotesByChannelIds(channelIds);
      }

      // Also delete by trigger keys (for old-format keys)
      if (keys.length > 0) {
        const mapping = await chrome.storage.local.get(['triggerToStorageKey']);
        const resolvedKeys = keys.map((k) => mapping.triggerToStorageKey?.[k] || k);
        for (const key of resolvedKeys) {
          try { await emoteDB.deleteEmote(key); deleted++; } catch (e) {}
        }
      }

      return { success: true, deleted };
    })()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'insertEmote') {
    insertEmoteIntoMessenger(sender.tab.id, request.emoteUrl, request.emoteTrigger)
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

chrome.runtime.onMessage.addListener(handleRuntimeMessage);
