//! Metadata relationships never enable control or assert a running Desktop turn.
use crate::domain::assistance::{bounded, err};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Surface { CodexLocal, WorkLocal, Unknown }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeStatus { NotLoaded, Idle, Active, Error, Unknown }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: String, pub label: String, pub cwd: String,
    pub project_id: Option<String>, pub parent_id: Option<String>, pub forked_from_id: Option<String>,
    pub creation_surface: Surface, pub runtime_status: RuntimeStatus,
    pub configured_model: Option<String>, pub configured_reasoning: Option<String>,
    pub metadata_updated_at: u64, pub observed_at: u64,
}

fn uuid(value: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| "Invalid graph task ID")?;
    if parsed.is_nil() || parsed.to_string() != value { return Err("Invalid graph task ID".into()); }
    Ok(())
}

impl Node {
    pub fn validate(&self) -> Result<(), String> {
        uuid(&self.id)?; bounded(&self.label, 256, false)?; bounded(&self.cwd, 4096, false)?;
        let path = self.cwd.as_bytes();
        if path.len() < 3 || !path[0].is_ascii_alphabetic() || path[1] != b':' || !matches!(path[2], b'/' | b'\\')
            || self.cwd.chars().any(char::is_control) { return Err("Graph requires a local Windows path".into()); }
        for id in [&self.parent_id, &self.forked_from_id].into_iter().flatten() {
            uuid(id)?; if id == &self.id { return Err("A task cannot be its own parent or fork source".into()); }
        }
        if let Some(project) = &self.project_id { bounded(project, 256, false)?; }
        if let Some(model) = &self.configured_model { bounded(model, 128, false)?; }
        if let Some(reasoning) = &self.configured_reasoning {
            if !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].contains(&reasoning.as_str()) {
                return Err("Invalid configured reasoning".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub version: u8, pub source_id: String, pub source: String, pub runtime: String, pub nodes: Vec<Node>,
}
impl Report {
    pub fn validate(&self, max_nodes: usize) -> Result<(), String> {
        if self.version != 1 || self.source != "app-server-metadata" || self.nodes.is_empty() || self.nodes.len() > max_nodes {
            return Err("Invalid task graph report".into());
        }
        bounded(&self.source_id, 256, false)?; bounded(&self.runtime, 256, false)?;
        if serde_json::to_vec(self).map_err(err)?.len() > 192 * 1024 { return Err("Task graph report exceeds limit".into()); }
        let mut by_id = BTreeMap::new();
        for node in &self.nodes {
            node.validate()?;
            if by_id.insert(node.id.clone(), node).is_some() { return Err("Duplicate graph task".into()); }
        }
        for node in &self.nodes {
            let mut seen = BTreeSet::new();
            let mut current = Some(node);
            while let Some(item) = current {
                if !seen.insert(&item.id) { return Err("Cyclic task ancestry".into()); }
                current = item.parent_id.as_ref().and_then(|id| by_id.get(id).copied());
                if let Some(parent) = current {
                    if item.creation_surface != Surface::Unknown && parent.creation_surface != Surface::Unknown
                        && item.creation_surface != parent.creation_surface { return Err("Conflicting parent source".into()); }
                }
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Import { pub expected_revision: u64, pub report: Report }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Saved { pub revision: u64, pub report: Report }

#[cfg(test)]
pub(crate) fn fixture() -> Report {
    let make = |id: &str, parent: Option<&str>| Node { id: id.into(), label: "합성 계층 시험".into(), cwd: "C:/한글 시험".into(),
        project_id: Some("fixture-project".into()), parent_id: parent.map(str::to_owned), forked_from_id: None,
        creation_surface: Surface::CodexLocal, runtime_status: RuntimeStatus::NotLoaded, configured_model: None,
        configured_reasoning: None, metadata_updated_at: 10, observed_at: 20 };
    let a = "11111111-2222-4333-8444-555555555555";
    Report { version: 1, source_id: "fixture-runtime".into(), source: "app-server-metadata".into(), runtime: "fixture".into(), nodes: vec![
        make(a, None), make("22222222-2222-4333-8444-555555555555", None), make("33333333-2222-4333-8444-555555555555", Some(a))] }
}
