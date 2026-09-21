use crate::domain::activity::now_ms;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const MAX_CONTEXT_BYTES: usize = 3072;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Chatgpt,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub provider: Provider,
    pub account_id: String,
    pub chat_id: String,
}
impl Identity {
    pub(crate) fn key(&self) -> Result<String, String> {
        bounded(&self.account_id, 200, false)?;
        bounded(&self.chat_id, 512, false)?;
        if self.account_id.chars().any(char::is_control)
            || self.chat_id.chars().any(char::is_control)
        {
            return Err("Invalid assistance identity".into());
        }
        serde_json::to_string(self).map_err(err)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkStyle {
    Auto,
    Fast,
    Thorough,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoutingMode {
    Auto,
    Fixed,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerLength {
    #[default]
    Concise,
    Normal,
    Detailed,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    #[default]
    Adaptive,
    Table,
    List,
    Document,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub enabled: bool,
    pub work_style: WorkStyle,
    #[serde(default)]
    pub answer_length: AnswerLength,
    #[serde(default)]
    pub output_format: OutputFormat,
    pub routing_mode: RoutingMode,
    pub fixed_model: Option<String>,
    pub allowed_models: Vec<String>,
    pub allow_escalation: bool,
    pub revision: u64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            work_style: WorkStyle::Auto,
            answer_length: AnswerLength::Concise,
            output_format: OutputFormat::Adaptive,
            routing_mode: RoutingMode::Auto,
            fixed_model: None,
            allowed_models: vec![],
            allow_escalation: false,
            revision: 0,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub goal: String,
    pub output_format: String,
    pub constraints: Vec<String>,
    pub decisions: Vec<String>,
    pub remaining: Vec<String>,
}
impl Context {
    pub(crate) fn validate(&self) -> Result<(), String> {
        bounded(&self.goal, 1024, true)?;
        bounded(&self.output_format, 512, true)?;
        for values in [&self.constraints, &self.decisions, &self.remaining] {
            list(values, 12, 512)?;
        }
        if serde_json::to_vec(self).map_err(err)?.len() > MAX_CONTEXT_BYTES {
            return Err("Context exceeds 3072 UTF-8 bytes".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Off,
    Pending,
    Prepared,
    Sent,
    Confirmed,
    Unavailable,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistanceState {
    pub status: Status,
    pub requested_model: Option<String>,
    pub applied_model: Option<String>,
    pub reason: String,
    pub injection_bytes: usize,
    #[serde(default)]
    pub context_partial: bool,
    #[serde(default)]
    pub included_context_keys: Vec<String>,
    pub updated_at: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QualityStatus {
    Unchecked,
    Passed,
    NeedsReview,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Quality {
    pub status: QualityStatus,
    pub findings: Vec<String>,
    pub repair_count: u8,
}
impl Default for Quality {
    fn default() -> Self {
        Self {
            status: QualityStatus::Unchecked,
            findings: vec![],
            repair_count: 0,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub identity: Identity,
    pub enabled: bool,
    pub context: Context,
    #[serde(default)]
    pub previous_context: Option<Context>,
    #[serde(default)]
    pub change_summary: String,
    #[serde(default)]
    pub work_style_override: Option<WorkStyle>,
    #[serde(default)]
    pub settings_revision: u64,
    pub revision: u64,
    pub updated_at: u64,
    pub assistance: AssistanceState,
    pub recipe_id: Option<String>,
    pub quality: Quality,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub input_assistance: bool,
    pub model_switch: bool,
    pub reasoning_switch: bool,
    pub context_sync: bool,
    pub token_usage: bool,
    pub additional_repair: bool,
    pub verification: &'static str,
}
pub fn capabilities() -> BTreeMap<&'static str, Capabilities> {
    ["codex", "chatgpt"]
        .into_iter()
        .map(|provider| {
            (
                provider,
                Capabilities {
                    input_assistance: false,
                    model_switch: false,
                    reasoning_switch: false,
                    context_sync: false,
                    token_usage: false,
                    additional_repair: false,
                    verification: "unverified",
                },
            )
        })
        .collect()
}
#[derive(Serialize)]
pub struct Overview {
    pub preferences: Preferences,
    pub tasks: Vec<Task>,
    pub capabilities: BTreeMap<&'static str, Capabilities>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub session_id: String,
    pub turn_id: String,
    pub cwd: String,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Read {
        identity: Identity,
        binding: Option<Binding>,
    },
    Prepare {
        identity: Identity,
        binding: Option<Binding>,
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
        #[serde(rename = "preferencesRevision")]
        preferences_revision: u64,
        #[serde(default, rename = "settingsRevision")]
        settings_revision: u64,
        #[serde(rename = "recipeId")]
        recipe_id: String,
        #[serde(rename = "requestedModel")]
        requested_model: Option<String>,
        reason: String,
        #[serde(rename = "injectionBytes")]
        injection_bytes: usize,
        #[serde(rename = "guidanceHash")]
        guidance_hash: String,
        #[serde(default, rename = "contextPartial")]
        context_partial: bool,
        #[serde(default, rename = "includedContextKeys")]
        included_context_keys: Vec<String>,
    },
    Delivered {
        identity: Identity,
        binding: Option<Binding>,
        nonce: String,
        evidence: String,
    },
    Context {
        identity: Identity,
        binding: Option<Binding>,
        nonce: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
        context: Context,
    },
    Sync {
        identity: Identity,
        binding: Option<Binding>,
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
        context: Context,
    },
    Quality {
        identity: Identity,
        binding: Option<Binding>,
        nonce: String,
        quality: Quality,
    },
}
impl Request {
    pub fn identity_binding(&self) -> (&Identity, Option<&Binding>) {
        match self {
            Self::Read { identity, binding }
            | Self::Prepare {
                identity, binding, ..
            }
            | Self::Delivered {
                identity, binding, ..
            }
            | Self::Context {
                identity, binding, ..
            }
            | Self::Sync {
                identity, binding, ..
            }
            | Self::Quality {
                identity, binding, ..
            } => (identity, binding.as_ref()),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    pub(crate) nonce: String,
    pub(crate) binding: Option<Binding>,
    pub(crate) preferences_revision: u64,
    pub(crate) context_revision: u64,
    pub(crate) hash: String,
    pub(crate) delivered: bool,
    pub(crate) context_written: bool,
    pub(crate) quality_written: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Record {
    pub(crate) task: Task,
    pub(crate) receipt: Option<Receipt>,
}

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub(crate) fn bounded(value: &str, max: usize, empty: bool) -> Result<(), String> {
    if (!empty && value.trim().is_empty())
        || value.len() > max
        || value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err("Invalid or oversized assistance value".into());
    }
    Ok(())
}
pub(crate) fn list(values: &[String], max: usize, bytes: usize) -> Result<(), String> {
    if values.len() > max {
        return Err("Too many assistance items".into());
    }
    for value in values {
        bounded(value, bytes, false)?;
    }
    Ok(())
}

pub(crate) fn check_revision(record: &Record, expected: u64) -> Result<(), String> {
    if record.task.revision != expected {
        Err("Context revision is stale".into())
    } else {
        Ok(())
    }
}
pub(crate) fn receipt<'a>(
    record: &'a mut Record,
    nonce: &str,
    binding: &Option<Binding>,
    preferences_revision: u64,
) -> Result<&'a mut Receipt, String> {
    let receipt = record
        .receipt
        .as_mut()
        .ok_or("No active assistance receipt")?;
    if receipt.nonce != nonce
        || &receipt.binding != binding
        || receipt.preferences_revision != preferences_revision
    {
        return Err("Stale or invalid assistance receipt".into());
    }
    Ok(receipt)
}
pub(crate) fn reset_pending(record: &mut Record, global_enabled: bool) {
    record.receipt = None;
    record.task.assistance = AssistanceState {
        status: if global_enabled && record.task.enabled {
            Status::Pending
        } else {
            Status::Off
        },
        requested_model: None,
        applied_model: None,
        reason: if global_enabled && record.task.enabled {
            "전달 대기"
        } else {
            "자동 도움이 꺼져 있어요"
        }
        .into(),
        injection_bytes: 0,
        context_partial: false,
        included_context_keys: vec![],
        updated_at: now_ms(),
    };
}
pub(crate) fn erase_context(record: &mut Record, enabled: bool) {
    record.task.context = Context::default();
    record.task.previous_context = None;
    record.task.change_summary.clear();
    record.task.revision += 1;
    record.task.updated_at = now_ms();
    record.task.recipe_id = None;
    record.task.quality = Quality::default();
    reset_pending(record, enabled);
}

pub(crate) fn replace_context(record: &mut Record, context: Context) {
    let prior = &record.task.context;
    let mut fields = vec![];
    if prior.goal != context.goal {
        fields.push("목표");
    }
    if prior.output_format != context.output_format {
        fields.push("결과 형식");
    }
    if prior.constraints != context.constraints {
        fields.push("조건");
    }
    if prior.decisions != context.decisions {
        fields.push("결정");
    }
    if prior.remaining != context.remaining {
        fields.push("남은 일");
    }
    record.task.previous_context = Some(std::mem::replace(&mut record.task.context, context));
    record.task.change_summary = format!("변경: {}", fields.join(" · "));
    record.task.revision += 1;
    record.task.updated_at = now_ms();
    record.task.quality = Quality::default();
}
