use crate::{application::store::Store, domain::{pet_link::*, review::*, roles::Template}};

const A: &str = "11111111-1111-4111-8111-111111111111";
const B: &str = "22222222-2222-4222-8222-222222222222";
fn target(path: &std::path::Path, id: &str) -> Target {
    Target { source_id: "codex-windows-local".into(), thread_id: id.into(), cwd: path.to_string_lossy().into() }
}
fn review_template() -> Template {
    let catalog: serde_json::Value = serde_json::from_str(include_str!("../../../../../../packages/contracts/data/pet-catalog.json")).unwrap();
    let entry = catalog.as_array().unwrap().iter().find(|e| e["id"] == "review-helper").unwrap();
    let template: Template = serde_json::from_value(entry["template"].clone()).unwrap();
    template.validate().unwrap();
    template
}
/// A connected chat whose pet is 복습 도우미 (the template is set directly; the pet link flow is tested elsewhere).
fn review_chat(store: &mut Store, target: &Target) {
    store.pet_link_request(Request::Connect { target: target.clone() }).unwrap();
    store.pet_links.get_mut(&target.key()).unwrap().template = review_template();
}
fn card(question: &str, correct: bool) -> NewCard {
    NewCard { question: question.into(), choices: vec!["하나".into(), "둘".into(), "셋".into(), "넷".into()], answer: 3,
        explanation: "셋이 정답인 이유".into(), topic: "숫자".into(), correct }
}
const DAY: u64 = 86_400_000;

#[test]
fn review_chats_cannot_read_grade_or_extend_each_others_batches() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (target(dir.path(), A), target(dir.path(), B));
    let mut store = Store::new(dir.path()).unwrap();
    review_chat(&mut store, &a); review_chat(&mut store, &b);
    let now = crate::domain::activity::now_ms();
    let saved = store.save_review_cards(&a, SaveTo::New("채팅 A".into()), vec![card("A의 문제", false)], now).unwrap();
    let batch = saved["batch"]["id"].as_str().unwrap();
    let id = store.review_cards[0].id.clone();
    let tomorrow = now + DAY;
    assert!(store.review_due(&b, None, false, tomorrow).unwrap()["cards"].as_array().unwrap().is_empty());
    assert_eq!(store.review_due(&b, Some(batch), true, tomorrow).unwrap_err(), "review-batch-not-found");
    assert_eq!(store.save_review_cards(&b, SaveTo::Batch(batch.into()), vec![card("B의 문제", true)], tomorrow).unwrap_err(), "review-batch-not-found");
    assert_eq!(store.record_review_results(&b, vec![ReviewResult { id: id.clone(), correct: true }], None, false, tomorrow).unwrap_err(), "review-card-not-due");
    let due = store.review_summary(tomorrow);
    assert_eq!(due.due_by_thread.get(A), Some(&1));
    assert!(!due.due_by_thread.contains_key(B));
    assert_eq!(store.review_cards.len(), 1); assert_eq!(store.review_batches.len(), 1);
    assert!(!store.review_cards[0].last_correct);
    assert_eq!(store.review_due(&a, Some(batch), true, tomorrow).unwrap()["cards"][0]["id"], id);
}

