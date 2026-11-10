/**
 * The tunnel between a computer and a relay.
 *
 * The computer opens one WebSocket to the relay and keeps it open. Every
 * connection a client then makes to the relay for that computer becomes a
 * *stream* on that socket. Streams share it through binary frames:
 *
 *   frame = type (1 byte) · stream id (4 bytes, big-endian) · payload
 *
 *   OPEN    relay → computer  JSON `StreamRequest`: a client's HTTP request or WebSocket upgrade
 *   HEAD    computer → relay  JSON `StreamResponse`: status and headers (status 101 accepts a WebSocket)
 *   DATA    both ways         bytes of an HTTP body, or one binary WebSocket message
 *   TEXT    both ways         one text WebSocket message
 *   END     both ways         the sender's HTTP body is complete
 *   CLOSE   both ways         the stream is over in both directions; JSON `{ code, reason }`, or empty
 *   WINDOW  both ways         uint32: bytes the receiver has passed on — the sender may send as many more
 *
 * Flow control. In each direction of a stream, at most `WINDOW_BYTES` of
 * DATA and TEXT payload may be on their way: a sender spends that allowance
 * and gets it back through WINDOW frames, which the receiver only sends for
 * bytes it has handed over to where they are going. A slow reader therefore
 * holds back its own stream, in the sender, and nothing piles up in between.
 *
 * Neither end trusts the other. A frame that is not what it should be — a
 * request or an answer of the wrong shape, an answer given twice, bytes
 * before the answer or after the end, more of them than the window allows —
 * ends the stream it names, and only that stream. So does a reader that
 * throws. Nothing that arrives on a tunnel can throw past it.
 *
 * Stream ids are chosen by the relay, which is the only side that opens
 * streams. Liveness is the WebSocket's own ping/pong: the relay pings every
 * `PING_MS`, and a side that has heard nothing for `SILENCE_MS` drops the
 * tunnel; the computer then connects again.
 */
import type { WebSocket } from "ws";

/** Allowance of each direction of a stream; also the largest WebSocket message that can cross. */
export const WINDOW_BYTES = 256 * 1024;
/** Largest payload of one DATA frame: bigger chunks are cut, so streams take turns on the socket. */
export const FRAME_BYTES = 32 * 1024;
/** Streams a tunnel carries at once. */
export const MAX_STREAMS = 256;
export const PING_MS = 20_000;
export const SILENCE_MS = 60_000;
/**
 * Bytes that may wait to leave on a tunnel's socket. Flow control bounds the
 * data of all streams together; past that, and some room for the requests and
 * answers that are not flow-controlled, the other end has stopped reading.
 */
const MAX_BACKLOG_BYTES = MAX_STREAMS * WINDOW_BYTES + 16 * 1024 * 1024;

const OPEN = 1;
const HEAD = 2;
const DATA = 3;
const TEXT = 4;
const END = 5;
const CLOSE = 6;
const WINDOW = 7;
const HEADER_BYTES = 5;

/** What a client asked the relay for, passed on to the computer. */
export interface StreamRequest {
  /** An HTTP request, or a WebSocket to open. */
  kind: "http" | "ws";
  method: string;
  /** Path and query as the computer should see them, without the relay's `/n/<node>` prefix. */
  path: string;
  headers: [name: string, value: string][];
  /** Address of the client, as the relay saw it. Not something a client can forge. */
  client: string;
}

/** The computer's answer to a `StreamRequest`. */
export interface StreamResponse {
  /** 101 to accept a WebSocket, or the HTTP status of the answer (200 to 599). */
  status: number;
  headers: [name: string, value: string][];
}

/** What a stream delivers to the side that reads it. */
export interface StreamEvents {
  /** The computer's answer (relay side only). Comes once, before any data. */
  head?(response: StreamResponse): void;
  /**
   * Body bytes, or one WebSocket message (`text` says which kind). Call
   * `passedOn` once they have gone where they were going: that is what lets
   * the other side send more.
   */
  data(bytes: Buffer, text: boolean, passedOn: () => void): void;
  /** The other side's HTTP body is complete. */
  end?(): void;
  /** The stream is over. With a WebSocket's close code and reason, when there is one. */
  close(code?: number, reason?: string): void;
}

/** One client connection, as one end of the tunnel sees it. */
export class Stream {
  /** Bytes we may still send. */
  private allowance = WINDOW_BYTES;
  /** Bytes received and not passed on yet: what the other side has spent of its own allowance. */
  private held = 0;
  /** The other side has said its body is complete. */
  private ended = false;
  private waiting: (() => void)[] = [];
  private over = false;
  events: StreamEvents = { data: (_bytes, _text, passedOn) => passedOn(), close: () => {} };

