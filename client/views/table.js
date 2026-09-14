// SPDX-License-Identifier: AGPL-3.0-only
// A table: the grid the workspace is built on, and client zero of its own
// artifact contract — every read and write below is the same `table.get` and
// `row.insert` an artifact issues through the bridge. A contract that cannot
// express what this file needs is discovered here, on day two, rather than
// after artifacts exist in the wild.
//
// The interaction model is Notion's on purpose. A category-fluent person should
// be able to use this without pausing at a single control, so a header opens a
// property menu, drags to reorder and resizes from its right edge; a row is
// handled from a grip in the gutter; filters and sort read from the toolbar and
// show as removable chips. Nothing is invented where a convention exists.
//
// Three things the mock's version could not survive, and they are the real work:
//   · rows are keyed by `row.id`. The mock kept a Set of array references and
//     located rows with indexOf, which dies the first time a query re-runs.
//   · cells are keyed by column name, so reordering a column moves no data and
//     no filter or sort has to be re-indexed afterwards.
//   · view state lives in a closure keyed by table name, never on the object
//     that came back from the server — that object is new on every fetch.
//
// A row is data and only data. It does not open as a page; point a Page column
// at one instead. That keeps one story about where data integrity lives.

/** @import { Cell, Column, ColumnType, Page, Palette, Row, RowId, RowInput, TableName, TableSchema, TableView, UiStore, WorkspaceStore } from "../../contracts/types.ts" */

import { tokenOf } from "../theme/palettes.js";
import { h, svg } from "../platform/dom.js";
import {
  popover, pushPopover, popBack, closePopover, popItem, popLabel, popSep, popInput,
} from "../widgets/popover.js";

/* ── the property types ────────────────────────────────────────────────── */

/** Palette roles a new category cycles through. Stored as the role — 'cyan',
 *  'ink-3' — and never as a literal, so a chip repaints when the palette
 *  changes. `server/domain/tables.ts` holds the same list because it assigns a
 *  colour to a label the agent invented, and `tests/table.test.js` fails if the
 *  two ever disagree. Nothing *resolves* a role through this list — see
 *  `roleColour`, which reads the palette itself, so a role this list has never
 *  heard of still paints. */
export const CHIP_ROLES = ["cyan", "magenta", "yellow", "nonrepro", "ink-3", "cyan-t", "magenta-t"];

/**
 * A role resolves to a token, derived from the palette rather than matched
 * against a hand-kept list: `cyanT` in a palette IS `--cyan-t` here, by the one
 * rule `tokenOf` states. A list would have to be extended every time a palette
 * grew a colour, and the failure when it was not is silent — the chip renders
 * grey in the grid while showing correctly everywhere else.
 *
 * Extras are held as data rather than as declared tokens, so they carry their
 * own value. Either way nothing here holds a literal, and a palette change
 * repaints the chips.
 * @param {string} role @param {Palette | null | undefined} palette
 * @returns {string}
 */
export function roleColour(role, palette) {
  const want = "--" + role;
  for (const key of Object.keys(palette?.colors || {})) if (tokenOf(key) === want) return `var(${want})`;
  const extra = (palette?.extra || []).find((e) => e.name === role);
  return extra ? extra.value : "var(--ink-3)";
}

/** Handlers arrive through `h()`'s prop bag, which is a `Record<string,
 *  unknown>` — nothing contextually types them, so every one says what it takes.
 *  `any` where a handler reaches for `currentTarget` as the element it was bound
 *  to, which `EventTarget` cannot express without a cast per line.
 *  @param {string} label @param {string} colour */
const chip = (label, colour) => h("span.tag", { style: { "--c": colour } }, label);

const TYPES = [
  { id: "text", label: "Text", hint: "Anything you can type",
    sample: () => h("span.sm-text", "Ashgrove") },
  { id: "number", label: "Number", hint: "Counted or measured",
    sample: () => h("span.sm-num", "1240") },
  { id: "date", label: "Date", hint: "A day on a calendar",
    sample: () => h("span.sm-date", "2026-08-10") },
  { id: "checkbox", label: "Checkbox", hint: "Yes or no",
    sample: () => h("span.sm-check", h("span.tick.on")) },
  { id: "categories", label: "Categories", hint: "One or more labels, colour-coded",
    sample: () => h("span.sm-tags", chip("render", "var(--cyan)"), chip("scaffold", "var(--magenta)")) },
  { id: "person", label: "Person", hint: "Somebody on the team",
    sample: () => h("span.sm-person", h("span.av", "D"), "Dan") },
  { id: "url", label: "URL", hint: "A web address",
    sample: () => h("span.sm-link", "example.co.uk") },
  { id: "email", label: "Email", hint: "An address to write to",
    sample: () => h("span.sm-link", "dan@") },
  { id: "phone", label: "Phone", hint: "A number to ring",
    sample: () => h("span.sm-text", "0113 496") },
  { id: "link", label: "Link to table", hint: "A row in another table",
    sample: () => h("span.sm-rowlink", "jobs · Ashgrove") },
  { id: "page", label: "Link to page", hint: "A page in this workspace",
    sample: () => h("span.sm-pagelink", h("i.pg"), "Team notes") },
];

/** @param {string} type */
const labelOf = (type) => TYPES.find((t) => t.id === type)?.label || "Text";

const DEFAULT_W = {
  number: 90, date: 128, checkbox: 74, categories: 190, person: 120,
  link: 150, page: 160, url: 170, email: 150, phone: 120,
};

/** @param {Column} c */
const widthOf = (c) => c.width || DEFAULT_W[/** @type {keyof DEFAULT_W} */ (c.type)] || 170;

/** Types where a filter offers a list of what is already there rather than a box. */
const CHOOSY = new Set(["categories", "person", "link", "page", "checkbox"]);

/** @type {{ number: [string, string][], date: [string, string][] }} */
const OPS = {
  number: [["eq", "is"], ["gt", "over"], ["lt", "under"], ["between", "between"]],
  date: [["eq", "on"], ["gt", "after"], ["lt", "before"], ["between", "between"]],
};

/** Only two types answer over/under/between; everything else is a contains.
 *  @param {ColumnType} type */
const opsFor = (type) => (type === "date" ? OPS.date : OPS.number);

const DOTS = "<circle cx='4' cy='3' r='1.3'/><circle cx='4' cy='8' r='1.3'/>" +
  "<circle cx='4' cy='13' r='1.3'/><circle cx='9' cy='3' r='1.3'/>" +
  "<circle cx='9' cy='8' r='1.3'/><circle cx='9' cy='13' r='1.3'/>";
const GLASS = "<circle cx='6.5' cy='6.5' r='4.5' fill='none' stroke-width='1.4'/>" +
  "<path d='M10 10 L14 14' stroke-width='1.4' stroke-linecap='round'/>";
const OPEN = "<path d='M5 11 L11 5 M6 5 H11 V10' stroke-width='1.4' stroke-linecap='round'" +
  " stroke-linejoin='round' fill='none'/>";
const CROSS = "<path d='M3 3 L11 11 M11 3 L3 11' stroke-width='1.5' stroke-linecap='round'/>";
const ARROW = "<path d='M8 12.5 V3.5 M4.5 7 L8 3.5 L11.5 7' stroke-width='1.5'" +
  " stroke-linecap='round' stroke-linejoin='round' fill='none'/>";
const DASH = "<path d='M4 8 H12' stroke-width='1.5' stroke-linecap='round'/>";

