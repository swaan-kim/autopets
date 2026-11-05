//! Small status file shared by the launcher and the running pet.
//!
//! It lives in the preview's own folder (`%LOCALAPPDATA%\local.autopets.petpreview`),
//! never in the AutoPets desktop data directory.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, thread, time::Duration};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Request id from the launcher; empty for changes made from the pet UI.
    pub nonce: String,
    /// `shown`, `hidden`, `closed` or `not-running`.
    pub state: String,
    pub pid: u32,
    /// True when this request started a new pet process.
    pub created: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

pub fn state_dir() -> PathBuf {
    // Tests only: an isolated state folder, so a test pet never shares the
    // hand-off files with a pet the user is running. A test build can also
    // bake in its own folder name (AUTOPET_PREVIEW_STATE_NAME at build time).
    if let Some(dir) = std::env::var_os("AUTOPET_PREVIEW_STATE_DIR").map(PathBuf::from).filter(|p| p.is_absolute()) {
        return dir;
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(option_env!("AUTOPET_PREVIEW_STATE_NAME").unwrap_or("local.autopets.petpreview"))
}

fn status_path() -> PathBuf {
    state_dir().join("status.json")
}

pub fn write(status: &Status) {
    let dir = state_dir();
    let _ = fs::create_dir_all(&dir);
    let Ok(json) = serde_json::to_vec_pretty(status) else { return };
    let temp = dir.join(format!("status.{}.tmp", status.pid));
    for _ in 0..20 {
        if fs::write(&temp, &json).is_ok() && fs::rename(&temp, status_path()).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    let _ = fs::remove_file(temp);
}

pub fn read() -> Option<Status> {
    serde_json::from_slice(&fs::read(status_path()).ok()?).ok()
}
