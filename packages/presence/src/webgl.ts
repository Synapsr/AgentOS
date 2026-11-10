/**
 * The presence as light: one fragment shader, one draw call a frame.
 *
 * Per pixel it measures the distance to the body — three capsules melted
 * together with a smooth minimum, in a space that sways a little like the
 * surface of a liquid — and from it draws an edge anti-aliased to the
 * pixel, a body lit from inside (the state's gradient, deeper towards the
 * rim; a pearly light that flows slowly, with caustic ridges and rings that
 * travel in or out with the voice; a soft drifting highlight; a crescent of
 * light just inside the top edge), and a bloom around it all. `field.ts` is the same geometry on
 * the CPU. Plain WebGL 1, GLSL ES 1.0, no dependency.
 *
 * Colours are mixed in linear light and written out as sRGB, premultiplied.
 * Everything that grows with time (the wobble, the flow) is wrapped into
 * a phase on the CPU, in double precision, so that it stays smooth after
 * hours on screen even on a GPU with low-precision floats.
 */

import { capsule, WOBBLE, type Capsule } from "./field.js";
import type { Frame, RGB } from "./model.js";
import { toLinear } from "./palette.js";

/** What draws frames on a canvas. */
export interface Painter {
  /** `webgl` draws light; `2d` fills paths. */
  readonly kind: "webgl" | "2d";
  /** False once the drawing context is gone (a lost GPU context): draw with another painter. */
  readonly ok: boolean;
  /** Draws `frame` centred on the canvas, at `scale` canvas pixels per frame pixel. */
  draw(frame: Frame, scale: number): void;
  /** Lets go of the context. */
  destroy(): void;
}

const VERTEX = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

