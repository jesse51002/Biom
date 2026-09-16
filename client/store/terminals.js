// SPDX-License-Identifier: AGPL-3.0-only
// The terminal sessions this window knows about, and where the dock is. Layer 9,
// beside the workspace store and the UI store, and neither of them.
//
// Two kinds of state live here and they have OPPOSITE owners, which is the whole
// of the design:
//
//   · SESSIONS are the server's. Their ids, labels, lifecycle and exit status
//     arrive over the socket and are only ever mirrored; a close button here
//     does not report a close — the server's `state` event does.
//   · THE DOCK is this window's: which edge, how big, shown or hidden, full
//     screen or not. None of it is ever sent. That is what makes "hiding a
//     terminal stops nothing" a property of the code rather than a promise:
//     there is no message a dock change could send.
//
// What the SCREEN adds on top — Starting, Connected, Disconnected — is derived
// from the socket, never guessed from output. New output while a tab is not in
// front sets `unread`; a bell sets `bell`. Neither says an agent is working,
// waiting or done, and nothing here pretends to know.
//
// It does no I/O and touches no DOM. `boot.js` reads the remembered dock and
// writes it back; the view feeds it output notices.

/** @import { TerminalLink, LinkState } from "../transport/terminal.js" */

import { emitter } from "../../contracts/emitter.js";

/** @typedef {"left" | "right" | "top" | "bottom"} Side */
/** @typedef {{ visible: boolean, side: Side, sizes: Record<Side, number>, full: boolean, font: number }} Dock */
/**
 * @typedef {object} SessionView
 * @property {string} id
 * @property {string} label
 * @property {string} title what the running program last called itself. Display text, never trusted.
 * @property {"running" | "ending" | "exited" | "failed"} state
 * @property {{ code: number | null, signal: string | null } | null} exit
 * @property {string} cwd
 * @property {string} shell
 * @property {boolean} truncated
 * @property {string | null} message
 * @property {boolean} unread
 * @property {boolean} bell
 */
/**
 * @typedef {object} TerminalState
 * @property {LinkState} link
 * @property {SessionView[]} sessions
 * @property {{ nonce: string, cols: number, rows: number }[]} pending creates sent and not yet answered
 * @property {{ nonce: string, message: string }[]} failures spawn failures, shown until dismissed
 * @property {string | null} active
 * @property {Dock} dock
 * @property {string | null} confirming the session an End is waiting to be confirmed for
 * @property {string | null} notice the last thing the server refused, in its words
 */

export const SIDES = /** @type {const} */ (["left", "right", "top", "bottom"]);

/** HOW BIG THE TERMINAL'S TEXT IS, in px, and the ends of what it may be.
 *
 *  It is the DOCK'S rather than a session's: one workspace on one screen is one
 *  reading distance, so sizing one tab and not its neighbour would be a setting
 *  nobody wants twice. A laptop beside a 27-inch monitor is the whole reason it
 *  is adjustable at all — the same 13px is comfortable on one and unreadable on
 *  the other — so it rides in the dock state this window remembers. */
export const FONT_DEFAULT = 13;
export const FONT_MIN = 8;
export const FONT_MAX = 28;

/** Where a dock starts: the bottom, a third of a typical window. */
export const DOCK_DEFAULT = /** @type {Dock} */ ({
  visible: false,
  side: "bottom",
  sizes: { left: 480, right: 480, top: 300, bottom: 300 },
  full: false,
  font: FONT_DEFAULT,
});

/** The smallest a dock may be dragged, in px. Below this a prompt does not fit. */
export const DOCK_MIN = 140;

/**
 * A size kept within the room there is: never below the minimum, never so big
 * the workspace beside it has less than the minimum.
 * @param {number} px @param {number} room the workspace's extent on that axis, 0 when unknown
 */
export function clampSize(px, room) {
  const n = Number.isFinite(px) ? Math.round(px) : DOCK_MIN;
  const ceiling = room > 0 ? Math.max(DOCK_MIN, room - DOCK_MIN) : 4000;
  return Math.min(Math.max(n, DOCK_MIN), ceiling);
}

/** A text size kept between the two ends, rounded to a whole pixel.
 *  @param {number} px */
export const clampFont = (px) =>
  Math.min(Math.max(Number.isFinite(px) ? Math.round(px) : FONT_DEFAULT, FONT_MIN), FONT_MAX);

