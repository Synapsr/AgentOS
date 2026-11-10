# Documentation

Start with the [README](../README.md): what AgentOS is, and how to run it in
five minutes. This folder goes further.

## Using it

| Page | Read it when |
|---|---|
| [Getting started](getting-started.md) | You want every step from an empty folder to an agent that answers, and what to do when one fails |
| [Reach your computer from anywhere](connecting.md) | Your phone leaves the house: same network, Tailscale, or your own relay |
| [Voice](voice.md) | You want to talk to it: your phone's own voice, ElevenLabs, or your own speech server |
| [The iPhone and Apple Watch apps](ios.md) | You want to build the apps, run them in the simulator or on your phone, and set up notifications |

## Understanding it

| Page | What it is |
|---|---|
| [Architecture](ARCHITECTURE.md) | How the parts fit together, the three replaceable parts, what is on disk, every setting |
| [The protocol at a glance](protocol.md) | The routes, the events and the pairing flow, with commands to try. A map to `packages/protocol` |
| [Design](DESIGN.md) | The whole design system: principles, colour, type, motion, components, words |
| [The presence](PRESENCE.md) | The agent's presence, specified to the formula, so that it can be ported to anything that fills a path |
| [The relay](../packages/relay/README.md) | What the relay is, what it sees, its settings |

## Working on it

| Page | What it is |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Setting up, the rules of the repository, how to run and test each part, commits and pull requests |
| [Security](../SECURITY.md) | How to report a problem, who is trusted with what, and the limits to know about |
| [Changelog](../CHANGELOG.md) | What changed, version by version |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | What AgentOS builds on, and under which licences |
| [`CLAUDE.md`](../CLAUDE.md) | The same rules as Contributing, written for coding agents |

## Pictures

- [`presence/`](presence): the presence in motion (`presence.gif`,
  `presence.mp4`), every state, every size, the changes of state, and the
  directions that were not kept.
- [`screenshots/`](screenshots): the desktop app (setup, home, OS mode and
  its recording, `os-mode.mp4`), the side panel, settings and the web client
  on a phone, in dark and light, taken from the interface's own demo data
  (`?demo`), so nothing in them is anybody's real computer.
  [`screenshots/ios/`](screenshots/ios) and
  [`screenshots/watch/`](screenshots/watch): the iPhone and Apple Watch
  apps in the simulator, from their debug-only `-demo` scenes
  ([how](ios.md#try-it-without-a-computer)).
