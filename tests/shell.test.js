// SPDX-License-Identifier: AGPL-3.0-only
// The shell: routing, the edit toggle, and the one property the whole file
// exists for.
//
// There is no DOM here and deliberately no DOM library. The shell takes `h` and
// `fill` as dependencies for exactly this reason, so a recording element factory
// exercises the real code paths — which node ended up in the canvas, which
// button the rail drew, what the frame host was told — with nothing faked but
// the element factory, the stores' server, and the views.
//
// THE GROUP THAT MATTERS IS "THE INVARIANT, END TO END". Moving an iframe in the
// DOM reloads it, so a repaint that re-inserts the page root restarts the box the
// whole page is drawn in — and there is now ONE box per page, so that is the
// whole page rather than one block of it. Almost every write in the workspace
// emits and therefore repaints: a row, a colour, a rename, a section added or
// taken away. If "an unchanged repaint keeps the node" ever stops being true,
// every page in the workspace restarts on all of them and nothing else here will
// notice.

import { test, expect, beforeEach, afterAll } from "bun:test";
import { readFileSync } from "node:fs";

import { makeShell, parseHash, CLOSE_WORDS, hashOf, VIEWS } from "../client/shell/shell.js";
import {
  makeRack, rackWidth, autoCeiling,
  RACK_MIN, RACK_BASE, RACK_SHARE, RACK_KEY, RACK_STEP,
} from "../client/shell/rack.js";
import { makeTreeView, nest } from "../client/views/tree.js";
import { freeTableName } from "../client/shell/dialog.js";
import { makePageView } from "../client/views/page.js";
import { closeHref, hrefFor, makeVaultView } from "../client/views/vault.js";
import { UNTITLED } from "../client/shell/dialog.js";
import { makeUi } from "../client/store/ui.js";
import { makeTerminals } from "../client/store/terminals.js";
import { closePopover } from "../client/widgets/popover.js";

/* ── a recording element factory, shaped like client/platform/dom.js ──── */

// A class, not an object literal: `h()` decides whether its second argument is
// props or a child by testing `constructor === Object`, so a fake element made
// from a literal would be read as a bag of properties.
class El {}

/** Take a node out of whatever holds it, the way every real insert does. The
 *  count it keeps is the point: an iframe taken out and put back is an iframe
 *  that reloaded, and no assertion about element identity alone can see it. */
function detach(node) {
  const p = node.parent;
  if (!p) return;
  const i = p.children.indexOf(node);
  if (i >= 0) p.children.splice(i, 1);
  node.parent = null;
}

function element(tag) {
  const classes = new Set();
  const el = Object.assign(new El(), {
    tagName: String(tag).toUpperCase(),
    attrs: {},
    // `setProperty` is what the dock writes its size with; a plain key is what
    // the tree writes its depth with, so both spellings land in the one map.
    style: { setProperty(/** @type {string} */ k, /** @type {string} */ v) { this[k] = v; } },
    dataset: {},
    children: [],
    parent: /** @type {any} */ (null),
    listeners: {},
    disabled: false,
    value: "",
    id: "",
    textContent: "",
    contentEditable: "",
    draggable: false,
    /** how many times this node has been put into a parent */
    moved: 0,
    setAttribute: (k, v) => { el.attrs[k] = v; },
    removeAttribute: (k) => { delete el.attrs[k]; },
    toggleAttribute: (k, on) => { if (on) el.attrs[k] = ""; else delete el.attrs[k]; },
    addEventListener: (name, fn) => { (el.listeners[name] ||= []).push(fn); },
    append: (...nodes) => {
      for (const n of nodes) {
        if (n instanceof El) { detach(n); n.parent = el; n.moved++; }
        el.children.push(n);
      }
    },
    insertBefore: (node, ref) => {
      detach(node);
      const at = ref ? el.children.indexOf(ref) : -1;
      el.children.splice(at < 0 ? el.children.length : at, 0, node);
      node.parent = el;
      node.moved++;
      return node;
    },
    replaceChildren: (...nodes) => {
      for (const n of [...el.children]) if (n instanceof El) n.parent = null;
      el.children.length = 0;
      el.append(...nodes);
    },
    remove: () => detach(el),
    contains: () => false,
    // `preventDefault` and `stopPropagation` are on every event a browser
    // dispatches, so they are on every event this dispatches — a handler that
    // has to feel for them before calling them is defending against the fake
    // rather than against anything real. `defaulted` is what a caller checks
    // when the point of the handler is that it took the navigation itself.
    fire: (name, ev) => {
      const e = { defaulted: false, preventDefault() { e.defaulted = true; }, stopPropagation() {}, ...(ev ?? {}) };
      for (const fn of el.listeners[name] || []) fn(e);
      return e;
    },
    focus: () => { el.focused = true; },
    blur: () => { el.focused = false; },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  });
  Object.defineProperty(el, "className", {
    get: () => [...classes].join(" "),
    set: (v) => { classes.clear(); for (const c of String(v).split(" ")) if (c) classes.add(c); },
  });
  Object.defineProperty(el, "firstChild", { get: () => el.children[0] ?? null });
  Object.defineProperty(el, "parentNode", { get: () => el.parent });
  Object.defineProperty(el, "nextElementSibling", {
    get: () => {
      const p = el.parent;
      if (!p) return null;
      const i = p.children.indexOf(el);
      return i < 0 ? null : p.children[i + 1] ?? null;
    },
  });
  return el;
}

function h(spec, props, ...children) {
  const [head, ...classes] = String(spec).split(".");
  const el = element(head.split("#")[0] || "div");
  if (classes.length) el.className = classes.join(" ");
  if (props && props.constructor === Object) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style") Object.assign(el.style, v);
      else if (k === "class") el.className = el.className + " " + v;
      else if (k === "disabled") el.disabled = true;
      else if (k === "value") el.value = String(v);
      else if (k === "id") el.id = String(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  } else if (props !== undefined && props !== null) {
    children.unshift(props);
  }
  add(el, children);
  return el;
}

function add(el, list) {
  for (const c of list) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) add(el, c);
    else el.append(c);
  }
}

function fill(el, ...content) {
  el.replaceChildren();
  add(el, content);
  return el;
}

/** Depth-first, so a test can ask "is there an Edit content button anywhere in
 *  the rail" without knowing how the rail is laid out. */
function find(root, ok) {
  if (!(root instanceof El)) return null;
  if (ok(root)) return root;
  for (const kid of root.children) {
    const hit = find(kid, ok);
    if (hit) return hit;
  }
  return null;
}

/** Every match, in document order. The rail is a list, so most questions about
 *  it are about what is in it and in what order. */
function findAll(root, ok) {
  const out = [];
  (function walk(el) {
    if (!(el instanceof El)) return;
    if (ok(el)) out.push(el);
    for (const kid of el.children) walk(kid);
  })(root);
  return out;
}

const byText = (root, text) => find(root, (el) => flat(el) === text);
/** A BUTTON BY ITS WORDS. `byText` is depth-first, so a container whose only
 *  child says the words is handed back before the button inside it — which is
 *  what the bar became once Reload was the one action on it. */
const byButton = (root, text) => find(root, (el) => el.tagName === "BUTTON" && flat(el) === text);
/** Class-exact, because a container's flattened text starts with its first
 *  child's and a depth-first search would hand back the box rather than the
 *  button inside it. */
const has = (el, cls) => String(el.className).split(" ").includes(cls);
const flat = (el) => el.children.map((c) => (c instanceof El ? flat(c) : String(c))).join("");

/* ── the fakes ─────────────────────────────────────────────────────────── */

const THEME = {
  palette: { name: "Biom", colors: {}, extra: [] },
  fonts: { roles: { sheet: "a", furniture: "b", gauge: "c" }, available: [] },
};

/** A section as the server resolves it, which is the only thing a page holds.
 *  THERE IS NO PAGE KIND: the pages below differ in what their sections put in
 *  their slots and in nothing else.
 *  @param {string} name @param {Record<string, any>} parts */
const sect = (name, parts) => ({ name, html: "", fallback: true, parts, vars: {} });
const prose = (md) => ({ kind: "markdown", md, vars: {} });

const DOC = { id: "notes", name: "Notes", variables: {}, page: [], ports: null,
  sections: [sect("t", { body: prose("# Notes") })] };
const WITH_BLOCK = { ...DOC, id: "rates", name: "Rates",
  sections: [
    sect("t", { body: prose("#") }),
    sect("calc", { body: { kind: "html", file: "calc.html", html: "<p>", vars: {} } }),
  ] };
/** A page with NOTHING anybody can edit by typing at it: one section drawing a
 *  table and one drawing a child. A markdown slot is the only thing edited in
 *  place, so the Edit toggle must not be offered here — a mode that would do
 *  nothing is worse than no mode. */
const BOARD = { id: "board", name: "Job board", variables: {}, page: [], ports: null,
  sections: [
    sect("grid", { body: { kind: "table", table: "jobs" } }),
    sect("kids", { body: { kind: "child", child: { kind: "page", id: "notes", name: "Notes" } } }),
  ] };

const VIEW = { schema: { name: "jobs", kind: "basic", columns: [{ name: "n", type: "text" }] }, rows: [], total: 0 };

function fakeWs(page = DOC) {
  const subs = new Set();
  const state = {
    pages: [
      { id: "home", name: "Everything" },
      { id: "notes", name: "Notes" },
      { id: "board", name: "Job board" },
    ],
    tables: [{ name: "jobs", kind: "basic", rows: 12, parent: "home" }],
    theme: THEME,
    page,
    table: null,
  };

  const emit = () => { for (const fn of [...subs]) fn(); };

  return {
    state,
    emit,
    calls: [],
    get: () => state,
    children: (id) => (id === "home" ? [
      { kind: "page", id: "notes", name: "Notes" },
      { kind: "page", id: "board", name: "Job board" },
      { kind: "table", id: "jobs", name: "jobs", rows: 12 },
    ] : []),
    async moveChild() { await null; },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    async loadTree() { await null; this.calls.push("loadTree"); emit(); },
    async loadPage(id) {
      await null;
      this.calls.push("loadPage:" + id);
      // THE DESIGN DOC AND THE MAP ARE PAGE READS under reserved ids, and the
      // shell asks for them exactly as it asks for a routed page.
      const reserved = id === "@design" ? { ...DOC, id, name: "Design" } : id === "@map" ? { ...BOARD, id, name: "Map", plugin: "mindmap" } : null;
      state.page = reserved ?? [DOC, WITH_BLOCK, BOARD].find((p) => p.id === id) ?? null;
      emit();
      return state.page;
    },
    async reloadPage(id) {
      await null;
      this.calls.push("reloadPage:" + id);
      state.page = null;
      emit();
      state.page = { ...(state.page ?? DOC), id };
      emit();
      return state.page;
    },
    async loadTable(name) {
      await null;
      this.calls.push("loadTable:" + name);
      state.table = { ...VIEW, schema: { ...VIEW.schema, name } };
      emit();
      return state.table;
    },
    async createPage(init) {
      // NO KIND. `PageInit` is a name and a parent — a page is one thing now, so
      // there is nothing left for the dialog to ask.
      await null;
      this.calls.push("createPage:" + init.name + ":" + init.parent);
      const ref = { id: "scratch", name: init.name };
      state.pages = [...state.pages, ref];
      state.page = { ...DOC, id: ref.id, name: ref.name };
      emit();
      return ref;
    },
    async createTable(schema) {
      await null;
      this.calls.push("createTable:" + schema.name);
      state.tables = [...state.tables, { name: schema.name, kind: schema.kind, rows: 0, parent: null }];
      emit();
    },
    // The vault. The shell reads the folder's name for the rail's foot, so every
    // framework in this file needs it whether or not the test is about it.
    // `history` is the fact the UI used to guess. A test that wants the other
    // answer sets `ws.history = false` before the shell reads it.
    async vaultInfo() {
      await null;
      return { path: "/w/one", name: "one", seeded: true, history: this.history !== false };
    },
    async recentVaults() { await null; return []; },
    async browseVault(path) { await null; return { at: path ?? "/w", up: "/", dirs: [] }; },
    async openVault(path) {
      await null;
      this.calls.push("openVault:" + path);
      return { path, name: "two", seeded: true, history: true };
    },
    history: true,
  };
}

function fakeFrameHost() {
  return {
    sent: [],
    /** Every key the shell asked to keep the reader's place for, in order. */
    kept: [],
    setShim() {},
    for() { throw new Error("no frame is mounted in these tests"); },
    drop() {},
    broadcast(ev) { this.sent.push(ev); },
    compliance() { return null; },
    keep(key) { this.kept.push(key); },
  };
}

/** Every view records how many times it was asked to draw, and hands back a NEW
 *  element each time — which is what makes "the body was not rebuilt" provable
 *  rather than assumed. */
function fakeViews() {
  const drawn = { tree: 0, page: 0, table: 0, theme: 0, vault: 0, design: 0, map: 0, runs: 0, instructions: 0, pageInstructions: 0, automation: 0 };
  const one = (name, cls) => (...args) => { drawn[name]++; return h("div." + cls, String(args[0] ?? "")); };
  return {
    drawn,
    views: {
      tree: one("tree", "tree"),
      page: (p) => { drawn.page++; return h("div.pagebody", p.id); },
      table: one("table", "tbl"),
      vault: one("vault", "vaultpick"),
      design: (p) => { drawn.design++; return h("div.designdoc", p.id); },
      map: (p) => { drawn.map++; return h("div.sky", p.id); },
      runs: one("runs", "overview"),
      instructions: {
        vault: one("instructions", "vaultins"),
        page: (p) => { drawn.pageInstructions++; return h("div.pageins", p.id); },
      },
      automation: (p) => { drawn.automation++; return h("div.autoscreen", p.id); },
    },
  };
}

/** A stand-in for the live stream `client/transport/events.js` opens. The shell
 *  takes it as a callback rather than an import, so the fake is a callback. */
function fakeEvents() {
  const hears = new Set();
  return {
    on(hear) { hears.add(hear); return () => hears.delete(hear); },
    /** A file changed on disk, as far as the shell is concerned. */
    fire() { for (const hear of [...hears]) hear(); },
    get listeners() { return hears.size; },
  };
}

