use super::*;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub(super) enum ReadLibrary {
    List { #[serde(default)] offset: usize },
    Read {
        #[serde(rename = "petId")]
        pet_id: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: u64,
    },
}

// The same authenticated loopback boundary, with no chat/account bindings and
// no writes. Reading a saved preference never grants host/runtime capability.
pub(super) async fn read(
    State(state): State<BridgeState>,
    Json(input): Json<ReadLibrary>,
) -> BridgeResult<serde_json::Value> {
    let store = state.store.lock().map_err(state_error)?;
    match input {
        ReadLibrary::List { offset } => {
            if offset > 100_000 {
                return Err(error(StatusCode::UNPROCESSABLE_ENTITY, "invalid-library-offset"));
            }
            let mut pets = store.saved_pets()
                .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "pet-library-unavailable"))?;
            pets.sort_by(|a, b| a.id.cmp(&b.id));
            let next = (pets.len() > offset.saturating_add(20)).then_some(offset + 20);
            let entries: Vec<_> = pets.into_iter().skip(offset).take(20).map(|pet|
                serde_json::json!({"id": pet.id, "revision": pet.revision, "name": pet.template.name, "roleId": pet.template.id})
            ).collect();
            Ok(Json(serde_json::json!({"version": 1, "pets": entries, "nextOffset": next})))
        }
        ReadLibrary::Read { pet_id, expected_revision } => {
            if pet_id.len() > 128 || pet_id.chars().any(char::is_control) {
                return Err(error(StatusCode::UNPROCESSABLE_ENTITY, "invalid-pet-id"));
            }
            let pet = store.saved_pet(&pet_id)
                .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "pet-library-unavailable"))?
                .ok_or_else(|| error(StatusCode::NOT_FOUND, "pet-not-found"))?;
            if pet.revision != expected_revision {
                return Err(error(StatusCode::CONFLICT, "saved-pet-revision-changed"));
            }
            Ok(Json(serde_json::json!({"version": 1, "pet": {"id": pet.id, "revision": pet.revision, "template": pet.template}})))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn library_reads_require_auth_and_revision_and_do_not_expose_bindings_or_mutate() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
        let pet = store.lock().unwrap().save_pet(None, 0, crate::domain::roles::templates().unwrap().remove(0)).unwrap();
        let before = serde_json::to_value(store.lock().unwrap().roles_snapshot().unwrap()).unwrap();
        let changes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = changes.clone();
        let mut bridge = start(store.clone(), Arc::new(move |_| { observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst); })).await.unwrap();
        let initial_changes = changes.load(std::sync::atomic::Ordering::SeqCst);
        let auth = format!("Authorization: Bearer {}\r\n", bridge.token);
        let list = serde_json::json!({"operation": "list"});
        assert_eq!(super::super::tests::json_http(&bridge.base_url, "POST", "/v1/pet-library", "", list.clone()).await.0, 401);
        let (status, result) = super::super::tests::json_http(&bridge.base_url, "POST", "/v1/pet-library", &auth, list).await;
        assert_eq!(status, 200);
        assert_eq!(result["pets"][0]["id"], pet.id);
        assert_eq!(result["pets"][0].as_object().unwrap().len(), 4);
        assert!(result.get("bindings").is_none());
        assert!(result["pets"][0].get("template").is_none());
        let read = serde_json::json!({"operation": "read", "petId": pet.id, "expectedRevision": 1});
        let (status, result) = super::super::tests::json_http(&bridge.base_url, "POST", "/v1/pet-library", &auth, read.clone()).await;
        assert_eq!(status, 200);
        assert_eq!(result["pet"]["template"]["instruction"], pet.template.instruction);
        let mut stale = read; stale["expectedRevision"] = 0.into();
        assert_eq!(super::super::tests::json_http(&bridge.base_url, "POST", "/v1/pet-library", &auth, stale).await.0, 409);
        for forbidden in [serde_json::json!({"operation": "save"}), serde_json::json!({"operation": "list", "identity": {"chatId": "private"}})] {
            assert_eq!(super::super::tests::json_http(&bridge.base_url, "POST", "/v1/pet-library", &auth, forbidden).await.0, 422);
        }
        assert_eq!(serde_json::to_value(store.lock().unwrap().roles_snapshot().unwrap()).unwrap(), before);
        assert_eq!(changes.load(std::sync::atomic::Ordering::SeqCst), initial_changes);
        bridge.shutdown();
    }

    #[tokio::test]
    async fn stdio_mcp_reads_the_selected_revision_through_the_native_bridge() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(std::sync::Mutex::new(crate::application::store::Store::new(dir.path()).unwrap()));
        let pet = store.lock().unwrap().save_pet(None, 0, crate::domain::roles::templates().unwrap().remove(0)).unwrap();
        let before = serde_json::to_value(store.lock().unwrap().roles_snapshot().unwrap()).unwrap();
        let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
        let connection_path = bridge.connection_path.clone();
        let messages = [
            serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"native-fixture","version":"1"}}}),
            serde_json::json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"autopets_list_pets","arguments":{}}}),
            serde_json::json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"autopets_read_pet","arguments":{"petId":pet.id,"expectedRevision":pet.revision}}}),
            serde_json::json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"autopets_read_pet","arguments":{"petId":pet.id,"expectedRevision":pet.revision + 1}}}),
        ];
        let input = messages.iter().map(|message| format!("{message}\n")).collect::<String>();
        // Keep the async bridge serving while the real STDIO client process runs.
        // Only this temporary fixture's connection file is made available to it.
        let output = tokio::task::spawn_blocking(move || {
            let node = std::env::var_os("AUTOPETS_TEST_NODE").unwrap_or_else(|| "node".into());
            let mut command = Command::new(node);
            command.arg(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../integrations/mcp/server.mjs"))
                .env("AUTOPETS_CONNECTION_FILE", connection_path)
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command.spawn().expect("Node is required for the native MCP integration test");
            child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
            child.wait_with_output().unwrap()
        }).await.unwrap();
        assert!(output.status.success());
        assert!(output.stderr.is_empty(), "MCP must not log fixture data");
        let replies: Vec<serde_json::Value> = String::from_utf8(output.stdout).unwrap().lines()
            .map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(replies.len(), 4);
        assert_eq!(replies[1]["result"]["structuredContent"]["pets"][0]["id"], pet.id);
        let selected = &replies[2]["result"]["structuredContent"]["pet"];
        assert_eq!(selected["id"], pet.id);
        assert_eq!(selected["revision"], pet.revision);
        assert_eq!(selected["instruction"], pet.template.instruction);
        assert_eq!(selected["skillsLoaded"], false);
        assert_eq!(selected["hostSettingsChanged"], false);
        for field in ["target", "accountId", "cwd", "execution", "token"] {
            assert!(selected.get(field).is_none());
        }
        assert_eq!(replies[3]["result"]["isError"], true);
        assert_eq!(serde_json::to_value(store.lock().unwrap().roles_snapshot().unwrap()).unwrap(), before);
        bridge.shutdown();
    }
}
