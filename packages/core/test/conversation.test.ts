import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApiError,
  Empty,
  type Event,
  ItemsResponse,
  type RequestItem,
  RequestsResponse,
  ResolveResponse,
  SendMessageResponse,
  ThreadsResponse,
} from "@agentos/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type Api, type Stream, type TestCore, fakeComputer, startTestCore, useTool } from "./harness.js";

let core: TestCore;
let events: Stream;
afterEach(async () => {
  events?.close();
  await core?.close();
});

async function start(options: Parameters<typeof startTestCore>[0] = {}): Promise<void> {
  core = await startTestCore(options);
  events = await core.stream();
}

const say = (text: string, api: Api = core.local, thread = "main") => api.post(`/v1/threads/${thread}/messages`, { text });
/** Says something as the reply to a request: what a client does with the words spoken right after the agent asked. */
const reply = async (text: string, requestId: string, thread = "main") => {
  const sent = await core.local.post(`/v1/threads/${thread}/messages`, { text, requestId });
  return sent.status === 200 ? SendMessageResponse.parse(sent.body) : sent;
};
const items = async (thread = "main") => ItemsResponse.parse((await core.local.get(`/v1/threads/${thread}/items`)).body).items;
const pending = async () => RequestsResponse.parse((await core.local.get("/v1/requests")).body).requests;
const turnEnd = (thread = "main", from = 0) => events.find("turn.completed", (e) => e.threadId === thread, from);
const request = (from = 0) => events.find("item.added", (e) => e.item.type === "request", from).then((e) => e.item as RequestItem);
const lastAgentMessage = async () => (await items()).filter((i) => i.type === "message" && i.role === "agent").at(-1);

describe("a simple exchange", () => {
  it("streams the reply, then delivers it whole under the same id", async () => {
    await start();
    const sent = SendMessageResponse.parse((await say("hello")).body).item;
    expect(sent).toMatchObject({ role: "user", text: "hello", via: "text", deviceId: null });

    const done = await turnEnd();
    expect(done).toMatchObject({ ok: true, text: expect.stringContaining("hello") });

    const deltas = events.events.filter((e): e is Extract<Event, { type: "message.delta" }> => e.type === "message.delta");
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.every((d) => d.seq === 0)).toBe(true);
    const message = (await events.find("item.added", (e) => e.item.type === "message" && e.item.role === "agent")).item;
    expect(message).toMatchObject({ id: deltas[0]?.messageId, text: deltas.map((d) => d.text).join("") });
    expect(done.text).toBe(message.type === "message" ? message.text : "");
  });

  it("goes from idle to working and back, and says what it is doing", async () => {
    await start();
    await say("hello");
    await turnEnd();
    const states = events.events.filter((e) => e.type === "node.status").map((e) => (e.type === "node.status" ? e.status : null));
    expect(states.map((s) => s?.state)).toEqual(expect.arrayContaining(["working", "idle"]));
    expect(states.find((s) => s?.activity)?.activity).toBe("Thinking");
    expect(states.at(-1)).toMatchObject({ state: "idle", activity: null, workingThreads: 0, pendingRequests: 0 });
    // It still says "Thinking" while it types its reply: the line only goes away when it is done.
    const afterThinking = states.slice(states.findIndex((s) => s?.activity === "Thinking"));
    expect(afterThinking.filter((s) => s?.state === "working").every((s) => s?.activity === "Thinking")).toBe(true);
    expect(states.filter((s) => s?.state === "idle").every((s) => s?.activity === null)).toBe(true);

    const activity = (await items()).find((i) => i.type === "activity");
    expect(activity).toMatchObject({ label: "Thinking", state: "done", endedAt: expect.any(Number) });
    const thread = ThreadsResponse.parse((await core.local.get("/v1/threads")).body).threads[0];
    expect(thread).toMatchObject({ id: "main", state: "idle", preview: expect.stringContaining("hello") });
  });

  it("numbers stored events strictly upwards and keeps typing out of the log", async () => {
    await start();
    await say("hello");
    await turnEnd();
    const stored = events.events.filter((e) => e.seq > 0).map((e) => e.seq);
    expect(stored).toEqual([...stored].sort((a, b) => a - b));
    expect(new Set(stored).size).toBe(stored.length);
    const log = readFileSync(join(core.home, "events.jsonl"), "utf8");
    expect(log).not.toContain("message.delta");
    expect(log.trim().split("\n").length).toBe(Math.max(...stored));
  });

  it("records which device spoke, and that it was by voice", async () => {
    await start();
    const code = (await core.local.post("/v1/pairing-codes")).body.code;
    const paired = (await core.local.as(null).post("/v1/pair", { code, device: { name: "Watch", platform: "watchos" } })).body;
    const sent = await core.local.as(paired.token).post("/v1/threads/main/messages", { text: "hello", via: "voice" });
    expect(SendMessageResponse.parse(sent.body).item).toMatchObject({ via: "voice", deviceId: paired.device.id });
    await turnEnd();
  });

  it("refuses an empty message and an unknown conversation", async () => {
    await start();
    expect((await say("")).status).toBe(400);
    const missing = await say("hello", core.local, "thr_nope");
    expect(missing.status).toBe(404);
    expect(ApiError.parse(missing.body).error.code).toBe("not_found");
  });

  it("pages through the timeline, newest last", async () => {
    await start();
    for (const text of ["one", "two", "three"]) {
      const from = events.events.length;
      await say(text);
      await turnEnd("main", from);
    }
    const all = await items();
    const page = ItemsResponse.parse((await core.local.get("/v1/threads/main/items?limit=2")).body);
    expect(page.items).toEqual(all.slice(-2));
    expect(page.hasMore).toBe(true);
    const older = ItemsResponse.parse((await core.local.get(`/v1/threads/main/items?limit=200&before=${page.items[0]?.id}`)).body);
    expect(older.items).toEqual(all.slice(0, -2));
    expect(older.hasMore).toBe(false);
    expect((await core.local.get("/v1/threads/main/items?before=msg_nope")).status).toBe(400);
  });

  it("reports a failed turn as an error the owner can hear", async () => {
    await start();
    await say("please trigger an error");
    expect(await turnEnd()).toMatchObject({ ok: false, text: "Something went wrong on my side. Shall we try again?" });
    expect((await events.find("thread.updated", (e) => e.thread.state === "error")).thread.id).toBe("main");
    // The next message puts the conversation back on its feet.
    const from = events.events.length;
    await say("hello");
    expect((await turnEnd("main", from)).ok).toBe(true);
    expect((await events.find("thread.updated", (e) => e.thread.state === "idle", from)).thread.id).toBe("main");
  });
});

