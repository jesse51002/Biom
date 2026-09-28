// SPDX-License-Identifier: AGPL-3.0-only
// THE WINDOW ON A WORKSPACE OF TWO THOUSAND PAGES: the pin that no screen path
// asks for every page. A spy transport answers from an invented tree of about
// two thousand pages held here in memory — never on disk — shaped like a real
// big workspace: seven top sections, one holding about fourteen hundred pages
// two levels down, one holding two hundred and twenty-eight flat. Every step
// is asked what it sent, and across the whole file no request is `page.list`
// or `children.all`.
//
// Every page, name and uid here is invented.

import { test, expect, afterEach, beforeEach, afterAll } from "bun:test";

import { spyTransport, wholeTreeReads } from "./scale-helpers.ts";
import { makeWorkspace, ROOT_PAGE, WANT_BATCH, ancestorsOf, parentOf } from "../client/store/workspace.js";
import { makeUi } from "../client/store/ui.js";
import { makeTreeView } from "../client/views/tree.js";
import { makeShell, FIND_AFTER } from "../client/shell/shell.js";
import { makeSwitcher, TIMING } from "../client/store/switcher.js";
import { makeHistoryStore } from "../client/store/history.js";
import { closePopover } from "../client/widgets/popover.js";

/* ── the invented tree ────────────────────────────────────────────────── */

const THEME = {
  palette: { name: "Invented", colors: { ink: "x" }, extra: [] },
  fonts: { roles: { sheet: "a", furniture: "b", gauge: "c" }, available: [] },
};

/** A deterministic uid for an id: 16 lowercase hex-ish characters. @param {string} id */
function uidFor(id) {
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    a = ((a << 5) + a + c) >>> 0;
    b = ((b << 5) + b ^ c) >>> 0;
  }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 16);
}

/** @returns {{ pages: Map<string, { name: string, uid: string, kids: string[] }>, tables: any[] }} */
function inventTree() {
  /** @type {Map<string, { name: string, uid: string, kids: string[] }>} */
  const pages = new Map();
  /** @param {string} id @param {string} name */
  const add = (id, name) => {
    pages.set(id, { name, uid: uidFor(id), kids: [] });
    const up = parentOf(id);
    if (up !== null) /** @type {any} */ (pages.get(up)).kids.push(id);
  };
  add(ROOT_PAGE, "Invented workspace");
  for (const top of ["Specs", "Automations", "Historic", "People", "Notes", "Design_Notes", "Archive"]) add(`home/${top}`, top.replace("_", " "));
  // Automations: 35 groups of 40 pages, two levels down.
  for (let g = 0; g < 35; g++) {
    const group = `home/Automations/Group_${g}`;
    add(group, `Invented group ${g}`);
    for (let i = 0; i < 40; i++) add(`${group}/Run_${i}`, `Invented run ${g}.${i}`);
  }
  // Historic: 228 flat.
  for (let i = 0; i < 228; i++) add(`home/Historic/Day_${i}`, `Invented day ${i}`);
  // The rest, a few hundred more spread about.
  for (let i = 0; i < 120; i++) add(`home/Specs/Spec_${i}`, `Invented spec ${i}`);
  for (let i = 0; i < 80; i++) add(`home/People/Person_${i}`, `Invented person ${i}`);
  for (let i = 0; i < 60; i++) add(`home/Notes/Note_${i}`, `Invented note ${i}`);
  for (let i = 0; i < 40; i++) add(`home/Archive/Old_${i}`, `Invented old ${i}`);
  const tables = [{ name: "jobs", kind: "basic", rows: 3, parent: ROOT_PAGE }, { name: "leads", kind: "basic", rows: 0, parent: "home/People" }];
  return { pages, tables };
}

