//! The global shortcuts: they work whichever app has the keyboard.
//!
//! Both avoid the chords people and systems already rely on — no Option+Space
//! (a non-breaking space on French keyboards, and most launchers), nothing on
//! Control+Option (VoiceOver), nothing a text field would type.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::windows;

/// Shows or hides the side panel.
#[cfg(target_os = "macos")]
pub const SIDE_PANEL: &str = "Ctrl+Cmd+P";
#[cfg(not(target_os = "macos"))]
pub const SIDE_PANEL: &str = "Ctrl+Alt+P";

/// Takes the screen back from the agent. Registered only while it has the
/// screen (see `os_mode`), so that it takes nothing from other apps otherwise.
#[cfg(target_os = "macos")]
pub const TAKE_BACK: &str = "Cmd+Shift+Escape";
#[cfg(not(target_os = "macos"))]
pub const TAKE_BACK: &str = "Ctrl+Alt+Escape";

/// Registers the shortcuts that are always on.
pub fn register(app: &AppHandle) {
    let registered = app
        .global_shortcut()
        .on_shortcut(SIDE_PANEL, |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                windows::toggle_panel(app);
            }
        });
    // Another app may hold the chord: the menu still opens the panel.
    if let Err(error) = registered {
        eprintln!("AgentOS: the side panel shortcut is not available: {error}");
    }
}
