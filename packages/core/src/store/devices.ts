import { createHash, timingSafeEqual } from "node:crypto";
import type { ClientPlatform, Device, PushRegistration } from "@agentos/protocol";
import { newId, newSecret } from "../ids.js";
import { readJson, writeJson } from "./disk.js";

interface DeviceRecord {
  device: Device;
  /** SHA-256 of the device token. The token itself is never stored. */
  tokenHash: string;
  push: PushRegistration | null;
}

/** `lastSeenAt` is only for humans: saving it more often than this would be noise on disk. */
const SEEN_GRANULARITY_MS = 60_000;

/** Paired devices, in `devices.json`. */
export class DeviceStore {
  private records: DeviceRecord[];

  constructor(private readonly path: string) {
    this.records = readJson<DeviceRecord[]>(path) ?? [];
  }

  list(): Device[] {
    return this.records.map((r) => r.device);
  }

  /** Registers a device and returns its token — the only time it exists in clear. */
  create(name: string, platform: ClientPlatform): { device: Device; token: string } {
    const token = newSecret();
    const device: Device = { id: newId("dev"), name, platform, createdAt: Date.now(), lastSeenAt: null };
    this.records.push({ device, tokenHash: hashToken(token), push: null });
    this.save();
    return { device, token };
  }

  /** The device this token belongs to, or null. */
  findByToken(token: string): Device | null {
    const hash = Buffer.from(hashToken(token), "hex");
    const record = this.records.find((r) => timingSafeEqual(Buffer.from(r.tokenHash, "hex"), hash));
    return record?.device ?? null;
  }

  /** Forgets a device; its token stops working at once. False when there is no such device. */
  remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.device.id !== id);
    if (this.records.length === before) return false;
    this.save();
    return true;
  }

  /** Notes that a device was just here. */
  touch(id: string): void {
    const record = this.records.find((r) => r.device.id === id);
    if (!record) return;
    const now = Date.now();
    if (now - (record.device.lastSeenAt ?? 0) < SEEN_GRANULARITY_MS) return;
    record.device.lastSeenAt = now;
    this.save();
  }

  /** Remembers where to send this device's notifications. */
  setPush(id: string, push: PushRegistration): void {
    const record = this.records.find((r) => r.device.id === id);
    if (!record) return;
    record.push = push.kind === "none" ? null : push;
    this.save();
  }

  /** The devices to notify through a push service, each with the token that service knows it by. */
  pushTargets(kind: "apns" | "fcm"): { deviceId: string; token: string; sandbox: boolean }[] {
    return this.records.flatMap(({ device, push }) =>
      push?.kind === kind && push.token ? [{ deviceId: device.id, token: push.token, sandbox: push.sandbox }] : [],
    );
  }

  private save(): void {
    writeJson(this.path, this.records);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
