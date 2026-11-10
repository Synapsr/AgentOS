/**
 * The presence, as numbers.
 *
 * The agent is drawn as three drops of light that behave as one liquid body.
 * `presence()` is a pure function: given how much of each state is showing,
 * the time, the voice and the size, it returns a handful of primitives —
 * three pills, the membranes that join them, three soft glows, a
 * gradient, and what the light inside the body is doing — that any renderer
 * can draw. Nothing here touches the DOM, a clock or a random source: its
 * "randomness" is a seeded hash, so the same input always gives the same
 * frame, on any platform.
 *
 * Three layers of motion, each from the one before:
 * - choreography: one function per state places the drops (the gesture that
 *   says the state, and small seeded gestures so that nothing loops);
 * - physics: drops stretch along their velocity, travel along arcs between
 *   states, anticipate, and answer events (a nod, a lowered hand, a lift);
 * - light: energy, flow, glow, wobble and how softly drops melt into one.
 *
 * Coordinates: the figure lives on a square stage. Inside this file positions
 * are in stage units (centre 0,0 — edges at ±1 — y grows downwards); the
 * frame that comes out is in pixels, relative to the centre of the stage.
 *
 * docs/PRESENCE.md describes every state in words. Keep the two in step.
 */

import { spring } from "@agentos/design";
import { mixInto, PALETTE } from "./palette.js";

/** Every state the presence can show. */
export const STATES = ["idle", "working", "waiting", "listening", "speaking", "offline"] as const;

/** What the agent is doing, as shown by the presence. */
export type PresenceState = (typeof STATES)[number];

/** How much of each state is showing. The weights normally sum to 1; a spring may push them slightly past 0 or 1. */
export type Blend = Readonly<Record<PresenceState, number>>;

/** The surface the presence sits on: light on black, or ink on a light surface. */
export type Theme = "dark" | "light";

/** A colour as red, green, blue, each 0–255. */
export type RGB = readonly [number, number, number];

/** Something that just happened, answered by the body: the owner said "go ahead", said "stop", or the computer is trying to reconnect. */
export type PulseKind = "approved" | "denied" | "retry";

/** A pulse and when it happened, in seconds on the clock of `time`. */
export interface Pulse {
  readonly kind: PulseKind;
  readonly at: number;
}

/** The voice beyond its level, as `motion.ts` follows it. */
export interface Voice {
  /** The level followed slowly (about half a second): someone is talking. */
  slow: number;
  /** How high each speaking drop has bounced — big, middle, small — in stage units: springs that syllables kick. Below 0 it squashes. */
  lift: readonly [number, number, number];
  /** When the last syllable began, in seconds on the clock of `time`. */
  onset: number;
  /** How sharp that syllable was, 0–1. */
  strength: number;
}

/** Everything the look depends on. Only `blend`, `time` and `size` are needed; the rest makes it move like matter. */
export interface PresenceInput {
  /** One blend for the whole figure, or one per drop (big, middle, small) so that they can arrive one after the other. */
  blend: Blend | readonly [Blend, Blend, Blend];
  /** Seconds. Any origin. */
  time: number;
  /** Voice level, 0–1: the microphone while listening, the output while speaking. */
  level?: number;
  /** Side of the stage, in pixels. Below about 72 px the figure simplifies; see `tininess`. */
  size: number;
  theme?: Theme;
  /** Reduced motion: keep each state's shape, drop everything that travels. */
  calm?: boolean;
  /** When the last change of state began, in seconds on the clock of `time`: the body gathers itself for a moment after it. */
  changed?: number;
  /** When waiting last began, in seconds on the clock of `time`: it times the waiting wave, and its patience. */
  asked?: number;
  /** Rate of change of each drop's blend, per second, as the springs give it: drops stretch along their travel. */
  velocity?: readonly [Blend, Blend, Blend];
  /** How much of each state's colour and light shows. Without it, the drops' blends averaged. */
  tint?: Blend;
  /** The voice, followed in time. Without it the figure follows `level` alone. */
  voice?: Voice;
  /** The last pulse, if any. */
  pulse?: Pulse | null;
  /** How far the inner light has flowed, in stage units; it only moves forward. Without it, it follows `time`. */
  flow?: number;
  /** Picks the sequence of small idle gestures. Any whole number. */
  seed?: number;
}

/** A pill centred on (x, y): a rectangle with fully round ends, `w` along its own axis, turned by `angle` (radians, clockwise on screen). A circle when `w === h`. */
export interface Pill {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Absent or 0 for an upright pill; never more than a quarter turn either way. */
  angle?: number;
}

/**
 * The membrane between two drops that are close: eight points, as x,y pairs,
 * for the closed path `M 0  C 1 2 3  L 4  C 5 6 7  Z`. Fill each bridge on
 * its own, over the drops. A bridge with no area has its points collapsed
 * onto two. A renderer that melts the drops together itself (the shader)
 * does not need them.
 */
export type Bridge = readonly number[];

/** A soft disc of light behind a drop: full `alpha` at the centre, nothing at `r`. */
export interface Glow {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

/** What the body is made of, for renderers that draw light rather than paint (WebGL, Metal). Lengths in pixels. */
export interface Light {
  /** The colour at the heart of the body. */
  core: RGB;
  /** How much light is inside the body, 0 (matte) – 1. */
  energy: number;
  /** How far the inner light has flowed, in stage units; it only moves forward. */
  flow: number;
  /** −1 the inner light flows inward (listening), 1 outward (speaking), 0 it drifts. */
  radial: number;
  /** Strength of the light around the body, 0–1. */
  bloom: number;
  /** Strength of the bright edge, lit from the top left, 0–1. */
  rim: number;
  /** How far the outline wanders, like the surface of a liquid. */
  wobble: number;
  /** How softly drops melt into one: the distance across which two edges join. */
  merge: number;
  /** A ring of light that follows a syllable: radius, width, strength 0–1. Inward when listening, outward when speaking. */
  wave: readonly [radius: number, width: number, strength: number];
  /** Seconds: the clock of the wobble. */
  time: number;
}

/** One drawable frame, in pixels relative to the centre of the stage. */
export interface Frame {
  /** Side of the stage this frame was made for. */
  size: number;
  /** Big, middle, small — always three. */
  drops: readonly [Pill, Pill, Pill];
  /** Big–middle, big–small, middle–small — always three. */
  bridges: readonly [Bridge, Bridge, Bridge];
  /** A pill cut out of everything else. No state opens it any more (listening is a body of light, not a ring): always of no size, kept so that a frame keeps its shape. */
  hole: Pill;
  /** One per drop, drawn behind everything. */
  glows: readonly [Glow, Glow, Glow];
  /** The body is filled with one linear gradient, `from` at the top left of the stage to `to` at the bottom right. */
  from: RGB;
  to: RGB;
  /** Colour of the glows. */
  halo: RGB;
  /** The light inside the body. Renderers that only fill paths may ignore it. */
  light: Light;
}

/* ───────────── Small maths ───────────── */

const TAU = Math.PI * 2;
/** The length of (x, y). Math.hypot takes any number of arguments, and gathers them on the heap: not in a loop that runs every frame. */
const length = (x: number, y: number) => Math.sqrt(x * x + y * y);
const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const smoothstep = (from: number, to: number, x: number) => {
  const t = clamp((x - from) / (to - from));
  return t * t * (3 - 2 * t);
};
/** 0 outside [a, b]; rises and falls once inside, with no corner at either end. */
const bump = (x: number, a: number, b: number) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)) ** 2);