/** A server over the invented tree, answering the kinds the window sends. */
function inventServer() {
  const t = inventTree();
  /** @param {string} id */
  const ref = (id) => {
    const p = t.pages.get(id);
    return p ? { id, name: p.name, uid: p.uid } : null;
  };
  /** @param {string} id */
  const level = (id) => {
    const p = t.pages.get(id);
    if (!p) return [];
    return [
      ...p.kids.map((k) => {
        const c = /** @type {any} */ (t.pages.get(k));
        return { kind: "page", id: k, name: c.name, uid: c.uid, children: c.kids.length > 0 };
      }),
      ...t.tables.filter((x) => (x.parent ?? ROOT_PAGE) === id).map((x) => ({ kind: "table", id: x.name, name: x.name, rows: x.rows })),
    ];
  };
  /** @param {any} req */
  const answer = (req) => {
    switch (req.kind) {
      case "children": return level(req.page ?? ROOT_PAGE);
      case "table.list": return t.tables;
      case "theme.get": return THEME;
      case "history.read": return { entries: [], head: 0 };
      case "window.report": return [];
      case "page.read": {
        const r = ref(req.page);
        return r ? { ...r, variables: {}, sections: [], page: [], ports: null, html: "", plugin: "biom-doc", input: {} } : null;
      }
      case "page.locate": {
        /** @type {any[]} */
        const out = [];
        for (const id of req.ids ?? []) { const r = ref(id); if (r) out.push(r); }
        for (const uid of req.uids ?? []) {
          for (const [id, p] of t.pages) if (p.uid === uid) { out.push({ id, name: p.name, uid }); break; }
        }
        return out;
      }
      case "page.search": {
        const q = String(req.query).toLowerCase();
        const limit = req.limit ?? 50;
        const all = [...t.pages].filter(([, p]) => p.name.toLowerCase().includes(q)).map(([id, p]) => ({ id, name: p.name, uid: p.uid }));
        return { hits: all.slice(0, limit), more: all.length > limit, complete: true };
      }
      case "page.create": {
        const parent = req.init.parent ?? ROOT_PAGE;
        const id = `${parent}/${req.init.name.replace(/\s+/g, "_")}`;
        t.pages.set(id, { name: req.init.name, uid: uidFor(id), kids: [] });
        /** @type {any} */ (t.pages.get(parent)).kids.push(id);
        return { id, name: req.init.name, uid: uidFor(id) };
      }
      case "page.remove": {
        const up = /** @type {string} */ (parentOf(req.page));
        const p = /** @type {any} */ (t.pages.get(up));
        p.kids = p.kids.filter((/** @type {string} */ k) => k !== req.page);
        for (const id of [...t.pages.keys()]) if (id === req.page || id.startsWith(req.page + "/")) t.pages.delete(id);
        return null;
      }
      case "page.move": {
        const from = /** @type {string} */ (parentOf(req.page));
        const seg = req.page.slice(req.page.lastIndexOf("/") + 1);
        const to = `${req.parent}/${seg}`;
        movePrefix(req.page, to);
        const was = /** @type {any} */ (t.pages.get(from));
        was.kids = was.kids.filter((/** @type {string} */ k) => k !== req.page);
        /** @type {any} */ (t.pages.get(req.parent)).kids.push(to);
        return to;
      }
      case "page.rename": {
        const up = /** @type {string} */ (parentOf(req.page));
        const to = `${up}/${req.name.replace(/\s+/g, "_")}`;
        movePrefix(req.page, to);
        /** @type {any} */ (t.pages.get(to)).name = req.name;
        const p = /** @type {any} */ (t.pages.get(up));
        p.kids = p.kids.map((/** @type {string} */ k) => (k === req.page ? to : k));
        return to;
      }
      default: return null;
    }
  };
  /** @param {string} from @param {string} to */
  function movePrefix(from, to) {
    for (const [id, p] of [...t.pages]) {
      if (id !== from && !id.startsWith(from + "/")) continue;
      const next = to + id.slice(from.length);
      t.pages.delete(id);
      p.kids = p.kids.map((k) => to + k.slice(from.length));
      t.pages.set(next, p);
    }
  }
  const spy = spyTransport(answer);
  return { t, spy, uidFor };
}

/** What the spy was asked, as `kind:page` for a level and `kind` otherwise. @param {any[]} calls */
const asked = (calls) => calls.map((c) => (c.kind === "children" ? "children:" + c.page : c.kind));
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Every spy made in this file, checked after each test: NO WHOLE-TREE READ, EVER. */
/** @type {any[]} */
const spies = [];
function standUp() {
  const s = inventServer();
  spies.push(s.spy);
  const ws = makeWorkspace(s.spy);
  return { ...s, ws };
}
afterEach(() => {
  for (const spy of spies.splice(0)) expect(wholeTreeReads(spy.calls)).toEqual([]);
});

