use super::tests::json_http;
use super::*;

#[tokio::test]
async fn artifacts_require_auth_observed_identity_current_turn_and_user_only_acceptance() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(std::sync::Mutex::new(
        crate::application::store::Store::new(dir.path()).unwrap(),
    ));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let connection: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", connection.token);
    let identity = serde_json::json!({"provider":"codex","accountId":format!("session:{:x}",Sha256::digest(b"artifact-chat")),"chatId":"artifact-chat"});
    let binding = serde_json::json!({"sessionId":"artifact-chat","turnId":"turn-1","cwd":dir.path().to_string_lossy()});
    let inspect = serde_json::json!({"operation":"inspect","identity":identity,"binding":binding});
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/artifacts",
            "",
            inspect.clone()
        )
        .await
        .0,
        401
    );
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/artifacts",
            "Authorization: Bearer wrong\r\n",
            inspect.clone()
        )
        .await
        .0,
        401
    );
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/artifacts",
            &format!("{auth}Origin: https://example.test\r\n"),
            inspect.clone()
        )
        .await
        .0,
        403
    );
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/artifacts",
            &auth,
            inspect.clone()
        )
        .await
        .0,
        409
    );
    assert!(store.lock().unwrap().snapshot().sessions.is_empty());
    assert!(store
        .lock()
        .unwrap()
        .artifacts
        .snapshot()
        .unwrap()
        .projects
        .is_empty());
    let event = serde_json::json!({"eventId":"artifact-start","sessionId":"artifact-chat","turnId":"turn-1","kind":"turn_started","cwd":dir.path().to_string_lossy(),"timestamp":crate::application::store::now_ms()});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/events", &auth, event)
            .await
            .0,
        200
    );
    let result = json_http(
        &bridge.base_url,
        "POST",
        "/v1/artifacts",
        &auth,
        inspect.clone(),
    )
    .await;
    assert_eq!(result.0, 200);
    assert!(result.1["project"].is_null());
    assert_eq!(result.1.as_object().unwrap().len(), 2);
    for (field, value) in [
        ("turnId", "old-turn"),
        ("sessionId", "other-chat"),
        ("cwd", "C:/other-project"),
    ] {
        let mut wrong = inspect.clone();
        wrong["binding"][field] = value.into();
        assert_ne!(
            json_http(&bridge.base_url, "POST", "/v1/artifacts", &auth, wrong)
                .await
                .0,
            200
        );
    }
    for (field, value) in [
        ("accountId", "other-account"),
        ("provider", "chatgpt"),
        ("chatId", "other-chat"),
    ] {
        let mut wrong = inspect.clone();
        wrong["identity"][field] = value.into();
        assert_eq!(
            json_http(&bridge.base_url, "POST", "/v1/artifacts", &auth, wrong)
                .await
                .0,
            409
        );
    }
    let brief = serde_json::json!({"audience":"team","message":"hello","points":["alpha"],"sourceText":"selected source","sourceLabel":"excerpt"});
    let style = serde_json::json!({"palette":["#123456"],"logoDataUrl":null,"copyLength":"short","layout":"landscape"});
    let save = serde_json::json!({"operation":"save-brief","identity":identity,"binding":binding,"expectedRevision":0,"templateId":"product-intro","brief":brief,"style":style});
    let saved = json_http(
        &bridge.base_url,
        "POST",
        "/v1/artifacts",
        &auth,
        save.clone(),
    )
    .await;
    assert_eq!(saved.0, 200);
    assert_eq!(saved.1["project"]["revision"], 1);
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/artifacts",
            &auth,
            save.clone()
        )
        .await
        .0,
        409
    );
    let mut other = save.clone();
    other.as_object_mut().unwrap().remove("binding");
    other["identity"]["chatId"] = "other-private-chat".into();
    other["brief"]["sourceText"] = "DO_NOT_RETURN_OTHER_CHAT".into();
    store
        .lock()
        .unwrap()
        .artifacts
        .dispatch(serde_json::from_value(other).unwrap())
        .unwrap();
    let read = json_http(
        &bridge.base_url,
        "POST",
        "/v1/artifacts",
        &auth,
        inspect.clone(),
    )
    .await;
    assert!(!read.1.to_string().contains("DO_NOT_RETURN_OTHER_CHAT"));
    assert!(read.1.get("projects").is_none());
    let imported = serde_json::json!({"operation":"import-version","identity":identity,"binding":binding,"expectedRevision":1,"pngBytes":include_bytes!("../../../icons/32x32.png").to_vec(),"renderedText":"hello alpha"});
    let rendered = json_http(&bridge.base_url, "POST", "/v1/artifacts", &auth, imported).await;
    assert_eq!(rendered.0, 200);
    assert_eq!(
        rendered.1["project"]["versions"][0]["review"]["fidelity"],
        "pending"
    );
    let version_id = rendered.1["project"]["versions"][0]["id"].clone();
    for operation in [
        "review-version",
        "accept-version",
        "save-style",
        "delete-style",
        "set-favorite",
        "delete-project",
    ] {
        let forbidden = serde_json::json!({"operation":operation,"identity":identity,"binding":binding,"expectedRevision":2,"versionId":version_id});
        assert_eq!(
            json_http(&bridge.base_url, "POST", "/v1/artifacts", &auth, forbidden)
                .await
                .0,
            403
        );
    }
    assert_eq!(
        store
            .lock()
            .unwrap()
            .artifacts
            .find(&serde_json::from_value(identity.clone()).unwrap())
            .unwrap()
            .unwrap()
            .revision,
        2
    );
    // Invalid artifact requests do not hold, mutate, or prevent the normal chat finish.
    let finished = serde_json::json!({"eventId":"artifact-finish","sessionId":"artifact-chat","turnId":"turn-1","kind":"turn_finished","cwd":dir.path().to_string_lossy(),"timestamp":crate::application::store::now_ms()+1});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/events", &auth, finished)
            .await
            .0,
        200
    );
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/artifacts", &auth, inspect)
            .await
            .0,
        409
    );
    bridge.shutdown();
}

