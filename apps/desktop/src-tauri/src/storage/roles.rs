//! Reusable preferences only. Neither source chat content nor approvals enter a template.
use crate::application::store::Store;
use crate::domain::{activity::now_ms, assistance::{err, Identity}, roles::*};
use rusqlite::{params, OptionalExtension};

impl Store {
    pub(crate) fn init_roles(&self) -> Result<(), String> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS pet_templates_v1 (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pet_roles_v1 (identity TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(err)
    }
    pub fn roles_snapshot(&self) -> Result<Snapshot, String> {
        let mut pets = self.db.prepare("SELECT value FROM pet_templates_v1 ORDER BY id").map_err(err)?;
        let pets = pets.query_map([], |r| r.get::<_, String>(0)).map_err(err)?
            .map(|r| serde_json::from_str::<SavedPet>(&r.map_err(err)?).map_err(err)).collect::<Result<Vec<_>,_>>()?;
        for pet in &pets { pet.template.validate()?; }
        let mut bindings = self.db.prepare("SELECT value FROM pet_roles_v1 ORDER BY identity").map_err(err)?;
        let bindings = bindings.query_map([], |r| r.get::<_, String>(0)).map_err(err)?
            .map(|r| serde_json::from_str::<Binding>(&r.map_err(err)?).map_err(err)).collect::<Result<Vec<_>,_>>()?;
        for binding in &bindings { binding.template.validate()?; binding.identity.key()?; }
        Ok(Snapshot { templates: templates()?, pets, bindings })
    }
    pub fn saved_pet(&self, id: &str) -> Result<Option<SavedPet>, String> {
        let raw: Option<String> = self.db.query_row("SELECT value FROM pet_templates_v1 WHERE id=?1", [id], |r| r.get(0)).optional().map_err(err)?;
        let pet: Option<SavedPet> = raw.map(|raw| serde_json::from_str(&raw).map_err(err)).transpose()?;
        if let Some(pet) = &pet {
            if pet.id != id { return Err("Saved pet identity mismatch".into()); }
            pet.template.validate()?;
        }
        Ok(pet)
    }
    pub fn save_pet(&mut self, id: Option<String>, expected_revision: u64, template: Template) -> Result<SavedPet, String> {
        template.validate()?;
        let pet_id = id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
        let raw: Option<String> = tx.query_row("SELECT value FROM pet_templates_v1 WHERE id=?1", [&pet_id], |r| r.get(0)).optional().map_err(err)?;
        let previous: Option<SavedPet> = raw.map(|raw| serde_json::from_str(&raw).map_err(err)).transpose()?;
        if previous.as_ref().map_or(0, |pet| pet.revision) != expected_revision || id.is_some() != previous.is_some() {
            return Err("Saved pet revision is stale".into());
        }
        let count: u64 = tx.query_row("SELECT count(*) FROM pet_templates_v1", [], |r| r.get(0)).map_err(err)?;
        if previous.is_none() && count >= 100 { return Err("최대 100개의 펫을 저장할 수 있어요.".into()); }
        let pet = SavedPet { id: pet_id, revision: expected_revision.checked_add(1).ok_or("Pet revision limit")?, template, updated_at: now_ms() };
        tx.execute("INSERT INTO pet_templates_v1(id,value) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET value=excluded.value", params![pet.id, serde_json::to_string(&pet).map_err(err)?]).map_err(err)?;
        tx.commit().map_err(err)?;
        // Existing assignments keep their immutable chosen revision until explicitly reapplied.
        Ok(pet)
    }
    pub fn role_binding(&self, identity: &Identity) -> Result<Option<Binding>, String> {
        let raw: Option<String> = self.db.query_row("SELECT value FROM pet_roles_v1 WHERE identity=?1", [identity.key()?], |r| r.get(0)).optional().map_err(err)?;
        let binding: Option<Binding> = raw.map(|raw| serde_json::from_str(&raw).map_err(err)).transpose()?;
        if let Some(binding) = &binding {
            if &binding.identity != identity { return Err("Pet role identity mismatch".into()); }
            binding.template.validate()?;
        }
        Ok(binding)
    }
    pub fn apply_pet(&mut self, identity: Identity, pet_id: String, pet_revision: u64, expected_revision: u64, expected_settings_revision: u64, enabled: bool) -> Result<Binding, String> {
        self.db.execute_batch("BEGIN IMMEDIATE").map_err(err)?;
        let result = self.apply_pet_inner(identity, pet_id, pet_revision, expected_revision, expected_settings_revision, enabled)
            .and_then(|binding| { self.db.execute_batch("COMMIT").map_err(err)?; Ok(binding) });
        if result.is_err() { let _ = self.db.execute_batch("ROLLBACK"); }
        result
    }
    fn apply_pet_inner(&mut self, identity: Identity, pet_id: String, pet_revision: u64, expected_revision: u64, expected_settings_revision: u64, enabled: bool) -> Result<Binding, String> {
        let key = identity.key()?;
        let pet = self.saved_pet(&pet_id)?.ok_or("Unknown saved pet")?;
        if pet.revision != pet_revision { return Err("Saved pet changed; read it again".into()); }
        let previous = self.role_binding(&identity)?;
        if previous.as_ref().map_or(0, |binding| binding.revision) != expected_revision { return Err("Pet role revision is stale".into()); }
        let mut workflow = self.workflow.load(&identity)?; // Exact account/source/chat; never invent a chat.
        if workflow.task.settings_revision != expected_settings_revision { return Err("Workflow settings revision is stale".into()); }
        if self.sessions.get(&identity.chat_id).is_some_and(|session| !session.turn_finished && session.active_turn.is_some()) {
            return Err("응답이 끝난 뒤 역할을 바꿔주세요.".into());
        }
        let binding = Binding { identity: identity.clone(), revision: expected_revision.checked_add(1).ok_or("Role revision limit")?, enabled, pet_id,
            pet_revision, template: pet.template, updated_at: now_ms() };
        // Updating a role is a settings revision. Preserve the target's context, never copy the source's.
        if enabled {
            workflow.task.plan_first = binding.template.plan_first;
            if let Some(model) = &binding.template.planning { workflow.task.planning = model.clone(); }
            if let Some(model) = &binding.template.execution { workflow.task.execution = model.clone(); }
        }
        workflow.task.settings_revision = workflow.task.settings_revision.checked_add(1).ok_or("Workflow revision limit")?;
        workflow.task.approval = None;
        workflow.task.updated_at = now_ms();
        workflow.task.phase = crate::domain::workflow::Phase::Unknown;
        crate::domain::workflow::invalidate(&mut workflow, "역할 선호를 저장했어요. 실제 전달과 설정 적용은 아직 확인되지 않았어요.");
        let mut assistance = match self.assistance.load(&identity) {
            Ok(record) => Some(record),
            Err(error) if error == "Unknown assistance chat" => None,
            Err(error) => return Err(error),
        };
        if let Some(record) = &mut assistance {
            record.task.settings_revision = record.task.settings_revision.checked_add(1).ok_or("Assistance revision limit")?;
            record.receipt = None;
            record.task.assistance.applied_model = None;
            record.task.assistance.status = crate::domain::assistance::Status::Unavailable;
            record.task.assistance.reason = "역할 지침 전달 미확인".into();
        }
        // One DB transaction covers assignment, desired workflow values and receipt invalidation.
        self.db.execute("INSERT INTO pet_roles_v1(identity,value) VALUES(?1,?2) ON CONFLICT(identity) DO UPDATE SET value=excluded.value", params![key, serde_json::to_string(&binding).map_err(err)?]).map_err(err)?;
        self.db.execute("UPDATE workflow_tasks_v1 SET value=?2 WHERE identity=?1", params![key, serde_json::to_string(&workflow).map_err(err)?]).map_err(err)?;
        if let Some(record) = assistance { self.db.execute("UPDATE assistance_tasks SET value=?2 WHERE identity=?1", params![key, serde_json::to_string(&record).map_err(err)?]).map_err(err)?; }
        Ok(binding)
    }
}

#[cfg(test)]
#[path = "../application/tests/roles.rs"]
mod tests;
