// SPDX-License-Identifier: AGPL-3.0-only
// The design doc, and the empty vault it arrives in.
//
// Two claims are under test and they are one change.
//
//   · `design/` IS the design doc, and it lives in the vault ROOT beside
//     `pages/` rather than inside it. That placement is the whole design: the
//     rail draws `pages/`, so this is out of the page tree by construction —
//     no reserved key, no hidden-id list, no third page kind. It reads back as
//     the same `Page` shape `pages.read` answers with, because the client draws
//     it with the same runtime.
//
//   · A NEW VAULT IS EMPTY. The root page and nothing else under `pages/`.
//     Everything that still seeds is furniture — the design doc, `AGENTS.md`,
//     `.agents/skills/`, `base/`, the theme — and every one of those writes is additive
//     file by file, so a vault made before any of it existed gains the missing
//     pieces on the next start and anything edited stays edited.
//
// WHAT MOVED WITH THE FORMAT. The doc's prose used to be one `.md` file per
// block with `order:` naming them; it is `contents` now — a list of SECTIONS,
// and nothing else — each entry carrying its own slots and its own words. There
// is no `kind:`, no `render:` and no `order:`, because the array IS the order.
// So `writeFile` is no longer how you change what the doc SAYS — that is `patch`
// for a value and the raw `content.yaml` for the text — and what it is still for
// is the two things that are genuinely files: a section's own html, and an
// `html` slot's file beside it.
//
// Real temp directories throughout. The one thing this module does is read and
// write a folder, and a fake disk would be testing the fake.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initVault, makeFiles } from "../server/platform/files.ts";
import { makeDb } from "../server/platform/db.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { makeDesign } from "../server/domain/design.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { makePages } from "../server/domain/pages.ts";
import { makeTables } from "../server/domain/tables.ts";
import { makePresets, makeTheme } from "../server/workspace/presets.ts";
import { rewriteSkills } from "../server/workspace/framework.ts";
import { handle } from "../server/api/routes.ts";
import { isHostRequest } from "../contracts/guards.js";
import { PROTOCOL } from "../contracts/wire.js";
import { ROOT_PAGE, parentOf } from "../contracts/types.ts";
import type { ApiRequest, ApiResponse, Page, PageDoc, PageRef, Part } from "../contracts/types.ts";

const FRAMEWORK = join(import.meta.dir, "..");
const VAULT_SEED = join(FRAMEWORK, "vault");
const SKILL = join(FRAMEWORK, "skill");

let seq = 0;
const req = (o: Record<string, unknown>): ApiRequest => ({ id: `d${++seq}`, g: PROTOCOL, ...o }) as ApiRequest;

const value = (res: ApiResponse): unknown => {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.value;
};

const code = (res: ApiResponse): string => (res.ok ? "ok" : res.error.code);

/** The whole server stack over one directory, exactly as main.ts builds it —
 *  including the one line that matters here, a `Files` ROOTED AT `design/`.
 *  Calling it twice against the same directory is what "survive a rebuild"
 *  means: nothing crosses in memory, so anything still there came off disk.
 *
 *  NO `seed:` AND NO `market:`. Nothing ships a preset directory any more and
 *  the catalogue went with the render layer it was written against, so the
 *  seeder is handed the vault's own furniture and nothing else. */
function boot(dir: string) {
  const files = makeFiles(dir);
  const db = makeDb(join(dir, "workspace.db"));
  const yaml = { parse, parseAny, format };
  const tables = makeTables(db);
  const pages = makePages(files, yaml, () => tables.list());
  const design = makeDesign(makeFiles(join(dir, "design")), yaml);
  const docs = makeDocs(files, yaml);
  const theme = makeTheme(files);
  const presets = makePresets({
    pages, tables, files, yaml,
    vaultSeed: makeFiles(VAULT_SEED),
  });
  /** What the host does on open: the seeder's fill, then the framework's
   *  skills rewritten whole — the second is `framework.ts`'s and runs off the
   *  mount path there, so a test that wants the furniture asks for both. */
  const furnish = async () => {
    await presets.seedIfEmpty();
    await rewriteSkills(files, makeFiles(VAULT_SEED), makeFiles(SKILL), makeFiles(join(import.meta.dir, "..")));
  };
  return { db, files, pages, design, docs, tables, presets, theme, furnish, deps: { pages, design, docs, tables, presets, theme } };
}

