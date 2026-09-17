// SPDX-License-Identifier: AGPL-3.0-only
// The API's own tests. `handle` is exported separately from `route` precisely so
// this file can exercise the whole surface with no server running — and the
// vault underneath it is real, because a route test against a fake vault only
// proves the switch statement compiles.
//
// Two things are faked. Tables, because server/domain/tables.ts owns every SQL
// string in the framework and is a sibling wave's file. And Vault, because it is
// implemented by the COMPOSITION ROOT — opening one rebuilds every other module
// in `deps` against a different folder, which is not something this layer can
// do or should know about. Faking both keeps a failure here a failure of the API
// layer; the real vault swap is exercised end to end in vault-open.test.ts.
//
// WHAT MOVED WITH THE FORMAT, on the wire. `sidecar.*` went when the sidecar did
// — there is nothing beside the file, because `content.yaml` carries the page's
// prose as well as its shape — and `doc.raw`, `doc.writeRaw` and
// `variables.patch` are what stand in its place. `content.write` and
// `content.order` are `section.write` and `section.order`: a page holds SECTIONS
// and a section holds SLOTS, so writing a paragraph names a page, a section AND
// a part. `page.setRender` went with the render layer, and `listing.*` with the
// marketplace. `page.move` answers the page's NEW id, because moving a page
// moves its directory and its id is where it sits.
//
// AND `variables` IS EXERCISED HERE FOR THE FIRST TIME. The kind was in
// `HostRequest`, in the guard's set and forwarded by the bridge, and had no case
// at the server at all — so the local-first join has never once worked and
// nothing said why. A wire kind with no test is a wire kind that is not there.

import { test, expect } from "bun:test";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { handle, route } from "../server/api/routes.ts";
import { makePresets, makeTheme } from "../server/workspace/presets.ts";
import { initVault, makeFiles } from "../server/platform/files.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { makeDesign } from "../server/domain/design.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { makeMirror } from "../server/domain/mirror.ts";
import { makePages, pageDir } from "../server/domain/pages.ts";
import { makeRuns } from "../server/domain/runs.ts";
import { makeRunFs } from "../server/platform/rundir.ts";
import { makeDb } from "../server/platform/db.ts";
import type { ProcessRunner, RunRow } from "../contracts/types.ts";
import { PROTOCOL } from "../contracts/wire.js";

import type { TableTree } from "../server/domain/tables.ts";
import { ROOT_PAGE, parentOf } from "../contracts/types.ts";
import type {
  ApiRequest, ApiResponse, Child, DirListing, Page, PageDoc, PageId, PageRef,
  Row, RowId, RowInput, RowQuery, Section, SqlParam, SqlResult, TableName, TableRef,
  TableSchema, Tables, TableView, Theme, Variables, Vault, VaultInfo,
} from "../contracts/types.ts";

/* ── the fakes ──────────────────────────────────────────────────────────── */

/** The vault, as this layer sees it: four questions it forwards and never
 *  answers. Which folder is open is workspace state that outlives every module
 *  beside it, so the route holds a reference and the root swaps what is behind
 *  it. */
function fakeVault(root: string, here: string): Vault {
  const info = (path: string): VaultInfo => ({ path, name: path.slice(path.lastIndexOf("/") + 1), seeded: true });
  let at = here;
  return {
    async info() {
      return info(at);
    },
    async browse(path?: string): Promise<DirListing> {
      return { at: path ?? root, up: null, dirs: [{ name: "vault", path: here, vault: true }] };
    },
    async open(path: string) {
      // The real one checks the disk; this one checks the only folder it knows
      // about, so the API layer's job — turning a closed error code into an
      // answer — is what is under test.
      if (path !== here) throw Object.assign(new Error("there is no folder there"), { code: "not_found" });
      at = path;
      return info(path);
    },
    async recent() {
      return [info(here)];
    },
  };
}

function fakeTables(): Tables & TableTree & { boom: boolean } {
  const schemas = new Map<TableName, TableSchema>();
  const rows = new Map<TableName, Row[]>();
  // Where each table sits in the tree. A table nobody placed is unfiled, which
  // is the state `create` leaves it in and a value rather than a gap.
  const parents = new Map<TableName, PageId | null>();
  let next = 1;
  const need = (name: TableName): Row[] => {
    const found = rows.get(name);
    if (found === undefined) throw Object.assign(new Error("no such table"), { code: "not_found" });
    return found;
  };

  const refs = (): TableRef[] =>
    [...schemas.values()].map((s) => ({
      name: s.name,
      kind: s.kind,
      rows: (rows.get(s.name) ?? []).length,
      parent: parents.get(s.name) ?? null,
    }));

  return {
    boom: false,
    // A closure, not a method: pages.ts receives this detached from the object
    // it came off, which is the whole reason its dependency is a function.
    list: refs,
    setParent(name: TableName, parent: PageId | null): void {
      parents.set(name, parent);
    },
    schema: (name) => schemas.get(name) ?? null,
    rows(name, q?: RowQuery): TableView {
      const all = need(name);
      const where = q?.where ?? {};
      const hit = all.filter((r) => Object.entries(where).every(([k, v]) => r.cells[k] === v));
      return { schema: schemas.get(name)!, rows: hit.slice(q?.offset ?? 0, (q?.offset ?? 0) + (q?.limit ?? hit.length)), total: hit.length };
    },
    insert(name, row: RowInput): RowId {
      const id = next++;
      need(name).push({ id, cells: { ...row } });
      return id;
    },
    update(name, id, patch) {
      const found = need(name).find((r) => r.id === id);
      if (found !== undefined) Object.assign(found.cells, patch);
    },
    remove(name, id) {
      const all = need(name);
      const at = all.findIndex((r) => r.id === id);
      if (at >= 0) all.splice(at, 1);
    },
    create(schema) {
      schemas.set(schema.name, schema);
      rows.set(schema.name, []);
    },
    alter(name, nextSchema) {
      schemas.delete(name);
      schemas.set(nextSchema.name, nextSchema);
      rows.set(nextSchema.name, rows.get(name) ?? []);
    },
    drop(name) {
      schemas.delete(name);
      rows.delete(name);
    },
    importCsv(name, csv) {
      const lines = csv.trim().split("\n").slice(1);
      for (const line of lines) this.insert(name, { name: line });
      return { added: lines.length };
    },
    sql(query: string, _params?: SqlParam[]): SqlResult {
      if (this.boom) throw new Error("syntax error near /Users/someone/vault");
      return { columns: ["n"], rows: [[query.length]], changes: 0 };
    },
  };
}

/* ── a temp vault and the furniture it gets at its root ─────────────────── */

/** What a vault gets at its ROOT, in the shape vault/ has: the guide,
 *  one skill, and the design doc — whose prose is INSIDE its document, in a
 *  section's slot, not in a `.md` beside it. Synthetic here because this is the
 *  API layer's test, and a failure in it has to be a failure of this layer
 *  rather than of the shipped copy. */
const ROOT_SEED: Record<string, string> = {
  "AGENTS.md": "# This folder is a Biom workspace\n\nRead `.agents/skills/`.\n",
  ".agents/skills/pages/SKILL.md": "# Pages\n\nA page is a directory.\n",
  "design/content.yaml":
    "name: Design\nplugin: doc\nvariables:\n  mood: quiet\ncontents:\n" +
    "  - name: brand\n    parts:\n      body: |\n        # Brand\n        One accent.\n",
};

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "biom-api-"));
  const vault = join(root, "vault");
  const seedRoot = join(root, "vault-seed");
  const skillDir = join(root, "skill");

  for (const [rel, text] of Object.entries(ROOT_SEED)) {
    await mkdir(join(seedRoot, dirname(rel)), { recursive: true });
    await writeFile(join(seedRoot, rel), text);
  }
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "check.ts"), "// the checker\n");

  await initVault(vault);
  const files = makeFiles(vault);
  const yaml = { parse, parseAny, format };
  const tables = fakeTables();
  // Tables sit in the tree beside pages, and pages.ts cannot reach tables.ts —
  // they are siblings. It is handed the registry as a list instead, and decides
  // for itself where an unfiled table sits.
  const pages = makePages(files, yaml, tables.list);
  // Rooted at `design/`, not at the vault. The design doc is ONE page sitting
  // beside `pages/`, and that placement is what keeps it out of the page tree
  // without a reserved id anywhere.
  const design = makeDesign(makeFiles(join(vault, "design")), yaml);
  const docs = makeDocs(files, yaml);
  const theme = makeTheme(files);
  // NO `seed:` AND NO `market:`. The catalogue went with the render layer it was
  // written against, and nothing ships a preset directory any more — `seed` is
  // optional precisely so a caller with none says so by omitting it.
  const presets = makePresets({
    pages, tables, files, yaml,
    vaultSeed: makeFiles(seedRoot),
    skill: makeFiles(skillDir),
  });
  const mirror = makeMirror(files, pages);
  // AUTOMATIONS AND RUNS, over a registry in memory and a runner that starts
  // nothing: what this layer is tested for is that every kind reaches the
  // module and every refusal comes back as a code and a sentence. The runner
  // reports one pid alive until the test says otherwise.
  const alive = new Set<number>([4242]);
  const runner: ProcessRunner = {
    start: () => ({ pid: 4242, pgid: 4242, done: new Promise(() => {}) }),
    end: async (pgid) => { alive.delete(pgid); },
    alive: (pid) => alive.has(pid),
  };
  const changes: string[] = [];
  const runs = makeRuns({
    db: makeDb(":memory:"),
    files,
    fs: makeRunFs(vault),
    yaml: { parseAny, formatAny },
    process: runner,
    dirOf: pageDir,
    refOf: async (id) => (await pages.list()).find((p) => p.id === id) ?? null,
    env: () => ({ PATH: "/usr/bin", HOME: "/home/x", KEY_ONE: "1", KEY_TWO: "2" }),
    templates: makeFiles(seedRoot),
    api: () => ({ url: "http://127.0.0.1:4400/v/x/api/call", token: null }),
    seededSkill: async (name) => name === "seeded",
    onChange: (what) => { changes.push(what); },
  });

  return {
    root,
    vault,
    tables,
    changes,
    alive,
    deps: {
      pages, design, docs, tables, presets, theme, mirror, runs,
      vault: fakeVault(root, vault),
      live: () => runs.live(),
      envNames: () => ["KEY_ONE", "KEY_TWO", "PATH"],
    },
    files,
    presets,
    async drop() { await rm(root, { recursive: true, force: true }); },
  };
}

