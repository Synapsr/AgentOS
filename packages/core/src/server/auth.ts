/** Who is calling, and whether the request really was meant for this computer. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { hostname } from "node:os";
import type { Device } from "@agentos/protocol";
import type { Core } from "../core.js";

/** An app on this computer (the local token), or a paired device. */
export type Caller = { kind: "local" } | { kind: "device"; device: Device };

/** Where a request comes from: this computer itself, the network around it (LAN, Tailscale), or the relay. */
export type Reach = "here" | "network" | "relay";

/**
 * Who a token belongs to, or null when it is nobody's. The local token
 * says "I am an app on this computer": it is only believed when the
 * connection really comes from this computer.
 */
export function identify(core: Core, token: string | null, reach: Reach): Caller | null {
  if (!token) return null;
  const local = core.home.localToken;
  if (local && sameSecret(token, local)) return reach === "here" ? { kind: "local" } : null;
  const device = core.store.devices.findByToken(token);
  return device ? { kind: "device", device } : null;
}

/**
 * Proof, for a local client, that what answers on the port is the core and
 * not something that got there first: only the holder of the local token can
 * compute it. The client checks it before it sends the token anywhere.
 */
export function proveToLocalClient(core: Core, challenge: string | undefined): string | null {
  const local = core.home.localToken;
  return local && challenge ? localProof(local, challenge) : null;
}

/** HMAC-SHA256(local token, challenge), lowercase hex: what `GET /v1/hello?challenge=` answers on this computer. */
export function localProof(localToken: string, challenge: string): string {
  return createHmac("sha256", localToken).update(challenge).digest("hex");
}

/** The token of an `Authorization: Bearer …` header. */
export function bearerToken(header: string | undefined): string | null {
  return /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1] ?? null;
}

/** Compares two secrets without revealing, through timing, how much of a guess was right. */
export function sameSecret(a: string, b: string): boolean {
  const digest = (secret: string): Buffer => createHash("sha256").update(secret).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Protection against DNS rebinding: a web page can make a browser send
 * requests to this computer under a domain name it controls, but it cannot
 * choose the `Host` header. We only answer to names such a page cannot own:
 * an IP address, `localhost`, this computer's own name, local-network names
 * (`*.local`) and Tailscale names (`*.ts.net`). What comes through the relay
 * does not come here by name at all, and is not checked this way.
 */
export function isTrustedHost(header: string | undefined): boolean {
  let name: string;
  try {
    name = new URL(`http://${header ?? ""}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (isIP(name.replace(/^\[|\]$/g, "")) !== 0) return true;
  if (name === "localhost" || name === hostname().toLowerCase()) return true;
  return name.endsWith(".local") || name.endsWith(".ts.net");
}
