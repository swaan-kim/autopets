use crate::application::store::Store;
use crate::domain::pet_link::Target;
use serde::Serialize;

// Only the existing local Codex hook store is eligible. This is a dispatch
// request, not proof that the host opened the task or supports routing.
pub(crate) fn local_task_uri(
    store: &Store,
    session_id: &str,
    expected_cwd: &str,
) -> Result<String, String> {
    let task = store.sessions.get(session_id).ok_or("관측한 작업이 없습니다.")?;
    if task.view.cwd != expected_cwd {
        return Err("작업 출처가 바뀌었습니다. 다시 확인해주세요.".into());
    }
    task_uri(session_id, expected_cwd)
}

// Explicit pets have their own persisted identities and do not require hook
// observations. A saved link may be reopened to verify it after an app restart.
pub(crate) fn pet_task_uri(
    store: &Store,
    target: &Target,
    expected_revision: u64,
) -> Result<String, String> {
    target.validate()?;
    let link = store.pet_links.get(&target.key()).ok_or("pet-not-connected")?;
    if link.target.source_id != "codex-windows-local" || !link.target.matches(target) {
        return Err("pet-target-mismatch".into());
    }
    if link.revision != expected_revision {
        return Err("pet-revision-changed".into());
    }
    task_uri(&link.target.thread_id, &link.target.cwd)
}

fn task_uri(session_id: &str, expected_cwd: &str) -> Result<String, String> {
    let bytes = expected_cwd.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || !matches!(bytes[2], b'/' | b'\\')
        || bytes[2..].contains(&b':')
        || expected_cwd.split(['/', '\\']).any(|part| matches!(part, "." | ".."))
        || expected_cwd.chars().any(char::is_control)
    {
        return Err("로컬 Windows 작업만 앱에서 열기를 시도할 수 있습니다.".into());
    }
    let id = uuid::Uuid::parse_str(session_id).map_err(|_| "작업 ID 형식이 올바르지 않습니다.")?;
    if id.is_nil() || id.hyphenated().to_string() != session_id {
        return Err("정확한 작업 UUID가 필요합니다.".into());
    }
    Ok(format!("codex://threads/{id}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DispatchReceipt {
    pub(crate) status: &'static str,
    pub(crate) session_id: String,
    pub(crate) target_verified: bool,
}

fn receipt(session_id: &str, result: isize) -> Result<DispatchReceipt, String> {
    if result <= 32 {
        return Err("작업 앱으로 링크를 전달하지 못했습니다. 작업 ID로 직접 찾아주세요.".into());
    }
    Ok(DispatchReceipt { status: "dispatched", session_id: session_id.into(), target_verified: false })
}

#[cfg(windows)]
pub(crate) fn dispatch(session_id: &str, uri: &str) -> Result<DispatchReceipt, String> {
    use std::ffi::c_void;
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(hwnd: *mut c_void, operation: *const u16, file: *const u16,
            parameters: *const u16, directory: *const u16, show: i32) -> *mut c_void;
    }
    // No shell, arguments, arbitrary URL, project path or prompt is executed.
    let file: Vec<u16> = uri.encode_utf16().chain(std::iter::once(0)).collect();
    let open: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), open.as_ptr(), file.as_ptr(),
        std::ptr::null(), std::ptr::null(), 1) };
    receipt(session_id, result as isize)
}

