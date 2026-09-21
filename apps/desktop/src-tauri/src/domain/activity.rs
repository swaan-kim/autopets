pub use super::supervision::*;
use crate::legacy::approval::Approval;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sessions: Vec<Session>,
    pub slots: Vec<Slot>,
    pub approvals: Vec<Approval>,
    pub approval_enabled: bool,
    pub connection_path: String,
    pub now: u64,
    pub capabilities: Capabilities,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub token_usage: &'static str,
    pub task_return: &'static str,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub label: String,
    pub cwd: String,
    pub state: SessionState,
    pub unread: bool,
    pub last_seen: u64,
    pub last_tool: Option<String>,
    pub connection: ConnectionState,
    #[serde(default, flatten)]
    pub supervision: SessionSupervision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Idle,
    Working,
    Waiting,
    Done,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Observed,
    Unknown,
    Ended,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub index: usize,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventInput {
    pub event_id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub kind: EventKind,
    pub cwd: String,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub timestamp: u64,
    pub activity: Option<Activity>,
    pub plan: Option<PlanPayload>,
    pub tool_error: Option<bool>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    SessionStarted,
    TurnStarted,
    ToolStarted,
    ToolFinished,
    TurnFinished,
    Interrupted,
    SessionEnded,
    PlanUpdated,
    PermissionRequested,
}

#[derive(Clone, Debug)]
pub(crate) struct SessionRecord {
    pub(crate) view: Session,
    pub(crate) active_turn: Option<String>,
    pub(crate) last_activity_timestamp: u64,
    pub(crate) turn_finished: bool,
    pub(crate) supervision: SupervisionRecord,
}

pub(crate) fn validate_id(value: &str, name: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        Err(format!("Invalid {name}"))
    } else {
        Ok(())
    }
}
