#!/usr/bin/env node
/**
 * The `agentos` command: `start` wakes the agent on this computer; the other
 * commands talk to it once it is awake.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ApiError,
  type DevicesResponse,
  type Event,
  HelloResponse,
  MAIN_THREAD,
  type NodeResponse,
  type PairingCode,
  type RequestItem,
  type RequestsResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  ServerFrame,
  type Settings,
  routes,
} from "@agentos/protocol";
import qrcode from "qrcode-terminal";
import { WebSocket } from "ws";
import { Home, defaultHome, systemLanguage } from "./config.js";
import { type Translate, translator } from "./i18n.js";
import { newSecret } from "./ids.js";
import { type RelayState, startCore } from "./index.js";
import { type Log, errorLine, fileLog, logPath } from "./log.js";
import { addresses, localUrl } from "./net.js";
import { localProof, sameSecret } from "./server/auth.js";
import { adoptShellEnvironment, startedWithoutShell } from "./shell-env.js";

/** What `--port` and `--host` said, if anything. */
interface Asked {
  port: number | undefined;
  host: string | undefined;
}

/** What a command that talks to the running core works with. */
interface Context {
  home: Home;
  t: Translate;
  /** Port of the core on this computer. */
  port: number;
  /** The local token, known to be going to the core and nothing else. */
  token: string;
  /** Words after the command. */
  words: string[];
}

/**
 * How this command is called here, to tell people how to call it again:
 * `agentos` once installed, `pnpm agentos` from a clone of the repository,
 * where a package script of that name runs it.
 */
const COMMAND =
  process.env.npm_package_name === "agentos" &&
  ["agentos", "start"].includes(process.env.npm_lifecycle_event ?? "")
    ? "pnpm agentos"
    : "agentos";

/** The translator for a language, with our own name filled in wherever a sentence says how to call us. */
function speaker(language: string): Translate {
  const t = translator(language);
  return (key, values) => t(key, { command: COMMAND, ...values });
}

/** How often the core checks that the app that started it is still there. */
const PARENT_CHECK_MS = 2000;
/** How long the app that starts the core has to hand it the local token. */
const TOKEN_WAIT_MS = 10_000;

const commands: Record<string, (context: Context) => Promise<number>> = { pair, status, say, url };

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const portGiven = flag(args, "--port");
  const asked: Asked = { port: portGiven === undefined ? undefined : Number(portGiven), host: flag(args, "--host") };
  const [command = "", ...words] = args;
  const run = commands[command];
  const badPort = asked.port !== undefined && !(Number.isInteger(asked.port) && asked.port >= 0 && asked.port <= 65535);
  if ((!run && command !== "start") || badPort) {
    console.log(speaker(systemLanguage())("cli.usage"));
    return command === "" ? 0 : 1;
  }
  if (!run) return start(asked);
  // Only `start` creates the data directory: asking after an agent that never ran leaves no trace.
  if (!existsSync(join(defaultHome(), "node.json"))) {
    console.error(speaker(systemLanguage())("cli.notRunning"));
    return 1;
  }
  const home = new Home();
  const t = speaker(home.config.language);
  const port = asked.port ?? home.config.port;
  try {
    return await run({ home, t, port, token: await trustedToken(home, t, port), words });
  } catch (error) {
    if (!isConnectionRefused(error)) throw error;
    console.error(t("cli.notRunning"));
    return 1;
  }
}

/** Takes `--name value` out of the arguments and returns the value. */
function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args.splice(at, 2)[1];
}

/**
 * The local token, once it is certain that the core is what answers on the
 * port: only the core can sign a number we just made up with that token.
 * Whatever else got to the port first is told nothing. Throws what to tell
 * the person when there is no token to use or nobody to trust with it.
 */
async function trustedToken(home: Home, t: Translate, port: number): Promise<string> {
  const challenge = newSecret();
  const response = await fetch(`http://127.0.0.1:${port}${routes.hello}?challenge=${challenge}`);
  const hello = HelloResponse.safeParse(await response.json().catch(() => null)).data;
  const token = home.localToken;
  // The core is there and left no token on disk: the app that started it keeps the token to itself.
  if (hello && !token) throw new Error(t("cli.insideApp"));
  if (!token || !hello?.proof || !sameSecret(hello.proof, localProof(token, challenge))) throw new Error(t("cli.stranger", { port }));
  return token;
}

