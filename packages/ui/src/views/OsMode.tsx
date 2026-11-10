import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { stageSize } from "@agentos/design";
import { useAppState, useStore, useT } from "../client/hooks";
import { useAgent } from "../ui/agent";
import { Icon } from "../ui/Icon";
import { LabelledPresence, Line } from "../ui/Presence";
import { RequestCard } from "../ui/RequestCard";
import { choreographies, useSurface, useWindow } from "../ui/surface";
import { Doing } from "./Home";
import "./OsMode.css";

/** How long the pointer stays visible after it last moved. */
const POINTER_REST = 2500;

/**
 * The screen belongs to the agent: its stage, always dark, the presence
 * large, its name and its line. When it needs its owner, the presence rises
 * and the decision comes up under it as a sheet, with what it sees.
 */
export function OsMode() {
  useSurface("presence");
  const store = useStore();
  const t = useT();
  const agent = useAgent();
  const request = useAppState((state) => state.requests[0]);
  // With a question to show under it, the stage gives most of its height back.
  const stage = stageSize(request ? "os-asking" : "os", useWindow());
  const [awake, setAwake] = useState(false);
  const asking = request !== undefined;

  useEffect(() => {
    let rest = 0;
    const stir = () => {
      setAwake(true);
      clearTimeout(rest);
      rest = window.setTimeout(() => setAwake(false), POINTER_REST);
    };
    // While a request is on screen, Esc belongs to it (it says Stop).
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !asking && !event.defaultPrevented) void store.setMode("desktop");
    };
    window.addEventListener("pointermove", stir);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(rest);
      window.removeEventListener("pointermove", stir);
      window.removeEventListener("keydown", onKey);
    };
  }, [store, asking]);

  return (
    <main className="os" data-awake={awake || undefined} data-asking={asking || undefined} style={{ "--stage": `${stage}px` } as CSSProperties}>
      <div className="os-figure">
        <div className="stage-light" data-state={agent.state} aria-hidden />
        <LabelledPresence name={agent.name} size={stage} state={agent.state} pulse={agent.pulse} large>
          {!asking && <Line className="os-line" text={agent.line} />}
          {!asking && <Doing text={agent.doing} />}
        </LabelledPresence>
      </div>
      <AnimatePresence>
        {request && (
          <motion.div key={request.id} className="os-request" variants={choreographies.chunk} initial="hidden" animate="shown" exit="gone">
            <RequestCard request={request} surface="sheet" arrive keys />
            {request.kind === "approval" && <p className="os-hint">{t("orJustSay")}</p>}
          </motion.div>
        )}
      </AnimatePresence>
      <button className="button sm secondary glass os-back" title="Esc" aria-keyshortcuts={asking ? undefined : "Escape"} onClick={() => void store.setMode("desktop")}>
        <Icon name="back" />
        {t("takeBack")}
      </button>
    </main>
  );
}
