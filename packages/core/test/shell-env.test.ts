/** Taking the owner's environment from their shell, with scripts standing in for the shell. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adoptShellEnvironment } from "../src/shell-env.js";
import { tempHome } from "./harness.js";

/** Writes a script to stand in for a shell called `name`. It is run as `<shell> -l -i -c <command>`. */
function fakeShell(script: string, name = "zsh"): string {
  const dir = join(tempHome(), "bin");
  mkdirSync(dir);
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** What a profile does before the shell runs our command: sets up the owner's tools. */
const PROFILE = `
export PATH="/opt/owner/bin:/Users/owner/.tools/bin:$PATH"
export OWNER_SDK=/opt/owner/sdk
export ANTHROPIC_API_KEY=key-from-the-profile
export AGENTOS_ENGINE=claude
`;
const RUN = 'eval "$4"';
const bare = (shell: string, more: Record<string, string> = {}): NodeJS.ProcessEnv => ({ HOME: "/Users/owner", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: shell, ...more });

describe("the owner's shell environment", () => {
  it("completes a bare environment: the shell's PATH first, and what was missing", async () => {
    const seen = join(tempHome(), "args");
    const env = bare(fakeShell(`echo "$1 $2 $3" > ${seen}\n${PROFILE}\n${RUN}`));
    const outcome = await adoptShellEnvironment(env);

    // Asked the way a terminal window starts a shell: login and interactive, so both kinds of profile are read.
    expect(readFileSync(seen, "utf8").trim()).toBe("-l -i -c");
    expect(env.PATH).toBe("/opt/owner/bin:/Users/owner/.tools/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(env).toMatchObject({ OWNER_SDK: "/opt/owner/sdk", HOME: "/Users/owner", ANTHROPIC_API_KEY: "key-from-the-profile" });
    expect(outcome).toEqual({ shell: "zsh", ok: true, added: expect.any(Number), pathFolders: 6 });
    // The outcome counts; it never carries a value.
    expect(JSON.stringify(outcome)).not.toContain("key-from-the-profile");
    // What only describes the shell we ran to ask is not the owner's setup.
    expect(Object.keys(env)).not.toEqual(expect.arrayContaining(["SHLVL", "_", "OLDPWD"]));
  });

  it("never replaces what the core was given: its own settings win over the profile's", async () => {
    const env = bare(fakeShell(`${PROFILE}\n${RUN}`), { AGENTOS_ENGINE: "mock", ANTHROPIC_API_KEY: "key-for-the-core", OWNER_SDK: "/given/to/the/core" });
    await adoptShellEnvironment(env);
    expect(env).toMatchObject({ AGENTOS_ENGINE: "mock", ANTHROPIC_API_KEY: "key-for-the-core", OWNER_SDK: "/given/to/the/core" });
    expect(env.PATH?.startsWith("/opt/owner/bin:")).toBe(true);
  });

  it("leaves a PATH alone that already has everything the shell's has", async () => {
    const given = "/my/session/bin:/opt/owner/bin:/Users/owner/.tools/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    const env = bare(fakeShell(`export PATH="/opt/owner/bin:/Users/owner/.tools/bin:/usr/bin:/bin:/usr/sbin:/sbin"\n${RUN}`), { PATH: given });
    await adoptShellEnvironment(env);
    expect(env.PATH).toBe(given);
  });

  it("finds the environment in the middle of whatever a profile prints", async () => {
    const noisy = `
echo "Last login: Mon Nov  9 22:31:07 on ttys004"
echo '{"PATH":"/not/this/one"} __agentos_0000000000000000__ {'
printf '\\033[1;32m~ %%\\033[0m '
${PROFILE}
${RUN}
echo
echo "Saving session... } done"`;
    const env = bare(fakeShell(noisy));
    expect(await adoptShellEnvironment(env)).toMatchObject({ ok: true });
    expect(env.PATH).toBe("/opt/owner/bin:/Users/owner/.tools/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(env.OWNER_SDK).toBe("/opt/owner/sdk");
  });

  it("does not wait for a profile that asks a question: there is nobody to answer", async () => {
    const env = bare(fakeShell(`printf "Update now? [y/N] "\nread answer\n${PROFILE}\n${RUN}`));
    expect(await adoptShellEnvironment(env)).toMatchObject({ ok: true });
    expect(env.OWNER_SDK).toBe("/opt/owner/sdk");
  });

  it("gives up on a slow profile, stops it, and leaves the environment as it was", async () => {
    const pidFile = join(tempHome(), "pid");
    const env = bare(fakeShell(`echo $$ > ${pidFile}\nsleep 30\n${PROFILE}\n${RUN}`));
    const before = { ...env };
    const started = Date.now();
    // Long enough for the script to have started (a new executable takes a moment on macOS), far short of its 30 seconds.
    expect(await adoptShellEnvironment(env, 1500)).toEqual({ shell: "zsh", ok: false, why: "no answer in time" });
    expect(Date.now() - started).toBeLessThan(3500);
    expect(env).toEqual(before);
    // The shell we started is not left behind, still sleeping.
    const pid = Number(readFileSync(pidFile, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it.each([
    ["a shell that fails", "exit 3"],
    ["a profile that breaks before the end", `${PROFILE}\nexit 1\n${RUN}`],
    ["a shell that says something else entirely", 'echo "{\\"PATH\\":\\"/somewhere\\"}"'],
  ])("falls back cleanly on %s", async (_what, script) => {
    const env = bare(fakeShell(script));
    const before = { ...env };
    expect(await adoptShellEnvironment(env)).toEqual({ shell: "zsh", ok: false, why: "no usable answer" });
    expect(env).toEqual(before);
  });

  it("falls back cleanly when the shell is not there at all", async () => {
    const env = bare("/no/such/place/bash");
    expect(await adoptShellEnvironment(env)).toEqual({ shell: "bash", ok: false, why: "no usable answer" });
  });

  it("does not try a shell it does not know how to ask", async () => {
    const ran = join(tempHome(), "ran");
    const env = bare(fakeShell(`touch ${ran}\n${RUN}`, "nu"));
    expect(await adoptShellEnvironment(env)).toBeNull();
    expect(existsSync(ran)).toBe(false);
  });

  it.each(["bash", "fish", "sh"])("asks %s the same way", async (name) => {
    const env = bare(fakeShell(`${PROFILE}\n${RUN}`, name));
    expect(await adoptShellEnvironment(env)).toMatchObject({ shell: name, ok: true });
  });
});
