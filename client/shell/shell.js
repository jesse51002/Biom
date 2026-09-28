// SPDX-License-Identifier: AGPL-3.0-only
// The chrome, and the router. Layer 15.
//
// The rail across the top, the rack down the left, the canvas in the middle, the
// strip along the bottom, and the decision about which view is drawn into the
// canvas. It constructs nothing: `boot.js` hands it the stores, the frame host
// and every view already built.
//
// AND, IN THE BUILT APPLICATION ONLY, THE WINDOW'S OWN TITLE BAR ABOVE ALL OF
// IT. The application is frameless on every desktop and draws its own bar —
// the mark, the workspace's name, minimise, maximise, full screen and close —
// so the controls are the same on every machine rather than whatever the window
// manager chose to show. What decides is `window.biomShell.windowControls`
// being there; in a browser it is not, the bar is not built, and the page is
// exactly what it was. `windowBridge()` below is the whole test.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THIS FILE EXISTS TO KEEP
// ─────────────────────────────────────────────────────────────────────────────
//
// **A repaint must not re-insert a node the canvas is already holding.** Moving
// an iframe in the DOM reloads it, so a repaint that puts the page root back
// restarts every artifact on the page — on every keystroke, because typing prose
// writes through the store and the store emits. That is the difference between a
// workspace and a page that flickers while you use it.
//
// The rule is held in two places and needs both. Here: the skeleton is built
// once and kept, `bodyOf` is never called speculatively — `inputs()` below is
// the whole test, and it is object identity rather than a deep compare because
// the workspace store already replaces the objects it changes and leaves the
// ones it did not alone — and the node it hands back is inserted ONLY when it is
// not the node already there. And in `views/page.js`: a page is built once and
// patched, so it hands back the SAME root across every write and a change
// reaches the DOM as an edit to one section rather than as a new tree.
//
// Neither half is sufficient. A shell that skipped the repaint would still have
// to guess which writes a page can see, and that list only ever grows; a view
// that patched in place would still be torn out by a shell that re-inserted it.
//
// ONE CONSEQUENCE, LOAD-BEARING.
//
// The chrome bars ARE rebuilt on every repaint, and that is free: nothing in any
// of them is a frame, an input or a caret.
//
// The rack's WIDTH is not rebuilt with them. `rack.js` owns one custom property
// on `.app` and is asked to reconsider after the rows are refilled; it lays
// anything out only when the rows changed, and not at all once the width has
// been dragged. That is what keeps a drag from repainting the workspace and a
// repaint from arguing with a drag.

/** @import { Address, ChangeEvent, FrameHost, Page, PageId, PageScreen, TableView,
 *            UiState, VaultInfo, ViewName } from "../../contracts/types.ts" */
/** @import { Workspace } from "../store/workspace.js" */
/** @import { Ui } from "../store/ui.js" */
/** @import { AgentChrome } from "../views/agent.js" */

import { DESIGN_PAGE, MAP_PAGE } from "../../contracts/wire.js";
import { VIEW_NAMES, formatAddress, parseAddress, sameAddress } from "../../contracts/address.js";
import { remember } from "../platform/dom.js";
import { closePopover, popItem, popover } from "../widgets/popover.js";
import { ROOT_PAGE } from "../store/workspace.js";
import { NOT_TOUCH } from "../store/switcher.js";
import { agentMode } from "../store/chats.js";
import { changeOf } from "../transport/chat.js";
// THE ADDRESS OF THE START PAGE, from the module that owns every other address a
// workspace has. `Close workspace` and the picker's own rows are the two
// directions of one move — into a folder and out of it — and an address built
// twice is an address that drops the token in one of the two places.
import { closeHref } from "../views/vault.js";
import { makeDialog } from "./dialog.js";
import { makeRack } from "./rack.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */
/** @typedef {(el: HTMLElement, ...content: any[]) => HTMLElement} Fill */

/**
 * Every view, already built. They arrive as functions rather than as modules so
 * that swapping one is a changed line in `boot.js` and nothing in here.
 * @typedef {object} ShellViews
 * @property {() => HTMLElement} tree
 * @property {(page: Page) => HTMLElement} page
 * @property {(view: TableView | null) => HTMLElement} table
 * @property {() => HTMLElement} vault
 * @property {(page: Page) => HTMLElement} design THE DESIGN DOC, as the page
 *   read the store made of `@design`.
 * @property {(page: Page) => HTMLElement} map THE MAP, as the page read the
 *   store made of `@map`.
 * @property {() => HTMLElement} runs THE OVERVIEW: running now, finished, Start.
 * @property {{ vault: () => HTMLElement, page: (page: Page) => HTMLElement }} instructions
 *   the workspace's INSTRUCTIONS.md with its skills, and a page's own.
 * @property {(page: Page) => HTMLElement} automation a page's automations:
 *   manifest, files, runs.
 * @property {() => HTMLElement | null} [goback] **GO BACK TO**, or null while
 *   there is nothing of the person's to go back to. Mounted at the top left of
 *   the canvas. Absent where no switcher is built — a tab with no workspace, a
 *   test that is not about it.
 * @property {ShellAgent} [agent] THE AGENT SCREEN, and the chat panel
 *   beside a page. Absent in a tab with no workspace and in a test that is not
 *   about it, where the route holds a sentence.
 */

/**
 * THE AGENT SCREEN AS THE SHELL HOLDS IT. `slot` is ONE element — the look's
 * box and Biom's input box over it — which the shell puts in the bed once,
 * beside the canvas, and never moves: moving an iframe reloads it. Where it
 * shows is the bed's `data-agent`: the whole screen on `#/agent`, the panel
 * beside whatever else is on screen while the panel is open, nowhere
 * otherwise.
 * @typedef {object} ShellAgent
 * @property {HTMLElement} slot
 * @property {() => void} open The rail's **Agent**: the full screen, and the
 *   chat this window last had open.
 * @property {(page: PageId) => void} edit **Edit**: a new chat beside the
 *   page with the page's location typed in.
 * @property {() => AgentChrome} chrome The busy count, the open chat and the
 *   counts the chrome shows.
 */

/**
 * @typedef {object} ShellDeps
 * @property {H} h
 * @property {Fill} fill
 * @property {Workspace} ws THE STORE PLUS THE TREE READS. The dialog makes a
 *   table and then places it, which is `moveChild` — the same write the rail
 *   makes when you drag one — and that lives on the store rather than in the
 *   frozen contract.
 * @property {Ui} ui WHERE THE PERSON IS. Every control in here that takes them
 *   somewhere is THEIR open — the rail, a crumb, a hit, Home, Back — and only a
 *   workspace failing to open moves them without being asked (`trouble`).
 * @property {() => void} [touched] THE PERSON TOUCHED THE SCREEN the host
 *   draws itself — a click, a key or a scroll on the canvas, anywhere not
 *   marked `NOT_TOUCH`. A box says its own through the frame host. Absent where
 *   no switcher is built.
 * @property {FrameHost} frameHost
 * @property {ShellViews} views
 * @property {string} [newerVersion] A NEWER RELEASE THAN THIS ONE, by name, or
 *   absent. The server learned it from biom.dev on the way up and the document
 *   carried it here; the strip says it in one line and links the install steps,
 *   because a person who built from the repository has no other way to hear a
 *   tag was cut. It is a fact about the launch, so it goes on the end of the
 *   strip whatever the route, the way the versions line does.
 * @property {boolean} [production] WHICH BUILD THIS IS, and the only thing the
 *   chrome knows about it: what the status strip reports, and whether the
 *   failure screen may name `make dev`. Every screen and every row is in every
 *   build — the owner decided on 2026-09-17 that the built application hides no
 *   screen — so nothing here is a second code path. Absent means development.
 * @property {{ on: (hear: (data: string | null) => void) => () => void }} [events]
 *   THE VAULT CHANGING ON DISK, as a subscription rather than an import: data
 *   ascends through a callback a higher layer registered, and nothing below
 *   the shell holds a reference to anything above it. Each `change` hands up
 *   its data — the pages and levels it names, decoded here by `changeOf` —
 *   and a reconnect hands up null, which rereads everything the window holds.
 *   Optional, because a tab that has chosen no folder has no stream and
 *   because most tests that build a shell are not about this.
 * @property {string} [search] THE QUERY THIS WINDOW WAS OPENED WITH, which the
 *   rail's `Close workspace` row carries forward minus the folder. Defaults to
 *   the real one, and to "" where there is no window at all.
 */

/** The route vocabulary, so a hash somebody typed cannot invent a view.
 *
 *  Exported for the test that holds it and the rail in agreement: a view is
 *  reachable by typing and reachable by clicking, and the two lists are in
 *  different halves of this file. A test that hand-copied either would be a
 *  third list. IT IS `VIEW_NAMES` NOW, from `contracts/address.js`, typed
 *  there so it cannot differ from `ViewName`: the switcher and the history
 *  route to the same addresses the shell does, and one vocabulary is read by
 *  all three.
 *  @type {ReadonlySet<string>} */
export const VIEWS = VIEW_NAMES;

/** THE WINDOW'S OWN BAR, AND WHETHER THERE IS A WINDOW TO PUT ONE ON.
 *
 *  The owner decided on 2026-09-14 that the application draws its own title bar
 *  rather than wearing the desktop's, the way VS Code, Discord and Slack do.
 *  The reason is that the desktop's bar is not the same bar twice: GNOME hides
 *  the maximise button by default, offers no full-screen button at all, and
 *  puts close on whichever side its settings say. Ours is the same everywhere,
 *  in the product's own type, and its labels are ours to write.
 *
 *  WHAT DECIDES IS `window.biomShell.windowControls` BEING THERE, which is the
 *  same test the picker makes about `chooseFolder` and for the same reason: a
 *  browser has no `biomShell`, so `make dev` in a tab draws no bar and is
 *  exactly the page it was. It is read ONCE, when the shell is built, because
 *  the skeleton is built once — a bridge cannot appear halfway through a
 *  session, and a bar that came and went on a repaint would take the canvas
 *  with it.
 *  @returns {any} the bridge, or null
 */
