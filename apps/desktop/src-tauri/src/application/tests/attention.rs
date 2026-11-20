use crate::application::store::Store;
use crate::domain::attention::{Cause, Evidence, Kind, Reason, Request, Source};
use crate::domain::pet_link::{Request as Link, Target};

const A: &str = "01a1d04a-16f2-7522-9ce2-b3a7b57e8791";
const B: &str = "01a1d04b-16f2-7522-9ce2-b3a7b57e8792";
const T1: &str = "01a1d04a-0000-7000-8000-000000000001";
const T2: &str = "01a1d04a-0000-7000-8000-000000000002";
const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
fn fp(n: u8) -> String { format!("{:064x}", n) }
fn target(path: &std::path::Path, id: &str) -> Target { Target { source_id: "codex-windows-local".into(), thread_id: id.into(), cwd: path.to_string_lossy().into() } }
fn call(store: &mut Store, input: Request) -> Result<serde_json::Value, String> {
    let s = &mut *store;
    let setup = s.setup_chat();
    s.attention.request(&s.pet_links, setup.as_ref(), input, crate::domain::activity::now_ms())
}
fn stop(session: &str, turn: &str, kind: Kind, reason: Reason, n: u8) -> Request {
    Request::Notify { session_id: session.into(), turn_id: turn.into(), source: Source::Stop, kind, reason, summary: "작업 계획을 정리했어. 이대로 진행할지 물어보고 있어.".into(),
        fingerprint: fp(n), chat_title: Some("학과 행사 페이지".into()), tool_key: None, tool_use_id: None,
        evidence: (kind == Kind::Completed).then(|| Evidence { file_changes: 1, work_commands: 0, verified: true }) }
}
fn permission(session: &str, turn: &str, n: u8) -> Request {
    Request::Notify { session_id: session.into(), turn_id: turn.into(), source: Source::Permission, kind: Kind::ActionRequired, reason: Reason::ApprovalRequired,
        summary: "명령 실행 승인을 기다리고 있어: node -v".into(), fingerprint: fp(n), chat_title: None, tool_key: Some(KEY.into()), tool_use_id: None, evidence: None }
}
fn resolve(session: &str, turn: &str, cause: Cause, key: Option<&str>, tool_use: Option<&str>) -> Request {
    Request::Resolve { session_id: session.into(), turn_id: turn.into(), cause, tool_key: key.map(Into::into), tool_use_id: tool_use.map(Into::into) }
}
fn connected(dir: &std::path::Path) -> Store {
    let mut store = Store::new(dir).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir, A) }).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir, B) }).unwrap();
    store
}

#[test]
fn a_chat_that_is_not_connected_gets_nothing_and_keeps_no_state() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    let check = call(&mut store, Request::Check { session_id: A.into() }).unwrap();
    assert_eq!(check["eligible"], false);
    assert_eq!(call(&mut store, stop(A, T1, Kind::ActionRequired, Reason::ConfirmationRequired, 1)).unwrap_err(), "chat-not-connected");
    assert_eq!(call(&mut store, resolve(A, T1, Cause::UserMessage, None, None)).unwrap()["resolved"], 0);
    assert!(store.snapshot().codex_attention.is_empty());
}