let seq = 0;
const req = (o: Record<string, unknown>): ApiRequest => ({ id: `t${++seq}`, g: PROTOCOL, ...o }) as ApiRequest;

const value = (res: ApiResponse): unknown => {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.value;
};

/** The directory a page id names. `a/b/c` is `pages/a/children/b/children/c`,
 *  which is the whole of the identity rule read the other way round. */
const dirOf = (vault: string, id: PageId): string =>
  join(vault, "pages", id.split("/").join("/children/"));

/** A slot's resolved markdown, by section name and slot id. `parts` is keyed
 *  exactly as the document keyed it, so this is the read the runtime does. */
const slot = (page: Page, section: string, part: string): string => {
  const found = page.sections.find((s) => s.name === section)?.parts[part];
  return found !== undefined && found.kind === "markdown" ? found.md : "";
};

/* ── the tests ──────────────────────────────────────────────────────────── */

test("seedIfEmpty leaves the workspace EMPTY and lays out the furniture", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();

    const first = await w.deps.pages.list();
    // The root page and nothing else. A new vault has no content: seeding
    // somebody's folder with invented pages was noise they had to delete before
    // they could start. The root says how to fill it, and filling it is asking
    // an agent.
    expect(first.map((p) => p.id)).toEqual([ROOT_PAGE]);
    // Its id has no `/` in it, which is the whole of "it is the top".
    expect(parentOf(first[0]!.id)).toBeNull();
    expect(w.tables.list()).toEqual([]);
    expect(await w.deps.pages.children(ROOT_PAGE)).toEqual([]);

    // The root opens with words on it and nothing else: the one step to take
    // and what may be asked for. It used to open empty, and a white canvas was
    // the first thing a stranger saw. It is a page that DRAWS ITSELF — no
    // sections, its words in its own top-level slots — and its name is the
    // user's to change from here on; its id is not. It names no folder: the
    // page asks for that where it is drawn, so it survives the folder moving.
    const rootPage = await w.deps.pages.read(ROOT_PAGE);
    expect(rootPage?.name).toBe("Home");
    expect(rootPage?.sections).toEqual([]);
    const said = JSON.stringify(rootPage?.input);
    expect(said).toContain("Point your agent at this folder");
    expect(said).not.toContain(w.vault);

    // THE FURNITURE, which is not content. The guide and the skills are what
    // make "point an agent at the folder and it just works" true — until they
    // landed in the vault, the format guide lived in the framework repo and the
    // agent working in somebody else's folder never saw it.
    expect(await readFile(join(w.vault, "AGENTS.md"), "utf8")).toContain(".agents/skills/");
    expect(existsSync(join(w.vault, ".agents", "skills", "pages", "SKILL.md"))).toBe(true);
    // A plain `.agents/skills/`, so the vault reads the same to Cursor and Codex.
    expect(existsSync(join(w.vault, ".claude"))).toBe(false);
    expect(existsSync(join(w.vault, "CLAUDE.md"))).toBe(false);
    expect(await readFile(join(w.vault, ".agents", "skills", "check.ts"), "utf8")).toContain("the checker");

    // The design doc, at the vault root beside `pages/` rather than inside it —
    // and its prose is inside its own document, in a section's slot, with no
    // `.md` beside it.
    const design = await readFile(join(w.vault, "design", "content.yaml"), "utf8");
    expect(design).toContain("mood: quiet");
    expect(design).toContain("# Brand");
    expect(existsSync(join(w.vault, "design", "brand.md"))).toBe(false);
    expect(existsSync(join(w.vault, "pages", "design"))).toBe(false);

    // Second run. Every write is additive file by file, so a vault made before
    // the design doc existed gains it and anything edited stays edited — which
    // is why this is no longer gated on "has this workspace been used".
    await writeFile(join(w.vault, "design", "content.yaml"), "name: Ours\nplugin: doc\ncontents: []\n");
    await w.presets.seedIfEmpty();
    expect((await w.deps.pages.list()).map((p) => p.id)).toEqual([ROOT_PAGE]);
    expect(await readFile(join(w.vault, "design", "content.yaml"), "utf8")).toContain("name: Ours");
  } finally {
    await w.drop();
  }
});

