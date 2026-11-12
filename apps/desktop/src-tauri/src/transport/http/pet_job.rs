use super::*;
use crate::domain::pet_job::Report;

/// MCP entry point: an AI reports that it is asking the user, working, done or failed.
/// The report holds no conversation text and never starts, stops or changes AI work.
pub(super) async fn report(State(state): State<BridgeState>, Json(input): Json<Report>) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let now = crate::domain::activity::now_ms();
    let job = store.pet_jobs.report(input, now).map_err(|reason| {
        error(if reason == "invalid-pet-job" { StatusCode::BAD_REQUEST } else { StatusCode::CONFLICT }, reason)
    })?;
    let snapshot = store.snapshot();
    drop(store);
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({ "ok": true, "jobId": job.id, "state": job.state })))
}
