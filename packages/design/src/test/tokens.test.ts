import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { color, motion, stage, stageSize, tokens } from "../tokens.js";

const script = fileURLToPath(new URL("../../scripts/generate.mjs", import.meta.url));
const source = JSON.parse(readFileSync(new URL("../../tokens.json", import.meta.url), "utf8"));

/** A colour as [r, g, b, alpha]. */
function parse(c: string): [number, number, number, number] {
  if (c.startsWith("#")) return [...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), 1] as [number, number, number, number];
  const [r, g, b, a = 1] = c.match(/[\d.]+/g)!.map(Number) as number[];
  return [r!, g!, b!, a];
}

/** `fg` (which may be translucent) painted over the opaque `bg`. */
function over(fg: string, bg: string): string {
  const [r, g, b, a] = parse(fg);
  const back = parse(bg);
  return "#" + [r, g, b].map((v, i) => Math.round(v * a + back[i]! * (1 - a)).toString(16).padStart(2, "0")).join("");
}

/** WCAG contrast ratio of `fg` (composited on `bg`) against `bg`. */
function contrast(fg: string, bg: string): number {
  const luminance = (c: string) => {
    const [x, y, z] = parse(c).slice(0, 3).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  const front = luminance(over(fg, bg));
  const behind = luminance(bg);
  return (Math.max(front, behind) + 0.05) / (Math.min(front, behind) + 0.05);
}

describe("tokens", () => {
  it("are what tokens.css, Tokens.swift and tokens.data.ts hold — run `pnpm build` after editing tokens.json", () => {
    // The generator compares what it would write with what is on disk, and fails when they differ.
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("give every colour a value in both appearances", () => {
    for (const [name, value] of Object.entries(source.color)) {
      if (name.startsWith("$")) continue;
      expect(Object.keys(value as object).filter((key) => !key.startsWith("$")), name).toEqual(["dark", "light"]);
    }
    for (const [old, now] of Object.entries(source.alias)) if (!old.startsWith("$")) expect(color.dark, old).toHaveProperty(now as string);
  });

  it("keep text readable (4.5:1) on every surface, in both appearances", () => {
    for (const appearance of ["dark", "light"] as const) {
      const c = color[appearance];
      const surfaces = [c["surface-stage"], c.surface, c["surface-raised"], c["surface-overlay"]];
      for (const surface of surfaces) {
        for (const name of ["text", "text-dim", "waiting", "careful", "working"] as const) {
          expect(contrast(c[name], surface), `${appearance}: ${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        // Checks are icons: 3:1 is the bar for graphics.
        expect(contrast(c.go, surface), `${appearance}: go on ${surface}`).toBeGreaterThanOrEqual(3);
        // A secondary button's label sits on its fill.
        expect(contrast(c.text, over(c.fill, surface)), `${appearance}: secondary button on ${surface}`).toBeGreaterThanOrEqual(4.5);
        // A careful button or banner writes in `careful` on a tint of itself, at rest and under the pointer.
        for (const fill of [c["careful-fill"], c["careful-fill-strong"]]) {
          expect(contrast(c.careful, over(fill, surface)), `${appearance}: careful on ${fill} over ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const fill of [c.primary, c["primary-top"], c["primary-bottom"]]) {
        expect(contrast(c["on-primary"], fill), `${appearance}: primary button label`).toBeGreaterThanOrEqual(4.5);
      }
      // The check on Go ahead is the one colour on the primary button.
      expect(contrast(c["primary-check"], c.primary), `${appearance}: check on the primary button`).toBeGreaterThanOrEqual(3);
    }
  });

  it("size the stage of every surface", () => {
    // OS mode on a 1440 × 900 window: 56 % of the height; while asking, 24 %: the request needs the room.
    expect(stageSize("os", { width: 1440, height: 900 })).toBe(504);
    expect(stageSize("os-asking", { width: 1440, height: 900 })).toBe(216);
    // Never more than its cap, on any screen; never wider than a narrow window allows.
    expect(stageSize("os", { width: 3840, height: 2160 })).toBe(600);
    expect(stageSize("os", { width: 400, height: 900 })).toBe(360);
    // A phone: 30 % of its height, down to 160 on a short one; a request leaves it 96.
    expect(stageSize("home", { width: 390, height: 844 })).toBe(253);
    expect(stageSize("home", { width: 375, height: 500 })).toBe(160);
    expect(stageSize("home", { width: 430, height: 1200 })).toBe(300);
    expect(stageSize("home-asking", { width: 390, height: 844 })).toBe(96);
    // A window: the smaller of 72 % of the presence's column and half the height, at most 440.
    expect(stageSize("home-beside", { width: 742, height: 800 })).toBe(400);
    expect(stageSize("home-beside", { width: 500, height: 800 })).toBe(360);
    expect(stageSize("home-beside", { width: 1200, height: 1400 })).toBe(440);
    // Fixed ones need no box.
    expect(stageSize("panel")).toBe(80);
    expect(stageSize("row")).toBe(32);
    expect(stageSize("inline")).toBe(24);
    for (const [name, rule] of Object.entries(stage)) {
      if (typeof rule === "number") continue;
      expect(rule.min, name).toBeLessThanOrEqual(rule.max);
      for (const height of [200, 667, 1080]) expect(Number.isInteger(stageSize(name as keyof typeof stage, { width: 800, height }))).toBe(true);
    }
  });

  it("put every length on the scale, and every target within reach", () => {
    for (const [name, value] of Object.entries(tokens.space)) expect(String(value)).toBe(name);
    expect(tokens.size.control).toBeGreaterThanOrEqual(44);
    for (const name of ["control-lg", "control-big", "control-xl", "row", "row-single"] as const) expect(tokens.size[name]).toBeGreaterThanOrEqual(44);
    // Nothing a person must read is under 15 px; label and caption are short tags.
    for (const [name, spec] of Object.entries(tokens.type)) if (name !== "label" && name !== "caption" && name !== "code") expect(spec.size, name).toBeGreaterThanOrEqual(15);
    // Pressed, a control shrinks a little, never more than to 0.95.
    expect(tokens.control.press).toBeGreaterThanOrEqual(0.95);
  });

  it("keep concentric corners: a card's corner is its inner corner plus the inset", () => {
    const { radius } = tokens;
    expect(radius.xl).toBe(radius.m + 12);
    expect(radius.xxl).toBe(radius.m + 20);
    expect(radius.l).toBe(radius.s + 12);
  });

  it("let colour and opacity never bounce", () => {
    expect(motion.spring.material.bounce).toBe(0);
    expect(motion.spring.snappy.bounce).toBe(0);
    for (const spring of Object.values(motion.spring)) expect(spring.bounce).toBeLessThan(0.5);
  });
});
