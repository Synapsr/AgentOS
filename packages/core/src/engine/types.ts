/**
 * The engine — the agent's brain — behind one small interface.
 *
 * An engine knows how to run a model with tools. It knows nothing about
 * threads on disk, clients or safety rules: the core hands it a `host` per
 * conversation and the engine reports back through it. Implement these three
 * types to plug in another model.
 */
import type { AgentTool, Thread, ToolContext } from "@agentos/protocol";

export interface EngineStatus {
  /** The engine has what it needs to answer. */
  ready: boolean;
  /** Where its credentials come from. `environment` = whatever this computer already has. */
  auth: "api-key" | "environment" | "none";
}

/** Something the agent wants to do with a tool. */
export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  /** For a tool of an MCP server the owner configured — not AgentOS's, not the engine's own: that server, and what it says of the tool. */
  server?: ToolServer;
}

/** A server of tools from the owner's own configuration, as the engine reports it. Its words are hints, not guarantees. */
export interface ToolServer {
  /** Its name as configured: untrusted text. */
  name: string;
  /** The server marks the tool as only reading (MCP `readOnlyHint`). */
  readOnly?: boolean;
  /** The server marks the tool as destructive (MCP `destructiveHint`). */
  destructive?: boolean;
}

/** The answer to "may I?". A refusal carries what to tell the model. */
export type Authorization = { allow: true } | { allow: false; message: string };

/** One human-readable line about what the agent is doing. */
export interface Activity {
  label: string;
  /** Machine name of the tool behind it, if any. */
  tool: string | null;
  /** Optional detail: a command, a path. */
  detail: string | null;
}

export interface TurnResult {
  ok: boolean;
  /** What to tell the owner: the agent's last words, written to be spoken. */
  text: string;
}

/** What the core gives an engine for one conversation, and how the engine reports back. */
export interface EngineHost {
  thread: Thread;
  /** Who the agent is and how it should behave, to append to the engine's own instructions. */
  persona: string;
  /** Folder the agent works in. */
  cwd: string;
  /** Model id, or null for the engine's default. */
  model: string | null;
  /** Language for the activity lines the engine writes. */
  language: string;
  /** Abilities to expose to the model, on top of the engine's own. */
  tools: AgentTool[];
  /** Token saved by an earlier session of this conversation, to pick it up where it stopped. */
  resume: string | null;
  /** Remembers the token that resumes this conversation from now on. */
  saveResume(token: string): void;
  /** What to pass to a tool's `run`. */
  toolContext(): ToolContext;

  /** The agent is typing: a piece of the message that `onMessage` will deliver whole. */
  onDelta(text: string): void;
  /** The agent said something to its owner. */
  onMessage(text: string): void;
  /** The agent started doing something. Returns the id to end it with. */
  onActivityStart(activity: Activity): string;
  onActivityEnd(id: string, ok: boolean): void;
  /** Safety policy, then the owner if needed. Call it before every tool use that is not the engine's own bookkeeping. */
  authorize(call: ToolCall): Promise<Authorization>;
  /** The agent is done and hands back to its owner. */
  onTurnEnd(result: TurnResult): void;
}

/** A live conversation between the core and the model. */
export interface EngineSession {
  /**
   * Delivers words to the agent; it starts working, or is steered if it
   * already is. A `note` comes from the core itself (a job finished), not
   * from the owner.
   */
  send(text: string, kind: "message" | "note"): void;
  /** Stops the current turn. Resolves once that turn has been reported through `onTurnEnd`. */
  interrupt(): Promise<void>;
  /** Ends the session and frees what it holds. */
  close(): void;
}

export interface Engine {
  /** `claude`, `mock`, … */
  readonly id: string;
  /** Cheap to call: engines cache it and never spend tokens to answer. */
  status(): Promise<EngineStatus>;
  /** Starts (or resumes) the conversation of one thread. */
  open(host: EngineHost): EngineSession;
}
