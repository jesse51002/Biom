// SPDX-License-Identifier: AGPL-3.0-only
// THE GRID PART KIND — the document's own table — from the file to the mirror.
//
// A grid is the fifth part kind and the first whose value is not a string: its
// rows are a list of lists of markdown strings in `content.yaml`, drawn as a
// board by `plugins/biom-grid/grid.js`, edited a cell at a time, written back whole over
// `section.write`, and projected into the mirror as a markdown table again. The
// doc plugin makes one out of every markdown table it finds in a prose part.
// Each of those is a place the kind has to be spelled the same way, and this
// file walks them in the order a page meets them:
//
//   1. the guard — `section.write` takes rows, and refuses a mix of rows and text
//   2. the codec — rows read back square, written one row per line, `data` refused
//   3. the reader — a grid resolves to a `grid` part with raw cells and its scopes
//   4. `writeSlot` — rows replace rows and leave `head` and the variables alone
//   5. the projection — a markdown table, pipes escaped, both copies equal
//   6. the box — the registry reserves the kind, the editor reads rows and
//      writes them WITHOUT a redraw, the plugin registers as `grid`
//   7. the conversion — a prose part holding a table becomes three sections
//   8. the checker — R62, R63, R64

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

import { isRuntimeRequest, isRows } from "../contracts/guards.js";
import { PROTOCOL } from "../contracts/wire.js";
import { parse, format } from "../server/platform/yaml.ts";
import { contentOf, drawSection, makePages } from "../server/domain/pages.ts";
import { projectDoc } from "../contracts/projection.ts";
import { check } from "../skill/check.ts";
import type { FileEntry, Files, PageDoc, YamlCodec } from "../contracts/types.ts";

const glob = /** @type {any} */ (globalThis as any);

/* ── 1. the guard ──────────────────────────────────────────────────────── */

const envelope = (extra: Record<string, unknown>) => ({ id: "1", g: PROTOCOL, ...extra });

test("section.write takes a grid's rows, and refuses rows mixed with text", () => {
  const write = (data: unknown) =>
    isRuntimeRequest(envelope({ kind: "section.write", page: "home", section: "t", part: "body", data }));
  expect(write([["Piece", "Where"], ["The part", "contracts"]])).toBe(true);
  // The two shapes that were already legal still are.
  expect(write("prose")).toBe(true);
  expect(write(["one", "two"])).toBe(true);
  // A row that is not a list, or a cell that is not text, refuses the whole
  // write: the writer has no case for a number in a cell.
  expect(write([["a", "b"], "c"])).toBe(false);
  expect(write([["a", 2]])).toBe(false);
  expect(isRows([])).toBe(true);
  expect(isRows([[]])).toBe(true);
  expect(isRows([["a"], ["b", "c"]])).toBe(true);
  expect(isRows(["a"])).toBe(false);
});

/* ── 2. the codec ──────────────────────────────────────────────────────── */

const GRID_DOC = [
  "name: Rates",
  "plugin: doc",
  "contents:",
  "  - name: body",
  "    parts:",
  "      body: |",
  "        Before.",
  "  - name: body-table",
  "    variables:",
  "      unit: kg",
  "    parts:",
  "      body:",
  "        type: grid",
  "        rows:",
  "          - [Piece, Where]",
  '          - ["The part, with a comma", "a | pipe"]',
  '          - ["two\\nlines"]',
  "",
].join("\n");

test("a grid reads back square, with head true when unsaid, and writes one row per line", () => {
  const doc = parse(GRID_DOC);
  const held = doc.contents[1]!.parts!["body"];
  expect(held).toEqual({
    type: "grid",
    data: "",
    head: true,
    // THE SHORT ROW IS PADDED, so a column is a column all the way down.
    rows: [["Piece", "Where"], ["The part, with a comma", "a | pipe"], ["two\nlines", ""]],
  });

  const text = format(doc);
  // One row per line, in flow style, no padding inside the brackets; a cell with
  // a comma or a pipe quoted; a cell with a line break double-quoted so the row
  // stays a line. No `data`, and no `head: true` — absent means true.
  expect(text).toContain("        rows:\n          - [Piece, Where]\n");
  expect(text).toContain('          - ["The part, with a comma", a | pipe]\n');
  expect(text).toContain('          - ["two\\nlines", ""]\n');
  expect(text).not.toContain("data:");
  expect(text).not.toContain("head:");
  // And it is the same page again.
  expect(parse(text).contents[1]).toEqual(doc.contents[1]);
});

