//! Feature list and the pet's current selection/settings.
//!
//! The list is the AutoPets catalog itself (`packages/contracts/data/
//! pet-catalog.json`), embedded read-only at build time exactly like the
//! desktop app imports it, so no second copy of the features exists.
//! The session lives in process memory only: it survives hide/show but is
//! never written to disk or to the AutoPets database.

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;

const CATALOG: &str = include_str!("../../../../packages/contracts/data/pet-catalog.json");
/// Upper bound for the page-provided session object.
const SESSION_LIMIT: usize = 16 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    id: String,
    category: String,
    name: String,
    summary: String,
    symbol: String,
    template_id: Option<String>,
    template_version: Option<u64>,
    skills: Vec<String>,
}

fn text(entry: &Value, key: &str) -> String {
    entry.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn catalog() -> Vec<Feature> {
    let Ok(Value::Array(entries)) = serde_json::from_str::<Value>(CATALOG) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter(|entry| entry.get("id").and_then(Value::as_str).is_some())
        .map(|entry| {
            let template = entry.get("template");
            Feature {
                id: text(entry, "id"),
                category: text(entry, "category"),
                name: text(entry, "name"),
                summary: text(entry, "summary"),
                symbol: text(entry, "symbol"),
                template_id: template.and_then(|t| t.get("id")).and_then(Value::as_str).map(str::to_owned),
                template_version: template.and_then(|t| t.get("version")).and_then(Value::as_u64),
                skills: template
                    .and_then(|t| t.get("skills"))
                    .and_then(Value::as_array)
                    .map(|skills| {
                        skills
                            .iter()
                            .filter_map(|s| s.get("id").and_then(Value::as_str).map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default(),
            }
        })
        .collect()
}

/// Catalog pet ids, used to accept only existing pets in recommendations.
pub fn catalog_ids() -> Vec<String> {
    catalog().into_iter().map(|f| f.id).collect()
}

#[derive(Default)]
pub struct Session(Mutex<Value>);

#[tauri::command]
pub fn pet_catalog() -> Vec<Feature> {
    catalog()
}

#[tauri::command]
pub fn pet_session_get(session: tauri::State<'_, Session>) -> Value {
    session.0.lock().map(|v| v.clone()).unwrap_or(Value::Null)
}

#[tauri::command]
pub fn pet_session_set(session: tauri::State<'_, Session>, value: Value) -> Result<(), String> {
    if value.to_string().len() > SESSION_LIMIT {
        return Err("설정 상태가 너무 큽니다.".into());
    }
    if let Ok(mut current) = session.0.lock() {
        *current = value;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn catalog_has_presentation_with_its_skill() {
        let features = super::catalog();
        assert_eq!(features.len(), 6);
        let presentation = features.iter().find(|f| f.id == "presentation").expect("presentation");
        assert_eq!(presentation.name, "발표자료 만들기");
        assert_eq!(presentation.skills, vec!["autopets-presentation".to_owned()]);
    }
}
