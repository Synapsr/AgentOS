# Contributing

Thank you for wanting to help. Bug reports, ideas, translations, fixes and
features are all welcome.

AgentOS aims to stay small and obvious. The bar, from
[the design page](docs/DESIGN.md): a grandparent can install it, and a
developer wants to show it to a friend. Before adding a setting, ask
whether a better default would do.

## Set up

You need [Node.js](https://nodejs.org) 20.19 or later and
[pnpm](https://pnpm.io) 10, on a Mac. The desktop app also needs
[Rust](https://rustup.rs) 1.90 or later; the iPhone app, Xcode 26 or later
and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
git clone https://github.com/Synapsr/AgentOS.git
cd AgentOS
pnpm install
pnpm check      # build, typecheck and test every package: what CI runs
```

Build before you typecheck or test: packages see each other through their
built output, and the protocol is built first.

## The rules of the repository

There are few, and they matter.

**The protocol is the contract.** [`packages/protocol/src`](packages/protocol/src)
defines every shape on the wire. Do not invent a field or a route in a
client or in the core. If something is missing, change the protocol first,
on purpose, run `pnpm build`, then update the core and each client,
including the Swift mirror in `apps/ios/AgentOS/Protocol`.
[The protocol at a glance](docs/protocol.md) is the map.

**Simple beats clever.** No new dependency, abstraction, setting or file
unless the change needs it. No database. No framework on top of a framework.
If someone who is not technical would have to do one more step, the design
is wrong.

**Stay in your package.** Packages only touch each other through what they
export.

**Words are part of the product.** Everything a person reads is short and
human, exists in English and in French, and goes through a translation
table. Use the vocabulary of [docs/DESIGN.md](docs/DESIGN.md#words): "your
computer", not "node"; "Nova is asking", not "permission request"; "Go
ahead" and "Stop".

**Looks are tokens.** Never write a colour, a radius or a duration that is
not a token. To change one, edit `packages/design/src/tokens.ts` and build.

**Comments say why**, in English. Public functions and types get a one-line
doc comment.

**Never touch Claude sign-in credentials.** The Claude engine runs the
unmodified Claude Code program from the Agent SDK. AgentOS must never read,
store or forward what that program uses to sign in, and must not offer a
claude.ai login. The supported way to authenticate is an API key, or
Bedrock or Vertex.

**Test with the mock engine, in a throwaway folder.** Use
`AGENTOS_ENGINE=mock` for anything that is not specifically about the Claude
engine: it needs no key and costs nothing. Always give the core a throwaway
`AGENTOS_HOME`, never your real `~/.agentos`:

```sh
AGENTOS_HOME=/tmp/agentos-dev AGENTOS_PORT=4848 AGENTOS_ENGINE=mock pnpm start
```

## Running each part

| Part | Command | Notes |
|---|---|---|
| The core, as built | `pnpm start` | Runs `agentos start`. Other commands: `pnpm agentos status`, `say`, `pair`, `url` |
| The core, from source | `pnpm dev` | Restarts when a file of the core changes |
| The interface | `pnpm --filter @agentos/ui dev` | Vite, talking to a core on port 4747. Add `?demo` to the address and it needs no core at all |
| The presence | `pnpm --filter @agentos/presence dev` | A playground with a state switcher and your microphone |
| The desktop app | `pnpm desktop` | `tauri dev`. Build the packages first: the app shows the interface the core serves |
| The iPhone app | `cd apps/ios && xcodegen && open AgentOS.xcodeproj` | See [docs/ios.md](docs/ios.md) |
| The relay | `PORT=8080 RELAY_DATA=./relay-data node packages/relay/dist/cli.js` | See [its README](packages/relay/README.md) |
| The website | `pnpm site` | Astro, in `apps/site` |

**Demo mode** is the quickest way to see or change the interface: any
address of it with `?demo` runs against a scripted computer that exists only
in the page. `?demo=working`, `?demo=waiting`, `?demo=onboarding`,
`?demo=presence`; add `&remote` to see it as a phone does, `&lang=fr` for
French and `&appearance=light` or `dark` to choose the look. It works on the
built interface too: `http://localhost:4747/os?demo=working`. It is how the
screenshots in `docs/screenshots` are made, which is why nothing in them is
anybody's real computer. Debug builds of the iPhone and watch apps have the
same, with `-demo <scene>`: see [the iPhone and Apple Watch apps](docs/ios.md#try-it-without-a-computer).

**The practice brain** (`AGENTOS_ENGINE=mock`) reacts to a word in what you
say: `deploy`, `delete`, `quit`, `job`, `error`. `AGENTOS_MOCK_SPEED=0` makes
it instant, for tests.

## Checks

Run them before you push. CI runs the first line on Linux and macOS.

```sh
pnpm check
```

When you touched the desktop shell:

```sh
cd apps/desktop/src-tauri
cargo fmt --all -- --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked
```

When you touched the iPhone or watch app, run its tests in Xcode (Product →
Test).

One package at a time: `pnpm --filter @agentos/core test`.

### Files that are generated, and checked in

Three files are written by `pnpm build` and kept in the repository, because
clients that are not TypeScript read them:

- `packages/protocol/schema/agentos.schema.json`
- `packages/design/tokens.css` and `packages/design/tokens.json`

After changing the protocol or a token, build and commit them with your
change. CI fails when they are out of date. After changing the presence's
model, export its reference frames for the Swift port again:
`node apps/ios/Scripts/export-presence-reference.mjs`.

## Commits and pull requests

- **Open an issue first** for anything larger than a fix. It saves you from
  building something that does not fit.
- **One concern per pull request.** Small ones are reviewed fast.
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org)**,
  like the other Synapsr repositories: `feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`, `ci:`, `i18n:`, with the part in brackets when it
  helps. Write the subject as what is now true, and say why in the body.

  ```
  feat(core): a job tells the main conversation when it finishes
  fix(relay): a computer that reconnects keeps its place
  docs: the README opens with the presence in motion
  ```

- **Show it.** For a change to the interface, add before and after
  pictures, taken in demo mode.
- **Update the words around it**: the changelog, the docs, and the French
  text if you changed the English.

By contributing, you agree that your work is released under the project's
[MIT licence](LICENSE). There is nothing to sign.

## Translations

AgentOS speaks English and French from day one. The tables are in
`packages/core/src/i18n.ts` (what the agent and the command say),
`packages/ui/src/i18n.ts` (the interface), `apps/desktop/src-tauri/src/i18n.rs`
(the menu), the string catalogs in `apps/ios`, and `apps/site/src/i18n`
(the website). A string added in one language is added in the other in the
same change.

## Security

Do not open a public issue for a vulnerability. Report it privately, as
[SECURITY.md](SECURITY.md) says.

## Conduct

Be kind. The [code of conduct](CODE_OF_CONDUCT.md) says the rest.
