/**
 * AgentOS's own interface is off limits to the agent.
 *
 * The owner approves requests and sets the agent's autonomy in the AgentOS app. An agent
 * able to read and click that app could approve itself, so the tools refuse to touch it.
 * It is recognised by identifier, by name, and by ancestry: whatever app launched this
 * process is our shell, whatever it is called.
 *
 * What this does not cover, and cannot from here:
 * - the same interface open in a web browser: a tab cannot be told from any other;
 * - a picture of the whole display, which shows whatever is visible on it;
 * - anything the agent does outside these tools, such as driving the screen from a shell.
 */
import { execFileSync } from "node:child_process";
import type { AppInfo, Backend } from "./backend.js";

/** The AgentOS desktop app: its bundle identifier, and the names its executable goes by. */
export const OWN_APPS = ["org.agentos.desktop", "AgentOS", "agentos-desktop"];

/** Environment variable for more of them: bundle identifiers or app names, separated by commas. */
export const OWN_APPS_VARIABLE = "AGENTOS_PROTECTED_APPS";

/** What the model is told when it reaches for one. */
export const OWN_APP_MESSAGE = "That is my own control panel; only my owner uses it.";

/** How long the list of running apps is trusted. The shell does not change from one call to the next. */
const FRESH_MS = 5000;

/** Apps are told apart by name or identifier, whatever the capitals. */
export const key = (name: string) => name.trim().toLowerCase();

/** The process ids above `pid`, nearest first: its parent, the parent's parent, and so on. */
export function ancestors(pid: number = process.pid): number[] {
  const chain: number[] = [];
  try {
    for (let current = pid; chain.length < 64; ) {
      const parent = Number(execFileSync("ps", ["-o", "ppid=", "-p", String(current)], { encoding: "utf8", timeout: 2000 }).trim());
      if (!Number.isInteger(parent) || parent <= 1) break;
      chain.push(parent);
      current = parent;
    }
  } catch {
    // No `ps` (Windows) or a process that just went away: keep what was found.
    if (chain.length === 0 && pid === process.pid && process.ppid > 1) chain.push(process.ppid);
  }
  return chain;
}

export interface Guard {
  /** True when this running app is AgentOS's own. */
  owns(app: AppInfo): boolean;
  /** True when `app`, as a tool would address it, is AgentOS's own app. */
  protects(app: string): Promise<boolean>;
  /** True when AgentOS's own app is in front, where keys sent to no app in particular would land. */
  inFront(): Promise<boolean>;
  /** Forgets what was learnt about running apps: call it when one has just been started. */
  refresh(): void;
}

export interface GuardOptions {
  /** More bundle identifiers or names to protect, on top of `OWN_APPS` and the environment variable. */
  apps?: string[];
  /** Process ids of the apps above this process. Worked out from the process table by default. */
  ancestors?: number[];
}

/** Builds the guard for this process. */
export function createGuard(backend: Backend, options: GuardOptions = {}): Guard {
  const fromEnvironment = (process.env[OWN_APPS_VARIABLE] ?? "").split(",").filter((entry) => entry.trim());
  const identifiers = new Set([...OWN_APPS, ...fromEnvironment, ...(options.apps ?? [])].map(key));
  const above = new Set(options.ancestors ?? ancestors());

  const owns = (app: AppInfo) => above.has(app.pid) || identifiers.has(key(app.name)) || (app.id !== undefined && identifiers.has(key(app.id)));

  let listed: { at: number; own: AppInfo[] } | undefined;
  /** AgentOS's own apps among those running now. */
  const running = async (): Promise<AppInfo[]> => {
    if (!listed || Date.now() - listed.at > FRESH_MS) listed = { at: Date.now(), own: (await backend.listApps()).filter(owns) };
    return listed.own;
  };

  const answers = new Map<string, { at: number; answer: boolean }>();
  const resolve = async (app: string): Promise<boolean> => {
    if (identifiers.has(key(app))) return true;
    const own = await running();
    if (own.some((entry) => key(entry.name) === key(app) || (entry.id !== undefined && key(entry.id) === key(app)))) return true;
    if (own.length === 0) return false;
    // The backend also accepts other spellings of an app (its executable's name, say).
    // Whatever the spelling, the windows it leads to belong to a process we can check.
    const windows = await backend.listWindows(app).catch(() => []);
    return windows.some((window) => own.some((entry) => entry.pid === window.pid));
  };

  return {
    owns,
    async protects(app) {
      const known = answers.get(key(app));
      if (known && Date.now() - known.at <= FRESH_MS) return known.answer;
      const answer = await resolve(app);
      answers.set(key(app), { at: Date.now(), answer });
      return answer;
    },
    refresh() {
      listed = undefined;
      answers.clear();
    },
    async inFront() {
      for (const app of await running()) {
        const windows = await backend.listWindows(app.name).catch(() => []);
        if (windows.some((window) => window.focused && window.pid === app.pid)) return true;
      }
      return false;
    },
  };
}
