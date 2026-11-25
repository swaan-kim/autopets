//! "시작": a pet's start request, sent straight into a Codex chat when the user presses start on
//! the pet screen or in the floating pet's start card.
//!
//! The words are built here from the saved pet and what the user typed; the screen only passes
//! those fields and the chat it showed. The chat is the one that ran `$autopets` or a chat a pet
//! is connected to (`codex_chat::allowed_chat`). Codex cannot create a new chat and send into it,
//! so only when no such chat exists does a new Codex chat open with the request typed in, for the
//! user to send.
use crate::application::store::SharedStore;
use crate::domain::roles::SavedPet;
use crate::platform::codex_chat::{allowed_chat, deliver, has_ready_chat, validate_request, Delivery, START_REPEAT_MS};
use serde::Deserialize;

/// The pet screen's own example job (UiPetStudio `EXAMPLE_TASK`).
const EXAMPLE_TASK: &str = "가상 학과 행사 소개 웹페이지 한 장. 행사 소개, 일정, 신청 안내와 모바일 화면을 포함해줘.";
const MAX_TASK: usize = 1200;
const MAX_QUICK_TASK: usize = 200;
const MAX_LINE: usize = 160;

#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub(crate) enum Start {
    /// The pet screen (UiPetStudio `uiPetStartPrompt`). An empty task continues what the calling
    /// chat already asked for, so it is only allowed for that chat.
    Detail { task: String, #[serde(default)] audience: String, #[serde(default)] message: String, #[serde(default)] new_task: bool },
    /// The floating pet's "새 일 맡기기" (`petStartRequest`): a catalog pet by its catalog id.
    Quick { entry: String, task: String },
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Chat { thread_id: String, cwd: String }

fn catalog() -> &'static serde_json::Value {
    static CATALOG: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("../../../../../packages/contracts/data/pet-catalog.json")).unwrap_or_default())
}

fn recipe_ids() -> &'static Vec<String> {
    static IDS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    IDS.get_or_init(|| {
        let data: serde_json::Value = serde_json::from_str(include_str!("../../../../../packages/contracts/data/recipes.json")).unwrap_or_default();
        data["recipes"].as_array().into_iter().flatten().filter_map(|r| r["id"].as_str().map(str::to_owned)).collect()
    })
}

fn field(value: &str, max: usize, lines: bool) -> Result<String, String> {
    let value = value.trim();
    if value.chars().count() > max || value.chars().any(|c| c.is_control() && !(lines && c == '\n')) {
        return Err("invalid-start-request".into());
    }
    Ok(value.to_owned())
}

/// Must stay word for word with UiPetStudio `uiPetStartPrompt`, which shows and copies the same request.
pub(crate) fn detail_request(pet: &SavedPet, task: &str, audience: &str, message: &str, new_task: bool) -> Result<String, String> {
    let (task, audience, message) = (field(task, MAX_TASK, true)?, field(audience, MAX_LINE, false)?, field(message, MAX_LINE, false)?);
    let plan = pet.template.plan_first;
    let mut lines = vec![format!("AutoPets 스킬로 현재 채팅에 {}을 연결해줘. 저장한 펫: petId={}, petRevision={}.", pet.template.name, pet.id, pet.revision)];
    lines.push(if task.is_empty() {
        format!("이 채팅에서 앞서 요청한 일을 이 펫으로 {}.", if plan { "이어받아 계획만 세워줘" } else { "이어서 진행하고 결과를 채팅에 보여줘" })
    } else {
        format!("이 펫으로 아래 작업{}.\n\n{task}\n", if plan { "의 계획만 세워줘" } else { "을 수행하고 결과를 채팅에 보여줘" })
    });
    // The screen asks for these only for 웹페이지 만들기 and sends them empty otherwise.
    if !audience.is_empty() { lines.push(format!("이 페이지를 볼 사람: {audience}")); }
    if !message.is_empty() { lines.push(format!("꼭 알릴 내용: {message}")); }
    if new_task { lines.push("새로운 작업이야. 이전 작업의 내용이나 계획 승인을 이 요청에 재사용하지 마.".into()); }
    lines.push(if pet.template.features.figma_design {
        "Figma 시안 활용 특성을 선택했어. 사용할 프레임 링크를 나에게 먼저 확인하고, 실제 시안을 읽은 뒤 계획해줘. 연결이나 접근이 안 되면 필요한 조치를 알려줘."
    } else {
        "별도 서비스 연결 없이 가능한 범위부터 도와주고, 외부 서비스가 필요하면 먼저 알려줘."
    }.into());
    lines.push(if plan {
        "지금은 파일을 바꾸지 말고 계획을 보여준 뒤 내 구현 요청을 기다려줘. 구현 위치와 기존 파일을 먼저 확인하고 기존 내용을 덮어쓰지 마."
    } else {
        "파일을 수정하거나 외부 서비스에 등록하지 말고, 제공한 내용을 바탕으로 결과를 보여줘. 확인할 수 없는 사실은 미확인으로 구분해줘."
    }.into());
    if task == EXAMPLE_TASK {
        lines.push("이 예시에는 실제 개인정보 대신 가상 내용을 사용하고, 구현할 때는 새 autopets-demo 폴더를 사용하되 기존 파일이 있으면 먼저 알려줘.".into());
    }
    Ok(lines.join("\n"))
}

