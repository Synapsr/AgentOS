import { describe, expect, it } from "vitest";
import { presence, STATES, type Frame } from "../model.js";
import { createMotion, inputOf, stepMotion } from "../motion.js";
import { toSVG } from "../svg.js";
import { holeShown, tensor } from "./helpers.js";

const run = (motion: ReturnType<typeof createMotion>, state: (typeof STATES)[number], seconds: number, fps: number, level = 0, calm = false) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) stepMotion(motion, { state, level, calm }, 1 / fps);
  return motion;
};

describe("motion", () => {
  it("settles on the target state, each drop in its own time", () => {
    const motion = createMotion("idle");
    run(motion, "working", 0.12, 120);
    // The small drop leads, the big one follows.
    expect(motion.blend[2].working).toBeGreaterThan(motion.blend[0].working);
    expect(motion.settled).toBe(false);
    run(motion, "working", 2, 120);
    expect(motion.settled).toBe(true);
    for (const blend of motion.blend) for (const state of STATES) expect(blend[state]).toBeCloseTo(state === "working" ? 1 : 0, 2);
  });

  it("keeps every blend summing to one, and overshoots only a little", () => {
    const motion = createMotion("idle");
    for (const state of ["working", "waiting", "listening", "speaking", "offline", "idle"] as const) {
      for (let i = 0; i < 40; i++) {
        stepMotion(motion, { state, level: 0.5 }, 1 / 60);
        for (const blend of motion.blend) {
          expect(STATES.reduce((sum, s) => sum + blend[s], 0)).toBeCloseTo(1, 9);
          for (const s of STATES) {
            expect(blend[s]).toBeGreaterThan(-0.2);
            expect(blend[s]).toBeLessThan(1.2);
          }
        }
      }
    }
  });

  it("does not depend on the frame rate", () => {
    const slow = run(createMotion("idle"), "waiting", 0.5, 30, 0.8);
    const fast = run(createMotion("idle"), "waiting", 0.5, 240, 0.8);
    expect(slow.time).toBeCloseTo(fast.time, 9);
    for (let k = 0; k < 3; k++) for (const s of STATES) expect(slow.blend[k]![s]).toBeCloseTo(fast.blend[k]![s], 9);
  });

  it("follows the voice quickly up and slowly down, and only in a voice state", () => {
    const motion = createMotion("listening");
    run(motion, "listening", 0.1, 60, 1);
    expect(motion.level).toBeGreaterThan(0.85);
    run(motion, "listening", 0.1, 60, 0);
    expect(motion.level).toBeGreaterThan(0.3);
    run(motion, "listening", 1, 60, 0);
    expect(motion.level).toBeLessThan(0.01);
    run(motion, "working", 1, 60, 1);
    expect(motion.level).toBeLessThan(0.01);
  });

  it("draws a continuous film through every change of state, even interrupted ones", () => {
    const motion = createMotion("idle");
    const script = ["working", "waiting", "listening", "speaking", "idle", "offline", "working", "listening", "idle", "speaking", "waiting", "offline", "idle"] as const;
    const numbers = (f: Frame) => [...f.drops.flatMap((d) => tensor(d, f.size / 2)), ...holeShown(f)];
    let last: number[] | null = null;
    script.forEach((state, n) => {
      // Odd changes come before the previous one has finished.
      for (let i = 0; i < (n % 2 ? 14 : 90); i++) {
        stepMotion(motion, { state, level: 0.5 + 0.5 * Math.sin(i / 7) }, 1 / 120);
        const now = numbers(presence(inputOf(motion, 400)));
        if (last) expect(Math.max(...now.map((v, j) => Math.abs(v - last![j]!))), `${state}, frame ${i}`).toBeLessThan(0.1);
        last = now;
      }
    });
  });

  it("in calm mode fades through nothing instead of morphing", () => {
    const motion = createMotion("idle");
    stepMotion(motion, { state: "working", calm: true }, 0.05);
    expect(motion.alpha).toBeLessThan(1);
    // Still the old shape while fading out.
    expect(motion.blend[0].idle).toBe(1);
    run(motion, "working", 0.2, 60, 0, true);
    expect(motion.blend[0].working).toBe(1);
    run(motion, "working", 0.3, 60, 0, true);
    expect(motion.alpha).toBe(1);
    expect(motion.settled).toBe(true);
  });
});

