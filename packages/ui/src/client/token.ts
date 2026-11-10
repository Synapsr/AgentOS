import { parsePairingLink, type Settings } from "@agentos/protocol";
import { rootPath } from "../route";
import { failureCode } from "./client";
import { createHttpClient, pair } from "./http";

// Tokens are kept per computer: behind a private relay one origin serves all
// of the owner's computers, each under its own path. (That origin is the
// owner's own relay, which is why sharing it is acceptable. A relay open to
// everyone does not serve this app at all — it only forwards the API — so
// the storage of one origin is never shared between strangers. Do not make
// an open relay serve the app without rethinking where tokens are kept.)
const LOCAL_TOKEN = `agentos.local-token:${rootPath}`;
const DEVICE_TOKEN = `agentos.device-token:${rootPath}`;

/**
 * The token this page talks to the computer with, or null when it has none.
 *
 * The address may hand something over in its fragment, which is removed
 * from the address bar at once:
 * - `#token=…` — the local token, from the desktop app or `agentos url`.
 *   It is kept for this tab only.
 * - `#pair=…` — a pairing code, from the QR code shown for phones without
 *   the app (see `webPairingLink`). It is exchanged for a device token.
 * Otherwise a browser that was paired before still holds its device token.
 *
 * Anyone can write a link with a fragment, so what arrives this way is
 * never trusted over what is stored: a token is tried first and dropped if
 * the computer refuses it, and nothing stored is removed here.
 */
export async function findToken(base: string): Promise<string | null> {
  const handed = new URLSearchParams(location.hash.slice(1));
  if (handed.has("token") || handed.has("pair")) history.replaceState(null, "", location.pathname + location.search);
  const local = handed.get("token");
  if (local && !(await isRefused(base, local))) sessionStorage.setItem(LOCAL_TOKEN, local);
  // A code that no longer works simply leads to the "add this device" screen.
  const code = handed.get("pair");
  if (code) await pairThisDevice(base, code).catch(() => {});
  return sessionStorage.getItem(LOCAL_TOKEN) ?? localStorage.getItem(DEVICE_TOKEN);
}

/** Whether the computer itself says no to this token. Not being able to ask is not a refusal. */
async function isRefused(base: string, token: string): Promise<boolean> {
  return createHttpClient(base, token)
    .node()
    .then(
      () => false,
      (error) => failureCode(error) === "unauthorized",
    );
}

/** Forgets one token, once the computer has refused it — that one and no other. */
export function forgetToken(token: string): void {
  if (sessionStorage.getItem(LOCAL_TOKEN) === token) sessionStorage.removeItem(LOCAL_TOKEN);
  if (localStorage.getItem(DEVICE_TOKEN) === token) localStorage.removeItem(DEVICE_TOKEN);
}

/** Whether an address is one Tailscale gave: in 100.64.0.0/10, or a name under `ts.net`. */
function isTailscale(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  const [first = 0, second = 0] = host.split(".").map(Number);
  return host.endsWith(".ts.net") || (first === 100 && second >= 64 && second <= 127);
}

/**
 * The address a phone's browser can open this computer at, or null when
 * there is none. On the local network the computer speaks TLS with a
 * certificate of its own, which the apps check by its fingerprint but a
 * browser can only warn about — and nobody should learn to click through
 * such a warning. That leaves:
 * - the owner's own relay, over `https://`, when the computer is connected
 *   to it (a private one: a relay open to everyone does not serve the app);
 * - otherwise Tailscale, where plain `http://` travels inside its tunnel.
 */
export function browserAddress(network: Settings["network"]): string | null {
  const relay = network.relayUrl?.replace(/\/+$/, "");
  const throughRelay = relay?.startsWith("https://") && network.relayConnected && network.hasRelayToken;
  return (
    (throughRelay ? network.urls.find((url) => url.startsWith(`${relay}/`)) : undefined) ??
    network.urls.find((url) => url.startsWith("http://") && isTailscale(url)) ??
    null
  );
}

/** A link that opens this interface on another device and pairs it, given a fresh code. `address` comes from `browserAddress`. */
export function webPairingLink(address: string, code: string): string {
  return `${address.replace(/\/+$/, "")}/#pair=${encodeURIComponent(code)}`;
}

/**
 * Adds this browser as a device, from a pairing code or a pasted pairing
 * link (the app's `agentos://…` or ours). Only the code is taken from a
 * link: it is always redeemed at the address this page was opened at, never
 * at one of the addresses the link lists — those are for the apps, and on
 * the local network a browser could not open them without a warning.
 */
export async function pairThisDevice(base: string, codeOrLink: string): Promise<void> {
  const ours = /#pair=([^&\s]+)/.exec(codeOrLink)?.[1];
  const code = parsePairingLink(codeOrLink)?.code ?? (ours ? decodeURIComponent(ours) : codeOrLink.trim());
  const { token } = await pair(base, { code, device: { name: deviceName(), platform: "web" } });
  localStorage.setItem(DEVICE_TOKEN, token);
}

/** A name the owner will recognise in their list of devices, e.g. "Safari · iPhone". */
function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Web";
  return `${browser} · ${device}`;
}
