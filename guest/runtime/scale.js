// SPDX-License-Identifier: AGPL-3.0-only
/* guest/runtime/scale.js — the markdown type scale, applied. A classic script
 * sharing globals; see registry.js for why there are no imports in here.
 *
 * The server answers `page.read` with a flat map of custom properties, narrowed
 * from `markdown.yaml` — the workspace's, with this page's merged over it. This
 * file is the other half: it declares them on the page root and ships the one
 * stylesheet that reads them.
 *
 * IT LIVES IN A CASCADE LAYER, AND THAT IS THE WHOLE DESIGN.
 *
 * A section's own `<style>` must always beat the page scale — the scale is the
 * default a markdown region starts from, not a ceiling on it. Specificity cannot
 * express that: `[data-g-md] h1` is (0,1,1) and a section writing `h1 { … }` is
 * (0,0,1), so the scale would win and the section author would have no idea why
 * their heading was ignored. `@layer` inverts it by origin instead of by
 * counting: **an unlayered author rule beats every layered one**, whatever its
 * specificity, so every section wins over this by construction and nobody has to
 * know the rule exists.
 *
 * `revert` IS THE FALLBACK, NOT A NUMBER. `var(--md-h1-size)` with nothing
 * declared is invalid at computed-value time, which resets the property to its
 * inherited value — an `h1` on a page with no scale would come out the size of
 * body text. A fallback of `revert` means "as if this stylesheet said nothing",
 * so the browser's own default stands and a workspace that has never written a
 * `markdown.yaml` looks exactly as it did before this file existed.
 *
 * THE PROPERTIES ARE DECLARED ON THE PAGE ROOT rather than on each region, so a
 * scale is one write per draw and inherits to every markdown region including
 * ones a plugin mounted inside a table cell.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /** Kept in step with `SCALE_ELEMENTS` in `contracts/scale.ts`. An element the
   *  server will never send a property for costs one unread rule; an element
   *  missing here silently ignores a line somebody wrote, which is why the
   *  checker reads the contracts list rather than this one. */
  const ELEMENTS = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "li", "blockquote", "code", "pre", "hr", "a", "strong", "em", "table",
  ];

  /** The scale's word → the CSS property it sets. The scale is written the way
   *  somebody thinks about type; this is the only place the translation lives on
   *  this side of the wire. */
  /** @type {[string, string][]} */
  const PROPS = [
    ["size", "font-size"],
    ["weight", "font-weight"],
    ["leading", "line-height"],
    ["tracking", "letter-spacing"],
    ["above", "margin-block-start"],
    ["below", "margin-block-end"],
    ["style", "font-style"],
    ["case", "text-transform"],
    ["face", "font-family"],
  ];

  /** BODY SIZE IS THE PAGE'S, AND EVERYTHING INHERITS IT. This is the one place
   *  the sheet is not mechanical, and it took three goes to get right.
   *
   *  The scale kept losing to authors, in three costumes:
   *
   *    1. `font-size` on `p`. Markdown wraps its content in a block, so a
   *       section writing `.kicker { font-size: .74rem }` sizes the SLOT and not
   *       the paragraph the words land in — the scale reached the words and the
   *       section did not. Every small label came out at body size.
   *    2. `max-width` on the region, which put the page-wide measure back by the
   *       side door and capped slots nobody meant it for.
   *    3. `font-size` on the region — which IS the slot — so a section sizing an
   *       ANCESTOR of the slot lost instead. On one page a ledger set `.7rem` on
   *       the list and every value inside it drew at 17px.
   *
   *  Each time the cascade layer was no help, because an unlayered rule beats a
   *  layered one only where the two target the SAME element, and each time the
   *  author had targeted a different one.
   *
   *  So body text is declared once on the page root and inherits the whole way
   *  down. A section rule at ANY level now wins by ordinary inheritance, because
   *  there is nothing at that level to fight: the scale states a default and
   *  competes with nobody. That is the property worth keeping — the per-slot
   *  workaround the previous shape needed was applied nine times on one page and
   *  missed twice, which is not a rule anybody can follow.
   *
   *  Headings, code, quotes and rules keep explicit per-element sizes with a
   *  `revert` fallback: they are deliberately unlike body text, and inheriting
   *  would flatten every heading on a workspace with no scale at all. `li` falls
   *  back to `inherit`, so a list inside a small-text region stays small unless
   *  the scale speaks about lists on purpose. */
  const ON_ROOT = new Set(["size", "leading", "face"]);

  function sheet() {
    const out = ["@layer biom.scale {"];

    // The page, not the region: inherited by every block, and overridable by any
    // section rule at any depth simply by being an ordinary inherited value.
    const page = [];
    for (const [word, css] of PROPS) {
      if (ON_ROOT.has(word)) page.push(`${css}: var(--md-p-${word}, revert);`);
    }
    out.push(`  #g-page { ${page.join(" ")} }`);

    for (const el of ELEMENTS) {
      const body = [];
      for (const [word, css] of PROPS) {
        // Already inherited from the page, and re-stating it here is exactly the
        // mistake this shape exists to stop making.
        if (el === "p" && ON_ROOT.has(word)) continue;
        const fallback = el === "li" && ON_ROOT.has(word) ? "inherit" : "revert";
        body.push(`${css}: var(--md-${el}-${word}, ${fallback});`);
      }
      out.push(`  [data-g-md] ${el} { ${body.join(" ")} }`);
    }

    out.push("}");
    return out.join("\n");
  }

  let laid = false;
  function install() {
    if (laid) return;
    laid = true;
    const el = document.createElement("style");
    el.setAttribute("data-g-scale", "");
    el.textContent = sheet();
    document.head.appendChild(el);
  }

  rt.scale = {
    /** The stylesheet this file installs. Exposed for verification: the one
     *  thing worth pinning about it is WHICH declarations land on the region and
     *  which land on an element, and that is a property of the text. */
    sheet: sheet,
    /** Declare one page's scale on its root. Everything previously declared is
     *  cleared first: a page whose `markdown.yaml` LOST a line must lose the
     *  property with it, and leaving stale custom properties on the element
     *  would make a deletion the one edit that does not take effect.
     *  @param {HTMLElement} root @param {Record<string, string>} map */
    apply(root, map) {
      install();
      for (const name of Array.from(root.style)) {
        if (name.indexOf("--md-") === 0) root.style.removeProperty(name);
      }
      for (const name of Object.keys(map || {})) {
        // Names and values both arrive already narrowed by `contracts/scale.ts`,
        // which is where the grammar is. Nothing is re-checked here, and the
        // reason is worth stating: a second, looser check in the box would be
        // the one somebody trusted.
        if (name.indexOf("--md-") === 0) root.style.setProperty(name, String(map[name]));
      }
    },
  };
})();
