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
    pub host_id: Option<String>,
    pub entry_point: Option<String>,
    pub connection_mode: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_setup_does_not_enable_legacy_automatic_workflow() {
        let dir=tempfile::tempdir().unwrap();let mut store=Store::new(dir.path()).unwrap();
        let before=store.workflow.preferences().unwrap();
        let mut input=request("explicit-fixture",&dir.path().to_string_lossy());
        input.connection_mode=Some("explicit-pet".into());
        let state=store.begin_setup(input).unwrap();
        assert_eq!(state["nextAction"],"send-message");assert_eq!(state["chatConnected"],false);
        let after=store.workflow.preferences().unwrap();assert_eq!(before.revision,after.revision);assert_eq!(before.enabled,after.enabled);
    }
    fn request(id: &str, cwd: &str) -> SetupRequest {
        SetupRequest {
            installed_version: env!("CARGO_PKG_VERSION").into(),
            session_id: Some(id.into()),
            cwd: Some(cwd.into()),
            host_id: None,
            entry_point: None,
            connection_mode: None,
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
        // The established timer measures the first real observation; no
        // synthetic turn_started event is inserted to connect the pet.
        let starts: i64 = store
            .db
            .query_row(
                "SELECT COUNT(*) FROM events WHERE kind=?1",
                [
                    serde_json::to_string(&crate::domain::activity::EventKind::TurnStarted)
                        .unwrap(),
                ],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(starts, 0);
        assert_eq!(store.setup_status().unwrap()["chatConnected"], true);
    }
    #[test]
    fn installed_app_waits_for_new_event_and_keeps_first_task_stable() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let mut store = Store::new(dir.path()).unwrap();
        event(&mut store, "before-connect", &cwd);
        let mut input = request("unused", &cwd);
        input.session_id = None;
        input.cwd = None;
        input.host_id = Some(crate::domain::connections::CODEX_LOCAL.into());
        input.entry_point = Some("desktop".into());
        store.begin_setup(input.clone()).unwrap();
        assert_eq!(store.setup_status().unwrap()["chatConnected"], false);
        // A delayed old event is observable, but cannot prove this new setup worked.
        let configured = store.read_setup().unwrap().unwrap().configured_at;
        store.apply_event(serde_json::from_value(serde_json::json!({
            "eventId":"delayed-before-setup","sessionId":"delayed","turnId":"old-turn",
            "kind":"turn_started","cwd":cwd,"timestamp":configured.saturating_sub(1)
        })).unwrap()).unwrap();
        assert_eq!(store.setup_status().unwrap()["chatConnected"], false);
        event(&mut store, "first-real", &cwd);
        event(&mut store, "second-real", &cwd);
        let state = store.setup_status().unwrap();
        assert_eq!(state["connections"][0]["firstTask"]["sessionId"], "first-real");
        assert_eq!(state["connections"][0]["hostVersion"], serde_json::Value::Null);
        assert_eq!(state["guidanceDelivered"], false);
        store.begin_setup(input.clone()).unwrap();
        assert_eq!(store.setup_status().unwrap()["connections"][0]["firstTask"]["sessionId"], "first-real");
        store.disconnect_setup(crate::domain::connections::CODEX_LOCAL).unwrap();
        event(&mut store, "after-disconnect", &cwd);
        assert_eq!(store.setup_status().unwrap()["chatConnected"], false);
        assert!(!store.slots.iter().any(|slot| slot.as_deref() == Some("after-disconnect")));
        store.begin_setup(input).unwrap();
        assert_eq!(store.setup_status().unwrap()["chatConnected"], false);
        event(&mut store, "reconnected", &cwd);
        assert_eq!(store.setup_status().unwrap()["connections"][0]["firstTask"]["sessionId"], "reconnected");
    }
    #[test]
    fn legacy_setup_reads_without_migration_and_unknown_hosts_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        std::fs::write(dir.path().join("setup-state-v1.json"), serde_json::to_vec(&serde_json::json!({
            "version":1,"request":{"installedVersion":env!("CARGO_PKG_VERSION"),"sessionId":null,"cwd":null}
        })).unwrap()).unwrap();
        assert_eq!(store.setup_status().unwrap()["phase"], "connecting");
        let mut input = request("unknown", &dir.path().to_string_lossy());
        input.host_id = Some("claude-web".into());
        assert!(store.begin_setup(input).is_err());
        assert!(!store.sessions.contains_key("unknown"));
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    version: u8,
    request: SetupRequest,
    #[serde(default)]
    configured_at: u64,
    #[serde(default)]
    disconnected: bool,
    #[serde(default)]
    first_observed_session: Option<String>,
}

