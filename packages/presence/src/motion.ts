/**
 * The presence in time: what turns "the agent is now waiting" into a blend
 * that moves. Each drop follows the target state on its own spring — the
 * small one quick and bouncy, the big one heavy — so that a change of state
 * arrives as overlapping action instead of a cross-fade. Each kind of change
 * has its own feel: a deflate into offline, a wake out of it, a pop when it
 * asks, a slow lowered hand after "stop". Before it moves, the body gathers
 * itself for a moment.
 *
 * The voice is followed three ways: a level with a fast attack and a slower
 * release, a slow level that means "someone is talking", and onsets — the
 * start of each syllable — that throw the speaking drops up, each on a
 * spring of its own.
 *
 * Like the model this is plain arithmetic: step it with any `dt` and it
 * gives the same result, on any platform — only onsets are found at the
 * steps they happen in.
 */

import { duration, spring as SPRING } from "@agentos/design";
import { flowRate, gesturing, STATES, type Blend, type PresenceInput, type PresenceState, type Pulse, type PulseKind, type Voice } from "./model.js";

/** A spring as its perceptual duration in seconds and its bounce, 0–1 — as SwiftUI's `Spring(duration:bounce:)`. */
type Feel = readonly [duration: number, bounce: number];
const named = (name: keyof typeof SPRING): Feel => [SPRING[name].duration, SPRING[name].bounce];

/**
 * Springs of each drop — big, middle, small — for each kind of change. The
 * middle drop moves on the design system's `gesture` spring, like a request
 * arriving; the others are the presence's own: a heavier body, a quicker hand.
 */
const FEELS = {
  // The small drop leads and bounces once; the big one is heavy and arrives last.
  change: [[0.62, 0.15], named("gesture"), [0.42, 0.4]],
  // Asking: the hand pops up a little more eagerly.
  ask: [[0.62, 0.15], named("gesture"), [0.4, 0.45]],
  // Into offline: a slow deflate, no bounce at all.
  deflate: [[0.9, 0], [0.8, 0], [0.7, 0]],
  // Out of offline: waking up.
  wake: [[0.6, 0.2], [0.55, 0.3], [0.48, 0.35]],
  // After "stop": the hand is lowered slowly, without a bounce.
  lower: [[0.62, 0.1], [0.55, 0.1], [0.7, 0]],
} as const satisfies Record<string, readonly [Feel, Feel, Feel]>;

const omega = (feel: Feel) => (2 * Math.PI) / feel[0];
const zeta = (feel: Feel) => 1 - feel[1];

/** Spring of each drop for an ordinary change — big, middle, small: [angular frequency in rad/s, damping ratio]. */
export const SPRINGS = FEELS.change.map((feel) => [omega(feel), zeta(feel)] as const) as unknown as readonly [readonly [number, number], readonly [number, number], readonly [number, number]];

/** How fast the level follows the voice, per second: rising, then falling. */
export const ATTACK = 24;
export const RELEASE = 8;
/** How fast the slow level ("someone is talking") and the trailing level that finds onsets follow it, per second. */
const SLOW = 2, TRAIL = 3;
/** Onsets closer together than this are one syllable. */
const SYLLABLE = 0.14;

/** In calm mode a change of state is a short fade through nothing, in seconds each way: the design system's `exit`. */
export const CALM_FADE = duration.exit / 1000;

/** How fast a change of size settles: the design system's `layout` spring (critically damped), in rad/s — the presence steps aside with the layout around it. */
export const SIZE_SPRING = omega(named("layout"));

/** Colour and light follow the state on the design system's `material` spring: they never bounce. */
const MATERIAL = named("material");

/** Before a change, the body gathers itself for this long: the drops start towards the new state after it. */
const ANTICIPATION = 0.08;
/** The whole gathering, squash and release, as the model draws it. */
const GATHER = 0.24;

/** How late the drops feel their own speed, in seconds: liquid takes a moment to stretch, and a moment to round again. */
const DRAG = 0.06;

/** A pulse is felt for this long. */
const PULSE_LENGTH = 2.5;

