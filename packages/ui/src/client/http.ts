import {
  ApiError,
  DevicesResponse,
  HelloResponse,
  ItemsResponse,
  NodeResponse,
  PairingCode,
  PairResponse,
  PermissionsResponse,
  RequestsResponse,
  ResolveResponse,
  routes,
  SendMessageResponse,
  ServerFrame,
  Settings,
  ThreadsResponse,
  type ClientFrame,
  type ErrorCode,
  type PairRequest,
} from "@agentos/protocol";
import { ApiFailure, type Client } from "./client";

/** The slice of a zod schema used here: responses are checked against the protocol. */
interface Schema<T> {
  parse(data: unknown): T;
}

const PING_EVERY = 20_000;
const PONG_TIMEOUT = 8_000;
const RETRY_MAX = 8_000;

const STATUS_CODES: Record<number, ErrorCode> = { 401: "unauthorized", 403: "forbidden", 404: "not_found" };

async function request(base: string, token: string | null, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFailure("network", "The computer cannot be reached.");
  }
  if (response.ok) return response;
  const error = ApiError.safeParse(await response.json().catch(() => null));
  if (error.success) throw new ApiFailure(error.data.error.code, error.data.error.message);
  throw new ApiFailure(STATUS_CODES[response.status] ?? "internal", response.statusText);
}

async function read<T>(schema: Schema<T>, response: Response): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ApiFailure("internal", "The computer answered something unexpected.");
  }
}

/** `GET /v1/hello` — who lives at this address, or null when nobody answers. */
export async function hello(base: string): Promise<HelloResponse | null> {
  try {
    return await read(HelloResponse, await request(base, null, "GET", routes.hello));
  } catch {
    return null;
  }
}

/** `POST /v1/pair` — exchanges a pairing code for a device token. */
export async function pair(base: string, body: PairRequest): Promise<PairResponse> {
  return read(PairResponse, await request(base, null, "POST", routes.pair, body));
}

/** A client for the computer at `base`, authenticated with `token`. */
export function createHttpClient(base: string, token: string): Client {
  const call = (method: string, path: string, body?: unknown) => request(base, token, method, path, body);
  const get = async <T>(schema: Schema<T>, path: string) => read(schema, await call("GET", path));
  const files = new Map<string, Promise<string>>();

  return {
    node: () => get(NodeResponse, routes.node),
    updateNode: async (patch) => read(NodeResponse, await call("PATCH", routes.node, patch)),
    setMode: async (mode) => read(NodeResponse, await call("POST", routes.mode, { mode })),
    settings: () => get(Settings, routes.settings),
    updateSettings: async (patch) => read(Settings, await call("PATCH", routes.settings, patch)),
    requestPermissions: async () => read(PermissionsResponse, await call("POST", routes.computerPermissions)),
    createPairingCode: async () => read(PairingCode, await call("POST", routes.pairingCodes)),
    devices: async () => (await get(DevicesResponse, routes.devices)).devices,
    removeDevice: async (id) =>
      (await read(DevicesResponse, await call("DELETE", `${routes.devices}/${encodeURIComponent(id)}`))).devices,
    threads: async () => (await get(ThreadsResponse, routes.threads)).threads,
    items: (threadId, before) =>
      get(ItemsResponse, routes.threadItems(threadId) + (before ? `?before=${encodeURIComponent(before)}` : "")),
    // Never names a request: what is typed here is a message, not an answer (a request is answered through `resolve`).
    send: async (threadId, text) =>
      (await read(SendMessageResponse, await call("POST", routes.threadMessages(threadId), { text, via: "text" }))).item,
    interrupt: async (threadId) => void (await call("POST", routes.threadInterrupt(threadId))),
    requests: async () => (await get(RequestsResponse, `${routes.requests}?state=pending`)).requests,
    resolve: async (requestId, optionId, text) =>
      (await read(ResolveResponse, await call("POST", routes.requestResolve(requestId), { optionId, text }))).request,

    fileUrl(file) {
      let url = files.get(file.id);
      if (!url) {
        url = call("GET", routes.file(file.id)).then(async (response) => URL.createObjectURL(await response.blob()));
        files.set(file.id, url);
        url.catch(() => files.delete(file.id));
      }
      return url;
    },

    events(since, onFrame, onDown) {
      let socket: WebSocket | null = null;
      let closed = false;
      let attempt = 0;
      let retry = 0;
      let heartbeat = 0;
      let watchdog = 0;

      const send = (frame: ClientFrame) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
      };
      const presence = () => send({ type: "presence", active: document.visibilityState === "visible" });

      const drop = () => {
        clearInterval(heartbeat);
        clearTimeout(watchdog);
        if (socket) {
          socket.onclose = socket.onmessage = socket.onopen = null;
          socket.close();
          socket = null;
        }
      };

      const lost = () => {
        drop();
        if (closed) return;
        onDown();
        retry = window.setTimeout(open, Math.min(RETRY_MAX, 500 * 2 ** attempt++));
      };

      const open = () => {
        const query = new URLSearchParams({ token });
        if (since() > 0) query.set("since", String(since()));
        const ws = new WebSocket(`${base.replace(/^http/, "ws")}${routes.events}?${query}`);
        socket = ws;
        ws.onopen = () => {
          presence();
          heartbeat = window.setInterval(() => {
            send({ type: "ping" });
            // Any frame is a sign of life; silence means the socket is dead.
            clearTimeout(watchdog);
            watchdog = window.setTimeout(lost, PONG_TIMEOUT);
          }, PING_EVERY);
        };
        ws.onmessage = (message) => {
          clearTimeout(watchdog);
          const frame = parseFrame(message.data);
          if (!frame || frame.type === "pong") return;
          if (frame.type === "ready") attempt = 0;
          onFrame(frame);
        };
        ws.onclose = lost;
      };

      // Coming back to the page: say so, and do not wait for the next retry.
      const wake = () => {
        presence();
        if (!socket && !closed && document.visibilityState === "visible") {
          clearTimeout(retry);
          open();
        }
      };
      document.addEventListener("visibilitychange", wake);
      window.addEventListener("online", wake);

      open();
      return () => {
        closed = true;
        clearTimeout(retry);
        document.removeEventListener("visibilitychange", wake);
        window.removeEventListener("online", wake);
        drop();
      };
    },
  };
}

/** Frames this build does not understand (a newer core) are skipped, not fatal. */
function parseFrame(data: unknown): ServerFrame | null {
  try {
    const frame = ServerFrame.safeParse(JSON.parse(String(data)));
    return frame.success ? frame.data : null;
  } catch {
    return null;
  }
}
