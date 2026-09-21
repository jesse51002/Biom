// SPDX-License-Identifier: AGPL-3.0-only
// The exit condition, as a test.
//
// "The prototype is finished when a person who is not the founder can be handed
// a page, ask for a change in plain language, and see the change survive a
// reload." Everything below the plain-language part is mechanical, and this is
// it: a real vault on disk, the real server modules, the real client store, and
// then the whole thing torn down and rebuilt from the same directory.
//
// It exists because the units all passed while the path between them was dead —
// the store sent one request kind and the server refused it, so every slot
// write failed and no unit test could see it. An integration test is the only
// place that class of fault shows up, which is exactly why it is written against
// the CONTRACT rather than against either side: `WorkspaceStore` in
// contracts/types.ts names `writeSlot`, `setSections` and `patchVariables`, and
// the route answers `section.write`, `section.order` and `variables.patch`. If
// the two ever name different things again, this file is where it shows. The
// route also answers `doc.raw` and `doc.writeRaw`, which the store stopped
// calling when the Config screen went (2026-09-17); they are the API's and are
// exercised here as the API.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFiles, initVault } from "../server/platform/files.ts";
import { makeDb } from "../server/platform/db.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { makePages } from "../server/domain/pages.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { makeMirror } from "../server/domain/mirror.ts";
import { makeDesign } from "../server/domain/design.ts";
import { makeTables } from "../server/domain/tables.ts";
import { makePresets, makeTheme } from "../server/workspace/presets.ts";
import { handle } from "../server/api/routes.ts";
import { makeWorkspace } from "../client/store/workspace.js";
import { PROTOCOL } from "../contracts/wire.js";

import { ROOT_PAGE } from "../contracts/types.ts";
import type { ApiRequest, ApiResponse, Change, Page, Part, PageId, PageRef } from "../contracts/types.ts";

let root: string;

/** Stand the whole stack up over a directory. Calling it twice against the same
 *  directory is what "survive a reload" means — nothing is carried over in
 *  memory, so anything still there came off disk. */
function boot(dir: string) {
  const files = makeFiles(dir);
  const db = makeDb(join(dir, "workspace.db"));
  const yaml = { parse, parseAny, format };
  const tables = makeTables(db);
  const pages = makePages(files, yaml, () => tables.list());
  // It was `makeSidecars`. There is no sidecar, because there is nothing beside
  // the file: `content.yaml` carries the page's prose as well as its shape.
  const docs = makeDocs(files, yaml);
  // Rooted at `design/` rather than at the vault, exactly as the composition
  // root does it: the design doc is one page sitting beside `pages/`.
  const design = makeDesign(makeFiles(join(dir, "design")), yaml);
  const theme = makeTheme(files);
  // NO `seed`, and no `market`. The catalogue went with the render layer it was
  // written against, and a caller with no directory of presets says so by
  // omitting the root rather than pointing at one that is not there.
  const presets = makePresets({ pages, tables, files, yaml });
  const deps = { pages, design, docs, tables, presets, theme, mirror: makeMirror(files, pages) };

  // The transport, in process. The client cannot tell this from fetch, which is
  // the whole point of there being one envelope and one route.
  const transport = { call: (req: ApiRequest): Promise<ApiResponse> => handle(req, deps as never) };
  return { deps, db, ws: makeWorkspace(transport), transport };
}

/** One page id, one document. Written whole, because that is what the format is
 *  — the raw fallback is also the shortest way to say "this page is now these
 *  three sections" in a test.
 *
 *  There is no `kind:` and no `render:` to write: a page holds sections and
 *  nothing else, and yaml.ts refuses either key by name rather than ignoring
 *  it. */
const doc = (name: string, body: string): string => `name: ${name}\nplugin: doc\n${body}`;

/** A section that names no file and so takes the shipped default, holding one
 *  markdown slot in the slot that default declares. The shortest thing that is
 *  still a whole section. */
const prose = (name: string, md: string): string =>
  `  - name: ${name}\n    parts:\n      body: |\n${md.split("\n").map((l) => (l === "" ? "" : `        ${l}`)).join("\n")}\n`;

