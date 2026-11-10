/** Adding a device: one-time codes, and a limit on how fast they can be tried. */
import { newSecret } from "../ids.js";
import { sameSecret } from "./auth.js";

/** How long a pairing code can be used: long enough to pick up a phone, no longer. */
const CODE_LIFETIME_MS = 5 * 60_000;

/** One-time pairing codes. They live in memory only: a restart cancels them. */
export class PairingCodes {
  private readonly expiry = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A new code, with as much entropy as a token. */
  create(): { code: string; expiresAt: number } {
    this.forgetExpired();
    const code = newSecret();
    const expiresAt = this.now() + CODE_LIFETIME_MS;
    this.expiry.set(code, expiresAt);
    return { code, expiresAt };
  }

  /** True exactly once, for a code that exists and has not expired. */
  redeem(candidate: string): boolean {
    this.forgetExpired();
    for (const code of this.expiry.keys()) {
      if (!sameSecret(code, candidate)) continue;
      this.expiry.delete(code);
      return true;
    }
    return false;
  }

  private forgetExpired(): void {
    for (const [code, expiresAt] of this.expiry) {
      if (expiresAt <= this.now()) this.expiry.delete(code);
    }
  }
}

/** Allows `limit` attempts per `windowMs` for each key (an IP address). */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts an attempt. False when the key has used up its allowance. */
  allow(key: string): boolean {
    const since = this.now() - this.windowMs;
    for (const [other, times] of this.attempts) {
      if ((times.at(-1) ?? 0) <= since) this.attempts.delete(other);
    }
    const recent = (this.attempts.get(key) ?? []).filter((time) => time > since);
    if (recent.length >= this.limit) return false;
    this.attempts.set(key, [...recent, this.now()]);
    return true;
  }
}
