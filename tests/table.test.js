// SPDX-License-Identifier: AGPL-3.0-only
// The grid's answers, without a browser.
//
// Everything below is the half of views/table.js that decides *which* rows and
// *in what order* — the half that used to run over positional arrays in memory
// and now has to agree with a database. The drawing half needs a DOM and is
// checked by looking at it; these four are the ones that are wrong silently.

import { afterEach, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  blankRow, cellText, compareOp, compareRows, filterRows, freeName, makeTableView, pagesUsing,
  passes, readCategories, reorderColumns, sortKey, sortRows, toCsv, writeCategories,
} from "../client/views/table.js";

/** @param {string} name @param {string} type @param {object} [rest] */
const col = (name, type, rest = {}) => ({ name, type, ...rest });

const COLUMNS = [
  col("name", "text"),
  col("area", "number"),
  col("due", "date"),
  col("done", "checkbox"),
  col("tier", "categories", {
    options: [
      { label: "Standard", colour: "cyan" },
      { label: "Premium", colour: "magenta" },
    ],
  }),
  col("who", "person"),
  col("site", "url"),
  col("job", "link", { table: "jobs", show: "name" }),
  col("notes", "page"),
];

/** @param {number} id @param {object} cells */
const row = (id, cells) => ({ id, cells });

const ROWS = [
  row(1, { name: "ashgrove", area: 120, due: "2026-08-10", done: 1, tier: '["Standard"]', who: "Dan", site: "a.co", job: 7, notes: "team-notes" }),
  row(2, { name: "Bell St", area: 40, due: "2026-09-01", done: 0, tier: '["Premium","Standard"]', who: "Mo", site: "b.co", job: 3, notes: null }),
  row(3, { name: "Carr Lane", area: null, due: null, done: 0, tier: "[]", who: null, site: "", job: null, notes: null }),
];

const names = (rows) => rows.map((r) => r.cells.name);
const ids = (rows) => rows.map((r) => r.id);

/* ── categories ────────────────────────────────────────────────────────── */

test("a categories cell is a JSON array, read tolerantly", () => {
  expect(readCategories('["Render","Scaffold"]')).toEqual(["Render", "Scaffold"]);
  expect(readCategories("[]")).toEqual([]);
  expect(readCategories(null)).toEqual([]);
  expect(readCategories("")).toEqual([]);
  // A CSV import puts whatever was in the file into the column. "Done" is one
  // label, not nothing, and "a; b" is the mock's own delimiter arriving late.
  expect(readCategories("Done")).toEqual(["Done"]);
  expect(readCategories("Render; Scaffold")).toEqual(["Render", "Scaffold"]);
  expect(readCategories("[not json")).toEqual(["[not json"]);
  expect(writeCategories(["a", "b", "a"])).toBe('["a","b"]');
});

/* ── filters ───────────────────────────────────────────────────────────── */

test("a values filter matches on the text a person sees", () => {
  const who = COLUMNS[5];
  const f = { column: "who", kind: "values", values: new Set(["Dan"]) };
  expect(passes(ROWS[0], who, f)).toBe(true);
  expect(passes(ROWS[1], who, f)).toBe(false);
  expect(passes(ROWS[2], who, f)).toBe(false);      // null is not "null"
});

test("a checkbox filters as true and false, whatever 0 and 1 are stored as", () => {
  const done = COLUMNS[3];
  const yes = { column: "done", kind: "values", values: new Set(["true"]) };
  const no = { column: "done", kind: "values", values: new Set(["false"]) };
  expect(passes(ROWS[0], done, yes)).toBe(true);
  expect(passes(ROWS[1], done, yes)).toBe(false);
  expect(passes(ROWS[1], done, no)).toBe(true);
  expect(cellText(0, done)).toBe("false");
  expect(cellText(null, done)).toBe("false");
});

test("a categories filter is any-of, not all-of", () => {
  const tier = COLUMNS[4];
  const f = { column: "tier", kind: "values", values: new Set(["Premium"]) };
  expect(passes(ROWS[0], tier, f)).toBe(false);
  expect(passes(ROWS[1], tier, f)).toBe(true);
  expect(passes(ROWS[2], tier, f)).toBe(false);
  f.values.add("Standard");
  expect(passes(ROWS[0], tier, f)).toBe(true);
});

