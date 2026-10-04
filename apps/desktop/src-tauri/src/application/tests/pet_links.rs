use crate::{application::store::Store, domain::pet_link::*};
fn target(path:&std::path::Path,id:&str)->Target {Target{source_id:"codex-windows-local".into(),thread_id:id.into(),cwd:path.to_string_lossy().into()}}
const A:&str="11111111-1111-4111-8111-111111111111";
const B:&str="22222222-2222-4222-8222-222222222222";
const C:&str="33333333-3333-4333-8333-333333333333";
#[test]
fn explicit_links_preserve_unknown_identity_and_reopen_without_fake_events() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let b=target(dir.path(),B);
    let mut store=Store::new(dir.path()).unwrap();
    let first=store.pet_link_request(Request::Connect{target:a.clone()}).unwrap().unwrap();
    let second=store.pet_link_request(Request::Connect{target:a.clone()}).unwrap().unwrap();
    assert_eq!(first.slot,second.slot);assert_eq!(second.revision,1);
    let other=store.pet_link_request(Request::Connect{target:b}).unwrap().unwrap();assert_ne!(first.slot,other.slot);
    assert!(store.snapshot().sessions.is_empty());assert!(store.task_context(A,&a.cwd).is_err());
    assert_eq!(store.db.query_row("SELECT count(*) FROM events",[],|r|r.get::<_,u32>(0)).unwrap(),0);
    let mut wrong=a.clone();wrong.cwd=dir.path().join("other").to_string_lossy().into();
    assert!(store.pet_link_request(Request::Connect{target:wrong}).is_err());
    drop(store);let mut store=Store::new(dir.path()).unwrap();
    let restored=store.pet_link_request(Request::Read{target:a.clone()}).unwrap().unwrap();
    assert!(!restored.connected);assert_eq!(restored.slot,first.slot);assert_eq!(restored.template.skills[0].id,"autopets-build-implementation");
    assert!(store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Light}).is_err());
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    store.pet_link_request(Request::Enable{target:a.clone(),expected_revision:1,enabled:false}).unwrap();
    assert!(store.pet_link_request(Request::Prepare{target:a,expected_revision:1,request_id:C.into(),profile:Profile::Light}).is_err());
}
#[test]
fn explicit_run_requires_bound_evidence_and_rejects_stale_replays() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Plan}).unwrap();
    let report=|receipt|Request::Report{target:a.clone(),expected_revision:1,request_id:C.into(),receipt};
    let returned=store.pet_link_request(report(Receipt::Returned)).unwrap().unwrap();
    assert_eq!(returned.run.unwrap().state,RunState::Returned);
    assert!(store.pet_link_request(report(Receipt::Runtime{parent_id:B.into(),child_id:B.into(),turn_id:C.into(),model:"gpt-6-luna".into(),effort:"low".into(),completed:true})).is_err());
    let done=store.pet_link_request(report(Receipt::Runtime{parent_id:A.into(),child_id:B.into(),turn_id:C.into(),model:"gpt-6-luna".into(),effort:"low".into(),completed:true})).unwrap().unwrap();
    assert_eq!(done.run.unwrap().state,RunState::Waiting);
    let late=store.pet_link_request(report(Receipt::Runtime{parent_id:A.into(),child_id:B.into(),turn_id:C.into(),model:"gpt-6-luna".into(),effort:"low".into(),completed:false})).unwrap().unwrap();
    assert_eq!(late.run.unwrap().state,RunState::Waiting);
    store.pet_link_request(Request::Settings{target:a.clone(),expected_revision:1,profile:Profile::Standard}).unwrap();
    assert!(store.pet_link_request(report(Receipt::Returned)).is_err());
    assert!(store.pet_link_request(Request::Prepare{target:a,expected_revision:2,request_id:C.into(),profile:Profile::Standard}).is_err());
    assert!(store.snapshot().sessions.is_empty());
}

