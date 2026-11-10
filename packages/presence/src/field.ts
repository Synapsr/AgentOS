/**
 * The shape the shader draws, on the CPU: the same distance function as
 * `webgl.ts`, line for line.
 * Tests measure area, pinholes and pops with it, and a port to another GPU
 * language (Metal) checks itself against it.
 *
 * The body is the three drops as capsules, melted into one with a smooth
 * minimum (after Inigo Quilez) whose radius is `light.merge`, inside a space
 * that wobbles a little like the surface of a liquid.
 */

import type { Frame, Pill } from "./model.js";

/** A pill as the shader takes it: centre, half the length of its spine, radius, and the direction of its spine. */
export interface Capsule {
  x: number;
  y: number;
  half: number;
  radius: number;
  cos: number;
  sin: number;
}

/** Writes `pill` as a capsule into `out`. */
export function capsule(pill: Pill, out: Capsule): Capsule {
  const radius = Math.min(pill.w, pill.h) / 2;
  const along = (pill.angle ?? 0) + (pill.w >= pill.h ? 0 : Math.PI / 2);
  out.x = pill.x;
  out.y = pill.y;
  out.half = Math.max(pill.w, pill.h) / 2 - radius;
  out.radius = radius;
  out.cos = Math.cos(along);
  out.sin = Math.sin(along);
  return out;
}

/** Distance from (x, y) to a capsule's edge, negative inside. */
function distance(c: Capsule, x: number, y: number): number {
  const dx = x - c.x, dy = y - c.y;
  let qx = c.cos * dx + c.sin * dy;
  const qy = c.cos * dy - c.sin * dx;
  qx -= Math.min(c.half, Math.max(-c.half, qx));
  return Math.hypot(qx, qy) - c.radius;
}

/** The polynomial smooth minimum: two edges closer than `k` melt into one. */
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The rates, in radians a second, of the wobble's two waves. Shared with the shader. */
export const WOBBLE = [1.3, 0.9] as const;

/** The shape of one frame, ready to be sampled many times. */
export interface Shape {
  /** Signed distance from (x, y) — pixels from the centre of the stage, y down — to the edge of the body, negative inside. */
  distance(x: number, y: number): number;
  /** How much of the pixel at (x, y) the figure covers, 0–1: the body's opacity as the shader draws it. */
  coverage(x: number, y: number, pixel?: number): number;
}

/** The shape `frame` draws, as the shader sees it. */
export function shape(frame: Frame): Shape {
  const caps = [frame.drops[0], frame.drops[1], frame.drops[2]].map((pill) => capsule(pill, { x: 0, y: 0, half: 0, radius: 0, cos: 1, sin: 0 }));
  const [c0, c1, c2] = caps as [Capsule, Capsule, Capsule];
  const u = frame.size / 2, { wobble, merge, time } = frame.light;
  const a = WOBBLE[0] * time, b = WOBBLE[1] * time;
  const k = Math.max(merge, 1e-3);
  const drops = (x: number, y: number) => smin(smin(distance(c0, x, y), distance(c1, x, y), k), distance(c2, x, y), k);
  const self: Shape = {
    distance(x, y) {
      const d = drops(x, y);
      // The liquid surface: space sways a little before the drops are measured — near the edge, where it shows.
      if (wobble <= 0 || Math.abs(d) > 3 * wobble + 2) return d;
      const sx = x / u, sy = y / u;
      return drops(x + wobble * Math.sin(sy * 2.6 + a + 0.8 * Math.sin(sx * 1.9 + b)), y + wobble * Math.sin(sx * 2.3 + b + 0.8 * Math.sin(sy * 2.1 - a)));
    },
    coverage(x, y, pixel = 1) {
      return Math.min(1, Math.max(0, 0.5 - self.distance(x, y) / pixel));
    },
  };
  return self;
}
