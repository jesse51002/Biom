// SPDX-License-Identifier: AGPL-3.0-only
// The tables module's tests, weighted at `alter`.
//
// `alter` is where data gets lost silently: SQLite cannot rename, retype,
// reorder or drop a column in place, so every one of those is a rebuild of the
// whole table against populated rows, and a mistake in it looks exactly like a
// successful save. Most of what is below is that operation and its coercions.

import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { makeTables, TableError } from "../server/domain/tables.ts";
import type { Cell, ColumnType, Db, SqlParam, TableSchema, TableView } from "../contracts/types.ts";

/* ── a database, in memory ─────────────────────────────────────────────── */
//
// Deliberately not server/platform/db.ts: this file tests the registry and the
// SQL, and a fixture of its own is what keeps the two failures apart.

function memoryDb(): Db {
  const raw = new Database(":memory:");
  const with_ = <T>(sql: string, params: SqlParam[], fn: (st: any) => T): T => {
    const st = raw.prepare(sql);
    try {
      return fn(st);
    } finally {
      st.finalize(); // a live statement keeps a DROP TABLE from landing
    }
  };
  return {
    all: (sql, params = []) => with_(sql, params, (st) => st.all(...(params as never[]))) as never,
    run: (sql, params = []) =>
      with_(sql, params, (st) => {
        const r = st.run(...(params as never[]));
        return { changes: Number(r?.changes ?? 0), lastInsertRowid: Number(r?.lastInsertRowid ?? 0) };
      }),
    tx: (fn) => raw.transaction(fn)(),
    close: () => raw.close(),
  };
}

const fresh = () => makeTables(memoryDb());

const col = (name: string, type: ColumnType, extra: Record<string, unknown> = {}) =>
  ({ name, type, ...extra }) as TableSchema["columns"][number];

const table = (name: string, columns: TableSchema["columns"]): TableSchema =>
  ({ name, kind: "basic", columns });

/* ── every column type, stored and read back ───────────────────────────── */

const EVERY: [ColumnType, Cell, Cell][] = [
  //  type          written                       read back
  ["text", "Ashgrove", "Ashgrove"],
  ["number", 1240.5, 1240.5],
  ["checkbox", true, true],
  ["date", "2026-08-10", "2026-08-10"],
  ["categories", '["Render","Scaffold"]', '["Render","Scaffold"]'],
  ["person", "Dan", "Dan"],
  ["url", "https://example.co.uk/a?b=1", "https://example.co.uk/a?b=1"],
  ["email", "dan@example.co.uk", "dan@example.co.uk"],
  ["phone", "0113 496 1200", "0113 496 1200"],
  ["link", 3, 3],
  ["page", "clients/ashgrove", "clients/ashgrove"],
];

test("every column type round-trips", () => {
  const t = fresh();
  t.create(table("all", EVERY.map(([type]) => col(type, type, type === "link" ? { table: "jobs" } : {}))));

  const row: Record<string, Cell> = {};
  for (const [type, written] of EVERY) row[type] = written;
  const id = t.insert("all", row);

  const view = t.rows("all");
  expect(view.total).toBe(1);
  expect(view.rows[0]!.id).toBe(id);
  for (const [type, , expected] of EVERY) expect(view.rows[0]!.cells[type]).toEqual(expected);
});

test("a column carries its type, its width and its link target back out", () => {
  const t = fresh();
  t.create(
    table("quote_log", [
      col("job", "link", { table: "jobs", show: "name", width: 150 }),
      col("tier", "categories", { options: [{ label: "Standard", colour: "cyan" }], width: 190 }),
    ]),
  );
  const s = t.schema("quote_log")!;
  expect(s.kind).toBe("basic");
  expect(s.columns[0]).toEqual({ name: "job", type: "link", width: 150, table: "jobs", show: "name" });
  expect(s.columns[1]!.options).toEqual([{ label: "Standard", colour: "cyan" }]);
  expect(t.schema("nothing-here")).toBeNull();
});

/* ── categories: zero, one and many labels ─────────────────────────────── */

test("a categories value is any number of labels", () => {
  const t = fresh();
  t.create(table("rates", [col("tier", "categories")]));

  const none = t.insert("rates", { tier: null });
  const empty = t.insert("rates", { tier: "[]" });
  const one = t.insert("rates", { tier: '["Standard"]' });
  const many = t.insert("rates", { tier: '["Render","Scaffold","Heritage"]' });
  const typed = t.insert("rates", { tier: "Render; Scaffold" }); // as a person writes it

  const by = new Map(t.rows("rates").rows.map((r) => [r.id, r.cells["tier"]]));
  expect(by.get(none)).toBeNull();
  expect(by.get(empty)).toBe("[]");
  expect(by.get(one)).toBe('["Standard"]');
  expect(by.get(many)).toBe('["Render","Scaffold","Heritage"]');
  expect(by.get(typed)).toBe('["Render","Scaffold"]');
});