/**
 * A remembered dock, read back defensively: anything malformed is the default.
 * @param {unknown} raw
 * @returns {Dock}
 */
export function dockFrom(raw) {
  const d = /** @type {any} */ (raw);
  if (!d || typeof d !== "object") return { ...DOCK_DEFAULT, sizes: { ...DOCK_DEFAULT.sizes } };
  const side = SIDES.includes(d.side) ? d.side : DOCK_DEFAULT.side;
  /** @type {Record<Side, number>} */
  const sizes = { ...DOCK_DEFAULT.sizes };
  if (d.sizes && typeof d.sizes === "object") {
    for (const s of SIDES) if (Number.isFinite(d.sizes[s])) sizes[s] = clampSize(d.sizes[s], 0);
  }
  return {
    visible: d.visible === true,
    side,
    sizes,
    full: d.full === true,
    font: Number.isFinite(d.font) ? clampFont(d.font) : FONT_DEFAULT,
  };
}

/**
 * THE DOCK'S TRANSITIONS, pure. Every one of them leaves `side` and `sizes`
 * alone unless it is about them, which is what lets full screen and hiding
 * return to exactly where the dock was.
 * @param {Dock} dock
 * @param {{ type: "open" } | { type: "hide" } | { type: "full" } | { type: "restore" }
 *   | { type: "side", side: Side } | { type: "size", px: number, room: number }
 *   | { type: "font", px: number }} act
 * @returns {Dock}
 */
export function dockAfter(dock, act) {
  switch (act.type) {
    case "open":
      return dock.visible ? dock : { ...dock, visible: true };
    case "hide":
      // Hiding from full screen returns to the WORKSPACE, and reopening returns
      // to the remembered edge — so full screen is dropped here and the side and
      // size are not touched.
      return !dock.visible && !dock.full ? dock : { ...dock, visible: false, full: false };
    case "full":
      return dock.full && dock.visible ? dock : { ...dock, visible: true, full: true };
    case "restore":
      return dock.full ? { ...dock, full: false } : dock;
    case "side":
      if (!SIDES.includes(act.side)) return dock;
      return dock.side === act.side && !dock.full ? dock : { ...dock, side: act.side, full: false, visible: true };
    case "size": {
      const px = clampSize(act.px, act.room);
      return dock.sizes[dock.side] === px ? dock : { ...dock, sizes: { ...dock.sizes, [dock.side]: px } };
    }
    case "font": {
      const px = clampFont(act.px);
      return dock.font === px ? dock : { ...dock, font: px };
    }
    default:
      return dock;
  }
}

/**
 * The server's list, with what only this window knows carried across for every
 * id it already had.
 * @param {SessionView[]} had
 * @param {any[]} incoming
 * @returns {SessionView[]}
 */
export function reconcile(had, incoming) {
  const by = new Map(had.map((s) => [s.id, s]));
  return incoming.filter((s) => s && typeof s.id === "string").map((s) => viewOf(s, by.get(s.id)));
}

/** @param {any} info @param {SessionView} [was] @returns {SessionView} */
function viewOf(info, was) {
  return {
    id: String(info.id),
    label: typeof info.label === "string" ? info.label : was?.label ?? "Terminal",
    title: was?.title ?? "",
    state: ["running", "ending", "exited", "failed"].includes(info.state) ? info.state : "failed",
    exit: info.exit ?? null,
    cwd: typeof info.cwd === "string" ? info.cwd : "",
    shell: typeof info.shell === "string" ? info.shell : "",
    truncated: info.truncated === true,
    message: typeof info.message === "string" ? info.message : null,
    unread: was?.unread ?? false,
    bell: was?.bell ?? false,
  };
}

/** @returns {string} */
const nonce = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

/**
 * @param {{ link: TerminalLink, dock?: Dock }} deps
 */
