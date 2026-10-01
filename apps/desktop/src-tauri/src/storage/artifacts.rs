//! Additive v1 storage: old session, assistance and workflow records are untouched.
use crate::application::artifacts::{
    checks, ensure_plain_directory, validate_png, validate_style, ArtifactStore, MAX_PNG_BYTES,
};
use crate::domain::activity::now_ms;
use crate::domain::artifacts::*;
use crate::domain::assistance::{err, Identity};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

impl ArtifactStore {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        let db = Connection::open(data_dir.join("autopets.sqlite3")).map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(err)?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS intro_artifact_projects_v1 (identity TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS intro_artifact_styles_v1 (id TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(err)?;
        let managed = data_dir
            .canonicalize()
            .map_err(err)?
            .join("intro-artifacts-v1");
        ensure_plain_directory(&managed)?;
        let image_dir = managed.join("images");
        ensure_plain_directory(&image_dir)?;
        Ok(Self {
            db,
            image_dir: image_dir.canonicalize().map_err(err)?,
        })
    }
    pub fn find(&self, identity: &Identity) -> Result<Option<Project>, String> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM intro_artifact_projects_v1 WHERE identity=?1",
                [identity.key()?],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let result: Option<Project> = value
            .map(|v| serde_json::from_str(&v).map_err(err))
            .transpose()?;
        if result
            .as_ref()
            .is_some_and(|project| &project.identity != identity)
        {
            return Err("Stored artifact identity mismatch".into());
        }
        Ok(result)
    }
    pub(crate) fn projects(&self) -> Result<Vec<Project>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT value FROM intro_artifact_projects_v1 ORDER BY identity")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn styles(&self) -> Result<Vec<SavedStyle>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT value FROM intro_artifact_styles_v1 ORDER BY id")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn dispatch(&mut self, request: Request) -> Result<(), String> {
        // IMMEDIATE covers both revision read and write, including other DB connections.
        self.db.execute_batch("BEGIN IMMEDIATE").map_err(err)?;
        let mut created = Vec::<PathBuf>::new();
        let mut deleted = Vec::<PathBuf>::new();
        let result = self
            .mutate(request, &mut created, &mut deleted)
            .and_then(|_| self.db.execute_batch("COMMIT").map_err(err));
        if let Err(error) = result {
            let _ = self.db.execute_batch("ROLLBACK");
            for path in created {
                let _ = std::fs::remove_file(path);
            }
            return Err(error);
        }
        for path in deleted {
            match std::fs::remove_file(path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => {
                    return Err(format!(
                        "Project deleted; managed image cleanup failed: {e}"
                    ))
                }
            }
        }
        Ok(())
    }
    fn mutate(
        &mut self,
        request: Request,
        created: &mut Vec<PathBuf>,
        deleted: &mut Vec<PathBuf>,
    ) -> Result<(), String> {
        if let Request::DeleteStyle { style_id } = &request {
            valid_id(style_id)?;
            if self
                .db
                .execute(
                    "DELETE FROM intro_artifact_styles_v1 WHERE id=?1",
                    [style_id],
                )
                .map_err(err)?
                == 0
            {
                return Err("Unknown saved style".into());
            }
            return Ok(());
        }
        let (identity, expected) = request
            .identity_revision()
            .ok_or("Artifact identity required")?;
        let key = identity.key()?;
        let existing = self.find(identity)?;
        if existing.as_ref().map_or(0, |p| p.revision) != expected {
            return Err("Artifact revision is stale; refresh before editing".into());
        }
        let mut project = match (existing, &request) {
            (Some(project), _) => project,
            (
                None,
                Request::SaveBrief {
                    template_id,
                    brief,
                    style,
                    ..
                },
            ) => Project {
                identity: identity.clone(),
                revision: 0,
                template_id: template_id.clone(),
                brief: brief.clone(),
                style: style.clone(),
                versions: vec![],
                pending_revision: None,
                favorite: false,
                updated_at: now_ms(),
            },
            (None, _) => return Err("Unknown artifact project".into()),
        };
        match request {
            Request::SaveBrief {
                template_id,
                brief,
                style,
                ..
            } => {
                brief.validate()?;
                validate_style(&style)?;
                project.template_id = template_id;
                project.brief = brief;
                project.style = style;
            }
            Request::RequestRevision {
                revision_request, ..
            } => {
                text(&revision_request.instruction, 500, false)?;
                valid_id(&revision_request.base_version_id)?;
                let base = project
                    .versions
                    .iter()
                    .find(|v| v.id == revision_request.base_version_id)
                    .ok_or("Revision base belongs to another project or no longer exists")?;
                // Selecting an older version means revising that version's frozen
                // brief and visual settings, not silently inheriting a newer draft.
                project.brief = base.brief.clone();
                project.style = base.style.clone();
                project.template_id = base.template_id.clone();
                project.pending_revision = Some(revision_request);
            }
            Request::ImportVersion {
                png_bytes,
                rendered_text,
                ..
            } => {
                if project.versions.len() >= 20 {
                    return Err("The project has reached its 20-version limit".into());
                }
                text(&rendered_text, 8000, false)?;
                let (width, height) = validate_png(&png_bytes, MAX_PNG_BYTES)?;
                if let Some(revision) = &project.pending_revision {
                    if self.image(&project.identity, &revision.base_version_id)? == png_bytes {
                        return Err("The requested revision needs a newly rendered PNG, not its unchanged base image".into());
                    }
                }
                let id = uuid::Uuid::new_v4().to_string();
                let path = self.image_path(&id)?;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                    .map_err(err)?;
                created.push(path);
                file.write_all(&png_bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(err)?;
                let version = Version {
                    id,
                    created_at: now_ms(),
                    width,
                    height,
                    rendered_text: rendered_text.clone(),
                    brief: project.brief.clone(),
                    style: project.style.clone(),
                    template_id: project.template_id.clone(),
                    revision_request: project.pending_revision.take(),
                    checks: checks(&project.brief, &rendered_text),
                    review: Review::default(),
                    accepted_at: None,
                };
                project.versions.push(version);
            }
            Request::ReviewVersion {
                version_id, review, ..
            } => {
                let version = version_mut(&mut project, &version_id)?;
                version.review = review;
                version.accepted_at = None;
                for check in &mut version.checks {
                    if check.method != CheckMethod::Human {
                        continue;
                    }
                    let reviewed = match check.id.as_str() {
                        "readability" => &version.review.readability,
                        "layout" => &version.review.layout,
                        "fidelity" => &version.review.fidelity,
                        _ => continue,
                    };
                    check.status = match reviewed {
                        ReviewStatus::Pending => CheckStatus::Pending,
                        ReviewStatus::Pass => CheckStatus::Pass,
                        ReviewStatus::Fail => CheckStatus::Warning,
                    };
                    check.detail = match reviewed {
                        ReviewStatus::Pending => "실제 이미지를 사람이 확인해야 합니다.",
                        ReviewStatus::Pass => "사용자가 실제 이미지를 확인했습니다.",
                        ReviewStatus::Fail => {
                            "사용자가 실제 이미지에서 수정할 내용을 확인했습니다."
                        }
                    }
                    .into();
                }
            }
            Request::AcceptVersion { version_id, .. } => {
                if project.pending_revision.is_some() {
                    return Err("Import the requested revision before accepting a version".into());
                }
                let version = version_mut(&mut project, &version_id)?;
                // Exact phrase matching cannot judge a faithful paraphrase. Only the
                // user's explicit fidelity review can resolve that content warning.
                if !version.review.all_pass()
                    || version.checks.iter().any(|check| {
                        check.method == CheckMethod::Code
                            && check.status != CheckStatus::Pass
                            && check.id != "content"
                    })
                {
                    return Err(
                        "Complete all human reviews and resolve PNG or number warnings before accepting"
                            .into(),
                    );
                }
                version.accepted_at = Some(now_ms());
            }
            Request::SetFavorite { favorite, .. } => project.favorite = favorite,
            Request::DeleteProject { .. } => {
                for version in &project.versions {
                    deleted.push(self.image_path(&version.id)?);
                }
                self.db
                    .execute(
                        "DELETE FROM intro_artifact_projects_v1 WHERE identity=?1",
                        [key],
                    )
                    .map_err(err)?;
                return Ok(());
            }
            Request::SaveStyle {
                version_id,
                name,
                style_id,
                ..
            } => {
                text(&name, 60, false)?;
                let version = version_mut(&mut project, &version_id)?;
                if version.accepted_at.is_none() || !version.review.all_pass() {
                    return Err("Save styles only from an accepted version".into());
                }
                validate_style(&version.style)?;
                let id = match style_id {
                    Some(id) => {
                        valid_id(&id)?;
                        let exists: bool = self
                            .db
                            .query_row(
                                "SELECT EXISTS(SELECT 1 FROM intro_artifact_styles_v1 WHERE id=?1)",
                                [&id],
                                |r| r.get(0),
                            )
                            .map_err(err)?;
                        if !exists {
                            return Err("Unknown saved style".into());
                        }
                        id
                    }
                    None => {
                        let count: u64 = self
                            .db
                            .query_row("SELECT COUNT(*) FROM intro_artifact_styles_v1", [], |r| {
                                r.get(0)
                            })
                            .map_err(err)?;
                        if count >= 20 {
                            return Err(
                                "The saved style collection has reached its 20-style limit".into(),
                            );
                        }
                        uuid::Uuid::new_v4().to_string()
                    }
                };
                // Deliberate allowlist: never serialize brief, rendered text, identity or revision request.
                let saved = SavedStyle {
                    id: id.clone(),
                    name: name.trim().to_owned(),
                    template_id: version.template_id.clone(),
                    style: version.style.clone(),
                    updated_at: now_ms(),
                };
                self.db.execute("INSERT INTO intro_artifact_styles_v1(id,value) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET value=excluded.value", params![id, serde_json::to_string(&saved).map_err(err)?]).map_err(err)?;
            }
            Request::DeleteStyle { .. } => unreachable!(),
        }
        project.revision = project
            .revision
            .checked_add(1)
            .ok_or("Artifact revision overflow")?;
        project.updated_at = now_ms();
        self.db.execute("INSERT INTO intro_artifact_projects_v1(identity,value) VALUES(?1,?2) ON CONFLICT(identity) DO UPDATE SET value=excluded.value", params![key, serde_json::to_string(&project).map_err(err)?]).map_err(err)?;
        Ok(())
    }
}
fn valid_id(id: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid artifact identifier")?;
    if parsed.to_string() != id {
        return Err("Invalid artifact identifier".into());
    }
    Ok(())
}
fn version_mut<'a>(project: &'a mut Project, id: &str) -> Result<&'a mut Version, String> {
    valid_id(id)?;
    project
        .versions
        .iter_mut()
        .find(|v| v.id == id)
        .ok_or_else(|| "Unknown artifact version".into())
}
