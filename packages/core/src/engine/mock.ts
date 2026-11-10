/**
 * The practice engine: a script instead of a model. No credentials, no cost,
 * always the same — for building and testing every client.
 *
 * It reacts to a word in what the owner says (English or French):
 *
 *   "deploy" / "déploie"   works, then asks a question — with a screenshot when
 *                          the computer can take one — and finishes according
 *                          to the answer
 *   "delete" / "supprime"  wants to run `rm -rf ./build`: the safety policy
 *                          asks for approval exactly as for a real risky action
 *   "quit" / "quitte"      wants to quit an app with the computer's own tool: an
 *                          approval showing what is on the screen. It only
 *                          pretends to act, and needs a computer to do so
 *   "job"                  starts a background job that reports a few seconds later
 *   "error" / "erreur"     fails
 *   anything else          a short streamed reply
 *
 * `AGENTOS_MOCK_SPEED` scales every delay: 2 is twice as slow, 0 is instant.
 */
import { yesOrNo } from "../answers.js";
import { type Translate, translator } from "../i18n.js";
import { shorten } from "../text.js";
import { describeToolCall, inspectCall } from "../labels.js";
import type { Engine, EngineHost, EngineSession, TurnResult } from "./types.js";

const JOB_STEPS = 3;
/** The computer tool the "quit" script asks to use. */
const QUIT_TOOL = "computer_close_app";

/** Thrown inside a turn when the owner interrupts it. */
const INTERRUPTED = new Error("interrupted");

export function createMockEngine(speed = Number(process.env.AGENTOS_MOCK_SPEED ?? 1)): Engine {
  return {
    id: "mock",
    status: async () => ({ ready: true, auth: "none" }),
    open: (host) => new MockSession(host, Number.isFinite(speed) && speed >= 0 ? speed : 1),
  };
}

class MockSession implements EngineSession {
  private readonly queue: { text: string; kind: "message" | "note" }[] = [];
  private working: Promise<void> | null = null;
  private stop = new AbortController();
  private closed = false;
  /** Messages answered so far — all this engine has to resume from. */
  private answered: number;
  private readonly t: Translate;

  constructor(
    private readonly host: EngineHost,
    private readonly speed: number,
  ) {
    // A token left by another engine means nothing here: count from zero.
    this.answered = Number(host.resume) || 0;
    this.t = translator(host.language);
  }

  send(text: string, kind: "message" | "note"): void {
    this.queue.push({ text, kind });
    this.working ??= this.work();
  }

  async interrupt(): Promise<void> {
    if (!this.working) return;
    this.queue.length = 0;
    this.stop.abort();
    await this.working;
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.stop.abort();
  }

  /** Answers what is queued, then hands back. A message sent meanwhile is answered in the same turn. */
  private async work(): Promise<void> {
    let result: TurnResult = { ok: false, text: "" };
    while (this.queue.length > 0) {
      const { text, kind } = this.queue.shift()!;
      try {
        result = await this.answer(text, kind);
        this.host.saveResume(String(++this.answered));
      } catch (error) {
        if (error !== INTERRUPTED) {
          result = this.trouble();
          continue;
        }
        this.stop = new AbortController();
        result = { ok: false, text: "" };
        break;
      }
    }
    this.working = null;
    if (this.closed) return;
    this.host.onTurnEnd(result);
    if (this.queue.length > 0) this.working ??= this.work();
  }

  private answer(text: string, kind: "message" | "note"): Promise<TurnResult> {
    if (kind === "note") return this.say(this.t("mock.jobFinished"));
    if (this.host.thread.kind === "job") return this.runJob();
    if (/\b(deploy|d[ée]ploie)/i.test(text)) return this.deploy();
    if (/\b(delete|supprime)/i.test(text)) return this.delete();
    if (/\b(quit|quitte)\b/i.test(text) && this.host.tools.some((tool) => tool.name === QUIT_TOOL)) return this.quit();
    if (/\bjob\b/i.test(text)) return this.startJob(text);
    if (/\b(error|erreur)\b/i.test(text)) return this.fail();
    return this.reply(text);
  }