test("head: false is written only when it is false, and a grid with data or a markdown with rows is refused by name", () => {
  const doc = parse(GRID_DOC);
  const grid = doc.contents[1]!.parts!["body"] as { head: boolean };
  grid.head = false;
  const text = format(doc);
  expect(text).toContain("        head: false\n");
  expect(parse(text).contents[1]!.parts!["body"]).toMatchObject({ head: false });

  const withData = GRID_DOC.replace("        type: grid\n", "        type: grid\n        data: x\n");
  expect(() => parse(withData)).toThrow(/holds rows rather than data/);
  const rowsOnProse = GRID_DOC.replace("        type: grid\n", "        type: markdown\n        data: hi\n");
  expect(() => parse(rowsOnProse)).toThrow(/only a grid holds rows/);
  const badRow = GRID_DOC.replace("          - [Piece, Where]\n", "          - Piece\n");
  expect(() => parse(badRow)).toThrow(/a row is a list of cells/);
  const badHead = GRID_DOC.replace("        type: grid\n", "        type: grid\n        head: maybe\n");
  expect(() => parse(badHead)).toThrow(/true or false/);
});

/* ── 3. the reader ─────────────────────────────────────────────────────── */

test("a grid resolves to a grid part: raw cells, squared rows, the three scopes gathered", async () => {
  const doc = parse(GRID_DOC);
  const drawn = await drawSection(doc.contents[1]!, { rate: 62 }, async () => null, '<div data-g-part="body"></div>');
  expect(drawn.parts["body"]).toEqual({
    kind: "grid",
    head: true,
    rows: [["Piece", "Where"], ["The part, with a comma", "a | pipe"], ["two\nlines", ""]],
    vars: { rate: 62, unit: "kg" },
  });
  // `contentOf` — the door a section arriving over `section.order` comes
  // through — squares rows the same way and settles head the same way.
  expect(contentOf({ type: "grid", rows: [["a"], ["b", "c"]] })).toEqual({ type: "grid", data: "", rows: [["a", ""], ["b", "c"]], head: true });
  expect(contentOf({ type: "grid", rows: [["a", 2]], head: false })).toEqual({ type: "grid", data: "", rows: [["a", "2"]], head: false });
});

/* ── 4. writeSlot ──────────────────────────────────────────────────────── */

interface MemFiles extends Files { at(rel: string): string | undefined; commits: string[] }

function memFiles(): MemFiles {
  const store = new Map<string, string>();
  const commits: string[] = [];
  return {
    async read(rel) { return store.get(rel) ?? null; },
    async write(rel, text) { store.set(rel, text); },
    async remove(rel) { store.delete(rel); for (const k of [...store.keys()]) if (k.startsWith(rel + "/")) store.delete(k); },
    async list(rel) {
      const prefix = rel === "" || rel === "." ? "" : rel + "/";
      const seen = new Map<string, boolean>();
      for (const k of store.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) seen.set(rest, false); else seen.set(rest.slice(0, cut), true);
      }
      if (seen.size === 0 && prefix !== "") throw new Error("ENOENT");
      const out: FileEntry[] = [];
      for (const [name, dir] of seen) out.push({ name, dir });
      return out;
    },
    async commit(message) { commits.push(message); },
    commits,
    at: (rel) => store.get(rel),
  };
}

/** The REAL codec this time, because how rows are spelled on disk is the thing
 *  under test. */
const yaml: YamlCodec = { parse, format, parseAny: (text) => parse(text) };

const dir = (id: string) => `pages/${id.split("/").join("/children/")}`;