/** See the top of this file. `U` is laid out by `pack` below. */
const FRAGMENT = `
precision highp float;
uniform vec4 U[17];

float pill(vec2 p, vec4 d, vec2 cs) {
  vec2 q = p - d.xy;
  q = vec2(cs.x * q.x + cs.y * q.y, cs.x * q.y - cs.y * q.x);
  q.x -= clamp(q.x, -d.z, d.z);
  return length(q) - d.w;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float drops(vec2 q) {
  float k = max(U[11].x, 0.001);
  return smin(smin(pill(q, U[0], U[3].xy), pill(q, U[1], U[3].zw), k), pill(q, U[2], U[4].xy), k);
}

// The body: three capsules melted into one, in space that sways. The sway is only worked out
// near the edge: further out it moves the light by less than it can show.
float body(vec2 p) {
  float d = drops(p), sway = U[10].w;
  if (sway <= 0.0 || abs(d) > 3.0 * sway + 2.0) return d;
  vec2 s = p / U[4].w;
  return drops(p + sway * vec2(
    sin(s.y * 2.6 + U[14].x + 0.8 * sin(s.x * 1.9 + U[14].y)),
    sin(s.x * 2.3 + U[14].y + 0.8 * sin(s.y * 2.1 - U[14].x))));
}

vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  float scale = U[4].z, u = U[4].w, pixel = 1.0 / scale;
  vec2 p = (gl_FragCoord.xy - 0.5 * U[15].xy) * pixel;
  p.y = -p.y;
  // Past where the light fades out, nothing to draw.
  if (length(p) > 1.22 * u) { gl_FragColor = vec4(0.0); return; }
  vec2 s = p / u;
  float d = body(p);

  float bloom = U[8].w;
  float covered = clamp(0.5 - d * scale, 0.0, 1.0);
  vec2 c = p - U[5].xy;
  vec3 colour = vec3(0.0);
  if (covered > 0.0) {
    float energy = U[7].w;
    float depth = clamp(-d / (0.45 * u), 0.0, 1.0);
    float inner = smoothstep(0.0, 0.45, depth);
    // The state's gradient, across the stage: drops change colour as they travel through it.
    float g = clamp((1.2 * s.x + 1.4 * s.y + 1.7) / 3.4, 0.0, 1.0);
    vec3 base = mix(U[7].rgb, U[8].rgb, g);
    // Volume: a little deeper towards the rim, where the halo's hue shows through.
    colour = mix(mix(base * 0.8, U[10].rgb, 0.12), base, smoothstep(0.0, 0.6, depth));
    // Light inside: a pearly field that flows slowly — crests lean to the core's colour, troughs to
    // the halo's — and, through it, broad soft pools of light drifting like light in deep water.
    // Everything here is low and wide: no line, no edge, nothing that could read as a scratch.
    vec2 f = s * 2.4;
    float a = sin(f.x * 1.7 + U[13].x + 1.2 * sin(f.y * 1.3 + U[13].y));
    float b = sin(f.y * 1.9 - U[13].z + 1.1 * sin(f.x * 1.5 - U[13].y));
    float field = 0.5 + 0.25 * (a + b);
    vec2 w = s * 1.7;
    w += 0.6 * vec2(sin(w.y * 1.2 + U[13].y), cos(w.x * 1.1 - U[13].z));
    float pools = smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(w.x + 0.4) * sin(w.y - 0.3));
    // Rings of light that travel inward (listening) or outward (speaking), from the body's heart.
    // Towards the heart they dissolve into a soft, even glow: they never close into a dot.
    float r = length(c) / u;
    float near = smoothstep(0.12, 0.45, r);
    float rings = max(-U[11].y, 0.0) * mix(0.46, smoothstep(0.2, 1.0, 0.5 + 0.5 * sin(r * 9.0 + U[13].w)), near)
                + max(U[11].y, 0.0) * mix(0.46, smoothstep(0.2, 1.0, 0.5 + 0.5 * sin(r * 9.0 - U[13].w)), near);
    colour = mix(colour, U[10].rgb, clamp(energy * 0.4 * (1.0 - field) * inner, 0.0, 1.0));
    colour = mix(colour, U[9].rgb, clamp(energy * (0.6 * field * inner + 0.25 * depth * depth), 0.0, 1.0));
    colour += U[9].rgb * energy * inner * (0.16 * pools + 0.22 * rings);
    // A soft highlight inside, up and to the left, drifting slowly.
    vec2 h = s - vec2(-0.16 + 0.1 * sin(U[14].z), -0.2 + 0.08 * cos(U[14].w));
    colour = mix(colour, U[9].rgb, energy * 0.55 * inner * exp(-dot(h, h) / 0.05));
    // A soft crescent of light just inside the top edge, and a faint rim: lit from above, not glossy.
    float gloss = U[6].x;
    if (gloss > 0.0 && -d < 0.17 * u) {
      // Which way the edge faces, from the shape itself a little further along each axis: smooth,
      // where screen-space derivatives would come out in blocks.
      float e = 0.02 * u;
      vec2 n = vec2(body(p + vec2(e, 0.0)) - body(p - vec2(e, 0.0)), body(p + vec2(0.0, e)) - body(p - vec2(0.0, e)));
      float facing = max(dot(normalize(n + 1e-6), vec2(-0.42, -0.91)), 0.0);
      float band = smoothstep(0.0, 0.025 * u, -d) * (1.0 - smoothstep(0.05 * u, 0.17 * u, -d));
      float edge = 1.0 - smoothstep(0.0, 0.045 * u, -d);
      colour += vec3(gloss * (0.4 * pow(facing, 5.0) * band + 0.07 * edge * (0.3 + 0.7 * facing)));
    }
  }

  // A syllable's ring of light, and the bloom around the body.
  float wave = U[12].z * exp(-pow((length(c) - U[12].x) / max(U[12].y, 1.0), 2.0));
  colour += vec3(wave);
  float fade = 1.0 - smoothstep(0.7 * u, 1.22 * u, length(p));
  float away = max(d, 0.0);
  float glow = (bloom * (0.7 * exp(-away / (0.07 * u)) + 0.3 * exp(-away / (0.16 * u))) + 0.8 * wave) * fade;
  float lit = min(1.0, glow) * (1.0 - covered);

  float alpha = covered + lit;
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }
  // A whisper of noise: no banding in the long, dark tail of the glow.
  float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  // Glow alone is the halo's colour, already written as sRGB: only the body needs converting.
  vec3 shown = covered > 0.0 ? encode((colour * covered + U[10].rgb * lit) / alpha) : U[16].rgb;
  gl_FragColor = vec4(clamp(shown + dither, 0.0, 1.0) * alpha, alpha);
}`;

/** sRGB 0–255 → linear light, by table: no work per frame. */
const LINEAR = new Float32Array(256).map((_, i) => toLinear(i));
const linear = (c: number) => LINEAR[Math.max(0, Math.min(255, Math.round(c)))]!;

