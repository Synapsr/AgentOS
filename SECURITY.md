# Security

AgentOS gives an AI agent your computer: your files, a shell, the screen,
the keyboard. That is the point of it, and it is also the risk. This page
says how to report a problem, who is trusted with what, what the safety
rules do and do not do, and where the limits are.

AgentOS is at version 0.1. It has had one independent security review, which
is not an audit. Treat it as early software.

## Reporting a problem

**Please do not open a public issue.** Report it privately, with GitHub's
private vulnerability reporting:
[Report a vulnerability](https://github.com/Synapsr/AgentOS/security/advisories/new)
(the **Security** tab of the repository).

It helps to say:

- the version, or the commit you built from, and your system;
- what someone could do, and what they need in order to do it;
- how to reproduce it, or a proof of concept;
- whether you have told anyone else.

Never put a real API key or token in a report. If a log helps, read it for
anything private before you send it.

AgentOS is maintained by a small team, so there are no promised deadlines.
We will do our best to acknowledge your report within a week, tell you
whether we can reproduce it, keep you posted while we fix it, and credit you
in the release notes if you would like that. Please give us a reasonable
time to ship a fix before you make the problem public.

Fixes go into the latest release only. Before the first release, they go
into the `main` branch.

## Who is trusted with what

The agent acts as you. It runs under your user account, with your rights,
and by default there is no sandbox around it. Giving AgentOS a computer
means trusting the following with that computer.

- **The agent itself, and the model behind it.** What you say, what the
  agent reads and the pictures of your screen go to the model provider you
  chose (Anthropic, or your cloud provider), under its terms. With no API key
  in Settings, the engine uses the Claude Code sign-in already on this
  computer, and the tools you connected to that account (mail, calendars,
  hosting…) come with it. The app tells you so.
- **Anything that runs as you on the computer.** Other programs under the
  same user account are inside the trust boundary. They can read the data
  folder: `secrets.json` (your API keys), the computer's TLS key, the
  conversations and the pictures. Apps on the computer talk to the core with
  a local token, which is new every time the core starts, is accepted only
  from the computer itself, and is deleted when the core stops. When the
  desktop app runs the core, the token is never written to disk. When you
  start the core by hand, it is a file in the data folder while the core
  runs, and any program running as you can read it.
- **Every device you add.** A phone joins by scanning a one-time code shown
  on the computer, and the app asks you to confirm the computer before it is
  added. The phone receives a token of its own. Whoever holds that phone, or
  that token, can talk to your agent, read the conversation, see your screen
  and answer the agent's questions. On iPhone, answering from a
  notification needs the phone unlocked. Remove a device in Settings and its
  token stops working.
- **A voice provider, if you choose one.** With ElevenLabs, what you say and
  what the agent answers go to ElevenLabs. With the default, audio stays on
  the phone.
- **Apple, if you set up notifications.** The sentence shown in a
  notification goes through Apple's push service.
- **Whoever operates your relay, if you use one.** See below.

## What protects it

- **On your network, connections are encrypted.** The computer has its own
  certificate. Its fingerprint travels in the code your phone scans, and the
  apps refuse any other certificate from then on. Plain HTTP remains only on
  the computer itself, and over Tailscale, which is already encrypted.
- **Every route needs a token**, except the one that says "an AgentOS
  computer is here" and the one that exchanges a pairing code. A pairing
  code works once, for five minutes, and attempts are limited. The computer
  keeps only a hash of each device's token.
- **Settings and keys stay on the computer.** The routes that read or change
  settings, add devices or remove them accept the local token only, and that
  token never works through a relay. API keys are kept in one file that only
  your user account can read, and the API never returns them.
- **The core only answers to names a web page cannot claim**: an IP address,
  `localhost`, the computer's own name, `.local` and `.ts.net` names. That
  stops a page in your browser from reaching it through a domain it controls.
- **An answer must be meant as one.** Words you type or say count as the
  answer to a question only when the app you used attached them to that
  question. For an approval, only an unmistakable yes approves and only an
  unmistakable no refuses. "ok" or "fine" decide nothing: the question stays
  open.
- **Tools you connected ask before they change anything.** In the default
  setting, a tool of a server you connected to Claude Code (mail, calendars,
  hosting…) reads freely and asks you before anything else.
- **A project folder does not configure the agent.** A folder's own Claude
  Code settings, which can hold hooks and servers that would run with your
  rights, are ignored unless you turn on `projectSettings`.
- **The agent is kept away from AgentOS itself**, because an agent that could
  read the local token or press its own *Go ahead* could approve its own
  requests.
  - Its screen tools refuse AgentOS's own app: they do not read its window,
    so they cannot click in it, and they do not type while it is in front.
  - Commands and file edits that name AgentOS's data folder, its address or
    its own command are refused, and the engine's file tools are denied the
    data folder.
  - Those checks recognise the plain ways of naming things, no more. In a
    test against a core started by hand, a command with a wildcard in the
    path read the token, and a port written as a sum reached the API. **With
    a core you started by hand, an agent that gets round the patterns can
    read the token and approve its own requests, unless the sandbox is on.**
  - What does close the door: the desktop app, which leaves no token on
    disk, or the sandbox, below.
  - None of this covers the same interface open in a browser tab, or a shell
    command that drives the screen with the system's own automation.
- **The log says what happened, never what was said**: no message, no
  command, no file name, no token.

## The sandbox, and what it costs

`sandbox` (`AGENTOS_SANDBOX=1`, off by default) runs the agent's shell
commands in Claude Code's sandbox.

- **What it closes:** commands can neither read nor write the data folder,
  so not the token, your keys or the TLS key, and cannot reach the
  computer's own ports, so not AgentOS's API.
- **What it costs:** commands cannot write outside the folder they work in,
  cannot reach any local port (a development server, a database, Docker),
  and cannot use Unix sockets (the ssh agent, `docker.sock`).

It is off by default because that cost breaks a lot of ordinary work.
Turn it on when the agent works on its own in a core you started by hand,
or with content you do not trust.

## What the safety rules are, and are not

One setting decides how much the agent may do without asking.

| Setting | What happens |
|---|---|
| `supervised` | The agent asks before running a command, changing a file or acting on the screen |
| `balanced` (default) | The agent works on its own, and is stopped before the actions the rules recognise as risky |
| `autonomous` | The rules never stop it |

**The rules are a list of recognised patterns. They are a speed bump, not a
guarantee.** In the default setting the agent is stopped before things like
deploying, publishing a package, a forced or recursive delete, `sudo`, a
force-push. The rules do not recognise every destructive command: a plain
`rm file`, a `mv` over something, a script that deletes, an upload with
`curl` all pass without a question.

Separately, the agent is instructed to ask before anything irreversible or
outward-facing: spending money, sending a message in your name, deleting
data, publishing, deploying. Whether it does is a matter of the model's
judgement, not something AgentOS enforces.

## Limits to know about

- **The agent can be manipulated by what it reads.** An agent with a shell
  and your files that reads hostile content, such as a web page, a file or
  an email, can be talked into doing something you did not ask for. The
  approval system reduces that risk. It does not remove it.
- **So start carefully.** Begin with the setting that asks before every
  change, on a machine and a user account you are comfortable giving away.
  Move to the default once you have seen how it behaves.
- **A relay's operator sees everything.** The encrypted connection ends at
  the relay, so whoever runs it can read all that passes through, including
  the tokens that would let them act as your phone. Run your own relay, and
  keep it private. A relay asks for a token by default; one that was opened
  to everyone forwards the API only and does not serve the web app.
  End-to-end encryption between phone and computer is planned, not built.
- **Nothing is encrypted on disk.** Conversations, pictures, your API keys
  and the TLS key are plain files in the data folder, open to you and to
  every program that runs as you, and to nobody else.
- **Pictures of your screen travel.** The agent can look at your screen, and
  what it sees goes to the model. The picture attached to a request is
  stored on the computer and shown on your devices, through the relay if you
  use one.
- **Builds.** The Mac app on GitHub Releases is signed with the Synapsr
  Developer ID and notarized by Apple; check its SHA-256 against the
  `.sha256` file next to it. An app you build yourself is signed ad hoc and
  not notarized.
- **Early software.** Version 0.1, one independent review, no audit. Parts
  of it have not yet run on real hardware: the README's
  [Status](README.md#status) lists them.

## Out of scope

Please report these to the right place instead:

- Anthropic's services and the Claude Code program, agent-desktop,
  Tailscale, ElevenLabs and other dependencies: report to their maintainers,
  and tell us too if AgentOS is affected.
- What an agent does in the `autonomous` setting, which exists to remove the
  questions.
- Attacks that need a computer or a user account that is already
  compromised, or a device its owner added on purpose.
- The `mock` engine, which is for trying and testing.
