import { describe, expect, it } from "vitest";
import { bridge, only, presence, STATES, tininess, type Blend, type Frame, type PresenceState } from "../model.js";
import { holeShown, tensor } from "./helpers.js";

/** Everything a frame draws, as plain numbers in stage units (colours 0–1), so that two frames can be compared. */
function numbers(frame: Frame): number[] {
  const u = frame.size / 2;
  return [
    ...frame.drops.flatMap((d) => tensor(d, u)),
    ...holeShown(frame),
    ...frame.glows.flatMap((g) => [g.x / u, g.y / u, g.r / u, g.alpha]),
    ...[...frame.from, ...frame.to, ...frame.halo].map((c) => c / 255),
  ];
}

const distance = (a: Frame, b: Frame) => {
  const x = numbers(a), y = numbers(b);
  return Math.max(...x.map((v, i) => Math.abs(v - y[i]!)));
};

/** A repeatable stream of numbers in 0–1. */
function random(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("presence", () => {
  it("is deterministic: the same input gives the same frame", () => {
    for (const state of STATES) {
      const input = { blend: only(state), time: 12.345, level: 0.6, size: 300 } as const;
      const first = presence(input);
      presence({ blend: only("working"), time: 99, size: 40 });
      expect(presence(input)).toEqual(first);
    }
  });

  it("always returns three drops, three bridges of eight points, one (closed) hole and three glows", () => {
    const frame = presence({ blend: only("working"), time: 1, size: 200 });
    expect(frame.drops).toHaveLength(3);
    expect(frame.glows).toHaveLength(3);
    expect(frame.bridges).toHaveLength(3);
    for (const b of frame.bridges) expect(b).toHaveLength(16);
  });

  it("moves continuously in time: no state ever jumps", { timeout: 120_000 }, () => {
    const dt = 1 / 240;
    for (const state of STATES) {
      for (const level of [0, 0.5, 1]) {
        // Two full glance cycles and many hops, loops and breaths.
        for (let t = 0; t < 20; t += dt) {
          const a = presence({ blend: only(state), time: t, level, size: 400 });
          const b = presence({ blend: only(state), time: t + dt, level, size: 400 });
          // Nothing travels faster than 6 stage units a second.
          expect(distance(a, b), `${state} at ${t.toFixed(3)} s`).toBeLessThan(6 * dt);
        }
      }
    }
  });

  it("moves continuously with the blend: any two states morph, never cut", { timeout: 120_000 }, () => {
    for (const from of STATES) {
      for (const to of STATES) {
        if (from === to) continue;
        let last: Frame | null = null;
        for (let i = 0; i <= 400; i++) {
          const p = i / 400;
          const blend = { ...only(from), [from]: 1 - p, [to]: p } as Blend;
          const frame = presence({ blend, time: 3.21, level: 0.7, size: 400 });
          // A cut would be a step of 0.1 or more; a morph spreads its travel over the 400 steps.
          if (last) expect(distance(last, frame), `${from} → ${to} at ${p}`).toBeLessThan(0.02);
          last = frame;
        }
      }
    }
  });

  it("moves continuously with the voice level and with the size", { timeout: 120_000 }, () => {
    for (const state of ["listening", "speaking"] as const) {
      for (let i = 0; i < 200; i++) {
        const a = presence({ blend: only(state), time: 2, level: i / 200, size: 300 });
        const b = presence({ blend: only(state), time: 2, level: (i + 1) / 200, size: 300 });
        expect(distance(a, b)).toBeLessThan(2 / 200);
      }
    }
    for (const state of STATES) {
      for (let size = 16; size < 120; size += 0.25) {
        const a = presence({ blend: only(state), time: 2, level: 0.5, size });
        const b = presence({ blend: only(state), time: 2, level: 0.5, size: size + 0.25 });
        expect(distance(a, b), `${state} at ${size} px`).toBeLessThan(0.02);
      }
    }
  });

  it("stays bounded, whatever it is given", { timeout: 120_000 }, () => {
    const next = random(7);
    for (let i = 0; i < 4000; i++) {
      // Blends as a spring would overshoot them, wild levels, every size.
      const blend = Object.fromEntries(STATES.map((s) => [s, next() * 1.5 - 0.25])) as Blend;
      const size = 12 + next() ** 3 * 1500;
      const frame = presence({ blend, time: next() * 1000, level: next() * 1.4 - 0.2, size, theme: next() < 0.5 ? "dark" : "light", calm: next() < 0.2 });
      const u = size / 2, edge = u * 1.000001;
      for (const value of numbers(frame)) expect(Number.isFinite(value)).toBe(true);
      for (const d of frame.drops) {
        expect(d.w).toBeGreaterThan(0);
        expect(d.h).toBeGreaterThan(0);
        // A turned pill reaches as far as its spine's ends plus its radius.
        const r = Math.min(d.w, d.h) / 2, half = Math.max(d.w, d.h) / 2 - r, along = (d.angle ?? 0) + (d.w >= d.h ? 0 : Math.PI / 2);
        expect(Math.abs(d.x) + half * Math.abs(Math.cos(along)) + r).toBeLessThanOrEqual(edge);
        expect(Math.abs(d.y) + half * Math.abs(Math.sin(along)) + r).toBeLessThanOrEqual(edge);
      }
      expect(frame.hole.w).toBeLessThan(frame.drops[0].w);
      expect(frame.hole.h).toBeLessThan(frame.drops[0].h);
      for (const g of frame.glows) {
        expect(g.alpha).toBeGreaterThanOrEqual(0);
        expect(g.alpha).toBeLessThanOrEqual(1);
        expect(g.r).toBeGreaterThanOrEqual(0);
        // The glow never leaves the canvas, a square 1.25 stages wide.
        expect(Math.max(Math.abs(g.x), Math.abs(g.y)) + g.r).toBeLessThanOrEqual(1.25 * edge);
      }
      for (const b of frame.bridges) for (const v of b) expect(Math.abs(v)).toBeLessThan(2 * size);
      for (const c of [...frame.from, ...frame.to, ...frame.halo]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it("gives each state a shape of its own", () => {
    const at = (state: PresenceState, level = 0) => presence({ blend: only(state), time: 4, level, size: 400 });
    const spread = (f: Frame) => Math.max(...f.drops.map((d) => Math.hypot(d.x - f.drops[0].x, d.y - f.drops[0].y))) / (f.size / 2);
    const u = 200;

    // Idle: one round body — a liquid one, never more than a few per cent from a circle; the others are inside it.
    const idle = at("idle");
    expect(Math.abs(idle.drops[0].w - idle.drops[0].h) / idle.drops[0].w).toBeLessThan(0.06);
    expect(spread(idle)).toBeLessThan(0.4);
    expect(idle.hole.w).toBe(0);
    expect(idle.hole.h).toBe(0);

    // Working: three separate drops.
    expect(spread(at("working"))).toBeGreaterThan(0.5);

    // Waiting: the small drop is straight above the body, clear of it.
    const waiting = at("waiting");
    expect(Math.abs(waiting.drops[2].x)).toBeLessThan(0.5);
    expect(waiting.drops[2].y + waiting.drops[2].h / 2).toBeLessThan(waiting.drops[0].y - waiting.drops[0].h / 2);

    // No state opens a hole any more.
    for (const state of STATES) expect(at(state, 1).hole.w).toBe(0);

    // Listening: one body, gathered, clearly wider than it is tall — unlike idle's round one — and larger with a voice.
    const quiet = at("listening", 0), loud = at("listening", 1);
    expect(spread(quiet)).toBeLessThan(0.6);
    expect(quiet.drops[0].w / quiet.drops[0].h).toBeGreaterThan(1.1);
    expect(loud.drops[0].w).toBeGreaterThan(quiet.drops[0].w * 1.15);

    // Speaking: a row of three round drops, small · big · small, apart when quiet.
    const speaking = at("speaking", 0.2);
    expect(speaking.drops[1].x).toBeLessThan(-0.3 * u);
    expect(speaking.drops[2].x).toBeGreaterThan(0.3 * u);
    for (const d of speaking.drops) expect(Math.abs(d.w - d.h) / d.w).toBeLessThan(0.1);
    expect(speaking.drops[0].w).toBeGreaterThan(speaking.drops[1].w);

    // Offline: flat, grey, and perfectly still.
    const offline = at("offline");
    expect(offline.drops[0].h).toBeLessThan(offline.drops[0].w / 4);
    expect(offline.glows.every((g) => g.alpha === 0)).toBe(true);
    const later = presence({ blend: only("offline"), time: 123, level: 1, size: 400 });
    // Nothing that is drawn depends on time: only the clock itself moves.
    expect({ ...later, light: { ...later.light, time: 0, flow: 0 } }).toEqual({ ...offline, light: { ...offline.light, time: 0, flow: 0 } });
  });

  it("simplifies when tiny: no glow, nothing thinner than two pixels", () => {
    expect(tininess(16)).toBe(1);
    expect(tininess(600)).toBe(0);
    for (const state of STATES) {
      for (const size of [16, 20, 24]) {
        const frame = presence({ blend: only(state), time: 4, level: 0.4, size });
        expect(frame.glows.every((g) => g.alpha === 0)).toBe(true);
        for (const d of frame.drops) expect(Math.min(d.w, d.h)).toBeGreaterThanOrEqual(2 - 1e-9);
      }
    }
  });

  it("keeps the shapes and drops the travel in calm mode", () => {
    for (const state of STATES) {
      const first = presence({ blend: only(state), time: 0, level: 0.5, size: 300, calm: true });
      for (let t = 0; t < 12; t += 0.37) {
        const frame = presence({ blend: only(state), time: t, level: 0.5, size: 300, calm: true });
        frame.drops.forEach((d, k) => {
          expect(d.x).toBeCloseTo(first.drops[k]!.x, 6);
          expect(d.y).toBeCloseTo(first.drops[k]!.y, 6);
        });
      }
    }
    // Still recognisable: three drops apart when working, a raised drop when waiting.
    const working = presence({ blend: only("working"), time: 1, size: 300, calm: true });
    expect(Math.hypot(working.drops[1].x - working.drops[0].x, working.drops[1].y - working.drops[0].y)).toBeGreaterThan(90);
  });

  it("uses ink and no glow on a light surface", () => {
    const frame = presence({ blend: only("idle"), time: 1, size: 300, theme: "light" });
    expect(Math.max(...frame.from)).toBeLessThan(80);
    expect(frame.glows.every((g) => g.alpha === 0)).toBe(true);
  });
});

describe("bridge", () => {
  const area = (b: number[]) => {
    // Shoelace over the eight points: good enough to tell "some" from "none".
    let sum = 0;
    for (let i = 0; i < 16; i += 2) sum += b[i]! * b[(i + 3) % 16]! - b[(i + 2) % 16]! * b[i + 1]!;
    return Math.abs(sum) / 2;
  };

  it("has no area when the circles are far apart, concentric, or one inside the other", () => {
    expect(area(bridge(0, 0, 10, 100, 0, 10))).toBe(0);
    expect(area(bridge(0, 0, 10, 0, 0, 10))).toBe(0);
    expect(area(bridge(0, 0, 10, 2, 0, 4))).toBe(0);
    expect(area(bridge(0, 0, 4, 2, 0, 10))).toBe(0);
  });

  it("joins circles that are close", () => {
    expect(area(bridge(0, 0, 10, 22, 0, 10))).toBeGreaterThan(10);
    expect(area(bridge(0, 0, 10, 15, 0, 6))).toBeGreaterThan(10);
  });

  it("grows and shrinks without a jump as the circles approach and fuse", () => {
    let last = bridge(0, 0, 10, 40, 0, 6);
    for (let d = 40; d > 0; d -= 0.01) {
      const next = bridge(0, 0, 10, d, 0, 6);
      // Where two circles start to cross, the crossing points part like a square root: steep, but never a jump.
      const step = Math.max(...next.map((v, i) => Math.abs(v - last[i]!)));
      expect(step, `at distance ${d.toFixed(2)}`).toBeLessThan(1);
      last = next;
    }
  });
});
