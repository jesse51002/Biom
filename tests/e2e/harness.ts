// SPDX-License-Identifier: AGPL-3.0-only
// WHAT THE END-TO-END SUITE IS MADE OF, and why it is not in `tests/`.
//
// The owner's decision, on 2026-09-14, in their words: *"we need end-to-end
// testing; all of the issues I found could have been very easily found by just
// running it, especially in the startup flow."* Every one of those issues was
// invisible to 816 unit tests and would have been obvious in the first ten
// seconds of a real run — a remembered vault opening instead of the picker, a
// stack trace on every launch, Electron's own menu bar, no way to full screen,
// a rail row that was in the source and not in the build. The class of fault is
// *the program, assembled, on a screen*, and the only instrument that sees it is
// the program, assembled, on a screen.
//
// TWO LAYERS, AND THE SECOND IS NOT THE FIRST WITH A WINDOW AROUND IT.
// `server.e2e.ts` runs the server the way `make dev` does and drives it in a
// real headless Chromium: that is where the vault flow, the live redraw and the
// mirror are walked, because all three are the server's. `app.e2e.ts` launches
// the PACKAGED application and connects to it over CDP: that is where the menu
// bar, the title bar, the bridge surface, the token refusal and the production
// hide list are walked, because every one of those is a fact about the bundle
// and about nothing the first layer can see.
//
// THE FILES END IN `.e2e.ts` AND NOT `.test.ts`, AND THAT IS THE WHOLE GLOB
// STORY. `bun test` discovers `.test.`, `_test_`, `.spec.` and `_spec_` and
// nothing else, so `make test` walks straight past this directory and stays the
// eleven-second gate it is. `make e2e` names the files explicitly — with a `./`
// in front, because bun reads a bare path as a filter against that same glob and
// finds nothing. It needs a browser and it takes minutes, which is why it is not
// a prerequisite of `test` and why the Makefile's help line says so.
//
// EVERY LAUNCH IS ISOLATED FROM THE PERSON'S OWN DATA DIRECTORY, and that is not
// hygiene — it is the first bug on the list. `dataHome()` in
// `server/workspace/vault.ts` is where the remembered-vault list lives, agents'
// test runs had written a scratch vault into the real one, and the packaged
// application then opened it instead of the picker. So every process this suite
// starts is handed a data directory of its own, and `outside()` below reads the
// REAL one before and after to prove nothing reached it.

import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

/** The framework root — this file is `tests/e2e/harness.ts`. */
export const HERE = join(import.meta.dir, "..", "..");

/** WHERE THE PICTURES GO. Under `dist/`, which `.gitignore` already
 *  excludes whole, because a screenshot of a test run is generated and large and
 *  a committed one is a picture of a build nobody has any more. A human looks at
 *  them when a step fails, and the failure names the path. */
export const SHOTS = join(HERE, "dist", "e2e");

/** EVERY WAIT IN THIS SUITE IS BOUNDED, and these are the bounds. They are not
 *  network budgets: everything here is on this machine. They are the difference
 *  between slow and never, and a test that hangs teaches nothing. */
export const BOUNDS = {
  /** A server answering its first request. */
  serve: 30000,
  /** A page drawn in the box, which is a handshake and a runtime away. */
  draw: 30000,
  /** A file written outside the app reaching the screen. The watcher coalesces
   *  a burst, the mirror is rebuilt and the page is torn down and redrawn. */
  redraw: 20000,
  /** The packaged application printing its ready line and opening a window. */
  launch: 60000,
} as const;

/* ── a data directory of this run's own ─────────────────────────────────── */

/** The per-user data directory as the REAL environment resolves it — the folder
 *  `dataHome()` would answer for the person running this. Nothing in this suite
 *  may write a byte into it, and `outside()` is how that is proved rather than
 *  hoped. Spelled here rather than imported because the point is to compute it
 *  from the untouched environment, which the module under test cannot do once
 *  this suite has started overriding things. */
export function realDataHome(): string {
  const home = homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    return local !== undefined && local.trim() !== "" ? join(local, "Biom") : join(home, "AppData", "Local", "Biom");
  }
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Biom");
  const xdg = process.env.XDG_DATA_HOME;
  return xdg !== undefined && xdg.startsWith("/") ? join(xdg, "biom") : join(home, ".local", "share", "biom");
}

export interface Sandbox {
  /** The temporary root everything this run writes lives under. */
  root: string;
  /** What the data directory resolves to inside it, on this platform. */
  data: string;
  /** The environment to hand every process this run starts. */
  env: Record<string, string>;
  /** Drop the whole tree. */
  clean(): void;
}

