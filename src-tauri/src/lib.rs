#[cfg(target_os = "macos")]
mod ax_watcher;

#[cfg(target_os = "windows")]
mod win_watcher;

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

static TOOLBAR_ENABLED: AtomicBool = AtomicBool::new(true);
const CHROME_EXTENSION_RESOURCE_DIR: &str = "chrome-extension";

struct AppMode(Mutex<String>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromeExtensionDownloadInfo {
    path: String,
    file_name: String,
}

// ── Toolbar / AX commands ─────────────────────────────────────────────────────

#[tauri::command]
fn request_ax_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        ax_watcher::request_permission_with_prompt()
    }
    #[cfg(target_os = "windows")]
    {
        true // UIA needs no explicit user permission on Windows
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[tauri::command]
fn check_ax_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        ax_watcher::check_permission()
    }
    #[cfg(target_os = "windows")]
    {
        true // UIA needs no explicit user permission on Windows
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[tauri::command]
fn set_toolbar_enabled(enabled: bool, app: tauri::AppHandle) {
    TOOLBAR_ENABLED.store(enabled, Ordering::Relaxed);
    if !enabled {
        if let Some(w) = app.get_webview_window("toolbar") {
            let _ = w.hide();
        }
    }
}

#[tauri::command]
fn get_target_pid() -> Option<i32> {
    #[cfg(target_os = "macos")]
    {
        ax_watcher::get_last_pid()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[tauri::command]
fn inject_result(text: String, pid: Option<i32>) {
    #[cfg(target_os = "macos")]
    {
        // Use caller-supplied pid (captured before AI call) or fall back to current.
        let target_pid = pid.or_else(|| ax_watcher::get_last_pid());
        std::thread::spawn(move || {
            ax_watcher::write_to_clipboard_and_paste(&text, target_pid);
        });
    }
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            win_watcher::write_to_clipboard_and_paste(&text);
        });
    }
}

#[tauri::command]
fn hide_toolbar(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("toolbar") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn apply_window_corners(window: tauri::WebviewWindow, radius: f64) -> Result<(), String> {
    apply_native_window_corners(&window, radius)
}

fn apply_native_window_corners(window: &tauri::WebviewWindow, radius: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc::runtime::{Class, Object, NO, YES};
        use objc::{msg_send, sel, sel_impl};

        window
            .with_webview(move |webview| unsafe {
                let ns_window = webview.ns_window() as *mut Object;
                if ns_window.is_null() {
                    return;
                }

                let _: () = msg_send![ns_window, setOpaque: NO];

                if let Some(ns_color) = Class::get("NSColor") {
                    let clear_color: *mut Object = msg_send![ns_color, clearColor];
                    let _: () = msg_send![ns_window, setBackgroundColor: clear_color];
                }

                let content_view: *mut Object = msg_send![ns_window, contentView];
                if content_view.is_null() {
                    return;
                }

                let _: () = msg_send![content_view, setWantsLayer: YES];
                let layer: *mut Object = msg_send![content_view, layer];
                if layer.is_null() {
                    return;
                }

                let _: () = msg_send![layer, setCornerRadius: radius];
                let _: () = msg_send![layer, setMasksToBounds: YES];
            })
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use std::ffi::c_void;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DWMWCP_ROUNDSMALL,
            DWM_WINDOW_CORNER_PREFERENCE,
        };

        if let Ok(handle) = window.window_handle() {
            if let RawWindowHandle::Win32(h) = handle.as_raw() {
                let preference: DWM_WINDOW_CORNER_PREFERENCE = if radius <= 8.0 {
                    DWMWCP_ROUNDSMALL
                } else {
                    DWMWCP_ROUND
                };

                unsafe {
                    DwmSetWindowAttribute(
                        HWND(h.hwnd.get() as isize),
                        DWMWA_WINDOW_CORNER_PREFERENCE,
                        &preference as *const _ as *const c_void,
                        std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, radius);
    }

    Ok(())
}

// ── Chrome extension commands ────────────────────────────────────────────────

#[tauri::command]
fn download_chrome_extension(app: tauri::AppHandle) -> Result<ChromeExtensionDownloadInfo, String> {
    let source = chrome_extension_source_dir(&app)?;
    let file_name = format!(
        "melhora-ai-chrome-extension-v{}.zip",
        env!("CARGO_PKG_VERSION")
    );
    let destination = app
        .path()
        .download_dir()
        .map_err(|e| format!("Não foi possível localizar a pasta Downloads: {e}"))?
        .join(&file_name);

    create_chrome_extension_zip(&source, &destination)?;

    Ok(ChromeExtensionDownloadInfo {
        path: destination.to_string_lossy().to_string(),
        file_name,
    })
}

fn chrome_extension_source_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(CHROME_EXTENSION_RESOURCE_DIR);
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("extension");

    if dev_dir.exists() {
        return Ok(dev_dir);
    }

    Err("Pasta da extensão não encontrada no bundle do app.".to_string())
}

fn create_chrome_extension_zip(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "Origem da extensão não é uma pasta: {}",
            source.display()
        ));
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Não foi possível criar a pasta de download {}: {e}",
                parent.display()
            )
        })?;
    }

    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|e| format!("Não foi possível substituir {}: {e}", destination.display()))?;
    }

    let file = fs::File::create(destination).map_err(|e| {
        format!(
            "Não foi possível criar o arquivo da extensão {}: {e}",
            destination.display()
        )
    })?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    add_directory_to_zip(&mut zip, source, source, options)?;
    zip.finish()
        .map_err(|e| format!("Não foi possível finalizar o arquivo da extensão: {e}"))?;

    Ok(())
}

