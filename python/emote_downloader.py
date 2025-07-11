import os
import requests
import sys
import json
import re
from dotenv import load_dotenv
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load environment variables
load_dotenv()

# Configuration
CHANNEL_IDS = os.getenv("CHANNEL_IDS", "").split(",")
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "7tv_emotes"))
MAPPING_FILE = Path(os.getenv("MAPPING_FILE", "emote_mapping.json"))
TWITCH_API_BASE_URL = os.getenv("TWITCH_API_BASE_URL", "https://7tv.io/v3/users/twitch")

# Ensure UTF-8 encoding for output
sys.stdout.reconfigure(encoding="utf-8")

def get_7tv_emotes(channel_id: str, session: requests.Session) -> dict:
    """
    Fetch 7TV emotes for a given Twitch channel ID.
    """
    print(f"Fetching emotes for channel ID: {channel_id}")
    url = f"{TWITCH_API_BASE_URL}/{channel_id}"
    try:
        response = session.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        emote_list = data.get("emote_set", {}).get("emotes", [])
        return {
            emote["name"]: f"https://{emote['data']['host']['url'].lstrip('//')}/{emote['data']['host']['files'][-1]['name']}"
            for emote in emote_list if emote.get("name") and emote.get("data")
        }
    except (requests.RequestException, KeyError) as e:
        print(f"Error fetching emotes for {channel_id}: {e}")
        return {}

def sanitize_filename(filename: str) -> str:
    """
    Replace invalid characters in a filename with underscores.
    """
    return re.sub(r'[<>:"/\\|?*]', "_", filename)

def download_emotes(emotes: dict, output_dir: Path, session: requests.Session) -> tuple:
    """
    Download emotes in parallel and return mapping, failed, and skipped emotes.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    seen_files = {}
    mapping, failed, skipped = {}, [], []

    def download(name: str, url: str):
        sanitized_name = sanitize_filename(name)
        base_name = sanitized_name.lower()
        suffix = seen_files.get(base_name, 0)
        seen_files[base_name] = suffix + 1
        if suffix > 0:
            sanitized_name = f"{sanitized_name}_{suffix}"

        extension = Path(url).suffix or ".gif"
        file_path = output_dir / f"{sanitized_name}{extension}"
        # Include absolute path in the mapping
        command = f":{sanitized_name}:"
        mapping[command] = str(file_path.relative_to(OUTPUT_DIR.parent))

        if file_path.exists():
            skipped.append(name)
            return

        try:
            with session.get(url, timeout=10) as response:
                response.raise_for_status()
                file_path.write_bytes(response.content)
        except requests.RequestException:
            failed.append(name)

    with ThreadPoolExecutor(max_workers=10) as executor:
        tasks = {executor.submit(download, name, url): name for name, url in emotes.items()}
        for task in as_completed(tasks):
            task.result()  # Trigger exceptions if any

    return mapping, failed, skipped

def load_mapping(file_path: Path) -> dict:
    """
    Load existing mapping from a JSON file.
    """
    if file_path.exists():
        try:
            return json.loads(file_path.read_text(encoding="utf-8").strip() or "{}")
        except json.JSONDecodeError as e:
            print(f"Error reading mapping: {e}")
    return {}

def save_mapping(mapping: dict, file_path: Path):
    """
    Save the mapping to a JSON file if it has changed.
    """
    new_content = json.dumps(mapping, indent=4)
    if file_path.exists() and file_path.read_text(encoding="utf-8").strip() == new_content:
        print(f"No changes to save in {file_path}")
        return
    file_path.write_text(new_content, encoding="utf-8")
    print(f"Mapping saved to {file_path}")

def download_emotes_main():
    """
    Main function to fetch and download emotes for specified channels.
    """
    print(f"Loading mapping from {MAPPING_FILE}")
    global_mapping = load_mapping(MAPPING_FILE)

    print(f"Using output directory: {OUTPUT_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with requests.Session() as session:
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {
                executor.submit(get_7tv_emotes, channel_id, session): channel_id for channel_id in CHANNEL_IDS
            }
            for future in as_completed(futures):
                try:
                    channel_id = futures[future]
                    emotes = future.result()
                    if emotes:
                        channel_dir = OUTPUT_DIR / channel_id
                        mapping, failed, skipped = download_emotes(emotes, channel_dir, session)
                        global_mapping.update(mapping)

                        print(f"\nChannel: {channel_id}")
                        print(f"Downloaded: {len(mapping)}")
                        print(f"Skipped: {len(skipped)}")
                        print(f"Failed: {len(failed)}")
                    else:
                        print(f"No emotes found for channel: {channel_id}")
                except Exception as e:
                    print(f"Error processing channel {channel_id}: {e}")

    print(f"Saving mapping to {MAPPING_FILE}")
    save_mapping(global_mapping, MAPPING_FILE)