/**
 * How a spring of perceptual `duration` and `bounce` (as in SwiftUI's
 * `Spring` and motion's `visualDuration`) moves from 0 to 1, `t` seconds
 * after it is let go. It starts at rest, so a gesture built from it never
 * jolts.
 */
export function settle(t: number, duration: number, bounce: number): number {
  if (t <= 0) return 0;
  const w = TAU / duration, z = 1 - bounce;
  if (z >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

/** A repeatable number in 0–1 for a whole number and a seed. Integer arithmetic only, so that every platform agrees to the last bit. */
export function hash(n: number, seed = 0): number {
  let h = Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul((seed | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth seeded noise, −1 … 1: a new value at each whole `x`, eased in between with no corner. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const e = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash(i, seed), b = hash(i + 1, seed);
  return 2 * (a + (b - a) * e) - 1;
}

/** Two octaves of noise: a slow wander with a little detail. Never repeats. */
const drift = (x: number, seed: number) => 0.7 * noise(x, seed) + 0.3 * noise(2.13 * x + 17.3, seed + 7);

/**
 * A breath, −1 … 1, that breathes in for 40 % of `period` and out for 60 %,
 * with no corner at either turn. Its phase wanders a little, so that two
 * breaths are never quite the same length.
 */
function breathe(t: number, period: number, seed: number): number {
  const phase = t / period + 0.08 * drift(t / 13, seed);
  const f = phase - Math.floor(phase);
  return f < 0.4 ? -Math.cos((Math.PI * f) / 0.4) : Math.cos((Math.PI * (f - 0.4)) / 0.6);
}

/**
 * How much the figure is simplified for small sizes: 0 from 72 px up, 1 at
 * 28 px and below. Tiny figures get thicker parts and no glow, like the
 * optical sizes of a typeface.
 */
export const tininess = (size: number): number => 1 - smoothstep(28, 72, size);

/* ───────────── The scene of one instant ───────────── */

/** Radius of the body at rest, in stage units: it fills half the stage. */
export const REST = 0.5;

/** Radii of the three drops when they are apart. */
const APART = [0.3, 0.22, 0.15] as const;
/** How much thicker each drop gets on a tiny figure, when apart. */
const THICKER = [0.15, 0.27, 0.5] as const;

/** The idle gestures: an irregular one every 7–14 s — mostly a glance, sometimes a settle, rarely a stretch. */
const IDLE_SLOT = 10.5;
const GLANCE = 0, SETTLE = 1, STRETCH = 2;

/** The waiting wave starts this long after the state is entered, once the body has arrived. */
const WAIT_FIRST = 0.35;

/**
 * Everything a choreography may depend on, for one instant. One object,
 * reused: the model allocates nothing per frame once a frame exists.
 */
const scene = {
  /** Counts the instants laid out, so that what three drops share is worked out once. */
  instant: 0,
  t: 0,
  level: 0,
  /** The level followed slowly: someone is talking. */
  slow: 0,
  tiny: 0,
  calm: false,
  /** 1 when the figure may travel; 0 in calm mode. */
  live: 1,
  /** How much the small gestures play: none in calm mode, none on tiny figures. */
  gate: 1,
  seed: 0,
  /** How high each speaking drop has bounced, from the voice, or null to follow the level. */
  lift: null as readonly number[] | null,
  /** The idle gesture of this instant: kind, seconds into it (negative before), side and direction. */
  idleKind: GLANCE,
  idleU: -1,
  idleSide: 1,
  idleAngle: 0,
  idleLook: 1,
  /** The waiting gesture of this instant: seconds into the current wave, and its amplitude. */
  waitU: -1,
  waitAmp: 1,
};

/** Which idle gesture plays at `t`, and how far into it: written into `scene`. A pure function of `t` and the seed. */
function idleGesture(t: number, seed: number): void {
  const n = Math.floor(t / IDLE_SLOT);
  scene.idleU = t - (n * IDLE_SLOT + 3.5 * hash(n, seed + 101));
  const kind = hash(n, seed + 202);
  scene.idleKind = kind < 0.75 ? GLANCE : kind < 0.92 ? SETTLE : STRETCH;
  scene.idleSide = hash(n, seed + 303) < 0.3 ? -1 : 1;
  scene.idleAngle = -Math.PI / 2 + scene.idleSide * (0.3 + 0.6 * hash(n, seed + 404));
  scene.idleLook = hash(n, seed + 505) < 0.5 ? -1 : 1;
}

/**
 * Where the waiting wave is, `held` seconds after waiting began: every 4.8 s
 * at first; after a minute with no answer every 6.4 s and smaller; after
 * five minutes every 9.6 s. Patience, not nagging.
 */
function waitingCycle(held: number): void {
  const x = held - WAIT_FIRST;
  if (x < 0) {
    scene.waitU = x;
    scene.waitAmp = 1;
  } else if (x < 57.6) {
    scene.waitU = x % 4.8;
    scene.waitAmp = 1;
  } else if (x < 300.8) {
    scene.waitU = (x - 57.6) % 6.4;
    scene.waitAmp = 0.7;
  } else {
    scene.waitU = (x - 300.8) % 9.6;
    scene.waitAmp = 0.6;
  }
}

/** True while an idle gesture or the waiting wave is playing at `time` (`asked`: when waiting began): the moments worth 60 frames a second. */
export function gesturing(state: PresenceState, time: number, asked: number, seed = 0): boolean {
  if (state === "idle") {
    idleGesture(time, seed);
    return scene.idleU > -0.1 && scene.idleU < 3.2;
  }
  if (state === "waiting") {
    waitingCycle(time - asked);
    return scene.waitU > -0.1 && scene.waitU < 1.6;
  }
  return false;
}

/* ───────────── The choreography ─────────────
   One function per state. Each places drop k — 0 big, 1 middle, 2 small — in
   stage units and writes x, y, w, h and angle into `pose`. */

const pose = new Float64Array(5);
const put = (x: number, y: number, w: number, h: number, angle = 0) => {
  pose[0] = x;
  pose[1] = y;
  pose[2] = w;
  pose[3] = h;
  pose[4] = angle;
};

/** The idle body of this instant, worked out once and shared by the three drops. */
const rest = { instant: -1, r: 0, x: 0, y: 0, w: 0, h: 0, turn: 0, peek: 0, look: 0 };

/** Idle — resting, content: one round body that breathes, drifts and flexes, and every few seconds a small gesture. */
function idle(k: number): void {
  if (rest.instant !== scene.instant) restAt();
  const { r, x, y, w, h, turn, peek, look } = rest;
  if (k === 0) return put(x, y, w, h, turn);
  if (k === 1) return put(x, y, 0.6, 0.6);
  // The small drop waits at the centre, out of sight, and travels just past the edge to glance.
  const rs = 0.15;
  const d = peek * (r + rs + 0.035);
  put(x + d * Math.cos(look), y + d * Math.sin(look), 2 * rs, 2 * rs);
}

/** Works out the idle body of this instant into `rest`. */
function restAt(): void {
  const { t, tiny, live, seed, gate } = scene;
  // A breath that is longer out than in, never twice the same, and a slow wander.
  const r = REST * (1 + 0.48 * tiny) * (1 + 0.035 * live * (1 - 0.5 * tiny) * breathe(t, 5, seed));
  let x = live * 0.02 * drift(t / 5.3, seed + 11);
  let y = live * 0.018 * drift(t / 6.1, seed + 13);
  // Liquid: the body is never quite round, and its long side turns slowly.
  const oval = live * 0.022 * (1 - tiny) * drift(t / 2.9, seed + 17);
  const turn = live * 0.9 * drift(t / 23, seed + 19);

  const u = scene.idleU;
  let w = 2 * r * (1 + oval), h = 2 * r * (1 - oval), peek = 0;
  if (gate > 0 && u > 0) {
    if (scene.idleKind === GLANCE) {
      // The small drop buds out, looks around, and sinks back. The body leans towards it.
      peek = gate * (settle(u, 0.55, 0.25) - settle(u - 1.55, 0.65, 0));
    } else if (scene.idleKind === SETTLE) {
      // Sinks a little and spreads, holds, rises back: making itself comfortable.
      const s = gate * (settle(u, 0.6, 0) - settle(u - 1.4, 0.7, 0.15));
      w *= 1 + 0.032 * s;
      h *= 1 - 0.032 * s;
      y += 0.02 * s;
    } else {
      // A slow stretch upwards, rarely: a kind of yawn.
      const s = gate * (settle(u, 1, 0) - settle(u - 1.2, 1.2, 0.1));
      h *= 1 + 0.05 * s;
      w *= 1 - 0.028 * s;
      y -= 0.022 * s;
    }
  }
  const look = scene.idleAngle + scene.idleLook * 0.28 * smoothstep(0.7, 1.3, u);
  x += 0.014 * peek * Math.cos(look);
  y += 0.014 * peek * Math.sin(look);
  rest.instant = scene.instant;
  rest.r = r;
  rest.x = x;
  rest.y = y;
  rest.w = w;
  rest.h = h;
  rest.turn = turn;
  rest.peek = peek;
  rest.look = look;
}

/** The juggle's reach and turn at this instant, shared by the three drops. */
const juggle = { instant: -1, reach: 0, cos: 1, sin: 0 };

/** Working — absorbed, kneading: the body parts into three drops that juggle along a figure of eight, rushing through the middle and lingering at the ends. */
function working(k: number): void {
  const { t, tiny, calm, seed } = scene;
  const r = APART[k]! * (1 + THICKER[k]! * tiny);
  if (calm) {
    // No travel: a still triangle, each drop swelling in turn.
    const a = -Math.PI / 2 + (k * TAU) / 3;
    const swell = 1 + 0.1 * Math.max(0, Math.sin((t * TAU) / 2.4 - (k * TAU) / 3));
    const reach = 0.46 - 0.06 * tiny;
    return put(reach * Math.cos(a), reach * Math.sin(a) + 0.06, 2 * r * swell, 2 * r * swell);
  }
  // A lap every 4.2 s, a third of a lap apart, each drop's phase wandering so that no two crossings match.
  const phase = (t * TAU) / 4.2 + (k * TAU) / 3 + 0.25 * drift(t / 9 + 5 * k, seed + 23 + k);
  const a = phase + 0.22 * Math.sin(2 * phase);
  // How far the figure reaches and how it is turned — about once in 40 s — are the same for the three drops.
  if (juggle.instant !== scene.instant) {
    juggle.instant = scene.instant;
    juggle.reach = 0.58 - 0.07 * tiny + 0.03 * drift(t / 7, seed + 29);
    const turn = (t * TAU) / 40 + 0.35 * drift(t / 31, seed + 31);
    juggle.cos = Math.cos(turn);
    juggle.sin = Math.sin(turn);
  }
  const x = juggle.reach * Math.sin(a), y = 0.3 * Math.sin(2 * a);
  put(x * juggle.cos - y * juggle.sin, x * juggle.sin + y * juggle.cos, 2 * r, 2 * r);
}

/** A rise that starts at rest, overshoots a little and settles: the hand's lift, then its return, `t` seconds in. */
const env = (t: number) => (t <= 0 ? 0 : (1 - Math.exp(-t / 0.08)) * Math.exp(-t / 0.45));

/** Waiting — a raised hand: the body stands, the small drop hovers above; now and then it gathers, lifts, and waves. */
function waiting(k: number): void {
  const { t, tiny, live, seed, gate } = scene;
  const size = 0.84 + 0.16 * tiny;
  const ground = 0.27 + 0.09 * tiny;
  if (k === 1) return put(0, ground, 0.5, 0.5);
  const u = scene.waitU, amp = scene.waitAmp * gate;
  if (k === 0) {
    // Standing a little taller than at rest, breathing quicker: alert.
    const stance = 0.03 * live * (1 - tiny);
    const breath = 1 + 0.02 * live * (1 - tiny) * breathe(t, 2.6, seed + 37);
    // Gather (squash), lift (the velocity stretches it), land (squash), one small rebound.
    const squash = amp * (0.06 * bump(u, 0, 0.36) + 0.045 * bump(u, 0.8, 1.12) - 0.015 * bump(u, 1.12, 1.42));
    const rise = amp * 0.075 * bump(u, 0.18, 0.92);
    const w = size * (1 - stance + squash) * breath, h = size * (1 + stance - squash) * breath;
    // The feet stay on the ground unless it rises.
    return put(0, ground + (size - h) / 2 - rise, w, h);
  }
  // The hand follows 90 ms late, flies higher, overshoots, and gives a small wave as it lands.
  const rs = 0.15 + 0.07 * tiny;
  const float = 0.02 * live * (1 - tiny) * drift(t / 1.1, seed + 41);
  const lift = amp * 0.17 * (settle(u - 0.27, 0.5, 0.4) - settle(u - 0.95, 0.55, 0.2));
  const dip = amp * 0.03 * bump(u, 0, 0.3);
  const wave = amp * 0.05 * Math.sin((TAU * (u - 0.7)) / 0.7) * env(u - 0.7);
  put(wave, -0.5 - 0.14 * tiny + float - lift + dip, 2 * rs, 2 * rs);
}

/** How loud the listening body takes the voice: mostly now, partly the last half second, so that it swells instead of twitching. */
const heard = () => 0.65 * scene.level + 0.35 * scene.slow;

/** The listening lean of this instant: now and then, even in silence, it leans in a little. */
const attention = { instant: -1, lean: 0 };

/** A small seeded lean, 0–1: one in each 6.5 s slot, 1.4 s long, so that a silent listener still looks attentive. */
function leanAt(t: number, seed: number): number {
  const n = Math.floor(t / 6.5);
  const u = t - (n * 6.5 + 2.5 * hash(n, seed + 707));
  return settle(u, 0.5, 0.1) - settle(u - 0.9, 0.7, 0);
}

/**
 * Listening — leaning in: the drops gather into one soft body, wider than it
 * is tall, its weight forward and down, that swells and comes closer with the
 * voice it hears. Light travels inward inside it; there is no hole.
 */
function listening(k: number): void {
  const { t, live, seed, tiny, gate } = scene;
  if (attention.instant !== scene.instant) {
    attention.instant = scene.instant;
    // Someone talking makes it lean in; in silence, a small lean now and then.
    attention.lean = live * Math.max(scene.slow, 0.35 * gate * leanAt(t, seed));
  }
  const lean = attention.lean, voice = heard();
  const r = (0.47 + 0.2 * tiny + (0.12 - 0.06 * tiny) * voice) * (1 + 0.03 * live * (1 - tiny) * breathe(t, 4.2, seed));
  // Never quite the same shape, like idle — but calmer than a voice.
  const sway = live * 0.016 * (1 - tiny) * drift(t / 2.7, seed + 47);
  // Closer is wider and a little shorter: the body tips towards whoever talks.
  const w = 2 * r * (1.06 + 0.05 * lean + sway), h = 2 * r * (0.96 - 0.04 * lean - sway);
  const y = 0.02 + 0.04 * lean;
  if (k === 0) return put(0, y, w, h);
  // The middle drop gathers inside; the small one rests low and forward, so the body's weight hangs towards you.
  if (k === 1) return put(0, y + 0.1 + 0.04 * lean, 0.6 + 0.2 * tiny, 0.6 + 0.2 * tiny);
  const rs = 0.17 + 0.08 * tiny;
  put(0, y + h / 2 - rs - 0.01 + 0.03 * lean, 2 * rs, 2 * rs);
}

/** Radii of the speaking dots when quiet: the middle one larger. */
const DOT = [0.19, 0.135, 0.135] as const;

/**
 * Speaking — the dots talk: three round drops in a row, each bouncing on
 * its own spring when a syllable kicks it, stretching as it rises and
 * squashing as it lands. Loud, they draw together and melt into one soft
 * liquid capsule; soft, they stay three dots.
 */
function speaking(k: number): void {
  const { t, level, tiny, calm, live } = scene;
  let lift: number;
  if (scene.lift) lift = scene.lift[k]!;
  else {
    // Without the voice's springs: each drop hears the level a little differently.
    const voice = level * (calm ? 0.6 : 0.6 + 0.4 * Math.sin(t * (k === 0 ? 9 : 7.3) + k * 2.4));
    lift = (k === 0 ? 0.18 : 0.13) * voice;
  }
  // In a pause the dots breathe, one after the other: never dead.
  const pause = 1 + 0.05 * live * (1 - tiny) * (1 - smoothstep(0, 0.15, scene.slow)) * Math.sin((TAU * (t - 0.2 * k)) / 1.6);
  const loud = live * (1 - tiny) * smoothstep(0.4, 0.9, level);
  // Louder is larger; loud, the three become one size and draw close together, so that they melt
  // into one smooth pill; their bounce is then only a soft swell along its top.
  const r = (DOT[k]! + (k === 0 ? 0.05 : 0.06) * tiny + 0.03 * level + (k === 0 ? 0 : 0.055 * loud)) * pause;
  lift *= 1 - 0.65 * loud;
  // Below rest a drop does not sink: it squashes against the floor and keeps its area.
  const squash = Math.min(0.3, Math.max(0, -lift) * 6);
  const w = 2 * r * (1 + squash), h = (2 * r) / (1 + squash);
  const x = k === 0 ? 0 : (k === 1 ? -1 : 1) * (0.44 + 0.12 * tiny - 0.2 * loud);
  // The row sits a little low, so that the bounces have room; a squashed drop keeps its feet down.
  put(x, 0.08 + r - h / 2 - Math.max(0, lift), w, h);
}

/** Offline — still and honest: a short grey dash, slightly low. Nothing here depends on time. */
function offline(): void {
  const { tiny } = scene;
  put(0, 0.2 - 0.2 * tiny, 0.58 + 0.42 * tiny, 0.085 + 0.175 * tiny);
}

const POSES = [idle, working, waiting, listening, speaking, offline] as const;

/* ───────────── What the body is made of ───────────── */

/** Per state: energy, flow (stage units a second), wobble (stage units), merge softness (stage units), rim. */
const MATTER = [
  [0.42, 0.07, 0.007, 0.16, 0.6],
  [0.62, 0.11, 0.011, 0.12, 0.8],
  [0.48, 0.04, 0.008, 0.14, 0.8],
  [0.36, 0.06, 0.003, 0.2, 0.8],
  [0.38, 0.05, 0.008, 0.07, 0.8],
  [0, 0, 0, 0.06, 0.25],
] as const;

/** How fast the inner light flows for a blend and a voice level, in stage units a second. `motion.ts` integrates it. */
export function flowRate(blend: Blend | readonly [Blend, Blend, Blend], level: number): number {
  const single = "idle" in blend;
  let rate = 0, total = 0;
  for (let s = 0; s < 6; s++) {
    const state = STATES[s]!;
    const w = single ? clamp((blend as Blend)[state]) : clamp((blend[0][state] + blend[1][state] + blend[2][state]) / 3);
    total += w;
    rate += w * (MATTER[s]![1] + (s === 3 || s === 4 ? 0.12 * clamp(level) : 0));
  }
  return total > 0 ? rate / total : 0;
}

/* ───────────── Membranes ───────────── */

const acos = (x: number) => Math.acos(clamp(x, -1, 1));

/** Writes the point at `angle`, `r` away from (x, y), into `out` at `at`. */
function point(out: number[], at: number, x: number, y: number, angle: number, r: number): void {
  out[at] = x + r * Math.cos(angle);
  out[at + 1] = y + r * Math.sin(angle);
}

/**
 * The membrane between two circles (after Hiroyuki Sato's metaballs),
 * written into `out` from `at`. It starts as a thread when the gap is
 * `reach` (by default 0.6 of the smaller radius), fattens as the circles
 * touch and fuse, and is gone again once one is inside the other — so
 * nothing ever pops.
 */
export function bridgeInto(out: number[], at: number, x1: number, y1: number, r1: number, x2: number, y2: number, r2: number, gap = 0.6 * Math.min(r1, r2)): void {
  const d = length(x2 - x1, y2 - y1);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const reach = r1 + r2 + Math.max(gap, 1e-9);
  const inside = d <= Math.abs(r1 - r2);
  if (r1 <= 0 || r2 <= 0 || d < 1e-9 || inside || d >= reach) {
    // No area: collapse onto the two points the membrane grows from.
    const pa = inside && r2 > r1 ? a + Math.PI : a, qa = inside && r1 >= r2 ? a : a + Math.PI;
    for (let i = 0; i < 8; i++) {
      if (i >= 2 && i <= 5) point(out, at + 2 * i, x2, y2, qa, r2);
      else point(out, at + 2 * i, x1, y1, pa, r1);
    }
    return;
  }

  // Quick to appear, slow to finish: a thread snaps across, then fattens. As the smaller circle
  // sinks into the larger one, the membrane narrows back to where they cross, so that it is gone
  // before the circle is inside — instead of vanishing with an area.
  const near = clamp((reach - d) / (reach - r1 - r2));
  const sunk = smoothstep(Math.abs(r1 - r2), Math.abs(r1 - r2) + 0.6 * Math.min(r1, r2), d);
  const spread = 0.5 * (1 - (1 - near) ** 2) * sunk;
  // Where the circles cross (0 when apart), and the widest the membrane may attach.
  const u1 = d < r1 + r2 ? acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)) : 0;
  const u2 = d < r1 + r2 ? acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)) : 0;
  const widest = acos((r1 - r2) / d);
  const a1 = a + u1 + (widest - u1) * spread;
  const a2 = a - u1 - (widest - u1) * spread;
  const a3 = a + Math.PI - u2 - (Math.PI - u2 - widest) * spread;
  const a4 = a - Math.PI + u2 + (Math.PI - u2 - widest) * spread;
  const p1x = x1 + r1 * Math.cos(a1), p1y = y1 + r1 * Math.sin(a1);
  const p3x = x2 + r2 * Math.cos(a3), p3y = y2 + r2 * Math.sin(a3);
  // Handles leave each circle along its tangent; shorter when the circles overlap, and never
  // so long that they cross the line between the centres — or a thin neck would knot.
  const k = Math.min(spread * 2.4, length(p1x - p3x, p1y - p3y) / (r1 + r2)) * Math.min(1, (2 * d) / (r1 + r2));
  const lean1 = a1 - a, lean2 = Math.PI - (a3 - a);
  const l1 = r1 * (lean1 < 1.5 ? Math.min(k, Math.tan(lean1)) : k), l2 = r2 * (lean2 < 1.5 ? Math.min(k, Math.tan(lean2)) : k);
  // Out along one side from the first circle to the second, back along the other.
  point(out, at, x1, y1, a2, r1);
  point(out, at + 6, x2, y2, a4, r2);
  point(out, at + 8, x2, y2, a3, r2);
  point(out, at + 14, x1, y1, a1, r1);
  point(out, at + 2, out[at]!, out[at + 1]!, a2 + Math.PI / 2, l1);
  point(out, at + 4, out[at + 6]!, out[at + 7]!, a4 - Math.PI / 2, l2);
  point(out, at + 10, out[at + 8]!, out[at + 9]!, a3 + Math.PI / 2, l2);
  point(out, at + 12, out[at + 14]!, out[at + 15]!, a1 - Math.PI / 2, l1);
}

