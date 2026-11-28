//! 복습 도우미 question cards and their batches. Only the cards (question, four choices, the answer,
//! a one-line explanation, a topic and the last result) and the batch they were made in (one
//! "문제 내기": a short name, the day and the chat id) are kept, never the chat itself. The next
//! review day is computed per card with FSRS (`rs-fsrs`, long-term scheduler, no AI): a correct
//! answer is rated Good, a wrong one Again. What a batch shows is computed from its cards.
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

pub const MAX_CARDS: usize = 500;
/// One quiz, saved as one batch: 10 questions by default, fewer (at least 3) when little was studied.
pub const CARDS_PER_SAVE: usize = 10;
pub const CARD_VERSION: u8 = 2;
/// The name of a batch made from cards saved before batches existed.
pub const LEGACY_BATCH_NAME: &str = "이전에 저장한 문제";
const MAX_BATCH_NAME: usize = 40;
pub const DAILY_LIMIT: usize = 10;
const MAX_QUESTION: usize = 300;
const MAX_CHOICE: usize = 120;
const MAX_EXPLANATION: usize = 200;
const MAX_TOPIC: usize = 40;

/// A card as the skill script sends it, right after the user answered it once.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewCard {
    pub question: String,
    pub choices: Vec<String>,
    pub answer: u8,
    pub explanation: String,
    pub topic: String,
    pub correct: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewResult { pub id: String, pub correct: bool }

/// FSRS memory state, stored as plain fields so saved cards never depend on the crate's own format.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Schedule {
    pub due: u64,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub reps: i32,
    pub lapses: i32,
    pub state: u8,
    pub last_review: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Card {
    pub version: u8,
    pub id: String,
    /// The Codex chat the card was made in (shown in the app; review opens in the pet's chat).
    pub thread_id: String,
    pub created_at: u64,
    pub question: String,
    pub choices: Vec<String>,
    pub answer: u8,
    pub explanation: String,
    pub topic: String,
    pub last_correct: bool,
    /// Last time a review (not the first quiz) recorded a result; counts toward the daily limit.
    pub reviewed_at: Option<u64>,
    pub schedule: Schedule,
    /// The batch (one "문제 내기") this card belongs to. Empty only in a version 1 row, which the
    /// store moves into a batch when it loads.
    #[serde(default)]
    pub batch_id: String,
}

/// One "문제 내기": its cards share this id. The count, last score and review day are computed.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Batch {
    pub version: u8,
    /// Eight lowercase hex characters, short enough to put in a chat request.
    pub id: String,
    pub name: String,
    pub thread_id: String,
    pub created_at: u64,
}

/// Where saved cards go: a new batch (one "문제 내기", named by the skill) or, for questions added
/// during a batch review, that existing batch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SaveTo { New(String), Batch(String) }

pub fn batch_name(name: &str) -> Result<String, String> { text(name, MAX_BATCH_NAME).map_err(|_| "invalid-review-batch".into()) }
pub fn valid_batch_id(id: &str) -> bool { id.len() == 8 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
pub fn new_batch_id() -> String { uuid::Uuid::new_v4().simple().to_string()[..8].to_owned() }

/// The cards' topics in order, each once (what a batch is about).
pub fn topics<'a>(cards: impl IntoIterator<Item = &'a Card>) -> Vec<String> {
    let mut seen = Vec::new();
    for card in cards { if !seen.contains(&card.topic) { seen.push(card.topic.clone()); } }
    seen
}

/// A name for cards saved before batches existed: their topics joined ("광고와 PR · PESO"), as
/// many as fit in a batch name. "이전에 저장한 문제" only when there is no topic.
pub fn legacy_batch_name(topics: &[String]) -> String {
    let mut name = String::new();
    for topic in topics {
        let next = if name.is_empty() { topic.clone() } else { format!("{name} · {topic}") };
        if next.chars().count() > MAX_BATCH_NAME { break; }
        name = next;
    }
    if name.is_empty() { LEGACY_BATCH_NAME.into() } else { name }
}

/// What the pets and the app show: today's review count (already capped), all saved cards, and
/// whether today's "복습할 때예요" notice was already shown.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub due: usize, pub total: usize, pub batches: usize, pub notified_today: bool,
    pub due_by_thread: std::collections::BTreeMap<String, usize>,
}

