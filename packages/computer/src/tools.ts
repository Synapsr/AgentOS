/**
 * The tools the agent gets for using the computer.
 *
 * Written for a model: few tools, and descriptions that teach one loop —
 * read the screen as text, act on a ref, read again. Pictures are the
 * exception, for when the text is not enough or the owner wants to look.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { type AgentTool, defineTool, type ToolResult } from "@agentos/protocol";
import { z } from "zod";
import { type ActionResult, type Backend, BackendError, SURFACES, type UiNode, type UiSnapshot } from "./backend.js";
import { createGuard, type Guard, key, OWN_APP_MESSAGE } from "./guard.js";
import { captureScreenshot } from "./image.js";
import { isQuitShortcut } from "./keyboard.js";
import { explain } from "./messages.js";
import { plain, renderSnapshot } from "./snapshot.js";

/** Widest picture handed to the model: enough to read a screen, cheap enough to send. */
const PICTURE_WIDTH = 1568;
/** Longest clipboard text returned in one go. */
const CLIPBOARD_LIMIT = 20_000;
/** Elements remembered from recent snapshots: several large windows' worth. */
const MAX_SEEN = 5000;
/** Longest element name passed on for the owner's activity line. */
const MAX_TARGET = 80;

/** What a snapshot said about an element, kept so that a later call on its ref can be described without asking again. */
interface Seen {
  name?: string;
  role: string;
  /** The app the element belongs to. */
  app: string;
  critical?: UiNode["critical"];
}

const high = (risky: boolean) => (risky ? { risk: "high" as const } : {});

const MOD = process.platform === "darwin" ? "cmd" : "ctrl";

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const no = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const failed = (error: unknown, acted = false): ToolResult => no(explain(error, acted));

/** The answer to any attempt on AgentOS's own app. */
const ownApp = no(OWN_APP_MESSAGE);
/** The answer to a ref no snapshot of this session has shown: it cannot be vouched for. */
const unseenRef = no("I have no element with that ref from a recent snapshot. Take a new snapshot and use a ref from it.");

/** Confirms an action and points at the menu or dialog it opened, if any. */
function done(what: string, result: ActionResult): ToolResult {
  const [layer] = result.surfaces;
  if (!layer) return ok(what);
  return ok(`${what} ${layer === "alert" ? "An" : "A"} ${layer} is open now: read it with computer_snapshot, surface "${layer}".`);
}

const ref = z.string().describe("Ref of the element, copied exactly from the latest computer_snapshot, e.g. @s8f3k2p9:e12.");
const app = z.string().describe("App name as computer_open_app or computer_list_apps reports it.");