/** The membrane between two circles, as a new array of sixteen numbers. See `bridgeInto`. */
export function bridge(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number, gap?: number): number[] {
  const out = new Array<number>(16).fill(0);
  bridgeInto(out, 0, x1, y1, r1, x2, y2, r2, gap);
  return out;
}

/* ───────────── The physics ───────────── */

/** How far apart in time the model looks to measure a drop's velocity, in seconds. */
const STEP = 1e-4;
/** Drops stretch by this much per stage unit a second, up to `STRETCH_MAX`, keeping their area. */
const STRETCH_GAIN = 0.13;
const STRETCH_MAX = 0.2;
/** How much each drop curves on its way from one state to another: the small one most. */
const ARC = [0.35, 0.5, 0.7] as const;

/** Blends of the instant and their rates, three drops × six states, in `STATES` order. */
const weights = new Float64Array(18), rates = new Float64Array(18), moved = new Float64Array(18);
/** Each state's position of the drop being placed, for the arcs. */
const spots = new Float64Array(12);
/** The figure now — per drop x, y and the half-extent tensor xx, xy, yy — and a scratch for the moment after. */
const now = new Float64Array(15), soon = new Float64Array(15);
/** Where each drop travels, now and a moment later, before gestures that only deform it: what it stretches with. */
const way = new Float64Array(6), wayAhead = new Float64Array(6);

