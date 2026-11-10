/**
 * The relay: a small server a computer connects out to, so that its owner's
 * devices can reach it from anywhere.
 *
 *   computer ──(one WebSocket: WS /v1/tunnel?node=<id>)──▶ relay ◀── clients: /n/<id>/…
 *
 * It is a pipe. Whatever arrives under `/n/<id>/` — HTTP requests, WebSocket
 * connections — is passed to that computer with the prefix removed, and the
 * answer is passed back (see tunnel.ts for how they share the one socket).
 * It keeps nothing but one line per computer: a hash of the secret that
 * computer first came with, so that nobody else can take its place.
 *
 * To a browser, every computer on a relay is the same site: the relay's. So
 * a relay is either private — a token says whose computers may use it, and
 * they may show their web app through it — or open to any computer, and then
 * it passes on the API only, never a page. Either way it holds back the
 * headers of an answer that would reach past that answer, into the site.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type AddressInfo, isIP } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { MAX_STREAMS, PING_MS, type Stream, type StreamResponse, Tunnel } from "./tunnel.js";

export interface RelayOptions {
  /** Port to listen on; 0 picks a free one. */
  port: number;
  /** Interface to listen on. Default: all of them. */
  host?: string;
  /** Folder for the one file the relay keeps. */
  dataDir: string;
  /** Only computers that present this token may connect: a private relay. This, or `open`. */
  token?: string;
  /** Any computer may connect, without a token: a relay open to everyone, which passes on the API only. */
  open?: boolean;
  /** Believe `X-Forwarded-For`: set it when a reverse proxy (Caddy, nginx) is in front, and only then. */
  trustProxy?: boolean;
}

export interface RunningRelay {
  port: number;
  close(): Promise<void>;
}

/** Connections one address may have to one computer at once, so that no one alone takes all of a computer's streams. */
const MAX_STREAMS_PER_CLIENT = 64;
/** Largest request body passed on. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** An HTTP exchange in which nothing has moved for this long is given up. */
const HTTP_IDLE_MS = 120_000;
/** Largest frame accepted on a socket. */
const MAX_MESSAGE_BYTES = 1024 * 1024;
/** A token shorter than this keeps nobody out. */
const MIN_TOKEN_LENGTH = 32;
/** Computers remembered. A relay open to everyone must not fill its disk. */
const MAX_COMPUTERS = 10_000;
/** New computers one address may register per hour. */
const NEW_COMPUTERS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
/** A computer that has not connected for this long is forgotten: its id is free again. */
const FORGOTTEN_AFTER_MS = 90 * 24 * HOUR_MS;
/** WebSocket close code: another connection took this one's place. */
const REPLACED = 4000;

/** Headers that belong to one hop of a connection, not to the message. */
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);
/**
 * Headers held back from a computer's answer, because they reach past it:
 * into what a browser keeps for the whole site — cookies, service workers,
 * stored data, where it reports to, how it connects — or into a proxy in
 * front of the relay. The body's length goes too: the relay frames the body
 * itself, so a wrong count cannot run over into the next answer on a
 * connection that a proxy uses again.
 */
const HELD_BACK = new Set([
  "set-cookie",
  "set-cookie2",
  "service-worker-allowed",
  "clear-site-data",
  "strict-transport-security",
  "alt-svc",
  "nel",
  "report-to",
  "reporting-endpoints",
  "x-accel-redirect",
  "x-sendfile",
  "content-length",
]);
/** Set on every answer: its content is what its type says, never what a browser would guess. */
const AS_TYPED: [string, string] = ["x-content-type-options", "nosniff"];
/** Set on the API's answers. They are data: opened as a page, one runs nothing and belongs to no site. */
const NOT_A_PAGE: [string, string] = ["content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox"];

type ErrorCode = "unauthorized" | "forbidden" | "not_found" | "invalid" | "rate_limited" | "unavailable";
const STATUS: Record<ErrorCode, number> = { unauthorized: 401, forbidden: 403, not_found: 404, invalid: 400, rate_limited: 429, unavailable: 502 };
/** Why a client is turned away. */
type Refusal = [code: ErrorCode, message: string];

const LOST = "The connection to this computer was lost.";
const NO_WEB_APP = {
  en: "The web version of AgentOS is not available through a public relay. Use the AgentOS app, or a relay of your own.",
  fr: "La version web d'AgentOS n'est pas disponible via un relais public. Utilise l'app AgentOS, ou ton propre relais.",
};

