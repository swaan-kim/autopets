use crate::application::store::SharedStore;
use crate::domain::connections::require_connectable;
use crate::platform::{connection_setup, windows::emit};

async fn change_connection(app: tauri::AppHandle, window: tauri::WebviewWindow,
    store: SharedStore, host_id: String, connect: bool) -> Result<serde_json::Value, String> {
    connection_setup::require_manager(window.label())?;
    require_connectable(&host_id)?;
    let worker_app = app.clone();
    let warnings = tauri::async_runtime::spawn_blocking(move || connection_setup::run(&worker_app, connect))
        .await.map_err(|_| "연결 도구를 실행할 수 없습니다.")??;
    let (state, snapshot) = {
        let mut store = store.lock().map_err(|_| "연결 상태를 읽을 수 없습니다.")?;
        let mut state = if connect { store.setup_status()? } else { store.disconnect_setup(&host_id)? };
        if !warnings.is_empty() { state["warnings"] = serde_json::json!(warnings); }
        (state, store.snapshot())
    };
    emit(&app, snapshot);
    Ok(state)
}
#[tauri::command]
pub(crate) async fn connect_ai(app: tauri::AppHandle, window: tauri::WebviewWindow,
    store: tauri::State<'_, SharedStore>, host_id: String) -> Result<serde_json::Value, String> {
    change_connection(app, window, store.inner().clone(), host_id, true).await
}
#[tauri::command]
pub(crate) async fn disconnect_ai(app: tauri::AppHandle, window: tauri::WebviewWindow,
    store: tauri::State<'_, SharedStore>, host_id: String) -> Result<serde_json::Value, String> {
    change_connection(app, window, store.inner().clone(), host_id, false).await
}
