//! User-initiated bootstrap state. Installing never upgrades connection capabilities.
use super::store::Store;
use crate::domain::{
    activity::validate_id,
    assistance::{Identity, Provider, Status},
    workflow::Binding,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupRequest {
    pub installed_version: String,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(id: &str, cwd: &str) -> SetupRequest {
        SetupRequest {
            installed_version: env!("CARGO_PKG_VERSION").into(),
            session_id: Some(id.into()),
            cwd: Some(cwd.into()),
        }
    }
    fn event(store: &mut Store, id: &str, cwd: &str) {
        store.apply_event(serde_json::from_value(serde_json::json!({"eventId":format!("event-{id}"),"sessionId":id,"turnId":"turn-1","kind":"turn_started","cwd":cwd,"timestamp":crate::domain::activity::now_ms()})).unwrap()).unwrap();
    }
    #[test]
    fn bootstrap_waits_for_real_event_and_preserves_existing_chats_and_opt_out() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let mut store = Store::new(dir.path()).unwrap();
        event(&mut store, "old", &cwd);
        let status = store.begin_setup(request("current", &cwd)).unwrap();
        assert_eq!(status["chatConnected"], false);
        assert!(!store.sessions.contains_key("current"));
        assert!(!store.workflow.enabled(&identity("old")).unwrap());
        assert!(store.workflow.preferences().unwrap().enabled);
        event(&mut store, "current", &cwd);
        assert!(store.slots.iter().any(|s| s.as_deref() == Some("current")));
        let status = store.setup_status().unwrap();
        assert_eq!(status["chatConnected"], true);
        assert_eq!(status["guidanceDelivered"], false);
        assert_eq!(status["protection"]["submission"], false);
        let mut preferences = store.workflow.preferences().unwrap();
        preferences.enabled = false;
        store.workflow.save_preferences(preferences).unwrap();
        store.begin_setup(request("current", &cwd)).unwrap();
        assert!(!store.workflow.preferences().unwrap().enabled);
        event(&mut store, "off-new", &cwd);
        assert!(!store.slots.iter().any(|s| s.as_deref() == Some("off-new")));
    }
    #[test]
    fn restart_and_wrong_binding_never_upgrade_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let mut store = Store::new(dir.path()).unwrap();
        let mut wrong = request("a", &cwd);
        wrong.installed_version = "9.9.9".into();
        assert!(store.begin_setup(wrong).is_err());
        store.begin_setup(request("a", &cwd)).unwrap();
        event(&mut store, "a", &cwd);
        assert!(store
            .begin_setup(request("a", &format!("{cwd}/other")))
            .is_err());
        drop(store);
        let store = Store::new(dir.path()).unwrap();
        assert_eq!(store.setup_status().unwrap()["guidanceDelivered"], false);
        assert_eq!(store.setup_status().unwrap()["protection"]["model"], false);
        assert!(store.workflow.preferences().unwrap().enabled);
    }
    #[test]
    fn first_real_tool_event_attaches_pending_pet_without_fabricating_a_start() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let mut store = Store::new(dir.path()).unwrap();
        store.begin_setup(request("pending", &cwd)).unwrap();
        store.apply_event(serde_json::from_value(serde_json::json!({"eventId":"real-tool","sessionId":"pending","turnId":"turn-1","kind":"tool_started","toolName":"read_file","toolCallId":"tool-1","cwd":cwd,"timestamp":crate::domain::activity::now_ms()})).unwrap()).unwrap();
        assert!(store
            .slots
            .iter()
            .any(|slot| slot.as_deref() == Some("pending")));
        assert!(store
            .sessions
            .get("pending")
            .unwrap()
            .view
            .supervision
            .turn_started_at
            .is_none());
        assert_eq!(store.setup_status().unwrap()["chatConnected"], true);
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    version: u8,
    request: SetupRequest,
}

