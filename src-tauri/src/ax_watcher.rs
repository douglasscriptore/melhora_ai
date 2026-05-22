use std::ffi::{c_char, c_void, CString};
use std::io::Write;
use std::ptr::null_mut;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};
use crate::TOOLBAR_ENABLED;
use std::sync::atomic::Ordering;

// ── Global state ──────────────────────────────────────────────────────────────

static LAST_PID: OnceLock<Mutex<Option<i32>>> = OnceLock::new();

fn pid_store() -> &'static Mutex<Option<i32>> {
    LAST_PID.get_or_init(|| Mutex::new(None))
}

pub fn get_last_pid() -> Option<i32> {
    *pid_store().lock().unwrap()
}

fn set_last_pid(pid: Option<i32>) {
    *pid_store().lock().unwrap() = pid;
}

// ── Framework bindings ────────────────────────────────────────────────────────

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> *mut c_void;
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        elem: *mut c_void,
        attr: *mut c_void,
        out: *mut *mut c_void,
    ) -> i32;
    fn AXValueGetValue(value: *mut c_void, value_type: u32, out: *mut c_void) -> bool;
    pub fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: *mut c_void,
        cstr: *const c_char,
        encoding: u32,
    ) -> *mut c_void;
    fn CFStringGetCString(
        s: *mut c_void,
        buf: *mut c_char,
        buf_size: isize,
        encoding: u32,
    ) -> bool;
    fn CFStringGetLength(s: *mut c_void) -> isize;
    fn CFGetTypeID(cf: *mut c_void) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFBooleanGetValue(b: *mut c_void) -> bool;
    fn CFRetain(cf: *mut c_void) -> *mut c_void;
    fn CFRelease(cf: *mut c_void);
    fn CFArrayGetCount(array: *mut c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *mut c_void, index: isize) -> *const c_void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CF_UTF8: u32 = 0x0800_0100;
const AX_CGPOINT: u32 = 1;
const AX_CGSIZE: u32 = 2;

// ── Repr types ────────────────────────────────────────────────────────────────

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

// ── Public payload ────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct FocusPayload {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub text: String,
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn check_permission() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn request_permission_with_prompt() -> bool {
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let key: *mut objc::runtime::Object = msg_send![
            class!(NSString),
            stringWithUTF8String: b"AXTrustedCheckOptionPrompt\0".as_ptr()
        ];
        let val: *mut objc::runtime::Object =
            msg_send![class!(NSNumber), numberWithBool: true];
        let dict: *mut objc::runtime::Object = msg_send![
            class!(NSDictionary),
            dictionaryWithObject: val forKey: key
        ];
        AXIsProcessTrustedWithOptions(dict as *mut c_void)
    }
}

pub fn activate_app(pid: i32) {
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let cls = class!(NSRunningApplication);
        let app: *mut objc::runtime::Object =
            msg_send![cls, runningApplicationWithProcessIdentifier: pid];
        if !app.is_null() {
            let _: () = msg_send![app, activateWithOptions: 2u64];
        }
    }
}

pub fn write_to_clipboard_and_paste(text: &str, pid: Option<i32>) {
    if let Ok(mut child) = std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
    }

    let Some(pid) = pid else { return };

    activate_app(pid);
    std::thread::sleep(std::time::Duration::from_millis(250));

    let _ = std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"a\" using command down",
        ])
        .output();

    std::thread::sleep(std::time::Duration::from_millis(80));

    let _ = std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .output();
}

