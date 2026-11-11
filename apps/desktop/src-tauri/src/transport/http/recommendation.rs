use super::*;
use crate::domain::recommendation::Request;

/// Hook/skill entry point. Only chats connected through the explicit pet link, or the chat waiting in setup, are eligible;
/// for any other chat the request text is never sent (`begin` answers `eligible:false` first).
pub(super) async fn dispatch(State(state): State<BridgeState>, Json(input): Json<Request>) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let now = crate::domain::activity::now_ms();
    let current = &mut *store;
    let setup = current.setup_chat();
    let result = current.recommendations.request(&current.pet_links, setup.as_ref(), input, now).map_err(|reason| {
        error(if reason == "invalid-recommendation" { StatusCode::BAD_REQUEST } else { StatusCode::CONFLICT }, reason)
    })?;
    let snapshot = store.snapshot();
    drop(store);
    (state.on_change)(snapshot);
    Ok(Json(result))
}
