//! Codex attention notices for the dog pet: a connected chat needs the user's answer
//! (`action_required`: a question, a plan to confirm, an approval prompt) or the requested work
//! finished (`completed`). Fed by the AutoPets attention hook (Stop, PermissionRequest,
//! PreToolUse(request_user_input), PostToolUse, UserPromptSubmit). In memory only (no DB change).
//!
//! Two states are kept apart on purpose:
//! * `read`: the user closed the bubble or opened the chat from the pet. The notice stays (as a
//!   small mark) because nothing in Codex changed yet.
//! * resolved: Codex reported that the wait ended — the user wrote in the chat, the approved tool
//!   ran, the question was answered or the turn ended. Only then does the notice go away.
use super::pet_link::{Link, Target};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

const MAX_SUMMARY_CHARS: usize = 240;
const MAX_TITLE_CHARS: usize = 80;
const SEEN_PER_CHAT: usize = 32;
const ENDED_PER_CHAT: usize = 16;
const OPEN_PER_CHAT: usize = 4;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind { ActionRequired, Completed }

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reason { Question, ConfirmationRequired, ApprovalRequired, Completed }

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Source { Stop, Permission, UserInput }

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Cause { UserMessage, ToolFinished, TurnEnded }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence { pub file_changes: u32, pub work_commands: u32, pub verified: bool }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String, pub target: Target, pub chat_title: Option<String>, pub turn_id: String,
    pub kind: Kind, pub reason: Reason, pub source: Source, pub summary: String,
    pub evidence: Option<Evidence>,
    /// The user closed or opened it from the pet. Not the same as the request being answered.
    pub read: bool,
    pub created_at: u64, pub updated_at: u64,
    #[serde(skip)] tool_key: Option<String>,
    #[serde(skip)] tool_use_id: Option<String>,
    /// Development diagnostics: where the pet last drew it ("bubble", "mark", "handle") and when.
    #[serde(skip)] displayed: Option<(String, u64)>,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Request {
    /// Is this chat connected to a pet? Asked before any notice text is sent.
    Check { session_id: String },
    Notify {
        session_id: String, turn_id: String, source: Source, kind: Kind, reason: Reason, summary: String,
        fingerprint: String,
        #[serde(default)] chat_title: Option<String>,
        #[serde(default)] tool_key: Option<String>,
        #[serde(default)] tool_use_id: Option<String>,
        #[serde(default)] evidence: Option<Evidence>,
    },
    Resolve {
        session_id: String, turn_id: String, cause: Cause,
        #[serde(default)] tool_key: Option<String>,
        #[serde(default)] tool_use_id: Option<String>,
    },
    /// Development diagnostics: ids, kinds and states only (no notice text).
    Status {},
}

fn safe_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
fn valid_session(value: &str) -> bool { uuid::Uuid::parse_str(value).is_ok() }
fn valid_turn(value: &str) -> bool { safe_text(value, 128) }
fn valid_key(value: &str) -> bool { value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit()) }
fn valid_tool_use(value: &str) -> bool { safe_text(value, 128) }
fn push_limited(list: &mut VecDeque<String>, value: String, max: usize) {
    if !list.contains(&value) { list.push_back(value); }
    while list.len() > max { list.pop_front(); }
}
/// Codex turn ids are UUIDv7 (time-ordered), so a plain comparison orders them; any
/// other id format is treated as unordered and never considered stale.
fn older(turn: &str, than: &str) -> bool {
    uuid::Uuid::parse_str(turn).ok().zip(uuid::Uuid::parse_str(than).ok())
        .is_some_and(|(a, b)| a.get_version_num() == 7 && b.get_version_num() == 7 && a < b)
}

/// A chat is eligible when it has a connected pet link, or when it is the chat that started
/// this app with `$autopets` (the setup chat, until the user disconnects it). Saved links come
/// back disconnected after an app restart; the setup chat stays eligible through that.
pub fn eligible(links: &HashMap<String, Link>, setup: Option<&Target>, session_id: &str) -> Result<Target, &'static str> {
    if let Some(link) = links.values().find(|link| link.target.thread_id == session_id && link.connected) {
        return Ok(link.target.clone());
    }
    setup.filter(|target| target.thread_id == session_id).cloned().ok_or("chat-not-connected")
}

#[derive(Default)]
struct Chat {
    open: Vec<Notice>,
    seen: VecDeque<String>,
    /// Turns Codex reported as ended, and tool calls that finished, so a late notice for them is dropped.
    ended_turns: VecDeque<String>,
    finished_tools: VecDeque<String>,
    /// The newest turn the user started by writing in the chat.
    latest_user_turn: Option<String>,
}

