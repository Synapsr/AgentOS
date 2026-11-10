/**
 * Everything AgentOS remembers, as plain files in the data directory.
 * See "Data on disk" in docs/ARCHITECTURE.md.
 */
import { join } from "node:path";
import { DeviceStore } from "./devices.js";
import { EventLog } from "./events.js";
import { FileStore } from "./files.js";
import { ThreadStore } from "./threads.js";

export type { EventInput } from "./events.js";

export interface Store {
  events: EventLog;
  threads: ThreadStore;
  files: FileStore;
  devices: DeviceStore;
}

/** Opens (or creates) the store in a data directory. */
export function openStore(dir: string): Store {
  return {
    events: new EventLog(join(dir, "events.jsonl")),
    threads: new ThreadStore(dir),
    files: new FileStore(join(dir, "files")),
    devices: new DeviceStore(join(dir, "devices.json")),
  };
}