/** A HOME, A DATA DIRECTORY AND A CONFIG DIRECTORY OF THIS RUN'S OWN.
 *
 *  All three, and on every platform, because three different programs answer the
 *  question differently: the server reads `XDG_DATA_HOME` on Linux,
 *  `LOCALAPPDATA` on Windows and `homedir()` on macOS, and ELECTRON ITSELF
 *  writes its own profile under `XDG_CONFIG_HOME` — a packaged launch that left
 *  that alone would put `~/.config/Biom` on the person's disk even with the
 *  server perfectly isolated. Setting `HOME` covers the macOS leg of `dataHome()`
 *  without a platform branch here.
 *
 *  `VAULT` and `VAULTS` are DELETED rather than set: an inherited `VAULT` would
 *  mount a folder on boot and there would be no picker to walk, which is the
 *  first thing this suite looks at. */
export function sandbox(label: string): Sandbox {
  const root = mkdtempSync(join(tmpdir(), `biom-e2e-${label}-`));
  const home = join(root, "home");
  const data = join(root, "data");
  const config = join(root, "config");
  const cache = join(root, "cache");
  for (const dir of [home, data, config, cache]) mkdirSync(dir, { recursive: true });

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.VAULT;
  delete env.VAULTS;
  env.HOME = home;
  env.XDG_DATA_HOME = data;
  env.XDG_CONFIG_HOME = config;
  env.XDG_CACHE_HOME = cache;
  env.LOCALAPPDATA = data;

  return {
    root,
    data: process.platform === "win32" ? join(data, "Biom") : process.platform === "darwin" ? join(home, "Library", "Application Support", "Biom") : join(data, "biom"),
    env,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A directory as a comparable string: every path under it with its size. Used
 *  either side of a run against the REAL data directory, so "nothing was written
 *  outside the sandbox" is a measured statement and not a claim. An absent
 *  directory is the empty listing, which is the honest reading — it must still be
 *  absent afterwards. */
export function outside(at: string = realDataHome()): string {
  const seen: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        seen.push(`${prefix}${name}/`);
        walk(abs, `${prefix}${name}/`);
      } else {
        seen.push(`${prefix}${name} ${st.size}`);
      }
    }
  };
  if (existsSync(at)) walk(at, "");
  return seen.join("\n");
}

/* ── a port nobody is on ────────────────────────────────────────────────── */

/** Ask the operating system for one and give it straight back. There is a window
 *  between letting go and the server binding, which nothing can close from out
 *  here — the alternative is guessing a number, and a guess collides with the
 *  development server on 4400 that somebody very often has running. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const at = probe.address();
      if (at === null || typeof at === "string") {
        probe.close();
        reject(new Error("the operating system named no port"));
        return;
      }
      const port = at.port;
      probe.close(() => resolve(port));
    });
  });
}

/* ── bounded waiting, and a step that says its own name ─────────────────── */

/** Poll until it is true, or say what never happened. Every wait in this suite
 *  goes through here: a bare `await` on a condition that never comes is a test
 *  run that dies of a timeout with nothing to read. */