test("every ApiRequest kind round-trips", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);

    // A new vault is empty, so the workspace this exercises is one somebody
    // made rather than one that came with fixtures — which is the ordinary case
    // now and no longer a special setup.
    const start = value(await call({ kind: "page.create", init: { name: "Start here" } })) as PageRef;
    expect(start.id).toBe(`${ROOT_PAGE}/Start-here`);
    w.tables.create({ name: "jobs", kind: "basic", columns: [{ name: "name", type: "text" }] });
    for (let n = 0; n < 12; n++) w.tables.insert("jobs", { name: `Job ${n}` });
    w.tables.setParent("jobs", ROOT_PAGE);

    const listed = value(await call({ kind: "page.list" })) as { id: string; name: string }[];
    expect(listed.map((p) => p.id).sort()).toEqual([ROOT_PAGE, start.id].sort());

    // ── what an artifact may say ──────────────────────────────────────────
    // A doc read by an artifact is its prose — every markdown slot, in section
    // order — and it comes back RAW, because interpolation happens where the
    // part is drawn.
    expect(String(value(await call({ kind: "doc.get", page: start.id })))).toContain("# Start here");
    expect((value(await call({ kind: "doc.list" })) as unknown[]).length).toBe(2);

    // Layer one over the wire: pages and tables in one list, each tagged for
    // what it is, so an artifact drawing its own children reads this and
    // nothing else.
    const kids = value(await call({ kind: "children", page: ROOT_PAGE })) as Child[];
    expect(kids.filter((c) => c.kind === "table").map((c) => c.id)).toEqual(["jobs"]);
    expect(kids.filter((c) => c.kind === "page").map((c) => c.name)).toEqual(["Start here"]);
    // A page with nothing under it holds nothing, and says so rather than failing.
    expect(value(await call({ kind: "children", page: start.id }))).toEqual([]);

    const view = value(await call({ kind: "table.get", name: "jobs" })) as TableView;
    expect(view.total).toBe(12);
    expect((value(await call({ kind: "table.schema", name: "jobs" })) as TableSchema).name).toBe("jobs");
    expect((value(await call({ kind: "table.list" })) as TableRef[])[0]?.name).toBe("jobs");

    const rowId = value(await call({ kind: "row.insert", name: "jobs", row: { name: "Ashgrove III" } })) as number;
    expect(typeof rowId).toBe("number");
    expect(value(await call({ kind: "row.update", name: "jobs", row: rowId, patch: { name: "Ashgrove IV" } }))).toBe(null);
    expect(value(await call({ kind: "row.remove", name: "jobs", row: rowId }))).toBe(null);

    expect((value(await call({ kind: "sql", query: "SELECT 1" })) as SqlResult).columns).toEqual(["n"]);
    expect((value(await call({ kind: "theme.get" })) as Theme).palette.name).toBe("Biom");

    // ── what only the workspace UI may say ────────────────────────────────
    expect((value(await call({ kind: "page.read", page: start.id })) as Page).id).toBe(start.id);

    const made = value(await call({ kind: "page.create", init: { name: "Site intake" } })) as PageRef;
    // A SECTION'S OWN MARKUP, which is what `data` names. A section is a div: it
    // owns its layout and declares its own slots, so the file is the page's and
    // not a render's.
    expect(await call({
      kind: "page.writeFile", page: made.id, file: "calc.html",
      text: '<div class="g-section"><div data-g-part="figure"></div></div>\n',
    })).toMatchObject({ ok: true });

    // THE DOCUMENT, RAW. It matters more than it did: the prose is in this file
    // now, so this is the only way back to a page whose one bad character took
    // its words with it.
    const raw = String(value(await call({ kind: "doc.raw", page: made.id })));
    expect(raw).toContain("name: Site intake");
    expect(raw).toContain("contents:");

    // And written back, whole. The user's own bytes, checked before the write.
    // NO `kind:`, NO `render:`, NO `order:` — `contents` is a list of SECTIONS
    // and the array IS the order.
    const rewritten =
      "name: Site intake\nplugin: doc\ncontents:\n" +
      "  - name: title\n    parts:\n      body: |\n        # Site intake\n" +
      "  - name: calc\n    data: calc.html\n    parts:\n      figure: |\n        Four questions.\n";
    const back = value(await call({ kind: "doc.writeRaw", page: made.id, text: rewritten })) as PageDoc;
    expect(back.contents.map((c) => c.name)).toEqual(["title", "calc"]);
    expect(await readFile(join(dirOf(w.vault, made.id), "content.yaml"), "utf8")).toBe(rewritten);

    // A section that names a file draws with it; one that names none takes the
    // shipped default, and `fallback` is what says which happened.
    const drawn = value(await call({ kind: "page.read", page: made.id })) as Page;
    expect(drawn.sections.map((s) => [s.name, s.fallback])).toEqual([["title", true], ["calc", false]]);
    expect(drawn.sections.find((s) => s.name === "calc")?.html).toContain('data-g-part="figure"');

    // VARIABLES, INTO ONE SCOPE. `section` null is the page's own; a name is
    // that section's, which is where a slot writes.
    const page = value(await call({ kind: "variables.patch", page: made.id, section: null, patch: { rate: 62 } })) as PageDoc;
    expect(page.variables["rate"]).toBe(62);
    const scoped = value(await call({
      kind: "variables.patch", page: made.id, section: "calc", patch: { title: "What a job costs" },
    })) as PageDoc;
    expect(scoped.contents.find((c) => c.name === "calc")?.variables?.["title"]).toBe("What a job costs");
    // THE NEAREST ONE WINS, so a scoped write must not land on the page: a value
    // one scope out is in scope for every other section there is.
    expect(Object.hasOwn(scoped.variables, "title")).toBe(false);

    // ANOTHER PAGE'S VARIABLES, which is the local-first join and the kind that
    // had no case here at all until this rewrite. It answers the page's OWN
    // variables and nothing else: a section's are not folded in, or a caller
    // reading across a page boundary would get a different answer depending on
    // which section happened to declare a name.
    const joined = value(await call({ kind: "variables", page: made.id })) as Variables;
    expect(joined).toEqual({ rate: 62 });

    // ONE SLOT'S TEXT, which is the prose path and the exit condition of the
    // whole framework: the words are inside the document now, so this is the only
    // kind that can put a typed paragraph back on disk. It names a page, a
    // section AND a part, because a slot's id is its key in `parts`.
    expect(value(await call({
      kind: "section.write", page: made.id, section: "title", part: "body",
      data: "# Site intake\n\nFour questions, and the rate is {{rate}}.\n",
    }))).toBe(null);
    const typed = value(await call({ kind: "page.read", page: made.id })) as Page;
    // RAW, braces and all. Interpolation happens where the part is drawn.
    expect(slot(typed, "title", "body")).toContain("{{rate}}");
    // And the page's value is what it resolves against, gathered nearest-first.
    expect(typed.sections.find((s) => s.name === "title")?.vars).toMatchObject({ rate: 62 });

    // THE ORDER, AND WHAT IS IN IT: adding, reordering and removing in one kind,
    // because `contents` IS the order.
    const ordered = value(await call({
      kind: "section.order", page: made.id, sections: [
        { name: "calc", data: "calc.html" },
        { name: "outro", parts: { body: "Ask for a quote.\n" } },
      ],
    })) as Section[];
    expect(ordered.map((c) => c.name)).toEqual(["calc", "outro"]);
    // The entry that stayed kept its own everything — its markup, its slots and
    // the variables a patch wrote into it two calls ago — because a name already
    // in the document keeps its entry and takes only its new position. The
    // caller's copy said nothing about `figure` and it is still there.
    expect(ordered.find((c) => c.name === "calc")?.variables?.["title"]).toBe("What a job costs");
    expect(Object.keys(ordered.find((c) => c.name === "calc")?.parts ?? {})).toEqual(["figure"]);
    // And the one that was absent is gone, its words with it.
    const after = value(await call({ kind: "page.read", page: made.id })) as Page;
    expect(after.sections.map((s) => s.name)).toEqual(["calc", "outro"]);
    expect(slot(after, "outro", "body")).toBe("Ask for a quote.\n");

    expect(await call({ kind: "page.remove", page: made.id })).toMatchObject({ ok: true });

    const schema: TableSchema = { name: "intake", kind: "basic", columns: [{ name: "name", type: "text" }] };
    expect(await call({ kind: "table.create", schema })).toMatchObject({ ok: true });
    expect(await call({ kind: "table.alter", name: "intake", schema })).toMatchObject({ ok: true });
    expect(await call({ kind: "table.setParent", name: "intake", parent: start.id })).toMatchObject({ ok: true });
    expect(value(await call({ kind: "table.importCsv", name: "intake", csv: "name\nFenton\n" }))).toEqual({ added: 1 });
    expect(await call({ kind: "table.remove", name: "intake" })).toMatchObject({ ok: true });

    // THE THEME IS A PALETTE AND A SET OF TYPE ROLES, AND NOTHING ELSE. The
    // background went with the render layer, and so did the workspace `render`.
    const repainted = value(await call({
      kind: "theme.set",
      theme: { palette: { name: "Nightshift", colors: { ink: "#101010" }, extra: [] } },
    })) as Theme;
    expect(repainted.palette.name).toBe("Nightshift");
    expect((value(await call({ kind: "theme.get" })) as Theme).palette.name).toBe("Nightshift");
    // A partial set replaces the key it names and leaves the rest, so the type
    // roles survive a repaint.
    expect((value(await call({ kind: "theme.get" })) as Theme).fonts.roles.sheet).toBe("C059");

    // ── the design doc, which is one page at `design/` ────────────────────
    // Its own kinds rather than `page.*` with a reserved id, because the doc
    // lives beside `pages/` and a user may perfectly well keep a page of their
    // own called `design`. It answers the same `Page` shape `page.read` does,
    // so the client draws it with the same view and needs no second path.
    const doc = value(await call({ kind: "design.read" })) as Page;
    expect(doc.id).toBe("design");
    expect(doc.sections.map((s) => s.name)).toEqual(["brand"]);
    expect(doc.variables["mood"]).toBe("quiet");

    const loud = value(await call({ kind: "design.patch", section: null, patch: { mood: "loud" } })) as PageDoc;
    expect(loud.variables["mood"]).toBe("loud");
    expect(await call({ kind: "design.writeFile", file: "mark.html", text: "<main>Two accents.</main>\n" }))
      .toMatchObject({ ok: true });
    const moved = value(await call({ kind: "design.read" })) as Page;
    expect(moved.variables["mood"]).toBe("loud");
    // Resolved by the SAME resolver a page's section goes through, which is what
    // stops the design doc drifting from `pages/`.
    expect(slot(moved, "brand", "body")).toBe("# Brand\nOne accent.\n");

    // ── the vault: which folder this workspace IS ─────────────────────────
    // Workspace-level, so an artifact cannot say any of them — `HostRequest`
    // does not carry them and the bridge accepts only a HostRequest. Picking
    // the folder is how you get started, so it travels over the same route as
    // everything else rather than over a second one.
    expect((value(await call({ kind: "vault.info" })) as VaultInfo).path).toBe(w.vault);
    // No path means "wherever is sensible", and where that is belongs to the
    // root: it is the module that knows which vault is open.
    expect((value(await call({ kind: "vault.browse" })) as DirListing).dirs[0]?.vault).toBe(true);
    expect((value(await call({ kind: "vault.browse", path: w.root })) as DirListing).at).toBe(w.root);
    expect((value(await call({ kind: "vault.open", path: w.vault })) as VaultInfo).seeded).toBe(true);
    expect((value(await call({ kind: "vault.recent" })) as VaultInfo[]).map((v) => v.path)).toEqual([w.vault]);
  } finally {
    await w.drop();
  }
});

// MOVING A PAGE MOVES ITS DIRECTORY, so its id changes and so does every id
// beneath it. Nothing forwards: the answer is the NEW id and a stale one gets
// `not_found` rather than somebody else's page.
test("page.move answers the new id, renames the subtree, and nothing forwards", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);

    const clients = value(await call({ kind: "page.create", init: { name: "Clients" } })) as PageRef;
    const notes = value(await call({ kind: "page.create", init: { name: "Notes" } })) as PageRef;
    const ash = value(await call({
      kind: "page.create", init: { name: "Ashgrove", parent: notes.id },
    })) as PageRef;
    expect(notes.id).toBe(`${ROOT_PAGE}/Notes`);
    expect(ash.id).toBe(`${ROOT_PAGE}/Notes/Ashgrove`);

    // A table parented under the page about to move, and one under the child.
    w.tables.create({ name: "jobs", kind: "basic", columns: [{ name: "name", type: "text" }] });
    w.tables.create({ name: "visits", kind: "basic", columns: [{ name: "name", type: "text" }] });
    w.tables.create({ name: "loose", kind: "basic", columns: [{ name: "name", type: "text" }] });
    await call({ kind: "table.setParent", name: "jobs", parent: notes.id });
    await call({ kind: "table.setParent", name: "visits", parent: ash.id });
    await call({ kind: "table.setParent", name: "loose", parent: clients.id });

    const to = value(await call({ kind: "page.move", page: notes.id, parent: clients.id })) as PageId;
    // THE ANSWER IS THE NEW ID, because the caller is holding one that has just
    // stopped existing.
    expect(to).toBe(`${clients.id}/Notes`);

    // The directory really moved, and the child moved inside it.
    expect(existsSync(join(dirOf(w.vault, to), "content.yaml"))).toBe(true);
    expect(existsSync(join(dirOf(w.vault, `${to}/Ashgrove`), "content.yaml"))).toBe(true);
    expect(existsSync(dirOf(w.vault, notes.id))).toBe(false);

    // Every id beneath it changed with it, and the listing says the new ones.
    const ids = (value(await call({ kind: "page.list" })) as PageRef[]).map((p) => p.id);
    expect(ids).toContain(to);
    expect(ids).toContain(`${to}/Ashgrove`);
    expect(ids).not.toContain(notes.id);
    expect(ids).not.toContain(ash.id);

    // NOTHING FORWARDS. A stale id is a visible failure rather than a page
    // quietly showing somebody else's content.
    expect((await call({ kind: "page.read", page: notes.id })).ok).toBe(false);
    expect((await call({ kind: "page.read", page: ash.id })).ok).toBe(false);
    expect((value(await call({ kind: "page.read", page: to })) as Page).name).toBe("Notes");

    // AND THE TABLES CAME WITH IT. A table has no directory, so its parent is
    // registry state and the move would otherwise leave it naming an id that
    // stopped existing — listed nowhere, while still claiming a parent.
    const parents = Object.fromEntries(w.tables.list().map((t) => [t.name, t.parent]));
    expect(parents["jobs"]).toBe(to);
    expect(parents["visits"]).toBe(`${to}/Ashgrove`);
    // A table somewhere else is untouched: it is a prefix rename, never a sweep.
    expect(parents["loose"]).toBe(clients.id);
    // And the tree agrees, which is the thing the user actually sees.
    const held = (value(await call({ kind: "children", page: to })) as Child[]).filter((c) => c.kind === "table");
    expect(held.map((c) => c.id)).toEqual(["jobs"]);

    // The refusals. Into itself, into its own descendant, onto a name already
    // taken, and the root, which has nowhere to go.
    expect((await call({ kind: "page.move", page: to, parent: to })).ok).toBe(false);
    expect((await call({ kind: "page.move", page: to, parent: `${to}/Ashgrove` })).ok).toBe(false);
    expect((await call({ kind: "page.move", page: ROOT_PAGE, parent: clients.id })).ok).toBe(false);
    const gone = await call({ kind: "page.move", page: `${ROOT_PAGE}/nothing-here`, parent: clients.id });
    expect(gone.ok).toBe(false);
    if (!gone.ok) {
      expect(gone.error.code).toBe("not_found");
      // A message is a leak channel: no path, ever.
      expect(gone.error.message).not.toContain(w.vault);
    }

    // Moving a page onto the parent it already has is a no-op that still answers
    // the id, so a caller can apply the answer unconditionally.
    expect(value(await call({ kind: "page.move", page: to, parent: clients.id }))).toBe(to);
  } finally {
    await w.drop();
  }
});