/** What a pulse does to the body, `since` seconds after it: written into `kick`. */
const kick = { y: 0, w: 0, h: 0, hand: 0, light: 0 };

/** The design system's springs, as [duration, bounce]: pulses are gestures, and they settle like the rest of the interface. */
const GESTURE = [spring.gesture.duration, spring.gesture.bounce] as const;
const LAYOUT = [spring.layout.duration, spring.layout.bounce] as const;
const MATERIAL = [spring.material.duration, spring.material.bounce] as const;

/** Out on a spring, and back on another `hold` seconds later: 0 at rest, about 1 at its height. */
const there = (s: number, hold: number, out: readonly [number, number], back: readonly [number, number]) => settle(s, out[0], out[1]) - settle(s - hold, back[0], back[1]);

/** The height of `there`, so that each pulse can be given its size exactly. */
const peak = (hold: number, out: readonly [number, number], back: readonly [number, number]) => {
  let most = 0;
  for (let s = 0; s < 2; s += 0.002) most = Math.max(most, there(s, hold, out, back));
  return most;
};
const NOD = peak(0.16, GESTURE, GESTURE), LOWER = peak(0.55, LAYOUT, MATERIAL), RETRY = peak(0.25, GESTURE, GESTURE);

function pulseAt(pulse: Pulse | null | undefined, t: number): void {
  kick.y = kick.w = kick.h = kick.hand = kick.light = 0;
  if (!pulse) return;
  const s = t - pulse.at;
  if (s < 0 || s > 3) return;
  if (pulse.kind === "approved") {
    // A nod: down in 160 ms, back up on a springy neck. And a little light: understood.
    const nod = (0.04 * there(s, 0.16, GESTURE, GESTURE)) / NOD;
    kick.y = nod;
    kick.w = 0.5 * nod;
    kick.h = -0.6 * nod;
    kick.hand = 0.6;
    kick.light = 0.14 * (1 - Math.exp(-s / 0.04)) * Math.exp(-s / 0.35);
  } else if (pulse.kind === "denied") {
    // An exhale: the body lowers and widens a little, and the light dims, then all comes back.
    const low = there(s, 0.55, LAYOUT, MATERIAL) / LOWER;
    kick.y = 0.022 * low;
    kick.w = 0.6 * 0.022 * low;
    kick.h = -0.6 * 0.022 * low;
    kick.hand = 1;
    kick.light = -0.1 * low;
  } else {
    // Still trying: the dash lifts a hair and lengthens, then lies down again.
    const lift = there(s, 0.25, GESTURE, GESTURE) / RETRY;
    kick.y = -0.02 * lift;
    kick.w = 0.06 * lift;
    kick.hand = 1;
    kick.light = 0.05 * lift;
  }
}

