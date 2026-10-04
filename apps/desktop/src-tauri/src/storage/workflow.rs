//! Additive versioned tables do not rewrite the older strict assistance JSON.
use crate::application::workflow::WorkflowStore;
use crate::domain::assistance::{err, Identity};
use crate::domain::workflow::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

impl WorkflowStore {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        let db = Connection::open(data_dir.join("autopets.sqlite3")).map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(err)?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS workflow_preferences_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workflow_tasks_v1 (identity TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(err)?;
        let mut store = Self { db };
        let mut records = store.records()?;
        for record in &mut records {
            invalidate(record, "연결과 실행 설정을 다시 확인해주세요");
            record.task.guard.status = GuardStatus::Unavailable;
        }
        store.persist(None, &records)?;
        Ok(store)
    }
    pub fn preferences(&self) -> Result<Preferences, String> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM workflow_preferences_v1 WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let preferences = value
            .map(|s| serde_json::from_str::<Preferences>(&s).map_err(err))
            .unwrap_or_else(|| Ok(Preferences::default()))?;
        preferences.validate()?;
        Ok(preferences)
    }
    pub(crate) fn records(&self) -> Result<Vec<Record>, String> {
        let mut statement = self
            .db
            .prepare("SELECT value FROM workflow_tasks_v1 ORDER BY identity")
            .map_err(err)?;
        let rows = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
            .collect()
    }
    pub(crate) fn find(&self, identity: &Identity) -> Result<Option<Record>, String> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM workflow_tasks_v1 WHERE identity=?1",
                [identity.key()?],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        value
            .map(|s| serde_json::from_str(&s).map_err(err))
            .transpose()
    }
    pub(crate) fn load(&self, identity: &Identity) -> Result<Record, String> {
        self.find(identity)?
            .ok_or_else(|| "Unknown workflow chat".into())
    }
    pub(crate) fn put(&mut self, record: &Record) -> Result<(), String> {
        self.db.execute("INSERT INTO workflow_tasks_v1(identity,value) VALUES(?1,?2) ON CONFLICT(identity) DO UPDATE SET value=excluded.value", params![record.task.identity.key()?,serde_json::to_string(record).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    pub(crate) fn persist(
        &mut self,
        preferences: Option<&Preferences>,
        records: &[Record],
    ) -> Result<(), String> {
        let tx = self.db.transaction().map_err(err)?;
        if let Some(preferences) = preferences {
            tx.execute("INSERT INTO workflow_preferences_v1(singleton,value) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value", [serde_json::to_string(preferences).map_err(err)?]).map_err(err)?;
        }
        for record in records {
            tx.execute(
                "UPDATE workflow_tasks_v1 SET value=?2 WHERE identity=?1",
                params![
                    record.task.identity.key()?,
                    serde_json::to_string(record).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
}
