use crate::{application::store::Store, domain::pet_link::*};
fn target(path:&std::path::Path,id:&str)->Target {Target{source_id:"codex-windows-local".into(),thread_id:id.into(),cwd:path.to_string_lossy().into()}}
const A:&str="01a0d905-55a5-7061-9d60-151ed3d2b5f3";
const B:&str="01a0d905-d514-7d31-b05e-02630a284ccb";
const C:&str="01a0de13-1b09-7fa0-86e0-35f69dbbc6a8";
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