/** Starts a relay. Rejects when it is neither private nor open, when its file cannot be kept, or when the port is taken. */
export async function startRelay(options: RelayOptions): Promise<RunningRelay> {
  checkAccess(options);
  /** Computers connected right now. */
  const tunnels = new Map<string, Tunnel>();
  const known = new Registry(join(options.dataDir, "computers.json"), (node) => tunnels.has(node));
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakSet<WebSocket>();
  /** New computers each network has registered this hour. */
  const newcomers = new Map<string, number>();
  /** Connections each network has to each computer right now. */
  const seats = new Map<string, number>();

  const clientAddress = (request: IncomingMessage): string => {
    const forwarded = options.trustProxy ? String(request.headers["x-forwarded-for"] ?? "").split(",").at(-1)?.trim() : "";
    return forwarded || request.socket.remoteAddress || "";
  };

  // ───────────────────────────── Clients ─────────────────────────────

  function onRequest(request: IncomingMessage, response: ServerResponse): void {
    const url = addressOf(request);
    if (!url) return refuse(response, "invalid", "That is not an address.");
    if (url.pathname === "/healthz") return void response.writeHead(200, { "Content-Type": "text/plain" }).end("ok\n");
    if (url.pathname === "/") {
      const line = "This is an AgentOS relay: it passes connections on to the computers that connected to it, and keeps nothing.\n";
      return void response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(line);
    }
    const target = route(url);
    if (!target) return refuse(response, "not_found", "There is nothing here.");
    if (options.open && !isApi(target.path)) return void response.writeHead(403, { "Content-Type": "text/html; charset=utf-8" }).end(noWebAppPage(request));
    // The app links its files relatively: its address must end with a slash.
    if (target.path === "") return void response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
    const tunnel = reach(target.node, request, response);
    if (tunnel instanceof Tunnel) forward(request, response, tunnel, target.path);
    else refuse(response, ...tunnel);
  }

  /**
   * The tunnel to a computer, with a seat on it for one more connection from
   * this client: the seat is given back when `connection` closes. Or why
   * there is none: the computer is not there, or the seats are taken.
   */
  function reach(node: string, request: IncomingMessage, connection: { once(event: "close", listener: () => void): unknown }): Tunnel | Refusal {
    const tunnel = tunnels.get(node);
    if (!tunnel) return ["unavailable", "This computer is not connected to the relay right now."];
    if (tunnel.size >= MAX_STREAMS) return ["unavailable", "This computer has too many connections open right now."];
    const seat = `${node} ${network(clientAddress(request))}`;
    const taken = seats.get(seat) ?? 0;
    if (taken >= MAX_STREAMS_PER_CLIENT) return ["rate_limited", "Too many connections to this computer from this address."];
    seats.set(seat, taken + 1);
    connection.once("close", () => {
      const left = (seats.get(seat) ?? 1) - 1;
      if (left > 0) seats.set(seat, left);
      else seats.delete(seat);
    });
    return tunnel;
  }

  function forward(request: IncomingMessage, response: ServerResponse, tunnel: Tunnel, path: string): void {
    let idle: NodeJS.Timeout;
    /** Ends the exchange from our side: an error if nothing was answered yet, a cut connection otherwise. */
    const giveUp = (code: ErrorCode, message: string, status?: number): void => {
      clearTimeout(idle);
      stream.close();
      if (!response.headersSent) refuse(response, code, message, status);
      else if (!response.writableEnded) response.destroy();
    };
    const moved = (): void => {
      clearTimeout(idle);
      idle = setTimeout(() => giveUp("unavailable", "This computer took too long to answer.", 504), HTTP_IDLE_MS);
    };
    const stream = tunnel.open(
      { kind: "http", method: request.method ?? "GET", path, headers: messageHeaders(request), client: clientAddress(request) },
      {
        head: ({ status, headers }) => {
          // 101 opens a WebSocket, and nobody asked for one here.
          if (status === 101) return giveUp("unavailable", LOST);
          response.writeHead(status, answerHeaders(headers, path).flat());
          // Sent at once: a stream of audio starts playing while the rest is still being made.
          response.flushHeaders();
        },
        data: (bytes, _text, passedOn) => {
          moved();
          response.write(bytes, passedOn);
        },
        end: () => {
          clearTimeout(idle);
          response.end();
          stream.close();
        },
        close: () => giveUp("unavailable", LOST),
      },
    );
    moved();
    // The client gave up, or everything was sent: either way the stream is done.
    response.on("close", () => {
      clearTimeout(idle);
      stream.close();
    });
    void sendBody(request, stream, moved).then((tooLarge) => {
      if (tooLarge) giveUp("invalid", "That is too much data.", 413);
    });
  }

  /** Passes a request's body on, as fast as the computer takes it. Resolves true when it was too large to pass. */
  async function sendBody(request: IncomingMessage, stream: Stream, moved: () => void): Promise<boolean> {
    let size = 0;
    try {
      for await (const chunk of request) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) return true;
        moved();
        if (!(await stream.write(chunk as Buffer))) return false;
      }
      stream.end();
    } catch {
      // The client went away mid-request.
      stream.close();
    }
    return false;
  }

  // ───────────────────────────── WebSockets: clients, and computers ─────────────────────────────

  function onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    // Node stops listening to a connection it hands over: without this, a client that resets its own would stop the relay.
    socket.on("error", () => socket.destroy());
    const url = addressOf(request);
    if (url?.pathname === "/v1/tunnel") return register(request, socket, head, url);
    const target = url && route(url);
    if (!target) return refuseUpgrade(socket, "not_found", "There is nothing here.");
    if (options.open && !isApi(target.path)) return refuseUpgrade(socket, "forbidden", NO_WEB_APP.en);
    const tunnel = reach(target.node, request, socket);
    if (!(tunnel instanceof Tunnel)) return refuseUpgrade(socket, ...tunnel);

    let client: WebSocket | null = null;
    let refusal: { response: StreamResponse; body: Buffer[] } | null = null;
    const stream = tunnel.open(
      { kind: "ws", method: "GET", path: target.path, headers: messageHeaders(request), client: clientAddress(request) },
      {
        head: (response) => {
          if (response.status !== 101) return void (refusal = { response, body: [] });
          sockets.handleUpgrade(request, socket, head, (accepted) => {
            // From here on the WebSocket itself says when the client leaves, and why.
            socket.off("close", abandon);
            client = accepted;
            watch(accepted);
            accepted.on("message", (data, isBinary) => {
              // A message the computer has no room for: this client sends faster than it is read.
              if (!stream.message(isBinary ? (data as Buffer) : data.toString())) accepted.close(1013, "Slow down.");
            });
            accepted.on("close", (code, reason) => stream.close(code, reason.toString()));
          });
        },
        data: (bytes, text, passedOn) => {
          if (client) return client.send(text ? bytes.toString() : bytes, passedOn);
          // Not a WebSocket: the body of the computer's refusal. It is never said to be passed on,
          // so a refusal is a window long at most — a few words need far less.
          refusal?.body.push(bytes);
        },
        end: () => {
          if (!refusal) return;
          writeResponse(socket, refusal.response.status, answerHeaders(refusal.response.headers, target.path), Buffer.concat(refusal.body));
          stream.close();
        },
        close: (code, reason) => {
          if (client) client.close(validCloseCode(code), reason);
          else if (!socket.destroyed) refuseUpgrade(socket, "unavailable", LOST);
        },
      },
    );
    // Until it is a WebSocket, a client that hangs up is only noticed on the raw connection.
    const abandon = (): void => stream.close();
    socket.on("close", abandon);
  }

  /** A computer asks to be reachable here. */
  function register(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const node = url.searchParams.get("node") ?? "";
    const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1] ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(node) || secret.length < 32) {
      return refuseUpgrade(socket, "invalid", "A computer connects with its id and its secret.");
    }
    if (options.token && !sameSecret(String(request.headers["x-relay-token"] ?? ""), options.token)) {
      return refuseUpgrade(socket, "unauthorized", "This relay is private: it needs its token.");
    }
    const verdict = known.admit(node, secret, () => allowNewcomer(network(clientAddress(request))));
    if (verdict !== "ok") {
      const message = verdict === "forbidden" ? "Another computer already uses this id on this relay." : "This relay is not taking new computers from this address right now. Try again later.";
      return refuseUpgrade(socket, verdict, message);
    }
    sockets.handleUpgrade(request, socket, head, (computer) => {
      // The newest connection is the computer's; an older one is a ghost of it.
      tunnels.get(node)?.close(REPLACED, "Connected again from elsewhere.");
      const tunnel = new Tunnel(computer, undefined, () => {
        if (tunnels.get(node) === tunnel) tunnels.delete(node);
      });
      tunnels.set(node, tunnel);
      watch(computer);
    });
  }

  function allowNewcomer(from: string): boolean {
    const count = newcomers.get(from) ?? 0;
    if (count >= NEW_COMPUTERS_PER_HOUR) return false;
    newcomers.set(from, count + 1);
    return true;
  }

  /** Keeps an eye on a socket: one that stops answering pings is closed. */
  function watch(socket: WebSocket): void {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    socket.on("error", () => socket.terminate());
  }

  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, PING_MS);
  const upkeep = setInterval(() => {
    newcomers.clear();
    known.tidy();
  }, HOUR_MS);
  const stopTimers = (): void => {
    clearInterval(heartbeat);
    clearInterval(upkeep);
  };

  const server: Server = createServer(onRequest);
  server.on("upgrade", onUpgrade);
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => {
      stopTimers();
      reject(error);
    };
    server.once("error", failed);
    server.listen(options.port, options.host, () => {
      server.off("error", failed);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        stopTimers();
        known.tidy();
        for (const socket of sockets.clients) socket.terminate();
        sockets.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** A relay says whether it is private or open: nobody runs an open one by leaving a setting out. */
function checkAccess({ token, open }: RelayOptions): void {
  if (token && open) throw new Error("RELAY_TOKEN and RELAY_OPEN are both set. A relay is either private, with a token, or open to everyone: choose one.");
  if (token && token.length < MIN_TOKEN_LENGTH) throw new Error("RELAY_TOKEN is too short to keep anyone out. Make a real one: openssl rand -hex 32");
  if (!token && !open) {
    throw new Error(
      "This relay has no token, so it does not start: anyone could use it.\n" +
        "Give it one, and give the same one to your computers:  RELAY_TOKEN=$(openssl rand -hex 32)\n" +
        "To run a relay open to everyone on purpose, set RELAY_OPEN=1 instead.",
    );
  }
}

/** The address a request names. Null when it is not one. */
function addressOf(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? "/", "http://relay");
  } catch {
    return null;
  }
}

