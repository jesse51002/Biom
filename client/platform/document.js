// SPDX-License-Identifier: AGPL-3.0-only
// The document the box loads for a page, with the runtime woven into its head.
// Layer 6, because two layers above it both build one: the page VIEW for the
// page in the pane, and the BRIDGE when a box asks to draw another page inside
// itself (`page.embed`). The shared thing moves down — that is the whole rule.
//
// WHY THE DOCUMENT IS THE SAME FOR EVERY PAGE IN ONE VAULT. It carries no page
// content at all — the runtime asks for that over its port once it has one. That
// is what makes `frameHost.for(key, html, ctx)` reuse an existing box across a
// redraw: the html is byte-identical every time, so only a changed CONTEXT tears
// a frame down, and the box the user is typing in survives a repaint of the rail.
//
// IN ONE VAULT, because the plugin tags now name the vault's own `/plugin/`
// route. A TAB IS ONE VAULT — it is in the url and settled in `boot.js` before
// anything is constructed — so the string is still byte-identical everywhere it
// is compared and nothing about frame reuse changes. The sentence is narrower
// than it was; the property it was protecting is not.
//
// THE ORDER OF THESE TAGS IS THE ONLY SEQUENCING THERE IS. They are classic
// scripts sharing globals — a module script does not load at an opaque origin —
// so `guest/runtime/boot.js` states the required order in its own header and
// this list obeys it. `weave()` in `frame.js` puts the shim ahead of all of
// them, because the shim is what asks for the ports.

import { vaultBase } from "../../contracts/wire.js";

/** The vendored UMD build and never the `.mjs`: a MODULE script does not load in
 *  a `sandbox="allow-scripts"` frame with no `allow-same-origin`. Measured, and
 *  re-measured when this build was vendored — a module script fetched from this
 *  same `/vendor/` is refused by CORS from `origin: null`. */
const VENDOR = ["/vendor/markdown-it.min.js"];

/** The runtime, in the order its own boot file documents. */
const RUNTIME = [
  "/guest/runtime/registry.js",
  "/guest/runtime/effects.js",
  "/guest/runtime/sections.js",
  "/guest/runtime/scale.js",
  // Before boot.js, which reaches for `rt.project` the moment a page is drawn.
  "/guest/runtime/project.js",
  "/guest/runtime/boot.js",
  // AFTER boot.js and not before: the edit wave builds on `rt.page`, which
  // boot.js is what declares.
  "/guest/runtime/edit.js",
];

/** THE SLOT PLUGINS: the framework's own and the ones the person wrote or
 *  overrode, as ONE script. The server answers `/v/<enc>/plugin/` with the
 *  framework's `*.js` minus every name the vault's `plugins/` also has, then the
 *  vault's own — so a vault file shadows the framework's by name, and a vault
 *  with no `plugins/` at all draws with the framework's set. What a person can
 *  read is the mirror in `docs/plugins/`; what they can change is a copy of it
 *  in `plugins/`.
 *
 *  THERE IS NO LONGER A LIST OF IDS HERE, and that is the whole of the loader.
 *  This file used to name a fixed handful — `markdown`, `html`, `table`, `child`
 *  — and a workspace's OWN slot plugin could not be reached at all, because
 *  nothing told this file which of them a workspace had. It asks now: the FOLDER
 *  is a url on the route that already serves what is in it, and the server
 *  answers it with every `plugins/*.js` concatenated in id order. One tag, one
 *  request, one execution order, and a vault-authored `plugins/mine.js` loads
 *  with no document overridden and nothing registered from a section script.
 *
 *  IT IS STILL BYTE-IDENTICAL PER VAULT. The tag is a url and not a listing, so
 *  adding a plugin does not change this string and nothing about frame reuse
 *  changes.
 *
 *  THE PART KINDS ARE UNAFFECTED BY THE ORDER, and that is a property of the
 *  registry rather than of this list. `markdown`, `html`, `table`, `child` and
 *  `grid` are drawn by `plugins/<kind>.js` and by no other file — the vault's own copy,
 *  or the person's edit of it — so a file named to sort first cannot take one.
 *  A second file claiming the name is refused in a sentence that says so. */

/** Where this vault's plugins are served from, absolute. `vaultBase` is the one
 *  spelling both sides read.
 *  @param {string} vault the absolute path of the folder this tab is on */
const pluginBase = (vault) => `${vaultBase(vault)}/plugin/`;