pub fn start(app_handle: tauri::AppHandle) {
    let our_pid = std::process::id() as i32;

    // If accessibility permission is not granted, emit event and show toolbar
    // with the permission error UI immediately so the user knows what to do.
    if !check_permission() {
        let _ = app_handle.emit("ax-permission-denied", ());
        if let Some(toolbar) = app_handle.get_webview_window("toolbar") {
            if let Some(monitor) = toolbar.current_monitor().ok().flatten() {
                let size = monitor.size();
                let tx = (size.width as f64 / 2.0 - 170.0).max(0.0);
                let ty = size.height as f64 * 0.15;
                let _ = toolbar.set_position(tauri::LogicalPosition::new(tx, ty));
            }
            let tc = toolbar.clone();
            let _ = app_handle.run_on_main_thread(move || {
                show_without_focus(&tc);
            });
        }
    }

    std::thread::spawn(move || {
        let mut was_focused = false;

        loop {
            // 100 ms: faster Chrome AX warm-up + sub-100ms toolbar latency
            std::thread::sleep(std::time::Duration::from_millis(100));

            let front_pid = unsafe { frontmost_app_pid() };
            if front_pid == 0 {
                if was_focused {
                    was_focused = false;
                    set_last_pid(None);
                    let _ = app_handle.emit("ax-focus-lost", ());
                    if let Some(w) = app_handle.get_webview_window("toolbar") {
                        let _ = w.hide();
                    }
                }
                continue;
            }
            // Our own app is frontmost (user clicked a toolbar button).
            // Keep the toolbar visible so the user sees the processing state,
            // and preserve LAST_PID so inject_result can paste back.
            if front_pid == our_pid {
                continue;
            }

            // ── Locate focused text element ───────────────────────────────────
            //
            // Two strategies in sequence; the first one that returns a text
            // element wins.
            //
            // Strategy A: app-specific AXFocusedUIElement + recursive drill.
            //   Preferred because it's app-scoped and usually more accurate.
            //
            // Strategy B: system-wide AXFocusedUIElement + recursive drill.
            //   Fallback for cases where the browser's app-level bridge is slow
            //   to propagate the focus update.
            //
            // drill_to_text() itself has two inner strategies:
            //   1. Follow AXFocusedUIElement recursively (up to 10 levels).
            //   2. When AXFocusedUIElement returns null on a container, walk
            //      AXChildren and find the child marked AXFocused=true.
            //      This handles Chrome's AXGroup containers that don't propagate
            //      AXFocusedUIElement (common with React/Vue components).

            let text_elem = unsafe {
                let app_focused = focused_element_for_pid(front_pid);
                let a = if !app_focused.is_null() {
                    drill_to_text(app_focused)
                } else {
                    null_mut()
                };

                if a.is_null() {
                    let sys_focused = system_wide_focused();
                    if !sys_focused.is_null() {
                        drill_to_text(sys_focused)
                    } else {
                        null_mut()
                    }
                } else {
                    a
                }
            };

            if text_elem.is_null() {
                if was_focused {
                    was_focused = false;
                    set_last_pid(None);
                    let _ = app_handle.emit("ax-focus-lost", ());
                    if let Some(w) = app_handle.get_webview_window("toolbar") {
                        let _ = w.hide();
                    }
                }
                continue;
            }

            let pos = unsafe { ax_cgpoint(text_elem, "AXPosition") }
                .unwrap_or(CGPoint { x: 100.0, y: 100.0 });
            let sz = unsafe { ax_cgsize(text_elem, "AXSize") }
                .unwrap_or(CGSize { width: 200.0, height: 30.0 });
            let text = unsafe { ax_string(text_elem, "AXValue") }.unwrap_or_default();

            unsafe { CFRelease(text_elem) };

            set_last_pid(Some(front_pid));

            let payload = FocusPayload {
                x: pos.x,
                y: pos.y,
                w: sz.width,
                h: sz.height,
                text,
            };

            if let Some(toolbar) = app_handle.get_webview_window("toolbar") {
                const TOOLBAR_W: f64 = 380.0;
                const TOOLBAR_H: f64 = 56.0;
                const GAP:       f64 = 8.0;

                // Center horizontally over the field
                let tx_centered = pos.x + (sz.width / 2.0) - (TOOLBAR_W / 2.0);

                // Prefer above; fall back to below if too close to top of screen
                let ty_above = pos.y - TOOLBAR_H - GAP;
                let ty_below = pos.y + sz.height + GAP;
                let ty = if ty_above >= GAP { ty_above } else { ty_below };

                // Clamp horizontally so toolbar never leaves the screen
                let screen_w = toolbar
                    .current_monitor().ok().flatten()
                    .map(|m| m.size().width as f64 / m.scale_factor())
                    .unwrap_or(1440.0);
                let tx = tx_centered.max(GAP).min(screen_w - TOOLBAR_W - GAP);

                if TOOLBAR_ENABLED.load(Ordering::Relaxed) {
                    let _ = toolbar.set_position(tauri::LogicalPosition::new(tx, ty));
                    if !was_focused {
                        let tc = toolbar.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            show_without_focus(&tc);
                        });
                    }
                }
            }

            let _ = app_handle.emit("ax-focus-changed", payload);
            was_focused = true;
        }
    });
}

