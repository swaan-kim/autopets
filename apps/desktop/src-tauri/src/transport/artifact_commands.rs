use crate::application::store::SharedStore;
use crate::domain::artifacts::{Request, Snapshot};
use crate::domain::assistance::Identity;
use tauri::Manager;

#[tauri::command]
pub(crate) fn artifact_snapshot(store: tauri::State<SharedStore>) -> Result<Snapshot, String> {
    store
        .lock()
        .map_err(|_| "상태를 읽을 수 없습니다.")?
        .artifact_snapshot()
}
#[tauri::command]
pub(crate) fn artifact_dispatch(
    store: tauri::State<SharedStore>,
    request: Request,
) -> Result<Snapshot, String> {
    let mut store = store.lock().map_err(|_| "결과물을 저장할 수 없습니다.")?;
    store.artifacts.dispatch(request)?;
    store.artifact_snapshot()
}
#[tauri::command]
pub(crate) fn artifact_image(
    store: tauri::State<SharedStore>,
    identity: Identity,
    version_id: String,
) -> Result<Vec<u8>, String> {
    store
        .lock()
        .map_err(|_| "이미지를 읽을 수 없습니다.")?
        .artifacts
        .image(&identity, &version_id)
}
#[tauri::command]
pub(crate) fn artifact_export(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    identity: Identity,
    version_id: String,
) -> Result<String, String> {
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    store
        .lock()
        .map_err(|_| "이미지를 내보낼 수 없습니다.")?
        .artifacts
        .export_to_downloads(&identity, &version_id, &downloads)
}
