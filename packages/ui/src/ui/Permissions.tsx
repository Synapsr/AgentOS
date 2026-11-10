import { useEffect, useRef } from "react";
import { useAppState, useStore, useT } from "../client/hooks";
import { Icon } from "./Icon";
import "./Permissions.css";

const RECHECK_EVERY = 2000;

const ROWS = [
  { permission: "screenRecording", label: "permScreen", icon: "screen" },
  { permission: "accessibility", label: "permControl", icon: "hand" },
] as const;

/**
 * What the computer must allow for the agent to see and use it: one row,
 * one button each. The answer is given in the system's own dialog, so the
 * state is simply read again every couple of seconds.
 */
export function Permissions({ keyboard = false }: { keyboard?: boolean }) {
  const store = useStore();
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  const granted = useAppState((state) => state.settings?.computer.permissions);
  const complete = granted?.accessibility && granted.screenRecording;
  const missing = ROWS.find(({ permission }) => !granted?.[permission])?.permission;

  // With `keyboard`, Enter always has a button to press: the first one at
  // the start, then the next when a permission is granted and its own goes.
  useEffect(() => {
    if (keyboard && (document.activeElement === document.body || !document.activeElement?.isConnected)) list.current?.querySelector("button")?.focus();
  }, [keyboard, missing]);

  useEffect(() => {
    if (complete) return;
    const timer = setInterval(() => void store.refreshSettings().catch(() => {}), RECHECK_EVERY);
    return () => clearInterval(timer);
  }, [store, complete]);

  const ask = async () => {
    await store.client.requestPermissions().catch(() => {});
    await store.refreshSettings().catch(() => {});
  };

  return (
    <div className="permissions" ref={list}>
      {ROWS.map(({ permission, label, icon }) => (
        <div key={permission} className="row permission">
          <span className="tile">
            <Icon name={icon} />
          </span>
          <span className="row-title">{t(label)}</span>
          {granted?.[permission] ? (
            <span className="permission-allowed">
              <Icon name="check" dense />
              {t("allowed")}
            </span>
          ) : (
            <button type="button" className="button sm secondary" onClick={() => void ask()}>
              {t("allow")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
