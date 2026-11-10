/**
 * Starts the server: the API, the event stream and the web app on one port.
 *
 * That one port speaks two ways. A connection that opens with a TLS
 * handshake gets TLS, with the computer's own certificate. A connection that
 * opens in plain HTTP is answered only where nobody can be listening in —
 * from this computer itself, or over Tailscale — and is otherwise told to
 * come back over HTTPS, before it has had a chance to send a token.
 */
import type { Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { type AddressInfo, type Socket, createServer as createListener } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import type { Core } from "../core.js";
import { isPrivatePath } from "../net.js";
import { startPush } from "../push/index.js";
import { createApp } from "./app.js";
import { createEventStream } from "./events.js";

export interface RunningServer {
  /** The port actually bound (useful when 0 was asked for). */
  port: number;
  close(): Promise<void>;
}

/** First byte of a TLS connection: a handshake record. */
const TLS_HANDSHAKE = 0x16;
/** A connection that says nothing for this long is dropped. */
const FIRST_BYTE_MS = 10_000;

/** Listens on `port` (0 = any free port) and on `core.host`. */
export async function startServer(core: Core, port: number): Promise<RunningServer> {
  const events = createEventStream(core);
  const app = createApp(core, events);
  // Two servers that never listen themselves: connections are handed to one or the other.
  const plain = createAdaptorServer({ fetch: app.fetch }) as Server;
  const secure = createAdaptorServer({
    fetch: app.fetch,
    createServer: createHttpsServer,
    serverOptions: { key: core.tls.key, cert: core.tls.cert },
  }) as Server;
  events.attach(plain);
  events.attach(secure);

  const open = new Set<Socket>();
  const listener = createListener((socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(FIRST_BYTE_MS, () => socket.destroy());
    socket.once("readable", () => {
      const first: Buffer | null = socket.read(1);
      if (first === null) return void socket.destroy();
      socket.setTimeout(0);
      // Put back: whoever serves the connection reads it from its first byte.
      socket.unshift(first);
      if (first[0] === TLS_HANDSHAKE) secure.emit("connection", socket);
      else if (isPrivatePath(socket.localAddress, socket.remoteAddress)) plain.emit("connection", socket);
      else refusePlainly(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    // The port is taken, most likely: leave nothing running behind.
    const failed = (error: Error): void => {
      events.close();
      reject(error);
    };
    listener.once("error", failed);
    listener.listen(port, core.host ?? undefined, () => {
      listener.off("error", failed);
      resolve();
    });
  });
  const stopPush = startPush(core, events.watched);
  // The same app and the same event stream serve what comes through the relay.
  core.relay.serve({
    fetch: (request, client) => app.fetch(request, { tunnel: { client } }),
    admit: (url, authorization) => events.admit(url, authorization, "relay"),
  });
  return {
    port: (listener.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        core.relay.close();
        stopPush();
        events.close();
        listener.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}

/** Answers a plain-HTTP connection from the network: not here, not like this. Nothing it sent is read. */
function refusePlainly(socket: Socket): void {
  const body = JSON.stringify({
    error: { code: "forbidden", message: "This computer only answers over HTTPS on this network. Use https:// and check its certificate." },
  });
  socket.end(
    `HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}
