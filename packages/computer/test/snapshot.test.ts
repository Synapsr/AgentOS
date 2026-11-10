import { describe, expect, it } from "vitest";
import { agentDesktopBackend } from "../src/agent-desktop.js";
import type { UiNode, UiSnapshot } from "../src/backend.js";
import { renderSnapshot } from "../src/snapshot.js";
import { data } from "./fixtures.js";

const calculator = (): Promise<UiSnapshot> => agentDesktopBackend(async () => data("snapshot")).snapshot({ app: "Calculatrice" });

const window = (children: UiNode[], extra: Partial<UiSnapshot> = {}): UiSnapshot => ({
  app: "Notes",
  tree: { role: "window", name: "Notes", children },
  complete: true,
  ...extra,
});

describe("renderSnapshot", () => {
  it("renders a real window as one readable line per element", async () => {
    const lines = renderSnapshot(await calculator()).split("\n");
    expect(lines.slice(0, 6)).toEqual([
      'Calculatrice — window "Calculatrice" (w-256257)',
      'window "Calculatrice"',
      '  scrollarea "Champ d’édition" @s1q45leq1aoz2r:e1',
      '    text "8"',
      '  button "Supprimer" @s1q45leq1aoz2r:e2',
      '  button "Effacer" @s1q45leq1aoz2r:e3',
    ]);
    expect(lines).toContain('  button "Zoom" @s1q45leq1aoz2r:e25 (disabled)');
    // The header, the window, 26 elements with a ref and the text on the display.
    expect(lines).toHaveLength(29);
  });

  it("drops wrappers that carry no information and the invisible marks around numbers", async () => {
    const text = renderSnapshot(await calculator());
    expect(text).not.toMatch(/^\s*group\s*$/m);
    expect(text).not.toMatch(/[\u200e\u200f]/);
  });

  it("shows a value next to the name only when it adds something", () => {
    const text = renderSnapshot(
      window([
        { role: "textfield", name: "Title", value: "Groceries", ref: "@s1:e1", states: ["focused"] },
        { role: "statictext", name: "Milk", value: "Milk" },
        { role: "checkbox", value: "1", ref: "@s1:e2" },
      ]),
    );
    expect(text.split("\n").slice(2)).toEqual(['  textfield "Title" = "Groceries" @s1:e1 (focused)', '  text "Milk"', '  checkbox = "1" @s1:e2']);
  });

  it("shortens long text and keeps it on one line", () => {
    const text = renderSnapshot(window([{ role: "textfield", value: `first line\nsecond ${"x".repeat(400)}`, ref: "@s1:e1" }]));
    const field = text.split("\n")[2] ?? "";
    expect(field).toMatch(/^ {2}textfield = "first line second x+… \(\+258 more characters\)" @s1:e1$/);
  });

  it("cuts a huge tree and says how to read the rest", () => {
    const rows = Array.from({ length: 500 }, (_, index): UiNode => ({ role: "button", name: `Row ${index}`, ref: `@s1:e${index}` }));
    const lines = renderSnapshot(window(rows)).split("\n");
    expect(lines).toHaveLength(302);
    expect(lines.at(-1)).toMatch(/^… 201 more lines not shown\..*root.*interactive_only/);
  });

  it("flags branches that were not read and partial trees", () => {
    const text = renderSnapshot(window([{ role: "list", name: "Messages", ref: "@s1:e1", hidden: 40 }], { complete: false }));
    expect(text).toContain('list "Messages" @s1:e1 … 40 children not read');
    expect(text).toContain("Some branches were not read");
    expect(text).toContain("this tree is partial");
  });
});
