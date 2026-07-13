let pollInterval = null;
let lastState = null;

async function fetchDashboardState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDashboardState' });
    if (response?.success) {
      lastState = response;
      renderDashboard(response);
    }
  } catch (e) {
    console.error('[Dashboard] fetch error:', e);
  }
}

function renderDashboard(state) {
  renderStats(state);
  renderActiveOps(state);
  renderPlatforms(state);
  renderFailures(state);
}

function renderStats(state) {
  document.getElementById('stat-emote-count').textContent = formatNumber(state.emoteCount);
  document.getElementById('stat-channel-count').textContent = formatNumber(state.channelCount);
  document.getElementById('stat-mapping-count').textContent = formatNumber(state.mappingCount);

  const failedCount = state.failedEmotes.length + state.failedBlobCount;
  document.getElementById('stat-failed-count').textContent = formatNumber(failedCount);

  const tile = document.getElementById('tile-failures');
  tile.style.borderColor = failedCount > 0 ? 'rgba(255, 147, 172, 0.3)' : 'var(--stroke)';
}

function renderActiveOps(state) {
  const opsSection = document.getElementById('active-ops');
  const opsBody = document.getElementById('active-ops-body');
  const ops = [];

  if (state.download.isDownloading) {
    const pct = state.download.total > 0 ? (state.download.current / state.download.total) * 100 : 0;
    ops.push(`
      <div class="op-card">
        <div class="op-header">
          <span class="op-label"><i class="fas fa-download"></i> Downloading</span>
          <span class="op-detail">${state.download.current} / ${state.download.total}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
      </div>
    `);
  }

  if (state.retry.isRetrying) {
    const pct = state.retry.total > 0 ? (state.retry.current / state.retry.total) * 100 : 0;
    ops.push(`
      <div class="op-card">
        <div class="op-header">
          <span class="op-label"><i class="fas fa-redo"></i> Background Retry</span>
          <span class="op-detail">${state.retry.current} / ${state.retry.total}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill warn" style="width: ${pct}%"></div></div>
      </div>
    `);
  }

  if (state.discord.isImporting) {
    const pct = state.discord.total > 0 ? (state.discord.current / state.discord.total) * 100 : 0;
    ops.push(`
      <div class="op-card">
        <div class="op-header">
          <span class="op-label"><i class="fab fa-discord"></i> Discord Import — ${escapeHtml(state.discord.guildName || '')}</span>
          <span class="op-detail">${state.discord.current} / ${state.discord.total}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
      </div>
    `);
  }

  if (state.telegram.isImporting) {
    const pct = state.telegram.total > 0 ? (state.telegram.current / state.telegram.total) * 100 : 0;
    ops.push(`
      <div class="op-card">
        <div class="op-header">
          <span class="op-label"><i class="fab fa-telegram"></i> Telegram Import — ${escapeHtml(state.telegram.setTitle || '')}</span>
          <span class="op-detail">${state.telegram.current} / ${state.telegram.total}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
      </div>
    `);
  }

  if (state.sevenTv.isImporting) {
    ops.push(`
      <div class="op-card">
        <div class="op-header">
          <span class="op-label"><i class="fas fa-cloud-download-alt"></i> 7TV Import — ${escapeHtml(state.sevenTv.username || '')}</span>
          <span class="op-detail">In progress...</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width: 100%; animation: pulse 1.5s infinite"></div></div>
      </div>
    `);
  }

  if (ops.length > 0) {
    opsBody.innerHTML = ops.join('');
    opsSection.classList.remove('hidden');
  } else {
    opsSection.classList.add('hidden');
  }
}

function renderPlatforms(state) {
  renderTwitch(state.channels.twitch);
  renderDiscord(state.channels.discord);
  renderTelegram(state.channels.telegram);
}

function renderTwitch(channels) {
  const summary = document.getElementById('twitch-summary');
  const list = document.getElementById('twitch-list');

  const parents = channels.filter(c => !c.isEmoteSet);
  const sets = channels.filter(c => c.isEmoteSet);
  const totalEmotes = channels.reduce((sum, c) => sum + c.emoteCount, 0);

  summary.innerHTML = `
    <span class="summary-pill"><strong>${parents.length}</strong> channels</span>
    <span class="summary-pill"><strong>${sets.length}</strong> sets</span>
    <span class="summary-pill"><strong>${formatNumber(totalEmotes)}</strong> emotes</span>
  `;

  if (channels.length === 0) {
    list.innerHTML = '<div class="empty-state">No Twitch sources imported</div>';
    return;
  }

  const parentsById = new Map(parents.map(p => [p.id, p]));
  const rows = [];

  for (const parent of parents) {
    const childSets = sets.filter(s => s.parentChannelId === parent.id);
    const parentEmotes = childSets.reduce((sum, s) => sum + s.emoteCount, 0);
    rows.push(renderSourceRow(parent.username || parent.id, parentEmotes, 'active', false));

    for (const set of childSets) {
      const badge = set.emoteCount === 0 ? 'empty' : 'set';
      rows.push(renderSourceRow(set.emoteSetName || set.id, set.emoteCount, badge, true));
    }
  }

  const orphanSets = sets.filter(s => !parentsById.has(s.parentChannelId));
  for (const set of orphanSets) {
    const badge = set.emoteCount === 0 ? 'empty' : 'set';
    rows.push(renderSourceRow(set.emoteSetName || set.id, set.emoteCount, badge, false));
  }

  list.innerHTML = rows.join('');
}

