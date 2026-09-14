// SPDX-License-Identifier: AGPL-3.0-only
// LAYER TWO: the packaged application, on a screen, driven over its own
// debugging port.
//
// It is `dist/out/Biom-<platform>-<arch>/Biom` — the thing a person downloads —
// started with a data directory of this run's own and a debugging port nobody
// else is on, and then asked questions through the window it opened.
//
// WHAT IS HERE IS WHAT LAYER ONE CANNOT SEE, and the division is not a
// convenience. `server.e2e.ts` runs `server/main.ts` from source in a browser:
// there is no shell, no preload, no bundle and no production build, so the menu
// bar, the title bar, `window.biomShell`, the token refusal and the production
// hide list are all invisible to it. Every one of those is a fact about the
// ASSEMBLED program, and every one of them was a bug the owner found by starting
// the application and looking at it.
//
//   1. The ready line carries a port and a token — the shell reads that line and
//      opens the window at it, so a line it cannot parse is an application that
//      never draws anything.
//   2. The window draws OUR title bar: the mark, the workspace's name, and the
//      four controls. And no native chrome is eating the client area, which is
//      what a menu bar would be doing.
//   3. Nothing is mounted, so the picker is what opens — in the built
//      application, where the first launch is somebody's first ten seconds.
//   4. `window.biomShell` is exactly the three names and the eight under
//      `windowControls`, and nothing else crossed.
//   5. `/api/call` without the token is refused, and the production server
//      refuses the three kinds it is meant to.
//   6. The production hide list holds on the screens that carry it.
//   7. Maximise and full screen flip the window's state, and the bar follows.
//   8. Close quits the server with the window, and leaves no process of it
//      running — a port that stopped answering is not the same statement.
//   9. Across all of it: nothing written into the person's own data directory.
//
// WHERE IT NEEDS A SCREEN AND THERE IS NONE, IT SAYS SO AND STOPS. `xvfb-run` is
// used when it is there, `DISPLAY` when it is not, and a machine with neither
// gets a named skip rather than a failure — a headless container that cannot
// open a window has not found a bug in the application.
//
// AND A SCREEN IS NOT A DESKTOP. Step 7 is the only one that needs somebody to
// ACT on the window rather than answer a question about it: maximise and full
// screen are hints a WINDOW MANAGER honours, and a bare `Xvfb` has none — the
// request is made, nobody answers, the state never changes. So every launch goes
// through `tools/screen.sh`, which starts openbox (or fluxbox, or icewm) on the
// display first, and where none is installed step 7 alone is skipped by name.
// That is what made this suite green on a desktop and red on a runner.
//
// IT IS NOT BUILT HERE. `make app` is minutes and is the CI job's
// own step; a missing bundle is a named skip that says which command makes one.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HERE, SHOTS, BOUNDS, sandbox, outside, freePort, until, step, shotsDir, cdp } from "./harness.ts";
import type { Sandbox, Cdp } from "./harness.ts";

/* ── what has to be true before there is anything to walk ───────────────── */

/** The bundle for the machine this is running on, as `tools/app.ts` names it —
 *  packager's platform and arch, which are node's own spellings. */
function bundle(): string {
  const dir = join(HERE, "dist", "out", `Biom-${process.platform}-${process.arch}`);
  if (process.platform === "darwin") return join(dir, "Biom.app", "Contents", "MacOS", "Biom");
  return join(dir, process.platform === "win32" ? "Biom.exe" : "Biom");
}

/** The compiled server inside the bundle, by the path it is running under. What
 *  it is for is the one thing the close step cannot ask the window: whether the
 *  process behind it is gone as well. */
function bundleServer(): string {
  const dir = join(HERE, "dist", "out", `Biom-${process.platform}-${process.arch}`);
  const exe = process.platform === "win32" ? "biom-server.exe" : "biom-server";
  if (process.platform === "darwin") return join(dir, "Biom.app", "Contents", "Resources", "app", exe);
  return join(dir, "resources", "app", exe);
}

/** What was already running before this suite started anything — a machine can
 *  carry an orphan from somebody else's crash, and that is not this run's to
 *  report. Filled in `beforeAll`, and everything below asks only whether THIS
 *  run left something behind. */
let ours: Set<number> = new Set();

