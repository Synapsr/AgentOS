/** Engine, voice and network settings: what the Settings page reads and changes. */
import type { Settings, SettingsPatch } from "@agentos/protocol";
import { type Voice, createVoice, voiceProviders } from "@agentos/voice";
import type { Home } from "./config.js";
import type { Core } from "./core.js";
import { engineIds } from "./engine/index.js";
import { Failure } from "./errors.js";
import { addresses } from "./net.js";

/** The voice the configuration asks for. */
export function configuredVoice(home: Home): Voice {
  const { voice, language } = home.config;
  return createVoice({
    provider: voice.provider,
    apiKey: home.voiceKey(voice.provider) ?? undefined,
    voice: voice.voice ?? undefined,
    language,
    url: voice.url ?? undefined,
    sttModel: voice.sttModel ?? undefined,
    ttsModel: voice.ttsModel ?? undefined,
  });
}

/** Every address a client can try, best first: direct ones, then through the relay while it is connected. */
export async function reachableAt(core: Core): Promise<string[]> {
  const relayed = core.relay.address;
  return [...(await addresses(core.port, core.host)), ...(relayed ? [relayed] : [])];
}

/** Settings as shown to the owner. Keys never leave the computer: only whether there is one. */
export async function readSettings(core: Core): Promise<Settings> {
  const config = core.home.config;
  const engine = await core.node.engineState();
  return {
    engine: {
      provider: engine.id,
      model: config.model,
      auth: engine.auth,
      hasWorkspaceId: core.home.anthropicWorkspaceId !== null,
      ready: engine.ready,
    },
    voice: {
      provider: config.voice.provider,
      voice: config.voice.voice,
      hasKey: core.home.voiceKey(config.voice.provider) !== null,
      url: config.voice.url,
      available: voiceProviders,
    },
    computer: { permissions: await core.computer.permissions() },
    network: {
      port: core.port,
      urls: await reachableAt(core),
      relayUrl: config.relayUrl,
      relayConnected: core.relay.state.connected,
      relayError: core.relay.state.error,
      hasRelayToken: core.home.relayToken !== null,
    },
  };
}

/** Saves changed settings and puts them to work at once. */
export async function changeSettings(core: Core, patch: SettingsPatch): Promise<Settings> {
  const { home, node } = core;
  const { engine, voice, network } = patch;

  if (engine?.provider !== undefined && !engineIds.includes(engine.provider)) {
    throw new Failure("invalid", `There is no engine called "${engine.provider}".`);
  }
  if (voice?.provider !== undefined && !voiceProviders.some((provider) => provider.id === voice.provider)) {
    throw new Failure("invalid", `There is no voice called "${voice.provider}".`);
  }

  if (engine && Object.keys(engine).length > 0) {
    if (engine.provider !== undefined) home.update({ engine: engine.provider });
    if (engine.model !== undefined) home.update({ model: engine.model });
    if (engine.apiKey !== undefined) home.setAnthropicApiKey(engine.apiKey.trim());
    if (engine.workspaceId !== undefined) home.setAnthropicWorkspaceId(engine.workspaceId.trim());
    node.setEngine(core.createEngine());
  }
  if (voice && Object.keys(voice).length > 0) {
    const { apiKey, ...shown } = voice;
    home.update({ voice: shown });
    if (apiKey !== undefined) home.setVoiceKey(home.config.voice.provider, apiKey.trim());
    node.setVoice(configuredVoice(home));
  }
  if (network?.relayUrl !== undefined) home.update({ relayUrl: network.relayUrl });
  if (network?.relayToken !== undefined) home.setRelayToken(network.relayToken.trim());
  // Connects, reconnects with the new token, or lets go — whatever the change asks for.
  if (network) core.relay.apply();

  return readSettings(core);
}
