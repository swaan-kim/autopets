//! "현재 채팅에서 계속하기": hand a confirmed pet start request to the Codex chat
//! that ran `$autopets` (the setup chat), through Codex's own `codex queue` CLI.
//!
//! `codex queue --thread <id> --message <text>` stores the message in Codex's
//! shared queue for that exact thread. The Codex app server that has the chat
//! loaded (Codex Desktop) picks it up, waits for a running turn to finish and
//! starts it in the same thread as a user message. No new thread is created
//! and no other process runs the turn. Acceptance by the queue is not
//! execution: `delivery_status` only reports "started" once the chat's own
//! history shows the message as a user turn.
use crate::application::store::SharedStore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, OnceLock},
    time::{Duration, Instant},
};

// Far below the Windows command line limit (32767 UTF-16 units).
const MAX_REQUEST_BYTES: usize = 8000;
const DELIVERIES: &str = "codex-chat-deliveries-v1.json";
const KEEP_DELIVERIES: usize = 50;

static SENDING: AtomicBool = AtomicBool::new(false);
struct Sending;
impl Drop for Sending {
    fn drop(&mut self) { SENDING.store(false, Ordering::Release); }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatDelivery {
    /// "queued": Codex's queue accepted the message for this thread. Not execution.
    status: &'static str,
    thread_id: String,
    queued_id: String,
    sent_at: u64,
    /// The app asked Windows to show this exact chat (`codex://threads/<id>`).
    chat_opened: bool,
}

/// Only the request hash is kept, never the request text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Record { thread_id: String, request_sha256: String, queued_id: String, sent_at: u64 }

pub(crate) fn validate_request(pet_id: &str, revision: u64, prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty() || prompt.chars().any(|c| c.is_control() && c != '\n')
        || !prompt.contains(&format!("petId={pet_id}, petRevision={revision}")) {
        return Err("invalid-start-request".into());
    }
    if prompt.len() > MAX_REQUEST_BYTES { return Err("request-too-long".into()); }
    Ok(())
}

fn request_hash(prompt: &str) -> String { format!("{:x}", Sha256::digest(prompt.as_bytes())) }

fn read_records(data_dir: &Path) -> Vec<Record> {
    std::fs::read(data_dir.join(DELIVERIES)).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn write_records(data_dir: &Path, records: &[Record]) -> Result<(), String> {
    let start = records.len().saturating_sub(KEEP_DELIVERIES);
    let temporary = data_dir.join(format!("codex-chat-deliveries-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, serde_json::to_vec(&records[start..]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, data_dir.join(DELIVERIES)).map_err(|e| e.to_string())
}

fn previous_delivery(data_dir: &Path, thread_id: &str, prompt: &str) -> Option<Record> {
    let hash = request_hash(prompt);
    read_records(data_dir).into_iter().rev().find(|r| r.thread_id == thread_id && r.request_sha256 == hash)
}

/// The successful CLI line is "Queued message <queued id> for thread <thread id>."
pub(crate) fn parse_queued(stdout: &str, thread_id: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("Queued message ")?;
        let (queued, thread) = rest.split_once(" for thread ")?;
        (thread.trim_end_matches('.') == thread_id && !queued.is_empty() && !queued.contains(char::is_whitespace))
            .then(|| queued.to_string())
    })
}

pub(crate) fn classify_failure(stderr: &str) -> &'static str {
    if stderr.contains("no rollout found") || stderr.contains("failed to read thread") { "codex-chat-not-found" }
    else if stderr.contains("does not support thread/queue") || stderr.contains("unrecognized subcommand") { "codex-queue-unsupported" }
    else if stderr.contains("ephemeral thread") { "codex-chat-not-found" }
    else { "codex-queue-failed" }
}

/// The CLI bundled with Codex Desktop, so the queue format matches the app
/// server that runs the chat. AUTOPETS_CODEX_EXE overrides it for testing.
fn find_codex() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("AUTOPETS_CODEX_EXE").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(path);
    }
    static DESKTOP: OnceLock<Option<PathBuf>> = OnceLock::new();
    if let Some(path) = DESKTOP.get_or_init(desktop_codex).clone() { return Some(path); }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|directory| directory.join(if cfg!(windows) { "codex.exe" } else { "codex" }))
        .find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn desktop_codex() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command",
            "(Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation"])
        .stdin(Stdio::null()).stderr(Stdio::null()).creation_flags(0x0800_0000).output().ok()?;
    let location = String::from_utf8(output.stdout).ok()?;
    let path = PathBuf::from(location.trim()).join("app").join("resources").join("codex.exe");
    path.is_file().then_some(path)
}