test("a label a write invents joins the registry with a palette role", () => {
  const t = fresh();
  t.create(table("rates", [col("tier", "categories", { options: [{ label: "Standard", colour: "cyan" }] })]));
  t.insert("rates", { tier: '["Standard","Heritage"]' });

  const options = t.schema("rates")!.columns[0]!.options!;
  expect(options.map((o) => o.label)).toEqual(["Standard", "Heritage"]);
  expect(options[0]!.colour).toBe("cyan"); // the declared one is not recoloured
  expect(options[1]!.colour).not.toBe(""); // and the new one is not left blank
  // A role, never a literal — a hex here is what breaks theming for a
  // generated table.
  expect(options[1]!.colour).not.toMatch(/^#|^rgb/);
});

test("matching a categories column means carrying the label", () => {
  const t = fresh();
  t.create(table("rates", [col("tier", "categories"), col("note", "text")]));
  t.insert("rates", { tier: '["Render","Scaffold"]', note: "a" });
  t.insert("rates", { tier: '["Render"]', note: "b" });
  t.insert("rates", { tier: '["Heritage"]', note: "c" });

  expect(t.rows("rates", { where: { tier: "Render" } }).rows.map((r) => r.cells["note"])).toEqual(["a", "b"]);
  expect(t.rows("rates", { where: { tier: "Heritage" } }).total).toBe(1);
  expect(t.rows("rates", { where: { tier: "Nothing" } }).total).toBe(0);
});

/* ── alter: add, rename, retype, reorder, drop, against rows ───────────── */

function seeded() {
  const t = fresh();
  t.create(
    table("jobs", [
      col("name", "text", { width: 170 }),
      col("area", "number"),
      col("done", "checkbox"),
    ]),
  );
  const a = t.insert("jobs", { name: "Ashgrove", area: 240, done: true });
  const b = t.insert("jobs", { name: "Bell Lane", area: 96.5, done: false });
  return { t, a, b };
}

test("a rename keeps the rows, their ids and the column's width", () => {
  const { t, a, b } = seeded();
  t.alter("jobs", table("jobs", [col("site", "text"), col("area", "number"), col("done", "checkbox")]));

  const view = t.rows("jobs", { order: [{ column: "site", dir: "asc" }] });
  expect(view.schema.columns.map((c) => c.name)).toEqual(["site", "area", "done"]);
  expect(view.rows.map((r) => r.id)).toEqual([a, b]);
  expect(view.rows.map((r) => r.cells["site"])).toEqual(["Ashgrove", "Bell Lane"]);
  expect(view.rows.map((r) => r.cells["area"])).toEqual([240, 96.5]);
  expect(view.schema.columns[0]!.width).toBe(170); // display state is not collateral
});

test("adding and dropping columns leaves the rest of the row alone", () => {
  const { t, a } = seeded();
  t.alter(
    "jobs",
    table("jobs", [col("name", "text"), col("area", "number"), col("done", "checkbox"), col("owner", "person")]),
  );
  t.alter("jobs", table("jobs", [col("name", "text"), col("done", "checkbox"), col("owner", "person")]));

  const view = t.rows("jobs");
  expect(view.schema.columns.map((c) => c.name)).toEqual(["name", "done", "owner"]);
  expect(view.rows.map((r) => r.id)).toEqual([a, view.rows[1]!.id]);
  expect(view.rows[0]!.cells).toEqual({ name: "Ashgrove", done: true, owner: null });
  expect(view.rows[0]!.cells["area"]).toBeUndefined();
});

test("a drop and an add in ONE call is read as a rename, deliberately", () => {
  // TableSchema carries no stable column identity, so this call is ambiguous:
  // the same two lists describe "area was renamed to owner" and "area went,
  // owner arrived". It resolves to the rename, because a wrong rename is data
  // in the wrong column — visible, and fixable — and a wrong drop is gone.
  // A caller that means both should send them as two calls, as the test above
  // does and as the property menu does.
  const { t } = seeded();
  t.alter("jobs", table("jobs", [col("name", "text"), col("owner", "person"), col("done", "checkbox")]));
  expect(t.rows("jobs").rows[0]!.cells["owner"]).toBe("240");
});

/* ── alter: `from`, the explicit rename ────────────────────────────────── */
//
// The guess above is the FALLBACK. `Column.from` is the contract's way of
// saying "this column is that one, renamed", and honouring it is what stops a
// rename bundled with an add being re-read as a drop plus two adds — which is
// the shape that silently destroys the renamed column's values.

test("`from` is the rename, even when an add is bundled into the same call", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text"), col("area", "number")]));
  t.insert("jobs", { name: "Ashgrove", area: 240 });

  t.alter(
    "jobs",
    table("jobs", [
      col("name", "text"),
      col("size", "number", { from: "area" }),
      col("owner", "person"),
    ]),
  );

  const view = t.rows("jobs");
  expect(view.schema.columns.map((c) => c.name)).toEqual(["name", "size", "owner"]);
  expect(view.rows[0]!.cells).toEqual({ name: "Ashgrove", size: 240, owner: null });
});

