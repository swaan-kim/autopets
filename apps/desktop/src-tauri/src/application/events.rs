use super::store::*;
use crate::domain::supervision;

impl Store {
    pub(crate) fn ensure_session(&mut self, id: &str, cwd: &str, now: u64) {
        self.sessions
            .entry(id.to_owned())
            .or_insert_with(|| SessionRecord {
                view: Session {
                    id: id.to_owned(),
                    label: format!(
                        "Task {}",
                        id.chars()
                            .rev()
                            .take(12)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect::<String>()
                    ),
                    cwd: cwd.to_owned(),
                    state: SessionState::Idle,
                    unread: false,
                    last_seen: now,
                    last_tool: None,
                    connection: ConnectionState::Observed,
                    supervision: SessionSupervision::default(),
                },
                active_turn: None,
                last_activity_timestamp: 0,
                turn_finished: false,
                supervision: SupervisionRecord::default(),
            });
    }

    pub fn apply_event(&mut self, event: EventInput) -> Result<(), String> {
        self.apply_event_at(event, now_ms())
    }

    pub(crate) fn apply_event_at(&mut self, event: EventInput, now: u64) -> Result<(), String> {
        let session_id = event.session_id.clone();
        let observed = event.clone();
        self.with_session_transaction(&session_id, |store| store.apply_event_inner(event, now))?;
        if matches!(observed.kind, EventKind::TurnStarted) {
            self.assign_setup_pet(&session_id)?;
        }
        // Update the separate connection only after the session transaction commits.
        if let Some(turn_id) = &observed.turn_id {
            if matches!(
                observed.kind,
                EventKind::TurnStarted | EventKind::TurnFinished
            ) && self.sessions.get(&session_id).is_some_and(|session| {
                session.active_turn.as_ref() == Some(turn_id)
                    && session.last_activity_timestamp == observed.timestamp
            }) {
                self.workflow.observe_turn(
                    &session_id,
                    turn_id,
                    matches!(observed.kind, EventKind::TurnFinished),
                )?;
            }
        }
        Ok(())
    }

