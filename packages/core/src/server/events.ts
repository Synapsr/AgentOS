/**
 * `WS /v1/events`: what a client missed since `?since=`, then a `ready`
 * frame, then every event as it happens. The stream runs on a *channel*: a
 * WebSocket of ours, or one that reaches us through the relay.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { ClientFrame, type ErrorCode, type ServerFrame, routes } from "@agentos/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import type { Core } from "../core.js";
import { Failure, httpStatus } from "../errors.js";
import type { Channel, Listener } from "../relay.js";
import { isLoopback } from "../net.js";
import { type Caller, type Reach, bearerToken, identify, isTrustedHost } from "./auth.js";

/** How often we check that clients are still there. A phone that left the network says nothing. */
const HEARTBEAT_MS = 30_000;
/** WebSocket close code for "you may not be here": the device was removed. */
const POLICY_VIOLATION = 1008;

export interface EventStream {
  /** Starts answering WebSocket upgrades on an HTTP server. */
  attach(server: Server): void;
  /**
   * Lets a client in, or throws a `Failure`. Returns the way to start its
   * stream on a channel. Only a client on this computer itself (`reach`)
   * can be the computer: the local token does not work from anywhere else.
   */
  admit(url: URL, authorization: string | undefined, reach: Reach): (channel: Channel) => Listener;
  /** Whether the owner is looking at one of the connected clients right now. */
  watched(): boolean;
  /** Closes the open streams of a device that is no longer paired. */
  disconnect(deviceId: string): void;
  close(): void;
}

export function createEventStream(core: Core): EventStream {
  const sockets = new WebSocketServer({ noServer: true });
  const alive = new WeakSet<WebSocket>();
  /** Every open stream: whose it is, and whether its owner says they are looking at it. */
  const open = new Map<Channel, { caller: Caller; active: boolean }>();

  function admit(url: URL, authorization: string | undefined, reach: Reach): (channel: Channel) => Listener {
    if (url.pathname !== routes.events) throw new Failure("not_found", "There is no such route.");
    // Browsers cannot set headers on a WebSocket, so the token may come in the address.
    const caller = identify(core, bearerToken(authorization) ?? url.searchParams.get("token"), reach);
    if (!caller) throw new Failure("unauthorized", "A valid token is required.");
    const since = url.searchParams.has("since") ? Number(url.searchParams.get("since")) : null;
    if (since !== null && !(Number.isInteger(since) && since >= 0)) throw new Failure("invalid", "`since` must be a sequence number.");
    return (channel) => connect(channel, caller, since);
  }

  function connect(channel: Channel, caller: Caller, since: number | null): Listener {
    const send = (frame: ServerFrame): void => channel.send(JSON.stringify(frame));
    // Replay, `ready` and subscription happen in one go: no event can slip in between.
    const missed = since === null ? [] : core.store.events.since(since);
    for (const event of missed ?? []) send({ type: "event", event });
    send({
      type: "ready",
      seq: core.store.events.seq,
      reset: missed === null,
      node: core.node.info(),
      status: core.node.status(),
      local: caller.kind === "local",
    });
    const unsubscribe = core.node.subscribe((event) => send({ type: "event", event }));
    const entry = { caller, active: false };
    open.set(channel, entry);

    return {
      receive: (text) => {
        const frame = parseFrame(text);
        if (frame?.type === "ping") send({ type: "pong" });
        if (frame?.type === "presence") {
          entry.active = frame.active;
          if (frame.active && caller.kind === "device") core.store.devices.touch(caller.device.id);
        }
      },
      closed: () => {
        unsubscribe();
        open.delete(channel);
      },
    };
  }

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    let start: (channel: Channel) => Listener;
    try {
      if (!isTrustedHost(request.headers.host)) throw new Failure("forbidden", "This address is not one this computer answers to.");
      const reach = isLoopback(request.socket.remoteAddress) ? "here" : "network";
      start = admit(new URL(request.url ?? "/", "http://localhost"), request.headers.authorization, reach);
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure("internal", "Something went wrong on the computer.");
      return refuse(socket, failure.code, failure.message);
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      const listener = start({
        send: (text) => {
          if (client.readyState === client.OPEN) client.send(text);
        },
        close: (code, reason) => client.close(code, reason),
      });
      alive.add(client);
      client.on("pong", () => alive.add(client));
      client.on("error", () => client.terminate());
      client.on("message", (data) => listener.receive(String(data)));
      client.on("close", () => listener.closed());
    });
  }

  const heartbeat = setInterval(() => {
    for (const client of sockets.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, HEARTBEAT_MS);

  return {
    attach: (server) => void server.on("upgrade", upgrade),
    admit,
    watched: () => [...open.values()].some((entry) => entry.active),
    disconnect: (deviceId) => {
      for (const [channel, { caller }] of open) {
        if (caller.kind === "device" && caller.device.id === deviceId) channel.close(POLICY_VIOLATION, "This device was removed.");
      }
    },
    close: () => {
      clearInterval(heartbeat);
      for (const client of sockets.clients) client.terminate();
      sockets.close();
    },
  };
}

function parseFrame(text: string): ClientFrame | null {
  try {
    return ClientFrame.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Answers an upgrade request with a plain HTTP error, in the API's error shape. */
function refuse(socket: Duplex, code: ErrorCode, message: string): void {
  const body = JSON.stringify({ error: { code, message } });
  socket.end(
    `HTTP/1.1 ${httpStatus[code]} ${code}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}
