/**
 * AgentOS wire protocol — HTTP API.
 *
 * Base URL: `http://<computer>:4747`. All bodies are JSON unless noted.
 *
 * Authentication: `Authorization: Bearer <token>` on every `/v1/*` route
 * except `GET /v1/hello` and `POST /v1/pair`. A token is either
 * - a **device token**, obtained by pairing, or
 * - the **local token**, readable only on the computer itself
 *   (`~/.agentos/local-token`), used by the desktop app.
 * Routes marked *local* accept the local token only.
 *
 * `WS /v1/events` also accepts `?token=` because browsers cannot set headers.
 *
 * Transport: the computer answers plain HTTP only on the loopback interface
 * (and on a Tailscale interface, which is already encrypted). Every other
 * connection is TLS with the computer's own certificate, whose fingerprint
 * travels in the pairing link (see pairing.ts) and must be pinned by the
 * client. The local token is accepted on loopback connections only.
 *
 * Errors: non-2xx with body `ApiError`.
 */
import { z } from "zod";
import {
  Autonomy,
  ClientPlatform,
  Device,
  Item,
  MessageItem,
  NodeInfo,
  NodeMode,
  NodeStatus,
  RequestItem,
  Thread,
  Timestamp,
} from "./schemas.js";

/** Id of the one conversation every computer always has. */
export const MAIN_THREAD = "main";

export const routes = {
  /** GET — no auth. Is this an AgentOS computer? */
  hello: "/v1/hello",
  /** POST — no auth. Exchange a pairing code for a device token. */
  pair: "/v1/pair",
  /** GET, PATCH(local) — the computer and its agent. Both return `NodeResponse`. */
  node: "/v1/node",
  /** POST — switch between `desktop` and `os` mode. Returns `NodeResponse`. */
  mode: "/v1/mode",
  /** GET, PATCH — local. Engine and voice configuration, including keys. */
  settings: "/v1/settings",
  /** POST — local. Create a one-time pairing code (shown as a QR code). */
  pairingCodes: "/v1/pairing-codes",
  /**
   * GET — list paired devices. DELETE `/v1/devices/:id` — local. Both return
   * `DevicesResponse`. DELETE `/v1/devices/me` — a device removes its own
   * pairing (its token stops working); returns `Empty`.
   */
  devices: "/v1/devices",
  /** PUT — register the calling device for push notifications. Returns `Empty`. */
  push: "/v1/devices/me/push",
  /** GET — list threads. */
  threads: "/v1/threads",
  /** GET `?before=<itemId>&limit=` — timeline, newest last. */
  threadItems: (threadId: string) => `/v1/threads/${threadId}/items`,
  /** POST — say something to the agent. Starts or steers its work. */
  threadMessages: (threadId: string) => `/v1/threads/${threadId}/messages`,
  /** POST — stop what the agent is doing in this thread. Returns `Empty`. */
  threadInterrupt: (threadId: string) => `/v1/threads/${threadId}/interrupt`,
  /** GET — requests waiting for the owner (pending ones only). */
  requests: "/v1/requests",
  /** POST — answer a request. */
  requestResolve: (requestId: string) => `/v1/requests/${requestId}/resolve`,
  /** GET — binary content of a `FileRef`. */
  file: (fileId: string) => `/v1/files/${fileId}`,
  /** GET `?maxWidth=` — JPEG of the screen right now. */
  screen: "/v1/screen",
  /** POST — local. Ask the OS for the permissions the agent needs. */
  computerPermissions: "/v1/computer/permissions",
  /** POST — raw audio body (`Content-Type: audio/*`), `?lang=`. */
  voiceTranscribe: "/v1/voice/transcribe",
  /** POST — returns an audio stream (see `VoiceCapabilities.ttsMime`). */
  voiceSpeak: "/v1/voice/speak",
  /** WS `?since=<seq>` — live events. Frames: `ServerFrame` / `ClientFrame`. */
  events: "/v1/events",
} as const;