#[test]
fn a_question_shows_once_and_is_resolved_only_by_a_new_message_in_that_chat() {
    let dir = tempfile::tempdir().unwrap(); let mut store = connected(dir.path());
    assert_eq!(call(&mut store, Request::Check { session_id: A.into() }).unwrap()["eligible"], true);
    call(&mut store, stop(A, T1, Kind::ActionRequired, Reason::ConfirmationRequired, 1)).unwrap();
    // The same notice delivered twice (both apps, hook retry) is shown once.
    assert_eq!(call(&mut store, stop(A, T1, Kind::ActionRequired, Reason::ConfirmationRequired, 1)).unwrap()["duplicate"], true);
    let items = store.snapshot().codex_attention;
    assert_eq!(items.len(), 1); assert_eq!(items[0].target.thread_id, A); assert_eq!(items[0].chat_title.as_deref(), Some("학과 행사 페이지"));
    // Closing it in the pet only marks it read; Codex is still waiting.
    let id = items[0].id.clone();
    let s = &mut store; let setup = s.setup_chat();
    assert!(s.attention.mark_read(&s.pet_links, setup.as_ref(), &id, 5).unwrap().read);
    assert_eq!(store.snapshot().codex_attention.len(), 1);
    // Another chat writing does not touch A.
    call(&mut store, resolve(B, T2, Cause::UserMessage, None, None)).unwrap();
    assert_eq!(store.snapshot().codex_attention.len(), 1);
    // The user answers in A: resolved.
    assert_eq!(call(&mut store, resolve(A, T2, Cause::UserMessage, None, None)).unwrap()["resolved"], 1);
    assert!(store.snapshot().codex_attention.is_empty());
}

#[test]
fn an_approval_is_resolved_when_that_tool_runs_or_the_turn_ends_even_out_of_order() {
    let dir = tempfile::tempdir().unwrap(); let mut store = connected(dir.path());
    call(&mut store, permission(A, T1, 1)).unwrap();
    // A different tool finishing does not resolve it.
    call(&mut store, resolve(A, T1, Cause::ToolFinished, Some(&fp(9)), Some("exec-2"))).unwrap();
    assert_eq!(store.snapshot().codex_attention.len(), 1);
    call(&mut store, resolve(A, T1, Cause::ToolFinished, Some(KEY), Some("exec-1"))).unwrap();
    assert!(store.snapshot().codex_attention.is_empty());
    // Hooks are asynchronous: the tool can finish before the approval notice arrives.
    call(&mut store, resolve(A, T2, Cause::ToolFinished, Some(KEY), None)).unwrap();
    assert_eq!(call(&mut store, permission(A, T2, 2)).unwrap()["stale"], true);
    // A turn that ended has no pending prompt, but its own turn-end notice stays.
    let t3 = "01a1d04a-0000-7000-8000-000000000003";
    call(&mut store, permission(A, t3, 3)).unwrap();
    call(&mut store, Request::Notify { session_id: A.into(), turn_id: t3.into(), source: Source::UserInput, kind: Kind::ActionRequired, reason: Reason::Question,
        summary: "선택이 필요해".into(), fingerprint: fp(4), chat_title: None, tool_key: None, tool_use_id: Some("call_1".into()), evidence: None }).unwrap();
    call(&mut store, resolve(A, t3, Cause::ToolFinished, None, Some("call_1"))).unwrap();
    assert_eq!(store.snapshot().codex_attention.len(), 1);
    call(&mut store, resolve(A, t3, Cause::TurnEnded, None, None)).unwrap();
    call(&mut store, stop(A, t3, Kind::Completed, Reason::Completed, 5)).unwrap();
    let items = store.snapshot().codex_attention;
    assert_eq!(items.len(), 1); assert_eq!(items[0].kind, Kind::Completed);
}

#[test]
fn a_late_turn_end_from_an_answered_turn_is_dropped_and_a_new_turn_end_replaces_the_old_one() {
    let dir = tempfile::tempdir().unwrap(); let mut store = connected(dir.path());
    call(&mut store, resolve(A, T2, Cause::UserMessage, None, None)).unwrap();
    assert_eq!(call(&mut store, stop(A, T1, Kind::ActionRequired, Reason::Question, 1)).unwrap()["stale"], true);
    call(&mut store, stop(A, T2, Kind::ActionRequired, Reason::Question, 2)).unwrap();
    call(&mut store, stop(A, T2, Kind::Completed, Reason::Completed, 3)).unwrap();
    let items = store.snapshot().codex_attention;
    assert_eq!(items.len(), 1); assert_eq!(items[0].kind, Kind::Completed);
    // Two chats keep separate notices; action_required sorts first.
    call(&mut store, stop(B, T1, Kind::ActionRequired, Reason::Question, 4)).unwrap();
    let items = store.snapshot().codex_attention;
    assert_eq!(items.iter().map(|item| (item.target.thread_id.as_str(), item.kind)).collect::<Vec<_>>(), vec![(B, Kind::ActionRequired), (A, Kind::Completed)]);
}