async function vaultWithGrid() {
  const files = memFiles();
  const pages = makePages(files, yaml, () => []);
  await pages.create({ name: "Rates" });
  await files.write(`${dir("home/Rates")}/content.yaml`, GRID_DOC);
  return { files, pages };
}

test("writeSlot with rows replaces a grid's rows and leaves its head and its variables alone", async () => {
  const { files, pages } = await vaultWithGrid();
  await pages.writeSlot("home/Rates", "body-table", "body", [["Piece", "Where"], ["The docs", "vault"]]);
  const doc = parse(files.at(`${dir("home/Rates")}/content.yaml`) ?? "");
  expect(doc.contents[1]).toEqual({
    name: "body-table",
    variables: { unit: "kg" },
    parts: { body: { type: "grid", data: "", head: true, rows: [["Piece", "Where"], ["The docs", "vault"]] } },
  });
  // The neighbouring prose survived, and the write did not commit: it is the
  // keystroke path, the same as prose.
  expect(doc.contents[0]!.parts!["body"]).toBe("Before.\n");
  expect(files.commits).toEqual([]);
  // The same rows again is nothing to do.
  const before = files.at(`${dir("home/Rates")}/content.yaml`);
  await pages.writeSlot("home/Rates", "body-table", "body", [["Piece", "Where"], ["The docs", "vault"]]);
  expect(files.at(`${dir("home/Rates")}/content.yaml`)).toBe(before);
});

test("rows go only into a grid slot, and words go only into a markdown slot", async () => {
  const { pages } = await vaultWithGrid();
  await expect(pages.writeSlot("home/Rates", "body", "body", [["a"]])).rejects.toThrow(/only a grid slot holds rows/);
  await expect(pages.writeSlot("home/Rates", "body-table", "body", "prose")).rejects.toThrow(/only a markdown slot/);
  await expect(pages.writeSlot("home/Rates", "body-table", "body", [["a", 1 as unknown as string]])).rejects.toThrow(/every cell/);
});

test("a list never lands on a grid: an empty array is a list, and it is refused rather than replacing the rows", async () => {
  // `[]` reads as a list, and the list branch used to take whatever the slot
  // held for a list — so an empty array sent at a grid slot wrote `body: []`
  // over the rows, the head and the variables, and said nothing.
  const { files, pages } = await vaultWithGrid();
  const before = files.at(`${dir("home/Rates")}/content.yaml`);
  await expect(pages.writeSlot("home/Rates", "body-table", "body", [])).rejects.toThrow(/only a list slot takes a list/);
  await expect(pages.writeSlot("home/Rates", "body-table", "body", ["one", "two"])).rejects.toThrow(/a grid takes its rows/);
  expect(files.at(`${dir("home/Rates")}/content.yaml`)).toBe(before);
  // A lone markdown string is still promoted to a list, which is how a
  // section's first add works on a slot somebody wrote as one item.
  await pages.writeSlot("home/Rates", "body", "body", ["Before.\n", "After."]);
  expect(parse(files.at(`${dir("home/Rates")}/content.yaml`) ?? "").contents[0]!.parts!["body"]).toEqual(["Before.\n", "After."]);
});

/* ── 5. the projection ─────────────────────────────────────────────────── */

const PROJECTED = {
  name: "Rates",
  variables: { unit: "kg" },
  sections: [
    { name: "body", fallback: true, parts: { body: { kind: "markdown", md: "Before.\n", vars: {} } }, vars: {} },
    {
      name: "body-table", fallback: true, vars: {},
      parts: { body: { kind: "grid", head: true, rows: [["Piece", "Per {{unit}}"], ["The part", "a | pipe"], ["two\nlines", ""]], vars: { unit: "kg" } } },
    },
    {
      name: "loose", fallback: true, vars: {},
      parts: { body: { kind: "grid", head: false, rows: [["x", "y"]], vars: {} } },
    },
  ],
};

function guestProject() {
  glob.__gRuntime = {};
  new Function(readFileSync(new URL("../guest/runtime/project.js", import.meta.url), "utf8"))();
  return glob.__gRuntime.project;
}