test("a text filter is a case-insensitive contains", () => {
  const name = COLUMNS[0];
  expect(passes(ROWS[0], name, { column: "name", kind: "text", q: "GROVE" })).toBe(true);
  expect(passes(ROWS[1], name, { column: "name", kind: "text", q: "grove" })).toBe(false);
});

test("numbers answer over, under, is and between", () => {
  const gt = (a) => ({ op: "gt", a });
  expect(compareOp(120, "number", gt("100"))).toBe(true);
  expect(compareOp(40, "number", gt("100"))).toBe(false);
  expect(compareOp(40, "number", { op: "lt", a: "100" })).toBe(true);
  expect(compareOp(120, "number", { op: "eq", a: "120" })).toBe(true);
  expect(compareOp(120, "number", { op: "between", a: "100", b: "200" })).toBe(true);
  // Given backwards, because a person dragging two fields will
  expect(compareOp(120, "number", { op: "between", a: "200", b: "100" })).toBe(true);
  expect(compareOp(40, "number", { op: "between", a: "100", b: "200" })).toBe(false);
  // One-sided between: the second field is still empty
  expect(compareOp(120, "number", { op: "between", a: "100", b: "" })).toBe(true);
  expect(compareOp(40, "number", { op: "between", a: "100", b: "" })).toBe(false);
  // An empty cell is not zero and never matches a comparison
  expect(compareOp(null, "number", gt("-1"))).toBe(false);
  expect(compareOp("", "number", { op: "eq", a: "0" })).toBe(false);
});

test("dates answer after, before, on and between", () => {
  expect(compareOp("2026-08-10", "date", { op: "gt", a: "2026-08-01" })).toBe(true);
  expect(compareOp("2026-08-10", "date", { op: "lt", a: "2026-08-01" })).toBe(false);
  expect(compareOp("2026-08-10", "date", { op: "eq", a: "2026-08-10" })).toBe(true);
  expect(compareOp("2026-09-01", "date", { op: "between", a: "2026-08-01", b: "2026-10-01" })).toBe(true);
  expect(compareOp("2026-07-01", "date", { op: "between", a: "2026-08-01", b: "2026-10-01" })).toBe(false);
  expect(compareOp(null, "date", { op: "gt", a: "1970-01-01" })).toBe(false);
  expect(compareOp("not a date", "date", { op: "eq", a: "2026-08-10" })).toBe(false);
});

test("filters compose, and search reads every column", () => {
  const only = filterRows(ROWS, COLUMNS, {
    filters: [{ column: "area", kind: "cmp", op: "gt", a: "50" }],
  });
  expect(names(only)).toEqual(["ashgrove"]);

  // two filters on one column: added, never edited, so they narrow
  const range = filterRows(ROWS, COLUMNS, {
    filters: [
      { column: "area", kind: "cmp", op: "gt", a: "10" },
      { column: "area", kind: "cmp", op: "lt", a: "100" },
    ],
  });
  expect(names(range)).toEqual(["Bell St"]);

  expect(names(filterRows(ROWS, COLUMNS, { q: "bell" }))).toEqual(["Bell St"]);
  expect(names(filterRows(ROWS, COLUMNS, { q: "premium" }))).toEqual(["Bell St"]);  // inside a categories cell
  expect(filterRows(ROWS, COLUMNS, { q: "nothing here" })).toEqual([]);

  // a filter naming a column that has since been deleted must not hide the table
  expect(filterRows(ROWS, COLUMNS, { filters: [{ column: "gone", kind: "text", q: "x" }] }).length).toBe(3);
});

/* ── sorting ───────────────────────────────────────────────────────────── */

test("empty sinks in both directions", () => {
  const area = COLUMNS[1];
  expect(ids(sortRows(ROWS, area, 1))).toEqual([2, 1, 3]);
  expect(ids(sortRows(ROWS, area, -1))).toEqual([1, 2, 3]);   // row 3 is empty, still last
  const due = COLUMNS[2];
  expect(ids(sortRows(ROWS, due, 1))).toEqual([1, 2, 3]);
  expect(ids(sortRows(ROWS, due, -1))).toEqual([2, 1, 3]);
});

test("text sorts by what it reads like, not by byte", () => {
  const name = COLUMNS[0];
  // "ashgrove" before "Bell St": a case-sensitive comparison puts every capital
  // first and the column reads as if it were sorted at random.
  expect(names(sortRows(ROWS, name, 1))).toEqual(["ashgrove", "Bell St", "Carr Lane"]);
  const mixed = [row(1, { name: "beta" }), row(2, { name: "Alpha" }), row(3, { name: "alpha" })];
  expect(ids(sortRows(mixed, name, 1))).toEqual([2, 3, 1]);   // ties keep one stable answer
});

