//! Which Codex started the pet.
//!
//! The launcher runs as a shell command of a Codex session, so the Codex CLI
//! that hosts that session is one of its ancestor processes. Using that exact
//! executable (instead of guessing an install path) follows the existing
//! AutoPets rule "use the current host's Codex executable; never guess".

use std::path::PathBuf;

#[derive(Clone, Debug, Default)]
pub struct HostInfo {
    /// Absolute path of the hosting `codex.exe`, when it could be determined.
    pub codex: Option<PathBuf>,
    /// `CODEX_THREAD_ID` of the chat that invoked the pet (recorded only).
    pub thread: Option<String>,
}

/// Explicit `--codex` wins, then `AUTOPET_CODEX_EXE`, then the nearest
/// ancestor process named `codex.exe`.
pub fn detect(explicit: Option<String>) -> HostInfo {
    let codex = explicit
        .or_else(|| std::env::var("AUTOPET_CODEX_EXE").ok())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.is_file())
        .or_else(ancestor_codex);
    let thread = std::env::var("CODEX_THREAD_ID")
        .ok()
        .filter(|t| !t.is_empty() && t.len() <= 128 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    HostInfo { codex, thread }
}

#[cfg(windows)]
fn ancestor_codex() -> Option<PathBuf> {
    use core::ffi::c_void;
    use std::collections::HashMap;
    type Handle = *mut c_void;
    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn QueryFullProcessImageNameW(process: Handle, flags: u32, name: *mut u16, size: *mut u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    // pid -> (parent pid, exe file name)
    let mut table: HashMap<u32, (u32, String)> = HashMap::new();
    // SAFETY: standard Toolhelp32 enumeration with a correctly sized entry;
    // the snapshot handle is closed before returning.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot as isize == -1 {
            return None;
        }
        let mut entry: ProcessEntry32W = std::mem::zeroed();
        entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let len = entry.sz_exe_file.iter().position(|&c| c == 0).unwrap_or(260);
            let name = String::from_utf16_lossy(&entry.sz_exe_file[..len]);
            table.insert(entry.th32_process_id, (entry.th32_parent_process_id, name));
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }

    let mut pid = std::process::id();
    for _ in 0..12 {
        let (parent, _) = table.get(&pid)?.clone();
        if parent == 0 || parent == pid {
            return None;
        }
        pid = parent;
        let (_, name) = table.get(&pid)?;
        if name.eq_ignore_ascii_case("codex.exe") {
            // SAFETY: query-only handle, closed right after use.
            unsafe {
                let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if process.is_null() {
                    return None;
                }
                let mut buffer = [0u16; 1024];
                let mut size = buffer.len() as u32;
                let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size);
                CloseHandle(process);
                if ok == 0 {
                    return None;
                }
                return Some(PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize])));
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn ancestor_codex() -> Option<PathBuf> {
    None
}
