/** What the tests share: a core on a throwaway data directory, an API client and an event stream. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Computer, ComputerUnavailable } from "@agentos/computer";
import { type AgentTool, type Event, ServerFrame, defineTool } from "@agentos/protocol";
import { WebSocket } from "ws";
import { z } from "zod";
import { createMockEngine } from "../src/engine/mock.js";
import type { Engine, EngineHost } from "../src/engine/types.js";
import { type CoreHandle, type CoreOptions, startCore } from "../src/index.js";

// Tests decide their own configuration: nothing leaks in from the shell that runs them.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("AGENTOS_") || name.startsWith("ANTHROPIC_")) delete process.env[name];
}

/** A new, empty data directory. Never the real `~/.agentos`. */
export function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "agentos-test-"));
}

export interface TestCore extends CoreHandle {
  home: string;
  /** API client using the local token. */
  local: Api;
  /** Opens the event stream and waits for its `ready` frame. */
  stream(options?: { since?: number; token?: string }): Promise<Stream>;
  /** What the engine was given for a conversation, so a test can act as the engine would. */
  host(threadId: string): EngineHost;
}

/** A computer with no eyes or hands: tests never look at, or touch, the machine they run on. */
export const noComputer: Computer = {
  available: false,
  permissions: async () => ({ accessibility: false, screenRecording: false }),
  requestPermissions: async () => {},
  screenshot: async () => {
    throw new ComputerUnavailable();
  },
  tools: () => [],
  close: async () => {},
};

/** The buttons of the pretend computer's screen, by ref. Clicking "Pay now" is a serious matter. */
const BUTTONS: Record<string, string> = { e1: "Deploy", e2: "Pay now" };

/** A pretend computer: a fixed picture for a screen, one tool that looks and one that acts. */
export function fakeComputer(): Computer & { clicks: string[] } {
  const clicks: string[] = [];
  const tools: AgentTool[] = [
    defineTool({
      name: "computer_snapshot",
      description: "Describe the screen.",
      input: {},
      readOnly: true,
      run: async () => ({ content: [{ type: "text", text: "A desktop." }] }),
    }) as AgentTool,
    defineTool({
      name: "computer_click",
      description: "Click an element.",
      input: { ref: z.string() },
      readOnly: false,
      inspect: ({ ref }) => ({ target: BUTTONS[ref], risk: ref === "e2" ? "high" : undefined }),
      run: async ({ ref }) => {
        clicks.push(ref);
        return { content: [{ type: "text", text: "Clicked." }] };
      },
    }) as AgentTool,
    defineTool({
      name: "computer_close_app",
      description: "Quit an app.",
      input: { app: z.string() },
      readOnly: false,
      inspect: ({ app }) => ({ target: app, risk: "high" }),
      run: async ({ app }) => {
        clicks.push(`quit ${app}`);
        return { content: [{ type: "text", text: "Closed." }] };
      },
    }) as AgentTool,
  ];
  return {
    clicks,
    available: true,
    permissions: async () => ({ accessibility: true, screenRecording: true }),
    requestPermissions: async () => {},
    screenshot: async (options) => ({
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mime: "image/jpeg",
      width: options?.maxWidth ?? 1920,
      height: 1080,
    }),
    tools: () => tools,
    close: async () => {},
  };
}

/** Starts a core on a free port of the loopback interface, with the instant mock engine and no computer unless told otherwise. */
export async function startTestCore(options: CoreOptions = {}): Promise<TestCore> {
  const home = options.home ?? tempHome();
  const hosts = new Map<string, EngineHost>();
  const engine = remembering(options.engine ?? createMockEngine(0), hosts);
  const core = await startCore({ port: 0, host: "127.0.0.1", computer: noComputer, ...options, engine, home });
  const base = `http://127.0.0.1:${core.port}`;
  return {
    ...core,
    home,
    local: new Api(base, core.localToken),
    stream: ({ since, token = core.localToken } = {}) => Stream.open(base, token, since),
    host: (threadId) => {
      const host = hosts.get(threadId);
      if (!host) throw new Error(`The conversation ${threadId} is not open: say something in it first.`);
      return host;
    },
  };
}

