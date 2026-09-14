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

/** @import { FrameHost, Page, PageId, TableView,
 *            UiState, UiStore, VaultInfo, ViewName } from "../../contracts/types.ts" */
/** @import { Workspace } from "../store/workspace.js" */

import { remember } from "../platform/dom.js";
import { closePopover, popover, popItem } from "../widgets/popover.js";
import { ROOT_PAGE } from "../store/workspace.js";
// THE ADDRESS OF THE START PAGE, from the module that owns every other address a
// workspace has. `Close workspace` and the picker's own rows are the two
// directions of one move — into a folder and out of it — and an address built
// twice is an address that drops the token in one of the two places.
import { closeHref } from "../views/vault.js";
import { makePanels } from "./panels.js";
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
 * @property {(page: Page) => HTMLElement} config
 * @property {(view: TableView | null) => HTMLElement} table
 * @property {() => HTMLElement} vault
 * @property {() => HTMLElement} design
 * @property {() => HTMLElement} map
 */

/**
 * @typedef {object} ShellDeps
 * @property {H} h
 * @property {Fill} fill
 * @property {Workspace} ws THE STORE PLUS THE TREE READS. The dialog makes a
 *   table and then places it, which is `moveChild` — the same write the rail
 *   makes when you drag one — and that lives on the store rather than in the
 *   frozen contract.
 * @property {UiStore} ui
 * @property {FrameHost} frameHost
 * @property {ShellViews} views
 * @property {boolean} [production] WHICH BUILD THIS IS, and the only thing the
 *   chrome knows about it: whether a row is put in the list it returns. Nothing
 *   here is deleted in production and nothing becomes a second code path — every
 *   view goes on being constructed, every screen goes on existing, and a branch
 *   that removed a module in one build and not the other would be two
 *   applications sharing a name. Absent means development, so a caller that
 *   built a shell before this existed still gets every row.
 * @property {{ on: (hear: () => void) => () => void }} [events] THE VAULT
 *   CHANGING ON DISK, as a subscription rather than an import: data ascends
 *   through a callback a higher layer registered, and nothing below the shell
 *   holds a reference to anything above it. Optional, because a tab that has
 *   chosen no folder has no stream and because most tests that build a shell
 *   are not about this.
 * @property {string} [search] THE QUERY THIS WINDOW WAS OPENED WITH, which the
 *   rail's `Close workspace` row carries forward minus the folder. Defaults to
 *   the real one, and to "" where there is no window at all.
 */

/** The route vocabulary, so a hash somebody typed cannot invent a view.
 *
 *  Exported for the test that holds it and the rail in agreement: a view is
 *  reachable by typing and reachable by clicking, and the two lists are in
 *  different halves of this file. A test that hand-copied either would be a
 *  third list.
 *  @type {ReadonlySet<string>} */
export const VIEWS = new Set(["page", "table", "vault", "design", "map"]);

/** The screens a built application does not offer, so a typed `#/map` cannot
 *  reach what the rail no longer shows. One name today.
 *  @type {ReadonlySet<string>} */
const HIDDEN_VIEWS = new Set(["map"]);

/** The same vocabulary minus those, DERIVED rather than written out a second
 *  time. Two hand-kept lists are two places a view can be added, and the one
 *  that gets forgotten is this one — a route in the built application with no
 *  row to reach it, or a row whose route falls back to a page.
 *  @type {ReadonlySet<string>} */
export const PRODUCTION_VIEWS = new Set([...VIEWS].filter((v) => !HIDDEN_VIEWS.has(v)));

/** The panels a built application does not offer, the way `HIDDEN_VIEWS` names
 *  the screens it does not. What belongs in it is a developer's diagnostics —
 *  the rule being whether a person who never cloned this repository can act on
 *  it. Modify page draws a path to `cd` into and a prompt to paste into a
 *  coding agent running in a terminal beside this window; History reads the
 *  vault's git log, and the vault being a git repo is an implementation detail.
 *
 *  Adding a panel to this set is the whole of hiding one. The rail's row and
 *  the paint both ask `offered` below rather than testing a name, so there is
 *  no second site to remember and no way for the two to disagree.
 *  @type {ReadonlySet<string>} */
const HIDDEN_PANELS = new Set(["agent", "history"]);

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

/**
 * @param {ShellDeps} deps
 */
