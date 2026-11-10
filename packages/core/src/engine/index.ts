import { voiceProviders } from "@agentos/voice";
import { type Home, voiceKeyVariable } from "../config.js";
import { createClaudeEngine } from "./claude.js";
import { createMockEngine } from "./mock.js";
import type { Engine } from "./types.js";

export type { Engine, EngineHost, EngineSession, EngineStatus } from "./types.js";

/** Engines this build knows about, default first. */
export const engineIds = ["claude", "mock"];

/**
 * The engine the configuration asks for. An unknown id gets the default, so
 * a typo never breaks the app. `AGENTOS_CLAUDE_BIN` is for packaging: an app
 * that ships the Claude Code binary beside the core says where it is.
 */
export function createEngine(home: Home, version: string): Engine {
  const { engine, sandbox, projectSettings } = home.config;
  if (engine === "mock") return createMockEngine();
  return createClaudeEngine({
    apiKey: home.anthropicApiKey,
    workspaceId: home.anthropicWorkspaceId,
    executable: process.env.AGENTOS_CLAUDE_BIN || null,
    version,
    dataDir: home.dir,
    secretVariables: voiceProviders.filter((provider) => provider.needsKey).map((provider) => voiceKeyVariable(provider.id)),
    sandbox,
    projectSettings,
  });
}
