#!/usr/bin/env node
/**
 * Runs the relay. Configured by the environment, as a container likes it:
 *
 *   RELAY_TOKEN        the secret a computer must present to use this relay. Required, unless:
 *   RELAY_OPEN         set to 1 for a relay open to any computer, which then passes on the API only
 *   PORT               port to listen on (8080)
 *   RELAY_DATA         folder for the one file it keeps (/data)
 *   RELAY_TRUST_PROXY  set to 1 behind a reverse proxy, to read client addresses from X-Forwarded-For
 */
import { type RunningRelay, startRelay } from "./relay.js";

const { PORT, RELAY_DATA, RELAY_TOKEN, RELAY_OPEN, RELAY_TRUST_PROXY } = process.env;

// Nothing that arrives from the network should be able to throw this far: see tunnel.ts. Should
// something ever do, it is one connection's trouble, and not a reason to drop every computer's.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error) => console.error("AgentOS relay: an unexpected error, which it survived.", error));
}

let relay: RunningRelay;
try {
  relay = await startRelay({
    port: Number(PORT ?? 8080),
    dataDir: RELAY_DATA ?? "/data",
    token: RELAY_TOKEN || undefined,
    open: RELAY_OPEN === "1",
    trustProxy: RELAY_TRUST_PROXY === "1",
  });
} catch (error) {
  // A setting to put right: said in words, without a stack of code under it.
  console.error((error as Error).message);
  process.exit(1);
}
console.log(`AgentOS relay listening on port ${relay.port} — ${RELAY_TOKEN ? "private: computers need its token" : "open to any computer: it passes on the API only"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void relay.close().then(() => process.exit(0)));
}
