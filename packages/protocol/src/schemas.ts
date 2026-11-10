/**
 * AgentOS wire protocol — data model.
 *
 * One contract shared by the core daemon, the desktop app and every client
 * (iOS, watchOS, Android, web). Everything on the wire is JSON described here.
 *
 * Conventions
 * - Timestamps are integer milliseconds since the Unix epoch.
 * - Ids are opaque strings with a readable prefix (`thr_`, `msg_`, `req_`…).
 * - Optional values are sent as `null`, never omitted, so that strictly typed
 *   clients (Swift, Kotlin) can decode without special cases.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 4747;

/** Milliseconds since the Unix epoch. */
export const Timestamp = z.number().int().nonnegative();

// ───────────────────────────── Identity ─────────────────────────────

/** Operating system of a computer running the AgentOS core. */
export const Platform = z.enum(["macos", "windows", "linux"]);
export type Platform = z.infer<typeof Platform>;

/** Kind of client connecting to a computer. `node` is another computer. */
export const ClientPlatform = z.enum(["ios", "watchos", "android", "web", "desktop", "cli", "node"]);
export type ClientPlatform = z.infer<typeof ClientPlatform>;

/**
 * How much the agent may do without asking.
 * - `supervised`: asks before anything that changes the computer.
 * - `balanced`:   works alone, asks before the risky actions it recognises
 *                 (deploys, forced deletes, publishing…). It is a list of
 *                 known patterns, not a guarantee.
 * - `autonomous`: the safety policy never stops it
 *                 (the agent may still choose to ask a question).
 */
export const Autonomy = z.enum(["supervised", "balanced", "autonomous"]);
export type Autonomy = z.infer<typeof Autonomy>;

/**
 * Where speech is processed.
 * - `device`: the client uses its own on-device recognition / synthesis.
 * - `server`: the client streams audio to/from the computer, which holds the
 *             provider key (premium voices).
 */
export const VoiceSide = z.enum(["device", "server"]);
export type VoiceSide = z.infer<typeof VoiceSide>;

export const VoiceCapabilities = z.object({
  /** Provider id: `device`, `openai`, `elevenlabs`, … */
  provider: z.string(),
  stt: VoiceSide,
  tts: VoiceSide,
  /** Audio MIME type produced by `POST /v1/voice/speak`, when `tts` is `server`. */
  ttsMime: z.string().nullable(),
});
export type VoiceCapabilities = z.infer<typeof VoiceCapabilities>;

/** A computer running the AgentOS core, and the agent that lives on it. */
export const NodeInfo = z.object({
  id: z.string(),
  /** Human name of the computer, e.g. "Mac mini du bureau". */
  name: z.string(),
  platform: Platform,
  /** AgentOS version (semver). */
  version: z.string(),
  protocol: z.number().int(),
  agent: z.object({ name: z.string() }),
  owner: z.object({ name: z.string() }),
  /** BCP‑47 language the agent speaks with its owner, e.g. "fr". */
  language: z.string(),
  autonomy: Autonomy,
  /** False until the first-run onboarding has been completed. */
  onboarded: z.boolean(),
  capabilities: z.object({
    /** The agent can see the screen and use mouse and keyboard. */
    computer: z.boolean(),
    /** Engine id: `claude`, `mock`, … */
    engine: z.string(),
    /** The engine has working credentials. */
    engineReady: z.boolean(),
    voice: VoiceCapabilities,
  }),
});
export type NodeInfo = z.infer<typeof NodeInfo>;

/** `os` = the screen belongs to the agent (black screen, presence only). */
export const NodeMode = z.enum(["desktop", "os"]);
export type NodeMode = z.infer<typeof NodeMode>;

/**
 * - `idle`:    nothing to do.
 * - `working`: at least one thread is running.
 * - `waiting`: blocked on the owner (a pending request).
 */
export const NodeState = z.enum(["idle", "working", "waiting"]);
export type NodeState = z.infer<typeof NodeState>;

export const NodeStatus = z.object({
  state: NodeState,
  /** Short present-tense phrase for humans, e.g. "Running the tests". */
  activity: z.string().nullable(),
  mode: NodeMode,
  pendingRequests: z.number().int(),
  workingThreads: z.number().int(),
});
export type NodeStatus = z.infer<typeof NodeStatus>;

/** A paired client. */
export const Device = z.object({
  id: z.string(),
  name: z.string(),
  platform: ClientPlatform,
  createdAt: Timestamp,
  lastSeenAt: Timestamp.nullable(),
});
export type Device = z.infer<typeof Device>;

// ───────────────────────────── Conversation ─────────────────────────────

export const ThreadState = z.enum(["idle", "working", "waiting", "error"]);
export type ThreadState = z.infer<typeof ThreadState>;

/**
 * A conversation with the agent.
 *
 * Every computer has exactly one `main` thread (id `main`): the single
 * conversation a person has with their agent. The agent may start `job`
 * threads to work on something in the background (often in a project
 * folder); they report back to their parent when done.
 */
