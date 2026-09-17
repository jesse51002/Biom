// SPDX-License-Identifier: AGPL-3.0-only
// What a vault gets when it is opened, and what a preset is.
//
// This file used to be mostly about DATA: two shipped presets under
// `presets/` and a catalogue under `market/`, each read back off
// disk and held to the rules in AGENTS.md. Both directories are gone —
// they were pages written against the render layer, the page kinds and a
// heterogeneous `contents` list, all three of which the section format removed,
// so every one of them was a page in a format that no longer parses. The
// marketplace went with them: there is no `Listing`, no `listings()`, no
// `readListing`, no `installListing` and no `market:` dependency, and the tests
// for all of that are deleted rather than ported.
//
// WHAT IS LEFT IS THE MECHANISM RATHER THAN THE CATALOGUE, and it is the half
// that still matters: `seedIfEmpty` lays out a vault's furniture, `seedVaultRoot`
// walks `vault/` into the root, `seedChecker` refreshes the one command
// every agent is told to run, and `install` copies a preset directory into a page
// when somebody asks for one. Nothing ships a preset now, so `install` and
// `manifest` are exercised against a fixture written here — which is the honest
// shape of the test anyway: the code under test is the copier, not the copy.
//
// `vault/base/` is still read as data, for the reason the presets used to be: it
// is the reference a generated section is written from, so a rule that quietly
// stops holding in it stops holding in everything copied from it.

import { ROOT_PAGE, parentOf } from "../contracts/types.ts";
import { test, expect, beforeEach, afterEach } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFiles, initVault } from "../server/platform/files.ts";
import { makeDb } from "../server/platform/db.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { ROOT_PAGE_FILE, makePages } from "../server/domain/pages.ts";
import { makeTables } from "../server/domain/tables.ts";
import { makePresets, makeTheme } from "../server/workspace/presets.ts";

import type { PresetDeps } from "../server/workspace/presets.ts";
import type { FileEntry, Files, PageDoc, VarValue } from "../contracts/types.ts";

/* ── shared readers ─────────────────────────────────────────────────────── */

/** The keys a page document must carry itself. Installing copies the preset's
 *  file verbatim over the document `pages.create` just wrote, so a preset that
 *  omits one of these installs as a page named after its slug.
 *
 *  `kind` and `render` are NOT among them any more and must not come back: there
 *  is one kind of page and one reader, so both keys had nothing left to decide.
 *  `order` and `parent` went earlier — `contents` IS the order, and the folder is
 *  the hierarchy. yaml.ts REFUSES every one of the four by name rather than
 *  ignoring it, so a document carrying one is a document that will not parse. */
const RESERVED = ["name", "contents"] as const;
const GONE = ["kind", "render", "order", "parent"] as const;

/** A key written at column zero, which is the only place a top-level key of the
 *  document can be. Asserted against the TEXT rather than the parsed document,
 *  because `parse` defaults every absent key — so a document that says nothing
 *  about its contents reads back as an empty page and looks fine here. */
const declares = (raw: string, key: string): boolean =>
  new RegExp(`^${key}[ \\t]*:`, "m").test(raw);

/** Every `data-g-part="…"` in the markup, in source order — one entry per slot
 *  the section declares. Duplicates are kept: one slot id mapping to one
 *  editable region is the whole convention, and two elements claiming the same
 *  id is the way that breaks. */
function partsIn(html: string): string[] {
  // A SLOT IS DECLARED IN THE MARKUP, NEVER INSIDE A SCRIPT. A section that
  // draws its own editing looks its slot up by name — `'[data-g-part="' + SLOT +
  // '"]'` is the shape the sections skill teaches — and matching that string
  // registered a phantom slot the document could never fill. The checker's own
  // scanner hides `<script>` before it looks; this has to as well, or the
  // starters cannot use the pattern their skill recommends.
  //
  // AND A `<style>` DECLARES NOTHING EITHER. A section may style its slots by the
  // name the document already uses — `[data-g-part="items"] > *` — rather than by
  // a class it invented, which is one vocabulary instead of two and nothing
  // arbitrary for the next page to copy. Every one of those is a selector, and a
  // selector READS a slot; counted as declarations they made one id look like
  // twelve elements. The checker's own scanner draws the same line, in the same
  // place: a `[` immediately before it.
  const markup = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, (m) => m.replace(/[^\n]/g, " "));
  const out: string[] = [];
  for (const m of markup.matchAll(/(\[?)data-g-part="([^"]*)"/g)) {
    if (m[1] === "[") continue;
    out.push(m[2] ?? "");
  }
  return out;
}

/** The RETIRED spelling. It named a VARIABLE in scope; `data-g-part` names a
 *  SLOT, and a slot's id is its key in `parts`. Asserted absent rather than
 *  merely unused, because a starter is what everything else is copied from and
 *  one left behind propagates silently. */
function retiredSlotsIn(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-g-slot="([^"]*)"/g)) out.push(m[1] ?? "");
  return out;
}

/** The stylesheet only. A rule about CSS must not be checked against the script,
 *  which legitimately writes `"px"` and legitimately reads `style`. */
function styleOf(html: string): string {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "").join("\n");
}

const sorted = (xs: readonly string[]) => [...xs].sort();

/** Every value a variable may take, flattened. A variable is a value somebody
 *  types into a field, so it is a scalar or a list of them and never a
 *  structure — that rule outlived flatness, because it is about the FIELD
 *  rather than about the file. */
const scalarsOf = (value: VarValue): (string | number | boolean | null)[] =>
  Array.isArray(value) ? value : [value];

/* ── a preset, as a fixture ─────────────────────────────────────────────── */

/** A preset is a DIRECTORY: a `preset.yaml` naming it, and beside it everything
 *  the page is made of — its `content.yaml` and the html its sections draw with.
 *
 *  Written here rather than read off disk because nothing ships one any more,
 *  and because the module under test is the copier. `job-board` is the ordinary
 *  case; `nameless` has a manifest with nothing readable in it and must be
 *  skipped rather than listed; `no-card` is a directory somebody is part-way
 *  through writing, which is nothing to list rather than something to fail on. */
const PRESETS: Record<string, Record<string, string>> = {
  "job-board": {
    "preset.yaml": "name: Job board\npage: Job board\n",
    "content.yaml":
      "name: Job board\n" +
      "plugin: doc\n" +
      "variables:\n  quarter: Q3\n" +
      "contents:\n" +
      "  - name: intro\n" +
      "    parts:\n" +
      "      body: |\n" +
      "        We shipped {{quarter}} on time.\n" +
      "  - name: hero\n" +
      "    data: hero.html\n" +
      "    parts:\n" +
      "      headline: '# Ship faster'\n",
    "hero.html": '<div class="g-section"><h1 data-g-part="headline"></h1></div>\n',
  },
  nameless: {
    "preset.yaml": "by: nobody\n",
    "content.yaml": "name: Nameless\nplugin: doc\ncontents: []\n",
  },
  "no-card": {
    "content.yaml": "name: Half written\nplugin: doc\ncontents: []\n",
  },
};

