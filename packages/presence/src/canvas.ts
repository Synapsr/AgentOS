/**
 * The presence on a page: `createPresence` keeps one alive — it follows the
 * size of its element, draws with light (WebGL) when it can and with paths
 * (Canvas 2D) when it cannot, pauses when it cannot be seen, honours
 * "reduce motion", and draws only as often as what it shows needs — 60
 * frames a second while something travels, 30 at rest, none when nothing
 * can change — so that it can stay on screen all day.
 *
 * `paint` is the path renderer on its own: three pills, three membranes,
 * glows and a hole, at most a dozen fills, for small sizes, SVG-like places
 * and browsers without WebGL.
 */

import { capsule, type Capsule } from "./field.js";
import { presence, type Frame, type Pill, type PresenceInput, type PresenceState, type PulseKind, type RGB, type Theme } from "./model.js";
import { createMotion, inputOf, pace, pulse, stepMotion, type Target } from "./motion.js";
import { createShaderPainter, type Painter } from "./webgl.js";

export type { Painter };

/** How a presence is drawn: with light (a WebGL shader) or with paths (Canvas 2D). */
export type Renderer = Painter["kind"];

const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

const shape: Capsule = { x: 0, y: 0, half: 0, radius: 0, cos: 1, sin: 0 };

/** Adds one pill to the current path: two half-circles joined by straight sides, turned by its angle. */
function pill(ctx: CanvasRenderingContext2D, p: Pill): void {
  const { x, y, half, radius, cos, sin } = capsule(p, shape);
  if (radius <= 0) return;
  const along = Math.atan2(sin, cos);
  ctx.moveTo(x + cos * half + radius * Math.cos(along - Math.PI / 2), y + sin * half + radius * Math.sin(along - Math.PI / 2));
  ctx.arc(x + cos * half, y + sin * half, radius, along - Math.PI / 2, along + Math.PI / 2);
  ctx.arc(x - cos * half, y - sin * half, radius, along + Math.PI / 2, along + Math.PI * 1.5);
  ctx.closePath();
}

/** True if (x, y) is inside `p`. */
function within(p: Pill, x: number, y: number): boolean {
  const { x: cx, y: cy, half, radius, cos, sin } = capsule(p, shape);
  let qx = cos * (x - cx) + sin * (y - cy);
  const qy = cos * (y - cy) - sin * (x - cx);
  qx -= Math.min(half, Math.max(-half, qx));
  return qx * qx + qy * qy < radius * radius;
}

/**
 * Draws one frame on a 2D context whose origin is the centre of the stage,
 * one unit per frame pixel. The canvas must be clear where the figure goes:
 * the glow goes behind it and the ring's hole is cut out of whatever is
 * already there.
 */
