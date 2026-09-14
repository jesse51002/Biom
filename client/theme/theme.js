// SPDX-License-Identifier: AGPL-3.0-only
// The palette on the host document, and the same palette as data for the one
// document that cannot read a custom property.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE HAND-OFF, WHICH IS THE THING TO READ BEFORE TOUCHING ANY OF THIS
// ─────────────────────────────────────────────────────────────────────────────
//
// **CSS custom properties do not cross a document boundary.** They inherit down
// a DOM tree; an iframe is a different tree. The artifact frame is
// `sandbox="allow-scripts"` with no `allow-same-origin`, so it has an opaque
// origin and the host cannot even reach into it to add a stylesheet. Inside a
// page, `var(--ink)` resolves to nothing until the shim declares it — so the
// vault's theme goes over the wire: the bridge answers `theme.get` with the
// `Theme` object, the frame host broadcasts `{kind:"theme", theme}` on every
// change, and `guest/biom.js` re-declares the tokens inside the box.
//
// `themeVars(theme)` below is the single conversion on this side of the
// boundary. **The shim cannot import it** — the guest imports nothing, by rule
// and by transport — so it holds the same lines under the name `cssVar`, and
// `tests/theme.test.js` runs the two rules against the same names so they
// cannot drift apart quietly. What makes that survivable is that the mapping is
// a RULE and not a table: `tokenOf` in palettes.js turns `stockHi` into
// `--stock-hi` and nothing has to be enumerated.
//
// The three font roles go over too. Their values come from `fonts.available`,
// not from `fonts.roles` — a role holds a face NAME and the token wants its
// STACK. The woff2 files themselves do not come this way: a stylesheet does not
// cross into an opaque origin either, so `faces.js` declares every shipped
// `@font-face` a second time and `frame.js` weaves that into the box's head,
// with absolute urls the server answers with the CORS header a null origin
// needs. A stack naming a face not in `faces.js` still falls back to its generic.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CHROME FOLLOWS THE VAULT, AND `hostVars` IS WHERE THAT IS DECIDED
// ─────────────────────────────────────────────────────────────────────────────
//
// The workspace UI around the box takes the open vault's palette and its
// FURNITURE face, so a folder that ships cream pages is a cream workspace and
// one that ships a near-black biome is a near-black workspace. `css/tokens.css`
// still declares a scheme, and it is now the one painted before `theme.get` has
// answered rather than the one the chrome keeps.
//
// This costs something and it was chosen anyway: with the rail painted from the
// page's own palette, the seam between the product and the page somebody built
// in it is gone. What is bought is that a workspace looks like the thing it is
// for, all the way to the edges of the window.
//
// `hostVars` is `themeVars` plus the two tokens only this document has:
//
//   `--ui-face`   the chrome's own type, from the `furniture` role. NOT the
//                 `gauge` role for `--mono-face` as well — a vault is free to
//                 name a serif there, and `code`, `kbd` and the vault picker's
//                 filesystem paths would render in it.
//   `--shadow`    the palette's dark end, whichever end that is. Depth is an
//                 offset and a blur of the canvas's own black, which holds only
//                 while the canvas IS black; mixed out of near-white stock a
//                 shadow is a white haze. `tokens.css` derives `--lift` and the
//                 dialog scrim from this rather than from `--stock`.
//
// And `color-scheme`, which is not a custom property and does not follow one:
// it is what stops the browser tinting the chrome's own scrollbars and native
// controls dark under a light vault. The box gets `color-scheme:normal` forced
// back on it in `css/chrome.css`, because a page's scheme is the page's.

/** @import { Theme, TypeRoles } from "../../contracts/types.ts" */
//
// ONE VALUE IS STILL ITS OWN THING, AND IT IS THE PAGE'S PAPER. The box's
// document paints no background and the frame is transparent, so what shows
// through a page is the canvas behind it. `paperOf` answers the page's paper —
// the palette's LIGHTEST stock, which is not the canvas's — and `boot.js` sets
// it separately, so the sheet reads as a sheet laid on the workspace rather
// than as a hole in it.

import { tokenOf } from "./palettes.js";

const FONT_TOKEN = { sheet: "--sheet-face", furniture: "--furniture-face", gauge: "--gauge-face" };

/**
 * The stack behind a type role. A role holds a face NAME and every token that
 * takes one wants its STACK, so every lookup goes through here.
 * @param {Theme} theme
 * @param {keyof TypeRoles["roles"]} role
 * @returns {string | null}
 */
