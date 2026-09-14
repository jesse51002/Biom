// SPDX-License-Identifier: AGPL-3.0-only
// Markdown → an HTML string, over the vendored markdown-it.
//
// It returns a STRING rather than nodes, and that is the layering rule doing
// useful work: dom.js is a sibling and therefore banned, so this module has no
// dependency but the parser — `h("div", { html: md(text) })` is how a render
// spends it.
//
// THE SAFETY PROPERTY, WHICH IS NOT NEGOTIABLE. This runs in the HOST realm and
// its output goes straight into the host document. The 92 hand-rolled lines it
// replaces were XSS-correct BY CONSTRUCTION — every run of text was escaped
// before any mark was applied, so the only tags in the output were the ones the
// file wrote itself. `html: false` keeps exactly that true: raw HTML in the
// source is ESCAPED rather than passed through, so a `<script>` a user typed is
// text and an `onerror=` never becomes an attribute. markdown-it's own
// `validateLink` refuses `javascript:`, `vbscript:`, `file:` and every `data:`
// that is not one of four image types, which covers the href half.
//
// Nothing here post-processes the rendered string. A sanitiser run over
// generated markup is the construction that goes wrong quietly; escaping at the
// point the text is written is the one that cannot. `tests/markdown.test.js`
// proves each property rather than assuming it, and pins the upstream defaults
// so a version bump that loosened one would fail rather than ship.
//
// THE FENCE IS A JOINT. A fenced block comes out as
//
//     <pre><code class="language-<info>">…the source, escaped…</code></pre>
//
// with the class present only when the fence carried an info string, and the
// info reduced to one lowercase word. So a fence is exactly
// `pre > code.language-<info>`, and the `<pre>`'s textContent is the source
// verbatim — which is the joint the box's markdown plugin hands to whichever
// plugin that info string names, where the workspace has one. This module names
// no language and loads nothing: it is layer 6 and stays a pure string function
// with no dependency but the parser.

// @ts-ignore — a BARE specifier, resolved by the import map in client/index.html
// rather than by a bundler. tsc does not read an import map and there is no
// @types package for a vendored file. See vendor/README.md.
import MarkdownIt from "markdown-it";

/** The slice of a markdown-it token this file touches. Stated rather than
 *  imported, because the vendored file ships no types.
 * @typedef {object} Token
 * @property {string} type
 * @property {string} info
 * @property {string} content
 * @property {(name: string) => string | null} attrGet
 * @property {(name: string, value: string) => void} attrSet
 * @property {(name: string, value: string) => void} attrJoin
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Exported because dom.js cannot have it — a sibling may not be imported — and
 *  anything interpolating a value from the vault into markup needs it. An
 *  aria-label built from a page's own text is the case that bit the mock.
 * @param {string} text
 * @returns {string} */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ESC[/** @type {keyof typeof ESC} */ (c)] ?? c);
}

const it = new MarkdownIt({
  // The safety property. Raw HTML in the source is escaped, never passed on.
  html: false,
  // A bare URL in prose is a link. Nobody writing notes types the brackets.
  linkify: true,
  // OFF, and it is a decision: a documents product must not silently rewrite
  // somebody's punctuation. Their quotes are theirs.
  typographer: false,
  // A single newline is a wrap, not a break. Otherwise every rewrapped
  // paragraph in a vault file changes what the page looks like.
  breaks: false,
});

/* ── the fence ─────────────────────────────────────────────────────────── */

/** An info string reduced to one class-safe word. The fence's own word is the
 *  only thing another module keys off, so it may not carry quotes out of the
 *  source into an attribute.
 *  @param {string} info @returns {string} */
