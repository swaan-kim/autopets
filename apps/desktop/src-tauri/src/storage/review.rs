//! 복습 도우미 cards in SQLite (`review_cards_v1`), their batches (`review_batches_v1`, one per
//! "문제 내기") and one small key/value table for the once-a-day notice (`review_meta_v1`). All are
//! new tables; existing tables are not touched.
use crate::{application::store::Store, domain::{pet_link::Target, review::*, roles::RoleId}};
use rusqlite::params;
use serde_json::json;
use std::collections::{BTreeMap, HashSet};

const NOTICE_DAY: &str = "notice-day";
const BATCH_VERSION: u8 = 1;

fn rows(db: &rusqlite::Connection, sql: &str) -> Result<Vec<String>, String> {
    db.prepare(sql).map_err(super::sqlite::db_err)?
        .query_map([], |r| r.get(0)).map_err(super::sqlite::db_err)?.collect::<Result<_, _>>().map_err(super::sqlite::db_err)
}

impl Store {
    pub(crate) fn init_review(&mut self) -> Result<(), String> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS review_cards_v1 (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS review_batches_v1 (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS review_meta_v1 (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .map_err(super::sqlite::db_err)?;
        // A row this version cannot read stays in the table untouched; it is only left out here.
        self.review_cards = rows(&self.db, "SELECT value FROM review_cards_v1")?.iter().filter_map(|row| serde_json::from_str::<Card>(row).ok())
            .filter(|c| c.version == 1 || c.version == CARD_VERSION).collect();
        self.review_cards.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        self.review_batches = rows(&self.db, "SELECT value FROM review_batches_v1")?.iter().filter_map(|row| serde_json::from_str::<Batch>(row).ok())
            .filter(|b| b.version == BATCH_VERSION && valid_batch_id(&b.id)).collect();
        self.review_batches.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        self.move_cards_into_batches()?;
        self.review_notice_day = self.db.query_row("SELECT value FROM review_meta_v1 WHERE key=?1", [NOTICE_DAY], |r| r.get(0)).ok();
        Ok(())
    }

    /// Cards saved before batches existed (or whose batch row is gone) become batches: one save
    /// wrote all its cards with the same time and chat, so cards sharing both are one batch, named
    /// after their topics. A batch an earlier build named "이전에 저장한 문제" gets its topics' name
    /// too. Batches left without cards are removed. One transaction; runs once.
    fn move_cards_into_batches(&mut self) -> Result<(), String> {
        let known: HashSet<&str> = self.review_batches.iter().map(|b| b.id.as_str()).collect();
        let mut groups: BTreeMap<(u64, String), Vec<usize>> = BTreeMap::new();
        for (index, card) in self.review_cards.iter().enumerate() {
            if !known.contains(card.batch_id.as_str()) { groups.entry((card.created_at, card.thread_id.clone())).or_default().push(index); }
        }
        let used: HashSet<&str> = self.review_cards.iter().map(|c| c.batch_id.as_str()).collect();
        let empty: Vec<String> = self.review_batches.iter().filter(|b| !used.contains(b.id.as_str())).map(|b| b.id.clone()).collect();
        let renamed: Vec<Batch> = self.review_batches.iter().filter(|b| b.name == LEGACY_BATCH_NAME && used.contains(b.id.as_str())).filter_map(|b| {
            let name = legacy_batch_name(&topics(self.batch_cards(&b.id)));
            (name != b.name).then(|| Batch { name, ..b.clone() })
        }).collect();
        if groups.is_empty() && empty.is_empty() && renamed.is_empty() { return Ok(()); }
        let mut cards = self.review_cards.clone();
        let mut batches: Vec<Batch> = self.review_batches.iter().filter(|b| !empty.contains(&b.id))
            .map(|b| renamed.iter().find(|r| r.id == b.id).cloned().unwrap_or_else(|| b.clone())).collect();
        let tx = self.db.unchecked_transaction().map_err(super::sqlite::db_err)?;
        for id in &empty { self.db.execute("DELETE FROM review_batches_v1 WHERE id=?1", [id]).map_err(super::sqlite::db_err)?; }
        for batch in &renamed { self.write_batch(batch)?; }
        for ((created_at, thread_id), indexes) in groups {
            let name = legacy_batch_name(&topics(indexes.iter().map(|&i| &cards[i])));
            let batch = Batch { version: BATCH_VERSION, id: unique_batch_id(&batches), name, thread_id, created_at };
            self.write_batch(&batch)?;
            for index in indexes {
                cards[index].batch_id = batch.id.clone();
                cards[index].version = CARD_VERSION;
                self.write_card(&cards[index])?;
            }
            batches.push(batch);
        }
        tx.commit().map_err(super::sqlite::db_err)?;
        batches.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        self.review_cards = cards;
        self.review_batches = batches;
        Ok(())
    }

    pub(crate) fn review_summary(&self, now: u64) -> Summary {
        let offset = local_offset();
        let due = due_today(&self.review_cards, now, offset);
        let mut due_by_thread = BTreeMap::new();
        for card in &due { *due_by_thread.entry(card.thread_id.clone()).or_insert(0) += 1; }
        Summary {
            due: due.len(),
            total: self.review_cards.len(),
            batches: self.review_batches.len(),
            notified_today: self.review_notice_day.as_deref() == Some(&day(now, offset).to_string()),
            due_by_thread,
        }
    }

    /// The chat must be linked to a 복습 도우미 pet. Another chat never reads or writes cards.
    pub(crate) fn review_link(&self, target: &Target) -> Result<crate::domain::pet_link::Link, String> {
        target.validate()?;
        let link = self.pet_links.get(&target.key()).ok_or("pet-not-connected")?;
        if !link.target.matches(target) { return Err("pet-target-mismatch".into()); }
        if link.template.id != RoleId::ReviewHelper { return Err("not-review-pet".into()); }
        if !link.connected || !link.enabled { return Err("pet-not-connected".into()); }
        Ok(link.clone())
    }

    fn write_card(&self, card: &Card) -> Result<(), String> {
        self.db.execute("INSERT INTO review_cards_v1(id,value) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
            params![card.id, serde_json::to_string(card).map_err(|e| e.to_string())?]).map_err(super::sqlite::db_err)?;
        Ok(())
    }

    fn write_batch(&self, batch: &Batch) -> Result<(), String> {
        self.db.execute("INSERT INTO review_batches_v1(id,value) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
            params![batch.id, serde_json::to_string(batch).map_err(|e| e.to_string())?]).map_err(super::sqlite::db_err)?;
        Ok(())
    }

    pub(crate) fn review_batch(&self, id: &str) -> Result<&Batch, String> {
        self.review_batches.iter().find(|b| valid_batch_id(id) && b.id == id).ok_or_else(|| "review-batch-not-found".into())
    }

    fn batch_cards<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a Card> + 'a {
        self.review_cards.iter().filter(move |c| c.batch_id == id)
    }

    /// A new "문제 내기" is saved as one batch with the name the skill gave it. Questions the skill
    /// added during a batch review join that batch (the batch itself is unchanged).
    pub(crate) fn save_review_cards(&mut self, target: &Target, to: SaveTo, cards: Vec<NewCard>, now: u64) -> Result<serde_json::Value, String> {
        let link = self.review_link(target)?;
        let (batch, new) = match to {
            SaveTo::New(name) => (Batch { version: BATCH_VERSION, id: unique_batch_id(&self.review_batches), name: batch_name(&name)?, thread_id: link.target.thread_id.clone(), created_at: now }, true),
            SaveTo::Batch(id) => {
                let batch = self.review_batch(&id)?;
                if batch.thread_id != target.thread_id { return Err("review-batch-not-found".into()); }
                (batch.clone(), false)
            },
        };
        if cards.is_empty() || cards.len() > CARDS_PER_SAVE { return Err("invalid-review-card".into()); }
        for card in &cards { card.validate()?; }
        if self.review_cards.len() + cards.len() > MAX_CARDS { return Err("review-cards-full".into()); }
        let made: Vec<Card> = cards.into_iter().map(|c| make_card(c, &link.target.thread_id, &batch.id, now)).collect();
        let tx = self.db.unchecked_transaction().map_err(super::sqlite::db_err)?;
        if new { self.write_batch(&batch)?; }
        for card in &made { self.write_card(card)?; }
        tx.commit().map_err(super::sqlite::db_err)?;
        self.review_cards.extend(made.iter().cloned());
        let refs: Vec<&Card> = made.iter().collect();
        let result = json!({ "saved": made.len(), "batch": { "id": batch.id, "name": batch.name },
            "nextReviewDays": next_review_days(&refs, now, local_offset()), "total": self.review_cards.len() });
        if new { self.review_batches.push(batch); }
        Ok(result)
    }

    /// The cards for the chat to quiz, wrong ones first: today's list (at most `DAILY_LIMIT`), or
    /// only that batch's part of it, or with `all` every card of that batch ("전체 다시 풀기"). The
    /// answer is included because the chat grades by number; the app never shows these as a quiz.
    pub(crate) fn review_due(&self, target: &Target, batch: Option<&str>, all: bool, now: u64) -> Result<serde_json::Value, String> {
        self.review_link(target)?;
        let batch = match batch { Some(id) => Some(self.review_batch(id)?), None if all => return Err("review-batch-not-found".into()), None => None };
        if batch.is_some_and(|b| b.thread_id != target.thread_id) { return Err("review-batch-not-found".into()); }
        let mut cards: Vec<&Card> = match (batch, all) {
            (Some(b), true) => self.batch_cards(&b.id).collect(),
            (Some(b), false) => due_today(&self.review_cards, now, local_offset()).into_iter().filter(|c| c.batch_id == b.id).collect(),
            (None, _) => due_today(&self.review_cards, now, local_offset()),
        };
        cards.retain(|card| card.thread_id == target.thread_id);
        if all { cards.sort_by(|a, b| a.last_correct.cmp(&b.last_correct).then(a.created_at.cmp(&b.created_at)).then(a.id.cmp(&b.id))); }
        let cards: Vec<_> = cards.into_iter().map(|c| json!({
            "id": c.id, "question": c.question, "choices": c.choices, "answer": c.answer,
            "explanation": c.explanation, "topic": c.topic, "lastCorrect": c.last_correct,
        })).collect();
        Ok(json!({ "cards": cards, "limit": DAILY_LIMIT, "batch": batch.map(|b| json!({ "id": b.id, "name": b.name })) }))
    }

    /// Results for the cards `review_due` gave: today's list (or that batch's part of it), or with
    /// `all` any card of that batch. Anything else is refused as a whole.
    pub(crate) fn record_review_results(&mut self, target: &Target, results: Vec<ReviewResult>, batch: Option<&str>, all: bool, now: u64) -> Result<serde_json::Value, String> {
        self.review_link(target)?;
        let batch = match batch { Some(id) => Some(self.review_batch(id)?.id.clone()), None if all => return Err("review-batch-not-found".into()), None => None };
        if batch.as_ref().is_some_and(|id| self.review_batches.iter().any(|b| &b.id == id && b.thread_id != target.thread_id)) { return Err("review-batch-not-found".into()); }
        let offset = local_offset();
        let today: HashSet<String> = due_today(&self.review_cards, now, offset).into_iter().map(|c| c.id.clone()).collect();
        let mut allowed: HashSet<String> = match (&batch, all) {
            (Some(b), true) => self.batch_cards(b).map(|c| c.id.clone()).collect(),
            (Some(b), false) => self.batch_cards(b).map(|c| c.id.clone()).filter(|id| today.contains(id)).collect(),
            (None, _) => today.clone(),
        };
        allowed.retain(|id| self.review_cards.iter().any(|c| &c.id == id && c.thread_id == target.thread_id));
        let mut seen = HashSet::new();
        if results.is_empty() || results.len() > DAILY_LIMIT.max(CARDS_PER_SAVE)
            || results.iter().any(|r| !allowed.contains(&r.id) || !seen.insert(r.id.clone())) {
            return Err("review-card-not-due".into());
        }
        let mut updated = Vec::new();
        for result in &results {
            let card = self.review_cards.iter().find(|c| c.id == result.id).ok_or("review-card-not-due")?;
            updated.push(redo(card, result.correct, today.contains(&card.id), now));
        }
        let tx = self.db.unchecked_transaction().map_err(super::sqlite::db_err)?;
        for card in &updated { self.write_card(card)?; }
        tx.commit().map_err(super::sqlite::db_err)?;
        for card in &updated {
            if let Some(slot) = self.review_cards.iter_mut().find(|c| c.id == card.id) { *slot = card.clone(); }
        }
        let correct = results.iter().filter(|r| r.correct).count();
        let next = next_review_days(&self.review_cards.iter().collect::<Vec<_>>(), now, offset);
        Ok(json!({ "reviewed": updated.len(), "correct": correct, "wrong": updated.len() - correct,
            "remainingToday": due_today(&self.review_cards, now, offset).len(), "nextReviewDays": next }))
    }

    fn batch_json(&self, batch: &Batch, today: &HashSet<&str>, now: u64) -> serde_json::Value {
        let offset = local_offset();
        let cards: Vec<&Card> = self.batch_cards(&batch.id).collect();
        let due = cards.iter().filter(|c| today.contains(c.id.as_str())).count();
        let next = cards.iter().map(|c| review_in(c, today, now, offset)).min().unwrap_or(1);
        json!({ "id": batch.id, "name": batch.name, "threadId": batch.thread_id, "createdAt": batch.created_at, "topics": topics(cards.iter().copied()),
            "count": cards.len(), "correct": cards.iter().filter(|c| c.last_correct).count(), "due": due, "nextReviewDays": next })
    }

    /// The app's 문제 묶음 page: batches with something to review today first, then the nearest
    /// review day, then the newest.
    pub(crate) fn review_batches_view(&self, now: u64) -> serde_json::Value {
        let today_cards = due_today(&self.review_cards, now, local_offset());
        let today: HashSet<&str> = today_cards.iter().map(|c| c.id.as_str()).collect();
        let mut batches: Vec<serde_json::Value> = self.review_batches.iter().map(|b| self.batch_json(b, &today, now)).collect();
        batches.sort_by_key(|v| (v["due"].as_u64() == Some(0), v["nextReviewDays"].as_i64().unwrap_or(i64::MAX), std::cmp::Reverse(v["createdAt"].as_u64().unwrap_or(0))));
        json!(batches)
    }

    /// One batch and its questions: question, answer and when it comes back. Nothing to solve here.
    pub(crate) fn review_batch_view(&self, id: &str, now: u64) -> Result<serde_json::Value, String> {
        let batch = self.review_batch(id)?;
        let offset = local_offset();
        let today_cards = due_today(&self.review_cards, now, offset);
        let today: HashSet<&str> = today_cards.iter().map(|c| c.id.as_str()).collect();
        let mut cards: Vec<&Card> = self.batch_cards(&batch.id).collect();
        cards.sort_by_key(|c| (review_in(c, &today, now, offset), c.schedule.due, c.id.clone()));
        let mut view = self.batch_json(batch, &today, now);
        view["cards"] = json!(cards.into_iter().map(|c| json!({
            "id": c.id, "question": c.question, "answer": c.choices.get(usize::from(c.answer).saturating_sub(1)),
            "topic": c.topic, "lastCorrect": c.last_correct, "nextReviewDays": review_in(c, &today, now, offset),
        })).collect::<Vec<_>>());
        Ok(view)
    }

    /// This batch's part of today's list (what "Codex에서 복습 N" asks for).
    pub(crate) fn review_batch_due(&self, id: &str, now: u64) -> Result<(Batch, usize), String> {
        let batch = self.review_batch(id)?.clone();
        let due = due_today(&self.review_cards, now, local_offset()).into_iter().filter(|c| c.batch_id == batch.id).count();
        Ok((batch, due))
    }

    /// Removes one card. Returns true when it was the batch's last card and the batch went too.
    pub(crate) fn delete_review_card(&mut self, id: &str) -> Result<bool, String> {
        let card = self.review_cards.iter().find(|c| c.id == id).ok_or("review-card-not-found")?;
        let batch = card.batch_id.clone();
        let last = self.batch_cards(&batch).count() == 1;
        let tx = self.db.unchecked_transaction().map_err(super::sqlite::db_err)?;
        self.db.execute("DELETE FROM review_cards_v1 WHERE id=?1", [id]).map_err(super::sqlite::db_err)?;
        if last { self.db.execute("DELETE FROM review_batches_v1 WHERE id=?1", [&batch]).map_err(super::sqlite::db_err)?; }
        tx.commit().map_err(super::sqlite::db_err)?;
        self.review_cards.retain(|c| c.id != id);
        if last { self.review_batches.retain(|b| b.id != batch); }
        Ok(last)
    }

    /// Removes a batch together with its cards.
    pub(crate) fn delete_review_batch(&mut self, id: &str) -> Result<(), String> {
        let batch = self.review_batch(id)?.id.clone();
        let cards: Vec<String> = self.batch_cards(&batch).map(|c| c.id.clone()).collect();
        let tx = self.db.unchecked_transaction().map_err(super::sqlite::db_err)?;
        for card in &cards { self.db.execute("DELETE FROM review_cards_v1 WHERE id=?1", [card]).map_err(super::sqlite::db_err)?; }
        self.db.execute("DELETE FROM review_batches_v1 WHERE id=?1", [&batch]).map_err(super::sqlite::db_err)?;
        tx.commit().map_err(super::sqlite::db_err)?;
        self.review_cards.retain(|c| c.batch_id != batch);
        self.review_batches.retain(|b| b.id != batch);
        Ok(())
    }

    /// Today's "복습할 때예요" was shown (bubble or Windows notice). Returns false if it already was.
    pub(crate) fn mark_review_notice(&mut self, now: u64) -> Result<bool, String> {
        let today = day(now, local_offset()).to_string();
        if self.review_notice_day.as_deref() == Some(&today) { return Ok(false); }
        self.db.execute("INSERT INTO review_meta_v1(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![NOTICE_DAY, today]).map_err(super::sqlite::db_err)?;
        self.review_notice_day = Some(today);
        Ok(true)
    }
}

fn unique_batch_id(batches: &[Batch]) -> String {
    loop {
        let id = new_batch_id();
        if !batches.iter().any(|b| b.id == id) { return id; }
    }
}

#[cfg(test)]
#[path = "../application/tests/review.rs"]
mod tests;
