use crate::{application::store::Store, domain::{activity::now_ms, pet_link::*}};
use rusqlite::params;
use std::collections::HashMap;
#[cfg(test)]
#[path = "../application/tests/pet_links.rs"]
mod tests;
#[cfg(test)]
#[path = "../application/tests/pet_links_ui.rs"]
mod ui_tests;

impl Store {
    pub(crate) fn init_pet_links(&mut self) -> Result<(), String> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS explicit_pet_links_v1 (identity TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS explicit_pet_requests_v1 (request_id TEXT PRIMARY KEY, identity TEXT NOT NULL)").map_err(super::sqlite::db_err)?;
        let rows: Vec<String> = self.db.prepare("SELECT value FROM explicit_pet_links_v1").map_err(super::sqlite::db_err)?
            .query_map([], |r| r.get(0)).map_err(super::sqlite::db_err)?.collect::<Result<_,_>>().map_err(super::sqlite::db_err)?;
        self.pet_links = HashMap::new();
        for row in rows {
            let mut link: Link = serde_json::from_str(&row).map_err(|_| "invalid-saved-pet-link")?;
            link.target.validate()?; link.template.validate()?;
            if link.version != 1 || link.slot > 2 || self.pet_links.values().any(|l| l.slot == link.slot) { return Err("invalid-saved-pet-link".into()); }
            link.connected = false;
            if let Some(run) = &mut link.run {
                if let Some(template) = &run.template { template.validate()?; }
                if matches!(run.state, RunState::Requested | RunState::Working)
                    || (matches!(run.state, RunState::Complete | RunState::Waiting) && !run.completion_confirmed()) {
                    run.state = RunState::Unknown;
                }
            }
            self.pet_links.insert(link.target.key(), link);
        }
        Ok(())
    }
    fn save_link(&mut self, link: Link) -> Result<Link, String> {
        self.db.execute("INSERT INTO explicit_pet_links_v1(identity,value) VALUES(?1,?2) ON CONFLICT(identity) DO UPDATE SET value=excluded.value",
            params![link.target.key(), serde_json::to_string(&link).map_err(|e| e.to_string())?]).map_err(super::sqlite::db_err)?;
        self.pet_links.insert(link.target.key(), link.clone());
        Ok(link)
    }
    pub fn disconnect_pet_slot(&mut self, slot: usize) -> Result<bool, String> {
        let key = self.pet_links.iter().find(|(_,l)| l.slot == slot).map(|(k,_)| k.clone());
        if let Some(key) = key {
            self.db.execute("DELETE FROM explicit_pet_links_v1 WHERE identity=?1", [&key]).map_err(super::sqlite::db_err)?;
            self.pet_links.remove(&key); return Ok(true);
        }
        Ok(false)
    }
    pub(crate) fn disconnect_explicit_pets(&mut self) -> Result<(), String> {
        let links:Vec<_>=self.pet_links.values().cloned().collect();
        for mut link in links {
            link.connected=false; link.revision+=1;
            if let Some(run)=&mut link.run { if run.unresolved() { run.state=RunState::Unknown; } }
            self.save_link(link)?;
        }
        Ok(())
    }
    pub fn pet_link_request(&mut self, request: Request) -> Result<Option<Link>, String> {
        let target = match &request { Request::Read{target} | Request::Connect{target} | Request::Settings{target,..} | Request::ApplyPet{target,..} | Request::Enable{target,..} | Request::Disconnect{target,..} | Request::CloseTracking{target,..} | Request::Prepare{target,..} | Request::Report{target,..} => target };
        target.validate()?;
        let previous = self.pet_links.get(&target.key()).cloned();
        if previous.as_ref().is_some_and(|l| !l.target.matches(target)) { return Err("pet-target-mismatch".into()); }
        if let Request::Read{..} = request { return Ok(previous); }
        if let Request::Connect{target} = request {
            let mut link = if let Some(link) = previous { link } else {
                let slot = (0..3).find(|i| self.slots[*i].is_none() && !self.pet_links.values().any(|l| l.slot == *i)).ok_or("slots-full")?;
                Link { version:1, target, slot, revision:1, enabled:true, connected:false, profile:Profile::Light,
                    template:crate::domain::roles::templates()?.into_iter().find(|t| t.id == crate::domain::roles::RoleId::BuildImplementation).ok_or("missing-build-pet")?, run:None, saved_pet:None }
            };
            link.connected = true;
            return self.save_link(link).map(Some);
        }
        let mut link = previous.ok_or("pet-not-connected")?;
        let expected = match &request { Request::Settings{expected_revision,..} | Request::ApplyPet{expected_revision,..} | Request::Enable{expected_revision,..} | Request::Disconnect{expected_revision,..} | Request::CloseTracking{expected_revision,..} | Request::Prepare{expected_revision,..} | Request::Report{expected_revision,..} => *expected_revision, _=>unreachable!() };
        if link.revision != expected { return Err("pet-revision-changed".into()); }
        match request {
            Request::Settings{profile,..} => {
                if link.run.as_ref().is_some_and(Run::unresolved) { return Err("pet-run-active-or-unresolved".into()); }
                link.profile=profile; link.revision+=1; link.run=None;
            },
            Request::ApplyPet{pet_id,pet_revision,..} => {
                if !link.connected { return Err("pet-disconnected".into()); }
                if link.run.as_ref().is_some_and(Run::unresolved) { return Err("pet-run-active-or-unresolved".into()); }
                let pet=self.saved_pet(&pet_id)?.ok_or("saved-pet-not-found")?;
                if pet.revision!=pet_revision { return Err("saved-pet-revision-changed".into()); }
                let profile=Profile::for_template(&pet.template)?;
                let reference=SavedPetReference{id:pet_id,revision:pet_revision};
                // Retrying an already-applied selection must not reset a user's profile or plan.
                if link.saved_pet.as_ref()==Some(&reference) && link.template==pet.template { return Ok(Some(link)); }
                link.template=pet.template;
                link.saved_pet=Some(reference);
                link.profile=profile;
                link.revision=link.revision.checked_add(1).ok_or("pet-revision-limit")?;
                // A previous plan belongs to the old settings, never the new pet revision.
                link.run=None;
            },
            // Assistance controls future dispatch, not observation of an existing child.
            Request::Enable{enabled,..} => { if link.enabled != enabled { link.enabled=enabled; link.revision+=1; } },
            Request::Disconnect{..} => { self.disconnect_pet_slot(link.slot)?; return Ok(None); },
            Request::CloseTracking{request_id,..} => {
                let run=link.run.as_mut().ok_or("pet-run-not-found")?;
                if run.id!=request_id { return Err("pet-run-mismatch".into()); }
                if !run.unresolved() { return Err("pet-run-not-unresolved".into()); }
                // This does not cancel the native child or delete its request tombstone.
                run.tracking_closed=true;
                run.state=RunState::Unknown;
                link.revision+=1;
            },
            Request::Prepare{request_id,profile,..} => {
                if !link.connected || !link.enabled { return Err("pet-disabled-or-disconnected".into()); }
                if uuid::Uuid::parse_str(&request_id).is_err() { return Err("invalid-pet-request".into()); }
                if let Some(run)=&link.run {
                    if run.id==request_id { if run.profile!=profile { return Err("request-content-changed".into()); } return Ok(Some(link)); }
                    if run.unresolved() { return Err("previous-pet-run-unresolved".into()); }
                }
                let (model,effort)=profile.settings();
                self.db.execute("INSERT INTO explicit_pet_requests_v1(request_id,identity) VALUES(?1,?2)", params![request_id,link.target.key()]).map_err(|_| "pet-request-already-used")?;
                link.run=Some(Run{id:request_id,settings_revision:link.revision,profile:profile.clone(),model:model.into(),effort:effort.into(),state:RunState::Requested,child_id:None,turn_id:None,observed_model:None,observed_effort:None,evidence:None,started_at:now_ms(),agent_path:None,tracking_closed:false,result_returned:false,runtime_completed:false,template:Some(link.template.clone()),saved_pet:link.saved_pet.clone(),skill_evidence:vec![],figma_used:false});
            },
            Request::Report{request_id,receipt,..} => {
                if !link.connected { return Err("pet-disconnected".into()); }
                let run=link.run.as_mut().ok_or("pet-run-not-found")?;
                if run.id!=request_id { return Err("pet-run-mismatch".into()); }
                if run.tracking_closed { return Err("pet-run-closed".into()); }
                match receipt {
                    Receipt::Spawned{agent_path} => {
                        if !agent_path.starts_with("/root/") || agent_path.len()>512 || agent_path.split('/').skip(2).any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b==b'_')) {
                            return Err("invalid-child-path".into());
                        }
                        // A returned path is only a selector; it is not execution evidence.
                        if run.agent_path.as_ref().is_some_and(|old| old!=&agent_path) { return Err("pet-child-mismatch".into()); }
                        run.agent_path=Some(agent_path);
                    },
                    Receipt::Returned => { run.result_returned=true; run.reconcile_evidence(); },
                    Receipt::Failed => { if !matches!(run.state,RunState::Complete|RunState::Waiting) { run.state=RunState::Failed; } },
                    Receipt::Runtime{parent_id,child_id,turn_id,model,effort,completed} => {
                        if parent_id!=link.target.thread_id || child_id==parent_id || uuid::Uuid::parse_str(&child_id).is_err() || uuid::Uuid::parse_str(&turn_id).is_err()
                            || run.child_id.as_ref().is_some_and(|old| old!=&child_id) || run.turn_id.as_ref().is_some_and(|old| old!=&turn_id) { return Err("pet-child-mismatch".into()); }
                        if matches!(run.state,RunState::Failed) { return Err("pet-run-closed".into()); }
                        if model.len()>128 || effort.len()>16 { return Err("invalid-runtime-settings".into()); }
                        run.child_id=Some(child_id); run.turn_id=Some(turn_id); run.observed_model=Some(model.clone()); run.observed_effort=Some(effort.clone());
                        // Authenticated connector report, not server attestation or a global capability upgrade.
                        run.evidence=Some("connector-runtime-audit".into());
                        if run.model!=model || run.effort!=effort { run.state=RunState::Failed; }
                        else {
                            // Runtime completion is not proof that the parent received the result.
                            // Both receipts are monotonic so delayed/duplicate reports cannot regress them.
                            run.runtime_completed |= completed;
                            run.reconcile_evidence();
                        }
                    },
                    Receipt::Resources{child_id,turn_id,skills,figma_used} => {
                        if run.child_id.as_ref()!=Some(&child_id) || run.turn_id.as_ref()!=Some(&turn_id) {
                            return Err("pet-resource-target-mismatch".into());
                        }
                        if run.state==RunState::Failed { return Err("pet-run-closed".into()); }
                        let template=run.template.as_ref().ok_or("pet-resource-snapshot-missing")?;
                        let mut allowed=template.skills.clone();
                        if template.features.figma_design {
                            allowed.push(crate::domain::roles::Skill{id:"autopets-figma-design".into(),version:"1.0.0".into()});
                        }
                        if skills.len()>allowed.len() || skills.iter().any(|skill| !allowed.contains(skill))
                            || (figma_used && !template.features.figma_design) { return Err("invalid-pet-resource-evidence".into()); }
                        // This records the connector's paired successful calls only. It is not
                        // an availability declaration, quality score, or host capability grant.
                        for skill in skills { if !run.skill_evidence.contains(&skill) { run.skill_evidence.push(skill); } }
                        run.figma_used |= figma_used;
                    }
                }
            },
            _=>unreachable!(),
        }
        self.save_link(link).map(Some)
    }
}
