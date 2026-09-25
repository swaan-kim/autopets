//! Internal lifecycle only: real loopback HTTP and temporary SQLite, no desktop app.
use super::*;
use crate::application::store::{now_ms, ApprovalInput, ApprovalStatus, Store};
use crate::domain::activity::{ConnectionState, InterventionMode, SessionState};
use crate::domain::assistance::{AnswerLength, Context, Identity, Provider, Request, WorkStyle};
use std::sync::{Mutex, Weak};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn fixture() -> (tempfile::TempDir, SharedStore) {
    let dir = tempfile::Builder::new().prefix("autopets-종료 test-").tempdir().unwrap();
    let store = Arc::new(Mutex::new(Store::new(dir.path()).unwrap()));
    (dir, store)
}

fn event(store: &mut Store, id: &str, session: &str, kind: &str) {
    store.apply_event(serde_json::from_value(serde_json::json!({
        "eventId": id, "sessionId": session, "turnId": "turn-1", "kind": kind,
        "cwd": store.data_dir.to_string_lossy(), "timestamp": now_ms()
    })).unwrap()).unwrap();
}

// Connection-file deletion alone does not prove the listener or timer has stopped.
async fn assert_stopped(address: &str, store: Weak<Mutex<Store>>) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let refused = match tokio::net::TcpStream::connect(address).await {
                Ok(socket) => { drop(socket); false }
                Err(error) => {
                    assert_eq!(error.kind(), std::io::ErrorKind::ConnectionRefused);
                    true
                }
            };
            if refused && store.upgrade().is_none() { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("listener, HTTP handlers and timer must release the store after shutdown");
}

async fn check_idle_shutdown(explicit: bool) {
    let (_dir, store) = fixture();
    let weak = Arc::downgrade(&store);
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let address = bridge.base_url.strip_prefix("http://").unwrap().to_owned();
    let connection_path = bridge.connection_path.clone();
    let auth = format!("Authorization: Bearer {}\r\n", bridge.token);
    assert_eq!(tests::json_http(&bridge.base_url, "GET", "/v1/setup", &auth, serde_json::Value::Null).await.0, 200);
    if explicit {
        bridge.shutdown();
        bridge.shutdown(); // Normal cleanup and Drop may both call shutdown.
    }
    drop(bridge);
    assert!(!connection_path.exists());
    drop(store);
    assert_stopped(&address, weak).await;
}

#[tokio::test]
async fn explicit_shutdown_closes_listener_and_releases_store() {
    check_idle_shutdown(true).await;
}

#[tokio::test]
async fn dropping_bridge_closes_listener_and_releases_store() {
    check_idle_shutdown(false).await;
}

