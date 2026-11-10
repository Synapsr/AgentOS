import { VoiceUnavailable } from "./errors.js";
import type { Voice } from "./index.js";
import type { Provider } from "./provider.js";

/** The phone recognises and synthesises speech itself; the computer never sees audio. */
export const deviceVoice: Voice = {
  capabilities: () => ({ provider: "device", stt: "device", tts: "device", ttsMime: null }),
  transcribe: async () => {
    throw new VoiceUnavailable();
  },
  speak: async () => {
    throw new VoiceUnavailable();
  },
};

/** The default: no key, no setup. */
export const device: Provider = {
  id: "device",
  label: "On this device",
  needsKey: false,
  needsUrl: false,
  create: () => deviceVoice,
};
