import { describe, expect, it } from "vitest";
import type {
  ActivityItem,
  Event,
  Item,
  MessageItem,
  NodeInfo,
  NodeStatus,
  RequestItem,
  ServerFrame,
  Settings,
  Thread,
} from "@agentos/protocol";
import { ApiFailure, type Client } from "./client";
import { createStore, emptyState, reduce, type State } from "./store";

const node: NodeInfo = {
  id: "node_1",
  name: "Studio Mac",
  platform: "macos",
  version: "0.1.0",
  protocol: 1,
  agent: { name: "Nova" },
  owner: { name: "Alex" },
  language: "en",
  autonomy: "balanced",
  onboarded: true,
  capabilities: {
    computer: true,
    engine: "mock",
    engineReady: true,
    voice: { provider: "device", stt: "device", tts: "device", ttsMime: null },
  },
};
const idle: NodeStatus = { state: "idle", activity: null, mode: "desktop", pendingRequests: 0, workingThreads: 0 };
const main: Thread = {
  id: "main",
  kind: "main",
  title: "Nova",
  parentId: null,
  cwd: null,
  state: "idle",
  preview: null,
  createdAt: 1,
  updatedAt: 1,
};

const message = (id: string, text: string, role: MessageItem["role"] = "agent"): MessageItem => ({
  id,
  threadId: "main",
  at: 1,
  type: "message",
  role,
  text,
  via: "text",
  deviceId: null,
  files: [],
});
const activity = (id: string, state: ActivityItem["state"]): ActivityItem => ({
  id,
  threadId: "main",
  at: 1,
  type: "activity",
  label: "Running the tests",
  tool: null,
  detail: null,
  state,
  endedAt: state === "running" ? null : 2,
});
const request = (id: string, state: RequestItem["state"]): RequestItem => ({
  id,
  threadId: "main",
  at: 1,
  type: "request",
  kind: "approval",
  title: "Send the email?",
  body: null,
  spoken: "Shall I send the email?",
  risk: "medium",
  screenshot: null,
  options: [
    { id: "approve", label: "Go ahead", style: "primary" },
    { id: "deny", label: "Stop", style: "danger" },
  ],
  allowText: false,
  state,
  resolution: state === "resolved" ? { optionId: "approve", text: null, deviceId: null, at: 2 } : null,
});

const added = (seq: number, item: Item): Event => ({ type: "item.added", seq, at: 1, item });
const updated = (seq: number, item: Item): Event => ({ type: "item.updated", seq, at: 1, item });
const delta = (messageId: string, text: string): Event => ({
  type: "message.delta",
  seq: 0,
  at: 1,
  threadId: "main",
  messageId,
  text,
});

/** A state where the main conversation is open and empty. */
const opened: State = { ...emptyState, phase: "ready", threads: [main], items: { main: [] } };
const run = (state: State, ...events: Event[]) => events.reduce(reduce, state);

describe("reduce", () => {
  it("appends items in order and remembers where it is", () => {
    const state = run(opened, added(1, message("msg_1", "Hello", "user")), added(2, message("msg_2", "Hi.")));
    expect(state.items.main?.map((item) => item.id)).toEqual(["msg_1", "msg_2"]);
    expect(state.seq).toBe(2);
  });

  it("ignores events it has already applied (replay)", () => {
    const events = [added(1, message("msg_1", "Hello")), added(2, activity("act_1", "running"))];
    const once = run(opened, ...events);
    const twice = run(once, ...events, updated(3, activity("act_1", "done")));
    expect(twice.items.main).toHaveLength(2);
    expect(twice.items.main?.[1]).toMatchObject({ id: "act_1", state: "done" });
    expect(twice.seq).toBe(3);
  });

  it("does not duplicate an item that both HTTP and the stream delivered", () => {
    const loaded: State = { ...opened, items: { main: [message("msg_1", "Hello")] } };
    expect(run(loaded, added(4, message("msg_1", "Hello"))).items.main).toHaveLength(1);
  });

  it("merges deltas into a draft, then replaces it with the final message", () => {
    const typing = run(opened, delta("msg_9", "On "), delta("msg_9", "it."));
    expect(typing.typing.main).toEqual({ messageId: "msg_9", text: "On it." });
    expect(typing.seq).toBe(0);

    const done = run(typing, added(1, message("msg_9", "On it.")));
    expect(done.typing.main).toBeUndefined();
    expect(done.items.main).toEqual([message("msg_9", "On it.")]);
  });

  it("starts a new draft when another message begins, and drops a draft cut short", () => {
    const state = run(opened, delta("msg_1", "First"), delta("msg_2", "Second"));
    expect(state.typing.main).toEqual({ messageId: "msg_2", text: "Second" });
    const ended = run(state, { type: "turn.completed", seq: 1, at: 1, threadId: "main", ok: false, text: "" });
    expect(ended.typing.main).toBeUndefined();
  });

  it("tracks a request from pending to resolved", () => {
    const asked = run(opened, added(1, request("req_1", "pending")));
    expect(asked.requests.map((r) => r.id)).toEqual(["req_1"]);

    const answered = run(asked, updated(2, request("req_1", "resolved")));
    expect(answered.requests).toEqual([]);
    expect(answered.items.main?.[0]).toMatchObject({ id: "req_1", state: "resolved" });
  });

  it("keeps pending requests of threads that are not open", () => {
    const job = { ...request("req_2", "pending"), threadId: "thr_job" };
    const state = run(opened, added(1, job));
    expect(state.requests).toEqual([job]);
    expect(state.items.thr_job).toBeUndefined();
    expect(run(state, updated(2, { ...job, state: "cancelled" })).requests).toEqual([]);
  });

  it("follows status, node and thread changes", () => {
    const working: NodeStatus = { ...idle, state: "working", activity: "Running the tests", workingThreads: 1 };
    const job: Thread = { ...main, id: "thr_job", kind: "job", title: "Website", parentId: "main" };
    const state = run(
      opened,
      { type: "node.status", seq: 1, at: 1, status: working },
      { type: "node.updated", seq: 2, at: 1, node: { ...node, agent: { name: "Iris" } } },
      { type: "thread.updated", seq: 3, at: 1, thread: job },
      { type: "thread.updated", seq: 4, at: 1, thread: { ...job, state: "working" } },
    );
    expect(state.status).toEqual(working);
    expect(state.node?.agent.name).toBe("Iris");
    expect(state.threads).toEqual([main, { ...job, state: "working" }]);

    const gone = run(state, { type: "thread.deleted", seq: 5, at: 1, threadId: "thr_job" });
    expect(gone.threads).toEqual([main]);
  });
});