function stackOf(theme, role) {
  const name = theme.fonts.roles[role];
  const face = theme.fonts.available.find((f) => f.name === name);
  return face ? face.stack : null;
}

/**
 * How light a colour is, 0 to 1, or null when it is not one this can read.
 *
 * **It reads the six- and three-digit forms and nothing else**, which is every
 * value any palette in the framework has ever held. Anything else — a named
 * colour, a modern colour function — answers null and every caller below falls
 * back to what the chrome did before it could measure. Resolving the general
 * case means a live document to ask, and this runs before one is painted.
 * @param {string | null | undefined} color
 * @returns {number | null}
 */
export function lumaOf(color) {
  const m = /^\s*#?([\da-f]{3}|[\da-f]{6})\s*$/i.exec(color || "");
  if (!m) return null;
  const digits = m[1] ?? "";
  const h = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  // sRGB to linear, then Rec. 709 weights: the WCAG relative luminance, which is
  // the one measure that agrees with what a person calls light or dark.
  const lin = (/** @type {number} */ i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

/**
 * Whether this theme is a light workspace or a dark one, read off the canvas.
 * Unreadable stock answers `"dark"`, which is what the chrome was.
 * @param {Theme} theme
 * @returns {"light" | "dark"}
 */
export function schemeOf(theme) {
  const luma = lumaOf(theme.palette.colors.stock);
  return luma !== null && luma > 0.5 ? "light" : "dark";
}

/**
 * The palette's dark end: whichever of the canvas and the ink is darker. On a
 * dark workspace that is the canvas, which is what depth was always mixed from;
 * on a light one it is the ink, and without this a shadow is white on white.
 * @param {Theme} theme
 * @returns {string | null}
 */
export function shadowOf(theme) {
  const stock = theme.palette.colors.stock || null;
  const ink = theme.palette.colors.ink || null;
  const a = lumaOf(stock);
  const b = lumaOf(ink);
  if (a === null || b === null) return stock;
  return b < a ? ink : stock;
}

/**
 * The colour a page sits on: its palette's lightest paper, or its stock, or
 * nothing when the vault has not answered yet. The host paints the canvas under
 * the box with this so a sheet reads as a sheet laid on the workspace.
 * @param {Theme} theme
 * @returns {string | null}
 */
export function paperOf(theme) {
  const colors = theme && theme.palette ? theme.palette.colors : null;
  if (!colors) return null;
  return colors.stockHi || colors.stock || null;
}

/**
 * Every custom property this theme declares, as data: what crosses into the
 * box, and the shape the shim re-implements.
 * @param {Theme} theme
 * @returns {Record<string, string>}
 */
export function themeVars(theme) {
  /** @type {Record<string, string>} */
  const vars = {};
  for (const [key, value] of Object.entries(theme.palette.colors)) vars[tokenOf(key)] = value;
  for (const x of theme.palette.extra) vars[tokenOf(x.name)] = x.value;
  for (const [role, token] of Object.entries(FONT_TOKEN)) {
    const stack = stackOf(theme, /** @type {keyof TypeRoles["roles"]} */ (role));
    if (stack) vars[token] = stack;
  }
  return vars;
}

/**
 * What the HOST document declares: everything the box gets, plus the two tokens
 * only the chrome has. A superset on purpose — a page and the workspace around
 * it name the same colours, and the difference is the furniture.
 * @param {Theme} theme
 * @returns {Record<string, string>}
 */
export function hostVars(theme) {
  const vars = themeVars(theme);
  const ui = stackOf(theme, "furniture");
  if (ui) vars["--ui-face"] = ui;
  const shadow = shadowOf(theme);
  if (shadow) vars["--shadow"] = shadow;
  return vars;
}

/**
 * Write a theme onto the document. Idempotent and cheap to call again — it is a
 * handful of property sets, which is why `boot.js` can subscribe it to every
 * store emit without a keystroke in a table costing anything.
 *
 * `root` is a parameter so the tests can hand it something that is not a
 * document; nothing else passes one.
 * @param {Theme} theme
 * @param {{ style: { setProperty(name: string, value: string): void, colorScheme: string } }} [root]
 */
export function applyTheme(theme, root) {
  const el = root || document.documentElement;
  for (const [token, value] of Object.entries(hostVars(theme))) el.style.setProperty(token, value);
  el.style.colorScheme = schemeOf(theme);
}
