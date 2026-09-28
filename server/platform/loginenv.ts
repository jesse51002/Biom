// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — THE PERSON'S LOGIN-SHELL ENVIRONMENT, read once and handed down.
//
// An agent finds its own tools and its own login in the environment the
// person's shell gives it — `PATH` above all, and a key in the environment
// where that is how the agent signs in. A desktop launcher hands the server
// none of that, so the server asks the person's own login shell for it,
// started interactive and as a login shell — `-i -l -c`, because a `PATH` built
// in `.zshrc` is only read by an interactive one — printing its environment
// NUL-separated, bounded in time, with no terminal and no input. WHICH shell,
// and the environment it starts from, are the composition root's answers:
// `findShell` and `scrubEnv` in `pty.ts`, the terminal's own, which this file
// shares a layer with and so is handed rather than importing. What comes back
// is what the terminal's shell had, and what every agent a chat starts, and
// the sign-in pop-up, are started with.
//
// A NOISY RC FILE IS NORMAL, so what the shell prints is read between two
// random markers and nothing outside them: a `.bash_profile` that echoes a
// greeting, a `fortune`, a `motd` or stray NULs cannot be mistaken for a
// variable. A shell that hangs — an rc file waiting on something that never
// comes — is killed with its whole process group when the bound runs out, and a
// shell that exits leaving a background job holding its output open is not
// waited on past a short drain. A `PATH` a profile RESET rather than extended
// gets the server's own entries back, after its own, so an agent the server
// could see does not vanish because `/etc/profile` wrote a fresh list.
//
// IT IS THE PERSON'S, NOT A WORKSPACE'S: read once per server process —
// `makeLoginEnv` is constructed once, in the composition root — and shared by
// every vault's agents, by the sign-in terminal and by Jev's key: two
// workspaces open at once are one person with one login. It is read again only
// when `forget` drops the reading, which one thing asks for: Check again on an
// agent signed in by a variable the person has just set in their profile,
// which a reading taken at start would never see.
//
// NOTHING HERE IS EVER LOGGED, sent to a client or written to a file: it holds
// the person's keys. A shell that fails, times out or prints nothing usable
// answers the server's own environment, which is the environment the agent
// would have had anyway, and `reason()` says why in words that name no value.
// Windows has no login shell to ask and says so the same way.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";

/** How long the login shell may take. Ten seconds is what editors that do
 *  the same thing allow; a profile slower than that is a profile the person
 *  already waits on in every terminal they open, and the fallback is the
 *  environment the agent would have had without asking. */
export const LOGIN_TIMEOUT = 10_000;
/** After the shell has exited, how long its output may still be arriving. A
 *  background job an rc file started can hold the pipe open forever, so the
 *  end of the pipe is never what is waited for. */
const DRAIN = 500;
/** More than this is not an environment. */
const OUTPUT_CAP = 8 * 1024 * 1024;

/** A variable name worth carrying: the portable spelling. `BASH_FUNC_x%%`
 *  and anything else a shell exports under a name no other program can read
 *  back is left behind. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** What the capturing shell itself set, which is about that shell and not
 *  the person: its level, its last argument, and the folder it ran in, which
 *  an agent started in a vault must not be told is somewhere else. */
const SHELL_OWN = new Set(["_", "SHLVL", "PWD", "OLDPWD"]);

export interface LoginEnvOptions {
  /** The shell to ask, absolute — `findShell`'s answer in `pty.ts`, asked by
   *  the composition root — or null where there is none. */
  shell: string | null;
  /** What the shell starts from, and what a failure answers: the environment
   *  the terminal hands a command, `scrubEnv(process.env)`. */
  base: Record<string, string>;
  timeoutMs?: number;
  /** Absent: `process.platform`. */
  platform?: string;
  /** Where the shell runs. Absent: the home folder, so nothing keyed on a
   *  folder — a `direnv`, a version manager's file — answers for a vault. */
  cwd?: string;
}

/** One reading: the environment, where it came from, and — when it is the
 *  server's own — why, in a sentence that names no value. */
export interface LoginEnvRead {
  env: Record<string, string>;
  from: "shell" | "server";
  reason: string | null;
}

/** The login environment, read once and kept. */
export interface LoginEnv {
  /** The environment. The first call asks the shell; every call after it,
   *  concurrent ones included, answers the same reading — until `forget`. */
  read(): Promise<Record<string, string>>;
  /** Drop the reading: the next `read` asks the shell again, bounded as the
   *  first was, and every read after that answers the new one. */
  forget(): void;
  /** Why the reading is the server's own environment, or null — null too
   *  while the first reading has not landed. */
  reason(): string | null;
}

/** Is `path` a file this process may execute — what `findShell` asks of a
 *  candidate, for the composition root to hand it. */
export const executable = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Pure: the variables between the two markers, or null where the markers
 *  are not both there in order or nothing usable lies between them. */
export function parseEnvBlock(out: Uint8Array, start: string, end: string): Record<string, string> | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(out);
  const from = text.indexOf(start);
  if (from < 0) return null;
  const to = text.indexOf(end, from + start.length);
  if (to < 0) return null;
  const env: Record<string, string> = {};
  let count = 0;
  for (const pair of text.slice(from + start.length, to).split("\u0000")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    if (!NAME.test(name)) continue;
    env[name] = pair.slice(eq + 1);
    count++;
  }
  return count === 0 ? null : env;
}

