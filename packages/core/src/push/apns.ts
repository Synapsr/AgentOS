/**
 * A small client for Apple's push service (APNs), with Node's own HTTP/2 and
 * crypto: one connection per Apple host, kept open; requests signed with a
 * provider token (a JWT, ES256) made from the app developer's `.p8` key.
 */
import { type KeyObject, createPrivateKey, sign } from "node:crypto";
import { type ClientHttp2Session, connect } from "node:http2";
import type { ApnsSettings } from "../config.js";

/** Apple's servers: one for apps installed from the store or TestFlight, one for development builds. */
export interface ApnsHosts {
  production: string;
  sandbox: string;
}
export const APPLE: ApnsHosts = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };

export interface Notification {
  /** `alert` shows something; `background` wakes the app quietly. */
  type: "alert" | "background";
  /** The notification's identifier on the device: a later one with the same id takes its place. */
  collapseId?: string;
  payload: object;
}

/** What became of a notification. `gone`: Apple no longer knows this device token. */
export type Delivery = "sent" | "gone" | "failed";

/** Apple wants a provider token no younger than 20 minutes replaced, and refuses one older than an hour. */
const TOKEN_LIFE_S = 50 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
/** Reasons that mean the device token will never work again. */
const DEAD_TOKEN = new Set(["BadDeviceToken", "Unregistered", "ExpiredToken"]);
/** Reasons that mean our provider token must be made again. */
const STALE_PROVIDER_TOKEN = new Set(["ExpiredProviderToken", "InvalidProviderToken"]);

export class Apns {
  private readonly key: KeyObject;
  private readonly sessions = new Map<string, ClientHttp2Session>();
  private providerToken: { jwt: string; issuedAt: number } | null = null;

  /** Throws when the key is not a private key. */
  constructor(
    private readonly settings: ApnsSettings,
    private readonly hosts: ApnsHosts = APPLE,
  ) {
    this.key = createPrivateKey(settings.key);
  }

  /** Sends one notification to one device. Never throws. */
  send(deviceToken: string, sandbox: boolean, notification: Notification): Promise<Delivery> {
    return new Promise((resolve) => {
      let status = 0;
      let body = "";
      const request = this.session(sandbox ? this.hosts.sandbox : this.hosts.production).request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${this.token()}`,
        "apns-topic": this.settings.topic,
        "apns-push-type": notification.type,
        // 10 delivers at once; a background update must use 5.
        "apns-priority": notification.type === "alert" ? "10" : "5",
        ...(notification.collapseId ? { "apns-collapse-id": notification.collapseId } : {}),
        "content-type": "application/json",
      });
      request.setEncoding("utf8");
      request.setTimeout(REQUEST_TIMEOUT_MS, () => request.close());
      request.on("response", (headers) => (status = Number(headers[":status"])));
      request.on("data", (chunk: string) => (body += chunk));
      request.on("error", () => resolve("failed"));
      request.on("close", () => resolve(this.outcome(status, body)));
      request.end(JSON.stringify(notification.payload));
    });
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  private outcome(status: number, body: string): Delivery {
    if (status === 200) return "sent";
    const reason = reasonOf(body);
    if (STALE_PROVIDER_TOKEN.has(reason)) this.providerToken = null;
    return status === 410 || DEAD_TOKEN.has(reason) ? "gone" : "failed";
  }

  /** The connection to a host, opened when first needed and again after it drops. */
  private session(host: string): ClientHttp2Session {
    const open = this.sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connect(host);
    // An idle connection to Apple is no reason to keep the process alive.
    session.unref();
    session.on("error", () => {});
    session.on("close", () => {
      if (this.sessions.get(host) === session) this.sessions.delete(host);
    });
    session.on("goaway", () => session.close());
    this.sessions.set(host, session);
    return session;
  }

  /** The provider token: who we are (team, key id), signed with the key, reused while it is fresh. */
  private token(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.providerToken && now - this.providerToken.issuedAt < TOKEN_LIFE_S) return this.providerToken.jwt;
    const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = `${part({ alg: "ES256", kid: this.settings.keyId })}.${part({ iss: this.settings.teamId, iat: now })}`;
    const signature = sign("sha256", Buffer.from(claims), { key: this.key, dsaEncoding: "ieee-p1363" }).toString("base64url");
    this.providerToken = { jwt: `${claims}.${signature}`, issuedAt: now };
    return this.providerToken.jwt;
  }
}

/** Apple's reason for a refusal, from its JSON body: `{"reason":"BadDeviceToken"}`. */
function reasonOf(body: string): string {
  try {
    return String((JSON.parse(body) as { reason?: unknown }).reason ?? "");
  } catch {
    return "";
  }
}