test("section.remove takes the entry, its variables and its file, against a real directory", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);

    const notes = value(await call({ kind: "page.create", init: { name: "Team notes" } })) as PageRef;
    // Two files: the section's own markup, and the one an `html` slot inside a
    // different section names. Both belong to the section that named them.
    await call({ kind: "page.writeFile", page: notes.id, file: "calc.html", text: '<div data-g-part="sum"></div>' });
    await call({ kind: "page.writeFile", page: notes.id, file: "chart.svg", text: "<svg></svg>" });
    await call({
      kind: "doc.writeRaw",
      page: notes.id,
      text:
        "name: Team notes\nplugin: doc\ncontents:\n" +
        "  - name: title\n    parts:\n      body: |\n        # Team notes\n" +
        "  - name: calc\n    data: calc.html\n    parts:\n      sum:\n        type: html\n        data: chart.svg\n" +
        "    variables:\n      heading: Quote\n" +
        "  - name: note\n    parts:\n      body: |\n        the rates, in prose\n    variables:\n      label: Rates\n",
    });

    // One request, and it answers with what is left.
    expect(value(await call({ kind: "section.remove", page: notes.id, section: "calc" })))
      .toEqual(["title", "note"]);

    // The entry, its variables and EVERY file it named — its own markup and the
    // file of the `html` slot inside it. Half of it done is an empty section or
    // an invisible file, and the variables went with the entry because they are
    // ON it now rather than beside it under a dotted key.
    const dir = dirOf(w.vault, notes.id);
    expect(existsSync(join(dir, "calc.html"))).toBe(false);
    expect(existsSync(join(dir, "chart.svg"))).toBe(false);
    const yaml = await readFile(join(dir, "content.yaml"), "utf8");
    expect(yaml).not.toContain("calc");
    expect(yaml).not.toContain("Quote");
    // The neighbour is untouched, its own words and its own variables and all.
    expect(yaml).toContain("the rates, in prose");
    expect(yaml).toContain("label: Rates");

    // AND IT SURVIVES A FULL REBUILD from the same directory: a second stack
    // over the same folder is what the next process is, and the vault is the
    // only state there is.
    const again = makePages(makeFiles(w.vault), { parse, parseAny, format }, w.tables.list);
    const page = (await again.read(notes.id))!;
    expect(page.sections.map((s) => s.name)).toEqual(["title", "note"]);
    expect(page.sections.map((s) => Object.keys(s.parts))).toEqual([["body"], ["body"]]);
    // The variables in scope for a section are the page's, then its own over the
    // top — nearest first, which is what `{{label}}` resolves against.
    expect(page.sections.find((s) => s.name === "note")?.vars).toMatchObject({ label: "Rates" });

    // Removing the last section leaves a valid empty page rather than a broken
    // one: it lists, it opens, and a new section can be written into it.
    expect(value(await call({ kind: "section.remove", page: notes.id, section: "title" }))).toEqual(["note"]);
    expect(value(await call({ kind: "section.remove", page: notes.id, section: "note" }))).toEqual([]);
    const empty = value(await call({ kind: "page.read", page: notes.id })) as Page;
    expect(empty.name).toBe("Team notes");
    expect(empty.sections).toEqual([]);
    expect(((value(await call({ kind: "page.list" })) as PageRef[])).map((p) => p.id)).toContain(notes.id);
  } finally {
    await w.drop();
  }
});

test("a child key is refused with the sentence that says what does remove it, and nothing is written", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);

    const clients = value(await call({ kind: "page.create", init: { name: "Clients" } })) as PageRef;
    const ash = value(await call({
      kind: "page.create", init: { name: "Ashgrove", parent: clients.id },
    })) as PageRef;
    await call({ kind: "page.read", page: clients.id }); // reconciles the child into `contents`
    const yaml = join(dirOf(w.vault, clients.id), "content.yaml");
    const before = await readFile(yaml, "utf8");
    // A CHILD KEY IS ONE SEGMENT, never a path: a page's contents only ever name
    // its DIRECT children, which is what keeps the key a legal filename.
    expect(before).toContain("@page-Ashgrove");
    expect(before).not.toContain(`@page-${ash.id}`);

    // The entry is reconciled from what the page holds, so removing it would
    // only make it reappend at the bottom on the next read. The refusal has to
    // say what actually removes it, or the user reads the button as broken.
    const res = await call({ kind: "section.remove", page: clients.id, section: "@page-Ashgrove" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("bad_request");
      expect(res.error.message).toContain("child");
      expect(res.error.message).toContain(".html");
      // A message is a leak channel: no path, ever.
      expect(res.error.message).not.toContain(w.vault);
    }
    expect(await readFile(yaml, "utf8")).toBe(before);
    expect((value(await call({ kind: "page.read", page: clients.id })) as Page).sections.map((s) => s.name))
      .toEqual(["title", "@page-Ashgrove"]);

    // A page nobody made.
    const gone = await call({ kind: "section.remove", page: `${ROOT_PAGE}/nothing-here`, section: "title" });
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe("not_found");

    // A string that could not be a section name at all is refused as one rather
    // than reaching the document to find out.
    const nonsense = await call({ kind: "section.remove", page: clients.id, section: "Not A Name" });
    expect(nonsense.ok).toBe(false);
    if (!nonsense.ok) expect(nonsense.error.code).toBe("bad_request");

    // A section that was never there is nothing to do rather than a failure.
    expect(value(await call({ kind: "section.remove", page: clients.id, section: "nowhere" })))
      .toEqual(["title", "@page-Ashgrove"]);
  } finally {
    await w.drop();
  }
});

// THE TWO WRITES THAT PUT A PAGE'S OWN SHAPE AND WORDS BACK, refused where they
// must be. Both are in the MIDDLE RING — `RuntimeRequest` and deliberately not
// `HostRequest` — so the bridge cannot carry either: a section drawn on a page
// must not be able to rewrite its neighbours or restructure the page it is
// decorating. Only the runtime that drew the page can.
test("section.write and section.order refuse in the domain's own sentence, and write nothing", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);

    const rates = value(await call({ kind: "page.create", init: { name: "Rates" } })) as PageRef;
    await call({ kind: "page.writeFile", page: rates.id, file: "calc.html", text: '<div data-g-part="sum"></div>' });
    await call({
      kind: "doc.writeRaw", page: rates.id,
      text: "name: Rates\nplugin: doc\ncontents:\n" +
        "  - name: intro\n    parts:\n      body: |\n        The base rate is {{rate}}.\n" +
        "  - name: calc\n    data: calc.html\n    parts:\n      sum:\n        type: table\n        data: jobs\n",
    });
    const yaml = join(dirOf(w.vault, rates.id), "content.yaml");
    const before = await readFile(yaml, "utf8");

    // ONLY A MARKDOWN SLOT HOLDS ITS OWN WORDS. `data` means something different
    // for every other type — a filename, a table, a child's segment — so writing
    // prose into one would destroy the pointer rather than edit the words.
    const table = await call({ kind: "section.write", page: rates.id, section: "calc", part: "sum", data: "# Words" });
    expect(table.ok).toBe(false);
    if (!table.ok) {
      expect(table.error.code).toBe("bad_request");
      expect(table.error.message).toContain("markdown");
      // A message is a leak channel: no path, ever.
      expect(table.error.message).not.toContain(w.vault);
    }

    // A section nobody has, a slot nobody declared, and a page nobody made —
    // three different sentences, which is the whole reason the route passes the
    // domain's own through instead of flattening them.
    const noSection = await call({ kind: "section.write", page: rates.id, section: "nowhere", part: "body", data: "x" });
    expect(noSection.ok).toBe(false);
    if (!noSection.ok) expect([noSection.error.code, noSection.error.message]).toEqual(["not_found", "no such section"]);
    const noSlot = await call({ kind: "section.write", page: rates.id, section: "intro", part: "nowhere", data: "x" });
    expect(noSlot.ok).toBe(false);
    if (!noSlot.ok) expect([noSlot.error.code, noSlot.error.message]).toEqual(["not_found", "no such slot"]);
    const noPage = await call({ kind: "section.write", page: `${ROOT_PAGE}/nothing-here`, section: "intro", part: "body", data: "x" });
    expect(noPage.ok).toBe(false);
    if (!noPage.ok) expect([noPage.error.code, noPage.error.message]).toEqual(["not_found", "no such page"]);

    // A CHILD'S SECTION IS PLACED BY THE PAGE HOLDING IT, so a caller cannot
    // write one into the list — the same rule `section.remove` states from the
    // other end, and the same reason: it is reconciled rather than written.
    const invented = await call({
      kind: "section.order", page: rates.id,
      sections: [{ name: "intro" }, { name: "@page-ghost", parts: { body: { type: "child", data: "ghost" } } }],
    });
    expect(invented.ok).toBe(false);
    if (!invented.ok) {
      expect(invented.error.code).toBe("bad_request");
      expect(invented.error.message).toContain("child");
    }

    // Two sections cannot share a name: a slot write would have two places to
    // land and the reader no way to say which.
    const twice = await call({
      kind: "section.order", page: rates.id,
      sections: [{ name: "intro" }, { name: "intro" }],
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe("bad_request");

    // NOTHING WAS WRITTEN by any of them. A refusal that half-writes is worse
    // than none, and this document holds the page's words as well as its shape.
    expect(await readFile(yaml, "utf8")).toBe(before);
  } finally {
    await w.drop();
  }
});

