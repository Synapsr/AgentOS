//! The shell as a client of the core: the few routes of `@agentos/protocol`
//! it needs (`packages/protocol/src/api.ts`), and only the fields it reads.

use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tungstenite::client::IntoClientRequest;
use tungstenite::http::header::AUTHORIZATION;
use tungstenite::Message;

use crate::core_process::Config;
use crate::secret;

/// How long the core may take to answer a request. It is on this computer, and
/// this is also how long the shortcut that takes the screen back waits for it.
const TIMEOUT: Duration = Duration::from_secs(1);
/// Silence on the event stream after which we ask the core whether it is still there.
const QUIET: Duration = Duration::from_secs(3);
/// Silence after which the core is considered gone.
const GONE: Duration = Duration::from_secs(10);

/// `NodeMode`: who the screen belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Desktop,
    Os,
}

/// `NodeState`: what the agent is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Idle,
    Working,
    Waiting,
}

/// The part of `NodeStatus` the shell follows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub struct Status {
    pub state: State,
    pub mode: Mode,
}

/// The part of `NodeInfo` the shell shows.
#[derive(Clone, Debug, Deserialize)]
pub struct Node {
    pub agent: Agent,
    /// BCP-47 language the agent speaks with its owner.
    pub language: String,
}

/// The agent that lives on the computer.
#[derive(Clone, Debug, Deserialize)]
pub struct Agent {
    pub name: String,
}

/// Something the core said on its event stream.
#[derive(Debug)]
pub enum Update {
    Node(Node),
    Status(Status),
}

/// Why the event stream ended.
#[derive(Debug)]
pub enum Lost {
    /// The core closed the stream, or stopped answering.
    Gone,
    /// The stream could not be opened or broke.
    Broken(Box<tungstenite::Error>),
}

impl std::fmt::Display for Lost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Lost::Gone => write!(f, "the core stopped answering"),
            Lost::Broken(error) => write!(f, "{error}"),
        }
    }
}

impl From<tungstenite::Error> for Lost {
    fn from(error: tungstenite::Error) -> Self {
        Lost::Broken(Box::new(error))
    }
}

impl From<std::io::Error> for Lost {
    fn from(error: std::io::Error) -> Self {
        tungstenite::Error::Io(error).into()
    }
}

/// `ServerFrame`, reduced to what the shell follows.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Frame {
    Ready {
        node: Node,
        status: Status,
    },
    Event {
        event: Event,
    },
    #[serde(other)]
    Other,
}

/// `Event`, reduced to what the shell follows.
#[derive(Deserialize)]
#[serde(tag = "type")]
enum Event {
    #[serde(rename = "node.status")]
    Status { status: Status },
    #[serde(rename = "node.updated")]
    Node { node: Node },
    #[serde(other)]
    Other,
}

/// `HelloResponse`, as far as the shell reads it.
#[derive(Deserialize)]
struct Hello {
    app: String,
    /// See `proves`. Absent from a core that predates it.
    #[serde(default)]
    proof: Option<String>,
}

/// `GET /v1/hello`: whether something that says it is an AgentOS core answers
/// on the configured port. That is not yet a reason to trust it: see `proves`.
pub fn hello(config: &Config) -> bool {
    ask_hello(config, None).is_some()
}

/// `GET /v1/hello?challenge=…`: whether what answers on the port is a core
/// that holds `token`. It is sent a nonce and must answer
/// HMAC-SHA256(token, nonce). The token itself is only ever sent to a core
/// that has just passed this: any program can listen on a port and wait for
/// a token to be handed to it.
pub fn proves(config: &Config, token: &str) -> bool {
    let nonce = secret::random(24);
    ask_hello(config, Some(&nonce))
        .and_then(|hello| hello.proof)
        .is_some_and(|proof| is_proof(token, &nonce, &proof))
}

fn ask_hello(config: &Config, challenge: Option<&str>) -> Option<Hello> {
    let mut request = http().get(config.url("/v1/hello"));
    if let Some(nonce) = challenge {
        request = request.query("challenge", nonce);
    }
    request
        .call()
        .and_then(|mut response| response.body_mut().read_json::<Hello>())
        .ok()
        .filter(|hello| hello.app == "agentos")
}

