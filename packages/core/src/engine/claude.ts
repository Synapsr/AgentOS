/**
 * The Claude engine: Claude, driven through the Claude Agent SDK. The SDK
 * runs the unmodified Claude Code binary, which brings the file, shell and
 * sub-agent tools; we add our own tools and decide what needs the owner.
 *
 * One long-lived `query()` per conversation, fed message by message.
 *
 * Credentials: an API key from Settings or the environment is handed to
 * Claude Code. Without one we hand over nothing, and Claude Code uses
 * whatever the owner of this computer has already set up for it. We never
 * read, store or forward those credentials.
 *
 * What Claude Code is kept from: AgentOS's own secrets are not in its
 * environment, its file tools are denied the data folder, and a project
 * folder's own settings (hooks, servers) do not apply unless the owner says so.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { type UUID, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Writable } from "node:stream";
import {
  type AccountInfo,
  type HookCallback,
  type Options,
  type PermissionResult,
  type Query,
  type SDKAssistantMessage,
  type SDKAssistantMessageError,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  createSdkMcpServer,
  query as startClaudeCode,
  tool as sdkTool,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentTool } from "@agentos/protocol";
import { translator } from "../i18n.js";
import { describeToolCall, inspectCall } from "../labels.js";
import type { Engine, EngineHost, EngineSession, EngineStatus, ToolServer, TurnResult } from "./types.js";

export interface ClaudeOptions {
  /** Anthropic API key, or null to let Claude Code use what this computer already has. */
  apiKey: string | null;
  /** Workspace to name with the key, for keys that are not tied to one. */
  workspaceId: string | null;
  /** Path of the Claude Code binary to run, or null for the one that comes with the SDK. */
  executable: string | null;
  /** AgentOS version, to say who is calling. */
  version: string;
  /** AgentOS's data folder: Claude Code's tools are kept out of it. */
  dataDir: string;
  /** Environment variables that hold secrets of AgentOS's own (a voice key): not passed on. */
  secretVariables: string[];
  /** Run shell commands in Claude Code's sandbox. */
  sandbox: boolean;
  /** Let a project folder's own Claude Code settings apply. */
  projectSettings: boolean;
  /** How Claude Code is started. Tests replace it with a script. */
  query?: typeof startClaudeCode;
}

/** Our tools reach Claude as `mcp__agentos__<name>`. */
const TOOL_SERVER = "agentos";
const TOOL_PREFIX = `mcp__${TOOL_SERVER}__`;

/** Claude Code tools that need a terminal in front of a person; `ask_owner` replaces them. */
const TERMINAL_ONLY_TOOLS = ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"];

/** How long an interrupted turn has to wind down before we call it over ourselves. */
const STOP_GRACE_MS = 5000;

/**
 * Claude Code lets some actions through without asking anyone (reads,
 * commands it judges harmless, whatever the owner's Claude settings allow).
 * Answering "ask" before every tool call sends them all to `canUseTool`, so
 * that one policy — ours — decides, the same way for every engine.
 */
const askEveryTime: HookCallback = async () => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" },
});

/** A prompt that never says anything: Claude Code starts, no message is sent, no token is spent. */
const silence: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
};

export function createClaudeEngine(options: ClaudeOptions): Engine {
  const start = options.query ?? startClaudeCode;
  const executable = options.executable ?? undefined;
  const env = engineEnvironment(options);
  const known = (ready: boolean): EngineStatus => ({
    ready,
    auth: options.apiKey ? "api-key" : ready ? "environment" : "none",
  });
  let status: Promise<EngineStatus> | null = null;

  /** Without a key, asks Claude Code who it is signed in as — a handshake, not a request to the model. */
  async function probe(): Promise<EngineStatus> {
    // A key is taken at its word until a real turn proves it wrong.
    if (options.apiKey) return known(true);
    // Somewhere neutral, with nothing of the owner's loaded: all we want is the handshake.
    const idle = start({
      prompt: silence,
      options: { env, cwd: tmpdir(), persistSession: false, strictMcpConfig: true, pathToClaudeCodeExecutable: executable },
    });
    try {
      return known(isSignedIn((await idle.initializationResult()).account));
    } catch {
      return known(false);
    } finally {
      idle.close();
    }
  }

  return {
    id: "claude",
    status: () => (status ??= probe()),
    open: (host) =>
      new ClaudeSession(host, { ...options, start, env, executable }, (ready) => {
        // A real turn is better evidence than the handshake.
        status = Promise.resolve(known(ready));
      }),
  };
}

