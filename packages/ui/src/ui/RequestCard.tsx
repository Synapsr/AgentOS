import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { APPROVE, DENY, type Device, type RequestItem, type RequestOption } from "@agentos/protocol";
import type { Client } from "../client/client";
import { useAppState, useFileUrl, useStore, useT } from "../client/hooks";
import type { Translate } from "../i18n";
import { Glyph, Icon } from "./Icon";
import "./RequestCard.css";

/** Buttons ignore input this long after a request appears, so that a tap meant for what was there cannot answer it. */
const TOUCH_GUARD = 400;
/** At high risk, Go ahead waits this long after the request appears (Touch ID would replace it). */
const ARMING = 1000;
/** After this long without an answer from the computer, the card says it is still sending. */
const SLOW = 1500;

/** Requests answered on this page: their receipt does not need to say where they were answered. */
const answeredHere = new Set<string>();

/** The words on an option: ours for an approval ("Go ahead" / "Stop"), the agent's own for a question. */
export function optionLabel(t: Translate, request: RequestItem, option: RequestOption): string {
  if (request.kind === "approval" && option.id === APPROVE) return t("goAhead");
  if (request.kind === "approval" && option.id === DENY) return t("stop");
  return option.label;
}

/**
 * The options in the order they are shown, so that the way forward is
 * always in the same place: in a row (two options) the primary one is
 * trailing — an approval is always [Stop] [Go ahead] — and in a stack
 * (more than two) it is on top. Otherwise the agent's order is kept.
 */
function ordered(request: RequestItem): RequestOption[] {
  const primary = (option: RequestOption) =>
    request.kind === "approval" ? option.id === APPROVE : option.style === "primary";
  const row = request.options.length <= 2;
  // Array.prototype.sort is stable: options of the same rank keep the agent's order.
  return [...request.options].sort((a, b) => (Number(primary(a)) - Number(primary(b))) * (row ? 1 : -1));
}

/** The look of an option's button: Go ahead is the primary, Stop a solid secondary; a question's options as the agent styled them. */
function optionLook(request: RequestItem, option: RequestOption): string {
  if (request.kind === "approval") return option.id === APPROVE ? "primary" : "secondary";
  return { primary: "primary", danger: "careful", default: "secondary" }[option.style];
}

/** A title never starts a line with a dash: the space before one does not break. */
export function unbreak(text: string): string {
  return text.replace(/ ([—–])/g, "\u00a0$1");
}

/** "14:02", in the agent's language. */
function clock(language: string, at: number): string {
  return new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }).format(at);
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/** The keys, named as the system names them: given as a tooltip, never written on the buttons. */
const KEYS = { stop: "Esc", go: isMac ? "⌘ Return" : "Ctrl+Enter" };

/** Where a request is shown: a card in a conversation, the narrow card of the side panel, or OS mode's sheet. */
export type RequestSurface = "card" | "panel" | "sheet";

interface RequestCardProps {
  /** The request as it is now: pending, then answered or cancelled. */
  request: RequestItem;
  surface?: RequestSurface;
  /** The job it comes from, when that is not the conversation on screen. */
  origin?: string;
  /** It came in while the view was open: it arrives in chunks rather than being simply there. */
  arrive?: boolean;
  /** This card answers to Esc and ⌘↩ (only the first one on screen does). */
  keys?: boolean;
}

/**
 * "Nova is asking" (docs/DESIGN.md, "The request"): who asks, the
 * question, what the agent sees, and the decision. Once answered — here or
 * anywhere else — it folds, in place, into the receipt it leaves in the
 * conversation for good.
 */
