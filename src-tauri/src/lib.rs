#[cfg(target_os = "macos")]
mod ax_watcher;

#[cfg(target_os = "windows")]
mod win_watcher;


use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

static TOOLBAR_ENABLED: AtomicBool = AtomicBool::new(true);


struct AppMode(Mutex<String>);

/// Clips the window to rounded corners at the OS level by setting
/// cornerRadius + masksToBounds on the NSWindow's contentView CALayer.
#[tauri::command]
fn set_corner_radius(window: tauri::WebviewWindow, radius: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSView, NSWindow};
        use cocoa::base::{id, YES};
        use objc::{msg_send, sel, sel_impl};
        window
            .with_webview(move |webview| unsafe {
                let ns_window = webview.ns_window() as id;
                let content_view: id = ns_window.contentView();
                content_view.setWantsLayer(YES);
                let layer: id = msg_send![content_view, layer];
                if !layer.is_null() {
                    let _: () = msg_send![layer, setCornerRadius: radius];
                    let _: () = msg_send![layer, setMasksToBounds: YES];
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, radius);
        Ok(())
    }
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
    { ax_watcher::get_last_pid() }
    #[cfg(not(target_os = "macos"))]
    { None }
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
            }

            let show_item = MenuItem::with_id(app, "show", "Abrir Melhora.AI", true, None::<&str>)?;
            let toolbar_item = MenuItem::with_id(app, "toolbar", "Testar Toolbar", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &toolbar_item, &quit_item])?;

            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/tray.png")
            ).expect("tray icon");

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
                                    let _ = toolbar.set_position(tauri::LogicalPosition::new(tx, ty));
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
        .on_window_event(|window, event| {
            match event {
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
            }
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
            set_corner_radius,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