  private async reply(text: string): Promise<TurnResult> {
    await this.activity(this.t("mock.thinking"), 400);
    return this.say(this.t("mock.reply", { text: shorten(text, 80) }));
  }

  private async deploy(): Promise<TurnResult> {
    await this.activity(this.t("mock.testing"), 900);
    await this.activity(this.t("mock.building"), 900);
    const yes = this.t("mock.deployYes");
    const answer = await this.useTool("ask_owner", {
      question: this.t("mock.deployQuestion"),
      options: [yes, this.t("mock.deployNo")],
      risk: "medium",
      screenshot: true,
    });
    // The tool answers in a sentence, as it would to a model: the owner's words are the quoted part.
    const said = /"(.*)"/.exec(answer)?.[1] ?? "";
    if (said !== yes && yesOrNo(said) !== "yes") return this.say(this.t("mock.notDeployed"));
    await this.activity(this.t("mock.deploying"), 900);
    return this.say(this.t("mock.deployed"));
  }

  private async delete(): Promise<TurnResult> {
    const command = "rm -rf ./build";
    const verdict = await this.host.authorize({ tool: "Bash", input: { command } });
    await this.pause(0);
    if (!verdict.allow) return this.say(this.t("mock.notDeleted"));
    await this.activity(this.t("mock.deleting"), 600, "Bash", command);
    return this.say(this.t("mock.deleted"));
  }

  /** Goes through the approval of a real computer tool, then pretends to use it. */
  private async quit(): Promise<TurnResult> {
    const input = { app: "Calculator" };
    const verdict = await this.host.authorize({ tool: QUIT_TOOL, input });
    await this.pause(0);
    if (!verdict.allow) return this.say(this.t("mock.notDeleted"));
    const tool = this.host.tools.find((candidate) => candidate.name === QUIT_TOOL);
    const shown = describeToolCall(QUIT_TOOL, input, this.host.language, inspectCall(tool, input));
    if (shown) await this.activity(shown.label, 600, shown.tool, shown.detail);
    return this.say(this.t("mock.pretended"));
  }

  private async startJob(prompt: string): Promise<TurnResult> {
    await this.useTool("start_job", { title: this.t("mock.jobTitle"), prompt });
    return this.say(this.t("mock.jobStarted"));
  }

  private async runJob(): Promise<TurnResult> {
    for (let step = 1; step <= JOB_STEPS; step++) {
      await this.activity(this.t("mock.jobStep", { step, steps: JOB_STEPS }), 1000);
    }
    return this.say(this.t("mock.jobReport", { steps: JOB_STEPS }));
  }

  private async fail(): Promise<TurnResult> {
    await this.activity(this.t("mock.thinking"), 400);
    return this.trouble();
  }

  private trouble(): TurnResult {
    const text = this.t("trouble.generic");
    this.host.onMessage(text);
    return { ok: false, text };
  }

  /** Types a message word by word, then delivers it whole. */
  private async say(text: string): Promise<TurnResult> {
    for (const word of text.split(/(?<= )/)) {
      await this.pause(40);
      this.host.onDelta(word);
    }
    this.host.onMessage(text);
    return { ok: true, text };
  }

  private async activity(label: string, ms: number, tool: string | null = null, detail: string | null = null): Promise<void> {
    const id = this.host.onActivityStart({ label, tool, detail });
    await this.pause(ms);
    this.host.onActivityEnd(id, true);
  }

  /** Calls one of the host's tools the way a model would, and returns what it said. */
  private async useTool(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.host.tools.find((candidate) => candidate.name === name);
    if (!tool) return "";
    const shown = describeToolCall(name, input, this.host.language, inspectCall(tool, input));
    const id = shown ? this.host.onActivityStart(shown) : null;
    const result = await tool.run(input, this.host.toolContext());
    if (id) this.host.onActivityEnd(id, !result.isError);
    await this.pause(0);
    return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  }

  /** Waits, scaled by the mock speed. Rejects when the turn is interrupted, also when already so. */
  private pause(ms: number): Promise<void> {
    const signal = this.stop.signal;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(INTERRUPTED);
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms * this.speed);
      const abort = (): void => {
        clearTimeout(timer);
        reject(INTERRUPTED);
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