// ANOTHER PAGE'S VARIABLES, and the first test this kind has ever had. It was in
// `HostRequest`, in the guard's set and forwarded by the bridge, with no case at
// the server — so the join fell through to `unknown_kind` and never once worked.
// Adding a capability is one line in the type, one in the guard, one case in the
// bridge AND ONE CASE HERE; a test is what makes the fourth one visible.
test("variables answers another page's own values, and is refused unaddressed", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);

    const rates = value(await call({ kind: "page.create", init: { name: "Rates" } })) as PageRef;
    await call({
      kind: "doc.writeRaw", page: rates.id,
      text:
        "name: Rates\nvariables:\n  rate: 62\n  currency: GBP\n  regions:\n    - north\n    - south\ncontents:\n" +
        "  - name: intro\n    variables:\n      heading: What it costs\n" +
        "    parts:\n      body: |\n        The base rate is {{rate}}.\n",
    });

    // THE PAGE'S OWN VALUES, and only those. A section's are the nearer scope
    // and belong to the section — folding them in would make the answer depend
    // on which section happened to declare a name, and a page reading across a
    // boundary would see something the page itself does not say.
    const vars = value(await call({ kind: "variables", page: rates.id })) as Variables;
    expect(vars).toEqual({ rate: 62, currency: "GBP", regions: ["north", "south"] });
    expect(Object.hasOwn(vars, "heading")).toBe(false);

    // A page with none says so with an empty map rather than failing: no values
    // is a state, not an error.
    expect(value(await call({ kind: "variables", page: ROOT_PAGE }))).toEqual({});

    // UNADDRESSED IT IS REFUSED, for the same reason `data.get` and `children`
    // are: an artifact omits `page` to mean the one it is mounted on, a mount is
    // a client-side fact, and an HTTP request carries none for the server to
    // resolve it against. Guessing would hand back somebody else's page.
    for (const bad of [{}, { page: "" }]) {
      const said = await call({ kind: "variables", ...bad });
      expect(said.ok).toBe(false);
      if (!said.ok) {
        expect(said.error.code).toBe("bad_request");
        expect(said.error.message).toContain("mount");
      }
    }

    // A page that is not there, and an id that could never be a page path.
    // Neither leaks what was looked for.
    for (const page of [`${ROOT_PAGE}/nothing-here`, "../../etc"]) {
      const said = await call({ kind: "variables", page });
      expect(said.ok).toBe(false);
      if (!said.ok) {
        expect(said.error.message).toBe("no such page");
        expect(said.error.message).not.toContain(w.vault);
      }
    }

    // A page whose document will not parse has no variables to answer with, and
    // says so rather than handing back an empty map that reads as "none set".
    await writeFile(join(dirOf(w.vault, rates.id), "content.yaml"), "name: Rates\n\tvariables: [oh dear\n");
    const broken = await call({ kind: "variables", page: rates.id });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error.message).not.toContain(w.vault);
  } finally {
    await w.drop();
  }
});

// THE RAW FALLBACK IS THE ONLY WAY BACK TO A PAGE'S WORDS. They used to live in
// `.md` files that survived a broken `content.yaml` untouched; now one bad
// character takes the prose with the shape, so the surface that repairs the file
// must not be able to corrupt it — which is why it validates before it writes,
// and then writes the user's own bytes rather than a reformat.
test("doc.raw and doc.writeRaw are the way back from a document that will not parse", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);

    const page = value(await call({ kind: "page.create", init: { name: "Rates" } })) as PageRef;
    const yaml = join(dirOf(w.vault, page.id), "content.yaml");
    const good =
      "name: Rates\nplugin: doc\nvariables:\n  rate: 62\ncontents:\n" +
      "  - name: intro\n    parts:\n      body: |\n        # Rendering rates\n        The base rate is {{rate}}.\n";
    await call({ kind: "doc.writeRaw", page: page.id, text: good });
    // BYTE FOR BYTE. They typed it, it parsed, it is theirs — and it holds their
    // prose now, so a reflow is not cosmetic.
    expect(await readFile(yaml, "utf8")).toBe(good);

    // THE SERVER HANDS BACK RAW TEXT WITH `{{}}` STILL IN IT. Resolving here
    // would round-trip `62` over the top of `{{rate}}` the first time somebody
    // edited the paragraph it sits in.
    const read = value(await call({ kind: "page.read", page: page.id })) as Page;
    expect(slot(read, "intro", "body")).toContain("{{rate}}");
    expect(read.sections[0]?.parts["body"]).toMatchObject({ vars: { rate: 62 } });

    // Somebody breaks it by hand, which is the state this pair exists for.
    await writeFile(yaml, "name: Rates\n\tcontents: [oh dear\n");
    // The page still LISTS and still OPENS, because one unreadable file must not
    // empty the rail.
    expect(((value(await call({ kind: "page.list" })) as PageRef[])).map((p) => p.id)).toContain(page.id);
    // And the raw text comes back, which is the only thing left that can repair
    // it — the words are in there.
    expect(String(value(await call({ kind: "doc.raw", page: page.id })))).toContain("oh dear");

    // A DOCUMENT WRITTEN FOR AN OLDER FORMAT IS REFUSED BY NAME, not dropped:
    // reading `order:` silently would lose the section order and the hierarchy
    // in the same breath, and there is no converter because the markup a section
    // draws with lived in the render layer rather than in the vault.
    for (const [text, code] of [
      ["name: Rates\n\tcontents: [oh dear\n", "flatness"],                     // will not parse
      ["name: Rates\nplugin: doc\nkind: doc\ncontents: []\n", "flatness"],                  // format 2
      ["name: Rates\nplugin: doc\nrender: null\ncontents: []\n", "flatness"],               // format 2
      ["name: Rates\norder: [intro]\n", "flatness"],                           // format 1
      ["name: Rates\nplugin: doc\nparent: home\ncontents: []\n", "flatness"],               // the hierarchy key
      // A section has no `type`: it is the only thing `contents` can hold.
      ["name: Rates\nplugin: doc\ncontents:\n  - name: a\n    type: markdown\n    data: x\n", "flatness"],
      // A slot's long spelling has no `name`: the key in `parts` is its id.
      ["name: Rates\nplugin: doc\ncontents:\n  - name: a\n    parts:\n      body:\n        name: b\n        type: markdown\n        data: x\n", "flatness"],
      // Two sections, one name. Refused by the CODEC rather than by `checkDoc`
      // behind it — the door is where a document that is not a page stops, and
      // the strict re-check guarding this fallback never has to see it.
      ["name: Rates\nplugin: doc\ncontents:\n  - name: a\n    parts:\n      body: x\n  - name: a\n    parts:\n      body: y\n", "flatness"],
      // A part type nothing has.
      ["name: Rates\nplugin: doc\ncontents:\n  - name: a\n    parts:\n      body:\n        type: sonnet\n        data: x\n", "flatness"],
    ] as const) {
      const said = await call({ kind: "doc.writeRaw", page: page.id, text });
      expect([text.slice(0, 24), said.ok]).toEqual([text.slice(0, 24), false]);
      if (!said.ok) {
        expect([text.slice(0, 24), said.error.code]).toEqual([text.slice(0, 24), code]);
        expect(said.error.message).not.toContain(w.vault);
      }
    }
    // Nothing landed: the broken file is still exactly the broken file.
    expect(await readFile(yaml, "utf8")).toBe("name: Rates\n\tcontents: [oh dear\n");

    // And the repair goes through, which is the whole point of the surface.
    expect((value(await call({ kind: "doc.writeRaw", page: page.id, text: good })) as PageDoc).name).toBe("Rates");
    expect((value(await call({ kind: "page.read", page: page.id })) as Page).sections.length).toBe(1);

    // A page nobody made.
    const gone = await call({ kind: "doc.raw", page: `${ROOT_PAGE}/nothing-here` });
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe("not_found");
  } finally {
    await w.drop();
  }
});

test("an unknown kind gets the closed error code, not an exception", async () => {
  const w = await workspace();
  try {
    const res = await handle(req({ kind: "page.explode" }), w.deps);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("unknown_kind");
      expect(res.error.retryable).toBe(false);
    }
    // And every kind the format and the deletions took away is unknown rather
    // than half wired, so a client that still speaks one is told so:
    //   sidecar.*    there is nothing beside the file
    //   content.*    a page holds sections, and a section holds slots
    //   page.setRender  the render layer is gone
    //   listing.*    the marketplace is gone, and there is no converter for it
    for (const kind of [
      "sidecar.raw", "sidecar.patch", "sidecar.writeRaw",
      "content.write", "content.order", "content.remove",
      "page.setRender",
      "listing.list", "listing.read", "listing.install",
    ]) {
      const said = await handle(req({ kind, page: ROOT_PAGE, patch: {}, text: "", listing: "tally" }), w.deps);
      expect([kind, said.ok]).toEqual([kind, false]);
      if (!said.ok) expect([kind, said.error.code]).toEqual([kind, "unknown_kind"]);
    }
  } finally {
    await w.drop();
  }
});

