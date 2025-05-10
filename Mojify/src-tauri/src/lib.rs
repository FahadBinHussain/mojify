use tauri::{Manager};
use std::path::Path;
use arboard::Clipboard;
use image::io::Reader as ImageReader;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Command to copy an image to clipboard
#[tauri::command]
fn copy_image_to_clipboard(image_path: &str) -> Result<(), String> {
    // Check if the file exists
    if !Path::new(image_path).exists() {
        return Err(format!("Image file not found: {}", image_path));
    }
    
    // Load the image
    let img = match ImageReader::open(image_path) {
        Ok(reader) => match reader.decode() {
            Ok(img) => img,
            Err(e) => return Err(format!("Failed to decode image: {}", e)),
        },
        Err(e) => return Err(format!("Failed to open image: {}", e)),
    };
    
    // Convert to RGB format
    let rgba = img.into_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    
    // Create clipboard instance
    let mut clipboard = match Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(e) => return Err(format!("Failed to access clipboard: {}", e)),
    };
    
    // Set the image to clipboard
    match clipboard.set_image(arboard::ImageData {
        width,
        height,
        bytes: rgba.into_raw().into(),
    }) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to set clipboard data: {}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            
            // Create menu items
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let open_item = tauri::menu::MenuItem::with_id(app, "open", "Open Mojify", true, None::<&str>)?;
            
            // Create menu
            let menu = tauri::menu::Menu::with_items(app, &[&open_item, &quit_item])?;
            
            // Create tray icon
            tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(move |app_handle, event| {
                    match event.id.0.as_str() {
                        "open" => {
                            if let Some(window) = app_handle.app_handle().get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app_handle.app_handle().exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |app_handle, event| {
                    use tauri::tray::{MouseButton, MouseButtonState};
                    
                    if let tauri::tray::TrayIconEvent::Click { 
                        button: MouseButton::Left, 
                        button_state: MouseButtonState::Up, 
                        .. 
                    } = event {
                        if let Some(window) = app_handle.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap() {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, copy_image_to_clipboard])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