/** Every process running THIS program, by pid.
 *
 *  ANCHORED AT THE START OF THE COMMAND LINE, which is not a detail: `pgrep -f`
 *  matches the whole line, so an unanchored pattern also matches the shell that
 *  typed the path — a test that failed because of how it was launched. And it is
 *  the absolute bundle path, so another checkout's bundle on the same machine is
 *  a different program.
 *
 *  Windows has no `pgrep`, and the empty answer there is honest rather than
 *  quiet: the step that uses this says so. */
function running(binary: string): number[] {
  if (process.platform === "win32") return [];
  const said = Bun.spawnSync(["pgrep", "-f", `^${binary}`]);
  return new TextDecoder().decode(said.stdout).trim().split("\n").filter((line) => line !== "").map(Number);
}

/** WHETHER THE LAUNCH IS OVER, ASKED TWO WAYS BECAUSE ONE OF THEM CAN FAIL TO
 *  ANSWER. `exitCode` is the direct one and is what this used to be on its own:
 *  bun reaps the child and fills it in. It does not always get there. When all
 *  three e2e files run in ONE `bun test` — which is what `make e2e` does — this
 *  file's `xvfb-run` wrapper is left unreaped: the wrapper has exited, the
 *  display and the application are gone and the port has stopped answering,
 *  while the handle still says `null` against a process sitting in `Z`. Measured
 *  every run in that order, and never when this file is walked on its own, so it
 *  is a fact about the runner and not about the program.
 *
 *  So the second way is the operating system's own answer — no process of this
 *  bundle is left that was not already there — which is the thing the step is
 *  about anyway. Windows has neither `pgrep` nor the wrapper, so there it is
 *  `exitCode` and nothing else. */
function over(): boolean {
  if (proc === null || proc.exitCode !== null) return true;
  if (process.platform === "win32") return false;
  return running(bundle()).every((pid) => ours.has(pid));
}

/** The script that puts a window manager on the display before the application
 *  starts, and answers whether one could be had. See `tools/screen.sh`. */
const SCREEN = join(HERE, "tools", "screen.sh");

/** WHAT ARRANGES THE DISPLAY THIS RUN GETS, asked of `screen.sh` under exactly
 *  the launch it will be asked at. The answer is a manager's name or null, and a
 *  name is worth nothing unless it actually took the root window — which is why
 *  this runs the script rather than looking for the binary.
 *
 *  Its own temporary HOME and config directory, because a window manager writes
 *  a profile on first run like everything else does. */
function managerOn(argv: string[]): string | null {
  const box = sandbox("probe");
  try {
    const said = Bun.spawnSync([...argv, "--probe"], { env: box.env });
    const name = new TextDecoder().decode(said.stdout).trim();
    return name === "" ? null : name;
  } finally {
    box.clean();
  }
}

/** WHAT OPENS A WINDOW HERE, WHAT ARRANGES IT, or why nothing can.
 *
 *  `xvfb-run` FIRST even where there is a display, and that is deliberate: this
 *  suite opens a real window, and a run that takes over somebody's screen in the
 *  middle of their work is a test that gets turned off. A display of its own
 *  costs nothing and is what the CI job has anyway.
 *
 *  AND A BARE DISPLAY IS NOT A DESKTOP. `Xvfb` is a screen with nobody on it:
 *  maximise and full screen are requests to a WINDOW MANAGER, and with none
 *  running they are honoured by nobody and the window's state never changes —
 *  which is how this suite passed on a desktop and failed on a runner. So every
 *  launch goes through `tools/screen.sh`, which starts one if it can, and `wm`
 *  records whether it could: the one step that needs a manager is skipped by
 *  name where there is none, and nothing else here is affected either way. */
function screen(): { argv: string[]; how: string; wm: string | null } | { why: string } {
  if (process.platform !== "linux") {
    // macOS and Windows draw windows without a server to arrange first, and
    // their window manager is the operating system.
    return { argv: [], how: "the desktop", wm: "the desktop's own" };
  }
  const xvfb = Bun.spawnSync(["sh", "-c", "command -v xvfb-run"]).exitCode === 0;
  const display = process.env.DISPLAY ?? "";
  if (!xvfb && display === "") {
    return { why: "there is no display and no xvfb-run on this machine, so no window can be opened" };
  }
  const argv = xvfb ? ["xvfb-run", "-a", SCREEN] : [SCREEN];
  const wm = managerOn(argv);
  const where = xvfb ? "xvfb-run" : `DISPLAY=${display}`;
  return { argv, how: `${where}, ${wm === null ? "no window manager" : wm}`, wm };
}

