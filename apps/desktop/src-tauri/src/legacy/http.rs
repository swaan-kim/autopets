//! Legacy endpoints retained for compatibility; production decisions remain disabled.
use crate::legacy::approval::*;
use crate::transport::http::*;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use std::time::Duration;
use tokio::time::Instant;

pub(crate) async fn approvals(
    State(state): State<BridgeState>,
    Json(input): Json<ApprovalInput>,
) -> BridgeResult<crate::application::store::Registration> {
    let (response, snapshot) = {
        let mut store = state.store.lock().map_err(state_error)?;
        let response = store
            .register_approval(input)
            .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
        (response, store.snapshot())
    };
    (state.on_change)(snapshot);
    Ok(Json(response))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Binding {
    session_id: String,
    turn_id: String,
}

pub(crate) async fn wait(
    State(state): State<BridgeState>,
    Path(request_id): Path<String>,
    Query(binding): Query<Binding>,
) -> BridgeResult<ApprovalWait> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut stopping = state.stopping.clone();
    // Refresh once per client poll, not from each server-side recheck. A disconnected
    // client therefore cannot keep its lease alive with one abandoned HTTP request.
    let initial = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .wait_status(&request_id, &binding.session_id, &binding.turn_id)
            .map_err(|_| error(StatusCode::NOT_FOUND, "Unknown or inactive approval"))?
    };
    if initial.status != ApprovalStatus::Pending {
        return Ok(Json(initial));
    }
    loop {
        tokio::select! {
            _=tokio::time::sleep(Duration::from_millis(150))=>{},
            _=stopping.changed()=>return Ok(Json(ApprovalWait{status:ApprovalStatus::Forwarded})),
        }
        let result = {
            let mut store = state.store.lock().map_err(state_error)?;
            store
                .peek_status(&request_id, &binding.session_id, &binding.turn_id)
                .map_err(|_| error(StatusCode::NOT_FOUND, "Unknown or inactive approval"))?
        };
        if result.status != ApprovalStatus::Pending || Instant::now() >= deadline {
            return Ok(Json(result));
        }
    }
}

pub(crate) async fn returned(
    State(state): State<BridgeState>,
    Path(request_id): Path<String>,
    Json(binding): Json<Binding>,
) -> BridgeResult<serde_json::Value> {
    let snapshot = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .mark_returned(&request_id, &binding.session_id, &binding.turn_id)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
        store.snapshot()
    };
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true})))
}

pub(crate) async fn abandon(
    State(state): State<BridgeState>,
    Path(request_id): Path<String>,
    Json(binding): Json<Binding>,
) -> BridgeResult<serde_json::Value> {
    let snapshot = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .abandon(&request_id, &binding.session_id, &binding.turn_id)
            .map_err(|_| error(StatusCode::NOT_FOUND, "Unknown or inactive approval"))?;
        store.snapshot()
    };
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true})))
}