test("`from` anywhere turns every other leftover into an honest add and drop", () => {
  // Two left over on each side, which the positional guess would pair up. An
  // explicit rename says which one moved, so `area` is a drop and `owner` is an
  // add — not `area` renamed to `owner`.
  const { t } = seeded();
  t.alter(
    "jobs",
    table("jobs", [
      col("site", "text", { from: "name" }),
      col("done", "checkbox"),
      col("owner", "person"),
    ]),
  );

  const view = t.rows("jobs");
  expect(view.schema.columns.map((c) => c.name)).toEqual(["site", "done", "owner"]);
  expect(view.rows[0]!.cells).toEqual({ site: "Ashgrove", done: true, owner: null });
});

test("`from` naming a column that is not there is refused, not guessed at", () => {
  const { t } = seeded();
  expect(() =>
    t.alter("jobs", table("jobs", [col("site", "text", { from: "nosuch" })])),
  ).toThrow(TableError);
  // and the refusal leaves the table exactly as it was
  expect(t.schema("jobs")!.columns.map((c) => c.name)).toEqual(["name", "area", "done"]);
  expect(t.rows("jobs").rows[0]!.cells["name"]).toBe("Ashgrove");
});

test("two columns cannot claim the same `from`", () => {
  const { t } = seeded();
  expect(() =>
    t.alter(
      "jobs",
      table("jobs", [col("a", "text", { from: "name" }), col("b", "text", { from: "name" })]),
    ),
  ).toThrow(TableError);
  expect(t.schema("jobs")!.columns.map((c) => c.name)).toEqual(["name", "area", "done"]);
});

test("`from` is a request field and never becomes state", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text"), col("area", "number")]));
  t.alter("jobs", table("jobs", [col("name", "text"), col("size", "number", { from: "area" })]));
  for (const c of t.schema("jobs")!.columns) expect(c.from).toBeUndefined();
});

test("an explicit rename carries the width and the category colours across", () => {
  const t = fresh();
  t.create(
    table("rates", [
      col("tier", "categories", {
        options: [{ label: "Standard", colour: "cyan" }],
        width: 190,
      }),
    ]),
  );
  t.insert("rates", { tier: '["Standard"]' });
  t.alter("rates", table("rates", [col("band", "categories", { from: "tier" })]));

  const s = t.schema("rates")!;
  expect(s.columns[0]!.name).toBe("band");
  expect(s.columns[0]!.width).toBe(190);
  expect(s.columns[0]!.options).toEqual([{ label: "Standard", colour: "cyan" }]);
  expect(t.rows("rates").rows[0]!.cells["band"]).toBe('["Standard"]');
});

/* ── alter: one transaction, or none of it ─────────────────────────────── */

test("an alter that fails on the new table name leaves the columns untouched", () => {
  const { t, a } = seeded();
  t.create(table("work", [col("x", "text")]));

  expect(() =>
    t.alter(
      "jobs",
      table("work", [col("name", "text"), col("area", "text"), col("done", "checkbox")]),
    ),
  ).toThrow(TableError);

  // The retype is part of the same alter, so it has to roll back with the name.
  const s = t.schema("jobs")!;
  expect(s.columns.map((c) => [c.name, c.type])).toEqual([
    ["name", "text"], ["area", "number"], ["done", "checkbox"],
  ]);
  expect(t.rows("jobs").rows.find((r) => r.id === a)!.cells)
    .toEqual({ name: "Ashgrove", area: 240, done: true });
  expect(t.list().map((r) => r.name).sort()).toEqual(["jobs", "work"]);
});

test("an alter that fails on an illegal table name leaves the columns untouched", () => {
  const { t, a } = seeded();
  expect(() =>
    t.alter(
      "jobs",
      table("_secret", [col("name", "text"), col("area", "text"), col("done", "checkbox")]),
    ),
  ).toThrow(TableError);

  expect(t.schema("jobs")!.columns.map((c) => c.type)).toEqual(["text", "number", "checkbox"]);
  expect(t.rows("jobs").rows.find((r) => r.id === a)!.cells["area"]).toBe(240);
});

test("a reorder moves the columns and not the data", () => {
  const { t, a, b } = seeded();
  t.alter("jobs", table("jobs", [col("done", "checkbox"), col("name", "text"), col("area", "number")]));

  const view = t.rows("jobs");
  expect(view.schema.columns.map((c) => c.name)).toEqual(["done", "name", "area"]);
  expect(Object.keys(view.rows[0]!.cells)).toEqual(["done", "name", "area"]);
  expect(view.rows.map((r) => r.id)).toEqual([a, b]);
  expect(view.rows.map((r) => r.cells["name"])).toEqual(["Ashgrove", "Bell Lane"]);
  expect(view.rows.map((r) => r.cells["area"])).toEqual([240, 96.5]);
});

