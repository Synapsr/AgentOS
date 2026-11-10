/**
 * The Claude engine against a scripted Claude Code: how SDK messages become
 * what the owner sees, without spending a token.
 */
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Options, SDKUserMessage, query } from "@anthropic-ai/claude-agent-sdk";
import { defineTool, type AgentTool, type Thread } from "@agentos/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type ClaudeOptions, createClaudeEngine } from "../src/engine/claude.js";
import { tempHome } from "./harness.js";
import type { Authorization, EngineHost } from "../src/engine/types.js";

type Script = (said: () => Promise<SDKUserMessage | null>, options: Options, claude: FakeClaude) => AsyncGenerator<object>;

/** A stand-in for Claude Code: each start runs the script, which reads what is sent and yields SDK messages. */
class FakeClaude {
  /** Options of every start, in order. */
  readonly starts: Options[] = [];
  /** What `initializationResult()` reports about the account. */
  account: Record<string, string> = { apiProvider: "firstParty" };
  /** What `mcpServerStatus()` reports: the servers of the owner's configuration and their tools. */
  servers: object[] = [];
  interrupts = 0;
  private stop: () => void = () => {};
  /** Resolves when `interrupt()` is called. */
  interrupted = new Promise<void>((resolve) => (this.stop = resolve));

  constructor(private readonly script: Script) {}

  readonly query = ((params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    this.starts.push(params.options);
    const input = params.prompt[Symbol.asyncIterator]();
    const said = async (): Promise<SDKUserMessage | null> => {
      const next = await input.next();
      return next.done ? null : next.value;
    };
    return Object.assign(this.script(said, params.options, this), {
      interrupt: async () => {
        this.interrupts++;
        this.stop();
      },
      close: () => {},
      initializationResult: async () => ({ account: this.account }),
      mcpServerStatus: async () => this.servers,
    });
  }) as unknown as typeof query;
}

const init = (session_id: string) => ({ type: "system", subtype: "init", session_id });
const typing = (text: string, parent: string | null = null) => ({
  type: "stream_event",
  parent_tool_use_id: parent,
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
});
const says = (text: string, parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { content: [{ type: "text", text }] },
});
const uses = (id: string, name: string, input: object, parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const toolDone = (id: string, is_error = false) => ({
  type: "user",
  parent_tool_use_id: null,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error, content: "…" }] },
});
const done = (text: string, extra: object = {}) => ({ type: "result", subtype: "success", is_error: false, result: text, ...extra });
const apiError = (error: string, text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  error,
  message: { content: [{ type: "text", text }] },
});

const thread: Thread = {
  id: "main",
  kind: "main",
  title: "Nova",
  parentId: null,
  cwd: null,
  state: "idle",
  preview: null,
  createdAt: 0,
  updatedAt: 0,
};

/** A host that writes down everything the engine tells it. */
function recorder(overrides: Partial<EngineHost> = {}) {
  const log: unknown[][] = [];
  let turnEnded: () => void = () => {};
  const host: EngineHost = {
    thread,
    persona: "You are Nova.",
    cwd: "/work",
    model: "claude-haiku-5-5",
    language: "en",
    tools: [],
    resume: null,
    saveResume: (token) => log.push(["resume", token]),
    toolContext: () => ({ signal: new AbortController().signal, threadId: "main" }),
    onDelta: (text) => log.push(["delta", text]),
    onMessage: (text) => log.push(["message", text]),
    onActivityStart: (activity) => {
      log.push(["start", activity.label, activity.tool, activity.detail]);
      return `act-${activity.tool}`;
    },
    onActivityEnd: (id, ok) => log.push(["end", id, ok]),
    authorize: async (call) => {
      log.push(["authorize", call.tool, call.input]);
      return { allow: true };
    },
    onTurnEnd: (result) => {
      log.push(["turn", result.ok, result.text]);
      turnEnded();
    },
    ...overrides,
  };
  /** Resolves at the next `onTurnEnd`. */
  const turn = (): Promise<void> => new Promise((resolve) => (turnEnded = resolve));
  return { host, log, turn };
}