function harness(
  page = DOC,
  route = { view: "page", id: page ? page.id : "" },
  production = false,
  events = undefined,
  /** A FIRST LAUNCH: nothing mounted, so there is no page list and `vault.info`
   *  refuses. It is set before the shell is built rather than after, because the
   *  folder is read once on the first paint and cached against the page list —
   *  a store swapped out afterwards would never be asked. */
  unmounted = false,
  /** THE QUERY THIS WINDOW WAS OPENED WITH. There is no `location` in these
   *  tests, so the rail's `Close workspace` row has nothing to read — and the
   *  claim it makes, that every other parameter survives, is only testable if
   *  the query can be handed in. */
  search = "",
) {
  const ws = fakeWs(page);
  if (unmounted) {
    ws.state.pages = [];
    ws.vaultInfo = async () => { await null; throw new Error("this request names no workspace"); };
  }
  const ui = makeUi({ route });
  const frameHost = fakeFrameHost();
  const { drawn, views } = fakeViews();

  // NO REGISTRY. `faceOf` used to ask one whether this page's render wanted the
  // canvas; there is no registry and no render, and every page is one runtime in
  // one box that fills.
  const shell = makeShell({ h, fill, ws, ui, frameHost, views, production, events, search });

  ws.on(() => shell.repaint());
  ui.on(() => shell.repaint());

  const root = element("div");
  shell.mount(root);

  const app = root.children[0];
  const rail = app.children[0];
  const bed = app.children[1];
  const rack = bed.children[0];
  const canvas = bed.children[1];
  const plate = canvas.children[4];
  const strip = app.children[2];

  return { ws, ui, frameHost, drawn, shell, root, app, rail, rack, bed, canvas, plate, strip, events };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// The shell binds Escape to the document and hashchange to the window, and on a
// route change it closes any open menu — which reaches into popover.js, which
// unbinds from both. A fake carrying only the half the shell calls directly
// leaves the other half to blow up inside a module this file never mentions, so
// it carries all four. `location` is deliberately absent: `syncHash` reads it to
// decide whether there is a URL to write, and there is not one here.
//
// `closePopover` runs for the same reason. At most one menu is open at a time,
// so popover.js keeps it in a module variable — and a module variable is shared
// with every other test file in this process. A file that opened a menu against
// its own fake document and tore that document down leaves this one to close it,
// which throws somewhere in the view that opened it. The state is cleared before
// the throw, so clearing it here, once, is the whole fix.
beforeEach(() => {
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try { closePopover(); } catch { /* somebody else's menu, and now it is shut */ }
});
afterAll(() => { delete globalThis.document; delete globalThis.window; });

/* ── the URL ───────────────────────────────────────────────────────────── */

test("a hash names a route, and an unknown one does not route to nothing", () => {
  expect(parseHash("#/page/job-board")).toEqual({ view: "page", id: "job-board" });
  expect(parseHash("#/design")).toEqual({ view: "design", id: "" });
  // A view the vocabulary no longer holds is nonsense like any other, rather
  // than a route to a screen that is not there.
  expect(parseHash("#/market")).toEqual({ view: "page", id: "" });
  expect(parseHash("#/page/a%20b")).toEqual({ view: "page", id: "a b" });
  expect(parseHash("")).toEqual({ view: "page", id: "" });
  expect(parseHash("#/nonsense/x")).toEqual({ view: "page", id: "" });
  // A malformed escape is user input reaching the router, not a crash.
  expect(parseHash("#/page/%E0%A4%A")).toEqual({ view: "page", id: "" });
});

test("a route round-trips through its hash", () => {
  for (const route of [{ view: "page", id: "job board" }, { view: "design", id: "" },
    { view: "vault", id: "" }]) {
    expect(parseHash(hashOf(route))).toEqual(route);
  }
});

/* ── routing ───────────────────────────────────────────────────────────── */

test("the canvas holds the view the route names", async () => {
  const g = harness();
  expect(g.plate.firstChild.className).toBe("pagebody");

  g.ui.go("table", "jobs");
  await tick();
  expect(g.plate.firstChild.className).toBe("tbl");
  expect(g.ws.calls).toContain("loadTable:jobs");

  g.ui.go("design", "");
  await tick();
  expect(g.plate.firstChild.className).toBe("designdoc");

  // A hash that names the retired Theme screen is not a route any more: the
  // contract still spells the name, the shell no longer draws anything for it.
  g.ui.go("theme", "");
  await tick();
  expect(g.plate.firstChild.className).toBe("hold");

  g.ui.go("page", "notes");
  await tick();
  expect(g.plate.firstChild.className).toBe("pagebody");
});

test("a page has one face, and nothing on the store can put another on the plate", async () => {
  // THERE WAS A CONFIG FACE — `pageView` on the store, a `···` menu on the bar
  // to flip it, and a screen made for ports the framework does not have. The
  // owner decided (2026-09-17) that it goes. The field is gone from the store,
  // so the one thing left to hold is that the plate wears the page's face and
  // draws the page, in both builds.
  for (const g of [harness(), harness(DOC, { view: "page", id: DOC.id }, true)]) {
    await tick();
    expect(g.plate.firstChild.className).toBe("pagebody");
    expect(g.plate.attrs["data-face"]).toBe("page");
    expect(g.drawn.page).toBe(1);
  }
});

test("a page the route names but the store has not got is fetched once", async () => {
  const g = harness(null, { view: "page", id: "board" });
  await tick();
  expect(g.ws.calls.filter((c) => c === "loadPage:board")).toHaveLength(1);
  expect(g.plate.firstChild.className).toBe("pagebody");
});

test("THERE IS ONE PAGE FACE, so every page gets the canvas and fills it", async () => {
  // It used to ask the registry whether this page's render wanted the canvas and
  // answer `doc`, `artifact` or `surface` accordingly. There is no registry and
  // no render: every page is one runtime in one box, it fills, and it scrolls
  // inside itself. The measure a paragraph needs moved into the section that
  // draws the paragraph, which is what lets the section beside it be full-bleed.
  const g = harness(BOARD, { view: "page", id: "board" });
  expect(g.plate.attrs["data-face"]).toBe("page");

  g.ui.go("page", "notes");
  await tick();
  expect(g.plate.attrs["data-face"]).toBe("page");

  // A sentence on the canvas is not a box and wants the padding a box does not,
  // so the face is withheld until the page is actually on screen.
  g.ui.go("page", "nowhere");
  await tick();
  expect(g.plate.attrs["data-face"]).toBe("none");
});

test("THE PAGE IS NAMED BY THE BREADCRUMB IN THE RAIL, not by a heading over the sheet", async () => {
  // There is no `.ptitle` above the content any more. The page's FIRST SECTION
  // owns the top of the sheet — which is the whole point of the format: a page
  // opening with a hero, a board or a chart is no longer forced to open with a
  // heading the host drew. The page still has to be identifiable, so the bar
  // says where it sits: the root, every page on the way down, then the page.
  const g = harness();
  const crumbs = findAll(find(g.rail, (el) => has(el, "crumbs")), (el) => has(el, "crumb"));
  expect(crumbs.map(flat)).toEqual(["Everything", "Notes"]);
  // The last crumb is where you are; the ones before it are ways back up.
  expect(crumbs[1].attrs["aria-current"]).toBe("page");
  expect(crumbs[0].attrs["aria-current"]).toBeUndefined();
  // Nothing in the canvas draws it: the plate holds the page and only the page.
  expect(find(g.plate, (el) => has(el, "ptitle"))).toBeNull();
  // The path on disk is the agent's question, and the seeded root page answers
  // it; the bar no longer carries a PAGE label with the path beside it.
  expect(find(g.rail, (el) => has(el, "rail-job"))).toBeNull();

  // A table's trail is the page that holds it, then the table.
  g.ui.go("table", "jobs");
  await tick();
  expect(findAll(g.rail, (el) => has(el, "crumb")).map(flat)).toEqual(["Everything", "jobs"]);

  // A workspace screen is one crumb under the root.
  g.ui.go("design", "");
  await tick();
  expect(findAll(g.rail, (el) => has(el, "crumb")).map(flat)).toEqual(["Everything", "Design"]);
});

test("the bar holds Reload, and Share and the page's two screens on a page, in both builds", async () => {
  // THE BAR IS A BREADCRUMB AND THE FEW REAL ACTIONS. Reload is the one action
  // every route adds; Share joins it on a page, because a page is the thing a
  // share captures and the design doc is not shared, and the page's two
  // screens — Instructions and Automations — come after it. Agent Terminal
  // joins them when this window has a workspace to run one in (the
  // rightmost-action test below covers that). There is no menu, no Config, no
  // History and no Modify page: the owner decided (2026-09-17) that the three
  // go rather than hide, so this is asserted in the development build as well
  // as the built one — and Share and the two screens are in both builds too,
  // because they are product features and not diagnostics.
  for (const g of [harness(), harness(DOC, { view: "page", id: DOC.id }, true)]) {
    await tick();
    const tools = find(g.rail, (el) => has(el, "tools"));
    expect(findAll(tools, (el) => el.tagName === "BUTTON").map(flat)).toEqual(["Reload", "Share", "Instructions", "Automations"]);
    expect(find(tools, (el) => has(el, "more"))).toBeNull();
    expect(find(tools, (el) => has(el, "viewsw"))).toBeNull();
    g.ui.go("design", "");
    await tick();
    expect(findAll(find(g.rail, (el) => has(el, "tools")), (el) => el.tagName === "BUTTON").map(flat))
      .toEqual(["Reload"]);
  }
});

/* ── there is no edit toggle ───────────────────────────────────────────── */

test("no page is offered a mode to unlock, because none of them has one", async () => {
  // A PAGE IS EDITABLE THE MOMENT IT IS DRAWN. The words take a caret, the
  // sections and the items inside them drag, and every section draws its own way
  // to add a part and take one away — all of it inside the box, none of it
  // gated. The bar used to carry an "Edit content" button and a page you had to
  // unlock before typing in it read as a demo of a page.
  for (const g of [
    harness(BOARD, { view: "page", id: "board" }),
    harness(DOC),
    harness(WITH_BLOCK, { view: "page", id: "rates" }),
  ]) {
    expect(byText(g.rail, "Edit content")).toBeNull();
  }
});

test("nothing about a mode is ever broadcast to a frame", async () => {
  const g = harness(WITH_BLOCK, { view: "page", id: "rates" });
  await tick();
  g.ui.go("design", "");
  await tick();
  g.ui.go("page", "rates");
  await tick();
  // `edit` is not a HostEvent any more. A frame that heard one would be a frame
  // built against a wire this host no longer speaks.
  expect(g.frameHost.sent.some((m) => m && m.kind === "edit")).toBe(false);
});

/* ── THE ONE THIS FILE IS FOR ──────────────────────────────────────────── */

test("a repaint with unchanged content does not replace the root node", async () => {
  const g = harness(WITH_BLOCK, { view: "page", id: "rates" });
  const node = g.plate.firstChild;
  expect(g.drawn.page).toBe(1);

  // Every emit a page can produce while nothing about it moved: a store emit
  // that changed something else, the rail re-sorting, a no-op ui write.
  g.ws.emit();
  g.ws.emit();
  g.ui.set({ treeOrder: "desc" });
  g.ui.set({ treeOrder: "asc" });
  g.shell.repaint();
  await tick();

  expect(g.plate.firstChild).toBe(node);
  expect(g.drawn.page).toBe(1);
});

test("a page the store actually replaced is redrawn", async () => {
  const g = harness(WITH_BLOCK, { view: "page", id: "rates" });
  const node = g.plate.firstChild;

  // What every write in the workspace store does: a new object for the thing it
  // changed. Identity is the signal, which is why nothing here deep-compares.
  g.ws.state.page = { ...WITH_BLOCK, variables: { heading: "Rates" } };
  g.ws.emit();
  await tick();

  expect(g.plate.firstChild).not.toBe(node);
  expect(g.drawn.page).toBe(2);
});

test("the chrome around it is rebuilt freely — nothing in it is a frame", async () => {
  const g = harness();
  const railBefore = g.rail.children[0];
  g.ws.emit();
  await tick();
  expect(g.rail.children[0]).not.toBe(railBefore);
  // and the rail is still the same element, so the bar itself never moves
  expect(g.app.children[0]).toBe(g.rail);
});

/* ── THE INVARIANT, END TO END ─────────────────────────────────────────────
   The shell and the page view are one mechanism for this question, so these
   wire the REAL page view in rather than a recording stand-in: a body that
   comes back unchanged is worth nothing if the thing building it hands back a
   new tree every time.

   AFTER ANY STORE WRITE, AN IFRAME THAT WAS IN THE DOCUMENT IS THE SAME
   ELEMENT, STILL IN IT, AND WAS NEVER TAKEN OUT. Element identity alone cannot
   see the re-parent — the frame host hands back the same element whether or not
   the host moved it — so `moved` counts the insert, which is the thing that
   actually restarts the realm. */

/** The page as the store hands it back after a read: a new object, and new
 *  section objects with it. */
const reread = (page) => ({ ...page, sections: page.sections.map((s) => ({ ...s })) });

/** Still somewhere under the root the shell was mounted into. */
const inDoc = (node, root) => {
  for (let n = node; n; n = n.parent) if (n === root) return true;
  return false;
};

function withFrames(page = WITH_BLOCK, route = { view: "page", id: page.id }) {
  const ws = fakeWs(page);
  const ui = makeUi({ route });

  // Keyed and reused, exactly like client/frame/frame.js: the same key hands
  // back the same element whether or not the html changed.
  const frames = new Map();
  const frameHost = {
    sent: [],
    keys: [],
    setShim() {}, drop() {}, refresh() {}, compliance() { return null; }, keep() {},
    broadcast(ev) { this.sent.push(ev); },
    for(key) {
      frameHost.keys.push(key);
      let frame = frames.get(key);
      if (!frame) { frame = { el: element("iframe"), post() {}, drop() {} }; frames.set(key, frame); }
      return frame;
    },
  };

  const { views } = fakeViews();
  const shell = makeShell({
    h, fill, ws, ui, frameHost,
    views: { ...views, page: makePageView({ h, frameHost, ws, ui }) },
  });

  ws.on(() => shell.repaint());
  ui.on(() => shell.repaint());

  const root = element("div");
  shell.mount(root);
  const app = root.children[0];
  const rail = app.children[0];
  const plate = app.children[1].children[1].children[4];
  return { ws, ui, shell, frameHost, frames, root, rail, plate };
}

test("no store write moves a frame on the page — whatever it was that changed", async () => {
  const g = withFrames();
  // ONE BOX PER PAGE, keyed by the page's own id. Not a key per section: the box
  // IS the page, and a key carrying a revision would be a new element on every
  // write, which is the user's caret thrown away.
  expect(g.frameHost.keys).toEqual(["rates"]);
  const frame = g.frames.get("rates").el;
  const body = g.plate.firstChild;
  const moved = frame.moved;
  expect(inDoc(frame, g.root)).toBe(true);

  // Each of these is exactly what workspace.js leaves in the snapshot after one
  // of its actions, which is the only thing a view can see.
  const writes = {
    // patchVariables: the page's own values are swapped, its sections are not
    "a value the runtime wrote itself": () => { g.ws.state.page = { ...g.ws.state.page, variables: { rate: 90 } }; },
    // writeFile / reloadPage: the page is re-read, so every section object is new
    "a paragraph typed on the same page": () => { g.ws.state.page = reread(g.ws.state.page); },
    // insertRow / updateRow: the table list is rebuilt around the new count
    "a row written into a table": () => { g.ws.state.tables = g.ws.state.tables.map((t) => ({ ...t, rows: t.rows + 1 })); },
    // setTheme: a new theme object, which reaches the box as data and nothing else
    "the vault's theme rewritten": () => { g.ws.state.theme = { ...THEME }; },
    // createPage / moveChild / removePage: the tree is re-listed
    "a page renamed elsewhere in the tree": () => { g.ws.state.pages = g.ws.state.pages.map((p) => ({ ...p })); },
    // setSections: the shape moved, so the page is re-read
    "a section added below it": () => {
      const page = g.ws.state.page;
      g.ws.state.page = reread({ ...page, sections: [...page.sections, sect("s3", { body: prose("New section") })] });
    },
    "and the same section taken away": () => {
      const page = g.ws.state.page;
      g.ws.state.page = reread({ ...page, sections: page.sections.slice(0, 2) });
    },
  };

  for (const [what, write] of Object.entries(writes)) {
    write();
    g.ws.emit();
    await tick();
    expect(`${what}: ${frame.moved}`).toBe(`${what}: ${moved}`);
    expect(inDoc(frame, g.root)).toBe(true);
    expect(g.frames.get("rates").el).toBe(frame);
    expect(g.plate.firstChild).toBe(body);
  }

  // AND THE DOCUMENT NEVER CHANGED. It carries no page content at all — the
  // runtime asks for that over its port once it has one — so the html handed to
  // `for` is byte-identical every time, which is what makes the box reusable at
  // all rather than merely un-moved.
  expect(new Set(g.frameHost.keys)).toEqual(new Set(["rates"]));
});

test("the box does not restart itself when the page it is drawing saves", async () => {
  const g = withFrames();
  const frame = g.frames.get("rates").el;
  const moved = frame.moved;
  expect(inDoc(frame, g.root)).toBe(true);

  // biom.data.set → the bridge → patchVariables → a new Page and one emit.
  g.ws.state.page = { ...WITH_BLOCK, variables: { done: 4 } };
  g.ws.emit();
  await tick();

  expect(frame.moved).toBe(moved);
  expect(inDoc(frame, g.root)).toBe(true);

  // AND AGAIN, because a save arrives on every keystroke's debounce and a box
  // that survived the first one and not the tenth would be the same bug found
  // later. There is no mode to leave and come back from any more; typing IS the
  // whole loop, so this is the loop.
  g.ws.state.page = { ...WITH_BLOCK, variables: { done: 5 } };
  g.ws.emit();
  await tick();
  expect(frame.moved).toBe(moved);
  expect(inDoc(frame, g.root)).toBe(true);
});

/* ── reload, which is the whole change loop ────────────────────────────── */

test("reload re-reads the page and re-lists the tree", async () => {
  const g = harness();
  byButton(g.rail, "Reload").fire("click");
  await tick();
  await tick();

  expect(g.ws.calls).toContain("reloadPage:notes");
  // The tree matters as much as the page: a page Claude Code has just CREATED
  // has to turn up without refreshing the browser.
  expect(g.ws.calls).toContain("loadTree");
  expect(byButton(g.rail, "Reload")).not.toBeNull();
  // AND THE READER'S PLACE IS KEPT THROUGH IT. `keep` is said for the page on
  // the route, and it is said BEFORE the teardown — the realm that reported
  // where it was scrolled to is the one `reloadPage` is about to replace.
  expect(g.frameHost.kept).toEqual(["notes"]);
});

test("keeping the reader's place is a redraw's alone: a navigation never says keep", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  g.ui.go("page", "home/other");
  await tick();
  g.ui.go("page", "notes");
  await tick();
  // The mount outlives its realm either way, so a page come back to from the
  // rail would land where the reader last left it if anything but a redraw
  // asked. Nothing but `doReload` does.
  expect(g.frameHost.kept).toEqual([]);
});

