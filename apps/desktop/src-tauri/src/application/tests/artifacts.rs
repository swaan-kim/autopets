use super::*;
use crate::application::store::Store;
use crate::domain::assistance::Provider;

const PNG: &[u8] = include_bytes!("../../../icons/32x32.png");
fn identity(account: &str, chat: &str) -> Identity {
    Identity {
        provider: Provider::Codex,
        account_id: account.into(),
        chat_id: chat.into(),
    }
}
fn brief() -> Brief {
    Brief {
        audience: "팀".into(),
        message: "hello".into(),
        points: vec!["alpha".into()],
        source_text: "PRIVATE_CHAT_SOURCE".into(),
        source_label: "사용자가 선택한 발췌".into(),
    }
}
fn style() -> Style {
    Style {
        palette: vec!["#123456".into()],
        logo_data_url: None,
        copy_length: CopyLength::Short,
        layout: Layout::Landscape,
    }
}
fn save(id: &Identity, revision: u64) -> Request {
    Request::SaveBrief {
        identity: id.clone(),
        expected_revision: revision,
        template_id: TemplateId::ProductIntro,
        brief: brief(),
        style: style(),
    }
}
fn import(id: &Identity, revision: u64, rendered: &str) -> Request {
    Request::ImportVersion {
        identity: id.clone(),
        expected_revision: revision,
        png_bytes: PNG.to_vec(),
        rendered_text: rendered.into(),
    }
}
fn review_pass() -> Review {
    Review {
        readability: ReviewStatus::Pass,
        layout: ReviewStatus::Pass,
        fidelity: ReviewStatus::Pass,
    }
}
fn accept(store: &mut ArtifactStore, id: &Identity, version_id: &str, revision: u64) {
    store
        .dispatch(Request::ReviewVersion {
            identity: id.clone(),
            expected_revision: revision,
            version_id: version_id.into(),
            review: review_pass(),
        })
        .unwrap();
    store
        .dispatch(Request::AcceptVersion {
            identity: id.clone(),
            expected_revision: revision + 1,
            version_id: version_id.into(),
        })
        .unwrap();
}