test("the invented tree is about two thousand pages", () => {
  const { t } = inventServer();
  expect(t.pages.size).toBeGreaterThan(1900);
  expect(/** @type {any} */ (t.pages.get("home/Historic")).kids.length).toBe(228);
});

/* ── boot ─────────────────────────────────────────────────────────────── */

test("boot asks for the root's level, the levels on the way to the route's page, the tables and the theme — and nothing else", async () => {
  const { ws, spy } = standUp();
  let heard = 0;
  ws.on(() => heard++);
  await ws.loadTree("home/Automations/Group_3/Run_7");
  expect(asked(spy.calls).sort()).toEqual([
    "children:home", "children:home/Automations", "children:home/Automations/Group_3", "table.list", "theme.get",
  ].sort());
  expect(wholeTreeReads(spy.calls)).toEqual([]);
  expect(heard).toBe(1);
  // What the levels named is known, and nothing more.
  expect(ws.refOf("home/Automations/Group_3/Run_7")?.name).toBe("Invented run 3.7");
  expect(ws.refOf("home/Historic/Day_4")).toBe(null);
  expect(ws.get().pages.length).toBe(7 + 35 + 40);
  expect(ws.children("home").filter((c) => c.kind === "page").length).toBe(7);
  expect(ws.children("home").find((c) => c.id === "home/Historic")?.children).toBe(true);
});

test("a boot with no page on the route asks for the root's level alone", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree();
  expect(asked(spy.calls).sort()).toEqual(["children:home", "table.list", "theme.get"]);
});

test("the ancestors of a page are the levels that hold it, root first", () => {
  expect(ancestorsOf("home/A/B/C")).toEqual(["home", "home/A", "home/A/B"]);
  expect(ancestorsOf("home")).toEqual(["home"]);
  expect(ancestorsOf("Top/Leaf")).toEqual(["home", "Top"]);
});

/* ── navigation ───────────────────────────────────────────────────────── */

test("a boot and the rail asking for the same levels at once list each level once", async () => {
  const { ws, spy } = standUp();
  await Promise.all([ws.reveal("home/Automations/Group_3/Run_7"), ws.loadTree("home/Automations/Group_3/Run_7")]);
  expect(asked(spy.calls).filter((k) => k.startsWith("children")).sort()).toEqual([
    "children:home", "children:home/Automations", "children:home/Automations/Group_3",
  ]);
});

test("going to a deep page lists only the levels on the way that are missing", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree("home/Automations/Group_3/Run_7");
  spy.clear();
  await ws.reveal("home/Automations/Group_9/Run_1");
  expect(asked(spy.calls)).toEqual(["children:home/Automations/Group_9"]);
  spy.clear();
  await ws.reveal("home/Automations/Group_9/Run_2");
  expect(spy.calls).toEqual([]);
});

test("a level is listed once, however many times it is opened in one tick, and once it is held never again", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree();
  spy.clear();
  let heard = 0;
  ws.on(() => heard++);
  const v = ws.version();
  expect(ws.held("home/Historic")).toBe(false);
  await Promise.all([ws.expand("home/Historic"), ws.expand("home/Historic")]);
  expect(asked(spy.calls)).toEqual(["children:home/Historic"]);
  expect(ws.held("home/Historic")).toBe(true);
  expect(ws.children("home/Historic").length).toBe(228);
  expect(ws.version()).toBeGreaterThan(v);
  expect(heard).toBe(1);
  await ws.expand("home/Historic");
  expect(spy.calls.length).toBe(1);
  // Reading what is held asks nothing, however often.
  for (let i = 0; i < 10; i++) { ws.get(); ws.children("home/Historic"); ws.refOf("home/Historic/Day_9"); }
  expect(spy.calls.length).toBe(1);
});

/* ── a change on disk, by name ────────────────────────────────────────── */

test("a change naming only a page lists no level; one naming levels lists only those this window holds; all lists every held level", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree("home/Specs/Spec_3");
  spy.clear();
  await ws.refresh({ pages: ["home/Notes/Note_2"], levels: [] });
  expect(asked(spy.calls).filter((k) => k.startsWith("children"))).toEqual([]);
  spy.clear();
  await ws.refresh({ pages: [], levels: ["home/Specs", "home/Historic"] });
  expect(asked(spy.calls).filter((k) => k.startsWith("children"))).toEqual(["children:home/Specs"]);
  spy.clear();
  await ws.refresh({ pages: [], levels: [], all: true });
  expect(asked(spy.calls).filter((k) => k.startsWith("children")).sort()).toEqual(["children:home", "children:home/Specs"]);
});

