use crate::domain::activity::now_ms;
use crate::domain::assistance::{bounded, Identity};
pub(crate) use crate::domain::workflow::*;
use rusqlite::Connection;

pub struct WorkflowStore {
    pub(crate) db: Connection,
}
impl WorkflowStore {
    pub fn validate_guidance(
        &self,
        identity: &Identity,
        binding: &GuidanceBinding,
        turn_id: Option<&str>,
    ) -> Result<(), String> {
        let record = self.load(identity)?;
        check_revisions(&record, binding.settings_revision, binding.plan_revision)?;
        let observed_start = binding.phase == Phase::Ready
            && record.task.phase == Phase::Executing
            && record.execution_turn.as_deref() == turn_id
            && turn_id.is_some()
            && record.task.approved();
        if !record.task.enabled
            || record.task.approval != binding.approval
            || (record.task.phase != binding.phase && !observed_start)
            || record.task.guard.submission_id.as_ref() != Some(&binding.submission_id)
            || record.task.guard.status == GuardStatus::Held
        {
            return Err("Workflow guidance binding is stale".into());
        }
        Ok(())
    }
    pub fn enabled(&self, identity: &Identity) -> Result<bool, String> {
        Ok(self
            .find(identity)?
            .is_some_and(|record| record.task.enabled))
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        Ok(Snapshot {
            preferences: self.preferences()?,
            tasks: self.records()?.into_iter().map(|r| r.task).collect(),
            capabilities: [("codex", capabilities()), ("chatgpt", capabilities())]
                .into_iter()
                .collect(),
        })
    }
    pub(crate) fn ensure(
        &mut self,
        identity: &Identity,
        binding: &Binding,
    ) -> Result<Record, String> {
        identity.key()?;
        bounded(&binding.cwd, 32768, false)?;
        if identity.chat_id != binding.session_id {
            return Err("Workflow session mismatch".into());
        }
        if let Some(record) = self.find(identity)? {
            if !same_cwd(&record.cwd, &binding.cwd) {
                return Err("Workflow project mismatch".into());
            }
            return Ok(record);
        }
        let preferences = self.preferences()?;
        let record = Record {
            version: 1,
            cwd: binding.cwd.clone(),
            once: None,
            submissions: vec![],
            execution_turn: None,
            task: Task {
                identity: identity.clone(),
                enabled: preferences.enabled,
                preset: preferences.preset,
                plan_first: preferences.plan_first,
                planning: preferences.planning,
                execution: preferences.execution,
                phase: Phase::Unknown,
                settings_revision: 0,
                plan_revision: 0,
                plan: None,
                approval: None,
                observation: None,
                guard: Guard::pending("다음 요청에서 계획과 실행 설정을 확인해요"),
                once_available: false,
                updated_at: now_ms(),
            },
        };
        self.put(&record)?;
        Ok(record)
    }
    pub fn save_preferences(
        &mut self,
        mut preferences: Preferences,
    ) -> Result<Preferences, String> {
        preferences.validate()?;
        let old = self.preferences()?;
        if old.revision != preferences.revision {
            return Err("Workflow preferences revision is stale".into());
        }
        if preferences == old {
            return Ok(old);
        }
        preferences.revision += 1;
        // All defaults, including enabled, affect only newly connected tasks.
        self.persist(Some(&preferences), &[])?;
        Ok(preferences)
    }
    pub fn disable_global(&mut self) -> Result<(), String> {
        let mut preferences = self.preferences()?;
        preferences.enabled = false;
        let old = self.preferences()?;
        if old.enabled {
            preferences.revision += 1;
        }
        let mut records = self.records()?;
        for record in &mut records {
            if record.task.enabled {
                record.task.settings_revision += 1;
            }
            record.task.enabled = false;
            record.task.approval = None;
            invalidate(record, "자동 도움이 꺼져 있어요");
        }
        self.persist(Some(&preferences), &records)
    }
    pub fn configure(
        &mut self,
        identity: Identity,
        configuration: Configuration,
        expected_revision: u64,
    ) -> Result<Task, String> {
        configuration.planning.validate()?;
        configuration.execution.validate()?;
        let mut record = self.load(&identity)?;
        if record.task.settings_revision != expected_revision {
            return Err("Workflow settings revision is stale".into());
        }
        let task = &record.task;
        if task.enabled == configuration.enabled
            && task.preset == configuration.preset
            && task.plan_first == configuration.plan_first
            && task.planning == configuration.planning
            && task.execution == configuration.execution
        {
            return Ok(task.clone());
        }
        record.task.enabled = configuration.enabled;
        record.task.preset = configuration.preset;
        record.task.plan_first = configuration.plan_first;
        record.task.planning = configuration.planning;
        record.task.execution = configuration.execution;
        record.task.settings_revision += 1;
        record.task.updated_at = now_ms();
        record.task.approval = None;
        if record.task.plan_first {
            record.task.phase = if record.task.plan.is_some() {
                Phase::Ready
            } else {
                Phase::Planning
            };
        }
        invalidate(
            &mut record,
            "설정을 저장했어요. 다음 요청에서 다시 확인해요",
        );
        self.put(&record)?;
        Ok(record.task)
    }
    pub fn disable_chat(&mut self, identity: &Identity) -> Result<(), String> {
        if let Some(mut record) = self.find(identity)? {
            if record.task.enabled {
                record.task.settings_revision += 1;
            }
            record.task.enabled = false;
            record.task.approval = None;
            invalidate(&mut record, "이번 채팅의 자동 도움이 꺼져 있어요");
            self.put(&record)?;
        }
        Ok(())
    }
    pub fn invalidate_plan(&mut self, identity: &Identity) -> Result<(), String> {
        if let Some(mut record) = self.find(identity)? {
            if record.task.plan.is_some() || record.task.approval.is_some() {
                record.task.plan_revision += 1;
                record.task.plan = None;
                record.task.approval = None;
                record.task.phase = Phase::Planning;
            }
            invalidate(&mut record, "바뀐 조건을 반영한 계획을 다시 확인해주세요");
            self.put(&record)?;
        }
        Ok(())
    }
    pub fn erase(&mut self, identity: Option<&Identity>) -> Result<(), String> {
        let mut records = if let Some(identity) = identity {
            self.find(identity)?.into_iter().collect()
        } else {
            self.records()?
        };
        for record in &mut records {
            record.task.plan = None;
            record.task.plan_revision += 1;
            record.task.approval = None;
            record.task.phase = Phase::Unknown;
            record.task.updated_at = now_ms();
            invalidate(record, "계획과 관측 기록을 삭제했어요");
        }
        self.persist(None, &records)
    }
    pub fn approve(
        &mut self,
        identity: Identity,
        plan_revision: u64,
        settings_revision: u64,
    ) -> Result<Task, String> {
        let mut record = self.load(&identity)?;
        check_revisions(&record, settings_revision, plan_revision)?;
        if !record.task.enabled {
            return Err("Workflow assistance is off".into());
        }
        if !matches!(record.task.phase, Phase::Planning | Phase::Ready) {
            return Err("No current planning phase is ready for approval".into());
        }
        if record.task.approved() {
            return Ok(record.task);
        }
        invalidate(
            &mut record,
            "계획을 확인했어요. 다음 요청에서 실행 설정을 확인해요",
        );
        record.task.approval = Some(Approval {
            plan_revision,
            settings_revision,
            approved_at: now_ms(),
        });
        record.task.phase = Phase::Ready;
        record.task.updated_at = now_ms();
        self.put(&record)?;
        Ok(record.task)
    }
    pub fn allow_once(
        &mut self,
        identity: Identity,
        submission_id: String,
        plan_revision: u64,
        settings_revision: u64,
    ) -> Result<Task, String> {
        let mut record = self.load(&identity)?;
        check_revisions(&record, settings_revision, plan_revision)?;
        if !record.task.enabled {
            return Err("Workflow assistance is off".into());
        }
        if record.task.guard.status != GuardStatus::Held
            || record.task.guard.submission_id.as_ref() != Some(&submission_id)
        {
            return Err("No matching held submission".into());
        }
        if !record
            .submissions
            .iter()
            .any(|s| s.id == submission_id && s.once_eligible)
        {
            return Err(
                "Complete request identity is not verified for a one-time exception".into(),
            );
        }
        if record.once.is_some() {
            return Ok(record.task);
        }
        let fingerprint = record
            .task
            .guard
            .request_fingerprint
            .clone()
            .ok_or("Missing held request fingerprint")?;
        record.once = Some(OnceAllowance {
            request_fingerprint: fingerprint,
            after_submission: submission_id,
            plan_revision,
            settings_revision,
            expires_at: now_ms() + 10 * 60_000,
        });
        record.task.once_available = true;
        record.task.updated_at = now_ms();
        self.put(&record)?;
        Ok(record.task)
    }
    pub fn dispatch(
        &mut self,
        request: Request,
        fixed_model: Option<String>,
    ) -> Result<serde_json::Value, String> {
        self.dispatch_with_capabilities(request, fixed_model, capabilities())
    }
    fn dispatch_with_capabilities(
        &mut self,
        request: Request,
        fixed_model: Option<String>,
        capability: Capabilities,
    ) -> Result<serde_json::Value, String> {
        let preferences = self.preferences()?;
        let (identity, binding) = request.identity_binding();
        let mut record = self.ensure(identity, binding)?;
        match request {
            Request::Read { .. } => Ok(
                serde_json::json!({"preferences":preferences,"task":record.task,"capabilities":capability}),
            ),
            Request::RecordPlan {
                expected_settings_revision,
                expected_plan_revision,
                plan,
                ..
            } => {
                check_revisions(&record, expected_settings_revision, expected_plan_revision)?;
                if !record.task.enabled {
                    return Err("Workflow assistance is off".into());
                }
                plan.validate()?;
                if record.task.plan.as_ref() != Some(&plan) {
                    record.task.plan_revision += 1;
                    record.task.plan = Some(plan);
                    record.task.approval = None;
                    record.task.phase = Phase::Ready;
                    record.task.updated_at = now_ms();
                    invalidate(&mut record, "계획을 확인하고 이대로 진행을 선택해주세요");
                    self.put(&record)?;
                }
                Ok(serde_json::json!({"ok":true,"task":record.task}))
            }
            Request::Preflight {
                binding,
                expected_settings_revision,
                expected_plan_revision,
                submission_id,
                request_fingerprint,
                intent,
                observation,
                explicit_model,
                plan_changed,
                ..
            } => {
                bounded(&submission_id, 200, false)?;
                if request_fingerprint.len() != 64
                    || !request_fingerprint
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                {
                    return Err("Invalid request fingerprint".into());
                }
                let observation = verified_observation(observation, &submission_id, &capability)?;
                // Explicit intent is trusted only with a verified adapter; user-saved fixed settings are authoritative.
                let explicit_model = if capability.verification == "verified" {
                    explicit_model
                } else {
                    None
                };
                if let Some(model) = &explicit_model {
                    bounded(model, 128, false)?;
                }
                let effective_model = explicit_model.clone().or(fixed_model.clone());
                if let Some(previous) = record.submissions.iter().find(|s| s.id == submission_id) {
                    if previous.settings_revision != record.task.settings_revision
                        || previous.plan_revision != record.task.plan_revision
                        || previous.fingerprint != request_fingerprint
                        || previous.intent != intent
                        || previous.explicit_model != effective_model
                        || !same_observation(&previous.observation, &observation)
                    {
                        return Err("Submission identity conflicts with earlier request".into());
                    }
                    let mut result = previous.result.clone();
                    result.duplicate = true;
                    return serde_json::to_value(result).map_err(crate::domain::assistance::err);
                }
                check_revisions(&record, expected_settings_revision, expected_plan_revision)?;
                if record.once.as_ref().is_some_and(|once| {
                    once.request_fingerprint != request_fingerprint || once.expires_at < now_ms()
                }) {
                    record.once = None;
                    record.task.once_available = false;
                }
                if plan_changed {
                    record.task.plan_revision += 1;
                    record.task.plan = None;
                    record.task.approval = None;
                    record.task.phase = Phase::Unknown;
                    invalidate(&mut record, "새 조건으로 계획을 다시 준비해요");
                }
                let active = record.task.enabled;
                if active
                    && (record.task.phase == Phase::Unknown
                        || (intent == Intent::NewWork
                            && record.task.phase == Phase::Executing
                            && !record.task.approved()))
                {
                    record.task.phase = if record.task.plan_first && intent != Intent::SimpleEdit {
                        Phase::Planning
                    } else {
                        Phase::Executing
                    };
                }
                if active && intent == Intent::Review && record.task.phase == Phase::Executing {
                    record.task.phase = Phase::Review;
                }
                let planning_stage = record.task.phase == Phase::Planning
                    || (record.task.phase == Phase::Ready && !record.task.approved());
                let mut target = if active {
                    Some(if planning_stage {
                        record.task.planning.clone()
                    } else {
                        record.task.execution.clone()
                    })
                } else {
                    None
                };
                if let Some(model) = &effective_model {
                    if let Some(target) = &mut target {
                        target.model = model.clone();
                    }
                }
                let approved = !record.task.plan_first
                    || record.task.phase != Phase::Ready
                    || record.task.approved();
                let once_eligible = capability.request_identity
                    && capability.can_hold()
                    && observation
                        .as_ref()
                        .is_some_and(|value| value.source == "verified-adapter");
                let once = once_eligible
                    && record.once.as_ref().is_some_and(|once| {
                        once.request_fingerprint == request_fingerprint
                            && once.after_submission != submission_id
                            && once.plan_revision == record.task.plan_revision
                            && once.settings_revision == record.task.settings_revision
                            && once.expires_at >= now_ms()
                    });
                let (decision, status, reason) = if !active {
                    (
                        "passthrough",
                        GuardStatus::Unavailable,
                        "자동 도움이 꺼져 있어요",
                    )
                } else if !capability.can_hold() {
                    (
                        "passthrough",
                        GuardStatus::Unavailable,
                        "전송 보호 연결이 미검증이에요. 실행 전 설정을 직접 확인해주세요",
                    )
                } else if observation
                    .as_ref()
                    .and_then(|value| value.model.as_ref())
                    .is_none()
                {
                    (
                        "passthrough",
                        GuardStatus::Unavailable,
                        "현재 모델을 관측하지 못했어요. 직접 확인해주세요",
                    )
                } else if !target.as_ref().is_some_and(|target| {
                    capability.available_models.iter().any(|model| {
                        model.model == target.model && model.reasoning.contains(&target.reasoning)
                    })
                }) {
                    (
                        "passthrough",
                        GuardStatus::Unavailable,
                        "선택한 모델과 추론 수준의 사용 가능 여부를 확인하지 못했어요",
                    )
                } else if once {
                    record.once = None;
                    record.task.once_available = false;
                    (
                        "allow",
                        GuardStatus::Exception,
                        "이 요청만 현재 설정으로 진행하도록 확인했어요",
                    )
                } else if let (Some(observed), Some(target)) = (&observation, &target) {
                    let mismatch = observed.model.as_ref().is_some_and(|m| m != &target.model)
                        || observed
                            .reasoning
                            .as_ref()
                            .is_some_and(|r| r != &target.reasoning);
                    if mismatch {
                        ("hold", GuardStatus::Held, "저장한 실행 설정과 달라 전송을 보류했어요. 설정을 바꾸고 다시 보내주세요")
                    } else if observed.model.is_some() && observed.reasoning.is_some() {
                        (
                            "allow",
                            GuardStatus::Matched,
                            "현재 모델과 추론 수준이 저장한 설정과 일치해요",
                        )
                    } else {
                        (
                            "allow",
                            GuardStatus::Unavailable,
                            "모델은 일치해요. 추론 수준은 직접 확인해주세요",
                        )
                    }
                } else {
                    (
                        "passthrough",
                        GuardStatus::Unavailable,
                        "현재 모델을 관측하지 못했어요. 직접 확인해주세요",
                    )
                };
                if active && decision == "allow" && record.task.phase == Phase::Ready && approved {
                    record.task.phase = Phase::Executing;
                }
                record.execution_turn =
                    if active && decision != "hold" && !planning_stage && approved {
                        binding.turn_id.clone()
                    } else {
                        None
                    };
                record.task.observation = observation.clone();
                record.task.updated_at = now_ms();
                record.task.guard = Guard {
                    status,
                    reason: reason.into(),
                    submission_id: Some(submission_id.clone()),
                    request_fingerprint: Some(request_fingerprint.clone()),
                    checked_at: Some(now_ms()),
                };
                let result = PreflightResult {
                    ok: true,
                    decision: decision.into(),
                    reason: reason.into(),
                    target,
                    task: record.task.clone(),
                    duplicate: false,
                };
                record.submissions.push(Submission {
                    id: submission_id,
                    fingerprint: request_fingerprint,
                    settings_revision: record.task.settings_revision,
                    plan_revision: record.task.plan_revision,
                    observation,
                    intent,
                    explicit_model: effective_model,
                    result: result.clone(),
                    once_eligible,
                });
                if record.submissions.len() > 16 {
                    record.submissions.remove(0);
                }
                self.put(&record)?;
                serde_json::to_value(result).map_err(crate::domain::assistance::err)
            }
        }
    }
    pub fn observe_turn(
        &mut self,
        session_id: &str,
        turn_id: &str,
        finished: bool,
    ) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        let identity = Identity {
            provider: crate::domain::assistance::Provider::Codex,
            account_id: format!("session:{:x}", Sha256::digest(session_id.as_bytes())),
            chat_id: session_id.into(),
        };
        if let Some(mut record) = self.find(&identity)? {
            if record.task.enabled && record.execution_turn.as_deref() == Some(turn_id) {
                record.task.phase = if finished {
                    Phase::Review
                } else {
                    Phase::Executing
                };
                if finished {
                    record.execution_turn = None;
                }
                record.task.updated_at = now_ms();
                self.put(&record)?;
            }
        }
        Ok(())
    }
}
pub(crate) fn same_cwd(a: &str, b: &str) -> bool {
    let normalize = |value: &str| {
        value
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    normalize(a) == normalize(b)
}
pub(crate) fn context_affects_plan(
    a: &crate::domain::assistance::Context,
    b: &crate::domain::assistance::Context,
) -> bool {
    a.goal != b.goal
        || a.output_format != b.output_format
        || a.constraints != b.constraints
        || a.decisions != b.decisions
}
fn same_observation(a: &Option<Observation>, b: &Option<Observation>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            a.model == b.model
                && a.reasoning == b.reasoning
                && a.mode == b.mode
                && a.source == b.source
        }
        _ => false,
    }
}
fn verified_observation(
    input: Option<Observation>,
    submission_id: &str,
    capability: &Capabilities,
) -> Result<Option<Observation>, String> {
    let Some(mut input) = input else {
        return Ok(None);
    };
    if input.submission_id != submission_id
        || !["hook", "verified-adapter"].contains(&input.source.as_str())
    {
        return Err("Observation binding mismatch".into());
    }
    for value in [&input.model, &input.reasoning, &input.mode]
        .into_iter()
        .flatten()
    {
        bounded(value, 128, false)?;
    }
    if capability.verification != "verified" || input.observed_at.abs_diff(now_ms()) > 30_000 {
        return Ok(None);
    }
    if !capability.model_observation {
        input.model = None;
    }
    if !capability.reasoning_observation {
        input.reasoning = None;
    }
    if !capability.mode_observation {
        input.mode = None;
    }
    if input.model.is_none() && input.reasoning.is_none() && input.mode.is_none() {
        return Ok(None);
    }
    Ok(Some(input))
}

#[cfg(test)]
#[path = "tests/workflow.rs"]
mod tests;

impl crate::application::store::Store {
    pub fn save_assistance_preferences_control(
        &mut self,
        preferences: crate::domain::assistance::Preferences,
    ) -> Result<crate::domain::assistance::Preferences, String> {
        let was_enabled = self.assistance.preferences()?.enabled;
        let preferences = self.assistance.save_preferences(preferences)?;
        if was_enabled && !preferences.enabled {
            self.workflow.disable_global()?;
        }
        Ok(preferences)
    }
    pub fn configure_workflow_control(
        &mut self,
        identity: Identity,
        configuration: Configuration,
        revision: u64,
    ) -> Result<Task, String> {
        let was_enabled = self.workflow.enabled(&identity)?;
        let enabled = configuration.enabled;
        let task = self
            .workflow
            .configure(identity.clone(), configuration, revision)?;
        if !enabled || !was_enabled {
            match self.assistance.load(&identity) {
                Ok(_) => {
                    self.assistance.set_enabled(identity, enabled)?;
                }
                Err(e) if e == "Unknown assistance chat" => {}
                Err(e) => return Err(e),
            }
        }
        Ok(task)
    }
}