#[test]
fn only_a_review_pet_chat_saves_cards_and_they_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (target(dir.path(), A), target(dir.path(), B));
    let mut store = Store::new(dir.path()).unwrap();
    review_chat(&mut store, &a);
    store.pet_link_request(Request::Connect { target: b.clone() }).unwrap();
    let now = crate::domain::activity::now_ms();
    assert_eq!(store.save_review_cards(&b, SaveTo::New("덧셈".into()), vec![card("문제", true)], now).unwrap_err(), "not-review-pet");
    let unknown = target(dir.path(), "33333333-3333-4333-8333-333333333333");
    assert_eq!(store.save_review_cards(&unknown, SaveTo::New("덧셈".into()), vec![card("문제", true)], now).unwrap_err(), "pet-not-connected");
    assert_eq!(store.save_review_cards(&a, SaveTo::New("덧셈".into()), vec![], now).unwrap_err(), "invalid-review-card");
    assert_eq!(store.save_review_cards(&a, SaveTo::New("덧셈".into()), (0..=CARDS_PER_SAVE).map(|i| card(&format!("문제 {i}"), true)).collect(), now).unwrap_err(), "invalid-review-card");
    assert_eq!(store.save_review_cards(&a, SaveTo::New(" ".into()), vec![card("문제", true)], now).unwrap_err(), "invalid-review-batch");
    assert!(store.review_cards.is_empty() && store.review_batches.is_empty(), "nothing saved by a refused request");

    let saved = store.save_review_cards(&a, SaveTo::New("숫자 세기".into()), vec![card("맞힌 문제", true), card("틀린 문제", false), card("또 맞힌 문제", true)], now).unwrap();
    assert_eq!(saved["saved"], 3);
    assert_eq!(saved["batch"]["name"], "숫자 세기");
    assert_eq!(saved["nextReviewDays"], 1, "the wrong one comes back tomorrow");
    assert!(store.review_cards.iter().all(|c| c.thread_id == A && c.batch_id == saved["batch"]["id"]));
    assert_eq!(store.review_batches.len(), 1);
    assert_eq!(store.review_batches[0].thread_id, A);
    assert_eq!(store.snapshot().review, Summary { due: 0, total: 3, batches: 1, notified_today: false, due_by_thread: Default::default() });

    drop(store);
    let reopened = Store::new(dir.path()).unwrap();
    assert_eq!(reopened.review_cards.len(), 3);
    assert_eq!(reopened.review_batches.len(), 1);
    assert_eq!(reopened.review_summary(now + DAY).due, 1);
    // Only the cards and their batches are kept: no chat text or other table is written.
    let tables: Vec<String> = reopened.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'review_%'").unwrap()
        .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(tables.len(), 3, "{tables:?}");
}

