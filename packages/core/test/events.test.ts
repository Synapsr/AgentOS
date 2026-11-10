import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Event, ItemsResponse, NodeInfo, NodeStatus, RequestsResponse, ThreadsResponse } from "@agentos/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Engine, EngineHost } from "../src/engine/types.js";
import { Stream, type TestCore, startTestCore, tempHome } from "./harness.js";

let core: TestCore;
afterEach(() => core?.close());

const say = (text: string) => core.local.post("/v1/threads/main/messages", { text });

/** Says something and waits until the agent has handed back. */
async function exchange(text: string): Promise<void> {
  const events = await core.stream();
  await say(text);
  await events.find("turn.completed");
  events.close();
}

describe("the event stream", () => {
  it("starts with a ready frame describing the computer", async () => {
    core = await startTestCore();
    const events = await core.stream();
    expect(events.replayed).toBe(0);
    expect(events.ready).toMatchObject({ reset: false, local: true });
    expect(NodeInfo.parse(events.ready.node)).toMatchObject({ agent: { name: "Nova" }, capabilities: { engine: "mock", computer: false } });
    expect(NodeStatus.parse(events.ready.status)).toMatchObject({ state: "idle", mode: "desktop" });
    events.close();
  });

  it("replays what happened since the seq the client gives, then goes live", async () => {
    core = await startTestCore();
    const first = await core.stream();
    await say("hello");
    await first.find("turn.completed");
    const stored = first.events.filter((e) => e.seq > 0);
    const middle = stored[2]?.seq ?? 0;
    first.close();

    const second = await core.stream({ since: middle });
    expect(second.ready).toMatchObject({ seq: stored.at(-1)?.seq, reset: false });
    expect(second.events.slice(0, second.replayed)).toEqual(stored.filter((e) => e.seq > middle));
    // Typing is never replayed.
    expect(second.events.some((e) => e.type === "message.delta")).toBe(false);

    await say("again");
    const live = await second.find("turn.completed", () => true, second.replayed);
    expect(live.seq).toBeGreaterThan(second.ready.seq);
    second.close();

    const upToDate = await core.stream({ since: live.seq });
    expect(upToDate.replayed).toBe(0);
    expect(upToDate.ready).toMatchObject({ seq: live.seq, reset: false });
    upToDate.close();
  });

  it("replays everything from zero", async () => {
    core = await startTestCore();
    await exchange("hello");
    const events = await core.stream({ since: 0 });
    expect(events.events.slice(0, events.replayed).map((e) => e.seq)).toEqual(
      Array.from({ length: events.ready.seq }, (_, index) => index + 1),
    );
    events.close();
  });

  it("tells a client whose seq cannot be served to reset", async () => {
    core = await startTestCore();
    const events = await core.stream({ since: 9999 });
    expect(events.ready.reset).toBe(true);
    expect(events.replayed).toBe(0);
    events.close();
  });

  it("answers ping with pong and accepts presence", async () => {
    core = await startTestCore();
    const events = await core.stream();
    const pong = events.nextFrame("pong");
    events.send({ type: "presence", active: true });
    events.send({ type: "nonsense" });
    events.send({ type: "ping" });
    expect(await pong).toEqual({ type: "pong" });
    events.close();
  });

  it("accepts the token in the address or in a header, and nothing else", async () => {
    core = await startTestCore();
    const url = `ws://127.0.0.1:${core.port}/v1/events`;
    const outcome = (socket: WebSocket): Promise<string> =>
      new Promise((resolve) => {
        socket.on("open", () => resolve("open"));
        socket.on("unexpected-response", (_, response) => resolve(String(response.statusCode)));
        socket.on("error", () => resolve("error"));
      });
    const withHeader = new WebSocket(url, { headers: { Authorization: `Bearer ${core.localToken}` } });
    expect(await outcome(withHeader)).toBe("open");
    withHeader.close();
    expect(await outcome(new WebSocket(url))).toBe("401");
    expect(await outcome(new WebSocket(`${url}?token=wrong`))).toBe("401");
    expect(await outcome(new WebSocket(`${url}?token=${core.localToken}&since=soon`))).toBe("400");
    expect(await outcome(new WebSocket(url, { headers: { Authorization: `Bearer ${core.localToken}`, Host: "evil.example.com" } }))).toBe("403");
    expect(await outcome(new WebSocket(`ws://127.0.0.1:${core.port}/v1/other?token=${core.localToken}`))).toBe("404");
  });

  it("serves paired devices too", async () => {
    core = await startTestCore();
    const code = (await core.local.post("/v1/pairing-codes")).body.code;
    const { token } = (await core.local.as(null).post("/v1/pair", { code, device: { name: "Phone", platform: "ios" } })).body;
    const events = await core.stream({ token });
    expect(events.ready.local).toBe(false);
    await say("hello");
    expect((await events.find("turn.completed")).ok).toBe(true);
    events.close();
  });
});

