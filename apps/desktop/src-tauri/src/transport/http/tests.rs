use super::*;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

// Real compiled application bridge, without opening windows or touching the installed DB.
// Explicitly invoked only for the bounded dedicated Desktop connection trial.
#[tokio::test]
#[ignore]
async fn external_pet_bridge_probe() {
    let dir=std::path::PathBuf::from(std::env::var_os("AUTOPETS_ISOLATED_PROBE_DIR").expect("explicit probe directory"));
    assert!(dir.is_absolute() && dir.join(".autopets-probe-v1").is_file());
    let store=Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(&dir).unwrap()));
    let mut bridge=start(store.clone(),Arc::new(|_|{})).await.unwrap();
    std::fs::write(dir.join("ready"),"real-application-bridge-v1").unwrap();
    let deadline=tokio::time::Instant::now()+Duration::from_secs(300);
    while tokio::time::Instant::now()<deadline && !dir.join("finish").exists() {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let links=store.lock().unwrap().snapshot().pet_links;
    std::fs::write(dir.join("probe-result.json"),serde_json::to_vec_pretty(&links).unwrap()).unwrap();
    bridge.shutdown();
}

#[tokio::test]
async fn explicit_pet_connection_is_authenticated_without_hook_sessions() {
    let dir=tempfile::tempdir().unwrap();
    let store=Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
    let mut bridge=start(store.clone(),Arc::new(|_|{})).await.unwrap();
    let info:ConnectionInfo=serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth=format!("Authorization: Bearer {}\r\n",info.token);
    let target=serde_json::json!({"sourceId":"codex-windows-local","threadId":"11111111-1111-4111-8111-111111111111","cwd":dir.path().to_string_lossy()});
    let body=serde_json::json!({"operation":"connect","target":target});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/pet-link","",body.clone()).await.0,401);
    let connected=json_http(&bridge.base_url,"POST","/v1/pet-link",&auth,body.clone()).await;
    assert_eq!(connected.0,200);assert_eq!(connected.1["accountIdentity"],"unknown");assert_eq!(connected.1["liveHooksVerified"],false);
    assert_eq!(connected.1["link"]["connected"],true);assert!(store.lock().unwrap().snapshot().sessions.is_empty());
    let mut forged=body;forged["externalRoutingVerified"]=true.into();
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/pet-link",&auth,forged).await.0,422);
    let prepared=serde_json::json!({"operation":"prepare","target":target,"expectedRevision":1,"requestId":"33333333-3333-4333-8333-333333333333","profile":"light"});
    let first=json_http(&bridge.base_url,"POST","/v1/pet-link",&auth,prepared.clone()).await;
    assert_eq!(first.0,200);assert_eq!(first.1["dispatchAllowed"],true);
    let repeat=json_http(&bridge.base_url,"POST","/v1/pet-link",&auth,prepared).await;
    assert_eq!(repeat.0,200);assert_eq!(repeat.1["dispatchAllowed"],false);
    bridge.shutdown();
    assert!(tokio::net::TcpStream::connect(bridge.base_url.trim_start_matches("http://")).await.is_err() || *bridge.stop_signal.borrow());
    let mut reopened=crate::application::store::Store::new(dir.path()).unwrap();
    let read=serde_json::from_value(serde_json::json!({"operation":"read","target":target})).unwrap();
    let link=reopened.pet_link_request(read).unwrap().unwrap();
    assert!(!link.connected);assert_eq!(link.run.unwrap().state,crate::domain::pet_link::RunState::Unknown);
}

#[tokio::test]
async fn task_graph_is_authenticated_revision_bound_and_never_enables_live_control() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let info: ConnectionInfo = serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", info.token);
    let body = serde_json::json!({"expectedRevision":0,"report":crate::domain::task_graph::fixture()});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/task-graph","",body.clone()).await.0,401);
    let browser = format!("{auth}Origin: http://127.0.0.1\r\n");
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/task-graph",&browser,body.clone()).await.0,403);
    let result = json_http(&bridge.base_url,"POST","/v1/task-graph",&auth,body.clone()).await;
    assert_eq!(result.0,200); assert_eq!(result.1["revision"],1);
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/task-graph",&auth,body).await.0,409);
    let mut forged = serde_json::json!({"expectedRevision":1,"report":crate::domain::task_graph::fixture()});
    forged["report"]["controlEnabled"] = serde_json::json!(true);
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/task-graph",&auth,forged).await.0,422);
    assert!(store.lock().unwrap().snapshot().sessions.is_empty());
    assert!(!store.lock().unwrap().workflow.preferences().unwrap().enabled);
    bridge.shutdown();
}