fn add_directory_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    base: &Path,
    directory: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|e| format!("Não foi possível ler {}: {e}", directory.display()))?
    {
        let entry = entry.map_err(|e| format!("Não foi possível ler item da extensão: {e}"))?;
        let path = entry.path();
        let entry_type = entry
            .file_type()
            .map_err(|e| format!("Não foi possível identificar {}: {e}", path.display()))?;
        let relative_path = path
            .strip_prefix(base)
            .map_err(|e| format!("Não foi possível empacotar {}: {e}", path.display()))?;
        let zip_path = relative_path.to_string_lossy().replace('\\', "/");

        if entry_type.is_dir() {
            zip.add_directory(format!("{zip_path}/"), options)
                .map_err(|e| format!("Não foi possível adicionar {zip_path} ao zip: {e}"))?;
            add_directory_to_zip(zip, base, &path, options)?;
        } else if entry_type.is_file() {
            zip.start_file(&zip_path, options)
                .map_err(|e| format!("Não foi possível adicionar {zip_path} ao zip: {e}"))?;
            let mut file = fs::File::open(&path)
                .map_err(|e| format!("Não foi possível abrir {}: {e}", path.display()))?;
            io::copy(&mut file, zip).map_err(|e| {
                format!("Não foi possível copiar {} para o zip: {e}", path.display())
            })?;
        }
    }

    Ok(())
}

// ── Window commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn show_window(window: tauri::Window) {
    window.show().unwrap();
    window.set_focus().unwrap();
}

#[tauri::command]
fn hide_window(window: tauri::Window) {
    window.hide().unwrap();
}