function windowBridge() {
  const on = /** @type {any} */ (globalThis);
  const bridge = on && on.biomShell;
  return bridge && bridge.windowControls ? bridge : null;
}

/** What the bar says when a close is held over a live run. Spelled once, so
 *  the end-to-end suite can find the strip by its words. */
export const CLOSE_WORDS = Object.freeze({
  alive: (/** @type {number} */ n) => n === 1 ? "1 automation is running. Closing ends it." : `${n} automations are running. Closing ends them.`,
  yes: "End them and close",
  no: "Keep them running",
});

/**
 * @param {ShellDeps} deps
 */
export function makeShell(deps) {
  const { h, fill, ws, ui, frameHost, views, events } = deps;
  const production = deps.production === true;
  const newerVersion = typeof deps.newerVersion === "string" ? deps.newerVersion.trim() : "";

  /** THE QUERY THIS WINDOW WAS OPENED WITH, and all `Close workspace` needs: the
   *  start page is this same address with the folder taken out of it. Read once,
   *  the way the picker reads it, so a test can state what a window this module
   *  did not open has to keep. */
  const search = deps.search ?? (typeof location === "undefined" ? "" : location.search);

  const dialog = makeDialog({ h, ws, ui });
  // The rail's width. It owns one custom property on `.app` and nothing else in
  // here has an opinion about it — which is what keeps a drag from repainting
  // anything, and a repaint from arguing with a drag.
  const sizer = makeRack({ h });

  /* ── the skeleton, built once and kept ─────────────────────────────────── */

  const rail = h("div.rail");
  const rack = h("nav.rack", { "aria-label": "Workspace" });
  const plate = h("div.plate");
  /** WHERE **GO BACK TO** SITS: the top left of the canvas, over whatever the
   *  screen is, after the plate so the plate keeps its place among the
   *  canvas's children. NOT A TOUCH: pressing it must not first make the
   *  screen it offers a way out of the person's, which would take the button
   *  away between the press and the click. */
  const backslot = h("div.backslot", { [NOT_TOUCH]: "" });
  const canvas = h("div.canvas",
    h("i.reg.tl"), h("i.reg.tr"), h("i.reg.bl"), h("i.reg.br"), plate, backslot);
  // The grip sits in the bed rather than in the rack: the rack scrolls, and a
  // handle that scrolls out of view is a handle nobody finds twice.
  // THE AGENT SCREEN'S SLOT, after the canvas and put here once: its shape is
  // the bed's grid (`data-agent`), never a move.
  const bed = views.agent ? h("div.bed", rack, canvas, views.agent.slot, sizer.grip) : h("div.bed", rack, canvas, sizer.grip);
  /** WHAT THE PLATE HOLDS ON THE AGENT SCREEN: nothing, kept. The canvas is
   *  not drawn there — the slot takes its column. */
  const agentHole = h("div.agenthole");
  const strip = h("div.strip");

  /** The window's own bar, or null in a browser. Read once: see `windowBridge`.
   *  The double-click is here rather than on a control because the whole bar is
   *  a drag region and a drag region on Linux has no window manager behind it
   *  to do this for us; the controls stop it bubbling so a double press on
   *  Close is not also a maximise.
   *  @type {any} */
  const bridge = windowBridge();
  const titlebar = bridge === null ? null : h("header.titlebar", {
    ondblclick: () => void bridge.windowControls.toggleMaximize(),
  });
  // `.framed` is the row the bar needs, and it is a class rather than a second
  // skeleton: with no bridge the element is not built and nothing about the
  // page below it changes by a pixel.
  const app = titlebar === null
    ? h("div.app", rail, bed, strip)
    : h("div.app.framed", titlebar, rail, bed, strip);

  /** What the body was last built from. Identity, not equality. @type {unknown[]} */
  let built = [Symbol("nothing")];
  /** @type {HTMLElement | null} */ let dialogEl = null;
  /** The reload button is the change loop; it says so while it is working. */
  let reloading = false;
  /** SHARE IS ONE PRESS AND ONE LINK. The button says so while the server is
   *  capturing — a headless browser takes a few seconds — and the link lands
   *  in a menu hung from the button, with Copy and Open beside it. What the
   *  capture could not fold in is named there too, so the person can see what
   *  a stranger will not. Kept per page: navigating away drops it. */
  let sharing = false;
  /** @type {{ page: PageId, url: string, left: string[] } | null} */
  let shared = null;
  /** Why the last share did not happen, in a sentence, or "". */
  let shareSaid = "";
  /** How many times Reload has been pressed. The only screen that reads it is
   *  Design, whose doc is not in the snapshot and so cannot be seen to move. */
  let reloads = 0;
  /** What changed while a reload was already running, merged: one more pass
   *  rereads all of it, so two pending changes and one are one pass.
   *  @type {ChangeEvent | null} */
  let again = null;
  /** The page whose way down the rail has listed, so a repaint does not ask
   *  again — and a level that would not list is not asked for on every one. */
  let revealed = "";
  /** Set by boot when the workspace could not be read at all. @type {string} */
  let troubled = "";
  /** HOW MANY RUNS THE WINDOW WAS ASKED TO CLOSE OVER, or 0 when it was not.
   *  Set by the shell's push, cleared by either answer. @type {number} */
  let closing = 0;
  /** One outstanding read, so a repaint mid-fetch does not fire a second. */
  let awaiting = "";
  /** Which folder the workspace is, for the rail's foot. `WorkspaceSnapshot` is
   *  frozen and does not carry it, so it is read on its own.
   *  @type {VaultInfo | null} */
  let vault = null;
  /** The tree's version the name above was read against. Re-reading on a
   *  re-listed tree is what keeps it honest without a signal the contract does
   *  not have: the store moves its version whenever a level is listed, so a
   *  different number is the cheapest true test for "the folder may have
   *  moved". It costs one small request per level listed, create, move or
   *  install. @type {number} */
  let vaultFrom = -1;
  let vaultBusy = false;
  /** Ids the server answered "no such page" for. Without this, a route to a
   *  deleted page refetches it on every emit for as long as the tab is open. */
  const missing = new Set();
  /** @type {HTMLElement | null} */ let root = null;
  /** WHAT THE WINDOW CURRENTLY IS, so the maximise button wears the right icon.
   *  Read from the shell on mount and then pushed at, because F11, a
   *  double-click and a tiling manager all move it without a button of ours
   *  being pressed. */
  let maximized = false;
  let fullScreen = false;
  /** The mark, once the shell has handed it over. `app/` is not served, so it
   *  arrives as a data URL over the bridge rather than as a URL — an empty
   *  string is the honest answer and the bar draws its name alone. */
  let mark = "";
  /** The view a popover was last opened over. @type {ViewName | null} */
  let lastView = null;

  /* ── what the body is made of ──────────────────────────────────────────── */

  /**
   * The inputs of the view currently on screen, in a fixed order. Two arrays
   * that match by identity mean nothing the body can see has moved, so the body
   * is left exactly where it is — iframes and all.
   * @returns {unknown[]}
   */
  function inputs() {
    const u = ui.get();
    const w = ws.get();
    const r = u.route;
    // Before the trouble check, and both halves are deliberate. The picker is
    // the one screen that can FIX a workspace that did not open, so it is
    // reachable from the failure; and it is built once and never rebuilt, so its
    // inputs are constant — the list you are half-way through walking must not
    // be taken out from under the click that is still resolving.
    if (r.view === "vault") return ["vault", troubled];
    if (troubled) return ["trouble", troubled];
    switch (r.view) {
      case "page":
        // NOT `theme`: the vault's theme reaches the box as data over
        // `theme.get` and changes nothing about what a page is made of.
        // `pages` is here because a page draws its children, and a child renamed
        // or removed elsewhere changes what this page says without touching the
        // page object itself.
        return ["page", r.id, r.screen, w.page, u.inserting, w.pages, missing.has(r.id)];
      case "table":
        return ["table", r.id, w.table, w.pages];
      case "design":
        // THE DESIGN DOC IS READ LIKE A PAGE: `@design` is opened through the
        // store, and what the view takes is that read, so the inputs are the
        // page's — the read itself, and `pages`, because the doc plugin's
        // document reads its own rungs off the read and a redraw is a new one.
        return ["design", w.page, w.pages, missing.has(DESIGN_PAGE)];
      case "map":
        // THE MAP TOO: `@map` is a page read the server answers with the
        // mindmap plugin's document. The map reads the whole workspace itself,
        // over its port, and re-reads on every refresh the box is sent.
        return ["map", w.page, missing.has(MAP_PAGE)];
      case "runs":
        // The overview reads the registry itself and rereads on the stream and
        // on its own clock, so it is built once per entry into the route.
        return ["runs"];
      case "instructions":
        // The workspace's instructions and skills, read on entry and on Reload.
        return ["instructions", reloads];
      case "agent":
        // The Agent screen is the Agent view's own mount, built once and kept,
        // exactly as the overview is.
        return ["agent"];
      default:
        return ["none"];
    }
  }

  /** @param {unknown[]} a @param {unknown[]} b */
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

  /** @returns {HTMLElement} */
  function bodyOf() {
    if (ui.get().route.view === "vault") {
      // THE PICKER, AND WHAT HAPPENED TO THE FOLDER THAT DID NOT OPEN. A tab
      // whose workspace is gone, has become a file, cannot be read, holds a
      // `workspace.db` that is not a database or was written by an older build
      // lands HERE — the one screen that can open a different folder or make a
      // new one — and the sentence rides above it rather than on a screen of its
      // own with a button leading here. The picker itself is untouched: it is
      // built once and kept, and it is the same element either way.
      if (!troubled) return views.vault();
      return h("div.vaulttrouble", h("p.oops", troubled), views.vault());
    }
    if (troubled) {
      // THE REASON STAYS IN BOTH BUILDS, because it is honest and it is what the
      // failure actually produced. What differs is the way out.
      //
      // `make dev` is a correct instruction to exactly one person:
      // whoever has this repository checked out and a server that has fallen
      // over. To a stranger who downloaded an application it names a command
      // they cannot run about a directory they do not have — at the worst
      // possible moment, on the screen where they decide whether the program is
      // broken or they are. So in a built application the one act that is
      // theirs takes its place: choose a folder. The picker is already reachable
      // from a troubled shell — the vault route is answered above, before this
      // branch — so this is a control on an existing screen and not a new one.
      return h("div.startfail",
        h("b", "The workspace did not open"),
        h("span", troubled),
        production
          ? h("button.btn", { type: "button", onclick: () => ui.open("vault", "") }, "Choose a folder")
          : h("code", "make dev"));
    }

    const { route } = ui.get();
    const w = ws.get();

    switch (route.view) {
      case "page": {
        if (!route.id) return h("p.hold", "Nothing open yet.");
        if (missing.has(route.id) || frameworkId(route.id)) return h("p.hold", "There is no page called “" + route.id + "”.");
        const page = w.page;
        if (!page || page.id !== route.id) return h("p.hold", "Opening…");
        // THE THREE SCREENS OF A PAGE, in every build: the box, its
        // INSTRUCTIONS.md in one editor, and its automations.
        switch (route.screen) {
          case "instructions": return views.instructions.page(page);
          case "automation": return views.automation(page);
          default: return views.page(page);
        }
      }
      case "table": {
        if (w.table && w.table.schema.name === route.id) return views.table(w.table);
        return h("p.hold", "Opening…");
      }
      case "design": {
        // The doc view, over the design source. Not a second renderer: a doc is
        // a page, read through `page.read` as `@design` and drawn like one — and
        // a workspace whose `design/` is gone is told so rather than left at
        // "Opening…", exactly as a page that is not there is.
        if (missing.has(DESIGN_PAGE)) return h("p.hold", "There is no design doc in this workspace — design/content.yaml is missing.");
        const page = w.page;
        if (!page || page.id !== DESIGN_PAGE) return h("p.hold", "Opening…");
        return views.design(page);
      }
      case "map": {
        // The whole workspace as a sky, drawn by the map plugin's document the
        // server resolved for `@map`.
        if (missing.has(MAP_PAGE)) return h("p.hold", "The map could not be read.");
        const page = w.page;
        if (!page || page.id !== MAP_PAGE) return h("p.hold", "Opening…");
        return views.map(page);
      }
      case "runs":
        // What is running across the workspace, and Start.
        return views.runs();
      case "instructions":
        // The vault's INSTRUCTIONS.md and its own skills, one tree, one editor.
        return views.instructions.vault();
      case "agent":
        // THE AGENT SCREEN — `#/agent` and `#/agent/<chat>` route in every
        // build — is the slot beside the canvas, which the bed draws in the
        // canvas's place. The plate keeps nothing of its own meanwhile.
        return views.agent ? agentHole : h("p.hold", "The Agent screen is not in this workspace window.");
      default:
        return h("p.hold", "Nothing open.");
    }
  }

  /** THE ROOT PAGE'S OWN REF, from the directory — its name is what the bar
   *  and the rail call the workspace — asked for once where it is not there
   *  yet, and the answer is one repaint. @returns {import("../../contracts/types.ts").PageRef | null} */
  function rootRef() {
    const ref = ws.refOf(ROOT_PAGE);
    if (ref === null) void ws.want({ ids: [ROOT_PAGE] });
    return ref;
  }

  /**
   * The page on screen, or null. "On screen" is stricter than "in the store":
   * the route may have moved on while the read is still in flight — and Map
   * and Design leave their own read there, under `@map` or `@design`, which a
   * page route naming that id must never take for a page: it is no page, and
   * gets no Share, no page screens, no Edit and a sentence's face.
   * @returns {Page | null}
   */
  function openPage() {
    const { route } = ui.get();
    if (route.view !== "page" || frameworkId(route.id)) return null;
    const page = ws.get().page;
    return page && page.id === route.id ? page : null;
  }

  /** Which shape the canvas is holding, so the stylesheet can give the host's
   *  own screens a reading measure and give a page the whole canvas.
   *
   *  THERE IS ONE PAGE FACE, WHERE THERE WERE THREE. It used to ask the registry
   *  whether this page's render wanted the canvas, and answer `doc`, `artifact`
   *  or `surface` accordingly. There is no registry and no render: every page is
   *  one runtime in one frame, it fills the canvas, and it scrolls inside
   *  itself. The measure a paragraph needs moved into the section that draws the
   *  paragraph — `guest/sections/default.html` — which is what lets the section
   *  beside it be full-bleed. */
  function faceOf() {
    const { route } = ui.get();
    if (route.view === "vault") return "vault";
    if (troubled) return "none";
    if (route.view !== "page") return route.view;
    if (route.screen !== "page") return route.screen;
    // Only once the page is actually on screen. Before it is, the canvas is
    // holding a sentence — "Opening…", or the one about a page that is not there
    // — and a sentence wants the padding a box does not.
    return openPage() ? "page" : "none";
  }

  /* ── the window's own title bar ─────────────────────────────────────────── */

  /** THE BAR, and it is drawn only where there is a window under it.
   *
   *  The mark and the workspace's name on the left, the window's controls on
   *  the right, and the whole strip between them a drag region — which is why
   *  the controls carry `no-drag` in `chrome.css`: a button inside a drag
   *  region does not take a click.
   *
   *  ON macOS THREE OF THE FOUR ARE NOT DRAWN. The traffic lights ARE close,
   *  minimise and zoom there, and they are still on the window — `hiddenInset`
   *  keeps them and insets them into our bar — so a Mac window that drew three
   *  dots of its own would carry six controls for three acts. The bar leaves
   *  them the room the preload names instead. Full screen IS drawn on macOS:
   *  the green light is zoom-or-full-screen depending on a modifier, which is
   *  the ambiguity this button exists to remove everywhere else too.
   *
   *  EVERY BUTTON IS A REAL BUTTON WITH A REAL NAME. The glyphs are drawn in
   *  CSS from `data-` free class names, the way the rack's row glyphs are — an
   *  `<svg>` made through `h()` is not an SVG — so the accessible name is the
   *  `aria-label` and nothing depends on the picture.
   *  @returns {HTMLElement[]}
   */
  function titleParts() {
    const wc = bridge.windowControls;
    const home = rootRef();
    // The name the rack calls the workspace, which is the root page's own — it
    // is the user's to change. The folder's name is the fallback, and the
    // product's the last resort while nothing has been read yet.
    const name = home ? home.name : vault ? vault.name : "Biom";

    /** @param {string} kind @param {string} label @param {() => void} act */
    const ctl = (kind, label, act) =>
      h("button.wctl." + kind, {
        type: "button",
        "aria-label": label,
        title: label,
        onclick: act,
        // A double press on Close must not also maximise the window on its way
        // out. The bar's own handler is the one that would.
        ondblclick: (/** @type {Event} */ e) => e.stopPropagation(),
      }, h("span.wglyph", { "aria-hidden": "true" }));

    const acts = [];
    if (!wc.lights) acts.push(ctl("min", "Minimize", () => void wc.minimize()));
    if (!wc.lights) {
      acts.push(maximized
        ? ctl("restore", "Restore down", () => void wc.toggleMaximize())
        : ctl("max", "Maximize", () => void wc.toggleMaximize()));
    }
    acts.push(fullScreen
      ? ctl("unfull", "Leave full screen", () => void wc.toggleFullScreen())
      : ctl("full", "Full screen", () => void wc.toggleFullScreen()));
    if (!wc.lights) acts.push(ctl("close", "Close", () => void wc.close()));

    // THE QUESTION, in the bar itself, where the close was pressed: how many
    // runs are alive, that closing ends them, and the two answers. Yes closes
    // for real; no puts the bar back and keeps every run.
    const ask = closing > 0 ? [h("span.closeask", { role: "alertdialog", "aria-live": "assertive" },
      h("span.closeword", CLOSE_WORDS.alive(closing)),
      h("button.closeyes", { type: "button", onclick: () => { closing = 0; paint(); void wc.close(true); } }, CLOSE_WORDS.yes),
      h("button.closeno", { type: "button", onclick: () => { closing = 0; paint(); } }, CLOSE_WORDS.no))] : [];
    return [
      h("span.titleid", { style: { "--title-inset": String(wc.inset || 0) + "px" } },
        mark ? h("img.titlemark", { src: mark, alt: "" }) : null,
        h("span.titlename", name)),
      ...ask,
      h("span.titleacts", ...acts),
    ];
  }

  /* ── the rail ──────────────────────────────────────────────────────────── */

  /** A pressed-or-not control on the page bar: the two screens are drawn with it.
   *  @param {string} text @param {() => void} onclick @param {boolean} pressed */
  function tool(text, onclick, pressed = false) {
    return h("button.tool", { type: "button", onclick, "aria-pressed": String(pressed) }, text);
  }

  /** A CHAT'S LAMP wherever the chrome names a chat, as the server keeps it:
   *  amber and pulsing while it works, green for ten minutes after it
   *  finished, red from a stop on an error until its next turn, and none
   *  otherwise. @param {string} light */
  const lamp = (light) =>
    h("span", { class: light === "working" ? "led lit pulse" : light === "done" ? "led green" : light === "error" ? "led red" : "led", "aria-hidden": "true" });

  function railParts() {
    const { route } = ui.get();
    const w = ws.get();
    const page = openPage();

    // THE BAR IS A BREADCRUMB AND THE FEW REAL ACTIONS, and nothing else. There
    // is no title over the page — the page's FIRST SECTION owns the top of the
    // sheet, which is the whole point of the format — so the page is named
    // here, as the last crumb of where it sits. The path on disk that used to
    // sit beside it is the agent's question, and the seeded root page answers
    // it. The bar answers the person's question: which page, inside what.
    const crumbs = h("nav.crumbs", { "aria-label": "Where" }, ...trail(route, w, page));

    const tools = [];

    // REREADING ON DEMAND, which is still a thing a person wants even though the
    // watcher does it for them: a file the server could not see move, a doubt
    // about what is on screen, a stream that is not connected. It re-reads the
    // page from disk AND re-lists the tree, because a page the agent has just
    // created has to turn up without refreshing the browser — and `heard` above
    // runs this exact function when the vault changes on disk.
    const reload = h("button.tool" + (reloading ? ".busy" : ""), {
      type: "button", onclick: () => void doReload(),
      title: "Reread this workspace from disk",
      disabled: reloading ? "" : null,
    }, reloading ? "Reloading…" : "Reload");
    tools.push(reload);

    // SHARE A PAGE — the stop-gap until the hosted server makes every page a
    // URL. The page as it is drawn goes to the server, which makes the file
    // stand alone and puts it in a bucket under a random id; the link comes
    // back here. In the desktop application the shell reads the drawn page
    // out of the box and hands it over; in a browser tab the server draws the
    // page in a browser of its own. Either way it is one press.
    if (page) {
      const share = h("button.tool" + (sharing ? ".busy" : ""), {
        type: "button",
        title: "Capture this page as it is drawn and get a link",
        disabled: sharing ? "" : null,
        "aria-haspopup": "menu",
        onclick: () => { void doShare(share); },
      }, sharing ? "Sharing…" : "Share");
      tools.push(share);
    }

    // THERE IS NO EDIT TOGGLE, AND THAT IS THE POINT. A page is editable the
    // moment it is drawn — the words take a caret, the sections and their items
    // drag, and each section draws its own way to add a part and take one away.
    // A document you have to unlock before you can type in it reads as a demo of
    // a document.
    //
    // AND THERE IS NO PANEL AND NO MENU. There was a History panel, a Modify
    // page panel and a `···` menu opening a Config screen, and the owner decided
    // on 2026-09-17 that all three go rather than hide: History said "no
    // version list yet" over a prompt; Modify page gave directions to a terminal
    // beside the page; Config was made for ports the framework does not have.
    // A version list, when one is built, is its own spec.

    if (page) {
      // THE PAGE'S TWO SCREENS, as two controls where the three dots were:
      // Instructions, the page's INSTRUCTIONS.md in one editor, and
      // Automations, its manifests, files and runs. Each takes the canvas when
      // pressed and gives it back when pressed again. They are in every build.
      /** @param {"instructions" | "automation"} which @param {string} text */
      // A SCREEN OF THE PAGE IS AN ADDRESS OF ITS OWN, so pressing one writes
      // the route and the url with it: a reload lands on it and Back leaves it.
      // And pressing one is the person OPENING that screen: an open in the
      // history, like any other.
      const screenTool = (which, text) => tool(text, () => ui.open("page", route.id, route.screen === which ? "page" : which), route.screen === which);
      tools.push(screenTool("instructions", "Instructions"));
      tools.push(screenTool("automation", "Automations"));
    }

    // EDIT, THE AMBER BUTTON, where Agent Terminal was (*Chat*, `screens`): a
    // new chat beside the page with the page's location typed in, and the
    // caret after it. The one lit control on the bar, because it is the one
    // that hands the page to an agent.
    if (page && views.agent) {
      const agent = views.agent;
      const id = page.id;
      tools.push(h("button.tool.edit", { type: "button", title: "Ask your agent to change this page", onclick: () => agent.edit(id) },
        h("span.glyph", { "data-glyph": "pencil", "aria-hidden": "true" }),
        h("span", "Edit")));
    }

    return [crumbs, h("span.tools", ...tools)];
  }

  /**
   * The crumbs for a route: the root page, then every page on the way down,
   * then the thing itself. Ids are paths and the folder is the hierarchy, so
   * the trail is the id split at its slashes, each prefix looked up for its
   * name — a page the tree has not listed yet shows its last segment rather
   * than nothing. The root is its own page rather than a prefix of every id,
   * so it is the first crumb of every trail. A table's trail is its holding
   * page's, then the table.
   * @param {{ view: ViewName, id: string }} route
   * @param {ReturnType<Workspace["get"]>} w
   * @param {Page | null} page
   * @returns {HTMLElement[]}
   */
  function trail(route, w, page) {
    /** Names the directory does not have yet, asked for once the trail is
     *  built. @type {PageId[]} */
    const unknown = [];
    /** @param {PageId} id */
    const nameOf = (id) => {
      const ref = ws.refOf(id);
      if (ref) return ref.name;
      unknown.push(id);
      return id.slice(id.lastIndexOf("/") + 1);
    };
    /** @param {string} text @param {(() => void) | null} go @param {boolean} last @param {string} [light] */
    const crumb = (text, go, last, light) =>
      h("button.crumb", {
        type: "button", "aria-current": last ? "page" : null,
        onclick: go || undefined, disabled: go ? null : "",
      }, light !== undefined && light !== "none" ? lamp(light) : null, text);

    /** @type {{ text: string, go: (() => void) | null, light?: string }[]} */
    const items = [];
    /** Every page from the root down to `id`, inclusive. @param {PageId} id */
    const pages = (id) => {
      // A child's id may or may not begin with the root's — the folder is the
      // hierarchy, and whether the root's own folder is part of the path is
      // the vault's business. Either way the root is the first crumb once.
      if (id !== ROOT_PAGE && !id.startsWith(ROOT_PAGE + "/")) {
        items.push({ text: nameOf(ROOT_PAGE), go: () => ui.open("page", ROOT_PAGE) });
      }
      const parts = id.split("/");
      for (let n = 1; n <= parts.length; n++) {
        const at = parts.slice(0, n).join("/");
        items.push({ text: at === id && page ? page.name : nameOf(at), go: () => ui.open("page", at) });
      }
    };

    if (route.view === "page" && route.id) pages(route.id);
    else if (route.view === "table") {
      const t = w.tables.find((x) => x.name === route.id);
      pages(t && t.parent ? t.parent : ROOT_PAGE);
      items.push({ text: route.id, go: null });
    } else if (route.view === "design") {
      pages(ROOT_PAGE);
      items.push({ text: "Design", go: null });
    } else if (route.view === "map") {
      pages(ROOT_PAGE);
      items.push({ text: "Map", go: null });
    } else if (route.view === "agent") {
      // THE AGENT SCREEN: Agent, which is a new thread, then the chat open in
      // it with its lamp.
      const chat = views.agent ? views.agent.chrome().chat : null;
      items.push({ text: "Agent", go: route.id ? () => ui.open("agent", "") : null });
      if (route.id) items.push({ text: chat ? chat.name || "New chat" : "Chat", go: null, light: chat ? chat.light : "none" });
    }
    // THE VAULT ROUTE HAS NO CRUMB, because it has no rail to put one in: it is
    // the start page and the start page draws no furniture at all. It used to
    // name the open folder, which was Settings — the picker with the chrome
    // around it — and that screen is gone.

    // A crumb the directory could not name reads as its segment until the
    // answer lands, and the answer is one repaint. Asking is safe from a draw:
    // what is asked, known or absent is never asked again.
    if (unknown.length) void ws.want({ ids: unknown });

    /** @type {HTMLElement[]} */
    const out = [];
    items.forEach((it, i) => {
      if (i) out.push(h("span.crumbsep", { "aria-hidden": "true" }, "/"));
      out.push(crumb(it.text, i === items.length - 1 ? null : it.go, i === items.length - 1, it.light));
    });
    return out;
  }

  /* ── the rail's finder ─────────────────────────────────────────────────── */

  // THE INPUT IS BUILT ONCE, OUT HERE, and that is the whole reason it is not
  // inside rackParts(). `paint()` wipes the rack and fills it again on every
  // store change, so an input constructed in there would be a different element
  // after every keystroke and the caret would go with it. The table grid's own
  // search box is built once for the same reason.
  //
  // THE QUERY IS A CLOSURE VARIABLE rather than a field on the ui store,
  // because `UiState` lives in `contracts/` and that file is frozen. Nothing
  // else needs to read it: this is one rail's own state, not the workspace's,
  // and it is deliberately not remembered across a reload — a rail that opens
  // filtered is a rail that looks like it has lost most of the workspace.
  let query = "";

  /** THE SERVER'S ANSWER FOR THE LAST QUERY ASKED, which is the only one drawn:
   *  a slower answer to an older query arriving after it is dropped.
   *  @type {{ query: string, hits: import("../../contracts/types.ts").PageRef[], more: boolean, complete: boolean, failed?: boolean } | null} */
  let found = null;
  /** Which ask is the latest. */
  let asking = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let findTimer = null;

  /** Where the tree draws, or the hits when there is a query. Held so a
   *  keystroke repaints THIS and nothing above it. */
  const results = h("div.railresults");

  const finder = h("input.railfind", {
    type: "search",
    placeholder: "Find a page",
    "aria-label": "Find a page or table",
    oninput: (/** @type {any} */ e) => { query = e.currentTarget.value; drawResults(); findSoon(); },
    // Escape clears without reaching for the mouse, and leaves the caret where
    // it is so the next thing typed is a fresh query rather than an edit.
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Escape" || !query) return;
      e.preventDefault();
      query = "";
      /** @type {HTMLInputElement} */ (finder).value = "";
      findSoon();
      drawResults();
    },
  });

  /** ASK THE SERVER, once the typing pauses: no window holds every page's
   *  name to search them, so a burst of keystrokes is one `page.search`,
   *  `FIND_AFTER` after the last of them, and the last query wins. */
  function findSoon() {
    if (findTimer !== null) { clearTimeout(findTimer); findTimer = null; }
    const q = query.trim();
    const my = ++asking;
    if (!q) { found = null; return; }
    findTimer = setTimeout(() => {
      findTimer = null;
      ws.search(q).then(
        (res) => { if (my !== asking) return; found = { query: q, hits: res.hits, more: res.more, complete: res.complete }; drawResults(); },
        () => { if (my !== asking) return; found = { query: q, hits: [], more: false, complete: true, failed: true }; drawResults(); },
      );
    }, FIND_AFTER);
  }

  /** Every page the server found and every table whose name carries the
   *  query, best first: a name that STARTS with it, then one that contains
   *  it, then a path that does — the server's own ranking, kept in its order
   *  within a rank. Pages and tables are ranked together because the rail
   *  lists them together — a table is a child like a page and sits where it
   *  was put. The tables are filtered here: the rack holds them all, and there
   *  are few. */
  function hits() {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const w = ws.get();
    /** @type {{ score: number, kind: string, view: ViewName, id: string, name: string, where: string }[]} */
    const out = [];

    const pages = found !== null && found.query.toLowerCase() === q ? found.hits : [];
    for (const p of pages) {
      const name = p.name.toLowerCase();
      const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
      const cut = p.id.lastIndexOf("/");
      out.push({
        score, kind: "doc", view: "page", id: p.id, name: p.name,
        where: cut < 0 ? "" : p.id.slice(0, cut),
      });
    }
    for (const t of w.tables) {
      const name = t.name.toLowerCase();
      const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : -1;
      if (score < 0) continue;
      out.push({ score, kind: "table", view: "table", id: t.name, name: t.name, where: t.parent || "" });
    }

    out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return out;
  }

  /** The tree when there is no query, the hits when there is. Called by a
   *  keystroke and by every repaint, so the list is never stale. */
  function drawResults() {
    const q = query.trim();
    if (!q) { fill(results, views.tree()); return; }

    const answered = found !== null && found.query.toLowerCase() === q.toLowerCase() ? found : null;
    const list = hits();
    if (!list.length) {
      fill(results, h("p.railnone", answered === null ? "Looking…"
        : answered.failed ? "The workspace could not be searched just now."
        : "No page or table is called that."));
      return;
    }

    const rows = list.map((r) =>
      h("li.treerow", h("a.foundrow", {
        href: "#",
        onclick: (/** @type {Event} */ e) => { e.preventDefault(); ui.open(r.view, r.id); },
      },
      h("span.kindtag", { "data-kind": r.kind, "aria-hidden": "true" }),
      h("span.nm", r.name),
      // WHICH ONE THIS IS. Six pages are called Architecture somewhere in a
      // tree this size, so a hit that says only its name is a hit you have to
      // click to identify.
      r.where ? h("span.foundwhere", r.where) : null)));

    fill(results, h("ul.tree", ...rows),
      // THE SERVER DRAWS AT MOST A PAGEFUL, and says when there were more — a
      // one-letter query matches most of a workspace, and a list nobody can
      // scan is the same as no answer, so the line says what to do.
      answered !== null && answered.more ? h("p.railnone", "More pages match. Type more of the name.") : null,
      // AND WHETHER IT HAS READ EVERY PAGE YET: just after a workspace opens
      // the server is still reading it, and a hit may yet turn up.
      answered !== null && !answered.complete ? h("p.railnone", "Still reading the workspace, so more may turn up.") : null,
      answered === null ? h("p.railnone", "Looking…") : null);
  }

  /* ── the rack ──────────────────────────────────────────────────────────── */

  function rackParts() {
    const { route } = ui.get();
    const w = ws.get();
    const open = () => ui.set({ dialog: true });

    /** A workspace screen at the foot: a row like a page's, with a glyph the
     *  stylesheet draws from `data-kind` rather than a word beside the name.
     *  @param {string} text @param {boolean} current @param {() => void} go @param {string} kind */
    const link = (text, current, go, kind) =>
      h("li.treerow", h("a", {
        href: "#",
        "aria-current": current ? "page" : null,
        onclick: (/** @type {Event} */ e) => { e.preventDefault(); go(); },
      }, h("span.kindtag", { "data-kind": kind, "aria-hidden": "true" }), h("span.nm", text)));

    // ONE LIST. There is no Tables section any more: a table is a child like a
    // page and sits wherever it was put, which is the only way a table can live
    // beside the page that uses it. The heading is the root page's own name
    // rather than the word "Pages", because the top level IS a page — its name
    // is the user's to change and clicking it opens it like any other.
    const home = rootRef();

    // WHICH WAY THE RAIL READS, beside the heading of the list it sorts. One
    // button and not a menu: the only question anybody has about a folder of
    // dated notes is whether the newest is at the top, and a control with one
    // answer should be one press. The direction is remembered per browser —
    // nobody else's rail changes and nothing is written into a page — so it is
    // saved here, next to the press that changed it.
    const order = ui.get().treeOrder === "desc" ? "desc" : "asc";
    const flip = () => {
      const next = order === "asc" ? "desc" : "asc";
      remember("treeOrder", next);
      ui.set({ treeOrder: next });
    };

    // The tree is built here rather than by the keystroke alone, so a repaint
    // caused by anything else — a page written, a vault loaded — refreshes what
    // is under the finder instead of leaving the last list on screen.
    drawResults();

    // THE AGENT, WHERE DASHBOARD WAS (*Chat*, `screens`): the rail's one
    // button, in Dashboard's slot and look, with a count of the chats working
    // and their lamp; it goes to the full Agent screen and the chat this
    // window last had open. Without an Agent screen — a test not about it —
    // there is no row.
    const agent = views.agent;
    const busy = agent ? agent.chrome().busy : 0;
    const agentRow = agent
      ? h("button.agentlink", {
        type: "button",
        "aria-current": route.view === "agent" ? "page" : null,
        title: busy ? `${busy} ${busy === 1 ? "chat is" : "chats are"} working` : "The Agent screen",
        onclick: () => agent.open(),
      },
      h("span.glyph", { "data-glyph": "chat", "aria-hidden": "true" }),
      h("span.nm", "Agent"),
      busy ? h("span.busy", lamp("working"), h("span.n", String(busy))) : null)
      : null;

    return [
      agentRow,
      // HOME IS THE TREE'S OWN HEADING, and there is one of it: where there
      // used to be a Dashboard button and a heading that both opened the root
      // page, there is one row that does, with the sort control beside it,
      // because the list under it IS the root page's children. It is in every
      // build — the owner decided (2026-09-14) that a way to the root page is
      // always on screen.
      h("div.railhead",
        h("button.homerow", {
          type: "button",
          "aria-current": route.view === "page" && route.id === ROOT_PAGE ? "page" : null,
          title: home ? home.name : "Home",
          onclick: () => ui.open("page", ROOT_PAGE),
        },
        h("span.glyph", { "data-glyph": "home", "aria-hidden": "true" }),
        h("span.nm", "Home")),
        // The label says what pressing it DOES, which for a toggle means naming
        // the state it goes to rather than the one it is in.
        h("button.railsort", {
          type: "button",
          title: order === "asc" ? "Sort newest first" : "Sort oldest first",
          "aria-label": order === "asc" ? "Sort newest first" : "Sort oldest first",
          onclick: flip,
        }, order === "asc" ? "↓" : "↑")),
      // THE FINDER SITS ABOVE THE TREE rather than in the header beside the
      // sort, because it replaces what is under it: typing swaps the tree for
      // the hits, and a control that changes the list belongs at the top of the
      // list rather than in the chrome above it.
      finder,
      results,
      // ONE WAY TO MAKE A PAGE FROM THE RAIL, and it sits under the tree where a
      // new page lands. There used to be a second button above the list saying
      // the same thing; every row's own plus already says it for the level that
      // matters, and two always-visible buttons for one act is furniture.
      h("button.newpage", { type: "button", onclick: open }, "New page"),
      // The workspace's own screens sit at the foot of the rail, under the
      // pages. They are settings rather than content, and putting them directly
      // under the tree made them read as two more pages.
      h("div.rackfoot",
        h("ul.tree",
          // The design doc: everything an agent reads before it writes UI.
          // There is no Theme row under it any more — the chrome has one scheme
          // and a vault's palette is its pages' business, edited in theme.json.
          // Each row's glyph is drawn from `data-kind` in page.css: a brush, a
          // folded map, a doorway.
          link("Design", route.view === "design", () => ui.open("design", ""), "design"),
          // THE WORKSPACE'S OWN INSTRUCTIONS: the vault's INSTRUCTIONS.md and
          // its own skills, in one tree with one editor. The file every agent
          // opened anywhere in the folder reads first, and the person's.
          link("Instructions", route.view === "instructions", () => ui.open("instructions", ""), "instructions"),
          // AUTOMATIONS: what is running now across the workspace, what has
          // finished, and Start. A page's own screen is where one is made;
          // this is where all of them are watched.
          link("Automations", route.view === "runs", () => ui.open("runs", ""), "runs"),
          // The map: every page as a light, every prose link as a line between
          // two, drawn by the shipped `mindmap` plugin over the whole workspace.
          // IN EVERY BUILD. It was withheld from the built application because
          // a one-page workspace maps to one light; the owner decided on
          // 2026-09-17 that one light is what a one-page workspace looks like,
          // and the drawing is finished.
          link("Map", route.view === "map", () => ui.open("map", ""), "map"),
          // CLOSE WORKSPACE, last, and it is the one row that leaves. There was
          // a Settings row here: the picker, drawn INSIDE the chrome, with the
          // folder open behind it and an "Open now" block on top saying which
          // one. The owner decided (2026-09-14) that it does exactly what the
          // start page does and looks five times worse — so the screen went and
          // the act stayed. Pressing this returns the window to the start page:
          // the mark, the headline, Create a vault, Open, and Recent with the
          // folder just closed at the head of it.
          //
          // A REAL `href`, AND THE BROWSER DOES THE REST. It is the same address
          // this window is at with the folder taken out, so leaving a workspace
          // is a navigation exactly as entering one is — `hrefFor`'s twin,
          // `closeHref`, is the other direction of the same move, and it keeps
          // the per-launch token for the same reason. Middle-click opens the
          // start page in a second tab and this file does nothing to arrange it.
          h("li.treerow", h("a", { href: closeHref(search) },
            h("span.kindtag", { "data-kind": "close", "aria-hidden": "true" }),
            h("span.nm", "Close workspace"))))),
    ];
  }

  /* ── the strip ─────────────────────────────────────────────────────────── */

  /** True of this workspace and short enough to read at a glance. Nothing here
   *  is inferred: "unrestricted" is what the bridge actually grants. */
  function statusParts() {
    const { route } = ui.get();
    const w = ws.get();
    /** @type {[string, string][]} */
    const items = [];

    // THE DESIGN DOC AND THE MAP ARE PAGE READS TOO, so the same report is
    // given for them: the design doc declares sections and the map none.
    // Only through their own routes: a page route naming a reserved id reports
    // nothing, whatever read the store still holds.
    const shown = route.view === "page" ? (frameworkId(route.id) ? null : route.id) : route.view === "design" ? DESIGN_PAGE : route.view === "map" ? MAP_PAGE : null;
    if (shown !== null && w.page && w.page.id === shown) {
      const page = w.page;
      // DECLARED, THEN DRAWN, and they are two items because they can disagree.
      // The first is what `content.yaml` says the page is; the second is what the
      // runtime reported over the port once its DOM existed. The host cannot
      // check the second against the frame — a null origin has nothing to scrape
      // — so the only way to see a section that failed to draw is to read both.
      // DECLARED AND DRAWN ARE A COMPLIANCE REPORT between the host and the box,
      // written for whoever is building a page, and `Data unrestricted` is the
      // same kind of statement about the contract rather than about anything a
      // reader can act on. None of the three is in a built application.
      if (!production) items.push(["Sections", String(page.sections.length || "—")]);
      // The bare page id: one box per page, keyed by `client/views/page.js`
      // under exactly that. A trailing "#" is the old one-box-per-block key and
      // asks about a mount that does not exist, which reads as "not reported"
      // rather than as a mistake.
      const report = frameHost.compliance(page.id);
      // A PAGE THAT DECLARES NO SECTIONS HAS NOTHING FOR THIS TO DISAGREE WITH.
      // The pair exists to catch "declared five, drew three", which needs a
      // declared number; on a board or an html page there is none, and the honest
      // answer is the same dash `Sections` gives rather than a literal 0 — which
      // reads as a fault under a page that is plainly drawn.
      const drawn = !page.sections.length ? "—" : report ? String(report.sections) : "not reported";
      if (!production) items.push(["Drawn", drawn]);
      if (!production) items.push(["Data", "unrestricted"]);
    } else if (route.view === "table" && w.table) {
      // Rows and Columns are facts about the person's own data and stay in both
      // builds; `Data unrestricted` goes with its twin above.
      items.push(["Rows", String(w.table.total)]);
      items.push(["Columns", String(w.table.schema.columns.length)]);
      if (!production) items.push(["Data", "unrestricted"]);
    } else if (route.view === "agent" && views.agent) {
      // THE CHATS AND THE AGENTS, as the mockup's strip has them: facts about
      // the person's own work, in both builds.
      const c = views.agent.chrome();
      if (c.busy) items.push(["Working", String(c.busy)]);
      items.push(["Chats", String(c.chats)]);
      items.push(["Agents active", String(c.active)]);
    }

    // THE ONLY THING SAID ABOUT GIT IS THE BAD NEWS, and the asymmetry is
    // deliberate. This once read `Vault git` unconditionally, on every route —
    // so a workspace on a machine with no git installed, which has no history
    // and no undo at all, was told by the one surface that mentions versions
    // that it had them. `VaultInfo.history` is that fact, and what it earns is
    // the opposite statement in the person's own terms: a vault that IS keeping
    // versions says nothing, because there is nothing to act on, and one that
    // is not says so wherever they are looking.
    //
    // ONCE, AND ONLY ONCE. It is a property of the folder rather than of the
    // route, so it goes on the end of whatever the route put in front of it and
    // is never pushed twice. The shell has not read `vaultInfo` yet on the
    // first paint, and silence is the right answer then too — an absent fact is
    // not a negative one.
    if (vault !== null && vault.history === false) items.push(["Versions", "are not being kept"]);
    const drawn = items.map(([k, v]) => h("span", k, " ", h("b", v)));
    // THE ONE ITEM THAT IS A LINK, and the last: a newer version exists, and the
    // steps to get it are the same three the person already ran once.
    if (newerVersion !== "") {
      drawn.push(h("span", "Update ", h("a", { href: "https://biom.dev/get-started.html", target: "_blank", rel: "noopener" }, h("b", `${newerVersion} is out`))));
    }
    return h("span.status", ...drawn);
  }

  /* ── the two things the chrome does ────────────────────────────────────── */

  /** AN OUTSIDE CHANGE, and it re-runs what the button runs — for what it
   *  names and nothing else. The event says which pages' own files changed
   *  and which levels' children did; the open page is redrawn only when it is
   *  one of them, and only the levels this window holds are listed again. A
   *  write to another page never tears down the box somebody is reading or
   *  typing in. A reconnect names nothing it can trust, and rereads all.
   *
   *  THE OPEN PAGE, WHEN NAMED, MUST GO THROUGH `doReload` AND THEREFORE
   *  THROUGH `ws.reloadPage`, and that is the one rule in this file worth
   *  reading twice. A frame is REUSED while its html is unchanged, so a
   *  cheaper redraw written to stop the flicker would leave the box alive with
   *  its 350 ms save timer armed — and the person's stale text would land over
   *  the agent's a moment later, which is the precise opposite of the rule
   *  this feature ships. `reloadPage` sets the page to null and emits, the
   *  frame is torn down, and a timer in a realm that has gone does not fire.
   *  See `SAVE_AFTER` in `guest/runtime/edit.js`.
   *
   *  ONE GUARD, AND IT IS `doReload`'s. An event landing mid-reload is merged
   *  into one more pass after this one, which is the same answer the button
   *  pressed twice gets — so this is a call and nothing else.
   *  @param {string | null} data */
  function heard(data) {
    void doReload(data === null ? EVERYTHING : changeOf(data));
  }

  /** Why the share did not happen, in words somebody can act on. The same
   *  line the dialog keeps; a sibling cannot be imported, so it is said twice.
   *  @param {unknown} err @returns {string} */
  const reason = (err) => (err instanceof Error && err.message ? err.message : "the server refused it");

  /** One press: ask the server, then hang the answer off the button.
   *  @param {HTMLElement} anchor */
  async function doShare(anchor) {
    const page = openPage();
    if (!page) return;
    // A second press with a link already made shows it again rather than
    // capturing again: sharing the same page twice is a new id each time and
    // that is a decision, not a reflex.
    if (shared && shared.page === page.id) { showShare(anchor); return; }
    if (sharing) return;
    sharing = true;
    shareSaid = "";
    paint();
    try {
      // THE SHELL CAN SEE INTO THE BOX AND THIS PAGE CANNOT, so where there is
      // a shell the capture is the person's own window, as they are looking at
      // it. Where there is none the server draws the page itself.
      const shell = /** @type {{ biomShell?: { capturePage?: () => Promise<string> } }} */ (/** @type {unknown} */ (globalThis)).biomShell;
      const html = shell && typeof shell.capturePage === "function" ? await shell.capturePage() : undefined;
      const made = await ws.sharePage(page.id, html && html !== "" ? html : undefined);
      shared = { page: page.id, url: made.url, left: made.left };
    } catch (err) {
      console.error("the page was not shared", err);
      shareSaid = "Not shared: " + reason(err);
      shared = null;
    } finally {
      sharing = false;
      paint();
    }
    showShare(anchor);
  }

  /** The Share button as it is on screen now. `paint()` rebuilds the tool
   *  strip, so a button held across an await is a detached node by the time
   *  the answer lands; the menu hangs from the live one, and the one held is
   *  the fallback for a strip that no longer offers Share. */
  const shareButton = () =>
    /** @type {HTMLElement | null} */ (root && root.querySelector(".tools button[aria-haspopup='menu'][title^='Capture']"));

  /** The link, Copy, Open, and what was left out. @param {HTMLElement} held */
  function showShare(held) {
    const anchor = shareButton() || held;
    popover(anchor, (close) => {
      if (!shared) return [h("p.poplabel", shareSaid || "Not shared.")];
      const url = shared.url;
      const field = /** @type {HTMLInputElement} */ (h("input.popfield", { type: "text", readonly: "", value: url, "aria-label": "The link" }));
      // COPY KEEPS THE MENU OPEN. Copying is not the end of the act — the
      // person still wants to see the link, open it, or copy it again — so the
      // row says it copied and stays; only Open and Escape put the menu away.
      const copyRow = popItem("Copy link", async () => {
        try { await navigator.clipboard.writeText(url); } catch { field.select(); document.execCommand("copy"); }
        const name = copyRow.querySelector(".popname");
        if (name) name.textContent = "Copied";
        setTimeout(() => { if (name && name.isConnected) name.textContent = "Copy link"; }, 1400);
      });
      const rows = [
        h("p.poplabel", "Anyone with this link can open the page as it was captured."),
        field,
        copyRow,
        popItem("Open in a new tab", () => { window.open(url, "_blank", "noopener"); close(); }),
        popItem("Share again", () => { shared = null; close(); void doShare(anchor); }),
      ];
      if (shared.left.length) {
        rows.push(h("p.poplabel", "Left pointing at this server: " + shared.left.join(", ")));
      }
      return rows;
    }, { center: true, width: "26rem" });
  }

  /** THE BUTTON, and a change on disk: reread what `change` names — the open
   *  page when it is one of the pages, the held levels among the levels, and
   *  everything the window holds for `all`, which is what the button asks.
   *  @param {ChangeEvent} [change] */
  async function doReload(change = EVERYTHING) {
    if (reloading) {
      // The button pressed twice, or a change landing mid-pass: merged into
      // one more pass after this one, because the disk may have moved since
      // this pass read it.
      again = again === null ? change : merged(again, change);
      return;
    }
    const { route } = ui.get();
    reloading = true;
    reloads++;
    troubled = "";
    missing.clear();
    // What was listed on the way down is listed again where the change says;
    // a route whose way down would not list is asked once more.
    revealed = "";
    paint();
    try {
      // The page first and the levels beside it: `reloadPage` drops the cached
      // page and emits, which is what tears every frame on it down.
      //
      // AND THE READER'S PLACE SURVIVES THE TEARDOWN. `keep` goes first, while
      // the realm that reported where it was scrolled to is still the one on
      // the mount; the new realm is put back there on its `ready`, clamped to
      // whatever the page is now. It is said here and nowhere else, so a page
      // navigated to starts at the top and only a redraw keeps its place.
      const open = route.view === "page" && route.id && !frameworkId(route.id) ? route.id
        : route.view === "design" ? DESIGN_PAGE : route.view === "map" ? MAP_PAGE : null;
      /** @type {Promise<unknown>[]} */
      const work = [ws.refresh(change)];
      if (open !== null && touches(change, open)) {
        // The design doc and the map are pages read under reserved ids, and a
        // reload of either is a page reload: the box torn down, the read taken
        // again from disk, the reader's place kept.
        frameHost.keep(open);
        work.push(ws.reloadPage(open));
      } else if (route.view === "table" && route.id) work.push(ws.loadTable(route.id));
      await Promise.all(work);
    } catch (err) {
      troubled = message(err);
    } finally {
      reloading = false;
      paint();
      if (again !== null) {
        const next = again;
        again = null;
        void doReload(next);
      }
    }
  }

  /**
   * Fetch what the route names and the store has not got. Somebody has to, and
   * it is the router: the stores never reach for anything on their own, and a
   * view that fetched its own subject would be a view that could not be reused.
   */
  /**
   * The folder's name, and the ids the router gave up on.
   *
   * Both hang off the same fact and that is why they are one function: a tree
   * version that moved means a level was listed again, and opening a vault is
   * the extreme case of that — every level read afresh. So the name
   * is re-read, and an id remembered as missing is forgiven, because the page
   * that was not there a moment ago may be there now. A genuinely deleted page
   * costs one refetch and goes straight back into the set.
   *
   * It runs even while `troubled`: the picker is what fixes a workspace that did
   * not open, and a rail that cannot name the folder is no use on that screen.
   */
  function ensureVault() {
    const now = ws.version();
    if (now === vaultFrom || vaultBusy) return;
    vaultFrom = now;
    vaultBusy = true;
    missing.clear();
    ws.vaultInfo()
      .then((info) => { vault = info; })
      .catch(() => { /* the rail falls back to the word; the picker says why */ })
      .finally(() => { vaultBusy = false; paint(); });
  }

  function ensure() {
    if (reloading || troubled) return;
    const { route } = ui.get();
    const w = ws.get();

    // THE DESIGN DOC AND THE MAP ARE PAGES UNDER RESERVED IDS, fetched exactly
    // as a routed page is: the id is the route's, and the read is a page read.
    // Only through their own routes: a page route naming a reserved id reads
    // nothing, and the body says there is no such page.
    const wanted = route.view === "page" ? (frameworkId(route.id) ? "" : route.id) : route.view === "design" ? DESIGN_PAGE : route.view === "map" ? MAP_PAGE : "";
    // THE WAY DOWN TO A PAGE, listed once per page gone to: the levels that
    // hold it, which name its crumbs and are there when the rail is opened to
    // it. Only the missing ones are asked for, and a level that would not list
    // is not asked again on every repaint.
    if (route.view === "page" && wanted && revealed !== wanted) {
      revealed = wanted;
      ws.reveal(wanted).catch((err) => console.warn("[biom] the way down to that page could not be listed", err));
    }
    if (wanted && !missing.has(wanted)) {
      if (w.page && w.page.id === wanted) return;
      const key = "page:" + wanted;
      if (awaiting === key) return;
      awaiting = key;
      const id = wanted;
      ws.loadPage(id)
        .then((page) => { if (!page) { missing.add(id); paint(); } })
        .catch((err) => { troubled = message(err); paint(); })
        .finally(() => { if (awaiting === key) awaiting = ""; });
      return;
    }

    if (route.view === "table" && route.id) {
      if (w.table && w.table.schema.name === route.id) return;
      const key = "table:" + route.id;
      if (awaiting === key) return;
      awaiting = key;
      ws.loadTable(route.id)
        .catch((err) => { troubled = message(err); paint(); })
        .finally(() => { if (awaiting === key) awaiting = ""; });
    }
  }

  /* ── the repaint ───────────────────────────────────────────────────────── */

  function paint() {
    const u = ui.get();

    // A FIRST LAUNCH HAS NO WORKSPACE, SO IT DRAWS NO FURNITURE. The start page
    // is the whole client area under the bar: there is nothing for a rail to be
    // a rail of, no page for a breadcrumb to name, and no sections for the strip
    // to count — and a rail offering New page into a folder that does not exist
    // is the screen asking a stranger to do something that cannot work.
    //
    // THE ROUTE IS THE WHOLE TEST, and that is the change: the vault route draws
    // the start page and never the picker with the chrome around it. It used to
    // ask whether a folder was mounted as well, because the same view was ALSO
    // Settings — the picker inside the rail, with the open workspace behind it.
    // That screen is gone (see the rail's foot), so there is one screen left and
    // it is bare wherever it is reached from: a first launch, `Close workspace`,
    // a `#/vault` somebody typed with a folder open, and the way out of a
    // workspace that did not open at all.
    const bare = u.route.view === "vault";
    app.className = (titlebar === null ? "app" : "app framed") + (bare ? " bare" : "");

    if (titlebar !== null) fill(titlebar, ...titleParts());
    fill(rail, ...(bare ? [] : railParts()));
    fill(rack, ...(bare ? [] : rackParts()));
    fill(strip, bare ? null : statusParts());

    // After the rows exist, because what it measures is the rows. It is a no-op
    // unless they say something different from last time, and it does not look
    // at all once the width has been dragged.
    sizer.sync();

    plate.setAttribute("data-face", faceOf());

    // WHERE THE AGENT SCREEN IS DRAWN: the bed's grid, and nothing moved. A
    // workspace that did not open draws its trouble, not a chat.
    bed.setAttribute("data-agent", bare || troubled || !views.agent ? "none" : agentMode(u));

    // GO BACK TO, when there is something of the person's to go back to. The
    // view hands back the same button until what it names changes, so a
    // repaint between a press and its release never loses the click; and the
    // canvas says so, which is what gives the screen under it room.
    const back = bare || !views.goback ? null : views.goback();
    if (backslot.firstChild !== back) fill(backslot, back);
    canvas.toggleAttribute("data-back", back !== null);

    // THE LINES THIS FILE IS FOR. Nothing the body is made of moved, so it is
    // not asked for one; and a body that came back the node already on screen is
    // left exactly where it is, so every artifact on it keeps running. A page
    // hands back the same root across every write it survives, which is why the
    // second test earns its keep rather than duplicating the first.
    const now = inputs();
    if (!same(now, built)) {
      built = now;
      const node = bodyOf();
      if (plate.firstChild !== node) fill(plate, node);
    }

    // The dialog is a sibling of the canvas, so adding or removing it never
    // touches the page.
    if (u.dialog && !dialogEl && root) { dialogEl = dialog(); root.append(dialogEl); }
    else if (!u.dialog && dialogEl) { dialogEl.remove(); dialogEl = null; }

    ensureVault();
    ensure();
  }

  /* ── the URL ───────────────────────────────────────────────────────────── */

  /** Written on every route change and read back on a browser reload, so the
   *  page you were on survives one — which matters here more than usual,
   *  because refreshing the browser is the second thing anyone tries after
   *  pressing Reload.
   *
   *  WHETHER THE BROWSER'S HISTORY GAINS AN ENTRY IS THE MOVE'S TO SAY
   *  (`ui.cause().replace`). The person's open assigns the hash, so Back works.
   *  A system move REPLACES the entry — Back to an id a rename or a delete
   *  took away is a Back to nothing. The switcher replaces an entry of its own
   *  and keeps the person's, so Back from anything it brought up lands on the
   *  person's work rather than walking back through an agent's moves.
   *
   *  Assigning fires `hashchange`, whose handler compares against the route it
   *  just came from and does nothing; `replaceState` fires nothing at all.
   *  That is what makes this direction of the loop free. */
  function syncHash() {
    if (typeof window === "undefined" || !window.location) return;
    const want = hashOf(ui.get().route);
    // ONLY A ROUTE THAT MOVED IS WRITTEN. The browser moves the hash itself on
    // Back and announces it a task later; a repaint landing in between — a
    // stream event, a store write — would otherwise see the hash and the route
    // differ and write the old route back over the person's Back.
    if (want === written) return;
    written = want;
    if (window.location.hash === want) return;
    const history = window.history;
    if (ui.cause().replace && history && typeof history.replaceState === "function") {
      history.replaceState(history.state, "", want);
    } else {
      window.location.hash = want;
    }
  }

  /** The hash this shell last wrote, or took from the browser. @type {string | null} */
  let written = null;

  return {
    /**
     * Build the chrome into `el` and wire the two listeners that belong to it.
     * @param {HTMLElement} el
     */
    mount(el) {
      // THE ADDRESS THE WINDOW ENDS UP ON IS THE LATEST ONE. The route was
      // read from the hash when the window's stores were built, and the shell
      // listens for the hash moving only from here on — so a hash set while the
      // window was still booting (a person's Back, a walk going somewhere the
      // moment the page reloads) was never heard, and the first repaint wrote
      // the address it loaded with back over it. What the browser says now is
      // taken as the person's open, as a typed hash is. A tab with no folder
      // has one screen, the start page, whatever its hash says.
      if (typeof window !== "undefined" && window.location && ui.get().route.view !== "vault") {
        const now = parseHash(window.location.hash);
        if (!sameAddress(now, ui.get().route)) {
          written = hashOf(now);
          ui.open(now.view, now.id, now.screen);
        }
      }
      root = el;
      fill(el, app);
      sizer.mount(app, bed, rack);

      // THE WINDOW, ASKED ONCE AND THEN PUSHED AT. The first paint has already
      // happened by the time either answer lands, which is why both repaint:
      // the bar draws its name with no mark and an unmaximised icon, and
      // corrects itself a beat later. Nothing waits on a window.
      if (bridge !== null) {
        const wc = bridge.windowControls;
        wc.state().then((/** @type {any} */ now) => {
          if (!now) return;
          maximized = now.maximized === true;
          fullScreen = now.fullScreen === true;
          paint();
        }).catch(() => { /* the icons stay as they are; neither is a fault */ });
        wc.onChange((/** @type {any} */ now) => {
          if (!now) return;
          maximized = now.maximized === true;
          fullScreen = now.fullScreen === true;
          paint();
        });
        // THE CLOSE HELD OVER A LIVE RUN. The main process asked the server,
        // found something alive, held the window and said how many; the
        // question is drawn here, in the application's own chrome, and yes is
        // `close(true)` — which ends every run with the server — while no is
        // the strip going away and nothing else. A bridge built before this
        // existed has no `onClosing` and the window simply closes.
        if (typeof wc.onClosing === "function") {
          wc.onClosing((/** @type {number} */ alive) => {
            closing = typeof alive === "number" && alive > 0 ? alive : 1;
            paint();
          });
        }
        if (typeof bridge.logo === "function") {
          bridge.logo().then((/** @type {string} */ url) => {
            if (typeof url !== "string" || !url) return;
            mark = url;
            paint();
          }).catch(() => { /* the bar wears its name alone */ });
        }
      }

      if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("keydown", (ev) => {
          if (ev.key !== "Escape") return;
          const u = ui.get();
          if (u.dialog) ui.set({ dialog: false });
          else if (u.inserting !== null) ui.set({ inserting: null });
        });
      }

      // The host cannot read a null-origin frame's DOM, so an artifact's slot
      // count is self-reported — and it arrives after the paint that mounted the
      // frame, because the shim counts slots once its DOM exists. The strip and
      // the Config table both show that number and nothing would ever ask again.
      // Only `ready`: `size` fires on every resize inside every artifact.
      canvas.addEventListener("biom:notice", (ev) => {
        const notice = /** @type {{ detail?: { kind?: string } }} */ (/** @type {unknown} */ (ev)).detail;
        if (notice && notice.kind === "ready") paint();
      });

      // THE PERSON'S HAND ON A SCREEN THE HOST DRAWS — Instructions, the
      // Automations screens, a table, the design doc's chrome, the map's. A box
      // cannot be seen into and says its own through the frame host; nothing
      // inside an iframe reaches these listeners. Only events the browser says
      // a person made, a scroll only as the gesture that scrolls, and nothing
      // inside an element marked `NOT_TOUCH` — the chat's input, Go back to.
      // At most one of each a second: what the switcher wants is THAT the
      // person was here, not how often.
      if (deps.touched) {
        const touched = deps.touched;
        /** @type {Record<string, number>} */
        const last = {};
        /** @param {string} what */
        const hand = (what) => (/** @type {Event} */ ev) => {
          if (!ev.isTrusted) return;
          const at = /** @type {any} */ (ev.target);
          if (at && typeof at.closest === "function" && at.closest("[" + NOT_TOUCH + "]")) return;
          const t = Date.now();
          if (t - (last[what] ?? -Infinity) < 1000) return;
          last[what] = t;
          touched();
        };
        const quietly = { capture: true, passive: true };
        canvas.addEventListener("pointerdown", hand("click"), quietly);
        canvas.addEventListener("keydown", hand("key"), quietly);
        canvas.addEventListener("wheel", hand("scroll"), quietly);
        canvas.addEventListener("touchmove", hand("scroll"), quietly);
      }

      // THE FILE CHANGED ON DISK, so press Reload. That is the whole feature:
      // there is no hot patch, no diff on the wire and no new thing a page can
      // say — the server presses the button a person used to have to.
      if (events) events.on(heard);

      if (typeof window !== "undefined" && window.addEventListener) {
        // BACK AND FORWARD, and a hash somebody typed: the PERSON moving the
        // screen, so an open. A route this shell set writes the same hash it
        // already holds, so the comparison makes that direction a no-op.
        window.addEventListener("hashchange", () => {
          const route = parseHash(window.location.hash);
          if (sameAddress(route, ui.get().route)) return;
          // The browser already holds this entry, so its spelling is put
          // right IN it — a hash typed with its slashes left in is the same
          // address — rather than pushed as a second entry after it.
          const want = hashOf(route);
          written = want;
          const history = window.history;
          if (window.location.hash !== want && history && typeof history.replaceState === "function") {
            history.replaceState(history.state, "", want);
          }
          ui.open(route.view, route.id, route.screen);
        });
      }

      paint();
    },

    /** The subscription target. Both stores call this and nothing else. */
    repaint() {
      syncHash();
      // A menu hangs from an element in the canvas by a rect it measured. A
      // route change takes that element away, and a menu left floating over a
      // different screen is the kind of thing nobody reports and everybody sees.
      const view = ui.get().route.view;
      if (view !== lastView) { lastView = view; closePopover(); }
      paint();
    },

    /** boot's hand-off when the workspace could not be read at all. A blank page
     *  and a line in the console is the failure nobody can debug in front of a
     *  stranger.
     *
     *  `andPick` SENDS IT TO THE PICKER, and boot passes it for the one case
     *  where the workspace itself is the thing that failed: the folder in this
     *  tab's address could not be opened at all, so there is no page behind this
     *  message and no reason to draw a screen whose only control is a way to the
     *  picker. Left off, the trouble screen stands where it always did — a
     *  workspace that opened and then stopped answering is a different fault,
     *  and sending that one to a folder chooser would be telling somebody their
     *  workspace is gone when the server merely fell over.
     *  @param {unknown} err
     *  @param {boolean} [andPick] */
    trouble(err, andPick = false) {
      troubled = message(err);
      // Through the store, so the route in the address bar follows — a tab left
      // pointing at a folder it could not open would go back to it on reload.
      if (andPick) ui.go("vault", "");
      paint();
    },
  };
}