/**
 * Places the three drops at time `t`, with the blends moved on by their
 * rates for `ahead` seconds: per drop, the centre and the half-extent
 * tensor — a pill's half width and half height, turned — so that shapes of
 * different states blend without caring about angles.
 */
function layout(t: number, ahead: number, changed: number | undefined, asked: number | undefined, pulse: Pulse | null | undefined, out: Float64Array, travel: Float64Array): void {
  scene.t = t;
  scene.instant++;
  idleGesture(t, scene.seed);
  waitingCycle(t - (asked ?? 0));
  pulseAt(pulse, t);
  const gate = scene.gate;
  for (let i = 0; i < 18; i++) moved[i] = weights[i]! + rates[i]! * ahead;
  // The body gathers itself before it moves: a short squash. A flat dash has nothing to gather.
  const since = changed === undefined ? -1 : t - changed;
  const flat = clamp((moved[5]! + moved[11]! + moved[17]!) / 3);
  const ready = 0.022 * gate * (1 - flat) * bump(since, 0, 0.24);

  for (let k = 0; k < 3; k++) {
    let x = 0, y = 0, xx = 0, xy = 0, yy = 0;
    for (let s = 0; s < 6; s++) {
      const w = moved[k * 6 + s]!;
      spots[2 * s] = spots[2 * s + 1] = 0;
      if (w === 0) continue;
      POSES[s]!(k);
      spots[2 * s] = pose[0]!;
      spots[2 * s + 1] = pose[1]!;
      const a = pose[2]! / 2, b = pose[3]! / 2, c = Math.cos(pose[4]!), n = Math.sin(pose[4]!);
      x += w * pose[0]!;
      y += w * pose[1]!;
      xx += w * (a * c * c + b * n * n);
      xy += w * (a - b) * n * c;
      yy += w * (a * n * n + b * c * c);
    }
    // Between two states a drop travels along an arc, not a straight line: liquid swirls.
    for (let s = 0; s < 6; s++) {
      const ws = moved[k * 6 + s]!;
      if (ws === 0) continue;
      for (let r = s + 1; r < 6; r++) {
        const both = ws * moved[k * 6 + r]! * ARC[k]! * scene.live;
        if (both === 0) continue;
        x -= both * (spots[2 * r + 1]! - spots[2 * s + 1]!);
        y += both * (spots[2 * r]! - spots[2 * s]!);
      }
    }
    travel[2 * k] = x;
    travel[2 * k + 1] = y;
    // Pulses: the nod and the exhale move the body most and the hand least; a retry lifts the dash.
    const share = k === 2 ? kick.hand : 1;
    const motion = scene.live * gate * share;
    y += motion * kick.y;
    xx *= 1 + motion * kick.w + (k === 0 ? ready : 0);
    yy *= 1 + motion * kick.h - (k === 0 ? 1.3 * ready : 0);
    xy *= 1 + motion * 0.5 * (kick.w + kick.h);
    if (k === 0) y += 0.65 * ready * yy;
    out[k * 5] = x;
    out[k * 5 + 1] = y;
    out[k * 5 + 2] = xx;
    out[k * 5 + 3] = xy;
    out[k * 5 + 4] = yy;
  }
}

