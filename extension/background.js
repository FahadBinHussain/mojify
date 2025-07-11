
const TWITCH_API_BASE_URL = "https://7tv.io/v3/users/twitch";

async function get7TVEmotes(channelId) {
  const url = `${TWITCH_API_BASE_URL}/${channelId}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    const emoteList = data.emote_set?.emotes || [];
    return emoteList.reduce((acc, emote) => {
      if (emote.name && emote.data) {
        acc[`:${emote.name}:`] = `https://${emote.data.host.url.replace(/^\/\//, '')}/${emote.data.host.files.slice(-1)[0].name}`;
      }
      return acc;
    }, {});
  } catch (error) {
    console.error(`Error fetching emotes for ${channelId}:`, error);
    return {};
  }
}

async function downloadEmotes() {
  const { channelIds } = await chrome.storage.local.get(['channelIds']);
  if (!channelIds || channelIds.length === 0) {
    console.log("No channel IDs configured.");
    return;
  }

  let globalEmoteMapping = {};
  for (const channelId of channelIds) {
    const emotes = await get7TVEmotes(channelId);
    Object.assign(globalEmoteMapping, emotes);
  }

  await chrome.storage.local.set({ emoteMapping: globalEmoteMapping });
  console.log("Emote mapping updated.");
}

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'downloadEmotes') {
    downloadEmotes()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true; // Indicates that the response is sent asynchronously
  }
}); 