//! Pet decoration (#custom): coins earned by finished tasks, items bought with them, what the pet
//! wears, and which evolution stages the finished-task count has opened. All numbers come from
//! `packages/contracts/data/pet-custom.json` so they can be changed in one place.
//! Stored: coins, owned and worn items, the one-time first grant, and finished-task counts.
//! No chat text, title or path is kept.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub version: u8,
    pub coins_per_task: u64,
    pub starter_items: Vec<String>,
    pub slots: Vec<SlotConfig>,
    pub items: Vec<Item>,
    pub stages: Vec<Stage>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct SlotConfig { pub id: String }
#[derive(Clone, Debug, Deserialize)]
pub struct Item { pub id: String, pub slot: String, pub price: u64 }
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    pub no: u8,
    /// Total finished tasks that open this stage.
    #[serde(default)] pub completed: Option<u64>,
    /// Pets whose finished tasks count for a branch stage; `petCompleted: null` keeps it closed.
    #[serde(default)] pub pets: Vec<String>,
    #[serde(default)] pub pet_completed: Option<u64>,
}

pub fn config() -> Result<Config, String> {
    let config: Config = serde_json::from_str(include_str!("../../../../../packages/contracts/data/pet-custom.json")).map_err(|e| e.to_string())?;
    if config.version != 1 { return Err("Unsupported pet custom config".into()); }
    for item in &config.items {
        if !config.slots.iter().any(|slot| slot.id == item.slot) { return Err("pet-custom-unknown-slot".into()); }
    }
    Ok(config)
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub version: u8,
    pub coins: u64,
    pub owned: Vec<String>,
    /// Slot id → item id. One item per slot.
    pub worn: BTreeMap<String, String>,
    pub initial_granted: bool,
    /// Finished tasks counted since the feature started (with the first grant included).
    pub completed: u64,
    /// Finished tasks per catalog pet id; only counts.
    pub by_pet: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub coins: u64, pub owned: Vec<String>, pub worn: BTreeMap<String, String>,
    pub completed: u64, pub by_pet: BTreeMap<String, u64>,
    /// Evolution stage numbers the counts have opened.
    pub unlocked: Vec<u8>,
}

impl State {
    pub fn new(config: &Config) -> Self {
        let mut state = State { version: 1, ..Default::default() };
        for id in &config.starter_items { state.owned.push(id.clone()); }
        state
    }
    pub fn view(&self, config: &Config) -> View {
        View { coins: self.coins, owned: self.owned.clone(), worn: self.worn.clone(), completed: self.completed,
            by_pet: self.by_pet.clone(), unlocked: unlocked(config, self.completed, &self.by_pet) }
    }
    /// The one-time grant for tasks finished before the feature was turned on.
    /// Returns false when it was already given.
    pub fn grant_initial(&mut self, config: &Config, finished: &[Option<String>]) -> bool {
        if self.initial_granted { return false; }
        self.initial_granted = true;
        for pet in finished { self.record_finished(config, pet.as_deref()); }
        true
    }
    pub fn record_finished(&mut self, config: &Config, pet: Option<&str>) {
        self.completed = self.completed.saturating_add(1);
        self.coins = self.coins.saturating_add(config.coins_per_task);
        if let Some(pet) = pet.filter(|pet| !pet.is_empty() && pet.len() <= 64) {
            *self.by_pet.entry(pet.to_string()).or_default() += 1;
        }
    }
    /// Buys an item and wears it. A second identical request finds it owned and changes nothing.
    pub fn buy(&mut self, config: &Config, item_id: &str) -> Result<(), String> {
        let item = config.items.iter().find(|item| item.id == item_id).ok_or("pet-custom-unknown-item")?;
        if self.owned.iter().any(|id| id == item_id) { return Err("pet-custom-already-owned".into()); }
        if self.coins < item.price { return Err("pet-custom-not-enough-coins".into()); }
        self.coins -= item.price;
        self.owned.push(item.id.clone());
        self.worn.insert(item.slot.clone(), item.id.clone());
        Ok(())
    }
    /// Wears an owned item (replacing the one in its slot) or takes it off.
    pub fn wear(&mut self, config: &Config, item_id: &str, wear: bool) -> Result<(), String> {
        let item = config.items.iter().find(|item| item.id == item_id).ok_or("pet-custom-unknown-item")?;
        if !self.owned.iter().any(|id| id == item_id) { return Err("pet-custom-not-owned".into()); }
        if wear { self.worn.insert(item.slot.clone(), item.id.clone()); }
        else if self.worn.get(&item.slot) == Some(&item.id) { self.worn.remove(&item.slot); }
        Ok(())
    }
    /// Drops items the config no longer knows, so a changed config cannot break loading.
    pub fn normalize(&mut self, config: &Config) {
        self.owned.retain(|id| config.items.iter().any(|item| &item.id == id));
        self.owned.dedup();
        self.worn.retain(|slot, id| config.items.iter().any(|item| &item.id == id && &item.slot == slot) && self.owned.contains(id));
    }
}

