use crate::application::updates::update;
use crate::application::{
    assistance,
    store::{InterventionMode, SharedStore, Snapshot},
};
use crate::platform::windows::Desktop;

#[tauri::command]
pub(crate) fn open_local_task(
    store: tauri::State<SharedStore>,
    session_id: String,
    expected_cwd: String,
) -> Result<crate::platform::task_return::DispatchReceipt, String> {
    let uri = {
        let state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        crate::platform::task_return::local_task_uri(&state, &session_id, &expected_cwd)?
    };
    crate::platform::task_return::dispatch(&session_id, &uri)
}

#[tauri::command]
pub(crate) fn get_setup_state(
    store: tauri::State<SharedStore>,
) -> Result<serde_json::Value, String> {
    store
        .lock()
        .map_err(|_| "상태를 읽을 수 없습니다.")?
        .setup_status()
}

#[tauri::command]
pub(crate) fn get_snapshot(store: tauri::State<SharedStore>) -> Result<Snapshot, String> {
    Ok(store
        .lock()
        .map_err(|_| "상태를 읽을 수 없습니다.")?
        .snapshot())
}
#[tauri::command]
pub(crate) fn assign_session(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    slot: usize,
    session_id: String,
) -> Result<(), String> {
    update(&app, &store, |s| s.assign_session(slot, &session_id))
}
#[tauri::command]
pub(crate) fn unassign_session(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    slot: usize,
) -> Result<(), String> {
    update(&app, &store, |s| s.unassign_session(slot))
}
#[tauri::command]
pub(crate) fn rename_session(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    session_id: String,
    label: String,
) -> Result<(), String> {
    update(&app, &store, |s| s.rename_session(&session_id, &label))
}
#[tauri::command]
pub(crate) fn acknowledge(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    session_id: String,
) -> Result<(), String> {
    update(&app, &store, |s| s.acknowledge(&session_id))
}
#[tauri::command]
pub(crate) fn configure_session(
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
pub(crate) fn acknowledge_attention(
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
pub(crate) fn snooze_attention(
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
pub(crate) fn show_manager(
    app: tauri::AppHandle,
    section: Option<String>,
    session_id: Option<String>,
) {
    crate::platform::windows::show_manager(app, section, session_id)
}

#[tauri::command]
pub(crate) fn get_assistance(
    store: tauri::State<SharedStore>,
) -> Result<assistance::Overview, String> {
    store
        .lock()
        .map_err(|_| "상태를 읽을 수 없습니다.")?
        .assistance
        .overview()
}
#[tauri::command]
pub(crate) fn save_preferences(
    store: tauri::State<SharedStore>,
    preferences: assistance::Preferences,
) -> Result<assistance::Preferences, String> {
    let mut store = store.lock().map_err(|_| "상태를 저장할 수 없습니다.")?;
    store.save_assistance_preferences_control(preferences)
}
#[tauri::command]
pub(crate) fn set_chat_assistance(
    store: tauri::State<SharedStore>,
    identity: assistance::Identity,
    enabled: bool,
) -> Result<assistance::Task, String> {
    let mut store = store.lock().map_err(|_| "상태를 저장할 수 없습니다.")?;
    let task = store.assistance.set_enabled(identity.clone(), enabled)?;
    if !enabled {
        store.workflow.disable_chat(&identity)?;
    }
    Ok(task)
}
#[tauri::command]
pub(crate) fn save_task_context(
    store: tauri::State<SharedStore>,
    identity: assistance::Identity,
    context: assistance::Context,
    expected_revision: u64,
) -> Result<assistance::Task, String> {
    let mut store = store.lock().map_err(|_| "기록을 저장할 수 없습니다.")?;
    let old = store.assistance.load(&identity)?;
    let affects_plan =
        crate::application::workflow::context_affects_plan(&old.task.context, &context);
    let task = store
        .assistance
        .save_context(identity.clone(), context, expected_revision)?;
    if affects_plan && task.revision != expected_revision {
        store.workflow.invalidate_plan(&identity)?;
    }
    Ok(task)
}
#[tauri::command]
pub(crate) fn set_task_work_style(
    store: tauri::State<SharedStore>,
    identity: assistance::Identity,
    work_style: Option<assistance::WorkStyle>,
    expected_revision: u64,
) -> Result<assistance::Task, String> {
    store
        .lock()
        .map_err(|_| "설정을 저장할 수 없습니다.")?
        .assistance
        .set_work_style(identity, work_style, expected_revision)
}
#[tauri::command]
pub(crate) fn undo_task_context(
    store: tauri::State<SharedStore>,
    identity: assistance::Identity,
    expected_revision: u64,
) -> Result<assistance::Task, String> {
    let mut store = store.lock().map_err(|_| "기록을 되돌릴 수 없습니다.")?;
    let task = store
        .assistance
        .undo_context(identity.clone(), expected_revision)?;
    store.workflow.invalidate_plan(&identity)?;
    Ok(task)
}
#[tauri::command]
pub(crate) fn delete_task_context(
    store: tauri::State<SharedStore>,
    identity: assistance::Identity,
) -> Result<Option<assistance::Task>, String> {
    let mut store = store.lock().map_err(|_| "기록을 삭제할 수 없습니다.")?;
    // Workflow-only chats have no legacy assistance context to delete.
    store.workflow.erase(Some(&identity))?;
    match store.assistance.load(&identity) {
        Ok(_) => store.assistance.delete_context(identity).map(Some),
        Err(e) if e == "Unknown assistance chat" => Ok(None),
        Err(e) => Err(e),
    }
}
#[tauri::command]
pub(crate) fn delete_all_contexts(store: tauri::State<SharedStore>) -> Result<(), String> {
    let mut store = store.lock().map_err(|_| "기록을 삭제할 수 없습니다.")?;
    store.workflow.erase(None)?;
    store.assistance.delete_all_contexts()
}
#[tauri::command]
pub(crate) fn set_pets_visible(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    desktop: tauri::State<Desktop>,
    visible: bool,
) {
    crate::platform::windows::set_pets_visible(app, store, desktop, visible)
}
#[tauri::command]
pub(crate) fn set_pet_visible(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    desktop: tauri::State<Desktop>,
    slot: usize,
    visible: bool,
) -> Result<(), String> {
    crate::platform::windows::set_pet_visible(app, store, desktop, slot, visible)
}
#[tauri::command]
pub(crate) fn open_pet(
    app: tauri::AppHandle,
    store: tauri::State<SharedStore>,
    desktop: tauri::State<Desktop>,
    slot: usize,
) -> Result<(), String> {
    crate::platform::windows::open_pet(app, store, desktop, slot)
}
#[tauri::command]
pub(crate) fn set_pet_expanded(window: tauri::WebviewWindow, expanded: bool) -> Result<(), String> {
    crate::platform::windows::set_pet_expanded(window, expanded)
}
#[tauri::command]
pub(crate) fn quit_app(app: tauri::AppHandle) {
    crate::platform::windows::quit_app(app)
}
