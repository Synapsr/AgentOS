import { useEffect, useRef, useState } from "react";
import { DENY, MAIN_THREAD, type Autonomy, type Settings } from "@agentos/protocol";
import { glyph, toSVG, type PulseKind } from "@agentos/presence";
import { useAppState, useT } from "../client/hooks";
import type { Translate } from "../i18n";
import type { PresenceState } from "./Presence";
import { unbreak } from "./RequestCard";

/** What every surface shows of the agent: its name, what its presence does, its current line, and what it is doing. */
export interface Agent {
  name: string;
  state: PresenceState;
  /** One sentence, first person: the agent talking. */
  line: string;
  /** What it is doing right now, in a few words, shown small under the line; null when there is nothing to say. */
  doing: string | null;
  /** Its answer to the owner's last answer, for the presence: a nod, or the hand lowered. */
  pulse?: { kind: PulseKind; id: string };
}

/** After an answer, the presence holds its asking shape this long while it reacts, before it moves on. */
const HOLD = 700;
/** …and the line acknowledges the answer this long, so that it never says the opposite of what was just decided. */
const ACK = 2400;
/** After a piece of work, "Done. Anything else?" stays this long before the greeting comes back. */
const AFTER = 60_000;

/** A component re-renders at `at` (a time in ms since the epoch), if that is still to come. */
function useWakeAt(at: number | null): void {
  const [, wake] = useState(0);
  useEffect(() => {
    if (at === null || at <= Date.now()) return;
    const timer = setTimeout(() => wake((n) => n + 1), at - Date.now() + 16);
    return () => clearTimeout(timer);
  }, [at]);
}

/** The last answer the computer confirmed while this view was open: what it was, and when. */
function useLastAnswer(): { kind: PulseKind; ack: "ackApproved" | "ackDenied" | "ackNoted"; id: string; at: number } | undefined {
  const requests = useAppState((state) => state.requests);
  const items = useAppState((state) => state.items);
  const [last, setLast] = useState<ReturnType<typeof useLastAnswer>>();
  const waiting = useRef<string[]>([]);
  useEffect(() => {
    const gone = waiting.current.filter((id) => !requests.some((request) => request.id === id));
    waiting.current = requests.map((request) => request.id);
    for (const id of gone) {
      const item = Object.values(items)
        .flat()
        .find((other) => other.id === id);
      if (item?.type !== "request" || item.state !== "resolved") continue;
      const denied = item.kind === "approval" && item.resolution?.optionId === DENY;
      const ack = item.kind !== "approval" ? "ackNoted" : denied ? "ackDenied" : "ackApproved";
      setLast({ kind: denied ? "denied" : "approved", ack, id, at: Date.now() });
    }
  }, [requests, items]);
  return last;
}

/**
 * Derives what every surface shows of the agent from what the computer says
 * of itself. The line is the agent speaking, and it never contradicts what
 * just happened: an answer is acknowledged first ("Okay, I won't."), work
 * in the background is said to be in the background, and the activity
 * itself is shown apart, under the line.
 */
