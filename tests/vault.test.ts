// SPDX-License-Identifier: AGPL-3.0-only
// The vault format's own tests.
//
// The workspace's Architecture page calls the vault format build-order item one and expensive to
// change later, so these tests are written against the *format* rather than
// against the code: every one of them would still read as a sentence about the
// layout if the implementation were thrown away. Files is a fake on purpose —
// pages.ts receives it as an argument and has never seen a path, so testing it
// against a real disk would be testing files.ts twice. The codec is a stand-in
// for server/platform/yaml.ts, which gets its own tests: everything here cares
// about is that a document round-trips.
//
// WHAT MOVED WITH THE FORMAT. `contents` is `Section[]` and nothing else — no
// `kind:`, no `render:`, no `order:`, no `parent:`, and no `type` on an entry,
// because a section is the only thing the list can hold. A section is a div: it
// names its own html file in `data`, or names none and takes the shipped default
// section, and its `parts` map slot ids onto what goes in them. A slot's id is
// its key in that map, which is why nothing in a `Content` states it twice. The
// page a caller gets back is RESOLVED — `DrawnSection[]`, html loaded and slots
// filled — because the runtime that draws it cannot fetch.
//
// Every name, rate and job in here is invented and represents nothing real.

import { test, expect } from "bun:test";
import { DEFAULT_SECTION, DEFAULT_SLOT, makePages } from "../server/domain/pages.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { makeDesign } from "../server/domain/design.ts";
import { parentOf, segmentOf } from "../contracts/types.ts";
import type { FileEntry, Files, Page, PageDoc, YamlCodec } from "../contracts/types.ts";

/* ── the fakes ─────────────────────────────────────────────────────────── */

interface MemFiles extends Files {
  commits: string[];
  at(rel: string): string | undefined;
  paths(): string[];
}

function memFiles(): MemFiles {
  const store = new Map<string, string>();
  const commits: string[] = [];
  return {
    async read(rel) {
      return store.get(rel) ?? null;
    },
    async write(rel, text) {
      store.set(rel, text);
    },
    async remove(rel) {
      store.delete(rel);
      // A page is a directory, so removing one removes everything under it —
      // which is what the real Files does with { recursive: true }.
      for (const k of [...store.keys()]) if (k.startsWith(rel + "/")) store.delete(k);
    },
    async list(rel) {
      // The real Files reads "" and "." as the root of the vault it was given.
      const prefix = rel === "" || rel === "." ? "" : rel + "/";
      const seen = new Map<string, boolean>();
      for (const k of store.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) seen.set(rest, false);
        else seen.set(rest.slice(0, cut), true);
      }
      // A real Files says ENOENT for a directory that is not there, and the
      // empty-vault path depends on that being survivable.
      if (seen.size === 0 && prefix !== "") throw new Error("ENOENT");
      const out: FileEntry[] = [];
      for (const [name, dir] of seen) out.push({ name, dir });
      return out;
    },
    async commit(message) {
      commits.push(message);
    },
    commits,
    at: (rel) => store.get(rel),
    paths: () => [...store.keys()].sort(),
  };
}

/** ONE DOCUMENT PER PAGE, and it is real YAML: `contents` is a list of maps and
 *  prose is a block scalar, so the hand-rolled flat parser this format used to
 *  need has nothing left to enforce. Bun's own YAML stands in for
 *  server/platform/yaml.ts here — what these tests need is a codec that
 *  round-trips, not a second copy of the one being written.
 *
 *  WHICH IS ALSO ITS LIMIT, and it is stated rather than worked around: this
 *  stand-in accepts any key, so the format's refusal of `kind:`, `render:`,
 *  `order:` and `parent:` BY NAME cannot be exercised through it. That refusal
 *  is the real codec's, and tests/platform.test.ts is where it is held. */
const yaml: YamlCodec = {
  parse: (text) => Bun.YAML.parse(text) as PageDoc,
  format: (doc) => Bun.YAML.stringify(doc),
  // Narrows nothing, which is the whole point of it: `markdown.yaml` is not a
  // page and must not be shaped like one on the way in.
  parseAny: (text) => Bun.YAML.parse(text),
};

/** pages.ts cannot see tables — that is a sibling — so it is handed the three
 *  fields it needs about them. The array is live: pushing to it is a table
 *  appearing in the tree, which is all this fake has to be able to say. */
interface FakeTable { name: string; rows: number; parent: string | null }

const vault = () => {
  const files = memFiles();
  const tables: FakeTable[] = [];
  const pages = makePages(files, yaml, () => tables);
  return { files, tables, pages, docs: makeDocs(files, yaml) };
};

/** Where a page's document is. Spelled out here rather than derived, so a test
 *  that passes is a test that agrees with the layout on disk. */
const dir = (id: string) => `pages/${id.split("/").join("/children/")}`;
const docAt = (files: MemFiles, id: string): PageDoc =>
  yaml.parse(files.at(`${dir(id)}/content.yaml`) ?? "");

/** What a page's `contents` actually holds, read back off disk rather than out
 *  of the drawn sections — an entry kept for a child that is not there draws
 *  nothing and is precisely what several of these tests are about. */
const contentsOf = (files: MemFiles, id: string): string[] =>
  (docAt(files, id).contents ?? []).map((c) => c.name);

/** The sections a page draws, by name. `page.sections` is the RESOLVED list. */
const drawn = (page: Page | null): string[] => (page?.sections ?? []).map((s) => s.name);

test("a drawn section carries the STORED entry it came from, which is what makes a copy a copy", async () => {
  // Everything else on a `DrawnSection` is resolved, and resolution is lossy in
  // the one direction duplicating needs: `html` is the markup and not the
  // filename, `parts` is loaded content and not the pointer, `vars` is the three
  // scopes already merged. A copy rebuilt from those would name no file, inline
  // what was a pointer, and bake the PAGE's variables into the section.
  const { files, pages } = vault();
  await pages.create({ name: "Rates" });
  await pages.writeFile("home/Rates", "band.html", `<div data-g-part="body"></div>`);
  await files.write("pages/home/children/Rates/content.yaml", yaml.format({
    name: "Rates",
    plugin: "doc",
    variables: { quarter: "Q3" },
    contents: [{
      name: "band",
      data: "band.html",
      variables: { tone: "loud" },
      parts: { body: "The rate is {{rate}}." },
    }],
  }));

  const page = await pages.read("home/Rates");
  const band = page!.sections[0]!;

  // The stored entry, exactly — the filename intact, the section's OWN variables
  // and not the merge, and the braces still braces.
  expect(band.source).toEqual({
    name: "band",
    data: "band.html",
    variables: { tone: "loud" },
    parts: { body: "The rate is {{rate}}." },
  });
  // Which is emphatically not what the resolved view says.
  expect(band.vars).toEqual({ quarter: "Q3", tone: "loud" });
  expect(band.html).toContain("data-g-part");

  // So duplicating is sending it back under a new name, and nothing else.
  await pages.setSections("home/Rates", [
    { name: "band" },
    { ...band.source, name: "band-copy" },
  ]);
  const copied = docAt(files, "home/Rates").contents[1]!;
  expect(copied).toEqual({ ...band.source, name: "band-copy" });
});

/* ── a slot that holds a list ──────────────────────────────────────────── */

test("a list in a slot resolves item by item, and writes back whole", async () => {
  // A REPEATING THING IS AN ARRAY, not one string cut up at a separator. The
  // separator was the problem: the section and the person typing had to agree
  // about a convention neither could see, and a heading typed by hand either
  // became an item or silently did not.
  const { files, pages } = vault();
  await pages.create({ name: "Board" });
  await pages.writeFile("home/Board", "cards.html", `<div data-g-part="items"></div>`);
  await files.write("pages/home/children/Board/content.yaml", yaml.format({
    name: "Board",
    plugin: "doc",
    variables: {},
    contents: [{
      name: "cards",
      data: "cards.html",
      parts: { items: ["### Alpha\n\nFirst.", "### Bravo\n\nSecond."] },
    }],
  }));

  const drawn = (await pages.read("home/Board"))!.sections[0]!;
  expect(drawn.parts.items).toEqual({
    kind: "list",
    items: [
      { kind: "markdown", md: "### Alpha\n\nFirst.", vars: {} },
      { kind: "markdown", md: "### Bravo\n\nSecond.", vars: {} },
    ],
  });

  // Written WHOLE: what the document holds is the array, so the array goes back.
  // A wire carrying one item and an index would have to be right about the index
  // at a moment when another edit may have moved it.
  await pages.writeSlot("home/Board", "cards", "items", [
    "### Alpha\n\nFirst, edited.",
    "### Bravo\n\nSecond.",
    "### Charlie\n\nAdded.",
  ]);
  const after = (await pages.read("home/Board"))!.sections[0]!;
  expect((after.parts.items as { kind: "list"; items: { md: string }[] }).items.map((i) => i.md))
    .toEqual(["### Alpha\n\nFirst, edited.", "### Bravo\n\nSecond.", "### Charlie\n\nAdded."]);

  // And it is still a LIST on disk rather than a joined string. How that list is
  // spelled is the real formatter's business and is checked where the formatter
  // is — this vault runs on a stand-in codec.
  expect(docAt(files, "home/Board").contents[0]!.parts!.items).toHaveLength(3);
});

test("an empty list is a real answer, and is what a slot holds before the first item", async () => {
  // Dropping it would leave nowhere to add one: the section draws no items, the
  // document says nothing, and there is no slot for a first write to land in.
  const { files, pages } = vault();
  await pages.create({ name: "Board" });
  await pages.writeFile("home/Board", "cards.html", `<div data-g-part="items"></div>`);
  await files.write("pages/home/children/Board/content.yaml", yaml.format({ plugin: "doc",
    name: "Board", variables: {},
    contents: [{ name: "cards", data: "cards.html", parts: { items: [] } }],
  }));

  const drawn = (await pages.read("home/Board"))!.sections[0]!;
  expect(drawn.parts.items).toEqual({ kind: "list", items: [] });

  await pages.writeSlot("home/Board", "cards", "items", ["### The first one"]);
  const after = (await pages.read("home/Board"))!.sections[0]!;
  expect((after.parts.items as { items: unknown[] }).items).toHaveLength(1);
});