/**
 * The speaking drops: how high each lifts with the voice, how high a syllable
 * throws it (for 140 ms), how long after the syllable (the middle one first,
 * then one side, then the other), and its spring — bouncy, so that it
 * overshoots below rest as it lands, which the model draws as a squash.
 */
const BOUNCE = { reach: [0.1, 0.07, 0.07], throw: [0.26, 0.2, 0.2], delay: [0, 0.07, 0.12], feel: [[0.3, 0.55], [0.34, 0.5], [0.32, 0.5]] } as const;
const THROW = 0.14;

/** The moving state of one presence. Create it with `createMotion`, advance it with `stepMotion`. */
export interface Motion {
  /** Seconds since creation. */
  time: number;
  /** The state being moved towards. */
  state: PresenceState;
  /** The state before it. */
  from: PresenceState;
  /** When the last change began, in seconds: the body gathers itself for a moment after it. */
  changed: number;
  /** When waiting last began, in seconds: it times the waiting wave and its patience. */
  asked: number;
  /** Smoothed voice level, 0–1. */
  level: number;
  /** The voice followed in time: slow level, how high each speaking drop has bounced, last syllable. */
  voice: Voice;
  /** Rate of change of each speaking drop's lift. */
  liftVelocity: [number, number, number];
  /** The level followed more slowly, to find where syllables start; and the onset signal at the last step. */
  trail: number;
  rising: number;
  /** How much of each state's colour and light shows, on the `material` spring. */
  tint: Record<PresenceState, number>;
  /** Rate of change of the tint. */
  tintVelocity: Record<PresenceState, number>;
  /** Blend of each drop: big, middle, small. */
  blend: [Record<PresenceState, number>, Record<PresenceState, number>, Record<PresenceState, number>];
  /** Rate of change of each blend. */
  velocity: [Record<PresenceState, number>, Record<PresenceState, number>, Record<PresenceState, number>];
  /** The rates as the drops feel them, a moment late: what they stretch with, so a stretch builds up and lets go softly. */
  drag: [Record<PresenceState, number>, Record<PresenceState, number>, Record<PresenceState, number>];
  /** The spring each drop is on for the change under way: [angular frequency, damping ratio]. */
  springs: [[number, number], [number, number], [number, number]];
  /** How far the inner light has flowed, in stage units. */
  flow: number;
  /** The last pulse, if any. */
  pulse: Pulse | null;
  /** Picks the sequence of small idle gestures. */
  seed: number;
  /** Opacity of the whole figure; dips only for calm-mode changes. */
  alpha: number;
  /** Side of the stage in pixels, eased towards the size asked for. 0 until one is given. */
  size: number;
  /** Rate of change of the size, in pixels per second. */
  sizeVelocity: number;
  /** True once nothing is changing any more except the ambient motion of the state itself. */
  settled: boolean;
}

/** What the presence should show, as given by the app. */
export interface Target {
  state: PresenceState;
  /** Raw voice level, 0–1. */
  level?: number;
  /** Reduced motion. */
  calm?: boolean;
  /** Side of the stage in pixels. A change of size is a movement too: it is eased, like a change of state. */
  size?: number;
}

const weights = (state: PresenceState, on: number) =>
  Object.fromEntries(STATES.map((s) => [s, s === state ? on : 0])) as Record<PresenceState, number>;

/** A presence at rest in `state`, on a stage of `size` pixels if it is known already. `seed` picks its idle gestures. */
export function createMotion(state: PresenceState = "idle", size = 0, seed = 0): Motion {
  return {
    time: 0,
    state,
    from: state,
    changed: -1,
    asked: 0,
    level: 0,
    voice: { slow: 0, lift: [0, 0, 0], onset: -1, strength: 0 },
    liftVelocity: [0, 0, 0],
    trail: 0,
    rising: 0,
    tint: weights(state, 1),
    tintVelocity: weights(state, 0),
    blend: [weights(state, 1), weights(state, 1), weights(state, 1)],
    velocity: [weights(state, 0), weights(state, 0), weights(state, 0)],
    drag: [weights(state, 0), weights(state, 0), weights(state, 0)],
    springs: SPRINGS.map(([w, z]) => [w, z]) as Motion["springs"],
    flow: 0,
    pulse: null,
    seed,
    alpha: 1,
    size,
    sizeVelocity: 0,
    settled: true,
  };
}

