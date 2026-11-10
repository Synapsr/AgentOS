# AgentOS relay

Reach your computer from anywhere.

On the same network, your phone finds your computer by itself. With
[Tailscale](https://tailscale.com) on both, it finds it from anywhere, with
no server at all. The relay is the third way, for people who would rather
run one small container on a server they own.

Run the published image (Linux, Intel and ARM) with a token of its own:

```sh
RELAY_TOKEN=$(openssl rand -hex 32)
echo "$RELAY_TOKEN"     # your computer will need it
docker run -d -p 8080:8080 -v agentos-relay:/data -e RELAY_TOKEN="$RELAY_TOKEN" ghcr.io/synapsr/agentos-relay
```

To build it yourself instead, at the root of a clone:
`docker build -f packages/relay/Dockerfile -t agentos-relay .`

The relay is private: only computers that present its token may use it.
Tell your computer where the relay is and what its token is — in Settings,
or with `AGENTOS_RELAY_URL=https://relay.example.com` and
`AGENTOS_RELAY_TOKEN=<the token>`. Your computer connects *out* to the relay and
stays connected; your phone connects to the relay; the relay passes
everything between the two. Nothing has to be opened on your home network.

Give the relay an `https://` address: your computer refuses any other,
except one on the computer itself (`http://127.0.0.1:…`, for trying it out).
[docker-compose.yml](docker-compose.yml) puts Caddy in front and gets the
certificate for you.

## What it is, and what it sees

The relay is a pipe. A client's address for your computer is
`https://<relay>/n/<your computer's id>`; whatever arrives there is handed
to your computer and the answer is handed back. Read this before you use one:

- **Whoever runs the relay can act as your phone.** The relay ends the TLS
  connection, so everything that passes through it is readable on that
  server: your conversations, and the token your phone shows your computer
  with each request. With that token, the relay's operator can do anything
  your phone can — talk to your agent, answer what it asks. Use a relay you
  run yourself, or one run by someone you would trust with your computer.
  End-to-end encryption between phone and computer is future work.
- **Everyone else still needs a paired device's token.** Without one, there
  is only the pairing door, and codes for it are only shown on the computer
  itself. The token of the computer's own apps does not work through a relay
  at all.
- **It keeps one line per computer and nothing else.** No tokens, no keys,
  no conversations: only a hash of the secret your computer first connected
  with, so that nobody else can take its place under the same id, and the
  last day it was connected.

## Private, or open to everyone

To a browser, every computer behind one relay is the same website: the
relay's. That is why a relay says who may use it.

- **Private** (`RELAY_TOKEN`), the default. Only computers that present the
  token may connect — yours, and those of whoever you give it to. The web
  version of AgentOS works through it, at `https://<relay>/n/<id>/`. Give the
  token only to people you trust: their computers share a website with yours.
- **Open** (`RELAY_OPEN=1`). Any computer may connect, without a token. Since
  any of them could then serve a page that reads what the others' pages
  keep, the relay passes on the API only (`/n/<id>/v1/…`, what the AgentOS
  apps use) and answers everything else with a short page saying the web
  version is not available through a public relay.

Without either setting, the relay does not start, and says why.

On both, the relay holds back the headers of an answer that would reach
past that answer into the shared website — cookies, service workers,
clearing stored data, reporting addresses — and does not pass on the
cookies a browser sends. The API's answers are marked as data that a
browser must never run as a page.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `RELAY_TOKEN` | Makes the relay private: only computers that present this token may connect (`AGENTOS_RELAY_TOKEN` on the computer). At least 32 characters: `openssl rand -hex 32`. | — |
| `RELAY_OPEN` | Set to `1`, instead of a token, for a relay open to any computer. It passes on the API only. | — |
| `PORT` | Port to listen on | `8080` |
| `RELAY_DATA` | Folder for the one file it keeps | `/data` |
| `RELAY_TRUST_PROXY` | Set to `1` when a reverse proxy is in front, to read client addresses from `X-Forwarded-For`. Never otherwise: clients could then lie about theirs. | — |

`GET /healthz` answers `ok`.

## Limits

- 256 connections at once per computer, and 64 of them at most from one
  client address (one IPv4 address, or one IPv6 /64).
- 20 new computers per hour from one address (the same way of counting),
  and 10,000 computers in all.
- A computer that has not connected for 90 days is forgotten: its id is
  free again.

## Giving an id back

Whoever connects first with an id keeps it, and only the same secret gets
in with it afterwards. If your computer lost its secret (a new
`~/.agentos`), or someone else took its id, free the id by hand: stop the
relay, remove the id's entry from `computers.json` in the data folder
(`/data`, or the `relay-data` volume), and start the relay again. The next
computer to connect with that id has it.

## Without Docker

```sh
pnpm --filter @agentos/relay build
RELAY_TOKEN="$(openssl rand -hex 32)" PORT=8080 RELAY_DATA=./relay-data node packages/relay/dist/cli.js
```

## How it works

One WebSocket per computer (`WS /v1/tunnel?node=<id>`, with the computer's
secret), shared by all the connections to it through a small framed
protocol — streams, flow control, limits. It is described at the top of
[src/tunnel.ts](src/tunnel.ts), which both ends use. Neither end trusts the
other: a frame that breaks the protocol ends its own stream, and nothing
else.