/** An engine that notes the host of every conversation it opens. */
function remembering(engine: Engine, hosts: Map<string, EngineHost>): Engine {
  return {
    id: engine.id,
    status: () => engine.status(),
    open: (host) => {
      hosts.set(host.thread.id, host);
      return engine.open(host);
    },
  };
}

/** Calls one of a conversation's tools as the engine would, and returns the text it answered. */
export async function useTool(host: EngineHost, name: string, input: Record<string, unknown>): Promise<string> {
  const tool = host.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`There is no tool ${name} in ${host.thread.id}.`);
  const result = await tool.run(input, host.toolContext());
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** A minimal API client: returns the status and the parsed body, whatever they are. */
export class Api {
  constructor(
    readonly base: string,
    readonly token: string | null,
  ) {}

  /** The same API with another token (or none). */
  as(token: string | null): Api {
    return new Api(this.base, token);
  }

  async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const response = await fetch(this.base + path, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  get = (path: string) => this.call("GET", path);
  post = (path: string, body: unknown = {}) => this.call("POST", path, body);
  patch = (path: string, body: unknown) => this.call("PATCH", path, body);
}

type Ready = Extract<ServerFrame, { type: "ready" }>;

/** An open `WS /v1/events`. Every frame is checked against the protocol as it arrives. */
export class Stream {
  /** Events received, in order: replayed ones first. */
  readonly events: Event[] = [];
  /** How many of `events` arrived before the `ready` frame. */
  replayed = 0;
  ready!: Ready;
  private failure: Error | null = null;
  private wake: () => void = () => {};

  private constructor(private readonly socket: WebSocket) {}

  static open(base: string, token: string, since?: number): Promise<Stream> {
    const query = new URLSearchParams({ token, ...(since === undefined ? {} : { since: String(since) }) });
    const stream = new Stream(new WebSocket(`${base.replace("http", "ws")}/v1/events?${query}`));
    return new Promise((resolve, reject) => {
      stream.socket.on("error", reject);
      stream.socket.on("message", (data) => {
        try {
          const frame = ServerFrame.parse(JSON.parse(String(data)));
          if (frame.type === "event") stream.events.push(frame.event);
          if (frame.type === "ready") {
            stream.ready = frame;
            stream.replayed = stream.events.length;
            resolve(stream);
          }
        } catch (error) {
          stream.failure = error as Error;
        }
        stream.wake();
      });
    });
  }

  /** The first event from position `from` that matches, waiting for it if needed. */
  async find<T extends Event["type"]>(
    type: T,
    match: (event: Extract<Event, { type: T }>) => boolean = () => true,
    from = 0,
  ): Promise<Extract<Event, { type: T }>> {
    const deadline = Date.now() + 5000;
    for (;;) {
      if (this.failure) throw this.failure;
      const found = this.events.slice(from).find((event) => event.type === type && match(event as Extract<Event, { type: T }>));
      if (found) return found as Extract<Event, { type: T }>;
      if (Date.now() > deadline) throw new Error(`No ${type} event arrived. Seen: ${this.events.map((e) => e.type).join(", ")}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  /** Resolves with the close code when the computer ends the stream. */
  closed(): Promise<number> {
    return new Promise((resolve) => this.socket.once("close", (code) => resolve(code)));
  }

  /** Sends a client frame. */
  send(frame: unknown): void {
    this.socket.send(JSON.stringify(frame));
  }

  /** The next raw frame of a given type (for frames that are not events). */
  nextFrame(type: string): Promise<unknown> {
    return new Promise((resolve) => {
      const listen = (data: unknown): void => {
        const frame = JSON.parse(String(data));
        if (frame.type !== type) return;
        this.socket.off("message", listen);
        resolve(frame);
      };
      this.socket.on("message", listen);
    });
  }

  close(): void {
    this.socket.close();
  }
}
