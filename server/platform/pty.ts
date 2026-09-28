// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — a pseudo-terminal. Raw capability with no vocabulary: start ONE
// command in a directory the caller already resolved, carry its bytes both
// ways, resize it, say how it ended, and end it — the whole tree it started, not
// just the command's own pid.
//
// IT KNOWS NOTHING ABOUT A VAULT, AN AGENT OR A SIGN-IN. It is handed a command,
// a directory and an environment and answers a `Pty`; which command may run,
// who may type into it and how long it lives are
// `server/workspace/terminals.ts`'s questions. That split is Zed's, read at
// source (process, terminal model, view), and it is what lets the sign-in run
// be tested against a fake spawner with nothing started anywhere.
//
// A REAL PTY, NOT PIPES. An agent's sign-in asks `isatty` before it draws a
// prompt, a code pasted into it is read by a line discipline, and Ctrl+C is a
// byte that discipline turns into SIGINT for the foreground job. Bun's own
// `terminal` spawn option is the whole of it — measured on macOS with Bun 1.4.2:
// a real `/dev/ttys…`, the directory it was given, the size it was given, a
// resize that `stty size` reads back, and the command's own exit code.
//
// THE COMMAND IS A SESSION LEADER, and ending one is built on that. Its pid is
// its process group, so a signal to `-pid` reaches everything it started in the
// foreground — but a command that runs jobs of its own (a shell, above all) may
// put each in a group of its own, so the group alone misses a `sleep 60 &`.
// `end` therefore walks the process table for descendants first and signals
// every pid and every group it finds. What it cannot promise is a process that
// deliberately left: a daemon reparented to init is nobody's child, and nothing
// here pretends otherwise.

import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

// Declared rather than pulled in as types, for the reason `server/main.ts` gives:
// nothing the server runs is a dependency.
declare const Bun: {
  spawn(
    cmd: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      terminal: { cols: number; rows: number; data(terminal: unknown, bytes: Uint8Array): void };
    },
  ): {
    pid: number;
    exited: Promise<number>;
    exitCode: number | null;
    signalCode: string | null;
    terminal?: { write(data: string): number; resize(cols: number, rows: number): void; close(): void };
  };
  spawnSync(cmd: string[], options?: { stdout?: "pipe"; stderr?: "ignore" }): { stdout?: { toString(): string } | null; success: boolean };
  which(command: string, options?: { PATH?: string; cwd?: string }): string | null;
};
declare const process: {
  platform: string;
  kill(pid: number, signal?: string | number): boolean;
};

/** How a command ended. Exactly one of the two is set once it has. */
export interface PtyExit {
  code: number | null;
  signal: string | null;
}

export interface Pty {
  pid: number;
  /** The absolute path of the program that was started. */
  command: string;
  cwd: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Resolves once, when the command has gone — however it went. */
  exited: Promise<PtyExit>;
  /** HANG UP, THEN ASK, THEN INSIST, across the whole tree. Answers whether the
   *  command is gone; `false` is a termination that failed and must be said as
   *  one, never read as a close. */
  end(): Promise<boolean>;
  /** The same tree, SIGKILL, now, and nothing awaited — for a process that is
   *  itself exiting and will run no timer again. */
  kill(): void;
}

export interface PtyOptions {
  /** THE PROGRAM AND ITS ARGUMENTS, as an argument vector and never as a line:
   *  nothing here is handed to a shell to be split or expanded, so an argument
   *  is exactly one argument whatever it holds. The program is an absolute
   *  path, a path relative to `cwd`, or a bare name found on `env.PATH`. Who
   *  decides WHICH command may run is the caller's question, and this module
   *  does not ask it. */
  command: string[];
  /** Absolute and already resolved. It is never defaulted: a command that
   *  cannot start where it was asked does not start somewhere else. */
  cwd: string;
  cols: number;
  rows: number;
  /** The environment to start it in. `scrubEnv` decides what of it the command
   *  may see. */
  env: Record<string, string | undefined>;
  onData(bytes: Uint8Array): void;
}

/** A refusal with a sentence a person can act on — it names the program or the
 *  folder that failed, and nothing else. */
export class PtyError extends Error {
  override name = "PtyError";
}

/* ── pure, and therefore testable ─────────────────────────────────────── */

