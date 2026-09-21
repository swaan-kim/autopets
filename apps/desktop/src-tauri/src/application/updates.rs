use super::store::{SharedStore, Store};
use crate::platform::windows::emit;

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
