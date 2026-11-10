import { randomBytes } from "node:crypto";

/** An opaque id with a readable prefix, e.g. `msg_9f2c41d07ab35e18`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** A secret with 256 bits of entropy: device tokens, the local token, pairing codes. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}
