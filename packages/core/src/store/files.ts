import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileRef } from "@agentos/protocol";
import { newId } from "../ids.js";

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };
const MIMES = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

/**
 * Screenshots and other binaries, one file each under `files/`. The id ends
 * with the file's extension, so nothing else needs to be stored to serve it.
 */
export class FileStore {
  constructor(private readonly dir: string) {}

  /** Stores an image and returns the reference to put in an item. */
  put(data: Uint8Array, image: { mime: string; width: number; height: number }): FileRef {
    const id = `${newId("file")}.${EXTENSIONS[image.mime] ?? "bin"}`;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    // A screenshot shows whatever was on the screen: the owner's alone.
    writeFileSync(join(this.dir, id), data, { mode: 0o600 });
    return { id, mime: image.mime, width: image.width, height: image.height };
  }

  /** Content of a stored file, or null when there is no such file. */
  read(id: string): { data: Buffer; mime: string } | null {
    // Ids are ours (`file_<hex>.<ext>`); anything else could be a path.
    const match = /^file_[0-9a-f]+\.([a-z]+)$/.exec(id);
    const path = join(this.dir, id);
    if (!match || !existsSync(path)) return null;
    return { data: readFileSync(path), mime: MIMES[match[1] ?? ""] ?? "application/octet-stream" };
  }
}
