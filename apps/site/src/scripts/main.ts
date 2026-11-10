/**
 * The page's only script. It brings every presence to life, plays the
 * scene, and wires the few things that respond: the request cards, the copy
 * buttons, "Look closer", the pointer hint in OS mode.
 */
import { createPresence, type Presence, type PresenceState } from "@agentos/presence";
import { startScene } from "./scene";
import { reducedMotion } from "./voice";

/** Every presence on the page, by the element it lives in, so that a request can make its own react. */
const presences = new Map<HTMLElement, Presence>();

/**
 * Calls `wake` once `element` comes near the screen. Each presence costs a
 * GPU context and its shaders, so the first screen only pays for its own and
 * the others wake as the visitor scrolls to them.
 */
function whenNear(element: HTMLElement, wake: () => void) {
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry!.isIntersecting) return;
      near.disconnect();
      wake();
    },
    { rootMargin: "300px 0px" },
  );
  near.observe(element);
}

for (const element of document.querySelectorAll<HTMLElement>("[data-presence]")) {
  whenNear(element, () => presences.set(element, createPresence(element, { state: element.dataset.presence as PresenceState })));
}

const scene = document.querySelector<HTMLElement>("[data-scene]");
if (scene) whenNear(scene, () => startScene(scene));

/** The layout spring, read from the tokens so that the script moves like the stylesheet. */
const style = getComputedStyle(document.documentElement);
const layout = {
  duration: parseFloat(style.getPropertyValue("--spring-layout-duration")) || 670,
  easing: style.getPropertyValue("--spring-layout").trim() || "ease-out",
};

/** Changes what `box` holds, and lets its height travel to the new one on the layout spring instead of jumping. */
function fold(box: HTMLElement, change: () => void) {
  const from = box.offsetHeight;
  change();
  const to = box.offsetHeight;
  if (reducedMotion() || from === to) return;
  // Clipped while it moves, so that the taller of the two never spills over what follows; the margin keeps the shadow.
  box.style.overflow = "clip";
  box.style.setProperty("overflow-clip-margin", "48px");
  box.animate({ height: [`${from}px`, `${to}px`] }, layout).finished.finally(() => {
    box.style.removeProperty("overflow");
    box.style.removeProperty("overflow-clip-margin");
  });
}

/**
 * A request card: answering plays the Resolve choreography (the chosen
 * button answers at once, the other fades, then the card folds into its
 * receipt) and the presence that asked reacts. "Ask again" unfolds it.
 */
for (const ask of document.querySelectorAll<HTMLElement>("[data-request]")) {
  const card = ask.querySelector<HTMLElement>("[data-card]")!;
  const tray = ask.querySelector<HTMLElement>("[data-tray]")!;
  const receipt = ask.querySelector<HTMLElement>("[data-receipt]")!;
  const said = ask.querySelector<HTMLElement>("[data-said]")!;
  const again = ask.querySelector<HTMLButtonElement>("[data-again]")!;
  const stage = ask.dataset.presenceOf ? document.getElementById(ask.dataset.presenceOf) : null;
  // Looked up when answering: the presence may have woken after the page loaded.
  const presence = () => (stage ? presences.get(stage) : undefined);
  // The surface the presence lights takes its state too, so that its light follows.
  const lit = stage?.closest<HTMLElement>("[data-scene-state]");
  const timers: number[] = [];
  const later = (ms: number, then: () => void) => timers.push(window.setTimeout(then, reducedMotion() ? 0 : ms));
  const show = (state: PresenceState) => {
    presence()?.set({ state });
    if (lit) lit.dataset.sceneState = state;
  };

  tray.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-answer]");
    const answer = button?.dataset.answer;
    if (!button || !answer || tray.dataset.chosen) return;
    tray.dataset.chosen = answer;
    button.querySelector(".swap")?.classList.add("on");
    presence()?.pulse(answer === "go" ? "approved" : "denied");
    later(280, () => {
      receipt.dataset.answer = answer;
      fold(ask, () => (ask.dataset.state = "answered"));
      said.textContent = button.dataset.outcome ?? "";
      again.focus({ preventScroll: true });
      if (answer === "go") {
        show("working");
        later(2200, () => show("idle"));
      } else {
        show("idle");
      }
    });
  });

  again.addEventListener("click", () => {
    timers.splice(0).forEach(clearTimeout);
    fold(ask, () => {
      ask.dataset.state = "pending";
      delete tray.dataset.chosen;
      tray.querySelectorAll(".swap.on").forEach((swap) => swap.classList.remove("on"));
    });
    said.textContent = "";
    card.focus({ preventScroll: true });
    show("waiting");
  });
}

// Copy buttons: the text goes to the clipboard, the button says so, then says Copy again.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-text]")) {
  const label = button.querySelector<HTMLElement>("[data-label]")!;
  const swap = button.querySelector(".swap");
  let timer = 0;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyText!);
    } catch {
      return;
    }
    label.textContent = button.dataset.copied!;
    swap?.classList.add("on");
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      label.textContent = button.dataset.copy!;
      swap?.classList.remove("on");
    }, 1600);
  });
}

// "Look closer": the picture, as large as the window allows. A click outside it closes it, as Esc does.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-closer]")) {
  const view = document.getElementById(button.dataset.closer!) as HTMLDialogElement | null;
  if (!view) continue;
  button.addEventListener("click", () => view.showModal());
  view.addEventListener("click", (event) => {
    if (event.target === view) view.close();
  });
}

// The recording's poster loads only as it comes near, so that the first screen stays light.
for (const video of document.querySelectorAll<HTMLVideoElement>("video[data-poster]")) {
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry!.isIntersecting) return;
      video.poster = video.dataset.poster!;
      near.disconnect();
    },
    { rootMargin: "800px" },
  );
  near.observe(video);
}

// OS mode: moving the pointer reveals "Take back control", as on the real screen.
for (const screen of document.querySelectorAll<HTMLElement>("[data-os]")) {
  let timer = 0;
  screen.addEventListener("pointermove", () => {
    screen.dataset.pointer = "";
    clearTimeout(timer);
    timer = window.setTimeout(() => delete screen.dataset.pointer, 1800);
  });
}
