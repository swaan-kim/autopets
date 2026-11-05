//! The presentation pet's task, executed BY THE CODEX CHAT THAT INVOKED THE PET.
//!
//! The chat that ran `$autopet` keeps its turn open with
//! `autopet-preview.exe wait` (see `handoff.rs`). '제작 시작' turns the pet's
//! settings into one task; the waiting chat claims it and its own model runs
//! the AutoPets `autopets-presentation` skill (frontend-slides, modified) in
//! that same turn, so the request, the commands and the result are in the chat
//! the user has open. There is exactly one model run and one output file.
//!
//! Not used, and why: a separate `codex app-server` session (the earlier
//! version) is a different chat; resuming the chat's thread from a second
//! app-server process would not reach the Codex window that owns it (that app
//! server talks to its window over stdio only).
//!
//! The pet's status comes only from what really happened: the claim, the
//! chat's own session record (rollout file, read-only) and the chat's
//! `done`/`fail` report, which the pet verifies (HTML deck, full pinned skill
//! text read in that chat after the claim). Every task leaves `run.json` next
//! to the output.
//!
//! Human-in-the-loop: mid-task the chat pauses its own turn on
//! `autopet-preview.exe ask` (see `checkpoint.rs`). The first question is
//! required: the outline options the chat drafted. The deck only counts as
//! done when that decision was delivered to the chat before the deck was
//! written; the deck is also checked against the chosen outline.

use crate::{
    checkpoint::{self, Checkpoint},
    handoff,
    host::HostInfo,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const FEATURE_ID: &str = "presentation";
const FEATURE_NAME: &str = "발표자료 만들기";
const SKILL_ID: &str = "autopets-presentation";
const OUTPUT_NAME: &str = "presentation.html";
/// Created inside the chat's working folder (writable for the chat's sandbox).
const OUTPUT_FOLDER: &str = "autopets-presentation";
/// After the claim, the chat has this long to finish.
const RUN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// After `done`, keep following the chat this long for its final answer.
const FINAL_WAIT: Duration = Duration::from_secs(10 * 60);
const TICK: Duration = Duration::from_millis(700);

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillEvidence {
    id: String,
    version: String,
    path: String,
    /// Which copy was used: the installed AutoPets package or this checkout.
    source: String,
    /// Pinned digest from skill-sources.json, verified before the hand-off.
    sha256: String,
    upstream: String,
    /// The complete pinned skill text was read in the chat after the claim.
    loaded: bool,
    evidence: String,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    id: String,
    /// waiting (for a chat to claim) | requesting (claimed) | running |
    /// question (paused: the chat asked the user through the pet) |
    /// resuming (answered; the chat has not picked it up yet) | completed | failed
    phase: String,
    /// Always "chat": the invoking Codex chat runs the task.
    session: String,
    /// The chat the task is bound to / was claimed by.
    chat_thread: Option<String>,
    /// A chat is waiting right now (only meaningful while `waiting`).
    chat_waiting: bool,
    claimed: bool,
    rollout_path: Option<String>,
    /// The chat's turn that ran the task has ended.
    turn_ended: bool,
    started_at: u64,
    updated_at: u64,
    command_count: u32,
    file_change_count: u32,
    last_event: Option<String>,
    output_dir: Option<String>,
    output_file: Option<String>,
    output_name: Option<String>,
    slide_count: Option<u32>,
    skill: Option<SkillEvidence>,
    error: Option<String>,
    record_file: Option<String>,
    request_text: Option<String>,
    /// How the result was settled: done | fail | turn-end | timeout
    completion: Option<String>,
    /// The chat's final answer for this turn (from its session record).
    chat_final: Option<String>,
    /// The open question (pending, or answered but not yet delivered).
    question: Option<Checkpoint>,
    /// Every question of this task, in order (decision history).
    checkpoints: Vec<Checkpoint>,
}

struct Waiter {
    thread: String,
    pid: u32,
    since: u64,
}

struct Claim {
    thread: String,
    pid: u32,
    rollout: Option<PathBuf>,
    /// Rollout size when the task was claimed; only later records count.
    offset: u64,
    read_pos: u64,
    pending: Vec<u8>,
    at: Instant,
}

struct Task {
    id: String,
    /// Chat this task is reserved for (None: the first waiting chat).
    thread: Option<String>,
    settings: Value,
    skill: SkillEvidence,
    skill_text: String,
    request_text: Option<String>,
    output_dir: Option<PathBuf>,
    claim: Option<Claim>,
    finished: bool,
    final_deadline: Option<Instant>,
    result: Option<Value>,
    events: Vec<Value>,
    checkpoints: Vec<Checkpoint>,
    /// Time spent waiting for the user (not counted against RUN_TIMEOUT).
    paused: Duration,
    pause_started: Option<Instant>,
    /// Work that skipped a decision (e.g. the deck existed before the answer).
    violation: Option<String>,
}

impl Task {
    fn log(&mut self, kind: &str, detail: Value) {
        if self.events.len() < 400 {
            self.events.push(json!({ "at": now_ms(), "kind": kind, "detail": detail }));
        }
    }

    fn open_question(&self) -> Option<&Checkpoint> {
        self.checkpoints.iter().find(|c| c.is_open())
    }

    /// The outline decision the chat actually received.
    fn delivered_outline(&self) -> Option<&Checkpoint> {
        self.checkpoints.iter().rev().find(|c| c.stage == checkpoint::REQUIRED_STAGE && c.state == "delivered")
    }

    fn end_pause(&mut self) {
        if let Some(started) = self.pause_started.take() {
            self.paused += started.elapsed();
        }
    }

    /// Working time since the claim, without the time spent waiting for the user.
    fn active_time(&self) -> Duration {
        let total = self.claim.as_ref().map(|c| c.at.elapsed()).unwrap_or_default();
        let paused = self.paused + self.pause_started.map(|s| s.elapsed()).unwrap_or_default();
        total.saturating_sub(paused)
    }

    fn html_exists(&self) -> bool {
        self.output_dir.as_deref().and_then(|d| fs::read_dir(d).ok()).is_some_and(|entries| {
            entries.flatten().any(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("html")))
        })
    }
}

/// Mirrors the task's questions into the status the pet UI polls.
fn sync_questions(app: &AppHandle, task: &Task) {
    let all = task.checkpoints.clone();
    let open = task.open_question().cloned();
    update(app, |s| {
        s.checkpoints = all;
        s.question = open;
    });
}

#[derive(Default)]
struct Link {
    waiter: Option<Waiter>,
    task: Option<Task>,
}

#[derive(Default)]
pub struct Jobs {
    status: Mutex<Option<JobStatus>>,
    host: Mutex<HostInfo>,
    link: Mutex<Link>,
    monitor: AtomicBool,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn jobs(app: &AppHandle) -> tauri::State<'_, Jobs> {
    app.state::<Jobs>()
}

fn update(app: &AppHandle, f: impl FnOnce(&mut JobStatus)) {
    if let Ok(mut guard) = jobs(app).status.lock() {
        if let Some(status) = guard.as_mut() {
            f(status);
            status.updated_at = now_ms();
        }
    }
}

fn snapshot(app: &AppHandle) -> Option<JobStatus> {
    jobs(app).status.lock().ok().and_then(|s| s.clone())
}

fn lock_link(app: &AppHandle) -> std::sync::MutexGuard<'_, Link> {
    app.state::<Jobs>().inner().link.lock().unwrap_or_else(|e| e.into_inner())
}

