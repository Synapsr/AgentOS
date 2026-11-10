/**
 * The safety policy: what the agent may do without asking.
 *
 * One function, driven by the tables below, turns an action the agent wants
 * to take into "allow", "ask the owner" or "refuse":
 *
 * - `supervised`  asks before anything that is not read-only.
 * - `balanced`    lets ordinary work through and asks before the actions it
 *                 recognises as risky: the shell commands listed below, any
 *                 call one of our tools itself rates as high risk, and any
 *                 tool of a server the owner connected (email, calendars,
 *                 hosting…) that is not known to only read.
 * - `autonomous`  never asks.
 *
 * In every mode, a call that reaches for AgentOS's own data, address or
 * command is refused (see off-limits.ts).
 *
 * `balanced` recognises commands by their shape. It is a list of well-known
 * dangers, not an understanding of what a command does: `rm file`, `mv`, a
 * script that deletes, an upload with `curl` all pass. The agent is
 * separately instructed to ask on its own before anything irreversible or
 * outward-facing (see prompt.ts); this is the net under it, and it has holes.
 */
import type { Autonomy, Risk, ToolCallFacts } from "@agentos/protocol";
import type { ToolCall } from "./engine/types.js";
import { translator } from "./i18n.js";
import { describeToolCall } from "./labels.js";
import { type OffLimits, type OwnThing, reachesFor } from "./off-limits.js";
import { excerpt, field, fileName, shortcut, shorten, toolName } from "./text.js";

export type Verdict =
  | { action: "allow" }
  | { action: "ask"; title: string; body: string | null; spoken: string; risk: Risk }
  /** Not for the owner to wave through: the call reaches for something of AgentOS's own. */
  | { action: "refuse"; what: OwnThing };

/** A tool call, plus what the tool says about itself when it is one of ours. */
export interface PolicyCall extends ToolCall {
  /** `AgentTool.readOnly`; undefined for tools that belong to the engine. */
  readOnly?: boolean;
  /** What the tool said about this call (`AgentTool.inspect`): what it acts on, how much is at stake. */
  facts?: ToolCallFacts;
}

export interface PolicyContext {
  autonomy: Autonomy;
  /** Language of the question put to the owner. */
  language: string;
  agentName: string;
  /** Folder the call would run in. */
  cwd: string;
  /** What belongs to AgentOS itself. */
  own: OffLimits;
}

/** What a question to the owner is about; each has its wording in i18n.ts. */
type Concern =
  | "delete" | "admin" | "forcePush" | "pushMain" | "publish" | "deploy"
  | "remoteScript" | "system" | "discard" | "data" | "command" | "edit" | "tool"
  | "screen" | "screenTarget" | "click" | "clickSomewhere" | "typeIn" | "typeSomewhere" | "press" | "openApp" | "quitApp"
  | "connected";

/**
 * Tools that only pass words along or organise the agent's own work. What
 * they say is not looked at: whatever a sub-agent or a job then does comes
 * back through this policy.
 */
const WORDS_ONLY = new Set([
  "WebSearch", "ToolSearch", "Agent", "Task", "Skill", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
  "TaskStop", "TaskOutput", "BashOutput", "KillShell",
  "ask_owner", "start_job", "list_jobs", "tell_job", "stop_job",
]);

/**
 * Tools that only look. `SandboxNetworkAccess` is the engine's sandbox asking
 * whether a command may reach a host on the internet.
 */
const READERS = new Set([
  "Read", "Glob", "Grep", "LS", "NotebookRead", "WebFetch", "ListMcpResourcesTool", "ReadMcpResourceTool", "SandboxNetworkAccess",
]);