#[test]
fn identities_revisions_and_additive_restart_preserve_old_data_and_unknown_usage() {
    let dir = tempfile::tempdir().unwrap();
    let mut old = Store::new(dir.path()).unwrap();
    old.db.execute_batch("CREATE TABLE old_fixture(value TEXT); INSERT INTO old_fixture(value) VALUES('unchanged strict JSON');").unwrap();
    let preferences = serde_json::to_string(&old.assistance.preferences().unwrap()).unwrap();
    let a = identity("account-a", "same-chat");
    let b = identity("account-b", "same-chat");
    let mut c = a.clone();
    c.provider = Provider::Chatgpt;
    for id in [&a, &b, &c] {
        old.artifacts.dispatch(save(id, 0)).unwrap();
    }
    assert_eq!(old.artifacts.snapshot().unwrap().projects.len(), 3);
    assert!(old
        .artifacts
        .dispatch(save(&a, 0))
        .unwrap_err()
        .contains("stale"));
    let mut invalid = a.clone();
    invalid.account_id = "\n".into();
    assert!(old.artifacts.dispatch(save(&invalid, 0)).is_err());
    assert!(serde_json::from_value::<Request>(serde_json::json!({"operation":"set-favorite","identity":{"provider":"unknown","accountId":"a","chatId":"b"},"expectedRevision":1,"favorite":true})).is_err());
    drop(old);
    let restored = Store::new(dir.path()).unwrap();
    assert_eq!(
        restored
            .db
            .query_row("SELECT value FROM old_fixture", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "unchanged strict JSON"
    );
    assert_eq!(
        serde_json::to_string(&restored.assistance.preferences().unwrap()).unwrap(),
        preferences
    );
    assert_eq!(restored.artifacts.find(&a).unwrap().unwrap().revision, 1);
    let snapshot = serde_json::to_value(restored.artifacts.snapshot().unwrap()).unwrap();
    assert_eq!(
        snapshot["capabilities"],
        serde_json::json!({"automaticGeneration":false,"modelSwitch":false,"liveConnectionVerified":false})
    );
    assert_eq!(restored.snapshot().capabilities.token_usage, "unavailable");
}

#[test]
fn stale_concurrent_writers_cannot_overwrite_a_revision() {
    let dir = tempfile::tempdir().unwrap();
    let a = identity("a", "chat");
    let mut first = ArtifactStore::new(dir.path()).unwrap();
    first.dispatch(save(&a, 0)).unwrap();
    let mut second = ArtifactStore::new(dir.path()).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let id = a.clone();
    let wait = barrier.clone();
    let worker = std::thread::spawn(move || {
        wait.wait();
        first.dispatch(Request::SetFavorite {
            identity: id,
            expected_revision: 1,
            favorite: true,
        })
    });
    barrier.wait();
    let result = second.dispatch(Request::SetFavorite {
        identity: a.clone(),
        expected_revision: 1,
        favorite: false,
    });
    let other = worker.join().unwrap();
    assert_ne!(result.is_ok(), other.is_ok());
    assert_eq!(second.find(&a).unwrap().unwrap().revision, 2);
}

#[test]
fn versions_snapshot_inputs_revisions_require_new_png_and_reviews_reset() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::new(dir.path()).unwrap();
    let a = identity("a", "chat");
    store.dispatch(save(&a, 0)).unwrap();
    store.dispatch(import(&a, 1, "hello alpha")).unwrap();
    let first = store.find(&a).unwrap().unwrap().versions[0].clone();
    assert_eq!((first.width, first.height), (32, 32));
    assert_eq!(first.review, Review::default());
    assert!(store
        .dispatch(Request::AcceptVersion {
            identity: a.clone(),
            expected_revision: 2,
            version_id: first.id.clone()
        })
        .is_err());
    accept(&mut store, &a, &first.id, 2);
    let immutable = serde_json::to_value(&store.find(&a).unwrap().unwrap().versions[0]).unwrap();
    let revision = Revision {
        kind: RevisionKind::Shorten,
        instruction: "짧게".into(),
        base_version_id: first.id.clone(),
    };
    store
        .dispatch(Request::RequestRevision {
            identity: a.clone(),
            expected_revision: 4,
            revision_request: revision.clone(),
        })
        .unwrap();
    assert!(store
        .dispatch(Request::AcceptVersion {
            identity: a.clone(),
            expected_revision: 5,
            version_id: first.id.clone()
        })
        .is_err());
    let mut changed = brief();
    changed.message = "updated".into();
    store
        .dispatch(Request::SaveBrief {
            identity: a.clone(),
            expected_revision: 5,
            template_id: TemplateId::Comparison,
            brief: changed.clone(),
            style: Style {
                layout: Layout::Portrait,
                ..style()
            },
        })
        .unwrap();
    assert!(store
        .dispatch(import(&a, 6, "updated alpha"))
        .unwrap_err()
        .contains("newly rendered"));
    store
        .dispatch(Request::ImportVersion {
            identity: a.clone(),
            expected_revision: 6,
            png_bytes: include_bytes!("../../../icons/64x64.png").to_vec(),
            rendered_text: "updated alpha".into(),
        })
        .unwrap();
    let project = store.find(&a).unwrap().unwrap();
    assert_eq!(project.revision, 7);
    assert!(project.pending_revision.is_none());
    assert_eq!(
        serde_json::to_value(&project.versions[0]).unwrap(),
        immutable
    );
    assert_eq!(project.versions[1].brief, changed);
    assert_eq!(project.versions[1].revision_request, Some(revision));
    assert_eq!(project.versions[1].template_id, TemplateId::Comparison);
    assert_eq!(project.versions[1].review, Review::default());
    assert!(project.versions[1].accepted_at.is_none());
    assert_eq!(store.image(&a, &first.id).unwrap(), PNG);
    assert!(store.image(&identity("a", "another"), &first.id).is_err());
}

