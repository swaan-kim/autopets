use super::windows::*;
use tauri::Manager;

pub(crate) fn install(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    let manager = MenuItem::with_id(app, "manager", "작업 관리 열기", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "펫 모두 표시", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "펫 모두 숨기기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "AutoPets 종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&manager, &show, &hide, &quit])?;
    tauri::tray::TrayIconBuilder::with_id("autopets-tray")
        .icon(make_icon())
        .tooltip("AutoPets · 작은 작업 동료")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "manager" => show_manager(app.clone(), None, None),
            "show" | "hide" => {
                let visible = event.id.as_ref() == "show";
                set_pets_visible(app.clone(), app.state(), app.state(), visible);
            }
            "quit" => quit_app(app.clone()),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn make_icon() -> tauri::image::Image<'static> {
    let mut bytes = vec![0; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let i = (y * 32 + x) * 4;
            let inside = (5..27).contains(&x) && (8..28).contains(&y)
                || (7..12).contains(&x) && (3..11).contains(&y)
                || (20..25).contains(&x) && (3..11).contains(&y);
            if inside {
                bytes[i..i + 4].copy_from_slice(&[165, 193, 110, 255]);
            }
            if ((x == 11 || x == 21) && (15..18).contains(&y)) || (x > 13 && x < 19 && y == 22) {
                bytes[i..i + 4].copy_from_slice(&[55, 68, 44, 255]);
            }
        }
    }
    tauri::image::Image::new_owned(bytes, 32, 32)
}