/** The markdown a slot holds, or "" if that slot holds something else. Written
 *  once because every assertion below reaches for it and `Part` is a union. */
const mdOf = (page: Page | null | undefined, section: string, slot = "body"): string => {
  const part = page?.sections.find((s) => s.name === section)?.parts[slot];
  return part !== undefined && part.kind === "markdown" ? part.md : "";
};

/** Every part on a section, whatever kind it is. */
const partOf = (page: Page | null | undefined, section: string, slot = "body"): Part | undefined =>
  page?.sections.find((s) => s.name === section)?.parts[slot];

let seq = 0;
const req = (o: Record<string, unknown>): ApiRequest => ({ id: `i${++seq}`, g: PROTOCOL, ...o }) as ApiRequest;

/** WRITE A PAGE'S DOCUMENT WHOLE, over the wire, and have the store re-read
 *  whatever it holds of that page. The store used to carry this itself as
 *  `writeDocRaw`, for the Config screen's raw editor; that screen went on
 *  2026-09-17 and the wire kind stayed, because the API is not a screen. A test
 *  writing a whole page is writing it the way an agent's tool would: through
 *  the API, with the store told afterwards. */
async function writeRaw(w: { ws: ReturnType<typeof makeWorkspace>; transport: { call: (r: ApiRequest) => Promise<ApiResponse> } },
  id: PageId, text: string): Promise<void> {
  const res = await w.transport.call(req({ kind: "doc.writeRaw", page: id, text }));
  if (!res.ok) throw new Error(res.error.message);
  if (w.ws.get().page?.id === id) await w.ws.reloadPage(id);
}

/** The directory a page id names: `a/b` is `pages/a/children/b`. */
const dirOf = (dir: string, id: PageId): string => join(dir, "pages", id.split("/").join("/children/"));

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "biom-vault-"));
  await initVault(root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a slot write survives a reload", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Job board" });

  // `section` null is the page's own variables. It is on the wire because THE
  // NEAREST ONE WINS, so where a value lands decides what every other section on
  // the page can see — and the server must never guess.
  const merged = await first.ws.patchVariables(page.id, null, { heading: "This week" });
  expect(merged.variables["heading"]).toBe("This week");
  first.db.close();

  // Nothing in memory crosses this line.
  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  expect(read?.variables["heading"]).toBe("This week");
  second.db.close();
});

test("a slot write lands on ONE scope, and the section it belongs to carries it", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Rates" });
  await first.ws.writeFile(page.id, "calc.html", '<div data-g-part="total"></div>');
  await writeRaw(first, page.id, doc("Rates",
    "variables:\n  rate: 62\ncontents:\n" +
    prose("intro", "The base rate is {{rate}}.") +
    "  - name: calc\n    data: calc.html\n    parts:\n      total: |\n        0\n"));

  await first.ws.patchVariables(page.id, "calc", { title: "What a job costs" });
  first.db.close();

  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  const intro = read?.sections.find((s) => s.name === "intro");
  const calc = read?.sections.find((s) => s.name === "calc");

  // The page's value is in scope everywhere; the section's is in scope on the
  // one section. A slot write that landed a scope out would have changed what
  // the paragraph one section up resolves against.
  expect(intro?.vars).toEqual({ rate: 62 });
  expect(calc?.vars).toEqual({ rate: 62, title: "What a job costs" });
  // AND THE SAME SCOPE REACHES THE PART, because a part is drawn from its own
  // `vars` and never reaches up for the section's.
  expect(partOf(read, "intro")).toMatchObject({ kind: "markdown", vars: { rate: 62 } });
  expect(partOf(read, "calc", "total")).toMatchObject({ vars: { rate: 62, title: "What a job costs" } });

  // AND THE TEXT IS RAW, braces and all. Interpolation is the client's job
  // because prose is edited in place and writes back: resolving on the server
  // would round-trip `62` over the top of `{{rate}}` the first time somebody
  // touched that paragraph.
  expect(mdOf(read, "intro")).toContain("{{rate}}");
  // The section named a file, so it drew with it rather than with the shipped
  // default — which is the other half of what a section is.
  expect(calc?.fallback).toBe(false);
  expect(calc?.html).toContain('data-g-part="total"');
  expect(intro?.fallback).toBe(true);
  second.db.close();
});

