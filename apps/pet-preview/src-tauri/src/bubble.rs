//! Window geometry for the input bubble beside the preview pet.
//!
//! The pet window only grows while the bubble is open (pet column + bubble
//! area, and taller for the bubble) and shrinks back when it closes, so no
//! large transparent area is left over other apps. The pet itself never moves
//! on screen when the bubble opens or closes: the window grows away from it,
//! sideways on the chosen side and vertically up (or down near the top edge).

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

/// Logical width added beside the pet column while open: 12px gap + 300px
/// bubble + 8px edge margin. Must match `--bubble-area` in
/// `ui/bubble/input-bubble.css`.
const AREA_WIDTH: f64 = 320.0;
/// Logical window height while open: 8px + 252px bubble + 8px. Must match
/// the bubble height and margins in `ui/bubble/input-bubble.css`.
const AREA_HEIGHT: f64 = 268.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Side {
    Left,
    Right,
}

impl Side {
    fn name(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }
}

/// Vertical growth: `Up` keeps the pet at the bottom of the taller window.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
enum Vert {
    #[default]
    Up,
    Down,
}

impl Vert {
    fn name(self) -> &'static str {
        match self {
            Vert::Up => "up",
            Vert::Down => "down",
        }
    }
}

#[derive(Serialize)]
pub struct Layout {
    side: &'static str,
    vert: &'static str,
}

#[derive(Default)]
pub struct BubbleState {
    /// Open side, or `None` while the bubble is closed.
    side: Option<Side>,
    /// Physical width added for the bubble when it was opened.
    area: i32,
    /// Physical width of the pet column (the closed window width).
    pet_width: i32,
    /// Vertical growth direction while open.
    vert: Vert,
    /// Physical height added for the bubble when it was opened.
    extra: i32,
    /// Physical height of the pet (the closed window height).
    pet_height: i32,
}

pub type SharedBubble = Mutex<BubbleState>;

fn with_state<R>(app: &AppHandle, f: impl FnOnce(&mut BubbleState) -> R) -> R {
    let state = app.state::<SharedBubble>();
    let mut guard = state.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard)
}

/// Screen position of the pet column's top-left corner, whether or not the
/// bubble is open on its left.
pub fn pet_origin(app: &AppHandle, window: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let position = window.outer_position().ok()?;
    let (dx, dy) = with_state(app, |s| match s.side {
        None => (0, 0),
        Some(side) => (
            if side == Side::Left { s.area } else { 0 },
            if s.vert == Vert::Up { s.extra } else { 0 },
        ),
    });
    Some(PhysicalPosition::new(position.x + dx, position.y + dy))
}

/// Forget the open bubble (the window is about to be destroyed).
pub fn reset(app: &AppHandle) {
    with_state(app, |s| s.side = None);
}

struct Geometry {
    origin: PhysicalPosition<i32>,
    pet_width: i32,
    pet_height: i32,
    area: i32,
    /// Height added while open.
    extra: i32,
}

fn geometry(app: &AppHandle, window: &WebviewWindow) -> Option<Geometry> {
    let origin = pet_origin(app, window)?;
    let size = window.outer_size().ok()?;
    let (open, pet_width, pet_height) = with_state(app, |s| (s.side.is_some(), s.pet_width, s.pet_height));
    let scale = window.scale_factor().ok()?;
    let pet_height = if open { pet_height } else { size.height as i32 };
    Some(Geometry {
        origin,
        pet_width: if open { pet_width } else { size.width as i32 },
        pet_height,
        area: (AREA_WIDTH * scale).round() as i32,
        extra: ((AREA_HEIGHT * scale).round() as i32 - pet_height).max(0),
    })
}

