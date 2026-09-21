use super::*;
use crate::domain::assistance::{Context, Provider};
use sha2::{Digest, Sha256};

fn identity(chat: &str) -> Identity {
    Identity {
        provider: Provider::Codex,
        account_id: format!("session:{:x}", Sha256::digest(chat.as_bytes())),
        chat_id: chat.into(),
    }
}
fn binding(chat: &str, turn: &str) -> Binding {
    Binding {
        session_id: chat.into(),
        cwd: "C:/workflow".into(),
        turn_id: Some(turn.into()),
    }
}
fn enabled_store() -> (tempfile::TempDir, WorkflowStore) {
    let dir = tempfile::tempdir().unwrap();
    let mut store = WorkflowStore::new(dir.path()).unwrap();
    let preferences = Preferences {
        enabled: true,
        ..Preferences::default()
    };
    store.save_preferences(preferences).unwrap();
    (dir, store)
}
fn read(store: &mut WorkflowStore, chat: &str) -> Task {
    store
        .ensure(&identity(chat), &binding(chat, "read"))
        .unwrap()
        .task
}
fn verified() -> Capabilities {
    Capabilities {
        model_observation: true,
        reasoning_observation: true,
        mode_observation: true,
        submission_hold: true,
        input_preservation: true,
        single_submission: true,
        request_identity: true,
        verification: "verified",
        available_models: vec![
            AvailableModel {
                model: "gpt-5.6-sol".into(),
                reasoning: vec!["medium".into()],
            },
            AvailableModel {
                model: "gpt-5.6-terra".into(),
                reasoning: vec!["medium".into()],
            },
            AvailableModel {
                model: "gpt-5.6-luna".into(),
                reasoning: vec!["low".into()],
            },
            AvailableModel {
                model: "gpt-6-astra".into(),
                reasoning: vec!["high".into(), "medium".into()],
            },
        ],
        ..capabilities()
    }
}
fn request(task: &Task, submission: &str, intent: Intent, model: &str) -> Request {
    Request::Preflight {
        identity: task.identity.clone(),
        binding: binding(&task.identity.chat_id, submission),
        expected_settings_revision: task.settings_revision,
        expected_plan_revision: task.plan_revision,
        submission_id: submission.into(),
        request_fingerprint: "a".repeat(64),
        intent,
        observation: Some(Observation {
            model: Some(model.into()),
            reasoning: Some("medium".into()),
            mode: None,
            source: "verified-adapter".into(),
            observed_at: now_ms(),
            submission_id: submission.into(),
        }),
        explicit_model: None,
        plan_changed: false,
    }
}
fn flight(store: &mut WorkflowStore, request: Request, cap: Capabilities) -> PreflightResult {
    serde_json::from_value(
        store
            .dispatch_with_capabilities(request, None, cap)
            .unwrap(),
    )
    .unwrap()
}
fn plan(store: &mut WorkflowStore, task: &Task) -> Task {
    let result = store
        .dispatch(
            Request::RecordPlan {
                identity: task.identity.clone(),
                binding: binding(&task.identity.chat_id, "plan"),
                expected_settings_revision: task.settings_revision,
                expected_plan_revision: task.plan_revision,
                plan: Plan {
                    summary: "세 제품의 비교표를 작성해요".into(),
                    steps: vec!["조사".into(), "작성".into()],
                    completion_criteria: vec!["출처 포함".into()],
                },
            },
            None,
        )
        .unwrap();
    serde_json::from_value(result["task"].clone()).unwrap()
}

#[test]
fn workflow_storage_is_additive_defaults_only_affect_new_chats_and_old_json_is_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let old = crate::application::assistance::AssistanceStore::new(dir.path()).unwrap();
    let raw = serde_json::to_string(&old.preferences().unwrap()).unwrap();
    old.db
        .execute(
            "INSERT INTO assistance_preferences(singleton,value) VALUES(1,?1)",
            [&raw],
        )
        .unwrap();
    drop(old);
    let mut store = WorkflowStore::new(dir.path()).unwrap();
    let first = read(&mut store, "a");
    assert!(!first.enabled);
    assert_eq!(first.phase, Phase::Unknown);
    assert!(first.plan.is_none());
    let (planning, execution) = profiles(Preset::Complex);
    store
        .save_preferences(Preferences {
            enabled: true,
            preset: Preset::Complex,
            planning,
            execution,
            ..Preferences::default()
        })
        .unwrap();
    let second = read(&mut store, "b");
    assert!(second.enabled);
    assert_eq!(second.preset, Preset::Complex);
    assert!(!read(&mut store, "a").enabled);
    assert_eq!(read(&mut store, "a").preset, Preset::Balanced);
    let persisted: String = store
        .db
        .query_row(
            "SELECT value FROM assistance_preferences WHERE singleton=1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(persisted, raw);
    let mut off = store.preferences().unwrap();
    off.enabled = false;
    store.save_preferences(off).unwrap();
    assert!(read(&mut store, "b").enabled);
    assert!(!read(&mut store, "c").enabled);
    assert!(store.save_preferences(Preferences::default()).is_err());
}