fn text(value: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(|c| c.is_control()) {
        return Err("invalid-review-card".into());
    }
    Ok(value.to_owned())
}

impl NewCard {
    pub fn validate(&self) -> Result<(), String> {
        text(&self.question, MAX_QUESTION)?;
        text(&self.explanation, MAX_EXPLANATION)?;
        text(&self.topic, MAX_TOPIC)?;
        if self.choices.len() != 4 || !(1..=4).contains(&self.answer) { return Err("invalid-review-card".into()); }
        let mut seen = std::collections::HashSet::new();
        for choice in &self.choices {
            if !seen.insert(text(choice, MAX_CHOICE)?) { return Err("invalid-review-card".into()); }
        }
        Ok(())
    }
}

fn utc(ms: u64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(i64::try_from(ms).unwrap_or(i64::MAX)).unwrap_or_default()
}
fn millis(at: DateTime<Utc>) -> u64 { u64::try_from(at.timestamp_millis()).unwrap_or(0) }

/// The local calendar day of `ms` (the offset is today's local offset, passed in for testing).
pub fn day(ms: u64, offset: FixedOffset) -> NaiveDate { utc(ms).with_timezone(&offset).date_naive() }

pub fn local_offset() -> FixedOffset { *chrono::Local::now().offset() }

fn scheduler() -> rs_fsrs::FSRS {
    rs_fsrs::FSRS::new(rs_fsrs::Parameters { enable_short_term: false, enable_fuzz: false, ..Default::default() })
}

/// FSRS review: correct → Good, wrong → Again. A new card has no previous schedule.
pub fn schedule(previous: Option<&Schedule>, correct: bool, now: u64) -> Schedule {
    let card = match previous {
        None => rs_fsrs::Card::new(),
        Some(s) => rs_fsrs::Card {
            due: utc(s.due), stability: s.stability, difficulty: s.difficulty,
            elapsed_days: s.elapsed_days, scheduled_days: s.scheduled_days, reps: s.reps, lapses: s.lapses,
            state: match s.state { 1 => rs_fsrs::State::Learning, 2 => rs_fsrs::State::Review, 3 => rs_fsrs::State::Relearning, _ => rs_fsrs::State::New },
            last_review: utc(s.last_review),
        },
    };
    let rating = if correct { rs_fsrs::Rating::Good } else { rs_fsrs::Rating::Again };
    let next = scheduler().next(card, utc(now), rating).card;
    // Whole days only: never earlier than tomorrow. A wrong answer always comes back tomorrow
    // (a one-day relearning step); FSRS still lowers its stability, so later intervals restart small.
    // Without this, a card missed after a long streak would return only after about two weeks.
    let tomorrow = utc(now) + Duration::days(1);
    let due = if correct { next.due.max(tomorrow) } else { tomorrow };
    Schedule {
        due: millis(due), stability: next.stability, difficulty: next.difficulty,
        elapsed_days: next.elapsed_days, scheduled_days: next.scheduled_days, reps: next.reps, lapses: next.lapses,
        state: next.state as u8, last_review: now,
    }
}

/// Days from today until the card's review day (at least 1 right after answering).
pub fn days_until(card: &Card, now: u64, offset: FixedOffset) -> i64 {
    (day(card.schedule.due, offset) - day(now, offset)).num_days()
}

pub fn make_card(input: NewCard, thread_id: &str, batch_id: &str, now: u64) -> Card {
    Card {
        version: CARD_VERSION, batch_id: batch_id.to_owned(), id: uuid::Uuid::new_v4().to_string(), thread_id: thread_id.to_owned(), created_at: now,
        question: input.question.trim().to_owned(), choices: input.choices.iter().map(|c| c.trim().to_owned()).collect(),
        answer: input.answer, explanation: input.explanation.trim().to_owned(), topic: input.topic.trim().to_owned(),
        last_correct: input.correct, reviewed_at: None, schedule: schedule(None, input.correct, now),
    }
}

/// Reviews already recorded today; they use up the daily limit.
pub fn reviewed_today(cards: &[Card], now: u64, offset: FixedOffset) -> usize {
    let today = day(now, offset);
    cards.iter().filter(|c| c.reviewed_at.is_some_and(|at| day(at, offset) == today)).count()
}

