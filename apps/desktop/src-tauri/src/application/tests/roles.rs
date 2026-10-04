use super::*;
use crate::domain::assistance::{Context, Provider};
use crate::domain::workflow::{Approval, Binding as WorkflowBinding, Model};

fn identity(chat: &str) -> Identity { Identity { provider: Provider::Codex, account_id: format!("fixture-{chat}"), chat_id: chat.into() } }
fn connect(store: &mut Store, chat: &str) {
    store.workflow.ensure(&identity(chat), &WorkflowBinding { session_id: chat.into(), cwd: "C:/fixture only".into(), turn_id: None }).unwrap();
    store.assistance.ensure(&identity(chat)).unwrap();
}

#[test]
fn role_save_reopen_and_reuse_preserves_target_data_without_cross_chat_approval() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    connect(&mut store, "a"); connect(&mut store, "b");
    store.assistance.save_context(identity("a"), Context { goal: "A private goal".into(), ..Default::default() }, 0).unwrap();
    store.assistance.save_context(identity("b"), Context { goal: "B private goal".into(), ..Default::default() }, 0).unwrap();
    let before_b = serde_json::to_string(&store.workflow.load(&identity("b")).unwrap()).unwrap();
    let mut template = templates().unwrap().remove(0);
    template.name = "한글 이름 with spaces".into();
    template.planning = Some(Model { model: "fixture-model".into(), reasoning: "high".into() });
    template.prop = Prop::Notebook; template.background = Background::Meadow;
    let saved = store.save_pet(None, 0, template.clone()).unwrap();
    let mut a = store.workflow.load(&identity("a")).unwrap();
    a.task.approval = Some(Approval { settings_revision: 0, plan_revision: 0, approved_at: now_ms() });
    store.workflow.put(&a).unwrap();
    store.apply_pet(identity("a"), saved.id.clone(), 1, 0, 0, true).unwrap();
    assert_eq!(serde_json::to_string(&store.workflow.load(&identity("b")).unwrap()).unwrap(), before_b);
    let a = store.workflow.load(&identity("a")).unwrap();
    assert!(a.task.approval.is_none()); assert!(a.task.observation.is_none());
    assert!(!a.task.enabled, "choosing a role never turns global/workflow assistance on");
    assert_eq!(a.task.planning.model, "fixture-model");
    assert!(store.role_binding(&identity("b")).unwrap().is_none());
    store.shutdown().unwrap(); drop(store);
    let mut store = Store::new(dir.path()).unwrap();
    assert_eq!(store.saved_pet(&saved.id).unwrap().unwrap().template, template);
    let selected = store.role_binding(&identity("a")).unwrap().unwrap();
    assert_eq!(selected.template.prop, Prop::Notebook); assert_eq!(selected.template.background, Background::Meadow);
    store.apply_pet(identity("b"), saved.id.clone(), 1, 0, 0, true).unwrap();
    assert_eq!(store.assistance.load(&identity("a")).unwrap().task.context.goal, "A private goal");
    assert_eq!(store.assistance.load(&identity("b")).unwrap().task.context.goal, "B private goal");
    assert!(store.workflow.load(&identity("b")).unwrap().task.approval.is_none());
    assert!(!serde_json::to_string(&store.saved_pet(&saved.id).unwrap()).unwrap().contains("private goal"));
    assert_eq!(store.db.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
}

#[test]
fn revisions_unknown_chat_and_transaction_failure_do_not_partly_apply_role() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap(); connect(&mut store, "a");
    let saved = store.save_pet(None, 0, templates().unwrap().remove(1)).unwrap();
    assert!(store.save_pet(Some(saved.id.clone()), 0, saved.template.clone()).is_err());
    assert!(store.apply_pet(identity("unknown"), saved.id.clone(), 1, 0, 0, true).is_err());
    assert!(store.apply_pet(identity("a"), saved.id.clone(), 2, 0, 0, true).is_err());
    assert!(store.apply_pet(identity("a"), saved.id.clone(), 1, 0, 99, true).is_err());
    store.db.execute_batch("CREATE TRIGGER reject_role_fixture BEFORE UPDATE ON workflow_tasks_v1 BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;").unwrap();
    assert!(store.apply_pet(identity("a"), saved.id.clone(), 1, 0, 0, true).is_err());
    assert!(store.role_binding(&identity("a")).unwrap().is_none());
    assert_eq!(store.workflow.load(&identity("a")).unwrap().task.settings_revision, 0);
    store.db.execute_batch("DROP TRIGGER reject_role_fixture;").unwrap();
    store.apply_pet(identity("a"), saved.id.clone(), 1, 0, 0, true).unwrap();
    assert!(store.apply_pet(identity("a"), saved.id.clone(), 1, 0, 1, true).is_err());
    let mut edited = saved.template.clone(); edited.name = "new profile revision".into();
    store.save_pet(Some(saved.id.clone()), 1, edited).unwrap();
    assert_eq!(store.role_binding(&identity("a")).unwrap().unwrap().template.name, saved.template.name);
    store.apply_pet(identity("a"), saved.id, 2, 1, 1, false).unwrap();
    assert!(!store.role_binding(&identity("a")).unwrap().unwrap().enabled);
}

#[test]
fn role_cannot_interrupt_active_turn_or_store_context_disguised_as_template() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap(); connect(&mut store, "a");
    let saved = store.save_pet(None, 0, templates().unwrap().remove(0)).unwrap();
    store.apply_event(serde_json::from_value(serde_json::json!({ "eventId":"start", "kind":"turn_started", "sessionId":"a", "turnId":"active", "cwd":"C:/fixture only", "timestamp":now_ms() })).unwrap()).unwrap();
    assert!(store.apply_pet(identity("a"), saved.id, 1, 0, 0, true).is_err());
    assert!(store.role_binding(&identity("a")).unwrap().is_none());
    let mut raw = serde_json::to_value(&saved.template).unwrap(); raw["context"] = serde_json::json!({"goal":"do not copy"});
    assert!(serde_json::from_value::<Template>(raw).is_err());
    let mut oversized = saved.template; oversized.instruction = "한".repeat(513);
    assert!(store.save_pet(None, 0, oversized).is_err());
}
