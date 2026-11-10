import { request } from "node:http";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApiError,
  DevicesResponse,
  Empty,
  HelloResponse,
  NodeResponse,
  PairResponse,
  PairingCode,
  Settings,
  ThreadsResponse,
  parsePairingLink,
} from "@agentos/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { isTrustedHost } from "../src/server/auth.js";
import { PairingCodes, RateLimiter } from "../src/server/pairing.js";
import { type TestCore, fakeComputer, startTestCore, tempHome } from "./harness.js";

let core: TestCore;
afterEach(() => core?.close());

/** Creates a pairing code and pairs a device with it. */
async function pairDevice(name = "Marie's iPhone"): Promise<PairResponse> {
  const code = PairingCode.parse((await core.local.post("/v1/pairing-codes")).body);
  const paired = await core.local.as(null).post("/v1/pair", { code: code.code, device: { name, platform: "ios" } });
  return PairResponse.parse(paired.body);
}

/** A GET with a `Host` header of our choosing, which `fetch` does not allow. */
function getWithHost(path: string, host: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: core.port, path, headers: { Host: host } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("hello", () => {
  it("answers without a token", async () => {
    core = await startTestCore();
    const { status, body } = await core.local.as(null).get("/v1/hello");
    expect(status).toBe(200);
    expect(HelloResponse.parse(body)).toMatchObject({ app: "agentos", protocol: 1, onboarded: false, node: { agentName: "Nova" } });
  });
});

describe("authentication", () => {
  it("refuses a missing or wrong token", async () => {
    core = await startTestCore();
    for (const token of [null, "not-a-token", `${core.localToken}x`]) {
      const { status, body } = await core.local.as(token).get("/v1/node");
      expect(status).toBe(401);
      expect(ApiError.parse(body).error.code).toBe("unauthorized");
    }
  });

  it("accepts the local token and a device token", async () => {
    core = await startTestCore();
    const { token, device } = await pairDevice();
    // Each caller is told whether it is the computer itself.
    expect(NodeResponse.parse((await core.local.get("/v1/node")).body)).toMatchObject({ status: { state: "idle" }, local: true });
    expect(NodeResponse.parse((await core.local.as(token).get("/v1/node")).body)).toMatchObject({
      node: { agent: { name: "Nova" } },
      local: false,
    });
    const { devices } = DevicesResponse.parse((await core.local.as(token).get("/v1/devices")).body);
    expect(devices.map((d) => d.id)).toEqual([device.id]);
    expect(devices[0]?.lastSeenAt).not.toBeNull();
  });

  it("keeps local routes for the local token", async () => {
    core = await startTestCore();
    const device = core.local.as((await pairDevice()).token);
    const refused = [
      await device.patch("/v1/node", { agentName: "Eve" }),
      await device.get("/v1/settings"),
      await device.patch("/v1/settings", { engine: { apiKey: "sk-ant-stolen" } }),
      await device.post("/v1/pairing-codes"),
      await device.call("DELETE", "/v1/devices/dev_x"),
      await device.post("/v1/computer/permissions"),
    ];
    for (const { status, body } of refused) {
      expect(status).toBe(403);
      expect(ApiError.parse(body).error.code).toBe("forbidden");
    }
    expect(NodeResponse.parse((await core.local.get("/v1/node")).body).node.agent.name).toBe("Nova");
  });

  it("stops answering a device that was removed, and hangs up on it", async () => {
    core = await startTestCore();
    const { token, device } = await pairDevice();
    const other = await pairDevice("Marie's iPad");
    const [listening, alsoListening] = [await core.stream({ token }), await core.stream({ token })];
    const [otherDevice, computer] = [await core.stream({ token: other.token }), await core.stream()];
    const hungUp = Promise.all([listening.closed(), alsoListening.closed()]);

    const removed = await core.local.call("DELETE", `/v1/devices/${device.id}`);
    expect(DevicesResponse.parse(removed.body).devices.map((d) => d.id)).toEqual([other.device.id]);
    // Every stream the device had open is closed, as a matter of policy; nobody else is disturbed.
    expect(await hungUp).toEqual([1008, 1008]);
    expect((await core.local.as(token).get("/v1/node")).status).toBe(401);
    await expect(core.stream({ token })).rejects.toThrow();
    expect((await core.local.call("DELETE", `/v1/devices/${device.id}`)).status).toBe(404);

    await core.local.post("/v1/threads/main/messages", { text: "hello" });
    expect((await otherDevice.find("turn.completed")).ok).toBe(true);
    expect((await computer.find("turn.completed")).ok).toBe(true);
    otherDevice.close();
    computer.close();
  });

  it("lets a device remove its own pairing — which `/v1/devices/:id`, kept for the computer, does not take for an id", async () => {
    core = await startTestCore();
    const { token, device } = await pairDevice();
    const other = await pairDevice("Marie's iPad");
    const phone = core.local.as(token);
    // Someone else's pairing is not a device's to remove.
    expect((await phone.call("DELETE", `/v1/devices/${other.device.id}`)).status).toBe(403);
    const removed = await phone.call("DELETE", "/v1/devices/me");
    expect([removed.status, Empty.parse(removed.body)]).toEqual([200, {}]);
    expect((await phone.get("/v1/node")).status).toBe(401);
    expect(DevicesResponse.parse((await core.local.get("/v1/devices")).body).devices.map((d) => d.id)).toEqual([other.device.id]);
    expect(device.id).not.toBe(other.device.id);
    // There is no device called "me" for the computer to remove either.
    expect((await core.local.call("DELETE", "/v1/devices/me")).status).toBe(400);
  });

  it("lets a device register for notifications, and only a device", async () => {
    core = await startTestCore();
    const { token } = await pairDevice();
    const registration = { kind: "apns", token: "abc123", sandbox: true };
    const registered = await core.local.as(token).call("PUT", "/v1/devices/me/push", registration);
    expect(registered.status).toBe(200);
    expect(Empty.parse(registered.body)).toEqual({});
    expect((await core.local.call("PUT", "/v1/devices/me/push", registration)).status).toBe(403);
    expect((await core.local.as(token).call("PUT", "/v1/devices/me/push", { kind: "pigeon" })).status).toBe(400);
  });

  it("only answers to names a web page cannot own (DNS rebinding)", async () => {
    core = await startTestCore();
    for (const host of ["evil.example.com", `evil.example.com:${core.port}`, "localhost.evil.example.com", "local", "ts.net"]) {
      const { status, body } = await getWithHost("/v1/hello", host);
      expect(status).toBe(403);
      expect(ApiError.parse(body).error.code).toBe("forbidden");
    }
    for (const host of ["localhost", `127.0.0.1:${core.port}`, "192.168.1.20:4747", "[::1]:4747", "studio.local", "studio.tail1234.ts.net:4747"]) {
      expect((await getWithHost("/v1/hello", host)).status).toBe(200);
    }
    // A request with no `Host` at all was not made by a browser we need to answer.
    expect(isTrustedHost(undefined)).toBe(false);
    expect(isTrustedHost("")).toBe(false);
  });

  it("sends no CORS permission", async () => {
    core = await startTestCore();
    const response = await fetch(`${core.local.base}/v1/hello`, { headers: { Origin: "https://example.com" } });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("pairing", () => {
  it("gives a link with the code, the computer and the certificate to expect", async () => {
    core = await startTestCore();
    const code = PairingCode.parse((await core.local.post("/v1/pairing-codes")).body);
    // Listening on this computer only, it has no address to offer a phone (see transport.test.ts for one that has).
    const link = new URL(code.link).searchParams;
    expect(link.get("c")).toBe(code.code);
    expect(link.get("i")).toBe(HelloResponse.parse((await core.local.get("/v1/hello")).body).node.id);
    expect(link.get("f")).toBe(core.fingerprint);
    expect(link.getAll("u")).toEqual([]);
    expect(code.expiresAt - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(code.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    expect(code.code.length).toBeGreaterThanOrEqual(32);
  });

  it("accepts a code once only", async () => {
    core = await startTestCore();
    const { code } = PairingCode.parse((await core.local.post("/v1/pairing-codes")).body);
    const device = { name: "Phone", platform: "android" };
    const anyone = core.local.as(null);
    expect((await anyone.post("/v1/pair", { code, device })).status).toBe(200);
    const again = await anyone.post("/v1/pair", { code, device });
    expect(again.status).toBe(401);
    expect(ApiError.parse(again.body).error.code).toBe("unauthorized");
  });

  it("refuses a wrong code and a malformed request", async () => {
    core = await startTestCore();
    const anyone = core.local.as(null);
    expect((await anyone.post("/v1/pair", { code: "guess", device: { name: "Phone", platform: "ios" } })).status).toBe(401);
    const malformed = await anyone.post("/v1/pair", { code: "guess", device: { name: "", platform: "toaster" } });
    expect(malformed.status).toBe(400);
    expect(ApiError.parse(malformed.body).error.code).toBe("invalid");
  });

  it("limits how fast codes can be tried", async () => {
    core = await startTestCore();
    const anyone = core.local.as(null);
    const attempt = () => anyone.post("/v1/pair", { code: "guess", device: { name: "Phone", platform: "ios" } });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(ApiError.parse((await attempt()).body).error.code).toBe("rate_limited");
  });

  it("lets a code expire after five minutes", () => {
    let now = 1_000_000;
    const codes = new PairingCodes(() => now);
    const fresh = codes.create();
    const stale = codes.create();
    expect(fresh.expiresAt).toBe(now + 5 * 60_000);
    now += 4 * 60_000;
    expect(codes.redeem(fresh.code)).toBe(true);
    expect(codes.redeem(fresh.code)).toBe(false);
    now += 61_000;
    expect(codes.redeem(stale.code)).toBe(false);
  });

  it("forgets attempts once the window has passed", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect([limiter.allow("a"), limiter.allow("a"), limiter.allow("a")]).toEqual([true, true, false]);
    expect(limiter.allow("b")).toBe(true);
    now = 1001;
    expect(limiter.allow("a")).toBe(true);
  });
});

describe("node and settings", () => {
  it("completes onboarding through PATCH /v1/node", async () => {
    core = await startTestCore();
    const events = await core.stream();
    const patched = await core.local.patch("/v1/node", { agentName: "Léa", ownerName: "Marie", language: "fr", onboarded: true });
    expect(NodeResponse.parse(patched.body).node).toMatchObject({
      agent: { name: "Léa" },
      owner: { name: "Marie" },
      language: "fr",
      onboarded: true,
    });
    expect((await events.find("node.updated", (e) => e.node.onboarded)).node.agent.name).toBe("Léa");
    // The one conversation is named after the agent.
    expect((await events.find("thread.updated", (e) => e.thread.id === "main")).thread.title).toBe("Léa");
    expect((await core.local.patch("/v1/node", { autonomy: "reckless" })).status).toBe(400);
    events.close();
  });

  it("switches between desktop and OS mode", async () => {
    core = await startTestCore();
    const events = await core.stream();
    expect(NodeResponse.parse((await core.local.post("/v1/mode", { mode: "os" })).body).status.mode).toBe("os");
    expect((await events.find("node.status")).status.mode).toBe("os");
    events.close();
  });

  it("shows settings without ever returning a key", async () => {
    core = await startTestCore();
    const before = Settings.parse((await core.local.get("/v1/settings")).body);
    expect(before.engine).toEqual({ provider: "mock", model: null, auth: "none", hasWorkspaceId: false, ready: true });
    expect(before.voice).toMatchObject({ provider: "device", voice: null, hasKey: false, url: null });
    expect(before.voice.available).toEqual(
      expect.arrayContaining([
        { id: "device", label: expect.any(String), needsKey: false, needsUrl: false },
        { id: "elevenlabs", label: expect.any(String), needsKey: true, needsUrl: false },
        { id: "local", label: expect.any(String), needsKey: false, needsUrl: true },
      ]),
    );
    expect(before.network).toMatchObject({ port: core.port, relayUrl: null, relayConnected: false, relayError: null, hasRelayToken: false });

    const patched = await core.local.patch("/v1/settings", {
      engine: { model: "claude-haiku-5-5", apiKey: "sk-ant-test-key", workspaceId: "wrkspc_test-key" },
      voice: { provider: "elevenlabs", voice: "Rachel", apiKey: "el-test-key", url: "http://127.0.0.1:8000" },
      network: { relayUrl: "http://127.0.0.1:9" },
    });
    const after = Settings.parse(patched.body);
    expect(after.engine).toMatchObject({ model: "claude-haiku-5-5", hasWorkspaceId: true });
    expect(after.voice).toMatchObject({ provider: "elevenlabs", voice: "Rachel", hasKey: true, url: "http://127.0.0.1:8000" });
    expect(after.network.relayUrl).toBe("http://127.0.0.1:9");
    expect(JSON.stringify(after)).not.toContain("test-key");
    // A relay's token is a secret like the others: stored apart, and only its presence is told.
    const withToken = Settings.parse((await core.local.patch("/v1/settings", { network: { relayToken: " relay-test-key " } })).body);
    expect(withToken.network).toMatchObject({ hasRelayToken: true, relayUrl: "http://127.0.0.1:9", relayConnected: false });
    expect(JSON.stringify(withToken)).not.toContain("relay-test-key");
    expect(JSON.parse(readFileSync(join(core.home, "secrets.json"), "utf8")).relayToken).toBe("relay-test-key");
    expect(readFileSync(join(core.home, "config.json"), "utf8")).not.toContain("relay-test-key");
    expect(Settings.parse((await core.local.patch("/v1/settings", { network: { relayToken: "" } })).body).network.hasRelayToken).toBe(false);
    // Voice settings have one shape on disk; keys are elsewhere.
    expect(JSON.parse(readFileSync(join(core.home, "config.json"), "utf8")).voice).toEqual({
      provider: "elevenlabs",
      voice: "Rachel",
      url: "http://127.0.0.1:8000",
      sttModel: null,
      ttsModel: null,
    });
    const emptied = Settings.parse((await core.local.patch("/v1/settings", { engine: { workspaceId: "" }, voice: { url: null } })).body);
    expect(emptied.engine.hasWorkspaceId).toBe(false);
    expect(emptied.voice).toMatchObject({ provider: "elevenlabs", voice: "Rachel", url: null });

    const secrets = join(core.home, "secrets.json");
    expect(statSync(secrets).mode & 0o777).toBe(0o600);
    expect(statSync(join(core.home, "local-token")).mode & 0o777).toBe(0o600);

    const cleared = Settings.parse((await core.local.patch("/v1/settings", { voice: { apiKey: "" } })).body);
    expect(cleared.voice.hasKey).toBe(false);
    expect((await core.local.patch("/v1/settings", { engine: { provider: "hal9000" } })).status).toBe(400);
  });
});

describe("organs that are not there", () => {
  it("says so for the screen and the voice", async () => {
    core = await startTestCore();
    for (const response of [
      await core.local.get("/v1/screen"),
      await core.local.post("/v1/voice/speak", { text: "Bonjour" }),
      await fetch(`${core.local.base}/v1/voice/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${core.localToken}`, "Content-Type": "audio/wav" },
        body: new Uint8Array([1, 2, 3]),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
    ]) {
      expect(response.status).toBe(503);
      expect(ApiError.parse(response.body).error.code).toBe("unavailable");
    }
  });

  it("shows the screen when the computer has eyes", async () => {
    core = await startTestCore({ computer: fakeComputer() });
    const response = await fetch(`${core.local.base}/v1/screen?maxWidth=800`, { headers: { Authorization: `Bearer ${core.localToken}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect((await core.local.get("/v1/screen?maxWidth=wide")).status).toBe(400);
    expect((await core.local.post("/v1/computer/permissions")).body).toEqual({ accessibility: true, screenRecording: true });
    expect(NodeResponse.parse((await core.local.get("/v1/node")).body).node.capabilities.computer).toBe(true);
  });

  it("passes on a voice provider's failure in the API's error shape", async () => {
    // A speech server that is not running: the nearest thing to a provider failing, without a provider.
    process.env.AGENTOS_VOICE = "local";
    process.env.AGENTOS_VOICE_URL = "http://127.0.0.1:1";
    core = await startTestCore();
    delete process.env.AGENTOS_VOICE;
    delete process.env.AGENTOS_VOICE_URL;
    const { node } = NodeResponse.parse((await core.local.get("/v1/node")).body);
    expect(node.capabilities.voice).toMatchObject({ provider: "local", stt: "server", tts: "server" });
    const spoken = await core.local.post("/v1/voice/speak", { text: "Bonjour" });
    expect(spoken.status).toBe(503);
    expect(ApiError.parse(spoken.body).error).toMatchObject({ code: "unavailable", message: expect.stringMatching(/\S/) });
    expect((await core.local.post("/v1/voice/speak", { text: "" })).status).toBe(400);
  });

  it("answers unknown routes and files in the API's error shape", async () => {
    core = await startTestCore();
    for (const path of ["/v1/nope", "/v1/files/file_00.jpg", "/v1/files/..%2Fsecrets.json", "/v1/threads/thr_x/items"]) {
      const { status, body } = await core.local.get(path);
      expect(status).toBe(404);
      expect(ApiError.parse(body).error.code).toBe("not_found");
    }
    expect(ThreadsResponse.parse((await core.local.get("/v1/threads")).body).threads.map((t) => t.id)).toEqual(["main"]);
  });
});

describe("the app", () => {
  it("shows a small page when the app has not been built", async () => {
    process.env.AGENTOS_UI_DIR = join(tempHome(), "nowhere");
    core = await startTestCore();
    const response = await fetch(`${core.local.base}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nova is awake on this computer.");
  });

  it("serves the built app, with index.html for its own paths", async () => {
    const dist = tempHome();
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<title>AgentOS app</title>");
    writeFileSync(join(dist, "assets", "app-1a2b.js"), "console.log('app')");
    writeFileSync(join(dist, "..", "outside.txt"), "private");
    chmodSync(dist, 0o755);
    process.env.AGENTOS_UI_DIR = dist;
    core = await startTestCore();

    for (const path of ["/", "/os", "/panel", "/settings", "/onboarding", "/a/deep/link", "/..%2Foutside"]) {
      const response = await fetch(core.local.base + path);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toBe("<title>AgentOS app</title>");
    }
    // Assets are found from any depth, since the app links them relatively (`./assets/…`).
    for (const path of ["/assets/app-1a2b.js", "/a/deep/assets/app-1a2b.js"]) {
      const asset = await fetch(core.local.base + path);
      expect(asset.headers.get("content-type")).toContain("text/javascript");
      expect(asset.headers.get("cache-control")).toContain("immutable");
      expect(await asset.text()).toBe("console.log('app')");
    }
    // A file that is not there is a 404, not the app's page; and nothing outside the app is served.
    for (const path of ["/assets/missing.js", "/favicon.ico", "/..%2Foutside.txt", "/assets/..%2F..%2Foutside.txt"]) {
      const missing = await fetch(core.local.base + path);
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe("Not found");
    }
  });

  it("tells the browser what the app's page may do: its own files only, in no frame, telling nobody where it was", async () => {
    const dist = tempHome();
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<title>AgentOS app</title>");
    writeFileSync(join(dist, "assets", "app-1a2b.js"), "console.log('app')");
    process.env.AGENTOS_UI_DIR = dist;
    core = await startTestCore();

    const page = await fetch(`${core.local.base}/settings`);
    const host = `127.0.0.1:${core.port}`;
    expect(page.headers.get("content-security-policy")).toBe(
      `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self' ws://${host} wss://${host}; ` +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    // The address may carry the token (`#token=`, `?token=`): it never leaves in a Referer.
    for (const response of [page, await fetch(`${core.local.base}/assets/app-1a2b.js`), await fetch(`${core.local.base}/v1/hello`)]) {
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    // What is not the app's page is data: nothing in it runs, nothing frames it.
    for (const path of ["/v1/hello", "/v1/nope", "/assets/app-1a2b.js"]) {
      expect((await fetch(core.local.base + path)).headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    }
    // A Host that is not a plain name and port is left out of the policy rather than written into it.
    const odd = await new Promise<string | undefined>((resolve, reject) => {
      request({ host: "127.0.0.1", port: core.port, path: "/", headers: { Host: "127.0.0.1:1;x" } }, (response) => {
        resolve(response.headers["content-security-policy"] as string | undefined);
        response.resume();
      })
        .on("error", reject)
        .end();
    });
    expect(odd ?? "").not.toContain(";x");
  });

  it("lets nothing keep the page or what the API says — only the app's files, which never change", async () => {
    const dist = tempHome();
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<title>AgentOS app</title>");
    writeFileSync(join(dist, "assets", "app-1a2b.js"), "console.log('app')");
    process.env.AGENTOS_UI_DIR = dist;
    core = await startTestCore({ computer: fakeComputer() });
    const cache = async (path: string, token: string | null = core.localToken): Promise<string | null> =>
      (await fetch(core.local.base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).headers.get("cache-control");

    // A browser files a page under its address — `#token=…` included — unless told not to.
    for (const path of ["/", "/settings", "/a/deep/link"]) expect(await cache(path, null)).toBe("no-store");
    expect(await cache("/assets/app-1a2b.js", null)).toBe("public, max-age=31536000, immutable");
    for (const path of ["/v1/hello", "/v1/node", "/v1/threads", "/v1/nope", "/v1/screen"]) expect(await cache(path)).toBe("no-store");
    expect(await cache("/v1/node", null)).toBe("no-store");
    // A screenshot too: what was on the screen is the owner's.
    const events = await core.stream();
    await core.local.post("/v1/threads/main/messages", { text: "deploy the site" });
    const asked = (await events.find("item.added", (e) => e.item.type === "request")).item;
    const screenshot = asked.type === "request" ? asked.screenshot?.id : undefined;
    expect(await cache(`/v1/files/${screenshot}`)).toBe("no-store");
    events.close();
  });

  it("serves the placeholder page under a policy that runs nothing, and keeps no copy of it", async () => {
    process.env.AGENTOS_UI_DIR = join(tempHome(), "nowhere");
    core = await startTestCore();
    const response = await fetch(`${core.local.base}/`);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
