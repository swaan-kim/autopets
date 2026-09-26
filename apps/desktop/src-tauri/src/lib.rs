mod application;
mod domain;
mod legacy;
mod platform;
mod storage;
mod transport;

use transport::commands;
use transport::workflow_commands;

pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            platform::windows::reopen(app)
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::set_pet_link_enabled,
            commands::open_local_task,
            transport::task_graph_commands::task_graph_snapshot,
            transport::role_commands::roles_snapshot,
            transport::role_commands::save_pet,
            transport::role_commands::apply_pet,
            commands::get_setup_state,
            transport::setup_commands::connect_ai,
            transport::setup_commands::disconnect_ai,
            platform::updater::check_app_update,
            platform::updater::install_app_update,
            workflow_commands::workflow_snapshot,
            transport::artifact_commands::artifact_snapshot,
            transport::artifact_commands::artifact_dispatch,
            transport::artifact_commands::artifact_image,
            transport::artifact_commands::artifact_export,
            workflow_commands::save_workflow_preferences,
            workflow_commands::configure_workflow_task,
            workflow_commands::approve_workflow_plan,
            workflow_commands::allow_workflow_once,
            commands::get_assistance,
            commands::save_preferences,
            commands::set_chat_assistance,
            commands::save_task_context,
            commands::set_task_work_style,
            commands::undo_task_context,
            commands::delete_task_context,
            commands::delete_all_contexts,
            commands::assign_session,
            commands::unassign_session,
            commands::rename_session,
            commands::acknowledge,
            commands::configure_session,
            commands::acknowledge_attention,
            commands::snooze_attention,
            commands::show_manager,
            commands::set_pets_visible,
            commands::set_pet_visible,
            commands::open_pet,
            commands::set_pet_expanded,
            commands::quit_app,
        ])
        .setup(platform::runtime::setup)
        .on_window_event(platform::runtime::on_window_event)
        .build(tauri::generate_context!())
        .expect("AutoPets could not start");
    application.run(platform::runtime::on_run_event);
}
