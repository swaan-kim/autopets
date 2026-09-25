use super::*;
use crate::domain::{activity::now_ms, assistance::{Identity, Provider}, workflow::Binding};

#[tokio::test]
async fn selected_role_is_read_only_on_its_bound_codex_chat_and_never_grants_capability() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
    let identity = |chat: &str| Identity { provider: Provider::Codex, account_id: format!("session:{:x}", Sha256::digest(chat.as_bytes())), chat_id: chat.into() };
    {
        let mut locked = store.lock().unwrap();
        for chat in ["role-a", "role-b"] {
            locked.workflow.ensure(&identity(chat), &Binding { session_id: chat.into(), cwd: "C:/fixture".into(), turn_id: None }).unwrap();
            locked.assistance.ensure(&identity(chat)).unwrap();
        }
        let pet = locked.save_pet(None, 0, crate::domain::roles::templates().unwrap().remove(0)).unwrap();
        locked.apply_pet(identity("role-a"), pet.id, 1, 0, 0, true).unwrap();
        for chat in ["role-a", "role-b"] {
            locked.apply_event(serde_json::from_value(serde_json::json!({"eventId":chat,"sessionId":chat,"turnId":"t1","kind":"turn_started","cwd":"C:/fixture","timestamp":now_ms()})).unwrap()).unwrap();
        }
    }
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", bridge.token);
    let read = |chat: &str| serde_json::json!({"operation":"read","identity":identity(chat),"binding":{"sessionId":chat,"turnId":"t1","cwd":"C:/fixture"}});
    let call = |body| tests::json_http(&bridge.base_url, "POST", "/v1/assistance", &auth, body);
    let (status, a) = call(read("role-a")).await;
    assert_eq!(status, 200);
    assert_eq!(a["role"]["identity"], serde_json::to_value(identity("role-a")).unwrap());
    assert_eq!(a["role"]["revision"], 1);
    assert_eq!(a["task"]["settingsRevision"], 1);
    assert_eq!(a["capabilities"]["codex"]["inputAssistance"], false);
    assert_eq!(a["preferences"]["enabled"], false);
    let (status, b) = call(read("role-b")).await;
    assert_eq!(status, 200); assert!(b.get("role").is_none());
    let mut wrong = read("role-a"); wrong["identity"]["accountId"] = "other-source".into();
    assert_eq!(call(wrong).await.0, 409);
    let mut forged = read("role-b"); forged["role"] = a["role"].clone();
    assert_eq!(call(forged).await.0, 422);
    let chat = serde_json::json!({"operation":"read","identity":{"provider":"chatgpt","accountId":"fixture-chat","chatId":"role-a"}});
    assert!(call(chat).await.1.get("role").is_none());
    bridge.shutdown();
}