/// Records which Codex invoked the pet (from the launcher, also on re-invoke).
pub fn set_host(app: &AppHandle, host: HostInfo) {
    if host.codex.is_none() && host.thread.is_none() {
        return;
    }
    if let Ok(mut current) = jobs(app).host.lock() {
        if host.codex.is_some() {
            current.codex = host.codex;
        }
        if host.thread.is_some() {
            current.thread = host.thread;
        }
    }
}

fn owner_thread(app: &AppHandle) -> Option<String> {
    jobs(app).host.lock().ok().and_then(|h| h.thread.clone())
}

/// Writes the link state the waiting CLI polls.
fn publish(app: &AppHandle, link: &Link) {
    let task = link.task.as_ref().map(|t| {
        let state = if t.finished {
            "finished"
        } else if t.claim.is_some() {
            "claimed"
        } else {
            "ready"
        };
        // The `ask` command of the chat polls this for the user's answer.
        let question = t.checkpoints.last().map(|c| json!({ "id": c.id, "state": c.state, "stage": c.stage }));
        json!({
            "id": t.id, "thread": t.thread, "state": state,
            "chatThread": t.claim.as_ref().map(|c| c.thread.clone()), "checkpoint": question
        })
    });
    handoff::publish(&json!({
        "petPid": std::process::id(),
        "updatedAt": now_ms(),
        "ownerThread": owner_thread(app),
        "waiter": link.waiter.as_ref().map(|w| json!({ "thread": w.thread, "pid": w.pid, "since": w.since })),
        "task": task,
    }));
}

// ---------------------------------------------------------------- request

fn label(settings: &Value, key: &str, max: usize) -> Result<String, String> {
    let text = settings
        .get(key)
        .and_then(|v| v.get("label"))
        .and_then(Value::as_str)
        .map(|s| s.chars().filter(|c| !c.is_control() || *c == '\n').collect::<String>())
        .map(|s| s.trim().to_owned())
        .unwrap_or_default();
    if text.is_empty() {
        return Err(format!("설정 '{key}'이(가) 비어 있습니다."));
    }
    Ok(text.chars().take(max).collect())
}

fn build_settings(config: &Value) -> Result<Value, String> {
    if config.get("featureId").and_then(Value::as_str) != Some(FEATURE_ID) {
        return Err("발표자료 만들기 설정이 아닙니다.".into());
    }
    let skills_ok = config
        .get("skills")
        .and_then(Value::as_array)
        .is_some_and(|s| s.iter().any(|v| v.as_str() == Some(SKILL_ID)));
    if !skills_ok {
        return Err(format!("설정에 {SKILL_ID} 스킬이 없습니다."));
    }
    let settings = config.get("settings").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "purpose": label(&settings, "purpose", 60)?,
        "topic": label(&settings, "topic", 300)?,
        "length": label(&settings, "length", 60)?,
        "style": label(&settings, "style", 60)?,
        "priority": label(&settings, "priority", 60)?,
    }))
}

/// The question file the chat writes for a stage (inside the output folder).
fn question_file(dir: &Path, stage: &str) -> PathBuf {
    dir.join(format!("checkpoint-{stage}.json"))
}

fn ask_command(exe: &str, task_id: &str, file: &Path) -> String {
    format!("& '{exe}' ask --task {task_id} --file '{}'", file.display())
}

fn pet_exe() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| "autopet-preview.exe".into())
}

/// The exact request the chat's model receives (also shown in the chat).
fn request_text(id: &str, settings: &Value, skill: &SkillEvidence, dir: &Path) -> String {
    let s = |k: &str| settings.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
    let outline_file = question_file(dir, checkpoint::REQUIRED_STAGE);
    format!(
        "AutoPets 발표자료 Pet 요청 (작업 {id})\n\
         사용자가 이 채팅에서 불러온 데스크톱 Pet에서 아래 설정을 고르고 '제작 시작'을 눌렀습니다. 부족한 정보는 합리적으로 정하세요.\n\
         - 발표 목적: {}\n\
         - 발표 주제와 내용: {}\n\
         - 분량: {}\n\
         - 디자인: {}\n\
         - 작업 우선순위: {}\n\
         사용할 스킬: {SKILL_ID} {} (frontend-slides 기반 AutoPets 수정본). 먼저 {} 파일 전체를 한 번에 읽고(Get-Content -Raw) 그 지침을 따르세요.\n\
         사용자 확인은 이 채팅이 아니라 Pet에서 받습니다. 사용자는 다른 일을 하다가 Pet에서 바로 답합니다.\n\
         1) 구성안 확인(필수): 요청을 분석해 방향이 실제로 다른 구성안 2~3개를 만드세요. 각 안에는 분량에 맞는 슬라이드 제목 목록을 넣으세요. 이 채팅에 구성안을 짧게 보여 준 다음, {} 파일에 아래 형식의 JSON(UTF-8)으로 저장하고 Pet 질문 명령을 샌드박스 밖 실행 승인과 함께 실행하세요: {}\n\
         형식: {{\"stage\":\"outline\",\"title\":\"발표자료 구성안 선택\",\"question\":\"<사용자에게 보일 질문 한 문장>\",\"options\":[{{\"id\":\"A\",\"label\":\"<짧은 이름>\",\"summary\":\"<한 줄 설명>\",\"slides\":[\"<1장 제목>\",\"<2장 제목>\"]}}],\"allowCustom\":true}}\n\
         2) 이 명령은 사용자가 Pet에서 답할 때까지 끝나지 않습니다. 그동안 결과 HTML을 만들거나 다른 작업을 하지 말고 같은 명령 세션을 계속 기다리세요. 출력의 choice가 사용자의 결정입니다. 출력의 chatSummary를 이 채팅에 그대로 보여 준 뒤 next 안내대로 만드세요. 구성안을 고른 경우 그 안의 슬라이드 제목을 순서대로 각 슬라이드 제목으로 그대로 쓰세요.\n\
         3) 추가 질문(필요할 때만): 제작 중 사용자 합의가 꼭 필요하거나 결과 품질을 크게 바꾸는 판단(예: 분량을 지키려면 핵심 내용을 빼야 함, 근거가 부족한 내용을 넣을지 뺄지, 디자인 방향이 크게 갈림)이 생기면 같은 방식으로 묻습니다. stage는 length·design·evidence·other 중 하나, 파일은 같은 폴더의 checkpoint-<stage>.json입니다. 사소한 결정은 직접 정하고 추가 질문은 최대 2번입니다.\n\
         결과: {} 한 파일로 만드세요(없는 폴더는 만드세요). Pet 질문 JSON 파일 외에 다른 파일은 만들거나 수정하지 마세요. CSS·JavaScript를 HTML 안에 넣고 외부 파일·네트워크에 의존하지 마세요. PPTX·PDF는 만들지 마세요.\n\
         검수: 사용자의 화면이나 브라우저를 조작하는 도구(computer-use, 브라우저 자동화)는 쓰지 말고, 글자 넘침·겹침은 HTML/CSS를 직접 검토해 확인하세요.",
        s("purpose"),
        s("topic"),
        s("length"),
        s("style"),
        s("priority"),
        skill.version,
        skill.path,
        outline_file.display(),
        ask_command(&pet_exe(), id, &outline_file),
        dir.join(OUTPUT_NAME).display(),
    )
}