fn identity(id: &str) -> Identity {
    Identity {
        provider: Provider::Codex,
        account_id: format!("session:{:x}", Sha256::digest(id.as_bytes())),
        chat_id: id.into(),
    }
}
impl Store {
    fn read_setup(&self) -> Result<Option<Saved>, String> {
        match std::fs::read(self.data_dir.join("setup-state-v1.json")) {
            Ok(bytes) => serde_json::from_slice::<Saved>(&bytes)
                .map(Some).map_err(|_| "Invalid setup state".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn write_setup(&self, saved: &Saved) -> Result<(), String> {
        let temporary = self.data_dir.join(format!("setup-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temporary, serde_json::to_vec(saved).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        std::fs::rename(temporary, self.data_dir.join("setup-state-v1.json"))
            .map_err(|e| e.to_string())
    }
    pub fn disconnect_setup(&mut self, host_id: &str) -> Result<serde_json::Value, String> {
        crate::domain::connections::require_connectable(host_id)?;
        if let Some(mut saved) = self.read_setup()? {
            saved.disconnected = true;
            self.write_setup(&saved)?;
        }
        // Retain chat records, explicit opt-outs and desired preferences.
        self.disconnect_explicit_pets()?;
        self.setup_status()
    }
    pub(crate) fn observe_setup_event(&mut self, session_id: &str, timestamp: u64) -> Result<bool, String> {
        let Some(mut saved) = self.read_setup()? else { return Ok(false) };
        if saved.disconnected || timestamp < saved.configured_at {
            return Ok(false);
        }
        if saved.request.session_id.is_none() && saved.first_observed_session.is_none() {
            saved.first_observed_session = Some(session_id.into());
            self.write_setup(&saved)?;
        }
        Ok(true)
    }
    pub fn begin_setup(&mut self, input: SetupRequest) -> Result<serde_json::Value, String> {
        if input.connection_mode.as_deref().is_some_and(|mode| mode != "explicit-pet") { return Err("Invalid connection mode".into()); }
        crate::domain::connections::require_connectable(input.host_id.as_deref().unwrap_or(crate::domain::connections::CODEX_LOCAL))?;
        if input.entry_point.as_deref().is_some_and(|entry| !["desktop", "ai", "store"].contains(&entry)) {
            return Err("Invalid setup entry point".into());
        }
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
        if !file.exists() && input.connection_mode.as_deref() != Some("explicit-pet") {
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
        let previous = self.read_setup()?;
        let unchanged = previous.as_ref().is_some_and(|saved| !saved.disconnected
            && saved.request.session_id == input.session_id && saved.request.cwd == input.cwd);
        let configured_at = previous.as_ref().filter(|_| unchanged)
            .map(|saved| saved.configured_at).unwrap_or_else(crate::domain::activity::now_ms);
        let first_observed_session = previous.filter(|_| unchanged).and_then(|saved| saved.first_observed_session);
        self.write_setup(&Saved { version: 1, request: input, configured_at, disconnected: false, first_observed_session })?;
        if let Some(id) = current {
            self.assign_setup_pet(&id)?;
        }
        self.setup_status()
    }
    pub fn setup_status(&self) -> Result<serde_json::Value, String> {
        let saved = self.read_setup()?;
        let request = saved.as_ref().map(|s| &s.request);
        let configured = saved.as_ref().is_some_and(|s| !s.disconnected);
        let current_id = saved.as_ref().and_then(|s| s.request.session_id.as_ref().or(s.first_observed_session.as_ref()));
        let chat = current_id
            .and_then(|id| self.sessions.get(id));
        let connected = configured && chat.is_some_and(|s| {
            matches!(
                s.view.connection,
                crate::domain::activity::ConnectionState::Observed
            )
        });
        let confirmed = configured && if let Some(id) = current_id {
            self.assistance
                .load(&identity(id))
                .ok()
                .is_some_and(|r| r.task.assistance.status == Status::Confirmed)
        } else {
            false
        };
        Ok(
            serde_json::json!({ "version":1, "installedVersion":env!("CARGO_PKG_VERSION"),
            "phase": if !configured { "not-started" } else if connected { "ready" } else { "connecting" },
            "appReady":true, "chatConnected":connected, "guidanceDelivered":confirmed,
            "protection":{"model":false,"reasoning":false,"submission":false},
            "retryable":true, "nextAction":if !configured { "start" } else if connected { "none" } else if request.is_some_and(|r| r.connection_mode.as_deref()==Some("explicit-pet")) { "send-message" } else { "review-hooks" },
            "connectionMode":request.and_then(|r| r.connection_mode.as_ref()),
            "currentHostId": request.map(|r| r.host_id.as_deref().unwrap_or(crate::domain::connections::CODEX_LOCAL)),
            "entryPoint":request.and_then(|r| r.entry_point.as_ref()),
            "hosts":crate::domain::connections::catalog(),
            "connections": if saved.is_some() { vec![serde_json::json!({
                "hostId":crate::domain::connections::CODEX_LOCAL,
                "configured":configured,
                "status":if !configured { "disconnected" } else if connected { "connected" } else { "waiting-for-event" },
                "hostVersion":null,
                "firstTask":if connected { chat.map(|s| serde_json::json!({"sessionId":s.view.id,"lastEventAt":s.view.last_seen})) } else { None },
                "guidanceDelivered":confirmed,
                "settingsVerified":{"model":false,"reasoning":false,"submission":false}
            })] } else { vec![] } }),
        )
    }
    pub(crate) fn assign_setup_pet(&mut self, session_id: &str) -> Result<(), String> {
        if !self.read_setup()?.is_some_and(|saved| !saved.disconnected) {
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