/* ── the markdown type scale ───────────────────────────────────────────── */

test("a page's markdown scale is the workspace's, with its own merged over it", async () => {
  // The merge is per PROPERTY and not per file, which is the whole reason the
  // page-level file is usable: a page that wants a longer line says `measure`
  // and keeps the workspace's headings — and keeps them when the workspace
  // changes its mind about them, instead of holding a copy that drifts.
  const { files, pages } = vault();
  await pages.create({ name: "Brief" });

  await files.write("markdown.yaml", [
    "measure: 34rem",
    "h1: { size: 2.5rem, weight: 400 }",
    "p: { size: 1rem, leading: 1.6 }",
  ].join("\n"));

  const inherited = await pages.read("home/Brief");
  expect(inherited?.markdown).toEqual({
    "--md-measure": "34rem",
    "--md-h1-size": "2.5rem",
    "--md-h1-weight": "400",
    "--md-p-size": "1rem",
    "--md-p-leading": "1.6",
  });

  await files.write(dir("home/Brief") + "/markdown.yaml", "measure: 38rem\np: { size: 1.125rem }\n");
  const own = await pages.read("home/Brief");
  expect(own?.markdown).toEqual({
    "--md-measure": "38rem",          // the page's
    "--md-h1-size": "2.5rem",         // still the workspace's
    "--md-h1-weight": "400",
    "--md-p-size": "1.125rem",        // the page's
    "--md-p-leading": "1.6",          // still the workspace's, beside the override
  });

  // A scale that will not parse costs the SCALE and never the page. A type scale
  // is the last thing that should be able to stop a document opening.
  await files.write(dir("home/Brief") + "/markdown.yaml", "measure: [unclosed\n");
  const broken = await pages.read("home/Brief");
  expect(broken).not.toBeNull();
  expect(broken?.markdown["--md-measure"]).toBe("34rem"); // the house scale stands
  expect(drawn(broken)).toEqual(drawn(own));
});

/* ── the folder is the hierarchy ───────────────────────────────────────── */

test("a page is a directory holding content.yaml, and its id is the path to it", async () => {
  const { files, pages } = vault();

  const clients = await pages.create({ name: "Clients" });
  // Nothing is parentless but the root, and the top level is the root's
  // children — which is now a place on disk rather than a claim in a file.
  expect(clients.id).toBe("home/Clients");

  const ashgrove = await pages.create({ name: "Ashgrove", parent: clients.id });
  expect(ashgrove.id).toBe("home/Clients/Ashgrove");
  expect(files.at("pages/home/children/Clients/children/Ashgrove/content.yaml")).toBeDefined();

  // The parent is derived from the id and never stored, so the two cannot
  // disagree: there is only one of them.
  expect(parentOf(ashgrove.id)).toBe("home/Clients");
  expect(segmentOf(ashgrove.id)).toBe("Ashgrove");

  const page = await pages.read("home/Clients/Ashgrove");
  expect(page).not.toBeNull();
  expect(page!.id).toBe("home/Clients/Ashgrove");
  expect(page!.name).toBe("Ashgrove");
  // A page HOLDS SECTIONS and nothing else. There is no kind, because there is
  // one kind of page; no render, because a section carries its own html; and no
  // whole-sheet artifact, because a page whose reason to exist is the surface it
  // draws is one section whose `data` names the file that draws it.
  expect(page!.sections.map((s) => s.name)).toEqual(["title"]);
  expect(page!.plugin).toBe("doc");
  expect(page!.ports).toBeNull();

  // NO `parent:` ANYWHERE. A second statement of a fact is a chance for the two
  // to disagree, so the format does not have one to write.
  for (const path of files.paths().filter((p) => p.endsWith("content.yaml"))) {
    expect(files.at(path)).not.toContain("parent:");
  }

  // A DIRECTORY WITHOUT content.yaml IS NOT A PAGE. A silently empty page is a
  // page somebody spends an afternoon looking for the missing half of, so it
  // reads as nothing rather than as an empty something — and it is not a child
  // of the page whose `children/` it sits in either.
  await files.write("pages/home/children/Clients/children/draft/Notes.html", "<p/>");
  expect(await pages.read("home/Clients/draft")).toBeNull();
  expect((await pages.children("home/Clients")).map((c) => c.id)).toEqual(["home/Clients/Ashgrove"]);

  expect(await pages.read("home/Clients/nothing-here")).toBeNull();
});

test("children come off the directory, and a document claiming a parent says nothing", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Clients" });
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  await pages.create({ name: "Fenton", parent: "home/Clients" });
  await pages.create({ name: "Archive" });

  // Layer one: what this page holds, normalised, whether or not it draws any of
  // it. Nothing was declared and no page was asked who its parent is — reading
  // one directory is the whole of it. A child carries what it IS and what it is
  // called, and nothing about how it looks.
  expect(await pages.children("home/Clients")).toEqual([
    { kind: "page", id: "home/Clients/Ashgrove", name: "Ashgrove" },
    { kind: "page", id: "home/Clients/Fenton", name: "Fenton" },
  ]);
  expect((await pages.children("home")).map((c) => c.id)).toEqual(["home/Archive", "home/Clients"]);

  // A leftover `parent:` from a vault written before the change says nothing to
  // the tolerant reader: the page is where it is, and the file does not get a
  // vote. The real codec goes further and refuses the key outright, naming what
  // replaced it — this is the read path's half of the same sentence.
  await files.write(
    "pages/home/children/Archive/content.yaml",
    "name: Archive\nplugin: doc\nparent: home/Clients\nvariables: {}\ncontents: []\n",
  );
  expect((await pages.children("home/Clients")).map((c) => c.id))
    .toEqual(["home/Clients/Ashgrove", "home/Clients/Fenton"]);
  expect((await pages.children("home")).map((c) => c.id)).toEqual(["home/Archive", "home/Clients"]);

  // And the flat listing is the same tree, depth first.
  expect((await pages.list()).map((r) => r.id)).toEqual([
    "home", "home/Archive", "home/Clients", "home/Clients/Ashgrove", "home/Clients/Fenton",
  ]);
});

test("a child says when it was made where the store keeps a clock, and says nothing where it does not", async () => {
  // The in-memory store above has no clock, so no child carries `created` —
  // absent rather than invented. A store that answers `created` puts the
  // instant on every page child, off the page's own directory, and never on a
  // table.
  const { files, pages } = vault();
  await pages.create({ name: "Runs" });
  await pages.create({ name: "2026-09-20-10-04-first", parent: "home/Runs" });
  expect((await pages.children("home/Runs")).map((c) => c.created)).toEqual([undefined]);

  const asked: string[] = [];
  const clocked = Object.assign(files, {
    async created(rel: string) {
      asked.push(rel);
      return rel.endsWith("/2026-09-20-10-04-first") ? "2026-09-20T10:04:00.000Z" : null;
    },
  });
  const timed = makePages(clocked, yaml, () => []);
  await timed.create({ name: "2026-09-21-06-30-second", parent: "home/Runs" });
  const kids = await timed.children("home/Runs");
  expect(kids.map((c) => [c.id, c.created])).toEqual([
    ["home/Runs/2026-09-20-10-04-first", "2026-09-20T10:04:00.000Z"],
    ["home/Runs/2026-09-21-06-30-second", undefined],
  ]);
  // Asked about the page's directory, which is the thing that was made.
  expect(asked).toContain("pages/home/children/Runs/children/2026-09-20-10-04-first");
});

test("a child key is one segment, so two parents may each hold a notes", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Ashgrove" });
  await pages.create({ name: "Fenton" });
  const a = await pages.create({ name: "Notes", parent: "home/Ashgrove" });
  const b = await pages.create({ name: "Notes", parent: "home/Fenton" });

  // Two pages, two ids, one segment each. The filesystem already forbids two
  // `children/notes` in one place, so the key only has to be unique inside the
  // document it appears in.
  expect([a.id, b.id]).toEqual(["home/Ashgrove/Notes", "home/Fenton/Notes"]);
  await pages.read("home/Ashgrove"); // places the child, once, where it belongs
  await pages.read("home/Fenton");
  expect(contentsOf(files, "home/Ashgrove")).toEqual(["title", "@page-Notes"]);
  expect(contentsOf(files, "home/Fenton")).toEqual(["title", "@page-Notes"]);

  // Which keeps it a legal filename, which is what customising one entry needs:
  // the file becomes that SECTION's markup, so the parent draws the child
  // however it likes.
  await pages.writeFile("home/Ashgrove", "@page-Notes.html", "<span>Ashgrove's own</span>");
  expect(files.at("pages/home/children/Ashgrove/@page-Notes.html")).toBeDefined();

  const ashgrove = await pages.read("home/Ashgrove");
  expect(ashgrove!.sections[1]).toMatchObject({
    name: "@page-Notes",
    html: "<span>Ashgrove's own</span>",
    fallback: false,
  });
  // The other parent is untouched: the key is scoped to the file it is in, so it
  // is still the shipped default section with the child in its one slot.
  const fenton = await pages.read("home/Fenton");
  expect(fenton!.sections[1]!.html).toBe(DEFAULT_SECTION);
  expect(fenton!.sections[1]!.fallback).toBe(true);
  expect(fenton!.sections[1]!.parts[DEFAULT_SLOT]!.kind).toBe("child");
});

/* ── one file holds everything a page says ─────────────────────────────── */

