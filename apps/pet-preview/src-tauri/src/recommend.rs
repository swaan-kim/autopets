//! Skill pet recommendations for the Codex chat this pet belongs to.
//!
//! The AutoPets `UserPromptSubmit` hook (integrations/codex/hooks/recommend-hook.mjs)
//! classifies the message the user just sent and, only when that chat is the one that
//! invoked this pet (`ownerThread`), runs `autopet-preview.exe recommend`. The pet then
//! shows the existing catalog pet (dog art, name, reason) in its bubble without taking
//! focus. Nothing here starts work in Codex: accepting only opens the pet's existing setup.
//! State lives in process memory and is dropped when the pet's chat changes.

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The existing AutoPets dog (companion sprite sheet, 4x3 cells; cell 0 is the still pose).
/// Embedded at build time from the desktop app's assets, so no copy lives in this app.
const DOG_ART: &[u8] = include_bytes!("../../../desktop/public/assets/companion-v1/social.webp");
const MAX_REQUEST_CHARS: usize = 1200;
const SEEN_LIMIT: usize = 16;

#[derive(Default)]
pub struct RecommendState {
    current: Option<Value>,
    /// Request fingerprints and turn ids already shown for the owner chat.
    seen: Vec<String>,
    owner: Option<String>,
}
pub type SharedRecommend = Mutex<RecommendState>;

fn with_state<R>(app: &AppHandle, f: impl FnOnce(&mut RecommendState) -> R) -> R {
    let state = app.state::<SharedRecommend>();
    let mut guard = state.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard)
}

fn clean(text: &str, max: usize, multiline: bool) -> Option<String> {
    let value = text.trim();
    (!value.is_empty() && value.chars().count() <= max && !value.chars().any(|c| c.is_control() && !(multiline && c == '\n')))
        .then(|| value.to_owned())
}

fn candidates(value: &Value) -> Option<Vec<Value>> {
    let known = crate::features::catalog_ids();
    let list = value.as_array()?;
    if list.is_empty() || list.len() > 2 { return None; }
    let mut out = Vec::new();
    for item in list {
        let pet_id = item.get("petId")?.as_str()?;
        if !known.iter().any(|id| id == pet_id) || out.iter().any(|v: &Value| v["petId"] == pet_id) { return None; }
        let reason = clean(item.get("reason")?.as_str()?, 200, false)?;
        let cues: Vec<String> = item.get("cues").and_then(Value::as_array).map(|c| c.iter().filter_map(Value::as_str)
            .filter_map(|cue| clean(cue, 32, false)).take(4).collect()).unwrap_or_default();
        out.push(json!({ "petId": pet_id, "reason": reason, "cues": cues }));
    }
    Some(out)
}

/// Keeps state bound to the pet's current chat: another chat's card is never shown.
fn sync_owner(app: &AppHandle, s: &mut RecommendState) {
    let owner = crate::slides::owner_thread(app);
    if s.owner != owner {
        s.owner = owner;
        s.current = None;
        s.seen.clear();
    }
}