async function start(asked: Asked): Promise<number> {
  const home = new Home();
  const t = speaker(home.config.language);
  // With nobody at a terminal to read it, what the core says is also kept in a file.
  const journal = process.stdout.isTTY ? null : fileLog(home.dir);
  const log: Log = (line) => {
    console.log(`  ${line}`);
    journal?.(line);
  };
  for (const kind of ["uncaughtException", "unhandledRejection"] as const) {
    process.on(kind, (error) => {
      log(`Crashed: ${errorLine(error)}`);
      process.exit(1);
    });
  }
  // Heard from now on: told to stop while still starting, the core stops cleanly as soon as it is up.
  const toldToStop = new Promise<string>((resolve) => {
    process.once("SIGINT", () => resolve("Stopped"));
    process.once("SIGTERM", () => resolve("Stopped"));
  });

  // Started by an app or a service, not from a shell: the agent's commands need the owner's PATH all the same.
  const shell = startedWithoutShell() ? await adoptShellEnvironment() : null;
  if (shell?.ok) log(`Took the PATH (${shell.pathFolders} folders) and ${shell.added} other settings from your shell (${shell.shell})`);
  else if (shell) log(`Your shell (${shell.shell}) gave ${shell.why}: commands will run with the environment the core was started with`);

  // The relay's news, as it happens: connected, or why not.
  const onRelayState = ({ url, connected, error }: RelayState): void => {
    if (!url || (!connected && !error)) return;
    const relay = hostOf(url);
    log(connected ? t("cli.relayConnected", { relay }) : t("cli.relayTrouble", { relay, reason: error ?? "" }));
  };
  // An app that starts the core hands it the local token on standard input, and keeps it to itself.
  const localToken = process.env.AGENTOS_LOCAL_TOKEN_STDIN === "1" ? await firstLine(process.stdin, TOKEN_WAIT_MS) : undefined;
  const core = await startCore({ ...asked, localToken, onRelayState, log }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") throw new Error(t("cli.portBusy", { port: asked.port ?? home.config.port }));
    throw error;
  });
  const config = home.config;
  const others = await addresses(core.port, asked.host ?? config.host);
  // The address that carries the token is for a person at a terminal: it never goes to a file or to an app's log.
  const setup = !config.onboarded && process.stdout.isTTY ? [t("cli.setup"), `${core.url}/#token=${core.localToken}`, ""] : [];
  const labels = [t("cli.here"), t("cli.elsewhere")] as const;
  const width = Math.max(...labels.map((label) => label.length)) + 2;
  const lines = [
    "",
    `● ${t("cli.awake", { agent: config.agentName, computer: config.name })}`,
    "",
    `${labels[0].padEnd(width)}${core.url}`,
    ...others.map((address, index) => `${(index === 0 ? labels[1] : "").padEnd(width)}${address}`),
    "",
    ...setup,
    t("cli.pairHint"),
    t("cli.stopHint"),
    "",
  ];
  console.log(lines.map((line) => `  ${line}`).join("\n"));

  // Awake until told to stop — or until the app that started us is gone.
  const why = await Promise.race([toldToStop, parentGone(log).then(() => "Stopped: the app that started the core is gone")]);
  await core.close();
  journal?.(why);
  console.log(`  ${t("cli.asleep", { agent: config.agentName })}`);
  return 0;
}

/** The first line of a stream; empty when none came in time. The stream is closed then: nothing more is read from it. */
function firstLine(input: NodeJS.ReadStream, withinMs: number): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    const done = (): void => {
      clearTimeout(timer);
      input.off("data", read).off("end", done).destroy();
      resolve(text.split(/\r?\n/)[0] ?? "");
    };
    const read = (chunk: Buffer): void => {
      text += chunk.toString();
      if (text.includes("\n")) done();
    };
    const timer = setTimeout(done, withinMs);
    input.on("data", read).once("end", done);
  });
}

/**
 * Resolves when the process named by `AGENTOS_PARENT_PID` no longer exists.
 * The desktop app sets it to its own process id when it starts the core, so
 * that a core never outlives an app that crashed or was killed. Without it
 * the promise never resolves: a core started by hand lives on its own.
 */
function parentGone(log: Log): Promise<void> {
  const given = process.env.AGENTOS_PARENT_PID;
  if (!given) return new Promise(() => {});
  const pid = Number(given);
  if (!Number.isInteger(pid) || pid < 1) {
    log(`AGENTOS_PARENT_PID is not a process id (${JSON.stringify(given)}); ignoring it.`);
    return new Promise(() => {});
  }
  return new Promise((resolve) => {
    const check = (): void => {
      if (isRunning(pid)) return;
      clearInterval(watch);
      resolve();
    };
    // Unreferenced: watching the parent is no reason to stay alive once told to stop.
    const watch = setInterval(check, PARENT_CHECK_MS).unref();
    check();
  });
}

