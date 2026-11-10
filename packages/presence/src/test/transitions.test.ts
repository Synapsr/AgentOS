import { describe, expect, it } from "vitest";
import { shape } from "../field.js";
import { presence, STATES, type Frame, type PresenceState } from "../model.js";
import { createMotion, inputOf, stepMotion } from "../motion.js";
import { lightness } from "../palette.js";

const SIZE = 240, U = SIZE / 2;
const voiced = (s: PresenceState) => s === "listening" || s === "speaking";

/** Every change of state, on the real springs: `from` held 2.4 s, then `to` for 1.2 s, sampled `rate` times a second. */
function film(from: PresenceState, to: PresenceState, rate: number, seconds = 1.2): Frame[] {
  const motion = createMotion(from, SIZE);
  for (let i = 0; i < 2.4 * rate; i++) stepMotion(motion, { state: from, size: SIZE, level: voiced(from) ? 0.5 : 0 }, 1 / rate);
  const frames: Frame[] = [];
  for (let i = 0; i <= seconds * rate; i++) {
    if (i) stepMotion(motion, { state: to, size: SIZE, level: voiced(to) ? 0.5 : 0 }, 1 / rate);
    frames.push(presence(inputOf(motion, SIZE)));
  }
  return frames;
}

/** The figure on a grid of `step`-pixel cells over the canvas (1.25 stages): each cell's coverage, as the shader draws it. */
function raster(frame: Frame, step: number): { cells: Float32Array; side: number } {
  const f = shape(frame);
  const half = 1.25 * U, side = Math.ceil((2 * half) / step);
  const cells = new Float32Array(side * side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) cells[j * side + i] = f.coverage(-half + (i + 0.5) * step, -half + (j + 0.5) * step, step);
  return { cells, side };
}