test("a categories column keeps its colours through a rename", () => {
  const t = fresh();
  t.create(
    table("rates", [
      col("tier", "categories", {
        options: [{ label: "Standard", colour: "cyan" }, { label: "Premium", colour: "magenta" }],
      }),
    ]),
  );
  t.insert("rates", { tier: '["Premium"]' });
  // The property menu sends the schema back without re-stating the options.
  t.alter("rates", table("rates", [col("band", "categories")]));

  const s = t.schema("rates")!;
  expect(s.columns[0]!.name).toBe("band");
  expect(s.columns[0]!.options).toEqual([
    { label: "Standard", colour: "cyan" },
    { label: "Premium", colour: "magenta" },
  ]);
  expect(t.rows("rates").rows[0]!.cells["band"]).toBe('["Premium"]');
});

test("renaming the table itself carries the rows and the registry with it", () => {
  const { t, a } = seeded();
  t.alter("jobs", table("work", [col("name", "text"), col("area", "number"), col("done", "checkbox")]));

  expect(t.schema("jobs")).toBeNull();
  const view = t.rows("work");
  expect(view.rows[0]!.id).toBe(a);
  expect(view.rows[0]!.cells["name"]).toBe("Ashgrove");
  expect(t.list().map((r) => r.name)).toEqual(["work"]);
});

/* ── retyping ──────────────────────────────────────────────────────────── */

const SAMPLE: Record<ColumnType, Cell> = {
  text: "Ashgrove",
  number: 1240,
  checkbox: true,
  date: "2026-08-10",
  categories: '["Render","Scaffold"]',
  person: "Dan",
  url: "example.co.uk",
  email: "dan@example.co.uk",
  phone: "0113 496 1200",
  link: 3,
  page: "clients/ashgrove",
};

const ALL_TYPES = Object.keys(SAMPLE) as ColumnType[];

/** Written out by hand rather than derived, so this asserts the intended
 *  matrix rather than restating the implementation's opinion of it. */
const REFUSED = new Set([
  "number>date", "number>categories",
  "checkbox>date", "checkbox>categories", "checkbox>link",
  "date>number", "date>checkbox", "date>categories", "date>link",
  "categories>number", "categories>checkbox", "categories>date", "categories>link",
  "link>checkbox", "link>date", "link>categories",
]);

test("every retype pair either converts or refuses, and nothing in between", () => {
  for (const from of ALL_TYPES) {
    for (const to of ALL_TYPES) {
      if (from === to) continue;
      const t = fresh();
      t.create(table("t", [col("c", from, from === "link" ? { table: "jobs" } : {})]));
      t.insert("t", { c: SAMPLE[from] });

      const next = table("t", [col("c", to, to === "link" ? { table: "jobs" } : {})]);
      const pair = `${from}>${to}`;
      if (REFUSED.has(pair)) {
        expect(() => t.alter("t", next)).toThrow();
        // and the refusal leaves the column exactly as it was
        expect(t.schema("t")!.columns[0]!.type).toBe(from);
        expect(t.rows("t").rows[0]!.cells["c"]).toEqual(SAMPLE[from]);
      } else {
        t.alter("t", next);
        expect(t.schema("t")!.columns[0]!.type).toBe(to);
        expect(t.rows("t").total).toBe(1);
      }
    }
  }
});

test("the conversions a retype promises", () => {
  const check = (from: ColumnType, to: ColumnType, wrote: Cell, expected: Cell) => {
    const t = fresh();
    t.create(table("t", [col("c", from, from === "link" ? { table: "jobs" } : {})]));
    t.insert("t", { c: wrote });
    t.alter("t", table("t", [col("c", to, to === "link" ? { table: "jobs" } : {})]));
    expect(t.rows("t").rows[0]!.cells["c"]).toEqual(expected);
  };

  check("text", "number", "£1,240.00", 1240);
  check("text", "number", "not a number", null); // lossy, and it says so in the doc comment
  check("text", "date", "10 Aug 2026", "2026-08-10");
  check("text", "date", "2026-08-10", "2026-08-10");
  check("text", "checkbox", "yes", true);
  check("text", "checkbox", "anything else", false);
  check("text", "categories", "Render; Scaffold", '["Render","Scaffold"]');
  check("text", "link", "42", 42);
  check("categories", "text", '["Render","Scaffold"]', "Render; Scaffold");
  check("checkbox", "text", true, "true");
  check("checkbox", "number", true, 1);
  check("number", "checkbox", 0, false);
  check("number", "checkbox", 3, true);
  check("number", "link", 7, 7);
  check("link", "number", 7, 7);
  check("date", "text", "2026-08-10", "2026-08-10");
  check("url", "email", "dan@example.co.uk", "dan@example.co.uk"); // one storage, one editor
});

test("text and categories round-trip through each other", () => {
  const t = fresh();
  t.create(table("t", [col("c", "categories")]));
  t.insert("t", { c: '["Render","Scaffold"]' });
  t.alter("t", table("t", [col("c", "text")]));
  expect(t.rows("t").rows[0]!.cells["c"]).toBe("Render; Scaffold");
  t.alter("t", table("t", [col("c", "categories")]));
  expect(t.rows("t").rows[0]!.cells["c"]).toBe('["Render","Scaffold"]');
});

