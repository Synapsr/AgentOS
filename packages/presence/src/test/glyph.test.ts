import { describe, expect, it } from "vitest";
import { glyph, type GlyphState } from "../glyph.js";
import type { Frame } from "../model.js";
import { toSVG } from "../svg.js";

const STATES: GlyphState[] = ["idle", "working", "waiting", "offline"];

/** The glyph as an 18 × 18 bitmap: which pixel centres are covered by a drop. */
function pixels(frame: Frame): boolean[] {
  const k = 18 / frame.size;
  const inside = (px: number, py: number) =>
    frame.drops.some((d) => {
      const r = Math.min(d.w, d.h) / 2;
      // Distance to the segment that is the pill's spine.
      const dx = Math.max(Math.abs(px - d.x) - (d.w / 2 - r), 0), dy = Math.max(Math.abs(py - d.y) - (d.h / 2 - r), 0);
      return Math.hypot(dx, dy) <= r;
    });
  return Array.from({ length: 18 * 18 }, (_, i) => inside(((i % 18) + 0.5 - 9) / k, (Math.floor(i / 18) + 0.5 - 9) / k));
}
const ink = (frame: Frame) => pixels(frame).filter(Boolean).length;
const box = (frame: Frame) => ({
  top: Math.min(...frame.drops.map((d) => d.y - d.h / 2)),
  bottom: Math.max(...frame.drops.map((d) => d.y + d.h / 2)),
  left: Math.min(...frame.drops.map((d) => d.x - d.w / 2)),
  right: Math.max(...frame.drops.map((d) => d.x + d.w / 2)),
});
const area = (b: readonly number[]) => {
  let sum = 0;
  for (let i = 0; i < 16; i += 2) sum += b[i]! * b[(i + 3) % 16]! - b[(i + 2) % 16]! * b[i + 1]!;
  return Math.abs(sum) / 2;
};

describe("glyph", () => {
  it("sits on the pixels of an 18 px box, with a pixel of margin", () => {
    for (const state of STATES) {
      const frame = glyph(state, 18);
      for (const d of frame.drops) {
        for (const edge of [d.x - d.w / 2, d.x + d.w / 2, d.y - d.h / 2, d.y + d.h / 2]) expect(Number.isInteger(edge), `${state}: ${edge}`).toBe(true);
        expect(Math.min(d.w, d.h)).toBeGreaterThanOrEqual(2);
      }
      const b = box(frame);
      expect(Math.max(-b.top, b.bottom, -b.left, b.right), state).toBeLessThanOrEqual(8);
    }
  });

  it("is the same drawing at every size", () => {
    for (const state of STATES) {
      const one = glyph(state, 18), two = glyph(state, 36);
      one.drops.forEach((d, k) => expect(two.drops[k]).toEqual({ x: d.x * 2, y: d.y * 2, w: d.w * 2, h: d.h * 2, angle: 0 }));
      expect(pixels(two)).toEqual(pixels(one));
    }
  });

  it("gives each state a silhouette of its own", () => {
    const shapes = STATES.map((state) => pixels(glyph(state, 18)));
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        // Pixels that are ink in one and not in the other: a quarter of the larger glyph at least.
        const differ = shapes[i]!.filter((on, p) => on !== shapes[j]![p]).length;
        const larger = Math.max(shapes[i]!.filter(Boolean).length, shapes[j]!.filter(Boolean).length);
        expect(differ / larger, `${STATES[i]} / ${STATES[j]}`).toBeGreaterThan(0.25);
      }
    }
    const idle = glyph("idle", 18), working = glyph("working", 18), waiting = glyph("waiting", 18), offline = glyph("offline", 18);
    // Idle: the mark, small — three drops of three sizes, the big and the middle one joined, the small one free.
    expect(idle.drops[0].w).toBeGreaterThan(idle.drops[1].w);
    expect(idle.drops[1].w).toBeGreaterThan(idle.drops[2].w);
    expect(area(idle.bridges[0])).toBeGreaterThan(0);
    expect(area(idle.bridges[1]) + area(idle.bridges[2])).toBe(0);
    // Working: three separate drops of three sizes, none joined to another.
    expect(working.drops[0].w).toBeGreaterThan(working.drops[1].w);
    expect(working.drops[1].w).toBeGreaterThan(working.drops[2].w);
    for (const b of working.bridges) expect(area(b)).toBe(0);
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
      const a = working.drops[i]!, c = working.drops[j]!;
      expect(Math.hypot(a.x - c.x, a.y - c.y) - a.w / 2 - c.w / 2).toBeGreaterThanOrEqual(1.5);
    }
    // Waiting: the small drop straight above the body, two clear pixels away.
    expect(waiting.drops[2].x).toBe(waiting.drops[0].x);
    expect(waiting.drops[0].y - waiting.drops[0].h / 2 - (waiting.drops[2].y + waiting.drops[2].h / 2)).toBe(2);
    // Offline: a dash.
    expect(offline.drops[0].w).toBeGreaterThanOrEqual(4 * offline.drops[0].h);
  });

  it("makes waiting the one that catches the eye: the tallest and the heaviest", () => {
    const tall = (state: GlyphState) => box(glyph(state, 18)).bottom - box(glyph(state, 18)).top;
    for (const state of ["idle", "working", "offline"] as const) {
      expect(tall("waiting")).toBeGreaterThan(tall(state));
      expect(ink(glyph("waiting", 18))).toBeGreaterThan(ink(glyph(state, 18)));
    }
    // And the quieter the state, the less ink: offline, idle, working, waiting.
    expect(ink(glyph("offline", 18))).toBeLessThan(ink(glyph("idle", 18)));
    expect(ink(glyph("idle", 18))).toBeLessThan(ink(glyph("working", 18)));
  });

  it("draws as a template image: one colour, no glow", () => {
    for (const state of STATES) {
      const svg = toSVG(glyph(state, 18), { fill: "#000", glow: false });
      expect(svg).toContain('viewBox="-9 -9 18 18"');
      expect(svg).not.toMatch(/Gradient|mask|opacity/);
      expect(svg.match(/fill="([^"]+)"/g)!.every((f) => f === 'fill="#000"')).toBe(true);
    }
  });
});
