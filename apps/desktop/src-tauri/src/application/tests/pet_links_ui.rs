use crate::{application::store::Store, domain::{pet_link::*, roles::{Skill, Template}}};

const A: &str = "11111111-1111-4111-8111-111111111111";
const B: &str = "22222222-2222-4222-8222-222222222222";
const C: &str = "33333333-3333-4333-8333-333333333333";
fn target(path: &std::path::Path, id: &str) -> Target {
    Target { source_id: "codex-windows-local".into(), thread_id: id.into(), cwd: path.to_string_lossy().into() }
}
fn template(figma: bool) -> Template {
    let mut template: Template = serde_json::from_str(include_str!("../../../../../../packages/contracts/data/ui-pet.json")).unwrap();
    template.features.figma_design = figma;
    template.validate().unwrap();
    template
}
fn report(target: &Target, revision: u64, receipt: Receipt) -> Request {
    Request::Report { target: target.clone(), expected_revision: revision, request_id: C.into(), receipt }
}
fn runtime() -> Receipt {
    Receipt::Runtime { parent_id: A.into(), child_id: B.into(), turn_id: C.into(), model: "gpt-6-luna".into(), effort: "low".into(), completed: true }
}

#[test]
fn saved_ui_pet_applies_to_exact_target_and_snapshots_do_not_follow_edits() {
    let dir = tempfile::tempdir().unwrap();
    let a = target(dir.path(), A); let b = target(dir.path(), B);
    let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
    let other = store.pet_link_request(Request::Connect { target: b.clone() }).unwrap().unwrap();
    let other_before = serde_json::to_value(other).unwrap();
    let saved = store.save_pet(None, 0, template(true)).unwrap();
    let apply = |expected_revision, pet_revision| Request::ApplyPet { target: a.clone(), expected_revision, pet_id: saved.id.clone(), pet_revision };
    assert_eq!(store.pet_link_request(apply(0, 1)).unwrap_err(), "pet-revision-changed");
    assert_eq!(store.pet_link_request(apply(1, 2)).unwrap_err(), "saved-pet-revision-changed");
    let mut wrong = a.clone(); wrong.cwd = dir.path().join("other").to_string_lossy().into();
    assert_eq!(store.pet_link_request(Request::ApplyPet { target: wrong, expected_revision: 1, pet_id: saved.id.clone(), pet_revision: 1 }).unwrap_err(), "pet-target-mismatch");
    let applied = store.pet_link_request(apply(1, 1)).unwrap().unwrap();
    assert_eq!(applied.revision, 2); assert_eq!(applied.profile, Profile::Light);
    assert_eq!(applied.saved_pet.as_ref().unwrap().id, saved.id);
    assert_eq!(applied.template, saved.template);
    let retry = store.pet_link_request(apply(2, 1)).unwrap().unwrap();
    assert_eq!(retry.revision, 2);
    let prepared = store.pet_link_request(Request::Prepare { target: a.clone(), expected_revision: 2, request_id: C.into(), profile: Profile::Plan }).unwrap().unwrap();
    assert_eq!(prepared.run.as_ref().unwrap().template.as_ref(), Some(&saved.template));
    assert_eq!(prepared.run.as_ref().unwrap().saved_pet, applied.saved_pet);
    assert_eq!(store.pet_link_request(apply(2, 1)).unwrap_err(), "pet-run-active-or-unresolved");
    let mut edited = saved.template.clone(); edited.name = "명시적으로 바꾼 펫".into(); edited.features.figma_design = false;
    store.save_pet(Some(saved.id.clone()), 1, edited.clone()).unwrap();
    let unchanged = store.pet_link_request(Request::Read { target: a.clone() }).unwrap().unwrap();
    assert_eq!(unchanged.template, saved.template);
    assert_eq!(unchanged.run.unwrap().template, Some(saved.template.clone()));
    store.pet_link_request(report(&a, 2, runtime())).unwrap();
    let waiting = store.pet_link_request(report(&a, 2, Receipt::Returned)).unwrap().unwrap();
    assert_eq!(waiting.run.unwrap().state, RunState::Waiting);
    let replaced = store.pet_link_request(apply(2, 2)).unwrap().unwrap();
    assert_eq!(replaced.revision, 3); assert!(replaced.run.is_none());
    assert_eq!(replaced.template, edited);
    assert!(store.pet_link_request(report(&a, 2, Receipt::Returned)).is_err());
    assert_eq!(serde_json::to_value(store.pet_link_request(Request::Read { target: b }).unwrap().unwrap()).unwrap(), other_before);
    drop(store);
    let mut store = Store::new(dir.path()).unwrap();
    let restored = store.pet_link_request(Request::Read { target: a }).unwrap().unwrap();
    assert_eq!(restored.template, edited); assert!(!restored.connected);
    assert_eq!(restored.saved_pet.unwrap().revision, 2);
}