test("a retype converts every row, not the first one", () => {
  const t = fresh();
  t.create(table("t", [col("when", "text"), col("keep", "text")]));
  const wrote = ["2026-08-10", "10 Aug 2026", "", "not a date", "2026-01-01"];
  wrote.forEach((w, i) => t.insert("t", { when: w, keep: `row ${i}` }));

  t.alter("t", table("t", [col("when", "date"), col("keep", "text")]));

  const rows = t.rows("t", { order: [{ column: "keep", dir: "asc" }] }).rows;
  expect(rows.map((r) => r.cells["when"])).toEqual([
    "2026-08-10", "2026-08-10", null, null, "2026-01-01",
  ]);
  expect(rows.map((r) => r.cells["keep"])).toEqual(["row 0", "row 1", "row 2", "row 3", "row 4"]);
});

test("renaming a table re-points the link columns aimed at it", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));
  t.create(table("quote_log", [col("job", "link", { table: "jobs", show: "name" })]));
  const job = t.insert("jobs", { name: "Ashgrove" });
  t.insert("quote_log", { job });

  t.alter("jobs", table("work", [col("name", "text")]));

  expect(t.schema("quote_log")!.columns[0]!.table).toBe("work");
  expect(t.rows("quote_log").rows[0]!.cells["job"]).toBe(job);
});

test("a retype keeps every other column intact", () => {
  const { t, a } = seeded();
  t.alter("jobs", table("jobs", [col("name", "text"), col("area", "text"), col("done", "checkbox")]));
  const row = t.rows("jobs").rows.find((r) => r.id === a)!;
  expect(row.cells).toEqual({ name: "Ashgrove", area: "240", done: true });
});

/* ── the date and checkbox constraints, which are the only two ─────────── */

test("only date and checkbox constrain what the database will hold", () => {
  const t = fresh();
  t.create(table("t", [col("when", "date"), col("ok", "checkbox"), col("site", "url")]));
  t.insert("t", { when: "not a date", ok: "maybe", site: "definitely not a url" });
  const cells = t.rows("t").rows[0]!.cells;
  expect(cells["when"]).toBeNull(); // refused by the type, before the CHECK sees it
  expect(cells["ok"]).toBe(false);
  expect(cells["site"]).toBe("definitely not a url"); // kept: a paste is not a truth claim

  // The CHECK is real, and the agent's raw SQL meets it.
  expect(() => t.sql(`INSERT INTO "t" ("when") VALUES ('nope')`)).toThrow();
});

/* ── a date is a calendar date ─────────────────────────────────────────── */

/** What a spreadsheet actually puts in a CSV, and what each one means. The
 *  slash forms are read day-first, which is the house form — see the comment
 *  over `asDate` in the module. */
const SPELLINGS: [string, string | null][] = [
  ["2026-03-04", "2026-03-04"],
  ["2026-3-4", "2026-03-04"],
  ["2026/03/04", "2026-03-04"],
  ["2026-03-04T00:00:00Z", "2026-03-04"],
  ["2026-03-04T13:45:00+01:00", "2026-03-04"],
  ["2026-03-04 00:00:00", "2026-03-04"],
  ["04/03/2026", "2026-03-04"],
  ["4/3/2026", "2026-03-04"],
  ["04.03.2026", "2026-03-04"],
  ["04-03-2026", "2026-03-04"],
  ["04/03/26", "2026-03-04"],
  ["25/12/2026", "2026-12-25"], // unambiguous, and still day-first
  ["10 Aug 2026", "2026-08-10"],
  ["10th Aug 2026", "2026-08-10"],
  ["10-Aug-2026", "2026-08-10"],
  ["10 August 2026", "2026-08-10"],
  ["Aug 10, 2026", "2026-08-10"],
  ["August 10 2026", "2026-08-10"],
  ["Sept 9, 2026", "2026-09-09"],
  ["  2026-03-04  ", "2026-03-04"],
  ["30/02/2026", null], // a day that does not exist is not a date
  ["2026-13-01", null],
  ["not a date", null],
  ["", null],
  ["0113 496 1200", null],
];

test("the date spellings a spreadsheet emits, and the ones that are not dates", () => {
  const t = fresh();
  t.create(table("t", [col("when", "date"), col("keep", "text")]));
  SPELLINGS.forEach(([wrote], i) => t.insert("t", { when: wrote, keep: `row ${i}` }));

  const rows = t.rows("t", { order: [{ column: "keep", dir: "asc" }] }).rows;
  const got = SPELLINGS.map((_, i) => rows.find((r) => r.cells["keep"] === `row ${i}`)!.cells["when"]);
  expect(got).toEqual(SPELLINGS.map(([, expected]) => expected));
});

