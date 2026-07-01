const STORAGE_KEY = 'apiKeys';
const API_KEY_FIELDS = {
  tenor: 'tenor-api-key',
  giphy: 'giphy-api-key',
  klipy: 'klipy-api-key',
  pixabay: 'pixabay-api-key',
  twitchClientId: 'twitch-client-id',
  twitchClientSecret: 'twitch-client-secret',
  telegramBotToken: 'telegram-bot-token'
};

const SUPPORTED_KEY_NAMES = Object.keys(API_KEY_FIELDS);

function setStatus(message, type = '') {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.className = `status${type ? ` ${type}` : ''}`;
}

function sanitizeApiKeys(source = {}) {
  const sanitized = {};

  SUPPORTED_KEY_NAMES.forEach((key) => {
    const rawValue = source[key];
    sanitized[key] = typeof rawValue === 'string' ? rawValue.trim() : '';
  });

  return sanitized;
}

function countConfiguredKeys(apiKeys) {
  return SUPPORTED_KEY_NAMES.filter((key) => apiKeys[key]).length;
}

function updateConfiguredCount(apiKeys = collectApiKeysFromInputs()) {
  const configuredCount = document.getElementById('configured-count');
  configuredCount.textContent = `${countConfiguredKeys(apiKeys)} / ${SUPPORTED_KEY_NAMES.length}`;
}

function collectApiKeysFromInputs() {
  const values = {};

  Object.entries(API_KEY_FIELDS).forEach(([key, elementId]) => {
    values[key] = document.getElementById(elementId).value.trim();
  });

  return sanitizeApiKeys(values);
}

function populateApiKeys(apiKeys = {}) {
  const sanitized = sanitizeApiKeys(apiKeys);

  Object.entries(API_KEY_FIELDS).forEach(([key, elementId]) => {
    document.getElementById(elementId).value = sanitized[key] || '';
  });

  updateConfiguredCount(sanitized);
}

