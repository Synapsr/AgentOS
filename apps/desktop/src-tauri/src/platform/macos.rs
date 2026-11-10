//! macOS: window levels and Spaces through AppKit, power through IOKit.

use std::ffi::c_void;

use objc2_app_kit::{
    NSScreenSaverWindowLevel, NSWindow, NSWindowAnimationBehavior, NSWindowCollectionBehavior,
};
use objc2_foundation::NSString;
use tauri::WebviewWindow;

/// Shows a window above everything — other apps, the Dock, the menu bar — on
/// every Space, without making this app the active one. Main thread.
pub fn cover(window: &WebviewWindow) -> tauri::Result<()> {
    let window = ns_window(window)?;
    // The level of screen savers: nothing an app or the agent opens goes above it.
    window.setLevel(NSScreenSaverWindowLevel);
    window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    // Black at once, not zooming in.
    window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    window.orderFrontRegardless();
    Ok(())
}

/// Lets a window that is on every Space also sit beside full-screen apps. Main thread.
pub fn join_full_screen_spaces(window: &WebviewWindow) -> tauri::Result<()> {
    let window = ns_window(window)?;
    window.setCollectionBehavior(
        window.collectionBehavior() | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    Ok(())
}

fn ns_window(window: &WebviewWindow) -> tauri::Result<&NSWindow> {
    // SAFETY: Tauri hands out the window's own `NSWindow`, which lives as long as `window`;
    // every caller is on the main thread, where AppKit objects may be used.
    Ok(unsafe { &*window.ns_window()?.cast::<NSWindow>() })
}

/// Keeps the computer and its display awake for as long as it lives.
pub struct Awake(u32);

impl Awake {
    /// `reason` is what the system shows for it (`pmset -g assertions`). `None` when the system refuses.
    pub fn new(reason: &str) -> Option<Self> {
        let kind = NSString::from_str("PreventUserIdleDisplaySleep");
        let name = NSString::from_str(reason);
        let mut id = 0;
        // SAFETY: an `NSString` is a `CFString`; both outlive the call, and `id` is a valid place to write.
        let result = unsafe {
            IOPMAssertionCreateWithName(as_cf(&kind), ASSERTION_ON, as_cf(&name), &mut id)
        };
        (result == 0).then_some(Self(id))
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        // SAFETY: the id came from `IOPMAssertionCreateWithName` and is released once.
        unsafe { IOPMAssertionRelease(self.0) };
    }
}

/// `kIOPMAssertionLevelOn`.
const ASSERTION_ON: u32 = 255;

fn as_cf(string: &NSString) -> *const c_void {
    (string as *const NSString).cast()
}

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPMAssertionCreateWithName(
        kind: *const c_void,
        level: u32,
        name: *const c_void,
        id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(id: u32) -> i32;
}