describe("a restart", () => {
  it("keeps conversations, the event log and where each client stopped", async () => {
    const home = tempHome();
    core = await startTestCore({ home });
    const before = await core.stream();
    await say("hello");
    const done = await before.find("turn.completed");
    const itemsBefore = ItemsResponse.parse((await core.local.get("/v1/threads/main/items")).body).items;
    const token = core.localToken;
    const nodeId = before.ready.node.id;
    before.close();
    await core.close();

    core = await startTestCore({ home });
    // A new local token at every start: the old one opens nothing any more.
    expect(core.localToken).not.toBe(token);
    expect((await core.local.as(token).get("/v1/node")).status).toBe(401);
    const after = await core.stream({ since: done.seq - 3 });
    expect(after.ready.node.id).toBe(nodeId);
    expect(after.ready.reset).toBe(false);
    // Everything missed is replayed, in order — including what the restart itself wrote to the log.
    const replayed = after.events.slice(0, after.replayed);
    expect(replayed.map((e) => e.seq)).toEqual(Array.from({ length: replayed.length }, (_, index) => done.seq - 2 + index));
    expect(replayed[2]).toEqual(done);
    expect(after.ready.seq).toBe(replayed.at(-1)?.seq);
    expect(ItemsResponse.parse((await core.local.get("/v1/threads/main/items")).body).items).toEqual(itemsBefore);

    await say("still there?");
    const next = await after.find("turn.completed", () => true, after.replayed);
    expect(next.seq).toBeGreaterThan(done.seq);
    after.close();
  });

  it("hands the engine the token that resumes each conversation", async () => {
    const home = tempHome();
    const opened: (string | null)[] = [];
    const engine: Engine = {
      id: "recorder",
      status: async () => ({ ready: true, auth: "none" }),
      open: (host: EngineHost) => {
        opened.push(host.resume);
        return {
          send: (text) => {
            host.saveResume(`session-after-${text}`);
            host.onMessage(`Heard ${text}.`);
            host.onTurnEnd({ ok: true, text: `Heard ${text}.` });
          },
          interrupt: async () => {},
          close: () => {},
        };
      },
    };
    core = await startTestCore({ home, engine });
    await exchange("one");
    await exchange("two");
    await core.close();

    core = await startTestCore({ home, engine });
    await exchange("three");
    // One session for the first run (opened with nothing to resume), one after the restart.
    expect(opened).toEqual([null, "session-after-two"]);
  });

  it("puts at rest what a crash left running", async () => {
    const home = tempHome();
    core = await startTestCore({ home });
    const before = await core.stream();
    await say("delete the build folder");
    const asked = (await before.find("item.added", (e) => e.item.type === "request")).item;
    before.close();
    // A crash: the process is gone without a goodbye. The files stay as they were at that instant.
    const frozen = ["threads.json", "events.jsonl", "threads/main.jsonl"].map((name) => [name, readFileSync(join(home, name), "utf8")] as const);
    await core.close();
    for (const [name, content] of frozen) writeFileSync(join(home, name), content);
    appendFileSync(
      join(home, "threads/main.jsonl"),
      `${JSON.stringify({ id: "act_crash", threadId: "main", at: 1, type: "activity", label: "Working", tool: null, detail: null, state: "running", endedAt: null })}\n`,
    );
    expect(JSON.parse(frozen[0]?.[1] ?? "[]")[0].thread.state).toBe("waiting");

    core = await startTestCore({ home });
    const after = await core.stream({ since: 0 });
    const replayed = after.events.slice(0, after.replayed);
    for (const event of replayed) Event.parse(event);
    expect(RequestsResponse.parse((await core.local.get("/v1/requests")).body).requests).toEqual([]);
    const timeline = ItemsResponse.parse((await core.local.get("/v1/threads/main/items")).body).items;
    expect(timeline.find((i) => i.id === asked.id)).toMatchObject({ state: "cancelled" });
    expect(timeline.find((i) => i.id === "act_crash")).toMatchObject({ state: "failed", endedAt: expect.any(Number) });
    expect(ThreadsResponse.parse((await core.local.get("/v1/threads")).body).threads[0]).toMatchObject({ state: "idle" });
    expect(after.ready.status).toMatchObject({ state: "idle", pendingRequests: 0, workingThreads: 0 });
    // The clean-up is in the log, so a client that was connected before the crash catches up.
    expect(replayed.filter((e) => e.type === "node.status").at(-1)).toMatchObject({ status: { state: "idle", pendingRequests: 0 } });

    await say("hello");
    expect((await after.find("turn.completed", () => true, after.replayed)).ok).toBe(true);
    after.close();
  });
});

describe("a stream opened by hand", () => {
  it("is refused a since that is not a number", async () => {
    core = await startTestCore();
    await expect(Stream.open(`http://127.0.0.1:${core.port}`, core.localToken, -1)).rejects.toThrow();
  });
});
