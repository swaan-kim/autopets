use crate::{application::store::SharedStore, domain::{assistance::Identity, roles::*}};
use tauri::Emitter;

#[tauri::command]
pub(crate) fn roles_snapshot(store: tauri::State<SharedStore>) -> Result<Snapshot, String> {
    store.lock().map_err(|_| "펫을 읽을 수 없어요.")?.roles_snapshot()
}
#[tauri::command]
pub(crate) fn save_pet(app: tauri::AppHandle, window: tauri::WebviewWindow, store: tauri::State<SharedStore>, id: Option<String>, expected_revision: u64, template: Template) -> Result<SavedPet, String> {
    crate::platform::connection_setup::require_manager(window.label())?;
    let pet = store.lock().map_err(|_| "펫을 저장할 수 없어요.")?.save_pet(id, expected_revision, template)?;
    let _ = app.emit("autopets://roles-changed", ());
    Ok(pet)
}
#[tauri::command]
pub(crate) fn apply_pet(app: tauri::AppHandle, window: tauri::WebviewWindow, store: tauri::State<SharedStore>, identity: Identity, pet_id: String, pet_revision: u64, expected_revision: u64, expected_settings_revision: u64, enabled: bool) -> Result<Binding, String> {
    crate::platform::connection_setup::require_manager(window.label())?;
    let binding = store.lock().map_err(|_| "펫을 선택할 수 없어요.")?.apply_pet(identity, pet_id, pet_revision, expected_revision, expected_settings_revision, enabled)?;
    let _ = app.emit("autopets://roles-changed", ());
    Ok(binding)
}
