import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActivityItem, FileRef, Item, MessageItem, RequestItem } from "@agentos/protocol";
import { useAppState, useFileUrl, useStore, useT } from "../client/hooks";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { RequestCard, type RequestSurface } from "./RequestCard";
import { calm } from "./surface";
import "./Conversation.css";

/** How long an answered card takes to have its moment and fold into its receipt (RequestCard.css: --fold-at, then the layout spring). */
const SETTLING = 1300;
/** How long the conversation takes to glide to its end when it grows. */
const GLIDE = 450;

type Block =
  | { type: "message"; id: string; item: MessageItem }
  | { type: "activities"; id: string; items: ActivityItem[] }
  | { type: "request"; id: string; item: RequestItem };

/** Turns a timeline into what is drawn: consecutive activities become one group; requests are cards, then receipts. */
function blocks(items: Item[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (item.type === "message") out.push({ type: "message", id: item.id, item });
    else if (item.type === "activity" && last?.type === "activities") last.items.push(item);
    else if (item.type === "activity") out.push({ type: "activities", id: item.id, items: [item] });
    else out.push({ type: "request", id: item.id, item });
  }
  return out;
}

interface ConversationProps {
  threadId: string;
  /** How a request is laid out here: a card, or the side panel's narrower one. */
  surface?: RequestSurface;
}

