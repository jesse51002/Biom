// SPDX-License-Identifier: AGPL-3.0-only
// The palette data. **This is the only file in the client allowed to name a
// colour**, and `tests/theme.test.js` greps the others to keep it that way.
//
// A hex literal anywhere else is not a style nit: it is the thing that breaks
// theming for generated pages. A page that used `var(--ink)` follows a palette
// change; a page that wrote the same colour out does not.
//
// **A colour key is camelCase and its token is the kebab of it** — `stockHi`
// becomes `--stock-hi`, `room2` becomes `--room-2`. `tokenOf` below is that
// rule. It is deterministic on purpose: the shim inside an artifact frame has
// to re-declare these tokens in a document this code can never reach, it cannot
// import anything, and a lookup table copied across that boundary is a lookup
// table that drifts. A rule can be re-derived from an example; a table cannot.
//
// `guest/biom.js` holds the same three lines under the name `cssVar`, and
// `tests/theme.test.js` runs both against the same names so the duplication
// cannot rot quietly.
//
// THERE IS ONE PALETTE HERE AND NO PRESETS, AND IT IS BOTH THE FALLBACK AND
// THE DEFAULT. Four worked-out palettes and a Theme screen to pick between them
// used to live here and are not coming back: a workspace is themed by the folder
// it opens, in its own `theme.json`, and a picker in the app would be a second
// place to say the same thing. What is below is what paints before `theme.get`
// answers and what fills any colour a `theme.json` does not name — mirrored in
// `css/tokens.css`, held byte-equal to it by the test, and overwritten on the
// root by `theme.js`'s `applyTheme` the moment the vault has spoken.
//
// **The server holds the same palette a second time and cannot import this
// one.** `server/workspace/presets.ts` is what a NEW vault's `theme.json` is
// written from, and it sits at layer 3 while this file sits at layer 13 — the
// import would be upward and `tools/layers.mjs` fails the build on it. Moving
// the shared value down to `contracts/` would be a third copy of the same
// decision in the one directory that is frozen between barriers. So there are
// two copies and `tests/theme.test.js` reads the server's out of its source and
// asserts it equals this one, key for key and value for value: the seeded
// palette and the fallback painted before it is read MUST be the same palette,
// or a fresh vault flashes one scheme and settles into another.

/** @import { Theme } from "../../contracts/types.ts" */

/* ── the fallback palette ───────────────────────────────────────────────── */

// The key names are the press vocabulary the stylesheets and the shim grew up
// with — stock for a surface, ink for text, cyan and magenta for the two
// accents — and they are kept because ~300 rules and every generated page name
// them. **The key set is the contract and the values are the brand**: a name
// like `cyan` says WHERE a colour goes, not what hue it is, and every one of
// them here is charcoal, cream or Sunflower.
//
// THE VALUES ARE THE PRODUCT'S OWN BRAND, and this is the palette every new
// vault is seeded with. Charcoal `#0E0F11` is the ground everywhere, cream
// `#EDE6D6` is the type and the mark, and Sunflower `#FFB020` is the one hot
// colour. Three things the brand does not name had to be picked anyway, and
// each is picked so the screen that uses it keeps its contrast:
//
//   `magenta`/`magentaT`  a cool blue, the SECOND accent — the agent tool, the
//                         close control, a person pill. It cannot be Sunflower:
//                         a person pill and a page pill sit side by side in a
//                         table cell and would become one colour. Cool rather
//                         than red because `.tool.spot` is the biggest control
//                         on the screen and a red one reads as an alarm rather
//                         than as the way to talk to your agent.
//   `field`               a hover fill a step above the page's paper, because a
//                         hover that matches the paper is not a hover.
//   `ink3`                lifted off the brand's `#7E7A70` to `#8F8A7C`, which
//                         is the first value that clears 4.5:1 as dim text on
//                         all three of the canvas, the paper and `field`.
//
// `cyan` and `yellow` are BOTH Sunflower, deliberately. `cyan` is only ever a
// fill or a ring (the primary control, focus, selection) and `yellow` is only
// ever text or a wash (`.bad`, `.danger`, and the welcome screen's warm slot),
// so the two never appear in the same form in the same place and one hot colour
// serves both.
const BRAND = {
  name: "Biom",
  colors: {
    stock: "#0E0F11", stockHi: "#16181B", stockLo: "#0A0B0C", stockEdge: "#3A3F47",
    field: "#1D2024",
    ink: "#EDE6D6", ink2: "#B9B3A5", ink3: "#8F8A7C",
    rule: "#2C3036", ruleSoft: "#23262B",
    cyan: "#FFB020", magenta: "#7AB4FF", yellow: "#FFB020",
    cyanT: "#FFC759", magentaT: "#A9CEFF",
    nonrepro: "#3A3F47", nonreproT: "#6C7682",
    room: "#121316", room2: "#0A0B0C", roomRule: "#2C3036",
    roomInk: "#EDE6D6", roomInk2: "#B9B3A5", roomInk3: "#8F8A7C",
    // Text laid on a filled button. A colour of its own rather than a mix of
    // the others: both accents here are LIGHT, so a filled control wants the
    // palette's dark end rather than the white a dark scheme usually reaches
    // for — cream on Sunflower is unreadable.
    onSpot: "#16181B",
  },
  extra: [],
};

