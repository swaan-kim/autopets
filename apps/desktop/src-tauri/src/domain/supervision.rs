use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InterventionMode {
    #[default]
    WhenNeeded,
    Milestones,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    #[default]
    Idle,
    Research,
    Writing,
    Tool,
    Working,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanStep {
    pub step: String,
    pub status: PlanStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanPayload {
    pub steps: Vec<PlanStep>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttentionKind {
    Elapsed,
    Milestone,
    Permission,
    ToolError,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attention {
    pub id: String,
    pub kind: AttentionKind,
    pub summary: String,
    pub created_at: u64,
    pub snoozed_until: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionSupervision {
    pub completion_criterion: String,
    pub intervention_mode: InterventionMode,
    pub activity: Activity,
    pub plan_steps: Vec<PlanStep>,
    pub plan_updated_at: Option<u64>,
    pub turn_started_at: Option<u64>,
    pub turn_ended_at: Option<u64>,
    pub elapsed_alert_minutes: Option<u32>,
    pub attention: Option<Attention>,
    pub tool_activity_v1: Option<super::tool_activity::ToolActivity>,
}

impl Default for SessionSupervision {
    fn default() -> Self {
        Self {
            completion_criterion: String::new(),
            intervention_mode: InterventionMode::WhenNeeded,
            activity: Activity::Idle,
            plan_steps: Vec::new(),
            plan_updated_at: None,
            turn_started_at: None,
            turn_ended_at: None,
            elapsed_alert_minutes: Some(10),
            attention: None,
            tool_activity_v1: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttentionRecord {
    pub(crate) view: Attention,
    pub(crate) turn_id: String,
    #[serde(default)]
    pub(crate) tool_call_id: Option<String>,
    pub(crate) acknowledged_at: Option<u64>,
    pub(crate) closed: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct SupervisionRecord {
    #[serde(flatten)]
    pub view: SessionSupervision,
    pub(crate) records: Vec<AttentionRecord>,
    pub(crate) elapsed_alerted_turn: Option<String>,
}

impl SupervisionRecord {
    pub(crate) fn for_snapshot(&self, now: u64) -> SessionSupervision {
        let mut view = self.view.clone();
        // A snoozed elapsed alert must not hide a newly observed permission request.
        view.attention = self
            .records
            .iter()
            .filter(|a| a.acknowledged_at.is_none() && !a.closed)
            .min_by_key(|a| {
                (
                    a.view.snoozed_until.is_some_and(|until| until > now),
                    match a.view.kind {
                        AttentionKind::Permission => 0,
                        AttentionKind::ToolError => 1,
                        AttentionKind::Elapsed => 2,
                        AttentionKind::Milestone => 3,
                    },
                    a.view.created_at,
                )
            })
            .map(|a| a.view.clone());
        view
    }

    pub(crate) fn add(
        &mut self,
        id: String,
        kind: AttentionKind,
        summary: String,
        turn_id: &str,
        tool_call_id: Option<&str>,
        now: u64,
    ) {
        if self.records.iter().any(|a| a.view.id == id) {
            return;
        }
        self.records.push(AttentionRecord {
            view: Attention {
                id,
                kind,
                summary,
                created_at: now,
                snoozed_until: None,
            },
            turn_id: turn_id.to_owned(),
            tool_call_id: tool_call_id.map(str::to_owned),
            acknowledged_at: None,
            closed: false,
        });
    }

    pub(crate) fn close_turn(&mut self, turn_id: &str) {
        for a in &mut self.records {
            if a.turn_id == turn_id {
                a.closed = true;
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskConfiguration {
    pub request_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub cwd: String,
    pub completion_criterion: String,
    pub intervention_mode: InterventionMode,
    pub elapsed_alert_minutes: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub session_id: String,
    pub turn_id: String,
    pub cwd: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConfigured {
    pub ok: bool,
    pub session_id: String,
    pub slot: usize,
}

pub(crate) fn normalized_cwd(cwd: &str) -> String {
    let replaced = cwd.replace('\\', "/");
    let trimmed = replaced.trim_end_matches('/');
    if cfg!(windows) || trimmed.as_bytes().get(1) == Some(&b':') || trimmed.starts_with("//") {
        trimmed.to_lowercase()
    } else {
        trimmed.to_owned()
    }
}

pub(crate) fn validate_configuration(criterion: &str, minutes: Option<u32>) -> Result<(), String> {
    if criterion.trim().is_empty()
        || criterion.chars().count() > 2000
        || criterion
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("완료 조건은 1–2,000자로 입력해주세요.".into());
    }
    if minutes.is_some_and(|m| m == 0 || m > 1440) {
        return Err("시간 알림은 1–1,440분 또는 끔으로 설정해주세요.".into());
    }
    Ok(())
}

pub(crate) fn validate_plan(plan: &PlanPayload) -> Result<(), String> {
    if plan.steps.len() > 50
        || plan.steps.iter().any(|s| {
            s.step.trim().is_empty()
                || s.step.chars().count() > 500
                || s.step
                    .chars()
                    .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
        })
    {
        return Err("Plan metadata exceeds the supported limits".into());
    }
    if plan
        .steps
        .iter()
        .filter(|s| s.status == PlanStatus::InProgress)
        .count()
        > 1
    {
        return Err("Plan contains multiple active steps".into());
    }
    Ok(())
}