/* ── disk wins, and the save that must be dropped for it to ────────────── */

// THE RULE THIS GUARDS is written beside `SAVE_AFTER` in `guest/runtime/edit.js`.
// An automatic redraw must go through `reloadPage`, which sets the page to null
// and emits — and that is what tears the frame down (`client/frame/frame.js`:
// *only a changed html, `drop` and `reloadPage` tear one down*). The 350 ms save
// timer lives in the box's realm, so the realm going away is what drops it.
//
// A path written to stop the flicker would reuse the frame while its html was
// unchanged, leave the box alive with its timer armed, and let the person's
// stale text land over the agent's a moment later. That failure is invisible
// until it happens, which is why it is a test and not a comment.

test("an external change re-runs Reload, and the redraw goes through reloadPage", async () => {
  const events = fakeEvents();
  const g = harness(DOC, { view: "page", id: "notes" }, false, events);
  expect(events.listeners).toBe(1);

  events.fire();
  await tick();
  await tick();

  // THE TEARDOWN, not a cheaper redraw. This is the whole of the dropped save.
  expect(g.ws.calls).toContain("reloadPage:notes");
  // The watcher's redraw keeps the reader's place exactly as the button does:
  // one path, one `keep`, for the page on the route.
  expect(g.frameHost.kept).toEqual(["notes"]);
  // The tree as well: a page an agent has just CREATED has to turn up in the
  // rail without anybody refreshing the browser.
  expect(g.ws.calls).toContain("loadTree");
  // AND NOTHING OF WHAT WAS TYPED GOES TO DISK. A redraw reads; it never writes,
  // so there is no path by which the box's pending text can reach a file.
  expect(g.ws.calls.filter((c) => /^(write|createPage|movechild|patch)/i.test(c))).toEqual([]);
  // The button is still there and still says what it does.
  expect(byButton(g.rail, "Reload")).not.toBeNull();
});

test("a change landing mid-reload is read once more, not queued up", async () => {
  const events = fakeEvents();
  const g = harness(DOC, { view: "page", id: "notes" }, false, events);

  // Three in a burst while the first pass is still running. What a redraw reads
  // is the current state of disk, so two pending changes and one are the same
  // amount of work — the flag is deliberately a flag and not a queue.
  events.fire();
  events.fire();
  events.fire();
  for (let i = 0; i < 8; i++) await tick();

  const reloads = g.ws.calls.filter((c) => c === "reloadPage:notes").length;
  expect(reloads).toBeGreaterThanOrEqual(1);
  expect(reloads).toBeLessThanOrEqual(2);
});

/* ── the panels, which are chrome and say so ───────────────────────────── */

// THE ONE CLAIM THE APPLICATION HAS NO RIGHT TO MAKE. A workspace on a machine
// with no git has no undo at all, and the person is entitled to know.
// `VaultInfo.history` is the fact, and only the bad news is ever said: a vault
// that IS keeping versions goes on saying nothing. The strip is the one surface
// that says it — there was a History panel that said it too, and the owner
// decided (2026-09-17) that the panel goes; a version list, when one is built,
// is its own spec and reads the same fact.
test("a workspace with no history says so on the strip, once", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  g.ws.history = false;
  // The shell reads `vaultInfo` off its own paint, so the answer is in hand
  // after one turn rather than at mount.
  await tick();
  await tick();

  const said = flat(g.strip);
  expect(said).toContain("are not being kept");
  expect(said.split("are not being kept").length - 1).toBe(1);
});

// THE SILENCE IS THE OTHER HALF, and it is the default. A folder that is keeping
// versions has nothing to act on, so nothing is said — and an unread `vaultInfo`
// is silent too, because an absent fact is not a negative one.
test("a workspace that is keeping versions says nothing about it", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  await tick();
  await tick();
  expect(flat(g.strip)).not.toContain("not being kept");
});

/* ── the New-page dialog, which is the screen a stranger reaches first ─── */

test("the dialog offers the two things you can make, and asks only for a name", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  find(g.rack, (el) => el.className === "newpage").fire("click");
  await tick();

  const dlg = find(g.root, (el) => el.className === "dialog");
  expect(dlg).not.toBeNull();

  const tiles = [];
  (function walk(el) {
    if (has(el, "kind")) tiles.push(flat(el));
    for (const k of el.children) if (k instanceof El) walk(k);
  })(dlg);

  // TWO, and there is nothing left to pick between. A page held sections drawn
  // by a render, or it took the whole sheet with its own HTML, and choosing
  // between those was the first thing this dialog asked. A page is one thing
  // now, so the question has one answer and asking it would be a control that
  // cannot be got right or wrong.
  expect(tiles).toHaveLength(2);
  expect(tiles[0]).toContain("Page");
  expect(tiles[1]).toContain("Table");
  expect(tiles.join(" ")).not.toContain("Doc");

  // The button that asked what you wanted and handed back a prompt to paste is
  // gone, and so is the door to the shop: the catalogue was written against the
  // render layer and went with it.
  expect(tiles.join(" ")).not.toContain("Custom");
  expect(tiles.join(" ")).not.toContain("Marketplace");
  expect(find(dlg, (el) => el.tagName === "TEXTAREA")).toBeNull();

  // ONE FIELD, AND IT IS THE NAME. A page cannot be renamed from the app, so a
  // name not asked for here is a page stuck as Untitled. A parent is still the
  // row whose plus you pressed, so there is nothing to select.
  expect(findAll(dlg, (el) => el.tagName === "INPUT")).toHaveLength(1);
  expect(find(dlg, (el) => el.tagName === "SELECT")).toBeNull();
  // And the promise of a rename that does not exist is gone.
  expect(flat(dlg)).not.toContain("until you rename it");

  // There is no folder, and nothing here calls a model.
  expect(tiles.join(" ")).not.toContain("Folder");
  expect(find(dlg, (el) => el.className === "entry")).toBeNull();
});

test("Page makes one immediately and opens it", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  find(g.rack, (el) => el.className === "newpage").fire("click");
  await tick();

  const dlg = find(g.root, (el) => el.className === "dialog");
  find(dlg, (el) => has(el, "kind") && flat(el).startsWith("Page")).fire("click");
  await tick();
  await tick();

  // A NAME AND A PARENT, and nothing else — there is no kind on `PageInit`. No
  // parent named here, so `create` parents to the root and the client never has
  // to know the root's id, which is what keeps that a vault-format fact.
  expect(g.ws.calls).toContain("createPage:Untitled:undefined");
  expect(find(g.root, (el) => el.className === "dialog")).toBeNull();
  // Whatever id the server minted, the dialog lands you on it — it does not
  // guess one from the name, which is why `createPage` hands back a PageRef.
  expect(g.ui.get().route).toEqual({ view: "page", id: "scratch" });
});

test("a name typed in New is the page's name, and Enter makes exactly one", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  find(g.rack, (el) => el.className === "newpage").fire("click");
  await tick();

  const dlg = find(g.root, (el) => el.className === "dialog");
  const field = find(dlg, (el) => el.tagName === "INPUT");
  field.value = "Q3 review";
  // Twice, as a held key or a double press would: one page, not two.
  field.fire("keydown", { key: "Enter" });
  field.fire("keydown", { key: "Enter" });
  await tick();
  await tick();

  expect(g.ws.calls.filter((c) => c.startsWith("createPage:"))).toEqual(["createPage:Q3 review:undefined"]);
  expect(g.ui.get().route).toEqual({ view: "page", id: "scratch" });
});

test("New names the page it is making inside by its name, not its id", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  g.ui.set({ dialog: true, dialogParent: "board" });
  await tick();
  const dlg = find(g.root, (el) => el.className === "dialog");
  expect(flat(find(dlg, (el) => el.tagName === "H2"))).toBe("New inside Job board");
});

test("Table makes one and lands you on it", async () => {
  const g = harness(DOC, { view: "page", id: "notes" });
  find(g.rack, (el) => el.className === "newpage").fire("click");
  await tick();

  const dlg = find(g.root, (el) => el.className === "dialog");
  find(dlg, (el) => has(el, "kind") && flat(el).startsWith("Table")).fire("click");
  await tick();
  await tick();

  // A table is a child in the tree exactly as a page is, so the plus that
  // offered only pages was offering half the answer.
  expect(g.ws.calls).toContain("createTable:table");
  expect(g.ui.get().route).toEqual({ view: "table", id: "table" });
});

/* ── the rail: ONE tree, and every ordering is some page's order ───────── */

// The tree is drawn here rather than in the page tests because it is chrome:
// it is the root page's children, recursively, and the only thing it writes is
// one `moveChild` — which MOVES A DIRECTORY and answers the page's new id.

// A PAGE ID IS A PATH, because the folder is the hierarchy: a child of `home`
// lives at `pages/home/children/Notes/` and is called `home/Notes`. A table's
// name is not a path — it is a database table, and it is parented rather than
// contained.
const KIDS = {
  home: [
    { kind: "page", id: "home/Notes", name: "Notes" },
    { kind: "table", id: "jobs", name: "jobs", rows: 12 },
    { kind: "page", id: "home/Board", name: "Job board" },
  ],
  "home/Notes": [{ kind: "page", id: "home/Notes/Rates", name: "Rates" }],
};

/** A drag event the fake element factory can carry. `dataTransfer` is absent,
 *  which is the branch the view has to survive anyway. */
const drag = () => ({ preventDefault() {}, dataTransfer: null });

function tree(kids = KIDS, { expanded = [], route = { view: "page", id: "home/Notes" }, treeOrder = "asc" } = {}) {
  const moves = [];
  const made = [];
  const ws = {
    get: () => ({ pages: [], tables: [], theme: THEME, page: null, table: null }),
    children: (id) => kids[id] ?? [],
    async createPage(init) {
      made.push({ name: init.name, parent: init.parent });
      return { id: "made", name: init.name };
    },
    // Three arguments, not four. There is no `before`: the hairline that placed
    // a row within a level went with the ordering it wrote. And it ANSWERS THE
    // NEW ID, because moving a page renames it and everything beneath it.
    async moveChild(child, from, to) {
      moves.push([child.kind + ":" + child.id, from, to]);
      return child.kind === "page" ? to + "/" + child.id.slice(child.id.lastIndexOf("/") + 1) : null;
    },
  };
  const ui = makeUi({ route, expanded: new Set(expanded), treeOrder });
  return { ws, ui, moves, made, draw: makeTreeView({ h, ws, ui }) };
}