/** The design doc's own document, off disk. */
const docOnDisk = (dir: string): PageDoc => parse(readFileSync(join(dir, "design", "content.yaml"), "utf8"));

/** The one part in a drawn section, by slot. Written out rather than reached for
 *  inline, because a slot that is not there has to fail as a missing slot rather
 *  than as `undefined.kind`. */
const partAt = (page: Page, section: string, slot: string): Part | undefined =>
  page.sections.find((s) => s.name === section)?.parts[slot];

let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "biom-design-"));
  await initVault(root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/* ── a new vault is empty ───────────────────────────────────────────────── */

test("a fresh vault has exactly one page, and it is the root", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();

  const listed = await w.pages.list();
  // ONE. Seeding somebody's folder with invented pages about a trade business
  // was noise they had to delete before they could start. There is still no
  // catalogue — it went with the render layer — so the root says how to fill the
  // vault instead: ask an agent.
  expect(listed.map((p) => p.id)).toEqual([ROOT_PAGE]);
  // The root's id has no `/` in it, which is the whole of "it is at the top":
  // a parent is everything before the last segment, derived and never stored.
  expect(parentOf(listed[0]!.id)).toBeNull();

  // Nothing under it, and no fixture table either.
  expect(await w.pages.children(ROOT_PAGE)).toEqual([]);
  expect(w.tables.list()).toEqual([]);

  const home = await w.pages.read(ROOT_PAGE);
  // Born with words on it rather than as a white canvas — and born drawing
  // itself rather than as a stack of sections, because the first screen is a
  // shape rather than a document. Its words are its own top-level slots.
  expect(home!.sections).toEqual([]);
  expect(Object.keys(home!.input)).toContain("heading");
  expect(home!.variables).toEqual({});

  w.db.close();
});

test("the furniture still seeds, because none of it is content", async () => {
  const w = boot(root);
  await w.furnish();

  // The guide, at the root, where an agent pointed at this folder finds it
  // without being told. This is the whole premise: the format guide used to
  // live in the framework repo, which the agent working in somebody else's vault
  // never sees.
  expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(".agents/skills/");

  // A PLAIN .agents/skills/, not .claude/skills/ — the vault has to read the same to
  // Cursor and Codex, and AGENTS.md is what points at it.
  expect(existsSync(join(root, ".claude"))).toBe(false);
  // And no `CLAUDE.md` beside the guide. A vendor-named copy of the same words
  // is the same favouritism one file up, and a second copy that drifts.
  expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
  // THE SKILLS ARE THE FRAMEWORK'S, rewritten on every open rather than filled
  // once — `framework.ts` — and the checker travels the same way; skill/ stays
  // the source of truth.
  expect(existsSync(join(root, ".agents", "skills", "biom-pages", "SKILL.md"))).toBe(true);
  expect(existsSync(join(root, ".agents", "skills", "check.ts"))).toBe(true);
  expect(existsSync(join(SKILL, "check.ts"))).toBe(true);

  // The design doc, BESIDE pages/ rather than inside it. That is the placement
  // the whole design rests on.
  expect(existsSync(join(root, "design", "content.yaml"))).toBe(true);
  expect(existsSync(join(root, "pages", "design"))).toBe(false);

  // AND `base/`, the starter sections every workspace gets. It rides the same
  // two-level walk as `.agents/skills/` and `design/` and needed no new mechanism, which
  // is the whole argument for it living under vault/. It is furniture,
  // not content: nothing installs itself.
  expect(existsSync(join(root, "base", "child", "index.html"))).toBe(true);
  expect(existsSync(join(root, "pages", "child"))).toBe(false);

  expect(existsSync(join(root, "theme.json"))).toBe(true);

  w.db.close();
});