test("a markdown slot carries its prose, raw, with the braces still in it", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Rendering rates" });

  // The document IS the page. There is no .md file beside it — invented figures.
  // A bare string is markdown, because prose is most of what a slot holds and
  // `body: "..."` should not need a wrapper; a map is a full Content.
  await files.write("pages/home/children/Rendering-rates/content.yaml", yaml.format({
    name: "Rendering rates",
    plugin: "doc",
    variables: { rate: 62, currency: "GBP" },
    contents: [
      { name: "intro", parts: { body: "# Rendering rates\nThe base rate is {{rate}}.\n" } },
      {
        name: "detail",
        parts: { body: { type: "markdown", data: "Two coats: {{rate}} the metre.\n", variables: { rate: 71 } } },
      },
    ],
  }));

  const page = await pages.read("home/Rendering-rates");
  expect(drawn(page)).toEqual(["intro", "detail"]);
  // Neither named a file, so both took the SHIPPED DEFAULT SECTION — which is a
  // file and not a branch, so `fallback` is what says the floor was used.
  for (const section of page!.sections) {
    expect(section.html).toBe(DEFAULT_SECTION);
    expect(section.fallback).toBe(true);
  }

  // RAW. Interpolation happens where the part is drawn, because prose is edited
  // in place and writes back: resolving here would round-trip 62 over the top of
  // {{rate}} the first time somebody touched the paragraph.
  expect(page!.sections[0]!.parts).toEqual({
    body: {
      kind: "markdown",
      md: "# Rendering rates\nThe base rate is {{rate}}.\n",
      vars: { rate: 62, currency: "GBP" },
    },
  });

  // THE NEAREST ONE WINS: a slot's own value over the section's over the page's,
  // so a bare name is always the closest one and never a surprise.
  expect(page!.sections[1]!.parts.body).toMatchObject({ vars: { rate: 71, currency: "GBP" } });
  // The section's own scope is what its slots start from.
  expect(page!.sections[1]!.vars).toEqual({ rate: 62, currency: "GBP" });
  // And the page's own are on the page.
  expect(page!.variables).toEqual({ rate: 62, currency: "GBP" });

  // No .md files were written, and none are read.
  expect(files.paths().some((p) => p.endsWith(".md"))).toBe(false);
});

test("a section is a div with any number of slots, which is the shape the format exists for", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Rates" });
  await pages.writeFile("home/Rates", "columns.html",
    '<div><div data-g-part="left"></div><div data-g-part="middle"></div><div data-g-part="right"></div></div>');
  await files.write("pages/home/children/Rates/content.yaml", yaml.format({
    name: "Rates",
    plugin: "doc",
    variables: {},
    contents: [{
      name: "columns",
      data: "columns.html",
      variables: { rate: 62 },
      parts: { left: "Preparation.\n", middle: "Two coats at {{rate}}.\n", right: "Making good.\n" },
    }],
  }));

  // THREE COLUMNS OF PROSE IS ONE SECTION WITH THREE MARKDOWN SLOTS, which the
  // shape before this could not express at all: one render owned the whole
  // sheet, so a page had exactly one treatment and prose was one column at one
  // measure. The section owns its own layout and the reading measure lives in
  // its file rather than on the sheet.
  const page = await pages.read("home/Rates");
  expect(page!.sections).toHaveLength(1);
  const section = page!.sections[0]!;
  expect(section.fallback).toBe(false);
  expect(Object.keys(section.parts).sort()).toEqual(["left", "middle", "right"]);
  for (const part of Object.values(section.parts)) {
    expect(part.kind).toBe("markdown");
    // Every slot in the section starts from the section's scope.
    expect(part.kind === "markdown" && part.vars).toEqual({ rate: 62 });
  }
});

/* ── PROSE WRITES BACK, and the words are in the document ──────────────── */

// The exit condition of the whole framework, at the layer that owns the format:
// prose used to live in `<id>.md` and go back through `writeFile`, and when it
// moved inside the document nothing could write it. A typed paragraph had
// nowhere to go.

test("a paragraph goes back into one slot, and nothing else in the document moves", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Rates" });
  // Written straight through the fake, not through `writeFile`: the commit this
  // test is counting is the one the keystroke path must not take, and setting
  // the page up is not part of it.
  await files.write("pages/home/children/Rates/split.html",
    '<div><div data-g-part="body"></div><div data-g-part="aside"></div></div>');
  await files.write("pages/home/children/Rates/content.yaml", yaml.format({
    name: "Rates",
    plugin: "doc",
    variables: { rate: 62 },
    contents: [
      {
        name: "intro",
        data: "split.html",
        variables: { vat: 20 },
        parts: { body: "The base rate is {{rate}}.\n", aside: "Excludes access equipment.\n" },
      },
      { name: "note", parts: { body: { type: "markdown", data: "Two coats.\n" } } },
    ],
  }));

  await pages.writeSlot("home/Rates", "intro", "body", "The base rate is {{rate}}, and VAT is {{vat}}.\n");

  const doc = docAt(files, "home/Rates");
  // ONE SLOT'S TEXT. It fires on a debounce while somebody is typing, so
  // everything it did not change has to survive it: the OTHER SLOT in the same
  // section, the section's own variables, its html file, the neighbouring
  // section's words, the page's values and its name.
  expect(doc.contents[0]).toEqual({
    name: "intro",
    data: "split.html",
    variables: { vat: 20 },
    parts: {
      // THE SHORT SPELLING SURVIVES A SAVE. It is the spelling somebody wrote,
      // and an edit to a plain paragraph is not the moment to rewrite it into a
      // three-line map.
      body: "The base rate is {{rate}}, and VAT is {{vat}}.\n",
      aside: "Excludes access equipment.\n",
    },
  });
  // And so does the long one, where that is what the document said.
  expect(doc.contents[1]).toEqual({ name: "note", parts: { body: { type: "markdown", data: "Two coats.\n" } } });
  expect(doc.variables).toEqual({ rate: 62 });
  expect(doc.name).toBe("Rates");

  // The long spelling keeps its shape through a write of its own.
  await pages.writeSlot("home/Rates", "note", "body", "Two coats, brushed.\n");
  expect(docAt(files, "home/Rates").contents[1]).toEqual({
    name: "note", parts: { body: { type: "markdown", data: "Two coats, brushed.\n" } },
  });

  // AND THE BRACES ARE STILL IN IT, which is the whole reason the read hands
  // prose back raw: what the caret is in is the template, so what comes back is
  // the template, and 62 never lands on top of {{rate}}.
  expect(files.at("pages/home/children/Rates/content.yaml")).toContain("{{rate}}");
  expect((await pages.read("home/Rates"))!.sections[0]!.parts.body).toMatchObject({
    kind: "markdown", md: "The base rate is {{rate}}, and VAT is {{vat}}.\n",
  });

  // NO COMMIT. This is a keystroke path, and a commit per debounce would bury
  // the agent writes the vault's history exists to make undoable.
  expect(files.commits).toEqual([]);
});

test("an empty slot the section DECLARES can be typed into; a name it does not is refused", async () => {
  // "The words are always editable" was true of every slot except the empty
  // ones, which are the ones most in need of it: a section's markup says
  // `data-g-part="note"` and the yaml simply has nothing in it yet, which is
  // exactly the state somebody is in the moment before they type the first word.
  const { files, pages } = vault();
  await pages.create({ name: "Rates" });
  await pages.writeFile(
    "home/Rates",
    "band.html",
    `<div><div data-g-part="lede"></div><div data-g-part='aside'></div></div>`,
  );
  await files.write("pages/home/children/Rates/content.yaml", yaml.format({
    name: "Rates",
    plugin: "doc",
    variables: {},
    contents: [{ name: "band", data: "band.html", parts: {} }],
  }));

  // Declared in the markup and absent from the yaml: created, as a bare string,
  // because that is the spelling the format already has for prose.
  await pages.writeSlot("home/Rates", "band", "lede", "# First words");
  expect(files.at("pages/home/children/Rates/content.yaml")).toContain("# First words");
  // Either quoting, because a section author writes both.
  await pages.writeSlot("home/Rates", "band", "aside", "A note.");
  expect(files.at("pages/home/children/Rates/content.yaml")).toContain("A note.");

  // AND THE GUARD SURVIVES. The markup is asked, not merely the caller — so a
  // typo still lands on "no such slot" rather than writing a key into
  // `content.yaml` that nothing draws and nobody can ever see.
  await expect(pages.writeSlot("home/Rates", "band", "leed", "oops")).rejects.toThrow();
  expect(files.at("pages/home/children/Rates/content.yaml")).not.toContain("oops");

  // A section that named no file draws the shipped default, so the default's own
  // slot is declared for it and typing into a fresh section works.
  await files.write("pages/home/children/Rates/content.yaml", yaml.format({ plugin: "doc",
    name: "Rates", variables: {}, contents: [{ name: "plain", parts: {} }],
  }));
  await pages.writeSlot("home/Rates", "plain", DEFAULT_SLOT, "Typed into a new section.");
  expect(files.at("pages/home/children/Rates/content.yaml")).toContain("Typed into a new section.");
});

test("only a markdown slot carries its own words, and every other kind is refused", async () => {
  const { files, pages, tables } = vault();
  await pages.create({ name: "Rates" });
  await pages.create({ name: "Ashgrove", parent: "home/Rates" });
  tables.push({ name: "jobs", rows: 2, parent: "home/Rates" });
  await pages.writeFile("home/Rates", "calc.html", "<div>the calculator</div>");
  await files.write("pages/home/children/Rates/content.yaml", yaml.format({
    name: "Rates",
    plugin: "doc",
    variables: {},
    contents: [{
      name: "calc",
      parts: { frame: { type: "html", data: "calc.html" }, grid: { type: "table", data: "jobs" } },
    }],
  }));
  await pages.read("home/Rates"); // places the two children

  // `data` means something different for every other type — a filename, a table,
  // a child's segment — so writing prose into one would not be an edit, it would
  // destroy the pointer. Refused rather than allowed to happen once. The child
  // sections were reconciled into the slot the shipped default declares.
  const refused: [string, string][] = [
    ["calc", "frame"], ["calc", "grid"],
    ["@page-Ashgrove", DEFAULT_SLOT], ["@table-jobs", DEFAULT_SLOT],
  ];
  for (const [section, part] of refused) {
    await expect(pages.writeSlot("home/Rates", section, part, "# Words")).rejects.toThrow();
  }
  expect(files.at("pages/home/children/Rates/content.yaml")).not.toContain("# Words");
  expect(files.at("pages/home/children/Rates/calc.html")).toBe("<div>the calculator</div>");

  // A slot nobody has, a section nobody wrote, a page nobody made, and a
  // document that will not parse — the last of which is repaired through the raw
  // fallback and never rewritten from a document that could not be read.
  await expect(pages.writeSlot("home/Rates", "calc", "nothing", "# Words")).rejects.toThrow();
  await expect(pages.writeSlot("home/Rates", "nothing", DEFAULT_SLOT, "# Words")).rejects.toThrow();
  await expect(pages.writeSlot("home/nowhere", "intro", DEFAULT_SLOT, "# Words")).rejects.toThrow();
  const broken = "name: Broken\nplugin: doc\ncontents:\n - name: calc\n  parts: {}\n";
  await files.write("pages/home/children/Broken/content.yaml", broken);
  await expect(pages.writeSlot("home/Broken", "calc", DEFAULT_SLOT, "# Words")).rejects.toThrow();
  expect(files.at("pages/home/children/Broken/content.yaml")).toBe(broken);
});

