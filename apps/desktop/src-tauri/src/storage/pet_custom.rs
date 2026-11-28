use crate::{application::store::Store, domain::{pet_custom::*, pet_link::RunState}};
use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};

fn err(error: impl std::fmt::Display) -> String { error.to_string() }
fn load(tx: &Transaction, config: &Config) -> Result<State, String> {
    let raw: Option<String> = tx.query_row("SELECT value FROM pet_custom_v1 WHERE singleton=1", [], |row| row.get(0)).optional().map_err(err)?;
    let mut state = match raw { Some(raw) => serde_json::from_str::<State>(&raw).map_err(|_| "invalid-saved-pet-custom")?, None => State::new(config) };
    state.normalize(config);
    Ok(state)
}
fn save(tx: &Transaction, state: &State) -> Result<(), String> {
    tx.execute("INSERT INTO pet_custom_v1(singleton,value) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value",
        params![serde_json::to_string(state).map_err(err)?]).map_err(err)?;
    Ok(())
}
/// Catalog id of the pet a link runs (e.g. "study-helper"), for per-pet counts.
pub(crate) fn link_pet_id(link: &crate::domain::pet_link::Link) -> Option<String> {
    serde_json::to_value(&link.template.id).ok()?.as_str().map(str::to_owned)
}

impl Store {
    /// Creates the table and gives the one-time grant for tasks this app already shows as finished:
    /// connected pets whose last run completed and finished AI-reported jobs.
    pub(crate) fn init_pet_custom(&mut self) -> Result<(), String> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS pet_custom_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL)").map_err(err)?;
        let finished: Vec<Option<String>> = self.pet_links.values()
            .filter(|link| link.run.as_ref().is_some_and(|run| run.state == RunState::Complete))
            .map(link_pet_id)
            .chain(self.pet_jobs.snapshot(crate::domain::activity::now_ms()).into_iter()
                .filter(|job| job.state == crate::domain::pet_job::State::Done).map(|job| job.pet_id))
            .collect();
        self.pet_custom_change(|config, state| { state.grant_initial(config, &finished); Ok(()) }).map(|_| ())
    }
    fn pet_custom_change(&mut self, change: impl FnOnce(&Config, &mut State) -> Result<(), String>) -> Result<View, String> {
        let config = config()?;
        // IMMEDIATE: a second request waits for the first to commit, so it sees the new coins.
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
        let mut state = load(&tx, &config)?;
        change(&config, &mut state)?;
        save(&tx, &state)?;
        tx.commit().map_err(err)?;
        Ok(state.view(&config))
    }
    pub fn pet_custom_view(&mut self) -> Result<View, String> { self.pet_custom_change(|_, _| Ok(())) }
    pub fn pet_custom_buy(&mut self, item_id: &str) -> Result<View, String> {
        self.pet_custom_change(|config, state| state.buy(config, item_id))
    }
    pub fn pet_custom_wear(&mut self, item_id: &str, wear: bool) -> Result<View, String> {
        self.pet_custom_change(|config, state| state.wear(config, item_id, wear))
    }
    /// One finished task: +coins and +1 to the counts. A failure here never fails the report
    /// that observed the finish; the task itself is unaffected.
    pub(crate) fn record_pet_finished(&mut self, pet: Option<String>) {
        if let Err(error) = self.pet_custom_change(|config, state| { state.record_finished(config, pet.as_deref()); Ok(()) }) {
            eprintln!("pet custom: could not record a finished task: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn purchase_and_wearing_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut store = Store::new(dir.path()).unwrap();
            assert_eq!(store.pet_custom_view().unwrap().coins, 0);
            for _ in 0..4 { store.record_pet_finished(Some("presentation".into())); }
            let view = store.pet_custom_buy("glasses").unwrap();
            assert_eq!((view.coins, view.worn.get("face").map(String::as_str)), (10, Some("glasses")));
            assert_eq!(store.pet_custom_buy("glasses").unwrap_err(), "pet-custom-already-owned");
            store.pet_custom_wear("ribbon", true).unwrap();
        }
        let mut store = Store::new(dir.path()).unwrap();
        let view = store.pet_custom_view().unwrap();
        assert_eq!(view.coins, 10);
        assert_eq!(view.completed, 4);
        assert_eq!(view.by_pet.get("presentation"), Some(&4));
        assert_eq!(view.worn.get("face").map(String::as_str), Some("glasses"));
        assert_eq!(view.worn.get("head").map(String::as_str), Some("ribbon"));
        // The first grant was already given on the first start; a restart does not give it again.
        assert_eq!(view.completed, 4);
    }

    use crate::domain::pet_link::{Profile, Receipt, Request, Target};
    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";
    const C: &str = "33333333-3333-4333-8333-333333333333";
    fn finish_one_run(store: &mut Store, dir: &std::path::Path) {
        let a = Target { source_id: "codex-windows-local".into(), thread_id: A.into(), cwd: dir.to_string_lossy().into() };
        store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
        store.pet_link_request(Request::Prepare { target: a.clone(), expected_revision: 1, request_id: C.into(), profile: Profile::Standard }).unwrap();
        store.pet_link_request(Request::Report { target: a.clone(), expected_revision: 1, request_id: C.into(), receipt: Receipt::Returned }).unwrap();
        let runtime = || Receipt::Runtime { parent_id: A.into(), child_id: B.into(), turn_id: C.into(), model: "gpt-6-sol".into(), effort: "low".into(), completed: true };
        store.pet_link_request(Request::Report { target: a.clone(), expected_revision: 1, request_id: C.into(), receipt: runtime() }).unwrap();
        // A repeated completion report for the same run is not a second finished task.
        store.pet_link_request(Request::Report { target: a, expected_revision: 1, request_id: C.into(), receipt: runtime() }).unwrap();
    }
    #[test]
    fn a_finished_pet_run_earns_coins_once() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        finish_one_run(&mut store, dir.path());
        let view = store.pet_custom_view().unwrap();
        assert_eq!((view.completed, view.coins), (1, 10));
        assert_eq!(view.by_pet.get("build-implementation"), Some(&1));
        drop(store);
        let mut store = Store::new(dir.path()).unwrap();
        assert_eq!(store.pet_custom_view().unwrap().completed, 1, "a restart does not count the finished run again");
    }
    #[test]
    fn first_start_counts_runs_already_finished_once() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut store = Store::new(dir.path()).unwrap();
            finish_one_run(&mut store, dir.path());
            // As if the run had finished before this feature existed.
            store.db.execute("DROP TABLE pet_custom_v1", []).unwrap();
        }
        let mut store = Store::new(dir.path()).unwrap();
        assert_eq!(store.pet_custom_view().unwrap().coins, 10);
        drop(store);
        let mut store = Store::new(dir.path()).unwrap();
        assert_eq!(store.pet_custom_view().unwrap().coins, 10, "the first grant is given once");
    }
}
