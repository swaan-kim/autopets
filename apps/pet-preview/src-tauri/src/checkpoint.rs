//! Mid-task questions (human-in-the-loop) for the presentation pet.
//!
//! While the invoking Codex chat works on a task, its model can stop at a
//! decision point and ask the user through the pet:
//!
//! 1. it writes the question it actually derived from its own work (e.g. two
//!    outlines it drafted) to a JSON file in the task's output folder,
//! 2. runs `autopet-preview.exe ask --task <id> --file <that file>`, which
//!    blocks inside the chat's own turn (the turn, its context and earlier
//!    results stay as they are),
//! 3. the pet shows the question; the user answers in the pet,
//! 4. `ask` prints the answer and exits, and the same turn continues with it.
//!
//! Codex's own `request_user_input` is not used: in Codex 0.166 it is
//! experimental and limited to Plan mode (`default_mode_request_user_input`
//! is off), and like approvals and MCP elicitations it is answered by the
//! Codex window that owns the chat, which the pet cannot reach.
//!
//! This module holds the data model, validation of the chat's question file
//! and the checks run on the finished deck. State lives in `slides::Task`.

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// The first (required) intervention of a presentation task.
pub const REQUIRED_STAGE: &str = "outline";
/// Questions per task: the outline plus up to three real decision points.
pub const MAX_PER_TASK: usize = 4;
const STAGES: [&str; 5] = ["outline", "length", "design", "evidence", "other"];

#[derive(Clone, Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub label: String,
    pub summary: String,
    /// Planned slide titles (outline options).
    pub slides: Vec<String>,
}

#[derive(Clone, Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    /// The chosen option, or None for a custom ("직접 수정") answer.
    pub option_id: Option<String>,
    pub label: String,
    pub custom: Option<String>,
    pub at: u64,
}

#[derive(Clone, Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub task_id: String,
    pub seq: u32,
    /// Where in the work the question came up: outline | length | design | evidence | other
    pub stage: String,
    pub title: String,
    pub question: String,
    pub reason: String,
    pub options: Vec<Choice>,
    pub allow_custom: bool,
    /// pending (waiting for the user) | answered (not yet picked up by the
    /// chat) | delivered (the chat's `ask` received it and the work resumed)
    /// | cancelled (the task ended first)
    pub state: String,
    pub asked_at: u64,
    pub answered_at: Option<u64>,
    pub delivered_at: Option<u64>,
    pub answer: Option<Answer>,
    /// The chat's question file (as asked).
    pub source_file: String,
    /// Same content asked again (e.g. after a timeout) re-attaches to this one.
    pub digest: String,
    /// The `ask` process waiting for this answer.
    pub ask_pid: u32,
    /// The chat posted the decision in its own messages after receiving it
    /// (seen in its session record, not assumed).
    pub chat_shown: bool,
    /// For the outline: how far the finished deck follows the chosen outline.
    pub outline_match: Option<Value>,
}

impl Checkpoint {
    pub fn is_open(&self) -> bool {
        self.state == "pending" || self.state == "answered"
    }

    pub fn chosen(&self) -> Option<&Choice> {
        let id = self.answer.as_ref()?.option_id.as_ref()?;
        self.options.iter().find(|o| &o.id == id)
    }
}

/// A validated question as written by the chat.
pub struct Parsed {
    pub stage: String,
    pub title: String,
    pub question: String,
    pub reason: String,
    pub options: Vec<Choice>,
    pub allow_custom: bool,
    pub digest: String,
}

fn clean(value: Option<&Value>, max: usize) -> String {
    let text = value.and_then(Value::as_str).unwrap_or("");
    let flat: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(max).collect()
}

fn decode(bytes: &[u8]) -> Result<String, String> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(rest.to_vec()).map_err(|_| "질문 파일이 UTF-8이 아닙니다.".into());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let units: Vec<u16> = rest.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return String::from_utf16(&units).map_err(|_| "질문 파일을 읽을 수 없습니다.".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "질문 파일이 UTF-8이 아닙니다.".into())
}

