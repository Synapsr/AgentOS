//! What the shell knows, and how it keeps up. One thread follows the core;
//! everything the core says is applied on the main thread, where windows
//! live. The shell decides nothing: the core is the source of truth.

use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::client::{self, Mode, Status, Update};
use crate::core_process::{Config, CoreProcess, StartError};
use crate::i18n::Language;
use crate::{os_mode, tray, windows};

/// Pause before trying again after losing the core, doubled each time it fails again.
const RETRY_FIRST: Duration = Duration::from_millis(500);
const RETRY_LONGEST: Duration = Duration::from_secs(30);
/// A core that stayed up this long was healthy: the next loss starts from the first pause again.
const STEADY: Duration = Duration::from_secs(60);

/// The app's state: where the core is, the process if we started it, and what it last said.
pub struct Shell {
    pub config: Config,
    process: CoreProcess,
    known: Mutex<Known>,
    /// The token the windows' pages were last opened with.
    pages_token: Mutex<Option<String>>,
}

/// What the core last told the shell. It holds the local token, so it is
/// deliberately not printable.
#[derive(Clone, Default, PartialEq)]
pub struct Known {
    /// The local token, while the core can be reached.
    pub token: Option<String>,
    /// The agent's name; empty until the core has said it.
    pub agent: String,
    pub language: Language,
    /// What the agent is doing and who has the screen; `None` while the core cannot be reached.
    pub status: Option<Status>,
}

impl Known {
    /// Whether the screens belong to the agent right now.
    pub fn os_mode(&self) -> bool {
        self.status.is_some_and(|status| status.mode == Mode::Os)
    }
}

/// News about the core, in the order it happened.
enum Change {
    /// A core answers, and this is its local token.
    Up(String),
    /// The core said something.
    Said(Update),
    /// The core cannot be reached, and why.
    Down(String),
}

impl Shell {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            process: CoreProcess::default(),
            known: Mutex::default(),
            pages_token: Mutex::default(),
        }
    }

    /// The token the windows' pages were last opened with (see `windows::load`).
    pub fn pages_token(&self) -> MutexGuard<'_, Option<String>> {
        self.pages_token
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// What the core last said.
    pub fn known(&self) -> MutexGuard<'_, Known> {
        // Plain data: still sound after a panic elsewhere.
        self.known
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Starts following the core, for the life of the app: joins or starts one,
/// listens to it, and when it is lost starts over, waiting longer each time.
pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let shell = app.state::<Shell>();
        let mut pause = RETRY_FIRST;
        loop {
            let began = Instant::now();
            let why = match shell.process.ensure(&shell.config) {
                Ok(token) => {
                    tell(&app, Change::Up(token.clone()));
                    client::follow(&shell.config, &token, |update| {
                        tell(&app, Change::Said(update))
                    })
                    .to_string()
                }
                Err(StartError::Quitting) => return,
                Err(error) => error.to_string(),
            };
            if shell.process.stopped() {
                return;
            }
            eprintln!("AgentOS: {why}");
            tell(&app, Change::Down(why));
            if began.elapsed() > STEADY {
                pause = RETRY_FIRST;
            }
            thread::sleep(pause);
            pause = (pause * 2).min(RETRY_LONGEST);
        }
    });
}

/// Called once, as the app quits: stops the core if it is ours.
pub fn stop(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let known = shell.known().clone();
    // A core that is not ours keeps running: do not leave it believing the screens are black.
    if let (true, Some(token)) = (known.os_mode(), &known.token) {
        let _ = client::set_mode(&shell.config, token, Mode::Desktop);
    }
    shell.process.stop();
}

/// Asks the core to give the screen to the agent. The screens turn black when the core says so.
pub fn give_screen(app: &AppHandle) {
    ask_for(app, Mode::Os);
}

/// Asks the core to give the screen back to its owner.
pub fn take_back(app: &AppHandle) {
    ask_for(app, Mode::Desktop);
}

fn ask_for(app: &AppHandle, mode: Mode) {
    let app = app.clone();
    // Off the main thread: a core that hangs must not freeze the menu bar or the shortcut.
    thread::spawn(move || {
        let shell = app.state::<Shell>();
        let token = shell.known().token.clone();
        match token.map(|token| client::set_mode(&shell.config, &token, mode)) {
            // Its answer is news like any other, in case the event is slow to come.
            Some(Ok(status)) => tell(&app, Change::Said(Update::Status(status))),
            // A person must never be stuck behind a black screen: when the core cannot
            // be told, the screens come back anyway. The core has the last word again
            // as soon as it speaks.
            _ if mode == Mode::Desktop => {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || os_mode::set(&handle, false));
            }
            _ => {}
        }
    });
}

fn tell(app: &AppHandle, change: Change) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || apply(&handle, change));
}

/// Takes in a change and makes the windows, the menu bar and the screens match. Main thread.
fn apply(app: &AppHandle, change: Change) {
    let shell = app.state::<Shell>();
    let (before, now) = {
        let mut known = shell.known();
        let before = known.clone();
        match &change {
            Change::Up(token) => known.token = Some(token.clone()),
            // Said before the core was lost, heard after: it no longer counts.
            Change::Said(_) if known.token.is_none() => {}
            Change::Said(Update::Node(node)) => {
                known.agent = node.agent.name.clone();
                known.language = Language::from_tag(&node.language);
            }
            Change::Said(Update::Status(status)) => known.status = Some(*status),
            Change::Down(_) => {
                known.token = None;
                known.status = None;
            }
        }
        (before, known.clone())
    };

    if before.status.is_none() && now.status.is_some() {
        windows::load(app);
    }
    if let Change::Down(why) = &change {
        windows::explain(app, why);
    }
    if now != before {
        tray::show(app, &now);
        os_mode::set(app, now.os_mode());
    }
}