#[cfg(not(windows))]
fn desktop_codex() -> Option<PathBuf> { None }

fn run_queue(codex: &Path, thread_id: &str, cwd: &str, prompt: &str) -> Result<String, String> {
    let mut command = Command::new(codex);
    command.args(["queue", "--thread", thread_id, "--message", prompt])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if Path::new(cwd).is_dir() { command.current_dir(cwd); }
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|_| "codex-cli-unavailable")?;
    let (mut out, mut err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let readers = (std::thread::spawn(move || { let mut s = String::new(); let _ = out.read_to_string(&mut s); s }),
        std::thread::spawn(move || { let mut s = String::new(); let _ = err.read_to_string(&mut s); s }));
    let deadline = Instant::now() + Duration::from_secs(60);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "codex-queue-failed")? { break status; }
        if Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            // The message may still have been queued; the UI must not retry blindly.
            return Err("codex-queue-timeout".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let stdout = readers.0.join().unwrap_or_default();
    let stderr = readers.1.join().unwrap_or_default();
    if !status.success() { return Err(classify_failure(&stderr).into()); }
    parse_queued(&stdout, thread_id).ok_or_else(|| "codex-queue-unconfirmed".into())
}

/// The exact saved pet revision, a valid request, and the chat the UI showed must
/// still be the current setup chat. Another chat is never chosen in its place.
pub(crate) fn check_target(store: &crate::application::store::Store, pet_id: &str, expected_revision: u64,
    prompt: &str, thread_id: &str, cwd: &str) -> Result<(), String> {
    let pet = store.saved_pet(pet_id)?.ok_or("saved-pet-not-found")?;
    if pet.revision != expected_revision { return Err("saved-pet-revision-changed".into()); }
    validate_request(&pet.id, pet.revision, prompt)?;
    let setup = store.setup_chat().ok_or("setup-chat-unavailable")?;
    if setup.source_id != crate::domain::connections::CODEX_LOCAL || setup.thread_id != thread_id || setup.cwd != cwd {
        return Err("setup-chat-changed".into());
    }
    // codex://threads/<id> needs an exact local UUID; checked before sending.
    crate::platform::task_return::task_uri(thread_id, cwd).map(|_| ())
}

/// Send the confirmed request to the chat that ran `$autopets`. The UI passes the
/// chat it showed; it must still be the current setup chat, so a request is never
/// redirected to another chat. Nothing falls back to a new chat.
#[tauri::command]
pub(crate) async fn continue_pet_in_codex_chat(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, SharedStore>,
    pet_id: String,
    expected_revision: u64,
    prompt: String,
    thread_id: String,
    cwd: String,
) -> Result<ChatDelivery, String> {
    crate::platform::connection_setup::require_manager(window.label())?;
    let store = store.inner().clone();
    let data_dir = {
        let current = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        check_target(&current, &pet_id, expected_revision, &prompt, &thread_id, &cwd)?;
        current.data_dir.clone()
    };
    if SENDING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("delivery-in-progress".into());
    }
    let _sending = Sending;
    if previous_delivery(&data_dir, &thread_id, &prompt).is_some() { return Err("already-delivered".into()); }
    let worker = (thread_id.clone(), cwd.clone(), prompt.clone());
    let queued_id = tauri::async_runtime::spawn_blocking(move || {
        let codex = find_codex().ok_or("codex-cli-unavailable")?;
        run_queue(&codex, &worker.0, &worker.1, &worker.2)
    }).await.map_err(|_| "codex-queue-failed")??;
    let sent_at = crate::domain::activity::now_ms();
    let mut records = read_records(&data_dir);
    records.push(Record { thread_id: thread_id.clone(), request_sha256: request_hash(&prompt), queued_id: queued_id.clone(), sent_at });
    // The queue already accepted it; a failed local record only weakens duplicate protection.
    let _ = write_records(&data_dir, &records);
    let uri = crate::platform::task_return::task_uri(&thread_id, &cwd)?;
    let chat_opened = crate::platform::task_return::dispatch(&thread_id, &uri).is_ok();
    Ok(ChatDelivery { status: "queued", thread_id, queued_id, sent_at, chat_opened })
}

fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME").map(PathBuf::from)
        .or_else(|| std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|home| PathBuf::from(home).join(".codex")))
}

fn find_rollout(sessions: &Path, thread_id: &str) -> Option<PathBuf> {
    let suffix = format!("-{thread_id}.jsonl");
    let mut stack = vec![(sessions.to_path_buf(), 0)];
    while let Some((directory, depth)) = stack.pop() {
        for entry in std::fs::read_dir(&directory).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() && depth < 4 { stack.push((path, depth + 1)); }
            else if path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("rollout-") && n.ends_with(&suffix)) {
                return Some(path);
            }
        }
    }
    None
}

/// True once the chat's own history records this exact text as a user message
/// that started at or after `sent_at`.
pub(crate) fn rollout_started(rollout: &Path, prompt: &str, sent_at: u64) -> bool {
    let Ok(mut file) = std::fs::File::open(rollout) else { return false };
    let length = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = length.saturating_sub(2 * 1024 * 1024);
    if file.seek(SeekFrom::Start(start)).is_err() { return false; }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() { return false; }
    let text = String::from_utf8_lossy(&bytes);
    let wanted = prompt.trim();
    text.lines().filter(|line| line.contains("\"item_completed\"") && line.contains("UserMessage")).any(|line| {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else { return false };
        let payload = &value["payload"];
        if payload["type"] != "item_completed" || payload["item"]["type"] != "UserMessage" { return false; }
        if payload["started_at_ms"].as_u64().is_some_and(|at| at + 2000 < sent_at) { return false; }
        let body: String = payload["item"]["content"].as_array().into_iter().flatten()
            .filter_map(|part| part["text"].as_str()).collect();
        body.trim() == wanted
    })
}

