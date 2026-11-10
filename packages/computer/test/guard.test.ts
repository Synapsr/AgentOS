import { afterEach, describe, expect, it } from "vitest";
import type { AppInfo, Backend, WindowInfo } from "../src/backend.js";
import { ancestors, createGuard, OWN_APPS_VARIABLE } from "../src/guard.js";

/** What is running: the AgentOS app (pid 50, launched us), an editor, and a second shell under a custom name. */
const APPS: AppInfo[] = [
  { name: "AgentOS", pid: 50, id: "org.agentos.desktop", foreground: true },
  { name: "Notes", pid: 1, id: "com.apple.Notes", foreground: true },
  { name: "Launcher", pid: 60, id: "com.example.launcher", foreground: true },
  { name: "Notes Helper", pid: 2, foreground: false },
];
const WINDOWS: Record<string, WindowInfo[]> = {
  AgentOS: [{ id: "w-1", title: "AgentOS", app: "AgentOS", pid: 50, focused: false, minimized: false }],
  // The backend also answers to an executable's name: here "launcherd" leads to Launcher's window.
  launcherd: [{ id: "w-2", title: "Launcher", app: "Launcher", pid: 60, focused: true, minimized: false }],
  Launcher: [{ id: "w-2", title: "Launcher", app: "Launcher", pid: 60, focused: true, minimized: false }],
  Notes: [{ id: "w-3", title: "Groceries", app: "Notes", pid: 1, focused: false, minimized: false }],
};

/** A backend that only knows the lists above, counting how often it is asked. */
function world(apps = APPS, windows = WINDOWS) {
  const asked = { apps: 0, windows: [] as string[] };
  const backend = {
    listApps: async () => (asked.apps++, apps),
    listWindows: async (app: string) => (asked.windows.push(app), windows[app] ?? []),
  } as unknown as Backend;
  return { backend, asked };
}

afterEach(() => {
  delete process.env[OWN_APPS_VARIABLE];
});

describe("ancestors", () => {
  it.runIf(process.platform !== "win32")("lists the processes above this one, nearest first", () => {
    const chain = ancestors();
    expect(chain[0]).toBe(process.ppid);
    expect(chain).not.toContain(process.pid);
    expect(new Set(chain).size).toBe(chain.length);
  });

  it("is empty for a process that does not exist", () => {
    expect(ancestors(2 ** 30)).toEqual([]);
  });
});

describe("guard", () => {
  it("protects AgentOS's own app by identifier and by name, whatever the capitals", async () => {
    const { backend, asked } = world([]);
    const guard = createGuard(backend, { ancestors: [] });
    expect(await Promise.all(["org.agentos.desktop", "AgentOS", "agentos", " AGENTOS-desktop "].map((app) => guard.protects(app)))).toEqual([true, true, true, true]);
    // Known without looking at what is running.
    expect(asked).toEqual({ apps: 0, windows: [] });
    expect(guard.owns({ name: "Renamed", pid: 9, id: "org.agentos.desktop", foreground: true })).toBe(true);
    expect(guard.owns({ name: "Notes", pid: 1, id: "com.apple.Notes", foreground: true })).toBe(false);
  });

  it("protects whatever app launched this process, under any name it answers to", async () => {
    const { backend } = world();
    const guard = createGuard(backend, { ancestors: [777, 60] });
    expect(guard.owns({ name: "Launcher", pid: 60, foreground: true })).toBe(true);
    expect(await guard.protects("Launcher")).toBe(true);
    expect(await guard.protects("com.example.launcher")).toBe(true);
    // A spelling only the backend understands: the window it leads to belongs to that process.
    expect(await guard.protects("launcherd")).toBe(true);
    expect(await guard.protects("Notes")).toBe(false);
    expect(await guard.protects("Nothing Running")).toBe(false);
  });

  it("takes more identifiers from the environment variable and from its options", async () => {
    const { backend } = world();
    expect(await createGuard(backend, { ancestors: [] }).protects("Launcher")).toBe(false);
    process.env[OWN_APPS_VARIABLE] = " com.example.launcher , ,Other App";
    const guard = createGuard(backend, { ancestors: [], apps: ["Notes"] });
    expect(await Promise.all(["Launcher", "launcherd", "other app", "Notes"].map((app) => guard.protects(app)))).toEqual([true, true, true, true]);
  });

  it("knows when its own app is the one in front", async () => {
    const guard = createGuard(world().backend, { ancestors: [60] });
    expect(await guard.inFront()).toBe(true);
    const behind = { ...WINDOWS, Launcher: [], launcherd: [] };
    expect(await createGuard(world(APPS, behind).backend, { ancestors: [60] }).inFront()).toBe(false);
    expect(await createGuard(world([]).backend, { ancestors: [] }).inFront()).toBe(false);
  });

  it("looks at what is running sparingly, and afresh when asked to", async () => {
    const { backend, asked } = world();
    const guard = createGuard(backend, { ancestors: [60] });
    await guard.protects("Notes");
    await guard.protects("Notes");
    await guard.protects("Finder");
    expect(asked).toEqual({ apps: 1, windows: ["Notes", "Finder"] });
    guard.refresh();
    await guard.protects("Notes");
    expect(asked).toEqual({ apps: 2, windows: ["Notes", "Finder", "Notes"] });
  });

  it("has nothing to look up when none of its apps is running", async () => {
    const { backend, asked } = world([{ name: "Notes", pid: 1, foreground: true }]);
    expect(await createGuard(backend, { ancestors: [60] }).protects("Notes")).toBe(false);
    expect(asked.windows).toEqual([]);
  });
});