/// Today's review cards: due on or before today, wrong ones first, then the oldest due, at most
/// `DAILY_LIMIT` a day including those already reviewed today. The rest wait for the next day.
pub fn due_today(cards: &[Card], now: u64, offset: FixedOffset) -> Vec<&Card> {
    let today = day(now, offset);
    let room = DAILY_LIMIT.saturating_sub(reviewed_today(cards, now, offset));
    let mut due: Vec<&Card> = cards.iter().filter(|c| day(c.schedule.due, offset) <= today).collect();
    due.sort_by(|a, b| a.last_correct.cmp(&b.last_correct).then(a.schedule.due.cmp(&b.schedule.due)).then(a.id.cmp(&b.id)));
    due.truncate(room);
    due
}

/// "전체 다시 풀기": a wrong answer comes back tomorrow, and a card already due today is reviewed as
/// usual. A right answer on a card not due yet keeps its schedule: answering early is no reason to
/// push it further out. Only the cards in today's list count toward the daily limit.
pub fn redo(card: &Card, correct: bool, in_today: bool, now: u64) -> Card {
    let mut next = card.clone();
    if in_today || !correct { next.schedule = schedule(Some(&card.schedule), correct, now); }
    next.last_correct = correct;
    if in_today { next.reviewed_at = Some(now); }
    next
}

/// When a card shows up again: 0 if it is in today's list, otherwise at least tomorrow (a due card
/// beyond today's limit waits for the next day).
pub fn review_in(card: &Card, today: &std::collections::HashSet<&str>, now: u64, offset: FixedOffset) -> i64 {
    if today.contains(card.id.as_str()) { 0 } else { days_until(card, now, offset).max(1) }
}

