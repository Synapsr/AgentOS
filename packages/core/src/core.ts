import type { Computer } from "@agentos/computer";
import type { Home } from "./config.js";
import type { ApnsHosts } from "./push/apns.js";
import type { Engine } from "./engine/types.js";
import type { Log } from "./log.js";
import type { AgentNode } from "./node.js";
import type { RelayClient } from "./relay.js";
import type { Store } from "./store/index.js";
import type { TlsIdentity } from "./tls.js";

/** The parts of a running core, for whoever serves it. */
export interface Core {
  home: Home;
  store: Store;
  node: AgentNode;
  computer: Computer;
  /** The way out to the relay, when one is configured. */
  relay: RelayClient;
  /** Apple's push servers. */
  apnsHosts: ApnsHosts;
  /** Writes a line to the journal: what happened, never what was said. */
  log: Log;
  /** AgentOS version. */
  version: string;
  /** The port clients reach us on. */
  port: number;
  /** The address listened on; null for every interface. */
  host: string | null;
  /** The key and certificate connections from the network are encrypted with. */
  tls: TlsIdentity;
  /** Builds the engine the configuration asks for now. */
  createEngine(): Engine;
}
