//! Jobs that an AI reports through the AutoPets MCP tool (`autopets_report`): it is asking the
//! user, working, done or failed, with an optional result location. This is how the pet learns
//! about work in hosts where no hook or skill script runs (measured in
//! docs/testing/m0-baseline-20261112.md). In memory only (no DB change). A report carries no
//! conversation text, and it never starts, stops or changes AI work.
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf};

const MAX_JOBS: usize = 12;
/// A job without a newer report for a day is dropped. A finished one stays that long for "결과 열기".
pub const JOB_TTL_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum State { Asking, Working, Done, Failed }

/// What the pet's own look at a finished result found (#77). Counts only: no text from the result
/// file is kept here. The MCP tool makes it with fixed rules; it is not a rendering or a fact check.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    #[serde(default)] pub slides: u32, #[serde(default)] pub blanks: u32,
    #[serde(default)] pub notes: u32, #[serde(default)] pub external: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String, pub state: State, pub host: String, pub title: String,
    pub pet_id: Option<String>, pub result_path: Option<String>,
    pub created_at: u64, pub updated_at: u64,
    pub review: Option<Review>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub job_id: String, pub state: State, pub host: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default)] pub pet_id: Option<String>,
    #[serde(default)] pub result_path: Option<String>,
    #[serde(default)] pub review: Option<Review>,
}

