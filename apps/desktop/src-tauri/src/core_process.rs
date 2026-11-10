//! The core's lifecycle. The core is the AgentOS daemon: the agent, its
//! state and the interface all live there. The shell joins one that is
//! already running, or starts one and stops it when the app quits.
//!
//! The local token is what makes a caller "this computer" to the core: with
//! it one can answer the agent's requests and add devices. A core the shell
//! starts gets a token the shell has just made, on its standard input: it is
//! never written to a file, an environment or a command line, where the
//! agent or any other program of the same user could read it. A core someone
//! started by hand keeps its token in its data directory; the shell reads it
//! from there, and in both cases sends it only to a core that has proved it
//! holds the same one (`client::proves`).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use std::{env, fmt, fs, io, thread};

use crate::{client, secret};

/// The port the core listens on unless told otherwise (`DEFAULT_PORT` in the protocol).
const DEFAULT_PORT: u16 = 4747;
/// How long a core we started may take to answer.
const START_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a core we stop may take to put its files at rest.
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const POLL: Duration = Duration::from_millis(100);
/// Size of the local token the shell makes, before it is written as text.
const TOKEN_BYTES: usize = 32;

/// Where the core is: its data directory, its port, and what runs it.
#[derive(Clone, Debug)]
pub struct Config {
    /// `AGENTOS_HOME`, else `~/.agentos`.
    pub home: PathBuf,
    /// `AGENTOS_PORT`, else the port in `config.json`, else 4747.
    pub port: u16,
    /// What runs the core. See `command`.
    runtime: Runtime,
}

/// What runs the core.
#[derive(Clone, Debug)]
enum Runtime {
    /// A built app: the folder it carries in its resources, with its own
    /// Node.js, the core and the interface. Never anything outside the app.
    Bundled(PathBuf),
    /// `tauri dev`: the repository's build of the core, and the Node.js
    /// installed on this computer.
    Development,
}

impl Config {
    /// Reads the configuration the way the core does (`packages/core/src/config.ts`).
    /// `resources` is the app's resource folder, where a built app keeps its runtime.
    pub fn load(resources: Option<&Path>) -> Self {
        let home = env::var_os("AGENTOS_HOME")
            .filter(|home| !home.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| env::home_dir().unwrap_or_default().join(".agentos"));
        let port = env::var("AGENTOS_PORT")
            .ok()
            .and_then(|port| port.parse().ok())
            .or_else(|| configured_port(&home))
            .unwrap_or(DEFAULT_PORT);
        // Decided by how the app was built, not by what happens to be on disk: a
        // built app that reached into a developer's folders would work on one
        // computer only, and make macOS ask its owner why.
        let runtime = if cfg!(dev) {
            Runtime::Development
        } else {
            Runtime::Bundled(resources.unwrap_or(Path::new("")).join("runtime"))
        };
        Self {
            home,
            port,
            runtime,
        }
    }

    /// The address of a path on the core, for this computer.
    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// The local token of a core started by hand, as its data directory has it
    /// now: such a core makes a new one every time it starts.
    fn token(&self) -> io::Result<String> {
        let token = fs::read_to_string(self.home.join("local-token"))?
            .trim()
            .to_owned();
        if token.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "the local token is empty",
            ));
        }
        Ok(token)
    }
}

/// The port saved in the data directory, if any.
fn configured_port(home: &Path) -> Option<u16> {
    port_in(&fs::read(home.join("config.json")).ok()?)
}

/// The port in the text of a `config.json`.
fn port_in(config: &[u8]) -> Option<u16> {
    let config: serde_json::Value = serde_json::from_slice(config).ok()?;
    u16::try_from(config.get("port")?.as_u64()?)
        .ok()
        .filter(|port| *port != 0)
}