#[tokio::test]
async fn shutdown_finishes_an_inflight_poll_without_leaving_background_tasks() {
    let (_dir, store) = fixture();
    // Legacy approval activation is test-only; this does not enable live AI hooks.
    let sentinel = now_ms() + 2 * crate::legacy::approval::ADAPTER_LEASE_MS;
    {
        let mut state = store.lock().unwrap();
        event(&mut state, "poll-start", "poll-chat", "turn_started");
        state.assign_session(0, "poll-chat").unwrap();
        state.set_approval_enabled(true).unwrap();
        let cwd = state.data_dir.to_string_lossy().into_owned();
        assert_eq!(state.register_approval(ApprovalInput {
            request_id: "pending-poll".into(), session_id: "poll-chat".into(),
            turn_id: "turn-1".into(), cwd, tool_name: "fixture".into(),
            description: "synthetic lifecycle check".into(), details: "fixture only".into(),
        }).unwrap().mode, "pending");
        state.approvals.get_mut("pending-poll").unwrap().lease_until = sentinel;
    }
    let weak = Arc::downgrade(&store);
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let address = bridge.base_url.strip_prefix("http://").unwrap().to_owned();
    let mut socket = tokio::net::TcpStream::connect(&address).await.unwrap();
    let request = format!("GET /v1/approvals/pending-poll/wait?sessionId=poll-chat&turnId=turn-1 HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n", bridge.token);
    socket.write_all(request.as_bytes()).await.unwrap();
    // Wait for the handler to refresh its lease, not an arbitrary sleep before exit.
    tokio::time::timeout(Duration::from_secs(5), async {
        while store.lock().unwrap().approvals["pending-poll"].lease_until == sentinel {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("poll handler must be in flight before shutdown");
    bridge.shutdown();
    let mut response = String::new();
    tokio::time::timeout(Duration::from_secs(5), socket.read_to_string(&mut response))
        .await.expect("shutdown must complete the poll before its 15 second deadline").unwrap();
    let (head, body) = response.split_once("\r\n\r\n").unwrap();
    assert!(head.starts_with("HTTP/1.1 200"));
    assert_eq!(serde_json::from_str::<serde_json::Value>(body).unwrap()["status"], "forwarded");
    {
        let state = store.lock().unwrap();
        assert!(!state.approval_enabled);
        assert!(!state.approvals["pending-poll"].live);
        assert_eq!(state.approvals["pending-poll"].view.status, ApprovalStatus::Forwarded);
    }
    assert!(!bridge.connection_path.exists());
    drop(socket);
    drop(bridge);
    drop(store);
    assert_stopped(&address, weak).await;
}

#[tokio::test]
async fn shutdown_preserves_nonempty_history_and_settings_on_reopen() {
    let (dir, store) = fixture();
    let positions = br#"{"pet-0":{"x":120,"y":240},"pet-2":{"x":-200,"y":80}}"#;
    std::fs::write(dir.path().join("positions.json"), positions).unwrap();
    let identity = Identity { provider: Provider::Codex, account_id: "fixture-account".into(), chat_id: "saved-chat".into() };
    let context = Context { goal: "종료 후에도 남아야 하는 테스트 기록".into(), constraints: vec!["테스트 폴더만 사용".into()], ..Default::default() };
    let (preferences, workflow_preferences, event_count) = {
        let mut state = store.lock().unwrap();
        event(&mut state, "saved-start", "saved-chat", "turn_started");
        state.rename_session("saved-chat", "보존 검사").unwrap();
        state.configure_session("saved-chat", "기록과 설정 다시 읽기", InterventionMode::Milestones, Some(7)).unwrap();
        state.assign_session(1, "saved-chat").unwrap();
        event(&mut state, "saved-end", "saved-chat", "turn_finished");
        event(&mut state, "active-start", "active-chat", "turn_started");
        let mut preferences = state.assistance.preferences().unwrap();
        preferences.answer_length = AnswerLength::Detailed;
        preferences.work_style = WorkStyle::Thorough;
        let preferences = state.assistance.save_preferences(preferences).unwrap();
        state.assistance.dispatch(Request::Read {
            identity: identity.clone(), binding: None,
        }).unwrap();
        state.assistance.save_context(identity.clone(), context.clone(), 0).unwrap();
        let mut workflow = state.workflow.preferences().unwrap();
        workflow.plan_first = false;
        let workflow = state.workflow.save_preferences(workflow).unwrap();
        let events: u64 = state.db.query_row("SELECT count(*) FROM events", [], |row| row.get(0)).unwrap();
        assert_eq!(events, 3);
        (preferences, workflow, events)
    };
    let weak = Arc::downgrade(&store);
    let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
    let address = bridge.base_url.strip_prefix("http://").unwrap().to_owned();
    bridge.shutdown();
    drop(bridge);
    drop(store);
    assert_stopped(&address, weak).await;

    // Reopen only after every background owner of the previous Store has exited.
    let restored = Store::new(dir.path()).unwrap();
    assert_eq!(restored.sessions.len(), 2);
    let saved = &restored.sessions["saved-chat"];
    assert_eq!(saved.view.label, "보존 검사");
    assert_eq!(saved.view.state, SessionState::Done);
    assert!(saved.view.unread);
    assert_eq!(saved.supervision.view.completion_criterion, "기록과 설정 다시 읽기");
    assert_eq!(saved.supervision.view.elapsed_alert_minutes, Some(7));
    assert!(matches!(saved.supervision.view.intervention_mode, InterventionMode::Milestones));
    assert_eq!(restored.slots, [None, Some("saved-chat".into()), None]);
    assert_eq!(restored.assistance.preferences().unwrap(), preferences);
    assert_eq!(restored.workflow.preferences().unwrap(), workflow_preferences);
    let tasks = restored.assistance.overview().unwrap().tasks;
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].identity, identity);
    assert_eq!(tasks[0].context, context);
    let events: u64 = restored.db.query_row("SELECT count(*) FROM events", [], |row| row.get(0)).unwrap();
    assert_eq!(events, event_count);
    let integrity: String = restored.db.query_row("PRAGMA quick_check", [], |row| row.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    assert_eq!(std::fs::read(dir.path().join("positions.json")).unwrap(), positions);
    // Persisted records must not claim the old process or chat is still running.
    assert_eq!(restored.sessions["active-chat"].view.state, SessionState::Idle);
    assert_eq!(restored.sessions["active-chat"].view.connection, ConnectionState::Unknown);
    assert!(!restored.approval_enabled);
    assert!(!dir.path().join("connection.json").exists());
}