export const ErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid",
  "conflict",
  "rate_limited",
  "unavailable",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

// GET /v1/hello
export const HelloResponse = z.object({
  app: z.literal("agentos"),
  version: z.string(),
  protocol: z.number().int(),
  node: z.object({ id: z.string(), name: z.string(), agentName: z.string() }),
  onboarded: z.boolean(),
  /**
   * With `GET /v1/hello?challenge=<nonce>` on a loopback connection:
   * HMAC-SHA256(local token, nonce) in lowercase hex. A local client checks
   * it before sending the local token, so that the token is never handed to
   * something else that happens to answer on the port. Null otherwise.
   */
  proof: z.string().nullable(),
});
export type HelloResponse = z.infer<typeof HelloResponse>;

// POST /v1/pair
export const PairRequest = z.object({
  code: z.string().min(1),
  device: z.object({ name: z.string().min(1).max(80), platform: ClientPlatform }),
});
export type PairRequest = z.infer<typeof PairRequest>;

export const PairResponse = z.object({
  /** Keep it secret (Keychain / Keystore). Shown only once. */
  token: z.string(),
  device: Device,
  node: NodeInfo,
});
export type PairResponse = z.infer<typeof PairResponse>;

/** Body of routes that have nothing to say. */
export const Empty = z.object({});
export type Empty = z.infer<typeof Empty>;

// GET /v1/node
export const NodeResponse = z.object({
  node: NodeInfo,
  status: NodeStatus,
  /** True when the caller holds the local token: it is the computer itself. */
  local: z.boolean(),
});
export type NodeResponse = z.infer<typeof NodeResponse>;

// PATCH /v1/node  (local) — also how onboarding is completed.
export const NodePatch = z
  .object({
    name: z.string().min(1).max(80),
    agentName: z.string().min(1).max(40),
    ownerName: z.string().min(1).max(80),
    language: z.string().min(2).max(12),
    autonomy: Autonomy,
    onboarded: z.boolean(),
  })
  .partial();
export type NodePatch = z.infer<typeof NodePatch>;

// POST /v1/mode
export const ModeRequest = z.object({ mode: NodeMode });
export type ModeRequest = z.infer<typeof ModeRequest>;

// GET /v1/settings  (local)
export const Settings = z.object({
  engine: z.object({
    provider: z.string(),
    model: z.string().nullable(),
    /** Where credentials come from. Keys themselves are never returned. */
    auth: z.enum(["api-key", "environment", "none"]),
    /** A workspace id is stored next to the key (some keys need one). */
    hasWorkspaceId: z.boolean(),
    ready: z.boolean(),
  }),
  voice: z.object({
    provider: z.string(),
    voice: z.string().nullable(),
    hasKey: z.boolean(),
    /** Address of the owner's own speech server, for providers that need one. */
    url: z.string().nullable(),
    /** Providers this build knows about. */
    available: z.array(
      z.object({ id: z.string(), label: z.string(), needsKey: z.boolean(), needsUrl: z.boolean() }),
    ),
  }),
  computer: z.object({
    /** OS permissions the agent needs to see and control the computer. */
    permissions: z.object({ accessibility: z.boolean(), screenRecording: z.boolean() }),
  }),
  network: z.object({
    port: z.number().int(),
    /** Addresses a client can try, best first. */
    urls: z.array(z.string()),
    relayUrl: z.string().nullable(),
    /** The computer is connected to its relay right now. */
    relayConnected: z.boolean(),
    /** Why the relay is not connected, in human words. Null when fine or unset. */
    relayError: z.string().nullable(),
    /** A token for a private relay is stored. */
    hasRelayToken: z.boolean(),
  }),
});
export type Settings = z.infer<typeof Settings>;