/// Why there is no core to talk to.
#[derive(Debug)]
pub enum StartError {
    /// The core's command could not be run at all: the program, and why.
    Spawn(PathBuf, io::Error),
    /// The core stopped before it answered.
    Exited(ExitStatus),
    /// The core runs but does not answer.
    Silent,
    /// A core answers, but its local token cannot be read.
    Token(io::Error),
    /// Something answers on the port, but it does not hold the local token.
    Stranger,
    /// The app is quitting.
    Quitting,
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StartError::Spawn(program, error) => {
                write!(f, "{} could not be started: {error}", program.display())
            }
            StartError::Exited(status) => write!(f, "the core stopped as it started ({status})"),
            StartError::Silent => write!(f, "the core started but does not answer"),
            StartError::Token(error) => write!(
                f,
                "an AgentOS core answers on this port, but its local token is not in this data folder: {error}"
            ),
            StartError::Stranger => write!(
                f,
                "what answers on this port did not prove that it holds this data folder's local token"
            ),
            StartError::Quitting => write!(f, "the app is quitting"),
        }
    }
}

/// The core process, when this shell started it. A core that was already
/// running is joined, never owned: it is left alone when the app quits.
#[derive(Default)]
pub struct CoreProcess(Mutex<Owned>);

#[derive(Default)]
struct Owned {
    core: Option<Started>,
    /// The app is quitting: nothing may be started any more.
    closed: bool,
}

/// A core this shell started.
struct Started {
    child: Child,
    /// The local token made for it. It lives here, in memory, and nowhere else.
    token: String,
}

impl CoreProcess {
    /// Makes sure a core answers, starting one if none does, and returns its
    /// local token — once that core has proved it holds it.
    pub fn ensure(&self, config: &Config) -> Result<String, StartError> {
        let ours = self.owned().core.as_ref().map(|core| core.token.clone());
        if let Some(token) = ours {
            if client::proves(config, &token) {
                return Ok(token);
            }
            // The core we started no longer proves itself: it died or hung. A new
            // one replaces it (if something else holds the port, it says so).
            return self.start(config);
        }
        if !client::hello(config) {
            return self.start(config);
        }
        // A core started by hand.
        let token = config.token().map_err(StartError::Token)?;
        if client::proves(config, &token) {
            Ok(token)
        } else {
            Err(StartError::Stranger)
        }
    }

    /// Stops the core if this shell started it. Nothing is started after this.
    pub fn stop(&self) {
        let mut owned = self.owned();
        owned.closed = true;
        if let Some(core) = owned.core.take() {
            terminate(core.child);
        }
    }

    /// Whether `stop` was called: the app is quitting.
    pub fn stopped(&self) -> bool {
        self.owned().closed
    }

    /// Starts a core with a token of its own and waits until it answers with it.
    fn start(&self, config: &Config) -> Result<String, StartError> {
        let token = secret::random(TOKEN_BYTES);
        {
            let mut owned = self.owned();
            if owned.closed {
                return Err(StartError::Quitting);
            }
            // Nobody answers: a core we started earlier is dead or stuck.
            if let Some(core) = owned.core.take() {
                terminate(core.child);
            }
            let mut command = command(config);
            let spawned = command.spawn();
            let mut child =
                spawned.map_err(|error| StartError::Spawn(command.get_program().into(), error))?;
            // One line, then the end of the input: that is the whole exchange.
            if let Some(mut input) = child.stdin.take() {
                let _ = writeln!(input, "{token}");
            }
            if let Some(output) = child.stdout.take() {
                thread::spawn(move || relay(output));
            }
            owned.core = Some(Started {
                child,
                token: token.clone(),
            });
        }
        let deadline = Instant::now() + START_TIMEOUT;
        // Not just any answer: something else may be listening on the port.
        while !client::proves(config, &token) {
            let mut owned = self.owned();
            match owned.core.as_mut().map(|core| core.child.try_wait()) {
                None => return Err(StartError::Quitting),
                Some(Ok(Some(status))) => {
                    owned.core = None;
                    return Err(StartError::Exited(status));
                }
                Some(_) if Instant::now() > deadline => return Err(StartError::Silent),
                Some(_) => {}
            }
            drop(owned);
            thread::sleep(POLL);
        }
        Ok(token)
    }

