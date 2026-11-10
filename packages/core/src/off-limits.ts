/**
 * What the agent must leave alone: AgentOS's own data folder, the address
 * its API answers on, and its own command. An agent that could read the
 * local token, or call the API as the owner does, could approve its own
 * requests and raise its own autonomy.
 *
 * This is a speed bump, not a wall. It recognises the plain ways of naming
 * those things. A command can still build a path from pieces, change folder
 * first, use a wildcard or pass through a program that hides what it opens.
 * What really keeps the agent out is elsewhere: no token is on disk when the
 * core runs inside the app, the engine's file tools are denied the folder,
 * and its shell commands are too once the sandbox is switched on.
 */
import { realpathSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolCall } from "./engine/types.js";
import { interfaceAddresses } from "./net.js";

export interface OffLimits {
  /** The data directory. */
  dir: string;
  /** The port the API answers on; null while it does not. */
  port: number | null;
}

/** Which of AgentOS's own things a tool call reaches for. */
export type OwnThing = "data" | "address" | "command";

/** Tools that write a file: where they write matters, what they write is only text. */
const EDITOR_PATHS: Record<string, string[]> = {
  Edit: ["file_path"],
  Write: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
};

/** The program behind the `agentos` command, as built and as written. */
const OUR_PROGRAMS = [fileURLToPath(new URL("./cli.js", import.meta.url)), fileURLToPath(new URL("./cli.ts", import.meta.url))];
/** The `agentos` command asked to do something, however it is launched (`npx agentos …`, `pnpm agentos …`). */
const OUR_COMMAND = /(^|[^\w.-])agentos(\.cmd)?\s+(start|pair|status|say|url)\b/;
/** The home folder, as a shell spells it. */
const HOME_VARIABLE = /\$\{HOME\}|\$HOME\b/g;
/** Where one word of a command ends and the next begins. */
const BETWEEN_WORDS = /[\s"'`;|&<>()=,{}]+/;

/**
 * What a tool call reaches for that is AgentOS's own, or null. `cwd` is the
 * folder the call would run in: paths that are not absolute start there.
 */
export function reachesFor(call: ToolCall, cwd: string, own: OffLimits): OwnThing | null {
  const editorPaths = EDITOR_PATHS[call.tool];
  const said = editorPaths ? editorPaths.flatMap((name) => strings(call.input[name])) : strings(call.input);
  const home = homedir();
  const words = said.flatMap((text) => text.replace(HOME_VARIABLE, home).split(BETWEEN_WORDS)).filter(Boolean);
  const places = words.flatMap((word) => placesNamed(word, cwd, home));

  const dir = real(own.dir);
  if (places.some((place) => isInside(place, dir))) return "data";
  if (own.port !== null && said.some((text) => namesAddress(text, own.port as number))) return "address";
  const programs = OUR_PROGRAMS.map(real);
  if (said.some((text) => OUR_COMMAND.test(text)) || places.some((place) => programs.some((program) => same(place, program)))) return "command";
  return null;
}

/** Every string in a value, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(strings);
}

/**
 * The places a word may name, links followed: read from the working folder,
 * and from the home folder too — a command often goes there first (`cd ~`).
 * A word that does not look like a path names none.
 */
function placesNamed(word: string, cwd: string, home: string): string[] {
  if (!/^[.~]|[\\/]/.test(word)) return [];
  const path = word.replace(/^~(?=$|[\\/])/, home);
  return [...new Set([resolve(cwd, path), resolve(home, path)])].map(real);
}

/** Where a path really leads: symbolic links followed for as much of it as exists. */
function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(real(parent), basename(path));
  }
}

/** Compared without regard to case: most disks this runs on make no difference, and refusing too much costs nothing here. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isInside(path: string, folder: string): boolean {
  return same(path, folder) || path.toLowerCase().startsWith(folder.toLowerCase() + sep);
}

/**
 * Whether a text names the core's own door: `:<port>` anywhere, or the port
 * as a word next to a name of this computer (`nc localhost 4747`).
 */
function namesAddress(text: string, port: number): boolean {
  if (new RegExp(`:${port}(?!\\d)`).test(text)) return true;
  if (!new RegExp(`(?<![\\w.:-])${port}(?![\\w.-])`).test(text)) return false;
  const lower = text.toLowerCase();
  return ["localhost", "127.", "::1", "0.0.0.0", hostname().toLowerCase(), ...interfaceAddresses()].some((name) => lower.includes(name));
}
