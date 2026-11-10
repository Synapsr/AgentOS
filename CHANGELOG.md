# Changelog

What changed in AgentOS, version by version. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org). Until 1.0, anything may
still change, the protocol included.

## [Unreleased]

A full design pass: every surface now follows one design system, written
down in [DESIGN.md](docs/DESIGN.md).

### Changed

- **One source for the design.** `packages/design/tokens.json` is the only
  place a colour, a size, a spring or a duration is written. `pnpm build`
  generates from it the CSS for the web, `Tokens.swift` for the iPhone and
  the watch, and the TypeScript tokens. The design package's tests fail when
  a generated file is out of date or a colour misses its contrast.
- **Figtree** is now the typeface of the interface, the desktop app's
  starting screen and the website, from one copy in `packages/design/fonts`
  that works offline. The iPhone and the watch keep the system font.
- **Warm themes**: a warm night in dark, warm daylight in light, both
  complete. The home, the side panel and the phone follow the system's
  appearance; OS mode and the watch stay dark.
- **The new presence**: a warm pearl that breathes at rest, lagoon blue at
  work, amber when it asks, a black pearl on light backgrounds. A change of
  state travels through light. The app icon, the menu-bar images and the
  link preview are drawn again from it.
- **The approval, redesigned.** Stop (a raised hand) comes first and Go
  ahead (a check) second; neither is painted red or green. The risk is said
  in words, an icon and colour ("Worth a careful look"). At high risk, Go
  ahead asks for Face ID on the iPhone and reads the question back on the
  watch, and on the computer it can be pressed after a second. The raw
  command waits behind "Details"; what the agent sees is shown everywhere,
  OS mode included. Every answer leaves a receipt: what you said, when, and
  on which device.
- **Settings in plain words**, with an Advanced page for addresses, the
  relay, the model and keys.
- **French says *vous* everywhere**, and Go ahead is « Allez-y ».
- **On the iPhone**, the microphone button is **Tap to talk** (tap to start,
  tap to send; holding it still works), and the hands-free mode once called
  Live is **Earbuds**.

### Added

- **A page for developers on the website**: building from source, how the
  parts fit together and running your own relay, apart from the story.
- **Push notifications carry the request's risk**, so that a high-risk
  request says "Worth a careful look" and puts Stop first even when the app
  is closed.
- **A demo on the iPhone and the watch**: debug builds take
  `-demo <scene>`, `-demo gallery` included, like the interface's `?demo`.
- New screenshots and a new OS-mode recording in `docs/screenshots`, all
  taken from the demos.
- **A notarized desktop app.** With a Developer ID, `pnpm desktop:bundle`
  signs the app and everything it carries, and `pnpm desktop:notarize` has
  Apple notarize the app and its disk image and staples both tickets.
  [CONTRIBUTING](CONTRIBUTING.md#releasing-the-desktop-app) has the steps.

## [0.1.0] - not released yet

The first public version. You build it from source; there are no downloads.
The README's [Status](README.md#status) says what has been tested, and how.

### Added

- **The core**: one small daemon that keeps the conversation, the agent's
  requests and the safety rules, in plain files under `~/.agentos`. No
  database. With it, the `agentos` command: `start`, `pair`, `status`, `say`
  and `url`.
- **One conversation, any number of jobs**: the agent starts background jobs
  for long work and reports when they finish.
- **Requests**: when the agent needs its owner, it asks with one sentence
  written to be spoken, a screenshot of what it sees when that helps, and
  two answers. Any device can answer, by tap or by voice.
- **Three levels of autonomy**: ask before every change, ask when it
  matters (the default), never stop to ask.
- **The brain**: Claude, through the Claude Agent SDK, behind an engine
  interface. A `mock` engine replays a script, so that everything can be
  tried and tested without a key.
- **Eyes and hands**: the computer's accessibility tree, the mouse and the
  keyboard, through agent-desktop.
- **Voice**: your phone's own speech by default, ElevenLabs with one key, or
  any speech server that speaks the OpenAI audio API.
- **The interface**, served by the core: setup, home, OS mode, the side
  panel, settings, and a web client for any browser. English and French.
- **The desktop app** for macOS (Tauri): it starts the core, lives in the
  menu bar, and hands the screen to the agent in OS mode. It can be built as
  a self-contained app.
- **The iPhone app**, with hold to talk, Live mode and notifications, and
  the start of an Apple Watch app.
- **Three ways to reach your computer**: the same network, Tailscale, or a
  relay you run yourself.
- **The presence**: three drops of light that show what the agent is doing,
  as a pure model, a canvas renderer and a SwiftUI port.
- **The protocol**: HTTP and one WebSocket, in JSON, defined in
  `packages/protocol` and published as a JSON Schema.
- **The design system** as code: tokens for the web and for native apps, and
  the brand.
- **The website**, in English and French.

### Security

What changed after the first independent security review:

- On the local network the computer answers over TLS, with a certificate of
  its own whose fingerprint travels in the pairing code and is pinned by the
  apps. Plain HTTP is answered only on the computer itself and over
  Tailscale. A new `host` setting (`--host`) chooses where it listens.
- The local token is accepted only from the computer itself, is new at every
  start and deleted at stop, and is never written to disk when the desktop
  app runs the core. The `agentos` command checks that the core is what
  answers before it sends the token.
- Words count as the answer to a request only when the client binds them to
  it, and only a plain yes or no decides.
- The relay does not start without a token, unless it is opened to everyone
  on purpose, and then it passes on the API only.
- The agent's tools refuse AgentOS's own app, data folder, address and
  command. A new `sandbox` setting runs its shell commands in Claude Code's
  sandbox, and a project folder's own Claude Code settings no longer apply
  unless the owner turns on `projectSettings`.
- Tools the owner connected to Claude Code ask before changing anything in
  the default setting.
- On iPhone, the app asks you to confirm a computer before adding it, and
  every action on a notification needs the phone unlocked.

[Unreleased]: https://github.com/Synapsr/AgentOS/commits/main
[0.1.0]: https://github.com/Synapsr/AgentOS
