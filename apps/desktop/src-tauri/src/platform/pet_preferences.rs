use std::path::Path;
use tauri::Manager;

#[tauri::command]
pub(crate) fn export_pet_preferences(app: tauri::AppHandle) -> Result<String, String> {
    let asset = app.asset_resolver().get("/assets/connectors/AutoPets-pet-preferences.mcpb".into())
        .ok_or("연결 파일이 포함되지 않은 빌드입니다.")?;
    let downloads = app.path().download_dir().map_err(|_| "다운로드 폴더를 찾을 수 없습니다.")?;
    export(&asset.bytes, &downloads)
}

// Export only the app's bundled connector. The UI supplies no bytes or path;
// host settings and existing downloads are never changed.
fn export(bytes: &[u8], downloads: &Path) -> Result<String, String> {
    use std::io::Write;
    if !bytes.starts_with(b"PK\x03\x04") || bytes.len() > 128 * 1024 {
        return Err("연결 파일을 확인할 수 없습니다.".into());
    }
    let root = downloads.canonicalize().map_err(|_| "다운로드 폴더를 찾을 수 없습니다.")?;
    let directory = root.join("AutoPets");
    crate::application::artifacts::ensure_plain_directory(&directory)?;
    let directory = directory.canonicalize().map_err(|_| "저장 폴더를 확인할 수 없습니다.")?;
    if directory.parent() != Some(root.as_path()) {
        return Err("다운로드 폴더 안에만 저장할 수 있습니다.".into());
    }
    let name = format!("AutoPets-pet-preferences-{}.mcpb", uuid::Uuid::new_v4());
    let path = directory.join(&name);
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)
        .map_err(|_| "연결 파일을 저장하지 못했습니다.")?;
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err("연결 파일을 저장하지 못했습니다.".into());
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_preserves_existing_downloads_and_rejects_an_asset_fallback() {
        let downloads = tempfile::tempdir().unwrap();
        let bytes = b"PK\x03\x04synthetic package only";
        let first = export(bytes, downloads.path()).unwrap();
        let second = export(bytes, downloads.path()).unwrap();
        assert_ne!(first, second);
        for name in [&first, &second] {
            assert_eq!(std::fs::read(downloads.path().join("AutoPets").join(name)).unwrap(), bytes);
        }
        assert!(export(b"<html>fallback</html>", downloads.path()).is_err());
        assert!(export(&vec![b'P'; 128 * 1024 + 1], downloads.path()).is_err());
        assert_eq!(std::fs::read_dir(downloads.path().join("AutoPets")).unwrap().count(), 2);
    }
}
