import type { Frame, Pill, RGB } from "./model.js";

const n = (x: number) => +x.toFixed(2);
const hex = (c: RGB) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** One pill as SVG path data: two half-circles joined by straight sides, turned by its angle. */
function pill({ x, y, w, h, angle = 0 }: Pill): string {
  const r = Math.min(w, h) / 2;
  if (r <= 0) return "";
  const dx = w / 2 - r, dy = h / 2 - r;
  const arc = (px: number, py: number) => `A${n(r)} ${n(r)} 0 0 1 ${n(px)} ${n(py)}`;
  if (angle !== 0) {
    // Along its own axis: from one end of the spine round to the other.
    const along = angle + (w >= h ? 0 : Math.PI / 2), half = Math.max(dx, dy);
    const c = Math.cos(along), s = Math.sin(along);
    const at = (t: number, side: number) => [x + c * t - s * side, y + s * t + c * side] as const;
    const [a, b, e, f] = [at(-half, -r), at(half, -r), at(half, r), at(-half, r)];
    return `M${n(a[0])} ${n(a[1])}L${n(b[0])} ${n(b[1])}${arc(e[0], e[1])}L${n(f[0])} ${n(f[1])}${arc(a[0], a[1])}Z`;
  }
  return w >= h
    ? `M${n(x - dx)} ${n(y - r)}L${n(x + dx)} ${n(y - r)}${arc(x + dx, y + r)}L${n(x - dx)} ${n(y + r)}${arc(x - dx, y - r)}Z`
    : `M${n(x + r)} ${n(y - dy)}L${n(x + r)} ${n(y + dy)}${arc(x - r, y + dy)}L${n(x - r)} ${n(y - dy)}${arc(x + r, y - dy)}Z`;
}

/** The three drops of a frame as one SVG path: all wound the same way, so a non-zero fill gives their union. */
export const dropsPath = (frame: Frame): string => frame.drops.map(pill).join("");

/** The membranes of a frame that have an area, each as its own SVG path: fill them one by one, over the drops. */
export function bridgePaths(frame: Frame): string[] {
  return frame.bridges
    .map((bridge) => bridge.map(n))
    .filter((p) => Math.abs(p[0]! - p[14]!) + Math.abs(p[1]! - p[15]!) >= 0.01)
    .map((p) => `M${p[0]} ${p[1]}C${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]}L${p[8]} ${p[9]}C${p[10]} ${p[11]} ${p[12]} ${p[13]} ${p[14]} ${p[15]}Z`);
}

/** The hole of a frame as SVG path data; empty when the body is closed. */
export const holePath = (frame: Frame): string => pill(frame.hole);

/** A short, stable name for a string: SVG ids must not clash when several figures share a page. */
function nameOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Options for `toSVG`. */
export interface SVGOptions {
  /** A flat colour for the body instead of the frame's gradient, e.g. `currentColor` for a template icon. */
  fill?: string;
  /** Draw the glows. On by default. */
  glow?: boolean;
  /** Fill behind the figure. None by default. */
  background?: string;
  /** Extra room around the stage on every side, as a fraction of its side. */
  margin?: number;
}

/** A frame as a standalone SVG document: for icons, placeholders and documentation. */
export function toSVG(frame: Frame, options: SVGOptions = {}): string {
  const { fill, glow = true, background, margin = 0 } = options;
  const half = n((frame.size / 2) * (1 + 2 * margin));
  const u = frame.size / 2;
  const drops = dropsPath(frame), bridges = bridgePaths(frame), hole = holePath(frame);
  const id = nameOf(drops + bridges + hole + frame.from + frame.to + frame.halo + frame.size);
  const box = `x="${-half}" y="${-half}" width="${2 * half}" height="${2 * half}"`;
  const paint = fill ?? `url(#g${id})`;
  const glows = glow
    ? frame.glows.filter((g) => g.alpha > 0.004 && g.r > 0).map((g) => `<circle cx="${n(g.x)}" cy="${n(g.y)}" r="${n(g.r)}" fill="url(#h${id})" opacity="${n(g.alpha)}"/>`).join("")
    : "";
  const defs =
    (fill ? "" : `<linearGradient id="g${id}" gradientUnits="userSpaceOnUse" x1="${n(-0.6 * u)}" y1="${n(-0.7 * u)}" x2="${n(0.6 * u)}" y2="${n(0.7 * u)}"><stop stop-color="${hex(frame.from)}"/><stop offset="1" stop-color="${hex(frame.to)}"/></linearGradient>`) +
    (glows ? `<radialGradient id="h${id}"><stop stop-color="${hex(frame.halo)}"/><stop offset=".45" stop-color="${hex(frame.halo)}" stop-opacity=".32"/><stop offset="1" stop-color="${hex(frame.halo)}" stop-opacity="0"/></radialGradient>` : "") +
    (hole ? `<mask id="m${id}" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="#fff"/><path d="${hole}" fill="#000"/></mask>` : "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${2 * half} ${2 * half}" width="${2 * half}" height="${2 * half}">` +
    (defs ? `<defs>${defs}</defs>` : "") +
    (background ? `<rect ${box} fill="${background}"/>` : "") +
    // The hole is cut out of the light as well as the body: a ring holds true black.
    `<g${hole ? ` mask="url(#m${id})"` : ""}>${glows}<path d="${drops}" fill="${paint}"/>${bridges.map((d) => `<path d="${d}" fill="${paint}"/>`).join("")}</g></svg>`
  );
}
