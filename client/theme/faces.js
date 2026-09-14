// SPDX-License-Identifier: AGPL-3.0-only
// The shipped typefaces, as data — the one list every `@font-face` is written from.
//
// A FONT HAS TO BE DECLARED TWICE, ON TWO ORIGINS, AND THIS IS WHY IT IS A LIST.
// `css/tokens.css` declares the faces for the host document. The artifact box is
// `sandbox="allow-scripts"` with no `allow-same-origin`, so its origin is opaque
// and a stylesheet on the host is not its stylesheet: nothing declared in
// tokens.css exists in there. The box gets its own `@font-face` rules, woven
// into its `<head>` by `frame.js` ahead of the shim, with ABSOLUTE urls back to
// `/fonts/` on the host — and the host serves that route with
// `access-control-allow-origin: *`, because a font, unlike a classic script, is
// a CORS-gated subresource and an opaque origin sends `Origin: null`. That
// header is what makes the second declaration render instead of falling back
// to Georgia. It exposes nothing: the files are the framework's own and the box
// cannot read a font back out of a `@font-face`.
//
// The two declarations are one function applied to two bases, and
// `tests/theme.test.js` holds tokens.css's block byte-equal to `faceCss("../fonts/")`
// so the host and the box can never disagree about which files exist.
//
// A page never names one of these families directly. It asks for a ROLE —
// `var(--sheet-face)`, `--furniture-face`, `--gauge-face` — and the vault's
// `theme.json` says which face fills each role, from the `available` list the
// vault ships (`palettes.js` seeds it with everything declared here).

/**
 * @typedef {object} Face
 * @property {string} family  the CSS family name, exactly as a stack quotes it
 * @property {string} file    the woff2 under `client/fonts/`
 * @property {string} weight  a weight, or a range for a variable font
 * @property {"normal" | "italic"} style
 */

/** @type {readonly Face[]} */
export const FACES = Object.freeze([
  // The dot-matrix world: a true dot-matrix display face, a pixel face for
  // labels and figures, and a hyperlegible sans for reading. All SIL OFL.
  { family: "Workbench", file: "workbench.woff2", weight: "400", style: "normal" },
  { family: "Silkscreen", file: "silkscreen.woff2", weight: "400", style: "normal" },
  { family: "Silkscreen", file: "silkscreen-bold.woff2", weight: "700", style: "normal" },
  { family: "Atkinson Hyperlegible Next", file: "atkinson.woff2", weight: "400 700", style: "normal" },
  { family: "Atkinson Hyperlegible Next", file: "atkinson-italic.woff2", weight: "400", style: "italic" },
  // The three role-named faces the framework first shipped with. Kept so a vault
  // still naming C059, Nimbus Sans Narrow or Cascadia Code keeps rendering.
  { family: "Sheet", file: "c059.woff2", weight: "400", style: "normal" },
  { family: "Sheet", file: "c059-bold.woff2", weight: "700", style: "normal" },
  { family: "Sheet", file: "c059-italic.woff2", weight: "400", style: "italic" },
  { family: "Furniture", file: "narrow.woff2", weight: "400", style: "normal" },
  { family: "Furniture", file: "narrow-bold.woff2", weight: "700", style: "normal" },
  { family: "Gauge", file: "mono.woff2", weight: "400", style: "normal" },
]);

/**
 * Every `@font-face` rule, one per line, with each file resolved under `base`.
 * `"../fonts/"` is what tokens.css wants; the box wants the host's absolute
 * `/fonts/` url, because a relative one would resolve against the vault's
 * `<base>` and miss.
 * @param {string} base
 * @returns {string}
 */
export function faceCss(base) {
  return FACES.map(
    (f) =>
      `@font-face{font-family:"${f.family}";src:url("${base}${f.file}") format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:swap}`,
  ).join("\n");
}