const TAU = Math.PI * 2;
/** A phase in radians, wrapped on the CPU so that the GPU never sees a large number. */
const wrap = (x: number) => x - TAU * Math.floor(x / TAU);

/** Writes one vec4 of the shader's numbers. */
function put(data: Float32Array, i: number, a: number, b: number, c: number, d: number): void {
  data[4 * i] = a;
  data[4 * i + 1] = b;
  data[4 * i + 2] = c;
  data[4 * i + 3] = d;
}

/** Writes a colour, as linear light, and one more number into one vec4. */
function colour(data: Float32Array, i: number, rgb: RGB, w: number): void {
  put(data, i, linear(rgb[0]), linear(rgb[1]), linear(rgb[2]), w);
}

/** Every number the shader needs, written into `data` without allocating. */
function pack(data: Float32Array, frame: Frame, scale: number, width: number, height: number, caps: Capsule[]): void {
  const { light } = frame;
  for (let k = 0; k < 3; k++) {
    const c = capsule(frame.drops[k]!, caps[k]!);
    put(data, k, c.x, c.y, c.half, c.radius);
  }
  put(data, 3, caps[0]!.cos, caps[0]!.sin, caps[1]!.cos, caps[1]!.sin);
  put(data, 4, caps[2]!.cos, caps[2]!.sin, scale, frame.size / 2);
  // The heart of the body, where rings of light start and end: the big drop.
  put(data, 5, frame.drops[0].x, frame.drops[0].y, 0, 0);
  put(data, 6, light.rim, 0, 0, 0);
  colour(data, 7, frame.from, light.energy);
  colour(data, 8, frame.to, light.bloom);
  colour(data, 9, light.core, light.rim);
  colour(data, 10, frame.halo, light.wobble);
  put(data, 11, light.merge, light.radial, 0, 0);
  put(data, 12, light.wave[0], light.wave[1], light.wave[2], 0);
  // The flow, in stage units, turned into the phases of the texture's waves.
  put(data, 13, wrap(3 * light.flow), wrap(2.1 * light.flow), wrap(2.6 * light.flow), wrap(9 * light.flow));
  // The sway, and the slow drift of the inner highlight.
  put(data, 14, wrap(WOBBLE[0] * light.time), wrap(WOBBLE[1] * light.time), wrap(0.5 * light.time), wrap(0.4 * light.time));
  put(data, 15, width, height, 0, 0);
  put(data, 16, frame.halo[0] / 255, frame.halo[1] / 255, frame.halo[2] / 255, 0);
}

/** Compiles the shader program, or returns null when the GPU will not. */
function program(gl: WebGLRenderingContext): WebGLProgram | null {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vertex = shader(gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vertex);
  gl.attachShader(p, fragment);
  gl.bindAttribLocation(p, 0, "p");
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/** Sets up the context once: the program, one triangle that covers the canvas, and where the numbers go. */
function setup(gl: WebGLRenderingContext): WebGLUniformLocation | null {
  const p = program(gl);
  if (!p) return null;
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  return gl.getUniformLocation(p, "U");
}

/** The light of a calm, low-power GPU: no depth, no stencil, no multisampling — the shader anti-aliases its own edge. */
const ATTRIBUTES: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" };

/** A painter that draws with the shader on `canvas`, or null if this browser cannot (no WebGL, or the shader would not compile). */
export function createShaderPainter(canvas: HTMLCanvasElement): Painter | null {
  const gl = canvas.getContext("webgl", ATTRIBUTES) as WebGLRenderingContext | null;
  if (!gl) return null;
  let where = setup(gl);
  if (!where) return null;
  const data = new Float32Array(17 * 4);
  const caps: Capsule[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, half: 0, radius: 0, cos: 1, sin: 0 }));
  let ok = true;
  // A lost context is restored by the browser if asked to; until then nothing is drawn.
  const lost = (event: Event) => {
    event.preventDefault();
    ok = false;
  };
  const restored = () => {
    where = setup(gl);
    ok = where !== null;
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  return {
    kind: "webgl",
    get ok() {
      return ok;
    },
    draw(frame, scale) {
      if (!ok || !where) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      pack(data, frame, scale, canvas.width, canvas.height, caps);
      gl.uniform4fv(where, data);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      // Give the context back now rather than when the page is collected: browsers cap how many may live.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      ok = false;
    },
  };
}
