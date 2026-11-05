//! The floating preview pet window. Independent of the AutoPets desktop app:
//! no store, bridge, hooks or saved pet data are touched here.
//!
//! "Hide" destroys the window and remembers its position; "show" creates a
//! fresh window there. Re-showing a hidden WebView2 window drops the first
//! click, while a fresh window takes input immediately without having to
//! steal keyboard focus from Codex.

use crate::{flag, status};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindowBuilder};

pub(crate) const LABEL: &str = "autopet";
/// Logical window size; the circle and its hover controls fit inside.
const WINDOW_SIZE: f64 = 120.0;
/// Logical distance from the work-area edge (taskbar excluded).
const MARGIN: f64 = 24.0;

#[derive(Default)]
struct Runtime {
    /// The current window has rendered and is visible.
    ready: bool,
    /// Whether this process has already shown a pet once.
    shown_once: bool,
    /// Launcher request waiting for the window's first render.
    pending_nonce: Option<String>,
    /// Where the pet was when it was last hidden.
    last_position: Option<PhysicalPosition<i32>>,
    /// The window's destruction was requested but has not completed yet.
    closing: bool,
    /// Show request that arrived while the old window was still closing.
    show_after_close: Option<String>,
}

type SharedRuntime = Mutex<Runtime>;

pub fn serve(action: String, nonce: String, host: crate::host::HostInfo) {
    let app = tauri::Builder::default()
        // Must be the first plugin: a second process forwards its arguments
        // here and exits before creating any window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let action = flag(&argv, "--action").unwrap_or_else(|| "show".into());
            let nonce = flag(&argv, "--nonce").unwrap_or_default();
            crate::slides::set_host(app, crate::host_from_args(&argv));
            if action.starts_with("chat-") {
                // The invoking Codex chat's wait/done/fail (see handoff.rs).
                crate::slides::on_chat(app, &action, &argv, nonce);
            } else {
                apply(app, &action, nonce);
            }
        }))
        .manage(SharedRuntime::default())
        .manage(crate::bubble::SharedBubble::default())
        .manage(crate::features::Session::default())
        .manage(crate::slides::Jobs::default())
        .invoke_handler(tauri::generate_handler![
            pet_ready,
            pet_focus,
            pet_hide,
            pet_quit,
            crate::bubble::pet_bubble_side,
            crate::bubble::pet_bubble_resize,
            crate::bubble::pet_wait_mouse_up,
            crate::features::pet_catalog,
            crate::features::pet_session_get,
            crate::features::pet_session_set,
            crate::slides::pet_slides_start,
            crate::slides::pet_slides_cancel,
            crate::slides::pet_slides_status,
            crate::slides::pet_slides_open,
            crate::slides::pet_chat_status,
            crate::slides::pet_checkpoint_answer
        ])
        .on_window_event(|window, event| {
            if window.label() == LABEL && matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                let deferred = with_runtime(app, |rt| {
                    rt.closing = false;
                    rt.show_after_close.take()
                });
                if let Some(nonce) = deferred {
                    show(app, nonce);
                }
            }
        })
        .setup(move |app| {
            if action != "show" {
                // hide/quit with no running pet: nothing to do.
                write_status(&nonce, "not-running", false, None);
                std::process::exit(0);
            }
            crate::slides::set_host(app.handle(), host.clone());
            crate::slides::start_monitor(app.handle());
            show(app.handle(), nonce.clone());
            // Without a usable desktop (e.g. started inside an agent sandbox
            // account) the page never renders; do not linger invisibly.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(30));
                if !with_runtime(&handle, |rt| rt.shown_once) {
                    std::process::exit(1);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("AutoPet preview could not start");
    app.run(|_app, event| {
        // A hidden pet has no window; keep the process until an explicit quit.
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            api.prevent_exit();
        }
    });
}

fn with_runtime<R>(app: &AppHandle, f: impl FnOnce(&mut Runtime) -> R) -> R {
    let state = app.state::<SharedRuntime>();
    let mut runtime = state.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut runtime)
}

fn write_status(nonce: &str, state: &str, created: bool, position: Option<PhysicalPosition<i32>>) {
    status::write(&status::Status {
        nonce: nonce.to_owned(),
        state: state.to_owned(),
        pid: std::process::id(),
        created,
        x: position.map(|p| p.x),
        y: position.map(|p| p.y),
    });
}

