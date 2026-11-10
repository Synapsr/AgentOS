import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoice, VoiceError } from "../index.js";
import {
  audioInTwoParts,
  deadAddress,
  type FakeServer,
  type Handler,
  fakeServer,
  firstPart,
  formOf,
  json,
  readAll,
  secondPart,
  silence,
} from "./fake-server.js";

const utterance = new Uint8Array([1, 2, 3, 4]);
const realFetch = globalThis.fetch;

let server: FakeServer;
/** Every URL the provider asked for, before it was pointed at the fake server. */
let asked: string[];

/** The provider only ever talks to ElevenLabs, so the tests move that one address. */
function sendElevenLabsTo(address: string): void {
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    asked.push(input);
    return realFetch(input.replace("https://api.elevenlabs.io", address), init);
  });
}

beforeEach(async () => {
  server = await fakeServer();
  asked = [];
  sendElevenLabsTo(server.url);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await server.close();
});

const voice = (config = {}) => createVoice({ provider: "elevenlabs", apiKey: "secret-key", ...config });

describe("transcribe", () => {
  it("uploads the utterance to Scribe and returns the text", async () => {
    server.answer(json(200, { language_code: "fra", text: " Bonjour, ça va ? ", words: [] }));

    const text = await voice({ language: "fr" }).transcribe(utterance, { mime: "audio/mp4" });

    expect(text).toBe("Bonjour, ça va ?");
    expect(asked).toEqual(["https://api.elevenlabs.io/v1/speech-to-text"]);
    const [request] = server.requests;
    expect(request).toMatchObject({ method: "POST", path: "/v1/speech-to-text" });
    expect(request?.headers["xi-api-key"]).toBe("secret-key");
    expect(request?.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const form = await formOf(request!);
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("language_code")).toBe("fr");
    expect(form.get("tag_audio_events")).toBe("false");
    const file = form.get("file") as File;
    expect(file.name).toBe("speech.m4a");
    expect(file.type).toBe("audio/mp4");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(utterance);
  });

  it("prefers the language of the call, without its region, and the configured model", async () => {
    server.answer(json(200, { text: "Hello" }));

    await voice({ language: "fr", sttModel: "scribe_v2_medical" }).transcribe(utterance, {
      mime: "audio/webm;codecs=opus",
      language: "en-GB",
    });

    const form = await formOf(server.requests[0]!);
    expect(form.get("language_code")).toBe("en");
    expect(form.get("model_id")).toBe("scribe_v2_medical");
    expect((form.get("file") as File).name).toBe("speech.webm");
  });

  it("lets ElevenLabs detect the language when none is known", async () => {
    server.answer(json(200, { text: "Hello" }));

    await voice().transcribe(utterance, { mime: "audio/wav" });

    expect((await formOf(server.requests[0]!)).has("language_code")).toBe(false);
  });

  it("keeps the configured language when the call gives an empty one", async () => {
    server.answer(json(200, { text: "Bonjour" }));

    await voice({ language: "fr" }).transcribe(utterance, { mime: "audio/wav", language: "" });

    expect((await formOf(server.requests[0]!)).get("language_code")).toBe("fr");
  });

  it("hangs up on ElevenLabs when the call is cancelled", async () => {
    const quiet = silence();
    server.answer(quiet.handler);
    const controller = new AbortController();

    const pending = voice().transcribe(utterance, { mime: "audio/wav", signal: controller.signal });
    await quiet.arrived;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await quiet.closed;
  });

  it("says so when the answer has no text", async () => {
    server.answer(json(200, { message: "queued" }));

    const failure = voice().transcribe(utterance, { mime: "audio/wav" });

    await expect(failure).rejects.toMatchObject({ name: "VoiceError", code: "failed" });
  });
});