/// Whether `proof` is HMAC-SHA256(token, nonce) in hex. Compared in constant time.
fn is_proof(token: &str, nonce: &str, proof: &str) -> bool {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(token.as_bytes()) else {
        return false;
    };
    mac.update(nonce.as_bytes());
    hex::decode(proof).is_ok_and(|proof| mac.verify_slice(&proof).is_ok())
}

/// `POST /v1/mode`: hands the screen to the agent (`Os`) or takes it back
/// (`Desktop`). Returns what the core says the status is now.
pub fn set_mode(config: &Config, token: &str, mode: Mode) -> Result<Status, ureq::Error> {
    #[derive(Serialize)]
    struct ModeRequest {
        mode: Mode,
    }
    #[derive(Deserialize)]
    struct NodeResponse {
        status: Status,
    }
    let mut response = http()
        .post(config.url("/v1/mode"))
        .header(AUTHORIZATION.as_str(), bearer(token))
        .send_json(ModeRequest { mode })?;
    Ok(response.body_mut().read_json::<NodeResponse>()?.status)
}

/// `WS /v1/events`: follows the core until the stream ends, which is how the
/// shell learns that the core died or hung. Blocks; `on_update` is called
/// with the node and its status once connected, then on every change.
pub fn follow(config: &Config, token: &str, mut on_update: impl FnMut(Update)) -> Lost {
    match listen(config, token, &mut on_update) {
        Ok(()) => Lost::Gone,
        Err(lost) => lost,
    }
}

