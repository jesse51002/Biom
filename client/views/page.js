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
 * The design doc, drawn by the same runtime as every other page — and read
 * through the server like every other page.
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
 * exactly as it draws a page.
 *
 * WHAT USED TO BE MISSING WAS THE PAGE'S OWN DOCUMENT, and it is not any more.
 * This view wove an empty document, because the shell's snapshot held no
 * design page to read an `html` off — so the `doc` document's own file never
 * loaded here, and nothing the vault wrote in a rung over it could reach the
 * design doc. The shell reads `@design` through the store now like any other
 * page, and hands the read here: the document the server resolved, the `doc`
 * plugin's with its two nodes and its rungs, or a `design/index.html` of the
 * vault's own. So this is `makePageView` under another name, kept as a name
 * because the route is a different route and the box is keyed apart.
 *
 * @param {PageViewDeps} deps
 * @returns {(page: Page) => HTMLElement}
 */
export function makeDesignView(deps) {
  return makePageView(deps);
}

/**
 * The map of the whole workspace, and it is the same mount as every other page.
 *
 * It is keyed `@map`, which is not a legal page id, and the server answers
 * `page.read` for it with a bare plugin page — no sections, no variables, the
 * `mindmap` plugin's document read out of the vault's own `plugins/` or the
 * framework's — so the runtime draws nothing over the plugin and everything
 * the plugin asks for over its port is an ordinary question about the
 * workspace. Its `input` says it is the rail's own map, which is how the
 * plugin knows there is no page to keep its settings on.
 *
 * THE DOCUMENT USED TO BE SAID AGAIN HERE, as `MAP_DOCUMENT`, held equal to the
 * plugin's file by a test — because the host cannot import `guest/` and this
 * view had no page read to take an `html` off. It has one now: the shell
 * reads `@map` through the store, and what draws is what the server
 * resolved, the vault's own `mindmap` included.
 *
 * @param {PageViewDeps} deps
 * @returns {(page: Page) => HTMLElement}
 */
export function makeMapView(deps) {
  return makePageView(deps);
}
