import { readFileSync } from "node:fs";

/** The AgentOS version, as written in this package's package.json. */
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