// PATCH /v1/settings  (local)
export const SettingsPatch = z
  .object({
    engine: z
      .object({
        provider: z.string(),
        model: z.string().nullable(),
        /** Empty string removes the stored key. */
        apiKey: z.string(),
        /** Workspace the key belongs to, when the key is not tied to one. Empty string removes it. */
        workspaceId: z.string(),
      })
      .partial(),
    voice: z
      .object({
        provider: z.string(),
        voice: z.string().nullable(),
        apiKey: z.string(),
        url: z.string().nullable(),
      })
      .partial(),
    network: z
      .object({
        relayUrl: z.string().nullable(),
        /** Token of a private relay. Empty string removes it. */
        relayToken: z.string(),
      })
      .partial(),
  })
  .partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

// POST /v1/computer/permissions  (local)
export const PermissionsResponse = z.object({
  accessibility: z.boolean(),
  screenRecording: z.boolean(),
});
export type PermissionsResponse = z.infer<typeof PermissionsResponse>;

// POST /v1/pairing-codes  (local)
export const PairingCode = z.object({
  code: z.string(),
  expiresAt: Timestamp,
  /** `agentos://pair?…` — what the QR code contains. */
  link: z.string(),
});
export type PairingCode = z.infer<typeof PairingCode>;

// GET /v1/devices
export const DevicesResponse = z.object({ devices: z.array(Device) });
export type DevicesResponse = z.infer<typeof DevicesResponse>;

// PUT /v1/devices/me/push
export const PushRegistration = z.object({
  /** `apns` (iOS/watchOS), `fcm` (Android) or `none` to unregister. */
  kind: z.enum(["apns", "fcm", "none"]),
  token: z.string().nullable(),
  /** APNs environment the token belongs to. */
  sandbox: z.boolean(),
});
export type PushRegistration = z.infer<typeof PushRegistration>;

// GET /v1/threads
export const ThreadsResponse = z.object({ threads: z.array(Thread) });
export type ThreadsResponse = z.infer<typeof ThreadsResponse>;

// GET /v1/threads/:id/items
export const ItemsResponse = z.object({
  thread: Thread,
  items: z.array(Item),
  /** True when older items exist before the first one returned. */
  hasMore: z.boolean(),
});
export type ItemsResponse = z.infer<typeof ItemsResponse>;

// POST /v1/threads/:id/messages
export const SendMessageRequest = z.object({
  text: z.string().min(1),
  via: z.enum(["text", "voice"]).default("text"),
  /**
   * Set when these words are the owner's reply to that pending request (for
   * example what they said right after the agent asked aloud). Only then may
   * the computer read the message as an answer; a message without it never
   * answers anything.
   */
  requestId: z.string().nullable().default(null),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const SendMessageResponse = z.object({
  item: MessageItem,
  /**
   * The request named by `requestId`, as it stands after the message; null
   * when no `requestId` was sent. Still `pending` means the words were not a
   * clear answer: the request is still waiting, ask again. A `requestId`
   * that names no pending request of this thread is refused with `conflict`.
   */
  request: RequestItem.nullable(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

// GET /v1/requests
export const RequestsResponse = z.object({ requests: z.array(RequestItem) });
export type RequestsResponse = z.infer<typeof RequestsResponse>;

// POST /v1/requests/:id/resolve
export const ResolveRequest = z
  .object({
    optionId: z.string().nullable().default(null),
    text: z.string().nullable().default(null),
  })
  .refine((v) => v.optionId !== null || v.text !== null, "optionId or text is required");
export type ResolveRequest = z.infer<typeof ResolveRequest>;

export const ResolveResponse = z.object({ request: RequestItem });
export type ResolveResponse = z.infer<typeof ResolveResponse>;

// POST /v1/voice/transcribe
export const TranscribeResponse = z.object({ text: z.string() });
export type TranscribeResponse = z.infer<typeof TranscribeResponse>;

// POST /v1/voice/speak
export const SpeakRequest = z.object({ text: z.string().min(1).max(4000) });
export type SpeakRequest = z.infer<typeof SpeakRequest>;