let root: string;
let shed: string;

/** The root page's own markup, the shipped file. The composition root reads it
 *  and hands it to `makePages`; these tests read the same one, so what they
 *  assert about a seeded root is what a person actually gets rather than the
 *  stand-in a bare `makePages` falls back to. */
const ROOT_MARKUP = readFileSync(join(import.meta.dir, "..", ROOT_PAGE_FILE), "utf8");

/** Everything above this layer, built against one folder. `seed` is optional on
 *  `PresetDeps` — nothing ships a preset — so `boot(root, null)` is the shape a
 *  real vault is in and is tested as such. */
function boot(dir: string, presetRoot: string | null = shed, seeds: Partial<PresetDeps> = {}) {
  const files = makeFiles(dir);
  const db = makeDb(join(dir, "workspace.db"));
  const yaml = { parse, parseAny, format };
  const pages = makePages(files, yaml, undefined, undefined, undefined, ROOT_MARKUP);
  const tables = makeTables(db);
  const presets = makePresets({
    pages, tables, files, yaml,
    ...(presetRoot === null ? {} : { seed: makeFiles(presetRoot) }),
    // What a vault gets at its ROOT — AGENTS.md, .agents/skills/, design/, base/ — and
    // the checker that travels beside them. Both are the shipped directories,
    // not fixtures: their SHAPE is what is being seeded.
    vaultSeed: makeFiles(join(import.meta.dir, "..", "vault")),
    skill: makeFiles(join(import.meta.dir, "..", "skill")),
    checkerLib: makeFiles(join(import.meta.dir, "..")),
    ...seeds,
  });
  return { db, pages, tables, presets, theme: makeTheme(files) };
}

/** A seed root that is nothing but the answer a test wants `list` to give.
 *  Writing through it throws, because a seeder reaching for that would be a bug
 *  this is meant to show rather than hide. */
function seedRoot(listing: (rel: string) => FileEntry[]): Files {
  const no = async (): Promise<never> => { throw new Error("a seed root is read-only"); };
  return {
    read: async () => "",
    write: no,
    remove: no,
    list: async (rel: string) => listing(rel),
    commit: no,
  };
}

/** Everything `console.warn` said while `fn` ran. The seeder's refusals are
 *  sentences in the log and nowhere else, so the log is where they are asserted. */
async function warnings(fn: () => Promise<void>): Promise<string> {
  const said: string[] = [];
  const was = console.warn;
  console.warn = (...args: unknown[]) => { said.push(args.map(String).join(" ")); };
  try {
    await fn();
  } finally {
    console.warn = was;
  }
  return said.join("\n");
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "biom-presets-"));
  shed = mkdtempSync(join(tmpdir(), "biom-shed-"));
  for (const [id, entries] of Object.entries(PRESETS)) {
    mkdirSync(join(shed, id), { recursive: true });
    for (const [file, text] of Object.entries(entries)) writeFileSync(join(shed, id, file), text);
  }
  await initVault(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(shed, { recursive: true, force: true });
});

/* ── listing and installing ─────────────────────────────────────────────── */

test("a preset is a directory with a card in it, and a card that says nothing is not one", async () => {
  const { db, presets } = boot(root);
  const listed = await presets.list();
  // `nameless` has a manifest with no name in it and `no-card` has no manifest
  // at all. Both are read off disk, so both are states rather than failures —
  // one hand-edited file must not empty the shed.
  expect(sorted(listed.map((p) => p.id))).toEqual(["job-board"]);
  expect(listed[0]!.name).toBe("Job board");
  db.close();
});

test("installing copies the directory, and the preset's own document wins", async () => {
  const { db, pages, presets } = boot(root);

  const [ref] = await presets.install("job-board");
  expect(ref).toBeDefined();
  // A page id is a PATH, and it is where the page IS. Installing puts it inside
  // the root, so the id says so and nothing else has to — the preset ships no
  // parent, because there is no key for one.
  expect(ref!.id).toBe(`${ROOT_PAGE}/Job-board`);
  expect(parentOf(ref!.id)).toBe(ROOT_PAGE);

  const page = await pages.read(ref!.id);
  expect(page).not.toBeNull();
  // The document the preset shipped won, not the one `pages.create` wrote: the
  // name and every section come off the installed file.
  expect(page!.name).toBe("Job board");
  expect(page!.sections.map((s) => s.name)).toEqual(["intro", "hero"]);

  // `contents` IS the order and a section is a div: `intro` names no file and
  // takes the shipped default, `hero` names its own markup and does not.
  const [intro, hero] = page!.sections;
  expect(intro!.fallback).toBe(true);
  expect(hero!.fallback).toBe(false);
  expect(hero!.html).toContain('data-g-part="headline"');

  // A bare string in `parts` is markdown, and it comes back RAW — `{{quarter}}`
  // still in it, because interpolation happens where the part is drawn.
  expect(intro!.parts["body"]).toEqual({
    kind: "markdown",
    md: "We shipped {{quarter}} on time.\n",
    vars: { quarter: "Q3" },
  });
  expect(hero!.parts["headline"]).toMatchObject({ kind: "markdown", md: "# Ship faster" });

  // And it is really on disk where the id says: `pages/home/children/Job-board`.
  expect(existsSync(join(root, "pages", ROOT_PAGE, "children", "Job-board", "content.yaml"))).toBe(true);
  expect(existsSync(join(root, "pages", ROOT_PAGE, "children", "Job-board", "hero.html"))).toBe(true);
  // `preset.yaml` is the shed's business and never travels into the page.
  expect(existsSync(join(root, "pages", ROOT_PAGE, "children", "Job-board", "preset.yaml"))).toBe(false);

  db.close();
});

test("installing twice does not clobber the copy somebody adapted", async () => {
  const { db, pages, presets } = boot(root);

  const [ref] = await presets.install("job-board");
  // Somebody adapts their copy — which is the entire interaction a preset exists
  // for — and then installs the same preset again.
  await pages.writeFile(ref!.id, "hero.html", '<div class="g-section"><h1 data-g-part="headline">Adapted</h1></div>\n');
  const [again] = await presets.install("job-board");
  expect(again!.id).not.toBe(ref!.id);

  const first = await pages.read(ref!.id);
  const second = await pages.read(again!.id);
  expect(first!.sections.find((s) => s.name === "hero")!.html).toContain("Adapted");
  expect(second!.sections.find((s) => s.name === "hero")!.html).not.toContain("Adapted");

  // Both are in the tree, under the root, where a page nothing shows would not be.
  const ids = (await pages.children(ROOT_PAGE)).filter((c) => c.kind === "page").map((c) => c.id);
  expect(ids).toContain(ref!.id);
  expect(ids).toContain(again!.id);
  db.close();
});

