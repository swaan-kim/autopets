use super::*;
use crate::domain::tool_activity::ToolState;

fn event(id: &str, session: &str, turn: &str, kind: EventKind, call: &str, time: u64) -> EventInput {
    EventInput { event_id: id.into(), session_id: session.into(), turn_id: Some(turn.into()), kind,
        cwd: "C:/한글 시험".into(), tool_name: Some("mcp__fixture__read".into()), tool_call_id: Some(call.into()),
        timestamp: time, activity: Some(Activity::Tool), plan: None, tool_error: None }
}

#[test]
fn parallel_tool_results_use_call_clocks_and_never_change_other_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    store.apply_event_at(event("s-a", "a", "t1", EventKind::TurnStarted, "", 10), 10).unwrap();
    store.apply_event_at(event("s-b", "b", "t1", EventKind::TurnStarted, "", 10), 10).unwrap();
    store.apply_event_at(event("a1", "a", "t1", EventKind::ToolStarted, "call-1", 20), 20).unwrap();
    store.apply_event_at(event("a2", "a", "t1", EventKind::ToolStarted, "call-2", 40), 40).unwrap();
    // Delivered after call-2, but newer than call-1's own start.
    let finish = event("a1-end", "a", "t1", EventKind::ToolFinished, "call-1", 30);
    store.apply_event_at(finish.clone(), 50).unwrap();
    store.apply_event_at(finish, 51).unwrap();
    let tools = store.sessions["a"].supervision.view.tool_activity_v1.as_ref().unwrap();
    assert_eq!(tools.calls.len(), 2);
    assert_eq!(tools.calls[0].state, ToolState::Completed);
    assert_eq!(tools.calls[1].state, ToolState::Running);
    assert!(store.sessions["b"].supervision.view.tool_activity_v1.is_none());
    let mut fail = event("a2-end", "a", "t1", EventKind::ToolFinished, "call-2", 60);
    fail.tool_error = Some(true);
    store.apply_event_at(fail, 60).unwrap();
    store.apply_event_at(event("late-start", "a", "t1", EventKind::ToolStarted, "call-2", 65), 65).unwrap();
    assert_eq!(store.sessions["a"].supervision.view.tool_activity_v1.as_ref().unwrap().calls[1].state, ToolState::Failed);
    // Late events from a different turn cannot create tool activity.
    store.apply_event_at(event("other-turn", "a", "wrong", EventKind::ToolStarted, "wrong-call", 70), 70).unwrap();
    assert_eq!(store.sessions["a"].supervision.view.tool_activity_v1.as_ref().unwrap().calls.len(), 2);
}

#[test]
fn shutdown_reopen_and_turn_end_do_not_fabricate_tool_success() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    store.apply_event_at(event("start", "a", "t", EventKind::ToolStarted, "running", 10), 10).unwrap();
    store.apply_event_at(event("finish", "a", "t", EventKind::ToolFinished, "done", 20), 20).unwrap();
    store.shutdown().unwrap();
    drop(store);
    let mut store = Store::new(dir.path()).unwrap();
    let tools = store.sessions["a"].supervision.view.tool_activity_v1.as_ref().unwrap();
    assert_eq!(tools.calls[0].state, ToolState::Unknown);
    assert_eq!(tools.calls[1].state, ToolState::Completed);
    store.apply_event_at(event("resume", "a", "t", EventKind::SessionStarted, "", 30), 30).unwrap();
    assert_eq!(store.sessions["a"].supervision.view.tool_activity_v1.as_ref().unwrap().calls[0].state, ToolState::Unknown);
    store.apply_event_at(event("fresh", "a", "t", EventKind::ToolStarted, "fresh", 40), 40).unwrap();
    store.apply_event_at(event("end", "a", "t", EventKind::TurnFinished, "", 50), 50).unwrap();
    assert_eq!(store.sessions["a"].supervision.view.tool_activity_v1.as_ref().unwrap().calls[2].state, ToolState::Unknown);
    store.apply_event_at(event("new", "a", "next", EventKind::TurnStarted, "", 60), 60).unwrap();
    assert!(store.sessions["a"].supervision.view.tool_activity_v1.is_none());
}

#[test]
fn failed_persistence_rolls_back_tool_observation() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    store.apply_event_at(event("start", "a", "t", EventKind::TurnStarted, "", 10), 10).unwrap();
    store.db.execute_batch("CREATE TRIGGER tool_write_failure BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test'); END;").unwrap();
    assert!(store.apply_event_at(event("tool", "a", "t", EventKind::ToolStarted, "call", 20), 20).is_err());
    assert!(store.sessions["a"].supervision.view.tool_activity_v1.is_none());
}

#[test]
fn conflicting_results_stay_unknown_and_changed_source_clears_calls() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    store.apply_event_at(event("done", "a", "t", EventKind::ToolFinished, "call", 10), 10).unwrap();
    let mut conflicting = event("failure", "a", "t", EventKind::ToolFinished, "call", 20);
    conflicting.tool_error = Some(true);
    store.apply_event_at(conflicting, 20).unwrap();
    store.apply_event_at(event("repeated", "a", "t", EventKind::ToolFinished, "call", 30), 30).unwrap();
    let call = &store.sessions["a"].supervision.view.tool_activity_v1.as_ref().unwrap().calls[0];
    assert_eq!(call.state, ToolState::Unknown);
    assert!(call.conflicting);
    let mut changed = event("changed-source", "a", "t", EventKind::SessionStarted, "", 40);
    changed.cwd = "C:/another-fixture".into();
    store.apply_event_at(changed, 40).unwrap();
    assert!(store.sessions["a"].supervision.view.tool_activity_v1.is_none());
}

#[test]
fn call_history_is_bounded_and_old_supervision_does_not_invent_calls() {
    let old: SupervisionRecord = serde_json::from_str("{}").unwrap();
    assert!(old.view.tool_activity_v1.is_none());
    let mut tools = None;
    for i in 1..=65 {
        crate::domain::tool_activity::ToolActivity::observe(&mut tools,
            &event(&format!("e-{i}"), "a", "t", EventKind::ToolStarted, &format!("call-{i}"), i), i);
    }
    let activity = tools.as_ref().unwrap();
    assert_eq!(activity.calls.len(), 64);
    assert!(activity.truncated);
    assert!(activity.calls.iter().all(|call| call.state == ToolState::Running));
    crate::domain::tool_activity::ToolActivity::observe(&mut tools,
        &event("end-1", "a", "t", EventKind::ToolFinished, "call-1", 70), 70);
    crate::domain::tool_activity::ToolActivity::observe(&mut tools,
        &event("next", "a", "t", EventKind::ToolStarted, "call-66", 80), 80);
    let activity = tools.as_ref().unwrap();
    assert_eq!(activity.calls.len(), 64);
    assert!(activity.calls.iter().any(|call| call.id == "call-66"));
    assert!(!activity.calls.iter().any(|call| call.id == "call-1"));
}