test("the list IS the order, so adding, reordering and removing are one write", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Notes" });
  await files.write("pages/home/children/Notes/content.yaml", yaml.format({
    name: "Notes",
    plugin: "doc",
    variables: {},
    contents: [
      { name: "a", parts: { body: "First.\n" } },
      { name: "b", parts: { body: "Second.\n" }, variables: { rate: 62 } },
      { name: "c", parts: { body: "Third.\n" } },
    ],
  }));

  // Reordered, with one added and one gone, in one call. The caller sends the
  // list it can see — and its idea of what `b` SAYS is deliberately stale.
  const left = await pages.setSections("home/Notes", [
    { name: "b", parts: { body: "something else entirely" } },
    { name: "d", parts: { body: "Fourth.\n" } },
    { name: "a", parts: { body: "First.\n" } },
  ]);

  expect(left.map((c) => c.name)).toEqual(["b", "d", "a"]);
  expect(contentsOf(files, "home/Notes")).toEqual(["b", "d", "a"]);
  // A NAME ALREADY IN THE DOCUMENT KEEPS ITS OWN SECTION and takes only its new
  // position — its markup, its slots and its variables all. That is what makes
  // it safe to build this list out of what is on screen while somebody is typing
  // into it.
  const doc = docAt(files, "home/Notes");
  expect(doc.contents[0]).toEqual({ name: "b", parts: { body: "Second.\n" }, variables: { rate: 62 } });
  // A new name is added exactly as it was given.
  expect(doc.contents[1]).toEqual({ name: "d", parts: { body: "Fourth.\n" } });
  // AND AN ABSENT ONE IS REMOVED WITH ITS TEXT: `c` is gone, words and all,
  // because the words are IN the entry.
  expect(files.at("pages/home/children/Notes/content.yaml")).not.toContain("Third.");

  // One commit for one thing the user did — this one is a change to the shape of
  // a page, unlike the keystroke path above.
  expect(files.commits).toHaveLength(1);
  // And a list that is already what the document says writes nothing at all.
  await pages.setSections("home/Notes", doc.contents);
  expect(files.commits).toHaveLength(1);
});

test("a child's section is not the caller's to place, and not theirs to lose", async () => {
  const { files, pages, tables } = vault();
  await pages.create({ name: "Clients" });
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  tables.push({ name: "jobs", rows: 2, parent: "home/Clients" });
  await files.write("pages/home/children/Clients/content.yaml", yaml.format({
    name: "Clients",
    plugin: "doc",
    variables: {},
    contents: [
      { name: "@page-Ashgrove", parts: { [DEFAULT_SLOT]: { type: "child", data: "Ashgrove" } } },
      { name: "intro", parts: { body: "Who we work for.\n" } },
      { name: "@table-jobs", parts: { [DEFAULT_SLOT]: { type: "child", data: "jobs" } } },
    ],
  }));

  // A CHILD SECTION THE CALLER LEFT OUT IS PUT BACK, WHERE IT WAS. It is
  // reconciled rather than written, so dropping it would only make the next read
  // reappend it at the bottom — and a reorder of two paragraphs would move
  // somebody's child to the end of the page with nothing to say why.
  const left = await pages.setSections("home/Clients", [
    { name: "outro", parts: { body: "Ask for a quote.\n" } },
    { name: "intro", parts: { body: "Who we work for.\n" } },
  ]);
  expect(left.map((c) => c.name)).toEqual(["@page-Ashgrove", "outro", "@table-jobs", "intro"]);
  // And the page still draws both children, in the order the document now says.
  expect(drawn(await pages.read("home/Clients")))
    .toEqual(["@page-Ashgrove", "outro", "@table-jobs", "intro"]);

  // A child key the caller INVENTED is refused: a section standing for a child
  // that does not exist draws nothing and would sit in the document forever.
  // Making the child is what makes its section, exactly as removing the child is
  // what removes it.
  const before = files.at("pages/home/children/Clients/content.yaml");
  await expect(pages.setSections("home/Clients", [
    ...left, { name: "@page-Fenton", parts: { [DEFAULT_SLOT]: { type: "child", data: "Fenton" } } },
  ])).rejects.toThrow(/child/);
  expect(files.at("pages/home/children/Clients/content.yaml")).toBe(before);

  // Two sections with one name is refused too: it would give a slot write two
  // places to land and the reader no way to say which.
  await expect(pages.setSections("home/Clients", [
    { name: "intro", parts: { body: "a" } },
    { name: "intro", parts: { body: "b" } },
  ])).rejects.toThrow();
  expect(files.at("pages/home/children/Clients/content.yaml")).toBe(before);
});

test("a section dropped from the list keeps its file, because a file is not text", async () => {
  // `setSections` is about the LIST. `removeSection` is the operation that owns a
  // section and everything on disk behind it, in one request and one commit —
  // which is why the delete control still goes through it and this one does not
  // reach for a file it was never told about.
  const { files, pages } = vault();
  await pages.create({ name: "Rates" });
  await pages.writeFile("home/Rates", "calc.html", "<div>the calculator</div>");
  await files.write("pages/home/children/Rates/content.yaml", yaml.format({ plugin: "doc",
    name: "Rates", variables: {},
    contents: [{ name: "calc", data: "calc.html", parts: {} }],
  }));

  await pages.setSections("home/Rates", []);
  expect(contentsOf(files, "home/Rates")).toEqual([]);
  expect(files.at("pages/home/children/Rates/calc.html")).toBe("<div>the calculator</div>");
});

test("a section names the file that draws it, and an html slot names one beside the document", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Quote calculator" });

  // HTML is long, is code rather than prose, and is the one thing a person is
  // not editing in a field — so it stays a file, at BOTH levels: the section's
  // own markup, and an html slot inside it. Every string either one SHOWS is
  // still a variable.
  //
  // A PAGE THAT TAKES THE WHOLE SHEET IS THIS AND NOTHING MORE: one section
  // whose `data` names the file that draws it. There is no page kind and no
  // second parser path for it.
  await pages.writeFile("home/Quote-calculator", "calc.html", "<section class=calc></section>");
  await pages.writeFile("home/Quote-calculator", "figure.html", "<figure>the plan</figure>");
  await files.write("pages/home/children/Quote-calculator/content.yaml", yaml.format({
    name: "Quote calculator",
    plugin: "doc",
    variables: { crew: 2 },
    contents: [
      {
        name: "calc",
        data: "calc.html",
        variables: { title: "What a job costs" },
        parts: {
          plan: { type: "html", data: "figure.html" },
          missing: { type: "html", data: "gone.html" },
        },
      },
      { name: "lost", data: "gone.html", parts: { body: "The words are still here.\n" } },
    ],
  }));

  const page = await pages.read("home/Quote-calculator");
  const calc = page!.sections[0]!;
  expect(calc.html).toBe("<section class=calc></section>");
  expect(calc.fallback).toBe(false);
  expect(calc.parts.plan).toEqual({
    kind: "html",
    file: "figure.html",
    html: "<figure>the plan</figure>",
    vars: { crew: 2, title: "What a job costs" },
  });
  // A named file that is not there is an EMPTY slot rather than a missing one:
  // the entry is in the document, somebody can see it, and a slot that quietly
  // vanished would leave nothing to repair from.
  expect(calc.parts.missing).toEqual({
    kind: "html", file: "gone.html", html: "", vars: { crew: 2, title: "What a job costs" },
  });

  // A SECTION naming a file that is not on disk takes the default too, and
  // `fallback` says so. The slots still draw, so the words are still on screen
  // and the fault reads as a section that lost its layout rather than as a page
  // that lost a section.
  const lost = page!.sections[1]!;
  expect(lost.html).toBe(DEFAULT_SECTION);
  expect(lost.fallback).toBe(true);
  expect(lost.parts.body).toMatchObject({ kind: "markdown", md: "The words are still here.\n" });

  // Nothing addressed by a section or a slot may leave the page directory. The
  // slot is dropped and the section falls back to the default — in neither case
  // is a file outside the directory read.
  await files.write("pages/home/children/Quote-calculator/content.yaml", yaml.format({ plugin: "doc",
    name: "Quote calculator", variables: {},
    contents: [{ name: "calc", data: "../../../secrets.html", parts: { out: { type: "html", data: "../../../secrets.html" } } }],
  }));
  const escaped = (await pages.read("home/Quote-calculator"))!.sections[0]!;
  expect(escaped.html).toBe(DEFAULT_SECTION);
  expect(escaped.fallback).toBe(true);
  expect(escaped.parts).toEqual({});
});

test("a table on a page is a section whose one slot holds a table, and contents is the order", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Jobs this week" });
  await files.write("pages/home/children/Jobs-this-week/content.yaml", yaml.format({ plugin: "doc",
    name: "Jobs this week", variables: {},
    contents: [
      { name: "grid", parts: { body: { type: "table", data: "jobs" } } },
      { name: "intro", parts: { body: "Everything booked in.\n" } },
    ],
  }));

  const page = await pages.read("home/Jobs-this-week");
  expect(page!.sections[0]!.parts.body).toEqual({ kind: "table", table: "jobs" });
  // ONE SHAPE, ONE CODE PATH. A table is not a different kind of entry with its
  // own parser: the two sections here are read identically and draw with the
  // same default markup, and only what is in the slot differs.
  expect(page!.sections[0]!.html).toBe(page!.sections[1]!.html);
  expect([page!.sections[0]!.fallback, page!.sections[1]!.fallback]).toEqual([true, true]);
  // There is no `order:` any more, because the list is the order. Reordering is
  // moving an entry, which is the same edit a person would make by hand.
  expect(drawn(page)).toEqual(["grid", "intro"]);
});