#[derive(Default)]
pub struct Attention { chats: HashMap<String, Chat> }

impl Attention {
    pub fn request(&mut self, links: &HashMap<String, Link>, setup: Option<&Target>, input: Request, now: u64) -> Result<serde_json::Value, String> {
        self.prune(links, setup);
        match input {
            Request::Status {} => {
                let chats: Vec<_> = links.values().filter(|link| link.connected).map(|link| serde_json::json!({"threadId":link.target.thread_id,"slot":link.slot,"link":"connected"}))
                    .chain(links.values().filter(|link| !link.connected).map(|link| serde_json::json!({"threadId":link.target.thread_id,"slot":link.slot,"link":"disconnected"})))
                    .collect();
                let notices: Vec<_> = self.chats.values().flat_map(|chat| chat.open.iter()).map(|item| serde_json::json!({
                    "id":item.id,"threadId":item.target.thread_id,"turnId":item.turn_id,"kind":item.kind,"reason":item.reason,"source":item.source,
                    "read":item.read,"createdAt":item.created_at,"displayedOn":item.displayed.as_ref().map(|d| d.0.clone()),"displayedAt":item.displayed.as_ref().map(|d| d.1),
                })).collect();
                Ok(serde_json::json!({"ok":true,"setupChat":setup.map(|target| target.thread_id.clone()),"links":chats,"notices":notices}))
            }
            Request::Check { session_id } => {
                if !valid_session(&session_id) { return Err("invalid-attention".into()); }
                Ok(match eligible(links, setup, &session_id) {
                    Ok(_) => serde_json::json!({"ok":true,"eligible":true}),
                    Err(reason) => serde_json::json!({"ok":true,"eligible":false,"reason":reason}),
                })
            }
            Request::Notify { session_id, turn_id, source, kind, reason, summary, fingerprint, chat_title, tool_key, tool_use_id, evidence } => {
                let consistent = match source {
                    Source::Stop => matches!((kind, reason), (Kind::Completed, Reason::Completed) | (Kind::ActionRequired, Reason::Question | Reason::ConfirmationRequired)),
                    Source::Permission => kind == Kind::ActionRequired && reason == Reason::ApprovalRequired && tool_key.as_deref().is_some_and(valid_key),
                    Source::UserInput => kind == Kind::ActionRequired && reason == Reason::Question,
                };
                if !valid_session(&session_id) || !valid_turn(&turn_id) || !safe_text(&summary, MAX_SUMMARY_CHARS) || !valid_key(&fingerprint) || !consistent
                    || chat_title.as_deref().is_some_and(|title| !safe_text(title, MAX_TITLE_CHARS))
                    || tool_key.as_deref().is_some_and(|key| !valid_key(key))
                    || tool_use_id.as_deref().is_some_and(|id| !valid_tool_use(id))
                    || (evidence.is_some() && kind != Kind::Completed) {
                    return Err("invalid-attention".into());
                }
                let target = eligible(links, setup, &session_id).map_err(str::to_owned)?;
                let chat = self.chats.entry(session_id.clone()).or_default();
                // Hooks run asynchronously: a notice may arrive after the wait it describes already ended.
                if chat.latest_user_turn.as_deref().is_some_and(|latest| latest != turn_id && older(&turn_id, latest)) {
                    return Ok(serde_json::json!({"ok":true,"stale":true}));
                }
                if source != Source::Stop && (chat.ended_turns.contains(&turn_id)
                    || tool_key.as_ref().is_some_and(|key| chat.finished_tools.contains(&format!("{turn_id}:{key}")))
                    || tool_use_id.as_ref().is_some_and(|id| chat.finished_tools.contains(&format!("{turn_id}:{id}")))) {
                    return Ok(serde_json::json!({"ok":true,"stale":true}));
                }
                let fingerprint = fingerprint.to_ascii_lowercase();
                if chat.seen.contains(&fingerprint) { return Ok(serde_json::json!({"ok":true,"duplicate":true})); }
                push_limited(&mut chat.seen, fingerprint, SEEN_PER_CHAT);
                // One answer per turn end: a new turn-end notice replaces this chat's older ones.
                if source == Source::Stop { chat.open.retain(|item| item.source != Source::Stop); }
                let notice = Notice {
                    id: uuid::Uuid::new_v4().simple().to_string(), target, chat_title, turn_id, kind, reason, source,
                    summary: summary.trim().to_owned(), evidence, read: false, created_at: now, updated_at: now, tool_key, tool_use_id, displayed: None,
                };
                let id = notice.id.clone();
                chat.open.push(notice);
                while chat.open.len() > OPEN_PER_CHAT { chat.open.remove(0); }
                Ok(serde_json::json!({"ok":true,"duplicate":false,"id":id}))
            }
            Request::Resolve { session_id, turn_id, cause, tool_key, tool_use_id } => {
                if !valid_session(&session_id) || !valid_turn(&turn_id)
                    || tool_key.as_deref().is_some_and(|key| !valid_key(key))
                    || tool_use_id.as_deref().is_some_and(|id| !valid_tool_use(id)) {
                    return Err("invalid-attention".into());
                }
                // Ids only; an unconnected chat keeps no state at all.
                if eligible(links, setup, &session_id).is_err() { return Ok(serde_json::json!({"ok":true,"resolved":0})); }
                let chat = self.chats.entry(session_id).or_default();
                let before = chat.open.len();
                match cause {
                    // The user wrote in the chat: every earlier ask is answered and earlier results were seen.
                    Cause::UserMessage => {
                        if chat.latest_user_turn.as_deref().is_none_or(|latest| !older(&turn_id, latest)) { chat.latest_user_turn = Some(turn_id.clone()); }
                        chat.open.retain(|item| item.turn_id == turn_id);
                    }
                    Cause::ToolFinished => {
                        if let Some(key) = &tool_key { push_limited(&mut chat.finished_tools, format!("{turn_id}:{key}"), ENDED_PER_CHAT * 2); }
                        if let Some(id) = &tool_use_id { push_limited(&mut chat.finished_tools, format!("{turn_id}:{id}"), ENDED_PER_CHAT * 2); }
                        chat.open.retain(|item| !(item.turn_id == turn_id && (
                            (item.source == Source::Permission && item.tool_key.is_some() && item.tool_key == tool_key)
                            || (item.source == Source::UserInput && item.tool_use_id.is_some() && item.tool_use_id == tool_use_id))));
                    }
                    // A finished turn has no pending approval or question prompt any more.
                    Cause::TurnEnded => {
                        push_limited(&mut chat.ended_turns, turn_id.clone(), ENDED_PER_CHAT);
                        chat.open.retain(|item| !(item.turn_id == turn_id && item.source != Source::Stop));
                    }
                }
                Ok(serde_json::json!({"ok":true,"resolved":before - chat.open.len()}))
            }
        }
    }