/** The uncovered patches that the figure surrounds entirely (eight-connected), as their sizes in cells. */
function enclosed({ cells, side }: { cells: Float32Array; side: number }): number[] {
  const seen = new Uint8Array(side * side), sizes: number[] = [];
  for (let start = 0; start < side * side; start++) {
    if (seen[start] || cells[start]! >= 0.5) continue;
    let size = 0, open = false;
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const c = queue.pop()!, x = c % side, y = (c - x) / side;
      size++;
      if (x === 0 || y === 0 || x === side - 1 || y === side - 1) open = true;
      // Eight neighbours: a notch open to the outside only through a corner is still open.
      for (const n of [c - 1, c + 1, c - side, c + side, c - side - 1, c - side + 1, c + side - 1, c + side + 1]) {
        if (n < 0 || n >= side * side || seen[n] || Math.abs((n % side) - x) > 1 || cells[n]! >= 0.5) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    if (!open) sizes.push(size);
  }
  return sizes;
}

const area = ({ cells }: { cells: Float32Array }, step: number) => cells.reduce((sum, c) => sum + c, 0) * step * step;

describe("every change of state", () => {
  const pairs = STATES.flatMap((from) => STATES.filter((to) => to !== from).map((to) => [from, to] as const));

  it("covers all thirty", () => expect(pairs).toHaveLength(30));

  it("never shows a pinhole, never grows or shrinks by much in one frame, and never pops", { timeout: 180_000 }, () => {
    const STEP = 2;
    let fastest = 0, spike = 0, where = "", popped = "none";
    for (const [from, to] of pairs) {
      const areas: number[] = [];
      for (const [i, frame] of film(from, to, 60).entries()) {
        const grid = raster(frame, STEP);
        // A hole in the body is either the listening ring, opening wide, or nothing: no speck, no sliver between three drops.
        for (const cells of enclosed(grid)) {
          const radius = Math.sqrt((cells * STEP * STEP) / Math.PI) / U;
          expect(radius, `${from} → ${to}, frame ${i}: a hole of ${cells} cells`).toBeGreaterThan(0.1);
        }
        areas.push(area(grid, STEP));
      }
      // Against the larger of the two figures: a thin dash growing into a body is a movement, not a pop.
      const whole = Math.max(...areas);
      const steps = areas.slice(1).map((a, i) => Math.abs(a - areas[i]!) / whole);
      steps.forEach((step, i) => {
        if (step > fastest) [fastest, where] = [step, `${from} → ${to} at ${Math.round(((i + 1) * 1000) / 60)} ms`];
        // A pop is one frame that changes far more — over twice as much — as either frame around it.
        const around = 2 * Math.max(steps[i - 1] ?? step, steps[i + 1] ?? step);
        if (step - around > spike) [spike, popped] = [step - around, `${from} → ${to} at ${Math.round(((i + 1) * 1000) / 60)} ms`];
      });
    }
    // A change that doubles the figure in a third of a second peaks near 13 % a frame: that is the morph itself.
    expect(fastest, where).toBeLessThan(0.15);
    // Before: membranes and holes popped 8–10 % of the figure in a single frame, out of step with the frames around it.
    expect(spike, popped).toBeLessThan(0.01);
    console.info(`fastest frame ${(100 * fastest).toFixed(1)} % (${where}); largest one-frame spike ${(100 * spike).toFixed(2)} % (${popped})`);
  });

  it("keeps every drop's velocity continuous: it may turn and brake, never jolt", () => {
    const RATE = 1200;
    for (const [from, to] of pairs) {
      const frames = film(from, to, RATE, 0.5);
      let before: number[] | null = null;
      for (let i = 1; i < frames.length; i++) {
        const v = [0, 1, 2].flatMap((k) => [(frames[i]!.drops[k]!.x - frames[i - 1]!.drops[k]!.x) * RATE / U, (frames[i]!.drops[k]!.y - frames[i - 1]!.drops[k]!.y) * RATE / U]);
        if (before) {
          // Stage units a second, per second: a spring at full pull is a few hundred; a jump in velocity would be thousands.
          const pull = Math.max(...v.map((x, j) => Math.abs(x - before![j]!) * RATE));
          expect(pull, `${from} → ${to} at ${(i / RATE).toFixed(4)} s`).toBeLessThan(500);
        }
        before = v;
      }
    }
  });

  it("travels between two colours through light, never through mud or mauve", () => {
    for (const [from, to] of pairs) {
      if (from === "offline" || to === "offline") continue;
      const frames = film(from, to, 60);
      for (const channel of ["from", "to"] as const) {
        const least = Math.min(lightness(frames[0]![channel]).L, lightness(frames.at(-1)![channel]).L);
        for (const frame of frames) {
          const { L, C, h } = lightness(frame[channel]);
          expect(L, `${from} → ${to}`).toBeGreaterThan(least - 0.02);
          // Mauve, pink and violet (OKLab hues −70° to 25°): the hues of no state.
          if (C > 0.03) expect(h > -70 && h < 25, `${from} → ${to}: hue ${h.toFixed(0)}°`).toBe(false);
        }
      }
    }
  });
});

/** A repeatable offset in 0–1 for a cell. */
const jitter = (i: number, j: number, c: number) => {
  const h = Math.sin(i * 127.1 + j * 311.7 + c * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

/** The path renderer's figure on a grid: inside any pill, or inside any membrane (its curves flattened). */
function paths(frame: Frame, step: number): { cells: Float32Array; side: number } {
  // Only the box the figure can reach: its drops, and a margin for the membranes between them.
  const reach = Math.max(...frame.drops.map((d) => Math.max(Math.abs(d.x), Math.abs(d.y)) + Math.max(d.w, d.h) / 2)) + 0.1 * U;
  const half = Math.min(1.25 * U, reach), side = Math.ceil((2 * half) / step);
  const cells = new Float32Array(side * side);
  const polygons = frame.bridges
    .filter((b) => Math.abs(b[0]! - b[14]!) + Math.abs(b[1]! - b[15]!) >= 0.01)
    .map((b) => {
      const at = (i: number) => [b[2 * i]!, b[2 * i + 1]!] as const;
      const cubic = (p0: readonly number[], p1: readonly number[], p2: readonly number[], p3: readonly number[]) =>
        Array.from({ length: 13 }, (_, i) => {
          const t = i / 12, m = 1 - t;
          return [0, 1].map((c) => m * m * m * p0[c]! + 3 * m * m * t * p1[c]! + 3 * m * t * t * p2[c]! + t * t * t * p3[c]!);
        });
      return [...cubic(at(0), at(1), at(2), at(3)), ...cubic(at(4), at(5), at(6), at(7))];
    });
  const inPolygon = (poly: number[][], x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
    return inside;
  };
  const caps = frame.drops.map((d) => {
    const r = Math.min(d.w, d.h) / 2, along = (d.angle ?? 0) + (d.w >= d.h ? 0 : Math.PI / 2);
    return { x: d.x, y: d.y, r, half: Math.max(d.w, d.h) / 2 - r, c: Math.cos(along), s: Math.sin(along) };
  });
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      // A fixed jitter inside each cell: a long straight edge must not cross a whole row of samples at once.
      const x = -half + (i + jitter(i, j, 0)) * step, y = -half + (j + jitter(i, j, 1)) * step;
      const pill = caps.some((p) => {
        let qx = p.c * (x - p.x) + p.s * (y - p.y);
        const qy = p.c * (y - p.y) - p.s * (x - p.x);
        qx -= Math.min(p.half, Math.max(-p.half, qx));
        return qx * qx + qy * qy <= p.r * p.r;
      });
      cells[j * side + i] = pill || polygons.some((poly) => inPolygon(poly, x, y)) ? 1 : 0;
    }
  }
  return { cells, side };
}

describe("the path renderer (small sizes, no WebGL, the watch)", () => {
  it("never pops a membrane in or out", { timeout: 180_000 }, () => {
    const STEP = 1;
    let spike = 0, popped = "none";
    for (const from of STATES) {
      for (const to of STATES) {
        if (from === to) continue;
        const areas = film(from, to, 60).map((frame) => area(paths(frame, STEP), STEP));
        const whole = Math.max(...areas);
        const steps = areas.slice(1).map((a, i) => Math.abs(a - areas[i]!) / whole);
        steps.forEach((step, i) => {
          const around = 2 * Math.max(steps[i - 1] ?? step, steps[i + 1] ?? step);
          if (step - around > spike) [spike, popped] = [step - around, `${from} → ${to} at ${Math.round(((i + 1) * 1000) / 60)} ms`];
        });
      }
    }
    console.info(`path renderer: largest one-frame spike ${(100 * spike).toFixed(2)} % (${popped})`);
    expect(spike, popped).toBeLessThan(0.01);
  });
});