#[test]
fn unverified_stale_missing_model_and_unknown_targets_never_hold_or_fabricate_observation() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let result = flight(
        &mut store,
        request(&task, "one", Intent::NewWork, "gpt-6-astra"),
        capabilities(),
    );
    assert_eq!(result.decision, "passthrough");
    assert!(result.task.observation.is_none());
    let mut stale = request(&result.task, "two", Intent::Continue, "gpt-6-astra");
    if let Request::Preflight {
        observation: Some(value),
        ..
    } = &mut stale
    {
        value.observed_at = 1;
    }
    assert_eq!(
        flight(&mut store, stale, verified()).decision,
        "passthrough"
    );
    let mut no_model = request(&result.task, "three", Intent::Continue, "gpt-6-astra");
    if let Request::Preflight {
        observation: Some(value),
        ..
    } = &mut no_model
    {
        value.model = None;
    }
    assert_eq!(
        flight(&mut store, no_model, verified()).decision,
        "passthrough"
    );
    let mut cap = verified();
    cap.available_models.clear();
    assert_eq!(
        flight(
            &mut store,
            request(&result.task, "four", Intent::Continue, "gpt-6-astra"),
            cap
        )
        .decision,
        "passthrough"
    );
}

#[test]
fn user_can_confirm_unobserved_plan_but_unknown_phase_cannot_be_approved() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    assert!(store.approve(identity("a"), 0, 0).is_err());
    let task = flight(
        &mut store,
        request(&task, "one", Intent::NewWork, "gpt-5.6-sol"),
        verified(),
    )
    .task;
    let approved = store
        .approve(identity("a"), task.plan_revision, task.settings_revision)
        .unwrap();
    assert!(approved.approved());
    assert!(approved.plan.is_none());
    assert_eq!(approved.phase, Phase::Ready);
    let mut cap = verified();
    cap.reasoning_observation = false;
    let result = flight(
        &mut store,
        request(&approved, "two", Intent::Execute, "gpt-5.6-terra"),
        cap,
    );
    assert_eq!(result.decision, "allow");
    assert_eq!(result.task.guard.status, GuardStatus::Unavailable);
    assert_eq!(result.task.phase, Phase::Executing);
}

#[test]
fn plan_record_is_bounded_deduplicated_and_new_conditions_revoke_approval() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let planned = plan(&mut store, &task);
    assert_eq!(planned.plan_revision, 1);
    let same = plan(&mut store, &planned);
    assert_eq!(same.plan_revision, 1);
    let approved = store.approve(identity("a"), 1, 0).unwrap();
    assert!(approved.approved());
    store.invalidate_plan(&identity("a")).unwrap();
    let current = read(&mut store, "a");
    assert!(!current.approved());
    assert!(current.plan.is_none());
    assert_eq!(current.phase, Phase::Planning);
    assert_eq!(current.plan_revision, 2);
    assert!(store.approve(identity("a"), 1, 0).is_err());
    assert!(Plan {
        summary: "x".repeat(1025),
        steps: vec![],
        completion_criteria: vec![]
    }
    .validate()
    .is_err());
    let original = Context::default();
    let mut progress = original.clone();
    progress.remaining = vec!["확인".into()];
    assert!(!context_affects_plan(&original, &progress));
    progress.constraints = vec!["한국어".into()];
    assert!(context_affects_plan(&original, &progress));
}

