// SPDX-License-Identifier: AGPL-3.0-only
// The terminal emulators. Layer 14.
//
// One xterm.js instance per session, each in a pane of its own, all of them in
// ONE stage that the dock places and never rebuilds. The emulator is handed to
// this module by `boot.js` rather than imported, so the module itself has no
// third-party dependency and a test can build it with a fake.
//
// WHAT THIS OWNS: a pane per session for as long as that session exists — its
// scrollback, its selection, its cursor — output written in order, input sent
// only while the session is running and the socket is open, and the size the
// shell is told. Switching tabs HIDES a pane; it never disposes one. Moving the
// dock, hiding it and going full screen change the stage's box, and the
// emulator is fitted again once that box settles.
//
// TERMINAL OUTPUT NEVER BECOMES MARKUP. It goes into the emulator and nowhere
// else: no link is opened on its say-so, a title it sets is display text, a
// bell is an attention flag, and nothing it prints can reach the page, the
// workspace store or the file watcher. The watcher is still how an agent's write
// reaches the page — never a line of output.
//
// REPLAYED OUTPUT IS HISTORY. A reconnect resets the pane and writes the
// server's ring into it; bells and titles fired while that replays are the past
// and are not announced again.

/** @import { TerminalLink } from "../transport/terminal.js" */
/** @import { TerminalStore } from "../store/terminals.js" */

/**
 * @typedef {object} Pane
 * @property {string} id
 * @property {HTMLElement} el
 * @property {HTMLElement} host
 * @property {any} term
 * @property {any} fit
 * @property {boolean} opened
 * @property {boolean} replaying
 * @property {boolean} stdin
 * @property {{ cols: number, rows: number } | null} sent the size the shell was last told
 * @property {number} font the text size this emulator is drawing at
 */

/**
 * @param {object} deps
 * @param {(spec: string, props?: any, ...kids: any[]) => HTMLElement} deps.h
 * @param {TerminalLink} deps.link
 * @param {TerminalStore} deps.terms
 * @param {new (options?: any) => any} deps.Terminal the emulator, from `@xterm/xterm`
 * @param {new () => any} deps.FitAddon from `@xterm/addon-fit`
 * @param {boolean} [deps.mac] whether copy and paste are Cmd rather than Ctrl+Shift
 */