function persistApiKeys(apiKeys, successMessage) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const existingApiKeys = result[STORAGE_KEY] || {};
    const nextApiKeys = {
      ...existingApiKeys,
      ...sanitizeApiKeys(apiKeys)
    };

    chrome.storage.local.set({ [STORAGE_KEY]: nextApiKeys }, () => {
      if (chrome.runtime.lastError) {
        setStatus(`Failed to save: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }

      populateApiKeys(nextApiKeys);
      setStatus(successMessage, 'success');
    });
  });
}

function loadApiKeys() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    populateApiKeys(result[STORAGE_KEY] || {});
  });
}

function saveApiKeys() {
  persistApiKeys(collectApiKeysFromInputs(), 'Provider keys saved.');
}

function buildExportPayload(apiKeys) {
  return {
    type: 'mojify-api-keys',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    apiKeys: sanitizeApiKeys(apiKeys)
  };
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportApiKeys() {
  const apiKeys = collectApiKeysFromInputs();
  const timestamp = new Date().toISOString().replace(/[:]/g, '-');
  downloadJson(`mojify-api-keys-${timestamp}.json`, buildExportPayload(apiKeys));
  setStatus('Exported provider keys to JSON.', 'success');
}

function getSerializedExportJson() {
  return JSON.stringify(buildExportPayload(collectApiKeysFromInputs()), null, 2);
}

function normalizeImportedApiKeys(parsedJson) {
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    throw new Error('Invalid JSON format.');
  }

  const candidate =
    parsedJson.apiKeys && typeof parsedJson.apiKeys === 'object' && !Array.isArray(parsedJson.apiKeys)
      ? parsedJson.apiKeys
      : parsedJson;

  const includesSupportedKeys = SUPPORTED_KEY_NAMES.some((key) =>
    Object.prototype.hasOwnProperty.call(candidate, key)
  );

  if (!includesSupportedKeys) {
    throw new Error('No supported Mojify provider keys found in this JSON file.');
  }

  return sanitizeApiKeys(candidate);
}

async function copyApiKeysJson() {
  const serializedJson = getSerializedExportJson();

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(serializedJson);
    } else {
      const tempTextarea = document.createElement('textarea');
      tempTextarea.value = serializedJson;
      tempTextarea.setAttribute('readonly', '');
      tempTextarea.style.position = 'fixed';
      tempTextarea.style.opacity = '0';
      document.body.appendChild(tempTextarea);
      tempTextarea.select();

      const copied = document.execCommand('copy');
      document.body.removeChild(tempTextarea);

      if (!copied) {
        throw new Error('Clipboard copy was blocked.');
      }
    }

    setStatus('Copied provider keys JSON to clipboard.', 'success');
  } catch (error) {
    setStatus(`Copy failed: ${error.message}`, 'error');
  }
}

function importApiKeysFromText() {
  try {
    const rawText = document.getElementById('import-api-keys-text').value.trim();

    if (!rawText) {
      setStatus('Paste provider JSON before importing.', 'error');
      return;
    }

    const parsedJson = JSON.parse(rawText);
    const importedApiKeys = normalizeImportedApiKeys(parsedJson);

    populateApiKeys(importedApiKeys);
    persistApiKeys(importedApiKeys, `Imported ${countConfiguredKeys(importedApiKeys)} configured key(s).`);
  } catch (error) {
    setStatus(`Import failed: ${error.message}`, 'error');
  }
}

// ── IndexedDB wrapper for emote storage ───────────────────────
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
        if (!db.objectStoreNames.contains('emoteBlobs')) {
          db.createObjectStore('emoteBlobs');
        }
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

  async getAllEmotes() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readonly');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');
      const metadataRequest = metadataStore.getAll();
      metadataRequest.onsuccess = () => {
        const metadataResults = metadataRequest.result || [];
        if (metadataResults.length === 0) { resolve([]); return; }
        const results = [];
        let completed = 0;
        metadataResults.forEach(metadata => {
          const blobRequest = blobsStore.get(metadata.key);
          blobRequest.onsuccess = () => {
            const blob = blobRequest.result;
            if (blob && blob instanceof Blob) {
              results.push({ ...metadata, blob });
            }
            completed++;
            if (completed === metadataResults.length) resolve(results);
          };
          blobRequest.onerror = () => {
            completed++;
            if (completed === metadataResults.length) resolve(results);
          };
        });
      };
      metadataRequest.onerror = () => reject(metadataRequest.error);
    });
  },

  async storeEmote(key, url, blob, metadata = {}) {
    if (!this.db) await this.init();
    if (!blob || !(blob instanceof Blob) || blob.size === 0) {
      throw new Error(`Invalid blob for emote ${key}`);
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readwrite');
      const blobsStore = transaction.objectStore('emoteBlobs');
      const metadataStore = transaction.objectStore('emoteMetadata');
      const metadataData = {
        key, url,
        filename: key + (blob.type === 'image/gif' ? '.gif' : '.png'),
        mimeType: blob.type || 'image/png',
        size: blob.size,
        timestamp: Date.now(),
        ...metadata
      };
      let blobStored = false;
      let metadataStored = false;
      const checkComplete = () => {
        if (blobStored && metadataStored) resolve();
      };
      blobsStore.put(blob, key).onsuccess = () => { blobStored = true; checkComplete(); };
      metadataStore.put(metadataData).onsuccess = () => { metadataStored = true; checkComplete(); };
    });
  },

  async clearAll() {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['emoteBlobs', 'emoteMetadata'], 'readwrite');
      let blobsCleared = false;
      let metadataCleared = false;
      const checkComplete = () => {
        if (blobsCleared && metadataCleared) resolve();
      };
      transaction.objectStore('emoteBlobs').clear().onsuccess = () => { blobsCleared = true; checkComplete(); };
      transaction.objectStore('emoteMetadata').clear().onsuccess = () => { metadataCleared = true; checkComplete(); };
    });
  }
};

// ── Backup / Restore ────────────────────────────────────────────

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

    progressText.textContent = 'Backing up settings...';
    progressFill.style.width = '20%';

    const chromeStorageData = await new Promise((resolve) => {
      chrome.storage.local.get(null, resolve);
    });

    const processedChromeStorage = {};
    for (const [key, value] of Object.entries(chromeStorageData)) {
      if (key === 'emoteImageData') continue;
      processedChromeStorage[key] = value;
    }
    backupData.data.chromeStorage = processedChromeStorage;

    progressText.textContent = 'Backing up emotes...';
    progressFill.style.width = '40%';

    const emoteData = [];
    if (emoteDB.db) {
      try {
        const allEmotes = await emoteDB.getAllEmotes();
        for (const emote of allEmotes) {
          let dataUrl = emote.dataUrl;
          if (!dataUrl && emote.blob) {
            dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('Failed to convert blob'));
              reader.readAsDataURL(emote.blob);
            });
          }
          emoteData.push({
            key: emote.key,
            url: emote.url,
            dataUrl: dataUrl,
            channel: emote.channel,
            timestamp: emote.timestamp
          });
        }
        backupData.data.indexedDBEmotes = emoteData;
      } catch (e) {
        console.warn('Could not backup emotes:', e);
        backupData.data.indexedDBEmotes = [];
      }
    }

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
    } catch (e) {
      console.warn('Could not access localStorage:', e);
    }
    backupData.data.localStorage = localStorageData;

    progressText.textContent = 'Creating backup file...';
    progressFill.style.width = '80%';

    const jsonString = JSON.stringify(backupData);
    const sizeInMB = new Blob([jsonString]).size / (1024 * 1024);

    if (sizeInMB > 50) {
      const ok = window.confirm(`Backup is ${sizeInMB.toFixed(1)}MB. Continue?`);
      if (!ok) throw new Error('Backup cancelled');
    }

    const blob = new Blob([jsonString], { type: 'application/json' });
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
    setStatus(`Backup saved (${sizeInMB.toFixed(1)}MB).`, 'success');

    setTimeout(() => {
      progressContainer.classList.add('hidden');
      progressFill.style.width = '0%';
    }, 2000);

  } catch (error) {
    console.error('Backup failed:', error);
    setStatus('Backup failed: ' + error.message, 'error');
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

    const fileSizeInMB = file.size / (1024 * 1024);
    if (fileSizeInMB > 100) {
      const ok = window.confirm(`Large backup (${fileSizeInMB.toFixed(1)}MB). Continue?`);
      if (!ok) throw new Error('Restore cancelled');
    }

    const fileContent = await file.text();
    progressFill.style.width = '15%';

    let backupData;
    try {
      backupData = JSON.parse(fileContent);
    } catch {
      throw new Error('Invalid JSON format in backup file');
    }

    if (!backupData.version || !backupData.data) {
      throw new Error('Invalid backup file format');
    }

    const emoteCount = backupData.data.indexedDBEmotes ? backupData.data.indexedDBEmotes.length : 0;
    const channelCount = backupData.data.chromeStorage?.channels?.length || 0;

    const ok = window.confirm(
      `Restore backup from ${new Date(backupData.timestamp).toLocaleString()}?\n\n` +
      `• ${emoteCount} emotes\n` +
      `• ${channelCount} channels\n\n` +
      `This will replace ALL current data!`
    );
    if (!ok) { progressContainer.classList.add('hidden'); return; }

    progressText.textContent = 'Clearing existing data...';
    progressFill.style.width = '25%';

    await new Promise((resolve) => chrome.storage.local.clear(resolve));

    try {
      if (emoteDB.db) await emoteDB.clearAll();
    } catch (e) { console.warn('Could not clear IndexedDB:', e); }

    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('mojify-suggestion-pos-')) keysToRemove.push(key);
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (e) { console.warn('Could not clear localStorage:', e); }

    progressText.textContent = 'Restoring settings...';
    progressFill.style.width = '40%';

    if (backupData.data.chromeStorage) {
      try {
        const restoreData = {
          ...backupData.data.chromeStorage,
          lastRestoreTime: Date.now(),
          restoreSource: 'backup',
          skipNextDownload: true
        };
        await new Promise((resolve, reject) => {
          chrome.storage.local.set(restoreData, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          });
        });
      } catch (e) { console.warn('Could not restore Chrome storage:', e); }
    }

    progressText.textContent = 'Restoring emotes...';
    progressFill.style.width = '60%';

    if (backupData.data.indexedDBEmotes?.length > 0) {
      try {
        await emoteDB.init();
        const emotes = backupData.data.indexedDBEmotes;
        for (let i = 0; i < emotes.length; i++) {
          const emote = emotes[i];
          if (emote.key && emote.dataUrl) {
            const base64Data = emote.dataUrl.split(',')[1];
            const mimeMatch = emote.dataUrl.match(/data:([^;]+)/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let j = 0; j < byteCharacters.length; j++) {
              byteNumbers[j] = byteCharacters.charCodeAt(j);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            await emoteDB.storeEmote(emote.key, emote.url || '', blob, {
              channel: emote.channel || 'unknown',
              timestamp: emote.timestamp || Date.now()
            });
          }
          if (i % 50 === 0) {
            const pct = 60 + (i / emotes.length) * 20;
            progressFill.style.width = `${pct}%`;
            progressText.textContent = `Restoring emotes... (${i + 1}/${emotes.length})`;
            await new Promise(r => setTimeout(r, 10));
          }
        }
      } catch (e) { console.warn('Could not restore emotes:', e); }
    }

    progressText.textContent = 'Restoring positions...';
    progressFill.style.width = '85%';

    if (backupData.data.localStorage) {
      try {
        Object.entries(backupData.data.localStorage).forEach(([key, value]) => {
          if (key.startsWith('mojify-suggestion-pos-')) localStorage.setItem(key, value);
        });
      } catch (e) { console.warn('Could not restore localStorage:', e); }
    }

    progressText.textContent = 'Finalizing...';
    progressFill.style.width = '95%';

    await new Promise((resolve) => {
      chrome.storage.local.set({ restorationComplete: true, lastRestoreTime: Date.now(), skipNextDownload: true }, resolve);
    });

    // Rebuild emoteMapping
    if (backupData.data.indexedDBEmotes?.length > 0) {
      const newEmoteMapping = {};
      backupData.data.indexedDBEmotes.forEach(emote => {
        if (emote.key && emote.url) newEmoteMapping[emote.key] = emote.url;
      });
      await new Promise((resolve) => {
        chrome.storage.local.set({ emoteMapping: newEmoteMapping }, resolve);
      });
    }

    progressText.textContent = 'Restore completed!';
    progressFill.style.width = '100%';
    setStatus(`Restored ${emoteCount} emotes, ${channelCount} channels.`, 'success');

    setTimeout(() => {
      progressContainer.classList.add('hidden');
      progressFill.style.width = '0%';
      chrome.storage.local.remove(['skipNextDownload']);
    }, 2000);

  } catch (error) {
    console.error('Restore failed:', error);
    setStatus('Restore failed: ' + error.message, 'error');
    progressContainer.classList.add('hidden');
    progressFill.style.width = '0%';
  }

  event.target.value = '';
}

// ── Source Links ──────────────────────────────────────────────

const SOURCE_BACKUP_TYPE = 'mojify-source-backup';
const SOURCE_BACKUP_VERSION = 1;

function createSourceMap() {
  const sourcesByKey = new Map();
  return {
    add(source) {
      const normalized = normalizeBackupSource(source);
      const key = getBackupSourceKey(normalized);
      if (!key) return;
      const existing = sourcesByKey.get(key) || {};
      sourcesByKey.set(key, {
        ...existing,
        ...Object.fromEntries(
          Object.entries(normalized).filter(([, v]) => v !== undefined && v !== null && v !== '')
        )
      });
    },
    values() { return Array.from(sourcesByKey.values()); }
  };
}

function getBackupSourceKey(source) {
  const site = String(source?.site || '').toLowerCase();
  if (site === 'telegram') return source.setName ? `telegram:${source.setName.toLowerCase()}` : '';
  if (site === '7tv') return source.setId ? `7tv:${source.setId.toLowerCase()}` : '';
  if (site === 'discord') return source.serverId ? `discord:${source.serverId}` : '';
  if (site === 'twitch') {
    const id = source.id || source.channelId || source.username;
    return id ? `twitch:${String(id).toLowerCase()}` : '';
  }
  return '';
}

function cleanString(value) { return String(value || '').trim(); }

function cleanTelegramSetName(value) {
  const text = cleanString(value);
  const linkMatch = text.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/add(?:stickers|emoji)\/([A-Za-z][A-Za-z0-9_]{0,63})/i);
  if (linkMatch) return linkMatch[1];
  return text.replace(/^telegram:/i, '');
}

function normalizeBackupSource(source) {
  if (!source || typeof source !== 'object') return {};
  const site = String(source.site || source.provider || source.source || '').toLowerCase();
  const type = String(source.type || '').toLowerCase();

  if (site === 'telegram' || type.includes('telegram') || source.telegramStickerSetName) {
    const setName = cleanTelegramSetName(source.setName || source.telegramStickerSetName || source.name || source.id || source.link);
    return { site: 'telegram', type: 'sticker-set', setName, title: source.title || source.telegramStickerSetTitle || source.username || source.name || setName, link: source.link || (setName ? `https://t.me/addstickers/${setName}` : '') };
  }

  if (site === '7tv' || type === '7tv-set' || type === 'emote-set' || source.setId || source.emoteSetId) {
    const setId = cleanString(source.setId || source.emoteSetId || source.id);
    return { site: '7tv', type: 'emote-set', setId, setName: cleanString(source.setName || source.emoteSetName || source.name), channelId: cleanString(source.channelId || source.parentChannelId || source.platformChannelId), username: cleanString(source.username || source.baseUsername), sevenTvUserId: cleanString(source.sevenTvUserId), activeSetId: cleanString(source.activeSetId), link: setId ? `https://7tv.app/emote-sets/${setId}` : '' };
  }

  if (site === 'discord' || type.includes('discord') || source.discordGuildId || source.serverId || source.guildId) {
    const serverId = cleanString(source.serverId || source.discordGuildId || source.guildId || source.id);
    return { site: 'discord', type: 'server', serverId, serverName: cleanString(source.serverName || source.discordGuildName || source.guildName || source.username || source.name), link: source.link || (serverId ? `https://discord.com/channels/${serverId}` : '') };
  }

  const id = cleanString(source.id || source.channelId || source.platformChannelId || source.username || source.name);
  return { site: 'twitch', type: 'channel', id, username: cleanString(source.username || source.baseUsername || source.name), link: source.link || (source.username ? `https://www.twitch.tv/${source.username}` : '') };
}

function getChannelSourceType(channel) {
  if (!channel) return 'twitch';
  const id = String(channel.id || '');
  if (id.startsWith('telegram:') || channel.telegramStickerSetName) return 'telegram';
  if (id.startsWith('discord:') || channel.discordGuildId || channel.guildId) return 'discord';
  if (id.startsWith('7tv-set:') || channel.emoteSetId || channel.parentChannelId || channel.platformChannelId) return '7tv';
  return 'twitch';
}

function is7TVSetChannel(channel) {
  if (!channel) return false;
  const id = String(channel.id || '');
  if (id.startsWith('7tv-set:')) return true;
  if (channel.emoteSetId || channel.parentChannelId || channel.platformChannelId) return true;
  return false;
}

function dedupeChannelIds(channelIds) {
  const seen = new Set();
  return (channelIds || [])
    .map(id => String(id).trim().toLowerCase())
    .filter(id => { if (!id || seen.has(id)) return false; seen.add(id); return true; });
}

function dedupeChannelsById(channelList) {
  const seen = new Set();
  return (channelList || []).filter(channel => {
    const id = String(channel.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function resolveTwitchIdentifiers(identifiers) {
  const usernames = [];
  const ids = [];
  identifiers.forEach((value) => {
    const trimmed = String(value).trim();
    if (!trimmed) return;
    if (/^\d+$/.test(trimmed)) ids.push(trimmed);
    else usernames.push(trimmed.toLowerCase());
  });

  const convertedIds = [...ids];
  if (usernames.length === 0) return convertedIds;

  const { apiKeys = {} } = await new Promise((resolve) => {
    chrome.storage.local.get(['apiKeys'], resolve);
  });

  const clientId = apiKeys.twitchClientId;
  const clientSecret = apiKeys.twitchClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Missing Twitch API credentials. Add them above to resolve usernames.');
  }

  const tokenResponse = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!tokenResponse.ok) throw new Error('Could not authenticate with Twitch API');

  const tokenPayload = await tokenResponse.json();
  const accessToken = tokenPayload.access_token;

  const resolvedUsernames = new Set();
  const batchSize = 100;
  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    const query = batch.map((name) => `login=${encodeURIComponent(name)}`).join('&');
    const response = await fetch(`https://api.twitch.tv/helix/users?${query}`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-Id': clientId }
    });
    if (!response.ok) throw new Error('Failed to convert usernames to IDs');
    const payload = await response.json();
    (payload?.data || []).forEach((user) => {
      if (user?.id) {
        convertedIds.push(user.id);
        if (user.login) resolvedUsernames.add(user.login.toLowerCase());
      }
    });
  }

  const unresolved = usernames.filter((name) => !resolvedUsernames.has(name));
  if (unresolved.length > 0) {
    const preview = unresolved.slice(0, 3).join(', ');
    throw new Error(`Could not resolve Twitch username${unresolved.length > 1 ? 's' : ''}: ${preview}`);
  }

  return convertedIds;
}

async function buildSourceBackupPayload() {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(['channelIds', 'channels', 'mojifySourceBackupDiscordServers'], resolve);
  });
  const sourceMap = createSourceMap();

  dedupeChannelIds(stored.channelIds || []).forEach((channelId) => {
    sourceMap.add({ site: 'twitch', type: 'channel', id: channelId });
  });

  dedupeChannelsById(stored.channels || []).forEach((channel) => {
    const sourceType = getChannelSourceType(channel);
    if (sourceType === 'telegram') {
      const setName = cleanTelegramSetName(channel.telegramStickerSetName || String(channel.id || '').replace(/^telegram:/i, ''));
      sourceMap.add({ site: 'telegram', type: 'sticker-set', setName, title: channel.telegramStickerSetTitle || channel.username || setName, link: channel.telegramStickerSetLink || (setName ? `https://t.me/addstickers/${setName}` : '') });
      return;
    }
    if (sourceType === 'discord') {
      const serverId = cleanString(channel.discordGuildId || channel.guildId || channel.id);
      sourceMap.add({ site: 'discord', type: 'server', serverId, serverName: channel.discordGuildName || channel.guildName || channel.username || serverId, link: channel.discordGuildLink || (serverId ? `https://discord.com/channels/${serverId}` : '') });
      return;
    }
    if (sourceType !== 'twitch') return;
    if (is7TVSetChannel(channel)) {
      const setId = cleanString(channel.emoteSetId || String(channel.id || '').replace(/^7tv-set:/i, ''));
      sourceMap.add({ site: '7tv', type: 'emote-set', setId, setName: channel.emoteSetName || channel.username || setId, channelId: channel.parentChannelId || channel.platformChannelId || '', username: channel.baseUsername || channel.username || '', sevenTvUserId: channel.sevenTvUserId || '', activeSetId: channel.activeSetId || '', link: setId ? `https://7tv.app/emote-sets/${setId}` : '' });
      return;
    }
    sourceMap.add({ site: 'twitch', type: 'channel', id: channel.platformChannelId || channel.id, username: channel.baseUsername || channel.username || '', link: channel.baseUsername || channel.username ? `https://www.twitch.tv/${channel.baseUsername || channel.username}` : '' });
  });

  (stored.mojifySourceBackupDiscordServers || []).forEach((server) => {
    sourceMap.add({ site: 'discord', type: 'server', serverId: server.serverId || server.id, serverName: server.serverName || server.name, link: server.link });
  });

  const sources = sourceMap.values();
  const links = sources.map((source) => source.link || source.id || source.serverId || source.setName || source.setId).filter(Boolean);

  return { type: SOURCE_BACKUP_TYPE, version: SOURCE_BACKUP_VERSION, app: 'Mojify', exportedAt: new Date().toISOString(), sources, links };
}

