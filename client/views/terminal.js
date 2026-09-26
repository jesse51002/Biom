// SPDX-License-Identifier: AGPL-3.0-only
// The sign-in terminal: a pop-up that runs one agent's sign-in. Layer 14.
//
// It is what is left of the agent terminal. A person talks to an agent on the
// Agent screen; a terminal is needed only when an agent's own way to sign in is
// a command of its own (the Chat spec's `credentials`), and a browser that
// cannot call back is where a code gets pasted. So this draws one emulator in a
// dialog over the workspace, starts the command the server resolved from a
// ticket, and closes when that command exits.
//
// IT NAMES NO COMMAND. What it sends is the TICKET the server answered
// `agents.signIn` with and the size it fitted; the server turns the ticket into
// the command, once. Output goes into the emulator and nowhere else: no link is
// opened on its say-so, and nothing it prints reaches the page or the stores.
//
// ONE AT A TIME, per window. A second `open` while one is up is refused rather
// than stacked: the dialog is modal, so a second can only come from code, and a
// sign-in the person cannot see is one they cannot answer.
//
// ITS LIFETIME IS THE SOCKET'S. Close ends the command, because closing the
// socket is how the server is told to take the command's tree; a command that
// exits cleanly closes the pop-up; one that fails leaves its last words on
// screen with the reason, because that output is the only account of what went
// wrong, until the person closes it. Whether the agent is signed in NOW is not
// decided here — the server looks at the agent again when the command has gone,
// and says so on the stream.
//
// The emulator is handed in by `boot.js` rather than imported, so this module
// has no third-party dependency and a test can build it with a fake.

/** @import { SocketMessage, TerminalSocket } from "../transport/terminal.js" */

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */
/** @typedef {{ ticket: string, title: string }} SignInRequest */
/** How the pop-up ended: the command's exit code, or null when it never ran,
 *  was ended by Close, or ended on a signal.
 *  @typedef {{ exitCode: number | null }} SignInResult */

/** What the pop-up is, under its title. */
export const SIGNIN_SUB = "Terminal, for this sign-in only";

/** @param {{ code: number | null, signal: string | null } | null} exit */
export function exitText(exit) {
  if (!exit) return "it closed before it finished";
  if (exit.code !== null && exit.code !== undefined) return `it exited with code ${exit.code}`;
  if (exit.signal) return `it was stopped by ${exit.signal}`;
  return "it exited";
}

/** The size the server will take: whole, and between 2 and 1000 each way.
 *  @param {{ cols: number, rows: number } | undefined} d */
const usable = (d) =>
  d && Number.isInteger(d.cols) && Number.isInteger(d.rows) && d.cols >= 2 && d.rows >= 2
    ? { cols: Math.min(d.cols, 1000), rows: Math.min(d.rows, 1000) }
    : null;

/**
 * @param {object} deps
 * @param {H} deps.h
 * @param {(hear: (m: SocketMessage) => void) => TerminalSocket} deps.connect
 *   opens this vault's terminal socket, which hears through `hear`
 * @param {new (options?: any) => any} deps.Terminal the emulator, from `@xterm/xterm`
 * @param {new () => any} deps.FitAddon from `@xterm/addon-fit`
 * @param {boolean} [deps.mac] whether copy and paste are Cmd rather than Ctrl+Shift
 * @param {HTMLElement} [deps.body] where the pop-up is put; the document's body
 */
