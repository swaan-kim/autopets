use crate::{application::store::SharedStore, domain::pet_custom::View};
const LOCKED: &str = "펫 꾸미기 상태를 읽을 수 없습니다.";

#[tauri::command]
pub(crate) fn pet_custom_snapshot(store: tauri::State<SharedStore>) -> Result<View, String> {
    store.lock().map_err(|_| LOCKED)?.pet_custom_view()
}
/// Coins are taken and the item is given in one transaction, under the store lock.
#[tauri::command]
pub(crate) fn pet_custom_buy(store: tauri::State<SharedStore>, item_id: String) -> Result<View, String> {
    store.lock().map_err(|_| LOCKED)?.pet_custom_buy(&item_id)
}
#[tauri::command]
pub(crate) fn pet_custom_wear(store: tauri::State<SharedStore>, item_id: String, wear: bool) -> Result<View, String> {
    store.lock().map_err(|_| LOCKED)?.pet_custom_wear(&item_id, wear)
}
