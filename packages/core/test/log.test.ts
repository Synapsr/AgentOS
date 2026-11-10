/** The journal: dated, private, bounded — and silent about what was said. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Computer } from "@agentos/computer";
import { PairResponse, PairingCode, type RequestItem } from "@agentos/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { errorLine, fileLog, logPath, redact } from "../src/log.js";
import { type TestCore, noComputer, startTestCore, tempHome } from "./harness.js";

let core: TestCore;
afterEach(() => core?.close());

describe("the journal file", () => {
  it("dates each line, and is readable by its owner only", () => {
    const home = tempHome();
    const log = fileLog(home);
    log("Working");
    log("Idle");
    const lines = readFileSync(logPath(home), "utf8").trim().split("\n");
    expect(lines.map((line) => line.replace(/^\S+ /, ""))).toEqual(["Working", "Idle"]);
    expect(lines.every((line) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /.test(line))).toBe(true);
    expect(logPath(home)).toBe(join(home, "logs", "core.log"));
    expect(statSync(logPath(home)).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "logs")).mode & 0o777).toBe(0o700);
  });

  it("never grows past its limit: one full predecessor is kept, older lines go", () => {
    const home = tempHome();
    const log = fileLog(home, 300);
    for (let index = 0; index < 60; index++) log(`line ${index}`);
    expect(readdirSync(join(home, "logs")).sort()).toEqual(["core.log", "core.log.1"]);
    const [now, before] = [readFileSync(logPath(home), "utf8"), readFileSync(`${logPath(home)}.1`, "utf8")];
    expect(now.length).toBeLessThan(400);
    expect(before.length).toBeLessThan(400);
    expect(now).toContain("line 59");
    expect(now + before).not.toContain("line 0\n");
    expect(statSync(`${logPath(home)}.1`).mode & 0o777).toBe(0o600);
  });

  it("strikes out anything shaped like a secret, whatever line it is in", () => {
    const token = "kJ8s_Vt2Qw9-ZxLmN4pR7yBcD1fGhT5uA0eIoS3vWq6";
    expect(redact(`Error: bad token ${token} for dev_0123456789abcdef`)).toBe("Error: bad token [hidden] for dev_0123456789abcdef");
    expect(redact("key sk-ant-usr-abc123_DEF456")).toBe("key [hidden]");
    expect(redact("Request resolved: approve from dev_9f2c41d07ab35e18 (req_9f2c41d07ab35e18)")).toContain("req_9f2c41d07ab35e18");
    const home = tempHome();
    fileLog(home)(`something leaked ${token}`);
    expect(readFileSync(logPath(home), "utf8")).not.toContain(token);
  });

  it("says of an unexpected error what kind it is and where, in one line", () => {
    const line = errorLine(new TypeError("Cannot read properties of undefined\n  (reading 'x')"));
    expect(line).toMatch(/^TypeError: Cannot read properties of undefined \(reading 'x'\) \(test\/log\.test\.ts:\d+:\d+\)$/);
    expect(errorLine("just a string")).toBe("just a string");
  });

  it("leaves out the owner's paths an error message names", () => {
    const missing = Object.assign(new Error("ENOENT: no such file or directory, open '/Users/marie/Secret Plans/budget 2027.xlsx'"), { name: "Error" });
    expect(errorLine(missing)).toMatch(/^Error: ENOENT: no such file or directory, open '\[path\]' \(test\/log\.test\.ts:\d+:\d+\)$/);
    expect(errorLine(new Error("cannot read C:\\Users\\marie\\notes.txt or ~/notes.md, nor ./a/b"))).toMatch(
      /^Error: cannot read \[path\] or \[path\], nor \[path\] \(/,
    );
    expect(errorLine("EACCES /private/var/folders/x")).toBe("EACCES [path]");
    // Where in AgentOS it happened is still said.
    expect(errorLine(new TypeError("x is undefined"))).toMatch(/\(test\/log\.test\.ts:\d+:\d+\)$/);
  });
});

describe("what the core writes in it", () => {
  it("tells the story of a conversation without a word of it", async () => {
    const lines: string[] = [];
    core = await startTestCore({ log: (line) => lines.push(line) });
    const events = await core.stream();
    const { code } = PairingCode.parse((await core.local.post("/v1/pairing-codes")).body);
    const paired = PairResponse.parse((await core.local.as(null).post("/v1/pair", { code, device: { name: "Marie's iPhone", platform: "ios" } })).body);
    const phone = core.local.as(paired.token);

    await phone.post("/v1/threads/main/messages", { text: "delete the build folder, it is full of private-things" });
    const asked = (await events.find("item.added", (e) => e.item.type === "request")).item as RequestItem;
    await phone.post(`/v1/requests/${asked.id}/resolve`, { optionId: "approve", text: "yes, the secret-reason is fine" });
    const done = await events.find("turn.completed");
    await core.local.patch("/v1/node", { autonomy: "autonomous" });
    // Even left to itself, the agent is kept away from what is AgentOS's own — and that is written down.
    const verdict = await core.host("main").authorize({ tool: "Bash", input: { command: `cat ${core.home}/local-token` } });
    expect(verdict).toMatchObject({ allow: false, message: expect.stringContaining("closed to you") });
    await core.local.call("DELETE", `/v1/devices/${paired.device.id}`);
    events.close();

    expect(lines).toEqual([
      expect.stringMatching(/^AgentOS \d+\.\d+\.\d+ started on port \d+ \(engine mock, voice device, computer not available\)$/),
      "Engine mock: ready",
      "A pairing code was made, by this computer",
      `A device was added: ios (${paired.device.id})`,
      "Working",
      `Asked the owner: approval, high risk (${asked.id})`,
      "Waiting for the owner (1)",
      `Request resolved: approve from ${paired.device.id} (${asked.id})`,
      "Working",
      "Idle",
      "Turn ended in main: ok",
      "Autonomy changed from balanced to autonomous, by this computer",
      "Refused: Bash reached for AgentOS's own data (main)",
      `A device was removed (${paired.device.id})`,
    ]);
    // Not what was said, not what would be run, not the answer, not a name, not a path, not a token.
    const journal = lines.join("\n");
    for (const secret of ["private-things", "secret-reason", "rm -rf", done.text, "Marie", core.home, paired.token, core.localToken, code]) {
      expect(journal).not.toContain(secret);
    }
  });

  it("records an error nobody expected by its route and kind, not by what it was working on", async () => {
    const lines: string[] = [];
    const broken: Computer = {
      ...noComputer,
      permissions: async () => {
        throw new RangeError("the permissions helper fell over");
      },
    };
    core = await startTestCore({ computer: broken, log: (line) => lines.push(line) });
    const answer = await core.local.get("/v1/settings?token=not-for-the-log");
    expect([answer.status, answer.body.error.code]).toEqual([500, "internal"]);
    const line = lines.find((entry) => entry.startsWith("Error on")) ?? "";
    expect(line).toMatch(/^Error on GET \/v1\/settings: RangeError: the permissions helper fell over \(.+:\d+:\d+\)$/);
    expect(line).not.toContain("not-for-the-log");
  });

  it("names a job by its id only", async () => {
    const lines: string[] = [];
    core = await startTestCore({ log: (line) => lines.push(line) });
    const events = await core.stream();
    await core.local.post("/v1/threads/main/messages", { text: "start a job please" });
    const job = (await events.find("thread.updated", (e) => e.thread.kind === "job")).thread;
    await events.find("turn.completed", (e) => e.threadId === job.id);
    await events.find("turn.completed", (e) => e.threadId === "main" && e.text === "The background work is finished.");
    events.close();
    expect(lines.filter((line) => line.includes("Job"))).toEqual([`Job started (${job.id})`]);
    expect(lines).toContain(`Turn ended in ${job.id}: ok`);
    expect(lines.join("\n")).not.toContain("Practice run");
  });
});
