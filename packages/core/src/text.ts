/** Small helpers for turning machine strings into lines a person can read. */

/** One line, at most `max` characters, ending with "…" when cut. */
export function shorten(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A long text made to fit in about `max` characters without hiding what
 * matters: its beginning, its end, and the part `around` matches, with
 * `gap(n)` wherever n characters were left out. One line, like `shorten`.
 */
export function excerpt(text: string, max: number, gap: (hidden: number) => string, around?: RegExp): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const found = around?.exec(line);
  const tenth = Math.floor(max / 10);
  // With something to point at: three tenths of the room for the beginning, four around the match, two for the end.
  const wanted: [number, number][] = found
    ? [[0, 3 * tenth], [found.index - tenth, found.index + 3 * tenth], [line.length - 2 * tenth, line.length]]
    : [[0, 6 * tenth], [line.length - 3 * tenth, line.length]];
  const kept: [number, number][] = [];
  for (const [from, to] of wanted.sort((a, b) => a[0] - b[0])) {
    const last = kept.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else kept.push([Math.max(0, from), Math.min(line.length, to)]);
  }
  return kept
    .map(([from, to], index) => {
      const before = index === 0 ? 0 : from - (kept[index - 1]?.[1] ?? 0);
      return `${before > 0 ? `${gap(before)} ` : ""}${line.slice(from, to).trim()}`;
    })
    .join(" ");
}

/** "notes.txt" from "/Users/marie/Documents/notes.txt". */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** "send message" from "mcp__mail__send_message". */
export function toolName(tool: string): string {
  return (tool.split("__").at(-1) ?? tool).replace(/[_-]+/g, " ").trim();
}

const MAC_KEYS: Record<string, string> = {
  cmd: "⌘", command: "⌘", meta: "⌘", shift: "⇧", alt: "⌥", option: "⌥", opt: "⌥", ctrl: "⌃", control: "⌃",
  return: "↩", enter: "↩", escape: "⎋", esc: "⎋", tab: "⇥", delete: "⌫", backspace: "⌫",
  up: "↑", down: "↓", left: "←", right: "→",
};

/** A shortcut as people write it: "⌘Q" from "cmd+q" on a Mac, "Ctrl+Q" from "ctrl+q" elsewhere. */
export function shortcut(keys: string, mac = process.platform === "darwin"): string {
  const names = keys.split("+").map((key) => key.trim()).filter(Boolean);
  const titled = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);
  if (!mac) return names.map(titled).join("+");
  return names.map((key) => MAC_KEYS[key.toLowerCase()] ?? titled(key)).join("");
}

/** A string field of a tool's input, or "" when it is missing or not a string. */
export function field(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  return typeof value === "string" ? value : "";
}