/** One conversation: what was said, what the agent did, and what it is asking. */
export function Conversation({ threadId, surface = "card" }: ConversationProps) {
  const store = useStore();
  const items = useAppState((state) => state.items[threadId]);
  const everything = useAppState((state) => state.items);
  const typing = useAppState((state) => state.typing[threadId]);
  const hasMore = useAppState((state) => state.hasMore[threadId]);
  const requests = useAppState((state) => state.requests);
  const threads = useAppState((state) => state.threads);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  /** How tall the conversation and its window were when we last looked: tells whether its end was in view. */
  const before = useRef({ scroll: 0, client: 0 });
  /** Items newer than this arrived while we were looking: they get an entrance. */
  const [since, setSince] = useState(() => Date.now());
  /** Requests from other conversations shown here: kept once answered, so that they leave their receipt too. */
  const [visitors, setVisitors] = useState<string[]>([]);
  /** A request just answered on screen: what came after it waits until its card has folded, so nothing moves under the pointer. */
  const [settling, setSettling] = useState<string | null>(null);
  const waiting = useRef<Set<string>>(new Set());

  useEffect(() => {
    setSince(Date.now());
    setVisitors([]);
    // Another conversation starts at its end.
    before.current = { scroll: 0, client: 0 };
    store.open(threadId).catch(() => {});
  }, [store, threadId]);

  // A request from a background job is answered here; its own conversation
  // is opened (quietly) so that the answer, from wherever it comes, reaches
  // this view and the card can fold into the right receipt.
  useEffect(() => {
    const arrived = requests.filter((request) => request.threadId !== threadId && !visitors.includes(request.id));
    if (arrived.length === 0) return;
    for (const request of arrived) store.open(request.threadId).catch(() => {});
    setVisitors((list) => [...list, ...arrived.map((request) => request.id)]);
  }, [requests, threadId, visitors, store]);

  // Follow the conversation as it grows, unless the owner scrolled up to read.
  // Whether they did is judged from where the end was before it grew — not
  // from scroll events, which arrive too late when a tall card comes in.
  // Once it is following, it glides to the end rather than jumping there,
  // and stops gliding the moment the owner scrolls themselves.
  useLayoutEffect(() => {
    const view = scroller.current;
    if (!view || !content.current) return;
    let frame = 0;
    let gliding = false;
    const stop = () => {
      cancelAnimationFrame(frame);
      gliding = false;
    };
    const glide = () => {
      cancelAnimationFrame(frame);
      const from = view.scrollTop;
      const start = performance.now();
      gliding = true;
      const step = (time: number) => {
        const k = Math.min(1, (time - start) / GLIDE);
        view.scrollTop = from + (view.scrollHeight - view.clientHeight - from) * (1 - (1 - k) ** 3);
        if (k < 1) frame = requestAnimationFrame(step);
        else gliding = false;
      };
      frame = requestAnimationFrame(step);
    };
    const follow = () => {
      const atEnd = gliding || before.current.scroll - view.scrollTop - before.current.client < 60;
      if (atEnd && (before.current.scroll === 0 || calm())) view.scrollTop = view.scrollHeight;
      else if (atEnd) glide();
      before.current = { scroll: view.scrollHeight, client: view.clientHeight };
    };
    const observer = new ResizeObserver(follow);
    observer.observe(content.current);
    observer.observe(view);
    view.addEventListener("wheel", stop, { passive: true });
    view.addEventListener("touchstart", stop, { passive: true });
    return () => {
      stop();
      observer.disconnect();
      view.removeEventListener("wheel", stop);
      view.removeEventListener("touchstart", stop);
    };
  }, []);

  const showEarlier = async () => {
    const view = scroller.current;
    if (!view) return;
    const fromEnd = view.scrollHeight - view.scrollTop;
    await store.loadEarlier(threadId).catch(() => {});
    requestAnimationFrame(() => (view.scrollTop = view.scrollHeight - fromEnd));
  };

  const timeline = useMemo(() => {
    const own = items ?? [];
    const shown = new Set(own.map((item) => item.id));
    // Pending requests not in this timeline (another job's, or this one's before it loads), and
    // the visitors that were answered since: each where it belongs in time.
    const extra: RequestItem[] = requests.filter((request) => !shown.has(request.id));
    for (const id of visitors) {
      if (shown.has(id) || extra.some((request) => request.id === id)) continue;
      const settled = Object.values(everything)
        .flat()
        .find((item): item is RequestItem => item.id === id && item.type === "request");
      if (settled) extra.push(settled);
    }
    const all = extra.length ? [...own, ...extra].sort((a, b) => a.at - b.at) : own;
    const list = blocks(all);
    // The reply being written keeps its place (and its key) when it arrives for good.
    if (typing && !items?.some((item) => item.id === typing.messageId)) {
      const item: MessageItem = { id: typing.messageId, threadId, at: Date.now(), type: "message", role: "agent", text: typing.text, via: "text", deviceId: null, files: [] };
      list.push({ type: "message", id: item.id, item });
    }
    return list;
  }, [items, everything, requests, visitors, typing, threadId]);

  // A card that was waiting here and is now answered (here or elsewhere) settles first.
  useEffect(() => {
    const now = new Set(timeline.filter((block) => block.type === "request" && block.item.state === "pending").map((block) => block.id));
    const answered = [...waiting.current].find((id) => !now.has(id) && timeline.some((block) => block.id === id));
    waiting.current = now;
    if (answered) setSettling(answered);
  }, [timeline]);
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(null), SETTLING);
    return () => clearTimeout(timer);
  }, [settling]);
  const cut = settling ? timeline.findIndex((block) => block.id === settling) : -1;
  const shown = cut >= 0 ? timeline.slice(0, cut + 1) : timeline;

  /** Named on a request that comes from a job other than the conversation on screen. */
  const jobTitle = (id: string) => (id === threadId ? undefined : threads.find((other) => other.id === id && other.kind === "job")?.title);

  // The agent's turn: from the moment a message is sent (or a question is
  // answered) there is a row for it at the end — "I'm on it." — until its
  // first activity, or its words, take the place.
  const last = shown.at(-1);
  const answered = (last?.type === "request" && last.item.state !== "pending") || (last?.type === "message" && last.item.role === "user");
  const turn = answered && cut < 0 && threads.find((other) => other.id === threadId)?.state === "working";
  const empty = items?.length === 0 && !typing && requests.length === 0;
  /** Only the first request waiting on screen answers to the keyboard. */
  const first = timeline.find((block) => block.type === "request" && block.item.state === "pending")?.id;

  return (
    <div className="conversation" ref={scroller}>
      <div className="conversation-content" ref={content}>
        {hasMore && <Earlier onClick={() => void showEarlier()} />}
        {empty && <Empty threadId={threadId} />}
        {shown.map((block) =>
          block.type === "message" ? (
            <Message key={block.id} item={block.item} enter={block.item.at >= since} />
          ) : block.type === "activities" ? (
            <Activities key={block.id} items={block.items} enter={block.items[0]!.at >= since} />
          ) : (
            <RequestCard
              key={block.id}
              request={block.item}
              surface={surface}
              origin={jobTitle(block.item.threadId)}
              arrive={block.item.at >= since}
              keys={block.id === first}
            />
          ),
        )}
        {turn && <Turn />}
      </div>
    </div>
  );
}