/** Variables through which Claude Code is given its key: the key goes another way (see `withKeyOnAPipe`). */
const KEY_VARIABLES = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR"];

/**
 * The environment Claude Code starts with, and with it every command the
 * agent runs: ours — whatever the owner exported keeps working — without
 * what is AgentOS's own. A command has no business with the relay's token,
 * a voice key, or the key the agent itself thinks with.
 */
function engineEnvironment(options: ClaudeOptions): Runtime["env"] {
  const withheld = new Set([...KEY_VARIABLES, ...options.secretVariables]);
  const inherited = Object.entries(process.env).filter(([name]) => !name.startsWith("AGENTOS_") && !withheld.has(name));
  const env: Runtime["env"] = { ...Object.fromEntries(inherited), CLAUDE_AGENT_SDK_CLIENT_APP: `agentos/${options.version}` };
  if (options.apiKey && options.workspaceId) env.ANTHROPIC_CUSTOM_HEADERS = withWorkspace(env.ANTHROPIC_CUSTOM_HEADERS, options.workspaceId);
  // Where a pipe of its own cannot be passed, the key travels as it always did.
  if (options.apiKey && !CAN_PASS_PIPES) env.ANTHROPIC_API_KEY = options.apiKey;
  return env;
}

/** Windows starts programs without extra pipes that such a binary knows how to find. */
const CAN_PASS_PIPES = process.platform !== "win32";
/** The descriptor Claude Code reads its key from. */
const KEY_PIPE = 3;

/**
 * Starts Claude Code with its API key written on a pipe of its own instead
 * of placed in its environment, where every command it runs would find it.
 * Claude Code reads the pipe once, at start; nothing it starts inherits it.
 */
