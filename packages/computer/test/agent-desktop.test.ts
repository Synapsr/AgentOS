import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { agentDesktopBackend, createRunner, findBinary, parseEnvelope, type Run, type Runner } from "../src/agent-desktop.js";
import { BackendError, type UiNode } from "../src/backend.js";
import type { KeyboardLayout } from "../src/keyboard.js";
import { data, failure, raw } from "./fixtures.js";

const french: KeyboardLayout = JSON.parse(raw("layout-french"));

/** A backend whose commands are answered from fixtures, recording what was run. */
function fake(answers: Record<string, unknown> = {}, platform = "linux") {
  const calls: { args: string[]; stdin?: string }[] = [];
  const run: Run = async (args, opts) => {
    calls.push({ args, stdin: opts?.stdin });
    const answer = answers[args[0] ?? ""];
    if (answer instanceof Error) throw answer;
    return answer ?? {};
  };
  return { calls, backend: agentDesktopBackend(run, platform, async () => french) };
}

describe("parseEnvelope", () => {
  it("returns the data of a successful command", () => {
    expect(parseEnvelope(raw("permissions"))).toEqual({
      accessibility: { state: "granted" },
      automation: { state: "unknown" },
      screen_recording: { state: "granted" },
    });
    expect(data("list-windows")).toHaveLength(1);
  });

  it("throws the error of a failed command, with its code and details", () => {
    const stale = failure("error-stale-ref");
    expect(stale).toBeInstanceOf(BackendError);
    expect(stale.code).toBe("STALE_REF");
    expect(stale.details).toEqual({ process_state: "exited" });
    expect(stale.message).toMatch(/no longer running/);
  });

  it("reads retry safety from the disposition, not from the code", () => {
    expect(failure("error-app-not-found").retrySafe).toBe(true);
    // The backend cannot tell whether this scroll happened.
    expect(failure("error-unresponsive").retrySafe).toBe(false);
    // Two timeouts of the same kind: one says nothing was sent, the other says it does not know.
    expect(failure("error-inventory-timeout").retrySafe).toBe(true);
    expect(failure("error-screenshot-timeout").retrySafe).toBe(false);
  });

  it("handles argument errors, which exit with code 2 but still print an envelope", () => {
    expect(failure("error-bad-flag").code).toBe("INVALID_ARGS");
  });

  it("reports output that is not an envelope", () => {
    expect(() => parseEnvelope("")).toThrowError(/empty output/);
    expect(() => parseEnvelope("Segmentation fault")).toThrowError(/Segmentation fault/);
    expect(() => parseEnvelope('{"ok":false}')).toThrowError(BackendError);
  });
});

describe("findBinary", () => {
  it("finds the bundled executable for this machine", () => {
    const binary = findBinary(process.platform, process.arch, undefined);
    expect(binary?.bin).toMatch(new RegExp(`agent-desktop-${process.platform}-${process.arch}`));
    expect(Boolean(binary?.macHelper)).toBe(process.platform === "darwin");
  });

  it("returns undefined on a platform without one", () => {
    expect(findBinary("sunos", "mips", undefined)).toBeUndefined();
  });

  describe("with AGENTOS_AGENT_DESKTOP_BIN", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentos-computer-bin-"));
    const touch = (name: string, mode = 0o755) => {
      writeFileSync(join(dir, name), "", { mode });
      return join(dir, name);
    };
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("prefers the helper under its exact name, the one that can run where it is", () => {
      const folder = mkdtempSync(join(dir, "both-"));
      writeFileSync(join(folder, "agent-desktop"), "", { mode: 0o755 });
      writeFileSync(join(folder, "agent-desktop-macos-helper-darwin-arm64"), "", { mode: 0o755 });
      writeFileSync(join(folder, "agent-desktop-macos-helper"), "", { mode: 0o755 });
      expect(findBinary("darwin", "arm64", folder)?.macHelper).toBe(join(folder, "agent-desktop-macos-helper"));
    });

    it("uses the executable and helper of a folder laid out like the npm package", () => {
      const bin = touch("agent-desktop-darwin-arm64");
      const macHelper = touch("agent-desktop-macos-helper-darwin-arm64");
      expect(findBinary("darwin", "arm64", dir)).toEqual({ bin, macHelper });
    });

    it("accepts the plain names of a release archive, and a direct path to the executable", () => {
      const bin = touch("agent-desktop");
      const macHelper = touch("agent-desktop-macos-helper");
      expect(findBinary("darwin", "x64", dir)).toEqual({ bin, macHelper });
      const sidecar = touch("agent-desktop-aarch64-apple-darwin");
      expect(findBinary("darwin", "x64", sidecar)).toEqual({ bin: sidecar, macHelper });
      expect(findBinary("linux", "x64", sidecar)).toEqual({ bin: sidecar, macHelper: undefined });
    });

    it("finds the Windows executable", () => {
      const bin = touch("agent-desktop-win32-x64.exe");
      expect(findBinary("win32", "x64", dir)).toEqual({ bin, macHelper: undefined });
    });

    it("never falls back to the npm package when the variable points at nothing usable", () => {
      expect(findBinary(process.platform, process.arch, join(dir, "missing"))).toBeUndefined();
      expect(findBinary("linux", "riscv64", mkdtempSync(join(dir, "empty-")))).toBeUndefined();
      expect(findBinary("linux", "x64", touch("not-executable", 0o644))).toBeUndefined();
    });
  });
});