test("a level read again lets go of a page it no longer holds, and of everything under it", async () => {
  const { ws, t } = standUp();
  await ws.loadTree("home/Notes/Note_1");
  expect(ws.refOf("home/Notes/Note_1")).not.toBe(null);
  const notes = /** @type {any} */ (t.pages.get("home/Notes"));
  notes.kids = notes.kids.filter((/** @type {string} */ k) => k !== "home/Notes/Note_1");
  t.pages.delete("home/Notes/Note_1");
  await ws.refresh({ pages: [], levels: ["home/Notes"] });
  expect(ws.refOf("home/Notes/Note_1")).toBe(null);
  expect(ws.idOfUid(uidFor("home/Notes/Note_1"))).toBe(null);
});

/* ── writes ───────────────────────────────────────────────────────────── */

test("a page made, removed, moved or renamed lists again only the levels it left and arrived in", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree("home/Specs/Spec_3");
  await ws.expand("home/Notes");
  spy.clear();

  const made = await ws.createPage({ name: "Invented fresh", parent: "home/Specs" });
  expect(asked(spy.calls)).toEqual(["page.create", "children:home/Specs"]);
  expect(ws.refOf(made.id)?.name).toBe("Invented fresh");
  spy.clear();

  await ws.removePage(made.id);
  expect(asked(spy.calls)).toEqual(["page.remove", "children:home/Specs"]);
  expect(ws.refOf(made.id)).toBe(null);
  spy.clear();

  const moved = await ws.moveChild({ kind: "page", id: "home/Specs/Spec_4", name: "Invented spec 4" }, "home/Specs", "home/Notes");
  expect(moved).toBe("home/Notes/Spec_4");
  expect(asked(spy.calls).sort()).toEqual(["children:home/Notes", "children:home/Specs", "page.move"].sort());
  expect(ws.refOf("home/Specs/Spec_4")).toBe(null);
  expect(ws.refOf("home/Notes/Spec_4")?.name).toBe("Invented spec 4");
  spy.clear();

  const to = await ws.renamePage("home/Notes/Note_5", "Invented renamed");
  expect(asked(spy.calls)).toEqual(["page.rename", "children:home/Notes"]);
  expect(ws.refOf(to)?.name).toBe("Invented renamed");
  expect(ws.refOf("home/Notes/Note_5")).toBe(null);
});

test("a write under a level this window never listed lists nothing", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree();
  spy.clear();
  await ws.removePage("home/Archive/Old_3");
  expect(asked(spy.calls)).toEqual(["page.remove"]);
});

/* ── asking by name ───────────────────────────────────────────────────── */

test("two hundred unknown uids wanted in one tick are four page.locate requests of at most sixty-four each", async () => {
  const { ws, spy, t } = standUp();
  await ws.loadTree();
  spy.clear();
  const uids = [...t.pages.keys()].filter((id) => id.startsWith("home/Automations/Group_")).slice(0, 200).map(uidFor);
  let heard = 0;
  ws.on(() => heard++);
  await ws.want({ uids });
  expect(asked(spy.calls)).toEqual(["page.locate", "page.locate", "page.locate", "page.locate"]);
  for (const c of spy.calls) expect(/** @type {any} */ (c).uids.length).toBeLessThanOrEqual(WANT_BATCH);
  expect(spy.calls.reduce((n, c) => n + /** @type {any} */ (c).uids.length, 0)).toBe(200);
  expect(heard).toBe(1);
  for (const uid of uids) expect(ws.idOfUid(uid)).not.toBe(null);
  // Known now: asked for again, nothing is sent.
  await ws.want({ uids });
  expect(spy.calls.length).toBe(4);
});

test("callers wanting the same page in one tick, or while it is on its way, share one ask", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree();
  spy.clear();
  const a = ws.want({ ids: ["home/Historic/Day_1", "home/Historic/Day_2"] });
  const b = ws.want({ ids: ["home/Historic/Day_2"] });
  await Promise.resolve();
  const c = ws.want({ ids: ["home/Historic/Day_1"] });
  await Promise.all([a, b, c]);
  expect(asked(spy.calls)).toEqual(["page.locate"]);
  expect(/** @type {any} */ (spy.calls[0]).ids).toEqual(["home/Historic/Day_1", "home/Historic/Day_2"]);
});

