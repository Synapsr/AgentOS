/**
 * @agentos/voice — ears and mouth for the agent.
 *
 * The agent is the brain; this package only turns speech into text and text
 * into speech. With the `device` provider (the default, no key needed) the
 * client does both on-device and the computer never sees audio. With a
 * premium provider the client sends audio to the computer, which holds the
 * key.
 */
import type { VoiceCapabilities } from "@agentos/protocol";
import { device, deviceVoice } from "./device.js";
import { elevenlabs } from "./elevenlabs.js";
import { local } from "./local.js";
import type { Provider } from "./provider.js";

export { VoiceError, VoiceUnavailable, type VoiceErrorCode } from "./errors.js";

export interface VoiceConfig {
  /** Provider id. `device` needs nothing. */
  provider: string;
  apiKey?: string;
  /** Provider-specific voice id or name. */
  voice?: string;
  /** BCP-47 language hint, e.g. "fr". */
  language?: string;
  /** Address of the speech server for `local`, e.g. "http://127.0.0.1:8000". */
  url?: string;
  /** Speech-to-text model, to replace the provider's default. */
  sttModel?: string;
  /** Text-to-speech model, to replace the provider's default. */
  ttsModel?: string;
}

export interface SpeechAudio {
  /** What the stream holds, to send as its `Content-Type`. */
  mime: string;
  stream: ReadableStream<Uint8Array>;
}

export interface Voice {
  capabilities(): VoiceCapabilities;
  /** One utterance in, text out. Throws `VoiceUnavailable` for `device`, `VoiceError` when the provider fails. */
  transcribe(audio: Uint8Array, opts: { mime: string; language?: string; signal?: AbortSignal }): Promise<string>;
  /** Text in, audio stream out (starts before synthesis is finished). Throws like `transcribe`. */
  speak(text: string, opts?: { language?: string; signal?: AbortSignal }): Promise<SpeechAudio>;
}

export interface VoiceProviderInfo {
  id: string;
  label: string;
  needsKey: boolean;
  /** Needs the address of the owner's own speech server. */
  needsUrl: boolean;
}

const providers: Provider[] = [device, elevenlabs, local];

/** Providers this build knows about, default first. */
export const voiceProviders: VoiceProviderInfo[] = providers.map(({ id, label, needsKey, needsUrl }) => ({
  id,
  label,
  needsKey,
  needsUrl,
}));

/**
 * Unknown providers fall back to `device` so a typo never breaks the app, and
 * so does a provider that lacks its key or URL.
 */
export function createVoice(config: VoiceConfig): Voice {
  return providers.find((provider) => provider.id === config.provider)?.create(config) ?? deviceVoice;
}
