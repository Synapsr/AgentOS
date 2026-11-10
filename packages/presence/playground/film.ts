/**
 * A short film of the presence going through every state, each one named on
 * screen. Plays in a loop; `window.film.render(t)` draws any instant, which
 * is how docs/presence/presence.mp4 and .gif are recorded frame by frame.
 *
 *   ?scale=2    pixels per unit (default 1: 1280 × 720)
 *   ?short      a tighter cut, for the GIF
 *   ?plain      no captions
 *   ?paths      draw with paths (Canvas 2D) instead of light
 *   ?light      a black pearl on a light surface
 */

import { createMotion, createPainter, inputOf, presence, pulse, stepMotion, type Frame, type Motion, type PresenceState, type PulseKind } from "../src/index.js";

const query = new URLSearchParams(location.search);
const WIDTH = 1280, HEIGHT = 720, STAGE = 440;
const scale = Number(query.get("scale") ?? 1);
const short = query.has("short");
const theme = query.has("light") ? "light" : "dark";
const ink = theme === "light" ? "29,27,25" : "245,243,240";

/** The scenes: a state, how long it is held, what is written under it, and a pulse partway through. */
type Scene = readonly [state: PresenceState, seconds: number, caption: string, pulse?: readonly [at: number, kind: PulseKind]];
const SCENES: readonly Scene[] = [
  ["idle", short ? 5 : 7, "Resting. It breathes, drifts, and now and then looks around."],
  ["working", short ? 4.5 : 6, "Working: three drops knead and juggle, stretching as they travel."],
  ["waiting", short ? 4.2 : 5.4, "It needs you: a raised hand, a small wave."],
  ["waiting", 0.9, "“Go ahead.” A nod.", [0.5, "approved"]],
  ["working", short ? 2 : 2.6, "“Go ahead.” A nod."],
  ["listening", short ? 3.5 : 4.5, "Listening: it leans in, and takes your words in."],
  ["speaking", short ? 3.5 : 4.5, "Speaking: the drops bounce on every syllable."],
  ["offline", short ? 3 : 3.6, "Offline: still. A small lift each time it tries again.", [1.8, "retry"]],
  ["idle", 2, "Resting."],
];
const duration = SCENES.reduce((sum, scene) => sum + scene[1], 0);

const canvas = document.getElementById("film") as HTMLCanvasElement;
canvas.width = WIDTH * scale;
canvas.height = HEIGHT * scale;
canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
const ctx = canvas.getContext("2d")!;
// The presence is drawn on a canvas of its own, then laid on the film.
const light = document.createElement("canvas");
light.width = light.height = Math.round(STAGE * 1.25 * scale);
const painter = createPainter(light, query.has("paths") ? "2d" : "auto");

/** A voice-like level: syllables in bursts, with pauses. */
function voice(t: number): number {
  const syllables = Math.abs(Math.sin(t * 2.9) * Math.sin(t * 7.3 + 1)) ** 0.7;
  const phrase = Math.sin(t * 0.55 + 0.6) > -0.6 ? 0.6 + 0.4 * Math.sin(t * 0.9) : 0;
  return Math.min(1, syllables * phrase * 1.4);
}

const sceneAt = (t: number) => {
  let start = 0;
  for (const scene of SCENES) {
    if (t < start + scene[1]) return { scene, since: t - start };
    start += scene[1];
  }
  return { scene: SCENES[SCENES.length - 1]!, since: 0 };
};

const STEP = 1 / 240;
let motion: Motion;
let frame: Frame | undefined;
let clock = Infinity;

/** Draws the film at `t` seconds. Any `t` gives the same picture, whatever was drawn before. */
function render(t: number): void {
  t = Math.min(Math.max(t, 0), duration - STEP);
  if (t < clock) {
    // Start again — on a seed whose first idle gesture is a glance, early enough to be seen.
    motion = createMotion("idle", STAGE, 28);
    clock = 0;
  }
  while (clock + STEP <= t) {
    const before = sceneAt(clock);
    clock += STEP;
    const { scene, since } = sceneAt(clock);
    const cue = scene[3];
    if (cue && since >= cue[0] && (before.scene !== scene || before.since < cue[0])) pulse(motion, cue[1]);
    stepMotion(motion, { state: scene[0], level: voice(clock), size: STAGE }, STEP);
  }

  frame = presence(inputOf(motion, STAGE, { theme }), frame);
  painter.draw(frame, scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme === "light" ? "#F3F2F0" : "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = motion.alpha;
  const top = (query.has("plain") ? HEIGHT / 2 : 288) * scale - light.height / 2;
  ctx.drawImage(light, (WIDTH * scale - light.width) / 2, top);
  ctx.globalAlpha = 1;
  if (query.has("plain")) return;

  // Captions fade with the scene.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const { scene, since } = sceneAt(t);
  const fade = Math.min(1, since / 0.3, (scene[1] - since) / 0.2);
  ctx.textAlign = "center";
  ctx.fillStyle = `rgba(${ink},${fade})`;
  ctx.font = '360 46px Figtree, -apple-system, "SF Pro Display", system-ui, sans-serif';
  ctx.letterSpacing = "-1px";
  ctx.fillText(scene[0], WIDTH / 2, 592);
  ctx.fillStyle = `rgba(${ink},${0.6 * fade})`;
  ctx.font = '400 19px Figtree, -apple-system, "SF Pro Text", system-ui, sans-serif';
  ctx.letterSpacing = "0px";
  ctx.fillText(scene[2], WIDTH / 2, 634);
}

Object.assign(window, { film: { duration, render } });

if (!query.has("still")) {
  const start = performance.now();
  requestAnimationFrame(function play(now) {
    render(((now - start) / 1000) % duration);
    requestAnimationFrame(play);
  });
}
