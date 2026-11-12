//! Edge docking: a pet dropped at the left or right edge of the desktop tucks
//! into a small handle there, and a click on the handle brings it back.
//!
//! The native pet window itself shrinks to the handle and always stays inside
//! a monitor's work area, so a docked pet can never be lost off screen. The
//! saved position keeps the restore point plus the edge (`positions.json`).
use super::windows::{clamp_to_work_area, save_positions, Desktop, Position};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Edge {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Rect {
    pub(crate) left: i32,
    pub(crate) top: i32,
    pub(crate) width: i32,
    pub(crate) height: i32,
}
impl Rect {
    fn right(&self) -> i32 { self.left + self.width }
    fn bottom(&self) -> i32 { self.top + self.height }
    fn contains(&self, x: i32, y: i32) -> bool { x >= self.left && x < self.right() && y >= self.top && y < self.bottom() }
    fn distance(&self, x: i32, y: i32) -> i64 {
        let dx = i64::from((self.left - x).max(x - (self.right() - 1)).max(0));
        let dy = i64::from((self.top - y).max(y - (self.bottom() - 1)).max(0));
        dx * dx + dy * dy
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Screen {
    pub(crate) bounds: Rect,
    pub(crate) work: Rect,
    pub(crate) scale: f64,
}

/// Collapsed pet window size (logical px), as built in `runtime::setup`.
pub(crate) const PET_W: f64 = 180.0;
pub(crate) const PET_H: f64 = 230.0;
/// The docked handle window (logical px).
pub(crate) const HANDLE_W: f64 = 36.0;
pub(crate) const HANDLE_H: f64 = 84.0;
/// From the pet window's top to the middle of the pet body (logical px).
const BODY_CENTER_Y: f64 = 94.0;
/// A drop whose pet body is this close to (or past) the edge docks there (logical px).
pub(crate) const EDGE_THRESHOLD: f64 = 24.0;
const WATCH_LIMIT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub(crate) struct PetDocks {
    /// The edge a just-released pet may tuck into, with that screen's work area.
    pending: Mutex<HashMap<String, (Edge, Rect)>>,
    watching: Mutex<HashSet<String>>,
}

/// Which edge a pet released here should tuck into. Only the outer edges of the
/// desktop count: an edge shared with another monitor is a normal move across.
/// The screen is the one showing the body's middle (or the nearest, for a body pushed past the edge).
pub(crate) fn dock_edge(body_left: i32, body_right: i32, body_y: i32, screens: &[Screen]) -> Option<(Edge, Rect)> {
    let screen = nearest_screen(screens, (body_left + body_right) / 2, body_y)?;
    let threshold = (EDGE_THRESHOLD * screen.scale).round() as i32;
    let open = |x: i32| !screens.iter().any(|s| s.bounds.contains(x, body_y));
    let left = body_left <= screen.work.left + threshold && open(screen.bounds.left - 1);
    let right = body_right >= screen.work.right() - threshold && open(screen.bounds.right());
    match (left, right) {
        (true, false) => Some((Edge::Left, screen.work)),
        (false, true) => Some((Edge::Right, screen.work)),
        _ => None,
    }
}

/// The screen showing this point, or the closest one when the point is on no
/// screen any more (a monitor was removed or the resolution changed).
pub(crate) fn nearest_screen(screens: &[Screen], x: i32, y: i32) -> Option<Screen> {
    screens.iter().find(|s| s.bounds.contains(x, y)).or_else(|| screens.iter().min_by_key(|s| s.work.distance(x, y))).copied()
}

/// Top-left of the handle: flush with the edge, at the pet body's height, inside the work area.
pub(crate) fn handle_position(edge: Edge, center_y: i32, work: Rect, width: i32, height: i32) -> Position {
    let x = match edge { Edge::Left => work.left, Edge::Right => work.right() - width };
    let y = (center_y - height / 2).clamp(work.top, (work.bottom() - height).max(work.top));
    Position { x, y, edge: None }
}

/// Top-left of the restored pet: flush with the edge it came from, body at the handle's height.
pub(crate) fn restored_position(edge: Edge, center_y: i32, body_offset: i32, work: Rect, width: i32, height: i32) -> Position {
    let x = match edge { Edge::Left => work.left, Edge::Right => work.right() - width };
    clamp_to_work_area(Position { x, y: center_y - body_offset, edge: None }, width, height, work.left, work.top, work.width as u32, work.height as u32)
}

fn require_pet(label: &str) -> Result<(), String> {
    if ["pet-0", "pet-1", "pet-2"].contains(&label) { Ok(()) } else { Err("펫 창에서만 사용할 수 있습니다.".into()) }
}

fn screens(window: &tauri::WebviewWindow) -> Vec<Screen> {
    window.available_monitors().unwrap_or_default().iter().map(|m| {
        let work = m.work_area();
        Screen {
            bounds: Rect { left: m.position().x, top: m.position().y, width: m.size().width as i32, height: m.size().height as i32 },
            work: Rect { left: work.position.x, top: work.position.y, width: work.size.width as i32, height: work.size.height as i32 },
            scale: m.scale_factor(),
        }
    }).collect()
}

pub(crate) fn docked_edge(app: &tauri::AppHandle, label: &str) -> Option<Edge> {
    app.try_state::<Desktop>()?.positions.lock().ok()?.get(label)?.edge
}

fn remember(window: &tauri::WebviewWindow, position: Position) -> Result<(), String> {
    let desktop = window.app_handle().try_state::<Desktop>().ok_or("펫 위치를 저장할 수 없습니다.")?;
    let mut positions = desktop.positions.lock().map_err(|_| "펫 위치를 저장할 수 없습니다.")?;
    positions.insert(window.label().to_owned(), position);
    save_positions(&desktop, &positions);
    Ok(())
}

/// Resizes the window to `width`×`height` logical px and moves it to `at(physical size)`.
/// Moving onto a monitor with another scale resizes the window again, so it is placed twice.
fn place(window: &tauri::WebviewWindow, width: f64, height: f64, at: impl Fn(i32, i32) -> Position) -> Result<(), String> {
    let error = |e: tauri::Error| e.to_string();
    for _ in 0..2 {
        let scale = window.scale_factor().map_err(error)?;
        let size = window.outer_size().map_err(error)?;
        if (f64::from(size.width) - width * scale).abs() > 1.5 || (f64::from(size.height) - height * scale).abs() > 1.5 {
            window.set_size(LogicalSize::new(width, height)).map_err(error)?;
        }
        let size = window.outer_size().map_err(error)?;
        let target = at(size.width as i32, size.height as i32);
        let current = window.outer_position().map_err(error)?;
        if current.x != target.x || current.y != target.y {
            window.set_position(PhysicalPosition::new(target.x, target.y)).map_err(error)?;
        }
        if window.scale_factor().map_err(error)? == scale { break; }
    }
    Ok(())
}

#[cfg(windows)]
fn primary_button_down() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetSystemMetrics(index: i32) -> i32;
    }
    // Reads the button state only; never sends input. SM_SWAPBUTTON = 23.
    unsafe {
        let key = if GetSystemMetrics(23) != 0 { 0x02 } else { 0x01 };
        (GetAsyncKeyState(key) as u16 & 0x8000) != 0
    }
}
#[cfg(not(windows))]
fn primary_button_down() -> bool { false }

fn released_edge(window: &tauri::WebviewWindow, body_left: f64, body_right: f64) -> Option<(Edge, Rect)> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let scale = window.scale_factor().ok()?;
    // An open card is not a pet drop.
    if f64::from(size.width) > PET_W * scale * 1.2 { return None; }
    dock_edge(
        position.x + (body_left * scale).round() as i32,
        position.x + (body_right * scale).round() as i32,
        position.y + (BODY_CENTER_Y * scale).round() as i32,
        &screens(window),
    )
}