    fn owned(&self) -> MutexGuard<'_, Owned> {
        // The state is a handle and a flag: still sound after a panic elsewhere.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The command that starts a core for `config`.
///
/// A built app carries everything it needs in `<resources>/runtime`, put
/// together by `scripts/assemble-runtime.mjs`: its own Node.js (`node`), the
/// core with its dependencies (`core`) and the interface (`ui`). In
/// development the repository's build of the core is run by the Node.js
/// installed on this computer. Nothing else in the shell knows the difference.
fn command(config: &Config) -> Command {
    let mut command = match &config.runtime {
        Runtime::Bundled(runtime) => {
            let node = if cfg!(windows) { "node.exe" } else { "node" };
            let mut command = Command::new(runtime.join(node));
            command
                .arg(runtime.join("core/dist/cli.js"))
                .env("AGENTOS_UI_DIR", runtime.join("ui"))
                // The agent's eyes and hands run from inside the app, which the agent
                // cannot write to, not from a copy in the data directory.
                .env("AGENTOS_AGENT_DESKTOP_BIN", runtime.join("agent-desktop"));
            command
        }
        Runtime::Development => {
            let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
            let mut command = Command::new(node());
            command.arg(repository.join("packages/core/dist/cli.js"));
            command
        }
    };
    command
        .args(["start", "--port", &config.port.to_string()])
        .env("AGENTOS_HOME", &config.home)
        // The core watches for us and stops once we are gone, however we went.
        .env("AGENTOS_PARENT_PID", std::process::id().to_string())
        // The local token comes on its standard input (see `start`): the core
        // then keeps it in memory too, and writes no `local-token` file.
        .env("AGENTOS_LOCAL_TOKEN_STDIN", "1")
        .stdin(Stdio::piped())
        // Never our terminal, if we have one: a core that sees a terminal prints the
        // address that carries the token, for the person it believes is sitting there.
        .stdout(Stdio::piped());
    command
}

/// Passes on what the core prints, until it stops. Reading goes on even when
/// nobody takes our own output: a core that could no longer print would stop.
fn relay(mut output: impl Read) {
    let mut buffer = [0; 4096];
    while let Ok(read @ 1..) = output.read(&mut buffer) {
        let _ = io::stdout().write_all(&buffer[..read]);
    }
}

/// Node.js in development, as the owner's terminal finds it: an app opened from
/// the Finder does not inherit the shell's `PATH`, where version managers put `node`.
fn node() -> PathBuf {
    let on_path = env::var_os("PATH")
        .is_some_and(|path| env::split_paths(&path).any(|dir| dir.join("node").is_file()));
    let found = if on_path {
        None
    } else {
        node_from_login_shell()
    };
    found.unwrap_or_else(|| "node".into())
}

#[cfg(unix)]
fn node_from_login_shell() -> Option<PathBuf> {
    let shell = env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
    let found = Command::new(shell)
        .args(["-ilc", "command -v node"])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    // A shell's startup files may print before the answer: the answer is the last line.
    let path = String::from_utf8(found.stdout)
        .ok()?
        .lines()
        .last()?
        .trim()
        .to_owned();
    path.starts_with('/').then(|| path.into())
}

#[cfg(not(unix))]
fn node_from_login_shell() -> Option<PathBuf> {
    None
}

/// Asks a core to stop the way Ctrl+C does, so that it closes its files, and insists if it does not.
fn terminate(mut child: Child) {
    // Already gone: there is nobody to ask, and its process id may belong to someone else by now.
    if !matches!(child.try_wait(), Ok(None)) {
        return;
    }
    #[cfg(unix)]
    if let Ok(pid) = libc::pid_t::try_from(child.id()) {
        // SAFETY: the child is still ours to wait for, so its id cannot have been given to another process.
        unsafe { libc::kill(pid, libc::SIGTERM) };
        let deadline = Instant::now() + STOP_TIMEOUT;
        while Instant::now() < deadline {
            if !matches!(child.try_wait(), Ok(None)) {
                return;
            }
            thread::sleep(POLL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_built_app_runs_only_what_it_carries() {
        let runtime = Path::new("/Applications/AgentOS.app/Contents/Resources/runtime");
        let config = Config {
            home: "/Users/someone/.agentos".into(),
            port: 4811,
            runtime: Runtime::Bundled(runtime.into()),
        };
        let command = command(&config);
        assert_eq!(command.get_program(), runtime.join("node"));
        let args: Vec<_> = command.get_args().collect();
        let cli = runtime.join("core/dist/cli.js");
        assert_eq!(
            args,
            [
                cli.as_os_str(),
                "start".as_ref(),
                "--port".as_ref(),
                "4811".as_ref()
            ]
        );
        let set = |name: &str| {
            command
                .get_envs()
                .find(|(key, _)| *key == name)
                .and_then(|(_, value)| value)
                .map(|value| value.to_owned())
        };
        assert_eq!(set("AGENTOS_UI_DIR"), Some(runtime.join("ui").into()));
        assert_eq!(
            set("AGENTOS_AGENT_DESKTOP_BIN"),
            Some(runtime.join("agent-desktop").into())
        );
        assert_eq!(set("AGENTOS_LOCAL_TOKEN_STDIN"), Some("1".into()));
        assert_eq!(set("AGENTOS_HOME"), Some("/Users/someone/.agentos".into()));
        assert_eq!(
            set("AGENTOS_PARENT_PID"),
            Some(std::process::id().to_string().into())
        );
    }

    /// A data directory holding `token`, as a core started by hand leaves it.
    fn home_with(token: &str, name: &str) -> PathBuf {
        let home = env::temp_dir().join(format!("agentos-desktop-{name}-{}", std::process::id()));
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("local-token"), format!("{token}\n")).unwrap();
        home
    }

    fn joining(port: u16, home: PathBuf) -> Config {
        Config {
            home,
            port,
            runtime: Runtime::Development,
        }
    }

    #[test]
    fn joins_a_core_that_proves_it_holds_the_token() {
        let core = client::fake::FakeCore::listen(Some("the-token-of-this-home"));
        let config = joining(core.port, home_with("the-token-of-this-home", "joins"));
        let token = CoreProcess::default().ensure(&config);
        assert_eq!(token.ok().as_deref(), Some("the-token-of-this-home"));
        // Proving is done with the nonce alone: the token itself was not part of it.
        assert!(!core.heard().contains("the-token-of-this-home"));
        fs::remove_dir_all(&config.home).unwrap();
    }

    #[test]
    fn never_sends_the_token_to_what_cannot_prove_itself() {
        // Something that only claims to be a core, and a core of another data folder.
        for (name, stranger) in [
            ("stranger", None),
            ("other-core", Some("the-token-of-another-home")),
        ] {
            let listening = client::fake::FakeCore::listen(stranger);
            let config = joining(listening.port, home_with("the-token-of-this-home", name));
            let answer = CoreProcess::default().ensure(&config);
            assert!(
                matches!(answer, Err(StartError::Stranger)),
                "{name}: {answer:?}"
            );
            assert!(
                !listening.heard().contains("the-token-of-this-home"),
                "{name} was sent the token"
            );
            fs::remove_dir_all(&config.home).unwrap();
        }
    }

    /// The whole exchange with the real core of this repository: needs Node.js and
    /// `pnpm build`. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore = "starts the repository's core"]
    fn starts_a_core_with_a_token_that_is_never_written() {
        // The practice engine: no credentials, nothing spent.
        env::set_var("AGENTOS_ENGINE", "mock");
        let free = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = free.local_addr().unwrap().port();
        drop(free);
        let home = env::temp_dir().join(format!("agentos-desktop-starts-{}", std::process::id()));
        let config = joining(port, home.clone());
        let process = CoreProcess::default();

        let token = process.ensure(&config).expect("the core starts");
        assert!(
            !home.join("local-token").exists(),
            "the token was written to the data directory"
        );
        assert!(client::proves(&config, &token));
        assert!(!client::proves(&config, "not-the-token"));
        // The token it was given is the one it accepts.
        let status = client::set_mode(&config, &token, client::Mode::Desktop)
            .expect("the token is accepted");
        assert_eq!(status.mode, client::Mode::Desktop);
        assert!(client::set_mode(&config, "not-the-token", client::Mode::Desktop).is_err());
        // Asked again, the shell recognises its own core instead of starting another.
        assert_eq!(process.ensure(&config).ok(), Some(token));

        process.stop();
        assert!(
            !client::hello(&config),
            "the core is still answering after being stopped"
        );
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn reads_the_port_saved_by_the_core() {
        assert_eq!(port_in(br#"{"agentName":"Nova","port":4811}"#), Some(4811));
        assert_eq!(port_in(br#"{"agentName":"Nova"}"#), None);
        assert_eq!(port_in(br#"{"port":70000}"#), None);
        assert_eq!(port_in(br#"{"port":"4811"}"#), None);
        assert_eq!(port_in(b"not json"), None);
    }
}
