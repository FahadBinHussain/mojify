const STORAGE_KEY = 'apiKeys';
const API_KEY_FIELDS = {
  tenor: 'tenor-api-key',
  giphy: 'giphy-api-key',
  klipy: 'klipy-api-key',
  pixabay: 'pixabay-api-key',
  twitchClientId: 'twitch-client-id',
  twitchClientSecret: 'twitch-client-secret'
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
});