test("a preset with no card, and a workspace with no shed, are refused rather than half-installed", async () => {
  const { db, pages, presets } = boot(root);
  // A directory with no readable manifest is not a preset, and neither is an id
  // that was never shipped or one that could not be a directory name.
  await expect(presets.install("no-card")).rejects.toThrow();
  await expect(presets.install("nameless")).rejects.toThrow();
  await expect(presets.install("nothing-here")).rejects.toThrow();
  await expect(presets.install("../../etc")).rejects.toThrow();
  // Nothing was created on the way to any of those refusals.
  expect((await pages.list()).map((p) => p.id)).toEqual([ROOT_PAGE]);
  db.close();
});

test("a workspace handed no preset root opens with an empty shed rather than failing", async () => {
  // `seed` is OPTIONAL, and this is the state every real vault is in: nothing
  // ships a preset, so a caller that has none says so by omitting the root
  // rather than by pointing at one that is not there.
  const { db, pages, presets } = boot(root, null);
  await presets.seedIfEmpty();
  expect(await presets.list()).toEqual([]);
  await expect(presets.install("job-board")).rejects.toThrow();
  // The rest of the workspace is still a workspace.
  expect((await pages.list()).map((p) => p.id)).toEqual([ROOT_PAGE]);
  expect(existsSync(join(root, "design", "content.yaml"))).toBe(true);
  db.close();
});

/* ── a seed root that is there and is wrong ─────────────────────────────── */

test("a plugin seed root that is EMPTY is said out loud, because no page will draw", async () => {
  // The `undefined` case already had a sentence. This is the same failure by a
  // different route — a root handed over and holding nothing — and it used to be
  // silent: the walk found no entries, returned, and every page in the workspace
  // drew MISSING_DOCUMENT with nothing in the log saying why. There is no shipped
  // rung left to fall back to, so the silence is the whole of the bug.
  const { db, presets } = boot(root, null, { pluginSeed: seedRoot(() => []) });
  const said = await warnings(() => presets.seedIfEmpty());
  expect(said).toContain("no page will draw");
  expect(existsSync(join(root, "plugins"))).toBe(false);
  // And the mount finished: an empty seed is a bad install, not a crash.
  expect(existsSync(join(root, "design", "content.yaml"))).toBe(true);
  db.close();
});

test("a plugin seed root that cannot be READ fails the mount rather than seeding half a vault", async () => {
  // EACCES on the install directory, EIO on the disk under it. `Files.list`
  // answers ENOENT and its neighbours with an empty array, so a throw that gets
  // this far means something is wrong with the install itself — and a mount that
  // swallowed it would hand somebody a workspace in which nothing draws and the
  // log says nothing.
  const { db, presets } = boot(root, null, {
    pluginSeed: seedRoot(() => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); }),
  });
  await expect(presets.seedIfEmpty()).rejects.toThrow(/permission denied/);
  db.close();
});

test("a seed root whose SUBDIRECTORY cannot be read fails too, at whatever depth it is", async () => {
  // The same rule one level down, and the one the walk used to swallow: a root
  // that lists fine and a directory inside it that does not. Half the vault root
  // seeded and no sentence anywhere is worse than refusing to mount.
  const { db, presets } = boot(root, null, {
    vaultSeed: seedRoot((rel) => {
      if (rel === ".") return [{ name: ".agents", dir: true }];
      throw Object.assign(new Error("input/output error"), { code: "EIO" });
    }),
  });
  await expect(presets.seedIfEmpty()).rejects.toThrow(/input\/output error/);
  db.close();
});

/* ── what a fresh vault contains ────────────────────────────────────────── */

test("A NEW VAULT IS EMPTY, and everything that seeds is furniture", async () => {
  const { db, pages, tables, presets, theme } = boot(root);
  await presets.seedIfEmpty();

  // The root page and nothing else. Seeding somebody's folder with invented
  // pages about a trade business was noise they had to delete before they could
  // start — and no preset installs itself either, because a preset is a page and
  // a page is content. THE EMPTY EMPTY-STATE HAS NO ANSWER RIGHT NOW: it used to
  // be the marketplace, and the catalogue went with the render layer it was
  // written against.
  expect((await pages.list()).map((p) => p.id)).toEqual([ROOT_PAGE]);
  expect(tables.list()).toEqual([]);

  // What DOES seed is the workspace's own furniture, none of which is content:
  // the guide an agent pointed at this folder reads, the skills it opens on
  // demand, the checker, the design doc and the theme.
  expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  expect(existsSync(join(root, ".agents", "skills", "check.ts"))).toBe(true);
  expect(existsSync(join(root, "design", "content.yaml"))).toBe(true);

  // AND `docs/` — how the format works, for the PERSON whose folder this is. It
  // rides the same walk as the skills and needed nothing in the seeder: adding a
  // doc is adding a file under vault/docs/. It is separate from the
  // skills on purpose — a doc says how the thing WORKS, a skill says how we write
  // with it and what the checker will say — and each links the other.
  // Read off the shipped directory rather than listed here, because a list of
  // nine filenames is wrong the first time anybody adds a tenth.
  const shippedDocs = readdirSync(join(import.meta.dir, "..", "vault", "docs"));
  expect(shippedDocs.length).toBeGreaterThan(0);
  expect(shippedDocs).toContain("README.md");
  for (const doc of shippedDocs) {
    expect(existsSync(join(root, "docs", doc))).toBe(true);
  }
  // Authored, not derived, so it gets no AGENTS.md of its own: `_markdown/`
  // carries one because somebody has to be told not to author in it.
  expect(existsSync(join(root, "docs", "AGENTS.md"))).toBe(false);

  // AND `base/` — the blocks that ship with every workspace, in the shape a page
  // has, copied into one. It rides the same two-level walk as .agents/skills/ and
  // design/ and needed no new mechanism, which is the whole argument for it
  // living under vault/ rather than in a seed root of its own. It is
  // furniture, not content: nothing installs itself.
  expect(existsSync(join(root, "base", "README.md"))).toBe(true);
  expect(existsSync(join(root, "base", "diagram", "index.html"))).toBe(true);
  expect(existsSync(join(root, "base", "diagram", "content.yaml"))).toBe(true);
  expect(existsSync(join(root, "pages", "diagram"))).toBe(false);
  // Beside `pages/`, never inside it — that placement is what keeps the design
  // doc out of the rail without a reserved id anywhere.
  expect(existsSync(join(root, "pages", "design"))).toBe(false);

  // AND THE CHECKER LOADS. Copying `check.ts` alone shipped a command that could
  // not run: it imports the wire constants and the types, and a vault has
  // neither, so `bun run .agents/skills/check.ts` — the one command AGENTS.md tells
  // every agent to run — died on module resolution. Asserting the file exists
  // never caught that; asserting it RUNS does.
  //
  // NOT yaml.ts, and never again: the server codec reaches the bare specifier
  // `yaml`, which resolves through this repo's tsconfig and nowhere else, so in
  // a real vault it would go to npm for an unpinned package and fail offline.
  for (const lib of ["wire.js", "types.ts"]) {
    expect(existsSync(join(root, ".agents", "skills", "_lib", lib))).toBe(true);
  }
  expect(existsSync(join(root, ".agents", "skills", "_lib", "yaml.ts"))).toBe(false);

  const ran = Bun.spawnSync({
    cmd: ["bun", "run", join(".agents", "skills", "check.ts"), join("pages", ROOT_PAGE)],
    cwd: root,
  });
  const said = new TextDecoder().decode(ran.stderr) + new TextDecoder().decode(ran.stdout);
  expect(said).not.toContain("Cannot find module");
  expect(said).not.toContain("error: Cannot");

  // The theme is a palette and a set of type roles, and nothing else now: the
  // `render` it carried named the one treatment every page followed by default,
  // and a section decides its own.
  const got = await theme.get();
  expect(got.palette.name.length).toBeGreaterThan(0);
  expect(Object.keys(got.palette.colors).length).toBeGreaterThan(0);
  expect(Object.hasOwn(got, "render")).toBe(false);
  expect(Object.hasOwn(got, "background")).toBe(false);

  // Seeding again fills gaps and touches nothing else. It is no longer gated on
  // "has this workspace been used" — every write is additive, which is what a
  // vault made before the design doc existed needs.
  writeFileSync(join(root, "AGENTS.md"), "Mine.\n");
  // A DOC SOMEBODY ANNOTATED IS A FILE THEY EDITED, and `fill` never writes over
  // one. Asserted beside AGENTS.md because the two are the same property and the
  // docs are the newest thing riding it.
  writeFileSync(join(root, "docs", "pages.md"), "My notes on this.\n");
  await presets.seedIfEmpty();
  expect((await pages.list()).map((p) => p.id)).toEqual([ROOT_PAGE]);
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("Mine.\n");
  expect(readFileSync(join(root, "docs", "pages.md"), "utf8")).toBe("My notes on this.\n");
  db.close();
});