export function paint(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const u = frame.size / 2, { light } = frame;

  // One gradient across the stage: the drops change colour as they travel through it.
  const body = ctx.createLinearGradient(-0.6 * u, -0.7 * u, 0.6 * u, 0.7 * u);
  body.addColorStop(0, rgba(frame.from, 1));
  body.addColorStop(1, rgba(frame.to, 1));
  ctx.fillStyle = body;
  ctx.beginPath();
  for (const drop of frame.drops) pill(ctx, drop);
  ctx.fill();
  for (const b of frame.bridges) {
    if (Math.abs(b[0]! - b[14]!) + Math.abs(b[1]! - b[15]!) < 0.01) continue;
    ctx.beginPath();
    ctx.moveTo(b[0]!, b[1]!);
    ctx.bezierCurveTo(b[2]!, b[3]!, b[4]!, b[5]!, b[6]!, b[7]!);
    ctx.lineTo(b[8]!, b[9]!);
    ctx.bezierCurveTo(b[10]!, b[11]!, b[12]!, b[13]!, b[14]!, b[15]!);
    ctx.fill();
  }

  // Light inside, painted onto the body only: deeper towards the rim, brighter towards the heart a
  // touch up and to the left, and a soft crescent of light just inside the top edge.
  if (u > 20) {
    ctx.globalCompositeOperation = "source-atop";
    for (const drop of frame.drops) {
      // A drop held inside a larger one is part of its body: only the outer drop is lit.
      if (frame.drops.some((other) => other !== drop && other.w * other.h > drop.w * drop.h && within(other, drop.x, drop.y))) continue;
      ctx.save();
      ctx.beginPath();
      pill(ctx, drop);
      ctx.clip();
      const r = Math.max(drop.w, drop.h) / 2, across = Math.min(drop.w, drop.h) / 2;
      const volume = ctx.createRadialGradient(drop.x, drop.y, 0.55 * across, drop.x, drop.y, r);
      volume.addColorStop(0, "rgba(0,0,0,0)");
      volume.addColorStop(1, `rgba(0,0,0,${0.16 * Math.min(1, light.energy * 3)})`);
      ctx.fillStyle = volume;
      ctx.fillRect(drop.x - r, drop.y - r, 2 * r, 2 * r);
      if (light.energy > 0.02) {
        const cx = drop.x - 0.18 * r, cy = drop.y - 0.22 * r;
        const heart = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1.1 * r);
        heart.addColorStop(0, rgba(light.core, 0.5 * light.energy));
        heart.addColorStop(1, rgba(light.core, 0));
        ctx.fillStyle = heart;
        ctx.fillRect(cx - 1.1 * r, cy - 1.1 * r, 2.2 * r, 2.2 * r);
      }
      if (light.rim > 0.02 && across > 6) {
        // An ellipse of light, flattened against the top of the drop.
        ctx.save();
        ctx.translate(drop.x - 0.22 * across, drop.y - 0.62 * across);
        ctx.scale(1, 0.45);
        const gloss = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.55 * across);
        gloss.addColorStop(0, `rgba(255,255,255,${0.3 * light.rim})`);
        gloss.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gloss;
        ctx.fillRect(-0.55 * across, -0.55 * across, 1.1 * across, 1.1 * across);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // The glows go behind the body.
  ctx.globalCompositeOperation = "destination-over";
  for (const glow of frame.glows) {
    if (glow.alpha <= 0.004 || glow.r <= 0) continue;
    const halo = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.r);
    halo.addColorStop(0, rgba(frame.halo, glow.alpha));
    halo.addColorStop(0.45, rgba(frame.halo, glow.alpha * 0.32));
    halo.addColorStop(1, rgba(frame.halo, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(glow.x - glow.r, glow.y - glow.r, 2 * glow.r, 2 * glow.r);
  }

  if (frame.hole.w > 0 && frame.hole.h > 0) {
    // A frame with a hole (none is made any more) has it cut out of the light as well as the body.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.beginPath();
    pill(ctx, frame.hole);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** A painter that fills paths on `canvas`; not `ok` if the canvas already belongs to WebGL. */
function pathPainter(canvas: HTMLCanvasElement): Painter {
  const ctx = canvas.getContext("2d");
  return {
    kind: "2d",
    ok: ctx !== null,
    draw(frame, scale) {
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
      ctx.clearRect(-canvas.width, -canvas.height, 2 * canvas.width, 2 * canvas.height);
      if (frame.size > 0) paint(ctx, frame);
    },
    destroy() {},
  };
}

/** Live WebGL presences on this page. Browsers cap live contexts (about 16 in Chrome): beyond a few, presences use paths. */
let shaders = 0;
const MOST_SHADERS = 6;

/**
 * Something that draws frames on `canvas`: with the shader when `kind`
 * allows it and the browser can, with paths otherwise. A canvas that has
 * given itself to WebGL cannot draw paths any more: if this painter stops
 * being `ok`, draw on a new canvas.
 */
export function createPainter(canvas: HTMLCanvasElement, kind: "auto" | Renderer = "auto"): Painter {
  if (kind !== "2d") {
    const shader = createShaderPainter(canvas);
    if (shader) return shader;
  }
  return pathPainter(canvas);
}

/** What a presence can be told. */
export interface PresenceProps {
  state?: PresenceState;
  /** Raw voice level, 0–1; smoothed inside. Used while listening and speaking. */
  level?: number;
  /**
   * Side of the stage in CSS pixels; an element the presence was created on
   * is given that size. Through `set`, a change of size is eased over about
   * 400 ms (at once in calm mode): the presence steps aside, it does not jump.
   * Without a size, the stage is the smaller side of the element as it is.
   */
  size?: number;
  /** The surface it sits on. `auto` reads the `color-scheme` of the element, when created, resized, or when the system changes. */
  theme?: Theme | "auto";
  /** Reduced motion. `auto` follows the system setting. */
  calm?: boolean | "auto";
}

/** Options for `createPresence`. */
export interface PresenceOptions extends PresenceProps {
  /** How to draw. `auto` (the default) draws with light on stages of 64 px and up while the page has few presences, with paths otherwise. */
  renderer?: "auto" | Renderer;
  /** Picks the sequence of small idle gestures, so that two presences side by side do not move in step. */
  seed?: number;
}

/** A presence living on a page. */
export interface Presence {
  /** Changes what is shown. Only the given keys change. */
  set(props: PresenceProps): void;
  /** Tells it something really happened: "approved" (it nods), "denied" (it lowers its hand), "retry" (offline, it lifts once). */
  pulse(kind: PulseKind): void;
  /** Sets the size at once, without easing — or, with no argument, measures the element again. */
  resize(size?: number): void;
  /** Stops everything and removes what was added to the page. */
  destroy(): void;
  /** The canvas being drawn on. It may be replaced if the GPU is lost. */
  readonly canvas: HTMLCanvasElement;
  /** How it is drawing right now. */
  readonly renderer: Renderer;
}

/** The canvas is this many stages wide when the presence owns it: room for the glow. */
const ROOM = 1.25;
/** Device pixels a canvas may hold. Above it, large presences are drawn slightly below screen resolution. */
const BUDGET = 2_400_000;
/** No more than two device pixels per CSS pixel: past that, nobody sees the difference, and the GPU pays for it. */
const DENSITY = 2;
/** Stages smaller than this are drawn with paths: a shader buys nothing that small. */
const SHADER_FROM = 64;

/**
 * Brings a presence to life on `target`. Given a canvas, it draws on it and
 * the stage fills it. Given any other element, it adds its own canvas,
 * centred, a little larger than the element so that the glow has room.
 */
export function createPresence(target: HTMLElement, options: PresenceOptions = {}): Presence {
  const owned = !(target instanceof HTMLCanvasElement);
  let canvas = owned ? document.createElement("canvas") : (target as HTMLCanvasElement);
  if (owned) {
    if (getComputedStyle(target).position === "static") target.style.position = "relative";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;left:50%;top:50%;translate:-50% -50%;pointer-events:none";
    target.append(canvas);
  }

  const props = { state: "idle", level: 0, theme: "auto", calm: "auto", ...options } as Required<Omit<PresenceProps, "size">>;
  const motion = createMotion(props.state, 0, options.seed ?? 0);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const scheme = matchMedia("(prefers-color-scheme: light)");
  /** The size asked for, if any; otherwise the stage follows the element. */
  let goal = options.size;
  /** The stage the canvas has room for: during a change of size, the larger of the two. */
  let room = 0;
  let scale = 1, density = 0, laid = 0;
  let theme: Theme = "dark";
  let frame = 0, last = 0, onScreen = true, alive = true;
  // One of each, filled in place every frame: the loop allocates nothing.
  const want: Target = { state: props.state, level: 0, calm: false, size: undefined };
  const look: Pick<PresenceInput, "theme" | "calm"> = { theme, calm: false };
  const input = inputOf(motion, 0, look);
  let drawn: Frame | undefined;
  /** The opacity last given to the canvas: the DOM is touched only when it changes. */
  let shown = 1;

  const calm = () => (props.calm === "auto" ? reduce.matches : props.calm);

  // Light when it is worth it and the page can afford it; paths otherwise.
  const first = goal ?? (owned ? Math.min(target.clientWidth, target.clientHeight) : Math.min(canvas.clientWidth, canvas.clientHeight));
  const kind = options.renderer ?? "auto";
  const lit = kind === "webgl" || (kind === "auto" && (first === 0 || first >= SHADER_FROM) && shaders < MOST_SHADERS);
  let painter = createPainter(canvas, lit ? "webgl" : "2d");
  if (painter.kind === "webgl") shaders++;

  /** Draws with paths from now on, on a new canvas if this one belongs to a lost WebGL context. */
  const fallBack = () => {
    if (painter.kind === "webgl") shaders--;
    painter.destroy();
    if (owned) {
      const fresh = document.createElement("canvas");
      fresh.setAttribute("aria-hidden", "true");
      fresh.style.cssText = canvas.style.cssText;
      sight.unobserve(canvas);
      canvas.replaceWith(fresh);
      sight.observe(fresh);
      canvas = fresh;
      allocate(room);
    }
    painter = pathPainter(canvas);
  };

  /** Gives the canvas the pixels a stage of `side` needs. The one costly step: never done per frame. */
  const allocate = (side: number) => {
    room = side;
    const width = owned ? side * ROOM : canvas.clientWidth || side;
    const height = owned ? side * ROOM : canvas.clientHeight || side;
    if (owned) canvas.style.width = canvas.style.height = `${width}px`;
    density = window.devicePixelRatio || 1;
    scale = Math.min(density, DENSITY, Math.sqrt(BUDGET / Math.max(1, width * height)));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
  };

  /** Takes the size and the surface as they are now, at once. */
  const measure = () => {
    const box = owned ? target : canvas;
    motion.size = goal ?? Math.min(box.clientWidth, box.clientHeight);
    motion.sizeVelocity = 0;
    allocate(motion.size);
    // The surface decides, not the system: a presence surface stays dark in a light system.
    const surface = getComputedStyle(target).colorScheme;
    const light = props.theme === "auto" ? surface === "light" || (/light/.test(surface) && /dark/.test(surface) && scheme.matches) : props.theme === "light";
    theme = light ? "light" : "dark";
  };

  const draw = () => {
    // The window moved to a screen with another pixel density.
    if (density !== (window.devicePixelRatio || 1)) allocate(room);
    // An element of an explicit size follows the stage, so that what surrounds it moves with it.
    if (owned && goal !== undefined && laid !== motion.size) {
      laid = motion.size;
      target.style.width = target.style.height = `${laid}px`;
    }
    look.theme = theme;
    look.calm = calm();
    inputOf(motion, motion.size, look, input);
    if (motion.size > 0) drawn = presence(input, drawn);
    else if (drawn) drawn.size = 0;
    if (drawn) painter.draw(drawn, scale);
    if (motion.alpha !== shown) canvas.style.opacity = (shown = motion.alpha) === 1 ? "" : String(shown);
  };

  const tick = (now: number) => {
    frame = 0;
    if (!alive || !onScreen || document.hidden) return;
    // The GPU was lost: an owned canvas carries on with paths; a given one waits for the GPU to come back.
    if (!painter.ok && owned) fallBack();
    const quiet = calm();
    const fps = pace(motion, quiet);
    // Displays faster than 60 Hz, and slow states, skip frames.
    if (fps > 0 && now - last < 1000 / fps - 2) return schedule();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    want.state = props.state;
    want.level = props.level;
    want.calm = quiet;
    want.size = goal;
    stepMotion(motion, want, dt);
    // A stage that has finished shrinking gives back the pixels the larger one needed.
    if (goal !== undefined && motion.size === goal && room !== goal) allocate(goal);
    draw();
    // Offline at rest (or calm and offline): nothing can change until something is said. Stop.
    if (pace(motion, quiet) > 0) schedule();
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(tick);
  };
  const wake = () => {
    // Do not jump over the time spent hidden.
    if (!frame) last = performance.now() - 1000 / 60;
    schedule();
  };
  const refresh = () => {
    measure();
    draw();
    wake();
  };

  // An element of an explicit size is resized by the presence itself: only a size it did not choose is news.
  const resizes = new ResizeObserver(() => {
    if (!owned || goal === undefined) refresh();
  });
  resizes.observe(target);
  const sight = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1]!.isIntersecting;
    if (onScreen) wake();
  });
  sight.observe(canvas);
  document.addEventListener("visibilitychange", wake);
  reduce.addEventListener("change", wake);
  scheme.addEventListener("change", refresh);
  refresh();

  return {
    get canvas() {
      return canvas;
    },
    get renderer() {
      return painter.kind;
    },
    set({ size, ...next }) {
      const before = { ...props };
      for (const key of Object.keys(next) as (keyof typeof next)[]) if (next[key] !== undefined) Object.assign(props, { [key]: next[key] });
      // A level only matters while a voice state hears it: do not wake a resting figure sixty times a second.
      const voiced = props.state === "listening" || props.state === "speaking";
      const resized = size !== undefined && size !== goal;
      if (resized) goal = size;
      if (props.theme !== before.theme || (resized && (calm() || motion.size <= 0))) return refresh();
      if (resized && goal! > room) {
        // Growing: make room once, now; the figure then grows into it frame by frame.
        allocate(goal!);
        draw();
      }
      if (resized || props.state !== before.state || props.calm !== before.calm || (voiced && props.level !== before.level)) wake();
    },
    pulse(kind) {
      pulse(motion, kind);
      wake();
    },
    resize(next) {
      if (next !== undefined) goal = next;
      refresh();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(frame);
      resizes.disconnect();
      sight.disconnect();
      document.removeEventListener("visibilitychange", wake);
      reduce.removeEventListener("change", wake);
      scheme.removeEventListener("change", refresh);
      if (painter.kind === "webgl") shaders--;
      painter.destroy();
      if (owned) canvas.remove();
    },
  };
}