export function RequestCard({ request, surface = "card", origin, arrive = false, keys = false }: RequestCardProps) {
  const store = useStore();
  const t = useT();
  const language = useAppState((state) => state.node?.language ?? "en");
  /** Only a request that was pending here folds; one that was already answered is simply its receipt. */
  const [asked] = useState(() => request.state === "pending");
  const [shownAt] = useState(() => performance.now());
  /** The answer on its way: an option's id, or "" for the owner's own words. */
  const [sending, setSending] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useState(request.risk !== "high");
  const done = request.state !== "pending";
  const options = ordered(request);
  const chosen = done ? (request.resolution?.optionId ?? null) : sending;

  useEffect(() => {
    if (armed) return;
    const timer = setTimeout(() => setArmed(true), ARMING);
    return () => clearTimeout(timer);
  }, [armed]);

  useEffect(() => {
    if (sending === null || done) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW);
    return () => clearTimeout(timer);
  }, [sending, done]);

  const answer = async (optionId: string | null, text: string | null) => {
    if (done || sending !== null || performance.now() - shownAt < TOUCH_GUARD) return;
    if (optionId === APPROVE && !armed) return;
    setSending(optionId ?? "");
    setFailed(false);
    answeredHere.add(request.id);
    try {
      await store.resolve(request.id, optionId, text);
    } catch {
      answeredHere.delete(request.id);
      setFailed(true);
      setSending(null);
    }
  };

  // Esc says Stop; ⌘↩ says Go ahead, except at high risk. Not while typing
  // somewhere, and not while a picture is open on top.
  const latest = useRef(answer);
  latest.current = answer;
  useEffect(() => {
    if (!keys || done || request.kind !== "approval") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void latest.current(DENY, null);
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && request.risk !== "high") {
        event.preventDefault();
        void latest.current(APPROVE, null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, done, request.kind, request.risk]);

  const approval = request.kind === "approval";
  const shortcut = (option: RequestOption) =>
    keys && approval ? (option.id === DENY ? "stop" : request.risk !== "high" ? "go" : null) : null;
  const stack = options.length > 2;
  const size = surface === "sheet" ? "xl" : "lg";
  const status = slow ? t("sending") : failed ? t("sendFailed") : null;

  return (
    <section
      className="request"
      data-surface={surface}
      data-state={done ? request.state : "pending"}
      data-risk={request.risk}
      data-kind={request.kind}
      data-arrive={arrive || undefined}
      aria-label={t("asking")}
    >
      {asked && (
        <div className="request-fold" inert={done}>
          <div className="request-card">
            {request.screenshot && <Screenshot request={request} />}
            <div className="request-side">
            <header className="request-head">
              <Glyph state="waiting" />
              <span className="request-asking">{t("asking")}</span>
              <span className="request-when">{origin ?? clock(language, request.at)}</span>
            </header>
            <h2 className="request-question">{unbreak(request.title)}</h2>
            {!approval && request.body && (
              <p className="request-detail">
                {request.body}
              </p>
            )}
            {request.risk === "high" && (
              <p className="request-careful">
                <Icon name="alert" />
                {t("highRisk")}
              </p>
            )}
            {approval && request.body && <Details text={request.body} />}
            <div className="request-tray" data-stack={stack || undefined}>
              {options.map((option) => (
                <button
                  key={option.id}
                  className={`button ${size} in-card ${optionLook(request, option)}${stack ? " block" : ""}`}
                  data-chosen={chosen === option.id || undefined}
                  data-pending={(!done && sending === option.id) || undefined}
                  data-muted={(chosen !== null && chosen !== option.id) || undefined}
                  data-arming={(option.id === APPROVE && !armed) || undefined}
                  aria-disabled={(option.id === APPROVE && !armed) || undefined}
                  aria-label={`${optionLabel(t, request, option)}: ${request.title}`}
                  aria-keyshortcuts={{ stop: "Escape", go: "Meta+Enter", none: undefined }[shortcut(option) ?? "none"]}
                  title={shortcut(option) ? KEYS[shortcut(option)!] : undefined}
                  onClick={() => void answer(option.id, null)}
                >
                  {approval && option.id === DENY && <Icon name="hand" />}
                  {approval && option.id === APPROVE && <Icon name="check" />}
                  <span className="button-label">{optionLabel(t, request, option)}</span>
                </button>
              ))}
            </div>
            {surface === "sheet" && request.allowText && <Words onAnswer={(text) => void answer(null, text)} disabled={sending !== null} />}
            {status && (
              <p className="request-status" data-tone={failed && !slow ? "careful" : undefined} role="status">
                {status}
              </p>
            )}
            </div>
          </div>
        </div>
      )}
      {done && <Receipt request={request} />}
    </section>
  );
}

