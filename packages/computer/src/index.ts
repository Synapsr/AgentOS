/**
 * @agentos/computer — eyes and hands for the agent.
 *
 * A small, OS-independent surface over a native backend. The core only
 * needs three things from it: is it usable, a picture of the screen, and
 * the tools to hand to the agent.
 */
import { execFile } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@agentos/protocol";
import { agentDesktopBackend, createRunner, findBinary } from "./agent-desktop.js";
import { createGuard } from "./guard.js";
import { captureScreenshot } from "./image.js";
import { computerTools } from "./tools.js";

export interface Permissions {
  /** May read the UI and send mouse and keyboard input. */
  accessibility: boolean;
  /** May capture the screen. */
  screenRecording: boolean;
}

export interface Screenshot {
  data: Uint8Array;
  mime: "image/jpeg" | "image/png";
  /** Pixel size of `data`. */
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  /** Downscale to this width when the capture is wider. */
  maxWidth?: number;
  /** Defaults to JPEG. Systems without a converter return PNG at full size. */
  format?: "jpeg" | "png";
  /** Capture this app's window instead of the main display. It is captured by itself, even when covered. */
  app?: string;
  /** With `app`, when it has several windows: the one to capture. */
  windowId?: string;
}

export interface Computer {
  /** False when this OS has no backend yet: the agent then has no eyes or hands. */
  readonly available: boolean;
  /** Never prompts, and never throws: an unreadable state reads as not granted. */
  permissions(): Promise<Permissions>;
  /** Triggers the OS prompts, or opens the right settings pane. */
  requestPermissions(): Promise<void>;
  screenshot(opts?: ScreenshotOptions): Promise<Screenshot>;
  /** Tools to give the agent. Empty when unavailable. */
  tools(): AgentTool[];
  /** Releases the native backend. */
  close(): Promise<void>;
}

export interface ComputerOptions {
  /**
   * Folder for the backend's working files (refs of recent snapshots, a helper executable).
   * The core should pass a folder inside its data directory. The default is a private folder
   * in the system's temporary directory, so that nothing here ever guesses where that is.
   */
  stateDir?: string;
  /**
   * Apps the agent's tools must never read or control, by bundle identifier or name, on top of
   * AgentOS's own app and of whatever app launched this process (both always protected).
   * The `AGENTOS_PROTECTED_APPS` environment variable adds to the same list.
   */
  protectedApps?: string[];
}

export class ComputerUnavailable extends Error {
  constructor(message = "Computer control is not available on this system yet.") {
    super(message);
    this.name = "ComputerUnavailable";
  }
}

const NOT_GRANTED: Permissions = { accessibility: false, screenRecording: false };

/**
 * Creates the computer for this machine. Always returns an object; check `available`.
 *
 * The native backend comes from the `agent-desktop` npm package, or from the folder (or
 * executable) named by the `AGENTOS_AGENT_DESKTOP_BIN` environment variable, which is how
 * a packaged app ships it beside the core. See `findBinary` for the file names expected.
 */
export function createComputer(options: ComputerOptions = {}): Computer {
  const binary = findBinary();
  if (!binary) {
    return {
      available: false,
      permissions: async () => NOT_GRANTED,
      requestPermissions: async () => {},
      screenshot: async () => {
        throw new ComputerUnavailable();
      },
      tools: () => [],
      close: async () => {},
    };
  }

  const stateDir = options.stateDir ?? join(tmpdir(), `agentos-computer-${userInfo().uid}`);
  const runner = createRunner(binary, stateDir);
  const backend = agentDesktopBackend(runner.run);
  const tools = computerTools(backend, createGuard(backend, { apps: options.protectedApps }));
  const permissions = () => backend.permissions().catch(() => NOT_GRANTED);

  return {
    available: true,
    permissions,
    async requestPermissions() {
      try {
        await backend.requestPermissions();
      } catch {
        // Last resort on a Mac: open the privacy pane for whichever permission is missing.
        if (process.platform !== "darwin") return;
        const pane = (await permissions()).accessibility ? "Privacy_ScreenCapture" : "Privacy_Accessibility";
        execFile("/usr/bin/open", [`x-apple.systempreferences:com.apple.preference.security?${pane}`], () => {});
      }
    },
    screenshot: ({ app, windowId, ...opts } = {}) => captureScreenshot(backend, { app, windowId }, opts),
    tools: () => tools,
    // Every backend call is its own short-lived process: only a helper copy may be left to remove.
    close: async () => runner.close(),
  };
}