/// Called when a pet drag starts. Waits for the button to be released (the OS
/// move loop gives the webview no pointer-up), then tells the pet whether it
/// was dropped at an edge. `body_*` is the pet body's span in the window (CSS px).
#[tauri::command]
pub(crate) fn watch_pet_drag(window: tauri::WebviewWindow, docks: tauri::State<PetDocks>, body_left: f64, body_right: f64) -> Result<(), String> {
    require_pet(window.label())?;
    if !(body_left.is_finite() && body_right.is_finite() && 0.0 <= body_left && body_left < body_right && body_right <= PET_W * 2.0) {
        return Err("펫 위치를 확인할 수 없습니다.".into());
    }
    if docked_edge(window.app_handle(), window.label()).is_some() { return Ok(()); }
    let label = window.label().to_owned();
    if let Ok(mut pending) = docks.pending.lock() { pending.remove(&label); }
    if !docks.watching.lock().map_err(|_| "펫 이동을 확인할 수 없습니다.")?.insert(label.clone()) { return Ok(()); }
    std::thread::spawn(move || {
        let started = Instant::now();
        while primary_button_down() && started.elapsed() < WATCH_LIMIT { std::thread::sleep(Duration::from_millis(16)); }
        // Let the last native move land before reading the window.
        std::thread::sleep(Duration::from_millis(60));
        let found = released_edge(&window, body_left, body_right);
        let docks = window.app_handle().state::<PetDocks>();
        if let Ok(mut pending) = docks.pending.lock() {
            match found { Some(found) => { pending.insert(label.clone(), found); } None => { pending.remove(&label); } }
        }
        if let Ok(mut watching) = docks.watching.lock() { watching.remove(&label); }
        let _ = window.app_handle().emit("autopets://pet-drag-end", serde_json::json!({"label": label, "edge": found.map(|f| f.0)}));
    });
    Ok(())
}

