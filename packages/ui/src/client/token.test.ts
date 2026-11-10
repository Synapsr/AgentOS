import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeResponse, Settings } from "@agentos/protocol";

/** Just enough of `Storage` for the tokens. */
class FakeStorage {
  private readonly data = new Map<string, string>();
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => void this.data.set(key, value);
  removeItem = (key: string) => void this.data.delete(key);
  values = () => [...this.data.values()];
}

const answer: NodeResponse = {
  node: {
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
    capabilities: { computer: true, engine: "mock", engineReady: true, voice: { provider: "device", stt: "device", tts: "device", ttsMime: null } },
  },
  status: { state: "idle", activity: null, mode: "desktop", pendingRequests: 0, workingThreads: 0 },
  local: false,
};

let tab: FakeStorage;
let browser: FakeStorage;
/** Tokens the computer accepts; `null` when it cannot be reached at all. */
let accepted: string[] | null;
let address: string;

/** Opens the page at `href` and loads the module as a fresh page would. */
async function open(href: string) {
  const url = new URL(href);
  address = href;
  vi.resetModules();
  vi.stubGlobal("location", { href, hash: url.hash, pathname: url.pathname, search: url.search });
  vi.stubGlobal("history", { replaceState: (_state: unknown, _title: string, to: string) => (address = url.origin + to) });
  vi.stubGlobal("sessionStorage", tab);
  vi.stubGlobal("localStorage", browser);
  vi.stubGlobal("fetch", async (_input: string, init: { headers: Record<string, string> }) => {
    if (accepted === null) throw new TypeError("unreachable");
    const token = init.headers.Authorization?.replace("Bearer ", "") ?? "";
    return accepted.includes(token)
      ? Response.json(answer)
      : Response.json({ error: { code: "unauthorized", message: "A valid token is required." } }, { status: 401 });
  });
  const token = await import("./token");
  return { ...token, found: await token.findToken(url.origin) };
}

beforeEach(() => {
  tab = new FakeStorage();
  browser = new FakeStorage();
  accepted = ["device-token", "local-token"];
});

describe("the token a page starts with", () => {
  it("is the stored device token, when the address hands nothing over", async () => {
    expect((await open("http://computer.test/")).found).toBeNull();
    browser.setItem("agentos.device-token:/", "device-token");
    expect((await open("http://computer.test/settings")).found).toBe("device-token");
  });

  it("is not replaced, nor erased, by a link carrying a token the computer refuses", async () => {
    browser.setItem("agentos.device-token:/", "device-token");
    const { found } = await open("http://computer.test/#token=made-up");
    expect(found).toBe("device-token");
    expect(tab.values()).toEqual([]);
    expect(browser.values()).toEqual(["device-token"]);
    expect(address).toBe("http://computer.test/");
  });

  it("is the token handed over by the desktop app, for this tab, once the computer accepts it", async () => {
    browser.setItem("agentos.device-token:/", "device-token");
    const { found } = await open("http://computer.test/os#token=local-token");
    expect(found).toBe("local-token");
    expect(tab.values()).toEqual(["local-token"]);
    expect(browser.values()).toEqual(["device-token"]);
    expect(address).toBe("http://computer.test/os");
  });

  it("keeps a handed token it could not check, and later forgets only the one that is refused", async () => {
    browser.setItem("agentos.device-token:/", "device-token");
    accepted = null;
    const page = await open("http://computer.test/#token=made-up");
    expect(page.found).toBe("made-up");

    // The computer is back, and says no to it: that token goes, the device stays paired.
    accepted = ["device-token"];
    page.forgetToken("made-up");
    expect(browser.values()).toEqual(["device-token"]);
    expect((await open("http://computer.test/")).found).toBe("device-token");
  });

  it("forgets the device token only when that is the one refused", async () => {
    browser.setItem("agentos.device-token:/", "device-token");
    const page = await open("http://computer.test/");
    page.forgetToken("something-else");
    expect(browser.values()).toEqual(["device-token"]);
    page.forgetToken("device-token");
    expect(browser.values()).toEqual([]);
  });

  it("is kept apart for each computer behind one relay", async () => {
    browser.setItem("agentos.device-token:/n/node_a/", "device-token");
    expect((await open("https://relay.test/n/node_a/panel")).found).toBe("device-token");
    expect((await open("https://relay.test/n/node_b/")).found).toBeNull();
  });
});

describe("the address offered to a phone's browser", () => {
  const network = (patch: Partial<Settings["network"]>): Settings["network"] => ({
    port: 4747,
    urls: ["https://192.168.1.24:4747"],
    relayUrl: null,
    relayConnected: false,
    relayError: null,
    hasRelayToken: false,
    ...patch,
  });
  const lan = "https://192.168.1.24:4747";
  const tailscale = "http://100.92.14.7:4747";
  const relayed = "https://relay.example.com/n/node_1";
  const relay = { relayUrl: "https://relay.example.com/", relayConnected: true, hasRelayToken: true };

  it("is never one on the local network: a browser would warn about its certificate", async () => {
    const { browserAddress } = await open("http://computer.test/");
    expect(browserAddress(network({}))).toBeNull();
    expect(browserAddress(network({ urls: [lan, "http://192.168.1.24:4747", "http://10.0.0.3:4747"] }))).toBeNull();
  });

  it("is a Tailscale address, by number or by name, over plain http", async () => {
    const { browserAddress } = await open("http://computer.test/");
    expect(browserAddress(network({ urls: [lan, tailscale] }))).toBe(tailscale);
    expect(browserAddress(network({ urls: ["http://studio.tail1234.ts.net:4747", lan] }))).toBe("http://studio.tail1234.ts.net:4747");
    expect(browserAddress(network({ urls: ["https://100.92.14.7:4747", "http://100.128.0.1:4747"] }))).toBeNull();
  });

  it("is the owner's relay first, when it is private, connected and over https", async () => {
    const { browserAddress, webPairingLink } = await open("http://computer.test/");
    const urls = [tailscale, lan, relayed];
    expect(browserAddress(network({ urls, ...relay }))).toBe(relayed);
    expect(webPairingLink(relayed, "a code/1")).toBe("https://relay.example.com/n/node_1/#pair=a%20code%2F1");
    // Not connected, open to everyone, or not encrypted: Tailscale, or nothing.
    expect(browserAddress(network({ urls, ...relay, relayConnected: false }))).toBe(tailscale);
    expect(browserAddress(network({ urls, ...relay, hasRelayToken: false }))).toBe(tailscale);
    expect(browserAddress(network({ urls: [lan, "http://relay.example.com/n/node_1"], ...relay, relayUrl: "http://relay.example.com" }))).toBeNull();
  });
});