describe("an approval", () => {
  it("is asked before a risky action and lets it run once approved", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    expect(asked).toMatchObject({
      kind: "approval",
      title: "Nova wants to delete files",
      spoken: "I'd like to delete some files. Can I go ahead?",
      body: "rm -rf ./build",
      risk: "high",
      state: "pending",
      screenshot: null,
      // An approval is a tap on one of its two options; words reach it as a message (below).
      allowText: false,
      options: [
        { id: "approve", label: "Go ahead", style: "primary" },
        { id: "deny", label: "Stop", style: "danger" },
      ],
    });
    expect((await events.find("node.status", (e) => e.status.state === "waiting")).status.pendingRequests).toBe(1);
    expect((await events.find("thread.updated", (e) => e.thread.state === "waiting")).thread.id).toBe("main");
    expect(await pending()).toEqual([asked]);

    const resolved = await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "approve" });
    expect(ResolveResponse.parse(resolved.body).request).toMatchObject({
      state: "resolved",
      resolution: { optionId: "approve", text: null, deviceId: null },
    });
    expect((await turnEnd()).text).toBe("Done, the folder is gone.");
    expect(await pending()).toEqual([]);
    expect((await items()).find((i) => i.type === "activity" && i.tool === "Bash")).toMatchObject({
      label: "Deleting the build folder",
      detail: "rm -rf ./build",
      state: "done",
    });
    expect((await events.find("item.updated", (e) => e.item.id === asked.id)).item).toMatchObject({ state: "resolved" });
  });

  it("stops the action when denied", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny" });
    expect((await turnEnd()).text).toBe("Okay, I left it alone.");
    expect((await items()).some((i) => i.type === "activity" && i.tool === "Bash")).toBe(false);
  });

  it("lets the first answer win: later ones are a conflict", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    expect((await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny" })).status).toBe(200);
    const late = await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "approve" });
    expect(late.status).toBe(409);
    expect(ApiError.parse(late.body).error.code).toBe("conflict");
    expect((await turnEnd()).text).toBe("Okay, I left it alone.");

    const unknown = await core.local.post("/v1/requests/req_nope/resolve", { optionId: "approve" });
    expect(unknown.status).toBe(404);
  });

  it("refuses an answer that is not one", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    expect((await core.local.post(`/v1/requests/${asked.id}/resolve`, {})).status).toBe(400);
    expect((await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "maybe" })).status).toBe(400);
    // Free text is not an answer to an approval on this route…
    expect((await core.local.post(`/v1/requests/${asked.id}/resolve`, { text: "go ahead" })).status).toBe(400);
    expect((await pending()).length).toBe(1);
    // …but may come with the option, as the reason.
    const denied = await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny", text: "not today" });
    expect(ResolveResponse.parse(denied.body).request.resolution).toMatchObject({ optionId: "deny", text: "not today" });
    await turnEnd();
  });

  it("takes a plain yes as the answer, when the client says the words are the reply to it", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    const from = events.events.length;
    expect(await reply("Oui, vas-y !", asked.id)).toMatchObject({
      item: { role: "user", text: "Oui, vas-y !" },
      request: { id: asked.id, state: "resolved", resolution: { optionId: "approve", text: "Oui, vas-y !" } },
    });
    expect((await events.find("item.updated", (e) => e.item.id === asked.id, from)).item).toMatchObject({ state: "resolved" });
    expect((await turnEnd()).text).toBe("Done, the folder is gone.");
    // The owner's words are in the conversation, and were not sent to the agent a second time as a new message.
    const timeline = await items();
    expect(timeline.filter((i) => i.type === "message" && i.role === "user").map((i) => (i.type === "message" ? i.text : ""))).toEqual([
      "delete the build folder",
      "Oui, vas-y !",
    ]);
    expect(timeline.filter((i) => i.type === "message" && i.role === "agent").length).toBe(1);
  });

  it("takes a plain no as the answer", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    expect(await reply("Non.", asked.id)).toMatchObject({ request: { state: "resolved", resolution: { optionId: "deny", text: "Non." } } });
    expect((await turnEnd()).text).toBe("Okay, I left it alone.");
    expect((await items()).some((i) => i.type === "activity" && i.tool === "Bash")).toBe(false);
  });

  it("decides nothing on a reply that is neither: the request keeps waiting, and the client is told", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    const from = events.events.length;
    expect(await reply("yes but only the cache", asked.id)).toMatchObject({
      item: { role: "user", text: "yes but only the cache" },
      request: { id: asked.id, state: "pending", resolution: null },
    });
    expect(await pending()).toEqual([asked]);
    // The words are kept in the conversation, and the agent — still waiting for its answer — is not handed them.
    expect((await items()).at(-1)).toMatchObject({ type: "message", role: "user", text: "yes but only the cache" });
    expect(events.events.slice(from).some((e) => e.type === "item.updated" && e.item.id === asked.id)).toBe(false);
    // The owner is asked again, and answers plainly.
    expect(await reply("no", asked.id)).toMatchObject({ request: { state: "resolved", resolution: { optionId: "deny" } } });
    expect((await turnEnd()).text).toBe("Okay, I left it alone.");
    expect((await items()).filter((i) => i.type === "message" && i.role === "agent").length).toBe(1);
  });

  // What an independent review got `rm -rf` approved with, back when any agreeable word in any message counted.
  const sixPhrases = ["ok thanks", "Go!", "ok?", "fine", "no problem", "parfait"];

  it.each(sixPhrases)("is not approved by “%s”, said as the reply to it", async (phrase) => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    expect(await reply(phrase, asked.id)).toMatchObject({ request: { state: "pending" } });
    expect(await pending()).toEqual([asked]);
    expect((await items()).some((i) => i.type === "activity" && i.tool === "Bash")).toBe(false);
    await core.local.post("/v1/threads/main/interrupt");
  });

  it("is never answered by a message that does not say it is the reply — not even a plain yes", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    for (const phrase of [...sixPhrases, "yes", "oui vas-y", "go ahead"]) {
      expect(SendMessageResponse.parse((await say(phrase)).body)).toMatchObject({ item: { text: phrase }, request: null });
    }
    expect(await pending()).toEqual([asked]);
    expect((await items()).some((i) => i.type === "activity" && i.tool === "Bash")).toBe(false);
    // Those were messages like any other: the agent gets to them once the owner has really answered.
    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny" });
    await events.find("item.added", (e) => e.item.type === "message" && e.item.role === "agent" && e.item.text.includes("go ahead"));
    expect((await items()).some((i) => i.type === "activity" && i.tool === "Bash")).toBe(false);
  });

  it("refuses a reply to a request that is not waiting in that conversation, and keeps nothing of it", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    const said = async (thread: string) => (await items(thread)).some((i) => i.type === "message" && i.text === "yes");
    const nowhere = await reply("yes", "req_nope");
    expect(nowhere).toMatchObject({ status: 409, body: { error: { code: "conflict" } } });
    // A request of another conversation is not this one's to answer.
    await useTool(core.host("main"), "start_job", { title: "Elsewhere", prompt: "Wait." });
    const job = (await events.find("thread.updated", (e) => e.thread.kind === "job")).thread;
    expect(await reply("yes", asked.id, job.id)).toMatchObject({ status: 409 });
    expect(await said("main")).toBe(false);
    expect(await said(job.id)).toBe(false);
    expect(await pending()).toEqual([asked]);

    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny" });
    expect(await reply("yes", asked.id)).toMatchObject({ status: 409 });
  });

  it("is cancelled when the owner interrupts", async () => {
    await start();
    await say("delete the build folder");
    const asked = await request();
    const stopped = await core.local.post("/v1/threads/main/interrupt");
    expect(stopped.status).toBe(200);
    expect(Empty.parse(stopped.body)).toEqual({});
    expect((await events.find("item.updated", (e) => e.item.id === asked.id)).item).toMatchObject({ state: "cancelled", resolution: null });
    expect((await events.find("thread.updated", (e) => e.thread.state === "idle")).thread.id).toBe("main");
    expect(await pending()).toEqual([]);
    expect((await events.find("node.status", (e) => e.status.state === "idle" && e.status.pendingRequests === 0)).status.workingThreads).toBe(0);
    // A turn the owner stopped is not announced as completed, and nothing was deleted.
    expect(events.events.some((e) => e.type === "turn.completed")).toBe(false);
    expect((await items()).some((i) => i.type === "activity" && i.tool === "Bash")).toBe(false);
    expect((await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "approve" })).status).toBe(409);

    // And the conversation goes on.
    await say("hello");
    expect((await turnEnd()).ok).toBe(true);
  });

  it("is not needed when the agent is autonomous", async () => {
    await start();
    await core.local.patch("/v1/node", { autonomy: "autonomous" });
    await say("delete the build folder");
    expect((await turnEnd()).text).toBe("Done, the folder is gone.");
    expect((await items()).some((i) => i.type === "request")).toBe(false);
  });

  it("is asked in the owner's language", async () => {
    await start();
    await core.local.patch("/v1/node", { language: "fr", agentName: "Léa" });
    await say("supprime le dossier build");
    expect(await request()).toMatchObject({
      title: "Léa veut supprimer des fichiers",
      options: [{ label: "Allez-y" }, { label: "Stop" }],
    });
    await reply("oui", (await request()).id);
    expect((await turnEnd()).text).toBe("C'est fait, le dossier est supprimé.");
  });
});

