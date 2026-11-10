/**
 * The data directory and what is configured in it: who the agent is, how
 * much it may do alone, which engine and voice it uses, and the secrets.
 * Everything has a default; environment variables win over `config.json`.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { Autonomy, DEFAULT_PORT } from "@agentos/protocol";
import { z } from "zod";
import { newId, newSecret } from "./ids.js";
import { readJson, writeJson } from "./store/disk.js";

const VoiceShape = z.object({
  /** Provider id: `device`, `elevenlabs`, `local`… */
  provider: z.string().min(1),
  /** Provider-specific voice name, or null for its default. */
  voice: z.string().nullable(),
  /** Address of the owner's own speech server, for providers that need one. */
  url: z.string().nullable(),
  /** Speech-to-text model, or null for the provider's default. */
  sttModel: z.string().nullable(),
  /** Text-to-speech model, or null for the provider's default. */
  ttsModel: z.string().nullable(),
});
export type VoiceSettings = z.infer<typeof VoiceShape>;

const PushShape = z.object({
  /** Id of the APNs signing key (10 characters, from the Apple developer account). */
  keyId: z.string().nullable(),
  /** Apple developer team the key belongs to. */
  teamId: z.string().nullable(),
  /** Bundle id of the app the notifications are for. */
  topic: z.string().nullable(),
});

/** What it takes to send notifications through Apple: the signing key and whose it is. */
export interface ApnsSettings {
  /** The `.p8` signing key, as PEM text. */
  key: string;
  keyId: string;
  teamId: string;
  topic: string;
}

const ConfigShape = z.object({
  /** Human name of this computer. */
  name: z.string().min(1),
  agentName: z.string().min(1),
  ownerName: z.string(),
  /** Language the agent speaks, BCP-47. */
  language: z.string().min(2),
  autonomy: Autonomy,
  onboarded: z.boolean(),
  port: z.number().int().min(1).max(65535),
  /** Address to listen on, or null for every interface (so that a phone can connect). */
  host: z.string().min(1).nullable(),
  /** Engine id: `claude` or `mock`. */
  engine: z.string().min(1),
  /** Model id, or null for the engine's default. */
  model: z.string().nullable(),
  voice: VoiceShape,
  /** Notifications to the owner's phone, for people who build the app themselves. Off until a key is given. */
  push: PushShape,
  /** Folder the agent works in, or null for the owner's home directory. */
  workspace: z.string().nullable(),
  /**
   * Run the agent's shell commands in the engine's sandbox: they can then
   * neither read this data directory nor reach this computer's own ports —
   * and also cannot write outside the folder they work in, use local
   * services, or the ssh agent. Off unless the owner chooses that trade.
   */
  sandbox: z.boolean(),
  /**
   * Let a project folder's own engine settings apply (hooks, servers, rules
   * in its `.claude/` folder). Off: a folder the agent is sent to work in is
   * something to read, not something that configures the agent.
   */
  projectSettings: z.boolean(),
  relayUrl: z.string().nullable(),
});
export type Config = z.infer<typeof ConfigShape>;

/** Some of the configuration: what a change, the file or the environment says. */
export type ConfigPatch = Partial<Omit<Config, "voice" | "push">> & {
  voice?: Partial<VoiceSettings>;
  push?: Partial<z.infer<typeof PushShape>>;
};

interface Secrets {
  anthropicApiKey?: string;
  /** Workspace to name with a key that is not tied to one (`sk-ant-usr-…`). */
  anthropicWorkspaceId?: string;
  /** Voice provider id → key. */
  voiceKeys?: Record<string, string>;
  /** What this computer proves itself to a relay with. Made once, on first use. */
  tunnelSecret?: string;
  /** Token of a private relay. */
  relayToken?: string;
  /** The APNs signing key (`.p8`), as PEM text. */
  apnsKey?: string;
}

type Env = Record<string, string | undefined>;

/** A local token shorter than this was not drawn at random by a program. */
const MIN_TOKEN_LENGTH = 32;

/** The environment variable a voice provider's key is read from. */
export function voiceKeyVariable(provider: string): string {
  return `${provider.toUpperCase()}_API_KEY`;
}

/** `~/.agentos`, unless `AGENTOS_HOME` says otherwise. */
export function defaultHome(env: Env = process.env): string {
  return env.AGENTOS_HOME || join(homedir(), ".agentos");
}

/** The data directory, opened: identity, configuration and secrets. */
export class Home {
  /** This computer's id, stable for the life of the data directory. */
  readonly nodeId: string;
  private token: string | null;
  private file: Config;
  private secrets: Secrets;