  /** @param answered Whether the answer has been given. True from the start on the computer's side, which gives it. */
  constructor(
    readonly id: number,
    private readonly tunnel: Tunnel,
    private answered = false,
  ) {}

  get closed(): boolean {
    return this.over;
  }

  /** Answers the request (computer side). */
  head(response: StreamResponse): void {
    if (!this.over) this.tunnel.send(HEAD, this.id, JSON.stringify(response));
  }

  /**
   * Sends body bytes, waiting for the other side to have room and for the
   * socket to have taken them. False when the stream closed in the meantime.
   */
  async write(bytes: Uint8Array): Promise<boolean> {
    for (let offset = 0; offset < bytes.length; offset += FRAME_BYTES) {
      const part = bytes.subarray(offset, offset + FRAME_BYTES);
      while (!this.over && this.allowance < part.length) await new Promise<void>((resume) => this.waiting.push(resume));
      if (this.over) return false;
      this.allowance -= part.length;
      await new Promise<void>((flushed) => this.tunnel.send(DATA, this.id, part, flushed));
    }
    return !this.over;
  }

  /**
   * Sends one WebSocket message, if the other side has room for it. False
   * when it has not: the reader is too slow, and the caller should let it go.
   */
  message(data: string | Uint8Array): boolean {
    const payload = typeof data === "string" ? Buffer.from(data) : data;
    if (this.over || payload.length > this.allowance) return false;
    this.allowance -= payload.length;
    this.tunnel.send(typeof data === "string" ? TEXT : DATA, this.id, payload);
    return true;
  }

  /** Says our HTTP body is complete. */
  end(): void {
    if (!this.over) this.tunnel.send(END, this.id);
  }

  /** Ends the stream in both directions, telling the other side. */
  close(code?: number, reason?: string): void {
    if (this.over) return;
    this.tunnel.send(CLOSE, this.id, code === undefined ? undefined : JSON.stringify({ code, reason: reason ?? "" }));
    this.finish();
  }

  /**
   * @internal Takes one frame from the other side. Throws when it is not a
   * frame this stream may be sent now: the tunnel then ends the stream.
   */
  receive(type: number, payload: Buffer): void {
    switch (type) {
      case HEAD: {
        const response = parse(payload);
        if (this.answered || !isResponse(response)) throw new Error("Not an answer, or not the first.");
        this.answered = true;
        return this.events.head?.(response);
      }
      case DATA:
      case TEXT:
        this.held += payload.length;
        if (!this.answered || this.ended || this.held > WINDOW_BYTES) throw new Error("Data out of turn, or more than the window allows.");
        return this.events.data(payload, type === TEXT, () => {
          this.held -= payload.length;
          if (!this.over) this.tunnel.send(WINDOW, this.id, uint32(payload.length));
        });
      case END:
        if (!this.answered || this.ended) throw new Error("An end out of turn.");
        this.ended = true;
        return this.events.end?.();
      case WINDOW:
        if (payload.length !== 4) throw new Error("Not an allowance.");
        this.allowance += payload.readUInt32BE(0);
        // An allowance is only ever given back: there is never more of it than at the start.
        if (this.allowance > WINDOW_BYTES) throw new Error("More allowance than was spent.");
        return this.wake();
      case CLOSE: {
        const { code, reason } = farewell(parse(payload));
        this.finish();
        return this.events.close(code, reason);
      }
      default:
        throw new Error("Not a frame.");
    }
  }

  /** @internal The stream is over; nothing more is sent or awaited. */
  finish(): void {
    this.over = true;
    this.tunnel.forget(this.id);
    this.wake();
  }

  private wake(): void {
    for (const resume of this.waiting.splice(0)) resume();
  }
}

/** Shares one WebSocket between streams. Both ends of the tunnel are one of these. */
export class Tunnel {
  private readonly streams = new Map<number, Stream>();
  private nextId = 1;

