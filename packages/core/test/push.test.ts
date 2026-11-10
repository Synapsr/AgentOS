/**
 * Notifications, against a stand-in for Apple's push service: a local HTTP/2
 * server that records what it is sent. Real delivery to a phone is not
 * something a test here can see.
 */
import { type KeyObject, generateKeyPairSync, verify } from "node:crypto";
import { writeFileSync } from "node:fs";
import { type Http2Server, type IncomingHttpHeaders, createServer } from "node:http2";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { DevicesResponse, Empty, PUSH_VERSION, PairResponse, PairingCode, PushCategory, PushPayload, type RequestItem } from "@agentos/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Home } from "../src/config.js";
import { Apns } from "../src/push/apns.js";
import { type Api, type Stream, type TestCore, fakeComputer, startTestCore, tempHome } from "./harness.js";

interface Sent {
  /** Which of Apple's two services it went to. */
  service: "production" | "sandbox";
  deviceToken: string;
  headers: IncomingHttpHeaders;
  payload: { aps: Record<string, unknown>; agentos: unknown };
}

/** A pretend APNs: two servers, as Apple has, answering as told. */
class FakeApple {
  readonly sent: Sent[] = [];
  /** Device tokens Apple "no longer knows", with the answer it gives for them. */
  readonly refusals = new Map<string, { status: number; reason: string }>();
  hosts = { production: "", sandbox: "" };
  private readonly servers: Http2Server[] = [];

