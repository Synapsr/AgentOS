import { useInsertionEffect, useSyncExternalStore } from "react";
import { duration, ease, motion as choreography, spring as springs } from "@agentos/design";

/** What a view is drawn on (docs/DESIGN.md, "Surfaces and depth"). */
export type SurfaceKind =
  /** The presence's stage, always dark: OS mode (and the presence gallery). */
  | "presence"
  /** The presence's stage, following the owner's appearance: home, panel, onboarding. */
  | "stage"
  /** A page to read and set things on, following the owner's appearance: settings, add your phone. */
  | "utility";

/** Set by the demo (`&appearance=light`) so that both appearances can be shown without changing the system's. */
let forced: "light" | "dark" | null = null;

/** Makes every surface that follows the appearance take this one instead. Demo and screenshots only. */
export function forceAppearance(appearance: "light" | "dark" | null): void {
  forced = appearance;
}

/**
 * Says what kind of surface a view is. It is set on the root before
 * anything is laid out, so that the presence finds the surface it sits on
 * (and draws itself pearl or ink) when it starts.
 */
export function useSurface(kind: SurfaceKind): void {
  useInsertionEffect(() => {
    const root = document.documentElement;
    root.dataset.appearance = kind === "presence" ? "dark" : (forced ?? "system");
    root.dataset.surface = kind === "utility" ? "utility" : "stage";
  }, [kind]);
}

function onResize(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/** The window's size. Views decide their layout from it in one place, and hand the answer to their CSS. */
export function useWindow(): { width: number; height: number } {
  const width = useSyncExternalStore(onResize, () => window.innerWidth);
  const height = useSyncExternalStore(onResize, () => window.innerHeight);
  return { width, height };
}

/** Keeps `value` between `low` and `high`, as a whole number of pixels. */
export function clamp(low: number, value: number, high: number): number {
  return Math.round(Math.max(low, Math.min(value, high)));
}

/** Whether the owner asked the system for less motion. Read when a motion starts, so a change applies to the next one. */
export function calm(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A transition for `motion` components, on the design system's scale. When
 * the system asks for less motion it is a short fade (the travel itself is
 * dropped by `MotionConfig`).
 */
export function timing(speed: keyof typeof duration, curve: keyof typeof ease = "out") {
  return { duration: (calm() ? Math.min(duration[speed], duration.exit) : duration[speed]) / 1000, ease: [...ease[curve]] as [number, number, number, number] };
}

/** One of the design system's named springs, for `motion`. With less motion it becomes a short fade. */
export function spring(name: keyof typeof springs) {
  if (calm()) return timing("exit");
  return { type: "spring" as const, visualDuration: springs[name].duration, bounce: springs[name].bounce };
}

const { arrive, leave } = choreography;

/**
 * The Arrive and Leave choreographies (docs/DESIGN.md, "Motion") as
 * `motion` variants: a parent with `stagger` lets its `chunk` children
 * rise one after the other, and leave together, quieter than they came.
 */
export const choreographies = {
  stagger: {
    hidden: {},
    shown: { transition: { staggerChildren: arrive.stagger / 1000 } },
    gone: {},
  },
  chunk: {
    hidden: { opacity: 0, y: arrive.y, filter: `blur(${arrive.blur}px)` },
    shown: () => ({
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { y: spring("gesture"), opacity: timing("base"), filter: timing("base") },
    }),
    gone: () => ({ opacity: 0, y: leave.y, filter: `blur(${leave.blur}px)`, transition: timing("exit", "in") }),
  },
};