const SHELLS = new Set(["Bash", "PowerShell"]);
const EDITORS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Shell commands worth a question even when the agent works alone. First match wins. */
const RISKY_COMMANDS: { concern: Concern; risk: Risk; pattern: RegExp }[] = [
  {
    concern: "remoteScript",
    risk: "high",
    pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|fi)?sh\b|\b(ba|z)?sh\s+(-c\s+)?["']?(\$\(|<\()\s*(curl|wget)\b|\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b.*\|\s*(iex|Invoke-Expression)\b/i,
  },
  { concern: "admin", risk: "high", pattern: /\b(sudo|doas)\b|\bsu\s+(-|root\b)/ },
  {
    concern: "delete",
    risk: "high",
    pattern: /\brm\s+(-\w*[rRf]\w*|--recursive|--force)\b|\bfind\b.*\s-delete\b|\bshred\b|\b(rmdir|rd)\s+\/s\b|\bRemove-Item\b.*\s-(Recurse|Force)\b/i,
  },
  { concern: "forcePush", risk: "high", pattern: /\bgit\s+push\b.*\s(--force(-with-lease)?\b|-\w*f\w*\b|\+\S)/ },
  { concern: "pushMain", risk: "medium", pattern: /\bgit\s+push\b.*\b(main|master)\b|\bgh\s+pr\s+merge\b/ },
  {
    concern: "discard",
    risk: "medium",
    pattern: /\bgit\s+(reset\s+--hard|clean\s+-\w*f|checkout\s+(--\s|\.)|restore\s|branch\s+-D|stash\s+(drop|clear))/,
  },
  {
    concern: "publish",
    risk: "high",
    pattern: /\b(npm|pnpm|yarn|bun|cargo|poetry|uv|flit|hatch)\s+publish\b|\bgem\s+push\b|\btwine\s+upload\b|\bdocker\s+(image\s+)?push\b|\bdocker\s+buildx\b.*\s--push\b|\bgh\s+release\s+(create|upload|edit|delete)\b|\bgh\s+repo\s+delete\b/,
  },
  {
    concern: "deploy",
    risk: "high",
    pattern: /\bvercel\b.*\s--prod\b|\bnetlify\s+deploy\b.*\s--prod\b|\b(firebase|fly|flyctl|railway|wrangler|serverless|sls|cdk|pulumi)\s+(deploy|up|publish)\b|\bgcloud\b.*\sdeploy\b|\bgit\s+push\s+heroku\b|\bkubectl\s+(apply|delete|replace|patch|scale|rollout|drain)\b|\bhelm\s+(install|upgrade|uninstall|delete|rollback)\b|\b(terraform|tofu)\s+(apply|destroy)\b|\bansible-playbook\b/,
  },
  { concern: "data", risk: "high", pattern: /\b(drop\s+(database|table|schema)|truncate\s+table|delete\s+from)\b/i },
  {
    concern: "system",
    risk: "high",
    pattern: /\bdd\s+.*\bof=|\bmkfs\b|\bdiskutil\s+(erase\w*|partitionDisk|reformat|apfs\s+delete\w*)\b|\b(fdisk|parted)\b|\b(shutdown|reboot|halt|poweroff)\b|\blaunchctl\s+(unload|remove|bootout|disable)\b|\bsystemctl\s+(stop|disable|mask|poweroff|reboot)\b|\b(killall|pkill)\b|\b(chmod|chown)\s+(-\w*R\w*|--recursive)\b|\b(csrutil|spctl|nvram|visudo)\b|\bcrontab\s+-r\b|\bdefaults\s+delete\b|>\s*\/dev\/(sd|disk|nvme)/,
  },
];

/** What acting on the screen is called when the tool can name what it acts on. */
const SCREEN_ACTIONS: Record<string, Concern> = {
  computer_click: "click",
  computer_type: "typeIn",
  computer_press: "press",
  computer_open_app: "openApp",
  computer_close_app: "quitApp",
};

/** And when it cannot: the kind of action is still said; others get a general wording. */
const UNNAMED_SCREEN_ACTIONS: Record<string, Concern> = { computer_click: "clickSomewhere", computer_type: "typeSomewhere" };

/** How much of a command or of a tool's input a question shows. */
const BODY_LENGTH = 600;

/**
 * Words in a tool's name that suggest it reaches other people or cannot be
 * undone. They make a question about a connected tool a serious one, and an
 * engine tool this policy does not know ask at all.
 */
const RISKY_VERBS = new Set([
  "send", "reply", "forward", "post", "publish", "deploy", "merge", "pay", "purchase", "buy", "transfer",
  "delete", "remove", "trash", "destroy", "drop", "stop", "restart", "shutdown", "kill",
]);

/** What the name of a tool that only reads starts with, when its server does not say. */
const READING = new Set(["list", "get", "search", "read", "query", "fetch", "describe", "inspect"]);

