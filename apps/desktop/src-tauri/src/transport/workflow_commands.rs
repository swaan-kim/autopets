use crate::application::store::SharedStore;
use crate::domain::assistance::Identity;
use crate::domain::workflow::*;

#[tauri::command]
pub(crate) fn workflow_snapshot(store: tauri::State<SharedStore>) -> Result<Snapshot, String> {
    store
        .lock()
        .map_err(|_| "상태를 읽을 수 없습니다.")?
        .workflow
        .snapshot()
}
#[tauri::command]
pub(crate) fn save_workflow_preferences(
    store: tauri::State<SharedStore>,
    preferences: Preferences,
) -> Result<Preferences, String> {
    store
        .lock()
        .map_err(|_| "설정을 저장할 수 없습니다.")?
        .workflow
        .save_preferences(preferences)
}
#[tauri::command]
pub(crate) fn configure_workflow_task(
    store: tauri::State<SharedStore>,
    identity: Identity,
    configuration: Configuration,
    expected_revision: u64,
) -> Result<Task, String> {
    let mut store = store.lock().map_err(|_| "설정을 저장할 수 없습니다.")?;
    store.configure_workflow_control(identity, configuration, expected_revision)
}
#[tauri::command]
pub(crate) fn approve_workflow_plan(
    store: tauri::State<SharedStore>,
    identity: Identity,
    expected_plan_revision: u64,
    expected_settings_revision: u64,
) -> Result<Task, String> {
    store
        .lock()
        .map_err(|_| "계획 확인을 저장할 수 없습니다.")?
        .workflow
        .approve(identity, expected_plan_revision, expected_settings_revision)
}
#[tauri::command]
pub(crate) fn allow_workflow_once(
    store: tauri::State<SharedStore>,
    identity: Identity,
    submission_id: String,
    expected_plan_revision: u64,
    expected_settings_revision: u64,
) -> Result<Task, String> {
    store
        .lock()
        .map_err(|_| "이번 요청의 허용을 저장할 수 없습니다.")?
        .workflow
        .allow_once(
            identity,
            submission_id,
            expected_plan_revision,
            expected_settings_revision,
        )
}
