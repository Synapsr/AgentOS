/**
 * Screenshot post-processing without an image library.
 *
 * Backends capture PNG at full resolution. On macOS the built-in `sips`
 * converts and downscales; other systems get the PNG as captured until they
 * have an equally boring tool wired in.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Backend, CaptureTarget } from "./backend.js";
import type { Screenshot } from "./index.js";

const exec = promisify(execFile);

/** Captures a window or the main display and returns it in the requested format and width. */
export async function captureScreenshot(
  backend: Backend,
  target: CaptureTarget,
  opts: { maxWidth?: number; format?: "jpeg" | "png" } = {},
): Promise<Screenshot> {
  // The picture only exists on disk for the time it takes to convert it.
  const dir = await mkdtemp(join(tmpdir(), "agentos-computer-"));
  try {
    const png = join(dir, "capture.png");
    return await encodeScreenshot(png, await backend.capture(target, png), opts);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The pixel size a `width`×`height` image has once it is no wider than `maxWidth`. */
export function fitWidth(width: number, height: number, maxWidth?: number): { width: number; height: number } {
  if (!maxWidth || width <= maxWidth) return { width, height };
  return { width: Math.round(maxWidth), height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/** Loads the PNG at `png` (of the given pixel size) as a screenshot in the requested format and width. */
export async function encodeScreenshot(
  png: string,
  size: { width: number; height: number },
  opts: { maxWidth?: number; format?: "jpeg" | "png" } = {},
  platform: string = process.platform,
): Promise<Screenshot> {
  const format = opts.format ?? "jpeg";
  const target = fitWidth(size.width, size.height, opts.maxWidth);
  const resize = target.width !== size.width;
  if (platform !== "darwin" || (format === "png" && !resize)) {
    return { data: await readFile(png), mime: "image/png", ...size };
  }
  const out = `${png}.${format}`;
  const args = ["-s", "format", format];
  if (format === "jpeg") args.push("-s", "formatOptions", "80");
  // -z takes height first. Giving both sides makes the result size exact and known.
  if (resize) args.push("-z", String(target.height), String(target.width));
  await exec("/usr/bin/sips", [...args, png, "--out", out]);
  return { data: await readFile(out), mime: `image/${format}`, ...target };
}
