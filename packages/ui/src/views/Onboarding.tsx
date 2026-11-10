import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Autonomy } from "@agentos/protocol";
import { stageSize } from "@agentos/design";
import { useAppState, useStore, useT } from "../client/hooks";
import { engineName } from "../i18n";
import { navigate } from "../route";
import { AddPhone } from "../ui/AddPhone";
import { AutonomyChoice } from "../ui/AutonomyChoice";
import { Icon } from "../ui/Icon";
import { Permissions } from "../ui/Permissions";
import { CLAUDE_KEYS, ownAccountNote } from "../ui/agent";
import { LabelledPresence } from "../ui/Presence";
import { choreographies, spring, useSurface, useWindow } from "../ui/surface";
import "./Setup.css";

type StepId = "hello" | "you" | "agent" | "autonomy" | "brain" | "computer" | "phone";

/** The smallest the presence becomes to make room for a step: as large as when it steps aside on a phone. */
const MIN_STAGE = stageSize("home-asking");

/** Saves what a step decided (if anything), then moves on. */
type Advance = (save?: () => Promise<unknown>) => void;

/** The first run: one question per screen, Enter to move on. */
export function Onboarding() {
  useSurface("stage");
  const store = useStore();
  const t = useT();
  const agent = useAppState((state) => state.node?.agent.name);
  // The computer step only exists if something is missing as we start.
  const [steps] = useState<StepId[]>(() => {
    const granted = store.getState().settings?.computer.permissions;
    const complete = !granted || (granted.accessibility && granted.screenRecording);
    return ["hello", "you", "agent", "autonomy", "brain", ...(complete ? [] : ["computer" as const]), "phone"];
  });
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState(0);
  const quiet = useRef(0);
  const box = useWindow();
  const step = steps[index] ?? "phone";
  // The first moment is the presence, large, saying hello; then it settles above the questions.
  const base = stageSize(step === "hello" ? "os" : "onboarding", box);
  // Every step must fit the window with its way forward in view: when one is
  // too tall (a QR code, three choices on a small screen), the presence gives
  // up some of its size — never the words or the code.
  const page = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const stage = Math.min(base, Math.max(MIN_STAGE, fit ?? base));
  const used = useRef(stage);
  used.current = stage;
  useLayoutEffect(() => {
    const el = page.current;
    if (!el) return;
    const measure = () => {
      const top = el.querySelector<HTMLElement>(".setup-top");
      const main = el.querySelector<HTMLElement>(".setup-main");
      if (!top || !main || !main.querySelector(".setup-step")) return;
      // The page's own height, not the window's: `.setup` is at least as tall as the window.
      const need = top.offsetHeight + main.offsetHeight + parseFloat(getComputedStyle(el).paddingBottom);
      const slack = window.innerHeight - need;
      const next = Math.round(used.current + slack);
      setFit((current) => (current !== null && Math.abs(current - next) < 4 ? current : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  /** The questions, counted without the hello. */
  const questions = steps.slice(1);

  const go = (to: number) => {
    setFailed(false);
    setIndex(to);
  };
  const advance: Advance = async (save) => {
    setBusy(true);
    try {
      await save?.();
      if (index + 1 < steps.length) return go(index + 1);
      await store.updateNode({ onboarded: true });
      navigate("home");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  /** The presence hears each keystroke. */
  const hear = () => {
    setLevel(0.8);
    clearTimeout(quiet.current);
    quiet.current = window.setTimeout(() => setLevel(0), 160);
  };

  const typing = step === "you" || step === "agent";
  const state = busy ? "working" : typing ? "listening" : "idle";
  return (
    <main className="setup" ref={page}>
      <div className="setup-top">
        {index > 0 && (
          <button className="icon-button setup-back" aria-label={t("back")} disabled={busy} onClick={() => go(index - 1)}>
            <Icon name="back" />
          </button>
        )}
        {index > 0 && (
          <ol className="setup-progress" aria-label={`${index} / ${questions.length}`}>
            {questions.map((id, i) => (
              <li key={id} data-state={i < index - 1 ? "done" : i === index - 1 ? "current" : undefined} />
            ))}
          </ol>
        )}
      </div>
      <div className="setup-main">
        {/* Centred in the window: when a step is taller or shorter, the whole figure moves, on the layout spring. */}
        <motion.div className="setup-figure" layout="position" transition={{ layout: spring("layout") }} style={{ "--stage": `${stage}px` } as CSSProperties}>
          <div className="stage-light" data-state={state} aria-hidden />
          <LabelledPresence name={index > 2 ? (agent ?? "") : ""} size={stage} state={state} level={level}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={step} className="setup-stage" variants={choreographies.stagger} initial="hidden" animate="shown" exit="gone">
                {step === "hello" && <Frame title={t("hello")} busy={busy} ready onSubmit={() => advance()} large />}
                {typing && <NameStep kind={step} advance={advance} busy={busy} hear={hear} />}
                {step === "autonomy" && <AutonomyStep advance={advance} busy={busy} />}
                {step === "brain" && <BrainStep advance={advance} busy={busy} />}
                {step === "computer" && <ComputerStep advance={advance} busy={busy} />}
                {step === "phone" && <PhoneStep advance={advance} busy={busy} />}
                {/* The brain step says in its own words what went wrong with a key. */}
                {failed && step !== "brain" && <p className="field-error">{t("saveFailed")}</p>}
              </motion.div>
            </AnimatePresence>
          </LabelledPresence>
        </motion.div>
      </div>
    </main>
  );
}

interface StepProps {
  advance: Advance;
  busy: boolean;
}

interface FrameProps {
  title: string;
  help?: string;
  /** The opening hello: the title is the presence's own line, larger. */
  large?: boolean;
  children?: ReactNode;
  busy: boolean;
  /** Whether the step can be completed as it stands. */
  ready: boolean;
  /** What is missing, said when Continue is pressed before the step is ready. */
  missing?: string;
  onSubmit: () => void;
  /** Present when the step may be left for later. */
  onSkip?: () => void;
}

/**
 * One question: its title, a sentence, the answer, and one way forward.
 * Continue is never a grey, dead button: pressed too early, it says what is
 * missing. A step that can wait offers a quiet "Later" under it.
 */
function Frame({ title, help, large, children, busy, ready, missing, onSubmit, onSkip }: FrameProps) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (ready) setTried(false);
  }, [ready]);

  // Enter must always do something: with no field to type in, the keyboard
  // sits on the button.
  useEffect(() => {
    const el = form.current;
    if (!el || el.querySelector("input, .permissions button")) return;
    el.querySelector<HTMLElement>(".setup-continue")?.focus({ preventScroll: true });
  }, [ready]);

  return (
    <form
      ref={form}
      className="setup-step"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (ready) onSubmit();
        else setTried(true);
      }}
    >
      <motion.h1 className="setup-title" data-large={large || undefined} variants={choreographies.chunk}>
        {title}
      </motion.h1>
      {help && (
        <motion.p className="setup-help" variants={choreographies.chunk}>
          {help}
        </motion.p>
      )}
      {children && (
        <motion.div className="setup-body" variants={choreographies.chunk}>
          {children}
        </motion.div>
      )}
      <motion.div className="setup-actions" variants={choreographies.chunk}>
        <button className="button primary lg setup-continue" aria-disabled={busy || undefined}>
          {t("continue")}
        </button>
        {tried && !ready && missing && (
          <p className="field-error" role="status">
            {missing}
          </p>
        )}
        {onSkip && !ready && (
          <button type="button" className="button quiet" disabled={busy} onClick={onSkip}>
            {t("later")}
          </button>
        )}
      </motion.div>
    </form>
  );
}

function NameStep({ kind, advance, busy, hear }: StepProps & { kind: "you" | "agent"; hear: () => void }) {
  const store = useStore();
  const t = useT();
  const [name, setName] = useState(() => {
    const node = store.getState().node;
    return (kind === "you" ? node?.owner.name : node?.agent.name) ?? "";
  });
  const title = t(kind === "you" ? "youTitle" : "agentTitle");
  return (
    <Frame
      title={title}
      help={t(kind === "you" ? "youHelp" : "agentHelp")}
      busy={busy}
      ready={name.trim() !== ""}
      missing={t(kind === "you" ? "typeNameFirst" : "typeAgentNameFirst")}
      onSubmit={() => advance(() => store.updateNode(kind === "you" ? { ownerName: name.trim() } : { agentName: name.trim() }))}
    >
      <input
        className="field setup-name"
        autoFocus
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          hear();
        }}
        onFocus={(event) => event.target.select()}
        placeholder={kind === "you" ? t("youPlaceholder") : undefined}
        aria-label={title}
        maxLength={kind === "you" ? 80 : 40}
        autoComplete={kind === "you" ? "given-name" : "off"}
        autoCapitalize="words"
        spellCheck={false}
      />
    </Frame>
  );
}

