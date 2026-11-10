import { presence as TOKENS } from "@agentos/design";
import { describe, expect, it } from "vitest";
import { shape } from "../field.js";
import { gesturing, only, presence, STATES, type Frame, type PresenceInput, type PresenceState } from "../model.js";
import { createMotion, inputOf, pace, pulse, stepMotion, type Motion } from "../motion.js";
import { PALETTE, VIA } from "../palette.js";
import { tensor } from "./helpers.js";

const SIZE = 300, U = SIZE / 2;
const run = (motion: Motion, state: PresenceState, seconds: number, level = 0, calm = false, rate = 60) => {
  for (let i = 0; i < Math.round(seconds * rate); i++) stepMotion(motion, { state, level, calm, size: SIZE }, 1 / rate);
  return motion;
};
const frameOf = (motion: Motion, calm = false) => presence(inputOf(motion, SIZE, { calm }));
const hex = (c: readonly number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

describe("determinism", () => {
  it("gives the same frames for the same seed, and other gestures for another", () => {
    const at = (seed: number, t: number) => presence({ blend: only("idle"), time: t, size: SIZE, seed });
    let differ = 0;
    for (let t = 0; t < 60; t += 0.5) {
      expect(at(7, t)).toEqual(at(7, t));
      if (Math.abs(at(7, t).drops[2].x - at(8, t).drops[2].x) > 1) differ++;
    }
    expect(differ).toBeGreaterThan(5);
  });

  it("fills a frame in place exactly as it makes a new one", () => {
    const motion = createMotion("idle", SIZE, 3);
    let reused: Frame | undefined;
    const input = {} as PresenceInput;
    for (const state of ["working", "waiting", "listening", "speaking", "offline", "idle"] as const) {
      for (let i = 0; i < 40; i++) {
        stepMotion(motion, { state, level: 0.6, size: SIZE }, 1 / 60);
        reused = presence(inputOf(motion, SIZE, {}, input), reused);
        expect(reused).toEqual(presence(inputOf(motion, SIZE)));
      }
    }
  });
});

describe("idle", () => {
  it("never loops: its small gestures come every 7 to 14 s, at uneven intervals", () => {
    const starts: number[] = [];
    let was = false;
    for (let t = 0; t < 600; t += 0.05) {
      const now = gesturing("idle", t, 0, 5);
      if (now && !was) starts.push(t);
      was = now;
    }
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(6.9);
    expect(Math.max(...gaps)).toBeLessThan(14.2);
    expect(new Set(gaps.map((g) => g.toFixed(1))).size).toBeGreaterThan(gaps.length / 2);
    // The same instant of the old 9.6 s loop is never the same drawing.
    const a = presence({ blend: only("idle"), time: 20, size: SIZE }), b = presence({ blend: only("idle"), time: 29.6, size: SIZE });
    expect(Math.abs(a.drops[0].w - b.drops[0].w) + Math.abs(a.drops[0].x - b.drops[0].x)).toBeGreaterThan(0.5);
  });

  it("breathes visibly at a large size: the body is never still for long", () => {
    let still = 0, last = presence({ blend: only("idle"), time: 0, size: 240 });
    for (let i = 1; i <= 20 * 60; i++) {
      const frame = presence({ blend: only("idle"), time: i / 60, size: 240 });
      const moved = Math.max(...frame.drops.map((d, k) => Math.max(Math.abs(d.w - last.drops[k]!.w), Math.abs(d.h - last.drops[k]!.h), Math.hypot(d.x - last.drops[k]!.x, d.y - last.drops[k]!.y)))) * 60;
      if (moved < 5) still++;
      last = frame;
    }
    // Before: still 89 % of the time.
    expect(still / (20 * 60)).toBeLessThan(0.6);
  });
});

describe("matter", () => {
  it("stretches a travelling drop along its way and keeps its area", () => {
    const motion = run(createMotion("working", SIZE), "working", 3);
    const frame = frameOf(motion);
    const stretched = frame.drops.filter((d) => Math.abs(d.w - d.h) / Math.max(d.w, d.h) > 0.1);
    expect(stretched.length).toBeGreaterThan(0);
    const calm = presence(inputOf(motion, SIZE, { calm: true }));
    for (const d of calm.drops) expect(d.angle ?? 0).toBe(0);
  });

  it("anticipates a change: the body gathers for a moment before it moves", () => {
    const motion = run(createMotion("idle", SIZE), "idle", 2);
    const [, , xx0, , yy0] = tensor(frameOf(motion).drops[0], U);
    run(motion, "working", 0.07);
    const [, , xx, , yy] = tensor(frameOf(motion).drops[0], U);
    // Squashed: wider and less tall on screen, and the drops have hardly left yet.
    expect(xx! / yy!).toBeGreaterThan((xx0! / yy0!) * 1.02);
    expect(motion.blend[2].working).toBeLessThan(0.02);
  });
});

describe("waiting", () => {
  it("waves, then waits longer between waves when nobody answers", () => {
    const starts: number[] = [];
    let was = false;
    for (let t = 0; t < 400; t += 0.02) {
      const now = gesturing("waiting", t, 0);
      if (now && !was) starts.push(t);
      was = now;
    }
    const gap = (from: number) => {
      const i = starts.findIndex((t) => t > from);
      return starts[i + 1]! - starts[i]!;
    };
    expect(gap(5)).toBeCloseTo(4.8, 1);
    expect(gap(120)).toBeCloseTo(6.4, 1);
    expect(gap(330)).toBeCloseTo(9.6, 1);
  });

  it("raises the hand higher than it rests, then lowers it", () => {
    const hand = (t: number) => presence({ blend: only("waiting"), time: t, size: SIZE, asked: 0 }).drops[2].y;
    const rest = hand(3);
    expect(Math.min(...[0.6, 0.7, 0.8, 0.9].map((t) => hand(t)))).toBeLessThan(rest - 0.1 * U);
  });
});

describe("answers", () => {
  it("nods after “go ahead”: the body dips, then comes back", () => {
    const plain = run(createMotion("waiting", SIZE), "waiting", 3);
    const nodding = run(createMotion("waiting", SIZE), "waiting", 3);
    pulse(nodding, "approved");
    const dip = [0.1, 0.15, 0.2, 0.25].map((s) => {
      const a = createMotion("waiting", SIZE), b = createMotion("waiting", SIZE);
      run(a, "waiting", 3 + s);
      run(b, "waiting", 3);
      pulse(b, "approved");
      run(b, "waiting", s);
      return frameOf(b).drops[0].y - frameOf(a).drops[0].y;
    });
    expect(Math.max(...dip)).toBeGreaterThan(0.025 * U);
    run(plain, "waiting", 3.2);
    run(nodding, "waiting", 3.2);
    expect(Math.abs(frameOf(nodding).drops[0].y - frameOf(plain).drops[0].y)).toBeLessThan(0.002 * U);
  });

  it("lowers its hand slowly after “stop”, with no bounce", () => {
    const motion = run(createMotion("waiting", SIZE), "waiting", 3);
    pulse(motion, "denied");
    run(motion, "idle", 0.1);
    let highest = -Infinity;
    for (let i = 0; i < 90; i++) {
      run(motion, "idle", 1 / 60);
      highest = Math.max(highest, motion.blend[2].idle);
    }
    // The hand's spring has no bounce: it never goes past idle.
    expect(highest).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("lifts the offline dash once per reconnection attempt, then lies exactly still", () => {
    const motion = run(createMotion("offline", SIZE), "offline", 2);
    const still = frameOf(motion);
    expect(pace(motion)).toBe(0);
    pulse(motion, "retry");
    expect(pace(motion)).toBe(60);
    run(motion, "offline", 0.2);
    expect(frameOf(motion).drops[0].y).toBeLessThan(still.drops[0].y - 0.01 * U);
    run(motion, "offline", 3);
    const after = frameOf(motion);
    expect(after.drops).toEqual(still.drops);
    expect(pace(motion)).toBe(0);
  });

  it("does not move the figure in calm mode, only its light", () => {
    const plain = run(createMotion("waiting", SIZE), "waiting", 2, 0, true);
    const nod = run(createMotion("waiting", SIZE), "waiting", 2, 0, true);
    pulse(nod, "approved");
    run(plain, "waiting", 0.15, 0, true);
    run(nod, "waiting", 0.15, 0, true);
    expect(frameOf(nod, true).drops).toEqual(frameOf(plain, true).drops);
    expect(frameOf(nod, true).light.energy).toBeGreaterThan(frameOf(plain, true).light.energy);
  });
});

describe("the voice", () => {
  it("bounces each speaking drop on syllables, one after the other, and squashes it as it lands", () => {
    const motion = createMotion("speaking", SIZE);
    let highest = 0, squashed = 0, firstLift = [-1, -1, -1];
    for (let i = 0; i < 360; i++) {
      const t = i / 120;
      // A 120 ms syllable every 400 ms.
      stepMotion(motion, { state: "speaking", level: t % 0.4 < 0.12 ? 0.8 : 0.1, size: SIZE }, 1 / 120);
      motion.voice.lift.forEach((l, k) => {
        if (firstLift[k] === -1 && l > 0.04) firstLift[k] = t;
      });
      highest = Math.max(highest, motion.voice.lift[0]);
      const big = frameOf(motion).drops[0];
      squashed = Math.max(squashed, big.w / big.h);
    }
    expect(motion.voice.onset).toBeGreaterThan(1);
    expect(highest).toBeGreaterThan(0.08);
    // The middle drop goes first; the sides follow.
    expect(firstLift[0]).toBeLessThan(Math.min(firstLift[1]!, firstLift[2]!));
    // Landing: wider than tall for a moment.
    expect(squashed).toBeGreaterThan(1.05);
  });

  it("melts the speaking drops into one soft capsule when loud, and keeps three round dots when soft", () => {
    const between = (level: number) => {
      const motion = run(createMotion("speaking", SIZE), "speaking", 1.5, level);
      const frame = frameOf(motion);
      const f = shape(frame);
      // Half-way between the middle drop and the left one, on their line.
      const x = (frame.drops[0].x + frame.drops[1].x) / 2, y = (frame.drops[0].y + frame.drops[1].y) / 2;
      return f.coverage(x, y);
    };
    expect(between(0.95)).toBeGreaterThan(0.5);
    expect(between(0.15)).toBeLessThan(0.5);
    // No candy wrapper: loud, the three are the same height within a fifth, so the capsule has no side tabs.
    const loud = frameOf(run(createMotion("speaking", SIZE), "speaking", 1.5, 0.95)).drops;
    const tallest = Math.max(...loud.map((d) => d.h)), shortest = Math.min(...loud.map((d) => d.h));
    expect(shortest / tallest).toBeGreaterThan(0.8);
  });

  it("leans in while someone talks, and now and then even in silence", () => {
    const quiet = frameOf(run(createMotion("listening", SIZE), "listening", 2, 0));
    const talked = frameOf(run(createMotion("listening", SIZE), "listening", 2, 0.7));
    expect(talked.drops[0].y).toBeGreaterThan(quiet.drops[0].y + 0.01 * U);
    expect(talked.drops[0].w / talked.drops[0].h).toBeGreaterThan(quiet.drops[0].w / quiet.drops[0].h);
    // Silent for 20 s: it is never frozen, and leans a little several times.
    const motion = run(createMotion("listening", SIZE), "listening", 0.5);
    const ys: number[] = [];
    for (let i = 0; i < 20 * 10; i++) ys.push(frameOf(run(motion, "listening", 0.1)).drops[0].y);
    let leans = 0;
    for (let i = 1; i < ys.length; i++) if (ys[i]! - ys[i - 1]! > 0.002 * U && ys[i - 1]! - (ys[i - 2] ?? ys[i - 1]!) <= 0.002 * U) leans++;
    expect(leans).toBeGreaterThanOrEqual(2);
  });

  it("sends rings of light inward through the listening body on syllables", () => {
    const motion = createMotion("listening", SIZE);
    const radii: number[] = [];
    for (let i = 0; i < 240; i++) {
      stepMotion(motion, { state: "listening", level: (i / 120) % 0.5 < 0.12 ? 0.9 : 0.05, size: SIZE }, 1 / 120);
      const wave = frameOf(motion).light.wave;
      if (wave[2] > 0.01) radii.push(wave[0]);
    }
    expect(radii.length).toBeGreaterThan(10);
    // Each ring starts at the edge and travels in.
    expect(radii[0]!).toBeGreaterThan(radii[Math.min(8, radii.length - 1)]!);
  });
});

describe("reduced motion", () => {
  it("keeps every shape still, round and unstretched, with only a breath of light", () => {
    for (const state of STATES) {
      const motion = createMotion(state, SIZE);
      // Long enough for the slow level to have followed the voice.
      run(motion, state, 4, 0.5, true);
      const first = frameOf(motion, true);
      const energies: number[] = [];
      for (let i = 0; i < 12; i++) {
        run(motion, state, 0.5, 0.5, true);
        const frame = frameOf(motion, true);
        energies.push(frame.light.energy);
        frame.drops.forEach((d, k) => {
          // Still to a hundredth of a pixel.
          expect(d.x).toBeCloseTo(first.drops[k]!.x, 2);
          expect(d.y).toBeCloseTo(first.drops[k]!.y, 2);
          expect(d.angle ?? 0).toBe(0);
        });
        expect(frame.light.wobble).toBe(0);
        expect(frame.light.flow).toBe(first.light.flow);
      }
      if (state !== "offline") {
        const mean = energies.reduce((a, b) => a + b) / energies.length;
        for (const e of energies) expect(Math.abs(e - mean) / mean).toBeLessThan(0.07);
      }
      // A breath of light needs a few frames a second; offline needs none.
      expect(pace(motion, true)).toBe(state === "offline" ? 0 : 15);
    }
  });
});

describe("pace", () => {
  it("draws only as often as the state needs", () => {
    expect(pace(run(createMotion("working", SIZE), "working", 2))).toBe(60);
    expect(pace(run(createMotion("offline", SIZE), "offline", 2))).toBe(0);
    expect(pace(run(createMotion("listening", SIZE), "listening", 2, 0))).toBe(30);
    expect(pace(run(createMotion("listening", SIZE), "listening", 2, 0.6))).toBe(60);
    // Idle rests at 30, and wakes to 60 for a gesture.
    const idle = createMotion("idle", SIZE, 0);
    const paces = new Set<number>();
    for (let i = 0; i < 20 * 60; i++) {
      stepMotion(idle, { state: "idle", size: SIZE }, 1 / 60);
      paces.add(pace(idle));
    }
    expect([...paces].sort()).toEqual([30, 60]);
    // Any change wakes it.
    const motion = run(createMotion("offline", SIZE), "offline", 2);
    stepMotion(motion, { state: "idle", size: SIZE }, 1 / 60);
    expect(pace(motion)).toBe(60);
  });
});

describe("colours", () => {
  it("are the design tokens, exactly", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const state of STATES) {
        const token = TOKENS[theme][state], look = PALETTE[theme][state];
        expect([hex(look.from), hex(look.to), hex(look.core), hex(look.halo), look.glow]).toEqual([token.from, token.to, token.core, token.halo, token.glow].map((v) => (typeof v === "string" ? v.toUpperCase() : v)));
      }
    }
    // A state shown alone is its own colour, untouched by the mixing.
    expect(hex(presence({ blend: only("working"), time: 1, size: SIZE }).from)).toBe(TOKENS.dark.working.from.toUpperCase());
  });

  it("passes through `via` between azure and amber", () => {
    const motion = run(createMotion("working", SIZE), "working", 2);
    let closest = Infinity;
    for (let i = 0; i < 60; i++) {
      run(motion, "waiting", 1 / 60);
      const c = frameOf(motion).from;
      closest = Math.min(closest, Math.hypot(c[0] - VIA.dark[0], c[1] - VIA.dark[1], c[2] - VIA.dark[2]));
    }
    expect(closest).toBeLessThan(40);
  });

  it("glows on a light surface only when working or waiting", () => {
    for (const state of STATES) {
      const glow = presence({ blend: only(state), time: 1, size: SIZE, theme: "light" }).light.bloom;
      if (state === "working" || state === "waiting") expect(glow).toBeGreaterThan(0.1);
      else expect(glow).toBe(0);
    }
  });
});

describe("small sizes", () => {
  it("drops the gestures, the wobble and the rim where they would only blur the figure", () => {
    for (const state of STATES) {
      const tiny = presence({ blend: only(state), time: 7.3, level: 0.5, size: 24 });
      expect(tiny.light.wobble).toBe(0);
      expect(tiny.light.rim).toBe(0);
      expect(tiny.light.bloom).toBe(0);
    }
    // No glance on a row-sized idle figure.
    for (let t = 0; t < 30; t += 0.25) {
      const frame = presence({ blend: only("idle"), time: t, size: 24 });
      expect(Math.hypot(frame.drops[2].x - frame.drops[0].x, frame.drops[2].y - frame.drops[0].y)).toBeLessThan(0.5);
    }
  });

  it("keeps a drop's shape the same whichever way it is written", () => {
    const frame = presence({ blend: only("speaking"), time: 1, level: 0.8, size: SIZE });
    // Upright pills stay upright: a tall pill is tall, not a wide one turned.
    for (const d of frame.drops) expect(d.angle ?? 0).toBe(0);
    expect(tensor(frame.drops[0], U)[4]).toBeGreaterThan(tensor(frame.drops[0], U)[2]!);
  });
});
