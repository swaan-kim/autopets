pub(crate) use crate::domain::activity::*;
pub(crate) use crate::legacy::approval::*;
pub(crate) use crate::storage::sqlite::{db_err, decode, encode};
use rusqlite::Connection;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub type SharedStore = Arc<Mutex<Store>>;
pub struct Store {
    pub(crate) db: Connection,
    pub assistance: crate::application::assistance::AssistanceStore,
    pub workflow: crate::application::workflow::WorkflowStore,
    pub artifacts: crate::application::artifacts::ArtifactStore,
    pub(crate) sessions: HashMap<String, SessionRecord>,
    pub(crate) slots: [Option<String>; 3],
    pub(crate) approvals: HashMap<String, ApprovalRecord>,
    pub(crate) approval_enabled: bool,
    pub data_dir: PathBuf,
    pub(crate) connection_path: String,
}

impl Store {
    pub fn set_connection_path(&mut self, path: impl AsRef<Path>) {
        self.connection_path = path.as_ref().to_string_lossy().into_owned();
    }

    pub fn snapshot(&self) -> Snapshot {
        let now = now_ms();
        let mut sessions: Vec<_> = self
            .sessions
            .values()
            .map(|s| {
                let mut view = s.view.clone();
                view.supervision = s.supervision.for_snapshot(now);
                view
            })
            .collect();
        sessions.sort_by(|a, b| b.last_seen.cmp(&a.last_seen).then(a.id.cmp(&b.id)));
        let mut approvals: Vec<_> = self.approvals.values().map(|a| a.view.clone()).collect();
        approvals.sort_by(|a, b| {
            (b.status == ApprovalStatus::Pending)
                .cmp(&(a.status == ApprovalStatus::Pending))
                .then(b.created_at.cmp(&a.created_at))
                .then(a.request_id.cmp(&b.request_id))
        });
        let pending_count = approvals
            .iter()
            .filter(|a| a.status == ApprovalStatus::Pending)
            .count();
        approvals.truncate(pending_count + 200);
        Snapshot {
            sessions,
            slots: self
                .slots
                .iter()
                .enumerate()
                .map(|(index, session_id)| Slot {
                    index,
                    session_id: session_id.clone(),
                })
                .collect(),
            approvals,
            approval_enabled: self.approval_enabled,
            connection_path: self.connection_path.clone(),
            now,
            setup: self.setup_status().ok(),
            capabilities: Capabilities {
                token_usage: "unavailable",
                task_return: "manual",
            },
        }
    }

    pub fn assign_session(&mut self, slot: usize, session_id: &str) -> Result<(), String> {
        self.tick()?;
        if slot >= 3 {
            return Err("Pet slot must be 0, 1, or 2".into());
        }
        if !self.sessions.contains_key(session_id) {
            return Err("Only an observed session can be assigned".into());
        }
        if self.slots[slot].as_deref() == Some(session_id) {
            return Ok(());
        }
        if self.slots.iter().any(|s| s.as_deref() == Some(session_id)) {
            return Err("This session already has a pet".into());
        }
        if self.slots[slot]
            .as_ref()
            .is_some_and(|s| self.has_pending(s))
        {
            return Err("Resolve pending approvals before replacing this session".into());
        }
        self.persist_slot(slot, Some(session_id))?;
        self.slots[slot] = Some(session_id.to_owned());
        Ok(())
    }

    pub fn unassign_session(&mut self, slot: usize) -> Result<(), String> {
        self.tick()?;
        if slot >= 3 {
            return Err("Invalid pet slot".into());
        }
        if self.slots[slot]
            .as_ref()
            .is_some_and(|s| self.has_pending(s))
        {
            return Err("Resolve pending approvals before disconnecting this pet".into());
        }
        self.persist_unassignment(slot, self.slots[slot].clone())?;
        self.slots[slot] = None;
        Ok(())
    }

    pub fn assign_first_assistance_pet(
        &mut self,
        identity: &crate::application::assistance::Identity,
    ) -> Result<bool, String> {
        if identity.provider != crate::application::assistance::Provider::Codex
            || !self.sessions.contains_key(&identity.chat_id)
            || !self
                .assistance
                .has_enabled_preparation(identity, self.workflow.enabled(identity)?)?
        {
            return Ok(false);
        }
        let slot = if self
            .slots
            .iter()
            .any(|s| s.as_deref() == Some(identity.chat_id.as_str()))
        {
            None
        } else {
            self.slots.iter().position(Option::is_none)
        };
        if !self.persist_first_assignment(&identity.chat_id, slot)? {
            return Ok(false);
        }
        if let Some(slot) = slot {
            self.slots[slot] = Some(identity.chat_id.clone());
        }
        Ok(slot.is_some())
    }

    pub fn rename_session(&mut self, session_id: &str, label: &str) -> Result<(), String> {
        let label = label.trim();
        if label.is_empty() || label.chars().count() > 80 || label.chars().any(char::is_control) {
            return Err("Use a label of 1–80 characters".into());
        }
        self.sessions
            .get_mut(session_id)
            .ok_or("Unknown session")?
            .view
            .label = label.to_owned();
        self.save_session(session_id)
    }

    pub fn acknowledge(&mut self, session_id: &str) -> Result<(), String> {
        let rec = self.sessions.get_mut(session_id).ok_or("Unknown session")?;
        rec.view.unread = false;
        if rec.view.state == SessionState::Done {
            rec.view.state = SessionState::Idle;
        }
        self.save_session(session_id)
    }

    pub fn tick(&mut self) -> Result<bool, String> {
        self.tick_at(now_ms())
    }

    pub(crate) fn tick_at(&mut self, now: u64) -> Result<bool, String> {
        let mut changed = self.tick_legacy_approvals(now)?;
        changed |= self.tick_supervision(now)?;
        Ok(changed)
    }

    pub fn shutdown(&mut self) -> Result<(), String> {
        self.set_approval_enabled(false)?;
        for rec in self.approvals.values_mut() {
            rec.live = false;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/store.rs"]
mod tests;

#[cfg(all(test, target_os = "windows"))]
#[path = "tests/install_roundtrip.rs"]
mod install_roundtrip;
