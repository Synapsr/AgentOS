/**
 * Keyboard layouts on macOS.
 *
 * agent-desktop sends letters and digits as US-keyboard key positions. On any
 * other layout the app receives a different character: on a French keyboard
 * "cmd+a" arrives as Cmd+Q and quits the app. Before sending a combo we ask
 * macOS which key types the intended character and name that key instead.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** For each US key name ("a", "7"…): what that key types here, plain and with Shift. */
export type KeyboardLayout = Record<string, [plain: string, shifted: string]>;

/** macOS virtual key codes of the keys agent-desktop names after US characters. */
const US_KEY_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15,
  y: 16, t: 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28,
  "0": 29, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
};

// Building a key event (never posted) and reading its characters is the
// simplest way to ask the active layout a question without native code.
const LAYOUT_SCRIPT = `
ObjC.import("Cocoa");
function typed(code, flags) {
  const event = $.CGEventCreateKeyboardEvent(null, code, true);
  $.CGEventSetFlags(event, flags);
  return $.NSEvent.eventWithCGEvent(event).characters.js;
}
function run(argv) {
  const codes = JSON.parse(argv[0]);
  const layout = {};
  for (const name in codes) layout[name] = [typed(codes[name], 0), typed(codes[name], $.kCGEventFlagMaskShift)];
  return JSON.stringify(layout);
}`;

/** Reads the active keyboard layout. Needs no permission. */
export async function readLayout(): Promise<KeyboardLayout> {
  const { stdout } = await promisify(execFile)(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", LAYOUT_SCRIPT, JSON.stringify(US_KEY_CODES)],
    { timeout: 5000 },
  );
  return JSON.parse(stdout) as KeyboardLayout;
}

const COMMAND = new Set(["cmd", "command", "meta", "super", "win"]);

/** True when the combo's key is a letter or digit, the only keys that depend on the layout. */
export function dependsOnLayout(keys: string): boolean {
  return /^[a-z0-9]$/i.test(keys.replace(/\s/g, "").split("+").pop() ?? "");
}

/** True when Cmd is part of the combo: macOS apps only obey such shortcuts while they are in front. */
export function usesCommand(keys: string): boolean {
  return keys.replace(/\s/g, "").toLowerCase().split("+").slice(0, -1).some((part) => COMMAND.has(part));
}

/**
 * True for the shortcuts that quit an app, whatever else is held: Cmd+Q on a Mac,
 * Ctrl+Q and Alt+F4 elsewhere. The agent quits apps with the dedicated tool instead.
 */
export function isQuitShortcut(keys: string, platform: string = process.platform): boolean {
  const parts = keys.replace(/\s/g, "").toLowerCase().split("+");
  const key = parts.pop();
  const held = (...names: string[]) => parts.some((part) => names.includes(part));
  if (platform === "darwin") return key === "q" && parts.some((part) => COMMAND.has(part));
  return (key === "q" && held("ctrl", "control")) || (key === "f4" && held("alt", "option"));
}

/**
 * Rewrites a combo so that the intended character reaches the app on `layout`.
 * Returns undefined when no key agent-desktop can name would do that.
 * `force` is set when the rewritten combo only *looks* like a quit shortcut to
 * agent-desktop (French "cmd+a" has to be sent as the key it calls "q").
 */
export function localizeCombo(keys: string, layout: KeyboardLayout): { keys: string; force: boolean } | undefined {
  const parts = keys.replace(/\s/g, "").split("+");
  const raw = parts.pop() ?? "";
  const modifiers = parts.map((part) => part.toLowerCase());
  // A bare capital means Shift plus the letter, as in agent-desktop itself.
  if (modifiers.length === 0 && /^[A-Z]$/.test(raw)) modifiers.push("shift");
  const key = raw.toLowerCase();

  const keyTyping = (level: 0 | 1) => Object.keys(layout).find((name) => layout[name]?.[level] === key);
  let name = keyTyping(0);
  if (!name && /\d/.test(key)) {
    if (modifiers.length > 0) {
      // Shortcuts on digits go by key position on every layout (French Cmd+& is Cmd+1).
      name = key;
    } else if ((name = keyTyping(1))) {
      // French keyboards type digits with Shift.
      modifiers.push("shift");
    }
  }
  if (!name) {
    // Layouts without Latin letters (Cyrillic, Greek…) keep the US position: macOS falls
    // back to it for shortcuts too. But when that position types some other ASCII
    // character (French "m" lives elsewhere, and its US position types ","), sending it
    // would trigger a different shortcut.
    if (/^[\x21-\x7e]$/.test(layout[key]?.[0] ?? "")) return undefined;
    name = key;
  }

  const force = name === "q" && key !== "q" && modifiers.some((modifier) => COMMAND.has(modifier));
  return { keys: [...modifiers, name].join("+"), force };
}