/**
 * Whether a process exists. Signal 0 delivers nothing and only asks; Node
 * gives it the same meaning on Windows. "Not permitted" is still a yes.
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function pair(context: Context): Promise<number> {
  const { t } = context;
  const pairing = await call<PairingCode>(context, "POST", routes.pairingCodes);
  console.log(`\n${t("cli.pairScan")}\n`);
  qrcode.generate(pairing.link, { small: true });
  console.log(`\n${pairing.link}\n`);
  console.log(`${t("cli.pairExpires", { minutes: Math.round((pairing.expiresAt - Date.now()) / 60_000) })}\n`);
  return 0;
}

async function status(context: Context): Promise<number> {
  const { t } = context;
  const { node, status } = await call<NodeResponse>(context, "GET", routes.node);
  const { devices } = await call<DevicesResponse>(context, "GET", routes.devices);
  const agent = node.agent.name;
  console.log(t(`cli.${status.state}`, { agent }));
  if (status.activity) console.log(`· ${status.activity}`);
  console.log(t("cli.devices", { count: devices.length }));
  if (!node.capabilities.engineReady) console.log(t("cli.engineNotReady", { agent }));
  const { network } = await call<Settings>(context, "GET", routes.settings);
  if (network.relayUrl) {
    const relay = hostOf(network.relayUrl);
    if (network.relayConnected) console.log(t("cli.relayConnected", { relay }));
    else console.log(network.relayError ? t("cli.relayTrouble", { relay, reason: network.relayError }) : t("cli.relayDown", { relay }));
  }
  if (existsSync(logPath(context.home.dir))) console.log(t("cli.log", { path: logPath(context.home.dir) }));
  return 0;
}

/** Says something in the main conversation and shows what happens until the agent hands back or asks. */
async function say(context: Context): Promise<number> {
  const { home, t, port } = context;
  const text = context.words.join(" ").trim();
  if (!text) {
    console.error(t("cli.sayWhat"));
    return 1;
  }
  // When the agent is asking one thing here, what is typed is the reply to it — and says so.
  const { requests } = await call<RequestsResponse>(context, "GET", routes.requests);
  const asked = requests.filter((request) => request.threadId === MAIN_THREAD);
  const message: SendMessageRequest = { text, via: "text", requestId: asked.length === 1 ? (asked[0]?.id ?? null) : null };
  const socket = new WebSocket(`ws://127.0.0.1:${port}${routes.events}`, { headers: authorization(context) });
  return new Promise((resolve, reject) => {
    const typed = new Set<string>();
    let working = false;
    const done = (code: number): void => {
      socket.close();
      resolve(code);
    };
    const show = (event: Event): void => {
      if (event.type === "message.delta" && event.threadId === MAIN_THREAD) {
        typed.add(event.messageId);
        process.stdout.write(event.text);
      }
      if (event.type === "item.added" && event.item.threadId === MAIN_THREAD) {
        const { item } = event;
        if (item.type === "message" && item.role === "agent") console.log(typed.has(item.id) ? "" : item.text);
        if (item.type === "activity") console.log(`· ${item.label}`);
        if (item.type === "request") {
          printRequest(item, home.config.agentName, t);
          done(0);
        }
      }
      if (event.type === "thread.updated" && event.thread.id === MAIN_THREAD) {
        const { state } = event.thread;
        if (working && (state === "idle" || state === "error")) done(state === "idle" ? 0 : 1);
        working = state === "working" || state === "waiting";
      }
    };
    socket.on("error", reject);
    socket.on("message", (data) => {
      const frame = ServerFrame.parse(JSON.parse(String(data)));
      if (frame.type === "event") show(frame.event);
      if (frame.type !== "ready") return;
      call<SendMessageResponse>(context, "POST", routes.threadMessages(MAIN_THREAD), message).then((sent) => {
        if (sent.request?.state !== "pending") return;
        // Neither a yes nor a no: nothing was decided.
        console.log(t("cli.unclear", { agent: home.config.agentName }));
        done(1);
      }, reject);
    });
  });
}

async function url({ port, token }: Context): Promise<number> {
  console.log(`${localUrl(port)}/#token=${token}`);
  return 0;
}

function printRequest(request: RequestItem, agent: string, t: Translate): void {
  console.log(`\n${t("cli.asking", { agent })} ${request.title}`);
  if (request.body) console.log(request.body);
  if (request.options.length > 0) console.log(request.options.map((option) => `[${option.label}]`).join(" "));
  console.log(`${t("cli.answerHint")}\n`);
}

/** Calls the core running on this computer. */
async function call<T>(context: Context, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${context.port}${path}`, {
    method,
    headers: { ...authorization(context), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(ApiError.safeParse(result).data?.error.message ?? response.statusText);
  return result as T;
}

/** "relay.example.com" from "https://relay.example.com/". */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function authorization({ token }: Context): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function isConnectionRefused(error: unknown): boolean {
  const reason = error instanceof Error && error.cause ? error.cause : error;
  return (reason as NodeJS.ErrnoException | undefined)?.code === "ECONNREFUSED";
}
