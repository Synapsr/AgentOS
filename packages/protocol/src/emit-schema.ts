/**
 * Writes `schema/agentos.schema.json`: the protocol as JSON Schema, for
 * clients not written in TypeScript (Swift, Kotlin) and for documentation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as protocol from "./index.js";

const definitions: Record<string, unknown> = {};
for (const [name, value] of Object.entries(protocol)) {
  if (value instanceof z.ZodType) {
    definitions[name] = z.toJSONSchema(value, { io: "input", unrepresentable: "any" });
  }
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../schema/agentos.schema.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      $comment: "Generated from packages/protocol/src — do not edit.",
      protocol: protocol.PROTOCOL_VERSION,
      definitions,
    },
    null,
    2,
  ) + "\n",
);
console.log(`protocol: wrote ${Object.keys(definitions).length} schemas to ${out}`);
