// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — start a command in a directory, in a process group of its own, its
// two outputs streamed to two files as they arrive; end a group with a signal,
// a grace, and a kill. It knows no vault and no run: what it is handed is a
// command, a working directory, an environment and two file paths, and what it
// answers is a pid, a group id and a promise of how it ended.
//
// THE GROUP IS THE WHOLE POINT. An automation is `make` starting `python`
// starting a harness starting a shell, and a signal sent to the pid alone ends
// the first of those and orphans the rest — which is exactly the process left
// holding a workspace open that the shell's stdin pipe exists to prevent one
// layer up. `detached: true` makes the child the leader of a new session and
// group on every POSIX system, so `kill(-pgid)` reaches everything it started,
// however deep. Windows has no groups; there the pid is the group and a tree
// is ended with `taskkill /T`, which is the one platform branch in this file.
//
// STDIN IS CLOSED, NOT INHERITED. A harness that finds a terminal on its stdin
// waits on it, and there is nobody at the other end. `ignore` hands the child
// end of file the moment it asks.
//
// THE FILES ARE OPENED HERE AND HANDED TO THE KERNEL, not read through this
// process: the child's stdout IS the file descriptor, so the bytes arrive
// however fast the child writes them, nothing here buffers, and a server that
// restarts leaves the log exactly as far as the child got.

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";

import type { ProcessRunner, Started } from "../../contracts/types.ts";

const WINDOWS = process.platform === "win32";

/** How long `end` waits between TERM and KILL when the caller names nothing. */
export const DEFAULT_GRACE = 5000;

/** WHEN A PROCESS STARTED, as the system records it, or null where it will
 *  not say. A pid is reused — after a reboot, or after enough processes have
 *  come and gone — so a row that remembers only a pid cannot tell its own
 *  process from a stranger's that happens to wear the number now; a row that
 *  remembers the start time can. On Linux it is field 22 of `/proc/<pid>/stat`,
 *  the start in clock ticks since boot, read past the last `)` because the
 *  command name before it may hold spaces and parentheses. Elsewhere `ps`
 *  answers `lstart`, which is a wall-clock string and equally stable for one
 *  process. */
function bornAt(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const tail = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      // The fields after the name start at index 3 of the whole line, so the
      // 22nd field is index 22 - 3 = 19 of the tail.
      return tail[19] ?? null;
    } catch {
      return null;
    }
  }
  if (WINDOWS) return null;
  try {
    const out = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
    const said = new TextDecoder().decode(out.stdout).trim();
    return said === "" ? null : said;
  } catch {
    return null;
  }
}

/** Is a pid alive, without touching it — and, given `born`, is it still the
 *  process that was started rather than a stranger wearing a reused number.
 *  Signal 0 is the POSIX question and `ESRCH` the answer that means no;
 *  `EPERM` means it is somebody else's and therefore there, which with no
 *  `born` to compare is the honest answer and with one is answered by the
 *  comparison. */
function alive(pid: number, born?: string | null): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  let there: boolean;
  try {
    process.kill(pid, 0);
    there = true;
  } catch (e) {
    there = (e as { code?: string }).code === "EPERM";
  }
  if (!there) return false;
  if (born === undefined || born === null) return true;
  const now = bornAt(pid);
  // A system that will not say now but did then: the pid is all there is.
  return now === null ? true : now === born;
}

/** Send a signal to a whole group, or on Windows to the pid, swallowing the
 *  one error that means it is already gone. */
function signal(pgid: number, sig: NodeJS.Signals): boolean {
  try {
    if (WINDOWS) {
      // No groups, no TERM: `taskkill /T /F` is the tree kill, and it is the
      // same act whichever signal was asked for.
      spawn("taskkill", ["/PID", String(pgid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-pgid, sig);
    }
    return true;
  } catch (e) {
    return (e as { code?: string }).code !== "ESRCH";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The one runner. Constructed by the composition root and handed down; a test
 *  hands `runs.ts` a fake with the same three members. */
export function makeProcessRunner(): ProcessRunner {
  return {
    start(spec): Started {
      const [cmd, ...args] = spec.cmd;
      if (cmd === undefined || cmd === "") throw new Error("a command has to name something to run");
      // Opened for append, so a run whose directory already holds a log from
      // a previous attempt at the same id — which never happens, ids are
      // random — would extend it rather than truncate it. Closed the moment the
      // child holds its own copies: a descriptor kept open here is a file this
      // process could not let go of.
      const out = openSync(spec.stdout, "a");
      const err = openSync(spec.stderr, "a");
      let child;
      try {
        child = spawn(cmd, args, {
          cwd: spec.cwd,
          env: spec.env,
          stdio: ["ignore", out, err],
          detached: !WINDOWS,
          windowsHide: true,
        });
      } finally {
        closeSync(out);
        closeSync(err);
      }
      // Detached, so the parent's exit would otherwise wait on the child; the
      // lifetime is the caller's business and it ends groups by name.
      child.unref();

      const done = new Promise<{ exit: number | null; signal: string | null }>((resolve) => {
        let settled = false;
        const settle = (exit: number | null, sig: string | null) => {
          if (settled) return;
          settled = true;
          resolve({ exit, signal: sig });
        };
        // A command that does not exist arrives as `error` with no `exit` at
        // all, and a promise that never settled would be a run that never
        // ended. The row says what the process said: nothing, and a signal-
        // shaped word for why.
        child.on("error", (e: NodeJS.ErrnoException) => settle(null, e.code ?? "ERROR"));
        child.on("exit", (code, sig) => settle(code, sig));
      });

      const pid = child.pid;
      if (pid === undefined) {
        // `spawn` answers no pid when the exec itself failed; the `error`
        // event above says why. The caller gets a row it can mark.
        return { pid: -1, pgid: -1, born: null, done };
      }
      return { pid, pgid: pid, born: bornAt(pid), done };
    },

    async end(pgid: number, grace = DEFAULT_GRACE): Promise<void> {
      if (!signal(pgid, "SIGTERM")) return;
      // Polled rather than awaited, because the group is more than one pid and
      // the only handle this file holds is the leader's. The leader going is
      // taken as the group going: children it started are in its group and
      // received the same TERM, and the KILL below reaches any that ignored it.
      const until = Date.now() + Math.max(0, grace);
      while (Date.now() < until) {
        if (!alive(pgid)) break;
        await sleep(50);
      }
      signal(pgid, "SIGKILL");
      // One more short wait so a caller reading the table after this sees the
      // exit the promise above is about to deliver.
      const gone = Date.now() + 1000;
      while (alive(pgid) && Date.now() < gone) await sleep(20);
    },

    killNow(pgid) {
      signal(pgid, "SIGKILL");
    },

    alive,
  };
}
