//! Local, bounded assistance records. Delivery evidence is deliberately separate
//! from a successful write; clients cannot promote themselves to verified support.
use crate::core::now_ms;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

const MAX_CONTEXT_BYTES: usize = 3072;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Chatgpt,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub provider: Provider,
    pub account_id: String,
    pub chat_id: String,
}
impl Identity {
    fn key(&self) -> Result<String, String> {
        bounded(&self.account_id, 200, false)?;
        bounded(&self.chat_id, 512, false)?;
        if self.account_id.chars().any(char::is_control)
            || self.chat_id.chars().any(char::is_control)
        {
            return Err("Invalid assistance identity".into());
        }
        serde_json::to_string(self).map_err(err)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkStyle {
    Auto,
    Fast,
    Thorough,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoutingMode {
    Auto,
    Fixed,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerLength {
    #[default]
    Concise,
    Normal,
    Detailed,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    #[default]
    Adaptive,
    Table,
    List,
    Document,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub enabled: bool,
    pub work_style: WorkStyle,
    #[serde(default)]
    pub answer_length: AnswerLength,
    #[serde(default)]
    pub output_format: OutputFormat,
    pub routing_mode: RoutingMode,
    pub fixed_model: Option<String>,
    pub allowed_models: Vec<String>,
    pub allow_escalation: bool,
    pub revision: u64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            work_style: WorkStyle::Auto,
            answer_length: AnswerLength::Concise,
            output_format: OutputFormat::Adaptive,
            routing_mode: RoutingMode::Auto,
            fixed_model: None,
            allowed_models: vec![],
            allow_escalation: false,
            revision: 0,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub goal: String,
    pub output_format: String,
    pub constraints: Vec<String>,
    pub decisions: Vec<String>,
    pub remaining: Vec<String>,
}
impl Context {
    fn validate(&self) -> Result<(), String> {
        bounded(&self.goal, 1024, true)?;
        bounded(&self.output_format, 512, true)?;
        for values in [&self.constraints, &self.decisions, &self.remaining] {
            list(values, 12, 512)?;
        }
        if serde_json::to_vec(self).map_err(err)?.len() > MAX_CONTEXT_BYTES {
            return Err("Context exceeds 3072 UTF-8 bytes".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Off,
    Pending,
    Prepared,
    Sent,
    Confirmed,
    Unavailable,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistanceState {
    pub status: Status,
    pub requested_model: Option<String>,
    pub applied_model: Option<String>,
    pub reason: String,
    pub injection_bytes: usize,
    #[serde(default)]
    pub context_partial: bool,
    #[serde(default)]
    pub included_context_keys: Vec<String>,
    pub updated_at: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QualityStatus {
    Unchecked,
    Passed,
    NeedsReview,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Quality {
    pub status: QualityStatus,
    pub findings: Vec<String>,
    pub repair_count: u8,
}
impl Default for Quality {
    fn default() -> Self {
        Self {
            status: QualityStatus::Unchecked,
            findings: vec![],
            repair_count: 0,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub identity: Identity,
    pub enabled: bool,
    pub context: Context,
    #[serde(default)]
    pub previous_context: Option<Context>,
    #[serde(default)]
    pub change_summary: String,
    #[serde(default)]
    pub work_style_override: Option<WorkStyle>,
    #[serde(default)]
    pub settings_revision: u64,
    pub revision: u64,
    pub updated_at: u64,
    pub assistance: AssistanceState,
    pub recipe_id: Option<String>,
    pub quality: Quality,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub input_assistance: bool,
    pub model_switch: bool,
    pub reasoning_switch: bool,
    pub context_sync: bool,
    pub token_usage: bool,
    pub additional_repair: bool,
    pub verification: &'static str,
}
pub fn capabilities() -> BTreeMap<&'static str, Capabilities> {
    ["codex", "chatgpt"]
        .into_iter()
        .map(|provider| {
            (
                provider,
                Capabilities {
                    input_assistance: false,
                    model_switch: false,
                    reasoning_switch: false,
                    context_sync: false,
                    token_usage: false,
                    additional_repair: false,
                    verification: "unverified",
                },
            )
        })
        .collect()
}
#[derive(Serialize)]
pub struct Overview {
    pub preferences: Preferences,
    pub tasks: Vec<Task>,
    pub capabilities: BTreeMap<&'static str, Capabilities>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub session_id: String,
    pub turn_id: String,
    pub cwd: String,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Read {
        identity: Identity,
        binding: Option<Binding>,
    },
    Prepare {
        identity: Identity,
        binding: Option<Binding>,
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
        #[serde(rename = "preferencesRevision")]
        preferences_revision: u64,
        #[serde(default, rename = "settingsRevision")]
        settings_revision: u64,
        #[serde(rename = "recipeId")]
        recipe_id: String,
        #[serde(rename = "requestedModel")]
        requested_model: Option<String>,
        reason: String,
        #[serde(rename = "injectionBytes")]
        injection_bytes: usize,
        #[serde(rename = "guidanceHash")]
        guidance_hash: String,
        #[serde(default, rename = "contextPartial")]
        context_partial: bool,
        #[serde(default, rename = "includedContextKeys")]
        included_context_keys: Vec<String>,
    },
    Delivered {
        identity: Identity,
        binding: Option<Binding>,
        nonce: String,
        evidence: String,
    },
    Context {
        identity: Identity,
        binding: Option<Binding>,
        nonce: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
        context: Context,
    },
    Sync {
        identity: Identity,
        binding: Option<Binding>,
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
        context: Context,
    },
    Quality {
        identity: Identity,
        binding: Option<Binding>,
        nonce: String,
        quality: Quality,
    },
}
impl Request {
    pub fn identity_binding(&self) -> (&Identity, Option<&Binding>) {
        match self {
            Self::Read { identity, binding }
            | Self::Prepare {
                identity, binding, ..
            }
            | Self::Delivered {
                identity, binding, ..
            }
            | Self::Context {
                identity, binding, ..
            }
            | Self::Sync {
                identity, binding, ..
            }
            | Self::Quality {
                identity, binding, ..
            } => (identity, binding.as_ref()),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    nonce: String,
    binding: Option<Binding>,
    preferences_revision: u64,
    context_revision: u64,
    hash: String,
    delivered: bool,
    context_written: bool,
    quality_written: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Record {
    task: Task,
    receipt: Option<Receipt>,
}

pub struct AssistanceStore {
    db: Connection,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn bounded(value: &str, max: usize, empty: bool) -> Result<(), String> {
    if (!empty && value.trim().is_empty())
        || value.len() > max
        || value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err("Invalid or oversized assistance value".into());
    }
    Ok(())
}
fn list(values: &[String], max: usize, bytes: usize) -> Result<(), String> {
    if values.len() > max {
        return Err("Too many assistance items".into());
    }
    for value in values {
        bounded(value, bytes, false)?;
    }
    Ok(())
}

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
    fn records(&self) -> Result<Vec<Record>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT value FROM assistance_tasks ORDER BY identity")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    fn load(&self, identity: &Identity) -> Result<Record, String> {
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
    fn put(&mut self, record: &Record) -> Result<(), String> {
        self.db.execute("INSERT INTO assistance_tasks(identity,value) VALUES(?1,?2) ON CONFLICT(identity) DO UPDATE SET value=excluded.value",params![record.task.identity.key()?,serde_json::to_string(record).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    fn ensure(&mut self, identity: &Identity) -> Result<Record, String> {
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
        let tx = self.db.transaction().map_err(err)?;
        tx.execute("INSERT INTO assistance_preferences(singleton,value) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value",[serde_json::to_string(&preferences).map_err(err)?]).map_err(err)?;
        for record in records {
            tx.execute(
                "UPDATE assistance_tasks SET value=?2 WHERE identity=?1",
                params![
                    record.task.identity.key()?,
                    serde_json::to_string(&record).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
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
        let tx = self.db.transaction().map_err(err)?;
        for record in records {
            tx.execute(
                "UPDATE assistance_tasks SET value=?2 WHERE identity=?1",
                params![
                    record.task.identity.key()?,
                    serde_json::to_string(&record).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
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
fn check_revision(record: &Record, expected: u64) -> Result<(), String> {
    if record.task.revision != expected {
        Err("Context revision is stale".into())
    } else {
        Ok(())
    }
}
fn receipt<'a>(
    record: &'a mut Record,
    nonce: &str,
    binding: &Option<Binding>,
    preferences_revision: u64,
) -> Result<&'a mut Receipt, String> {
    let receipt = record
        .receipt
        .as_mut()
        .ok_or("No active assistance receipt")?;
    if receipt.nonce != nonce
        || &receipt.binding != binding
        || receipt.preferences_revision != preferences_revision
    {
        return Err("Stale or invalid assistance receipt".into());
    }
    Ok(receipt)
}
fn reset_pending(record: &mut Record, global_enabled: bool) {
    record.receipt = None;
    record.task.assistance = AssistanceState {
        status: if global_enabled && record.task.enabled {
            Status::Pending
        } else {
            Status::Off
        },
        requested_model: None,
        applied_model: None,
        reason: if global_enabled && record.task.enabled {
            "전달 대기"
        } else {
            "자동 도움이 꺼져 있어요"
        }
        .into(),
        injection_bytes: 0,
        context_partial: false,
        included_context_keys: vec![],
        updated_at: now_ms(),
    };
}
fn erase_context(record: &mut Record, enabled: bool) {
    record.task.context = Context::default();
    record.task.previous_context = None;
    record.task.change_summary.clear();
    record.task.revision += 1;
    record.task.updated_at = now_ms();
    record.task.recipe_id = None;
    record.task.quality = Quality::default();
    reset_pending(record, enabled);
}

fn replace_context(record: &mut Record, context: Context) {
    let prior = &record.task.context;
    let mut fields = vec![];
    if prior.goal != context.goal {
        fields.push("목표");
    }
    if prior.output_format != context.output_format {
        fields.push("결과 형식");
    }
    if prior.constraints != context.constraints {
        fields.push("조건");
    }
    if prior.decisions != context.decisions {
        fields.push("결정");
    }
    if prior.remaining != context.remaining {
        fields.push("남은 일");
    }
    record.task.previous_context = Some(std::mem::replace(&mut record.task.context, context));
    record.task.change_summary = format!("변경: {}", fields.join(" · "));
    record.task.revision += 1;
    record.task.updated_at = now_ms();
    record.task.quality = Quality::default();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity(account: &str, chat: &str) -> Identity {
        Identity {
            provider: Provider::Chatgpt,
            account_id: account.into(),
            chat_id: chat.into(),
        }
    }
    fn read(store: &mut AssistanceStore, id: &Identity) {
        store
            .dispatch(Request::Read {
                identity: id.clone(),
                binding: None,
            })
            .unwrap();
    }
    fn enable(store: &mut AssistanceStore) {
        let mut prefs = store.preferences().unwrap();
        prefs.enabled = true;
        store.save_preferences(prefs).unwrap();
    }
    fn prepare(store: &mut AssistanceStore, id: &Identity, revision: u64) -> serde_json::Value {
        store
            .dispatch(Request::Prepare {
                identity: id.clone(),
                binding: None,
                expected_revision: revision,
                preferences_revision: store.preferences().unwrap().revision,
                settings_revision: store.load(id).unwrap().task.settings_revision,
                recipe_id: "research".into(),
                requested_model: Some("candidate".into()),
                reason: "비교 기준을 정리했어요".into(),
                injection_bytes: 500,
                guidance_hash: "a".repeat(64),
                context_partial: false,
                included_context_keys: vec![],
            })
            .unwrap()
    }
    fn delivered(
        store: &mut AssistanceStore,
        id: &Identity,
        nonce: &str,
    ) -> Result<serde_json::Value, String> {
        store.dispatch(Request::Delivered {
            identity: id.clone(),
            binding: None,
            nonce: nonce.into(),
            evidence: "sent".into(),
        })
    }
    fn example() -> Context {
        Context {
            goal: "경쟁사 비교".into(),
            output_format: "표".into(),
            constraints: vec!["세 곳".into()],
            decisions: vec![],
            remaining: vec!["출처 확인".into()],
        }
    }

    #[test]
    fn editing_undo_and_delete_all_revoke_each_outstanding_receipt() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        let id = identity("a", "c");
        read(&mut store, &id);
        store.save_context(id.clone(), example(), 0).unwrap();
        let prepared = prepare(&mut store, &id, 1);
        let nonce = prepared["nonce"].as_str().unwrap();
        let mut changed = example();
        changed.goal = "변경된 목표".into();
        store.save_context(id.clone(), changed, 1).unwrap();
        assert!(delivered(&mut store, &id, nonce).is_err());
        let prepared = prepare(&mut store, &id, 2);
        let nonce = prepared["nonce"].as_str().unwrap();
        let restored = store.undo_context(id.clone(), 2).unwrap();
        assert_eq!(restored.context, example());
        assert!(delivered(&mut store, &id, nonce).is_err());
        let prepared = prepare(&mut store, &id, 3);
        let nonce = prepared["nonce"].as_str().unwrap();
        store.delete_all_contexts().unwrap();
        assert!(delivered(&mut store, &id, nonce).is_err());
        let task = store.load(&id).unwrap().task;
        assert_eq!(task.revision, 4);
        assert_eq!(task.settings_revision, 0);
        assert!(task.previous_context.is_none());
        assert!(task.change_summary.is_empty());
    }

    #[test]
    fn previous_release_records_default_new_preferences_task_settings_and_delivery_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let id = identity("a", "old");
        {
            let mut store = AssistanceStore::new(dir.path()).unwrap();
            read(&mut store, &id);
            store.save_context(id.clone(), example(), 0).unwrap();
            let mut prefs = serde_json::to_value(Preferences::default()).unwrap();
            prefs.as_object_mut().unwrap().remove("answerLength");
            prefs.as_object_mut().unwrap().remove("outputFormat");
            store
                .db
                .execute(
                    "INSERT INTO assistance_preferences(singleton,value) VALUES(1,?1)",
                    [prefs.to_string()],
                )
                .unwrap();
            let mut record = serde_json::to_value(store.load(&id).unwrap()).unwrap();
            for key in [
                "previousContext",
                "changeSummary",
                "workStyleOverride",
                "settingsRevision",
            ] {
                record["task"].as_object_mut().unwrap().remove(key);
            }
            for key in ["contextPartial", "includedContextKeys"] {
                record["task"]["assistance"]
                    .as_object_mut()
                    .unwrap()
                    .remove(key);
            }
            store
                .db
                .execute(
                    "UPDATE assistance_tasks SET value=?2 WHERE identity=?1",
                    params![id.key().unwrap(), record.to_string()],
                )
                .unwrap();
        }
        let store = AssistanceStore::new(dir.path()).unwrap();
        let prefs = store.preferences().unwrap();
        let task = store.load(&id).unwrap().task;
        assert_eq!(prefs.answer_length, AnswerLength::Concise);
        assert_eq!(prefs.output_format, OutputFormat::Adaptive);
        assert_eq!(task.context, example());
        assert_eq!(task.settings_revision, 0);
        assert!(task.work_style_override.is_none());
        assert!(task.previous_context.is_none());
        assert!(task.change_summary.is_empty());
        assert!(!task.assistance.context_partial);
        assert!(task.assistance.included_context_keys.is_empty());
    }
    #[test]
    fn undo_is_one_step_revision_checked_and_preserves_chat_off() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        let id = identity("a", "c");
        read(&mut store, &id);
        store.set_enabled(id.clone(), false).unwrap();
        store.save_context(id.clone(), example(), 0).unwrap();
        let mut changed = example();
        changed.goal = "새로운 비교 기준".into();
        let edited = store.save_context(id.clone(), changed.clone(), 1).unwrap();
        assert_eq!(edited.previous_context, Some(example()));
        assert_eq!(edited.change_summary, "변경: 목표");
        let unchanged = store.save_context(id.clone(), changed, 2).unwrap();
        assert_eq!(unchanged.revision, 2);
        assert_eq!(unchanged.previous_context, Some(example()));
        assert!(store.undo_context(id.clone(), 1).is_err());
        let restored = store.undo_context(id.clone(), 2).unwrap();
        assert_eq!(restored.context, example());
        assert_eq!(restored.revision, 3);
        assert!(restored.previous_context.is_none());
        assert!(!restored.enabled);
        assert_eq!(restored.assistance.status, Status::Off);
        assert!(store.undo_context(id, 3).is_err());
    }
    #[test]
    fn task_work_style_has_its_own_revision_and_does_not_leak_to_other_chats() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        let a = identity("a", "one");
        let b = identity("a", "two");
        read(&mut store, &a);
        read(&mut store, &b);
        let p = prepare(&mut store, &a, 0);
        let nonce = p["nonce"].as_str().unwrap();
        let changed = store
            .set_work_style(a.clone(), Some(WorkStyle::Fast), 0)
            .unwrap();
        assert_eq!(changed.settings_revision, 1);
        assert_eq!(changed.revision, 0);
        assert_eq!(changed.assistance.reason, "전달 대기");
        assert!(delivered(&mut store, &a, nonce).is_err());
        assert!(store
            .set_work_style(a.clone(), Some(WorkStyle::Thorough), 0)
            .is_err());
        assert_eq!(
            store
                .set_work_style(a.clone(), Some(WorkStyle::Fast), 1)
                .unwrap()
                .settings_revision,
            1
        );
        assert!(store.load(&b).unwrap().task.work_style_override.is_none());
        let stale=serde_json::from_value::<Request>(serde_json::json!({"operation":"prepare","identity":a,"expectedRevision":0,"preferencesRevision":1,"recipeId":"general","requestedModel":null,"reason":"준비","injectionBytes":100,"guidanceHash":"a".repeat(64)})).unwrap();
        assert!(store
            .dispatch(stale)
            .unwrap_err()
            .contains("settings revision"));
        let reset = store.set_work_style(a, None, 1).unwrap();
        assert!(reset.work_style_override.is_none());
        assert_eq!(reset.settings_revision, 2);
    }
    #[test]
    fn partial_context_metadata_is_bounded_and_deletion_clears_history_and_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        let id = identity("a", "c");
        read(&mut store, &id);
        store.save_context(id.clone(), example(), 0).unwrap();
        let payload = serde_json::json!({"operation":"prepare","identity":id,"expectedRevision":1,"preferencesRevision":1,"recipeId":"general","requestedModel":null,"reason":"준비","injectionBytes":100,"guidanceHash":"c".repeat(64),"contextPartial":true,"includedContextKeys":["goal"]});
        let mut invalid = payload.clone();
        invalid["includedContextKeys"] = serde_json::json!(["transcript"]);
        assert!(store
            .dispatch(serde_json::from_value(invalid).unwrap())
            .is_err());
        let result = store
            .dispatch(serde_json::from_value(payload).unwrap())
            .unwrap();
        assert_eq!(result["task"]["assistance"]["contextPartial"], true);
        assert_eq!(
            result["task"]["assistance"]["includedContextKeys"],
            serde_json::json!(["goal"])
        );
        let nonce = result["nonce"].as_str().unwrap();
        let deleted = store.delete_context(id.clone()).unwrap();
        assert_eq!(deleted.context, Context::default());
        assert!(deleted.previous_context.is_none());
        assert!(deleted.change_summary.is_empty());
        assert!(!deleted.assistance.context_partial);
        assert_eq!(deleted.quality.status, QualityStatus::Unchecked);
        assert!(delivered(&mut store, &id, nonce).is_err());
        assert!(store.undo_context(id, deleted.revision).is_err());
    }

    #[test]
    fn additive_tables_preserve_existing_database_and_context_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let db = Connection::open(dir.path().join("autopets.sqlite3")).unwrap();
        db.execute_batch(
            "CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('existing');",
        )
        .unwrap();
        let id = identity("account-a", "chat");
        {
            let mut store = AssistanceStore::new(dir.path()).unwrap();
            read(&mut store, &id);
            store.save_context(id.clone(), example(), 0).unwrap();
        }
        let store = AssistanceStore::new(dir.path()).unwrap();
        assert_eq!(store.overview().unwrap().tasks[0].context, example());
        assert_eq!(
            db.query_row("SELECT value FROM sentinel", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "existing"
        );
        assert!(!store.preferences().unwrap().enabled);
    }
    #[test]
    fn accounts_chats_and_providers_have_separate_records() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        let a = identity("account-a", "same");
        let b = identity("account-b", "same");
        let c = identity("account-a", "other");
        let mut d = a.clone();
        d.provider = Provider::Codex;
        for id in [&a, &b, &c, &d] {
            read(&mut store, id);
        }
        store.save_context(a, example(), 0).unwrap();
        assert_eq!(store.overview().unwrap().tasks.len(), 4);
        for id in [&b, &c, &d] {
            assert_eq!(store.load(id).unwrap().task.context, Context::default());
        }
    }
    #[test]
    fn context_revision_is_optimistic_and_identical_content_does_not_rewrite() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        let id = identity("a", "c");
        read(&mut store, &id);
        let first = store.save_context(id.clone(), example(), 0).unwrap();
        let same = store.save_context(id.clone(), example(), 1).unwrap();
        assert_eq!(first.revision, same.revision);
        assert_eq!(first.updated_at, same.updated_at);
        assert!(store.save_context(id, Context::default(), 0).is_err());
    }
    #[test]
    fn opt_in_and_per_chat_off_stop_delivery_and_sync() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        let id = identity("a", "c");
        read(&mut store, &id);
        assert!(delivered(&mut store, &id, "fake")
            .unwrap_err()
            .contains("disabled"));
        enable(&mut store);
        let p = prepare(&mut store, &id, 0);
        let nonce = p["nonce"].as_str().unwrap();
        store.set_enabled(id.clone(), false).unwrap();
        assert!(delivered(&mut store, &id, nonce).is_err());
        store.delete_all_contexts().unwrap();
        assert!(!store.load(&id).unwrap().task.enabled);
        assert!(store.preferences().unwrap().enabled);
    }
    #[test]
    fn receipt_is_scoped_single_use_and_never_confirms_a_model() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        let a = identity("a", "c1");
        let b = identity("a", "c2");
        read(&mut store, &a);
        read(&mut store, &b);
        let p = prepare(&mut store, &a, 0);
        let nonce = p["nonce"].as_str().unwrap();
        assert!(delivered(&mut store, &b, nonce).is_err());
        let result = delivered(&mut store, &a, nonce).unwrap();
        assert_eq!(result["task"]["assistance"]["status"], "sent");
        assert!(result["task"]["assistance"]["appliedModel"].is_null());
        assert!(delivered(&mut store, &a, nonce).is_err());
        let duplicate = prepare(&mut store, &a, 0);
        assert_eq!(duplicate["duplicate"], true);
        assert!(duplicate["nonce"].is_null());
        for cap in capabilities().values() {
            assert!(
                !cap.model_switch && !cap.input_assistance && !cap.context_sync && !cap.token_usage
            );
        }
    }
    #[test]
    fn preference_changes_and_deletion_revoke_old_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        let id = identity("a", "c");
        read(&mut store, &id);
        let p = prepare(&mut store, &id, 0);
        let nonce = p["nonce"].as_str().unwrap();
        let mut prefs = store.preferences().unwrap();
        prefs.work_style = WorkStyle::Fast;
        store.save_preferences(prefs).unwrap();
        assert!(delivered(&mut store, &id, nonce).is_err());
        let p = prepare(&mut store, &id, 0);
        let nonce = p["nonce"].as_str().unwrap();
        store.delete_context(id.clone()).unwrap();
        assert!(delivered(&mut store, &id, nonce).is_err());
        assert_eq!(store.load(&id).unwrap().task.revision, 1);
    }
    #[test]
    fn bounded_utf8_context_metadata_and_unknown_fields_are_rejected() {
        let mut context = example();
        context.constraints = vec!["가".repeat(160); 8];
        assert!(context.validate().is_err());
        assert!(serde_json::from_value::<Request>(serde_json::json!({"operation":"read","identity":{"provider":"chatgpt","accountId":"a","chatId":"c"},"rawPrompt":"private"})).is_err());
        assert!(serde_json::from_value::<Context>(serde_json::json!({"goal":"g","outputFormat":"","constraints":[],"decisions":[],"remaining":[],"transcript":"private"})).is_err());
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        let id = identity("a", "c");
        read(&mut store, &id);
        let request=serde_json::from_value::<Request>(serde_json::json!({"operation":"prepare","identity":id,"expectedRevision":0,"preferencesRevision":1,"recipeId":"simple","requestedModel":null,"reason":"too large","injectionBytes":3073,"guidanceHash":"a".repeat(64)})).unwrap();
        assert!(store.dispatch(request).is_err());
    }
    #[test]
    fn context_and_quality_each_require_current_delivery_and_allow_one_update() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        enable(&mut store);
        let id = identity("a", "c");
        read(&mut store, &id);
        let p = prepare(&mut store, &id, 0);
        let nonce = p["nonce"].as_str().unwrap();
        let context_request = || Request::Context {
            identity: id.clone(),
            binding: None,
            nonce: nonce.into(),
            expected_revision: 0,
            context: example(),
        };
        assert!(store.dispatch(context_request()).is_err());
        delivered(&mut store, &id, nonce).unwrap();
        store.dispatch(context_request()).unwrap();
        assert!(store.dispatch(context_request()).is_err());
        let quality = |count| Request::Quality {
            identity: id.clone(),
            binding: None,
            nonce: nonce.into(),
            quality: Quality {
                status: QualityStatus::NeedsReview,
                findings: vec!["출처 확인".into()],
                repair_count: count,
            },
        };
        assert!(store.dispatch(quality(2)).is_err());
        store.dispatch(quality(1)).unwrap();
        assert!(store.dispatch(quality(1)).is_err());
    }
    #[test]
    fn restart_invalidates_inflight_receipts_but_preserves_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let id = identity("a", "c");
        let nonce;
        {
            let mut store = AssistanceStore::new(dir.path()).unwrap();
            enable(&mut store);
            read(&mut store, &id);
            nonce = prepare(&mut store, &id, 0)["nonce"]
                .as_str()
                .unwrap()
                .to_string();
        }
        let mut store = AssistanceStore::new(dir.path()).unwrap();
        assert!(delivered(&mut store, &id, &nonce).is_err());
        assert_eq!(
            store.load(&id).unwrap().task.assistance.status,
            Status::Unavailable
        );
        assert!(store.preferences().unwrap().enabled);
    }
}
