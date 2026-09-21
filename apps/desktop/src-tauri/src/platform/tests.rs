use super::*;
#[test]
fn pet_card_fits_work_area_at_common_dpi_and_negative_monitor_positions() {
    assert_eq!(fit_pet_size(true, 1.0, 1920, 1040), (328.0, 600.0));
    assert_eq!(fit_pet_size(true, 1.5, 1920, 1040), (328.0, 600.0));
    assert_eq!(fit_pet_size(true, 2.0, 1920, 1040), (328.0, 520.0));
    let position = clamp_to_work_area(
        Position { x: -2200, y: 900 },
        656,
        1040,
        -1920,
        40,
        1920,
        1040,
    );
    assert_eq!(position.x, -1920);
    assert_eq!(position.y, 40);
    let position = clamp_to_work_area(Position { x: 1800, y: 1000 }, 328, 600, 80, 0, 1840, 1080);
    assert_eq!(position.x, 1592);
    assert_eq!(position.y, 480);
    let expanded_from_left_edge =
        clamp_to_work_area(Position { x: -143, y: 100 }, 328, 600, 0, 0, 1920, 1040);
    assert_eq!(expanded_from_left_edge.x, 0);
}
#[test]
fn individual_visibility_preserves_other_hidden_pets_and_global_hide() {
    let desktop = Desktop {
        visible: AtomicBool::new(true),
        hidden_slots: Mutex::new([false; 3]),
        positions: Mutex::new(HashMap::new()),
        data_dir: PathBuf::new(),
        bridge: Mutex::new(None),
    };
    change_slot_visibility(&desktop, 1, false).unwrap();
    assert_eq!(*desktop.hidden_slots.lock().unwrap(), [false, true, false]);
    desktop.visible.store(false, Ordering::Relaxed);
    change_slot_visibility(&desktop, 2, true).unwrap();
    assert!(desktop.visible.load(Ordering::Relaxed));
    assert_eq!(*desktop.hidden_slots.lock().unwrap(), [true, true, false]);
    change_slot_visibility(&desktop, 0, true).unwrap();
    assert_eq!(*desktop.hidden_slots.lock().unwrap(), [false, true, false]);
    assert!(change_slot_visibility(&desktop, 3, true).is_err());
}
