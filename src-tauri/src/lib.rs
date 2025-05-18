use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Window, Wry, Emitter};
use regex::Regex;
use thiserror::Error;

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmoteFile {
    name: String,
    static_name: String,
    width: u32,
    height: u32,
    frame_count: u32,
    size: u64,
    format: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmoteHost {
    url: String,
    files: Vec<SevenTvEmoteFile>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmoteOwnerConnection {
    id: String,
    platform: String,
    username: String,
    display_name: String,
    linked_at: u64,
    emote_capacity: u32,
    emote_set_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmoteOwnerStyle {
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmoteOwner {
    id: String,
    username: String,
    display_name: String,
    avatar_url: String,
    style: SevenTvEmoteOwnerStyle,
    role_ids: Option<Vec<String>>,
    connections: Vec<SevenTvEmoteOwnerConnection>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmoteData {
    id: String,
    name: String,
    flags: u32,
    tags: Vec<String>,
    lifecycle: u32,
    state: Vec<String>,
    listed: bool,
    animated: bool,
    owner: SevenTvEmoteOwner,
    host: SevenTvEmoteHost,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmote {
    id: String,
    name: String,
    flags: u32,
    timestamp: u64,
    actor_id: Option<String>,
    data: SevenTvEmoteData,
    origin_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvEmoteSet {
    id: String,
    name: String,
    flags: u32,
    tags: Vec<String>,
    immutable: bool,
    privileged: bool,
    emotes: Vec<SevenTvEmote>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SevenTvUserResponse {
    id: String,
    platform: String,
    username: String,
    display_name: String,
    linked_at: u64,
    emote_capacity: u32,
    emote_set_id: Option<String>,
    emote_set: Option<SevenTvEmoteSet>,
}

// We might need a struct for user details if we fetch that part
// #[derive(Deserialize, Debug)]
// struct SevenTvUser {
//     id: String,
//     username: String,
//     display_name: String,
// }

// Error type for our command
#[derive(Debug, thiserror::Error)]
enum CommandError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("Tauri path error: {0}")]
    TauriPath(String),
    #[error("Missing emote set for user: {0}")]
    MissingEmoteSet(String),
    #[error("API returned no emotes for user: {0}")]
    NoEmotesInSet(String),
    #[error("Invalid channel ID list")]
    InvalidChannelIds,
}

// Required for Tauri to serialize errors back to frontend
impl serde::Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

// Helper function to emit log events to the frontend
fn emit_log(window: &Window<Wry>, message: String) {
    if let Err(e) = window.emit("download://log", message) {
        eprintln!("Failed to emit log event: {}", e);
    }
}

fn sanitize_filename(filename: &str) -> String {
    let invalid_chars = Regex::new("[<>:/\\|?*]").unwrap();
    invalid_chars.replace_all(filename, "_").into_owned()
}

#[tauri::command]
async fn download_emotes_command(
    app_handle: AppHandle,
    window: Window,
    channel_ids_str: String,
) -> Result<String, CommandError> {
    emit_log(&window, format!("Backend: Command started. IDs: {}", channel_ids_str));

    let channel_ids: Vec<&str> = channel_ids_str.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if channel_ids.is_empty() {
        emit_log(&window, "Backend: No valid channel IDs provided.".to_string());
        return Err(CommandError::InvalidChannelIds);
    }
    emit_log(&window, format!("Backend: Parsed Channel IDs: {:?}", channel_ids));

    let app_data_dir_result = app_handle.path().app_local_data_dir();
    emit_log(&window, format!("Backend: app_local_data_dir result: {:?}", app_data_dir_result));
    let app_data_dir = app_data_dir_result
        .map_err(|e| CommandError::TauriPath(format!("Failed to get app local data directory: {}", e)))?;
    
    let mojify_data_dir = app_data_dir.join("MojifyData");
    let emotes_base_dir = mojify_data_dir.join("7tv_emotes");
    let mapping_file_path = mojify_data_dir.join("emote_mapping.json");
    emit_log(&window, format!("Backend: MojifyData dir path: {}", mojify_data_dir.display()));
    emit_log(&window, format!("Backend: Emotes base dir path: {}", emotes_base_dir.display()));
    emit_log(&window, format!("Backend: Mapping file path: {}", mapping_file_path.display()));

    emit_log(&window, "Backend: Attempting to create emotes base directory...".to_string());
    fs::create_dir_all(&emotes_base_dir)?;
    emit_log(&window, "Backend: Emotes base directory created/ensured.".to_string());

    let client = reqwest::Client::builder()
        .user_agent("MojifyApp/0.1") 
        .build()?;
    emit_log(&window, "Backend: Reqwest client created.".to_string());

    let mut global_emote_mapping: HashMap<String, String> = 
        if mapping_file_path.exists() {
            emit_log(&window, "Backend: Mapping file exists, attempting to read...".to_string());
            let content = fs::read_to_string(&mapping_file_path)?;
            emit_log(&window, "Backend: Read mapping file content.".to_string());
            serde_json::from_str(&content).unwrap_or_else(|e| {
                emit_log(&window, format!("Backend: Error parsing existing mapping JSON, starting fresh: {}", e));
                HashMap::new()
            })
        } else {
            emit_log(&window, "Backend: No existing mapping file found, starting fresh.".to_string());
            HashMap::new()
        };
    emit_log(&window, format!("Backend: Initial global mapping loaded with {} entries.", global_emote_mapping.len()));

    for channel_id in channel_ids {
        emit_log(&window, format!("Backend: Processing channel ID: {}", channel_id));
        let api_url = format!("https://7tv.io/v3/users/twitch/{}", channel_id);
        emit_log(&window, format!("Backend: Fetching from API URL: {}", api_url));
        
        match client.get(&api_url).send().await {
            Ok(response) => {
                emit_log(&window, format!("Backend: API response status for {}: {}", channel_id, response.status()));
                if response.status().is_success() {
                    match response.json::<SevenTvUserResponse>().await {
                        Ok(user_response) => {
                            emit_log(&window, format!("Backend: Parsed JSON for channel: {}", channel_id));
                            if let Some(emote_set) = user_response.emote_set {
                                if emote_set.emotes.is_empty() {
                                    emit_log(&window, format!("Backend: No emotes in set for channel {}", channel_id));
                                    continue;
                                }
                                emit_log(&window, format!("Backend: Found {} emotes for {}. Emote set ID: {}", emote_set.emotes.len(), channel_id, emote_set.id));
                                
                                let channel_emote_dir = emotes_base_dir.join(channel_id);
                                emit_log(&window, format!("Backend: Channel emote dir for {}: {}", channel_id, channel_emote_dir.display()));
                                emit_log(&window, "Backend: Attempting to create channel emote directory...".to_string());
                                fs::create_dir_all(&channel_emote_dir)?;
                                emit_log(&window, "Backend: Channel emote directory created/ensured.".to_string());

                                for emote_data_item in emote_set.emotes {
                                    emit_log(&window, format!("Backend: Processing emote: {} (ID: {})", emote_data_item.name, emote_data_item.id));
                                    if let Some(last_file) = emote_data_item.data.host.files.last() {
                                        let emote_url_path = &last_file.name;
                                        let full_emote_url = format!("https://{}", emote_data_item.data.host.url.trim_start_matches("//"));
                                        let download_url = format!("{}/{}", full_emote_url, emote_url_path);
                                        emit_log(&window, format!("Backend: Emote download URL: {}", download_url));
                                        
                                        let sanitized_emote_name = sanitize_filename(&emote_data_item.name);
                                        let file_extension = Path::new(emote_url_path).extension().and_then(|os_str| os_str.to_str()).unwrap_or("gif");
                                        let emote_filename = format!("{}.{}", sanitized_emote_name, file_extension);
                                        let output_path = channel_emote_dir.join(&emote_filename);
                                        emit_log(&window, format!("Backend: Emote output path: {}", output_path.display()));

                                        if output_path.exists() {
                                            emit_log(&window, format!("Backend: Skipping existing emote: {}", emote_data_item.name));
                                            let mapping_key = format!(":{}:", sanitized_emote_name);
                                            if !global_emote_mapping.contains_key(&mapping_key) {
                                                let relative_path = Path::new("7tv_emotes").join(channel_id).join(&emote_filename);
                                                global_emote_mapping.insert(mapping_key, relative_path.to_string_lossy().replace("\\", "/"));
                                                 emit_log(&window, format!("Backend: Added skipped existing emote {} to map.", emote_data_item.name));
                                            }
                                            continue;
                                        }

                                        emit_log(&window, format!("Backend: Attempting to download {}...", emote_data_item.name));
                                        match client.get(&download_url).send().await {
                                            Ok(emote_response) => {
                                                emit_log(&window, format!("Backend: Emote download response status for {}: {}", emote_data_item.name, emote_response.status()));
                                                if emote_response.status().is_success() {
                                                    let emote_bytes = emote_response.bytes().await?;
                                                    emit_log(&window, format!("Backend: Emote {} bytes received ({} bytes). Attempting to write to file...", emote_data_item.name, emote_bytes.len()));
                                                    let mut file = File::create(&output_path)?;
                                                    file.write_all(&emote_bytes)?;
                                                    emit_log(&window, format!("Backend: Saved {} to {}", emote_data_item.name, output_path.display()));
                                                    
                                                    let relative_path = Path::new("7tv_emotes").join(channel_id).join(&emote_filename);
                                                    global_emote_mapping.insert(format!(":{}:", sanitized_emote_name), relative_path.to_string_lossy().replace("\\", "/"));
                                                    emit_log(&window, format!("Backend: Added {} to map.", emote_data_item.name));
                                                } else {
                                                    emit_log(&window, format!("Backend: Failed to download {}: HTTP {}", emote_data_item.name, emote_response.status()));
                                                }
                                            }
                                            Err(e) => emit_log(&window, format!("Backend: HTTP Error downloading emote {}: {}", emote_data_item.name, e)),
                                        }
                                    } else {
                                        emit_log(&window, format!("Backend: No files found in host data for emote: {}", emote_data_item.name));
                                    }
                                }
                            } else {
                                emit_log(&window, format!("Backend: Missing emote_set for channel ID {} (user_response.emote_set was None)", channel_id));
                            }
                        }
                        Err(e) => emit_log(&window, format!("Backend: Error parsing JSON for {}: {}. Raw text might be: [response text not logged for brevity]", channel_id, e)),
                    }
                } else {
                    emit_log(&window, format!("Backend: API request failed for {}: HTTP {}", channel_id, response.status()));
                }
            }
            Err(e) => emit_log(&window, format!("Backend: HTTP Error fetching data for channel {}: {}", channel_id, e)),
        }
    }

    emit_log(&window, "Backend: Attempting to serialize final mapping...".to_string());
    let mapping_json = serde_json::to_string_pretty(&global_emote_mapping)?;
    emit_log(&window, "Backend: Attempting to write final mapping to file...".to_string());
    fs::write(&mapping_file_path, mapping_json)?;
    emit_log(&window, format!("Backend: Emote mapping saved to {}", mapping_file_path.display()));

    emit_log(&window, "Backend: Download command finished successfully.".to_string());
    Ok("Download process finished. Check logs for details.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![download_emotes_command]) // Register the command
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
