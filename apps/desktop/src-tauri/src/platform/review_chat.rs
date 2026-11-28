//! 복습 도우미: the pet types one fixed request into the composer of its own linked Codex chat
//! (`codex://threads/<id>?prompt=`). Nothing is sent; the user presses send. The chat is always the
//! pet link's target, never a guess at whichever chat is on screen. Also the app's 문제 묶음 pages
//! (which fill a 복습 도우미 chat the same way), and the once-a-day "복습할 때예요" notice.
use crate::application::store::{SharedStore, Store};
use crate::domain::{pet_link::{Link, Target}, roles::RoleId};
use std::{collections::HashMap, sync::Mutex, time::{Duration, Instant}};
use tauri::Manager;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Kind { Quiz, Explain, Review }

/// The requests start with "AutoPets 스킬로" like every other pet request, so Codex uses the
/// AutoPets skill (references/review-helper.md) for them.
pub(crate) fn prompt(kind: Kind) -> &'static str {
    match kind {
        Kind::Quiz => "AutoPets 스킬로 방금 공부한 내용으로 문제 10개 내줘",
        Kind::Explain => "AutoPets 스킬로 방금 내용을 더 쉽게 설명해줘",
        Kind::Review => "AutoPets 스킬로 복습 문제 내줘",
    }
}

/// "Codex에서 복습 N" (that batch's part of today's list) or "전체 다시 풀기" on a batch page.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BatchKind { Due, All }

/// The batch's name for the user and its short id for the skill (`pet.mjs review-due --batch`).
/// No count: the skill sizes the review to what the batch covers (and may add new questions).
pub(crate) fn batch_prompt(name: &str, id: &str, kind: BatchKind) -> String {
    match kind {
        BatchKind::Due => format!("AutoPets 스킬로 「{name}」 복습 문제 내줘 (묶음 {id})"),
        BatchKind::All => format!("AutoPets 스킬로 「{name}」 전체 다시 풀기 (묶음 {id})"),
    }
}

const REPEAT: Duration = Duration::from_secs(3);
static RECENT: Mutex<Option<HashMap<String, (Kind, Instant)>>> = Mutex::new(None);

fn pet_slot(label: &str) -> Result<usize, String> {
    match label { "pet-0" => Ok(0), "pet-1" => Ok(1), "pet-2" => Ok(2), _ => Err("펫 창에서만 사용할 수 있습니다.".into()) }
}

/// Which chat this pet window may type into, or why not. Checked in this order so the UI can show
/// the existing "다시 연결" guide for a disconnected pet.
pub(crate) fn check(store: &Store, slot: usize, kind: Kind, expected_revision: u64, now: u64) -> Result<Link, String> {
    let link = store.pet_links.values().find(|l| l.slot == slot).cloned().ok_or("pet-not-connected")?;
    if link.template.id != RoleId::ReviewHelper { return Err("not-review-pet".into()); }
    if link.target.source_id != crate::domain::connections::CODEX_LOCAL { return Err("pet-target-mismatch".into()); }
    if link.revision != expected_revision { return Err("pet-revision-changed".into()); }
    if !link.connected { return Err("pet-not-connected".into()); }
    if !link.enabled || link.run.as_ref().is_some_and(crate::domain::pet_link::Run::unresolved) {
        return Err("pet-run-active-or-unresolved".into());
    }
    if kind == Kind::Review && store.review_summary(now).due_by_thread.get(&link.target.thread_id).copied().unwrap_or(0) == 0 { return Err("no-review-due".into()); }
    Ok(link)
}

/// A batch returns only to its original chat. Missing or ambiguous targets never fall back to another pet.
pub(crate) fn batch_link(store: &Store, thread_id: &str) -> Result<Link, String> {
    let links: Vec<&Link> = store.pet_links.values().filter(|l| l.template.id == RoleId::ReviewHelper
        && l.target.source_id == crate::domain::connections::CODEX_LOCAL && l.target.thread_id == thread_id).collect();
    if links.len() != 1 { return Err("review-target-unavailable".into()); }
    let link = links[0];
    if !link.connected { return Err("pet-not-connected".into()); }
    if !link.enabled || link.run.as_ref().is_some_and(crate::domain::pet_link::Run::unresolved) { return Err("pet-run-active-or-unresolved".into()); }
    Ok((*link).clone())
}

