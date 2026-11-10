/** The core behind a real relay: everything a client does directly, it can do through `/n/<node>`. */
import { copyFileSync, mkdtempSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Computer } from "@agentos/computer";
import {
  ApiError,
  HelloResponse,
  ItemsResponse,
  NodeResponse,
  PairResponse,
  PairingCode,
  type RequestItem,
  Settings,
  parsePairingLink,
} from "@agentos/protocol";
import { type RunningRelay, startRelay } from "@agentos/relay";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { RelayState } from "../src/index.js";
import { Api, Stream, type TestCore, fakeComputer, startTestCore, tempHome } from "./harness.js";

/** The token of a private relay in these tests: as long as a real one must be. */
const PRIVATE_TOKEN = "only-my-computers-0123456789abcdef";
let relay: RunningRelay;
let relayData: string;
let core: TestCore;
let others: TestCore[] = [];
afterEach(async () => {
  for (const running of [core, ...others.splice(0)]) await running?.close();
  await relay?.close();
});

/** A relay on this computer: open to any computer unless given a token. */
async function startTestRelay(port = 0, options: { token?: string } = {}): Promise<string> {
  relayData ??= mkdtempSync(join(tmpdir(), "agentos-relay-test-"));
  relay = await startRelay({ port, host: "127.0.0.1", dataDir: relayData, ...(options.token ? options : { open: true }) });
  return `http://127.0.0.1:${relay.port}`;
}

const nodeId = async (running: TestCore): Promise<string> => HelloResponse.parse((await running.local.get("/v1/hello")).body).node.id;
const settings = async (running: TestCore): Promise<Settings> => Settings.parse((await running.local.get("/v1/settings")).body);