function Earlier({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button className="button sm quiet conversation-earlier" onClick={onClick}>
      {t("earlier")}
    </button>
  );
}

/** An empty conversation is an invitation: what to ask, as suggestions that send themselves. */
function Empty({ threadId }: { threadId: string }) {
  const store = useStore();
  const t = useT();
  const suggestions = [t("suggest1"), t("suggest2"), t("suggest3")];
  return (
    <div className="conversation-empty">
      <p className="type-title arrive">{t("emptyTitle")}</p>
      <div className="conversation-suggestions">
        {suggestions.map((text, i) => (
          <button
            key={text}
            className="chip arrive"
            style={{ "--i": i + 1 } as CSSProperties}
            onClick={() => void store.send(threadId, text).catch(() => {})}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The agent's words carry light formatting; the owner's are shown exactly as said. */
const Message = memo(function Message({ item, enter }: { item: MessageItem; enter: boolean }) {
  const t = useT();
  return (
    <div className={`message ${item.role}${enter ? " arrive" : ""}`}>
      {item.role === "agent" ? (
        <Markdown text={item.text} />
      ) : (
        <p>
          {item.via === "voice" && (
            <span className="message-voice" role="img" aria-label={t("saidAloud")} title={t("saidAloud")}>
              <Icon name="voice" dense />
            </span>
          )}
          {item.text}
        </p>
      )}
      {item.files.map((file) => (
        <Picture key={file.id} file={file} />
      ))}
    </div>
  );
});

function Picture({ file }: { file: FileRef }) {
  const url = useFileUrl(file.mime.startsWith("image/") ? file : null);
  return url ? <img className="message-picture" src={url} alt="" width={file.width ?? undefined} height={file.height ?? undefined} /> : null;
}

/** The agent's turn while it has nothing to name yet: a still dot and "I'm on it." The presence, in view above, is what moves. */
function Turn() {
  const t = useT();
  return (
    <div className="activity arrive" data-state="running">
      <Mark state="running" />
      <span>{t("lineWorking")}</span>
    </div>
  );
}

/** What the agent did: one quiet line each while it happens, folded into one once done. */
function Activities({ items, enter }: { items: ActivityItem[]; enter: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const finished = items.filter((item) => item.state !== "running");
  const running = items.filter((item) => item.state === "running");
  const folds = finished.length > 1;
  const line = (item: ActivityItem) => (
    <div key={item.id} className="activity" data-state={item.state}>
      <Mark state={item.state} />
      <span>{item.label}</span>
      {open && item.detail && <code>{item.detail}</code>}
    </div>
  );
  return (
    <div className={enter ? "activities arrive" : "activities"}>
      {folds && (
        <>
          <button className="activity fold" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Mark state={finished.some((item) => item.state === "failed") ? "failed" : "done"} />
            <span>{t("steps", { n: finished.length })}</span>
            <Icon name="chevron" dense />
          </button>
          <div className="activities-open" data-open={open || undefined} inert={!open}>
            <div>{finished.map(line)}</div>
          </div>
        </>
      )}
      {!folds && finished.map(line)}
      {running.map(line)}
    </div>
  );
}

function Mark({ state }: { state: ActivityItem["state"] }) {
  if (state === "running") return <span className="activity-running" />;
  return <Icon name={state === "done" ? "check" : "alert"} dense />;
}
