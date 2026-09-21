use super::*;
use rusqlite::params;
fn identity(account: &str, chat: &str) -> Identity {
    Identity {
        provider: Provider::Chatgpt,
        account_id: account.into(),
        chat_id: chat.into(),
    }
}
fn read(store: &mut AssistanceStore, id: &Identity) {
    store
        .dispatch(Request::Read {
            identity: id.clone(),
            binding: None,
        })
        .unwrap();
}
fn enable(store: &mut AssistanceStore) {
    let mut prefs = store.preferences().unwrap();
    prefs.enabled = true;
    store.save_preferences(prefs).unwrap();
}
fn prepare(store: &mut AssistanceStore, id: &Identity, revision: u64) -> serde_json::Value {
    store
        .dispatch(Request::Prepare {
            identity: id.clone(),
            binding: None,
            expected_revision: revision,
            preferences_revision: store.preferences().unwrap().revision,
            settings_revision: store.load(id).unwrap().task.settings_revision,
            recipe_id: "research".into(),
            requested_model: Some("candidate".into()),
            reason: "비교 기준을 정리했어요".into(),
            injection_bytes: 500,
            guidance_hash: "a".repeat(64),
            context_partial: false,
            included_context_keys: vec![],
        })
        .unwrap()
}
fn delivered(
    store: &mut AssistanceStore,
    id: &Identity,
    nonce: &str,
) -> Result<serde_json::Value, String> {
    store.dispatch(Request::Delivered {
        identity: id.clone(),
        binding: None,
        nonce: nonce.into(),
        evidence: "sent".into(),
    })
}
fn example() -> Context {
    Context {
        goal: "경쟁사 비교".into(),
        output_format: "표".into(),
        constraints: vec!["세 곳".into()],
        decisions: vec![],
        remaining: vec!["출처 확인".into()],
    }
}

#[test]
fn editing_undo_and_delete_all_revoke_each_outstanding_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    enable(&mut store);
    let id = identity("a", "c");
    read(&mut store, &id);
    store.save_context(id.clone(), example(), 0).unwrap();
    let prepared = prepare(&mut store, &id, 1);
    let nonce = prepared["nonce"].as_str().unwrap();
    let mut changed = example();
    changed.goal = "변경된 목표".into();
    store.save_context(id.clone(), changed, 1).unwrap();
    assert!(delivered(&mut store, &id, nonce).is_err());
    let prepared = prepare(&mut store, &id, 2);
    let nonce = prepared["nonce"].as_str().unwrap();
    let restored = store.undo_context(id.clone(), 2).unwrap();
    assert_eq!(restored.context, example());
    assert!(delivered(&mut store, &id, nonce).is_err());
    let prepared = prepare(&mut store, &id, 3);
    let nonce = prepared["nonce"].as_str().unwrap();
    store.delete_all_contexts().unwrap();
    assert!(delivered(&mut store, &id, nonce).is_err());
    let task = store.load(&id).unwrap().task;
    assert_eq!(task.revision, 4);
    assert_eq!(task.settings_revision, 0);
    assert!(task.previous_context.is_none());
    assert!(task.change_summary.is_empty());
}