fn label(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
/// A short fixed vocabulary, so the pet can say where to look without storing anything about the chat.
fn known_host(value: &str) -> bool { matches!(value, "codex" | "claude" | "claude-code" | "other") }
/// An absolute local path without control characters or `..`. It is shown and used to open its
/// folder; it is never executed.
fn safe_path(value: &str) -> bool {
    let path = Path::new(value);
    label(value, 1024) && path.is_absolute() && !path.components().any(|part| matches!(part, Component::ParentDir))
}

#[derive(Default)]
pub struct Jobs { items: VecDeque<Job> }

impl Jobs {
    /// Records one report. The first report of a job creates it; later ones with the same id update it.
    pub fn report(&mut self, input: Report, now: u64) -> Result<Job, String> {
        let valid = uuid::Uuid::parse_str(&input.job_id).is_ok() && known_host(&input.host)
            && input.title.as_deref().map_or(true, |value| label(value, 80))
            && input.pet_id.as_deref().map_or(true, |value| label(value, 128))
            && input.result_path.as_deref().map_or(true, safe_path)
            // A review describes a finished result that has a location.
            && input.review.map_or(true, |review| input.state == State::Done && input.result_path.is_some()
                && [review.slides, review.blanks, review.notes, review.external].iter().all(|count| *count <= 999));
        if !valid { return Err("invalid-pet-job".into()); }
        self.items.retain(|job| now.saturating_sub(job.updated_at) <= JOB_TTL_MS);
        let position = self.items.iter().position(|job| job.id == input.job_id);
        if let Some(index) = position {
            let job = &mut self.items[index];
            // A job belongs to the AI that started it; another host cannot rewrite it.
            if job.host != input.host { return Err("pet-job-mismatch".into()); }
            job.state = input.state;
            job.updated_at = now;
            // The review belongs to the result just reported; a new round of work clears it.
            job.review = input.review;
            if let Some(title) = input.title { job.title = title; }
            if input.pet_id.is_some() { job.pet_id = input.pet_id; }
            if input.result_path.is_some() { job.result_path = input.result_path; }
            return Ok(job.clone());
        }
        let job = Job {
            id: input.job_id, state: input.state, host: input.host,
            title: input.title.unwrap_or_else(|| "맡긴 일".to_string()),
            pet_id: input.pet_id, result_path: input.result_path, created_at: now, updated_at: now,
            review: input.review,
        };
        self.items.push_back(job.clone());
        while self.items.len() > MAX_JOBS { self.items.pop_front(); }
        Ok(job)
    }

    /// Current jobs, newest report first.
    pub fn snapshot(&self, now: u64) -> Vec<Job> {
        let mut jobs: Vec<Job> = self.items.iter().filter(|job| now.saturating_sub(job.updated_at) <= JOB_TTL_MS).cloned().collect();
        jobs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        jobs
    }

    /// Folder to show for a job: the reported path when it is a folder, otherwise its parent.
    pub fn result_folder(&self, id: &str) -> Option<PathBuf> {
        let job = self.items.iter().find(|job| job.id == id)?;
        let path = PathBuf::from(job.result_path.as_deref()?);
        if path.is_dir() { return Some(path); }
        let parent = path.parent()?;
        if parent.is_dir() { Some(parent.to_path_buf()) } else { None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";
    fn report(id: &str, state: State) -> Report {
        Report { job_id: id.into(), state, host: "codex".into(), title: None, pet_id: None, result_path: None, review: None }
    }

    #[test]
    fn a_job_is_created_once_and_later_reports_update_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("slides.html");
        std::fs::write(&file, "fixture").unwrap();
        let mut jobs = Jobs::default();
        let first = jobs.report(Report { title: Some("발표자료 만들기".into()), pet_id: Some("pet-1".into()), ..report(A, State::Asking) }, 10).unwrap();
        assert_eq!((first.state, first.title.as_str(), first.created_at), (State::Asking, "발표자료 만들기", 10));
        jobs.report(report(A, State::Working), 20).unwrap();
        let done = jobs.report(Report { result_path: Some(file.to_string_lossy().into_owned()), ..report(A, State::Done) }, 30).unwrap();
        assert_eq!((done.state, done.created_at, done.updated_at), (State::Done, 10, 30));
        assert_eq!(done.title, "발표자료 만들기");
        assert_eq!(done.pet_id.as_deref(), Some("pet-1"));
        assert_eq!(jobs.snapshot(40).len(), 1);
        // A file result opens its folder; the file itself is never opened or run.
        assert_eq!(jobs.result_folder(A), Some(dir.path().to_path_buf()));
        assert_eq!(jobs.result_folder(B), None);
    }

    #[test]
    fn invalid_reports_and_other_hosts_change_nothing() {
        let mut jobs = Jobs::default();
        jobs.report(report(A, State::Working), 1).unwrap();
        let cases = vec![
            Report { job_id: "not-a-uuid".into(), ..report(A, State::Done) },
            Report { host: "somewhere".into(), ..report(B, State::Done) },
            Report { title: Some("x".repeat(81)), ..report(B, State::Done) },
            Report { title: Some("줄\n바꿈".into()), ..report(B, State::Done) },
            Report { result_path: Some("relative/path".into()), ..report(B, State::Done) },
            Report { result_path: Some("C:\\work\\..\\secret".into()), ..report(B, State::Done) },
        ];
        for case in cases { assert_eq!(jobs.report(case, 2).unwrap_err(), "invalid-pet-job"); }
        assert_eq!(jobs.report(Report { host: "claude".into(), ..report(A, State::Done) }, 3).unwrap_err(), "pet-job-mismatch");
        let current = jobs.snapshot(4);
        assert_eq!(current.len(), 1);
        assert_eq!((current[0].state, current[0].updated_at), (State::Working, 1));
        assert!(serde_json::from_str::<Report>(r#"{"jobId":"x","state":"done","host":"codex","text":"chat"}"#).is_err(), "unknown fields such as chat text are rejected");
    }

    #[test]
    fn a_review_is_counts_only_and_belongs_to_a_finished_result() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let review = Review { slides: 5, blanks: 4, notes: 3, external: 0 };
        let mut jobs = Jobs::default();
        assert_eq!(jobs.report(Report { review: Some(review), result_path: Some(path.clone()), ..report(A, State::Working) }, 1).unwrap_err(), "invalid-pet-job");
        assert_eq!(jobs.report(Report { review: Some(review), ..report(A, State::Done) }, 1).unwrap_err(), "invalid-pet-job", "a review needs a result location");
        assert_eq!(jobs.report(Report { review: Some(Review { blanks: 1000, ..review }), result_path: Some(path.clone()), ..report(A, State::Done) }, 1).unwrap_err(), "invalid-pet-job");
        let done = jobs.report(Report { review: Some(review), result_path: Some(path.clone()), ..report(A, State::Done) }, 2).unwrap();
        assert_eq!(done.review, Some(review));
        assert_eq!(serde_json::to_value(&done).unwrap()["review"], serde_json::json!({ "slides": 5, "blanks": 4, "notes": 3, "external": 0 }));
        // A new round of work clears the old result's review.
        assert_eq!(jobs.report(report(A, State::Working), 3).unwrap().review, None);
        assert!(serde_json::from_str::<Report>(r#"{"jobId":"x","state":"done","host":"codex","review":{"blanks":1,"text":"[모집 시작일]"}}"#).is_err(), "no text from the result is accepted");
        let parsed: Report = serde_json::from_str(r#"{"jobId":"x","state":"done","host":"codex","review":{"blanks":1}}"#).unwrap();
        assert_eq!(parsed.review, Some(Review { blanks: 1, ..Review::default() }));
    }

    #[test]
    fn old_jobs_expire_and_only_the_newest_twelve_are_kept() {
        let mut jobs = Jobs::default();
        jobs.report(report(A, State::Done), 0).unwrap();
        assert_eq!(jobs.snapshot(JOB_TTL_MS).len(), 1);
        assert!(jobs.snapshot(JOB_TTL_MS + 1).is_empty());
        for index in 0..14u64 {
            let id = format!("00000000-0000-4000-8000-{:012}", index);
            jobs.report(report(&id, State::Working), JOB_TTL_MS + 10 + index).unwrap();
        }
        let current = jobs.snapshot(JOB_TTL_MS + 100);
        assert_eq!(current.len(), 12);
        assert_eq!(current[0].id, "00000000-0000-4000-8000-000000000013", "newest report first");
        assert!(!current.iter().any(|job| job.id == A), "the expired job was dropped");
    }
}
