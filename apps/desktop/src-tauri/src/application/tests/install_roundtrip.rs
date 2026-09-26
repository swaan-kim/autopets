//! Explicit CI fixture; never opens a desktop window or an AI connection.
use super::*;
use crate::domain::assistance::{AnswerLength, Context, Identity, Provider, Request};

#[test]
#[ignore = "writes synthetic data only on a disposable Windows CI runner"]
fn installer_fixture() {
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    assert_eq!(std::env::var("RUNNER_ENVIRONMENT").as_deref(), Ok("github-hosted"));
    assert_eq!(std::env::var("GITHUB_REPOSITORY").as_deref(), Ok("swaan-kim/autopets"));
    let phase = std::env::var("AUTOPETS_INSTALL_FIXTURE_PHASE").unwrap();
    assert!(matches!(phase.as_str(), "seed" | "verify-removed" | "verify-reinstalled"));
    let data = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()).join("local.autopets.desktop");
    let identity = Identity { provider: Provider::Codex, account_id: "roundtrip-fixture".into(), chat_id: "saved-chat".into() };
    let context = Context { goal: "제거와 재설치 후 보존할 테스트 기록".into(), constraints: vec!["실제 채팅 아님".into()], ..Default::default() };
    let positions = br#"{"pet-0":{"x":120,"y":240},"pet-2":{"x":-200,"y":80}}"#;
    if phase == "seed" {
        assert!(!data.exists(), "never overwrite preexisting app data");
        let mut store = Store::new(&data).unwrap();
        let now = now_ms();
        for (id, kind, timestamp) in [("start", "turn_started", now), ("finish", "turn_finished", now + 1)] {
            store.apply_event(serde_json::from_value(serde_json::json!({
                "eventId": id, "sessionId": "saved-chat", "turnId": "turn-1",
                "kind": kind, "cwd": data.to_string_lossy(), "timestamp": timestamp
            })).unwrap()).unwrap();
        }
        store.rename_session("saved-chat", "재설치 보존 검사").unwrap();
        store.configure_session("saved-chat", "설치 전후 기록 일치", InterventionMode::Milestones, Some(7)).unwrap();
        store.assign_session(1, "saved-chat").unwrap();
        let mut preferences = store.assistance.preferences().unwrap();
        preferences.answer_length = AnswerLength::Detailed;
        store.assistance.save_preferences(preferences).unwrap();
        store.assistance.dispatch(Request::Read { identity: identity.clone(), binding: None }).unwrap();
        store.assistance.save_context(identity.clone(), context.clone(), 0).unwrap();
        let mut preferences = store.workflow.preferences().unwrap();
        preferences.plan_first = false;
        store.workflow.save_preferences(preferences).unwrap();
        let mut template = crate::domain::roles::templates().unwrap().remove(0);
        template.name = "재설치 보존 역할".into();
        template.prop = crate::domain::roles::Prop::Notebook;
        template.background = crate::domain::roles::Background::Meadow;
        store.save_pet(None, 0, template).unwrap();
        store.import_task_graph(crate::domain::task_graph::Import { expected_revision: 0, report: crate::domain::task_graph::fixture() }).unwrap();
        std::fs::write(data.join("positions.json"), positions).unwrap();
        store.shutdown().unwrap();
    }
    assert!(data.join("autopets.sqlite3").is_file());
    let store = Store::new(&data).unwrap();
    assert_eq!(store.sessions.len(), 1);
    let saved = &store.sessions["saved-chat"];
    assert_eq!(saved.view.label, "재설치 보존 검사");
    assert_eq!(saved.view.state, SessionState::Done);
    assert!(saved.view.unread);
    assert_eq!(saved.supervision.view.completion_criterion, "설치 전후 기록 일치");
    assert_eq!(saved.supervision.view.elapsed_alert_minutes, Some(7));
    assert_eq!(saved.supervision.view.intervention_mode, InterventionMode::Milestones);
    assert_eq!(store.slots, [None, Some("saved-chat".into()), None]);
    let preferences = store.assistance.preferences().unwrap();
    assert_eq!(preferences.answer_length, AnswerLength::Detailed);
    assert_eq!(preferences.revision, 1);
    assert!(!preferences.enabled);
    let workflow = store.workflow.preferences().unwrap();
    assert!(!workflow.plan_first);
    assert_eq!(workflow.revision, 1);
    assert!(!workflow.enabled);
    let pets = store.roles_snapshot().unwrap().pets;
    assert_eq!(pets.len(), 1);
    assert_eq!(pets[0].template.name, "재설치 보존 역할");
    assert_eq!(pets[0].template.prop, crate::domain::roles::Prop::Notebook);
    assert_eq!(pets[0].template.background, crate::domain::roles::Background::Meadow);
    let graphs = store.task_graph_snapshot().unwrap();
    assert_eq!(graphs.len(), 1);
    assert_eq!(graphs[0].revision, 1);
    assert_eq!(graphs[0].report.nodes.len(), 3);
    assert_eq!(graphs[0].report.nodes[2].parent_id.as_deref(), Some(graphs[0].report.nodes[0].id.as_str()));
    let tasks = store.assistance.overview().unwrap().tasks;
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].identity, identity);
    assert_eq!(tasks[0].context, context);
    assert_eq!(tasks[0].revision, 1);
    let events: u64 = store.db.query_row("SELECT count(*) FROM events", [], |row| row.get(0)).unwrap();
    assert_eq!(events, 2);
    let integrity: String = store.db.query_row("PRAGMA quick_check", [], |row| row.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    assert_eq!(std::fs::read(data.join("positions.json")).unwrap(), positions);
    assert!(!data.join("connection.json").exists());
    let evidence = PathBuf::from(std::env::var_os("AUTOPETS_INSTALL_FIXTURE_EVIDENCE").unwrap());
    let runner_temp = std::fs::canonicalize(std::env::var_os("RUNNER_TEMP").unwrap()).unwrap();
    assert!(std::fs::canonicalize(evidence.parent().unwrap()).unwrap().starts_with(runner_temp));
    std::fs::write(evidence, serde_json::to_vec_pretty(&serde_json::json!({
        "phase": phase, "sessions": 1, "events": events, "settingsPreserved": true,
        "contextPreserved": true, "petAssignmentPreserved": true, "positionsFilePreserved": true,
        "integrity": integrity, "desktopAppLaunched": false, "roleTemplatePreserved": true, "taskGraphPreserved": true
    })).unwrap()).unwrap();
}