test("a date does not move west of Greenwich", () => {
  // Parsing an instant and re-reading it in local components is what shifts a
  // date a day. A date has no zone, so nothing here may consult one.
  const was = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    const t = fresh();
    t.create(table("t", [col("when", "date"), col("keep", "text")]));
    t.insert("t", { when: "2026-03-04T00:00:00Z", keep: "a" });
    t.insert("t", { when: "2026-03-04T23:30:00Z", keep: "b" });
    t.insert("t", { when: "2026-03-04", keep: "c" });
    t.insert("t", { when: "04/03/2026", keep: "d" });
    const rows = t.rows("t", { order: [{ column: "keep", dir: "asc" }] }).rows;
    expect(rows.map((r) => r.cells["when"])).toEqual([
      "2026-03-04", "2026-03-04", "2026-03-04", "2026-03-04",
    ]);
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

/* ── CSV ───────────────────────────────────────────────────────────────── */

/** What the client writes on export — the mock's `toCSV`, which is the other
 *  half of the round-trip this module has to survive. */
function toCsv(view: TableView): string {
  const esc = (v: Cell) => {
    const s = v === true ? "true" : v === false ? "false" : String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = view.schema.columns;
  return [
    cols.map((c) => esc(c.name)).join(","),
    ...view.rows.map((r) => cols.map((c) => esc(r.cells[c.name] ?? null)).join(",")),
  ].join("\r\n");
}

const TRICKY: TableSchema["columns"] = [
  { name: "name", type: "text" },
  { name: "note", type: "text" },
  { name: "area", type: "number" },
  { name: "done", type: "checkbox" },
  { name: "when", type: "date" },
  { name: "tier", type: "categories" },
];

test("export then import is lossless, commas, quotes and newlines included", () => {
  const t = fresh();
  t.create(table("a", TRICKY));
  t.create(table("b", TRICKY));

  const rows = [
    { name: "Ashgrove, rear", note: 'he said "no"', area: 240, done: true, when: "2026-08-10", tier: '["Render"]' },
    { name: "Bell Lane", note: "line one\nline two", area: 96.5, done: false, when: null, tier: '["Render","Scaffold"]' },
    { name: "Empty", note: null, area: null, done: false, when: null, tier: null },
    { name: "Semicolons; inside", note: "a,b,c", area: 0, done: true, when: "2026-01-01", tier: "[]" },
  ];
  for (const r of rows) t.insert("a", r);

  const csv = toCsv(t.rows("a"));
  expect(t.importCsv("b", csv)).toEqual({ added: 4 });

  const before = t.rows("a").rows.map((r) => r.cells);
  const after = t.rows("b").rows.map((r) => r.cells);
  expect(after).toEqual(before);
});

test("an unknown header becomes a text column rather than being thrown away", () => {
  const t = fresh();
  t.create(table("t", [col("name", "text")]));
  t.insert("t", { name: "already here" });

  const added = t.importCsv("t", 'name,extra\r\nAshgrove,"kept, verbatim"');
  expect(added).toEqual({ added: 1 });

  const view = t.rows("t");
  expect(view.schema.columns.map((c) => c.name)).toEqual(["name", "extra"]);
  expect(view.rows.map((r) => r.cells)).toEqual([
    { name: "already here", extra: null },
    { name: "Ashgrove", extra: "kept, verbatim" },
  ]);
});

test("a header with nothing under it imports nothing", () => {
  const t = fresh();
  t.create(table("t", [col("name", "text")]));
  expect(t.importCsv("t", "name\r\n")).toEqual({ added: 0 });
  expect(t.importCsv("t", "")).toEqual({ added: 0 });
  expect(t.rows("t").total).toBe(0);
});

test("a row that did not import whole is not counted as added", () => {
  // `added` is the honest number the return shape can carry: rows that landed
  // with nothing dropped. The row itself is still kept — an import never throws
  // the user's data away — but a value that could not be read is not silently
  // reported as imported.
  const t = fresh();
  t.create(table("t", [col("name", "text"), col("when", "date"), col("area", "number")]));

  const r = t.importCsv(
    "t",
    ["name,when,area", "Ashgrove,04/03/2026,240", "Bell Lane,not a date,96.5", "Carr Mill,,n/a"].join("\r\n"),
  );
  expect(r).toEqual({ added: 1 });

  const view = t.rows("t", { order: [{ column: "name", dir: "asc" }] });
  expect(view.total).toBe(3); // nothing was thrown away
  expect(view.rows.map((row) => row.cells["when"])).toEqual(["2026-03-04", null, null]);
  expect(view.rows.map((row) => row.cells["area"])).toEqual([240, 96.5, null]);
});

test("a CSV date a spreadsheet wrote imports as the day it says", () => {
  const t = fresh();
  t.create(table("t", [col("name", "text"), col("when", "date")]));
  expect(t.importCsv("t", "name,when\r\nAshgrove,10 Aug 2026\r\nBell Lane,25/12/2026"))
    .toEqual({ added: 2 });
  expect(t.rows("t", { order: [{ column: "name", dir: "asc" }] }).rows.map((r) => r.cells["when"]))
    .toEqual(["2026-08-10", "2026-12-25"]);
});

test("an id column in a CSV is ignored, because an import appends", () => {
  const t = fresh();
  t.create(table("t", [col("name", "text")]));
  const first = t.insert("t", { name: "first" });
  t.importCsv("t", `id,name\r\n${first},overwritten?`);
  expect(t.rows("t").rows.map((r) => r.cells["name"])).toEqual(["first", "overwritten?"]);
});

/* ── querying ──────────────────────────────────────────────────────────── */

test("where, order, limit and offset, with total counting the match", () => {
  const { t } = seeded();
  t.insert("jobs", { name: "Carr Mill", area: 240, done: true });

  expect(t.rows("jobs", { where: { area: 240 } }).total).toBe(2);
  expect(t.rows("jobs", { where: { done: true } }).rows.map((r) => r.cells["name"]))
    .toEqual(["Ashgrove", "Carr Mill"]);

  const page = t.rows("jobs", { order: [{ column: "name", dir: "desc" }], limit: 2 });
  expect(page.rows.map((r) => r.cells["name"])).toEqual(["Carr Mill", "Bell Lane"]);
  expect(page.total).toBe(3); // what matched, not what was returned

  const rest = t.rows("jobs", { order: [{ column: "name", dir: "desc" }], offset: 2 });
  expect(rest.rows.map((r) => r.cells["name"])).toEqual(["Ashgrove"]);
});

test("a null in a where clause means the cell is empty", () => {
  const t = fresh();
  t.create(table("t", [col("name", "text"), col("owner", "person")]));
  t.insert("t", { name: "a", owner: "Dan" });
  t.insert("t", { name: "b", owner: null });
  expect(t.rows("t", { where: { owner: null } }).rows.map((r) => r.cells["name"])).toEqual(["b"]);
});

/* ── rows ──────────────────────────────────────────────────────────────── */

test("insert, update and remove, by the id the row carries", () => {
  const { t, a, b } = seeded();
  t.update("jobs", a, { area: 300 });
  expect(t.rows("jobs", { where: { name: "Ashgrove" } }).rows[0]!.cells["area"]).toBe(300);

  t.remove("jobs", b);
  expect(t.rows("jobs").total).toBe(1);

  expect(() => t.update("jobs", 999, { area: 1 })).toThrow(TableError);
  expect(() => t.remove("jobs", 999)).toThrow(TableError);
});

test("a blank row is a row", () => {
  const { t } = seeded();
  const id = t.insert("jobs", {});
  const row = t.rows("jobs").rows.find((r) => r.id === id)!;
  expect(row.cells).toEqual({ name: null, area: null, done: false });
});

/* ── the tree ──────────────────────────────────────────────────────────── */
//
// A table sits in the tree beside pages rather than in a section of its own, so
// the registry has to carry where it sits. These are the table half; the half
// where a page merges its own children with these belongs to pages.ts.

test("a table's parent round-trips, and starts unfiled", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));
  // A table nobody placed is unfiled, which is a value and not a missing one.
  // What unfiled MEANS for the tree is pages.ts's call, not this module's.
  expect(t.list()[0]!.parent).toBeNull();

  t.setParent("jobs", "job-board");
  expect(t.list()[0]!.parent).toBe("job-board");

  // and it can be taken back out of the tree
  t.setParent("jobs", null);
  expect(t.list()[0]!.parent).toBeNull();

  expect(() => t.setParent("nosuch", "home")).toThrow(TableError);
});