export function makeTerminals(deps) {
  const { link } = deps;
  const bus = emitter();

  /** @type {TerminalState} */
  let state = {
    link: link.state(),
    sessions: [],
    pending: [],
    failures: [],
    active: null,
    dock: deps.dock ?? { ...DOCK_DEFAULT, sizes: { ...DOCK_DEFAULT.sizes } },
    confirming: null,
    notice: null,
  };
  /** Open a shell as soon as the socket has said what exists, if nothing does. */
  let autostart = false;
  /** The size a shell opened without a fitted pane is started at. */
  let lastSize = { cols: 80, rows: 24 };

  /** @param {Partial<TerminalState>} patch */
  function set(patch) {
    const keys = /** @type {(keyof TerminalState)[]} */ (Object.keys(patch));
    if (keys.every((k) => Object.is(state[k], patch[k]))) return;
    state = { ...state, ...patch };
    bus.emit(undefined);
  }

  /** @param {string} id @param {(s: SessionView) => SessionView} fn */
  function patchSession(id, fn) {
    let changed = false;
    const sessions = state.sessions.map((s) => {
      if (s.id !== id) return s;
      const next = fn(s);
      if (next !== s) changed = true;
      return next;
    });
    if (changed) set({ sessions });
  }

  /** @param {Dock} dock */
  const setDock = (dock) => {
    if (dock !== state.dock) set({ dock });
  };

  const live = () => state.sessions.filter((s) => s.state === "running" || s.state === "ending").length;

  function create() {
    if (state.link !== "open") {
      autostart = true;
      link.connect();
      return false;
    }
    const n = nonce();
    const ask = { nonce: n, cols: lastSize.cols, rows: lastSize.rows };
    if (!link.send({ op: "create", ...ask })) return false;
    set({ pending: [...state.pending, ask] });
    return true;
  }

  link.on((m) => {
    if (m.kind === "bytes") return;
    if (m.kind === "link") {
      set({ link: m.state });
      if (m.state === "open") {
        // A CREATE WHOSE ANSWER WAS LOST GOES AGAIN, WITH THE SAME NONCE. The
        // server answers a nonce it has seen with the session it already made,
        // so a dropped socket cannot launch a second agent.
        for (const p of state.pending) link.send({ op: "create", ...p });
      }
      return;
    }
    const e = m.event;
    switch (e.ev) {
      case "sessions": {
        const sessions = reconcile(state.sessions, Array.isArray(e.sessions) ? e.sessions : []);
        const active = sessions.some((s) => s.id === state.active) ? state.active : sessions.at(-1)?.id ?? null;
        set({ sessions, active });
        if (autostart) {
          autostart = false;
          if (sessions.length === 0 && state.pending.length === 0 && state.dock.visible) create();
        }
        return;
      }
      case "created": {
        const mine = state.pending.some((p) => p.nonce === e.nonce);
        const pending = state.pending.filter((p) => p.nonce !== e.nonce);
        const known = state.sessions.some((s) => s.id === e.session?.id);
        const sessions = known || !e.session ? state.sessions : [...state.sessions, viewOf(e.session)];
        set({ pending, sessions, active: mine && e.session ? String(e.session.id) : state.active ?? sessions.at(-1)?.id ?? null });
        return;
      }
      case "failed": {
        if (!state.pending.some((p) => p.nonce === e.nonce)) return;
        set({
          pending: state.pending.filter((p) => p.nonce !== e.nonce),
          failures: [...state.failures, { nonce: String(e.nonce), message: String(e.message ?? "the terminal could not be started") }],
        });
        return;
      }
      case "state":
        if (e.session && typeof e.session.id === "string") {
          const known = state.sessions.some((s) => s.id === e.session.id);
          if (known) patchSession(e.session.id, (s) => viewOf(e.session, s));
          else set({ sessions: [...state.sessions, viewOf(e.session)] });
        }
        return;
      case "removed": {
        const at = state.sessions.findIndex((s) => s.id === e.id);
        if (at < 0) return;
        const sessions = state.sessions.filter((s) => s.id !== e.id);
        const active = state.active === e.id ? (sessions[at] ?? sessions[at - 1])?.id ?? null : state.active;
        set({ sessions, active, confirming: state.confirming === e.id ? null : state.confirming });
        return;
      }
      case "resync":
        patchSession(String(e.id), (s) => (s.truncated === (e.truncated === true) ? s : { ...s, truncated: e.truncated === true }));
        return;
      case "error":
        set({ notice: String(e.message ?? "the terminal refused that") });
        return;
    }
  });

  return {
    get: () => state,
    on: (/** @type {() => void} */ fn) => bus.on(fn),
    /** Live sessions: running, or being ended. */
    live,

    /** Show the dock. Connects the first time; opens a shell only when the
     *  workspace has none — otherwise the last active one is simply in front. */
    open() {
      setDock(dockAfter(state.dock, { type: "open" }));
      if (state.link === "idle" || state.link === "closed") {
        autostart = true;
        link.connect();
        return;
      }
      if (state.link === "open" && state.sessions.length === 0 && state.pending.length === 0) create();
    },
    hide: () => setDock(dockAfter(state.dock, { type: "hide" })),
    toggle() {
      if (state.dock.visible) this.hide();
      else this.open();
    },
    /** Connect without showing anything — a reload that had a dock open. */
    connect: () => link.connect(),
    create,
    /** @param {number} cols @param {number} rows */
    sizeHint(cols, rows) {
      if (cols >= 2 && rows >= 2) lastSize = { cols, rows };
    },
    /** @param {string} id */
    select(id) {
      if (!state.sessions.some((s) => s.id === id)) return;
      set({ active: id });
      patchSession(id, (s) => (s.unread || s.bell ? { ...s, unread: false, bell: false } : s));
    },
    /** @param {string} id */
    askEnd(id) {
      const s = state.sessions.find((x) => x.id === id);
      if (!s) return;
      // Nothing to confirm about a process that is already gone.
      if (s.state === "exited") {
        link.send({ op: "dismiss", id });
        return;
      }
      set({ confirming: id });
    },
    cancelEnd: () => set({ confirming: null }),
    confirmEnd() {
      const id = state.confirming;
      if (id === null) return;
      set({ confirming: null });
      link.send({ op: "end", id });
    },
    /** @param {string} id */
    dismiss: (id) => link.send({ op: "dismiss", id }),
    /** @param {string} nonceOf */
    forgetFailure: (nonceOf) => set({ failures: state.failures.filter((f) => f.nonce !== nonceOf) }),
    /** @param {string} id @param {string} label */
    rename: (id, label) => link.send({ op: "label", id, label }),
    /** @param {Side} side */
    dockTo: (side) => setDock(dockAfter(state.dock, { type: "side", side })),
    /** @param {number} px @param {number} room */
    resize: (px, room) => setDock(dockAfter(state.dock, { type: "size", px, room })),
    /** ZOOM IS THE DOCK'S, AND IT IS SENT NOWHERE. The shell is not told: a
     *  terminal's size in ROWS AND COLUMNS follows from the font through the
     *  fit, and that resize is the only thing the process ever hears about it.
     *  @param {number} step whole steps, positive for larger */
    zoom: (step) => setDock(dockAfter(state.dock, { type: "font", px: state.dock.font + Math.round(step) })),
    resetZoom: () => setDock(dockAfter(state.dock, { type: "font", px: FONT_DEFAULT })),
    fullscreen: () => setDock(dockAfter(state.dock, { type: "full" })),
    restore: () => setDock(dockAfter(state.dock, { type: "restore" })),
    clearNotice: () => set({ notice: null }),

    /** Output reached a session. Replayed output is history, not news.
     *  @param {string} id @param {boolean} replay */
    output(id, replay) {
      if (replay) return;
      if (state.dock.visible && state.active === id) return;
      patchSession(id, (s) => (s.unread ? s : { ...s, unread: true }));
    },
    /** @param {string} id */
    bell(id) {
      if (state.dock.visible && state.active === id) return;
      patchSession(id, (s) => (s.bell ? s : { ...s, bell: true }));
    },
    /** @param {string} id @param {string} title */
    title(id, title) {
      // Control characters out, by code rather than by a regex range: the range
      // would have to spell character zero, and a literal one in source is what
      // `make check` refuses.
      const clean = Array.from(String(title)).filter((ch) => {
        const c = ch.charCodeAt(0);
        return c >= 32 && c !== 127;
      }).join("").slice(0, 120);
      patchSession(id, (s) => (s.title === clean ? s : { ...s, title: clean }));
    },

    /** END EVERY LIVE SESSION and resolve once none is left running, or after
     *  `ms` — answering how many were still live then, so a caller that is
     *  about to leave can say so rather than claim they all stopped.
     *  @param {number} [ms] */
    endAll(ms = 8000) {
      for (const s of state.sessions) if (s.state === "running" || s.state === "failed") link.send({ op: "end", id: s.id });
      return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
          const left = live() + state.sessions.filter((s) => s.state === "failed").length;
          if (left === 0 || Date.now() - started > ms) {
            off();
            clearInterval(tick);
            resolve(left);
          }
        };
        const off = bus.on(check);
        const tick = setInterval(check, 250);
        check();
      });
    },
  };
}

/** @typedef {ReturnType<typeof makeTerminals>} TerminalStore */