/** The display, decided once, at load — because the skips below are declared
 *  before a single test runs. */
const HOW = ((): { argv: string[]; how: string; wm: string | null } | { why: string } => {
  if (!existsSync(bundle())) return { why: `there is no bundle at ${bundle()} — build one with: make app` };
  return screen();
})();

/** THE ONE REASON THIS FILE IS NOT WALKED, decided once and said once. Null
 *  means walk it. */
const why: string | null = "why" in HOW ? HOW.why : null;

/** AND THE ONE REASON A SINGLE STEP IN IT IS NOT. Null means walk that one too.
 *  A bare `Xvfb` with no manager on it is an honest machine rather than a broken
 *  application, so the honest result is a named skip. */
const noWm: string | null =
  why !== null || (HOW as { wm: string | null }).wm !== null
    ? null
    : "no window manager on this display — maximise and full screen are requests that nobody is there to honour";

/** The size the shell asks the window to be, READ FROM THE SHELL rather than
 *  spelled again here. What it is for is the client area: a native menu bar or a
 *  native title bar takes its room out of the window, so a viewport that is
 *  exactly this is a window with neither. */
function asked(): { width: number; height: number } {
  const said = readFileSync(join(HERE, "app", "main.js"), "utf8");
  const hit = /new BrowserWindow\(\{\s*width:\s*(\d+),\s*height:\s*(\d+),/.exec(said);
  if (hit === null) throw new Error("app/main.js no longer opens its window with a width and a height on the first two lines");
  return { width: Number(hit[1]), height: Number(hit[2]) };
}

/* ── the run ────────────────────────────────────────────────────────────── */

let box: Sandbox;
let before = "";
let proc: ReturnType<typeof Bun.spawn> | null = null;
let said = { out: "", err: "" };
let wire: Cdp;
/** The port and the token off the ready line, which is the whole of what the
 *  shell learns about the server it started. */
let ready: { port: number; token: string } = { port: 0, token: "" };
let broke: string | null = null;

const log = (): string => `${said.err}${said.out === "" ? "" : `\nstdout:\n${said.out}`}`;

/** The shell's own reader, spelled the same way `app/main.js` spells it — a
 *  ready line this cannot parse is a window that never opens. */
const READY = /^biom ready (\{.*\})$/m;

function drain(stream: ReadableStream<Uint8Array> | undefined, into: "out" | "err"): void {
  if (stream === undefined) return;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) said[into] += decoder.decode(chunk);
  })();
}

/** One step of the walk, with a picture of the window either side of it.
 *
 *  `unless` is a step's OWN reason not to be walked here, on top of the file's:
 *  a machine can be able to open a window and unable to arrange one. */
function walk(name: string, run: () => Promise<void>, unless: string | null = null, ms = 60000): void {
  const file = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  test.skipIf(why !== null || unless !== null)(name, async () => {
    if (broke !== null) throw new Error(`skipped: an earlier step failed — ${broke}`);
    await wire.shot(`app-${file}.png`);
    try {
      await step(name, `app-${file}.png`, log, async () => {
        await run();
        await wire.shot(`app-${file}.png`);
      });
    } catch (e) {
      broke = name;
      throw e;
    }
  }, ms);
}

/** One call through the window's own `fetch`, at the window's own origin, with
 *  whatever token the caller wants on it. The client puts the launch's token on
 *  every call; this is how a request WITHOUT it is made. */
function call(kind: string, fields: Record<string, unknown>, token: string | null): string {
  const body = JSON.stringify({ id: "e2e-app", g: 1, kind, ...fields });
  const at = token === null ? "/api/call" : `/api/call?token=${token}`;
  return `fetch(${JSON.stringify(at)}, { method: "POST", headers: { "content-type": "application/json" }, body: ${JSON.stringify(body)} })
    .then(r => r.text().then(t => JSON.stringify({ status: r.status, body: t })))`;
}