// ---------------------------------------------------------------- skill

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn canonical(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Installed AutoPets package first (the copy the app ships), then this
/// source checkout. Each copy must match its registry pin and license digest.
fn skill_roots() -> Vec<(PathBuf, &'static str)> {
    let mut roots = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push((
            PathBuf::from(local).join("AutoPets").join("connector").join("integrations").join("codex").join("skills"),
            "installed AutoPets",
        ));
    }
    roots.push((
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("integrations").join("codex").join("skills"),
        "source checkout",
    ));
    roots
}

fn verify_skill(root: &Path, source: &str) -> Result<(SkillEvidence, String), String> {
    let registry: Value = serde_json::from_slice(&fs::read(root.join("skill-sources.json")).map_err(|_| "registry missing")?)
        .map_err(|_| "registry invalid")?;
    let entries = registry.get("skills").and_then(Value::as_array).ok_or("registry invalid")?;
    let entry = entries
        .iter()
        .find(|e| e.get("id").and_then(Value::as_str) == Some(SKILL_ID))
        .ok_or("skill not registered")?;
    let pin = entry.get("sha256").and_then(Value::as_str).ok_or("pin missing")?;
    let file = root.join(SKILL_ID).join("SKILL.md");
    let raw = fs::read_to_string(&file).map_err(|_| "skill file missing")?;
    if sha256_hex(canonical(&raw).as_bytes()) != pin {
        return Err("skill integrity mismatch".into());
    }
    if let Some(license) = entry.get("license") {
        let name = license.get("file").and_then(Value::as_str).ok_or("license entry invalid")?;
        let expected = license.get("sha256").and_then(Value::as_str).ok_or("license entry invalid")?;
        let bytes = fs::read(root.join(SKILL_ID).join(name)).map_err(|_| "license missing")?;
        if sha256_hex(&bytes) != expected {
            return Err("license integrity mismatch".into());
        }
    }
    Ok((
        SkillEvidence {
            id: SKILL_ID.into(),
            version: entry.get("version").and_then(Value::as_str).unwrap_or_default().into(),
            path: dunce_path(&file),
            source: source.into(),
            sha256: pin.into(),
            upstream: entry.get("source").and_then(Value::as_str).unwrap_or_default().into(),
            loaded: false,
            evidence: String::new(),
        },
        canonical(&raw),
    ))
}

fn dunce_path(path: &Path) -> String {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = resolved.to_string_lossy().to_string();
    text.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(text)
}

fn resolve_skill() -> Result<(SkillEvidence, String), String> {
    let mut problems = Vec::new();
    for (root, source) in skill_roots() {
        match verify_skill(&root, source) {
            Ok(found) => return Ok(found),
            Err(problem) => problems.push(format!("{source}: {problem}")),
        }
    }
    Err(format!("{SKILL_ID} 스킬을 확인하지 못했습니다 ({})", problems.join("; ")))
}

// ---------------------------------------------------------------- output

fn local_stamp() -> String {
    #[cfg(windows)]
    {
        #[repr(C)]
        #[derive(Default)]
        struct SystemTime16 {
            year: u16,
            month: u16,
            day_of_week: u16,
            day: u16,
            hour: u16,
            minute: u16,
            second: u16,
            millis: u16,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetLocalTime(time: *mut SystemTime16);
        }
        let mut t = SystemTime16::default();
        // SAFETY: fills a correctly laid out SYSTEMTIME.
        unsafe { GetLocalTime(&mut t) };
        format!("{:04}{:02}{:02}-{:02}{:02}{:02}", t.year, t.month, t.day, t.hour, t.minute, t.second)
    }
    #[cfg(not(windows))]
    {
        format!("{}", now_ms() / 1000)
    }
}

/// A folder name that does not exist yet, so nothing is ever overwritten.
/// The chat creates it (inside its own writable workspace).
fn new_output_dir(cwd: &Path) -> Result<PathBuf, String> {
    let base = cwd.join(OUTPUT_FOLDER);
    let stamp = local_stamp();
    for n in 0..100 {
        let dir = base.join(if n == 0 { stamp.clone() } else { format!("{stamp}-{n}") });
        if !dir.exists() {
            return Ok(dir);
        }
    }
    Err("결과 폴더 이름을 정하지 못했습니다.".into())
}

/// A real slide deck: an HTML document with several slides and script.
fn check_html(dir: &Path) -> Result<(PathBuf, u32), String> {
    let mut path = dir.join(OUTPUT_NAME);
    if !path.is_file() {
        // Accept a single differently named .html the chat created here.
        let mut html: Vec<PathBuf> = fs::read_dir(dir)
            .map_err(|_| format!("{OUTPUT_NAME} 파일이 만들어지지 않았습니다."))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("html")))
            .collect();
        if html.len() != 1 {
            return Err(format!("{OUTPUT_NAME} 파일이 만들어지지 않았습니다."));
        }
        path = html.remove(0);
    }
    let text = fs::read_to_string(&path).map_err(|_| "결과 파일을 읽을 수 없습니다.".to_string())?;
    let lower = text.to_ascii_lowercase();
    if text.len() < 1024 || !lower.contains("<html") || !lower.contains("</html>") {
        return Err("결과 HTML이 비어 있거나 완전하지 않습니다.".into());
    }
    let sections = lower.matches("<section").count();
    let slide_classes = lower.matches("class=\"slide").count() + lower.matches("class='slide").count();
    let slides = sections.max(slide_classes) as u32;
    if slides < 2 {
        return Err("결과 HTML에서 슬라이드를 찾지 못했습니다.".into());
    }
    if !lower.contains("<script") {
        return Err("결과 HTML에 슬라이드 이동 스크립트가 없습니다.".into());
    }
    Ok((path, slides))
}

fn walk_strings(value: &Value, f: &mut dyn FnMut(&str)) {
    match value {
        Value::String(s) => f(s),
        Value::Array(items) => items.iter().for_each(|v| walk_strings(v, f)),
        Value::Object(map) => map.values().for_each(|v| walk_strings(v, f)),
        _ => {}
    }
}

/// The COMPLETE pinned skill text must appear in the chat's own session
/// record AFTER the claim (normally the output of the chat's read command).
/// A name or a path alone is not evidence.
fn skill_loaded(rollout: Option<&Path>, offset: u64, skill_text: &str) -> (bool, String) {
    let Some(rollout) = rollout else {
        return (false, "이 채팅의 세션 기록 파일을 찾지 못했습니다.".into());
    };
    let Ok(mut file) = fs::File::open(rollout) else {
        return (false, "세션 기록 파일을 열 수 없습니다.".into());
    };
    let mut bytes = Vec::new();
    if file.seek(SeekFrom::Start(offset)).is_err() || file.read_to_end(&mut bytes).is_err() {
        return (false, "세션 기록 파일을 읽을 수 없습니다.".into());
    }
    let body = skill_text.trim();
    let lines: Vec<&str> = body.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let mut all = String::new();
    for (number, line) in String::from_utf8_lossy(&bytes).lines().enumerate() {
        let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
        let mut found = false;
        walk_strings(&value, &mut |s| {
            if s.len() >= 64 {
                let s = canonical(s);
                if s.contains(body) {
                    found = true;
                }
                all.push_str(&s);
                all.push('\n');
            }
        });
        if found {
            let kind = value
                .pointer("/payload/item/type")
                .or_else(|| value.pointer("/payload/type"))
                .and_then(Value::as_str)
                .unwrap_or("record");
            return (true, format!("이 채팅의 세션 기록(작업 전달 이후 {}번째 줄, {kind})에 고정 버전 SKILL.md 전체 본문이 있음", number + 1));
        }
    }
    if !lines.is_empty() && lines.iter().all(|l| all.contains(l)) {
        return (true, format!("이 채팅의 세션 기록(작업 전달 이후)에 고정 버전 SKILL.md의 모든 줄({}줄)이 나뉘어 읽힘", lines.len()));
    }
    (false, "작업 전달 이후 이 채팅의 세션 기록에서 SKILL.md 전체 본문을 찾지 못했습니다.".into())
}