/** The computer a client's address names, and the path meant for it: `/n/<id>/v1/hello?x` → `<id>`, `/v1/hello?x`. */
function route(url: URL): { node: string; path: string } | null {
  const match = /^\/n\/([A-Za-z0-9_-]{1,64})(\/.*)?$/.exec(url.pathname);
  if (!match) return null;
  return { node: match[1] ?? "", path: match[2] ? match[2] + url.search : "" };
}

/** Whether a computer's path is in its API: `/v1/…`. Everything else is its web app. */
function isApi(path: string): boolean {
  return /^\/v1(\/|\?|$)/.test(path);
}

/**
 * Who an address counts as, where there is a limit per address. An IPv4
 * address is itself. An IPv6 one is its /64: whoever has one address there
 * has all of them.
 */
function network(address: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (v4 || isIP(address) !== 6) return v4 ?? address;
  const [head = "", tail = ""] = address.split("::");
  const before = head.split(":").filter(Boolean);
  const after = tail.split(":").filter(Boolean);
  // `::` stands for as many zeros as it takes to make eight groups.
  const zeros = address.includes("::") ? Math.max(0, 8 - before.length - after.length) : 0;
  const groups = [...before, ...Array<string>(zeros).fill("0"), ...after];
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
}

/**
 * A request's own headers, as pairs: everything but what belongs to this hop.
 * Cookies stay too: they are for the relay's address, and no business of a computer behind it.
 */