  constructor(
    readonly dir: string = defaultHome(),
    private readonly env: Env = process.env,
  ) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Whatever is here is the owner's alone — also what an older version, or a careless copy, left more open.
    keepPrivate(dir);
    this.file = merge(defaults(), readPatch(readJson(join(dir, "config.json"))));
    this.secrets = readJson<Secrets>(join(dir, "secrets.json")) ?? {};
    this.nodeId = loadNodeId(join(dir, "node.json"));
    this.token = readText(this.tokenPath).trim() || null;
  }

  /**
   * The local token: what proves a caller is an app on this computer. Null
   * when this process has none — the core then runs inside an app that keeps
   * the token to itself, and nothing on disk can speak for the computer.
   */
  get localToken(): string | null {
    return this.token;
  }

  /** Makes a new local token and keeps it in a file only the owner can read. For a core started by hand. */
  renewLocalToken(): string {
    const token = newSecret();
    writeFileSync(this.tokenPath, `${token}\n`, { mode: 0o600 });
    chmodSync(this.tokenPath, 0o600);
    return (this.token = token);
  }

  /** Uses a token the app that started the core made, and leaves none on disk. */
  adoptLocalToken(token: string): string {
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`The app that starts AgentOS must give it a local token: at least ${MIN_TOKEN_LENGTH} random characters.`);
    }
    this.forgetLocalToken();
    return (this.token = token);
  }

  /** The core has stopped: its token opens nothing any more, and is not left lying around. */
  forgetLocalToken(): void {
    rmSync(this.tokenPath, { force: true });
    this.token = null;
  }

  private get tokenPath(): string {
    return join(this.dir, "local-token");
  }

  /** The configuration in effect: `config.json`, overridden by the environment. */
  get config(): Config {
    return merge(this.file, readPatch(fromEnv(this.env)));
  }

  /** Changes and saves configuration. Environment overrides are never written to disk. */
  update(patch: ConfigPatch): void {
    this.file = merge(this.file, patch);
    writeJson(join(this.dir, "config.json"), this.file);
  }

  /** The Anthropic API key, from `ANTHROPIC_API_KEY` or the secrets file. */
  get anthropicApiKey(): string | null {
    return this.env.ANTHROPIC_API_KEY || this.secrets.anthropicApiKey || null;
  }

  /** Stores the Anthropic API key; an empty string removes it. */
  setAnthropicApiKey(key: string): void {
    this.secrets.anthropicApiKey = key || undefined;
    this.saveSecrets();
  }

  /** The workspace that goes with the API key, from `ANTHROPIC_WORKSPACE_ID` or the secrets file. */
  get anthropicWorkspaceId(): string | null {
    return this.env.ANTHROPIC_WORKSPACE_ID || this.secrets.anthropicWorkspaceId || null;
  }

  /** Stores the workspace that goes with the API key; an empty string removes it. */
  setAnthropicWorkspaceId(id: string): void {
    this.secrets.anthropicWorkspaceId = id || undefined;
    this.saveSecrets();
  }

  /** The key of a voice provider, from `<PROVIDER>_API_KEY` or the secrets file. */
  voiceKey(provider: string): string | null {
    return this.env[voiceKeyVariable(provider)] || this.secrets.voiceKeys?.[provider] || null;
  }

  /** Stores the key of a voice provider; an empty string removes it. */
  setVoiceKey(provider: string, key: string): void {
    const { [provider]: _removed, ...others } = this.secrets.voiceKeys ?? {};
    this.secrets.voiceKeys = key ? { ...others, [provider]: key } : others;
    this.saveSecrets();
  }

  /** The secret this computer proves itself to a relay with: whoever holds it is this computer there. */
  get tunnelSecret(): string {
    if (!this.secrets.tunnelSecret) {
      this.secrets.tunnelSecret = newSecret();
      this.saveSecrets();
    }
    return this.secrets.tunnelSecret;
  }

  /** The token of a private relay, from `AGENTOS_RELAY_TOKEN` or the secrets file. */
  get relayToken(): string | null {
    return this.env.AGENTOS_RELAY_TOKEN || this.secrets.relayToken || null;
  }

  /** Stores the token of a private relay; an empty string removes it. */
  setRelayToken(token: string): void {
    this.secrets.relayToken = token || undefined;
    this.saveSecrets();
  }

  /**
   * What is needed to notify the owner's phone through Apple, or null when
   * any of it is missing: the feature is then simply off. `AGENTOS_APNS_KEY`
   * is the key itself or the path of its `.p8` file.
   */
  get apns(): ApnsSettings | null {
    const { keyId, teamId, topic } = this.config.push;
    const given = this.env.AGENTOS_APNS_KEY || this.secrets.apnsKey || "";
    const key = given.includes("BEGIN") ? given : readText(given);
    return key && keyId && teamId && topic ? { key, keyId, teamId, topic } : null;
  }

  private saveSecrets(): void {
    writeJson(join(this.dir, "secrets.json"), this.secrets);
  }
}