beforeAll(async () => {
  if (why !== null) {
    console.log(`  the packaged application is not walked here: ${why}`);
    return;
  }
  shotsDir();
  // BEFORE ANYTHING IS STARTED. What is already running is somebody else's, and
  // the close step below asks about the difference rather than the total.
  ours = new Set([...running(bundle()), ...running(bundleServer())]);
  box = sandbox("app");
  before = outside();
  const port = await freePort();
  const how = HOW as { argv: string[]; how: string; wm: string | null };

  // `--no-sandbox` AND `--disable-gpu` BEHIND A KNOB THAT IS OFF. A container
  // without user namespaces needs the first and a machine without a GPU wants
  // the second, and neither may be quietly true on a developer's machine —
  // turning them on by default would mean this suite never runs the program the
  // way a person runs it.
  //
  // AND NOTHING IS ADDED FOR THE `dbus` LINES. A machine with no message bus
  // makes Chromium print `Failed to connect to the bus` two or three times on
  // the way up; it is noise on stderr and it is not a fault — the window opens,
  // every step passes, and `stackTraces()` does not read those lines as frames.
  // There is no flag that turns them off: the only way to make them stop is
  // `dbus-run-session`, which starts a real bus and changes what the program has
  // available to it, and a test that runs the application in a shape a person's
  // machine does not is worse than a tidy log.
  const relaxed = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  const argv = [...how.argv, bundle(), `--remote-debugging-port=${port}`, ...relaxed];
  proc = Bun.spawn(argv, { env: box.env, stdout: "pipe", stderr: "pipe" });
  drain(proc.stdout as ReadableStream<Uint8Array>, "out");
  drain(proc.stderr as ReadableStream<Uint8Array>, "err");

  await until(`the application said it was ready (${how.how})`, BOUNDS.launch, () => READY.test(said.out));
  const hit = READY.exec(said.out);
  ready = JSON.parse(String(hit?.[1])) as { port: number; token: string };
  wire = await cdp(port, BOUNDS.launch);
}, 180000);