test("a page located as absent is not asked again until a change on disk", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree();
  spy.clear();
  await ws.want({ ids: ["home/Nowhere"], uids: ["0000invented0000"] });
  await ws.want({ ids: ["home/Nowhere"], uids: ["0000invented0000"] });
  expect(asked(spy.calls)).toEqual(["page.locate"]);
  await ws.refresh({ pages: [], levels: [] });
  spy.clear();
  await ws.want({ ids: ["home/Nowhere"] });
  expect(asked(spy.calls)).toEqual(["page.locate"]);
});

test("search asks the server by name and learns what it found", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree();
  spy.clear();
  const found = await ws.search("invented day 22");
  expect(asked(spy.calls)).toEqual(["page.search"]);
  expect(found.hits.map((h) => h.id)).toContain("home/Historic/Day_22");
  expect(ws.refOf("home/Historic/Day_22")?.name).toBe("Invented day 22");
});

/* ── the window, assembled: the real store, the real rail, the real shell ── */

// A recording element factory, the one `tests/shell.test.js` builds the shell
// against, so the shell's own paths — the crumbs, the root's name, the finder,
// the redraw on a change — are asked what they send through the real store.
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
    // `setProperty` is what the rack writes its width with; a plain key is what
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


beforeEach(() => {
  globalThis.document = /** @type {any} */ ({ addEventListener() {}, removeEventListener() {} });
  globalThis.window = /** @type {any} */ ({ addEventListener() {}, removeEventListener() {} });
  try { closePopover(); } catch { /* somebody else's menu, and now it is shut */ }
});
afterAll(() => { delete globalThis.document; delete globalThis.window; });

/** The events a stream would hand the shell: a change's data text, or null. */
function streamOf() {
  /** @type {Set<(data: string | null) => void>} */
  const hears = new Set();
  return {
    on(/** @type {(data: string | null) => void} */ hear) { hears.add(hear); return () => { hears.delete(hear); }; },
    /** @param {unknown} data */
    fire(data) { for (const hear of [...hears]) hear(data === null ? null : JSON.stringify(data)); },
  };
}

/** A window on the invented workspace, on `route`, booted the way boot.js
 *  boots it: the route first, the tree beside it. */
async function windowOn(route) {
  const s = standUp();
  const ui = makeUi({ route: { view: "page", id: route, screen: "page" } });
  const events = streamOf();
  const kept = [];
  const frameHost = {
    setShim() {}, for() { throw new Error("no frame here"); }, drop() {},
    broadcast() {}, compliance() { return null; }, keep(/** @type {string} */ k) { kept.push(k); },
  };
  const pageBody = (/** @type {any} */ p) => h("div.pagebody", p.id);
  const views = {
    tree: makeTreeView({ h, ws: s.ws, ui }),
    page: pageBody, table: () => h("div"), vault: () => h("div"), design: pageBody, map: pageBody,
    runs: () => h("div"), instructions: { vault: () => h("div"), page: pageBody }, automation: pageBody,
  };
  const shell = makeShell({ h, fill, ws: s.ws, ui, frameHost: /** @type {any} */ (frameHost), views, production: false, events, search: "" });
  s.ws.on(() => shell.repaint());
  ui.on(() => shell.repaint());
  const root = element("div");
  shell.mount(root);
  await s.ws.loadTree(route);
  for (let i = 0; i < 6; i++) await tick();
  return { ...s, ui, events, shell, root, kept };
}

test("the window assembled boots on a deep page without asking for every page, and drawing it again asks nothing", async () => {
  const w = await windowOn("home/Automations/Group_3/Run_7");
  const kinds = asked(w.spy.calls);
  expect(kinds.filter((k) => k.startsWith("children")).sort()).toEqual(["children:home", "children:home/Automations", "children:home/Automations/Group_3"]);
  expect(kinds).toContain("page.read");
  expect(kinds).toContain("table.list");
  expect(kinds).toContain("theme.get");
  expect(wholeTreeReads(w.spy.calls)).toEqual([]);
  // The crumbs are named from the levels on the way down, and the root's own
  // name was asked for by id.
  expect(findAll(w.root, (el) => has(el, "crumb")).map(flat)).toEqual(["Invented workspace", "Automations", "Invented group 3", "Invented run 3.7"]);
  // TEN REPAINTS ASK NOTHING: drawing reads only what is held.
  const before = w.spy.calls.length;
  for (let i = 0; i < 10; i++) { w.shell.repaint(); await tick(); }
  expect(w.spy.calls.length).toBe(before);
});

