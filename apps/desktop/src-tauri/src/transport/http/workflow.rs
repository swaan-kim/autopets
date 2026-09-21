use super::*;
use crate::application::workflow::same_cwd;
use crate::domain::assistance::{Provider, RoutingMode};
use crate::domain::workflow::Request as WorkflowRequest;

pub(super) async fn workflow(
    State(state): State<BridgeState>,
    Json(input): Json<WorkflowRequest>,
) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let (identity, binding) = input.identity_binding();
    if identity.provider != Provider::Codex {
        return Err(error(
            StatusCode::CONFLICT,
            "Workflow binding is not verified for this provider",
        ));
    }
    if identity.account_id != format!("session:{:x}", Sha256::digest(identity.chat_id.as_bytes()))
        || binding.session_id != identity.chat_id
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Workflow session identity mismatch",
        ));
    }
    if !std::path::Path::new(&binding.cwd).is_absolute() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "An absolute project path is required",
        ));
    }
    // Preflight does not fake a started turn. Existing observation, when present,
    // must agree; a first authenticated hook binds cwd in the separate workflow record.
    if store
        .sessions
        .get(&identity.chat_id)
        .is_some_and(|session| !same_cwd(&session.view.cwd, &binding.cwd))
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Workflow project differs from observed session",
        ));
    }
    if matches!(&input, WorkflowRequest::RecordPlan { .. }) {
        let context = store
            .task_context(&binding.session_id, &binding.cwd)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
        if binding.turn_id.as_deref() != Some(context.turn_id.as_str()) {
            return Err(error(
                StatusCode::CONFLICT,
                "Plan record requires the observed current turn",
            ));
        }
    }
    if matches!(&input, WorkflowRequest::Preflight { .. }) {
        crate::domain::activity::validate_id(
            binding.turn_id.as_deref().unwrap_or(""),
            "preflight turn ID",
        )
        .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
    }
    let preferences = store
        .assistance
        .preferences()
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?;
    let chat_off = match store.assistance.load(identity) {
        Ok(record) => !record.task.enabled,
        Err(e) if e == "Unknown assistance chat" => false,
        Err(e) => return Err(error(StatusCode::SERVICE_UNAVAILABLE, e)),
    };
    if chat_off {
        store
            .workflow
            .ensure(identity, binding)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
        store
            .workflow
            .disable_chat(identity)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
    }
    let fixed = if preferences.routing_mode == RoutingMode::Fixed {
        preferences.fixed_model
    } else {
        None
    };
    let result = store
        .workflow
        .dispatch(input, fixed)
        .map_err(|e| error(StatusCode::CONFLICT, e))?;
    // A workflow-only chat is visible through workflow_snapshot, not an invented session/pet.
    let snapshot = store.snapshot();
    drop(store);
    (state.on_change)(snapshot);
    Ok(Json(result))
}
