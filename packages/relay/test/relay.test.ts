/** The relay against a stand-in computer: what a client sends arrives, what the computer answers comes back. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WINDOW_BYTES, startRelay } from "../src/index.js";
import { NODE, SECRET, type Serve, TOKEN, computer, dataDir, echo, json, relay, sha, sockets, start, until } from "./helpers.js";

const OTHER_SECRET = "x".repeat(43);
const DAY_MS = 24 * 3_600_000;
/** What the relay keeps, as it is on disk. */
const kept = (): Record<string, { secret: string; seen: string }> => JSON.parse(readFileSync(join(dataDir, "computers.json"), "utf8"));
/** Waits until the relay has noticed that a computer is gone. */
async function noticedGone(base: string, node: string): Promise<void> {
  while ((await fetch(`${base}/n/${node}/v1/hello`)).status !== 502) await new Promise((resolve) => setTimeout(resolve, 5));
}

afterEach(() => void vi.useRealTimers());

describe("the relay itself", () => {
  it("says it is alive and what it is", async () => {
    const base = await start();
    const health = await fetch(`${base}/healthz`);
    expect([health.status, await health.text()]).toEqual([200, "ok\n"]);
    expect(await (await fetch(base)).text()).toContain("AgentOS relay");
    const lost = await fetch(`${base}/elsewhere`);
    expect([lost.status, await json(lost)]).toEqual([404, { error: { code: "not_found", message: "There is nothing here." } }]);
  });

  it("answers `unavailable` for a computer that is not connected", async () => {
    const base = await start();
    const response = await fetch(`${base}/n/${NODE}/v1/hello`);
    expect(response.status).toBe(502);
    expect((await json(response)).error.code).toBe("unavailable");
  });

  it("does not start until it is told who may use it: a token, or everyone", async () => {
    const options = { port: 0, host: "127.0.0.1", dataDir: mkdtempSync(join(tmpdir(), "agentos-relay-test-")) };
    // Leaving the token out is not a way to open a relay, and says how to make one.
    await expect(startRelay(options)).rejects.toThrow(/no token[^]*RELAY_TOKEN=\$\(openssl rand -hex 32\)[^]*RELAY_OPEN=1/);
    await expect(startRelay({ ...options, token: "" })).rejects.toThrow(/no token/);
    await expect(startRelay({ ...options, token: TOKEN, open: true })).rejects.toThrow(/both set/);
    await expect(startRelay({ ...options, token: "hunter2" })).rejects.toThrow(/too short/);
  });
});

