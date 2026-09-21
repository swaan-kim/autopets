use super::*;
use crate::domain::activity::Session;

fn event(id: &str, session_id: &str, turn_id: &str, kind: EventKind, time: u64) -> EventInput {
    EventInput {
        event_id: id.into(),
        session_id: session_id.into(),
        turn_id: Some(turn_id.into()),
        kind,
        cwd: "C:/work".into(),
        tool_name: None,
        tool_call_id: None,
        timestamp: time,
        activity: None,
        plan: None,
        tool_error: None,
    }
}

fn ready() -> (tempfile::TempDir, Store, u64) {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    let n = now_ms();
    store
        .apply_event_at(event("start", "s1", "t1", EventKind::TurnStarted, n), n)
        .unwrap();
    store.assign_session(0, "s1").unwrap();
    (dir, store, n)
}

fn configuration(id: &str, session_id: &str, turn_id: &str) -> TaskConfiguration {
    TaskConfiguration {
        request_id: id.into(),
        session_id: session_id.into(),
        turn_id: turn_id.into(),
        cwd: "C:/work".into(),
        completion_criterion: "검증 가능한 보고서 파일 완성".into(),
        intervention_mode: InterventionMode::WhenNeeded,
        elapsed_alert_minutes: Some(10),
    }
}

#[test]
fn local_configuration_can_omit_criterion_without_clearing_prior_condition() {
    let (_dir, mut store, _) = ready();
    store
        .configure_session("s1", "", InterventionMode::WhenNeeded, None)
        .unwrap();
    assert!(store.snapshot().sessions[0]
        .supervision
        .completion_criterion
        .is_empty());
    store
        .configure_session("s1", "완료 조건", InterventionMode::WhenNeeded, Some(10))
        .unwrap();
    store
        .configure_session("s1", "  ", InterventionMode::Milestones, Some(5))
        .unwrap();
    assert_eq!(
        store.snapshot().sessions[0]
            .supervision
            .completion_criterion,
        "완료 조건"
    );
    assert_eq!(
        store.snapshot().sessions[0]
            .supervision
            .elapsed_alert_minutes,
        Some(5)
    );
    let mut input = configuration("strict-criterion", "s1", "t1");
    input.completion_criterion.clear();
    assert!(store.configure_task(input).is_err());
}

#[test]
fn legacy_session_json_and_sqlite_migrate_with_realistic_defaults() {
    let session:Session=serde_json::from_value(serde_json::json!({"id":"old","label":"Old","cwd":"C:/work","state":"idle","unread":false,"lastSeen":1,"lastTool":null,"connection":"unknown"})).unwrap();
    assert_eq!(session.supervision.elapsed_alert_minutes, Some(10));
    let dir = tempfile::tempdir().unwrap();
    let db = rusqlite::Connection::open(dir.path().join("autopets.sqlite3")).unwrap();
    db.execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY,label TEXT NOT NULL,cwd TEXT NOT NULL,state TEXT NOT NULL,unread INTEGER NOT NULL,last_seen INTEGER NOT NULL,last_tool TEXT,connection TEXT NOT NULL,active_turn TEXT,last_activity_timestamp INTEGER NOT NULL,turn_finished INTEGER NOT NULL); INSERT INTO sessions VALUES('old','Old','C:/work','\"idle\"',0,1,NULL,'\"unknown\"',NULL,1,0);").unwrap();
    drop(db);
    let store = Store::new(dir.path()).unwrap();
    let view = &store.snapshot().sessions[0].supervision;
    assert_eq!(view.elapsed_alert_minutes, Some(10));
    assert!(view.plan_steps.is_empty());
    assert!(view.turn_started_at.is_none());
    assert_eq!(store.snapshot().capabilities.token_usage, "unavailable");
}

#[test]
fn elapsed_alert_occurs_once_and_survives_restart_without_realerting() {
    let (dir, mut store, n) = ready();
    assert!(!store.tick_supervision(n + 599_999).unwrap());
    assert!(store.tick_supervision(n + 600_000).unwrap());
    let id = store.sessions["s1"]
        .supervision
        .for_snapshot(n + 600_000)
        .attention
        .unwrap()
        .id;
    store.acknowledge_attention("s1", &id).unwrap();
    drop(store);
    let mut restored = Store::new(dir.path()).unwrap();
    restored
        .apply_event_at(
            event(
                "resume-observed",
                "s1",
                "t1",
                EventKind::ToolStarted,
                n + 700_000,
            ),
            n + 700_000,
        )
        .unwrap();
    assert!(!restored.tick_supervision(n + 800_000).unwrap());
    assert!(restored.sessions["s1"]
        .supervision
        .for_snapshot(n + 800_000)
        .attention
        .is_none());
    assert_eq!(
        restored.sessions["s1"].supervision.view.turn_started_at,
        Some(n)
    );
}

