use std::path::Path;
use tauri::Manager;

#[tauri::command]
pub(crate) fn export_pet_preferences(app: tauri::AppHandle) -> Result<String, String> {
    let asset = app.asset_resolver().get("/assets/connectors/AutoPets-pet-preferences.mcpb".into())
        .ok_or("연결 파일이 포함되지 않은 빌드입니다.")?;
    let downloads = app.path().download_dir().map_err(|_| "다운로드 폴더를 찾을 수 없습니다.")?;
    export(&asset.bytes, &downloads)
}

// Save the bundled connector, then hand the file to Windows so Claude shows its
// own install window. The user still confirms the install inside Claude.
#[tauri::command]
pub(crate) fn install_pet_preferences_in_claude(app: tauri::AppHandle) -> Result<String, String> {
    let asset = app.asset_resolver().get("/assets/connectors/AutoPets-pet-preferences.mcpb".into())
        .ok_or("연결 파일이 포함되지 않은 빌드입니다.")?;
    let downloads = app.path().download_dir().map_err(|_| "다운로드 폴더를 찾을 수 없습니다.")?;
    let name = export(&asset.bytes, &downloads)?;
    let file = downloads.canonicalize().map_err(|_| "다운로드 폴더를 찾을 수 없습니다.")?.join("AutoPets").join(&name);
    shell_open(&file.to_string_lossy())
        .map_err(|_| format!("Claude 설치 창을 열지 못했어요. 다운로드/AutoPets의 {name} 파일을 더블클릭해 주세요."))?;
    Ok(name)
}

// Open a new Claude chat with a request naming the exact saved pet. The text is
// built here from the stored pet only; the UI supplies no URL or prompt.
#[tauri::command]
pub(crate) fn open_pet_in_claude(
    store: tauri::State<crate::application::store::SharedStore>,
    pet_id: String,
    expected_revision: u64,
) -> Result<(), String> {
    let pet = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?
        .saved_pet(&pet_id)?.ok_or("저장한 펫을 찾을 수 없어요.")?;
    if pet.revision != expected_revision {
        return Err("펫 구성이 바뀌었어요. 다시 선택해 주세요.".into());
    }
    shell_open(&claude_pet_uri(&pet.template.name, &pet.id, pet.revision))
        .map_err(|_| "Claude 앱을 열지 못했어요. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요.".into())
}

// Open a new Codex thread with the pet start request in the composer. The user
// still sends it; long requests fall back to copying in the UI.
#[tauri::command]
pub(crate) fn open_pet_in_codex(
    store: tauri::State<crate::application::store::SharedStore>,
    pet_id: String,
    expected_revision: u64,
    prompt: String,
) -> Result<(), String> {
    let pet = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?
        .saved_pet(&pet_id)?.ok_or("저장한 펫을 찾을 수 없어요.")?;
    if pet.revision != expected_revision {
        return Err("saved-pet-revision-changed".into());
    }
    let uri = codex_new_thread_uri(&pet.id, pet.revision, &prompt)?;
    shell_open(&uri).map_err(|_| "Codex 앱을 열지 못했어요. Codex 앱이 설치돼 있는지 확인해 주세요.".into())
}

// Windows protocol launches are only reliable below the classic URL limit.
const MAX_LAUNCH_URI: usize = 2000;

pub(crate) fn codex_new_thread_uri(pet_id: &str, revision: u64, prompt: &str) -> Result<String, String> {
    if prompt.trim().is_empty() || prompt.chars().any(|c| c.is_control() && c != '\n')
        || !prompt.contains(&format!("petId={pet_id}, petRevision={revision}")) {
        return Err("invalid-start-request".into());
    }
    let uri = format!("codex://threads/new?prompt={}", percent_encode(prompt));
    if uri.len() > MAX_LAUNCH_URI { return Err("prompt-too-long".into()); }
    Ok(uri)
}

pub(crate) fn claude_pet_uri(name: &str, id: &str, revision: u64) -> String {
    let prompt = format!(
        "AutoPets에 저장한 \"{name}\" 펫(petId={id}, 개정 {revision})을 autopets_read_pet으로 불러와서 그 작업 방식대로 도와줘. 먼저 무엇을 맡길지 물어봐줘."
    );
    format!("claude://claude.ai/new?q={}", percent_encode(&prompt))
}

fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(windows)]
fn shell_open(target: &str) -> Result<(), ()> {
    use std::ffi::c_void;
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(hwnd: *mut c_void, operation: *const u16, file: *const u16,
            parameters: *const u16, directory: *const u16, show: i32) -> *mut c_void;
    }
    let file: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let open: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), open.as_ptr(), file.as_ptr(),
        std::ptr::null(), std::ptr::null(), 1) };
    if result as isize > 32 { Ok(()) } else { Err(()) }
}

#[cfg(not(windows))]
fn shell_open(_target: &str) -> Result<(), ()> { Err(()) }

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

    #[test]
    fn codex_link_needs_the_exact_pet_and_stays_short() {
        let id = "b5850a8e-b572-496b-b254-7f4687fcf75f";
        let prompt = format!("AutoPets 스킬로 펫을 연결해줘. 저장한 펫: petId={id}, petRevision=2.\n할 일 & 메모");
        let uri = codex_new_thread_uri(id, 2, &prompt).unwrap();
        assert!(uri.starts_with("codex://threads/new?prompt="));
        assert!(!uri[27..].contains(['&', ' ', '\n']));
        assert!(uri.contains("%0A"));
        assert_eq!(codex_new_thread_uri(id, 3, &prompt).unwrap_err(), "invalid-start-request");
        assert_eq!(codex_new_thread_uri(id, 2, &format!("{prompt}\u{7}")).unwrap_err(), "invalid-start-request");
        assert_eq!(codex_new_thread_uri(id, 2, &format!("{prompt}{}", "가".repeat(300))).unwrap_err(), "prompt-too-long");
    }

    #[test]
    fn claude_link_carries_only_the_named_pet_request() {
        let uri = claude_pet_uri("발표 \"펫\" & 메모?", "b5850a8e-b572-496b-b254-7f4687fcf75f", 3);
        assert!(uri.starts_with("claude://claude.ai/new?q="));
        let query = &uri["claude://claude.ai/new?q=".len()..];
        assert!(query.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'%' | b'-' | b'.' | b'_' | b'~')));
        let mut bytes = Vec::new();
        let raw = query.as_bytes();
        let mut i = 0;
        while i < raw.len() {
            if raw[i] == b'%' { bytes.push(u8::from_str_radix(&query[i + 1..i + 3], 16).unwrap()); i += 3; }
            else { bytes.push(raw[i]); i += 1; }
        }
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("\"발표 \"펫\" & 메모?\" 펫(petId=b5850a8e-b572-496b-b254-7f4687fcf75f, 개정 3)"));
        assert!(text.contains("autopets_read_pet"));
    }
}