// ── Primary drill helper ──────────────────────────────────────────────────────

/// Takes ownership of `start`. Recursively finds the deepest focusable text
/// element reachable from it.
///
/// Inner strategy 1: follow AXFocusedUIElement on each container (up to 10 hops).
/// Inner strategy 2: when AXFocusedUIElement returns null on a container, scan
///   AXChildren for the child that carries AXFocused=true and continue from there.
///   This is necessary for Chromium-based browsers where React/Vue wrapper divs
///   (role AXGroup) don't implement AXFocusedUIElement.
///
/// Returns null (and releases `start`) if no text element is found.
unsafe fn drill_to_text(start: *mut c_void) -> *mut c_void {
    let mut current = start;

    for _ in 0..10 {
        let role = ax_string(current, "AXRole").unwrap_or_default();

        // Found a standard text-input role
        if is_text_role(&role) {
            return current;
        }

        if is_container_role(&role) {
            // ── Inner strategy 1: AXFocusedUIElement ─────────────────────────
            let mut inner: *mut c_void = null_mut();
            let attr = make_cfstr("AXFocusedUIElement");
            if !attr.is_null() {
                AXUIElementCopyAttributeValue(current, attr, &mut inner);
                CFRelease(attr);
            }

            if !inner.is_null() {
                CFRelease(current);
                current = inner;
                continue;
            }

            // ── Inner strategy 2: AXChildren walk ────────────────────────────
            // AXFocusedUIElement returned null — the container doesn't propagate
            // focus itself (common with Chromium's intermediate AXGroup wrappers).
            // Walk immediate children looking for AXFocused=true.
            // Depth 12 handles Chrome's deep AXWebArea trees (7+ nested AXGroups).
            let child = focused_text_in_children(current, 12);
            CFRelease(current);
            return child; // may be null
        }

        // Non-container, non-text-role: accept if explicitly marked editable
        // (catches contenteditable divs that Chrome reports as AXGroup but the
        //  actual "editable" attribute is on a deeper element with unknown role)
        if ax_bool(current, "AXEditable").unwrap_or(false) {
            return current;
        }

        CFRelease(current);
        return null_mut();
    }

    CFRelease(current);
    null_mut()
}

// ── AXChildren walker ─────────────────────────────────────────────────────────

