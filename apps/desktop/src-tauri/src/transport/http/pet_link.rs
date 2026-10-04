use super::*;
pub(super) async fn dispatch(State(state): State<BridgeState>, Json(input): Json<crate::domain::pet_link::Request>) -> BridgeResult<serde_json::Value> {
    let mut store=state.store.lock().map_err(state_error)?;
    let dispatch_allowed=if let crate::domain::pet_link::Request::Prepare{target,request_id,..}=&input {
        store.pet_links.get(&target.key()).is_some_and(|l| l.run.as_ref().is_none_or(|r| r.id!=*request_id))
    } else { false };
    let link=store.pet_link_request(input).map_err(|e| error(StatusCode::CONFLICT,e))?;
    let snapshot=store.snapshot(); drop(store);
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true,"link":link,"dispatchAllowed":dispatch_allowed,"accountIdentity":"unknown","liveHooksVerified":false,"externalRoutingVerified":false})))
}
