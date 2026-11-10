/**
 * Playground: every state, every change of state, the answers, at every
 * size, on black and on a light surface, drawn with light or with paths,
 * with a simulated voice, a slider or the real microphone.
 *
 *   ?state=working&size=600&surface=light&calm=1&renderer=2d   start somewhere else
 *   ?bare                                                      only the presence
 *
 * Keys: 1–6 a state · A "go ahead" · S "stop" · R a reconnection attempt · T replay the transition.
 */

import { createPresence, STATES, type Presence, type PresenceState, type PulseKind, type Renderer } from "../src/index.js";

const query = new URLSearchParams(location.search);
const root = document.documentElement;

const LINES: Record<PresenceState, string> = {
  idle: "Good evening, Alex.",
  working: "Running the tests",
  waiting: "I have a question.",
  listening: "I'm listening",
  speaking: "Done — want me to deploy?",
  offline: "Can't reach your computer.",
};

let state = (query.get("state") as PresenceState | null) ?? "idle";
let size = Number(query.get("size") ?? 360);
let voice: "simulated" | "slider" | "microphone" = "simulated";
let slider = 0.5;
let calm = query.has("calm");
let renderer = (query.get("renderer") as "auto" | Renderer | null) ?? "auto";
let from: PresenceState = "idle", to: PresenceState = "working";
root.dataset.surface = query.get("surface") ?? "dark";
if (query.has("bare")) root.dataset.bare = "";

const stage = document.getElementById("stage")!;
const line = document.getElementById("line")!;
const status = document.getElementById("status")!;
const SMALL = query.has("bare") ? [] : [16, 20, 24, 32, 48, 64, 96];
const boxes = SMALL.map((side) => {
  const box = document.createElement("div");
  const figure = document.createElement("figure");
  figure.append(box, `${side}`);
  document.getElementById("sizes")!.append(figure);
  return box;
});

let main: Presence;
let small: Presence[] = [];
let all: Presence[] = [];

/** Makes every presence again: a renderer is chosen once, when a presence is created. */
function build(): void {
  for (const p of all) p.destroy();
  main = createPresence(stage, { size, state, renderer });
  small = boxes.map((box, i) => createPresence(box, { size: SMALL[i], state, renderer }));
  all = [main, ...small];
  apply();
}

/** A voice-like level: syllables in bursts, with pauses. */
function simulated(t: number): number {
  const syllables = Math.abs(Math.sin(t * 2.9) * Math.sin(t * 7.3 + 1)) ** 0.7;
  const phrase = Math.sin(t * 0.55) > -0.6 ? 0.55 + 0.45 * Math.sin(t * 0.9) : 0;
  return Math.min(1, syllables * phrase * 1.3);
}

/** The microphone level, 0–1, once the browser allows it. */
let heard = () => 0;
async function listen(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  audio.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  heard = () => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    return Math.min(1, rms * 6);
  };
}

function apply(): void {
  line.textContent = LINES[state];
  for (const p of all) p.set({ state, calm: calm || "auto", theme: root.dataset.surface === "light" ? "light" : "dark" });
  // Through `set`, a change of size is eased: the presence steps aside, it does not jump.
  main.set({ size });
  status.textContent = `${main.renderer === "webgl" ? "light (WebGL)" : "paths (Canvas 2D)"} · ${state}`;
  syncButtons();
}

/** Every row of buttons shows which of its values is chosen. */
const syncs: (() => void)[] = [];
const syncButtons = () => syncs.forEach((sync) => sync());

/** A row of buttons where one is pressed. */
function group<T extends string>(label: string, values: readonly T[], current: () => T | null, choose: (value: T) => void, parent = "controls"): HTMLElement {
  const box = document.createElement("div");
  box.className = "group";
  box.append(Object.assign(document.createElement("span"), { textContent: label }));
  const sync = () => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.value === current())));
  for (const value of values) {
    const button = Object.assign(document.createElement("button"), { value, textContent: value });
    button.onclick = () => {
      choose(value);
      apply();
    };
    box.append(button);
  }
  syncs.push(sync);
  document.getElementById(parent)!.append(box);
  return box;
}

/** A row of buttons that each do something once. */
function actions(label: string, list: readonly (readonly [string, string, () => void])[], parent = "actions"): void {
  const box = document.createElement("div");
  box.className = "group";
  box.append(Object.assign(document.createElement("span"), { textContent: label }));
  for (const [text, title, act] of list) {
    const button = Object.assign(document.createElement("button"), { textContent: text, title });
    button.onclick = act;
    box.append(button);
  }
  document.getElementById(parent)!.append(box);
}

const go = (next: PresenceState) => {
  state = next;
  apply();
};
const pulse = (kind: PulseKind) => {
  for (const p of all) p.pulse(kind);
};
let timer = 0;
/** Shows `from`, lets it settle, then changes to `to`. */
const replay = () => {
  clearTimeout(timer);
  go(from);
  timer = window.setTimeout(() => go(to), 1600);
};
/** The owner answers a request: the presence nods (or lowers its hand), then the agent moves on. */
const answer = (kind: "approved" | "denied") => {
  clearTimeout(timer);
  if (state !== "waiting") {
    go("waiting");
    timer = window.setTimeout(() => answer(kind), 2200);
    return;
  }
  pulse(kind);
  // The computer acknowledges a moment later, as it would in the app.
  timer = window.setTimeout(() => go(kind === "approved" ? "working" : "idle"), 150);
};
/** A reconnection attempt, offline. */
const retry = () => {
  if (state !== "offline") {
    go("offline");
    timer = window.setTimeout(retry, 1400);
    return;
  }
  pulse("retry");
};

group("State", STATES, () => state, (v) => (state = v));
group("Size", ["96", "240", "360", "600"], () => String(size), (v) => (size = Number(v)));
group("Surface", ["dark", "light"], () => root.dataset.surface as "dark" | "light", (v) => (root.dataset.surface = v));
group("Motion", ["full", "calm"], () => (calm ? "calm" : "full"), (v) => (calm = v === "calm"));
group("Renderer", ["auto", "webgl", "2d"] as const, () => renderer, (v) => {
  renderer = v;
  build();
});
const voices = group("Voice", ["simulated", "slider", "microphone"], () => voice, (v) => {
  voice = v;
  if (v === "microphone") void listen();
});
const range = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "1", step: "0.01", value: String(slider) });
range.oninput = () => {
  slider = Number(range.value);
  voice = "slider";
  syncButtons();
};
voices.append(range);

group("From", STATES, () => from, (v) => (from = v), "actions");
group("To", STATES, () => to, (v) => (to = v), "actions");
actions("Transition", [["▶ Replay", "Show “from”, then change to “to” (T)", replay]]);
actions("Answers", [
  ["Go ahead", "Waiting → nod → working (A)", () => answer("approved")],
  ["Stop", "Waiting → lowered hand → idle (S)", () => answer("denied")],
  ["Reconnect", "Offline → one lift (R)", retry],
]);

addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const next = STATES[Number(event.key) - 1];
  if (next) return go(next);
  const key = event.key.toLowerCase();
  if (key === "a") answer("approved");
  else if (key === "s") answer("denied");
  else if (key === "r") retry();
  else if (key === "t") replay();
});

build();
requestAnimationFrame(function feed(now) {
  const level = voice === "simulated" ? simulated(now / 1000) : voice === "slider" ? slider : heard();
  for (const p of all) p.set({ level });
  requestAnimationFrame(feed);
});