/* ── values ────────────────────────────────────────────────────────────── */

/**
 * A categories cell is a JSON array of labels — `["Render","Scaffold"]`. It is
 * read tolerantly because a CSV import puts whatever was in the file into the
 * column, and a cell reading `Done` should mean one label rather than nothing.
 * @param {Cell} value
 * @returns {string[]}
 */
export function readCategories(value) {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "string") return [String(value)];
  const text = value.trim();
  if (text.startsWith("[")) {
    try {
      const list = JSON.parse(text);
      if (Array.isArray(list)) return list.map((v) => String(v)).filter(Boolean);
    } catch { /* fall through to the delimiter reading below */ }
  }
  return text.split(/\s*[;,]\s*/).filter(Boolean);
}

/** @param {string[]} labels @returns {string} */
export const writeCategories = (labels) => JSON.stringify([...new Set(labels)]);

/**
 * One cell as the text the user sees — what search matches, what a value filter
 * compares against, and what a sort falls back to.
 * @param {Cell} value @param {Column} col @returns {string}
 */
export function cellText(value, col) {
  if (col.type === "checkbox") return value ? "true" : "false";
  if (col.type === "categories") return readCategories(value).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

/** @param {ColumnType} type @returns {Cell} */
export function blankCell(type) {
  if (type === "checkbox") return 0;
  if (type === "categories") return "[]";
  return null;
}

/** @param {TableSchema} schema @returns {RowInput} */
export function blankRow(schema) {
  /** @type {RowInput} */
  const row = {};
  for (const c of schema.columns) row[c.name] = blankCell(c.type);
  return row;
}

/* ── filtering ─────────────────────────────────────────────────────────── */

/** A number or a date answers questions a text match cannot: over, under, between.
 *  @param {Cell} v @param {ColumnType} type @returns {number} */
const asNumber = (v, type) => {
  if (v === null || v === undefined || v === "") return NaN;
  return type === "number" ? Number(v) : Date.parse(String(v));
};

/**
 * @param {Cell} value @param {ColumnType} type
 * @param {{ op: string, a: string, b?: string }} f
 */
export function compareOp(value, type, f) {
  const x = asNumber(value, type);
  const a = asNumber(f.a, type);
  if (Number.isNaN(x) || Number.isNaN(a)) return false;
  if (f.op === "gt") return x > a;
  if (f.op === "lt") return x < a;
  if (f.op === "between") {
    const b = asNumber(f.b ?? "", type);
    return Number.isNaN(b) ? x >= a : x >= Math.min(a, b) && x <= Math.max(a, b);
  }
  return x === a;
}

/**
 * One filter against one row. Filters name a column rather than an index, which
 * is what makes a column reorder cost nothing.
 * @param {Row} row @param {Column} col @param {any} f
 */
export function passes(row, col, f) {
  const value = row.cells[col.name] ?? null;
  if (f.kind === "cmp") return compareOp(value, col.type, f);
  if (f.kind === "text") return cellText(value, col).toLowerCase().includes(String(f.q).toLowerCase());
  if (col.type === "categories") {
    const have = readCategories(value);
    return [...f.values].some((v) => have.includes(v));
  }
  return f.values.has(cellText(value, col));
}

/**
 * @param {Row[]} rows @param {Column[]} columns
 * @param {{ q?: string, filters?: any[] }} state
 */
export function filterRows(rows, columns, state) {
  const q = String(state.q || "").trim().toLowerCase();
  const filters = state.filters || [];
  return rows.filter((row) => {
    if (q && !columns.some((c) => cellText(row.cells[c.name] ?? null, c).toLowerCase().includes(q))) return false;
    return filters.every((f) => {
      const col = columns.find((c) => c.name === f.column);
      return col ? passes(row, col, f) : true;
    });
  });
}

/* ── sorting ───────────────────────────────────────────────────────────── */

/**
 * The one value a column sorts on, or null for "this cell is empty". Empty
 * always sinks, in both directions — a descending sort that floats every blank
 * row to the top is answering a question nobody asked.
 * @param {Cell} value @param {Column} col @returns {number | string | null}
 */
export function sortKey(value, col) {
  if (col.type === "checkbox") return value ? 1 : 0;
  if (value === null || value === undefined || value === "") return null;
  if (col.type === "number" || col.type === "link") {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n;
  }
  if (col.type === "categories") {
    const first = readCategories(value)[0];
    return first === undefined ? null : first;
  }
  return String(value);
}

/** Ascending, case-insensitive, digits inside text compared as numbers.
 *  @param {number | string} a @param {number | string} b */
function compareKeys(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a), y = String(b);
  const soft = x.localeCompare(y, undefined, { sensitivity: "base", numeric: true });
  // Ties under a case-insensitive comparison still need one stable answer, or
  // "Ash" and "ash" swap places between two sorts of the same data.
  return soft !== 0 ? soft : (x < y ? -1 : x > y ? 1 : 0);
}

/** @param {Row} a @param {Row} b @param {Column} col @param {number} dir */
export function compareRows(a, b, col, dir) {
  const ka = sortKey(a.cells[col.name] ?? null, col);
  const kb = sortKey(b.cells[col.name] ?? null, col);
  if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
  return dir * compareKeys(ka, kb);
}

/** @param {Row[]} rows @param {Column} col @param {number} dir @returns {Row[]} */
export const sortRows = (rows, col, dir) =>
  rows.slice().sort((a, b) => compareRows(a, b, col, dir));

/* ── columns ───────────────────────────────────────────────────────────── */

/**
 * Move a column. Cells are keyed by name, so this touches the column list and
 * nothing else — no row is rewritten and no filter or sort is re-indexed. That
 * is the whole reason cells stopped being positional.
 * @param {Column[]} columns @param {number} from @param {number} to
 * @returns {Column[]}
 */
export function reorderColumns(columns, from, to) {
  if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) {
    return columns.slice();
  }
  const next = columns.slice();
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

/** A name no other column has. @param {Column[]} columns @param {string} want */
export function freeName(columns, want) {
  if (!columns.some((c) => c.name === want)) return want;
  for (let n = 2; ; n++) {
    const tryName = `${want}_${n}`;
    if (!columns.some((c) => c.name === tryName)) return tryName;
  }
}

/* ── CSV ───────────────────────────────────────────────────────────────── */

/**
 * RFC 4180: a field holding a comma, a quote or a newline is wrapped, and a
 * quote inside a field is doubled. Cells go out exactly as they are stored, so
 * an export and a re-import are the same data rather than nearly the same.
 * @param {Column[]} columns @param {Row[]} rows @returns {string}
 */
export function toCsv(columns, rows) {
  const esc = (/** @type {Cell} */ v) => {
    const s = v === true ? "true" : v === false ? "false" : v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.map((c) => esc(c.name)).join(","),
    ...rows.map((r) => columns.map((c) => esc(r.cells[c.name] ?? null)).join(",")),
  ].join("\r\n");
}

/* ── which pages use this table ────────────────────────────────────────── */

/**
 * Derived from the pages themselves, never written down beside the table: a
 * hand-kept list of consumers is wrong the moment somebody points a new page at
 * it, and nothing makes you notice.
 *
 * A page uses a table if any slot on it holds one, or if a declared port is
 * bound to it. Ports ship empty in the framework by decision, so in practice this
 * is the slot case.
 * @param {TableName} name @param {Page[]} pages
 */