  async start(): Promise<void> {
    for (const service of ["production", "sandbox"] as const) {
      const server = createServer();
      server.on("stream", (stream, headers) => {
        let body = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => (body += chunk));
        stream.on("end", () => {
          const deviceToken = String(headers[":path"]).replace("/3/device/", "");
          this.sent.push({ service, deviceToken, headers, payload: JSON.parse(body) });
          const refusal = this.refusals.get(deviceToken);
          stream.respond({ ":status": refusal?.status ?? 200 });
          stream.end(refusal ? JSON.stringify({ reason: refusal.reason }) : "");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      this.hosts[service] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      this.servers.push(server);
    }
  }

  /** Waits until `count` notifications have arrived, and for a moment more in case others follow. */
  async received(count: number): Promise<Sent[]> {
    const deadline = Date.now() + 3000;
    while (this.sent.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 60));
    return this.sent;
  }

  async stop(): Promise<void> {
    await Promise.all(this.servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const APNS_ENV = { AGENTOS_APNS_KEY: P8, AGENTOS_APNS_KEY_ID: "KEY1234567", AGENTOS_APNS_TEAM_ID: "TEAM123456", AGENTOS_APNS_TOPIC: "com.example.agentos" };

/** Checks a provider token as Apple would: its header, its claims, and its signature against the public key. */
function readProviderToken(authorization: unknown, key: KeyObject): { header: unknown; claims: { iss: string; iat: number }; valid: boolean } {
  const [header = "", claims = "", signature = ""] = String(authorization).replace(/^bearer /, "").split(".");
  const decode = (part: string): unknown => JSON.parse(Buffer.from(part, "base64url").toString());
  const valid = verify("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
  return { header: decode(header), claims: decode(claims) as { iss: string; iat: number }, valid };
}

let apple: FakeApple;
let core: TestCore;
let events: Stream;
beforeEach(async () => {
  apple = new FakeApple();
  await apple.start();
});
afterEach(async () => {
  for (const name of Object.keys(APNS_ENV)) delete process.env[name];
  events?.close();
  await core?.close();
  await apple.stop();
});

async function startWithPush(options: Parameters<typeof startTestCore>[0] = {}): Promise<void> {
  Object.assign(process.env, APNS_ENV);
  core = await startTestCore({ apnsHosts: apple.hosts, ...options });
  events = await core.stream();
}

/** Pairs a device and registers it for notifications. Returns its API client and its id. */
async function phone(deviceToken: string, sandbox: boolean): Promise<{ api: Api; id: string }> {
  const { code } = PairingCode.parse((await core.local.post("/v1/pairing-codes")).body);
  const paired = PairResponse.parse((await core.local.as(null).post("/v1/pair", { code, device: { name: deviceToken, platform: "ios" } })).body);
  const api = core.local.as(paired.token);
  expect((await api.call("PUT", "/v1/devices/me/push", { kind: "apns", token: deviceToken, sandbox })).status).toBe(200);
  return { api, id: paired.device.id };
}

const say = (text: string) => core.local.post("/v1/threads/main/messages", { text });
const request = () => events.find("item.added", (e) => e.item.type === "request").then((e) => e.item as RequestItem);

describe("when the agent needs its owner", () => {
  it("each phone gets one time-sensitive notification, signed as Apple expects", async () => {
    await startWithPush();
    await phone("aaaa1111", true);
    await phone("bbbb2222", false);
    await say("delete the build folder");
    const asked = await request();
    const sent = await apple.received(2);

    expect(sent.map((s) => [s.service, s.deviceToken]).sort()).toEqual([
      ["production", "bbbb2222"],
      ["sandbox", "aaaa1111"],
    ]);
    for (const { headers, payload } of sent) {
      expect(headers).toMatchObject({
        ":method": "POST",
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-topic": "com.example.agentos",
        // The request's id is the notification's: later news about it lands on the same one.
        "apns-collapse-id": asked.id,
      });
      const token = readProviderToken(headers.authorization, publicKey);
      expect(token.header).toEqual({ alg: "ES256", kid: "KEY1234567" });
      expect(token.claims.iss).toBe("TEAM123456");
      expect(Math.abs(token.claims.iat - Date.now() / 1000)).toBeLessThan(5);
      expect(token.valid).toBe(true);

      expect(payload.aps).toEqual({
        alert: { title: "Nova", body: "I'd like to delete some files. Can I go ahead?" },
        sound: "default",
        category: PushCategory.approval,
        "thread-id": "main",
        "interruption-level": "time-sensitive",
        "mutable-content": 1,
      });
      expect(PushPayload.parse(payload.agentos)).toEqual({
        version: PUSH_VERSION,
        nodeId: events.ready.node.id,
        kind: "request",
        threadId: "main",
        requestId: asked.id,
        screenshotId: null,
        risk: asked.risk,
      });
    }
    // One provider token for both: it is made once and reused while fresh.
    expect(new Set(sent.map((s) => s.headers.authorization)).size).toBe(1);
  });

  it("a question says so, and points at the picture of the screen", async () => {
    await startWithPush({ computer: fakeComputer() });
    await phone("aaaa1111", true);
    await say("deploy the site");
    const asked = await request();
    const [sent] = await apple.received(1);
    expect(sent?.payload.aps).toMatchObject({
      alert: { title: "Nova", body: "Everything looks good. Deploy to production?" },
      category: PushCategory.question,
      // Lets the app's notification extension fetch the picture before showing it.
      "mutable-content": 1,
    });
    expect(PushPayload.parse(sent?.payload.agentos)).toMatchObject({ kind: "request", requestId: asked.id, screenshotId: asked.screenshot?.id });
  });

  it("the other phones are told quietly when it is answered — or cancelled", async () => {
    await startWithPush();
    const first = await phone("aaaa1111", true);
    await phone("bbbb2222", true);
    await say("delete the build folder");
    const asked = await request();
    await apple.received(2);

    await first.api.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny" });
    await events.find("turn.completed");
    const after = (await apple.received(4)).slice(2);
    const quiet = after.filter((s) => s.headers["apns-push-type"] === "background");
    // Only the phone that did not answer needs telling.
    expect(quiet.map((s) => s.deviceToken)).toEqual(["bbbb2222"]);
    expect(quiet[0]?.headers).toMatchObject({ "apns-priority": "5", "apns-topic": "com.example.agentos" });
    expect(quiet[0]?.payload.aps).toEqual({ "content-available": 1 });
    expect(PushPayload.parse(quiet[0]?.payload.agentos)).toMatchObject({ kind: "resolved", requestId: asked.id, threadId: "main" });

    // Interrupted rather than answered: everyone is told.
    const before = apple.sent.length;
    await say("delete it again");
    const again = await events.find("item.added", (e) => e.item.type === "request" && e.item.id !== asked.id);
    await apple.received(before + 2);
    await core.local.post("/v1/threads/main/interrupt");
    const cancelled = (await apple.received(before + 4)).slice(before + 2);
    expect(cancelled.map((s) => [s.deviceToken, s.headers["apns-push-type"]]).sort()).toEqual([
      ["aaaa1111", "background"],
      ["bbbb2222", "background"],
    ]);
    expect(cancelled.every((s) => PushPayload.parse(s.payload.agentos).requestId === again.item.id)).toBe(true);
  });
});

describe("when the agent has finished", () => {
  it("says so, if nobody is looking", async () => {
    await startWithPush();
    await phone("aaaa1111", true);
    await say("hello");
    const done = await events.find("turn.completed");
    const [sent] = await apple.received(1);
    // The app posts its own notification under this id when it is alive in the background: one notification, not two.
    const id = `turn.${events.ready.node.id}.main`;
    expect(sent?.headers).toMatchObject({ "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": id });
    expect(Buffer.byteLength(id)).toBeLessThanOrEqual(64);
    expect(sent?.payload.aps).toEqual({ alert: { title: "Nova", body: done.text }, sound: "default", category: PushCategory.turn, "thread-id": id });
    expect(PushPayload.parse(sent?.payload.agentos)).toMatchObject({ kind: "turn", threadId: "main", requestId: null, screenshotId: null });
  });

  it("keeps quiet while the owner is looking at a client, and speaks again once they look away", async () => {
    await startWithPush();
    await phone("aaaa1111", true);
    events.send({ type: "presence", active: true });
    events.send({ type: "ping" });
    await events.nextFrame("pong");
    await say("hello");
    await events.find("turn.completed");
    expect(await apple.received(0)).toEqual([]);

    // But a request is always worth a notification.
    await say("delete the build folder");
    const asked = await request();
    expect((await apple.received(1)).length).toBe(1);
    await core.local.post(`/v1/requests/${asked.id}/resolve`, { optionId: "deny" });
    await apple.received(2);

    events.send({ type: "presence", active: false });
    events.send({ type: "ping" });
    await events.nextFrame("pong");
    const before = apple.sent.length;
    const from = events.events.length;
    await say("hello again");
    await events.find("turn.completed", () => true, from);
    const after = (await apple.received(before + 1)).slice(before);
    expect(after.map((s) => PushPayload.parse(s.payload.agentos).kind)).toEqual(["turn"]);
  });

  it("does not repeat a job's report: the agent tells the owner itself", async () => {
    await startWithPush();
    await phone("aaaa1111", true);
    await say("start a job please");
    const job = (await events.find("thread.updated", (e) => e.thread.kind === "job")).thread;
    // The job ends its own turn, with words of its own…
    const jobDone = await events.find("turn.completed", (e) => e.threadId === job.id);
    expect(jobDone.text).toBe("All 3 steps are done.");
    await events.find("turn.completed", (e) => e.threadId === "main" && e.text === "The background work is finished.");
    const sent = await apple.received(1);
    // …but only the main conversation's turns are announced.
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.every((s) => PushPayload.parse(s.payload.agentos).threadId === "main")).toBe(true);
    expect(sent.some((s) => (s.payload.aps.alert as { body: string }).body === jobDone.text)).toBe(false);
    expect(sent.every((s) => s.headers["apns-collapse-id"] === `turn.${events.ready.node.id}.main`)).toBe(true);
  });
});

describe("a phone that removes its own pairing", () => {
  it("stops being notified, loses its token, and is hung up on", async () => {
    await startWithPush();
    const leaving = await phone("aaaa1111", true);
    const staying = await phone("bbbb2222", true);
    const listening = await core.stream({ token: leaving.api.token ?? "" });
    const hungUp = listening.closed();

    // The computer itself has no "me" to remove.
    const notADevice = await core.local.call("DELETE", "/v1/devices/me");
    expect([notADevice.status, notADevice.body.error.code]).toEqual([400, "invalid"]);

    const removed = await leaving.api.call("DELETE", "/v1/devices/me");
    expect([removed.status, Empty.parse(removed.body)]).toEqual([200, {}]);
    expect(await hungUp).toBe(1008);
    expect((await leaving.api.get("/v1/node")).status).toBe(401);
    expect((await leaving.api.call("DELETE", "/v1/devices/me")).status).toBe(401);
    expect(DevicesResponse.parse((await core.local.get("/v1/devices")).body).devices.map((d) => d.id)).toEqual([staying.id]);

    await say("hello");
    await events.find("turn.completed");
    expect((await apple.received(1)).map((s) => s.deviceToken)).toEqual(["bbbb2222"]);
  });
});

describe("a phone Apple no longer knows", () => {
  it.each([
    [410, "Unregistered"],
    [400, "BadDeviceToken"],
  ])("is forgotten after a %i %s, and the others still hear", async (status, reason) => {
    await startWithPush();
    await phone("dead0000", true);
    await phone("aaaa1111", true);
    apple.refusals.set("dead0000", { status, reason });
    await say("hello");
    await events.find("turn.completed");
    expect((await apple.received(2)).map((s) => s.deviceToken).sort()).toEqual(["aaaa1111", "dead0000"]);

    const from = events.events.length;
    await say("hello again");
    await events.find("turn.completed", () => true, from);
    expect((await apple.received(3)).slice(2).map((s) => s.deviceToken)).toEqual(["aaaa1111"]);
  });

  it("is kept when Apple's refusal is about something else", async () => {
    await startWithPush();
    await phone("aaaa1111", true);
    apple.refusals.set("aaaa1111", { status: 429, reason: "TooManyRequests" });
    await say("hello");
    await events.find("turn.completed");
    await apple.received(1);
    const from = events.events.length;
    await say("hello again");
    await events.find("turn.completed", () => true, from);
    expect((await apple.received(2)).length).toBe(2);
  });
});

describe("the signing key", () => {
  it("turns the feature on only when all of it is there", () => {
    const dir = tempHome();
    expect(new Home(dir, {}).apns).toBeNull();
    expect(new Home(dir, { ...APNS_ENV, AGENTOS_APNS_TOPIC: "" }).apns).toBeNull();
    expect(new Home(dir, APNS_ENV).apns).toEqual({ key: P8, keyId: "KEY1234567", teamId: "TEAM123456", topic: "com.example.agentos" });

    // The key may be given as the path of the `.p8` file, and the rest in config.json.
    const file = join(dir, "AuthKey.p8");
    writeFileSync(file, P8);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ push: { keyId: "KEYFROMFILE", teamId: "TEAMFROMFILE", topic: "com.example.fromfile" } }));
    expect(new Home(dir, { AGENTOS_APNS_KEY: file }).apns).toEqual({ key: P8, keyId: "KEYFROMFILE", teamId: "TEAMFROMFILE", topic: "com.example.fromfile" });
    expect(new Home(dir, { AGENTOS_APNS_KEY: join(dir, "missing.p8") }).apns).toBeNull();
  });

  it("without one, nothing is sent and nothing is asked of Apple", async () => {
    core = await startTestCore({ apnsHosts: apple.hosts });
    events = await core.stream();
    await phone("aaaa1111", true);
    await say("hello");
    await events.find("turn.completed");
    expect(await apple.received(0)).toEqual([]);
  });

  it("that is not a key leaves the feature off rather than stopping the computer", async () => {
    Object.assign(process.env, APNS_ENV, { AGENTOS_APNS_KEY: "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----" });
    core = await startTestCore({ apnsHosts: apple.hosts });
    events = await core.stream();
    await say("hello");
    expect((await events.find("turn.completed")).ok).toBe(true);
  });

  it("is asked for a new token when Apple says ours has expired", async () => {
    const apns = new Apns({ key: P8, keyId: "KEY1234567", teamId: "TEAM123456", topic: "com.example.agentos" }, apple.hosts);
    const notification = { type: "alert" as const, payload: { aps: {} } };
    expect(await apns.send("aaaa1111", true, notification)).toBe("sent");
    expect(await apns.send("aaaa1111", true, notification)).toBe("sent");
    expect(apple.sent[1]?.headers.authorization).toBe(apple.sent[0]?.headers.authorization);

    apple.refusals.set("aaaa1111", { status: 403, reason: "ExpiredProviderToken" });
    expect(await apns.send("aaaa1111", true, notification)).toBe("failed");
    apple.refusals.clear();
    // Tokens are dated to the second: a new one made in the same second would be the same.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await apns.send("aaaa1111", true, notification)).toBe("sent");
    expect(apple.sent[3]?.headers.authorization).not.toBe(apple.sent[0]?.headers.authorization);
    expect(readProviderToken(apple.sent[3]?.headers.authorization, publicKey).valid).toBe(true);
    apns.close();
  });

  it("reports a failure, not an exception, when Apple cannot be reached", async () => {
    const apns = new Apns({ key: P8, keyId: "KEY1234567", teamId: "TEAM123456", topic: "com.example.agentos" }, { production: "http://127.0.0.1:9", sandbox: "http://127.0.0.1:9" });
    expect(await apns.send("aaaa1111", false, { type: "alert", payload: { aps: {} } })).toBe("failed");
    apns.close();
  });
});
