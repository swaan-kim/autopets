use super::store::*;
use crate::domain::supervision::*;
use sha2::{Digest, Sha256};

impl Store {
    pub fn configure_session(
        &mut self,
        session_id: &str,
        criterion: &str,
        mode: InterventionMode,
        minutes: Option<u32>,
    ) -> Result<(), String> {
        // The local manager may configure a pet without inventing a completion
        // condition. An empty field preserves a previously observed condition.
        validate_configuration(
            if criterion.trim().is_empty() {
                "optional"
            } else {
                criterion
            },
            minutes,
        )?;
        self.with_session_transaction(session_id, |store| {
            let rec = store
                .sessions
                .get_mut(session_id)
                .ok_or("관측된 작업만 설정할 수 있습니다.")?;
            if !criterion.trim().is_empty() {
                rec.supervision.view.completion_criterion = criterion.trim().to_owned();
            }
            rec.supervision.view.intervention_mode = mode;
            rec.supervision.view.elapsed_alert_minutes = minutes;
            for alert in &mut rec.supervision.records {
                if (minutes.is_none() && alert.view.kind == AttentionKind::Elapsed)
                    || (mode == InterventionMode::WhenNeeded
                        && alert.view.kind == AttentionKind::Milestone)
                {
                    alert.closed = true;
                }
            }
            store.save_session(session_id)
        })
    }

    pub fn task_context(&self, session_id: &str, cwd: &str) -> Result<TaskContext, String> {
        validate_id(session_id, "session ID")?;
        let rec = self.sessions.get(session_id).ok_or("task-not-observed")?;
        if rec.turn_finished
            || rec.view.connection != ConnectionState::Observed
            || cwd.trim().is_empty()
            || normalized_cwd(cwd) != normalized_cwd(&rec.view.cwd)
        {
            return Err("task-context-mismatch".into());
        }
        let turn_id = rec.active_turn.clone().ok_or("active-turn-not-observed")?;
        Ok(TaskContext {
            session_id: session_id.to_owned(),
            turn_id,
            cwd: rec.view.cwd.clone(),
        })
    }

    pub fn configure_task(&mut self, input: TaskConfiguration) -> Result<TaskConfigured, String> {
        validate_id(&input.request_id, "request ID")?;
        validate_configuration(&input.completion_criterion, input.elapsed_alert_minutes)?;
        let context = self.task_context(&input.session_id, &input.cwd)?;
        if context.turn_id != input.turn_id {
            return Err("task-context-mismatch".into());
        }
        let fingerprint = format!("{:x}", Sha256::digest(encode(&input).as_bytes()));
        let prior = self.configured_request_fingerprint(&input.request_id)?;
        if prior.as_ref().is_some_and(|old| old != &fingerprint) {
            return Err("request-content-changed".into());
        }
        let slot = self
            .slots
            .iter()
            .position(|s| s.as_deref() == Some(input.session_id.as_str()))
            .or_else(|| self.slots.iter().position(Option::is_none))
            .ok_or("slots-full")?;
        let session_id = input.session_id.clone();
        self.with_session_transaction(&session_id, |store| {
            if prior.is_none() {
                store.configure_session(
                    &session_id,
                    &input.completion_criterion,
                    input.intervention_mode,
                    input.elapsed_alert_minutes,
                )?;
                store.record_task_configuration(&input, &fingerprint)?;
            }
            store.persist_slot(slot, Some(&session_id))?;
            store.slots[slot] = Some(session_id.clone());
            Ok(TaskConfigured {
                ok: true,
                session_id: session_id.clone(),
                slot,
            })
        })
    }

    pub fn acknowledge_attention(
        &mut self,
        session_id: &str,
        attention_id: &str,
    ) -> Result<(), String> {
        self.with_session_transaction(session_id, |store| {
            let rec = store
                .sessions
                .get_mut(session_id)
                .ok_or("Unknown session")?;
            let alert = rec
                .supervision
                .records
                .iter_mut()
                .find(|a| a.view.id == attention_id)
                .ok_or("Unknown attention")?;
            if alert.acknowledged_at.is_none() {
                alert.acknowledged_at = Some(now_ms());
            }
            store.save_session(session_id)
        })
    }

