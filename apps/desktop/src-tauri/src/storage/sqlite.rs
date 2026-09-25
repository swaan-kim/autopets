use crate::application::store::*;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{collections::HashMap, path::Path};

pub(crate) fn db_err(e: rusqlite::Error) -> String {
    format!("State database: {e}")
}
pub(crate) fn encode<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("serializable enum")
}
pub(crate) fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(|e| format!("Invalid saved state: {e}"))
}

impl Store {
    pub fn new(data_dir: impl AsRef<Path>) -> Result<Self, String> {
        let data_dir = data_dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let db = Connection::open(data_dir.join("autopets.sqlite3")).map_err(db_err)?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, label TEXT NOT NULL, cwd TEXT NOT NULL,
                state TEXT NOT NULL, unread INTEGER NOT NULL, last_seen INTEGER NOT NULL,
                last_tool TEXT, connection TEXT NOT NULL, active_turn TEXT,
                last_activity_timestamp INTEGER NOT NULL, turn_finished INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS slots (slot INTEGER PRIMARY KEY, session_id TEXT);
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, session_id TEXT NOT NULL,
                turn_id TEXT, kind TEXT NOT NULL, tool_call_id TEXT, timestamp INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS events_session_turn_kind ON events(session_id,turn_id,kind);
            CREATE TABLE IF NOT EXISTS approvals (
                request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
                tool_name TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
                status TEXT NOT NULL, delivery TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS approvals_created ON approvals(created_at);
            CREATE TABLE IF NOT EXISTS task_config_requests (
                request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL, applied_at INTEGER NOT NULL);
            ",
        )
        .map_err(db_err)?;
        let has_supervision = {
            let mut stmt = db.prepare("PRAGMA table_info(sessions)").map_err(db_err)?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(db_err)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(db_err)?
                .iter()
                .any(|name| name == "supervision")
        };
        if !has_supervision {
            db.execute(
                "ALTER TABLE sessions ADD COLUMN supervision TEXT NOT NULL DEFAULT '{}'",
                [],
            )
            .map_err(db_err)?;
        }
        let mut store = Self {
            assistance: crate::application::assistance::AssistanceStore::new(&data_dir)?,
            workflow: crate::application::workflow::WorkflowStore::new(&data_dir)?,
            artifacts: crate::application::artifacts::ArtifactStore::new(&data_dir)?,
            db,
            sessions: HashMap::new(),
            slots: [None, None, None],
            approvals: HashMap::new(),
            approval_enabled: false,
            data_dir,
            connection_path: String::new(),
        };
        {
            let mut stmt = store.db.prepare("SELECT id,label,cwd,state,unread,last_seen,last_tool,connection,active_turn,last_activity_timestamp,turn_finished,supervision FROM sessions").map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, bool>(4)?,
                        r.get::<_, u64>(5)?,
                        r.get::<_, Option<String>>(6)?,
                        r.get::<_, String>(7)?,
                        r.get::<_, Option<String>>(8)?,
                        r.get::<_, u64>(9)?,
                        r.get::<_, bool>(10)?,
                        r.get::<_, String>(11)?,
                    ))
                })
                .map_err(db_err)?;
            for row in rows {
                let (
                    id,
                    label,
                    cwd,
                    state,
                    unread,
                    last_seen,
                    last_tool,
                    _,
                    active_turn,
                    last_activity_timestamp,
                    turn_finished,
                    saved_supervision,
                ) = row.map_err(db_err)?;
                let prior: SessionState = decode(&state)?;
                let state = if prior == SessionState::Done && unread {
                    SessionState::Done
                } else {
                    SessionState::Idle
                };
                let mut restored_supervision: SupervisionRecord = decode(&saved_supervision)?;
                restored_supervision.view.activity = Activity::Idle;
                if let Some(tools) = &mut restored_supervision.view.tool_activity_v1 {
                    tools.mark_unconfirmed();
                }
                store.sessions.insert(
                    id.clone(),
                    SessionRecord {
                        view: Session {
                            id,
                            label,
                            cwd,
                            state,
                            unread,
                            last_seen,
                            last_tool,
                            connection: ConnectionState::Unknown,
                            supervision: SessionSupervision::default(),
                        },
                        active_turn,
                        last_activity_timestamp,
                        turn_finished,
                        supervision: restored_supervision,
                    },
                );
            }
        }
        {
            let mut stmt = store
                .db
                .prepare("SELECT slot,session_id FROM slots")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get::<_, usize>(0)?, r.get::<_, Option<String>>(1)?))
                })
                .map_err(db_err)?;
            for row in rows {
                let (slot, session) = row.map_err(db_err)?;
                if slot < 3
                    && session
                        .as_ref()
                        .is_none_or(|id| store.sessions.contains_key(id))
                {
                    store.slots[slot] = session;
                }
            }
        }
        store.restore_approval_history()?;
        store.init_roles()?;
        Ok(store)
    }

    pub(crate) fn save_session(&self, id: &str) -> Result<(), String> {
        let r = self.sessions.get(id).ok_or("Unknown session")?;
        self.db.execute("INSERT OR REPLACE INTO sessions(id,label,cwd,state,unread,last_seen,last_tool,connection,active_turn,last_activity_timestamp,turn_finished,supervision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)", params![r.view.id,r.view.label,r.view.cwd,encode(&r.view.state),r.view.unread,r.view.last_seen,r.view.last_tool,encode(&r.view.connection),r.active_turn,r.last_activity_timestamp,r.turn_finished,encode(&r.supervision)]).map_err(db_err)?;
        Ok(())
    }

    pub(crate) fn with_session_transaction<T>(
        &mut self,
        session_id: &str,
        operation: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        let prior_session = self.sessions.get(session_id).cloned();
        let prior_slots = self.slots.clone();
        let prior_approvals: Vec<_> = self
            .approvals
            .iter()
            .filter(|(_, a)| a.view.session_id == session_id)
            .map(|(id, a)| (id.clone(), a.clone()))
            .collect();
        self.db
            .execute_batch("SAVEPOINT store_change")
            .map_err(db_err)?;
        let result = operation(self).and_then(|value| {
            self.db
                .execute_batch("RELEASE SAVEPOINT store_change")
                .map_err(db_err)?;
            Ok(value)
        });
        match result {
            Ok(value) => Ok(value),
            Err(error) => {
                let rollback = self.db.execute_batch(
                    "ROLLBACK TO SAVEPOINT store_change; RELEASE SAVEPOINT store_change",
                );
                match prior_session {
                    Some(session) => {
                        self.sessions.insert(session_id.to_owned(), session);
                    }
                    None => {
                        self.sessions.remove(session_id);
                    }
                }
                self.approvals
                    .retain(|_, a| a.view.session_id != session_id);
                self.approvals.extend(prior_approvals);
                self.slots = prior_slots;
                if let Err(rollback_error) = rollback {
                    return Err(format!("{error}; state rollback failed: {rollback_error}"));
                }
                Err(error)
            }
        }
    }
}

