import { VoiceCapabilities } from "@agentos/protocol";
import { describe, expect, it } from "vitest";
import { createVoice, voiceProviders, VoiceUnavailable } from "../index.js";

const device = { provider: "device", stt: "device", tts: "device", ttsMime: null };

describe("voiceProviders", () => {
  it("lists the default first, then the providers that need setting up", () => {
    expect(voiceProviders).toEqual([
      { id: "device", label: "On this device", needsKey: false, needsUrl: false },
      { id: "elevenlabs", label: "ElevenLabs", needsKey: true, needsUrl: false },
      { id: "local", label: "Your own speech server", needsKey: false, needsUrl: true },
    ]);
  });
});

describe("createVoice", () => {
  it.each(["device", "elevenlab", "ElevenLabs", "openai", ""])("gives the device voice for provider %j", (provider) => {
    expect(createVoice({ provider, apiKey: "key", url: "http://127.0.0.1:8000" }).capabilities()).toEqual(device);
  });

  it.each([
    ["elevenlabs without a key", { provider: "elevenlabs" }],
    ["elevenlabs with a blank key", { provider: "elevenlabs", apiKey: "  " }],
    ["local without a URL", { provider: "local", apiKey: "key" }],
    ["local with a blank URL", { provider: "local", url: " " }],
  ])("falls back to the device voice for %s", (_case, config) => {
    expect(createVoice(config).capabilities()).toEqual(device);
  });

  it("refuses to transcribe or speak on the computer with the device voice", async () => {
    const voice = createVoice({ provider: "device" });
    await expect(voice.transcribe(new Uint8Array(1), { mime: "audio/wav" })).rejects.toBeInstanceOf(VoiceUnavailable);
    await expect(voice.speak("Bonjour")).rejects.toBeInstanceOf(VoiceUnavailable);
  });

  it.each([
    ["elevenlabs", { provider: "elevenlabs", apiKey: "key" }],
    ["local", { provider: "local", url: "http://127.0.0.1:8000" }],
  ])("moves both directions to the computer for %s, as MP3", (provider, config) => {
    const capabilities = createVoice(config).capabilities();
    expect(capabilities).toEqual({ provider, stt: "server", tts: "server", ttsMime: "audio/mpeg" });
    expect(VoiceCapabilities.parse(capabilities)).toEqual(capabilities);
  });
});