test("a malformed envelope is refused before anything is dispatched", async () => {
  const w = await workspace();
  const code = async (o: unknown) => {
    const res = await handle(o as ApiRequest, w.deps);
    return res.ok ? "ok" : res.error.code;
  };
  try {
    expect(await code({ kind: "page.list" })).toBe("bad_request");                    // no id
    expect(await code({ id: "", g: PROTOCOL, kind: "page.list" })).toBe("bad_request");
    expect(await code({ id: "a", g: 99, kind: "page.list" })).toBe("bad_request");     // unknown major
    expect(await code({ id: "a", g: PROTOCOL })).toBe("bad_request");                  // no kind
    expect(await code(null)).toBe("bad_request");
    expect(await code("page.list")).toBe("bad_request");
  } finally {
    await w.drop();
  }
});

test("failures come back as codes from the enumeration, carrying no path", async () => {
  const w = await workspace();
  try {
    await w.presets.seedIfEmpty();
    const err = async (o: Record<string, unknown>) => {
      const res = await handle(req(o), w.deps);
      if (res.ok) throw new Error("expected a failure");
      return res.error;
    };

    expect((await err({ kind: "page.read", page: `${ROOT_PAGE}/nothing-here` })).code).toBe("not_found");
    expect((await err({ kind: "doc.get", page: `${ROOT_PAGE}/nothing-here` })).code).toBe("not_found");
    expect((await err({ kind: "table.schema", name: "nothing-here" })).code).toBe("not_found");
    expect((await err({ kind: "table.get", name: "nothing-here" })).code).toBe("not_found");
    // An id that could never be a page path is refused as one rather than
    // reaching the filesystem to find out.
    expect((await err({ kind: "page.read", page: "../../etc" })).code).toBe("bad_request");

    // Scoped to a mount, and a mount is a client-side fact — the bridge resolves
    // these against the store and they never travel here.
    expect((await err({ kind: "data.get" })).code).toBe("bad_request");
    expect((await err({ kind: "data.set", patch: { a: 1 } })).code).toBe("bad_request");
    // `children` and `variables` are the same shape of refusal for the same
    // reason: an artifact omits `page` to mean the page it is mounted on, and an
    // HTTP request carries no mount for the server to resolve that against.
    expect((await err({ kind: "children" })).code).toBe("bad_request");
    expect((await err({ kind: "variables" })).code).toBe("bad_request");

    // A patch carrying something no field could hold. A variable is a value
    // somebody types in: a scalar, or a list of them.
    expect((await err({ kind: "variables.patch", page: ROOT_PAGE, section: null, patch: { a: { deep: 1 } } })).code)
      .toBe("flatness");
    // A section whose entry has gone. Refused rather than landed on the page,
    // because one scope out is in scope for every other section there is.
    expect((await err({ kind: "variables.patch", page: ROOT_PAGE, section: "nowhere", patch: { a: 1 } })).code)
      .toBe("not_found");

    // A folder that is not there. The code travels from the layer that looked,
    // and the sentence is written here — a vault error carries a path more
    // naturally than any other, and must not.
    const gone = await err({ kind: "vault.open", path: "/nowhere-at-all" });
    expect(gone.code).toBe("not_found");
    expect(gone.message).not.toContain("nowhere");

    // The one way out is http and https. `file:` would turn it into a way in.
    expect((await err({ kind: "fetch", url: "file:///etc/passwd" })).code).toBe("bad_request");
    expect((await err({ kind: "fetch", url: "not a url" })).code).toBe("bad_request");

    // A message is a leak channel: the code travels, the sentence is ours.
    w.tables.boom = true;
    const sql = await err({ kind: "sql", query: "SELECT" });
    expect(sql.code).toBe("sql_error");
    expect(sql.message).not.toContain("/Users");
  } finally {
    await w.drop();
  }
});

test("the route sends no CORS headers, ever", async () => {
  const w = await workspace();
  try {
    const post = (init: RequestInit) => route(new Request("http://localhost:4400/api/call", { method: "POST", ...init }), w.deps);

    const good = await post({
      headers: { "content-type": "application/json", origin: "http://localhost:4400" },
      body: JSON.stringify(req({ kind: "page.list" })),
    });
    expect(good.status).toBe(200);
    // The whole security argument for the framework is that a null-origin frame
    // cannot reach this route. A single permissive header hands that back.
    expect(good.headers.get("access-control-allow-origin")).toBe(null);
    expect(good.headers.get("access-control-allow-credentials")).toBe(null);
    expect(((await good.json()) as ApiResponse).ok).toBe(true);

    // The artifact frame's origin, refused by name.
    const frame = await post({
      headers: { "content-type": "application/json", origin: "null" },
      body: JSON.stringify(req({ kind: "page.list" })),
    });
    expect(frame.status).toBe(403);

    // A simple request would skip the preflight this server never answers.
    const simple = await post({ headers: { "content-type": "text/plain" }, body: "{}" });
    expect(simple.status).toBe(415);

    const notJson = await post({ headers: { "content-type": "application/json" }, body: "{" });
    const body = (await notJson.json()) as ApiResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe("bad_request");

    const get = await route(new Request("http://localhost:4400/api/call"), w.deps);
    expect(get.status).toBe(405);
  } finally {
    await w.drop();
  }
});

/* ── the markdown mirror ───────────────────────────────────────────────── */

test("a page's projection lands in _markdown/ with frontmatter Obsidian reads", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const start = value(await call({ kind: "page.create", init: { parent: null, name: "Ashgrove" } })) as PageRef;

    await w.deps.mirror.project(start.id);
    const text = await w.files.read(`_markdown/${start.id}.md`);
    expect(text).not.toBeNull();
    const md = String(text);

    // The keys a reader and a brain both need, and NOT `title` — the body opens
    // with the name as an H1 and the vault's own convention calls a `title:`
    // duplicating a heading a mistake.
    expect(md).toContain(`id: ${start.id}`);
    expect(md).toContain('aliases: ["Ashgrove"]');
    expect(md).toContain("generated: true");
    // `source:` names the real file, `children/` hops and all — it is the one
    // line here that has to be openable rather than link-shaped.
    expect(md).toContain(`source: pages/${start.id.split("/").join("/children/")}/content.yaml`);
    expect(md).not.toContain("title:");
    // One `# Ashgrove` and not two: a seeded page's first part opens with the
    // same words, and the projection drops that line rather than repeating it.
    expect(md.split("# Ashgrove").length - 1).toBe(1);
  } finally { await w.drop(); }
});

test("a child is a wikilink relative to the mirror, because the mirror IS the vault root", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const home = value(await call({ kind: "page.create", init: { parent: null, name: "Home" } })) as PageRef;
    const kid = value(await call({ kind: "page.create", init: { parent: home.id, name: "Ashgrove" } })) as PageRef;

    await w.deps.mirror.project(home.id);
    const md = String(await w.files.read(`_markdown/${home.id}.md`));
    // The id IS the path, with the `children/` hops the filesystem needs left
    // out — a link carrying them would resolve to nothing in Obsidian.
    expect(md).toContain(`- [[${kid.id}|Ashgrove]]`);
    // The `children/` hops belong to the filesystem and to the `source:` line
    // that names it; a LINK carrying them would resolve to nothing in Obsidian.
    expect(md.slice(md.indexOf("# Home"))).not.toContain("children/");
  } finally { await w.drop(); }
});

// A VAULT NOTE'S FRONTMATTER IS REAL INFORMATION — `tags`, `status`, `verified`
// — read by the conventions the vault is written under and by anything asking a
// brain a question. A mirror that wrote five fixed keys and dropped the rest
// would lose all of it the first time a note became a page.
test("a page's variables come back out as its frontmatter, and cannot claim the host's keys", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const page = value(await call({ kind: "page.create", init: { parent: null, name: "Lovable" } })) as PageRef;
    await call({
      kind: "doc.writeRaw", page: page.id,
      text: "name: Lovable\nplugin: doc\nvariables:\n"
        + "  tags: [company, competitor]\n"
        + "  relationship: analogy\n"
        + '  verified: "2026-08-20"\n'
        + "  aliases: [lovable, lovable.dev]\n"
        + "  id: somewhere/else\n"
        + "  generated: false\n"
        + "contents:\n  - name: note\n    parts:\n      body: Prompt to app.\n",
    });
    const md = String(await w.files.read(`_markdown/${page.id}.md`));

    // Carried, with a string kept a string: a date left unquoted comes back as a
    // date and `verified` stops comparing equal to what the note said.
    expect(md).toContain('tags: ["company", "competitor"]');
    expect(md).toContain('relationship: "analogy"');
    expect(md).toContain('verified: "2026-08-20"');

    // `aliases` MERGES rather than replacing: the page's name and whatever the
    // note called itself are both true, and Obsidian resolves on either.
    expect(md).toContain('aliases: ["Lovable", "lovable", "lovable.dev"]');

    // AND THE HOST'S KEYS ARE THE HOST'S. A page that could rewrite `id:` or
    // `generated:` could point its own archive copy at somebody else's document.
    expect(md).toContain(`id: ${page.id}`);
    expect(md).not.toContain("id: somewhere/else");
    expect(md).toContain("generated: true");
    expect(md).not.toContain("generated: false");
  } finally { await w.drop(); }
});

