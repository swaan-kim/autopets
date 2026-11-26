//! Is the point under a dropped pet on a Codex Desktop window? Read-only: the windows are only
//! listed and inspected (position, style, owning process). Nothing is sent to them, and no window
//! is moved, focused or changed.
//!
//! The first window in Z-order (topmost first) that a mouse click at the point would reach decides.
//! AutoPets' own windows (the pets) are skipped. It is Codex when its process is `Codex.exe` from the
//! `OpenAI.Codex_*` app package (the same package also ships `ChatGPT.exe`, which does not count).

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WindowInfo {
    pub(crate) left: i32,
    pub(crate) top: i32,
    pub(crate) right: i32,
    pub(crate) bottom: i32,
    pub(crate) visible: bool,
    pub(crate) minimized: bool,
    /// Hidden by the shell (another virtual desktop, a suspended app).
    pub(crate) cloaked: bool,
    pub(crate) ex_style: u32,
    pub(crate) pid: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProcessInfo { pub(crate) exe_name: String, pub(crate) package_family: Option<String> }

const WS_EX_TRANSPARENT: u32 = 0x20;
const WS_EX_LAYERED: u32 = 0x80000;
/// Codex menus and tooltips are separate small windows; only a real chat window counts.
const MIN_WIDTH: i32 = 320;
const MIN_HEIGHT: i32 = 240;

pub(crate) fn is_codex_process(process: &ProcessInfo) -> bool {
    process.exe_name.eq_ignore_ascii_case("Codex.exe")
        && process.package_family.as_deref().is_some_and(|family| family.starts_with("OpenAI.Codex_"))
}

/// The window a click at (x, y) reaches, skipping our own process: visible, not minimized or cloaked,
/// and not click-through (a layered + transparent overlay lets the click pass).
pub(crate) fn window_at(windows: &[WindowInfo], x: i32, y: i32, own_pid: u32) -> Option<&WindowInfo> {
    windows.iter().find(|w| {
        w.pid != own_pid && w.visible && !w.minimized && !w.cloaked
            && !(w.ex_style & WS_EX_TRANSPARENT != 0 && w.ex_style & WS_EX_LAYERED != 0)
            && x >= w.left && x < w.right && y >= w.top && y < w.bottom
    })
}

pub(crate) fn codex_at(windows: &[WindowInfo], x: i32, y: i32, own_pid: u32, process: impl Fn(u32) -> Option<ProcessInfo>) -> bool {
    window_at(windows, x, y, own_pid).is_some_and(|w| {
        w.right - w.left >= MIN_WIDTH && w.bottom - w.top >= MIN_HEIGHT && process(w.pid).as_ref().is_some_and(is_codex_process)
    })
}

/// Physical screen point (the pet body's centre). False on any failure.
#[cfg(windows)]
pub(crate) fn codex_window_at(x: i32, y: i32) -> bool {
    let windows = win32::list();
    codex_at(&windows, x, y, std::process::id(), win32::process)
}
#[cfg(not(windows))]
pub(crate) fn codex_window_at(_x: i32, _y: i32) -> bool { false }

#[cfg(windows)]
mod win32 {
    use super::{ProcessInfo, WindowInfo};
    use std::ffi::c_void;
    type Hwnd = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> i32, param: isize) -> i32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
        fn IsIconic(hwnd: Hwnd) -> i32;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetWindowLongW(hwnd: Hwnd, index: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(hwnd: Hwnd, attribute: u32, value: *mut c_void, size: u32) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn QueryFullProcessImageNameW(process: *mut c_void, flags: u32, name: *mut u16, size: *mut u32) -> i32;
        fn GetPackageFamilyName(process: *mut c_void, length: *mut u32, name: *mut u16) -> i32;
    }
    const GWL_EXSTYLE: i32 = -20;
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    const DWMWA_CLOAKED: u32 = 14;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    extern "system" fn collect(hwnd: Hwnd, param: isize) -> i32 {
        let out = unsafe { &mut *(param as *mut Vec<WindowInfo>) };
        if out.len() >= 4096 { return 0; }
        unsafe {
            // The visible frame (without the invisible resize border), else the window rect.
            let mut rect = Rect::default();
            if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, (&mut rect as *mut Rect).cast(), std::mem::size_of::<Rect>() as u32) != 0
                && GetWindowRect(hwnd, &mut rect) == 0 { return 1; }
            let mut cloaked: u32 = 0;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4);
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            out.push(WindowInfo {
                left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                visible: IsWindowVisible(hwnd) != 0, minimized: IsIconic(hwnd) != 0, cloaked: cloaked != 0,
                ex_style: GetWindowLongW(hwnd, GWL_EXSTYLE) as u32, pid,
            });
        }
        1
    }

    /// Top-level windows, topmost first (EnumWindows follows the Z-order).
    pub(super) fn list() -> Vec<WindowInfo> {
        let mut windows: Vec<WindowInfo> = Vec::new();
        unsafe { EnumWindows(collect, (&mut windows as *mut Vec<WindowInfo>) as isize); }
        windows
    }

    pub(super) fn process(pid: u32) -> Option<ProcessInfo> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() { return None; }
            let mut path = vec![0u16; 1024];
            let mut size = path.len() as u32;
            let exe = (QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut size) != 0)
                .then(|| String::from_utf16_lossy(&path[..size as usize]));
            let mut family = vec![0u16; 256];
            let mut length = family.len() as u32;
            // ERROR_SUCCESS (0) only for a packaged process.
            let package_family = (GetPackageFamilyName(handle, &mut length, family.as_mut_ptr()) == 0)
                .then(|| String::from_utf16_lossy(&family[..(length as usize).saturating_sub(1)]));
            CloseHandle(handle);
            let exe_name = exe?.rsplit(['\\', '/']).next()?.to_owned();
            Some(ProcessInfo { exe_name, package_family })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(pid: u32, left: i32, top: i32, right: i32, bottom: i32) -> WindowInfo {
        WindowInfo { left, top, right, bottom, visible: true, minimized: false, cloaked: false, ex_style: 0, pid }
    }
    const OWN: u32 = 1;
    const CODEX: u32 = 20;
    const CHATGPT: u32 = 21;
    const EDITOR: u32 = 30;
    fn process(pid: u32) -> Option<ProcessInfo> {
        let family = Some("OpenAI.Codex_2p2nqsd0c76g0".to_owned());
        match pid {
            CODEX => Some(ProcessInfo { exe_name: "Codex.exe".into(), package_family: family }),
            CHATGPT => Some(ProcessInfo { exe_name: "ChatGPT.exe".into(), package_family: family }),
            EDITOR => Some(ProcessInfo { exe_name: "Code.exe".into(), package_family: None }),
            _ => None,
        }
    }

    #[test]
    fn the_codex_window_under_the_pet_counts_but_the_pet_itself_does_not() {
        let windows = [window(OWN, 900, 500, 1080, 730), window(CODEX, 100, 100, 1300, 900)];
        assert!(codex_at(&windows, 990, 594, OWN, process));
        assert!(!codex_at(&windows, 1350, 594, OWN, process), "outside every window");
    }

    #[test]
    fn a_window_in_front_of_codex_decides() {
        let windows = [window(OWN, 900, 500, 1080, 730), window(EDITOR, 800, 400, 1200, 800), window(CODEX, 100, 100, 1300, 900)];
        assert!(!codex_at(&windows, 990, 594, OWN, process));
        assert!(codex_at(&windows, 300, 300, OWN, process));
    }

    #[test]
    fn hidden_minimized_cloaked_and_click_through_windows_are_skipped() {
        for change in [
            |w: &mut WindowInfo| w.visible = false,
            |w: &mut WindowInfo| w.minimized = true,
            |w: &mut WindowInfo| w.cloaked = true,
            |w: &mut WindowInfo| w.ex_style = WS_EX_TRANSPARENT | WS_EX_LAYERED,
        ] {
            let mut front = window(EDITOR, 0, 0, 2000, 2000);
            change(&mut front);
            let windows = [front, window(CODEX, 100, 100, 1300, 900)];
            assert!(codex_at(&windows, 500, 500, OWN, process));
        }
        // A layered window that still takes clicks is in front.
        let mut layered = window(EDITOR, 0, 0, 2000, 2000);
        layered.ex_style = WS_EX_LAYERED;
        assert!(!codex_at(&[layered, window(CODEX, 100, 100, 1300, 900)], 500, 500, OWN, process));
    }

    #[test]
    fn only_codex_exe_from_the_codex_package_counts() {
        assert!(!codex_at(&[window(CHATGPT, 0, 0, 1200, 900)], 500, 500, OWN, process), "ChatGPT ships in the same package");
        assert!(!codex_at(&[window(99, 0, 0, 1200, 900)], 500, 500, OWN, process), "process unreadable");
        assert!(!is_codex_process(&ProcessInfo { exe_name: "Codex.exe".into(), package_family: None }), "an unpackaged Codex.exe");
        assert!(!is_codex_process(&ProcessInfo { exe_name: "Codex.exe".into(), package_family: Some("Other.Codex_x".into()) }));
        assert!(!codex_at(&[window(CODEX, 0, 0, 300, 200)], 100, 100, OWN, process), "a small Codex menu or tooltip");
    }

    /// Manual, read-only check on the real desktop (`cargo test live_desktop -- --ignored --nocapture`):
    /// lists the visible Codex windows and whether their centre is found as Codex. Sends nothing.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_desktop_codex_windows() {
        let windows = win32::list();
        let shown: Vec<&WindowInfo> = windows.iter().filter(|w| w.visible && !w.minimized && !w.cloaked).collect();
        println!("top-level windows: {}, shown: {}", windows.len(), shown.len());
        for w in shown.iter().filter(|w| win32::process(w.pid).as_ref().is_some_and(is_codex_process)) {
            let (x, y) = ((w.left + w.right) / 2, (w.top + w.bottom) / 2);
            println!("codex window {}x{} at ({}, {}): centre found as Codex = {}", w.right - w.left, w.bottom - w.top, w.left, w.top, codex_window_at(x, y));
        }
        println!("this test process itself: {:?}", win32::process(std::process::id()).map(|p| p.exe_name));
    }
}