#[test]
fn previous_release_records_default_new_preferences_task_settings_and_delivery_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let id = identity("a", "old");
    {
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        read(&mut store, &id);
        store.save_context(id.clone(), example(), 0).unwrap();
        let mut prefs = serde_json::to_value(Preferences::default()).unwrap();
        prefs.as_object_mut().unwrap().remove("answerLength");
        prefs.as_object_mut().unwrap().remove("outputFormat");
        store
            .db
            .execute(
                "INSERT INTO assistance_preferences(singleton,value) VALUES(1,?1)",
                [prefs.to_string()],
            )
            .unwrap();
        let mut record = serde_json::to_value(store.load(&id).unwrap()).unwrap();
        for key in [
            "previousContext",
            "changeSummary",
            "workStyleOverride",
            "settingsRevision",
        ] {
            record["task"].as_object_mut().unwrap().remove(key);
        }
        for key in ["contextPartial", "includedContextKeys"] {
            record["task"]["assistance"]
                .as_object_mut()
                .unwrap()
                .remove(key);
        }
        store
            .db
            .execute(
                "UPDATE assistance_tasks SET value=?2 WHERE identity=?1",
                params![id.key().unwrap(), record.to_string()],
            )
            .unwrap();
    }
    let store = AssistanceStore::new(dir.path()).unwrap();
    let prefs = store.preferences().unwrap();
    let task = store.load(&id).unwrap().task;
    assert_eq!(prefs.answer_length, AnswerLength::Concise);
    assert_eq!(prefs.output_format, OutputFormat::Adaptive);
    assert_eq!(task.context, example());
    assert_eq!(task.settings_revision, 0);
    assert!(task.work_style_override.is_none());
    assert!(task.previous_context.is_none());
    assert!(task.change_summary.is_empty());
    assert!(!task.assistance.context_partial);
    assert!(task.assistance.included_context_keys.is_empty());
}
#[test]
fn undo_is_one_step_revision_checked_and_preserves_chat_off() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    let id = identity("a", "c");
    read(&mut store, &id);
    store.set_enabled(id.clone(), false).unwrap();
    store.save_context(id.clone(), example(), 0).unwrap();
    let mut changed = example();
    changed.goal = "새로운 비교 기준".into();
    let edited = store.save_context(id.clone(), changed.clone(), 1).unwrap();
    assert_eq!(edited.previous_context, Some(example()));
    assert_eq!(edited.change_summary, "변경: 목표");
    let unchanged = store.save_context(id.clone(), changed, 2).unwrap();
    assert_eq!(unchanged.revision, 2);
    assert_eq!(unchanged.previous_context, Some(example()));
    assert!(store.undo_context(id.clone(), 1).is_err());
    let restored = store.undo_context(id.clone(), 2).unwrap();
    assert_eq!(restored.context, example());
    assert_eq!(restored.revision, 3);
    assert!(restored.previous_context.is_none());
    assert!(!restored.enabled);
    assert_eq!(restored.assistance.status, Status::Off);
    assert!(store.undo_context(id, 3).is_err());
}
#[test]
fn task_work_style_has_its_own_revision_and_does_not_leak_to_other_chats() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    enable(&mut store);
    let a = identity("a", "one");
    let b = identity("a", "two");
    read(&mut store, &a);
    read(&mut store, &b);
    let p = prepare(&mut store, &a, 0);
    let nonce = p["nonce"].as_str().unwrap();
    let changed = store
        .set_work_style(a.clone(), Some(WorkStyle::Fast), 0)
        .unwrap();
    assert_eq!(changed.settings_revision, 1);
    assert_eq!(changed.revision, 0);
    assert_eq!(changed.assistance.reason, "전달 대기");
    assert!(delivered(&mut store, &a, nonce).is_err());
    assert!(store
        .set_work_style(a.clone(), Some(WorkStyle::Thorough), 0)
        .is_err());
    assert_eq!(
        store
            .set_work_style(a.clone(), Some(WorkStyle::Fast), 1)
            .unwrap()
            .settings_revision,
        1
    );
    assert!(store.load(&b).unwrap().task.work_style_override.is_none());
    let stale=serde_json::from_value::<Request>(serde_json::json!({"operation":"prepare","identity":a,"expectedRevision":0,"preferencesRevision":1,"recipeId":"general","requestedModel":null,"reason":"준비","injectionBytes":100,"guidanceHash":"a".repeat(64)})).unwrap();
    assert!(store
        .dispatch(stale)
        .unwrap_err()
        .contains("settings revision"));
    let reset = store.set_work_style(a, None, 1).unwrap();
    assert!(reset.work_style_override.is_none());
    assert_eq!(reset.settings_revision, 2);
}
#[test]
fn partial_context_metadata_is_bounded_and_deletion_clears_history_and_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    enable(&mut store);
    let id = identity("a", "c");
    read(&mut store, &id);
    store.save_context(id.clone(), example(), 0).unwrap();
    let payload = serde_json::json!({"operation":"prepare","identity":id,"expectedRevision":1,"preferencesRevision":1,"recipeId":"general","requestedModel":null,"reason":"준비","injectionBytes":100,"guidanceHash":"c".repeat(64),"contextPartial":true,"includedContextKeys":["goal"]});
    let mut invalid = payload.clone();
    invalid["includedContextKeys"] = serde_json::json!(["transcript"]);
    assert!(store
        .dispatch(serde_json::from_value(invalid).unwrap())
        .is_err());
    let result = store
        .dispatch(serde_json::from_value(payload).unwrap())
        .unwrap();
    assert_eq!(result["task"]["assistance"]["contextPartial"], true);
    assert_eq!(
        result["task"]["assistance"]["includedContextKeys"],
        serde_json::json!(["goal"])
    );
    let nonce = result["nonce"].as_str().unwrap();
    let deleted = store.delete_context(id.clone()).unwrap();
    assert_eq!(deleted.context, Context::default());
    assert!(deleted.previous_context.is_none());
    assert!(deleted.change_summary.is_empty());
    assert!(!deleted.assistance.context_partial);
    assert_eq!(deleted.quality.status, QualityStatus::Unchecked);
    assert!(delivered(&mut store, &id, nonce).is_err());
    assert!(store.undo_context(id, deleted.revision).is_err());
}

