// Writes AgentOSTests/Fixtures/presence.json: reference frames from the
// TypeScript presence model, which `PresenceTests` holds the Swift port to.
//
//   pnpm --filter @agentos/presence build
//   node apps/ios/Scripts/export-presence-reference.mjs
//
// Run it again whenever packages/presence changes its model or its motion.
import { writeFileSync } from "node:fs";
import { STATES, bridge, createMotion, inputOf, mark, only, presence, pulse, stepMotion } from "../../../packages/presence/dist/index.js";

/** A repeatable stream of numbers in 0–1. */
function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const list = (blend) => STATES.map((state) => blend[state]);
const numbers = (frame) => ({
  drops: frame.drops.map((d) => [d.x, d.y, d.w, d.h, d.angle ?? 0]),
  bridges: frame.bridges.map((b) => [...b]),
  glows: frame.glows.map((g) => [g.x, g.y, g.r, g.alpha]),
  colours: [...frame.from, ...frame.to, ...frame.halo, ...frame.light.core],
  light: [frame.light.energy, frame.light.flow, frame.light.radial, frame.light.bloom, frame.light.rim, frame.light.wobble, frame.light.merge, ...frame.light.wave, frame.light.time],
});

const frames = [];
const add = (input) => {
  const blends = "idle" in input.blend ? [input.blend, input.blend, input.blend] : input.blend;
  frames.push({
    input: {
      blends: blends.map(list),
      time: input.time,
      level: input.level ?? 0,
      size: input.size,
      theme: input.theme ?? "dark",
      calm: input.calm ?? false,
      seed: input.seed ?? 0,
      ...(input.changed !== undefined && { changed: input.changed }),
      ...(input.asked !== undefined && { asked: input.asked }),
      ...(input.velocity && { velocity: input.velocity.map(list) }),
      ...(input.tint && { tint: list(input.tint) }),
      ...(input.voice && { voice: { slow: input.voice.slow, lift: [...input.voice.lift], onset: input.voice.onset, strength: input.voice.strength } }),
      ...(input.pulse && { pulse: { kind: input.pulse.kind, at: input.pulse.at } }),
      ...(input.flow !== undefined && { flow: input.flow }),
    },
    frame: numbers(presence(input)),
  });
};

// Every state on its own: large and tiny, on black and as ink, moving and calm,
// at moments that catch the breath, a gesture, the wave and a crossing.
for (const state of STATES) {
  for (const [time, level, size, theme, calm, seed] of [
    [4, 0.6, 280, "dark", false, 0],
    [3.6, 0, 280, "dark", false, 28],
    [12.345, 1, 120, "dark", false, 3],
    [3.21, 0.35, 44, "light", false, 0],
    [0.5, 0.8, 20, "dark", false, 0],
    [9.9, 0.5, 240, "dark", true, 0],
  ]) {
    add({ blend: only(state), time, level, size, theme, calm, seed });
  }
}
// Anything a spring can produce: a blend of its own for each drop, overshooting, with rates.
const next = random(7);
const blend = () => Object.fromEntries(STATES.map((state) => [state, next() * 1.3 - 0.15]));
for (let i = 0; i < 96; i++) {
  const blends = [blend(), blend(), blend()];
  const velocity = next() < 0.6 ? [0, 1, 2].map(() => Object.fromEntries(STATES.map((s) => [s, next() * 6 - 3]))) : undefined;
  add({
    blend: blends, velocity, time: next() * 100, level: next() * 1.4 - 0.2, size: 16 + next() ** 2 * 600,
    theme: next() < 0.5 ? "dark" : "light", calm: next() < 0.2, seed: Math.floor(next() * 50),
    ...(next() < 0.5 && { changed: next() * 3, asked: next() * 30 }),
    ...(next() < 0.5 && { tint: blend() }),
  });
}

// The motion, through a day of changes at uneven frame rates, with a voice,
// pulses, and the stage changing size on the way.
const script = [
  ["idle", 0, false, 240, 10], ["working", 0, false, 240, 45], ["waiting", 0, false, 96, 40], ["listening", 0.7, false, 96, 30],
  ["listening", 0.1, false, 240, 20], ["speaking", 0.9, false, 240, 30], ["speaking", 0.2, false, 240, 20], ["offline", 0.9, false, 120, 40],
  ["idle", 0, false, 300, 30], ["working", 0, true, 96, 20], ["listening", 0.6, true, 96, 20], ["waiting", 0, false, 240, 25], ["idle", 0, false, 240, 15],
];
const pulses = { 98: "retry", 205: "approved", 330: "denied" };
const motion = createMotion("idle", 0, 5);
const steps = [];
for (const [state, level, calm, size, count] of script) {
  for (let i = 0; i < count; i++) {
    const n = steps.length;
    const dt = [1 / 60, 1 / 30, 1 / 120, 0.05][(n * 7) % 4];
    // A voice that pulses, so that syllables are found.
    const heard = level * (n % 9 < 3 ? 1 : 0.2);
    if (pulses[n]) pulse(motion, pulses[n]);
    stepMotion(motion, { state, level: heard, calm, size }, dt);
    const frame = presence(inputOf(motion, size, { calm }));
    steps.push({
      dt, state, level: heard, calm, size, pulse: pulses[n] ?? null,
      after: {
        time: motion.time, level: motion.level, alpha: motion.alpha, settled: motion.settled,
        size: motion.size, sizeVelocity: motion.sizeVelocity, flow: motion.flow, changed: motion.changed, asked: motion.asked,
        blend: motion.blend.map(list), velocity: motion.velocity.map(list), drag: motion.drag.map(list), tint: list(motion.tint),
        voice: [motion.voice.slow, ...motion.voice.lift, motion.voice.onset, motion.voice.strength],
        frame: numbers(frame),
      },
    });
  }
}

// The membrane on its own: apart, a thread, touching, fused, sinking in, one inside the other.
const bridges = [];
for (const [r1, r2] of [[30, 22], [22, 30], [48, 15], [10, 10]]) {
  for (const gap of [1.2, 0.59, 0.3, 0.02, -0.2, -0.6, -1.5]) {
    const d = r1 + r2 + gap * Math.min(r1, r2);
    const args = [3, -4, r1, 3 + d * Math.cos(0.7), -4 + d * Math.sin(0.7), r2];
    bridges.push({ args, points: bridge(...args) });
  }
}

const marks = [1024, 64, 18].flatMap((size) => ["dark", "light"].map((theme) => ({ size, theme, frame: numbers(mark(size, theme)) })));

const out = new URL("../AgentOSTests/Fixtures/presence.json", import.meta.url);
// Nine decimals are far below what a screen can show, and keep the file small.
// Not for `dt`: a step taken with a rounded duration is another step.
const rounded = (key, value) => (typeof value === "number" && key !== "dt" ? Math.round(value * 1e9) / 1e9 : value);
writeFileSync(out, JSON.stringify({ states: STATES, frames, steps, bridges, marks }, rounded));
console.log(`${frames.length} frames, ${steps.length} steps, ${bridges.length} bridges, ${marks.length} marks`);
