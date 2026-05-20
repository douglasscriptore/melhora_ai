use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg(target_os = "macos")]
fn apply_corner_radius(window: &tauri::WebviewWindow, radius: f64) {
    use objc::{msg_send, sel, sel_impl};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    if let Ok(handle) = window.window_handle() {
        if let RawWindowHandle::AppKit(h) = handle.as_raw() {
            unsafe {
                let ns_view = h.ns_view.as_ptr() as *mut objc::runtime::Object;
                let _: () = msg_send![ns_view, setWantsLayer: true];
                let layer: *mut objc::runtime::Object = msg_send![ns_view, layer];
                let _: () = msg_send![layer, setCornerRadius: radius];
                let _: () = msg_send![layer, setMasksToBounds: true];
            }
        }
    }
}

struct AppMode(Mutex<String>);

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppMode(Mutex::new("popup".to_string())))
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
                    .unwrap_or_else(|| "popup".to_string());

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
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

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

            // Apply rounded corners at the OS (CALayer) level on macOS
            #[cfg(target_os = "macos")]
            if let Some(win) = app.get_webview_window("main") {
                apply_corner_radius(&win, 14.0);
            }

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
        .invoke_handler(tauri::generate_handler![show_window, hide_window, apply_window_mode])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