test("numbers sort as numbers", () => {
  const area = COLUMNS[1];
  const wide = [row(1, { area: 9 }), row(2, { area: 100 }), row(3, { area: 20 })];
  expect(ids(sortRows(wide, area, 1))).toEqual([1, 3, 2]);
});

test("every other type has an answer too", () => {
  const done = COLUMNS[3], tier = COLUMNS[4], job = COLUMNS[7], notes = COLUMNS[8];
  // checkbox: unticked before ticked, and an empty checkbox is unticked rather
  // than empty — there is no third state to sink.
  expect(sortKey(null, done)).toBe(0);
  expect(ids(sortRows(ROWS, done, 1))).toEqual([2, 3, 1]);
  // categories sort on their first label
  expect(sortKey('["Premium","Standard"]', tier)).toBe("Premium");
  expect(sortKey("[]", tier)).toBe(null);
  expect(ids(sortRows(ROWS, tier, 1))).toEqual([2, 1, 3]);
  // link holds a row id, so it is a number
  expect(sortKey(7, job)).toBe(7);
  expect(ids(sortRows(ROWS, job, 1))).toEqual([2, 1, 3]);
  // page holds a page id, so it is text
  expect(sortKey("team-notes", notes)).toBe("team-notes");
  expect(ids(sortRows(ROWS, notes, 1))).toEqual([1, 2, 3]);
});

test("a sort is stable, so equal rows do not shuffle", () => {
  const done = COLUMNS[3];
  const same = [row(1, { done: 0 }), row(2, { done: 0 }), row(3, { done: 0 })];
  expect(ids(sortRows(same, done, 1))).toEqual([1, 2, 3]);
  expect(ids(sortRows(same, done, -1))).toEqual([1, 2, 3]);
  expect(compareRows(same[0], same[1], done, 1)).toBe(0);
});

/* ── columns ───────────────────────────────────────────────────────────── */

test("reordering a column moves no data", () => {
  const before = COLUMNS.map((c) => c.name);
  const moved = reorderColumns(COLUMNS, 0, 2);
  expect(moved.map((c) => c.name)).toEqual(["area", "due", "name", "done", "tier", "who", "site", "job", "notes"]);
  expect(COLUMNS.map((c) => c.name)).toEqual(before);        // the input is not touched

  // The whole point of keying cells by name: every row still answers the same
  // for every column, and no filter or sort has to be re-indexed afterwards.
  for (const r of ROWS) for (const c of moved) expect(r.cells[c.name]).toBe(ROWS[r.id - 1].cells[c.name]);

  // moving right, moving left, and the no-ops
  expect(reorderColumns(COLUMNS, 2, 0).map((c) => c.name).slice(0, 3)).toEqual(["due", "name", "area"]);
  expect(reorderColumns(COLUMNS, 1, 1).map((c) => c.name)).toEqual(before);
  expect(reorderColumns(COLUMNS, 1, 99).map((c) => c.name)).toEqual(before);
  expect(reorderColumns(COLUMNS, -1, 1).map((c) => c.name)).toEqual(before);
});

test("a new property never lands on a name that is taken", () => {
  expect(freeName(COLUMNS, "colour")).toBe("colour");
  expect(freeName(COLUMNS, "name")).toBe("name_2");
  expect(freeName([...COLUMNS, col("name_2", "text")], "name")).toBe("name_3");
});

test("a new row is empty rather than zero", () => {
  const blank = blankRow({ name: "t", kind: "basic", columns: COLUMNS });
  expect(blank.area).toBe(null);
  expect(blank.due).toBe(null);          // not a frozen "today", which the mock shipped
  expect(blank.done).toBe(0);            // checkbox is NOT NULL DEFAULT 0
  expect(blank.tier).toBe("[]");
  expect(Object.keys(blank).length).toBe(COLUMNS.length);
});

/* ── CSV ───────────────────────────────────────────────────────────────── */

