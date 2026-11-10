/** Both ends of a tunnel over a real socket, and what each does when it is sent what it should never be sent. */
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { type Stream, type StreamRequest, Tunnel, WINDOW_BYTES } from "../src/index.js";
import { CLOSE, DATA, END, HEAD, OPEN, REQUEST, type Serve, WINDOW, anyFrame, frame, numbers, uint32, until } from "./helpers.js";

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    for (const socket of server.clients) socket.terminate();
    server.close();
  }
});

interface Ends {
  /** The relay's end: it opens streams. */
  relay: Tunnel;
  sockets: { relay: WebSocket; computer: WebSocket };
  /** Puts a frame on the socket as if the computer had sent it. */
  toRelay(frame: Buffer): void;
  /** Puts a frame on the socket as if the relay had sent it. */
  toComputer(frame: Buffer): void;
  /** Whether the computer's end has seen its socket close. */
  closed(): boolean;
}

/** A tunnel with both of its ends in this process, the computer's end served by `serve`. */
async function tunnel(serve: Serve): Promise<Ends> {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(server);
  await new Promise((resolve) => server.on("listening", resolve));
  const accepted = new Promise<WebSocket>((resolve) => server.on("connection", resolve));
  const computer = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
  await new Promise((resolve) => computer.on("open", resolve));
  const relay = await accepted;
  let closed = false;
  new Tunnel(computer, serve, () => (closed = true));
  return {
    relay: new Tunnel(relay),
    sockets: { relay, computer },
    toRelay: (bytes) => computer.send(bytes),
    toComputer: (bytes) => relay.send(bytes),
    closed: () => closed,
  };
}

/** A computer that answers every request with the body it was sent, once all of it has arrived. */
const echo: Serve = (stream) => {
  const body: Buffer[] = [];
  return {
    data: (bytes, _text, passedOn) => {
      body.push(bytes);
      passedOn();
    },
    end: () => {
      stream.head({ status: 200, headers: [["Content-Type", "application/octet-stream"]] });
      void stream.write(Buffer.concat(body)).then(() => stream.end());
    },
    close: () => {},
  };
};

/** What became of a stream the relay's end opened. */
interface Exchange {
  stream: Stream;
  status?: number;
  body: Buffer[];
  ended: boolean;
  /** How many times the reader was told the stream is over. */
  closes: number;
}

/** Opens a stream at the relay's end and keeps what comes back on it. */
function open(relay: Tunnel, request: StreamRequest = REQUEST): Exchange {
  const exchange: Exchange = { stream: undefined as unknown as Stream, body: [], ended: false, closes: 0 };
  exchange.stream = relay.open(request, {
    head: (response) => (exchange.status = response.status),
    data: (bytes, _text, passedOn) => {
      exchange.body.push(bytes);
      passedOn();
    },
    end: () => (exchange.ended = true),
    close: () => exchange.closes++,
  });
  return exchange;
}

/** A whole exchange: the request, its body, and the answer's body once it is complete. */
async function ask(relay: Tunnel, body: Buffer): Promise<Buffer> {
  const exchange = open(relay);
  await exchange.stream.write(body);
  exchange.stream.end();
  await until(() => exchange.ended || exchange.closes > 0);
  expect([exchange.status, exchange.closes]).toEqual([200, 0]);
  exchange.stream.close();
  return Buffer.concat(exchange.body);
}

describe("a tunnel", () => {
  it("carries a request to the computer and its answer back", async () => {
    const { relay } = await tunnel(echo);
    const body = randomBytes(700_000);
    expect((await ask(relay, body)).equals(body)).toBe(true);
    expect(relay.size).toBe(0);
  });
});

