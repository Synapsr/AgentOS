/**
 * The seam between the agent's tools and whatever drives the machine.
 *
 * Everything here is backend-neutral: a second backend only has to implement
 * `Backend` and throw `BackendError` with the codes below.
 */
import type { Permissions } from "./index.js";

/** Failure classes the tools know how to explain to the model. */
export type ErrorCode =
  | "PERM_DENIED"
  | "STALE_REF"
  | "SNAPSHOT_NOT_FOUND"
  | "ELEMENT_NOT_FOUND"
  | "AMBIGUOUS_TARGET"
  | "APP_NOT_FOUND"
  | "WINDOW_NOT_FOUND"
  | "ACTION_FAILED"
  | "ACTION_NOT_SUPPORTED"
  | "POLICY_DENIED"
  | "APP_UNRESPONSIVE"
  | "TIMEOUT"
  | "INVALID_ARGS"
  | "PLATFORM_NOT_SUPPORTED"
  | "INTERNAL";

/** A failed backend call. */
export class BackendError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** True only when nothing reached the app, so repeating the call is harmless. */
    readonly retrySafe = false,
    /** Backend-specific extras (failed checks, error kind…). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** One element of the accessibility tree. */
export interface UiNode {
  role: string;
  name?: string;
  value?: string;
  /** Handle for acting on the element. Absent on plain text and inert containers. */
  ref?: string;
  /** Non-default states only, e.g. "disabled", "focused", "checked". */
  states?: string[];
  /**
   * Set on commands that are drastic whatever the app is doing. "quit" closes the app the
   * element belongs to, which matters when someone's work is open in it. "severe" is never
   * routine: it stops the computer, ends the session or kills an app.
   */
  critical?: "quit" | "severe";
  children?: UiNode[];
  /** Children that exist but were not read (depth or time limit). */
  hidden?: number;
}

/** The accessibility tree of one window, menu or dialog. */
export interface UiSnapshot {
  app: string;
  window?: { id: string; title: string };
  tree: UiNode;
  /** False when the app answered too slowly and the tree is partial. */
  complete: boolean;
}

export interface AppInfo {
  name: string;
  pid: number;
  /** The system's identifier for the app, when it has one: a bundle identifier on a Mac. */
  id?: string;
  /** True for apps a person would call "open"; false for menu bar extras and helpers. */
  foreground: boolean;
}

export interface WindowInfo {
  id: string;
  title: string;
  app: string;
  /** The process the window belongs to. */
  pid: number;
  focused: boolean;
  minimized: boolean;
}

export interface OpenedApp {
  /** The app's name as the system reports it, which may be translated. */
  app: string;
  pid: number;
  /** True when this call started the app; false when it was already running and only came to the front. */
  started: boolean;
  window?: WindowInfo;
}

/** Layers above a window that hold their own tree. */
export const SURFACES = ["menu", "menubar", "sheet", "alert", "popover"] as const;
export type Surface = (typeof SURFACES)[number];

export interface SnapshotQuery {
  /** App name. Omitted: the app in front. */
  app?: string;
  windowId?: string;
  /** Read only the subtree under this ref. */
  root?: string;
  surface?: Surface;
  /** Keep controls only, drop plain text. */
  interactiveOnly?: boolean;
  signal?: AbortSignal;
}

export interface TextWait {
  /** App name. Omitted: the app in front. */
  app?: string;
  text: string;
  /** Wait for the text to disappear instead of appear. */
  gone?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** What an action left behind that the agent must look at next. */
export interface ActionResult {
  /** Menus and dialogs that are open once the action settled. */
  surfaces: Surface[];
}

export type Direction = "up" | "down" | "left" | "right";

/** What to capture: one window of an app, or (empty) the main display. */
export interface CaptureTarget {
  app?: string;
  windowId?: string;
}

export interface Backend {
  /** Reads the permission state. Never prompts. */
  permissions(): Promise<Permissions>;
  /** Shows the OS prompt or opens the settings pane. Returns without waiting for the user. */
  requestPermissions(): Promise<void>;

  /** Every running program that has, or may have, a user interface. */
  listApps(): Promise<AppInfo[]>;
  listWindows(app: string): Promise<WindowInfo[]>;
  /** Starts the app or brings it to the front, and waits for a window. */
  openApp(app: string, signal?: AbortSignal): Promise<OpenedApp>;
  /** Asks the app to quit and waits until it is gone. */
  closeApp(app: string): Promise<void>;

  snapshot(query: SnapshotQuery): Promise<UiSnapshot>;
  /** Resolves once an element containing the text is on screen (or once none is left); fails with TIMEOUT otherwise. */
  waitForText(wait: TextWait): Promise<void>;
  click(ref: string, button: "left" | "right"): Promise<ActionResult>;
  /** Gives the element the keyboard focus, as clicking into a text field does. */
  focus(ref: string): Promise<ActionResult>;
  /**
   * Adds `text` to a text field: at the cursor when the field has the keyboard focus
   * (replacing a selection), otherwise at the end. With `replace`, sets the whole value.
   */
  setText(ref: string, text: string, replace: boolean): Promise<ActionResult>;
  /** Sends a key or shortcut ("return", "cmd+s") to `app`, or to the app in front. */
  press(keys: string, app?: string): Promise<ActionResult>;
  scroll(ref: string, direction: Direction, amount: number): Promise<ActionResult>;

  /** Writes a PNG to `file` and returns its pixel size. */
  capture(target: CaptureTarget, file: string): Promise<{ width: number; height: number }>;

  /** Clipboard text, or undefined when the clipboard holds no text. */
  readClipboard(): Promise<string | undefined>;
  writeClipboard(text: string): Promise<void>;
}
