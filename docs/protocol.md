# The protocol at a glance

Everything that talks to an AgentOS computer speaks one small protocol: HTTP
and one WebSocket, in JSON. The desktop app, the iPhone app, the web client
and the `agentos` command all use it, and so can your own scripts.

This page is a map. The contract itself is the code in
[`packages/protocol/src`](../packages/protocol/src), written with
[zod](https://zod.dev) and read like a specification:

| File | What it defines |
|---|---|
| `schemas.ts` | The data: computer, thread, item, request, event, frames |
| `api.ts` | The routes, and the body of each |
| `pairing.ts` | The link inside the QR code |
| `push.ts` | What a notification carries |
| `tool.ts` | Not on the wire: how packages give the agent abilities |

Clients not written in TypeScript read
[`schema/agentos.schema.json`](../packages/protocol/schema/agentos.schema.json),
a JSON Schema of every shape, written by `pnpm build`.

## Conventions

- Base address, on the computer itself: `http://localhost:4747`. From
  another device: `https://<computer>:4747`, with the computer's own
  certificate (see [Transport](#transport)). Through a relay:
  `https://<relay>/n/<computer id>`.
- Timestamps are whole milliseconds since 1970.
- Ids are opaque strings with a readable prefix: `thr_`, `msg_`, `req_`.
- A value that is absent is sent as `null`, never left out, so that strictly
  typed clients decode without special cases.
- Errors are a non-2xx status with
  `{ "error": { "code": "…", "message": "…" } }`. Codes: `unauthorized`,
  `forbidden`, `not_found`, `invalid`, `conflict`, `rate_limited`,
  `unavailable`, `internal`.
- The protocol has a version (`1`), told by `GET /v1/hello`.

## Transport

The computer answers plain HTTP only to itself (the loopback interface),
and on a Tailscale interface, which is already encrypted. Every other
connection is TLS with the computer's own self-signed certificate. A client
cannot check that certificate the usual way, so it checks its fingerprint:
the SHA-256 of the certificate travels in the pairing link, and a client
must refuse any other certificate, at pairing and on every connection
after. A relay's address is ordinary HTTPS, checked the usual way.

## Who may call

Every route under `/v1` needs `Authorization: Bearer <token>`, except
`GET /v1/hello` and `POST /v1/pair`. There are two kinds of token:

- a **device token**, which a client gets by pairing and must keep secret;
- the **local token**, for apps on the computer itself. It opens the routes
  marked *local* below, is accepted on loopback connections only, never
  through a relay, and is new every time the core starts. Before sending
  it, a local client can make sure it is talking to the core:
  `GET /v1/hello?challenge=<nonce>` answers with a `proof`, the HMAC-SHA256
  of the nonce keyed with the local token.

## Routes

| Route | | Who | What |
|---|---|---|---|
| `/v1/hello` | GET | anyone | Is this an AgentOS computer? Its id, name, agent's name, versions |
| `/v1/pair` | POST | anyone with a code | Exchange a one-time pairing code for a device token |
| `/v1/node` | GET | any token | The computer, its agent and what it is doing |
| `/v1/node` | PATCH | local | Names, language, how much the agent asks; completes the setup |
| `/v1/mode` | POST | any token | Switch between `desktop` and `os` mode |
| `/v1/settings` | GET, PATCH | local | Engine, voice and network settings. Keys go in, never out |
| `/v1/pairing-codes` | POST | local | Create a one-time pairing code |
| `/v1/devices` | GET | any token | Paired devices |
| `/v1/devices/:id` | DELETE | local | Remove a device |
| `/v1/devices/me` | DELETE | a device | A device removes itself |
| `/v1/devices/me/push` | PUT | a device | Register for notifications |
| `/v1/threads` | GET | any token | Conversations: `main`, and the agent's background jobs |
| `/v1/threads/:id/items` | GET | any token | A conversation's timeline, newest last (`?before=&limit=`) |
| `/v1/threads/:id/messages` | POST | any token | Say something to the agent |
| `/v1/threads/:id/interrupt` | POST | any token | Stop what it is doing |
| `/v1/requests` | GET | any token | Requests waiting for an answer |
| `/v1/requests/:id/resolve` | POST | any token | Answer one |
| `/v1/files/:id` | GET | any token | A stored picture |
| `/v1/screen` | GET | any token | The screen right now, as a JPEG (`?maxWidth=`) |
| `/v1/computer/permissions` | POST | local | Ask the system for the permissions the agent needs |
| `/v1/voice/transcribe` | POST | any token | Audio in, text out, when the voice runs on the computer |
| `/v1/voice/speak` | POST | any token | Text in, an audio stream out |
| `/v1/events` | WebSocket | any token | Everything that happens, as it happens |

## The ideas

**Thread.** A conversation. Every computer has one called `main`: the single
conversation a person has with their agent. The agent starts `job` threads
for long work and is told when they finish.

**Item.** What appears in a thread: a `message` (someone said something), an
`activity` (one human line about what the agent is doing) or a `request`.

**Request.** The agent needs its owner. An `approval` is the safety rules
stopping an action: its options are `approve` and `deny`. A `question` is the
agent choosing to ask: its options are its own. A request carries a `title`,
a sentence `spoken` aloud, a `risk`, sometimes a `screenshot`, and may accept
free text. Any client may answer; the first answer wins.

There are two ways to answer. `POST /v1/requests/:id/resolve` picks an
option. Or the owner's own words are sent as a message with `requestId` set
to that request: only then may the computer read a message as an answer, and
for an approval only an unmistakable yes approves. The response carries the
request as it stands afterwards; still `pending` means the words were not a
clear answer. A message without `requestId` never answers anything.

**Event.** Every change is an event with a sequence number, `seq`:
`node.status`, `node.updated`, `thread.updated`, `thread.deleted`,
`item.added`, `item.updated`, `turn.completed`, and `message.delta` while
the agent is typing (not stored: its `seq` is `0`).

## Following along

Open `WS /v1/events`. Browsers cannot set headers on a WebSocket, so the
token may go in the address: `?token=`. To pick up where you stopped, add
`?since=<the last seq you saw>`.

The computer first replays what you missed, then sends one `ready` frame
with the computer's current state, then every event as it happens. If
`ready` says `reset: true`, your `since` was too old: drop what you hold and
load it again over HTTP. Clients never poll.

```
→ (connect) /v1/events?since=41
← { "type": "event", "event": { "type": "item.added", "seq": 42, … } }
← { "type": "ready", "seq": 42, "reset": false, "node": {…}, "status": {…}, "local": false }
← { "type": "event", "event": { "type": "node.status", "seq": 43, … } }
```

A client may send `{ "type": "ping" }` (answered by `pong`) and
`{ "type": "presence", "active": true }`, to say that its owner is looking
at it right now. The computer uses that to decide who gets notified.

## Adding a device

1. On the computer, `POST /v1/pairing-codes` (local) returns a code, when it
   expires (five minutes) and a link:
   `agentos://pair?v=1&c=<code>&i=<computer id>&n=<name>&f=<fingerprint>&u=<address>&u=<address>`.
   That link is what the QR code holds. `f` is the fingerprint of the
   computer's certificate.
2. The client tries each address until `GET /v1/hello` answers with the
   expected computer id, refusing any certificate that does not match `f`.
3. It calls `POST /v1/pair` with the code and a name for itself, and receives
   its token, once. A code works once.

## Try it

With a core you started yourself on this computer
(`AGENTOS_ENGINE=mock pnpm start` needs no key), in another terminal. The
local token is in a file for as long as that core runs, and is new every
time. These calls go to `localhost`, the only place that token is accepted:

```sh
TOKEN=$(cat "${AGENTOS_HOME:-$HOME/.agentos}/local-token")
AUTH="Authorization: Bearer $TOKEN"

curl -s http://localhost:4747/v1/hello

curl -s -H "$AUTH" http://localhost:4747/v1/node

# Say something. With the mock engine, "delete" makes the agent ask first.
curl -s -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"text":"delete the old build"}' \
  http://localhost:4747/v1/threads/main/messages

# What is it asking? Then answer it: approve, or deny.
curl -s -H "$AUTH" http://localhost:4747/v1/requests
curl -s -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"optionId":"deny"}' \
  http://localhost:4747/v1/requests/<request id>/resolve
```

And the event stream, with Node.js 22 or later:

```sh
node -e '
  const ws = new WebSocket("ws://localhost:4747/v1/events?token=" + process.argv[1]);
  ws.onmessage = (message) => console.log(message.data);
' "$TOKEN"
```

## Writing a client

- Keep the device token somewhere only your app can read (the Keychain, the
  Keystore).
- Keep the certificate's fingerprint from the pairing link, and refuse any
  other certificate, every time.
- Remember every address from the pairing link, and which one answered last.
- Hold one WebSocket open, remember the last `seq`, reconnect with `since`.
- Show the agent's state from `node.status`: `idle`, `working`, `waiting`.
- When a request arrives, say its `spoken` sentence, show its screenshot,
  and offer its options. Expect it to be answered elsewhere at any moment
  (`item.updated`).
- Announce `turn.completed` only for the `main` thread: the agent reports on
  its jobs itself.

## Changing the protocol

The protocol is the contract between every part of AgentOS. Do not invent a
field or a route in a client or in the core. Change
`packages/protocol/src` first, on purpose, run `pnpm build` (which rewrites
the JSON Schema), then update the core and each client, the Swift mirror in
`apps/ios/AgentOS/Protocol` included. See [Contributing](../CONTRIBUTING.md).