    pub fn snooze_attention(
        &mut self,
        session_id: &str,
        attention_id: &str,
        minutes: u32,
    ) -> Result<(), String> {
        self.snooze_attention_at(session_id, attention_id, minutes, now_ms())
    }

    pub(crate) fn snooze_attention_at(
        &mut self,
        session_id: &str,
        attention_id: &str,
        minutes: u32,
        now: u64,
    ) -> Result<(), String> {
        if minutes == 0 || minutes > 240 {
            return Err("다시 알림은 1–240분으로 설정해주세요.".into());
        }
        self.with_session_transaction(session_id, |store| {
            let rec = store
                .sessions
                .get_mut(session_id)
                .ok_or("Unknown session")?;
            let alert = rec
                .supervision
                .records
                .iter_mut()
                .find(|a| a.view.id == attention_id && !a.closed && a.acknowledged_at.is_none())
                .ok_or("This attention is no longer active")?;
            alert.view.snoozed_until = Some(now.saturating_add(u64::from(minutes) * 60_000));
            store.save_session(session_id)
        })
    }

    pub(crate) fn supervise_event(
        &mut self,
        event: &EventInput,
        prior_turn: Option<&str>,
        now: u64,
    ) -> Result<(), String> {
        let rec = self
            .sessions
            .get_mut(&event.session_id)
            .ok_or("Unknown session")?;
        let turn_id = event
            .turn_id
            .as_deref()
            .or(rec.active_turn.as_deref())
            .unwrap_or("");
        let observed_at = event.timestamp.min(now);
        let observes_turn = !turn_id.is_empty()
            && matches!(
                event.kind,
                EventKind::TurnStarted
                    | EventKind::ToolStarted
                    | EventKind::ToolFinished
                    | EventKind::PlanUpdated
                    | EventKind::PermissionRequested
            );
        if observes_turn && prior_turn != Some(turn_id) {
            if let Some(old) = prior_turn {
                rec.supervision.close_turn(old);
            }
            rec.supervision.view.turn_started_at = Some(observed_at);
            rec.supervision.view.turn_ended_at = None;
            rec.supervision.view.plan_steps.clear();
            rec.supervision.view.plan_updated_at = None;
            rec.supervision.elapsed_alerted_turn = None;
            if rec.supervision.records.len() > 100 {
                let keep_from = rec.supervision.records.len() - 100;
                rec.supervision.records.drain(..keep_from);
            }
        } else if observes_turn && rec.supervision.view.turn_started_at.is_none() {
            rec.supervision.view.turn_started_at = Some(observed_at);
            rec.supervision.view.turn_ended_at = None;
        }
        match event.kind {
            EventKind::TurnStarted => {
                rec.supervision.view.activity = Activity::Working;
            }
            EventKind::ToolStarted | EventKind::ToolFinished | EventKind::PlanUpdated => {
                rec.supervision.view.activity =
                    event
                        .activity
                        .unwrap_or(if matches!(event.kind, EventKind::PlanUpdated) {
                            Activity::Working
                        } else {
                            Activity::Tool
                        });
                for alert in &mut rec.supervision.records {
                    if alert.turn_id == turn_id
                        && ((alert.view.kind == AttentionKind::Permission
                            && matches!(event.kind, EventKind::ToolFinished)
                            && alert.tool_call_id.is_some()
                            && alert.tool_call_id == event.tool_call_id)
                            || (matches!(event.kind, EventKind::ToolStarted)
                                && alert.view.kind == AttentionKind::ToolError))
                    {
                        alert.closed = true;
                    }
                }
            }
            EventKind::PermissionRequested => {
                rec.view.state = SessionState::Waiting;
                rec.supervision.view.activity = Activity::Idle;
                rec.supervision.add(
                    format!("permission:{}", event.event_id),
                    AttentionKind::Permission,
                    "Codex에서 권한 요청을 확인해주세요.".into(),
                    turn_id,
                    event.tool_call_id.as_deref(),
                    now,
                );
            }
            EventKind::TurnFinished | EventKind::Interrupted | EventKind::SessionEnded => {
                rec.supervision.view.turn_ended_at = Some(observed_at);
                rec.supervision.view.activity = Activity::Idle;
                for alert in &mut rec.supervision.records {
                    if alert.turn_id == turn_id && alert.view.kind != AttentionKind::Milestone {
                        alert.closed = true;
                    }
                }
            }
            EventKind::SessionStarted => {}
        }
        if matches!(event.kind, EventKind::ToolFinished) && event.tool_error == Some(true) {
            rec.supervision.add(
                format!("tool-error:{}", event.event_id),
                AttentionKind::ToolError,
                format!(
                    "도구 오류 확인: {}",
                    event.tool_name.as_deref().unwrap_or("알 수 없는 도구")
                ),
                turn_id,
                None,
                now,
            );
        }
        if let Some(plan) = &event.plan {
            if matches!(event.kind, EventKind::PlanUpdated | EventKind::ToolFinished)
                && !turn_id.is_empty()
            {
                if rec.supervision.view.intervention_mode == InterventionMode::Milestones {
                    for (index, step) in plan.steps.iter().enumerate() {
                        if step.status == PlanStatus::Completed
                            && rec.supervision.view.plan_steps.get(index) != Some(step)
                        {
                            let key = format!(
                                "{:x}",
                                Sha256::digest(format!("{index}:{}", step.step).as_bytes())
                            );
                            rec.supervision.add(
                                format!("milestone:{turn_id}:{key}"),
                                AttentionKind::Milestone,
                                format!("계획 단계 완료: {}", step.step),
                                turn_id,
                                None,
                                now,
                            );
                        }
                    }
                }
                rec.supervision.view.plan_steps = plan.steps.clone();
                rec.supervision.view.plan_updated_at = Some(observed_at);
            }
        }
        // A parallel tool's progress is not evidence that this permission request
        // was resolved. Acknowledging the notice also does not resume Codex.
        if matches!(
            event.kind,
            EventKind::ToolStarted | EventKind::ToolFinished | EventKind::PlanUpdated
        ) && rec.supervision.records.iter().any(|alert| {
            !alert.closed
                && alert.turn_id == turn_id
                && alert.view.kind == AttentionKind::Permission
        }) {
            rec.view.state = SessionState::Waiting;
        }
        Ok(())
    }