test("prose survives a reload, which is the thing the mock could not do", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Team notes" });
  await writeRaw(first, page.id, doc("Team notes",
    "contents:\n" + prose("title", "# Team notes\n\nRates went up in March.")));
  first.db.close();

  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  expect(mdOf(read, "title")).toContain("March");
  // ONE FILE HOLDS EVERYTHING THE PAGE SAYS. There is no `.md` beside it, which
  // is the whole change: an agent asked to alter what a page says opens one file.
  expect(existsSync(join(dirOf(root, page.id), "title.md"))).toBe(false);
  expect(readFileSync(join(dirOf(root, page.id), "content.yaml"), "utf8")).toContain("Rates went up in March.");
  second.db.close();
});

// PROSE WRITES BACK, AND THAT IS THE EXIT CONDITION. Everything above proves a
// page can be READ after a restart; this is the half the mock never had and the
// half the format change nearly took away — the words are inside `content.yaml`
// now, so a typed paragraph is a write to the document rather than to a `.md`
// beside it, and until `section.write` existed there was no kind that could make
// one. What is exercised here is the whole path: the client store, the route,
// the domain, the disk, and then a second stack over the same directory.
test("A TYPED PARAGRAPH SURVIVES A FULL REBUILD FROM THE SAME DIRECTORY", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Team notes" });
  await writeRaw(first, page.id, doc("Team notes",
    "contents:\n" + prose("title", "# Team notes") + prose("note", "Nothing yet.")));
  await first.ws.loadPage(page.id);

  // What the view does when the debounce fires: ONE SLOT'S text — a page, a
  // section and a part, because a slot's id is its key in the section's `parts`
  // and nothing narrower can address it. The page on screen shows it without a
  // re-read.
  await first.ws.writeSlot(page.id, "note", "body", "Rates went up in March.");
  expect(mdOf(first.ws.get().page, "note")).toBe("Rates went up in March.");
  first.db.close();

  // Nothing in memory crosses this line.
  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  expect(mdOf(read, "note")).toBe("Rates went up in March.");
  // ONE FILE HOLDS EVERYTHING THE PAGE SAYS — the words went into the document,
  // not into a `.md` beside it.
  expect(existsSync(join(dirOf(root, page.id), "note.md"))).toBe(false);
  expect(readFileSync(join(dirOf(root, page.id), "content.yaml"), "utf8")).toContain("Rates went up in March.");
  // And it touched nothing else: the neighbour still says what it said.
  expect(mdOf(read, "title")).toContain("# Team notes");
  second.db.close();
});

test("a paragraph holding {{rate}} round-trips the braces and never the number", async () => {
  // THE ONE BUG ON THIS PATH THAT DESTROYS SOMEBODY'S VARIABLES. The DOM shows
  // 62 because the runtime resolves the token where the part is drawn; what
  // writes back is the source, and if it were ever the rendered value the
  // variable would be gone — silently, for good, the first time anybody touched
  // the paragraph it was in.
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Rates" });
  await writeRaw(first, page.id, doc("Rates",
    "variables:\n  rate: 62\ncontents:\n" + prose("intro", "The base rate is {{rate}}.")));

  await first.ws.writeSlot(page.id, "intro", "body", "The base rate is {{rate}} an hour, still.\n");
  first.db.close();

  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  expect(mdOf(read, "intro")).toBe("The base rate is {{rate}} an hour, still.\n");
  // The variable itself is untouched, and still in scope on the section.
  expect(read?.sections.find((s) => s.name === "intro")?.vars).toEqual({ rate: 62 });
  expect(readFileSync(join(dirOf(root, page.id), "content.yaml"), "utf8")).not.toContain("62 an hour");
  second.db.close();
});

