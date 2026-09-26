use super::windows::*;
use crate::application::store::{SharedStore, Store};
use crate::transport::http as bridge;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, Mutex},
};
use tauri::{Emitter, Manager, PhysicalPosition};
use tauri::{WebviewUrl, WebviewWindowBuilder};

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        super::main_window::show_fitted(&window)?;
    }
    let data_dir = match std::env::var_os("AUTOPETS_DATA_DIR") {
        Some(path) => PathBuf::from(path),
        None => app.path().app_local_data_dir()?,
    };
    let store: SharedStore = Arc::new(Mutex::new(
        Store::new(&data_dir).map_err(std::io::Error::other)?,
    ));
    let positions: HashMap<String, Position> = std::fs::read(data_dir.join("positions.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    app.manage(store.clone());
    app.manage(Desktop {
        visible: AtomicBool::new(true),
        hidden_slots: Mutex::new([false; 3]),
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
    super::tray::install(app)?;
    let handle = app.handle().clone();
    let initial_snapshot = store
        .lock()
        .map_err(|_| std::io::Error::other("상태 저장소에 연결할 수 없습니다."))?
        .snapshot();
    emit(&handle, initial_snapshot);
    let emit_handle = handle.clone();
    let callback: bridge::SnapshotCallback = Arc::new(move |snapshot| emit(&emit_handle, snapshot));
    tauri::async_runtime::spawn(async move {
        match bridge::start(store.clone(), callback).await {
            Ok(server) => {
                if let Some(state) = handle.try_state::<Desktop>() {
                    if let Ok(mut slot) = state.bridge.lock() {
                        *slot = Some(server);
                    };
                }
                let _ = crate::application::updates::publish_snapshot(&store, |snapshot| emit(&handle, snapshot));
            }
            Err(error) => {
                eprintln!("AutoPets bridge failed: {error}");
                let _ = handle.emit("autopets://error", error);
            }
        }
    });
    Ok(())
}

pub(crate) fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
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
                            let _ = std::fs::rename(temp, desktop.data_dir.join("positions.json"));
                        }
                    }
                };
            }
        }
        _ => {}
    }
}

pub(crate) fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
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
}
