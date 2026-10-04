//! One update authority for direct and Store EXE installs. No background network activity.
use serde_json::{json, Value};
use std::time::Duration;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

const ENDPOINT: &str = "https://swaan-kim.github.io/autopets/updates/windows-x64.json";
// Public key is embedded by a release build, never supplied by a webview or a downloaded manifest.
const PUBLIC_KEY: Option<&str> = option_env!("AUTOPETS_UPDATER_PUBLIC_KEY");
static PENDING: Mutex<Option<Update>> = Mutex::const_new(None);

fn release_key() -> Option<&'static str> {
    PUBLIC_KEY.filter(|key| !key.trim().is_empty())
}

fn permitted_offer(version: &str, url: &str, signature: &str) -> bool {
    if version.is_empty() || !version.bytes().all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b)) || signature.trim().is_empty() {
        return false;
    }
    let prefix = format!("https://github.com/swaan-kim/autopets/releases/download/v{version}/");
    url.strip_prefix(&prefix).is_some_and(|name| {
        name.ends_with(".exe") && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    })
}

#[tauri::command]
pub(crate) async fn check_app_update(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    if window.label() != "main" { return Err("설정창에서 확인해 주세요.".into()); }
    let mut pending = PENDING.lock().await;
    *pending = None;
    let Some(key) = release_key() else {
        return Ok(json!({"status":"disabled","message":"공개 서명 버전 준비 중이에요."}));
    };
    let updater = app.updater_builder()
        .pubkey(key)
        .endpoints(vec![ENDPOINT.parse().map_err(|_| "업데이트 주소 오류")?])
        .map_err(|_| "업데이트 주소 오류")?
        .timeout(Duration::from_secs(20))
        .build().map_err(|_| "업데이트 설정을 확인해 주세요.")?;
    let offer = updater.check().await.map_err(|_| "업데이트를 확인하지 못했어요. 다시 시도해 주세요.")?;
    if let Some(offer) = offer {
        if !permitted_offer(&offer.version, offer.download_url.as_str(), &offer.signature) {
            return Err("검증된 배포 파일이 아니어서 업데이트하지 않았어요.".into());
        }
        let version = offer.version.clone();
        *pending = Some(offer);
        Ok(json!({"status":"available","version":version}))
    } else { Ok(json!({"status":"current"})) }
}

#[tauri::command]
pub(crate) async fn install_app_update(window: tauri::WebviewWindow, version: String) -> Result<(), String> {
    if window.label() != "main" || release_key().is_none() { return Err("업데이트를 사용할 수 없어요.".into()); }
    // Hold the mutex through install: repeated clicks cannot start two installers.
    let mut pending = PENDING.lock().await;
    if pending.as_ref().is_none_or(|offer| offer.version != version) {
        return Err("업데이트를 다시 확인해 주세요.".into());
    }
    let mut offer = pending.take().ok_or("업데이트를 다시 확인해 주세요.")?;
    // Checking a small manifest stays fast; the self-contained installer also
    // carries Node and offline WebView2, so its download needs a separate limit.
    offer.timeout = Some(Duration::from_secs(600));
    // Tauri verifies the artifact against the embedded public key before executing it.
    offer.download_and_install(|_, _| {}, || {}).await
        .map_err(|_| "서명 확인 또는 업데이트에 실패했어요. 기존 앱을 유지해요.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_offer_requires_pinned_owner_version_and_signature() {
        let good = "https://github.com/swaan-kim/autopets/releases/download/v0.2.0/AutoPets_0.2.0_x64-setup.exe";
        assert!(permitted_offer("0.2.0", good, "signature"));
        assert!(!permitted_offer("0.2.0", good, ""));
        assert!(!permitted_offer("0.1.0", good, "signature"));
        assert!(!permitted_offer("0.2.0", &format!("{good}?x=1"), "signature"));
        assert!(!permitted_offer("0.2.0", &good.replace("swaan-kim", "other"), "signature"));
        assert!(!permitted_offer("../", good, "signature"));
    }
    #[test]
    fn unsigned_review_build_has_valid_disabled_updater_configuration() {
        // Plugin setup deserializes Config before any command is called. Missing
        // pubkey would prevent even an unsigned review build from starting.
        let tauri: Value = serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))).unwrap();
        let config: tauri_plugin_updater::Config = serde_json::from_value(tauri["plugins"]["updater"].clone()).unwrap();
        assert!(config.pubkey.is_empty());
        assert!(config.endpoints.is_empty());
        assert!(config.require_signed_version);
        assert!(!config.allow_downgrades);
    }
}
