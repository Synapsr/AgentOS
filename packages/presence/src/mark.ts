import { bridge, tininess, type Bridge, type Frame, type Glow, type Pill, type RGB, type Theme } from "./model.js";
import { PALETTE } from "./palette.js";

/** The drops of the mark in stage units — big, middle, small: [x, y, radius]. */
const DROPS = [
  [-0.3, 0.2, 0.48],
  [0.36, -0.42, 0.3],
  [0.6, 0.42, 0.19],
] as const;

/**
 * The mark: the three drops caught mid-juggle — the big and the middle one
 * still joined, the small one already free. A still frame for everything
 * that cannot move: app icon, favicon, menu bar, logo. Draw it like any
 * other frame; with `toSVG(mark(18), { fill: "currentColor", glow: false })`
 * it is a single-colour template glyph.
 */
export function mark(size: number, theme: Theme = "dark"): Frame {
  const u = size / 2;
  const tiny = tininess(size);
  // Small sizes get a fatter neck and a larger small drop, so that both survive a 16 px grid.
  const drops = DROPS.map(([x, y, r], k) => {
    const pull = k === 1 ? 0.045 * tiny : 0;
    const radius = r + (k === 2 ? 0.04 : 0) * tiny;
    return { x: (x - pull) * u, y: (y + pull) * u, w: 2 * radius * u, h: 2 * radius * u, angle: 0 };
  }) as unknown as [Pill, Pill, Pill];
  const join = (a: Pill, b: Pill) => bridge(a.x, a.y, a.w / 2, b.x, b.y, b.w / 2);
  const look = PALETTE[theme].idle;
  return {
    size,
    drops,
    bridges: [join(drops[0], drops[1]), join(drops[0], drops[2]), join(drops[1], drops[2])] as [Bridge, Bridge, Bridge],
    hole: { x: 0, y: 0, w: 0, h: 0, angle: 0 },
    glows: drops.map((d) => ({ x: d.x, y: d.y, r: d.w / 2 + 0.3 * u, alpha: look.glow * (1 - tiny) * 0.7 })) as unknown as [Glow, Glow, Glow],
    from: look.from,
    to: look.to,
    halo: look.halo,
    // Still light: a lit body, nothing flowing. Soft enough a join that a shader draws the same neck as the bridge.
    light: { core: [...look.core] as unknown as RGB, energy: 0.22, flow: 0, radial: 0, bloom: look.glow * (1 - tiny) * 0.7, rim: theme === "dark" ? 0.6 : 0.48, wobble: 0, merge: 0.3 * u, wave: [0, 0, 0], time: 0 },
  };
}