describe("a question", () => {
  it("is the agent's own, with its options and what it sees", async () => {
    await start({ computer: fakeComputer() });
    await say("deploy the site");
    const asked = await request();
    expect(asked).toMatchObject({
      kind: "question",
      title: "Everything looks good. Deploy to production?",
      spoken: "Everything looks good. Deploy to production?",
      allowText: true,
      risk: "medium",
      options: [
        { id: "option_1", label: "Deploy", style: "primary" },
        { id: "option_2", label: "Not now", style: "default" },
      ],
      screenshot: { mime: "image/jpeg", width: 1280, height: 1080 },
    });
    const picture = await fetch(`${core.local.base}/v1/files/${asked.screenshot?.id}`, {
      headers: { Authorization: `Bearer ${core.localToken}` },
    });
    expect(picture.headers.get("content-type")).toBe("image/jpeg");
    expect((await picture.arrayBuffer()).byteLength).toBe(4);

    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "option_1" });
    expect((await turnEnd()).text).toBe("Done, it's live.");
    expect((await items()).filter((i) => i.type === "activity").map((i) => (i.type === "activity" ? i.label : ""))).toEqual([
      "Running the tests",
      "Building the project",
      "Deploying to production",
    ]);
  });

  it("has no screenshot when the computer has no eyes", async () => {
    await start();
    await say("deploy the site");
    expect((await request()).screenshot).toBeNull();
    await core.local.post("/v1/threads/main/interrupt");
  });

  it("is answered by the other option", async () => {
    await start();
    await say("deploy the site");
    const asked = await request();
    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "option_2" });
    expect((await turnEnd()).text).toBe("Okay, I'll hold off.");
  });

  it("takes free text on the resolve route", async () => {
    await start();
    await say("deploy the site");
    const asked = await request();
    const resolved = await core.local.post(`/v1/requests/${asked.id}/resolve`, { text: "yes please" });
    expect(ResolveResponse.parse(resolved.body).request.resolution).toMatchObject({ optionId: null, text: "yes please" });
    expect((await turnEnd()).text).toBe("Done, it's live.");
  });

  it("takes the words a client gives as the reply to it, whatever they are", async () => {
    await start();
    await say("deploy the site");
    const asked = await request();
    expect(await reply("only once the tests pass", asked.id)).toMatchObject({
      request: { state: "resolved", resolution: { optionId: null, text: "only once the tests pass" } },
    });
    expect((await turnEnd()).text).toBe("Okay, I'll hold off.");
  });

  it("is not answered by a message that does not say it is the reply", async () => {
    await start();
    await say("deploy the site");
    const asked = await request();
    expect(SendMessageResponse.parse((await say("yes, go ahead")).body).request).toBeNull();
    expect(await pending()).toEqual([asked]);
    expect(await reply("yes, go ahead", asked.id)).toMatchObject({ request: { state: "resolved", resolution: { text: "yes, go ahead" } } });
    await events.find("item.added", (e) => e.item.type === "message" && e.item.role === "agent" && e.item.text === "Done, it's live.");
  });

  it("is cancelled by an interrupt, which also ends what was running", async () => {
    await start();
    await say("deploy the site");
    const asked = await request();
    await core.local.post("/v1/threads/main/interrupt");
    expect((await events.find("item.updated", (e) => e.item.id === asked.id)).item.type === "request").toBe(true);
    expect((await items()).find((i) => i.id === asked.id)).toMatchObject({ state: "cancelled" });
    expect((await items()).some((i) => i.type === "activity" && i.state === "running")).toBe(false);
    expect((await lastAgentMessage()) ?? null).toBeNull();
  });
});