/** Eases the stage towards `size`. True once it is there. */
function stepSize(motion: Motion, size: number | undefined, dt: number, calm: boolean): boolean {
  if (size === undefined) return true;
  // The first size has nothing to travel from, and calm mode wants no travel: both are taken at once.
  if (motion.size === 0 || calm) {
    motion.size = size;
    motion.sizeVelocity = 0;
    return true;
  }
  // The exact solution of a critically damped spring over dt.
  const x = motion.size - size;
  const c = motion.sizeVelocity + SIZE_SPRING * x;
  const decay = Math.exp(-SIZE_SPRING * dt);
  motion.size = size + (x + c * dt) * decay;
  motion.sizeVelocity = (c - SIZE_SPRING * (x + c * dt)) * decay;
  // A quarter of a pixel away and hardly moving: there.
  if (Math.abs(motion.size - size) >= 0.25 || Math.abs(motion.sizeVelocity) >= 4) return false;
  motion.size = size;
  motion.sizeVelocity = 0;
  return true;
}

/** Scratch for one spring step: position and velocity relative to the target. */
const step = { x: 0, v: 0 };

/** The exact solution of a damped spring over dt, from (x, v) relative to its rest: the same path at any frame rate. */
function spring(x: number, v: number, w: number, z: number, dt: number): void {
  if (z < 1) {
    const decay = Math.exp(-z * w * dt);
    const wd = w * Math.sqrt(1 - z * z);
    const cos = Math.cos(wd * dt), sin = Math.sin(wd * dt);
    const c = (v + z * w * x) / wd;
    step.x = decay * (x * cos + c * sin);
    step.v = decay * (v * cos - (x * wd + c * z * w) * sin);
  } else {
    const decay = Math.exp(-w * dt);
    const c = v + w * x;
    step.x = (x + c * dt) * decay;
    step.v = (c - w * (x + c * dt)) * decay;
  }
}

/** Moves every drop's blend towards `target` for dt seconds. Returns how far from rest the furthest one still is. */
function stepBlends(motion: Motion, target: PresenceState, dt: number): number {
  let moving = 0;
  for (let k = 0; k < 3; k++) {
    const w = motion.springs[k]![0], z = motion.springs[k]![1];
    const blend = motion.blend[k]!, velocity = motion.velocity[k]!;
    for (let s = 0; s < 6; s++) {
      const state = STATES[s]!;
      const goal = state === target ? 1 : 0;
      if (dt > 0) {
        spring(blend[state] - goal, velocity[state], w, z, dt);
        blend[state] = goal + step.x;
        velocity[state] = step.v;
      }
      moving = Math.max(moving, Math.abs(blend[state] - goal), Math.abs(velocity[state]) * 0.05);
    }
  }
  return moving;
}

/** Moves the tint towards `target` on the material spring. Returns how far from rest it still is. */
function stepTint(motion: Motion, target: PresenceState, dt: number): number {
  let moving = 0;
  for (let s = 0; s < 6; s++) {
    const state = STATES[s]!;
    const goal = state === target ? 1 : 0;
    spring(motion.tint[state] - goal, motion.tintVelocity[state], omega(MATERIAL), zeta(MATERIAL), dt);
    motion.tint[state] = goal + step.x;
    motion.tintVelocity[state] = step.v;
    moving = Math.max(moving, Math.abs(step.x), Math.abs(step.v) * 0.05);
  }
  return moving;
}

