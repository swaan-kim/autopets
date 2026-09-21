use crate::application::assistance::*;
use crate::domain::activity::now_ms;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

impl AssistanceStore {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        let db = Connection::open(data_dir.join("autopets.sqlite3")).map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(err)?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS assistance_preferences (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assistance_tasks (identity TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assistance_pet_assignments (session_id TEXT PRIMARY KEY);").map_err(err)?;
        // Process restarts cannot establish that an old client is still attached.
        let mut this = Self { db };
        for mut record in this.records()? {
            record.receipt = None;
            if record.task.assistance.status != Status::Off {
                record.task.assistance.status = Status::Unavailable;
                record.task.assistance.reason = "연결을 다시 확인해주세요".into();
                record.task.assistance.updated_at = now_ms();
            }
            this.put(&record)?;
        }
        Ok(this)
    }

    pub fn preferences(&self) -> Result<Preferences, String> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM assistance_preferences WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        value
            .map(|s| serde_json::from_str(&s).map_err(err))
            .unwrap_or_else(|| Ok(Preferences::default()))
    }

    pub(crate) fn records(&self) -> Result<Vec<Record>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT value FROM assistance_tasks ORDER BY identity")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }

    pub(crate) fn load(&self, identity: &Identity) -> Result<Record, String> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM assistance_tasks WHERE identity=?1",
                [identity.key()?],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        serde_json::from_str(&value.ok_or("Unknown assistance chat")?).map_err(err)
    }

    pub(crate) fn put(&mut self, record: &Record) -> Result<(), String> {
        self.db.execute("INSERT INTO assistance_tasks(identity,value) VALUES(?1,?2) ON CONFLICT(identity) DO UPDATE SET value=excluded.value",params![record.task.identity.key()?,serde_json::to_string(record).map_err(err)?]).map_err(err)?;
        Ok(())
    }
}

impl AssistanceStore {
    pub(crate) fn persist_records(
        &mut self,
        preferences: Option<&Preferences>,
        records: &[Record],
    ) -> Result<(), String> {
        let tx = self.db.transaction().map_err(err)?;
        if let Some(preferences) = preferences {
            tx.execute("INSERT INTO assistance_preferences(singleton,value) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value",[serde_json::to_string(preferences).map_err(err)?]).map_err(err)?;
        }
        for record in records {
            tx.execute(
                "UPDATE assistance_tasks SET value=?2 WHERE identity=?1",
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
