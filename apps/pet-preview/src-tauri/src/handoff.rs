//! Hand-off between the pet and the Codex chat that invoked it.
//!
//! The chat's own turn runs `autopet-preview.exe wait`. It blocks until the
//! user presses '제작 시작' in the pet and then prints the task (settings, the
//! exact request text, the pinned skill and the output path). The chat's model
//! does the work in that same turn, so the request, every command and the
//! final answer appear in the chat the user has open, and then reports with
//! `autopet-preview.exe done --task <id>` (or `fail`). The pet only follows
//! that chat's own session record (rollout, read-only) for live progress and
//! verifies the result. No second Codex session and no second model call.
//!
//! Channels (all local, same Windows user):
//! * CLI -> pet: the single-instance forward (`--serve --action chat-*`).
//! * pet -> CLI: files in `%LOCALAPPDATA%\local.autopets.petpreview\handoff\`:
//!   `state.json` (published link state) and `reply-<nonce>.json`.

use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::ExitCode,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const WAIT_DEFAULT_SECS: u64 = 30 * 60;

pub fn dir() -> PathBuf {
    crate::status::state_dir().join("handoff")
}

fn write_json(path: &Path, value: &Value) {
    let Some(parent) = path.parent() else { return };
    let _ = fs::create_dir_all(parent);
    let Ok(bytes) = serde_json::to_vec_pretty(value) else { return };
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    for _ in 0..20 {
        if fs::write(&temp, &bytes).is_ok() && fs::rename(&temp, path).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    let _ = fs::remove_file(temp);
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn safe_token(text: &str) -> bool {
    !text.is_empty() && text.len() <= 128 && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn valid_thread(text: &str) -> bool {
    safe_token(text)
}

/// Pet side: the link state every CLI polls.
pub fn publish(state: &Value) {
    write_json(&dir().join("state.json"), state);
}

/// Pet side: the answer to one forwarded request.
pub fn reply(nonce: &str, value: &Value) {
    if safe_token(nonce) {
        write_json(&dir().join(format!("reply-{nonce}.json")), value);
    }
}

fn read_state() -> Option<Value> {
    read_json(&dir().join("state.json"))
}

#[cfg(windows)]
pub fn process_alive(pid: u32) -> bool {
    type Handle = *mut core::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn WaitForSingleObject(handle: Handle, millis: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_TIMEOUT: u32 = 0x102;
    if pid == 0 {
        return false;
    }
    // SAFETY: query-only handle, closed right after use.
    unsafe {
        let handle = OpenProcess(SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let running = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
        CloseHandle(handle);
        running
    }
}

#[cfg(not(windows))]
pub fn process_alive(_pid: u32) -> bool {
    true
}

/// The chat's own session record: `<CODEX_HOME>\sessions\YYYY\MM\DD\rollout-*-<thread>.jsonl`.
pub fn find_rollout(thread: &str) -> Option<PathBuf> {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".codex")))?;
    let suffix = format!("-{thread}.jsonl");
    let mut stack = vec![(home.join("sessions"), 0)];
    while let Some((folder, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < 3 {
                    stack.push((path, depth + 1));
                }
            } else if path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("rollout-") && n.ends_with(&suffix)) {
                return Some(path);
            }
        }
    }
    None
}

// ---------------------------------------------------------------- CLI side

fn print(value: &Value) {
    println!("{}", crate::ascii_json(value));
}

fn new_nonce() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
    )
}