test("the checker is REFRESHED rather than filled in, because it is code", async () => {
  const { db, presets } = boot(root);
  await presets.seedIfEmpty();

  const shipped = readFileSync(join(import.meta.dir, "..", "skill", "check.ts"), "utf8");
  expect(readFileSync(join(root, ".agents", "skills", "check.ts"), "utf8")).toBe(shipped);

  // Everything else in the vault is somebody's to edit and is never written
  // over. The checker is not: its whole job is to agree with a format that keeps
  // moving, so a copy frozen at the moment a vault was made goes wrong quietly
  // and stays wrong forever, reporting failures against rules the format no
  // longer has.
  writeFileSync(join(root, ".agents", "skills", "check.ts"), "// stale\n");
  writeFileSync(join(root, ".agents", "skills", "_lib", "wire.js"), "// stale\n");
  await presets.seedIfEmpty();
  expect(readFileSync(join(root, ".agents", "skills", "check.ts"), "utf8")).toBe(shipped);
  expect(readFileSync(join(root, ".agents", "skills", "_lib", "wire.js"), "utf8")).not.toBe("// stale\n");
  db.close();
});

test("a page made in a seeded vault carries the bundled child.html, and can drop it", async () => {
  const { db, pages, presets } = boot(root);
  await presets.seedIfEmpty();

  // The default is in the vault, not in the framework: `base/child/index.html`
  // arrives on the same walk as the skills and the design doc, and `pages.create`
  // copies it into every page from that moment on. So an agent working in a
  // vault finds the file already written and EDITS it, rather than having to
  // know that writing a file by that name would have had an effect.
  const bundled = readFileSync(join(root, "base", "child", "index.html"), "utf8");
  const clients = await pages.create({ name: "Clients" });
  const ref = await pages.create({ name: "Ashgrove", parent: clients.id });
  // The id is a path and the directory is the path with `children/` in it.
  const dirOf = (id: string) => join(root, "pages", id.split("/").join("/children/"));
  expect(readFileSync(join(dirOf(ref.id), "child.html"), "utf8")).toBe(bundled);

  // A CHILD KEY IS ONE SEGMENT, never a path: a page's contents only ever name
  // its DIRECT children, which is what keeps `@page-Ashgrove` a legal filename
  // and lets two parents each hold a "notes".
  const key = "@page-Ashgrove";
  const section = (await pages.read(clients.id))!.sections.find((s) => s.name === key);
  // The reconciled section names no file, so it takes the shipped default and
  // its one slot — which is where the child goes.
  expect(section!.fallback).toBe(true);
  expect(section!.parts["body"]).toMatchObject({
    kind: "child",
    child: { kind: "page", id: ref.id, name: "Ashgrove" },
    draw: { file: "child.html", html: bundled },
  });

  // It is not a section of the page it lives in.
  expect((await pages.read(ref.id))!.sections.map((s) => s.name)).toEqual(["title"]);

  // Deleting it is supported: the page still reads and the built-in row draws.
  rmSync(join(dirOf(ref.id), "child.html"));
  expect((await pages.read(ref.id))!.name).toBe("Ashgrove");
  const after = (await pages.read(clients.id))!.sections.find((s) => s.name === key);
  expect(after!.parts["body"]).toEqual({
    kind: "child",
    child: { kind: "page", id: ref.id, name: "Ashgrove" },
  });
  // And nothing on the read path puts it back, or deleting it would be an act
  // the next read undid.
  expect(existsSync(join(dirOf(ref.id), "child.html"))).toBe(false);
  db.close();
});

/* ── base/, the blocks that ship with every workspace ───────────────────── */

// Read as data, and held to the same discipline the shipped presets used to be:
// these are the reference a generated section is written from, so a rule that
// quietly stops holding here stops holding in everything copied from it.

const BASE_DIR = join(import.meta.dir, "..", "vault", "base");

const baseIds = (): string[] =>
  existsSync(BASE_DIR)
    ? readdirSync(BASE_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(BASE_DIR, e.name, "content.yaml")))
        .map((e) => e.name)
    : [];

test("base/ says what it is, once", () => {
  // A new idea in the vault layout gets one paragraph rather than a convention
  // the next person has to infer from a directory listing.
  expect(existsSync(join(BASE_DIR, "README.md"))).toBe(true);
  expect(baseIds()).toContain("diagram");
  // The one block that is not only an example: it is what `pages.create` copies
  // into every new page as `child.html`.
  expect(baseIds()).toContain("child");
});

/** The one starter that is NOT a section. `pages.create` copies it into every
 *  page as `child.html` and the child plugin mounts it there, which is why
 *  `CHILD_DEFAULT` in pages.ts names this exact path. Everything else under
 *  `base/` is a section, so the exception is stated once here rather than
 *  inferred in four places. */
const CHILD = "child";

