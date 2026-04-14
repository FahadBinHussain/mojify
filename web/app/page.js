"use client";

import { useState } from "react";

export default function HomePage() {
  const [type, setType] = useState("username");
  const [value, setValue] = useState("");
  const [result, setResult] = useState("");
  const [copyValue, setCopyValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function translate() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult("");

    try {
      const endpoint = type === "username"
        ? `/api/twitch/user-id?username=${encodeURIComponent(trimmed)}`
        : `/api/twitch/username?id=${encodeURIComponent(trimmed)}`;

      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      if (type === "username") {
        setCopyValue(data.id);
        setResult(`User ID: ${data.id} (username: ${data.login})`);
      } else {
        setCopyValue(data.login);
        setResult(`Username: ${data.login} (user id: ${data.id})`);
      }
    } catch (err) {
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <div className="content">
          <div className="heroInner">
            <p className="kicker">Mojify Tools</p>
            <h1>Twitch Username and ID Translator</h1>
            <p className="lead">Fast, clean conversion for creators, bots, and automation workflows.</p>
          </div>
        </div>
      </section>

      <section className="content contentTranslator">
        <div className="translator">
          <div className="translatorHead">
            <h2>Translate</h2>
            <span>Helix-backed API</span>
          </div>

          <div className="controls">
            <label htmlFor="type">Input Type</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="username">Username</option>
              <option value="userid">User ID</option>
            </select>

            <label htmlFor="value">Username or User ID</label>
            <input
              id="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. xqc or 71092938"
            />

            <button onClick={translate} disabled={loading}>
              {loading ? "Translating..." : "Translate Now"}
            </button>
          </div>

          {result && (
            <div className="result">
              <span>{result}</span>
              <button
                type="button"
                className="copyBtn"
                onClick={async () => {
                  if (!copyValue) return;
                  await navigator.clipboard.writeText(copyValue);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
