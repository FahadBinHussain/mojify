use serde::Deserialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Window, Wry, Emitter};
use regex::Regex;

#[derive(Deserialize, Debug)]
struct SevenTvEmoteFile {
    name: String,
    // We might need other fields like format, width, height later
}

#[derive(Deserialize, Debug)]
struct SevenTvEmoteHost {
    url: String,
    files: Vec<SevenTvEmoteFile>,
}

#[derive(Deserialize, Debug)]
struct SevenTvEmoteData {
    id: String,
    name: String,
    host: SevenTvEmoteHost,
    // lifecycle: Option<i32>, // To check if animated, 0 = static, 1 = animated, 3 = webp animated
    // animated: bool, // This field exists directly in some 7TV API versions
}

#[derive(Deserialize, Debug)]
struct SevenTvEmoteSet {
    id: String,
    name: String,
    emotes: Vec<SevenTvEmoteData>,
}

#[derive(Deserialize, Debug)]
struct SevenTvUserResponse {
    emote_set: Option<SevenTvEmoteSet>, // Changed to Option in case it's missing for a user
    // user: SevenTvUser, // Could add user details if needed
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
    emit_log(&window, format!("Backend: Received download request for IDs: {}", channel_ids_str));

    let channel_ids: Vec<&str> = channel_ids_str.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if channel_ids.is_empty() {
        emit_log(&window, "Backend: No valid channel IDs provided.".to_string());
        return Err(CommandError::InvalidChannelIds);
    }

    let app_data_dir = app_handle.path().app_local_data_dir()
        .map_err(|e| CommandError::TauriPath(format!("Failed to get app local data directory: {}", e)))?;
    
    let mojify_data_dir = app_data_dir.join("MojifyData");
    let emotes_base_dir = mojify_data_dir.join("7tv_emotes");
    let mapping_file_path = mojify_data_dir.join("emote_mapping.json");

    fs::create_dir_all(&emotes_base_dir)?;
    emit_log(&window, format!("Backend: Using data directory: {}", mojify_data_dir.display()));

    let client = reqwest::Client::builder()
        .user_agent("MojifyApp/0.1 (github.com/youruser/mojify)") // Good practice to set a User-Agent
        .build()?;

    let mut global_emote_mapping: HashMap<String, String> = 
        if mapping_file_path.exists() {
            let content = fs::read_to_string(&mapping_file_path)?;
            serde_json::from_str(&content).unwrap_or_else(|e| {
                emit_log(&window, format!("Backend: Error reading existing mapping file, starting fresh: {}", e));
                HashMap::new()
            })
        } else {
            HashMap::new()
        };

    for channel_id in channel_ids {
        emit_log(&window, format!("Backend: Fetching emotes for channel ID: {}", channel_id));
        let api_url = format!("https://7tv.io/v3/users/twitch/{}", channel_id);
        
        match client.get(&api_url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<SevenTvUserResponse>().await {
                        Ok(user_response) => {
                            if let Some(emote_set) = user_response.emote_set {
                                if emote_set.emotes.is_empty() {
                                    emit_log(&window, format!("Backend: No emotes found in set for channel {}", channel_id));
                                    continue;
                                }
                                emit_log(&window, format!("Backend: Found {} emotes for channel {}", emote_set.emotes.len(), channel_id));
                                
                                let channel_emote_dir = emotes_base_dir.join(channel_id);
                                fs::create_dir_all(&channel_emote_dir)?;

                                for emote_data in emote_set.emotes {
                                    if let Some(last_file) = emote_data.host.files.last() { // 7TV often has multiple sizes, pick last (usually largest)
                                        let emote_url_path = &last_file.name;
                                        let full_emote_url = format!("https://{}", emote_data.host.url.trim_start_matches("//")); // Ensure scheme is https
                                        let download_url = format!("{}/{}", full_emote_url, emote_url_path);
                                        
                                        let sanitized_emote_name = sanitize_filename(&emote_data.name);
                                        let file_extension = Path::new(emote_url_path).extension().and_then(|os_str| os_str.to_str()).unwrap_or("gif");
                                        let emote_filename = format!("{}.{}", sanitized_emote_name, file_extension);
                                        let output_path = channel_emote_dir.join(&emote_filename);

                                        if output_path.exists() {
                                            emit_log(&window, format!("Backend: Skipping existing emote: {}", emote_data.name));
                                            // Ensure existing emotes are in the map if not already
                                            let mapping_key = format!(":{}:", sanitized_emote_name);
                                            if !global_emote_mapping.contains_key(&mapping_key) {
                                                let relative_path = Path::new("7tv_emotes").join(channel_id).join(&emote_filename);
                                                global_emote_mapping.insert(mapping_key, relative_path.to_string_lossy().replace("\\", "/"));
                                            }
                                            continue;
                                        }

                                        emit_log(&window, format!("Backend: Downloading {} from {}", emote_data.name, download_url));
                                        match client.get(&download_url).send().await {
                                            Ok(emote_response) => {
                                                if emote_response.status().is_success() {
                                                    let emote_bytes = emote_response.bytes().await?;
                                                    let mut file = File::create(&output_path)?;
                                                    file.write_all(&emote_bytes)?;
                                                    emit_log(&window, format!("Backend: Saved {} to {}", emote_data.name, output_path.display()));
                                                    
                                                    // Path in mapping should be relative to MojifyData dir, for asset serving
                                                    // e.g., 7tv_emotes/channel_id/emote.gif
                                                    let relative_path = Path::new("7tv_emotes").join(channel_id).join(&emote_filename);
                                                    global_emote_mapping.insert(format!(":{}:", sanitized_emote_name), relative_path.to_string_lossy().replace("\\", "/"));
                                                } else {
                                                    emit_log(&window, format!("Backend: Failed to download {}: HTTP {}", emote_data.name, emote_response.status()));
                                                }
                                            }
                                            Err(e) => emit_log(&window, format!("Backend: Error downloading emote {}: {}", emote_data.name, e)),
                                        }
                                    } else {
                                        emit_log(&window, format!("Backend: No files found in host data for emote: {}", emote_data.name));
                                    }
                                }
                            } else {
                                emit_log(&window, format!("Backend: Missing emote_set for channel ID {}", channel_id));
                            }
                        }
                        Err(e) => emit_log(&window, format!("Backend: Error parsing JSON for {}: {}", channel_id, e)),
                    }
                } else {
                    emit_log(&window, format!("Backend: API request failed for {}: HTTP {}", channel_id, response.status()));
                }
            }
            Err(e) => emit_log(&window, format!("Backend: Error fetching data for channel {}: {}", channel_id, e)),
        }
    }

    let mapping_json = serde_json::to_string_pretty(&global_emote_mapping)?;
    fs::write(&mapping_file_path, mapping_json)?;
    emit_log(&window, format!("Backend: Emote mapping saved to {}", mapping_file_path.display()));

    emit_log(&window, "Backend: Download process complete.".to_string());
    Ok("Download process initiated and likely complete. Check logs.".to_string())
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
