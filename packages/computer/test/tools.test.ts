import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool, ToolContent, ToolContext } from "@agentos/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentDesktopBackend } from "../src/agent-desktop.js";
import { type Backend, BackendError, type UiNode, type UiSnapshot } from "../src/backend.js";
import { ComputerUnavailable, createComputer } from "../src/index.js";
import type { Guard } from "../src/guard.js";
import { computerTools } from "../src/tools.js";
import { data, failure } from "./fixtures.js";

const ctx: ToolContext = { signal: new AbortController().signal, threadId: "main" };

const notes: UiSnapshot = {
  app: "Notes",
  window: { id: "w-7", title: "Groceries" },
  tree: { role: "window", name: "Groceries", children: [{ role: "button", name: "New Note", ref: "@s1:e1" }] },
  complete: true,
};

/** A window with the kinds of element the tools treat differently. */
const form: UiSnapshot = {
  app: "Notes",
  tree: {
    role: "window",
    name: "Groceries",
    children: [
      { role: "button", name: "New Note", ref: "@s2:e1" },
      { role: "textfield", name: "Title", value: "Milk", ref: "@s2:e2" },
      { role: "scrollarea", ref: "@s2:e3" },
    ],
  },
  complete: true,
};

/** A 1×1 PNG, the smallest picture a capture can write. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** A guard for a computer on which AgentOS's own app is nowhere to be seen. */
const nobody: Guard = { owns: () => false, protects: async () => false, inFront: async () => false, refresh: () => {} };

/** A backend where everything succeeds, recording calls; `over` replaces single methods. */
function fake(over: Partial<Backend> = {}, guard: Guard = nobody) {
  const calls: unknown[][] = [];
  const record =
    <T>(name: string, result: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push([name, ...args]);
      return result;
    };
  const backend: Backend = {
    permissions: record("permissions", { accessibility: true, screenRecording: true }),
    requestPermissions: record("requestPermissions", undefined),
    listApps: record("listApps", [
      { name: "Notes", pid: 1, foreground: true },
      { name: "Finder", pid: 2, foreground: true },
      { name: "Notes", pid: 3, foreground: true },
      { name: "Notes Helper", pid: 4, foreground: false },
    ]),
    listWindows: async (app) => (app === "Notes" ? [{ id: "w-7", title: "Groceries", app, pid: 1, focused: true, minimized: false }] : []),
    openApp: record("openApp", { app: "Notes", pid: 1, started: false, window: { id: "w-7", title: "Groceries", app: "Notes", pid: 1, focused: true, minimized: false } }),
    closeApp: record("closeApp", undefined),
    snapshot: record("snapshot", notes),
    waitForText: record("waitForText", undefined),
    click: record("click", { surfaces: [] }),
    focus: record("focus", { surfaces: [] }),
    setText: record("setText", { surfaces: [] }),
    press: record("press", { surfaces: [] }),
    scroll: record("scroll", { surfaces: [] }),
    capture: async (target, file) => {
      calls.push(["capture", target]);
      writeFileSync(file, PIXEL);
      return { width: 1, height: 1 };
    },
    readClipboard: record("readClipboard", "copied text"),
    writeClipboard: record("writeClipboard", undefined),
    ...over,
  };
  const tools = computerTools(backend, guard);
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.run(z.object(tool.input).parse(input), ctx);
  };
  /** Takes the snapshot that makes the window's refs usable, and starts recording from there. */
  const look = async () => {
    await call("computer_snapshot", { app: "Notes" });
    calls.length = 0;
  };
  return { calls, tools, call, look };
}

const text = (content: ToolContent[]): string => content.map((part) => (part.type === "text" ? part.text : "")).join("");
const failing = (error: Error) => async (): Promise<never> => {
  throw error;
};