const rowsOf = (root) => findAll(root, (el) => el.tagName === "A");
const gapsOf = (root) => findAll(root, (el) => has(el, "gap"));

test("the rail is the root page's children, with tables in the same list", () => {
  const g = tree();
  // A table is a row like any other, tagged for what it is — which is what lets
  // it sit under the page that uses it instead of in a drawer marked TABLES.
  // TWO TAGS, NOT FOUR: the tag says whether a row is a page or a table, and
  // there is no page kind left for it to distinguish.
  const rows = rowsOf(g.draw());
  expect(rows.map(flat)).toEqual(["Notes", "jobs", "Job board"]);
  // The tag is a glyph the stylesheet draws from the kind, not a word.
  const kinds = rows.map((r) => find(r, (el) => has(el, "kindtag")).attrs["data-kind"]);
  expect(kinds).toEqual(["page", "table", "page"]);
});

// WHICH WAY THE RAIL READS, and it REVERSES rather than re-sorts. The order the
// page hands back is its own arrangement — which for anything the reader placed
// is id order, and an id is the filename, so a folder of notes named
// `2026-07-30-…` reads newest first when this is flipped. Sorting it again in
// the view would overrule the one part of the order that belongs to the user.
test("descending reads the page's own order backwards, at every level", () => {
  const up = tree(KIDS, { expanded: ["home/Notes"] });
  expect(rowsOf(up.draw()).map(flat)).toEqual(["Notes", "Rates", "jobs", "Job board"]);

  const down = tree(KIDS, { expanded: ["home/Notes"], treeOrder: "desc" });
  // The top level reversed, and the open branch reversed inside it rather than
  // the whole flat list being turned over — a child stays under its parent.
  expect(rowsOf(down.draw()).map(flat)).toEqual(["Job board", "jobs", "Notes", "Rates"]);
});

test("a branch is only walked when it is expanded", () => {
  const shut = tree();
  expect(rowsOf(shut.draw())).toHaveLength(3);

  const open = tree(KIDS, { expanded: ["home/Notes"] });
  const rows = rowsOf(open.draw());
  expect(rows.map(flat)).toEqual(["Notes", "Rates", "jobs", "Job board"]);
  expect(rows[1].style["--depth"]).toBe("1");
});

test("the line at the foot of the rail is the way back out to the top level", () => {
  // THE HAIRLINE BETWEEN TWO ROWS IS GONE, and this test moved with it rather
  // than being deleted. It went with the ordering it wrote: a level's order is
  // its parent's `contents`, no wire kind writes one, and a gesture that appears
  // to place a row and loses it on reload is worse than one not offered. What is
  // left is the only question a drop can still answer — WHICH LEVEL — so there
  // is one target instead of one between every pair of rows, and it answers
  // "the top one".
  const g = tree(KIDS, { expanded: ["home/Notes"] });
  const root = g.draw();
  const gaps = gapsOf(root);
  expect(gaps).toHaveLength(1);
  const gap = gaps[0];

  rowsOf(root)[1].fire("dragstart", drag());        // Rates, which is inside Notes
  gap.fire("dragover", drag());
  expect(has(gap, "over")).toBe(true);
  gap.fire("drop", drag());

  expect(g.moves).toEqual([["page:home/Notes/Rates", "home/Notes", "home"]]);
});

test("the outdent line refuses a row that is already at the top level", () => {
  // Where it already is. The rail asks for no write rather than asking for one
  // that would rename a directory onto itself.
  const g = tree();
  const root = g.draw();
  rowsOf(root)[0].fire("dragstart", drag());        // Notes, already in home
  const gap = gapsOf(root)[0];
  gap.fire("drop", drag());

  expect(g.moves).toEqual([]);
});

test("a drop onto a page puts it inside, at the end, and opens it", () => {
  const g = tree();
  const root = g.draw();
  const rows = rowsOf(root);
  rows[1].fire("dragstart", drag());                // the table
  rows[0].fire("dragover", drag());                 // onto Notes
  expect(has(rows[0], "into")).toBe(true);
  rows[0].fire("drop", drag());

  // At the end, which is the Notion behaviour: nothing already placed moves to
  // let an arrival in.
  expect(g.moves).toEqual([["table:jobs", "home", "home/Notes"]]);
  // and the branch opens, or what you just dropped has vanished
  expect(g.ui.get().expanded.has("home/Notes")).toBe(true);
});

test("a page cannot be dropped into itself or into its own child", () => {
  const g = tree(KIDS, { expanded: ["home/Notes"] });
  const root = g.draw();
  const rows = rowsOf(root);                        // Notes, Rates, jobs, board
  rows[0].fire("dragstart", drag());                // Notes
  rows[1].fire("dragover", drag());                 // onto Rates, which is inside it
  expect(has(rows[1], "into")).toBe(false);
  rows[1].fire("drop", drag());
  rows[0].fire("drop", drag());
  expect(g.moves).toEqual([]);
});

test("nothing the walk missed is hidden — an unclaimed page or table is at the root", () => {
  const children = (id) => (id === "home" ? KIDS.home.slice(0, 1) : []);
  // No `parent:` on either page. The id is the path, so where a page sits is
  // read off the id and there is no second field that could disagree with it —
  // `gone/lost` is under a page that is not in the list, and is therefore lost.
  const rows = nest(children, new Set(),
    [{ id: "home/Notes", name: "Notes" }, { id: "gone/lost", name: "Lost" }],
    [{ name: "jobs", kind: "basic", rows: 2, parent: null }]);

  expect(rows.map((r) => r.child.kind + ":" + r.child.id))
    .toEqual(["page:home/Notes", "page:gone/lost", "table:jobs"]);
  expect(rows.every((r) => r.parent === "home")).toBe(true);
});

test("a cycle in what pages claim to hold does not hang the rail", () => {
  const loop = {
    home: [{ kind: "page", id: "home/A", name: "A" }],
    "home/A": [{ kind: "page", id: "home", name: "Home" }],
  };
  expect(nest((id) => loop[id] ?? [], new Set(["a", "home"]), [], []).length)
    .toBeLessThanOrEqual(2);
});

/* ── failure ───────────────────────────────────────────────────────────── */

test("a workspace that could not be read says so rather than going blank", () => {
  const g = harness();
  g.shell.trouble(new Error("the server did not answer"));
  expect(g.plate.firstChild.className).toBe("startfail");
  expect(flat(g.plate.firstChild)).toContain("the server did not answer");
});

test("a child inside a closed folder stays inside it", () => {
  // The bug: everything the walk did not reach was surfaced at the root, and a
  // collapsed ancestor is a reason not to reach something. So closing a folder
  // appeared to move its contents out of it.
  //
  // The ids are PATHS and carry no `parent:`, because the folder is the
  // hierarchy: `home/Notes/Rates` says where it sits, and the rescue reads its
  // ancestry off the id rather than off a field that could disagree with it.
  const kids = {
    home: [{ kind: "page", id: "home/Notes", name: "Notes" }],
    "home/Notes": [
      { kind: "page", id: "home/Notes/Rates", name: "Rates" },
      { kind: "table", id: "jobs", name: "jobs", rows: 12 },
    ],
  };
  const pages = [
    { id: "home", name: "Home" },
    { id: "home/Notes", name: "Notes" },
    { id: "home/Notes/Rates", name: "Rates" },
  ];
  // A table's parent is still a field: it has no directory, so being held by a
  // page is registry state rather than where it sits.
  const tables = [{ name: "jobs", kind: "basic", rows: 12, parent: "home/Notes" }];
  const children = (id) => kids[id] ?? [];

  const shut = nest(children, new Set(), pages, tables);
  expect(shut.map((r) => r.child.id)).toEqual(["home/Notes"]);

  const open = nest(children, new Set(["home/Notes"]), pages, tables);
  expect(open.map((r) => r.child.id)).toEqual(["home/Notes", "home/Notes/Rates", "jobs"]);
  expect(open.find((r) => r.child.id === "home/Notes/Rates").depth).toBe(1);
});

test("a page whose parent is gone is still reachable", () => {
  // The other half, and why the rescue exists: its id says it lives under a page
  // that is in nobody's list, so nothing's `children/` reaches it and it would be
  // lost entirely.
  const pages = [
    { id: "home", name: "Home" },
    { id: "deleted-page/stray", name: "Stray" },
  ];
  const rows = nest(() => [], new Set(), pages, []);
  expect(rows.map((r) => r.child.id)).toEqual(["deleted-page/stray"]);
  expect(rows[0].depth).toBe(0);
});

test("every page row can start a page inside it; a table row cannot", async () => {
  const g = tree({
    home: [
      { kind: "page", id: "home/Notes", name: "Notes" },
      { kind: "table", id: "jobs", name: "jobs", rows: 12 },
    ],
  });
  const root = g.draw();
  const adds = findAll(root, (el) => has(el, "rowadd"));
  // One per page, none for the table: a table holds rows, not pages.
  expect(adds).toHaveLength(1);

  adds[0].fire("click", { preventDefault() {}, stopPropagation() {} });
  await tick();
  // It opens the dialog FOR that row: a page or a table both belong inside the
  // level you pressed.
  expect(g.ui.get().dialog).toBe(true);
  expect(g.ui.get().dialogParent).toBe("home/Notes");
  expect(g.made).toEqual([]);
  // and the parent opens, or whatever is made lands inside a shut row
  expect(g.ui.get().expanded.has("home/Notes")).toBe(true);
});

// EVERY OPEN PAGE ENDS IN A PLUS: the last row under its children is a way to
// make one there, at the children's own depth. The hover-only plus on the row
// itself was found by nobody, and a control nobody finds is a control that is
// not there.
test("an open page ends in a New page row at its children's depth; a shut one does not", async () => {
  const shut = tree();
  expect(findAll(shut.draw(), (el) => has(el, "addrow"))).toHaveLength(0);

  const g = tree({
    home: [
      { kind: "page", id: "home/Notes", name: "Notes" },
      { kind: "page", id: "home/Board", name: "Job board" },
    ],
    "home/Notes": [
      { kind: "page", id: "home/Notes/Rates", name: "Rates" },
      { kind: "page", id: "home/Notes/Sites", name: "Sites" },
    ],
    "home/Notes/Rates": [{ kind: "page", id: "home/Notes/Rates/Old", name: "Old" }],
  }, { expanded: ["home/Notes", "home/Notes/Rates"] });
  const root = g.draw();
  // Read top to bottom: the plus for Rates closes Rates' children, BEFORE
  // Sites, and the plus for Notes comes after everything Notes holds.
  const order = findAll(root, (el) => el.tagName === "A" || has(el, "rowaddin"))
    .map((el) => (has(el, "rowaddin") ? "+" + el.attrs["aria-label"] : flat(el)));
  expect(order).toEqual([
    "Notes", "Rates", "Old", "+New page inside Rates", "Sites", "+New page inside Notes", "Job board",
  ]);
  const adds = findAll(root, (el) => has(el, "rowaddin"));
  expect(adds.map((el) => el.style["--depth"])).toEqual(["2", "1"]);

  adds[1].fire("click", { preventDefault() {}, stopPropagation() {} });
  await tick();
  expect(g.ui.get().dialog).toBe(true);
  expect(g.ui.get().dialogParent).toBe("home/Notes");
});

// A NEW TABLE NEEDS A NAME NOBODY HOLDS. The server refuses a duplicate, so a
// plus pressed twice in a row would fail the second time on a name we chose.
test("a new table takes the first free name", () => {
  expect(freeTableName([])).toBe("table");
  expect(freeTableName(["table"])).toBe("table 2");
  expect(freeTableName(["table", "table 2", "table 3"])).toBe("table 4");
  // A gap is filled rather than skipped past.
  expect(freeTableName(["table", "table 3"])).toBe("table 2");
});

/* ── the design doc, which is one page outside the page tree ───────────────
 *
 * It is the workspace's own design language, bundled with every vault and edited
 * like any other doc, and it is what keeps generated UI coherent rather than
 * generic. It lives at `design/`, beside `pages/` — so the rail, which draws
 * `pages/`, cannot see it and never had to learn about it. A user may keep a
 * page of their own called "design" and the two never collide.
 *
 * It reaches the shell as a workspace screen: a row at the foot of the rail,
 * like Theme and the vault, and a route of its own. */

test("the rail's foot lists Design, the Map, then Close workspace", async () => {
  const g = harness();
  await tick();

  const foot = find(g.rack, (el) => has(el, "rackfoot"));
  const rows = findAll(foot, (el) => el.tagName === "A").map(flat);
  // The design language, the workspace's own instructions, every run, the map,
  // and the way out last. There was a Settings row here — the picker drawn
  // INSIDE the chrome, with the folder open behind it — and the owner decided
  // (2026-09-14) that it does what the start page does and looks five times
  // worse. The screen went; the act stayed.
  expect(rows).toEqual(["Design", "Instructions", "Automations", "Map", "Close workspace"]);
  // THE TAG IS DRAWN FROM `data-kind` AND IS NOT TEXT IN THE ROW, which is why
  // it is asserted here rather than read off the name: a brush, a folded map,
  // a doorway.
  const tags = findAll(foot, (el) => has(el, "kindtag")).map((el) => el.attrs["data-kind"]);
  expect(tags).toEqual(["design", "instructions", "runs", "map", "close"]);
});

test("Design is a route like any other, and the rail names the folder it is", async () => {
  const g = harness();
  await tick();

  find(g.rack, (el) => el.tagName === "A" && flat(el) === "Design")
    .fire("click", { preventDefault() {} });
  await tick();

  expect(g.ui.get().route).toEqual({ view: "design", id: "" });
  expect(g.plate.firstChild.className).toBe("designdoc");
  expect(g.drawn.design).toBe(1);
  // It is a doc, so it takes a doc's measure rather than the canvas.
  expect(g.plate.attrs["data-face"]).toBe("design");
  expect(findAll(g.rail, (el) => has(el, "crumb")).map(flat)).toEqual(["Everything", "Design"]);
});