describe("the relay's end, sent a frame that is not what it should be", () => {
  const answer = { status: 200, headers: [["Content-Type", "text/plain"]] };
  const wrong: [what: string, frames: (id: number) => Buffer[]][] = [
    ["an answer with a status that is not one (99)", (id) => [frame(HEAD, id, { status: 99, headers: [] })]],
    ["an answer with a status that is not a number", (id) => [frame(HEAD, id, { status: "200", headers: [] })]],
    ["an answer without headers", (id) => [frame(HEAD, id, { status: 200 })]],
    ["an answer whose headers are not pairs", (id) => [frame(HEAD, id, { status: 200, headers: ["Content-Type", "text/plain"] })]],
    ["an answer with a header that breaks the line", (id) => [frame(HEAD, id, { status: 200, headers: [["X-A", "b\r\nSet-Cookie: c=d"]] })]],
    ["an answer with a header name that is not one", (id) => [frame(HEAD, id, { status: 200, headers: [["Bad Name:", "x"]] })]],
    ["an answer that is not JSON", (id) => [frame(HEAD, id, "{status")]],
    ["an answer that is nothing", (id) => [frame(HEAD, id, "null")]],
    ["a second answer", (id) => [frame(HEAD, id, answer), frame(HEAD, id, answer)]],
    ["data before the answer", (id) => [frame(DATA, id, "early")]],
    ["an end before the answer", (id) => [frame(END, id)]],
    ["data after the end", (id) => [frame(HEAD, id, answer), frame(END, id), frame(DATA, id, "late")]],
    ["a second end", (id) => [frame(HEAD, id, answer), frame(END, id), frame(END, id)]],
    ["more data than the window allows", (id) => [frame(HEAD, id, answer), ...Array.from({ length: 5 }, () => frame(DATA, id, Buffer.alloc(60_000)))]],
    ["an allowance it never spent", (id) => [frame(WINDOW, id, uint32(1))]],
    ["an allowance that is not a number", (id) => [frame(WINDOW, id, "lots")]],
    ["a stream of its own, with the id of an open one", (id) => [frame(OPEN, id, REQUEST)]],
    ["a frame of no known kind", (id) => [frame(9, id, "?")]],
  ];

  it.each(wrong)("%s: ends that stream, and only that one", async (_what, frames) => {
    const told: number[] = [];
    const answers = new Map<number, () => void>();
    const ends = await tunnel((stream) => {
      answers.set(stream.id, () => {
        stream.head({ status: 200, headers: [] });
        void stream.write(Buffer.from("fine")).then(() => stream.end());
      });
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => told.push(stream.id) };
    });
    // A reader that never says it has passed anything on, so that the window is what holds the computer back.
    const hit = { closes: 0 };
    const stream = ends.relay.open(REQUEST, { data: () => {}, close: () => hit.closes++ });
    const spared = open(ends.relay);
    await until(() => answers.size === 2);

    for (const bytes of frames(stream.id)) ends.toRelay(bytes);
    await until(() => hit.closes === 1);
    expect(stream.closed).toBe(true);
    // The computer hears that its stream is over.
    await until(() => told.includes(stream.id));

    answers.get(spared.stream.id)?.();
    await until(() => spared.ended);
    expect([spared.status, Buffer.concat(spared.body).toString(), spared.closes]).toEqual([200, "fine", 0]);
    expect(hit.closes).toBe(1);
  });

  it("a close that says too much, or nonsense: the stream is closed all the same, without the nonsense", async () => {
    const ends = await tunnel(() => ({ data: () => {}, close: () => {} }));
    const heard: [number | undefined, string | undefined][] = [];
    const farewells = [{ code: 1008, reason: "x".repeat(124) }, { code: "soon" }, { reason: 7 }, [1, 2], "bye", { code: 4001, reason: "A real one." }];
    for (const farewell of farewells) {
      const stream = ends.relay.open(REQUEST, { data: () => {}, close: (code, reason) => heard.push([code, reason]) });
      ends.toRelay(frame(CLOSE, stream.id, farewell));
    }
    ends.toRelay(frame(CLOSE, ends.relay.open(REQUEST, { data: () => {}, close: (code, reason) => heard.push([code, reason]) }).id));
    await until(() => heard.length === farewells.length + 1);
    expect(heard).toEqual([...Array.from({ length: 5 }, () => [undefined, undefined]), [4001, "A real one."], [undefined, undefined]]);
    expect(ends.relay.size).toBe(0);
  });
});