#[tokio::test]
async fn setup_is_authenticated_and_does_not_fabricate_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(
        crate::application::store::Store::new(dir.path()).unwrap(),
    ));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let info: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", info.token);
    let body = serde_json::json!({"installedVersion":env!("CARGO_PKG_VERSION"),"sessionId":"setup-chat","cwd":dir.path().to_string_lossy()});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/setup", "", body.clone())
            .await
            .0,
        401
    );
    let result = json_http(&bridge.base_url, "POST", "/v1/setup", &auth, body).await;
    assert_eq!(result.0, 200);
    assert_eq!(result.1["phase"], "connecting");
    assert_eq!(result.1["protection"]["model"], false);
    assert!(store.lock().unwrap().snapshot().sessions.is_empty());
    bridge.shutdown();
}

#[tokio::test]
async fn disconnect_is_authenticated_and_preserves_task_records() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let info: ConnectionInfo = serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", info.token);
    let body = serde_json::json!({"hostId":"codex-windows-local"});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/setup/disconnect","",body.clone()).await.0, 401);
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/setup/disconnect",&auth,serde_json::json!({"hostId":"work-local"})).await.0, 409);
    let setup = serde_json::json!({"installedVersion":env!("CARGO_PKG_VERSION"),"sessionId":null,"cwd":null,"entryPoint":"desktop"});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/setup",&auth,setup).await.0,200);
    let (_, result) = json_http(&bridge.base_url,"POST","/v1/setup/disconnect",&auth,body).await;
    assert_eq!(result["connections"][0]["configured"],false);
    assert_eq!(result["chatConnected"],false);
    assert!(store.lock().unwrap().workflow.preferences().unwrap().enabled);
    bridge.shutdown();
}

#[tokio::test]
async fn chatgpt_read_cannot_complete_codex_first_task_setup() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let info: ConnectionInfo = serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", info.token);
    let setup = serde_json::json!({"installedVersion":env!("CARGO_PKG_VERSION"),"sessionId":null,"cwd":null});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/setup",&auth,setup).await.0,200);
    let read = serde_json::json!({"operation":"read","identity":{"provider":"chatgpt","accountId":"browser-account","chatId":"unrelated-web-chat"}});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/assistance",&auth,read).await.0,200);
    assert_eq!(store.lock().unwrap().setup_status().unwrap()["chatConnected"],false);
    let other_event = serde_json::json!({"provider":"chatgpt","eventId":"wrong-provider","sessionId":"unrelated-web-chat","turnId":"turn","kind":"turn_started","cwd":dir.path().to_string_lossy(),"timestamp":crate::domain::activity::now_ms()});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/events",&auth,other_event).await.0,422);
    assert!(store.lock().unwrap().sessions.is_empty());
    bridge.shutdown();
}