impl Store {
    pub(crate) fn persist_slot(&self, slot: usize, session_id: Option<&str>) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR REPLACE INTO slots(slot,session_id) VALUES(?1,?2)",
                params![slot, session_id],
            )
            .map_err(db_err)?;
        Ok(())
    }
    pub(crate) fn persist_unassignment(
        &mut self,
        slot: usize,
        session_id: Option<String>,
    ) -> Result<(), String> {
        let tx = self.db.transaction().map_err(db_err)?;
        if let Some(session_id) = session_id {
            tx.execute(
                "INSERT OR IGNORE INTO assistance_pet_assignments(session_id) VALUES(?1)",
                [session_id],
            )
            .map_err(db_err)?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO slots(slot,session_id) VALUES(?1,NULL)",
            [slot],
        )
        .map_err(db_err)?;
        tx.commit().map_err(db_err)
    }
    pub(crate) fn persist_first_assignment(
        &mut self,
        session_id: &str,
        slot: Option<usize>,
    ) -> Result<bool, String> {
        let tx = self.db.transaction().map_err(db_err)?;
        let first = tx
            .execute(
                "INSERT OR IGNORE INTO assistance_pet_assignments(session_id) VALUES(?1)",
                [session_id],
            )
            .map_err(db_err)?;
        if first == 0 {
            return Ok(false);
        }
        if let Some(slot) = slot {
            tx.execute(
                "INSERT OR REPLACE INTO slots(slot,session_id) VALUES(?1,?2)",
                params![slot, session_id],
            )
            .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(true)
    }
}

impl Store {
    pub(crate) fn record_event(&self, event: &EventInput, now: u64) -> Result<bool, String> {
        let inserted=self.db.execute("INSERT OR IGNORE INTO events(event_id,received_at,session_id,turn_id,kind,tool_call_id,timestamp) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![event.event_id,now,event.session_id,event.turn_id,encode(&event.kind),event.tool_call_id,event.timestamp]).map_err(db_err)?;
        Ok(inserted != 0)
    }
    pub(crate) fn is_retired_turn(&self, event: &EventInput) -> Result<bool, String> {
        self.db.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE session_id=?1 AND turn_id=?2 AND kind IN (?3,?4,?5))",params![event.session_id,event.turn_id,encode(&EventKind::TurnFinished),encode(&EventKind::Interrupted),encode(&EventKind::SessionEnded)],|row|row.get(0)).map_err(db_err)
    }
    pub(crate) fn configured_request_fingerprint(
        &self,
        request_id: &str,
    ) -> Result<Option<String>, String> {
        use rusqlite::OptionalExtension;
        self.db
            .query_row(
                "SELECT fingerprint FROM task_config_requests WHERE request_id=?1",
                [request_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)
    }
    pub(crate) fn record_task_configuration(
        &self,
        input: &TaskConfiguration,
        fingerprint: &str,
    ) -> Result<(), String> {
        self.db.execute("INSERT INTO task_config_requests(request_id,session_id,turn_id,fingerprint,applied_at) VALUES(?1,?2,?3,?4,?5)",params![input.request_id,input.session_id,input.turn_id,fingerprint,now_ms()]).map_err(db_err)?;
        Ok(())
    }
}