#[test]
fn disabled_assistance_does_not_discard_inflight_results() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Standard}).unwrap();
    store.pet_link_request(Request::Enable{target:a.clone(),expected_revision:1,enabled:false}).unwrap();
    assert!(store.pet_link_request(Request::Report{target:a.clone(),expected_revision:1,request_id:C.into(),receipt:Receipt::Returned}).is_err());
    store.pet_link_request(Request::Report{target:a.clone(),expected_revision:2,request_id:C.into(),receipt:Receipt::Returned}).unwrap();
    let done=store.pet_link_request(Request::Report{target:a.clone(),expected_revision:2,request_id:C.into(),receipt:Receipt::Runtime{parent_id:A.into(),child_id:B.into(),turn_id:C.into(),model:"gpt-6-sol".into(),effort:"low".into(),completed:true}}).unwrap().unwrap();
    assert!(!done.enabled);assert_eq!(done.run.as_ref().unwrap().settings_revision,1);assert_eq!(done.run.unwrap().state,RunState::Complete);
    assert!(store.pet_link_request(Request::Prepare{target:a,expected_revision:2,request_id:B.into(),profile:Profile::Light}).is_err());
}

#[test]
fn reopened_unknown_run_can_be_audited_without_redispatch() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Plan}).unwrap();
    let report=|receipt|Request::Report{target:a.clone(),expected_revision:1,request_id:C.into(),receipt};
    store.pet_link_request(report(Receipt::Spawned{agent_path:"/root/autopets_fixture".into()})).unwrap();
    assert!(store.pet_link_request(report(Receipt::Spawned{agent_path:"/root/other".into()})).is_err());
    drop(store);let mut store=Store::new(dir.path()).unwrap();
    let old=store.pet_link_request(Request::Read{target:a.clone()}).unwrap().unwrap();
    assert_eq!(old.run.as_ref().unwrap().state,RunState::Unknown);
    assert_eq!(old.run.unwrap().agent_path.as_deref(),Some("/root/autopets_fixture"));
    assert!(store.pet_link_request(report(Receipt::Returned)).is_err());
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    assert!(store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:B.into(),profile:Profile::Light}).is_err());
    let recovered=store.pet_link_request(report(Receipt::Runtime{parent_id:A.into(),child_id:B.into(),turn_id:C.into(),model:"gpt-6-luna".into(),effort:"low".into(),completed:true})).unwrap().unwrap();
    assert_eq!(recovered.run.unwrap().state,RunState::Unknown);
    let returned=store.pet_link_request(report(Receipt::Returned)).unwrap().unwrap();
    assert_eq!(returned.run.unwrap().state,RunState::Waiting);
}

#[test]
fn closing_tracking_preserves_settings_and_replay_protection() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Careful}).unwrap();
    assert!(store.pet_link_request(Request::CloseTracking{target:a.clone(),expected_revision:1,request_id:B.into()}).is_err());
    let closed=store.pet_link_request(Request::CloseTracking{target:a.clone(),expected_revision:1,request_id:C.into()}).unwrap().unwrap();
    assert!(closed.run.unwrap().tracking_closed);assert_eq!(closed.profile,Profile::Light);
    assert!(store.pet_link_request(Request::Report{target:a.clone(),expected_revision:2,request_id:C.into(),receipt:Receipt::Returned}).is_err());
    store.pet_link_request(Request::Settings{target:a.clone(),expected_revision:2,profile:Profile::Standard}).unwrap();
    drop(store);let mut store=Store::new(dir.path()).unwrap();store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    assert!(store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:3,request_id:C.into(),profile:Profile::Standard}).is_err());
    assert!(store.pet_link_request(Request::Prepare{target:a,expected_revision:3,request_id:B.into(),profile:Profile::Standard}).is_ok());
}

#[test]
fn old_saved_run_without_recovery_fields_still_opens() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    let link=store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Light}).unwrap().unwrap();
    let mut value=serde_json::to_value(link).unwrap();
    let run=value["run"].as_object_mut().unwrap();run.remove("agentPath");run.remove("trackingClosed");run.remove("resultReturned");run.remove("runtimeCompleted");
    store.db.execute("UPDATE explicit_pet_links_v1 SET value=?1",[value.to_string()]).unwrap();
    drop(store);let mut store=Store::new(dir.path()).unwrap();
    let restored=store.pet_link_request(Request::Read{target:a}).unwrap().unwrap().run.unwrap();
    assert!(!restored.tracking_closed);assert!(restored.agent_path.is_none());assert_eq!(restored.state,RunState::Unknown);
    assert!(!restored.result_returned);assert!(!restored.runtime_completed);
}

