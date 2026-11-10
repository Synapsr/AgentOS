/** The `agentos start` process itself: real processes, started and stopped as the desktop app would. */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeResponse, RequestsResponse } from "@agentos/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { Home } from "../src/config.js";
import { tempHome } from "./harness.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const started: ChildProcess[] = [];
afterEach(() => {
  for (const child of started.splice(0)) child.kill("SIGKILL");
});

interface Running {
  process: ChildProcess;
  home: string;
  /** Everything it has printed so far, on either stream. */
  output: () => string;
  /** Resolves with its exit code. */
  exited: Promise<number | null>;
}

/**
 * Starts a core from the sources, on a free port and a throwaway home, with the mock engine.
 * Its output is piped, so it believes an app started it: `SHELL` names a shell it will not ask,
 * unless a test gives one — the test machine's own shell profile is nobody's business here.
 */
function startCoreProcess(env: Record<string, string | undefined>, home = tempHome()): Running {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "start", "--port", "0"], {
    cwd: PACKAGE,
    env: { ...process.env, AGENTOS_HOME: home, AGENTOS_ENGINE: "mock", AGENTOS_UI_DIR: join(home, "no-app"), SHELL: "/bin/not-a-shell-we-ask", ...env },
  });
  started.push(child);
  let printed = "";
  child.stdout.on("data", (chunk) => (printed += chunk));
  child.stderr.on("data", (chunk) => (printed += chunk));
  return { process: child, home, output: () => printed, exited: new Promise((resolve) => child.on("exit", resolve)) };
}

/** Runs one of the client commands (`status`, `say`…) against the core of a data directory, as a person would. */
function cli(home: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, AGENTOS_HOME: home };
    execFile(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: PACKAGE, env }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

/** A process that does nothing, standing in for the desktop app. */
function startParent(): ChildProcess {
  const parent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  started.push(parent);
  return parent;
}

