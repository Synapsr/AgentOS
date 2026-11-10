#!/usr/bin/env node
/**
 * Puts together the runtime a built AgentOS app carries inside it, so that
 * it runs on a computer with nothing installed:
 *
 *   src-tauri/binaries/runtime/
 *     node            the official Node.js for the target, pinned below
 *     core/           @agentos/core and its production dependencies, in the
 *                     versions of the lockfile, as `pnpm deploy` lays them
 *                     out (a plain node_modules)
 *     agent-desktop/  the agent's eyes and hands: the program and its macOS
 *                     helper, under the plain names @agentos/computer looks
 *                     for in AGENTOS_AGENT_DESKTOP_BIN
 *     ui/             the built interface
 *     licenses/       Node.js's licence (each package keeps its own)
 *     manifest.json   what is in here, where it came from, and its checksums
 *
 * `tauri build --config src-tauri/tauri.bundle.conf.json` runs this first and
 * ships the folder as `<resources>/runtime`; `pnpm bundle` is that command.
 *
 * Why this layout: the core runs here from the same files it runs from in
 * development, and Claude Code sits in the Agent SDK's package, where the SDK
 * looks for it: nothing is rewritten by a bundler. Claude Code and Node.js
 * are nine tenths of the size, so packing the JavaScript tighter would save
 * little. agent-desktop gets a folder of its own so that it and its helper
 * run from inside the signed app rather than from a copy in the data
 * directory, which the agent can write to.
 *
 * Signing (macOS): every native program in the folder is signed here with the
 * identity in APPLE_SIGNING_IDENTITY — the variable Tauri itself signs the app
 * with — or ad hoc without one, always with the hardened runtime. The one
 * exception is Claude Code, which is shipped exactly as Anthropic published
 * and signed it: it is checked against the SDK's checksum and never touched.
 *
 * Environment:
 *   APPLE_SIGNING_IDENTITY     a "Developer ID Application: …" identity; default ad hoc
 *   AGENTOS_BUNDLE_PREBUILT=1  take the packages' `dist` as they are instead of building them
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/**
 * The Node.js the app ships. To move to another release, change the version
 * and the checksums: `archive` is the line of that release's SHASUMS256.txt,
 * `binary` is printed by this script when it does not match.
 */
const NODE = {
  version: "24.22.2",
  builds: {
    "darwin-arm64": {
      archive: "aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a",
      binary: "b6fb419f0f43bb2fbca273700294dd2f3b685a64b60e8417c295f47646a70e4a",
    },
    "darwin-x64": {
      archive: "d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52",
      binary: "bdcd4500054d48c9ec6058706795d91cac83e3e3eaced218434294d8f2fbf7fa",
    },
  },
};

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(desktop, "../..");
const binaries = join(desktop, "src-tauri/binaries");
const runtime = join(binaries, "runtime");
const entitlements = join(desktop, "src-tauri/macos");

// Tauri names the target it is building for; on its own the script builds for this computer.
const platform = { windows: "win32" }[process.env.TAURI_ENV_PLATFORM] ?? process.env.TAURI_ENV_PLATFORM ?? process.platform;
const arch = { aarch64: "arm64", x86_64: "x64" }[process.env.TAURI_ENV_ARCH] ?? process.env.TAURI_ENV_ARCH ?? process.arch;
const target = `${platform}-${arch}`;
const identity = process.env.APPLE_SIGNING_IDENTITY || "-";

const say = (line) => console.log(`runtime: ${line}`);
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32", ...options });
const read = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function fail(message) {
  console.error(`runtime: ${message}`);
  process.exit(1);
}