/// "started" when the chat began the delivered request, "waiting" while it is
/// only queued (for example the chat is busy or not open in Codex), "unknown"
/// when the chat history cannot be read. Never reports completion.
#[tauri::command]
pub(crate) async fn codex_chat_delivery_status(thread_id: String, prompt: String, sent_at: u64) -> Result<&'static str, String> {
    uuid::Uuid::parse_str(&thread_id).map_err(|_| "invalid-thread")?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(sessions) = codex_home().map(|home| home.join("sessions")) else { return "unknown" };
        let Some(rollout) = find_rollout(&sessions, &thread_id) else { return "unknown" };
        if rollout_started(&rollout, &prompt, sent_at) { "started" } else { "waiting" }
    }).await.map_err(|_| "status-unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const PET: &str = "b5850a8e-b572-496b-b254-7f4687fcf75f";
    const THREAD: &str = "0b0b0b0b-1111-4222-8333-444444444441";

    #[test]
    fn request_must_name_the_exact_pet_and_stay_bounded() {
        let prompt = format!("AutoPets 스킬로 현재 채팅에 여행 펫을 연결해줘. 저장한 펫: petId={PET}, petRevision=2.\n부산 1박 2일");
        assert!(validate_request(PET, 2, &prompt).is_ok());
        assert_eq!(validate_request(PET, 3, &prompt).unwrap_err(), "invalid-start-request");
        assert_eq!(validate_request(PET, 2, &format!("{prompt}\u{7}")).unwrap_err(), "invalid-start-request");
        assert_eq!(validate_request(PET, 2, "  ").unwrap_err(), "invalid-start-request");
        assert_eq!(validate_request(PET, 2, &format!("{prompt}{}", "가".repeat(3000))).unwrap_err(), "request-too-long");
    }

    #[test]
    fn only_the_cli_confirmation_for_the_same_thread_counts() {
        let out = format!("Queued message 01a1cd6e-bebb-7900-9fe3-499b7a84b1aa for thread {THREAD}.\n");
        assert_eq!(parse_queued(&out, THREAD).as_deref(), Some("01a1cd6e-bebb-7900-9fe3-499b7a84b1aa"));
        assert_eq!(parse_queued(&out, "0b0b0b0b-1111-4222-8333-444444444442"), None);
        assert_eq!(parse_queued("", THREAD), None);
        assert_eq!(parse_queued("Warning: message was queued", THREAD), None);
    }

    #[test]
    fn cli_failures_map_to_stable_reasons() {
        assert_eq!(classify_failure("Error: failed to queue session message: thread/queue/add failed: failed to read thread: invalid thread-store request: no rollout found for thread id x"), "codex-chat-not-found");
        assert_eq!(classify_failure("x: does not support thread/queue/add; update or restart the app"), "codex-queue-unsupported");
        assert_eq!(classify_failure("error: unrecognized subcommand 'queue'"), "codex-queue-unsupported");
        assert_eq!(classify_failure("anything else"), "codex-queue-failed");
    }

    #[test]
    fn duplicate_records_keep_only_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let prompt = "petId=x, petRevision=1 부산";
        assert!(previous_delivery(dir.path(), THREAD, prompt).is_none());
        write_records(dir.path(), &[Record { thread_id: THREAD.into(), request_sha256: request_hash(prompt), queued_id: "q".into(), sent_at: 1 }]).unwrap();
        assert!(previous_delivery(dir.path(), THREAD, prompt).is_some());
        assert!(previous_delivery(dir.path(), "0b0b0b0b-1111-4222-8333-444444444442", prompt).is_none());
        assert!(previous_delivery(dir.path(), THREAD, "다른 요청").is_none());
        let saved = std::fs::read_to_string(dir.path().join(DELIVERIES)).unwrap();
        assert!(!saved.contains("부산"));
        let many: Vec<_> = (0..80).map(|i| Record { thread_id: THREAD.into(), request_sha256: format!("{i}"), queued_id: "q".into(), sent_at: i }).collect();
        write_records(dir.path(), &many).unwrap();
        assert_eq!(read_records(dir.path()).len(), KEEP_DELIVERIES);
    }

    fn setup(store: &mut crate::application::store::Store, thread: &str, cwd: &str) {
        store.begin_setup(crate::application::setup::SetupRequest { installed_version: env!("CARGO_PKG_VERSION").into(),
            session_id: Some(thread.into()), cwd: Some(cwd.into()), host_id: Some("codex-windows-local".into()),
            entry_point: Some("ai".into()), connection_mode: Some("explicit-pet".into()) }).unwrap();
    }

    #[test]
    fn only_the_current_setup_chat_can_receive_the_request() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let mut store = crate::application::store::Store::new(dir.path()).unwrap();
        let template: crate::domain::roles::Template = serde_json::from_str(include_str!("../../../../../packages/contracts/data/ui-pet.json")).unwrap();
        let pet = store.save_pet(None, 0, template).unwrap();
        let prompt = format!("AutoPets 스킬로 현재 채팅에 펫을 연결해줘. 저장한 펫: petId={}, petRevision={}.\n부산 1박 2일", pet.id, pet.revision);
        // No `$autopets` chat yet: nothing is sent and no other chat is guessed.
        assert_eq!(check_target(&store, &pet.id, pet.revision, &prompt, THREAD, &cwd).unwrap_err(), "setup-chat-unavailable");
        assert_eq!(store.setup_status().unwrap()["setupChat"], serde_json::Value::Null);
        setup(&mut store, THREAD, &cwd);
        assert_eq!(store.setup_status().unwrap()["setupChat"]["threadId"], THREAD);
        assert!(check_target(&store, &pet.id, pet.revision, &prompt, THREAD, &cwd).is_ok());
        assert_eq!(check_target(&store, &pet.id, pet.revision + 1, &prompt, THREAD, &cwd).unwrap_err(), "saved-pet-revision-changed");
        assert_eq!(check_target(&store, &pet.id, pet.revision, "다른 요청", THREAD, &cwd).unwrap_err(), "invalid-start-request");
        assert_eq!(check_target(&store, &pet.id, pet.revision, &prompt, THREAD, "C:\\other").unwrap_err(), "setup-chat-changed");
        // `$autopets` ran in chat B meanwhile: the request shown for chat A is refused.
        let other = "0b0b0b0b-1111-4222-8333-444444444442";
        setup(&mut store, other, &cwd);
        assert_eq!(check_target(&store, &pet.id, pet.revision, &prompt, THREAD, &cwd).unwrap_err(), "setup-chat-changed");
        assert!(check_target(&store, &pet.id, pet.revision, &prompt, other, &cwd).is_ok());
        // Disconnecting removes the target instead of falling back to another chat.
        store.disconnect_setup("codex-windows-local").unwrap();
        assert_eq!(check_target(&store, &pet.id, pet.revision, &prompt, other, &cwd).unwrap_err(), "setup-chat-unavailable");
        assert_eq!(store.setup_status().unwrap()["setupChat"], serde_json::Value::Null);
    }

    /// Opt-in: real `codex.exe` against an isolated CODEX_HOME. A stand-in app
    /// server loads a thread; `run_queue` must queue to it and the stand-in must
    /// start the request in that same thread. No account is used (the model call
    /// fails), so only queue acceptance and the user turn are checked.
    /// AUTOPETS_CODEX_EXE=<codex.exe> cargo test codex_queue_reaches -- --ignored
    #[test]
    #[ignore]
    fn codex_queue_reaches_the_loaded_thread_in_isolation() {
        use std::io::{BufRead, BufReader, Write};
        let codex = PathBuf::from(std::env::var("AUTOPETS_CODEX_EXE").expect("AUTOPETS_CODEX_EXE"));
        let home = tempfile::tempdir().unwrap();
        let work = home.path().join("work");
        std::fs::create_dir_all(&work).unwrap();
        std::env::set_var("CODEX_HOME", home.path());
        let mut server = Command::new(&codex).arg("app-server").env("CODEX_HOME", home.path()).current_dir(&work)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        let mut input = server.stdin.take().unwrap();
        let (sender, lines) = std::sync::mpsc::channel::<serde_json::Value>();
        let output = server.stdout.take().unwrap();
        std::thread::spawn(move || for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str(&line) { let _ = sender.send(value); }
        });
        let mut call = |id: u64, method: &str, params: serde_json::Value| {
            writeln!(input, "{}", serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})).unwrap();
            loop { let m = lines.recv_timeout(Duration::from_secs(30)).unwrap(); if m["id"] == id && m.get("method").is_none() { break m; } }
        };
        call(1, "initialize", serde_json::json!({"clientInfo":{"name":"autopets-test","version":"0"},"capabilities":{"experimentalApi":true}}));
        let thread = call(2, "thread/start", serde_json::json!({"cwd": work, "ephemeral": false}))["result"]["thread"]["id"].as_str().unwrap().to_string();
        call(3, "thread/inject_items", serde_json::json!({"threadId": thread, "items": [{"type":"message","role":"user","content":[{"type":"input_text","text":"earlier context"}]}]}));
        let prompt = "AutoPets 시험 요청 \"따옴표\" & 줄바꿈\n부산 1박 2일";
        let sent_at = crate::domain::activity::now_ms();
        assert_eq!(run_queue(&codex, "0b0b0b0b-1111-4222-8333-444444444449", &work.to_string_lossy(), prompt).unwrap_err(), "codex-chat-not-found");
        let queued = run_queue(&codex, &thread, &work.to_string_lossy(), prompt).unwrap();
        assert!(!queued.is_empty());
        let rollout = find_rollout(&home.path().join("sessions"), &thread).unwrap();
        let deadline = Instant::now() + Duration::from_secs(60);
        while !rollout_started(&rollout, prompt, sent_at) {
            assert!(Instant::now() < deadline, "queued request did not start in the same thread");
            std::thread::sleep(Duration::from_millis(500));
        }
        let threads = std::fs::read_dir(rollout.parent().unwrap()).unwrap().count();
        assert_eq!(threads, 1, "no other thread may be created");
        let _ = server.kill();
    }

    #[test]
    fn started_needs_the_same_text_after_sending() {
        let dir = tempfile::tempdir().unwrap();
        let day = dir.path().join("2026").join("11").join("12");
        std::fs::create_dir_all(&day).unwrap();
        let rollout = day.join(format!("rollout-2026-11-12T10-00-00-{THREAD}.jsonl"));
        let line = |text: &str, at: u64| serde_json::json!({"type":"event_msg","payload":{"type":"item_completed","thread_id":THREAD,
            "item":{"type":"UserMessage","id":"u","content":[{"type":"text","text":text,"text_elements":[]}]},"started_at_ms":at}}).to_string();
        std::fs::write(&rollout, format!("{}\n{}\n", line("이전 요청", 10_000), line("부산 1박\n2일", 50_000))).unwrap();
        assert_eq!(find_rollout(dir.path(), THREAD).as_deref(), Some(rollout.as_path()));
        assert!(find_rollout(dir.path(), "0b0b0b0b-1111-4222-8333-444444444442").is_none());
        assert!(rollout_started(&rollout, "부산 1박\n2일", 49_000));
        assert!(!rollout_started(&rollout, "부산 1박\n2일", 60_000));
        assert!(!rollout_started(&rollout, "이전 요청", 49_000));
        assert!(!rollout_started(&rollout, "다른 요청", 0));
    }
}
