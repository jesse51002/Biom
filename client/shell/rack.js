// SPDX-License-Identifier: AGPL-3.0-only
// How wide the rack is. Layer 15, and a neighbour of shell.js rather than a
// layer of its own: it is one property of one element and nothing else imports
// it.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SPLIT THIS FILE IS BUILT AROUND
// ─────────────────────────────────────────────────────────────────────────────
//
// `rackWidth` takes three numbers and answers one. It holds every decision —
// the minimum, the ceiling, that a dragged width wins, and what to do before
// anything has been measured — and it touches no DOM at all.
//
// Everything below it is measurement and plumbing: a clone that gets laid out,
// a pointer that moves, a number in localStorage. **None of that can be tested
// here.** The test runner has no DOM, and the browser used for checking has no
// fonts, so every rendered glyph in it is zero-width. So the arithmetic is
// where the behaviour lives, deliberately, because the arithmetic is the only
// half that can be held honest.
//
// TWO RULES THAT WOULD OTHERWISE FIGHT.
//
// A DRAGGED WIDTH WINS AND STOPS THE MEASURING. A panel that springs back after
// you resize it is worse than one that never resized, so a drag is not a
// starting point the self-sizing then argues with — it ends the self-sizing.
// `measure()` returns before it looks at anything once `dragged` is set.
//
// AUTOMATIC GROWTH HAS A CEILING AND DRAGGING HAS NONE. If somebody wants the
// rail huge that is their business. But a rail that grows itself to 400 points
// because one page has a 200-character name is the rail deciding something the
// user did not, so the measured width — and only the measured width — is capped
// against the window.
//
// WHERE THE NUMBER IS KEPT. localStorage in the host realm, under one key. It
// is about the workspace UI rather than about the contents of any vault, so it
// must survive switching vaults; a per-vault home would reset it every time.

/** @typedef {{ getItem(k: string): string | null, setItem(k: string, v: string): void,
 *              removeItem(k: string): void }} Store */

/* ── pure, and therefore testable ─────────────────────────────────────── */

/** Below this the rail stops being a rail: the tree indents, the tags sit at the
 *  right edge, and the workspace links at the foot need a line each. */
export const RACK_MIN = 176;

/** What it is before anything has been measured — `--rack-w: 16.375rem` in
 *  tokens.css, which is this many pixels at the 16px root that file sets. The
 *  two are stated in both places on purpose: CSS is what paints the first frame,
 *  before any of this has run. */
export const RACK_BASE = 262;

/** The most of the window the rail may take WHEN IT SIZED ITSELF. Dragging is
 *  not bound by this and never should be. */
export const RACK_SHARE = 0.34;

/** Breathing room past the widest row, so the longest name is not flush against
 *  the border. */
export const RACK_SLACK = 2;

/** How far one arrow key moves it. */
export const RACK_STEP = 16;

/** Where the dragged width is kept. One key, no vault in it. */
export const RACK_KEY = "biom.rack.width";

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** @param {unknown} n @returns {n is number} */
const given = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * The widest the rail may make ITSELF, given the window it is in. Never below
 * the minimum, or a narrow window would produce a ceiling under the floor and
 * the clamp would invert. A window of zero means nobody has told us — before
 * `mount`, or in a test runner with no window at all — and then the base width
 * is as far as growth may go, because a cap cannot be worked out from nothing.
 * @param {number} room the window's inner width in px, or 0 when unknown
 * @returns {number}
 */
export function autoCeiling(room) {
  const share = given(room) && room > 0 ? Math.round(room * RACK_SHARE) : RACK_BASE;
  return Math.max(RACK_MIN, share);
}

/**
 * The whole decision, as arithmetic.
 *
 * @param {number | null} dragged  what the user dragged it to, or null if they never have
 * @param {number | null} measured what the widest rendered row actually needs, or null before anything was measured
 * @param {number} room            the window's inner width in px, or 0 when unknown
 * @returns {number} px
 */