describe("the computer's end, sent a frame that is not what it should be", () => {
  const notRequests: [what: string, payload: string | object][] = [
    ["a request without headers", { kind: "ws", method: "GET", path: "/v1/events", client: "c" }],
    ["a request whose headers are not pairs", { ...REQUEST, headers: [["a"], "b"] }],
    ["a request with a header that breaks the line", { ...REQUEST, headers: [["X-A", "b\nc"]] }],
    ["a request of no known kind", { ...REQUEST, kind: "smtp" }],
    ["a request with a method that is not one", { ...REQUEST, method: "GET /\r\n" }],
    ["a request with a path that is not one", { ...REQUEST, path: "v1/hello" }],
    ["a request from nobody", { ...REQUEST, client: undefined }],
    ["a request that is not JSON", "{kind"],
    ["a request that is nothing", "null"],
    ["a request that is a list", [1, 2, 3]],
  ];

  it.each(notRequests)("%s: is never served, and the relay is told at once", async (_what, payload) => {
    let served = 0;
    const ends = await tunnel((stream, request) => {
      served++;
      return echo(stream, request);
    });
    // The relay's own end opens a stream, so that it hears the answer; the computer is sent this instead of its request.
    const refused: Buffer[] = [];
    ends.sockets.relay.on("message", (data) => refused.push(data as Buffer));
    ends.toComputer(frame(OPEN, 77, payload));
    await until(() => refused.length === 1);
    expect(refused[0]?.equals(frame(CLOSE, 77))).toBe(true);
    expect(served).toBe(0);
    // And the tunnel is as good as before.
    expect((await ask(ends.relay, Buffer.from("still here"))).toString()).toBe("still here");
  });

  it("an answer, more than the window allows, a second end: each ends that stream, and only that one", async () => {
    const closed: number[] = [];
    const ends = await tunnel((stream) => ({ data: () => {}, end: () => {}, close: () => closed.push(stream.id) }));
    const sent: Buffer[] = [];
    ends.sockets.relay.on("message", (data) => sent.push(data as Buffer));
    for (const id of [1, 2, 3, 4]) ends.toComputer(frame(OPEN, id, REQUEST));

    ends.toComputer(frame(HEAD, 1, { status: 200, headers: [] }));
    for (let bytes = 0; bytes <= WINDOW_BYTES; bytes += 64 * 1024) ends.toComputer(frame(DATA, 2, Buffer.alloc(64 * 1024)));
    ends.toComputer(frame(END, 3));
    ends.toComputer(frame(END, 3));
    await until(() => closed.length === 3);
    expect(closed).toEqual([1, 2, 3]);
    // The relay was told about each, and stream 4 is none the worse.
    expect(sent.filter((bytes) => bytes.readUInt8(0) === CLOSE).map((bytes) => bytes.readUInt32BE(1))).toEqual([1, 2, 3]);
    ends.toComputer(frame(CLOSE, 4));
    await until(() => closed.includes(4));
  });

  it("no more streams than a tunnel carries", async () => {
    let served = 0;
    const ends = await tunnel(() => {
      served++;
      return { data: () => {}, close: () => {} };
    });
    const refused: number[] = [];
    ends.sockets.relay.on("message", (data) => refused.push((data as Buffer).readUInt32BE(1)));
    for (let id = 1; id <= 300; id++) ends.toComputer(frame(OPEN, id, REQUEST));
    await until(() => refused.length === 44);
    expect(served).toBe(256);
    expect(refused).toEqual(Array.from({ length: 44 }, (_, index) => 257 + index));
  });
});

