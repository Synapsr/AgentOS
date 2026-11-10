/**
 * The HTTP API: every route of `@agentos/protocol`, and the web app on every
 * other path. See packages/protocol/src/api.ts for the contract.
 */
import type { HttpBindings } from "@hono/node-server";
import {
  type DevicesResponse,
  type Empty,
  HelloResponse,
  ModeRequest,
  NodePatch,
  type NodeResponse,
  PROTOCOL_VERSION,
  PairRequest,
  type PairResponse,
  type PairingCode,
  PushRegistration,
  ResolveRequest,
  SendMessageRequest,
  SettingsPatch,
  SpeakRequest,
  encodePairingLink,
  routes,
} from "@agentos/protocol";
import { VoiceError, VoiceUnavailable } from "@agentos/voice";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import type { Core } from "../core.js";
import { Failure, httpStatus } from "../errors.js";
import { translator } from "../i18n.js";
import { errorLine } from "../log.js";
import { isLoopback } from "../net.js";
import { changeSettings, reachableAt, readSettings } from "../settings.js";
import { type Caller, type Reach, bearerToken, identify, isTrustedHost, proveToLocalClient } from "./auth.js";
import type { EventStream } from "./events.js";
import { PairingCodes, RateLimiter } from "./pairing.js";
import { placeholderPage, serveUi, uiDirectory } from "./ui.js";

/**
 * Where a request came from: our own HTTP server (`incoming`), or the relay
 * (`tunnel`, with the client's address as the relay saw it).
 */
export type Origin = Partial<HttpBindings> & { tunnel?: { client: string } };
type Env = { Bindings: Origin; Variables: { caller: Caller } };

const JSON_LIMIT = 1024 * 1024;
/** One utterance of speech, generously. */
const AUDIO_LIMIT = 25 * 1024 * 1024;
const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
/** Pairing attempts allowed per address and per minute. Codes cannot be guessed; this keeps it from being tried. */
const PAIR_ATTEMPTS_PER_MINUTE = 10;

/** The body of routes that have nothing to say. */
const EMPTY: Empty = {};