/// Must stay word for word with `petStartRequest({ via: 'skill' })` (packages/guidance/start-request.mjs).
pub(crate) fn quick_request(pet: &SavedPet, entry_id: &str, task: &str) -> Result<String, String> {
    let task = field(task, MAX_QUICK_TASK, false)?;
    let entry = catalog().as_array().into_iter().flatten().find(|e| e["id"] == entry_id).ok_or("invalid-start-request")?;
    let template = &entry["template"];
    let skill = pet.template.skills.first().map(|s| s.id.as_str());
    if serde_json::to_value(&pet.template.id).ok().as_ref() != Some(&template["id"]) || template["skills"][0]["id"].as_str() != skill {
        return Err("invalid-start-request".into());
    }
    let name = entry["name"].as_str().ok_or("invalid-start-request")?;
    let recipe = recipe_ids().iter().any(|id| id == entry_id).then(|| format!(", recipe={entry_id}")).unwrap_or_default();
    let mut text = format!("AutoPets 스킬로 \"{name}\" 시작해줘. petId={}, petRevision={}{recipe}.", pet.id, pet.revision);
    if !task.is_empty() { text.push_str(&format!("\n할 일: {task}")); }
    Ok(text)
}

fn start_text(pet: &SavedPet, start: &Start, to_calling_chat: bool) -> Result<String, String> {
    let text = match start {
        Start::Detail { task, audience, message, new_task } => {
            if task.trim().is_empty() && !to_calling_chat { return Err("empty-task".into()); }
            detail_request(pet, task, audience, message, *new_task)?
        }
        Start::Quick { entry, task } => quick_request(pet, entry, task)?,
    };
    validate_request(&pet.id, pet.revision, &text)?;
    Ok(text)
}

/// The manager window or one of the three pet windows.
fn app_window(label: &str) -> Result<(), String> {
    if matches!(label, "main" | "pet-0" | "pet-1" | "pet-2") { Ok(()) } else { Err("앱 창에서만 사용할 수 있습니다.".into()) }
}

/// Start a saved pet. With `chat` (the chat the screen showed): sent there and that chat opens.
/// Without: only when no chat can take it, a new Codex chat opens with the request typed in.
#[tauri::command]
pub(crate) async fn send_pet_start(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, SharedStore>,
    pet_id: String,
    expected_revision: u64,
    start: Start,
    chat: Option<Chat>,
) -> Result<Delivery, String> {
    app_window(window.label())?;
    let (data_dir, target, text) = {
        let state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        let pet = state.saved_pet(&pet_id)?.ok_or("saved-pet-not-found")?;
        if pet.revision != expected_revision { return Err("saved-pet-revision-changed".into()); }
        let target = chat.map(|c| allowed_chat(&state, &c.thread_id, &c.cwd)).transpose()?;
        let to_calling_chat = target.as_ref().is_some_and(|t| state.setup_chat().as_ref() == Some(t));
        let text = start_text(&pet, &start, to_calling_chat)?;
        // A new chat cannot be sent to, so it is used only when there is no chat to send to.
        if target.is_none() && has_ready_chat(&state) { return Err("codex-chat-available".into()); }
        (state.data_dir.clone(), target, text)
    };
    match target {
        Some(chat) => deliver(data_dir, chat, text, START_REPEAT_MS).await,
        None => new_chat(&pet_id, expected_revision, text),
    }
}

