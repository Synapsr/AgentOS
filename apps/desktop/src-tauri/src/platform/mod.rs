//! What each operating system does its own way: putting a window above
//! everything, and keeping the computer awake. macOS is done; the other
//! systems run on the portable fallbacks until they get their own file.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
mod other;
#[cfg(not(target_os = "macos"))]
pub use other::*;