/* ── children: there is no folder ──────────────────────────────────────── */

test("there is no folder, and a page that draws its children is what one was", async () => {
  const { pages, tables } = vault();
  await pages.create({ name: "Clients" });
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  tables.push({ name: "jobs", rows: 4, parent: "home/Clients" });

  // Layer two: every child is guaranteed a SECTION, keyed off the child itself,
  // and it is the shipped default section with the child in its one slot —
  // because that is what will draw it until somebody writes a file beside the
  // document.
  const page = await pages.read("home/Clients");
  expect(drawn(page)).toEqual(["title", "@page-Ashgrove", "@table-jobs"]);
  for (const section of page!.sections.slice(1)) {
    expect(section.fallback).toBe(true);
    expect(Object.keys(section.parts)).toEqual([DEFAULT_SLOT]);
  }
  // Resolved at read time, so the runtime has the child's name and kind without
  // a second call.
  expect(page!.sections[1]!.parts[DEFAULT_SLOT]).toEqual({
    kind: "child",
    child: { kind: "page", id: "home/Clients/Ashgrove", name: "Ashgrove" },
  });
  // A table sits in the tree beside pages, under the page that uses it.
  expect(page!.sections[2]!.parts[DEFAULT_SLOT]).toEqual({
    kind: "child",
    child: { kind: "table", id: "jobs", name: "jobs", rows: 4 },
  });
});

// CASE IS KEPT AND CASE IS FOLDED, in exactly two places. A page id carries the
// case somebody wrote, because the id is the folder, the URL and the mirror file
// and a vault should look like the vault. What that costs is one rule: two
// siblings may not differ only in case. On macOS or Windows they are ONE
// directory, so the second page would be written into the first one's folder and
// take it with it — a data loss that would happen on somebody else's machine and
// never on the one it was written on.
test("a page id keeps its case, and two siblings may not differ only in it", async () => {
  const { files, pages } = vault();

  // Kept, verbatim, in the id and on disk. Not a slug of the name.
  const companies = await pages.create({ name: "Companies" });
  expect(companies.id).toBe("home/Companies");
  const airtable = await pages.create({ name: "Airtable", parent: companies.id });
  expect(airtable.id).toBe("home/Companies/Airtable");
  expect(files.at("pages/home/children/Companies/children/Airtable/content.yaml")).toBeDefined();

  // Underscores survive too: these are a person's file names — `Office_Hours`,
  // `HTML_And_Markdown` — and folding them produced an id nobody recognised.
  expect((await pages.create({ name: "Office_Hours" })).id).toBe("home/Office_Hours");
  expect((await pages.create({ name: "HTML_And_Markdown" })).id).toBe("home/HTML_And_Markdown");

  // A leading `_` is still refused a position, because that is what keeps
  // `_markdown` and `_assets` out of the page tree.
  expect((await pages.create({ name: "_assets" })).id).toBe("home/assets");

  // AND THE ONE RULE. `airtable` does not become a second page beside
  // `Airtable`; it is taken, so it gets the suffix a taken name always gets.
  const second = await pages.create({ name: "airtable", parent: companies.id });
  expect(second.id).toBe("home/Companies/airtable-2");
  // Which is a real second page, with its own directory and its own name.
  expect((await pages.read(second.id))!.name).toBe("airtable");

  // The same rule on the way in from somewhere else. `Airtable` at the top level
  // cannot move under `Companies`, which already holds one by that name in
  // another spelling — and the refusal is here rather than left to a filesystem
  // that would answer differently on a Mac than on this machine.
  const loose = await pages.create({ name: "AIRTABLE" });
  expect(loose.id).toBe("home/AIRTABLE");
  await expect(pages.move(loose.id, companies.id)).rejects.toThrow();
  // Nothing was half-done: it is still where it was.
  expect(await pages.read(loose.id)).not.toBeNull();

  // AND THE GUARDS THAT PROTECT THE WORKSPACE ITSELF FOLD TOO, which only
  // matters because case-keeping made a mis-cased id reachable: the segment
  // grammar used to refuse `Home` outright.
  //
  // On macOS or Windows `pages/Home` IS `pages/home`, so an exact compare here
  // would let a remove of a page that does not exist delete the root and every
  // page under it.
  await expect(pages.remove("HOME")).rejects.toThrow();
  expect(await pages.read("home")).not.toBeNull();
  // And a page cannot be moved inside its own descendant in another spelling,
  // which would copy a directory into itself and not terminate.
  await expect(pages.move(companies.id, "home/COMPANIES/Airtable")).rejects.toThrow();
  expect(await pages.read(airtable.id)).not.toBeNull();
});

// SIBLINGS SORT BY ID AND NEVER BY NAME, and a vault of dated notes is the case
// that proves it: the date is at the front of the FILENAME because somebody put
// it there to sort, and the page's title carries no date at all. Sorting by name
// turned seven pivots into an alphabetical list of titles and the folder stopped
// reading as a history.
test("children nobody has placed come back in id order, not title order", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "pivots" });

  // Written the way the importer writes them: the id is the dated filename, the
  // name is the note's own heading.
  const made = [
    ["2026-07-30-22-autonomous-is-the-promise", "Pivot: Autonomous Is the Promise"],
    ["2026-05-20-23-pipeline-simplified", "Pivot: Customization Pipeline Simplified"],
    ["2026-07-28-01-agentic-editing-all-in", "Pivot: All-In on Agentic Editing"],
  ];
  for (const [segment, name] of made) {
    await files.write(
      `pages/home/children/pivots/children/${segment}/content.yaml`,
      `name: ${name}\nplugin: doc\ncontents: []\n`,
    );
  }

  // Date order, which is id order. By NAME this would be All-In, Autonomous,
  // Customization — three titles in an order that says nothing.
  expect((await pages.children("home/pivots")).map((c) => c.id)).toEqual([
    "home/pivots/2026-05-20-23-pipeline-simplified",
    "home/pivots/2026-07-28-01-agentic-editing-all-in",
    "home/pivots/2026-07-30-22-autonomous-is-the-promise",
  ]);
  // And the placement the READER persists is that same order, so it survives.
  // `children` reads and never writes — asking a page what it holds must not
  // commit to the vault — so the order is written down by the read.
  await pages.read("home/pivots");
  expect(contentsOf(files, "home/pivots").filter((n) => n.startsWith("@page-"))).toEqual([
    "@page-2026-05-20-23-pipeline-simplified",
    "@page-2026-07-28-01-agentic-editing-all-in",
    "@page-2026-07-30-22-autonomous-is-the-promise",
  ]);
});

test("reconciliation is additive: appended at the bottom, then never moved and never dropped", async () => {
  const { files, pages, tables } = vault();
  await pages.create({ name: "Clients" });
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  tables.push({ name: "jobs", rows: 2, parent: "home/Clients" });

  // Add something to a folder and it turns up at the end.
  expect(drawn(await pages.read("home/Clients"))).toEqual(["title", "@page-Ashgrove", "@table-jobs"]);
  // Persisted, or the position could not survive the next read.
  const written = files.at("pages/home/children/Clients/content.yaml")!;
  expect(contentsOf(files, "home/Clients")).toEqual(["title", "@page-Ashgrove", "@table-jobs"]);

  // And stable: a read that finds every child already placed writes nothing at
  // all, because a rewrite per read would put a commit in the vault every time a
  // page was opened.
  await pages.read("home/Clients");
  expect(files.at("pages/home/children/Clients/content.yaml")).toBe(written);

  // The user dragged it to the top. Nothing may put it back.
  const doc = docAt(files, "home/Clients");
  const byName = (n: string) => doc.contents.find((c) => c.name === n)!;
  await files.write("pages/home/children/Clients/content.yaml", yaml.format({ plugin: "doc",
    ...doc,
    contents: [byName("@table-jobs"), byName("title"), byName("@page-Ashgrove")],
  }));
  await pages.create({ name: "Fenton", parent: "home/Clients" });
  expect(drawn(await pages.read("home/Clients")))
    .toEqual(["@table-jobs", "title", "@page-Ashgrove", "@page-Fenton"]);
  // Layer one follows the same order, so a page drawing its own children its own
  // way gets what the user arranged rather than a second opinion.
  expect((await pages.children("home/Clients")).map((c) => c.id))
    .toEqual(["jobs", "home/Clients/Ashgrove", "home/Clients/Fenton"]);

  // A child that goes away keeps its place — the same rule a section with no
  // file already follows — so if it comes back it comes back where it was.
  await pages.remove("home/Clients/Ashgrove");
  expect(drawn(await pages.read("home/Clients"))).toEqual(["@table-jobs", "title", "@page-Fenton"]);
  expect(contentsOf(files, "home/Clients")).toContain("@page-Ashgrove");

  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  expect(drawn(await pages.read("home/Clients")))
    .toEqual(["@table-jobs", "title", "@page-Ashgrove", "@page-Fenton"]);

  // And the child section says which child, in ONE SEGMENT, in the slot the
  // shipped default declares — so the document reads as a sentence about this
  // page rather than about the vault.
  expect(docAt(files, "home/Clients").contents.find((c) => c.name === "@page-Ashgrove"))
    .toEqual({ name: "@page-Ashgrove", parts: { [DEFAULT_SLOT]: { type: "child", data: "Ashgrove" } } });
});

