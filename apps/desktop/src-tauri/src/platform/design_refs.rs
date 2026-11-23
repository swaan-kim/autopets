//! Design reference photos for the presentation pet (Issue #104 prototype; not agreed yet, do not merge).
//!
//! The manager window pastes up to three photos, re-encodes each one itself as a JPEG of at most
//! 1600 px (which also drops camera metadata such as location), and hands over only those bytes.
//! They are written to `<data>/design-references/<ref>/1.jpg…` so the Codex chat can open them by
//! the short `ref` in the start request; a photo never travels in the link. Every save removes
//! reference folders older than seven days. Nothing here is executed, uploaded or read back.
use std::{
    fs,
    path::Path,
    time::{Duration, SystemTime},
};

pub(crate) const FOLDER: &str = "design-references";
const MAX_IMAGES: usize = 3;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const KEEP: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const REF_LEN: usize = 12;

/// A complete JPEG as the canvas produces it: start-of-image and end-of-image markers, bounded size.
pub(crate) fn valid_jpeg(bytes: &[u8]) -> bool {
    bytes.len() >= 4
        && bytes.len() <= MAX_BYTES
        && bytes[..3] == [0xFF, 0xD8, 0xFF]
        && bytes[bytes.len() - 2..] == [0xFF, 0xD9]
}

fn is_ref(name: &str) -> bool {
    name.len() == REF_LEN && name.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub(crate) fn save(data_dir: &Path, images: &[Vec<u8>], now: SystemTime) -> Result<String, String> {
    if images.is_empty() || images.len() > MAX_IMAGES || !images.iter().all(|image| valid_jpeg(image)) {
        return Err("invalid-design-reference".into());
    }
    let root = data_dir.join(FOLDER);
    prune(&root, now);
    let id = uuid::Uuid::new_v4().simple().to_string()[..REF_LEN].to_string();
    let dir = root.join(&id);
    fs::create_dir_all(&dir).map_err(|_| "design-reference-unwritable")?;
    for (index, image) in images.iter().enumerate() {
        if fs::write(dir.join(format!("{}.jpg", index + 1)), image).is_err() {
            let _ = fs::remove_dir_all(&dir);
            return Err("design-reference-unwritable".into());
        }
    }
    Ok(id)
}

/// Removes only this feature's own folders (a 12-character lowercase hex name) older than `KEEP`.
fn prune(root: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let ours = entry.file_name().to_str().is_some_and(is_ref) && entry.path().is_dir();
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > KEEP);
        if ours && old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Only the manager window may store photos; the floating pets have no paste field.
#[tauri::command]
pub(crate) fn save_design_references(
    window: tauri::WebviewWindow,
    desktop: tauri::State<'_, super::windows::Desktop>,
    images: Vec<Vec<u8>>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("invalid-design-reference".into());
    }
    save(&desktop.data_dir, &images, SystemTime::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(size: usize) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        bytes.resize(size.max(6) - 2, 0x11);
        bytes.extend([0xFF, 0xD9]);
        bytes
    }

    fn temp() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("autopets-design-refs-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stores_up_to_three_jpegs_under_a_short_ref() {
        let data = temp();
        let id = save(&data, &[jpeg(100), jpeg(200)], SystemTime::now()).unwrap();
        assert!(is_ref(&id));
        let dir = data.join(FOLDER).join(&id);
        assert_eq!(fs::read(dir.join("1.jpg")).unwrap().len(), 100);
        assert_eq!(fs::read(dir.join("2.jpg")).unwrap().len(), 200);
        assert!(!dir.join("3.jpg").exists());
        let _ = fs::remove_dir_all(data);
    }

    #[test]
    fn rejects_anything_but_one_to_three_bounded_jpegs() {
        let data = temp();
        let png = vec![0x89, b'P', b'N', b'G', 0, 0];
        for images in [vec![], vec![png], vec![jpeg(MAX_BYTES + 1)], vec![jpeg(10); 4], vec![vec![0xFF, 0xD8, 0xFF, 0x00]]] {
            assert_eq!(save(&data, &images, SystemTime::now()).unwrap_err(), "invalid-design-reference");
        }
        assert!(!data.join(FOLDER).exists(), "nothing is written for a rejected paste");
        let _ = fs::remove_dir_all(data);
    }

    #[test]
    fn old_reference_folders_are_pruned_but_other_files_are_kept() {
        let data = temp();
        let old = save(&data, &[jpeg(50)], SystemTime::now()).unwrap();
        let other = data.join(FOLDER).join("keep-me");
        fs::create_dir_all(&other).unwrap();
        let later = SystemTime::now() + KEEP + Duration::from_secs(60);
        let fresh = save(&data, &[jpeg(50)], later).unwrap();
        assert!(!data.join(FOLDER).join(old).exists(), "older than seven days");
        assert!(data.join(FOLDER).join(fresh).exists());
        assert!(other.exists(), "folders this feature did not create are never removed");
        let _ = fs::remove_dir_all(data);
    }
}
