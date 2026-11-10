use crate::application::store::Store;
use crate::domain::pet_link::{Profile, Request as Link, Target};
use crate::domain::recommendation::{active_pet_ids, Candidate, Request, Response, State, PREPARING_TTL_MS};

const A: &str = "11111111-1111-4111-8111-111111111111";
const B: &str = "22222222-2222-4222-8222-222222222222";
const RUN: &str = "33333333-3333-4333-8333-333333333333";
const FP1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const FP2: &str = "2222222222222222222222222222222222222222222222222222222222222222";
fn target(path: &std::path::Path, id: &str) -> Target { Target { source_id: "codex-windows-local".into(), thread_id: id.into(), cwd: path.to_string_lossy().into() } }
fn clock(offset: u64) -> u64 { crate::domain::activity::now_ms() + offset }
fn candidate(id: &str) -> Candidate { Candidate { pet_id: id.into(), reason: "여행 일정을 계획하는 작업이네요.".into(), cues: vec!["2박 3일".into()] } }
fn begin(store: &mut Store, session: &str, turn: &str, now: u64) -> serde_json::Value {
    let cwd = store.data_dir.to_string_lossy().into_owned();
    let s = &mut *store;
    s.recommendations.request(&s.pet_links, s.setup_chat().as_ref(), Request::Begin { session_id: session.into(), turn_id: turn.into(), cwd, source: crate::domain::recommendation::Source::Hook }, clock(now)).unwrap()
}
fn offer(store: &mut Store, session: &str, turn: &str, fingerprint: &str, candidates: Vec<Candidate>, now: u64) -> Result<serde_json::Value, String> {
    let s = &mut *store;
    s.recommendations.request(&s.pet_links, s.setup_chat().as_ref(), Request::Offer { session_id: session.into(), turn_id: turn.into(), request: "부산 2박 3일 여행 일정 짜줘".into(), request_truncated: false, fingerprint: fingerprint.into(), candidates }, clock(now))
}
fn respond(store: &mut Store, id: &str, response: Response) -> Result<State, String> {
    let s = &mut *store;
    s.recommendations.respond(&s.pet_links, s.setup_chat().as_ref(), id, response, 10).map(|item| item.state)
}

#[test]
fn only_connected_chats_receive_recommendations_and_text_is_not_kept_otherwise() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    let result = begin(&mut store, A, "turn-1", 1);
    assert_eq!(result["eligible"], false); assert_eq!(result["reason"], "chat-not-connected");
    assert!(offer(&mut store, A, "turn-1", FP1, vec![candidate("travel-plan")], 2).is_err());
    assert!(store.snapshot().pet_recommendations.is_empty());
}

#[test]
fn a_submitted_request_moves_from_preparing_to_shown_once_and_stays_in_its_chat() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir.path(), A) }).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir.path(), B) }).unwrap();
    let started = begin(&mut store, A, "turn-1", 1);
    assert_eq!(started["eligible"], true);
    let active = store.pet_links.values().find(|link| link.target.thread_id == A).map(active_pet_ids).unwrap();
    assert_eq!(started["activePetIds"], serde_json::json!(active));
    assert_eq!(store.snapshot().pet_recommendations[0].state, State::Preparing);
    // Another chat's turn can neither fill nor see A's recommendation.
    assert!(offer(&mut store, B, "turn-1", FP1, vec![candidate("travel-plan")], 2).is_err());
    assert_eq!(offer(&mut store, A, "turn-1", FP1, vec![candidate("travel-plan"), candidate("presentation")], 2).unwrap()["duplicate"], false);
    let items = store.snapshot().pet_recommendations;
    assert_eq!(items.len(), 1); assert_eq!(items[0].target.thread_id, A); assert_eq!(items[0].state, State::Shown);
    assert_eq!(items[0].request.as_deref(), Some("부산 2박 3일 여행 일정 짜줘")); assert_eq!(items[0].candidates.len(), 2);
    // The same turn delivered twice (hook retry) creates no second card.
    assert_eq!(begin(&mut store, A, "turn-1", 3)["reason"], "duplicate-turn");
    assert_eq!(store.snapshot().pet_recommendations.len(), 1);
    // The same request text in a new turn is not recommended again.
    begin(&mut store, A, "turn-2", 4);
    assert_eq!(offer(&mut store, A, "turn-2", FP1, vec![candidate("travel-plan")], 5).unwrap()["duplicate"], true);
    assert!(store.snapshot().pet_recommendations.is_empty());
}

