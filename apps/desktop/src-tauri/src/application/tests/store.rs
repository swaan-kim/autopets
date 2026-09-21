use super::*;
use sha2::{Digest, Sha256};
fn event(id: &str, turn: &str, kind: EventKind, timestamp: u64) -> EventInput {
    EventInput {
        event_id: id.into(),
        session_id: "s1".into(),
        turn_id: Some(turn.into()),
        kind,
        cwd: "C:/test".into(),
        tool_name: None,
        tool_call_id: None,
        timestamp,
        activity: None,
        plan: None,
        tool_error: None,
    }
}
fn request(id: &str) -> ApprovalInput {
    ApprovalInput {
        request_id: id.into(),
        session_id: "s1".into(),
        turn_id: "t1".into(),
        cwd: "C:/test".into(),
        tool_name: "shell".into(),
        description: "Private reason".into(),
        details: "PRIVATE_COMMAND_SECRET".into(),
    }
}
fn ready() -> (tempfile::TempDir, Store, u64) {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::new(dir.path()).unwrap();
    let now = now_ms();
    s.apply_event_at(event("e1", "t1", EventKind::TurnStarted, now), now)
        .unwrap();
    s.assign_session(0, "s1").unwrap();
    s.set_approval_enabled(true).unwrap();
    (dir, s, now)
}
fn prepare_assistance(s: &mut Store, session_id: &str) -> crate::application::assistance::Identity {
    let identity = crate::application::assistance::Identity {
        provider: crate::application::assistance::Provider::Codex,
        account_id: format!("session:{:x}", Sha256::digest(session_id.as_bytes())),
        chat_id: session_id.into(),
    };
    s.assistance
        .dispatch(crate::application::assistance::Request::Read {
            identity: identity.clone(),
            binding: None,
        })
        .unwrap();
    let preferences_revision = s.assistance.preferences().unwrap().revision;
    s.assistance
        .dispatch(crate::application::assistance::Request::Prepare {
            identity: identity.clone(),
            binding: None,
            expected_revision: 0,
            preferences_revision,
            settings_revision: 0,
            recipe_id: "general".into(),
            requested_model: None,
            reason: "준비".into(),
            injection_bytes: 100,
            guidance_hash: "a".repeat(64),
            context_partial: false,
            included_context_keys: vec![],
            workflow_binding: None,
        })
        .unwrap();
    identity
}
#[test]
fn first_preparation_uses_only_empty_slots_and_never_repeats_or_replaces() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::new(dir.path()).unwrap();
    let n = now_ms();
    let mut preferences = s.assistance.preferences().unwrap();
    preferences.enabled = true;
    s.assistance.save_preferences(preferences).unwrap();
    for index in 1..=4 {
        let mut e = event(
            &format!("assistance-{index}"),
            "t1",
            EventKind::TurnStarted,
            n,
        );
        e.session_id = format!("s{index}");
        s.apply_event_at(e, n).unwrap();
    }
    s.configure_session(
        "s1",
        "사용자 완료 기준",
        InterventionMode::Milestones,
        Some(5),
    )
    .unwrap();
    s.assign_session(2, "s1").unwrap();
    let first = prepare_assistance(&mut s, "s1");
    assert!(!s.assign_first_assistance_pet(&first).unwrap());
    assert_eq!(s.slots[2].as_deref(), Some("s1"));
    let second = prepare_assistance(&mut s, "s2");
    assert!(s.assign_first_assistance_pet(&second).unwrap());
    assert!(!s.assign_first_assistance_pet(&second).unwrap());
    let third = prepare_assistance(&mut s, "s3");
    assert!(s.assign_first_assistance_pet(&third).unwrap());
    let fourth = prepare_assistance(&mut s, "s4");
    assert!(!s.assign_first_assistance_pet(&fourth).unwrap());
    assert_eq!(s.assistance.overview().unwrap().tasks.len(), 4);
    assert_eq!(
        s.slots,
        [Some("s2".into()), Some("s3".into()), Some("s1".into())]
    );
    let supervision = &s.sessions["s1"].supervision.view;
    assert_eq!(supervision.completion_criterion, "사용자 완료 기준");
    assert_eq!(supervision.elapsed_alert_minutes, Some(5));
    assert!(matches!(
        supervision.intervention_mode,
        InterventionMode::Milestones
    ));
    s.unassign_session(0).unwrap();
    assert!(!s.assign_first_assistance_pet(&second).unwrap());
    assert!(!s.assign_first_assistance_pet(&fourth).unwrap());
    assert!(s.slots[0].is_none());
}
#[test]
fn manual_removal_before_preparation_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let n = now_ms();
    {
        let mut s = Store::new(dir.path()).unwrap();
        s.apply_event_at(event("first", "t1", EventKind::TurnStarted, n), n)
            .unwrap();
        s.assign_session(0, "s1").unwrap();
        s.unassign_session(0).unwrap();
    }
    let mut s = Store::new(dir.path()).unwrap();
    s.apply_event_at(event("second", "t2", EventKind::TurnStarted, n + 1), n + 1)
        .unwrap();
    let mut preferences = s.assistance.preferences().unwrap();
    preferences.enabled = true;
    s.assistance.save_preferences(preferences).unwrap();
    let identity = prepare_assistance(&mut s, "s1");
    assert!(!s.assign_first_assistance_pet(&identity).unwrap());
    assert!(s.slots.iter().all(Option::is_none));
}
#[test]
fn failed_first_assignment_rolls_back_attempt_marker_with_slot() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::new(dir.path()).unwrap();
    let n = now_ms();
    s.apply_event_at(event("first", "t1", EventKind::TurnStarted, n), n)
        .unwrap();
    let mut preferences = s.assistance.preferences().unwrap();
    preferences.enabled = true;
    s.assistance.save_preferences(preferences).unwrap();
    let identity = prepare_assistance(&mut s, "s1");
    s.db.execute_batch("CREATE TRIGGER failed_pet_assignment BEFORE INSERT ON slots BEGIN SELECT RAISE(ABORT,'injected assignment failure'); END;").unwrap();
    assert!(s.assign_first_assistance_pet(&identity).is_err());
    assert!(s.slots.iter().all(Option::is_none));
    let count: u64 =
        s.db.query_row(
            "SELECT count(*) FROM assistance_pet_assignments WHERE session_id='s1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    s.db.execute_batch("DROP TRIGGER failed_pet_assignment")
        .unwrap();
    assert!(s.assign_first_assistance_pet(&identity).unwrap());
}
#[test]
fn observation_default_and_unassigned_passthrough() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::new(d.path()).unwrap();
    assert!(!s.snapshot().approval_enabled);
    assert_eq!(
        s.register_approval(request("a1")).unwrap().mode,
        "passthrough"
    );
    s.set_approval_enabled(true).unwrap();
    assert_eq!(
        s.register_approval(request("a2")).unwrap().mode,
        "passthrough"
    );
    assert!(s.snapshot().approvals.is_empty());
}
#[test]
fn duplicate_events_and_old_turns_do_not_overwrite_current_state() {
    let (_d, mut s, now) = ready();
    s.apply_event_at(
        event("e2", "t2", EventKind::TurnStarted, now + 10),
        now + 10,
    )
    .unwrap();
    s.apply_event_at(
        event("e3", "t1", EventKind::TurnFinished, now + 20),
        now + 20,
    )
    .unwrap();
    assert_eq!(s.sessions["s1"].view.state, SessionState::Working);
    s.apply_event_at(
        event("e4", "t2", EventKind::TurnFinished, now + 30),
        now + 30,
    )
    .unwrap();
    s.acknowledge("s1").unwrap();
    s.apply_event_at(
        event("e4", "t2", EventKind::TurnFinished, now + 30),
        now + 40,
    )
    .unwrap();
    assert!(!s.sessions["s1"].view.unread);
}
#[test]
fn unread_completion_survives_next_turn_and_resume() {
    let (_d, mut s, n) = ready();
    s.apply_event_at(event("e2", "t1", EventKind::TurnFinished, n + 1), n + 1)
        .unwrap();
    s.apply_event_at(event("e3", "t2", EventKind::TurnStarted, n + 2), n + 2)
        .unwrap();
    s.apply_event_at(event("e4", "t2", EventKind::SessionStarted, n + 3), n + 3)
        .unwrap();
    assert_eq!(s.sessions["s1"].view.state, SessionState::Working);
    assert!(s.sessions["s1"].view.unread);
}
#[test]
fn approvals_are_bound_first_decision_wins_and_details_are_erased() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    assert!(s
        .resolve_approval_at("a1", "other", "t1", Decision::Allow, n + 1)
        .is_err());
    s.resolve_approval_at("a1", "s1", "t1", Decision::Deny, n + 1)
        .unwrap();
    s.resolve_approval_at("a1", "s1", "t1", Decision::Deny, n + 2)
        .unwrap();
    assert!(s
        .resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 2)
        .is_err());
    assert_eq!(
        s.wait_status_at("a1", "s1", "t1", n + 2).unwrap().status,
        ApprovalStatus::Denied
    );
    assert!(s.approvals["a1"].view.details.is_empty());
    s.mark_returned("a1", "s1", "t1").unwrap();
    assert_eq!(
        s.wait_status_at("a1", "s1", "t1", n + 3).unwrap().status,
        ApprovalStatus::Cancelled
    );
}
#[test]
fn concurrent_allow_deny_has_one_winner() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    let shared = Arc::new(Mutex::new(s));
    let handles: Vec<_> = [Decision::Allow, Decision::Deny]
        .into_iter()
        .map(|d| {
            let shared = shared.clone();
            std::thread::spawn(move || {
                shared
                    .lock()
                    .unwrap()
                    .resolve_approval_at("a1", "s1", "t1", d, n + 1)
                    .is_ok()
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| usize::from(h.join().unwrap()))
            .sum::<usize>(),
        1
    );
}
#[test]
fn lease_and_thirty_minute_deadline_cannot_be_extended_by_polling() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("lost"), n).unwrap();
    s.tick_at(n + ADAPTER_LEASE_MS).unwrap();
    assert_eq!(s.approvals["lost"].view.status, ApprovalStatus::Forwarded);
    s.register_approval_at(request("live"), n + ADAPTER_LEASE_MS + 1)
        .unwrap();
    let start = n + ADAPTER_LEASE_MS + 1;
    for delta in (15000..APPROVAL_TTL_MS).step_by(15000) {
        assert_eq!(
            s.wait_status_at("live", "s1", "t1", start + delta)
                .unwrap()
                .status,
            ApprovalStatus::Pending
        );
    }
    assert_eq!(
        s.wait_status_at("live", "s1", "t1", start + APPROVAL_TTL_MS)
            .unwrap()
            .status,
        ApprovalStatus::Forwarded
    );
    assert!(s
        .resolve_approval_at("live", "s1", "t1", Decision::Allow, start + APPROVAL_TTL_MS)
        .is_err());
}
#[test]
fn pending_requests_lock_assignment_and_new_turn_cancels_old_request() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    assert!(s.unassign_session(0).is_err());
    assert!(s.assign_session(1, "s1").is_err());
    s.apply_event_at(event("e2", "t2", EventKind::TurnStarted, n + 1), n + 1)
        .unwrap();
    assert_eq!(s.approvals["a1"].view.status, ApprovalStatus::Cancelled);
    s.unassign_session(0).unwrap();
}
#[test]
fn restart_preserves_assignment_but_never_replays_decisions_or_secrets() {
    let (d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    s.resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 1)
        .unwrap();
    drop(s);
    let mut restored = Store::new(d.path()).unwrap();
    assert!(!restored.snapshot().approval_enabled);
    assert_eq!(restored.slots[0].as_deref(), Some("s1"));
    assert!(restored.wait_status("a1", "s1", "t1").is_err());
    assert_eq!(
        restored.approvals["a1"].view.status,
        ApprovalStatus::Approved
    );
    assert_eq!(
        restored.approvals["a1"].view.delivery,
        Delivery::Invalidated
    );
    let rows: String = restored
        .db
        .query_row("SELECT group_concat(sql) FROM sqlite_master", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(!rows.contains("details"));
    assert!(!rows.contains("description"));
    for file in std::fs::read_dir(d.path()).unwrap().flatten() {
        let bytes = std::fs::read(file.path()).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_COMMAND_SECRET"));
    }
}

#[test]
fn undelivered_decisions_are_revoked_when_turn_changes_or_lease_dies() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    s.resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 1)
        .unwrap();
    s.apply_event_at(event("e2", "t2", EventKind::TurnStarted, n + 2), n + 2)
        .unwrap();
    assert!(s.wait_status_at("a1", "s1", "t1", n + 3).is_err());
    assert_eq!(s.approvals["a1"].view.delivery, Delivery::Invalidated);
    let (_d2, mut s2, n2) = ready();
    s2.register_approval_at(request("a2"), n2).unwrap();
    s2.resolve_approval_at("a2", "s1", "t1", Decision::Allow, n2 + 1)
        .unwrap();
    assert!(s2
        .wait_status_at("a2", "s1", "t1", n2 + ADAPTER_LEASE_MS)
        .is_err());
    assert_eq!(s2.approvals["a2"].view.delivery, Delivery::Invalidated);
}

