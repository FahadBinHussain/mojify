// Options page logic
// Single master backup/restore: everything (apiKeys, chromeStorage, localStorage)
// No separate Transfer/Source Links panels — everything lives in one master JSON.
//
// Media blobs are NOT embedded: they live in the `MojifyEmotes` IndexedDB
// (`emoteBlobs` + `emoteMetadata`, popup.js/background.js) and this library is
// ~1.8 GB — a JSON file cannot carry that. The backup stores the full listing
// instead (channels, per-emote source URLs, emoteMapping, triggerToStorageKey)
// and a restore re-downloads the media through the normal background pipeline.

/* ═══════════════════════════════════════════════
   Master Backup & Restore
   ═══════════════════════════════════════════════ */
async function createBackup() {
  const chromeStorage = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
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
    version: '3.0',
    exportedAt: new Date().toISOString(),
    data: {
      apiKeys: chromeStorage.apiKeys || {},
      chromeStorage,
      localStorage: localStorageData,
      media: {
        included: false,
        emotesListed: Object.keys(chromeStorage.emoteMapping || {}).length,
        reason: 'Media blobs stay in IndexedDB; a restore re-downloads them from the source URLs stored above.'
      }
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
    // these gate the re-download below — a restore must never trip them
    delete store.skipNextDownload;
    delete store.lastRestoreTime;
    delete store.manualRefresh;
    delete store.downloadInProgress;
    await new Promise((resolve) => chrome.storage.local.set(store, resolve));
  }

  // ── Legacy v2.0 media section: written from a database nothing reads ──
  // (it was always empty; the media was never in any backup). Loud, not silent.
  const legacyRecords = Array.isArray(data.indexedDBEmotes) ? data.indexedDBEmotes.length : 0;
  if (legacyRecords > 0) {
    console.warn(`[Mojify] ignoring ${legacyRecords} legacy emote records from backup v2.0 (wrong database)`);
  }

  // ── localStorage ──
  if (data.localStorage && typeof data.localStorage === 'object') {
    Object.keys(data.localStorage).forEach((k) => {
      localStorage.setItem(k, data.localStorage[k]);
    });
  }

  // refresh UI inputs after restore
  loadApiKeys();

  const listed = Object.keys((data.chromeStorage && data.chromeStorage.emoteMapping) || {}).length;
  startMediaRedownload();
  showStatus(
    `Restore complete — ${listed} emotes listed. Media files are not stored in backups, ` +
    'so 7TV/Twitch media is re-downloading now (it keeps going if you close this page). ' +
    'Discord/Telegram media needs the popup\'s Refresh All with those sites open.' +
    (legacyRecords > 0 ? ` (${legacyRecords} legacy media records skipped — old format).` : ''),
    'success',
    20000
  );
}

// Kick the normal background download pipeline. It only re-fetches media that
// is missing from IndexedDB, so restoring a backup onto a profile that already
// has the files costs nothing. The background derives the source list from the
// restored channel listing (bare downloadEmotes only knows Twitch channelIds,
// which most setups leave empty).
function startMediaRedownload() {
  // `manualRefresh` is the background's one-shot "don't skip this run" flag
  // (background.js removes it once honored).
  chrome.storage.local.set({ manualRefresh: true }, () => {
    chrome.runtime.sendMessage({ action: 'redownloadMissingMedia' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus(
          `Restore done, but the media re-download could not start: ${chrome.runtime.lastError.message}. ` +
          'Open the popup and click Refresh All.',
          'error',
          20000
        );
        return;
      }
      if (!response || response.success === false) {
        showStatus(
          `Restore done, but the media re-download failed: ${(response && response.error) || 'unknown error'}. ` +
          'Open the popup and click Refresh All.',
          'error',
          20000
        );
      } else if (response.result && response.result.message === 'All emotes up to date') {
        showStatus('Restore complete — every media file was already present, nothing to re-download.', 'success');
      }
    });
  });
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
function showStatus(message, type = 'info', durationMs = 5000) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, durationMs);
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
