/**
 * Real agent-desktop 1.2.0 output (envelope contract 2.6), captured on
 * macOS 26 with the system Calculator on a French system. One file per
 * envelope in `fixtures/`, exactly as printed on stdout.
 */
import { readFileSync } from "node:fs";
import { parseEnvelope } from "../src/agent-desktop.js";
import { BackendError } from "../src/backend.js";

/** The raw stdout of one captured command. */
export const raw = (name: string): string => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");

/** The `data` of a captured successful command. */
export const data = (name: string): any => parseEnvelope(raw(name));

/** The error a captured failed command turns into. */
export function failure(name: string): BackendError {
  try {
    parseEnvelope(raw(name));
  } catch (error) {
    if (error instanceof BackendError) return error;
  }
  throw new Error(`fixture ${name} is not an error envelope`);
}