/* ── pure, and therefore testable ─────────────────────────────────────── */

/**
 * The route a URL fragment names. A hash is user input — it is the one thing in
 * the client that arrives from outside without passing the server — so an
 * unknown view falls back rather than routing to nothing. It is the same
 * vocabulary in every build: a screen the rail offers is a screen a hash may
 * name, and there is no screen the rail does not offer.
 *
 * `parseAddress` in `contracts/address.js`, under the name this file and its
 * test have always called it: the switcher and the history spell an address
 * the same way, so the spelling moved down to where all three can read it.
 * @param {string} hash
 * @returns {Address}
 */
export const parseHash = (hash) => parseAddress(hash);

/** The url fragment for a route — `formatAddress`, for the same reason.
 *  @param {{ view: ViewName, id: string, screen?: PageScreen }} route @returns {string} */
export const hashOf = (route) => formatAddress(route);

/** A FRAMEWORK SCREEN'S ID — `@agent`, `@map`, `@design` — is no page. `@` is
 *  outside a page segment's grammar, so no page anybody made starts with one,
 *  and the server answers such an id with the screen's own bare plugin page:
 *  routed as a page, `@agent` would draw a second Agent screen in a page box
 *  that is never fed. So a page route naming one is not read and is said to
 *  be no page at all, whatever the missing set holds.
 *  @param {string} id */