test("seeding twice adds what is missing and leaves an edit alone", async () => {
  const first = boot(root);
  await first.furnish();
  first.db.close();

  // Somebody makes the design doc theirs, which is the entire interaction this
  // file exists for — and it is now an edit to the ONE FILE the doc is, not to
  // a `.md` beside it. A bare string in `parts` is markdown, because prose is
  // most of what a slot holds.
  const mine = docOnDisk(root);
  mine.name = "Ours";
  mine.contents = [{ name: "brand", parts: { body: "## Brand\n\nQuiet, dense, no gradients.\n" } }];
  writeFileSync(join(root, "design", "content.yaml"), format(mine));
  // And a vault made before a skill existed is simulated by deleting one.
  rmSync(join(root, ".agents", "skills", "biom-pages", "SKILL.md"));
  rmSync(join(root, "AGENTS.md"));

  const second = boot(root);
  await second.furnish();

  // ADDITIVE, FILE BY FILE, NEVER OVERWRITING, for what is the person's. The
  // gap in AGENTS.md is filled; the edit to the design doc is untouched. This
  // is the property that matters most here — and it costs more than it did,
  // because one file now holds the doc's words as well as its shape, so
  // overwriting it would take somebody's prose with it. The skill comes back
  // by the other rule: it is the framework's, and is rewritten.
  expect(existsSync(join(root, ".agents", "skills", "biom-pages", "SKILL.md"))).toBe(true);
  expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  expect(docOnDisk(root).name).toBe("Ours");
  expect(docOnDisk(root).contents.map((c) => c.name)).toEqual(["brand"]);
  expect(JSON.stringify(docOnDisk(root).contents)).toContain("Quiet, dense");

  // And it did not conjure a page while it was there.
  expect((await second.pages.list()).map((p) => p.id)).toEqual([ROOT_PAGE]);
  second.db.close();
});

/* ── design.read answers a Page ─────────────────────────────────────────── */

test("the design doc reads as a page, in the shape pages.read answers with", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();

  const page: Page = await w.design.read();
  // Not in the tree and it does not claim to be — that is what keeps it out of
  // the rail without a reserved key anywhere. Its id is a bare word that no
  // `PageId` is ever resolved against.
  expect(page.id).toBe("design");
  expect(page.ports).toBeNull();
  expect(page!.plugin).toBe("doc");
  expect(page.name.length).toBeGreaterThan(0);

  // SECTIONS in the order `contents` puts them — the array IS the order, so
  // there is no second statement of it to disagree. Each one carries its words
  // in the document itself; there is no second file to be out of step with.
  const doc = docOnDisk(root);
  expect(page.sections.map((s) => s.name)).toEqual(doc.contents.map((c) => c.name));
  for (const section of page.sections) {
    const said = doc.contents.find((c) => c.name === section.name)!;
    // A SECTION EITHER DRAWS WITH ITS OWN MARKUP OR WITH THE SHIPPED DEFAULT,
    // and `fallback` says which — which is exactly what the editor and the
    // checker want to know. The shipped doc has both kinds on it: the bands
    // carry a file, the prose under them carries none.
    expect([section.name, section.fallback]).toEqual([section.name, said.data === undefined]);
    expect([section.name, section.html.includes("data-g-part")]).toEqual([section.name, true]);
    // Every slot the document filled arrived, with its words in it.
    for (const slot of Object.keys(said.parts ?? {})) {
      const part = section.parts[slot];
      expect([section.name, slot, part?.kind]).toEqual([section.name, slot, "markdown"]);
    }
  }
  // RAW, braces and all: interpolation happens where the part is drawn, because
  // prose is edited in place and writes back.
  const first = doc.contents[0]!;
  expect(partAt(page, first.name, "body")).toMatchObject({ kind: "markdown", md: first.parts!["body"] });

  // The user's own page called `design`, which must never collide with this
  // one. Two id spaces, which is why `design.*` got its own wire kinds.
  const mine = await w.pages.create({ name: "Design" });
  expect(mine.id).toBe(`${ROOT_PAGE}/Design`);
  expect((await w.pages.read(mine.id))!.id).toBe(`${ROOT_PAGE}/Design`);
  expect((await w.design.read()).id).toBe("design");

  w.db.close();
});

