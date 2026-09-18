// SPDX-License-Identifier: AGPL-3.0-only
// Tiny DOM helper. No framework, no build step — this file is the whole abstraction.
//
//   h("div.rail", { onclick: fn }, "text", child)
//
// Tag syntax: "tag.class.class#id". Props starting with "on" bind listeners;
// everything else becomes an attribute, except `html` (innerHTML), `class`
// (appended rather than replacing) and `style` (an object).
//
// Lifted from the deleted mock, and it is the module that proves the
// layering point: swapping it for lit-html or Preact is one file plus a
// mechanical rewrite of the call sites, and that is not a decision anyone has
// to make now.
//
// `html` stays, against the mock audit's advice to delete it as unused, because
// markdown.js is a sibling and therefore banned from importing this file — it
// returns strings, and h("div", { html: md(text) }) is how a render spends them.

/** Anything h() accepts as a child. Arrays nest to any depth at runtime; null,
 *  undefined and false are dropped, which is what makes `cond && h(…)` read
 *  well. Written as two aliases because a JSDoc typedef may not reference
 *  itself directly.
 *  @typedef {Node | string | number | boolean | null | undefined | ChildList} Child */
/** @typedef {Child[]} ChildList */

/** Listeners (`onclick`), attributes, and the three special keys above.
 *  @typedef {Record<string, unknown>} Props */

/**
 * @param {string} spec "tag.class.class#id"
 * @param {Props | Child} [props] props when it is a plain object, else a child
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(spec, props, ...children) {
  const [head = "", ...classes] = String(spec).split(".");
  const [tag, id] = head.split("#");
  const el = document.createElement(tag || "div");
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(" ");

  if (props && props.constructor === Object) {
    for (const [k, v] of Object.entries(/** @type {Props} */ (props))) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2), /** @type {EventListener} */ (v));
      } else if (k === "html") {
        el.innerHTML = String(v);
      } else if (k === "style" && typeof v === "object") {
        // Object.assign cannot set a custom property; --tokens need setProperty.
        // This cost real time once. Every colour in the framework is a token, so
        // the branch that looks like an edge case is the common one.
        const style = /** @type {Record<string, string>} */ (/** @type {unknown} */ (el.style));
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith("--")) el.style.setProperty(prop, String(val));
          else style[prop] = String(val);
        }
      } else if (k === "class") {
        el.className += " " + String(v);
      } else {
        el.setAttribute(k, v === true ? "" : String(v));
      }
    }
  } else if (props !== undefined && props !== null) {
    children.unshift(/** @type {Child} */ (props));
  }

  add(el, children);
  return el;
}

/**
 * @param {HTMLElement} el
 * @param {Child[]} list
 */
function add(el, list) {
  for (const c of list) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) add(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * Replace everything inside `el` with `content`.
 * @param {HTMLElement} el
 * @param {...Child} content
 * @returns {HTMLElement}
 */
export function fill(el, ...content) {
  el.replaceChildren();
  add(el, content);
  return el;
}

/** The two attribute values below are interpolated into markup, so they are
 *  escaped here. `inner` and `viewBox` are not: they are the SVG itself and
 *  every call site passes a literal path string. */
const attr = (/** @type {string} */ s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Inline SVG from a path string, sized square.
 * @param {string} viewBox
 * @param {string} inner  raw SVG markup — a literal at every call site
 * @param {string} [cls]
 * @param {string} [label] set it and the icon is announced; omit it and the
 *   icon is hidden from a screen reader, which is right for a labelled button
 * @returns {SVGElement}
 */
export function svg(viewBox, inner, cls = "", label = "") {
  const wrap = document.createElement("div");
  wrap.innerHTML =
    `<svg class="${attr(cls)}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1"` +
    (label ? ` role="img" aria-label="${attr(label)}"` : ' aria-hidden="true"') +
    `>${inner}</svg>`;
  return /** @type {SVGElement} */ (wrap.firstElementChild);
}

/** A VIEW PREFERENCE THAT OUTLIVES THE TAB, and the only thing in the client
 *  that touches `localStorage`.
 *
 *  It is here rather than in the store because the store is a plain box of
 *  values that does no I/O, and here rather than inline in a view because every
 *  access has to be in a try/catch: a private window, a browser set to block
 *  site data, or a thumbnail capture makes the accessor itself throw, and a rail
 *  that fails to draw because somebody has cookies off is a worse bug than a
 *  forgotten sort direction.
 *
 *  Nothing about the workspace is ever kept here. This is one person's view of
 *  one folder on one machine.
 *  @param {string} key @param {string} fallback @returns {string}
 */
export function remembered(key, fallback) {
  try {
    const held = localStorage.getItem(`biom:${key}`);
    return held === null ? fallback : held;
  } catch {
    return fallback;
  }
}

/** A VIEW PREFERENCE FOR THIS TAB ONLY — sessionStorage, which a reload keeps
 *  and a restart does not. The terminal dock's edge and size live here: the
 *  spec keeps them for the current workspace session and leaves anything longer
 *  to a retention decision nobody has made. Same try/catch discipline as
 *  `remembered`, for the same reasons.
 *  @param {string} key @param {string} fallback @returns {string} */
export function heldForTab(key, fallback) {
  try {
    const held = sessionStorage.getItem(`biom:${key}`);
    return held === null ? fallback : held;
  } catch {
    return fallback;
  }
}

/** @param {string} key @param {string} value */
export function holdForTab(key, value) {
  try {
    sessionStorage.setItem(`biom:${key}`, value);
  } catch {
    /* the dock forgets its edge on reload; nothing else is lost */
  }
}

/** @param {string} key @param {string} value */
export function remember(key, value) {
  try {
    localStorage.setItem(`biom:${key}`, value);
  } catch {
    /* nothing to do and nothing to say: the preference is lost, the app is not */
  }
}
