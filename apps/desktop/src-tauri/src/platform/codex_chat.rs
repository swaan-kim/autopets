//! Sending a request the user pressed a button for straight into a Codex chat, through Codex's
//! own `codex queue` CLI. Used by the pet screen's start, the floating pet's start card, the
//! 복습 도우미 menu and the 문제 묶음 pages (`codex_send.rs`).
//!
//! `codex queue --thread <id> --message <text>` stores the message in Codex's shared queue for
//! that exact thread. The Codex app server that has the chat loaded (Codex Desktop) picks it up
//! within about 9 seconds, waits for a running turn to finish and starts it in the same thread as
//! a user message. A chat that is not loaded keeps the message until it is opened, so the app opens
//! the chat right after queueing. No new thread is created and no other process runs the turn.
//! Acceptance by the queue is not execution: `codex_send_status` only reports "started" once the
//! chat's own history shows the message as a user turn.
//!
//! When the queue cannot be used (no CLI, an old Codex, a failure) the request is typed into the
//! same chat's composer instead and the user presses send. A queue call that did not answer in
//! time may still have queued the message, so it is never typed in as well.
use crate::application::store::SharedStore;
use crate::domain::pet_link::Target;
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
/// The same start request to the same chat within this time is a repeated press, not a new start.
pub(crate) const START_REPEAT_MS: u64 = 10 * 60_000;
/// 복습 requests are the same words every time; only a quick repeat is refused, so tomorrow's works.
pub(crate) const REVIEW_REPEAT_MS: u64 = 30_000;

static SENDING: AtomicBool = AtomicBool::new(false);
struct Sending;
impl Drop for Sending {
    fn drop(&mut self) { SENDING.store(false, Ordering::Release); }
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Delivery {
    /// "queued": Codex's queue accepted it for this chat (sent; not yet started).
    /// "unconfirmed": the queue did not answer in time. It may have been queued, so nothing is typed in.
    /// "filled": it could not be sent; it was typed into that chat's composer instead (`reason`).
    /// "new-chat": no chat to send to; a new Codex chat opened with it typed in.
    /// "copy": too long for a link; `text` is the request for the clipboard.
    pub(crate) outcome: &'static str,
    /// For `codex_send_status` ("queued" and "unconfirmed").
    pub(crate) id: Option<String>,
    pub(crate) thread_id: Option<String>,
    pub(crate) sent_at: u64,
    /// The app asked Windows to show this exact chat (`codex://threads/<id>`).
    pub(crate) chat_opened: bool,
    pub(crate) reason: Option<String>,
    pub(crate) text: Option<String>,
}

/// Only the request hash is kept, never the request text. `queued_id` is empty from just before the
/// queue call until Codex confirms it, so a press after a timeout still counts as a repeat.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default)]
    id: String,
    thread_id: String,
    request_sha256: String,
    queued_id: String,
    sent_at: u64,
}

pub(crate) fn validate_request(pet_id: &str, revision: u64, prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty() || prompt.chars().any(|c| c.is_control() && c != '\n')
        || !prompt.contains(&format!("petId={pet_id}, petRevision={revision}")) {
        return Err("invalid-start-request".into());
    }
    if prompt.len() > MAX_REQUEST_BYTES { return Err("request-too-long".into()); }
    Ok(())
}

fn request_hash(text: &str) -> String { format!("{:x}", Sha256::digest(text.trim().as_bytes())) }

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

fn recent_delivery(data_dir: &Path, thread_id: &str, text: &str, window_ms: u64, now: u64) -> Option<Record> {
    let hash = request_hash(text);
    read_records(data_dir).into_iter().rev()
        .find(|r| r.thread_id == thread_id && r.request_sha256 == hash && now.saturating_sub(r.sent_at) < window_ms)
}