test("the design doc is read through the store as @design, an unrelated repaint leaves it alone, and Reload re-reads it as a page", async () => {
  const g = harness(DOC, { view: "design", id: "" });
  await tick();
  // A PAGE READ UNDER A RESERVED ID, asked for exactly as a routed page is, and
  // handed to the view as that read — which is what lets the `doc` document
  // the server resolved draw it, rungs and all.
  expect(g.ws.calls).toContain("loadPage:@design");
  const node = g.plate.firstChild;
  expect(g.drawn.design).toBe(1);
  expect(flat(node)).toBe("@design");

  // Nothing that repaints the shell may take this screen apart — an artifact on
  // the design doc would be restarted by an unrelated keystroke somewhere else.
  g.ws.emit();
  g.ui.set({ treeOrder: "desc" });
  await tick();
  expect(g.plate.firstChild).toBe(node);
  expect(g.drawn.design).toBe(1);

  // Reload IS the loop, and an agent rewriting `design/` is the case it is for.
  // It is a page reload: the box torn down and the read taken again from disk.
  find(g.rail, (el) => el.tagName === "BUTTON" && flat(el) === "Reload").fire("click");
  await tick();
  expect(g.ws.calls).toContain("reloadPage:@design");
  expect(g.frameHost.kept).toContain("@design");
  expect(g.drawn.design).toBe(2);
});

/* ── the vault: which folder this workspace IS ─────────────────────────────
 *
 * Picking one is the whole of getting started, so it is not a setting buried on
 * a screen: the rail's foot says the folder's name and IS the way in. Opening an
 * empty one sets it up, which is why the note beside an unmarked folder is good
 * news rather than a warning.
 *
 * The server browsing its own filesystem is only reasonable because this framework
 * is local and unsecured by decision. None of it is a pattern to carry forward. */

test("Close workspace is a real address back to the start page, and it keeps the token", async () => {
  // IT IS AN `href` AND NOT A HANDLER, which is the whole of how it works: the
  // start page is this window's own address with the folder taken out of it, so
  // leaving a workspace is a navigation exactly as entering one is. The browser
  // does it, and middle-click opens the start page in a second tab for free.
  const g = harness(DOC, { view: "page", id: DOC.id }, false, undefined, false,
    "?token=abc123&vault=%2Fw%2Fone");
  await tick();

  const foot = find(g.rack, (el) => has(el, "rackfoot"));
  const row = find(foot, (el) => el.tagName === "A" && flat(el) === "Close workspace");
  expect(row).not.toBeNull();
  // The per-launch token survives and the folder does not. `#/vault` is the
  // address saying it means no workspace — without it `boot.js` would open the
  // folder last used, which is the one that was just closed.
  expect(row.attrs.href).toBe("?token=abc123#/vault");
  // No handler of its own: nothing here calls `preventDefault`, so nothing here
  // has to know what a modified click means.
  expect(row.attrs.onclick).toBe(undefined);
});

test("the address of the start page keeps every other parameter and drops the folder", () => {
  expect(closeHref("?token=abc123&vault=%2Fw%2Fone")).toBe("?token=abc123#/vault");
  expect(closeHref("?vault=%2Fw%2Fone")).toBe("?#/vault");
  // A window opened with nothing in its query still leaves a query behind, so
  // the address REPLACES the one on screen rather than being resolved against
  // it — a bare "#/vault" would keep the folder it was meant to drop.
  expect(closeHref("")).toBe("?#/vault");
});

test("a first launch draws the start page and no furniture at all", async () => {
  // THERE IS NOTHING FOR A RAIL TO BE A RAIL OF. No workspace is mounted, so a
  // breadcrumb has no page to name, the tree has no tree, and the strip has no
  // sections to count — and a rail offering New page into a folder that does not
  // exist asks a stranger to do something that cannot work. The start page is
  // the window's whole client area under the bar.
  const g = harness(null, { view: "vault", id: "" }, false, undefined, true);
  await tick();

  expect(g.app.className.split(" ")).toContain("bare");
  expect(g.rail.children).toHaveLength(0);
  expect(g.rack.children).toHaveLength(0);
  expect(g.strip.children).toHaveLength(0);
  // And the picker itself is what is on the canvas.
  expect(g.plate.firstChild.className).toBe("vaultpick");
});

test("a typed #/vault draws the start page bare, with a workspace mounted or not", async () => {
  // THERE IS ONE PICKER AND IT IS THE START PAGE. This route used to draw it a
  // second way — inside the chrome, with the open folder behind it and an "Open
  // now" block on top — which is the screen the owner had removed. A route
  // somebody types must not draw a worse copy of a screen that exists, so it
  // draws that screen: the workspace is mounted, the tree is loaded, and the
  // window is still the start page and nothing else.
  const g = harness(DOC, { view: "vault", id: "" });
  await tick();

  expect(g.app.className.split(" ")).toContain("bare");
  expect(g.rail.children).toHaveLength(0);
  expect(g.rack.children).toHaveLength(0);
  expect(g.strip.children).toHaveLength(0);
  expect(g.plate.firstChild.className).toBe("vaultpick");
});

test("the picker is reachable from a workspace that did not open at all", async () => {
  // It is the one screen that can FIX that failure, so it is not behind it.
  const g = harness();
  g.shell.trouble(new Error("the server did not answer"));
  expect(g.plate.firstChild.className).toBe("startfail");

  g.ui.go("vault", "");
  await tick();
  // THE PICKER, WITH WHAT HAPPENED ABOVE IT. The sentence does not go when the
  // route does: somebody who arrives here because their folder would not open
  // needs to be looking at the picker AND to know why, and a screen that
  // dropped the reason on the way would be a folder chooser that appeared for
  // no stated reason.
  expect(g.plate.firstChild.className).toBe("vaulttrouble");
  expect(flat(g.plate.firstChild)).toContain("the server did not answer");
  expect(find(g.plate.firstChild, (el) => has(el, "vaultpick"))).toBeTruthy();
});

test("a workspace that will not open lands ON the picker, with one sentence saying why", () => {
  // THE WHOLE OF THE FAULT-TOLERANT STARTUP, on the client's side of it. Every
  // bad state the server can be handed — a folder that is gone, one that is a
  // file now, one it cannot read, one whose `workspace.db` is not a database,
  // one written for a format this build does not read — arrives here as one
  // refusal carrying one sentence, and `andPick` is what says this is not a
  // workspace that broke but a workspace that is not there.
  const g = harness();
  g.shell.trouble(Object.assign(new Error("there is no folder there"), { code: "not_found" }), true);
  expect(g.ui.get().route).toEqual({ view: "vault", id: "" });
  const screen = g.plate.firstChild;
  expect(screen.className).toBe("vaulttrouble");
  expect(flat(screen)).toContain("there is no folder there");
  // The picker itself, and drawn ONCE — it is built and kept, and a sentence
  // above it must not be a second copy of it.
  expect(find(screen, (el) => has(el, "vaultpick"))).toBeTruthy();
  expect(g.drawn.vault).toBe(1);
});

test("a workspace that opened and then failed keeps the failure screen", () => {
  // THE OTHER HALF OF THE SAME DECISION. `andPick` is off, because the server
  // not answering is not a reason to tell somebody their folder is gone — and
  // the way to the picker is on that screen already.
  const g = harness();
  g.shell.trouble(new Error("the server did not answer"));
  expect(g.ui.get().route.view).not.toBe("vault");
  expect(g.plate.firstChild.className).toBe("startfail");
});

test("a repaint never rebuilds the picker under the walk you are half-way through", async () => {
  const g = harness(DOC, { view: "vault", id: "" });
  await tick();
  const node = g.plate.firstChild;
  expect(g.drawn.vault).toBe(1);

  g.ws.emit();
  g.ui.set({ treeOrder: "desc" });
  await tick();

  expect(g.plate.firstChild).toBe(node);
  expect(g.drawn.vault).toBe(1);
});

/* ── the picker itself ─────────────────────────────────────────────────── */

const HOME = { id: "home", name: "Everything" };

function picker(search = "") {
  const calls = [];
  const state = { pages: [], open: "/w/one" };
  const listings = {
    "/w": {
      at: "/w", up: "/",
      dirs: [
        { name: "one", path: "/w/one", vault: true },
        { name: "fresh", path: "/w/fresh", vault: false },
      ],
    },
    "/w/one": { at: "/w/one", up: "/w", dirs: [] },
  };
  const ws = {
    fails: false,
    get: () => ({ pages: state.pages, tables: [], theme: THEME, page: null, table: null }),
    /** RECORDED RATHER THAN ANSWERED. The picker is the start page now and the
     *  start page is on screen only when no workspace is open, so *which folder
     *  is this* is a question it has no reason to ask — and a call landing here
     *  is the "Open now" block growing back. */
    async vaultInfo() {
      await null;
      calls.push("info");
      return { path: state.open, name: state.open.split("/").pop(), seeded: true, history: true };
    },
    async recentVaults() {
      await null;
      return [
        { path: "/w/one", name: "one", seeded: true },
        { path: "/w/two", name: "two", seeded: true },
      ];
    },
    async browseVault(path) {
      await null;
      calls.push("browse:" + path);
      return listings[path ?? "/w"] ?? { at: "/", up: null, dirs: [] };
    },
    async openVault(path) {
      await null;
      calls.push("open:" + path);
      if (ws.fails) throw new Error("that folder is not readable");
      state.open = path;
      // What the real one leaves behind: a whole different workspace, seeded if
      // the folder was empty.
      state.pages = [HOME, { id: "welcome", name: "Welcome" }];
      return { path, name: path.split("/").pop(), seeded: true, history: true };
    },
    async createVault(parent, name) {
      await null;
      // THE TWO ARGUMENTS ARE RECORDED SEPARATELY, which is the point of the
      // call having two: a picker that joined them here would be the bug the
      // shape exists to make impossible.
      calls.push("create:" + parent + "|" + name);
      if (ws.fails) throw new Error("that folder could not be made");
      const path = parent.replace(/\/+$/, "") + "/" + name;
      state.open = path;
      state.pages = [HOME];
      return { path, name, seeded: true, history: true };
    },
  };
  const ui = makeUi({ route: { view: "vault", id: "" } });
  // Where it went. Opening a folder LEAVES this document now — a vault is an
  // address, so the only way to change the store, the frames, the palette and
  // the route at once and consistently is to load them all again.
  const went = [];
  // A BROWSER, SAID OUT LOUD. `chooseFolder: null` is what `make dev` is: no
  // shell, no dialog, and the served Browse listing as the only chooser. It is
  // passed rather than left to the global, so this file never depends on what
  // happens to be on `globalThis`.
  return {
    ws, ui, calls, went,
    draw: makeVaultView({ h, ws, ui, chooseFolder: null, navigate: (url) => went.push(url), search }),
  };
}

/** The same picker, built as the application a stranger downloaded: production,
 *  and the shell's one injected function standing in for the operating system's
 *  folder dialog. `chosen` is what the dialog answers next — null is a cancel. */
function productionPicker(search = "") {
  const g = picker(search);
  const dialog = { chosen: /** @type {string | null} */ (null), calls: 0 };
  const chooseFolder = async () => { dialog.calls += 1; await null; return dialog.chosen; };
  return {
    ...g, dialog,
    draw: makeVaultView({
      h, ws: g.ws, ui: g.ui, production: true, chooseFolder, navigate: (url) => g.went.push(url), search,
    }),
  };
}

const rowsIn = (el, cls) => findAll(find(el, (x) => has(x, cls)), (x) => has(x, "vrow"));

test("a first launch says nothing at all about there being no workspace", async () => {
  // It used to answer "None — pick a folder below, or make one", and a sentence
  // explaining the screen is a sentence a stranger has to read before they are
  // allowed to start. The heading went with it: a heading over nothing reports
  // that something is missing.
  const g = picker();
  const el = g.draw();
  await tick();

  expect("hidden" in find(el, (x) => has(x, "oops")).attrs).toBe(true);
  // AND NOTHING IS ASKED ABOUT WHICH FOLDER IS OPEN. This screen is the start
  // page and nothing else now, so there is no "Open now" block to fill and no
  // vault to keep out of Recent: everything remembered is offered.
  expect(g.calls).not.toContain("info");
  expect(rowsIn(el, "vrecent")).toHaveLength(2);
});

test("nothing remembered draws no Recent either", async () => {
  // `None yet.` under a heading is the screen reporting on itself to somebody
  // who has been here ten seconds. The block is absent instead.
  const g = picker();
  g.ws.recentVaults = async () => { await null; return []; };
  const el = g.draw();
  await tick();

  expect(rowsIn(el, "vrecent")).toHaveLength(0);
  expect(flat(el)).not.toContain("None yet.");
  expect(find(el, (x) => has(x, "vgrecent")).hidden).toBe(true);
});

test("the picker lists what was opened before, and marks the workspaces on disk", async () => {
  const g = picker();
  const el = g.draw();
  await tick();

  // ONE CLICK EACH, AND EVERYTHING REMEMBERED IS OFFERED. There used to be a
  // filter here, because the same screen was Settings and offering the folder
  // you were standing in was the one row that did nothing. Nothing is open while
  // the start page is on screen, and the folder just closed is the head of this
  // list — which is exactly where whoever closed it will look for it.
  const recents = rowsIn(el, "vrecent");
  expect(recents).toHaveLength(2);
  expect(flat(recents[0])).toBe("one/w/one→");
  // THE ROW IS THE CONTROL. The `Open` button at the end of it went: the row
  // already says what clicking it does, and the arrow is a mark rather than a
  // second thing to read.
  expect(flat(recents[1])).toBe("two/w/two→");
  expect(recents[0].tagName).toBe("A");

  // A column of folders that all look alike is what makes this screen hard to
  // use: the one you want is almost always one you have opened before.
  const dirs = rowsIn(el, "vdirs");
  expect(dirs.map(flat)).toEqual(["oneworkspaceOpen", "freshnewOpen"]);
  expect(has(dirs[0], "is")).toBe(true);
  expect(has(dirs[1], "is")).toBe(false);

  // Where you are, and a way up.
  expect(flat(find(el, (x) => has(x, "vwhere")))).toContain("/w");
  expect(byText(el, "↑ Up")).not.toBeNull();
  // Both halves of what opening does: an empty folder is set up, and a folder
  // holding anything else is refused. The note used to promise only the first,
  // which sent people to open folders that then would not open.
  expect(flat(el)).toContain("An empty folder is set up as a workspace when you open it");
  expect(flat(el)).toContain("will not open");
});