export const Thread = z.object({
  id: z.string(),
  kind: z.enum(["main", "job"]),
  title: z.string(),
  parentId: z.string().nullable(),
  /** Working directory, for jobs bound to a project. */
  cwd: z.string().nullable(),
  state: ThreadState,
  /** Last meaningful line, for lists. */
  preview: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Thread = z.infer<typeof Thread>;

/** A stored binary (screenshot, image…), fetched at `GET /v1/files/:id`. */
export const FileRef = z.object({
  id: z.string(),
  mime: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type FileRef = z.infer<typeof FileRef>;

const ItemBase = z.object({
  id: z.string(),
  threadId: z.string(),
  at: Timestamp,
});

/** Something the owner or the agent said. */
export const MessageItem = ItemBase.extend({
  type: z.literal("message"),
  role: z.enum(["user", "agent"]),
  text: z.string(),
  via: z.enum(["text", "voice"]),
  /** Device that sent it (user messages), if known. */
  deviceId: z.string().nullable(),
  files: z.array(FileRef),
});
export type MessageItem = z.infer<typeof MessageItem>;

/** Something the agent is doing or did: one line, human readable. */
export const ActivityItem = ItemBase.extend({
  type: z.literal("activity"),
  /** e.g. "Running the tests", "Reading package.json". */
  label: z.string(),
  /** Machine name of the underlying tool, if any. */
  tool: z.string().nullable(),
  /** Optional detail (a command, a path). Never required to understand. */
  detail: z.string().nullable(),
  state: z.enum(["running", "done", "failed"]),
  endedAt: Timestamp.nullable(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const Risk = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof Risk>;

export const RequestOption = z.object({
  id: z.string(),
  label: z.string(),
  style: z.enum(["primary", "danger", "default"]),
});
export type RequestOption = z.infer<typeof RequestOption>;

/** Well-known option ids for `approval` requests. */
export const APPROVE = "approve";
export const DENY = "deny";

export const RequestResolution = z.object({
  optionId: z.string().nullable(),
  text: z.string().nullable(),
  /** Device that answered, or null when answered on the computer itself. */
  deviceId: z.string().nullable(),
  at: Timestamp,
});
export type RequestResolution = z.infer<typeof RequestResolution>;

/**
 * The agent needs its owner.
 *
 * - `approval`: the safety policy stopped an action; options are
 *   `approve` / `deny`.
 * - `question`: the agent chose to ask ("Everything looks good — deploy to
 *   production?"); options are the agent's own.
 *
 * Answerable from any client, by tap or by voice. First answer wins.
 */
export const RequestItem = ItemBase.extend({
  type: z.literal("request"),
  kind: z.enum(["approval", "question"]),
  /** One short line: what is being asked. */
  title: z.string(),
  /** Optional context (the command, what will happen). */
  body: z.string().nullable(),
  /** One sentence written to be spoken aloud. */
  spoken: z.string(),
  risk: Risk,
  /** What the agent sees, to decide with your own eyes. */
  screenshot: FileRef.nullable(),
  options: z.array(RequestOption),
  /** Whether a free-form answer is accepted instead of an option. */
  allowText: z.boolean(),
  state: z.enum(["pending", "resolved", "cancelled"]),
  resolution: RequestResolution.nullable(),
});
export type RequestItem = z.infer<typeof RequestItem>;

/** Anything that appears in a thread's timeline. */
export const Item = z.discriminatedUnion("type", [MessageItem, ActivityItem, RequestItem]);
export type Item = z.infer<typeof Item>;

// ───────────────────────────── Events ─────────────────────────────

const EventBase = z.object({
  /**
   * Position in the computer's event log, strictly increasing.
   * `0` marks an ephemeral event that is not stored and never replayed.
   */
  seq: z.number().int().nonnegative(),
  at: Timestamp,
});

export const Event = z.discriminatedUnion("type", [
  EventBase.extend({ type: z.literal("node.status"), status: NodeStatus }),
  EventBase.extend({ type: z.literal("node.updated"), node: NodeInfo }),
  /** A thread was created or changed. */
  EventBase.extend({ type: z.literal("thread.updated"), thread: Thread }),
  EventBase.extend({ type: z.literal("thread.deleted"), threadId: z.string() }),
  EventBase.extend({ type: z.literal("item.added"), item: Item }),
  /** An activity ended, or a request was resolved or cancelled. */
  EventBase.extend({ type: z.literal("item.updated"), item: Item }),
  /**
   * Ephemeral (`seq` 0). The agent is typing: `text` is appended to the
   * message `messageId`, which will arrive in full as `item.added`.
   */
  EventBase.extend({
    type: z.literal("message.delta"),
    threadId: z.string(),
    messageId: z.string(),
    text: z.string(),
  }),
  /**
   * The agent finished its turn and is handing back to the owner.
   * `text` is what to tell them — clients not in the foreground should
   * notify or speak it. Jobs emit it too, for their own thread: announce
   * only the turns of the `main` thread, which reports on its jobs itself.
   */
  EventBase.extend({
    type: z.literal("turn.completed"),
    threadId: z.string(),
    ok: z.boolean(),
    text: z.string(),
  }),
]);
export type Event = z.infer<typeof Event>;
export type EventType = Event["type"];

/** Frames sent by the computer on `WS /v1/events`. */
export const ServerFrame = z.discriminatedUnion("type", [
  /**
   * Sent once, after the events since `?since=` have been replayed.
   * `reset: true` means the client's `since` was too old (or from another
   * log): drop local state and reload over HTTP.
   */
  z.object({
    type: z.literal("ready"),
    seq: z.number().int(),
    reset: z.boolean(),
    node: NodeInfo,
    status: NodeStatus,
    /** True when the client holds the local token: it is the computer itself. */
    local: z.boolean(),
  }),
  z.object({ type: z.literal("event"), event: Event }),
  z.object({ type: z.literal("pong") }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;

/** Frames sent by clients on `WS /v1/events`. */
export const ClientFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  /**
   * Whether the owner is looking at this client right now. The computer
   * uses it to decide who gets notified.
   */
  z.object({ type: z.literal("presence"), active: z.boolean() }),
]);
export type ClientFrame = z.infer<typeof ClientFrame>;