#[tokio::test]
async fn workflow_preflight_is_authenticated_cwd_bound_and_never_invents_started_turns() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(
        crate::application::store::Store::new(dir.path()).unwrap(),
    ));
    store
        .lock()
        .unwrap()
        .workflow
        .save_preferences(crate::domain::workflow::Preferences {
            enabled: true,
            ..Default::default()
        })
        .unwrap();
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let info: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", info.token);
    let identity = serde_json::json!({"provider":"codex","accountId":format!("session:{:x}",Sha256::digest(b"flow")),"chatId":"flow"});
    let binding = serde_json::json!({"sessionId":"flow","cwd":"C:/workflow","turnId":"first"});
    let read = serde_json::json!({"operation":"read","identity":identity,"binding":binding});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/workflow", "", read.clone())
            .await
            .0,
        401
    );
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/workflow",
            &format!("{auth}Origin: https://chatgpt.com\r\n"),
            read.clone()
        )
        .await
        .0,
        403
    );
    let result = json_http(
        &bridge.base_url,
        "POST",
        "/v1/workflow",
        &auth,
        read.clone(),
    )
    .await;
    assert_eq!(result.0, 200);
    assert_eq!(result.1["task"]["enabled"], true);
    assert_eq!(result.1["capabilities"]["modelObservation"], false);
    let mut wrong = read.clone();
    wrong["binding"]["cwd"] = serde_json::json!("C:/other");
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/workflow", &auth, wrong)
            .await
            .0,
        409
    );
    let mut scope = read.clone();
    scope["identity"]["accountId"] = serde_json::json!("arbitrary-account");
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/workflow", &auth, scope)
            .await
            .0,
        409
    );
    let preflight = serde_json::json!({"operation":"preflight","identity":identity,"binding":binding,
        "expectedSettingsRevision":0,"expectedPlanRevision":0,"submissionId":"first","requestFingerprint":"a".repeat(64),"intent":"new-work",
        "observation":{"model":"gpt-6-astra","reasoning":null,"mode":null,"source":"hook","observedAt":crate::domain::activity::now_ms(),"submissionId":"first"}});
    let result = json_http(
        &bridge.base_url,
        "POST",
        "/v1/workflow",
        &auth,
        preflight.clone(),
    )
    .await;
    assert_eq!(result.0, 200);
    assert_eq!(result.1["decision"], "passthrough");
    assert!(result.1["task"]["observation"].is_null());
    let mut elevated = preflight.clone();
    elevated["capabilities"] =
        serde_json::json!({"verification":"verified","modelObservation":true});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/workflow", &auth, elevated)
            .await
            .0,
        422
    );
    let mut missing_turn = preflight;
    missing_turn["binding"]
        .as_object_mut()
        .unwrap()
        .remove("turnId");
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/workflow",
            &auth,
            missing_turn
        )
        .await
        .0,
        400
    );
    // The existing endpoint still demands a genuinely observed active turn.
    assert_eq!(
        assistance_http(&bridge.base_url, &auth, read.clone())
            .await
            .0,
        409
    );
    let record = serde_json::json!({"operation":"recordPlan","identity":identity,"binding":binding,"expectedSettingsRevision":0,"expectedPlanRevision":0,
        "plan":{"summary":"관측하지 않은 계획","steps":[],"completionCriteria":[]}});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/workflow", &auth, record)
            .await
            .0,
        409
    );
    {
        let store = store.lock().unwrap();
        assert!(store.snapshot().sessions.is_empty());
        assert!(store
            .snapshot()
            .slots
            .iter()
            .all(|s| s.session_id.is_none()));
        assert!(store.assistance.overview().unwrap().tasks.is_empty());
        assert!(!store.assistance.preferences().unwrap().enabled);
    }
    bridge.shutdown();
}

async fn http(base_url: &str, method: &str, path: &str, headers: &str, body: &str) -> u16 {
    let address = base_url.strip_prefix("http://").unwrap();
    let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
    let message = format!("{method} {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}\r\n{body}", body.len());
    socket.write_all(message.as_bytes()).await.unwrap();
    let mut output = String::new();
    let mut reader = BufReader::new(socket);
    tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut output))
        .await
        .unwrap()
        .unwrap();
    output.split_whitespace().nth(1).unwrap().parse().unwrap()
}

async fn assistance_http(
    base_url: &str,
    headers: &str,
    body: serde_json::Value,
) -> (u16, serde_json::Value) {
    json_http(base_url, "POST", "/v1/assistance", headers, body).await
}