function parseSourceBackupText(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return {
      type: SOURCE_BACKUP_TYPE, version: SOURCE_BACKUP_VERSION,
      sources: trimmed.split(/\r?\n/).map((line) => parseSourceBackupLine(line)).filter(Boolean)
    };
  }
}

function parseSourceBackupLine(line) {
  const value = cleanString(line).replace(/^[-*]\s+/, '').replace(/^[`"']+|[`"',]+$/g, '').trim();
  if (!value || value.startsWith('#')) return null;

  const telegramMatch = value.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/add(?:stickers|emoji)\/([A-Za-z][A-Za-z0-9_]{0,63})/i) || value.match(/^telegram:([A-Za-z][A-Za-z0-9_]{0,63})$/i);
  if (telegramMatch) return { site: 'telegram', type: 'sticker-set', setName: telegramMatch[1], link: `https://t.me/addstickers/${telegramMatch[1]}` };

  const sevenTvMatch = value.match(/(?:https?:\/\/)?(?:www\.)?7tv\.app\/emote-sets\/([A-Za-z0-9]+)/i) || value.match(/^7tv-set:([A-Za-z0-9]+)$/i);
  if (sevenTvMatch) return { site: '7tv', type: 'emote-set', setId: sevenTvMatch[1], link: `https://7tv.app/emote-sets/${sevenTvMatch[1]}` };

  const discordMatch = value.match(/(?:https?:\/\/)?(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/([^/\s]+)/i) || value.match(/^discord:([^/\s]+)$/i);
  if (discordMatch) return { site: 'discord', type: 'server', serverId: discordMatch[1], link: `https://discord.com/channels/${discordMatch[1]}` };

  const twitchMatch = value.match(/(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([A-Za-z0-9_]{1,25})/i) || value.match(/^twitch:([A-Za-z0-9_]{1,25}|\d+)$/i);
  return { site: 'twitch', type: 'channel', id: twitchMatch ? twitchMatch[1] : value };
}

function collectRestoreSources(payload) {
  const sourceMap = createSourceMap();
  const entries = [];

  if (Array.isArray(payload)) {
    entries.push(...payload);
  } else if (payload?.sources) {
    if (Array.isArray(payload.sources)) {
      entries.push(...payload.sources);
    } else if (typeof payload.sources === 'object') {
      Object.entries(payload.sources).forEach(([site, value]) => {
        const list = Array.isArray(value) ? value : [value];
        list.forEach((entry) => {
          if (typeof entry === 'object') entries.push({ site, ...entry });
          else {
            if (site === 'telegram') entries.push({ site, type: 'sticker-set', setName: entry });
            else if (site === '7tv') entries.push({ site, type: 'emote-set', setId: entry });
            else if (site === 'discord') entries.push({ site, type: 'server', serverId: entry });
            else entries.push(entry);
          }
        });
      });
    }
  }

  if (Array.isArray(payload?.links)) entries.push(...payload.links);
  entries.forEach((entry) => sourceMap.add(typeof entry === 'string' ? parseSourceBackupLine(entry) : entry));

  const restoreSources = { twitchChannels: [], sevenTvSets: [], telegramSets: [], discordServers: [] };
  sourceMap.values().forEach((source) => {
    if (source.site === 'telegram' && source.setName) restoreSources.telegramSets.push(source);
    else if (source.site === '7tv' && source.setId) restoreSources.sevenTvSets.push(source);
    else if (source.site === 'discord' && source.serverId) restoreSources.discordServers.push(source);
    else if (source.site === 'twitch' && (source.id || source.username)) restoreSources.twitchChannels.push(source);
  });
  return restoreSources;
}

function mergeDiscordSourceLinks(existingServers, restoredServers) {
  const byId = new Map();
  [...(existingServers || []), ...(restoredServers || [])].forEach((server) => {
    const serverId = cleanString(server.serverId || server.discordGuildId || server.id);
    if (!serverId) return;
    byId.set(serverId, {
      serverId,
      serverName: cleanString(server.serverName || server.discordGuildName || server.name),
      link: server.link || `https://discord.com/channels/${serverId}`
    });
  });
  return Array.from(byId.values());
}

async function applySourceBackupSources(restoreSources) {
  const result = { twitchChannels: 0, sevenTvSets: 0, telegramSets: 0, discordServers: 0, errors: [] };

  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(['channelIds', 'mojifySourceBackupDiscordServers'], resolve);
  });

  const rawTwitchIds = dedupeChannelIds(
    restoreSources.twitchChannels.map((source) => source.id || source.channelId || source.username).filter(Boolean)
  );
  let resolvedTwitchIds = [];

  if (rawTwitchIds.length > 0) {
    try {
      resolvedTwitchIds = await resolveTwitchIdentifiers(rawTwitchIds);
    } catch (error) {
      resolvedTwitchIds = rawTwitchIds.filter((value) => /^\d+$/.test(value));
      result.errors.push(error.message || 'Some Twitch usernames could not be resolved');
    }
  }

  const mergedChannelIds = dedupeChannelIds([...(stored.channelIds || []), ...resolvedTwitchIds]);
  const storedDiscordServers = mergeDiscordSourceLinks(stored.mojifySourceBackupDiscordServers || [], restoreSources.discordServers);

  await new Promise((resolve) => {
    chrome.storage.local.set({ channelIds: mergedChannelIds, mojifySourceBackupDiscordServers: storedDiscordServers }, resolve);
  });

  result.twitchChannels = resolvedTwitchIds.length;
  result.discordServers = restoreSources.discordServers.length;

  const downloadSources = [
    ...resolvedTwitchIds.map((channelId) => ({ type: 'twitch-channel', channelId })),
    ...restoreSources.sevenTvSets.map((source) => ({
      type: '7tv-set', channelId: source.channelId || '', setId: source.setId,
      setName: source.setName || '', username: source.username || '', sevenTvUserId: source.sevenTvUserId || '', activeSetId: source.activeSetId || ''
    }))
  ];

  if (downloadSources.length > 0) {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'downloadEmotes', options: { sources: downloadSources } }, resolve);
      });
      if (!response?.success) throw new Error(response?.error || '7TV restore failed');
      result.sevenTvSets = restoreSources.sevenTvSets.length;
    } catch (error) {
      result.errors.push(error.message || '7TV restore failed');
    }
  }

  for (const source of restoreSources.telegramSets) {
    try {
      const stickerSet = source.link || source.setName;
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'importTelegramStickerSet', stickerSet }, resolve);
      });
      if (!response?.success) throw new Error(response?.error || `Telegram restore failed for ${source.setName}`);
      result.telegramSets += 1;
    } catch (error) {
      result.errors.push(error.message || `Telegram restore failed for ${source.setName}`);
    }
  }

  return result;
}