test("CSV quotes per RFC 4180", () => {
  const columns = [col("a", "text"), col("b", "text"), col("c", "number"), col("d", "checkbox")];
  const rows = [
    row(1, { a: "plain", b: "has, comma", c: 1, d: 0 }),
    row(2, { a: 'say "hi"', b: "line\nbreak", c: null, d: 1 }),
    row(3, { a: "carriage\r\nreturn", b: "", c: -2.5, d: null }),
  ];
  expect(toCsv(columns, rows)).toBe([
    "a,b,c,d",
    'plain,"has, comma",1,0',
    '"say ""hi""","line\nbreak",,1',
    '"carriage\r\nreturn",,-2.5,',
  ].join("\r\n"));
});

test("CSV takes its columns from the schema, in the order shown", () => {
  const columns = [col("second", "text"), col("first", "text")];
  const rows = [row(1, { first: "1", second: "2", dropped: "3" })];
  expect(toCsv(columns, rows)).toBe("second,first\r\n2,1");

  // a column with no cell in a row is empty, not "undefined"
  expect(toCsv([col("missing", "text")], rows)).toBe("missing\r\n");
});

test("a header holding a comma is quoted like any other field", () => {
  expect(toCsv([col("rate, per m2", "number")], [])).toBe('"rate, per m2"');
});

/* ── used by ───────────────────────────────────────────────────────────── */

test("which pages use a table is derived, never written down beside it", () => {
  /** A page as the server resolves it: a stack of SECTIONS, each holding its
   *  slots. A table on a page is a section with a table in one of its slots —
   *  not a different kind of entry — so this walks two levels rather than one.
   *  @param {string} id @param {object} rest */
  const page = (id, rest) => ({ id, name: id, variables: {}, sections: [], page: [], ports: null, ...rest });
  /** @param {string} name @param {object} parts */
  const section = (name, parts) => ({ name, html: "", fallback: true, parts, vars: {} });

  const pages = [
    page("quotes", { sections: [section("grid", { body: { kind: "table", table: "rates" } })] }),
    page("notes", { sections: [section("intro", { body: { kind: "markdown", md: "hello", vars: {} } })] }),
    // Two slots in ONE section, which the old flat list could not express at
    // all: the table is found wherever in the section it sits.
    page("mixed", { sections: [section("split", {
      left: { kind: "markdown", md: "words", vars: {} },
      right: { kind: "table", table: "rates" },
    })] }),
    page("board", { ports: { ports: [], bindings: [{ role: "rate", table: "rates", column: "rate_per_m2", state: "ok" }], out: [] } }),
  ];

  expect(pagesUsing("rates", pages).map((u) => [u.page.id, u.how]))
    .toEqual([["quotes", "shows"], ["mixed", "shows"], ["board", "binds"]]);
  expect(pagesUsing("jobs", pages)).toEqual([]);
  expect(pagesUsing("rates", [])).toEqual([]);
});

/* ── the grid itself, against a fake DOM ───────────────────────────────────
   The half above is pure and needed nothing. The property menu is not: a menu
   that outlives the object it opened on is exactly the kind of bug that only
   appears when the real widget is driven, so the real `makeTableView` is run
   here against just enough DOM to paint into and click on. Nothing about the
   grid is stubbed — only `document`. */

class FakeNode {}

class FakeText extends FakeNode {
  /** @param {unknown} value */
  constructor(value) { super(); this.nodeType = 3; this.nodeValue = String(value); this.parentNode = null; }
  get textContent() { return this.nodeValue; }
}

const makeStyle = () => {
  const s = {
    setProperty: (/** @type {string} */ k, /** @type {unknown} */ v) => { s[k] = String(v); },
    getPropertyValue: (/** @type {string} */ k) => s[k] ?? "",
    removeProperty: (/** @type {string} */ k) => { delete s[k]; },
  };
  return s;
};