/// `chat-recommend` from the hook's `recommend` CLI. `--chat` (not `--thread`, which would
/// re-point the pet's host chat) names the chat the message was sent in.
pub fn offer(app: &AppHandle, argv: &[String]) -> Value {
    let refuse = |state: &str, message: &str| json!({ "ok": false, "state": state, "message": message });
    let Some(chat) = crate::flag(argv, "--chat").filter(|t| crate::handoff::valid_thread(t)) else { return refuse("invalid", "채팅 ID가 없습니다.") };
    let Some(turn) = crate::flag(argv, "--turn").and_then(|t| clean(&t, 128, false)) else { return refuse("invalid", "턴 ID가 없습니다.") };
    let Some(file) = crate::flag(argv, "--file") else { return refuse("invalid", "추천 파일이 없습니다.") };
    let Some(input) = std::fs::read(&file).ok().filter(|b| b.len() <= 64 * 1024).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return refuse("invalid", "추천 파일을 읽지 못했습니다.");
    };
    let (Some(request), Some(fingerprint), Some(candidates)) = (
        input.get("request").and_then(Value::as_str).and_then(|r| clean(r, MAX_REQUEST_CHARS, true)),
        input.get("fingerprint").and_then(Value::as_str).filter(|f| f.len() == 64 && f.chars().all(|c| c.is_ascii_hexdigit())).map(str::to_owned),
        input.get("candidates").and_then(candidates),
    ) else { return refuse("invalid", "추천 내용이 올바르지 않습니다.") };
    let answer = with_state(app, |s| {
        sync_owner(app, s);
        if s.owner.as_deref() != Some(chat.as_str()) {
            return refuse("not-owner", "이 펫과 연결된 채팅이 아닙니다.");
        }
        let turn_key = format!("turn:{turn}");
        if s.seen.contains(&turn_key) || s.seen.contains(&fingerprint) {
            return json!({ "ok": true, "state": "duplicate" });
        }
        s.seen.extend([turn_key, fingerprint.clone()]);
        let excess = s.seen.len().saturating_sub(SEEN_LIMIT * 2);
        s.seen.drain(..excess);
        let id = format!("rec-{}-{}", std::process::id(), crate::slides::now_ms());
        s.current = Some(json!({
            "id": id, "chat": chat, "turnId": turn, "state": "shown", "request": request,
            "requestTruncated": input.get("requestTruncated").and_then(Value::as_bool).unwrap_or(false),
            "candidates": candidates, "acceptedPetId": null, "at": crate::slides::now_ms(),
        }));
        json!({ "ok": true, "state": "shown", "id": id })
    });
    if answer["state"] == "shown" {
        // A hidden pet comes back unfocused so the recommendation can be seen.
        crate::pet::reveal(app);
    }
    answer
}

#[tauri::command]
pub fn pet_recommendation_get(app: AppHandle) -> Value {
    with_state(&app, |s| { sync_owner(&app, s); s.current.clone().unwrap_or(Value::Null) })
}

/// `accept` (with a catalog `petId`), `browse` or `dismiss`. Only changes this card.
#[tauri::command]
pub fn pet_recommendation_respond(app: AppHandle, id: String, action: String, pet_id: Option<String>) -> Result<Value, String> {
    with_state(&app, |s| {
        sync_owner(&app, s);
        let current = s.current.as_mut().filter(|c| c["id"] == id.as_str()).ok_or("추천이 바뀌었습니다.")?;
        match action.as_str() {
            "accept" => {
                let pet = pet_id.filter(|p| crate::features::catalog_ids().contains(p)).ok_or("알 수 없는 펫입니다.")?;
                current["state"] = json!("accepted");
                current["acceptedPetId"] = json!(pet);
            }
            "browse" => current["state"] = json!("browsing"),
            "dismiss" => current["state"] = json!("dismissed"),
            _ => return Err("알 수 없는 동작입니다.".into()),
        }
        Ok(current.clone())
    })
}

/// The dog art as a data URL, fetched once by the page.
#[tauri::command]
pub fn pet_dog_art() -> String {
    format!("data:image/webp;base64,{}", base64(DOG_ART))
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= chunk.len() { TABLE[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64_matches_reference_values() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
    #[test]
    fn candidates_accept_only_existing_catalog_pets() {
        let ok = json!([{ "petId": "presentation", "reason": "발표자료를 제작하려는 것 같아요.", "cues": ["피피티"] }]);
        assert_eq!(candidates(&ok).unwrap()[0]["petId"], "presentation");
        assert!(candidates(&json!([{ "petId": "made-up", "reason": "x", "cues": [] }])).is_none());
        assert!(candidates(&json!([])).is_none());
        let dup = json!([{ "petId": "presentation", "reason": "a" }, { "petId": "presentation", "reason": "b" }]);
        assert!(candidates(&dup).is_none());
        assert!(candidates(&json!([{ "petId": "presentation", "reason": "a\u{0007}" }])).is_none());
    }
    #[test]
    fn dog_art_is_the_embedded_webp() {
        assert_eq!(&DOG_ART[0..4], b"RIFF");
        assert_eq!(&DOG_ART[8..12], b"WEBP");
    }
}
