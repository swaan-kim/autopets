use crate::domain::activity::now_ms;
pub(crate) use crate::domain::assistance::*;
use rusqlite::Connection;

pub struct AssistanceStore {
    pub(crate) db: Connection,
}
impl AssistanceStore {
    pub(crate) fn ensure(&mut self, identity: &Identity) -> Result<Record, String> {
        identity.key()?;
        match self.load(identity) {
            Ok(record) => Ok(record),
            Err(e) if e == "Unknown assistance chat" => {
                let enabled = self.preferences()?.enabled;
                let now = now_ms();
                let record = Record {
                    task: Task {
                        identity: identity.clone(),
                        enabled: true,
                        context: Context::default(),
                        previous_context: None,
                        change_summary: String::new(),
                        work_style_override: None,
                        settings_revision: 0,
                        revision: 0,
                        updated_at: now,
                        assistance: AssistanceState {
                            status: if enabled {
                                Status::Pending
                            } else {
                                Status::Off
                            },
                            requested_model: None,
                            applied_model: None,
                            reason: if enabled {
                                "전달 대기"
                            } else {
                                "자동 도움이 꺼져 있어요"
                            }
                            .into(),
                            injection_bytes: 0,
                            context_partial: false,
                            included_context_keys: vec![],
                            updated_at: now,
                        },
                        recipe_id: None,
                        quality: Quality::default(),
                    },
                    receipt: None,
                };
                self.put(&record)?;
                Ok(record)
            }
            Err(e) => Err(e),
        }
    }

    pub fn overview(&self) -> Result<Overview, String> {
        Ok(Overview {
            preferences: self.preferences()?,
            tasks: self.records()?.into_iter().map(|r| r.task).collect(),
            capabilities: capabilities(),
        })
    }

    pub fn has_enabled_preparation(&self, identity: &Identity) -> Result<bool, String> {
        let record = self.load(identity)?;
        Ok(self.preferences()?.enabled
            && record.task.enabled
            && matches!(
                record.task.assistance.status,
                Status::Prepared | Status::Sent
            ))
    }

    pub fn save_preferences(
        &mut self,
        mut preferences: Preferences,
    ) -> Result<Preferences, String> {
        let old = self.preferences()?;
        if preferences.revision != old.revision {
            return Err("Preferences revision is stale".into());
        }
        list(&preferences.allowed_models, 32, 128)?;
        if let Some(model) = &preferences.fixed_model {
            bounded(model, 128, false)?;
        }
        if preferences.routing_mode == RoutingMode::Fixed && preferences.fixed_model.is_none() {
            return Err("A fixed model is required".into());
        }
        if preferences == old {
            return Ok(old);
        }
        preferences.revision = old.revision + 1;
        let mut records = self.records()?;
        for record in &mut records {
            reset_pending(record, preferences.enabled);
        }
        self.persist_records(Some(&preferences), &records)?;
        Ok(preferences)
    }

    pub fn set_enabled(&mut self, identity: Identity, enabled: bool) -> Result<Task, String> {
        let mut record = self.load(&identity)?;
        if record.task.enabled != enabled {
            record.task.enabled = enabled;
            reset_pending(&mut record, self.preferences()?.enabled);
            self.put(&record)?;
        }
        Ok(record.task)
    }

    pub fn set_work_style(
        &mut self,
        identity: Identity,
        work_style: Option<WorkStyle>,
        expected_revision: u64,
    ) -> Result<Task, String> {
        let mut record = self.load(&identity)?;
        if record.task.settings_revision != expected_revision {
            return Err("Task settings revision is stale".into());
        }
        if record.task.work_style_override != work_style {
            record.task.work_style_override = work_style;
            record.task.settings_revision += 1;
            record.task.updated_at = now_ms();
            reset_pending(&mut record, self.preferences()?.enabled);
            self.put(&record)?;
        }
        Ok(record.task)
    }

    pub fn save_context(
        &mut self,
        identity: Identity,
        context: Context,
        expected_revision: u64,
    ) -> Result<Task, String> {
        context.validate()?;
        let mut record = self.load(&identity)?;
        check_revision(&record, expected_revision)?;
        if record.task.context != context {
            replace_context(&mut record, context);
            reset_pending(&mut record, self.preferences()?.enabled);
            self.put(&record)?;
        }
        Ok(record.task)
    }

    pub fn undo_context(
        &mut self,
        identity: Identity,
        expected_revision: u64,
    ) -> Result<Task, String> {
        let mut record = self.load(&identity)?;
        check_revision(&record, expected_revision)?;
        let previous = record
            .task
            .previous_context
            .take()
            .ok_or("No previous context to restore")?;
        record.task.context = previous;
        record.task.revision += 1;
        record.task.updated_at = now_ms();
        record.task.change_summary = "이전 기록으로 되돌렸어요".into();
        record.task.quality = Quality::default();
        reset_pending(&mut record, self.preferences()?.enabled);
        self.put(&record)?;
        Ok(record.task)
    }

    pub fn delete_context(&mut self, identity: Identity) -> Result<Task, String> {
        let mut record = self.load(&identity)?;
        erase_context(&mut record, self.preferences()?.enabled);
        self.put(&record)?;
        Ok(record.task)
    }

    pub fn delete_all_contexts(&mut self) -> Result<(), String> {
        let enabled = self.preferences()?.enabled;
        let mut records = self.records()?;
        for record in &mut records {
            erase_context(record, enabled);
        }
        self.persist_records(None, &records)
    }