export function makeShell(deps) {
  const { h, fill, ws, ui, frameHost, views, events } = deps;
  const production = deps.production === true;

  /** WHICH PANEL THIS BUILD WILL SHOW, and the one answer everything asks.
   *
   *  `panel` is a field on the UI store and any caller can set it, so taking a
   *  row out of the rail leaves a second door standing open the way a typed
   *  `#/map` would if only the row had gone. Every reader of that field goes
   *  through here instead — the rail deciding whether to offer a row, the paint
   *  deciding what to build and how wide the bed is, and Escape deciding
   *  whether there is a panel to close — so a panel this build hides is not a
   *  panel to anybody.
   *
   *  Takes the stored value and answers it back or `null`; passing a name reads
   *  as *is this one offered*, which is what the rail wants.
   *  @param {null | "agent" | "history"} panel
   *  @returns {null | "agent" | "history"} */
  const offered = (panel) => (panel !== null && production && HIDDEN_PANELS.has(panel) ? null : panel);

  /** THE QUERY THIS WINDOW WAS OPENED WITH, and all `Close workspace` needs: the
   *  start page is this same address with the folder taken out of it. Read once,
   *  the way the picker reads it, so a test can state what a window this module
   *  did not open has to keep. */
  const search = deps.search ?? (typeof location === "undefined" ? "" : location.search);

  const panels = makePanels({ h });
  const dialog = makeDialog({ h, ws, ui });
  // The rail's width. It owns one custom property on `.app` and nothing else in
  // here has an opinion about it — which is what keeps a drag from repainting
  // anything, and a repaint from arguing with a drag.
  const sizer = makeRack({ h });

  /* ── the skeleton, built once and kept ─────────────────────────────────── */

  const rail = h("div.rail");
  const rack = h("nav.rack", { "aria-label": "Workspace" });
  const plate = h("div.plate");
  const canvas = h("div.canvas",
    h("i.reg.tl"), h("i.reg.tr"), h("i.reg.bl"), h("i.reg.br"), plate);
  // The grip sits in the bed rather than in the rack: the rack scrolls, and a
  // handle that scrolls out of view is a handle nobody finds twice.
  const bed = h("div.bed", rack, canvas, sizer.grip);
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
  /** @type {HTMLElement | null} */ let panelEl = null;
  /** @type {unknown} */ let panelFrom = null;
  /** @type {HTMLElement | null} */ let dialogEl = null;
  /** The reload button is the change loop; it says so while it is working. */
  let reloading = false;
  /** How many times Reload has been pressed. The only screen that reads it is
   *  Design, whose doc is not in the snapshot and so cannot be seen to move. */
  let reloads = 0;
  /** A change that landed while a reload was already running. It is a flag and
   *  not a queue: what a redraw reads is the current state of disk, so two
   *  pending changes and one are the same amount of work. */
  let again = false;
  /** Set by boot when the workspace could not be read at all. @type {string} */
  let troubled = "";
  /** One outstanding read, so a repaint mid-fetch does not fire a second. */
  let awaiting = "";
  /** Which folder the workspace is, for the rail's foot. `WorkspaceSnapshot` is
   *  frozen and does not carry it, so it is read on its own.
   *  @type {VaultInfo | null} */
  let vault = null;
  /** The page list the name above was read against. Re-reading on a re-listed
   *  tree is what keeps it honest without a signal the contract does not have:
   *  opening a vault replaces every page in the snapshot at once, so a `pages`
   *  array that is a different object is the cheapest true test for "the folder
   *  may have moved". It costs one small request per create, move or install.
   *  @type {unknown} */
  let vaultFrom = Symbol("nothing");
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
        return ["page", r.id, u.pageView, w.page, u.inserting, w.pages, missing.has(r.id)];
      case "table":
        return ["table", r.id, w.table, w.pages];
      case "design":
        // Nothing in the snapshot can see the design doc — it lives at
        // `design/`, outside `pages/` — so there is nothing here to compare and
        // the body is asked for exactly once per entry into the route, which is
        // when the view re-reads. `reloads` is the other way in: pressing Reload
        // on this screen has to re-read the doc an agent may have just rewritten,
        // and it is the only signal the shell has that says so.
        return ["design", reloads];
      case "map":
        // The map reads the whole workspace itself, over its port, and re-reads
        // on every refresh the box is sent — so the body is built once per entry
        // into the route and nothing in the snapshot has to be compared.
        return ["map"];
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
          ? h("button.btn", { type: "button", onclick: () => ui.go("vault", "") }, "Choose a folder")
          : h("code", "make dev"));
    }

    const { route, pageView } = ui.get();
    const w = ws.get();

    switch (route.view) {
      case "page": {
        if (!route.id) return h("p.hold", "Nothing open yet.");
        if (missing.has(route.id)) return h("p.hold", "There is no page called “" + route.id + "”.");
        const page = w.page;
        if (!page || page.id !== route.id) return h("p.hold", "Opening…");
        return pageView === "config" ? views.config(page) : views.page(page);
      }
      case "table": {
        if (w.table && w.table.schema.name === route.id) return views.table(w.table);
        return h("p.hold", "Opening…");
      }
      case "design":
        // The doc view, over the design source. Not a second renderer: a doc is
        // a preset, and this is the proof.
        return views.design();
      case "map":
        // The whole workspace as a sky, drawn by the shipped map plugin.
        return views.map();
      default:
        return h("p.hold", "Nothing open.");
    }
  }

  /**
   * The page on screen, or null. "On screen" is stricter than "in the store":
   * the route may have moved on while the read is still in flight.
   * @returns {Page | null}
   */
  function openPage() {
    const { route } = ui.get();
    if (route.view !== "page") return null;
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
    const { route, pageView } = ui.get();
    if (route.view === "vault") return "vault";
    if (troubled) return "none";
    if (route.view !== "page") return route.view;
    if (pageView === "config") return "config";
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
    const w = ws.get();
    const home = w.pages.find((p) => p.id === ROOT_PAGE);
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

    return [
      h("span.titleid", { style: { "--title-inset": String(wc.inset || 0) + "px" } },
        mark ? h("img.titlemark", { src: mark, alt: "" }) : null,
        h("span.titlename", name)),
      h("span.titleacts", ...acts),
    ];
  }

  /* ── the rail ──────────────────────────────────────────────────────────── */

  /** @param {string} text @param {() => void} onclick @param {boolean} pressed @param {string} extra */
  function tool(text, onclick, pressed = false, extra = "") {
    return h("button.tool" + (extra ? "." + extra : ""),
      { type: "button", onclick, "aria-pressed": String(pressed) }, text);
  }

  function railParts() {
    const { route, pageView, panel } = ui.get();
    const w = ws.get();
    const page = openPage();

    // THE BAR IS A BREADCRUMB AND THE FEW REAL ACTIONS, and nothing else. There
    // is no title over the page — the page's FIRST SECTION owns the top of the
    // sheet, which is the whole point of the format — so the page is named
    // here, as the last crumb of where it sits. The path on disk that used to
    // sit beside it is the agent's question, and the Modify page panel answers
    // it in full where that panel is offered — in a built application it is
    // not, and the folder an agent is pointed at is printed on the seeded root
    // page instead. The bar answers the person's question: which page, inside
    // what.
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

    // HISTORY IS A DEVELOPER'S PANEL. It reads the vault's git log, and the
    // vault being a git repo is an implementation detail: undo exists without an
    // undo mechanism being built, and the way to it is a sentence handed to an
    // agent rather than a list of commit subjects. `HIDDEN_PANELS` is where that
    // is said; the extra condition beside it is this row's own, and is about
    // there being something to show a history of.
    if (offered("history") && (page || route.view === "table")) {
      tools.push(tool("History", () => ui.set({ panel: panel === "history" ? null : "history" }),
        panel === "history"));
    }

    // THERE IS NO EDIT TOGGLE, AND THAT IS THE POINT. A page is editable the
    // moment it is drawn — the words take a caret, the sections and their items
    // drag, and each section draws its own way to add a part and take one away.
    // A document you have to unlock before you can type in it reads as a demo of
    // a document.

    if (page) {
      // MODIFY PAGE IS A DEVELOPER'S PANEL TOO, and the owner decided on
      // 2026-09-14 that a built application does not offer it. What it draws is
      // a path to `cd` into and a prompt to paste into a coding agent running
      // in a terminal beside this window — an instruction written for whoever
      // has one open, at the exact moment a stranger is deciding what this
      // program is. The panel is not deleted and nothing here becomes a second
      // code path: the row is not put in the list, and the paint below declines
      // to build it — both of them asking `offered`, the way a typed route asks
      // `PRODUCTION_VIEWS`.
      if (offered("agent")) {
        tools.push(tool("Modify page", () => ui.set({ panel: panel === "agent" ? null : "agent" }),
          panel === "agent", "spot"));
      }

      // Config is a screen about the page rather than a way of looking at it,
      // so it is behind the page's own menu rather than a tab beside the name.
      // One item today; the menu is where the next page-level thing goes.
      const more = h("button.tool.more", {
        type: "button", "aria-label": "More", "aria-haspopup": "menu",
        onclick: () => {
          popover(more, (close) => [
            popItem(pageView === "config" ? "Page" : "Config", () => {
              close();
              ui.set({ pageView: pageView === "config" ? "page" : "config" });
            }),
          ], { align: "end" });
        },
      }, "\u22EF");
      tools.push(more);
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
    /** @param {PageId} id */
    const nameOf = (id) => {
      const ref = w.pages.find((p) => p.id === id);
      return ref ? ref.name : id.slice(id.lastIndexOf("/") + 1);
    };
    /** @param {string} text @param {(() => void) | null} go @param {boolean} last */
    const crumb = (text, go, last) =>
      h("button.crumb", {
        type: "button", "aria-current": last ? "page" : null,
        onclick: go || undefined, disabled: go ? null : "",
      }, text);

    /** @type {{ text: string, go: (() => void) | null }[]} */
    const items = [];
    /** Every page from the root down to `id`, inclusive. @param {PageId} id */
    const pages = (id) => {
      // A child's id may or may not begin with the root's — the folder is the
      // hierarchy, and whether the root's own folder is part of the path is
      // the vault's business. Either way the root is the first crumb once.
      if (id !== ROOT_PAGE && !id.startsWith(ROOT_PAGE + "/")) {
        items.push({ text: nameOf(ROOT_PAGE), go: () => ui.go("page", ROOT_PAGE) });
      }
      const parts = id.split("/");
      for (let n = 1; n <= parts.length; n++) {
        const at = parts.slice(0, n).join("/");
        items.push({ text: at === id && page ? page.name : nameOf(at), go: () => ui.go("page", at) });
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
    }
    // THE VAULT ROUTE HAS NO CRUMB, because it has no rail to put one in: it is
    // the start page and the start page draws no furniture at all. It used to
    // name the open folder, which was Settings — the picker with the chrome
    // around it — and that screen is gone.

    /** @type {HTMLElement[]} */
    const out = [];
    items.forEach((it, i) => {
      if (i) out.push(h("span.crumbsep", { "aria-hidden": "true" }, "/"));
      out.push(crumb(it.text, i === items.length - 1 ? null : it.go, i === items.length - 1));
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

  /** Where the tree draws, or the hits when there is a query. Held so a
   *  keystroke repaints THIS and nothing above it. */
  const results = h("div.railresults");

  const finder = h("input.railfind", {
    type: "search",
    placeholder: "Find a page",
    "aria-label": "Find a page or table",
    oninput: (/** @type {any} */ e) => { query = e.currentTarget.value; drawResults(); },
    // Escape clears without reaching for the mouse, and leaves the caret where
    // it is so the next thing typed is a fresh query rather than an edit.
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Escape" || !query) return;
      e.preventDefault();
      query = "";
      /** @type {HTMLInputElement} */ (finder).value = "";
      drawResults();
    },
  });

  /** How many hits are drawn. A one-letter query matches most of a workspace of
   *  a few hundred pages, and a list nobody can scan is the same as no answer —
   *  so the rest are counted rather than drawn, and the count says what to do. */
  const SHOWN = 50;

  /** Every page and table whose name or path carries the query, best first: a
   *  name that STARTS with it, then one that contains it, then a path that
   *  does. Pages and tables are ranked together because the rail lists them
   *  together — a table is a child like a page and sits where it was put. */
  function hits() {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const w = ws.get();
    /** @type {{ score: number, kind: string, view: ViewName, id: string, name: string, where: string }[]} */
    const out = [];

    for (const p of w.pages) {
      const name = p.name.toLowerCase();
      const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : p.id.toLowerCase().includes(q) ? 2 : -1;
      if (score < 0) continue;
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
    if (!query.trim()) { fill(results, views.tree()); return; }

    const found = hits();
    if (!found.length) {
      fill(results, h("p.railnone", "No page or table is called that."));
      return;
    }

    const rows = found.slice(0, SHOWN).map((r) =>
      h("li.treerow", h("a.foundrow", {
        href: "#",
        onclick: (/** @type {Event} */ e) => { e.preventDefault(); ui.go(r.view, r.id); },
      },
      h("span.kindtag", { "data-kind": r.kind, "aria-hidden": "true" }),
      h("span.nm", r.name),
      // WHICH ONE THIS IS. Six pages are called Architecture somewhere in a
      // tree this size, so a hit that says only its name is a hit you have to
      // click to identify.
      r.where ? h("span.foundwhere", r.where) : null)));

    fill(results, h("ul.tree", ...rows),
      found.length > SHOWN
        ? h("p.railnone", `${found.length - SHOWN} more. Type more of the name.`)
        : null);
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
    const home = w.pages.find((p) => p.id === ROOT_PAGE);

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

    return [
      // A DEDICATED WAY HOME, distinct from the workspace-name link below (which
      // stays as the page's own heading). One row, always visible, at the very
      // top of the rail — the same "New page" pattern at the foot, mirrored.
      //
      // IT IS IN EVERY BUILD. The audit had it on the production hide list as
      // one of two rows going home; the owner decided (2026-09-14) that the
      // dashboard is the root page and a way to it is always on screen.
      h("button.dashboardlink", {
        type: "button",
        "aria-current": route.view === "page" && route.id === ROOT_PAGE ? "page" : null,
        onclick: () => ui.go("page", ROOT_PAGE),
      }, h("span.dashglyph", { "aria-hidden": "true" }), h("span.nm", "Dashboard")),
      h("div.railhead",
        h("h3", h("a", {
          href: "#",
          "aria-current": route.view === "page" && route.id === ROOT_PAGE ? "page" : null,
          onclick: (/** @type {Event} */ e) => { e.preventDefault(); ui.go("page", ROOT_PAGE); },
        }, home ? home.name : "Workspace")),
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
          link("Design", route.view === "design", () => ui.go("design", ""), "design"),
          // The map: every page as a light, every prose link as a line between
          // two, drawn by the shipped `mindmap` plugin over the whole workspace.
          // It is a drawing of a tree a stranger's vault does not have yet — a
          // one-page workspace maps to one light — so it is not in a built
          // application, and `VIEWS` loses the route with it so a typed `#/map`
          // cannot reach what the row no longer offers.
          production ? null : link("Map", route.view === "map", () => ui.go("map", ""), "map"),
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

    if (route.view === "page" && w.page && w.page.id === route.id) {
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
    return h("span.status", ...items.map(([k, v]) => h("span", k, " ", h("b", v))));
  }

  /* ── the two things the chrome does ────────────────────────────────────── */

  /** AN OUTSIDE CHANGE, and it re-runs exactly what the button runs.
   *
   *  IT MUST GO THROUGH `doReload` AND THEREFORE THROUGH `ws.reloadPage`, and
   *  that is the one rule in this file worth reading twice. A frame is REUSED
   *  while its html is unchanged, so a cheaper redraw written to stop the
   *  flicker would leave the box alive with its 350 ms save timer armed — and
   *  the person's stale text would land over the agent's a moment later, which
   *  is the precise opposite of the rule this feature ships. `reloadPage` sets
   *  the page to null and emits, the frame is torn down, and a timer in a realm
   *  that has gone does not fire. See `SAVE_AFTER` in `guest/runtime/edit.js`.
   *
   *  ONE GUARD, AND IT IS `doReload`'s. An event landing mid-reload asks for one
   *  more pass after this one, which is the same answer the button pressed twice
   *  gets — so this is a call and nothing else, and the two cannot drift. */
  function heard() {
    void doReload();
  }

  async function doReload() {
    if (reloading) {
      // The button, pressed twice. Same answer as an event: one more pass after
      // this one, because the disk may have moved since this pass read it.
      again = true;
      return;
    }
    const { route } = ui.get();
    reloading = true;
    reloads++;
    troubled = "";
    missing.clear();
    paint();
    try {
      // The tree first is wrong and the page first is right: `reloadPage` drops
      // the cached page and emits, which is what tears every frame on it down.
      if (route.view === "page" && route.id) await ws.reloadPage(route.id);
      else if (route.view === "table" && route.id) await ws.loadTable(route.id);
      await ws.loadTree();
    } catch (err) {
      troubled = message(err);
    } finally {
      reloading = false;
      paint();
      if (again) {
        again = false;
        void doReload();
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
   * Both hang off the same fact and that is why they are one function: a `pages`
   * array that is a different object means the tree was re-listed, and opening a
   * vault is the extreme case of that — every page replaced at once. So the name
   * is re-read, and an id remembered as missing is forgiven, because the page
   * that was not there a moment ago may be there now. A genuinely deleted page
   * costs one refetch and goes straight back into the set.
   *
   * It runs even while `troubled`: the picker is what fixes a workspace that did
   * not open, and a rail that cannot name the folder is no use on that screen.
   */
  function ensureVault() {
    const now = ws.get().pages;
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

    if (route.view === "page" && route.id && !missing.has(route.id)) {
      if (w.page && w.page.id === route.id) return;
      const key = "page:" + route.id;
      if (awaiting === key) return;
      awaiting = key;
      const id = route.id;
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
    const w = ws.get();

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

    // The panel and the dialog are siblings of the canvas, so adding or removing
    // one never touches the page.
    // The vault is IN THE KEY, and it has to be: the agent panel names the
    // folder to `cd` into, the shell reads that folder on its own and answers a
    // beat later, and a key that left it out would build the panel once against
    // "not yet" and never build it again.
    //
    // WHICH PANEL THIS BUILD WILL BUILD, asked here rather than only where the
    // row is offered, because `panel` is a store field any caller can set.
    // `offered` is the one answer and `HIDDEN_PANELS` is the one list; a panel
    // this build hides is dropped for the whole of what follows — the key, the
    // build, and the class on the bed, which would otherwise widen for a panel
    // that is not there.
    const showing = offered(u.panel);
    const panelKey = showing === null
      ? null
      : showing + ":" + (w.page ? w.page.id : "") + ":" + (vault ? vault.path : "");
    if (panelKey !== panelFrom) {
      panelFrom = panelKey;
      if (panelEl) panelEl.remove();
      panelEl = showing === "agent" ? panels.agent(w.page, vault)
        : showing === "history" ? panels.history(w.page, vault === null ? undefined : vault.history)
        : null;
      if (panelEl) bed.append(panelEl);
      bed.className = showing ? "bed with-panel" : "bed";
    }

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
   *  Assigning the hash rather than replacing the entry, so Back works. It fires
   *  `hashchange`, whose handler compares against the route it just came from
   *  and does nothing — which is what makes one direction of this loop free. */
  function syncHash() {
    if (typeof window === "undefined" || !window.location) return;
    const want = hashOf(ui.get().route);
    if (window.location.hash !== want) window.location.hash = want;
  }

  return {
    /**
     * Build the chrome into `el` and wire the two listeners that belong to it.
     * @param {HTMLElement} el
     */
    mount(el) {
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
          // `offered` rather than the raw field: a panel this build does not
          // draw is not an open panel, and Escape swallowed by one nobody can
          // see is the same second door in another shape.
          else if (offered(u.panel)) ui.set({ panel: null });
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

      // THE FILE CHANGED ON DISK, so press Reload. That is the whole feature:
      // there is no hot patch, no diff on the wire and no new thing a page can
      // say — the server presses the button a person used to have to.
      if (events) events.on(heard);

      if (typeof window !== "undefined" && window.addEventListener) {
        // Back and forward. `go` writes the hash itself, so this only fires for
        // history the browser moved and never for a route this shell set.
        window.addEventListener("hashchange", () => {
          const route = parseHash(window.location.hash, production);
          const now = ui.get().route;
          if (route.view !== now.view || route.id !== now.id) ui.go(route.view, route.id);
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
 * unknown view falls back rather than routing to nothing.
 * THE VOCABULARY SHRINKS IN A BUILT APPLICATION, and it has to. The Map row
 * going without the route going would leave the screen reachable by typing,
 * which is a hidden feature rather than an absent one. Out of the set, `#/map`
 * falls back the way every other unknown view already does.
 * @param {string} hash
 * @param {boolean} [production] which build this is; absent means development.
 * @returns {{ view: ViewName, id: string }}
 */
export function parseHash(hash, production = false) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const cut = raw.indexOf("/");
  const view = cut < 0 ? raw : raw.slice(0, cut);
  let id = cut < 0 ? "" : raw.slice(cut + 1);
  try {
    id = decodeURIComponent(id);
  } catch {
    id = "";
  }
  const known = production ? PRODUCTION_VIEWS : VIEWS;
  // The fallback carries no id on purpose: `#/map` landing on a page view with
  // an id taken from a map route would open whatever page happened to share the
  // name. Boot fills an empty page route with the first page in the workspace.
  return known.has(view) ? { view: /** @type {ViewName} */ (view), id } : { view: "page", id: "" };
}

/** @param {{ view: ViewName, id: string }} route @returns {string} */
export const hashOf = (route) =>
  "#/" + route.view + (route.id ? "/" + encodeURIComponent(route.id) : "");

/** @param {unknown} err */
const message = (err) =>
  err instanceof Error && err.message ? err.message : "the server did not answer";
