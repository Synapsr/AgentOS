/** What the tests share: a relay to start, computers to connect to it — well-behaved or not — and frames written by hand. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { WebSocket } from "ws";
import { type RelayOptions, type RunningRelay, type Stream, type StreamEvents, type StreamRequest, Tunnel, WINDOW_BYTES, startRelay } from "../src/index.js";

export const NODE = "node_0123456789abcdef";
export const SECRET = "s".repeat(43);
/** The token of the private relay most tests run. */
export const TOKEN = "the-relay-token-of-these-tests-0123456789";

// Anything that gets past the relay or a tunnel ends up here. Nothing may.
const thrown: unknown[] = [];
process.on("uncaughtException", (error) => thrown.push(error));
process.on("unhandledRejection", (error) => thrown.push(error));

export let relay: RunningRelay;
export let dataDir: string;
/** Closed after each test. */
export const sockets: { terminate(): void }[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await relay?.close();
  expect(thrown.splice(0)).toEqual([]);
});

/** Starts a relay — private, with `TOKEN`, unless told otherwise — and gives its address. */
export async function start(options: Partial<RelayOptions> = {}): Promise<string> {
  dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "agentos-relay-test-"));
  relay = await startRelay({ port: 0, host: "127.0.0.1", token: options.open ? undefined : TOKEN, ...options, dataDir });
  return `http://127.0.0.1:${relay.port}`;
}

export type Serve = (stream: Stream, request: StreamRequest) => StreamEvents;
/** How a stand-in computer presents itself. `from` is the address a proxy in front of the relay would report for it. */
export interface Identity {
  node?: string;
  secret?: string;
  token?: string;
  from?: string;
}

function connect({ node = NODE, secret = SECRET, token = TOKEN, from }: Identity): WebSocket {
  const headers = { Authorization: `Bearer ${secret}`, ...(token ? { "X-Relay-Token": token } : {}), ...(from ? { "X-Forwarded-For": from } : {}) };
  const socket = new WebSocket(`ws://127.0.0.1:${relay.port}/v1/tunnel?node=${node}`, { headers });
  sockets.push(socket);
  socket.on("error", () => {});
  return socket;
}

/** Connects a stand-in computer. Resolves with its socket, or with the HTTP status the relay refused it with. */
export function computer(serve: Serve, identity: Identity = {}): Promise<WebSocket | number> {
  const socket = connect(identity);
  return new Promise((resolve) => {
    socket.on("open", () => {
      new Tunnel(socket, serve);
      resolve(socket);
    });
    socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
  });
}

/**
 * Connects a computer that writes its frames by hand, so that it can write
 * them wrongly. `serve` is told of each stream the relay opens, with a way
 * to send frames on the socket.
 */
export function rogue(serve: (id: number, request: StreamRequest, send: (...frames: Buffer[]) => void) => void, identity: Identity = {}): Promise<WebSocket> {
  const socket = connect(identity);
  const send = (...frames: Buffer[]): void => frames.forEach((bytes) => socket.send(bytes));
  socket.on("message", (data) => {
    const bytes = data as Buffer;
    if (bytes.readUInt8(0) === OPEN) serve(bytes.readUInt32BE(1), JSON.parse(bytes.subarray(5).toString()) as StreamRequest, send);
  });
  return new Promise((resolve) => socket.on("open", () => resolve(socket)));
}

/** A computer that answers every HTTP request with what it was asked, once the whole body has arrived. */
export const echo: Serve = (stream, request) => {
  const body: Buffer[] = [];
  return {
    data: (bytes, _text, passedOn) => {
      body.push(bytes);
      passedOn();
    },
    end: () => {
      const received = Buffer.concat(body);
      const said = { method: request.method, path: request.path, client: request.client, headers: Object.fromEntries(request.headers), bytes: received.length, sha: sha(received) };
      stream.head({ status: 200, headers: [["Content-Type", "application/json"], ["X-Computer", "yes"], ["Connection", "close"]] });
      void stream.write(Buffer.from(JSON.stringify(said))).then(() => stream.end());
    },
    close: () => {},
  };
};

export const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
/** The JSON body of an answer, loosely typed: tests look inside it. */
export const json = (response: Response): Promise<any> => response.json();
export const until = async (condition: () => boolean, ms = 3000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("It did not happen in time.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

// ───────────────────────────── Frames, by hand ─────────────────────────────

export const [OPEN, HEAD, DATA, TEXT, END, CLOSE, WINDOW] = [1, 2, 3, 4, 5, 6, 7] as const;

/** One frame, as either end puts it on the socket. An object goes as JSON. */
export function frame(type: number, id: number, payload: string | Uint8Array | object = ""): Buffer {
  const body = typeof payload === "string" || payload instanceof Uint8Array ? Buffer.from(payload) : Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(5);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(id, 1);
  return Buffer.concat([header, body]);
}

export function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value, 0);
  return bytes;
}

export const REQUEST: StreamRequest = { kind: "http", method: "POST", path: "/v1/echo", headers: [["Content-Type", "text/plain"]], client: "203.0.113.9" };

/** Numbers below `below`, the same ones for the same seed: a failure can be seen again. */
export function numbers(seed: number): (below: number) => number {
  let state = seed;
  return (below) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * below);
  };
}

/** What a frame may claim to say: requests, answers and farewells, sound ones and every way of getting them wrong. */
const SAYINGS: unknown[] = [
  REQUEST,
  { ...REQUEST, kind: "ws", method: "GET" },
  { ...REQUEST, headers: undefined },
  { ...REQUEST, headers: [["a", 1]] },
  { ...REQUEST, path: 5 },
  { kind: "ws" },
  { status: 200, headers: [] },
  { status: 101, headers: [] },
  { status: 204, headers: [["Content-Type", "text/plain"]] },
  { status: 401, headers: [["Content-Type", "application/json"], ["Content-Length", "3"]] },
  { status: 99, headers: [] },
  { status: 200 },
  { status: 1e9, headers: [] },
  { status: 200.5, headers: [] },
  { status: 200, headers: [["Set-Cookie", "a=b"], ["Bad\r\nName", "x"]] },
  { status: 200, headers: { length: 1 } },
  { code: 1000, reason: "done" },
  { code: 1006, reason: "x".repeat(4000) },
  { code: -1, reason: null },
  { constructor: { prototype: 1 } },
  null,
  true,
  0,
  "text",
  [],
  [[[[[[[[]]]]]]]],
];

/** A frame of any kind for one of `ids`, with any payload — sometimes not even a whole frame. */
export function anyFrame(next: (below: number) => number, ids: number[]): Buffer {
  const payloads: (() => Buffer | string)[] = [
    () => "",
    () => randomBytes(next(300)),
    () => Buffer.alloc(next(3) * 20_000),
    () => uint32([0, 1, 1000, WINDOW_BYTES, 0xffffffff][next(5)] ?? 0),
    () => JSON.stringify(SAYINGS[next(SAYINGS.length)]),
    () => JSON.stringify(SAYINGS[next(SAYINGS.length)]).slice(0, next(40)),
    () => "[".repeat(next(20_000)),
    () => "[".repeat(2000) + "]".repeat(2000),
  ];
  const bytes = frame(next(10), ids[next(ids.length)] ?? 0, payloads[next(payloads.length)]?.() ?? "");
  return next(50) === 0 ? bytes.subarray(0, next(5)) : bytes;
}