pub(super) async fn json_http(
    base_url: &str,
    method: &str,
    path: &str,
    headers: &str,
    body: serde_json::Value,
) -> (u16, serde_json::Value) {
    let address = base_url.strip_prefix("http://").unwrap();
    let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
    let body = body.to_string();
    let message=format!("{method} {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}\r\n{body}",body.len());
    socket.write_all(message.as_bytes()).await.unwrap();
    let mut output = String::new();
    tokio::time::timeout(Duration::from_secs(5), socket.read_to_string(&mut output))
        .await
        .unwrap()
        .unwrap();
    let (head, body) = output.split_once("\r\n\r\n").unwrap();
    (
        head.split_whitespace().nth(1).unwrap().parse().unwrap(),
        serde_json::from_str(body).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn assistance_http_auth_binding_revisions_and_unverified_delivery() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(
        crate::application::store::Store::new(dir.path()).unwrap(),
    ));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let connection: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", connection.token);
    assert_eq!(
        http(&bridge.base_url, "GET", "/v1/assistance-status", "", "").await,
        401
    );
    assert_eq!(
        http(
            &bridge.base_url,
            "GET",
            "/v1/assistance-status",
            &format!("{auth}Origin: https://chatgpt.com\r\n"),
            ""
        )
        .await,
        403
    );
    for _ in 0..3 {
        let (status, body) = json_http(
            &bridge.base_url,
            "GET",
            "/v1/assistance-status",
            &auth,
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(body["preferences"]["enabled"], false);
        assert_eq!(body["capabilities"]["chatgpt"]["inputAssistance"], false);
        assert_eq!(body.as_object().unwrap().len(), 2);
    }
    assert!(store
        .lock()
        .unwrap()
        .assistance
        .overview()
        .unwrap()
        .tasks
        .is_empty());
    let identity = serde_json::json!({"provider":"codex","accountId":format!("session:{:x}", Sha256::digest(b"s1")),"chatId":"s1"});
    let binding = serde_json::json!({"sessionId":"s1","turnId":"t1","cwd":"C:/test"});
    let read = serde_json::json!({"operation":"read","identity":identity,"binding":binding});
    assert_eq!(
        assistance_http(&bridge.base_url, "", read.clone()).await.0,
        401
    );
    assert_eq!(
        assistance_http(
            &bridge.base_url,
            &format!("{auth}Origin: https://chatgpt.com\r\n"),
            read.clone()
        )
        .await
        .0,
        403
    );
    assert_eq!(
        assistance_http(&bridge.base_url, &auth, read.clone())
            .await
            .0,
        409
    );
    let event=serde_json::json!({"eventId":"as-e1","sessionId":"s1","turnId":"t1","kind":"turn_started","cwd":"C:/test","timestamp":crate::application::store::now_ms()}).to_string();
    assert_eq!(
        http(&bridge.base_url, "POST", "/v1/events", &auth, &event).await,
        200
    );
    let (status, body) = assistance_http(&bridge.base_url, &auth, read.clone()).await;
    assert_eq!(status, 200);
    assert_eq!(body["preferences"]["enabled"], false);
    assert_eq!(body["capabilities"]["codex"]["modelSwitch"], false);
    let mut wrong_scope = read.clone();
    wrong_scope["identity"]["accountId"] = "arbitrary-account".into();
    assert_eq!(
        assistance_http(&bridge.base_url, &auth, wrong_scope)
            .await
            .0,
        409
    );
    assert_eq!(
        store
            .lock()
            .unwrap()
            .assistance
            .overview()
            .unwrap()
            .tasks
            .len(),
        1
    );
    let mut wrong = read.clone();
    wrong["binding"]["turnId"] = "t2".into();
    assert_eq!(assistance_http(&bridge.base_url, &auth, wrong).await.0, 409);
    let prepare = serde_json::json!({"operation":"prepare","identity":identity,"binding":binding,"expectedRevision":0,"preferencesRevision":1,"recipeId":"general","requestedModel":null,"reason":"준비","injectionBytes":200,"guidanceHash":"b".repeat(64)});
    assert_eq!(
        assistance_http(&bridge.base_url, &auth, prepare.clone())
            .await
            .0,
        409
    );
    {
        let mut locked = store.lock().unwrap();
        let mut prefs = locked.assistance.preferences().unwrap();
        prefs.enabled = true;
        locked.assistance.save_preferences(prefs).unwrap();
    }
    let (status, prepared) = assistance_http(&bridge.base_url, &auth, prepare).await;
    assert_eq!(status, 200);
    assert_eq!(
        store.lock().unwrap().snapshot().slots[0]
            .session_id
            .as_deref(),
        Some("s1")
    );
    let nonce = prepared["nonce"].clone();
    let mut delivered = serde_json::json!({"operation":"delivered","identity":identity,"binding":binding,"nonce":nonce,"evidence":"confirmed"});
    assert_eq!(
        assistance_http(&bridge.base_url, &auth, delivered.clone())
            .await
            .0,
        409
    );
    delivered["evidence"] = "sent".into();
    let (status, sent) = assistance_http(&bridge.base_url, &auth, delivered.clone()).await;
    assert_eq!(status, 200);
    assert_eq!(sent["task"]["assistance"]["status"], "sent");
    assert!(sent["task"]["assistance"]["appliedModel"].is_null());
    assert_eq!(
        assistance_http(&bridge.base_url, &auth, delivered).await.0,
        409
    );
    let context = serde_json::json!({"goal":"수정된 비교","outputFormat":"표","constraints":[],"decisions":[],"remaining":[]});
    let sync = serde_json::json!({"operation":"sync","identity":identity,"binding":binding,"expectedRevision":0,"context":context});
    let (status, synced) = assistance_http(&bridge.base_url, &auth, sync.clone()).await;
    assert_eq!(status, 200);
    assert_eq!(synced["task"]["revision"], 1);
    assert_eq!(synced["task"]["assistance"]["status"], "pending");
    assert_eq!(assistance_http(&bridge.base_url, &auth, sync).await.0, 409);
    let other = serde_json::json!({"provider":"chatgpt","accountId":"opaque","chatId":"s1"});
    let (_, other_read) = assistance_http(
        &bridge.base_url,
        &auth,
        serde_json::json!({"operation":"read","identity":other}),
    )
    .await;
    assert_eq!(other_read["task"]["context"]["goal"], "");
    assert_eq!(assistance_http(&bridge.base_url,&auth,serde_json::json!({"operation":"sync","identity":other,"expectedRevision":0,"context":context})).await.0,409);
    bridge.shutdown();
}

#[test]
fn authorization_token_comparison_is_exact() {
    assert!(constant_time_equal(b"Bearer a", b"Bearer a"));
    assert!(!constant_time_equal(b"Bearer a", b"Bearer b"));
    assert!(!constant_time_equal(b"Bearer a", b"Bearer a "));
}

#[tokio::test]
async fn actual_http_bridge_rejects_unauthorized_origins_oversized_and_wrong_bindings() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(
        crate::application::store::Store::new(dir.path()).unwrap(),
    ));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let connection: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let authorization = format!("Authorization: Bearer {}\r\n", connection.token);
    let event = serde_json::json!({"eventId":"e1","sessionId":"s1","turnId":"t1","kind":"turn_started","cwd":"C:/test","timestamp":crate::application::store::now_ms()}).to_string();
    assert_eq!(
        http(&bridge.base_url, "POST", "/v1/events", "", &event).await,
        401
    );
    assert_eq!(
        http(
            &bridge.base_url,
            "POST",
            "/v1/events",
            &format!("{authorization}Origin: http://localhost\r\n"),
            &event
        )
        .await,
        403
    );
    assert_eq!(
        http(
            &bridge.base_url,
            "POST",
            "/v1/events",
            &authorization,
            &event
        )
        .await,
        200
    );
    assert_eq!(
        http(
            &bridge.base_url,
            "GET",
            "/v1/approvals/missing/wait?sessionId=s1&turnId=t1",
            &authorization,
            ""
        )
        .await,
        404
    );
    assert_eq!(
        http(
            &bridge.base_url,
            "POST",
            "/v1/events",
            &authorization,
            &"x".repeat(256 * 1024 + 1)
        )
        .await,
        413
    );
    assert_eq!(store.lock().unwrap().snapshot().sessions.len(), 1);
    assert_eq!(
        http(
            &bridge.base_url,
            "GET",
            "/v1/task-context?sessionId=s1&cwd=C%3A%2Ftest",
            &authorization,
            ""
        )
        .await,
        200
    );
    assert_eq!(
        http(
            &bridge.base_url,
            "GET",
            "/v1/task-context?sessionId=s1&cwd=C%3A%2Fother",
            &authorization,
            ""
        )
        .await,
        404
    );
    let configure=serde_json::json!({"requestId":"configure1","sessionId":"s1","turnId":"t1","cwd":"C:/test","completionCriterion":"A report file","interventionMode":"when-needed","elapsedAlertMinutes":10}).to_string();
    assert_eq!(
        http(
            &bridge.base_url,
            "POST",
            "/v1/task-config",
            &authorization,
            &configure
        )
        .await,
        200
    );
    assert_eq!(
        store.lock().unwrap().snapshot().slots[0]
            .session_id
            .as_deref(),
        Some("s1")
    );
    assert!(!store.lock().unwrap().snapshot().approval_enabled);
    bridge.shutdown();
    assert!(!bridge.connection_path.exists());
}