export function pagesUsing(name, pages) {
  /** @type {{ page: Page, how: string }[]} */
  const out = [];
  for (const page of pages) {
    const shows = (page.sections || []).some((s) =>
      Object.values(s.parts).some((p) => p.kind === "table" && p.table === name));
    const bound = (page.ports?.bindings || []).filter((b) => b.table === name);
    const reads = shows || bound.length > 0;
    if (!reads) continue;
    out.push({ page, how: shows ? "shows" : "binds" });
  }
  return out;
}

/* ── the view ──────────────────────────────────────────────────────────── */

/** Tables we have been handed, so a Link cell can show a name rather than a row
 *  id. The snapshot holds exactly one table at a time, and stealing that slot to
 *  read a second one would repaint the grid the user is looking at as a
 *  different table — so this fills as tables are visited and no further. */
const SEEN_TABLES = new Map();

/** Same accretion for pages, and for the same reason: the snapshot carries page
 *  *refs*, which cannot answer whether a page shows this table. */
const SEEN_PAGES = new Map();

/**
 * @param {{ ws: WorkspaceStore, ui: UiStore, production?: boolean }} deps
 *   `production` is which build this is; absent means development. It decides
 *   one thing on this screen: whether the *Used by* pills are drawn.
 * @returns {(view: TableView | null) => HTMLElement}
 */
export function makeTableView(deps) {
  const { ws, ui } = deps;
  const production = deps.production === true;
  /** One live grid per table, so a repaint from anywhere — a store emit, an
   *  artifact writing a row — updates the DOM the user is in rather than
   *  replacing it, which is what keeps a caret, a menu and a scroll position. */
  const grids = new Map();

  return (view) => {
    if (!view || !view.schema) return h("div.tbl", h("p.tsay", "No table open."));
    const name = view.schema.name;
    let grid = grids.get(name);
    if (!grid) {
      grid = makeGrid(ws, ui, name, production);
      grids.set(name, grid);
    }
    grid.update(view);
    return grid.el;
  };
}

/**
 * @param {WorkspaceStore} ws
 * @param {UiStore} ui
 * @param {TableName} name
 * @param {boolean} [production]
 */