test("a grid projects as a markdown table — pipes escaped, line breaks as <br>, an empty header when it has none — and both copies agree", () => {
  const md = projectDoc(PROJECTED as never);
  expect(md).toContain("| Piece | Per kg |\n| --- | --- |\n| The part | a \\| pipe |\n| two<br>lines |  |");
  // No header: an empty header row, because a markdown table has to have one
  // to be a table at all, then every row.
  expect(md).toContain("| | |\n| --- | --- |\n| x | y |");
  expect(guestProject().doc(PROJECTED)).toBe(md);
});

/* ── 6. the box ────────────────────────────────────────────────────────── */

test("the registry reserves grid as a part kind: biom-grid/ fills the framework's rung and plugins/grid/ the workspace's, and nothing else may", () => {
  glob.__gRuntime = { report: () => {} };
  glob.document = { currentScript: null };
  new Function(readFileSync(new URL("../guest/runtime/registry.js", import.meta.url), "utf8"))();
  const rt = glob.__gRuntime;
  // A folder that is not `plugins/grid/` may not take the kind, and one that is
  // not the framework's `biom-grid/` may not take the framework's name for it
  // either.
  rt.pluginRoot = "plugins";
  rt.pluginFile = "notes/notes.js";
  expect(rt.plugins.register({ id: "grid", mount() {} })).toBe(false);
  expect(rt.plugins.register({ id: "biom-grid", mount() {} })).toBe(false);
  rt.pluginRoot = "framework";
  rt.pluginFile = "biom-grid/grid.js";
  expect(rt.plugins.register({ id: "biom-grid", mount() {} })).toBe(true);
  // A `grid` slot resolves to the framework's plugin until the workspace
  // registers a `grid` of its own, which then wins by existing.
  expect(rt.plugins.get("grid")).toMatchObject({ id: "biom-grid" });
  rt.pluginRoot = "plugins";
  rt.pluginFile = "grid/grid.js";
  expect(rt.plugins.register({ id: "grid", mount() {}, edit: false })).toBe(true);
  expect(rt.plugins.get("grid")).toMatchObject({ id: "grid" });
  expect(rt.plugins.get("biom-grid")).toMatchObject({ id: "biom-grid", edit: false });
});

