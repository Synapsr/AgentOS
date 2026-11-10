/**
 * The hero scene: a short conversation between Alex and Nova, played as a
 * list of beats. Each beat sets the presence's state and what the phone
 * shows; the clock only runs while the scene is playing and on screen.
 *
 * The visitor can pause it, jump to a chapter, and answer Nova's question
 * with the real buttons. With reduced motion it does not play by itself: it
 * waits on the question, and moves only when asked to.
 */
import { createPresence, type PresenceState } from "@agentos/presence";
import type { Copy } from "../i18n";
import { reducedMotion, voiceLevel } from "./voice";

type Lines = Copy["scene"];
type Answer = "go" | "stop";

interface Beat {
  chapter: number;
  state: PresenceState;
  /** How long it lasts, in milliseconds. 0: the end. */
  ms: number;
  mode: "home" | "request";
  /** Nova's line under the presence. */
  line?: string;
  /** Alex's words, appearing in the composer as they are said. */
  said?: string;
  /** Alex answers the question out loud. */
  aloud?: boolean;
  /** The answer being given. */
  chosen?: Answer;
  /** Someone is talking: feed the presence a voice. */
  voice?: boolean;
  /** The question: the buttons work. */
  ask?: boolean;
}

function beats(s: Lines) {
  const intro: Beat[] = [
    { chapter: 0, state: "idle", ms: 1500, mode: "home", line: s.greeting },
    { chapter: 0, state: "listening", ms: 3000, mode: "home", line: s.listening, said: s.ask, voice: true },
    { chapter: 1, state: "speaking", ms: 2200, mode: "home", line: s.onIt, voice: true },
    ...s.steps.map((line): Beat => ({ chapter: 1, state: "working", ms: 1300, mode: "home", line })),
    { chapter: 2, state: "waiting", ms: 5500, mode: "request", ask: true },
  ];
  const byVoice: Beat[] = [
    { chapter: 3, state: "listening", ms: 1300, mode: "request", ask: true, aloud: true, voice: true },
    { chapter: 3, state: "listening", ms: 500, mode: "request", aloud: true, chosen: "go" },
  ];
  const tails: Record<Answer, Beat[]> = {
    go: [
      { chapter: 3, state: "speaking", ms: 1300, mode: "home", line: s.deploying, voice: true },
      { chapter: 3, state: "working", ms: 1900, mode: "home", line: s.deployStep },
      { chapter: 3, state: "speaking", ms: 1500, mode: "home", line: s.done, voice: true },
      { chapter: 3, state: "idle", ms: 0, mode: "home", line: s.done },
    ],
    stop: [
      { chapter: 3, state: "speaking", ms: 2200, mode: "home", line: s.stopped, voice: true },
      { chapter: 3, state: "idle", ms: 0, mode: "home", line: s.stopped },
    ],
  };
  return { intro, byVoice, tails };
}

