//! AutoPet preview: one executable with two roles.
//!
//! * Launcher (default): `autopet-preview.exe [show|hide|quit] [--codex <codex.exe>]`.
//!   Starts or signals the pet process detached, waits until the pet reports
//!   the requested state, prints one JSON line and exits. Codex runs this.
//! * Chat hand-off (run by the invoking Codex chat, see `handoff.rs`):
//!   `wait` blocks until the user presses '제작 시작' in the pet and prints the
//!   task; `ask --task <id> --file <question.json>` pauses the chat's turn on a
//!   decision until the user answers in the pet (see `checkpoint.rs`);
//!   `done --task <id>` / `fail --task <id> --reason <text>` report back.
//! * Pet (`--serve`, internal): the always-on-top circular window.
//!   A single-instance lock forwards repeated calls to the running pet, so
//!   repeated invocations never create duplicates.

mod bubble;
mod checkpoint;
mod features;
mod handoff;
mod host;
mod pet;
mod slides;
mod status;

use std::{
    path::Path,
    process::{Child, Command, ExitCode, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub(crate) fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

/// Flags that take a value (skipped when looking for the action).
const VALUE_FLAGS: [&str; 6] = ["--codex", "--thread", "--task", "--reason", "--timeout", "--file"];

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--serve") {
        let action = flag(&args, "--action").unwrap_or_else(|| "show".into());
        let nonce = flag(&args, "--nonce").unwrap_or_default();
        pet::serve(action, nonce, host_from_args(&args));
        return ExitCode::SUCCESS;
    }
    // The action is the first argument that is neither a flag nor a flag value.
    let mut positional = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if VALUE_FLAGS.contains(&args[index].as_str()) {
            index += 2;
        } else {
            positional.push(args[index].clone());
            index += 1;
        }
    }
    let action = match positional.first().map(String::as_str) {
        None | Some("show") => "show",
        Some("hide") => "hide",
        Some("quit") | Some("close") => "quit",
        Some(chat @ ("wait" | "ask" | "done" | "fail")) => {
            stop_std_handle_inheritance();
            if let Some(account) = codex_sandbox_account() {
                report(
                    false,
                    "sandboxed",
                    &format!("Codex 샌드박스 계정({account})에서는 펫과 연결할 수 없습니다. 샌드박스 밖 실행 승인이 필요합니다."),
                    None,
                );
                return ExitCode::from(3);
            }
            return match chat {
                "wait" => handoff::cli_wait(&args),
                "ask" => handoff::cli_ask(&args),
                "done" => handoff::cli_report(&args, false),
                _ => handoff::cli_report(&args, true),
            };
        }
        Some("host") => {
            // Diagnostic: which Codex would the pet use for '제작 시작'?
            let host = host::detect(flag(&args, "--codex"));
            println!(
                "{}",
                serde_json::json!({ "codex": host.codex.map(|p| p.to_string_lossy().to_string()), "thread": host.thread })
            );
            return ExitCode::SUCCESS;
        }
        Some("-h") | Some("--help") => {
            println!("usage: autopet-preview.exe [show|hide|quit|host] | wait | ask --task <id> --file <question.json> | done --task <id> | fail --task <id> --reason <text>");
            return ExitCode::SUCCESS;
        }
        Some(other) => {
            report(false, "invalid-argument", &format!("unknown action: {other}"), None);
            return ExitCode::from(2);
        }
    };
    launch(action, &host::detect(flag(&args, "--codex")))
}

/// Host information handed from the launcher to the pet process.
pub(crate) fn host_from_args(args: &[String]) -> host::HostInfo {
    host::HostInfo {
        codex: flag(args, "--codex").map(std::path::PathBuf::from),
        thread: flag(args, "--thread").filter(|t| handoff::valid_thread(t)),
    }
}

