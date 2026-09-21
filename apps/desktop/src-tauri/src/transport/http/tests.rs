use super::*;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

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

async fn json_http(
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
