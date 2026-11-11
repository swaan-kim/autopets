//! Claude Code connection: a local plugin with metadata-only activity hooks and
//! the read-only pet preference server. It is installed with Claude Code's own
//! plugin CLI only when the user clicks connect, and removed the same way.
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const MARKETPLACE: &str = "autopets-local";
const PLUGIN: &str = "autopets@autopets-local";
// Paths are relative to the marketplace folder Claude Code reads in place.
const FILES: &[(&str, &str)] = &[
    (".claude-plugin/marketplace.json", include_str!("../../../../../integrations/claude-code/.claude-plugin/marketplace.json")),
    ("autopets/.claude-plugin/plugin.json", include_str!("../../../../../integrations/claude-code/plugin/.claude-plugin/plugin.json")),
    ("autopets/hooks/hooks.json", include_str!("../../../../../integrations/claude-code/plugin/hooks/hooks.json")),
    ("autopets/.mcp.json", include_str!("../../../../../integrations/claude-code/plugin/.mcp.json")),
    ("autopets/server/claude-code/hooks/run.mjs", include_str!("../../../../../integrations/claude-code/hooks/run.mjs")),
    ("autopets/server/claude-code/hooks/claude-hook.mjs", include_str!("../../../../../integrations/claude-code/hooks/claude-hook.mjs")),
    ("autopets/server/mcp/main.mjs", include_str!("../../../../../integrations/mcp/main.mjs")),
    ("autopets/server/mcp/server.mjs", include_str!("../../../../../integrations/mcp/server.mjs")),
    ("autopets/server/mcp/client.mjs", include_str!("../../../../../integrations/mcp/client.mjs")),
    ("autopets/server/codex/skills/autopets/scripts/bridge-client.mjs", include_str!("../../../../../integrations/codex/skills/autopets/scripts/bridge-client.mjs")),
    ("autopets/packages/contracts/routing.mjs", include_str!("../../../../../packages/contracts/routing.mjs")),
    ("autopets/packages/contracts/data/routing-profiles.json", include_str!("../../../../../packages/contracts/data/routing-profiles.json")),
];

static RUNNING: AtomicBool = AtomicBool::new(false);
struct Operation;
impl Drop for Operation {
    fn drop(&mut self) { RUNNING.store(false, Ordering::Release); }
}

// Hooks and the MCP server run with an absolute Node path when the installed
// build carries one, so Claude Code needs no Node on PATH. Both also get this
// app's connection file, so they reach the instance that installed them.
pub(crate) fn plugin_files(node: &str, connection: &str) -> Result<Vec<(&'static str, String)>, String> {
    FILES.iter().map(|(name, text)| {
        if name.ends_with("hooks/hooks.json") || name.ends_with(".mcp.json") {
            let mut value: serde_json::Value = serde_json::from_str(text).map_err(|_| "플러그인 구성을 읽을 수 없어요.")?;
            use_node(&mut value, node);
            if !connection.is_empty() { use_connection(&mut value, connection); }
            Ok((*name, serde_json::to_string_pretty(&value).map_err(|_| "플러그인 구성을 만들 수 없어요.")?))
        } else {
            Ok((*name, (*text).to_string()))
        }
    }).collect()
}

fn use_node(value: &mut serde_json::Value, node: &str) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("command").and_then(|command| command.as_str()) == Some("node") {
                map.insert("command".into(), node.into());
            }
            for item in map.values_mut() { use_node(item, node); }
        }
        serde_json::Value::Array(items) => for item in items { use_node(item, node); },
        _ => {}
    }
}

fn use_connection(value: &mut serde_json::Value, connection: &str) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("type").and_then(|kind| kind.as_str()) == Some("command") {
                if let Some(serde_json::Value::Array(args)) = map.get_mut("args") {
                    args.push("--connection".into());
                    args.push(connection.into());
                }
            }
            if let Some(serde_json::Value::Object(servers)) = map.get_mut("mcpServers") {
                for server in servers.values_mut() {
                    if let Some(server) = server.as_object_mut() {
                        server.insert("env".into(), serde_json::json!({ "AUTOPETS_CONNECTION_FILE": connection }));
                    }
                }
                return;
            }
            for item in map.values_mut() { use_connection(item, connection); }
        }
        serde_json::Value::Array(items) => for item in items { use_connection(item, connection); },
        _ => {}
    }
}

fn write_plugin(directory: &Path, node: &str, connection: &str) -> Result<(), String> {
    let files = plugin_files(node, connection)?;
    if directory.exists() {
        std::fs::remove_dir_all(directory).map_err(|_| "이전 Claude Code 연결 파일을 정리하지 못했어요.")?;
    }
    for (name, text) in files {
        let file = directory.join(name);
        std::fs::create_dir_all(file.parent().ok_or("저장 위치를 확인할 수 없어요.")?)
            .map_err(|_| "Claude Code 연결 파일을 저장하지 못했어요.")?;
        std::fs::write(&file, text).map_err(|_| "Claude Code 연결 파일을 저장하지 못했어요.")?;
    }
    Ok(())
}