describe("a change of size", () => {
  it("takes the first size at once, and eases every later one", () => {
    const motion = createMotion("idle");
    stepMotion(motion, { state: "idle", size: 300 }, 1 / 60);
    expect(motion.size).toBe(300);
    expect(motion.settled).toBe(true);

    stepMotion(motion, { state: "idle", size: 96 }, 1 / 60);
    expect(motion.size).toBeLessThan(300);
    expect(motion.size).toBeGreaterThan(280);
    expect(motion.settled).toBe(false);
    expect(inputOf(motion).size).toBe(motion.size);
  });

  it("gets there in about 400 ms, without overshoot or a jump, and then rests exactly on it", () => {
    const motion = createMotion("idle", 300);
    let last = motion.size, steps = 0;
    while (!motion.settled || steps === 0) {
      stepMotion(motion, { state: "idle", size: 96 }, 1 / 120);
      expect(motion.size).toBeLessThanOrEqual(last);
      expect(motion.size).toBeGreaterThanOrEqual(96);
      // The layout spring moves these 204 px at about 1 050 px/s at most: under 9 px in one of these steps.
      expect(last - motion.size).toBeLessThan(9);
      last = motion.size;
      if (++steps === 48) expect((motion.size - 96) / 204).toBeLessThan(0.06); // 400 ms in: within 6 % of the way
      if (steps > 1000) throw new Error("never settled");
    }
    expect(motion.size).toBe(96);
    expect(steps / 120).toBeLessThan(0.9);
    // Growing back is as smooth.
    for (let i = 0; i < 240; i++) stepMotion(motion, { state: "idle", size: 440 }, 1 / 120);
    expect(motion.size).toBe(440);
  });

  it("does not depend on the frame rate, and turns round smoothly when the size changes on the way", () => {
    const slow = createMotion("idle", 200), fast = createMotion("idle", 200);
    for (let i = 0; i < 6; i++) stepMotion(slow, { state: "idle", size: 600 }, 1 / 30);
    for (let i = 0; i < 48; i++) stepMotion(fast, { state: "idle", size: 600 }, 1 / 240);
    expect(slow.size).toBeCloseTo(fast.size, 6);
    // Half-way, it is sent back: it slows, turns, and never jumps — under 7.4 px in one of these steps.
    let last = fast.size;
    for (let i = 0; i < 480; i++) {
      stepMotion(fast, { state: "idle", size: 200 }, 1 / 240);
      expect(Math.abs(fast.size - last)).toBeLessThan(7.4);
      last = fast.size;
    }
    expect(fast.size).toBe(200);
  });

  it("is taken at once in calm mode, and left alone when no size is given", () => {
    const motion = createMotion("idle", 300);
    stepMotion(motion, { state: "idle", size: 96, calm: true }, 1 / 60);
    expect(motion.size).toBe(96);
    stepMotion(motion, { state: "working" }, 1 / 60);
    expect(motion.size).toBe(96);
  });

  it("draws a continuous film while the stage shrinks through the small sizes", () => {
    const motion = createMotion("working", 200);
    let last: Frame | null = null;
    for (let i = 0; i < 200; i++) {
      stepMotion(motion, { state: "working", size: 24 }, 1 / 120);
      const frame = presence(inputOf(motion));
      // In pixels: the figure shrinks with its stage, a few pixels a frame at most.
      if (last) {
        frame.drops.forEach((d, k) => {
          const [x, , xx] = tensor(d, 1), [x0, , xx0] = tensor(last!.drops[k]!, 1);
          expect(2 * Math.abs(xx! - xx0!) + Math.abs(x! - x0!)).toBeLessThan(6);
        });
      }
      last = frame;
    }
    expect(motion.size).toBe(24);
  });
});

describe("toSVG", () => {
  it("draws a frame as a standalone document", () => {
    const svg = toSVG(presence({ blend: createMotion("listening").blend[0], time: 1, level: 0.5, size: 64 }));
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    // Listening is a body now, not a ring: nothing to cut.
    expect(svg).not.toContain("<mask");
    expect(svg).not.toContain("NaN");
  });

  it("names its gradients after the frame, so that two figures can share a page", () => {
    const a = toSVG(presence({ blend: createMotion("idle").blend[0], time: 1, size: 64 }));
    const b = toSVG(presence({ blend: createMotion("waiting").blend[0], time: 1, size: 64 }));
    expect(a.match(/id="g(\w+)"/)![1]).not.toBe(b.match(/id="g(\w+)"/)![1]);
  });

  it("can be a flat, single-colour glyph", () => {
    const svg = toSVG(presence({ blend: createMotion("working").blend[0], time: 1, size: 24 }), { fill: "currentColor", glow: false });
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain("Gradient");
  });
});
