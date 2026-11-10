import type { CSSProperties } from "react";
import { MAIN_THREAD } from "@agentos/protocol";
import { stageSize } from "@agentos/design";
import { useAppState, useT } from "../client/hooks";
import { useAgent } from "../ui/agent";
import { Composer } from "../ui/Composer";
import { Conversation } from "../ui/Conversation";
import { Line, Presence } from "../ui/Presence";
import { useSurface } from "../ui/surface";
import { Doing } from "./Home";
import "./Panel.css";

/** A narrow column at the screen edge, for people who keep using their computer. */
export function Panel() {
  useSurface("stage");
  const t = useT();
  const agent = useAgent();
  const asking = useAppState((state) => state.requests.length > 0);
  // While asking, the request below says everything: the header shrinks to the presence and one short line.
  const size = stageSize(asking ? "panel-asking" : "panel");
  return (
    <div className="panel" data-asking={asking || undefined}>
      <header className="panel-head">
        <div className="panel-figure" style={{ "--stage": `${size}px` } as CSSProperties}>
          <div className="stage-light" data-state={agent.state} aria-hidden />
          <Presence size={size} state={agent.state} pulse={agent.pulse} />
        </div>
        <div className="panel-who">
          <p className="panel-name">{agent.name}</p>
          <Line className="panel-line" text={asking ? t("waitingForYou") : agent.line} />
          <Doing text={asking ? null : agent.doing} />
        </div>
      </header>
      <Conversation threadId={MAIN_THREAD} surface="panel" />
      <Composer threadId={MAIN_THREAD} compact />
    </div>
  );
}
