use super::*;

pub(super) async fn assistance_status(
    State(state): State<BridgeState>,
) -> BridgeResult<serde_json::Value> {
    let store = state.store.lock().map_err(state_error)?;
    let preferences = store
        .assistance
        .preferences()
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?;
    Ok(Json(
        serde_json::json!({"preferences":preferences,"capabilities":crate::application::assistance::capabilities()}),
    ))
}

pub(super) async fn assistance(
    State(state): State<BridgeState>,
    Json(input): Json<crate::application::assistance::Request>,
) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let (identity, binding) = input.identity_binding();
    // A valid loopback token is necessary but does not replace current-task binding.
    match identity.provider {
        crate::application::assistance::Provider::Codex => {
            // No account identity is verified here: the per-session scope must
            // match the connector so another scope cannot bypass a chat's off setting.
            let expected_account =
                format!("session:{:x}", Sha256::digest(identity.chat_id.as_bytes()));
            if identity.account_id != expected_account {
                return Err(error(StatusCode::CONFLICT, "Codex account scope mismatch"));
            }
            let binding =
                binding.ok_or_else(|| error(StatusCode::CONFLICT, "Codex binding is required"))?;
            let context = store
                .task_context(&binding.session_id, &binding.cwd)
                .map_err(|e| error(StatusCode::CONFLICT, e))?;
            if context.session_id != identity.chat_id || context.turn_id != binding.turn_id {
                return Err(error(
                    StatusCode::CONFLICT,
                    "Assistance task binding mismatch",
                ));
            }
        }
        crate::application::assistance::Provider::Chatgpt if binding.is_some() => {
            return Err(error(StatusCode::BAD_REQUEST, "Unexpected Codex binding"))
        }
        _ => {}
    }
    let assign_identity = if matches!(
        &input,
        crate::application::assistance::Request::Prepare { .. }
    ) && identity.provider
        == crate::application::assistance::Provider::Codex
    {
        Some(identity.clone())
    } else {
        None
    };
    let workflow_enabled = store
        .workflow
        .enabled(identity)
        .map_err(|e| error(StatusCode::CONFLICT, e))?;
    match &input {
        crate::application::assistance::Request::Prepare {
            workflow_binding,
            binding,
            ..
        } => {
            if workflow_enabled && workflow_binding.is_none() {
                return Err(error(
                    StatusCode::CONFLICT,
                    "Current workflow binding is required",
                ));
            }
            if let Some(expected) = workflow_binding {
                store
                    .workflow
                    .validate_guidance(
                        identity,
                        expected,
                        binding.as_ref().map(|value| value.turn_id.as_str()),
                    )
                    .map_err(|e| error(StatusCode::CONFLICT, e))?;
            }
        }
        crate::application::assistance::Request::Delivered { binding, .. }
        | crate::application::assistance::Request::Context { binding, .. }
        | crate::application::assistance::Request::Quality { binding, .. } => {
            let record = store
                .assistance
                .load(identity)
                .map_err(|e| error(StatusCode::CONFLICT, e))?;
            if let Some(expected) = record
                .receipt
                .as_ref()
                .and_then(|receipt| receipt.workflow_binding.as_ref())
            {
                store
                    .workflow
                    .validate_guidance(
                        identity,
                        expected,
                        binding.as_ref().map(|value| value.turn_id.as_str()),
                    )
                    .map_err(|e| error(StatusCode::CONFLICT, e))?;
            }
        }
        _ => {}
    }
    let context_change = match &input {
        crate::application::assistance::Request::Sync {
            identity, context, ..
        }
        | crate::application::assistance::Request::Context {
            identity, context, ..
        } => {
            let old = store
                .assistance
                .load(identity)
                .map_err(|e| error(StatusCode::CONFLICT, e))?;
            if crate::application::workflow::context_affects_plan(&old.task.context, context) {
                Some(identity.clone())
            } else {
                None
            }
        }
        _ => None,
    };
    let result = store
        .assistance
        .dispatch_with_workflow(input, workflow_enabled)
        .map_err(|e| error(StatusCode::CONFLICT, e))?;
    if let Some(identity) = context_change {
        store
            .workflow
            .invalidate_plan(&identity)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
    }
    let snapshot = if let Some(identity) = assign_identity {
        if store
            .assign_first_assistance_pet(&identity)
            .map_err(|e| error(StatusCode::CONFLICT, e))?
        {
            Some(store.snapshot())
        } else {
            None
        }
    } else {
        None
    };
    drop(store);
    if let Some(snapshot) = snapshot {
        (state.on_change)(snapshot);
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct TaskContextQuery {
    session_id: String,
    cwd: String,
}

pub(super) async fn task_context(
    State(state): State<BridgeState>,
    Query(query): Query<TaskContextQuery>,
) -> BridgeResult<TaskContext> {
    let context = state
        .store
        .lock()
        .map_err(state_error)?
        .task_context(&query.session_id, &query.cwd)
        .map_err(|e| error(StatusCode::NOT_FOUND, e))?;
    Ok(Json(context))
}

pub(super) async fn task_config(
    State(state): State<BridgeState>,
    Json(input): Json<TaskConfiguration>,
) -> BridgeResult<TaskConfigured> {
    let (result, snapshot) = {
        let mut store = state.store.lock().map_err(state_error)?;
        let result = store
            .configure_task(input)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
        (result, store.snapshot())
    };
    (state.on_change)(snapshot);
    Ok(Json(result))
}
pub(super) async fn events(
    State(state): State<BridgeState>,
    Json(input): Json<EventInput>,
) -> BridgeResult<serde_json::Value> {
    let snapshot = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .apply_event(input)
            .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
        store.snapshot()
    };
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true})))
}