#[tauri::command]
fn apply_window_mode(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<AppMode>,
    mode: String,
) {
    *state.0.lock().unwrap() = mode.clone();
    match mode.as_str() {
        "window" => {
            let _ = window.set_always_on_top(false);
            let _ = window.set_resizable(true);
            let _ = window.center();
            #[cfg(target_os = "windows")]
            let _ = window.set_skip_taskbar(false);
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        }
        _ => {
            let _ = window.set_always_on_top(true);
            let _ = window.set_resizable(false);
            #[cfg(target_os = "windows")]
            let _ = window.set_skip_taskbar(true);
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppMode(Mutex::new("window".to_string())))
        .setup(|app| {
            // Read saved window mode from store before the window is ever shown
            {
                use tauri_plugin_store::StoreExt;
                let saved_mode = app
                    .store("settings.json")
                    .ok()
                    .and_then(|s| {
                        s.get("settings")?
                            .as_object()?
                            .get("windowMode")?
                            .as_str()
                            .map(|v| v.to_string())
                    })
                    .unwrap_or_else(|| "window".to_string());

                *app.state::<AppMode>().0.lock().unwrap() = saved_mode.clone();

                if let Some(win) = app.get_webview_window("main") {
                    let _ = apply_native_window_corners(&win, 14.0);
                    match saved_mode.as_str() {
                        "window" => {
                            let _ = win.set_always_on_top(false);
                            let _ = win.set_resizable(true);
                            #[cfg(target_os = "macos")]
                            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                        }
                        _ => {
                            let _ = win.set_always_on_top(true);
                            let _ = win.set_resizable(false);
                            #[cfg(target_os = "macos")]
                            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                        }
                    }
                }

                if let Some(toolbar) = app.get_webview_window("toolbar") {
                    let _ = apply_native_window_corners(&toolbar, 16.0);
                }
            }

            let show_item = MenuItem::with_id(app, "show", "Abrir Melhora.AI", true, None::<&str>)?;
            let toolbar_item =
                MenuItem::with_id(app, "toolbar", "Testar Toolbar", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &toolbar_item, &quit_item])?;

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
                .expect("tray icon");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "toolbar" => {
                        if let Some(toolbar) = app.get_webview_window("toolbar") {
                            if toolbar.is_visible().unwrap_or(false) {
                                let _ = toolbar.hide();
                            } else {
                                if let Some(monitor) = toolbar.current_monitor().ok().flatten() {
                                    let size = monitor.size();
                                    let tx = (size.width as f64 / 2.0 - 170.0).max(0.0);
                                    let ty = size.height as f64 * 0.15;
                                    let _ =
                                        toolbar.set_position(tauri::LogicalPosition::new(tx, ty));
                                }
                                let _ = toolbar.show();
                                let _ = toolbar.set_focus();
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                                return;
                            }

                            let mode = app.state::<AppMode>();
                            let mode_str = mode.0.lock().unwrap().clone();

                            if mode_str == "popup" {
                                if let Ok(win_size) = win.outer_size() {
                                    let screen_height = win
                                        .current_monitor()
                                        .ok()
                                        .flatten()
                                        .map(|m| m.size().height)
                                        .unwrap_or(1080);

                                    let screen_width = win
                                        .current_monitor()
                                        .ok()
                                        .flatten()
                                        .map(|m| m.size().width)
                                        .unwrap_or(1920);

                                    // Clamp x so window stays inside screen bounds
                                    let x = (position.x as i32 - (win_size.width / 2) as i32)
                                        .max(8)
                                        .min(screen_width as i32 - win_size.width as i32 - 8);

                                    // Taskbar at bottom (Windows) → open above icon
                                    // Menu bar at top (macOS)    → open below icon
                                    let y = if position.y as u32 > screen_height / 2 {
                                        position.y as i32 - win_size.height as i32 - 4
                                    } else {
                                        position.y as i32 + 4
                                    };

                                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                                }
                            }

                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Start Accessibility watcher
            #[cfg(target_os = "macos")]
            ax_watcher::start(app.handle().clone());

            #[cfg(target_os = "windows")]
            win_watcher::start(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(false) => {
                let mode = window.app_handle().state::<AppMode>();
                let mode_str = mode.0.lock().unwrap().clone();
                if mode_str == "popup" {
                    let _ = window.hide();
                }
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            show_window,
            hide_window,
            apply_window_mode,
            check_ax_permission,
            request_ax_permission,
            inject_result,
            hide_toolbar,
            get_target_pid,
            set_toolbar_enabled,
            apply_window_corners,
            download_chrome_extension,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