fn listen(config: &Config, token: &str, on_update: &mut dyn FnMut(Update)) -> Result<(), Lost> {
    let mut request =
        format!("ws://{}:{}/v1/events", Ipv4Addr::LOCALHOST, config.port).into_client_request()?;
    let authorization = bearer(token)
        .parse()
        .map_err(tungstenite::http::Error::from)
        .map_err(tungstenite::Error::from)?;
    request.headers_mut().insert(AUTHORIZATION, authorization);

    let stream = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, config.port)),
        TIMEOUT,
    )?;
    // A read that times out is how we notice silence; see below.
    stream.set_read_timeout(Some(QUIET))?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    let (mut socket, _) = tungstenite::client(request, stream).map_err(|error| match error {
        tungstenite::HandshakeError::Failure(error) => Lost::from(error),
        tungstenite::HandshakeError::Interrupted(_) => Lost::Gone,
    })?;

    let mut heard = Instant::now();
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                heard = Instant::now();
                match serde_json::from_str(&text) {
                    Ok(Frame::Ready { node, status }) => {
                        on_update(Update::Node(node));
                        on_update(Update::Status(status));
                    }
                    Ok(Frame::Event {
                        event: Event::Status { status },
                    }) => on_update(Update::Status(status)),
                    Ok(Frame::Event {
                        event: Event::Node { node },
                    }) => on_update(Update::Node(node)),
                    // Everything else is the interface's business, and a newer core may say things we do not know.
                    Ok(_) | Err(_) => {}
                }
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => heard = Instant::now(),
            // Nothing for a while. A core that is alive answers a ping; one that hung does not.
            Err(tungstenite::Error::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                if heard.elapsed() > GONE {
                    return Err(Lost::Gone);
                }
                socket.send(Message::text(r#"{"type":"ping"}"#))?;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn http() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        // The core never redirects; a request that carries the token goes where it was sent or nowhere.
        .max_redirects(0)
        .build()
        .into()
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

/// A stand-in for the core, for tests: it answers `/v1/hello` and remembers
/// everything it was sent.
#[cfg(test)]
pub(crate) mod fake {
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpListener};
    use std::sync::{Arc, Mutex};
    use std::thread;

    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    pub struct FakeCore {
        pub port: u16,
        heard: Arc<Mutex<String>>,
    }

    impl FakeCore {
        /// Listens on a free port. With a token it proves that it holds it, as a
        /// core does; without one it is a stranger that only claims to be a core.
        pub fn listen(token: Option<&'static str>) -> Self {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let heard = Arc::new(Mutex::new(String::new()));
            let log = Arc::clone(&heard);
            thread::spawn(move || {
                for mut stream in listener.incoming().flatten() {
                    let mut buffer = [0; 4096];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
                    log.lock().unwrap().push_str(&request);
                    let nonce = request
                        .split_whitespace()
                        .nth(1)
                        .and_then(|path| path.split_once("challenge="))
                        .map(|(_, nonce)| nonce.to_owned());
                    let proof = match (token, nonce) {
                        (Some(token), Some(nonce)) => {
                            let mut mac = Hmac::<Sha256>::new_from_slice(token.as_bytes()).unwrap();
                            mac.update(nonce.as_bytes());
                            format!("\"{}\"", hex::encode(mac.finalize().into_bytes()))
                        }
                        _ => "null".to_owned(),
                    };
                    let body = format!(r#"{{"app":"agentos","proof":{proof}}}"#);
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                }
            });
            Self { port, heard }
        }

        /// Everything that was sent to it so far.
        pub fn heard(&self) -> String {
            self.heard.lock().unwrap().clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_ready_frame() {
        let text = r#"{"type":"ready","seq":3,"reset":false,"local":true,
            "node":{"id":"node_1","name":"Mac","agent":{"name":"Nova"},"language":"fr","onboarded":true},
            "status":{"state":"working","activity":"Running the tests","mode":"os","pendingRequests":0,"workingThreads":1}}"#;
        let Ok(Frame::Ready { node, status }) = serde_json::from_str(text) else {
            panic!("not a ready frame")
        };
        assert_eq!(node.agent.name, "Nova");
        assert_eq!(node.language, "fr");
        assert_eq!(
            status,
            Status {
                state: State::Working,
                mode: Mode::Os
            }
        );
    }

    #[test]
    fn follows_status_and_ignores_the_rest() {
        let status = r#"{"type":"event","event":{"type":"node.status","seq":4,"at":1,
            "status":{"state":"waiting","activity":null,"mode":"desktop","pendingRequests":1,"workingThreads":0}}}"#;
        assert!(matches!(
            serde_json::from_str(status),
            Ok(Frame::Event {
                event: Event::Status {
                    status: Status {
                        state: State::Waiting,
                        mode: Mode::Desktop
                    }
                }
            })
        ));
        let other = r#"{"type":"event","event":{"type":"message.delta","seq":0,"at":1,"threadId":"main","messageId":"m","text":"Hi"}}"#;
        assert!(matches!(
            serde_json::from_str(other),
            Ok(Frame::Event {
                event: Event::Other
            })
        ));
        assert!(matches!(
            serde_json::from_str(r#"{"type":"pong"}"#),
            Ok(Frame::Other)
        ));
    }

    #[test]
    fn accepts_only_the_proof_of_the_same_token() {
        // Computed with `openssl dgst -sha256 -hmac <token>` and with Node's `createHmac`.
        let (token, nonce) = ("dG9rZW4tZm9yLXRlc3RzLW9ubHk", "bm9uY2UtZm9yLXRlc3Rz");
        let proof = "ff984156bca0f3e7a998ad956cc81ba415f876d035de01ded6f9f9c5d4ebeb36";
        assert!(is_proof(token, nonce, proof));
        assert!(!is_proof("another-token", nonce, proof));
        assert!(!is_proof(token, "another-nonce", proof));
        assert!(!is_proof(token, nonce, &proof[..62]));
        assert!(!is_proof(token, nonce, "not hex at all"));
        assert!(!is_proof(token, nonce, ""));
    }

    #[test]
    fn reads_hello_with_and_without_a_proof() {
        let old = r#"{"app":"agentos","version":"0.1.0","protocol":1,"onboarded":true}"#;
        assert!(serde_json::from_str::<Hello>(old).unwrap().proof.is_none());
        let unproved = r#"{"app":"agentos","proof":null}"#;
        assert!(serde_json::from_str::<Hello>(unproved)
            .unwrap()
            .proof
            .is_none());
        let proved = r#"{"app":"agentos","proof":"ab12"}"#;
        assert_eq!(
            serde_json::from_str::<Hello>(proved)
                .unwrap()
                .proof
                .as_deref(),
            Some("ab12")
        );
    }

    #[test]
    fn writes_a_mode_as_the_protocol_spells_it() {
        assert_eq!(serde_json::to_string(&Mode::Os).unwrap(), r#""os""#);
        assert_eq!(
            serde_json::to_string(&Mode::Desktop).unwrap(),
            r#""desktop""#
        );
    }
}