export function makeTerminalView(deps) {
  const { h, link, terms, Terminal, FitAddon } = deps;
  const mac = deps.mac === true;
  const stage = h("div.termstage");
  /** @type {Map<string, Pane>} */
  const panes = new Map();
  /** Output that arrived before its pane — bounded, and only ever a moment.
   *  @type {Map<string, { replay: boolean, data: Uint8Array }[]>} */
  const early = new Map();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let fitTimer = null;
  /** @type {string | null} */
  let focusAfterFit = null;

  /** THE PALETTE, READ OFF THE ROOT. The emulator paints a canvas and cannot
   *  read a custom property, so the tokens are resolved here and handed over as
   *  values — and again on every theme change. The sixteen ANSI colours stay the
   *  emulator's own: those are what a program asked for, not chrome. */
  function palette() {
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

  /** COPY AND PASTE WITHOUT STEALING THE INTERRUPT. On macOS they are Cmd and
   *  the emulator leaves Cmd alone. Elsewhere Ctrl+C must stay SIGINT, so copy
   *  is Ctrl+Shift+C and paste is Ctrl+Shift+V — the second handed back to the
   *  browser, whose paste event the emulator reads with bracketed paste intact.
   *  Ctrl+` belongs to the dock's toggle and never reaches the shell.
   *  @param {KeyboardEvent} e @param {any} term */
  function keys(e, term) {
    if (e.type !== "keydown") return true;
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "Backquote") return false;
    // ZOOM IS THE WINDOW'S, NOT THE SHELL'S. Ctrl/Cmd with `+`, `-` or `0` would
    // otherwise reach the program as an ordinary keystroke, and a shell that
    // received `0` while somebody was trying to read it is the wrong answer.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ["=", "+", "-", "_", "0"].includes(e.key)) return false;
    if (!mac && e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyC") {
      if (term.hasSelection() && navigator.clipboard) void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      e.preventDefault();
      return false;
    }
    if (!mac && e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyV") return false;
    return true;
  }

  /** @param {string} id @returns {Pane} */
  function paneFor(id) {
    const host = h("div.termhost");
    const latest = h("button.termlatest", { type: "button", hidden: true }, "Jump to latest output");
    const el = h("div.termpane", { "data-session": id, hidden: true }, host, latest);
    const look = palette();
    const term = new Terminal({
      cursorBlink: true,
      disableStdin: true,
      fontFamily: look.fontFamily,
      fontSize: terms.get().dock.font,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: look.theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    /** @type {Pane} */
    const pane = { id, el, host, term, fit, opened: false, replaying: false, stdin: false, sent: null, font: terms.get().dock.font };

    // SCROLLED UP STAYS SCROLLED UP. The emulator keeps the reading position
    // while output arrives below it; getting back to the bottom is a button,
    // shown only while there is somewhere below to go.
    const where = () => {
      const b = term.buffer.active;
      latest.hidden = b.viewportY >= b.baseY;
    };
    term.onScroll(where);
    term.onWriteParsed(where);
    latest.addEventListener("click", () => {
      term.scrollToBottom();
      where();
      term.focus();
    });

    term.onData((/** @type {string} */ data) => {
      const now = terms.get();
      const s = now.sessions.find((x) => x.id === id);
      if (!s || s.state !== "running" || now.link !== "open") return;
      link.send({ op: "input", id, data });
    });
    term.onBell(() => {
      if (!pane.replaying) terms.bell(id);
    });
    term.onTitleChange((/** @type {string} */ title) => {
      if (!pane.replaying) terms.title(id, title);
    });
    term.attachCustomKeyEventHandler((/** @type {KeyboardEvent} */ e) => keys(e, term));

    stage.append(el);
    return pane;
  }

  /** @param {Pane} pane @param {boolean} replay @param {Uint8Array} data */
  function deliver(pane, replay, data) {
    if (!replay) {
      pane.term.write(data);
      return;
    }
    pane.term.reset();
    pane.replaying = true;
    pane.term.write(data, () => {
      pane.replaying = false;
    });
  }

  link.on((m) => {
    if (m.kind === "link") {
      // A new socket is a shell that has not been told this window's size.
      if (m.state === "open") for (const p of panes.values()) p.sent = null;
      sync();
      return;
    }
    if (m.kind !== "bytes") return;
    const pane = panes.get(m.id);
    if (!pane) {
      const held = early.get(m.id) ?? [];
      if (held.length < 256) held.push({ replay: m.replay, data: m.data });
      early.set(m.id, held);
      return;
    }
    deliver(pane, m.replay, m.data);
    terms.output(m.id, m.replay);
  });

  /** Fit the pane in front, once its box has settled, and tell its shell. */
  function schedule() {
    if (fitTimer !== null) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      fitTimer = null;
      fitNow();
    }, 40);
  }

  function fitNow() {
    const st = terms.get();
    const pane = st.active ? panes.get(st.active) : undefined;
    // A HIDDEN PANE KEEPS ITS LAST SIZE. A box of nothing would propose a
    // terminal of nothing, and a shell told it has zero columns redraws into it.
    if (!pane || pane.el.hidden || !stage.isConnected || stage.clientWidth < 24 || stage.clientHeight < 24) return;
    if (!pane.opened) {
      pane.term.open(pane.host);
      pane.opened = true;
    }
    const dims = pane.fit.proposeDimensions();
    if (dims && dims.cols >= 2 && dims.rows >= 2) {
      if (dims.cols !== pane.term.cols || dims.rows !== pane.term.rows) pane.term.resize(dims.cols, dims.rows);
      terms.sizeHint(dims.cols, dims.rows);
      const s = st.sessions.find((x) => x.id === pane.id);
      const told = pane.sent;
      if (s && s.state === "running" && st.link === "open" && (!told || told.cols !== dims.cols || told.rows !== dims.rows)) {
        if (link.send({ op: "resize", id: pane.id, cols: dims.cols, rows: dims.rows })) pane.sent = { cols: dims.cols, rows: dims.rows };
      }
    }
    if (focusAfterFit === pane.id) {
      focusAfterFit = null;
      pane.term.focus();
    }
  }

  // CTRL/CMD AND THE WHEEL, which is what every terminal and every browser has
  // trained people to reach for. `passive: false` because the page must not
  // scroll or zoom underneath it.
  stage.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    terms.zoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  if (typeof ResizeObserver === "function") new ResizeObserver(() => schedule()).observe(stage);
  if (typeof document !== "undefined" && document.fonts) void document.fonts.ready.then(() => schedule());

  /** Bring the panes in line with the store: one per session, the active one in
   *  front while the dock is shown, stdin open only where typing can arrive. */
  function sync() {
    const st = terms.get();
    const ids = new Set(st.sessions.map((s) => s.id));
    for (const [id, pane] of panes) {
      if (ids.has(id)) continue;
      pane.term.dispose();
      pane.el.remove();
      panes.delete(id);
    }
    for (const s of st.sessions) {
      let pane = panes.get(s.id);
      if (!pane) {
        pane = paneFor(s.id);
        panes.set(s.id, pane);
        const held = early.get(s.id);
        if (held) {
          early.delete(s.id);
          for (const m of held) deliver(pane, m.replay, m.data);
        }
      }
      // THE TEXT SIZE IS THE DOCK'S, so every pane wears it — including the ones
      // behind, which would otherwise redraw at the old size the moment they
      // came forward.
      if (pane.font !== st.dock.font) {
        pane.font = st.dock.font;
        pane.term.options.fontSize = st.dock.font;
      }
      const front = s.id === st.active && st.dock.visible;
      if (pane.el.hidden === front) pane.el.hidden = !front;
      const stdin = s.state === "running" && st.link === "open";
      if (pane.stdin !== stdin) {
        pane.stdin = stdin;
        pane.term.options.disableStdin = !stdin;
      }
    }
    for (const id of early.keys()) if (!ids.has(id) && early.size > 32) early.delete(id);
    schedule();
  }

  return {
    el: stage,
    sync,
    schedule,
    /** Put the caret in the pane in front, once it has been fitted. */
    focus() {
      const id = terms.get().active;
      if (id === null) return;
      focusAfterFit = id;
      schedule();
    },
    retheme() {
      const look = palette();
      for (const p of panes.values()) {
        p.term.options.theme = look.theme;
        p.term.options.fontFamily = look.fontFamily;
      }
      schedule();
    },
    /** A starting size for a shell not yet started: the pane in front's, or a
     *  guess off the stage's box that the first fit corrects. */
    hint() {
      const st = terms.get();
      const pane = st.active ? panes.get(st.active) : undefined;
      if (pane && pane.opened) return { cols: pane.term.cols, rows: pane.term.rows };
      if (!stage.isConnected || stage.clientWidth < 24) return null;
      return { cols: Math.max(20, Math.floor((stage.clientWidth - 16) / 7.8)), rows: Math.max(5, Math.floor((stage.clientHeight - 8) / 17)) };
    },
  };
}

/** @typedef {ReturnType<typeof makeTerminalView>} TerminalView */