export function makeSignInTerminal(deps) {
  const { h, connect, Terminal, FitAddon } = deps;
  const mac = deps.mac === true;
  /** @type {{ retheme(): void } | null} */
  let current = null;

  /** THE PALETTE, READ OFF THE ROOT. The emulator paints a canvas and cannot
   *  read a custom property, so the tokens are resolved here and handed over as
   *  values — and again on every theme change. The sixteen ANSI colours stay the
   *  emulator's own: those are what a program asked for, not chrome. */
  function palette() {
    if (typeof document === "undefined" || typeof getComputedStyle !== "function") return { theme: {}, fontFamily: "monospace" };
    const css = getComputedStyle(document.documentElement);
    const v = (/** @type {string} */ name) => css.getPropertyValue(name).trim() || undefined;
    return {
      theme: {
        background: v("--stock-lo"),
        foreground: v("--ink"),
        cursor: v("--cyan"),
        cursorAccent: v("--stock-lo"),
        selectionBackground: v("--field"),
      },
      fontFamily: v("--mono-face") ?? "monospace",
    };
  }

  /** The emulator's own key handler, with the platform's terminal habits laid
   *  over it — see `terminalKey` below for what each key does and why.
   *  @param {KeyboardEvent} e @param {any} term */
  function keys(e, term) {
    if (e.type !== "keydown") return true;
    const act = terminalKey(e, mac);
    if (act === "pass") return true;
    if (act === "host") return false;
    e.preventDefault();
    if (act === "copy") {
      if (term.hasSelection() && navigator.clipboard) void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
    } else if (act === "selectAll") term.selectAll();
    else if (act === "clear") term.clear();
    else term.input(act.send);
    return false;
  }

  /**
   * OPEN THE POP-UP AND RUN THE SIGN-IN A TICKET STANDS FOR. Resolves once the
   * pop-up has gone, with how the command ended.
   * @param {SignInRequest} req
   * @returns {Promise<SignInResult>}
   */
  function open(req) {
    if (current !== null) return Promise.reject(new Error("a sign-in is already open in this window"));
    if (!req || typeof req.ticket !== "string" || req.ticket === "") {
      return Promise.reject(new Error("a sign-in terminal needs the ticket its sign-in answered"));
    }
    const body = deps.body ?? document.body;
    const ticket = req.ticket;

    return new Promise((resolve) => {
      /** connecting → running → over. */
      let phase = /** @type {"connecting" | "running" | "over"} */ ("connecting");
      /** @type {{ code: number | null, signal: string | null } | null} */
      let exit = null;
      /** @type {string | null} */
      let error = null;
      let done = false;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let fitTimer = null;
      /** @type {ResizeObserver | null} */
      let watcher = null;
      const before = typeof document !== "undefined" ? /** @type {HTMLElement | null} */ (document.activeElement) : null;

      const said = h("p.signsaid", { role: "status", "aria-live": "polite" });
      const closer = h("button.signclose", {
        type: "button",
        "aria-label": "Close",
        title: "Close — ends the sign-in if it is still running",
        onclick: () => finish(),
      }, "×");
      const host = h("div.termhost");
      const screen = h("div.signscreen", host);
      const dialog = h("div.signdialog", { role: "dialog", "aria-modal": "true", "aria-labelledby": "signterm-title" },
        h("div.signhead",
          h("b#signterm-title", req.title || "Sign in"),
          h("span.signsub", SIGNIN_SUB),
          closer),
        screen,
        said);
      // EVERY KEY PRESSED IN HERE IS THE POP-UP'S. Escape in the emulator is the
      // program's — a sign-in cancels on it — and a dialog of the shell's
      // closing behind this one instead would be the host stealing it. Once
      // nothing is running, Escape closes the pop-up.
      const root = h("div.signterm", {
        onkeydown: (/** @type {KeyboardEvent} */ e) => {
          e.stopPropagation();
          if (e.key === "Escape" && phase === "over") {
            e.preventDefault();
            finish();
          }
        },
      }, dialog);

      const look = palette();
      const term = new Terminal({
        cursorBlink: true,
        disableStdin: true,
        // OPTION-DRAG SELECTS ON macOS even while a program has taken the mouse,
        // as it does in iTerm2 and Terminal.app; elsewhere that key is Shift and
        // the emulator already honours it.
        macOptionClickForcesSelection: true,
        fontFamily: look.fontFamily,
        fontSize: 13,
        lineHeight: 1.15,
        scrollback: 1000,
        theme: look.theme,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.attachCustomKeyEventHandler((/** @type {KeyboardEvent} */ e) => keys(e, term));

      body.append(root);
      try {
        term.open(host);
      } catch (e) {
        root.remove();
        term.dispose();
        throw e;
      }
      /** The size the command was last told. */
      let told = usable(fit.proposeDimensions()) ?? { cols: 80, rows: 24 };
      if (told.cols !== term.cols || told.rows !== term.rows) term.resize(told.cols, told.rows);

      /** Fit the emulator to its box, once the box has settled, and tell the
       *  command when the size changed. */
      const refit = () => {
        if (fitTimer !== null) clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
          fitTimer = null;
          if (done) return;
          const d = usable(fit.proposeDimensions());
          if (d === null) return;
          if (d.cols !== term.cols || d.rows !== term.rows) term.resize(d.cols, d.rows);
          if (phase === "running" && (d.cols !== told.cols || d.rows !== told.rows) && socket.send({ op: "resize", cols: d.cols, rows: d.rows })) told = d;
        }, 40);
      };
      if (typeof ResizeObserver === "function") {
        watcher = new ResizeObserver(refit);
        watcher.observe(screen);
      }
      if (typeof document !== "undefined" && document.fonts) void document.fonts.ready.then(refit);

      // THIS WINDOW'S ONE POP-UP, from here until `finish`.
      current = {
        retheme() {
          const next = palette();
          term.options.theme = next.theme;
          term.options.fontFamily = next.fontFamily;
          refit();
        },
      };

      /** @param {string} text */
      const say = (text) => {
        said.textContent = text;
        said.setAttribute("data-tone", "bad");
      };

      /** @param {Record<string, any>} event */
      const heard = (event) => {
        if (event.ev === "started") {
          phase = "running";
          term.options.disableStdin = false;
          term.focus();
          refit();
        } else if (event.ev === "exited") {
          const e = event.exit;
          exit = e && typeof e === "object"
            ? { code: typeof e.code === "number" ? e.code : null, signal: typeof e.signal === "string" ? e.signal : null }
            : { code: null, signal: null };
        } else if (event.ev === "error" && typeof event.message === "string") {
          // A sentence, drawn as text and never as markup.
          error = event.message;
          say(error);
        }
      };

      /** The socket has closed: the command is over, whichever end closed it. */
      const over = () => {
        if (done) return;
        phase = "over";
        term.options.disableStdin = true;
        if (exit !== null && exit.code === 0) {
          finish();
          return;
        }
        say(exit !== null ? `The sign-in did not finish: ${exitText(exit)}.` : error ?? "The sign-in closed before it finished.");
        closer.focus();
      };

      /** @type {TerminalSocket} */
      const socket = connect((m) => {
        if (done) return;
        if (m.kind === "open") socket.send({ op: "create", ticket, cols: told.cols, rows: told.rows });
        else if (m.kind === "bytes") term.write(m.data);
        else if (m.kind === "event") heard(m.event);
        else if (m.kind === "closed") over();
      });

      term.onData((/** @type {string} */ data) => {
        if (phase === "running") socket.send({ op: "input", data });
      });

      /** Take the pop-up down. Closing a socket still open is what ends the
       *  command on the server, tree and all. */
      function finish() {
        if (done) return;
        done = true;
        if (socket.state() !== "closed") socket.close();
        if (fitTimer !== null) clearTimeout(fitTimer);
        watcher?.disconnect();
        term.dispose();
        root.remove();
        current = null;
        if (before && typeof before.focus === "function") before.focus();
        resolve({ exitCode: exit !== null ? exit.code : null });
      }
    });
  }

  return {
    open,
    /** The theme changed: the open emulator, if any, repaints in it. */
    retheme() {
      current?.retheme();
    },
  };
}