describe("tool definitions", () => {
  const tools: AgentTool[] = fake().tools;

  it("is a small set of uniquely named computer_ tools", () => {
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual([
      "computer_snapshot",
      "computer_click",
      "computer_type",
      "computer_press",
      "computer_scroll",
      "computer_open_app",
      "computer_close_app",
      "computer_list_apps",
      "computer_wait",
      "computer_screenshot",
      "computer_clipboard",
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^computer_[a-z]+(_[a-z]+)*$/);
  });

  it("marks as read-only exactly the tools that only observe", () => {
    const readOnly = tools.filter((tool) => tool.readOnly).map((tool) => tool.name);
    expect(readOnly).toEqual(["computer_snapshot", "computer_list_apps", "computer_wait", "computer_screenshot"]);
  });

  it("has valid input schemas with every parameter described", () => {
    for (const tool of tools) {
      const schema = z.toJSONSchema(z.object(tool.input)) as { type: string; properties?: Record<string, { description?: string }> };
      expect(schema.type).toBe("object");
      for (const [parameter, property] of Object.entries(schema.properties ?? {})) {
        // Enums speak for themselves.
        if (parameter === "direction") continue;
        expect(property.description, `${tool.name}.${parameter}`).toBeTruthy();
      }
    }
  });

  it("describes every tool, and teaches the snapshot-first loop", () => {
    for (const tool of tools) expect(tool.description.length, tool.name).toBeGreaterThan(60);
    const describe = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";
    expect(describe("computer_snapshot")).toMatch(/Start here.*new snapshot after/s);
    expect(describe("computer_screenshot")).toMatch(/Prefer computer_snapshot/);
    expect(describe("computer_click")).toMatch(/pointer does not move/);
  });

  it("rejects input that does not fit", () => {
    const scroll = tools.find((tool) => tool.name === "computer_scroll");
    expect(z.object(scroll?.input ?? {}).safeParse({ ref: "@s1:e1", direction: "sideways" }).success).toBe(false);
    expect(z.object(scroll?.input ?? {}).safeParse({ ref: "@s1:e1", direction: "down" }).success).toBe(true);
  });

  it("degrades to a computer without eyes or hands where there is no backend", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "sunos" });
    try {
      const computer = createComputer();
      expect(computer.available).toBe(false);
      expect(computer.tools()).toEqual([]);
      expect(await computer.permissions()).toEqual({ accessibility: false, screenRecording: false });
      await expect(computer.requestPermissions()).resolves.toBeUndefined();
      await expect(computer.screenshot()).rejects.toBeInstanceOf(ComputerUnavailable);
      await computer.close();
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  it("comes with a computer that always answers, with or without a backend", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "agentos-computer-test-"));
    try {
      const computer = createComputer({ stateDir });
      expect(computer.tools().length).toBe(computer.available ? 11 : 0);
      // Reading permissions never prompts and never throws.
      expect(Object.keys(await computer.permissions()).sort()).toEqual(["accessibility", "screenRecording"]);
      await computer.close();
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("tool behaviour", () => {
  it("returns the snapshot as text with refs", async () => {
    const { call, calls } = fake();
    const result = await call("computer_snapshot", { app: "Notes", interactive_only: true });
    expect(text(result.content)).toBe('Notes — window "Groceries" (w-7)\nwindow "Groceries"\n  button "New Note" @s1:e1');
    expect(calls[0]).toEqual(["snapshot", { app: "Notes", interactiveOnly: true, signal: ctx.signal }]);
  });

  it("confirms actions briefly", async () => {
    const { call, calls, look } = fake({ snapshot: async () => form });
    await look();
    expect(text((await call("computer_click", { ref: "@s2:e1" })).content)).toBe("Clicked.");
    expect(text((await call("computer_type", { ref: "@s2:e2", text: "milk" })).content)).toBe("Typed.");
    expect(text((await call("computer_type", { ref: "@s2:e2", text: "milk", replace: true })).content)).toBe("Text replaced.");
    expect(text((await call("computer_press", { keys: "cmd+s", app: "Notes" })).content)).toBe("Pressed cmd+s.");
    expect(text((await call("computer_scroll", { ref: "@s2:e3", direction: "down" })).content)).toBe("Scrolled down.");
    expect(calls).toEqual([
      ["click", "@s2:e1", "left"],
      ["setText", "@s2:e2", "milk", false],
      ["setText", "@s2:e2", "milk", true],
      ["press", "cmd+s", "Notes"],
      ["scroll", "@s2:e3", "down", 3],
    ]);
  });

  it("acts only on elements a snapshot of this session has shown", async () => {
    const { call, calls } = fake();
    const unseen = "I have no element with that ref from a recent snapshot. Take a new snapshot and use a ref from it.";
    for (const [name, input] of [
      ["computer_click", { ref: "@s9:e1" }],
      ["computer_type", { ref: "@s9:e1", text: "x" }],
      ["computer_scroll", { ref: "@s9:e1", direction: "down" }],
      ["computer_snapshot", { root: "@s9:e1" }],
    ] as const) {
      const result = await call(name, input);
      expect(result.isError, name).toBe(true);
      expect(text(result.content), name).toBe(unseen);
    }
    expect(calls).toEqual([]);
  });

  it("puts the keyboard focus in a text field instead of pressing it", async () => {
    const { call, calls, look } = fake({ snapshot: async () => form });
    await look();
    expect(text((await call("computer_click", { ref: "@s2:e2" })).content)).toBe("Clicked: the field has the keyboard focus.");
    await call("computer_click", { ref: "@s2:e2", button: "right" });
    await call("computer_click", { ref: "@s2:e1" });
    expect(calls).toEqual([
      ["focus", "@s2:e2"],
      ["click", "@s2:e2", "right"],
      ["click", "@s2:e1", "left"],
    ]);
  });

  it("points at the menu or dialog an action opened", async () => {
    const { call, look } = fake({ click: async () => ({ surfaces: ["sheet"] }) });
    await look();
    expect(text((await call("computer_click", { ref: "@s1:e1" })).content)).toBe(
      'Clicked. A sheet is open now: read it with computer_snapshot, surface "sheet".',
    );
  });

  it("answers plainly when the requested menu or dialog is not open", async () => {
    const { call } = fake({ snapshot: failing(failure("error-no-menu")) });
    const result = await call("computer_snapshot", { app: "Notes", surface: "menu" });
    expect(result.isError).toBeUndefined();
    expect(text(result.content)).toBe("No menu is open in that app right now.");
  });

  it("turns a stale ref into an instruction, flagged as an error", async () => {
    const { call, look } = fake({ click: failing(new BackendError("STALE_REF", "@s1:e1 not found in current RefMap", true)) });
    await look();
    const result = await call("computer_click", { ref: "@s1:e1" });
    expect(result.isError).toBe(true);
    expect(text(result.content)).toBe("The screen changed since that snapshot. Take a new snapshot and use a ref from it.");
  });

  it("warns before repeating an action whose outcome is unknown", async () => {
    const { call, look } = fake({ scroll: failing(failure("error-unresponsive")) });
    await look();
    expect(text((await call("computer_scroll", { ref: "@s1:e1", direction: "down" })).content)).toMatch(/may have gone through anyway/);
  });

  it("reports the name to use after opening an app", async () => {
    const { call } = fake();
    expect(text((await call("computer_open_app", { app: "notes" })).content)).toBe(
      '"Notes" is open. Window w-7 "Groceries". Use the name "Notes" for this app.',
    );
    expect(text((await call("computer_close_app", { app: "Notes" })).content)).toBe('"Notes" is closed.');
  });

  it("says how apps are named when one cannot be found", async () => {
    const { call } = fake({ openApp: failing(failure("error-launch-not-found")) });
    const result = await call("computer_open_app", { app: "Calculatrice" });
    expect(result.isError).toBe(true);
    expect(text(result.content)).toBe('No app called "Calculatrice" was found. Apps start by the name of their file, usually the English one ("Calculator", "System Settings").');
  });

  it("lists each app once with its windows", async () => {
    const { call } = fake();
    expect(text((await call("computer_list_apps")).content).split("\n")).toEqual([
      "Finder",
      "  no window in view (minimized apps and other desktops are not listed)",
      "Notes",
      '  w-7 "Groceries" (in front)',
    ]);
  });

  it("waits for text, then returns a new snapshot", async () => {
    const { call, calls } = fake();
    const result = await call("computer_wait", { app: "Notes", text: "Saved", seconds: 5 });
    expect(text(result.content)).toMatch(/^It is there\.\nNotes — window/);
    expect(calls).toEqual([
      ["waitForText", { app: "Notes", text: "Saved", gone: undefined, timeoutMs: 5000, signal: ctx.signal }],
      ["snapshot", { app: "Notes", signal: ctx.signal }],
    ]);
  });

  it("says just that when the awaited text went away together with its window", async () => {
    const { call } = fake({ snapshot: failing(failure("error-window-not-found")) });
    expect(text((await call("computer_wait", { app: "Notes", text: "Saving", gone: true })).content)).toBe("It is gone.");
  });

  it("reports a wait that ran out", async () => {
    const { call } = fake({ waitForText: failing(failure("error-wait-timeout")) });
    const result = await call("computer_wait", { app: "Notes", text: "Saved", seconds: 1 });
    expect(result.isError).toBe(true);
    expect(text(result.content)).toBe("It did not happen in time. Take a snapshot to see what is on screen now.");
  });

  it("pauses, and stops pausing when the owner interrupts", async () => {
    const { call, calls } = fake();
    expect(text((await call("computer_wait", { seconds: 0.1 })).content)).toBe("Waited 0.1 s.");
    const tool = fake().tools.find((candidate) => candidate.name === "computer_wait");
    const interrupted = await tool?.run({ seconds: 30 }, { signal: AbortSignal.abort(), threadId: "main" });
    expect(text(interrupted?.content ?? [])).toBe("Interrupted.");
    expect(calls).toEqual([]);
  });

  it("returns a screenshot as an image block with its size", async () => {
    const { call, calls } = fake();
    const result = await call("computer_screenshot", { app: "Notes" });
    expect(calls[0]).toEqual(["capture", { app: "Notes", windowId: undefined }]);
    expect(result.content[0]).toEqual({ type: "text", text: 'Window of "Notes", 1×1 pixels.' });
    const image = result.content[1];
    if (image?.type !== "image") throw new Error("no image block");
    // JPEG where a converter exists (macOS), the captured PNG elsewhere.
    expect(image.mimeType).toBe(process.platform === "darwin" ? "image/jpeg" : "image/png");
    expect(Buffer.from(image.data, "base64").length).toBeGreaterThan(50);
  });

  it.runIf(process.platform === "darwin")("downscales a wide capture to a size a model can take", async () => {
    const capture: Backend["capture"] = async (_target, file) => {
      writeFileSync(file, PIXEL);
      execFileSync("/usr/bin/sips", ["-z", "2214", "3420", file]);
      return { width: 3420, height: 2214 };
    };
    const result = await fake({ capture }).call("computer_screenshot");
    expect(result.content[0]).toEqual({ type: "text", text: "Main display, 1568×1015 pixels." });
    const image = result.content[1];
    if (image?.type !== "image") throw new Error("no image block");
    const bytes = Buffer.from(image.data, "base64");
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  });

  it("reads and writes the clipboard", async () => {
    const { call, calls } = fake();
    expect(text((await call("computer_clipboard")).content)).toBe("copied text");
    expect(text((await call("computer_clipboard", { text: "new" })).content)).toBe("Clipboard set.");
    expect(calls).toEqual([["readClipboard"], ["writeClipboard", "new"]]);
    const empty = fake({ readClipboard: async () => undefined });
    expect(text((await empty.call("computer_clipboard")).content)).toBe("The clipboard holds no text.");
  });
});

describe("inspect", () => {
  /** The facts a tool reports about one call, before it runs. */
  const facts = (tools: AgentTool[], name: string, input: Record<string, unknown>) => tools.find((tool) => tool.name === name)?.inspect?.(input);

  it("names the element a call is about, once a snapshot has shown it", async () => {
    const { call, calls, tools } = fake({ snapshot: async () => form });
    expect(facts(tools, "computer_click", { ref: "@s2:e1" })).toEqual({ target: undefined });
    await call("computer_snapshot", { app: "Notes" });
    expect(facts(tools, "computer_click", { ref: "@s2:e1" })).toEqual({ target: "New Note" });
    expect(facts(tools, "computer_type", { ref: "@s2:e2", text: "Eggs" })).toEqual({ target: "Title" });
    // An element without a name of its own has none to give.
    expect(facts(tools, "computer_scroll", { ref: "@s2:e3", direction: "down" })).toEqual({ target: undefined });
    // Looking things up is free: nothing reached the backend.
    expect(calls).toEqual([]);
  });

  it("remembers the elements of the snapshot a wait returns", async () => {
    const { call, tools } = fake({ snapshot: async () => form });
    await call("computer_wait", { app: "Notes", text: "Milk" });
    expect(facts(tools, "computer_click", { ref: "@s2:e1" })).toEqual({ target: "New Note" });
  });

  it("names the app, the shortcut or the awaited text for the other tools", () => {
    const { tools } = fake();
    expect(facts(tools, "computer_open_app", { app: "Safari" })).toEqual({ target: "Safari" });
    expect(facts(tools, "computer_snapshot", { app: "Safari" })).toEqual({ target: "Safari" });
    expect(facts(tools, "computer_screenshot", {})).toEqual({ target: undefined });
    expect(facts(tools, "computer_wait", { text: "Saved" })).toEqual({ target: "Saved" });
    expect(facts(tools, "computer_press", { keys: "return" })).toEqual({ target: "return" });
  });

  it("rates the commands that stop the computer as high risk whoever opened the app", async () => {
    const menubar = await agentDesktopBackend(async () => data("snapshot-menubar")).snapshot({});
    const { call, tools } = fake({ snapshot: async () => menubar, openApp: async () => ({ app: "AgentOSTypingTest", pid: 41, started: true }) });
    await call("computer_open_app", { app: "AgentOSTypingTest" });
    await call("computer_snapshot", { app: "AgentOSTypingTest", surface: "menubar" });
    const refOf = (name: string) => JSON.stringify(menubar.tree).match(new RegExp(`"name":"${name}","ref":"([^"]+)"`))?.[1];
    expect(facts(tools, "computer_click", { ref: refOf("Éteindre…") })).toEqual({ target: "Éteindre…", risk: "high" });
    expect(facts(tools, "computer_click", { ref: refOf("Forcer à quitter AgentOSTypingTest") })?.risk).toBe("high");
    // Its own Quit command is another matter: see "quitting an app" below.
    expect(facts(tools, "computer_click", { ref: refOf("Quit Typing Test") })).toEqual({ target: "Quit Typing Test" });
  });

  it("rates as high risk exactly the menu commands that quit, log out or stop the computer", async () => {
    // The real menu bar of an app on a French system, Apple menu included.
    const menubar = await agentDesktopBackend(async () => data("snapshot-menubar")).snapshot({});
    const { call, tools } = fake({ snapshot: async () => menubar });
    await call("computer_snapshot", { app: "AgentOSTypingTest", surface: "menubar" });

    const items: UiNode[] = [];
    const visit = (node: UiNode): void => {
      if (node.ref && node.name) items.push(node);
      node.children?.forEach(visit);
    };
    visit(menubar.tree);
    const risky = items.filter((item) => facts(tools, "computer_click", { ref: item.ref })?.risk === "high").map((item) => item.name);
    expect(risky).toEqual([
      "Forcer à quitter AgentOSTypingTest",
      "Suspendre l’activité",
      "Redémarrer…",
      "Redémarrer",
      "Éteindre…",
      "Éteindre",
      "Verrouiller l’écran",
      "Fermer la session",
      "Fermer la session",
      "Quit Typing Test",
    ]);
    // Everything else in the menus is ordinary, including the window that only lists apps to force-quit.
    expect(items.length).toBeGreaterThan(risky.length + 10);
    const shutDown = items.find((item) => item.name === "Éteindre…");
    expect(facts(tools, "computer_click", { ref: shutDown?.ref })).toEqual({ target: "Éteindre…", risk: "high" });
    // The rating is about acting on it: typing "into" it is not a way to trigger it.
    expect(facts(tools, "computer_type", { ref: shutDown?.ref, text: "x" })).toEqual({ target: "Éteindre…" });
  });

  it("keeps names short and forgets the oldest elements first", async () => {
    let batch = 0;
    const big = async (): Promise<UiSnapshot> => {
      batch++;
      const rows = Array.from({ length: 3000 }, (_, index): UiNode => ({ role: "button", name: `Row ${index} ${"x".repeat(200)}`, ref: `@s${batch}:e${index}` }));
      return { app: "Table", tree: { role: "window", children: rows }, complete: true };
    };
    const { call, tools } = fake({ snapshot: big });
    await call("computer_snapshot", { app: "Table" });
    expect(facts(tools, "computer_click", { ref: "@s1:e0" })?.target).toHaveLength(80);
    await call("computer_snapshot", { app: "Table" });
    // 6000 elements seen, 5000 kept: the first thousand of the first snapshot are gone.
    expect(facts(tools, "computer_click", { ref: "@s1:e999" })?.target).toBeUndefined();
    expect(facts(tools, "computer_click", { ref: "@s1:e1000" })?.target).toMatch(/^Row 1000 /);
    expect(facts(tools, "computer_click", { ref: "@s2:e2999" })?.target).toMatch(/^Row 2999 /);
  });
});

describe("quitting an app", () => {
  const facts = (tools: AgentTool[], name: string, input: Record<string, unknown>) => tools.find((tool) => tool.name === name)?.inspect?.(input);
  const QUIT = process.platform === "darwin" ? "cmd+q" : "alt+f4";

  /** A session in which `computer_open_app` finds the app as `opened` describes, with its real menu bar. */
  async function session(...opened: { pid: number; started: boolean }[]) {
    const menubar = { ...(await agentDesktopBackend(async () => data("snapshot-menubar")).snapshot({})), app: "Calculatrice" };
    const quitItem = JSON.stringify(menubar.tree).match(/"name":"Quit Typing Test","ref":"([^"]+)"/)?.[1];
    let call = 0;
    const made = fake({ snapshot: async () => menubar, openApp: async () => ({ app: "Calculatrice", ...(opened[call++] ?? opened.at(-1) ?? { pid: 0, started: false }) }) });
    await made.call("computer_snapshot", { app: "Calculatrice", surface: "menubar" });
    /** The three ways to quit it, and whether each would be put to the owner. */
    const risks = () => ({
      tool: facts(made.tools, "computer_close_app", { app: "Calculatrice" })?.risk,
      shortcut: facts(made.tools, "computer_press", { keys: QUIT, app: "Calculatrice" })?.risk,
      menu: facts(made.tools, "computer_click", { ref: quitItem })?.risk,
    });
    return { ...made, risks };
  }
  const routine = { tool: undefined, shortcut: undefined, menu: undefined };
  const owners = { tool: "high", shortcut: "high", menu: "high" };

  it("is routine when the agent started the app itself in this session", async () => {
    const { call, tools, risks } = await session({ pid: 41, started: true });
    await call("computer_open_app", { app: "Calculator" });
    expect(risks()).toEqual(routine);
    // Under the name the model used to open it too, whatever the capitals.
    expect(facts(tools, "computer_close_app", { app: "calculator" })).toEqual({ target: "calculator" });
    // A harmless shortcut never was a risk.
    expect(facts(tools, "computer_press", { keys: "shift+tab", app: "Calculatrice" })).toEqual({ target: "shift+tab" });
  });

  it("is high risk when the app was already running, even once the agent has brought it to the front", async () => {
    const { call, risks } = await session({ pid: 41, started: false });
    expect(risks()).toEqual(owners);
    await call("computer_open_app", { app: "Calculatrice" });
    expect(risks()).toEqual(owners);
  });

  it("is high risk when the target cannot be told", async () => {
    const { call, tools } = await session({ pid: 41, started: true });
    await call("computer_open_app", { app: "Calculator" });
    // No app named: the keys would go to whatever is in front.
    expect(facts(tools, "computer_press", { keys: QUIT })).toEqual({ target: QUIT, risk: "high" });
    expect(facts(tools, "computer_close_app", { app: "Pages" })).toEqual({ target: "Pages", risk: "high" });
  });

  it("is the owner's business again once the agent's own app is closed or gone", async () => {
    const closed = await session({ pid: 41, started: true });
    await closed.call("computer_open_app", { app: "Calculator" });
    await closed.call("computer_close_app", { app: "Calculatrice" });
    expect(closed.risks()).toEqual(owners);

    // Gone without the agent closing it: the list of open apps shows other processes only.
    const gone = await session({ pid: 41, started: true });
    await gone.call("computer_open_app", { app: "Calculator" });
    await gone.call("computer_list_apps");
    expect(gone.risks()).toEqual(owners);

    // Found running again later as another process: someone else started that one.
    const replaced = await session({ pid: 41, started: true }, { pid: 41, started: false }, { pid: 99, started: false });
    await replaced.call("computer_open_app", { app: "Calculator" });
    await replaced.call("computer_open_app", { app: "Calculatrice" });
    expect(replaced.risks()).toEqual(routine);
    await replaced.call("computer_open_app", { app: "Calculatrice" });
    expect(replaced.risks()).toEqual(owners);
  });
});

describe("AgentOS's own app", () => {
  const OWN = "That is my own control panel; only my owner uses it.";
  /** A computer on which the AgentOS app runs, under that name and with one window, next to Notes. */
  const guarded = (front = false, over: Partial<Backend> = {}) => {
    const guard: Guard = {
      owns: (app) => app.name === "AgentOS",
      protects: async (app) => app.toLowerCase() === "agentos",
      inFront: async () => front,
      refresh: () => {},
    };
    const listApps: Backend["listApps"] = async () => [
      { name: "AgentOS", pid: 50, id: "org.agentos.desktop", foreground: true },
      { name: "Notes", pid: 1, foreground: true },
    ];
    return fake({ listApps, ...over }, guard);
  };

  it("is refused by every tool that names an app, before anything reaches the backend", async () => {
    const { call, calls } = guarded();
    for (const [name, input] of [
      ["computer_snapshot", { app: "AgentOS" }],
      ["computer_snapshot", { app: "agentos", surface: "menubar" }],
      ["computer_wait", { app: "AgentOS", text: "Go ahead" }],
      ["computer_press", { keys: "return", app: "AgentOS" }],
      ["computer_screenshot", { app: "AgentOS" }],
      ["computer_open_app", { app: "AgentOS" }],
      ["computer_close_app", { app: "AgentOS" }],
    ] as const) {
      const result = await call(name, input);
      expect(result.isError, name).toBe(true);
      expect(text(result.content), name).toBe(OWN);
    }
    expect(calls).toEqual([]);
  });

  it("is refused when no app is named and it is the one in front", async () => {
    const { call, calls } = guarded(true);
    for (const [name, input] of [
      ["computer_press", { keys: "return" }],
      ["computer_snapshot", {}],
      ["computer_wait", { text: "Go ahead" }],
    ] as const) {
      expect(text((await call(name, input)).content), name).toBe(OWN);
    }
    expect(calls).toEqual([]);
    // With another app in front, the same calls go through.
    const elsewhere = guarded(false);
    expect(text((await elsewhere.call("computer_press", { keys: "return" })).content)).toBe("Pressed return.");
  });

  it("is never shown, whatever name led to it, so that none of its elements can be acted on", async () => {
    // The backend also resolves names the guard cannot foresee; what counts is what was read.
    const panel: UiSnapshot = { app: "AgentOS", tree: { role: "window", children: [{ role: "button", name: "Go ahead", ref: "@s5:e1" }] }, complete: true };
    const { call, calls } = guarded(false, { snapshot: async () => panel });
    expect(text((await call("computer_snapshot", { app: "Some Alias" })).content)).toBe(OWN);
    expect(text((await call("computer_wait", { app: "Some Alias", text: "Go" })).content)).toBe(OWN);
    const click = await call("computer_click", { ref: "@s5:e1" });
    expect(text(click.content)).toMatch(/^I have no element with that ref/);
    expect(calls.filter(([name]) => name === "click" || name === "focus")).toEqual([]);
  });

  it("is refused when an app that was opened turns out to be it", async () => {
    const { call, tools } = guarded(false, { openApp: async () => ({ app: "AgentOS", pid: 50, started: true }) });
    expect(text((await call("computer_open_app", { app: "Control Panel" })).content)).toBe(OWN);
    // And it is not recorded as an app the agent may close without asking.
    expect(tools.find((tool) => tool.name === "computer_close_app")?.inspect?.({ app: "AgentOS" })).toEqual({ target: "AgentOS", risk: "high" });
  });

  it("is listed by name, with nothing to act on", async () => {
    const { call } = guarded();
    expect(text((await call("computer_list_apps")).content).split("\n")).toEqual([
      "AgentOS",
      "  my own control panel: only my owner uses it",
      "Notes",
      '  w-7 "Groceries" (in front)',
    ]);
  });

  it("still allows a picture of the whole display, which shows whatever is visible", async () => {
    const { call, calls } = guarded(true);
    expect((await call("computer_screenshot")).isError).toBeUndefined();
    expect(calls).toEqual([["capture", { app: undefined, windowId: undefined }]]);
  });
});