test("a page decides how it looks inside its parent, and the parent may still overrule it", async () => {
  const { files, pages, tables } = vault();
  await pages.create({ name: "Clients" });
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  await pages.create({ name: "Fenton", parent: "home/Clients" });
  tables.push({ name: "jobs", rows: 2, parent: "home/Clients" });

  // Neither child has said anything yet, so both parts are exactly what they
  // were and the child plugin draws its built-in row for each.
  const at = async (name: string) =>
    (await pages.read("home/Clients"))!.sections.find((s) => s.name === name)!;
  for (const name of ["@page-Ashgrove", "@page-Fenton"]) {
    const part = (await at(name)).parts[DEFAULT_SLOT]!;
    expect(part.kind).toBe("child");
    expect(part).not.toHaveProperty("draw");
  }

  // Written into the CHILD's directory, not the parent's. Nothing was declared:
  // a page knows how it wants to be summarised better than every page that might
  // hold it, and one file travels with it instead of one per parent going stale
  // behind it.
  await pages.writeFile("home/Clients/Ashgrove", "child.html", "<span id=kd-nm></span>");
  expect((await at("@page-Ashgrove")).parts[DEFAULT_SLOT])
    .toHaveProperty("draw", { file: "child.html", html: "<span id=kd-nm></span>" });
  expect((await at("@page-Fenton")).parts[DEFAULT_SLOT]).not.toHaveProperty("draw");

  // The PARENT's own file wins, because a parent is looking at this particular
  // arrangement and the child is not — and it wins by becoming that SECTION's
  // markup. When it does, the child's own file is not sent: it would be markup
  // nothing asked for.
  await pages.writeFile("home/Clients", "@page-Ashgrove.html", "<span>this parent's own</span>");
  const over = await at("@page-Ashgrove");
  expect(over.html).toBe("<span>this parent's own</span>");
  expect(over.fallback).toBe(false);
  expect(over.parts[DEFAULT_SLOT]).not.toHaveProperty("draw");

  // Dropping it falls back to the CHILD's, not to the built-in row. Two ways to
  // say it, and they stack rather than compete.
  await files.remove("pages/home/children/Clients/@page-Ashgrove.html");
  const back = await at("@page-Ashgrove");
  expect(back.fallback).toBe(true);
  expect(back.parts[DEFAULT_SLOT]).toHaveProperty("draw", { file: "child.html", html: "<span id=kd-nm></span>" });

  // A TABLE NEVER GETS ONE: it has no directory for the file to be in, so none
  // is looked for and the built-in row is the whole of its drawing.
  await files.write("pages/home/children/Clients/children/jobs/child.html", "<span></span>");
  expect((await at("@table-jobs")).parts[DEFAULT_SLOT]).not.toHaveProperty("draw");
});

test("a new page carries the bundled default, and deleting it still reads and still draws", async () => {
  const { files, pages } = vault();
  // The default lives in the vault at `base/child/index.html`, put there by the
  // seeder along with the rest of `base/`. Reading it out of the vault is what
  // makes it the WORKSPACE's default rather than a constant in the framework.
  await files.write("base/child/index.html", "<span id=kd-nm></span>");

  await pages.create({ name: "Clients" });
  const ref = await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  expect(files.at(`${dir(ref.id)}/child.html`)).toBe("<span id=kd-nm></span>");
  expect((await pages.read("home/Clients"))!.sections[1]!.parts[DEFAULT_SLOT]).toHaveProperty("draw");

  // It is NOT a section of the page it lives in: nothing derives contents off
  // disk, so the page draws what its document says and nothing else.
  expect(drawn(await pages.read(ref.id))).toEqual(["title"]);

  // DELETING IT IS SUPPORTED. The page still reads, the part is exactly what it
  // was, and nothing on the read path puts the file back.
  await files.remove(`${dir(ref.id)}/child.html`);
  expect((await pages.read(ref.id))!.name).toBe("Ashgrove");
  const part = (await pages.read("home/Clients"))!.sections[1]!.parts[DEFAULT_SLOT]!;
  expect(part.kind).toBe("child");
  expect(part).not.toHaveProperty("draw");
  expect(files.at(`${dir(ref.id)}/child.html`)).toBeUndefined();
});

test("the root page holds the top level: it exists, no parent means it, and it cannot be removed", async () => {
  const { pages, docs } = vault();

  const ref = await pages.create({ name: "Team notes" });
  expect(ref.id).toBe("home/Team-notes"); // nothing is parentless but the root itself

  expect((await pages.read("home"))!.id).toBe("home");
  expect((await pages.children("home")).map((c) => c.id)).toEqual(["home/Team-notes"]);
  await expect(pages.remove("home")).rejects.toThrow();

  // Its name is the user's to change; its id is not.
  await docs.writeRaw("home", yaml.format({ plugin: "doc", name: "Everything", variables: {}, contents: [] }));
  expect((await pages.read("home"))!.name).toBe("Everything");
  expect((await pages.list()).find((r) => r.id === "home")!.name).toBe("Everything");
});

/* ── moving a page moves its directory ─────────────────────────────────── */

test("moving a page moves its subtree, and every id beneath it changes", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Clients" });
  await pages.create({ name: "Archive" });
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  await pages.create({ name: "Site A", parent: "home/Clients/Ashgrove" });
  await pages.writeFile("home/Clients/Ashgrove/Site-A", "plan.html", "<figure>the plan</figure>");
  await pages.read("home/Clients"); // somebody was looking at it, so the child is placed

  const now = await pages.move("home/Clients/Ashgrove", "home/Archive");
  expect(now).toBe("home/Archive/Ashgrove");

  // The whole subtree came with it, files and all — the directory IS the page,
  // so there was nothing else to move.
  expect((await pages.read("home/Archive/Ashgrove"))!.name).toBe("Ashgrove");
  expect((await pages.read("home/Archive/Ashgrove/Site-A"))!.name).toBe("Site A");
  expect(files.at("pages/home/children/Archive/children/Ashgrove/children/Site-A/plan.html"))
    .toBe("<figure>the plan</figure>");

  // AND THE OLD IDS ARE GONE. Nothing forwards: a client holding one gets a
  // visible not-found rather than somebody else's page.
  expect(await pages.read("home/Clients/Ashgrove")).toBeNull();
  expect(await pages.read("home/Clients/Ashgrove/Site-A")).toBeNull();
  expect(files.paths().some((p) => p.includes("clients/children/ashgrove"))).toBe(false);
  expect((await pages.children("home/Clients")).map((c) => c.id)).toEqual([]);
  expect((await pages.children("home/Archive")).map((c) => c.id)).toEqual(["home/Archive/Ashgrove"]);

  // The old parent's section keeps its place and simply does not draw, which is
  // the same rule a child that was deleted follows.
  expect(contentsOf(files, "home/Clients")).toContain("@page-Ashgrove");
  expect(drawn(await pages.read("home/Clients"))).toEqual(["title"]);
  // The new parent gained one at the bottom.
  expect(drawn(await pages.read("home/Archive"))).toEqual(["title", "@page-Ashgrove"]);

  // A page cannot be moved inside itself, the root cannot be moved at all, and
  // two pages cannot take one directory.
  await expect(pages.move("home/Archive/Ashgrove", "home/Archive/Ashgrove/Site-A")).rejects.toThrow();
  await expect(pages.move("home", "home/Archive")).rejects.toThrow();
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  await expect(pages.move("home/Clients/Ashgrove", "home/Archive")).rejects.toThrow();

  // The vault is committed first, so the cascade is one revert away.
  expect(files.commits.filter((m) => m.includes("moving"))).toHaveLength(1);
});

/* ── removing a section: the entry, its files, and its variables ────────── */

test("a section is an entry, its own variables and the files it names, and removing it takes all of them", async () => {
  const { files, pages } = vault();
  await pages.create({ name: "Team notes" });
  await pages.writeFile("home/Team-notes", "calc.html", "<div>the calculator</div>");
  await pages.writeFile("home/Team-notes", "figure.html", "<figure/>");
  await files.write("pages/home/children/Team-notes/content.yaml", yaml.format({
    name: "Team notes",
    plugin: "doc",
    variables: { week: 32 },
    contents: [
      { name: "title", parts: { body: "# Team notes\n" } },
      {
        name: "calc",
        data: "calc.html",
        variables: { heading: "Quote", save: "Save" },
        parts: { plan: { type: "html", data: "figure.html" } },
      },
      { name: "note", parts: { body: "The rates are in the table.\n" }, variables: { label: "Rates" } },
    ],
  }));

  const left = await pages.removeSection("home/Team-notes", "calc");
  expect(left).toEqual(["title", "note"]);

  // ONE EDIT TO ONE DOCUMENT, plus every file the section named — its own markup
  // AND the file of every html slot in it. The variables went with the entry
  // because they were IN the entry; there is no third place to forget.
  expect(contentsOf(files, "home/Team-notes")).toEqual(["title", "note"]);
  expect(files.at("pages/home/children/Team-notes/calc.html")).toBeUndefined();
  expect(files.at("pages/home/children/Team-notes/figure.html")).toBeUndefined();
  expect(files.at("pages/home/children/Team-notes/content.yaml")).not.toContain("Quote");

  // The neighbour is untouched, variables and all.
  const after = docAt(files, "home/Team-notes");
  expect(after.contents.find((c) => c.name === "note")!.variables).toEqual({ label: "Rates" });
  expect(after.variables).toEqual({ week: 32 });

  // One commit for one thing the user did.
  expect(files.commits.filter((m) => m.includes("section"))).toHaveLength(1);
});

test("removing a section is tolerant where it should be and refuses where it must", async () => {
  const { files, pages, tables } = vault();
  await pages.create({ name: "Team notes" });

  // Nothing to do is not an error: a section already gone is the state asked
  // for, and a commit for a no-op is noise in the history.
  expect(await pages.removeSection("home/Team-notes", "gone")).toEqual(["title"]);
  expect(files.commits).toEqual([]);

  // The last one leaves a valid empty page: it still lists, still opens, still
  // has a name, and a new section can be written straight back into it.
  expect(await pages.removeSection("home/Team-notes", "title")).toEqual([]);
  expect((await pages.read("home/Team-notes"))!.sections).toEqual([]);
  expect((await pages.list()).map((r) => r.id).sort()).toEqual(["home", "home/Team-notes"]);

  // A CHILD KEY IS REFUSED, and the refusal says what does remove it: the
  // section is reconciled from what the page holds, so dropping it would only
  // make it reappend at the bottom and the user would watch it come back.
  await pages.create({ name: "Ashgrove", parent: "home/Team-notes" });
  tables.push({ name: "jobs", rows: 2, parent: "home/Team-notes" });
  await pages.read("home/Team-notes"); // places both children
  const before = files.at("pages/home/children/Team-notes/content.yaml")!;
  for (const key of ["@page-Ashgrove", "@table-jobs"]) {
    const refused = pages.removeSection("home/Team-notes", key);
    await expect(refused).rejects.toThrow(/child/);
    await expect(refused).rejects.toThrow(/\.html/);
  }
  // And NOTHING was written. A refusal that half-writes is worse than none.
  expect(files.at("pages/home/children/Team-notes/content.yaml")).toBe(before);

  // A page nobody made.
  await expect(pages.removeSection("home/nothing-here", "title")).rejects.toThrow();

  // A broken document is repaired through the raw fallback, never rewritten from
  // one that could not be read.
  const broken = "name: Broken\nplugin: doc\ncontents:\n - name: calc\n  parts: {}\n";
  await files.write("pages/home/children/Broken/content.yaml", broken);
  await expect(pages.removeSection("home/Broken", "calc")).rejects.toThrow();
  expect(files.at("pages/home/children/Broken/content.yaml")).toBe(broken);
});