/** @typedef {ReturnType<typeof makeSignInTerminal>} SignInTerminal */

/** @typedef {"pass" | "host" | "copy" | "selectAll" | "clear" | { send: string }} KeyAct */

/** WHAT A KEY DOES IN THE TERMINAL, AS THE PLATFORM'S OWN TERMINAL DOES IT.
 *  A person who lives in Terminal.app, iTerm2, GNOME Terminal or Windows
 *  Terminal has hands that already know these, and an emulator that answers
 *  them with silence — or with an escape sequence the shell ignores — reads as
 *  a broken terminal. Each rewrite sends the bytes a line editor (readline, zle,
 *  and the agent CLIs' own prompts) already understands; nothing is bound in the
 *  shell. Pure, so the table can be read and tested without an emulator.
 *
 *  - `pass` leaves the key to the emulator, and through it to the browser —
 *    which is how paste arrives, with bracketed paste intact.
 *  - `host` keeps the key out of the shell and lets the page have it.
 *  - `{ send }` types those bytes into the session in the key's place.
 *
 *  @param {Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">} e
 *  @param {boolean} mac
 *  @returns {KeyAct} */
export function terminalKey(e, mac) {
  const { key, code, ctrlKey: ctrl, metaKey: meta, altKey: alt, shiftKey: shift } = e;
  // ZOOM IS THE WINDOW'S, NOT THE SHELL'S. Ctrl/Cmd with `+`, `-` or `0` would
  // otherwise reach the program as an ordinary keystroke.
  if ((ctrl || meta) && !alt && ["=", "+", "-", "_", "0"].includes(key)) return "host";
  // SHIFT+ENTER IS A NEW LINE, NOT A SUBMIT. The agent CLIs read ESC+Return as
  // "newline in the prompt" — it is what their own terminal setup binds Shift+
  // Enter to — and a bare Return here sent a half-written prompt.
  if (shift && !ctrl && !meta && !alt && key === "Enter") return { send: "\x1b\r" };
  if (mac) {
    // Terminal.app and iTerm2: Cmd is the application's, Option is the word.
    if (meta && !ctrl && !alt) {
      if (key === "ArrowLeft") return { send: "\x01" }; // start of line
      if (key === "ArrowRight") return { send: "\x05" }; // end of line
      if (key === "Backspace") return { send: "\x15" }; // delete to start of line
      if (key === "k" && !shift) return "clear"; // clear the scrollback
      if (key === "a" && !shift) return "selectAll";
      return "pass"; // ⌘C and ⌘V: the Edit menu's, and the emulator answers them
    }
    if (alt && !ctrl && !meta && !shift) {
      if (key === "ArrowLeft") return { send: "\x1bb" }; // back a word
      if (key === "ArrowRight") return { send: "\x1bf" }; // forward a word
      if (key === "Backspace") return { send: "\x1b\x7f" }; // delete the word behind
    }
    return "pass";
  }
  // LINUX AND WINDOWS: Ctrl+C must stay SIGINT, so the clipboard is on
  // Ctrl+Shift, as in GNOME Terminal and Windows Terminal. Paste is handed back
  // to the browser, whose paste event the emulator reads.
  if (ctrl && shift && !alt && !meta) {
    if (code === "KeyC") return "copy";
    if (code === "KeyV") return "host";
    if (code === "KeyA") return "selectAll";
  }
  // Ctrl+Backspace deletes the word behind, as Windows Terminal and VS Code send it.
  if (ctrl && !shift && !alt && !meta && key === "Backspace") return { send: "\x17" };
  return "pass";
}