const frameworkId = (id) => id.startsWith("@");

/** HOW LONG THE FINDER WAITS AFTER THE LAST KEYSTROKE BEFORE IT ASKS THE
 *  SERVER, in ms: long enough that a word typed is one `page.search`, short
 *  enough to read as instant. */
export const FIND_AFTER = 120;

/** THE CHANGE THAT NAMES EVERYTHING: the Reload button, and a reconnect,
 *  which cannot know what it missed. It rereads the open page and every level
 *  the window holds — still bounded by what is on the window's screen.
 *  @type {ChangeEvent} */
export const EVERYTHING = { pages: [], levels: [], all: true };

/** Two changes as one pass: everything either names.
 *  @param {ChangeEvent} a @param {ChangeEvent} b @returns {ChangeEvent} */
export function merged(a, b) {
  if (a.all === true || b.all === true) return EVERYTHING;
  return { pages: [...new Set([...a.pages, ...b.pages])], levels: [...new Set([...a.levels, ...b.levels])] };
}

/** WHETHER A CHANGE REDRAWS THE SCREEN SHOWING `open` — a page, the design
 *  doc or the map. A page only when the change names it, or names everything:
 *  a write to another page never tears down the box somebody is reading. The
 *  map draws every page, so any change is its change. The design doc lives
 *  outside `pages/`, so a change naming no page at all may be its own.
 *  @param {ChangeEvent} change @param {PageId} open @returns {boolean} */
export function touches(change, open) {
  if (change.all === true) return true;
  if (open === MAP_PAGE) return true;
  if (open === DESIGN_PAGE) return change.pages.includes(DESIGN_PAGE) || (change.pages.length === 0 && change.levels.length === 0);
  return change.pages.includes(open);
}

/** @param {unknown} err */
const message = (err) =>
  err instanceof Error && err.message ? err.message : "the server did not answer";
