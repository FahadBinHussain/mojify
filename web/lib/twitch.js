let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

export async function getAppAccessToken() {
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Server missing Twitch credentials");
  }

  const tokenUrl = new URL("https://id.twitch.tv/oauth2/token");
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);
  tokenUrl.searchParams.set("grant_type", "client_credentials");

  const response = await fetch(tokenUrl.toString(), { method: "POST" });
  if (!response.ok) {
    throw new Error("Could not get Twitch app token");
  }

  const payload = await response.json();
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + (payload.expires_in || 3600) * 1000
  };

  return tokenCache.accessToken;
}

export async function findTwitchUser({ username, id }) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) throw new Error("Server missing Twitch client ID");

  const token = await getAppAccessToken();
  const usersUrl = new URL("https://api.twitch.tv/helix/users");
  if (username) usersUrl.searchParams.set("login", username);
  if (id) usersUrl.searchParams.set("id", id);

  const response = await fetch(usersUrl.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": clientId
    }
  });

  if (!response.ok) {
    throw new Error("Twitch lookup failed");
  }

  const payload = await response.json();
  return payload?.data?.[0] || null;
}
