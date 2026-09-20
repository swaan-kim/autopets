use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[path = "supervision.rs"]
mod supervision;
use supervision::SupervisionRecord;
pub use supervision::{
    Activity, InterventionMode, PlanPayload, SessionSupervision, TaskConfiguration, TaskConfigured,
    TaskContext,
};

pub const APPROVAL_TTL_MS: u64 = 30 * 60 * 1000;
pub const ADAPTER_LEASE_MS: u64 = 45 * 1000;
pub type SharedStore = Arc<Mutex<Store>>;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sessions: Vec<Session>,
    pub slots: Vec<Slot>,
    pub approvals: Vec<Approval>,
    pub approval_enabled: bool,
    pub connection_path: String,
    pub now: u64,
    pub capabilities: Capabilities,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub token_usage: &'static str,
    pub task_return: &'static str,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub label: String,
    pub cwd: String,
    pub state: SessionState,
    pub unread: bool,
    pub last_seen: u64,
    pub last_tool: Option<String>,
    pub connection: ConnectionState,
    #[serde(default, flatten)]
    pub supervision: SessionSupervision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Idle,
    Working,
    Waiting,
    Done,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Observed,
    Unknown,
    Ended,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub index: usize,
    pub session_id: Option<String>,
}

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
pub struct EventInput {
    pub event_id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub kind: EventKind,
    pub cwd: String,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub timestamp: u64,
    pub activity: Option<Activity>,
    pub plan: Option<PlanPayload>,
    pub tool_error: Option<bool>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    SessionStarted,
    TurnStarted,
    ToolStarted,
    ToolFinished,
    TurnFinished,
    Interrupted,
    SessionEnded,
    PlanUpdated,
    PermissionRequested,
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
struct SessionRecord {
    view: Session,
    active_turn: Option<String>,
    last_activity_timestamp: u64,
    turn_finished: bool,
    supervision: SupervisionRecord,
}

#[derive(Clone, Debug)]
struct ApprovalRecord {
    view: Approval,
    lease_until: u64,
    live: bool,
    fingerprint: Option<[u8; 32]>,
}

pub struct Store {
    db: Connection,
    pub assistance: crate::assistance::AssistanceStore,
    sessions: HashMap<String, SessionRecord>,
    slots: [Option<String>; 3],
    approvals: HashMap<String, ApprovalRecord>,
    approval_enabled: bool,
    pub data_dir: PathBuf,
    connection_path: String,
}

fn db_err(e: rusqlite::Error) -> String {
    format!("State database: {e}")
}
fn encode<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("serializable enum")
}
fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(|e| format!("Invalid saved state: {e}"))
}
fn validate_id(value: &str, name: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        Err(format!("Invalid {name}"))
    } else {
        Ok(())
    }
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
            assistance: crate::assistance::AssistanceStore::new(&data_dir)?,
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
        {
            let mut stmt = store.db.prepare("SELECT request_id,session_id,turn_id,tool_name,created_at,expires_at,status,delivery FROM approvals ORDER BY created_at DESC LIMIT 200").map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, u64>(4)?,
                        r.get::<_, u64>(5)?,
                        r.get::<_, String>(6)?,
                        r.get::<_, String>(7)?,
                    ))
                })
                .map_err(db_err)?;
            for row in rows {
                let (
                    request_id,
                    session_id,
                    turn_id,
                    tool_name,
                    created_at,
                    expires_at,
                    status,
                    delivery,
                ) = row.map_err(db_err)?;
                let mut delivery: Delivery = decode(&delivery)?;
                let prior_status: ApprovalStatus = decode(&status)?;
                let status = if prior_status == ApprovalStatus::Pending {
                    ApprovalStatus::Cancelled
                } else {
                    prior_status
                };
                if delivery == Delivery::Waiting
                    && matches!(status, ApprovalStatus::Approved | ApprovalStatus::Denied)
                {
                    delivery = Delivery::Invalidated;
                }
                store.approvals.insert(
                    request_id.clone(),
                    ApprovalRecord {
                        view: Approval {
                            request_id,
                            session_id,
                            turn_id,
                            tool_name,
                            description: String::new(),
                            details: String::new(),
                            created_at,
                            expires_at,
                            status,
                            delivery,
                        },
                        lease_until: 0,
                        live: false,
                        fingerprint: None,
                    },
                );
            }
        }
        // Every new process starts observation-only. Persisted decisions are history, never deliverable.
        store
            .db
            .execute(
                "UPDATE approvals SET status=CASE WHEN status=?1 THEN ?2 ELSE status END, delivery=CASE WHEN status IN (?3,?4) THEN ?5 ELSE delivery END WHERE delivery=?6",
                params![
                    encode(&ApprovalStatus::Pending),
                    encode(&ApprovalStatus::Cancelled),
                    encode(&ApprovalStatus::Approved),
                    encode(&ApprovalStatus::Denied),
                    encode(&Delivery::Invalidated),
                    encode(&Delivery::Waiting)
                ],
            )
            .map_err(db_err)?;
        Ok(store)
    }

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
            capabilities: Capabilities {
                token_usage: "unavailable",
                task_return: "manual",
            },
        }
    }

    fn save_session(&self, id: &str) -> Result<(), String> {
        let r = self.sessions.get(id).ok_or("Unknown session")?;
        self.db.execute("INSERT OR REPLACE INTO sessions(id,label,cwd,state,unread,last_seen,last_tool,connection,active_turn,last_activity_timestamp,turn_finished,supervision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)", params![r.view.id,r.view.label,r.view.cwd,encode(&r.view.state),r.view.unread,r.view.last_seen,r.view.last_tool,encode(&r.view.connection),r.active_turn,r.last_activity_timestamp,r.turn_finished,encode(&r.supervision)]).map_err(db_err)?;
        Ok(())
    }

    fn save_approval(&self, id: &str) -> Result<(), String> {
        let a = &self.approvals.get(id).ok_or("Unknown approval")?.view;
        self.db.execute("INSERT OR REPLACE INTO approvals(request_id,session_id,turn_id,tool_name,created_at,expires_at,status,delivery) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![a.request_id,a.session_id,a.turn_id,a.tool_name,a.created_at,a.expires_at,encode(&a.status),encode(&a.delivery)]).map_err(db_err)?;
        Ok(())
    }

    fn ensure_session(&mut self, id: &str, cwd: &str, now: u64) {
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

    fn apply_event_at(&mut self, event: EventInput, now: u64) -> Result<(), String> {
        let session_id = event.session_id.clone();
        self.with_session_transaction(&session_id, |store| store.apply_event_inner(event, now))
    }

    // One database savepoint and its matching in-memory rollback cover every affected
    // session record. Nested approval changes compose with the outer event savepoint.
    fn with_session_transaction<T>(
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

    fn apply_event_inner(&mut self, event: EventInput, now: u64) -> Result<(), String> {
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
        let inserted = self
            .db
            .execute(
                "INSERT OR IGNORE INTO events(event_id,received_at,session_id,turn_id,kind,tool_call_id,timestamp) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![event.event_id,now,event.session_id,event.turn_id,encode(&event.kind),event.tool_call_id,event.timestamp],
            )
            .map_err(db_err)?;
        if inserted == 0 {
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
            let retired: bool = self.db.query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE session_id=?1 AND turn_id=?2 AND kind IN (?3,?4,?5))",
                params![event.session_id,event.turn_id,encode(&EventKind::TurnFinished),encode(&EventKind::Interrupted),encode(&EventKind::SessionEnded)],
                |row|row.get(0),
            ).map_err(db_err)?;
            retired
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

    fn has_pending(&self, session_id: &str) -> bool {
        self.approvals
            .values()
            .any(|a| a.view.session_id == session_id && a.view.status == ApprovalStatus::Pending)
    }

    fn refresh_waiting(&mut self, session_id: &str) {
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
        self.db
            .execute(
                "INSERT OR REPLACE INTO slots(slot,session_id) VALUES(?1,?2)",
                params![slot, session_id],
            )
            .map_err(db_err)?;
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
        let tx = self.db.transaction().map_err(db_err)?;
        if let Some(session_id) = &self.slots[slot] {
            // A deliberate removal must remain removed even if the first
            // assistance preparation arrives later or the app restarts.
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
        tx.commit().map_err(db_err)?;
        self.slots[slot] = None;
        Ok(())
    }

    pub fn assign_first_assistance_pet(
        &mut self,
        identity: &crate::assistance::Identity,
    ) -> Result<bool, String> {
        if identity.provider != crate::assistance::Provider::Codex
            || !self.sessions.contains_key(&identity.chat_id)
            || !self.assistance.has_enabled_preparation(identity)?
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
        let tx = self.db.transaction().map_err(db_err)?;
        let first = tx
            .execute(
                "INSERT OR IGNORE INTO assistance_pet_assignments(session_id) VALUES(?1)",
                [&identity.chat_id],
            )
            .map_err(db_err)?;
        if first == 0 {
            return Ok(false);
        }
        if let Some(slot) = slot {
            tx.execute(
                "INSERT OR REPLACE INTO slots(slot,session_id) VALUES(?1,?2)",
                params![slot, identity.chat_id],
            )
            .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
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

    fn register_approval_at(
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

    fn register_approval_inner(
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

    fn check_binding(
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

    // Only this in-memory process may deliver decisions. SQLite is never a delivery queue.
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

    fn wait_status_at(
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

    fn resolve_approval_at(
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

    fn finish_approval(&mut self, request_id: &str, status: ApprovalStatus) -> Result<(), String> {
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

    pub fn tick(&mut self) -> Result<bool, String> {
        self.tick_at(now_ms())
    }

    fn tick_at(&mut self, now: u64) -> Result<bool, String> {
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
mod tests {
    use super::*;
    fn event(id: &str, turn: &str, kind: EventKind, timestamp: u64) -> EventInput {
        EventInput {
            event_id: id.into(),
            session_id: "s1".into(),
            turn_id: Some(turn.into()),
            kind,
            cwd: "C:/test".into(),
            tool_name: None,
            tool_call_id: None,
            timestamp,
            activity: None,
            plan: None,
            tool_error: None,
        }
    }
    fn request(id: &str) -> ApprovalInput {
        ApprovalInput {
            request_id: id.into(),
            session_id: "s1".into(),
            turn_id: "t1".into(),
            cwd: "C:/test".into(),
            tool_name: "shell".into(),
            description: "Private reason".into(),
            details: "PRIVATE_COMMAND_SECRET".into(),
        }
    }
    fn ready() -> (tempfile::TempDir, Store, u64) {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::new(dir.path()).unwrap();
        let now = now_ms();
        s.apply_event_at(event("e1", "t1", EventKind::TurnStarted, now), now)
            .unwrap();
        s.assign_session(0, "s1").unwrap();
        s.set_approval_enabled(true).unwrap();
        (dir, s, now)
    }
    fn prepare_assistance(s: &mut Store, session_id: &str) -> crate::assistance::Identity {
        let identity = crate::assistance::Identity {
            provider: crate::assistance::Provider::Codex,
            account_id: format!("session:{:x}", Sha256::digest(session_id.as_bytes())),
            chat_id: session_id.into(),
        };
        s.assistance
            .dispatch(crate::assistance::Request::Read {
                identity: identity.clone(),
                binding: None,
            })
            .unwrap();
        let preferences_revision = s.assistance.preferences().unwrap().revision;
        s.assistance
            .dispatch(crate::assistance::Request::Prepare {
                identity: identity.clone(),
                binding: None,
                expected_revision: 0,
                preferences_revision,
                recipe_id: "general".into(),
                requested_model: None,
                reason: "준비".into(),
                injection_bytes: 100,
                guidance_hash: "a".repeat(64),
            })
            .unwrap();
        identity
    }
    #[test]
    fn first_preparation_uses_only_empty_slots_and_never_repeats_or_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::new(dir.path()).unwrap();
        let n = now_ms();
        let mut preferences = s.assistance.preferences().unwrap();
        preferences.enabled = true;
        s.assistance.save_preferences(preferences).unwrap();
        for index in 1..=4 {
            let mut e = event(
                &format!("assistance-{index}"),
                "t1",
                EventKind::TurnStarted,
                n,
            );
            e.session_id = format!("s{index}");
            s.apply_event_at(e, n).unwrap();
        }
        s.configure_session(
            "s1",
            "사용자 완료 기준",
            InterventionMode::Milestones,
            Some(5),
        )
        .unwrap();
        s.assign_session(2, "s1").unwrap();
        let first = prepare_assistance(&mut s, "s1");
        assert!(!s.assign_first_assistance_pet(&first).unwrap());
        assert_eq!(s.slots[2].as_deref(), Some("s1"));
        let second = prepare_assistance(&mut s, "s2");
        assert!(s.assign_first_assistance_pet(&second).unwrap());
        assert!(!s.assign_first_assistance_pet(&second).unwrap());
        let third = prepare_assistance(&mut s, "s3");
        assert!(s.assign_first_assistance_pet(&third).unwrap());
        let fourth = prepare_assistance(&mut s, "s4");
        assert!(!s.assign_first_assistance_pet(&fourth).unwrap());
        assert_eq!(s.assistance.overview().unwrap().tasks.len(), 4);
        assert_eq!(
            s.slots,
            [Some("s2".into()), Some("s3".into()), Some("s1".into())]
        );
        let supervision = &s.sessions["s1"].supervision.view;
        assert_eq!(supervision.completion_criterion, "사용자 완료 기준");
        assert_eq!(supervision.elapsed_alert_minutes, Some(5));
        assert!(matches!(
            supervision.intervention_mode,
            InterventionMode::Milestones
        ));
        s.unassign_session(0).unwrap();
        assert!(!s.assign_first_assistance_pet(&second).unwrap());
        assert!(!s.assign_first_assistance_pet(&fourth).unwrap());
        assert!(s.slots[0].is_none());
    }
    #[test]
    fn manual_removal_before_preparation_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let n = now_ms();
        {
            let mut s = Store::new(dir.path()).unwrap();
            s.apply_event_at(event("first", "t1", EventKind::TurnStarted, n), n)
                .unwrap();
            s.assign_session(0, "s1").unwrap();
            s.unassign_session(0).unwrap();
        }
        let mut s = Store::new(dir.path()).unwrap();
        s.apply_event_at(event("second", "t2", EventKind::TurnStarted, n + 1), n + 1)
            .unwrap();
        let mut preferences = s.assistance.preferences().unwrap();
        preferences.enabled = true;
        s.assistance.save_preferences(preferences).unwrap();
        let identity = prepare_assistance(&mut s, "s1");
        assert!(!s.assign_first_assistance_pet(&identity).unwrap());
        assert!(s.slots.iter().all(Option::is_none));
    }
    #[test]
    fn failed_first_assignment_rolls_back_attempt_marker_with_slot() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::new(dir.path()).unwrap();
        let n = now_ms();
        s.apply_event_at(event("first", "t1", EventKind::TurnStarted, n), n)
            .unwrap();
        let mut preferences = s.assistance.preferences().unwrap();
        preferences.enabled = true;
        s.assistance.save_preferences(preferences).unwrap();
        let identity = prepare_assistance(&mut s, "s1");
        s.db.execute_batch("CREATE TRIGGER failed_pet_assignment BEFORE INSERT ON slots BEGIN SELECT RAISE(ABORT,'injected assignment failure'); END;").unwrap();
        assert!(s.assign_first_assistance_pet(&identity).is_err());
        assert!(s.slots.iter().all(Option::is_none));
        let count: u64 =
            s.db.query_row(
                "SELECT count(*) FROM assistance_pet_assignments WHERE session_id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        s.db.execute_batch("DROP TRIGGER failed_pet_assignment")
            .unwrap();
        assert!(s.assign_first_assistance_pet(&identity).unwrap());
    }
    #[test]
    fn observation_default_and_unassigned_passthrough() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::new(d.path()).unwrap();
        assert!(!s.snapshot().approval_enabled);
        assert_eq!(
            s.register_approval(request("a1")).unwrap().mode,
            "passthrough"
        );
        s.set_approval_enabled(true).unwrap();
        assert_eq!(
            s.register_approval(request("a2")).unwrap().mode,
            "passthrough"
        );
        assert!(s.snapshot().approvals.is_empty());
    }
    #[test]
    fn duplicate_events_and_old_turns_do_not_overwrite_current_state() {
        let (_d, mut s, now) = ready();
        s.apply_event_at(
            event("e2", "t2", EventKind::TurnStarted, now + 10),
            now + 10,
        )
        .unwrap();
        s.apply_event_at(
            event("e3", "t1", EventKind::TurnFinished, now + 20),
            now + 20,
        )
        .unwrap();
        assert_eq!(s.sessions["s1"].view.state, SessionState::Working);
        s.apply_event_at(
            event("e4", "t2", EventKind::TurnFinished, now + 30),
            now + 30,
        )
        .unwrap();
        s.acknowledge("s1").unwrap();
        s.apply_event_at(
            event("e4", "t2", EventKind::TurnFinished, now + 30),
            now + 40,
        )
        .unwrap();
        assert!(!s.sessions["s1"].view.unread);
    }
    #[test]
    fn unread_completion_survives_next_turn_and_resume() {
        let (_d, mut s, n) = ready();
        s.apply_event_at(event("e2", "t1", EventKind::TurnFinished, n + 1), n + 1)
            .unwrap();
        s.apply_event_at(event("e3", "t2", EventKind::TurnStarted, n + 2), n + 2)
            .unwrap();
        s.apply_event_at(event("e4", "t2", EventKind::SessionStarted, n + 3), n + 3)
            .unwrap();
        assert_eq!(s.sessions["s1"].view.state, SessionState::Working);
        assert!(s.sessions["s1"].view.unread);
    }
    #[test]
    fn approvals_are_bound_first_decision_wins_and_details_are_erased() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        assert!(s
            .resolve_approval_at("a1", "other", "t1", Decision::Allow, n + 1)
            .is_err());
        s.resolve_approval_at("a1", "s1", "t1", Decision::Deny, n + 1)
            .unwrap();
        s.resolve_approval_at("a1", "s1", "t1", Decision::Deny, n + 2)
            .unwrap();
        assert!(s
            .resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 2)
            .is_err());
        assert_eq!(
            s.wait_status_at("a1", "s1", "t1", n + 2).unwrap().status,
            ApprovalStatus::Denied
        );
        assert!(s.approvals["a1"].view.details.is_empty());
        s.mark_returned("a1", "s1", "t1").unwrap();
        assert_eq!(
            s.wait_status_at("a1", "s1", "t1", n + 3).unwrap().status,
            ApprovalStatus::Cancelled
        );
    }
    #[test]
    fn concurrent_allow_deny_has_one_winner() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        let shared = Arc::new(Mutex::new(s));
        let handles: Vec<_> = [Decision::Allow, Decision::Deny]
            .into_iter()
            .map(|d| {
                let shared = shared.clone();
                std::thread::spawn(move || {
                    shared
                        .lock()
                        .unwrap()
                        .resolve_approval_at("a1", "s1", "t1", d, n + 1)
                        .is_ok()
                })
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|h| usize::from(h.join().unwrap()))
                .sum::<usize>(),
            1
        );
    }
    #[test]
    fn lease_and_thirty_minute_deadline_cannot_be_extended_by_polling() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("lost"), n).unwrap();
        s.tick_at(n + ADAPTER_LEASE_MS).unwrap();
        assert_eq!(s.approvals["lost"].view.status, ApprovalStatus::Forwarded);
        s.register_approval_at(request("live"), n + ADAPTER_LEASE_MS + 1)
            .unwrap();
        let start = n + ADAPTER_LEASE_MS + 1;
        for delta in (15000..APPROVAL_TTL_MS).step_by(15000) {
            assert_eq!(
                s.wait_status_at("live", "s1", "t1", start + delta)
                    .unwrap()
                    .status,
                ApprovalStatus::Pending
            );
        }
        assert_eq!(
            s.wait_status_at("live", "s1", "t1", start + APPROVAL_TTL_MS)
                .unwrap()
                .status,
            ApprovalStatus::Forwarded
        );
        assert!(s
            .resolve_approval_at("live", "s1", "t1", Decision::Allow, start + APPROVAL_TTL_MS)
            .is_err());
    }
    #[test]
    fn pending_requests_lock_assignment_and_new_turn_cancels_old_request() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        assert!(s.unassign_session(0).is_err());
        assert!(s.assign_session(1, "s1").is_err());
        s.apply_event_at(event("e2", "t2", EventKind::TurnStarted, n + 1), n + 1)
            .unwrap();
        assert_eq!(s.approvals["a1"].view.status, ApprovalStatus::Cancelled);
        s.unassign_session(0).unwrap();
    }
    #[test]
    fn restart_preserves_assignment_but_never_replays_decisions_or_secrets() {
        let (d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        s.resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 1)
            .unwrap();
        drop(s);
        let mut restored = Store::new(d.path()).unwrap();
        assert!(!restored.snapshot().approval_enabled);
        assert_eq!(restored.slots[0].as_deref(), Some("s1"));
        assert!(restored.wait_status("a1", "s1", "t1").is_err());
        assert_eq!(
            restored.approvals["a1"].view.status,
            ApprovalStatus::Approved
        );
        assert_eq!(
            restored.approvals["a1"].view.delivery,
            Delivery::Invalidated
        );
        let rows: String = restored
            .db
            .query_row("SELECT group_concat(sql) FROM sqlite_master", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!rows.contains("details"));
        assert!(!rows.contains("description"));
        for file in std::fs::read_dir(d.path()).unwrap().flatten() {
            let bytes = std::fs::read(file.path()).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_COMMAND_SECRET"));
        }
    }

    #[test]
    fn undelivered_decisions_are_revoked_when_turn_changes_or_lease_dies() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        s.resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 1)
            .unwrap();
        s.apply_event_at(event("e2", "t2", EventKind::TurnStarted, n + 2), n + 2)
            .unwrap();
        assert!(s.wait_status_at("a1", "s1", "t1", n + 3).is_err());
        assert_eq!(s.approvals["a1"].view.delivery, Delivery::Invalidated);
        let (_d2, mut s2, n2) = ready();
        s2.register_approval_at(request("a2"), n2).unwrap();
        s2.resolve_approval_at("a2", "s1", "t1", Decision::Allow, n2 + 1)
            .unwrap();
        assert!(s2
            .wait_status_at("a2", "s1", "t1", n2 + ADAPTER_LEASE_MS)
            .is_err());
        assert_eq!(s2.approvals["a2"].view.delivery, Delivery::Invalidated);
    }

    #[test]
    fn completed_turn_cannot_be_revived_by_late_start_even_without_original_start() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::new(d.path()).unwrap();
        let n = now_ms();
        s.apply_event_at(event("finished", "t1", EventKind::TurnFinished, n), n)
            .unwrap();
        s.apply_event_at(
            event("late-start", "t1", EventKind::TurnStarted, n + 1),
            n + 1,
        )
        .unwrap();
        assert_eq!(s.sessions["s1"].view.state, SessionState::Done);
        assert!(s.sessions["s1"].turn_finished);
    }

    #[test]
    fn duplicate_registration_must_have_identical_content() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        assert_eq!(
            s.register_approval_at(request("a1"), n + 1).unwrap().mode,
            "pending"
        );
        s.resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 2)
            .unwrap();
        let mut changed = request("a1");
        changed.details = "Different command".into();
        assert!(s.register_approval_at(changed, n + 3).is_err());
        let mut changed = request("a1");
        changed.cwd = "C:/other".into();
        assert!(s.register_approval_at(changed, n + 3).is_err());
        assert_eq!(
            s.register_approval_at(request("a1"), n + 3).unwrap().mode,
            "pending"
        );
        s.set_approval_enabled(false).unwrap();
        assert_eq!(s.approvals["a1"].view.delivery, Delivery::Invalidated);
    }

    #[test]
    fn tool_call_identity_is_saved_without_tool_content() {
        let (_d, mut s, n) = ready();
        let mut e = event("tool", "t1", EventKind::ToolStarted, n + 1);
        e.tool_call_id = Some("call-123".into());
        s.apply_event_at(e, n + 1).unwrap();
        let actual: String =
            s.db.query_row(
                "SELECT tool_call_id FROM events WHERE event_id='tool'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(actual, "call-123");
    }

    #[test]
    fn failed_event_commit_rolls_back_event_id_state_and_nested_approval_changes() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        s.db.execute_batch("CREATE TRIGGER injected_failure BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
        assert!(s
            .apply_event_at(
                event("new-turn", "t2", EventKind::TurnStarted, n + 1),
                n + 1
            )
            .is_err());
        assert_eq!(s.sessions["s1"].active_turn.as_deref(), Some("t1"));
        assert_eq!(s.sessions["s1"].view.state, SessionState::Waiting);
        assert_eq!(s.approvals["a1"].view.status, ApprovalStatus::Pending);
        let seen: u64 =
            s.db.query_row(
                "SELECT count(*) FROM events WHERE event_id='new-turn'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(seen, 0);
        s.db.execute_batch("DROP TRIGGER injected_failure").unwrap();
        s.apply_event_at(
            event("new-turn", "t2", EventKind::TurnStarted, n + 1),
            n + 1,
        )
        .unwrap();
        assert_eq!(s.approvals["a1"].view.status, ApprovalStatus::Cancelled);
        assert_eq!(s.sessions["s1"].active_turn.as_deref(), Some("t2"));
    }

    #[test]
    fn failed_decision_commit_never_becomes_deliverable() {
        let (_d, mut s, n) = ready();
        s.register_approval_at(request("a1"), n).unwrap();
        s.db.execute_batch("CREATE TRIGGER injected_failure BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
        assert!(s
            .resolve_approval_at("a1", "s1", "t1", Decision::Allow, n + 1)
            .is_err());
        assert_eq!(
            s.wait_status_at("a1", "s1", "t1", n + 2).unwrap().status,
            ApprovalStatus::Pending
        );
        assert_eq!(s.approvals["a1"].view.details, "PRIVATE_COMMAND_SECRET");
        let persisted: String =
            s.db.query_row(
                "SELECT status FROM approvals WHERE request_id='a1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            decode::<ApprovalStatus>(&persisted).unwrap(),
            ApprovalStatus::Pending
        );
        s.db.execute_batch("DROP TRIGGER injected_failure").unwrap();
        s.resolve_approval_at("a1", "s1", "t1", Decision::Deny, n + 3)
            .unwrap();
        assert_eq!(
            s.wait_status_at("a1", "s1", "t1", n + 4).unwrap().status,
            ApprovalStatus::Denied
        );
    }

    #[test]
    fn failed_registration_does_not_leave_a_ghost_approval() {
        let (_d, mut s, n) = ready();
        s.db.execute_batch("CREATE TRIGGER injected_failure BEFORE INSERT ON sessions WHEN NEW.state = '\"waiting\"' BEGIN SELECT RAISE(ABORT,'injected write failure'); END;").unwrap();
        assert!(s.register_approval_at(request("a1"), n).is_err());
        assert!(!s.approvals.contains_key("a1"));
        let rows: u64 =
            s.db.query_row(
                "SELECT count(*) FROM approvals WHERE request_id='a1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
        assert_eq!(s.sessions["s1"].view.state, SessionState::Working);
    }
}
