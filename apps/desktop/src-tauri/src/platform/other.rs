//! Windows and Linux, until they get their own file: what Tauri offers everywhere.

use tauri::WebviewWindow;

/// Shows a window above the others, on every workspace.
///
/// To do: above the taskbar and other always-on-top windows (Windows:
/// `HWND_TOPMOST` over the whole monitor; Linux: a layer-shell overlay or an
/// override-redirect window).
pub fn cover(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_always_on_top(true)?;
    window.set_visible_on_all_workspaces(true)?;
    window.show()
}

/// Nothing more to ask for here: full-screen Spaces are a macOS notion.
pub fn join_full_screen_spaces(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// Keeps the computer and its display awake for as long as it lives.
///
/// To do: `SetThreadExecutionState` on Windows, the `org.freedesktop.ScreenSaver`
/// inhibit call on Linux. Until then the computer follows its own power settings.
pub struct Awake;

impl Awake {
    /// `None`: nothing is held yet on this system.
    pub fn new(_reason: &str) -> Option<Self> {
        None
    }
}