test("list answers with full refs, counted and placed", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));
  t.create(table("rates", [col("tier", "text")]));
  t.create(table("elsewhere", [col("a", "text")]));
  t.insert("jobs", { name: "Ashgrove" });
  t.insert("jobs", { name: "Fenton" });

  t.setParent("jobs", "home");
  t.setParent("elsewhere", "pricing-rules");

  const by = new Map(t.list().map((r) => [r.name, r]));
  expect(by.get("jobs")).toEqual({ name: "jobs", kind: "basic", rows: 2, parent: "home" });
  expect(by.get("rates")).toEqual({ name: "rates", kind: "basic", rows: 0, parent: null });
  expect(by.get("elsewhere")).toEqual({ name: "elsewhere", kind: "basic", rows: 0, parent: "pricing-rules" });
});

test("a table the agent made in raw SQL joins the registry unfiled", () => {
  const t = fresh();
  t.sql(`CREATE TABLE "totals" (job TEXT)`);
  expect(t.list().map((r) => [r.name, r.kind, r.parent])).toEqual([["totals", "sql", null]]);
});

test("renaming a table keeps it where it was in the tree", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));
  t.setParent("jobs", "home");
  t.alter("jobs", table("work", [col("name", "text")]));
  expect(t.list().map((r) => [r.name, r.parent])).toEqual([["work", "home"]]);
});

test("dropping a table takes its place in the tree with it", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));
  t.setParent("jobs", "home");
  t.drop("jobs");
  // The name is free again, and it comes back unfiled rather than remembering
  // where a different table of the same name used to sit.
  t.create(table("jobs", [col("name", "text")]));
  expect(t.list()[0]!.parent).toBeNull();
});