describe("a computer's place on the relay", () => {
  it("is its own: the first secret an id comes with is the only one accepted afterwards", async () => {
    const base = await start();
    expect(await computer(echo)).toBeInstanceOf(WebSocket);
    expect(await computer(echo, { secret: OTHER_SECRET })).toBe(403);
    // Someone else's id is free for someone else.
    expect(await computer(echo, { node: "node_other", secret: OTHER_SECRET })).toBeInstanceOf(WebSocket);
    // Only a hash is kept, readable by the relay alone, with the last day the computer was here.
    expect(readFileSync(join(dataDir, "computers.json"), "utf8")).not.toContain(SECRET);
    expect(kept()[NODE]).toEqual({ secret: createHash("sha256").update(SECRET).digest("hex"), seen: new Date().toISOString().slice(0, 10) });
    expect((await json(await fetch(`${base}/n/${NODE}/v1/hello`))).path).toBe("/v1/hello");
  });

  it("is remembered when the relay restarts", async () => {
    await start();
    await computer(echo);
    await relay.close();
    await start({ dataDir });
    expect(await computer(echo, { secret: OTHER_SECRET })).toBe(403);
    expect(await computer(echo)).toBeInstanceOf(WebSocket);
  });

  it("goes to its newest connection", async () => {
    const base = await start();
    const first = (await computer(() => ({ data: () => {}, close: () => {} }))) as WebSocket;
    const replaced = new Promise<number>((resolve) => first.on("close", resolve));
    await computer(echo);
    expect(await replaced).toBe(4000);
    expect((await fetch(`${base}/n/${NODE}/v1/hello`)).status).toBe(200);
  });

  it("needs the relay's token when the relay is private", async () => {
    await start();
    expect(await computer(echo, { token: "" })).toBe(401);
    expect(await computer(echo, { token: "a-guess" })).toBe(401);
    expect(await computer(echo, { token: TOKEN })).toBeInstanceOf(WebSocket);
    // A computer that was turned away has no place: its id is still anyone's who has the token.
    expect(await computer(echo, { node: "node_guess", secret: OTHER_SECRET, token: "a-guess" })).toBe(401);
    expect(await computer(echo, { node: "node_guess" })).toBeInstanceOf(WebSocket);
  });

  it("is refused to a computer without an id or a real secret", async () => {
    await start();
    expect(await computer(echo, { node: "not an id" })).toBe(400);
    expect(await computer(echo, { secret: "short" })).toBe(400);
  });

  it("can have any id that is one, even a name every object has", async () => {
    await start();
    for (const node of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(await computer(echo, { node })).toBeInstanceOf(WebSocket);
      expect(await computer(echo, { node, secret: OTHER_SECRET })).toBe(403);
    }
    await relay.close();
    await start({ dataDir });
    expect(await computer(echo, { node: "__proto__", secret: OTHER_SECRET })).toBe(403);
    expect(await computer(echo, { node: "__proto__" })).toBeInstanceOf(WebSocket);
  });

  it("is not handed out without limit to one address", async () => {
    await start();
    const answers: (WebSocket | number)[] = [];
    for (let index = 0; index < 22; index++) answers.push(await computer(echo, { node: `node_${index}` }));
    expect(answers.slice(0, 20).every((answer) => answer instanceof WebSocket)).toBe(true);
    expect(answers.slice(20)).toEqual([429, 429]);
    // A computer already known is not a new one.
    expect(await computer(echo, { node: "node_3" })).toBeInstanceOf(WebSocket);
  });

  it("nor to one IPv6 network: all the addresses of a /64 count as one", async () => {
    await start({ trustProxy: true });
    // Twenty computers, each from another address of 2001:db8:1:2::/64, written in full or in short.
    for (let index = 0; index < 20; index++) {
      const from = index % 2 ? `2001:db8:1:2::${index}` : `2001:0db8:0001:0002:0:0:${index}:1`;
      expect(await computer(echo, { node: `node_${index}`, from })).toBeInstanceOf(WebSocket);
    }
    expect(await computer(echo, { node: "node_same", from: "2001:db8:1:2:dead:beef:0:1" })).toBe(429);
    expect(await computer(echo, { node: "node_same", from: "2001:DB8:1:2::" })).toBe(429);
    // The network next door is someone else, and so is every IPv4 address.
    expect(await computer(echo, { node: "node_next", from: "2001:db8:1:3::1" })).toBeInstanceOf(WebSocket);
    expect(await computer(echo, { node: "node_short", from: "2001:db8::1:2:0:0:1" })).toBeInstanceOf(WebSocket);
    expect(await computer(echo, { node: "node_v4", from: "198.51.100.7" })).toBeInstanceOf(WebSocket);
    expect(await computer(echo, { node: "node_mapped", from: "::ffff:198.51.100.8" })).toBeInstanceOf(WebSocket);
  });

  it("is lost after ninety days away — and never while the computer is connected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const base = await start();
    const first = (await computer(echo)) as WebSocket;
    const registered = Date.now();
    first.terminate();
    await noticedGone(base, NODE);

    vi.setSystemTime(registered + 89 * DAY_MS);
    expect(await computer(echo, { secret: OTHER_SECRET })).toBe(403);

    // Ninety-one days: the id is free again, and whoever takes it now is the one it belongs to.
    vi.setSystemTime(registered + 91 * DAY_MS);
    expect(await computer(echo, { secret: OTHER_SECRET })).toBeInstanceOf(WebSocket);
    expect(await computer(echo)).toBe(403);

    // That computer stays connected for a year: its place does not lapse under it.
    vi.setSystemTime(registered + 456 * DAY_MS);
    expect(await computer(echo)).toBe(403);
    expect((await fetch(`${base}/n/${NODE}/v1/hello`)).status).toBe(200);
    // Nor when the relay restarts: the last day it was here is written down.
    await relay.close();
    expect(kept()[NODE]?.seen).toBe(new Date(registered + 456 * DAY_MS).toISOString().slice(0, 10));
    await start({ dataDir });
    expect(await computer(echo)).toBe(403);
    expect(await computer(echo, { secret: OTHER_SECRET })).toBeInstanceOf(WebSocket);
  });

  it("is forgotten for good with the others that stayed away, so that the relay does not fill up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const base = await start();
    for (const node of ["node_gone_1", "node_gone_2", "node_stays"]) await computer(echo, { node });
    const registered = Date.now();
    for (const socket of sockets.splice(0, 2)) socket.terminate();
    await noticedGone(base, "node_gone_1");
    await noticedGone(base, "node_gone_2");
    vi.setSystemTime(registered + 91 * DAY_MS);
    await relay.close();
    expect(Object.keys(kept())).toEqual(["node_stays"]);
  });

  it("can be given back by the relay's operator: an id taken out of the file is free", async () => {
    await start();
    await computer(echo);
    await computer(echo, { node: "node_other" });
    await relay.close();
    const others = kept();
    delete others[NODE];
    writeFileSync(join(dataDir, "computers.json"), JSON.stringify(others));
    await start({ dataDir });
    expect(await computer(echo, { secret: OTHER_SECRET })).toBeInstanceOf(WebSocket);
    expect(await computer(echo, { node: "node_other", secret: OTHER_SECRET })).toBe(403);
  });

  it("is kept from a relay of before, which wrote the hash alone", async () => {
    const folder = mkdtempSync(join(tmpdir(), "agentos-relay-test-"));
    writeFileSync(join(folder, "computers.json"), JSON.stringify({ [NODE]: createHash("sha256").update(SECRET).digest("hex") }));
    await start({ dataDir: folder });
    expect(await computer(echo, { secret: OTHER_SECRET })).toBe(403);
    expect(await computer(echo)).toBeInstanceOf(WebSocket);
  });

  it("is not guessed from a file the relay cannot read: it says so and does not start", async () => {
    const folder = mkdtempSync(join(tmpdir(), "agentos-relay-test-"));
    writeFileSync(join(folder, "computers.json"), '{ "node_a": ');
    await expect(start({ dataDir: folder })).rejects.toThrow(/cannot read .*computers\.json/);
    // Nor does it start where it could not write the file down.
    await expect(start({ dataDir: join(folder, "computers.json", "below-a-file") })).rejects.toThrow(/cannot write/);
  });
});

