// Real-machine check of the text tools, against our own throwaway app (TypingApp.swift).
// It drives the built package the way the agent would and fails loudly on any mismatch.
// macOS only; needs the Accessibility permission for whatever launches it.
//
//   swiftc -O -o "$TMPDIR/AgentOSTypingTest" test/typing-app/TypingApp.swift
//   pnpm build && node test/typing-app/check.mjs "$TMPDIR/AgentOSTypingTest"
//
// It never touches another app and never writes to the clipboard.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createComputer } from "../../dist/index.js";

const executable = process.argv[2];
if (!executable) throw new Error("usage: node check.mjs <path to the compiled TypingApp>");
const APP = basename(executable);
const FRENCH = "Élève, ça va ? Où est l’œuf — à Noël 🎉";

const stateDir = mkdtempSync(join(tmpdir(), "agentos-typing-check-"));
const computer = createComputer({ stateDir });
const ctx = { signal: new AbortController().signal, threadId: "check" };

/** Calls a tool and returns its text, printing both like a transcript. */
async function call(name, input = {}) {
  const tool = computer.tools().find((candidate) => candidate.name === `computer_${name}`);
  const result = await tool.run(input, ctx);
  const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  console.log(`> computer_${name} ${JSON.stringify(input)}${result.isError ? "  [isError]" : ""}\n${text.replace(/^/gm, "    ")}`);
  return { text, isError: result.isError === true };
}

/** A fresh snapshot, with what the model needs from it: the two fields' refs and values. */
async function look() {
  let { text, isError } = await call("snapshot", { app: APP });
  // Someone else may be using this computer and switch away: do what the error message says.
  if (isError) {
    await call("open_app", { app: APP });
    ({ text } = await call("snapshot", { app: APP }));
  }
  const field = (title) => {
    const line = text.split("\n").find((candidate) => candidate.includes(`textfield "${title}"`)) ?? "";
    return { ref: line.match(/(@s\w+:e\d+)(?: \(.*\))?$/)?.[1], value: JSON.parse(line.match(/ = ("(?:[^"\\]|\\.)*")/)?.[1] ?? '""') };
  };
  return { single: field("Single line"), multi: field("Multi line") };
}

const app = spawn(executable, [], { stdio: "ignore" });
const exited = new Promise((resolve) => app.once("exit", resolve));
try {
  // The app is not installed, so it is started here; once it runs, computer_open_app can raise it.
  for (let attempt = 0; attempt < 20 && (await call("open_app", { app: APP })).isError; attempt++) await sleep(250);

  let { single, multi } = await look();
  assert.ok(single.ref && multi.ref, "both fields have a ref");
  const click = computer.tools().find((tool) => tool.name === "computer_click");
  assert.deepEqual(click.inspect({ ref: single.ref }), { target: "Single line" }, "the owner's line can name the field");

  // The single-line field has the keyboard focus at launch: text goes in at the cursor, twice in a row.
  await call("type", { ref: single.ref, text: "Bonjour" });
  await call("type", { ref: single.ref, text: " le monde" });
  assert.equal((await look()).single.value, "Bonjour le monde");

  // Replace, with accents, typographic punctuation and an emoji.
  await call("type", { ref: single.ref, text: FRENCH, replace: true });
  assert.equal((await look()).single.value, FRENCH);

  // The multi-line view, which does not have the focus: two lines, then replace.
  await call("type", { ref: multi.ref, text: "Première ligne\nDeuxième ligne" });
  assert.equal((await look()).multi.value, "Première ligne Deuxième ligne", "a snapshot shows a line break as a space");
  await call("type", { ref: multi.ref, text: FRENCH, replace: true });
  assert.equal((await look()).multi.value, FRENCH);

  // Clicking a text field moves the keyboard focus into it...
  await call("click", { ref: multi.ref });
  // ...which leaves the single-line field without a cursor: text is then added at its end.
  await call("type", { ref: single.ref, text: " Ça marche." });
  ({ single, multi } = await look());
  assert.equal(single.value, `${FRENCH} Ça marche.`);
  assert.equal(multi.value, FRENCH);

  // A shortcut inside the app: select everything in the focused view, then type over it.
  // (On a French keyboard an unrewritten "cmd+a" would arrive as Cmd+Q and quit the app.)
  // Apps only obey shortcuts while in front, so make sure this one is.
  await call("open_app", { app: APP });
  assert.equal((await call("press", { keys: "cmd+a", app: APP })).isError, false);
  await call("type", { ref: multi.ref, text: "remplacé" });
  ({ single, multi } = await look());
  assert.equal(multi.value, "remplacé", "Select All, then typing, replaces the text");
  assert.equal(single.value, `${FRENCH} Ça marche.`, "the other field is untouched");

  await call("close_app", { app: APP });
  assert.equal(await Promise.race([exited.then(() => "exited"), sleep(3000, "still running")]), "exited");
  console.log("\nAll typing checks passed.");
} finally {
  app.kill();
  await computer.close();
  rmSync(stateDir, { recursive: true, force: true });
}
