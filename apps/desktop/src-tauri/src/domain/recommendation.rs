//! Pet recommendations for chats connected through the explicit pet link, and for the chat that
//! started the app with `$autopets` and is still waiting for a pet ("채팅 연결 대기").
//! In memory only (no DB change). A recommendation never starts AI work: accepting it only
//! opens the existing pet composer, and the user still applies the pet and asks in the chat.
use super::pet_link::{Link, Target};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::OnceLock;

/// A hook that started but never finished (app busy, hook killed) must not leave a spinner.
pub const PREPARING_TTL_MS: u64 = 15_000;
const MAX_REQUEST_CHARS: usize = 1200;
const MAX_CANDIDATES: usize = 2;
const SEEN_PER_CHAT: usize = 16;

#[derive(Clone, Debug)]
struct CatalogPet { id: String, template_id: String, skill_id: Option<String> }

fn catalog() -> &'static [CatalogPet] {
    static CATALOG: OnceLock<Vec<CatalogPet>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let value: serde_json::Value = serde_json::from_str(include_str!("../../../../../packages/contracts/data/pet-catalog.json")).unwrap_or_default();
        value.as_array().map(|entries| entries.iter().filter_map(|entry| Some(CatalogPet {
            id: entry["id"].as_str()?.to_owned(),
            template_id: entry["template"]["id"].as_str()?.to_owned(),
            skill_id: entry["template"]["skills"][0]["id"].as_str().map(str::to_owned),
        })).collect()).unwrap_or_default()
    })
}
pub fn known_pet(id: &str) -> bool { catalog().iter().any(|pet| pet.id == id) }
/// Catalog pets that the link's current template already is (same template and first skill).
pub fn active_pet_ids(link: &Link) -> Vec<String> {
    let template = serde_json::to_value(&link.template).unwrap_or_default();
    let (id, skill) = (template["id"].as_str().unwrap_or_default(), template["skills"][0]["id"].as_str());
    catalog().iter().filter(|pet| pet.template_id == id && pet.skill_id.as_deref() == skill).map(|pet| pet.id.clone()).collect()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate { pub pet_id: String, pub reason: String, pub cues: Vec<String> }

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum State { Preparing, Shown, Accepted, Dismissed, Running }

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Source { Hook, Skill }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: String, pub target: Target, pub turn_id: String, pub source: Source, pub state: State,
    pub request: Option<String>, pub request_truncated: bool, pub candidates: Vec<Candidate>,
    pub accepted_pet_id: Option<String>, pub created_at: u64, pub updated_at: u64,
    #[serde(skip)] fingerprint: Option<String>,
    #[serde(skip)] accepted_run_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Request {
    Begin { session_id: String, turn_id: String, cwd: String, source: Source },
    Offer { session_id: String, turn_id: String, request: String, request_truncated: bool, fingerprint: String, candidates: Vec<Candidate> },
    Clear { session_id: String, turn_id: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Response { Accept { pet_id: String, #[serde(default)] other: bool }, Dismiss }

fn safe_text(value: &str, max: usize, multiline: bool) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
        && !value.chars().any(|c| c.is_control() && !(multiline && (c == '\n' || c == '\t')))
}
fn valid_turn(value: &str) -> bool { safe_text(value, 128, false) }
fn valid_session(value: &str) -> bool { uuid::Uuid::parse_str(value).is_ok() }

#[derive(Default)]
pub struct Recommendations { current: HashMap<String, Recommendation>, seen: HashMap<String, VecDeque<String>> }

/// A chat is eligible when it has an explicit pet link, or when it is the chat that started this
/// app with `$autopets` and has no pet yet (`setup`, shown as "채팅 연결 대기"). Any other chat is not.
fn eligible<'a>(links: &'a HashMap<String, Link>, setup: Option<&Target>, session_id: &str) -> Result<(Target, Option<&'a Link>), &'static str> {
    if let Some(link) = links.values().find(|link| link.target.thread_id == session_id) {
        if !link.connected { return Err("chat-not-connected"); }
        if !link.enabled { return Err("pet-help-disabled"); }
        if link.run.as_ref().is_some_and(|run| run.unresolved()) { return Err("pet-task-in-progress"); }
        return Ok((link.target.clone(), Some(link)));
    }
    setup.filter(|target| target.thread_id == session_id).map(|target| (target.clone(), None)).ok_or("chat-not-connected")
}
fn tracked(links: &HashMap<String, Link>, setup: Option<&Target>, thread: &str) -> bool {
    links.values().any(|link| link.target.thread_id == thread && link.connected) || setup.is_some_and(|target| target.thread_id == thread)
}

impl Recommendations {
    /// Handles one hook/skill call. Returns the JSON the caller receives.
    pub fn request(&mut self, links: &HashMap<String, Link>, setup: Option<&Target>, input: Request, now: u64) -> Result<serde_json::Value, String> {
        self.prune(links, setup);
        match input {
            Request::Begin { session_id, turn_id, cwd, source } => {
                if !valid_session(&session_id) || !valid_turn(&turn_id) || !safe_text(&cwd, 4096, false) { return Err("invalid-recommendation".into()); }
                let (target, link) = match eligible(links, setup, &session_id) {
                    Ok(found) => found,
                    Err(reason) => return Ok(serde_json::json!({"ok":true,"eligible":false,"reason":reason})),
                };
                // A newer message replaces the card; an accepted request already lives in the composer draft.
                if self.current.get(&session_id).is_some_and(|item| item.turn_id == turn_id && item.state != State::Preparing) {
                    return Ok(serde_json::json!({"ok":true,"eligible":false,"reason":"duplicate-turn"}));
                }
                let previous = self.current.remove(&session_id);
                self.current.insert(session_id.clone(), Recommendation {
                    id: uuid::Uuid::new_v4().simple().to_string(), target, turn_id, source, state: State::Preparing,
                    request: None, request_truncated: false, candidates: vec![], accepted_pet_id: None, created_at: now, updated_at: now,
                    fingerprint: previous.and_then(|item| item.fingerprint), accepted_run_id: None,
                });
                Ok(serde_json::json!({"ok":true,"eligible":true,"slot":link.map(|link| link.slot),"activePetIds":link.map(active_pet_ids).unwrap_or_default()}))
            }
            Request::Offer { session_id, turn_id, request, request_truncated, fingerprint, candidates } => {
                if !valid_session(&session_id) || !valid_turn(&turn_id) || !safe_text(&request, MAX_REQUEST_CHARS, true)
                    || fingerprint.len() != 64 || !fingerprint.chars().all(|c| c.is_ascii_hexdigit())
                    || candidates.is_empty() || candidates.len() > MAX_CANDIDATES
                    || candidates.iter().any(|item| !known_pet(&item.pet_id) || !safe_text(&item.reason, 200, false) || item.cues.len() > 4
                        || item.cues.iter().any(|cue| !safe_text(cue, 32, false)))
                    || candidates.iter().enumerate().any(|(i, item)| candidates[..i].iter().any(|other| other.pet_id == item.pet_id)) {
                    return Err("invalid-recommendation".into());
                }
                let (target, _) = eligible(links, setup, &session_id).map_err(str::to_owned)?;
                let item = self.current.get_mut(&session_id).filter(|item| item.turn_id == turn_id && item.state == State::Preparing)
                    .ok_or("stale-recommendation")?;
                let fingerprint = fingerprint.to_ascii_lowercase();
                let seen = self.seen.entry(session_id.clone()).or_default();
                // The same request (e.g. re-sent or retried) never pops up a second time.
                if seen.contains(&fingerprint) {
                    self.current.remove(&session_id);
                    return Ok(serde_json::json!({"ok":true,"duplicate":true}));
                }
                seen.push_back(fingerprint.clone());
                while seen.len() > SEEN_PER_CHAT { seen.pop_front(); }
                item.target = target; item.state = State::Shown; item.request = Some(request);
                item.request_truncated = request_truncated; item.candidates = candidates; item.fingerprint = Some(fingerprint); item.updated_at = now;
                Ok(serde_json::json!({"ok":true,"duplicate":false,"id":item.id}))
            }
            Request::Clear { session_id, turn_id } => {
                if !valid_session(&session_id) || !valid_turn(&turn_id) { return Err("invalid-recommendation".into()); }
                if self.current.get(&session_id).is_some_and(|item| item.turn_id == turn_id && item.state == State::Preparing) {
                    self.current.remove(&session_id);
                }
                Ok(serde_json::json!({"ok":true}))
            }
        }
    }

    /// User response from the pet card or the app. `other` allows a pet the user picked from the list.
    pub fn respond(&mut self, links: &HashMap<String, Link>, setup: Option<&Target>, id: &str, response: Response, now: u64) -> Result<Recommendation, String> {
        self.prune(links, setup);
        let item = self.current.values_mut().find(|item| item.id == id).ok_or("recommendation-not-found")?;
        match response {
            Response::Accept { pet_id, other } => {
                if !matches!(item.state, State::Shown | State::Accepted) { return Err("recommendation-not-open".into()); }
                if !known_pet(&pet_id) || (!other && !item.candidates.iter().any(|candidate| candidate.pet_id == pet_id)) { return Err("invalid-recommendation".into()); }
                // A waiting setup chat has no link (and no pet task) yet.
                let link = links.values().find(|link| link.target.thread_id == item.target.thread_id);
                item.state = State::Accepted; item.accepted_pet_id = Some(pet_id);
                item.accepted_run_id = link.and_then(|link| link.run.as_ref().map(|run| run.id.clone())); item.updated_at = now;
            }
            Response::Dismiss => { item.state = State::Dismissed; item.updated_at = now; }
        }
        Ok(item.clone())
    }

    /// Current view. Links that disappeared drop their recommendation; an accepted pet whose
    /// new pet task started in that chat is shown as running.
    pub fn snapshot(&self, links: &HashMap<String, Link>, setup: Option<&Target>, now: u64) -> Vec<Recommendation> {
        let mut items: Vec<_> = self.current.iter().filter_map(|(thread, item)| {
            if !tracked(links, setup, thread) { return None; }
            if item.state == State::Preparing && now.saturating_sub(item.created_at) > PREPARING_TTL_MS { return None; }
            let mut view = item.clone();
            // Running only once the chat has a linked pet task that started after the user accepted.
            if let Some(link) = links.values().find(|link| link.target.thread_id == *thread && link.connected) {
                let started = link.run.as_ref().is_some_and(|run| Some(&run.id) != item.accepted_run_id.as_ref());
                if item.state == State::Accepted && started && item.accepted_pet_id.as_ref().is_some_and(|pet| active_pet_ids(link).contains(pet)) {
                    view.state = State::Running;
                }
            }
            Some(view)
        }).collect();
        items.sort_by(|a, b| a.target.thread_id.cmp(&b.target.thread_id));
        items
    }

    /// Drops state for chats that are no longer connected (called on each request).
    pub fn prune(&mut self, links: &HashMap<String, Link>, setup: Option<&Target>) {
        self.current.retain(|thread, _| tracked(links, setup, thread));
        self.seen.retain(|thread, _| tracked(links, setup, thread));
    }
}
