/**
 * Turns backend failures into one or two sentences that tell the model what
 * to do next. The backend's own wording is kept only where it carries a fact
 * the model needs.
 */
import { BackendError, type ErrorCode } from "./backend.js";

const SNAPSHOT_AGAIN = "The screen changed since that snapshot. Take a new snapshot and use a ref from it.";

const ADVICE: Record<ErrorCode, (error: BackendError) => string> = {
  STALE_REF: (error) =>
    error.details.process_state === "exited"
      ? "That app is no longer running. Open it again with computer_open_app, then take a new snapshot."
      : SNAPSHOT_AGAIN,
  SNAPSHOT_NOT_FOUND: () => SNAPSHOT_AGAIN,
  ELEMENT_NOT_FOUND: () => SNAPSHOT_AGAIN,
  AMBIGUOUS_TARGET: (error) =>
    typeof error.details.kind === "string" && /ref|identity/.test(error.details.kind)
      ? "Several identical elements match this ref, so it cannot be used safely. Take a new snapshot and act on an element that is unique."
      : "More than one window matches. Call computer_list_apps and pass the window_id you mean.",
  APP_NOT_FOUND: () => "No running app has that name. Call computer_list_apps to see what is open, or computer_open_app to start it.",
  WINDOW_NOT_FOUND: () =>
    "That app has no window that can be read right now: it may still be starting, or its window is minimized or on another desktop. " +
    "Call computer_open_app to bring it to the front, then try again.",
  ACTION_NOT_SUPPORTED: (error) =>
    failedCheck(error)
      ? `This element cannot do that${failedCheck(error)}. Pick another element from a new snapshot.`
      : `That cannot be done here: ${error.message}`,
  ACTION_FAILED: (error) => {
    if (error.details.kind === "keyboard_layout") {
      return "That key cannot be sent reliably on this computer's keyboard layout, so nothing was pressed. Use the app's menu instead: computer_snapshot with surface \"menubar\", then click the item. For text, use computer_type.";
    }
    if (error.details.kind === "app_not_in_front") {
      return "Apps only obey shortcuts while they are in front, and this one is in the background, so nothing was pressed. Bring it to the front with computer_open_app, then press again.";
    }
    return `It did not work${failedCheck(error) || `: ${error.message}`}. Take a new snapshot to see the current state before trying something else.`;
  },
  POLICY_DENIED: (error) =>
    failedCheck(error)
      ? `This element cannot do that the way it was asked${failedCheck(error)}. Pick another element or another tool.`
      : "That shortcut is blocked for safety. To quit an app, use computer_close_app.",
  APP_UNRESPONSIVE: () => "The app did not answer.",
  TIMEOUT: (error) =>
    error.details.kind === "wait_timeout"
      ? "It did not happen in time. Take a snapshot to see what is on screen now."
      : "The computer took too long to answer.",
  PERM_DENIED: (error) =>
    /screen recording/i.test(error.message)
      ? "The Screen Recording permission is missing, so no picture can be taken. Reading the screen with computer_snapshot still works. Ask the owner to grant it on the computer."
      : "The Accessibility permission is missing, so the screen can be neither read nor controlled. Ask the owner to grant it on the computer.",
  INVALID_ARGS: (error) =>
    /ref/i.test(error.message)
      ? "That is not a valid ref. Refs look like @s8f3k2p9:e12 and come from computer_snapshot: copy one exactly."
      : `Invalid request: ${error.message}`,
  PLATFORM_NOT_SUPPORTED: () => "This is not supported on this operating system.",
  INTERNAL: (error) => `Computer control failed: ${error.message}`,
};

/** The first readiness check the element failed, e.g. " (role button is not editable)". */
function failedCheck(error: BackendError): string {
  const checks = Array.isArray(error.details.checks) ? (error.details.checks as { status?: string; reason?: string }[]) : [];
  const reason = checks.find((check) => check.status === "fail" && check.reason)?.reason;
  return reason ? ` (${reason})` : "";
}

/**
 * Explains a failure to the model. `acted` says the call was meant to change
 * something: when the backend cannot rule out that it did, the model is told
 * to look before repeating it.
 */
export function explain(error: unknown, acted = false): string {
  if (!(error instanceof BackendError)) return `Computer control failed: ${error instanceof Error ? error.message : String(error)}`;
  const advice = (ADVICE[error.code] ?? ADVICE.INTERNAL)(error);
  return acted && !error.retrySafe ? `${advice} It may have gone through anyway: take a new snapshot to check before repeating it.` : advice;
}