    pub(crate) fn apply_event_inner(&mut self, event: EventInput, now: u64) -> Result<(), String> {
        validate_id(&event.event_id, "event ID")?;
        validate_id(&event.session_id, "session ID")?;
        if let Some(id) = &event.turn_id {
            validate_id(id, "turn ID")?;
        }
        if event.cwd.len() > 32768 {
            return Err("Project path is too long".into());
        }
        if let Some(plan) = &event.plan {
            supervision::validate_plan(plan)?;
            if event.tool_error == Some(true) {
                return Err("A failed tool result cannot publish plan progress".into());
            }
            if !matches!(event.kind, EventKind::ToolFinished | EventKind::PlanUpdated)
                || event.tool_name.as_deref() != Some("update_plan")
            {
                return Err("Plan metadata requires an observed update_plan result".into());
            }
        }
        if matches!(
            event.kind,
            EventKind::PlanUpdated | EventKind::PermissionRequested
        ) && event.turn_id.is_none()
        {
            return Err("This event requires a turn ID".into());
        }
        let supervision_event = event.clone();
        if !self.record_event(&event, now)? {
            return Ok(());
        }
        self.ensure_session(&event.session_id, &event.cwd, now);
        // A lost start hook may be recovered only after a known terminal turn.
        // Never replace an active turn, or resurrect an ID seen in a terminal event.
        let may_recover_turn = matches!(
            event.kind,
            EventKind::ToolStarted
                | EventKind::ToolFinished
                | EventKind::PlanUpdated
                | EventKind::PermissionRequested
        ) && event.turn_id.is_some()
            && self.sessions.get(&event.session_id).is_some_and(|rec| {
                rec.turn_finished
                    && rec.active_turn != event.turn_id
                    && event.timestamp > rec.last_activity_timestamp
            });
        let retired_turn = if may_recover_turn
            || (matches!(event.kind, EventKind::TurnStarted) && event.turn_id.is_some())
        {
            self.is_retired_turn(&event)?
        } else {
            false
        };
        let recover_turn = may_recover_turn && !retired_turn;
        let rec = self
            .sessions
            .get_mut(&event.session_id)
            .expect("created session");
        rec.view.last_seen = now;
        // Resuming a session is a connection observation, not an idle/completion event.
        if matches!(event.kind, EventKind::SessionStarted) {
            rec.view.connection = ConnectionState::Observed;
            return self.save_session(&event.session_id);
        }
        if event.timestamp < rec.last_activity_timestamp {
            return self.save_session(&event.session_id);
        }
        let mut cancel_prior = false;
        let prior_turn = rec.active_turn.clone();
        match event.kind {
            EventKind::TurnStarted => {
                if retired_turn || (rec.turn_finished && rec.active_turn == event.turn_id) {
                    return self.save_session(&event.session_id);
                }
                cancel_prior = rec.active_turn != event.turn_id;
                rec.active_turn = event.turn_id.clone();
                rec.turn_finished = false;
                rec.view.state = SessionState::Working;
            }
            EventKind::ToolStarted
            | EventKind::ToolFinished
            | EventKind::PlanUpdated
            | EventKind::PermissionRequested => {
                if rec.active_turn.is_some() && rec.active_turn != event.turn_id && !recover_turn {
                    return self.save_session(&event.session_id);
                }
                if rec.turn_finished && !recover_turn {
                    return self.save_session(&event.session_id);
                }
                if rec.active_turn.is_none() || recover_turn {
                    rec.active_turn = event.turn_id.clone();
                }
                if recover_turn {
                    rec.turn_finished = false;
                    cancel_prior = true;
                }
                rec.view.state = SessionState::Working;
                if let Some(tool) = event.tool_name {
                    rec.view.last_tool = Some(tool);
                }
            }
            EventKind::TurnFinished | EventKind::Interrupted => {
                if rec.active_turn.is_some() && rec.active_turn != event.turn_id {
                    return self.save_session(&event.session_id);
                }
                if rec.active_turn.is_none() {
                    rec.active_turn = event.turn_id.clone();
                }
                rec.view.state = if matches!(event.kind, EventKind::TurnFinished) {
                    SessionState::Done
                } else {
                    SessionState::Idle
                };
                rec.view.unread |= matches!(event.kind, EventKind::TurnFinished);
                rec.turn_finished = true;
                cancel_prior = true;
            }
            EventKind::SessionEnded => {
                if event.turn_id.is_some() && rec.active_turn != event.turn_id {
                    return self.save_session(&event.session_id);
                }
                rec.view.connection = ConnectionState::Ended;
                if rec.view.state != SessionState::Done {
                    rec.view.state = SessionState::Idle;
                }
                rec.turn_finished = true;
                cancel_prior = true;
            }
            EventKind::SessionStarted => unreachable!(),
        }
        rec.last_activity_timestamp = event.timestamp;
        if !event.cwd.is_empty() {
            rec.view.cwd = event.cwd;
        }
        if !matches!(event.kind, EventKind::SessionEnded) {
            rec.view.connection = ConnectionState::Observed;
        }
        if cancel_prior {
            let ids: Vec<_> = self
                .approvals
                .values()
                .filter(|a| {
                    a.view.session_id == event.session_id
                        && a.view.status == ApprovalStatus::Pending
                        && (!matches!(event.kind, EventKind::TurnStarted)
                            || Some(&a.view.turn_id) != event.turn_id.as_ref())
                })
                .map(|a| a.view.request_id.clone())
                .collect();
            for id in ids {
                self.finish_approval(&id, ApprovalStatus::Cancelled)?;
            }
        }
        self.refresh_waiting(&event.session_id);
        self.supervise_event(&supervision_event, prior_turn.as_deref(), now)?;
        self.save_session(&event.session_id)
    }
}
