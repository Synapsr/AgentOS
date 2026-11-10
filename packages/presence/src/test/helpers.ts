import type { Frame, Pill } from "../model.js";

/**
 * A drop's shape as numbers that do not depend on how it is written: the
 * centre and its half-extent tensor, in stage units. A pill turned a quarter
 * with its sides swapped is the same shape, and gives the same numbers.
 */
export function tensor(d: Pill, u: number): number[] {
  const a = d.w / 2 / u, b = d.h / 2 / u, c = Math.cos(d.angle ?? 0), s = Math.sin(d.angle ?? 0);
  return [d.x / u, d.y / u, a * c * c + b * s * s, (a - b) * s * c, a * s * s + b * c * c];
}

/** The hole, in stage units: none is opened any more, but a frame still carries one. */
export const holeShown = (f: Frame): [number, number] => [f.hole.w / (f.size / 2), f.hole.h / (f.size / 2)];
