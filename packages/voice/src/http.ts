/** What the HTTP providers share: one way to call, to stream, and to explain a failure. */
import { VoiceError, type VoiceErrorCode } from "./errors.js";
import type { SpeechAudio } from "./index.js";

/** One request to a provider, minus its payload. */
export interface Call {
  /** The provider's name as it starts a sentence, e.g. "ElevenLabs". */
  name: string;
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Uploads one utterance and returns the transcript from the provider's `{ "text": … }` answer. */
export async function transcript(call: Call, form: FormData): Promise<string> {
  const res = await post(call, form);
  const body = await res.text().catch((error: unknown) => {
    throw lost(call, error);
  });
  const text = parse(body)?.text;
  if (typeof text !== "string") {
    throw new VoiceError("failed", `${call.name} sent an answer that could not be read.`);
  }
  return text.trim();
}

/** Sends text and returns the audio as it arrives: resolves on the first answer, not on the last byte. */
export async function speech(call: Call, body: object, mime: string): Promise<SpeechAudio> {
  const headers = { ...call.headers, "content-type": "application/json" };
  const res = await post({ ...call, headers }, JSON.stringify(body));
  if (!res.body) throw new VoiceError("failed", `${call.name} sent no audio.`);
  return { mime: audioMime(res.headers.get("content-type"), mime), stream: res.body };
}

/** Audio subtypes that are not already a file extension. */
const extensions: Record<string, string> = { mp4: "m4a", mpeg: "mp3", wave: "wav", "vnd.wave": "wav" };

/** Adds the utterance to a form, named so that servers which go by the file extension recognise it. */
export function appendAudio(form: FormData, audio: Uint8Array, mime: string): void {
  const subtype = mime.split(";")[0]?.split("/")[1]?.trim().toLowerCase().replace(/^x-/, "") || "bin";
  form.append("file", new Blob([audio], { type: mime }), `speech.${extensions[subtype] ?? subtype}`);
}

/** The primary language of a BCP-47 tag ("fr-FR" → "fr"), which is what the speech APIs expect. */
export function languageCode(tag: string | undefined): string | undefined {
  return tag?.trim().split(/[-_]/)[0]?.toLowerCase() || undefined;
}

/** Tidies a typed address: adds a missing scheme, drops trailing slashes and a trailing `/v1`. */
export function baseUrl(url: string | undefined): string | undefined {
  const address = url?.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  if (!address) return undefined;
  return /^https?:\/\//i.test(address) ? address : `http://${address}`;
}

async function post(call: Call, body: FormData | string): Promise<Response> {
  const { url, headers, signal } = call;
  const res = await fetch(url, { method: "POST", headers, body, signal }).catch((error: unknown) => {
    throw lost(call, error);
  });
  if (!res.ok) throw refusal(call.name, res.status, await res.text().catch(() => ""));
  return res;
}

/** A cancelled call keeps its abort reason; any other network failure means nobody answered. */
function lost(call: Call, error: unknown): unknown {
  return call.signal?.aborted ? error : new VoiceError("unreachable", `${call.name} cannot be reached.`);
}

/** Turns an error answer into a `VoiceError`, quoting the provider when it gave a reason. */
function refusal(name: string, status: number, body: string): VoiceError {
  const { codes, detail } = describe(body);
  const error = (code: VoiceErrorCode, summary: string) =>
    new VoiceError(code, `${name} ${summary}${detail ? `: ${detail}` : "."}`, status);
  // ElevenLabs has reported an empty balance as 401 and OpenAI-style servers as 429: trust the code first.
  if (status === 402 || /quota|credit|payment/.test(codes)) {
    return error("quota", "says the account needs credits or a paid plan");
  }
  if (status === 401) return error("bad_key", "refused the API key");
  if (status === 429) return new VoiceError("rate_limited", `${name} is busy. Try again in a moment.`, status);
  if (status >= 500) return error("failed", `is having trouble (${status})`);
  return error("rejected", detail ? "refused the request" : `refused the request (${status})`);
}

/** Finds the error codes and the message in the body shapes in use: ElevenLabs, OpenAI and FastAPI. */
function describe(body: string): { codes: string; detail: string } {
  const root = parse(body);
  let info: unknown = root?.detail ?? root?.error ?? root;
  if (Array.isArray(info)) info = info[0];
  if (typeof info === "string") return { codes: "", detail: info.slice(0, 200) };
  const { type, code, status, message, msg } = (info ?? {}) as Record<string, unknown>;
  const text = message ?? msg;
  return { codes: [type, code, status].join(" "), detail: typeof text === "string" ? text.slice(0, 200) : "" };
}

/** `JSON.parse` that answers null rather than throwing, and only passes objects. */
function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Trusts the provider's `Content-Type` when it names audio; `audio/mp3` is a common misnomer for `audio/mpeg`. */
function audioMime(header: string | null, fallback: string): string {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  if (!type?.startsWith("audio/")) return fallback;
  return type === "audio/mp3" ? "audio/mpeg" : type;
}