#[test]
fn simple_edit_then_new_work_and_changed_settings_return_to_planning() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let edited = flight(
        &mut store,
        request(&task, "edit", Intent::SimpleEdit, "gpt-5.6-terra"),
        verified(),
    );
    assert_eq!(edited.task.phase, Phase::Executing);
    let planned = flight(
        &mut store,
        request(&edited.task, "new", Intent::NewWork, "gpt-5.6-sol"),
        verified(),
    );
    assert_eq!(planned.task.phase, Phase::Planning);
    let approved = store.approve(identity("a"), 0, 0).unwrap();
    let executed = flight(
        &mut store,
        request(&approved, "execute", Intent::Execute, "gpt-5.6-terra"),
        verified(),
    );
    assert_eq!(executed.task.phase, Phase::Executing);
    let (planning, execution) = profiles(Preset::Complex);
    let configured = store
        .configure(
            identity("a"),
            Configuration {
                enabled: true,
                preset: Preset::Complex,
                plan_first: true,
                planning,
                execution,
            },
            0,
        )
        .unwrap();
    assert_eq!(configured.phase, Phase::Planning);
    assert!(!configured.approved());
    let result = flight(
        &mut store,
        request(&configured, "next", Intent::NewWork, "gpt-6-astra"),
        verified(),
    );
    assert_eq!(result.target.unwrap().reasoning, "high");
}

#[test]
fn pending_plan_targets_planning_profile_and_only_real_setting_mismatch_is_held() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let ready = plan(&mut store, &task);
    let matching = flight(
        &mut store,
        request(&ready, "one", Intent::NewWork, "gpt-5.6-sol"),
        verified(),
    );
    assert_eq!(matching.decision, "allow");
    assert_eq!(matching.task.phase, Phase::Ready);
    assert_eq!(matching.target.unwrap().model, "gpt-5.6-sol");
    let mismatch = flight(
        &mut store,
        request(&ready, "two", Intent::Continue, "gpt-6-astra"),
        verified(),
    );
    assert_eq!(mismatch.decision, "hold");
}

#[test]
fn once_is_bound_to_complete_request_next_submission_revisions_and_is_idempotent() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let held = flight(
        &mut store,
        request(&task, "held", Intent::NewWork, "gpt-6-astra"),
        verified(),
    );
    assert_eq!(held.decision, "hold");
    let granted = store
        .allow_once(identity("a"), "held".into(), 0, 0)
        .unwrap();
    assert!(granted.once_available);
    let retry = request(&granted, "retry", Intent::NewWork, "gpt-6-astra");
    let allowed = flight(&mut store, retry.clone(), verified());
    assert_eq!(allowed.decision, "allow");
    assert_eq!(allowed.task.guard.status, GuardStatus::Exception);
    assert!(!allowed.task.once_available);
    let duplicate = flight(&mut store, retry, verified());
    assert!(duplicate.duplicate);
    assert_eq!(duplicate.decision, "allow");
    assert_eq!(
        flight(
            &mut store,
            request(&allowed.task, "again", Intent::NewWork, "gpt-6-astra"),
            verified()
        )
        .decision,
        "hold"
    );
    assert!(store
        .allow_once(identity("b"), "held".into(), 0, 0)
        .is_err());
}

#[test]
fn hook_fingerprint_alone_cannot_authorize_once_and_edited_input_revokes_grant() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let mut hook = request(&task, "hook", Intent::NewWork, "gpt-6-astra");
    if let Request::Preflight {
        observation: Some(value),
        ..
    } = &mut hook
    {
        value.source = "hook".into();
    }
    let held = flight(&mut store, hook, verified());
    assert_eq!(held.decision, "hold");
    assert!(store
        .allow_once(identity("a"), "hook".into(), 0, 0)
        .is_err());
    let mut cap = verified();
    cap.request_identity = false;
    let held = flight(
        &mut store,
        request(&held.task, "no-id", Intent::Continue, "gpt-6-astra"),
        cap,
    );
    assert!(store
        .allow_once(identity("a"), "no-id".into(), 0, 0)
        .is_err());
    let held = flight(
        &mut store,
        request(&held.task, "verified", Intent::Continue, "gpt-6-astra"),
        verified(),
    );
    store
        .allow_once(identity("a"), "verified".into(), 0, 0)
        .unwrap();
    let mut changed = request(&held.task, "changed", Intent::Continue, "gpt-6-astra");
    if let Request::Preflight {
        request_fingerprint,
        ..
    } = &mut changed
    {
        *request_fingerprint = "b".repeat(64);
    }
    let result = flight(&mut store, changed, verified());
    assert_eq!(result.decision, "hold");
    assert!(!result.task.once_available);
}

#[test]
fn concurrent_hooks_replay_same_submission_before_stale_input_revision_check() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let mut first = request(&task, "shared", Intent::NewWork, "gpt-6-astra");
    if let Request::Preflight { plan_changed, .. } = &mut first {
        *plan_changed = true;
    }
    let second = first.clone();
    let result = flight(&mut store, first, verified());
    assert_eq!(result.task.plan_revision, 1);
    let replay = flight(&mut store, second, verified());
    assert!(replay.duplicate);
    assert_eq!(replay.decision, "hold");
    assert_eq!(replay.task.plan_revision, 1);
    store.invalidate_plan(&identity("a")).unwrap();
    assert!(store
        .dispatch_with_capabilities(
            request(&task, "fresh-stale", Intent::NewWork, "gpt-6-astra"),
            None,
            verified()
        )
        .is_err());
}