/// Recursively searches `container`'s AXChildren subtree for an element that
/// has AXFocused=true and is either a text role or AXEditable.
///
/// `max_depth` limits recursion to avoid scanning the entire page DOM.
/// Returns a CFRetain'd pointer (caller must CFRelease), or null.
unsafe fn focused_text_in_children(container: *mut c_void, max_depth: u32) -> *mut c_void {
    if max_depth == 0 {
        return null_mut();
    }

    let mut children_val: *mut c_void = null_mut();
    let attr = make_cfstr("AXChildren");
    if attr.is_null() {
        return null_mut();
    }
    AXUIElementCopyAttributeValue(container, attr, &mut children_val);
    CFRelease(attr);
    if children_val.is_null() {
        return null_mut();
    }

    let count = CFArrayGetCount(children_val);
    let mut result: *mut c_void = null_mut();

    'search: for i in 0..count {
        // CFArrayGetValueAtIndex returns a non-owning pointer; CFRetain to use it.
        let child_ptr = CFArrayGetValueAtIndex(children_val, i);
        if child_ptr.is_null() {
            continue;
        }
        let child = child_ptr as *mut c_void;

        let role = ax_string(child, "AXRole").unwrap_or_default();

        // ── Case 1: leaf text-input element ──────────────────────────────────
        let is_text = is_text_role(&role);
        let is_editable = !is_text
            && !is_container_role(&role)
            && ax_bool(child, "AXEditable").unwrap_or(false);

        if is_text || is_editable {
            if ax_bool(child, "AXFocused").unwrap_or(false) {
                result = CFRetain(child);
                break 'search;
            }
            // Text/editable but not focused — keep searching
            continue;
        }

        // ── Case 2: container — may hold the focused element ─────────────────
        if is_container_role(&role) {
            // First try AXFocusedUIElement on this container (fast path)
            let mut focused_child: *mut c_void = null_mut();
            let fattr = make_cfstr("AXFocusedUIElement");
            if !fattr.is_null() {
                AXUIElementCopyAttributeValue(child, fattr, &mut focused_child);
                CFRelease(fattr);
            }

            if !focused_child.is_null() {
                // Got a focused descendant from AXFocusedUIElement;
                // pass it to drill_to_text which handles further nesting.
                result = drill_to_text(focused_child); // takes ownership
                if !result.is_null() {
                    break 'search;
                }
                // drill_to_text released focused_child; no result, keep looking
            }

            // AXFocusedUIElement returned null — recurse via children
            let sub = focused_text_in_children(child, max_depth - 1);
            if !sub.is_null() {
                result = sub;
                break 'search;
            }
        }
    }

    CFRelease(children_val);
    result
}

// ── Role classification ───────────────────────────────────────────────────────

fn is_text_role(role: &str) -> bool {
    matches!(
        role,
        "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField"
    )
}

fn is_container_role(role: &str) -> bool {
    matches!(
        role,
        "AXApplication"
            | "AXWindow"
            | "AXSheet"
            | "AXWebArea"
            | "AXScrollArea"
            | "AXGroup"
            | "AXGenericElement"
            | "AXSplitGroup"
            | "AXTabGroup"
            | "AXToolbar"
            | "AXSplitter"
            | "AXList"
            | "AXOutline"
            | "AXTable"
            | "AXRow"
            | "AXCell"
    )
}

// ── Entry-point queries ───────────────────────────────────────────────────────

unsafe fn frontmost_app_pid() -> i32 {
    use objc::{class, msg_send, sel, sel_impl};
    let ws: *mut objc::runtime::Object =
        msg_send![class!(NSWorkspace), sharedWorkspace];
    let front: *mut objc::runtime::Object = msg_send![ws, frontmostApplication];
    if front.is_null() {
        return 0;
    }
    let pid: i32 = msg_send![front, processIdentifier];
    pid
}

unsafe fn focused_element_for_pid(pid: i32) -> *mut c_void {
    let app_elem = AXUIElementCreateApplication(pid);
    if app_elem.is_null() {
        return null_mut();
    }
    let mut focused: *mut c_void = null_mut();
    let attr = make_cfstr("AXFocusedUIElement");
    if attr.is_null() {
        CFRelease(app_elem);
        return null_mut();
    }
    let err = AXUIElementCopyAttributeValue(app_elem, attr, &mut focused);
    CFRelease(attr);
    CFRelease(app_elem);
    if err != 0 || focused.is_null() {
        null_mut()
    } else {
        focused
    }
}

unsafe fn system_wide_focused() -> *mut c_void {
    let system_wide = AXUIElementCreateSystemWide();
    if system_wide.is_null() {
        return null_mut();
    }
    let mut focused: *mut c_void = null_mut();
    let attr = make_cfstr("AXFocusedUIElement");
    if !attr.is_null() {
        AXUIElementCopyAttributeValue(system_wide, attr, &mut focused);
        CFRelease(attr);
    }
    CFRelease(system_wide);
    focused
}

// ── Low-level AX attribute readers ───────────────────────────────────────────