describe("agent-desktop backend", () => {
  it("maps permission states, counting 'not_required' as granted", async () => {
    expect(await fake({ permissions: data("permissions") }).backend.permissions()).toEqual({ accessibility: true, screenRecording: true });
    const denied = { accessibility: { state: "denied" }, screen_recording: { state: "not_required" } };
    expect(await fake({ permissions: denied }).backend.permissions()).toEqual({ accessibility: false, screenRecording: true });
  });

  it("opens the macOS guide to request permissions, and the OS prompt elsewhere", async () => {
    const mac = fake({}, "darwin");
    await mac.backend.requestPermissions();
    expect(mac.calls.map((call) => call.args)).toEqual([["permissions", "--guide"]]);

    const other = fake();
    await other.backend.requestPermissions();
    expect(other.calls.map((call) => call.args)).toEqual([["permissions", "--request"]]);
  });

  it("lists running programs with their identifier, telling open apps from helpers", async () => {
    const apps = { apps: [...data("list-apps").apps, { name: "helper", pid: 2 }, { name: "Menu Extra", pid: 3, presentation: "background" }] };
    expect(await fake({ "list-apps": apps }).backend.listApps()).toEqual([
      { name: "Calculatrice", pid: 32910, id: "com.apple.calculator", foreground: true },
      { name: "helper", pid: 2, id: undefined, foreground: false },
      { name: "Menu Extra", pid: 3, id: undefined, foreground: false },
    ]);
  });

  it("lists the windows of one app", async () => {
    const { backend, calls } = fake({ "list-windows": data("list-windows") });
    expect(await backend.listWindows("Calculatrice")).toEqual([
      { id: "w-256060", title: "Calculatrice", app: "Calculatrice", pid: 32910, focused: true, minimized: false },
    ]);
    expect(calls[0]?.args).toEqual(["list-windows", "--app", "Calculatrice"]);
  });

  it("opens an app in front and reports the name the system uses", async () => {
    const { backend, calls } = fake({ "list-apps": data("list-apps-empty"), launch: data("launch") });
    const opened = await backend.openApp("Calculator");
    expect(opened).toMatchObject({ app: "Calculatrice", pid: 32910, started: true, window: { id: "w-256060" } });
    expect(calls.map((call) => call.args)).toEqual([["list-apps"], ["launch", "Calculator", "--activate"]]);
  });

  it("tells an app it started from one that was already running, by process", async () => {
    // Opened under its English name, so only the process id shows that it was there before.
    const { backend } = fake({ "list-apps": data("list-apps"), launch: data("launch") });
    expect(await backend.openApp("Calculator")).toMatchObject({ app: "Calculatrice", pid: 32910, started: false });
  });

  it("raises a running app through its bundle id, since its translated name cannot launch it", async () => {
    const { backend, calls } = fake({ "list-apps": data("list-apps"), launch: data("launch") });
    await backend.openApp("calculatrice");
    expect(calls[1]?.args).toEqual(["launch", "com.apple.calculator", "--activate"]);
  });

  it("remembers what launched an app, to open it again under its translated name", async () => {
    const { backend, calls } = fake({ "list-apps": data("list-apps-empty"), launch: data("launch") });
    await backend.openApp("Calculator");
    await backend.openApp("Calculatrice");
    expect(calls[3]?.args).toEqual(["launch", "Calculator", "--activate"]);
    // Without that memory the system's answer comes back as it is.
    const fresh = fake({ "list-apps": data("list-apps-empty"), launch: failure("error-launch-not-found") });
    await expect(fresh.backend.openApp("Calculatrice")).rejects.toMatchObject({ code: "APP_NOT_FOUND" });
  });

  it("brings a running program that is not an installed app to the front", async () => {
    const tool = { apps: [{ name: "Calculatrice", pid: 7, presentation: "foreground" }] };
    const { backend, calls } = fake({ "list-apps": tool, launch: failure("error-launch-not-found"), "focus-window": data("focus-window") });
    const opened = await backend.openApp("Calculatrice");
    expect(opened).toMatchObject({ app: "Calculatrice", pid: 7, started: false, window: { title: "Calculatrice", focused: true } });
    expect(calls.map((call) => call.args[0])).toEqual(["list-apps", "launch", "focus-window"]);
  });

  it("quits an app, and fails when it was not running", async () => {
    const { backend, calls } = fake({ "close-app": data("close-app") });
    await expect(backend.closeApp("Calculatrice")).resolves.toBeUndefined();
    expect(calls[0]?.args).toEqual(["close-app", "Calculatrice"]);
    await expect(fake({ "close-app": failure("error-app-not-found") }).backend.closeApp("Calculatrice")).rejects.toMatchObject({ code: "APP_NOT_FOUND" });
  });

  it("turns a snapshot into a neutral tree", async () => {
    const { backend, calls } = fake({ snapshot: data("snapshot") });
    const snapshot = await backend.snapshot({ app: "Calculatrice", interactiveOnly: true });
    expect(calls[0]?.args).toEqual(["snapshot", "--compact", "--app", "Calculatrice", "--interactive-only"]);
    expect(snapshot.app).toBe("Calculatrice");
    expect(snapshot.window).toEqual({ id: "w-256257", title: "Calculatrice" });
    expect(snapshot.complete).toBe(true);
    const flat = JSON.stringify(snapshot.tree);
    expect(flat).toContain('{"role":"button","name":"7","ref":"@s1q45leq1aoz2r:e6"}');
    expect(flat).toContain('"states":["disabled"]');
    expect(flat).not.toContain("available_actions");
  });

  it("reads a single-line field and a multi-line text view alike, as text fields", async () => {
    // The window of test/typing-app, as captured. The tools rely on this role to focus rather than press.
    const snapshot = await fake({ snapshot: data("snapshot-fields") }).backend.snapshot({ app: "AgentOSTypingTest" });
    const fields: UiNode[] = [];
    const visit = (node: UiNode): void => {
      if (node.role === "textfield") fields.push(node);
      node.children?.forEach(visit);
    };
    visit(snapshot.tree);
    expect(fields.map(({ name, states }) => ({ name, states }))).toEqual([
      { name: "Single line", states: ["focused"] },
      { name: "Multi line", states: undefined },
    ]);
  });

  it("marks the menu commands that quit, log out or stop the computer, in any language", async () => {
    const snapshot = await fake({ snapshot: data("snapshot-menubar") }).backend.snapshot({ app: "AgentOSTypingTest", surface: "menubar" });
    const critical: string[] = [];
    const visit = (node: UiNode): void => {
      if (node.critical) critical.push(`${node.critical}: ${node.name}`);
      node.children?.forEach(visit);
    };
    visit(snapshot.tree);
    // Captured on a French system: the labels are translated, the identifiers behind them are not.
    expect(critical).toEqual([
      "severe: Forcer à quitter AgentOSTypingTest",
      "severe: Suspendre l’activité",
      "severe: Redémarrer…",
      "severe: Redémarrer",
      "severe: Éteindre…",
      "severe: Éteindre",
      "severe: Verrouiller l’écran",
      "severe: Fermer la session",
      "severe: Fermer la session",
      "quit: Quit Typing Test",
    ]);
  });

  it("drills into a ref without naming the app again", async () => {
    const { backend, calls } = fake({ snapshot: data("snapshot-root") });
    const snapshot = await backend.snapshot({ app: "ignored", surface: "menu", root: "@s1q45leq1aoz2r:e1" });
    expect(calls[0]?.args).toEqual(["snapshot", "--compact", "--root", "@s1q45leq1aoz2r:e1"]);
    expect(snapshot.tree.role).toBe("scrollarea");
  });

  it("waits for text to appear or to go, through the snapshot command", async () => {
    const { backend, calls } = fake({ snapshot: data("wait-gone") });
    await backend.waitForText({ app: "Calculatrice", text: "42", timeoutMs: 5000 });
    await backend.waitForText({ text: "Loading", gone: true, timeoutMs: 1000 });
    expect(calls.map((call) => call.args)).toEqual([
      ["snapshot", "--compact", "--wait-for", ":42", "--wait-timeout", "5000", "--app", "Calculatrice"],
      ["snapshot", "--compact", "--wait-for-gone", ":Loading", "--wait-timeout", "1000"],
    ]);
    await expect(fake({ snapshot: failure("error-wait-timeout") }).backend.waitForText({ text: "x", timeoutMs: 600 })).rejects.toMatchObject({
      code: "TIMEOUT",
      details: { kind: "wait_timeout" },
    });
  });

  it("clicks, and reports the layers an action opened", async () => {
    const { backend, calls } = fake({ click: data("click"), "right-click": data("right-click") });
    expect(await backend.click("@s1:e6", "left")).toEqual({ surfaces: [] });
    // The real result names a "context_menu", which is read as surface "menu".
    expect(await backend.click("@s1:e6", "right")).toEqual({ surfaces: ["menu"] });
    const sheet = fake({ click: { surfaces: [{ id: "w-1", type: "window" }, { id: "s-1", type: "sheet" }] } });
    expect(await sheet.backend.click("@s1:e6", "left")).toEqual({ surfaces: ["sheet"] });
    expect(calls.map((call) => call.args)).toEqual([
      ["click", "@s1:e6"],
      ["right-click", "@s1:e6"],
    ]);
  });

  it("sends text on stdin, never as an argument", async () => {
    const { backend, calls } = fake({ type: data("type"), "set-value": data("set-value") });
    await backend.setText("@s1:e2", "--secret", false);
    await backend.setText("@s1:e2", "whole value", true);
    await backend.writeClipboard("copied");
    expect(calls).toEqual([
      { args: ["type", "@s1:e2", "--stdin"], stdin: "--secret" },
      { args: ["set-value", "@s1:e2", "--stdin"], stdin: "whole value" },
      { args: ["clipboard-set", "--stdin"], stdin: "copied" },
    ]);
  });

  it("adds text at the end of a field that has no cursor to insert at", async () => {
    // What a single-line field without the keyboard focus really answers to an insert.
    const { backend, calls } = fake({ type: failure("error-type-needs-focus"), get: { property: "value", ref: "@s1:e2", value: "Bonjour" } });
    await backend.setText("@s1:e2", " le monde", false);
    expect(calls).toEqual([
      { args: ["type", "@s1:e2", "--stdin"], stdin: " le monde" },
      { args: ["get", "@s1:e2", "--property", "value"], stdin: undefined },
      { args: ["set-value", "@s1:e2", "--stdin"], stdin: "Bonjour le monde" },
    ]);

    const empty = fake({ type: failure("error-type-needs-focus"), get: { property: "value", ref: "@s1:e2", value: null } });
    await empty.backend.setText("@s1:e2", "first", false);
    expect(empty.calls.at(-1)).toEqual({ args: ["set-value", "@s1:e2", "--stdin"], stdin: "first" });

    // Any other failure is not papered over.
    await expect(fake({ type: failure("error-not-editable") }).backend.setText("@s1:e2", "x", false)).rejects.toMatchObject({ code: "ACTION_NOT_SUPPORTED" });
  });

  it("gives an element the keyboard focus", async () => {
    const { backend, calls } = fake({ focus: data("focus") });
    expect(await backend.focus("@s1:e2")).toEqual({ surfaces: [] });
    expect(calls[0]?.args).toEqual(["focus", "@s1:e2"]);
  });

  it("passes key combos through untouched off macOS, except the ones that quit", async () => {
    const { backend, calls } = fake({ press: data("press") });
    await backend.press("ctrl+a", "Editor");
    await expect(backend.press("ctrl+q", "Editor")).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(backend.press("alt+f4")).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(calls.map((call) => call.args)).toEqual([["press", "ctrl+a", "--app", "Editor"]]);
  });

  it("rewrites letters for the active macOS keyboard layout", async () => {
    const { backend, calls } = fake({ "list-windows": data("list-windows") }, "darwin");
    await backend.press("cmd+a", "Calculatrice");
    await backend.press("cmd+s");
    await backend.press("return");
    expect(calls.map((call) => call.args)).toEqual([
      ["list-windows", "--app", "Calculatrice"],
      // On a French keyboard the A key is where agent-desktop expects Q, and it refuses "cmd+q" unless forced.
      ["press", "cmd+q", "--force", "--app", "Calculatrice"],
      ["press", "cmd+s"],
      ["press", "return"],
    ]);
  });

  it("does not send a Cmd shortcut to a Mac app in the background, where it would be ignored", async () => {
    const behind = data("list-windows").map((window: object) => ({ ...window, is_focused: false }));
    const { backend, calls } = fake({ "list-windows": behind }, "darwin");
    await expect(backend.press("cmd+s", "Calculatrice")).rejects.toMatchObject({ code: "ACTION_FAILED", retrySafe: true, details: { kind: "app_not_in_front" } });
    // Plain keys do arrive there: observed with return, delete and letters.
    await backend.press("return", "Calculatrice");
    expect(calls.map((call) => call.args)).toEqual([
      ["list-windows", "--app", "Calculatrice"],
      ["press", "return", "--app", "Calculatrice"],
    ]);
  });

  it("refuses quit shortcuts and keys it cannot send faithfully, before running anything", async () => {
    const { backend, calls } = fake({}, "darwin");
    await expect(backend.press("cmd+q", "TextEdit")).rejects.toMatchObject({ code: "POLICY_DENIED", retrySafe: true });
    await expect(backend.press("cmd+m")).rejects.toMatchObject({ code: "ACTION_FAILED", details: { kind: "keyboard_layout" } });
    expect(calls).toEqual([]);
  });

  it("refuses letters when the keyboard layout cannot be read", async () => {
    const calls: string[][] = [];
    const backend = agentDesktopBackend(async (args) => void calls.push(args), "darwin", async () => {
      throw new Error("osascript failed");
    });
    await expect(backend.press("cmd+c")).rejects.toMatchObject({ details: { kind: "keyboard_layout" } });
    await backend.press("escape");
    expect(calls).toEqual([["press", "escape"]]);
  });

  it("scrolls by ref", async () => {
    const { backend, calls } = fake();
    await backend.scroll("@s1:e1", "down", 3);
    expect(calls[0]?.args).toEqual(["scroll", "@s1:e1", "--direction", "down", "--amount", "3"]);
  });

  it("captures the main display by default", async () => {
    const { backend, calls } = fake({ screenshot: data("screenshot") });
    expect(await backend.capture({}, "/tmp/shot.png")).toEqual({ width: 684, height: 1040 });
    expect(calls[0]?.args).toEqual(["screenshot", "--screen", "0", "/tmp/shot.png"]);
  });

  it("captures one window by naming both the app and the window", async () => {
    const { backend, calls } = fake({ "list-windows": data("list-windows"), screenshot: data("screenshot") });
    await backend.capture({ app: "Calculatrice" }, "/tmp/shot.png");
    expect(calls[1]?.args).toEqual(["screenshot", "--app", "Calculatrice", "--window-id", "w-256060", "/tmp/shot.png"]);
    await expect(backend.capture({ app: "Calculatrice", windowId: "w-1" }, "/tmp/shot.png")).rejects.toMatchObject({ code: "WINDOW_NOT_FOUND" });
  });

  it("reads clipboard text, or nothing when the clipboard holds none", async () => {
    expect(await fake({ "clipboard-get": data("clipboard-empty") }).backend.readClipboard()).toBeUndefined();
    expect(await fake({ "clipboard-get": { type: "text", text: "hello" } }).backend.readClipboard()).toBe("hello");
  });

  it("lets backend errors through unchanged", async () => {
    await expect(fake({ click: failure("error-stale-ref") }).backend.click("@s1:e1", "left")).rejects.toMatchObject({ code: "STALE_REF" });
  });
});

