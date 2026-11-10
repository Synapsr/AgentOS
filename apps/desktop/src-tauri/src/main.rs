//! The AgentOS desktop shell.
//!
//! A thin native layer around the core daemon. It starts the core (or joins
//! one that is already running), opens windows onto the interface the core
//! serves, lives in the menu bar, and covers the screens when the computer is
//! handed to the agent. It has no interface of its own beyond a "starting…"
//! page, and no state of its own: the core is the source of truth.
//!
//! - `core_process` — joins or starts the core, stops it on quit
//! - `client`       — the routes of the protocol the shell uses
//! - `secret`       — the local token and the nonces it is proved with
//! - `shell`        — follows the core and applies what it says
//! - `windows`      — the main window and the side panel
//! - `os_mode`      — black screens, awake computer, the way out
//! - `tray`         — the menu-bar item
//! - `shortcuts`    — the global shortcuts
//! - `i18n`         — the menu's words, in English and French
//! - `platform`     — what each operating system does its own way

// No console window next to the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod client;
mod core_process;
mod i18n;
mod os_mode;
mod platform;
mod secret;
mod shell;
mod shortcuts;
mod tray;
mod windows;

use tauri::{Manager, RunEvent};
use tauri_plugin_window_state::StateFlags;

fn main() {
    tauri::Builder::default()
        // First, so that a second launch stops here and brings the running app forward.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            windows::show_main(app)
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .with_filter(|label| label == windows::MAIN)
                .build(),
        )
        .manage(os_mode::OsMode::default())
        .on_window_event(windows::on_event)
        .setup(|app| {
            let app = app.handle();
            let resources = app.path().resource_dir().ok();
            app.manage(shell::Shell::new(core_process::Config::load(
                resources.as_deref(),
            )));
            windows::open_main(app)?;
            tray::create(app)?;
            shortcuts::register(app);
            shell::start(app.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the app's own configuration is valid")
        .run(|app, event| match event {
            // Windows closing is not quitting: the app lives in the menu bar.
            RunEvent::ExitRequested {
                code: None, api, ..
            } => api.prevent_exit(),
            // A click on the Dock icon.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => windows::show_main(app),
            RunEvent::Exit => shell::stop(app),
            _ => {}
        });
}
