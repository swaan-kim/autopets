//! A distribution target is distinct from a verified runtime capability.
pub const CODEX_LOCAL: &str = "codex-windows-local";
pub fn catalog() -> serde_json::Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/contracts/data/connections.json"
    )))
    .expect("bundled connection catalog must be valid")
}
pub fn require_connectable(host_id: &str) -> Result<(), String> {
    if host_id == CODEX_LOCAL {
        Ok(())
    } else {
        Err("이 환경의 자동 연결은 아직 검증 중입니다.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn future_hosts_never_enable_connections_or_live_capabilities() {
        let hosts = catalog();
        for host in hosts.as_array().unwrap() {
            assert_eq!(host["connectAvailable"], host["id"] == CODEX_LOCAL);
            assert!(host["features"].as_object().unwrap().values().all(|v| v != "verified"));
        }
        assert!(require_connectable("work-local").is_err());
        assert!(require_connectable("claude-web").is_err());
    }
}
