//! The menu-bar item: a glyph that says how the agent is, and a short menu
//! in the agent's language.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager};

use crate::client::State;
use crate::shell::{self, Known};
use crate::{shortcuts, windows};

/// The glyphs: stills of the presence, one per state, made by the design
/// package (docs/DESIGN.md, "The menu bar"). They are template images: only
/// their transparency matters, and the system tints them for a light or a
/// dark menu bar. The image changes with the state; it is never animated,
/// tinted or badged here.
const IDLE: &[u8] = include_bytes!("../../../../packages/design/brand/menubar-idle@2x.png");
const WORKING: &[u8] = include_bytes!("../../../../packages/design/brand/menubar-working@2x.png");
const WAITING: &[u8] = include_bytes!("../../../../packages/design/brand/menubar-waiting@2x.png");
const OFFLINE: &[u8] = include_bytes!("../../../../packages/design/brand/menubar-offline@2x.png");

const OPEN: &str = "open";
const SIDE_PANEL: &str = "side-panel";
const GIVE_SCREEN: &str = "give-screen";
const ADD_PHONE: &str = "add-phone";
const QUIT: &str = "quit";

/// The menu-bar item and the entries whose text or availability changes.
pub struct Tray {
    icon: TrayIcon,
    open: MenuItem<tauri::Wry>,
    side_panel: MenuItem<tauri::Wry>,
    give_screen: MenuItem<tauri::Wry>,
    add_phone: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

/// Puts the item in the menu bar, as it looks before the core has answered.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, shortcut: Option<&str>| MenuItem::with_id(app, id, "", true, shortcut);
    let tray = Tray {
        open: item(OPEN, None)?,
        side_panel: item(SIDE_PANEL, Some(shortcuts::SIDE_PANEL))?,
        give_screen: item(GIVE_SCREEN, None)?,
        add_phone: item(ADD_PHONE, None)?,
        quit: item(QUIT, None)?,
        icon: TrayIconBuilder::with_id("agentos")
            .show_menu_on_left_click(true)
            .build(app)?,
    };
    let separator = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[
            &tray.open,
            &tray.side_panel,
            &tray.give_screen,
            &separator()?,
            &tray.add_phone,
            &separator()?,
            &tray.quit,
        ],
    )?;
    tray.icon.set_menu(Some(menu))?;
    tray.icon
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN => windows::show_main(app),
            SIDE_PANEL => windows::toggle_panel(app),
            GIVE_SCREEN => shell::give_screen(app),
            ADD_PHONE => windows::show_page(app, "/add-phone"),
            QUIT => app.exit(0),
            _ => {}
        });
    app.manage(tray);
    show(app, &Known::default());
    Ok(())
}

/// Makes the glyph and the menu say what the core last said. Main thread.
pub fn show(app: &AppHandle, known: &Known) {
    let tray = app.state::<Tray>();
    let words = known.language.words();
    let agent = if known.agent.is_empty() {
        words.your_agent
    } else {
        &known.agent
    };
    let reachable = known.token.is_some();

    let _ = tray.open.set_text(words.open);
    let _ = tray.side_panel.set_text(words.side_panel);
    let _ = tray
        .give_screen
        .set_text(words.give_screen.replace("{agent}", agent));
    let _ = tray.add_phone.set_text(words.add_phone);
    let _ = tray.quit.set_text(words.quit);
    // These three need the interface, which the core serves.
    for item in [&tray.side_panel, &tray.give_screen, &tray.add_phone] {
        let _ = item.set_enabled(reachable);
    }
    let _ = tray
        .icon
        .set_icon_with_as_template(Some(glyph(known.status.map(|status| status.state))), true);
    let _ = tray.icon.set_tooltip(Some(if known.agent.is_empty() {
        "AgentOS"
    } else {
        &known.agent
    }));
}

/// The glyph for a state; the flat dash while the core cannot be reached.
fn glyph(state: Option<State>) -> Image<'static> {
    let png = match state {
        None => OFFLINE,
        Some(State::Idle) => IDLE,
        Some(State::Working) => WORKING,
        Some(State::Waiting) => WAITING,
    };
    Image::from_bytes(png).expect("the design package's glyphs are PNGs")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_has_a_glyph_of_its_own() {
        let states = [
            None,
            Some(State::Idle),
            Some(State::Working),
            Some(State::Waiting),
        ];
        let glyphs: Vec<_> = states.into_iter().map(glyph).collect();
        for (index, one) in glyphs.iter().enumerate() {
            assert_eq!((one.width(), one.height()), (36, 36), "18 points at 2x");
            for other in &glyphs[index + 1..] {
                assert_ne!(one.rgba(), other.rgba());
            }
        }
    }
}
