<script>
  import { onMount } from 'svelte';

  let allEmotes = {}; // Renamed to avoid conflict with derived variable
  let error = null;
  let searchTerm = '';

  let channelIdsInput = ''; // For the download section input
  let downloadLogs = [];    // To store download log messages
  let downloadSectionOpen = false; // To control the <details> open state if needed, though browser handles it by default

  onMount(async () => {
    try {
      const response = await fetch('/emote_mapping.json');
      if (!response.ok) {
        // If the local mapping fails, it might be the first run or an error.
        // We could initialize allEmotes to an empty object and proceed,
        // relying on the download functionality to populate it.
        console.warn(`HTTP error! status: ${response.status} when fetching emote_mapping.json. This might be normal on first run.`);
        allEmotes = {}; // Initialize to empty if not found, allowing download to populate
        // error = `Failed to load local emote map: ${response.statusText}. Try downloading emotes.`;
      } else {
        allEmotes = await response.json();
      }
    } catch (e) {
      console.error("Failed to load emotes:", e);
      // Similar to above, allow app to function for downloading if local map fails
      allEmotes = {};
      error = e.message + ". Try downloading emotes if the list is empty.";
    }
  });

  // Helper to correctly format the image path
  function getEmoteImagePath(path) {
    // In emote_mapping.json, paths use double backslashes like "7tv_emotes\\...".
    // Browsers need forward slashes for URLs.
    // Also, ensure it's relative to the public directory.
    return encodeURI('/' + path.replace(/\\\\/g, '/'));
  }

  // Reactive declaration for filtered emotes
  $: filteredEmotes = Object.entries(allEmotes).filter(([name]) =>
    name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleDownloadEmotes() {
    downloadLogs = [`Starting download for channel IDs: ${channelIdsInput}`];
    // TODO: Implement actual call to Tauri backend
    downloadLogs = [...downloadLogs, "(Frontend-only simulation: Download logic not yet connected to backend)"];
    // Simulate some logs
    setTimeout(() => {
        downloadLogs = [...downloadLogs, "Fetching emotes for channel XYZ...", "30 emotes found.", "Downloading 1/30..."];
    }, 1000);
    setTimeout(() => {
        downloadLogs = [...downloadLogs, "Downloading 15/30...", "Finished channel XYZ."];
    }, 2500);
    setTimeout(() => {
        downloadLogs = [...downloadLogs, "Download process complete (simulated)."];
    }, 4000);
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
          placeholder="Enter comma-separated 7TV User IDs"
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

  {#if error}
    <p style="color: red;" class="status-message">Error: {error}</p>
  {/if}

  {#if filteredEmotes.length === 0 && !error && searchTerm && Object.keys(allEmotes).length > 0}
    <p class="status-message">No emotes found for "{searchTerm}"</p>
  {:else if Object.keys(allEmotes).length === 0 && !error && !searchTerm}
    <p class="status-message">No emotes loaded. Try the download section below.</p>
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
    background-color: #242424; /* Dark background for the whole page */
    color: rgba(255, 255, 255, 0.87); /* Light text color */
  }

  main {
    text-align: center;
    padding: 1.5em;
    max-width: 1200px;
    margin: 0 auto;
  }

  h1 {
    color: #ff3e00; /* Svelte orange, can be changed */
    text-transform: uppercase;
    font-size: 2.8em;
    font-weight: 300; /* Lighter font weight */
    margin-bottom: 1.5em;
    letter-spacing: 0.05em;
  }

  .search-container {
    margin-bottom: 1em; /* Reduced margin as download section is now here */
  }

  .search-bar {
    width: 100%;
    max-width: 500px;
    padding: 0.75em 1em;
    font-size: 1em;
    border-radius: 20px; /* Pill shape */
    border: 1px solid #444; /* Darker border */
    background-color: #333; /* Dark input background */
    color: rgba(255, 255, 255, 0.87);
    outline: none;
    transition: border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
  }

  .search-bar:focus {
    border-color: #ff3e00; /* Svelte orange on focus */
    box-shadow: 0 0 0 3px rgba(255, 62, 0, 0.3);
  }

  .search-bar::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .download-section-details {
    margin-bottom: 2em; /* Space below the download section before emote grid */
    background-color: #2c2c2c; /* Slightly different background for the details block */
    border-radius: 8px;
    border: 1px solid #444;
    max-width: 600px; /* Constrain width of download section */
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
    list-style-position: inside; /* Better marker positioning */
    border-bottom: 1px solid #444; /* Separator when closed */
  }
  
  .download-section-details[open] summary {
    border-bottom: 1px solid #444; /* Keep separator when open */
  }

  .download-section-details summary::-webkit-details-marker {
    color: #ff3e00;
  }

  .download-section-content { /* Renamed from download-section */
    padding: 1.5em; /* Padding inside the collapsible content */
    /* border-top: none; Removed as summary has border */
  }

  .download-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    margin-bottom: 1.5em;
    flex-wrap: wrap; /* Allow wrapping on smaller screens */
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
    background-color: #e03600; /* Darker Svelte orange on hover */
  }

  .logs-container {
    margin-top: 1.5em;
    text-align: left;
    background-color: #1a1a1a; /* Very dark background for logs */
    padding: 1em;
    border-radius: 8px;
    max-height: 200px; /* Reduced height a bit */
    overflow-y: auto; /* Add scrollbar if content overflows */
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
    white-space: pre-wrap; /* Wrap long log lines */
    word-wrap: break-word; /* Ensure words break correctly */
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
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); /* Slightly larger items */
    gap: 15px; /* Increased gap */
    justify-content: center;
    /* margin-bottom: 3em; /* Removed as download section is now above */
  }

  .emote-item {
    background-color: #333; /* Darker item background */
    border-radius: 8px; /* More rounded corners */
    padding: 15px; /* Increased padding */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100px; /* Ensure items have a minimum height */
    transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
    cursor: pointer;
  }

  .emote-item:hover {
    transform: translateY(-5px); /* Slight lift on hover */
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3); /* Softer shadow on hover */
  }

  .emote-item img {
    max-width: 70px; /* Slightly larger images */
    max-height: 70px;
    object-fit: contain;
  }

  /* Optional: if you want to show the name below the emote */
  .emote-item p {
    font-size: 0.8em;
    margin-top: 10px; /* Increased margin a bit */
    color: rgba(255, 255, 255, 0.75); /* Slightly brighter for better readability */
    word-break: break-all;
    max-width: 100%; /* Ensure it doesn't overflow the item padding */
    line-height: 1.2;
  }
</style>
