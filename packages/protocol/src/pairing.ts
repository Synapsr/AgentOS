/**
 * Pairing links.
 *
 * The computer shows a QR code containing an `agentos://pair?…` link. A
 * client scans it, tries each URL until `GET /v1/hello` answers with the
 * expected node id, then calls `POST /v1/pair` with the code.
 *
 *   agentos://pair?v=1&c=<code>&i=<nodeId>&n=<name>&f=<fingerprint>&u=<url>&u=<url>
 *
 * Direct addresses are `https://` with the computer's own self-signed
 * certificate. A client must refuse any certificate whose SHA-256
 * fingerprint differs from `f`, and must keep checking it on every later
 * connection: that is what makes a plain Wi-Fi network safe to use. Relay
 * addresses are ordinary `https://` checked the usual way.
 */
import { PROTOCOL_VERSION } from "./schemas.js";

export interface PairingLink {
  /** One-time secret. Expires after a few minutes or on first use. */
  code: string;
  nodeId: string;
  /** Computer name, shown before pairing completes. */
  name: string;
  /** Base URLs to try, best first (Tailscale, LAN, relay). */
  urls: string[];
  /**
   * SHA-256 of the computer's certificate (DER), lowercase hex. Null only
   * for links made by a computer that serves no certificate.
   */
  fingerprint: string | null;
}

export const PAIRING_SCHEME = "agentos:";

export function encodePairingLink(link: PairingLink): string {
  const q = new URLSearchParams();
  q.set("v", String(PROTOCOL_VERSION));
  q.set("c", link.code);
  q.set("i", link.nodeId);
  q.set("n", link.name);
  if (link.fingerprint) q.set("f", link.fingerprint);
  for (const u of link.urls) q.append("u", u);
  return `agentos://pair?${q.toString()}`;
}

/** Returns null when the text is not a valid AgentOS pairing link. */
export function parsePairingLink(text: string): PairingLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== PAIRING_SCHEME || url.host !== "pair") return null;
  const q = url.searchParams;
  const code = q.get("c");
  const nodeId = q.get("i");
  const urls = q.getAll("u").filter((u) => /^https?:\/\//.test(u));
  if (!code || !nodeId || urls.length === 0) return null;
  const f = q.get("f")?.toLowerCase() ?? null;
  const fingerprint = f && /^[0-9a-f]{64}$/.test(f) ? f : null;
  return { code, nodeId, name: q.get("n") ?? "", urls, fingerprint };
}
