# Getting started

From an empty folder to an agent that answers, in about five minutes, built
from source. The Mac app will also come ready to install, as a `.dmg` on
[GitHub Releases](https://github.com/Synapsr/AgentOS/releases/latest), once
the first version is published; until then that page is empty, and this
guide is the way in.

Every command on this page was run from a fresh copy of the repository on a
Mac with Apple Silicon, unless it says otherwise.

## What you need

| For | You need |
|---|---|
| The core, the web client, the relay | [Node.js](https://nodejs.org) 20.19 or later, and [pnpm](https://pnpm.io) 10 |
| The desktop app | The above, [Rust](https://rustup.rs) 1.90 or later, and macOS |
| The iPhone and Apple Watch apps | A Mac, Xcode 26 or later, and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) |

The repository pins its pnpm version in `package.json`. With Node's Corepack
(`corepack enable`) you get exactly that one.

AgentOS is built and tested on macOS with Apple Silicon. Windows and Linux
are designed for, not built or tested yet: see [Status](../README.md#status).

## 1. Build it

```sh
git clone https://github.com/Synapsr/AgentOS.git
cd AgentOS
pnpm install
pnpm build
```

`pnpm build` builds the eight packages in order, the protocol first. On a
recent Mac, with packages already downloaded once, the install takes a few
seconds and the build about ten.

On the very first install pnpm may print `Failed to create bin …
agentos-relay`. It is harmless: that file exists once the build has run.

## 2. Wake the agent, without any key

```sh
AGENTOS_ENGINE=mock pnpm start
```

The `mock` engine is a practice brain: a script instead of a model. It needs
no key and costs nothing, and everything else is real: the conversation, the
requests, the files on disk, the phone.

```
  ● Nova is awake on Studio Mac

  On this computer         http://localhost:4747
  From your other devices  https://192.168.1.24:4747

  Finish setting up in your browser:
  http://localhost:4747/#token=…

  Add your phone with: agentos pair
  Press Ctrl+C to stop.
```

The address with the token is only printed on a terminal, never to a file
or a log. From a clone, the `agentos` command it names is `pnpm agentos`
(see below).

Open the address in your browser. The agent says hello, then asks your name,
a name for itself, how much it should ask before acting, and for its brain
(with the practice brain there is nothing to add). It then offers the
permissions the computer needs and a code for your phone; both can wait
(**Later**). Then you are home: the presence, the conversation, one input.

The practice brain reacts to a word in what you say, in English or French:

| Say something with | What happens |
|---|---|
| `deploy` | It works, then asks "Everything looks good. Deploy to production?", with a picture of the screen when it can take one |
| `delete` | It wants to run `rm -rf ./build`. The safety rules stop it and ask you, exactly as for a real risky action. Nothing is deleted |
| `quit` | It asks to quit an app with the computer's own tools. It only pretends to act |
| `job` | It starts a background job that reports a few seconds later |
| `error` | It fails, so that you can see what that looks like |
| anything else | A short answer |

`deploy` takes a picture of the screen, so macOS may ask you to let your
terminal record it. The question is asked either way.

### From a terminal

The `agentos` command talks to the agent once it is awake. From a clone it is
`pnpm agentos`. It talks to a core you started yourself, as above, not to
one the desktop app is running: that one is used from the app.

```sh
pnpm agentos say "delete the old build"
```

```
Nova is asking: Nova wants to delete files
rm -rf ./build
[Go ahead] [Stop]
Answer with: pnpm agentos say "<your answer>"
```

```sh
pnpm agentos say "stop"      # Okay, I left it alone.
pnpm agentos status          # what the agent is doing, and how many devices it knows
pnpm agentos url             # the address of the app on this computer, with its token
pnpm agentos pair            # a QR code for your phone
```

While the agent is asking one thing, what you `say` is your reply to it. Only
a plain yes or a plain no decides: anything else leaves it waiting.

### Keeping the practice run apart

Everything the agent knows lives in `~/.agentos`, as plain files. To try
things without touching that folder, give the core another one, and the
same one to every command:

```sh
export AGENTOS_HOME=/tmp/agentos-try
AGENTOS_ENGINE=mock pnpm start
```

`AGENTOS_PORT=4848` moves it to another port in the same way.

## 3. Give it a real brain

The agent thinks with Claude, through the Claude Agent SDK. Create an API
key in the [Claude Console](https://console.anthropic.com), then either paste
it in the app (the fourth question of the setup, or Settings → Brain) or
start the core with it:

```sh
ANTHROPIC_API_KEY=sk-ant-… pnpm start
```

A key pasted in the app is stored in `~/.agentos/secrets.json`, which only
your user account can read, and is never returned by the API. A key given in
the environment is never written to disk.

Without a key, on a computer where you have already signed in to Claude Code
yourself, the agent uses that sign-in, and the tools you connected to it
(mail, calendars, hosting…) come with it. The setup tells you when that is
the case. In the default setting those tools read freely and ask you before
changing anything.

More on what the engine accepts, including Amazon Bedrock and Google Vertex
AI, in [the README](../README.md#the-brain-and-how-it-signs-in).

*This step was verified by the people who built the engine, with a real key.
It was not run again for this guide.*

### Before you give it real work

Read [SECURITY.md](../SECURITY.md) once. In short: start with **Ask before
every change**, on a machine and a user account you are comfortable giving
away. The safety rules are a list of recognised patterns, not a guarantee.
With a core you started by hand, `AGENTOS_SANDBOX=1` keeps the agent's shell
commands away from AgentOS's own data, at a real cost to ordinary work.

## 4. Let it use the computer

The fifth question of the setup asks for two permissions, one button each:

- **See the screen** (Screen Recording), for the pictures attached to
  requests and for apps that cannot be read any other way.
- **Use the keyboard and mouse** (Accessibility), to read what is on screen
  and act on it.

macOS grants these to the app that started the core. From a terminal, that
is your terminal; from the desktop app, it is AgentOS itself.

## 5. Add your phone

In the app, choose **Add your phone**, or in a terminal:

```sh
pnpm agentos pair
```

Both show a QR code that works once, for five minutes.

- With the iPhone app, scan it. The app is built from source for now: see
  [The iPhone and Apple Watch apps](ios.md).
- Without the app, choose **No app on your phone?** under the code. It shows
  a second code that opens the web client in your phone's browser, already
  added. A browser cannot check your computer's own certificate, so this way
  needs Tailscale or a relay; on the same Wi‑Fi, use the app.

With the app, at home, this works by itself. To reach your computer from
anywhere, see [Reach your computer from anywhere](connecting.md).

## 6. The desktop app

```sh
pnpm build        # the app shows the interface the core serves
pnpm desktop      # tauri dev: compiles the shell, then opens the app
```

The first run compiles the Rust shell, which takes a few minutes. The app
starts the core itself, or joins one that is already running, and adds the
menu-bar item, the side panel (Control + Command + P) and OS mode: the screen
goes dark and only the agent is left, its presence and one line about what it
is doing. Command + Shift + Escape, or "Take back control", gives the screen
back.

To build a self-contained `AgentOS.app` that carries its own Node.js and the
core:

```sh
pnpm desktop:bundle
```

It downloads Node.js once, checks it against a pinned checksum, and writes
the app and a disk image to `apps/desktop/src-tauri/target/release/bundle/`
(about 460 MB and 185 MB). Built this way, the app is signed ad hoc and not
notarized, so macOS asks you to confirm before opening it on another Mac. To
sign it with a Developer ID and have Apple notarize it, see
[Releasing the desktop app](../CONTRIBUTING.md#releasing-the-desktop-app).

*`pnpm desktop` and `pnpm desktop:bundle` open windows, so they were not run
for this guide. The shell's own checks were: `cargo fmt --check`,
`cargo clippy` and `cargo test` pass from a fresh copy.*

## When something goes wrong

| You see | Try |
|---|---|
| `Port 4747 is already taken` | AgentOS is probably already running. `pnpm agentos status`, or start on another port with `AGENTOS_PORT` |
| `AgentOS isn't running on this computer` | Start it first, and give the command the same `AGENTOS_HOME` and `AGENTOS_PORT` as the core |
| `AgentOS is running inside the app` | The `agentos` command only talks to a core started with `pnpm start`. Use the app, or quit it and start the core yourself |
| "The app isn't here yet" in the browser | Run `pnpm build`: the interface is one of the packages |
| "Nova can't think yet" | No key yet. Add one in Settings, or try the `mock` engine |
| The phone cannot find the computer | Same Wi‑Fi? If the macOS firewall is on, did it ask whether `node` may accept incoming connections? See [connecting](connecting.md) |
| Anything else | `pnpm agentos status` prints where the log is. It says what happened, never what was said |

## Next

- [Reach your computer from anywhere](connecting.md)
- [Voice](voice.md)
- [The iPhone and Apple Watch apps](ios.md)
- [The protocol at a glance](protocol.md), to write a client of your own
- [Contributing](../CONTRIBUTING.md)
