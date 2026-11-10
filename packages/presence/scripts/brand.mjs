// Draws the brand assets in packages/design/brand from the presence and the
// design tokens — never by hand (docs/DESIGN.md, "Brand"):
//
//   pnpm --filter @agentos/presence build && pnpm --filter @agentos/presence brand
//
// It also refreshes the copies the apps ship: the iPhone and watch app icons
// and the desktop app's icons (with macOS's own `sips` and `iconutil`, and
// ImageMagick for the Windows .ico when it is there).
//
// The marks, the favicon and the menu-bar glyphs are drawn from `mark()` and
// `glyph()`. The logos, the app icons and the social card keep their layout
// and the wordmark's outlines, and take their colours from the tokens by role:
// the pearl gradient (`p`), the working gradient (`w`), the glow (`h`), the
// background (`bg`), the words. PNGs are rendered by headless Chrome
// (set CHROME to its path if it is not in /Applications); without it, only
// the SVGs are written.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { color, presence as looks } from "@agentos/design";
import { bridgePaths, dropsPath, glyph, mark, toSVG } from "../dist/index.js";

const BRAND = new URL("../../design/brand/", import.meta.url);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pearl = looks.dark.idle, ink = looks.light.idle, working = looks.dark.working;
const n = (x) => +x.toFixed(2);
const read = (name) => readFileSync(new URL(name, BRAND), "utf8");
const write = (name, text) => writeFileSync(new URL(name, BRAND), text);

/** Renders an SVG to a PNG of `width` × `height` with headless Chrome. */
function png(name, svg, width, height) {
  if (!existsSync(CHROME)) return console.warn(`no Chrome: ${name} not rendered`);
  const out = new URL(name, BRAND).pathname;
  const page = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--default-background-color=00000000", `--window-size=${width},${height}`, `--screenshot=${out}`, page], { stdio: "ignore" });
}

/** An SVG at another pixel size, same drawing. */
const sized = (svg, width, height) => svg.replace(/width="[^"]+" height="[^"]+"/, `width="${width}" height="${height}"`);

/** The mark's paths at `size`, filled with `fill`. */
function markPaths(size, fill) {
  const frame = mark(size);
  return `<path d="${dropsPath(frame)}" fill="${fill}"/>` + bridgePaths(frame).map((d) => `<path d="${d}" fill="${fill}"/>`).join("");
}

/** The stage's own gradient for a mark of `size`: from the top left to the bottom right. */
const gradient = (id, size, from, to) => {
  const u = size / 2;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(-0.6 * u)}" y1="${n(-0.7 * u)}" x2="${n(0.6 * u)}" y2="${n(0.7 * u)}"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
};

