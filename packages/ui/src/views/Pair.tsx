import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { HelloResponse } from "@agentos/protocol";
import { stageSize } from "@agentos/design";
import { failureCode } from "../client/client";
import { useT } from "../client/hooks";
import { hello } from "../client/http";
import { pairThisDevice } from "../client/token";
import { apiBase } from "../route";
import { LabelledPresence } from "../ui/Presence";
import { useSurface, useWindow } from "../ui/surface";
import "./Setup.css";

/** "Add this device": what a browser shows before it is allowed to talk to the computer. */
export function Pair() {
  useSurface("stage");
  const t = useT();
  const stage = stageSize("onboarding", useWindow());
  const [computer, setComputer] = useState<HelloResponse | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"pairWrong" | "lineOffline" | null>(null);

  useEffect(() => {
    void hello(apiBase).then(setComputer);
  }, []);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      await pairThisDevice(apiBase, code);
      // Start again, this time with a token.
      location.reload();
    } catch (error) {
      setProblem(failureCode(error) === "network" ? "lineOffline" : "pairWrong");
      setBusy(false);
    }
  };

  const state = busy ? "working" : problem === "lineOffline" ? "offline" : "idle";
  return (
    <main className="setup" style={{ "--stage": `${stage}px` } as CSSProperties}>
      <div className="setup-top" />
      <div className="setup-main">
        <div className="setup-figure">
          <div className="stage-light" data-state={state} aria-hidden />
          <LabelledPresence name={computer?.node.agentName ?? ""} size={stage} state={state}>
            <form className="setup-step setup-stage" onSubmit={add}>
              <h1 className="setup-title arrive">{t("pairTitle")}</h1>
              <p className="setup-help arrive" style={{ "--i": 1 } as CSSProperties}>
                {t("pairHelp")}
              </p>
              <div className="setup-body arrive" style={{ "--i": 2 } as CSSProperties}>
                <label className="field-label">
                  {t("pairLabel")}
                  <input
                    className="field"
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    aria-invalid={problem !== null}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  {problem && <span className="field-error">{t(problem)}</span>}
                </label>
              </div>
              <div className="setup-actions arrive" style={{ "--i": 3 } as CSSProperties}>
                <button className="button primary lg" aria-disabled={busy || undefined}>
                  {t("pairAction")}
                </button>
              </div>
            </form>
          </LabelledPresence>
        </div>
      </div>
    </main>
  );
}