test("base/child draws from the child's own fields, and names none of them", () => {
  const html = readFileSync(join(BASE_DIR, CHILD, "index.html"), "utf8");

  // IT IS NOT A SECTION. It is markup the child plugin mounts into one slot, so
  // it declares no slots of its own — a `data-g-part` in here would be a slot
  // inside a slot, which nothing fills.
  expect(partsIn(html)).toEqual([]);

  // THE POINT OF IT IS THAT IT IS GENERAL. The same file is in every page
  // directory, so it cannot know which child it stands for — it draws the
  // child's OWN fields, which are the nearest scope. A name copied in here is
  // wrong the moment somebody renames the page, and nothing on screen would say
  // so.
  for (const field of ["{{name}}", "{{kind}}"]) expect(html).toContain(field);
  expect(html).not.toMatch(/["'`]@(?:page|table)-[a-z0-9-]+/);

  // A ROW, not a card: it sits in a run of built-in rows, so what it draws is
  // the name, the kind and a count, and nothing else. Counted against the MARKUP
  // rather than the file, because the header names the four fields in prose.
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  const fields = new Set(markup.match(/\{\{[a-z]+\}\}/g) ?? []);
  expect(fields.size).toBeGreaterThan(0);
  expect(fields.size).toBeLessThanOrEqual(4);
  // Every one of them is a field the child itself has — `Child` carries a kind,
  // an id, a name and (tables only) a row count, and nothing else is in scope.
  for (const field of fields) {
    expect(["{{name}}", "{{kind}}", "{{id}}", "{{rows}}"]).toContain(field);
  }
});

test("no starter still carries the retired slot spelling", () => {
  // `data-g-slot` named a VARIABLE in scope. `data-g-part` names a SLOT, and a
  // slot's id is its key in `parts`. A starter is what everything else is copied
  // from, so one left behind here propagates into every page written afterwards
  // and draws nothing, silently.
  for (const id of baseIds()) {
    const html = readFileSync(join(BASE_DIR, id, "index.html"), "utf8");
    expect([id, retiredSlotsIn(html)]).toEqual([id, []]);
  }
});

test("every base block is a page in the shape a page has, and its variables are fields", () => {
  for (const id of baseIds()) {
    const raw = readFileSync(join(BASE_DIR, id, "content.yaml"), "utf8");
    const doc: PageDoc = parse(raw);
    // Byte-stable under the codec the host writes with, so the first slot edit
    // does not reflow the whole file into a diff nobody can read.
    expect([id, format(doc)]).toEqual([id, raw]);
    for (const key of RESERVED) expect([id, key, declares(raw, key)]).toEqual([id, key, true]);
    // Every retired key is refused BY NAME rather than ignored, so a block still
    // carrying one is a block that will not parse.
    for (const key of GONE) expect([id, key, declares(raw, key)]).toEqual([id, key, false]);
    expect([id, existsSync(join(BASE_DIR, id, "index.html"))]).toEqual([id, true]);

    for (const value of Object.values(doc.variables)) {
      for (const v of scalarsOf(value)) {
        if (typeof v === "string") expect([id, v.includes("\n")]).toEqual([id, false]);
      }
    }
  }
});

test("a base block holds the artifact rules, and reaches nothing but /vendor/", () => {
  for (const id of baseIds()) {
    const html = readFileSync(join(BASE_DIR, id, "index.html"), "utf8");
    const style = styleOf(html);

    // Custom properties do not cross a document boundary, so the frame is handed
    // the palette as data and re-declares it. A literal in here is a block that
    // stops matching the workspace the moment the palette changes.
    expect([id, html.match(/#[0-9a-fA-F]{3,8}\b/)]).toEqual([id, null]);
    expect([id, style.match(/\b(?:rgba?|hsla?|oklch|lab|color)\s*\(/)]).toEqual([id, null]);
    expect([id, html.match(/\sstyle\s*=/)]).toEqual([id, null]);
    expect([id, html.match(/\son[a-z]+\s*=/)]).toEqual([id, null]);
    expect([id, html.match(/\beval\s*\(|new\s+Function\s*\(|innerHTML|insertAdjacentHTML/)]).toEqual([id, null]);
    // Inside a form the default is submit, which reloads the frame.
    for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
      expect([id, m[1]]).toEqual([id, expect.stringContaining("type=")]);
    }

    // Nothing here calls out: the box has an opaque origin and cannot fetch.
    expect([id, html.match(/\b(?:window\.)?fetch\s*\(|XMLHttpRequest|importScripts|@import/)]).toEqual([id, null]);
    // A CLASSIC script from /vendor/ and nothing else with a src or an href
    // anywhere in the file — that is the one subresource an opaque origin may
    // still load.
    for (const m of html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*"([^"]*)"/g)) {
      expect([id, m[1]]).toEqual([id, expect.stringMatching(/^\/vendor\/[a-z.-]+\.js$/)]);
    }
    // A module build is CORS-blocked from an opaque origin, so the tag must be
    // classic. This is the assertion that catches a well-meaning "modernise".
    expect([id, html.match(/<script[^>]*\btype\s*=\s*"module"/)]).toEqual([id, null]);
  }
});

test("a starter section declares its slots, and its document fills every one", () => {
  for (const id of baseIds()) {
    // The child template is markup for a slot rather than a section — see above.
    if (id === CHILD) continue;
    const doc = parse(readFileSync(join(BASE_DIR, id, "content.yaml"), "utf8"));
    const slots = partsIn(readFileSync(join(BASE_DIR, id, "index.html"), "utf8"));

    expect([id, slots.length > 0]).toEqual([id, true]);
    // One slot id, one editable region. Two elements claiming an id is a section
    // whose edits fight each other.
    expect([id, new Set(slots).size]).toEqual([id, slots.length]);

    // A SLOT'S ID IS ITS KEY IN `parts`, so the markup and the document are the
    // same set — one entry per `data-g-part` the html declares, no more and no
    // fewer. A starter that shipped a slot with nothing behind it would draw an
    // empty band, and one that shipped an entry no slot declares would be words
    // nobody can see.
    const section = doc.contents.find((c) => c.data === "index.html");
    expect([id, section !== undefined]).toEqual([id, true]);
    expect([id, sorted(Object.keys(section!.parts ?? {}))]).toEqual([id, sorted(slots)]);

    for (const slot of slots) {
      // BARE names, lowercase, no dot and no `@`: a slot is never a child key,
      // because a child is what goes IN a slot rather than a name for one.
      expect([id, slot, /^[a-z][a-z0-9_-]*$/.test(slot)]).toEqual([id, slot, true]);
      // Never slot one of the reserved keys, or editing a heading would change
      // what the page IS rather than what it says.
      expect([id, slot, (RESERVED as readonly string[]).includes(slot)]).toEqual([id, slot, false]);
    }
  }
});

test("base/diagram is a CUSTOM drawing — HTML laid out from the document's own words", () => {
  // THE DECISION THIS STARTER IS THE WORKED EXAMPLE OF. Mermaid is not shipped:
  // the whole point of the format is a custom drawing, so a diagram here is HTML
  // the section writes, on the palette's tokens, drawn in on reveal — exactly
  // what every other figure in a workspace is.
  const html = readFileSync(join(BASE_DIR, "diagram", "index.html"), "utf8");
  const doc = parse(readFileSync(join(BASE_DIR, "diagram", "content.yaml"), "utf8"));
  const section = doc.contents.find((c) => c.data === "index.html");
  expect(section).toBeDefined();

  // No library, no fence, and no language named anywhere in the file.
  expect(html).not.toContain("mermaid");
  expect(html).not.toContain("/vendor/");
  expect(html).toContain("createElement(");
  // AND IT IS HTML RATHER THAN VECTOR GEOMETRY. A figure is elements, grid and
  // flex, borders and backgrounds on the palette's tokens — which is the half of
  // the rule a shape test can actually hold.
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("createElementNS");
  expect(html).toContain("display: grid");

  // THE WORDS ARE THE DIAGRAM. Boxes and arrows are the section's own variables
  // — parallel lists sharing a stem and the same length — so editing the drawing
  // is editing the document, which is what the fence was ever worth having for.
  const vars = section!.variables ?? {};
  const nodes = vars["nodes"];
  expect(Array.isArray(nodes)).toBe(true);
  expect((nodes as unknown[]).length).toBeGreaterThan(1);
  const stems = ["edgeFrom", "edgeTo", "edgeSays", "edgeKind"];
  for (const stem of stems) expect([stem, Array.isArray(vars[stem])]).toEqual([stem, true]);
  const lengths = new Set(stems.map((stem) => (vars[stem] as unknown[]).length));
  expect([...lengths]).toHaveLength(1);

  // AND SO IS THE MARK EACH STATION WEARS. `nodeIcon` is one entry per node, in
  // the document beside the name, rather than a class typed into the markup —
  // the icon is part of what the diagram SAYS, so it is edited where the rest of
  // the diagram is. Every entry names a shape this file actually draws; a starter
  // whose own example fell through to the fallback mark would be teaching the
  // fallback.
  const marks = vars["nodeIcon"];
  expect(Array.isArray(marks)).toBe(true);
  expect((marks as unknown[]).length).toBe((nodes as unknown[]).length);
  for (const mark of marks as string[]) {
    expect([mark, html.includes(".ico.is-" + mark)]).toEqual([mark, true]);
  }
  // THE MARKS ARE DRAWN AND NOT FETCHED — a border and two pseudo-elements, on
  // the palette's tokens like everything else, so there is no picture file and no
  // icon font to go missing.
  expect(html).toContain(".ico::before");
  expect(html).not.toMatch(/<img\b|url\(/);

  // AND THE REVEAL WALKS THE LOOP. One station lit at a time, off the same
  // `--motion` switch the edges use, so stillness is still the finished drawing.
  expect(html).toContain("station-lit");
  expect(html).toContain("var(--n, 0)");

  // NOTHING IN THE MARKUP HOLDS A POSITION. The script lays the graph out from
  // the edges, so adding a node is adding a name — a row or a lane typed into a
  // file is a number somebody has to maintain. Every one of them reaches the
  // stylesheet as a custom property instead.
  expect(html).not.toMatch(/grid-(?:row|column)\s*:\s*\d+\s*\//);
  expect(html).toContain("grid-row: var(--from, 1) / var(--to, 2)");
  expect(html).toContain("var(--lane, 0)");
  // And nothing in it has a width in pixels: the boxes take the column they are
  // given and the lanes are in rem.
  expect(html).not.toMatch(/(?:^|[;{\s])(?:min-)?width\s*:\s*\d/m);
  expect(html).not.toMatch(/inline-size:\s*\d+px/);

  // IT MOVES WHEN IT ARRIVES, ONCE, BEHIND THE FRAME'S SWITCH. `reveal` adds the
  // class and disconnects; every duration is multiplied by `--motion`, so a
  // reader who asked for stillness gets the finished drawing and nothing else.
  expect(html).toContain('data-g-plugin="reveal"');
  expect(html).toContain(":scope.is-seen");
  expect(html).toContain("var(--motion, 1)");
  expect(html).toContain("prefers-reduced-motion");

  // Fixtures admit to being fixtures, on the page, in a slot. A number that does
  // not say it is invented is a number somebody quotes back at you.
  expect(String(section!.parts?.["note"] ?? "")).toContain("invented");
});

/* ── the root page a stranger lands on ──────────────────────────────────── */

test("the root page's own markup holds the artifact rules, and carries no path", () => {
  // IT IS THE ONE PAGE NOBODY WROTE, so it is the one page nothing would catch:
  // the checker is handed a page directory and deliberately does not read an
  // `index.html` — a page that draws itself is the page's own business — and
  // this file is copied, as it stands, into every workspace anybody ever makes.
  const html = ROOT_MARKUP;

  expect(html).not.toMatch(/\sstyle\s*=/);
  expect(html).not.toMatch(/\son[a-z]+\s*=\s*["']/);
  expect(html).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|innerHTML|insertAdjacentHTML/);
  // Inside a form the default is submit, which reloads the frame.
  for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
    expect(m[1]).toEqual(expect.stringContaining("type="));
  }
  // The box has an opaque origin and cannot fetch, and this page has nothing to
  // fetch: the one picture on it travels in the file.
  expect(html).not.toMatch(/\b(?:window\.)?fetch\s*\(|XMLHttpRequest|importScripts|@import/);
  expect(html).not.toMatch(/<script[^>]*\btype\s*=\s*"module"/);
  for (const m of html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*"([^"]*)"/g)) {
    expect(m[1]).toEqual(expect.stringMatching(/^\/vendor\/[a-z.-]+\.js$/));
  }
  // A PAGE MAY NOT MEASURE THE WINDOW. Two modules to a row and one when there
  // is no room for two, and the step down is a query against the FIGURE — which
  // is what `container-type` on it is for. A `@media` query here would be the
  // page asking about a window it is not allowed to know the size of.
  expect(html).toContain("container-type: inline-size");
  expect(html).toContain("@container");
  expect(html.match(/@media[^{]*\(\s*(?:min|max)-width/g) ?? []).toEqual([]);
  expect(html).not.toMatch(/(?:^|[;{\s])(?:min-)?width\s*:\s*\d{3,}px/m);
  // MOTION SETTLES. Every module rests full, and a reader who has asked for
  // less gets the figure complete and still rather than the figure missing.
  expect(html).toContain("prefers-reduced-motion");

  // The literals are the OTHER workspaces the figure is drawing, and they are
  // the only ones: everything this page paints itself with is a token the open
  // workspace rewrites. Counted against the `--w-` palettes so a colour written
  // anywhere else is a test that fails rather than a page that stops matching
  // the folder it is in.
  const hexes = [...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].length;
  const inPalettes = [...html.matchAll(/--w-[a-z0-9-]+:\s*#[0-9a-fA-F]{3,8}/g)].length;
  expect([hexes, inPalettes]).toEqual([inPalettes, inPalettes]);
});

test("every word on the root page writes itself back through its own slot", async () => {
  const { db, presets, pages } = boot(root);
  await presets.seedIfEmpty();

  // THE CLAIM THE WHOLE PAGE RESTS ON. A page with no sections keeps its words
  // in its own top-level keys, so the slot the markup declares and the key the
  // document holds are the same name with nothing between them — which is what
  // makes the first screen a page somebody can type into rather than a picture
  // of one. `section: null` is the wire's spelling of "the page itself".
  await pages.writeSlot(ROOT_PAGE, null, "heading", "# Point it here.\n");
  const asks = ["one thing", "another thing"];
  await pages.writeSlot(ROOT_PAGE, null, "asks", asks);

  const page = await pages.read(ROOT_PAGE);
  expect(page!.input["heading"]).toBe("# Point it here.\n");
  // A LIST IS WRITTEN WHOLE, so shortening the eight to two is one write and
  // the page draws two — there is no number anywhere that says eight.
  expect(page!.input["asks"]).toEqual(asks);
  expect(readFileSync(join(root, "pages", ROOT_PAGE, "content.yaml"), "utf8")).toContain("Point it here.");

  db.close();
});

test("the root page is written only when there is none, and never again", async () => {
  const first = boot(root);
  await first.presets.seedIfEmpty();
  first.db.close();

  const doc = join(root, "pages", ROOT_PAGE, "content.yaml");
  const markup = join(root, "pages", ROOT_PAGE, "index.html");
  writeFileSync(doc, "name: Mine\nplugin: html\n");
  writeFileSync(markup, "<p>Mine.</p>\n");

  const again = boot(root);
  await again.presets.seedIfEmpty();
  await again.pages.list();
  // A ROOT SOMEBODY EDITED IS THEIRS. Every other piece of furniture is filled
  // in where it is missing; this one is not written at all once it is there,
  // markup included — the copy in the page directory is the person's page.
  expect(readFileSync(doc, "utf8")).toBe("name: Mine\nplugin: html\n");
  expect(readFileSync(markup, "utf8")).toBe("<p>Mine.</p>\n");
  again.db.close();
});


test("the seeded root draws itself, and asks where the workspace is", async () => {
  const { db, presets, pages } = boot(root);
  await presets.seedIfEmpty();

  // IT IS NOT A DOC PAGE. The first screen is a band over a print carrying the
  // one step a person has to take, and the doc plugin's frame exists to cap a
  // part at the reading measure and centre it — so the root draws itself.
  const doc = readFileSync(join(root, "pages", ROOT_PAGE, "content.yaml"), "utf8");
  expect(declares(doc, "contents")).toBe(false);
  expect(existsSync(join(root, "pages", ROOT_PAGE, "index.html"))).toBe(true);

  // THE PATH IS NOT IN THE DOCUMENT, and that is the property. A folder seeded
  // into the page is a fact that stops being true the day somebody moves the
  // workspace, and it stops being true silently.
  const markup = readFileSync(join(root, "pages", ROOT_PAGE, "index.html"), "utf8");
  expect(doc).not.toContain(root);
  expect(markup).not.toContain(root);
  expect(markup).toContain("biom.vault()");

  // EVERY WORD IS STILL THE DOCUMENT'S. On a page with no sections the page's
  // own top-level keys are its slots, so each of these opens under the caret in
  // the app — and the markup declares one hole per key and no prose of its own.
  const page = await pages.read(ROOT_PAGE);
  expect(page!.sections).toEqual([]);
  for (const key of ["heading", "lede", "about", "asksHeading", "asksAside", "asks"]) {
    expect([key, page!.input[key] !== undefined]).toEqual([key, true]);
    expect([key, markup.includes('data-g-part="' + key + '"')]).toEqual([key, true]);
  }
  // The asks are ONE slot holding a list, so each ask is an entry and nothing
  // anywhere says how many there are. One more is one more entry.
  expect(Array.isArray(page!.input["asks"])).toBe(true);
  const asks = page!.input["asks"] as string[];
  expect(asks.length).toBeGreaterThan(1);

  // AN ASK IS TWO BLOCKS: the short line it is known by, and under it the real
  // prompt somebody pastes into their agent. A line with no prompt under it is
  // a figure saying what is possible rather than something a person can act on,
  // so every one of them carries both.
  for (const ask of asks) {
    const blocks = ask.trim().split(/\n{2,}/);
    expect([ask.slice(0, 40), blocks.length >= 2]).toEqual([ask.slice(0, 40), true]);
    expect([ask.slice(0, 40), blocks[1].length > 120]).toEqual([ask.slice(0, 40), true]);
  }

  // NOTHING IN A PROMPT MAY PROMISE MORE THAN THE BUILD DOES. There is no
  // scheduler inside this program, so a prompt that recurs says so and sends
  // the schedule to the agent's own tooling.
  for (const ask of asks) {
    if (!/\b(?:[Ee]very (?:morning|night|day|week)|nightly|daily)\b/.test(ask)) continue;
    expect([ask.slice(0, 40), /can start you/.test(ask)]).toEqual([ask.slice(0, 40), true]);
  }

  // ONE MODULE PER ASK, and the page's own markup is what says how many modules
  // there are — so a line added here without a drawing is a test that fails
  // rather than an ask that silently draws nothing.
  expect(asks.length).toBe((markup.match(/<div class="tile /g) ?? []).length);

  // THE FIRST STEP IS THE DESIGN DOC, and it is a word in the document rather
  // than an anchor in the markup: it opens under the caret with the sentence
  // around it. `@design` is the reserved id, which is outside a page segment's
  // grammar and so can never be a page somebody made.
  expect(String(page!.input["about"])).toContain("[[@design|Design]]");
  expect(markup).not.toContain("@design");

  // The page IS its index.html: the document names no plugin of its own, and
  // what the box loads is the file beside it.
  expect(page!.html).toBe(markup);

  // THE PRINT TRAVELS INSIDE THE PAGE. A workspace is text files and `Files`
  // reads and writes utf-8, so the one picture on this page is a data url in
  // the markup rather than a second file the seeder could not copy.
  expect(markup).toContain("data:image/webp;base64,");

  db.close();
});

/** RUN `base/diagram/`'s OWN SCRIPT, the way the section runtime runs one —
 *  `(section, ctx, onTeardown)`, a classic function body — against a DOM small
 *  enough to be read in one screen and real enough for the layout to be wrong in
 *  it. There is no DOM in `bun test` and the layout is the half of that starter
 *  that has been wrong twice, so this is the cheapest honest way to hold it. */
function drawDiagram(vars: Record<string, unknown>): {
  rows: string[][];
  rowLines: number[];
  links: { from: number; to: number; lane: number; back: boolean; dash: boolean; says: string }[];
  labels: string[];
  fault: boolean;
  plot: Record<string, string>;
} {
  const html = readFileSync(join(BASE_DIR, "diagram", "index.html"), "utf8");
  const src = /<script>([\s\S]*)<\/script>/.exec(html);
  if (!src) throw new Error("base/diagram/index.html has no section script");

  interface El {
    tag: string; attrs: Record<string, string>; props: Record<string, string>; kids: El[]; text: string;
  }
  const el = (tag: string): El => {
    const node: El = {
      tag, attrs: {}, props: {}, kids: [], text: "",
      setAttribute(k: string, v: string) { node.attrs[k] = String(v); },
      getAttribute: (k: string) => node.attrs[k],
      appendChild(kid: El) { node.kids.push(kid); },
      // THE CUSTOM PROPERTIES ARE THE LAYOUT NOW, so the fake has to keep them:
      // a row's grid line, an edge's span, its lane and its place in the stagger
      // are the whole of what this script tells the stylesheet.
      style: { setProperty(k: string, v: string) { node.props[k] = String(v); } },
      set textContent(v: string) { node.text = String(v); },
      get textContent() { return node.text; },
    } as unknown as El;
    return node;
  };
  let drawn: El | null = null;
  const plate = { replaceChildren(node: El) { drawn = node; } };
  const classes = new Set<string>();
  const section = { querySelector: () => plate, classList: { add: (c: string) => classes.add(c) } };

  new Function("section", "ctx", "onTeardown", "document", src[1])(
    section, { vars }, () => {}, { createElement: (tag: string) => el(tag) },
  );

  const plot = drawn as El | null;
  const kids: El[] = plot ? plot.kids : [];
  const rowEls = kids.filter((k) => k.attrs.class === "row");
  const links = kids.filter((k) => k.attrs.class === "link");
  const lineOf = (link: El) => link.kids.find((k) => (k.attrs.class || "").startsWith("line"));
  return {
    rows: rowEls.map((r) => r.kids.map((n) => n.text)),
    rowLines: rowEls.map((r) => Number(r.props["--row"])),
    links: links.map((link) => {
      const line = lineOf(link)!;
      return {
        from: Number(link.props["--from"]),
        to: Number(link.props["--to"]),
        lane: Number(link.props["--lane"]),
        back: (line.attrs.class || "").includes("is-back"),
        dash: (line.attrs.class || "").includes("is-dash"),
        says: link.kids.find((k) => k.attrs.class === "says")?.text ?? "",
      };
    }),
    labels: rowEls.flatMap((r) => r.kids.map((n) => n.text)),
    fault: classes.has("is-fault"),
    plot: plot ? plot.attrs : {},
  };
}

test("base/diagram lays a LOOP out in one row per node, and runs the closing edge back up its own lane", () => {
  // BOTH HALVES OF THIS WERE MEASURED FAULTS in the loop this starter ships
  // with, and neither is visible to a test about the file's shape.
  //
  // The rows: an edge that closes a cycle has no "how far from a source" to
  // contribute, and left in the relaxation it pushed the whole ring one row
  // further down the page on every pass. The closing edge is found by a
  // depth-first walk and taken out of the layout; it is still drawn.
  //
  // The lanes: the closing edge crosses every row the forward ones do, so it
  // cannot share a lane with any of them — it would be drawn straight over them
  // and be invisible. It takes the next lane out, and the three forward edges,
  // which cross nothing of each other's, all sit in the first.
  const loop = ["Somebody asks", "Claude writes the file", "The window redraws", "The page is the workspace"];
  const drew = drawDiagram({
    nodes: loop,
    edgeFrom: loop,
    edgeTo: [loop[1], loop[2], loop[3], loop[0]],
    edgeSays: ["in a sentence", "one commit per write", "no build step", "and asks again"],
    edgeKind: ["solid", "solid", "solid", "dashed"],
  });

  expect(drew.labels).toEqual(loop);
  // One row per node, in order, and two grid rows each so a bracket can start
  // and end halfway down a box rather than at its corner.
  expect(drew.rows).toEqual(loop.map((name) => [name]));
  expect(drew.rowLines).toEqual([1, 3, 5, 7]);

  // Every forward edge spans one row, carries its own words, and is in the lane
  // nearest the boxes.
  const forward = drew.links.filter((l) => !l.back);
  expect(forward.map((l) => [l.from, l.to])).toEqual([[2, 4], [4, 6], [6, 8]]);
  expect(forward.every((l) => l.lane === 0)).toBe(true);
  expect(forward.map((l) => l.says)).toEqual(["in a sentence", "one commit per write", "no build step"]);

  // And the closing edge is drawn, dashed, spanning the whole loop, in a lane of
  // its own outside every forward edge.
  const back = drew.links.filter((l) => l.back);
  expect(back).toHaveLength(1);
  expect([back[0]!.from, back[0]!.to]).toEqual([2, 8]);
  expect(back[0]!.dash).toBe(true);
  expect(back[0]!.lane).toBeGreaterThan(0);
});

test("base/diagram says so in its own slot when there is nothing to draw yet", () => {
  // A BLANK RECTANGLE IS INDISTINGUISHABLE FROM A PAGE STILL LOADING, and the
  // person looking at one is usually the person who could have fixed it.
  const drew = drawDiagram({ nodes: [], edgeFrom: [], edgeTo: [] });
  expect(drew.fault).toBe(true);
  expect(drew.rows).toHaveLength(0);
});

test("base/diagram takes a lone node written as a scalar, and drops an edge naming nobody", () => {
  // A ONE-ITEM LIST IS WRITTEN AS A SCALAR by most people writing YAML, so
  // reading only the list form breaks the smallest diagram somebody draws. And
  // an edge naming a node nobody wrote is a typo: drawing the graph around the
  // hole is how a diagram quietly stops matching the argument beside it.
  const drew = drawDiagram({ nodes: "Only one", edgeFrom: "Only one", edgeTo: "A name nobody wrote" });
  expect(drew.labels).toEqual(["Only one"]);
  expect(drew.links).toHaveLength(0);
});

test("the REAL checker runs over every starter, and every section starter is clean", async () => {
  // `base/README.md` says this happens, and until now nothing did it. A starter
  // is what every page in a workspace is copied from, so one that quietly stopped
  // matching the format it is here to teach would spread the drift rather than
  // report it — and a starter whose figure is now a drawing with a script in it
  // is exactly the kind of file that can pass a shape test and fail the rules.
  const vault = mkdtempSync(join(tmpdir(), "biom-base-"));
  cpSync(BASE_DIR, join(vault, "base"), { recursive: true });
  writeFileSync(join(vault, "theme.json"), "{}\n");
  mkdirSync(join(vault, "pages"), { recursive: true });

  for (const id of baseIds()) {
    const ran = Bun.spawnSync({
      cmd: ["bun", "run", join(import.meta.dir, "..", "skill", "check.ts"), join("base", id)],
      cwd: vault,
    });
    const said = new TextDecoder().decode(ran.stdout) + new TextDecoder().decode(ran.stderr);
    expect([id, said]).toEqual([id, expect.stringContaining("0 fail")]);
    // EVERY ONE OF THEM REPORTS NOTHING, `base/child/` included: it is markup for
    // a slot rather than a section, and nothing in its document names its
    // `index.html`, but R42 exempts that name because a file called `index.html`
    // IS the page rather than something a document has to point at.
    expect([id, said]).toEqual([id, expect.stringContaining("0 warn")]);
  }

  rmSync(vault, { recursive: true, force: true });
});