/** Builds the agent's tools on top of a backend. The guard keeps them away from AgentOS's own app. */
export function computerTools(backend: Backend, guard: Guard = createGuard(backend)): AgentTool[] {
  // Only elements shown by a snapshot can be acted on, and snapshots of AgentOS's own app are
  // never shown: together that keeps every ref-based tool out of it.
  const seen = new Map<string, Seen>();

  /** True when a call aimed at `app`, or with none named at whatever is in front, would land on AgentOS itself. */
  const offLimits = (app: string | undefined) => (app === undefined ? guard.inFront() : guard.protects(app));

  // Apps this session started itself, by name, with the process it started. Quitting one of
  // those is tidying up; quitting an app that was already running may cost its owner their work.
  const own = new Map<string, number>();
  const isOwn = (app: string | undefined) => app !== undefined && own.has(key(app));

  /** Renders a snapshot for the model, and remembers its elements by ref. */
  const show = (snapshot: UiSnapshot): string => {
    const visit = (node: UiNode): void => {
      if (node.ref) {
        const name = node.name ? plain(node.name).slice(0, MAX_TARGET) : undefined;
        seen.delete(node.ref);
        seen.set(node.ref, { name, role: node.role, app: snapshot.app, critical: node.critical });
      }
      node.children?.forEach(visit);
    };
    visit(snapshot.tree);
    // Oldest out first: the refs of snapshots long gone are not coming back.
    for (const ref of seen.keys()) {
      if (seen.size <= MAX_SEEN) break;
      seen.delete(ref);
    }
    return renderSnapshot(snapshot);
  };

  /** Facts about a call on an element, from memory only: its name, and whether acting on it is drastic. */
  const about = (ref: string, acting = false) => {
    const element = seen.get(ref);
    const drastic = element?.critical === "severe" || (element?.critical === "quit" && !isOwn(element.app));
    return { target: element?.name, ...high(acting && drastic) };
  };

  return [
    defineTool({
      name: "computer_snapshot",
      description:
        "Read what an app shows, as text: its accessibility tree, one element per line, with a ref such as @s8f3k2p9:e12 after every element you can act on. " +
        "This is how you see the screen. Start here, and take a new snapshot after anything that changes the screen: refs stop working once the UI changes. " +
        "It works for apps in the background or covered by other windows. " +
        "A large window is cut off after a few hundred lines; then pass `root` to read one container in full, or `interactive_only` to list just the controls. " +
        "Menus and dialogs are separate layers: when an action says it opened one, read it with `surface`.",
      input: {
        app: app.optional().describe("App to read, by the name computer_open_app or computer_list_apps reports. Leave out only to read whichever app is in front."),
        window_id: z.string().optional().describe("Only when the app has several windows: the id from computer_list_apps, e.g. w-4521."),
        root: ref.optional().describe("Ref of a container from an earlier snapshot: read only what is inside it, in full."),
        surface: z
          .enum(SURFACES)
          .optional()
          .describe('A layer instead of the window: "menu" (an open menu), "menubar" (File, Edit…), "sheet" or "alert" (a dialog, e.g. a save prompt), "popover".'),
        interactive_only: z.boolean().optional().describe("List only buttons, fields and other controls, without the plain text."),
      },
      readOnly: true,
      inspect: (input) => ({ target: input.app }),
      async run(input, ctx) {
        try {
          if (input.root) {
            if (!seen.has(input.root)) return unseenRef;
          } else if (await offLimits(input.app)) return ownApp;
          const snapshot = await backend.snapshot({
            app: input.app,
            windowId: input.window_id,
            root: input.root,
            surface: input.surface,
            interactiveOnly: input.interactive_only,
            signal: ctx.signal,
          });
          // Whatever the request named, what was read must not be AgentOS itself.
          if (snapshot.app && (await guard.protects(snapshot.app))) return ownApp;
          return ok(show(snapshot));
        } catch (error) {
          // Asking for a layer that is not there is a plain "no", not a stale ref.
          const absent = input.surface && error instanceof BackendError && /^(ELEMENT|WINDOW)_NOT_FOUND$/.test(error.code);
          return absent ? ok(`No ${input.surface} is open in that app right now.`) : failed(error);
        }
      },
    }),

    defineTool({
      name: "computer_click",
      description:
        "Click an element by its ref. It happens in the background: the mouse pointer does not move and the app does not need to be in front. " +
        "Clicking a text field puts the keyboard focus in it (its text may get selected, so that typing replaces it). " +
        'Use button "right" to open the context menu. Afterwards take a new snapshot to see the result.',
      input: {
        ref,
        button: z.enum(["left", "right"]).optional().describe("Defaults to left."),
      },
      readOnly: false,
      inspect: (input) => about(input.ref, true),
      async run(input) {
        try {
          if (!seen.has(input.ref)) return unseenRef;
          // "Pressing" a text field through accessibility confirms it, as Return would.
          // What a person's click does there is put the cursor in it.
          if (seen.get(input.ref)?.role === "textfield" && input.button !== "right") {
            return done("Clicked: the field has the keyboard focus.", await backend.focus(input.ref));
          }
          return done("Clicked.", await backend.click(input.ref, input.button ?? "left"));
        } catch (error) {
          return failed(error, true);
        }
      },
    }),

    defineTool({
      name: "computer_type",
      description:
        "Put text into a text field by its ref. By default the text is added: at the cursor when the field has the keyboard focus (a selection is replaced), " +
        "otherwise at the end. With `replace` it replaces everything in the field. " +
        'This only fills the field. To submit, click the form\'s button; or click the field, type, then press "return" with computer_press.',
      input: {
        ref,
        text: z.string().describe("The text, exactly as it should appear."),
        replace: z.boolean().optional().describe("Replace the field's whole content instead of inserting."),
      },
      readOnly: false,
      inspect: (input) => about(input.ref),
      async run(input) {
        try {
          if (!seen.has(input.ref)) return unseenRef;
          return done(input.replace ? "Text replaced." : "Typed.", await backend.setText(input.ref, input.text, input.replace ?? false));
        } catch (error) {
          return failed(error, true);
        }
      },
    }),

    defineTool({
      name: "computer_press",
      description:
        `Press a key or a shortcut: "return", "escape", "tab", "space", "delete", "up", "down", "left", "right", "f5", "${MOD}+s", "${MOD}+shift+z". ` +
        `Modifiers are ${MOD === "cmd" ? "cmd, ctrl, alt, shift" : "ctrl, alt, shift"}, joined with +. ` +
        "With `app` the keys go to that app; without, to the app in front. Plain keys reach an app in the background, " +
        `but a shortcut with ${MOD} only works in the app in front (computer_open_app brings it there). ` +
        "To enter text use computer_type. Shortcuts that quit apps are refused: use computer_close_app.",
      input: {
        keys: z.string().describe(`One key or one shortcut, e.g. "return" or "${MOD}+a".`),
        app: app.optional(),
      },
      readOnly: false,
      // Without `app` the keys go to whatever is in front, which cannot be known from here.
      inspect: (input) => ({ target: input.keys, ...high(isQuitShortcut(input.keys) && !isOwn(input.app)) }),
      async run(input) {
        try {
          if (await offLimits(input.app)) return ownApp;
          return done(`Pressed ${input.keys}.`, await backend.press(input.keys, input.app));
        } catch (error) {
          return failed(error, true);
        }
      },
    }),

    defineTool({
      name: "computer_scroll",
      description:
        "Scroll a scrollable area to bring more content into view, then take a new snapshot. " +
        "Pass the ref of a `scrollarea` from the snapshot. Clicking an element that is out of view scrolls to it by itself, so this is for reading further.",
      input: {
        ref,
        direction: z.enum(["up", "down", "left", "right"]),
        amount: z.number().int().min(1).max(50).optional().describe("How far, in scroll steps. Defaults to 3."),
      },
      readOnly: false,
      inspect: (input) => about(input.ref),
      async run(input) {
        try {
          if (!seen.has(input.ref)) return unseenRef;
          return done(`Scrolled ${input.direction}.`, await backend.scroll(input.ref, input.direction, input.amount ?? 3));
        } catch (error) {
          return failed(error, true);
        }
      },
    }),

    defineTool({
      name: "computer_open_app",
      description:
        "Open an app, or bring it to the front if it is already running, and wait for its window. " +
        "The result gives the app's name as this computer reports it (it can be translated): use that name in the other tools.",
      input: { app: z.string().describe('App name, e.g. "Safari", "Calculator".') },
      readOnly: false,
      inspect: (input) => ({ target: input.app }),
      async run(input, ctx) {
        try {
          if (await guard.protects(input.app)) return ownApp;
          const opened = await backend.openApp(input.app, ctx.signal);
          // A name can lead to an app that only shows what it is once it runs: look again.
          guard.refresh();
          if (await guard.protects(opened.app)) return ownApp;
          // Under both names: the one the model used and the one the system reports.
          for (const name of [input.app, opened.app]) {
            if (opened.started) own.set(key(name), opened.pid);
            else if (own.get(key(name)) !== opened.pid) own.delete(key(name));
          }
          const window = opened.window ? `Window ${opened.window.id} ${JSON.stringify(opened.window.title)}.` : "It shows no window yet: wait a moment, then call computer_list_apps.";
          return ok(`${JSON.stringify(opened.app)} is open. ${window} Use the name ${JSON.stringify(opened.app)} for this app.`);
        } catch (error) {
          if (error instanceof BackendError && error.code === "APP_NOT_FOUND") {
            return no(`No app called ${JSON.stringify(input.app)} was found. Apps start by the name of their file, usually the English one ("Calculator", "System Settings").`);
          }
          return failed(error, true);
        }
      },
    }),

    defineTool({
      name: "computer_close_app",
      description: "Quit an app. If it has unsaved work it may ask what to do instead of quitting: then take a snapshot to read its dialog and answer it.",
      input: { app },
      readOnly: false,
      // Quitting an app someone else was using can lose what they had not saved.
      inspect: (input) => ({ target: input.app, ...high(!isOwn(input.app)) }),
      async run(input) {
        try {
          if (await guard.protects(input.app)) return ownApp;
          await backend.closeApp(input.app);
          const closed = own.get(key(input.app));
          for (const [name, pid] of own) if (pid === closed) own.delete(name);
          return ok(`${JSON.stringify(input.app)} is closed.`);
        } catch (error) {
          return failed(error, true);
        }
      },
    }),

    defineTool({
      name: "computer_list_apps",
      description: "List the apps that are open, each with its windows (id and title). Use it to find an app's exact name, or a window_id when an app has several windows.",
      input: {},
      readOnly: true,
      async run() {
        try {
          const apps = await backend.listApps();
          // An app this session started and that is gone was closed by someone else: if it comes back, it is theirs.
          for (const [name, pid] of own) if (!apps.some((entry) => entry.pid === pid)) own.delete(name);
          const open = apps.filter((entry) => entry.foreground);
          // AgentOS itself is named, so that the model knows what it is, but with nothing to act on.
          const mine = new Set(open.filter((entry) => guard.owns(entry)).map((entry) => entry.name));
          const names = [...new Set(open.map((entry) => entry.name))].sort((a, b) => a.localeCompare(b));
          const windows = await Promise.all(names.map((name) => (mine.has(name) ? [] : backend.listWindows(name).catch(() => []))));
          const lines = names.flatMap((name, index) => {
            if (mine.has(name)) return [name, "  my own control panel: only my owner uses it"];
            const own = windows[index] ?? [];
            if (own.length === 0) return [name, "  no window in view (minimized apps and other desktops are not listed)"];
            return [name, ...own.map((w) => `  ${w.id} ${JSON.stringify(w.title)}${w.focused ? " (in front)" : ""}${w.minimized ? " (minimized)" : ""}`)];
          });
          return ok(lines.length ? lines.join("\n") : "No app is open.");
        } catch (error) {
          return failed(error);
        }
      },
    }),

    defineTool({
      name: "computer_wait",
      description:
        "Wait for the screen to catch up instead of guessing. With `text`: returns a new snapshot as soon as an element containing that text appears in the app " +
        "(or, with `gone`, as soon as none is left), e.g. after starting something slow. Without `text`: just pauses for `seconds`.",
      input: {
        text: z.string().optional().describe("Text to wait for, as it would appear in a snapshot."),
        gone: z.boolean().optional().describe("Wait for the text to disappear instead of appear."),
        app: app.optional(),
        seconds: z.number().min(0.1).max(60).optional().describe("With text: the longest to wait (default 10). Without text: how long to pause (default 1)."),
      },
      readOnly: true,
      inspect: (input) => ({ target: input.text }),
      async run(input, ctx) {
        try {
          if (!input.text) {
            const seconds = input.seconds ?? 1;
            await sleep(seconds * 1000, undefined, { signal: ctx.signal }).catch(() => {});
            return ok(ctx.signal.aborted ? "Interrupted." : `Waited ${seconds} s.`);
          }
          if (await offLimits(input.app)) return ownApp;
          const timeoutMs = Math.round((input.seconds ?? 10) * 1000);
          await backend.waitForText({ app: input.app, text: input.text, gone: input.gone, timeoutMs, signal: ctx.signal });
          const verdict = input.gone ? "It is gone." : "It is there.";
          // The text may have gone because its window closed: then there is nothing left to show.
          const snapshot = await backend.snapshot({ app: input.app, signal: ctx.signal }).catch(() => undefined);
          if (snapshot?.app && (await guard.protects(snapshot.app))) return ownApp;
          return ok(snapshot ? `${verdict}\n${show(snapshot)}` : verdict);
        } catch (error) {
          return failed(error);
        }
      },
    }),

    defineTool({
      name: "computer_screenshot",
      description:
        "Take a picture of an app's window, or of the whole main display when no app is given. " +
        "Prefer computer_snapshot: it is faster, exact, and gives you refs. Take a picture only when the text is not enough " +
        "(the app shows little or nothing in its snapshot, or the question is about how something looks) or when the owner should see what you see. " +
        "A window is captured by itself even when other windows cover it.",
      input: {
        app: app.optional(),
        window_id: z.string().optional().describe("Only when the app has several windows: the id from computer_list_apps."),
      },
      readOnly: true,
      inspect: (input) => ({ target: input.app }),
      async run(input) {
        try {
          // A picture of the whole display stays allowed: it shows whatever is visible, AgentOS's window included.
          if (input.app && (await guard.protects(input.app))) return ownApp;
          const shot = await captureScreenshot(backend, { app: input.app, windowId: input.window_id }, { maxWidth: PICTURE_WIDTH });
          return {
            content: [
              { type: "text", text: `${input.app ? `Window of ${JSON.stringify(input.app)}` : "Main display"}, ${shot.width}×${shot.height} pixels.` },
              { type: "image", data: Buffer.from(shot.data).toString("base64"), mimeType: shot.mime },
            ],
          };
        } catch (error) {
          return failed(error);
        }
      },
    }),

    defineTool({
      name: "computer_clipboard",
      description:
        `Read the text on the clipboard, or put text on it when \`text\` is given. Pairs with computer_press: "${MOD}+c" then read, or write then "${MOD}+v". ` +
        "Writing replaces whatever the owner had copied.",
      input: { text: z.string().optional().describe("Text to put on the clipboard. Leave out to read.") },
      readOnly: false,
      async run(input) {
        try {
          if (input.text !== undefined) {
            await backend.writeClipboard(input.text);
            return ok("Clipboard set.");
          }
          const text = await backend.readClipboard();
          if (text === undefined) return ok("The clipboard holds no text.");
          return ok(text.length > CLIPBOARD_LIMIT ? `${text.slice(0, CLIPBOARD_LIMIT)}\n… (${text.length - CLIPBOARD_LIMIT} more characters not shown)` : text);
        } catch (error) {
          return failed(error, input.text !== undefined);
        }
      },
    }),
  ];
}
