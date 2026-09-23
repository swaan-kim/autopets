//! Strict wire contract for user-reviewed introduction images. No model claims.
use crate::domain::assistance::Identity;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TemplateId {
    ProductIntro,
    PlanSummary,
    Comparison,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    Landscape,
    Portrait,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CopyLength {
    Short,
    Normal,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Brief {
    pub audience: String,
    pub message: String,
    pub points: Vec<String>,
    pub source_text: String,
    pub source_label: String,
}
impl Brief {
    pub fn validate(&self) -> Result<(), String> {
        text(&self.audience, 80, false)?;
        text(&self.message, 240, false)?;
        if self.points.is_empty() || self.points.len() > 5 {
            return Err("Use one to five key points".into());
        }
        for point in &self.points {
            text(point, 160, false)?;
        }
        text(&self.source_text, 8000, true)?;
        text(&self.source_label, 160, true)
    }
}

pub(crate) fn text(value: &str, max: usize, empty: bool) -> Result<(), String> {
    if (!empty && value.trim().is_empty())
        || value.chars().count() > max
        || value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err("Invalid or oversized artifact text".into());
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Style {
    pub palette: Vec<String>,
    pub logo_data_url: Option<String>,
    pub copy_length: CopyLength,
    pub layout: Layout,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Warning,
    Pending,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckMethod {
    Code,
    Human,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Check {
    pub id: String,
    pub status: CheckStatus,
    pub detail: String,
    pub method: CheckMethod,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReviewStatus {
    #[default]
    Pending,
    Pass,
    Fail,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    pub readability: ReviewStatus,
    pub layout: ReviewStatus,
    pub fidelity: ReviewStatus,
}
impl Review {
    pub fn all_pass(&self) -> bool {
        [&self.readability, &self.layout, &self.fidelity]
            .iter()
            .all(|v| **v == ReviewStatus::Pass)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RevisionKind {
    Shorten,
    Emphasize,
    Restructure,
    Custom,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Revision {
    pub kind: RevisionKind,
    pub instruction: String,
    pub base_version_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Version {
    pub id: String,
    pub created_at: u64,
    pub width: u32,
    pub height: u32,
    pub rendered_text: String,
    pub brief: Brief,
    pub style: Style,
    pub template_id: TemplateId,
    pub revision_request: Option<Revision>,
    pub checks: Vec<Check>,
    pub review: Review,
    pub accepted_at: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub identity: Identity,
    pub revision: u64,
    pub template_id: TemplateId,
    pub brief: Brief,
    pub style: Style,
    pub versions: Vec<Version>,
    pub pending_revision: Option<Revision>,
    pub favorite: bool,
    pub updated_at: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedStyle {
    pub id: String,
    pub name: String,
    pub template_id: TemplateId,
    pub style: Style,
    pub updated_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub automatic_generation: bool,
    pub model_switch: bool,
    pub live_connection_verified: bool,
}
impl Default for Capabilities {
    fn default() -> Self {
        Self {
            automatic_generation: false,
            model_switch: false,
            live_connection_verified: false,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub styles: Vec<SavedStyle>,
    pub capabilities: Capabilities,
    pub observed_chats: Vec<Identity>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Request {
    SaveBrief {
        identity: Identity,
        expected_revision: u64,
        template_id: TemplateId,
        brief: Brief,
        style: Style,
    },
    RequestRevision {
        identity: Identity,
        expected_revision: u64,
        revision_request: Revision,
    },
    ImportVersion {
        identity: Identity,
        expected_revision: u64,
        png_bytes: Vec<u8>,
        rendered_text: String,
    },
    ReviewVersion {
        identity: Identity,
        expected_revision: u64,
        version_id: String,
        review: Review,
    },
    AcceptVersion {
        identity: Identity,
        expected_revision: u64,
        version_id: String,
    },
    SetFavorite {
        identity: Identity,
        expected_revision: u64,
        favorite: bool,
    },
    DeleteProject {
        identity: Identity,
        expected_revision: u64,
    },
    SaveStyle {
        identity: Identity,
        expected_revision: u64,
        version_id: String,
        name: String,
        style_id: Option<String>,
    },
    DeleteStyle {
        style_id: String,
    },
}
impl Request {
    pub fn identity_revision(&self) -> Option<(&Identity, u64)> {
        match self {
            Self::SaveBrief {
                identity,
                expected_revision,
                ..
            }
            | Self::RequestRevision {
                identity,
                expected_revision,
                ..
            }
            | Self::ImportVersion {
                identity,
                expected_revision,
                ..
            }
            | Self::ReviewVersion {
                identity,
                expected_revision,
                ..
            }
            | Self::AcceptVersion {
                identity,
                expected_revision,
                ..
            }
            | Self::SetFavorite {
                identity,
                expected_revision,
                ..
            }
            | Self::DeleteProject {
                identity,
                expected_revision,
                ..
            }
            | Self::SaveStyle {
                identity,
                expected_revision,
                ..
            } => Some((identity, *expected_revision)),
            Self::DeleteStyle { .. } => None,
        }
    }
}