#[test]
fn additive_tables_preserve_existing_database_and_context_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let db = Connection::open(dir.path().join("autopets.sqlite3")).unwrap();
    db.execute_batch("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('existing');")
        .unwrap();
    let id = identity("account-a", "chat");
    {
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        read(&mut store, &id);
        store.save_context(id.clone(), example(), 0).unwrap();
    }
    let store = AssistanceStore::new(dir.path()).unwrap();
    assert_eq!(store.overview().unwrap().tasks[0].context, example());
    assert_eq!(
        db.query_row("SELECT value FROM sentinel", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "existing"
    );
    assert!(!store.preferences().unwrap().enabled);
}
#[test]
fn accounts_chats_and_providers_have_separate_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    let a = identity("account-a", "same");
    let b = identity("account-b", "same");
    let c = identity("account-a", "other");
    let mut d = a.clone();
    d.provider = Provider::Codex;
    for id in [&a, &b, &c, &d] {
        read(&mut store, id);
    }
    store.save_context(a, example(), 0).unwrap();
    assert_eq!(store.overview().unwrap().tasks.len(), 4);
    for id in [&b, &c, &d] {
        assert_eq!(store.load(id).unwrap().task.context, Context::default());
    }
}
#[test]
fn context_revision_is_optimistic_and_identical_content_does_not_rewrite() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    let id = identity("a", "c");
    read(&mut store, &id);
    let first = store.save_context(id.clone(), example(), 0).unwrap();
    let same = store.save_context(id.clone(), example(), 1).unwrap();
    assert_eq!(first.revision, same.revision);
    assert_eq!(first.updated_at, same.updated_at);
    assert!(store.save_context(id, Context::default(), 0).is_err());
}
#[test]
fn opt_in_and_per_chat_off_stop_delivery_and_sync() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    let id = identity("a", "c");
    read(&mut store, &id);
    assert!(delivered(&mut store, &id, "fake")
        .unwrap_err()
        .contains("disabled"));
    enable(&mut store);
    let p = prepare(&mut store, &id, 0);
    let nonce = p["nonce"].as_str().unwrap();
    store.set_enabled(id.clone(), false).unwrap();
    assert!(delivered(&mut store, &id, nonce).is_err());
    store.delete_all_contexts().unwrap();
    assert!(!store.load(&id).unwrap().task.enabled);
    assert!(store.preferences().unwrap().enabled);
}
#[test]
fn receipt_is_scoped_single_use_and_never_confirms_a_model() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    enable(&mut store);
    let a = identity("a", "c1");
    let b = identity("a", "c2");
    read(&mut store, &a);
    read(&mut store, &b);
    let p = prepare(&mut store, &a, 0);
    let nonce = p["nonce"].as_str().unwrap();
    assert!(delivered(&mut store, &b, nonce).is_err());
    let result = delivered(&mut store, &a, nonce).unwrap();
    assert_eq!(result["task"]["assistance"]["status"], "sent");
    assert!(result["task"]["assistance"]["appliedModel"].is_null());
    assert!(delivered(&mut store, &a, nonce).is_err());
    let duplicate = prepare(&mut store, &a, 0);
    assert_eq!(duplicate["duplicate"], true);
    assert!(duplicate["nonce"].is_null());
    for cap in capabilities().values() {
        assert!(
            !cap.model_switch && !cap.input_assistance && !cap.context_sync && !cap.token_usage
        );
    }
}
#[test]
fn preference_changes_and_deletion_revoke_old_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    enable(&mut store);
    let id = identity("a", "c");
    read(&mut store, &id);
    let p = prepare(&mut store, &id, 0);
    let nonce = p["nonce"].as_str().unwrap();
    let mut prefs = store.preferences().unwrap();
    prefs.work_style = WorkStyle::Fast;
    store.save_preferences(prefs).unwrap();
    assert!(delivered(&mut store, &id, nonce).is_err());
    let p = prepare(&mut store, &id, 0);
    let nonce = p["nonce"].as_str().unwrap();
    store.delete_context(id.clone()).unwrap();
    assert!(delivered(&mut store, &id, nonce).is_err());
    assert_eq!(store.load(&id).unwrap().task.revision, 1);
}
#[test]
fn bounded_utf8_context_metadata_and_unknown_fields_are_rejected() {
    let mut context = example();
    context.constraints = vec!["가".repeat(160); 8];
    assert!(context.validate().is_err());
    assert!(serde_json::from_value::<Request>(serde_json::json!({"operation":"read","identity":{"provider":"chatgpt","accountId":"a","chatId":"c"},"rawPrompt":"private"})).is_err());
    assert!(serde_json::from_value::<Context>(serde_json::json!({"goal":"g","outputFormat":"","constraints":[],"decisions":[],"remaining":[],"transcript":"private"})).is_err());
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    enable(&mut store);
    let id = identity("a", "c");
    read(&mut store, &id);
    let request=serde_json::from_value::<Request>(serde_json::json!({"operation":"prepare","identity":id,"expectedRevision":0,"preferencesRevision":1,"recipeId":"simple","requestedModel":null,"reason":"too large","injectionBytes":3073,"guidanceHash":"a".repeat(64)})).unwrap();
    assert!(store.dispatch(request).is_err());
}
#[test]
fn context_and_quality_each_require_current_delivery_and_allow_one_update() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    enable(&mut store);
    let id = identity("a", "c");
    read(&mut store, &id);
    let p = prepare(&mut store, &id, 0);
    let nonce = p["nonce"].as_str().unwrap();
    let context_request = || Request::Context {
        identity: id.clone(),
        binding: None,
        nonce: nonce.into(),
        expected_revision: 0,
        context: example(),
    };
    assert!(store.dispatch(context_request()).is_err());
    delivered(&mut store, &id, nonce).unwrap();
    store.dispatch(context_request()).unwrap();
    assert!(store.dispatch(context_request()).is_err());
    let quality = |count| Request::Quality {
        identity: id.clone(),
        binding: None,
        nonce: nonce.into(),
        quality: Quality {
            status: QualityStatus::NeedsReview,
            findings: vec!["출처 확인".into()],
            repair_count: count,
        },
    };
    assert!(store.dispatch(quality(2)).is_err());
    store.dispatch(quality(1)).unwrap();
    assert!(store.dispatch(quality(1)).is_err());
}
#[test]
fn restart_invalidates_inflight_receipts_but_preserves_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let id = identity("a", "c");
    let nonce;
    {
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        read(&mut store, &id);
        nonce = prepare(&mut store, &id, 0)["nonce"]
            .as_str()
            .unwrap()
            .to_string();
    }
    let mut store = AssistanceStore::new(dir.path()).unwrap();
    assert!(delivered(&mut store, &id, &nonce).is_err());
    assert_eq!(
        store.load(&id).unwrap().task.assistance.status,
        Status::Unavailable
    );
    assert!(store.preferences().unwrap().enabled);
}
