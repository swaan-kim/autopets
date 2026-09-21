//! Compatibility only. Production activation remains rejected by set_approval_enabled.
use crate::application::store::Store;
use crate::domain::activity::{now_ms, validate_id, ConnectionState, SessionState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const APPROVAL_TTL_MS: u64 = 30 * 60 * 1000;
pub const ADAPTER_LEASE_MS: u64 = 45 * 1000;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub request_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub tool_name: String,
    pub description: String,
    pub details: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: ApprovalStatus,
    pub delivery: Delivery,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
    Forwarded,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Delivery {
    Waiting,
    Received,
    Invalidated,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Allow,
    Deny,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalInput {
    pub request_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub cwd: String,
    pub tool_name: String,
    #[serde(default)]
    pub description: String,
    pub details: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub mode: &'static str,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ApprovalWait {
    pub status: ApprovalStatus,
}

#[derive(Clone, Debug)]
pub(crate) struct ApprovalRecord {
    pub(crate) view: Approval,
    pub(crate) lease_until: u64,
    pub(crate) live: bool,
    pub(crate) fingerprint: Option<[u8; 32]>,
}

impl Store {
    pub(crate) fn has_pending(&self, session_id: &str) -> bool {
        self.approvals
            .values()
            .any(|a| a.view.session_id == session_id && a.view.status == ApprovalStatus::Pending)
    }

    pub(crate) fn refresh_waiting(&mut self, session_id: &str) {
        let pending = self.has_pending(session_id);
        if let Some(rec) = self.sessions.get_mut(session_id) {
            if pending {
                rec.view.state = SessionState::Waiting;
            } else if rec.view.state == SessionState::Waiting {
                // A decision or handoff is not evidence that Codex resumed execution.
                rec.view.state = SessionState::Idle;
                rec.view.connection = ConnectionState::Unknown;
            }
        }
    }

    pub fn set_approval_enabled(&mut self, enabled: bool) -> Result<(), String> {
        if enabled && !cfg!(test) {
            return Err(
                "직접 승인 제어는 이 버전에서 지원하지 않습니다. Codex에서 처리해주세요.".into(),
            );
        }
        if !enabled {
            let ids: Vec<_> = self
                .approvals
                .values()
                .filter(|a| a.view.status == ApprovalStatus::Pending)
                .map(|a| a.view.request_id.clone())
                .collect();
            for id in ids {
                self.finish_approval(&id, ApprovalStatus::Forwarded)?;
            }
        }
        self.approval_enabled = enabled;
        if !enabled {
            self.tick()?;
        }
        Ok(())
    }

    pub fn register_approval(&mut self, input: ApprovalInput) -> Result<Registration, String> {
        self.register_approval_at(input, now_ms())
    }

    pub(crate) fn register_approval_at(
        &mut self,
        input: ApprovalInput,
        now: u64,
    ) -> Result<Registration, String> {
        self.tick_at(now)?;
        let session_id = input.session_id.clone();
        self.with_session_transaction(&session_id, |store| {
            store.register_approval_inner(input, now)
        })
    }

    pub(crate) fn register_approval_inner(
        &mut self,
        input: ApprovalInput,
        now: u64,
    ) -> Result<Registration, String> {
        validate_id(&input.request_id, "request ID")?;
        validate_id(&input.session_id, "session ID")?;
        validate_id(&input.turn_id, "turn ID")?;
        validate_id(&input.tool_name, "tool name")?;
        if input.cwd.len() > 32768 || input.details.len() > 220000 || input.description.len() > 8000
        {
            return Err("Approval content exceeds the local bridge limit".into());
        }
        let mut digest = Sha256::new();
        for field in [
            &input.session_id,
            &input.turn_id,
            &input.cwd,
            &input.tool_name,
            &input.description,
            &input.details,
        ] {
            digest.update((field.len() as u64).to_le_bytes());
            digest.update(field.as_bytes());
        }
        let fingerprint: [u8; 32] = digest.finalize().into();
        if let Some(existing) = self.approvals.get(&input.request_id) {
            if existing.view.session_id != input.session_id
                || existing.view.turn_id != input.turn_id
                || existing.view.tool_name != input.tool_name
            {
                return Err("Request ID is already bound to another request".into());
            }
            if existing
                .fingerprint
                .is_some_and(|value| value != fingerprint)
            {
                return Err("Request content changed for an existing request ID".into());
            }
            let pending = existing.live
                && matches!(
                    existing.view.status,
                    ApprovalStatus::Pending | ApprovalStatus::Approved | ApprovalStatus::Denied
                );
            return Ok(Registration {
                mode: if pending { "pending" } else { "passthrough" },
                request_id: input.request_id,
                expires_at: pending.then_some(existing.view.expires_at),
            });
        }
        self.ensure_session(&input.session_id, &input.cwd, now);
        let rec = self
            .sessions
            .get_mut(&input.session_id)
            .expect("created session");
        rec.view.last_seen = now;
        rec.view.connection = ConnectionState::Observed;
        let stale = rec
            .active_turn
            .as_deref()
            .is_some_and(|id| id != input.turn_id)
            || rec.turn_finished;
        self.save_session(&input.session_id)?;
        if !self.approval_enabled
            || !self
                .slots
                .iter()
                .any(|s| s.as_deref() == Some(&input.session_id))
            || stale
        {
            return Ok(Registration {
                mode: "passthrough",
                request_id: input.request_id,
                expires_at: None,
            });
        }
        let request_id = input.request_id.clone();
        let session_id = input.session_id.clone();
        let expires_at = now.saturating_add(APPROVAL_TTL_MS);
        let rec = ApprovalRecord {
            view: Approval {
                request_id: input.request_id,
                session_id: input.session_id,
                turn_id: input.turn_id.clone(),
                tool_name: input.tool_name,
                description: input.description,
                details: input.details,
                created_at: now,
                expires_at,
                status: ApprovalStatus::Pending,
                delivery: Delivery::Waiting,
            },
            lease_until: now.saturating_add(ADAPTER_LEASE_MS),
            live: true,
            fingerprint: Some(fingerprint),
        };
        self.approvals.insert(request_id.clone(), rec);
        if let Err(e) = self.save_approval(&request_id) {
            self.approvals.remove(&request_id);
            return Err(e);
        }
        let session = self
            .sessions
            .get_mut(&session_id)
            .expect("existing session");
        if session.active_turn.is_none() {
            session.active_turn = Some(input.turn_id);
        }
        self.refresh_waiting(&session_id);
        self.save_session(&session_id)?;
        Ok(Registration {
            mode: "pending",
            request_id,
            expires_at: Some(expires_at),
        })
    }

    pub(crate) fn check_binding(
        &self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
    ) -> Result<(), String> {
        let rec = self
            .approvals
            .get(request_id)
            .ok_or("Unknown or inactive approval")?;
        if !rec.live || rec.view.session_id != session_id || rec.view.turn_id != turn_id {
            return Err("Unknown or inactive approval".into());
        }
        Ok(())
    }

    pub fn wait_status(
        &mut self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
    ) -> Result<ApprovalWait, String> {
        self.wait_status_at(request_id, session_id, turn_id, now_ms())
    }

    pub fn peek_status(
        &mut self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
    ) -> Result<ApprovalWait, String> {
        self.tick()?;
        self.check_binding(request_id, session_id, turn_id)?;
        let rec = self.approvals.get(request_id).expect("bound approval");
        Ok(ApprovalWait {
            status: if rec.view.delivery == Delivery::Received {
                ApprovalStatus::Cancelled
            } else {
                rec.view.status
            },
        })
    }

    pub(crate) fn wait_status_at(
        &mut self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
        now: u64,
    ) -> Result<ApprovalWait, String> {
        self.tick_at(now)?;
        self.check_binding(request_id, session_id, turn_id)?;
        let rec = self.approvals.get_mut(request_id).expect("bound approval");
        if rec.view.status == ApprovalStatus::Pending {
            rec.lease_until = now.saturating_add(ADAPTER_LEASE_MS);
        }
        let status = if rec.view.delivery == Delivery::Received {
            ApprovalStatus::Cancelled
        } else {
            rec.view.status
        };
        Ok(ApprovalWait { status })
    }

    pub fn resolve_approval(
        &mut self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
        decision: Decision,
    ) -> Result<(), String> {
        self.resolve_approval_at(request_id, session_id, turn_id, decision, now_ms())
    }

    pub(crate) fn resolve_approval_at(
        &mut self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
        decision: Decision,
        now: u64,
    ) -> Result<(), String> {
        self.tick_at(now)?;
        self.check_binding(request_id, session_id, turn_id)?;
        let expected = match decision {
            Decision::Allow => ApprovalStatus::Approved,
            Decision::Deny => ApprovalStatus::Denied,
        };
        let status = self
            .approvals
            .get(request_id)
            .expect("bound approval")
            .view
            .status;
        if status == expected {
            return Ok(());
        }
        if status != ApprovalStatus::Pending {
            return Err("This approval has already been resolved or expired".into());
        }
        if !self.approval_enabled {
            return Err("Approval integration is disabled".into());
        }
        let rec = self.sessions.get(session_id).ok_or("Unknown session")?;
        if rec.active_turn.as_deref() != Some(turn_id) || rec.turn_finished {
            return Err("The request no longer belongs to the active turn".into());
        }
        self.finish_approval(request_id, expected)
    }

    pub fn mark_returned(
        &mut self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
    ) -> Result<(), String> {
        self.tick()?;
        self.check_binding(request_id, session_id, turn_id)?;
        self.with_session_transaction(session_id, |store| {
            let rec = store.approvals.get_mut(request_id).expect("bound approval");
            if !matches!(
                rec.view.status,
                ApprovalStatus::Approved | ApprovalStatus::Denied
            ) {
                return Err("No decision is awaiting receipt".into());
            }
            rec.view.delivery = Delivery::Received;
            store.save_approval(request_id)
        })
    }

    pub fn abandon(
        &mut self,
        request_id: &str,
        session_id: &str,
        turn_id: &str,
    ) -> Result<(), String> {
        self.check_binding(request_id, session_id, turn_id)?;
        if self
            .approvals
            .get(request_id)
            .expect("bound approval")
            .view
            .status
            == ApprovalStatus::Pending
        {
            self.finish_approval(request_id, ApprovalStatus::Forwarded)?;
        }
        Ok(())
    }

    pub(crate) fn finish_approval(
        &mut self,
        request_id: &str,
        status: ApprovalStatus,
    ) -> Result<(), String> {
        let session_id = self
            .approvals
            .get(request_id)
            .ok_or("Unknown approval")?
            .view
            .session_id
            .clone();
        self.with_session_transaction(&session_id, |store| {
            let rec = store.approvals.get_mut(request_id).expect("known approval");
            rec.view.status = status;
            rec.view.description.clear();
            rec.view.details.clear();
            // Commit all metadata before publishing or allowing a decision to leave the mutex.
            store.save_approval(request_id)?;
            store.refresh_waiting(&session_id);
            store.save_session(&session_id)
        })
    }
}

impl Store {
    pub(crate) fn tick_legacy_approvals(&mut self, now: u64) -> Result<bool, String> {
        let ids: Vec<_> = self
            .approvals
            .values()
            .filter(|a| {
                a.live
                    && a.view.status == ApprovalStatus::Pending
                    && (now >= a.view.expires_at || now >= a.lease_until)
            })
            .map(|a| a.view.request_id.clone())
            .collect();
        let mut changed = !ids.is_empty();
        for id in ids {
            let session_id = self.approvals[&id].view.session_id.clone();
            let lease_lost = now >= self.approvals[&id].lease_until;
            self.finish_approval(&id, ApprovalStatus::Forwarded)?;
            if lease_lost {
                if let Some(s) = self.sessions.get_mut(&session_id) {
                    s.view.connection = ConnectionState::Unknown;
                }
                self.save_session(&session_id)?;
            }
        }
        // A recorded decision is immutable, but its ability to be delivered is not
        // indefinite. Expired/disconnected adapters must never collect an old allow.
        let mut invalidated_ids = Vec::new();
        for rec in self.approvals.values_mut() {
            let active = self.sessions.get(&rec.view.session_id).is_some_and(|s| {
                s.active_turn.as_deref() == Some(rec.view.turn_id.as_str()) && !s.turn_finished
            });
            if rec.live
                && matches!(
                    rec.view.status,
                    ApprovalStatus::Approved | ApprovalStatus::Denied
                )
                && rec.view.delivery == Delivery::Waiting
                && (now >= rec.view.expires_at
                    || now >= rec.lease_until
                    || !active
                    || !self.approval_enabled)
            {
                rec.live = false;
                rec.view.delivery = Delivery::Invalidated;
                invalidated_ids.push(rec.view.request_id.clone());
                changed = true;
            }
        }
        for id in invalidated_ids {
            self.save_approval(&id)?;
        }
        Ok(changed)
    }
}
