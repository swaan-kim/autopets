//! 설정 → 펫 설정 → "컴퓨터를 켤 때 · 펫 띄우기": start AutoPets when the user signs in to Windows.
//!
//! A per-user `Run` value (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, named after the
//! product) holding `"<this exe>" --autostart`. No administrator rights, no new library: the same
//! Win32 calls Windows' own "시작 프로그램" list reads. The uninstaller removes the value
//! (windows/installer-hooks.nsh). A start with `--autostart` opens no manager window: only the
//! pets that were out last time and the tray icon (runtime.rs).
//!
//! Off by default. The app asks once ("컴퓨터를 켜면 펫을 띄울까요?"); `asked` is kept in the data
//! folder so it is never asked again.
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Manager;

pub(crate) const AUTOSTART_ARG: &str = "--autostart";
const PREFS: &str = "autostart-v1.json";

/// This process was started by the sign-in entry.
pub(crate) fn launched_at_login() -> bool { std::env::args().any(|arg| arg == AUTOSTART_ARG) }

pub(crate) fn command_line(exe: &Path) -> String { format!("\"{}\" {AUTOSTART_ARG}", exe.display()) }

#[derive(Serialize, Deserialize, Default)]
struct Prefs { asked: bool }

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutostartState {
    pub(crate) enabled: bool,
    /// The one-time question was answered (or the setting was changed by hand).
    pub(crate) asked: bool,
}

fn read_prefs(data_dir: &Path) -> Prefs {
    std::fs::read(data_dir.join(PREFS)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn write_prefs(data_dir: &Path, prefs: &Prefs) -> Result<(), String> {
    let temporary = data_dir.join(format!("autostart-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, serde_json::to_vec(prefs).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, data_dir.join(PREFS)).map_err(|e| e.to_string())
}

/// The value name: "AutoPets", or "AutoPets Dev" for the source build, so they never overwrite each other.
fn value_name(app: &tauri::AppHandle) -> String {
    app.config().product_name.clone().filter(|name| !name.trim().is_empty()).unwrap_or_else(|| "AutoPets".into())
}

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.try_state::<super::windows::Desktop>().map(|desktop| desktop.data_dir.clone()).ok_or_else(|| "앱 상태를 읽을 수 없습니다.".into())
}

fn state(app: &tauri::AppHandle) -> Result<AutostartState, String> {
    Ok(AutostartState { enabled: registry::read(&value_name(app)).is_some(), asked: read_prefs(&data_dir(app)?).asked })
}

fn apply(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let name = value_name(app);
    if enabled {
        let exe = std::env::current_exe().map_err(|_| "실행 파일 위치를 찾을 수 없습니다.")?;
        registry::write(&name, &command_line(&exe))
    } else {
        registry::delete(&name)
    }
}

#[tauri::command]
pub(crate) fn autostart_state(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<AutostartState, String> {
    super::connection_setup::require_manager(window.label())?;
    state(&app)
}

/// The 펫 설정 switch, or "띄우기" on the one-time question. Off also removes the entry.
#[tauri::command]
pub(crate) fn set_autostart(app: tauri::AppHandle, window: tauri::WebviewWindow, enabled: bool) -> Result<AutostartState, String> {
    super::connection_setup::require_manager(window.label())?;
    apply(&app, enabled)?;
    write_prefs(&data_dir(&app)?, &Prefs { asked: true })?;
    state(&app)
}

/// "나중에" on the one-time question: stays off and is not asked again.
#[tauri::command]
pub(crate) fn dismiss_autostart_prompt(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<AutostartState, String> {
    super::connection_setup::require_manager(window.label())?;
    write_prefs(&data_dir(&app)?, &Prefs { asked: true })?;
    state(&app)
}

#[cfg(windows)]
mod registry {
    use std::ffi::c_void;
    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    // HKEY_CURRENT_USER is ((HKEY)(ULONG_PTR)((LONG)0x80000001)): sign-extended on 64-bit.
    const HKEY_CURRENT_USER: isize = 0x8000_0001_u32 as i32 as isize;
    const REG_SZ: u32 = 1;
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;
    const ERROR_FILE_NOT_FOUND: i32 = 2;
    #[link(name = "advapi32")]
    extern "system" {
        fn RegSetKeyValueW(key: isize, sub_key: *const u16, value: *const u16, kind: u32, data: *const c_void, size: u32) -> i32;
        fn RegDeleteKeyValueW(key: isize, sub_key: *const u16, value: *const u16) -> i32;
        fn RegGetValueW(key: isize, sub_key: *const u16, value: *const u16, flags: u32, kind: *mut u32, data: *mut c_void, size: *mut u32) -> i32;
    }
    fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() }

    pub(super) fn read(name: &str) -> Option<String> {
        let (key, value) = (wide(RUN_KEY), wide(name));
        let mut size = 0u32;
        // SAFETY: null-terminated UTF-16 strings; the first call only asks for the size.
        if unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) } != 0 { return None; }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2).max(1)];
        // SAFETY: `buffer` holds `size` bytes, as Windows asked for.
        if unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut size) } != 0 { return None; }
        let text = String::from_utf16_lossy(&buffer);
        Some(text.trim_end_matches('\0').to_owned())
    }

    pub(super) fn write(name: &str, command: &str) -> Result<(), String> {
        let (key, value, data) = (wide(RUN_KEY), wide(name), wide(command));
        // SAFETY: REG_SZ data is the null-terminated UTF-16 string and its size in bytes.
        let result = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr(), REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32) };
        if result == 0 { Ok(()) } else { Err("시작 프로그램에 등록하지 못했어요.".into()) }
    }

    pub(super) fn delete(name: &str) -> Result<(), String> {
        let (key, value) = (wide(RUN_KEY), wide(name));
        // SAFETY: null-terminated UTF-16 strings.
        let result = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr()) };
        if result == 0 || result == ERROR_FILE_NOT_FOUND { Ok(()) } else { Err("시작 프로그램 등록을 지우지 못했어요.".into()) }
    }
}