/// Tucks the pet into the edge it was just dropped at (after its slide-out).
#[tauri::command]
pub(crate) fn dock_pet(window: tauri::WebviewWindow, docks: tauri::State<PetDocks>, edge: Edge) -> Result<(), String> {
    require_pet(window.label())?;
    let pending = docks.pending.lock().map_err(|_| "펫을 숨길 수 없습니다.")?.remove(window.label());
    let Some((found, work)) = pending.filter(|p| p.0 == edge) else { return Err("가장자리에 놓인 펫이 아니에요.".into()) };
    let error = |e: tauri::Error| e.to_string();
    let position = window.outer_position().map_err(error)?;
    let size = window.outer_size().map_err(error)?;
    let scale = window.scale_factor().map_err(error)?;
    let center_y = position.y + (BODY_CENTER_Y * scale).round() as i32;
    let restore = clamp_to_work_area(Position { x: position.x, y: position.y, edge: None }, size.width as i32, size.height as i32, work.left, work.top, work.width as u32, work.height as u32);
    // Saved first, so the handle's own moves are not taken as the pet's position.
    remember(&window, Position { edge: Some(found), ..restore })?;
    place(&window, HANDLE_W, HANDLE_H, |w, h| handle_position(found, center_y, work, w, h))
}

/// Brings a docked pet back out next to its edge, on whichever screen shows the handle now.
#[tauri::command]
pub(crate) fn undock_pet(window: tauri::WebviewWindow) -> Result<(), String> {
    require_pet(window.label())?;
    let Some(edge) = docked_edge(window.app_handle(), window.label()) else { return Ok(()) };
    let error = |e: tauri::Error| e.to_string();
    let position = window.outer_position().map_err(error)?;
    let size = window.outer_size().map_err(error)?;
    let center_y = position.y + size.height as i32 / 2;
    let screen = nearest_screen(&screens(&window), position.x + size.width as i32 / 2, center_y).ok_or("화면 정보를 읽을 수 없습니다.")?;
    let body = (BODY_CENTER_Y * screen.scale).round() as i32;
    let target = |w: i32, h: i32| restored_position(edge, center_y, body, screen.work, w, h);
    let estimate = target((PET_W * screen.scale).round() as i32, (PET_H * screen.scale).round() as i32);
    // Cleared first, so the restore moves are saved as the pet's normal position.
    remember(&window, estimate)?;
    place(&window, PET_W, PET_H, target)
}

#[tauri::command]
pub(crate) fn get_pet_dock(window: tauri::WebviewWindow) -> Result<Option<Edge>, String> {
    require_pet(window.label())?;
    Ok(docked_edge(window.app_handle(), window.label()))
}

/// Keeps a docked handle on a screen edge after monitor, resolution or scale changes.
#[tauri::command]
pub(crate) fn reanchor_pet(window: tauri::WebviewWindow) -> Result<(), String> {
    require_pet(window.label())?;
    reanchor(&window);
    Ok(())
}

pub(crate) fn reanchor(window: &tauri::WebviewWindow) {
    let Some(edge) = docked_edge(window.app_handle(), window.label()) else { return };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else { return };
    let center_y = position.y + size.height as i32 / 2;
    let Some(screen) = nearest_screen(&screens(window), position.x + size.width as i32 / 2, center_y) else { return };
    let _ = place(window, HANDLE_W, HANDLE_H, |w, h| handle_position(edge, center_y, screen.work, w, h));
}

/// At startup a pet saved as docked comes back as its handle on the nearest screen.
pub(crate) fn restore_docked(window: &tauri::WebviewWindow, saved: &Position) {
    let Some(edge) = saved.edge else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let center_y = saved.y + (BODY_CENTER_Y * scale).round() as i32;
    let Some(screen) = nearest_screen(&screens(window), saved.x + (PET_W / 2.0 * scale).round() as i32, center_y) else { return };
    let _ = place(window, HANDLE_W, HANDLE_H, |w, h| handle_position(edge, center_y, screen.work, w, h));
}

#[cfg(test)]
mod tests {
    use super::*;
    const fn rect(left: i32, top: i32, width: i32, height: i32) -> Rect { Rect { left, top, width, height } }
    fn screen(left: i32, width: i32, scale: f64) -> Screen {
        Screen { bounds: rect(left, 0, width, 1080), work: rect(left, 0, width, 1040), scale }
    }

