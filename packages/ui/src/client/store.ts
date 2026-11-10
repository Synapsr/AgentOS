import {
  MAIN_THREAD,
  type Event,
  type Item,
  type NodeInfo,
  type NodeMode,
  type NodePatch,
  type NodeStatus,
  type RequestItem,
  type ServerFrame,
  type Settings,
  type SettingsPatch,
  type Thread,
} from "@agentos/protocol";
import { failureCode, type Client } from "./client";

/** A reply being written: `message.delta` texts joined, until the message itself arrives. */
export interface Typing {
  messageId: string;
  text: string;
}

/** Everything the interface knows about the computer it is connected to. */
export interface State {
  /** `connecting` until the first load; `unpaired` when the token is refused. */
  phase: "connecting" | "ready" | "unpaired";
  /** The event stream is open. */
  online: boolean;
  /** This page runs on the computer itself (it holds the local token), as the stream says. */
  local: boolean;
  /** Local only. */
  settings: Settings | null;
  node: NodeInfo | null;
  status: NodeStatus | null;
  threads: Thread[];
  /** Timelines of the threads that have been opened, oldest first. */
  items: Record<string, Item[]>;
  /** Whether older items exist before the loaded ones. */
  hasMore: Record<string, boolean>;
  /** Requests waiting for the owner, oldest first, from every thread. */
  requests: RequestItem[];
  /** In-progress reply per thread. */
  typing: Record<string, Typing>;
  /** Last event applied; where a reconnection resumes from. */
  seq: number;
}

export const emptyState: State = {
  phase: "connecting",
  online: false,
  local: false,
  settings: null,
  node: null,
  status: null,
  threads: [],
  items: {},
  hasMore: {},
  requests: [],
  typing: {},
  seq: 0,
};

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = record;
  return rest;
}

function upsert<T extends { id: string }>(list: T[], value: T): T[] {
  const index = list.findIndex((other) => other.id === value.id);
  return index < 0 ? [...list, value] : list.with(index, value);
}

/** Adds or replaces an item, keeping the pending requests and typing in step. */
function withItem(state: State, item: Item, added: boolean): State {
  let { items, requests, typing } = state;
  const timeline = items[item.threadId];
  // Only opened threads keep a timeline; an update to an item older than
  // the loaded page has nothing to replace.
  if (timeline && (added || timeline.some((other) => other.id === item.id))) {
    items = { ...items, [item.threadId]: upsert(timeline, item) };
  }
  if (item.type === "request") {
    requests = item.state === "pending" ? upsert(requests, item) : requests.filter((other) => other.id !== item.id);
  }
  if (item.type === "message" && typing[item.threadId]?.messageId === item.id) {
    typing = without(typing, item.threadId);
  }
  return { ...state, items, requests, typing };
}

function apply(state: State, event: Event): State {
  switch (event.type) {
    case "node.status":
      return { ...state, status: event.status };
    case "node.updated":
      return { ...state, node: event.node };
    case "thread.updated":
      return { ...state, threads: upsert(state.threads, event.thread) };
    case "thread.deleted":
      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== event.threadId),
        items: without(state.items, event.threadId),
        hasMore: without(state.hasMore, event.threadId),
        requests: state.requests.filter((request) => request.threadId !== event.threadId),
        typing: without(state.typing, event.threadId),
      };
    case "item.added":
      return withItem(state, event.item, true);
    case "item.updated":
      return withItem(state, event.item, false);
    case "message.delta": {
      const current = state.typing[event.threadId];
      const text = current?.messageId === event.messageId ? current.text + event.text : event.text;
      return { ...state, typing: { ...state.typing, [event.threadId]: { messageId: event.messageId, text } } };
    }
    case "turn.completed":
      // A reply that was cut short never arrives as a message: drop its draft.
      return state.typing[event.threadId] ? { ...state, typing: without(state.typing, event.threadId) } : state;
  }
}

/** Applies one event. Pure; an event already applied (a replay) changes nothing. */
export function reduce(state: State, event: Event): State {
  if (event.seq > 0 && event.seq <= state.seq) return state;
  const next = apply(state, event);
  return event.seq > 0 ? { ...next, seq: event.seq } : next;
}

/** The state of one connection to a computer, kept current by its event stream. */
export interface Store {
  readonly client: Client;
  getState(): State;
  subscribe(listener: () => void): () => void;
  /** Connects. Returns a function that disconnects. */
  start(): () => void;
  /** Loads a thread's timeline if it is not there yet. If that fails, it is tried again when the computer is back. */
  open(threadId: string): Promise<void>;
  /** Loads the page of items before the oldest one shown. */
  loadEarlier(threadId: string): Promise<void>;
  send(threadId: string, text: string): Promise<void>;
  resolve(requestId: string, optionId: string | null, text: string | null): Promise<void>;
  updateNode(patch: NodePatch): Promise<void>;
  setMode(mode: NodeMode): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  /** Re-reads the settings (permissions change outside the app). */
  refreshSettings(): Promise<Settings>;
}