describe("speak", () => {
  it("asks for streamed MP3 from the default voice with the low-latency model", async () => {
    const audio = audioInTwoParts();
    server.answer(audio.handler);
    audio.release();

    const speech = await voice({ language: "fr-FR" }).speak("Bonjour !");

    expect(speech.mime).toBe("audio/mpeg");
    expect(await readAll(speech.stream.getReader())).toEqual(Buffer.concat([firstPart, secondPart]));
    expect(asked).toEqual([
      "https://api.elevenlabs.io/v1/text-to-speech/OZ0L6eISlOejga3XjDFt/stream?output_format=mp3_44100_128",
    ]);
    const [request] = server.requests;
    expect(request).toMatchObject({
      method: "POST",
      path: "/v1/text-to-speech/OZ0L6eISlOejga3XjDFt/stream?output_format=mp3_44100_128",
    });
    expect(request?.headers["xi-api-key"]).toBe("secret-key");
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(request!.body.toString())).toEqual({
      text: "Bonjour !",
      model_id: "eleven_flash_v2_5",
      language_code: "fr",
    });
  });

  it("uses the configured voice and model, and the language of the call", async () => {
    const audio = audioInTwoParts();
    server.answer(audio.handler);
    audio.release();

    await voice({ voice: "my voice/1", ttsModel: "eleven_multilingual_v2", language: "fr" }).speak("Hello", {
      language: "en",
    });

    const [request] = server.requests;
    expect(request?.path).toBe("/v1/text-to-speech/my%20voice%2F1/stream?output_format=mp3_44100_128");
    expect(JSON.parse(request!.body.toString())).toEqual({
      text: "Hello",
      model_id: "eleven_multilingual_v2",
      language_code: "en",
    });
  });

  it("returns as soon as ElevenLabs starts answering and passes the audio through as it comes", async () => {
    const audio = audioInTwoParts();
    server.answer(audio.handler);

    // The second part is still held back: this would never resolve if speak() waited for all of it.
    const speech = await voice().speak("Bonjour");
    const reader = speech.stream.getReader();
    const head = await reader.read();
    expect(Buffer.from(head.value ?? [])).toEqual(firstPart);

    audio.release();
    expect(await readAll(reader)).toEqual(secondPart);
    expect(await audio.closed).toBe(true);
  });

  it("hangs up on ElevenLabs when the signal fires in the middle of the audio", async () => {
    const audio = audioInTwoParts();
    server.answer(audio.handler);
    const controller = new AbortController();

    const speech = await voice().speak("Bonjour", { signal: controller.signal });
    const reader = speech.stream.getReader();
    await reader.read();
    controller.abort();

    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
    expect(await audio.closed).toBe(false);
  });

  it("hangs up on ElevenLabs when the listener stops reading", async () => {
    const audio = audioInTwoParts();
    server.answer(audio.handler);

    const speech = await voice().speak("Bonjour");
    await speech.stream.cancel();

    expect(await audio.closed).toBe(false);
  });

  it("keeps the caller's own reason when cancelled before ElevenLabs answers", async () => {
    server.answer(silence().handler);
    const reason = new Error("the owner started talking");

    const failure = voice().speak("Bonjour", { signal: AbortSignal.abort(reason) });

    await expect(failure).rejects.toBe(reason);
    expect(server.requests).toEqual([]);
  });
});

describe("when the default voice is refused", () => {
  const defaultVoice = "OZ0L6eISlOejga3XjDFt";
  const speaking = (id: string) => `POST /v1/text-to-speech/${id}/stream?output_format=mp3_44100_128`;
  const listing = "GET /v2/voices?page_size=100";
  const calls = () => server.requests.map((request) => `${request.method} ${request.path}`);
  // What the live API answers for a voice the key cannot find (November 2026).
  const notFound = json(404, {
    detail: {
      type: "not_found",
      code: "voice_not_found",
      message: `A voice with voice_id '${defaultVoice}' was not found.`,
      status: "voice_not_found",
    },
  });

  /** An account with these voices, which answers `refusal` when asked to speak with the default one. */
  function account(voices: object[], refusal: Handler = notFound): void {
    server.answer((req, res) => {
      if (req.method === "GET") return json(200, { voices, has_more: false, total_count: voices.length })(req, res);
      if (req.path.includes(defaultVoice)) return refusal(req, res);
      res.writeHead(200, { "content-type": "audio/mpeg" }).end(firstPart);
    });
  }

  it("speaks with a voice the account has, and remembers it", async () => {
    account([
      { voice_id: defaultVoice, sharing: { status: "copied" } },
      { voice_id: "library-copy", sharing: { status: "copied" } },
      { voice_id: "own-voice", sharing: null },
    ]);
    const elevenlabs = voice();

    const speech = await elevenlabs.speak("Bonjour");

    expect(await readAll(speech.stream.getReader())).toEqual(firstPart);
    expect(calls()).toEqual([speaking(defaultVoice), listing, speaking("own-voice")]);
    expect(server.requests[1]?.headers["xi-api-key"]).toBe("secret-key");

    await (await elevenlabs.speak("Encore")).stream.cancel();
    expect(calls().slice(3)).toEqual([speaking("own-voice")]);
  });

  it("takes a Voice Library copy when the account has nothing else", async () => {
    account([{ voice_id: "library-copy", sharing: { status: "copied" } }]);

    await (await voice().speak("Bonjour")).stream.cancel();

    expect(calls()).toEqual([speaking(defaultVoice), listing, speaking("library-copy")]);
  });

  it("reports the refusal when the account has no other voice", async () => {
    account([{ voice_id: defaultVoice, sharing: { status: "copied" } }]);

    await expect(voice().speak("Bonjour")).rejects.toMatchObject({
      code: "rejected",
      status: 404,
      message: `ElevenLabs refused the request: A voice with voice_id '${defaultVoice}' was not found.`,
    });
    expect(calls()).toEqual([speaking(defaultVoice), listing]);
  });

  it("does not change voice for good when the other voice is refused too", async () => {
    // An empty balance: every voice gets the same answer.
    const noCredits = json(402, { detail: { type: "payment_required", code: "insufficient_credits" } });
    server.answer((req, res) =>
      req.method === "GET" ? json(200, { voices: [{ voice_id: "own-voice" }] })(req, res) : noCredits(req, res),
    );
    const elevenlabs = voice();

    await expect(elevenlabs.speak("Bonjour")).rejects.toMatchObject({ code: "quota" });
    await expect(elevenlabs.speak("Bonjour")).rejects.toMatchObject({ code: "quota" });

    const attempt = [speaking(defaultVoice), listing, speaking("own-voice")];
    expect(calls()).toEqual([...attempt, ...attempt]);
  });

  it("leaves a voice the owner chose alone", async () => {
    server.answer(notFound);

    await expect(voice({ voice: "chosen" }).speak("Bonjour")).rejects.toMatchObject({ code: "rejected" });

    expect(calls()).toEqual([speaking("chosen")]);
  });

  it.each([401, 429, 503])("does not look for another voice after a %i", async (status) => {
    server.answer(json(status, {}));

    await expect(voice().speak("Bonjour")).rejects.toBeInstanceOf(VoiceError);

    expect(calls()).toEqual([speaking(defaultVoice)]);
  });

  it("stops looking when the call is cancelled", async () => {
    const quiet = silence();
    server.answer((req, res) => (req.method === "GET" ? quiet.handler(req, res) : notFound(req, res)));
    const controller = new AbortController();

    const pending = voice().speak("Bonjour", { signal: controller.signal });
    await quiet.arrived;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls()).toEqual([speaking(defaultVoice), listing]);
  });
});