/* ── what the format refuses ───────────────────────────────────────────── */

test("nothing addressed by a page id can leave the vault", async () => {
  const { pages, docs } = vault();
  await pages.create({ name: "Team notes" });

  // The id is user-shaped now — it is a path — so the grammar is checked here
  // rather than trusted to files.ts. A segment of `..` is an attempt to leave.
  for (const id of ["../secrets", "..", "home/../..", "home//team-notes", "/home", "home/", "team notes", "_assets", "./x", ""]) {
    await expect(pages.read(id)).rejects.toThrow();
    await expect(docs.read(id)).rejects.toThrow();
    await expect(pages.children(id)).rejects.toThrow();
  }
  for (const file of ["../escape.html", "a/b.html", "_assets/../x", "/etc/passwd", ".git"]) {
    await expect(pages.writeFile("home/Team-notes", file, "x")).rejects.toThrow();
  }
  // One level of _assets/ is the exception, and it is the only one.
  await pages.writeFile("home/Team-notes", "_assets/icon.svg", "<svg/>");
  expect(await pages.read("home/Team-notes")).not.toBeNull();
});

test("the raw fallback cannot write a document the reader would not read back", async () => {
  const { files, pages, docs } = vault();
  await pages.create({ name: "Team notes" });
  const before = files.at("pages/home/children/Team-notes/content.yaml");

  // A document that does not parse, and one that is not a map at all.
  await expect(docs.writeRaw("home/Team-notes", "name: Team notes\nplugin: doc\ncontents:\n - a\n  - b\n")).rejects.toThrow();
  await expect(docs.writeRaw("home/Team-notes", "- one\n- two\n")).rejects.toThrow();
  // `contents` is the ordered list of SECTIONS, and a section is a map.
  await expect(docs.writeRaw("home/Team-notes", yaml.format({ plugin: "doc",
    name: "T", variables: {}, contents: "title" as never,
  }))).rejects.toThrow();
  await expect(docs.writeRaw("home/Team-notes", "name: T\nplugin: doc\ncontents:\n  - title\n")).rejects.toThrow();
  // A slot has to hold something the reader can draw. There is no `diagram`
  // type: a diagram is a drawing in the section's own markup.
  await expect(docs.writeRaw("home/Team-notes", yaml.format({ plugin: "doc",
    name: "T", variables: {},
    contents: [{ name: "calc", parts: { body: { type: "diagram" as never, data: "x" } } }],
  }))).rejects.toThrow();
  // One name, one section.
  await expect(docs.writeRaw("home/Team-notes", yaml.format({ plugin: "doc",
    name: "T", variables: {},
    contents: [{ name: "calc", parts: { body: "a" } }, { name: "calc", parts: { body: "b" } }],
  }))).rejects.toThrow();
  // A child is one segment, never a path — that is what keeps the key filename
  // safe and scoped to the document it is in.
  await expect(docs.writeRaw("home/Team-notes", yaml.format({ plugin: "doc",
    name: "T", variables: {},
    contents: [{ name: "@page-Notes", parts: { body: { type: "child", data: "clients/notes" } } }],
  }))).rejects.toThrow(/segment/);
  // A variable is a value you type into a field, so it is never a structure.
  await expect(docs.merge("home/Team-notes", null, { crew: { deep: 1 } as never })).rejects.toThrow();

  // Nothing above touched the file. A refusal that half-writes is worse than no
  // validation at all, because the fallback is the last surface left.
  expect(files.at("pages/home/children/Team-notes/content.yaml")).toBe(before!);

  // And the fallback really is a fallback: what parses is written AS TYPED. The
  // prose is in this file now, so a reformat would not be cosmetic.
  const raw = "name: Team notes\nplugin: doc\nvariables:\n  rate: 62\ncontents:\n  - name: intro\n    parts:\n      body: |\n        # Team notes\n        The base rate is {{rate}}.\n";
  const parsed = await docs.writeRaw("home/Team-notes", raw);
  expect(parsed.variables).toEqual({ rate: 62 });
  expect(await docs.readRaw("home/Team-notes")).toBe(raw);
  expect((await pages.read("home/Team-notes"))!.sections[0]!.parts.body)
    .toEqual({ kind: "markdown", md: "# Team notes\nThe base rate is {{rate}}.\n", vars: { rate: 62 } });
});

/* ── variables: the nearest one wins, and a write lands on one scope ────── */

test("a patch lands on the page or on one section, and never on the other", async () => {
  const { files, pages, docs } = vault();
  await pages.create({ name: "Rates note" });
  // Straight through the fake, for the same reason as above: the commit count
  // at the end of this test is about the merge path alone.
  await files.write("pages/home/children/Rates-note/calc.html", "<div/>");
  await files.write("pages/home/children/Rates-note/content.yaml", yaml.format({
    name: "Rates note",
    plugin: "doc",
    variables: { rate: 62 },
    contents: [
      { name: "intro", parts: { body: "The base rate is {{rate}}.\n" } },
      { name: "calc", data: "calc.html", variables: { title: "What a job costs" }, parts: { body: "Costs.\n" } },
    ],
  }));

  // A null section is the page's own values: in scope for every section on it.
  const page = await docs.merge("home/Rates-note", null, { rate: 71 });
  expect(page.variables).toEqual({ rate: 71 });

  // A name is that section's, which is where a slot writes. It does NOT reach
  // the page: landing one scope out would change what every other section says.
  const scoped = await docs.merge("home/Rates-note", "calc", { title: "What this costs" });
  expect(scoped.contents.find((c) => c.name === "calc")!.variables).toEqual({ title: "What this costs" });
  expect(scoped.variables).toEqual({ rate: 71 });

  // A section that has gone is refused rather than written to the page.
  await expect(docs.merge("home/Rates-note", "vanished", { title: "x" })).rejects.toThrow();

  // The nearest one wins where the part is drawn.
  const read = await pages.read("home/Rates-note");
  expect(read!.sections[0]!.parts.body).toMatchObject({ vars: { rate: 71 } });
  expect(read!.sections[1]!.parts.body).toMatchObject({ vars: { rate: 71, title: "What this costs" } });
  expect(read!.sections[1]!.vars).toEqual({ rate: 71, title: "What this costs" });

  // A slot losing focus is not an agent write. A commit per keystroke would bury
  // the ones the history exists for.
  expect(files.commits).toEqual([]);
});

test("two writers to one document do not lose each other's values", async () => {
  const { files, pages, docs } = vault();
  await pages.create({ name: "Job board" });
  await pages.create({ name: "Notes" });

  // The ordinary case, and it is ordinary: an artifact writes a slot as it loses
  // focus while the user edits the page's own values. Two patches over one file
  // at the same time — and both callers are told they succeeded, so a discarded
  // one is silent. It matters more than it did: the file holds the words now, so
  // a lost write is a lost paragraph.
  await Promise.all([
    docs.merge("home/Job-board", null, { week: 32 }),
    docs.merge("home/Job-board", "title", { heading: "This week" }),
  ]);
  const both = docAt(files, "home/Job-board");
  expect(both.variables).toEqual({ week: 32 });
  expect(both.contents.find((c) => c.name === "title")!.variables).toEqual({ heading: "This week" });

  // N of them at once, every one a different name, every one surviving.
  const names = Array.from({ length: 16 }, (_, i) => `k${i}`);
  await Promise.all(names.map((k, i) => docs.merge("home/Job-board", null, { [k]: i })));
  const wide = await docs.read("home/Job-board");
  for (const [i, k] of names.entries()) expect(wide.variables[k]).toBe(i);

  // The same name from three writers: the last one ISSUED wins, deterministically
  // rather than by whichever read-modify-write happened to land last.
  for (let run = 0; run < 25; run++) {
    await Promise.all([
      docs.merge("home/Job-board", null, { heading: "first" }),
      docs.merge("home/Job-board", null, { heading: "second" }),
      docs.merge("home/Job-board", null, { heading: "third" }),
    ]);
    expect((await docs.read("home/Job-board")).variables.heading).toBe("third");
  }

  // Serialisation is per page: two pages written at once both land, because the
  // queue is keyed by page id rather than being one queue for the vault.
  await Promise.all([
    docs.merge("home/Job-board", null, { a: 1 }),
    docs.merge("home/Notes", null, { b: 2 }),
    docs.merge("home/Job-board", null, { c: 3 }),
    docs.merge("home/Notes", null, { d: 4 }),
  ]);
  const board = await docs.read("home/Job-board");
  const notes = await docs.read("home/Notes");
  expect([board.variables.a, board.variables.c]).toEqual([1, 3]);
  expect([notes.variables.b, notes.variables.d]).toEqual([2, 4]);
});

/* ── one broken page is one broken page ────────────────────────────────── */