#[test]
fn completion_requires_both_receipts_in_either_order_across_restart() {
    for profile in [Profile::Plan, Profile::Standard] {
        for runtime_first in [false, true] {
            let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
            store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
            store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:profile.clone()}).unwrap();
            let report=|receipt|Request::Report{target:a.clone(),expected_revision:1,request_id:C.into(),receipt};
            let (model,effort)=profile.settings();
            let runtime=|completed|Receipt::Runtime{parent_id:A.into(),child_id:B.into(),turn_id:C.into(),model:model.into(),effort:effort.into(),completed};
            let first=if runtime_first {runtime(true)} else {Receipt::Returned};
            let pending=store.pet_link_request(report(first)).unwrap().unwrap().run.unwrap();
            assert!(pending.unresolved());assert!(!pending.completion_confirmed());
            assert!(store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:B.into(),profile:profile.clone()}).is_err());
            drop(store);let mut store=Store::new(dir.path()).unwrap();
            store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
            let second=if runtime_first {Receipt::Returned} else {runtime(true)};
            let done=store.pet_link_request(report(second)).unwrap().unwrap().run.unwrap();
            let expected=if profile==Profile::Plan {RunState::Waiting} else {RunState::Complete};
            assert_eq!(done.state,expected);assert!(done.completion_confirmed());
            for duplicate in [Receipt::Returned,runtime(false),runtime(true)] {
                let run=store.pet_link_request(report(duplicate)).unwrap().unwrap().run.unwrap();
                assert_eq!(run.state,expected);assert!(run.completion_confirmed());
            }
            drop(store);let mut store=Store::new(dir.path()).unwrap();
            let restored=store.pet_link_request(Request::Read{target:a}).unwrap().unwrap().run.unwrap();
            assert_eq!(restored.state,expected);assert!(restored.completion_confirmed());
        }
    }
}

#[test]
fn legacy_terminal_record_without_return_evidence_is_not_confirmed() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    let link=store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Plan}).unwrap().unwrap();
    let mut value=serde_json::to_value(link).unwrap();
    value["run"]["state"]=serde_json::json!("waiting");
    value["run"]["observedModel"]=serde_json::json!("gpt-6-luna");
    value["run"]["observedEffort"]=serde_json::json!("low");
    let run=value["run"].as_object_mut().unwrap();run.remove("resultReturned");run.remove("runtimeCompleted");
    store.db.execute("UPDATE explicit_pet_links_v1 SET value=?1",[value.to_string()]).unwrap();
    drop(store);let mut store=Store::new(dir.path()).unwrap();
    let restored=store.pet_link_request(Request::Read{target:a}).unwrap().unwrap().run.unwrap();
    assert_eq!(restored.state,RunState::Unknown);assert!(restored.unresolved());
}

#[test]
fn returned_result_cannot_complete_mismatched_or_failed_execution() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:1,request_id:C.into(),profile:Profile::Light}).unwrap();
    let report=|receipt|Request::Report{target:a.clone(),expected_revision:1,request_id:C.into(),receipt};
    store.pet_link_request(report(Receipt::Runtime{parent_id:A.into(),child_id:B.into(),turn_id:C.into(),model:"gpt-6-sol".into(),effort:"low".into(),completed:true})).unwrap();
    let returned=store.pet_link_request(report(Receipt::Returned)).unwrap().unwrap().run.unwrap();
    assert_eq!(returned.state,RunState::Failed);assert!(!returned.completion_confirmed());
}

#[test]
fn service_disconnect_blocks_reports_and_keeps_pet_preferences() {
    let dir=tempfile::tempdir().unwrap();let a=target(dir.path(),A);let mut store=Store::new(dir.path()).unwrap();
    store.pet_link_request(Request::Connect{target:a.clone()}).unwrap();
    store.pet_link_request(Request::Settings{target:a.clone(),expected_revision:1,profile:Profile::Careful}).unwrap();
    store.pet_link_request(Request::Prepare{target:a.clone(),expected_revision:2,request_id:C.into(),profile:Profile::Careful}).unwrap();
    store.disconnect_setup("codex-windows-local").unwrap();
    let saved=store.pet_link_request(Request::Read{target:a.clone()}).unwrap().unwrap();
    assert!(!saved.connected);assert_eq!(saved.profile,Profile::Careful);assert_eq!(saved.run.unwrap().state,RunState::Unknown);
    assert!(store.pet_link_request(Request::Report{target:a,expected_revision:3,request_id:C.into(),receipt:Receipt::Returned}).is_err());
}