afterAll(async () => {
  wire?.close();
  // NOTHING OF THIS RUN'S IS LEFT RUNNING, whether the walk got to the Close
  // button or died on its first step. `xvfb-run` traps its own signal and takes
  // the display down with it.
  proc?.kill();
  if (proc !== null) {
    // BOUNDED WELL INSIDE THIS HOOK'S OWN LIMIT, and `over()` is why rather than
    // `proc.exited`: an unreaped wrapper never resolves that promise, so a race
    // against it spent the hook's whole budget and the teardown was reported as
    // a failing test of its own.
    await until("the launch was over", 10000, () => over()).catch(() => {});
    if (proc.exitCode === null) proc.kill(9);
  }
  // AND ANYTHING OF THIS BUNDLE'S THAT IS SOMEHOW STILL THERE. The application
  // passes a signal on to the launch it supervises and that launch stops its
  // server, so this finds nothing on an ordinary run — it is what makes a run
  // that died in the middle leave nothing behind either.
  for (const binary of [bundle(), bundleServer()]) {
    for (const pid of running(binary)) {
      if (ours.has(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone between the listing and the signal, which is the ordinary
        // way this ends.
      }
    }
  }
  box?.clean();
  // ITS OWN LIMIT, because bun's default for a hook is five seconds and the
  // wait above is bounded at ten: a teardown that has to signal, wait and sweep
  // must not be reported as a failing test for taking as long as it said it
  // might.
}, 30000);

/* ── the walk ───────────────────────────────────────────────────────────── */

walk("the ready line carries a port and a token, and the window opened at them", async () => {
  // THE SHELL OWNS THE LIFETIME AND THE SERVER OWNS THE ADDRESS. Neither value
  // is predictable from outside — the port is the operating system's answer to
  // zero and the token is minted for this launch — so this line is the only way
  // the window can be opened at all.
  expect(Number.isInteger(ready.port) && ready.port > 0).toBe(true);
  expect(/^[0-9a-f]{32}$/.test(ready.token)).toBe(true);

  const href = await wire.evaluate<string>("location.href");
  expect(href).toContain(`:${ready.port}/`);
  expect(href).toContain(ready.token);

  // And the build it says it is. A bundle that reported `development` would be
  // hiding nothing and refusing nothing.
  expect(said.out).toContain("(production)");
});

walk("the window wears our title bar, and nothing native is taking room out of it", async () => {
  await until("the bar was drawn", BOUNDS.draw, async () =>
    (await wire.evaluate<number>("document.querySelectorAll('header.titlebar').length")) === 1);

  // THE MARK, which `app/preload.js` hands over as a data URL because `app/` is
  // not served and a page cannot read a file.
  expect(await wire.evaluate<string>(
    "String((document.querySelector('img.titlemark')||{}).src||'').slice(0, 15)",
  )).toBe("data:image/png;");

  // FOUR CONTROLS, in the order the bar builds them, named rather than drawn:
  // the glyphs are CSS and the accessible name is the whole of what a control
  // says it is.
  expect(await wire.evaluate<string>(
    "JSON.stringify([...document.querySelectorAll('header.titlebar button.wctl')].map(b => b.getAttribute('aria-label')))",
  )).toBe(JSON.stringify(["Minimize", "Maximize", "Full screen", "Close"]));

  // AND NO MENU. Electron draws an application menu INSIDE a frameless window,
  // so a menu that existed would take its HEIGHT out of the client area — which
  // makes the viewport's height the measurement: it is exactly what the shell
  // asked the window to be, so there is no menu bar and no native title bar
  // above it. The WIDTH is deliberately not compared: it is the window
  // manager's to decide, and openbox on a 1280-wide virtual screen hands the
  // window back a few pixels narrower than it asked for, which says nothing
  // about a menu.
  const seen = JSON.parse(await wire.evaluate<string>(
    "JSON.stringify({ width: innerWidth, height: innerHeight })",
  )) as { width: number; height: number };
  expect(seen.height).toBe(asked().height);
});

walk("a first launch of the built application mounts nothing and opens the picker", async () => {
  // THE FIRST BUG ON THE OWNER'S LIST, in the program it was found in. A scratch
  // vault left in the real per-user data directory was opened instead of this
  // screen; every process here has a data directory of its own, and the last
  // step proves the person's was not touched.
  expect(said.out).toContain("none yet");
  await until("the picker was drawn", BOUNDS.draw, async () =>
    (await wire.evaluate<number>("document.querySelectorAll('div.ports.vault').length")) === 1);
  // The picker's own heading went with the groups: what a stranger meets is the
  // mark, the company's one line, and two buttons.
  expect(await wire.evaluate<string>("document.querySelector('div.ports.vault h1.vline').innerText"))
    .toBe("Visual Workspace for AI Automations");
  expect(await wire.evaluate<string>(
    "[...document.querySelectorAll('div.ports.vault button.vact')].map((b) => b.innerText).join('|')",
  )).toBe("Create a vault|Open");
});

walk("window.biomShell is those names and no others", async () => {
  // THE LIST IS CLOSED, and this is the closing of it in the assembled program.
  // `tests/app.test.ts` holds the same list against the two source files; what
  // is checked here is what actually reached the window's world.
  const surface = JSON.parse(await wire.evaluate<string>(`JSON.stringify({
    top: Object.keys(window.biomShell).sort(),
    controls: Object.keys(window.biomShell.windowControls).sort(),
    node: typeof window.require + "/" + typeof window.process + "/" + typeof window.ipcRenderer,
  })`)) as { top: string[]; controls: string[]; node: string };

  expect(surface.top).toEqual(["chooseFolder", "logo", "windowControls"]);
  expect(surface.controls).toEqual([
    "close", "inset", "lights", "minimize", "onChange", "state", "toggleFullScreen", "toggleMaximize",
  ]);
  // NOTHING ELSE CROSSED. Node is off in both worlds and no `ipcRenderer` was
  // handed over, so the object above is every channel the main process answers.
  expect(surface.node).toBe("undefined/undefined/undefined");
});

walk("a call without the launch's token is refused, and production refuses what it is meant to", async () => {
  const bare = JSON.parse(await wire.evaluate<string>(call("vault.info", {}, null))) as { status: number };
  expect(bare.status).toBe(401);

  // The same call WITH it is answered, so the refusal above is the token and not
  // the request.
  const held = JSON.parse(await wire.evaluate<string>(call("vault.info", {}, ready.token))) as { status: number; body: string };
  expect(held.status).toBe(200);

  // THE THREE KINDS THE PRODUCTION SERVER REFUSES, asked for directly — because
  // hiding a control that does this would only move it out of sight, and a typed
  // request reaches the route either way.
  for (const [kind, fields] of [
    ["sql", { query: "select 1", params: [] }],
    ["fetch", { url: "http://example.invalid/", init: {} }],
    ["vault.browse", { path: box.root }],
  ] as [string, Record<string, unknown>][]) {
    const answer = JSON.parse(await wire.evaluate<string>(call(kind, fields, ready.token))) as { status: number; body: string };
    const envelope = JSON.parse(answer.body) as { ok: boolean; error?: { code?: string } };
    expect([kind, answer.status, envelope.ok]).toEqual([kind, 200, false]);
  }
});

walk("the production hide list holds on the screens that carry it", async () => {
  // NO BROWSE GROUP, because the server refuses the kind that fills it and the
  // built application has the operating system's own dialog instead.
  expect(await wire.evaluate<number>("document.querySelectorAll('div.vdirs').length")).toBe(0);
  expect(await wire.evaluate<string>("document.querySelector('div.ports.vault').innerText")).not.toContain("Browse");

  // A WORKSPACE, so there is a rail and a strip to read. Made through the wire
  // with this launch's token, which is the call the Create button makes.
  const parent = join(box.root, "folders");
  mkdirSync(parent, { recursive: true });
  const made = JSON.parse(await wire.evaluate<string>(
    call("vault.create", { parent, name: "Packaged" }, ready.token),
  )) as { body: string };
  const answer = JSON.parse(made.body) as { ok: boolean; value?: { path?: string } };
  expect(answer.ok).toBe(true);
  const vault = String(answer.value?.path);

  await wire.evaluate(`location.href = ${JSON.stringify("/?token=")} + ${JSON.stringify(ready.token)} + "&vault=" + encodeURIComponent(${JSON.stringify(vault)}) + "#/page/home"`);
  await until("the workspace drew", BOUNDS.draw, async () =>
    (await wire.evaluate<number>("document.querySelectorAll('iframe.artifact').length")) === 1);

  // THE ROW THAT WAS IN THE SOURCE AND NOT IN THE BUILD, which is where it went
  // missing and therefore where it has to be asserted.
  await until("the Dashboard row was drawn", BOUNDS.draw, async () =>
    (await wire.evaluate<number>("document.querySelectorAll('button.dashboardlink').length")) === 1);

  // AND THE ROW THAT IS MEANT TO BE GONE. Map draws the whole workspace as a
  // graph and a stranger's workspace is one page, so it is not in a built
  // application — and `VIEWS` loses the route with it.
  const foot = await wire.evaluate<string>("document.querySelector('nav.rack div.rackfoot').innerText");
  expect(foot).toContain("Design");
  expect(foot).toContain("Close workspace");
  expect(foot).not.toContain("Map");

  // AND THE TWO TOOLS THAT ARE MEANT TO BE GONE FROM THE BAR. History reads the
  // vault's git log; Modify page hands out a path to `cd` into and a prompt for
  // a coding agent in a terminal beside this window. Reload is what is left.
  const tools = await wire.evaluate<string>("document.querySelector('div.rail span.tools').innerText");
  expect(tools).toContain("Reload");
  expect(tools).not.toContain("History");
  expect(tools).not.toContain("Modify page");

  // THE STRIP SAYS NOTHING A PERSON WHO NEVER CLONED THIS REPOSITORY CANNOT ACT
  // ON. Declared, drawn and the data grant are a compliance report between the
  // host and the box, and none of the three is in a built application.
  const strip = await wire.evaluate<string>("document.querySelector('span.status').innerText");
  for (const gone of ["Sections", "Drawn", "Data"]) expect([gone, strip.includes(gone)]).toEqual([gone, false]);
});

walk("maximise and full screen flip the window, and the bar follows it", async () => {
  const state = async (): Promise<{ maximized: boolean; fullScreen: boolean }> =>
    JSON.parse(await wire.evaluate<string>("window.biomShell.windowControls.state().then(s => JSON.stringify(s))"));
  const labels = async (): Promise<string[]> => JSON.parse(await wire.evaluate<string>(
    "JSON.stringify([...document.querySelectorAll('header.titlebar button.wctl')].map(b => b.getAttribute('aria-label')))",
  ));

  /** PRESS ONE, ONCE, AND WAIT FOR THE WINDOW TO BE IT.
   *
   *  The wait either side is the whole of the reliability story here and both
   *  halves were measured. BEFORE: the bar is REBUILT on every state change, so
   *  the button that was on screen a moment ago is a detached element and the
   *  one to press may not exist yet — a click issued into that gap reads as
   *  `null.click()`. AFTER: a window manager is asked rather than told, and
   *  chaining a second act onto the first before the first has landed loses it —
   *  which is a person double-clicking a title bar, and it should not lose an
   *  act either. So the state is confirmed, THEN the icons are, and only then
   *  does the next press happen. */
  const press = async (kind: string, what: string, ok: () => Promise<boolean>): Promise<void> => {
    const at = `document.querySelector('header.titlebar button.wctl.${kind}')`;
    await until(`the bar offered ${kind}`, BOUNDS.draw, async () => (await wire.evaluate<boolean>(`${at} !== null`)));
    await wire.evaluate(`${at}.click()`);
    await until(what, BOUNDS.draw, ok);
  };

  expect(await state()).toEqual({ maximized: false, fullScreen: false });

  // THE BUTTON, not the channel behind it. `.click()` is the event the person's
  // mouse produces, into the handler the bar bound.
  await press("max", "the window maximised", async () => (await state()).maximized);
  // THE ICONS FOLLOW THE WINDOW AND NOT THE BUTTON THAT WAS PRESSED, which is
  // the only way they can be right after F11 or after the desktop maximised us.
  await until("the bar offered Restore down", BOUNDS.draw, async () => (await labels()).includes("Restore down"));

  await press("restore", "the window came back down", async () => !(await state()).maximized);
  await until("the bar offered Maximize again", BOUNDS.draw, async () => (await labels()).includes("Maximize"));

  await press("full", "the window went full screen", async () => (await state()).fullScreen);
  await until("the bar offered the way out", BOUNDS.draw, async () => (await labels()).includes("Leave full screen"));

  await press("unfull", "the window left full screen", async () => !(await state()).fullScreen);
  await until("the bar offered Full screen again", BOUNDS.draw, async () => (await labels()).includes("Full screen"));
}, noWm);

test.skipIf(why !== null || noWm === null)("maximise and full screen are not walked on this display", () => {
  // THE STEP ABOVE IS THE ONE THING HERE THAT NEEDS SOMEBODY ELSE TO ACT. A
  // window sets `_NET_WM_STATE_MAXIMIZED_*` or `_NET_WM_STATE_FULLSCREEN` and a
  // window manager honours it; a bare `Xvfb` has none, so the request is made,
  // nobody answers, and the state never changes. That is a fact about the
  // display and not about the application, and a failure there would be a lie —
  // `tools/screen.sh` starts a manager wherever one is installed, and this is
  // what a machine with none reads out as.
  expect(noWm).toBeString();
  console.log(`  skipped: ${noWm}`);
});

walk("closing the window quits the server with it", async () => {
  // THE WINDOW OWNS THE LIFETIME. Closing it must not leave a process holding a
  // port and a workspace open with nothing on screen to say so.
  const port = ready.port;
  const at = "document.querySelector('header.titlebar button.wctl.close')";
  await until("the bar offered close", BOUNDS.draw, async () => await wire.evaluate<boolean>(`${at} !== null`));
  // FIRED RATHER THAN AWAITED. The answer to this one would have to come back
  // from a renderer that the click destroys, so waiting for it waits out the
  // whole bound and then fails a step that did exactly what it was meant to.
  wire.fire(`${at}.click()`);

  await until("the application exited", BOUNDS.redraw, () => over());
  await until("the server stopped answering", BOUNDS.redraw, async () => {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      return false;
    } catch {
      return true;
    }
  });

  // AND NO PROCESS OF IT IS LEFT. A port that stopped answering is not the same
  // statement: a server mid-exit answers nothing and is still a process holding
  // a workspace open. What was found on the owner's machine after the font crash
  // was exactly that — a `biom-server` with no window in front of it, twice — so
  // this asks the operating system rather than the socket.
  if (process.platform === "win32") {
    console.log("  the orphan check needs pgrep, which Windows has not got — the port check above is what stands here");
  } else {
    await until("no biom-server of this run is left running", BOUNDS.redraw, () =>
      running(bundleServer()).every((pid) => ours.has(pid)));
  }
});