#[tokio::test]
async fn artifact_body_limit_is_scoped_and_restart_does_not_reauthorize_old_turns() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().to_string_lossy().to_string();
    let store = Arc::new(std::sync::Mutex::new(
        crate::application::store::Store::new(dir.path()).unwrap(),
    ));
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", bridge.token);
    let oversized = serde_json::json!({"padding":"a".repeat(300 * 1024)});
    assert_eq!(
        json_http(
            &bridge.base_url,
            "POST",
            "/v1/events",
            &auth,
            oversized.clone()
        )
        .await
        .0,
        413
    );
    // Artifact route reaches its own validator for >256KiB instead of the generic body limit.
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/artifacts", &auth, oversized)
            .await
            .0,
        409
    );
    let event = serde_json::json!({"eventId":"restart-artifact","sessionId":"restart-chat","turnId":"t","kind":"turn_started","cwd":cwd,"timestamp":crate::application::store::now_ms()});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/events", &auth, event)
            .await
            .0,
        200
    );
    bridge.shutdown();
    drop(bridge);
    drop(store);
    let restored = Arc::new(std::sync::Mutex::new(
        crate::application::store::Store::new(dir.path()).unwrap(),
    ));
    let mut bridge = start(restored.clone(), Arc::new(|_| {})).await.unwrap();
    let auth = format!("Authorization: Bearer {}\r\n", bridge.token);
    let inspect = serde_json::json!({"operation":"inspect","identity":{"provider":"codex","accountId":format!("session:{:x}",Sha256::digest(b"restart-chat")),"chatId":"restart-chat"},"binding":{"sessionId":"restart-chat","turnId":"t","cwd":cwd}});
    assert_eq!(
        json_http(&bridge.base_url, "POST", "/v1/artifacts", &auth, inspect)
            .await
            .0,
        409
    );
    bridge.shutdown();
}
