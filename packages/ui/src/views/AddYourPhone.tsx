import { useState, type CSSProperties } from "react";
import { stageSize } from "@agentos/design";
import { useAppState, useT } from "../client/hooks";
import { canGoBack, navigate } from "../route";
import { AddPhone } from "../ui/AddPhone";
import { Icon } from "../ui/Icon";
import { LabelledPresence } from "../ui/Presence";
import { useSurface } from "../ui/surface";
import "./Setup.css";

/**
 * "Add your phone", on its own (`/add-phone`): the presence, the code to
 * scan and one sentence. Settings leads here, and so does the desktop app's
 * menu; opened directly, its way back leads home.
 */
export function AddYourPhone() {
  useSurface("stage");
  const t = useT();
  const agent = useAppState((state) => state.node?.agent.name ?? "");
  const [added, setAdded] = useState(false);
  // Small: the code is what matters here, the presence only says who is waiting for the phone.
  const stage = stageSize("home-asking");
  const leave = () => (canGoBack() ? history.back() : navigate("home"));
  return (
    <main className="setup">
      <div className="setup-top">
        <button className="icon-button setup-back" aria-label={t("back")} onClick={leave}>
          <Icon name="back" />
        </button>
      </div>
      <div className="setup-main">
        <div className="setup-figure" style={{ "--stage": `${stage}px` } as CSSProperties}>
          <LabelledPresence name={agent} size={stage} state="idle" pulse={added ? { kind: "approved", id: "added" } : undefined}>
            <div className="setup-step">
              <h1 className="setup-title arrive">{t("phoneTitle")}</h1>
              <p className="setup-help arrive" style={{ "--i": 1 } as CSSProperties}>
                {t("phoneHelp")}
              </p>
              <div className="setup-body arrive" style={{ "--i": 2 } as CSSProperties}>
                <AddPhone onAdded={() => setAdded(true)} />
              </div>
              {added && (
                <div className="setup-actions arrive">
                  <button className="button primary lg" autoFocus onClick={leave}>
                    {t("done")}
                  </button>
                </div>
              )}
            </div>
          </LabelledPresence>
        </div>
      </div>
    </main>
  );
}