/** Follows the voice: the slow level, onsets, and the speaking drops on their springs. True once the drops are at rest. */
function stepVoice(motion: Motion, speaking: boolean, calm: boolean, dt: number): boolean {
  const voice = motion.voice as { -readonly [K in keyof Voice]: Voice[K] };
  voice.slow += (motion.level - voice.slow) * (1 - Math.exp(-dt * SLOW));
  motion.trail += (motion.level - motion.trail) * (1 - Math.exp(-dt * TRAIL));
  // A syllable starts where the level jumps above where it has been lately.
  const onset = Math.min(1, Math.max(0, (motion.level - motion.trail - 0.05) * 5));
  if (onset >= 0.35 && motion.rising < 0.35 && motion.time - voice.onset >= SYLLABLE) {
    voice.onset = motion.time;
    voice.strength = onset;
  }
  motion.rising = onset;

  const lift = voice.lift as unknown as number[];
  let resting = true;
  for (let k = 0; k < 3; k++) {
    // Each drop hears the voice a little differently, so the row ripples instead of pumping.
    let goal = speaking ? BOUNCE.reach[k]! * motion.level * (0.6 + 0.4 * Math.sin(motion.time * (k === 0 ? 9 : 7.3) + k * 2.4)) : 0;
    // A syllable throws the middle drop up at once, the sides a moment later, one after the other.
    // A throw, not a kick: the drop is pushed for 140 ms, so it leaps without a jolt.
    const thrown = motion.time - voice.onset - BOUNCE.delay[k]!;
    if (speaking && !calm && thrown > 0 && thrown < THROW) goal += BOUNCE.throw[k]! * voice.strength * Math.sin((Math.PI * thrown) / THROW) ** 2;
    const feel = BOUNCE.feel[k]!;
    spring(lift[k]! - goal, motion.liftVelocity[k]!, omega(feel), zeta(feel), dt);
    // Landing, a drop squashes rather than sinks; it may squash only so far.
    lift[k] = Math.max(-0.1, goal + step.x);
    motion.liftVelocity[k] = step.v;
    if (Math.abs(step.x) > 0.002 || Math.abs(step.v) > 0.04) resting = false;
  }
  return resting;
}

/** Picks each drop's spring for a change from `from` to `to`. */
function feel(motion: Motion, from: PresenceState, to: PresenceState): void {
  const stopped = motion.pulse?.kind === "denied" && motion.time - motion.pulse.at < 1.5;
  const feels = to === "offline" ? FEELS.deflate : from === "offline" ? FEELS.wake : stopped ? FEELS.lower : to === "waiting" ? FEELS.ask : FEELS.change;
  for (let k = 0; k < 3; k++) {
    motion.springs[k]![0] = omega(feels[k]!);
    motion.springs[k]![1] = zeta(feels[k]!);
  }
}

/** Advances `motion` by `dt` seconds towards `target`. Mutates and returns it. */
export function stepMotion(motion: Motion, target: Target, dt: number): Motion {
  const start = motion.time;
  motion.time += dt;
  // Only a voice state hears the level; any other lets it fall back to silence.
  const voiced = target.state === "listening" || target.state === "speaking";
  const level = voiced ? Math.min(1, Math.max(0, target.level ?? 0)) : 0;
  motion.level += (level - motion.level) * (1 - Math.exp(-dt * (level > motion.level ? ATTACK : RELEASE)));
  const quiet = stepVoice(motion, target.state === "speaking", target.calm ?? false, dt);
  const sized = stepSize(motion, target.size, dt, target.calm ?? false);

  if (target.state !== motion.state) {
    motion.from = motion.state;
    motion.state = target.state;
    if (target.state === "waiting") motion.asked = start;
    // A body already gathering itself does not start again; a dash has nothing to gather.
    if (start - motion.changed >= GATHER && target.state !== "offline" && motion.from !== "offline") motion.changed = start;
    if (!target.calm) feel(motion, motion.from, target.state);
  }
  if (target.calm) return stepCalm(motion, target.state, dt);

  motion.alpha = Math.min(1, motion.alpha + dt / CALM_FADE);
  motion.flow += flowRate(motion.blend, motion.level) * dt;
  // The drops keep their course while the body gathers itself, then turn to the new state.
  // To or from offline there is nothing to gather: a deflate, a wake.
  const gathers = motion.state !== "offline" && motion.from !== "offline";
  const wait = gathers ? Math.min(dt, Math.max(0, motion.changed + ANTICIPATION - start)) : 0;
  if (wait > 0) stepBlends(motion, motion.from, wait);
  const moving = Math.max(stepBlends(motion, motion.state, dt - wait), stepTint(motion, motion.state, dt));
  const follow = 1 - Math.exp(-dt / DRAG);
  for (let k = 0; k < 3; k++) {
    for (let s = 0; s < 6; s++) {
      const state = STATES[s]!;
      motion.drag[k]![state] += (motion.velocity[k]![state] - motion.drag[k]![state]) * follow;
    }
  }
  const pulsing = motion.pulse !== null && motion.time - motion.pulse.at < PULSE_LENGTH;
  motion.settled = moving < 0.002 && sized && quiet && !pulsing;
  return motion;
}