#[cfg(not(windows))]
mod registry {
    pub(super) fn read(_name: &str) -> Option<String> { None }
    pub(super) fn write(_name: &str, _command: &str) -> Result<(), String> { Err("Windows에서만 사용할 수 있어요.".into()) }
    pub(super) fn delete(_name: &str) -> Result<(), String> { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entry_starts_this_exe_quietly_and_the_question_is_remembered() {
        assert_eq!(command_line(Path::new(r"C:\Users\A B\AppData\Local\AutoPets\autopets.exe")),
            r#""C:\Users\A B\AppData\Local\AutoPets\autopets.exe" --autostart"#);
        let dir = tempfile::tempdir().unwrap();
        assert!(!read_prefs(dir.path()).asked, "not asked yet");
        write_prefs(dir.path(), &Prefs { asked: true }).unwrap();
        assert!(read_prefs(dir.path()).asked);
        std::fs::write(dir.path().join(PREFS), b"not json").unwrap();
        assert!(!read_prefs(dir.path()).asked, "a broken file asks again rather than failing");
    }

    /// Writes and removes a throwaway value under the real HKCU Run key; never the app's own name.
    #[cfg(windows)]
    #[test]
    fn a_run_value_round_trips_and_removing_a_missing_one_is_fine() {
        let name = format!("AutoPets test {}", uuid::Uuid::new_v4());
        assert_eq!(registry::read(&name), None);
        registry::write(&name, r#""C:\x\autopets.exe" --autostart"#).unwrap();
        assert_eq!(registry::read(&name).as_deref(), Some(r#""C:\x\autopets.exe" --autostart"#));
        registry::delete(&name).unwrap();
        assert_eq!(registry::read(&name), None);
        registry::delete(&name).unwrap();
    }
}