/** Every file under a folder. */
function* files(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

const sizeOf = (path) => (statSync(path).isDirectory() ? [...files(path)].reduce((sum, file) => sum + statSync(file).size, 0) : statSync(path).size);

// The native parts of the core are installed by pnpm for the computer it runs on.
if (target !== `${process.platform}-${process.arch}`) {
  fail(`this computer is ${process.platform}-${process.arch} and can only assemble a runtime for itself, not for ${target}: Claude Code and agent-desktop are installed for the computer pnpm runs on.`);
}
const build = NODE.builds[target] ?? fail(`no Node.js is pinned for ${target} yet: add its checksums to NODE.builds.`);

// ───────────────────────────── The core and the interface ─────────────────────────────

if (!process.env.AGENTOS_BUNDLE_PREBUILT) {
  say("building the core, the interface and what they depend on");
  run("pnpm", ["--filter", "@agentos/core...", "--filter", "@agentos/ui...", "build"], { cwd: repo });
}
for (const built of ["packages/core/dist/cli.js", "packages/ui/dist/index.html"]) {
  if (!existsSync(join(repo, built))) fail(`${built} is missing: build the packages first.`);
}

say("laying out the core with its production dependencies");
const core = join(runtime, "core");
rmSync(core, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
// The versions the lockfile names, in a flat node_modules of real files: nothing in an
// app bundle should be a link. Workspace packages are copied in ("injected") for this
// command only; the workspace itself keeps linking them.
run("pnpm", ["--filter", "@agentos/core", "deploy", "--prod", "--config.inject-workspace-packages=true", "--config.node-linker=hoisted", core], { cwd: repo });

// pnpm names the workspace packages by where they were on this computer; name them by version.
const modules = join(core, "node_modules");
const corePackage = JSON.parse(readFileSync(join(core, "package.json"), "utf8"));
for (const [name, where] of Object.entries(corePackage.dependencies)) {
  if (where.includes("file:")) corePackage.dependencies[name] = JSON.parse(readFileSync(join(modules, name, "package.json"), "utf8")).version;
}
writeFileSync(join(core, "package.json"), `${JSON.stringify(corePackage, null, 2)}\n`);

const ui = join(runtime, "ui");
rmSync(ui, { recursive: true, force: true });
cpSync(join(repo, "packages/ui/dist"), ui, { recursive: true });

// ───────────────────────────── What a running core never opens ─────────────────────────────

// pnpm's own bookkeeping, which also names folders of the computer that built this.
for (const leftover of [".bin", ".pnpm", ".modules.yaml", ".pnpm-workspace-state-v1.json"]) rmSync(join(modules, leftover), { recursive: true, force: true });
rmSync(join(core, "pnpm-lock.yaml"), { force: true });

// agent-desktop ships every platform's programs in one npm package. This target's move
// to a folder of their own, under their plain names (`agent-desktop`, and on macOS
// `agent-desktop-macos-helper`, which the program insists on finding under that name);
// the rest of the package is only a Node launcher and is left behind.
const agentDesktopPackage = JSON.parse(readFileSync(join(modules, "agent-desktop/package.json"), "utf8"));
const agentDesktop = join(runtime, "agent-desktop");
rmSync(agentDesktop, { recursive: true, force: true });
mkdirSync(agentDesktop);
const agentDesktopPublished = {};
for (const name of readdirSync(join(modules, "agent-desktop/bin"))) {
  const program = join(modules, "agent-desktop/bin", name);
  if (name.endsWith(".sha256") || !name.replace(/\.exe$/, "").endsWith(target)) continue;
  // What its package says each program is, checked before signing changes it.
  const published = readFileSync(`${program}.sha256`, "utf8").trim().split(/\s+/)[0];
  if (sha256(program) !== published) fail(`${name} is not the file its package describes.`);
  agentDesktopPublished[name] = published;
  copyFileSync(program, join(agentDesktop, name.replace(`-${target}`, "")));
}
if (Object.keys(agentDesktopPublished).length === 0) fail(`agent-desktop@${agentDesktopPackage.version} has no program for ${target}.`);
rmSync(join(modules, "agent-desktop"), { recursive: true, force: true });

// Source maps, type declarations, TypeScript sources and change logs. Licences and READMEs stay.
const KEEP = /^(readme|licen[cs]e|notice|copying)/i;
let trimmed = 0;
for (const file of [...files(core), ...files(ui)]) {
  const name = basename(file);
  if (/\.(map|tsbuildinfo|[cm]?tsx?)$/.test(name) || (/\.(md|markdown)$/i.test(name) && !KEEP.test(name))) {
    trimmed += statSync(file).size;
    rmSync(file);
  }
}
say(`left out ${megabytes(trimmed)} of maps, typings, sources and change logs`);

// ───────────────────────────── Node.js ─────────────────────────────

const nodeName = platform === "win32" ? "node.exe" : "node";
const release = `node-v${NODE.version}-${target}`;
const pristine = join(binaries, "cache", release, nodeName);
if (!existsSync(pristine) || sha256(pristine) !== build.binary) {
  const url = `https://nodejs.org/dist/v${NODE.version}/${release}.tar.gz`;
  say(`downloading ${url}`);
  const archive = join(binaries, "cache", `${release}.tar.gz`);
  mkdirSync(dirname(pristine), { recursive: true });
  try {
    const response = await fetch(url);
    if (!response.ok) fail(`nodejs.org answered ${response.status} for ${url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    // Checked twice: against what this file pins, and against what nodejs.org publishes today.
    const sums = await (await fetch(`https://nodejs.org/dist/v${NODE.version}/SHASUMS256.txt`)).text();
    const published = sums.split("\n").find((line) => line.endsWith(`  ${release}.tar.gz`))?.split(/\s+/)[0];
    const actual = sha256(archive);
    if (actual !== build.archive || actual !== published) {
      fail(`${release}.tar.gz does not match its checksum.\n  downloaded ${actual}\n  pinned     ${build.archive}\n  published  ${published}`);
    }
    run("tar", ["-xzf", archive, "-C", dirname(pristine), "--strip-components=2", `${release}/bin/node`]);
    run("tar", ["-xzf", archive, "-C", dirname(pristine), "--strip-components=1", `${release}/LICENSE`]);
  } finally {
    rmSync(archive, { force: true });
  }
  if (sha256(pristine) !== build.binary) fail(`the node inside ${release}.tar.gz is ${sha256(pristine)}, not the pinned ${build.binary}.`);
}
const node = join(runtime, nodeName);
rmSync(node, { force: true });
copyFileSync(pristine, node);
mkdirSync(join(runtime, "licenses"), { recursive: true });
copyFileSync(join(dirname(pristine), "LICENSE"), join(runtime, "licenses/node-LICENSE"));

// ───────────────────────────── Claude Code, exactly as published ─────────────────────────────

const sdk = JSON.parse(readFileSync(join(modules, "@anthropic-ai/claude-agent-sdk/package.json"), "utf8"));
const sdkManifest = JSON.parse(readFileSync(join(modules, "@anthropic-ai/claude-agent-sdk/manifest.json"), "utf8"));
const claudePackage = `@anthropic-ai/claude-agent-sdk-${target}`;
const claude = join(modules, claudePackage, sdkManifest.platforms[target]?.binary ?? "claude");
if (!existsSync(claude)) fail(`${claudePackage} is not installed: the Agent SDK's program for ${target} is missing.`);
const claudeSum = sha256(claude);
if (claudeSum !== sdkManifest.platforms[target].checksum) fail(`the Claude Code program is not the one the Agent SDK ${sdk.version} describes (${claudeSum}).`);

// ───────────────────────────── Signatures ─────────────────────────────

/** Whether a file is a Mach-O program or library, by its first bytes. */
function isMachO(file) {
  const head = Buffer.alloc(4);
  const handle = openSync(file, "r");
  try {
    readSync(handle, head, 0, 4, 0);
  } finally {
    closeSync(handle);
  }
  return ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"].includes(head.toString("hex"));
}

/** Who signed a program, in codesign's words. */
function signer(file) {
  const told = read("/bin/sh", ["-c", `codesign -dvv "$1" 2>&1`, "sh", file]);
  return /^Authority=(.+)$/m.exec(told)?.[1] ?? (/Signature=adhoc/.test(told) ? "ad hoc" : "unsigned");
}

const signed = {};
if (platform === "darwin") {
  for (const file of files(runtime)) {
    if (file === claude || !isMachO(file)) continue;
    const args = ["--force", "--sign", identity, "--options", "runtime", identity === "-" ? "--timestamp=none" : "--timestamp"];
    // Node.js makes machine code as it runs; the hardened runtime only allows that when asked.
    if (file === node) args.push("--entitlements", join(entitlements, "node.entitlements"));
    try {
      run("codesign", [...args, file], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      fail(`${relative(runtime, file)} could not be signed with "${identity}": ${String(error.stderr ?? error.message).trim()}`);
    }
    signed[relative(runtime, file)] = signer(file);
  }
  run("codesign", ["--verify", "--strict", claude]);
  say(`signed ${Object.keys(signed).length} programs with ${identity === "-" ? "an ad hoc signature" : identity}; Claude Code keeps Anthropic's`);
}

// ───────────────────────────── The manifest ─────────────────────────────

const lock = readFileSync(join(repo, "pnpm-lock.yaml"), "utf8");
const integrity = new RegExp(`'${claudePackage}@${sdk.version}':\\s+resolution: \\{integrity: ([^}\\s]+)\\}`).exec(lock)?.[1] ?? null;
const sizes = {
  node: sizeOf(node),
  claudeCode: sizeOf(claude),
  agentDesktop: sizeOf(agentDesktop),
  ui: sizeOf(ui),
};
sizes.core = sizeOf(core) - sizes.claudeCode;

writeFileSync(
  join(runtime, "manifest.json"),
  `${JSON.stringify(
    {
      target,
      node: {
        version: NODE.version,
        origin: `https://nodejs.org/dist/v${NODE.version}/${release}.tar.gz`,
        archiveSha256: build.archive,
        sha256AsPublished: build.binary,
        signedBy: signed[nodeName] ?? null,
        note: "The official program, signed again with the app's identity. Its licence is in licenses/node-LICENSE.",
      },
      core: { version: corePackage.version, layout: "pnpm deploy --prod, hoisted node_modules" },
      claudeCode: {
        path: relative(runtime, claude),
        version: sdkManifest.version,
        commit: sdkManifest.commit,
        built: sdkManifest.buildDate,
        origin: `npm package ${claudePackage}@${sdk.version}, the program @anthropic-ai/claude-agent-sdk@${sdk.version} runs`,
        npmIntegrity: integrity,
        sha256: claudeSum,
        matchesTheSdkChecksum: true,
        signedBy: platform === "darwin" ? signer(claude) : null,
        modified: false,
        licence: readFileSync(join(modules, claudePackage, "LICENSE.md"), "utf8").trim(),
      },
      agentDesktop: {
        folder: relative(runtime, agentDesktop),
        version: agentDesktopPackage.version,
        origin: `npm package agent-desktop@${agentDesktopPackage.version}`,
        licence: agentDesktopPackage.license,
        sha256AsPublished: agentDesktopPublished,
        signedBy: Object.fromEntries(readdirSync(agentDesktop).map((name) => [name, signed[join(relative(runtime, agentDesktop), name)] ?? null])),
      },
      bytes: sizes,
    },
    null,
    2,
  )}\n`,
);

// Nothing that ships may name the folder it was built in, and the Finder's notes do not ship.
for (const file of files(runtime)) {
  if (basename(file) === ".DS_Store") {
    rmSync(file);
    continue;
  }
  if (statSync(file).size < 8 * 1024 * 1024 && readFileSync(file).includes(repo)) fail(`${relative(runtime, file)} names this computer's folders (${repo}).`);
}

say(`${target}, ${megabytes(sizeOf(runtime))} in ${[...files(runtime)].length} files`);
for (const [part, bytes] of Object.entries(sizes).sort((a, b) => b[1] - a[1])) say(`  ${part.padEnd(13)} ${megabytes(bytes).padStart(9)}`);
