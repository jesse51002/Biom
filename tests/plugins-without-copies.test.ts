// SPDX-License-Identifier: AGPL-3.0-only
// PLUGINS WITHOUT COPIES — the framework's plugins as the rung under a vault's
// own, rather than a copy seeded into it.
//
// Three pieces, and each is a property a page's author can feel:
//
//   · THE UNION. The loader's one script is the framework's slot plugins minus
//     every name the vault also has, then the vault's own — so a vault file
//     shadows the framework's by name and the registry never sees two of one id.
//     A file under `/plugin/` the vault has not got is answered from the
//     framework, per file, which is what lets a partial override work.
//
//   · THE SWEEP. A vault file that is byte for byte a version the framework
//     ever shipped was never edited: it is a seeded copy that fell behind or
//     will, and it goes on open, committed first. One changed byte keeps it.
//
//   · THE HASH IS GIT'S. `blobHash` is what `git hash-object` answers, so the
//     list a build carries and the list a checkout reads out of its own history
//     are the same numbers.
//
//   · THE SKILLS ARE THE FRAMEWORK'S, and the same rule reaches them the only
//     way it can: an agent reads the folder, not the server, so there is no
//     rung to fall back to — the file in the vault IS the framework's file, and
//     it is rewritten whole on every open. Nothing under `.agents/skills/` can
//     be overridden; a workspace adds skills under names of its own.
//
// Fixtures are invented and say so.

import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeHost, pluginBundle, pluginFile, PLUGIN_DIR_ROUTE } from "../server/main.ts";
import { makeFiles } from "../server/platform/files.ts";
import { blobHash, isShipped, shippedHashes } from "../server/platform/shipped.ts";
import { AGENTS, INSTRUCTIONS, MIRROR_DIR, SHIPPED_DIRS, SKILLS_DIR, mirrorPlugins, rewriteOwned, sweepOldSkills, sweepShipped } from "../server/workspace/framework.ts";
import { manifestSource } from "../tools/app.ts";
import { vaultBase } from "../contracts/wire.js";

const HERE = join(import.meta.dir, "..");
const SEED = join(HERE, "guest/plugins");

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "biom-no-copies-"));
}

/** The real registry, with a bundle run against it exactly as the box does. */
function run(bundle: string): { took: string[]; said: string[] } {
  const said: string[] = [];
  const glob = globalThis as any;
  const had = { rt: glob.__gRuntime, biom: glob.biom, doc: glob.document };
  glob.__gRuntime = { report: (m: string) => said.push(m) };
  delete glob.biom;
  glob.document = { currentScript: null };
  try {
    new Function(REGISTRY)();
    new Function(bundle)();
    return { took: glob.__gRuntime.plugins.ids(), said };
  } finally {
    glob.__gRuntime = had.rt;
    glob.biom = had.biom;
    glob.document = had.doc;
  }
}
const REGISTRY = readFileSync(join(HERE, "guest/runtime/registry.js"), "utf8");
const plugin = (id: string) => `(function () { biom.plugins.register({ id: ${JSON.stringify(id)}, mount: function () {} }); })();`;

/** An invented framework root on disk, so the union is asserted against a set
 *  this test controls rather than whatever `guest/plugins/` holds today. */
async function frameworkWith(files: Record<string, string>): Promise<string> {
  const root = await scratch();
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), text);
  }
  return root;
}

/* ══ the union ═══════════════════════════════════════════════════════════ */

