use super::*;
use super::tests::json_http;

#[tokio::test]
async fn applying_a_saved_pet_keeps_the_authenticated_strict_interface_and_dispatch_gate() {
    let dir = tempfile::tempdir().unwrap();
    let mut raw_store = crate::application::store::Store::new(dir.path()).unwrap();
    let template = serde_json::from_str(include_str!("../../../../../../packages/contracts/data/ui-pet.json")).unwrap();
    let saved = raw_store.save_pet(None, 0, template).unwrap();
    let store = Arc::new(std::sync::Mutex::new(raw_store));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let info: ConnectionInfo = serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", info.token);
    let target = serde_json::json!({ "sourceId":"codex-windows-local", "threadId":"11111111-1111-4111-8111-111111111111", "cwd":dir.path().to_string_lossy() });
    let connect = serde_json::json!({ "operation":"connect", "target":target });
    assert_eq!(json_http(&bridge.base_url, "POST", "/v1/pet-link", &auth, connect).await.0, 200);
    let apply = serde_json::json!({ "operation":"apply-pet", "target":target, "expectedRevision":1, "petId":saved.id, "petRevision":saved.revision });
    assert_eq!(json_http(&bridge.base_url, "POST", "/v1/pet-link", "", apply.clone()).await.0, 401);
    let mut forged = apply.clone(); forged["modelSwitchVerified"] = true.into();
    assert_eq!(json_http(&bridge.base_url, "POST", "/v1/pet-link", &auth, forged).await.0, 422);
    let applied = json_http(&bridge.base_url, "POST", "/v1/pet-link", &auth, apply.clone()).await;
    assert_eq!(applied.0, 200); assert_eq!(applied.1["link"]["revision"], 2);
    assert_eq!(applied.1["link"]["savedPet"]["id"], saved.id);
    assert_eq!(applied.1["dispatchAllowed"], false); assert_eq!(applied.1["externalRoutingVerified"], false);
    assert_eq!(json_http(&bridge.base_url, "POST", "/v1/pet-link", &auth, apply).await.0, 409);
    let prepare = serde_json::json!({ "operation":"prepare", "target":target, "expectedRevision":2, "requestId":"33333333-3333-4333-8333-333333333333", "profile":"light" });
    let prepared = json_http(&bridge.base_url, "POST", "/v1/pet-link", &auth, prepare).await;
    assert_eq!(prepared.0, 200); assert_eq!(prepared.1["dispatchAllowed"], true);
    assert_eq!(prepared.1["link"]["run"]["template"]["skills"][0]["id"], "frontend-design");
    assert_eq!(prepared.1["link"]["run"]["skillEvidence"], serde_json::json!([]));
    assert_eq!(prepared.1["link"]["run"]["figmaUsed"], false);
    bridge.shutdown();
}
