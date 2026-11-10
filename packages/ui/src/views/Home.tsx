import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MAIN_THREAD, type Thread } from "@agentos/protocol";
import { stageSize } from "@agentos/design";
import { useAppState, useStore, useT } from "../client/hooks";
import { navigate } from "../route";
import { useAgent } from "../ui/agent";
import { Composer } from "../ui/Composer";
import { Conversation } from "../ui/Conversation";
import { Glyph, Icon, type IconName } from "../ui/Icon";
import { LabelledPresence, Line } from "../ui/Presence";
import { clamp, timing, useSurface, useWindow } from "../ui/surface";
import "./Home.css";

const JOB_WORDS = { working: "jobWorking", waiting: "jobWaiting", error: "jobError", idle: "jobIdle" } as const;

/** The agent and its conversation. On a phone, this is the remote. */
export function Home() {
  useSurface("stage");
  const store = useStore();
  const t = useT();
  const agent = useAgent();
  const local = useAppState((state) => state.local);
  const computer = useAppState((state) => state.node?.name);
  const threads = useAppState((state) => state.threads);
  const asking = useAppState((state) => state.requests.length > 0);
  const [chosen, setChosen] = useState(MAIN_THREAD);
  /** On a phone, the conversation's sheet pulled up over the stage. */
  const [pulled, setPulled] = useState(false);
  const offline = agent.state === "offline";

  // The layout is decided here, once; Home.css only reads the answer.
  const { width, height } = useWindow();
  /** The conversation beside the presence: a window, or a phone held sideways. Otherwise below it. */
  const beside = width >= 900 || (width >= 600 && height <= 560);
  /** Too low for more than the presence and its line. */
  const low = height <= 640;
  /** Room to write the local entries out; otherwise they are round icon buttons. */
  const worded = beside && !low;
  /** Stacked, a request (or the sheet pulled up) needs the screen: the presence steps aside. */
  const aside = (asking || pulled) && !beside;
  const talk = clamp(400, width * 0.42, 560);
  const stage = aside
    ? stageSize("home-asking")
    : beside
      ? stageSize("home-beside", { width: width - talk, height })
      : stageSize("home", { width, height });

  // A job that was deleted while open hands back to the main conversation.
  const open = threads.find((thread) => thread.id === chosen) ?? null;
  const threadId = open?.id ?? MAIN_THREAD;
  const jobs = threads
    .filter((thread) => thread.kind === "job")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);

  return (
    <div
      className="home"
      data-layout={beside ? "beside" : "stacked"}
      data-low={low || undefined}
      data-aside={aside || undefined}
      data-asking={asking || undefined}
      style={{ "--talk": `${talk}px`, "--stage": `${stage}px` } as CSSProperties}
    >
      <p className="home-computer">
        <Glyph state={agent.state === "offline" ? "offline" : "idle"} />
        <span>{computer}</span>
      </p>
      {local && (
        <nav className="home-actions">
          <Entry icon="screen" label={t("giveScreen")} worded={worded} disabled={offline ? agent.line : undefined} onClick={() => void store.setMode("os")} />
          <Entry icon="settings" label={t("settings")} worded={worded} onClick={() => navigate("settings")} />
        </nav>
      )}

      <section className="home-presence">
        <div className="home-figure">
          <div className="stage-light" data-state={agent.state} aria-hidden />
          <LabelledPresence name={agent.name} size={stage} state={agent.state} pulse={agent.pulse} large={worded}>
            {/* Stepped aside, the presence says nothing: the question is on screen. */}
            {!aside && <Line className="home-line" text={agent.line} />}
            {!aside && <Doing text={agent.doing} />}
          </LabelledPresence>
        </div>
        {offline && (
          <button className="button secondary home-retry" onClick={() => location.reload()}>
            {t("tryAgain")}
          </button>
        )}
        {jobs.length > 0 && !offline && (
          <ul className="jobs" aria-label={t("background")}>
            {jobs.map((job) => (
              <li key={job.id}>
                <Job job={job} open={job.id === threadId} onOpen={() => setChosen(job.id === threadId ? MAIN_THREAD : job.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="home-talk">
        {!beside && <Grabber pulled={pulled} onChange={setPulled} />}
        {open?.kind === "job" && (
          <header className="talk-head">
            <button className="icon-button" onClick={() => setChosen(MAIN_THREAD)} aria-label={t("backToConversation")}>
              <Icon name="back" />
            </button>
            <span>{open.title}</span>
          </header>
        )}
        <Conversation threadId={threadId} />
        <Composer threadId={threadId} />
      </section>
    </div>
  );
}

/**
 * A way to somewhere that only exists on the computer itself: an icon and
 * its words, or a round icon button with a name. `disabled` is why it cannot
 * be used right now.
 */
function Entry({ icon, label, worded, disabled, onClick }: { icon: IconName; label: string; worded: boolean; disabled?: string; onClick: () => void }) {
  return worded ? (
    <button className="button sm quiet" disabled={disabled !== undefined} title={disabled} onClick={onClick}>
      <Icon name={icon} />
      {label}
    </button>
  ) : (
    <button className="icon-button" disabled={disabled !== undefined} onClick={onClick} aria-label={label} title={disabled ?? label}>
      <Icon name={icon} />
    </button>
  );
}

/** What the agent is doing, in a few words under its line: it changes quietly, and is not announced (the line is). */
export function Doing({ text }: { text: string | null }) {
  return (
    <div className="doing">
      <AnimatePresence mode="wait" initial={false}>
        {text && (
          <motion.p key={text} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: timing("base") }} exit={{ opacity: 0, transition: timing("fast", "in") }}>
            {text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The handle of the conversation's sheet on a phone: press it, or drag it, to pull the sheet up or let it down. */
function Grabber({ pulled, onChange }: { pulled: boolean; onChange: (pulled: boolean) => void }) {
  const t = useT();
  const from = useRef<number | null>(null);
  const dragged = useRef(false);
  const up = (event: PointerEvent) => {
    const moved = from.current === null ? 0 : event.clientY - from.current;
    from.current = null;
    // A drag says which way; a press (or Enter) toggles.
    dragged.current = Math.abs(moved) > 16;
    if (dragged.current) onChange(moved < 0);
  };
  return (
    <button
      className="grabber"
      aria-expanded={pulled}
      aria-label={pulled ? t("showAgent") : t("showConversation")}
      onPointerDown={(event) => (from.current = event.clientY)}
      onPointerUp={up}
      onClick={() => (dragged.current ? (dragged.current = false) : onChange(!pulled))}
    >
      <span />
    </button>
  );
}

/** A background job as a chip: its mark, its name and how it is going. Pressing it opens its conversation. */
function Job({ job, open, onOpen }: { job: Thread; open: boolean; onOpen: () => void }) {
  const t = useT();
  const look = { working: "working", waiting: "waiting", error: "", idle: "" }[job.state];
  return (
    <button className={`chip job ${look}`} data-state={job.state} aria-pressed={open} onClick={onOpen}>
      {job.state === "working" && <span className="dot" />}
      {job.state === "waiting" && <Glyph state="waiting" />}
      {job.state === "idle" && (
        <span className="job-mark" data-tone="go">
          <Icon name="check" dense />
        </span>
      )}
      {job.state === "error" && (
        <span className="job-mark" data-tone="careful">
          <Icon name="alert" dense />
        </span>
      )}
      <span className="job-title">{job.title}</span>
      <span className="chip-status">{job.state === "working" && job.preview ? job.preview : t(JOB_WORDS[job.state])}</span>
    </button>
  );
}