function renderDiscord(channels) {
  const summary = document.getElementById('discord-summary');
  const list = document.getElementById('discord-list');

  const parents = channels.filter(c => !c.isEmoteSet);
  const sets = channels.filter(c => c.isEmoteSet);
  const totalItems = channels.reduce((sum, c) => sum + c.emoteCount, 0);

  summary.innerHTML = `
    <span class="summary-pill"><strong>${parents.length}</strong> guilds</span>
    <span class="summary-pill"><strong>${formatNumber(totalItems)}</strong> items</span>
  `;

  if (channels.length === 0) {
    list.innerHTML = '<div class="empty-state">No Discord sources imported</div>';
    return;
  }

  const rows = [];
  for (const parent of parents) {
    const childSets = sets.filter(s => s.parentChannelId === parent.id);
    const parentItems = childSets.reduce((sum, s) => sum + s.emoteCount, 0);
    rows.push(renderSourceRow(parent.discordGuildName || parent.username || parent.id, parentItems, 'active', false));

    for (const set of childSets) {
      rows.push(renderSourceRow(set.emoteSetName || set.id, set.emoteCount, 'set', true));
    }
  }

  const orphanSets = sets.filter(s => !parents.some(p => p.id === s.parentChannelId));
  for (const set of orphanSets) {
    rows.push(renderSourceRow(set.emoteSetName || set.id, set.emoteCount, 'set', false));
  }

  list.innerHTML = rows.join('');
}

function renderTelegram(channels) {
  const summary = document.getElementById('telegram-summary');
  const list = document.getElementById('telegram-list');

  const totalItems = channels.reduce((sum, c) => sum + c.emoteCount, 0);

  summary.innerHTML = `
    <span class="summary-pill"><strong>${channels.length}</strong> packs</span>
    <span class="summary-pill"><strong>${formatNumber(totalItems)}</strong> stickers</span>
  `;

  if (channels.length === 0) {
    list.innerHTML = '<div class="empty-state">No Telegram sources imported</div>';
    return;
  }

  const rows = channels.map(ch => {
    const badge = ch.emoteCount === 0 ? 'empty' : 'set';
    return renderSourceRow(ch.telegramStickerSetTitle || ch.username || ch.id, ch.emoteCount, badge, false);
  });

  list.innerHTML = rows.join('');
}

function renderSourceRow(name, count, badgeType, isChild) {
  const badgeLabels = { active: 'Channel', set: 'Set', empty: 'Empty' };
  return `
    <div class="source-row ${isChild ? 'is-set' : ''}">
      <span class="source-name">${escapeHtml(name)}</span>
      <div class="source-meta">
        <span class="source-badge ${badgeType}">${badgeLabels[badgeType] || badgeType}</span>
        <span class="source-count">${formatNumber(count)}</span>
      </div>
    </div>
  `;
}

function renderFailures(state) {
  const body = document.getElementById('failures-body');
  const failedEmotes = state.failedEmotes || [];
  const orphanBlobs = state.failedBlobCount || 0;

  if (failedEmotes.length === 0 && orphanBlobs === 0) {
    body.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle" style="color: var(--success)"></i> No issues detected</div>';
    document.getElementById('retry-failed-btn').disabled = true;
    document.getElementById('clear-failed-btn').disabled = true;
    return;
  }

  document.getElementById('retry-failed-btn').disabled = failedEmotes.length === 0;
  document.getElementById('clear-failed-btn').disabled = failedEmotes.length === 0;

  const rows = [];

  if (orphanBlobs > 0) {
    rows.push(`
      <div class="fail-row">
        <span class="fail-key">Orphaned metadata (blob missing or empty)</span>
        <span class="fail-reason">${orphanBlobs} emotes</span>
        <span class="fail-source">indexeddb</span>
      </div>
    `);
  }

  for (const emote of failedEmotes) {
    rows.push(`
      <div class="fail-row">
        <span class="fail-key">${escapeHtml(emote.triggerKey || emote.key || 'unknown')}</span>
        <span class="fail-reason">${escapeHtml(emote.error || 'Download failed')}</span>
        <span class="fail-source">${escapeHtml(emote.channel || emote.channelId || '')}</span>
      </div>
    `);
  }

  body.innerHTML = rows.join('');
}

function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(fetchDashboardState, 2000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

document.getElementById('refresh-btn').addEventListener('click', fetchDashboardState);

document.getElementById('auto-refresh').addEventListener('change', (e) => {
  if (e.target.checked) startPolling();
  else stopPolling();
});

document.getElementById('retry-failed-btn').addEventListener('click', async () => {
  const btn = document.getElementById('retry-failed-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Retrying...';
  try {
    await chrome.runtime.sendMessage({ action: 'retryFailedEmotes' });
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-redo"></i> Retry Failed';
      fetchDashboardState();
    }, 1000);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-redo"></i> Retry Failed';
  }
});

document.getElementById('clear-failed-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'clearFailedEmotes' });
  fetchDashboardState();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'downloadProgress' || message.type === 'retryProgress') {
    fetchDashboardState();
  }
});

fetchDashboardState();
startPolling();