/// ASCII-only JSON (\uXXXX escapes) so any console codepage decodes it.
pub(crate) fn ascii_json(value: &serde_json::Value) -> String {
    let mut ascii = String::new();
    for c in value.to_string().chars() {
        if c.is_ascii() {
            ascii.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                ascii.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    ascii
}

fn report(ok: bool, state: &str, message: &str, status: Option<&status::Status>) {
    let line = serde_json::json!({
        "ok": ok,
        "state": state,
        "message": message,
        "pid": status.map(|s| s.pid),
        "created": status.map(|s| s.created),
        "position": status.and_then(|s| Some([s.x?, s.y?])),
    });
    println!("{}", ascii_json(&line));
}

/// Starts `exe --serve ...` detached, with no inherited standard handles.
/// Breaking away keeps the pet alive after the caller's job ends; jobs that
/// do not allow it reject the flag, so fall back to a plain detached start.
pub(crate) fn spawn_serve(exe: &Path, args: &[String]) -> std::io::Result<Child> {
    let spawn = |flags: u32| {
        let mut command = Command::new(exe);
        command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(flags);
        }
        #[cfg(not(windows))]
        let _ = flags;
        command.spawn()
    };
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let base = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    spawn(base | CREATE_BREAKAWAY_FROM_JOB).or_else(|_| spawn(base))
}

/// Keeps the caller's stdin/stdout/stderr out of the long-lived pet process.
/// Otherwise the pet would hold the caller's output pipe open and a caller
/// that reads until EOF (PowerShell `$(...)`, agent shell tools) would hang
/// until the pet is closed.
#[cfg(windows)]
fn stop_std_handle_inheritance() {
    type Handle = *mut core::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(std_handle: u32) -> Handle;
        fn SetHandleInformation(handle: Handle, mask: u32, flags: u32) -> i32;
    }
    const HANDLE_FLAG_INHERIT: u32 = 0x1;
    // STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE
    for id in [-10i32 as u32, -11i32 as u32, -12i32 as u32] {
        // SAFETY: plain Win32 calls on this process's own standard handles;
        // invalid or null handles make SetHandleInformation fail harmlessly.
        unsafe {
            let handle = GetStdHandle(id);
            if !handle.is_null() && handle as isize != -1 {
                SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
}

#[cfg(not(windows))]
fn stop_std_handle_inheritance() {}

/// Name of the Windows account this process runs as, when it is one of the
/// dedicated Codex sandbox accounts (e.g. `CodexSandboxOffline`). Windows
/// opened there never reach the user's desktop.
#[cfg(windows)]
fn codex_sandbox_account() -> Option<String> {
    #[link(name = "advapi32")]
    extern "system" {
        fn GetUserNameW(buffer: *mut u16, size: *mut u32) -> i32;
    }
    let mut buffer = [0u16; 257];
    let mut size = buffer.len() as u32;
    // SAFETY: the buffer and its length are valid for the duration of the call.
    if unsafe { GetUserNameW(buffer.as_mut_ptr(), &mut size) } == 0 {
        return None;
    }
    let name = String::from_utf16_lossy(&buffer[..size.saturating_sub(1) as usize]);
    name.to_ascii_lowercase().starts_with("codexsandbox").then_some(name)
}

#[cfg(not(windows))]
fn codex_sandbox_account() -> Option<String> {
    None
}

fn launch(action: &str, host: &host::HostInfo) -> ExitCode {
    stop_std_handle_inheritance();
    if let Some(account) = codex_sandbox_account() {
        report(
            false,
            "sandboxed",
            &format!("Codex 샌드박스 계정({account})에서는 바탕화면에 펫 창을 띄울 수 없습니다. 샌드박스 밖 실행 승인이 필요합니다."),
            None,
        );
        return ExitCode::from(3);
    }
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
    );
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            report(false, "launch-failed", &error.to_string(), None);
            return ExitCode::from(1);
        }
    };
    let mut serve_args: Vec<String> = ["--serve", "--action", action, "--nonce", &nonce].iter().map(|s| s.to_string()).collect();
    if let Some(codex) = &host.codex {
        serve_args.extend(["--codex".to_owned(), codex.to_string_lossy().to_string()]);
    }
    if let Some(thread) = &host.thread {
        serve_args.extend(["--thread".to_owned(), thread.clone()]);
    }
    let mut child = match spawn_serve(&exe, &serve_args) {
        Ok(child) => child,
        Err(error) => {
            report(false, "launch-failed", &error.to_string(), None);
            return ExitCode::from(1);
        }
    };

    let mut deadline = Instant::now() + Duration::from_secs(25);
    let mut child_exited = false;
    loop {
        if let Some(current) = status::read() {
            if current.nonce == nonce {
                let message = match current.state.as_str() {
                    "shown" if current.created => "AutoPets 테스트 펫이 화면 오른쪽 아래에 나타났습니다.",
                    "shown" => "이미 실행 중인 테스트 펫을 다시 표시했습니다.",
                    "hidden" => "테스트 펫을 숨겼습니다.",
                    "closed" => "테스트 펫을 닫았습니다.",
                    _ => "실행 중인 테스트 펫이 없습니다.",
                };
                report(true, &current.state, message, Some(&current));
                return ExitCode::SUCCESS;
            }
        }
        if !child_exited {
            if let Ok(Some(_)) = child.try_wait() {
                // A forwarded (second) instance exits immediately; give the
                // running pet time to answer, but do not wait forever.
                // Re-creating a hidden pet can restart the WebView2 browser
                // process, which may take several seconds.
                child_exited = true;
                deadline = deadline.min(Instant::now() + Duration::from_secs(15));
            }
        }
        if Instant::now() > deadline {
            if !child_exited {
                // Never leave an invisible pet behind.
                let _ = child.kill();
            }
            report(
                false,
                "timeout",
                "펫이 응답하지 않았습니다. WebView2 런타임과 데스크톱 세션(샌드박스 밖 실행)을 확인하세요.",
                None,
            );
            return ExitCode::from(1);
        }
        thread::sleep(Duration::from_millis(100));
    }
}