/// Prefers the right side; uses the left when the right does not fit on the
/// monitor that holds the pet (work area, taskbar excluded). When neither
/// fits, the side with more room wins. Vertically the window grows upwards
/// unless there is not enough room above the pet, then downwards.
fn choose_layout(window: &WebviewWindow, g: &Geometry) -> (Side, Vert) {
    let center = (g.origin.x + g.pet_width / 2, g.origin.y + g.pet_height / 2);
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors
        .iter()
        .find(|m| {
            let (p, s) = (m.position(), m.size());
            center.0 >= p.x
                && center.0 < p.x + s.width as i32
                && center.1 >= p.y
                && center.1 < p.y + s.height as i32
        })
        .cloned()
        .or_else(|| window.current_monitor().ok().flatten());
    let Some(monitor) = monitor else { return (Side::Right, Vert::Up) };
    let work = monitor.work_area();
    let left_room = g.origin.x - work.position.x;
    let right_room = work.position.x + work.size.width as i32 - (g.origin.x + g.pet_width);
    let side = if right_room >= g.area {
        Side::Right
    } else if left_room >= g.area || left_room > right_room {
        Side::Left
    } else {
        Side::Right
    };
    let up_room = g.origin.y - work.position.y;
    let down_room = work.position.y + work.size.height as i32 - (g.origin.y + g.pet_height);
    let vert = if up_room >= g.extra || up_room >= down_room { Vert::Up } else { Vert::Down };
    (side, vert)
}

#[cfg(windows)]
fn set_bounds(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    use core::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(hwnd: *mut c_void, after: *mut c_void, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // One call moves and resizes together, so the pet does not jump between
    // a separate move and resize.
    // SAFETY: `hwnd` is this app's live window handle.
    let ok = unsafe {
        SetWindowPos(hwnd.0 as *mut c_void, core::ptr::null_mut(), x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE)
    };
    if ok == 0 {
        Err("창 크기를 바꾸지 못했습니다.".into())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn set_bounds(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width.max(1) as u32, height.max(1) as u32))
        .map_err(|e| e.to_string())
}

fn window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(crate::pet::LABEL).ok_or_else(|| "펫 창이 없습니다.".into())
}

/// Layout the bubble should use from the pet's current position. The page
/// arranges itself for it before asking for the resize.
#[tauri::command]
pub fn pet_bubble_side(app: AppHandle) -> Result<Layout, String> {
    let window = window(&app)?;
    let g = geometry(&app, &window).ok_or("펫 위치를 읽을 수 없습니다.")?;
    let (side, vert) = choose_layout(&window, &g);
    Ok(Layout { side: side.name(), vert: vert.name() })
}

/// Grows the window on `side` (`"left"`/`"right"`) and `vert`
/// (`"up"`/`"down"`), or shrinks it back to the pet (`side: null`), keeping
/// the pet where it is on screen.
#[tauri::command]
pub fn pet_bubble_resize(app: AppHandle, side: Option<String>, vert: Option<String>) -> Result<(), String> {
    let window = window(&app)?;
    let g = geometry(&app, &window).ok_or("펫 위치를 읽을 수 없습니다.")?;
    let side = match side.as_deref() {
        None => None,
        Some("left") => Some(Side::Left),
        Some("right") => Some(Side::Right),
        Some(other) => return Err(format!("알 수 없는 방향: {other}")),
    };
    let vert = match vert.as_deref() {
        None | Some("up") => Vert::Up,
        Some("down") => Vert::Down,
        Some(other) => return Err(format!("알 수 없는 방향: {other}")),
    };
    let (x, width) = match side {
        None => (g.origin.x, g.pet_width),
        Some(Side::Right) => (g.origin.x, g.pet_width + g.area),
        Some(Side::Left) => (g.origin.x - g.area, g.pet_width + g.area),
    };
    let (y, height) = match (side, vert) {
        (None, _) => (g.origin.y, g.pet_height),
        (Some(_), Vert::Up) => (g.origin.y - g.extra, g.pet_height + g.extra),
        (Some(_), Vert::Down) => (g.origin.y, g.pet_height + g.extra),
    };
    set_bounds(&window, x, y, width, height)?;
    with_state(&app, |s| {
        s.side = side;
        s.area = g.area;
        s.pet_width = g.pet_width;
        s.vert = vert;
        s.extra = g.extra;
        s.pet_height = g.pet_height;
    });
    Ok(())
}

/// Resolves once the primary mouse button is released (or after 60 s). A
/// native window drag swallows the page's pointer-up, so the page uses this
/// to know when a drag has ended.
#[tauri::command]
pub async fn pet_wait_mouse_up() {
    let _ = tauri::async_runtime::spawn_blocking(|| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        while button_down() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    })
    .await;
}

#[cfg(windows)]
fn button_down() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    const VK_LBUTTON: i32 = 0x01;
    // SAFETY: reads the global async key state; no pointers involved.
    unsafe { GetAsyncKeyState(VK_LBUTTON) < 0 }
}

#[cfg(not(windows))]
fn button_down() -> bool {
    false
}
