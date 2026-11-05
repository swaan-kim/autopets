//! Explicit first-run actions only. Starting the desktop app never installs hooks.
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::Manager;

static RUNNING: AtomicBool = AtomicBool::new(false);
struct Operation;
impl Drop for Operation {
    fn drop(&mut self) { RUNNING.store(false, Ordering::Release); }
}
pub fn require_manager(label: &str) -> Result<(), String> {
    if label == "main" { Ok(()) } else { Err("연결 설정창에서 다시 시도해 주세요.".into()) }
}
fn verified_file(root: &Path, manifest: &serde_json::Value, relative: &str) -> Result<PathBuf, String> {
    let expected = manifest["files"].as_array().and_then(|files|
        files.iter().find(|item| item["path"] == relative)).and_then(|item| item["sha256"].as_str())
        .ok_or("설치 파일 확인에 실패했습니다. 같은 버전의 설치기로 복구해 주세요.")?;
    let file = root.join(relative);
    let metadata = std::fs::symlink_metadata(&file).map_err(|_| "연결 도구가 없습니다. 설치기로 복구해 주세요.")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("연결 도구 경로를 확인할 수 없습니다.".into());
    }
    let real = file.canonicalize().map_err(|_| "연결 도구 경로를 확인할 수 없습니다.")?;
    let base = root.canonicalize().map_err(|_| "연결 도구 경로를 확인할 수 없습니다.")?;
    if !real.starts_with(base) { return Err("연결 도구 경로를 확인할 수 없습니다.".into()); }
    let mut reader = std::fs::File::open(&real).map_err(|_| "연결 도구를 읽을 수 없습니다.")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let read = reader.read(&mut buffer).map_err(|_| "연결 도구를 읽을 수 없습니다.")?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    if format!("{:x}", hasher.finalize()) != expected {
        return Err("연결 도구가 변경됐습니다. 설치기로 복구해 주세요.".into());
    }
    Ok(real)
}
pub fn run(app: &tauri::AppHandle, connect: bool) -> Result<Vec<String>, String> {
    let resource = app.path().resource_dir().map_err(|_| "설치 위치를 찾을 수 없습니다.")?.join("connector");
    let executable = std::env::current_exe().map_err(|_| "설치 위치를 찾을 수 없습니다.")?;
    run_from_resource(&resource, &executable, connect)
}
fn run_from_resource(resource: &Path, executable: &Path, connect: bool) -> Result<Vec<String>, String> {
    if RUNNING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("연결을 확인하고 있어요. 잠시 후 다시 시도해 주세요.".into());
    }
    let _operation = Operation;
    let manifest_bytes = std::fs::read(resource.join("manifest.json"))
        .map_err(|_| "연결 도구가 없는 개발 빌드입니다. 검수용 설치 파일을 사용해 주세요.")?;
    if manifest_bytes.len() > 1_000_000 { return Err("연결 도구 정보를 확인할 수 없습니다.".into()); }
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "연결 도구 정보를 확인할 수 없습니다.")?;
    if manifest["appVersion"] != env!("CARGO_PKG_VERSION") {
        return Err("앱과 연결 도구 버전이 다릅니다. 설치기로 복구해 주세요.".into());
    }
    let node = verified_file(resource, &manifest, "runtime/node.exe")?;
    let runner = verified_file(resource, &manifest, "integrations/codex/bootstrap/start.mjs")?;
    let mut command = Command::new(node);
    command.arg(runner).arg("--installed-resource").arg(resource)
        .arg(if connect { "--connect" } else { "--disconnect" })
        .arg("--app-executable").arg(executable)
        // The desktop process can inherit the task that originally launched it.
        // A later click must wait for a real event, never bind that stale task.
        .env_remove("CODEX_THREAD_ID")
        .current_dir(executable.parent().ok_or("설치 위치를 찾을 수 없습니다.")?)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|_| "연결 도구 실행이 차단됐습니다. 설치 상태를 확인해 주세요.")?;
    let stdout = child.stdout.take().ok_or("연결 결과를 읽을 수 없습니다.")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(32_769).read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "연결 실행 상태를 확인할 수 없습니다.")? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            return Err("연결 확인 시간이 지났습니다. 다시 시도해 주세요.".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let bytes = reader.join().map_err(|_| "연결 결과를 읽을 수 없습니다.")?
        .map_err(|_| "연결 결과를 읽을 수 없습니다.")?;
    if bytes.len() > 32_768 { return Err("연결 결과를 확인할 수 없습니다.".into()); }
    let result: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "연결 결과를 확인할 수 없습니다.")?;
    if !status.success() || result["ok"] != true {
        return Err(match result["code"].as_str() {
            Some("setup-in-progress") | Some("installation-busy") => "다른 설치가 진행 중입니다. 잠시 후 다시 시도해 주세요.",
            Some("app-unavailable") => "앱 연결을 확인하지 못했습니다. AutoPets를 다시 열어 주세요.",
            Some("skill-conflict") => "같은 이름의 사용자 스킬이 있어 보존했습니다. 연결 설정을 확인해 주세요.",
            _ => "연결 준비에 실패했습니다. 설치 상태를 확인하고 다시 시도해 주세요.",
        }.into());
    }
    Ok(if result["skillConflict"] == true {
        vec!["같은 이름의 사용자 스킬을 보존했어요. 연결은 계속 사용할 수 있어요.".into()]
    } else { vec![] })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_manager_can_change_owned_connections() {
        assert!(require_manager("main").is_ok());
        assert!(require_manager("pet-0").is_err());
        assert!(require_manager("other").is_err());
    }
    #[test]
    fn bundled_runner_integrity_is_checked_before_execution() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("node.exe"), b"fixture").unwrap();
        let manifest = serde_json::json!({"files":[{"path":"node.exe","sha256":format!("{:x}",Sha256::digest(b"fixture"))}]});
        assert!(verified_file(dir.path(), &manifest, "node.exe").is_ok());
        std::fs::write(dir.path().join("node.exe"), b"modified").unwrap();
        assert!(verified_file(dir.path(), &manifest, "node.exe").is_err());
        assert!(verified_file(dir.path(), &manifest, "unlisted.exe").is_err());
    }
}
