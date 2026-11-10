/**
 * Requests waiting for the owner, and the rules for answering them: the
 * first answer wins, an option must be one that was offered, and words in
 * reply to "Can I go ahead?" only count when they are plainly a yes or a no.
 */
import { APPROVE, DENY, type RequestItem, type RequestResolution } from "@agentos/protocol";
import { yesOrNo } from "./answers.js";
import { Failure } from "./errors.js";

/** An answer as a client gives it: a tap on an option, words, or both. */
export interface Answer {
  optionId: string | null;
  text: string | null;
}

/**
 * What the owner's words mean when a client says they are the reply to a
 * request. A question takes them as they are. An approval takes a plain yes
 * or a plain no; anything else is null — not an answer, and nothing is decided.
 */
export function answerInWords(request: RequestItem, text: string): Answer | null {
  if (request.kind === "question") return { optionId: null, text };
  const reply = yesOrNo(text);
  return reply ? { optionId: reply === "yes" ? APPROVE : DENY, text } : null;
}

export class PendingRequests {
  private readonly waiting = new Map<string, { item: RequestItem; settle: (answer: RequestResolution | null) => void }>();

  /** Every waiting request, oldest first. */
  list(): RequestItem[] {
    return [...this.waiting.values()].map((entry) => entry.item);
  }

  /** The waiting requests of one thread. */
  of(threadId: string): RequestItem[] {
    return this.list().filter((item) => item.threadId === threadId);
  }

  has(id: string): boolean {
    return this.waiting.has(id);
  }

  /** Starts waiting. Resolves with the owner's answer, or with null when the request is cancelled. */
  wait(item: RequestItem): Promise<RequestResolution | null> {
    return new Promise((settle) => this.waiting.set(item.id, { item, settle }));
  }

  /** Applies the owner's answer and hands it to whoever asked. Returns the request, resolved. */
  answer(id: string, answer: Answer, deviceId: string | null): RequestItem {
    const entry = this.waiting.get(id);
    if (!entry) throw new Failure("conflict", "This request is not waiting for an answer.");
    const { item, settle } = entry;
    const { optionId, text } = answer;
    if (optionId !== null && !item.options.some((option) => option.id === optionId)) {
      throw new Failure("invalid", "This request has no such option.");
    }
    if (optionId === null && !item.allowText) throw new Failure("invalid", "This request is answered with one of its options.");

    const resolution: RequestResolution = { optionId, text, deviceId, at: Date.now() };
    this.waiting.delete(id);
    settle(resolution);
    return { ...item, state: "resolved", resolution };
  }

  /** Stops waiting for the requests of a thread — of every thread when none is given. Returns them, cancelled. */
  cancel(threadId?: string): RequestItem[] {
    const cancelled: RequestItem[] = [];
    for (const [id, { item, settle }] of [...this.waiting]) {
      if (threadId !== undefined && item.threadId !== threadId) continue;
      this.waiting.delete(id);
      settle(null);
      cancelled.push({ ...item, state: "cancelled" });
    }
    return cancelled;
  }
}
