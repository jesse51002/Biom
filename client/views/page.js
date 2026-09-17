// SPDX-License-Identifier: AGPL-3.0-only
// The page view, which no longer draws a page. Layer 14.
//
// This file used to be the largest in the client: it walked `Page.blocks`, asked
// a `Registry` for a `BlockDraw` per `BlockKind`, wrapped the result in the
// chosen `Render`'s frame, and ran an in-place prose editor over the top. All
// four of those nouns are gone. A page is a stack of SECTIONS now, and the thing
// that stacks them is `guest/runtime/`, which lives INSIDE the box.
//
// So the host's job here is to build the document that loads that runtime and
// hand it to the frame host. Everything that was drawing is on the other side of
// an opaque origin, where this file cannot reach it and does not need to.
//
// THE DOCUMENT ITSELF IS `client/platform/document.js` — `weaveRuntime`, the
// runtime tags and their order — because the bridge builds the same document
// when a box asks to draw another page inside itself, and a view and the bridge
// may not reach each other.

/** @import { FrameHost, Page, PageId, UiStore } from "../../contracts/types.ts" */

import { DESIGN_PAGE, MAP_PAGE } from "../../contracts/wire.js";
import { weaveRuntime } from "../platform/document.js";
/** @import { Workspace } from "../store/workspace.js" */
/** The DOM helper, typed the way every other view in this layer types it:
 *  `dom.js` exports a function rather than a type, so each caller states the
 *  shape it uses.
 *  @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/**
 * @typedef {object} PageViewDeps
 * @property {H} h
 * @property {FrameHost} frameHost
 * @property {Workspace} ws
 * @property {UiStore} ui
 * @property {string} vault WHICH FOLDER THIS TAB IS, absolute. The plugins are
 *   files in it, so the document a box loads cannot be built without it. It is
 *   settled in `boot.js` before anything is constructed and never moves again.
 */

/**
 * A page is one box, keyed by the page's own id.
 *
 * The key is the id and not the id plus a revision on purpose: a new key is a
 * new element, and a new element is the user's caret thrown away. When a page's
 * content moves, the runtime is told over its port and re-reads; the box itself
 * is not rebuilt.
 *
 * @param {PageViewDeps} deps
 * @returns {(page: Page) => HTMLElement}
 */
export function makePageView(deps) {
  const { frameHost, vault } = deps;

  return function draw(page) {
    // THE IFRAME ITSELF, WITH NO WRAPPER, AND THAT IS NOT TIDINESS. Moving an
    // iframe to a new parent RELOADS IT — the browser tears the document down
    // and starts again. So wrapping the reused element in a fresh div on every
    // repaint hands the shell a node it has never seen, the shell inserts it,
    // and the box is rebuilt from nothing: measured as every runtime script
    // fetched twice, the first fetch aborted mid-flight.
    //
    // Returning the element `frameHost` already keyed makes the shell's
    // `plate.firstChild !== node` guard able to fire at all, which is the whole
    // reason that guard is written the way it is.
    // THE DOCUMENT IS THE PAGE'S, not one constant for every page. `frameHost`
    // keys on the html it is given, so a page whose document changed is rebuilt
    // and one whose document is the same keeps the box it is drawn in — which is
    // what lets somebody go on typing through a repaint.
    const input = { id: page.id, name: page.name, plugin: page.plugin, input: page.input };
    return frameHost.for(page.id, weaveRuntime(page.html, input, vault), { page: page.id }).el;
  };
}

