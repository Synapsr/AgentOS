/**
 * The presence's colours, and how they mix.
 *
 * The colours themselves live in `@agentos/design` (`tokens.json` →
 * `presence`), the one source shared with CSS and Swift: `PALETTE` only
 * reads them. Mixing happens in OKLab, a space where equal steps look
 * equal, with one rule from the tokens: when two coloured states meet
 * (azure into amber), the mix would lose its colour and turn to mud, so it
 * travels through `via` instead — the pearl on black, the ink on light.
 * How far it leans to `via` follows how much colour the mix would lose.
 */

import { presence as TOKENS, tokens } from "@agentos/design";
import type { PresenceState, RGB, Theme } from "./model.js";

/** How one state looks: the body's gradient, the light inside it, the glow around it. */
export interface Look {
  /** Top left of the stage. */
  from: RGB;
  /** Bottom right of the stage. */
  to: RGB;
  /** The heart of the body, where its inner light is brightest. */
  core: RGB;
  /** The glow around the body. */
  halo: RGB;
  /** Glow opacity at its strongest. */
  glow: number;
}

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as RGB;
const ORDER: readonly PresenceState[] = ["idle", "working", "waiting", "listening", "speaking", "offline"];
const read = (theme: Theme) =>
  Object.fromEntries(ORDER.map((state) => {
    const t = TOKENS[theme][state];
    return [state, { from: rgb(t.from), to: rgb(t.to), core: rgb(t.core), halo: rgb(t.halo), glow: t.glow }];
  })) as Record<PresenceState, Look>;

/** The colours of each state, on black (`dark`) and as a black pearl on a light surface (`light`): the `presence` tokens. */
export const PALETTE: Readonly<Record<Theme, Readonly<Record<PresenceState, Look>>>> = { dark: read("dark"), light: read("light") };

/** What a change between two coloured states travels through. */
export const VIA: Readonly<Record<Theme, RGB>> = { dark: rgb(tokens.presence.via.dark), light: rgb(tokens.presence.via.light) };

/* ───────────── OKLab (Björn Ottosson, 2020) ───────────── */

/** sRGB channel 0–255 → linear light 0–1. */
export const toLinear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/** Linear light 0–1 → sRGB channel 0–255. */
export const fromLinear = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};

/** An sRGB colour as OKLab, written into `out` at `at`: lightness, then a and b. */
function oklab(c: RGB, out: Float64Array, at: number): void {
  const r = toLinear(c[0]), g = toLinear(c[1]), b = toLinear(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[at] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[at + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[at + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** OKLab back to sRGB 0–255, written into `out`. */
function srgb(L: number, A: number, B: number, out: number[]): void {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  out[0] = fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  out[1] = fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  out[2] = fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

/** The length of (x, y), without the allocation Math.hypot makes for its arguments. */
const length = (x: number, y: number) => Math.sqrt(x * x + y * y);

const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Which colour of a look. */
export type Channel = "from" | "to" | "core" | "halo";
const CHANNELS: readonly Channel[] = ["from", "to", "core", "halo"];

/** Every palette colour in OKLab, computed once: [theme][channel][state] → L, a, b; then `via` per theme. */
const LAB = (() => {
  const table = new Float64Array(2 * 4 * 6 * 3 + 6);
  (["dark", "light"] as const).forEach((theme, t) => {
    CHANNELS.forEach((channel, c) => ORDER.forEach((state, s) => oklab(PALETTE[theme][state][channel], table, ((t * 4 + c) * 6 + s) * 3)));
    oklab(VIA[theme], table, 144 + 3 * t);
  });
  return table;
})();

/**
 * Mixes one colour of every state by `weights` (one per state, in `STATES`
 * order, each 0–1, summing to 1) into `out`, as sRGB 0–255. In OKLab; the
 * more colour the plain mix would lose, the more it leans to `via`.
 */
export function mixInto(out: number[], weights: ArrayLike<number>, theme: Theme, channel: Channel): void {
  const base = ((theme === "dark" ? 0 : 4) + CHANNELS.indexOf(channel)) * 18;
  let L = 0, A = 0, B = 0, chroma = 0;
  for (let s = 0; s < 6; s++) {
    const w = weights[s]!;
    if (w === 0) continue;
    const at = base + s * 3;
    L += w * LAB[at]!;
    A += w * LAB[at + 1]!;
    B += w * LAB[at + 2]!;
    chroma += w * length(LAB[at + 1]!, LAB[at + 2]!);
  }
  // How much colour two hues cancelling out would lose: nothing for one state, for colours that agree,
  // or for a grey (offline dims, it does not light up); all of it for azure meeting amber half-way.
  const lost = smooth(0.02, 0.09, chroma - length(A, B));
  const via = 144 + (theme === "dark" ? 0 : 3);
  srgb(L + (LAB[via]! - L) * lost, A + (LAB[via + 1]! - A) * lost, B + (LAB[via + 2]! - B) * lost, out);
}

/** A colour's OKLab lightness and chroma: for tests and measurements. */
export function lightness(c: RGB): { L: number; C: number; h: number } {
  const out = new Float64Array(3);
  oklab(c, out, 0);
  return { L: out[0]!, C: length(out[1]!, out[2]!), h: (Math.atan2(out[2]!, out[1]!) * 180) / Math.PI };
}