function messageHeaders(request: IncomingMessage): [string, string][] {
  const headers: [string, string][] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index] ?? "";
    if (!HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== "cookie") headers.push([name, request.rawHeaders[index + 1] ?? ""]);
  }
  return headers;
}

/** A computer's answer headers, as the relay passes them on: its own guards in, what reaches past the answer out. */
function answerHeaders(headers: [string, string][], path: string): [string, string][] {
  const guards = isApi(path) ? [AS_TYPED, NOT_A_PAGE] : [AS_TYPED];
  const dropped = (name: string): boolean => HOP_HEADERS.has(name) || HELD_BACK.has(name) || guards.some(([guard]) => guard === name);
  return [...headers.filter(([name]) => !dropped(name.toLowerCase())), ...guards];
}

/** What a relay open to everyone answers where a computer's web app would be, in the reader's language. */
function noWebAppPage(request: IncomingMessage): string {
  const line = /^fr\b/i.test(request.headers["accept-language"] ?? "") ? NO_WEB_APP.fr : NO_WEB_APP.en;
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentOS</title>
<body style="margin:0;min-height:100vh;display:grid;place-content:center;padding:24px;box-sizing:border-box;background:#000;color:#F5F5F7;font:300 20px system-ui,sans-serif;text-align:center">${line}</body>
`;
}

function refuse(response: ServerResponse, code: ErrorCode, message: string, status = STATUS[code]): void {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code, message } }));
}

function refuseUpgrade(socket: Duplex, code: ErrorCode, message: string): void {
  writeResponse(socket, STATUS[code], [["Content-Type", "application/json"]], Buffer.from(JSON.stringify({ error: { code, message } })));
}

/** Answers an upgrade request with a plain HTTP response instead of a WebSocket, and hangs up. */
function writeResponse(socket: Duplex, status: number, headers: [string, string][], body: Buffer): void {
  const lines = [`HTTP/1.1 ${status} Refused`, ...headers.map(([name, value]) => `${name}: ${value}`), `Content-Length: ${body.length}`, "Connection: close"];
  socket.end(Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "latin1"), body]), () => socket.destroy());
}

/** A close code a WebSocket may be closed with: ours and the application's pass, reserved ones do not. */
function validCloseCode(code: number | undefined): number {
  if (code === undefined) return 1001;
  return code === 1000 || (code >= 1007 && code <= 1014 && code !== 1010) || (code >= 3000 && code <= 4999) ? code : 1000;
}

function sameSecret(a: string, b: string): boolean {
  const digest = (secret: string): Buffer => createHash("sha256").update(secret).digest();
  return timingSafeEqual(digest(a), digest(b));
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** A computer's place on the relay: the hash of the secret it first came with, and the last day it was here. */
interface Place {
  secret: string;
  seen: string;
}

/**
 * The computers this relay knows. Whoever comes first owns an id; afterwards
 * only the same secret does — until that computer has stayed away for
 * `FORGOTTEN_AFTER_MS`, when its id is free again.
 *
 * They are kept in one file that its operator can read:
 *
 *   { "<id>": { "secret": "<sha256 of the computer's secret>", "seen": "2026-11-10" } }
 *
 * To free an id by hand: stop the relay, take its entry out, start the relay.
 */
class Registry {
  private readonly places = new Map<string, Place>();
  private unsaved = false;

  /** @param connected Whether a computer is connected right now. One that is, is here today, however long ago it came. */
  constructor(
    private readonly path: string,
    private readonly connected: (node: string) => boolean,
  ) {
    for (const [node, kept] of Object.entries(existsSync(path) ? read(path) : {})) {
      // A relay from before places could be lost kept the hash alone.
      const { secret, seen } = typeof kept === "string" ? { secret: kept, seen: undefined } : ((kept ?? {}) as Partial<Place>);
      this.places.set(node, { secret: String(secret), seen: typeof seen === "string" ? seen : today() });
    }
    // Found out now rather than when the first computer comes.
    if (!this.save()) throw new Error(`The relay cannot write ${path}: give it a folder it may write in (RELAY_DATA).`);
  }

  /** Lets a computer in. A new one takes its place, if `mayJoin` agrees and there is room. */
  admit(node: string, secret: string, mayJoin: () => boolean): "ok" | "forbidden" | "rate_limited" {
    const hash = createHash("sha256").update(secret).digest("hex");
    const place = this.places.get(node);
    if (place && !this.gone(node, place)) {
      if (!sameSecret(place.secret, hash)) return "forbidden";
      this.see(place);
      return "ok";
    }
    if ((!place && this.places.size >= MAX_COMPUTERS) || !mayJoin()) return "rate_limited";
    this.places.set(node, { secret: hash, seen: today() });
    if (this.save()) return "ok";
    // Nowhere to remember it: better no place than one that the next restart gives to someone else.
    this.places.delete(node);
    return "rate_limited";
  }

  /** Notes who is here today, forgets who has stayed away too long, and writes down what changed. */
  tidy(): void {
    for (const [node, place] of this.places) {
      if (this.connected(node)) this.see(place);
      else if (this.gone(node, place)) {
        this.places.delete(node);
        this.unsaved = true;
      }
    }
    if (this.unsaved) this.save();
  }

  private gone(node: string, place: Place): boolean {
    return !this.connected(node) && Date.parse(place.seen) < Date.now() - FORGOTTEN_AFTER_MS;
  }

  private see(place: Place): void {
    if (place.seen === today()) return;
    place.seen = today();
    this.unsaved = true;
  }

  /** Writes the file. False when it cannot be written: a full disk must not stop the relay. */
  private save(): boolean {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, `${JSON.stringify(Object.fromEntries(this.places), null, 2)}\n`, { mode: 0o600 });
      renameSync(`${this.path}.tmp`, this.path);
      this.unsaved = false;
      return true;
    } catch {
      return false;
    }
  }
}

/** The registry's file, as it was written. */
function read(path: string): Record<string, unknown> {
  try {
    const kept: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof kept === "object" && kept !== null && !Array.isArray(kept)) return kept as Record<string, unknown>;
  } catch {
    // Not JSON at all: said below.
  }
  throw new Error(`The relay cannot read ${path}. Fix it, or remove it to start with no computers.`);
}