async function until(condition: () => Promise<boolean> | boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("It did not happen in time.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Points the core at the relay (as the Settings page would) and waits for it to be reachable there. */
async function throughRelay(running: TestCore, relayUrl: string): Promise<Api> {
  await running.local.patch("/v1/settings", { network: { relayUrl } });
  const address = `${relayUrl}/n/${await nodeId(running)}`;
  await until(async () => (await settings(running)).network.relayConnected);
  expect((await settings(running)).network).toMatchObject({ relayConnected: true, relayError: null });
  expect((await settings(running)).network.urls).toContain(address);
  return new Api(address, null);
}

/** Pairs a phone through the relay, with a code asked for on the computer itself. */
async function pairThrough(anyone: Api): Promise<PairResponse> {
  const { code } = PairingCode.parse((await core.local.post("/v1/pairing-codes")).body);
  return PairResponse.parse((await anyone.post("/v1/pair", { code, device: { name: "Phone far away", platform: "ios" } })).body);
}

describe("through the relay", () => {
  it("a phone finds the computer, pairs, talks, approves, and sees what the agent saw", async () => {
    const relayUrl = await startTestRelay();
    core = await startTestCore({ computer: fakeComputer() });
    const anyone = await throughRelay(core, relayUrl);

    expect(HelloResponse.parse((await anyone.get("/v1/hello")).body).node.id).toBe(await nodeId(core));
    const { token, device } = await pairThrough(anyone);
    const phone = anyone.as(token);
    // From far away, a device is a device: never the computer itself.
    expect(NodeResponse.parse((await phone.get("/v1/node")).body)).toMatchObject({ local: false, node: { agent: { name: "Nova" } } });

    const events = await Stream.open(anyone.base, token);
    expect(events.ready).toMatchObject({ local: false, reset: false });
    await phone.post("/v1/threads/main/messages", { text: "deploy the site", via: "voice" });
    const question = (await events.find("item.added", (e) => e.item.type === "request")).item as RequestItem;
    expect(question.screenshot).not.toBeNull();
    const picture = await fetch(`${anyone.base}/v1/files/${question.screenshot?.id}`, { headers: { Authorization: `Bearer ${token}` } });
    expect([picture.status, picture.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    await phone.post(`/v1/requests/${question.id}/resolve`, { optionId: "option_1" });
    expect((await events.find("turn.completed")).text).toBe("Done, it's live.");

    const from = events.events.length;
    await phone.post("/v1/threads/main/messages", { text: "delete the build folder" });
    const approval = (await events.find("item.added", (e) => e.item.type === "request", from)).item as RequestItem;
    const resolved = await phone.post(`/v1/requests/${approval.id}/resolve`, { optionId: "approve" });
    expect(resolved.body.request.resolution).toMatchObject({ optionId: "approve", deviceId: device.id });
    expect((await events.find("turn.completed", () => true, from)).text).toBe("Done, the folder is gone.");
    const timeline = ItemsResponse.parse((await phone.get("/v1/threads/main/items")).body).items;
    expect(timeline.filter((item) => item.type === "message" && item.role === "user").length).toBe(2);
    events.send({ type: "ping" });
    expect(await events.nextFrame("pong")).toEqual({ type: "pong" });
    events.close();
  });

  it("the local token is worth nothing: local routes stay on the computer", async () => {
    const relayUrl = await startTestRelay();
    core = await startTestCore();
    const anyone = await throughRelay(core, relayUrl);
    const withLocalToken = anyone.as(core.localToken);

    for (const answer of [
      await withLocalToken.get("/v1/node"),
      await withLocalToken.get("/v1/settings"),
      await withLocalToken.post("/v1/pairing-codes"),
      await withLocalToken.patch("/v1/node", { agentName: "Eve" }),
    ]) {
      expect(answer.status).toBe(401);
      expect(ApiError.parse(answer.body).error.code).toBe("unauthorized");
    }
    await expect(Stream.open(anyone.base, core.localToken)).rejects.toThrow("401");
    // The same token, on the computer itself, still works.
    expect((await core.local.get("/v1/node")).status).toBe(200);

    // And a paired device gets no further than it would directly.
    const phone = anyone.as((await pairThrough(anyone)).token);
    expect((await phone.get("/v1/settings")).status).toBe(403);
    expect((await phone.post("/v1/pairing-codes")).status).toBe(403);
  });

  it("requests are not judged by the name they were addressed to", async () => {
    const relayUrl = await startTestRelay();
    core = await startTestCore();
    const anyone = await throughRelay(core, relayUrl);
    const status = await new Promise<number>((resolve, reject) => {
      const { hostname, port, pathname } = new URL(`${anyone.base}/v1/hello`);
      httpRequest({ host: hostname, port, path: pathname, headers: { Host: "relay.example.com" } }, (response) => resolve(response.statusCode ?? 0))
        .on("error", reject)
        .end();
    });
    expect(status).toBe(200);
  });

  it("large bodies cross whole, in both directions", async () => {
    const relayUrl = await startTestRelay();
    const picture = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
    const computer: Computer = { ...fakeComputer(), screenshot: async () => ({ data: picture, mime: "image/jpeg", width: 1280, height: 800 }) };
    core = await startTestCore({ computer });
    const anyone = await throughRelay(core, relayUrl);
    const { token } = await pairThrough(anyone);

    const screen = await fetch(`${anyone.base}/v1/screen`, { headers: { Authorization: `Bearer ${token}` } });
    expect(screen.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await screen.arrayBuffer()), Buffer.from(picture))).toBe(0);

    // Three megabytes of "audio": the computer reads all of it before saying its voice is on the phone.
    const upload = await fetch(`${anyone.base}/v1/voice/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/wav" },
      body: picture,
    });
    expect(upload.status).toBe(503);
    expect(ApiError.parse(await upload.json()).error.code).toBe("unavailable");
  });

  it("pairing attempts are counted per client address, as the relay reports it", async () => {
    const relayUrl = await startTestRelay();
    core = await startTestCore();
    const anyone = await throughRelay(core, relayUrl);
    const attempt = (api: Api) => api.post("/v1/pair", { code: "guess", device: { name: "Phone", platform: "ios" } });
    const statuses: number[] = [];
    for (let index = 0; index < 12; index++) statuses.push((await attempt(anyone)).status);
    expect(statuses).toEqual([...Array(10).fill(401), 429, 429]);
    // Someone on the computer's own network is another address, with its own count.
    expect((await attempt(core.local.as(null))).status).toBe(401);
  });

  it("removing a device hangs up on it there too", async () => {
    const relayUrl = await startTestRelay();
    core = await startTestCore();
    const anyone = await throughRelay(core, relayUrl);
    const { token, device } = await pairThrough(anyone);
    const events = await Stream.open(anyone.base, token);
    const hungUp = events.closed();
    await core.local.call("DELETE", `/v1/devices/${device.id}`);
    expect(await hungUp).toBe(1008);
    expect((await anyone.as(token).get("/v1/node")).status).toBe(401);
  });
});

describe("the relay's address", () => {
  it("is offered to clients while connected, after the direct ones — and withdrawn when the relay is removed", async () => {
    const relayUrl = await startTestRelay();
    core = await startTestCore();
    expect((await settings(core)).network).toMatchObject({ relayUrl: null });
    const anyone = await throughRelay(core, relayUrl);

    const network = (await settings(core)).network;
    expect(network.relayUrl).toBe(relayUrl);
    expect(network.urls.at(-1)).toBe(anyone.base);
    const link = parsePairingLink(PairingCode.parse((await core.local.post("/v1/pairing-codes")).body).link);
    expect(link?.urls.at(-1)).toBe(anyone.base);

    await core.local.patch("/v1/settings", { network: { relayUrl: null } });
    expect((await settings(core)).network.urls).not.toContain(anyone.base);
    await until(async () => (await anyone.get("/v1/hello")).status === 502);
    expect(ApiError.parse((await anyone.get("/v1/hello")).body).error.code).toBe("unavailable");
  });

  it("comes back by itself when the relay restarts, and when the computer does", async () => {
    const relayUrl = await startTestRelay();
    const home = tempHome();
    core = await startTestCore({ home });
    const anyone = await throughRelay(core, relayUrl);
    const { token } = await pairThrough(anyone);
    const phone = anyone.as(token);
    expect((await phone.get("/v1/node")).status).toBe(200);

    // The relay goes away, and comes back at the same address with what it remembers.
    const port = relay.port;
    await relay.close();
    await expect(phone.get("/v1/node")).rejects.toThrow();
    await startTestRelay(port);
    await until(async () => (await phone.get("/v1/node")).status === 200);

    // The computer restarts: it is set to use the relay, and returns to it without being told.
    await core.close();
    await until(async () => (await phone.get("/v1/node")).status === 502);
    core = await startTestCore({ home });
    await until(async () => (await phone.get("/v1/node")).status === 200);
    expect(NodeResponse.parse((await phone.get("/v1/node")).body).local).toBe(false);
  }, 30_000);

  it("cannot be taken by another computer, which is told why in plain words", async () => {
    const relayUrl = await startTestRelay();
    const home = tempHome();
    core = await startTestCore({ home });
    const anyone = await throughRelay(core, relayUrl);

    // An impostor: the same id, but not the secret the relay first saw with it.
    const impostorHome = tempHome();
    copyFileSync(join(home, "node.json"), join(impostorHome, "node.json"));
    const states: RelayState[] = [];
    const impostor = await startTestCore({ home: impostorHome, onRelayState: (state) => states.push(state) });
    others.push(impostor);
    expect(await nodeId(impostor)).toBe(await nodeId(core));
    await impostor.local.patch("/v1/settings", { network: { relayUrl } });
    await until(() => states.some((state) => state.error !== null));
    expect(states.at(-1)).toEqual({
      url: relayUrl,
      connected: false,
      error: "Another computer already uses this computer's id on that relay.",
    });
    // Settings say the same, for the app to show.
    const network = (await settings(impostor)).network;
    expect(network).toMatchObject({ relayConnected: false, relayError: "Another computer already uses this computer's id on that relay." });
    expect(network.urls).not.toContain(anyone.base);
    // The real one was not disturbed.
    expect(HelloResponse.parse((await anyone.get("/v1/hello")).body).node.id).toBe(await nodeId(core));
  });

  it("is reported as it comes and goes", async () => {
    const relayUrl = await startTestRelay();
    const states: RelayState[] = [];
    core = await startTestCore({ onRelayState: (state) => states.push(state) });
    await throughRelay(core, relayUrl);
    expect(states.at(-1)).toEqual({ url: relayUrl, connected: true, error: null });

    await relay.close();
    await until(() => states.at(-1)?.connected === false);
    expect(states.at(-1)?.error).toMatch(/relay/);
    await core.local.patch("/v1/settings", { network: { relayUrl: null } });
    expect(states.at(-1)).toEqual({ url: null, connected: false, error: null });
  });

  it("needs the relay's token when the relay is private — given in Settings, it works at once", async () => {
    const relayUrl = await startTestRelay(0, { token: PRIVATE_TOKEN });
    core = await startTestCore();
    await core.local.patch("/v1/settings", { network: { relayUrl } });
    await until(async () => (await settings(core)).network.relayError !== null);
    expect((await settings(core)).network).toMatchObject({
      relayConnected: false,
      relayError: "The relay is private and wants its token.",
      hasRelayToken: false,
    });

    // A wrong token changes nothing; the right one connects, with no restart and no waiting for the next retry.
    await core.local.patch("/v1/settings", { network: { relayToken: "a-guess" } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await settings(core)).network).toMatchObject({ relayConnected: false, hasRelayToken: true });
    const patched = await core.local.patch("/v1/settings", { network: { relayToken: PRIVATE_TOKEN } });
    expect(JSON.stringify(patched.body)).not.toContain(PRIVATE_TOKEN);
    await until(async () => (await settings(core)).network.relayConnected, 900);
    expect((await settings(core)).network).toMatchObject({ relayConnected: true, relayError: null, hasRelayToken: true });

    // It is kept for next time, with the other secrets.
    const home = core.home;
    await core.close();
    core = await startTestCore({ home });
    await until(async () => (await settings(core)).network.relayConnected);
  });

  it("takes the token from the environment too", async () => {
    const relayUrl = await startTestRelay(0, { token: PRIVATE_TOKEN });
    process.env.AGENTOS_RELAY_TOKEN = PRIVATE_TOKEN;
    core = await startTestCore();
    await core.local.patch("/v1/settings", { network: { relayUrl } });
    await until(async () => (await settings(core)).network.relayConnected);
    expect((await settings(core)).network.hasRelayToken).toBe(true);
    delete process.env.AGENTOS_RELAY_TOKEN;
  });
});

describe("a relay that cannot be trusted", () => {
  it("is not used over plain HTTP on a network: what passes would be readable on the way", async () => {
    core = await startTestCore();
    // An address nobody answers at: refused before any attempt is made.
    await core.local.patch("/v1/settings", { network: { relayUrl: "http://192.0.2.10:8080" } });
    expect((await settings(core)).network).toMatchObject({
      relayUrl: "http://192.0.2.10:8080",
      relayConnected: false,
      relayError: "The relay's address must start with https://.",
    });
    expect((await settings(core)).network.urls.some((url) => url.includes("192.0.2.10"))).toBe(false);
    await core.local.patch("/v1/node", { language: "fr" });
    await core.local.patch("/v1/settings", { network: { relayUrl: "http://192.0.2.11:8080" } });
    expect((await settings(core)).network.relayError).toBe("L'adresse du relais doit commencer par https://.");
  });

  it("cannot take the core down with what it sends: the tunnel is dropped, and the core carries on", async () => {
    // A relay that speaks nonsense: frames too short, of no known type, with requests of the wrong shape.
    const frame = (type: number, id: number, payload: string | Buffer = ""): Buffer => {
      const body = typeof payload === "string" ? Buffer.from(payload) : payload;
      const bytes = Buffer.alloc(5 + body.length);
      bytes.writeUInt8(type, 0);
      bytes.writeUInt32BE(id, 1);
      body.copy(bytes, 5);
      return bytes;
    };
    const nonsense = [
      Buffer.from([1]),
      frame(1, 1, "{ not json"),
      frame(1, 2, JSON.stringify({ kind: "ws", method: "GET", path: "/v1/events", headers: 5, client: "x" })),
      frame(1, 3, JSON.stringify({ kind: "http", method: "GET", path: 42, headers: [], client: "x" })),
      frame(1, 4, JSON.stringify({ kind: "http", method: "G E T", path: "/v1/hello", headers: [["Bad Name", "x"]], client: "x" })),
      frame(1, 5, JSON.stringify(null)),
      frame(3, 99, "data for a stream nobody opened"),
      frame(7, 6, "not four bytes"),
      frame(250, 7),
      frame(1, 8, JSON.stringify({ kind: "http", method: "GET", path: "/v1/hello", headers: [], client: "x" })),
      frame(7, 8, Buffer.from([0xff, 0xff, 0xff, 0xff])),
      frame(6, 8, "{ not json either"),
    ];
    let connections = 0;
    const fake = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    fake.on("connection", (socket) => {
      connections++;
      for (const bytes of nonsense) socket.send(bytes, { binary: true });
      socket.send("a text message, which the tunnel never uses");
    });
    await new Promise((resolve) => fake.once("listening", resolve));
    const address = fake.address() as { port: number };
    core = await startTestCore();
    await core.local.patch("/v1/settings", { network: { relayUrl: `http://127.0.0.1:${address.port}` } });
    await until(() => connections >= 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Still here, still answering.
    expect((await core.local.get("/v1/hello")).status).toBe(200);
    expect((await core.local.get("/v1/node")).status).toBe(200);
    await core.local.patch("/v1/settings", { network: { relayUrl: null } });
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });

  it("is hung up on when it sends far more in one message than a relay ever does", async () => {
    const closes: number[] = [];
    const fake = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    fake.on("connection", (socket) => {
      socket.on("close", (code) => closes.push(code));
      socket.send(Buffer.alloc(2 * 1024 * 1024), { binary: true });
    });
    await new Promise((resolve) => fake.once("listening", resolve));
    core = await startTestCore();
    await core.local.patch("/v1/settings", { network: { relayUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}` } });
    await until(() => closes.length >= 1);
    // The computer drops the connection ("message too big", or cut short), and carries on.
    expect([1006, 1009]).toContain(closes[0]);
    expect((await core.local.get("/v1/hello")).status).toBe(200);
    await core.local.patch("/v1/settings", { network: { relayUrl: null } });
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });
});
