# Third-party notices

AgentOS is MIT-licensed (see [LICENSE](LICENSE)). That licence covers the
code in this repository. AgentOS builds on other people's work, which keeps
its own licences. This page names what matters; it is not legal advice.

## Not open source: the Claude Agent SDK and Claude Code

The Claude engine uses
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
which runs the Claude Code program that ships with it. Both are Anthropic's:

> © Anthropic PBC. All rights reserved. Use is subject to the Legal
> Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.

They are not part of this repository and not covered by its licence.
`pnpm install` downloads them from npm, and your use of them, and of
Anthropic's models, is governed by Anthropic's terms. AgentOS runs Claude
Code unmodified.

A self-contained app built with `pnpm desktop:bundle` carries the Claude
Code program inside it, exactly as Anthropic published and signed it. If you
mean to give such an app to other people, check first that Anthropic's terms
allow you to redistribute it.

## agent-desktop

The agent's eyes and hands are
[agent-desktop](https://github.com/vercel-labs/agent-desktop), by Vercel
Labs, under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
It is downloaded by `pnpm install`, and its programs are carried inside a
built desktop app.

## Figtree

The interface, the desktop app's starting screen, the wordmark and the
website are set in [Figtree](https://github.com/erikdkennedy/figtree), under
the SIL Open Font License 1.1:

> Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree)

A subset of the font is in this repository, at
`packages/design/fonts/figtree.woff2`, next to the full text of its licence
(`OFL.txt`). The interface the core serves, the desktop app and the website
each carry that file and load it from themselves, never from the internet.
In the logo the letters are drawn as outlines.

## Node.js

A built desktop app carries the official [Node.js](https://nodejs.org)
program for its platform, under the MIT licence and the licences of what
Node.js itself includes. The build puts that text in the app, at
`runtime/licenses/node-LICENSE`.

## Other dependencies

Everything else is downloaded when you install or build, and keeps its own
licence:

- **JavaScript.** At version 0.1.0 the packages AgentOS needs to run are
  under the MIT, ISC, BSD, Apache 2.0, 0BSD or Unlicense licences, the
  Claude Agent SDK above being the one exception. Among them:
  [Hono](https://hono.dev), [ws](https://github.com/websockets/ws),
  [zod](https://zod.dev), [React](https://react.dev),
  [Motion](https://motion.dev). `pnpm licenses list --prod` prints them all.
- **Rust.** The desktop shell is built with [Tauri](https://tauri.app) and
  its plugins (MIT or Apache 2.0). `apps/desktop/src-tauri/Cargo.lock` names
  every crate.
- **Building only.** [Vite](https://vite.dev), [Astro](https://astro.build),
  [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev)
  and [XcodeGen](https://github.com/yonaskolb/XcodeGen) build and test
  AgentOS and are not part of what runs.

## Ideas

The membranes that join the drops of the presence follow Hiroyuki Sato's
metaballs, a technique he published for Adobe Illustrator
(`packages/presence/src/model.ts`).

## Services

AgentOS can talk to services that are not software you install: Anthropic's
API (or Amazon Bedrock, or Google Vertex AI), ElevenLabs if you choose its
voice, Apple's push service if you set up notifications, and Tailscale if
you use it. Each has its own terms and its own privacy policy, and none of
them is run by this project.