/** Calm mode: no morph. The figure fades out, changes, and fades back in. */
function stepCalm(motion: Motion, state: PresenceState, dt: number): Motion {
  const shown = motion.blend[0][state] === 1;
  motion.alpha = shown ? Math.min(1, motion.alpha + dt / CALM_FADE) : Math.max(0, motion.alpha - dt / CALM_FADE);
  if (!shown && motion.alpha === 0) {
    for (let k = 0; k < 3; k++) {
      motion.blend[k] = weights(state, 1);
      motion.velocity[k] = weights(state, 0);
      motion.drag[k] = weights(state, 0);
    }
    motion.tint = weights(state, 1);
    motion.tintVelocity = weights(state, 0);
  }
  motion.settled = shown && motion.alpha === 1;
  return motion;
}

/**
 * Tells the presence something happened: "approved" (the owner said go
 * ahead — it nods), "denied" (stop — it lowers its hand), "retry" (the
 * computer is trying to reconnect — the dash lifts once). Every pulse is
 * a real event: never send one for decoration.
 */
export function pulse(motion: Motion, kind: PulseKind): Motion {
  motion.pulse = { kind, at: motion.time };
  motion.settled = false;
  // A "stop" lowers the hand slowly even if the change of state came first.
  if (kind === "denied") feel(motion, motion.from, motion.state);
  return motion;
}

/**
 * How many frames a second `motion` needs right now: 60 while something
 * travels, 30 for the slow ambient states, 15 for calm mode's breath of
 * light, 0 when nothing can change (offline, at rest). A renderer that
 * draws at this pace stays on screen all day.
 */
export function pace(motion: Motion, calm = false): number {
  const pulsing = motion.pulse !== null && motion.time - motion.pulse.at < PULSE_LENGTH;
  if (calm) return motion.alpha < 1 || !motion.settled ? 60 : motion.state === "offline" && !pulsing ? 0 : 15;
  if (!motion.settled || pulsing) return 60;
  switch (motion.state) {
    case "offline":
      return 0;
    case "working":
      return 60;
    case "listening":
    case "speaking":
      return motion.level > 0.01 || motion.voice.slow > 0.02 ? 60 : 30;
    default:
      return gesturing(motion.state, motion.time, motion.asked, motion.seed) ? 60 : 30;
  }
}

/**
 * The model input for `motion` right now, on a stage of `size` pixels — by
 * default the size `motion` is easing. Pass `into` to fill an input made
 * before instead of making a new one.
 */
export function inputOf(motion: Motion, size: number = motion.size, options: Pick<PresenceInput, "theme" | "calm"> = {}, into?: PresenceInput): PresenceInput {
  const input = into ?? ({} as PresenceInput);
  input.blend = motion.blend as readonly [Blend, Blend, Blend];
  // The drops stretch with the speed they feel, a moment behind the springs.
  input.velocity = motion.drag as readonly [Blend, Blend, Blend];
  input.tint = motion.tint;
  input.time = motion.time;
  input.level = motion.level;
  input.size = size;
  input.theme = options.theme;
  input.calm = options.calm;
  input.changed = motion.changed;
  input.asked = motion.asked;
  input.voice = motion.voice;
  input.pulse = motion.pulse;
  input.flow = motion.flow;
  input.seed = motion.seed;
  return input;
}