describe("a relay open to everyone", () => {
  it("takes any computer, and passes on its API", async () => {
    const base = await start({ open: true });
    expect(await computer(echo, { token: "" })).toBeInstanceOf(WebSocket);
    expect(await computer(echo, { node: "node_other", token: "whatever" })).toBeInstanceOf(WebSocket);
    for (const path of ["/v1", "/v1/hello", "/v1/threads/main/items?limit=5", "/v1?x=1"]) {
      expect((await json(await fetch(`${base}/n/${NODE}${path}`))).path).toBe(path);
    }
  });

  it("passes on nothing else: no computer can show a page at the relay's address", async () => {
    const base = await start({ open: true });
    const asked: string[] = [];
    await computer((stream, request) => {
      asked.push(request.path);
      stream.head({ status: 200, headers: [["Content-Type", "text/html"]] });
      void stream.write(Buffer.from("<script>steal(localStorage)</script>")).then(() => stream.end());
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => {} };
    });
    for (const path of ["", "/", "/index.html", "/assets/app.js", "/sw.js", "/v1/../", "/v10/x", "/V1/x", "/%76%31/..%2f"]) {
      const response = await fetch(`${base}/n/${NODE}${path}`, { redirect: "manual" });
      const page = await response.text();
      expect([path, response.status, response.headers.get("content-type")]).toEqual([path, 403, "text/html; charset=utf-8"]);
      expect(page).toContain("The web version of AgentOS is not available through a public relay.");
      expect(page).not.toContain("script");
    }
    const french = await fetch(`${base}/n/${NODE}/`, { headers: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" } });
    expect(await french.text()).toContain("La version web d'AgentOS n'est pas disponible via un relais public.");
    // The same for a WebSocket anywhere but in the API.
    const socket = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/live`);
    sockets.push(socket);
    socket.on("error", () => {});
    expect(await new Promise((resolve) => socket.on("unexpected-response", (_request, response) => resolve(response.statusCode)))).toBe(403);
    // The computer was not even asked.
    expect(asked).toEqual([]);
  });
});

describe("an HTTP request", () => {
  it("reaches the computer without the relay's prefix, and its answer comes back", async () => {
    const base = await start();
    await computer(echo);
    const response = await fetch(`${base}/n/${NODE}/v1/threads/main/messages?x=1&y=two`, {
      method: "POST",
      headers: { Authorization: "Bearer device-token", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-computer")).toBe("yes");
    const said = await json(response);
    expect(said).toMatchObject({ method: "POST", path: "/v1/threads/main/messages?x=1&y=two", bytes: 16, client: expect.stringContaining("127.0.0.1") });
    expect(said.headers).toMatchObject({ Authorization: "Bearer device-token", "Content-Type": "application/json" });
    // What belongs to the hop between client and relay stays there.
    expect(Object.keys(said.headers).map((name) => name.toLowerCase())).not.toEqual(expect.arrayContaining(["host", "connection"]));
  });

  it("is told apart from its neighbours: many at once, each with its own answer", async () => {
    const base = await start();
    await computer(echo);
    const bodies = Array.from({ length: 40 }, (_, index) => randomBytes(1000 + index * 3000));
    const answers = await Promise.all(
      bodies.map((body, index) => fetch(`${base}/n/${NODE}/upload/${index}`, { method: "PUT", body }).then(json)),
    );
    answers.forEach((answer, index) => expect(answer).toMatchObject({ path: `/upload/${index}`, bytes: bodies[index]?.length, sha: sha(bodies[index] ?? Buffer.alloc(0)) }));
  });

  it("sends the app's address with a slash, so that its relative links hold", async () => {
    const base = await start();
    await computer(echo);
    const response = await fetch(`${base}/n/${NODE}?from=qr`, { redirect: "manual" });
    expect([response.status, response.headers.get("location")]).toEqual([308, `/n/${NODE}/?from=qr`]);
    expect((await json(await fetch(`${base}/n/${NODE}/`))).path).toBe("/");
  });

  it("takes the client's address from the proxy in front, only when told there is one", async () => {
    const base = await start({ trustProxy: true });
    await computer(echo);
    const forwarded = await fetch(`${base}/n/${NODE}/x`, { headers: { "X-Forwarded-For": "6.6.6.6, 203.0.113.9" } });
    expect((await json(forwarded)).client).toBe("203.0.113.9");
    await relay.close();

    const plain = await start();
    await computer(echo);
    const spoofed = await fetch(`${plain}/n/${NODE}/x`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
    expect((await json(spoofed)).client).toContain("127.0.0.1");
  });

  it("streams the answer: each piece reaches the client when the computer sends it, not at the end", async () => {
    const base = await start();
    let next: (() => Promise<void>) | null = null;
    await computer((stream) => ({
      data: (_bytes, _text, passedOn) => passedOn(),
      end: () => {
        stream.head({ status: 200, headers: [["Content-Type", "audio/mpeg"]] });
        let piece = 0;
        next = async () => {
          await stream.write(Buffer.from(`piece ${++piece};`));
          if (piece === 3) stream.end();
        };
      },
      close: () => {},
    }));
    const response = await fetch(`${base}/n/${NODE}/v1/voice/speak`, { method: "POST", body: "{}" });
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    const reader = response.body!.getReader();
    const heard: string[] = [];
    for (let piece = 1; piece <= 3; piece++) {
      // Nothing has been sent yet: the client has the headers and waits.
      await next!();
      heard.push(Buffer.from((await reader.read()).value ?? []).toString());
    }
    expect(heard).toEqual(["piece 1;", "piece 2;", "piece 3;"]);
    expect((await reader.read()).done).toBe(true);
  });

  it("streams the request: the computer has each piece while the client is still sending", async () => {
    const base = await start();
    const arrived: string[] = [];
    await computer((stream) => ({
      data: (bytes, _text, passedOn) => {
        arrived.push(bytes.toString());
        passedOn();
      },
      end: () => {
        stream.head({ status: 200, headers: [] });
        void stream.write(Buffer.from(String(arrived.length))).then(() => stream.end());
      },
      close: () => {},
    }));
    const answered = new Promise<string>((resolve) => {
      const upload = httpRequest(`${base}/n/${NODE}/v1/voice/transcribe`, { method: "POST", headers: { "Content-Type": "audio/wav" } }, (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve(text));
      });
      void (async () => {
        for (const piece of ["one", "two", "three"]) {
          upload.write(piece);
          await until(() => arrived.at(-1) === piece);
        }
        upload.end();
      })();
    });
    expect(await answered).toBe("3");
    expect(arrived).toEqual(["one", "two", "three"]);
  });

  it("does not let a client that reads slowly fill anyone's memory", async () => {
    const base = await start();
    const total = 64 * 1024 * 1024;
    const chunk = randomBytes(64 * 1024);
    let sent = 0;
    await computer((stream) => ({
      data: (_bytes, _text, passedOn) => passedOn(),
      end: () => {
        stream.head({ status: 200, headers: [] });
        void (async () => {
          while (sent < total && (await stream.write(chunk))) sent += chunk.length;
          stream.end();
        })();
      },
      close: () => {},
    }));
    const response = await fetch(`${base}/n/${NODE}/big`, { method: "POST", body: "go" });
    const reader = response.body!.getReader();
    await reader.read();
    // The client stops reading. The computer may send what fits in the window and in the
    // network's own buffers, then has to wait — far short of the 64 MiB it has to say.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const whileWaiting = sent;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent).toBe(whileWaiting);
    expect(whileWaiting).toBeGreaterThanOrEqual(WINDOW_BYTES);
    expect(whileWaiting).toBeLessThan(total / 4);

    // It reads again: everything arrives, and other requests were never held up.
    let received = 0;
    for (let part = await reader.read(); !part.done; part = await reader.read()) received += part.value.length;
    expect(received + chunk.length).toBeGreaterThanOrEqual(total);
    expect(sent).toBe(total);
  }, 30_000);

  it("refuses a body larger than it passes on", async () => {
    const base = await start();
    let opened = 0;
    await computer((stream, request) => {
      opened++;
      return echo(stream, request);
    });
    const response = await fetch(`${base}/n/${NODE}/upload`, { method: "POST", body: Buffer.alloc(33 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe("invalid");
    expect(opened).toBe(1);
  }, 30_000);

  it("ends in `unavailable` when the computer drops off in the middle", async () => {
    const base = await start();
    const socket = (await computer(() => ({ data: (_bytes, _text, passedOn) => passedOn(), close: () => {} }))) as WebSocket;
    const pending = fetch(`${base}/n/${NODE}/slow`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.terminate();
    const response = await pending;
    expect(response.status).toBe(502);
    expect((await json(response)).error.code).toBe("unavailable");
  });

  it("tells the computer when the client gives up", async () => {
    const base = await start();
    let closed = false;
    await computer(() => ({ data: (_bytes, _text, passedOn) => passedOn(), close: () => (closed = true) }));
    const giveUp = new AbortController();
    const pending = fetch(`${base}/n/${NODE}/slow`, { signal: giveUp.signal }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    giveUp.abort();
    await pending;
    await until(() => closed);
  });
});

describe("a WebSocket", () => {
  /** A computer that accepts every WebSocket, greets it, and answers each message. */
  const chatty: Serve = (stream, request) => {
    stream.head({ status: 101, headers: [] });
    stream.message(JSON.stringify({ hello: request.path }));
    return {
      data: (bytes, text, passedOn) => {
        stream.message(text ? `you said ${bytes.toString()}` : Buffer.from([...bytes].reverse()));
        passedOn();
      },
      close: () => {},
    };
  };

  it("is opened through to the computer, and carries messages both ways", async () => {
    await start();
    await computer(chatty);
    const client = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events?since=4&token=abc`);
    sockets.push(client);
    const messages: (string | Buffer)[] = [];
    client.on("message", (data, isBinary) => messages.push(isBinary ? (data as Buffer) : data.toString()));
    await until(() => messages.length === 1);
    client.send("hi");
    client.send(Buffer.from([1, 2, 3]));
    await until(() => messages.length === 3);
    expect(messages).toEqual(['{"hello":"/v1/events?since=4&token=abc"}', "you said hi", Buffer.from([3, 2, 1])]);
  });

  it("is closed with the computer's reason, and the computer hears when the client leaves", async () => {
    await start();
    let left: number | undefined;
    let kick: () => void = () => {};
    await computer((stream) => {
      stream.head({ status: 101, headers: [] });
      kick = () => stream.close(1008, "This device was removed.");
      return { data: (_bytes, _text, passedOn) => passedOn(), close: (code) => (left = code ?? 0) };
    });
    const first = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events`);
    sockets.push(first);
    const closed = new Promise<[number, string]>((resolve) => first.on("close", (code, reason) => resolve([code, reason.toString()])));
    await new Promise((resolve) => first.on("open", resolve));
    kick();
    expect(await closed).toEqual([1008, "This device was removed."]);

    const second = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events`);
    sockets.push(second);
    await new Promise((resolve) => second.on("open", resolve));
    second.close(4321, "bye");
    await until(() => left === 4321);
  });

  it("is refused with the computer's own answer", async () => {
    await start();
    await computer((stream) => {
      stream.head({ status: 401, headers: [["Content-Type", "application/json"]] });
      void stream.write(Buffer.from('{"error":{"code":"unauthorized","message":"A valid token is required."}}')).then(() => stream.end());
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => {} };
    });
    const client = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events`);
    sockets.push(client);
    client.on("error", () => {});
    const refusal = await new Promise<{ status: number; body: string }>((resolve) => {
      client.on("unexpected-response", (_request, response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      });
    });
    expect(refusal.status).toBe(401);
    expect(JSON.parse(refusal.body).error.code).toBe("unauthorized");
  });

  it("is refused when the computer is not there", async () => {
    await start();
    const client = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events`);
    sockets.push(client);
    client.on("error", () => {});
    const status = await new Promise<number>((resolve) => client.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0)));
    expect(status).toBe(502);
  });

  it("drops a client the computer cannot keep up with, rather than queueing for it", async () => {
    await start();
    // A computer that never says it has passed anything on: its window only empties.
    await computer((stream) => {
      stream.head({ status: 101, headers: [] });
      return { data: () => {}, close: () => {} };
    });
    const client = new WebSocket(`ws://127.0.0.1:${relay.port}/n/${NODE}/v1/events`);
    sockets.push(client);
    const closed = new Promise<number>((resolve) => client.on("close", resolve));
    await new Promise((resolve) => client.on("open", resolve));
    for (let sent = 0; sent <= WINDOW_BYTES; sent += 60_000) client.send(Buffer.alloc(60_000));
    expect(await closed).toBe(1013);
  });
});