#[cfg(not(windows))]
pub(crate) fn dispatch(_session_id: &str, _uri: &str) -> Result<DispatchReceipt, String> {
    Err("Windows 데스크톱 앱에서 사용할 수 있습니다.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const A: &str = "11111111-2222-4333-8444-555555555555";
    const B: &str = "11111111-2222-4333-8444-666666666666";

    #[test]
    fn exact_local_task_and_source_are_required_without_mutating_store() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let cwd = "C:/한글과 공백/시험";
        store.ensure_session(A, cwd, 100);
        store.ensure_session(B, "C:/other", 100);
        let before = serde_json::to_value(store.snapshot()).unwrap()["sessions"].clone();
        assert_eq!(local_task_uri(&store, A, cwd).unwrap(), format!("codex://threads/{A}"));
        assert!(local_task_uri(&store, A, "C:/other").is_err());
        assert!(local_task_uri(&store, B, cwd).is_err());
        assert!(local_task_uri(&store, "new", cwd).is_err());
        assert_eq!(serde_json::to_value(store.snapshot()).unwrap()["sessions"], before);
        for invalid in ["codex://settings", "new", "11111111-2222-4333-8444-555555555555?prompt=x", "{11111111-2222-4333-8444-555555555555}", "00000000-0000-0000-0000-000000000000"] {
            store.ensure_session(invalid, cwd, 100);
            assert!(local_task_uri(&store, invalid, cwd).is_err());
        }
        for unsupported in ["/remote/project", "C:relative", "", "\\\\host\\share", "C:/bad\npath"] {
            store.sessions.get_mut(A).unwrap().view.cwd = unsupported.into();
            assert!(local_task_uri(&store, A, unsupported).is_err());
        }
    }

    #[test]
    fn shell_delivery_never_confirms_navigation() {
        for error in [0, 2, 5, 31, 32] { assert!(receipt(A, error).is_err()); }
        let result = receipt(A, 33).unwrap();
        assert_eq!(result.session_id, A);
        assert_eq!(result.status, "dispatched");
        assert!(!result.target_verified);
    }

    #[test]
    fn explicit_return_requires_saved_target_and_revision_without_changing_state() {
        use crate::domain::pet_link::{Request, Profile};
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let target = Target { source_id: "codex-windows-local".into(), thread_id: A.into(), cwd: dir.path().to_string_lossy().into() };
        let other = Target { thread_id: B.into(), ..target.clone() };
        let a = store.pet_link_request(Request::Connect { target: target.clone() }).unwrap().unwrap();
        store.pet_link_request(Request::Connect { target: other.clone() }).unwrap();
        // Reopening the task is useful both during a run and while help is off.
        store.pet_link_request(Request::Prepare { target: target.clone(), expected_revision: a.revision, request_id: B.into(), profile: Profile::Plan }).unwrap();
        store.pet_link_request(Request::Enable { target: target.clone(), expected_revision: a.revision, enabled: false }).unwrap();
        store.pet_links.get_mut(&target.key()).unwrap().connected = false;
        let revision = store.pet_links[&target.key()].revision;
        let before = serde_json::to_value(store.snapshot()).unwrap()["petLinks"].clone();
        for _ in 0..2 {
            assert_eq!(pet_task_uri(&store, &target, revision).unwrap(), format!("codex://threads/{A}"));
        }
        let normalized = Target { cwd: format!("{}/", target.cwd.replace('\\', "/").to_uppercase()), ..target.clone() };
        assert_eq!(pet_task_uri(&store, &normalized, revision).unwrap(), format!("codex://threads/{A}"));
        assert!(pet_task_uri(&store, &target, revision - 1).is_err());
        assert!(pet_task_uri(&store, &Target { cwd: "C:/other".into(), ..target.clone() }, revision).is_err());
        assert!(pet_task_uri(&store, &Target { source_id: "work-local".into(), ..target.clone() }, revision).is_err());
        assert!(pet_task_uri(&store, &Target { thread_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".into(), ..target.clone() }, revision).is_err());
        assert_eq!(serde_json::to_value(store.snapshot()).unwrap()["petLinks"], before);
        store.pet_link_request(Request::Disconnect { target: target.clone(), expected_revision: revision }).unwrap();
        assert!(pet_task_uri(&store, &target, revision).is_err());
        assert_eq!(pet_task_uri(&store, &other, 1).unwrap(), format!("codex://threads/{B}"));
    }

    #[test]
    fn return_uri_rejects_noncanonical_ids_and_nonlocal_paths() {
        let canonical = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        assert_eq!(task_uri(canonical, "C:/한글과 공백/시험").unwrap(), format!("codex://threads/{canonical}"));
        for id in [canonical.to_uppercase(), format!("{{{canonical}}}"), canonical.replace('-', ""), format!("{canonical}?prompt=x"), "00000000-0000-0000-0000-000000000000".into()] {
            assert!(task_uri(&id, "C:/fixture").is_err());
        }
        for cwd in ["C:relative", "/remote/project", "\\\\host\\share", "\\\\?\\C:\\fixture", "C:/bad\npath", "C:/..", "C:/project/../other", "C:\\project\\.\\nested", "C:/stream:alternate", "C:/folder/C:/other", ""] {
            assert!(task_uri(canonical, cwd).is_err());
        }
        assert!(task_uri(canonical, "C:/moved project/no longer present").is_ok());
    }

    #[test]
    fn explicit_return_rechecks_saved_source_and_lexical_path() {
        use crate::domain::pet_link::Request;
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let target = Target { source_id: "codex-windows-local".into(), thread_id: A.into(), cwd: dir.path().to_string_lossy().into() };
        let saved = store.pet_link_request(Request::Connect { target: target.clone() }).unwrap().unwrap();
        store.pet_links.get_mut(&target.key()).unwrap().target.source_id = "work-local".into();
        assert_eq!(pet_task_uri(&store, &target, saved.revision).unwrap_err(), "pet-target-mismatch");
        store.pet_links.insert(target.key(), saved.clone());
        assert_eq!(pet_task_uri(&store, &target, saved.revision + 1).unwrap_err(), "pet-revision-changed");
        for cwd in ["C:/..", "C:/fixture:alternate"] {
            let invalid = Target { cwd: cwd.into(), ..target.clone() };
            store.pet_links.get_mut(&target.key()).unwrap().target = invalid.clone();
            let before = serde_json::to_value(store.snapshot()).unwrap()["petLinks"].clone();
            assert!(pet_task_uri(&store, &invalid, saved.revision).is_err());
            assert_eq!(serde_json::to_value(store.snapshot()).unwrap()["petLinks"], before);
        }
    }
}