/** Which shell, and what to start it with. NOTHING HERE CALLS IT any more — the
 *  terminal runs one command it is handed rather than a shell — and it stays
 *  exported only because reading the person's login environment is to reuse
 *  it (`server/platform/loginenv.ts`, whose own layer cannot import it; its
 *  composition root can hand it the answer).
 *
 *  A LOGIN SHELL ON UNIX, and that is the PATH answer rather than a taste. An
 *  application started from the dock or a desktop launcher inherits the session's
 *  bare PATH, not the one a developer's own terminal built out of `.zprofile` —
 *  so `claude`, installed under a Homebrew or npm prefix, is "command not found"
 *  in a shell that skipped its profile. `-l` reads it, every shell here takes it,
 *  and it is what Terminal.app and iTerm start too.
 *
 *  `$SHELL` WINS WHEN IT IS REAL: absolute, a file, executable. Otherwise the
 *  first of the platform's usual shells that is. A missing shell is null rather
 *  than a guess, and the caller says so by name.
 *
 *  @param usable asks the disk; a test hands in a set. */
export function findShell(
  env: Record<string, string | undefined>,
  platform: string,
  usable: (path: string) => boolean,
): { path: string; args: string[] } | null {
  if (platform === "win32") {
    const candidates = [env.COMSPEC, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "C:\\Windows\\System32\\cmd.exe"];
    for (const c of candidates) if (c && usable(c)) return { path: c, args: [] };
    return null;
  }
  const named = env.SHELL;
  if (named && isAbsolute(named) && usable(named)) return { path: named, args: ["-l"] };
  const usual = platform === "darwin" ? ["/bin/zsh", "/bin/bash", "/bin/sh"] : ["/bin/bash", "/usr/bin/bash", "/bin/zsh", "/bin/sh"];
  for (const c of usual) if (usable(c)) return { path: c, args: ["-l"] };
  return null;
}

/** THE COMMAND'S ENVIRONMENT: the person's own, minus this program's plumbing.
 *
 *  PRESERVED on purpose: PATH, HOME, every credential variable an agent CLI reads
 *  its login out of. The CLI is the person's and so is its authentication; a
 *  terminal that stripped `ANTHROPIC_API_KEY` would be a terminal where their
 *  agent does not sign in.
 *
 *  STRIPPED: every `BIOM_` marker — `BIOM_SHELL` in particular, which tells a
 *  server that the pipe on its stdin is its parent, and nothing started here may
 *  believe that — the variables that choose a vault, a list and a port for a
 *  server, and the font cache the desktop shell pointed itself at on Linux,
 *  which is the application's and not the person's.
 *
 *  ADDED: what a terminal is. `TERM` for the emulator on the other end, and a
 *  UTF-8 `LANG` only where none was set, which is what a Finder-launched process
 *  on macOS has — and a program with no locale draws every non-ASCII character
 *  as a question mark. */
export function scrubEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const ownCache = env.BIOM_OWN_CACHE === "1";
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("BIOM_")) continue;
    if (key === "VAULT" || key === "VAULTS" || key === "PORT") continue;
    if (key === "XDG_CACHE_HOME" && ownCache) continue;
    out[key] = value;
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  out.TERM_PROGRAM = "Biom";
  if (!out.LANG && !out.LC_ALL && !out.LC_CTYPE) out.LANG = "en_US.UTF-8";
  return out;
}

/** One row of `ps -Ao pid=,ppid=,pgid=`. Garbage lines are skipped: the table is
 *  a snapshot of a moving machine and this reads it for what it can. */
export function parsePs(text: string): { pid: number; ppid: number; pgid: number }[] {
  const rows: { pid: number; ppid: number; pgid: number }[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [pid, ppid, pgid] = parts.map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid)) continue;
    rows.push({ pid: pid as number, ppid: ppid as number, pgid: pgid as number });
  }
  return rows;
}

/** Every descendant of `root`, and every process group any of them — or `root`
 *  itself — leads. Groups 0 and 1 are never answered: signalling either is
 *  signalling the machine. */
export function treeOf(rows: { pid: number; ppid: number; pgid: number }[], root: number): { pids: number[]; groups: number[] } {
  const children = new Map<number, number[]>();
  for (const r of rows) {
    const list = children.get(r.ppid) ?? [];
    list.push(r.pid);
    children.set(r.ppid, list);
  }
  const pids: number[] = [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const at = queue.shift() as number;
    for (const kid of children.get(at) ?? []) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      pids.push(kid);
      queue.push(kid);
    }
  }
  const groups = new Set<number>([root]);
  for (const r of rows) if (seen.has(r.pid)) groups.add(r.pgid);
  groups.delete(0);
  groups.delete(1);
  return { pids, groups: [...groups] };
}

/* ── the capability ───────────────────────────────────────────────────── */

const executable = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** WHERE THE PROGRAM IS, or null. An absolute path is taken as it is, a path
 *  with a separator in it is read from `cwd`, and a bare name is looked up on
 *  the `PATH` of the environment the command will run in — not the server's,
 *  which a desktop launcher leaves bare. Either way the answer is an executable
 *  file or nothing. */
