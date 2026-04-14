const STORAGE_KEY = 'apiKeys';

function setStatus(message, type = '') {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.className = `status${type ? ` ${type}` : ''}`;
}

function loadApiKeys() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const apiKeys = result[STORAGE_KEY] || {};
    document.getElementById('tenor-api-key').value = apiKeys.tenor || '';
    document.getElementById('giphy-api-key').value = apiKeys.giphy || '';
    document.getElementById('klipy-api-key').value = apiKeys.klipy || '';
    document.getElementById('pixabay-api-key').value = apiKeys.pixabay || '';
  });
}

function saveApiKeys() {
  const tenorKey = document.getElementById('tenor-api-key').value.trim();
  const giphyKey = document.getElementById('giphy-api-key').value.trim();
  const klipyKey = document.getElementById('klipy-api-key').value.trim();
  const pixabayKey = document.getElementById('pixabay-api-key').value.trim();

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const apiKeys = result[STORAGE_KEY] || {};
    apiKeys.tenor = tenorKey;
    apiKeys.giphy = giphyKey;
    apiKeys.klipy = klipyKey;
    apiKeys.pixabay = pixabayKey;

    chrome.storage.local.set({ [STORAGE_KEY]: apiKeys }, () => {
      if (chrome.runtime.lastError) {
        setStatus(`Failed to save: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }
      setStatus('API keys saved.', 'success');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadApiKeys();
  document.getElementById('save-api-keys').addEventListener('click', saveApiKeys);
});
