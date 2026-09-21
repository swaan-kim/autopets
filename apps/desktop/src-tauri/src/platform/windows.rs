use crate::application::store::{SharedStore, Snapshot};
use crate::application::updates::update;
use crate::transport::http as bridge;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, PhysicalPosition};

#[derive(Default, Clone, Serialize, Deserialize)]
pub(crate) struct Position {
    pub(crate) x: i32,
    pub(crate) y: i32,
}
pub(crate) struct Desktop {
    pub(crate) visible: AtomicBool,
    pub(crate) hidden_slots: Mutex<[bool; 3]>,
    pub(crate) positions: Mutex<HashMap<String, Position>>,
    pub(crate) data_dir: PathBuf,
    pub(crate) bridge: Mutex<Option<bridge::BridgeHandle>>,
}

pub(crate) fn emit(app: &tauri::AppHandle, snapshot: Snapshot) {
    let _ = app.emit("autopets://snapshot", &snapshot);
    let visible = app
        .try_state::<Desktop>()
        .map(|s| s.visible.load(Ordering::Relaxed))
        .unwrap_or(true);
    let has_assignments = snapshot.slots.iter().any(|slot| slot.session_id.is_some());
    let hidden_slots = app
        .try_state::<Desktop>()
        .map(|s| s.hidden_slots.lock().map(|h| *h).unwrap_or([false; 3]))
        .unwrap_or([false; 3]);
    for slot in &snapshot.slots {
        if let Some(window) = app.get_webview_window(&format!("pet-{}", slot.index)) {
            if visible
                && !hidden_slots[slot.index]
                && (slot.session_id.is_some() || (!has_assignments && slot.index == 0))
            {
                if !window.is_visible().unwrap_or(false) {
                    let _ = window.show();
                }
            } else {
                let _ = window.hide();
            }
        }
    }
}

pub(crate) fn show_manager(
    app: tauri::AppHandle,
    section: Option<String>,
    session_id: Option<String>,
) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if section.as_deref() == Some("assistance") {
            let _ = window.emit(
                "autopets://open-assistance",
                serde_json::json!({"sessionId":session_id}),
            );
        }
    }
}

pub(crate) fn reopen(app: &tauri::AppHandle) {
    if let Some(desktop) = app.try_state::<Desktop>() {
        desktop.visible.store(true, Ordering::Relaxed);
        if let Ok(mut hidden) = desktop.hidden_slots.lock() {
            *hidden = [false; 3];
        }
    }
    if let Some(store) = app.try_state::<SharedStore>() {
        if let Ok(store) = store.lock() {
            emit(app, store.snapshot());
        }
    }
    show_manager(app.clone(), None, None);
}

pub(crate) fn set_pets_visible(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    desktop: tauri::State<Desktop>,
    visible: bool,
) {
    desktop.visible.store(visible, Ordering::Relaxed);
    if visible {
        if let Ok(mut hidden) = desktop.hidden_slots.lock() {
            *hidden = [false; 3];
        }
    }
    if let Ok(s) = store.lock() {
        emit(&app, s.snapshot());
    }
}

pub(crate) fn change_slot_visibility(
    desktop: &Desktop,
    slot: usize,
    visible: bool,
) -> Result<(), String> {
    if slot > 2 {
        return Err("펫 슬롯이 올바르지 않습니다.".into());
    }
    let mut hidden = desktop
        .hidden_slots
        .lock()
        .map_err(|_| "펫 표시 상태를 변경할 수 없습니다.")?;
    if visible && !desktop.visible.swap(true, Ordering::Relaxed) {
        *hidden = [true; 3];
    }
    hidden[slot] = !visible;
    Ok(())
}

pub(crate) fn set_pet_visible(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    desktop: tauri::State<Desktop>,
    slot: usize,
    visible: bool,
) -> Result<(), String> {
    change_slot_visibility(&desktop, slot, visible)?;
    let snapshot = store
        .lock()
        .map_err(|_| "상태를 읽을 수 없습니다.")?
        .snapshot();
    emit(&app, snapshot);
    if !visible {
        if let Some(window) = app.get_webview_window(&format!("pet-{slot}")) {
            let _ = window.emit(
                "autopets://collapse-pets",
                serde_json::json!({"exceptSlot":null}),
            );
        }
    }
    Ok(())
}