function locate(program: string, cwd: string, env: Record<string, string | undefined>): string | null {
  if (isAbsolute(program)) return executable(program) ? program : null;
  if (program.includes("/") || program.includes("\\")) {
    const path = resolve(cwd, program);
    return executable(path) ? path : null;
  }
  return Bun.which(program, { PATH: env.PATH ?? "", cwd });
}

/** How long each step of `end` waits for the command to go before the next. The
 *  exact numbers are not a requirement — Zed's are not Biom's — but the ladder
 *  is: a hangup lets an editor save a swap file, a TERM is asked, a KILL is not. */
const HANGUP_WAIT = 800;
const TERM_WAIT = 1500;
const KILL_WAIT = 1500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Start one command in `cwd` on a new pseudo-terminal. Throws `PtyError` with
 *  a sentence naming what failed; never falls back to another folder or
 *  program. */
export async function spawnPty(opts: PtyOptions): Promise<Pty> {
  const platform = process.platform;
  let dir = false;
  try {
    dir = statSync(opts.cwd).isDirectory();
  } catch {
    dir = false;
  }
  if (!isAbsolute(opts.cwd) || !dir) throw new PtyError(`the workspace folder ${opts.cwd} is not there, so nothing was started`);

  const [program, ...args] = opts.command;
  if (program === undefined || program === "") throw new PtyError("no command was named, so nothing was started");
  const path = locate(program, opts.cwd, opts.env);
  if (path === null) throw new PtyError(`${program} is not a program on this machine, so it was not started`);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([path, ...args], {
      cwd: opts.cwd,
      env: scrubEnv(opts.env),
      terminal: { cols: opts.cols, rows: opts.rows, data: (_t, bytes) => opts.onData(bytes) },
    });
  } catch (e) {
    throw new PtyError(`${path} could not be started in ${opts.cwd}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const term = proc.terminal;
  if (!term) throw new PtyError(`${path} started without a terminal — this runtime has no PTY support`);

  let gone = false;
  const exited: Promise<PtyExit> = proc.exited.then(() => {
    gone = true;
    // The master is closed a beat after the command goes, so output the kernel
    // has already queued still reaches `onData` rather than being cut mid-line.
    setTimeout(() => {
      try {
        term.close();
      } catch {
        /* already closed */
      }
    }, 100);
    return { code: proc.exitCode, signal: proc.signalCode };
  });

  /** The tree as it stands right now. Asked each time, because a job started a
   *  second ago is part of it and one that finished is not. */
  const tree = (): { pids: number[]; groups: number[] } => {
    if (platform === "win32") return { pids: [], groups: [] };
    try {
      const ps = Bun.spawnSync(["ps", "-Ao", "pid=,ppid=,pgid="], { stdout: "pipe", stderr: "ignore" });
      return treeOf(parsePs(ps.stdout?.toString() ?? ""), proc.pid);
    } catch {
      return { pids: [], groups: [proc.pid] };
    }
  };

  const signal = (t: { pids: number[]; groups: number[] }, sig: string): void => {
    if (platform === "win32") {
      try {
        Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], { stderr: "ignore" });
      } catch {
        /* reported by the caller when the command does not go */
      }
      return;
    }
    for (const g of t.groups) {
      try {
        process.kill(-g, sig);
      } catch {
        /* that group has already gone */
      }
    }
    for (const pid of [proc.pid, ...t.pids]) {
      try {
        process.kill(pid, sig);
      } catch {
        /* that process has already gone */
      }
    }
  };

  const within = async (ms: number): Promise<boolean> => {
    if (gone) return true;
    await Promise.race([exited, sleep(ms)]);
    return gone;
  };

  let ending: Promise<boolean> | null = null;

  return {
    pid: proc.pid,
    command: path,
    cwd: opts.cwd,
    write(data) {
      if (gone) return;
      term.write(data);
    },
    resize(cols, rows) {
      if (gone) return;
      term.resize(cols, rows);
    },
    exited,
    end() {
      if (ending) return ending;
      ending = (async () => {
        // Collected BEFORE the hangup, because a command that goes first
        // reparents its children to init and they are nobody's descendants any
        // more.
        const before = tree();
        signal(before, "SIGHUP");
        if (!(await within(HANGUP_WAIT))) {
          signal(tree(), "SIGTERM");
          if (!(await within(TERM_WAIT))) {
            signal(tree(), "SIGKILL");
            await within(KILL_WAIT);
          }
        }
        // Whatever the command left behind that ignored the hangup — a job it
        // disowned on the way out — is still the tree this terminal started.
        if (gone && platform !== "win32") signal({ pids: before.pids, groups: before.groups.filter((g) => g !== proc.pid) }, "SIGKILL");
        return gone;
      })();
      return ending;
    },
    kill() {
      if (gone) return;
      signal(tree(), "SIGKILL");
    },
  };
}