export function createApp(core: Core, events: EventStream): Hono<Env> {
  const { node, home, store, computer } = core;
  const app = new Hono<Env>();
  const pairingCodes = new PairingCodes();
  const pairingAttempts = new RateLimiter(PAIR_ATTEMPTS_PER_MINUTE, 60_000);
  const uiDir = uiDirectory();

  const nodeResponse = (c: Context<Env>): NodeResponse => ({
    node: node.info(),
    status: node.status(),
    local: c.var.caller.kind === "local",
  });
  const devicesResponse = (): DevicesResponse => ({ devices: store.devices.list() });
  const reachOf = (c: Context<Env>): Reach => {
    if (c.env.tunnel) return "relay";
    return isLoopback(c.env.incoming?.socket.remoteAddress) ? "here" : "network";
  };

  /** Routes marked *local* in the protocol: only apps on this computer may call them. */
  const localOnly: MiddlewareHandler<Env> = async (c, next) => {
    if (c.var.caller.kind !== "local") throw new Failure("forbidden", "Only this computer can do that.");
    await next();
  };

  app.onError((error, c) => {
    if (error instanceof Failure) return c.json({ error: { code: error.code, message: error.message } }, httpStatus[error.code]);
    // The route as written in the code — no ids, no query — and the error, not what it was working on.
    core.log(`Error on ${c.req.method} ${c.req.routePath}: ${errorLine(error)}`);
    return c.json({ error: { code: "internal", message: "Something went wrong on the computer." } }, 500);
  });

  app.use(async (c, next) => {
    if (!c.env.tunnel && !isTrustedHost(c.req.header("host"))) {
      throw new Failure("forbidden", "This address is not one this computer answers to.");
    }
    await next();
  });

  // What every answer says to a browser: take it for what it claims to be, tell nobody where you came from
  // (an address may carry a token), and — unless it is the app's own page — load nothing and sit in no frame.
  // What the API says, a screenshot included, is the owner's: nothing keeps a copy of it on disk.
  app.use(async (c, next) => {
    await next();
    const { headers } = c.res;
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (c.req.path.startsWith("/v1/")) headers.set("Cache-Control", "no-store");
  });

  const tooLarge = (): never => {
    throw new Failure("invalid", "That is too much data.");
  };
  const jsonLimit = bodyLimit({ maxSize: JSON_LIMIT, onError: tooLarge });
  const audioLimit = bodyLimit({ maxSize: AUDIO_LIMIT, onError: tooLarge });
  app.use("/v1/*", (c, next) => (c.req.path === routes.voiceTranscribe ? audioLimit : jsonLimit)(c, next));

  // ───────────────────────────── Before pairing ─────────────────────────────

  app.get(routes.hello, (c) => {
    const config = home.config;
    const hello: HelloResponse = {
      app: "agentos",
      version: core.version,
      protocol: PROTOCOL_VERSION,
      node: { id: home.nodeId, name: config.name, agentName: config.agentName },
      onboarded: config.onboarded,
      proof: reachOf(c) === "here" ? proveToLocalClient(core, c.req.query("challenge")) : null,
    };
    return c.json(hello);
  });

  app.post(routes.pair, async (c) => {
    // Through the relay, the address is the one the relay saw: a client cannot choose it.
    const from = c.env.tunnel ? `relay ${c.env.tunnel.client}` : (c.env.incoming?.socket.remoteAddress ?? "");
    if (!pairingAttempts.allow(from)) {
      throw new Failure("rate_limited", "Too many attempts. Wait a minute and try again.");
    }
    const { code, device } = await read(c, PairRequest);
    if (!pairingCodes.redeem(code)) throw new Failure("unauthorized", "This code is not valid any more. Show a new one.");
    const paired = store.devices.create(device.name, device.platform);
    core.log(`A device was added: ${device.platform} (${paired.device.id})${c.env.tunnel ? ", through the relay" : ""}`);
    const response: PairResponse = { token: paired.token, device: paired.device, node: node.info() };
    return c.json(response);
  });

  // ───────────────────────────── Everything else needs a token ─────────────────────────────

  app.use("/v1/*", async (c, next) => {
    const caller = identify(core, bearerToken(c.req.header("authorization")), reachOf(c));
    if (!caller) throw new Failure("unauthorized", "A valid token is required.");
    if (caller.kind === "device") store.devices.touch(caller.device.id);
    c.set("caller", caller);
    await next();
  });

  app.get(routes.node, (c) => c.json(nodeResponse(c)));

  app.patch(routes.node, localOnly, async (c) => {
    const before = home.config.autonomy;
    node.update(await read(c, NodePatch));
    const now = home.config.autonomy;
    if (now !== before) core.log(`Autonomy changed from ${before} to ${now}, by ${who(c.var.caller)}`);
    return c.json(nodeResponse(c));
  });

  app.post(routes.mode, async (c) => {
    node.setMode((await read(c, ModeRequest)).mode);
    return c.json(nodeResponse(c));
  });

  app.get(routes.settings, localOnly, async (c) => c.json(await readSettings(core)));

  app.patch(routes.settings, localOnly, async (c) => c.json(await changeSettings(core, await read(c, SettingsPatch))));

  app.post(routes.pairingCodes, localOnly, async (c) => {
    const { code, expiresAt } = pairingCodes.create();
    const link = encodePairingLink({
      code,
      nodeId: home.nodeId,
      name: home.config.name,
      urls: await reachableAt(core),
      fingerprint: core.tls.fingerprint,
    });
    core.log(`A pairing code was made, by ${who(c.var.caller)}`);
    const pairing: PairingCode = { code, expiresAt, link };
    return c.json(pairing);
  });

  app.get(routes.devices, (c) => c.json(devicesResponse()));

  app.put(routes.push, async (c) => {
    const caller = c.var.caller;
    if (caller.kind !== "device") throw new Failure("forbidden", "Only a paired device can register for notifications.");
    store.devices.setPush(caller.device.id, await read(c, PushRegistration));
    return c.json(EMPTY);
  });

  // Before `/:id`, which would otherwise take "me" for a device's id.
  app.delete(`${routes.devices}/me`, (c) => {
    const caller = c.var.caller;
    if (caller.kind !== "device") throw new Failure("invalid", "Only a paired device can remove its own pairing.");
    // Gone with it: its token, where its notifications went, and the streams it has open.
    store.devices.remove(caller.device.id);
    events.disconnect(caller.device.id);
    core.log(`A device removed itself (${caller.device.id})`);
    return c.json(EMPTY);
  });

  app.delete(`${routes.devices}/:id`, localOnly, (c) => {
    if (!store.devices.remove(idOf(c))) throw new Failure("not_found", "There is no such device.");
    // Its token is dead; so are the streams it opened with it.
    events.disconnect(idOf(c));
    core.log(`A device was removed (${idOf(c)})`);
    return c.json(devicesResponse());
  });

  app.get(routes.threads, (c) => c.json({ threads: node.threads() }));

  app.get(routes.threadItems(":id"), (c) => {
    const limit = Number(c.req.query("limit") ?? PAGE_SIZE);
    if (!Number.isInteger(limit) || limit < 1) throw new Failure("invalid", "`limit` must be a positive whole number.");
    const page = { before: c.req.query("before") ?? null, limit: Math.min(limit, MAX_PAGE_SIZE) };
    return c.json(node.timeline(idOf(c), page));
  });

  app.post(routes.threadMessages(":id"), async (c) => {
    const { text, via, requestId } = await read(c, SendMessageRequest);
    return c.json(node.sendMessage(idOf(c), text, via, deviceId(c.var.caller), requestId));
  });

  app.post(routes.threadInterrupt(":id"), async (c) => {
    await node.interrupt(idOf(c));
    return c.json(EMPTY);
  });

  app.get(routes.requests, (c) => c.json({ requests: node.pendingRequests() }));

  app.post(routes.requestResolve(":id"), async (c) => {
    const answer = await read(c, ResolveRequest);
    return c.json({ request: node.resolveRequest(idOf(c), answer, deviceId(c.var.caller)) });
  });

  app.get(routes.file(":id"), (c) => {
    const file = store.files.read(idOf(c));
    if (!file) throw new Failure("not_found", "There is no such file.");
    return binary(file.data, file.mime);
  });

  app.get(routes.screen, async (c) => {
    const maxWidth = c.req.query("maxWidth") === undefined ? undefined : Number(c.req.query("maxWidth"));
    if (maxWidth !== undefined && !(Number.isInteger(maxWidth) && maxWidth > 0)) {
      throw new Failure("invalid", "`maxWidth` must be a positive whole number.");
    }
    if (!computer.available) throw new Failure("unavailable", "This computer cannot show its screen yet.");
    const shot = await computer.screenshot({ maxWidth, format: "jpeg" }).catch((error: Error) => {
      throw new Failure("unavailable", error.message);
    });
    return binary(shot.data, shot.mime);
  });

  app.post(routes.computerPermissions, localOnly, async (c) => {
    await computer.requestPermissions();
    return c.json(await computer.permissions());
  });

  app.post(routes.voiceTranscribe, async (c) => {
    const mime = c.req.header("content-type") ?? "";
    if (!mime.startsWith("audio/")) throw new Failure("invalid", "Send the audio as the body, with its `Content-Type: audio/*`.");
    const audio = new Uint8Array(await c.req.arrayBuffer());
    const language = c.req.query("lang") || home.config.language;
    const text = await node.voice.transcribe(audio, { mime, language, signal: c.req.raw.signal }).catch(voiceFailure);
    return c.json({ text });
  });

  app.post(routes.voiceSpeak, async (c) => {
    const { text } = await read(c, SpeakRequest);
    const speech = await node.voice.speak(text, { language: home.config.language, signal: c.req.raw.signal }).catch(voiceFailure);
    return new Response(speech.stream, { headers: { "Content-Type": speech.mime } });
  });

  app.all("/v1/*", () => {
    throw new Failure("not_found", "There is no such route.");
  });

  // ───────────────────────────── The app ─────────────────────────────

  app.get("*", (c) => {
    const config = home.config;
    return serveUi(uiDir, safeDecode(c.req.path), c.req.header("host")) ?? placeholderPage(config.agentName, translator(config.language));
  });

  return app;
}

