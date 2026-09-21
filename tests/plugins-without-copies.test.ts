// SPDX-License-Identifier: AGPL-3.0-only
// PLUGINS WITHOUT COPIES — the framework's plugins as the rung under a vault's
// own, rather than a copy seeded into it.
//
// Three pieces, and each is a property a page's author can feel:
//
//   · THE RUNG. The loader's one script is the framework's plugin folders and
//     then the vault's own, every folder at every depth. A vault folder wearing
//     `biom-` is an EXTENSION — it holds `extensions.yaml` and nothing else — so
//     nothing in a vault ever shadows a framework file by name: a script or a
//     document under such a folder is refused, and the per-file route never
//     answers one. There are no file-based overrides; a workspace that wants a
//     document of its own writes one under a bare name.
//
//   · WHAT THE VAULT HOLDS UNDER ITS OWN NAMES STAYS. A copy of a framework
//     document under a bare name, a loose script, a skill under a name the
//     framework no longer uses: the framework cannot tell an edit from a stale
//     seed and does not try, so nothing of the vault's is ever removed. Whoever
//     owns the folder deletes what they do not want; a bare-named copy draws
//     until they do, and a loose script is refused in words until it is moved.
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
import { AGENTS, INSTRUCTIONS, MIRROR_DIR, SKILL_PREFIX, SKILLS_DIR, mirrorPlugins, rewriteOwned } from "../server/workspace/framework.ts";
import { OURS, frameworkPlugin } from "../server/domain/pages.ts";
import { OURS as WALK_OURS } from "../server/domain/plugins.ts";
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
  // A page plugin's script — the board, the map — is in the bundle and asks the
  // document for its root node before it does anything; here there is none,
  // so it finds nothing and does nothing, which is the guard working.
  glob.document = { currentScript: null, getElementById: () => null };
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