/** `.klass`, `tag`, and anything with `:not(...)` or `[attr]` hung off a tag. */
const matches = (el, sel) => {
  const one = sel.trim();
  if (one.startsWith(".")) return el.classList.contains(one.slice(1).split(/[:[]/)[0]);
  const tag = one.split(/[:[.]/)[0];
  return !!tag && el.tagName === tag.toUpperCase();
};

class FakeElement extends FakeNode {
  /** @param {string} tag */
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.isConnected = false;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.id = "";
    this.hidden = false;
    this.value = "";
    this.disabled = false;
    this.classes = new Set();
    this.style = makeStyle();
  }
  get className() { return [...this.classes].join(" "); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const set = this.classes;
    return {
      add: (/** @type {string} */ c) => set.add(c),
      remove: (/** @type {string} */ c) => set.delete(c),
      contains: (/** @type {string} */ c) => set.has(c),
      toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => (on ? set.add(c) : set.delete(c)),
    };
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) { this.childNodes = []; this.append(new FakeText(v)); }
  /** Only ever handed an <svg> literal by dom.js, so the markup is not parsed. */
  set innerHTML(markup) {
    const kid = new FakeElement("svg");
    const cls = /class="([^"]*)"/.exec(String(markup));
    if (cls) kid.className = cls[1];
    this.childNodes = [];
    this.append(kid);
  }
  append(...nodes) {
    // The real thing takes strings as well as nodes, and the grid hands it both.
    for (const raw of nodes) {
      const n = raw instanceof FakeNode ? raw : new FakeText(raw);
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  remove() {
    const at = this.parentNode ? this.parentNode.childNodes.indexOf(this) : -1;
    if (at >= 0) this.parentNode.childNodes.splice(at, 1);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  removeEventListener(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn);
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  closest(sel) {
    for (let n = this; n; n = n.parentNode) if (n.nodeType === 1 && matches(n, sel)) return n;
    return null;
  }
  querySelectorAll(sel) {
    const parts = String(sel).split(",");
    const out = [];
    const walk = (el) => {
      for (const kid of el.children) {
        if (parts.some((p) => matches(kid, p))) out.push(kid);
        walk(kid);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  focus() {}
  /** @param {string} name @param {object} [ev] */
  fire(name, ev = {}) {
    const base = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    for (const fn of [...(this.listeners[name] || [])]) fn({ ...base, ...ev });
  }
}

/** These are globals, and another test file in this process has its own idea of
 *  `document`. Put back whatever was there rather than leaving this one lying
 *  around for a file that happens to run afterwards. */
const NAMES = ["Node", "HTMLElement", "document", "window"];
/** @type {Record<string, unknown> | null} */
let before = null;

afterEach(() => {
  if (!before) return;
  for (const key of NAMES) {
    if (before[key] === undefined) delete globalThis[key];
    else globalThis[key] = before[key];
  }
  before = null;
});

function installDom() {
  before ||= Object.fromEntries(NAMES.map((k) => [k, globalThis[k]]));
  const body = new FakeElement("body");
  body.isConnected = true;
  globalThis.Node = FakeNode;
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    activeElement: null,
    body,
    documentElement: new FakeElement("html"),
    createElement: (/** @type {string} */ t) => new FakeElement(t),
    createTextNode: (/** @type {unknown} */ t) => new FakeText(t),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
  return body;
}

const deep = (root, cls) => {
  const out = [];
  const walk = (el) => {
    if (el.classList && el.classList.contains(cls)) out.push(el);
    for (const kid of el.children || []) walk(kid);
  };
  walk(root);
  return out;
};

const THEME = {
  palette: {
    // A fixture palette, not the shipped one: these tests are about how the grid
    // paints a role, so the values only have to be distinguishable.
    name: "Fixture",
    colors: {
      stock: "#E6DED0", ink: "#231F20", ink3: "#57504A",
      cyan: "#0A83C4", magenta: "#D42A6B", yellow: "#F5CE18",
      cyanT: "#075C8A", magentaT: "#A31A50", nonrepro: "#6E9BD1",
    },
    extra: [{ name: "Warning", value: "#C4571F" }],
  },
  fonts: { roles: { sheet: "a", furniture: "b", gauge: "c" }, available: [] },
};

/** The real grid, painted into a fake document. @param {object} schema @param {object[]} rows */
function grid(schema, rows = [], production = false) {
  const body = installDom();
  /** @type {any[]} */
  const alters = [];
  const ws = {
    get: () => ({ pages: [], tables: [], theme: THEME, page: null, table: null }),
    alterTable: async (/** @type {string} */ _n, /** @type {any} */ next) => { alters.push(next); },
    updateRow: async () => {}, insertRow: async () => 1, removeRow: async () => {},
    importCsv: async () => ({ added: 0 }),
  };
  const ui = {
    get: () => ({ route: { view: "table", id: schema.name }, pageView: "page",
      panel: null, inserting: null, dialog: false, expanded: new Set() }),
    set: () => {}, go: () => {}, on: () => () => {},
  };
  const el = makeTableView({ ws, ui, production })({ schema, rows, total: rows.length });
  body.append(el);
  el.isConnected = true;
  return { el, body, alters };
}

test("a property change made earlier in the same menu visit survives the rename", () => {
  const g = grid(
    { name: "jobs", kind: "basic", columns: [col("hours", "text"), col("site", "text")] },
    [row(1, { hours: "8", site: "Ashgrove" })]);

  // open the property menu on the first heading
  const th = deep(g.el, "prop")[0];
  th.fire("click");

  // rename it, without leaving the menu — a blur is what a person clicking the
  // next row of the same menu actually does
  const field = deep(g.body, "popinput")[0];
  field.value = "Hours";
  field.fire("blur");

  // an explicit rename travels as Column.from, so `alter` never has to infer
  // one by position and read a drop-plus-add as a rename
  const renamed = g.alters[0].columns.find((/** @type {any} */ c) => c.name === "Hours");
  expect(renamed).toBeTruthy();
  expect(renamed.from).toBe("hours");

  // same visit, same menu: now change the type
  const typeRow = deep(g.body, "popitem").find((/** @type {any} */ n) => n.textContent.startsWith("Type"));
  typeRow.fire("click");
  const number = deep(g.body, "typecard").find((/** @type {any} */ n) => n.textContent.includes("Number"));
  number.fire("click");

  // both survive, and the retype does not repeat the rename it followed
  const after = g.alters.at(-1).columns;
  expect(after.map((/** @type {any} */ c) => [c.name, c.type])).toEqual([["Hours", "number"], ["site", "text"]]);
  expect(after[0].from).toBe(undefined);
});

test("a rename after a retype keeps the retype, in either order", () => {
  const g = grid(
    { name: "jobs", kind: "basic", columns: [col("hours", "text"), col("site", "text")] },
    [row(1, { hours: "8", site: "Ashgrove" })]);

  const th = deep(g.el, "prop")[0];
  th.fire("click");
  deep(g.body, "popitem").find((/** @type {any} */ n) => n.textContent.startsWith("Type")).fire("click");
  deep(g.body, "typecard").find((/** @type {any} */ n) => n.textContent.includes("Number")).fire("click");

  th.fire("click");
  const field = deep(g.body, "popinput")[0];
  field.value = "Hours";
  field.fire("blur");

  const after = g.alters.at(-1).columns;
  expect(after.map((/** @type {any} */ c) => [c.name, c.type])).toEqual([["Hours", "number"], ["site", "text"]]);
});

test("every palette role a category takes paints its own token, not grey", () => {
  const options = [
    { label: "Held", colour: "cyan-t" },
    { label: "Won", colour: "magenta-t" },
    { label: "Open", colour: "cyan" },
    { label: "Late", colour: "Warning" },
  ];
  const g = grid(
    { name: "jobs", kind: "basic", columns: [col("stage", "categories", { options })] },
    [row(1, { stage: '["Held","Won","Open","Late"]' })]);

  const painted = deep(g.el, "tag").map((/** @type {any} */ n) => [n.textContent, n.style["--c"]]);
  expect(painted).toEqual([
    ["Held", "var(--cyan-t)"],
    ["Won", "var(--magenta-t)"],
    ["Open", "var(--cyan)"],
    ["Late", "#C4571F"],
  ]);
});

test("the roles the grid offers are the roles the server assigns", () => {
  const list = (/** @type {string} */ path) => {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    const found = /(?:CHIP_)?ROLES = \[([^\]]*)\]/.exec(src);
    if (!found) throw new Error("no roles list in " + path);
    return found[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean).sort();
  };
  expect(list("../client/views/table.js")).toEqual(list("../server/domain/tables.ts"));
});

test("the Used by pills are not on the table in production", () => {
  const schema = { name: "jobs", kind: "basic", columns: [col("hours", "text")] };

  // EVERY PAGE THAT READS THIS TABLE, as buttons. On a vault with one page it
  // says "No page reads this yet", which is true and tells a stranger nothing
  // they can act on — so in a built application the line is not there at all
  // rather than there and empty.
  const dev = grid(schema, [row(1, { hours: "8" })]);
  expect(deep(dev.el, "usedby")[0].textContent).toBe("No page reads this yet.");

  const built = grid(schema, [row(1, { hours: "8" })], true);
  const used = deep(built.el, "usedby")[0];
  // The element stays — it is the grid's own furniture and its class is what the
  // stylesheet lays the top out by — and it says nothing.
  expect(used).toBeTruthy();
  expect(used.textContent).toBe("");

  // And the grid itself is untouched: a hidden row is not a missing screen.
  expect(deep(built.el, "prop").length).toBe(1);
});
