/**
 * How clients reach the computer: HTTPS with its own pinned certificate on
 * the network, plain HTTP only where nobody can listen in, and the local
 * token only from the computer itself.
 */
import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";
import { HelloResponse, PairResponse, PairingCode, parsePairingLink } from "@agentos/protocol";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { addresses, interfaceAddresses, isLoopback, isPrivatePath, isTailscale } from "../src/net.js";
import { type TestCore, startTestCore } from "./harness.js";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.close();
  core = undefined;
});

/** This computer's address on the local network, if it has one: tests that need a network use it. */
const lan = interfaceAddresses().find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !isTailscale(ip) && !ip.startsWith("169.254."));

interface Answer {
  status: number;
  body: any;
  /** SHA-256 of the certificate the server showed, lowercase hex; null over plain HTTP. */
  fingerprint: string | null;
}

/**
 * A request as a paired device makes it: over HTTPS, the certificate is not
 * checked against any authority — its fingerprint is compared with the one
 * from the pairing link, here returned for the test to compare.
 */
function call(url: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<Answer> {
  const secure = url.startsWith("https:");
  return new Promise((resolve, reject) => {
    const request = (secure ? httpsRequest : httpRequest)(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        rejectUnauthorized: false,
      },
      (response) => {
        const socket = response.socket as TLSSocket;
        const fingerprint = secure ? createHash("sha256").update(socket.getPeerCertificate().raw).digest("hex") : null;
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: text ? JSON.parse(text) : null, fingerprint }));
      },
    );
    request.on("error", reject);
    request.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

/** Opens the event stream; resolves with "open", or with the HTTP status it was refused with. */
function openStream(url: string, token: string): Promise<"open" | number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${url.replace(/^http/, "ws")}/v1/events`, { headers: { Authorization: `Bearer ${token}` }, rejectUnauthorized: false });
    socket.on("open", () => {
      socket.close();
      resolve("open");
    });
    socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.on("error", () => resolve(0));
  });
}

describe("which connections need no TLS", () => {
  it("knows this computer talking to itself", () => {
    for (const address of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "[::1]", "localhost"]) expect(isLoopback(address)).toBe(true);
    for (const address of ["192.168.1.10", "10.0.0.1", "100.100.1.1", "::ffff:192.168.1.10", "", undefined, null]) expect(isLoopback(address)).toBe(false);
  });

  it("knows Tailscale's addresses, and only those", () => {
    for (const address of ["100.64.0.1", "100.101.102.103", "100.127.255.254", "::ffff:100.100.1.1", "fd7a:115c:a1e0::1"]) expect(isTailscale(address)).toBe(true);
    for (const address of ["100.63.255.255", "100.128.0.1", "10.0.0.1", "192.168.1.10", "fd7a:115c:a1e1::1", ""]) expect(isTailscale(address)).toBe(false);
  });

  it("trusts a Tailscale peer only on one of this computer's own Tailscale addresses", () => {
    const own = ["192.168.1.143", "100.101.102.103"];
    expect(isPrivatePath("127.0.0.1", "127.0.0.1", own)).toBe(true);
    expect(isPrivatePath("::1", "::1", own)).toBe(true);
    expect(isPrivatePath("100.101.102.103", "100.90.1.2", own)).toBe(true);
    expect(isPrivatePath("::ffff:100.101.102.103", "::ffff:100.90.1.2", own)).toBe(true);
    // Someone on the Wi-Fi with an address in Tailscale's range, aiming at our ordinary address.
    expect(isPrivatePath("192.168.1.143", "100.90.1.2", own)).toBe(false);
    // An address in the range that is not ours.
    expect(isPrivatePath("100.64.0.9", "100.90.1.2", own)).toBe(false);
    // The local network, plainly.
    expect(isPrivatePath("192.168.1.143", "192.168.1.20", own)).toBe(false);
    expect(isPrivatePath("100.101.102.103", "192.168.1.20", own)).toBe(false);
    expect(isPrivatePath(undefined, undefined, own)).toBe(false);
  });

  it("offers nothing to other devices when listening on this computer only", async () => {
    expect(await addresses(4790, "127.0.0.1")).toEqual([]);
    expect(await addresses(4790, "::1")).toEqual([]);
  });
});

describe("on this computer", () => {
  it("speaks plain HTTP and HTTPS on the same port, and believes the local token either way", async () => {
    core = await startTestCore();
    const plain = await call(`http://127.0.0.1:${core.port}/v1/node`, { token: core.localToken });
    const secure = await call(`https://127.0.0.1:${core.port}/v1/node`, { token: core.localToken });
    expect([plain.status, secure.status]).toEqual([200, 200]);
    expect(secure.fingerprint).toBe(core.fingerprint);
    expect(plain.body.local).toBe(true);
    expect(secure.body.local).toBe(true);
  });

  it("proves it holds the local token, without showing it, to whoever asks first", async () => {
    core = await startTestCore();
    const challenge = "a-number-the-client-just-made-up";
    const hello = HelloResponse.parse((await call(`http://127.0.0.1:${core.port}/v1/hello?challenge=${challenge}`)).body);
    expect(hello.proof).toBe(createHmac("sha256", core.localToken).update(challenge).digest("hex"));
    expect(JSON.stringify(hello)).not.toContain(core.localToken);
    expect(HelloResponse.parse((await call(`http://127.0.0.1:${core.port}/v1/hello`)).body).proof).toBeNull();
  });
});

