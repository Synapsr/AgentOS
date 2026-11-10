/**
 * The few file operations the store is built on. Plain JSON and JSON Lines,
 * synchronous on purpose: every write is tiny and the caller can rely on it
 * being on disk before the next line runs. Everything written is the
 * owner's alone: files 600, folders 700.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Reads a JSON file, or returns null when it is missing or unreadable. */
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

const FILE = 0o600;
const FOLDER = 0o700;

/** Writes a JSON file atomically: a crash leaves the old file or the new one, never half of each. */
export function writeJson(path: string, value: unknown): void {
  replaceFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Loads a JSON Lines file. A line cut short by a crash is skipped, and the
 * file is sealed with a newline so the next append starts on a fresh line.
 */
export function loadLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  if (text && !text.endsWith("\n")) appendFileSync(path, "\n");
  const values: T[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      values.push(JSON.parse(line) as T);
    } catch {
      // Truncated mid-write: everything before it is still good.
    }
  }
  return values;
}

/** Appends one value to a JSON Lines file. */
export function appendLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: FOLDER });
  appendFileSync(path, `${JSON.stringify(value)}\n`, { mode: FILE });
}

/** Replaces a JSON Lines file atomically. */
export function writeLines(path: string, values: unknown[]): void {
  replaceFile(path, values.map((v) => `${JSON.stringify(v)}\n`).join(""));
}

function replaceFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: FOLDER });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: FILE });
  // The mode only applies when the file is created; a leftover tmp file keeps its old one.
  chmodSync(tmp, FILE);
  renameSync(tmp, path);
}