test("a patch and an html slot survive a full rebuild from the same directory", async () => {
  const first = boot(root);
  await first.presets.seedIfEmpty();

  // A slot that names a FILE, which is the one thing the format still keeps
  // outside the document: HTML is code rather than prose and is not edited in a
  // field. Every string it SHOWS is a variable, which is what `patch` writes.
  const doc = docOnDisk(root);
  doc.contents = [...doc.contents, { name: "mark", parts: { figure: { type: "html", data: "mark.html" } } }];
  writeFileSync(join(root, "design", "content.yaml"), format(doc));
  await first.design.writeFile("mark.html", '<figure data-g-part="figure">One accent</figure>\n');

  // THE NEAREST ONE WINS, so where a value lands is what `patch` decides: null
  // is the doc's own variables, a name is that SECTION's.
  const page: PageDoc = await first.design.patch(null, { mood: "quiet" });
  expect(page.variables["mood"]).toBe("quiet");
  const scoped = await first.design.patch("mark", { caption: "One accent, and it is never red." });
  expect(scoped.contents.find((c) => c.name === "mark")?.variables?.["caption"])
    .toBe("One accent, and it is never red.");
  // And the page-level value is untouched by the scoped write.
  expect(scoped.variables["mood"]).toBe("quiet");
  first.db.close();

  // Nothing in memory crosses this line.
  const second = boot(root);
  const read = await second.design.read();
  expect(read.variables["mood"]).toBe("quiet");
  const part = partAt(read, "mark", "figure");
  expect(part).toMatchObject({ kind: "html", file: "mark.html" });
  expect(part && "html" in part ? part.html : "").toContain("One accent");
  // The part carries the variables in scope for it, nearest first — the slot's
  // own over the section's over the doc's.
  expect(part && "vars" in part ? part.vars : {}).toMatchObject({
    mood: "quiet",
    caption: "One accent, and it is never red.",
  });
  // The section's own `vars` are the same scope one step out.
  expect(read.sections.find((s) => s.name === "mark")?.vars).toMatchObject({ mood: "quiet" });
  // Written where the doc lives, not under pages/.
  expect(readFileSync(join(root, "design", "mark.html"), "utf8")).toContain("data-g-part");
  second.db.close();
});

/* ── the ways it can be broken ──────────────────────────────────────────── */

test("no design/ at all reads as an empty doc rather than a failure", async () => {
  const w = boot(root);
  // Deliberately not seeded: this is a vault made before the design doc existed,
  // in the moment before the next start fills it in.
  const page = await w.design.read();
  expect(page.sections).toEqual([]);
  expect(page.variables).toEqual({});
  expect(page.name).toBe("Design");

  // And it seeds on the next start, which is the whole of the fix.
  await w.presets.seedIfEmpty();
  expect((await w.design.read()).sections.length).toBeGreaterThan(0);
  w.db.close();
});

// WHAT A BROKEN content.yaml COSTS IS BIGGER THAN IT WAS, and it is stated
// rather than hidden: the prose is IN this file now, so one bad character takes
// the doc's words as well as its shape. The answer is that the vault is a git
// repo, the raw file is still openable, and — the part this test is about —
// READING NEVER WRITES, so opening the broken doc cannot be the act that empties
// it, and a patch is refused rather than landed on top.
test("a content.yaml that will not parse costs the doc, and the repair goes through writeFile", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();
  const before = readFileSync(join(root, "design", "content.yaml"), "utf8");
  writeFileSync(join(root, "design", "content.yaml"), "name: Design\n\tcontents: [oh dear\n");

  // It still OPENS. An empty doc rather than a failure, which is what gets
  // somebody to the surface that can repair it.
  const page = await w.design.read();
  expect(page.variables).toEqual({});
  expect(page.sections).toEqual([]);

  // A patch is refused rather than written, or editing a slot would be what
  // destroyed the file. The repair goes through writeFile, which is the raw
  // fallback here — `doc.raw` addresses a page under pages/ and cannot reach
  // this directory.
  await expect(w.design.patch(null, { mood: "quiet" })).rejects.toThrow();
  expect(readFileSync(join(root, "design", "content.yaml"), "utf8")).toContain("oh dear");

  // And the words come back, because the file is one revert — or one paste —
  // away.
  await w.design.writeFile("content.yaml", before);
  expect((await w.design.read()).sections.length).toBeGreaterThan(0);
  w.db.close();
});

test("a writeFile cannot leave design/", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();

  for (const path of ["../pages/home/content.yaml", "/etc/passwd", "a/b/c.md", "..", "_assets/../../x.md"]) {
    await expect(w.design.writeFile(path, "no")).rejects.toThrow();
  }
  // `_assets/` is the one subdirectory, and it is allowed.
  await w.design.writeFile("_assets/mark.svg", "<svg></svg>");
  expect(existsSync(join(root, "design", "_assets", "mark.svg"))).toBe(true);
  // Nothing landed outside.
  expect(readFileSync(join(root, "pages", ROOT_PAGE, "content.yaml"), "utf8")).toContain("name:");
  w.db.close();
});