#[test]
fn resources_require_runtime_target_and_do_not_imply_quality_or_completion() {
    let dir = tempfile::tempdir().unwrap(); let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
    let saved = store.save_pet(None, 0, template(true)).unwrap();
    store.pet_link_request(Request::ApplyPet { target: a.clone(), expected_revision: 1, pet_id: saved.id, pet_revision: 1 }).unwrap();
    store.pet_link_request(Request::Prepare { target: a.clone(), expected_revision: 2, request_id: C.into(), profile: Profile::Light }).unwrap();
    let skills = template(true).skills;
    let resources = |child: &str, skills, figma_used| Receipt::Resources { child_id: child.into(), turn_id: C.into(), skills, figma_used };
    assert_eq!(store.pet_link_request(report(&a, 2, resources(B, skills.clone(), true))).unwrap_err(), "pet-resource-target-mismatch");
    store.pet_link_request(report(&a, 2, runtime())).unwrap();
    assert!(store.pet_link_request(report(&a, 2, resources(A, skills.clone(), true))).is_err());
    assert!(store.pet_link_request(report(&a, 2, resources(B, vec![Skill { id: "unknown".into(), version: "1".into() }], false))).is_err());
    let seen = store.pet_link_request(report(&a, 2, resources(B, skills.clone(), true))).unwrap().unwrap().run.unwrap();
    assert_eq!(seen.state, RunState::Unknown); assert!(!seen.completion_confirmed());
    assert_eq!(seen.skill_evidence, skills); assert!(seen.figma_used);
    let repeated = store.pet_link_request(report(&a, 2, resources(B, vec![], false))).unwrap().unwrap().run.unwrap();
    assert_eq!(repeated.skill_evidence, skills); assert!(repeated.figma_used);
    let completed = store.pet_link_request(report(&a, 2, Receipt::Returned)).unwrap().unwrap().run.unwrap();
    assert_eq!(completed.state, RunState::Complete);
    drop(store); let mut store = Store::new(dir.path()).unwrap();
    let restored = store.pet_link_request(Request::Read { target: a }).unwrap().unwrap().run.unwrap();
    assert_eq!(restored.skill_evidence, skills); assert!(restored.figma_used);
}

#[test]
fn execution_completion_does_not_invent_skill_or_mcp_evidence() {
    let dir = tempfile::tempdir().unwrap(); let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
    store.pet_link_request(Request::Prepare { target: a.clone(), expected_revision: 1, request_id: C.into(), profile: Profile::Light }).unwrap();
    store.pet_link_request(report(&a, 1, runtime())).unwrap();
    let done = store.pet_link_request(report(&a, 1, Receipt::Returned)).unwrap().unwrap().run.unwrap();
    assert!(done.completion_confirmed()); assert!(done.skill_evidence.is_empty()); assert!(!done.figma_used);
    assert!(store.pet_link_request(report(&a, 1, Receipt::Resources { child_id: B.into(), turn_id: C.into(), skills: vec![], figma_used: true })).is_err());
}

#[test]
fn legacy_data_without_features_and_snapshots_still_opens_without_upgrading() {
    let dir = tempfile::tempdir().unwrap(); let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
    let prepared = store.pet_link_request(Request::Prepare { target: a.clone(), expected_revision: 1, request_id: C.into(), profile: Profile::Light }).unwrap().unwrap();
    let mut legacy = serde_json::to_value(prepared).unwrap();
    legacy.as_object_mut().unwrap().remove("savedPet");
    legacy["template"].as_object_mut().unwrap().remove("features");
    let run = legacy["run"].as_object_mut().unwrap();
    for field in ["template", "savedPet", "skillEvidence", "figmaUsed"] { run.remove(field); }
    store.db.execute("UPDATE explicit_pet_links_v1 SET value=?1", [legacy.to_string()]).unwrap();
    drop(store); let mut store = Store::new(dir.path()).unwrap();
    let restored = store.pet_link_request(Request::Read { target: a.clone() }).unwrap().unwrap();
    assert_eq!(restored.template.skills[0].id, "autopets-build-implementation");
    assert!(!restored.template.features.figma_design); assert!(restored.saved_pet.is_none());
    let run = restored.run.unwrap();
    assert!(run.template.is_none()); assert!(run.skill_evidence.is_empty()); assert!(!run.figma_used);
    assert_eq!(run.state, RunState::Unknown);
    store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
    store.pet_link_request(report(&a, 1, runtime())).unwrap();
    assert_eq!(store.pet_link_request(report(&a, 1, Receipt::Resources { child_id: B.into(), turn_id: C.into(), skills: vec![], figma_used: false })).unwrap_err(), "pet-resource-snapshot-missing");
}

#[test]
fn unknown_skill_versions_and_unsupported_feature_combinations_are_rejected() {
    let mut ui = template(false);
    ui.skills[0].version = "latest".into(); assert!(ui.validate().is_err());
    let mut old = crate::domain::roles::templates().unwrap().remove(1);
    old.features.figma_design = true; assert!(old.validate().is_err());
    let mut value = serde_json::to_value(template(false)).unwrap();
    value["features"]["unverifiedMcp"] = true.into();
    assert!(serde_json::from_value::<Template>(value).is_err());
}