// The runner starts a real process: a script that stands in for agent-desktop and reports
// which helper it was pointed at, so that the helper's handling can be watched from outside.
describe.runIf(process.platform !== "win32")("createRunner", () => {
  const root = mkdtempSync(join(tmpdir(), "agentos-computer-runner-"));
  const runners: Runner[] = [];
  afterAll(() => {
    for (const runner of runners) runner.close();
    rmSync(root, { recursive: true, force: true });
  });
  const runner = (name: string, macHelper: string, state = join(root, `state-${name}`)) => {
    const bin = join(root, name);
    writeFileSync(bin, '#!/bin/sh\nprintf \'{"ok":true,"data":{"helper":"%s","home":"%s"}}\' "$AGENT_DESKTOP_MACOS_HELPER_PATH" "$AGENT_DESKTOP_HOME"\n', { mode: 0o755 });
    const made = createRunner({ bin, macHelper }, state);
    runners.push(made);
    return { ...made, state };
  };
  const helperFile = (folder: string, name: string, content: string) => {
    const dir = mkdtempSync(join(root, folder));
    writeFileSync(join(dir, name), content, { mode: 0o755 });
    return join(dir, name);
  };
  const mode = (path: string) => statSync(path).mode & 0o777;

  it("runs a helper that already has the exact name where it is, and copies nothing", async () => {
    const shipped = helperFile("app-", "agent-desktop-macos-helper", "helper v1");
    const { run, state } = runner("in-place", shipped);
    expect(await run(["version"])).toEqual({ helper: shipped, home: state });
    // The state folder is private, and stays free of anything that would get in the way of deleting it.
    expect(mode(state)).toBe(0o700);
    expect(readdirSync(state)).toEqual([]);
  });

  it("copies a helper shipped under another name into a read-only folder of its own", async () => {
    const packaged = helperFile("npm-", "agent-desktop-macos-helper-darwin-arm64", "helper v1");
    const { run, close, state } = runner("copy", packaged);
    const copy: string = (await run(["version"])).helper;
    expect(basename(copy)).toBe("agent-desktop-macos-helper");
    expect(copy.startsWith(state)).toBe(false);
    expect(readFileSync(copy, "utf8")).toBe("helper v1");
    expect([mode(copy), mode(dirname(copy))]).toEqual([0o500, 0o500]);

    // Someone replaces the copy between two commands: it is put back before the next one runs.
    chmodSync(dirname(copy), 0o700);
    rmSync(copy);
    writeFileSync(copy, "something else", { mode: 0o755 });
    expect((await run(["version"])).helper).toBe(copy);
    expect(readFileSync(copy, "utf8")).toBe("helper v1");
    expect([mode(copy), mode(dirname(copy))]).toEqual([0o500, 0o500]);

    // Rewriting the packaged original afterwards does not get a different helper in either:
    // the reference was read once, when the runner first needed it.
    writeFileSync(packaged, "tampered original");
    await run(["version"]);
    expect(readFileSync(copy, "utf8")).toBe("helper v1");

    // Closing removes the copy and its folder.
    close();
    expect(() => statSync(dirname(copy))).toThrow();
  });

  it("copies a helper it could not run in place, such as one writable by others", async () => {
    const loose = helperFile("app-", "agent-desktop-macos-helper", "helper v1");
    chmodSync(loose, 0o777);
    const copy: string = (await runner("loose", loose).run(["version"])).helper;
    expect(copy).not.toBe(loose);
    expect(mode(copy)).toBe(0o500);
  });
});