/** What Nova sees, at its own aspect ratio, with "Look closer" to open it full size. */
function Screenshot({ request }: { request: RequestItem }) {
  const t = useT();
  const url = useFileUrl(request.screenshot);
  const viewer = useRef<HTMLDialogElement>(null);
  const { width, height } = request.screenshot ?? {};
  return (
    <figure className="request-shot" style={{ aspectRatio: `${width ?? 16} / ${height ?? 10}` }}>
      {url && <img src={url} alt={t("whatAgentSees")} />}
      {url && (
        <button className="request-closer" onClick={() => viewer.current?.showModal()}>
          <Icon name="zoom" dense />
          {t("lookCloser")}
        </button>
      )}
      {/* As large as the window allows, at the picture's own proportions: never smaller than it was in the card. */}
      <dialog
        ref={viewer}
        className="viewer"
        aria-label={t("whatAgentSees")}
        style={{ "--ratio": (width ?? 16) / (height ?? 10) } as CSSProperties}
        onClick={() => viewer.current?.close()}
      >
        {url && <img src={url} alt={t("whatAgentSees")} />}
        <button className="icon-button filled viewer-close" aria-label={t("close")}>
          <Icon name="close" />
        </button>
      </dialog>
    </figure>
  );
}

/** The raw command or input, for whoever wants it: closed, it is one quiet line. */
function Details({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="request-details" data-open={open || undefined}>
      <button className="request-details-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("details")}
        <Icon name="chevronDown" dense />
      </button>
      <div className="request-details-body" inert={!open}>
        <div>
          <div className="request-code">
            <pre>{text}</pre>
            <button
              className="button sm quiet"
              onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
            >
              <span className="swap">
                <Icon name="copy" dense off={copied} />
                <Icon name="check" dense off={!copied} />
              </span>
              {t(copied ? "copied" : "copy")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** OS mode has no composer: an answer in words is typed here. */
function Words({ onAnswer, disabled }: { onAnswer: (text: string) => void; disabled: boolean }) {
  const t = useT();
  const [words, setWords] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (words.trim()) onAnswer(words.trim());
  };
  return (
    <form className="request-words" onSubmit={submit}>
      <input
        className="field"
        value={words}
        onChange={(event) => setWords(event.target.value)}
        placeholder={t("answerInWords")}
        aria-label={t("answerInWords")}
        disabled={disabled}
      />
      <button className="icon-button filled" disabled={disabled || !words.trim()} aria-label={t("send")}>
        <Icon name="send" />
      </button>
    </form>
  );
}

/** What a request leaves in the conversation: what was said, to what, when, and from where. */
function Receipt({ request }: { request: RequestItem }) {
  const t = useT();
  const language = useAppState((state) => state.node?.language ?? "en");
  const { resolution } = request;
  const option = request.options.find((other) => other.id === resolution?.optionId);
  const device = useDeviceName(answeredHere.has(request.id) ? null : (resolution?.deviceId ?? null));
  const cancelled = request.state === "cancelled";

  let mark: { icon: "check" | "hand" | "bubble" | "close"; tone?: string };
  let said: string;
  if (cancelled) {
    mark = { icon: "close" };
    said = t("noLongerNeeded");
  } else if (resolution?.text) {
    mark = { icon: "bubble" };
    said = t("youAnswered", { text: resolution.text });
  } else {
    mark = request.kind === "approval" && option?.id === DENY ? { icon: "hand" } : { icon: "check", tone: request.kind === "approval" ? "go" : undefined };
    said = t("youSaid", { answer: option ? optionLabel(t, request, option) : "" });
  }

  return (
    <div className="receipt">
      <span className="receipt-mark" data-tone={mark.tone}>
        <Icon name={mark.icon} dense />
      </span>
      <div className="receipt-text">
        <p className="receipt-said">{said}</p>
        <p className="receipt-what">{unbreak(request.title)}</p>
      </div>
      {/* When, and where from if not here: a caption beside it, never part of the question. */}
      <span className="receipt-when">
        {clock(language, resolution?.at ?? request.at)}
        {device && ` · ${device}`}
      </span>
    </div>
  );
}

/** The devices this computer knows, asked for once per connection and only when a receipt needs a name. */
const known = new WeakMap<Client, Promise<Device[]>>();

/** The name of the device an answer came from, once known; null for this computer itself. */
function useDeviceName(deviceId: string | null): string | null {
  const { client } = useStore();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    if (!known.has(client)) known.set(client, client.devices().catch(() => []));
    void known.get(client)!.then((devices) => live && setName(devices.find((device) => device.id === deviceId)?.name ?? null));
    return () => {
      live = false;
    };
  }, [client, deviceId]);
  return deviceId ? name : null;
}
