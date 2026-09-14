// SPDX-License-Identifier: AGPL-3.0-only
// One overlay for every menu in the workspace.
//
// It is fixed to the viewport rather than nested in the thing that opened it,
// because the canvas scrolls and an absolutely positioned menu inside a
// scroller gets clipped. One implementation also means every menu dismisses the
// same way: click outside, Escape, or scroll the surface underneath.
//
// Lifted from the deleted mock's popover. The class names are load-bearing —
// .pop, .popitem, .popname, .popnote, .poptick, .poplabel, .popsep, .popinput,
// .popback are what the lifted stylesheet targets, so renaming one here is a
// silent visual break rather than an error.

/** @import { Child } from "../platform/dom.js" */

import { h, svg } from "../platform/dom.js";

/** @typedef {{ el: HTMLElement, anchor: HTMLElement, onDown: (e: PointerEvent) => void,
 *              onKey: (e: KeyboardEvent) => void, onMove: () => void,
 *              scroller: Element | null, onClose?: (() => void) | undefined }} Live */

/** At most one menu is open at a time, which is why this is a module variable
 *  and not state anybody has to thread through. @type {Live | null} */
let live = null;

export function closePopover() {
  if (!live) return;
  const done = live.onClose;
  document.removeEventListener("pointerdown", /** @type {EventListener} */ (live.onDown), true);
  document.removeEventListener("keydown", /** @type {EventListener} */ (live.onKey), true);
  window.removeEventListener("resize", live.onMove);
  live.scroller?.removeEventListener("scroll", live.onMove);
  live.el.remove();
  live.anchor?.setAttribute("aria-expanded", "false");
  live = null;
  done?.();
}

/**
 * @param {HTMLElement} anchor the element the menu hangs from
 * @param {(close: () => void) => Child} build
 * @param {{ align?: "start" | "end", width?: string, onClose?: () => void }} [opts]
 * @returns {HTMLElement | null} null when the click closed an already-open menu
 */
export function popover(anchor, build, opts = {}) {
  const wasMine = live && live.anchor === anchor;
  closePopover();
  if (wasMine) return null;                       // clicking the trigger again closes it

  const el = h("div.pop", { role: "menu" });
  if (opts.width) el.style.width = opts.width;
  el.append(...nodesOf(build(closePopover)));
  document.body.append(el);

  const scroller = anchor.closest(".canvas");

  // The thing a menu hangs from can be repainted out from under it — a row
  // rebuilds, a cell is replaced. A detached element measures 0×0 at 0,0, which
  // used to fling the menu into the corner. Keep the last good rect instead.
  /** @type {DOMRect | null} */
  let known = null;
  const place = () => {
    const r = anchor.getBoundingClientRect();
    if (anchor.isConnected && (r.width || r.height)) known = r;
    const a = known;
    if (!a) return;
    const w = el.offsetWidth, hgt = el.offsetHeight, gap = 5;
    let left = opts.align === "end" ? a.right - w : a.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = a.bottom + gap;
    if (top + hgt > innerHeight - 8) top = Math.max(8, a.top - hgt - gap);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };
  place();

  /** @param {PointerEvent} e */
  const onDown = (e) => {
    const t = /** @type {Node} */ (e.target);
    if (el.contains(t) || anchor.contains(t)) return;
    closePopover();
  };
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closePopover();
    anchor.focus();
  };
  document.addEventListener("pointerdown", /** @type {EventListener} */ (onDown), true);
  document.addEventListener("keydown", /** @type {EventListener} */ (onKey), true);
  window.addEventListener("resize", place);
  scroller?.addEventListener("scroll", place, { passive: true });

  anchor.setAttribute("aria-expanded", "true");
  live = { el, anchor, onDown, onKey, onMove: place, scroller, onClose: opts.onClose };

  focusFirst(el);
  return el;
}

/**
 * Replace what the open menu is showing, in place.
 *
 * A submenu anchored to a row of the menu it replaces cannot be positioned — by
 * the time it opens, its anchor has been removed from the document. Menus that
 * drill in push instead, which is also how the pattern reads to anyone who has
 * used one.
 *
 * @param {(close: () => void) => Child} build
 * @returns {HTMLElement | null}
 */
export function pushPopover(build) {
  if (!live) return null;
  live.el.replaceChildren(...nodesOf(build(closePopover)));
  live.onMove();
  focusFirst(live.el);
  return live.el;
}

/** A menu builder may return one node, an array, or an array with holes in it
 *  from `cond && item`. All three arrive here.
 *  @param {Child} built @returns {Node[]} */
function nodesOf(built) {
  /** @type {Node[]} */
  const out = [];
  /** @param {Child} c */
  const walk = (c) => {
    if (Array.isArray(c)) c.forEach(walk);
    else if (c instanceof Node) out.push(c);
  };
  walk(built);
  return out;
}

/** @param {HTMLElement} el */
function focusFirst(el) {
  const first = /** @type {HTMLElement | null} */ (el.querySelector("input:not([type=file]), .popitem"));
  if (first) first.focus({ preventScroll: true });
}

const BACK = "<path d='M9 3 L4 8 L9 13' stroke-width='1.5' stroke-linecap='round'" +
  " stroke-linejoin='round' fill='none'/>";

/**
 * @param {string} label
 * @param {() => void} onBack
 * @returns {HTMLElement}
 */
export function popBack(label, onBack) {
  return h("button.popback", { type: "button", onclick: onBack },
    svg("0 0 16 16", BACK, "backarrow"), h("span", label));
}

/* ---- the pieces a menu is made of ---- */

const TICK = "<path d='M2 7 L6 11 L14 2' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/>";

/** @param {string} text */
export const popLabel = (text) => h("div.poplabel", text);

export const popSep = () => h("div.popsep", { role: "separator" });

/**
 * @param {string} label
 * @param {(e: MouseEvent) => void} onClick
 * @param {{ danger?: boolean, disabled?: boolean, checked?: boolean,
 *           icon?: Node | null, note?: string }} [opts]
 * @returns {HTMLElement}
 */
export function popItem(label, onClick, opts = {}) {
  return h("button.popitem" + (opts.danger ? ".danger" : ""), {
    type: "button", role: "menuitem", disabled: opts.disabled ? "" : null,
    onclick: onClick,
  },
    opts.icon || null,
    h("span.popname", label),
    opts.note ? h("span.popnote", opts.note) : null,
    opts.checked ? svg("0 0 16 13", TICK, "poptick") : null);
}

/**
 * @param {Record<string, unknown>} props
 * @returns {HTMLElement}
 */
export function popInput(props) {
  return h("input.popinput", { type: "text", spellcheck: "false", ...props });
}