    pub fn dispatch(&mut self, request: Request) -> Result<serde_json::Value, String> {
        let preferences = self.preferences()?;
        let (identity, _) = request.identity_binding();
        identity.key()?;
        if let Request::Read { identity, .. } = &request {
            let record = self.ensure(identity)?;
            return Ok(
                serde_json::json!({"preferences":preferences,"task":record.task,"capabilities":capabilities()}),
            );
        }
        let mut record = self.load(identity)?;
        if !preferences.enabled || !record.task.enabled {
            return Err("Automatic assistance is disabled".into());
        }
        match request {
            Request::Prepare {
                binding,
                expected_revision,
                preferences_revision,
                settings_revision,
                recipe_id,
                requested_model,
                reason,
                injection_bytes,
                guidance_hash,
                context_partial,
                included_context_keys,
                ..
            } => {
                check_revision(&record, expected_revision)?;
                if preferences_revision != preferences.revision {
                    return Err("Preferences revision is stale".into());
                }
                if settings_revision != record.task.settings_revision {
                    return Err("Task settings revision is stale".into());
                }
                if included_context_keys.len() > 5
                    || included_context_keys.iter().enumerate().any(|(i, key)| {
                        ![
                            "goal",
                            "outputFormat",
                            "constraints",
                            "decisions",
                            "remaining",
                        ]
                        .contains(&key.as_str())
                            || included_context_keys[..i].contains(key)
                    })
                {
                    return Err("Invalid included context keys".into());
                }
                if !["simple", "research", "document", "planning", "general"]
                    .contains(&recipe_id.as_str())
                {
                    return Err("Unknown task recipe".into());
                }
                bounded(&reason, 512, false)?;
                if injection_bytes == 0
                    || injection_bytes > 3072
                    || guidance_hash.len() != 64
                    || !guidance_hash.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("Invalid bounded guidance metadata".into());
                }
                if let Some(model) = &requested_model {
                    bounded(model, 128, false)?;
                }
                if record.receipt.as_ref().is_some_and(|r| {
                    r.hash == guidance_hash
                        && r.preferences_revision == preferences.revision
                        && r.context_revision == record.task.revision
                        && (r.delivered || r.binding == binding)
                }) {
                    return Ok(
                        serde_json::json!({"ok":true,"duplicate":true,"nonce":null,"preferencesRevision":preferences.revision,"settingsRevision":record.task.settings_revision,"contextRevision":record.task.revision,"task":record.task}),
                    );
                }
                let nonce = uuid::Uuid::new_v4().to_string();
                record.receipt = Some(Receipt {
                    nonce: nonce.clone(),
                    binding,
                    preferences_revision: preferences.revision,
                    context_revision: record.task.revision,
                    hash: guidance_hash,
                    delivered: false,
                    context_written: false,
                    quality_written: false,
                });
                record.task.assistance = AssistanceState {
                    status: Status::Prepared,
                    requested_model,
                    applied_model: None,
                    reason,
                    injection_bytes,
                    context_partial,
                    included_context_keys,
                    updated_at: now_ms(),
                };
                record.task.recipe_id = Some(recipe_id);
                record.task.quality = Quality::default();
                self.put(&record)?;
                return Ok(
                    serde_json::json!({"ok":true,"duplicate":false,"nonce":nonce,"preferencesRevision":preferences.revision,"settingsRevision":record.task.settings_revision,"contextRevision":record.task.revision,"task":record.task}),
                );
            }
            Request::Delivered {
                binding,
                nonce,
                evidence,
                ..
            } => {
                let receipt = receipt(&mut record, &nonce, &binding, preferences.revision)?;
                if evidence != "sent" || receipt.delivered {
                    return Err("Invalid or replayed delivery evidence".into());
                }
                receipt.delivered = true;
                record.task.assistance.status = Status::Sent;
                record.task.assistance.updated_at = now_ms();
            }
            Request::Context {
                binding,
                nonce,
                expected_revision,
                context,
                ..
            } => {
                context.validate()?;
                check_revision(&record, expected_revision)?;
                let receipt = receipt(&mut record, &nonce, &binding, preferences.revision)?;
                if !receipt.delivered || receipt.context_written {
                    return Err("Context receipt is not active".into());
                }
                receipt.context_written = true;
                if record.task.context != context {
                    replace_context(&mut record, context);
                }
            }
            Request::Sync {
                identity,
                binding,
                expected_revision,
                context,
            } => {
                if identity.provider != Provider::Codex || binding.is_none() {
                    return Err("Context sync requires a current Codex task binding".into());
                }
                let task = self.save_context(identity, context, expected_revision)?;
                return Ok(serde_json::json!({"ok":true,"task":task}));
            }
            Request::Quality {
                binding,
                nonce,
                quality,
                ..
            } => {
                list(&quality.findings, 12, 256)?;
                if quality.repair_count > 1
                    || (quality.status == QualityStatus::Passed && !quality.findings.is_empty())
                {
                    return Err("Invalid quality check".into());
                }
                let receipt = receipt(&mut record, &nonce, &binding, preferences.revision)?;
                if !receipt.delivered || receipt.quality_written {
                    return Err("Quality receipt is not active".into());
                }
                receipt.quality_written = true;
                record.task.quality = quality;
            }
            Request::Read { .. } => unreachable!(),
        }
        self.put(&record)?;
        Ok(serde_json::json!({"ok":true,"task":record.task}))
    }
}

#[cfg(test)]
#[path = "tests/assistance.rs"]
mod tests;