fn identity(id: &str) -> Identity {
    Identity {
        provider: Provider::Codex,
        account_id: format!("session:{:x}", Sha256::digest(id.as_bytes())),
        chat_id: id.into(),
    }
}
impl Store {
    pub fn begin_setup(&mut self, input: SetupRequest) -> Result<serde_json::Value, String> {
        if input.installed_version != env!("CARGO_PKG_VERSION") {
            return Err("Setup requires the matching app version".into());
        }
        match (&input.session_id, &input.cwd) {
            (Some(id), Some(cwd)) => {
                validate_id(id, "setup session")?;
                if cwd.len() > 32768 || !std::path::Path::new(cwd).is_absolute() {
                    return Err("Invalid setup path".into());
                }
                if self
                    .sessions
                    .get(id)
                    .is_some_and(|s| !super::workflow::same_cwd(&s.view.cwd, cwd))
                {
                    return Err("Setup session path mismatch".into());
                }
            }
            (None, None) => {}
            _ => return Err("Setup session and path must be paired".into()),
        }
        let file = self.data_dir.join("setup-state-v1.json");
        if !file.exists() {
            // Freeze already observed chats before changing defaults for NEW chats.
            let existing: Vec<_> = self
                .sessions
                .values()
                .map(|s| (s.view.id.clone(), s.view.cwd.clone()))
                .collect();
            for (id, cwd) in existing {
                if input.session_id.as_deref() == Some(id.as_str()) {
                    continue;
                }
                self.workflow.ensure(
                    &identity(&id),
                    &Binding {
                        session_id: id,
                        cwd,
                        turn_id: None,
                    },
                )?;
            }
            let mut defaults = self.workflow.preferences()?;
            if defaults.revision == 0 {
                defaults.enabled = true;
                self.workflow.save_preferences(defaults)?;
            }
        }
        let current = input.session_id.clone();
        let temporary = self
            .data_dir
            .join(format!("setup-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(
            &temporary,
            serde_json::to_vec(&Saved {
                version: 1,
                request: input,
            })
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(temporary, file).map_err(|e| e.to_string())?;
        if let Some(id) = current {
            self.assign_setup_pet(&id)?;
        }
        self.setup_status()
    }
    pub fn setup_status(&self) -> Result<serde_json::Value, String> {
        let saved = match std::fs::read(self.data_dir.join("setup-state-v1.json")) {
            Ok(bytes) => {
                Some(serde_json::from_slice::<Saved>(&bytes).map_err(|_| "Invalid setup state")?)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        let request = saved.as_ref().map(|s| &s.request);
        let chat = request
            .and_then(|r| r.session_id.as_ref())
            .and_then(|id| self.sessions.get(id));
        let connected = chat.is_some_and(|s| {
            matches!(
                s.view.connection,
                crate::domain::activity::ConnectionState::Observed
            )
        });
        let confirmed = if let Some(id) = request.and_then(|r| r.session_id.as_ref()) {
            self.assistance
                .load(&identity(id))
                .ok()
                .is_some_and(|r| r.task.assistance.status == Status::Confirmed)
        } else {
            false
        };
        Ok(
            serde_json::json!({ "version":1, "installedVersion":env!("CARGO_PKG_VERSION"),
            "phase": if saved.is_none() { "not-started" } else if connected { "ready" } else { "connecting" },
            "appReady":true, "chatConnected":connected, "guidanceDelivered":confirmed,
            "protection":{"model":false,"reasoning":false,"submission":false},
            "retryable":true, "nextAction":if saved.is_none() { "start" } else if connected { "none" } else { "review-hooks" } }),
        )
    }
    pub(crate) fn assign_setup_pet(&mut self, session_id: &str) -> Result<(), String> {
        if !self.data_dir.join("setup-state-v1.json").exists() {
            return Ok(());
        }
        let Some(session) = self.sessions.get(session_id) else {
            return Ok(());
        };
        let who = identity(session_id);
        let binding = Binding {
            session_id: session_id.into(),
            cwd: session.view.cwd.clone(),
            turn_id: session.active_turn.clone(),
        };
        let task = self.workflow.ensure(&who, &binding)?;
        if !task.task.enabled {
            return Ok(());
        }
        if self
            .assistance
            .load(&who)
            .ok()
            .is_some_and(|r| !r.task.enabled)
        {
            return Ok(());
        }
        let slot = if self.slots.iter().any(|s| s.as_deref() == Some(session_id)) {
            None
        } else {
            self.slots.iter().position(Option::is_none)
        };
        // Reuse existing first-assignment ledger: explicit unassignment stays respected.
        if self.persist_first_assignment(session_id, slot)? {
            if let Some(index) = slot {
                self.slots[index] = Some(session_id.into());
            }
        }
        Ok(())
    }
}