#[test]
fn declared_text_checks_block_missing_points_and_ungrounded_numbers_even_after_review() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::new(dir.path()).unwrap();
    let a = identity("a", "chat");
    store.dispatch(save(&a, 0)).unwrap();
    store.dispatch(import(&a, 1, "hello 500%")).unwrap();
    let version = store.find(&a).unwrap().unwrap().versions[0].clone();
    for id in ["content", "numbers"] {
        assert_eq!(
            version.checks.iter().find(|c| c.id == id).unwrap().status,
            CheckStatus::Warning
        );
    }
    store
        .dispatch(Request::ReviewVersion {
            identity: a.clone(),
            expected_revision: 2,
            version_id: version.id.clone(),
            review: review_pass(),
        })
        .unwrap();
    assert!(store
        .dispatch(Request::AcceptVersion {
            identity: a.clone(),
            expected_revision: 3,
            version_id: version.id
        })
        .is_err());
    assert!(store.dispatch(import(&a, 3, " ")).is_err());
    let mut source = brief();
    source.source_text = "매출 1,500원, 12.5%".into();
    assert_eq!(
        checks(&source, "hello alpha 매출 1,500원 12.5%")[2].status,
        CheckStatus::Pass
    );
    assert_eq!(
        checks(&source, "hello alpha 매출 1,500명")[2].status,
        CheckStatus::Warning
    );
}

#[test]
fn faithful_paraphrases_need_human_fidelity_review_and_styles_are_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::new(dir.path()).unwrap();
    let a = identity("a", "chat");
    store.dispatch(save(&a, 0)).unwrap();
    store
        .dispatch(import(&a, 1, "Faithful paraphrase declared by the user"))
        .unwrap();
    let version_id = store.find(&a).unwrap().unwrap().versions[0].id.clone();
    assert_eq!(
        store.find(&a).unwrap().unwrap().versions[0].checks[1].status,
        CheckStatus::Warning
    );
    assert!(store
        .dispatch(Request::AcceptVersion {
            identity: a.clone(),
            expected_revision: 2,
            version_id: version_id.clone()
        })
        .is_err());
    accept(&mut store, &a, &version_id, 2);
    for revision in 4..24 {
        store
            .dispatch(Request::SaveStyle {
                identity: a.clone(),
                expected_revision: revision,
                version_id: version_id.clone(),
                name: "visual preference".into(),
                style_id: None,
            })
            .unwrap();
    }
    assert_eq!(store.styles().unwrap().len(), 20);
    assert!(store
        .dispatch(Request::SaveStyle {
            identity: a.clone(),
            expected_revision: 24,
            version_id: version_id.clone(),
            name: "overflow".into(),
            style_id: None
        })
        .is_err());
    let style_id = store.styles().unwrap()[0].id.clone();
    store
        .dispatch(Request::SaveStyle {
            identity: a.clone(),
            expected_revision: 24,
            version_id,
            name: "Updated".into(),
            style_id: Some(style_id),
        })
        .unwrap();
    assert_eq!(store.styles().unwrap().len(), 20);
    assert!(text("Windows\r\nexcerpt", 80, false).is_ok());
}

#[test]
fn revision_of_an_older_version_restores_its_own_frozen_brief_and_style() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::new(dir.path()).unwrap();
    let a = identity("a", "chat");
    store.dispatch(save(&a, 0)).unwrap();
    store.dispatch(import(&a, 1, "hello alpha")).unwrap();
    let original = store.find(&a).unwrap().unwrap().versions[0].clone();
    let mut newer = brief();
    newer.message = "newer context".into();
    store
        .dispatch(Request::SaveBrief {
            identity: a.clone(),
            expected_revision: 2,
            template_id: TemplateId::Comparison,
            brief: newer.clone(),
            style: Style {
                palette: vec!["#ABCDEF".into()],
                layout: Layout::Portrait,
                ..style()
            },
        })
        .unwrap();
    store
        .dispatch(import(&a, 3, "newer context alpha"))
        .unwrap();
    store
        .dispatch(Request::RequestRevision {
            identity: a.clone(),
            expected_revision: 4,
            revision_request: Revision {
                kind: RevisionKind::Restructure,
                instruction: "첫 버전 배치 변경".into(),
                base_version_id: original.id.clone(),
            },
        })
        .unwrap();
    let queued = store.find(&a).unwrap().unwrap();
    assert_eq!(queued.brief, original.brief);
    assert_eq!(queued.style, original.style);
    assert_eq!(queued.template_id, original.template_id);
    assert_eq!(queued.versions[1].brief, newer);
    store
        .dispatch(Request::ImportVersion {
            identity: a.clone(),
            expected_revision: 5,
            png_bytes: include_bytes!("../../../icons/64x64.png").to_vec(),
            rendered_text: "hello alpha".into(),
        })
        .unwrap();
    let generated = store.find(&a).unwrap().unwrap().versions[2].clone();
    assert_eq!(generated.brief, original.brief);
    assert_eq!(generated.style, original.style);
    assert_eq!(generated.template_id, original.template_id);
    assert_eq!(
        generated.revision_request.unwrap().base_version_id,
        original.id
    );
}

