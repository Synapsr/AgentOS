import { describe, expect, it } from "vitest";
import { BackendError } from "../src/backend.js";
import { explain } from "../src/messages.js";
import { failure } from "./fixtures.js";

describe("explain", () => {
  it("tells the model to snapshot again when a ref is out of date", () => {
    const expected = "The screen changed since that snapshot. Take a new snapshot and use a ref from it.";
    expect(explain(failure("error-snapshot-not-found"))).toBe(expected);
    expect(explain(new BackendError("STALE_REF", "@s1:e7 not found in current RefMap", true))).toBe(expected);
    expect(explain(new BackendError("ELEMENT_NOT_FOUND", "gone", true))).toBe(expected);
  });

  it("says so when the ref's app has quit", () => {
    expect(explain(failure("error-stale-ref"))).toMatch(/no longer running.*computer_open_app/);
  });

  it("explains what a valid ref looks like", () => {
    expect(explain(failure("error-invalid-ref"))).toMatch(/not a valid ref.*@s8f3k2p9:e12/);
  });

  it("points at the right tool for a missing app or window", () => {
    expect(explain(failure("error-app-not-found"))).toMatch(/computer_list_apps.*computer_open_app/);
    expect(explain(failure("error-window-not-found"))).toMatch(/another desktop.*computer_open_app/);
  });

  it("names the check an element failed", () => {
    expect(explain(failure("error-not-editable"), true)).toBe(
      "This element cannot do that (role button is not editable). Pick another element from a new snapshot.",
    );
    expect(explain(failure("error-occluded"), true)).toMatch(/^It did not work \(occluded by window\)\./);
  });

  it("keeps the backend's reason when something is unsupported for another cause", () => {
    expect(explain(failure("error-helper"))).toBe("That cannot be done here: The packaged macOS clipboard helper is missing or invalid");
  });

  it("redirects blocked shortcuts to the dedicated tool", () => {
    expect(explain(failure("error-policy-denied"), true)).toBe("That shortcut is blocked for safety. To quit an app, use computer_close_app.");
  });

  it("does not mistake an element that needs the keyboard focus for a blocked shortcut", () => {
    expect(explain(failure("error-type-needs-focus"), true)).toBe(
      "This element cannot do that the way it was asked (semantic action is unavailable and focus fallback is denied). Pick another element or another tool.",
    );
  });

  it("sends keys the layout cannot produce to the menu bar", () => {
    const error = new BackendError("ACTION_FAILED", "'cmd+m' cannot be sent on this keyboard layout", true, { kind: "keyboard_layout" });
    expect(explain(error, true)).toMatch(/nothing was pressed.*menubar/);
  });

  it("sends a shortcut for a background app to computer_open_app first", () => {
    const error = new BackendError("ACTION_FAILED", "'Notes' is not in front, so it would ignore 'cmd+s'", true, { kind: "app_not_in_front" });
    expect(explain(error, true)).toMatch(/^Apps only obey shortcuts while they are in front.*computer_open_app, then press again\.$/);
  });

  it("warns that an action may have happened when the backend cannot rule it out", () => {
    const text = explain(failure("error-unresponsive"), true);
    expect(text).toBe("The app did not answer. It may have gone through anyway: take a new snapshot to check before repeating it.");
    // The same failure on a read needs no such warning.
    expect(explain(failure("error-unresponsive"))).toBe("The app did not answer.");
  });

  it("tells waiting apart from slowness", () => {
    expect(explain(failure("error-wait-timeout"))).toMatch(/did not happen in time/);
    expect(explain(failure("error-inventory-timeout"))).toBe("The computer took too long to answer.");
  });

  it("separates the two permissions", () => {
    expect(explain(new BackendError("PERM_DENIED", "Screen Recording permission denied"))).toMatch(/Screen Recording.*computer_snapshot still works/);
    expect(explain(new BackendError("PERM_DENIED", "Accessibility permission not granted"))).toMatch(/^The Accessibility permission is missing/);
  });

  it("passes on what it has no advice for", () => {
    expect(explain(failure("error-state-dir"))).toBe("Computer control failed: private file parent is accessible by group or other users");
    expect(explain(failure("error-bad-flag"))).toBe("Invalid request: error: unexpected argument '--nope' found");
    expect(explain(new BackendError("SOMETHING_NEW" as never, "odd"))).toBe("Computer control failed: odd");
    expect(explain(new Error("spawn ENOENT"))).toBe("Computer control failed: spawn ENOENT");
  });
});