fn new_chat(pet_id: &str, revision: u64, text: String) -> Result<Delivery, String> {
    let now = crate::domain::activity::now_ms();
    match crate::platform::pet_preferences::codex_new_thread_uri(pet_id, revision, &text) {
        Ok(uri) => {
            crate::platform::pet_preferences::shell_open(&uri).map_err(|_| "Codex 앱을 열지 못했어요. Codex 앱이 설치돼 있는지 확인해 주세요.")?;
            Ok(Delivery { outcome: "new-chat", sent_at: now, chat_opened: true, ..Default::default() })
        }
        Err(error) if error == "prompt-too-long" => Ok(Delivery { outcome: "copy", sent_at: now, text: Some(text), ..Default::default() }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pet(entry: &str) -> SavedPet {
        let found = catalog().as_array().unwrap().iter().find(|e| e["id"] == entry).unwrap();
        SavedPet { id: "b5850a8e-b572-496b-b254-7f4687fcf75f".into(), revision: 3, template: serde_json::from_value(found["template"].clone()).unwrap(), updated_at: 0 }
    }

    #[test]
    fn the_pet_screen_request_matches_the_screen_word_for_word() {
        let daily = pet("daily-plan");
        assert_eq!(detail_request(&daily, "  오늘 할 일 정리\n회의 3시 ", "", "", false).unwrap(), [
            "AutoPets 스킬로 현재 채팅에 하루 정리 펫을 연결해줘. 저장한 펫: petId=b5850a8e-b572-496b-b254-7f4687fcf75f, petRevision=3.",
            "이 펫으로 아래 작업을 수행하고 결과를 채팅에 보여줘.\n\n오늘 할 일 정리\n회의 3시\n",
            "별도 서비스 연결 없이 가능한 범위부터 도와주고, 외부 서비스가 필요하면 먼저 알려줘.",
            "파일을 수정하거나 외부 서비스에 등록하지 말고, 제공한 내용을 바탕으로 결과를 보여줘. 확인할 수 없는 사실은 미확인으로 구분해줘.",
        ].join("\n"));
        // The calling chat already holds the job: an empty task continues it.
        assert!(detail_request(&daily, " ", "", "", false).unwrap().contains("\n이 채팅에서 앞서 요청한 일을 이 펫으로 이어서 진행하고 결과를 채팅에 보여줘.\n"));
        let web = pet("ui-webpage");
        let text = detail_request(&web, EXAMPLE_TASK, "신입생", "마감 금요일", true).unwrap();
        assert_eq!(text, [
            "AutoPets 스킬로 현재 채팅에 UI 제작 펫을 연결해줘. 저장한 펫: petId=b5850a8e-b572-496b-b254-7f4687fcf75f, petRevision=3.",
            &format!("이 펫으로 아래 작업의 계획만 세워줘.\n\n{EXAMPLE_TASK}\n"),
            "이 페이지를 볼 사람: 신입생", "꼭 알릴 내용: 마감 금요일",
            "새로운 작업이야. 이전 작업의 내용이나 계획 승인을 이 요청에 재사용하지 마.",
            "별도 서비스 연결 없이 가능한 범위부터 도와주고, 외부 서비스가 필요하면 먼저 알려줘.",
            "지금은 파일을 바꾸지 말고 계획을 보여준 뒤 내 구현 요청을 기다려줘. 구현 위치와 기존 파일을 먼저 확인하고 기존 내용을 덮어쓰지 마.",
            "이 예시에는 실제 개인정보 대신 가상 내용을 사용하고, 구현할 때는 새 autopets-demo 폴더를 사용하되 기존 파일이 있으면 먼저 알려줘.",
        ].join("\n"));
        assert_eq!(detail_request(&daily, "a\u{7}", "", "", false).unwrap_err(), "invalid-start-request", "no control characters");
        assert_eq!(detail_request(&daily, "일", "두\n줄", "", false).unwrap_err(), "invalid-start-request", "one-line fields stay one line");
        assert_eq!(detail_request(&daily, &"가".repeat(MAX_TASK + 1), "", "", false).unwrap_err(), "invalid-start-request");
    }

    #[test]
    fn the_start_card_request_matches_the_shared_builder_and_names_its_recipe() {
        let presentation = pet("presentation");
        assert_eq!(quick_request(&presentation, "presentation", " 동아리 소개 발표 ").unwrap(),
            "AutoPets 스킬로 \"발표자료 만들기\" 시작해줘. petId=b5850a8e-b572-496b-b254-7f4687fcf75f, petRevision=3, recipe=presentation.\n할 일: 동아리 소개 발표");
        assert_eq!(quick_request(&presentation, "presentation", "").unwrap(),
            "AutoPets 스킬로 \"발표자료 만들기\" 시작해줘. petId=b5850a8e-b572-496b-b254-7f4687fcf75f, petRevision=3, recipe=presentation.");
        assert_eq!(quick_request(&presentation, "daily-plan", "x").unwrap_err(), "invalid-start-request", "another catalog pet's words are refused");
        assert_eq!(quick_request(&presentation, "no-such-pet", "x").unwrap_err(), "invalid-start-request");
        assert_eq!(quick_request(&presentation, "presentation", "두\n줄").unwrap_err(), "invalid-start-request");
    }

    #[test]
    fn an_empty_task_goes_only_to_the_calling_chat() {
        let daily = pet("daily-plan");
        let start = Start::Detail { task: " ".into(), audience: String::new(), message: String::new(), new_task: false };
        assert!(start_text(&daily, &start, true).is_ok());
        assert_eq!(start_text(&daily, &start, false).unwrap_err(), "empty-task");
        let parsed: Start = serde_json::from_value(serde_json::json!({"kind": "quick", "entry": "presentation", "task": "x"})).unwrap();
        assert!(matches!(parsed, Start::Quick { .. }));
        assert!(serde_json::from_value::<Start>(serde_json::json!({"kind": "detail", "task": "x", "prompt": "anything"})).is_err(), "no free text field");
        assert!(app_window("main").is_ok() && app_window("pet-2").is_ok() && app_window("pet-3").is_err());
    }
}