#[test]
fn a_message_without_a_fitting_pet_clears_the_card_and_stale_preparing_expires() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir.path(), A) }).unwrap();
    begin(&mut store, A, "turn-1", 1); offer(&mut store, A, "turn-1", FP1, vec![candidate("travel-plan")], 2).unwrap();
    begin(&mut store, A, "turn-2", 3);
    let s = &mut store; s.recommendations.request(&s.pet_links, s.setup_chat().as_ref(), Request::Clear { session_id: A.into(), turn_id: "turn-2".into() }, 4).unwrap();
    assert!(store.snapshot().pet_recommendations.is_empty());
    begin(&mut store, A, "turn-3", 0);
    assert!(store.recommendations.snapshot(&store.pet_links, store.setup_chat().as_ref(), clock(PREPARING_TTL_MS + 1000)).is_empty());
}

#[test]
fn accepting_opens_only_offered_or_explicitly_chosen_pets_and_running_follows_a_new_pet_task() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    let a = target(dir.path(), A);
    store.pet_link_request(Link::Connect { target: a.clone() }).unwrap();
    let current = active_pet_ids(store.pet_links.values().next().unwrap());
    let pet = current.first().cloned().unwrap_or_else(|| "ui-webpage".into());
    begin(&mut store, A, "turn-1", 1);
    offer(&mut store, A, "turn-1", FP1, vec![candidate(&pet)], 2).unwrap();
    let id = store.snapshot().pet_recommendations[0].id.clone();
    assert!(respond(&mut store, &id, Response::Accept { pet_id: "not-a-pet".into(), other: true }).is_err());
    assert!(respond(&mut store, &id, Response::Accept { pet_id: "marketing-copy".into(), other: false }).is_err());
    assert_eq!(respond(&mut store, &id, Response::Accept { pet_id: pet.clone(), other: false }).unwrap(), State::Accepted);
    assert_eq!(store.snapshot().pet_recommendations[0].state, State::Accepted);
    // No AI work was started by accepting.
    assert!(store.pet_links.values().next().unwrap().run.is_none());
    // The user then asks in the chat and the pet task starts.
    store.pet_link_request(Link::Prepare { target: a, expected_revision: 1, request_id: RUN.into(), profile: Profile::Light }).unwrap();
    if !current.is_empty() { assert_eq!(store.snapshot().pet_recommendations[0].state, State::Running); }
    // While the pet task is unresolved, new messages are not re-recommended.
    assert_eq!(begin(&mut store, A, "turn-2", 5)["reason"], "pet-task-in-progress");
}

#[test]
fn dismiss_other_pet_and_disconnect_are_handled_without_touching_the_chat() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    let a = target(dir.path(), A);
    store.pet_link_request(Link::Connect { target: a.clone() }).unwrap();
    begin(&mut store, A, "turn-1", 1); offer(&mut store, A, "turn-1", FP1, vec![candidate("travel-plan")], 2).unwrap();
    let id = store.snapshot().pet_recommendations[0].id.clone();
    assert_eq!(respond(&mut store, &id, Response::Dismiss).unwrap(), State::Dismissed);
    assert!(respond(&mut store, &id, Response::Accept { pet_id: "travel-plan".into(), other: false }).is_err());
    begin(&mut store, A, "turn-2", 3); offer(&mut store, A, "turn-2", FP2, vec![candidate("travel-plan")], 4).unwrap();
    let id = store.snapshot().pet_recommendations[0].id.clone();
    assert_eq!(respond(&mut store, &id, Response::Accept { pet_id: "study-helper".into(), other: true }).unwrap(), State::Accepted);
    store.pet_link_request(Link::Disconnect { target: a, expected_revision: 1 }).unwrap();
    assert!(store.snapshot().pet_recommendations.is_empty());
}

