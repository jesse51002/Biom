// SPDX-License-Identifier: AGPL-3.0-only
// The pseudo-terminal, against a real shell where there is one.
//
// What is held here is what the spec's acceptance table asks of the process
// half: a real TTY in the directory it was given at the size it was given, a
// resize the shell can read back, an honest exit status, a failure that names
// the folder or the shell rather than falling back somewhere else, and an end
// that takes the whole tree — including a job an interactive shell put in a
// process group of its own, which a signal to the shell's group alone misses.

import { test, expect } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findShell, parsePs, scrubEnv, spawnPty, treeOf, PtyError } from "../server/platform/pty.ts";

const unix = process.platform !== "win32";

/* ── pure ──────────────────────────────────────────────────────────────── */

test("a real $SHELL wins, and a login shell is what starts", () => {
  const usable = (p: string) => ["/bin/fish", "/bin/zsh", "/bin/bash", "/bin/sh"].includes(p);
  expect(findShell({ SHELL: "/bin/fish" }, "linux", usable)).toEqual({ path: "/bin/fish", args: ["-l"] });
  // Not absolute, or not there: the platform's usual shells, in order.
  expect(findShell({ SHELL: "fish" }, "darwin", usable)).toEqual({ path: "/bin/zsh", args: ["-l"] });
  expect(findShell({ SHELL: "/opt/gone" }, "linux", usable)).toEqual({ path: "/bin/bash", args: ["-l"] });
  // Nothing usable is null, never a guess.
  expect(findShell({}, "linux", () => false)).toBeNull();
  expect(findShell({ COMSPEC: "C:\\cmd.exe" }, "win32", (p) => p === "C:\\cmd.exe")).toEqual({ path: "C:\\cmd.exe", args: [] });
});

test("the shell keeps the person's environment and loses this program's plumbing", () => {
  const env = scrubEnv({
    PATH: "/usr/bin",
    HOME: "/home/me",
    ANTHROPIC_API_KEY: "kept",
    BIOM_SHELL: "1",
    BIOM_ENV: "production",
    BIOM_OWN_CACHE: "1",
    XDG_CACHE_HOME: "/data/Biom/cache",
    VAULT: "/somewhere",
    VAULTS: "/list.json",
    PORT: "4400",
    UNSET: undefined,
  });
  expect(env.PATH).toBe("/usr/bin");
  expect(env.ANTHROPIC_API_KEY).toBe("kept");
  for (const gone of ["BIOM_SHELL", "BIOM_ENV", "BIOM_OWN_CACHE", "XDG_CACHE_HOME", "VAULT", "VAULTS", "PORT", "UNSET"]) {
    expect([gone, gone in env]).toEqual([gone, false]);
  }
  expect(env.TERM).toBe("xterm-256color");
  expect(env.LANG).toBe("en_US.UTF-8");
  // A cache the person set themselves is theirs, and a locale they set is kept.
  expect(scrubEnv({ XDG_CACHE_HOME: "/mine", LANG: "fr_FR.UTF-8" })).toMatchObject({ XDG_CACHE_HOME: "/mine", LANG: "fr_FR.UTF-8" });
});

test("the tree is every descendant and every group they lead, never 0 or 1", () => {
  const rows = parsePs(`
    1     0     1
    100   1   100
    101 100   100
    102 100   102
    103 102   102
    200   1   200
    garbage line
  `);
  const t = treeOf(rows, 100);
  expect(t.pids.sort()).toEqual([101, 102, 103]);
  expect(t.groups.sort()).toEqual([100, 102]);
  expect(treeOf(parsePs("5 1 1\n6 5 0"), 5).groups).toEqual([5]);
});

/* ── a real shell ──────────────────────────────────────────────────────── */

const SH = { ...process.env, SHELL: "/bin/sh" };

async function started(cwd: string) {
  let out = "";
  const pty = await spawnPty({ cwd, cols: 93, rows: 31, env: SH, onData: (b) => { out += new TextDecoder().decode(b); } });
  return { pty, said: () => out };
}

async function waitFor(what: string, ok: () => boolean, ms = 8000) {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error(`never: ${what}`);
    await Bun.sleep(25);
  }
}

test.if(unix)("a real TTY, in the folder it was given, at the size it was given", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biom-pty-"));
  try {
    const { pty, said } = await started(dir);
    pty.write("tty; pwd; stty size; echo done-$((40+2))\r");
    await waitFor("the shell answered", () => said().includes("done-42"));
    expect(said()).toMatch(/\/dev\/(tty|pts)/);
    expect(said()).toContain(realpathSync(dir));
    expect(said()).toContain("31 93");

    pty.resize(120, 40);
    pty.write("stty size\r");
    await waitFor("the resize was read back", () => said().includes("40 120"));

    pty.write("exit 7\r");
    expect(await pty.exited).toEqual({ code: 7, signal: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.if(unix)("a folder that is not there is refused by name, and nothing starts anywhere else", async () => {
  const missing = join(tmpdir(), "biom-pty-not-there-" + Date.now());
  const refused = await spawnPty({ cwd: missing, cols: 80, rows: 24, env: SH, onData: () => {} }).catch((e) => e);
  expect(refused).toBeInstanceOf(PtyError);
  expect(String(refused.message)).toContain(missing);
});

test.if(unix)("END TAKES THE TREE — a background job in a group of its own included", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biom-pty-"));
  try {
    const { pty, said } = await started(dir);
    // `set -m` is job control: each job gets its own process group, which is
    // exactly what an interactive shell does and what a group kill alone misses.
    const marker = `biom-${process.pid}-${Date.now()}`;
    pty.write(`set -m; sleep 300 & echo ${marker}-$!\r`);
    await waitFor("the job started", () => new RegExp(`${marker}-\\d+`).test(said()));
    const job = Number(new RegExp(`${marker}-(\\d+)`).exec(said())?.[1]);
    expect(Number.isInteger(job)).toBe(true);
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(job)).toBe(true);

    expect(await pty.end()).toBe(true);
    await pty.exited;
    await waitFor("the job went with the shell", () => !alive(job), 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
