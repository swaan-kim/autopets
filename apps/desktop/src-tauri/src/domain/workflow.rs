//! Versioned plan/execution policy. Observations are evidence, never requested settings.
use crate::domain::assistance::{bounded, err, Identity};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Light,
    Balanced,
    Complex,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Unknown,
    Planning,
    Ready,
    Executing,
    Review,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Model {
    pub model: String,
    pub reasoning: String,
}
impl Model {
    pub fn validate(&self) -> Result<(), String> {
        bounded(&self.model, 128, false)?;
        if !self
            .model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        {
            return Err("Invalid model slug".into());
        }
        if ![
            "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
        ]
        .contains(&self.reasoning.as_str())
        {
            return Err("Unsupported reasoning value".into());
        }
        Ok(())
    }
}
pub fn profiles(preset: Preset) -> (Model, Model) {
    let make = |model: &str, reasoning: &str| Model {
        model: model.into(),
        reasoning: reasoning.into(),
    };
    match preset {
        Preset::Light => (make("gpt-5.6-sol", "medium"), make("gpt-5.6-luna", "low")),
        Preset::Balanced => (
            make("gpt-5.6-sol", "medium"),
            make("gpt-5.6-terra", "medium"),
        ),
        Preset::Complex => (make("gpt-6-astra", "high"), make("gpt-6-astra", "medium")),
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub version: u8,
    pub enabled: bool,
    pub preset: Preset,
    pub plan_first: bool,
    pub planning: Model,
    pub execution: Model,
    pub revision: u64,
}
impl Default for Preferences {
    fn default() -> Self {
        let (planning, execution) = profiles(Preset::Balanced);
        Self {
            version: 1,
            enabled: false,
            preset: Preset::Balanced,
            plan_first: true,
            planning,
            execution,
            revision: 0,
        }
    }
}
impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported workflow version".into());
        }
        self.planning.validate()?;
        self.execution.validate()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub summary: String,
    pub steps: Vec<String>,
    pub completion_criteria: Vec<String>,
}
impl Plan {
    pub fn validate(&self) -> Result<(), String> {
        bounded(&self.summary, 1024, false)?;
        for values in [&self.steps, &self.completion_criteria] {
            if values.len() > 12 {
                return Err("Too many plan items".into());
            }
            for value in values {
                bounded(value, 512, false)?;
            }
        }
        if serde_json::to_vec(self).map_err(err)?.len() > 3072 {
            return Err("Plan exceeds 3072 UTF-8 bytes".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub mode: Option<String>,
    pub source: String,
    pub observed_at: u64,
    pub submission_id: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuardStatus {
    Pending,
    Matched,
    Held,
    Exception,
    Unavailable,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guard {
    pub status: GuardStatus,
    pub reason: String,
    pub submission_id: Option<String>,
    pub request_fingerprint: Option<String>,
    pub checked_at: Option<u64>,
}
impl Guard {
    pub fn pending(reason: &str) -> Self {
        Self {
            status: GuardStatus::Pending,
            reason: reason.into(),
            submission_id: None,
            request_fingerprint: None,
            checked_at: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub plan_revision: u64,
    pub settings_revision: u64,
    pub approved_at: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuidanceBinding {
    pub settings_revision: u64,
    pub plan_revision: u64,
    pub phase: Phase,
    pub approval: Option<Approval>,
    pub submission_id: String,
}
impl GuidanceBinding {
    pub fn same_policy(&self, other: &Self) -> bool {
        self.settings_revision == other.settings_revision
            && self.plan_revision == other.plan_revision
            && self.phase == other.phase
            && self.approval == other.approval
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub identity: Identity,
    pub enabled: bool,
    pub preset: Preset,
    pub plan_first: bool,
    pub planning: Model,
    pub execution: Model,
    pub phase: Phase,
    pub settings_revision: u64,
    pub plan_revision: u64,
    pub plan: Option<Plan>,
    pub approval: Option<Approval>,
    pub observation: Option<Observation>,
    pub guard: Guard,
    pub once_available: bool,
    pub updated_at: u64,
}
impl Task {
    pub fn approved(&self) -> bool {
        self.approval.as_ref().is_some_and(|a| {
            a.plan_revision == self.plan_revision && a.settings_revision == self.settings_revision
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub enabled: bool,
    pub preset: Preset,
    pub plan_first: bool,
    pub planning: Model,
    pub execution: Model,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub session_id: String,
    pub cwd: String,
    pub turn_id: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Intent {
    NewWork,
    SimpleEdit,
    Continue,
    Execute,
    Review,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub model: String,
    pub reasoning: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub model_observation: bool,
    pub reasoning_observation: bool,
    pub mode_observation: bool,
    pub submission_hold: bool,
    pub input_preservation: bool,
    pub single_submission: bool,
    pub request_identity: bool,
    pub model_switch: bool,
    pub reasoning_switch: bool,
    pub plan_mode_switch: bool,
    pub verification: &'static str,
    pub available_models: Vec<AvailableModel>,
}
pub fn capabilities() -> Capabilities {
    Capabilities {
        verification: "unverified",
        ..Capabilities::default()
    }
}
impl Capabilities {
    pub fn can_hold(&self) -> bool {
        self.verification == "verified"
            && self.submission_hold
            && self.input_preservation
            && self.single_submission
    }
}
#[derive(Serialize)]
pub struct Snapshot {
    pub preferences: Preferences,
    pub tasks: Vec<Task>,
    pub capabilities: BTreeMap<&'static str, Capabilities>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Read {
        identity: Identity,
        binding: Binding,
    },
    Preflight {
        identity: Identity,
        binding: Binding,
        #[serde(rename = "expectedSettingsRevision")]
        expected_settings_revision: u64,
        #[serde(rename = "expectedPlanRevision")]
        expected_plan_revision: u64,
        #[serde(rename = "submissionId")]
        submission_id: String,
        #[serde(rename = "requestFingerprint")]
        request_fingerprint: String,
        intent: Intent,
        observation: Option<Observation>,
        #[serde(default, rename = "explicitModel")]
        explicit_model: Option<String>,
        #[serde(default, rename = "planChanged")]
        plan_changed: bool,
    },
    RecordPlan {
        identity: Identity,
        binding: Binding,
        #[serde(rename = "expectedSettingsRevision")]
        expected_settings_revision: u64,
        #[serde(rename = "expectedPlanRevision")]
        expected_plan_revision: u64,
        plan: Plan,
    },
}
impl Request {
    pub fn identity_binding(&self) -> (&Identity, &Binding) {
        match self {
            Self::Read { identity, binding }
            | Self::Preflight {
                identity, binding, ..
            }
            | Self::RecordPlan {
                identity, binding, ..
            } => (identity, binding),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightResult {
    pub ok: bool,
    pub decision: String,
    pub reason: String,
    pub target: Option<Model>,
    pub task: Task,
    pub duplicate: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct OnceAllowance {
    pub request_fingerprint: String,
    pub after_submission: String,
    pub plan_revision: u64,
    pub settings_revision: u64,
    pub expires_at: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Submission {
    pub id: String,
    pub fingerprint: String,
    pub settings_revision: u64,
    pub plan_revision: u64,
    pub observation: Option<Observation>,
    pub intent: Intent,
    pub explicit_model: Option<String>,
    pub result: PreflightResult,
    pub once_eligible: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Record {
    pub version: u8,
    pub cwd: String,
    pub task: Task,
    pub once: Option<OnceAllowance>,
    pub submissions: Vec<Submission>,
    pub execution_turn: Option<String>,
}
pub(crate) fn invalidate(record: &mut Record, reason: &str) {
    record.once = None;
    record.task.once_available = false;
    record.task.observation = None;
    record.task.guard = Guard::pending(reason);
    record.submissions.clear();
    record.execution_turn = None;
}
pub(crate) fn check_revisions(record: &Record, settings: u64, plan: u64) -> Result<(), String> {
    if record.task.settings_revision != settings || record.task.plan_revision != plan {
        Err("Workflow revision is stale".into())
    } else {
        Ok(())
    }
}