#[test]
fn restart_off_and_delete_revoke_transients_preserving_preferences_and_chat_flags() {
    let (dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let held = flight(
        &mut store,
        request(&task, "held", Intent::NewWork, "gpt-6-astra"),
        verified(),
    );
    store
        .allow_once(identity("a"), "held".into(), held.task.plan_revision, 0)
        .unwrap();
    drop(store);
    let mut store = WorkflowStore::new(dir.path()).unwrap();
    let task = read(&mut store, "a");
    assert!(!task.once_available);
    assert!(task.observation.is_none());
    store.disable_chat(&identity("a")).unwrap();
    store.erase(None).unwrap();
    let task = read(&mut store, "a");
    assert!(!task.enabled);
    assert!(task.plan.is_none());
    assert!(task.approval.is_none());
    assert!(store.preferences().unwrap().enabled);
    let result = flight(
        &mut store,
        request(&task, "off", Intent::NewWork, "gpt-6-astra"),
        verified(),
    );
    assert_eq!(result.decision, "passthrough");
}

#[test]
fn observed_stop_only_reviews_the_matching_execution_turn_without_claiming_success() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let planning = flight(
        &mut store,
        request(&task, "plan-turn", Intent::NewWork, "gpt-5.6-sol"),
        verified(),
    )
    .task;
    store.observe_turn("a", "plan-turn", true).unwrap();
    assert_eq!(read(&mut store, "a").phase, Phase::Planning);
    let ready = store
        .approve(identity("a"), planning.plan_revision, 0)
        .unwrap();
    let executed = flight(
        &mut store,
        request(&ready, "exec-turn", Intent::Execute, "gpt-5.6-terra"),
        verified(),
    )
    .task;
    store.observe_turn("a", "old-turn", true).unwrap();
    assert_eq!(read(&mut store, "a").phase, Phase::Executing);
    store.observe_turn("a", "exec-turn", true).unwrap();
    let reviewed = read(&mut store, "a");
    assert_eq!(reviewed.phase, Phase::Review);
    assert_eq!(reviewed.plan, executed.plan);
}

#[test]
fn chat_only_workflow_optin_does_not_enable_other_assistance_chats_or_override_explicit_off() {
    use crate::domain::assistance::{Binding as AssistanceBinding, Request as AssistanceRequest};
    let dir = tempfile::tempdir().unwrap();
    let mut store = crate::application::assistance::AssistanceStore::new(dir.path()).unwrap();
    let make = |chat: &str| AssistanceRequest::Read {
        identity: identity(chat),
        binding: Some(AssistanceBinding {
            session_id: chat.into(),
            turn_id: "turn".into(),
            cwd: "C:/workflow".into(),
        }),
    };
    let opted = store.dispatch_with_workflow(make("a"), true).unwrap();
    assert_eq!(opted["preferences"]["enabled"], true);
    assert!(!store.preferences().unwrap().enabled);
    let unrelated = store.dispatch(make("b")).unwrap();
    assert_eq!(unrelated["preferences"]["enabled"], false);
    store.set_enabled(identity("a"), false).unwrap();
    let opted = store.dispatch_with_workflow(make("a"), true).unwrap();
    assert_eq!(opted["task"]["enabled"], false);
}

#[test]
fn unrelated_legacy_preferences_do_not_disable_workflow_and_explicit_chat_off_on_is_reversible() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = crate::application::store::Store::new(dir.path()).unwrap();
    store
        .workflow
        .save_preferences(Preferences {
            enabled: true,
            ..Default::default()
        })
        .unwrap();
    let task = read(&mut store.workflow, "a");
    let mut legacy = store.assistance.preferences().unwrap();
    legacy.answer_length = crate::domain::assistance::AnswerLength::Detailed;
    store.save_assistance_preferences_control(legacy).unwrap();
    assert!(store.workflow.enabled(&identity("a")).unwrap());
    store.assistance.ensure(&identity("a")).unwrap();
    let configuration = |enabled| Configuration {
        enabled,
        preset: task.preset,
        plan_first: task.plan_first,
        planning: task.planning.clone(),
        execution: task.execution.clone(),
    };
    let off = store
        .configure_workflow_control(identity("a"), configuration(false), 0)
        .unwrap();
    assert!(!store.assistance.load(&identity("a")).unwrap().task.enabled);
    let on = store
        .configure_workflow_control(identity("a"), configuration(true), off.settings_revision)
        .unwrap();
    assert!(on.enabled);
    assert!(store.assistance.load(&identity("a")).unwrap().task.enabled);
    assert!(!store.assistance.preferences().unwrap().enabled);
    let mut global = store.assistance.preferences().unwrap();
    global.enabled = true;
    store.save_assistance_preferences_control(global).unwrap();
    let mut global = store.assistance.preferences().unwrap();
    global.enabled = false;
    store.save_assistance_preferences_control(global).unwrap();
    assert!(!store.workflow.enabled(&identity("a")).unwrap());
}

