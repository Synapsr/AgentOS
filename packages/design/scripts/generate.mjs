#!/usr/bin/env node
/**
 * Turns tokens.json, the single source of the design system, into what each
 * platform reads:
 *
 *   tokens.css               custom properties for the web UI and the website
 *   generated/Tokens.swift   the same values for the iPhone and the watch
 *   src/tokens.data.ts       the same values, typed, for TypeScript
 *
 *   node scripts/generate.mjs           write them
 *   node scripts/generate.mjs --check   exit 1 if one of them is stale
 *
 * Plain Node and no dependency, so that it runs before anything is compiled.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = "Generated from packages/design/tokens.json by scripts/generate.mjs. Do not edit: edit tokens.json and run `pnpm --filter @agentos/design build`.";
const APPEARANCES = ["dark", "light"];

/* ───────────── Reading ───────────── */

/** The tokens without their `$` notes. */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("$")).map(([key, inner]) => [key, strip(inner)]));
  }
  return value;
}

/** A colour as [r, g, b, alpha], from `#RRGGBB` or `rgba(r, g, b, a)`. */
function rgba(colour) {
  if (colour.startsWith("#")) return [...[1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)), 1];
  const parts = colour.match(/[\d.]+/g)?.map(Number);
  if (!parts || parts.length < 3) throw new Error(`Not a colour: ${colour}`);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