#[tokio::test]
async fn review_cards_are_authenticated_bounded_and_only_for_a_review_pet_chat() {
    let dir=tempfile::tempdir().unwrap();
    let store=Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
    let mut bridge=start(store.clone(),Arc::new(|_|{})).await.unwrap();
    let info:ConnectionInfo=serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth=format!("Authorization: Bearer {}\r\n",info.token);
    let target=serde_json::json!({"sourceId":"codex-windows-local","threadId":"11111111-1111-4111-8111-111111111111","cwd":dir.path().to_string_lossy()});
    let card=serde_json::json!({"question":"2+2는?","choices":["3","4","5","6"],"answer":2,"explanation":"2와 2를 더하면 4","topic":"덧셈","correct":true});
    let save=serde_json::json!({"operation":"save","target":target,"batch":{"name":"덧셈"},"cards":[card]});
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review","",save.clone()).await.0,401);
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,save.clone()).await.0,404, "no pet link for this chat");
    json_http(&bridge.base_url,"POST","/v1/pet-link",&auth,serde_json::json!({"operation":"connect","target":target})).await;
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,save.clone()).await.0,409, "a chat with another pet");
    {
        let catalog:serde_json::Value=serde_json::from_str(include_str!("../../../../../../packages/contracts/data/pet-catalog.json")).unwrap();
        let entry=catalog.as_array().unwrap().iter().find(|e|e["id"]=="review-helper").unwrap();
        let mut state=store.lock().unwrap();
        let key=format!("codex-windows-local:{}",target["threadId"].as_str().unwrap());
        state.pet_links.get_mut(&key).unwrap().template=serde_json::from_value(entry["template"].clone()).unwrap();
    }
    let mut forged=save.clone(); forged["cards"][0]["chat"]="전체 대화".into();
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,forged).await.0,422, "only card fields");
    let mut bad=save.clone(); bad["cards"][0]["answer"]=7.into();
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,bad).await.0,400);
    let mut unnamed=save.clone(); unnamed.as_object_mut().unwrap().remove("batch");
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,unnamed).await.0,422, "a new quiz needs its batch name");
    let mut forged=save.clone(); forged["batch"]["chat"]="전체 대화".into();
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,forged).await.0,422, "only the batch name");
    let mut blank=save.clone(); blank["batch"]["name"]="".into();
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,blank).await.0,400);
    let mut both=save.clone(); both["batch"]["id"]="ab12cd34".into();
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,both).await.0,400, "a name or an id, not both");
    let saved=json_http(&bridge.base_url,"POST","/v1/review",&auth,save).await;
    assert_eq!(saved.0,200); assert_eq!(saved.1["saved"],1); assert_eq!(saved.1["batch"]["name"],"덧셈");
    let batch=saved.1["batch"]["id"].as_str().unwrap().to_owned();
    let due=json_http(&bridge.base_url,"POST","/v1/review",&auth,serde_json::json!({"operation":"due","target":target})).await;
    assert_eq!(due.0,200); assert_eq!(due.1["cards"].as_array().unwrap().len(),0, "a right answer is not due today");
    let all=json_http(&bridge.base_url,"POST","/v1/review",&auth,serde_json::json!({"operation":"due","target":target,"batch":batch,"all":true})).await;
    assert_eq!(all.0,200); assert_eq!(all.1["cards"].as_array().unwrap().len(),1, "전체 다시 풀기 reads the whole batch");
    let missing=json_http(&bridge.base_url,"POST","/v1/review",&auth,serde_json::json!({"operation":"due","target":target,"batch":"00000000","all":true})).await;
    assert_eq!(missing.0,404); assert_eq!(missing.1["error"],"review-batch-not-found");
    let card_id=all.1["cards"][0]["id"].clone();
    let redo=json_http(&bridge.base_url,"POST","/v1/review",&auth,serde_json::json!({"operation":"result","target":target,"batch":batch,"all":true,"results":[{"id":card_id,"correct":false}]})).await;
    assert_eq!(redo.0,200); assert_eq!(redo.1["wrong"],1);
    let mut more=serde_json::json!({"operation":"save","target":target,"batch":{"id":batch},"cards":[card.clone()]});
    let added=json_http(&bridge.base_url,"POST","/v1/review",&auth,more.clone()).await;
    assert_eq!(added.0,200); assert_eq!(added.1["batch"]["id"],batch.as_str(), "a review's new question joins its batch");
    more["batch"]["id"]="00000000".into();
    assert_eq!(json_http(&bridge.base_url,"POST","/v1/review",&auth,more).await.0,404);
    let review=store.lock().unwrap().snapshot().review;
    assert_eq!((review.total,review.batches),(2,1));
    bridge.shutdown();
}