export async function until(what: string, ms: number, ok: () => boolean | Promise<boolean>): Promise<void> {
  const stop = Date.now() + ms;
  let last: unknown = null;
  for (;;) {
    try {
      if (await ok()) return;
      last = null;
    } catch (e) {
      last = e;
    }
    if (Date.now() >= stop) {
      const why = last === null ? "" : ` — last error: ${String((last as Error)?.message ?? last)}`;
      throw new Error(`${what}: still not true after ${ms}ms${why}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

/** A STEP THAT FAILS SAYS WHICH STEP, WHERE THE PICTURE IS AND WHAT THE SERVER
 *  SAID. Those three are the whole of what somebody needs to act on an e2e
 *  failure, and none of them is in the assertion itself. `log` is whatever the
 *  layer can offer — the server's stderr, or the shell's — read lazily so a
 *  passing step costs nothing. */
export async function step<T>(
  name: string,
  shot: string | null,
  log: () => string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const said = log().trim();
    const parts = [`step: ${name}`, String((e as Error)?.message ?? e)];
    if (shot !== null) parts.push(`screenshot: ${join(SHOTS, shot)}`);
    parts.push(said === "" ? "the process said nothing on stderr" : `stderr:\n${said}`);
    const wrapped = new Error(parts.join("\n"));
    wrapped.stack = (e as Error)?.stack;
    throw wrapped;
  }
}

/* ── what a stack trace looks like on the way past ──────────────────────── */

/** A LINE THAT IS A STACK FRAME, and the whole reason the suite reads stderr at
 *  all. `vault.info` with nothing mounted used to print one on every launch: the
 *  domain's refusal escaped as a thrown error, and what a person saw on starting
 *  the application was a wall of frames. A refusal is a sentence now, and a frame
 *  on stderr means something threw where nothing should. */
const FRAME = /^\s+at\s+\S+/m;

/** Every line of `said` that reads as part of a stack trace, or none. Reported
 *  rather than asserted here, so the caller can put it in a message. */
export function stackTraces(said: string): string[] {
  return said
    .split("\n")
    .filter((line) => FRAME.test(line) || /^[A-Za-z]*Error:/.test(line))
    .map((line) => line.trimEnd());
}

/** Make the screenshot directory, once. */
export function shotsDir(): string {
  mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
}

/* ── a wire into a window that is already open ──────────────────────────── */

// WHY THIS IS HAND-ROLLED AND NOT `chromium.connectOverCDP`, WHICH IS WHAT THE
// FIRST ATTEMPT USED. Playwright's connect asks the BROWSER-level endpoint for
// the shape of the session — contexts, targets, auto-attach — and Electron's
// browser endpoint does not answer it: the socket opens and the handshake never
// completes, which arrives as a thirty-second timeout with nothing to read.
// Measured against this bundle, with and without `--remote-allow-origins=*`.
//
// The PAGE-level endpoint is an ordinary DevTools target and answers everything
// below immediately, which is all layer two needs: run an expression in the
// window, and take a picture of it. Clicks go through the element's own
// `.click()` — the same event the person's mouse produces, dispatched into the
// same handler — rather than through `Input.dispatchKeyEvent`, because what is
// being tested is the application's response and not Chromium's event routing.

/** How long a screenshot may take before the step gives up on having one. */
const SHOT_BOUND = 8000;

/** A page target's DevTools endpoint, as `/json/list` reports it. */
interface Target { type: string; url: string; webSocketDebuggerUrl?: string }

export interface Cdp {
  /** Evaluate in the window and answer the value, awaiting a promise. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** Evaluate and DO NOT WAIT for the answer.
   *
   *  For the one act whose success is the window going away: the reply to a
   *  click on Close is a message from a renderer that no longer exists, so
   *  awaiting it waits out the whole bound and then fails a step that worked. */
  fire(expression: string): void;
  /** One raw command. */
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, any>>;
  /** A picture of the window into `dist/e2e/`, named for a step. */
  shot(file: string): Promise<void>;
  close(): void;
}

/** Attach to the one window the application opened.
 *
 *  BOUNDED AT EVERY STEP: waiting for the port to answer, waiting for a page
 *  target to exist, and waiting for the socket. A debugging port that never
 *  comes up must fail with a sentence rather than hang the run. */
export async function cdp(port: number, ms: number): Promise<Cdp> {
  let target: Target | undefined;
  await until("the window offered a debugging target", ms, async () => {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = (await res.json()) as Target[];
    target = list.find((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string");
    return target !== undefined;
  });

  const socket = new WebSocket((target as Target).webSocketDebuggerUrl as string);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the debugging socket did not open in ${ms}ms`)), ms);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("the debugging socket refused")); };
  });

  let n = 0;
  const waiting = new Map<number, (m: Record<string, any>) => void>();
  socket.onmessage = (ev: MessageEvent) => {
    const m = JSON.parse(String(ev.data)) as Record<string, any>;
    const id = m.id as number | undefined;
    if (id !== undefined && waiting.has(id)) { waiting.get(id)?.(m); waiting.delete(id); }
  };

  const send = (method: string, params: Record<string, unknown> = {}, within = ms): Promise<Record<string, any>> =>
    new Promise((resolve, reject) => {
      const id = ++n;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} did not answer in ${within}ms`)); }, within);
      waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return {
    send,
    fire(expression) {
      try {
        socket.send(JSON.stringify({ id: ++n, method: "Runtime.evaluate", params: { expression } }));
      } catch {
        // The socket going away as the window does is the expected shape of it.
      }
    },
    async evaluate(expression) {
      const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      // A THROW INSIDE THE WINDOW IS A FAILURE OF THE STEP, not a value of
      // undefined. Chromium answers both the same way otherwise, and a test
      // reading `undefined` from a TypeError is a test that says nothing.
      const bad = m.result?.exceptionDetails;
      if (bad !== undefined) throw new Error(`in the window: ${String(bad.exception?.description ?? bad.text)}`);
      return m.result?.result?.value;
    },
    async shot(file) {
      try {
        // A PICTURE IS ON ITS OWN SHORT LEASH, and that is not tidiness: the
        // command waits on the next frame, and a window that has just left full
        // screen on a display with no window manager may not paint one for a
        // long time. Costing a step its whole budget to take a picture of it is
        // the failure this bound removes.
        const m = await send("Page.captureScreenshot", { format: "png" }, SHOT_BOUND);
        const data = m.result?.data as string | undefined;
        if (typeof data === "string") writeFileSync(join(shotsDir(), file), Buffer.from(data, "base64"));
      } catch {
        // A picture that cannot be taken must never be why a step failed.
      }
    },
    close() {
      try { socket.close(); } catch { /* it was already gone */ }
    },
  };
}
