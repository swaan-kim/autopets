use super::*;
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SourceQuery { source_id: String }
pub(super) async fn read(State(state): State<BridgeState>, Query(input): Query<SourceQuery>) -> BridgeResult<serde_json::Value> {
    let store = state.store.lock().map_err(state_error)?;
    let sources = store.task_graph_snapshot().map_err(|e| error(StatusCode::CONFLICT, e))?;
    let revision = sources.iter().find(|saved| saved.report.source_id == input.source_id).map_or(0, |saved| saved.revision);
    Ok(Json(serde_json::json!({"sourceId":input.source_id,"revision":revision})))
}
pub(super) async fn import(State(state): State<BridgeState>, Json(input): Json<crate::domain::task_graph::Import>) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let saved = store.import_task_graph(input).map_err(|e| error(StatusCode::CONFLICT, e))?;
    Ok(Json(serde_json::json!({"sourceId":saved.report.source_id,"revision":saved.revision})))
}