const langOf = (info) =>
  (String(info).trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9+#._-]/g, "");

/** @param {Token[]} tokens @param {number} idx @returns {string} */
function fence(tokens, idx) {
  const token = tokens[idx];
  if (!token) return "";
  const lang = langOf(token.info || "");
  const open = lang ? `<pre><code class="language-${lang}">` : "<pre><code>";
  return `${open}${escapeHtml(token.content)}</code></pre>\n`;
}

/** An indented block is code too, and takes the same shape so one selector
 *  finds both. @param {Token[]} tokens @param {number} idx @returns {string} */
function codeBlock(tokens, idx) {
  return `<pre><code>${escapeHtml(tokens[idx]?.content ?? "")}</code></pre>\n`;
}

it.renderer.rules.fence = fence;
it.renderer.rules.code_block = codeBlock;

/* ── the link ──────────────────────────────────────────────────────────── */

/** Anything that names a scheme or an authority, which is everything that can
 *  leave this workspace. A relative href and a `#anchor` cannot. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** No `target`. A workspace link opens where the reader is, and a document that
 *  decided otherwise for every link would be taking a navigation decision that
 *  belongs to the host. `rel` is still owed: a middle-click opens a new tab
 *  whatever the markup said, and that tab gets a live `window.opener`.
 *  @param {Token[]} tokens @param {number} idx @param {any} options
 *  @param {any} env @param {any} self @returns {string} */
function linkOpen(tokens, idx, options, env, self) {
  const token = tokens[idx];
  if (token && EXTERNAL.test(token.attrGet("href") || "")) {
    token.attrSet("rel", "noopener noreferrer");
  }
  return self.renderToken(tokens, idx, options);
}

it.renderer.rules.link_open = linkOpen;

/* ── the picture ───────────────────────────────────────────────────────── */

/** Where this workspace's assets are, as an absolute url ending in `/`.
 *
 *  Set once by the composition root, which is the only module that knows which
 *  folder this tab is. Module state, deliberately: the alternative is threading
 *  a string through every render and every block draw to reach `md()`, for a
 *  value that is fixed before the first character is rendered and cannot change
 *  while the tab exists. */
let assets = "";

/** @param {string} url */
export function useAssets(url) {
  assets = url === "" || url.endsWith("/") ? url : url + "/";
}

/** markdown-it's own image rule, which does one thing this must not lose: it
 *  renders the alt text out of the token's children before emitting the tag. A
 *  replacement that called `renderToken` directly would silently empty every
 *  alt attribute in the workspace. */
const defaultImage = /** @type {(t: any, i: number, o: any, e: any, s: any) => string} */ (
  it.renderer.rules.image
);

/** A picture in prose names a FILE, and the host knows where the folder is.
 *
 *  `![The finished kitchen](kitchen.jpg)` has to reach `assets/kitchen.jpg` in
 *  this workspace, and left alone it does not: the host document's base url is
 *  the app's own address — `/?vault=…` — so a bare filename asks the server for
 *  `/kitchen.jpg` and misses the workspace entirely. Measured, not assumed.
 *
 *  So the src is rewritten here rather than written correctly by the author. The
 *  author cannot write it correctly: the url carries the workspace's absolute
 *  path, and a page that hardcoded that would break the moment the same folder
 *  was opened from another machine. A filename is the only portable thing to
 *  write down, which makes resolving it the host's job.
 *
 *  A url that names a scheme, an authority or a root is left exactly as it is —
 *  that is somebody pointing somewhere on purpose.
 *  @param {Token[]} tokens @param {number} idx @param {any} options
 *  @param {any} env @param {any} self @returns {string} */
function image(tokens, idx, options, env, self) {
  const token = tokens[idx];
  const src = token ? token.attrGet("src") || "" : "";
  if (token && assets !== "" && src !== "" && !EXTERNAL.test(src) && !src.startsWith("/")) {
    token.attrSet("src", assets + src.replace(/^\.\//, ""));
  }
  return defaultImage(tokens, idx, options, env, self);
}

it.renderer.rules.image = image;

/* ── the table ─────────────────────────────────────────────────────────── */

// R28: wide content scrolls inside its own box, never the page. A workspace
// that is half spreadsheet meets a table wider than the measure on day one.
it.renderer.rules.table_open = () => '<div class="mdscroll">\n<table class="mdtable">\n';
it.renderer.rules.table_close = () => "</table>\n</div>\n";

/** A cell worth right-aligning: a figure, with the marks a figure carries. */
const NUMERIC = /^[-+]?[$£€¥]?\d[\d,]*(?:\.\d+)?\s*%?$/;

/** Mark the columns whose body is entirely figures. markdown-it aligns only
 *  what the author wrote `---:` under, and the alignment a table of numbers
 *  needs most is the one nobody remembers to write.
 *  @param {{ tokens: Token[] }} state */
function numericColumns(state) {
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]?.type !== "table_open") continue;

    /** @type {Token[][]} */ const cells = [];
    /** @type {string[][]} */ const body = [];
    let col = -1;
    let inBody = false;
    let j = i + 1;

    for (; j < toks.length && toks[j]?.type !== "table_close"; j++) {
      const t = toks[j];
      if (!t) continue;
      if (t.type === "tbody_open") inBody = true;
      else if (t.type === "tbody_close") inBody = false;
      else if (t.type === "tr_open") col = -1;
      else if (t.type === "th_open" || t.type === "td_open") {
        col += 1;
        (cells[col] ||= []).push(t);
        if (inBody) (body[col] ||= []).push((toks[j + 1]?.content ?? "").trim());
      }
    }

    for (let c = 0; c < cells.length; c++) {
      const seen = (body[c] ?? []).filter(Boolean);
      if (!seen.length || !seen.every((v) => NUMERIC.test(v))) continue;
      for (const t of cells[c] ?? []) t.attrJoin("class", "num");
    }
    i = j;
  }
}

it.core.ruler.push("numeric_columns", numericColumns);

/* ── what a render spends ──────────────────────────────────────────────── */

/**
 * A markdown document as HTML. Headings, paragraphs, lists nested and ordered,
 * tables, fenced and indented code, links, images, blockquotes and rules.
 * @param {string} text
 * @returns {string}
 */
export function md(text) {
  return it.render(String(text));
}

/**
 * One line of markdown, without the paragraph around it — a caption, a name, a
 * heading a render re-cuts. Same escaping, same refused links.
 * @param {string} text
 * @returns {string}
 */
export function inline(text) {
  return it.renderInline(String(text));
}