#[test]
fn completed_turn_cannot_be_revived_by_late_start_even_without_original_start() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::new(d.path()).unwrap();
    let n = now_ms();
    s.apply_event_at(event("finished", "t1", EventKind::TurnFinished, n), n)
        .unwrap();
    s.apply_event_at(
        event("late-start", "t1", EventKind::TurnStarted, n + 1),
        n + 1,
    )
    .unwrap();
    assert_eq!(s.sessions["s1"].view.state, SessionState::Done);
    assert!(s.sessions["s1"].turn_finished);
}

#[test]
fn duplicate_registration_must_have_identical_content() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    assert_eq!(
        s.register_approval_at(request("a1"), n + 1).unwrap().mode,
        "pending"
    );
    s.resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 2)
        .unwrap();
    let mut changed = request("a1");
    changed.details = "Different command".into();
    assert!(s.register_approval_at(changed, n + 3).is_err());
    let mut changed = request("a1");
    changed.cwd = "C:/other".into();
    assert!(s.register_approval_at(changed, n + 3).is_err());
    assert_eq!(
        s.register_approval_at(request("a1"), n + 3).unwrap().mode,
        "pending"
    );
    s.set_approval_enabled(false).unwrap();
    assert_eq!(s.approvals["a1"].view.delivery, Delivery::Invalidated);
}