function withKeyOnAPipe(apiKey: string): NonNullable<Options["spawnClaudeCodeProcess"]> {
  return ({ command, args, cwd, env, signal }) => {
    const child = spawn(command, args, {
      cwd,
      signal,
      env: { ...env, CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: String(KEY_PIPE) },
      stdio: ["pipe", "pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    const pipe = child.stdio[KEY_PIPE] as Writable;
    // A Claude Code that died before reading is reported by its exit, not by this pipe.
    pipe.on("error", () => {});
    pipe.end(apiKey);
    return child as ChildProcessWithoutNullStreams;
  };
}

/**
 * Rules that keep Claude Code's own file tools — reading, searching,
 * editing — out of a folder. `//` starts a path at the root of the disk.
 */
function denyFolder(folder: string): string[] {
  const paths = new Set([folder, realPath(folder)].filter((path) => path.startsWith("/")));
  return [...paths].flatMap((path) => [`Read(/${path}/**)`, `Edit(/${path}/**)`]);
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const WORKSPACE_HEADER = /^\s*anthropic-workspace-id\s*:/i;

/**
 * A key that belongs to a person rather than to a workspace (`sk-ant-usr-…`)
 * is only accepted with the workspace named in a header. Claude Code reads
 * extra headers from `ANTHROPIC_CUSTOM_HEADERS`, one `Name: value` per line;
 * the owner's other headers are kept.
 */
function withWorkspace(headers: string | undefined, workspaceId: string): string {
  const others = (headers ?? "").split(/\r?\n/).filter((line) => line.trim() && !WORKSPACE_HEADER.test(line));
  return [...others, `anthropic-workspace-id: ${workspaceId}`].join("\n");
}

/** Only the fields that say whether credentials exist are read — never who the account belongs to. */
function isSignedIn(account: AccountInfo): boolean {
  const viaCloudProvider = (account.apiProvider ?? "firstParty") !== "firstParty";
  const hasKey = (account.apiKeySource ?? "none") !== "none";
  return viaCloudProvider || hasKey || account.tokenSource !== "none";
}

/** What a session needs to start Claude Code. */
interface Runtime extends Pick<ClaudeOptions, "apiKey" | "version" | "dataDir" | "sandbox" | "projectSettings"> {
  start: typeof startClaudeCode;
  env: Record<string, string | undefined>;
  executable: string | undefined;
}

class ClaudeSession implements EngineSession {
  /** Claude Code and the stream that feeds it. Null until the first message, and after it stops. */
  private live: { query: Query; feed: Feed<SDKUserMessage> } | null = null;
  /** Whether the running Claude Code has started a turn — until then, a failure is a failure to start. */
  private started = false;
  /** Whether a turn is under way: we sent something, or Claude Code woke up by itself (a background task ended). */
  private busy = false;
  private resume: string | null;
  /** The saved conversation could not be picked up: this start is a new one. */
  private startingOver = false;
  /** Messages sent and not yet answered, by the uuid Claude Code echoes back. */
  private readonly unanswered = new Map<UUID, string>();
  /** Tool call id → the activity it shows as. */
  private readonly activities = new Map<string, string>();
  /** What went wrong in this turn, as reported on the way: the kind of error and Claude Code's words for it. */
  private trouble: { kind: SDKAssistantMessageError; detail: string } | null = null;
  /** Set while the owner's interrupt waits for the turn to end. */
  private stopped: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly host: EngineHost,
    private readonly runtime: Runtime,
    private readonly onOutcome: (ready: boolean) => void,
  ) {
    this.resume = host.resume;
  }

  send(text: string): void {
    const uuid = randomUUID();
    this.unanswered.set(uuid, text);
    this.busy = true;
    this.feed().push(userMessage(text, uuid));
  }

  async interrupt(): Promise<void> {
    if (!this.live || !this.busy) return;
    const ended = new Promise<void>((resolve) => {
      this.stopped = resolve;
    });
    void this.live.query.interrupt().catch(() => {});
    // The interrupted turn normally ends with a result of its own.
    await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS).unref())]);
    if (!this.stopped) return;
    // It did not: stop Claude Code itself. The next message starts it again, resuming the conversation.
    this.shutDown();
    this.finish({ ok: false, text: "" });
  }

  close(): void {
    this.closed = true;
    this.shutDown();
  }

  /** The stream to Claude Code, starting it if needed. */
  private feed(): Feed<SDKUserMessage> {
    if (!this.live) {
      const feed = new Feed<SDKUserMessage>();
      const query = this.runtime.start({ prompt: feed, options: this.options() });
      this.live = { query, feed };
      this.started = false;
      void this.listen(query);
    }
    return this.live.feed;
  }

  private shutDown(): void {
    const live = this.live;
    this.live = null;
    live?.feed.end();
    live?.query.close();
  }

  private options(): Options {
    const { host } = this;
    const { apiKey, dataDir, sandbox, projectSettings } = this.runtime;
    return {
      cwd: host.cwd,
      model: host.model ?? undefined,
      resume: this.startingOver ? undefined : (this.resume ?? undefined),
      env: this.runtime.env,
      spawnClaudeCodeProcess: apiKey && CAN_PASS_PIPES ? withKeyOnAPipe(apiKey) : undefined,
      pathToClaudeCodeExecutable: this.runtime.executable,
      // The owner's own Claude Code settings apply. A folder the agent is sent to work in is something to
      // read: its hooks, servers and rules would run outside our policy, so they wait for the owner's say.
      settingSources: projectSettings ? ["user", "project", "local"] : ["user"],
      settings: { permissions: { deny: denyFolder(dataDir) } },
      // Shell commands, which no rule above can see into, are kept out by the operating system — at a price
      // (see docs/ARCHITECTURE.md), which is why the owner chooses.
      sandbox: sandbox
        ? { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { denyRead: [dataDir], denyWrite: [dataDir] } }
        : undefined,
      // Rendered fresh on every request, so a new name or language applies to a resumed conversation too.
      systemPrompt: { type: "preset", preset: "claude_code", append: host.persona, snapshot: false },
      includePartialMessages: true,
      permissionMode: "default",
      hooks: { PreToolUse: [{ hooks: [askEveryTime] }] },
      canUseTool: (tool, input, { mcpServer }) => this.authorize(tool, input, mcpServer),
      disallowedTools: TERMINAL_ONLY_TOOLS,
      mcpServers: {
        [TOOL_SERVER]: createSdkMcpServer({
          name: TOOL_SERVER,
          version: this.runtime.version,
          alwaysLoad: true,
          tools: host.tools.map((tool) => this.expose(tool)),
        }),
      },
    };
  }

  private expose(tool: AgentTool) {
    return sdkTool(tool.name, tool.description, tool.input, async (input) => {
      const result = await tool.run(input, this.host.toolContext());
      return { content: result.content, isError: result.isError };
    });
  }

  /**
   * Asks the core about a tool call. For a tool of a server from the owner's
   * configuration (anything but our own, in-process one), the core is also
   * told which server it is and what that server says of the tool.
   */
  private async authorize(tool: string, input: Record<string, unknown>, mcpServer?: { name: string; source: string }): Promise<PermissionResult> {
    const server = mcpServer && mcpServer.source !== "sdk" ? await this.describeServer(mcpServer.name, tool) : undefined;
    const verdict = await this.host.authorize({ tool: ownName(tool), input, ...(server ? { server } : {}) });
    return verdict.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: verdict.message };
  }

  /** A configured server, and what it declares about one of its tools (MCP annotations), when Claude Code can tell. */
  private async describeServer(name: string, tool: string): Promise<ToolServer> {
    const ownName = tool.split("__").at(-1);
    try {
      const servers = (await this.live?.query.mcpServerStatus()) ?? [];
      const annotations = servers.find((server) => server.name === name)?.tools?.find((candidate) => candidate.name === ownName)?.annotations;
      return { name, readOnly: annotations?.readOnly, destructive: annotations?.destructive };
    } catch {
      // Nothing declared is nothing known: the policy goes by the tool's name.
      return { name };
    }
  }

  /** Reads what Claude Code says until it stops, then deals with why it stopped. */
  private async listen(query: Query): Promise<void> {
    try {
      for await (const message of query) this.handle(message);
    } catch {
      // Claude Code exited; what that means depends on where we were, below.
    }
    if (this.live?.query !== query) return;
    this.shutDown();
    if (this.closed) return;

    if (!this.started && this.resume && !this.startingOver) {
      // The saved conversation is gone (moved folder, cleaned history): start a new one with the same
      // messages. The saved token is only replaced once that has worked.
      this.startingOver = true;
      for (const [uuid, text] of this.unanswered) this.feed().push(userMessage(text, uuid));
      return;
    }
    this.startingOver = false;
    if (this.busy) this.fail(this.trouble ?? { kind: "unknown", detail: "" });
  }

  private handle(message: SDKMessage): void {
    switch (message.type) {
      case "system":
        if (message.subtype !== "init") return;
        this.started = true;
        this.startingOver = false;
        if (message.session_id !== this.resume) {
          this.resume = message.session_id;
          this.host.saveResume(message.session_id);
        }
        return;
      case "stream_event": {
        const { event } = message;
        const typing = event.type === "content_block_delta" && event.delta.type === "text_delta" ? event.delta.text : "";
        if (typing && message.parent_tool_use_id === null) this.host.onDelta(typing);
        this.busy = true;
        return;
      }
      case "assistant":
        return this.onAssistant(message);
      case "user":
        return this.onToolResults(message.message.content);
      case "result":
        return this.onResult(message);
    }
  }

  private onAssistant(message: SDKAssistantMessage): void {
    this.busy = true;
    if (message.error) {
      // Claude Code's own wording ("run /login") means nothing here; ours is said when the turn ends.
      const detail = message.message.content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
      this.trouble = { kind: message.error, detail };
      return;
    }
    for (const block of message.message.content) {
      // What a sub-agent says is for the agent that delegated, not for the owner.
      if (block.type === "text" && message.parent_tool_use_id === null) this.host.onMessage(block.text);
      if (block.type === "tool_use") {
        const name = ownName(block.name);
        const input = block.input as Record<string, unknown>;
        const ours = this.host.tools.find((tool) => tool.name === name);
        const shown = describeToolCall(name, input, this.host.language, inspectCall(ours, input));
        if (shown) this.activities.set(block.id, this.host.onActivityStart(shown));
      }
    }
  }

  private onToolResults(content: SDKUserMessage["message"]["content"]): void {
    if (typeof content === "string") return;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const activity = this.activities.get(block.tool_use_id);
      if (!activity) continue;
      this.activities.delete(block.tool_use_id);
      this.host.onActivityEnd(activity, !block.is_error);
    }
  }

  private onResult(message: SDKResultMessage): void {
    // Claude Code could not even start: `listen` decides what to do once the stream ends.
    if (!this.started) return;
    const answered = message.user_message_uuids ?? [...this.unanswered.keys()];
    for (const uuid of answered) this.unanswered.delete(uuid as UUID);
    // A message sent meanwhile is still being answered: the turn is not over.
    if (this.unanswered.size > 0 && !this.stopped) return;

    if (message.subtype === "success" && !message.is_error && !this.trouble) {
      this.onOutcome(true);
      return this.finish({ ok: true, text: message.result });
    }
    const said = message.subtype === "success" ? message.result : message.errors.join(" ");
    const unauthorized = message.subtype === "success" && message.api_error_status === 401;
    const kind = this.trouble?.kind ?? (unauthorized ? "authentication_failed" : "unknown");
    this.fail({ kind, detail: `${this.trouble?.detail ?? ""} ${said}` });
  }

  /** Ends the turn on a failure, said in words the owner can act on. */
  private fail(trouble: { kind: SDKAssistantMessageError; detail: string }): void {
    const needsWorkspace = WORKSPACE_HEADER_MISSING.test(trouble.detail);
    const key = needsWorkspace ? "trouble.workspace" : (TROUBLE[trouble.kind] ?? "trouble.generic");
    const text = translator(this.host.language)(key);
    if (key === "trouble.auth" || key === "trouble.workspace") this.onOutcome(false);
    // An interrupted turn did not fail: the owner stopped it.
    if (!this.stopped) this.host.onMessage(text);
    this.finish({ ok: false, text });
  }

  private finish(result: TurnResult): void {
    const stopped = this.stopped;
    this.stopped = null;
    this.trouble = null;
    this.busy = false;
    this.unanswered.clear();
    this.activities.clear();
    this.host.onTurnEnd(stopped ? { ok: false, text: "" } : result);
    stopped?.();
  }
}