#[test]
fn native_snapshot_discovers_observed_chat_without_creating_assistance_or_artifact_task() {
    use sha2::{Digest, Sha256};
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::new(dir.path()).unwrap();
    assert!(store.artifact_snapshot().unwrap().observed_chats.is_empty());
    let now = crate::domain::activity::now_ms();
    let event = serde_json::from_value(serde_json::json!({"eventId":"observed-artifact-chat","sessionId":"observed-only-chat","turnId":"real-turn","kind":"turn_started","cwd":dir.path().to_string_lossy(),"timestamp":now})).unwrap();
    store.apply_event_at(event, now).unwrap();
    let snapshot = store.artifact_snapshot().unwrap();
    assert_eq!(
        snapshot.observed_chats,
        vec![Identity {
            provider: Provider::Codex,
            account_id: format!("session:{:x}", Sha256::digest(b"observed-only-chat")),
            chat_id: "observed-only-chat".into()
        }]
    );
    assert!(snapshot.projects.is_empty());
    assert!(store.assistance.overview().unwrap().tasks.is_empty());
    assert!(store.workflow.snapshot().unwrap().tasks.is_empty());
    assert!(!snapshot.capabilities.live_connection_verified);
    assert!(store
        .artifacts
        .snapshot()
        .unwrap()
        .observed_chats
        .is_empty());
}

#[test]
fn style_crud_copies_only_allowlisted_visual_preferences_from_accepted_versions() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::new(dir.path()).unwrap();
    let a = identity("PRIVATE_ACCOUNT", "PRIVATE_CHAT");
    store.dispatch(save(&a, 0)).unwrap();
    store
        .dispatch(import(&a, 1, "hello alpha PRIVATE_RENDERED"))
        .unwrap();
    let version_id = store.find(&a).unwrap().unwrap().versions[0].id.clone();
    let save_style = |revision, id| Request::SaveStyle {
        identity: a.clone(),
        expected_revision: revision,
        version_id: version_id.clone(),
        name: "My style".into(),
        style_id: id,
    };
    assert!(store.dispatch(save_style(2, None)).is_err());
    accept(&mut store, &a, &version_id, 2);
    store.dispatch(save_style(4, None)).unwrap();
    let saved = store.styles().unwrap().remove(0);
    let json = serde_json::to_string(&saved).unwrap();
    for private in [
        "PRIVATE_ACCOUNT",
        "PRIVATE_CHAT",
        "PRIVATE_RENDERED",
        "PRIVATE_CHAT_SOURCE",
        "hello",
        "alpha",
        "sourceText",
        "brief",
        "renderedText",
    ] {
        assert!(!json.contains(private));
    }
    assert_eq!(saved.style, style());
    assert_eq!(saved.template_id, TemplateId::ProductIntro);
    store
        .dispatch(save_style(5, Some(saved.id.clone())))
        .unwrap();
    assert_eq!(store.styles().unwrap().len(), 1);
    store
        .dispatch(Request::DeleteStyle { style_id: saved.id })
        .unwrap();
    assert!(store.styles().unwrap().is_empty());
    store
        .dispatch(Request::ReviewVersion {
            identity: a.clone(),
            expected_revision: 6,
            version_id: version_id.clone(),
            review: Review::default(),
        })
        .unwrap();
    assert!(store.find(&a).unwrap().unwrap().versions[0]
        .accepted_at
        .is_none());
    assert!(store.dispatch(save_style(7, None)).is_err());
}

