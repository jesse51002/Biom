// SPDX-License-Identifier: AGPL-3.0-only
// The process runner, against real processes. A sleeper is started in a group
// of its own, its output lands in the two files as it writes, and ending the
// group leaves nothing of it — the child AND the grandchild it started, which
// is the whole reason there is a group. Skipped by name on Windows, where the
// group is the tree kill and `pgrep` is not there to ask.

import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProcessRunner } from "../server/platform/process.ts";

const POSIX = process.platform !== "win32";
const only = POSIX ? test : test.skip;

const scratch = () => mkdtempSync(join(tmpdir(), "biom-process-"));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pids in the group `pgid`, asked of the system rather than of this process. */
async function groupPids(pgid: number): Promise<number[]> {
  const p = Bun.spawn(["pgrep", "-g", String(pgid)], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.split("\n").filter((l) => l.trim() !== "").map(Number);
}

only("starts a command in its own group, streams both outputs to files, and reports the exit", async () => {
  const dir = scratch();
  const runner = makeProcessRunner();
  const started = runner.start({
    cmd: ["sh", "-c", "echo out one; echo err one >&2; sleep 0.2; echo out two; exit 3"],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    stdout: join(dir, "stdout.log"),
    stderr: join(dir, "stderr.log"),
  });
  expect(started.pid).toBeGreaterThan(0);
  // A group of its own: the leader's group is its own pid, not ours.
  expect(started.pgid).toBe(started.pid);
  expect(started.pgid).not.toBe(process.pid);
  expect(runner.alive(started.pid)).toBe(true);
  const ended = await started.done;
  expect(ended).toEqual({ exit: 3, signal: null });
  expect(readFileSync(join(dir, "stdout.log"), "utf8")).toBe("out one\nout two\n");
  expect(readFileSync(join(dir, "stderr.log"), "utf8")).toBe("err one\n");
  rmSync(dir, { recursive: true, force: true });
});

only("ending the group takes the grandchild with it, and nothing of it is left", async () => {
  const dir = scratch();
  const runner = makeProcessRunner();
  // A shell that starts a sleeper and waits on it: two processes, one group.
  // The sleeper ignores TERM, so only the KILL after the grace ends it — which
  // is the branch worth proving.
  const started = runner.start({
    cmd: ["sh", "-c", "trap '' TERM; sleep 30 & wait"],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    stdout: join(dir, "stdout.log"),
    stderr: join(dir, "stderr.log"),
  });
  await wait(300);
  const before = await groupPids(started.pgid);
  expect(before.length).toBeGreaterThanOrEqual(2);
  expect(before).toContain(started.pid);

  const t0 = Date.now();
  await runner.end(started.pgid, 300);
  const took = Date.now() - t0;
  // TERM was ignored, so it waited the grace and then killed — not forever.
  expect(took).toBeGreaterThanOrEqual(250);
  expect(took).toBeLessThan(5000);

  const ended = await started.done;
  expect(ended.signal).toBe("SIGKILL");
  expect(runner.alive(started.pid)).toBe(false);
  // The whole group is gone, asked of the system.
  await wait(100);
  expect(await groupPids(started.pgid)).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

only("a command that does not exist settles with no exit and a reason, rather than never", async () => {
  const dir = scratch();
  const runner = makeProcessRunner();
  const started = runner.start({
    cmd: ["/definitely/not/a/program"],
    cwd: dir,
    env: { PATH: "" },
    stdout: join(dir, "stdout.log"),
    stderr: join(dir, "stderr.log"),
  });
  const ended = await started.done;
  expect(ended.exit).toBeNull();
  expect(ended.signal).toBe("ENOENT");
  rmSync(dir, { recursive: true, force: true });
});

only("a started process carries its birth, and alive tells the same pid with another birth apart", async () => {
  const dir = scratch();
  const runner = makeProcessRunner();
  const started = runner.start({ cmd: ["sleep", "5"], cwd: dir, env: { PATH: process.env.PATH ?? "" }, stdout: join(dir, "o"), stderr: join(dir, "e") });
  expect(started.born).not.toBeNull();
  expect(runner.alive(started.pid)).toBe(true);
  expect(runner.alive(started.pid, started.born)).toBe(true);
  // The same number with a different birth is a stranger wearing it — the
  // reused-pid case — and answers dead, so a row from before a reboot is
  // marked lost rather than kept, counted, asked about and killed.
  expect(runner.alive(started.pid, "not-this-one")).toBe(false);
  await runner.end(started.pgid, 100);
  await started.done;
  expect(runner.alive(started.pid, started.born)).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

only("alive answers no for a pid that is gone and for nonsense", async () => {
  const runner = makeProcessRunner();
  expect(runner.alive(0)).toBe(false);
  expect(runner.alive(-5)).toBe(false);
  // A process that has ended and been reaped.
  const p = Bun.spawn(["true"]);
  const pid = p.pid;
  await p.exited;
  await wait(50);
  expect(runner.alive(pid)).toBe(false);
  // Ending a group that is not there is not an error.
  await runner.end(pid, 10);
});