export function useAgent(): Agent {
  const t = useT();
  const node = useAppState((state) => state.node);
  const status = useAppState((state) => state.status);
  const online = useAppState((state) => state.online);
  const request = useAppState((state) => state.requests[0]);
  const mainWorking = useAppState((state) => state.threads.find((thread) => thread.id === MAIN_THREAD)?.state === "working");
  const job = useAppState((state) => state.threads.find((thread) => thread.kind === "job" && thread.state === "working"));
  const answer = useLastAnswer();
  const name = node?.agent.name ?? "";

  const mainItems = useAppState((state) => state.items[MAIN_THREAD]);
  const jobsWorking = useAppState((state) => state.threads.filter((thread) => thread.kind === "job" && thread.state === "working").length);
  const jobsDone = useAppState((state) => state.threads.filter((thread) => thread.kind === "job" && thread.state === "idle").length);

  // When real work ends — a turn that did something, or a background job
  // that finished — the agent says it is done for a while. A plain reply
  // (a hello, an answer in words) is not work: the line goes back to idle.
  const [finished, setFinished] = useState<number | null>(null);
  const was = useRef({ mainWorking, jobsWorking, jobsDone });
  useEffect(() => {
    const before = was.current;
    was.current = { mainWorking, jobsWorking, jobsDone };
    if (mainWorking) {
      setFinished(null);
      return;
    }
    const lastAsked = (mainItems ?? []).findLastIndex((item) => item.type === "message" && item.role === "user");
    const didWork = (mainItems ?? []).slice(lastAsked + 1).some((item) => item.type === "activity" || item.type === "request");
    const turnEnded = before.mainWorking && didWork;
    const jobEnded = jobsWorking < before.jobsWorking && jobsDone > before.jobsDone;
    if (turnEnded || jobEnded) setFinished(Date.now());
    else if (before.mainWorking) setFinished(null);
  }, [mainWorking, jobsWorking, jobsDone, mainItems]);

  const now = Date.now();
  const since = answer ? now - answer.at : Infinity;
  useWakeAt(answer ? answer.at + (since < HOLD ? HOLD : ACK) : null);
  useWakeAt(finished === null ? null : finished + AFTER);
  const pulse = answer && { kind: answer.kind, id: answer.id };

  if (!online || !node || !status) return { name, state: "offline", line: t("offlineCause", { computer: node?.name || t("yourComputer") }), doing: null, pulse };
  // It is asking exactly as long as a question is on screen. The status
  // says so too, but an event later: going by it, the old line would show
  // again for an instant after every answer.
  if (request) return { name, state: "waiting", line: unbreak(request.spoken) || t("lineWaiting"), doing: null, pulse };
  const working = status.state !== "idle";
  if (since < ACK) {
    return { name, state: since < HOLD ? "waiting" : working ? "working" : "idle", line: t(answer!.ack), doing: null, pulse };
  }
  if (working) {
    if (!mainWorking && job) return { name, state: "working", line: t("lineBackground"), doing: job.preview ? `${job.title} · ${job.preview}` : job.title, pulse };
    return { name, state: "working", line: t("lineWorking"), doing: status.activity, pulse };
  }
  if (!node.capabilities.engineReady) return { name, state: "idle", line: t("lineNeedsKey"), doing: null, pulse };
  if (finished !== null && now - finished < AFTER) {
    // "Done" would not fit a piece of work the owner just stopped.
    const stopped = answer?.ack === "ackDenied" && finished - answer.at < AFTER;
    return { name, state: "idle", line: t(stopped ? "lineAnythingElse" : "lineDone"), doing: null, pulse };
  }

  const hour = new Date().getHours();
  const greeting = hour >= 5 && hour < 12 ? "lineMorning" : hour >= 12 && hour < 18 ? "lineAfternoon" : "lineEvening";
  // Without a name to greet, "Good evening, ." becomes "Good evening."
  return { name, state: "idle", line: t(greeting, { owner: node.owner.name }).replace(", .", "."), doing: null, pulse };
}

/** Where a Claude key is made: the page of the Anthropic Console that lists them. */
export const CLAUDE_KEYS = "https://console.anthropic.com/settings/keys";

/**
 * When the brain is Claude and needs no key of ours, Claude is already set
 * up on this computer (AgentOS never reads how), and the tools connected to
 * it come along. This says so in two sentences, the second one true to how
 * much the agent should ask. Null in any other case.
 */
export function ownAccountNote(t: Translate, engine: Settings["engine"] | undefined, autonomy: Autonomy): string | null {
  if (engine?.provider !== "claude" || engine.auth !== "environment" || !engine.ready) return null;
  return `${t("ownAccount")} ${t(autonomy === "autonomous" ? "ownAccountActs" : "ownAccountAsks")}`;
}

/** The waiting glyph as a favicon: a file of its own (`blob:`), as the page's Content-Security-Policy wants. */
let askingIcon: string | null = null;
function askingFavicon(): string {
  // The daylight amber: it reads on a light tab bar as well as on a dark one.
  askingIcon ??= URL.createObjectURL(new Blob([toSVG(glyph("waiting", 32, "light"), { glow: false })], { type: "image/svg+xml" }));
  return askingIcon;
}

/** Names the browser tab after the agent and, while it is asking, says so in the title and with the waiting glyph. */
export function useDocumentTitle(): void {
  const t = useT();
  const name = useAppState((state) => state.node?.agent.name);
  const waiting = useAppState((state) => state.requests.length > 0);
  useEffect(() => {
    if (name) document.title = waiting ? `● ${t("asking")}` : name;
  }, [name, waiting, t]);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link || !waiting) return;
    const mark = link.href;
    link.href = askingFavicon();
    return () => {
      link.href = mark;
    };
  }, [waiting]);
}