#[test]
fn snooze_and_acknowledge_only_change_the_alert_and_preserve_running_task() {
    let (_dir, mut store, n) = ready();
    store.tick_supervision(n + 600_000).unwrap();
    let id = store.sessions["s1"]
        .supervision
        .for_snapshot(n + 600_000)
        .attention
        .unwrap()
        .id;
    store
        .snooze_attention_at("s1", &id, 10, n + 600_000)
        .unwrap();
    assert_eq!(
        store.sessions["s1"]
            .supervision
            .for_snapshot(n + 600_001)
            .attention
            .unwrap()
            .snoozed_until,
        Some(n + 1_200_000)
    );
    assert_eq!(store.sessions["s1"].view.state, SessionState::Working);
    assert!(!store.sessions["s1"].turn_finished);
    assert_eq!(
        store.sessions["s1"]
            .supervision
            .for_snapshot(n + 1_200_000)
            .attention
            .unwrap()
            .id,
        id
    );
    store.acknowledge_attention("s1", &id).unwrap();
    assert!(store.sessions["s1"]
        .supervision
        .for_snapshot(n + 1_200_001)
        .attention
        .is_none());
    assert_eq!(store.sessions["s1"].active_turn.as_deref(), Some("t1"));
    assert!(!store.sessions["s1"].turn_finished);
}

#[test]
fn elapsed_alert_follows_first_observation_and_respects_off_or_finished() {
    let (_dir, mut store, n) = ready();
    store
        .configure_session("s1", "완료 조건", InterventionMode::WhenNeeded, None)
        .unwrap();
    assert!(!store.tick_supervision(n + 3_600_000).unwrap());
    store
        .configure_session("s1", "완료 조건", InterventionMode::WhenNeeded, Some(1))
        .unwrap();
    store
        .apply_event_at(
            event("done", "s1", "t1", EventKind::TurnFinished, n + 1000),
            n + 1000,
        )
        .unwrap();
    assert!(!store.tick_supervision(n + 3_600_000).unwrap());
    assert_eq!(
        store.sessions["s1"].supervision.view.turn_ended_at,
        Some(n + 1000)
    );
    let dir = tempfile::tempdir().unwrap();
    let mut only_tool = Store::new(dir.path()).unwrap();
    only_tool
        .apply_event_at(event("tool", "s2", "t2", EventKind::ToolStarted, n), n)
        .unwrap();
    only_tool.assign_session(0, "s2").unwrap();
    assert!(only_tool.tick_supervision(n + 3_600_000).unwrap());
    assert_eq!(
        only_tool.sessions["s2"].supervision.view.turn_started_at,
        Some(n)
    );
}

#[test]
fn real_plan_changes_drive_milestones_and_old_turns_cannot_replace_current_plan() {
    let (_dir, mut store, n) = ready();
    store
        .configure_session("s1", "보고서", InterventionMode::Milestones, Some(10))
        .unwrap();
    let mut plan = event("plan1", "s1", "t1", EventKind::ToolFinished, n + 1);
    plan.tool_name = Some("update_plan".into());
    plan.plan = Some(PlanPayload {
        steps: vec![
            PlanStep {
                step: "근거 조사".into(),
                status: PlanStatus::InProgress,
            },
            PlanStep {
                step: "작성".into(),
                status: PlanStatus::Pending,
            },
        ],
    });
    store.apply_event_at(plan.clone(), n + 1).unwrap();
    assert!(store.sessions["s1"]
        .supervision
        .for_snapshot(n + 1)
        .attention
        .is_none());
    plan.event_id = "plan2".into();
    plan.timestamp = n + 2;
    plan.plan.as_mut().unwrap().steps[0].status = PlanStatus::Completed;
    store.apply_event_at(plan.clone(), n + 2).unwrap();
    assert_eq!(store.sessions["s1"].supervision.records.len(), 1);
    plan.event_id = "plan3".into();
    plan.timestamp = n + 3;
    store.apply_event_at(plan.clone(), n + 3).unwrap();
    assert_eq!(store.sessions["s1"].supervision.records.len(), 1);
    store
        .apply_event_at(
            event("next", "s1", "t2", EventKind::TurnStarted, n + 4),
            n + 4,
        )
        .unwrap();
    plan.event_id = "stale".into();
    plan.timestamp = n + 5;
    store.apply_event_at(plan, n + 5).unwrap();
    assert!(store.sessions["s1"].supervision.view.plan_steps.is_empty());
    assert!(store.sessions["s1"]
        .supervision
        .for_snapshot(n + 5)
        .attention
        .is_none());
}

