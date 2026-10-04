use crate::{application::store::Store, domain::{assistance::err, task_graph::*}};
use rusqlite::{params, OptionalExtension};
use std::collections::BTreeMap;

impl Store {
    pub(crate) fn init_task_graph(&self) -> Result<(), String> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS task_graph_v1(source_id TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(err)
    }
    pub fn task_graph_snapshot(&self) -> Result<Vec<Saved>, String> {
        let mut query = self.db.prepare("SELECT source_id,value FROM task_graph_v1 ORDER BY source_id").map_err(err)?;
        let rows = query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(err)?;
        rows.map(|row| {
            let (source_id, raw) = row.map_err(err)?;
            let saved: Saved = serde_json::from_str(&raw).map_err(err)?;
            if saved.report.source_id != source_id { return Err("Graph source mismatch".into()); }
            saved.report.validate(256)?;
            Ok(saved)
        }).collect()
    }
    pub fn import_task_graph(&mut self, input: Import) -> Result<Saved, String> {
        input.report.validate(32)?;
        let now = crate::domain::activity::now_ms();
        if input.report.nodes.iter().any(|node| node.observed_at > now.saturating_add(5000)) { return Err("Future graph observation".into()); }
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
        let previous: Option<String> = tx.query_row("SELECT value FROM task_graph_v1 WHERE source_id=?1", [&input.report.source_id], |row| row.get(0)).optional().map_err(err)?;
        let previous: Option<Saved> = previous.map(|raw| serde_json::from_str(&raw).map_err(err)).transpose()?;
        let source_count: u64 = tx.query_row("SELECT count(*) FROM task_graph_v1", [], |row| row.get(0)).map_err(err)?;
        if previous.is_none() && source_count >= 16 { return Err("Task graph source limit".into()); }
        if previous.as_ref().map_or(0, |saved| saved.revision) != input.expected_revision { return Err("Task graph revision is stale".into()); }
        if let Some(saved) = &previous { saved.report.validate(256)?; }
        let mut merged: BTreeMap<String, Node> = previous.map(|saved| saved.report.nodes.into_iter().map(|node| (node.id.clone(), node)).collect()).unwrap_or_default();
        for node in &input.report.nodes {
            if let Some(old) = merged.get(&node.id) {
                if node.observed_at < old.observed_at || node.metadata_updated_at < old.metadata_updated_at { return Err("Task metadata observation is stale".into()); }
            }
            merged.insert(node.id.clone(), node.clone());
        }
        let mut report = input.report;
        report.nodes = merged.into_values().collect();
        report.validate(256)?;
        let saved = Saved { revision: input.expected_revision.checked_add(1).ok_or("Graph revision limit")?, report };
        tx.execute("INSERT INTO task_graph_v1(source_id,value) VALUES(?1,?2) ON CONFLICT(source_id) DO UPDATE SET value=excluded.value",
            params![saved.report.source_id, serde_json::to_string(&saved).map_err(err)?]).map_err(err)?;
        tx.commit().map_err(err)?;
        // No session, account, plan approval, runtime capability or model setting is modified.
        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn graph_restores_two_roots_and_child_without_inventing_live_tasks() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let saved = store.import_task_graph(Import { expected_revision: 0, report: fixture() }).unwrap();
        assert_eq!(saved.report.nodes.len(), 3);
        assert!(store.snapshot().sessions.is_empty());
        assert_eq!(store.snapshot().capabilities.task_return, "manual");
        store.shutdown().unwrap(); drop(store);
        let store = Store::new(dir.path()).unwrap();
        let restored = store.task_graph_snapshot().unwrap();
        assert_eq!(serde_json::to_value(&restored[0]).unwrap(), serde_json::to_value(saved).unwrap());
        assert!(store.snapshot().sessions.is_empty());
    }
    #[test]
    fn graph_cas_cycle_stale_source_and_write_failure_preserve_saved_relations() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let original = fixture();
        store.import_task_graph(Import { expected_revision: 0, report: original.clone() }).unwrap();
        assert!(store.import_task_graph(Import { expected_revision: 0, report: original.clone() }).is_err());
        let mut cycle = original.clone(); cycle.nodes.truncate(1); cycle.nodes[0].parent_id = Some(original.nodes[2].id.clone());
        assert!(store.import_task_graph(Import { expected_revision: 1, report: cycle }).is_err());
        let mut stale = original.clone(); stale.nodes[0].observed_at = 19;
        assert!(store.import_task_graph(Import { expected_revision: 1, report: stale }).is_err());
        let mut wrong = original.clone(); wrong.nodes[2].creation_surface = Surface::WorkLocal;
        assert!(store.import_task_graph(Import { expected_revision: 1, report: wrong }).is_err());
        let mut other = original.clone(); other.source_id = "other-source".into(); other.nodes[0].label = "Other source".into();
        store.import_task_graph(Import { expected_revision: 0, report: other }).unwrap();
        store.db.execute_batch("CREATE TRIGGER graph_failure BEFORE INSERT ON task_graph_v1 BEGIN SELECT RAISE(ABORT, 'test'); END;").unwrap();
        assert!(store.import_task_graph(Import { expected_revision: 1, report: original.clone() }).is_err());
        let saved = store.task_graph_snapshot().unwrap();
        assert_eq!(saved.len(), 2); assert_eq!(saved[0].revision, 1);
        assert_eq!(serde_json::to_value(&saved[0].report).unwrap(), serde_json::to_value(original).unwrap());
    }
    #[test]
    fn metadata_status_updates_do_not_complete_observed_sessions_or_enable_help() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let mut report = fixture(); report.nodes[0].runtime_status = RuntimeStatus::Active;
        store.import_task_graph(Import { expected_revision: 0, report: report.clone() }).unwrap();
        report.nodes[0].runtime_status = RuntimeStatus::Idle; report.nodes[0].observed_at += 1;
        store.import_task_graph(Import { expected_revision: 1, report }).unwrap();
        assert_eq!(store.task_graph_snapshot().unwrap()[0].report.nodes[0].runtime_status, RuntimeStatus::Idle);
        assert!(store.snapshot().sessions.is_empty());
        assert!(!store.workflow.preferences().unwrap().enabled);
    }
}