test.skipIf(why !== null)("nothing was written outside this run's own folder", () => {
  // The same assertion layer one makes, about the program the bug was found in:
  // the packaged application writes an Electron profile of its own as well as
  // the server's remembered list, and neither may land on the person's disk.
  expect(outside()).toBe(before);
  expect(existsSync(join(box.data, "vaults.json"))).toBe(true);
});

test.skipIf(why === null)("the packaged application is not walked on this machine", () => {
  // A NAMED SKIP IS A RESULT. A run that quietly walks nothing and reports green
  // is worse than one that fails, so the reason is on the record either way.
  expect(why).toBeString();
  console.log(`  skipped: ${why}`);
});

/* ── and a launch whose remembered workspace has gone ───────────────────── */

test.skipIf(why !== null)(
  "a packaged launch whose remembered workspace is gone still opens a window, on the picker",
  async () => {
    // THE SYMPTOM WAS NOTHING AT ALL, and that is why this is layer two rather
    // than layer one. The server's refusal is walked seven ways in
    // `startup.e2e.ts`, in a browser, where a dead process shows up as a fetch
    // that never answers. Here it showed up as an application that did not
    // start: the server exited 1 on the way up, the shell never got a ready
    // line, and no window was ever opened — so there was no screen to look at
    // and nothing to read but a stack trace somebody would have had to run the
    // binary from a terminal to see.
    //
    // A LAUNCH OF ITS OWN, because what is under test is what the process does
    // ON THE WAY UP, and the launch above has already come up.
    const box2 = sandbox("app-bad-vault");
    const wall = outside();
    let second: ReturnType<typeof Bun.spawn> | null = null;
    let wire2: Cdp | null = null;
    const heard = { out: "", err: "" };
    try {
      // A remembered workspace that is now a FILE — the state that produced
      // `EEXIST` out of `mkdir` and took the process with it.
      mkdirSync(box2.data, { recursive: true });
      const gone = join(box2.root, "Work");
      writeFileSync(gone, "a file where a workspace used to be", "utf8");
      writeFileSync(join(box2.data, "vaults.json"), JSON.stringify({ recent: [gone] }, null, 2) + "\n", "utf8");

      const port = await freePort();
      const how = HOW as { argv: string[]; how: string; wm: string | null };
      const relaxed = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
      second = Bun.spawn([...how.argv, bundle(), `--remote-debugging-port=${port}`, ...relaxed], {
        env: box2.env, stdout: "pipe", stderr: "pipe",
      });
      for (const [stream, into] of [[second.stdout, "out"], [second.stderr, "err"]] as const) {
        void (async () => {
          const decoder = new TextDecoder();
          for await (const chunk of stream as ReadableStream<Uint8Array>) {
            heard[into as "out" | "err"] += decoder.decode(chunk);
          }
        })();
      }

      await step("the bad-vault launch", "app-bad-vault.png", () => heard.err, async () => {
        // THE READY LINE, which is the whole of the fix at this layer: the
        // process lived long enough to serve, so the shell had an address to
        // open a window at.
        await until("the application said it was ready", BOUNDS.launch, () => READY.test(heard.out));
        wire2 = await cdp(port, BOUNDS.launch);

        await until("the picker was drawn", BOUNDS.draw, async () =>
          await wire2!.evaluate<boolean>("document.querySelector('div.ports.vault') !== null"));
        await wire2.shot("app-bad-vault.png");

        // AND IT SAYS WHY. A folder chooser that appears with no reason given is
        // the application pretending the person's workspace never existed.
        const screen = await wire2.evaluate<string>(
          "(document.querySelector('div.vaulttrouble') ?? document.querySelector('div.ports.vault')).innerText",
        );
        expect(screen).toContain("file, not a folder");

        // THE FILE IS STILL A FILE. Nothing was mounted, so nothing was written.
        expect(readFileSync(gone, "utf8")).toBe("a file where a workspace used to be");
        expect(outside()).toBe(wall);
      });
    } finally {
      // CLOSED THROUGH THE WINDOW, NOT KILLED, and that is not tidiness. What is
      // spawned here is `xvfb-run`, which starts a display and then
      // `screen.sh`, which starts a window manager and then the application — so
      // killing the process this test holds kills the WRAPPER and leaves the
      // application, and the display it is on, running after the suite has gone.
      // Measured: one orphaned Biom and one orphaned Xvfb per run. Close is the
      // act the shell already implements and the step above already proves — the
      // window goes, the server goes with it, `screen.sh` returns and
      // `xvfb-run` takes the display down on its way out. The kill below stays
      // as the fallback for a launch that never got a window to close.
      const held = wire2 as Cdp | null;
      if (held !== null) {
        held.fire("document.querySelector('header.titlebar button.wctl.close')?.click()");
        await Promise.race([second?.exited, new Promise((r) => setTimeout(r, 10000))]);
        held.close();
      }
      if (second !== null && second.exitCode === null) {
        second.kill();
        await Promise.race([second.exited, new Promise((r) => setTimeout(r, 5000))]);
        if (second.exitCode === null) second.kill(9);
      }
      box2.clean();
    }
  },
  180000,
);