test("a reorder keeps every word, and a removal takes the words with it", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Notes" });
  await writeRaw(first, page.id, doc("Notes",
    "contents:\n" + prose("a", "First words.") + prose("b", "Second words.") + prose("c", "Third words.")));
  await first.ws.loadPage(page.id);

  // What the grip sends: the whole list, in the new order, matched by name.
  // `contents` IS the order, so adding, reordering and removing are one edit to
  // one list and there is no second place for a name to be in a different
  // position.
  await first.ws.setSections(page.id, [
    { name: "c", parts: { body: "Third words.\n" } },
    { name: "a", parts: { body: "First words.\n" } },
  ]);
  // Visible immediately, without a reload — the store re-reads because the
  // server owns what a page holds.
  expect(first.ws.get().page?.sections.map((s) => s.name)).toEqual(["c", "a"]);
  first.db.close();

  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  expect(read?.sections.map((s) => s.name)).toEqual(["c", "a"]);
  // THE TEXT CAME WITH THEM. `contents` is the order and each entry carries its
  // own words, so moving one is moving what it says.
  expect([mdOf(read, "c"), mdOf(read, "a")]).toEqual(["Third words.\n", "First words.\n"]);
  // AND THE ONE THAT WAS ABSENT IS GONE, its words with it: removal is by
  // absence from the list, because the list is the whole of what the page holds.
  expect(readFileSync(join(dirOf(root, page.id), "content.yaml"), "utf8")).not.toContain("Second words.");
  second.db.close();
});

test("a child is not lost by a reorder, because its entry is reconciled and not written", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Clients" });
  const child = await first.deps.pages.create({ name: "Ashgrove", parent: page.id });
  await first.ws.loadPage(page.id);
  // The child's section is placed by the read, at the bottom, which is where a
  // thing added to a folder turns up.
  expect(first.ws.get().page?.sections.map((s) => s.name)).toEqual(["title", "@page-Ashgrove"]);

  // A caller reordering the sections it can see, saying nothing about the child.
  // Dropping its entry would only make the next read reappend it — so the server
  // puts it back at the index it had rather than letting the page rearrange
  // itself behind somebody's drag.
  await first.ws.setSections(page.id, [{ name: "title", parts: { body: "# Clients\n" } }]);
  first.db.close();

  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  expect(read?.sections.map((s) => s.name)).toEqual(["title", "@page-Ashgrove"]);
  // A CHILD KEY IS ONE SEGMENT, never a path, and it goes in the slot the
  // shipped default section declares — which is what draws it until somebody
  // writes an `@page-Ashgrove.html` beside the document.
  // Off real files, so the child carries when it was made — an instant, not
  // a fixed one — beside what it is and what it is called.
  const part = partOf(read, "@page-Ashgrove");
  expect(typeof part.child.created).toBe("string");
  expect(isNaN(Date.parse(part.child.created))).toBe(false);
  expect({ ...part, child: { ...part.child, created: undefined } }).toEqual({
    kind: "child",
    child: { kind: "page", id: child.id, name: "Ashgrove", created: undefined },
  });
  second.db.close();
});

test("a prose write puts one request on the wire, and page.read is not the second", async () => {
  // The same judgement a variables flush makes: this fires on a debounce while
  // somebody is typing, and a re-read here would replace the page object — and
  // every frame keyed off it — mid-keystroke. A reorder is the opposite case and
  // says so: the shape moved, so it re-reads on purpose.
  const kinds: string[] = [];
  const files = makeFiles(root);
  const db = makeDb(join(root, "workspace.db"));
  const yaml = { parse, parseAny, format };
  const tables = makeTables(db);
  const pages = makePages(files, yaml, () => tables.list());
  const deps = { pages, docs: makeDocs(files, yaml), tables, theme: makeTheme(files),
    design: makeDesign(makeFiles(join(root, "design")), yaml),
    presets: makePresets({ pages, tables, files, yaml }), mirror: makeMirror(files, pages) };
  const transport = {
    call: (r: ApiRequest): Promise<ApiResponse> => {
      kinds.push(r.kind);
      return handle(r, deps as never);
    },
  };
  const ws = makeWorkspace(transport);

  const page = await ws.createPage({ name: "Notes" });
  await writeRaw({ ws, transport }, page.id, doc("Notes",
    "contents:\n" + prose("title", "# Notes") + prose("note", "Nothing yet.")));
  await ws.loadPage(page.id);
  kinds.length = 0;

  await ws.writeSlot(page.id, "title", "body", "# Notes\n\nTyped.\n");
  expect(kinds).toEqual(["section.write"]);

  kinds.length = 0;
  await ws.setSections(page.id, [{ name: "note" }, { name: "title" }]);
  expect(kinds[0]).toBe("section.order");
  expect(kinds).toContain("page.read");
  db.close();
});