describe("the computer's tools", () => {
  it("need approval when supervised, with a picture of the screen — but not to look", async () => {
    await start({ computer: fakeComputer() });
    await core.local.patch("/v1/node", { autonomy: "supervised" });
    await say("hello");
    await turnEnd();
    const engine = core.host("main");
    expect(engine.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["ask_owner", "computer_snapshot", "computer_click", "computer_close_app"]));

    expect(await engine.authorize({ tool: "computer_snapshot", input: {} })).toEqual({ allow: true });
    const verdict = engine.authorize({ tool: "computer_click", input: { ref: "e1" } });
    const asked = await request();
    // The tool says what the click is on; the owner reads the button's name, not a ref.
    expect(asked).toMatchObject({
      kind: "approval",
      title: "Nova wants to click “Deploy”",
      spoken: "I'd like to click “Deploy”. Can I go ahead?",
      body: "Clicking “Deploy”",
      risk: "low",
      allowText: false,
    });
    expect(asked.screenshot).toMatchObject({ mime: "image/jpeg" });
    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny", text: "not that button" });
    expect(await verdict).toEqual({
      allow: false,
      message: 'Your owner did not approve this. They said: "not that button" Do not look for another way to do the same thing.',
    });
  });

  it("show in the practice engine: quitting an app asks first, with the screen, and only pretends", async () => {
    const computer = fakeComputer();
    await start({ computer });
    await say("quit the calculator");
    const asked = await request();
    expect(asked).toMatchObject({
      kind: "approval",
      title: "Nova wants to quit Calculator",
      body: "Closing Calculator",
      risk: "high",
      screenshot: { mime: "image/jpeg" },
    });
    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "approve" });
    expect((await turnEnd()).text).toContain("I pretended");
    expect((await items()).find((i) => i.type === "activity")).toMatchObject({ label: "Closing Calculator", tool: "computer_close_app", state: "done" });
    expect(computer.clicks).toEqual([]);
  });

  it("are ordinary work when balanced — except a call the tool itself rates as high risk", async () => {
    await start({ computer: fakeComputer() });
    await say("hello");
    await turnEnd();
    const engine = core.host("main");

    expect(await engine.authorize({ tool: "computer_click", input: { ref: "e1" } })).toEqual({ allow: true });
    const verdict = engine.authorize({ tool: "computer_click", input: { ref: "e2" } });
    const asked = await request();
    expect(asked).toMatchObject({ title: "Nova wants to click “Pay now”", body: "Clicking “Pay now”", risk: "high" });
    await reply("vas-y", asked.id);
    expect(await verdict).toEqual({ allow: true });

    await core.local.patch("/v1/node", { autonomy: "autonomous" });
    expect(await engine.authorize({ tool: "computer_click", input: { ref: "e2" } })).toEqual({ allow: true });
  });
});

