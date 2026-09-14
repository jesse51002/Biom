// SPDX-License-Identifier: AGPL-3.0-only
// The `_tables` registry, and every SQL statement the workspace issues.
//
// Together with `server/platform/db.ts` these are the only two files in the
// framework that contain SQL, and the layering gate proves it: nothing else may
// import `db.ts`. That is the honest replacement cost of the storage engine —
// two files, named, rather than one file plus a query builder that would have
// been larger than both and had exactly one dialect behind it for the whole
// life of the framework.
//
// The registry carries what SQLite lacks. SQLite knows TEXT and REAL; the grid
// needs to know that a TEXT column is a day on a calendar, a set of coloured
// labels, or a link to a row in another table. `_tables`, `_columns` and
// `_options` are that difference and nothing else.

import type {
  Cell,
  Column,
  ColumnType,
  Db,
  HostErrorCode,
  PageId,
  Row,
  RowId,
  RowInput,
  RowQuery,
  SqlParam,
  SqlResult,
  TableName,
  TableRef,
  TableSchema,
  TableView,
  Tables,
} from "../../contracts/types.ts";

/** Tables sit in the tree beside pages, so the registry carries where each one
 *  sits. The READ half needs nothing new — `TableRef.parent` comes back from
 *  `list()`, which is exactly the `TableList` pages.ts asks for — and only the
 *  write is missing, because `TableSchema` carries no parent: where a table sits
 *  is workspace state, not part of what the table IS.
 *
 *  It is declared here rather than in `Tables` because `contracts/types.ts` is
 *  frozen. Its one consumer is the workspace layer, which imports this file. */
export interface TableTree {
  /** `null` is unfiled, and pages.ts is the module that decides what unfiled
   *  means for the tree — the rule that a null parent shows at the root is one
   *  rule about the tree, and splitting it across two modules is how the top
   *  level ends up meaning two different things. */
  setParent(name: TableName, parent: PageId | null): void;
}

/* ── failures ──────────────────────────────────────────────────────────── */

/** Carries the wire's error code, so the API layer maps a failure rather than
 *  guessing at one. `message` is a leak channel and never names a table, a
 *  column or a query — the same rule the wire holds itself to. */
export class TableError extends Error {
  readonly code: HostErrorCode;
  constructor(code: HostErrorCode, message: string) {
    super(message);
    this.name = "TableError";
    this.code = code;
  }
}

const bad = (message: string) => new TableError("bad_request", message);
const gone = (message: string) => new TableError("not_found", message);

/* ── identifiers ───────────────────────────────────────────────────────── */
//
// A table or column name cannot be a bound parameter, so it is quoted instead.
// Every SQL string in this file interpolates names through `quote` and values
// through `?` — there is no third way to get text into a statement.

const MAX_NAME = 64;

/** SQLite's own escape: a double quote inside a quoted identifier is doubled.
 *  Escaping rather than refusing means a name that came back out of
 *  `sqlite_master` can always be quoted again, whatever the agent called it. */
function quote(name: string): string {
  if (typeof name !== "string" || name === "") throw bad("a name is required");
  return `"${name.replaceAll('"', '""')}"`;
}

/** What a person may call a table or a column. Underscore-first belongs to the
 *  host — the same reserve the vault uses — so there is one rule, not two. */
function userName(name: string): string {
  if (typeof name !== "string" || name.trim() === "") throw bad("a name is required");
  if (name.length > MAX_NAME) throw bad(`a name may be at most ${MAX_NAME} characters`);
  if (/[\r\n]/.test(name)) throw bad("a name may not contain a line break");
  if (name.startsWith("_")) throw bad("a name beginning with an underscore belongs to the workspace");
  if (name.toLowerCase() === "id") throw bad("id is the row's own key, not a column you declare");
  return name;
}

/* ── the type vocabulary ───────────────────────────────────────────────── */

const DECL: Readonly<Record<ColumnType, string>> = {
  text: "TEXT",
  number: "REAL", // one numeric type for money and counts; the grid formats
  checkbox: "INTEGER",
  date: "TEXT", // YYYY-MM-DD, no time and no zone
  categories: "TEXT", // a JSON array of labels; the colours live in _options
  person: "TEXT",
  url: "TEXT",
  email: "TEXT",
  phone: "TEXT",
  link: "INTEGER", // the referenced row's id
  page: "TEXT", // a page id
};

const TYPES: ReadonlySet<string> = new Set(Object.keys(DECL));

/** Six types that differ only in how a value is edited and drawn. They share
 *  one storage, which is why every conversion into or out of them is total. */
const TEXTY: ReadonlySet<ColumnType> = new Set<ColumnType>([
  "text", "person", "url", "email", "phone", "page",
]);

const DATE_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Palette roles, never literals — the mock's central rule, carried into
 *  the data model, so a table's chips repaint when the workspace palette does.
 *  The rule in full: nothing sets a raw colour, every colour resolves to a token,
 *  and a hex literal anywhere but the one module that defines a palette is a bug
 *  — it is what breaks theming for generated pages. */
const ROLES = ["cyan", "magenta", "yellow", "nonrepro", "ink-3", "cyan-t", "magenta-t"];

/** Only `date` and `checkbox` are constrained, because they are the only two
 *  with exactly one legal spelling. URL, email and phone are input affordances,
 *  not truth claims: a CHECK on them refuses a paste and loses the user's text,
 *  which is a worse failure than a malformed phone number.
 *
 *  `categories` is left unconstrained too, though its stored shape is a JSON
 *  array — every write through this module normalises it, and a CHECK would
 *  only ever fire on the agent's own raw SQL, where a hard refusal helps
 *  nobody. Every read parses defensively instead. */
function columnDdl(col: Column): string {
  const q = quote(col.name);
  if (!DECL[col.type]) throw bad("unknown column type");
  if (col.type === "checkbox") return `${q} INTEGER NOT NULL DEFAULT 0 CHECK (${q} IN (0,1))`;
  if (col.type === "date") return `${q} TEXT CHECK (${q} IS NULL OR ${q} GLOB '${DATE_GLOB}')`;
  // A `link` column deliberately carries no REFERENCES clause. The registry's
  // link_table is the declaration; the framework does not enforce it. With
  // foreign keys on, rebuilding a parent table during `alter` would fire
  // ON DELETE against the children and silently null every linked cell — data
  // loss inside the one operation that exists to avoid it.
  return `${q} ${DECL[col.type]}`;
}