function AutonomyStep({ advance, busy }: StepProps) {
  const store = useStore();
  const t = useT();
  const [autonomy, setAutonomy] = useState<Autonomy>(() => store.getState().node?.autonomy ?? "balanced");
  return (
    <Frame title={t("autonomyTitle")} help={t("autonomyHelp")} busy={busy} ready onSubmit={() => advance(() => store.updateNode({ autonomy }))}>
      <AutonomyChoice value={autonomy} onChange={setAutonomy} autoFocus />
    </Frame>
  );
}

function BrainStep({ advance, busy }: StepProps) {
  const store = useStore();
  const t = useT();
  // Decided once: the step must not change its face while it leaves.
  const [engine] = useState(() => store.getState().settings?.engine);
  const [key, setKey] = useState("");
  /** Null until the owner asks for the field: only some keys need a workspace id. */
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const name = engineName(engine?.provider ?? "");

  if (engine?.ready) {
    // The level chosen on the step before decides how the second sentence reads.
    const account = ownAccountNote(t, engine, store.getState().node?.autonomy ?? "balanced");
    return <Frame title={t("brainReadyTitle")} help={account ?? t("brainReadyHelp", { engine: name })} busy={busy} ready onSubmit={() => advance()} />;
  }
  const save = async () => {
    setRejected(false);
    const workspaceId = workspace?.trim() || undefined;
    const settings = await store.updateSettings({ engine: { apiKey: key.trim(), workspaceId } }).catch(() => null);
    if (settings?.engine.ready) return;
    setRejected(true);
    throw new Error("The key was not accepted.");
  };
  return (
    <Frame
      title={t("brainTitle")}
      help={engine?.provider === "claude" ? t("brainHelpClaude") : t("brainHelp", { engine: name })}
      busy={busy}
      ready={key.trim() !== ""}
      missing={t("pasteKeyFirst")}
      onSubmit={() => advance(save)}
      onSkip={() => advance()}
    >
      {engine?.provider === "claude" && <GetKey />}
      <label className="field-label">
        {t("key")}
        <input
          className="field"
          type="password"
          autoFocus
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={t("keyPlaceholder")}
          aria-invalid={rejected}
          autoComplete="off"
          spellCheck={false}
        />
        {rejected && <span className="field-error">{t("keyRejected")}</span>}
      </label>
      {workspace === null ? (
        <button type="button" className="link" onClick={() => setWorkspace("")}>
          {t("workspaceAdd")}
        </button>
      ) : (
        <>
          <label className="field-label">
            {t("workspaceId")}
            <input
              className="field"
              autoFocus
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder={t("workspacePlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="setup-note">{t("workspaceHelp")}</p>
        </>
      )}
    </Frame>
  );
}

/** How to get a Claude key, in three short steps and one button that opens the right page in the browser. */
export function GetKey() {
  const t = useT();
  return (
    <div className="get-key">
      <ol className="key-steps">
        {(["keyStep1", "keyStep2", "keyStep3"] as const).map((step, i) => (
          <li key={step}>
            <span className="key-step-n">{i + 1}</span>
            {t(step)}
          </li>
        ))}
      </ol>
      <a className="button secondary" href={CLAUDE_KEYS} target="_blank" rel="noreferrer">
        {t("getKey")}
        <Icon name="chevron" dense />
      </a>
    </div>
  );
}

function ComputerStep({ advance, busy }: StepProps) {
  const t = useT();
  const granted = useAppState((state) => state.settings?.computer.permissions);
  const complete = Boolean(granted?.accessibility && granted.screenRecording);
  return (
    <Frame
      title={t("computerTitle")}
      help={t("computerHelp")}
      busy={busy}
      ready={complete}
      missing={t("allowFirst")}
      onSubmit={() => advance()}
      onSkip={() => advance()}
    >
      <div className="group setup-group">
        <Permissions keyboard />
      </div>
    </Frame>
  );
}

function PhoneStep({ advance, busy }: StepProps) {
  const t = useT();
  const [added, setAdded] = useState(false);
  return (
    <Frame
      title={t("phoneTitle")}
      help={t("phoneHelp")}
      busy={busy}
      ready={added}
      missing={t("scanFirst")}
      onSubmit={() => advance()}
      onSkip={() => advance()}
    >
      <AddPhone onAdded={() => setAdded(true)} />
    </Frame>
  );
}