/// The nearest review day among these cards (for "다음 복습 N일 뒤").
pub fn next_review_days(cards: &[&Card], now: u64, offset: FixedOffset) -> Option<i64> {
    cards.iter().map(|c| days_until(c, now, offset)).min()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 86_400_000;
    // 2026-11-24 09:00 in UTC+9.
    const NOW: u64 = 1_795_478_400_000;
    fn kst() -> FixedOffset { FixedOffset::east_opt(9 * 3600).unwrap() }
    fn input(correct: bool) -> NewCard {
        NewCard { question: "기회비용은 무엇인가?".into(), choices: vec!["A".into(), "B".into(), "C".into(), "D".into()],
            answer: 2, explanation: "포기한 대안 중 가장 가치 있는 것".into(), topic: "경제".into(), correct }
    }

    #[test]
    fn cards_are_bounded_four_choice_questions() {
        assert!(input(true).validate().is_ok());
        let mut bad = input(true); bad.choices.pop(); assert!(bad.validate().is_err());
        let mut bad = input(true); bad.answer = 5; assert!(bad.validate().is_err());
        let mut bad = input(true); bad.answer = 0; assert!(bad.validate().is_err());
        let mut bad = input(true); bad.question = "가".repeat(301); assert!(bad.validate().is_err());
        let mut bad = input(true); bad.choices[1] = "A".into(); assert!(bad.validate().is_err(), "duplicate choices");
        let mut bad = input(true); bad.topic = "주제\u{7}".into(); assert!(bad.validate().is_err());
        let mut bad = input(true); bad.explanation = "  ".into(); assert!(bad.validate().is_err());
    }

    #[test]
    fn fsrs_puts_a_wrong_answer_tomorrow_and_a_right_one_later() {
        let wrong = make_card(input(false), "t", "b", NOW);
        let right = make_card(input(true), "t", "b", NOW);
        assert_eq!(days_until(&wrong, NOW, kst()), 1);
        let first = days_until(&right, NOW, kst());
        assert!((2..=5).contains(&first), "first Good interval {first}");
        // Correct again on the review day: the interval grows.
        let later = NOW + first as u64 * DAY;
        let again = schedule(Some(&right.schedule), true, later);
        let second = (day(again.due, kst()) - day(later, kst())).num_days();
        assert!(second > first, "second interval {second} after {first}");
        // A lapse comes back the next day.
        let lapse = schedule(Some(&again), false, later + second as u64 * DAY);
        assert_eq!((day(lapse.due, kst()) - day(later + second as u64 * DAY, kst())).num_days(), 1);
        assert_eq!(lapse.lapses, 1);
    }

    #[test]
    fn today_shows_wrong_cards_first_and_at_most_ten() {
        let mut cards: Vec<Card> = (0..14).map(|i| { let mut c = make_card(input(i % 3 != 0), "t", "b", NOW - 5 * DAY); c.schedule.due = NOW - DAY + i; c }).collect();
        let mut future = make_card(input(false), "t", "b", NOW); future.schedule.due = NOW + 2 * DAY; cards.push(future);
        let due = due_today(&cards, NOW, kst());
        assert_eq!(due.len(), DAILY_LIMIT);
        let wrong = cards.iter().filter(|c| !c.last_correct && c.schedule.due <= NOW).count();
        assert!(due[..wrong].iter().all(|c| !c.last_correct));
        assert!(due[wrong..].iter().all(|c| c.last_correct));
        // Reviews recorded today use up the limit; the rest wait for tomorrow.
        for card in cards.iter_mut().take(7) { card.reviewed_at = Some(NOW); card.schedule.due = NOW + DAY; }
        assert_eq!(due_today(&cards, NOW, kst()).len(), 3);
    }

    #[test]
    fn redoing_a_whole_batch_brings_back_only_the_wrong_ones_early() {
        let right = make_card(input(true), "t", "b", NOW);
        let later = right.schedule.due;
        // Right on a card not due yet: same schedule, no daily-limit use.
        let kept = redo(&right, true, false, NOW + DAY);
        assert_eq!(kept.schedule, right.schedule);
        assert!(kept.last_correct && kept.reviewed_at.is_none());
        // Wrong: tomorrow, still not counted toward today's limit.
        let missed = redo(&right, false, false, NOW + DAY);
        assert_eq!(days_until(&missed, NOW + DAY, kst()), 1);
        assert!(!missed.last_correct && missed.reviewed_at.is_none());
        // A card in today's list is reviewed as usual.
        let due = redo(&right, true, true, later);
        assert!(due.schedule.due > later && due.reviewed_at == Some(later));
    }

    #[test]
    fn old_cards_are_named_after_their_topics() {
        let names = |list: &[&str]| legacy_batch_name(&list.iter().map(|t| t.to_string()).collect::<Vec<_>>());
        assert_eq!(names(&["광고와 PR", "PESO", "AI 추천과 신뢰"]), "광고와 PR · PESO · AI 추천과 신뢰");
        assert_eq!(names(&["가".repeat(30).as_str(), "나".repeat(20).as_str()]), "가".repeat(30), "only what fits in 40 characters");
        assert_eq!(names(&[]), LEGACY_BATCH_NAME);
        let mut a = make_card(input(true), "t", "b", NOW); a.topic = "광고".into();
        let mut b = a.clone(); b.topic = "PR".into();
        assert_eq!(topics([&a, &b, &a]), ["광고", "PR"]);
    }

    #[test]
    fn batch_ids_are_short_hex_and_names_are_bounded() {
        let id = new_batch_id();
        assert!(valid_batch_id(&id), "{id}");
        assert!(!valid_batch_id("ABCDEF12") && !valid_batch_id("abc") && !valid_batch_id("abcdefg!"));
        assert_eq!(batch_name("  통합 마케팅 커뮤니케이션 ").unwrap(), "통합 마케팅 커뮤니케이션");
        assert_eq!(batch_name(&"가".repeat(41)).unwrap_err(), "invalid-review-batch");
        assert_eq!(batch_name("").unwrap_err(), "invalid-review-batch");
    }

    #[test]
    fn the_review_day_follows_the_local_calendar() {
        let mut card = make_card(input(true), "t", "b", NOW);
        // Due tomorrow at 23:00 local is still tomorrow's card, not today's.
        card.schedule.due = NOW + DAY + 14 * 3_600_000;
        assert!(due_today(std::slice::from_ref(&card), NOW, kst()).is_empty());
        assert_eq!(due_today(std::slice::from_ref(&card), NOW + DAY, kst()).len(), 1);
    }
}