export function createStore(client: Client): Store {
  let state = emptyState;
  const listeners = new Set<() => void>();
  /** Events held back while a snapshot loads, applied on top of it. */
  let held: Event[] | null = null;
  /** Bumped by each load, so that a superseded one can tell and give up. */
  let loads = 0;
  /** Item events seen per thread, to notice a page that raced with the stream. */
  const touched = new Map<string, number>();
  /** Threads whose timeline the interface asked for: loaded with everything else, and again if that failed. */
  const wanted = new Set<string>([MAIN_THREAD]);
  let running = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const set = (next: State) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  /** A thread's newest items, or null for a thread that no longer exists. */
  const page = (threadId: string) =>
    client.items(threadId).catch((error) => {
      if (failureCode(error) !== "not_found") throw error;
      wanted.delete(threadId);
      return null;
    });

  /** Loads everything over HTTP: the first time, and when the stream says our state is stale. */
  async function load(local: boolean): Promise<void> {
    const id = ++loads;
    held = [];
    try {
      const [settings, threads, requests, ...pages] = await Promise.all([
        local ? client.settings() : null,
        client.threads(),
        client.requests(),
        ...[...wanted].map(page),
      ]);
      if (id !== loads) return;
      let next: State = { ...state, phase: "ready", settings, threads, requests };
      for (const found of pages) {
        if (!found) continue;
        next = {
          ...next,
          items: { ...next.items, [found.thread.id]: found.items },
          hasMore: { ...next.hasMore, [found.thread.id]: found.hasMore },
        };
      }
      for (const event of held) next = reduce(next, event);
      held = null;
      set(next);
    } catch {
      if (id !== loads) return;
      held = null;
      if (running) retry = setTimeout(() => void load(local), 2000);
    }
  }

  async function open(threadId: string): Promise<void> {
    wanted.add(threadId);
    while (!state.items[threadId]) {
      const before = touched.get(threadId);
      const found = await client.items(threadId);
      // An item event that arrived meanwhile may be missing from the page: ask again.
      if (touched.get(threadId) !== before) continue;
      set({
        ...state,
        items: { ...state.items, [threadId]: found.items },
        hasMore: { ...state.hasMore, [threadId]: found.hasMore },
      });
    }
  }

  function onFrame(frame: ServerFrame): void {
    if (frame.type === "event") {
      const { event } = frame;
      if (event.type === "item.added" || event.type === "item.updated") {
        touched.set(event.item.threadId, (touched.get(event.item.threadId) ?? 0) + 1);
      }
      if (event.type === "thread.deleted") wanted.delete(event.threadId);
      if (held) held.push(event);
      else set(reduce(state, event));
      return;
    }
    if (frame.type !== "ready") return;
    const { node, status, seq, local } = frame;
    if (state.phase === "ready" && !frame.reset) {
      // What we missed was replayed before this frame: nothing to reload…
      set({ ...state, online: true, local, node, status, seq });
      // …except a timeline that was asked for while the computer could not be reached.
      for (const threadId of wanted) {
        if (!state.items[threadId]) open(threadId).catch(() => {});
      }
      return;
    }
    set({ ...emptyState, phase: state.phase, settings: state.settings, online: true, local, node, status, seq });
    clearTimeout(retry);
    void load(local);
  }

  function onDown(): void {
    // Drafts are not replayed; the finished messages will be.
    set({ ...state, online: false, typing: {} });
    // A closed socket does not say why. Ask over HTTP whether we are still welcome.
    client.node().catch((error) => {
      if (failureCode(error) === "unauthorized") set({ ...state, phase: "unpaired" });
    });
  }

  const applyItem = (item: Item) => set(withItem(state, item, true));

  return {
    client,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      running = true;
      const close = client.events(() => state.seq, onFrame, onDown);
      return () => {
        running = false;
        clearTimeout(retry);
        close();
      };
    },
    open,
    async loadEarlier(threadId) {
      const first = state.items[threadId]?.[0];
      if (!first || !state.hasMore[threadId]) return;
      const found = await client.items(threadId, first.id);
      const known = new Set((state.items[threadId] ?? []).map((item) => item.id));
      const older = found.items.filter((item) => !known.has(item.id));
      set({
        ...state,
        items: { ...state.items, [threadId]: [...older, ...(state.items[threadId] ?? [])] },
        hasMore: { ...state.hasMore, [threadId]: found.hasMore },
      });
    },
    // The answers below also arrive as events; applying them here just
    // makes the interface react without waiting for the stream.
    async send(threadId, text) {
      applyItem(await client.send(threadId, text));
    },
    async resolve(requestId, optionId, text) {
      try {
        applyItem(await client.resolve(requestId, optionId, text));
      } catch (error) {
        // Someone else answered first: their answer is on its way as an event.
        if (failureCode(error) !== "conflict") throw error;
      }
    },
    async updateNode(patch) {
      const { node, status } = await client.updateNode(patch);
      set({ ...state, node, status });
    },
    async setMode(mode) {
      const { node, status } = await client.setMode(mode);
      set({ ...state, node, status });
    },
    async updateSettings(patch) {
      const settings = await client.updateSettings(patch);
      set({ ...state, settings });
      return settings;
    },
    async refreshSettings() {
      const settings = await client.settings();
      set({ ...state, settings });
      return settings;
    },
  };
}