#[test]
fn preparation_binding_rejects_plan_settings_approval_and_off_changes_but_allows_observed_start() {
    let (_dir, mut store) = enabled_store();
    let task = read(&mut store, "a");
    let planned = flight(
        &mut store,
        request(&task, "plan", Intent::NewWork, "gpt-5.6-sol"),
        verified(),
    )
    .task;
    let ready = store.approve(identity("a"), 0, 0).unwrap();
    let running = flight(
        &mut store,
        request(&ready, "execute", Intent::Execute, "gpt-5.6-terra"),
        capabilities(),
    )
    .task;
    let stamp = GuidanceBinding {
        settings_revision: running.settings_revision,
        plan_revision: running.plan_revision,
        phase: running.phase,
        approval: running.approval.clone(),
        submission_id: "execute".into(),
    };
    store
        .validate_guidance(&identity("a"), &stamp, Some("execute"))
        .unwrap();
    store.observe_turn("a", "execute", false).unwrap();
    store
        .validate_guidance(&identity("a"), &stamp, Some("execute"))
        .unwrap();
    let mut wrong = stamp.clone();
    wrong.settings_revision += 1;
    assert!(store
        .validate_guidance(&identity("a"), &wrong, Some("execute"))
        .is_err());
    let mut wrong = stamp.clone();
    wrong.plan_revision += 1;
    assert!(store
        .validate_guidance(&identity("a"), &wrong, Some("execute"))
        .is_err());
    let mut wrong = stamp.clone();
    wrong.approval = None;
    assert!(store
        .validate_guidance(&identity("a"), &wrong, Some("execute"))
        .is_err());
    store.disable_chat(&identity("a")).unwrap();
    assert!(store
        .validate_guidance(&identity("a"), &stamp, Some("execute"))
        .is_err());
    assert!(planned.plan.is_none());
}

#[test]
fn unchanged_workflow_guidance_is_not_reinjected_for_a_new_submission_id() {
    use crate::domain::assistance::Request as AssistanceRequest;
    let dir = tempfile::tempdir().unwrap();
    let mut store = crate::application::assistance::AssistanceStore::new(dir.path()).unwrap();
    store
        .dispatch_with_workflow(
            AssistanceRequest::Read {
                identity: identity("a"),
                binding: None,
            },
            true,
        )
        .unwrap();
    let make = |submission: &str| AssistanceRequest::Prepare {
        identity: identity("a"),
        binding: None,
        expected_revision: 0,
        preferences_revision: 0,
        settings_revision: 0,
        recipe_id: "planning".into(),
        requested_model: None,
        reason: "계획 준비".into(),
        injection_bytes: 100,
        guidance_hash: "a".repeat(64),
        context_partial: false,
        included_context_keys: vec![],
        workflow_binding: Some(GuidanceBinding {
            settings_revision: 0,
            plan_revision: 0,
            phase: Phase::Planning,
            approval: None,
            submission_id: submission.into(),
        }),
    };
    let prepared = store.dispatch_with_workflow(make("first"), true).unwrap();
    store
        .dispatch_with_workflow(
            AssistanceRequest::Delivered {
                identity: identity("a"),
                binding: None,
                nonce: prepared["nonce"].as_str().unwrap().into(),
                evidence: "sent".into(),
            },
            true,
        )
        .unwrap();
    let next = store.dispatch_with_workflow(make("next"), true).unwrap();
    assert_eq!(next["duplicate"], true);
    assert!(next["nonce"].is_null());
    let mut changed = make("third");
    if let AssistanceRequest::Prepare {
        workflow_binding: Some(binding),
        ..
    } = &mut changed
    {
        binding.plan_revision = 1;
    }
    assert_eq!(
        store.dispatch_with_workflow(changed, true).unwrap()["duplicate"],
        false
    );
}