describe("a reader that throws", () => {
  it("loses its own stream, whatever it was doing; the others never notice", async () => {
    const closed: string[] = [];
    const ends = await tunnel((stream, request) => {
      if (request.path === "/accept") throw new Error("The computer could not even look at this request.");
      return {
        data: () => {
          throw new Error("The computer choked on these bytes.");
        },
        end: () => {},
        close: () => {
          closed.push(request.path);
          throw new Error("And again on hearing that it is over.");
        },
      };
    });
    const refused = open(ends.relay, { ...REQUEST, path: "/accept" });
    const choked = open(ends.relay, { ...REQUEST, path: "/data" });
    const fine = open(ends.relay, { ...REQUEST, path: "/fine" });
    await choked.stream.write(Buffer.from("bytes"));
    await until(() => refused.closes === 1 && choked.closes === 1);
    expect(closed).toEqual(["/data"]);
    expect([fine.closes, ends.relay.size]).toEqual([0, 1]);

    // The relay's reader throws as well, on the answer and on the close: same outcome at its end.
    const told: number[] = [];
    const angry = ends.relay.open({ ...REQUEST, path: "/angry" }, {
      head: () => {
        throw new Error("The relay could not write this answer.");
      },
      data: () => {},
      close: () => {
        told.push(angry.id);
        throw new Error("Nor take the news.");
      },
    });
    ends.toRelay(frame(HEAD, angry.id, { status: 200, headers: [] }));
    await until(() => told.length === 1);
    expect([angry.closed, fine.closes]).toEqual([true, 0]);

    // When the socket goes, every reader hears it, even after one of them has thrown.
    ends.sockets.computer.terminate();
    await until(() => fine.closes === 1 && ends.closed());
    expect(closed.sort()).toEqual(["/angry", "/data", "/fine"]);
  });
});

describe("an end that stops reading", () => {
  it("is not waited for with more and more to send: the tunnel is dropped", async () => {
    const streams: Stream[] = [];
    const ends = await tunnel((stream) => {
      streams.push(stream);
      return { data: () => {}, close: () => {} };
    });
    const waiting = open(ends.relay);
    await until(() => streams.length === 1);
    ends.sockets.relay.pause();
    // Answers are not held back by a stream's window: only the socket can say that nobody is taking them.
    // More than every stream's window together could ever hold.
    const headers: [string, string][] = [["X-Filler", "x".repeat(2 * 1024 * 1024)]];
    for (let sent = 0; sent < 100 && !ends.closed(); sent++) {
      streams[0]?.head({ status: 200, headers });
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await until(() => ends.closed());
    ends.sockets.relay.resume();
    await until(() => waiting.closes === 1);
  });
});

describe("thousands of frames of every kind, well and badly formed, at both ends at once", () => {
  it.each([1, 2, 3, 4, 5])("nothing throws, and a stream nobody aimed at carries on (seed %i)", async (seed) => {
    const next = numbers(seed);
    const ends = await tunnel(echo);
    // The stream that must come through: opened first, half of its request sent before the storm.
    const body = randomBytes(300_000);
    const spared = open(ends.relay);
    await spared.stream.write(body.subarray(0, 150_000));
    // Streams the storm is aimed at, along with ids nobody opened.
    const targets = Array.from({ length: 8 }, () => open(ends.relay));
    const ids = [...targets.map((target) => target.stream.id), ...Array.from({ length: 30 }, (_, index) => 1000 + index), 0, 0xffffffff];
    expect(ids).not.toContain(spared.stream.id);

    for (let sent = 0; sent < 3000; sent++) {
      ends.toRelay(anyFrame(next, ids));
      ends.toComputer(anyFrame(next, ids));
      // Let the sockets take what was sent: the storm is in the frames, not in how many of them wait.
      if (sent % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    // Frames arrive in the order they were sent: once this answer is back, the storm has passed at both ends.
    await spared.stream.write(body.subarray(150_000));
    spared.stream.end();
    await until(() => spared.ended || spared.closes > 0, 10_000);
    expect([spared.status, spared.closes, Buffer.concat(spared.body).equals(body)]).toEqual([200, 0, true]);
    // A stream is told that it is over once at most.
    expect(targets.every((target) => target.closes <= 1)).toBe(true);
    // And the tunnel still does its work for whoever comes next.
    expect((await ask(ends.relay, Buffer.from("after the storm"))).toString()).toBe("after the storm");
    expect([ends.sockets.relay.readyState, ends.sockets.computer.readyState, ends.closed()]).toEqual([WebSocket.OPEN, WebSocket.OPEN, false]);
  }, 30_000);
});
