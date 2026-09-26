//! Explicit local attachment is independent of hook-observed sessions and accounts.
use serde::{Deserialize, Serialize};
use super::roles::Template;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target { pub source_id: String, pub thread_id: String, pub cwd: String }
impl Target {
    pub fn validate(&self) -> Result<(), String> {
        if self.source_id != "codex-windows-local" || uuid::Uuid::parse_str(&self.thread_id).is_err()
            || !std::path::Path::new(&self.cwd).is_absolute() || self.cwd.len() > 4096 || self.cwd.chars().any(char::is_control) {
            return Err("invalid-pet-target".into());
        }
        Ok(())
    }
    pub fn key(&self) -> String { format!("{}:{}", self.source_id, self.thread_id) }
    pub fn matches(&self, other: &Self) -> bool {
        self.source_id == other.source_id && self.thread_id == other.thread_id
            && self.cwd.replace('\\', "/").trim_end_matches('/').to_lowercase() == other.cwd.replace('\\', "/").trim_end_matches('/').to_lowercase()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Profile { Light, Standard, Careful, Plan }
impl Profile {
    pub fn settings(&self) -> (&'static str, &'static str) {
        match self { Self::Light | Self::Plan => ("gpt-6-luna", "low"), Self::Standard => ("gpt-6-sol", "low"), Self::Careful => ("gpt-6-sol", "medium") }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RunState { Requested, Working, Returned, Waiting, Complete, Failed, Unknown }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Run {
    pub id: String, pub settings_revision: u64, pub profile: Profile, pub model: String, pub effort: String,
    pub state: RunState, pub child_id: Option<String>, pub turn_id: Option<String>,
    pub observed_model: Option<String>, pub observed_effort: Option<String>, pub evidence: Option<String>,
    pub started_at: u64,
    #[serde(default)]
    pub agent_path: Option<String>,
    #[serde(default)]
    pub tracking_closed: bool,
}
impl Run {
    pub fn unresolved(&self) -> bool {
        !self.tracking_closed && matches!(self.state, RunState::Requested | RunState::Working | RunState::Returned | RunState::Unknown)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Link {
    pub version: u8, pub target: Target, pub slot: usize, pub revision: u64, pub enabled: bool,
    pub connected: bool, pub profile: Profile, pub template: Template, pub run: Option<Run>,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Request {
    Read { target: Target },
    Connect { target: Target },
    Settings { target: Target, expected_revision: u64, profile: Profile },
    Enable { target: Target, expected_revision: u64, enabled: bool },
    Disconnect { target: Target, expected_revision: u64 },
    CloseTracking { target: Target, expected_revision: u64, request_id: String },
    Prepare { target: Target, expected_revision: u64, request_id: String, profile: Profile },
    Report { target: Target, expected_revision: u64, request_id: String, receipt: Receipt },
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Receipt {
    Spawned { agent_path: String },
    Returned,
    Failed,
    Runtime { parent_id: String, child_id: String, turn_id: String, model: String, effort: String, completed: bool },
}
