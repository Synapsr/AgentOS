//! The windows. None has content of its own: each shows a page of the
//! interface the core serves (`/`, `/panel`, `/os`), which talks to the core
//! over HTTP and needs nothing from the shell.

use tauri::webview::NewWindowResponse;
use tauri::window::Color;
use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

use crate::platform;
use crate::shell::Shell;

/// The main window: the agent and its conversation, or onboarding the first time.
pub const MAIN: &str = "main";
/// The side panel: the conversation in a narrow column at the edge of the screen.
pub const PANEL: &str = "panel";

/// Width of the side panel, in points.
const PANEL_WIDTH: f64 = 380.0;
/// The presence surfaces are true black (docs/DESIGN.md).
pub const BLACK: Color = Color(0, 0, 0, 255);

/// The address of a page of the interface, carrying the token the page needs.
/// `None` while the core cannot be reached.
pub fn page(app: &AppHandle, path: &str) -> Option<Url> {
    let shell = app.state::<Shell>();
    let token = shell.known().token.clone()?;
    Url::parse(&format!("{}#token={token}", shell.config.url(path))).ok()
}

/// A window of the app, not shown yet. It stays on the interface: any other
/// link opens in the owner's browser. Its web view keeps nothing on disk —
/// no cache, no history, no storage: the addresses of its pages carry the
/// local token, and WebKit's cache would otherwise write them where any
/// program of this user, the agent included, can read them.
pub fn window<'a>(
    app: &'a AppHandle,
    label: &str,
    url: WebviewUrl,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let (navigating, opening) = (app.clone(), app.clone());
    WebviewWindowBuilder::new(app, label, url)
        .title("AgentOS")
        .visible(false)
        .incognito(true)
        .on_navigation(move |url| is_ours(&navigating, url) || open_outside(&navigating, url))
        .on_new_window(move |url, _| {
            open_outside(&opening, &url);
            NewWindowResponse::Deny
        })
}

/// Opens the main window on the page that says the app is starting.
/// `load` points it at the interface once the core answers.
pub fn open_main(app: &AppHandle) -> tauri::Result<()> {
    let main = window(app, MAIN, WebviewUrl::App("index.html".into()))
        .inner_size(1040.0, 720.0)
        .min_inner_size(380.0, 560.0)
        .center()
        .background_color(BLACK);
    // The interface is black to its edges: the title bar becomes part of it.
    #[cfg(target_os = "macos")]
    let main = main
        .title_bar_style(tauri::TitleBarStyle::Transparent)
        .hidden_title(true);
    main.build()?.show()
}

/// Points the windows at the interface with the token of the core that has
/// just proved itself. A window that already shows the interface is left
/// alone, unless the token is a new one: a core that was restarted has a new
/// token, and a page opened with the old one would be a stranger to it.
pub fn load(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let Some(token) = shell.known().token.clone() else {
        return;
    };
    let renewed = shell.pages_token().replace(token.clone()) != Some(token);
    for (label, start) in [(MAIN, "/"), (PANEL, "/panel")] {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        let Ok(url) = window.url() else { continue };
        let there = is_interface(app, &url);
        if there && !renewed {
            continue;
        }
        // The page it was on, with the new token; the start page when it shows none yet.
        let path = if there { url.path() } else { start };
        if let Some(target) = page(app, path) {
            let _ = window.navigate(target);
        }
    }
}

/// Says in the main window why the app is not starting, if that is still what it shows.
pub fn explain(app: &AppHandle, why: &str) {
    let Some(main) = app.get_webview_window(MAIN) else {
        return;
    };
    if main.url().is_ok_and(|url| !is_interface(app, &url)) {
        let _ = main.eval(format!("tell({})", serde_json::Value::from(why)));
    }
}

/// Brings the main window back in front of its owner.
pub fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window(MAIN) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// Shows the main window on a page of the interface.
pub fn show_page(app: &AppHandle, path: &str) {
    if let (Some(main), Some(url)) = (app.get_webview_window(MAIN), page(app, path)) {
        let _ = main.navigate(url);
    }
    show_main(app);
}

/// Shows the side panel at the right edge of the display the pointer is on, or puts it away.
///
/// The panel only ever comes forward here, when its owner asks: nothing the
/// agent says or does shows it or gives it the keyboard.
pub fn toggle_panel(app: &AppHandle) {
    if let Err(error) = toggle(app) {
        eprintln!("AgentOS: the side panel could not be shown: {error}");
    }
}

fn toggle(app: &AppHandle) -> tauri::Result<()> {
    // Created the first time it is asked for, then kept: it comes back at once, where the conversation was.
    let panel = match (app.get_webview_window(PANEL), page(app, "/panel")) {
        (Some(panel), _) if panel.is_visible()? => return panel.hide(),
        (Some(panel), _) => panel,
        (None, Some(url)) => {
            let panel = window(app, PANEL, WebviewUrl::External(url))
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .build()?;
            platform::join_full_screen_spaces(&panel)?;
            panel
        }
        // The core cannot be reached: there is nothing to show yet.
        (None, None) => return Ok(()),
    };
    if let Some(display) = display_under_pointer(app) {
        let area = display.work_area();
        let width = ((PANEL_WIDTH * display.scale_factor()) as u32).min(area.size.width);
        let left = area.position.x + (area.size.width - width) as i32;
        let column = PhysicalRect {
            position: PhysicalPosition::new(left, area.position.y),
            size: PhysicalSize::new(width, area.size.height),
        };
        place(&panel, &display, &column)?;
    }
    panel.show()?;
    panel.set_focus()
}

/// Moves a window onto an area of a display.
pub fn place(
    window: &WebviewWindow,
    display: &Monitor,
    area: &PhysicalRect<i32, u32>,
) -> tauri::Result<()> {
    // macOS lays all displays out in points. Given pixels, the window would
    // convert them with the scale of the display it is on, not the one it is going to.
    #[cfg(target_os = "macos")]
    {
        let scale = display.scale_factor();
        window.set_size(area.size.to_logical::<f64>(scale))?;
        window.set_position(area.position.to_logical::<f64>(scale))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = display;
        window.set_size(area.size)?;
        window.set_position(area.position)
    }
}

/// The display the pointer is on, else the main one.
fn display_under_pointer(app: &AppHandle) -> Option<Monitor> {
    let main = app.primary_monitor().ok().flatten();
    let pointer = app.cursor_position().ok()?;
    // On macOS the pointer is reported in the main display's pixels but displays are looked up in points.
    #[cfg(target_os = "macos")]
    let pointer = pointer.to_logical::<f64>(main.as_ref().map_or(1.0, Monitor::scale_factor));
    app.monitor_from_point(pointer.x, pointer.y)
        .ok()
        .flatten()
        .or(main)
}

/// Closing a window puts it away: the app lives in the menu bar, and the
/// covers of OS mode only leave when the core says so.
pub fn on_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if matches!(window.label(), MAIN | PANEL) {
            let _ = window.hide();
        }
    }
}

/// Whether `url` is a page of the interface the core serves.
fn is_interface(app: &AppHandle, url: &Url) -> bool {
    let port = app.state::<Shell>().config.port;
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

/// Whether a window may show `url`: the interface, or the app's own pages
/// (`tauri://localhost`, spelled `http://tauri.localhost` on Windows).
fn is_ours(app: &AppHandle, url: &Url) -> bool {
    matches!(url.scheme(), "tauri" | "about")
        || url.host_str() == Some("tauri.localhost")
        || is_interface(app, url)
}

/// Opens a link in the owner's browser. Always false: the window itself does not follow it.
fn open_outside(app: &AppHandle, url: &Url) -> bool {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    false
}
