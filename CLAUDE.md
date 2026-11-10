# AgentOS — working notes for coding agents

AgentOS gives an AI agent a computer and lets its owner talk to it from a
phone, watch or earbuds. Read `docs/ARCHITECTURE.md` (how it fits together)
and `docs/DESIGN.md` (how it looks and speaks) before changing anything.

## Rules

- **The protocol is the contract.** `packages/protocol/src` defines every
  shape on the wire. Do not invent fields or routes in a client or in the
  core: if something is missing, say so in your report (or change the
  protocol first, deliberately, and rebuild it).
- **Simple beats clever.** No new dependency, abstraction, config option or
  file unless the task needs it. No database. No framework on top of a
  framework. If a non-technical person would have to do an extra step, the
  design is wrong.
- **Stay in your package.** Packages only touch each other through their
  public exports.
- **User-facing text** is short, human, and goes through the translation
  table (English and French). Use the vocabulary in `docs/DESIGN.md`.
- **Code comments** explain why, in English. Public functions and types get
  a one-line doc comment.
- **Never read, store or forward Claude subscription credentials.** The
  Claude engine runs the unmodified Claude Code binary from the Agent SDK;
  the supported way to authenticate is an API key (or Bedrock / Vertex).
- Do not commit, push or publish. Do not write outside the repository
  except under a temporary `AGENTOS_HOME`.

## Commands

```sh
pnpm install            # once
pnpm build              # build every package (protocol first)
pnpm test               # all tests
pnpm typecheck
AGENTOS_HOME=/tmp/agentos-dev AGENTOS_ENGINE=mock node packages/core/dist/cli.js start
```

Use `AGENTOS_ENGINE=mock` for anything that does not specifically test the
Claude engine: it needs no credentials and costs nothing. Always use a
throwaway `AGENTOS_HOME` when testing — never the real `~/.agentos`.

## Layout

```
packages/protocol   wire protocol (zod) → schema/agentos.schema.json
packages/core       daemon + `agentos` CLI
packages/computer   screen / UI tree / input (agent-desktop backend)
packages/voice      speech providers
packages/ui         React UI served by the core
apps/desktop        Tauri shell
apps/ios            iPhone + Apple Watch (SwiftUI, XcodeGen)
```
