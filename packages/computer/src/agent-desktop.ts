/**
 * Backend on top of agent-desktop (https://github.com/vercel-labs/agent-desktop).
 *
 * agent-desktop is a native command-line tool: one process per command, one
 * JSON envelope on stdout. We run the binary bundled in its npm package
 * directly (no shell, no Node launcher) and translate envelopes into the
 * neutral types of `backend.ts`.
 *
 * Envelope payloads are untyped JSON (`any`); they are narrowed in this file
 * and nowhere else.
 */
import { execFile } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  type ActionResult,
  type AppInfo,
  type Backend,
  BackendError,
  type ErrorCode,
  SURFACES,
  type UiNode,
  type UiSnapshot,
  type WindowInfo,
} from "./backend.js";
import { dependsOnLayout, isQuitShortcut, type KeyboardLayout, localizeCombo, readLayout, usesCommand } from "./keyboard.js";

const MACOS_HELPER = "agent-desktop-macos-helper";

/** The native executables for this machine. */
export interface Binary {
  bin: string;
  /** macOS only: the helper behind the clipboard and the permission prompts. Without it those two do not work. */
  macHelper?: string;
}

/**
 * What macOS calls the menu commands that quit an app, end the session or stop the
 * computer. Menu items carry these identifiers in every language, unlike their labels.
 * Sleep and Lock Screen are included: they leave an owner who is away with a computer
 * the agent can no longer use.
 */
const CRITICAL_COMMANDS: Record<string, UiNode["critical"]> = {
  "terminate:": "quit", // Quit <app>
  "_forceQuitRequested:": "severe", // Force Quit <app>, without asking
  "_sleepRequested:": "severe",
  "_restartRequested:": "severe",
  "_restartNowRequested:": "severe",
  "_shutDownRequested:": "severe",
  "_shutDownNowRequested:": "severe",
  "_lockScreenRequested:": "severe",
  "_logOutRequested:": "severe",
  "_logOutNowRequested:": "severe",
};

/**
 * Finds the native executables, or returns undefined when there are none for this machine.
 *
 * By default they come from the installed `agent-desktop` npm package. A packaged app that
 * ships them beside the core sets `AGENTOS_AGENT_DESKTOP_BIN` instead, to either the
 * executable itself or the folder that holds it; the npm package is then not consulted.
 * In that folder the executable is `agent-desktop-<platform>-<arch>` or plain
 * `agent-desktop` (`.exe` on Windows). On macOS the helper sits next to it, preferably
 * as plain `agent-desktop-macos-helper`: under that exact name it is run where it is,
 * never copied. `agent-desktop-macos-helper-<platform>-<arch>` is accepted too.
 */
export function findBinary(
  platform: string = process.platform,
  arch: string = process.arch,
  override: string | undefined = process.env.AGENTOS_AGENT_DESKTOP_BIN,
): Binary | undefined {
  const exe = platform === "win32" ? ".exe" : "";
  const inDir = (dir: string, ...names: string[]) => names.map((name) => join(dir, name)).find((path) => existsSync(path));
  const specific = (base: string) => `${base}-${platform}-${arch}${exe}`;
  try {
    let dir: string;
    let bin: string | undefined;
    if (!override) {
      dir = join(dirname(createRequire(import.meta.url).resolve("agent-desktop/package.json")), "bin");
      // The plain name in the npm package is a Node launcher, not the executable.
      bin = join(dir, specific("agent-desktop"));
    } else if (statSync(override).isDirectory()) {
      dir = override;
      bin = inDir(dir, specific("agent-desktop"), `agent-desktop${exe}`);
    } else {
      dir = dirname(override);
      bin = override;
    }
    if (!bin) return undefined;
    accessSync(bin, constants.X_OK);
    // The helper under its exact name comes first: that one can be run where it is (see `createRunner`).
    return { bin, macHelper: platform === "darwin" ? inDir(dir, MACOS_HELPER, specific(MACOS_HELPER)) : undefined };
  } catch {
    return undefined;
  }
}

/** Runs one agent-desktop command and resolves to the `data` of its envelope. */
export type Run = (args: string[], opts?: { stdin?: string; signal?: AbortSignal; timeoutMs?: number }) => Promise<any>;