pub(crate) fn open_pet(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    desktop: tauri::State<Desktop>,
    slot: usize,
) -> Result<(), String> {
    if slot > 2 {
        return Err("펫 슬롯이 올바르지 않습니다.".into());
    }
    let snapshot = store
        .lock()
        .map_err(|_| "작업을 읽을 수 없습니다.")?
        .snapshot();
    let has_assignments = snapshot.slots.iter().any(|s| s.session_id.is_some());
    let bound = snapshot
        .slots
        .iter()
        .any(|s| s.index == slot && s.session_id.is_some());
    if !bound && !(slot == 0 && !has_assignments) {
        return Err("먼저 작업을 연결해주세요.".into());
    }
    change_slot_visibility(&desktop, slot, true)?;
    if let Some(window) = app.get_webview_window(&format!("pet-{slot}")) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn set_pet_expanded(window: tauri::WebviewWindow, expanded: bool) -> Result<(), String> {
    if !["pet-0", "pet-1", "pet-2"].contains(&window.label()) {
        return Err("펫 창에서만 사용할 수 있습니다.".into());
    }
    if expanded {
        let slot = window
            .label()
            .strip_prefix("pet-")
            .and_then(|s| s.parse::<usize>().ok());
        let _ = window.app_handle().emit(
            "autopets://collapse-pets",
            serde_json::json!({"exceptSlot":slot}),
        );
    }
    let prior = window.outer_position().map_err(|e| e.to_string())?;
    let old_size = window.outer_size().map_err(|e| e.to_string())?;
    let current_monitor = window.current_monitor().ok().flatten();
    let (width, height) = if let Some(monitor) = current_monitor.as_ref() {
        let area = monitor.work_area();
        fit_pet_size(
            expanded,
            window.scale_factor().unwrap_or(monitor.scale_factor()),
            area.size.width,
            area.size.height,
        )
    } else {
        (
            if expanded { 328.0 } else { 180.0 },
            if expanded { 600.0 } else { 230.0 },
        )
    };
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    let new_size = window.outer_size().map_err(|e| e.to_string())?;
    let anchored = Position {
        x: prior.x + old_size.width as i32 - new_size.width as i32,
        y: prior.y + old_size.height as i32 - new_size.height as i32,
    };
    // Keep the pet on its original monitor: expansion near the left edge can
    // place the proposed top-left point inside an adjacent monitor.
    let position = if let Some(monitor) = current_monitor.as_ref() {
        let area = monitor.work_area();
        clamp_to_work_area(
            anchored,
            new_size.width as i32,
            new_size.height as i32,
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        )
    } else {
        clamp_position(&window, anchored)
    };
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|e| e.to_string())
}

pub(crate) fn quit_app(app: tauri::AppHandle) {
    if let Some(store) = app.try_state::<SharedStore>() {
        let _ = update(&app, &store, |s| s.shutdown());
    }
    // Give pending long polls a chance to receive the normal-flow handoff.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        app.exit(0);
    });
}

pub(crate) fn clamp_position(window: &tauri::WebviewWindow, position: Position) -> Position {
    let Ok(monitors) = window.available_monitors() else {
        return position;
    };
    let size = window.outer_size().ok();
    let width = size.map(|s| s.width as i32).unwrap_or(180);
    let height = size.map(|s| s.height as i32).unwrap_or(230);
    let current = window.current_monitor().ok().flatten();
    let monitor = monitors
        .iter()
        .find(|m| {
            let p = m.position();
            let s = m.size();
            position.x >= p.x
                && position.x < p.x + s.width as i32
                && position.y >= p.y
                && position.y < p.y + s.height as i32
        })
        .or(current.as_ref())
        .or_else(|| monitors.first());
    if let Some(m) = monitor {
        let area = m.work_area();
        clamp_to_work_area(
            position,
            width,
            height,
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        )
    } else {
        position
    }
}

pub(crate) fn fit_pet_size(
    expanded: bool,
    scale: f64,
    work_width: u32,
    work_height: u32,
) -> (f64, f64) {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let desired_width: f64 = if expanded { 328.0 } else { 180.0 };
    let desired_height: f64 = if expanded { 600.0 } else { 230.0 };
    (
        desired_width.min((f64::from(work_width) / scale).floor().max(1.0)),
        desired_height.min((f64::from(work_height) / scale).floor().max(1.0)),
    )
}

pub(crate) fn clamp_to_work_area(
    position: Position,
    width: i32,
    height: i32,
    left: i32,
    top: i32,
    work_width: u32,
    work_height: u32,
) -> Position {
    Position {
        x: position
            .x
            .clamp(left, (left + work_width as i32 - width).max(left)),
        y: position
            .y
            .clamp(top, (top + work_height as i32 - height).max(top)),
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod visibility_tests;