/// The pet's own position (not the widened window's while the bubble is open).
fn current_position(app: &AppHandle) -> Option<PhysicalPosition<i32>> {
    app.get_webview_window(LABEL)
        .and_then(|w| crate::bubble::pet_origin(app, &w))
        .or_else(|| with_runtime(app, |rt| rt.last_position))
}

/// Shows the pet, creating its window when needed. The status is written
/// right away for a visible pet, otherwise after the page's first frame.
fn show(app: &AppHandle, nonce: String) {
    if app.get_webview_window(LABEL).is_some() {
        // Destroying a window is asynchronous: a show right after a hide must
        // wait for the old window to go, then build a fresh one.
        let deferred = with_runtime(app, |rt| {
            if rt.closing {
                rt.show_after_close = Some(nonce.clone());
            }
            rt.closing
        });
        if deferred {
            return;
        }
        let ready = with_runtime(app, |rt| {
            if !rt.ready {
                rt.pending_nonce = Some(nonce.clone());
            }
            rt.ready
        });
        if ready {
            write_status(&nonce, "shown", false, current_position(app));
        }
        return;
    }
    let position = with_runtime(app, |rt| {
        rt.ready = false;
        rt.pending_nonce = Some(nonce);
        rt.last_position
    });
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("AutoPets 테스트 펫")
        .inner_size(WINDOW_SIZE, WINDOW_SIZE)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build();
    let Ok(window) = built else { return };
    let position = position.or_else(|| default_position(&window));
    if let Some(position) = position {
        let _ = window.set_position(position);
    }
    // Last resort if the page never reports its first frame: showing the
    // window lets WebView2 resume rendering, and the page then reports.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let waiting = !with_runtime(&handle, |rt| rt.ready || rt.closing);
        if waiting {
            if let Some(window) = handle.get_webview_window(LABEL) {
                let _ = window.show();
            }
        }
    });
}

fn default_position(window: &tauri::WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let size = (WINDOW_SIZE * scale).round() as i32;
    let margin = (MARGIN * scale).round() as i32;
    Some(PhysicalPosition::new(
        area.position.x + area.size.width as i32 - size - margin,
        area.position.y + area.size.height as i32 - size - margin,
    ))
}

fn hide(app: &AppHandle, nonce: &str) {
    let position = current_position(app);
    with_runtime(app, |rt| {
        rt.ready = false;
        rt.last_position = position;
        rt.show_after_close = None;
    });
    crate::bubble::reset(app);
    if let Some(window) = app.get_webview_window(LABEL) {
        with_runtime(app, |rt| rt.closing = true);
        let _ = window.destroy();
    }
    write_status(nonce, "hidden", false, position);
}

fn quit(app: &AppHandle, nonce: &str) {
    write_status(nonce, "closed", false, current_position(app));
    app.exit(0);
}

/// Brings a hidden pet back when the chat asks the user something, so the
/// question can be answered. The window is created unfocused (see `show`),
/// so whatever the user is typing in another app keeps the keyboard.
pub(crate) fn reveal(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let visible = handle.get_webview_window(LABEL).is_some() && !with_runtime(&handle, |rt| rt.closing);
        if !visible {
            show(&handle, String::new());
        }
    });
}

/// Handles a launcher request forwarded to the running pet.
fn apply(app: &AppHandle, action: &str, nonce: String) {
    match action {
        "hide" => hide(app, &nonce),
        "quit" => quit(app, &nonce),
        _ => show(app, nonce),
    }
}

/// Called by the page after its first frame so the window never flashes empty.
#[tauri::command]
fn pet_ready(app: AppHandle) {
    let reported = with_runtime(&app, |rt| rt.ready);
    if reported {
        return;
    }
    let (pending, created) = with_runtime(&app, |rt| {
        rt.ready = true;
        let created = !rt.shown_once;
        rt.shown_once = true;
        (rt.pending_nonce.take().unwrap_or_default(), created)
    });
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
    }
    write_status(&pending, "shown", created, current_position(&app));
}

#[tauri::command]
fn pet_focus(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if !window.is_focused().unwrap_or(false) {
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn pet_hide(app: AppHandle) {
    hide(&app, "");
}

#[tauri::command]
fn pet_quit(app: AppHandle) {
    quit(&app, "");
}