test("a row written through the store survives a reload", async () => {
  const first = boot(root);
  first.deps.tables.create({
    name: "jobs",
    kind: "basic",
    columns: [
      { name: "name", type: "text" },
      { name: "stage", type: "categories", options: [{ label: "Quoted", colour: "cyan" }, { label: "Done", colour: "ink" }] },
      { name: "days", type: "number" },
    ],
  });
  const id = await first.ws.insertRow("jobs", { name: "Ash Street", stage: '["Quoted"]', days: 4 });
  await first.ws.updateRow("jobs", id, { stage: '["Done"]' });
  first.db.close();

  const second = boot(root);
  const view = await second.ws.loadTable("jobs");
  expect(view?.rows).toHaveLength(1);
  expect(view?.rows[0]?.cells.name).toBe("Ash Street");
  expect(view?.rows[0]?.cells.stage).toBe('["Done"]');
  second.db.close();
});

test("contents IS the order, and it survives a reload", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Notes" });
  await writeRaw(first, page.id, doc("Notes",
    "contents:\n" + prose("b", "two") + prose("a", "one") + prose("title", "# Notes")));
  first.db.close();

  const second = boot(root);
  const read = await second.ws.loadPage(page.id);
  // There is no `order:` any more, and there is nothing for it to disagree with:
  // the list of what the page is IS the order it is in.
  expect(read?.sections.map((s) => s.name)).toEqual(["b", "a", "title"]);
  second.db.close();
});

// THE DOCUMENT SAYS WHAT A SLOT HOLDS, and that is the change worth a test of
// its own. It used to be the filesystem: a section was markdown unless
// `<id>.html` sat beside it, so writing calc.html was what MADE the block — a
// rule read out of a directory listing, implemented in three places, and one of
// them missed a file form for months without anything saying so.
//
// The property it bought is kept and paid for differently: an agent still turns
// a paragraph into a program by writing one file, it just says so in the
// document at the same time. That is one edit to one file, which is the thing
// this format exists for.
test("what a slot holds is stated in the document, not inferred from a directory listing", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Rates" });
  await writeRaw(first, page.id, doc("Rates", "contents:\n" + prose("calc", "placeholder")));

  let read = await first.ws.reloadPage(page.id);
  expect(partOf(read, "calc")?.kind).toBe("markdown");
  // The section named no file, so it took the shipped default and says so.
  expect(read?.sections[0]?.fallback).toBe(true);

  // A file appearing beside it is no longer enough — and that is the point: a
  // stray `calc.html` cannot silently take over a paragraph somebody wrote, and
  // it cannot silently become the section's own markup either.
  await first.ws.writeFile(page.id, "calc.html", '<div data-g-part="total"></div>');
  read = await first.ws.reloadPage(page.id);
  expect(partOf(read, "calc")?.kind).toBe("markdown");
  expect(read?.sections[0]?.fallback).toBe(true);

  // Saying so in the document is. Two writes, one file each, and both are things
  // Claude Code does without knowing anything about our data model. A slot that
  // is a map is a full `Content`; a section's `data` is the file it draws with.
  await writeRaw(first, page.id, doc("Rates",
    "contents:\n  - name: calc\n    data: calc.html\n    parts:\n      total: { type: html, data: calc.html }\n"));
  read = await first.ws.reloadPage(page.id);
  expect(partOf(read, "calc", "total")).toMatchObject({ kind: "html", file: "calc.html" });
  expect(read?.sections[0]?.fallback).toBe(false);
  expect(read?.sections[0]?.html).toContain('data-g-part="total"');
  first.db.close();
});

