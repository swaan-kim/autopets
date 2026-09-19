mod bridge;
mod core;

use core::{InterventionMode, SharedStore, Snapshot, Store};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

#[derive(Default, Clone, Serialize, Deserialize)]
struct Position {
    x: i32,
    y: i32,
}
struct Desktop {
    visible: AtomicBool,
    positions: Mutex<HashMap<String, Position>>,
    data_dir: PathBuf,
    bridge: Mutex<Option<bridge::BridgeHandle>>,
}

fn emit(app: &tauri::AppHandle, snapshot: Snapshot) {
    let _ = app.emit("autopets://snapshot", &snapshot);
    let visible = app
        .try_state::<Desktop>()
        .map(|s| s.visible.load(Ordering::Relaxed))
        .unwrap_or(true);
    let has_assignments = snapshot.slots.iter().any(|slot| slot.session_id.is_some());
    for slot in &snapshot.slots {
        if let Some(window) = app.get_webview_window(&format!("pet-{}", slot.index)) {
            if visible && (slot.session_id.is_some() || (!has_assignments && slot.index == 0)) {
                if !window.is_visible().unwrap_or(false) {
                    let _ = window.show();
                }
            } else {
                let _ = window.hide();
            }
        }
    }
}
fn update(
    app: &tauri::AppHandle,
    store: &SharedStore,
    action: impl FnOnce(&mut Store) -> Result<(), String>,
) -> Result<(), String> {
    let snapshot = {
        let mut state = store
            .lock()
            .map_err(|_| "상태 저장소에 연결할 수 없습니다.")?;
        action(&mut state)?;
        state.snapshot()
    };
    emit(app, snapshot);
    Ok(())
}
#[tauri::command]
fn get_snapshot(store: tauri::State<SharedStore>) -> Result<Snapshot, String> {
    Ok(store
        .lock()
        .map_err(|_| "상태를 읽을 수 없습니다.")?
        .snapshot())
}
#[tauri::command]
fn assign_session(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    slot: usize,
    session_id: String,
) -> Result<(), String> {
    update(&app, &store, |s| s.assign_session(slot, &session_id))
}
#[tauri::command]
fn unassign_session(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    slot: usize,
) -> Result<(), String> {
    update(&app, &store, |s| s.unassign_session(slot))
}
#[tauri::command]
fn rename_session(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    session_id: String,
    label: String,
) -> Result<(), String> {
    update(&app, &store, |s| s.rename_session(&session_id, &label))
}
#[tauri::command]
fn acknowledge(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    session_id: String,
) -> Result<(), String> {
    update(&app, &store, |s| s.acknowledge(&session_id))
}
#[tauri::command]
fn configure_session(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    session_id: String,
    completion_criterion: String,
    intervention_mode: InterventionMode,
    elapsed_alert_minutes: Option<u32>,
) -> Result<(), String> {
    update(&app, &store, |s| {
        s.configure_session(
            &session_id,
            &completion_criterion,
            intervention_mode,
            elapsed_alert_minutes,
        )
    })
}

#[tauri::command]
fn acknowledge_attention(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    session_id: String,
    attention_id: String,
) -> Result<(), String> {
    update(&app, &store, |s| {
        s.acknowledge_attention(&session_id, &attention_id)
    })
}