test("the picker is built once, so a repaint keeps the list you are walking", async () => {
  const g = picker();
  const el = g.draw();
  await tick();
  expect(g.draw()).toBe(el);
});

test("a folder walks in; the button beside it opens", async () => {
  const g = picker();
  const el = g.draw();
  await tick();

  find(rowsIn(el, "vdirs")[0], (x) => has(x, "vwalk")).fire("click");
  await tick();
  expect(g.calls).toContain("browse:/w/one");
  expect(flat(find(el, (x) => has(x, "vwhere")))).toContain("/w/one");
  expect(g.calls).not.toContain("open:/w/one");
});

test("opening a folder checks it, then goes to it", async () => {
  const g = picker();
  const el = g.draw();
  await tick();

  // The empty one: opening it is what sets it up.
  find(rowsIn(el, "vdirs")[1], (x) => has(x, "vgo")).fire("click");
  await tick();
  await tick();

  // CHECKED FIRST, and that is why the call is still made from here: a folder
  // that cannot be a workspace has to be refused on this screen, where there is
  // somewhere to put the reason.
  expect(g.calls).toContain("open:/w/fresh");
  // THEN GONE. The folder is in the address, so a reload, a bookmark and a
  // second tab all mean the workspace they say.
  expect(g.went).toEqual(["?vault=%2Fw%2Ffresh#/page/home"]);
});

test("a recent folder is one click, and it is the same one write", async () => {
  const g = picker();
  const el = g.draw();
  await tick();

  find(rowsIn(el, "vrecent")[1], (x) => has(x, "vgo")).fire("click");
  await tick();
  await tick();

  expect(g.calls).toContain("open:/w/two");
  expect(g.went).toEqual(["?vault=%2Fw%2Ftwo#/page/home"]);
});