fn default_title(stage: &str) -> &'static str {
    match stage {
        "outline" => "발표자료 구성안 선택",
        "length" => "분량 확인",
        "design" => "디자인 방향 선택",
        "evidence" => "근거가 부족한 내용",
        _ => "확인이 필요해요",
    }
}

/// Validates the question file the chat wrote.
pub fn parse(bytes: &[u8]) -> Result<Parsed, String> {
    let text = decode(bytes)?;
    let value: Value = serde_json::from_str(text.trim()).map_err(|e| format!("질문 파일 JSON 오류: {e}"))?;
    let stage = clean(value.get("stage"), 20).to_ascii_lowercase();
    if !STAGES.contains(&stage.as_str()) {
        return Err(format!("stage는 {} 중 하나여야 합니다.", STAGES.join("·")));
    }
    let question = clean(value.get("question"), 200);
    if question.is_empty() {
        return Err("question(사용자에게 보일 질문)이 비어 있습니다.".into());
    }
    let mut title = clean(value.get("title"), 40);
    if title.is_empty() {
        title = default_title(&stage).into();
    }
    let raw_options = value.get("options").and_then(Value::as_array).ok_or("options 배열이 없습니다.")?;
    if !(2..=4).contains(&raw_options.len()) {
        return Err("선택지(options)는 2~4개여야 합니다.".into());
    }
    let mut options = Vec::new();
    for (index, raw) in raw_options.iter().enumerate() {
        let mut id: String = clean(raw.get("id"), 8).chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        if id.is_empty() {
            id = ((b'A' + index as u8) as char).to_string();
        }
        if options.iter().any(|o: &Choice| o.id.eq_ignore_ascii_case(&id)) {
            return Err(format!("선택지 id '{id}'가 중복됩니다."));
        }
        let label = clean(raw.get("label"), 40);
        if label.is_empty() {
            return Err(format!("선택지 {id}의 label이 비어 있습니다."));
        }
        let slides: Vec<String> = raw
            .get("slides")
            .and_then(Value::as_array)
            .map(|list| list.iter().map(|s| clean(Some(s), 80)).filter(|s| !s.is_empty()).take(30).collect())
            .unwrap_or_default();
        if stage == REQUIRED_STAGE && slides.len() < 2 {
            return Err(format!("구성안 {id}에는 슬라이드 제목(slides)이 2개 이상 있어야 합니다."));
        }
        options.push(Choice { id, label, summary: clean(raw.get("summary"), 160), slides });
    }
    let allow_custom = value.get("allowCustom").and_then(Value::as_bool).unwrap_or(true);
    let reason = clean(value.get("reason"), 200);
    let digest = {
        let canonical = json!({ "stage": stage, "question": question, "options": options, "allowCustom": allow_custom });
        Sha256::digest(canonical.to_string().as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
    };
    Ok(Parsed { stage, title, question, reason, options, allow_custom, digest })
}

/// Builds the user's answer from what was clicked in the pet.
pub fn answer(cp: &Checkpoint, option_id: Option<&str>, custom: Option<&str>, at: u64) -> Result<Answer, String> {
    let custom = custom.map(|c| c.chars().filter(|ch| !ch.is_control() || *ch == '\n').collect::<String>()).map(|c| c.trim().to_owned());
    match (option_id.filter(|o| !o.is_empty()), custom.filter(|c| !c.is_empty())) {
        (Some(id), None) => {
            let choice = cp.options.iter().find(|o| o.id == id).ok_or("없는 선택지예요.")?;
            Ok(Answer { option_id: Some(choice.id.clone()), label: choice.label.clone(), custom: None, at })
        }
        (None, Some(text)) => {
            if !cp.allow_custom {
                return Err("이 질문은 직접 입력을 받지 않아요.".into());
            }
            let text: String = text.chars().take(300).collect();
            Ok(Answer { option_id: None, label: "직접 수정".into(), custom: Some(text), at })
        }
        _ => Err("선택지 하나를 고르거나 직접 입력하세요.".into()),
    }
}

/// What the chat shows in its own messages once it has the answer.
pub fn chat_summary(cp: &Checkpoint) -> String {
    let mut lines = vec![format!("**{} 완료**", cp.title), String::new()];
    for option in &cp.options {
        lines.push(format!("- {}안: {}", option.id, option.label));
    }
    match &cp.answer {
        Some(Answer { option_id: Some(id), label, .. }) => lines.push(format!("- 사용자 선택: {id}안 ({label})")),
        Some(Answer { custom: Some(text), .. }) => lines.push(format!("- 사용자 선택: 직접 수정 — {text}")),
        _ => {}
    }
    lines.push("- 선택을 반영해 발표자료 제작 계속 진행".into());
    lines.join("\n")
}

/// The answer as printed by `ask` in the chat.
pub fn answer_payload(cp: &Checkpoint) -> Value {
    let answer = cp.answer.clone().unwrap_or_default();
    let chosen = cp.chosen();
    let next = match (&answer.custom, chosen) {
        (Some(text), _) => format!("사용자가 Pet에서 직접 수정했습니다. 이 내용을 반영해 이어서 진행하세요: {text}"),
        (None, Some(choice)) if !choice.slides.is_empty() => format!(
            "사용자가 Pet에서 {}안({})을 골랐습니다. 이 안의 슬라이드 제목을 순서대로 각 슬라이드 제목으로 그대로 써서 이어서 진행하세요.",
            choice.id, choice.label
        ),
        (None, Some(choice)) => format!("사용자가 Pet에서 {}안({})을 골랐습니다. 이 결정대로 이어서 진행하세요.", choice.id, choice.label),
        _ => "이 결정대로 이어서 진행하세요.".into(),
    };
    json!({
        "ok": true,
        "state": "answered",
        "taskId": cp.task_id,
        "questionId": cp.id,
        "stage": cp.stage,
        "question": cp.question,
        "options": cp.options.iter().map(|o| json!({ "id": o.id, "label": o.label })).collect::<Vec<_>>(),
        "choice": {
            "optionId": answer.option_id,
            "label": answer.label,
            "custom": answer.custom,
            "slides": chosen.map(|c| c.slides.clone()).unwrap_or_default(),
        },
        "answeredAt": cp.answered_at,
        "chatSummary": chat_summary(cp),
        "next": next,
    })
}

// ---------------------------------------------------------------- deck checks

/// Visible text of an HTML document (scripts and styles removed).
pub fn html_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len() / 2);
    let mut i = 0;
    while i < html.len() {
        if lower[i..].starts_with("<script") || lower[i..].starts_with("<style") {
            let close = if lower[i..].starts_with("<script") { "</script>" } else { "</style>" };
            i = lower[i..].find(close).map(|p| i + p + close.len()).unwrap_or(html.len());
            continue;
        }
        if html.as_bytes()[i] == b'<' {
            i = html[i..].find('>').map(|p| i + p + 1).unwrap_or(html.len());
            out.push(' ');
            continue;
        }
        let next = html[i..].find('<').map(|p| i + p).unwrap_or(html.len());
        out.push_str(&html[i..next]);
        i = next;
    }
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
}