/* ── coercion ──────────────────────────────────────────────────────────── */
//
// One direction each. `fromStore` is what SQLite gave us, seen as the declared
// type; `toStore` is any value seen as something SQLite will hold. Every write
// path — a cell edit, a CSV import, a retype — goes through the same pair, so
// there is one place where "what does this value mean" is answered.

const asText = (v: Cell): string | null => {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  // Empty and absent are the same claim, and collapsing them is what makes a
  // CSV round-trip lossless: null exports as an empty field and imports back.
  return s === "" ? null : s;
};

const asNumber = (v: Cell): number | null => {
  if (v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  // "£1,240.00" is a number a person typed. The mock strips the same set — and
  // then answers 0 for text that held no number at all, which is a claim the
  // user never made. Nothing left to strip means there was never a number.
  const stripped = String(v).replace(/[^0-9.\-]/g, "");
  if (!/[0-9]/.test(stripped)) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
};

const TRUTHY = new Set(["true", "yes", "y", "t", "1", "on"]);

const asCheckbox = (v: Cell): number => {
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v !== 0 ? 1 : 0;
  return TRUTHY.has(String(v).trim().toLowerCase()) ? 1 : 0;
};

const pad = (n: number) => String(n).padStart(2, "0");

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Month names as a spreadsheet writes them: long, short, and the one
 *  four-letter abbreviation English insists on. */
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Two digits is a century the spreadsheet left off. The 70 boundary is the
 *  window every other tool uses; it is stated here rather than inherited. */
const century = (y: number) => (y >= 100 ? y : y < 70 ? 2000 + y : 1900 + y);

/** A day that exists, spelled the one legal way. 2026-02-30 is a typo rather
 *  than a date, and storing it would put a value in the column that no filter
 *  can ever match and the CHECK would refuse from raw SQL. */
function calendar(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  if (d > (m === 2 && leap(y) ? 29 : MONTH_DAYS[m - 1]!)) return null;
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

//  The spellings a spreadsheet actually emits. A clock and a zone may follow a
//  numeric date — an export that went through a timestamp — and both are
//  discarded rather than consulted.
const ISO_ISH = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/;
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[T ].*)?$/;
const DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?[ \-]+([A-Za-z]{3,9})\.?[ \-,]+(\d{2}|\d{4})$/;
const MONTH_DAY = /^([A-Za-z]{3,9})\.?[ \-]+(\d{1,2})(?:st|nd|rd|th)?,?[ \-]+(\d{2}|\d{4})$/;
const WEEKDAY = /^(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i;

/** A date is a CALENDAR date the whole way through — three integers, never an
 *  instant. Parsing to a `Date` and reading local components back is what puts
 *  a stored day one to the west of the day the user typed, and it is invisible
 *  to anyone developing in UTC.
 *
 *  `04/03/2026` is read DAY-first, which is the house form and the one the
 *  fixtures are written in. The guess only ever runs when both numbers could be
 *  a month: a component past 12 can only be a day, so an American export still
 *  reads correctly in both orders. Anything that is not one of the spellings
 *  below is not a date, and answering null is what lets `importCsv` report it. */
const asDate = (v: Cell): string | null => {
  if (v === null || v === "") return null;
  const s = String(v).trim().replace(WEEKDAY, "");
  if (s === "") return null;
  // Already the one legal spelling — but still put through the calendar, because
  // `2026-13-01` satisfies both this shape and the column's GLOB and is not a
  // day. Only a real date short-circuits.
  if (DATE_RE.test(s)) return calendar(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));

  const iso = ISO_ISH.exec(s);
  if (iso) return calendar(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const num = NUMERIC.exec(s);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    const y = century(Number(num[3]));
    return b > 12 && a <= 12 ? calendar(y, a, b) : calendar(y, b, a);
  }

  const dm = DAY_MONTH.exec(s);
  if (dm) {
    const m = MONTHS[dm[2]!.toLowerCase()];
    return m === undefined ? null : calendar(century(Number(dm[3])), m, Number(dm[1]));
  }

  const md = MONTH_DAY.exec(s);
  if (md) {
    const m = MONTHS[md[1]!.toLowerCase()];
    return m === undefined ? null : calendar(century(Number(md[3])), m, Number(md[2]));
  }

  return null;
};

const asLink = (v: Cell): number | null => {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : null;
};

const clean = (xs: unknown[]): string[] =>
  xs.map((x) => String(x ?? "").trim()).filter((x) => x !== "");

/** A JSON array of labels. A label with punctuation in it round-trips, which a
 *  delimiter cannot promise — and the delimiter's ergonomic win is in raw SQL,
 *  a surface nobody using this workspace is meant to read. */
const asCategories = (v: Cell): string | null => {
  if (v === null) return null;
  const s = typeof v === "boolean" ? String(v) : String(v).trim();
  if (s === "") return null;
  if (s.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(s);
      // An explicitly empty array is kept: "no labels" is a value somebody
      // chose, and rewriting it to null would make an import lossy.
      if (Array.isArray(parsed)) return JSON.stringify(clean(parsed));
    } catch {
      // It was text that happened to start with a bracket. Fall through.
    }
  }
  const labels = clean(s.split(/\s*;\s*/));
  return labels.length ? JSON.stringify(labels) : null;
};

/** The labels in a stored categories cell. Defensive, because nothing stops the
 *  agent writing a bare string through `sql()`, and a grid that throws on one
 *  odd cell is worse than one that shows it as a single label. */
function labelsOf(v: Cell): string[] {
  if (v === null) return [];
  const s = String(v).trim();
  if (s === "") return [];
  if (s.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return clean(parsed);
    } catch {
      // not JSON after all
    }
  }
  return clean(s.split(/\s*;\s*/));
}

function toStore(type: ColumnType, v: Cell): SqlParam {
  switch (type) {
    case "number": return asNumber(v);
    case "checkbox": return asCheckbox(v);
    case "date": return asDate(v);
    case "categories": return asCategories(v);
    case "link": return asLink(v);
    default: return asText(v);
  }
}