/* ───────────── The model ───────────── */

/** Clamped, normalised blend averaged over the three drops: what colours and light follow. */
const average = new Float64Array(6);

/** A frame with every array in place, to be filled by `presence`. */
function emptyFrame(): Frame {
  const pill = (): Pill => ({ x: 0, y: 0, w: 0, h: 0, angle: 0 });
  const glow = (): Glow => ({ x: 0, y: 0, r: 0, alpha: 0 });
  const rgb = () => [0, 0, 0] as unknown as RGB;
  return {
    size: 0,
    drops: [pill(), pill(), pill()],
    bridges: [new Array<number>(16).fill(0), new Array<number>(16).fill(0), new Array<number>(16).fill(0)],
    hole: pill(),
    glows: [glow(), glow(), glow()],
    from: rgb(),
    to: rgb(),
    halo: rgb(),
    light: { core: rgb(), energy: 0, flow: 0, radial: 0, bloom: 0, rim: 0, wobble: 0, merge: 0, wave: [0, 0, 0], time: 0 },
  };
}

const PAIRS = [0, 1, 0, 2, 1, 2] as const;

/**
 * The presence at one instant: a pure function of its input. Pass `into` —
 * a frame this function returned before — to have it filled in place
 * instead of a new one made: a renderer then allocates nothing per frame.
 */