/**
 * The design doc, drawn by the same runtime as every other page.
 *
 * `design/` is a page-shaped root beside `pages/`, and it used to be the one
 * place the model was not whole: the runtime reads a page with `page.read`, the
 * doc answered to `design.read`, and `design.read` is in `ApiRequest` and
 * deliberately not in `RuntimeRequest` — so this view fetched the doc and
 * rendered it host-side, read-only, outside everything the box provides.
 *
 * The id is what closed it, and the separation `design.*` existed for is kept:
 * a user may perfectly well keep a page of their own called `design`, so the
 * doc answers to `@design` instead, which no page segment can spell. `pageDir`
 * sends that id to `design/`, so `page.read` reaches it and the runtime draws it
 * exactly as it draws a page — which is what this view now mounts, and nothing
 * else. The `design.*` kinds still answer on `ApiRequest`; nothing in the client
 * calls them.
 *
 * WHAT IS STILL MISSING IS THE PAGE'S OWN DOCUMENT, and it is named here rather
 * than left to be found. The shell's snapshot draws `pages/`, so it holds no
 * design page for this view to take an `html` off — so the document woven below
 * is the empty one and a `design/index.html` (which the server WOULD resolve) is
 * never loaded. A design doc is therefore always a stack of sections drawn by
 * the `doc` plugin. Closing it is the shell reading `@design` through the store
 * like any other page and handing the result to `makePageView`; it needs no
 * barrier and nothing yet wants it.
 *
 * @param {PageViewDeps} deps
 * @returns {() => HTMLElement}
 */
export function makeDesignView(deps) {
  const { frameHost, vault } = deps;

  /**
   * THE DESIGN DOC IS A PAGE, AND THIS IS THE SAME MOUNT AS EVERY OTHER PAGE.
   *
   * It used to render host-side: `design.read` was fetched, its markdown parts
   * were turned into HTML in the host document, and the result was read-only,
   * unpadded, and outside everything the box provides. It had no section
   * runtime, so no sections and no drag; no type scale, because the scale is
   * declared inside the box; and no editing, because the edit wave lives there
   * too. The design language of a workspace was the one document in it nobody
   * could write in.
   *
   * It is keyed `@design`, which is not a legal page id, so `pageDir` sends it
   * to `design/` and everything else in the page machinery reaches it unchanged.
   * There is nothing here but the key: the same document, the same runtime, the
   * same everything.
   */
  return function draw() {
    // The bare document, not the doc plugin's file: the runtime makes its own
    // `#g-page` when a document does not carry one, so a doc page needs nothing
    // in its body — and reaching for the plugin's file here would mean fetching
    // it before the design doc could be drawn at all.
    return frameHost.for(DESIGN_PAGE, weaveRuntime("", {
      id: DESIGN_PAGE, name: "Design", plugin: "doc", input: {},
    }, vault), { page: DESIGN_PAGE }).el;
  };
}

/** THE MAP'S DOCUMENT, and it is the `mindmap` plugin's own `index.html` said
 *  again: the host cannot import `guest/`, and the box cannot fetch, so the one
 *  string has to be written here. `tests/mindmap.test.js` holds the two equal,
 *  which is what stops them drifting apart — and that equality is now also what
 *  keeps this copy honest about `data-g-src`, since the plugin is a file in the
 *  vault and neither copy may name an install directory. */
export const MAP_DOCUMENT = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Map</title>
    <!-- The runtime's own tags are spliced in by the host, the same way they are
         for every page; this document names only what is its own.

         \`data-g-src\` IS A PATH UNDER THIS VAULT'S OWN \`plugins/\`, and the host
         turns it into a real \`src\` as it weaves. This file is a copy in
         somebody's folder: it cannot name the install directory, it has no base
         to resolve a relative path against inside the box, and it was written to
         disk before anybody knew which folder it landed in. -->
    <script data-g-src="biom-mindmap/mindmap.js"></script>
  </head>
  <body><main id="g-map"></main></body>
</html>
`;

/**
 * The map of the whole workspace, and it is the same mount as every other page.
 *
 * It is keyed `@map`, which is not a legal page id, and the server answers
 * `page.read` for it with a bare plugin page — no sections, no variables, and
 * `MAP_DOCUMENT` above rather than anything read out of a vault — so the runtime
 * draws nothing over the plugin and
 * everything the plugin asks for over its port is an ordinary question about
 * the workspace. Its `input` says it is the rail's own map, which is how the
 * plugin knows there is no page to keep its settings on.
 *
 * @param {PageViewDeps} deps
 * @returns {() => HTMLElement}
 */
export function makeMapView(deps) {
  const { frameHost, vault } = deps;
  return function draw() {
    return frameHost.for(MAP_PAGE, weaveRuntime(MAP_DOCUMENT, {
      id: MAP_PAGE, name: "Map", plugin: "mindmap", input: { rail: true },
    }, vault), { page: MAP_PAGE }).el;
  };
}

