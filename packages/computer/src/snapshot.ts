/**
 * Turns an accessibility tree into text a model can read cheaply:
 * one element per line, indented, with the ref it needs to act on it.
 */
import type { UiNode, UiSnapshot } from "./backend.js";

/** Lines of tree shown before cutting; a typical window fits several times over. */
const MAX_LINES = 300;
/** Longest name or value shown, so that one long document cannot use up the budget. */
const MAX_TEXT = 160;

// Direction marks that apps sprinkle around numbers: invisible, and they cost tokens.
const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A name or value as a person would read it: on one line, without invisible marks. */
export function plain(text: string): string {
  return text.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

function quote(text: string): string {
  const clean = plain(text);
  return JSON.stringify(clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT)}… (+${clean.length - MAX_TEXT} more characters)` : clean);
}

function describe(node: UiNode): string {
  const parts = [node.role === "statictext" ? "text" : node.role];
  if (node.name) parts.push(quote(node.name));
  if (node.value && node.value !== node.name) parts.push(`= ${quote(node.value)}`);
  if (node.ref) parts.push(node.ref);
  if (node.states?.length) parts.push(`(${node.states.join(", ")})`);
  if (node.hidden) parts.push(`… ${node.hidden} children not read`);
  return parts.join(" ");
}

/** A wrapper says nothing by itself: no label, no value, nothing to act on. */
const isWrapper = (node: UiNode) => !node.name && !node.value && !node.ref && !node.hidden;

/** The tree as indented text, cut after `maxLines` with a note on how to read the rest. */
export function renderSnapshot(snapshot: UiSnapshot, maxLines = MAX_LINES): string {
  const lines: string[] = [];
  let unread = false;
  const visit = (node: UiNode, depth: number): void => {
    // Wrappers are skipped and their children moved up: that is where most of the noise goes.
    const shown = depth === 0 || !isWrapper(node);
    if (shown) lines.push(`${"  ".repeat(depth)}${describe(node)}`);
    if (node.hidden) unread = true;
    for (const child of node.children ?? []) visit(child, shown ? depth + 1 : depth);
  };
  visit(snapshot.tree, 0);

  const where = snapshot.window ? ` — window ${quote(snapshot.window.title)} (${snapshot.window.id})` : "";
  const out = [`${snapshot.app || "Screen"}${where}`, ...lines.slice(0, maxLines)];
  if (lines.length > maxLines) {
    out.push(
      `… ${lines.length - maxLines} more lines not shown. To read one part in full, snapshot again with root set to the ref of its container; ` +
        "to list only the controls, set interactive_only.",
    );
  }
  if (unread) out.push("Some branches were not read: snapshot again with root set to that element's ref.");
  if (!snapshot.complete) out.push("The app answered slowly, so this tree is partial. Snapshot again, or use root to read one part.");
  return out.join("\n");
}