test("the grid plugin registers as biom-grid, the framework's name for the grid kind, editing its own cells rather than through the editor", () => {
  let registered: any = null;
  glob.__gRuntime = { report: () => {} };
  glob.biom = { plugins: { register: (d: any) => { registered = d; return true; } } };
  new Function(readFileSync(new URL("../guest/plugins/biom-grid/grid.js", import.meta.url), "utf8"))();
  expect(registered).not.toBeNull();
  expect(registered.id).toBe("biom-grid");
  // `edit: false` is a statement: the runtime's whole-part editor is the wrong
  // shape for a board, so the plugin does the editing and writes through ctx.
  expect(registered.edit).toBe(false);
  expect(typeof registered.mount).toBe("function");
  // Nothing in it inks a colour that is not a token.
  const src = readFileSync(new URL("../guest/plugins/biom-grid/grid.js", import.meta.url), "utf8");
  expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(src).not.toMatch(/\brgb\(|\bhsl\(/);
});

test("the editor answers a grid's rows and writes them WITHOUT asking for a redraw", async () => {
  /** @type {any[]} */
  const writes: any[] = [];
  let redraws = 0;
  glob.__gRuntime = {
    report: () => {},
    plugins: { get: () => null },
    sections: { merge: (a: any, b: any) => ({ ...a, ...b }), makeCtx: () => ({}) },
    page: {
      id: "home",
      onDraw: () => () => {},
      sections: () => [{ name: "t", parts: { body: { kind: "grid", head: true, rows: [["a", "b"], ["c", "d"]], vars: {} } } }],
      write: (section: string, part: string, data: unknown) => { writes.push([section, part, data]); return Promise.resolve(null); },
      redraw: () => { redraws++; return Promise.resolve(); },
    },
  };
  glob.document = { addEventListener: () => {}, head: { appendChild: () => {} }, getElementById: () => null, createElement: () => ({ setAttribute() {}, appendChild() {} }) };
  new Function(readFileSync(new URL("../guest/runtime/edit.js", import.meta.url), "utf8"))();
  const edit = glob.__gRuntime.edit;

  const rows = edit.read("t", "body");
  expect(rows).toEqual([["a", "b"], ["c", "d"]]);
  // A copy: splicing the answer does not edit the drawn page.
  rows[0].push("z");
  expect(edit.read("t", "body")).toEqual([["a", "b"], ["c", "d"]]);

  expect(edit.write("t", "body", [["a", "b"], ["c", "e"]])).toBe(true);
  await Promise.resolve();
  expect(writes).toEqual([["t", "body", [["a", "b"], ["c", "e"]]]]);
  // THE ONE THING THIS TEST IS FOR: a list write redraws the page, a grid write
  // does not — the plugin drew what it changed before it asked.
  expect(redraws).toBe(0);
});

/* ── 7. the conversion ─────────────────────────────────────────────────── */

/** The doc document's conversion script, evaluated against a stand-in runtime.
 *  It is its own `<script>` in the file precisely so the pure half — finding
 *  the tables and planning the rewrite — can run here with no DOM at all. */
function conversion(page: any = null) {
  const DOC = readFileSync(new URL("../guest/plugins/biom-doc/index.html", import.meta.url), "utf8");
  const scripts = [...DOC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  const src = scripts.find((s) => s.includes("rt.convert"));
  expect(src).toBeDefined();
  glob.__gRuntime = page ? { page } : {};
  new Function(src!)();
  return glob.__gRuntime.convert;
}

const TABLE_MD = [
  "The framework change is small.",
  "",
  "| Piece | Where |",
  "|---|---|",
  "| The part | contracts |",
  "| The drawing | guest \\| shim |",
  "",
  "Then the docs.",
  "",
].join("\n");

test("a prose part holding a table is planned as three sections: the prose before under the section's name, the grid, the prose after", () => {
  const c = conversion();
  const plan = c.plan([
    { name: "body", parts: { body: { kind: "markdown", md: TABLE_MD, vars: {} } }, source: { name: "body", parts: { body: TABLE_MD }, variables: { date: "x" } } },
    { name: "@page-notes", parts: {}, source: { name: "@page-notes", parts: { body: { type: "child", data: "notes" } } } },
  ]);
  expect(plan.writes).toEqual([{ section: "body", part: "body", text: "The framework change is small.\n" }]);
  expect(plan.contents.map((s: any) => s.name)).toEqual(["body", "body-table", "body-after", "@page-notes"]);
  // The grid: the header first, every row squared, an escaped pipe read as the
  // character it escapes. Both new sections carry the section's own variables
  // so a `{{date}}` in a cell or in the prose after still resolves.
  expect(plan.contents[1]).toEqual({
    name: "body-table",
    variables: { date: "x" },
    parts: { body: { type: "grid", head: true, rows: [["Piece", "Where"], ["The part", "contracts"], ["The drawing", "guest | shim"]] } },
  });
  expect(plan.contents[2]).toEqual({ name: "body-after", variables: { date: "x" }, parts: { body: "Then the docs.\n" } });
});

test("a page with no table in any prose part is left exactly as it was", () => {
  const c = conversion();
  expect(c.plan([{ name: "a", parts: { body: { kind: "markdown", md: "Plain prose with a | pipe in it.\n", vars: {} } }, source: { name: "a", parts: { body: "x" } } }])).toBeNull();
  // A table inside a fence is an example of one and not one.
  expect(c.plan([{ name: "f", parts: { body: { kind: "markdown", md: "```\n| a | b |\n|---|---|\n```\n", vars: {} } }, source: { name: "f", parts: { body: "x" } } }])).toBeNull();
  // A header and a delimiter that disagree about the width are not a table.
  expect(c.tablesIn("| a | b |\n|---|\n| 1 | 2 |")).toEqual([]);
  // A delimiter row carries a pipe. A setext heading whose text ends in one,
  // or a rule under such a line, is not a one-column table.
  expect(c.tablesIn("A heading about pipes |\n---\n\nProse.")).toEqual([]);
  expect(c.tablesIn("| A |\n|---|\n| 1 |")).toEqual([{ start: 0, end: 3, width: 1 }]);
  // A pipe inside a wikilink's alias or a code span is the cell's, not a column.
  expect(c.cellsOf("| [[home/Specs/One|the spec]] | `a | b` | c \\| d |")).toEqual(["[[home/Specs/One|the spec]]", "`a | b`", "c | d"]);
  // A list slot and a non-markdown part are not looked at.
  expect(c.plan([{ name: "l", parts: { body: { kind: "list", items: [{ kind: "markdown", md: TABLE_MD }] } }, source: { name: "l", parts: { body: [TABLE_MD] } } }])).toBeNull();
});

test("the born sections carry the section's variables with the part's own over them", () => {
  const c = conversion();
  const md = "Rate {{rate}}.\n\n| A |\n|---|\n| {{rate}} |\n\nStill {{rate}}, and {{unit}}.\n";
  const plan = c.plan([{
    name: "s",
    parts: { body: { kind: "markdown", md, vars: { rate: 62, unit: "kg" } } },
    // The long spelling: the part carries values of its own, over the section's.
    source: { name: "s", variables: { rate: 10, unit: "kg" }, parts: { body: { type: "markdown", data: md, variables: { rate: 62 } } } },
  }]);
  expect(plan.contents[1].variables).toEqual({ rate: 62, unit: "kg" });
  expect(plan.contents[2].variables).toEqual({ rate: 62, unit: "kg" });
  // A part with no values of its own and a section with none: no `variables`
  // key is written at all.
  const bare = c.plan([{ name: "t", parts: { body: { kind: "markdown", md, vars: {} } }, source: { name: "t", parts: { body: md } } }]);
  expect(bare.contents[1].variables).toBeUndefined();
});

test("a bare section whose part opens with the table gives its place to the grid, and two tables in one part are numbered", () => {
  const c = conversion();
  const first = "| A | B |\n|---|---|\n| 1 | 2 |\n";
  const bare = c.plan([{ name: "t", parts: { body: { kind: "markdown", md: first, vars: {} } }, source: { name: "t", parts: { body: first } } }]);
  // No prose before to keep the name for, and a section left holding an empty
  // slot is a blank band — so the section goes and the grid takes its place.
  expect(bare.writes).toEqual([]);
  expect(bare.contents.map((s: any) => s.name)).toEqual(["t-table"]);
  // A section with a file of its own keeps it, empty slot and all: the file
  // and its other slots are somebody's.
  const filed = c.plan([{ name: "t", parts: { body: { kind: "markdown", md: first, vars: {} } }, source: { name: "t", data: "t.html", parts: { body: first } } }]);
  expect(filed.writes).toEqual([{ section: "t", part: "body", text: "" }]);
  expect(filed.contents.map((s: any) => s.name)).toEqual(["t", "t-table"]);

  const two = "Intro.\n\n| A |\n|---|\n| 1 |\n\nBetween.\n\n| B |\n|---|\n| 2 |\n\nEnd.\n";
  const plan = c.plan([{ name: "s", parts: { note: { kind: "markdown", md: two, vars: {} } }, source: { name: "s", data: "s.html", parts: { note: two, head: "h" } } }]);
  expect(plan.writes).toEqual([{ section: "s", part: "note", text: "Intro.\n" }]);
  expect(plan.contents.map((x: any) => x.name)).toEqual(["s", "s-note-table", "s-note-after", "s-note-table-2", "s-note-after-2"]);
  expect(plan.contents[2].parts.body).toBe("Between.\n");
  expect(plan.contents[4].parts.body).toBe("End.\n");
});

test("the conversion runs after a draw, writes the prose before, then rewrites the list — and runs once", async () => {
  const calls: string[] = [];
  let onDraw: (() => void) | null = null;
  const sections = [{ name: "body", parts: { body: { kind: "markdown", md: TABLE_MD, vars: {} } }, source: { name: "body", parts: { body: TABLE_MD } } }];
  conversion({
    id: "home",
    onDraw: (fn: () => void) => { onDraw = fn; },
    sections: () => sections,
    write: (s: string, p: string, t: string) => { calls.push("write " + s + "." + p + " " + JSON.stringify(t)); return Promise.resolve(null); },
    order: (list: any[]) => { calls.push("order " + list.map((x) => x.name).join(",")); return Promise.resolve(list); },
  });
  expect(onDraw).not.toBeNull();
  onDraw!();
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toEqual([
    'write body.body "The framework change is small.\\n"',
    "order body,body-table,body-after",
  ]);
  // The page redrawn as three sections holds no table in any prose part, so
  // the next draw does nothing at all.
  sections.splice(0, 1,
    { name: "body", parts: { body: { kind: "markdown", md: "The framework change is small.\n", vars: {} } }, source: { name: "body", parts: { body: "x" } } },
  );
  onDraw!();
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toHaveLength(2);
});

/* ── 8. the checker ────────────────────────────────────────────────────── */

const page = (lines: string[]) => ({
  id: "rates",
  doc: ["name: Rates", "plugin: doc", "contents:", ...lines, ""].join("\n"),
  files: {},
});
const rulesOf = (r: { findings: { rule: string }[] }) => new Set(r.findings.map((f) => f.rule));

test("R62 — a ragged grid is reported, and a square one is not", () => {
  const ragged = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        rows:", "          - [A, B]", "          - [1]"]));
  expect(rulesOf(ragged).has("R62")).toBe(true);
  const square = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        rows:", "          - [A, B]", '          - [1, ""]']));
  expect(rulesOf(square).has("R62")).toBe(false);
  // A row that is not a list, or a cell that is a structure, is a FAIL: the
  // parser refuses the page.
  const notRow = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        rows:", "          - A"]));
  expect(notRow.findings.some((f) => f.rule === "R62" && f.severity === "FAIL")).toBe(true);
});

test("R63 — a head that is not a row, or not true or false", () => {
  const noRows = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        rows: []"]));
  expect(rulesOf(noRows).has("R63")).toBe(true);
  const emptyOk = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        head: false", "        rows: []"]));
  expect(rulesOf(emptyOk).has("R63")).toBe(false);
  const badHead = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        head: maybe", "        rows:", "          - [A]"]));
  expect(badHead.findings.some((f) => f.rule === "R63" && f.severity === "FAIL")).toBe(true);
});

test("R64 — a bare pipe in a cell is a note, not a refusal; a pipe inside a wikilink or a code span is neither", () => {
  const piped = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        rows:", "          - [A, B]", '          - ["1 | 2", x]']));
  const finding = piped.findings.find((f) => f.rule === "R64");
  expect(finding).toBeDefined();
  expect(finding!.severity).toBe("WARN");
  expect(piped.ok).toBe(true);
  // `[[id|alias]]` is how this format writes a link, and a pipe in a code span
  // is the code's: neither is a row pasted into a cell.
  const linked = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        rows:", "          - [A, B]", '          - ["[[home/Specs/One|the spec]]", "`a | b`"]']));
  expect(rulesOf(linked).has("R64")).toBe(false);
});

test("R49 — rows on a markdown part, or data on a grid, is the parser's refusal said early", () => {
  const rowsOnProse = check(page(["  - name: t", "    parts:", "      body:", "        type: markdown", "        data: hi", "        rows: []"]));
  expect(rowsOnProse.findings.some((f) => f.rule === "R49" && f.severity === "FAIL")).toBe(true);
  const dataOnGrid = check(page(["  - name: t", "    parts:", "      body:", "        type: grid", "        data: hi", "        rows:", "          - [A]"]));
  expect(dataOnGrid.findings.some((f) => f.rule === "R49" && f.severity === "FAIL")).toBe(true);
});
