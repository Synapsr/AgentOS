/**
 * The design tokens of docs/DESIGN.md, typed. The values live in
 * `tokens.json` at the root of this package — the single source for the web,
 * the iPhone and the watch; `tokens.data.ts` is generated from it by
 * `pnpm build`. This file only reshapes them for TypeScript and sizes the
 * presence's stage.
 *
 * Lengths are in CSS pixels (points on Apple platforms), durations in
 * milliseconds, letter-spacing in em, springs in { duration (s), bounce }.
 */
import { data } from "./tokens.data.js";

/** Every token, as one object: tokens.json without its notes. */
export const tokens = data;

/** `"dark"` or `"light"`. */
export type Appearance = "dark" | "light";
/** The name of a colour token, e.g. `"text-dim"`. */
export type ColorToken = keyof typeof data.color;
/** A state of the presence. */
export type PresenceState = Exclude<keyof typeof data.presence, "via" | "stage-light">;
/** A surface that shows the presence, e.g. `"os"` or `"home-asking"`. */
export type StageSurface = keyof typeof data.stage;

function byAppearance(appearance: Appearance): Record<ColorToken, string> {
  return Object.fromEntries(Object.entries(data.color).map(([name, value]) => [name, value[appearance]])) as Record<ColorToken, string>;
}

/** Colours by appearance: `color.dark["text-dim"]`. Presence surfaces use `dark` in both appearances. */
export const color: Record<Appearance, Record<ColorToken, string>> = { dark: byAppearance("dark"), light: byAppearance("light") };

/** The presence's look per appearance and state, the shape `PALETTE` has in @agentos/presence. */
export const presence = {
  dark: Object.fromEntries(states().map((state) => [state, data.presence[state].dark])),
  light: Object.fromEntries(states().map((state) => [state, data.presence[state].light])),
} as Record<Appearance, Record<PresenceState, { from: string; to: string; core: string; halo: string; glow: number }>>;

function states(): PresenceState[] {
  return Object.keys(data.presence).filter((key) => key !== "via" && key !== "stage-light") as PresenceState[];
}

export const font = data.font;
export const type = data.type;
export const space = data.space;
export const radius = data.radius;
export const size = data.size;
export const control = data.control;
export const stage = data.stage;
export const elevation = data.elevation;
export const motion = data.motion;
export const haptic = data.haptic;

/** Durations in milliseconds: `instant`, `fast`, `exit`, `base`, `slow`. */
export const duration = data.motion.duration;
/** Easing curves as cubic-bezier control points: `out`, `in`, `in-out`. */
export const ease = data.motion.ease;
/** Named springs, `{ duration (s), bounce }`: pass `{ type: "spring", visualDuration: duration, bounce }` to motion. */
export const spring = data.motion.spring;

/**
 * The side of the presence's stage on `surface`, in whole pixels, for the
 * box it may use: the window — or, on `home-beside`, the width of the
 * presence's own column and the height of the window.
 */
export function stageSize(surface: StageSurface, box: { width: number; height: number } = { width: Infinity, height: Infinity }): number {
  const rule = data.stage[surface];
  if (typeof rule === "number") return rule;
  return Math.round(Math.max(rule.min, Math.min(rule.height * box.height, rule.width * box.width, rule.max)));
}
