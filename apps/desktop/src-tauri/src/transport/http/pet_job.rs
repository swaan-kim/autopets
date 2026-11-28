use super::*;
use crate::domain::pet_job::Report;

/// MCP entry point: an AI reports that it is asking the user, working, done or failed.
/// The report holds no conversation text and never starts, stops or changes AI work.
pub(super) async fn report(State(state): State<BridgeState>, Json(input): Json<Report>) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let now = crate::domain::activity::now_ms();
    let was_done = store.pet_jobs.snapshot(now).iter().any(|job| job.id == input.job_id && job.state == crate::domain::pet_job::State::Done);
    let job = store.pet_jobs.report(input, now).map_err(|reason| {
        error(if reason == "invalid-pet-job" { StatusCode::BAD_REQUEST } else { StatusCode::CONFLICT }, reason)
    })?;
    // A job that just became done is one finished task for pet coins and evolution.
    if job.state == crate::domain::pet_job::State::Done && !was_done { store.record_pet_finished(job.pet_id.clone()); }
    let snapshot = store.snapshot();
    drop(store);
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({ "ok": true, "jobId": job.id, "state": job.state })))
}
