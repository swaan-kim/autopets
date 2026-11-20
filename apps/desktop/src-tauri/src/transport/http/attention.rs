use super::*;
use crate::domain::attention::Request;

/// Attention hook entry point. `check` comes first: notice text is only sent for a chat that is
/// connected to a pet (explicit link or the `$autopets` setup chat); `resolve` carries ids only.
pub(super) async fn dispatch(State(state): State<BridgeState>, Json(input): Json<Request>) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let now = crate::domain::activity::now_ms();
    let current = &mut *store;
    let setup = current.setup_chat();
    let changes = !matches!(input, Request::Check { .. } | Request::Status {});
    let result = current.attention.request(&current.pet_links, setup.as_ref(), input, now).map_err(|reason| {
        error(if reason == "invalid-attention" { StatusCode::BAD_REQUEST } else { StatusCode::CONFLICT }, reason)
    })?;
    if !changes { return Ok(Json(result)); }
    let snapshot = store.snapshot();
    drop(store);
    (state.on_change)(snapshot);
    Ok(Json(result))
}