test("a patch that carries something no field could hold is refused", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();

  // A variable is a value somebody types into a field: a scalar, or a list of
  // them. Nothing nested, because a nested variable has no field to be typed
  // into and no `{{name}}` that could name it.
  await expect(w.design.patch(null, { mood: { nested: true } as unknown as string })).rejects.toThrow();
  await expect(w.design.patch(null, { "": "blank" })).rejects.toThrow();
  await expect(w.design.patch(null, { "two words": "spaced" })).rejects.toThrow();
  // A section that is not on the doc. Refused rather than landed on the page,
  // because one scope out puts the value in scope for everything else on it.
  await expect(w.design.patch("nowhere", { caption: "x" })).rejects.toThrow();

  // Nothing above landed, and the doc still reads. The seeded doc has variables
  // of its own — the week its three worlds all draw, and the names on their
  // swatches — so what is asserted is that none of the refused names is among
  // them rather than that there are none.
  const page = await w.design.read();
  for (const name of ["mood", "", "two words", "caption"]) {
    expect([name, Object.hasOwn(page.variables, name)]).toEqual([name, false]);
  }
  expect(page.sections.length).toBeGreaterThan(0);
  w.db.close();
});

/* ── the three wire kinds ───────────────────────────────────────────────── */

test("design.read, design.patch and design.writeFile are the workspace's alone", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();
  const call = (o: Record<string, unknown>) => handle(req(o), w.deps as never);

  const page = value(await call({ kind: "design.read" })) as Page;
  expect(page.id).toBe("design");
  expect(page.sections.length).toBeGreaterThan(0);

  // `section` is on the wire because a slot writes into ONE scope and the server
  // must never guess which. null is the doc's own variables.
  const merged = value(await call({ kind: "design.patch", section: null, patch: { mood: "quiet" } })) as PageDoc;
  expect(merged.variables["mood"]).toBe("quiet");
  expect((value(await call({ kind: "design.read" })) as Page).variables["mood"]).toBe("quiet");

  // A named section, which is where a slot inside it writes.
  const first = page.sections[0]!.name;
  const scoped = value(await call({ kind: "design.patch", section: first, patch: { tone: "plain" } })) as PageDoc;
  expect(scoped.contents.find((c) => c.name === first)?.variables?.["tone"]).toBe("plain");
  // It did NOT land on the doc, which is the whole reason the scope is on the
  // wire: the nearest one wins, so a value one scope out changes what every
  // other section on the page says.
  expect(Object.hasOwn(scoped.variables, "tone")).toBe(false);

  expect(await call({ kind: "design.writeFile", file: "voice.html", text: "<main>Plain.</main>\n" }))
    .toMatchObject({ ok: true });
  expect(readFileSync(join(root, "design", "voice.html"), "utf8")).toContain("Plain.");

  // The failures carry codes from the closed enumeration and never a path.
  expect(code(await call({ kind: "design.patch", section: null, patch: { "a b": 1 } }))).toBe("bad_request");
  expect(code(await call({ kind: "design.patch", section: null, patch: { mood: { deep: 1 } } }))).toBe("flatness");
  expect(code(await call({ kind: "design.patch", section: "nowhere", patch: { a: 1 } }))).toBe("not_found");
  const escaped = await call({ kind: "design.writeFile", file: "../../etc/passwd", text: "no" });
  expect(code(escaped)).toBe("bad_request");
  if (!escaped.ok) expect(escaped.error.message).not.toContain("etc");

  // THE CHOKEPOINT, and it is the type rather than a check: `HostRequest` does
  // not carry these kinds, so the bridge refuses them with no allow-list
  // anywhere. An artifact has no business rewriting the workspace's own design
  // language — it is the thing the agent reads BEFORE it writes an artifact.
  for (const kind of ["design.read", "design.patch", "design.writeFile"]) {
    expect(isHostRequest({ id: "a", g: PROTOCOL, kind, section: null, patch: {}, file: "x.html", text: "" })).toBe(false);
  }
  expect(isHostRequest({ id: "a", g: PROTOCOL, kind: "theme.get" })).toBe(true);

  w.db.close();
});

/* ── the vault root seed is data, and these are its rules ───────────────── */

