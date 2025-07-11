<script>
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';

  let allEmotes = {};
  let error = null;
  let searchTerm = '';

  let channelIdsInput = '';
  let downloadLogs = [];
  let downloadSectionOpen = false;
  let isLoadingEmotes = true;

  let unlistenDownloadLog = null;

  onMount(async () => {
    try {
      const response = await fetch('/emote_mapping.json');
      if (!response.ok) {
        console.warn(`Local /emote_mapping.json not found or invalid. Status: ${response.status}. This is expected if no emotes are downloaded yet.`);
        allEmotes = {}; 
      } else {
        allEmotes = await response.json();
      }
    } catch (e) {
      console.error("Failed to load emotes from /public:", e);
      allEmotes = {};
      error = e.message + ". Try downloading emotes.";
    } finally {
      isLoadingEmotes = false;
    }

    try {
      unlistenDownloadLog = await listen('download://log', (event) => {
        console.log("Received download log:", event.payload);
        const message = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload);
        downloadLogs = [...downloadLogs, message];
      });
    } catch (e) {
      console.error("Failed to set up download log listener:", e);
      downloadLogs = [...downloadLogs, "Error: Could not connect to backend for logs."];
    }

    return () => {
      if (unlistenDownloadLog) {
        unlistenDownloadLog();
      }
    };
  });

  function getEmoteImagePath(path) {
    return encodeURI('/' + path.replace(/\\\\/g, '/'));
  }

  $: filteredEmotes = Object.entries(allEmotes).filter(([name]) =>
    name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleDownloadEmotes() {
    if (!channelIdsInput.trim()) {
      downloadLogs = ["Error: Please enter one or more Channel IDs."];
      return;
    }
    downloadLogs = [`Frontend: Requesting download for IDs: ${channelIdsInput}`];
    try {
      const result = await invoke('download_emotes_command', { channelIdsStr: channelIdsInput });
      downloadLogs = [...downloadLogs, `Frontend: Backend process reported: ${result}`];
    } catch (e) {
      console.error("Error invoking download_emotes_command:", e);
      downloadLogs = [...downloadLogs, `Frontend: Error calling backend: ${e}`];
    }
  }

</script>

<main>
  <h1>Mojify Emotes</h1>

  <div class="search-container">
    <input
      type="text"
      bind:value={searchTerm}
      placeholder="Search emotes..."
      class="search-bar"
    />
  </div>

  <details class="download-section-details" bind:open={downloadSectionOpen}>
    <summary>Download Emotes</summary>
    <section class="download-section-content">
      <div class="download-controls">
        <input
          type="text"
          bind:value={channelIdsInput}
          placeholder="Enter comma-separated 7TV User IDs (e.g., xqc, shroud)"
          class="channel-id-input"
        />
        <button on:click={handleDownloadEmotes} class="download-button">
          Download
        </button>
      </div>
      {#if downloadLogs.length > 0}
        <div class="logs-container">
          <h3>Logs:</h3>
          <pre>{downloadLogs.join('\n')}</pre>
        </div>
      {/if}
    </section>
  </details>

  {#if error && typeof error === 'string'}
    <p style="color: red;" class="status-message">Error: {error}</p>
  {/if}

  {#if isLoadingEmotes}
     <p class="status-message">Loading emote data...</p>
  {:else if Object.keys(allEmotes).length === 0 && !error && !searchTerm}
    <p class="status-message">No emotes loaded. Try downloading emotes.</p>
  {:else if filteredEmotes.length === 0 && !error && searchTerm && Object.keys(allEmotes).length > 0}
    <p class="status-message">No emotes found for "{searchTerm}"</p>
  {/if}

  <div class="emote-grid">
    {#each filteredEmotes as [name, path] (name)}
      <div class="emote-item" title={name}>
        <img src={getEmoteImagePath(path)} alt={name} />
        <p>{name}</p>
      </div>
    {/each}
  </div>

</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    background-color: #242424;
    color: rgba(255, 255, 255, 0.87);
  }

  main {
    text-align: center;
    padding: 1.5em;
    max-width: 1200px;
    margin: 0 auto;
  }

  h1 {
    color: #ff3e00;
    text-transform: uppercase;
    font-size: 2.8em;
    font-weight: 300;
    margin-bottom: 1.5em;
    letter-spacing: 0.05em;
  }

  .search-container {
    margin-bottom: 1em;
  }

  .search-bar {
    width: 100%;
    max-width: 500px;
    padding: 0.75em 1em;
    font-size: 1em;
    border-radius: 20px;
    border: 1px solid #444;
    background-color: #333;
    color: rgba(255, 255, 255, 0.87);
    outline: none;
    transition: border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
  }

  .search-bar:focus {
    border-color: #ff3e00;
    box-shadow: 0 0 0 3px rgba(255, 62, 0, 0.3);
  }

  .search-bar::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .download-section-details {
    margin-bottom: 2em;
    background-color: #2c2c2c;
    border-radius: 8px;
    border: 1px solid #444;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .download-section-details summary {
    padding: 0.75em 1.25em;
    font-size: 1.2em;
    font-weight: bold;
    color: #ff3e00;
    cursor: pointer;
    outline: none;
    list-style-position: inside;
    border-bottom: 1px solid #444;
  }
  
  .download-section-details[open] summary {
    border-bottom: 1px solid #444;
  }

  .download-section-details summary::-webkit-details-marker {
    color: #ff3e00;
  }

  .download-section-content {
    padding: 1.5em;
  }

  .download-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    margin-bottom: 1.5em;
    flex-wrap: wrap;
  }

  .channel-id-input {
    flex-grow: 1;
    max-width: 400px;
    padding: 0.75em 1em;
    font-size: 1em;
    border-radius: 20px;
    border: 1px solid #444;
    background-color: #333;
    color: rgba(255, 255, 255, 0.87);
    outline: none;
  }

  .channel-id-input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .download-button {
    padding: 0.75em 1.5em;
    font-size: 1em;
    font-weight: bold;
    border-radius: 20px;
    border: none;
    background-color: #ff3e00;
    color: white;
    cursor: pointer;
    transition: background-color 0.2s ease-in-out;
  }

  .download-button:hover {
    background-color: #e03600;
  }

  .logs-container {
    margin-top: 1.5em;
    text-align: left;
    background-color: #1a1a1a;
    padding: 1em;
    border-radius: 8px;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #444;
  }

  .logs-container h3 {
    margin-top: 0;
    margin-bottom: 0.5em;
    font-size: 1.2em;
    font-weight: bold;
    color: rgba(255, 255, 255, 0.87);
  }

  .logs-container pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.9em;
    color: rgba(255, 255, 255, 0.7);
    margin: 0;
  }
  
  .status-message {
    margin: 1em 0;
    font-style: italic;
    color: rgba(255, 255, 255, 0.7);
  }

  .emote-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 15px;
    justify-content: center;
  }

  .emote-item {
    background-color: #333;
    border-radius: 8px;
    padding: 15px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100px;
    transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
    cursor: pointer;
  }

  .emote-item:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
  }

  .emote-item img {
    max-width: 70px;
    max-height: 70px;
    object-fit: contain;
  }

  .emote-item p {
    font-size: 0.8em;
    margin-top: 10px;
    color: rgba(255, 255, 255, 0.75);
    word-break: break-all;
    max-width: 100%;
    line-height: 1.2;
  }
</style>
