import type { Voice, VoiceConfig, VoiceProviderInfo } from "./index.js";

/** One speech backend: how it is listed in settings, and how to build it. */
export interface Provider extends VoiceProviderInfo {
  /** Returns null when the configuration lacks what this provider needs (its key or URL). */
  create(config: VoiceConfig): Voice | null;
}