export function presence(input: PresenceInput, into?: Frame): Frame {
  const frame = into ?? emptyFrame();
  const { size, theme = "dark", calm = false, time: t } = input;
  const tiny = tininess(size);
  const level = clamp(input.level ?? 0) * (calm ? 0.6 : 1);
  scene.level = level;
  scene.slow = input.voice ? clamp(input.voice.slow) * (calm ? 0.6 : 1) : level;
  scene.tiny = tiny;
  scene.calm = calm;
  scene.live = calm ? 0 : 1;
  // No small gestures on tiny figures, or in calm mode.
  scene.gate = calm ? 0 : 1 - smoothstep(0, 0.6, tiny);
  scene.seed = input.seed ?? 0;
  // Calm mode follows the level itself, without the bounce of syllables.
  scene.lift = input.voice && !calm ? input.voice.lift : null;

  const blend = input.blend;
  const single = "idle" in blend;
  for (let k = 0; k < 3; k++) {
    const b = single ? (blend as Blend) : (blend as readonly Blend[])[k]!;
    const v = input.velocity?.[k];
    for (let s = 0; s < 6; s++) {
      weights[k * 6 + s] = b[STATES[s]!];
      rates[k * 6 + s] = v && !calm ? v[STATES[s]!] : 0;
    }
  }

  // Where the drops will be a moment from now, and where they are: their velocity, in stage units a second.
  // Now comes last, so that the scene is left at this instant for the light below.
  layout(t + STEP, STEP, input.changed, input.asked, input.pulse, soon, wayAhead);
  layout(t, 0, input.changed, input.asked, input.pulse, now, way);

  const u = size / 2;
  // Nothing may be thinner than two pixels.
  const least = Math.min(2 / u, 0.2);
  for (let k = 0; k < 3; k++) {
    const i = k * 5;
    // Gestures that squash or nod deform the body; only travel stretches it.
    const vx = (wayAhead[2 * k]! - way[2 * k]!) / STEP, vy = (wayAhead[2 * k + 1]! - way[2 * k + 1]!) / STEP;
    const v = length(vx, vy);
    let xx = now[i + 2]!, xy = now[i + 3]!, yy = now[i + 4]!;
    // Matter: a moving drop stretches along its travel and thins across it, keeping its area.
    const stretch = scene.live * (1 - 0.5 * tiny) * Math.min(STRETCH_MAX, STRETCH_GAIN * v);
    // The squared form of the shape, so that a stretch in any direction composes with any pill.
    let p = xx * xx + xy * xy, q = xy * (xx + yy), r = yy * yy + xy * xy;
    if (stretch > 1e-6) {
      const f = 1 + stretch, g = 1 / f, nx = vx / v, ny = vy / v;
      const m11 = g + (f - g) * nx * nx, m12 = (f - g) * nx * ny, m22 = g + (f - g) * ny * ny;
      // M · S² · M
      const a11 = m11 * p + m12 * q, a12 = m11 * q + m12 * r, a21 = m12 * p + m22 * q, a22 = m12 * q + m22 * r;
      p = a11 * m11 + a12 * m12;
      q = a11 * m12 + a12 * m22;
      r = a21 * m12 + a22 * m22;
    }
    // Back to a pill: its two half-axes and the angle of the first.
    const mean = (p + r) / 2, spread = length((p - r) / 2, q);
    let major = Math.sqrt(Math.max(0, mean + spread)), minor = Math.sqrt(Math.max(0, mean - spread));
    let angle = spread < 1e-12 ? 0 : 0.5 * Math.atan2(2 * q, p - r);
    // An upright pill stays upright: never turn more than a quarter either way, swap the sides instead.
    if (Math.abs(angle) > Math.PI / 4) {
      const side = major;
      major = minor;
      minor = side;
      angle -= Math.sign(angle) * (Math.PI / 2);
    }
    // A spring may overshoot: never let a size go negative or a drop leave the stage.
    const w = clamp(2 * major, least, 2), h = clamp(2 * minor, least, 2);
    const radius = Math.min(w, h) / 2, half = Math.max(w, h) / 2 - radius;
    const along = w >= h ? angle : angle + Math.PI / 2;
    const bx = half * Math.abs(Math.cos(along)) + radius, by = half * Math.abs(Math.sin(along)) + radius;
    const drop = frame.drops[k] as Pill;
    drop.x = clamp(now[i]!, -1 + bx, 1 - bx) * u;
    drop.y = clamp(now[i + 1]!, -1 + by, 1 - by) * u;
    drop.w = w * u;
    drop.h = h * u;
    drop.angle = Math.abs(angle) < 1e-9 ? 0 : angle;
  }

  // Colours and light follow the tint — or the average blend — kept inside 0–1 so that an overshoot cannot leave the gamut.
  let total = 0, between = 0;
  for (let s = 0; s < 6; s++) {
    const tint = input.tint?.[STATES[s]!];
    average[s] = clamp(tint ?? (weights[s]! + weights[6 + s]! + weights[12 + s]!) / 3);
    total += average[s]!;
  }
  // How far between two states each drop is: 0 at rest, 1 half-way. It grows from nothing, so it never pops.
  for (let k = 0; k < 3; k++) {
    let square = 0;
    for (let s = 0; s < 6; s++) square += weights[k * 6 + s]! ** 2;
    between = Math.max(between, clamp(2 * (1 - square)));
  }
  for (let s = 0; s < 6; s++) average[s] = total > 0 ? average[s]! / total : s === 0 ? 1 : 0;
  mixInto(frame.from as unknown as number[], average, theme, "from");
  mixInto(frame.to as unknown as number[], average, theme, "to");
  mixInto(frame.halo as unknown as number[], average, theme, "halo");
  const light = frame.light as { -readonly [K in keyof Light]: Light[K] };
  mixInto(light.core as unknown as number[], average, theme, "core");

  let glow = 0, energy = 0, wobble = 0, merge = 0, rim = 0;
  const looks = PALETTE[theme];
  for (let s = 0; s < 6; s++) {
    const w = average[s]!;
    glow += w * looks[STATES[s]!].glow;
    energy += w * MATTER[s]![0];
    wobble += w * MATTER[s]![2];
    merge += w * MATTER[s]![3];
    rim += w * MATTER[s]![4];
  }
  const listen = average[3]!, speak = average[4]!, work = average[1]!, wait = average[2]!;
  energy += listen * 0.3 * level + speak * 0.5 * level;
  wobble += speak * 0.004 * level;
  // Loud, the speaking dots melt into one smooth capsule.
  merge += speak * 0.22 * smoothstep(0.4, 0.9, level);
  // Working drops brighten and melt more as they cross, as if they traded energy.
  let crossing = 0;
  for (let i = 0; i < 6; i += 2) {
    const a = frame.drops[PAIRS[i]!], b = frame.drops[PAIRS[i + 1]!];
    const gap = length(a.x - b.x, a.y - b.y) / u - (Math.min(a.w, a.h) + Math.min(b.w, b.h)) / (2 * u);
    crossing = Math.max(crossing, 1 - smoothstep(-0.05, 0.12, gap));
  }
  merge += work * 0.05 * crossing;
  energy += work * 0.08 * crossing;
  // Necks stretch further while the figure changes.
  merge *= 1 + 0.6 * between;

  // Waiting: the light swells with each wave.
  const wave = scene.waitU;
  const swell = wait * scene.gate * scene.waitAmp * (wave > 0 ? (1 - Math.exp(-wave / 0.12)) * Math.exp(-Math.max(0, wave - 0.4) / 0.8) : 0);
  // Calm mode keeps a breath of light, which is not motion.
  const calmBreath = calm ? 0.03 * breathe(t, 5.6, scene.seed) : 0;
  const flash = (1 - tiny) * kick.light;
  const pixelsAlive = smoothstep(40, 56, size);

  // On a light surface the light inside is a pearly sheen on ink: there, it is all there is to show.
  light.energy = theme === "light" ? 0.55 * clamp(energy) : clamp(energy * (1 + calmBreath) + flash);
  light.flow = input.flow ?? t * flowRate(input.blend, level);
  light.radial = speak - listen;
  light.bloom = clamp((glow * (1 + 0.5 * level) + 0.08 * swell + flash) * (1 + 3 * calmBreath) * (1 - tiny));
  // The edge's light; on a light surface it is the black pearl's gloss.
  light.rim = rim * smoothstep(24, 40, size);
  light.wobble = wobble * scene.live * pixelsAlive * u;
  light.merge = merge * u;
  light.time = t;

  // Glows for renderers that paint them: each drop glows in proportion to its area, so three drops in one place shine like one.
  const glowing = light.bloom;
  const area0 = frame.drops[0].w * frame.drops[0].h, area1 = frame.drops[1].w * frame.drops[1].h, area2 = frame.drops[2].w * frame.drops[2].h;
  const whole = area0 + area1 + area2 || 1;
  for (let k = 0; k < 3; k++) {
    const drop = frame.drops[k]!, g = frame.glows[k] as Glow;
    g.x = drop.x;
    g.y = drop.y;
    g.r = Math.max(0, Math.min(Math.max(drop.w, drop.h) * 0.5 + 0.34 * u, 1.25 * u - length(drop.x, drop.y)));
    g.alpha = Math.min(1, glowing * (0.4 + 0.6 * ((k === 0 ? area0 : k === 1 ? area1 : area2) / whole)));
  }

  // Membranes, for renderers that fill paths: a thread starts where the shader's smooth union
  // starts to join two edges (half the merge distance), so that both renderers melt drops alike.
  for (let i = 0; i < 6; i += 2) {
    const a = frame.drops[PAIRS[i]!], b = frame.drops[PAIRS[i + 1]!];
    const ra = Math.min(a.w, a.h) / 2, rb = Math.min(b.w, b.h) / 2;
    bridgeInto(frame.bridges[i / 2] as number[], 0, a.x, a.y, ra, b.x, b.y, rb, 0.5 * light.merge);
  }

  // No state opens a hole any more: listening is a body of light, not a ring.
  const big = frame.drops[0];
  const hole = frame.hole as Pill;
  hole.x = big.x;
  hole.y = big.y;
  hole.w = hole.h = 0;
  hole.angle = 0;

  // A syllable sends a ring of light: inward through the listening body, outward from the speaking row.
  const ring = light.wave as unknown as number[];
  ring[0] = ring[1] = ring[2] = 0;
  // On a light surface a ring of ink would only read as a grey halo: no ring there.
  if (input.voice && !calm && tiny < 0.5 && theme === "dark") {
    const since = t - input.voice.onset, strength = clamp(input.voice.strength);
    if (since >= 0 && since < 0.6 && listen > 0.01) {
      const outer = Math.max(big.w, big.h) / 2;
      const e = 1 - (1 - since / 0.6) ** 2;
      ring[0] = outer * (0.95 - 0.55 * e);
      ring[1] = 0.07 * u;
      ring[2] = listen * 0.16 * strength * (1 - since / 0.6) ** 1.5;
    } else if (since >= 0 && since < 0.7 && speak > 0.01) {
      const e = 1 - (1 - since / 0.7) ** 3;
      ring[0] = (0.55 + 0.6 * e) * u;
      ring[1] = 0.09 * u;
      ring[2] = speak * 0.07 * strength * (1 - since / 0.7) ** 2;
    }
  }

  frame.size = size;
  return frame;
}

/** A blend that shows a single state. */
export function only(state: PresenceState): Blend {
  return { idle: 0, working: 0, waiting: 0, listening: 0, speaking: 0, offline: 0, [state]: 1 };
}