#[test]
fn malformed_offers_are_rejected() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    store.pet_link_request(Link::Connect { target: target(dir.path(), A) }).unwrap();
    begin(&mut store, A, "turn-1", 1);
    for candidates in [vec![], vec![candidate("unknown-pet")], vec![candidate("travel-plan"), candidate("travel-plan")],
        vec![candidate("travel-plan"), candidate("presentation"), candidate("study-helper")]] {
        assert_eq!(offer(&mut store, A, "turn-1", FP1, candidates, 2).unwrap_err(), "invalid-recommendation");
    }
    assert_eq!(offer(&mut store, A, "turn-1", "short", vec![candidate("travel-plan")], 2).unwrap_err(), "invalid-recommendation");
    let s = &mut store;
    let control = s.recommendations.request(&s.pet_links, s.setup_chat().as_ref(), Request::Offer { session_id: A.into(), turn_id: "turn-1".into(), request: "a\u{0007}b".into(), request_truncated: false, fingerprint: FP1.into(), candidates: vec![candidate("travel-plan")] }, 2);
    assert!(control.is_err());
    let s = &mut store;
    assert!(s.recommendations.request(&s.pet_links, s.setup_chat().as_ref(), Request::Begin { session_id: "not-a-uuid".into(), turn_id: "t".into(), cwd: "C:\\x".into(), source: crate::domain::recommendation::Source::Hook }, 1).is_err());
}

#[test]
fn disabled_help_is_not_eligible() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    let a = target(dir.path(), A);
    store.pet_link_request(Link::Connect { target: a.clone() }).unwrap();
    store.pet_link_request(Link::Enable { target: a, expected_revision: 1, enabled: false }).unwrap();
    assert_eq!(begin(&mut store, A, "turn-1", 1)["reason"], "pet-help-disabled");
}

#[test]
fn the_chat_waiting_after_autopets_setup_gets_recommendations_until_disconnect() {
    let dir = tempfile::tempdir().unwrap(); let mut store = Store::new(dir.path()).unwrap();
    // `$autopets` in chat A: the app waits for a pet ("채팅 연결 대기"); no link exists yet.
    store.begin_setup(crate::application::setup::SetupRequest { installed_version: env!("CARGO_PKG_VERSION").into(), session_id: Some(A.into()),
        cwd: Some(dir.path().to_string_lossy().into()), host_id: Some("codex-windows-local".into()), entry_point: Some("ai".into()), connection_mode: Some("explicit-pet".into()) }).unwrap();
    assert_eq!(store.setup_status().unwrap()["phase"], "connecting");
    assert!(store.pet_links.is_empty());
    let started = begin(&mut store, A, "turn-1", 1);
    assert_eq!(started["eligible"], true); assert_eq!(started["slot"], serde_json::Value::Null); assert_eq!(started["activePetIds"], serde_json::json!([]));
    // Another chat is still not eligible.
    assert_eq!(begin(&mut store, B, "turn-1", 1)["reason"], "chat-not-connected");
    offer(&mut store, A, "turn-1", FP1, vec![candidate("presentation")], 2).unwrap();
    let items = store.snapshot().pet_recommendations;
    assert_eq!(items.len(), 1); assert_eq!(items[0].target.thread_id, A); assert_eq!(items[0].state, State::Shown);
    let id = items[0].id.clone();
    assert_eq!(respond(&mut store, &id, Response::Accept { pet_id: "presentation".into(), other: false }).unwrap(), State::Accepted);
    // Disconnecting the setup removes the card and stops recommendations for that chat.
    store.disconnect_setup("codex-windows-local").unwrap();
    assert!(store.snapshot().pet_recommendations.is_empty());
    assert_eq!(begin(&mut store, A, "turn-2", 3)["reason"], "chat-not-connected");
}
