/**
 * The core's journal: what happened, in one terse line each — never what was
 * said. No message text, no command, none of the owner's file names, no
 * token or key: states, errors and addresses only, so that the file can be
 * shown to whoever helps.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Event } from "@agentos/protocol";

/** Writes one line to the journal. */
export type Log = (line: string) => void;

/** The journal's size limit. One full predecessor is kept beside it (`core.log.1`). */
const MAX_BYTES = 1024 * 1024;

/** Where the journal of a data directory is. */
export function logPath(home: string): string {
  return join(home, "logs", "core.log");
}

/** A journal in a file: each line dated, readable by its owner only, never growing past `maxBytes`. */
export function fileLog(home: string, maxBytes = MAX_BYTES): Log {
  const path = logPath(home);
  mkdirSync(join(home, "logs"), { recursive: true, mode: 0o700 });
  return (line) => {
    try {
      if (existsSync(path) && statSync(path).size >= maxBytes) renameSync(path, `${path}.1`);
      appendFileSync(path, `${new Date().toISOString()} ${redact(line)}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    } catch {
      // A journal that cannot be written must not stop what it describes.
    }
  };
}

/**
 * A last safeguard: anything that looks like a secret — a long run of
 * token characters, an API key — is struck out, whatever line it is in.
 */
export function redact(line: string): string {
  return line.replace(/\bsk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,}/g, "[hidden]");
}

/**
 * Turns the node's events into journal lines. Remembers the last state, so
 * that only changes are written. Returns null for what is not worth a line.
 */
export function eventLines(): (event: Event) => string | null {
  let state = "";
  let mode = "";
  let engine = "";
  const jobs = new Set<string>();
  return (event) => {
    switch (event.type) {
      case "node.status": {
        const { status } = event;
        const lines: string[] = [];
        if (status.mode !== mode && mode) lines.push(`Mode: ${status.mode}`);
        if (status.state !== state) lines.push(status.state === "waiting" ? `Waiting for the owner (${status.pendingRequests})` : capitalize(status.state));
        [state, mode] = [status.state, status.mode];
        return lines.join("; ") || null;
      }
      case "node.updated": {
        const { engine: id, engineReady } = event.node.capabilities;
        const now = `Engine ${id}: ${engineReady ? "ready" : "not ready"}`;
        if (now === engine) return null;
        engine = now;
        return now;
      }
      case "thread.updated":
        if (event.thread.kind !== "job" || jobs.has(event.thread.id)) return null;
        jobs.add(event.thread.id);
        return `Job started (${event.thread.id})`;
      case "item.added":
        return event.item.type === "request" ? `Asked the owner: ${event.item.kind}, ${event.item.risk} risk (${event.item.id})` : null;
      case "item.updated": {
        const { item } = event;
        if (item.type !== "request") return null;
        // Which button, never which words.
        const choice = item.resolution?.optionId ? `: ${item.resolution.optionId}` : "";
        const by = item.state === "resolved" ? ` from ${item.resolution?.deviceId ?? "this computer"}` : "";
        return `Request ${item.state}${choice}${by} (${item.id})`;
      }
      case "turn.completed":
        return `Turn ended in ${event.threadId}: ${event.ok ? "ok" : "failed"}`;
      default:
        return null;
    }
  };
}

/**
 * One line for an error nobody expected: what kind, what it says, and where
 * in the program — no more of the stack than that. An error often names the
 * file it tripped on: anything that looks like a path is struck out.
 */
export function errorLine(error: unknown): string {
  if (!(error instanceof Error)) return withoutPaths(String(error)).slice(0, 200);
  // The first frame of the stack; a message of several lines pushes it further down.
  const frame = error.stack?.split("\n").find((line) => line.trimStart().startsWith("at ")) ?? "";
  const where = /\(?([^()\s]+:\d+:\d+)\)?$/.exec(frame)?.[1] ?? "";
  const said = withoutPaths(error.message.replace(/\s+/g, " ")).slice(0, 200);
  return `${error.name}: ${said}${where ? ` (${where.split("/").slice(-2).join("/")})` : ""}`;
}

/**
 * A text with every path in it replaced: whatever is quoted and holds a
 * slash (Node quotes the paths it names, spaces and all), then every word
 * that holds one, on any system.
 */
function withoutPaths(text: string): string {
  return text
    .replace(/(['"`])[^'"`]*[\\/][^'"`]*\1/g, "$1[path]$1")
    .replace(/[^\s'"`()<>,;[\]]*[\\/][^\s'"`()<>,;[\]]*/g, "[path]");
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