/** THE RUNTIME IS FURNITURE, injected into whatever document draws the page.
 *
 *  A page states which plugin draws it and the server resolves that to markup —
 *  the page's own `index.html`, or the vault's plugin's. Either way the scripts
 *  above have to be in it, and they are spliced in here rather than spelled out
 *  by each document: two lists held together by hand is two lists that disagree,
 *  and the one that fell behind would be somebody else's page failing to draw. */
/** @param {string} vault */
const headTags = (vault) =>
  [...VENDOR, ...RUNTIME, pluginBase(vault)]
    .map((src) => `<script src="${src}"></script>`)
    .join("");

/** A PLUGIN DOCUMENT NAMING ITS OWN SIBLING, and it is the one thing a file in a
 *  vault cannot spell for itself.
 *
 *  `plugins/kanban/index.html` has to load `plugins/kanban/kanban.js`. It cannot
 *  say `/guest/plugins/biom-kanban/kanban.js`, which is what it said when it was
 *  shipped: a path into an install directory, written into a person's folder, is
 *  wrong the first time they move the application. It cannot say a RELATIVE path
 *  either — the box is a `srcdoc` frame at an opaque origin and has no base to
 *  resolve one against. And it cannot say the absolute vault route, because the
 *  file is written to disk long before anybody knows which folder it landed in.
 *
 *  So it says the path RELATIVE TO `plugins/` and marks it, and the host — which
 *  is the half that knows the vault — turns the mark into a real `src` as it
 *  weaves. A `<base href>` was the alternative and was rejected: it would change
 *  relative resolution for a page author's own markup too, including every link
 *  they wrote.
 *
 *  @param {string} html @param {string} vault */
const resolveSiblings = (html, vault) =>
  html.replace(/\sdata-g-src\s*=\s*"([^"]*)"/g, (_, rel) => ` src="${pluginBase(vault)}${rel}"`);

/** The document the box loads for one page, with the runtime woven into its
 *  head.
 *
 *  IT ALWAYS ANSWERS A DOCUMENT WITH A `<head>` IN IT, and that is not tidiness.
 *  `frame.js` weaves the shim in next and falls back, for a document with no head
 *  and no `<html>`, to wrapping the whole string in a `<body>` — which would put
 *  every runtime script inside the body of a document nested in another one.
 *  Measured: the page drew nothing and reported nothing, with no error anywhere,
 *  because the scripts were markup by then.
 *
 *  So the three branches mirror `weave()`'s own, in the same order and for the
 *  same reason: a page's document is the author's file and may open however they
 *  wrote it.
 *  @param {string} html the page's own document, or "" for the bare one
 *  @param {{id: string, name: string, plugin: string, input: Record<string, unknown>}} input
 *  @param {string} vault the absolute path of the folder this tab is on. The
 *    plugins are files in it, so the document cannot be built without knowing
 *    which folder it is being built for.
 *  @returns {string} */
export function weaveRuntime(html, input, vault) {
  const tags = headTags(vault) + inputTag(input);
  if (typeof html !== "string" || html.trim() === "") return `<!doctype html><html><head><meta charset="utf-8">${tags}</head><body></body></html>`;
  html = resolveSiblings(html, vault);
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tags + html.slice(at);
  }
  const open = html.match(/<html[^>]*>/i);
  if (open && open.index !== undefined) {
    const at = open.index + open[0].length;
    return html.slice(0, at) + "<head>" + tags + "</head>" + html.slice(at);
  }
  // No envelope at all: the author wrote markup rather than a document, so one
  // is built around it. Their own `<!doctype>` and `<meta>` come off first — a
  // second doctype inside a body is what makes a browser quietly give up.
  const body = html
    .replace(/^\s*<!doctype[^>]*>/i, "")
    .replace(/<meta\s+charset[^>]*>/i, "")
    .trim();
  return `<!doctype html><html><head><meta charset="utf-8">${tags}</head><body>${body}</body></html>`;
}

/** WHAT THE PAGE IS, inlined ahead of its own code.
 *
 *  A page that draws itself needs its input synchronously — a board that had to
 *  ask what table it is would draw an empty frame first — so it travels in the
 *  document rather than over a port. `</` is escaped because a string ending a
 *  script tag early is the one way an inlined value can break the page around it.
 *  @param {{id: string, name: string, plugin: string, input: Record<string, unknown>}} input */
function inputTag(input) {
  const json = JSON.stringify(input).replace(/<\//g, "<\\/");
  return `<script>window.__gInput=${json}<\/script>`;
}
