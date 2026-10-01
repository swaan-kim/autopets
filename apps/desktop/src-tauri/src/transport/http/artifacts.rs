use super::*;
use crate::domain::artifacts::Request as ArtifactRequest;
use crate::domain::assistance::{Binding, Identity, Provider};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Inspect {
    operation: String,
    identity: Identity,
}

pub(super) async fn artifacts(
    State(state): State<BridgeState>,
    Json(mut input): Json<serde_json::Value>,
) -> BridgeResult<serde_json::Value> {
    let object = input.as_object_mut().ok_or_else(|| {
        error(
            StatusCode::BAD_REQUEST,
            "Artifact request must be an object",
        )
    })?;
    let binding: Binding = serde_json::from_value(
        object
            .remove("binding")
            .ok_or_else(|| error(StatusCode::CONFLICT, "Current Codex binding is required"))?,
    )
    .map_err(|_| error(StatusCode::BAD_REQUEST, "Invalid artifact binding"))?;
    let operation = object
        .get("operation")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    if !matches!(
        operation.as_str(),
        "inspect" | "save-brief" | "request-revision" | "import-version"
    ) {
        return Err(error(
            StatusCode::FORBIDDEN,
            "This artifact operation requires an explicit action in the app",
        ));
    }
    let (identity, request) = if operation == "inspect" {
        let request: Inspect = serde_json::from_value(input)
            .map_err(|_| error(StatusCode::BAD_REQUEST, "Invalid artifact inspection"))?;
        if request.operation != "inspect" {
            return Err(error(StatusCode::BAD_REQUEST, "Invalid artifact operation"));
        }
        (request.identity, None)
    } else {
        let request: ArtifactRequest = serde_json::from_value(input)
            .map_err(|_| error(StatusCode::BAD_REQUEST, "Invalid artifact request"))?;
        let identity = request
            .identity_revision()
            .ok_or_else(|| error(StatusCode::FORBIDDEN, "Artifact identity required"))?
            .0
            .clone();
        (identity, Some(request))
    };
    identity
        .key()
        .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
    if identity.provider != Provider::Codex
        || binding.session_id != identity.chat_id
        || identity.account_id
            != format!("session:{:x}", Sha256::digest(identity.chat_id.as_bytes()))
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Artifact session identity mismatch",
        ));
    }
    crate::domain::activity::validate_id(&binding.turn_id, "artifact turn ID")
        .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
    if !std::path::Path::new(&binding.cwd).is_absolute() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "An absolute observed project path is required",
        ));
    }
    let mut store = state.store.lock().map_err(state_error)?;
    let context = store
        .task_context(&binding.session_id, &binding.cwd)
        .map_err(|e| error(StatusCode::CONFLICT, e))?;
    if context.session_id != identity.chat_id || context.turn_id != binding.turn_id {
        return Err(error(
            StatusCode::CONFLICT,
            "Artifact request is not bound to the observed current turn",
        ));
    }
    if let Some(request) = request {
        store
            .artifacts
            .dispatch(request)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
    }
    // A shared token never grants an all-project snapshot to an agent request.
    let project = store
        .artifacts
        .find(&identity)
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?;
    let styles = store
        .artifacts
        .styles()
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?;
    let snapshot = store.snapshot();
    drop(store);
    (state.on_change)(snapshot);
    Ok(Json(
        serde_json::json!({ "project": project, "styles": styles }),
    ))
}