#[tauri::command]
fn snooze_attention(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    session_id: String,
    attention_id: String,
    minutes: u32,
) -> Result<(), String> {
    update(&app, &store, |s| {
        s.snooze_attention(&session_id, &attention_id, minutes)
    })
}
#[tauri::command]
fn show_manager(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
#[tauri::command]
fn set_pets_visible(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    desktop: tauri::State<Desktop>,
    visible: bool,
) {
    desktop.visible.store(visible, Ordering::Relaxed);
    if let Ok(s) = store.lock() {
        emit(&app, s.snapshot());
    }
}
#[tauri::command]
fn open_pet(
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
    desktop.visible.store(true, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(&format!("pet-{slot}")) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn set_pet_expanded(window: tauri::WebviewWindow, expanded: bool) -> Result<(), String> {
    if !["pet-0", "pet-1", "pet-2"].contains(&window.label()) {
        return Err("펫 창에서만 사용할 수 있습니다.".into());
    }
    let prior = window.outer_position().map_err(|e| e.to_string())?;
    let old_size = window.outer_size().map_err(|e| e.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(
            if expanded { 380.0 } else { 180.0 },
            if expanded { 600.0 } else { 230.0 },
        ))
        .map_err(|e| e.to_string())?;
    let new_size = window.outer_size().map_err(|e| e.to_string())?;
    let position = clamp_position(
        &window,
        Position {
            x: prior.x + old_size.width as i32 - new_size.width as i32,
            y: prior.y + old_size.height as i32 - new_size.height as i32,
        },
    );
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    if let Some(store) = app.try_state::<SharedStore>() {
        let _ = update(&app, &store, |s| s.shutdown());
    }
    // Give pending long polls a chance to receive the normal-flow handoff.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        app.exit(0);
    });
}

fn clamp_position(window: &tauri::WebviewWindow, position: Position) -> Position {
    let Ok(monitors) = window.available_monitors() else {
        return position;
    };
    let size = window.outer_size().ok();
    let width = size.map(|s| s.width as i32).unwrap_or(180);
    let height = size.map(|s| s.height as i32).unwrap_or(230);
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
        .or_else(|| monitors.first());
    if let Some(m) = monitor {
        let p = m.position();
        let s = m.size();
        Position {
            x: position
                .x
                .clamp(p.x, (p.x + s.width as i32 - width).max(p.x)),
            y: position
                .y
                .clamp(p.y, (p.y + s.height as i32 - height - 48).max(p.y)),
        }
    } else {
        position
    }
}
fn make_icon() -> tauri::image::Image<'static> {
    let mut bytes = vec![0; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let i = (y * 32 + x) * 4;
            let inside = (5..27).contains(&x) && (8..28).contains(&y)
                || (7..12).contains(&x) && (3..11).contains(&y)
                || (20..25).contains(&x) && (3..11).contains(&y);
            if inside {
                bytes[i..i + 4].copy_from_slice(&[165, 193, 110, 255]);
            }
            if ((x == 11 || x == 21) && (15..18).contains(&y)) || (x > 13 && x < 19 && y == 22) {
                bytes[i..i + 4].copy_from_slice(&[55, 68, 44, 255]);
            }
        }
    }
    tauri::image::Image::new_owned(bytes, 32, 32)
}

pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_manager(app.clone())
        }))
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            assign_session,
            unassign_session,
            rename_session,
            acknowledge,
            configure_session,
            acknowledge_attention,
            snooze_attention,
            show_manager,
            set_pets_visible,
            open_pet,
            set_pet_expanded,
            quit_app
        ])
        .setup(|app| {
            let data_dir = match std::env::var_os("AUTOPETS_DATA_DIR") {
                Some(path) => PathBuf::from(path),
                None => app.path().app_local_data_dir()?,
            };
            let store: SharedStore = Arc::new(Mutex::new(
                Store::new(&data_dir).map_err(std::io::Error::other)?,
            ));
            let positions: HashMap<String, Position> =
                std::fs::read(data_dir.join("positions.json"))
                    .ok()
                    .and_then(|b| serde_json::from_slice(&b).ok())
                    .unwrap_or_default();
            app.manage(store.clone());
            app.manage(Desktop {
                visible: AtomicBool::new(true),
                positions: Mutex::new(positions.clone()),
                data_dir: data_dir.clone(),
                bridge: Mutex::new(None),
            });
            for index in 0..3 {
                let label = format!("pet-{index}");
                let window = WebviewWindowBuilder::new(
                    app,
                    &label,
                    WebviewUrl::App(format!("index.html?pet={index}").into()),
                )
                .title(format!("AutoPets · {}", ["모스", "루나", "토피"][index]))
                .inner_size(180.0, 230.0)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .focused(false)
                .visible(false)
                .build()?;
                let initial = positions.get(&label).cloned().unwrap_or_else(|| {
                    if let Ok(Some(m)) = window.primary_monitor() {
                        Position {
                            x: m.position().x + m.size().width as i32 - 200 - (index as i32 * 185),
                            y: m.position().y + m.size().height as i32 - 295,
                        }
                    } else {
                        Position {
                            x: 200 + index as i32 * 190,
                            y: 400,
                        }
                    }
                });
                let pos = clamp_position(&window, initial);
                window.set_position(PhysicalPosition::new(pos.x, pos.y))?;
            }
            use tauri::menu::{Menu, MenuItem};
            let manager = MenuItem::with_id(app, "manager", "작업 관리 열기", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "펫 모두 표시", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "펫 모두 숨기기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "AutoPets 종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&manager, &show, &hide, &quit])?;
            tauri::tray::TrayIconBuilder::with_id("autopets-tray")
                .icon(make_icon())
                .tooltip("AutoPets · 작은 작업 동료")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "manager" => show_manager(app.clone()),
                    "show" | "hide" => {
                        let visible = event.id.as_ref() == "show";
                        set_pets_visible(app.clone(), app.state(), app.state(), visible);
                    }
                    "quit" => quit_app(app.clone()),
                    _ => {}
                })
                .build(app)?;
            let handle = app.handle().clone();
            let initial_snapshot = store
                .lock()
                .map_err(|_| std::io::Error::other("상태 저장소에 연결할 수 없습니다."))?
                .snapshot();
            emit(&handle, initial_snapshot);
            let emit_handle = handle.clone();
            let callback: bridge::SnapshotCallback =
                Arc::new(move |snapshot| emit(&emit_handle, snapshot));
            tauri::async_runtime::spawn(async move {
                match bridge::start(store.clone(), callback).await {
                    Ok(server) => {
                        if let Some(state) = handle.try_state::<Desktop>() {
                            if let Ok(mut slot) = state.bridge.lock() {
                                *slot = Some(server);
                            };
                        }
                        if let Ok(s) = store.lock() {
                            emit(&handle, s.snapshot());
                        };
                    }
                    Err(error) => {
                        eprintln!("AutoPets bridge failed: {error}");
                        let _ = handle.emit("autopets://error", error);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Moved(position) if window.label().starts_with("pet-") => {
                if let Some(desktop) = window.app_handle().try_state::<Desktop>() {
                    if let Ok(mut positions) = desktop.positions.lock() {
                        let scale = window.scale_factor().unwrap_or(1.0);
                        let size = window.outer_size().ok();
                        let x = position.x + size.map(|s| s.width as i32).unwrap_or(180)
                            - (180.0 * scale) as i32;
                        let y = position.y + size.map(|s| s.height as i32).unwrap_or(230)
                            - (230.0 * scale) as i32;
                        positions.insert(window.label().to_owned(), Position { x, y });
                        if let Ok(json) = serde_json::to_vec(&*positions) {
                            let temp = desktop.data_dir.join("positions.tmp");
                            if std::fs::write(&temp, json).is_ok() {
                                let _ =
                                    std::fs::rename(temp, desktop.data_dir.join("positions.json"));
                            }
                        }
                    };
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("AutoPets could not start");
    application.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(store) = app.try_state::<SharedStore>() {
                if let Ok(mut s) = store.lock() {
                    let _ = s.shutdown();
                };
            }
            if let Some(desktop) = app.try_state::<Desktop>() {
                if let Ok(mut bridge) = desktop.bridge.lock() {
                    if let Some(server) = bridge.as_mut() {
                        server.shutdown();
                    }
                };
            }
        }
    });
}