test("a page that is removed takes its projection with it, in the same request", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const home = value(await call({ kind: "page.create", init: { parent: null, name: "Home" } })) as PageRef;
    const kid = value(await call({ kind: "page.create", init: { parent: home.id, name: "Gone" } })) as PageRef;
    // The create wrote it, so nobody has to open a page for its file to exist.
    expect(await w.files.read(`_markdown/${kid.id}.md`)).not.toBeNull();

    expect((await call({ kind: "page.remove", page: kid.id })).ok).toBe(true);
    expect(await w.files.read(`_markdown/${kid.id}.md`)).toBeNull();
    // And the parent no longer lists it: a page arriving or leaving changes the
    // page above it as much as itself.
    expect(String(await w.files.read(`_markdown/${home.id}.md`))).not.toContain("Gone");
  } finally { await w.drop(); }
});

// A MOVE RENAMES EVERY ID BENEATH IT, and a mirror file is named by its id. The
// mirror has to be CARRIED across rather than dropped and re-projected at the
// new path: dropping takes the subtree's markdown with it, and re-projecting
// only the page that moved never puts it back. Measured on the real workspace
// once — moving three boards deleted 135 files.
test("a moved page takes its mirror, and everything under it, to the new id", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const clients = value(await call({ kind: "page.create", init: { parent: null, name: "Clients" } })) as PageRef;
    const notes = value(await call({ kind: "page.create", init: { parent: null, name: "Notes" } })) as PageRef;
    const ash = value(await call({ kind: "page.create", init: { parent: notes.id, name: "Ashgrove" } })) as PageRef;
    // A page this host cannot render itself, whose words only its own box knows.
    // Its projection is the half that would be lost for good: a doc page's comes
    // back from `content.yaml`, and a board's does not.
    const board = value(await call({ kind: "page.create", init: { parent: notes.id, name: "Board" } })) as PageRef;
    await call({ kind: "doc.writeRaw", page: board.id, text: "name: Board\nplugin: html\n" });
    await call({ kind: "page.projection", page: board.id, markdown: "- a card nobody else can compute" });

    const to = value(await call({ kind: "page.move", page: notes.id, parent: clients.id })) as PageId;

    // The whole subtree came across.
    expect(await w.files.read(`_markdown/${to}.md`)).not.toBeNull();
    expect(await w.files.read(`_markdown/${to}/Ashgrove.md`)).not.toBeNull();
    expect(await w.files.read(`_markdown/${to}/Board.md`)).not.toBeNull();
    // And nothing is left at the old path.
    expect(await w.files.read(`_markdown/${notes.id}.md`)).toBeNull();
    expect(await w.files.read(`_markdown/${ash.id}.md`)).toBeNull();

    // The board kept the words only it could produce, and its frontmatter was
    // rewritten around them rather than copied — it states where the page is now.
    const moved = String(await w.files.read(`_markdown/${to}/Board.md`));
    expect(moved).toContain("- a card nobody else can compute");
    expect(moved).toContain(`id: ${to}/Board`);
    expect(moved).toContain(`parent: ${to}`);
    expect(moved).not.toContain(`id: ${notes.id}`);

    // A DOC PAGE IS RE-PROJECTED rather than carried, because its projection
    // spells the ids of its children and those ids have just changed. A carried
    // copy would hold links that resolve to nothing.
    const parent = String(await w.files.read(`_markdown/${to}.md`));
    expect(parent).toContain(`[[${to}/Ashgrove|Ashgrove]]`);
    expect(parent).not.toContain(`[[${ash.id}|`);
  } finally { await w.drop(); }
});

test("typing in a slot rewrites that page's projection and nothing else", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const page = value(await call({ kind: "page.create", init: { parent: null, name: "Rates" } })) as PageRef;
    const read = value(await call({ kind: "page.read", page: page.id })) as Page;
    const first = read.sections[0]!;

    const written = await call({
      kind: "section.write", page: page.id, section: first.name,
      part: Object.keys(first.parts)[0]!, data: "## Standing charge\n\nIt is 62p a day.",
    });
    expect(written.ok).toBe(true);
    const md = String(await w.files.read(`_markdown/${page.id}.md`));
    expect(md).toContain("## Standing charge");
    expect(md).toContain("It is 62p a day.");
  } finally { await w.drop(); }
});

test("the mirror prunes what is no longer a page, and says so", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const home = value(await call({ kind: "page.create", init: { parent: null, name: "Home" } })) as PageRef;

    // A page removed while this process was not running leaves nothing behind
    // to notice except the file itself, which is why the prune walks the mirror
    // rather than the pages.
    await w.files.write("_markdown/home/ghost.md", "# Ghost\n");
    await w.files.write("_markdown/home/ghost/deeper.md", "# Deeper\n");
    // Somebody else's, and it stays: a page segment cannot begin with `.`, so a
    // dot-directory can never be a page whose file this is sweeping up. This
    // folder is a vault root and the first thing done with one is opening it in
    // Obsidian, which writes its config here.
    await w.files.write("_markdown/.obsidian/appearance.json", "{}\n");

    const gone = await w.deps.mirror.prune((await w.deps.pages.list()).map((p) => p.id));
    expect(gone.length).toBeGreaterThan(0);
    expect(await w.files.read("_markdown/home/ghost.md")).toBeNull();
    expect(await w.files.read("_markdown/.obsidian/appearance.json")).not.toBeNull();
    // AND THE READ-ONLY NOTICE SURVIVES ITS OWN SWEEP. A page id may begin with
    // a capital, so `AGENTS` is a legal segment and the sweep cannot tell the
    // notice from a stale page by its shape — it deleted both on every mount,
    // in the same rebuild that had just written them, so the folder never once
    // carried the warning it exists for.
    const live = async () => (await w.deps.pages.list()).map((p) => p.id);
    await w.deps.mirror.guide();
    await w.deps.mirror.prune(await live());
    expect(await w.files.read("_markdown/AGENTS.md")).not.toBeNull();
    expect(await w.files.read("_markdown/README.md")).not.toBeNull();
    // A page genuinely called CLAUDE would live at `home/AGENTS.md`, one level
    // down, so the exemption is the ROOT and not the name everywhere.
    await w.files.write("_markdown/home/AGENTS.md", "# not the notice\n");
    await w.deps.mirror.prune(await live());
    expect(await w.files.read("_markdown/home/AGENTS.md")).toBeNull();
    expect(await w.files.read(`_markdown/${home.id}.md`)).not.toBeNull();
  } finally { await w.drop(); }
});

test("the mirror says it is read-only, in the folder somebody will open", async () => {
  const w = await workspace();
  try {
    const wrote = await w.deps.mirror.guide();
    expect(wrote).toBe(true);
    for (const name of ["AGENTS.md", "README.md"]) {
      const text = String(await w.files.read(`_markdown/${name}`));
      expect(text).toContain("generated");
      expect(text).toContain("Do not edit");
      // It says where to go instead, because a warning with no alternative is
      // one somebody works around.
      expect(text).toContain("content.yaml");
    }
    // Written once: a second call changes nothing, so a mount that did nothing
    // makes no commit.
    expect(await w.deps.mirror.guide()).toBe(false);
  } finally { await w.drop(); }
});

test("the design doc and a bad id are refused by name rather than written somewhere odd", async () => {
  const w = await workspace();
  try {
    await expect(w.deps.mirror.write("@design", "# Design")).rejects.toThrow();
    await expect(w.deps.mirror.write("../escape", "# No")).rejects.toThrow();
  } finally { await w.drop(); }
});

test("the mirror never renders a page it cannot draw, so a board's own markdown survives a restart", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const page = value(await call({ kind: "page.create", init: { parent: null, name: "Board" } })) as PageRef;
    // Make it a page the server cannot render: a plugin's input is its own and
    // there are no sections to walk.
    await call({ kind: "doc.writeRaw", page: page.id, text: "name: Board\nplugin: kanban\ninput:\n  table: jobs\n" });

    // The box reports what the board actually says, as it does after every draw.
    await call({ kind: "page.projection", page: page.id, markdown: "## Doing\n\n- **Ashgrove**" });
    expect(String(await w.files.read(`_markdown/${page.id}.md`))).toContain("- **Ashgrove**");

    // A rebuild on mount must leave that alone. Rendering a board with the doc
    // rule answers the empty string, and writing it would empty the archive copy
    // of every board on every restart.
    await w.deps.mirror.project(page.id);
    expect(String(await w.files.read(`_markdown/${page.id}.md`))).toContain("- **Ashgrove**");

    // A doc page IS rendered here, which is what fills a mirror on mount.
    const doc = value(await call({ kind: "page.create", init: { parent: null, name: "Notes" } })) as PageRef;
    await w.deps.mirror.project(doc.id);
    expect(await w.files.read(`_markdown/${doc.id}.md`)).not.toBeNull();
  } finally { await w.drop(); }
});

/* ── which build this is ────────────────────────────────────────────────── */

// THE THREE KINDS A BUILT APPLICATION TURNS OFF IN THE SERVER rather than leaves
// off a menu. Two of them are `HostRequest` kinds reachable by any page in the
// workspace and not by a control anybody can hide, so hiding is not available as
// a mechanism — the refusal has to be here.
//
// Both halves are constructed rather than set on the runner: `production` is a
// field on `Deps` like every other, so a test says which build it means by
// building one. Nothing here reads an environment variable and nothing here can
// leak into another test file.