    pub(crate) fn tick_supervision(&mut self, now: u64) -> Result<bool, String> {
        let due: Vec<_> = self
            .sessions
            .iter()
            .filter_map(|(id, rec)| {
                if rec.turn_finished
                    || rec.view.connection != ConnectionState::Observed
                    || !matches!(
                        rec.view.state,
                        SessionState::Working | SessionState::Waiting
                    )
                    || !self.slots.iter().any(|s| s.as_ref() == Some(id))
                {
                    return None;
                }
                let turn_id = rec.active_turn.as_ref()?;
                let started = rec.supervision.view.turn_started_at?;
                let minutes = rec.supervision.view.elapsed_alert_minutes?;
                if rec.supervision.elapsed_alerted_turn.as_ref() == Some(turn_id)
                    || now.saturating_sub(started) < u64::from(minutes) * 60_000
                {
                    return None;
                }
                Some((id.clone(), turn_id.clone(), minutes))
            })
            .collect();
        let changed = !due.is_empty();
        for (session_id, turn_id, minutes) in due {
            self.with_session_transaction(&session_id, |store| {
                let rec = store
                    .sessions
                    .get_mut(&session_id)
                    .ok_or("Unknown session")?;
                rec.supervision.add(
                    format!("elapsed:{turn_id}"),
                    AttentionKind::Elapsed,
                    format!("이번 작업을 관측한 지 {minutes}분이 지났습니다."),
                    &turn_id,
                    None,
                    now,
                );
                rec.supervision.elapsed_alerted_turn = Some(turn_id);
                store.save_session(&session_id)
            })?;
        }
        Ok(changed)
    }
}

#[cfg(test)]
#[path = "tests/supervision.rs"]
mod tests;
