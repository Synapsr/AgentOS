import { describe, expect, it } from "vitest";
import { dependsOnLayout, isQuitShortcut, type KeyboardLayout, localizeCombo, usesCommand } from "../src/keyboard.js";
import { raw } from "./fixtures.js";

/** The layout macOS reported on a French (AZERTY) keyboard. */
const french: KeyboardLayout = JSON.parse(raw("layout-french"));
/** A US keyboard: every key types its own name. */
const us: KeyboardLayout = Object.fromEntries(Object.keys(french).map((name) => [name, [name, name.toUpperCase()]]));
/** A layout without Latin letters. */
const russian: KeyboardLayout = { ...us, c: ["с", "С"], a: ["ф", "Ф"] };

describe("localizeCombo", () => {
  it("leaves a US keyboard alone", () => {
    expect(localizeCombo("cmd+a", us)).toEqual({ keys: "cmd+a", force: false });
    expect(localizeCombo("Cmd + Shift + Z", us)).toEqual({ keys: "cmd+shift+z", force: false });
    expect(localizeCombo("8", us)).toEqual({ keys: "8", force: false });
  });

  it("names the key that types the letter on a French keyboard", () => {
    expect(localizeCombo("cmd+z", french)).toEqual({ keys: "cmd+w", force: false });
    expect(localizeCombo("cmd+w", french)).toEqual({ keys: "cmd+z", force: false });
    expect(localizeCombo("cmd+c", french)).toEqual({ keys: "cmd+c", force: false });
  });

  it("forces the key agent-desktop mistakes for a quit shortcut", () => {
    // Unrewritten, "cmd+a" quits the app on a French keyboard: observed with Calculator.
    expect(localizeCombo("cmd+a", french)).toEqual({ keys: "cmd+q", force: true });
    expect(localizeCombo("cmd+shift+a", french)).toEqual({ keys: "cmd+shift+q", force: true });
    expect(localizeCombo("a", french)).toEqual({ keys: "q", force: false });
  });

  it("adds Shift for digits that need it, but keeps shortcuts on their key", () => {
    expect(localizeCombo("8", french)).toEqual({ keys: "shift+8", force: false });
    expect(localizeCombo("cmd+1", french)).toEqual({ keys: "cmd+1", force: false });
  });

  it("treats a bare capital as Shift plus the letter", () => {
    expect(localizeCombo("A", french)).toEqual({ keys: "shift+q", force: false });
  });

  it("gives up when no nameable key types the letter", () => {
    // French M sits on a key agent-desktop has no name for; the US position types a comma.
    expect(localizeCombo("cmd+m", french)).toBeUndefined();
  });

  it("keeps the US position on layouts without Latin letters, as macOS does", () => {
    expect(localizeCombo("cmd+c", russian)).toEqual({ keys: "cmd+c", force: false });
  });
});

describe("dependsOnLayout", () => {
  it("is true only for letters and digits", () => {
    expect(["a", "cmd+A", "ctrl + 7"].map(dependsOnLayout)).toEqual([true, true, true]);
    expect(["return", "cmd+f5", "shift+tab", "cmd+,", ""].map(dependsOnLayout)).toEqual([false, false, false, false, false]);
  });
});

describe("usesCommand", () => {
  it("is true when Cmd is held, under any of its names", () => {
    expect(["cmd+s", "Command+Shift+Z", "ctrl+meta+f"].map(usesCommand)).toEqual([true, true, true]);
    expect(["return", "shift+tab", "ctrl+a", "alt+left", "cmd"].map(usesCommand)).toEqual([false, false, false, false, false]);
  });
});

describe("isQuitShortcut", () => {
  const quits = (platform: string) => (keys: string) => isQuitShortcut(keys, platform);

  it("recognises Cmd+Q on a Mac, whatever else is held", () => {
    expect(["cmd+q", "Cmd+Shift+Q", "ctrl+command+q", "meta + q"].map(quits("darwin"))).toEqual([true, true, true, true]);
    expect(["q", "ctrl+q", "cmd+a", "cmd+w", "alt+f4"].map(quits("darwin"))).toEqual([false, false, false, false, false]);
  });

  it("recognises Ctrl+Q and Alt+F4 elsewhere", () => {
    expect(["ctrl+q", "Ctrl+Shift+Q", "alt+f4", "ctrl+alt+F4"].map(quits("win32"))).toEqual([true, true, true, true]);
    expect(["q", "f4", "ctrl+a", "ctrl+w", "alt+f5"].map(quits("linux"))).toEqual([false, false, false, false, false]);
  });
});