/** Parses and validates a JSON body. */
async function read<Schema extends z.ZodType>(c: Context<Env>, schema: Schema): Promise<z.infer<Schema>> {
  const body: unknown = await c.req.json().catch(() => {
    throw new Failure("invalid", "The body must be JSON.");
  });
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new Failure("invalid", [issue?.path.join("."), issue?.message].filter(Boolean).join(": "));
}

/** The `:id` of the route being served. */
function idOf(c: Context<Env>): string {
  return c.req.param("id") ?? "";
}

function deviceId(caller: Caller): string | null {
  return caller.kind === "device" ? caller.device.id : null;
}

/** Who did it, for the journal. */
function who(caller: Caller): string {
  return deviceId(caller) ?? "this computer";
}

function binary(data: Uint8Array, mime: string): Response {
  return new Response(new Uint8Array(data), { headers: { "Content-Type": mime } });
}

/** Turns what a voice provider throws into an error a client understands. */
function voiceFailure(error: unknown): never {
  if (error instanceof VoiceUnavailable) throw new Failure("unavailable", error.message);
  if (!(error instanceof VoiceError)) throw error;
  const code = error.code === "rate_limited" ? "rate_limited" : error.code === "rejected" ? "invalid" : "unavailable";
  throw new Failure(code, error.message);
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return "/";
  }
}