async function copyCurrentSourcesToClipboard() {
  const payload = await buildSourceBackupPayload();
  const text = JSON.stringify(payload, null, 2);
  const textarea = document.getElementById('source-backup-text');
  if (textarea) textarea.value = text;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement('textarea');
      temp.value = text; temp.setAttribute('readonly', '');
      temp.style.cssText = 'position:fixed;opacity:0;left:-9999px;';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
    }
    setStatus(`Copied ${payload.sources.length} source(s) to clipboard.`, 'success');
  } catch (error) {
    setStatus('Copy failed: ' + error.message, 'error');
  }
}

async function restoreSourcesFromPaste() {
  const textarea = document.getElementById('source-backup-text');
  let text = textarea?.value.trim() || '';

  if (!text) {
    try {
      text = await navigator.clipboard?.readText?.() || '';
      if (text && textarea) textarea.value = text;
    } catch { /* ignore */ }
  }

  if (!text) {
    setStatus('Paste source JSON or links first.', 'error');
    return;
  }

  try {
    const parsed = parseSourceBackupText(text);
    const restoreSources = collectRestoreSources(parsed);
    const totalSources = restoreSources.twitchChannels.length + restoreSources.sevenTvSets.length + restoreSources.telegramSets.length + restoreSources.discordServers.length;

    if (totalSources === 0) {
      setStatus('No Mojify source links or channel IDs found.', 'error');
      return;
    }

    const result = await applySourceBackupSources(restoreSources);
    const parts = [];
    if (result.twitchChannels > 0) parts.push(`${result.twitchChannels} Twitch channel${result.twitchChannels === 1 ? '' : 's'}`);
    if (result.sevenTvSets > 0) parts.push(`${result.sevenTvSets} 7TV set${result.sevenTvSets === 1 ? '' : 's'}`);
    if (result.telegramSets > 0) parts.push(`${result.telegramSets} Telegram pack${result.telegramSets === 1 ? '' : 's'}`);
    if (result.discordServers > 0) parts.push(`${result.discordServers} Discord server link${result.discordServers === 1 ? '' : 's'}`);

    if (result.errors.length > 0) {
      setStatus(`Restored ${parts.join(', ') || 'sources'}; ${result.errors.length} need attention`, 'error');
      return;
    }
    setStatus(`Restored ${parts.join(', ')}.`, 'success');
  } catch (error) {
    setStatus('Source restore failed: ' + error.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadApiKeys();

  document.getElementById('save-api-keys').addEventListener('click', saveApiKeys);
  document.getElementById('copy-api-keys').addEventListener('click', copyApiKeysJson);
  document.getElementById('export-api-keys').addEventListener('click', exportApiKeys);
  document.getElementById('import-api-keys').addEventListener('click', importApiKeysFromText);

  Object.values(API_KEY_FIELDS).forEach((elementId) => {
    document.getElementById(elementId).addEventListener('input', () => {
      updateConfiguredCount();
      setStatus('');
    });
  });

  document.getElementById('import-api-keys-text').addEventListener('input', () => {
    setStatus('');
  });

  // Backup / Restore wiring
  const createBackupBtn = document.getElementById('create-backup');
  const restoreBackupBtn = document.getElementById('restore-backup');
  const restoreFileInput = document.getElementById('restore-file');
  if (createBackupBtn && restoreBackupBtn && restoreFileInput) {
    createBackupBtn.addEventListener('click', createBackup);
    restoreBackupBtn.addEventListener('click', () => restoreFileInput.click());
    restoreFileInput.addEventListener('change', handleRestoreFile);
  }

  const copySourceBtn = document.getElementById('copy-source-backup');
  const pasteSourceBtn = document.getElementById('paste-source-backup');
  if (copySourceBtn) copySourceBtn.addEventListener('click', copyCurrentSourcesToClipboard);
  if (pasteSourceBtn) pasteSourceBtn.addEventListener('click', restoreSourcesFromPaste);
});