#[test]
fn permission_is_observed_without_executing_any_approval_decision() {
    let (_dir, mut store, n) = ready();
    store.tick_supervision(n + 600_000).unwrap();
    let elapsed = store.sessions["s1"]
        .supervision
        .for_snapshot(n + 600_000)
        .attention
        .unwrap()
        .id;
    assert!(!elapsed.is_empty());
    store
        .apply_event_at(
            event(
                "permission",
                "s1",
                "t1",
                EventKind::PermissionRequested,
                n + 600_001,
            ),
            n + 600_001,
        )
        .unwrap();
    assert_eq!(
        store.sessions["s1"]
            .supervision
            .for_snapshot(n + 600_001)
            .attention
            .unwrap()
            .kind,
        AttentionKind::Permission
    );
    assert_eq!(store.sessions["s1"].view.state, SessionState::Waiting);
    assert!(!store.approval_enabled);
    assert!(store.approvals.is_empty());
}

#[test]
fn configuration_is_scoped_idempotent_and_only_uses_empty_slots() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    let n = now_ms();
    for index in 1..=4 {
        store
            .apply_event_at(
                event(
                    &format!("s{index}"),
                    &format!("s{index}"),
                    &format!("t{index}"),
                    EventKind::TurnStarted,
                    n,
                ),
                n,
            )
            .unwrap();
    }
    let first = configuration("request1", "s1", "t1");
    assert_eq!(store.configure_task(first.clone()).unwrap().slot, 0);
    assert_eq!(store.configure_task(first).unwrap().slot, 0);
    assert_eq!(
        store
            .configure_task(configuration("request2", "s2", "t2"))
            .unwrap()
            .slot,
        1
    );
    assert_eq!(
        store
            .configure_task(configuration("request3", "s3", "t3"))
            .unwrap()
            .slot,
        2
    );
    assert_eq!(
        store
            .configure_task(configuration("request4", "s4", "t4"))
            .unwrap_err(),
        "slots-full"
    );
    assert!(store.sessions["s4"]
        .supervision
        .view
        .completion_criterion
        .is_empty());
    let mut changed = configuration("request1", "s1", "t1");
    changed.completion_criterion = "변경된 조건".into();
    assert_eq!(
        store.configure_task(changed).unwrap_err(),
        "request-content-changed"
    );
    let mut wrong = configuration("bad", "s1", "other-turn");
    assert!(store.configure_task(wrong.clone()).is_err());
    wrong.turn_id = "t1".into();
    wrong.cwd = "C:/other".into();
    assert!(store.configure_task(wrong).is_err());
}