describe.skipIf(!lan)("on the local network", () => {
  /** A core listening everywhere, as one does by default: the local network, and this computer for its own apps. */
  const start = async (): Promise<string> => {
    core = await startTestCore({ host: "0.0.0.0" });
    return `https://${lan}:${core.port}`;
  };

  it("refuses plain HTTP before anything is read, saying what to do instead", async () => {
    const base = (await start()).replace("https:", "http:");
    const answer = await call(`${base}/v1/node`, { token: "whatever-was-sent" });
    expect(answer.status).toBe(403);
    expect(answer.body.error).toEqual({
      code: "forbidden",
      message: "This computer only answers over HTTPS on this network. Use https:// and check its certificate.",
    });
    expect((await call(`${base}/v1/hello`)).status).toBe(403);
  });

  it("answers over HTTPS with the certificate whose fingerprint the pairing link carries", async () => {
    const base = await start();
    const code = PairingCode.parse((await core!.local.post("/v1/pairing-codes")).body);
    const link = parsePairingLink(code.link);
    expect(link?.urls).toContain(base);
    expect(link?.urls.every((url) => url.startsWith("https://") || isTailscale(new URL(url).hostname))).toBe(true);
    expect(link?.fingerprint).toBe(core!.fingerprint);

    const hello = await call(`${base}/v1/hello?challenge=anything`);
    expect(hello.status).toBe(200);
    expect(hello.fingerprint).toBe(link?.fingerprint);
    // Only this computer itself is given the proof.
    expect(HelloResponse.parse(hello.body).proof).toBeNull();

    // A phone pairs and works over it.
    const device = { name: "Phone", platform: "ios" };
    const paired = PairResponse.parse((await call(`${base}/v1/pair`, { method: "POST", body: { code: code.code, device } })).body);
    expect((await call(`${base}/v1/node`, { token: paired.token })).body.local).toBe(false);
    expect(await openStream(base, paired.token)).toBe("open");
  });

  it("does not believe the local token from the network, even over HTTPS", async () => {
    const base = await start();
    expect((await call(`${base}/v1/node`, { token: core!.localToken })).status).toBe(401);
    expect((await call(`${base}/v1/pairing-codes`, { method: "POST", token: core!.localToken })).status).toBe(401);
    expect((await call(`${base}/v1/requests`, { token: core!.localToken })).status).toBe(401);
    expect(await openStream(base, core!.localToken)).toBe(401);
    // From this computer itself, the same token works.
    expect((await core!.local.get("/v1/node")).status).toBe(200);
  });
});