#[test]
fn tool_call_identity_is_saved_without_tool_content() {
    let (_d, mut s, n) = ready();
    let mut e = event("tool", "t1", EventKind::ToolStarted, n + 1);
    e.tool_call_id = Some("call-123".into());
    s.apply_event_at(e, n + 1).unwrap();
    let actual: String =
        s.db.query_row(
            "SELECT tool_call_id FROM events WHERE event_id='tool'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(actual, "call-123");
}

#[test]
fn failed_event_commit_rolls_back_event_id_state_and_nested_approval_changes() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    s.db.execute_batch("CREATE TRIGGER injected_failure BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
    assert!(s
        .apply_event_at(
            event("new-turn", "t2", EventKind::TurnStarted, n + 1),
            n + 1
        )
        .is_err());
    assert_eq!(s.sessions["s1"].active_turn.as_deref(), Some("t1"));
    assert_eq!(s.sessions["s1"].view.state, SessionState::Waiting);
    assert_eq!(s.approvals["a1"].view.status, ApprovalStatus::Pending);
    let seen: u64 =
        s.db.query_row(
            "SELECT count(*) FROM events WHERE event_id='new-turn'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(seen, 0);
    s.db.execute_batch("DROP TRIGGER injected_failure").unwrap();
    s.apply_event_at(
        event("new-turn", "t2", EventKind::TurnStarted, n + 1),
        n + 1,
    )
    .unwrap();
    assert_eq!(s.approvals["a1"].view.status, ApprovalStatus::Cancelled);
    assert_eq!(s.sessions["s1"].active_turn.as_deref(), Some("t2"));
}

#[test]
fn failed_decision_commit_never_becomes_deliverable() {
    let (_d, mut s, n) = ready();
    s.register_approval_at(request("a1"), n).unwrap();
    s.db.execute_batch("CREATE TRIGGER injected_failure BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
    assert!(s
        .resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 1)
        .is_err());
    assert_eq!(
        s.wait_status_at("a1", "s1", "t1", n + 2).unwrap().status,
        ApprovalStatus::Pending
    );
    assert_eq!(s.approvals["a1"].view.details, "PRIVATE_COMMAND_SECRET");
    let persisted: String =
        s.db.query_row(
            "SELECT status FROM approvals WHERE request_id='a1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        decode::<ApprovalStatus>(&persisted).unwrap(),
        ApprovalStatus::Pending
    );
    s.db.execute_batch("DROP TRIGGER injected_failure").unwrap();
    s.resolve_approval_at("a1", "s1", "t1", Decision::Deny, n + 3)
        .unwrap();
    assert_eq!(
        s.wait_status_at("a1", "s1", "t1", n + 4).unwrap().status,
        ApprovalStatus::Denied
    );
}

#[test]
fn failed_registration_does_not_leave_a_ghost_approval() {
    let (_d, mut s, n) = ready();
    s.db.execute_batch("CREATE TRIGGER injected_failure BEFORE INSERT ON sessions WHEN NEW.state = '\"waiting\"' BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
    assert!(s.register_approval_at(request("a1"), n).is_err());
    assert!(!s.approvals.contains_key("a1"));
    let rows: u64 =
        s.db.query_row(
            "SELECT count(*) FROM approvals WHERE request_id='a1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rows, 0);
    assert_eq!(s.sessions["s1"].view.state, SessionState::Working);
}