const engineFor = (
  claude: FakeClaude,
  apiKey: string | null = "sk-ant-test",
  workspaceId: string | null = null,
  executable: string | null = null,
  more: Partial<ClaudeOptions> = {},
) =>
  createClaudeEngine({
    apiKey,
    workspaceId,
    executable,
    version: "1.2.3",
    dataDir: "/data/agentos",
    secretVariables: ["ELEVENLABS_API_KEY"],
    sandbox: false,
    projectSettings: false,
    query: claude.query,
    ...more,
  });

/** Answers every message with one line. */
const echo: Script = async function* (said) {
  for (let message = await said(); message; message = await said()) {
    yield init("session-1");
    yield done(`Heard: ${message.message.content as string}`, { user_message_uuids: [message.uuid] });
  }
};

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("a turn", () => {
  it("streams what Claude types, then the message, then hands back", async () => {
    const claude = new FakeClaude(async function* (said) {
      const message = await said();
      yield init("session-1");
      yield typing("All ");
      yield typing("done.");
      yield says("All done.");
      yield done("All done.", { user_message_uuids: [message?.uuid] });
      await said();
    });
    const { host, log, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("tidy up", "message");
    await turn();

    expect(log).toEqual([
      ["resume", "session-1"],
      ["delta", "All "],
      ["delta", "done."],
      ["message", "All done."],
      ["turn", true, "All done."],
    ]);
    session.close();
  });

  it("starts Claude Code as the agent: persona, folder, model, our rules", async () => {
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();

    const options = claude.starts[0];
    expect(options).toMatchObject({
      cwd: "/work",
      model: "claude-haiku-5-5",
      resume: undefined,
      includePartialMessages: true,
      permissionMode: "default",
      systemPrompt: { type: "preset", preset: "claude_code", append: "You are Nova." },
      disallowedTools: expect.arrayContaining(["AskUserQuestion"]),
      // The owner's own Claude Code settings, not those of whatever folder the agent is sent to.
      settingSources: ["user"],
      // Claude Code's file tools are kept out of AgentOS's own data.
      settings: { permissions: { deny: ["Read(//data/agentos/**)", "Edit(//data/agentos/**)"] } },
      sandbox: undefined,
    });
    expect(Object.keys(options?.mcpServers ?? {})).toEqual(["agentos"]);
    expect(options?.env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("agentos/1.2.3");
    // The binary that comes with the SDK, unless an app ships its own.
    expect(options?.pathToClaudeCodeExecutable).toBeUndefined();
    session.close();
  });

  it("runs the Claude Code binary an app ships with it, for turns and for the handshake alike", async () => {
    const claude = new FakeClaude(echo);
    const engine = engineFor(claude, null, null, "/Applications/AgentOS.app/Contents/Resources/claude");
    await engine.status();
    const { host, turn } = recorder();
    const session = engine.open(host);
    session.send("hello", "message");
    await turn();
    expect(claude.starts.map((options) => options.pathToClaudeCodeExecutable)).toEqual([
      "/Applications/AgentOS.app/Contents/Resources/claude",
      "/Applications/AgentOS.app/Contents/Resources/claude",
    ]);
    session.close();
  });

  it("is one conversation: Claude Code is started once and fed message by message", async () => {
    const claude = new FakeClaude(echo);
    const { host, log, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("one", "message");
    await turn();
    session.send("two", "message");
    await turn();
    expect(claude.starts.length).toBe(1);
    expect(log.filter(([kind]) => kind === "turn")).toEqual([
      ["turn", true, "Heard: one"],
      ["turn", true, "Heard: two"],
    ]);
    session.close();
  });

  it("resumes the conversation it is given", async () => {
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder({ resume: "session-1" });
    const session = engineFor(claude).open(host);
    session.send("hello again", "message");
    await turn();
    expect(claude.starts[0]?.resume).toBe("session-1");
    session.close();
  });

  it("is not over while a message sent meanwhile is still being answered", async () => {
    const claude = new FakeClaude(async function* (said) {
      const first = await said();
      const second = await said();
      yield init("session-1");
      yield says("First.");
      yield done("First.", { user_message_uuids: [first?.uuid] });
      yield says("Second.");
      yield done("Second.", { user_message_uuids: [second?.uuid] });
      await said();
    });
    const { host, log, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("one", "message");
    session.send("and another thing", "message");
    await turn();
    expect(log.filter(([kind]) => kind !== "resume")).toEqual([
      ["message", "First."],
      ["message", "Second."],
      ["turn", true, "Second."],
    ]);
    session.close();
  });
});

describe("what Claude does", () => {
  it("shows as activities, in words", async () => {
    const claude = new FakeClaude(async function* (said) {
      const message = await said();
      yield init("session-1");
      yield uses("t1", "Bash", { command: "npm test", description: "Running the tests" });
      yield toolDone("t1");
      yield uses("t2", "Read", { file_path: "/work/package.json" });
      yield toolDone("t2");
      yield uses("t3", "Edit", { file_path: "/work/src/app.ts" });
      yield toolDone("t3", true);
      yield uses("t4", "Bash", { command: "ls -la /work" });
      yield toolDone("t4");
      yield uses("t5", "mcp__agentos__start_job", { title: "Fix the login page", prompt: "…" });
      yield toolDone("t5");
      yield uses("t6", "mcp__agentos__ask_owner", { question: "Deploy?" });
      yield toolDone("t6");
      yield uses("t7", "TodoWrite", { todos: [] });
      yield toolDone("t7");
      yield uses("t8", "mcp__agentos__computer_open_app", { app: "Safari" });
      yield toolDone("t8");
      yield done("Done.", { user_message_uuids: [message?.uuid] });
      await said();
    });
    const { host, log, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("go", "message");
    await turn();

    expect(log.filter(([kind]) => kind === "start" || kind === "end")).toEqual([
      ["start", "Running the tests", "Bash", "npm test"],
      ["end", "act-Bash", true],
      ["start", "Reading package.json", "Read", "/work/package.json"],
      ["end", "act-Read", true],
      ["start", "Editing app.ts", "Edit", "/work/src/app.ts"],
      ["end", "act-Edit", false],
      ["start", "ls -la /work", "Bash", "ls -la /work"],
      ["end", "act-Bash", true],
      ["start", "Starting in the background: Fix the login page", "start_job", null],
      ["end", "act-start_job", true],
      // Asking the owner shows as a request, and bookkeeping does not show at all.
      ["start", "Opening Safari", "computer_open_app", null],
      ["end", "act-computer_open_app", true],
    ]);
    session.close();
  });

  it("names what a tool acts on, when the tool can tell", async () => {
    const click = defineTool({
      name: "computer_click",
      description: "Click an element.",
      input: {},
      readOnly: false,
      inspect: () => ({ target: "Deploy" }),
      run: async () => ({ content: [{ type: "text", text: "Clicked." }] }),
    }) as AgentTool;
    const claude = new FakeClaude(async function* (said) {
      const message = await said();
      yield init("session-1");
      yield uses("t1", "mcp__agentos__computer_click", { ref: "@s1:e12" });
      yield toolDone("t1");
      yield done("Clicked.", { user_message_uuids: [message?.uuid] });
      await said();
    });
    for (const [language, label] of [["en", "Clicking “Deploy”"], ["fr", "Clic sur « Deploy »"]] as const) {
      const { host, log, turn } = recorder({ tools: [click], language });
      const session = engineFor(claude).open(host);
      session.send("deploy", "message");
      await turn();
      expect(log.find(([kind]) => kind === "start")).toEqual(["start", label, "computer_click", null]);
      session.close();
    }
  });

  it("keeps a sub-agent's words from the owner, but shows its work", async () => {
    const claude = new FakeClaude(async function* (said) {
      const message = await said();
      yield init("session-1");
      yield uses("t1", "Agent", { description: "Find the bug", prompt: "…" });
      yield typing("I am the sub-agent", "t1");
      yield says("I am the sub-agent, thinking aloud.", "t1");
      yield uses("t2", "Grep", { pattern: "login" }, "t1");
      yield toolDone("t2");
      yield toolDone("t1");
      yield says("Found it.");
      yield done("Found it.", { user_message_uuids: [message?.uuid] });
      await said();
    });
    const { host, log, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("find the bug", "message");
    await turn();

    expect(log.filter(([kind]) => kind !== "resume")).toEqual([
      ["start", "Delegating: Find the bug", "Agent", null],
      ["start", "Searching for login", "Grep", null],
      ["end", "act-Grep", true],
      ["end", "act-Agent", true],
      ["message", "Found it."],
      ["turn", true, "Found it."],
    ]);
    session.close();
  });

  it("goes through the core's authorization for every tool, under the tool's own name", async () => {
    const claude = new FakeClaude(echo);
    const verdicts: Authorization[] = [{ allow: true }, { allow: false, message: "Your owner did not approve this." }];
    const { host, log, turn } = recorder({
      authorize: async (call) => {
        log.push(["authorize", call.tool, call.input]);
        return verdicts.shift() ?? { allow: true };
      },
    });
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();

    const { canUseTool, hooks } = claude.starts[0] ?? {};
    const extra = { signal: new AbortController().signal, toolUseID: "t1", requestId: "r1" };
    expect(await canUseTool?.("Bash", { command: "echo hello" }, extra)).toEqual({
      behavior: "allow",
      updatedInput: { command: "echo hello" },
    });
    expect(await canUseTool?.("mcp__agentos__computer_click", { ref: "e1" }, extra)).toEqual({
      behavior: "deny",
      message: "Your owner did not approve this.",
    });
    expect(log.filter(([kind]) => kind === "authorize")).toEqual([
      ["authorize", "Bash", { command: "echo hello" }],
      ["authorize", "computer_click", { ref: "e1" }],
    ]);
    // Claude Code is told to ask every time, so that nothing skips the policy.
    const hook = hooks?.PreToolUse?.[0]?.hooks[0];
    expect(await hook?.({} as never, "t1", { signal: extra.signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" },
    });
    session.close();
  });

  it("tells the core which configured server a tool comes from, and what that server declares of it", async () => {
    const claude = new FakeClaude(echo);
    claude.servers = [
      {
        name: "easypanel",
        status: "connected",
        tools: [
          { name: "deploy_service", annotations: { destructive: true } },
          { name: "service_logs", annotations: { readOnly: true } },
          { name: "set_env" },
        ],
      },
    ];
    const servers: unknown[] = [];
    const { host, log, turn } = recorder({
      authorize: async (call) => {
        log.push(["authorize", call.tool, call.input]);
        servers.push(call.server ?? null);
        return { allow: true };
      },
    });
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();
    const { canUseTool } = claude.starts[0] ?? {};
    const from = (name: string, source: string) => ({
      signal: new AbortController().signal,
      toolUseID: "t1",
      requestId: "r1",
      mcpServer: { name, source },
    });
    await canUseTool?.("mcp__easypanel__deploy_service", { service: "web" }, from("easypanel", "user"));
    await canUseTool?.("mcp__easypanel__service_logs", {}, from("easypanel", "user"));
    await canUseTool?.("mcp__easypanel__set_env", {}, from("easypanel", "user"));
    await canUseTool?.("mcp__claude_ai_Gmail__send_message", {}, from("claude.ai Gmail", "claudeai"));
    // Our own in-process server is ours: no server to tell about.
    await canUseTool?.("mcp__agentos__ask_owner", {}, from("agentos", "sdk"));
    expect(log.filter(([kind]) => kind === "authorize").map(([, tool]) => tool)).toEqual([
      "mcp__easypanel__deploy_service",
      "mcp__easypanel__service_logs",
      "mcp__easypanel__set_env",
      "mcp__claude_ai_Gmail__send_message",
      "ask_owner",
    ]);
    expect(servers).toEqual([
      { name: "easypanel", readOnly: undefined, destructive: true },
      { name: "easypanel", readOnly: true, destructive: undefined },
      { name: "easypanel", readOnly: undefined, destructive: undefined },
      { name: "claude.ai Gmail", readOnly: undefined, destructive: undefined },
      null,
    ]);
    session.close();
  });

  it("offers the core's tools to Claude through one in-process server", async () => {
    const note = defineTool({
      name: "note",
      description: "Write a note.",
      input: {},
      readOnly: false,
      run: async () => ({ content: [{ type: "text", text: "Noted." }] }),
    }) as AgentTool;
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder({ tools: [note] });
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();
    expect(claude.starts[0]?.mcpServers?.agentos).toMatchObject({ type: "sdk", name: "agentos" });
    session.close();
  });
});

describe("when it goes wrong", () => {
  it("says it cannot reach its brain when the credentials are refused", async () => {
    const claude = new FakeClaude(async function* (said) {
      for (let message = await said(); message; message = await said()) {
        yield init("session-1");
        if (message.message.content === "hello") {
          yield apiError("authentication_failed", "Invalid API key · Please run /login");
          yield { ...done("Invalid API key · Please run /login", { user_message_uuids: [message.uuid] }), is_error: true };
        } else {
          yield done("Back.", { user_message_uuids: [message.uuid] });
        }
      }
    });
    const { host, log, turn } = recorder();
    const engine = engineFor(claude);
    expect(await engine.status()).toEqual({ ready: true, auth: "api-key" });
    const session = engine.open(host);
    session.send("hello", "message");
    await turn();

    const said = "I can't reach my brain — add an API key in Settings.";
    expect(log.filter(([kind]) => kind !== "resume")).toEqual([
      ["message", said],
      ["turn", false, said],
    ]);
    expect(await engine.status()).toEqual({ ready: false, auth: "api-key" });

    // A turn that works is the proof that it is back.
    session.send("and now?", "message");
    await turn();
    expect(await engine.status()).toEqual({ ready: true, auth: "api-key" });
    session.close();
  });

  it("says the key needs its workspace when the API asks for one", async () => {
    const refusal =
      'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header"}}';
    const claude = new FakeClaude(async function* (said) {
      const message = await said();
      yield init("session-1");
      yield apiError("invalid_request", refusal);
      yield { ...done(refusal, { user_message_uuids: [message?.uuid], api_error_status: 400 }), is_error: true };
      await said();
    });
    const { host, log, turn } = recorder({ language: "fr" });
    const session = engineFor(claude).open(host);
    session.send("bonjour", "message");
    await turn();
    expect(log.at(-1)).toEqual(["turn", false, "Ma clé API a besoin d'un identifiant d'espace de travail — ajoutez-le dans les Réglages."]);
    session.close();
  });

  it.each([
    ["rate_limit", "My brain is overloaded right now. Try again in a moment."],
    ["billing_error", "I've run out of credit — top up the account behind my API key."],
    ["unknown", "Something went wrong on my side. Shall we try again?"],
  ])("puts %s in words the owner can act on", async (error, words) => {
    const claude = new FakeClaude(async function* (said) {
      const message = await said();
      yield init("session-1");
      yield apiError(error, "API Error");
      yield { ...done("API Error", { user_message_uuids: [message?.uuid] }), is_error: true };
      await said();
    });
    const { host, log, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();
    expect(log.at(-1)).toEqual(["turn", false, words]);
    session.close();
  });

  it("starts a new conversation when the one to resume is gone", async () => {
    const claude = new FakeClaude(async function* (said, options) {
      if (options.resume) {
        yield { type: "result", subtype: "error_during_execution", is_error: true, errors: [`No conversation found with session ID: ${options.resume}`] };
        throw new Error("Claude Code returned an error result");
      }
      const message = await said();
      yield init("session-2");
      yield done(`Heard: ${message?.message.content as string}`, { user_message_uuids: [message?.uuid] });
      await said();
    });
    const { host, log, turn } = recorder({ resume: "session-gone" });
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();

    expect(claude.starts.map((options) => options.resume)).toEqual(["session-gone", undefined]);
    expect(log).toEqual([
      ["resume", "session-2"],
      ["turn", true, "Heard: hello"],
    ]);
    session.close();
  });

  it("keeps the saved conversation when Claude Code cannot start at all", async () => {
    const claude = new FakeClaude(async function* () {
      yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Claude Code could not start"] };
      throw new Error("Claude Code returned an error result");
    });
    const { host, log, turn } = recorder({ resume: "session-1" });
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();
    // Tried to resume, then to start over; neither worked, and the token was not thrown away.
    expect(claude.starts.map((options) => options.resume)).toEqual(["session-1", undefined]);
    expect(log).toEqual([
      ["message", "Something went wrong on my side. Shall we try again?"],
      ["turn", false, "Something went wrong on my side. Shall we try again?"],
    ]);
    session.send("hello?", "message");
    await turn();
    expect(claude.starts.map((options) => options.resume)).toEqual(["session-1", undefined, "session-1", undefined]);
    session.close();
  });

  it("reports a turn that Claude Code did not survive, and starts it again for the next message", async () => {
    let crashed = false;
    const claude = new FakeClaude(async function* (said) {
      const message = await said();
      yield init("session-1");
      if (!crashed) {
        crashed = true;
        yield uses("t1", "Bash", { command: "sleep 100" });
        throw new Error("Claude Code process exited with code 1");
      }
      yield done("Back.", { user_message_uuids: [message?.uuid] });
      await said();
    });
    const { host, log, turn } = recorder();
    const session = engineFor(claude).open(host);
    session.send("hello", "message");
    await turn();
    expect(log.at(-1)).toEqual(["turn", false, "Something went wrong on my side. Shall we try again?"]);

    session.send("are you there?", "message");
    await turn();
    expect(log.at(-1)).toEqual(["turn", true, "Back."]);
    expect(claude.starts.map((options) => options.resume)).toEqual([undefined, "session-1"]);
    session.close();
  });
});

describe("an interrupt", () => {
  it("stops the turn without calling it a failure", async () => {
    const claude = new FakeClaude(async function* (said, _options, self) {
      const message = await said();
      yield init("session-1");
      yield uses("t1", "Bash", { command: "sleep 100" });
      await self.interrupted;
      yield { type: "result", subtype: "error_during_execution", is_error: true, errors: [], user_message_uuids: [message?.uuid] };
      await said();
    });
    const { host, log } = recorder();
    const session = engineFor(claude).open(host);
    session.send("wait a long time", "message");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.interrupt();

    expect(claude.interrupts).toBe(1);
    expect(log.filter(([kind]) => kind === "message" || kind === "turn")).toEqual([["turn", false, ""]]);
    // Nothing to interrupt any more.
    await session.interrupt();
    expect(claude.interrupts).toBe(1);
    session.close();
  });
});

describe("what Claude Code is kept from", () => {
  it("lets a project folder's own settings apply only when the owner says so", async () => {
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder();
    const session = engineFor(claude, "sk-ant-test", null, null, { projectSettings: true }).open(host);
    session.send("hello", "message");
    await turn();
    expect(claude.starts[0]?.settingSources).toEqual(["user", "project", "local"]);
    session.close();
  });

  it("runs commands in the sandbox, with the data folder closed, when the owner chooses that", async () => {
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder();
    const session = engineFor(claude, "sk-ant-test", null, null, { sandbox: true }).open(host);
    session.send("hello", "message");
    await turn();
    expect(claude.starts[0]?.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyRead: ["/data/agentos"], denyWrite: ["/data/agentos"] },
    });
    session.close();
  });

  it("denies the data folder under its real name too, when it is reached through a link", async () => {
    const dataDir = tempHome();
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder();
    const session = engineFor(claude, "sk-ant-test", null, null, { dataDir }).open(host);
    session.send("hello", "message");
    await turn();
    const deny = claude.starts[0]?.settings as { permissions: { deny: string[] } };
    expect(deny.permissions.deny).toContain(`Read(/${dataDir}/**)`);
    expect(deny.permissions.deny).toContain(`Edit(/${realpathSync(dataDir)}/**)`);
    session.close();
  });

  it("leaves AgentOS's own secrets out of the environment its commands inherit", async () => {
    process.env.AGENTOS_RELAY_TOKEN = "relay-secret";
    process.env.AGENTOS_APNS_KEY = "push-secret";
    process.env.AGENTOS_HOME = "/data/agentos";
    process.env.ELEVENLABS_API_KEY = "voice-secret";
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-the-shell";
    process.env.SOMETHING_OF_THE_OWNERS = "kept";
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder();
    const session = engineFor(claude, "sk-ant-from-the-shell").open(host);
    session.send("hello", "message");
    await turn();
    const env = claude.starts[0]?.env ?? {};
    expect(Object.keys(env).filter((name) => name.startsWith("AGENTOS_"))).toEqual([]);
    expect(env.ELEVENLABS_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(JSON.stringify(env)).not.toMatch(/relay-secret|push-secret|voice-secret|sk-ant-from-the-shell/);
    expect(env.SOMETHING_OF_THE_OWNERS).toBe("kept");
    expect(env.PATH).toBe(process.env.PATH);
    session.close();
  });
});

describe("credentials", () => {
  it.skipIf(process.platform === "win32")("hands Claude Code the API key on a pipe of its own, never in its environment", async () => {
    process.env.ANTHROPIC_CUSTOM_HEADERS = "x-team: blue\nanthropic-workspace-id: wrkspc_old";
    process.env.SOMETHING_OF_THE_OWNERS = "kept";
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder();
    const session = engineFor(claude, "sk-ant-usr-test", "wrkspc_new").open(host);
    session.send("hello", "message");
    await turn();
    const options = claude.starts[0];
    expect(options?.env).toMatchObject({
      ANTHROPIC_CUSTOM_HEADERS: "x-team: blue\nanthropic-workspace-id: wrkspc_new",
      SOMETHING_OF_THE_OWNERS: "kept",
    });
    expect(options?.env?.ANTHROPIC_API_KEY).toBeUndefined();

    // What stands in for Claude Code here says what it was given, and how.
    const script = join(tempHome(), "stand-in.mjs");
    writeFileSync(
      script,
      `import { readFileSync } from "node:fs";
       const where = Number(process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR);
       console.log(JSON.stringify({ where, onThePipe: readFileSync(where, "utf8"), inTheEnvironment: process.env.ANTHROPIC_API_KEY ?? null }));`,
    );
    const child = options?.spawnClaudeCodeProcess?.({ command: process.execPath, args: [script], env: options.env ?? {}, signal: new AbortController().signal });
    let printed = "";
    child?.stdout.on("data", (chunk) => (printed += chunk));
    await new Promise((resolve) => child?.once("exit", resolve));
    expect(JSON.parse(printed)).toEqual({ where: 3, onThePipe: "sk-ant-usr-test", inTheEnvironment: null });
    session.close();
  });

  it("hands over nothing of its own when there is no key: Claude Code uses what the computer has", async () => {
    process.env.ANTHROPIC_CUSTOM_HEADERS = "x-team: blue";
    delete process.env.ANTHROPIC_API_KEY;
    const claude = new FakeClaude(echo);
    const { host, turn } = recorder();
    const session = engineFor(claude, null, "wrkspc_unused").open(host);
    session.send("hello", "message");
    await turn();
    const env = claude.starts[0]?.env ?? {};
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe("x-team: blue");
    // No key of ours, no pipe: Claude Code starts the ordinary way.
    expect(claude.starts[0]?.spawnClaudeCodeProcess).toBeUndefined();
    session.close();
  });

  it("knows whether it can answer without sending anything to the model", async () => {
    const neverSpoken: Script = async function* (said) {
      // If the engine sent a prompt just to check, this would yield a turn.
      const message = await said();
      if (message) yield done("A prompt was sent.");
    };
    const signedIn = new FakeClaude(neverSpoken);
    const engine = engineFor(signedIn, null);
    expect(await engine.status()).toEqual({ ready: true, auth: "environment" });
    expect(await engine.status()).toEqual({ ready: true, auth: "environment" });
    // Asked once, with nothing of the owner's loaded and nothing saved.
    expect(signedIn.starts.length).toBe(1);
    expect(signedIn.starts[0]).toMatchObject({ persistSession: false, strictMcpConfig: true });

    const signedOut = new FakeClaude(neverSpoken);
    signedOut.account = { tokenSource: "none", apiProvider: "firstParty" };
    expect(await engineFor(signedOut, null).status()).toEqual({ ready: false, auth: "none" });

    const cloud = new FakeClaude(neverSpoken);
    cloud.account = { tokenSource: "none", apiProvider: "bedrock" };
    expect(await engineFor(cloud, null).status()).toEqual({ ready: true, auth: "environment" });

    const withKey = new FakeClaude(neverSpoken);
    expect(await engineFor(withKey, "sk-ant-test").status()).toEqual({ ready: true, auth: "api-key" });
    expect(withKey.starts.length).toBe(0);
  });
});