/** Decides whether a tool call may run, must first be put to the owner, or may not run at all. */
export function decide(call: PolicyCall, ctx: PolicyContext): Verdict {
  if (WORDS_ONLY.has(call.tool)) return { action: "allow" };
  const own = reachesFor(call, ctx.cwd, ctx.own);
  if (own) return { action: "refuse", what: own };
  if (ctx.autonomy === "autonomous" || call.readOnly || READERS.has(call.tool)) return { action: "allow" };
  const supervised = ctx.autonomy === "supervised";

  if (SHELLS.has(call.tool)) {
    const command = field(call.input, "command");
    const rule = RISKY_COMMANDS.find((r) => r.pattern.test(command));
    if (rule) return ask(ctx, rule.concern, rule.risk, command, "", rule.pattern);
    return supervised ? ask(ctx, "command", "low", command) : { action: "allow" };
  }

  if (EDITORS.has(call.tool)) {
    const path = field(call.input, "file_path") || field(call.input, "notebook_path");
    return supervised ? ask(ctx, "edit", "low", path, fileName(path)) : { action: "allow" };
  }

  // One of our own tools that acts — the mouse, the keyboard: ordinary work unless supervised,
  // or unless the tool itself says this particular call is a serious one (a "Pay" button).
  if (call.readOnly === false) {
    const { target, risk = "low" } = call.facts ?? {};
    if (!supervised && risk !== "high") return { action: "allow" };
    const doing = describeToolCall(call.tool, call.input, ctx.language, call.facts);
    const body = [doing?.label, doing?.detail].filter(Boolean).join(": ");
    if (!target) return ask(ctx, UNNAMED_SCREEN_ACTIONS[call.tool] ?? "screen", risk, body);
    const concern = SCREEN_ACTIONS[call.tool] ?? "screenTarget";
    return ask(ctx, concern, risk, body, concern === "press" ? shortcut(target) : target);
  }

  // A tool of a server the owner connected acts in the world beyond this computer: it asks unless it only reads.
  const connected = connectedTool(call);
  if (connected) {
    if (connected.reads) return { action: "allow" };
    const risk = connected.destructive || hasRiskyVerb(connected.action) ? "high" : "medium";
    return ask(ctx, "connected", risk, JSON.stringify(call.input), connected.action, undefined, connected.server);
  }

  const risky = hasRiskyVerb(toolName(call.tool));
  if (!supervised && !risky) return { action: "allow" };
  return ask(ctx, "tool", risky ? "medium" : "low", JSON.stringify(call.input), toolName(call.tool));
}

/**
 * A tool from an MCP server of the owner's configuration — told by the
 * engine, or by Claude Code's `mcp__<server>__<tool>` naming — as the owner
 * would name it: "Google Calendar", "delete event". Whether it only reads is
 * what its server says; failing that, what its name begins with.
 */
function connectedTool(call: PolicyCall): { server: string; action: string; reads: boolean; destructive: boolean } | null {
  const [prefix, configured, ...rest] = call.tool.split("__");
  if (!call.server && (prefix !== "mcp" || !configured || rest.length === 0)) return null;
  const raw = call.server?.name ?? configured ?? "";
  // Connectors of a claude.ai account come as "claude_ai_Gmail" or "claude.ai Gmail": the owner knows them as "Gmail".
  const server = shorten(raw.replace(/^claude[._ ]?ai[_ ]+/i, "").replace(/[_-]+/g, " ").trim(), 40);
  const words = toolName(call.tool).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(" ");
  // "notion create pages" from Notion is "create pages".
  if (words.length > 1 && words[0] === server.toLowerCase().split(" ").at(-1)) words.shift();
  const action = words.join(" ");
  const { readOnly, destructive = false } = call.server ?? {};
  const reads = !destructive && (readOnly ?? READING.has(words[0] ?? ""));
  return { server: server.charAt(0).toUpperCase() + server.slice(1), action, reads, destructive };
}

/** Whether a name ("send message", "CronDelete") holds one of the risky verbs. */
function hasRiskyVerb(name: string): boolean {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .some((word) => RISKY_VERBS.has(word.toLowerCase()));
}

/**
 * The question for the owner. A body too long to show whole keeps its
 * beginning, its end and the part that raised the question (`because`), and
 * says how much is left out in between: what is approved is never cut silently.
 */
function ask(ctx: PolicyContext, concern: Concern, risk: Risk, body: string, what = "", because?: RegExp, server = ""): Verdict {
  const t = translator(ctx.language);
  const values = { agent: ctx.agentName, what, server };
  const notShown = (count: number): string => t("ask.notShown", { count });
  return {
    action: "ask",
    title: t(`ask.${concern}.title`, values),
    spoken: t(`ask.${concern}.spoken`, values),
    body: body && body !== "{}" ? excerpt(body, BODY_LENGTH, notShown, because) : null,
    risk,
  };
}