export function rackWidth(dragged, measured, room) {
  // Their width wins, and the only thing that touches it is the floor: a rail
  // dragged shut is a rail nobody can find again. There is deliberately no
  // ceiling on this branch.
  if (given(dragged)) return Math.max(RACK_MIN, Math.round(dragged));

  const ceiling = autoCeiling(room);
  if (given(measured) && measured > 0) return clamp(Math.round(measured), RACK_MIN, ceiling);
  // Nothing measured yet. The base, but still inside the ceiling — on a narrow
  // window the default is itself an automatic width nobody chose.
  return clamp(RACK_BASE, RACK_MIN, ceiling);
}

/* ── the half that has to touch the DOM ───────────────────────────────── */

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/**
 * @typedef {object} RackDeps
 * @property {H} h
 * @property {Store | null} [store] where the dragged width is kept
 * @property {any} [win] the window, for the ceiling and for the drag
 * @property {any} [doc] the document, for `fonts.ready`
 */

/** @returns {Store | null} */
function hostStore() {
  try {
    const s = /** @type {any} */ (globalThis).localStorage;
    return s && typeof s.getItem === "function" ? s : null;
  } catch {
    // A browser with storage refused. The rail still resizes; it just forgets.
    return null;
  }
}

/** @param {Store | null} store @returns {number | null} */
function stored(store) {
  if (!store) return null;
  try {
    const raw = store.getItem(RACK_KEY);
    const n = raw === null || raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.max(RACK_MIN, Math.round(n)) : null;
  } catch {
    return null;
  }
}

/**
 * The grip, the measuring and the number.
 * @param {RackDeps} deps
 */
