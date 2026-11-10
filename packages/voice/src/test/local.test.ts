import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVoice, VoiceError } from "../index.js";
import {
  audioInTwoParts,
  deadAddress,
  type FakeServer,
  fakeServer,
  firstPart,
  formOf,
  json,
  readAll,
  secondPart,
  silence,
} from "./fake-server.js";

const utterance = new Uint8Array([1, 2, 3, 4]);

let server: FakeServer;

beforeEach(async () => {
  server = await fakeServer();
});

afterEach(async () => {
  await server.close();
});

const voice = (config = {}) => createVoice({ provider: "local", url: server.url, ...config });

describe("transcribe", () => {
  it("uploads the utterance the OpenAI way and returns the text", async () => {
    server.answer(json(200, { text: " Bonjour, ça va ? " }));

    const text = await voice({ language: "fr-FR" }).transcribe(utterance, { mime: "audio/x-wav" });

    expect(text).toBe("Bonjour, ça va ?");
    const [request] = server.requests;
    expect(request).toMatchObject({ method: "POST", path: "/v1/audio/transcriptions" });
    expect(request?.headers).not.toHaveProperty("authorization");
    expect(request?.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const form = await formOf(request!);
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("fr");
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file") as File;
    expect(file.name).toBe("speech.wav");
    expect(file.type).toBe("audio/x-wav");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(utterance);
  });

  it("sends the key and the model when they are set, and the language of the call", async () => {
    server.answer(json(200, { text: "Hello" }));
    const model = "mlx-community/whisper-large-v3-turbo-asr-fp16";

    await voice({ apiKey: "secret-key", sttModel: model, language: "fr" }).transcribe(utterance, {
      mime: "audio/mp4",
      language: "en",
    });

    const [request] = server.requests;
    expect(request?.headers.authorization).toBe("Bearer secret-key");
    const form = await formOf(request!);
    expect(form.get("model")).toBe(model);
    expect(form.get("language")).toBe("en");
    expect((form.get("file") as File).name).toBe("speech.m4a");
  });

  it("leaves the language to the server when none is known", async () => {
    server.answer(json(200, { text: "Hello" }));

    await voice().transcribe(utterance, { mime: "audio/wav" });

    expect((await formOf(server.requests[0]!)).has("language")).toBe(false);
  });

  it("hangs up on the server when the call is cancelled", async () => {
    const quiet = silence();
    server.answer(quiet.handler);
    const controller = new AbortController();

    const pending = voice().transcribe(utterance, { mime: "audio/wav", signal: controller.signal });
    await quiet.arrived;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await quiet.closed;
  });

  it("says so when the answer is not the JSON it asked for", async () => {
    server.answer((_req, res) => void res.writeHead(200).end("<html>Welcome</html>"));

    const failure = voice().transcribe(utterance, { mime: "audio/wav" });

    await expect(failure).rejects.toMatchObject({ name: "VoiceError", code: "failed" });
  });
});

describe("speak", () => {
  it("asks for MP3 the OpenAI way and leaves the voice to the server", async () => {
    const audio = audioInTwoParts();
    server.answer(audio.handler);
    audio.release();

    const speech = await voice({ language: "fr" }).speak("Bonjour !");

    expect(speech.mime).toBe("audio/mpeg");
    expect(await readAll(speech.stream.getReader())).toEqual(Buffer.concat([firstPart, secondPart]));
    const [request] = server.requests;
    expect(request).toMatchObject({ method: "POST", path: "/v1/audio/speech" });
    expect(request?.headers).not.toHaveProperty("authorization");
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(request!.body.toString())).toEqual({
      model: "tts-1",
      input: "Bonjour !",
      response_format: "mp3",
    });
  });

  it("sends the key, the model and the voice when they are set", async () => {
    const audio = audioInTwoParts();
    server.answer(audio.handler);
    audio.release();

    await voice({ apiKey: "secret-key", ttsModel: "mlx-community/Kokoro-82M-bf16", voice: "ff_siwis" }).speak("Bonjour");

    const [request] = server.requests;
    expect(request?.headers.authorization).toBe("Bearer secret-key");
    expect(JSON.parse(request!.body.toString())).toEqual({
      model: "mlx-community/Kokoro-82M-bf16",
      input: "Bonjour",
      voice: "ff_siwis",
      response_format: "mp3",
    });
  });

  it.each([
    ["audio/mp3", "audio/mpeg"],
    ["audio/wav", "audio/wav"],
    ["application/octet-stream", "audio/mpeg"],
  ])("labels audio the server calls %s as %s", async (contentType, mime) => {
    const audio = audioInTwoParts(contentType);
    server.answer(audio.handler);
    audio.release();

    const speech = await voice().speak("Bonjour");

    expect(speech.mime).toBe(mime);
    await speech.stream.cancel();
  });

  it("returns as soon as the server starts answering and passes the audio through as it comes", async () => {
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

  it("hangs up on the server when the signal fires in the middle of the audio", async () => {
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
});

describe("the address", () => {
  it.each([
    ["a trailing slash", (url: string) => `${url}/`],
    ["the /v1 an OpenAI client would want", (url: string) => `${url}/v1/`],
    ["no scheme", (url: string) => url.replace("http://", "")],
  ])("is understood with %s", async (_case, typed) => {
    server.answer(json(200, { text: "Hello" }));

    await voice({ url: typed(server.url) }).transcribe(utterance, { mime: "audio/wav" });

    expect(server.requests[0]?.path).toBe("/v1/audio/transcriptions");
  });
});

describe("failures", () => {
  it("names the address when the server is not running", async () => {
    const url = await deadAddress();
    const unreachable = {
      name: "VoiceError",
      code: "unreachable",
      message: `The speech server at ${url} cannot be reached.`,
    };

    await expect(voice({ url }).speak("Bonjour")).rejects.toMatchObject(unreachable);
    await expect(voice({ url }).transcribe(utterance, { mime: "audio/wav" })).rejects.toMatchObject(unreachable);
  });

  it.each([
    {
      status: 401,
      body: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } },
      code: "bad_key",
      ending: "refused the API key: Incorrect API key provided",
    },
    {
      status: 429,
      body: { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: null } },
      code: "quota",
      ending: "says the account needs credits or a paid plan: You exceeded your current quota",
    },
    {
      status: 429,
      body: { error: { message: "Slow down", type: "requests", code: "rate_limit_exceeded" } },
      code: "rate_limited",
      ending: "is busy. Try again in a moment.",
    },
    {
      // FastAPI servers such as mlx-audio answer `{ "detail": "…" }`.
      status: 404,
      body: { detail: "Model 'tts-1' not found" },
      code: "rejected",
      ending: "refused the request: Model 'tts-1' not found",
    },
    { status: 400, body: "Bad Request", code: "rejected", ending: "refused the request (400)." },
    { status: 500, body: "Internal Server Error", code: "failed", ending: "is having trouble (500)." },
    {
      status: 500,
      body: { detail: "The model could not be loaded" },
      code: "failed",
      ending: "is having trouble (500): The model could not be loaded",
    },
  ])("turns a $status answer into a readable $code error", async ({ status, body, code, ending }) => {
    const answer = typeof body === "string" ? body : JSON.stringify(body);
    server.answer((_req, res) => void res.writeHead(status).end(answer));
    const message = `The speech server at ${server.url} ${ending}`;

    const spoken = await voice().speak("Bonjour").catch((error: unknown) => error);
    const heard = await voice().transcribe(utterance, { mime: "audio/wav" }).catch((error: unknown) => error);

    for (const error of [spoken, heard]) {
      expect(error).toBeInstanceOf(VoiceError);
      expect(error).toMatchObject({ code, message, status });
    }
  });
});
