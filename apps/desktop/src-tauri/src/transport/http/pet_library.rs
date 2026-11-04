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
    let mut pets = store.roles_snapshot()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "pet-library-unavailable"))?.pets;
    match input {
        ReadLibrary::List { offset } => {
            if offset > 100_000 {
                return Err(error(StatusCode::UNPROCESSABLE_ENTITY, "invalid-library-offset"));
            }
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
            let pet = pets.into_iter().find(|pet| pet.id == pet_id)
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
}
