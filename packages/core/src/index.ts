/**
 * @agentos/core — the AgentOS daemon, as a library.
 *
 * `startCore()` is all an embedder (the desktop shell, a test) needs: it
 * opens the data directory, wakes the agent and serves the API.
 */
import { join } from "node:path";
import { type Computer, createComputer } from "@agentos/computer";
import { Home } from "./config.js";
import type { Core } from "./core.js";
import { type Engine, createEngine } from "./engine/index.js";
import { type Log, eventLines } from "./log.js";
import { localUrl } from "./net.js";
import { AgentNode } from "./node.js";
import { APPLE, type ApnsHosts } from "./push/apns.js";
import { RelayClient, type RelayState } from "./relay.js";
import { startServer } from "./server/index.js";
import { configuredVoice } from "./settings.js";
import { openStore } from "./store/index.js";
import { loadTlsIdentity } from "./tls.js";
import { VERSION } from "./version.js";

export type { Engine, EngineHost, EngineSession, EngineStatus } from "./engine/index.js";
export type { RelayState } from "./relay.js";
export { VERSION } from "./version.js";

export interface CoreOptions {
  /** Data directory. Default: `AGENTOS_HOME`, else `~/.agentos`. */
  home?: string;
  /** Port to listen on; 0 picks a free one. Default: the configured port. */
  port?: number;
  /** Address to listen on. Default: the configured one, else every interface, so that a phone can connect. */
  host?: string;
  /**
   * The local token, when the app that starts the core made it and keeps it
   * to itself: none is then written to disk. Without it the core makes its
   * own, new at every start, in a file only the owner can read.
   */
  localToken?: string;
  /** An engine to use instead of the configured one. */
  engine?: Engine;
  /** A computer to use instead of this one. */
  computer?: Computer;
  /** Called when the connection to the relay comes, goes, or fails for a new reason. */
  onRelayState?: (state: RelayState) => void;
  /** Push servers to use instead of Apple's. */
  apnsHosts?: ApnsHosts;
  /** Where to write the journal: one terse line per thing that happens, with nothing private in it. */
  log?: Log;
}

export interface CoreHandle {
  /** Address of the app for a browser on this computer. */
  url: string;
  port: number;
  /** Token for apps on this computer. It only works from this computer itself, and only until `close`. */
  localToken: string;
  /** SHA-256 of the certificate served to the network (DER, lowercase hex): what paired devices pin. */
  fingerprint: string;
  /** Stops the agent and the server, leaving the data directory at rest. */
  close(): Promise<void>;
}

/** Starts the core. Rejects when the port is taken. */
export async function startCore(options: CoreOptions = {}): Promise<CoreHandle> {
  const home = new Home(options.home);
  const localToken = options.localToken === undefined ? home.renewLocalToken() : home.adoptLocalToken(options.localToken);
  const computer = options.computer ?? createComputer({ stateDir: join(home.dir, "computer") });
  const makeEngine = (): Engine => options.engine ?? createEngine(home, VERSION);
  const store = openStore(home.dir);
  const log = options.log ?? (() => {});
  const node = new AgentNode({ home, store, computer, voice: configuredVoice(home), engine: makeEngine(), version: VERSION, log });
  const relay = new RelayClient(home, options.onRelayState);
  const apnsHosts = options.apnsHosts ?? APPLE;
  const core: Core = {
    home,
    store,
    node,
    computer,
    relay,
    apnsHosts,
    log,
    version: VERSION,
    port: 0,
    host: options.host ?? home.config.host,
    tls: loadTlsIdentity(home.dir, log),
    createEngine: makeEngine,
  };
  // What happens while starting is told after the line that says we started.
  let early: string[] | null = [];
  const describe = eventLines();
  node.subscribe((event) => {
    const line = describe(event);
    if (!line) return;
    if (early) early.push(line);
    else log(line);
  });

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(core, options.port ?? home.config.port);
  } catch (error) {
    node.close();
    await computer.close();
    home.forgetLocalToken();
    throw error;
  }
  core.port = node.port = server.port;
  const { engine, voice } = node.info().capabilities;
  log(`AgentOS ${VERSION} started on port ${server.port} (engine ${engine}, voice ${voice.provider}, computer ${computer.available ? "available" : "not available"})`);
  early.forEach(log);
  early = null;

  return {
    url: localUrl(server.port),
    port: server.port,
    localToken,
    fingerprint: core.tls.fingerprint,
    close: async () => {
      await server.close();
      node.close();
      await computer.close();
      home.forgetLocalToken();
    },
  };
}
