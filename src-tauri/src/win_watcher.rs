use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

static LAST_HWND: OnceLock<Mutex<isize>> = OnceLock::new();

fn hwnd_store() -> &'static Mutex<isize> {
    LAST_HWND.get_or_init(|| Mutex::new(0))
}

pub fn get_last_hwnd() -> isize {
    *hwnd_store().lock().unwrap()
}

fn set_last_hwnd(hwnd: isize) {
    *hwnd_store().lock().unwrap() = hwnd;
}

#[derive(Clone, serde::Serialize)]
pub struct FocusPayload {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub text: String,
}

pub fn write_to_clipboard_and_paste(text: &str) {
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

    if let Ok(mut cb) = arboard::Clipboard::new() {
        let _ = cb.set_text(text);
    }

    let hwnd = get_last_hwnd();
    if hwnd == 0 {
        return;
    }

    unsafe { SetForegroundWindow(HWND(hwnd as *mut c_void)) };
    std::thread::sleep(std::time::Duration::from_millis(200));

    send_key_combo(VK_CONTROL, VK_A);
    std::thread::sleep(std::time::Duration::from_millis(50));
    send_key_combo(VK_CONTROL, VK_V);
}

fn send_key_combo(modifier: VIRTUAL_KEY, key: VIRTUAL_KEY) {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    unsafe {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: modifier,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYDOWN,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: key,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYDOWN,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: key,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: modifier,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

pub fn show_without_focus(win: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::*;

    if let Ok(handle) = win.window_handle() {
        if let RawWindowHandle::Win32(h) = handle.as_raw() {
            unsafe {
                SetWindowPos(
                    HWND(h.hwnd.get() as *mut c_void),
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    }
}

pub fn start(app_handle: tauri::AppHandle) {
    use windows::core::*;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Accessibility::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    let our_pid = std::process::id();

    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let automation: IUIAutomation =
                match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                    Ok(a) => a,
                    Err(_) => return,
                };

            let mut was_focused = false;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(300));

                let fg_hwnd: HWND = GetForegroundWindow();
                let mut fg_pid: u32 = 0;
                GetWindowThreadProcessId(fg_hwnd, Some(&mut fg_pid as *mut u32));

                // Skip our own app — don't hide toolbar when user clicks toolbar buttons
                if fg_pid == our_pid {
                    continue;
                }

                if fg_pid == 0 {
                    if was_focused {
                        was_focused = false;
                        set_last_hwnd(0);
                        let _ = app_handle.emit("ax-focus-lost", ());
                        if let Some(w) = app_handle.get_webview_window("toolbar") {
                            let _ = w.hide();
                        }
                    }
                    continue;
                }

                let focused = match automation.GetFocusedElement() {
                    Ok(el) => el,
                    Err(_) => {
                        if was_focused {
                            was_focused = false;
                            set_last_hwnd(0);
                            let _ = app_handle.emit("ax-focus-lost", ());
                            if let Some(w) = app_handle.get_webview_window("toolbar") {
                                let _ = w.hide();
                            }
                        }
                        continue;
                    }
                };

                let ctrl_type = match focused.CurrentControlType() {
                    Ok(t) => t,
                    Err(_) => continue,
                };

                let is_text = matches!(
                    ctrl_type,
                    UIA_EditControlTypeId | UIA_ComboBoxControlTypeId | UIA_DocumentControlTypeId
                );

                if !is_text {
                    if was_focused {
                        was_focused = false;
                        set_last_hwnd(0);
                        let _ = app_handle.emit("ax-focus-lost", ());
                        if let Some(w) = app_handle.get_webview_window("toolbar") {
                            let _ = w.hide();
                        }
                    }
                    continue;
                }

                let rect = match focused.CurrentBoundingRectangle() {
                    Ok(r) => r,
                    Err(_) => continue,
                };

                let text = get_element_text(&focused).unwrap_or_default();

                set_last_hwnd(fg_hwnd.0 as isize);

                let payload = FocusPayload {
                    x: rect.left as f64,
                    y: rect.top as f64,
                    w: (rect.right - rect.left) as f64,
                    h: (rect.bottom - rect.top) as f64,
                    text,
                };

                if let Some(toolbar) = app_handle.get_webview_window("toolbar") {
                    let tx = rect.left as i32;
                    let ty = rect.bottom + 8;
                    let _ = toolbar.set_position(tauri::PhysicalPosition::new(tx, ty));
                    if !was_focused {
                        let tc = toolbar.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            show_without_focus(&tc);
                        });
                    }
                }

                let _ = app_handle.emit("ax-focus-changed", payload);
                was_focused = true;
            }
        }
    });
}

unsafe fn get_element_text(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
) -> Option<String> {
    use windows::core::Interface;
    use windows::Win32::UI::Accessibility::*;

    // ValuePattern — works for standard inputs and browser inputs
    if let Ok(pattern_obj) = element.GetCurrentPattern(UIA_ValuePatternId) {
        if let Ok(vp) = pattern_obj.cast::<IUIAutomationValuePattern>() {
            if let Ok(val) = vp.CurrentValue() {
                return Some(val.to_string());
            }
        }
    }

    // TextPattern — works for rich text / document controls
    if let Ok(pattern_obj) = element.GetCurrentPattern(UIA_TextPatternId) {
        if let Ok(tp) = pattern_obj.cast::<IUIAutomationTextPattern>() {
            if let Ok(range) = tp.DocumentRange() {
                if let Ok(text) = range.GetText(-1) {
                    return Some(text.to_string());
                }
            }
        }
    }

    None
}
