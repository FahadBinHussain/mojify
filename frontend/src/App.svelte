<script>
  import { onMount } from 'svelte';

  let allEmotes = {}; // Renamed to avoid conflict with derived variable
  let error = null;
  let searchTerm = '';

  onMount(async () => {
    try {
      const response = await fetch('/emote_mapping.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      allEmotes = await response.json();
    } catch (e) {
      console.error("Failed to load emotes:", e);
      error = e.message;
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

  {#if error}
    <p style="color: red;">Error loading emotes: {error}</p>
  {/if}

  {#if filteredEmotes.length === 0 && !error && searchTerm}
    <p>No emotes found for "{searchTerm}"</p>
  {:else if Object.keys(allEmotes).length === 0 && !error}
    <p>Loading emotes...</p>
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
    margin-bottom: 2em;
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

  .emote-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); /* Slightly larger items */
    gap: 15px; /* Increased gap */
    justify-content: center;
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