// ---------------------------------------------------------------- monitor

fn short(text: &str, max: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > max {
        format!("{}…", flat.chars().take(max).collect::<String>())
    } else {
        flat
    }
}

/// One record of the chat's rollout, after the claim.
/// Returns Some(final answer) when the chat's turn ended.
fn process_record(app: &AppHandle, task: &mut Task, value: &Value) -> Option<Option<String>> {
    if value.get("type").and_then(Value::as_str) != Some("event_msg") {
        return None;
    }
    let payload = value.get("payload")?;
    let finished = task.finished;
    let to_running = |s: &mut JobStatus| {
        if !finished && s.phase == "requesting" {
            s.phase = "running".into();
        }
    };
    match payload.get("type").and_then(Value::as_str)? {
        "item_completed" => {
            let item = payload.get("item")?;
            match item.get("type").and_then(Value::as_str)? {
                "CommandExecution" => {
                    let command = item
                        .pointer("/parsed_cmd/0/cmd")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .or_else(|| item.get("command").and_then(Value::as_array).and_then(|c| c.last()).and_then(Value::as_str).map(str::to_owned))
                        .unwrap_or_default();
                    if command.contains("autopet-preview") {
                        task.log("pet-command", json!(short(&command, 200)));
                        return None;
                    }
                    task.log("command", json!(short(&command, 200)));
                    let text = short(&command, 100);
                    update(app, |s| {
                        to_running(s);
                        s.command_count += 1;
                        s.last_event = Some(format!("명령 실행: {text}"));
                    });
                }
                "FileChange" => {
                    let paths: Vec<String> = match item.get("changes") {
                        Some(Value::Object(map)) => map.keys().cloned().collect(),
                        Some(Value::Array(list)) => list.iter().filter_map(|c| c.get("path").and_then(Value::as_str).map(str::to_owned)).collect(),
                        _ => Vec::new(),
                    };
                    task.log("file-change", json!(paths));
                    let names: Vec<String> = paths
                        .iter()
                        .map(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
                        .collect();
                    update(app, |s| {
                        to_running(s);
                        s.file_change_count += paths.len() as u32;
                        s.last_event = Some(format!("파일 작성: {}", names.join(", ")));
                    });
                }
                "AgentMessage" => {
                    let mut text = String::new();
                    walk_strings(item.get("content").unwrap_or(&Value::Null), &mut |s| text.push_str(s));
                    let phase = item.get("phase").and_then(Value::as_str).unwrap_or("");
                    task.log("agent-message", json!({ "phase": phase, "text": text.chars().take(2000).collect::<String>() }));
                    // Did the chat show the user's decision after receiving it?
                    let mut shown = false;
                    for cp in task.checkpoints.iter_mut().filter(|c| c.state == "delivered" && !c.chat_shown) {
                        let label = cp.answer.as_ref().map(|a| a.label.clone()).unwrap_or_default();
                        if text.contains("선택 완료") && !label.is_empty() && text.contains(&label) {
                            cp.chat_shown = true;
                            shown = true;
                        }
                    }
                    if shown {
                        task.log("decision-shown-in-chat", json!(short(&text, 200)));
                        sync_questions(app, task);
                    }
                    let line = short(&text, 80);
                    update(app, |s| {
                        to_running(s);
                        s.last_event = Some(format!("채팅: {line}"));
                    });
                }
                "McpToolCall" | "WebSearch" | "ImageView" => {
                    let kind = item.get("type").and_then(Value::as_str).unwrap_or("").to_owned();
                    task.log("tool", json!(kind));
                    update(app, |s| {
                        to_running(s);
                        s.last_event = Some(format!("도구 사용: {kind}"));
                    });
                }
                _ => {}
            }
            None
        }
        "task_complete" => {
            let last = payload.get("last_agent_message").and_then(Value::as_str).map(str::to_owned);
            task.log("turn-complete", json!(payload.get("turn_id")));
            Some(last)
        }
        "turn_aborted" => {
            task.log("turn-aborted", payload.get("reason").cloned().unwrap_or(Value::Null));
            Some(None)
        }
        _ => None,
    }
}

/// Reads what the chat appended to its rollout since the last tick.
fn tail(app: &AppHandle, task: &mut Task) -> Option<Option<String>> {
    let claim = task.claim.as_mut()?;
    if claim.rollout.is_none() {
        claim.rollout = handoff::find_rollout(&claim.thread);
        let len = claim.rollout.as_ref().and_then(|p| fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0);
        claim.offset = len;
        claim.read_pos = len;
        let path = claim.rollout.as_ref().map(|p| p.to_string_lossy().to_string());
        update(app, |s| s.rollout_path = path);
    }
    let path = claim.rollout.clone()?;
    let mut file = fs::File::open(&path).ok()?;
    let len = file.metadata().ok()?.len();
    if len <= claim.read_pos {
        return None;
    }
    file.seek(SeekFrom::Start(claim.read_pos)).ok()?;
    let mut chunk = Vec::new();
    file.take(len - claim.read_pos).read_to_end(&mut chunk).ok()?;
    claim.read_pos += chunk.len() as u64;
    claim.pending.extend_from_slice(&chunk);
    let mut records = Vec::new();
    while let Some(end) = claim.pending.iter().position(|&b| b == b'\n') {
        let line: Vec<u8> = claim.pending.drain(..=end).collect();
        if let Ok(value) = serde_json::from_slice::<Value>(&line) {
            records.push(value);
        }
    }
    for value in records {
        if let Some(end) = process_record(app, task, &value) {
            return Some(end);
        }
    }
    None
}

pub fn start_monitor(app: &AppHandle) {
    if jobs(app).monitor.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(TICK);
        tick(&app);
    });
}

fn tick(app: &AppHandle) {
    let mut link = lock_link(app);
    let mut changed = false;
    if link.waiter.as_ref().is_some_and(|w| !handoff::process_alive(w.pid)) {
        link.waiter = None;
        changed = true;
    }
    let waiter_thread = link.waiter.as_ref().map(|w| w.thread.clone());
    if let Some(task) = link.task.as_mut() {
        if task.claim.is_none() && !task.finished {
            let waiting = waiter_thread.as_ref().is_some_and(|w| task.thread.as_ref().map_or(true, |t| t == w));
            update(app, |s| s.chat_waiting = waiting);
        }
        let following = task.claim.is_some()
            && !snapshot(app).is_some_and(|s| s.turn_ended)
            && (!task.finished || task.final_deadline.is_some_and(|d| Instant::now() < d));
        if following {
            if let Some(final_answer) = tail(app, task) {
                let text = final_answer.map(|t| t.chars().take(4000).collect::<String>());
                update(app, |s| {
                    s.turn_ended = true;
                    s.chat_final = text.clone();
                });
                if task.finished {
                    write_record(app, task); // add the chat's final answer
                } else {
                    finalize(app, task, "turn-end", None);
                }
                changed = true;
            } else if !task.finished && task.open_question().is_none() && task.active_time() > RUN_TIMEOUT {
                // Time spent waiting for the user's answer does not count.
                finalize(app, task, "timeout", Some("시간 초과: Codex 채팅이 작업 시간 30분 안에 결과를 보고하지 않았습니다.".into()));
                changed = true;
            }
        }
    }
    if changed {
        publish(app, &link);
    }
}