// The row IS a link, which is the whole of the multi-tasking: a workspace has an
// address, so the browser opens a second one in a second tab for free and
// neither can move the other.
test("every folder is a real link, so a second one opens in a second tab", async () => {
  const g = picker();
  const el = g.draw();
  await tick();

  const go = find(rowsIn(el, "vrecent")[1], (x) => has(x, "vgo"));
  expect(go.tagName).toBe("A");
  expect(go.attrs.href).toBe("?vault=%2Fw%2Ftwo#/page/home");

  // A modified click is left entirely to the browser: checking would mount a
  // folder this tab is not going to, and the tab that opens checks it anyway.
  go.fire("click", { metaKey: true });
  await tick();
  expect(g.calls).not.toContain("open:/w/two");
  expect(g.went).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ADDRESS THIS SCREEN BUILDS KEEPS EVERYTHING THE WINDOW WAS OPENED WITH
// ─────────────────────────────────────────────────────────────────────────────
//
// Measured in the built application: the window is opened at
// `?token=…&vault=…`, the picker's own href was `"?vault=" + path`, and a whole
// new query is a query with no token in it. So opening an existing workspace
// loaded a document the server answered 401 to — every call the new page made,
// and a page that said the workspace did not open without being able to say why.
// `client/boot.js` keeps the query at its own `history.replaceState` for exactly
// this reason; this half did not, and these are what hold it to it.

test("the address of a workspace keeps every other parameter, and only moves the vault", () => {
  expect(hrefFor("?token=abc123", "/w/two")).toBe("?token=abc123&vault=%2Fw%2Ftwo#/page/home");
  // Already naming a folder: the folder moves and nothing beside it does.
  expect(hrefFor("?token=abc123&vault=%2Fw%2Fone", "/w/two"))
    .toBe("?token=abc123&vault=%2Fw%2Ftwo#/page/home");
  // A window with nothing in its query — `make dev` in a browser — is what it
  // always was.
  expect(hrefFor("", "/w/two")).toBe("?vault=%2Fw%2Ftwo#/page/home");
});

test("opening a recent workspace in the built application carries the token with it", async () => {
  // The window the shell opened: port 0 and a per-launch token, which is an
  // ADDRESS and therefore lives in the query this screen is about to rewrite.
  const g = productionPicker("?token=abc123&vault=%2Fw%2Fone");
  const el = g.draw();
  await tick();

  const go = find(rowsIn(el, "vrecent")[1], (x) => has(x, "vgo"));
  expect(go.attrs.href).toBe("?token=abc123&vault=%2Fw%2Ftwo#/page/home");

  go.fire("click");
  await tick();
  await tick();

  expect(g.calls).toContain("open:/w/two");
  expect(g.went).toEqual(["?token=abc123&vault=%2Fw%2Ftwo#/page/home"]);
});

test("the folder the dialog answers with is opened at an address that still carries the token", async () => {
  const g = productionPicker("?token=abc123&vault=%2Fw%2Fone");
  const el = g.draw();
  await tick();

  // OPEN, by the word on it. The two actions are the screen now, so there is no
  // group to count from — and a test that picked one by position would go on
  // passing with the wrong button under it.
  g.dialog.chosen = "/w/two";
  byText(el, "Open").fire("click");
  await tick();
  await tick();
  await tick();

  expect(g.calls).toContain("open:/w/two");
  expect(g.went).toEqual(["?token=abc123&vault=%2Fw%2Ftwo#/page/home"]);
});

test("a folder that will not open says so and leaves you where you were", async () => {
  const g = picker();
  g.ws.fails = true;
  const el = g.draw();
  await tick();

  find(rowsIn(el, "vdirs")[1], (x) => has(x, "vgo")).fire("click");
  await tick();
  await tick();

  const oops = find(el, (x) => has(x, "oops"));
  expect(oops.textContent).toBe("that folder is not readable");
  expect("hidden" in oops.attrs).toBe(false);
  // Still here, and nowhere was gone to. A refusal that navigated anyway would
  // load a tab onto a folder the server has just said it cannot open.
  expect(g.went).toEqual([]);
  expect(g.ui.get().route).toEqual({ view: "vault", id: "" });
});

/* ── making one ────────────────────────────────────────────────────────── */

// THE BUTTON IS WIRED NOW, and these are the three things that were waiting on
// the barrier: it turns on when there is nothing to refuse, it sends the parent
// and the name apart, and it navigates the way opening one does.
test("Create is off until a name is typed, and then it makes the folder", async () => {
  const g = picker();
  const el = g.draw();
  await tick();

  const make = find(el, (x) => has(x, "vmake"));
  const name = find(el, (x) => has(x, "vnew"));
  // Nothing typed is something to refuse, so it is off.
  expect(make.attrs.disabled ?? make.disabled).toBeTruthy();

  // Standing in a folder, with a name nothing else in it has.
  find(rowsIn(el, "vdirs")[0], (x) => has(x, "vwalk")).fire("click");
  await tick();
  name.value = "notes";
  name.fire("input");
  expect(make.disabled).toBe(false);

  make.fire("click");
  await tick();
  await tick();

  // THE TWO HALVES STAY APART all the way to the store. A picker that joined
  // them would be the bug the shape exists to prevent.
  expect(g.calls).toContain("create:/w/one|notes");
  // And it LEAVES, exactly as opening one does: a workspace is an address, so
  // arriving in a new one is a navigation.
  expect(g.went).toEqual(["?vault=%2Fw%2Fone%2Fnotes#/page/home"]);
});

test("a name the folder already has keeps the button off", async () => {
  const g = picker();
  const el = g.draw();
  await tick();

  const make = find(el, (x) => has(x, "vmake"));
  const name = find(el, (x) => has(x, "vnew"));

  // The picker opens standing in `/w`, which holds `one` and `fresh`.
  name.value = "one";
  name.fire("input");
  expect(make.disabled).toBe(true);
  // The refusal is visible, and it is the same expression that turned the
  // button off — one opinion about one question.
  expect(find(el, (x) => has(x, "vwhy")).hidden).toBe(false);

  name.value = "somewhere-new";
  name.fire("input");
  expect(make.disabled).toBe(false);
});

/* ── the rail's width ──────────────────────────────────────────────────────
   Two mechanisms that would fight if they were not separated: the rail sizes
   itself to what it is showing, and the user may drag it to whatever they like.
   `rackWidth` is where that argument is settled, and it is settled in
   arithmetic on purpose — THIS RUNNER HAS NO DOM AND THE BROWSER USED FOR
   CHECKING HAS NO FONTS, so a rendered glyph is zero-width in both and no test
   anywhere can honestly assert that "Field service scheduling" is wider than
   "Notes". What CAN be held true is every decision made about a number once
   something else has measured it. */

function fakeWin(innerWidth = 1400) {
  /** @type {Record<string, Function[]>} */
  const on = {};
  return {
    innerWidth,
    on,
    addEventListener: (k, fn) => { (on[k] ||= []).push(fn); },
    removeEventListener: (k, fn) => { on[k] = (on[k] || []).filter((f) => f !== fn); },
    fire: (k, ev) => { for (const fn of [...(on[k] || [])]) fn(ev ?? {}); },
    /** how many handlers are still armed — a drag that never lets go is a leak */
    armed: (k) => (on[k] || []).length,
  };
}

function fakeStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** A rack node that can be cloned and laid out, so the measuring PLUMBING is
 *  exercised for real — the clone, the number read off it, the slack added, the
 *  clone taken away again. What it cannot exercise is text, which is exactly
 *  why the number is supplied rather than rendered. */
function measurable(natural) {
  const el = element("nav");
  el.textContent = "rows";
  el.cloneNode = () => {
    const ghost = element("nav");
    ghost.getBoundingClientRect = () => ({ width: natural });
    return ghost;
  };
  return el;
}

function rackHarness(opts = {}) {
  const win = fakeWin(opts.room === undefined ? 1400 : opts.room);
  const store = fakeStore(opts.seed);
  const sizer = makeRack({ h, store, win, doc: null });
  const app = element("div");
  const bed = element("div");
  const rack = opts.natural === undefined ? element("nav") : measurable(opts.natural);
  bed.append(rack, sizer.grip);
  app.append(bed);
  sizer.mount(app, bed, rack);
  return { sizer, win, store, app, bed, rack, grip: sizer.grip };
}

/* the arithmetic */

test("before anything is measured the rail is the width the stylesheet painted", () => {
  expect(rackWidth(null, null, 1400)).toBe(RACK_BASE);
  // and with no window to ask — before mount, or in a runner with no window at
  // all — it is still that, rather than nothing
  expect(rackWidth(null, null, 0)).toBe(RACK_BASE);
});

test("a rail that sized itself is never narrower than a rail can be", () => {
  expect(rackWidth(null, 40, 1400)).toBe(RACK_MIN);
  expect(rackWidth(null, RACK_MIN - 1, 1400)).toBe(RACK_MIN);
});

test("a rail that sized itself is capped against the window", () => {
  const room = 1000;
  const ceiling = autoCeiling(room);
  expect(ceiling).toBe(Math.round(room * RACK_SHARE));
  // one page with a 200-character name must not be allowed to eat the canvas
  expect(rackWidth(null, 2000, room)).toBe(ceiling);
  // and a width inside the ceiling is simply itself
  expect(rackWidth(null, 300, room)).toBe(300);
});

test("the ceiling never lands under the floor, however narrow the window", () => {
  expect(autoCeiling(200)).toBe(RACK_MIN);
  expect(rackWidth(null, 400, 200)).toBe(RACK_MIN);
  // the untouched default is an automatic width too, so it obeys the same cap
  expect(rackWidth(null, null, 400)).toBe(autoCeiling(400));
});

test("a dragged width has a minimum and NO maximum", () => {
  // if somebody wants the rail huge that is their business
  expect(rackWidth(1200, null, 1000)).toBe(1200);
  expect(rackWidth(1200, 300, 1000)).toBe(1200);
  expect(rackWidth(1200, null, 1000)).toBeGreaterThan(autoCeiling(1000));
  // dragged shut is the one thing it will not do — a rail nobody can find again
  expect(rackWidth(20, null, 1400)).toBe(RACK_MIN);
  expect(rackWidth(-500, null, 1400)).toBe(RACK_MIN);
});

test("a measurement arriving after a drag does not move it", () => {
  // a panel that springs back after you resize it is worse than one that never
  // resized, so their width wins for good rather than until the next repaint
  expect(rackWidth(320, 500, 1400)).toBe(320);
  expect(rackWidth(320, 100, 1400)).toBe(320);
  expect(rackWidth(320, null, 1400)).toBe(320);
});

/* the wiring, as far as it goes without a DOM */

test("the rail grows to what the rows need, and no further than the window lets it", () => {
  const fits = rackHarness({ natural: 340, room: 1400 });
  expect(fits.sizer.width()).toBeGreaterThan(RACK_BASE);
  expect(fits.sizer.width()).toBe(342); // measured, plus the slack past the last glyph

  const vast = rackHarness({ natural: 900, room: 1000 });
  expect(vast.sizer.width()).toBe(autoCeiling(1000));
});

test("dragging the grip sets the width, and letting go is what remembers it", () => {
  const g = rackHarness({ natural: 340 });
  const before = g.sizer.width();

  g.grip.fire("pointerdown", { clientX: 400 });
  expect(g.grip.attrs["data-drag"]).toBe("on");
  g.win.fire("pointermove", { clientX: 500 });
  expect(g.sizer.width()).toBe(before + 100);

  g.win.fire("pointerup", {});
  expect(g.grip.attrs["data-drag"]).toBe(undefined);
  expect(g.store.getItem(RACK_KEY)).toBe(String(before + 100));
  // and the drag lets go of the window rather than listening forever
  expect(g.win.armed("pointermove")).toBe(0);
  expect(g.win.armed("pointerup")).toBe(0);
});

test("once dragged, the rail stops sizing itself", () => {
  const g = rackHarness({ natural: 340 });
  g.grip.fire("pointerdown", { clientX: 400 });
  g.win.fire("pointermove", { clientX: 300 });
  g.win.fire("pointerup", {});
  const theirs = g.sizer.width();

  // the rows say something much wider now, and it makes no difference
  g.rack.textContent = "a workspace full of very long page names";
  g.sizer.sync();
  expect(g.sizer.width()).toBe(theirs);
});

test("their width survives a reload, and it is not kept per vault", () => {
  // one key, no vault in it — the rail is workspace UI rather than workspace
  // content, so switching folders must not resize it
  expect(RACK_KEY).not.toContain("vault");

  const first = rackHarness({ natural: 340 });
  first.grip.fire("pointerdown", { clientX: 0 });
  first.win.fire("pointermove", { clientX: 120 });
  first.win.fire("pointerup", {});
  const theirs = first.sizer.width();

  // everything is built again against the same storage, as a reload does
  const again = rackHarness({ natural: 900, seed: Object.fromEntries(first.store.map) });
  expect(again.sizer.width()).toBe(theirs);
});

test("a stored width below the minimum is still clamped on the way back in", () => {
  const g = rackHarness({ seed: { [RACK_KEY]: "12" } });
  expect(g.sizer.width()).toBe(RACK_MIN);
});

test("nonsense in storage is ignored rather than believed", () => {
  for (const junk of ["", "wide", "NaN"]) {
    expect(rackHarness({ seed: { [RACK_KEY]: junk } }).sizer.width()).toBe(RACK_BASE);
  }
});

test("the grip answers the keyboard, and Home gives it back to the measuring", () => {
  const g = rackHarness({ natural: 340 });
  const auto = g.sizer.width();

  g.grip.fire("keydown", { key: "ArrowRight" });
  expect(g.sizer.width()).toBe(auto + RACK_STEP);
  g.grip.fire("keydown", { key: "ArrowLeft" });
  expect(g.sizer.width()).toBe(auto);
  expect(g.store.getItem(RACK_KEY)).toBe(String(auto));

  // a key that means nothing here leaves it alone
  g.grip.fire("keydown", { key: "PageUp" });
  expect(g.sizer.width()).toBe(auto);

  g.grip.fire("keydown", { key: "Home" });
  expect(g.store.getItem(RACK_KEY)).toBe(null);
  expect(g.sizer.width()).toBe(auto); // back to what the rows need, which is that
});

test("the grip says how wide the rail is, for anything that cannot see it", () => {
  const g = rackHarness({ natural: 340 });
  expect(g.grip.attrs.role).toBe("separator");
  expect(g.grip.attrs["aria-orientation"]).toBe("vertical");
  expect(g.grip.attrs["aria-valuemin"]).toBe(String(RACK_MIN));
  expect(g.grip.attrs["aria-valuenow"]).toBe(String(g.sizer.width()));
  // there is no aria-valuemax, because there is no maximum
  expect("aria-valuemax" in g.grip.attrs).toBe(false);
});

test("the grip hangs off the bed, not off the rack that scrolls", () => {
  const g = harness();
  expect(find(g.rack, (el) => has(el, "rackgrip"))).toBe(null);
  expect(find(g.bed, (el) => has(el, "rackgrip"))).not.toBe(null);
  // and a repaint leaves it exactly where it was — it is not part of the rows
  const grip = find(g.bed, (el) => has(el, "rackgrip"));
  const moved = grip.moved;
  g.ws.emit();
  expect(grip.moved).toBe(moved);
});

test("a design doc that is not there is said in a sentence, not left at Opening…", async () => {
  // A workspace whose `design/` is gone: `page.read` answers null for
  // `@design`, exactly as it does for a page that does not exist, and the
  // screen has to say so — before this it sat at "Opening…" with nothing to
  // act on.
  const g = harness();
  g.ws.loadPage = async (id) => { await null; g.ws.calls.push("loadPage:" + id); g.ws.state.page = null; g.ws.emit(); return null; };
  g.ui.go("design", "");
  await tick();
  expect(g.ws.calls).toContain("loadPage:@design");
  expect(flat(g.plate.firstChild)).toContain("There is no design doc in this workspace");
  // Asked once, not on every repaint.
  g.ws.emit();
  await tick();
  expect(g.ws.calls.filter((c) => c === "loadPage:@design")).toHaveLength(1);
});

test("the Map is a route like Design, and it takes the canvas whole", async () => {
  const g = harness();
  await tick();

  find(g.rack, (el) => el.tagName === "A" && flat(el) === "Map")
    .fire("click", { preventDefault() {} });
  await tick();

  expect(g.ui.get().route).toEqual({ view: "map", id: "" });
  expect(g.plate.firstChild.className).toBe("sky");
  expect(g.drawn.map).toBe(1);
  // It is a box like a page, so it fills the canvas rather than taking a measure.
  expect(g.plate.attrs["data-face"]).toBe("map");
  expect(findAll(g.rail, (el) => has(el, "crumb")).map(flat)).toEqual(["Everything", "Map"]);
});

/* ── which build this is ────────────────────────────────────────────────── */

// EVERY ITEM ON THE PRODUCTION HIDE LIST, ASSERTED BOTH WAYS. The rule under the
// list is one sentence — a control is in production when a person who never
// cloned this repository can act on it — and each item is tested as what it is:
// "is this row put in the list", constructed with `production` rather than set
// on the runner. Nothing is deleted and nothing is a second code path, so the
// development assertion beside each one is the real proof that it still is not.
//
// THE LIST HOLDS NO SCREEN. It held the Map row, the History panel and the
// Modify page panel until 2026-09-17, when the owner decided that the built
// application hides no screen: Map is in every build, and the two panels — and
// the Config screen behind the `···` menu — are deleted rather than withheld.
// What is left on the list is the strip's diagnostics and the failure screen's
// `make dev`, below; the first test here holds the other direction, that no
// screen or row differs between the builds.

test("the Map row and its route are in every build", async () => {
  // THE ROW AND THE ROUTE TOGETHER: a row without the route would be a row
  // whose click falls back to a page, and a route without the row a hidden
  // feature rather than an offered one. Both are held in both builds, and the
  // foot's rows are the same list either way.
  for (const production of [false, true]) {
    const g = harness(DOC, { view: "page", id: DOC.id }, production);
    await tick();
    const foot = find(g.rack, (el) => has(el, "rackfoot"));
    expect(findAll(foot, (el) => el.tagName === "A").map(flat)).toEqual(["Design", "Instructions", "Automations", "Map", "Close workspace"]);
    expect(findAll(foot, (el) => has(el, "kindtag")).map((el) => el.attrs["data-kind"]))
      .toEqual(["design", "instructions", "runs", "map", "close"]);
    // Every row's route is in the vocabulary, and `close` is the start page.
    for (const kind of ["design", "instructions", "runs", "map", "close"]) expect(VIEWS.has(kind === "close" ? "vault" : kind)).toBe(true);
  }
  // ONE VOCABULARY. `parseHash` takes the hash and nothing else, so there is no
  // second argument for a build to pass and no second set for it to read.
  expect(parseHash("#/map")).toEqual({ view: "map", id: "" });
  expect(parseHash.length).toBe(1);
  for (const view of VIEWS) expect(parseHash("#/" + view).view).toBe(view);
});

test("the Instructions and Automations rows open their screens, in both builds", async () => {
  for (const production of [false, true]) {
    const w = harness(DOC, { view: "page", id: DOC.id }, production);
    await tick();
    const foot = find(w.rack, (el) => has(el, "rackfoot"));
    const row = (text) => find(foot, (el) => el.tagName === "A" && flat(el) === text);
    row("Instructions").fire("click");
    await tick();
    expect(w.ui.get().route.view).toBe("instructions");
    expect(w.plate.firstChild.className).toBe("vaultins");
    expect(w.plate.attrs["data-face"]).toBe("instructions");
    row("Automations").fire("click");
    await tick();
    expect(w.ui.get().route.view).toBe("runs");
    expect(w.plate.firstChild.className).toBe("overview");
    expect(w.plate.attrs["data-face"]).toBe("runs");
    // And both are in the route vocabulary of both builds: a typed hash reaches them.
    expect(parseHash("#/runs").view).toBe("runs");
    expect(parseHash("#/instructions").view).toBe("instructions");
  }
});

test("a page's bar carries Instructions and Automations, each taking the canvas and giving it back, in both builds", async () => {
  for (const production of [false, true]) {
    const w = harness(DOC, { view: "page", id: DOC.id }, production);
    await tick();
    const toolNamed = (text) => find(w.rail, (el) => has(el, "tool") && flat(el) === text);
    expect(toolNamed("Instructions")).toBeTruthy();
    expect(toolNamed("Automations")).toBeTruthy();
    toolNamed("Instructions").fire("click");
    await tick();
    expect(w.ui.get().pageView).toBe("instructions");
    expect(w.plate.firstChild.className).toBe("pageins");
    expect(w.plate.attrs["data-face"]).toBe("instructions");
    toolNamed("Instructions").fire("click");
    await tick();
    expect(w.ui.get().pageView).toBe("page");
    expect(w.plate.firstChild.className).toBe("pagebody");
    toolNamed("Automations").fire("click");
    await tick();
    expect(w.ui.get().pageView).toBe("automation");
    expect(w.plate.firstChild.className).toBe("autoscreen");
    expect(w.plate.attrs["data-face"]).toBe("automation");
  }
});

test("Agent Terminal is the rightmost action on a page's bar, after Instructions and Automations, in both builds", async () => {
  // A REAL TERMINAL STORE over a link that never opens, and a view that is a
  // box the dock can hold: what the bar reads is `store.get()`, `store.live()`
  // and `toggle()`, and what the dock wants is `view.el`. The owner asked
  // (2026-09-17) for the toggle to stay the rightmost button once the page's
  // two screens joined the bar.
  const link = { connect() {}, close() {}, send: () => false, state: () => "idle", on: () => () => {} };
  const store = makeTerminals({ link });
  const view = { el: element("div"), focus() {}, sync() {}, hidden() {}, hint: () => null, schedule() {}, style() {} };
  for (const production of [false, true]) {
    const ws = fakeWs(DOC);
    const ui = makeUi({ route: { view: "page", id: DOC.id } });
    const { views } = fakeViews();
    const shell = makeShell({ h, fill, ws, ui, frameHost: fakeFrameHost(), views, production, terminal: { store, view } });
    ws.on(() => shell.repaint());
    ui.on(() => shell.repaint());
    const root = element("div");
    shell.mount(root);
    await tick();
    const rail = root.children[0].children[0];
    const tools = findAll(rail, (el) => has(el, "tool")).map(flat);
    const at = (text) => tools.indexOf(text);
    expect(at("Instructions")).toBeGreaterThan(-1);
    expect(at("Automations")).toBe(at("Instructions") + 1);
    expect(at("Agent Terminal")).toBe(at("Automations") + 1);
    // Nothing after it, in either build: there is no menu any more.
    expect(tools.slice(at("Agent Terminal") + 1)).toEqual([]);
  }
});

test("the status strip stops reporting on the page and keeps reporting on the data", async () => {
  const dev = harness();
  await tick();
  expect(flat(dev.strip)).toContain("Sections");
  expect(flat(dev.strip)).toContain("Drawn");
  expect(flat(dev.strip)).toContain("unrestricted");

  // Declared and drawn are a compliance report between the host and the box,
  // written for whoever is building a page; `Data unrestricted` is a statement
  // about the contract rather than about anything a reader can act on.
  const built = harness(DOC, { view: "page", id: DOC.id }, true);
  await tick();
  expect(flat(built.strip)).not.toContain("Sections");
  expect(flat(built.strip)).not.toContain("Drawn");
  expect(flat(built.strip)).not.toContain("unrestricted");

  // A table's Rows and Columns are facts about the person's own data and stay.
  const table = harness(DOC, { view: "table", id: "jobs" }, true);
  await tick();
  expect(flat(table.strip)).toContain("Rows");
  expect(flat(table.strip)).toContain("Columns");
  expect(flat(table.strip)).not.toContain("unrestricted");
});

test("the Dashboard row and the row that names the workspace are both in every build", async () => {
  const dev = harness();
  await tick();
  expect(find(dev.rack, (el) => has(el, "dashboardlink"))).toBeTruthy();

  const built = harness(DOC, { view: "page", id: DOC.id }, true);
  await tick();
  // The dashboard IS the root page, and a way to it is always on screen; the
  // heading stays too because it is the one that NAMES the folder you are in.
  expect(find(built.rack, (el) => has(el, "dashboardlink"))).toBeTruthy();
  const head = find(built.rack, (el) => has(el, "railhead"));
  expect(head).toBeTruthy();
  expect(flat(find(head, (el) => el.tagName === "A"))).toBe("Everything");
});

test("the failure screen names no repository in production, and offers the one act that is theirs", async () => {
  const dev = harness();
  dev.shell.trouble(new Error("the server did not answer"));
  expect(flat(dev.plate.firstChild)).toContain("make dev");

  const built = harness(DOC, { view: "page", id: DOC.id }, true);
  built.shell.trouble(new Error("the server did not answer"));
  const screen = built.plate.firstChild;
  expect(screen.className).toBe("startfail");
  // THE REASON STAYS. It is honest, and it is what the failure actually
  // produced; what goes is a command about a directory a stranger does not have.
  expect(flat(screen)).toContain("the server did not answer");
  expect(flat(screen)).not.toContain("make");
  expect(find(screen, (el) => el.tagName === "CODE")).toBe(null);

  // And the way out is choosing a folder, on a screen the picker is already
  // reachable from.
  const choose = byText(screen, "Choose a folder");
  expect(choose).toBeTruthy();
  choose.fire("click");
  await tick();
  expect(built.ui.get().route).toEqual({ view: "vault", id: "" });
  // The picker, still carrying the reason it was arrived at.
  expect(built.plate.firstChild.className).toBe("vaulttrouble");
  expect(find(built.plate.firstChild, (el) => has(el, "vaultpick"))).toBeTruthy();
});

/** The headings on the screen, which are the blocks it is drawing. The built
 *  application's start page has none of its own — the mark, the line and the two
 *  actions carry no heading — so this answers what is UNDER them. */
const groupsIn = (el) => findAll(el, (x) => x.tagName === "H2" || x.tagName === "H3").map(flat);

test("the built application chooses a folder with the dialog, and draws no served listing", async () => {
  // THE ITEM THAT COULD NOT GO ALONE, AND WHAT REPLACED IT. Browse was not only
  // how a parent folder was chosen — it was the only way to reach a workspace
  // already on disk and not in `Recent`. The dialog serves both, so the listing
  // goes: Open is the dialog, Create's parent is the dialog, and `vault.browse`
  // is never asked for at all.
  const g = productionPicker();
  const el = g.draw();
  await tick();

  // THE TWO ACTIONS ARE THE SCREEN, so `Open` and `Create` are buttons under the
  // mark rather than groups with headings; what is left with a heading is what
  // is under them, which is `Recent` and nothing else. There was an `Open now`
  // block over it, and it went with Settings: the start page is on screen when
  // no workspace is, so it had nothing to say.
  expect(groupsIn(el)).toEqual(["Recent"]);
  expect(byText(el, "Create a vault")).toBeTruthy();
  expect(byText(el, "Open")).toBeTruthy();
  // THE ONE REAL LINE, and the only sentence on the screen. It is the project's
  // own headline, the sentence its site leads with, so the program says what
  // the page it was downloaded from said.
  expect(flat(find(el, (x) => has(x, "vline")))).toBe("Visual Workspace for AI Automations");
  expect(find(el, (x) => has(x, "vdirs"))).toBe(null);
  // Not hidden — not requested. A screen that hides a control and still makes
  // its request is a screen the production server refuses.
  expect(g.calls.some((c) => c.startsWith("browse:"))).toBe(false);
});

test("Open in the built application is the dialog, and a cancel does nothing at all", async () => {
  const g = productionPicker();
  const el = g.draw();
  await tick();

  // A cancel is an answer, and it is the one that leaves the screen alone.
  const choose = byText(el, "Open");
  choose.fire("click");
  await tick();
  expect(g.dialog.calls).toBe(1);
  expect(g.calls.some((c) => c.startsWith("open:"))).toBe(false);
  expect(g.went).toEqual([]);

  // And a chosen folder is opened exactly as a browsed one was.
  g.dialog.chosen = "/w/fresh";
  choose.fire("click");
  await tick();
  await tick();
  expect(g.calls).toContain("open:/w/fresh");
  expect(g.went[0]).toContain(encodeURIComponent("/w/fresh"));
});

test("Create is on the production picker, and its parent comes from the dialog", async () => {
  // IT IS VISIBLE AGAIN. Create used to be held by the same constant as Browse,
  // because the parent it made something in was the folder Browse was standing
  // in. The dialog is that parent now, so the group has a chooser of its own.
  const g = productionPicker();
  const el = g.draw();
  await tick();

  const sheet = el;
  const choose = byText(el, "Create a vault");
  const name = find(el, (x) => has(x, "vnew"));
  const make = find(el, (x) => has(x, "vmake"));

  // THE STEP IS NOT ON SCREEN UNTIL THE DIALOG HAS ANSWERED. Until a parent is
  // chosen there is nothing for a name to be a name inside, and a field that
  // cannot be used yet is a field somebody has to work out.
  expect(sheet.classList.contains("is-step")).toBe(false);
  expect(make.disabled).toBe(true);

  g.dialog.chosen = "/w";
  choose.fire("click");
  await tick();
  expect(sheet.classList.contains("is-step")).toBe(true);
  expect(flat(find(el, (x) => has(x, "vparent")))).toBe("/w");

  name.value = "made-here";
  name.fire("input");
  expect(make.disabled).toBe(false);
  // THE PATH IS COMPOSED AS IT IS TYPED: the chosen parent, then the name, one
  // element per character so a real keystroke can be given a keyframe.
  expect(find(el, (x) => has(x, "vhead")).textContent).toBe("/w");
  expect(flat(find(el, (x) => has(x, "vtail")))).toBe("made-here");
  expect(find(el, (x) => has(x, "vsep")).hidden).toBe(false);

  make.fire("click");
  await tick();
  await tick();
  // A parent and a name, never a joined path — the same two arguments the
  // browsed route sends.
  expect(g.calls).toContain("create:/w|made-here");
});

test("the picker takes the native route from the global, and the listing without it", async () => {
  // WHAT DECIDES IS `window.biomShell.chooseFolder` BEING THERE, and the view
  // reads it rather than being told. This is the one test that goes through the
  // global itself; every other one passes the function in.
  const g = picker();
  const draw = () => makeVaultView({ h, ws: g.ws, ui: g.ui, navigate: () => {} })();

  const had = "biomShell" in globalThis;
  try {
    globalThis.biomShell = { chooseFolder: async () => { await null; return "/w"; } };
    const shelled = draw();
    await tick();
    expect(groupsIn(shelled)).toEqual(["Recent"]);
    expect(byText(shelled, "Create a vault")).toBeTruthy();

    delete globalThis.biomShell;
    const browser = draw();
    await tick();
    // NO DIALOG IS `make dev` AND NOTHING ELSE, and the served
    // listing is still the whole chooser there — drawn plainly, under the same
    // mark, because dressing a developer's screen as the product's first ten
    // seconds would be dressing up a thing that is not shipped.
    expect(groupsIn(browser)).toEqual(["Recent", "Create", "Browse"]);
    expect(byText(browser, "Create a vault")).toBe(null);
    expect(rowsIn(browser, "vdirs").length).toBeGreaterThan(0);
  } finally {
    if (!had) delete globalThis.biomShell;
  }
});

/* ── the window's own title bar ────────────────────────────────────────── */

// THE APPLICATION DRAWS ITS OWN BAR, and these hold the two halves of why that
// is safe: with the shell's controls on the global the bar is there and its
// buttons reach the shell, and without them nothing is built and the page is
// exactly the page a browser had. The owner decided this on 2026-09-14 — the
// desktop's bar is not the same bar twice, GNOME hides maximise and offers no
// full screen at all — so what is asserted here is that the controls EXIST
// rather than that they look like anything.

/** The shell's side of the bridge, recording. `lights` is the macOS answer:
 *  the traffic lights are the window's controls there and we draw none of the
 *  three ourselves. */
function fakeWindowShell({ lights = false, state = { maximized: false, fullScreen: false } } = {}) {
  const calls = [];
  /** @type {((s: any) => void)[]} */
  const hears = [];
  /** @type {((n: number) => void)[]} */
  const closings = [];
  return {
    calls,
    /** Something that is not our button moved the window. */
    moved(next) { for (const hear of [...hears]) hear(next); },
    /** The main process held a close over `n` live runs. */
    holding(n) { for (const hear of [...closings]) hear(n); },
    bridge: {
      chooseFolder: async () => { await null; return null; },
      logo: async () => { await null; return "data:image/png;base64,AAAA"; },
      windowControls: {
        minimize: async () => { calls.push("minimize"); },
        toggleMaximize: async () => { calls.push("toggleMaximize"); },
        toggleFullScreen: async () => { calls.push("toggleFullScreen"); },
        close: async (force) => { calls.push(force === true ? "close!" : "close"); },
        state: async () => { await null; return state; },
        onChange: (hear) => { hears.push(hear); return () => hears.splice(hears.indexOf(hear), 1); },
        onClosing: (hear) => { closings.push(hear); return () => closings.splice(closings.indexOf(hear), 1); },
        lights,
        inset: lights ? 78 : 0,
      },
    },
  };
}

/** Build a shell with a window under it, and hand back the bar. The bridge is
 *  read ONCE when the shell is built — a bar that came and went on a repaint
 *  would take the canvas with it — so the global goes on before `harness`. */
async function framed(options) {
  const shell = fakeWindowShell(options);
  const had = "biomShell" in globalThis;
  globalThis.biomShell = shell.bridge;
  try {
    const g = harness();
    await tick();
    return { ...g, ...shell, bar: g.app.children[0], done: () => { if (!had) delete globalThis.biomShell; } };
  } catch (err) {
    if (!had) delete globalThis.biomShell;
    throw err;
  }
}

/** Every window control on the bar, in the order it is drawn. */
const controlsOn = (bar) => findAll(bar, (x) => has(x, "wctl"));
const labelsOn = (bar) => controlsOn(bar).map((b) => b.attrs["aria-label"]);

test("a browser draws no title bar at all", () => {
  // `make dev` in a tab has no `biomShell`, so nothing is built and the grid
  // above the page is the one it always was. This is the half that keeps the
  // two builds one program.
  const held = globalThis.biomShell;
  delete globalThis.biomShell;
  try {
    const g = harness();
    expect(g.app.className).toBe("app");
    expect(find(g.app, (x) => has(x, "titlebar"))).toBe(null);
    // And the rail is still the first row, which is what every other test in
    // this file reaches for by index.
    expect(g.app.children[0]).toBe(g.rail);
  } finally {
    if (held !== undefined) globalThis.biomShell = held;
  }
});

test("the built application draws the bar, the mark, the name and four controls", async () => {
  const g = await framed();
  try {
    expect(g.app.className).toBe("app framed");
    expect(has(g.bar, "titlebar")).toBe(true);

    // THE NAME IS THE WORKSPACE'S OWN — the root page's name, which is what the
    // rack calls it and what the person may change.
    expect(flat(find(g.bar, (x) => has(x, "titlename")))).toBe("Everything");

    // The mark arrives over the bridge as bytes rather than as a URL: `app/` is
    // not a served directory and a copy of the logo under `client/` would be a
    // second copy of the logo.
    const mark = find(g.bar, (x) => has(x, "titlemark"));
    expect(mark.attrs.src.startsWith("data:image/png;base64,")).toBe(true);
    // Decorative beside a name that says the same thing.
    expect(mark.attrs.alt).toBe("");

    // EVERY BUTTON HAS A NAME, and it is the name rather than the glyph that a
    // screen reader and this test both read.
    expect(labelsOn(g.bar)).toEqual(["Minimize", "Maximize", "Full screen", "Close"]);
    for (const b of controlsOn(g.bar)) expect(b.attrs.type).toBe("button");

    // AND THEY REACH THE SHELL. Four acts, four channels, nothing else.
    for (const b of controlsOn(g.bar)) b.fire("click");
    expect(g.calls).toEqual(["minimize", "toggleMaximize", "toggleFullScreen", "close"]);
  } finally {
    g.done();
  }
});

test("the maximize and full screen buttons flip with the window, however it moved", async () => {
  const g = await framed();
  try {
    expect(labelsOn(g.bar)).toEqual(["Minimize", "Maximize", "Full screen", "Close"]);

    // F11, a drag to the top of the screen, a tiling manager — none of them is
    // our button, and the icon still has to be right. That is the whole reason
    // the bridge carries a subscription rather than only a reader.
    g.moved({ maximized: true, fullScreen: false });
    expect(labelsOn(g.bar)).toEqual(["Minimize", "Restore down", "Full screen", "Close"]);
    expect(controlsOn(g.bar)[1].className).toBe("wctl restore");

    g.moved({ maximized: true, fullScreen: true });
    expect(labelsOn(g.bar)).toEqual(["Minimize", "Restore down", "Leave full screen", "Close"]);
    expect(controlsOn(g.bar)[2].className).toBe("wctl unfull");

    g.moved({ maximized: false, fullScreen: false });
    expect(labelsOn(g.bar)).toEqual(["Minimize", "Maximize", "Full screen", "Close"]);
    expect(controlsOn(g.bar)[1].className).toBe("wctl max");
  } finally {
    g.done();
  }
});

test("the window is read on mount, so a bar built over a maximised window is right", async () => {
  const g = await framed({ state: { maximized: true, fullScreen: false } });
  try {
    expect(labelsOn(g.bar)).toEqual(["Minimize", "Restore down", "Full screen", "Close"]);
  } finally {
    g.done();
  }
});

test("a double-click on the bar maximizes, and one on a control does not also", async () => {
  const g = await framed();
  try {
    g.bar.fire("dblclick");
    expect(g.calls).toEqual(["toggleMaximize"]);

    // A double press on Close must not maximise the window on its way out. The
    // controls stop it before the bar's own handler sees it.
    let stopped = false;
    const close = controlsOn(g.bar)[3];
    close.fire("dblclick", { stopPropagation() { stopped = true; } });
    expect(stopped).toBe(true);
  } finally {
    g.done();
  }
});

test("macOS keeps its traffic lights and is given room for them", async () => {
  // THE LIGHTS ARE THE CONTROLS THERE. `hiddenInset` leaves them on the window,
  // inside our bar, so a Mac window that drew three dots of its own would carry
  // six controls for three acts. Full screen IS still ours, on every platform:
  // the green light is zoom-or-full-screen depending on a modifier, which is
  // the ambiguity this button exists to remove.
  const g = await framed({ lights: true });
  try {
    expect(labelsOn(g.bar)).toEqual(["Full screen"]);
    expect(find(g.bar, (x) => has(x, "titleid")).style["--title-inset"]).toBe("78px");
  } finally {
    g.done();
  }
});

test("the bar is a drag region and the controls are not", () => {
  // IT IS NOT AN ATTRIBUTE THE SHELL SETS, it is Chromium's own property in the
  // stylesheet — so this is the only honest place to hold it. A bar without it
  // is a window that cannot be moved at all, because the desktop's bar is gone;
  // controls without the exception are four buttons that do not take a click.
  const css = readFileSync(new URL("../client/css/chrome.css", import.meta.url), "utf8");
  const block = (sel) => {
    const at = css.indexOf(sel + "{");
    expect([sel, at >= 0]).toEqual([sel, true]);
    return css.slice(at, css.indexOf("}", at));
  };
  expect(block(".titlebar")).toContain("-webkit-app-region:drag");
  expect(block(".titleacts")).toContain("-webkit-app-region:no-drag");
  // And the row the bar needs, which is a class rather than a second skeleton.
  expect(block(".app.framed")).toContain("var(--title-h)");
});


// THE CLOSE HELD OVER A LIVE RUN. The main process asks the server, finds
// something alive, holds the window and says how many; the bar draws the
// question, yes closes for real and no keeps everything.
test("a close held over a live run draws the question in the bar; yes forces the close and no keeps the runs", async () => {
  const w = await framed({ lights: false });
  try {
    expect(find(w.bar, (el) => has(el, "closeask"))).toBe(null);
    w.holding(2);
    await tick();
    const ask = find(w.bar, (el) => has(el, "closeask"));
    expect(ask).toBeTruthy();
    expect(flat(find(ask, (el) => has(el, "closeword")))).toBe(CLOSE_WORDS.alive(2));
    // No: the strip goes, nothing is closed, the runs are nobody's to end.
    find(ask, (el) => has(el, "closeno")).fire("click");
    await tick();
    expect(find(w.bar, (el) => has(el, "closeask"))).toBe(null);
    expect(w.calls).toEqual([]);
    // Yes: the close is forced through, and the server ends every run on the way out.
    w.holding(1);
    await tick();
    expect(flat(find(w.bar, (el) => has(el, "closeword")))).toBe(CLOSE_WORDS.alive(1));
    find(w.bar, (el) => has(el, "closeyes")).fire("click");
    await tick();
    expect(w.calls).toEqual(["close!"]);
    expect(find(w.bar, (el) => has(el, "closeask"))).toBe(null);
    // The bar's own Close button asks nothing itself: it is an ordinary
    // close, and the hold is the main process's.
    find(w.bar, (el) => has(el, "close") && el.tagName === "BUTTON").fire("click");
    expect(w.calls).toEqual(["close!", "close"]);
  } finally {
    w.done();
  }
});