test("the vault is a git repo, so an agent write is recoverable without a snapshot mechanism", async () => {
  const first = boot(root);
  const page = await first.deps.pages.create({ name: "Notes" });
  await writeRaw(first, page.id, doc("Notes", "contents:\n" + prose("title", "# Before")));
  await writeRaw(first, page.id, doc("Notes", "contents:\n" + prose("title", "# After")));
  first.db.close();

  const log = Bun.spawnSync(["git", "log", "--oneline"], { cwd: root });
  expect(log.exitCode).toBe(0);
  expect(log.stdout.toString().trim().split("\n").length).toBeGreaterThan(1);
});

test("a reorder is visible immediately, without a reload", async () => {
  // The bug this guards: the order landed on disk but the sections kept their
  // old order on screen until the page was re-opened by hand. `sections` is
  // derived from `contents` by the server, so a store that swapped only the
  // document's values left every consumer drawing from stale structure.
  const w = boot(root);
  const { ws, db } = w;
  const page = await ws.createPage({ name: "Notes" });
  const three = (order: string[]) =>
    doc("Notes", `contents:\n${order.map((n) => prose(n, n)).join("")}`);

  await writeRaw(w, page.id, three(["a", "b", "title"]));
  await ws.loadPage(page.id);
  expect(ws.get().page?.sections.map((s) => s.name)).toEqual(["a", "b", "title"]);

  // No second boot: the same store instance, re-read once, shows the order the
  // server derived from the new `contents` — structure, not only values.
  await writeRaw(w, page.id, three(["b", "title", "a"]));
  expect(ws.get().page?.sections.map((s) => s.name)).toEqual(["b", "title", "a"]);
  db.close();
});

test("a variables patch is merged, never re-read, because a re-read restarts every artifact", async () => {
  // The other half, and why the merge exists at all. This runs on every slot
  // flush; re-reading the page here would hand the views a new page object
  // mid-typing, and re-inserting a page root reloads its iframe — including the
  // frame of the artifact that did the writing.
  //
  // So the assertion is about the WIRE: a variables patch is one request, and
  // `page.read` is not the second one. A patch cannot change a page's shape —
  // there is no key in it that decides how the page is drawn — so the document
  // that comes back says everything that moved.
  const { ws, db } = boot(root);
  const page = await ws.createPage({ name: "Rates" });
  await ws.loadPage(page.id);
  const before = ws.get().page;

  await ws.patchVariables(page.id, null, { heading: "Our rates" });
  const after = ws.get().page;

  expect(after).not.toBe(before);                       // the variables did move
  expect(after?.variables["heading"]).toBe("Our rates");
  // The SHAPE did not: same sections, same names, same markup, same slots, same
  // words, in the same order. What changed is the scope each one resolves
  // `{{name}}` against, which is the only thing a variables patch can touch.
  expect(after?.sections.map((s) => `${s.name}:${String(s.fallback)}:${Object.keys(s.parts).join(",")}`))
    .toEqual(before?.sections.map((s) => `${s.name}:${String(s.fallback)}:${Object.keys(s.parts).join(",")}`));
  // Non-empty on purpose: two blanks comparing equal would say nothing.
  expect(mdOf(before, "title")).toContain("# Rates");
  expect(mdOf(after, "title")).toBe(mdOf(before, "title"));
  // NEAREST FIRST, and the page is the outermost of the three — so a value
  // written here reaches the section and the part inside it.
  expect(after?.sections[0]?.vars).toEqual({ heading: "Our rates" });
  expect(partOf(after, "title")).toMatchObject({ vars: { heading: "Our rates" } });
  db.close();
});

