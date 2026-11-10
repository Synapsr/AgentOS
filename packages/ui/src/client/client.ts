import type {
  Device,
  ErrorCode,
  FileRef,
  ItemsResponse,
  MessageItem,
  NodeMode,
  NodePatch,
  NodeResponse,
  PairingCode,
  PermissionsResponse,
  RequestItem,
  ServerFrame,
  Settings,
  SettingsPatch,
  Thread,
} from "@agentos/protocol";

/**
 * Everything the interface needs from a computer. Implemented over HTTP
 * (`http.ts`) and in memory (`demo/demo.ts`).
 */
export interface Client {
  node(): Promise<NodeResponse>;
  updateNode(patch: NodePatch): Promise<NodeResponse>;
  setMode(mode: NodeMode): Promise<NodeResponse>;
  /** Local only: a device token is refused with `forbidden`. */
  settings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  /** Asks the operating system for what the agent still needs. */
  requestPermissions(): Promise<PermissionsResponse>;
  createPairingCode(): Promise<PairingCode>;
  devices(): Promise<Device[]>;
  /** Removes a device, and returns those that remain. */
  removeDevice(deviceId: string): Promise<Device[]>;
  threads(): Promise<Thread[]>;
  /** The newest items of a thread, or the page before `before`. */
  items(threadId: string, before?: string): Promise<ItemsResponse>;
  send(threadId: string, text: string): Promise<MessageItem>;
  interrupt(threadId: string): Promise<void>;
  /** Requests still waiting for the owner. */
  requests(): Promise<RequestItem[]>;
  /** Answers a request with one of its options, or with free text. */
  resolve(requestId: string, optionId: string | null, text: string | null): Promise<RequestItem>;
  /** A URL an `<img>` can show (files need the token, so not the route itself). */
  fileUrl(file: FileRef): Promise<string>;
  /**
   * Opens the live event stream and keeps it open, reconnecting from
   * `since()` each time. `onDown` is called whenever the connection drops.
   * Returns a function that closes it for good.
   */
  events(since: () => number, onFrame: (frame: ServerFrame) => void, onDown: () => void): () => void;
}

/** A request the computer refused, or that never reached it (`network`). */
export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode | "network",
    message: string,
  ) {
    super(message);
  }
}

/** The failure code of anything thrown by a `Client`. */
export function failureCode(error: unknown): ErrorCode | "network" {
  return error instanceof ApiFailure ? error.code : "internal";
}