/// Verifies the result and settles the task. Returns the verdict for the chat.
fn finalize(app: &AppHandle, task: &mut Task, source: &str, reason: Option<String>) -> Value {
    if let Some(result) = &task.result {
        return result.clone();
    }
    let (rollout, offset) = task
        .claim
        .as_ref()
        .map(|c| (c.rollout.clone(), c.offset))
        .unwrap_or((None, 0));
    let (loaded, evidence) = skill_loaded(rollout.as_deref(), offset, &task.skill_text);
    task.skill.loaded = loaded;
    task.skill.evidence = evidence;
    let pin_ok = fs::read_to_string(&task.skill.path)
        .map(|raw| sha256_hex(canonical(&raw).as_bytes()) == task.skill.sha256)
        .unwrap_or(false);
    let html = task.output_dir.as_deref().map(check_html);
    let (output, slides) = match &html {
        Some(Ok((path, slides))) => (Some(path.clone()), Some(*slides)),
        _ => (None, None),
    };
    // A question still open means the work ended before the user's decision.
    let open = task.open_question().map(|c| c.title.clone());
    let now = now_ms();
    for cp in task.checkpoints.iter_mut().filter(|c| c.is_open()) {
        cp.state = "cancelled".into();
    }
    task.end_pause();
    // The deck must follow the delivered outline decision: written after it,
    // and checked against the chosen outline's slide titles.
    let outline = task.delivered_outline().cloned();
    let written_after = output.as_ref().zip(outline.as_ref()).map(|(path, cp)| {
        let modified = fs::metadata(path).and_then(|m| m.modified()).ok();
        let modified = modified.and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        modified + 500 >= cp.delivered_at.unwrap_or(now)
    });
    let outline_match = output.as_ref().zip(outline.as_ref()).map(|(path, cp)| {
        let text = fs::read_to_string(path).unwrap_or_default();
        checkpoint::outline_match(cp, &text)
    });
    if let (Some(m), Some(cp)) = (&outline_match, &outline) {
        if let Some(target) = task.checkpoints.iter_mut().find(|c| c.id == cp.id) {
            target.outline_match = Some(m.clone());
        }
    }
    let error = if let Some(reason) = reason {
        Some(match open {
            Some(title) => format!("{reason} (Pet 질문 '{title}'에 답하기 전이라 질문을 취소했어요.)"),
            None => reason,
        })
    } else if let Some(title) = open {
        Some(format!("Pet 질문 '{title}'에 답하기 전에 Codex 채팅의 턴이 끝났어요. 질문을 취소했어요."))
    } else if let Some(Err(e)) = html {
        Some(e)
    } else if html.is_none() {
        Some("결과 폴더가 정해지지 않았습니다.".into())
    } else if !pin_ok {
        Some(format!("{SKILL_ID} 스킬 파일이 작업 중에 바뀌어 고정 버전과 다릅니다."))
    } else if !loaded {
        Some(format!("이 채팅에서 {SKILL_ID} 스킬 전체를 읽은 기록이 없어 완료로 처리하지 않았어요. 만들어진 파일은 남아 있어요."))
    } else if let Some(violation) = task.violation.clone() {
        Some(violation)
    } else if outline.is_none() {
        Some("Pet에서 구성안을 고르는 단계 없이 완료가 보고되어 완료로 처리하지 않았어요. 만들어진 파일은 남아 있어요.".into())
    } else if written_after == Some(false) {
        Some("결과 HTML이 구성안 선택을 받기 전에 만들어져서 완료로 처리하지 않았어요.".into())
    } else {
        None
    };
    sync_questions(app, task);
    let record = task.output_dir.as_ref().map(|d| d.join("run.json"));
    let skill = task.skill.clone();
    update(app, |s| {
        s.skill = Some(skill.clone());
        s.output_file = output.as_ref().map(|p| p.to_string_lossy().to_string());
        s.output_name = output.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string());
        s.slide_count = slides;
        s.phase = if error.is_none() { "completed".into() } else { "failed".into() };
        s.error = error.clone();
        s.completion = Some(source.into());
        s.last_event = None;
        s.record_file = record.as_ref().map(|p| p.to_string_lossy().to_string());
    });
    task.finished = true;
    task.final_deadline = Some(Instant::now() + FINAL_WAIT);
    task.log("settled", json!({ "source": source, "ok": error.is_none(), "error": error }));
    let result = json!({
        "ok": error.is_none(),
        "state": if error.is_none() { "completed" } else { "failed" },
        "taskId": task.id,
        "message": error.clone().unwrap_or_else(|| "펫이 결과를 확인했습니다. 펫 창에도 같은 결과가 표시됩니다.".into()),
        "outputFile": output.as_ref().map(|p| p.to_string_lossy().to_string()),
        "outputDir": task.output_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
        "slideCount": slides,
        "skill": { "id": task.skill.id, "version": task.skill.version, "sha256": task.skill.sha256, "loaded": loaded, "evidence": task.skill.evidence },
        "decisions": decisions(task),
        "outlineMatch": outline_match,
        "runRecord": record.as_ref().map(|p| p.to_string_lossy().to_string()),
    });
    task.result = Some(result.clone());
    write_record(app, task);
    result
}

/// Short decision history for the chat's `done` output.
fn decisions(task: &Task) -> Vec<Value> {
    task.checkpoints
        .iter()
        .map(|c| {
            json!({
                "questionId": c.id, "stage": c.stage, "title": c.title, "question": c.question, "state": c.state,
                "options": c.options.iter().map(|o| format!("{}: {}", o.id, o.label)).collect::<Vec<_>>(),
                "answer": c.answer.as_ref().map(|a| match &a.custom {
                    Some(text) => format!("직접 수정: {text}"),
                    None => format!("{}안: {}", a.option_id.clone().unwrap_or_default(), a.label),
                }),
                "shownInChat": c.chat_shown,
                "outlineMatch": c.outline_match,
            })
        })
        .collect()
}

fn write_record(app: &AppHandle, task: &Task) {
    let Some(dir) = task.output_dir.as_ref() else { return };
    let _ = fs::create_dir_all(dir);
    let claim = task.claim.as_ref();
    let body = json!({
        "kind": "autopets-pet-preview-run-v3",
        "humanInTheLoop": "the chat paused its own turn on `autopet-preview.exe ask` until the user answered in the pet; see checkpoints",
        "checkpoints": task.checkpoints,
        "session": "the Codex chat that invoked the pet ran this task in its own turn (no separate Codex session)",
        "chatThread": claim.map(|c| c.thread.clone()),
        "chatRollout": claim.and_then(|c| c.rollout.as_ref()).map(|p| p.to_string_lossy().to_string()),
        "rolloutOffsetAtClaim": claim.map(|c| c.offset),
        "waitProcess": claim.map(|c| c.pid),
        "pet": { "featureId": FEATURE_ID, "name": FEATURE_NAME },
        "request": { "settings": task.settings, "text": task.request_text },
        "skill": task.skill,
        "result": task.result,
        "status": snapshot(app),
        "events": task.events,
    });
    let _ = fs::write(dir.join("run.json"), serde_json::to_vec_pretty(&body).unwrap_or_default());
}