/** Seeded so a table's category colours have two names to reach for, and
 *  matching what the server seeds — held equal to it by `tests/theme.test.js`.
 *  Fixtures: they represent nothing, beyond being legible on charcoal. */
const SEED_EXTRA = [
  { name: "Warning", value: "#FF7A2F" },
  { name: "Won", value: "#5BE37D" },
];

/** What a page is themed with before its vault has answered. The vault's copy
 *  is authoritative at runtime; this one exists so the first frame has a theme
 *  to be handed, and so the tests have one to work on. The FONTS are the
 *  shipped faces from `faces.js` — declared in `css/tokens.css` for the host
 *  and woven into every box for the pages — which a page asks for by role; the
 *  chrome itself no longer uses them. */
/** @type {Theme} */
export const DEFAULT_THEME = {
  palette: { ...BRAND, extra: SEED_EXTRA },
  fonts: {
    roles: { sheet: "C059", furniture: "Nimbus Sans Narrow", gauge: "Cascadia Code" },
    available: [
      { name: "Atkinson Hyperlegible Next", stack: '"Atkinson Hyperlegible Next", system-ui, sans-serif', note: "shipped" },
      { name: "Workbench", stack: '"Workbench", "Silkscreen", monospace', note: "shipped" },
      { name: "Silkscreen", stack: '"Silkscreen", "Workbench", monospace', note: "shipped" },
      { name: "C059", stack: '"Sheet", Georgia, serif', note: "shipped" },
      { name: "Nimbus Sans Narrow", stack: '"Furniture", Arial, sans-serif', note: "shipped" },
      { name: "Cascadia Code", stack: '"Gauge", ui-monospace, monospace', note: "shipped" },
      { name: "Georgia", stack: "Georgia, serif", note: "system" },
      { name: "Helvetica", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif', note: "system" },
    ],
  },
};

/* ── names ──────────────────────────────────────────────────────────────── */

/**
 * `stockHi` → `--stock-hi`, `room2` → `--room-2`. The same rule serves a role
 * and an extra colour's name, which is why an extra is sanitised to letters and
 * digits before it is stored — a name with a space produces a custom property
 * the CSSOM rejects, on both sides of the frame boundary, silently.
 *
 * **`guest/biom.js` holds this rule too, as `cssVar`, and cannot import
 * it.** Change one and change both; the test compares them.
 * @param {string} name @returns {string}
 */
export const tokenOf = (name) =>
  "--" + name.replace(/([A-Z])/g, "-$1").replace(/(\d+)/g, "-$1").toLowerCase();

/** What may be typed as the name of an extra colour, given the rule above:
 *  letters and digits, and not a capital first — `Warning` would derive
 *  `---warning`, which is a legal custom property and an ugly one to have to
 *  type into a generated page. The rule itself is not touched, because the shim
 *  holds a copy of it and the two agreeing matters more than either being
 *  pretty.
 *  @param {string} name @returns {string} */
export const cleanName = (name) =>
  name.replace(/[^A-Za-z0-9]+/g, "").replace(/^[A-Z]/, (c) => c.toLowerCase());