pub fn unlocked(config: &Config, completed: u64, by_pet: &BTreeMap<String, u64>) -> Vec<u8> {
    config.stages.iter().filter(|stage| {
        if let Some(needed) = stage.completed { return completed >= needed; }
        match stage.pet_completed {
            Some(needed) if !stage.pets.is_empty() => stage.pets.iter().map(|pet| by_pet.get(pet).copied().unwrap_or(0)).sum::<u64>() >= needed,
            _ => false,
        }
    }).map(|stage| stage.no).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fresh() -> (Config, State) { let config = config().unwrap(); let state = State::new(&config); (config, state) }

    #[test]
    fn starts_with_the_ribbon_and_no_coins() {
        let (config, state) = fresh();
        assert_eq!(state.owned, vec!["ribbon".to_string()]);
        assert_eq!(state.coins, 0);
        assert_eq!(state.view(&config).unlocked, vec![1]);
    }
    #[test]
    fn buying_needs_enough_coins_and_happens_once() {
        let (config, mut state) = fresh();
        state.coins = 20;
        assert_eq!(state.buy(&config, "sprout").unwrap_err(), "pet-custom-not-enough-coins");
        assert_eq!(state.coins, 20);
        state.coins = 70;
        state.buy(&config, "sprout").unwrap();
        assert_eq!(state.coins, 40);
        assert_eq!(state.worn.get("head").map(String::as_str), Some("sprout"));
        // A quick second press of the same purchase must not take coins again.
        assert_eq!(state.buy(&config, "sprout").unwrap_err(), "pet-custom-already-owned");
        assert_eq!(state.coins, 40);
        assert_eq!(state.owned.iter().filter(|id| *id == "sprout").count(), 1);
        assert_eq!(state.buy(&config, "ribbon").unwrap_err(), "pet-custom-already-owned");
        assert_eq!(state.buy(&config, "nope").unwrap_err(), "pet-custom-unknown-item");
    }
    #[test]
    fn wearing_replaces_within_a_slot_and_can_be_taken_off() {
        let (config, mut state) = fresh();
        state.coins = 100;
        state.wear(&config, "ribbon", true).unwrap();
        state.buy(&config, "hat").unwrap();
        assert_eq!(state.worn.get("head").map(String::as_str), Some("hat"));
        state.wear(&config, "ribbon", true).unwrap();
        assert_eq!(state.worn.get("head").map(String::as_str), Some("ribbon"));
        state.buy(&config, "glasses").unwrap();
        assert_eq!(state.worn.len(), 2);
        // Taking off an item that is not the worn one leaves the slot alone.
        state.wear(&config, "hat", false).unwrap();
        assert_eq!(state.worn.get("head").map(String::as_str), Some("ribbon"));
        state.wear(&config, "ribbon", false).unwrap();
        assert!(state.worn.get("head").is_none());
        assert_eq!(state.wear(&config, "crown", true).unwrap_err(), "pet-custom-not-owned");
    }
    #[test]
    fn evolution_opens_at_30_and_100() {
        let (config, mut state) = fresh();
        for _ in 0..29 { state.record_finished(&config, Some("study-helper")); }
        assert_eq!(state.view(&config).unlocked, vec![1]);
        assert_eq!(state.coins, 290);
        state.record_finished(&config, None);
        assert_eq!(state.view(&config).unlocked, vec![1, 2]);
        for _ in 30..99 { state.record_finished(&config, None); }
        assert_eq!(state.completed, 99);
        assert_eq!(state.view(&config).unlocked, vec![1, 2]);
        state.record_finished(&config, None);
        assert_eq!(state.view(&config).unlocked, vec![1, 2, 3]);
        // Branch stages stay closed while their threshold is not set.
        assert_eq!(state.by_pet.get("study-helper"), Some(&29));
    }
    #[test]
    fn branch_stage_opens_when_its_threshold_is_set() {
        let (mut config, mut state) = fresh();
        config.stages.iter_mut().find(|stage| stage.no == 5).unwrap().pet_completed = Some(3);
        for _ in 0..3 { state.record_finished(&config, Some("study-helper")); }
        assert!(state.view(&config).unlocked.contains(&5));
    }
    #[test]
    fn first_grant_is_given_once() {
        let (config, mut state) = fresh();
        assert!(state.grant_initial(&config, &[Some("presentation".into()), None]));
        assert_eq!((state.coins, state.completed), (20, 2));
        assert!(!state.grant_initial(&config, &[None, None, None]));
        assert_eq!((state.coins, state.completed), (20, 2));
    }
    #[test]
    fn unknown_saved_items_are_dropped_on_load() {
        let (config, mut state) = fresh();
        state.owned.push("gone".into());
        state.worn.insert("head".into(), "gone".into());
        state.worn.insert("face".into(), "ribbon".into());
        state.normalize(&config);
        assert_eq!(state.owned, vec!["ribbon".to_string()]);
        assert!(state.worn.is_empty());
    }
}
