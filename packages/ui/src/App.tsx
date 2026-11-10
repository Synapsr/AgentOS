// First, so that every component's own styles come after the tokens and primitives.
import "./base.css";
import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { stageSize } from "@agentos/design";
import { StoreProvider, useAppState, useT } from "./client/hooks";
import type { Store } from "./client/store";
import { useView } from "./route";
import { useDocumentTitle } from "./ui/agent";
import { LabelledPresence, Line } from "./ui/Presence";
import { useSurface, useWindow } from "./ui/surface";
import { AddYourPhone } from "./views/AddYourPhone";
import { Home } from "./views/Home";
import { Onboarding } from "./views/Onboarding";
import { OsMode } from "./views/OsMode";
import { Panel } from "./views/Panel";
import { Settings } from "./views/Settings";

interface AppProps {
  store: Store;
  /** Called when the computer refuses the token this page talks to it with. */
  onRefused?: () => void;
}

/** The whole interface, connected to one computer through `store`. */
export function App({ store, onRefused }: AppProps) {
  useEffect(() => store.start(), [store]);
  return (
    <StoreProvider value={store}>
      <MotionConfig reducedMotion="user">
        <Screen onRefused={onRefused} />
      </MotionConfig>
    </StoreProvider>
  );
}

/** Picks what to show from the address, and from what the computer says about itself. */
function Screen({ onRefused }: Pick<AppProps, "onRefused">) {
  const requested = useView();
  const phase = useAppState((state) => state.phase);
  const local = useAppState((state) => state.local);
  const onboarded = useAppState((state) => state.node?.onboarded);
  const mode = useAppState((state) => state.status?.mode);
  useDocumentTitle();

  let view = requested;
  // Onboarding, Settings and "Add your phone" exist only on the computer itself.
  if (local && (view === "onboarding" || (view !== "os" && view !== "panel" && !onboarded))) view = "onboarding";
  else if (!local && (view === "onboarding" || view === "settings" || view === "add-phone")) view = "home";
  // In a plain browser no shell swaps windows: the page follows the mode.
  if (view === "home" && local && mode === "os") view = "os";

  useEffect(() => {
    if (phase === "unpaired") onRefused?.();
  }, [phase, onRefused]);

  if (phase !== "ready") return <Connecting />;
  if (view === "onboarding") return <Onboarding />;
  if (view === "settings") return <Settings />;
  if (view === "add-phone") return <AddYourPhone />;
  if (view === "panel") return <Panel />;
  if (view === "os") return <OsMode />;
  return <Home />;
}

/**
 * Before the first answer from the computer: the presence asleep on the
 * stage the home will use, and, after a while, why and what to do.
 */
function Connecting() {
  useSurface("stage");
  const t = useT();
  const stage = stageSize("home", useWindow());
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="connecting">
      <LabelledPresence name="" size={stage} state="offline">
        <Line className="connecting-line" text={slow ? t("offlineCause", { computer: t("yourComputer") }) : ""} />
      </LabelledPresence>
      {slow && (
        <button className="button secondary arrive" onClick={() => location.reload()}>
          {t("tryAgain")}
        </button>
      )}
    </main>
  );
}