function fromStore(type: ColumnType, v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (type === "checkbox") return v === 1 || v === true || v === "1";
  if (type === "number" || type === "link") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/* ── retyping ──────────────────────────────────────────────────────────── */

/** A retype is allowed when every value has one obvious destination, and
 *  refused otherwise — a pair with no defined conversion must fail loudly
 *  rather than empty a column and say nothing.
 *
 *               text-ish  number  checkbox  date  categories  link
 *   text-ish        ·        y        y       y        y        y
 *   number          y        ·        y       n        n        y
 *   checkbox        y        y        ·       n        n        n
 *   date            y        n        n       ·        n        n
 *   categories      y        n        n       n        ·        n
 *   link            y        y        n       n        n        ·
 *
 *  Every type has a faithful string, so anything may become text-ish; parsing
 *  is what the other types are for, so text-ish may become anything. The gaps
 *  are the pairs where a value would have to be invented: a number is not a
 *  day, and a set of labels is not a yes-or-no. Two hops through text does
 *  them, visibly, which is the point.
 *
 *  What is NOT promised is that a retype keeps every value: a text column
 *  retyped to number nulls the cells that were never numbers. There is no
 *  row-level undo in the framework — the vault's git history covers files, not
 *  `workspace.db` — so a retype is destructive and says so here. */
function retypeAllowed(from: ColumnType, to: ColumnType): boolean {
  if (from === to) return true;
  if (TEXTY.has(to) || TEXTY.has(from)) return true;
  if (from === "number" && (to === "checkbox" || to === "link")) return true;
  if (from === "checkbox" && to === "number") return true;
  if (from === "link" && to === "number") return true;
  return false;
}

function convertCell(from: ColumnType, to: ColumnType, raw: unknown): SqlParam {
  let v = fromStore(from, raw);
  // A label set reads as text the way a person writes one, which is also what
  // a text -> categories retype parses back. The pair round-trips.
  if (from === "categories" && TEXTY.has(to)) {
    const joined = labelsOf(v).join("; ");
    v = joined === "" ? null : joined;
  }
  return toStore(to, v);
}

/* ── the registry ──────────────────────────────────────────────────────── */

const REGISTRY = [
  `CREATE TABLE IF NOT EXISTS _meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  // 'sql' is Prototype.md's "plain SQL table the agent made": listed and
  // readable, with no column metadata beyond its kind. One code path, one
  // registry, one flag.
  //
  // `parent` is the page this table hangs off — tables sit in the tree beside
  // pages rather than in a section of their own, so a table can live next to the
  // page that uses it. NULL is a value rather than a gap: a table the agent made
  // in raw SQL is unfiled until somebody places it.
  `CREATE TABLE IF NOT EXISTS _tables (
     name       TEXT PRIMARY KEY,
     kind       TEXT NOT NULL CHECK (kind IN ('basic','sql')),
     parent     TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  // No CHECK on `type`: the vocabulary is the thing most likely to grow, and
  // SQLite cannot alter a CHECK without rebuilding the table. The data is
  // constrained; the vocabulary is validated here, in the host.
  `CREATE TABLE IF NOT EXISTS _columns (
     "table"    TEXT NOT NULL,
     name       TEXT NOT NULL,
     type       TEXT NOT NULL,
     position   INTEGER NOT NULL,
     width      INTEGER,
     link_table TEXT,
     link_show  TEXT,
     PRIMARY KEY ("table", name)
   )`,
  `CREATE TABLE IF NOT EXISTS _options (
     "table"   TEXT NOT NULL,
     "column"  TEXT NOT NULL,
     name      TEXT NOT NULL,
     colour    TEXT NOT NULL,
     position  INTEGER NOT NULL,
     PRIMARY KEY ("table", "column", name)
   )`,
  `CREATE INDEX IF NOT EXISTS _columns_by_position ON _columns("table", position)`,
];

/** One version number for the database, beside the vault's own `format: 1`, so
 *  a future migration has something to read rather than something to guess. */
const FORMAT = "1";

/** A DATABASE WRITTEN BY A NEWER BUILD IS REFUSED, and for the same reason
 *  `migrate.ts` refuses an older vault: the alternative is not "works a bit", it
 *  is damage. Two statements below this one widen `_tables` in place and
 *  reconcile the registry against what is physically there — against a schema
 *  this build has never seen, that is a guess acting on somebody's rows.
 *
 *  THE NUMBER WAS WRITTEN AND NEVER READ. `format` has gone into `_meta` since
 *  the registry existed, so every workspace on disk already carries the value
 *  this compares; what was missing was anything looking at it, which made it a
 *  note to a future maintainer rather than a gate. Only the FUTURE is refused —
 *  an older number is what a migration is for, and there has not been one yet.
 *
 *  The sentence says which version, because that is the whole of what somebody
 *  can act on: the workspace is fine and this copy of the program is behind it. */
function checkDbFormat(db: Db): void {
  const row = db.all<{ value: string }>(`SELECT value FROM _meta WHERE key = 'format'`)[0];
  if (row === undefined) return;
  const found = Number(row.value);
  if (!Number.isFinite(found) || found <= Number(FORMAT)) return;
  throw Object.assign(
    new Error(
      `this workspace's database is version ${String(found)} and this build reads version ${FORMAT} — ` +
        "it was written by a newer Biom, so open it with that one",
    ),
    { code: "bad_request" },
  );
}

/* ── the module ────────────────────────────────────────────────────────── */

export function makeTables(db: Db): Tables & TableTree {
  // THE DDL FIRST AND THE GATE SECOND, which is safe in the one direction that
  // matters: `CREATE TABLE IF NOT EXISTS` does nothing at all to a database that
  // already holds these tables, so a newer one is untouched by the time it is
  // read. Everything below the gate — the `ADD COLUMN`, the reconcile — writes,
  // and none of it runs.
  for (const ddl of REGISTRY) db.run(ddl);
  checkDbFormat(db);
  db.run(`INSERT OR IGNORE INTO _meta (key, value) VALUES ('format', ?)`, [FORMAT]);
  // `CREATE TABLE IF NOT EXISTS` does nothing to a registry that already exists,
  // so a vault made before tables joined the tree has to be widened in place.
  // Every existing row migrates to NULL, which is what ADD COLUMN gives it and
  // also what it means: those tables were never placed anywhere.
  if (!db.all<{ name: string }>(`PRAGMA table_info("_tables")`).some((c) => String(c.name) === "parent")) {
    db.run(`ALTER TABLE _tables ADD COLUMN parent TEXT`);
  }

  /* ---- registry reads ---- */

  const registered = (name: TableName): "basic" | "sql" | null => {
    const row = db.all<{ kind: string }>(`SELECT kind FROM _tables WHERE name = ?`, [name])[0];
    return row ? (row.kind === "sql" ? "sql" : "basic") : null;
  };

  const physical = (): string[] =>
    db
      .all<{ name: string }>(
        `SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE '\\_%' ESCAPE '\\'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .map((r) => String(r.name));

  const columnNames = (name: TableName): string[] =>
    db.all<{ name: string }>(`PRAGMA table_info(${quote(name)})`).map((r) => String(r.name));

  /** Claude Code has direct access to `workspace.db`, and the whole change loop
   *  is it writing while the app is open. A table it made appears in the
   *  sidebar because of this, and a table it dropped stops appearing. The
   *  registry follows the database rather than arguing with it. */
  function reconcile(): void {
    const there = physical();
    const here = db.all<{ name: string; kind: string }>(`SELECT name, kind FROM _tables`);
    const known = new Set(here.map((r) => String(r.name)));

    const adds = there.filter((n) => !known.has(n));
    const drops = here.filter((r) => !there.includes(String(r.name))).map((r) => String(r.name));

    // A column dropped out from under the registry would break every SELECT
    // this module builds, so the registry loses it too.
    const stale: { table: string; column: string }[] = [];
    for (const r of here) {
      const table = String(r.name);
      if (r.kind !== "basic" || drops.includes(table)) continue;
      const live = new Set(columnNames(table));
      for (const c of db.all<{ name: string }>(`SELECT name FROM _columns WHERE "table" = ?`, [table]))
        if (!live.has(String(c.name))) stale.push({ table, column: String(c.name) });
    }

    if (!adds.length && !drops.length && !stale.length) return;
    db.tx(() => {
      for (const n of adds) db.run(`INSERT INTO _tables (name, kind) VALUES (?, 'sql')`, [n]);
      for (const n of drops) forget(n);
      for (const s of stale) {
        db.run(`DELETE FROM _options WHERE "table" = ? AND "column" = ?`, [s.table, s.column]);
        db.run(`DELETE FROM _columns WHERE "table" = ? AND name = ?`, [s.table, s.column]);
      }
    });
  }

  /** Registry rows only. The relationships between the three registry tables
   *  are written out rather than declared as foreign keys, because the framework
   *  never turns foreign keys on and a cascade nobody enforces is a comment. */
  function forget(name: TableName): void {
    db.run(`DELETE FROM _options WHERE "table" = ?`, [name]);
    db.run(`DELETE FROM _columns WHERE "table" = ?`, [name]);
    db.run(`DELETE FROM _tables WHERE name = ?`, [name]);
  }

  function writeColumns(name: TableName, cols: Column[]): void {
    db.run(`DELETE FROM _options WHERE "table" = ?`, [name]);
    db.run(`DELETE FROM _columns WHERE "table" = ?`, [name]);
    cols.forEach((col, i) => {
      db.run(
        `INSERT INTO _columns ("table", name, type, position, width, link_table, link_show)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          col.name,
          col.type,
          i,
          col.width ?? null,
          col.type === "link" ? col.table ?? null : null,
          col.type === "link" ? col.show ?? null : null,
        ],
      );
      if (col.type !== "categories") return;
      (col.options ?? []).forEach((opt, j) => {
        db.run(
          `INSERT OR IGNORE INTO _options ("table", "column", name, colour, position)
           VALUES (?, ?, ?, ?, ?)`,
          [name, col.name, opt.label, opt.colour || ROLES[j % ROLES.length]!, j],
        );
      });
    });
  }

  /** A label an artifact writes that the registry has never seen gets a palette
   *  role now, so the chip is coloured and the filter menu offers it. The mock
   *  did this on read, which meant looking at a table changed its schema; doing
   *  it on write is the same result at the moment something actually changed. */
  function learnLabels(table: TableName, column: string, stored: SqlParam): void {
    const labels = labelsOf(typeof stored === "string" ? stored : null);
    if (!labels.length) return;
    const have = db.all<{ name: string; position: number }>(
      `SELECT name, position FROM _options WHERE "table" = ? AND "column" = ?`,
      [table, column],
    );
    const known = new Set(have.map((o) => String(o.name)));
    let pos = have.reduce((m, o) => Math.max(m, Number(o.position) + 1), 0);
    for (const label of labels) {
      if (known.has(label)) continue;
      db.run(
        `INSERT OR IGNORE INTO _options ("table", "column", name, colour, position)
         VALUES (?, ?, ?, ?, ?)`,
        [table, column, label, ROLES[pos % ROLES.length]!, pos],
      );
      known.add(label);
      pos++;
    }
  }

  /* ---- schema ---- */

  /** SQLite's declared type, back to something the grid can draw. Only ever
   *  used for an agent's own table, where nobody declared anything richer. */
  function declToType(decl: string): ColumnType {
    return /INT|REAL|FLOA|DOUB|NUM|DEC/.test(decl.toUpperCase()) ? "number" : "text";
  }

  function readSchema(name: TableName): TableSchema | null {
    let kind = registered(name);
    if (!kind) {
      // It may be a table the agent made a second ago. Look once, then answer.
      reconcile();
      kind = registered(name);
      if (!kind) return null;
    }

    if (kind === "sql") {
      // No column metadata beyond its kind: what the grid shows is derived from
      // SQLite itself, which is exactly as much as the agent declared.
      const info = db.all<{ name: string; type: string }>(`PRAGMA table_info(${quote(name)})`);
      return {
        name,
        kind: "sql",
        columns: info.map((c) => ({
          name: String(c.name),
          type: declToType(String(c.type ?? "")),
          width: null,
        })),
      };
    }

    const rows = db.all<{
      name: string;
      type: string;
      width: number | null;
      link_table: string | null;
      link_show: string | null;
    }>(
      `SELECT name, type, width, link_table, link_show
         FROM _columns WHERE "table" = ? ORDER BY position, name`,
      [name],
    );
    const opts = db.all<{ column: string; name: string; colour: string }>(
      `SELECT "column", name, colour FROM _options WHERE "table" = ? ORDER BY "column", position`,
      [name],
    );

    const columns: Column[] = rows.map((r) => {
      const declared = String(r.type);
      const type = (TYPES.has(declared) ? declared : "text") as ColumnType;
      const col: Column = { name: String(r.name), type, width: r.width ?? null };
      if (type === "categories")
        col.options = opts
          .filter((o) => String(o.column) === String(r.name))
          .map((o) => ({ label: String(o.name), colour: String(o.colour) }));
      if (type === "link") {
        col.table = r.link_table ?? undefined;
        col.show = r.link_show ?? undefined;
      }
      return col;
    });
    return { name, kind: "basic", columns };
  }

  function need(name: TableName): TableSchema {
    const s = readSchema(name);
    if (!s) throw gone("no table by that name");
    return s;
  }

  function basic(name: TableName): TableSchema {
    const s = need(name);
    if (s.kind !== "basic") throw bad("that table belongs to the agent and has no editable columns");
    return s;
  }

  /* ---- reading rows ---- */

  const ROWID = "__rowid__";

  const selectList = (s: TableSchema): string =>
    s.kind === "basic"
      ? [`"id"`, ...s.columns.map((c) => quote(c.name))].join(", ")
      : `rowid AS ${quote(ROWID)}, *`;

  function whereOf(s: TableSchema, where: Record<string, Cell> | undefined, params: SqlParam[]): string {
    const byName = new Map(s.columns.map((c) => [c.name, c]));
    const parts: string[] = [];
    for (const [name, value] of Object.entries(where ?? {})) {
      const col = byName.get(name);
      if (!col) throw bad("no column by that name");
      const q = quote(name);
      if (col.type === "categories") {
        // A categories value is a set, so equality means "carries this label".
        // json_valid guards the agent's own raw writes, which nothing checks.
        parts.push(
          `(${q} IS NOT NULL AND json_valid(${q}) AND EXISTS (SELECT 1 FROM json_each(${q}) WHERE value = ?))`,
        );
        params.push(asText(value));
        continue;
      }
      const stored = toStore(col.type, value);
      if (stored === null) parts.push(`${q} IS NULL`);
      else {
        parts.push(`${q} = ?`);
        params.push(stored);
      }
    }
    return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  }

  function orderOf(s: TableSchema, order: RowQuery["order"]): string {
    if (!order || !order.length) return "";
    const byName = new Map(s.columns.map((c) => [c.name, c]));
    const parts = order.map((o) => {
      const col = byName.get(o.column);
      if (!col) throw bad("no column by that name");
      // Case-insensitive for the text-ish types, which is how the mock's
      // localeCompare behaved and what a person expects of a name column.
      const collate = TEXTY.has(col.type) || col.type === "categories" ? " COLLATE NOCASE" : "";
      return `${quote(o.column)}${collate} ${o.dir === "desc" ? "DESC" : "ASC"}`;
    });
    return ` ORDER BY ${parts.join(", ")}`;
  }

  /** A WITHOUT ROWID table has no rowid to select, and an agent may well have
   *  made one. Reading it without row identity beats refusing to read it. */
  function readAll(s: TableSchema, sql: string, params: SqlParam[]): Row[] {
    let out: Record<string, unknown>[];
    try {
      out = db.all<Record<string, unknown>>(sql, params);
    } catch (err) {
      if (s.kind !== "sql") throw sqlFailed(err);
      out = db.all<Record<string, unknown>>(sql.replace(`rowid AS ${quote(ROWID)}, `, ""), params);
    }
    const byName = new Map(s.columns.map((c) => [c.name, c]));
    return out.map((r) => {
      const cells: Record<string, Cell> = {};
      for (const [name, value] of Object.entries(r)) {
        if (name === ROWID) continue;
        if (name === "id" && s.kind === "basic") continue;
        const col = byName.get(name);
        cells[name] = fromStore(col ? col.type : "text", value);
      }
      return { id: Number((s.kind === "basic" ? r["id"] : r[ROWID]) ?? 0), cells };
    });
  }

  function readRows(name: TableName, q: RowQuery = {}): TableView {
    const s = need(name);
    const params: SqlParam[] = [];
    const where = whereOf(s, q.where, params);

    // `total` counts what the query matched, before the page was taken off it,
    // because that is the number a paginator needs. The unfiltered count is a
    // second call with no `where`, which is what `list()` already does.
    const counted = db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quote(name)}${where}`, params)[0];

    let tail = orderOf(s, q.order);
    const limit = q.limit === undefined ? null : Math.max(0, Math.floor(q.limit));
    const offset = q.offset === undefined ? 0 : Math.max(0, Math.floor(q.offset));
    // No default page size. The framework's tables are seeded fixtures, and a cap
    // that silently truncated a grid would be a bug generator, not a guard.
    if (limit !== null || offset > 0) tail += ` LIMIT ${limit === null ? -1 : limit} OFFSET ${offset}`;

    return {
      schema: s,
      rows: readAll(s, `SELECT ${selectList(s)} FROM ${quote(name)}${where}${tail}`, params),
      total: counted ? Number(counted.n) : 0,
    };
  }

  /* ---- writing rows ---- */

  const scalar = (v: Cell): SqlParam => (typeof v === "boolean" ? (v ? 1 : 0) : v);

  /** The columns a write may name. A basic table's come from the registry; an
   *  agent's own come from SQLite, which is the one place the two kinds
   *  legitimately differ. */
  const writable = (s: TableSchema): Map<string, Column> => new Map(s.columns.map((c) => [c.name, c]));

  function bindRow(s: TableSchema, row: RowInput): { names: string[]; values: SqlParam[] } {
    const cols = writable(s);
    const names: string[] = [];
    const values: SqlParam[] = [];
    for (const [name, value] of Object.entries(row)) {
      const col = cols.get(name);
      if (!col) throw bad("no column by that name");
      names.push(name);
      values.push(s.kind === "basic" ? toStore(col.type, value) : scalar(value));
    }
    return { names, values };
  }

  const rowKey = (s: TableSchema) => (s.kind === "basic" ? `"id"` : "rowid");

  function learnAll(s: TableSchema, names: string[], values: SqlParam[]): void {
    if (s.kind !== "basic") return;
    const cols = writable(s);
    names.forEach((n, i) => {
      if (cols.get(n)?.type === "categories") learnLabels(s.name, n, values[i] ?? null);
    });
  }

  /* ---- schema changes ---- */

  function checkColumns(cols: Column[]): Column[] {
    const seen = new Set<string>();
    for (const col of cols) {
      userName(col.name);
      if (!TYPES.has(col.type)) throw bad("unknown column type");
      // SQLite folds ASCII case in identifiers, so two columns a case apart are
      // one column with a fight over it.
      const lower = col.name.toLowerCase();
      if (seen.has(lower)) throw bad("two columns cannot share a name");
      seen.add(lower);
      if (col.from !== undefined && (typeof col.from !== "string" || col.from === ""))
        throw bad("a renamed column must say which column it came from");
    }
    return cols;
  }

  function checkLinks(cols: Column[]): void {
    for (const col of cols)
      if (col.type === "link" && !col.table) throw bad("a link column needs the table it points at");
  }

  interface Pair {
    from: Column;
    to: Column;
  }

  const stated = (col: Column): string | null =>
    typeof col.from === "string" && col.from !== "" ? col.from : null;

  /** `TableSchema` carries no stable column identity, so `alter` is handed two
   *  lists of names. `Column.from` is the contract's way of removing the guess:
   *  a column that states where it came from IS that column, renamed.
   *
   *  When ANY column states a `from`, the plan is entirely explicit — a stated
   *  rename pairs with the column it names, the rest pair by name, and whatever
   *  is left over is an honest add and an honest drop. Position is never
   *  consulted, because a caller that took the trouble to say which column moved
   *  has thereby also said which ones did not. That is the whole point of the
   *  field: bundling a rename with a genuine add is otherwise re-read as a drop
   *  plus two adds, which destroys the renamed column's values.
   *
   *  Only when NO column states a `from` does the positional fallback run.
   *  Names present on both sides pair up; what is left pairs up in order, but
   *  ONLY when the two leftover lists are the same length — the shape a rename
   *  actually has. The tie is broken toward "renamed" rather than "dropped and
   *  added" on purpose: a wrong rename shows up as data in the wrong column,
   *  which the user can see and fix, and a wrong drop is gone. */
  function plan(cur: Column[], next: Column[]): { pairs: Pair[]; adds: Column[]; drops: Column[] } {
    const curByName = new Map(cur.map((c) => [c.name, c]));

    if (next.some((c) => stated(c) !== null)) {
      const pairs: Pair[] = [];
      const claimed = new Set<string>();
      // The stated renames first, so a column whose name is being taken over by
      // another column's rename cannot be paired with it by accident.
      for (const to of next) {
        const said = stated(to);
        if (said === null) continue;
        const from = curByName.get(said);
        if (!from) throw bad("a renamed column names a column that is not there");
        if (claimed.has(from.name)) throw bad("two columns cannot come from the same column");
        claimed.add(from.name);
        pairs.push({ from, to });
      }
      const adds: Column[] = [];
      for (const to of next) {
        if (stated(to) !== null) continue;
        const from = curByName.get(to.name);
        if (from && !claimed.has(from.name)) {
          claimed.add(from.name);
          pairs.push({ from, to });
        } else adds.push(to);
      }
      return { pairs, adds, drops: cur.filter((c) => !claimed.has(c.name)) };
    }

    const nextByName = new Map(next.map((c) => [c.name, c]));
    const pairs: Pair[] = [];
    for (const to of next) {
      const from = curByName.get(to.name);
      if (from) pairs.push({ from, to });
    }
    const leftCur = cur.filter((c) => !nextByName.has(c.name));
    const leftNext = next.filter((c) => !curByName.has(c.name));

    if (leftCur.length > 0 && leftCur.length === leftNext.length) {
      for (let i = 0; i < leftCur.length; i++) pairs.push({ from: leftCur[i]!, to: leftNext[i]! });
      return { pairs, adds: [], drops: [] };
    }
    return { pairs, adds: leftNext, drops: leftCur };
  }

  /** Display state the caller did not send is display state the caller did not
   *  mean to erase. `undefined` carries the old value across; an explicit
   *  `null` or `[]` is a change. Without this, renaming a column from the
   *  property menu would silently wipe its category colours. */
  function inherit(to: Column, from: Column | undefined): Column {
    const out: Column = { ...to };
    // `from` is a request field, never state. It says what this column WAS,
    // which stops being true the moment the alter lands, so it is dropped here
    // — before the DDL, the registry write or a schema read can see it.
    delete out.from;
    if (!from) return out;
    if (out.width === undefined) out.width = from.width ?? null;
    if (out.type === "categories" && out.options === undefined && from.type === "categories")
      out.options = from.options;
    if (out.type === "link" && from.type === "link") {
      if (out.table === undefined) out.table = from.table;
      if (out.show === undefined) out.show = from.show;
    }
    return out;
  }

  /** Every retype in the plan is one the matrix allows. Separate from the
   *  rebuild and called before it, because a refusal has to leave the table
   *  exactly as it was, and a rebuild that has already run cannot. */
  function checkRetypes(pairs: Pair[]): void {
    for (const p of pairs)
      if (p.from.type !== p.to.type && !retypeAllowed(p.from.type, p.to.type))
        throw bad(`a ${p.from.type} column cannot become a ${p.to.type} column directly`);
  }

  /** SQLite cannot rename, retype, reorder or drop a column in place, so this
   *  is the documented create / copy / drop / rename.
   *
   *  It runs INSIDE the caller's transaction, with foreign keys already off and
   *  every refusal already made. `alter` owns both, because an alter is one
   *  operation: a failure on the last thing it does — the table's own name —
   *  has to take the rebuild back with it, and a rebuild committed in a
   *  transaction of its own is already gone. */
  function rebuildIn(name: TableName, pairs: Pair[], columns: Column[]): void {
    const retyped = pairs.filter((p) => p.from.type !== p.to.type);
    const carried = pairs.filter((p) => p.from.type === p.to.type);

    // Retyped values come out before the table does, because they are converted
    // in here rather than by a SQL expression — one coercion path, not two.
    const moved = retyped.length
      ? db.all<Record<string, unknown>>(
          `SELECT "id", ${retyped.map((p) => quote(p.from.name)).join(", ")} FROM ${quote(name)}`,
        )
      : [];

    const tmp = `_alter_${name}`; // underscore-first, so a user name can never collide
    db.run(`DROP TABLE IF EXISTS ${quote(tmp)}`);
    db.run(
      `CREATE TABLE ${quote(tmp)} (\n  "id" INTEGER PRIMARY KEY${columns
        .map((c) => `,\n  ${columnDdl(c)}`)
        .join("")}\n)`,
    );
    const dest = carried.map((p) => `, ${quote(p.to.name)}`).join("");
    const src = carried.map((p) => `, ${quote(p.from.name)}`).join("");
    db.run(`INSERT INTO ${quote(tmp)} ("id"${dest}) SELECT "id"${src} FROM ${quote(name)}`);
    for (const p of retyped) {
      const sql = `UPDATE ${quote(tmp)} SET ${quote(p.to.name)} = ? WHERE "id" = ?`;
      for (const r of moved)
        db.run(sql, [convertCell(p.from.type, p.to.type, r[p.from.name]), Number(r["id"])]);
    }
    db.run(`DROP TABLE ${quote(name)}`);
    db.run(`ALTER TABLE ${quote(tmp)} RENAME TO ${quote(name)}`);
    writeColumns(name, columns);
  }

  /** Also inside the caller's transaction, and for the same reason. The name is
   *  checked against what is already there by `alter`, before anything runs. */
  function renameIn(from: TableName, to: TableName): void {
    db.run(`ALTER TABLE ${quote(from)} RENAME TO ${quote(to)}`);
    db.run(`UPDATE _tables SET name = ? WHERE name = ?`, [to, from]);
    db.run(`UPDATE _columns SET "table" = ? WHERE "table" = ?`, [to, from]);
    db.run(`UPDATE _options SET "table" = ? WHERE "table" = ?`, [to, from]);
    // A link column names the table it points at, and that name just changed.
    db.run(`UPDATE _columns SET link_table = ? WHERE link_table = ?`, [to, from]);
  }

  /* ---- CSV ---- */

  /** RFC 4180, read backwards: a field is wrapped when it holds a comma, a
   *  quote or a newline, and a quote inside one is doubled. Ported from the
   *  mock unchanged, which is why it is written by hand rather than split on
   *  commas. */
  function parseCsv(text: string): string[][] {
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip a BOM
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    let i = 0;

    while (i < src.length) {
      const ch = src[i]!;
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = ""; i++; continue;
      }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length && r.some((c) => c !== ""));
  }

  /* ---- raw ---- */

  const READS = /^\s*(?:select|with|pragma|explain|values)\b/i;
  const SCHEMA_CHANGE = /^\s*(?:create|drop|alter)\b/i;

  const sqlFailed = (err: unknown) =>
    new TableError("sql_error", err instanceof Error ? err.message : "the statement did not run");

  /* ---- the registry as refs ---- */

  /** Registry rows as `TableRef`s, counted. */
  function refs(): TableRef[] {
    reconcile();
    return db
      .all<{ name: string; kind: string; parent: string | null }>(
        `SELECT name, kind, parent FROM _tables ORDER BY created_at, name`,
      )
      .map((r) => {
        const name = String(r.name);
        let rows = 0;
        try {
          rows = Number(db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quote(name)}`)[0]?.n ?? 0);
        } catch {
          // Counted one table at a time, because the alternative is a UNION
          // built from the same names. A table that vanished mid-list is 0.
        }
        return {
          name,
          kind: r.kind === "sql" ? "sql" : "basic",
          rows,
          parent: r.parent === null || r.parent === "" ? null : String(r.parent),
        };
      });
  }

  /* ---- the interface ---- */

  const api: Tables & TableTree = {
    /** Layer one, for tables: every table and where it sits. pages.ts is handed
     *  this whole and filters it, so the workspace has one answer to "where does
     *  a table with no parent live" rather than two. */
    list: refs,

    setParent(name: TableName, parent: PageId | null): void {
      if (!registered(name)) {
        reconcile();
        if (!registered(name)) throw gone("no table by that name");
      }
      db.run(`UPDATE _tables SET parent = ? WHERE name = ?`, [parent, name]);
    },

    schema: readSchema,
    rows: readRows,

    insert(name: TableName, row: RowInput): RowId {
      const s = need(name);
      const { names, values } = bindRow(s, row);
      const sql = names.length
        ? `INSERT INTO ${quote(name)} (${names.map(quote).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`
        : `INSERT INTO ${quote(name)} DEFAULT VALUES`;
      let id: number;
      try {
        id = db.run(sql, values).lastInsertRowid;
      } catch (err) {
        throw sqlFailed(err);
      }
      learnAll(s, names, values);
      return id;
    },

    update(name: TableName, id: RowId, patch: RowInput): void {
      const s = need(name);
      const { names, values } = bindRow(s, patch);
      if (!names.length) return;
      const sql = `UPDATE ${quote(name)} SET ${names
        .map((n) => `${quote(n)} = ?`)
        .join(", ")} WHERE ${rowKey(s)} = ?`;
      let changes: number;
      try {
        changes = db.run(sql, [...values, id]).changes;
      } catch (err) {
        throw sqlFailed(err);
      }
      if (changes === 0) throw gone("no row by that id");
      learnAll(s, names, values);
    },

    remove(name: TableName, id: RowId): void {
      const s = need(name);
      let changes: number;
      try {
        changes = db.run(`DELETE FROM ${quote(name)} WHERE ${rowKey(s)} = ?`, [id]).changes;
      } catch (err) {
        throw sqlFailed(err);
      }
      if (changes === 0) throw gone("no row by that id");
    },

    create(schema: TableSchema): void {
      const name = userName(schema.name);
      if (schema.kind !== "basic")
        throw bad("only a typed table is created here; the agent's own tables are made in SQL");
      if (registered(name) || physical().includes(name)) throw bad("a table by that name already exists");
      const columns = checkColumns(schema.columns);
      checkLinks(columns);

      // `id INTEGER PRIMARY KEY` on every table, from the first one. It is a
      // rowid alias, costs nothing, is hidden in the grid, and is what makes a
      // link a real reference rather than a copied name that breaks on rename.
      const ddl = `CREATE TABLE ${quote(name)} (\n  "id" INTEGER PRIMARY KEY${columns
        .map((c) => `,\n  ${columnDdl(c)}`)
        .join("")}\n)`;
      db.tx(() => {
        db.run(ddl);
        db.run(`INSERT INTO _tables (name, kind) VALUES (?, 'basic')`, [name]);
        writeColumns(name, columns);
      });
    },

    /** One operation, and one transaction. Everything that can be refused is
     *  refused before a single statement is written — the retypes, the link
     *  targets and the table's own new name — because an alter that rebuilt the
     *  columns and then failed on the name has already applied every rename,
     *  retype and drop, and reports failure over the top of it. */
    alter(name: TableName, next: TableSchema): void {
      const cur = basic(name);
      if (next.kind !== "basic") throw bad("a typed table cannot become the agent's own");
      const wanted = checkColumns(next.columns);

      const { pairs, adds, drops } = plan(cur.columns, wanted);
      const was = new Map(pairs.map((p) => [p.to.name, p.from]));
      const columns = wanted.map((c) => inherit(c, was.get(c.name)));
      checkLinks(columns);

      const kept: Pair[] = [];
      for (const col of columns) {
        const before = was.get(col.name);
        if (before) kept.push({ from: before, to: col });
      }
      checkRetypes(kept);

      const target = userName(next.name);
      if (target !== name && (registered(target) || physical().includes(target)))
        throw bad("a table by that name already exists");

      const renamed = kept.some((p) => p.from.name !== p.to.name);
      const retyped = kept.some((p) => p.from.type !== p.to.type);
      const structural = renamed || retyped || adds.length > 0 || drops.length > 0;

      // `PRAGMA foreign_keys` cannot be changed inside a transaction, so the
      // toggle sits outside the one transaction the whole alter runs in. With
      // them on, dropping the old table fires ON DELETE against anything the
      // agent had pointed at it.
      const fk = Number(db.all<{ foreign_keys: number }>(`PRAGMA foreign_keys`)[0]?.foreign_keys ?? 0);
      if (fk) db.run(`PRAGMA foreign_keys = OFF`);
      try {
        db.tx(() => {
          // Order, width and category colours are registry state. Reordering a
          // column never touches the table, which is the whole reason position
          // lives in the registry rather than in the physical column order.
          if (structural) rebuildIn(name, kept, columns);
          else writeColumns(name, columns);
          if (target !== name) renameIn(name, target);
        });
      } finally {
        if (fk) db.run(`PRAGMA foreign_keys = ON`);
      }
    },

    drop(name: TableName): void {
      userName(name);
      if (!registered(name)) throw gone("no table by that name");
      db.tx(() => {
        db.run(`DROP TABLE IF EXISTS ${quote(name)}`);
        forget(name);
      });
    },

    /** `added` counts the rows that landed WHOLE — every field that held
     *  something stored something. A row is still inserted when one of its
     *  fields could not be read, because an import must never throw the user's
     *  data away, but it is not counted: `{ added }` reporting a row whose date
     *  was silently nulled as imported is the quiet half of a data loss.
     *
     *  Under-reporting is the safe direction — a count short of the file's row
     *  count is a prompt to look. The number the caller actually wants is two
     *  numbers, `{ added, lost }`, and `Tables.importCsv` cannot carry it:
     *  `contracts/types.ts` is frozen. This is the honest half of it. */
    importCsv(name: TableName, csv: string): { added: number } {
      const s = basic(name);
      const grid = parseCsv(csv);
      const header = grid[0];
      if (!header || grid.length < 2) return { added: 0 };

      // A header the table does not have becomes a text column. Dropping it
      // would throw away the user's data on the way in, which is the one thing
      // an import must never do — and text is the type every value survives.
      const known = new Set(s.columns.map((c) => c.name));
      const fresh = header.filter(
        (h, i) => h !== "" && h !== "id" && !known.has(h) && header.indexOf(h) === i,
      );
      if (fresh.length)
        api.alter(name, {
          ...s,
          columns: [...s.columns, ...fresh.map((h): Column => ({ name: h, type: "text" }))],
        });

      const now = basic(name);
      const cols = writable(now);
      // `id` is ignored rather than honoured: an import appends rows, it never
      // reaches in and rewrites one.
      const map = header.map((h, i) => (h !== "id" && cols.has(h) && header.indexOf(h) === i ? h : null));
      const used = map.filter((h): h is string => h !== null);
      if (!used.length) return { added: 0 };

      const sql = `INSERT INTO ${quote(name)} (${used.map(quote).join(", ")}) VALUES (${used
        .map(() => "?")
        .join(", ")})`;
      const met = new Map<string, Set<string>>(); // categories column -> labels seen
      let added = 0;

      db.tx(() => {
        for (const line of grid.slice(1)) {
          const values: SqlParam[] = [];
          let whole = true;
          map.forEach((col, i) => {
            if (col === null) return;
            const type = cols.get(col)!.type;
            const raw = line[i] ?? null;
            const stored = toStore(type, raw);
            // A field that held something and stored nothing did not import:
            // "04/03/26" into a date, "n/a" into a number. Blank is not loss —
            // empty and absent are the same claim, which is what makes the
            // round-trip lossless.
            if (stored === null && raw !== null && String(raw).trim() !== "") whole = false;
            if (type === "categories") {
              const set = met.get(col) ?? new Set<string>();
              for (const label of labelsOf(typeof stored === "string" ? stored : null)) set.add(label);
              met.set(col, set);
            }
            values.push(stored);
          });
          try {
            db.run(sql, values);
          } catch (err) {
            throw sqlFailed(err);
          }
          if (whole) added++;
        }
      });
      // One registry write per categories column rather than one per row.
      for (const [col, labels] of met) learnLabels(name, col, JSON.stringify([...labels]));
      return { added };
    },

    sql(query: string, params: SqlParam[] = []): SqlResult {
      if (typeof query !== "string" || query.trim() === "") throw bad("a statement is required");
      const bound = params.map(scalar);
      try {
        if (READS.test(query)) {
          const rows = db.all<Record<string, unknown>>(query, bound);
          // Column names come from the first row, because `Db` hands back
          // objects rather than a statement handle. A query that matched
          // nothing therefore reports no columns — the one place this module
          // knows less about a result than SQLite does.
          const columns = rows.length ? Object.keys(rows[0]!) : [];
          return {
            columns,
            rows: rows.map((r) => columns.map((c) => fromStore("text", r[c]))),
            changes: 0,
          };
        }
        const { changes } = db.run(query, bound);
        // The agent makes its own tables in SQL, so the registry learns about
        // them the same way it learns about anything else on disk.
        if (SCHEMA_CHANGE.test(query)) reconcile();
        return { columns: [], rows: [], changes };
      } catch (err) {
        if (err instanceof TableError) throw err;
        throw sqlFailed(err);
      }
    },
  };

  return api;
}