    /// The user closed the bubble or opened the chat from it. The notice stays until Codex resolves it.
    pub fn mark_read(&mut self, links: &HashMap<String, Link>, setup: Option<&Target>, id: &str, now: u64) -> Result<Notice, String> {
        self.prune(links, setup);
        let item = self.chats.values_mut().flat_map(|chat| chat.open.iter_mut()).find(|item| item.id == id).ok_or("attention-not-found")?;
        item.read = true; item.updated_at = now;
        Ok(item.clone())
    }

    /// The pet drew this notice (development diagnostics only; no snapshot change).
    pub fn mark_displayed(&mut self, id: &str, surface: &str, now: u64) -> Result<(), String> {
        if !["bubble", "mark", "handle", "card"].contains(&surface) { return Err("invalid-attention".into()); }
        let item = self.chats.values_mut().flat_map(|chat| chat.open.iter_mut()).find(|item| item.id == id).ok_or("attention-not-found")?;
        item.displayed = Some((surface.to_owned(), now));
        Ok(())
    }

    pub fn find(&self, id: &str) -> Option<&Notice> { self.chats.values().flat_map(|chat| chat.open.iter()).find(|item| item.id == id) }

    /// Open notices of connected chats; action_required first, then newest.
    pub fn snapshot(&self, links: &HashMap<String, Link>, setup: Option<&Target>) -> Vec<Notice> {
        let mut items: Vec<_> = self.chats.iter().filter(|(thread, _)| eligible(links, setup, thread).is_ok())
            .flat_map(|(_, chat)| chat.open.iter().cloned()).collect();
        items.sort_by(|a, b| (b.kind == Kind::ActionRequired).cmp(&(a.kind == Kind::ActionRequired))
            .then(b.created_at.cmp(&a.created_at)).then(a.id.cmp(&b.id)));
        items
    }

    /// Drops everything for chats that are no longer connected.
    pub fn prune(&mut self, links: &HashMap<String, Link>, setup: Option<&Target>) {
        self.chats.retain(|thread, _| eligible(links, setup, thread).is_ok());
    }
}