test("vault/ mirrors the vault root, and the design doc is a page", () => {
  expect(existsSync(join(VAULT_SEED, "AGENTS.md"))).toBe(true);
  expect(existsSync(join(VAULT_SEED, ".agents", "skills"))).toBe(true);
  expect(existsSync(join(VAULT_SEED, "design", "content.yaml"))).toBe(true);
  // `.claude/skills/` would make one agent first-class in a folder that has to
  // read the same to Cursor and Codex.
  expect(existsSync(join(VAULT_SEED, ".claude"))).toBe(false);
  expect(existsSync(join(VAULT_SEED, "CLAUDE.md"))).toBe(false);

  const raw = readFileSync(join(VAULT_SEED, "design", "content.yaml"), "utf8");
  const declares = (key: string) => new RegExp(`^${key}[ \\t]*:`, "m").test(raw);
  // The design doc carries its own reserved keys — nothing else writes them, so
  // a missing one is a doc with no name and no sections at all. Asserted against
  // the TEXT, because `parse` defaults every absent key and a doc that said
  // nothing would read back fine here.
  for (const key of ["name", "contents"]) {
    expect([key, declares(key)]).toEqual([key, true]);
  }
  // The four keys the format no longer has. yaml.ts REFUSES each of them BY
  // NAME rather than ignoring it — a file carrying one was written against a
  // format this reader does not have — so one left in here is a design doc that
  // will not parse at all.
  for (const key of ["kind", "render", "order", "parent"]) {
    expect([key, declares(key)]).toEqual([key, false]);
  }

  const doc = parse(raw);
  // Byte-stable under the codec the host writes with, so the first slot edit
  // does not reflow somebody's prose into a diff nobody can read.
  expect(format(doc)).toBe(raw);

  // EVERY SECTION HAS ITS WORDS, in every slot it declares. There is no `.md`
  // beside it to be missing, so the failure mode moved: an empty slot is a blank
  // region, and this is what catches one.
  expect(doc.contents.length).toBeGreaterThan(0);
  for (const section of doc.contents) {
    const parts = section.parts ?? {};
    expect([section.name, Object.keys(parts).length > 0]).toEqual([section.name, true]);
    for (const [slot, held] of Object.entries(parts)) {
      // A bare string is markdown, which is the spelling prose should have.
      expect([section.name, slot, typeof held]).toEqual([section.name, slot, "string"]);
      expect([section.name, slot, String(held).trim().length > 0]).toEqual([section.name, slot, true]);
    }
  }

  // IT DRAWS, AND THAT IS THE POINT OF IT. The design doc is the one page in a
  // new vault whose subject is what a page can look like, so describing three
  // designs in prose would have been the argument losing itself: it SHOWS the
  // shipped palette small, and then three complete worlds — a newspaper, a field
  // notebook, an instrument panel — each carrying its own palette in its own
  // `variables` and its own markup in a file beside this one. The prose sections
  // under them stay prose and take the shipped default, which is why both kinds
  // are asserted here rather than one.
  const files = new Set(doc.contents.map((c) => c.data).filter((d): d is string => typeof d === "string"));
  expect(files.size).toBeGreaterThan(0);
  for (const file of files) {
    expect([file, existsSync(join(VAULT_SEED, "design", file))]).toEqual([file, true]);
  }
  expect(doc.contents.some((c) => c.data === undefined)).toBe(true);
  // NEVER `index.html`. That name is the html plugin's page document, so a
  // section file called it would be injected into the body as well as drawn.
  expect(files.has("index.html")).toBe(false);
  expect(existsSync(join(VAULT_SEED, "design", "index.html"))).toBe(false);

  // A WORLD'S PALETTE IS THE SECTION'S OWN VARIABLES, so nothing in its markup
  // spells a colour and the values are edited where every other value is. The
  // page's own variables are what all three worlds share: one week, drawn three
  // ways.
  const worlds = doc.contents.filter((c) => c.variables !== undefined && c.data !== undefined);
  expect(worlds.length).toBeGreaterThan(0);
  for (const world of worlds) {
    for (const value of Object.values(world.variables!)) {
      expect([world.name, typeof value]).toEqual([world.name, "string"]);
    }
  }
  // And no stray `.md` files: the prose came inside, and a leftover file is a
  // second copy of a paragraph waiting to go stale.
  expect(existsSync(join(VAULT_SEED, "design", "brand.md"))).toBe(false);
});