fn once(key: String, kind: Kind) -> Result<bool, String> {
    let mut recent = RECENT.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
    let recent = recent.get_or_insert_with(HashMap::new);
    if recent.get(&key).is_some_and(|(previous, at)| *previous == kind && at.elapsed() < REPEAT) { return Ok(false); }
    recent.insert(key, (kind, Instant::now()));
    Ok(true)
}

/// "문제 내기" / "쉽게 설명" / "복습하기": opens this pet's chat with the request in the composer.
#[tauri::command]
pub(crate) fn fill_review_request(
    window: tauri::WebviewWindow,
    store: tauri::State<SharedStore>,
    kind: Kind,
    expected_revision: u64,
) -> Result<(), String> {
    let slot = pet_slot(window.label())?;
    let link = {
        let state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        check(&state, slot, kind, expected_revision, crate::domain::activity::now_ms())?
    };
    if !once(window.label().to_owned(), kind)? { return Ok(()); }
    open_chat(&link, prompt(kind))
}

fn open_chat(link: &Link, text: &str) -> Result<(), String> {
    let uri = super::pet_preferences::codex_chat_uri(&link.target.thread_id, &link.target.cwd, text)?;
    super::pet_preferences::shell_open(&uri).map_err(|_| "Codex 앱을 열지 못했어요. Codex 앱이 설치돼 있는지 확인해 주세요.".into())
}

/// "Codex에서 복습 N" / "전체 다시 풀기" on a batch page: fills a 복습 도우미 chat. Manager window only.
#[tauri::command]
pub(crate) fn fill_review_batch(window: tauri::WebviewWindow, store: tauri::State<SharedStore>, batch_id: String, kind: BatchKind, target: Target, expected_revision: u64) -> Result<(), String> {
    super::connection_setup::require_manager(window.label())?;
    let (link, text) = {
        let state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        let (batch, due) = state.review_batch_due(&batch_id, crate::domain::activity::now_ms())?;
        if kind == BatchKind::Due && due == 0 { return Err("no-review-due".into()); }
        let link = batch_link(&state, &batch.thread_id)?;
        target.validate()?;
        if !link.target.matches(&target) { return Err("pet-target-mismatch".into()); }
        if link.revision != expected_revision { return Err("pet-revision-changed".into()); }
        (link, batch_prompt(&batch.name, &batch.id, kind))
    };
    if !once(format!("{}:{batch_id}:{kind:?}", window.label()), Kind::Review)? { return Ok(()); }
    open_chat(&link, &text)
}

/// The app's 문제 묶음 page. Manager window only.
#[tauri::command]
pub(crate) fn review_batches(window: tauri::WebviewWindow, store: tauri::State<SharedStore>) -> Result<serde_json::Value, String> {
    super::connection_setup::require_manager(window.label())?;
    Ok(store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?.review_batches_view(crate::domain::activity::now_ms()))
}

/// One batch page: the batch and its questions (question, answer, next review day).
#[tauri::command]
pub(crate) fn review_batch(window: tauri::WebviewWindow, store: tauri::State<SharedStore>, id: String) -> Result<serde_json::Value, String> {
    super::connection_setup::require_manager(window.label())?;
    store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?.review_batch_view(&id, crate::domain::activity::now_ms())
}

/// Deletes one question. True when it was the batch's last one, so the batch is gone too.
#[tauri::command]
pub(crate) fn delete_review_card(app: tauri::AppHandle, window: tauri::WebviewWindow, store: tauri::State<SharedStore>, id: String) -> Result<bool, String> {
    super::connection_setup::require_manager(window.label())?;
    let (last, snapshot) = {
        let mut state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        let last = state.delete_review_card(&id)?;
        (last, state.snapshot())
    };
    super::windows::emit(&app, snapshot);
    Ok(last)
}

/// Deletes a batch and its questions (after the page asked once).
#[tauri::command]
pub(crate) fn delete_review_batch(app: tauri::AppHandle, window: tauri::WebviewWindow, store: tauri::State<SharedStore>, id: String) -> Result<(), String> {
    super::connection_setup::require_manager(window.label())?;
    let snapshot = {
        let mut state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        state.delete_review_batch(&id)?;
        state.snapshot()
    };
    super::windows::emit(&app, snapshot);
    Ok(())
}