async function until(condition: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("It did not happen in time.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The address the core printed in its banner, once it is up. */
async function addressOf(core: Running): Promise<string> {
  await until(() => /http:\/\/localhost:\d+/.test(core.output()));
  return /http:\/\/localhost:\d+/.exec(core.output())?.[0] ?? "";
}

/** The lines of the core's journal file, without their dates. */
const journalOf = (core: Running): string[] =>
  readFileSync(join(core.home, "logs", "core.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.replace(/^\S+ /, ""));

const answers = (address: string): Promise<boolean> =>
  fetch(`${address}/v1/hello`).then(
    (response) => response.ok,
    () => false,
  );
const within = <T>(promise: Promise<T>, ms: number): Promise<T | "still running"> =>
  Promise.race([promise, new Promise<"still running">((resolve) => setTimeout(() => resolve("still running"), ms))]);

describe("a core started by an app (AGENTOS_PARENT_PID)", () => {
  it("shuts down cleanly when that app is killed", async () => {
    const parent = startParent();
    const core = startCoreProcess({ AGENTOS_PARENT_PID: String(parent.pid) });
    const address = await addressOf(core);
    expect(await answers(address)).toBe(true);
    // Leave something in the middle: a clean shutdown puts it at rest.
    const token = readFileSync(join(core.home, "local-token"), "utf8").trim();
    await fetch(`${address}/v1/threads/main/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "delete the build folder" }),
    });
    await until(() => readFileSync(join(core.home, "threads.json"), "utf8").includes('"waiting"'));

    parent.kill("SIGKILL");
    expect(await within(core.exited, 8000)).toBe(0);
    // The same goodbye as on SIGTERM, and the same state on disk: nothing left running or waiting.
    expect(core.output()).toMatch(/is asleep|dort/);
    expect(await answers(address)).toBe(false);
    expect(journalOf(core).at(-1)).toBe("Stopped: the app that started the core is gone");
    const [main] = JSON.parse(readFileSync(join(core.home, "threads.json"), "utf8"));
    expect(main.thread.state).toBe("idle");
    expect(readFileSync(join(core.home, "threads/main.jsonl"), "utf8")).toContain('"state":"cancelled"');
  }, 30_000);

  it("stops at once when that app is already gone", async () => {
    const parent = startParent();
    const gone = new Promise((resolve) => parent.on("exit", resolve));
    parent.kill("SIGKILL");
    await gone;
    const core = startCoreProcess({ AGENTOS_PARENT_PID: String(parent.pid) });
    expect(await within(core.exited, 10_000)).toBe(0);
    expect(core.output()).toMatch(/is asleep|dort/);
  }, 30_000);

  it("lives as long as that app does, and still stops when told to", async () => {
    const parent = startParent();
    const core = startCoreProcess({ AGENTOS_PARENT_PID: String(parent.pid) });
    const address = await addressOf(core);
    // More than one check of the parent goes by.
    expect(await within(core.exited, 4500)).toBe("still running");
    expect(await answers(address)).toBe(true);
    core.process.kill("SIGTERM");
    expect(await within(core.exited, 8000)).toBe(0);
  }, 30_000);
});

describe("a core started by hand", () => {
  it("lives on its own, and says so in one line when the variable makes no sense", async () => {
    const core = startCoreProcess({ AGENTOS_PARENT_PID: "the desktop app" });
    const address = await addressOf(core);
    expect(core.output().split("\n").filter((line) => line.includes("AGENTOS_PARENT_PID"))).toEqual([
      '  AGENTOS_PARENT_PID is not a process id ("the desktop app"); ignoring it.',
    ]);
    expect(await within(core.exited, 2500)).toBe("still running");
    expect(await answers(address)).toBe(true);
    core.process.kill("SIGTERM");
    expect(await within(core.exited, 8000)).toBe(0);
    expect(core.output()).toMatch(/is asleep|dort/);
  }, 30_000);
});

describe("a core started without a terminal", () => {
  it("takes the owner's environment from their shell, and never says what was in it", async () => {
    const bin = join(tempHome(), "bin");
    mkdirSync(bin);
    // A profile that sets up tools, chooses the engine, and holds a secret.
    writeFileSync(
      join(bin, "zsh"),
      '#!/bin/sh\nexport PATH="/opt/owner/bin:$PATH" AGENTOS_ENGINE=mock AGENTOS_MOCK_SPEED=0 OWNER_SECRET=hunter2-from-the-profile\neval "$4"\n',
    );
    chmodSync(join(bin, "zsh"), 0o755);
    const core = startCoreProcess({ SHELL: join(bin, "zsh"), AGENTOS_ENGINE: undefined, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
    const address = await addressOf(core);

    // What the shell said reached the place where the engine is chosen: this core was told nothing about an engine.
    const token = readFileSync(join(core.home, "local-token"), "utf8").trim();
    const answer = await fetch(`${address}/v1/node`, { headers: { Authorization: `Bearer ${token}` } });
    expect(NodeResponse.parse(await answer.json()).node.capabilities.engine).toBe("mock");

    const journal = journalOf(core);
    expect(journal[0]).toMatch(/^Took the PATH \(5 folders\) and \d+ other settings from your shell \(zsh\)$/);
    expect(journal[1]).toMatch(/^AgentOS \S+ started on port \d+ \(engine mock, /);
    for (const told of [core.output(), journal.join("\n")]) {
      expect(told).not.toContain("hunter2-from-the-profile");
      expect(told).not.toContain("/opt/owner/bin");
    }
    core.process.kill("SIGTERM");
    expect(await within(core.exited, 8000)).toBe(0);
  }, 30_000);

  it("starts all the same when the shell's profile is broken, and says so", async () => {
    const bin = join(tempHome(), "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "bash"), "#!/bin/sh\necho 'profile: syntax error near unexpected token' >&2\nexit 2\n");
    chmodSync(join(bin, "bash"), 0o755);
    const core = startCoreProcess({ SHELL: join(bin, "bash") });
    expect(await answers(await addressOf(core))).toBe(true);
    expect(journalOf(core)[0]).toBe("Your shell (bash) gave no usable answer: commands will run with the environment the core was started with");
    core.process.kill("SIGTERM");
    expect(await within(core.exited, 8000)).toBe(0);
  }, 30_000);

  it("keeps a journal in its data directory: what happened, not what was said", async () => {
    const core = startCoreProcess({});
    const address = await addressOf(core);
    const token = readFileSync(join(core.home, "local-token"), "utf8").trim();
    const say = (text: string) =>
      fetch(`${address}/v1/threads/main/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    await say("delete the build folder, quietly-please");
    await until(() => journalOf(core).some((line) => line.startsWith("Waiting for the owner")));
    const asking = await fetch(`${address}/v1/requests`, { headers: { Authorization: `Bearer ${token}` } });
    const [request] = RequestsResponse.parse(await asking.json()).requests;
    await fetch(`${address}/v1/requests/${request?.id}/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: "approve" }),
    });
    await until(() => journalOf(core).includes("Turn ended in main: ok"));

    const file = join(core.home, "logs", "core.log");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const status = await new Promise<string>((resolve) => {
      const env = { ...process.env, AGENTOS_HOME: core.home };
      execFile(process.execPath, ["--import", "tsx", "src/cli.ts", "status", "--port", new URL(address).port], { cwd: PACKAGE, env }, (_error, stdout) => resolve(stdout));
    });
    expect(status).toMatch(new RegExp(`(Log|Journal) ?: ${file}`));

    core.process.kill("SIGTERM");
    expect(await within(core.exited, 8000)).toBe(0);
    const journal = journalOf(core);
    expect(journal).toEqual(expect.arrayContaining(["Engine mock: ready", "Working", "Waiting for the owner (1)", "Turn ended in main: ok", "Idle"]));
    expect(journal[0]).toMatch(/^AgentOS \d+\.\d+\.\d+ started on port \d+ /);
    expect(journal.at(-1)).toBe("Stopped");
    // Every line is dated; none holds the token, the words, or the command.
    const raw = readFileSync(file, "utf8");
    expect(raw.trim().split("\n").every((line) => /^\d{4}-\d\d-\d\dT[\d:.]+Z \S/.test(line))).toBe(true);
    for (const secret of [token, "quietly-please", "rm -rf", "#token="]) expect(raw).not.toContain(secret);
    // The setup link, which carries the token, is for a person at a terminal: not for an app's log.
    expect(core.output()).not.toContain("#token=");
  }, 30_000);
});

describe("the local token", () => {
  const TOKEN = "a-token-the-desktop-app-made-0123456789-abcdefghijklmnop";

  it("comes from the app on standard input: never written down, and any old one cleared away", async () => {
    const home = tempHome();
    new Home(home, {}).renewLocalToken();
    const stale = readFileSync(join(home, "local-token"), "utf8").trim();
    const core = startCoreProcess({ AGENTOS_LOCAL_TOKEN_STDIN: "1" }, home);
    core.process.stdin?.write(`${TOKEN}\n`);
    const address = await addressOf(core);
    expect(existsSync(join(home, "local-token"))).toBe(false);
    const asked = (token: string) => fetch(`${address}/v1/node`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status);
    expect(await asked(TOKEN)).toBe(200);
    expect(await asked(stale)).toBe(401);
    expect(core.output()).not.toContain(TOKEN);

    // The commands of a person at a terminal have no token to use: they say why, in one sentence.
    const status = await cli(home, ["status", "--port", new URL(address).port]);
    expect(status.code).toBe(1);
    expect(status.out.trim()).toBe("AgentOS is running inside the app. Use the app: this command only talks to an AgentOS started with: agentos start");
    core.process.kill("SIGTERM");
    expect(await within(core.exited, 8000)).toBe(0);
    expect(existsSync(join(home, "local-token"))).toBe(false);
  }, 30_000);

  it("is required in that mode: without one, the core does not start", async () => {
    const core = startCoreProcess({ AGENTOS_LOCAL_TOKEN_STDIN: "1" });
    core.process.stdin?.end("short\n");
    expect(await within(core.exited, 10_000)).toBe(1);
    expect(core.output()).toContain("must give it a local token");
  }, 30_000);

  it("is new at every start by hand, and gone once the core stops", async () => {
    const home = tempHome();
    const first = startCoreProcess({}, home);
    await addressOf(first);
    const token = readFileSync(join(home, "local-token"), "utf8").trim();
    first.process.kill("SIGTERM");
    await first.exited;
    expect(existsSync(join(home, "local-token"))).toBe(false);
    const second = startCoreProcess({}, home);
    await addressOf(second);
    expect(readFileSync(join(home, "local-token"), "utf8").trim()).not.toBe(token);
    second.process.kill("SIGTERM");
    await second.exited;
  }, 30_000);

  it("is only sent to what proves it is the core: something else on the port gets nothing", async () => {
    const home = tempHome();
    const token = new Home(home, {}).renewLocalToken();
    // Something that got to the port first and answers like the core — every field right, but it cannot sign.
    const heard: string[] = [];
    const impostor = createServer((request, response) => {
      heard.push(`${request.method} ${request.url} ${request.headers.authorization ?? ""}`);
      const hello = { app: "agentos", version: "1.0.0", protocol: 1, node: { id: "node_x", name: "Mac", agentName: "Nova" }, onboarded: true };
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ...hello, proof: "0".repeat(64) }));
    });
    await new Promise<void>((resolve) => impostor.listen(0, "127.0.0.1", resolve));
    const { port } = impostor.address() as AddressInfo;
    for (const command of [["status"], ["url"], ["pair"], ["say", "hello"]]) {
      const run = await cli(home, [...command, "--port", String(port)]);
      expect(run.code).toBe(1);
      expect(run.out.trim()).toBe(`Something is answering on port ${port}, and it isn't this AgentOS. Nothing was sent to it.`);
    }
    impostor.close();
    expect(heard.every((line) => line.startsWith("GET /v1/hello?challenge="))).toBe(true);
    expect(heard.join("\n")).not.toContain(token);
  }, 30_000);
});

describe("agentos say", () => {
  it("answers what the agent asks — but only with a plain yes or no", async () => {
    const core = startCoreProcess({ AGENTOS_MOCK_SPEED: "0" });
    const port = new URL(await addressOf(core)).port;
    const asked = await cli(core.home, ["say", "delete the build folder", "--port", port]);
    expect(asked.out).toContain("Nova is asking: Nova wants to delete files");

    const unclear = await cli(core.home, ["say", "ok thanks", "--port", port]);
    expect(unclear.code).toBe(1);
    expect(unclear.out.trim()).toBe("Nova is still waiting: that was neither a clear yes nor a clear no.");
    const token = readFileSync(join(core.home, "local-token"), "utf8").trim();
    const pending = await fetch(`http://127.0.0.1:${port}/v1/requests`, { headers: { Authorization: `Bearer ${token}` } });
    expect(RequestsResponse.parse(await pending.json()).requests).toHaveLength(1);

    const yes = await cli(core.home, ["say", "oui vas-y", "--port", port]);
    expect(yes.code).toBe(0);
    expect(yes.out).toContain("Done, the folder is gone.");
    core.process.kill("SIGTERM");
    await core.exited;
  }, 30_000);
});
