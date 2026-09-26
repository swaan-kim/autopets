use crate::{application::store::SharedStore, domain::task_graph::Saved};
#[tauri::command]
pub(crate) fn task_graph_snapshot(store: tauri::State<SharedStore>) -> Result<Vec<Saved>, String> {
    store.lock().map_err(|_| "작업 관계를 읽을 수 없습니다.")?.task_graph_snapshot()
}
