# Reach your computer from anywhere

Your phone talks to your computer directly. There is no AgentOS server in
between and no account: a phone only needs to reach one port on your
computer, 4747.

There are three ways to make that possible. Pick whichever suits you; they
can be combined.

| | Works from | You set up | On the way |
|---|---|---|---|
| [Same network](#same-network) | Home, the office | Nothing | Encrypted, with your computer's own certificate |
| [Tailscale](#anywhere-with-tailscale) | Anywhere | Tailscale on both devices | Encrypted by Tailscale |
| [Your own relay](#anywhere-with-your-own-relay) | Anywhere | One small container on a server | Encrypted up to the relay, which can read everything |

## How a phone finds your computer

The code you scan to add a phone holds three things: a one-time secret, the
fingerprint of your computer's certificate, and a list of addresses, best
first: Tailscale if it is there, then the local network, then the relay
while it is connected. The phone tries each address until your computer
answers.

**A phone remembers the addresses that were in the code it scanned.** After
you install Tailscale or set up a relay, add the phone again
(`pnpm agentos pair`, or **Add your phone** in the app) so that it learns the
new address.

Settings → This computer shows the addresses in use.

## Same network

Nothing to do. The core listens on port 4747, and the code carries your
computer's local address.

The connection is encrypted. Your computer makes a certificate of its own
the first time it starts. Nobody vouches for that certificate, so the phone
does not trust it the usual way: it trusts the fingerprint that came in the
code it scanned, and refuses any other certificate from then on. That is
what makes an ordinary Wi‑Fi network safe to use. Plain HTTP is only
answered on the computer itself, and over Tailscale.

One consequence: **a browser cannot do that check.** The web client on a
phone therefore needs Tailscale or a relay; on the same Wi‑Fi, use the app.

If the phone cannot reach the computer:

- Both devices must be on the same network. Guest Wi‑Fi networks often keep
  devices apart.
- If the macOS firewall is on, it asks once whether `node` (or AgentOS) may
  accept incoming connections. Say yes.
- On iPhone, the app asks for access to the local network the first time.

To listen on one address only, start the core with `--host`, for example
`pnpm start --host 127.0.0.1` to answer nobody but the computer itself.

## Anywhere, with Tailscale

[Tailscale](https://tailscale.com) gives your devices a private network of
their own, wherever they are. Install it on the computer and on the phone,
sign in to the same account on both, then add your phone again.

AgentOS notices Tailscale by itself: it recognises its addresses and asks
the `tailscale` command for the computer's name, and puts both first in the
code. Nothing to configure, no server to run, and Tailscale encrypts
everything between the two devices. The web client works this way too, in
any browser on a device that is on your Tailscale network.

*Verified by the people who built the networking code. Not run again for
this guide.*

## Anywhere, with your own relay

For when you would rather not put Tailscale on your devices: one small
container on a server you own. Your computer connects *out* to the relay and
stays connected; your phone connects to the relay; the relay passes
everything between the two. Nothing has to be opened on your home network.

Read [what a relay can see](#what-a-relay-can-see) first.

### 1. Run the relay

A relay is private: it only accepts computers that present its token, and
it does not start without one. Make a token, keep it, and give it to the
relay.

The image is not published yet, so build it from your clone, at the root of
the repository:

```sh
docker build -f packages/relay/Dockerfile -t agentos-relay .

RELAY_TOKEN=$(openssl rand -hex 32)
echo "$RELAY_TOKEN"     # your computer will need it
docker run -d -p 8080:8080 -v agentos-relay:/data -e RELAY_TOKEN="$RELAY_TOKEN" agentos-relay
```

*The Docker image has not been built or run yet: the Docker daemon was not
available where this guide was written. The steps its Dockerfile runs were
replayed by hand, with only the files its build is given, and the result
starts and answers.*

Without Docker, the relay is one Node.js program:

```sh
pnpm --filter @agentos/relay build
RELAY_TOKEN=$(openssl rand -hex 32) PORT=8080 RELAY_DATA=./relay-data node packages/relay/dist/cli.js
```

`GET /healthz` answers `ok`.

### 2. Put HTTPS in front

Your computer only connects to a relay whose address starts with
`https://`.
[`packages/relay/docker-compose.yml`](../packages/relay/docker-compose.yml)
puts [Caddy](https://caddyserver.com) in front, which gets and renews the
certificate by itself. Point a domain at the server, open ports 80 and 443,
then follow the steps at the top of that file. Until an image is published,
the first of them builds it on the server, under the name the file uses.

### 3. Tell your computer

In Settings → Reach it from anywhere, type the relay's address and its
token. Or start the core with both:

```sh
AGENTOS_RELAY_URL=https://relay.example.com AGENTOS_RELAY_TOKEN=… pnpm start
```

`pnpm agentos status` then says `Reachable from anywhere through
relay.example.com`. Add your phone again: the code now carries the relay's
address, `https://relay.example.com/n/<your computer's id>`. The same
address opens the web client in any browser.

### What a relay can see

- **Whoever operates the relay sees everything.** The encrypted connection
  ends at the relay, so all that passes through is readable on that server:
  your conversations, the pictures of your screen, and the tokens that would
  let the operator act as your phone. Run your own, and keep it private.
  End-to-end encryption between phone and computer is planned, not built.
- **Your devices' tokens still guard every route.** Reaching your computer
  through a relay gives nobody more rights than their token does. The token
  of the computer's own apps never works through a relay, so its settings
  and its keys cannot be reached that way.
- **It keeps one line per computer**: a hash of the secret the computer
  first connected with.

A relay can also be opened to any computer on purpose, with `RELAY_OPEN=1`
instead of a token. An open relay passes on the API only: it does not serve
the web client. Its settings, limits and wire format are in
[the relay's README](../packages/relay/README.md).

## A domain name of your own, without the relay

It will not work, on purpose. The core only answers requests addressed to an
IP address, to `localhost`, to the computer's own name, or to a `.local` or
`.ts.net` name. That is what stops a web page from reaching your computer
through a domain it controls (DNS rebinding). To use your own domain, put it
on a relay.

## Several computers

Each computer is simply one more pairing. Scan a code on each; the phone
keeps the list and shows them together, each with its own agent.

## Notifications when the app is closed

While the app is open, or in Earbuds mode, the phone hears from your computer
directly. For notifications when it is closed, the computer has to go
through Apple's push service, which needs a signing key from the Apple
developer account that built the app: see
[The iPhone and Apple Watch apps](ios.md#notifications).
