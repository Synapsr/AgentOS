import { mark } from "./mark.js";
import { bridge, only, presence, type Bridge, type Frame, type Glow, type Pill, type Theme } from "./model.js";

/** The states that have a still glyph: what a computer can be doing, as its menu bar shows it. */
export type GlyphState = "idle" | "working" | "waiting" | "offline";

/** The glyphs are drawn on the pixels of an 18 px box — a menu-bar image — and scaled from there. */
const GRID = 18;

/**
 * How each glyph is taken from the model: the size the model is asked for
 * (which decides how thick the parts are), how large the result sits in the
 * box, and how far it is moved to sit in the middle, in grid pixels. As a
 * set they are balanced for one colour: `waiting` is the tallest and the
 * heaviest, because nothing else can make it catch the eye.
 */
const TAKES: Record<GlyphState, { model: number; zoom: number; shift: readonly [number, number] }> = {
  // The mark, small: at rest the computer shows the brand, and stays the quiet one.
  idle: { model: 18, zoom: 0.78, shift: [0, 0] },
  // An instant of the juggle when the three drops are well apart: see JUGGLE.
  working: { model: 30, zoom: 1.08, shift: [0, 1] },
  // The body and its raised drop, as tall as a menu bar allows.
  waiting: { model: 18, zoom: 1.07, shift: [0, 0] },
  // The dash, a little longer than the model draws it.
  offline: { model: 18, zoom: 1.3, shift: [0, 0] },
};

/**
 * The working glyph's instant, in stage units — [x, y, radius] for big,
 * middle, small: three drops of three sizes, big to small clockwise, apart,
 * and no small drop straight above a big one (that is `waiting`). Fixed
 * here, not sampled from the juggle, because the juggle never repeats.
 */
const JUGGLE = [
  [-0.355127, -0.422201, 0.34473],
  [0.411705, 0.099861, 0.279043],
  [-0.056578, 0.32234, 0.224549],
] as const;

/** Moves a pill onto the grid: whole-pixel sizes, edges on pixel boundaries. */
function snap(pill: Pill): Pill {
  const w = Math.max(2, Math.round(pill.w));
  const h = pill.w === pill.h ? w : Math.max(2, Math.round(pill.h));
  const place = (centre: number, side: number) => Math.round(centre - side / 2 + GRID / 2) - GRID / 2 + side / 2;
  return { x: place(pill.x, w), y: place(pill.y, h), w, h, angle: 0 };
}

/**
 * A state as a still glyph, for the places that show a state but cannot
 * move or use colour: the menu bar first of all. It is the model's own calm
 * frame for that state — for idle, the mark — fitted to the pixels of an 18 px box and scaled to
 * `size` — so 36 gives the same drawing at twice the density. Draw it like
 * any frame; `toSVG(glyph("waiting", 18), { fill: "#000", glow: false })`
 * is a macOS template image.
 */
export function glyph(state: GlyphState, size: number, theme: Theme = "dark"): Frame {
  const take = TAKES[state];
  const frame = state === "idle" ? mark(take.model, theme) : presence({ blend: only(state), time: 0, size: take.model, calm: true, theme });
  const u = take.model / 2;
  const source =
    state === "working"
      ? JUGGLE.map(([x, y, r]) => ({ x: x * u, y: y * u, w: 2 * r * u, h: 2 * r * u }))
      : frame.drops.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h }));
  const k = (GRID / take.model) * take.zoom, out = size / GRID;
  const drops = source
    .map((d) => snap({ x: d.x * k + take.shift[0], y: d.y * k + take.shift[1], w: d.w * k, h: d.h * k }))
    .map((d) => ({ x: d.x * out, y: d.y * out, w: d.w * out, h: d.h * out, angle: 0 })) as unknown as [Pill, Pill, Pill];
  const join = (a: Pill, b: Pill) => bridge(a.x, a.y, Math.min(a.w, a.h) / 2, b.x, b.y, Math.min(b.w, b.h) / 2);
  return {
    size,
    drops,
    bridges: [join(drops[0], drops[1]), join(drops[0], drops[2]), join(drops[1], drops[2])] as [Bridge, Bridge, Bridge],
    hole: { x: 0, y: 0, w: 0, h: 0, angle: 0 },
    glows: drops.map((d) => ({ x: d.x, y: d.y, r: 0, alpha: 0 })) as unknown as [Glow, Glow, Glow],
    from: frame.from,
    to: frame.to,
    halo: frame.halo,
    // A glyph is flat: no light, nothing melting.
    light: { ...frame.light, energy: 0, bloom: 0, rim: 0, wobble: 0, merge: 0, wave: [0, 0, 0] },
  };
}
