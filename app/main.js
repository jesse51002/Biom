// SPDX-License-Identifier: AGPL-3.0-only
// THE SHELL. It spawns, reads, opens and quits, and it is deliberately nothing
// else.
//
// The shell owns the LIFETIME and the server owns the ADDRESS. Electron does not
// choose a port, does not guess one and does not retry: it starts the compiled
// server, reads back what the operating system gave it along with the token that
// server minted for this launch, and only then opens a window. Nothing else on
// the machine can predict either value.
//
// THAT IS THE WHOLE OF THE GUARD ON THE API ROUTE, AND NOT ON EVERY ROUTE. The
// server refuses `/api/call` without the token — every page, every table, every
// write — and leaves its own read-only static files open, because the box has an
// opaque origin and loads them by URL with no way to set a header. The two
// vault-rooted GET routes, `/v/<vault>/asset/` and `/v/<vault>/plugin/`, serve
// the person's own folder and are open too; `server/main.ts` says at `tokenOk`
// why they are not guarded yet and what settling them would cost.
//
// A shell that knew what a vault was, or which page to open, would be a second
// place the product is described. So it knows one url shape and four events.
//
// WHAT IT INJECTS IS THE FOLDER DIALOG AND THE WINDOW ITSELF, AND THE LIST IS
// CLOSED. `app/preload.js` exposes `window.biomShell.chooseFolder()`, which
// answers an absolute path or null, because choosing a folder is the one thing
// a web page cannot do; `window.biomShell.logo()`, the one committed picture of
// the mark as a data URL, because the bar wears it and `app/` is not served;
// and `window.biomShell.windowControls`, which minimises, maximises, full
// screens and closes THIS window, reads its state and says when that state
// changed. **The controls are there because the application draws its own title
// bar** — see `open()` below — so they exist on every desktop and none of them
// depends on what a window manager decided to show. Everything else a bridge
// could carry — node, `fs`, a `shell`, a raw `ipcRenderer` — is deliberately not
// there, and the client treats the whole object's ABSENCE as a supported state
// rather than a fault, which is what keeps `make dev` in a browser and the built
// application the same program: no `biomShell` is a browser, the picker draws
// the served listing and the page draws no title bar at all.
//
// NOT PART OF THE LAYERED APPLICATION. It runs in Electron's main process, which
// is neither the server nor the client; `layers.json` maps it to nothing and the
// gate walks past it. `SHELL_FILES` in `tools/app.ts` is the list of what gets
// copied into the staging directory it packages — this file and everything it
// reads from beside itself — and the bundle's own icon containers are generated
// from the logo in that list.

