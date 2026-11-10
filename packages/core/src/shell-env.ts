/**
 * The owner's shell environment, for a core that was not started from a shell.
 *
 * An app opened from the Finder, or a service started by the system, gets a
 * bare environment: a PATH of four system folders and none of what the
 * owner's shell profile sets up. The agent's commands would then not find
 * `git`, `node`, `python`… So, like desktop editors do, we ask the owner's
 * login shell once for its environment and complete ours with it.
 *
 * What is taken: every variable we do not already have, and the shell's
 * PATH. Nothing given to the core itself is replaced — in particular not an
 * `AGENTOS_*` or `ANTHROPIC_*` variable set for it. The environment is never
 * logged: profiles hold secrets.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { userInfo } from "node:os";
import { basename, delimiter } from "node:path";

/** Shells that take `-l -i -c <command>`. Others are left alone rather than guessed at. */
const KNOWN_SHELLS = new Set(["sh", "bash", "zsh", "fish", "ksh", "mksh", "dash"]);
/** A profile that takes longer than this is not waited for: the core starts with what it has. */
const TIMEOUT_MS = 4000;
/** No environment is this large; something else is talking. */
const MAX_OUTPUT_BYTES = 1024 * 1024;
/** Variables that describe the shell we ran to ask, not the owner's setup. */
const ABOUT_THE_ASKING = new Set(["_", "SHLVL", "PWD", "OLDPWD"]);

/** What became of asking the shell. Counts only: never the variables themselves. */
export type ShellOutcome =
  | { shell: string; ok: true; added: number; pathFolders: number }
  | { shell: string; ok: false; why: "no answer in time" | "no usable answer" };

/**
 * Whether this process looks like it was started by an app or a service
 * rather than from a shell: nobody is at a terminal on either end. Never on
 * Windows, where programs get the user's environment however they start.
 */
export function startedWithoutShell(): boolean {
  return process.platform !== "win32" && !process.stdin.isTTY && !process.stdout.isTTY;
}

/**
 * Completes `env` with the owner's shell environment. Returns what happened,
 * or null when there was nothing to ask (no shell we know how to ask).
 * Never throws, and never takes longer than the timeout.
 */
export async function adoptShellEnvironment(env: NodeJS.ProcessEnv = process.env, timeoutMs = TIMEOUT_MS): Promise<ShellOutcome | null> {
  const shell = env.SHELL || ownerShell();
  const name = basename(shell);
  if (!KNOWN_SHELLS.has(name)) return null;
  const answer = await askShell(shell, env, timeoutMs);
  if (typeof answer === "string") return { shell: name, ok: false, why: answer };

  let added = 0;
  for (const [variable, value] of Object.entries(answer)) {
    if (ABOUT_THE_ASKING.has(variable)) continue;
    if (variable === "PATH") env.PATH = mergePath(value, env.PATH ?? "");
    else if (env[variable] === undefined) {
      env[variable] = value;
      added++;
    }
  }
  return { shell: name, ok: true, added, pathFolders: (env.PATH ?? "").split(delimiter).filter(Boolean).length };
}

/**
 * The shell's folders first, as in the owner's terminal, then ours that it
 * does not have. Left as it is when everything the shell has is already there:
 * the core was given a PATH on purpose.
 */
function mergePath(fromShell: string, ours: string): string {
  const theirs = fromShell.split(delimiter).filter(Boolean);
  const mine = ours.split(delimiter).filter(Boolean);
  if (theirs.every((folder) => mine.includes(folder))) return ours;
  return [...theirs, ...mine.filter((folder) => !theirs.includes(folder))].join(delimiter);
}

/**
 * Runs the shell as a login, interactive shell — the way a terminal window
 * does, so that both kinds of profile are read — and has it print its
 * environment as JSON between two marks, to tell it from whatever else the
 * profile prints.
 */
function askShell(shell: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Record<string, string> | "no answer in time" | "no usable answer"> {
  const mark = `__agentos_${randomBytes(8).toString("hex")}__`;
  const print = `process.stdout.write(${JSON.stringify(mark)} + JSON.stringify(process.env) + ${JSON.stringify(mark)})`;
  const command = `${quote(process.execPath)} -e ${quote(print)}`;
  return new Promise((resolve) => {
    // Its own process group, with no way to read from us: a profile that asks a question gets no answer and is killed whole.
    const child = spawn(shell, ["-l", "-i", "-c", command], { env, stdio: ["ignore", "pipe", "ignore"], detached: true });
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = (): void => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      stop();
      resolve("no answer in time");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if ((size += chunk.length) > MAX_OUTPUT_BYTES) stop();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("no usable answer");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(between(Buffer.concat(chunks).toString(), mark) ?? "no usable answer");
    });
  });
}

/** The environment printed between the two marks, if that is what is there. */
function between(output: string, mark: string): Record<string, string> | null {
  const start = output.indexOf(mark);
  const end = output.indexOf(mark, start + mark.length);
  if (start === -1 || end === -1) return null;
  try {
    const parsed: unknown = JSON.parse(output.slice(start + mark.length, end));
    if (typeof parsed !== "object" || parsed === null) return null;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return null;
  }
}

/** The shell in the owner's account, when the environment does not say. */
function ownerShell(): string {
  try {
    return userInfo().shell ?? "";
  } catch {
    return "";
  }
}

/** One word for a shell, whatever is in it. Understood by sh, bash, zsh, ksh and fish alike. */
function quote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}