/// The pet showed today's "복습할 때예요" bubble. False when it was already shown today.
#[tauri::command]
pub(crate) fn mark_review_notice(app: tauri::AppHandle, window: tauri::WebviewWindow, store: tauri::State<SharedStore>) -> Result<bool, String> {
    pet_slot(window.label())?;
    let (first, snapshot) = {
        let mut state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        let first = state.mark_review_notice(crate::domain::activity::now_ms())?;
        (first, state.snapshot())
    };
    if first { super::windows::emit(&app, snapshot); }
    Ok(first)
}

/// Pet slots linked to a 복습 도우미 pet.
fn review_slots(store: &Store, summary: &crate::domain::review::Summary) -> Vec<usize> {
    store.pet_links.values().filter(|l| l.template.id == RoleId::ReviewHelper && l.connected && l.enabled
        && summary.due_by_thread.get(&l.target.thread_id).copied().unwrap_or(0) > 0).map(|l| l.slot).collect()
}

/// Every 10 minutes: refresh the pets when the review count changes (a new day starts), and show a
/// Windows notice once a day when cards are due but every 복습 도우미 pet is hidden. A pet tucked
/// into the screen edge counts as shown: its handle carries the badge.
pub(crate) fn start_review_clock(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_due = None;
        loop {
            std::thread::sleep(Duration::from_secs(600));
            let Some(store) = app.try_state::<SharedStore>() else { continue };
            let now = crate::domain::activity::now_ms();
            let (summary, slots) = match store.lock() {
                Ok(state) => { let summary = state.review_summary(now); let slots = review_slots(&state, &summary); (summary, slots) },
                Err(_) => continue,
            };
            if last_due != Some(summary.due) {
                if last_due.is_some() { if let Ok(state) = store.lock() { super::windows::emit(&app, state.snapshot()); } }
                last_due = Some(summary.due);
            }
            if summary.due == 0 || summary.notified_today || slots.is_empty() { continue; }
            let hidden = slots.iter().all(|slot| app.get_webview_window(&format!("pet-{slot}")).is_none_or(|w| !w.is_visible().unwrap_or(false)));
            if !hidden { continue; }
            let first = store.lock().ok().and_then(|mut state| state.mark_review_notice(now).ok()).unwrap_or(false);
            if first {
                use tauri_plugin_notification::NotificationExt;
                let _ = app.notification().builder().title("복습할 때예요")
                    .body(format!("복습할 문제 {}개 · 펫을 다시 꺼내 시작하세요", summary.due)).show();
                if let Ok(state) = store.lock() { super::windows::emit(&app, state.snapshot()); }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_fixed_short_and_name_the_autopets_skill() {
        for kind in [Kind::Quiz, Kind::Explain, Kind::Review] {
            let text = prompt(kind);
            assert!(text.starts_with("AutoPets 스킬로 "));
            let uri = super::super::pet_preferences::codex_chat_uri("11111111-2222-4333-8444-555555555555", "C:/study", text).unwrap();
            assert!(uri.starts_with("codex://threads/11111111-2222-4333-8444-555555555555?prompt="));
        }
        // Ten by default; the skill gives fewer (at least 3) when little was studied.
        assert_eq!(prompt(Kind::Quiz), "AutoPets 스킬로 방금 공부한 내용으로 문제 10개 내줘");
        // A batch request names the batch for the user and carries its short id for the skill.
        // No fixed count: the skill sizes a batch review to what the batch covers.
        assert_eq!(batch_prompt("통합 마케팅 커뮤니케이션", "ab12cd34", BatchKind::Due), "AutoPets 스킬로 「통합 마케팅 커뮤니케이션」 복습 문제 내줘 (묶음 ab12cd34)");
        assert_eq!(batch_prompt("통합 마케팅 커뮤니케이션", "ab12cd34", BatchKind::All), "AutoPets 스킬로 「통합 마케팅 커뮤니케이션」 전체 다시 풀기 (묶음 ab12cd34)");
        let uri = super::super::pet_preferences::codex_chat_uri("11111111-2222-4333-8444-555555555555", "C:/study", &batch_prompt("이름", "ab12cd34", BatchKind::All)).unwrap();
        assert!(uri.contains("?prompt="));
    }

    #[test]
    fn a_batch_page_requires_its_original_connected_chat_without_fallback() {
        use crate::domain::pet_link::{Request, Target};
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let chat = |id: &str| Target { source_id: "codex-windows-local".into(), thread_id: id.into(), cwd: dir.path().to_string_lossy().into() };
        let (a, b) = (chat("11111111-1111-4111-8111-111111111111"), chat("22222222-2222-4222-8222-222222222222"));
        assert_eq!(batch_link(&store, &b.thread_id).unwrap_err(), "review-target-unavailable");
        store.pet_link_request(Request::Connect { target: a.clone() }).unwrap();
        assert_eq!(batch_link(&store, &b.thread_id).unwrap_err(), "review-target-unavailable", "another pet is never used");
        store.pet_links.get_mut(&a.key()).unwrap().template = review_template();
        assert_eq!(batch_link(&store, &b.thread_id).unwrap_err(), "review-target-unavailable", "another connected review chat is never used");
        store.pet_link_request(Request::Connect { target: b.clone() }).unwrap();
        store.pet_links.get_mut(&b.key()).unwrap().template = review_template();
        assert_eq!(batch_link(&store, &b.thread_id).unwrap().target, b, "the chat that made the batch");
        assert_eq!(batch_link(&store, "33333333-3333-4333-8333-333333333333").unwrap_err(), "review-target-unavailable");
        store.pet_links.get_mut(&b.key()).unwrap().connected = false;
        assert_eq!(batch_link(&store, &b.thread_id).unwrap_err(), "pet-not-connected", "a disconnected original is not replaced");
        store.pet_links.get_mut(&a.key()).unwrap().connected = false;
        assert_eq!(batch_link(&store, &b.thread_id).unwrap_err(), "pet-not-connected", "the UI shows 다시 연결");
    }

    fn review_template() -> crate::domain::roles::Template {
        let catalog: serde_json::Value = serde_json::from_str(include_str!("../../../../../packages/contracts/data/pet-catalog.json")).unwrap();
        let entry = catalog.as_array().unwrap().iter().find(|e| e["id"] == "review-helper").unwrap();
        serde_json::from_value(entry["template"].clone()).unwrap()
    }

    #[test]
    fn only_the_connected_review_pet_of_this_window_may_type_into_its_own_chat() {
        use crate::domain::pet_link::{Request, Target, Profile};
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::new(dir.path()).unwrap();
        let chat = |id: &str| Target { source_id: "codex-windows-local".into(), thread_id: id.into(), cwd: dir.path().to_string_lossy().into() };
        let (a, b) = (chat("11111111-1111-4111-8111-111111111111"), chat("22222222-2222-4222-8222-222222222222"));
        let now = crate::domain::activity::now_ms();
        let first = store.pet_link_request(Request::Connect { target: a.clone() }).unwrap().unwrap();
        let other = store.pet_link_request(Request::Connect { target: b.clone() }).unwrap().unwrap();
        // Another pet: never.
        assert_eq!(check(&store, first.slot, Kind::Quiz, 1, now).unwrap_err(), "not-review-pet");
        store.pet_links.get_mut(&a.key()).unwrap().template = review_template();
        let link = check(&store, first.slot, Kind::Quiz, 1, now).unwrap();
        assert_eq!(link.target, a, "always the pet's own chat");
        assert_eq!(check(&store, other.slot, Kind::Quiz, 1, now).unwrap_err(), "not-review-pet", "the other window's chat is not used");
        assert_eq!(check(&store, 2, Kind::Quiz, 1, now).unwrap_err(), "pet-not-connected", "an empty slot");
        assert_eq!(check(&store, first.slot, Kind::Quiz, 2, now).unwrap_err(), "pet-revision-changed");
        assert_eq!(check(&store, first.slot, Kind::Review, 1, now).unwrap_err(), "no-review-due");
        // A running pet task must be checked first; a review needs no new pet task.
        store.pet_link_request(Request::Prepare { target: a.clone(), expected_revision: 1, request_id: "33333333-3333-4333-8333-333333333333".into(), profile: Profile::Light }).unwrap();
        assert_eq!(check(&store, first.slot, Kind::Explain, 1, now).unwrap_err(), "pet-run-active-or-unresolved");
        assert_eq!(check(&store, first.slot, Kind::Review, 1, now).unwrap_err(), "pet-run-active-or-unresolved");
        assert_eq!(batch_link(&store, &a.thread_id).unwrap_err(), "pet-run-active-or-unresolved");
        store.pet_links.get_mut(&a.key()).unwrap().connected = false;
        assert_eq!(check(&store, first.slot, Kind::Quiz, 1, now).unwrap_err(), "pet-not-connected", "disconnected: the UI shows 다시 연결");
    }
}