/** Pure: the login shell's `PATH`, then every entry of the server's own it
 *  dropped, in the server's order. */
export function mergePath(login: string | undefined, server: string | undefined, platform: string): string | undefined {
  const sep = platform === "win32" ? ";" : ":";
  if (login === undefined) return server;
  if (server === undefined) return login;
  const have = new Set(login.split(sep));
  const extra = server.split(sep).filter((entry) => entry !== "" && !have.has(entry));
  return extra.length === 0 ? login : `${login}${sep}${extra.join(sep)}`;
}

/** Ask the login shell once, with no cache. Never rejects: every failure is
 *  the server's own environment and a reason. */
export async function readLoginEnv(opts: LoginEnvOptions): Promise<LoginEnvRead> {
  const platform = opts.platform ?? process.platform;
  // The server's own markers never reach an agent, whatever the caller handed.
  const own: Record<string, string> = {};
  for (const [name, value] of Object.entries(opts.base)) if (!name.startsWith("BIOM_")) own[name] = value;
  const fallback = (reason: string): LoginEnvRead => ({ env: { ...own }, from: "server", reason: `${reason}, so agents get the server's own environment` });

  if (platform === "win32") return fallback("Windows has no login shell to ask");
  const shell = opts.shell;
  if (shell === null || !executable(shell)) return fallback("no login shell could be found");

  const tag = randomBytes(16).toString("hex");
  const start = `__BIOM_LOGIN_START_${tag}__`;
  const end = `__BIOM_LOGIN_END_${tag}__`;
  // `command env -0` so an alias or a function called `env` in somebody's rc
  // is not what runs; printf, not echo, whose escapes differ between shells.
  const script = `printf '%s' '${start}'; command env -0; printf '%s' '${end}'`;
  const timeout = opts.timeoutMs ?? LOGIN_TIMEOUT;

  const raw = await new Promise<{ out: Uint8Array | null; why: string | null }>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ["-i", "-l", "-c", script], {
        cwd: opts.cwd ?? homedir(),
        env: own,
        stdio: ["ignore", "pipe", "ignore"],
        // Its own process group, so the bound ends everything the profile
        // started and not only the shell.
        detached: true,
      });
    } catch {
      resolve({ out: null, why: "the login shell could not be started" });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    // The output as one byte per character, which is all the marker search
    // needs: the markers are ASCII, and latin1 never merges two bytes.
    let seen = "";
    let done = false;
    let drain: ReturnType<typeof setTimeout> | null = null;
    const finish = (out: Uint8Array | null, why: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(bound);
      if (drain !== null) clearTimeout(drain);
      // Whatever the profile left running is ended: the reading is taken.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The group has gone already.
        }
      }
      child.stdout?.removeAllListeners("data");
      child.stdout?.destroy();
      resolve({ out, why });
    };
    const bound = setTimeout(() => finish(null, `the login shell did not answer within ${Math.round(timeout / 1000)} s`), timeout);
    child.on("error", () => finish(null, "the login shell could not be started"));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > OUTPUT_CAP) {
        finish(null, "the login shell printed more than an environment");
        return;
      }
      chunks.push(chunk);
      const from = Math.max(0, seen.length - end.length);
      seen += chunk.toString("latin1");
      if (seen.indexOf(end, from) >= 0) finish(Buffer.concat(chunks), null);
    });
    child.on("exit", () => {
      if (done) return;
      drain = setTimeout(() => finish(Buffer.concat(chunks), null), DRAIN);
    });
  });

  if (raw.out === null) return fallback(raw.why ?? "the login shell failed");
  const read = parseEnvBlock(raw.out, start, end);
  if (read === null) return fallback("the login shell printed no environment Biom could read");
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(read)) {
    if (SHELL_OWN.has(name)) continue;
    // The server's own markers never reach an agent, whatever a profile says.
    if (name.startsWith("BIOM_")) continue;
    env[name] = value;
  }
  const path = mergePath(env.PATH, own.PATH, platform);
  if (path !== undefined) env.PATH = path;
  return { env, from: "shell", reason: null };
}

/** THE ONE READING PER SERVER. Constructed once by the composition root; the
 *  shell is asked on the first `read`, never at construction. */
export function makeLoginEnv(opts: LoginEnvOptions): LoginEnv {
  let reading: Promise<LoginEnvRead> | null = null;
  let why: string | null = null;
  return {
    read() {
      if (reading === null) {
        reading = readLoginEnv(opts).then((r) => {
          why = r.reason;
          return r;
        });
      }
      return reading.then((r) => r.env);
    },
    forget() {
      reading = null;
    },
    reason: () => why,
  };
}

/** Where `command` is on this environment's `PATH`, or null — the lookup the
 *  agents are handed, asked of the login environment rather than the
 *  server's. A name with a separator in it is not a command. */
export function whichIn(command: string, env: Record<string, string>): string | null {
  if (command === "" || /[\\/]/.test(command)) return null;
  const found = Bun.which(command, { PATH: env.PATH ?? "" });
  return typeof found === "string" && found !== "" ? found : null;
}