test("the bundle is the framework's slot plugins minus every name the vault has, then the vault's own", async () => {
  const framework = await frameworkWith({
    "markdown.js": plugin("markdown"),
    "table.js": plugin("table"),
    "reveal.js": plugin("reveal"),
    "doc/index.html": "<!doctype html>",
  });
  const vault = await scratch();
  await mkdir(join(vault, "plugins"), { recursive: true });
  await writeFile(join(vault, "plugins", "markdown.js"), plugin("markdown"));
  await writeFile(join(vault, "plugins", "board.js"), plugin("board"));
  try {
    const bundle = await (await pluginBundle(vault, makeFiles(framework))).text();
    // FRAMEWORK FIRST, so a vault plugin that `ctx.use`s a framework one finds
    // it registered; the vault's after. And ONE markdown: the vault's, because
    // the framework's never entered the script.
    expect(run(bundle).took).toEqual(["reveal", "table", "board", "markdown"]);
    expect(bundle).toContain("/* framework/reveal.js */");
    expect(bundle).toContain("/* framework/table.js */");
    expect(bundle).not.toContain("/* framework/markdown.js */");
    expect(bundle).toContain("/* plugins/markdown.js */");
    expect(bundle).toContain("/* plugins/board.js */");
    expect(bundle.indexOf("/* framework/table.js */")).toBeLessThan(bundle.indexOf("/* plugins/board.js */"));
    // A part kind is still bound to its file name whichever root it came from:
    // the registry refused nothing above.
    expect(run(bundle).said).toEqual([]);
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("a broken plugin is named by the root it came from, so a reader knows which copy to open", async () => {
  const framework = await frameworkWith({ "fine.js": plugin("fine"), "cracked.js": `(function () { throw new Error("framework side"); })();` });
  const vault = await scratch();
  await mkdir(join(vault, "plugins"), { recursive: true });
  await writeFile(join(vault, "plugins", "mine.js"), `(function () { throw new Error("vault side"); })();`);
  try {
    const { took, said } = run(await (await pluginBundle(vault, makeFiles(framework))).text());
    expect(took).toEqual(["fine"]);
    expect(said.find((m) => m.includes("framework side"))).toContain("framework/cracked.js did not load");
    expect(said.find((m) => m.includes("vault side"))).toContain("plugins/mine.js did not load");
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("a vault with no plugins at all is drawn by the framework's set, and no folder is made for it", async () => {
  const framework = await frameworkWith({ "markdown.js": plugin("markdown"), "html.js": plugin("html") });
  const vault = await scratch();
  try {
    const answer = await pluginBundle(vault, makeFiles(framework));
    expect(answer.status).toBe(200);
    expect(run(await answer.text()).took).toEqual(["html", "markdown"]);
    expect(existsSync(join(vault, "plugins"))).toBe(false);
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("the bundle is rebuilt when a FRAMEWORK plugin changes, so editing guest/plugins/ and reloading is live", async () => {
  const framework = await frameworkWith({ "one.js": plugin("one") });
  const vault = await scratch();
  try {
    const first = await (await pluginBundle(vault, makeFiles(framework))).text();
    expect(await (await pluginBundle(vault, makeFiles(framework))).text()).toBe(first);
    await writeFile(join(framework, "one.js"), plugin("renamed"));
    expect(run(await (await pluginBundle(vault, makeFiles(framework))).text()).took).toEqual(["renamed"]);
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

/* ══ per file, through the route ═════════════════════════════════════════ */

test("a plugin's sibling file the vault has not got is served from the framework, so a partial override works", async () => {
  // `plugins/kanban/index.html` in a vault and nothing beside it: the document
  // is the vault's, and the `kanban/kanban.js` it names by `data-g-src` is the
  // framework's. That is the nearest-first walk applied per FILE, and it is why
  // the paved override copies a plugin whole — a person who wants isolation
  // takes the directory.
  const framework = await frameworkWith({ "kanban/index.html": "<!doctype html><title>theirs</title>", "kanban/kanban.js": "// the framework's board" });
  const vault = await scratch();
  await mkdir(join(vault, "plugins/kanban"), { recursive: true });
  await writeFile(join(vault, "plugins/kanban/index.html"), "<!doctype html><title>mine</title>");
  try {
    const root = makeFiles(framework);
    // The vault's file answers first.
    const doc = await pluginFile("kanban/index.html", vault, root);
    expect(doc.status).toBe(200);
    expect(await doc.text()).toContain("mine");
    // A path it has not got falls back to the framework's, with the type the
    // name says.
    const script = await pluginFile("kanban/kanban.js", vault, root);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(await script.text()).toBe("// the framework's board");
    // Nobody has it: a 404, not a fall past the framework into the install.
    expect((await pluginFile("nothing/here.js", vault, root)).status).toBe(404);
    // And the route is what the frame spells, so a tag resolves to it.
    expect(`${vaultBase(vault)}${PLUGIN_DIR_ROUTE}`.endsWith("/plugin/")).toBe(true);
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

/* ══ the sweep ═══════════════════════════════════════════════════════════ */

test("blobHash is git's own hash of a file", () => {
  // `git hash-object` of an empty file, and of "hello\n", are known values.
  expect(blobHash("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  expect(blobHash("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  expect(isShipped({ "guest/plugins/a.js": [blobHash("x")] }, "guest/plugins/a.js", "x")).toBe(true);
  expect(isShipped({ "guest/plugins/a.js": [blobHash("x")] }, "guest/plugins/a.js", "x ")).toBe(false);
  expect(isShipped({}, "guest/plugins/a.js", "x")).toBe(false);
});

test("this repository's own history answers every committed plugin and skill, at the tip's bytes", async () => {
  // The list a build carries is read out of git; a checkout reads the same
  // history at run time. Either way the file as the TIP holds it is one of the
  // versions it has shipped. Read off the tip rather than the working tree, so
  // an edit in progress is not a failure here — a working-tree edit is exactly
  // the thing history does not yet know.
  const { spawnSync } = await import("node:child_process");
  const atTip = (path: string) => spawnSync("git", ["show", `HEAD:${path}`], { cwd: HERE, encoding: "utf8" }).stdout;
  const shipped = await shippedHashes(HERE, SHIPPED_DIRS);
  for (const rel of ["markdown.js", "doc/index.html", "kanban/kanban.js"]) {
    expect([rel, isShipped(shipped, `guest/plugins/${rel}`, atTip(`guest/plugins/${rel}`))]).toEqual([rel, true]);
  }
  expect(isShipped(shipped, "guest/plugins/markdown.js", "// not a version anybody shipped")).toBe(false);
  // AND THE SKILLS, under the names they had before the prefix as well as the
  // names they have: the rename left the old paths in history, which is what
  // lets the old-name sweep recognise an unedited copy in a vault seeded
  // before it.
  expect(Object.keys(shipped).some((k) => k.startsWith(`vault/${SKILLS_DIR}/pages/`))).toBe(true);
  const tipPages = atTip(`vault/${SKILLS_DIR}/biom-pages/SKILL.md`) || atTip(`vault/${SKILLS_DIR}/pages/SKILL.md`);
  expect(tipPages.length).toBeGreaterThan(0);
  expect(
    isShipped(shipped, `vault/${SKILLS_DIR}/biom-pages/SKILL.md`, tipPages)
      || isShipped(shipped, `vault/${SKILLS_DIR}/pages/SKILL.md`, tipPages),
  ).toBe(true);
});

test("a vault copy byte-identical to a shipped version is swept on open, and one changed byte keeps a file", async () => {
  const root = await scratch();
  const vault = join(root, "v");
  await mkdir(join(vault, "pages/home"), { recursive: true });
  await writeFile(join(vault, "pages/home/content.yaml"), "name: Home\nplugin: doc\ncontents: []\n");
  await mkdir(join(vault, "plugins/doc"), { recursive: true });
  // Invented versions of an invented framework: v1 shipped, v2 shipped, and a
  // person's edit of neither.
  const v1 = "// markdown v1";
  const v2 = "// markdown v2";
  const edited = "// markdown v1 — but mine";
  await writeFile(join(vault, "plugins/markdown.js"), v1);
  await writeFile(join(vault, "plugins/html.js"), edited);
  await writeFile(join(vault, "plugins/doc/index.html"), "<!doctype html><title>old doc</title>");
  await writeFile(join(vault, "plugins/board.js"), "// this vault's own");
  const shipped = {
    "guest/plugins/markdown.js": [blobHash(v1), blobHash(v2)],
    "guest/plugins/html.js": [blobHash(v1)],
    "guest/plugins/doc/index.html": [blobHash("<!doctype html><title>old doc</title>")],
  };
  const host = await makeHost({
    vault,
    memory: join(root, "vaults.json"),
    presets: join(HERE, "presets"),
    vaultSeed: join(HERE, "vault"),
    skill: join(HERE, "skill"),
    checkerLib: HERE,
    shipped,
  });
  try {
    await host.settled(vault);
    // An old shipped version, unedited: gone, and the framework's draws now.
    expect(existsSync(join(vault, "plugins/markdown.js"))).toBe(false);
    // A shipped page plugin's document, unedited: gone, and its now-empty
    // directory with it, so nothing reads as a plugin with no document.
    expect(existsSync(join(vault, "plugins/doc"))).toBe(false);
    // One changed byte is an edit, and an edit is the person's.
    expect(readFileSync(join(vault, "plugins/html.js"), "utf8")).toBe(edited);
    // A file at no framework path is the vault's own and is never looked at.
    expect(readFileSync(join(vault, "plugins/board.js"), "utf8")).toBe("// this vault's own");
    // And the page still draws — on the framework's doc, through the rung.
    const deps = await host.deps(vault);
    expect((await deps.pages.read("home"))!.html).toBe(readFileSync(join(SEED, "doc/index.html"), "utf8"));
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the sweep commits before it deletes, so what went is one revert away", async () => {
  const root = await scratch();
  const vault = join(root, "v");
  await mkdir(join(vault, "plugins"), { recursive: true });
  await writeFile(join(vault, "plugins/markdown.js"), "// shipped once");
  const files = makeFiles(vault);
  const { initVault } = await import("../server/platform/files.ts");
  await initVault(vault);
  // Something the person was in the middle of, uncommitted — which is what the
  // commit before a write exists to keep.
  await writeFile(join(vault, "notes.md"), "half a thought");
  try {
    const gone = await sweepShipped(files, { "guest/plugins/markdown.js": [blobHash("// shipped once")] });
    expect(gone).toEqual(["plugins/markdown.js"]);
    expect(existsSync(join(vault, "plugins/markdown.js"))).toBe(false);
    // The commit before the deletion holds the file, and the half-written note.
    const { spawnSync } = await import("node:child_process");
    const git = (...args: string[]) => spawnSync("git", args, { cwd: vault, encoding: "utf8" }).stdout;
    expect(git("log", "--format=%s")).toContain("Before the framework's unedited plugin copies are removed");
    expect(git("show", "HEAD:plugins/markdown.js")).toBe("// shipped once");
    expect(git("show", "HEAD:notes.md")).toBe("half a thought");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a sweep with nothing to delete commits nothing", async () => {
  const root = await scratch();
  const vault = join(root, "v");
  await mkdir(join(vault, "plugins"), { recursive: true });
  await writeFile(join(vault, "plugins/mine.js"), "// mine");
  const files = makeFiles(vault);
  const { initVault } = await import("../server/platform/files.ts");
  await initVault(vault);
  try {
    expect(await sweepShipped(files, { "guest/plugins/mine.js": [blobHash("// not this")] })).toEqual([]);
    const { spawnSync } = await import("node:child_process");
    const log = spawnSync("git", ["log", "--format=%s"], { cwd: vault, encoding: "utf8" });
    expect(log.stdout).not.toContain("unedited plugin copies");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ the mirror ══════════════════════════════════════════════════════════ */

test("the mirror is the framework's set, whole, and the ignore line is appended to what is there", async () => {
  const framework = await frameworkWith({ "a.js": "A", "deep/index.html": "D" });
  const vault = await scratch();
  await writeFile(join(vault, ".gitignore"), "workspace.db\n");
  await mkdir(join(vault, MIRROR_DIR), { recursive: true });
  await writeFile(join(vault, MIRROR_DIR, "stale.js"), "left behind");
  try {
    await mirrorPlugins(makeFiles(vault), makeFiles(framework));
    expect(readFileSync(join(vault, MIRROR_DIR, "a.js"), "utf8")).toBe("A");
    expect(readFileSync(join(vault, MIRROR_DIR, "deep/index.html"), "utf8")).toBe("D");
    expect(existsSync(join(vault, MIRROR_DIR, "stale.js"))).toBe(false);
    expect(readFileSync(join(vault, ".gitignore"), "utf8")).toBe("workspace.db\ndocs/plugins/\n");
    // Idempotent: a second pass adds no second line.
    await mirrorPlugins(makeFiles(vault), makeFiles(framework));
    expect(readFileSync(join(vault, ".gitignore"), "utf8")).toBe("workspace.db\ndocs/plugins/\n");
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

/* ══ what a build carries ════════════════════════════════════════════════ */

test("the manifest carries the shipped hashes beside the files, sorted, and the stub carries none", () => {
  const source = manifestSource(["client/index.html"], { "markdown.js": ["bbb", "aaa"], "doc/index.html": ["ccc"] });
  expect(source).toContain("export const SHIPPED: Record<string, string[]> = {");
  expect(source).toContain('"doc/index.html": ["ccc"],');
  expect(source).toContain('"markdown.js": ["aaa","bbb"],');
  expect(source.indexOf('"doc/index.html"')).toBeLessThan(source.indexOf('"markdown.js"'));
  expect(manifestSource([])).toContain("export const SHIPPED: Record<string, string[]> = {\n};");
});

/* ══ the skills ══════════════════════════════════════════════════════════ */

/** An invented framework: a vault seed with two skills, a checker, and the one
 *  module it imports. */
async function frameworkSkills(): Promise<{ vaultSeed: string; skill: string; lib: string }> {
  const vaultSeed = await frameworkWith({
    "AGENTS.md": "# the guide",
    ".agents/skills/biom-pages/SKILL.md": "# pages v1",
    ".agents/skills/biom-pages/extra.md": "more on pages",
    ".agents/skills/biom-sections/SKILL.md": "# sections v1",
  });
  const skill = await frameworkWith({ "check.ts": "// the checker v1" });
  const lib = await frameworkWith({ "contracts/wire.js": "// wire v1", "contracts/types.ts": "// types v1", "contracts/scale.ts": "// scale v1" });
  return { vaultSeed, skill, lib };
}

test("a framework skill edited in a vault is the framework's again on the next open, and the rewrite reports it", async () => {
  const f = await frameworkSkills();
  const vault = await scratch();
  try {
    const roots = [makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib)] as const;
    // First open: everything the framework owns lands, and it says so.
    expect(await rewriteOwned(makeFiles(vault), ...roots)).toBe(true);
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"), "utf8")).toBe("# pages v1");
    expect(readFileSync(join(vault, SKILLS_DIR, "check.ts"), "utf8")).toBe("// the checker v1");
    expect(readFileSync(join(vault, SKILLS_DIR, "_lib/wire.js"), "utf8")).toBe("// wire v1");
    // AGENTS.md is the framework's too now, written with the skills; the
    // stub INSTRUCTIONS.md beside it is the seeder's and is not written here.
    expect(readFileSync(join(vault, "AGENTS.md"), "utf8")).toBe("# the guide");
    expect(existsSync(join(vault, "INSTRUCTIONS.md"))).toBe(false);
    // Second open, nothing changed: nothing written, and it says so.
    expect(await rewriteOwned(makeFiles(vault), ...roots)).toBe(false);

    // An edit to the framework's skill, a file added inside it, and a skill of
    // the vault's own beside them.
    await writeFile(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"), "# pages, but mine");
    await writeFile(join(vault, SKILLS_DIR, "biom-pages/notes.md"), "added here");
    // A workspace skill of its own — and one called `pages`, which is exactly the
    // name the prefix exists to leave free.
    await mkdir(join(vault, SKILLS_DIR, "ours"), { recursive: true });
    await writeFile(join(vault, SKILLS_DIR, "ours/SKILL.md"), "# ours");
    await mkdir(join(vault, SKILLS_DIR, "pages"), { recursive: true });
    await writeFile(join(vault, SKILLS_DIR, "pages/SKILL.md"), "# a workspace's own pages skill");
    expect(await rewriteOwned(makeFiles(vault), ...roots)).toBe(true);
    // The framework's name is the framework's again, whole.
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"), "utf8")).toBe("# pages v1");
    expect(existsSync(join(vault, SKILLS_DIR, "biom-pages/notes.md"))).toBe(false);
    // The vault's own are untouched, the bare `pages` included, and the
    // untouched framework skill was not rewritten.
    expect(readFileSync(join(vault, SKILLS_DIR, "ours/SKILL.md"), "utf8")).toBe("# ours");
    expect(readFileSync(join(vault, SKILLS_DIR, "pages/SKILL.md"), "utf8")).toBe("# a workspace's own pages skill");
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-sections/SKILL.md"), "utf8")).toBe("# sections v1");

    // The framework moves: the next open carries the new version.
    await writeFile(join(f.vaultSeed, ".agents/skills/biom-sections/SKILL.md"), "# sections v2");
    expect(await rewriteOwned(makeFiles(vault), ...roots)).toBe(true);
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-sections/SKILL.md"), "utf8")).toBe("# sections v2");
  } finally {
    await rm(vault, { recursive: true, force: true });
    for (const d of [f.vaultSeed, f.skill, f.lib]) await rm(d, { recursive: true, force: true });
  }
});

test("a vault directory carrying a framework skill's prefixed name holds the framework's contents after the next open", async () => {
  const f = await frameworkSkills();
  const vault = await scratch();
  await mkdir(join(vault, SKILLS_DIR, "biom-pages"), { recursive: true });
  await writeFile(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"), "# a skill somebody wrote under the framework's name");
  try {
    await rewriteOwned(makeFiles(vault), makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib));
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"), "utf8")).toBe("# pages v1");
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-pages/extra.md"), "utf8")).toBe("more on pages");
  } finally {
    await rm(vault, { recursive: true, force: true });
    for (const d of [f.vaultSeed, f.skill, f.lib]) await rm(d, { recursive: true, force: true });
  }
});

test("on a real open the skills land off the mount path, are committed once naming the framework, and the checker runs", async () => {
  const root = await scratch();
  const vault = join(root, "v");
  const host = await makeHost({
    vault,
    memory: join(root, "vaults.json"),
    presets: join(HERE, "presets"),
    vaultSeed: join(HERE, "vault"),
    skill: join(HERE, "skill"),
    checkerLib: HERE,
  });
  try {
    await host.settled(vault);
    // Every skill the framework ships, byte for byte.
    const shipped = join(HERE, "vault", SKILLS_DIR);
    for (const rel of ["biom-pages/SKILL.md", "biom-sections/SKILL.md", "biom-plugins/SKILL.md"]) {
      expect(readFileSync(join(vault, SKILLS_DIR, rel), "utf8")).toBe(readFileSync(join(shipped, rel), "utf8"));
    }
    expect(readFileSync(join(vault, SKILLS_DIR, "check.ts"), "utf8")).toBe(readFileSync(join(HERE, "skill/check.ts"), "utf8"));
    // One commit, naming the framework.
    const { spawnSync } = await import("node:child_process");
    const log = spawnSync("git", ["log", "--format=%s"], { cwd: vault, encoding: "utf8" }).stdout;
    expect(log).toContain("The framework's guide, docs, skills and checker, as framework ");
    expect(log.split("\n").filter((l) => l.includes("skills and checker")).length).toBe(1);
    // And the copy RUNS, which is the assertion that has caught a copied
    // checker before: it imports through `_lib/`, and a vault has no `contracts/`.
    const ran = spawnSync("bun", ["run", join(SKILLS_DIR, "check.ts"), "pages/home"], { cwd: vault, encoding: "utf8" });
    expect(ran.stderr + ran.stdout).not.toContain("Cannot find module");
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a copy under a skill's OLD name, unedited, goes on open; an edited one stays and the log says so", async () => {
  // A vault seeded before the framework's skills wore `biom-` holds `pages/`;
  // the rewrite puts `biom-pages/` beside it. Unedited, the old one is the
  // framework's to take back, and it is recognised by the old path's hashes,
  // which the rename left in history.
  const f = await frameworkSkills();
  const vault = await scratch();
  await mkdir(join(vault, SKILLS_DIR, "pages"), { recursive: true });
  await writeFile(join(vault, SKILLS_DIR, "pages/SKILL.md"), "# pages v0, as it shipped once");
  await mkdir(join(vault, SKILLS_DIR, "sections"), { recursive: true });
  await writeFile(join(vault, SKILLS_DIR, "sections/SKILL.md"), "# sections v0, with my notes");
  const shipped = {
    [`vault/${SKILLS_DIR}/pages/SKILL.md`]: [blobHash("# pages v0, as it shipped once")],
    [`vault/${SKILLS_DIR}/sections/SKILL.md`]: [blobHash("# sections v0")],
  };
  try {
    await rewriteOwned(makeFiles(vault), makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib));
    expect(await sweepOldSkills(makeFiles(vault), makeFiles(f.vaultSeed), shipped)).toEqual([`${SKILLS_DIR}/pages`]);
    expect(existsSync(join(vault, SKILLS_DIR, "pages"))).toBe(false);
    expect(existsSync(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"))).toBe(true);
    // Edited: kept, under a name the framework no longer uses.
    expect(readFileSync(join(vault, SKILLS_DIR, "sections/SKILL.md"), "utf8")).toBe("# sections v0, with my notes");
    expect(existsSync(join(vault, SKILLS_DIR, "biom-sections/SKILL.md"))).toBe(true);
    // Nothing to sweep the second time.
    expect(await sweepOldSkills(makeFiles(vault), makeFiles(f.vaultSeed), shipped)).toEqual([]);
  } finally {
    await rm(vault, { recursive: true, force: true });
    for (const d of [f.vaultSeed, f.skill, f.lib]) await rm(d, { recursive: true, force: true });
  }
});

/* ══ the guide ═══════════════════════════════════════════════════════════ */

test("a fresh vault has the framework's AGENTS.md and the person's INSTRUCTIONS.md, and the first line of one names the other", async () => {
  const root = await scratch();
  const vault = join(root, "v");
  const host = await makeHost({
    vault,
    memory: join(root, "vaults.json"),
    presets: join(HERE, "presets"),
    vaultSeed: join(HERE, "vault"),
    skill: join(HERE, "skill"),
    checkerLib: HERE,
  });
  try {
    await host.settled(vault);
    const guide = readFileSync(join(vault, AGENTS), "utf8");
    expect(guide).toBe(readFileSync(join(HERE, "vault", AGENTS), "utf8"));
    expect(guide.split("\n")[0]).toContain(`[${INSTRUCTIONS}](${INSTRUCTIONS})`);
    expect(guide.split("\n")[0]).toContain("rewritten every time the workspace opens");
    // The stub is the seeder's, filled once, and says whose it is.
    const mine = readFileSync(join(vault, INSTRUCTIONS), "utf8");
    expect(mine).toBe(readFileSync(join(HERE, "vault", INSTRUCTIONS), "utf8"));
    expect(mine).toContain("the framework never touches it");
    // And the docs are the framework's too, rewritten with the guide.
    expect(readFileSync(join(vault, "docs/pages.md"), "utf8")).toBe(readFileSync(join(HERE, "vault/docs/pages.md"), "utf8"));
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an edited AGENTS.md is renamed to INSTRUCTIONS.md and the framework's written in its place; an unedited one is simply rewritten", async () => {
  const f = await frameworkSkills();
  const vault = await scratch();
  const theirs = "# Our company\n\nEverything we know, and how we write it.\n";
  await writeFile(join(vault, AGENTS), theirs);
  try {
    const roots = [makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib)] as const;
    // Edited — nothing in `shipped` matches it — so it moves across, whole.
    expect(await rewriteOwned(makeFiles(vault), ...roots, {})).toBe(true);
    expect(readFileSync(join(vault, INSTRUCTIONS), "utf8")).toBe(theirs);
    expect(readFileSync(join(vault, AGENTS), "utf8")).toBe("# the guide");
    // Next open: both present, the guide is current, nothing moves.
    expect(await rewriteOwned(makeFiles(vault), ...roots, {})).toBe(false);
    expect(readFileSync(join(vault, INSTRUCTIONS), "utf8")).toBe(theirs);

    // An UNEDITED old guide — a version the framework shipped — is rewritten
    // and never moved: there is nothing of the person's in it.
    await writeFile(join(vault, AGENTS), "# the guide, as it shipped once");
    await rm(join(vault, INSTRUCTIONS));
    const shipped = { [`vault/${AGENTS}`]: [blobHash("# the guide, as it shipped once")] };
    expect(await rewriteOwned(makeFiles(vault), ...roots, shipped)).toBe(true);
    expect(readFileSync(join(vault, AGENTS), "utf8")).toBe("# the guide");
    expect(existsSync(join(vault, INSTRUCTIONS))).toBe(false);
  } finally {
    await rm(vault, { recursive: true, force: true });
    for (const d of [f.vaultSeed, f.skill, f.lib]) await rm(d, { recursive: true, force: true });
  }
});

test("the seeded stub does not count as the person's INSTRUCTIONS.md, so an edited guide still moves across on the first open", async () => {
  // The order on a real open: the seeder fills the stub on the mount path,
  // then the rewrite meets the edited guide with the stub already beside it.
  const f = await frameworkSkills();
  await writeFile(join(f.vaultSeed, INSTRUCTIONS), "# the stub");
  const vault = await scratch();
  await writeFile(join(vault, AGENTS), "# mine, edited");
  await writeFile(join(vault, INSTRUCTIONS), "# the stub");
  try {
    expect(await rewriteOwned(makeFiles(vault), makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib), {})).toBe(true);
    expect(readFileSync(join(vault, INSTRUCTIONS), "utf8")).toBe("# mine, edited");
    expect(readFileSync(join(vault, AGENTS), "utf8")).toBe("# the guide");
  } finally {
    await rm(vault, { recursive: true, force: true });
    for (const d of [f.vaultSeed, f.skill, f.lib]) await rm(d, { recursive: true, force: true });
  }
});

test("an edited AGENTS.md beside an INSTRUCTIONS.md that already exists is left alone, because two files cannot be made one without reading them", async () => {
  const f = await frameworkSkills();
  const vault = await scratch();
  await writeFile(join(vault, AGENTS), "# mine, edited");
  await writeFile(join(vault, INSTRUCTIONS), "# also mine");
  try {
    await rewriteOwned(makeFiles(vault), makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib), {});
    expect(readFileSync(join(vault, AGENTS), "utf8")).toBe("# mine, edited");
    expect(readFileSync(join(vault, INSTRUCTIONS), "utf8")).toBe("# also mine");
    // The skills beside it were still written: one unit's refusal is not another's.
    expect(existsSync(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"))).toBe(true);
  } finally {
    await rm(vault, { recursive: true, force: true });
    for (const d of [f.vaultSeed, f.skill, f.lib]) await rm(d, { recursive: true, force: true });
  }
});

test("a doc the framework ships is rewritten on open, and a doc it does not ship is left where it stands", async () => {
  const seed = await frameworkWith({ "AGENTS.md": "# g", "docs/pages.md": "# pages doc v2", "docs/README.md": "# readme" });
  const vault = await scratch();
  await mkdir(join(vault, "docs/plugins"), { recursive: true });
  await writeFile(join(vault, "docs/pages.md"), "# pages doc v1, with a note somebody typed");
  await writeFile(join(vault, "docs/mine.md"), "# a doc of the workspace's own");
  await writeFile(join(vault, "docs/plugins/markdown.js"), "// the mirror, not a doc");
  try {
    expect(await rewriteOwned(makeFiles(vault), makeFiles(seed))).toBe(true);
    expect(readFileSync(join(vault, "docs/pages.md"), "utf8")).toBe("# pages doc v2");
    expect(readFileSync(join(vault, "docs/README.md"), "utf8")).toBe("# readme");
    expect(readFileSync(join(vault, "docs/mine.md"), "utf8")).toBe("# a doc of the workspace's own");
    expect(readFileSync(join(vault, "docs/plugins/markdown.js"), "utf8")).toBe("// the mirror, not a doc");
  } finally {
    await rm(vault, { recursive: true, force: true });
    await rm(seed, { recursive: true, force: true });
  }
});
