#!/usr/bin/env node
/**
 * Has Apple notarize the app and the disk image `pnpm desktop:bundle` made,
 * and staples the tickets to them, so that both open on any Mac without a
 * warning, even offline:
 *
 *   1. the app goes to Apple's notary service and gets its ticket stapled;
 *   2. the disk image Tauri made is opened, the app inside it gets the same
 *      ticket, and the image is compressed and signed again;
 *   3. the disk image goes to the notary service and gets its ticket stapled;
 *   4. both are checked the way Gatekeeper checks them, and the image's
 *      SHA-256 is written next to it.
 *
 * Why the app is stapled as well as the image: the app's own ticket goes
 * wherever the app is copied, the image's stays with the image. The image is
 * opened rather than made again so that it keeps Tauri's layout.
 *
 * The bundle must have been built with a Developer ID in
 * APPLE_SIGNING_IDENTITY: Apple refuses to notarize an app signed ad hoc.
 *
 * Environment:
 *   AGENTOS_NOTARY_PROFILE   the notarytool keychain profile to send with
 *                            (made once with `xcrun notarytool store-credentials`)
 *   APPLE_SIGNING_IDENTITY   the identity that signs the disk image; default:
 *                            the one that signed the app
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(desktop, "src-tauri/tauri.conf.json"), "utf8"));
const bundle = join(desktop, "src-tauri/target/release/bundle");
// The names Tauri gives what it makes.
const arch = { arm64: "aarch64", x64: "x64" }[process.arch];
const app = join(bundle, "macos", `${config.productName}.app`);
const dmg = join(bundle, "dmg", `${config.productName}_${config.version}_${arch}.dmg`);
// Work files stay in the build folder, which is not part of the repository.
const work = join(bundle, "notarize");

const say = (line) => console.log(`notarize: ${line}`);

/** Stops the release with a message. Thrown, so that disk images opened on the way are closed again. */
function fail(message) {
  throw Object.assign(new Error(message), { expected: true });
}

/** Runs a command and returns what it printed; fails when the command does, unless told not to. */
function run(command, args, { check = true } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (check && result.status !== 0) fail(`${command} ${args.join(" ")} failed:\n${output || result.error?.message}`);
  return { stdout: result.stdout ?? "", output };
}

/** Sends a file to Apple's notary service and waits for its answer; prints Apple's log when it says no. */
function notarize(file, profile) {
  say(`sending ${basename(file)} to Apple, which takes a few minutes`);
  const sent = run("xcrun", ["notarytool", "submit", file, "--keychain-profile", profile, "--wait", "--output-format", "json"], { check: false });
  const answer = sent.stdout
    .trim()
    .split("\n")
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.status);
  if (!answer) fail(`notarytool did not answer as expected:\n${sent.output}`);
  if (answer.status !== "Accepted") {
    const log = answer.id ? run("xcrun", ["notarytool", "log", answer.id, "--keychain-profile", profile], { check: false }).output : "";
    fail(`Apple did not accept ${basename(file)}: ${answer.status}, ${answer.message ?? ""}\n${log}`);
  }
  say(`Apple accepted ${basename(file)} (submission ${answer.id})`);
}

/** Opens a disk image where only this script sees it (not in the Finder), runs `use`, and closes it again. */
function withImage(image, mountpoint, options, use) {
  mkdirSync(mountpoint, { recursive: true });
  run("hdiutil", ["attach", image, "-nobrowse", "-noautoopen", "-mountpoint", mountpoint, "-quiet", ...options]);
  try {
    use(mountpoint);
  } finally {
    run("hdiutil", ["detach", mountpoint, "-quiet"], { check: false });
  }
}

/** Runs one of Gatekeeper's checks and prints its answer, which must say Apple's ticket was found. */
function check(label, command, args) {
  const { output } = run(command, args);
  // spctl accepts any Developer ID; only "Notarized" means it found Apple's ticket.
  if (command === "spctl" && !output.includes("source=Notarized Developer ID")) fail(`${label} is accepted, but not as notarized:\n${output}`);
  say(`${label}: ${output.split("\n").filter((line) => !line.startsWith("Processing")).join(" | ")}`);
}

async function release() {
  if (process.platform !== "darwin") fail("notarizing is for macOS builds, made on a Mac.");
  const profile = process.env.AGENTOS_NOTARY_PROFILE || fail("set AGENTOS_NOTARY_PROFILE to your notarytool keychain profile (xcrun notarytool store-credentials).");
  for (const made of [app, dmg]) if (!existsSync(made)) fail(`${made} is missing: run pnpm desktop:bundle first.`);

  const authority = /^Authority=(Developer ID Application: .+)$/m.exec(run("codesign", ["-dvv", app]).output)?.[1];
  if (!authority) fail(`${basename(app)} is not signed with a Developer ID: build it again with APPLE_SIGNING_IDENTITY set.`);
  const identity = process.env.APPLE_SIGNING_IDENTITY || authority;
  run("codesign", ["--verify", "--deep", "--strict", app]);

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  // 1. The app.
  const zip = join(work, `${config.productName}.zip`);
  run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  notarize(zip, profile);
  run("xcrun", ["stapler", "staple", app]);

  // 2. The app inside the image.
  const writable = join(work, "writable.dmg");
  run("hdiutil", ["convert", dmg, "-format", "UDRW", "-o", writable, "-quiet"]);
  withImage(writable, join(work, "volume"), [], (volume) => {
    run("xcrun", ["stapler", "staple", join(volume, basename(app))]);
    // What macOS writes on a volume it opens writable does not ship.
    rmSync(join(volume, ".fseventsd"), { recursive: true, force: true });
  });
  const packed = join(work, basename(dmg));
  // Compressed as Tauri compresses it.
  run("hdiutil", ["convert", writable, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", packed, "-quiet"]);
  run("codesign", ["--force", "--sign", identity, "--timestamp", packed]);
  renameSync(packed, dmg);

  // 3. The image.
  notarize(dmg, profile);
  run("xcrun", ["stapler", "staple", dmg]);

  // 4. As Gatekeeper sees them, the app inside the image included.
  check("app, signature", "codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  check("app, ticket", "xcrun", ["stapler", "validate", app]);
  check("app, Gatekeeper", "spctl", ["-a", "-vvv", "-t", "exec", app]);
  check("image, ticket", "xcrun", ["stapler", "validate", dmg]);
  check("image, Gatekeeper", "spctl", ["-a", "-vvv", "-t", "open", "--context", "context:primary-signature", dmg]);
  withImage(dmg, join(work, "shipped"), ["-readonly"], (volume) => {
    const inside = join(volume, basename(app));
    check("app in the image, ticket", "xcrun", ["stapler", "validate", inside]);
    check("app in the image, Gatekeeper", "spctl", ["-a", "-vvv", "-t", "exec", inside]);
  });

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(dmg)) hash.update(chunk);
  writeFileSync(`${dmg}.sha256`, `${hash.digest("hex")}  ${basename(dmg)}\n`);
  rmSync(work, { recursive: true, force: true });

  say(`done: ${dmg} (${(statSync(dmg).size / 1024 / 1024).toFixed(1)} MB), signed by ${authority}, notarized and stapled`);
  say(`its SHA-256 is in ${basename(dmg)}.sha256`);
}

try {
  await release();
} catch (error) {
  console.error(`notarize: ${error.expected ? error.message : error.stack}`);
  process.exitCode = 1;
}