/** How the API says that a key came without the workspace it needs. */
const WORKSPACE_HEADER_MISSING = /anthropic-workspace-id|not scoped to a workspace/i;

const TROUBLE: Partial<Record<SDKAssistantMessageError, "trouble.auth" | "trouble.credit" | "trouble.busy">> = {
  authentication_failed: "trouble.auth",
  oauth_org_not_allowed: "trouble.auth",
  account_on_hold: "trouble.auth",
  verification_required: "trouble.auth",
  cloud_credential_error: "trouble.auth",
  billing_error: "trouble.credit",
  rate_limit: "trouble.busy",
  overloaded: "trouble.busy",
  server_error: "trouble.busy",
};

/** "ask_owner" from "mcp__agentos__ask_owner"; other names are left alone. */
function ownName(tool: string): string {
  return tool.startsWith(TOOL_PREFIX) ? tool.slice(TOOL_PREFIX.length) : tool;
}

function userMessage(text: string, uuid: UUID): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid };
}

/** An async stream fed by hand: what `send` pushes, Claude Code reads when it is ready. */
class Feed<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiting: ((next: IteratorResult<T>) => void) | null = null;
  private ended = false;

  push(item: T): void {
    if (this.waiting) {
      const deliver = this.waiting;
      this.waiting = null;
      deliver({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  end(): void {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}