fn find_claude() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            for name in names { candidates.push(directory.join(name)); }
        }
    }
    // The native installer's default location may not be on the app's PATH.
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        for name in names { candidates.push(PathBuf::from(&home).join(".local").join("bin").join(name)); }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn run_cli(claude: &Path, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new(claude);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|_| "Claude Code를 실행하지 못했어요.")?;
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(status) = child.try_wait().map_err(|_| "Claude Code 실행 상태를 확인할 수 없어요.")? {
            return if status.success() { Ok(()) } else { Err("Claude Code가 플러그인 설치를 마치지 못했어요. Claude Code를 최신 버전으로 업데이트해 주세요.".into()) };
        }
        if Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            return Err("Claude Code 응답 시간이 지났어요. 다시 시도해 주세요.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn plugin_directory(data_dir: &Path) -> PathBuf {
    data_dir.join("claude-code").join("autopets-claude-code")
}

#[tauri::command]
pub(crate) fn connect_claude_code(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    store: tauri::State<crate::application::store::SharedStore>,
) -> Result<(), String> {
    crate::platform::connection_setup::require_manager(window.label())?;
    if RUNNING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("Claude Code 연결을 확인하고 있어요. 잠시 후 다시 시도해 주세요.".into());
    }
    let _operation = Operation;
    let claude = find_claude().ok_or("Claude Code를 찾지 못했어요. Claude Code를 설치한 뒤 다시 눌러 주세요.")?;
    let (data_dir, connection) = {
        let state = store.lock().map_err(|_| "상태를 읽을 수 없습니다.")?;
        (state.data_dir.clone(), state.connection_path.clone())
    };
    let node = crate::platform::connection_setup::bundled_node(&app)
        .map(|path| path.to_string_lossy().into_owned()).unwrap_or_else(|| "node".into());
    let directory = plugin_directory(&data_dir);
    write_plugin(&directory, &node, &connection)?;
    let directory = dunce::simplified(&directory).to_string_lossy().into_owned();
    run_cli(&claude, &["plugin", "marketplace", "add", &directory])?;
    run_cli(&claude, &["plugin", "install", PLUGIN])
}

#[tauri::command]
pub(crate) fn disconnect_claude_code(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::platform::connection_setup::require_manager(window.label())?;
    if RUNNING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("Claude Code 연결을 확인하고 있어요. 잠시 후 다시 시도해 주세요.".into());
    }
    let _operation = Operation;
    let claude = find_claude().ok_or("Claude Code를 찾지 못했어요.")?;
    let removed = run_cli(&claude, &["plugin", "uninstall", PLUGIN]);
    let forgotten = run_cli(&claude, &["plugin", "marketplace", "remove", MARKETPLACE]);
    removed.or(forgotten)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_uses_the_given_node_and_keeps_every_file() {
        let node = "C:\\Program Files\\AutoPets\\connector\\runtime\\node.exe";
        let connection = "C:\\Users\\합성\\AppData\\Local\\local.autopets.desktop\\connection.json";
        let files = plugin_files(node, connection).unwrap();
        assert_eq!(files.len(), FILES.len());
        let hooks: serde_json::Value = serde_json::from_str(&files.iter().find(|(name, _)| name.ends_with("hooks.json")).unwrap().1).unwrap();
        let commands: Vec<_> = hooks["hooks"].as_object().unwrap().values()
            .flat_map(|groups| groups.as_array().unwrap().iter())
            .flat_map(|group| group["hooks"].as_array().unwrap().iter()).collect();
        assert!(!commands.is_empty());
        assert!(commands.iter().all(|hook| hook["command"] == node));
        assert!(commands.iter().all(|hook| hook["args"].as_array().unwrap().iter().rev().take(2).map(|arg| arg.as_str().unwrap()).collect::<Vec<_>>() == [connection, "--connection"]));
        let mcp: serde_json::Value = serde_json::from_str(&files.iter().find(|(name, _)| name.ends_with(".mcp.json")).unwrap().1).unwrap();
        assert_eq!(mcp["mcpServers"]["autopets"]["command"], node);
        assert_eq!(mcp["mcpServers"]["autopets"]["env"]["AUTOPETS_CONNECTION_FILE"], connection);
        assert_eq!(plugin_files(node, "").unwrap().len(), FILES.len());
        let directory = tempfile::tempdir().unwrap();
        let target = plugin_directory(directory.path());
        write_plugin(&target, node, connection).unwrap();
        write_plugin(&target, node, connection).unwrap();
        assert!(target.join("autopets/server/claude-code/hooks/run.mjs").is_file());
    }
}