// ---------------------------------------------------------------- chat requests

fn arg(argv: &[String], name: &str) -> Option<String> {
    crate::flag(argv, name)
}

/// Handles `chat-*` requests forwarded from the CLI run by the chat.
pub fn on_chat(app: &AppHandle, action: &str, argv: &[String], nonce: String) {
    start_monitor(app);
    let app = app.clone();
    let action = action.to_owned();
    let argv = argv.to_vec();
    // Verification reads files; keep it off the window's event loop.
    thread::spawn(move || {
        let answer = handle_chat(&app, &action, &argv);
        handoff::reply(&nonce, &answer);
    });
}

fn refuse(message: &str) -> Value {
    json!({ "ok": false, "message": message })
}

fn handle_chat(app: &AppHandle, action: &str, argv: &[String]) -> Value {
    let Some(thread) = arg(argv, "--thread").filter(|t| handoff::valid_thread(t)) else {
        return refuse("채팅 ID가 없습니다.");
    };
    let mut link = lock_link(app);
    let answer = match action {
        "chat-wait" => {
            let pid = arg(argv, "--pid").and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
            if pid == 0 {
                return refuse("대기 프로세스 ID가 없습니다.");
            }
            link.waiter = Some(Waiter { thread: thread.clone(), pid, since: now_ms() });
            if let Some(task) = link.task.as_ref().filter(|t| t.claim.is_none() && !t.finished) {
                let waiting = task.thread.as_ref().map_or(true, |t| *t == thread);
                update(app, |s| s.chat_waiting = waiting);
            }
            json!({ "ok": true, "petPid": std::process::id() })
        }
        "chat-claim" => claim(app, &mut link, &thread, argv),
        "chat-ask" | "chat-resume" => {
            let id = arg(argv, "--task").unwrap_or_default();
            match link.task.as_mut() {
                Some(task) if task.id == id && task.claim.as_ref().is_some_and(|c| c.thread == thread) => {
                    if task.finished {
                        refuse("이 작업은 이미 끝났습니다.")
                    } else if action == "chat-ask" {
                        ask(app, task, argv)
                    } else {
                        resume(app, task, argv)
                    }
                }
                Some(task) if task.id == id => refuse("이 작업은 다른 채팅이 맡았습니다."),
                _ => refuse("펫에 해당 작업이 없습니다. 펫이 다시 시작되었거나 작업이 취소되었습니다."),
            }
        }
        "chat-done" | "chat-fail" => {
            let id = arg(argv, "--task").unwrap_or_default();
            match link.task.as_mut() {
                Some(task) if task.id == id && task.claim.as_ref().is_some_and(|c| c.thread == thread) => {
                    if action == "chat-done" && task.open_question().is_some_and(|_| !task.finished) {
                        let title = task.open_question().map(|c| c.title.clone()).unwrap_or_default();
                        refuse(&format!("Pet 질문 '{title}'에 사용자가 아직 답하지 않았습니다. 같은 ask 명령으로 답을 받은 뒤 이어서 진행하세요."))
                    } else if action == "chat-done" {
                        finalize(app, task, "done", None)
                    } else {
                        let reason = arg(argv, "--reason").filter(|r| !r.trim().is_empty()).unwrap_or_else(|| "이유 없음".into());
                        task.log("chat-fail", json!(reason));
                        finalize(app, task, "fail", Some(format!("Codex 채팅이 실패를 보고했습니다: {reason}")))
                    }
                }
                Some(task) if task.id == id => refuse("이 작업은 다른 채팅이 맡았습니다."),
                _ => refuse("펫에 해당 작업이 없습니다. 펫이 다시 시작되었거나 작업이 취소되었습니다."),
            }
        }
        _ => refuse("알 수 없는 요청입니다."),
    };
    publish(app, &link);
    answer
}

/// `chat-ask`: the chat stops at a decision point and asks the user.
/// The same question asked again (same content, e.g. after `ask` timed out)
/// re-attaches to the existing one instead of creating a second question.
fn ask(app: &AppHandle, task: &mut Task, argv: &[String]) -> Value {
    let pid = arg(argv, "--pid").and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
    let Some(file) = arg(argv, "--file").map(PathBuf::from).filter(|p| p.is_absolute()) else {
        return refuse("질문 파일 경로(--file)가 올바르지 않습니다.");
    };
    let bytes = match fs::metadata(&file) {
        Ok(meta) if meta.is_file() && meta.len() <= 64 * 1024 => fs::read(&file).unwrap_or_default(),
        Ok(_) => return refuse("질문 파일이 너무 크거나 파일이 아닙니다."),
        Err(_) => return refuse(&format!("질문 파일을 찾을 수 없습니다: {}", file.display())),
    };
    let parsed = match checkpoint::parse(&bytes) {
        Ok(parsed) => parsed,
        Err(problem) => return refuse(&problem),
    };
    let reattach = |cp: &Checkpoint| json!({ "ok": true, "questionId": cp.id, "state": cp.state, "reattached": true });
    if let Some(open) = task.checkpoints.iter_mut().find(|c| c.is_open()) {
        if open.digest != parsed.digest {
            return refuse(&format!("아직 답을 받지 않은 Pet 질문({})이 있습니다. 그 질문의 ask 명령을 다시 실행해 답을 받으세요.", open.id));
        }
        open.ask_pid = pid;
        let answer = reattach(open);
        task.log("question-reattached", json!({ "questionId": answer["questionId"], "askPid": pid }));
        crate::pet::reveal(app);
        return answer;
    }
    if let Some(done) = task.checkpoints.iter().rev().find(|c| c.digest == parsed.digest && c.state == "delivered") {
        return reattach(done); // already answered and delivered: `ask` prints it again
    }
    if task.checkpoints.len() >= checkpoint::MAX_PER_TASK {
        return refuse("이 작업에서는 Pet 질문을 더 할 수 없습니다(최대 4번). 남은 결정은 합리적으로 정해 진행하세요.");
    }
    let outline_done = task.delivered_outline().is_some();
    if parsed.stage == checkpoint::REQUIRED_STAGE && !outline_done && task.html_exists() {
        task.violation = Some("구성안을 묻기 전에 결과 HTML이 이미 만들어져 있었어요. 사용자 선택이 반영되지 않아 완료로 처리하지 않아요.".into());
        task.log("violation", json!("html-before-outline-question"));
        return refuse("결과 HTML이 이미 있습니다. 구성안은 HTML을 만들기 전에 물어야 합니다.");
    }
    if parsed.stage != checkpoint::REQUIRED_STAGE && !outline_done {
        return refuse("먼저 구성안 선택(stage \"outline\") 질문으로 사용자의 결정을 받으세요.");
    }
    let seq = task.checkpoints.len() as u32 + 1;
    let cp = Checkpoint {
        id: format!("q{seq}-{}", now_ms()),
        task_id: task.id.clone(),
        seq,
        stage: parsed.stage,
        title: parsed.title,
        question: parsed.question,
        reason: parsed.reason,
        options: parsed.options,
        allow_custom: parsed.allow_custom,
        state: "pending".into(),
        asked_at: now_ms(),
        source_file: file.to_string_lossy().to_string(),
        digest: parsed.digest,
        ask_pid: pid,
        ..Default::default()
    };
    task.log("question", json!({ "questionId": cp.id, "stage": cp.stage, "question": cp.question, "options": cp.options, "file": cp.source_file }));
    let answer = json!({ "ok": true, "questionId": cp.id, "state": "pending", "reattached": false });
    let title = cp.title.clone();
    task.checkpoints.push(cp);
    task.pause_started = Some(Instant::now());
    update(app, |s| {
        s.phase = "question".into();
        s.last_event = Some(format!("선택이 필요해요: {title}"));
    });
    sync_questions(app, task);
    // A question needs the pet on screen (shown without taking focus).
    crate::pet::reveal(app);
    answer
}