/** Starts the scene in `root` (a `[data-scene]` figure). */
export function startScene(root: HTMLElement): void {
  const s = JSON.parse(root.dataset.copy!) as Lines;
  const { intro, byVoice, tails } = beats(s);
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

  const screen = $("[data-mode]");
  const layers = { home: $("[data-layer=home]"), request: $("[data-layer=request]") };
  const line = $("[data-line]");
  const said = $("[data-said]");
  const aloud = $("[data-aloud]");
  const live = $("[data-live]");
  const answers = $("[data-answers]");
  const play = $<HTMLButtonElement>("[data-play]");
  const chapters = [...root.querySelectorAll<HTMLButtonElement>("[data-chapter]")];
  const presence = createPresence($("[data-stage]"), { state: "idle" });

  let path: Beat[] = [...intro, ...byVoice, ...tails.go];
  let index = 0;
  let elapsed = 0;
  let playing = false;
  let visible = false;
  let frame = 0;
  let last = 0;
  let shown: Beat | undefined;

  const beat = () => path[index]!;
  const ended = () => beat().ms === 0;

  /** Alex's words, one span per word, so they can appear one by one. */
  function sayWords(text: string | undefined) {
    said.replaceChildren(
      ...(text ?? "").split(" ").filter(Boolean).flatMap((word, i) => {
        const span = Object.assign(document.createElement("span"), { className: "word", textContent: word });
        return i ? [" ", span] : [span];
      }),
    );
  }

  /** Nova's line: a 280 ms cross-fade, as in the product. A newer line cancels one still fading. */
  let lineText = line.textContent;
  function setLine(text: string) {
    if (text === lineText) return;
    lineText = text;
    const fade = reducedMotion() ? 70 : 140;
    line.getAnimations().forEach((a) => a.cancel());
    line.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade, easing: "ease-in" }).finished.then(
      () => {
        line.textContent = text;
        line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: "ease-out" });
      },
      () => {},
    );
  }

  /** Shows the current beat. Called when it changes. */
  function render() {
    const now = beat();
    if (now !== shown) {
      screen.dataset.mode = now.mode;
      layers.home.inert = now.mode !== "home";
      layers.request.inert = now.mode !== "request";
      presence.set({ state: now.state, level: 0 });
      if (now.line) setLine(now.line);
      if (now.said !== shown?.said) sayWords(now.said);
      aloud.classList.toggle("on", !!now.aloud);
      live.classList.toggle("on", !!now.voice);
      if (now.chosen) answers.dataset.chosen = now.chosen;
      else delete answers.dataset.chosen;
      for (const button of answers.querySelectorAll("button")) button.disabled = !now.ask;
      shown = now;
    }
    // Alex's words appear as they are said; a still frame shows them all.
    const words = said.querySelectorAll(".word");
    const heard = playing && now.said ? Math.ceil((elapsed / (now.ms * 0.8)) * words.length) : words.length;
    words.forEach((word, i) => word.classList.toggle("on", i < heard));
    progress();
    play.dataset.status = playing ? "playing" : ended() ? "ended" : "paused";
    play.setAttribute("aria-label", playing ? s.pause : ended() ? s.replay : s.play);
  }

  /** How far each chapter has gone, on its track. */
  function progress() {
    const current = beat().chapter;
    chapters.forEach((button, chapter) => {
      let done = 0;
      let total = 0;
      path.forEach((b, i) => {
        if (b.chapter !== chapter) return;
        total += b.ms;
        if (i < index) done += b.ms;
        else if (i === index) done += Math.min(elapsed, b.ms);
      });
      const value = chapter < current || (chapter === current && ended()) ? 1 : chapter > current || !total ? 0 : done / total;
      button.style.setProperty("--progress", value.toFixed(4));
      if (chapter === current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
  }

  function tick(now: number) {
    frame = 0;
    if (!playing || !visible || document.hidden) return;
    elapsed += Math.min(now - last, 100);
    last = now;
    const current = beat();
    if (current.ms && elapsed >= current.ms) {
      index += 1;
      elapsed = 0;
      if (ended()) playing = false;
    }
    const b = beat();
    presence.set({ level: b.voice ? voiceLevel(elapsed / 1000, b.ms / 1000) : 0 });
    render();
    if (playing) schedule();
  }

  function schedule() {
    if (frame || !playing || !visible || document.hidden) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function setPlaying(on: boolean) {
    playing = on;
    if (on && ended()) {
      path = [...intro, ...byVoice, ...tails.go];
      index = 0;
      elapsed = 0;
    }
    render();
    schedule();
  }

  /** From now on, the visitor is in charge: let screen readers hear Nova. */
  function engaged() {
    line.setAttribute("aria-live", "polite");
  }

  play.hidden = false;
  play.addEventListener("click", () => {
    engaged();
    setPlaying(!playing);
  });

  chapters.forEach((button, chapter) =>
    button.addEventListener("click", () => {
      engaged();
      path = [...intro, ...byVoice, ...tails.go];
      index = path.findIndex((b) => b.chapter === chapter);
      elapsed = 0;
      setPlaying(!reducedMotion() || playing);
    }),
  );

  answers.addEventListener("click", (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-answer]")?.dataset.answer as Answer | undefined;
    if (!choice || !beat().ask) return;
    engaged();
    const asking = path.findIndex((b) => b.ask);
    const answering: Beat = { chapter: 3, state: beat().state, ms: 450, mode: "request", chosen: choice };
    path = [...path.slice(0, asking + 1), answering, ...tails[choice]];
    index = asking + 1;
    elapsed = 0;
    // Answering is the visitor's own doing: the scene plays on to Nova's reply, even with reduced motion.
    setPlaying(true);
  });

  new IntersectionObserver(([entry]) => {
    visible = entry!.isIntersecting;
    schedule();
  }, { threshold: 0.2 }).observe(root);
  document.addEventListener("visibilitychange", schedule);

  if (reducedMotion()) {
    // A still frame that tells the most: Nova asking.
    index = path.findIndex((b) => b.ask);
    render();
  } else {
    setPlaying(true);
  }
}