test("a registry made before tables joined the tree is widened in place", () => {
  // The shape a vault seeded by an older framework is in: `_tables` with no
  // `parent`. CREATE TABLE IF NOT EXISTS does nothing to it, so the migration
  // is the only thing standing between that vault and every query below.
  const db = memoryDb();
  db.run(`CREATE TABLE _tables (
            name TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('basic','sql')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`);
  db.run(`CREATE TABLE "jobs" ("id" INTEGER PRIMARY KEY, name TEXT)`);
  db.run(`INSERT INTO _tables (name, kind) VALUES ('jobs', 'basic')`);

  const t = makeTables(db);
  expect(t.list().map((r) => [r.name, r.parent])).toEqual([["jobs", null]]);
  t.setParent("jobs", "home");
  expect(t.list().map((r) => [r.name, r.parent])).toEqual([["jobs", "home"]]);
});

/* ── the agent's own tables ────────────────────────────────────────────── */

test("a table the agent made is listed, described and readable", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));
  t.sql(`CREATE TABLE "totals" (job TEXT, hours REAL)`);
  t.sql(`INSERT INTO "totals" (job, hours) VALUES (?, ?)`, ["Ashgrove", 12.5]);

  const listed = t.list();
  expect(listed.map((r) => [r.name, r.kind, r.rows, r.parent])).toEqual([
    ["jobs", "basic", 0, null],
    ["totals", "sql", 1, null],
  ]);

  const s = t.schema("totals")!;
  expect(s.kind).toBe("sql");
  expect(s.columns.map((c) => [c.name, c.type])).toEqual([["job", "text"], ["hours", "number"]]);
  expect(t.rows("totals").rows[0]!.cells).toEqual({ job: "Ashgrove", hours: 12.5 });

  // It has no column metadata to alter, and the grid is told so.
  expect(() => t.alter("totals", table("totals", [col("job", "text")]))).toThrow(TableError);
});

test("the registry follows the database when the agent drops a table underneath it", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));
  t.sql(`DROP TABLE "jobs"`);
  expect(t.list()).toEqual([]);
  expect(t.schema("jobs")).toBeNull();
});

test("sql answers with columns, rows and a change count", () => {
  const { t } = seeded();
  const read = t.sql(`SELECT name, area FROM jobs ORDER BY name`);
  expect(read.columns).toEqual(["name", "area"]);
  expect(read.rows).toEqual([["Ashgrove", 240], ["Bell Lane", 96.5]]);
  expect(read.changes).toBe(0);

  const wrote = t.sql(`UPDATE jobs SET area = ? WHERE name = ?`, [1, "Ashgrove"]);
  expect(wrote.changes).toBe(1);
  expect(() => t.sql(`SELECT * FROM nope`)).toThrow(TableError);
});

/* ── what it refuses ───────────────────────────────────────────────────── */

test("the names and shapes it will not accept", () => {
  const t = fresh();
  t.create(table("jobs", [col("name", "text")]));

  expect(() => t.create(table("jobs", [col("a", "text")]))).toThrow(TableError);
  expect(() => t.create(table("_secret", [col("a", "text")]))).toThrow(TableError);
  expect(() => t.create(table("x", [col("id", "text")]))).toThrow(TableError);
  expect(() => t.create(table("x", [col("a", "text"), col("A", "number")]))).toThrow(TableError);
  expect(() => t.create(table("x", [col("a", "nonsense" as ColumnType)]))).toThrow(TableError);
  expect(() => t.create(table("x", [col("a", "link")]))).toThrow(TableError); // no target
  expect(() => t.create({ name: "x", kind: "sql", columns: [] })).toThrow(TableError);

  expect(() => t.insert("jobs", { nothere: "x" })).toThrow(TableError);
  expect(() => t.insert("nosuch", { name: "x" })).toThrow(TableError);
  expect(() => t.rows("jobs", { where: { nothere: 1 } })).toThrow(TableError);
  expect(() => t.rows("jobs", { order: [{ column: "nothere", dir: "asc" }] })).toThrow(TableError);
  expect(() => t.drop("nosuch")).toThrow(TableError);
});

test("a name is quoted, not concatenated", () => {
  const t = fresh();
  // A column name that would end an identifier, and one with a space in it.
  t.create(table("odd", [col('he said "hi"', "text"), col("rate per m2", "number")]));
  t.insert("odd", { 'he said "hi"': "kept", "rate per m2": 4 });
  expect(t.rows("odd").rows[0]!.cells).toEqual({ 'he said "hi"': "kept", "rate per m2": 4 });
  t.alter("odd", table("odd", [col('he said "hi"', "text"), col("rate per m2", "text")]));
  expect(t.rows("odd").rows[0]!.cells["rate per m2"]).toBe("4");
});

test("dropping a table takes its registry with it", () => {
  const t = fresh();
  t.create(table("rates", [col("tier", "categories", { options: [{ label: "A", colour: "cyan" }] })]));
  t.drop("rates");
  expect(t.list()).toEqual([]);
  expect(t.schema("rates")).toBeNull();
  // and the name is free again
  t.create(table("rates", [col("tier", "text")]));
  expect(t.schema("rates")!.columns[0]!.type).toBe("text");
});