test("a page whose content.yaml will not parse does not take the tree with it", async () => {
  const { files, pages, docs } = vault();
  await pages.create({ name: "Team notes" });
  await pages.create({ name: "Job board" });
  await pages.create({ name: "Site A", parent: "home/Job-board" });

  // One pasted character is enough to write a document the reader refuses, and
  // the rail reads every page. Losing one page is a page-level fault; losing the
  // rail makes every good page unreachable, which is a workspace-level one.
  const broken = "name: Broken\nplugin: doc\ncontents:\n - name: calc\n  parts: {}\n";
  await files.write("pages/home/children/Broken/content.yaml", broken);

  expect((await pages.list()).map((r) => r.id).sort())
    .toEqual(["home", "home/Broken", "home/Job-board", "home/Job-board/Site-A", "home/Team-notes"]);

  // It opens, because the raw fallback that repairs it is reached THROUGH the
  // page. A page you cannot open is a page you cannot fix — and the prose is in
  // this file now, so this is the only way back to the words as well.
  const page = await pages.read("home/Broken");
  expect(page).not.toBeNull();
  expect(page!.id).toBe("home/Broken");
  expect(page!.name).toBe("Broken"); // its own segment, because the name is in the file that broke
  expect(page!.sections).toEqual([]);

  // And its bytes are untouched: nothing on the read path may rewrite a file it
  // could not read, or opening the page is what destroys the text in it.
  expect(await docs.readRaw("home/Broken")).toBe(broken);
  expect(files.at("pages/home/children/Broken/content.yaml")).toBe(broken);
  await expect(docs.merge("home/Broken", null, { rate: 1 })).rejects.toThrow();

  // Every other page is exactly as it was, and a broken page's own children are
  // still listed: they are in its `children/` directory, which is not the file
  // that broke.
  expect(drawn(await pages.read("home/Team-notes"))).toEqual(["title"]);
  await files.write("pages/home/children/Broken/children/Site-B/content.yaml", yaml.format({ plugin: "doc",
    name: "Site B", variables: {}, contents: [],
  }));
  expect((await pages.children("home/Broken")).map((c) => c.id)).toEqual(["home/Broken/Site-B"]);

  // The repair lands, through the fallback, and the page comes back as itself.
  await docs.writeRaw("home/Broken", yaml.format({ plugin: "doc", name: "Broken", variables: {}, contents: [] }));
  expect((await pages.read("home/Broken"))!.name).toBe("Broken");
  expect((await pages.list()).find((r) => r.id === "home/Broken")!.name).toBe("Broken");

  // A page you cannot open is a page you cannot delete either, which is a trap
  // rather than a fallback.
  await files.write("pages/home/children/Fenton/content.yaml", broken);
  await pages.remove("home/Fenton");
  expect(await pages.read("home/Fenton")).toBeNull();
});

test("removing a page takes its subtree, and the vault is committed before every agent write", async () => {
  const { files, pages, docs } = vault();
  await pages.create({ name: "Clients" });
  await pages.create({ name: "Ashgrove", parent: "home/Clients" });
  expect(files.commits).toEqual([]);

  await pages.writeFile("home/Clients", "calc.html", "<div/>");
  await docs.writeRaw("home/Clients", yaml.format({ plugin: "doc", name: "Clients", variables: {}, contents: [] }));

  // The children are INSIDE the directory, so removing the page removes them —
  // the price of the folder being the hierarchy, and one revert away because the
  // commit is taken first.
  await pages.remove("home/Clients");
  expect(await pages.read("home/Clients")).toBeNull();
  expect(await pages.read("home/Clients/Ashgrove")).toBeNull();
  expect(files.paths().some((p) => p.includes("clients"))).toBe(false);
  expect(files.commits).toHaveLength(3);
});

test("an empty vault is not an error, and a name that is not a slug still gets one", async () => {
  const { pages } = vault();
  // Not empty: the root page is guaranteed rather than seeded, because the top
  // level is its children and they need somewhere on disk to be.
  expect(await pages.list()).toEqual([{ id: "home", name: "Home" }]);

  expect((await pages.create({ name: "Ashgrove II — render & scaffold" })).id)
    .toBe("home/Ashgrove-II-render-scaffold");
  // Two pages can want the same name, and neither may take the other's directory.
  expect((await pages.create({ name: "Notes" })).id).toBe("home/Notes");
  expect((await pages.create({ name: "Notes" })).id).toBe("home/Notes-2");
  expect((await pages.create({ name: "去年の記録" })).id).toBe("home/page");

  // A page cannot be created under a parent that is not there: the directory
  // would exist and nothing would ever walk into it.
  await expect(pages.create({ name: "Orphan", parent: "home/nowhere" })).rejects.toThrow();
});

/* ── the design doc: the same shape, one directory to the side ─────────── */

test("the design doc is a page, read through the same resolver, out of the tree", async () => {
  const files = memFiles();
  const design = makeDesign(files, yaml);

  // A `design/` that is not there at all opens as an empty doc rather than
  // failing — the state a vault made before the design doc existed is in.
  expect((await design.read()).sections).toEqual([]);

  await files.write("content.yaml", yaml.format({
    name: "Design",
    plugin: "doc",
    variables: { voice: "plain" },
    contents: [
      { name: "brand", parts: { body: "# Design\nThe voice is {{voice}}.\n" } },
      {
        name: "swatch",
        data: "swatch.html",
        variables: { title: "The palette" },
        parts: { list: { type: "html", data: "swatch-list.html" } },
      },
    ],
  }));
  await files.write("swatch.html", '<section><div data-g-part="list"></div></section>');
  await files.write("swatch-list.html", "<ul id=swatch></ul>");

  const doc = await design.read();
  expect(doc.id).toBe("design");
  expect(doc.name).toBe("Design");
  // The shipped default section, the same file a page under `pages/` takes.
  expect(doc.sections[0]!.html).toBe(DEFAULT_SECTION);
  expect(doc.sections[0]!.fallback).toBe(true);
  expect(doc.sections[0]!.parts.body).toEqual({
    kind: "markdown", md: "# Design\nThe voice is {{voice}}.\n", vars: { voice: "plain" },
  });
  // The same file forms a page has, resolved by the same function, so the design
  // doc cannot drift from `pages/`: a section that names its own markup, and an
  // html slot inside it.
  expect(doc.sections[1]!.html).toBe('<section><div data-g-part="list"></div></section>');
  expect(doc.sections[1]!.fallback).toBe(false);
  expect(doc.sections[1]!.parts.list).toEqual({
    kind: "html", file: "swatch-list.html", html: "<ul id=swatch></ul>",
    vars: { voice: "plain", title: "The palette" },
  });

  // IT HAS NO CHILDREN, so a child part resolves to nothing here: this doc is
  // not in the tree, and there is nothing for one to point at.
  await files.write("content.yaml", yaml.format({ plugin: "doc",
    name: "Design", variables: {},
    contents: [{ name: "kid", parts: { body: { type: "child", data: "Notes" } } }],
  }));
  expect((await design.read()).sections[0]!.parts).toEqual({});

  // The same merge a page gets, into the same two scopes.
  await files.write("content.yaml", yaml.format({ plugin: "doc",
    name: "Design", variables: { voice: "plain" },
    contents: [{ name: "swatch", variables: { title: "The palette" }, parts: { body: "Colours.\n" } }],
  }));
  const patched = await design.patch("swatch", { title: "Colour" });
  expect(patched.contents.find((c) => c.name === "swatch")!.variables).toEqual({ title: "Colour" });
  expect((await design.patch(null, { voice: "direct" })).variables).toEqual({ voice: "direct" });

  // It never rewrites a document it could not read: the repair goes through
  // writeFile, which is the raw fallback here.
  await files.write("content.yaml", "name: Design\nplugin: doc\ncontents:\n - name: brand\n  parts: {}\n");
  await expect(design.patch(null, { voice: "plain" })).rejects.toThrow();
  expect(files.at("content.yaml")).toContain("name: Design");

  // And writeFile is how an agent puts a section's markup there — the same two
  // halves a page needs, the declaration and the file.
  await files.write("content.yaml", yaml.format({ plugin: "doc",
    name: "Design", variables: {},
    contents: [{ name: "system", data: "system.html", parts: {} }],
  }));
  await design.writeFile("system.html", "<main>the system</main>");
  const sheet = await design.read();
  expect(sheet.sections[0]!.html).toBe("<main>the system</main>");
  expect(sheet.sections[0]!.fallback).toBe(false);
  await expect(design.writeFile("../escape.html", "x")).rejects.toThrow();
});

test("a page's own document beats the vault's plugin, and a page whose plugin is nowhere says so", async () => {
  // THE ORDER IS THE WHOLE STATEMENT OF WHAT A PLUGIN IS, and nothing covered it
  // until the shipped set was found to be winning. That made `doc`, `kanban` and
  // `mindmap` unreplaceable by name: a workspace that wrote `plugins/doc/index.html`
  // had it silently ignored, which is the one failure the architecture claims
  // cannot happen — a feature with a hole cut in it for the built-in drawing.
  //
  // THE SHIPPED RUNG IS GONE NOW rather than merely last. Every plugin is seeded
  // into the vault, so the second rung is always occupied — and what is left
  // underneath is the missing-page document, reached only by a page naming a
  // plugin this workspace has not got.
  //
  // Written against the FORMAT: two places a document can come from, nearest
  // first, and the assertion is which one reaches the box.
  const files = memFiles();
  const tables: FakeTable[] = [];
  const pages = makePages(files, yaml, () => tables, DEFAULT_SECTION);

  await files.write("pages/home/content.yaml", "name: Home\nplugin: doc\ncontents: []\n");
  await files.write("pages/home/children/Plain/content.yaml", "name: Plain\nplugin: doc\ncontents: []\n");

  // With no `plugins/doc/` in the vault there is nothing to draw with, and the
  // page says so rather than coming back blank. In a real mount the seeder has
  // already put the file there before anything reads a page.
  expect((await pages.read("home/Plain"))!.html).toContain("Nothing draws this page");

  // The workspace has its own `doc` — seeded, or written by hand over the top of
  // the seeded one. From here on it is the one that draws, on every page that
  // says `plugin: doc`, including the root.
  await files.write("plugins/doc/index.html", "<!doctype html><title>installed</title>");
  expect((await pages.read("home/Plain"))!.html).toContain("installed");
  expect((await pages.read("home"))!.html).toContain("installed");

  // And a page that drew itself asked for nothing else, so its own document
  // still wins — the workspace's plugin is a default for the pages that did not
  // answer the question themselves.
  await files.write("pages/home/children/Plain/index.html", "<!doctype html><title>its own</title>");
  expect((await pages.read("home/Plain"))!.html).toContain("its own");
});
