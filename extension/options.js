// Options page logic
// Single master backup/restore: everything (apiKeys, chromeStorage, indexedDBEmotes, localStorage, sourceLinks)
// No separate Transfer/Source Links panels — everything lives in one master JSON.

/* ═══════════════════════════════════════════════
   emoteDB wrapper (mirrors popup.js for consistency)
   ═══════════════════════════════════════════════ */
const emoteDB = (function () {
  const DB_NAME = 'EmoteExtensionDB';
  const STORE = 'emotes';
  const DB_VERSION = 1;
  let db = null;

  async function ensureOpen() {
    if (db) return db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  async function getAllEmotes() {
    const d = await ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = d.transaction([STORE], 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAllEmotes() {
    const d = await ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = d.transaction([STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function saveEmotes(emotes) {
    await clearAllEmotes();
    const d = await ensureOpen();
    const tx = d.transaction([STORE], 'readwrite');
    const store = tx.objectStore(STORE);
    for (const emote of emotes) {
      const clone = { ...emote };
      delete clone.id; // let autoIncrement assign
      store.add(clone);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { getAllEmotes, clearAllEmotes, saveEmotes };
})();

/* ═══════════════════════════════════════════════
   Master Backup & Restore
   ═══════════════════════════════════════════════ */
async function createBackup() {
  const chromeStorage = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
  const indexedDBEmotes = await emoteDB.getAllEmotes();
  const localStorageData = { ...localStorage };

  // remove runtime / transient keys
  delete localStorageData['mojify_backup_token'];
  delete localStorageData['mojify_import_token'];
  delete localStorageData['mojify_last_backup'];
  delete localStorageData['mojify_backup_in_progress'];
  delete localStorageData['mojify_current_backup_sources'];
  delete localStorageData['mojify_import_sources'];
  delete localStorageData['mojify_import_stats'];
  delete localStorageData['mojify_import_start_time'];
  delete localStorageData['mojify_last_import_time'];

  return {
    type: 'mojify-backup',
    version: '2.0',
    exportedAt: new Date().toISOString(),
    data: {
      apiKeys: chromeStorage.apiKeys || {},
      chromeStorage,
      indexedDBEmotes,
      localStorage: localStorageData
    }
  };
}

async function downloadBackup() {
  try {
    const payload = await createBackup();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mojify-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Backup downloaded successfully.', 'success');
  } catch (err) {
    showStatus(`Backup failed: ${err.message}`, 'error');
  }
}

async function copyBackupToClipboard() {
  try {
    const payload = await createBackup();
    const json = JSON.stringify(payload, null, 2);
    await navigator.clipboard.writeText(json);
    showStatus('Backup copied to clipboard.', 'success');
  } catch (err) {
    showStatus(`Copy failed: ${err.message}`, 'error');
  }
}

async function restoreBackup(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid backup JSON');

  // accept both wrapped {type,version,data} and flat legacy dumps
  let data = raw.data || raw;

  // ── API keys ──
  if (data.apiKeys && typeof data.apiKeys === 'object') {
    await new Promise((resolve) => {
      chrome.storage.local.set({ apiKeys: data.apiKeys }, resolve);
    });
  }

  // ── Chrome storage (everything) ──
  if (data.chromeStorage && typeof data.chromeStorage === 'object') {
    const store = { ...data.chromeStorage };
    // avoid overwriting the just-restored apiKeys with stale empty defaults
    if (data.apiKeys) delete store.apiKeys;
    await new Promise((resolve) => chrome.storage.local.set(store, resolve));
  }

  // ── IndexedDB emotes ──
  if (Array.isArray(data.indexedDBEmotes)) {
    await emoteDB.saveEmotes(data.indexedDBEmotes);
  }

  // ── localStorage ──
  if (data.localStorage && typeof data.localStorage === 'object') {
    Object.keys(data.localStorage).forEach((k) => {
      localStorage.setItem(k, data.localStorage[k]);
    });
  }

  // refresh UI inputs after restore
  loadApiKeys();
  showStatus('Restore completed successfully. Reload the extension if needed.', 'success');
}

async function handleRestoreFile(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    await restoreBackup(json);
  } catch (err) {
    showStatus(`Restore failed: ${err.message}`, 'error');
  }
}

async function restoreFromPaste() {
  const ta = document.getElementById('backup-paste-area');
  if (!ta) return;
  try {
    const json = JSON.parse(ta.value);
    await restoreBackup(json);
    ta.value = '';
  } catch (err) {
    showStatus(`Paste restore failed: ${err.message}`, 'error');
  }
}

/* ═══════════════════════════════════════════════
   Status helper
   ═══════════════════════════════════════════════ */
function showStatus(message, type = 'info') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ═══════════════════════════════════════════════
   API Key Management
   ═══════════════════════════════════════════════ */
const API_KEY_MAP = [
  { id: 'tenor-api-key',      key: 'tenor' },
  { id: 'giphy-api-key',      key: 'giphy' },
  { id: 'klipy-api-key',      key: 'klipy' },
  { id: 'pixabay-api-key',    key: 'pixabay' },
  { id: 'twitch-client-id',   key: 'twitchClientId' },
  { id: 'twitch-client-secret', key: 'twitchClientSecret' },
  { id: 'telegram-bot-token', key: 'telegramBotToken' },
];

function loadApiKeys() {
  chrome.storage.local.get(['apiKeys'], (result) => {
    const keys = result.apiKeys || {};
    API_KEY_MAP.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (el) el.value = keys[key] || '';
    });
  });
}

function saveApiKeys() {
  const keys = {};
  API_KEY_MAP.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) keys[key] = el.value.trim();
  });
  chrome.storage.local.set({ apiKeys: keys }, () => {
    showStatus('API keys saved.', 'success');
  });
}

/* ═══════════════════════════════════════════════
   DOM wiring
   ═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadApiKeys();

  // Save API keys
  const saveBtn = document.getElementById('save-api-keys');
  if (saveBtn) saveBtn.addEventListener('click', saveApiKeys);

  // ── Master Backup ──
  const dlBtn = document.getElementById('download-backup');
  if (dlBtn) dlBtn.addEventListener('click', downloadBackup);

  const copyBtn = document.getElementById('copy-backup');
  if (copyBtn) copyBtn.addEventListener('click', copyBackupToClipboard);

  const uploadInput = document.getElementById('upload-backup');
  if (uploadInput) {
    uploadInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleRestoreFile(file);
      uploadInput.value = '';
    });
  }

  const restoreBtn = document.getElementById('restore-pasted-backup');
  if (restoreBtn) restoreBtn.addEventListener('click', restoreFromPaste);

  // hidden file-input trigger via visible button
  const uploadBtn = document.getElementById('restore-backup-btn');
  if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', () => uploadInput.click());
  }
});