#[test]
fn png_framing_checksum_decoding_dimensions_and_limits_are_verified() {
    assert_eq!(validate_png(PNG, MAX_PNG_BYTES).unwrap(), (32, 32));
    assert!(validate_png(b"not png", MAX_PNG_BYTES).is_err());
    assert!(validate_png(&PNG[..PNG.len() - 5], MAX_PNG_BYTES).is_err());
    let mut suffix = PNG.to_vec();
    suffix.push(0);
    assert!(validate_png(&suffix, MAX_PNG_BYTES).is_err());
    let mut corrupt = PNG.to_vec();
    corrupt[29] ^= 1;
    assert!(validate_png(&corrupt, MAX_PNG_BYTES).is_err());
    assert!(validate_png(PNG, PNG.len() - 1).is_err());
    let mut large = PNG.to_vec();
    large[16..20].copy_from_slice(&100_000u32.to_be_bytes());
    let crc = crc32(&large[12..29]);
    large[29..33].copy_from_slice(&crc.to_be_bytes());
    assert!(validate_png(&large, MAX_PNG_BYTES)
        .unwrap_err()
        .contains("dimensions"));
    let mut fake = PNG[..33].to_vec();
    for (kind, data) in [(b"IDAT", b"not-zlib".as_slice()), (b"IEND", b"".as_slice())] {
        fake.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = fake.len();
        fake.extend_from_slice(kind);
        fake.extend_from_slice(data);
        let crc = crc32(&fake[start..]);
        fake.extend_from_slice(&crc.to_be_bytes());
    }
    assert!(validate_png(&fake, MAX_PNG_BYTES)
        .unwrap_err()
        .contains("decoded"));
    let mut invalid = style();
    invalid.palette = vec!["red".into()];
    assert!(validate_style(&invalid).is_err());
    invalid = style();
    invalid.logo_data_url = Some("data:image/svg+xml;base64,AAAA".into());
    assert!(validate_style(&invalid).is_err());
    assert!(decode_base64("A===").is_err());
    assert!(decode_base64("Zh==").is_err());
    assert!(decode_base64("AA==AAAA").is_err());
}

#[test]
fn delete_removes_only_project_managed_png_and_export_is_unique_and_path_safe() {
    let dir = tempfile::tempdir().unwrap();
    let downloads = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::new(dir.path()).unwrap();
    let a = identity("a", "../chat");
    let b = identity("b", "chat");
    for id in [&a, &b] {
        store.dispatch(save(id, 0)).unwrap();
        store.dispatch(import(id, 1, "hello alpha")).unwrap();
    }
    let a_id = store.find(&a).unwrap().unwrap().versions[0].id.clone();
    let b_id = store.find(&b).unwrap().unwrap().versions[0].id.clone();
    let first = store
        .export_to_downloads(&a, &a_id, downloads.path())
        .unwrap();
    let second = store
        .export_to_downloads(&a, &a_id, downloads.path())
        .unwrap();
    assert_ne!(first, second);
    assert_eq!(std::fs::read(&first).unwrap(), PNG);
    assert_eq!(
        Path::new(&first).parent().unwrap(),
        downloads.path().canonicalize().unwrap().join("AutoPets")
    );
    assert!(store
        .export_to_downloads(&a, "../../outside", downloads.path())
        .is_err());
    assert!(store.image_path("../../outside").is_err());
    let a_path = store.image_path(&a_id).unwrap();
    let b_path = store.image_path(&b_id).unwrap();
    store
        .dispatch(Request::DeleteProject {
            identity: a.clone(),
            expected_revision: 2,
        })
        .unwrap();
    assert!(!a_path.exists());
    assert!(b_path.exists());
    assert!(Path::new(&first).exists());
    assert!(store.find(&a).unwrap().is_none());
    assert_eq!(store.image(&b, &b_id).unwrap(), PNG);
}

#[test]
fn request_contract_rejects_extra_fields_and_bounds_inputs_without_partial_write() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ArtifactStore::new(dir.path()).unwrap();
    let a = identity("a", "chat");
    let request = serde_json::json!({"operation":"save-brief","identity":a,"expectedRevision":0,"templateId":"product-intro","brief":brief(),"style":style()});
    let mut unsafe_request = request.clone();
    unsafe_request["outputPath"] = "C:/outside.png".into();
    assert!(serde_json::from_value::<Request>(unsafe_request).is_err());
    let mut oversized = request.clone();
    oversized["brief"]["points"] = serde_json::json!(["a", "b", "c", "d", "e", "f"]);
    assert!(store
        .dispatch(serde_json::from_value(oversized).unwrap())
        .is_err());
    assert!(store.snapshot().unwrap().projects.is_empty());
    store
        .dispatch(serde_json::from_value(request).unwrap())
        .unwrap();
    for revision in 1..=20 {
        store.dispatch(import(&a, revision, "hello alpha")).unwrap();
    }
    assert!(store.dispatch(import(&a, 21, "hello alpha")).is_err());
    assert_eq!(store.find(&a).unwrap().unwrap().versions.len(), 20);
}