/* ── the band that claims to be the workspace ───────────────────────────── */

// THE "AS IT SHIPS" BAND HAS TO BE TRUE IN THE VAULT IT IS SITTING IN, and the
// only way that holds is that it names no colour at all.
//
// It was written while the shipped default was a plain cream-and-red palette,
// and what the owner saw on a brand-new vault under the brand palette —
// charcoal, cream, one sunflower — would have been a band captioned *as it
// ships* drawing a scheme the workspace has not had for some time, with the
// three worlds below it, which ARE proposals and DO carry their own literals,
// looking like the honest ones. A literal typed into this band is wrong the
// first time the default changes and silent about it for ever after; a token is
// right in every vault by construction.
//
// So the band's markup is asserted to be free of hex, `rgb()`, `hsl()` and
// `oklch()` — R30, the same rule every section in a vault is held to — and its
// section is asserted to carry no `variables` at all, which is where a palette
// would go if anybody put one back. The three worlds are the deliberate
// exception and are checked the other way: each one HAS a palette of its own,
// in its own `variables`, because each is a different look rather than this one.
test("the band drawn as the workspace's own palette names no colour, and the worlds still name theirs", () => {
  const doc = parse(readFileSync(join(VAULT_SEED, "design", "content.yaml"), "utf8")) as PageDoc;

  const band = doc.contents.find((c) => c.name === "default");
  expect(band).toBeDefined();
  // No palette on the band. A world declares one; this one wears the vault's.
  expect(band?.variables).toBeUndefined();

  // R30, against the file the band draws with.
  const markup = readFileSync(join(VAULT_SEED, "design", band?.data as string), "utf8");
  for (const literal of [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/, /\bhsla?\(/, /\boklch\(/]) {
    expect([literal.source, literal.test(markup)]).toEqual([literal.source, false]);
  }
  // And it does read tokens, so "names no colour" is not satisfied by a band
  // that draws nothing coloured at all.
  expect(markup).toContain("var(--stock)");
  expect(markup).toContain("var(--ink)");

  // THE WORLDS KEEP THEIRS. A section with markup of its own AND variables is a
  // world; every value on one is a colour it declares onto the workspace's own
  // token names, which is what lets a band be a different look without any of
  // its markup spelling one.
  const worlds = doc.contents.filter((c) => c.data !== undefined && c.variables !== undefined);
  expect(worlds.length).toBeGreaterThan(1);
  for (const world of worlds) {
    const values = Object.values(world.variables as Record<string, string>);
    expect([world.name, values.every((v) => /^#[0-9A-Fa-f]{6}$/.test(String(v)))]).toEqual([world.name, true]);
  }
});

// THE WORDS OVER IT, which is the other half of the same false claim. The
// masthead said the workspace ships plain — *a floor to stand on, not a taste* —
// which stopped being true the day the brand became the default. There is no
// constant to hold this against: the sentence lives in the seeded
// `content.yaml` and nowhere else, which is the point of the format, so what is
// pinned here is that the retired claim is gone and the colours the workspace
// actually ships in are named — in the doc and in the styling guide that said
// the same thing in its own words.
test("the design doc's masthead says what the workspace actually ships in", () => {
  const doc = parse(readFileSync(join(VAULT_SEED, "design", "content.yaml"), "utf8")) as PageDoc;
  const title = doc.contents.find((c) => c.name === "title");
  const part = title?.parts?.["body"];
  const body = typeof part === "string" ? part : "";

  expect(body).toContain("# Design");
  expect(body).toContain("charcoal, cream and one sunflower");
  expect(body).toContain("in your own words");
  expect(body).not.toContain("plain on purpose");
  expect(body).not.toContain("a floor to stand on");
  expect(readFileSync(join(VAULT_SEED, "docs", "styling.md"), "utf8")).not.toContain("a floor to stand on rather than a taste");
});

/* ── and the client route the store speaks ──────────────────────────────── */

test("nothing about the design doc reaches the page tree", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();
  const call = (o: Record<string, unknown>) => handle(req(o), w.deps as never);

  const listed = value(await call({ kind: "page.list" })) as PageRef[];
  expect(listed.map((p) => p.id)).toEqual([ROOT_PAGE]);
  // The rail draws `pages/`. `design/` is not there, so nothing had to learn
  // about it — which is the entire argument for the placement.
  expect(code(await call({ kind: "page.read", page: "design" }))).toBe("not_found");

  w.db.close();
});

/* ── the format is one format ───────────────────────────────────────────── */

// A REGRESSION, and it was silent. "A block is markdown unless `<id>.html` sits
// beside it" was implemented more than once — in pages.ts for a page, and in
// design.ts for the design doc. When a new file form was added it reached
// exactly one of them, so a diagram in the design doc resolved to an EMPTY
// MARKDOWN BLOCK: no file missing, no error, no finding, just a blank where the
// diagram was.
//
// Both read through `drawSection` now — the type is IN the document rather than
// inferred from a directory listing, which is most of why the drift was possible
// at all. This test is what stops them coming apart again, and it asserts
// against the DESIGN DOC rather than a page, because the page path is the one
// that already worked.
test("the design doc resolves its sections through the same resolver a page does", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();

  const doc = docOnDisk(root);
  doc.contents = [
    ...doc.contents,
    // A FENCE IS ORDINARY MARKDOWN AND NEEDS NO MECHANISM. There is no diagram
    // type and no file kind for one: a fence is prose until a plugin this
    // workspace carries is named by its info string, and this vault carries
    // none by that name — so what is under test is that the section reads.
    { name: "shape", parts: { body: "```flow\nbrand --> voice\n```\n" } },
    // A section that names its OWN markup, and a slot inside it that names a
    // file of its own. Two readings of `data`, one resolver.
    { name: "both", data: "both.html", parts: { figure: { type: "html", data: "figure.html" } } },
  ];
  writeFileSync(join(root, "design", "content.yaml"), format(doc));
  writeFileSync(join(root, "design", "both.html"), '<section data-g-part="figure"></section>');
  writeFileSync(join(root, "design", "figure.html"), "<main>the program it grew into</main>");

  const page = await boot(root).design.read();

  const fenced = partAt(page, "shape", "body");
  // Markdown, raw, fence and all. The plugin draws it; nothing on the way here
  // interprets it.
  expect(fenced?.kind).toBe("markdown");
  expect(fenced && "md" in fenced ? fenced.md : "").toContain("brand --> voice");

  // The section's own markup was LOADED, so it is not a fallback.
  const both = page.sections.find((s) => s.name === "both");
  expect(both?.fallback).toBe(false);
  expect(both?.html).toContain('data-g-part="figure"');

  // And the html slot inside it, resolved by the same function pages.ts uses.
  const figure = partAt(page, "both", "figure");
  expect(figure).toMatchObject({ kind: "html", file: "figure.html" });
  expect(figure && "html" in figure ? figure.html : "").toContain("grew into");

  // The prose beside them is untouched — one resolver, every type.
  expect(page.sections.filter((s) => s.parts["body"]?.kind === "markdown").length).toBeGreaterThan(1);
  w.db.close();
});

test("an html slot naming a file that is not there is an empty part, not a missing one", async () => {
  const w = boot(root);
  await w.presets.seedIfEmpty();

  const doc = docOnDisk(root);
  doc.contents = [...doc.contents, { name: "gone", parts: { figure: { type: "html", data: "gone.html" } } }];
  writeFileSync(join(root, "design", "content.yaml"), format(doc));

  const page = await boot(root).design.read();
  // The entry is in the document and somebody can see it. A slot that quietly
  // disappeared would leave nothing to repair from.
  expect(partAt(page, "gone", "figure")).toMatchObject({ kind: "html", file: "gone.html", html: "" });

  // A SECTION whose named file is not there takes the shipped default for the
  // same reason: the slots still draw, so the words are still on screen and the
  // fault reads as a section that lost its layout rather than a page that lost a
  // section.
  const missing = docOnDisk(root);
  missing.contents = [...missing.contents, { name: "shell", data: "shell.html", parts: { body: "Still here.\n" } }];
  writeFileSync(join(root, "design", "content.yaml"), format(missing));
  const after = await boot(root).design.read();
  const shell = after.sections.find((s) => s.name === "shell");
  expect(shell?.fallback).toBe(true);
  expect(partAt(after, "shell", "body")).toMatchObject({ kind: "markdown", md: "Still here.\n" });

  w.db.close();
});
