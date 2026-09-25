use crate::domain::assistance::{bounded, err, Identity};
use crate::domain::workflow::Model;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoleId { ResearchDocument, BuildImplementation }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Prop { None, Notebook }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Background { None, Meadow }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Skill { pub id: String, pub version: String }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Template {
    pub id: RoleId, pub version: u8, pub name: String, pub instruction: String,
    pub plan_first: bool, pub planning: Option<Model>, pub execution: Option<Model>,
    pub skills: Vec<Skill>, pub prop: Prop, pub background: Background,
}
impl Template {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 { return Err("Unsupported pet template version".into()); }
        bounded(&self.name, 120, false)?;
        bounded(&self.instruction, 1536, false)?;
        if self.name.chars().any(char::is_control) { return Err("Invalid pet name".into()); }
        for model in [&self.planning, &self.execution].into_iter().flatten() { model.validate()?; }
        // Bundled role skills are pinned. A template never installs arbitrary code.
        let expected = match self.id {
            RoleId::ResearchDocument => "autopets-research-document",
            RoleId::BuildImplementation => "autopets-build-implementation",
        };
        if self.skills != vec![Skill { id: expected.into(), version: "1.0.0".into() }] {
            return Err("Unknown role skill or version".into());
        }
        Ok(())
    }
}
pub fn templates() -> Result<Vec<Template>, String> {
    let templates: Vec<Template> = serde_json::from_str(include_str!("../../../../../packages/contracts/data/roles.json")).map_err(err)?;
    for template in &templates { template.validate()?; }
    Ok(templates)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedPet { pub id: String, pub revision: u64, pub template: Template, pub updated_at: u64 }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub identity: Identity, pub revision: u64, pub enabled: bool,
    pub pet_id: String, pub pet_revision: u64, pub template: Template, pub updated_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot { pub templates: Vec<Template>, pub pets: Vec<SavedPet>, pub bindings: Vec<Binding> }