test("a variables patch puts one request on the wire, and page.read is not the second", async () => {
  // The mechanism behind the test above, watched rather than inferred. A store
  // that re-read after every flush would be correct and unusable: the artifact
  // doing the typing would restart on each keystroke.
  const kinds: string[] = [];
  const files = makeFiles(root);
  const db = makeDb(join(root, "workspace.db"));
  const yaml = { parse, parseAny, format };
  const tables = makeTables(db);
  const pages = makePages(files, yaml, () => tables.list());
  const deps = { pages, docs: makeDocs(files, yaml), tables, theme: makeTheme(files),
    design: makeDesign(makeFiles(join(root, "design")), yaml),
    presets: makePresets({ pages, tables, files, yaml }), mirror: makeMirror(files, pages) };
  const transport = {
    call: (r: ApiRequest): Promise<ApiResponse> => {
      kinds.push(r.kind);
      return handle(r, deps as never);
    },
  };
  const ws = makeWorkspace(transport);

  const page = await ws.createPage({ name: "Rates" });
  await ws.loadPage(page.id);
  kinds.length = 0;

  await ws.patchVariables(page.id, null, { heading: "Our rates" });
  expect(kinds).toEqual(["variables.patch"]);

  // A whole document rewritten is the opposite case: it replaces the file, so
  // the name and every section may have moved at once, and the store is asked
  // to re-read on purpose — `reloadPage`, which is the one read that throws
  // away what the layers above built.
  kinds.length = 0;
  await writeRaw({ ws, transport }, page.id, doc("Rates", "contents:\n" + prose("title", "# Rates")));
  expect(kinds[0]).toBe("doc.writeRaw");
  expect(kinds).toContain("page.read");
  db.close();
});

test("the change feed says what moved, so an artifact can be told", async () => {
  // An artifact lives in an opaque-origin frame and can observe nothing outside
  // itself. This feed is the only way it learns its data moved.
  const w = boot(root);
  const { ws, deps, db } = w;
  const seen: Change[] = [];
  ws.onChange((c) => seen.push(c));

  const page = await ws.createPage({ name: "Notes" });
  await ws.loadPage(page.id);
  // The whole document rewritten and the page re-read: the SHAPE moved, so a
  // consumer holding derived structure has to rebuild rather than patch.
  await writeRaw(w, page.id, doc("Notes", "contents:\n" + prose("title", "# Notes")));
  expect(seen.at(-1)).toEqual({ page: page.id, shape: true });

  // One value on one scope, and the shape is not mentioned at all — there is no
  // key in a variables patch that could decide how the page is drawn, so a
  // consumer holding derived structure has nothing to rebuild.
  await ws.patchVariables(page.id, null, { x: "y" });
  expect(seen.at(-1)).toEqual({ page: page.id });

  deps.tables.create({ name: "t", kind: "basic", columns: [{ name: "a", type: "text" }] });
  await ws.insertRow("t", { a: "1" });
  expect(seen.at(-1)).toEqual({ tables: ["t"] });
  db.close();
});

// MOVING A PAGE CHANGES ITS ID, and every id beneath it. There is no method for
// it on `WorkspaceStore` — contracts/types.ts is frozen and has none — so it is
// exercised over the route here, which is the surface that does exist. It is in
// this file rather than the API's because what it proves is END TO END: the id
// the caller was holding is dead the moment this returns, and the store re-reads
// on what came back rather than on what it asked with.
test("a page that moved is reached by its new id, and its old one is not forwarded", async () => {
  const { ws, transport, db } = boot(root);
  const clients = await ws.createPage({ name: "Clients" });
  const notes = await ws.createPage({ name: "Notes" });
  const child = await ws.createPage({ name: "Ashgrove", parent: notes.id });

  await ws.patchVariables(child.id, null, { rate: 62 });
  await ws.loadTree();

  const moved = await transport.call(req({ kind: "page.move", page: notes.id, parent: clients.id }));
  expect(moved.ok).toBe(true);
  const to = moved.ok ? (moved.value as PageId) : "";
  expect(to).toBe(`${clients.id}/Notes`);

  // The store re-reads the tree and finds the new ids, and only those.
  await ws.loadTree();
  const ids = ws.get().pages.map((p: PageRef) => p.id);
  expect(ids).toContain(to);
  expect(ids).toContain(`${to}/Ashgrove`);
  expect(ids).not.toContain(notes.id);

  // Nothing forwards: a stale id is a visible failure, not somebody else's page.
  expect(await ws.loadPage(notes.id)).toBeNull();
  // And the page is intact at the address it moved to, values and all.
  expect((await ws.loadPage(`${to}/Ashgrove`))?.variables["rate"]).toBe(62);
  // The root is where it always was — an id is a path, and only the moved
  // subtree's paths changed.
  expect(ids).toContain(ROOT_PAGE);
  db.close();
});
