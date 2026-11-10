//! OS mode: the screens belong to the agent. Every display turns black and
//! the main one shows the agent's presence (the interface's `/os` page).
//!
//! The covers are ordinary borderless windows raised above everything, on
//! every Space. They are deliberately not native full-screen windows: those
//! live in a Space of their own, and the agent cannot see the apps of another
//! Space. Under a cover it still reads and operates every app, which may take
//! the keyboard from us: nothing here depends on being the focused window.
//!
//! The shell never decides to enter or leave: `set` is called with what the
//! core says. The ways out are the interface's own button (it asks the
//! core), the shortcut registered here, and losing the core.
//!
//! To work on this without losing your own screen, start the app with
//! `AGENTOS_OS_PREVIEW=1`: each cover then takes a corner of its display
//! instead of all of it, and everything else behaves the same.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, Monitor, PhysicalRect, PhysicalSize, WebviewUrl, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::platform::{self, Awake};
use crate::{shell, shortcuts, windows};

/// The cover of the main display, which shows the agent.
const PRESENCE: &str = "os";
/// The covers of the other displays are `cover-1`, `cover-2`…
const COVER: &str = "cover-";

/// Whether the screens are covered, and what is held while they are.
#[derive(Default)]
pub struct OsMode(Mutex<Option<Stay>>);

/// One stay in OS mode.
struct Stay {
    /// Tells this stay from the next.
    id: u64,
    /// The computer stays awake, display included, until this is dropped.
    _awake: Option<Awake>,
}

impl OsMode {
    /// The stay in progress, if the screens are covered.
    fn stay(&self) -> Option<u64> {
        self.0.lock().ok()?.as_ref().map(|stay| stay.id)
    }
}

/// Covers the screens or gives them back, to match what the core says. Main thread.
pub fn set(app: &AppHandle, on: bool) {
    static STAYS: AtomicU64 = AtomicU64::new(0);
    let os_mode = app.state::<OsMode>();
    let Ok(mut stay) = os_mode.0.lock() else {
        return;
    };
    match (on, stay.is_some()) {
        (true, false) => {
            let id = STAYS.fetch_add(1, Ordering::Relaxed);
            let awake = Awake::new("AgentOS: the agent has the screen");
            *stay = Some(Stay { id, _awake: awake });
            drop(stay);
            enter(app, id);
        }
        (false, true) => {
            *stay = None;
            drop(stay);
            leave(app);
        }
        _ => {}
    }
}

fn enter(app: &AppHandle, id: u64) {
    arrange(app);
    // The presence takes the keyboard once: whatever the owner types next goes to it
    // (Escape takes the screen back), until the agent brings another app forward.
    if let Some(presence) = app.get_webview_window(PRESENCE) {
        let _ = presence.set_focus();
    }
    let take_back = |app: &AppHandle, _: &_, event: tauri_plugin_global_shortcut::ShortcutEvent| {
        if event.state() == ShortcutState::Pressed {
            shell::take_back(app);
        }
    };
    if let Err(error) = app
        .global_shortcut()
        .on_shortcut(shortcuts::TAKE_BACK, take_back)
    {
        eprintln!("AgentOS: the shortcut that takes the screen back is not available: {error}");
    }
    watch_displays(app.clone(), id);
}

fn leave(app: &AppHandle) {
    let _ = app.global_shortcut().unregister(shortcuts::TAKE_BACK);
    for cover in covers(app) {
        let _ = cover.destroy();
    }
}

/// Displays come and go (a lid closes, a cable is pulled): looks again every
/// second for as long as this stay lasts.
fn watch_displays(app: AppHandle, id: u64) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        if app.state::<OsMode>().stay() != Some(id) {
            return;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || arrange(&handle));
    });
}

/// Puts one cover on each display: opens the missing ones, moves those whose
/// display changed, removes those whose display is gone. Main thread.
fn arrange(app: &AppHandle) {
    if app.state::<OsMode>().stay().is_none() {
        return;
    }
    let displays = app.available_monitors().unwrap_or_default();
    let main = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| displays.first().cloned());
    let is_main = |display: &Monitor| {
        main.as_ref()
            .is_some_and(|main| main.position() == display.position())
    };

    let mut wanted = Vec::new();
    let mut others = 0;
    for display in &displays {
        let label = if is_main(display) {
            PRESENCE.to_owned()
        } else {
            others += 1;
            format!("{COVER}{others}")
        };
        if let Err(error) = cover(app, &label, display) {
            eprintln!("AgentOS: a display could not be covered: {error}");
        }
        wanted.push(label);
    }
    for cover in covers(app) {
        if !wanted.iter().any(|label| label == cover.label()) {
            let _ = cover.destroy();
        }
    }
}

/// Makes sure the cover `label` fills `display`.
fn cover(app: &AppHandle, label: &str, display: &Monitor) -> tauri::Result<()> {
    let frame = frame_of(display);
    if let Some(cover) = app.get_webview_window(label) {
        if cover.outer_position()? != frame.position || cover.outer_size()? != frame.size {
            windows::place(&cover, display, &frame)?;
        }
        return Ok(());
    }
    let presence = label == PRESENCE;
    let url = match windows::page(app, "/os") {
        Some(url) if presence => WebviewUrl::External(url),
        _ => WebviewUrl::App("black.html".into()),
    };
    // Born in place and black, so that nothing is seen growing or flashing.
    let at = frame.position.to_logical::<f64>(display.scale_factor());
    let size = frame.size.to_logical::<f64>(display.scale_factor());
    let cover = windows::window(app, label, url)
        .position(at.x, at.y)
        .inner_size(size.width, size.height)
        .background_color(windows::BLACK)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        // Only the agent's presence has something to click or type into.
        .focused(false)
        .focusable(presence)
        .accept_first_mouse(true)
        .build()?;
    platform::cover(&cover)
}

/// The part of a display a cover takes: all of it, or a corner when previewing
/// (see the top of this file).
fn frame_of(display: &Monitor) -> PhysicalRect<i32, u32> {
    let preview = std::env::var_os("AGENTOS_OS_PREVIEW").is_some();
    let size = *display.size();
    PhysicalRect {
        position: *display.position(),
        size: if preview {
            PhysicalSize::new(size.width / 5, size.height / 5)
        } else {
            size
        },
    }
}

fn covers(app: &AppHandle) -> impl Iterator<Item = WebviewWindow> {
    let is_cover = |label: &str| label == PRESENCE || label.starts_with(COVER);
    app.webview_windows()
        .into_iter()
        .filter(move |(label, _)| is_cover(label))
        .map(|(_, window)| window)
}