/// Sends one request to the running pet and waits for its reply file.
fn forward(action: &str, extra: &[String], timeout: Duration) -> Result<Value, &'static str> {
    let nonce = new_nonce();
    let exe = std::env::current_exe().map_err(|_| "launch-failed")?;
    let mut args = vec!["--serve".to_owned(), "--action".to_owned(), action.to_owned(), "--nonce".to_owned(), nonce.clone()];
    args.extend_from_slice(extra);
    let mut child = crate::spawn_serve(&exe, &args).map_err(|_| "launch-failed")?;
    let reply_path = dir().join(format!("reply-{nonce}.json"));
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(value) = read_json(&reply_path) {
            let _ = fs::remove_file(&reply_path);
            let _ = child.try_wait();
            return Ok(value);
        }
        // No pet running: the spawned process became the pet, saw a chat-*
        // action and exited after writing "not-running".
        if crate::status::read().is_some_and(|s| s.nonce == nonce && s.state == "not-running") {
            return Err("not-running");
        }
        if Instant::now() > deadline {
            let _ = child.try_wait();
            return Err("no-reply");
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn chat_thread(args: &[String]) -> Option<String> {
    crate::flag(args, "--thread")
        .or_else(|| std::env::var("CODEX_THREAD_ID").ok())
        .filter(|t| valid_thread(t))
}

fn fail_line(state: &str, message: &str) -> ExitCode {
    print(&json!({ "ok": false, "state": state, "message": message }));
    ExitCode::from(1)
}

fn forward_error(error: &str) -> ExitCode {
    match error {
        "not-running" => fail_line("not-running", "실행 중인 펫이 없습니다. 먼저 펫을 띄우세요."),
        "no-reply" => fail_line("no-reply", "펫이 응답하지 않았습니다."),
        _ => fail_line("launch-failed", "펫에 요청을 보내지 못했습니다."),
    }
}

/// `recommend`: hands one pet recommendation from the AutoPets hook to the running pet.
/// Never starts a pet: with none running it reports `not-running` and exits.
pub fn cli_recommend(args: &[String]) -> ExitCode {
    let chat = crate::flag(args, "--chat").filter(|t| valid_thread(t));
    let turn = crate::flag(args, "--turn").filter(|t| !t.trim().is_empty() && t.len() <= 128);
    let file = crate::flag(args, "--file").filter(|f| Path::new(f).is_absolute());
    let (Some(chat), Some(turn), Some(file)) = (chat, turn, file) else {
        return fail_line("invalid-argument", "--chat, --turn, --file(절대 경로)이 필요합니다.");
    };
    let extra = ["--chat".to_owned(), chat, "--turn".to_owned(), turn, "--file".to_owned(), file];
    match forward("chat-recommend", &extra, Duration::from_secs(4)) {
        Ok(reply) => {
            let ok = reply.get("ok") == Some(&json!(true));
            print(&reply);
            if ok { ExitCode::SUCCESS } else { ExitCode::from(1) }
        }
        Err(error) => forward_error(error),
    }
}

/// `wait`: blocks until the pet hands this chat a task, then prints it.
pub fn cli_wait(args: &[String]) -> ExitCode {
    let Some(thread) = chat_thread(args) else {
        return fail_line(
            "no-chat",
            "CODEX_THREAD_ID가 없어 어느 Codex 채팅인지 알 수 없습니다. Codex 채팅의 명령으로 실행하세요.",
        );
    };
    let Ok(cwd) = std::env::current_dir() else {
        return fail_line("no-cwd", "작업 폴더를 알 수 없습니다.");
    };
    let timeout = crate::flag(args, "--timeout")
        .and_then(|t| t.parse::<u64>().ok())
        .unwrap_or(WAIT_DEFAULT_SECS)
        .clamp(10, 2 * 60 * 60);
    let me = std::process::id().to_string();
    let identity = vec![
        "--thread".to_owned(),
        thread.clone(),
        "--pid".to_owned(),
        me.clone(),
        "--cwd".to_owned(),
        cwd.to_string_lossy().to_string(),
    ];
    let pet_pid = match forward("chat-wait", &identity, Duration::from_secs(20)) {
        Ok(reply) if reply.get("ok") == Some(&json!(true)) => reply.get("petPid").and_then(Value::as_u64).unwrap_or(0) as u32,
        Ok(reply) => return fail_line("refused", reply.get("message").and_then(Value::as_str).unwrap_or("펫이 대기 등록을 거절했습니다.")),
        Err(error) => return forward_error(error),
    };
    let deadline = Instant::now() + Duration::from_secs(timeout);
    loop {
        thread::sleep(Duration::from_millis(500));
        if !process_alive(pet_pid) {
            return fail_line("pet-closed", "펫이 닫혀서 대기를 끝냈습니다.");
        }
        let state = read_state().unwrap_or(Value::Null);
        let waiter_pid = state.pointer("/waiter/pid").and_then(Value::as_u64).map(|p| p.to_string());
        let task = state.get("task").cloned().unwrap_or(Value::Null);
        let task_state = task.get("state").and_then(Value::as_str).unwrap_or("");
        let task_thread = task.get("thread").and_then(Value::as_str);
        let task_chat = task.get("chatThread").and_then(Value::as_str);
        let mine = task_thread.map_or(true, |t| t == thread);
        let claimable = (task_state == "ready" && mine) || (task_state == "claimed" && task_chat == Some(thread.as_str()));
        if claimable {
            let id = task.get("id").and_then(Value::as_str).unwrap_or("").to_owned();
            let mut claim = vec!["--task".to_owned(), id];
            claim.extend_from_slice(&identity);
            match forward("chat-claim", &claim, Duration::from_secs(20)) {
                Ok(reply) if reply.get("ok") == Some(&json!(true)) => {
                    print(&reply);
                    return ExitCode::SUCCESS;
                }
                Ok(_) => {} // e.g. cancelled meanwhile: keep waiting
                Err(error) => return forward_error(error),
            }
            continue;
        }
        match waiter_pid {
            Some(pid) if pid == me => {}
            Some(_) => return fail_line("superseded", "다른 대기 명령이 펫과 연결되어 이 대기를 끝냈습니다."),
            None => {
                // The pet dropped this waiter (e.g. restarted): register again.
                if let Err(error) = forward("chat-wait", &identity, Duration::from_secs(20)) {
                    return forward_error(error);
                }
            }
        }
        if Instant::now() > deadline {
            return fail_line("wait-timeout", "펫에서 '제작 시작'을 기다리다 시간이 지났습니다.");
        }
    }
}

/// `ask`: the chat stops at a decision point. Blocks inside the chat's turn
/// until the user answers in the pet, then prints the answer (once).
/// Asking the same question again re-attaches to it (no second question).
pub fn cli_ask(args: &[String]) -> ExitCode {
    let Some(thread) = chat_thread(args) else {
        return fail_line("no-chat", "CODEX_THREAD_ID가 없어 어느 Codex 채팅인지 알 수 없습니다.");
    };
    let Some(task) = crate::flag(args, "--task").filter(|t| safe_token(t)) else {
        return fail_line("invalid-argument", "--task <작업 ID>가 필요합니다.");
    };
    let Some(file) = crate::flag(args, "--file") else {
        return fail_line("invalid-argument", "--file <질문 JSON 파일>이 필요합니다.");
    };
    let file = std::env::current_dir().map(|cwd| cwd.join(&file)).unwrap_or_else(|_| PathBuf::from(&file));
    let file = fs::canonicalize(&file).unwrap_or(file);
    let file = file.to_string_lossy().trim_start_matches(r"\\?\").to_owned();
    if file.contains('|') {
        return fail_line("invalid-argument", "질문 파일 경로에 '|' 문자를 쓸 수 없습니다.");
    }
    let timeout = crate::flag(args, "--timeout")
        .and_then(|t| t.parse::<u64>().ok())
        .unwrap_or(WAIT_DEFAULT_SECS)
        .clamp(10, 2 * 60 * 60);
    let me = std::process::id().to_string();
    let base = vec!["--task".to_owned(), task.clone(), "--thread".to_owned(), thread.clone()];
    let mut register = base.clone();
    register.extend(["--pid".to_owned(), me, "--file".to_owned(), file]);
    let (question, delivered, pet_pid) = match forward("chat-ask", &register, Duration::from_secs(20)) {
        Ok(reply) if reply.get("ok") == Some(&json!(true)) => {
            let id = reply.get("questionId").and_then(Value::as_str).unwrap_or("").to_owned();
            let delivered = reply.get("state").and_then(Value::as_str) == Some("delivered");
            (id, delivered, read_state().and_then(|s| s.get("petPid").and_then(Value::as_u64)).unwrap_or(0) as u32)
        }
        Ok(reply) => return fail_line("refused", reply.get("message").and_then(Value::as_str).unwrap_or("펫이 질문을 받지 않았습니다.")),
        Err(error) => return forward_error(error),
    };
    if !safe_token(&question) {
        return fail_line("refused", "펫이 질문 ID를 돌려주지 않았습니다.");
    }
    let mut resume = base;
    resume.extend(["--question".to_owned(), question.clone()]);
    let deadline = Instant::now() + Duration::from_secs(timeout);
    loop {
        let state = read_state().unwrap_or(Value::Null);
        let current = state.get("task").filter(|t| t.get("id").and_then(Value::as_str) == Some(task.as_str()));
        let Some(current) = current else {
            return fail_line("task-ended", "펫에서 이 작업이 없어졌습니다(펫이 다시 시작되었거나 작업이 끝났습니다).");
        };
        if current.get("state").and_then(Value::as_str) == Some("finished") {
            return fail_line("task-ended", "이 작업은 펫에서 이미 끝났습니다.");
        }
        let checkpoint = current.get("checkpoint").filter(|c| c.get("id").and_then(Value::as_str) == Some(question.as_str()));
        let state = if delivered { Some("delivered") } else { checkpoint.and_then(|c| c.get("state")).and_then(Value::as_str) };
        match state {
            Some("answered" | "delivered") => {
                return match forward("chat-resume", &resume, Duration::from_secs(20)) {
                    Ok(reply) => {
                        print(&reply);
                        if reply.get("ok") == Some(&json!(true)) {
                            ExitCode::SUCCESS
                        } else {
                            ExitCode::from(1)
                        }
                    }
                    Err(error) => forward_error(error),
                };
            }
            Some("pending") => {}
            _ => return fail_line("question-cancelled", "펫에서 이 질문이 취소되었습니다."),
        }
        if pet_pid != 0 && !process_alive(pet_pid) {
            return fail_line("pet-closed", "펫이 닫혀서 질문 대기를 끝냈습니다.");
        }
        if Instant::now() > deadline {
            print(&json!({
                "ok": false,
                "state": "ask-timeout",
                "questionId": question,
                "message": "사용자가 아직 펫에서 답하지 않았습니다. 질문은 펫에 그대로 남아 있습니다. 결과를 만들지 말고 같은 ask 명령을 다시 실행해 계속 기다리세요.",
            }));
            return ExitCode::from(1);
        }
        thread::sleep(Duration::from_millis(400));
    }
}

/// `done` / `fail`: the chat reports the task's end; prints the pet's verdict.
pub fn cli_report(args: &[String], failed: bool) -> ExitCode {
    let Some(thread) = chat_thread(args) else {
        return fail_line("no-chat", "CODEX_THREAD_ID가 없어 어느 Codex 채팅인지 알 수 없습니다.");
    };
    let Some(task) = crate::flag(args, "--task").filter(|t| safe_token(t)) else {
        return fail_line("invalid-argument", "--task <작업 ID>가 필요합니다.");
    };
    let mut extra = vec!["--task".to_owned(), task, "--thread".to_owned(), thread];
    if failed {
        // '|' separates arguments in the single-instance forward.
        let reason: String = crate::flag(args, "--reason").unwrap_or_default().chars().filter(|c| !c.is_control()).map(|c| if c == '|' { '/' } else { c }).take(300).collect();
        extra.extend(["--reason".to_owned(), reason]);
    }
    match forward(if failed { "chat-fail" } else { "chat-done" }, &extra, Duration::from_secs(90)) {
        Ok(reply) => {
            print(&reply);
            if reply.get("ok") == Some(&json!(true)) {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        Err(error) => forward_error(error),
    }
}
