/**
 * The computer's end of a relay: it connects out, stays connected, and
 * serves what comes through the tunnel as if it had come directly — the same
 * app, the same tokens — with one difference: nothing that arrives this way
 * is ever "the computer itself", whatever token it carries.
 */
import { PassThrough, Readable } from "node:stream";
import { PING_MS, SILENCE_MS, type Stream, type StreamEvents, type StreamRequest, Tunnel } from "@agentos/relay";
import { WebSocket } from "ws";
import type { Home } from "./config.js";
import { Failure, httpStatus } from "./errors.js";
import { translator } from "./i18n.js";
import { isLoopback } from "./net.js";

/** One end of a conversation in messages: an event stream, whatever carries it. */
export interface Channel {
  send(text: string): void;
  close(code: number, reason: string): void;
}

/** What a channel's owner is told. */
export interface Listener {
  receive(text: string): void;
  closed(): void;
}

/** How connections that come through the relay are served. */
export interface TunnelledApp {
  /** Answers an HTTP request from the client at `client`. */
  fetch(request: Request, client: string): Response | Promise<Response>;
  /** Lets a client into the event stream, or throws a `Failure`. Returns the way to start it on a channel. */
  admit(url: URL, authorization: string | undefined): (channel: Channel) => Listener;
}

export interface RelayState {
  /** The relay this computer is set to use, or null. */
  url: string | null;
  connected: boolean;
  /** Why it is not connected, in words for the owner. Null when connected, and when there is no relay. */
  error: string | null;
}

/** `https://` — or plain HTTP to this computer itself, where there is no network in between. */
function isEncrypted(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && isLoopback(hostname));
  } catch {
    // Not an address at all: `connect` says so in better words.
    return true;
  }
}

/**
 * Makes sure nothing a relay sends can take the core down. Whatever reading
 * one of its messages throws — a frame of the wrong shape, a request we
 * cannot make sense of — ends this connection, and we connect again.
 */
function contain(socket: WebSocket): void {
  const readers = socket.listeners("message");
  socket.removeAllListeners("message");
  socket.on("message", (...message) => {
    try {
      for (const read of readers) read.apply(socket, message);
    } catch {
      socket.terminate();
    }
  });
}

/** The largest message a relay may send down the tunnel. */
const MAX_FRAME_BYTES = 1024 * 1024;
const FIRST_RETRY_MS = 1000;
const LONGEST_RETRY_MS = 30_000;

/** What the relay's refusals mean, by HTTP status. */
const REFUSALS: Record<number, "relay.needsToken" | "relay.taken" | "relay.full"> = {
  401: "relay.needsToken",
  403: "relay.taken",
  429: "relay.full",
};
/** WebSocket close code the relay uses when a newer connection takes this computer's place. */
const REPLACED = 4000;

export class RelayClient {
  private app: TunnelledApp | null = null;
  private socket: WebSocket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private attempts = 0;
  /** The private relay's token the connection was last attempted with. */
  private token: string | null = null;
  private current: RelayState = { url: null, connected: false, error: null };

  /** @param onState Called whenever the connection comes, goes, or fails for a new reason. */
  constructor(
    private readonly home: Home,
    private readonly onState: (state: RelayState) => void = () => {},
  ) {}

  /** Says how to serve what comes through, and connects if a relay is configured. */
  serve(app: TunnelledApp): void {
    this.app = app;
    this.apply();
  }

  /**
   * Follows the configuration: connects to the relay it names, with the
   * token it holds, or lets go when it names none. Call it after a change.
   */
  apply(): void {
    const url = this.home.config.relayUrl?.replace(/\/+$/, "") || null;
    const token = this.home.relayToken;
    if (url === this.current.url && token === this.token && (this.socket || this.retry)) return;
    this.hangUp();
    this.token = token;
    this.attempts = 0;
    // The relay sees everything that passes: the way to it, at least, must not be readable by the networks in between.
    if (url && !isEncrypted(url)) {
      return this.report({ url, connected: false, error: translator(this.home.config.language)("relay.insecure") });
    }
    this.report({ url, connected: false, error: null });
    if (url) this.connect();
  }

  get state(): RelayState {
    return this.current;
  }

  /** Where clients reach this computer through the relay, while it is connected there. */
  get address(): string | null {
    const { url, connected } = this.current;
    return url && connected ? `${url}/n/${this.home.nodeId}` : null;
  }

  close(): void {
    this.hangUp();
    this.current = { url: null, connected: false, error: null };
  }

