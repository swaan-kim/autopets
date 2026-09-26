use super::store::{SharedStore, Store, Snapshot};
use crate::platform::windows::emit;

/// Window callbacks can synchronously wait for the main thread, whose commands
/// read this store. Release the guard before crossing that boundary.
pub(crate) fn publish_snapshot(
    store: &SharedStore,
    publish: impl FnOnce(Snapshot),
) -> Result<(), String> {
    let snapshot = {
        let state = store.lock().map_err(|_| "상태 저장소에 연결할 수 없습니다.")?;
        state.snapshot()
    };
    publish(snapshot);
    Ok(())
}

pub(crate) fn update(
    app: &tauri::AppHandle,
    store: &SharedStore,
    action: impl FnOnce(&mut Store) -> Result<(), String>,
) -> Result<(), String> {
    let snapshot = {
        let mut state = store
            .lock()
            .map_err(|_| "상태 저장소에 연결할 수 없습니다.")?;
        action(&mut state)?;
        state.snapshot()
    };
    emit(app, snapshot);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex, mpsc};
    use std::time::Duration;

    #[test]
    fn snapshot_delivery_does_not_block_a_synchronous_ui_read() {
        let directory = tempfile::tempdir().unwrap();
        let store: SharedStore = Arc::new(Mutex::new(Store::new(directory.path()).unwrap()));
        let ui_store = store.clone();
        publish_snapshot(&store, move |snapshot| {
            let (sender, receiver) = mpsc::channel();
            let ui = std::thread::spawn(move || {
                let current = ui_store.lock().unwrap().snapshot();
                let _ = sender.send(current.slots.len());
            });
            // With the old guard held during publication, the UI cannot reply.
            assert_eq!(receiver.recv_timeout(Duration::from_secs(2)).unwrap(), snapshot.slots.len());
            ui.join().unwrap();
        }).unwrap();
    }
}
