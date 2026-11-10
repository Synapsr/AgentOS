import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Home, defaultHome } from "../src/config.js";
import { tempHome } from "./harness.js";

describe("the data directory", () => {
  it("is ~/.agentos unless AGENTOS_HOME says otherwise", () => {
    expect(defaultHome({})).toMatch(/\.agentos$/);
    expect(defaultHome({ AGENTOS_HOME: "/somewhere/else" })).toBe("/somewhere/else");
  });

  it("starts with defaults that work", () => {
    const home = new Home(tempHome(), {});
    expect(home.config).toMatchObject({
      agentName: "Nova",
      ownerName: "",
      autonomy: "balanced",
      onboarded: false,
      port: 4747,
      host: null,
      sandbox: false,
      projectSettings: false,
      engine: "claude",
      model: null,
      voice: { provider: "device", voice: null, url: null, sttModel: null, ttsModel: null },
    });
    expect(["en", "fr"]).toContain(home.config.language);
    expect(home.config.name).not.toBe("");
    expect(home.anthropicApiKey).toBeNull();
  });

  it("keeps the same identity", () => {
    const dir = tempHome();
    expect(new Home(dir, {}).nodeId).toBe(new Home(dir, {}).nodeId);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("has no local token until a core starts, and a new one every time one does", () => {
    const dir = tempHome();
    const home = new Home(dir, {});
    expect(home.localToken).toBeNull();
    expect(existsSync(join(dir, "local-token"))).toBe(false);

    const first = home.renewLocalToken();
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(readFileSync(join(dir, "local-token"), "utf8").trim()).toBe(first);
    expect(statSync(join(dir, "local-token")).mode & 0o777).toBe(0o600);
    // Another process — the `agentos` command — reads it from the file.
    expect(new Home(dir, {}).localToken).toBe(first);

    expect(home.renewLocalToken()).not.toBe(first);
    home.forgetLocalToken();
    expect(home.localToken).toBeNull();
    expect(existsSync(join(dir, "local-token"))).toBe(false);
  });

  it("uses the token an app hands it without ever writing it down, and clears one left behind", () => {
    const dir = tempHome();
    new Home(dir, {}).renewLocalToken();
    const home = new Home(dir, {});
    const given = "a-token-the-app-made-up-0123456789-abcdefghij";
    expect(home.adoptLocalToken(given)).toBe(given);
    expect(home.localToken).toBe(given);
    expect(existsSync(join(dir, "local-token"))).toBe(false);
    expect(new Home(dir, {}).localToken).toBeNull();
    // Too short to have been drawn at random: refused, rather than trusted.
    expect(() => home.adoptLocalToken("short")).toThrow(/local token/);
    expect(() => home.adoptLocalToken("")).toThrow(/local token/);
  });

  it("takes back what an older version, or a careless copy, left open to others", () => {
    const dir = tempHome();
    chmodSync(dir, 0o755);
    mkdirSync(join(dir, "threads"), { mode: 0o755 });
    writeFileSync(join(dir, "threads", "main.jsonl"), "{}\n", { mode: 0o644 });
    writeFileSync(join(dir, "secrets.json"), "{}", { mode: 0o644 });
    // A link is left alone: what it points to is not ours to change.
    const outside = join(tempHome(), "elsewhere.txt");
    writeFileSync(outside, "", { mode: 0o644 });
    chmodSync(outside, 0o644);
    symlinkSync(outside, join(dir, "link"));

    new Home(dir, {});
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "threads")).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "threads", "main.jsonl")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
    expect(statSync(outside).mode & 0o777).toBe(0o644);
  });

  it("lets the environment override the file without writing it back", () => {
    const dir = tempHome();
    const env = { AGENTOS_PORT: "5151", AGENTOS_HOST: "127.0.0.1", AGENTOS_SANDBOX: "1", AGENTOS_ENGINE: "mock", AGENTOS_MODEL: "claude-haiku-5-5", AGENTOS_VOICE: "elevenlabs", AGENTOS_VOICE_URL: "http://127.0.0.1:8000", AGENTOS_RELAY_URL: "https://relay.example.com" };
    const home = new Home(dir, env);
    expect(home.config).toMatchObject({
      port: 5151,
      host: "127.0.0.1",
      sandbox: true,
      projectSettings: false,
      engine: "mock",
      model: "claude-haiku-5-5",
      voice: { provider: "elevenlabs", url: "http://127.0.0.1:8000", voice: null },
      relayUrl: "https://relay.example.com",
    });
    home.update({ agentName: "Léa", voice: { voice: "Rachel" } });
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toMatchObject({
      agentName: "Léa",
      port: 4747,
      engine: "claude",
      model: null,
      voice: { provider: "device", voice: "Rachel", url: null },
    });
    expect(new Home(dir, {}).config).toMatchObject({ agentName: "Léa", port: 4747, engine: "claude", voice: { provider: "device", voice: "Rachel" } });
  });

  it("reads the speech models of a voice from the file, keeping what it does not mention", () => {
    const dir = tempHome();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ voice: { provider: "local", sttModel: "whisper-large", ttsModel: 7 } }));
    expect(new Home(dir, {}).config.voice).toEqual({ provider: "local", voice: null, url: null, sttModel: "whisper-large", ttsModel: null });
    expect(new Home(dir, { AGENTOS_VOICE_URL: "http://127.0.0.1:8000" }).config.voice).toMatchObject({
      provider: "local",
      url: "http://127.0.0.1:8000",
      sttModel: "whisper-large",
    });
  });

  it("ignores a value that makes no sense rather than losing the rest", () => {
    const dir = tempHome();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agentName: "Léa", autonomy: "reckless", port: "many" }));
    expect(new Home(dir, { AGENTOS_PORT: "not-a-port" }).config).toMatchObject({ agentName: "Léa", autonomy: "balanced", port: 4747 });
    writeFileSync(join(dir, "config.json"), "{ not json");
    expect(new Home(dir, {}).config.agentName).toBe("Nova");
  });

  it("keeps keys in a file only the owner can read, the environment winning", () => {
    const dir = tempHome();
    const home = new Home(dir, {});
    home.setAnthropicApiKey("sk-ant-from-settings");
    home.setAnthropicWorkspaceId("wrkspc_from_settings");
    home.setVoiceKey("elevenlabs", "el-from-settings");
    expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);

    const reopened = new Home(dir, {});
    expect(reopened.anthropicApiKey).toBe("sk-ant-from-settings");
    expect(reopened.anthropicWorkspaceId).toBe("wrkspc_from_settings");
    expect(reopened.voiceKey("elevenlabs")).toBe("el-from-settings");
    expect(reopened.voiceKey("openai")).toBeNull();

    const withEnv = new Home(dir, { ANTHROPIC_API_KEY: "sk-ant-from-env", ANTHROPIC_WORKSPACE_ID: "wrkspc_from_env", ELEVENLABS_API_KEY: "el-from-env", OPENAI_API_KEY: "oa-from-env" });
    expect(withEnv.anthropicApiKey).toBe("sk-ant-from-env");
    expect(withEnv.anthropicWorkspaceId).toBe("wrkspc_from_env");
    expect(withEnv.voiceKey("elevenlabs")).toBe("el-from-env");
    expect(withEnv.voiceKey("openai")).toBe("oa-from-env");

    reopened.setAnthropicApiKey("");
    reopened.setVoiceKey("elevenlabs", "");
    expect(new Home(dir, {}).anthropicApiKey).toBeNull();
    expect(new Home(dir, {}).voiceKey("elevenlabs")).toBeNull();
    expect(new Home(dir, {}).anthropicWorkspaceId).toBe("wrkspc_from_settings");
  });
});
