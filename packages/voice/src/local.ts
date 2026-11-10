/**
 * Any OpenAI-compatible speech server on the user's machine or network, for
 * example mlx-audio (Kokoro, Parakeet, Whisper on Apple Silicon) or
 * Kokoro-FastAPI: `POST /v1/audio/transcriptions` and `POST /v1/audio/speech`.
 *
 * Only the fields of the OpenAI audio API are sent, so that every such server
 * accepts the request. That API has no language field for speech: there the
 * language follows the model and voice chosen.
 */
import { appendAudio, baseUrl, languageCode, speech, transcript } from "./http.js";
import type { Provider } from "./provider.js";

/** The names OpenAI-compatible servers conventionally answer to. mlx-audio wants a model id instead. */
const sttModel = "whisper-1";
const ttsModel = "tts-1";
const ttsMime = "audio/mpeg";

export const local: Provider = {
  id: "local",
  label: "Your own speech server",
  needsKey: false,
  needsUrl: true,
  create(config) {
    const base = baseUrl(config.url);
    if (!base) return null;
    const name = `The speech server at ${base}`;
    const key = config.apiKey?.trim();
    const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
    return {
      capabilities: () => ({ provider: "local", stt: "server", tts: "server", ttsMime }),

      async transcribe(audio, opts) {
        const form = new FormData();
        appendAudio(form, audio, opts.mime);
        form.append("model", config.sttModel?.trim() || sttModel);
        // Asked for explicitly: mlx-audio answers with a stream of JSON lines otherwise.
        form.append("response_format", "json");
        const language = languageCode(opts.language || config.language);
        if (language) form.append("language", language);
        return transcript({ name, url: `${base}/v1/audio/transcriptions`, headers, signal: opts.signal }, form);
      },

      async speak(text, opts = {}) {
        const body = {
          model: config.ttsModel?.trim() || ttsModel,
          input: text,
          // Left out when not chosen, so the server uses its own default voice.
          voice: config.voice?.trim() || undefined,
          response_format: "mp3",
        };
        return speech({ name, url: `${base}/v1/audio/speech`, headers, signal: opts.signal }, body, ttsMime);
      },
    };
  },
};
