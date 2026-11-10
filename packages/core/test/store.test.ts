import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Event, type Item, type Thread } from "@agentos/protocol";
import { describe, expect, it } from "vitest";
import { DeviceStore } from "../src/store/devices.js";
import { EventLog } from "../src/store/events.js";
import { FileStore } from "../src/store/files.js";
import { ThreadStore } from "../src/store/threads.js";
import { tempHome } from "./harness.js";

const tick = (threadId: string) => ({ type: "thread.deleted" as const, threadId });

describe("event log", () => {
  it("numbers events with a seq that only grows, across restarts", () => {
    const path = join(tempHome(), "events.jsonl");
    const first = new EventLog(path);
    expect(first.seq).toBe(0);
    expect([first.append(tick("a")).seq, first.append(tick("b")).seq]).toEqual([1, 2]);

    const second = new EventLog(path);
    expect(second.seq).toBe(2);
    const third = second.append(tick("c"));
    expect(third.seq).toBe(3);
    expect(Event.parse(third)).toEqual(third);
    expect(second.since(0)?.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("replays what a client missed", () => {
    const log = new EventLog(join(tempHome(), "events.jsonl"));
    for (const id of ["a", "b", "c", "d"]) log.append(tick(id));
    expect(log.since(2)?.map((e) => e.seq)).toEqual([3, 4]);
    expect(log.since(4)).toEqual([]);
  });

  it("cannot serve a seq from the future: the client must reset", () => {
    const log = new EventLog(join(tempHome(), "events.jsonl"));
    log.append(tick("a"));
    expect(log.since(7)).toBeNull();
  });

  it("drops old events and tells clients that are too far behind to reset", () => {
    const path = join(tempHome(), "events.jsonl");
    const log = new EventLog(path, 10);
    for (let i = 0; i < 35; i++) log.append(tick(String(i)));
    expect(log.seq).toBe(35);
    expect(log.since(10)).toBeNull();
    expect(log.since(25)?.map((e) => e.seq)).toEqual([26, 27, 28, 29, 30, 31, 32, 33, 34, 35]);
    expect(log.since(30)?.length).toBe(5);
    // The file is rewritten rather than growing for ever.
    expect(readFileSync(path, "utf8").trim().split("\n").length).toBeLessThan(20);

    const reopened = new EventLog(path, 10);
    expect(reopened.seq).toBe(35);
    expect(reopened.since(10)).toBeNull();
    expect(reopened.append(tick("z")).seq).toBe(36);
  });

  it("survives a crash in the middle of a write", () => {
    const path = join(tempHome(), "events.jsonl");
    const log = new EventLog(path);
    log.append(tick("a"));
    log.append(tick("b"));
    appendFileSync(path, '{"type":"thread.deleted","threadId":"c","se');

    const recovered = new EventLog(path);
    expect(recovered.seq).toBe(2);
    expect(recovered.append(tick("d")).seq).toBe(3);
    // The half-written line did not swallow the event written after it.
    expect(new EventLog(path).since(0)?.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe("thread store", () => {
  const thread: Thread = {
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
  const activity: Item = {
    id: "act_1",
    threadId: "main",
    at: 2,
    type: "activity",
    label: "Reading notes.txt",
    tool: "Read",
    detail: null,
    state: "running",
    endedAt: null,
  };
  const message: Item = {
    id: "msg_1",
    threadId: "main",
    at: 3,
    type: "message",
    role: "agent",
    text: "Done.",
    via: "text",
    deviceId: null,
    files: [],
  };

  it("keeps threads, their timeline and their resume token across restarts", () => {
    const dir = tempHome();
    const store = new ThreadStore(dir);
    store.save(thread);
    store.setResume("main", "session-1");
    store.put(activity);
    store.put(message);
    store.put({ ...activity, state: "done", endedAt: 4 });

    const reopened = new ThreadStore(dir);
    expect(reopened.list()).toEqual([thread]);
    expect(reopened.resume("main")).toBe("session-1");
    // The changed item keeps its place and its latest version wins.
    expect(reopened.items("main")).toEqual([{ ...activity, state: "done", endedAt: 4 }, message]);
  });

  it("keeps the resume token when the thread itself changes", () => {
    const store = new ThreadStore(tempHome());
    store.save(thread);
    store.setResume("main", "session-1");
    store.save({ ...thread, state: "working" });
    expect(store.resume("main")).toBe("session-1");
  });

  it("never reads a file for a thread it does not know", () => {
    expect(new ThreadStore(tempHome()).items("../../etc/passwd")).toEqual([]);
  });
});

describe("device store", () => {
  it("recognises a device by its token without ever storing the token", () => {
    const path = join(tempHome(), "devices.json");
    const store = new DeviceStore(path);
    const { device, token } = store.create("Marie's iPhone", "ios");

    expect(readFileSync(path, "utf8")).not.toContain(token);
    const reopened = new DeviceStore(path);
    expect(reopened.findByToken(token)).toEqual(device);
    expect(reopened.findByToken(`${token}x`)).toBeNull();
    expect(reopened.list()).toEqual([device]);
  });

  it("forgets a removed device at once", () => {
    const store = new DeviceStore(join(tempHome(), "devices.json"));
    const { device, token } = store.create("Watch", "watchos");
    expect(store.remove(device.id)).toBe(true);
    expect(store.findByToken(token)).toBeNull();
    expect(store.remove(device.id)).toBe(false);
  });
});

describe("file store", () => {
  it("stores an image and serves it back with its type", () => {
    const store = new FileStore(join(tempHome(), "files"));
    const ref = store.put(new Uint8Array([1, 2, 3]), { mime: "image/jpeg", width: 4, height: 2 });
    expect(ref).toMatchObject({ mime: "image/jpeg", width: 4, height: 2 });
    expect(store.read(ref.id)).toEqual({ data: Buffer.from([1, 2, 3]), mime: "image/jpeg" });
  });

  it("serves nothing that is not one of its files", () => {
    const store = new FileStore(join(tempHome(), "files"));
    expect(store.read("../secrets.json")).toBeNull();
    expect(store.read("file_00.jpg")).toBeNull();
  });
});