/// `chat-resume`: the chat's `ask` picks up the user's answer, exactly once.
fn resume(app: &AppHandle, task: &mut Task, argv: &[String]) -> Value {
    let id = arg(argv, "--question").unwrap_or_default();
    // A deck that exists before the first outline decision ignored the user.
    let deck_too_early = task.html_exists() && task.delivered_outline().is_none();
    let Some(cp) = task.checkpoints.iter_mut().find(|c| c.id == id) else {
        return refuse("이 작업에 그런 Pet 질문이 없습니다.");
    };
    match cp.state.as_str() {
        "answered" => {}
        "delivered" => {
            let mut payload = checkpoint::answer_payload(cp);
            payload["repeated"] = json!(true);
            payload["next"] = json!("이 답은 이미 전달되어 작업에 반영 중입니다. 같은 작업을 다시 하지 말고 이어서 진행하세요.");
            return payload;
        }
        "pending" => return refuse("사용자가 아직 답하지 않았습니다."),
        _ => return refuse("이 질문은 취소되었습니다."),
    }
    cp.state = "delivered".into();
    cp.delivered_at = Some(now_ms());
    let payload = checkpoint::answer_payload(cp);
    let label = cp.answer.as_ref().map(|a| a.label.clone()).unwrap_or_default();
    let outline = cp.stage == checkpoint::REQUIRED_STAGE;
    let detail = json!({ "questionId": cp.id, "answer": cp.answer });
    if outline && deck_too_early {
        task.violation = Some("구성안 질문에 답하기 전에 결과 HTML이 만들어졌어요. 사용자 선택이 반영되지 않아 완료로 처리하지 않아요.".into());
        task.log("violation", json!("html-while-outline-question-open"));
    }
    task.log("answer-delivered", detail);
    task.end_pause();
    update(app, |s| {
        s.phase = "running".into();
        s.last_event = Some(format!("선택 반영: {label} · Codex 채팅이 이어서 진행"));
    });
    sync_questions(app, task);
    payload
}

fn claim(app: &AppHandle, link: &mut Link, thread: &str, argv: &[String]) -> Value {
    let id = arg(argv, "--task").unwrap_or_default();
    let pid = arg(argv, "--pid").and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
    let Some(cwd) = arg(argv, "--cwd").map(PathBuf::from).filter(|p| p.is_absolute() && p.is_dir()) else {
        return refuse("채팅 작업 폴더가 올바르지 않습니다.");
    };
    let Some(task) = link.task.as_mut().filter(|t| t.id == id && !t.finished) else {
        return refuse("가져갈 작업이 없습니다.");
    };
    if let Some(existing) = &task.claim {
        if existing.thread != thread {
            return refuse("이 작업은 다른 채팅이 이미 가져갔습니다.");
        }
        // Same chat asked again: hand back the same task (no second run).
        let mut payload = task_payload(task);
        payload["reclaimed"] = json!(true);
        return payload;
    }
    if task.thread.as_deref().is_some_and(|t| t != thread) {
        return refuse("이 작업은 다른 채팅에 전달될 작업입니다.");
    }
    let dir = match new_output_dir(&cwd) {
        Ok(dir) => dir,
        Err(e) => return refuse(&e),
    };
    let text = request_text(&task.id, &task.settings, &task.skill, &dir);
    let rollout = handoff::find_rollout(thread);
    let offset = rollout.as_ref().and_then(|p| fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0);
    task.thread = Some(thread.to_owned());
    task.output_dir = Some(dir.clone());
    task.request_text = Some(text.clone());
    task.claim = Some(Claim { thread: thread.to_owned(), pid, rollout: rollout.clone(), offset, read_pos: offset, pending: Vec::new(), at: Instant::now() });
    task.log("claimed", json!({ "thread": thread, "waitPid": pid, "cwd": cwd, "rollout": rollout, "offset": offset }));
    link.waiter = None; // consumed: this wait command now exits
    let payload = task_payload(link.task.as_ref().expect("task present"));
    let thread = thread.to_owned();
    update(app, |s| {
        s.phase = "requesting".into();
        s.claimed = true;
        s.chat_waiting = false;
        s.chat_thread = Some(thread);
        s.rollout_path = rollout.map(|p| p.to_string_lossy().to_string());
        s.output_dir = Some(dir.to_string_lossy().to_string());
        s.request_text = Some(text);
        s.last_event = Some("Codex 채팅이 요청을 받았어요".into());
    });
    payload
}