describe("failures", () => {
  const credits = "ElevenLabs says the account needs credits or a paid plan";

  it.each([
    {
      // What the live API answers to a wrong key (November 2026).
      status: 401,
      body: {
        detail: {
          type: "authentication_error",
          code: "unauthorized",
          message: "Invalid API key",
          status: "invalid_api_key",
        },
      },
      code: "bad_key",
      message: "ElevenLabs refused the API key: Invalid API key",
    },
    {
      // The shape ElevenLabs used before `code` existed: an empty balance came back as 401.
      status: 401,
      body: { detail: { status: "quota_exceeded", message: "You have 2 credits remaining." } },
      code: "quota",
      message: `${credits}: You have 2 credits remaining.`,
    },
    {
      status: 402,
      body: { detail: { type: "payment_required", code: "insufficient_credits" } },
      code: "quota",
      message: `${credits}.`,
    },
    {
      status: 429,
      body: { detail: { type: "rate_limit_error", code: "concurrent_limit_exceeded" } },
      code: "rate_limited",
      message: "ElevenLabs is busy. Try again in a moment.",
    },
    {
      status: 404,
      body: { detail: { type: "not_found", code: "voice_not_found", message: "The specified voice ID does not exist." } },
      code: "rejected",
      message: "ElevenLabs refused the request: The specified voice ID does not exist.",
    },
    {
      status: 422,
      body: { detail: [{ loc: ["body", "text"], msg: "Field required", type: "missing" }] },
      code: "rejected",
      message: "ElevenLabs refused the request: Field required",
    },
    {
      status: 403,
      body: "<html>blocked</html>",
      code: "rejected",
      message: "ElevenLabs refused the request (403).",
    },
    {
      status: 503,
      body: { detail: { type: "service_unavailable", code: "maintenance" } },
      code: "failed",
      message: "ElevenLabs is having trouble (503).",
    },
  ])("turns a $status answer into a readable $code error", async ({ status, body, code, message }) => {
    const answer = typeof body === "string" ? body : JSON.stringify(body);
    server.answer((_req, res) => void res.writeHead(status).end(answer));

    const spoken = await voice().speak("Bonjour").catch((error: unknown) => error);
    const heard = await voice().transcribe(utterance, { mime: "audio/wav" }).catch((error: unknown) => error);

    for (const error of [spoken, heard]) {
      expect(error).toBeInstanceOf(VoiceError);
      expect(error).toMatchObject({ code, message, status });
    }
  });

  it("says ElevenLabs cannot be reached when the network is down", async () => {
    sendElevenLabsTo(await deadAddress());

    const spoken = voice().speak("Bonjour");
    const heard = voice().transcribe(utterance, { mime: "audio/wav" });

    const unreachable = { name: "VoiceError", code: "unreachable", message: "ElevenLabs cannot be reached." };
    await expect(spoken).rejects.toMatchObject(unreachable);
    await expect(heard).rejects.toMatchObject(unreachable);
  });
});