  /**
   * @param accept Computer side: called for each stream the relay opens; returns what reads it.
   * @param onClose Called once, when the socket is gone and every stream with it.
   */
  constructor(
    private readonly socket: WebSocket,
    private readonly accept?: (stream: Stream, request: StreamRequest) => StreamEvents,
    onClose?: () => void,
  ) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) this.receive(data as Buffer);
    });
    socket.on("close", () => {
      for (const stream of [...this.streams.values()]) this.drop(stream);
      onClose?.();
    });
    socket.on("error", () => socket.terminate());
  }

  /** How many streams are open. */
  get size(): number {
    return this.streams.size;
  }

  /** Opens a stream for a client's request (relay side). */
  open(request: StreamRequest, events: StreamEvents): Stream {
    while (this.streams.has(this.nextId)) this.nextId = (this.nextId % 0xffffffff) + 1;
    const stream = new Stream(this.nextId, this);
    this.nextId = (this.nextId % 0xffffffff) + 1;
    stream.events = events;
    this.streams.set(stream.id, stream);
    this.send(OPEN, stream.id, JSON.stringify(request));
    return stream;
  }

  /** Closes the socket, and every stream with it. */
  close(code = 1000, reason = ""): void {
    this.socket.close(code, reason);
  }

  /** @internal */
  send(type: number, id: number, payload?: string | Uint8Array, flushed?: () => void): void {
    if (this.socket.readyState !== this.socket.OPEN) return flushed?.();
    // Flow control bounds what streams have on their way, not how many frames an end that never reads can leave waiting.
    if (this.socket.bufferedAmount > MAX_BACKLOG_BYTES) {
      this.socket.terminate();
      return flushed?.();
    }
    const body = payload === undefined ? Buffer.alloc(0) : typeof payload === "string" ? Buffer.from(payload) : payload;
    const frame = Buffer.allocUnsafe(HEADER_BYTES + body.length);
    frame.writeUInt8(type, 0);
    frame.writeUInt32BE(id, 1);
    frame.set(body, HEADER_BYTES);
    this.socket.send(frame, { binary: true }, () => flushed?.());
  }

  /** @internal */
  forget(id: number): void {
    this.streams.delete(id);
  }

  private receive(frame: Buffer): void {
    // Too short to name a stream: there is nothing to end, and nothing to do.
    if (frame.length < HEADER_BYTES) return;
    const type = frame.readUInt8(0);
    const id = frame.readUInt32BE(1);
    const payload = frame.subarray(HEADER_BYTES);
    try {
      if (type === OPEN) this.opened(id, payload);
      // No such stream: it is already over, and this frame crossed our own CLOSE on the way.
      else this.streams.get(id)?.receive(type, payload);
    } catch {
      const stream = this.streams.get(id);
      if (stream) this.drop(stream);
    }
  }

  /** The relay opens a stream (computer side). */
  private opened(id: number, payload: Buffer): void {
    if (this.streams.has(id)) throw new Error("This stream is open already.");
    const request = parse(payload);
    // Refused at once, so that nobody waits for an answer that will not come.
    if (!this.accept || !isRequest(request) || this.streams.size >= MAX_STREAMS) return this.send(CLOSE, id);
    const stream = new Stream(id, this, true);
    this.streams.set(id, stream);
    stream.events = this.accept(stream, request);
  }

  /** Ends one stream from our side — its frame broke the rules, its reader threw, or the socket is gone — and tells its reader. */
  private drop(stream: Stream): void {
    if (stream.closed) return;
    stream.close();
    try {
      stream.events.close();
    } catch {
      // A reader that throws on hearing it is over must not keep the other streams from hearing it too.
    }
  }
}

function parse(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString());
  } catch {
    return undefined;
  }
}

/** What a header's name, or a method, is made of. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** What a header's value is made of. No line break: a value cannot start a header of its own. */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

function isHeaders(value: unknown): value is [string, string][] {
  const isPair = (pair: unknown): boolean =>
    Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && TOKEN.test(pair[0]) && typeof pair[1] === "string" && HEADER_VALUE.test(pair[1]);
  return Array.isArray(value) && value.every(isPair);
}

function isRequest(value: unknown): value is StreamRequest {
  const { kind, method, path, headers, client } = (value ?? {}) as Record<string, unknown>;
  return (kind === "http" || kind === "ws") && typeof method === "string" && TOKEN.test(method) && typeof path === "string" && path.startsWith("/") && isHeaders(headers) && typeof client === "string";
}

function isResponse(value: unknown): value is StreamResponse {
  const { status, headers } = (value ?? {}) as Record<string, unknown>;
  return typeof status === "number" && Number.isInteger(status) && (status === 101 || (status >= 200 && status <= 599)) && isHeaders(headers);
}

/** A CLOSE frame's code and reason. Neither, unless both are what a WebSocket can carry. */
function farewell(value: unknown): { code?: number; reason?: string } {
  const { code, reason } = (value ?? {}) as { code?: number; reason?: string };
  const sayable = (code === undefined || Number.isInteger(code)) && (reason === undefined || (typeof reason === "string" && Buffer.byteLength(reason) <= 123));
  return sayable ? { code, reason } : {};
}

function uint32(value: number): Buffer {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value, 0);
  return bytes;
}