/** Extracts `data` from an envelope, or throws the error it carries. */
export function parseEnvelope(stdout: string): any {
  let envelope: any;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new BackendError("INTERNAL", `agent-desktop printed no result (${stdout.trim().slice(0, 200) || "empty output"})`);
  }
  if (envelope?.ok === true) return envelope.data;
  const error = envelope?.error ?? {};
  throw new BackendError(
    (error.code as ErrorCode | undefined) ?? "INTERNAL",
    error.message ?? "agent-desktop failed without a message",
    error.disposition?.retry === "safe",
    error.details ?? {},
  );
}

/** True when agent-desktop will run this helper where it is: exact name, our own regular file, not linked or writable by others. */
function usableInPlace(helper: string): boolean {
  try {
    const stat = lstatSync(helper);
    return basename(helper) === MACOS_HELPER && stat.isFile() && stat.uid === process.getuid?.() && stat.nlink === 1 && (stat.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/** Runs agent-desktop commands, and cleans up after itself. */
export interface Runner {
  run: Run;
  /** Removes the helper copy, if one was made. The runner can still be used afterwards. */
  close(): void;
}

/**
 * Returns a runner for the binary, with agent-desktop's state kept in `stateDir`, a folder
 * it wants private (mode 700).
 *
 * The macOS helper needs care, because it is an executable that agent-desktop launches.
 * agent-desktop only accepts a regular file named exactly `agent-desktop-macos-helper`
 * that we own. A packaged app ships it that way (see `findBinary`), and it is then run
 * where it is: nothing is copied. The npm package ships it under a platform suffix, to be
 * renamed by an install script that package managers no longer run, so there a copy is
 * unavoidable.
 *
 * Wherever such a copy goes, every process of this user can write there, the agent's own
 * shell included. So it gets a folder of its own (in the temporary directory, for this
 * process only, removed on close), the folder and the file are read-only, and the file is
 * compared with the packaged original before every command; a copy that differs is
 * replaced. This prevents accidents and any swap made between two commands. It does not
 * prevent a process of the same user from swapping the file in the instant between our
 * check and agent-desktop launching it, nor from rewriting the packaged original or this
 * very code: modes are advice between processes of one user. Closing that takes a signed
 * helper in a place the agent cannot write, which is what the packaged layout gives.
 */
export function createRunner(binary: Binary, stateDir: string): Runner {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_DESKTOP_HOME: stateDir };
  const copied = binary.macHelper !== undefined && !usableInPlace(binary.macHelper);
  if (binary.macHelper && !copied) env.AGENT_DESKTOP_MACOS_HELPER_PATH = binary.macHelper;
  // Read once and kept in memory, so that later comparisons do not depend on the disk.
  let original: Buffer | undefined;
  let copyDir: string | undefined;

  const close = () => {
    if (!copyDir) return;
    try {
      chmodSync(copyDir, 0o700);
    } catch {}
    rmSync(copyDir, { recursive: true, force: true });
    copyDir = undefined;
  };

  const prepare = () => {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      chmodSync(stateDir, 0o700);
    }
    if (!copied || !binary.macHelper) return;
    original ??= readFileSync(binary.macHelper);
    if (!copyDir) {
      copyDir = mkdtempSync(join(tmpdir(), "agentos-computer-helper-"));
      process.once("exit", close);
    }
    const helper = join(copyDir, MACOS_HELPER);
    env.AGENT_DESKTOP_MACOS_HELPER_PATH = helper;
    if (sameContent(helper, original)) return;
    mkdirSync(copyDir, { recursive: true, mode: 0o700 });
    chmodSync(copyDir, 0o700);
    writeFileSync(`${helper}.${process.pid}`, original, { mode: 0o500 });
    renameSync(`${helper}.${process.pid}`, helper);
    chmodSync(copyDir, 0o500);
  };

  const run: Run = (args, opts = {}) =>
    new Promise((resolve, reject) => {
      try {
        // Before every command: the folder may have been cleaned up, the helper copy tampered with.
        prepare();
      } catch (cause) {
        reject(new BackendError("INTERNAL", `Cannot prepare ${stateDir}: ${(cause as Error).message}`, true));
        return;
      }
      const child = execFile(
        binary.bin,
        args,
        { env, signal: opts.signal, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (failure, stdout) => {
          // A failed command still prints an envelope (exit 1 or 2). No output at all means it never ran or was stopped.
          if (failure && !stdout) {
            const stopped = failure.name === "AbortError" || failure.killed === true;
            reject(new BackendError(stopped ? "TIMEOUT" : "INTERNAL", stopped ? "Stopped before it finished." : failure.message));
            return;
          }
          try {
            resolve(parseEnvelope(stdout));
          } catch (error) {
            reject(error);
          }
        },
      );
      // Text travels on stdin so that it never shows up in the process list.
      if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
    });

  return { run, close };
}

function sameContent(path: string, content: Buffer): boolean {
  try {
    return readFileSync(path).equals(content);
  } catch {
    return false;
  }
}

const granted = (permission: any): boolean => permission?.state === "granted" || permission?.state === "not_required";

function toWindow(raw: any): WindowInfo {
  return { id: raw.id, title: raw.title ?? "", app: raw.app_name, pid: raw.pid, focused: raw.is_focused === true, minimized: raw.minimized === true };
}

function toNode(raw: any): UiNode {
  const node: UiNode = { role: raw.role ?? "unknown" };
  if (raw.name) node.name = raw.name;
  if (raw.value != null && raw.value !== "") node.value = String(raw.value);
  if (raw.ref_id) node.ref = raw.ref_id;
  if (raw.states?.length) node.states = raw.states;
  const critical = CRITICAL_COMMANDS[raw.native_id?.value];
  if (critical) node.critical = critical;
  if (raw.children?.length) node.children = raw.children.map(toNode);
  else if (raw.children_count) node.hidden = raw.children_count;
  return node;
}

function toSnapshot(data: any): UiSnapshot {
  return {
    app: data.app ?? "",
    window: data.window ? { id: data.window.id, title: data.window.title ?? "" } : undefined,
    tree: toNode(data.tree ?? {}),
    complete: data.complete !== false,
  };
}

function toAction(data: any): ActionResult {
  // `surfaces` is only present when something is open; a context menu is read like any menu.
  const open = (data?.surfaces ?? []).map((surface: any) => (surface?.type === "context_menu" ? "menu" : surface?.type));
  return { surfaces: SURFACES.filter((surface) => surface !== "menubar" && open.includes(surface)) };
}

/** The agent-desktop implementation of `Backend`. `platform` and `layout` can be replaced in tests. */
export function agentDesktopBackend(
  run: Run,
  platform: string = process.platform,
  layout: () => Promise<KeyboardLayout> = readLayout,
): Backend {
  // Always scoped to one app: the machine-wide window inventory times out on busy machines.
  const listWindows = async (app: string): Promise<WindowInfo[]> => ((await run(["list-windows", "--app", app])) ?? []).map(toWindow);

  // What launched each app, under the name the system then reported for it. On a system that
  // is not in English that name is translated ("Calculatrice"), and cannot launch the app again.
  const launchedWith = new Map<string, string>();

  return {
    listWindows,

    async permissions() {
      const data = await run(["permissions"]);
      return { accessibility: granted(data.accessibility), screenRecording: granted(data.screen_recording) };
    },

    async requestPermissions() {
      // The guide opens System Settings on the right pane and shows which app to allow.
      // Only macOS has it; elsewhere, and if it cannot start, fall back to the OS prompt.
      if (platform === "darwin") {
        try {
          await run(["permissions", "--guide"]);
          return;
        } catch {}
      }
      await run(["permissions", "--request"]);
    },

    async listApps() {
      const data = await run(["list-apps"]);
      return (data.apps ?? []).map((app: any): AppInfo => ({ name: app.name, pid: app.pid, id: app.bundle_id, foreground: app.presentation === "foreground" }));
    },

    async openApp(app, signal) {
      // Apps are launched by file name or bundle id, yet everything else knows them by display
      // name. So a running app is looked up first, and raised through its bundle id.
      // The full list also tells, by process, whether the app was running before this call.
      const wanted = app.toLowerCase();
      const before: any[] = (await run(["list-apps"])).apps ?? [];
      const running = before.find((entry) => String(entry.name).toLowerCase() === wanted);
      const launchable = running?.bundle_id ?? launchedWith.get(wanted) ?? app;
      try {
        const data = await run(["launch", launchable, "--activate"], { signal });
        launchedWith.set(String(data.app).toLowerCase(), launchable);
        const started = !before.some((entry) => entry.pid === data.pid);
        return { app: data.app, pid: data.pid, started, window: data.window ? toWindow(data.window) : undefined };
      } catch (error) {
        // A running program that is not an installed app cannot be launched, only brought to the front.
        if (!running || !(error instanceof BackendError) || error.code !== "APP_NOT_FOUND") throw error;
        const data = await run(["focus-window", "--app", running.name], { signal });
        return { app: running.name, pid: running.pid, started: false, window: data.focused ? toWindow(data.focused) : undefined };
      }
    },

    async closeApp(app) {
      await run(["close-app", app]);
    },

    async snapshot(query) {
      const args = ["snapshot", "--compact"];
      if (query.root) args.push("--root", query.root);
      else {
        if (query.app) args.push("--app", query.app);
        if (query.windowId) args.push("--window-id", query.windowId);
        if (query.surface) args.push("--surface", query.surface);
      }
      if (query.interactiveOnly) args.push("--interactive-only");
      return toSnapshot(await run(args, { signal: query.signal }));
    },

    async waitForText({ app, text, gone, timeoutMs, signal }) {
      // The snapshot command does the polling. What it returns differs between the two
      // directions (a tree, or just "gone"), so the caller takes its own snapshot afterwards.
      const args = ["snapshot", "--compact", gone ? "--wait-for-gone" : "--wait-for", `:${text}`, "--wait-timeout", String(timeoutMs)];
      if (app) args.push("--app", app);
      await run(args, { signal, timeoutMs: timeoutMs + 15_000 });
    },

    async click(ref, button) {
      return toAction(await run([button === "right" ? "right-click" : "click", ref]));
    },

    async focus(ref) {
      return toAction(await run(["focus", ref]));
    },

    async setText(ref, text, replace) {
      if (replace) return toAction(await run(["set-value", ref, "--stdin"], { stdin: text }));
      try {
        return toAction(await run(["type", ref, "--stdin"], { stdin: text }));
      } catch (error) {
        // A field without the keyboard focus often has no cursor to insert at, and agent-desktop
        // will not move the focus by itself. Adding at the end needs neither.
        if (!(error instanceof BackendError) || error.code !== "POLICY_DENIED") throw error;
        const current = (await run(["get", ref, "--property", "value"]))?.value;
        return toAction(await run(["set-value", ref, "--stdin"], { stdin: `${current ?? ""}${text}` }));
      }
    },

    async press(keys, app) {
      if (isQuitShortcut(keys, platform)) throw new BackendError("POLICY_DENIED", `Key combo '${keys}' is blocked for safety`, true);
      // Plain keys reach a background app; a Cmd shortcut sent to one vanishes without a trace.
      if (platform === "darwin" && app && usesCommand(keys) && !(await listWindows(app)).some((window) => window.focused)) {
        throw new BackendError("ACTION_FAILED", `'${app}' is not in front, so it would ignore '${keys}'`, true, { kind: "app_not_in_front" });
      }
      let combo: { keys: string; force: boolean } | undefined = { keys, force: false };
      if (platform === "darwin" && dependsOnLayout(keys)) {
        const active = await layout().catch(() => undefined);
        combo = active && localizeCombo(keys, active);
        // Sending a guess could turn a harmless shortcut into a destructive one.
        if (!combo) throw new BackendError("ACTION_FAILED", `'${keys}' cannot be sent on this keyboard layout`, true, { kind: "keyboard_layout" });
      }
      const args = ["press", combo.keys];
      if (combo.force) args.push("--force");
      if (app) args.push("--app", app);
      return toAction(await run(args));
    },

    async scroll(ref, direction, amount) {
      return toAction(await run(["scroll", ref, "--direction", direction, "--amount", String(amount)]));
    },

    async capture(target, file) {
      const args = ["screenshot"];
      if (target.app) {
        // Naming the app and the window keeps agent-desktop on the scoped, fast lookup.
        const windows = await listWindows(target.app);
        const window = target.windowId
          ? windows.find((candidate) => candidate.id === target.windowId)
          : (windows.find((candidate) => candidate.focused) ?? windows.find((candidate) => !candidate.minimized));
        if (!window) throw new BackendError("WINDOW_NOT_FOUND", `No window of '${target.app}' to capture`, true);
        args.push("--app", target.app, "--window-id", window.id);
      } else {
        args.push("--screen", "0");
      }
      const data = await run([...args, file]);
      return { width: data.width, height: data.height };
    },

    async readClipboard() {
      const data = await run(["clipboard-get"]);
      return typeof data?.text === "string" ? data.text : undefined;
    },

    async writeClipboard(text) {
      await run(["clipboard-set", "--stdin"], { stdin: text });
    },
  };
}