const withAlpha = (colour, alpha) => {
  const [r, g, b] = rgba(colour);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * A spring's step response, sampled: what CSS `linear()` needs to play the
 * same spring as SwiftUI and `motion`. ω = 2π / duration, ζ = 1 − bounce.
 * Returns the curve and how long it takes to settle within 0.1 %.
 */
export function sampleSpring({ duration, bounce }) {
  const omega = (2 * Math.PI) / duration;
  const zeta = 1 - bounce;
  const at = (t) => {
    if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
  };
  // Settled once the envelope stays under 0.1 % of the travel.
  let settle = 0;
  for (let t = 0; t < 5; t += 0.005) if (Math.abs(1 - at(t)) > 0.001) settle = t;
  settle = Math.ceil((settle + 0.005) * 100) / 100;
  const steps = 40;
  const points = Array.from({ length: steps + 1 }, (_, i) => (i === steps ? 1 : Math.round(at((settle * i) / steps) * 1000) / 1000));
  return { points, settle };
}

/* ───────────── CSS ───────────── */

const shadowCSS = ({ ring, highlight, shadows }) =>
  [`inset 0 1px 0 ${highlight}`, `0 0 0 1px ${ring}`, ...shadows.map(([x, y, blur, spread, colour]) => `${x}px ${y}px ${blur}px ${spread}px ${colour}`)].join(", ");

/** The custom properties that change with the appearance. */
function themed(t, appearance) {
  const out = [];
  for (const [name, value] of Object.entries(t.color)) out.push(`  --${name}: ${value[appearance]};`);
  // Aliases are declared again in every appearance: a custom property resolves var() where it is declared.
  for (const [old, now] of Object.entries(t.alias)) out.push(`  --${old}: var(--${now});`);
  for (const [name, level] of Object.entries(t.elevation)) out.push(`  --shadow-${name}: ${shadowCSS(level[appearance])};`);
  for (const [state, look] of Object.entries(t.presence)) {
    if (!look[appearance] || !look[appearance].from) continue;
    const { from, to, core, halo } = look[appearance];
    // `--presence-idle` is the state's accent, as before; the rest is what a page needs to echo the body's light.
    out.push(`  --presence-${state}: ${from};`, `  --presence-${state}-to: ${to};`, `  --presence-${state}-core: ${core};`, `  --presence-${state}-halo: ${halo};`);
  }
  out.push(`  --presence-via: ${t.presence.via[appearance]};`);
  const asking = t.color["asking-light"][appearance];
  out.push(
    `  --asking-edge: linear-gradient(90deg, transparent, ${withAlpha(asking, t.material["asking-edge"])} 50%, transparent);`,
    `  --asking-wash: radial-gradient(120% 90% at 0% 0%, ${withAlpha(asking, t.material["asking-wash"])}, transparent 60%);`,
    `  --primary-gradient: linear-gradient(180deg, ${t.color["primary-top"][appearance]}, ${t.color["primary-bottom"][appearance]});`,
    `  color-scheme: ${appearance};`,
  );
  return out;
}

/** The custom properties that never change. */
function fixed(t) {
  const out = [];
  for (const [name, stack] of Object.entries(t.font.web)) out.push(`  --font-${name}: ${stack};`);
  for (const [name, spec] of Object.entries(t.type)) {
    const family = spec.voice === "display" ? "display" : spec.voice === "mono" ? "mono" : "text";
    // A shorthand for `font:`, and the tracking that cannot go in it.
    out.push(`  --type-${name}: ${spec.weight} ${spec.size}px/${spec.line} var(--font-${family});`, `  --tracking-${name}: ${spec.tracking}em;`);
  }
  for (const [name, value] of Object.entries(t.space)) out.push(`  --space-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(t.radius)) out.push(`  --radius-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(t.size)) out.push(name === "icon-stroke" ? `  --icon-stroke: ${value};` : `  --size-${name}: ${value}px;`);
  const c = t.control;
  out.push(
    `  --press: ${c.press};`,
    // A percentage, ready for color-mix(in srgb, <fill> var(--hover-fill), transparent).
    `  --hover-fill: ${Math.round(c.hover * 100)}%;`,
    `  --hover-overlay: ${c["hover-overlay"]};`,
    `  --press-overlay: ${c["press-overlay"]};`,
    `  --disabled: ${c.disabled};`,
    `  --touch-guard: ${c["touch-guard"]}ms;`,
    `  --glass-filter: blur(${t.material["glass-blur"]}px) saturate(${Math.round(t.material["glass-saturate"] * 100)}%);`,
    `  --stage-light: ${t.presence["stage-light"].opacity};`,
  );
  for (const [name, rule] of Object.entries(t.stage)) {
    if (typeof rule === "number") out.push(`  --stage-${name}: ${rule}px;`);
    // `home-beside` reads the presence's own column, not the window: stageSize() decides it.
    else if (name !== "home-beside") out.push(`  --stage-${name}: clamp(${rule.min}px, min(${Math.round(rule.height * 100)}dvh, ${Math.round(rule.width * 100)}vw), ${rule.max}px);`);
  }
  const m = t.motion;
  for (const [name, value] of Object.entries(m.duration)) out.push(`  --duration-${name}: ${value}ms;`);
  for (const [name, curve] of Object.entries(m.ease)) out.push(`  --ease-${name}: cubic-bezier(${curve.join(", ")});`);
  for (const [name, spring] of Object.entries(m.spring)) {
    const { points, settle } = sampleSpring(spring);
    // CSS has no spring: this is the spring's curve, played over the time it takes to settle.
    out.push(`  --spring-${name}: linear(${points.join(", ")});`, `  --spring-${name}-duration: ${Math.round(settle * 1000)}ms;`);
  }
  out.push(`  --stagger: ${m.arrive.stagger}ms;`, `  --arrive-y: ${m.arrive.y}px;`, `  --arrive-blur: ${m.arrive.blur}px;`, `  --leave-y: ${m.leave.y}px;`);
  return out;
}

/** tokens.css: dark by default; `data-appearance` = light, dark or system on any element. */
export function css(t) {
  const block = (selector, body, indent = "") => `${indent}${selector} {\n${body.map((line) => indent + line).join("\n")}\n${indent}}`;
  const face = t.font.file;
  return [
    `/* ${HEADER} See docs/DESIGN.md. */`,
    "",
    // The font travels with the tokens, so a page that imports them is in the brand's type, offline.
    `@font-face {\n  font-family: ${face.family};\n  src: url("./${face.path}") format("woff2");\n  font-weight: ${face.weights.join(" ")};\n  font-style: normal;\n  font-display: swap;\n}`,
    "",
    block(":root", [...fixed(t), "", ...themed(t, "dark")]),
    "",
    block('[data-appearance="dark"]', themed(t, "dark")),
    "",
    block('[data-appearance="light"]', themed(t, "light")),
    "",
    `@media (prefers-color-scheme: light) {\n${block('[data-appearance="system"]', themed(t, "light"), "  ")}\n}`,
    "",
  ].join("\n");
}

/* ───────────── Swift ───────────── */

const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const hex = (colour) => {
  const [r, g, b, a] = rgba(colour);
  return { hex: `0x${[r, g, b].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`, alpha: a };
};
const swiftColour = (dark, light) => {
  const d = hex(dark);
  const l = hex(light);
  return `DesignColor(dark: ${d.hex}, ${d.alpha}, light: ${l.hex}, ${l.alpha})`;
};
/** One colour that does not change with the appearance. */
const swiftFixed = (colour) => {
  const c = hex(colour);
  return `designColor(${c.hex}, ${c.alpha})`;
};
const weight = (w) => (w < 350 ? ".light" : w < 450 ? ".regular" : w < 550 ? ".medium" : w < 650 ? ".semibold" : ".bold");
const doc = (text, indent) => (text ? `${indent}/// ${text}\n` : "");

export function swift(raw, t) {
  const L = [];
  const p = (line = "") => L.push(line);
  p(`// ${HEADER}`);
  p("// See docs/DESIGN.md. Compiled into the iPhone app and the watch app.");
  p();
  p("import SwiftUI");
  p("#if canImport(UIKit)");
  p("import UIKit");
  p("#endif");
  p();
  p("/// A colour of the design system: its value on dark surfaces and on light ones.");
  p("struct DesignColor: Sendable {");
  p("    let dark: UInt32");
  p("    let darkOpacity: Double");
  p("    let light: UInt32");
  p("    let lightOpacity: Double");
  p();
  p("    init(dark: UInt32, _ darkOpacity: Double, light: UInt32, _ lightOpacity: Double) {");
  p("        self.dark = dark");
  p("        self.darkOpacity = darkOpacity");
  p("        self.light = light");
  p("        self.lightOpacity = lightOpacity");
  p("    }");
  p();
  p("    /// The value on dark surfaces, whatever the system says (presence surfaces).");
  p("    var onDark: Color { designColor(dark, darkOpacity) }");
  p("    /// The value on light surfaces.");
  p("    var onLight: Color { designColor(light, lightOpacity) }");
  p();
  p("    /// Follows the appearance. The watch is a presence surface: always the dark value.");
  p("    var color: Color {");
  p("        #if os(watchOS)");
  p("        onDark");
  p("        #else");
  p("        let dark = UIColor(onDark), light = UIColor(onLight)");
  p("        return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })");
  p("        #endif");
  p("    }");
  p("}");
  p();
  p("/// A colour from its hex value and opacity, in sRGB.");
  p("private func designColor(_ hex: UInt32, _ opacity: Double) -> Color {");
  p("    Color(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)");
  p("}");
  p();
  p("/// A size of the type scale, following Dynamic Type from its `style`.");
  p("struct TypeSpec: Sendable {");
  p("    let size: CGFloat");
  p("    /// Line height as a multiple of the size.");
  p("    let line: CGFloat");
  p("    let weight: Font.Weight");
  p("    /// Letter-spacing in em: multiply by the size in use.");
  p("    let tracking: CGFloat");
  p("    let style: Font.TextStyle");
  p("    let design: Font.Design");
  p("}");
  p();
  p("/// A spring, as SwiftUI defines it: perceived duration in seconds, and bounce.");
  p("struct SpringSpec: Sendable {");
  p("    let duration: Double");
  p("    let bounce: Double");
  p("    var animation: Animation { .spring(duration: duration, bounce: bounce) }");
  p("}");
  p();
  p("/// One layer of a shadow, in points.");
  p("struct ShadowLayer: Sendable {");
  p("    let x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat");
  p("    let color: Color");
  p("}");
  p();
  p("/// An elevation: the 1 px ring, the 1 px top highlight and the shadow beneath.");
  p("struct ElevationSpec: Sendable {");
  p("    let ring: Color");
  p("    let highlight: Color");
  p("    let shadows: [ShadowLayer]");
  p("}");
  p();
  p("/// The colours of the presence in one state, on one kind of surface.");
  p("struct PresenceLook: Sendable {");
  p("    let from: Color, to: Color, core: Color, halo: Color");
  p("    let glow: Double");
  p("}");
  p();
  p("/// The side of the presence's stage: a share of the box it may use, kept between `min` and `max`.");
  p("struct StageRule: Sendable {");
  p("    let height: CGFloat, width: CGFloat, min: CGFloat, max: CGFloat");
  p("    func size(in box: CGSize) -> CGFloat {");
  p("        Swift.max(min, Swift.min(box.height * height, box.width * width, max)).rounded()");
  p("    }");
  p("}");
  p();
  p("/// Every token of docs/DESIGN.md.");
  p("enum Tokens {");

  p("    enum Colors {");
  for (const [name, value] of Object.entries(raw.color)) {
    if (name.startsWith("$")) continue;
    L.push(doc(value.$doc, "        ").replace(/\n$/, ""));
    p(`        static let ${camel(name)} = ${swiftColour(value.dark, value.light)}`);
  }
  p("    }");
  p();

  p("    /// The presence's colours per state. `dark` on presence surfaces, `light` on light utility surfaces.");
  p("    enum Presence {");
  for (const [state, look] of Object.entries(t.presence)) {
    if (!look.dark || !look.dark.from) continue;
    const one = (l) => `PresenceLook(from: ${swiftFixed(l.from)}, to: ${swiftFixed(l.to)}, core: ${swiftFixed(l.core)}, halo: ${swiftFixed(l.halo)}, glow: ${l.glow})`;
    L.push(doc(raw.presence[state].$doc, "        ").replace(/\n$/, ""));
    p(`        static let ${camel(state)} = (dark: ${one(look.dark)}, light: ${one(look.light)})`);
  }
  p(`        /// ${raw.presence.via.$doc}`);
  p(`        static let via = ${swiftColour(t.presence.via.dark, t.presence.via.light)}`);
  p(`        /// ${raw.presence["stage-light"].$doc}`);
  p(`        static let stageLight: Double = ${t.presence["stage-light"].opacity}`);
  p("    }");
  p();

  p("    enum TypeScale {");
  for (const [name, spec] of Object.entries(t.type)) {
    const design = spec.voice === "display" ? t.font.apple.display : spec.voice === "mono" ? t.font.apple.mono : t.font.apple.text;
    L.push(doc(raw.type[name].$doc, "        ").replace(/\n$/, ""));
    p(`        static let ${camel(name)} = TypeSpec(size: ${spec.size}, line: ${spec.line}, weight: ${weight(spec.weight)}, tracking: ${spec.tracking}, style: .${spec.apple}, design: .${design})`);
  }
  p("    }");
  p();

  p("    /// The spacing scale. Nothing in between.");
  p("    enum Space {");
  for (const [name, value] of Object.entries(t.space)) p(`        static let s${name}: CGFloat = ${value}`);
  p("    }");
  p();
  p("    /// Corner radii. Single-line controls are capsules.");
  p("    enum Radius {");
  for (const [name, value] of Object.entries(t.radius)) if (name !== "full") p(`        static let ${name}: CGFloat = ${value}`);
  p("    }");
  p();
  p("    enum Size {");
  for (const [name, value] of Object.entries(t.size)) p(`        static let ${camel(name)}: CGFloat = ${value}`);
  p("    }");
  p();
  p("    /// How a control answers a finger.");
  p("    enum Control {");
  p(`        static let press: CGFloat = ${t.control.press}`);
  p(`        static let pressOverlay: Double = ${t.control["press-overlay"]}`);
  p(`        static let disabled: Double = ${t.control.disabled}`);
  p("        /// A request's buttons ignore taps for this long after it appears, in seconds.");
  p(`        static let touchGuard: Double = ${t.control["touch-guard"] / 1000}`);
  p("    }");
  p();
  p("    /// `dark` on dark surfaces, `light` on light ones.");
  p("    enum Elevation {");
  for (const [name, level] of Object.entries(t.elevation)) {
    const one = (e) =>
      `ElevationSpec(ring: ${swiftFixed(e.ring)}, highlight: ${swiftFixed(e.highlight)}, shadows: [${e.shadows.map(([x, y, blur, spread, colour]) => `ShadowLayer(x: ${x}, y: ${y}, blur: ${blur}, spread: ${spread}, color: ${swiftFixed(colour)})`).join(", ")}])`;
    p(`        static let ${camel(name)} = (dark: ${one(level.dark)}, light: ${one(level.light)})`);
  }
  p("    }");
  p();
  p("    /// Sides of the presence's stage, per surface.");
  p("    enum Stage {");
  for (const [name, rule] of Object.entries(t.stage)) {
    if (typeof rule === "number") p(`        static let ${camel(name)}: CGFloat = ${rule}`);
    else p(`        static let ${camel(name)} = StageRule(height: ${rule.height}, width: ${rule.width}, min: ${rule.min}, max: ${rule.max})`);
  }
  p("    }");
  p();
  p("    enum Motion {");
  p("        /// Durations in seconds, for what fades rather than moves.");
  for (const [name, value] of Object.entries(t.motion.duration)) p(`        static let ${camel(name)}: Double = ${value / 1000}`);
  p("        /// Cubic-bezier control points, for `Animation.timingCurve`.");
  for (const [name, curve] of Object.entries(t.motion.ease)) p(`        static let ease${camel("-" + name)}: (Double, Double, Double, Double) = (${curve.join(", ")})`);
  for (const [name, spring] of Object.entries(t.motion.spring)) {
    L.push(doc(raw.motion.spring[name].$doc, "        ").replace(/\n$/, ""));
    p(`        static let ${camel(name)} = SpringSpec(duration: ${spring.duration}, bounce: ${spring.bounce})`);
  }
  p(`        static let arriveOffset: CGFloat = ${t.motion.arrive.y}`);
  p(`        static let arriveBlur: CGFloat = ${t.motion.arrive.blur}`);
  p(`        static let stagger: Double = ${t.motion.arrive.stagger / 1000}`);
  p(`        static let leaveOffset: CGFloat = ${t.motion.leave.y}`);
  p(`        static let iconSwapScale: CGFloat = ${t.motion["icon-swap"].scale}`);
  p(`        static let resolveOthers: Double = ${t.motion.resolve.others / 1000}`);
  p(`        static let resolveFold: Double = ${t.motion.resolve.fold / 1000}`);
  p(`        static let lineOut: Double = ${t.motion.line.out / 1000}`);
  p(`        static let lineIn: Double = ${t.motion.line.in / 1000}`);
  p("    }");
  p();
  p("    /// Which haptic means what: names of UIKit feedback and of WKHapticType.");
  p("    enum Haptic {");
  for (const [name, h] of Object.entries(t.haptic)) p(`        static let ${camel(name)} = (ios: "${h.ios}", watch: "${h.watch}")`);
  p("    }");
  p("}");
  p();
  return L.join("\n");
}

/* ───────────── TypeScript ───────────── */

export function ts(t) {
  return [
    `// ${HEADER}`,
    "",
    "/** Every token of tokens.json, without its notes. */",
    `export const data = ${JSON.stringify(t, null, 2)} as const;`,
    "",
  ].join("\n");
}

/* ───────────── Running ───────────── */

/** Every generated file, by its path in the package. */
export function render(raw = JSON.parse(readFileSync(resolve(root, "tokens.json"), "utf8"))) {
  const t = strip(raw);
  return { "tokens.css": css(t), "generated/Tokens.swift": swift(raw, t), "src/tokens.data.ts": ts(t) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = render();
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files).filter(([path, text]) => {
      try {
        return readFileSync(resolve(root, path), "utf8") !== text;
      } catch {
        return true;
      }
    });
    for (const [path] of stale) console.error(`${path} is out of date with tokens.json: run \`pnpm --filter @agentos/design build\`.`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), text);
  }
}