fn task_payload(task: &Task) -> Value {
    let exe = pet_exe();
    let output_file = task.output_dir.as_ref().map(|d| d.join(OUTPUT_NAME).to_string_lossy().to_string());
    let outline_file = task.output_dir.as_ref().map(|d| question_file(d, checkpoint::REQUIRED_STAGE));
    json!({
        "ok": true,
        "state": "task",
        "task": {
            "id": task.id,
            "pet": { "featureId": FEATURE_ID, "name": FEATURE_NAME },
            "chatThread": task.claim.as_ref().map(|c| c.thread.clone()),
            "skill": {
                "id": task.skill.id, "version": task.skill.version, "path": task.skill.path,
                "sha256": task.skill.sha256, "source": task.skill.source, "upstream": task.skill.upstream
            },
            "settings": task.settings,
            "request": task.request_text,
            "outputDir": task.output_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
            "outputFile": output_file,
            "checkpoint": {
                "required": checkpoint::REQUIRED_STAGE,
                "file": outline_file.as_ref().map(|p| p.to_string_lossy().to_string()),
                "ask": outline_file.as_ref().map(|p| ask_command(&exe, &task.id, p)),
                "maxQuestions": checkpoint::MAX_PER_TASK,
            },
            "report": {
                "ask": format!("& '{exe}' ask --task {} --file '<질문 JSON 파일>'", task.id),
                "done": format!("& '{exe}' done --task {}", task.id),
                "fail": format!("& '{exe}' fail --task {} --reason '<짧은 이유>'", task.id)
            }
        }
    })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn pet_slides_start(app: AppHandle, config: Value) -> Result<JobStatus, String> {
    start_monitor(&app);
    if snapshot(&app).is_some_and(|s| matches!(s.phase.as_str(), "waiting" | "requesting" | "running" | "question" | "resuming")) {
        return Err("이미 발표자료 작업이 진행 중이에요. 끝난 뒤 다시 시도하세요.".into());
    }
    let settings = build_settings(&config)?;
    let mut link = lock_link(&app);
    let waiter_thread = link.waiter.as_ref().map(|w| w.thread.clone());
    // Reserve the task for the chat that is waiting now, otherwise for the
    // chat that last called the pet.
    let thread = waiter_thread.clone().or_else(|| owner_thread(&app));
    let id = format!("task-{}", now_ms());
    let mut status = JobStatus {
        id: id.clone(),
        phase: "waiting".into(),
        session: "chat".into(),
        chat_thread: thread.clone(),
        chat_waiting: waiter_thread.is_some(),
        started_at: now_ms(),
        updated_at: now_ms(),
        ..Default::default()
    };
    let (skill, skill_text) = match resolve_skill() {
        Ok(found) => found,
        Err(e) => {
            status.phase = "failed".into();
            status.error = Some(e);
            link.task = None;
            if let Ok(mut current) = jobs(&app).status.lock() {
                *current = Some(status.clone());
            }
            publish(&app, &link);
            return Ok(status);
        }
    };
    status.skill = Some(skill.clone());
    status.last_event = Some(if waiter_thread.is_some() { "Codex 채팅에 전달하는 중".into() } else { "Codex 채팅이 받아 가기를 기다리는 중".into() });
    let mut task = Task {
        id,
        thread,
        settings,
        skill,
        skill_text,
        request_text: None,
        output_dir: None,
        claim: None,
        finished: false,
        final_deadline: None,
        result: None,
        events: Vec::new(),
        checkpoints: Vec::new(),
        paused: Duration::ZERO,
        pause_started: None,
        violation: None,
    };
    task.log("created", json!({ "reservedFor": task.thread, "chatWaiting": waiter_thread.is_some() }));
    link.task = Some(task);
    if let Ok(mut current) = jobs(&app).status.lock() {
        *current = Some(status.clone());
    }
    publish(&app, &link);
    Ok(status)
}

/// Withdraws a task no chat has taken yet.
#[tauri::command]
pub fn pet_slides_cancel(app: AppHandle) -> Result<(), String> {
    let mut link = lock_link(&app);
    if link.task.as_ref().is_some_and(|t| t.claim.is_some() && !t.finished) {
        return Err("Codex 채팅이 이미 작업을 받아 진행 중이에요. 채팅에서 중지하세요.".into());
    }
    link.task = None;
    if let Ok(mut current) = jobs(&app).status.lock() {
        *current = None;
    }
    publish(&app, &link);
    Ok(())
}

/// The user's answer to the open question, from the pet. Bound to the task
/// and question it was shown for; repeated clicks never resume twice.
#[tauri::command]
pub fn pet_checkpoint_answer(
    app: AppHandle,
    task_id: String,
    question_id: String,
    option_id: Option<String>,
    custom: Option<String>,
) -> Result<JobStatus, String> {
    let mut link = lock_link(&app);
    let task = link.task.as_mut().filter(|t| t.id == task_id).ok_or("이 질문의 작업이 더 이상 없어요.")?;
    if task.finished {
        return Err("작업이 이미 끝났어요.".into());
    }
    let cp = task.checkpoints.iter_mut().find(|c| c.id == question_id).ok_or("이 작업의 질문이 아니에요.")?;
    let answer = checkpoint::answer(cp, option_id.as_deref(), custom.as_deref(), now_ms())?;
    if cp.state != "pending" {
        let same = cp.answer.as_ref().is_some_and(|a| a.option_id == answer.option_id && a.custom == answer.custom);
        if same {
            drop(link);
            return snapshot(&app).ok_or_else(|| "작업이 없습니다.".into()); // duplicate click: nothing new
        }
        return Err("이미 답한 질문이에요.".into());
    }
    cp.answer = Some(answer.clone());
    cp.state = "answered".into();
    cp.answered_at = Some(answer.at);
    let detail = json!({ "questionId": cp.id, "answer": answer });
    task.log("answered-in-pet", detail);
    update(&app, |s| {
        s.phase = "resuming".into();
        s.last_event = Some("선택한 방향으로 계속 진행할게요".into());
    });
    sync_questions(&app, task);
    publish(&app, &link);
    drop(link);
    snapshot(&app).ok_or_else(|| "작업이 없습니다.".into())
}

#[tauri::command]
pub fn pet_slides_status(app: AppHandle) -> Option<JobStatus> {
    snapshot(&app)
}

/// Which chat is waiting for the pet right now (shown before '제작 시작').
#[tauri::command]
pub fn pet_chat_status(app: AppHandle) -> Value {
    start_monitor(&app);
    let link = lock_link(&app);
    json!({
        "waiting": link.waiter.as_ref().map(|w| json!({ "thread": w.thread, "since": w.since })),
        "ownerThread": owner_thread(&app),
    })
}

#[tauri::command]
pub fn pet_slides_open(app: AppHandle, target: String) -> Result<(), String> {
    let status = snapshot(&app).ok_or("작업이 없습니다.")?;
    let file = status.output_file.ok_or("결과 파일이 없습니다.")?;
    let path = PathBuf::from(&file);
    if !path.is_file() {
        return Err("결과 파일을 찾을 수 없습니다.".into());
    }
    let mut command = Command::new("explorer.exe");
    if target == "folder" {
        command.arg(format!("/select,{}", path.display()));
    } else {
        command.arg(&path);
    }
    command.spawn().map(|_| ()).map_err(|e| format!("열 수 없습니다: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_require_presentation_and_skill() {
        let ok = json!({
            "featureId": "presentation", "skills": ["autopets-presentation"],
            "settings": {
                "purpose": { "label": "학교 발표" }, "topic": { "label": "주제" }, "length": { "label": "6~10장" },
                "style": { "label": "심플" }, "priority": { "label": "균형" }
            }
        });
        assert_eq!(build_settings(&ok).unwrap()["topic"], "주제");
        assert!(build_settings(&json!({ "featureId": "other" })).is_err());
        let mut missing = ok.clone();
        missing["settings"]["topic"]["label"] = json!("  ");
        assert!(build_settings(&missing).is_err());
    }

    #[test]
    fn skill_evidence_needs_the_full_text_after_the_claim() {
        let dir = std::env::temp_dir().join(format!("autopet-evidence-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let rollout = dir.join("rollout.jsonl");
        let body = "---\nname: autopets-presentation\n---\n\n# 발표자료 만들기\n\n청중과 핵심 메시지를 정리하고 기본 5장의 발표 흐름을 계획하세요. 긴 줄 하나 더.";
        let before = json!({ "type": "event_msg", "payload": { "type": "item_completed", "item": { "type": "CommandExecution", "aggregated_output": body } } });
        fs::write(&rollout, format!("{before}\n")).unwrap();
        let offset = fs::metadata(&rollout).unwrap().len();
        // Read before the claim does not count.
        assert!(!skill_loaded(Some(&rollout), offset, body).0);
        let path_only = json!({ "type": "event_msg", "payload": { "type": "item_completed", "item": { "type": "CommandExecution", "aggregated_output": "Get-Content C:/x/autopets-presentation/SKILL.md (name only, no content here at all)" } } });
        let after = json!({ "type": "event_msg", "payload": { "type": "item_completed", "item": { "type": "CommandExecution", "aggregated_output": body.replace('\n', "\r\n") } } });
        fs::write(&rollout, format!("{before}\n{path_only}\n")).unwrap();
        assert!(!skill_loaded(Some(&rollout), offset, body).0);
        fs::write(&rollout, format!("{before}\n{path_only}\n{after}\n")).unwrap();
        assert!(skill_loaded(Some(&rollout), offset, body).0);
        let _ = fs::remove_dir_all(dir);
    }
}