#[test]
fn configuration_and_assignment_roll_back_together_on_database_failure() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    let n = now_ms();
    store
        .apply_event_at(event("start", "s1", "t1", EventKind::TurnStarted, n), n)
        .unwrap();
    store.db.execute_batch("CREATE TRIGGER fail_slot BEFORE INSERT ON slots BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(store
        .configure_task(configuration("config", "s1", "t1"))
        .is_err());
    assert!(store.slots.iter().all(Option::is_none));
    assert!(store.sessions["s1"]
        .supervision
        .view
        .completion_criterion
        .is_empty());
    let count: u64 = store
        .db
        .query_row("SELECT count(*) FROM task_config_requests", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn failed_alert_commit_is_retried_once_and_activity_comes_only_from_events() {
    let (_dir, mut store, n) = ready();
    store.db.execute_batch("CREATE TRIGGER fail_save BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(store.tick_supervision(n + 600_000).is_err());
    assert!(store.sessions["s1"]
        .supervision
        .elapsed_alerted_turn
        .is_none());
    store.db.execute_batch("DROP TRIGGER fail_save").unwrap();
    assert!(store.tick_supervision(n + 600_001).unwrap());
    assert!(!store.tick_supervision(n + 700_000).unwrap());
    let mut researching = event("research", "s1", "t1", EventKind::ToolStarted, n + 700_001);
    researching.activity = Some(Activity::Research);
    store.apply_event_at(researching, n + 700_001).unwrap();
    assert_eq!(
        store.sessions["s1"].supervision.view.activity,
        Activity::Research
    );
}

#[test]
fn snapshot_exposes_the_frontend_contract_without_private_alert_history_or_tokens() {
    let (_dir, store, n) = ready();
    let value = serde_json::to_value(store.snapshot()).unwrap();
    assert_eq!(value["sessions"][0]["elapsedAlertMinutes"], 10);
    assert_eq!(value["sessions"][0]["turnStartedAt"], n);
    assert_eq!(value["sessions"][0]["interventionMode"], "when-needed");
    assert!(value["sessions"][0].get("supervision").is_none());
    assert!(value["sessions"][0].get("records").is_none());
    assert!(value["sessions"][0].get("tokensUsed").is_none());
    assert_eq!(value["capabilities"]["tokenUsage"], "unavailable");
    assert_eq!(value["capabilities"]["taskReturn"], "manual");
}

#[test]
fn first_real_plan_or_permission_event_starts_observation_without_prompt_hook() {
    for kind in [EventKind::PlanUpdated, EventKind::PermissionRequested] {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let n = now_ms();
        let mut observed = event("first", "s1", "t1", kind, n);
        if matches!(kind, EventKind::PlanUpdated) {
            observed.tool_name = Some("update_plan".into());
            observed.plan = Some(PlanPayload {
                steps: vec![PlanStep {
                    step: "초안 작성".into(),
                    status: PlanStatus::InProgress,
                }],
            });
        }
        store.apply_event_at(observed, n).unwrap();
        store.assign_session(0, "s1").unwrap();
        assert_eq!(
            store.sessions["s1"].supervision.view.turn_started_at,
            Some(n)
        );
        assert!(store.tick_supervision(n + 600_000).unwrap());
    }
}

#[test]
fn explicit_tool_error_is_attention_not_task_failure_and_next_tool_clears_it() {
    let (_dir, mut store, n) = ready();
    let mut finished = event("not-an-error", "s1", "t1", EventKind::ToolFinished, n + 1);
    finished.tool_name = Some("tool-with-error-in-its-name".into());
    store.apply_event_at(finished.clone(), n + 1).unwrap();
    assert!(store.sessions["s1"]
        .supervision
        .for_snapshot(n + 1)
        .attention
        .is_none());
    finished.event_id = "explicit-error".into();
    finished.timestamp = n + 2;
    finished.tool_error = Some(true);
    store.apply_event_at(finished, n + 2).unwrap();
    assert_eq!(
        store.sessions["s1"]
            .supervision
            .for_snapshot(n + 2)
            .attention
            .unwrap()
            .kind,
        AttentionKind::ToolError
    );
    assert_eq!(store.sessions["s1"].view.state, SessionState::Working);
    assert!(!store.sessions["s1"].turn_finished);
    store
        .apply_event_at(
            event("next-tool", "s1", "t1", EventKind::ToolStarted, n + 3),
            n + 3,
        )
        .unwrap();
    assert!(store.sessions["s1"]
        .supervision
        .for_snapshot(n + 3)
        .attention
        .is_none());
}

#[test]
fn parallel_tool_progress_does_not_dismiss_another_tools_permission() {
    let (_dir, mut store, n) = ready();
    let mut permission = event(
        "permission-a",
        "s1",
        "t1",
        EventKind::PermissionRequested,
        n + 1,
    );
    permission.tool_call_id = Some("tool-a".into());
    store.apply_event_at(permission, n + 1).unwrap();
    let mut progress = event("finished-b", "s1", "t1", EventKind::ToolFinished, n + 2);
    progress.tool_call_id = Some("tool-b".into());
    store.apply_event_at(progress.clone(), n + 2).unwrap();
    assert_eq!(
        store.sessions["s1"]
            .supervision
            .for_snapshot(n + 2)
            .attention
            .unwrap()
            .kind,
        AttentionKind::Permission
    );
    assert_eq!(store.sessions["s1"].view.state, SessionState::Waiting);
    progress.event_id = "finished-a".into();
    progress.tool_call_id = Some("tool-a".into());
    progress.timestamp = n + 3;
    store.apply_event_at(progress, n + 3).unwrap();
    assert!(store.sessions["s1"]
        .supervision
        .for_snapshot(n + 3)
        .attention
        .is_none());
    assert_eq!(store.sessions["s1"].view.state, SessionState::Working);
    store
        .apply_event_at(
            event(
                "permission-unbound",
                "s1",
                "t1",
                EventKind::PermissionRequested,
                n + 4,
            ),
            n + 4,
        )
        .unwrap();
    store
        .apply_event_at(
            event("unbound-finish", "s1", "t1", EventKind::ToolFinished, n + 5),
            n + 5,
        )
        .unwrap();
    assert_eq!(
        store.sessions["s1"]
            .supervision
            .for_snapshot(n + 5)
            .attention
            .unwrap()
            .kind,
        AttentionKind::Permission
    );
}

#[test]
fn missing_next_turn_start_recovers_only_after_terminal_and_never_replays_retired_turns() {
    for kind in [
        EventKind::ToolStarted,
        EventKind::ToolFinished,
        EventKind::PlanUpdated,
        EventKind::PermissionRequested,
    ] {
        let (dir, mut store, n) = ready();
        store
            .apply_event_at(
                event("parallel-other", "s1", "t2", EventKind::ToolStarted, n + 1),
                n + 1,
            )
            .unwrap();
        assert_eq!(store.sessions["s1"].active_turn.as_deref(), Some("t1"));
        // Remember a terminal observation even when its late delivery cannot
        // change the active turn. Its ID must never become a fresh fallback.
        store
            .apply_event_at(
                event("retired-zero", "s1", "t0", EventKind::TurnFinished, n + 2),
                n + 2,
            )
            .unwrap();
        store
            .apply_event_at(
                event("done-one", "s1", "t1", EventKind::TurnFinished, n + 3),
                n + 3,
            )
            .unwrap();
        store
            .apply_event_at(
                event("late-zero", "s1", "t0", EventKind::ToolFinished, n + 4),
                n + 4,
            )
            .unwrap();
        store
            .apply_event_at(
                event("late-one", "s1", "t1", EventKind::ToolFinished, n + 5),
                n + 5,
            )
            .unwrap();
        assert_eq!(store.sessions["s1"].active_turn.as_deref(), Some("t1"));
        assert_eq!(store.sessions["s1"].view.state, SessionState::Done);
        let mut next = event("real-next", "s1", "t2", kind, n + 6);
        if matches!(kind, EventKind::PlanUpdated) {
            next.tool_name = Some("update_plan".into());
            next.plan = Some(PlanPayload {
                steps: vec![PlanStep {
                    step: "다음 작업".into(),
                    status: PlanStatus::InProgress,
                }],
            });
        }
        store.apply_event_at(next, n + 6).unwrap();
        assert_eq!(store.sessions["s1"].active_turn.as_deref(), Some("t2"));
        assert_eq!(
            store.sessions["s1"].supervision.view.turn_started_at,
            Some(n + 6)
        );
        assert!(store.sessions["s1"]
            .supervision
            .view
            .turn_ended_at
            .is_none());
        assert!(!store.sessions["s1"].turn_finished);
        assert!(store.tick_supervision(n + 600_006).unwrap());
        assert_eq!(
            store.sessions["s1"]
                .supervision
                .elapsed_alerted_turn
                .as_deref(),
            Some("t2")
        );
        store
            .apply_event_at(
                event("done-two", "s1", "t2", EventKind::TurnFinished, n + 600_007),
                n + 600_007,
            )
            .unwrap();
        drop(store);
        let mut restored = Store::new(dir.path()).unwrap();
        restored
            .apply_event_at(
                event(
                    "late-zero-after-restart",
                    "s1",
                    "t0",
                    EventKind::ToolStarted,
                    n + 600_008,
                ),
                n + 600_008,
            )
            .unwrap();
        restored
            .apply_event_at(
                event(
                    "late-start-after-restart",
                    "s1",
                    "t0",
                    EventKind::TurnStarted,
                    n + 600_009,
                ),
                n + 600_009,
            )
            .unwrap();
        assert_eq!(restored.sessions["s1"].active_turn.as_deref(), Some("t2"));
        assert!(restored.sessions["s1"].turn_finished);
    }
}