describe("jobs", () => {
  it("run in the background, show in their parent when done, and the agent is told", async () => {
    await start();
    await say("start a job please");
    const job = (await events.find("thread.updated", (e) => e.thread.kind === "job")).thread;
    expect(job).toMatchObject({ kind: "job", parentId: "main", title: "Practice run", cwd: null });
    expect((await turnEnd(job.id)).text).toBe("All 3 steps are done.");

    // The parent shows the job's end as an activity…
    const shown = await events.find("item.added", (e) => e.item.type === "activity" && e.item.tool === "job");
    expect(shown.item).toMatchObject({
      threadId: "main",
      label: "Finished: Practice run",
      detail: "All 3 steps are done.",
      state: "done",
    });
    // …and its agent is told, then tells the owner. (How many turns that takes depends on whether the
    // job ended while the agent was still talking: here it is instant, in life it comes later.)
    const told = await events.find("turn.completed", (e) => e.threadId === "main" && e.seq > shown.seq);
    expect(told).toMatchObject({ ok: true, text: "The background work is finished." });
    const replies = (await items()).filter((i) => i.type === "message" && i.role === "agent");
    expect(replies.map((i) => (i.type === "message" ? i.text : ""))).toEqual([
      "I've started that in the background. I'll tell you when it's done.",
      "The background work is finished.",
    ]);

    // What the core told the agent is not something the owner said.
    const said = (await items()).filter((i) => i.type === "message" && i.role === "user");
    expect(said.map((i) => (i.type === "message" ? i.text : ""))).toEqual(["start a job please"]);
    expect((await items()).find((i) => i.type === "activity" && i.tool === "start_job")).toMatchObject({
      label: "Starting in the background: Practice run",
      state: "done",
    });

    // The job has its own conversation: what it was asked, what it did, its report.
    const timeline = await items(job.id);
    expect(timeline[0]).toMatchObject({ type: "message", role: "user", text: "start a job please" });
    expect(timeline.filter((i) => i.type === "activity").map((i) => (i.type === "activity" ? i.label : ""))).toEqual([
      "Step 1 of 3",
      "Step 2 of 3",
      "Step 3 of 3",
    ]);
    expect(timeline.at(-1)).toMatchObject({ type: "message", role: "agent", text: "All 3 steps are done." });
    const threads = ThreadsResponse.parse((await core.local.get("/v1/threads")).body).threads;
    expect(threads.map((t) => [t.id, t.state])).toEqual([["main", "idle"], [job.id, "idle"]]);
  });

  it("can be listed, told and stopped by the agent, and only from the main conversation", async () => {
    await start();
    await say("start a job please");
    const job = (await events.find("thread.updated", (e) => e.thread.kind === "job")).thread;
    await turnEnd(job.id);
    const names = (thread: string) => core.host(thread).tools.map((tool) => tool.name);
    const main = core.host("main");

    expect(names("main")).toEqual(["ask_owner", "start_job", "list_jobs", "tell_job", "stop_job"]);
    expect(names(job.id)).toEqual(["ask_owner"]);
    expect(await useTool(main, "list_jobs", {})).toContain(`${job.id} · Practice run · idle`);
    expect(await useTool(main, "tell_job", { job: "thr_nope", message: "hi" })).toBe("There is no job thr_nope.");
    expect(await useTool(main, "start_job", { title: "X", prompt: "Y", cwd: "/no/such/folder" })).toBe("There is no folder at /no/such/folder.");

    const from = events.events.length;
    expect(await useTool(main, "tell_job", { job: job.id, message: "once more" })).toBe("Delivered.");
    expect((await turnEnd(job.id, from)).ok).toBe(true);
    expect((await items(job.id)).filter((i) => i.type === "message" && i.role === "user").length).toBe(2);
    expect(await useTool(main, "stop_job", { job: job.id })).toBe("Stopped.");
  });
});