function defaults(): Config {
  return {
    name: computerName(),
    agentName: "Nova",
    ownerName: "",
    language: systemLanguage(),
    autonomy: "balanced",
    onboarded: false,
    port: DEFAULT_PORT,
    host: null,
    engine: "claude",
    model: null,
    voice: { provider: "device", voice: null, url: null, sttModel: null, ttsModel: null },
    push: { keyId: null, teamId: null, topic: null },
    workspace: null,
    sandbox: false,
    projectSettings: false,
    relayUrl: null,
  };
}

function fromEnv(env: Env): Record<string, unknown> {
  return {
    port: env.AGENTOS_PORT ? Number(env.AGENTOS_PORT) : undefined,
    host: env.AGENTOS_HOST || undefined,
    sandbox: flagOf(env.AGENTOS_SANDBOX),
    projectSettings: flagOf(env.AGENTOS_PROJECT_SETTINGS),
    engine: env.AGENTOS_ENGINE || undefined,
    model: env.AGENTOS_MODEL || undefined,
    relayUrl: env.AGENTOS_RELAY_URL || undefined,
    voice: { provider: env.AGENTOS_VOICE || undefined, url: env.AGENTOS_VOICE_URL || undefined },
    push: {
      keyId: env.AGENTOS_APNS_KEY_ID || undefined,
      teamId: env.AGENTOS_APNS_TEAM_ID || undefined,
      topic: env.AGENTOS_APNS_TOPIC || undefined,
    },
  };
}

/** "1" and "0" as yes and no; anything else says nothing. */
function flagOf(value: string | undefined): boolean | undefined {
  return value === "1" ? true : value === "0" ? false : undefined;
}

function merge(base: Config, patch: ConfigPatch): Config {
  return { ...base, ...patch, voice: { ...base.voice, ...patch.voice }, push: { ...base.push, ...patch.push } };
}

/** Reads configuration from the file or the environment, keeping what is valid in it. */
function readPatch(raw: unknown): ConfigPatch {
  const { voice: _voice, push: _push, ...fields } = ConfigShape.shape;
  const groups = raw as { voice?: unknown; push?: unknown } | null;
  return {
    ...validFields(fields, raw),
    voice: validFields(VoiceShape.shape, groups?.voice),
    push: validFields(PushShape.shape, groups?.push),
  };
}

/** Keeps the fields that are present and valid, so one bad value never loses the others. */
function validFields<Shape extends z.ZodRawShape>(shape: Shape, raw: unknown): Partial<z.infer<z.ZodObject<Shape>>> {
  const valid: Record<string, unknown> = {};
  if (typeof raw !== "object" || raw === null) return {};
  for (const [key, schema] of Object.entries(shape)) {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined && (schema as z.ZodType).safeParse(value).success) valid[key] = value;
  }
  return valid as Partial<z.infer<z.ZodObject<Shape>>>;
}

/** "Maries MacBook Air" rather than "Maries-MacBook-Air.local". */
function computerName(): string {
  const short = hostname().split(".")[0] ?? "";
  return short.replace(/[-_]+/g, " ").trim() || "Computer";
}

/** The language of this computer's user: French for French speakers, English for everyone else. */
export function systemLanguage(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The text of a file, or "" when there is no such file. */
function readText(path: string): string {
  try {
    return path ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

function loadNodeId(path: string): string {
  const stored = readJson<{ id?: unknown }>(path)?.id;
  if (typeof stored === "string" && stored) return stored;
  const id = newId("node");
  writeJson(path, { id });
  return id;
}

/** Takes away everyone else's access to a folder and all that is in it. The owner's own rights are left as they are. */
function keepPrivate(path: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) return;
  if ((entry.mode & 0o077) !== 0) chmodSync(path, entry.mode & 0o700);
  if (!entry.isDirectory()) return;
  for (const name of readdirSync(path)) keepPrivate(join(path, name));
}