#[test]
fn invalid_input_is_rejected_and_disconnecting_drops_the_chats_notices() {
    let dir = tempfile::tempdir().unwrap(); let mut store = connected(dir.path());
    let bad = |reason, source, kind, key: Option<&str>, summary: &str| Request::Notify { session_id: A.into(), turn_id: T1.into(), source, kind, reason, summary: summary.into(),
        fingerprint: fp(1), chat_title: None, tool_key: key.map(Into::into), tool_use_id: None, evidence: None };
    for input in [bad(Reason::Completed, Source::Stop, Kind::ActionRequired, None, "x"), bad(Reason::ApprovalRequired, Source::Permission, Kind::ActionRequired, None, "x"),
        bad(Reason::Question, Source::Stop, Kind::ActionRequired, None, ""), bad(Reason::Question, Source::Stop, Kind::ActionRequired, None, &"가".repeat(300)),
        bad(Reason::Question, Source::Stop, Kind::ActionRequired, None, "줄\n바꿈")] {
        assert_eq!(call(&mut store, input).unwrap_err(), "invalid-attention");
    }
    call(&mut store, stop(A, T1, Kind::ActionRequired, Reason::Question, 2)).unwrap();
    let revision = store.pet_links.values().find(|link| link.target.thread_id == A).unwrap().revision;
    store.pet_link_request(Link::Disconnect { target: target(dir.path(), A), expected_revision: revision }).unwrap();
    assert!(store.snapshot().codex_attention.is_empty());
}

#[test]
fn the_setup_chat_stays_eligible_when_its_saved_link_comes_back_disconnected_after_a_restart() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    store.begin_setup(crate::application::setup::SetupRequest { installed_version: env!("CARGO_PKG_VERSION").into(), session_id: Some(A.into()),
        cwd: Some(dir.path().to_string_lossy().into()), host_id: Some("codex-windows-local".into()), entry_point: Some("ai".into()), connection_mode: Some("explicit-pet".into()) }).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir.path(), A) }).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir.path(), B) }).unwrap();
    // The app restarts: saved links load disconnected.
    store.init_pet_links().unwrap();
    assert!(store.pet_links.values().all(|link| !link.connected));
    assert_eq!(call(&mut store, Request::Check { session_id: A.into() }).unwrap()["eligible"], true);
    assert_eq!(call(&mut store, Request::Check { session_id: B.into() }).unwrap()["eligible"], false);
    call(&mut store, stop(A, T1, Kind::ActionRequired, Reason::ConfirmationRequired, 1)).unwrap();
    assert_eq!(store.snapshot().codex_attention.len(), 1);
}

#[test]
fn diagnostics_report_ids_and_states_but_no_notice_text_and_record_where_the_pet_drew_it() {
    let dir = tempfile::tempdir().unwrap(); let mut store = connected(dir.path());
    call(&mut store, stop(A, T1, Kind::Completed, Reason::Completed, 1)).unwrap();
    let id = store.snapshot().codex_attention[0].id.clone();
    assert!(store.attention.mark_displayed(&id, "elsewhere", 1).is_err());
    store.attention.mark_displayed(&id, "handle", 7).unwrap();
    let status = call(&mut store, Request::Status {}).unwrap();
    let text = status.to_string();
    assert!(!text.contains("작업 계획") && !text.contains("학과 행사"), "no notice text or chat title");
    assert_eq!(status["notices"][0]["displayedOn"], "handle");
    assert_eq!(status["notices"][0]["kind"], "completed");
    assert_eq!(status["links"].as_array().unwrap().len(), 2);
}