export function makeRack(deps) {
  const { h } = deps;
  const store = deps.store === undefined ? hostStore() : deps.store;
  const win = deps.win === undefined
    ? (typeof window === "undefined" ? null : window) : deps.win;
  const doc = deps.doc === undefined
    ? (typeof document === "undefined" ? null : document) : deps.doc;

  /** What the user dragged to, and the reason `measure` gives up. @type {number | null} */
  let dragged = stored(store);
  /** What the widest rendered row needs. @type {number | null} */
  let measured = null;
  /** The rack's text as it was when `measured` was taken. Laying out a clone is
   *  the one expensive thing here and the rack is refilled on every repaint, so
   *  it is done again only when the rows actually say something different.
   *  `null` forces the next `sync` to measure. @type {string | null} */
  let seen = null;

  /** @type {any} */ let app = null;
  /** @type {any} */ let bed = null;
  /** @type {any} */ let rack = null;
  /** @type {{ from: number, base: number } | null} */ let drag = null;

  const grip = h("div.rackgrip", {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Rail width",
    "aria-valuemin": String(RACK_MIN),
    tabindex: "0",
    onpointerdown: (/** @type {any} */ ev) => start(ev),
    ondblclick: () => reset(),
    onkeydown: (/** @type {any} */ ev) => key(ev),
  });

  const room = () => (win && given(win.innerWidth) ? win.innerWidth : 0);

  /** The answer, right now. */
  const width = () => rackWidth(dragged, measured, room());

  /** Write it where the stylesheet reads it. `.bed` is a grid whose first column
   *  IS this property, so one custom property on `.app` moves the rail, the
   *  canvas and the grip together and nothing is repainted. */
  function apply() {
    const px = width();
    const style = app && app.style;
    if (style && typeof style.setProperty === "function") {
      style.setProperty("--rack-w", px + "px");
    }
    if (grip.setAttribute) grip.setAttribute("aria-valuenow", String(px));
  }

  /** @param {number} px */
  function setDragged(px) {
    dragged = Math.max(RACK_MIN, Math.round(px));
    apply();
  }

  function remember() {
    if (!store || dragged === null) return;
    try { store.setItem(RACK_KEY, String(dragged)); } catch { /* it forgets, and resizes anyway */ }
  }

  /** Back to sizing itself. The escape hatch from a width you dragged and
   *  regret — a double-click on the grip, or Home while it has focus. */
  function reset() {
    dragged = null;
    seen = null;
    if (store) { try { store.removeItem(RACK_KEY); } catch { /* nothing to undo */ } }
    measure();
    apply();
  }

  /** @param {any} ev */
  function start(ev) {
    if (!win || !win.addEventListener) return;
    if (ev && ev.button) return;
    drag = { from: Number(ev && ev.clientX) || 0, base: width() };
    if (grip.setAttribute) grip.setAttribute("data-drag", "on");
    if (ev && ev.preventDefault) ev.preventDefault();
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", stop);
    win.addEventListener("pointercancel", stop);
  }

  /** @param {any} ev */
  function move(ev) {
    if (!drag) return;
    setDragged(drag.base + ((Number(ev && ev.clientX) || 0) - drag.from));
  }

  function stop() {
    if (!drag) return;
    drag = null;
    if (grip.removeAttribute) grip.removeAttribute("data-drag");
    if (win && win.removeEventListener) {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", stop);
      win.removeEventListener("pointercancel", stop);
    }
    remember();
  }

  /** @param {any} ev */
  function key(ev) {
    const k = ev && ev.key;
    if (k === "ArrowLeft") setDragged(width() - RACK_STEP);
    else if (k === "ArrowRight") setDragged(width() + RACK_STEP);
    else if (k === "Home") { reset(); return; }
    else return;
    if (ev.preventDefault) ev.preventDefault();
    remember();
  }

  /**
   * What the rail would be if nothing constrained it.
   *
   * A clone of the rack, laid out at `max-content` and hidden, is measured
   * rather than the live rows — because the live rows are already inside the
   * width being decided, so reading them answers the question with itself. The
   * clone carries the real classes, so THE INDENTATION IS IN THE MEASUREMENT:
   * a short name four levels down is wider than a long name at the root, and
   * counting characters cannot see that. Nor can it see that "Illlll" and
   * "Wwwww" are different widths in a proportional face.
   */
  function measure() {
    // Their width won, so there is nothing to work out and nothing to lay out.
    if (dragged !== null || !bed || !rack) return;
    const text = typeof rack.textContent === "string" ? rack.textContent : "";
    if (text === seen) return;
    seen = text;
    if (typeof rack.cloneNode !== "function") return;
    const ghost = rack.cloneNode(true);
    ghost.className = "rack rackghost";
    if (ghost.removeAttribute) ghost.removeAttribute("aria-label");
    bed.append(ghost);
    const box = ghost.getBoundingClientRect ? ghost.getBoundingClientRect() : null;
    const w = box ? box.width : 0;
    ghost.remove();
    measured = w > 0 ? Math.ceil(w) + RACK_SLACK : null;
  }

  return {
    /** The hairline on the rail's right edge. A sibling of the rack rather than
     *  a child of it: the rack scrolls, and a handle that scrolls away is a
     *  handle you cannot find. */
    grip,

    /**
     * @param {any} appEl the element carrying `--rack-w`
     * @param {any} bedEl the grid the rail is a column of
     * @param {any} rackEl the rail itself, which is what gets measured
     */
    mount(appEl, bedEl, rackEl) {
      app = appEl;
      bed = bedEl;
      rack = rackEl;
      if (win && win.addEventListener) {
        // Only the ceiling moves with the window, and only when it sized itself.
        win.addEventListener("resize", () => apply());
      }
      // A measurement taken before the faces load is a measurement of the
      // fallback face, and it is wrong by whatever the two differ by. There is
      // no event for "this element relaid out", so the one signal there is gets
      // used: measure again once the fonts are in.
      const fonts = doc && doc.fonts;
      if (fonts && fonts.ready && typeof fonts.ready.then === "function") {
        fonts.ready.then(() => { seen = null; measure(); apply(); }).catch(() => {});
      }
      this.sync();
    },

    /** Called from the repaint, after the rack has been refilled. */
    sync() {
      measure();
      apply();
    },

    /** The number on screen, for anything that needs to state it. */
    width,
    reset,
  };
}
