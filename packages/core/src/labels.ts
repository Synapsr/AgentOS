/**
 * Turns a tool call into the one line the owner sees: "Reading notes.txt",
 * "Running the tests". Covers Claude Code's tools, the core's own and the
 * computer's; any other tool gets its name, made readable.
 */
import type { AgentTool, ToolCallFacts } from "@agentos/protocol";
import type { Activity } from "./engine/types.js";
import { translator } from "./i18n.js";
import { field, fileName, shortcut, shorten, toolName } from "./text.js";

/** Bookkeeping the owner does not need to watch, and questions that already show as requests. */
const SILENT = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "ToolSearch", "ask_owner"]);

/** What a tool says about one call — what it acts on, how much is at stake — when it has something to say. */
export function inspectCall(tool: AgentTool | undefined, input: Record<string, unknown>): ToolCallFacts {
  try {
    return tool?.inspect?.(input) ?? {};
  } catch {
    // Input the tool cannot read is input it will refuse to run on, too.
    return {};
  }
}

/**
 * The activity line for a tool call, or null when it is not worth showing.
 * `facts` is what the tool itself said about the call (see `inspectCall`).
 */
export function describeToolCall(tool: string, input: Record<string, unknown>, language: string, facts: ToolCallFacts = {}): Activity | null {
  if (SILENT.has(tool)) return null;
  const { target } = facts;
  const t = translator(language);
  const line = (label: string, detail = ""): Activity => ({ label: shorten(label, 80), tool, detail: detail || null });
  const path = field(input, "file_path") || field(input, "notebook_path") || field(input, "path");

  switch (tool) {
    case "Bash":
    case "PowerShell": {
      const command = field(input, "command");
      return line(field(input, "description") || command || t("doing.command"), command);
    }
    case "Read":
    case "NotebookRead":
      return line(t("doing.reading", { what: fileName(path) }), path);
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return line(t("doing.editing", { what: fileName(path) }), path);
    case "Glob":
    case "Grep":
      return line(t("doing.searching", { what: field(input, "pattern") }), path);
    case "WebFetch":
      return line(t("doing.reading", { what: hostOf(field(input, "url")) }), field(input, "url"));
    case "WebSearch":
      return line(t("doing.searchingWeb", { what: field(input, "query") }));
    case "Agent":
    case "Task":
      return line(t("doing.delegating", { what: field(input, "description") }));
    case "start_job":
      return line(t("doing.startingJob", { what: field(input, "title") }), field(input, "cwd"));
    case "list_jobs":
      return line(t("doing.checkingJobs"));
    case "tell_job":
      return line(t("doing.tellingJob"), field(input, "message"));
    case "stop_job":
      return line(t("doing.stoppingJob"));
    case "computer_snapshot":
    case "computer_screenshot": {
      const app = field(input, "app") || target;
      return line(app ? t("doing.lookingAt", { what: app }) : t("doing.looking"));
    }
    case "computer_click":
      return line(target ? t("doing.clickingOn", { what: target }) : t("doing.clicking"));
    case "computer_type":
      // What is typed may be private: it is a detail, never the headline.
      return line(target ? t("doing.typingIn", { what: target }) : t("doing.typing"), field(input, "text"));
    case "computer_press":
      return line(t("doing.pressing", { what: shortcut(field(input, "keys")) }));
    case "computer_scroll":
      return line(target ? t("doing.scrollingIn", { what: target }) : t("doing.scrolling"));
    case "computer_open_app":
      return line(t("doing.opening", { what: field(input, "app") || target || "" }));
    case "computer_close_app":
      return line(t("doing.closing", { what: field(input, "app") || target || "" }));
    case "computer_list_apps":
      return line(t("doing.listingApps"));
    case "computer_wait":
      return line(target ? t("doing.waitingFor", { what: target }) : t("doing.waiting"));
    case "computer_clipboard":
      return line(t("doing.clipboard"));
    default: {
      const name = toolName(tool);
      return line(name.charAt(0).toUpperCase() + name.slice(1) + (target ? `: ${target}` : ""));
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