test("a change naming another page reads no page and no level; naming the open page reads it once; levels read only those held; all reads the page and every held level; a reconnect is all", async () => {
  const w = await windowOn("home/Specs/Spec_3");
  const reads = () => asked(w.spy.calls).filter((k) => k === "page.read").length;
  const levels = () => asked(w.spy.calls).filter((k) => k.startsWith("children"));

  w.spy.clear();
  w.events.fire({ pages: ["home/Notes/Note_2"], levels: [] });
  for (let i = 0; i < 4; i++) await tick();
  expect(reads()).toBe(0);
  expect(levels()).toEqual([]);

  w.spy.clear();
  w.events.fire({ pages: ["home/Specs/Spec_3"], levels: [] });
  for (let i = 0; i < 4; i++) await tick();
  expect(reads()).toBe(1);
  expect(levels()).toEqual([]);

  w.spy.clear();
  w.events.fire({ pages: [], levels: ["home/Specs", "home/Historic"] });
  for (let i = 0; i < 4; i++) await tick();
  expect(reads()).toBe(0);
  expect(levels()).toEqual(["children:home/Specs"]);

  w.spy.clear();
  w.events.fire({ pages: [], levels: [], all: true });
  for (let i = 0; i < 4; i++) await tick();
  expect(reads()).toBe(1);
  expect(levels().sort()).toEqual(["children:home", "children:home/Specs"]);

  w.spy.clear();
  w.events.fire(null);
  for (let i = 0; i < 4; i++) await tick();
  expect(reads()).toBe(1);
  expect(levels().sort()).toEqual(["children:home", "children:home/Specs"]);
});

test("the rail's finder is one page.search after the typing pauses, through the real store", async () => {
  const w = await windowOn("home/Specs/Spec_3");
  w.spy.clear();
  const finder = find(w.root, (el) => has(el, "railfind"));
  for (const v of ["i", "in", "inv", "invented day 22"]) finder.fire("input", { currentTarget: { value: v } });
  await tick();
  expect(asked(w.spy.calls)).toEqual([]);
  await Bun.sleep(FIND_AFTER + 30);
  for (let i = 0; i < 3; i++) await tick();
  expect(asked(w.spy.calls)).toEqual(["page.search"]);
  expect(findAll(w.root, (el) => has(el, "foundrow")).map((r) => flat(find(r, (el) => has(el, "nm"))))).toContain("Invented day 22");
});

/* ── the switcher: a page it has never heard of ───────────────────────── */

test("an agent's write to a page this window never listed is looked up by uid and followed, with no level listed for it", async () => {
  const { ws, spy } = standUp();
  await ws.loadTree();
  const ui = makeUi({ route: { view: "agent", id: "c1nvented-chat", screen: "page" } });
  const history = makeHistoryStore({ transport: spy, now: Date.now });
  const switcher = makeSwitcher({
    ui, history, window: "w1nvented-window",
    refOf: (id) => ws.refOf(id), idOfUid: (uid) => ws.idOfUid(uid), want: (q) => ws.want(q), onPages: (hear) => ws.on(hear),
    now: Date.now, timing: TIMING,
  });
  await switcher.start();
  spy.clear();
  const uid = uidFor("home/Historic/Day_9");
  history.take([{
    kind: "edit", seq: 1, at: 0, place: { view: "page", uid, screen: "page" }, path: "pages/home/children/Historic/children/Day_9/content.yaml",
    via: "fs", snapshot: null, writer: { kind: "agent", agent: "a1nvented-agent", chat: "c1nvented-chat", harness: "Invented agent", turn: 1 },
  }], true);
  for (let i = 0; i < 6; i++) await tick();
  expect(ui.get().route).toEqual({ view: "page", id: "home/Historic/Day_9", screen: "page" });
  expect(ui.get().panel).toBe(true);
  expect(asked(spy.calls).filter((k) => k === "page.locate")).toEqual(["page.locate"]);
  expect(asked(spy.calls).filter((k) => k.startsWith("children"))).toEqual([]);
});
