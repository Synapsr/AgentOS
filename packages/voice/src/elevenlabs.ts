/**
 * ElevenLabs: one key for both directions.
 *
 * Checked against https://elevenlabs.io/docs and the live API in November 2026:
 * - `POST /v1/speech-to-text` takes one uploaded utterance (multipart) with the `scribe_v2` model.
 * - `POST /v1/text-to-speech/{voice_id}/stream` answers with MP3 as it is synthesised.
 */
import { VoiceError } from "./errors.js";
import { appendAudio, languageCode, speech, transcript } from "./http.js";
import type { Provider } from "./provider.js";

const name = "ElevenLabs";
const api = "https://api.elevenlabs.io";
const sttModel = "scribe_v2";
/** The low-latency model documented for this route: 32 languages, first audio in well under a second. */
const ttsModel = "eleven_flash_v2_5";
/**
 * "Talia - Warm Soft Guide", which ElevenLabs suggests in place of "Sarah": its
 * former default voices stop working on 31 December 2026. It comes from the
 * Voice Library, so its first use adds it to the account, which takes a few
 * seconds once. `VoiceConfig.voice` replaces it.
 */
const defaultVoice = "OZ0L6eISlOejga3XjDFt";
/** MP3 plays as it downloads on iOS, Android and in every browser, and every plan may use this bitrate. */
const outputFormat = "mp3_44100_128";
const ttsMime = "audio/mpeg";

export const elevenlabs: Provider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  needsKey: true,
  needsUrl: false,
  create(config) {
    const key = config.apiKey?.trim();
    if (!key) return null;
    const headers = { "xi-api-key": key };
    /** A voice of the account that worked after the default one was refused. */
    let fallback: string | undefined;
    return {
      capabilities: () => ({ provider: "elevenlabs", stt: "server", tts: "server", ttsMime }),

      async transcribe(audio, opts) {
        const form = new FormData();
        form.append("model_id", config.sttModel?.trim() || sttModel);
        appendAudio(form, audio, opts.mime);
        // The agent wants the words only, not "(laughter)".
        form.append("tag_audio_events", "false");
        const language = languageCode(opts.language || config.language);
        if (language) form.append("language_code", language);
        return transcript({ name, url: `${api}/v1/speech-to-text`, headers, signal: opts.signal }, form);
      },

      async speak(text, opts = {}) {
        const body = {
          text,
          model_id: config.ttsModel?.trim() || ttsModel,
          language_code: languageCode(opts.language || config.language),
        };
        const say = (voice: string) => {
          const url = `${api}/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=${outputFormat}`;
          return speech({ name, url, headers, signal: opts.signal }, body, ttsMime);
        };
        const chosen = config.voice?.trim() || fallback;
        if (chosen) return say(chosen);
        try {
          return await say(defaultVoice);
        } catch (refusal) {
          // Not every account may use a Voice Library voice: try once with a voice it already has.
          if (!(refusal instanceof VoiceError) || !["rejected", "quota"].includes(refusal.code)) throw refusal;
          const own = await ownVoice(headers, opts.signal).catch(() => undefined);
          opts.signal?.throwIfAborted();
          if (!own) throw refusal;
          const audio = await say(own);
          // Remembered only now that it has worked: an empty balance must not change the voice.
          fallback = own;
          return audio;
        }
      },
    };
  },
};

/**
 * A voice the account already has. Its own voices and the classic defaults come
 * before its Voice Library copies, which ElevenLabs documents as unavailable
 * through the API on the free plan.
 */
async function ownVoice(headers: Record<string, string>, signal?: AbortSignal): Promise<string | undefined> {
  const res = await fetch(`${api}/v2/voices?page_size=100`, { headers, signal });
  const { voices = [] } = (await res.json()) as { voices?: { voice_id: string; sharing?: { status?: string } | null }[] };
  const others = voices.filter((voice) => voice.voice_id !== defaultVoice);
  return (others.find((voice) => voice.sharing?.status !== "copied") ?? others[0])?.voice_id;
}