const settings: Settings = {
  engine: { provider: "mock", model: null, auth: "none", hasWorkspaceId: false, ready: true },
  voice: { provider: "device", voice: null, hasKey: false, url: null, available: [] },
  computer: { permissions: { accessibility: true, screenRecording: true } },
  network: { port: 4747, urls: ["http://192.168.1.2:4747"], relayUrl: null, relayConnected: false, relayError: null, hasRelayToken: false },
};

/** A computer made of arrays: what HTTP would answer, and a handle on the stream. */
function fakeComputer(items: Item[]) {
  let onFrame: (frame: ServerFrame) => void = () => {};
  const waiting: Array<() => void> = [];
  const never = () => Promise.reject(new ApiFailure("internal", "not used"));
  const computer = {
    items,
    /** Whether the client holds the local token. */
    local: false,
    /** When true, `GET items` answers only once `release()` is called. */
    slow: false,
    /** When true, nothing over HTTP gets through. */
    unreachable: false,
    /** Every HTTP call made, by name. */
    calls: [] as string[],
    event: (event: Event) => onFrame({ type: "event", event }),
    ready: (seq: number, reset = false) => onFrame({ type: "ready", seq, reset, node, status: idle, local: computer.local }),
    release: () => waiting.splice(0).forEach((resolve) => resolve()),
  };
  const reach = (call: string) => {
    computer.calls.push(call);
    if (computer.unreachable) throw new ApiFailure("network", "unreachable");
  };
  const client: Client = {
    async node() {
      reach("node");
      return { node, status: idle, local: computer.local };
    },
    async updateNode(patch) {
      reach("updateNode");
      return { node: { ...node, agent: { name: patch.agentName ?? node.agent.name } }, status: idle, local: computer.local };
    },
    async settings() {
      reach("settings");
      if (!computer.local) throw new ApiFailure("forbidden", "local only");
      return settings;
    },
    async threads() {
      reach("threads");
      return [main];
    },
    async requests() {
      reach("requests");
      return computer.items.filter((item): item is RequestItem => item.type === "request" && item.state === "pending");
    },
    async items(threadId) {
      reach(`items ${threadId}`);
      const snapshot = computer.items.filter((item) => item.threadId === threadId);
      if (computer.slow) await new Promise<void>((resolve) => waiting.push(resolve));
      return { thread: { ...main, id: threadId }, items: snapshot, hasMore: false };
    },
    events(_since, handler) {
      onFrame = handler;
      return () => {};
    },
    setMode: never,
    updateSettings: never,
    requestPermissions: never,
    createPairingCode: never,
    devices: never,
    removeDevice: never,
    send: never,
    interrupt: never,
    resolve: never,
    fileUrl: never,
  };
  return { computer, client };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("store", () => {
  it("loads over HTTP on the first ready, as a device", async () => {
    const { computer, client } = fakeComputer([message("msg_1", "Hello")]);
    const store = createStore(client);
    store.start();
    expect(store.getState().phase).toBe("connecting");

    computer.ready(7);
    await settled();
    expect(store.getState()).toMatchObject({ phase: "ready", online: true, local: false, seq: 7, node, threads: [main] });
    expect(store.getState().items.main).toHaveLength(1);
    // A device never asks for what only the computer itself may read.
    expect(computer.calls).not.toContain("settings");
  });

  it("learns from the stream that it is the computer itself, and then reads the settings", async () => {
    const { computer, client } = fakeComputer([]);
    computer.local = true;
    const store = createStore(client);
    store.start();
    computer.ready(1);
    expect(store.getState().local).toBe(true);
    await settled();
    expect(store.getState()).toMatchObject({ phase: "ready", local: true, settings });
  });

  it("applies events that arrive while it loads on top of the snapshot", async () => {
    const { computer, client } = fakeComputer([activity("act_1", "running")]);
    computer.slow = true;
    const store = createStore(client);
    store.start();
    computer.ready(3);
    await settled();
    computer.event(updated(4, activity("act_1", "done")));
    computer.event(added(5, message("msg_2", "Done.")));
    expect(store.getState().items.main).toBeUndefined();

    computer.release();
    await settled();
    expect(store.getState().items.main).toEqual([activity("act_1", "done"), message("msg_2", "Done.")]);
    expect(store.getState().seq).toBe(5);
  });

  it("keeps its state when a reconnection replays what was missed", async () => {
    const { computer, client } = fakeComputer([message("msg_1", "Hello")]);
    const store = createStore(client);
    store.start();
    computer.ready(1);
    await settled();

    computer.items = [];
    computer.calls.length = 0;
    computer.event(added(2, message("msg_2", "Still here.")));
    computer.ready(2);
    await settled();
    expect(store.getState().items.main?.map((item) => item.id)).toEqual(["msg_1", "msg_2"]);
    expect(computer.calls).toEqual([]);
  });

  it("drops everything and reloads when the stream says reset", async () => {
    const { computer, client } = fakeComputer([message("msg_1", "Hello"), request("req_1", "pending")]);
    const store = createStore(client);
    store.start();
    computer.ready(40);
    await settled();
    computer.event(delta("msg_2", "Half a sen"));
    expect(store.getState().requests).toHaveLength(1);
    expect(store.getState().typing.main).toBeDefined();

    // The computer started a new log: what we hold may no longer exist.
    computer.items = [message("msg_5", "Fresh start.")];
    computer.ready(2, true);
    expect(store.getState()).toMatchObject({ items: {}, requests: [], typing: {}, seq: 2, phase: "ready" });
    await settled();
    expect(store.getState().items.main).toEqual([message("msg_5", "Fresh start.")]);
    expect(store.getState().requests).toEqual([]);

    computer.event(added(3, message("msg_6", "And on we go.")));
    expect(store.getState().items.main).toHaveLength(2);
  });

  it("tries again, once the computer is back, a timeline it could not open", async () => {
    const report: MessageItem = { ...message("msg_j", "The backup is complete."), threadId: "thr_job" };
    const { computer, client } = fakeComputer([message("msg_1", "Hello"), report]);
    const store = createStore(client);
    store.start();
    computer.ready(1);
    await settled();

    computer.unreachable = true;
    await expect(store.open("thr_job")).rejects.toThrow();
    expect(store.getState().items.thr_job).toBeUndefined();

    // The stream comes back: nothing to reload, except what is still missing.
    computer.unreachable = false;
    computer.calls.length = 0;
    computer.ready(1);
    await settled();
    expect(store.getState().items.thr_job).toEqual([report]);
    expect(computer.calls).toEqual(["items thr_job"]);
  });

  it("reloads the timelines that were open after a reset, and forgets a job that is gone", async () => {
    const report: MessageItem = { ...message("msg_j", "The backup is complete."), threadId: "thr_job" };
    const { computer, client } = fakeComputer([report]);
    const store = createStore(client);
    store.start();
    computer.ready(1);
    await settled();
    await store.open("thr_job");

    computer.ready(1, true);
    await settled();
    expect(Object.keys(store.getState().items).sort()).toEqual(["main", "thr_job"]);

    computer.event({ type: "thread.deleted", seq: 2, at: 1, threadId: "thr_job" });
    computer.calls.length = 0;
    computer.ready(1, true);
    await settled();
    expect(computer.calls).not.toContain("items thr_job");
  });

  it("takes the answer of a change as the new truth, without asking again", async () => {
    const { computer, client } = fakeComputer([]);
    computer.local = true;
    const store = createStore(client);
    store.start();
    computer.ready(1);
    await settled();

    computer.calls.length = 0;
    await store.updateNode({ agentName: "Iris" });
    expect(store.getState().node?.agent.name).toBe("Iris");
    expect(computer.calls).toEqual(["updateNode"]);
  });
});