    #[test]
    fn only_a_drop_near_an_outer_edge_docks() {
        let one = [screen(0, 1920, 1.0)];
        // A 160 px wide body touching or past the right edge, cursor on the screen.
        assert_eq!(dock_edge(1740, 1900, 500, &one).map(|d| d.0), Some(Edge::Right));
        assert_eq!(dock_edge(1800, 1960, 500, &one).map(|d| d.0), Some(Edge::Right));
        assert_eq!(dock_edge(24, 184, 500, &one).map(|d| d.0), Some(Edge::Left));
        assert_eq!(dock_edge(-80, 80, 500, &one).map(|d| d.0), Some(Edge::Left));
        // Just outside the threshold, or anywhere in the middle: a normal move.
        assert_eq!(dock_edge(25, 185, 500, &one), None);
        assert_eq!(dock_edge(1735, 1895, 500, &one), None);
        assert_eq!(dock_edge(800, 960, 500, &one), None);
    }

    #[test]
    fn an_edge_shared_with_another_monitor_is_a_move_across() {
        let two = [screen(0, 1920, 1.0), screen(1920, 2560, 1.5)];
        assert_eq!(dock_edge(1800, 1960, 500, &two), None);
        assert_eq!(dock_edge(1900, 2060, 500, &two), None);
        // The outer edges still dock; the threshold follows that monitor's scale (24 × 1.5).
        assert_eq!(dock_edge(4480 - 36 - 240, 4480 - 36, 500, &two).map(|d| d.0), Some(Edge::Right));
        assert_eq!(dock_edge(4480 - 37 - 240, 4480 - 37, 500, &two), None);
        assert_eq!(dock_edge(10, 170, 500, &two).map(|d| d.0), Some(Edge::Left));
        // A monitor left of the primary (negative coordinates) shares the primary's left edge.
        let left_of = [screen(-1920, 1920, 1.0), screen(0, 1920, 1.0)];
        assert_eq!(dock_edge(0, 160, 500, &left_of), None);
        assert_eq!(dock_edge(-1920, -1760, 500, &left_of).map(|d| d.0), Some(Edge::Left));
    }

    #[test]
    fn a_side_taskbar_moves_the_edge_to_the_work_area() {
        let taskbar_left = [Screen { bounds: rect(0, 0, 1920, 1080), work: rect(48, 0, 1872, 1080), scale: 1.0 }];
        let (edge, work) = dock_edge(60, 220, 500, &taskbar_left).unwrap();
        assert_eq!((edge, work.left), (Edge::Left, 48));
        assert_eq!(handle_position(Edge::Left, 500, work, 36, 84).x, 48);
    }

    #[test]
    fn the_handle_and_the_restored_pet_stay_inside_the_work_area() {
        let work = rect(0, 0, 1920, 1040);
        assert_eq!(handle_position(Edge::Right, 500, work, 36, 84), Position { x: 1884, y: 458, edge: None });
        assert_eq!(handle_position(Edge::Left, 5, work, 36, 84).y, 0);
        assert_eq!(handle_position(Edge::Right, 2000, work, 36, 84).y, 1040 - 84);
        // Restored flush with the edge, body at the handle's height, never past the work area.
        assert_eq!(restored_position(Edge::Right, 500, 94, work, 180, 230), Position { x: 1740, y: 406, edge: None });
        assert_eq!(restored_position(Edge::Left, 1030, 94, work, 180, 230), Position { x: 0, y: 810, edge: None });
        assert_eq!(restored_position(Edge::Left, 10, 94, work, 180, 230).y, 0);
    }

    #[test]
    fn a_handle_left_on_a_removed_monitor_returns_to_the_nearest_screen() {
        let remaining = [screen(0, 1920, 1.0)];
        let found = nearest_screen(&remaining, 4400, 500).unwrap();
        assert_eq!(found.work, rect(0, 0, 1920, 1040));
        assert_eq!(handle_position(Edge::Right, 500, found.work, 36, 84).x, 1884);
        assert!(nearest_screen(&[], 0, 0).is_none());
    }

    #[test]
    fn saved_positions_stay_compatible() {
        let old: HashMap<String, Position> = serde_json::from_str(r#"{"pet-0":{"x":120,"y":240}}"#).unwrap();
        assert_eq!(old["pet-0"].edge, None);
        assert_eq!(serde_json::to_string(&old["pet-0"]).unwrap(), r#"{"x":120,"y":240}"#);
        let docked = Position { x: 1740, y: 406, edge: Some(Edge::Right) };
        let text = serde_json::to_string(&docked).unwrap();
        assert_eq!(text, r#"{"x":1740,"y":406,"edge":"right"}"#);
        assert_eq!(serde_json::from_str::<Position>(&text).unwrap(), docked);
    }
}