fn update_record(data_dir: &Path, id: &str, change: impl FnOnce(&mut Vec<Record>)) {
    let mut records = read_records(data_dir);
    if !records.iter().any(|r| r.id == id) { return; }
    change(&mut records);
    let _ = write_records(data_dir, &records);
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

/// The queue may have taken the message even though the CLI did not confirm it.
pub(crate) fn maybe_queued(reason: &str) -> bool { matches!(reason, "codex-queue-timeout" | "codex-queue-unconfirmed") }

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
            // The message may still have been queued: never typed in or sent again.
            return Err("codex-queue-timeout".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let stdout = readers.0.join().unwrap_or_default();
    let stderr = readers.1.join().unwrap_or_default();
    if !status.success() { return Err(classify_failure(&stderr).into()); }
    parse_queued(&stdout, thread_id).ok_or_else(|| "codex-queue-unconfirmed".into())
}

/// The chats a request may go to: the chat that ran `$autopets`, or a chat a pet is connected to.
/// The UI passes the chat it showed; anything else is refused, never swapped for another chat.
pub(crate) fn allowed_chat(store: &crate::application::store::Store, thread_id: &str, cwd: &str) -> Result<Target, String> {
    let local = crate::domain::connections::CODEX_LOCAL;
    let setup = store.setup_chat().filter(|chat| chat.source_id == local && chat.thread_id == thread_id && chat.cwd == cwd);
    let linked = || store.pet_links.values()
        .find(|l| l.connected && l.target.source_id == local && l.target.thread_id == thread_id && l.target.cwd == cwd)
        .map(|l| l.target.clone());
    let chat = setup.or_else(linked).ok_or("target-chat-changed")?;
    // codex://threads/<id> needs an exact local UUID; checked before sending.
    crate::platform::task_return::task_uri(&chat.thread_id, &chat.cwd)?;
    Ok(chat)
}

/// A chat a new start may go to instead of a new Codex chat: the chat that ran `$autopets`, or a
/// connected chat whose pet is switched on and has no unfinished task.
pub(crate) fn has_ready_chat(store: &crate::application::store::Store) -> bool {
    let local = crate::domain::connections::CODEX_LOCAL;
    store.setup_chat().is_some_and(|chat| chat.source_id == local)
        || store.pet_links.values().any(|l| l.connected && l.enabled && l.target.source_id == local
            && !l.run.as_ref().is_some_and(crate::domain::pet_link::Run::unresolved))
}

/// Sends `text` (built by the app, never by the screen) to `chat`, which the caller has checked:
/// Codex's queue first, then the chat opens. One request at a time; a repeat of the same text to
/// the same chat within `repeat_ms` is refused. Falls back to typing it into the chat's composer.
pub(crate) async fn deliver(data_dir: PathBuf, chat: Target, text: String, repeat_ms: u64) -> Result<Delivery, String> {
    let uri = crate::platform::task_return::task_uri(&chat.thread_id, &chat.cwd)?;
    if text.trim().is_empty() || text.chars().any(|c| c.is_control() && c != '\n') { return Err("invalid-request".into()); }
    if text.len() > MAX_REQUEST_BYTES { return Err("request-too-long".into()); }
    if SENDING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("delivery-in-progress".into());
    }
    let _sending = Sending;
    let now = crate::domain::activity::now_ms();
    if recent_delivery(&data_dir, &chat.thread_id, &text, repeat_ms, now).is_some() { return Err("already-delivered".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    let mut records = read_records(&data_dir);
    records.push(Record { id: id.clone(), thread_id: chat.thread_id.clone(), request_sha256: request_hash(&text), queued_id: String::new(), sent_at: now });
    // Without this record a press after a timeout could send twice, so nothing is sent without it.
    write_records(&data_dir, &records).map_err(|_| "delivery-record-failed")?;
    let worker = (chat.thread_id.clone(), chat.cwd.clone(), text.clone());
    let queued = tauri::async_runtime::spawn_blocking(move || {
        let codex = find_codex().ok_or("codex-cli-unavailable")?;
        run_queue(&codex, &worker.0, &worker.1, &worker.2)
    }).await.unwrap_or_else(|_| Err("codex-queue-failed".into()));
    match queued {
        Ok(queued_id) => {
            update_record(&data_dir, &id, |records| if let Some(r) = records.iter_mut().find(|r| r.id == id) { r.queued_id = queued_id });
            let chat_opened = crate::platform::task_return::dispatch(&chat.thread_id, &uri).is_ok();
            Ok(Delivery { outcome: "queued", id: Some(id), thread_id: Some(chat.thread_id), sent_at: now, chat_opened, ..Default::default() })
        }
        Err(reason) if maybe_queued(&reason) => {
            let chat_opened = crate::platform::task_return::dispatch(&chat.thread_id, &uri).is_ok();
            Ok(Delivery { outcome: "unconfirmed", id: Some(id), thread_id: Some(chat.thread_id), sent_at: now, chat_opened, reason: Some(reason), ..Default::default() })
        }
        Err(reason) => {
            // Not queued: forget the record so the composer fallback (and a later press) is not blocked.
            update_record(&data_dir, &id, |records| records.retain(|r| r.id != id));
            fill(&chat, text, reason, now)
        }
    }
}

/// Types `text` into that chat's composer (`codex://threads/<id>?prompt=`); the user presses send.
fn fill(chat: &Target, text: String, reason: String, now: u64) -> Result<Delivery, String> {
    match crate::platform::pet_preferences::codex_chat_uri(&chat.thread_id, &chat.cwd, &text) {
        Ok(uri) => {
            crate::platform::pet_preferences::shell_open(&uri).map_err(|_| "Codex 앱을 열지 못했어요. Codex 앱이 설치돼 있는지 확인해 주세요.")?;
            Ok(Delivery { outcome: "filled", thread_id: Some(chat.thread_id.clone()), sent_at: now, chat_opened: true, reason: Some(reason), ..Default::default() })
        }
        Err(error) if error == "prompt-too-long" =>
            Ok(Delivery { outcome: "copy", thread_id: Some(chat.thread_id.clone()), sent_at: now, reason: Some(reason), text: Some(text), ..Default::default() }),
        Err(error) => Err(error),
    }
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

/// True once the chat's own history records a user message with this text (compared by its
/// hash, the only thing the app keeps) that started at or after `sent_at`.
pub(crate) fn rollout_started(rollout: &Path, request_sha256: &str, sent_at: u64) -> bool {
    let Ok(mut file) = std::fs::File::open(rollout) else { return false };
    let length = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = length.saturating_sub(2 * 1024 * 1024);
    if file.seek(SeekFrom::Start(start)).is_err() { return false; }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() { return false; }
    let text = String::from_utf8_lossy(&bytes);
    text.lines().filter(|line| line.contains("\"item_completed\"") && line.contains("UserMessage")).any(|line| {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else { return false };
        let payload = &value["payload"];
        if payload["type"] != "item_completed" || payload["item"]["type"] != "UserMessage" { return false; }
        if payload["started_at_ms"].as_u64().is_some_and(|at| at + 2000 < sent_at) { return false; }
        let body: String = payload["item"]["content"].as_array().into_iter().flatten()
            .filter_map(|part| part["text"].as_str()).collect();
        request_hash(&body) == request_sha256
    })
}

/// "started" when the chat began the sent request, "waiting" while it is only queued (the chat
/// is busy, or not open in Codex yet), "unknown" when the delivery or the chat history cannot
/// be read. Never reports completion. Takes the delivery id only; the screen holds no request text.
#[tauri::command]
pub(crate) async fn codex_send_status(store: tauri::State<'_, SharedStore>, id: String) -> Result<&'static str, String> {
    let data_dir = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(record) = read_records(&data_dir).into_iter().find(|r| !r.id.is_empty() && r.id == id) else { return "unknown" };
        let Some(sessions) = codex_home().map(|home| home.join("sessions")) else { return "unknown" };
        let Some(rollout) = find_rollout(&sessions, &record.thread_id) else { return "unknown" };
        if rollout_started(&rollout, &record.request_sha256, record.sent_at) { "started" } else { "waiting" }
    }).await.map_err(|_| "status-unavailable".into())
}

/// Codex's own name for each chat, so the app can say which chat a pet uses
/// instead of an id. Codex appends `{"id", "thread_name"}` to
/// `session_index.jsonl` and a rename appends again, so the last line per id
/// wins. Unknown or unnamed chats are left out and the UI shows the id.
/// Same bounds as the attention hook's `chatTitle`.
pub(crate) fn read_chat_titles(index: &Path, thread_ids: &[String]) -> std::collections::HashMap<String, String> {
    let mut titles = std::collections::HashMap::new();
    if thread_ids.is_empty() || std::fs::metadata(index).map_or(true, |m| m.len() > 8 * 1024 * 1024) { return titles; }
    let Ok(text) = std::fs::read_to_string(index) else { return titles };
    for line in text.lines() {
        let Some(id) = thread_ids.iter().find(|id| line.contains(id.as_str())) else { continue };
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if entry["id"].as_str() != Some(id.as_str()) { continue; }
        let Some(name) = entry["thread_name"].as_str() else { continue };
        let name: String = name.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().trim().chars().take(80).collect();
        if name.is_empty() { titles.remove(id); } else { titles.insert(id.clone(), name); }
    }
    titles
}

#[tauri::command]
pub(crate) async fn codex_chat_titles(thread_ids: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    let mut ids: Vec<String> = thread_ids.into_iter().filter(|id| uuid::Uuid::parse_str(id).is_ok()).collect();
    ids.sort();
    ids.dedup();
    ids.truncate(64);
    tauri::async_runtime::spawn_blocking(move || match codex_home() {
        Some(home) => read_chat_titles(&home.join("session_index.jsonl"), &ids),
        None => Default::default(),
    }).await.map_err(|_| "titles-unavailable".into())
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
    fn repeats_are_refused_only_inside_their_window_and_records_keep_only_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let prompt = "petId=x, petRevision=1 부산";
        let record = |id: &str, at: u64| Record { id: id.into(), thread_id: THREAD.into(), request_sha256: request_hash(prompt), queued_id: String::new(), sent_at: at };
        assert!(recent_delivery(dir.path(), THREAD, prompt, START_REPEAT_MS, 1_000).is_none());
        // Written before the queue call, with no queued id yet: a press after a timeout is a repeat.
        write_records(dir.path(), &[record("a", 1_000)]).unwrap();
        assert!(recent_delivery(dir.path(), THREAD, prompt, REVIEW_REPEAT_MS, 1_000 + 29_000).is_some(), "a quick second press");
        assert!(recent_delivery(dir.path(), THREAD, prompt, REVIEW_REPEAT_MS, 1_000 + 31_000).is_none(), "a review the next time is allowed");
        assert!(recent_delivery(dir.path(), THREAD, prompt, START_REPEAT_MS, 1_000 + 31_000).is_some(), "the same start a moment later is a repeat");
        assert!(recent_delivery(dir.path(), THREAD, &format!("  {prompt}\n"), REVIEW_REPEAT_MS, 2_000).is_some(), "compared trimmed");
        assert!(recent_delivery(dir.path(), "0b0b0b0b-1111-4222-8333-444444444442", prompt, START_REPEAT_MS, 2_000).is_none());
        assert!(recent_delivery(dir.path(), THREAD, "다른 요청", START_REPEAT_MS, 2_000).is_none());
        let saved = std::fs::read_to_string(dir.path().join(DELIVERIES)).unwrap();
        assert!(!saved.contains("부산"), "only the hash is stored");
        update_record(dir.path(), "a", |records| records.retain(|r| r.id != "a"));
        assert!(recent_delivery(dir.path(), THREAD, prompt, START_REPEAT_MS, 2_000).is_none(), "a failed send is forgotten");
        // Records written before ids existed still read.
        std::fs::write(dir.path().join(DELIVERIES), format!(r#"[{{"threadId":"{THREAD}","requestSha256":"{}","queuedId":"q","sentAt":5}}]"#, request_hash(prompt))).unwrap();
        assert_eq!(read_records(dir.path()).len(), 1);
        let many: Vec<_> = (0..80).map(|i| Record { id: format!("{i}"), thread_id: THREAD.into(), request_sha256: format!("{i}"), queued_id: "q".into(), sent_at: i }).collect();
        write_records(dir.path(), &many).unwrap();
        assert_eq!(read_records(dir.path()).len(), KEEP_DELIVERIES);
    }

    #[test]
    fn only_an_unanswered_queue_call_may_have_been_sent() {
        assert!(maybe_queued("codex-queue-timeout"));
        assert!(maybe_queued("codex-queue-unconfirmed"));
        for reason in ["codex-cli-unavailable", "codex-queue-unsupported", "codex-queue-failed", "codex-chat-not-found"] {
            assert!(!maybe_queued(reason), "{reason}: not queued, so the composer fallback is safe");
        }
    }

    fn setup(store: &mut crate::application::store::Store, thread: &str, cwd: &str) {
        store.begin_setup(crate::application::setup::SetupRequest { installed_version: env!("CARGO_PKG_VERSION").into(),
            session_id: Some(thread.into()), cwd: Some(cwd.into()), host_id: Some("codex-windows-local".into()),
            entry_point: Some("ai".into()), connection_mode: Some("explicit-pet".into()) }).unwrap();
    }

    #[test]
    fn only_the_calling_chat_or_a_connected_chat_can_receive_a_request() {
        use crate::domain::pet_link::{Request, Target as Chat};
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let mut store = crate::application::store::Store::new(dir.path()).unwrap();
        // No `$autopets` chat and no connected chat: nothing to send to, a new chat may open.
        assert_eq!(allowed_chat(&store, THREAD, &cwd).unwrap_err(), "target-chat-changed");
        assert!(!has_ready_chat(&store));
        setup(&mut store, THREAD, &cwd);
        assert_eq!(allowed_chat(&store, THREAD, &cwd).unwrap().thread_id, THREAD);
        assert!(has_ready_chat(&store));
        assert_eq!(allowed_chat(&store, THREAD, "C:\\other").unwrap_err(), "target-chat-changed");
        // `$autopets` ran in chat B meanwhile: the request shown for chat A is refused, not redirected.
        let other = "0b0b0b0b-1111-4222-8333-444444444442";
        setup(&mut store, other, &cwd);
        assert_eq!(allowed_chat(&store, THREAD, &cwd).unwrap_err(), "target-chat-changed");
        assert_eq!(allowed_chat(&store, other, &cwd).unwrap().thread_id, other);
        store.disconnect_setup("codex-windows-local").unwrap();
        assert_eq!(allowed_chat(&store, other, &cwd).unwrap_err(), "target-chat-changed");
        // A chat a pet is connected to may receive one, while it stays connected.
        let linked = Chat { source_id: "codex-windows-local".into(), thread_id: THREAD.into(), cwd: cwd.clone() };
        store.pet_link_request(Request::Connect { target: linked.clone() }).unwrap();
        assert_eq!(allowed_chat(&store, THREAD, &cwd).unwrap(), linked);
        assert!(has_ready_chat(&store));
        store.pet_links.get_mut(&linked.key()).unwrap().enabled = false;
        assert!(!has_ready_chat(&store), "a switched-off pet's chat is not chosen for a new start");
        store.pet_links.get_mut(&linked.key()).unwrap().connected = false;
        assert_eq!(allowed_chat(&store, THREAD, &cwd).unwrap_err(), "target-chat-changed");
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
        while !rollout_started(&rollout, &request_hash(prompt), sent_at) {
            assert!(Instant::now() < deadline, "queued request did not start in the same thread");
            std::thread::sleep(Duration::from_millis(500));
        }
        let threads = std::fs::read_dir(rollout.parent().unwrap()).unwrap().count();
        assert_eq!(threads, 1, "no other thread may be created");
        let _ = server.kill();
    }

    #[test]
    fn chat_titles_follow_the_latest_codex_name() {
        let dir = tempfile::tempdir().unwrap();
        let index = dir.path().join("session_index.jsonl");
        let other = "01a1e7db-90af-7ad1-8cdb-2be2eee3fc63";
        let lines = [
            format!(r#"{{"id":"{THREAD}","thread_name":"옛 이름"}}"#),
            format!(r#"{{"id":"{other}","thread_name":"다른 채팅"}}"#),
            "not json".into(),
            format!(r#"{{"id":"{THREAD}","thread_name":"펫\n테스트"}}"#),
        ];
        std::fs::write(&index, lines.join("\n")).unwrap();
        let titles = read_chat_titles(&index, &[THREAD.into(), "01a1ac6a-0000-4000-8000-000000000000".into()]);
        assert_eq!(titles.get(THREAD).map(String::as_str), Some("펫 테스트"), "the last name wins, control characters become spaces");
        assert_eq!(titles.len(), 1, "only asked-for, named chats");
        assert!(read_chat_titles(&dir.path().join("missing.jsonl"), &[THREAD.into()]).is_empty());
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
        assert!(rollout_started(&rollout, &request_hash("부산 1박\n2일"), 49_000));
        assert!(!rollout_started(&rollout, &request_hash("부산 1박\n2일"), 60_000));
        assert!(!rollout_started(&rollout, &request_hash("이전 요청"), 49_000));
        assert!(!rollout_started(&rollout, &request_hash("다른 요청"), 0));
    }
}