function makeGrid(ws, ui, name, production = false) {
  /** @type {TableSchema} */
  let schema = { name, kind: "basic", columns: [] };
  /** @type {Row[]} */
  let rows = [];

  /** Never on the fetched object: it is a new object every time. */
  const state = {
    q: "",
    /** @type {string | null} */ sort: null,
    dir: 1,
    /** @type {any[]} */ filters: [],
    /** @type {Set<RowId>} */ picked: new Set(),
  };

  /** Writes in flight, replayed over an incoming snapshot so an optimistic edit
   *  is not undone by a repaint that arrived before the round trip finished. */
  const inflight = new Map();

  let menuOpen = false;
  let stale = false;

  const title = h("h2", name);
  const used = h("p.usedby.none");
  const count = h("span.tcount");
  const chipbar = h("div.tchips");
  const selbar = h("div.selbar", { hidden: "" });
  const foot = h("div.tfoot", { hidden: "" });
  const say = h("p.tsay", { hidden: "" });
  const cols = h("colgroup");
  const head = h("thead");
  const body = h("tbody");

  const search = /** @type {HTMLInputElement} */ (h("input.tsearch", {
    type: "search", placeholder: "Search", "aria-label": `Search ${name}`,
    oninput: (/** @type {any} */ e) => { state.q = e.currentTarget.value; paintBody(); },
  }));

  const fileInput = h("input", {
    type: "file", accept: ".csv,text/csv", hidden: "",
    onchange: (/** @type {any} */ e) => {
      const input = /** @type {HTMLInputElement} */ (e.currentTarget);
      const file = input.files && input.files[0];
      if (!file) return;
      file.text()
        .then((text) => ws.importCsv(name, text))
        .then((r) => { tell(`${r.added} row${r.added === 1 ? "" : "s"} imported.`, false); })
        .catch((err) => tell(reason(err, "That CSV did not import."), true))
        .finally(() => { input.value = ""; });
    },
  });

  const editable = () => schema.kind === "basic";

  /* ---------------- talking back ---------------- */

  /** @param {unknown} err @param {string} fallback */
  const reason = (err, fallback) =>
    err && typeof err === "object" && "message" in err && err.message ? String(err.message) : fallback;

  /** @param {string} text @param {boolean} bad */
  function tell(text, bad) {
    say.hidden = false;
    say.classList.toggle("bad", bad);
    say.textContent = text;
  }

  /* ---------------- what is showing ---------------- */

  function visible() {
    const shown = filterRows(rows, schema.columns, state);
    const col = state.sort ? schema.columns.find((c) => c.name === state.sort) : null;
    return col ? sortRows(shown, col, state.dir) : shown;
  }

  function repaint() {
    if (menuOpen) { stale = true; return; }
    paintTop(); paintCols(); paintHead(); paintBody(); paintChips();
  }

  /** Sorting from a menu is the one case that must not wait: the rows have to
   *  move while you are still looking at the choice you made. Everything but the
   *  head redraws, because the head carries the anchor the menu hangs from — and
   *  the arrow it would show is already on the menu. */
  function resort() {
    paintBody();
    stale = true;
  }

  /**
   * A menu that outlives the thing it hangs from is the one hazard here: a
   * repaint would replace the anchor mid-choice. Repaints wait while a menu is
   * open, and the menu closing is what lets the rest of the table catch up.
   * @param {HTMLElement} anchor
   * @param {(close: () => void) => any} build
   * @param {{ align?: "start" | "end", width?: string }} [opts]
   */
  function openMenu(anchor, build, opts = {}) {
    const el = popover(anchor, build, {
      ...opts,
      onClose: () => { menuOpen = false; if (stale) { stale = false; repaint(); } },
    });
    menuOpen = !!el;
    return el;
  }

  /* ---------------- writing ---------------- */

  /** @param {Row} row @param {Column} col @param {Cell} value */
  function setCell(row, col, value) {
    const before = row.cells[col.name] ?? null;
    if (before === value) return;
    const key = `${row.id}\u0000${col.name}`;
    row.cells[col.name] = value;
    inflight.set(key, value);
    ws.updateRow(name, row.id, { [col.name]: value })
      .then(() => { inflight.delete(key); })
      .catch((err) => {
        inflight.delete(key);
        row.cells[col.name] = before;
        tell(reason(err, "That change did not save."), true);
        repaint();
      });
  }

  /** Every column change is one whole schema, so there is no per-operation
   *  vocabulary to keep in step with the server. The one thing a whole schema
   *  cannot say by itself is *which* column a new name belongs to, and that one
   *  travels as `Column.from` — see `rename`.
   *  @param {TableSchema} next */
  function alter(next) {
    return ws.alterTable(name, next).catch((err) => {
      tell(reason(err, "That property change did not save."), true);
    });
  }

  function addRow() {
    ws.insertRow(name, blankRow(schema)).catch((err) => tell(reason(err, "That row was not added."), true));
  }

  /** @param {Row[]} list */
  function duplicate(list) {
    Promise.all(list.map((r) => ws.insertRow(name, { ...r.cells })))
      .catch((err) => tell(reason(err, "Those rows were not duplicated."), true));
  }

  /** @param {RowId[]} ids */
  function remove(ids) {
    for (const id of ids) state.picked.delete(id);
    Promise.all(ids.map((id) => ws.removeRow(name, id)))
      .catch((err) => tell(reason(err, "Those rows were not deleted."), true));
  }

  /* ---------------- categories ---------------- */

  const theme = () => ws.get().theme;

  /** Every colour a category may take: the palette roles, then anything added in
   *  Theme, so a colour made in the workspace is immediately usable here. */
  function swatches() {
    const extra = theme()?.palette?.extra || [];
    return [...CHIP_ROLES, ...extra.map((e) => e.name)];
  }

  /** @param {string} role */
  const colourOf = (role) => roleColour(role, theme()?.palette);

  /** A menu holds the column it was opened on, and a schema arriving from the
   *  server replaces every Column object. Look it up by name rather than trust
   *  the reference. @param {Column} col */
  const liveCol = (col) => schema.columns.find((c) => c.name === col.name) || col;

  /** @param {Column} col @param {string} label */
  const roleOf = (col, label) =>
    (liveCol(col).options || []).find((o) => o.label === label)?.colour || "ink-3";

  /** Labels a column offers. Seeded from what is already in the data the first
   *  time, so a CSV import does not arrive as a column of colourless chips.
   *  @param {Column} col */
  function optionsOf(col) {
    const c = liveCol(col);
    if (c.options && c.options.length) return c.options;
    const seen = [...new Set(rows.flatMap((r) => readCategories(r.cells[col.name] ?? null)))];
    const list = swatches();
    return seen.map((label, i) => ({ label, colour: list[i % list.length] || "ink-3" }));
  }

  /** The options a column carries, written through `alter` so they persist.
   *  @param {Column} col @param {{label: string, colour: string}[]} options */
  function setOptions(col, options) {
    const next = {
      ...schema,
      columns: schema.columns.map((c) => (c.name === col.name ? { ...c, options } : c)),
    };
    schema = next;              // optimistic, so the open menu shows the change
    return alter(next);
  }

  /* ---------------- cells ---------------- */

  /** @param {HTMLElement} anchor @param {Row} row @param {Column} col */
  function categoryEditor(anchor, row, col) {
    // Redraw only the cell that changed. Repainting the body would destroy the
    // button this menu is hanging from while it is still open.
    const refresh = () => {
      const chosen = readCategories(row.cells[col.name] ?? null);
      anchor.replaceChildren(...(chosen.length
        ? chosen.map((v) => chip(v, colourOf(roleOf(col, v))))
        : [h("span.pill.empty", "Empty")]));
    };

    const draw = () => pushPopover(() => {
      const options = optionsOf(col);
      const chosen = readCategories(row.cells[col.name] ?? null);
      const entry = popInput({
        placeholder: "Add or find a category",
        onkeydown: (/** @type {any} */ e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const field = /** @type {HTMLInputElement} */ (e.currentTarget);
          const label = field.value.trim();
          if (!label) return;
          if (!options.some((o) => o.label === label)) {
            const list = swatches();
            setOptions(col, [...options, { label, colour: list[options.length % list.length] || "ink-3" }]);
          }
          if (!chosen.includes(label)) setCell(row, col, writeCategories([...chosen, label]));
          field.value = "";
          draw(); refresh();
        },
      });
      return [
        popLabel(`${col.name} — one or more`),
        entry,
        popSep(),
        h("div.poplist", ...options.map((o) => h("div.tagrow",
          h("button.tagpick" + (chosen.includes(o.label) ? ".on" : ""), {
            type: "button",
            onclick: () => {
              const next = chosen.includes(o.label)
                ? chosen.filter((x) => x !== o.label)
                : [...chosen, o.label];
              setCell(row, col, writeCategories(next));
              draw(); refresh();
            },
          }, chip(o.label, colourOf(o.colour))),
          h("button.tagcolour", {
            type: "button", "aria-label": `Colour of ${o.label}`,
            style: { "--c": colourOf(o.colour) },
            onclick: () => {
              const list = swatches();
              const at = list.indexOf(o.colour);
              const colour = list[(at + 1) % list.length] || "ink-3";
              setOptions(col, options.map((x) => (x.label === o.label ? { ...x, colour } : x)));
              draw(); refresh();
            },
          }),
          h("button.tagdrop", {
            type: "button", "aria-label": `Remove the ${o.label} category`,
            onclick: () => {
              setOptions(col, options.filter((x) => x.label !== o.label));
              for (const r of rows) {
                const have = readCategories(r.cells[col.name] ?? null);
                if (have.includes(o.label)) setCell(r, col, writeCategories(have.filter((v) => v !== o.label)));
              }
              draw(); refresh();
            },
          }, svg("0 0 14 14", CROSS, "xmark"))))),
        options.length ? null : h("p.tsay.inpop", "No categories yet. Type one above."),
      ];
    });

    openMenu(anchor, () => [], { width: "16rem" });
    draw();
  }

  /**
   * A value you pick rather than type: a person, a row in another table, a page.
   * @param {Row} row @param {Column} col
   * @param {{ value: string, label: string }[]} list
   * @param {HTMLElement | null} extra
   * @param {(chosen: string) => void} [onFree] accepts a value not in the list
   */
  function pickerCell(row, col, list, extra, onFree) {
    const text = h("span");
    const btn = h("button.pill." + col.type, {
      type: "button", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": col.name,
    }, col.type === "page" ? h("i.pg") : null, text);

    const refresh = () => {
      const raw = row.cells[col.name] ?? null;
      const key = raw === null ? "" : String(raw);
      const shown = list.find((o) => o.value === key)?.label || key;
      text.textContent = shown || "Empty";
      btn.classList.toggle("empty", !shown);
    };
    refresh();

    if (editable()) btn.addEventListener("click", () => {
      const draw = () => pushPopover(() => {
        const raw = row.cells[col.name] ?? null;
        const value = raw === null ? "" : String(raw);
        return [
          popLabel(`Choose a ${col.type === "page" ? "page" : col.type === "link" ? "row" : "person"}`),
          onFree ? popInput({
            placeholder: "Or type one",
            onkeydown: (/** @type {any} */ e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const field = /** @type {HTMLInputElement} */ (e.currentTarget);
              const typed = field.value.trim();
              if (!typed) return;
              onFree(typed);
              refresh(); draw();
            },
          }) : null,
          h("div.poplist", ...list.map((o) => popItem(o.label, () => {
            setCell(row, col, o.value === value ? null : coerce(o.value, col.type));
            refresh(); draw();
          }, { checked: o.value === value }))),
          value ? popSep() : null,
          value ? popItem("Clear", () => { setCell(row, col, null); refresh(); draw(); }) : null,
          list.length ? null : h("p.tsay.inpop", emptyPickerNote(col)),
        ];
      });
      openMenu(btn, () => [], { width: "15rem" });
      draw();
    });

    return h("td.tc", h("span.pillwrap", btn, extra));
  }

  /** @param {Column} col */
  function emptyPickerNote(col) {
    if (col.type === "person") return "No names in this column yet. Type one above.";
    if (col.type === "page") return "No pages to point at yet.";
    // The snapshot carries one table at a time and this view will not steal that
    // slot to read another — the grid would repaint as a different table.
    return col.table
      ? `Open the ${col.table} table once and its rows can be picked here.`
      : "This column does not name a table yet.";
  }

  /** @param {string} value @param {ColumnType} type @returns {Cell} */
  const coerce = (value, type) => (type === "link" ? Number(value) : value);

  /** @param {Column} col */
  function distinct(col) {
    const seen = [...new Set(rows.map((r) => cellText(r.cells[col.name] ?? null, col)).filter(Boolean))];
    return seen.sort((a, b) => compareKeys(a, b)).map((v) => ({ value: v, label: v }));
  }

  /** @param {Row} row @param {Column} col */
  function cell(row, col) {
    const value = row.cells[col.name] ?? null;
    const locked = !editable();

    if (col.type === "checkbox") {
      const on = !!value && value !== 0 && value !== "0" && value !== "false";
      const toggle = () => { setCell(row, col, on ? 0 : 1); paintBody(); };
      return h("td.tc", h("span.tick" + (on ? ".on" : ""), {
        role: "checkbox", "aria-checked": String(on), "aria-label": col.name,
        tabindex: locked ? null : "0",
        onclick: locked ? null : toggle,
        onkeydown: locked ? null : (/** @type {KeyboardEvent} */ e) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault(); toggle();
        },
      }));
    }

    if (col.type === "categories") {
      const chosen = readCategories(value);
      return h("td.tc", h("button.tags", {
        type: "button", "aria-haspopup": "true", "aria-label": col.name, disabled: locked ? "" : null,
        onclick: locked ? null : (/** @type {any} */ e) => categoryEditor(e.currentTarget, row, col),
      }, ...(chosen.length
        ? chosen.map((v) => chip(v, colourOf(roleOf(col, v))))
        : [h("span.pill.empty", "Empty")])));
    }

    if (col.type === "person") {
      return pickerCell(row, col, distinct(col), null, (typed) => setCell(row, col, typed));
    }

    if (col.type === "link") {
      const other = col.table ? SEEN_TABLES.get(col.table) : null;
      const show = col.show || other?.schema.columns[0]?.name;
      const list = other && show
        ? other.rows.map((/** @type {Row} */ r) => ({ value: String(r.id), label: String(r.cells[show] ?? r.id) }))
        : [];
      return pickerCell(row, col, list, null);
    }

    if (col.type === "page") {
      const pages = ws.get().pages;
      const list = pages.map((p) => ({ value: p.id, label: p.name }));
      const at = list.find((o) => o.value === String(value ?? ""));
      const open = at
        ? h("button.goto", {
            type: "button", "aria-label": `Open ${at.label}`,
            onclick: () => { closePopover(); ui.go("page", at.value); },
          }, svg("0 0 16 16", OPEN, "arrow"))
        : null;
      return pickerCell(row, col, list, open);
    }

    if (col.type === "date") {
      return h("td.tc", h("input.tdate", {
        type: "date", value: value === null ? "" : String(value), "aria-label": col.name,
        disabled: locked ? "" : null,
        onchange: (/** @type {any} */ e) => {
          const field = /** @type {HTMLInputElement} */ (e.currentTarget);
          setCell(row, col, field.value || null);
        },
      }));
    }

    const num = col.type === "number";
    const box = h("span.cell" + (col.type === "url" || col.type === "email" ? ".linky" : ""), {
      contenteditable: locked ? null : "true",
      role: "textbox", "aria-label": col.name, spellcheck: "false",
      onkeydown: (/** @type {any} */ e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } },
      onblur: (/** @type {any} */ e) => {
        const text = (e.currentTarget.textContent || "").trim();
        if (!num) return setCell(row, col, text || null);
        if (text === "") return setCell(row, col, null);
        const n = Number(text.replace(/[^0-9.\-]/g, ""));
        setCell(row, col, Number.isNaN(n) ? null : n);
        paintBody();          // a typed "1,240" comes back as 1240
      },
    }, value === null ? "" : String(value));
    return h("td.tc" + (num ? ".num" : ""), box);
  }

  /* ---------------- rows ---------------- */

  // The mock dragged rows to reorder and inserted one from the hairline between
  // two rows. Neither is here, and it is a deliberate subtraction rather than an
  // omission: the vault gives a row an id and no position, so there is no order
  // to write down. An insert that visibly lands somewhere else, and a drag that
  // is forgotten on reload, are both worse than the affordance not being there.
  // The gutter grip and "+ New row" carry what is left.
  function paintBody() {
    const shown = visible();

    const trs = shown.map((row) => {
      const picked = state.picked.has(row.id);
      const toggle = () => {
        if (picked) state.picked.delete(row.id); else state.picked.add(row.id);
        paintBody();
      };
      return h("tr" + (picked ? ".picked" : ""),
        h("td.rowgrip", h("div.gutter",
          h("span.rowpick" + (picked ? ".on" : ""), {
            role: "checkbox", tabindex: "0", "aria-checked": String(picked),
            "aria-label": "Select this row",
            onclick: toggle,
            onkeydown: (/** @type {KeyboardEvent} */ e) => {
              if (e.key !== " " && e.key !== "Enter") return;
              e.preventDefault(); toggle();
            },
          }),
          editable() ? h("button.grab", {
            type: "button", "aria-label": "Row actions", "aria-haspopup": "true",
            onclick: (/** @type {any} */ e) => openMenu(e.currentTarget, (close) => [
              popItem("Duplicate", () => { duplicate([row]); close(); }),
              popSep(),
              popItem("Delete", () => { remove([row.id]); close(); }, { danger: true }),
            ], { width: "11rem" }),
          }, svg("0 0 13 16", DOTS, "dots")) : null)),
        ...schema.columns.map((c) => cell(row, c)));
    });

    const span = String(schema.columns.length + 1);
    /** @type {Node[]} */
    const kids = [...trs];
    if (!shown.length) {
      kids.push(h("tr.tempty", h("td", { colspan: span },
        rows.length
          ? h("span", "No rows match. ",
              h("button.linkish", { type: "button", onclick: clearAll }, "Clear the filters"))
          : h("span", schema.columns.length
              ? "No rows yet. Add one below, or import a CSV from the more menu."
              : "No properties yet. Add one above."))));
    }
    if (editable() && schema.columns.length) {
      kids.push(h("tr.newrow", { onclick: addRow }, h("td", { colspan: span }, "+ New row")));
    }
    body.replaceChildren(...kids);

    count.textContent = shown.length === rows.length
      ? `${rows.length} rows` : `${shown.length} of ${rows.length}`;
    paintSelection();
    paintFoot(shown.length);
  }

  /** @param {number} shown */
  function paintFoot(shown) {
    const hidden = rows.length - shown;
    foot.hidden = !hidden;
    if (!hidden) return;
    foot.replaceChildren(h("button.tfootbtn", { type: "button", onclick: clearAll },
      h("b", `${hidden} row${hidden > 1 ? "s" : ""} hidden`),
      h("span", "Show everything")));
  }

  function paintSelection() {
    const n = state.picked.size;
    selbar.hidden = !n;
    if (!n) return;
    const ids = [...state.picked];
    selbar.replaceChildren(
      h("b", `${n} row${n > 1 ? "s" : ""} selected`),
      h("button.selact", {
        type: "button",
        onclick: () => { duplicate(rows.filter((r) => state.picked.has(r.id))); state.picked.clear(); },
      }, "Duplicate"),
      h("button.selact.danger", {
        type: "button", onclick: () => remove(ids),
      }, `Delete ${n > 1 ? "them" : "it"}`),
      h("span.selsp"),
      h("button.selact", {
        type: "button", onclick: () => { state.picked.clear(); paintBody(); },
      }, "Clear"));
  }

  /* ---------------- properties ---------------- */

  /** @param {number} from @param {number} to */
  function moveColumn(from, to) {
    const next = reorderColumns(schema.columns, from, to);
    schema = { ...schema, columns: next };
    repaint();
    alter(schema);
  }

  /**
   * One property change, built from the schema as it is at the moment it is
   * sent. It takes a NAME rather than a Column, because every Column object is
   * replaced by the next schema off the server and by every local edit — a menu
   * holding one from when it opened is holding a column that may not exist.
   * @param {string} of the column's name right now @param {Partial<Column>} patch
   */
  function patchColumn(of, patch) {
    const cur = schema.columns.find((c) => c.name === of);
    if (!cur) return Promise.resolve();
    const next = {
      ...schema,
      columns: schema.columns.map((c) => (c === cur ? seedType({ ...c, ...patch }) : c)),
    };
    schema = next;
    return alter(next);
  }

  /**
   * A property menu outlives the column it opened on: a rename in the same
   * visit replaces that column, and every schema arriving from the server
   * replaces all of them. A handle holds the CURRENT name instead, so each
   * thing the menu does resolves the column at the moment it is clicked. The
   * bug this exists to stop was silent both ways round — a rename and a retype
   * in one visit, and only the last one landed.
   * @param {string} startName
   */
  function handleFor(startName) {
    let current = startName;
    return {
      get name() { return current; },
      /** @returns {Column | null} */
      col: () => schema.columns.find((c) => c.name === current) || null,
      at: () => schema.columns.findIndex((c) => c.name === current),
      /** @param {string} to */
      moved: (to) => { current = to; },
    };
  }

  /** @typedef {ReturnType<typeof handleFor>} ColHandle */

  /** A link needs somewhere to point, and a column that is no longer categories
   *  should not carry a list of them. @param {Column} col */
  function seedType(col) {
    if (col.type === "link" && !col.table) {
      const other = ws.get().tables.find((t) => t.name !== name && t.kind === "basic");
      if (other) {
        col.table = other.name;
        col.show = SEEN_TABLES.get(other.name)?.schema.columns[0]?.name;
      }
    }
    if (col.type !== "categories") delete col.options;
    if (col.type !== "link") { delete col.table; delete col.show; }
    return col;
  }

  /** @param {ColHandle} hc @param {() => void} close */
  function propertyBody(hc, close) {
    const col = hc.col();
    if (!col) return [popLabel("That property is gone.")];
    const sorted = state.sort === col.name;
    return [
      popInput({
        value: col.name, "aria-label": "Property name",
        onkeydown: (/** @type {any} */ e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const field = /** @type {HTMLInputElement} */ (e.currentTarget);
          rename(hc, field.value.trim());
          close();
        },
        onblur: (/** @type {any} */ e) => {
          const field = /** @type {HTMLInputElement} */ (e.currentTarget);
          rename(hc, field.value.trim());
        },
      }),
      popSep(),
      popItem(`Type — ${labelOf(col.type)}`, () => typePicker(
        (type) => { patchColumn(hc.name, { type }); closePopover(); },
        col.type,
        popBack("Property", () => { openPropertyMenuAgain(hc); }),
      ), { note: "›" }),
      popSep(),
      popItem("Sort ascending", () => {
        state.sort = hc.name; state.dir = 1; resort(); openPropertyMenuAgain(hc);
      }, { checked: sorted && state.dir > 0 }),
      popItem("Sort descending", () => {
        state.sort = hc.name; state.dir = -1; resort(); openPropertyMenuAgain(hc);
      }, { checked: sorted && state.dir < 0 }),
      popSep(),
      // Both of these resolve the column at the moment they are clicked, not by
      // the name the menu opened on: the name box above may have just renamed it
      // on the way past, and the schema may have been replaced underneath.
      popItem("Duplicate property", () => {
        const at = hc.at();
        const cur = schema.columns[at];
        if (!cur) return close();
        const next = { ...schema, columns: [...schema.columns] };
        next.columns.splice(at + 1, 0, { ...cur, name: freeName(schema.columns, `${cur.name}_copy`) });
        schema = next;
        close(); repaint(); alter(next);
      }, { note: "empty" }),
      popItem("Delete property", () => {
        const at = hc.at();
        const cur = schema.columns[at];
        if (!cur) return close();
        const next = { ...schema, columns: schema.columns.filter((_, i) => i !== at) };
        state.filters = state.filters.filter((f) => f.column !== cur.name);
        if (state.sort === cur.name) state.sort = null;
        schema = next;
        close(); repaint(); alter(next);
      }, { danger: true, disabled: schema.columns.length < 2 }),
    ];
  }

  /** Drawing the property menu again in place, after something it shows changed.
   *  @param {ColHandle} hc */
  function openPropertyMenuAgain(hc) {
    pushPopover((close) => propertyBody(hc, close));
  }

  /**
   * A rename is the one column change a whole schema cannot express on its own:
   * `alter` would be handed two name lists and would have to infer it by
   * position, which reads "drop one column and add another" as a rename — and
   * guessing wrong there destroys a column of data. So it goes out as
   * `Column.from`, and only on the wire: the local schema never carries it, or
   * the next alter would repeat a rename that already happened.
   * @param {ColHandle} hc @param {string} to
   */
  function rename(hc, to) {
    const cur = hc.col();
    if (!cur || !to || to === cur.name) return;
    if (schema.columns.some((c) => c.name === to)) {
      tell(`There is already a property called ${to}.`, true);
      return;
    }
    const was = cur.name;
    if (state.sort === was) state.sort = to;
    for (const f of state.filters) if (f.column === was) f.column = to;

    const next = {
      ...schema,
      columns: schema.columns.map((c) => (c === cur ? seedType({ ...c, name: to }) : c)),
    };
    schema = next;
    hc.moved(to);
    // The head still says the old name until this repaints; while a menu is
    // open it is deferred, which is what `repaint` already does.
    repaint();
    alter({ ...next, columns: next.columns.map((c) => (c.name === to ? { ...c, from: was } : c)) });
  }

  /** The type picker is a board, not a dropdown: each type shows what it looks like.
   *  @param {(type: ColumnType) => void} onPick
   *  @param {string} current @param {HTMLElement | null} back */
  function typePicker(onPick, current, back) {
    return pushPopover(() => [
      back || null,
      popLabel("Property type"),
      h("div.typegrid", ...TYPES.map((ty) =>
        h("button.typecard" + (ty.id === current ? ".on" : ""), {
          type: "button", onclick: () => onPick(/** @type {ColumnType} */ (ty.id)),
        },
          h("span.typesample", ty.sample()),
          h("b", ty.label),
          h("span.typehint", ty.hint)))),
    ]);
  }

  /** @param {HTMLElement} anchor */
  function addColumn(anchor) {
    openMenu(anchor, () => [], { width: "26rem", align: "end" });
    typePicker((type) => {
      const col = seedType({
        name: freeName(schema.columns, `property_${schema.columns.length + 1}`),
        type,
      });
      const next = { ...schema, columns: [...schema.columns, col] };
      schema = next;
      closePopover();
      repaint();
      alter(next).then(() => {
        // Land the caret in the new name, the way Notion does — but only if the
        // column really is there, because `alter` swallows a rejection.
        const last = head.querySelectorAll(".prop")[schema.columns.length - 1];
        if (schema.columns[schema.columns.length - 1]?.name !== col.name) return;
        if (last instanceof HTMLElement) {
          const hc = handleFor(col.name);
          openMenu(last, (/** @type {() => void} */ close) => propertyBody(hc, close), { width: "15rem" });
        }
      });
    }, "text", null);
  }

  /* ---------------- head ---------------- */

  function paintHead() {
    head.replaceChildren(h("tr",
      h("th.rowgrip"),
      ...schema.columns.map((c, ci) => {
        // One handle per menu visit, so a rename made in it carries the rest of
        // the visit with it.
        const open = (/** @type {HTMLElement} */ anchor) => {
          const hc = handleFor(c.name);
          return openMenu(anchor, (/** @type {() => void} */ close) => propertyBody(hc, close), { width: "15rem" });
        };
        const th = h("th.prop", {
          draggable: editable() ? "true" : null, tabindex: "0",
          "aria-haspopup": "true", "aria-expanded": "false",
          onclick: (/** @type {any} */ e) => {
            if (!editable()) return;
            const target = /** @type {HTMLElement} */ (e.target);
            if (target.closest(".colsize") || target.closest(".sortbtn")) return;
            open(e.currentTarget);
          },
          onkeydown: (/** @type {any} */ e) => { if (e.key === "Enter" && editable()) open(e.currentTarget); },
        },
          h("div.propinner",
            h("div.propmeta", h("span.propname", c.name), h("span.ty", labelOf(c.type))),
            sortButton(c)),
          editable() ? resizer(c, ci) : null);

        if (!editable()) return th;

        th.addEventListener("dragstart", (e) => {
          e.dataTransfer?.setData("text/col", String(ci));
          th.classList.add("dragging");
        });
        th.addEventListener("dragend", () => th.classList.remove("dragging"));
        th.addEventListener("dragover", (e) => {
          if (!e.dataTransfer || ![...e.dataTransfer.types].includes("text/col")) return;
          e.preventDefault(); th.classList.add("dropcol");
        });
        th.addEventListener("dragleave", () => th.classList.remove("dropcol"));
        th.addEventListener("drop", (e) => {
          th.classList.remove("dropcol");
          const from = Number(e.dataTransfer?.getData("text/col"));
          if (Number.isNaN(from)) return;
          e.preventDefault();
          moveColumn(from, ci);
        });
        return th;
      })));
  }

  /**
   * Sorting where you look for it. Three states cycled by the arrow on the right
   * of a heading: unsorted, ascending, descending. Only a sorted column keeps its
   * arrow on show, so the head stays quiet until you point at it.
   * @param {Column} col
   */
  function sortButton(col) {
    const dir = state.sort === col.name ? (state.dir > 0 ? "up" : "down") : "";
    return h("button.sortbtn" + (dir ? ".on" : ""), {
      type: "button", "data-dir": dir,
      "aria-label": dir === "up" ? `Sorted by ${col.name}, A to Z. Reverse it.`
        : dir === "down" ? `Sorted by ${col.name}, Z to A. Stop sorting.`
        : `Sort by ${col.name}`,
      onclick: (/** @type {Event} */ e) => {
        e.stopPropagation();
        if (state.sort !== col.name) { state.sort = col.name; state.dir = 1; }
        else if (state.dir === 1) state.dir = -1;
        else state.sort = null;
        repaint();
      },
    }, svg("0 0 16 16", dir ? ARROW : DASH, "sortarrow"));
  }

  /** Drag the right edge of a heading. The width lives on the column, so it is
   *  written through `alter` when the drag ends rather than on every frame.
   *  @param {Column} col @param {number} ci */
  function resizer(col, ci) {
    const grip = h("span.colsize", { "aria-hidden": "true" });
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("sizing");
      const startX = e.clientX;
      const startW = widthOf(col);
      let width = startW;
      const onMove = (/** @type {PointerEvent} */ ev) => {
        width = Math.max(64, Math.round(startW + (ev.clientX - startX)));
        const box = cols.children[ci + 1];
        if (box instanceof HTMLElement) box.style.width = `${width}px`;
      };
      const onUp = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        grip.classList.remove("sizing");
        if (width !== startW) patchColumn(col.name, { width });
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
    });
    return grip;
  }

  function paintCols() {
    cols.replaceChildren(
      // Wide enough for the tick and the grip and not a pixel more. At 44 the
      // gutter had ten pixels of nothing after its controls, which read as a
      // gap between the table and its own first column.
      h("col", { style: { width: "34px" } }),
      ...schema.columns.map((c) => h("col", { style: { width: `${widthOf(c)}px` } })));
  }

  /* ---------------- filters ---------------- */

  const sortBody = () => pushPopover(() => [
    popLabel("Sort by"),
    ...schema.columns.map((c) => popItem(c.name, () => {
      if (state.sort === c.name) state.dir = -state.dir;
      else { state.sort = c.name; state.dir = 1; }
      resort();
      sortBody();
    }, {
      checked: state.sort === c.name,
      note: state.sort === c.name ? (state.dir > 0 ? "A to Z" : "Z to A") : undefined,
    })),
    state.sort === null ? null : popSep(),
    state.sort === null ? null : popItem("Remove sort", () => { state.sort = null; resort(); sortBody(); }),
  ]);

  const filterBody = () => pushPopover(() => [
    popLabel("Filter by"),
    ...schema.columns.map((c) => popItem(c.name, () => filterValues(c), { note: labelOf(c.type) })),
    schema.columns.length ? null : h("p.tsay.inpop", "No properties to filter on yet."),
  ]);

  /** @param {Column} col */
  function filterValues(col) {
    const existing = state.filters.find((f) => f.column === col.name && f.kind === "values");

    if (CHOOSY.has(col.type)) {
      const list = col.type === "checkbox" ? ["true", "false"]
        : col.type === "categories" ? optionsOf(col).map((o) => o.label)
        : distinct(col).map((o) => o.label);
      pushPopover(() => [
        popBack("Filter", () => filterBody()),
        popLabel(`${col.name} is any of`),
        // One pick per visit, then out. Adding another is the plus beside the
        // chips and taking one away is the chip itself, so this list never has
        // to double as a place where filters are removed.
        h("div.poplist", ...list.map((v) => popItem(v, () => {
          let f = state.filters.find((x) => x.column === col.name && x.kind === "values");
          if (!f) { f = { column: col.name, kind: "values", values: new Set() }; state.filters.push(f); }
          f.values.add(v);
          closePopover();
          repaint();
        }, { checked: !!existing?.values?.has(v) }))),
        list.length ? null : h("p.tsay.inpop", "No values in this column yet."),
      ]);
      return;
    }

    if (col.type === "number" || col.type === "date") {
      // One draft for the life of the menu. Rebuilding it inside draw() meant
      // choosing an operator set it on a throwaway the next redraw discarded.
      // Always a new one, too: filters are added and removed, never edited, so
      // picking the same column twice gives a range rather than a replacement.
      const f = { column: col.name, kind: "cmp", op: "eq", a: "", b: "" };

      // Nothing happens until Done. Filtering on every keystroke meant the table
      // churned under a half-typed number and the filter list grew things nobody
      // had finished asking for.
      const apply = () => {
        if (f.a === "") return;
        state.filters.push(f);
        closePopover();
        repaint();
      };

      const draw = () => pushPopover(() => {
        const field = (/** @type {"a" | "b"} */ key) => h("input.popinput.cmpval", {
          type: col.type === "date" ? "date" : "number",
          value: f[key] ?? "", "aria-label": key === "a" ? "Value" : "Second value",
          oninput: (/** @type {any} */ e) => {
            f[key] = /** @type {HTMLInputElement} */ (e.currentTarget).value;
            done.disabled = f.a === "";
          },
          onkeydown: (/** @type {any} */ e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } },
        });
        const done = /** @type {HTMLButtonElement} */ (h("button.btn.popdone", {
          type: "button", disabled: f.a === "" ? "" : null, onclick: apply,
        }, "Done"));
        return [
          popBack("Filter", () => filterBody()),
          popLabel(`${col.name} is`),
          h("div.ops", ...opsFor(col.type).map(([op, word]) =>
            h("button.op" + (f.op === op ? ".on" : ""), {
              type: "button", onclick: () => { f.op = op; draw(); },
            }, word))),
          h("div.cmpfields", field("a"), f.op === "between" ? field("b") : null),
          h("div.popactions", done),
        ];
      });
      draw();
      return;
    }

    const tf = { column: col.name, kind: "text", q: "" };
    const applyText = () => {
      if (!tf.q) return;
      state.filters.push(tf);
      closePopover();
      repaint();
    };
    const doneText = /** @type {HTMLButtonElement} */ (
      h("button.btn.popdone", { type: "button", disabled: "", onclick: applyText }, "Done"));
    pushPopover(() => [
      popBack("Filter", () => filterBody()),
      popLabel(`${col.name} contains`),
      popInput({
        placeholder: "Type to match",
        oninput: (/** @type {any} */ e) => {
          tf.q = /** @type {HTMLInputElement} */ (e.currentTarget).value;
          doneText.disabled = !tf.q;
        },
        onkeydown: (/** @type {any} */ e) => { if (e.key === "Enter") { e.preventDefault(); applyText(); } },
      }),
      h("div.popactions", doneText),
    ]);
  }

  function paintChips() {
    const chips = [];
    const drop = (/** @type {() => void} */ fn) => {
      fn();
      state.filters = state.filters.filter((x) => x.kind !== "values" || x.values.size);
      repaint();
    };

    for (const f of state.filters) {
      const col = schema.columns.find((c) => c.name === f.column);
      if (!col) continue;
      const one = (/** @type {string} */ text, /** @type {() => void} */ off) => chips.push(h("button.tchip", {
        type: "button", "aria-label": `Remove filter ${text}`,
        onclick: () => drop(off),
      }, text, h("span.x", "×")));

      if (f.kind === "values") {
        // Each value is its own chip because each was its own decision. They
        // still read as one filter — any of them matches — but they come off one
        // at a time.
        for (const v of f.values) one(`${col.name}: ${v}`, () => f.values.delete(v));
      } else if (f.kind === "cmp") {
        const word = opsFor(col.type).find(([op]) => op === f.op)?.[1] || f.op;
        one(`${col.name} ${word} ${f.a}${f.op === "between" && f.b ? ` and ${f.b}` : ""}`,
          () => { state.filters = state.filters.filter((x) => x !== f); });
      } else {
        one(`${col.name}: ${f.q}`, () => { state.filters = state.filters.filter((x) => x !== f); });
      }
    }

    chips.push(h("button.tchip.addfilter", {
      type: "button", "aria-haspopup": "true", "aria-expanded": "false",
      onclick: (/** @type {any} */ e) => { openMenu(e.currentTarget, () => [], { width: "14rem" }); filterBody(); },
    }, "+ Add filter"));
    chipbar.replaceChildren(...chips);
  }

  function clearAll() {
    state.q = ""; state.filters = []; state.sort = null; state.picked.clear();
    search.value = "";
    repaint();
  }

  /* ---------------- the top ---------------- */

  function paintTop() {
    title.textContent = name;
    // EVERY PAGE THAT READS THIS TABLE, as buttons. On a vault with one page it
    // says "No page reads this yet", which is true and tells a stranger nothing
    // they can act on — so in a built application the line is not there at all
    // rather than there and empty.
    if (production) { used.className = "usedby none"; used.replaceChildren(); return; }
    const users = pagesUsing(name, [...SEEN_PAGES.values()]);
    used.className = users.length ? "usedby" : "usedby none";
    used.replaceChildren(...(users.length
      ? [h("span.usedlab", "Used by"), ...users.map(({ page, how }) =>
          h("button.usepill", {
            type: "button",
            "aria-label": `Open ${page.name}, which ${how} this table`,
            onclick: () => ui.go("page", page.id),
          }, h("b", page.name), h("span", how)))]
      : ["No page reads this yet."]));
  }

  const tbtn = (/** @type {string} */ label, /** @type {(a: HTMLElement) => void} */ fn) => h("button.tbtn", {
    type: "button", "aria-haspopup": "true", "aria-expanded": "false",
    onclick: (/** @type {any} */ e) => fn(e.currentTarget),
  }, label);

  function exportCsv() {
    const blob = new Blob([toCsv(schema.columns, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: `${name}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const bar = h("div.tbar",
    h("span.tsearchwrap", svg("0 0 16 16", GLASS, "glass"), search),
    h("span.tsp"),
    count,
    tbtn("Sort", (a) => { openMenu(a, () => [], { width: "13rem" }); sortBody(); }),
    h("button.tbtn.more", {
      type: "button", "aria-label": "More", "aria-haspopup": "true", "aria-expanded": "false",
      onclick: (/** @type {any} */ e) => openMenu(e.currentTarget, (close) => [
        popItem("Export as CSV", () => { exportCsv(); close(); }, { note: `${rows.length} rows` }),
        editable() ? popItem("Import a CSV", () => { close(); fileInput.click(); }, { note: "adds rows" }) : null,
      ], { width: "14rem", align: "end" }),
    }, svg("0 0 13 16", DOTS, "dots")));

  const newProp = h("button.btn.newprop", {
    type: "button", "aria-haspopup": "true", "aria-expanded": "false",
    onclick: (/** @type {any} */ e) => addColumn(e.currentTarget),
  }, "+ New property");

  const el = h("div.tbl",
    h("div.tbl-top", title, used),
    bar,
    chipbar,
    selbar,
    say,
    h("div.grid-wrap", h("table.grid.sized", cols, head, body)),
    foot,
    fileInput);

  /** @param {TableView} view */
  function update(view) {
    schema = view.schema;

    // Row objects are reused where the id survives. An open menu holds a
    // reference to the row it is editing, and replacing the array under it
    // would send the next write into an object nothing is looking at — the
    // identity problem the mock had, wearing a different hat.
    const before = new Map(rows.map((r) => [r.id, r]));
    rows = view.rows.map((r) => {
      const kept = before.get(r.id);
      if (!kept) return { id: r.id, cells: { ...r.cells } };
      kept.cells = { ...r.cells };
      return kept;
    });

    // A write that has not come back yet must not be undone by a repaint that
    // arrived first — a category chip would flicker off and back on.
    for (const [key, value] of inflight) {
      const sep = key.indexOf("\u0000");
      const id = Number(key.slice(0, sep));
      const column = key.slice(sep + 1);
      const row = rows.find((r) => r.id === id);
      if (row) row.cells[column] = value;
    }

    // Selections and filters name things that may no longer exist.
    const live = new Set(rows.map((r) => r.id));
    for (const id of [...state.picked]) if (!live.has(id)) state.picked.delete(id);
    state.filters = state.filters.filter((f) => schema.columns.some((c) => c.name === f.column));
    if (state.sort && !schema.columns.some((c) => c.name === state.sort)) state.sort = null;

    SEEN_TABLES.set(name, { schema, rows });
    const page = ws.get().page;
    if (page) SEEN_PAGES.set(page.id, page);

    if (editable()) {
      if (!bar.contains(newProp)) bar.append(newProp);
    } else {
      newProp.remove();
    }

    repaint();
  }

  return { el, update };
}