// ── The mark ──
write("mark.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="currentColor"><g transform="translate(32 32)">${markPaths(64, "currentColor")}</g></svg>`);
write("mark-on-dark.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs>${gradient("p", 64, pearl.from, pearl.to)}</defs><g transform="translate(32 32)">${markPaths(64, "url(#p)")}</g></svg>`);
write("mark-on-light.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><g transform="translate(32 32)">${markPaths(64, ink.from)}</g></svg>`);

// ── The favicon: ink in a light browser, pearl in a dark one ──
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><style>g{fill:${ink.from}}@media(prefers-color-scheme:dark){g{fill:${pearl.from}}}</style><g transform="translate(16 16.4)">${markPaths(32, "inherit").replaceAll(' fill="inherit"', "")}</g></svg>`;
write("favicon.svg", favicon);
// The PNG is for browsers that read no SVG: ink, as on a light tab.
png("favicon-32.png", favicon.replace(/<style>.*<\/style>/, "").replace("<g ", `<g fill="${ink.from}" `), 32, 32);

// ── The menu bar: template images, black and alpha only. Idle is the mark, small ──
for (const state of ["idle", "working", "waiting", "offline"]) {
  const svg = toSVG(glyph(state, 18), { fill: "#000", glow: false });
  const names = state === "idle" ? ["menubar-idle", "menubarTemplate"] : [`menubar-${state}`];
  for (const name of names) {
    write(`${name}.svg`, svg);
    png(`${name}.png`, svg, 18, 18);
    png(`${name}@2x.png`, sized(svg, 36, 36), 36, 36);
  }
}

// ── Everything with a layout of its own: colours by role, from the tokens ──
const stops = {
  p: (from, to) => `<stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
  h: (halo) => `<stop stop-color="${halo}"/><stop offset=".45" stop-color="${halo}" stop-opacity=".32"/><stop offset="1" stop-color="${halo}" stop-opacity="0"/>`,
  bg: () => `<stop stop-color="${color.dark.surface}"/><stop offset=".6" stop-color="${color.dark["surface-stage"]}"/><stop offset="1" stop-color="#000"/>`,
};
const setStops = (svg, id, inner) => svg.replace(new RegExp(`(<(linear|radial)Gradient id="${id}"[^>]*>)[\\s\\S]*?(</\\2Gradient>)`, "g"), (_, open, __, close) => open + inner + close);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
/** Every solid fill but black takes `hex`, keeping its opacity. */
const words = (svg, hex) =>
  svg.replace(/fill="#(?!000"|000000")[0-9a-fA-F]{6}"/g, `fill="${hex}"`).replace(/fill="rgba\(\d+,\d+,\d+,([\d.]+)\)"/g, (_, alpha) => `fill="rgba(${rgb(hex)},${alpha})"`);

const icon = (svg) => setStops(setStops(setStops(svg, "bg", stops.bg()), "p", stops.p(pearl.core, pearl.to)), "h", stops.h(pearl.halo));
write("logo-on-dark.svg", words(setStops(read("logo-on-dark.svg"), "p", stops.p(pearl.from, pearl.to)), color.dark.text));
write("logo-on-light.svg", words(read("logo-on-light.svg"), ink.from));
const appIcon = icon(read("app-icon.svg"));
write("app-icon.svg", appIcon);
png("app-icon.png", appIcon, 1024, 1024);
const macIcon = icon(read("app-icon-macos.svg"));
write("app-icon-macos.svg", macIcon);
png("app-icon-macos.png", macIcon, 1024, 1024);
const card = words(setStops(setStops(setStops(read("social-card.svg"), "p", stops.p(pearl.from, pearl.to)), "w", stops.p(working.from, working.to)), "h", stops.h(working.halo)), color.dark.text);
write("social-card.svg", card);
png("social-card.png", card, 1200, 630);
// ── The copies the apps ship: the iPhone and watch icons, the desktop app's icons ──
const APPS = new URL("../../../apps/", import.meta.url);
const icon1024 = new URL("app-icon.png", BRAND).pathname, mac1024 = new URL("app-icon-macos.png", BRAND).pathname;
const has = (tool) => {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
if (existsSync(icon1024)) {
  for (const app of ["ios/AgentOS/Resources", "ios/Watch"]) copyFileSync(icon1024, new URL(`${app}/Assets.xcassets/AppIcon.appiconset/AppIcon.png`, APPS));
}
if (existsSync(mac1024) && has("sips") && has("iconutil")) {
  const icons = new URL("desktop/src-tauri/icons/", APPS).pathname;
  const resize = (side, out) => execFileSync("sips", ["-z", `${side}`, `${side}`, mac1024, "--out", out], { stdio: "ignore" });
  resize(32, `${icons}32x32.png`);
  resize(128, `${icons}128x128.png`);
  resize(256, `${icons}128x128@2x.png`);
  // The .icns from an iconset made beside it, then removed.
  const set = `${icons}icon.iconset/`;
  mkdirSync(set, { recursive: true });
  for (const side of [16, 32, 128, 256, 512]) {
    resize(side, `${set}icon_${side}x${side}.png`);
    resize(side * 2, `${set}icon_${side}x${side}@2x.png`);
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", `${icons}icon.icns`]);
  rmSync(set, { recursive: true });
  if (has("magick")) execFileSync("magick", [mac1024, "-define", "icon:auto-resize=256,64,48,32,24,16", `${icons}icon.ico`]);
  else console.warn("no ImageMagick: icon.ico not redrawn");
}
console.log("brand assets drawn in", BRAND.pathname);