fn normalize(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// How many of the chosen outline's slide titles appear in the deck, and how
/// many titles that only the other outlines had appear instead.
pub fn outline_match(cp: &Checkpoint, html: &str) -> Value {
    let Some(chosen) = cp.chosen() else {
        return json!({ "ok": true, "checked": false, "note": "직접 수정한 답이라 제목 자동 비교는 하지 않았어요." });
    };
    let text = normalize(&html_text(html));
    let found = |title: &str| {
        let n = normalize(title);
        !n.is_empty() && text.contains(&n)
    };
    let missing: Vec<&String> = chosen.slides.iter().filter(|t| !found(t)).collect();
    let mine: Vec<String> = chosen.slides.iter().map(|t| normalize(t)).collect();
    let others: Vec<&String> = cp
        .options
        .iter()
        .filter(|o| o.id != chosen.id)
        .flat_map(|o| o.slides.iter())
        .filter(|t| !mine.contains(&normalize(t)))
        .collect();
    let others_found = others.iter().filter(|t| found(t)).count();
    let planned = chosen.slides.len();
    let matched = planned - missing.len();
    json!({
        "ok": planned > 0 && matched * 10 >= planned * 7 && matched > others_found,
        "checked": true,
        "optionId": chosen.id,
        "label": chosen.label,
        "planned": planned,
        "found": matched,
        "missing": missing,
        "otherOnlyTitles": others.len(),
        "otherOnlyFound": others_found,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outline() -> Checkpoint {
        let parsed = parse(
            "\u{feff}{\"stage\":\"outline\",\"question\":\"어떤 방향으로 진행할까요?\",\"options\":[\
             {\"id\":\"A\",\"label\":\"기술 원리 중심\",\"slides\":[\"생성형 AI 개념\",\"핵심 기술\",\"결론\"]},\
             {\"id\":\"B\",\"label\":\"실제 활용 사례 중심\",\"slides\":[\"생성형 AI 활용 현황\",\"산업별 사례\",\"결론\"]}]}"
                .as_bytes(),
        )
        .unwrap();
        Checkpoint {
            id: "q1".into(),
            stage: parsed.stage,
            title: parsed.title,
            question: parsed.question,
            options: parsed.options,
            allow_custom: parsed.allow_custom,
            state: "pending".into(),
            ..Default::default()
        }
    }

    #[test]
    fn parse_validates_the_chat_question() {
        let cp = outline();
        assert_eq!(cp.title, "발표자료 구성안 선택");
        assert!(cp.allow_custom);
        assert!(parse(b"{\"stage\":\"outline\",\"question\":\"q\",\"options\":[{\"label\":\"x\",\"slides\":[\"a\"]},{\"label\":\"y\",\"slides\":[\"a\",\"b\"]}]}").is_err());
        assert!(parse(b"{\"stage\":\"nope\",\"question\":\"q\",\"options\":[]}").is_err());
        let ids = parse(b"{\"stage\":\"length\",\"question\":\"q\",\"options\":[{\"label\":\"x\"},{\"label\":\"y\"}]}").unwrap();
        assert_eq!(ids.options.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(), ["A", "B"]);
    }

    #[test]
    fn answers_and_summary() {
        let mut cp = outline();
        assert!(answer(&cp, Some("C"), None, 1).is_err());
        assert!(answer(&cp, None, None, 1).is_err());
        cp.answer = Some(answer(&cp, Some("B"), None, 1).unwrap());
        let summary = chat_summary(&cp);
        assert!(summary.contains("- A안: 기술 원리 중심") && summary.contains("- 사용자 선택: B안 (실제 활용 사례 중심)"));
        assert_eq!(answer_payload(&cp)["choice"]["slides"][1], "산업별 사례");
    }

    #[test]
    fn outline_match_follows_the_chosen_option() {
        let mut cp = outline();
        cp.answer = Some(answer(&cp, Some("B"), None, 1).unwrap());
        let deck = "<html><style>.x{content:'핵심 기술'}</style><section><h2>생성형 AI 활용 현황</h2></section>\
                    <section><h2>산업별&nbsp;사례</h2></section><section><h2>결론</h2></section><script>var t='생성형 AI 개념'</script></html>";
        let m = outline_match(&cp, deck);
        assert_eq!((m["found"].as_u64(), m["otherOnlyFound"].as_u64(), m["ok"].as_bool()), (Some(3), Some(0), Some(true)));
        cp.answer = Some(answer(&cp, Some("A"), None, 1).unwrap());
        assert_eq!(outline_match(&cp, deck)["ok"], false);
    }
}