const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const { mkdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const { dataHome } = require("./data.js");

/** What `tools/app.ts` named the compiled server, beside this file — inside
 *  `resources/app` in a packaged bundle and in `dist/stage` before one. */
const SERVER = join(__dirname, process.platform === "win32" ? "biom-server.exe" : "biom-server");

/** The preload beside it, and the one channel it talks over. The channel name is
 *  spelled here and in `app/preload.js`, and in no third place. */
const PRELOAD = join(__dirname, "preload.js");
const CHOOSE = "biom:choose-folder";
const LOGO = "biom:logo";

/** THE WINDOW, AS FIVE ACTS AND ONE PUSH. Every name is spelled here and in
 *  `app/preload.js`, and in no third place — the same rule `CHOOSE` is under.
 *  Five `ipcMain.handle` channels the page calls, and one `webContents.send`
 *  channel the window pushes on: nothing else crosses, and in particular no
 *  channel takes a window id, because there is exactly one window. */
const MINIMIZE = "biom:window-minimize";
const MAXIMIZE = "biom:window-maximize";
const FULLSCREEN = "biom:window-fullscreen";
const CLOSE = "biom:window-close";
const STATE = "biom:window-state";
/** The one thing the main process says without being asked: the window was
 *  maximised or full-screened by something that is not our button — F11, a
 *  double-click on our bar, the desktop's own keyboard shortcut, a tiling
 *  manager — so the icon that says which it is has to flip. */
const CHANGED = "biom:window-changed";
/** THE OTHER THING IT SAYS UNASKED: the window was asked to close while an
 *  automation is running. The main process holds the close, says how many are
 *  alive, and the page draws the question in the application's own chrome —
 *  yes closes for real, which ends every run on the way out; no keeps the
 *  window and the runs. See `holdTheClose`. */
const CLOSING = "biom:window-closing";

/** THE LOGO, AND THERE IS ONE FILE OF IT. Beside this one, copied into the
 *  staging directory with the rest of the shell, so the path resolves the same
 *  inside a packaged bundle as it does in `dist/stage`. This is the WINDOW's
 *  icon — the title bar and the task bar on Linux and Windows, where a window
 *  carries its own. The BUNDLE's icon is a different thing in a different
 *  format and `tools/app.ts` generates it; macOS takes its icon from the bundle
 *  and ignores this one, which is why nothing here special-cases a platform.
 *
 *  IT IS ALSO THE MARK IN OUR OWN TITLE BAR. The window's bar is drawn by the
 *  page now, and `app/` is not a served directory, so the same file goes over
 *  the bridge as a data URL — see `logoUrl()`. One picture of the logo, three
 *  jobs, and no second copy of it to go stale. */
const ICON = join(__dirname, "icon.png");

/** The launcher entry `tools/install.ts` wrote for this application, named so a
 *  Wayland compositor can match this window to it — see `setDesktopName` below.
 *  Spelled there as `DESKTOP_FILE` and here, and a test holds the two equal. */
const DESKTOP_FILE = "biom.desktop";

/** The one line the server prints for this process, before anything else it
 *  says. Read off stdout rather than out of a file: a file is a thing left
 *  behind when the app is killed, and scanning ports is a guess. */
const READY = /^biom ready (\{.*\})$/m;

/** HOW LONG A FIRST DRAW MAY TAKE BEFORE IT COUNTS AS NEVER. The window loads
 *  one page off a server on this machine, so this is not a network budget and
 *  does not have to be generous — it is the difference between a slow start and
 *  a window that is never going to appear. Cleared on the first
 *  `did-finish-load` and never armed again. */
const FIRST_DRAW_MS = 20000;

/** THE SERVER IS TOLD THAT SOMEBODY IS HOLDING ITS STDIN, and that is the whole
 *  of the second half of the lifetime.
 *
 *  The shell owns the lifetime and quits the server when the window closes — but
 *  only where the shell is alive to do it. A main process that ABORTS runs no
 *  handler of ours: the `before-quit` and `will-quit` arms below never fire, and
 *  what is left behind is a `biom-server` holding a port and somebody's workspace
 *  open with nothing on screen to say so. That is not hypothetical — it is what
 *  the font-cache abort described at `sayNothingDrew()` left on the owner's
 *  machine, twice.
 *
 *  So the server is given a PIPE as its stdin and this marker in its environment,
 *  and it exits when that pipe reaches end of file. Nothing is ever written down
 *  it: the only message it carries is its own closing, which the operating system
 *  performs when the last handle to the write end goes — which is what happens
 *  when this process dies, however it dies, on all three platforms.
 *
 *  THE MARKER IS WHY IT IS SAFE. A server started any other way — `make dev`, a
 *  compiled binary run from a terminal, a launcher that points stdin at
 *  `/dev/null` and gets an instant end of file — has no marker and watches
 *  nothing. `server/main.ts` spells the same name and no third place does. */
const PARENT = "BIOM_SHELL";

/** THE NAME THIS PROCESS PUTS IN THE ENVIRONMENT IT RESTARTS ITSELF WITH, so the
 *  second pass knows it already has the cache it asked for. Spelled here and
 *  nowhere else — nothing but `ownFontCache()` reads it. */
const OWN_CACHE = "BIOM_OWN_CACHE";

/** CHROMIUM READS A FONT CACHE OF THE APPLICATION'S OWN, and getting it one
 *  means starting this program over.
 *
 *  WHAT IT IS FOR is the abort described at `sayNothingDrew()`: a
 *  `~/.cache/fontconfig` holding caches written by two different fontconfig
 *  versions — a host and a toolbox sharing one home directory — hands Chromium a
 *  font list it cannot use, and it aborts at
 *  `SkFontMgr_FontConfigInterface.cpp:163` without drawing anything. The dialog
 *  below still says what to do about a window that never draws, because there is
 *  more than one reason for that; what this adds is that a stranger never gets
 *  there, and a stranger is exactly who will not know to run a cleanup command
 *  on a machine they have not been told is at fault.
 *
 *  IT REDIRECTS RATHER THAN REPAIRS, which is the whole of why this is allowed
 *  where a `FONTCONFIG_PATH` was not. Nothing of the person’s is touched, read,
 *  cleared or rewritten: `~/.cache/fontconfig` is theirs and every other program
 *  on the machine goes on reading it. This application reads
 *  `<dataHome>/cache` — beside the vault list the server keeps, `app/data.js`
 *  being the shell's copy of that one rule — which nothing but this application
 *  writes and which therefore holds the files of exactly one fontconfig: the one
 *  inside this bundle.
 *
 *  WHY IT RESTARTS RATHER THAN SETTING A VARIABLE AND GOING ON. Measured with
 *  the bundle this repository builds: Chromium has already read fontconfig's
 *  cache by the time this file runs, so a launch that only set
 *  `process.env.XDG_CACHE_HOME` here wrote its `fontconfig/` into the caller's
 *  cache directory and put nothing but the shader caches in ours. The variable
 *  has to be in the environment the process STARTS with.
 *
 *  AND IT IS `execve`, NOT A SECOND PROCESS. This one REPLACES itself: same
 *  process id, same standard streams, same terminal, same everything whatever
 *  started Biom is holding on to — so a desktop launcher, `xvfb-run`, a script
 *  waiting on it and this repository's own end-to-end suite all see exactly the
 *  program they started. A shell that spawned a child and supervised it instead
 *  was tried and is worse in a way that is easy to miss: the first process has
 *  already taken whatever its command line asked for, so a
 *  `--remote-debugging-port` ends up bound by a process with no window in it.
 *  Replacing the image hands all of that to the second pass.
 *
 *  THE COST IS ONE SCAN ON A FIRST LAUNCH. An empty cache directory means
 *  fontconfig walks the machine’s font directories once and writes what it
 *  finds — what `fc-cache` does, a second or so — and every launch after it
 *  reads what that one wrote.
 *
 *  LINUX ONLY, because fontconfig is. macOS and Windows have their own font
 *  managers, `XDG_CACHE_HOME` means nothing to either, and `execve` is not on
 *  Windows at all.
 *
 *  AND IT NEVER REFUSES TO START. Every way this can fail — no `execve` on the
 *  runtime, a data directory that cannot be made, a replacement that throws —
 *  ends with one line on stderr and the launch going on with the machine's own
 *  cache, which is the launch every version before this one made. */
function ownFontCache() {
  if (process.platform !== "linux") return;
  // THE SECOND PASS, which is the one that opens the window. It has the cache it
  // asked for and must never ask again.
  if (process.env[OWN_CACHE] === "1") return;
  if (typeof process.execve !== "function") {
    console.error("this runtime cannot replace itself, so Biom is reading this machine's own font cache");
    return;
  }

  const cache = join(dataHome(), "cache");
  try {
    mkdirSync(cache, { recursive: true });
  } catch (e) {
    console.error("the application’s own cache directory could not be made", e);
    return;
  }

  try {
    // Nothing after this line runs: the process is this program again, with one
    // more variable in its environment and the same pid, streams and arguments.
    process.execve(process.execPath, [process.execPath, ...process.argv.slice(1)], {
      ...process.env,
      XDG_CACHE_HOME: cache,
      [OWN_CACHE]: "1",
    });
  } catch (e) {
    console.error("Biom could not restart with a font cache of its own, and is reading this machine's", e);
  }
}

ownFontCache();

/** SINGLE INSTANCE, and it is Electron's own lock. A second launch focuses the
 *  window that is open — the server already holds several vaults at once and
 *  addresses them by path, so one process serving whichever folders are open is
 *  the design it already has, and a second process on this machine is what has
 *  no place. Opening a different vault is therefore a navigation inside the one
 *  window, exactly as it is in a browser. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let server = null;
  let win = null;
  let ready = false;
  /** Has the window drawn a page even once. Everything below is about the gap
   *  between `loadURL` and the first `did-finish-load`, and about nothing after
   *  it: a renderer that dies later is an ordinary crash Chromium recovers from
   *  or a window the person can close. */
  let drew = false;
  /** Set when we are on our way out with a sentence already said, so the
   *  server's own exit does not overwrite it with a second, vaguer one. */
  let saidWhy = false;
  let drawTimer = null;

  app.on("second-instance", () => {
    if (win === null) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  /** What the window says when the thing behind it is gone. A page that half
   *  works is worse than a sentence: the server holds every answer this window
   *  can draw, so there is nothing honest to show once it has exited. */
  function saySoServerIsGone(why) {
    if (win === null || win.isDestroyed()) return;
    const html =
      "<!doctype html><meta charset=utf-8><title>Biom</title>" +
      "<style>html{font:16px/1.6 system-ui,sans-serif;padding:3rem;max-width:34rem}" +
      "h1{font-size:1.1rem;margin:0 0 .75rem}p{margin:0 0 .5rem;opacity:.8}</style>" +
      "<h1>The Biom server has stopped.</h1>" +
      "<p>Nothing on this page is live any more. Close this window and open Biom again.</p>" +
      "<p>" +
      why +
      "</p>";
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  }

  /** NO MENU BAR, AND IT IS REMOVED BEFORE ANY WINDOW EXISTS. Electron's default
   *  menu is File, Edit, View, Window, Help — a developer's menu, with a Toggle
   *  Developer Tools and a Reload in it, describing a program this one is not.
   *  Nothing in this application is reached from a menu: the window is one page
   *  and everything on it is in the page. So the whole application menu goes,
   *  and the window keeps its ordinary title bar and its ordinary controls.
   *
   *  ON macOS THE EDIT ROLES HAVE TO STAY, and that is not a preference either.
   *  Copy, paste, select all and undo inside a web page are Chromium's on Linux
   *  and Windows and the MENU'S on macOS — a null application menu there is a
   *  window where ⌘C does nothing. So macOS gets a menu holding exactly the edit
   *  roles and nothing else, hidden, so the accelerators are registered and no
   *  bar of ours is drawn. macOS draws its own application menu regardless of
   *  what is set here, and no program can remove that one.
   *
   *  WHAT REPLACED THE MENU IS NOT NOTHING. The window has no desktop title bar
   *  either — see `chromeOf()` — and the client draws one, carrying the mark,
   *  the workspace's name and the window's controls. That is the answer to
   *  "then where is full screen": on the bar, on every platform, in our own
   *  type, rather than behind a menu nobody opened. */
  function unmenu() {
    if (process.platform !== "darwin") {
      Menu.setApplicationMenu(null);
      return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "editMenu", visible: false },
      // macOS has its own full screen — the green light — and the accelerator
      // for it lives on a menu role, so the role rides in the hidden menu too.
      { role: "viewMenu", visible: false, submenu: [{ role: "togglefullscreen" }] },
    ]));
  }

  /** FULL SCREEN ON F11, AND IT IS KEPT NOW THAT THERE IS A BUTTON.
   *
   *  The bar's full-screen button is the discoverable way and F11 is the one
   *  every browser and editor already trained people to reach for, so a window
   *  that dropped it on growing a button would be a window that took something
   *  away. Linux and Windows only: macOS has the green light and ⌃⌘F on the
   *  hidden view role above, and F11 there is the desktop's own key, so it is
   *  left alone. Either route ends at `setFullScreen`, and either way the
   *  window's own `enter-full-screen` tells the bar which icon to wear. */
  function fullscreenOnF11(w) {
    if (process.platform === "darwin") return;
    w.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.key !== "F11") return;
      event.preventDefault();
      w.setFullScreen(!w.isFullScreen());
    });
  }

  /** THE CRASH WITH NO WINDOW AND NO MESSAGE, TURNED INTO A SENTENCE.
   *
   *  Measured on this machine: `~/.cache/fontconfig` held caches written by two
   *  different fontconfig versions — a host and a toolbox sharing one home
   *  directory — so Chromium was handed a font list it could not use, aborted
   *  with `FATAL: SkFontMgr_FontConfigInterface.cpp:163 Not implemented`, and
   *  dumped core. What a person saw was nothing at all: no window, no error, an
   *  application that appeared not to start.
   *
   *  THAT PARTICULAR CAUSE IS NOW SIDESTEPPED. `ownFontCache()` points Chromium
   *  at a cache under the application's own data directory, so the person's
   *  `~/.cache/fontconfig` is not read by this program at all and a mixture in it
   *  cannot reach us. **Nothing of theirs is repaired**: no `FONTCONFIG_PATH`, no
   *  font flag, nothing cleared and nothing rewritten — that cache is theirs and
   *  every other program on the machine goes on reading it.
   *
   *  SO THIS STAYS, because a window that never draws has more causes than one:
   *  a driver, a font directory that cannot be read, a machine under enough load
   *  that twenty seconds pass. The shell watches the ONE gap where a death means
   *  that — between asking for the first page and being told it drew — and says
   *  what it is and what to do about it, with the font cache still named in the
   *  dialog because it is the cause that was measured and because a cache of the
   *  machine's own can be broken in ways ours never sees.
   *
   *  WHAT THIS CANNOT CATCH, and it is worth knowing: if Chromium aborts in its
   *  BROWSER process rather than a child, this process is the one that died and
   *  no handler of ours runs. The three arms below cover the renderer, the GPU
   *  and every other child, plus the case where nothing dies and nothing draws. */
  function sayNothingDrew(why) {
    if (saidWhy) return;
    saidWhy = true;
    if (drawTimer !== null) {
      clearTimeout(drawTimer);
      drawTimer = null;
    }

    // ONE SENTENCE, on stderr, for whoever launched this from a terminal.
    console.error(`biom: the window never drew — ${why}`);

    const linux = process.platform === "linux";
    const body =
      `The window never drew: ${why}.\n\n` +
      (linux
        ? "On Linux this is almost always a stale or mixed font cache. Chromium " +
          "finds no usable font and stops before it can draw anything.\n\n" +
          "Clearing the cache fixes it:\n\n" +
          "    rm -rf ~/.cache/fontconfig && fc-cache -f\n\n" +
          "Then open Biom again."
        : "Open Biom again. If it keeps happening, the graphics or font settings " +
          "on this machine are the place to look.");
    dialog.showErrorBox("Biom could not draw its window", body);

    stop();
    // Non-zero, and `exit` rather than `quit`, because `quit` is a request the
    // window could still answer and there is nothing behind that window.
    app.exit(1);
  }

  /** The three ways the gap ends badly, armed on the window that was just made.
   *  A death after the first draw is not this — it is an ordinary crash, and it
   *  goes past every one of these. */
  function watchTheFirstDraw() {
    win.webContents.on("did-finish-load", () => {
      drew = true;
      if (drawTimer === null) return;
      clearTimeout(drawTimer);
      drawTimer = null;
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      if (drew) return;
      sayNothingDrew(`the page's process stopped before the first page loaded (${details.reason})`);
    });
    app.on("child-process-gone", (_event, details) => {
      if (drew) return;
      sayNothingDrew(`the ${details.type} process stopped before the first page loaded (${details.reason})`);
    });
    drawTimer = setTimeout(() => {
      drawTimer = null;
      if (drew) return;
      sayNothingDrew("nothing was drawn within twenty seconds of asking for the first page");
    }, FIRST_DRAW_MS);
  }

  /** THE APPLICATION DRAWS ITS OWN TITLE BAR, the way VS Code, Discord and
   *  Slack do, and this is where the desktop's one is taken away.
   *
   *  The owner decided this on 2026-09-14 and the reason is that the desktop's
   *  bar is not the same bar twice: GNOME hides the maximise button by default,
   *  offers no full-screen button at all, and puts the close button on the side
   *  its own settings say. A window whose controls are drawn by the page has the
   *  same controls on every machine, in the product's own type, and they are
   *  ours to label.
   *
   *  THE OPTION IS DIFFERENT ON EACH PLATFORM AND NONE OF THE THREE IS A
   *  PREFERENCE.
   *
   *  · **Windows — `titleBarStyle: "hidden"`.** It hides the bar and KEEPS the
   *    native frame underneath it: the resize edges, Aero Snap, the drop shadow
   *    and the snap-layouts flyout are all the window manager's and all still
   *    work. `frame: false` on Windows throws those away and they then have to
   *    be rebuilt in JavaScript, badly.
   *  · **Linux — `frame: false`.** `titleBarStyle` is macOS and Windows only;
   *    on Linux it is not implemented and setting it leaves the ordinary bar
   *    drawn, which is the bug this change exists to remove. `frame: false` is
   *    the only frameless there, and Electron keeps the resize edges itself —
   *    what is lost is the window manager's own double-click-to-maximise, which
   *    is why our bar binds a double-click of its own.
   *  · **macOS — `titleBarStyle: "hiddenInset"`.** The traffic lights stay,
   *    inset into our bar, because on macOS they are the window controls and a
   *    Mac window that drew its own three dots would be wrong in a way every
   *    Mac user can see. So the client draws no close, no minimise and no zoom
   *    there — the preload says so — and leaves them room; the full-screen
   *    button it DOES draw, because it is ours on every platform.
   *  @returns {object} */
  function chromeOf() {
    if (process.platform === "darwin") return { titleBarStyle: "hiddenInset" };
    if (process.platform === "win32") return { titleBarStyle: "hidden" };
    return { frame: false };
  }

  /** Is there a window to act on. Every control handler asks first: a message
   *  can be in flight while the window is going away. */
  const alive = () => win !== null && !win.isDestroyed();

  /** What the buttons need to know, and the whole of it. Two booleans: which
   *  icon the maximise button wears, and which the full-screen one does. */
  function stateOf() {
    return alive()
      ? { maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
      : { maximized: false, fullScreen: false };
  }

  /** Say so, unasked. Armed on the window in `open` for every event that can
   *  move either boolean, so the bar is right after F11, after a drag to the top
   *  of the screen, and after anything else on the desktop did it for us. */
  function tellState() {
    if (!alive()) return;
    win.webContents.send(CHANGED, stateOf());
  }

  /** THE MARK, AS A DATA URL, AND IT IS THE SAME PICTURE AS THE WINDOW ICON.
   *  `app/` is not a served directory — the server carries `client/`, `guest/`,
   *  `vendor/`, `vault/`, `skill/` and `contracts/` and nothing else — so a bar
   *  that wanted the logo over HTTP would need a route, and a second copy of the
   *  logo under `client/` would be a second copy of the logo. Read once, held,
   *  and handed over as bytes. An empty string is an honest answer: the bar
   *  draws its name without a mark rather than a broken image. */
  let logo = null;
  function logoUrl() {
    if (logo !== null) return logo;
    try {
      logo = "data:image/png;base64," + readFileSync(ICON).toString("base64");
    } catch (e) {
      console.error("the mark could not be read", e);
      logo = "";
    }
    return logo;
  }

  /** ASK BEFORE CLOSING OVER A LIVE RUN.
   *
   *  Every automation is a process group the server started, and the server
   *  ends every one of them on its own way out — which is what closing this
   *  window does. So the window does not simply close: the close is HELD, the
   *  server is asked `run.live` on the unprefixed route with this launch's
   *  token, and where anything is alive the page is told how many and draws
   *  the question. `forced` is the page's yes, and it is the one way past the
   *  hold. A server that does not answer — dead, or on its way there — has
   *  nothing to keep running, and the window closes at once.
   *
   *  It is the WINDOW's close event, so it covers the bar's own button, the
   *  desktop's Alt+F4 and a window manager's close alike: every route to a
   *  closed window runs through it. */
  let forced = false;
  function holdTheClose(port, token) {
    if (!win) return;
    win.on("close", (event) => {
      if (forced) return;
      event.preventDefault();
      const ask = fetch(`http://localhost:${port}/api/call?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "close", g: 1, kind: "run.live" }),
      }).then((r) => r.json()).then((res) => (res && res.ok && typeof res.value === "number" ? res.value : 0), () => 0);
      ask.then((alive) => {
        if (!win) return;
        if (alive > 0) {
          win.webContents.send(CLOSING, alive);
        } else {
          forced = true;
          win.close();
        }
      });
    });
  }

  function open(port, token) {
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      ...chromeOf(),
      // The window's own icon, which is the title bar and the task bar on Linux
      // and Windows. macOS reads the bundle's instead and ignores this.
      icon: ICON,
      // THE PRELOAD IS THE WHOLE BRIDGE, and `app/preload.js` is the list.
      // The client is otherwise the same client a browser loads: the preload
      // adds the folder dialog, the mark and this window's own controls, and
      // the client draws the title bar only because they are there. Context
      // isolation keeps the preload in its own world, node is off in both, and
      // the sandbox is Electron's default, which `contextBridge` and
      // `ipcRenderer` both work inside.
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: PRELOAD },
    });
    // The token rides on the address, exactly as the vault prefix does. The
    // client reads it out of `location.search` and puts it on every API call;
    // nothing else on the machine has it, and it is minted fresh per launch.
    watchTheFirstDraw();
    fullscreenOnF11(win);
    holdTheClose(port, token);
    // The bar's icons follow the window rather than the button that was
    // pressed, which is the only way they can be right after F11 or after the
    // desktop maximised us. `restore` is in the list because leaving a
    // minimise is a state change the page never saw the start of.
    for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"]) {
      win.on(ev, tellState);
    }
    win.loadURL(`http://localhost:${port}/?token=${encodeURIComponent(token)}`);
    win.on("closed", () => {
      win = null;
      // THE WINDOW OWNS THE LIFETIME. Closing it quits the server rather than
      // leaving a process holding a port and a workspace open with nothing on
      // screen to say so.
      app.quit();
    });
  }

  /** THE WHOLE OF WHAT CROSSES. The operating system's own folder dialog,
   *  answering one absolute path or null. It creates no folder of its own —
   *  `createDirectory` is the macOS dialog's New Folder button, which is the
   *  person making a folder in their own file manager — and it decides nothing:
   *  whether that path may be opened, or may hold a new workspace, is the
   *  server's, exactly as it is for a path the browser build browsed to. */
  ipcMain.handle(CHOOSE, async () => {
    const options = { properties: ["openDirectory", "createDirectory"] };
    const over = win !== null && !win.isDestroyed();
    const chosen = await (over ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    if (chosen.canceled) return null;
    return chosen.filePaths.length === 0 ? null : chosen.filePaths[0];
  });

  /** THE WINDOW, AS FIVE ACTS. Each is one handler, each acts on the one window
   *  and none of them takes an argument — a channel that took a window id would
   *  be a channel a page could aim somewhere else. `close` is `close` rather
   *  than `destroy`, so it goes through the same `closed` handler the desktop's
   *  own button went through and the server still stops. */
  ipcMain.handle(MINIMIZE, () => { if (alive()) win.minimize(); });
  ipcMain.handle(MAXIMIZE, () => {
    if (!alive()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(FULLSCREEN, () => { if (alive()) win.setFullScreen(!win.isFullScreen()); });
  // `force` is the page answering yes to the question `holdTheClose` asked:
  // close whatever is running, and the server ends it on the way out.
  ipcMain.handle(CLOSE, (_event, force) => { if (force === true) forced = true; if (alive()) win.close(); });
  ipcMain.handle(STATE, () => stateOf());
  ipcMain.handle(LOGO, () => logoUrl());

  app.whenReady().then(() => {
    // Before anything is spawned and long before `open` runs, because a menu set
    // after a window exists is a menu somebody sees flicker.
    unmenu();

    // WHICH INSTALLED APPLICATION THIS WINDOW IS — a question only Linux asks,
    // and one only Wayland cannot answer without being told. There is no window
    // property for a compositor to read a name out of: it matches the window's
    // app id against an INSTALLED `.desktop` file, and a window that matches
    // nothing gets no icon and no name in the task bar however good the picture
    // inside the bundle is. `tools/install.ts` writes that file, `DESKTOP_FILE`
    // there is this string, and a test holds the two equal. The entry's
    // `StartupWMClass` is the other half of the match and is the application's
    // name — which Electron takes from `app/package.json` — rather than this.
    if (process.platform === "linux" && typeof app.setDesktopName === "function") {
      app.setDesktopName(DESKTOP_FILE);
    }

    // STDIN IS A PIPE THIS PROCESS HOLDS AND NEVER WRITES DOWN, and the marker
    // beside it is what tells the server to watch it — see `PARENT` above. The
    // environment is otherwise the one this process inherited, plus whatever
    // `ownFontCache()` put on it, which the server is welcome to and never uses.
    server = spawn(SERVER, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, [PARENT]: "1" },
    });

    let seen = "";
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (ready) return;
      seen += chunk;
      const hit = READY.exec(seen);
      if (hit === null) return;
      ready = true;
      try {
        const said = JSON.parse(hit[1]);
        open(said.port, said.token);
      } catch (e) {
        console.error("the server's ready line could not be read", e);
        app.quit();
      }
    });
    server.stderr.setEncoding("utf8");
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));

    server.on("error", (e) => {
      console.error("the server could not be started", e);
      if (!ready) app.quit();
      else saySoServerIsGone("It could not be restarted: " + String(e.message || e));
    });

    // A server that dies BEFORE the window opens leaves nothing to show, so the
    // application exits rather than opening a window pointed at nothing. One
    // that dies after is a window that has to say so.
    server.on("exit", (code) => {
      server = null;
      // We are already on our way out having said why, and a second, vaguer
      // sentence over the top of it is worse than none.
      if (saidWhy) return;
      if (!ready) {
        console.error(`the server exited before it was ready (${code})`);
        app.quit();
        return;
      }
      saySoServerIsGone(`It exited with code ${code}.`);
    });
  });

  const stop = () => {
    if (server === null) return;
    const going = server;
    server = null;
    going.kill();
  };
  app.on("before-quit", stop);
  app.on("will-quit", stop);
  app.on("window-all-closed", () => app.quit());
}