test("production refuses sql and fetch, and every other build answers them", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), { ...w.deps, production: true });
    const dev = (o: Record<string, unknown>) => handle(req(o), w.deps);

    for (const kind of [
      { kind: "sql", query: "SELECT 1" },
      { kind: "fetch", url: "https://example.com/" },
    ]) {
      const res = await call(kind);
      expect([kind.kind, res.ok]).toEqual([kind.kind, false]);
      if (res.ok) throw new Error("unreachable");
      // The sentence a page author reads says the BUILD refuses it, rather than
      // that they got the request wrong.
      expect(res.error.message).toContain("this build does not offer");
      // THE CODE IS ITS OWN WORD NOW. This used to spend `not_found` for want of
      // a member of `HostErrorCode` that meant "this build does not offer that";
      // `unsupported` joined the enumeration at a barrier and says it.
      expect(res.error.code).toBe("unsupported");
      // And it is not retryable: an artifact that backed off and tried again
      // would do it forever.
      expect(res.error.retryable).toBe(false);
    }

    // The same server, built the other way, answers exactly as it did before.
    expect((value(await dev({ kind: "sql", query: "SELECT 1" })) as SqlResult).columns).toEqual(["n"]);

    // The kinds still EXIST in production — they are refused, not unknown. A
    // request the type does not spell is a different answer entirely.
    const unknown = await call({ kind: "nonsense.kind" });
    if (unknown.ok) throw new Error("unreachable");
    expect(unknown.error.code).toBe("unknown_kind");
  } finally {
    await w.drop();
  }
});

test("vault.browse is refused in production and answered in development", async () => {
  const w = await workspace();
  try {
    // THE ITEM THAT COULD NOT GO ALONE, AND NOW HAS. Browse was the only way to
    // reach a workspace on disk and not in `Recent`, so the refusal was held
    // until the shell's folder dialog served Open as well as Create. It does —
    // `app/preload.js` — so `NATIVE_DIALOG` in server/api/routes.ts is true and
    // this is live. Hiding the group without refusing the kind would only move
    // the listing out of sight: it is reachable by a typed request.
    const built = await handle(req({ kind: "vault.browse" }), { ...w.deps, production: true });
    if (built.ok) throw new Error("unreachable");
    expect(built.error.code).toBe("unsupported");
    expect(built.error.retryable).toBe(false);
    expect(built.error.message).toContain("this build does not offer");

    // A browser has no dialog, so the listing is the only chooser `make dev`
    // has and the development server goes on walking its own filesystem.
    const dev = await handle(req({ kind: "vault.browse" }), w.deps);
    expect((value(dev) as DirListing).dirs[0]?.vault).toBe(true);
  } finally {
    await w.drop();
  }
});

test("a Deps that says nothing about the build behaves exactly as it did", async () => {
  const w = await workspace();
  try {
    // The field is optional precisely so every existing caller — this file's own
    // world included — goes on meaning development without being edited.
    expect("production" in w.deps).toBe(false);
    expect((value(await handle(req({ kind: "sql", query: "SELECT 1" }), w.deps)) as SqlResult).columns)
      .toEqual(["n"]);
  } finally {
    await w.drop();
  }
});

/* ── automations and runs ────────────────────────────────────────────── */

test("the automation and run kinds reach the registry, and every refusal is a code and a sentence", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const page = (value(await call({ kind: "page.create", init: { name: "Socials" } })) as { id: string; uid: string });
    // Nothing yet, and a page with none is an empty list rather than an error.
    expect(value(await call({ kind: "automation.list" }))).toEqual([]);
    expect(value(await call({ kind: "automation.list", page: page.id }))).toEqual([]);
    // The templates the seed root holds — this world's seed has none — and a
    // template that is not there is refused by name.
    expect(value(await call({ kind: "automation.templates" }))).toEqual([]);
    const noTemplate = await call({ kind: "automation.create", page: page.id, name: "Pull", template: "claude" });
    if (noTemplate.ok) throw new Error("unreachable");
    expect(noTemplate.error.code).toBe("not_found");
    expect(noTemplate.error.message).toBe("no such template");

    // A manifest written by hand under the page is listed, read as a structure,
    // and written back as one.
    await w.deps.pages.writeFile(page.id, "automations/pull/automation.yaml",
      "name: Pull\nenv: [KEY_ONE]\ncommand: [sh, -c, \"echo {tag}\"]\ninputs:\n  - { name: tag, type: text, required: true }\n");
    await w.deps.pages.writeFile(page.id, "automations/pull/kickoff.md", "Do {tag}.\n");
    const listed = value(await call({ kind: "automation.list" })) as { folder: string; page: string; uid?: string; manifest: { name: string } | null }[];
    expect(listed.map((a) => [a.folder, a.page, a.uid === page.uid, a.manifest?.name])).toEqual([["pull", page.id, true, "Pull"]]);
    const manifest = value(await call({ kind: "automation.get", page: page.id, automation: "pull" })) as { env: string[]; description: string };
    expect(manifest.env).toEqual(["KEY_ONE"]);
    expect(value(await call({ kind: "automation.set", page: page.id, automation: "pull", manifest: { ...manifest, description: "Pulls." } }))).toBeNull();
    expect((value(await call({ kind: "automation.get", page: page.id, automation: "pull" })) as { description: string }).description).toBe("Pulls.");

    // The page's files, and one of them.
    const files = value(await call({ kind: "page.files", page: page.id })) as { path: string }[];
    expect(files.map((f) => f.path)).toEqual(["INSTRUCTIONS.md", "automations/pull/automation.yaml", "automations/pull/kickoff.md"]);
    expect(value(await call({ kind: "page.readFile", page: page.id, file: "automations/pull/kickoff.md" }))).toBe("Do {tag}.\n");
    const walked = await call({ kind: "page.readFile", page: page.id, file: "../content.yaml" });
    if (walked.ok) throw new Error("unreachable");
    expect(walked.error.code).toBe("bad_request");

    // The environment's names, and never a value.
    expect(value(await call({ kind: "env.names" }))).toEqual(["KEY_ONE", "KEY_TWO", "PATH"]);

    // START: a missing required input is refused by name; started, the row is
    // answered, the change announced, and `by` is whatever the caller said —
    // the bridge is what overwrites it, and this is the layer under the bridge.
    const missing = await call({ kind: "run.start", page: page.id, automation: "pull" });
    if (missing.ok) throw new Error("unreachable");
    expect(missing.error.code).toBe("bad_request");
    expect(missing.error.message).toBe("the input tag is required");
    const row = value(await call({ kind: "run.start", page: page.id, automation: "pull", inputs: { tag: "x" }, by: "p-uid" })) as RunRow;
    expect(row.status).toBe("running");
    expect(row.by).toBe("p-uid");
    expect(row.uid).toBe(page.uid);
    expect(row.command).toEqual(["sh", "-c", "echo x"]);
    expect(w.changes).toEqual(["start"]);
    expect(value(await call({ kind: "run.live" }))).toBe(1);
    expect((value(await call({ kind: "run.list" })) as RunRow[]).map((r) => r.id)).toEqual([row.id]);
    expect((value(await call({ kind: "run.list", automation: "other" })) as RunRow[]).length).toBe(0);
    expect((value(await call({ kind: "run.get", run: row.id })) as RunRow).id).toBe(row.id);
    const gone = await call({ kind: "run.get", run: "nope" });
    if (gone.ok) throw new Error("unreachable");
    expect(gone.error.code).toBe("not_found");
    // The log, empty because nothing was spawned, still says the run is alive.
    expect(value(await call({ kind: "run.read", run: row.id, stream: "stdout" }))).toEqual({ text: "", next: 0, ended: false });
    // KILL off the wire is a page's, and the row says so.
    const killed = value(await call({ kind: "run.kill", run: row.id })) as RunRow;
    expect(killed.status).toBe("killed");
    expect(killed.endedBy).toBe("page");
    expect(w.changes).toEqual(["start", "end"]);
    expect(value(await call({ kind: "run.live" }))).toBe(0);
    expect((value(await call({ kind: "run.read", run: row.id, stream: "stderr" })) as { ended: boolean }).ended).toBe(true);
  } finally {
    await w.drop();
  }
});

test("a page moved since a run started still lists the run, and the row names the page where it is now", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const a = value(await call({ kind: "page.create", init: { name: "A" } })) as { id: string; uid: string };
    const b = value(await call({ kind: "page.create", init: { name: "B" } })) as { id: string };
    await w.deps.pages.writeFile(a.id, "automations/pull/automation.yaml", "name: Pull\ncommand: [x]\n");
    const row = value(await call({ kind: "run.start", page: a.id, automation: "pull", inputs: {}, by: null })) as RunRow;
    expect(row.page).toBe(a.id);
    const moved = value(await call({ kind: "page.move", page: a.id, parent: b.id })) as string;
    expect(moved).not.toBe(a.id);
    // Listed under the new id, and named by it.
    const under = value(await call({ kind: "run.list", page: moved })) as RunRow[];
    expect(under.map((r) => [r.id, r.page, r.uid])).toEqual([[row.id, moved, a.uid]]);
    expect((value(await call({ kind: "run.get", run: row.id })) as RunRow).page).toBe(moved);
    // Not under the old id, which names nothing now.
    expect((value(await call({ kind: "run.list", page: a.id })) as RunRow[]).length).toBe(0);
  } finally {
    await w.drop();
  }
});

test("the vault's own instructions and skills are read and written, and nothing else is", async () => {
  const w = await workspace();
  try {
    const call = (o: Record<string, unknown>) => handle(req(o), w.deps);
    const before = value(await call({ kind: "vault.files" })) as { path: string; seeded: boolean }[];
    expect(before[0]).toEqual({ path: "INSTRUCTIONS.md", seeded: false });
    expect(value(await call({ kind: "vault.readFile", file: "INSTRUCTIONS.md" }))).toBeNull();
    expect(value(await call({ kind: "vault.writeFile", file: "INSTRUCTIONS.md", text: "# Ours\n" }))).toBeNull();
    expect(value(await call({ kind: "vault.readFile", file: "INSTRUCTIONS.md" }))).toBe("# Ours\n");
    const no = await call({ kind: "vault.writeFile", file: "AGENTS.md", text: "x" });
    if (no.ok) throw new Error("unreachable");
    expect(no.error.code).toBe("bad_request");
    expect(no.error.message).toBe("not a file this screen writes");
  } finally {
    await w.drop();
  }
});