#[test]
fn apply_failure_preserves_settings_and_does_not_reenable_disabled_help() {
    let dir = tempfile::tempdir().unwrap(); let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
    store.pet_link_request(Request::Enable { target: a.clone(), expected_revision: 1, enabled: false }).unwrap();
    let before = store.pet_link_request(Request::Read { target: a.clone() }).unwrap().unwrap();
    let saved = store.save_pet(None, 0, template(false)).unwrap();
    let apply = || Request::ApplyPet { target: a.clone(), expected_revision: 2, pet_id: saved.id.clone(), pet_revision: 1 };
    store.db.execute_batch("CREATE TRIGGER reject_pet_apply BEFORE UPDATE ON explicit_pet_links_v1 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert!(store.pet_link_request(apply()).is_err());
    let unchanged = store.pet_link_request(Request::Read { target: a.clone() }).unwrap().unwrap();
    assert_eq!(serde_json::to_value(before).unwrap(), serde_json::to_value(unchanged).unwrap());
    store.db.execute_batch("DROP TRIGGER reject_pet_apply;").unwrap();
    let applied = store.pet_link_request(apply()).unwrap().unwrap();
    assert!(!applied.enabled); assert_eq!(applied.revision, 3);
    assert!(store.pet_link_request(Request::Prepare { target: a, expected_revision: 3, request_id: C.into(), profile: Profile::Light }).is_err());
}

#[test]
fn saved_routing_is_mapped_exactly_or_rejected_without_mutation() {
    use crate::domain::workflow::Model;
    for profile in [Profile::Light, Profile::Standard, Profile::Careful] {
        let dir = tempfile::tempdir().unwrap(); let a = target(dir.path(), A);
        let mut store = Store::new(dir.path()).unwrap();
        store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
        let mut selected = template(false);
        let (model, effort) = profile.settings();
        selected.execution = Some(Model { model: model.into(), reasoning: effort.into() });
        let saved = store.save_pet(None, 0, selected).unwrap();
        let applied = store.pet_link_request(Request::ApplyPet { target: a.clone(), expected_revision: 1, pet_id: saved.id, pet_revision: 1 }).unwrap().unwrap();
        assert_eq!(applied.profile, profile);
        let prepared = store.pet_link_request(Request::Prepare { target: a, expected_revision: 2, request_id: C.into(), profile }).unwrap().unwrap().run.unwrap();
        assert_eq!(prepared.model, model); assert_eq!(prepared.effort, effort);
    }
    let dir = tempfile::tempdir().unwrap(); let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    let before = store.pet_link_request(Request::Connect { target: a.clone() }).unwrap().unwrap();
    for planning in [false, true] {
        let mut unsupported = template(false);
        let model = Some(Model { model: "gpt-6-astra".into(), reasoning: "high".into() });
        if planning { unsupported.planning = model; } else { unsupported.execution = model; }
        let saved = store.save_pet(None, 0, unsupported).unwrap();
        assert_eq!(store.pet_link_request(Request::ApplyPet { target: a.clone(), expected_revision: 1, pet_id: saved.id, pet_revision: 1 }).unwrap_err(), "pet-template-routing-unsupported");
        let after = store.pet_link_request(Request::Read { target: a.clone() }).unwrap().unwrap();
        assert_eq!(serde_json::to_value(&before).unwrap(), serde_json::to_value(after).unwrap());
    }
    let mut empty = template(false); empty.planning = None; empty.execution = None;
    assert_eq!(Profile::for_template(&empty).unwrap(), Profile::Light);
}

#[test]
fn reapplying_the_same_pet_preserves_chat_profile_override_and_saved_original() {
    let dir = tempfile::tempdir().unwrap(); let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
    let saved = store.save_pet(None, 0, template(false)).unwrap();
    store.pet_link_request(Request::ApplyPet { target: a.clone(), expected_revision: 1, pet_id: saved.id.clone(), pet_revision: 1 }).unwrap();
    store.pet_link_request(Request::Settings { target: a.clone(), expected_revision: 2, profile: Profile::Careful }).unwrap();
    let repeated = store.pet_link_request(Request::ApplyPet { target: a.clone(), expected_revision: 3, pet_id: saved.id.clone(), pet_revision: 1 }).unwrap().unwrap();
    assert_eq!(repeated.profile, Profile::Careful); assert_eq!(repeated.revision, 3);
    assert_eq!(store.saved_pet(&saved.id).unwrap().unwrap().template, saved.template);
    let run = store.pet_link_request(Request::Prepare { target: a, expected_revision: 3, request_id: C.into(), profile: repeated.profile }).unwrap().unwrap().run.unwrap();
    assert_eq!(run.model, "gpt-6-sol"); assert_eq!(run.effort, "medium");
    assert_eq!(run.template, Some(saved.template));
}