#[test]
fn a_review_records_only_todays_cards_and_counts_toward_the_daily_limit() {
    let dir = tempfile::tempdir().unwrap();
    let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    review_chat(&mut store, &a);
    let now = crate::domain::activity::now_ms();
    store.save_review_cards(&a, SaveTo::New("숫자".into()), vec![card("틀린 문제", false), card("맞힌 문제", true)], now).unwrap();
    let tomorrow = now + DAY;
    let due = store.review_due(&a, None, false, tomorrow).unwrap();
    let cards = due["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["lastCorrect"], false);
    assert_eq!(cards[0]["answer"], 3);
    let id = cards[0]["id"].as_str().unwrap().to_owned();
    let other = store.review_cards.iter().find(|c| c.id != id).unwrap().id.clone();

    assert_eq!(store.record_review_results(&a, vec![ReviewResult { id: other, correct: true }], None, false, tomorrow).unwrap_err(), "review-card-not-due");
    assert_eq!(store.record_review_results(&a, vec![ReviewResult { id: id.clone(), correct: true }, ReviewResult { id: id.clone(), correct: true }], None, false, tomorrow).unwrap_err(), "review-card-not-due");
    let result = store.record_review_results(&a, vec![ReviewResult { id: id.clone(), correct: true }], None, false, tomorrow).unwrap();
    assert_eq!(result["reviewed"], 1);
    assert_eq!(result["remainingToday"], 0);
    assert_eq!(result["wrong"], 0);
    assert!(result["nextReviewDays"].as_i64().unwrap() >= 1);
    let reviewed = store.review_cards.iter().find(|c| c.id == id).unwrap();
    assert!(reviewed.last_correct && reviewed.reviewed_at == Some(tomorrow));
    assert_eq!(reviewed_today(&store.review_cards, tomorrow, local_offset()), 1);
}

#[test]
fn the_notice_shows_once_a_day_and_deleting_a_card_keeps_the_others() {
    let dir = tempfile::tempdir().unwrap();
    let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    review_chat(&mut store, &a);
    let now = crate::domain::activity::now_ms();
    assert!(store.mark_review_notice(now).unwrap());
    assert!(!store.mark_review_notice(now).unwrap());
    assert!(store.review_summary(now).notified_today);
    assert!(!store.review_summary(now + DAY).notified_today);
    assert!(store.mark_review_notice(now + DAY).unwrap());

    let saved = store.save_review_cards(&a, SaveTo::New("순서".into()), vec![card("첫째", true), card("둘째", false)], now).unwrap();
    let batch = saved["batch"]["id"].as_str().unwrap().to_owned();
    let first = store.review_cards[0].id.clone();
    assert_eq!(store.delete_review_card("missing").unwrap_err(), "review-card-not-found");
    assert!(!store.delete_review_card(&first).unwrap(), "the batch still has a card");
    let view = store.review_batch_view(&batch, now).unwrap();
    assert_eq!(view["cards"].as_array().unwrap().len(), 1);
    assert_eq!(view["cards"][0]["answer"], "셋");
    drop(store);
    let mut store = Store::new(dir.path()).unwrap();
    assert_eq!(store.review_cards.len(), 1);
    // The last card takes its batch with it.
    let last = store.review_cards[0].id.clone();
    assert!(store.delete_review_card(&last).unwrap());
    assert!(store.review_batches.is_empty());
    assert_eq!(store.review_batch_view(&batch, now).unwrap_err(), "review-batch-not-found");
    drop(store);
    assert!(Store::new(dir.path()).unwrap().review_batches.is_empty());
}

#[test]
fn adding_the_review_tables_preserves_an_existing_database() {
    let dir = tempfile::tempdir().unwrap();
    let a = target(dir.path(), A);
    {
        let mut store = Store::new(dir.path()).unwrap();
        store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
        // An older app's database: no review tables yet.
        store.db.execute_batch("DROP TABLE review_cards_v1; DROP TABLE review_batches_v1; DROP TABLE review_meta_v1; CREATE TABLE sentinel_v1 (value TEXT); INSERT INTO sentinel_v1 VALUES ('kept')").unwrap();
    }
    let store = Store::new(dir.path()).unwrap();
    assert_eq!(store.db.query_row("SELECT value FROM sentinel_v1", [], |r| r.get::<_, String>(0)).unwrap(), "kept");
    assert_eq!(store.pet_links.len(), 1);
    assert!(store.review_cards.is_empty());
    // A card row this version cannot read is left in place, not deleted.
    store.db.execute("INSERT INTO review_cards_v1(id,value) VALUES('future','{\"version\":3}')", []).unwrap();
    drop(store);
    let store = Store::new(dir.path()).unwrap();
    assert!(store.review_cards.is_empty());
    assert_eq!(store.db.query_row("SELECT count(*) FROM review_cards_v1", [], |r| r.get::<_, u32>(0)).unwrap(), 1);
}

/// A card as the version without batches wrote it (`version` 1, no `batchId`).
fn version_one(card: &Card) -> String {
    let mut value = serde_json::to_value(card).unwrap();
    value["version"] = 1.into();
    value.as_object_mut().unwrap().remove("batchId");
    value.to_string()
}

#[test]
fn cards_saved_before_batches_move_into_one_batch_per_save() {
    let dir = tempfile::tempdir().unwrap();
    let a = target(dir.path(), A);
    let now = crate::domain::activity::now_ms();
    {
        let store = Store::new(dir.path()).unwrap();
        // Two saves in chat A (different times) and one in chat B at the same time as the first.
        let rows = [(A, now, "가", "광고"), (A, now, "나", "PR"), (A, now + 60_000, "다", "광고"), (B, now, "라", "광고")];
        for (thread, at, question, topic) in rows {
            let mut made = make_card(card(question, true), thread, "", at);
            made.topic = topic.into();
            store.db.execute("INSERT INTO review_cards_v1(id,value) VALUES(?1,?2)", rusqlite::params![made.id, version_one(&made)]).unwrap();
        }
    }
    let mut store = Store::new(dir.path()).unwrap();
    assert_eq!(store.review_cards.len(), 4, "no card is dropped");
    assert_eq!(store.review_batches.len(), 3);
    let name = |thread: &str, at: u64| store.review_batches.iter().find(|x| x.thread_id == thread && x.created_at == at).unwrap().name.clone();
    let mut first: Vec<String> = name(A, now).split(" · ").map(String::from).collect();
    first.sort();
    assert_eq!(first, ["PR", "광고"], "named after what they ask");
    assert_eq!((name(A, now + 60_000), name(B, now)), ("광고".into(), "광고".into()));
    let count = |thread: &str, at: u64| {
        let batch = store.review_batches.iter().find(|x| x.thread_id == thread && x.created_at == at).unwrap();
        store.review_cards.iter().filter(|c| c.batch_id == batch.id).count()
    };
    assert_eq!((count(A, now), count(A, now + 60_000), count(B, now)), (2, 1, 1));
    // Written back as version 2; reopening moves nothing again.
    let versions: Vec<String> = store.db.prepare("SELECT value FROM review_cards_v1").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert!(versions.iter().all(|row| serde_json::from_str::<Card>(row).unwrap().version == CARD_VERSION));
    let ids: Vec<String> = store.review_batches.iter().map(|x| x.id.clone()).collect();
    drop(store);
    store = Store::new(dir.path()).unwrap();
    assert_eq!(store.review_batches.iter().map(|x| x.id.clone()).collect::<Vec<_>>(), ids);
    // Old cards still review and save as before.
    review_chat(&mut store, &a);
    assert_eq!(store.review_summary(now + 10 * DAY).due, 4);
    // A batch an earlier build named "이전에 저장한 문제" is renamed after its topics, once.
    let old = store.review_batches[0].clone();
    store.db.execute("UPDATE review_batches_v1 SET value=?2 WHERE id=?1", rusqlite::params![old.id, serde_json::to_string(&Batch { name: LEGACY_BATCH_NAME.into(), ..old.clone() }).unwrap()]).unwrap();
    drop(store);
    let store = Store::new(dir.path()).unwrap();
    assert_eq!(store.review_batches.iter().find(|x| x.id == old.id).unwrap().name, old.name);
    assert_eq!(store.review_batch_view(&old.id, now).unwrap()["topics"], serde_json::json!(old.name.split(" · ").collect::<Vec<_>>()));
}

#[test]
fn the_batch_page_shows_counts_scores_and_today_first() {
    let dir = tempfile::tempdir().unwrap();
    let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    review_chat(&mut store, &a);
    let now = crate::domain::activity::now_ms();
    let right = store.save_review_cards(&a, SaveTo::New("다 맞힘".into()), vec![card("일", true), card("이", true)], now - 1).unwrap()["batch"]["id"].as_str().unwrap().to_owned();
    let mixed = store.save_review_cards(&a, SaveTo::New("하나 틀림".into()), vec![card("삼", true), card("사", false), card("오", true)], now).unwrap()["batch"]["id"].as_str().unwrap().to_owned();
    let today = store.review_batches_view(now);
    assert_eq!(today.as_array().unwrap().len(), 2);
    // Nothing due today: the nearest review day first (the wrong answer is tomorrow).
    assert_eq!(today[0]["id"], mixed.as_str());
    assert_eq!((today[0]["count"].as_u64(), today[0]["correct"].as_u64(), today[0]["due"].as_u64(), today[0]["nextReviewDays"].as_i64()), (Some(3), Some(2), Some(0), Some(1)));
    assert_eq!(today[0]["name"], "하나 틀림");
    assert_eq!(today[1]["id"], right.as_str());
    assert!(today[1]["nextReviewDays"].as_i64().unwrap() > 1);
    // Tomorrow the wrong one is due: "오늘 1".
    let tomorrow = store.review_batches_view(now + DAY);
    assert_eq!((tomorrow[0]["id"].as_str(), tomorrow[0]["due"].as_u64(), tomorrow[0]["nextReviewDays"].as_i64()), (Some(mixed.as_str()), Some(1), Some(0)));
    let page = store.review_batch_view(&mixed, now + DAY).unwrap();
    assert_eq!(page["cards"][0]["question"], "사", "today's question first");
    assert_eq!(page["cards"][0]["nextReviewDays"], 0);
    assert_eq!(store.review_batch_due(&mixed, now + DAY).unwrap().1, 1);
    assert_eq!(store.review_batch_view("zzzzzzzz", now).unwrap_err(), "review-batch-not-found");
    // Deleting a batch takes its cards and leaves the other batch alone.
    store.delete_review_batch(&mixed).unwrap();
    assert_eq!(store.review_cards.len(), 2);
    assert_eq!(store.review_batches.len(), 1);
    assert_eq!(store.delete_review_batch(&mixed).unwrap_err(), "review-batch-not-found");
    drop(store);
    let store = Store::new(dir.path()).unwrap();
    assert_eq!((store.review_cards.len(), store.review_batches.len()), (2, 1));
}

#[test]
fn a_batch_review_and_a_full_redo_record_only_that_batch() {
    let dir = tempfile::tempdir().unwrap();
    let a = target(dir.path(), A);
    let mut store = Store::new(dir.path()).unwrap();
    review_chat(&mut store, &a);
    let now = crate::domain::activity::now_ms();
    let one = store.save_review_cards(&a, SaveTo::New("첫 묶음".into()), vec![card("틀림", false), card("맞음", true)], now).unwrap()["batch"]["id"].as_str().unwrap().to_owned();
    let two = store.save_review_cards(&a, SaveTo::New("둘째 묶음".into()), vec![card("또 틀림", false)], now).unwrap()["batch"]["id"].as_str().unwrap().to_owned();
    let tomorrow = now + DAY;
    // That batch's part of today's list.
    let due = store.review_due(&a, Some(&one), false, tomorrow).unwrap();
    assert_eq!(due["batch"]["name"], "첫 묶음");
    assert_eq!(due["cards"].as_array().unwrap().len(), 1);
    assert_eq!(due["cards"][0]["question"], "틀림");
    assert_eq!(store.review_due(&a, None, false, tomorrow).unwrap()["cards"].as_array().unwrap().len(), 2, "the pet's 복습하기: every batch");
    assert_eq!(store.review_due(&a, Some("ffffffff"), false, tomorrow).unwrap_err(), "review-batch-not-found");
    assert_eq!(store.review_due(&a, None, true, tomorrow).unwrap_err(), "review-batch-not-found", "all needs a batch");
    let other = store.review_cards.iter().find(|c| c.batch_id == two).unwrap().id.clone();
    assert_eq!(store.record_review_results(&a, vec![ReviewResult { id: other, correct: true }], Some(&one), false, tomorrow).unwrap_err(), "review-card-not-due", "another batch's card");

    // 전체 다시 풀기: every card of the batch, wrong ones first.
    let all = store.review_due(&a, Some(&one), true, tomorrow).unwrap();
    let cards = all["cards"].as_array().unwrap();
    assert_eq!(cards.iter().map(|c| c["question"].as_str().unwrap()).collect::<Vec<_>>(), ["틀림", "맞음"]);
    let id = |i: usize| cards[i]["id"].as_str().unwrap().to_owned();
    let before = store.review_cards.iter().find(|c| c.id == id(1)).unwrap().schedule.clone();
    let result = store.record_review_results(&a, vec![ReviewResult { id: id(0), correct: true }, ReviewResult { id: id(1), correct: false }], Some(&one), true, tomorrow).unwrap();
    assert_eq!((result["reviewed"].as_u64(), result["correct"].as_u64(), result["wrong"].as_u64()), (Some(2), Some(1), Some(1)));
    let after = |i: usize| store.review_cards.iter().find(|c| c.id == id(i)).unwrap().clone();
    assert!(after(0).last_correct && after(0).reviewed_at == Some(tomorrow), "the due card is reviewed as usual");
    assert!(!after(1).last_correct && after(1).reviewed_at.is_none(), "the early one does not use the daily limit");
    assert_ne!(after(1).schedule, before);
    assert_eq!(days_until(&after(1), tomorrow, local_offset()), 1, "wrong: back tomorrow");
    assert_eq!(reviewed_today(&store.review_cards, tomorrow, local_offset()), 1);
    let page = store.review_batch_view(&one, tomorrow).unwrap();
    assert_eq!(page["correct"], 1, "지난번 1/2");

    // A batch review may add questions on the same topics: they join that batch.
    let added = store.save_review_cards(&a, SaveTo::Batch(one.clone()), vec![card("새 문제", true)], tomorrow).unwrap();
    assert_eq!((added["saved"].as_u64(), added["batch"]["id"].as_str()), (Some(1), Some(one.as_str())));
    assert_eq!(store.review_batches.len(), 2, "no new batch");
    assert_eq!(store.review_batch_view(&one, tomorrow).unwrap()["count"], 3);
    assert_eq!(store.save_review_cards(&a, SaveTo::Batch("ffffffff".into()), vec![card("또", true)], tomorrow).unwrap_err(), "review-batch-not-found");
}