  private connect(): void {
    const { url } = this.current;
    if (!url || !this.app) return;
    const t = translator(this.home.config.language);
    const { token } = this;
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${url.replace(/^http/, "ws")}/v1/tunnel?node=${this.home.nodeId}`, {
        headers: { Authorization: `Bearer ${this.home.tunnelSecret}`, ...(token ? { "X-Relay-Token": token } : {}) },
        handshakeTimeout: 15_000,
        // A relay never sends a frame much above one window (256 KiB): anything far bigger is not a relay talking.
        maxPayload: MAX_FRAME_BYTES,
      });
    } catch {
      // Not an address at all: trying again would not make it one.
      return this.report({ url, connected: false, error: t("relay.badAddress") });
    }
    this.socket = socket;
    let trouble: string | null = null;
    let heard = Date.now();
    // The relay pings; a relay we no longer hear is one we are no longer connected to.
    const watchdog = setInterval(() => {
      if (Date.now() - heard > SILENCE_MS) socket.terminate();
    }, PING_MS);

    socket.on("open", () => {
      this.attempts = 0;
      heard = Date.now();
      new Tunnel(socket, (stream, request) => this.accept(stream, request));
      contain(socket);
      this.report({ url, connected: true, error: null });
    });
    socket.on("ping", () => (heard = Date.now()));
    socket.on("unexpected-response", (_request, response) => {
      trouble = t(REFUSALS[response.statusCode ?? 0] ?? "relay.refused");
      socket.terminate();
    });
    socket.on("error", () => (trouble ??= t("relay.unreachable")));
    socket.on("close", (code) => {
      clearInterval(watchdog);
      if (this.socket !== socket) return;
      this.socket = null;
      this.report({ url, connected: false, error: trouble ?? t(code === REPLACED ? "relay.replaced" : "relay.lost") });
      // Doubling each time, up to half a minute; a little randomness so a fleet does not knock all at once.
      const delay = Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** this.attempts++) * (0.75 + Math.random() / 2);
      this.retry = setTimeout(() => this.connect(), delay);
    });
  }

  private hangUp(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
  }

  private report(state: RelayState): void {
    const changed = state.url !== this.current.url || state.connected !== this.current.connected || state.error !== this.current.error;
    this.current = state;
    if (changed) this.onState(state);
  }

  private accept(stream: Stream, request: StreamRequest): StreamEvents {
    return request.kind === "ws" ? this.acceptSocket(stream, request) : this.acceptRequest(stream, request);
  }

  /** An HTTP request: its body arrives in frames, the app's answer leaves in frames. */
  private acceptRequest(stream: Stream, request: StreamRequest): StreamEvents {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = new PassThrough();
    // Writing to a body nobody reads any more is not an error worth dying for.
    body.on("error", () => {});
    const gone = new AbortController();
    void this.respond(stream, request, hasBody ? body : null, gone.signal);
    return {
      // `write` calls back once the app has taken the bytes: only then may the relay send more.
      data: (bytes, _text, passedOn) => (hasBody ? void body.write(bytes, passedOn) : passedOn()),
      end: () => body.end(),
      close: () => {
        gone.abort();
        body.destroy();
      },
    };
  }

  private async respond(stream: Stream, request: StreamRequest, body: PassThrough | null, signal: AbortSignal): Promise<void> {
    try {
      const { method, headers } = request;
      const init: RequestInit = { method, headers, signal, ...(body ? { body: Readable.toWeb(body) as ReadableStream, duplex: "half" } : {}) };
      const response = await this.app!.fetch(new Request(`http://relay${request.path}`, init), request.client);
      stream.head({ status: response.status, headers: [...response.headers] });
      // One chunk at a time: the next is only read once this one has left, so a slow client slows its own download.
      for await (const chunk of response.body ?? []) {
        if (!(await stream.write(chunk))) return;
      }
      stream.end();
    } catch {
      stream.close();
    }
  }

  /** A WebSocket: the event stream, message by message. */
  private acceptSocket(stream: Stream, request: StreamRequest): StreamEvents {
    const authorization = request.headers.find(([name]) => name.toLowerCase() === "authorization")?.[1];
    let listener: Listener;
    try {
      const start = this.app!.admit(new URL(`http://relay${request.path}`), authorization);
      // Accepted first, so that the relay has a WebSocket to put the first events on.
      stream.head({ status: 101, headers: [] });
      listener = start({
        send: (text) => {
          // No room left: this client reads too slowly. It can come back and catch up with `since`.
          if (!stream.message(text)) stream.close(1013, "Reading too slowly.");
        },
        close: (code, reason) => stream.close(code, reason),
      });
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure("internal", "Something went wrong on the computer.");
      stream.head({ status: httpStatus[failure.code], headers: [["Content-Type", "application/json"]] });
      const refusal = Buffer.from(JSON.stringify({ error: { code: failure.code, message: failure.message } }));
      void stream.write(refusal).then(() => stream.end());
      return { data: (_bytes, _text, passedOn) => passedOn(), close: () => {} };
    }
    return {
      data: (bytes, text, passedOn) => {
        if (text) listener.receive(bytes.toString());
        passedOn();
      },
      close: () => listener.closed(),
    };
  }
}