unsafe fn make_cfstr(s: &str) -> *mut c_void {
    let Ok(cstr) = CString::new(s) else {
        return null_mut();
    };
    CFStringCreateWithCString(null_mut(), cstr.as_ptr(), CF_UTF8)
}

unsafe fn cfstr_to_rust(cf: *mut c_void) -> Option<String> {
    if cf.is_null() {
        return None;
    }
    if CFGetTypeID(cf) != CFStringGetTypeID() {
        return None;
    }
    let len = CFStringGetLength(cf);
    let cap = (len * 4 + 4) as usize;
    let mut buf = vec![0u8; cap];
    if CFStringGetCString(cf, buf.as_mut_ptr() as *mut c_char, cap as isize, CF_UTF8) {
        let end = buf.iter().position(|&b| b == 0).unwrap_or(0);
        Some(String::from_utf8_lossy(&buf[..end]).into_owned())
    } else {
        None
    }
}

unsafe fn ax_string(elem: *mut c_void, attr: &str) -> Option<String> {
    let attr_cf = make_cfstr(attr);
    if attr_cf.is_null() {
        return None;
    }
    let mut val: *mut c_void = null_mut();
    let err = AXUIElementCopyAttributeValue(elem, attr_cf, &mut val);
    CFRelease(attr_cf);
    if err != 0 || val.is_null() {
        return None;
    }
    let result = cfstr_to_rust(val);
    CFRelease(val);
    result
}

unsafe fn ax_bool(elem: *mut c_void, attr: &str) -> Option<bool> {
    let attr_cf = make_cfstr(attr);
    if attr_cf.is_null() {
        return None;
    }
    let mut val: *mut c_void = null_mut();
    let err = AXUIElementCopyAttributeValue(elem, attr_cf, &mut val);
    CFRelease(attr_cf);
    if err != 0 || val.is_null() {
        return None;
    }
    let result = CFBooleanGetValue(val);
    CFRelease(val);
    Some(result)
}

unsafe fn ax_cgpoint(elem: *mut c_void, attr: &str) -> Option<CGPoint> {
    let attr_cf = make_cfstr(attr);
    if attr_cf.is_null() {
        return None;
    }
    let mut val: *mut c_void = null_mut();
    let err = AXUIElementCopyAttributeValue(elem, attr_cf, &mut val);
    CFRelease(attr_cf);
    if err != 0 || val.is_null() {
        return None;
    }
    let mut pt = CGPoint { x: 0.0, y: 0.0 };
    let ok = AXValueGetValue(val, AX_CGPOINT, &mut pt as *mut _ as *mut c_void);
    CFRelease(val);
    if ok { Some(pt) } else { None }
}

unsafe fn ax_cgsize(elem: *mut c_void, attr: &str) -> Option<CGSize> {
    let attr_cf = make_cfstr(attr);
    if attr_cf.is_null() {
        return None;
    }
    let mut val: *mut c_void = null_mut();
    let err = AXUIElementCopyAttributeValue(elem, attr_cf, &mut val);
    CFRelease(attr_cf);
    if err != 0 || val.is_null() {
        return None;
    }
    let mut sz = CGSize { width: 0.0, height: 0.0 };
    let ok = AXValueGetValue(val, AX_CGSIZE, &mut sz as *mut _ as *mut c_void);
    CFRelease(val);
    if ok { Some(sz) } else { None }
}

// ── Window helper ─────────────────────────────────────────────────────────────

fn show_without_focus(win: &tauri::WebviewWindow) {
    use objc::{msg_send, sel, sel_impl};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    if let Ok(handle) = win.window_handle() {
        if let RawWindowHandle::AppKit(h) = handle.as_raw() {
            unsafe {
                let ns_view = h.ns_view.as_ptr() as *mut objc::runtime::Object;
                let ns_win: *mut objc::runtime::Object = msg_send![ns_view, window];
                if !ns_win.is_null() {
                    let _: () = msg_send![ns_win, orderFrontRegardless];
                }
            }
        }
    }
}