test("the bundle is the framework's folders and then the vault's own, and a vault folder wearing biom- extends rather than shadows", async () => {
  // AN INVENTED FRAMEWORK, spelled the way the real one is: every folder and
  // every id wears `biom-`. The vault extends one of them with a rung, drops a
  // script into that same folder — which is a copy by another name and is
  // refused — writes a `markdown` of its own under the bare name, which the
  // prefix exists to leave free, and adds a plugin of its own.
  const framework = await frameworkWith({
    "biom-markdown/markdown.js": plugin("biom-markdown"),
    "biom-table/table.js": plugin("biom-table"),
    "biom-reveal/reveal.js": plugin("biom-reveal"),
    "biom-doc/index.html": "<!doctype html>",
  });
  const vault = await scratch();
  await mkdir(join(vault, "plugins/biom-table"), { recursive: true });
  await mkdir(join(vault, "plugins/markdown"), { recursive: true });
  await mkdir(join(vault, "plugins/board"), { recursive: true });
  await writeFile(join(vault, "plugins/biom-table/extensions.yaml"), "dense: true\n");
  await writeFile(join(vault, "plugins/biom-table/table.js"), plugin("biom-table"));
  await writeFile(join(vault, "plugins/markdown/markdown.js"), plugin("markdown"));
  await writeFile(join(vault, "plugins/board/board.js"), plugin("board"));
  try {
    const bundle = await (await pluginBundle(vault, makeFiles(framework))).text();
    // FRAMEWORK FIRST, so a vault plugin that `ctx.use`s a framework one finds
    // it registered; the vault's after. ONE `biom-table`: the framework's,
    // because the vault's script under the extension folder never entered the
    // script — it was refused by name. And `markdown` beside `biom-markdown`:
    // two ids, no refusal, and the bare name reaches the vault's.
    const { took, said } = run(bundle);
    expect(took).toEqual(["biom-markdown", "biom-reveal", "biom-table", "board", "markdown"]);
    expect(said).toEqual(["plugins/biom-table/ extends the framework's biom-table and may hold extensions.yaml alone — plugins/biom-table/table.js is refused"]);
    expect(bundle).toContain("/* framework/biom-reveal/reveal.js */");
    expect(bundle).toContain("/* framework/biom-table/table.js */");
    expect(bundle).toContain('fail("biom-table/table.js", "plugins"');
    expect(bundle).not.toContain('file("biom-table/table.js", "plugins"');
    expect(bundle).toContain("/* plugins/markdown/markdown.js */");
    expect(bundle).toContain("/* plugins/board/board.js */");
    expect(bundle.indexOf("/* framework/biom-reveal/reveal.js */")).toBeLessThan(bundle.indexOf("/* plugins/board/board.js */"));
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("a broken plugin is named by the root it came from, so a reader knows which copy to open", async () => {
  const framework = await frameworkWith({ "biom-fine/fine.js": plugin("biom-fine"), "biom-cracked/cracked.js": `(function () { throw new Error("framework side"); })();` });
  const vault = await scratch();
  await mkdir(join(vault, "plugins/mine"), { recursive: true });
  await writeFile(join(vault, "plugins/mine/mine.js"), `(function () { throw new Error("vault side"); })();`);
  try {
    const { took, said } = run(await (await pluginBundle(vault, makeFiles(framework))).text());
    expect(took).toEqual(["biom-fine"]);
    expect(said.find((m) => m.includes("framework side"))).toContain("framework/biom-cracked/cracked.js did not load");
    expect(said.find((m) => m.includes("vault side"))).toContain("plugins/mine/mine.js did not load");
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("a vault with no plugins at all is drawn by the framework's set, and no folder is made for it", async () => {
  const framework = await frameworkWith({ "biom-markdown/markdown.js": plugin("biom-markdown"), "biom-html/html.js": plugin("biom-html") });
  const vault = await scratch();
  try {
    const answer = await pluginBundle(vault, makeFiles(framework));
    expect(answer.status).toBe(200);
    expect(run(await answer.text()).took).toEqual(["biom-html", "biom-markdown"]);
    expect(existsSync(join(vault, "plugins"))).toBe(false);
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("the bundle is rebuilt when a FRAMEWORK plugin changes, so editing guest/plugins/ and reloading is live", async () => {
  const framework = await frameworkWith({ "biom-one/one.js": plugin("biom-one") });
  const vault = await scratch();
  try {
    const first = await (await pluginBundle(vault, makeFiles(framework))).text();
    expect(await (await pluginBundle(vault, makeFiles(framework))).text()).toBe(first);
    await writeFile(join(framework, "biom-one/one.js"), plugin("biom-renamed"));
    expect(run(await (await pluginBundle(vault, makeFiles(framework))).text()).took).toEqual(["biom-renamed"]);
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

/* ══ per file, through the route ═════════════════════════════════════════ */

test("the per-file route answers a vault's bare-named plugin's files, the framework's for the rest, and never a vault file under a biom- folder", async () => {
  // `plugins/biom-kanban/index.html` dropped into a vault is a copy by another
  // name: the folder is an extension and holds a rung alone, so the route
  // answers the FRAMEWORK'S document and the copy never draws. A vault
  // plugin under a bare name is the vault's own and answers as such.
  const framework = await frameworkWith({ "biom-kanban/index.html": "<!doctype html><title>theirs</title>", "biom-kanban/kanban.js": "// the framework's board" });
  const vault = await scratch();
  await mkdir(join(vault, "plugins/biom-kanban"), { recursive: true });
  await mkdir(join(vault, "plugins/kanban"), { recursive: true });
  await writeFile(join(vault, "plugins/biom-kanban/index.html"), "<!doctype html><title>copy</title>");
  await writeFile(join(vault, "plugins/kanban/index.html"), "<!doctype html><title>mine</title>");
  try {
    const root = makeFiles(framework);
    // The framework's, whatever the vault dropped under the prefixed name.
    const doc = await pluginFile("biom-kanban/index.html", vault, root);
    expect(doc.status).toBe(200);
    expect(await doc.text()).toContain("theirs");
    const script = await pluginFile("biom-kanban/kanban.js", vault, root);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(await script.text()).toBe("// the framework's board");
    // The vault's own, under its bare name.
    expect(await (await pluginFile("kanban/index.html", vault, root)).text()).toContain("mine");
    // Nobody has it: a 404, not a fall past the framework into the install.
    expect((await pluginFile("nothing/here.js", vault, root)).status).toBe(404);
    // And the route is what the frame spells, so a tag resolves to it.
    expect(`${vaultBase(vault)}${PLUGIN_DIR_ROUTE}`.endsWith("/plugin/")).toBe(true);
  } finally {
    await rm(framework, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

/* ══ what the vault holds stays ══════════════════════════════════════════ */

test("what a vault holds under plugins/ stays on open, whatever it is; a bare-named document copy draws, and a loose script is refused in words", async () => {
  const root = await scratch();
  const vault = join(root, "v");
  await mkdir(join(vault, "pages/home"), { recursive: true });
  await writeFile(join(vault, "pages/home/content.yaml"), "name: Home\nplugin: doc\ncontents: []\n");
  await mkdir(join(vault, "plugins/doc"), { recursive: true });
  // A seeded copy that fell behind, a copy somebody edited, a document copied
  // under a bare name, and a file the framework never shipped: the framework
  // cannot tell the first two apart and does not try, so all four are the
  // vault's and none of them moves.
  const stale = "// markdown, as it shipped once";
  const edited = "// markdown — but mine";
  const oldDoc = "<!doctype html><title>old doc</title>";
  await writeFile(join(vault, "plugins/markdown.js"), stale);
  await writeFile(join(vault, "plugins/html.js"), edited);
  await writeFile(join(vault, "plugins/doc/index.html"), oldDoc);
  await writeFile(join(vault, "plugins/board.js"), "// this vault's own");
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
    expect(readFileSync(join(vault, "plugins/markdown.js"), "utf8")).toBe(stale);
    expect(readFileSync(join(vault, "plugins/html.js"), "utf8")).toBe(edited);
    expect(readFileSync(join(vault, "plugins/doc/index.html"), "utf8")).toBe(oldDoc);
    expect(readFileSync(join(vault, "plugins/board.js"), "utf8")).toBe("// this vault's own");
    // The vault's document under the bare name is a plugin of the vault's own,
    // so it is what draws — the stale copy included. That is the breaking
    // change, and the person's to fix by deleting the copy. The loose scripts
    // are the old shape: not loaded, and said so, naming the folder each goes
    // into.
    const deps = await host.deps(vault);
    expect((await deps.pages.read("home"))!.html).toBe(oldDoc);
    const { said } = run(await (await pluginBundle(vault, host.pluginRoot)).text());
    expect(said).toContain("plugins/markdown.js is a loose script — a plugin is a folder: move it into plugins/markdown/");
    expect(said).toContain("plugins/board.js is a loose script — a plugin is a folder: move it into plugins/board/");
    // And the background work left no commit about plugins: nothing of the
    // vault's was touched, so there was nothing to say.
    const { spawnSync } = await import("node:child_process");
    const log = spawnSync("git", ["log", "--format=%s"], { cwd: vault, encoding: "utf8" }).stdout;
    expect(log).not.toContain("plugin copies");
    // What the person can read is current all the same.
    expect(readFileSync(join(vault, MIRROR_DIR, "biom-markdown/markdown.js"), "utf8")).toBe(readFileSync(join(SEED, "biom-markdown/markdown.js"), "utf8"));
  } finally {
    host.close();
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
    expect(log.split("\n").filter((l) => l.startsWith("The framework's guide")).length).toBe(1);
    // And no commit before it: a fresh vault was committed as seeded on the
    // mount path, so there was nothing for the rewrite to keep first.
    expect(log).not.toContain("Before the framework's");
    // And the copy RUNS, which is the assertion that has caught a copied
    // checker before: it imports through `_lib/`, and a vault has no `contracts/`.
    const ran = spawnSync("bun", ["run", join(SKILLS_DIR, "check.ts"), "pages/home"], { cwd: vault, encoding: "utf8" });
    expect(ran.stderr + ran.stdout).not.toContain("Cannot find module");
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a copy under a skill's OLD name stays beside the framework's biom- one, whatever it holds", async () => {
  // A vault seeded before the framework's skills wore `biom-` holds `pages/`;
  // the rewrite puts `biom-pages/` beside it and leaves the old one where it
  // stands — it is under a name the framework no longer uses, so it is the
  // workspace's now, and the workspace deletes it.
  const f = await frameworkSkills();
  const vault = await scratch();
  await mkdir(join(vault, SKILLS_DIR, "pages"), { recursive: true });
  await writeFile(join(vault, SKILLS_DIR, "pages/SKILL.md"), "# pages v0, as it shipped once");
  await mkdir(join(vault, SKILLS_DIR, "sections"), { recursive: true });
  await writeFile(join(vault, SKILLS_DIR, "sections/SKILL.md"), "# sections v0, with my notes");
  try {
    expect(await rewriteOwned(makeFiles(vault), makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib))).toBe(true);
    expect(readFileSync(join(vault, SKILLS_DIR, "pages/SKILL.md"), "utf8")).toBe("# pages v0, as it shipped once");
    expect(readFileSync(join(vault, SKILLS_DIR, "sections/SKILL.md"), "utf8")).toBe("# sections v0, with my notes");
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-pages/SKILL.md"), "utf8")).toBe("# pages v1");
    expect(readFileSync(join(vault, SKILLS_DIR, "biom-sections/SKILL.md"), "utf8")).toBe("# sections v1");
    // The second open changes nothing and says so.
    expect(await rewriteOwned(makeFiles(vault), makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib))).toBe(false);
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

test("an AGENTS.md of the person's own is written over with the framework's, committed first, and INSTRUCTIONS.md beside it is never touched", async () => {
  // A vault from before `AGENTS.md` was the framework's holds a guide somebody
  // wrote. It is rewritten like any unit — no history is read to decide whose
  // it is — but the vault is committed before the first write, so what stood
  // there is one `git show` away and the person moves it across by hand.
  const f = await frameworkSkills();
  const root = await scratch();
  const vault = join(root, "v");
  await mkdir(vault, { recursive: true });
  const { initVault } = await import("../server/platform/files.ts");
  await initVault(vault);
  const theirs = "# Our company\n\nEverything we know, and how we write it.\n";
  await writeFile(join(vault, AGENTS), theirs);
  await writeFile(join(vault, INSTRUCTIONS), "# also mine");
  try {
    const roots = [makeFiles(f.vaultSeed), makeFiles(f.skill), makeFiles(f.lib)] as const;
    expect(await rewriteOwned(makeFiles(vault), ...roots)).toBe(true);
    expect(readFileSync(join(vault, AGENTS), "utf8")).toBe("# the guide");
    expect(readFileSync(join(vault, INSTRUCTIONS), "utf8")).toBe("# also mine");
    const { spawnSync } = await import("node:child_process");
    const git = (...args: string[]) => spawnSync("git", args, { cwd: vault, encoding: "utf8" }).stdout;
    expect(git("log", "--format=%s")).toContain("Before the framework's guide, docs, skills and checker are rewritten");
    expect(git("show", `HEAD:${AGENTS}`)).toBe(theirs);
    // Next open: the guide is current, nothing is written and nothing is committed.
    expect(await rewriteOwned(makeFiles(vault), ...roots)).toBe(false);
    expect(git("log", "--format=%s").split("\n").filter((l) => l.startsWith("Before the framework's")).length).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
    for (const d of [f.vaultSeed, f.skill, f.lib]) await rm(d, { recursive: true, force: true });
  }
});

test("a doc the framework ships is rewritten on open, and a doc it does not ship is left where it stands", async () => {
  const seed = await frameworkWith({ "AGENTS.md": "# g", "docs/pages.md": "# pages doc v2", "docs/README.md": "# readme" });
  const vault = await scratch();
  await mkdir(join(vault, "docs/plugins"), { recursive: true });
  await writeFile(join(vault, "docs/pages.md"), "# pages doc v1, with a note somebody typed");
  await writeFile(join(vault, "docs/mine.md"), "# a doc of the workspace's own");
  await writeFile(join(vault, "docs/plugins/biom-markdown.js"), "// the mirror, not a doc");
  try {
    expect(await rewriteOwned(makeFiles(vault), makeFiles(seed))).toBe(true);
    expect(readFileSync(join(vault, "docs/pages.md"), "utf8")).toBe("# pages doc v2");
    expect(readFileSync(join(vault, "docs/README.md"), "utf8")).toBe("# readme");
    expect(readFileSync(join(vault, "docs/mine.md"), "utf8")).toBe("# a doc of the workspace's own");
    expect(readFileSync(join(vault, "docs/plugins/biom-markdown.js"), "utf8")).toBe("// the mirror, not a doc");
  } finally {
    await rm(vault, { recursive: true, force: true });
    await rm(seed, { recursive: true, force: true });
  }
});

/* ══ the prefix, on both sides of the wall ═══════════════════════════════ */

test("every framework plugin wears biom-, folder and id, and the prefix is spelled the same on every side of the wall", () => {
  // The registry's copy — the box has no import graph to reach the server's
  // through — the server's, and the folder walk's, held equal here so the
  // halves of one nearest-first lookup cannot drift. And the skills' prefix is
  // the same word.
  const registry = readFileSync(join(HERE, "guest/runtime/registry.js"), "utf8");
  const spelled = /const OURS = "([^"]+)";/.exec(registry);
  expect(spelled?.[1]).toBe(OURS);
  expect(SKILL_PREFIX).toBe(OURS);
  expect(WALK_OURS).toBe(OURS);
  // Every entry in guest/plugins/ is a FOLDER wearing it, and a script directly
  // inside that registers a plugin registers the folder's own id — an inner
  // plugin, under the folder's `plugins/`, is free to register what it likes.
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  for (const entry of readdirSync(SEED, { withFileTypes: true })) {
    expect([entry.name, entry.isDirectory(), entry.name.startsWith(OURS)]).toEqual([entry.name, true, true]);
    for (const file of readdirSync(join(SEED, entry.name), { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".js")) continue;
      const id = /id:\s*"([^"]+)"/.exec(readFileSync(join(SEED, entry.name, file.name), "utf8"))?.[1];
      if (id !== undefined) expect([entry.name, file.name, id]).toEqual([entry.name, file.name, entry.name]);
    }
  }
  // A page's bare name falls back to the prefixed document; a prefixed one is itself.
  expect(frameworkPlugin("doc")).toBe("biom-doc/index.html");
  expect(frameworkPlugin("biom-doc")).toBe("biom-doc/index.html");
});

test("a bare id in the box resolves nearest-first: the workspace's own, then the framework's biom- one", () => {
  const glob = globalThis as any;
  const had = { rt: glob.__gRuntime, biom: glob.biom, doc: glob.document };
  const said: string[] = [];
  glob.__gRuntime = { report: (m: string) => said.push(m) };
  delete glob.biom;
  glob.document = { currentScript: null };
  try {
    new Function(REGISTRY)();
    const rt = glob.__gRuntime;
    // The framework's markdown, from its own folder.
    rt.pluginRoot = "framework";
    rt.pluginFile = "biom-markdown/markdown.js";
    expect(rt.plugins.register({ id: "biom-markdown", mount() {}, edit: true })).toBe(true);
    // A bare `markdown` slot reaches it.
    expect(rt.plugins.has("markdown")).toBe(true);
    expect(rt.plugins.get("markdown").id).toBe("biom-markdown");
    // The workspace writes its own, from the one folder that may: now the bare
    // name is the workspace's and the prefixed one is still the framework's.
    rt.pluginRoot = "plugins";
    rt.pluginFile = "markdown/markdown.js";
    expect(rt.plugins.register({ id: "markdown", mount() {} })).toBe(true);
    expect(rt.plugins.get("markdown").id).toBe("markdown");
    expect(rt.plugins.get("biom-markdown").id).toBe("biom-markdown");
    // The prefixed part kind is reserved to its folder exactly as the bare one
    // is — and a vault script may not wear the prefix at all, which is the
    // refusal it meets first.
    rt.pluginFile = "a-notes/a-notes.js";
    expect(rt.plugins.register({ id: "biom-table", mount() {} })).toBe(false);
    expect(said[said.length - 1]).toContain("wears the framework's prefix");
    rt.pluginRoot = "framework";
    expect(rt.plugins.register({ id: "biom-table", mount() {} })).toBe(false);
    expect(said[said.length - 1]).toContain("only framework/biom-table/ draws it");
    // A prefixed lookup never falls back the other way.
    expect(rt.plugins.has("biom-flow")).toBe(false);
    rt.pluginRoot = "plugins";
    rt.pluginFile = "flow/flow.js";
    expect(rt.plugins.register({ id: "flow", mount() {} })).toBe(true);
    expect(rt.plugins.has("biom-flow")).toBe(false);
    expect(rt.plugins.has("flow")).toBe(true);
    // The reading side says where each came from.
    expect(rt.plugin.list().map((p: any) => [p.id, p.root])).toEqual([["biom-markdown", "framework"], ["markdown", "vault"], ["flow", "vault"]]);
    expect(rt.plugin.get("markdown")).toBe(rt.plugins.get("markdown"));
  } finally {
    glob.__gRuntime = had.rt;
    glob.biom = had.biom;
    glob.document = had.doc;
  }
});
