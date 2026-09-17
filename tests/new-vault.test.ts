// SPDX-License-Identifier: AGPL-3.0-only
// A NEW VAULT — where a workspace comes from, and what is in it when it arrives.
//
// Two halves of one sentence, and this file is both.
//
//   · A VAULT HOLDS ONLY THE PLUGINS IT WROTE OR OVERRODE. The framework's own
//     set is the FALLBACK RUNG: a page's document and a slot plugin are read
//     from `<vault>/plugins/` first and from `guest/plugins/` second, so a fresh
//     vault has an empty `plugins/` and draws everything, a vault file at the
//     framework's path replaces the framework's by being there, and deleting
//     that file is how the framework's takes over again. What a person can READ
//     is the mirror the server writes into `docs/plugins/` on every open; what
//     they can CHANGE is a copy of it in `plugins/`. Nothing is seeded into
//     `plugins/`, so nothing in it can fall behind.
//
//   · A FIRST LAUNCH MOUNTS NOTHING, and a new workspace is a parent folder plus
//     a typed name. The ancestor walk is the expensive half to get wrong: a
//     parent-only check passes on a folder four levels inside somebody's page
//     tree, and what comes back from that is two databases, two mirrors and two
//     git repositories over one set of files.
//
// Fixtures are invented and say so.

import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { locate, makeHost } from "../server/main.ts";
import { ancestorVault, checkName, creatable, createVault } from "../server/workspace/vault.ts";
import { weaveRuntime } from "../client/platform/document.js";
import { whyNot } from "../client/views/vault.js";
import { vaultBase } from "../contracts/wire.js";

const HERE = join(import.meta.dir, "..");
const SEED = join(HERE, "guest/plugins");

/** A throwaway directory, and the whole of it goes afterwards. */
async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "biom-new-vault-"));
}

/** A host over `vault`, with every seed root the real composition root uses.
 *  `memory` is inside the scratch directory so a test never writes the
 *  developer's own remembered list. */
async function hostAt(root: string, vault?: string) {
  return await makeHost({
    vault,
    memory: join(root, "vaults.json"),
    presets: join(HERE, "presets"),
    vaultSeed: join(HERE, "vault"),
    skill: join(HERE, "skill"),
    checkerLib: HERE,
  });
}

/** Every file under a directory, vault-relative, forward-slashed. */
function filesUnder(at: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(join(at, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/* ══ every plugin is a file in the vault ═════════════════════════════════ */

test("an empty folder gets NO plugins of its own, and every page in it still draws", async () => {
  const root = await scratch();
  const vault = join(root, "fresh");
  const host = await hostAt(root, vault);
  try {
    await host.settled(vault);
    // NOTHING IN `plugins/`. The framework's set is the rung underneath, not a
    // copy in the folder — a copy is what a person makes when they want to
    // change one, and a copy nobody asked for is a copy that goes stale.
    expect(existsSync(join(vault, "plugins"))).toBe(false);

    // And a page draws: the root the vault is born with, which is its own
    // document, and a doc page made after it, whose document is the framework's
    // `doc` read through the fallback rung. The design doc reads the same rung.
    const deps = await host.deps(vault);
    const [root0] = await deps.pages.list();
    expect((await deps.pages.read(root0!.id))!.html).not.toContain("Nothing draws this page");
    const made = await deps.pages.create({ parent: root0!.id, name: "Notes" });
    const drawn = (await deps.pages.read(made.id))!.html;
    expect(drawn).not.toContain("Nothing draws this page");
    expect(drawn).toBe(readFileSync(join(SEED, "biom-doc/index.html"), "utf8"));
    expect((await deps.design.read()).html).toBe(readFileSync(join(SEED, "biom-doc/index.html"), "utf8"));

    // WHAT A PERSON CAN READ IS THE MIRROR, and it is the whole set, byte for
    // byte what draws their page — written out of the same root the rung reads.
    expect(filesUnder(join(vault, "docs/plugins"))).toEqual(filesUnder(SEED));
    for (const rel of filesUnder(SEED)) {
      expect(readFileSync(join(vault, "docs/plugins", rel), "utf8")).toBe(readFileSync(join(SEED, rel), "utf8"));
    }
    // Kept out of the vault's history: a framework release rewrites every file
    // in it, and that is not a diff anybody asked for.
    expect(readFileSync(join(vault, ".gitignore"), "utf8")).toContain("docs/plugins/");

    // AND MERMAID IS NOT AMONG THEM. The whole point of this format is a CUSTOM
    // drawing — a figure is HTML a section writes, and a diagram of
    // relationships is that same drawing — so the framework ships no diagram
    // library and no plugin that reaches one. A workspace that wants mermaid
    // puts its own `plugins/mermaid.js` in, and the markdown plugin hands it the
    // fence exactly as it would any other registered name.
    for (const rel of filesUnder(SEED)) {
      expect([rel, readFileSync(join(SEED, rel), "utf8").includes("mermaid")]).toEqual([rel, false]);
    }
    // NO FRAMEWORK PLUGIN MAY NAME `/guest/`. It is served under the vault's
    // own route now, behind the vault's own files, and a path into an install
    // directory is wrong the first time the application moves.
    for (const rel of filesUnder(SEED)) {
      expect(readFileSync(join(SEED, rel), "utf8")).not.toContain("/guest/");
    }
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the seeded guide teaches the CUSTOM drawing, and names no diagram library", async () => {
  // THE OTHER HALF OF UNSHIPPING ONE. A workspace's guide is what an agent reads
  // before it writes a page, so a passage still saying a diagram is somebody
  // else's fence is a passage that produces exactly the page this format stopped
  // shipping for — and it is invisible to every test about `plugins/`.
  //
  // The one spelling that survives is the RETIRED EXTENSION: `.mermaid` beside a
  // `content.yaml` is one of the two files the old format left behind, the
  // checker reports it by name, and the guide has to go on saying so.
  const root = await scratch();
  const vault = join(root, "guided");
  const host = await hostAt(root, vault);
  try {
    await host.settled(vault);
    for (const dir of ["docs", ".agents/skills"]) {
      for (const rel of filesUnder(join(vault, dir))) {
        // THE PROSE, which is what an agent reads. `check.ts` and the verbatim
        // copies under `_lib/` that let it run in a vault are code, and what
        // they name is the RETIRED EXTENSION — the checker reports a `.mermaid`
        // file left behind by the old format, and has to go on doing it.
        if (!rel.endsWith(".md")) continue;
        const said = readFileSync(join(vault, dir, rel), "utf8");
        expect([rel, said.replace(/\.mermaid/g, "").includes("mermaid")]).toEqual([rel, false]);
      }
    }
    const agents = readFileSync(join(vault, "AGENTS.md"), "utf8");
    expect(agents.replace(/\.mermaid/g, "")).not.toContain("mermaid");

    // AND IT SAYS WHAT A DIAGRAM IS INSTEAD, which is the half a `not.toContain`
    // cannot assert: the drawing, the starter to copy, and the words it is laid
    // out from.
    const skill = readFileSync(join(vault, ".agents/skills/biom-diagrams/SKILL.md"), "utf8");
    expect(skill).toContain("HTML elements in the section's own markup");
    expect(skill).toContain("base/diagram/");
    expect(skill).toContain("variables");
    // AND IT NO LONGER TEACHES THE ONE IT USED TO. A figure is drawn in HTML —
    // the guide an agent reads before it writes a page is the whole of how that
    // decision reaches a workspace, so a sentence still asking for vector
    // geometry produces exactly the page this format stopped asking for.
    expect(skill).not.toContain("<svg");
    expect(skill).not.toContain("viewBox");
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a vault's own plugin file wins by being there, and deleting it hands the page back to the framework's", async () => {
  // THE CASE THAT PROVES IT is this repository's own workspace, which carries
  // `plugins/doc/index.html` as a deliberate override. Nothing is copied in
  // beside it: the override is the one file in `plugins/`, and every other
  // plugin the vault's pages name is the framework's, read through the rung.
  const root = await scratch();
  const vault = join(root, "older");
  await mkdir(join(vault, "pages/home"), { recursive: true });
  await writeFile(join(vault, "pages/home/content.yaml"), "name: Home\nplugin: doc\ncontents: []\n");
  await mkdir(join(vault, "plugins/doc"), { recursive: true });
  const mine = "<!doctype html><title>mine</title><!-- the board of children -->";
  await writeFile(join(vault, "plugins/doc/index.html"), mine);

  const first = await hostAt(root, vault);
  try {
    await first.settled(vault);
    // Byte for byte what it was, and alone in the folder.
    expect(readFileSync(join(vault, "plugins/doc/index.html"), "utf8")).toBe(mine);
    expect(filesUnder(join(vault, "plugins"))).toEqual(["doc/index.html"]);
    // The override draws, because a vault file is the nearer rung.
    const deps = await first.deps(vault);
    expect((await deps.pages.read("home"))!.html).toBe(mine);
  } finally {
    first.close();
  }

  // DELETING THE OVERRIDE IS HOW YOU GO BACK. Nothing writes the file again —
  // there is no seeder — and the framework's own document draws on the next
  // read, which is what a person deleting it meant.
  await rm(join(vault, "plugins/doc/index.html"));
  const second = await hostAt(root, vault);
  try {
    await second.settled(vault);
    expect(existsSync(join(vault, "plugins/doc/index.html"))).toBe(false);
    const deps = await second.deps(vault);
    expect((await deps.pages.read("home"))!.html).toBe(readFileSync(join(SEED, "biom-doc/index.html"), "utf8"));
  } finally {
    second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the mirror in docs/plugins/ is rewritten whole on every open, so a file edited there does not survive it", async () => {
  // A MIRROR, NOT A SOURCE. Nothing reads it to draw a page, and it is thrown
  // away and written again every time the vault opens — which is the one-word
  // difference from the seeder this replaced: `fill` skipped a file that was
  // there, and that is exactly what let a copy drift.
  const root = await scratch();
  const vault = join(root, "mirrored");
  const first = await hostAt(root, vault);
  await first.settled(vault);
  first.close();
  const shown = join(vault, "docs/plugins/biom-markdown.js");
  await writeFile(shown, "// somebody typed here");
  await writeFile(join(vault, "docs/plugins/stray.js"), "// and left this");

  const second = await hostAt(root, vault);
  try {
    await second.settled(vault);
    expect(readFileSync(shown, "utf8")).toBe(readFileSync(join(SEED, "biom-markdown.js"), "utf8"));
    expect(existsSync(join(vault, "docs/plugins/stray.js"))).toBe(false);
    // And the mirror is not what draws: a page still reads the framework's own.
    expect(existsSync(join(vault, "plugins"))).toBe(false);
  } finally {
    second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("`guest/plugins/` is the fallback rung and is not served as a root of its own", () => {
  // Refused EXPLICITLY rather than by the directory being absent, because in a
  // checkout it is very much present. Two urls for one plugin would mean the one
  // a page happened to name decided whether the person's override drew or the
  // framework's did; the one url is the vault's `/plugin/` route, which answers
  // the vault's file first and the framework's second.
  expect(locate("/guest/plugins/biom-markdown.js")).toBeNull();
  expect(locate("/guest/plugins/biom-kanban/kanban.js")).toBeNull();
  // The runtime and the shim are still served from there, and must stay so: the
  // registry's `shipped` test is `document.currentScript` against `/guest/`, and
  // what it now means is "the framework's own code".
  expect(locate("/guest/runtime/registry.js")).toBe("guest/runtime/registry.js");
  expect(locate("/biom.js")).toBe("guest/biom.js");
});

/* ══ what the box loads, and where it loads it from ══════════════════════ */

test("the slot plugins are woven out of the vault, and a plugin's sibling script resolves from the same route", () => {
  const vault = "/some/where else/my vault";
  const base = `${vaultBase(vault)}/plugin/`;

  // A plugin document as it sits on disk in a vault: it names its sibling by a
  // path under `plugins/` and marks it, because it cannot name the install, has
  // no base to resolve a relative path against inside the box, and was written
  // before anybody knew which folder it landed in.
  const kanban = readFileSync(join(SEED, "biom-kanban/index.html"), "utf8");
  expect(kanban).toContain('data-g-src="biom-kanban/kanban.js"');

  const doc = weaveRuntime(kanban, { id: "home", name: "Home", plugin: "kanban", input: {} }, vault);
  expect(doc).toContain(`src="${base}biom-kanban/kanban.js"`);
  // The mark is gone from the tag; the comment above it explaining the mark is
  // the plugin author's words and stays, like every other word in their file.
  expect(doc).not.toContain("<script data-g-src");
  // ONE TAG FOR EVERY PLUGIN THIS VAULT HAS, and it names the FOLDER. The
  // document used to carry a tag per id off a list of five in
  // `client/platform/document.js`, which is exactly why a vault's own slot
  // plugin could not be loaded — it was not on the list and nothing could add it
  // to one. The server answers the folder with every `plugins/*.js` in id order,
  // so what a workspace has is read from the workspace.
  expect(doc).toContain(`<script src="${base}"></script>`);
  for (const id of ["markdown", "html", "table", "child"]) {
    expect(doc).not.toContain(`<script src="${base}${id}.js"></script>`);
  }
  // Nothing anywhere in the woven document points into the install's plugins.
  expect(doc).not.toContain("/guest/plugins/");
  // The runtime itself still does, and that is the whole of what `/guest/` means
  // from here on.
  expect(doc).toContain('<script src="/guest/runtime/boot.js"></script>');
});

test("the map's document and the mindmap plugin's own file are the same document", () => {
  // Said twice because the host cannot import `guest/` and the box cannot fetch.
  // The equality is also what keeps the copy in `client/views/page.js` honest
  // about `data-g-src`: the plugin is a file in the vault now, and neither copy
  // may name an install directory.
  const onDisk = readFileSync(join(SEED, "biom-mindmap/index.html"), "utf8");
  expect(onDisk).toContain('data-g-src="biom-mindmap/mindmap.js"');
  expect(onDisk).not.toContain("/guest/");
});

/* ══ the part kinds stay unreplaceable ═══════════════════════════════════ */

test("the runtime's part kinds are the format's, and a second plugin claiming one is refused by name", () => {
  // THE LIST IS THE FORMAT'S AND NOT THE REGISTRY'S OPINION. `PartKind` in
  // `contracts/types.ts` is the authority; the box has no import graph to reach
  // it through, so the set is said again in `registry.js` and this holds the two
  // equal — exactly as `project.js` is held equal to `contracts/projection.ts`.
  // A kind added to the format without being added there fails here, which is
  // what keeps it from being the roster that is wrong in the release where being
  // right matters.
  const types = readFileSync(join(HERE, "contracts/types.ts"), "utf8");
  const union = /export type PartKind = ([^;]+);/.exec(types);
  expect(union).not.toBeNull();
  const kinds = [...union![1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!).sort();

  const registry = readFileSync(join(HERE, "guest/runtime/registry.js"), "utf8");
  const declared = /const PART_KINDS = new Set\(\[([^\]]+)\]\)/.exec(registry);
  expect(declared).not.toBeNull();
  expect([...declared![1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!).sort()).toEqual(kinds);

  // And the behaviour that list is for. Everything is a vault file now — nothing
  // is served from `/guest/` — so what holds the name is the FILE the format
  // names: `plugins/<kind>.js` and nothing else. The loader says which file is
  // running by setting `pluginFile` around it, which is what this stands in for.
  const glob = globalThis as unknown as Record<string, unknown>;
  glob.__gRuntime = {};
  // `whereFrom` falls back to `document.currentScript` when the loader named no
  // file; there is no DOM here, so it gets the smallest stand-in that lets the
  // question be asked at all.
  glob.document = { currentScript: null };
  const said: string[] = [];
  new Function(readFileSync(join(HERE, "guest/runtime/registry.js"), "utf8"))();
  const rt = glob.__gRuntime as { plugins: any; report?: (m: string) => void; pluginFile?: string };
  rt.report = (m: string) => said.push(m);

  // The seeded `markdown.js`, or the person's own edit of it — editing the file
  // that draws your prose is the whole point of it being in the folder.
  rt.pluginFile = "markdown.js";
  expect(rt.plugins.register({ id: "markdown", mount() {}, edit: true })).toBe(true);
  expect(said).toEqual([]);

  // Any OTHER file claiming it is refused, whether it arrives before or after —
  // because what the author nearly did was replace the drawing of every markdown
  // slot in the workspace, and a file name is not a race the alphabet decides.
  rt.pluginFile = "0-notes.js";
  expect(rt.plugins.register({ id: "markdown", mount() {} })).toBe(false);
  expect(said.join("\n")).toContain("part kind");
  expect(said.join("\n")).toContain("only plugins/markdown.js draws it");

  // A plugin that is NOT a part kind is the ordinary duplicate, and the sentence
  // names both files, because the reader has two files to choose between.
  rt.pluginFile = "flow.js";
  expect(rt.plugins.register({ id: "flow", mount() {} })).toBe(true);
  rt.pluginFile = "aaa-flow.js";
  expect(rt.plugins.register({ id: "flow", mount() {} })).toBe(false);
  expect(said[said.length - 1]).toContain("plugins/flow.js has it");
  expect(said[said.length - 1]).toContain("plugins/aaa-flow.js is refused");

  delete glob.document;
});

/* ══ a first launch ══════════════════════════════════════════════════════ */

test("with nothing remembered and no VAULT, nothing is mounted and nothing is written", async () => {
  const root = await scratch();
  const host = await hostAt(root);
  try {
    expect(host.open()).toEqual([]);
    // Not even the remembered list: remembering happens on a mount, and there
    // was none.
    expect(readdirSync(root)).toEqual([]);

    // The picker is still reachable, which is the whole point of the state. The
    // three kinds that are about vaults rather than in one all answer.
    const deps = await host.deps();
    expect(await deps.vault.recent()).toEqual([]);
    expect((await deps.vault.browse()).at.length).toBeGreaterThan(0);
    // And the one that is about THIS vault does not: "which folder is this" has
    // no answer when the request did not say.
    await expect(deps.vault.info()).rejects.toThrow();
  } finally {
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ making one: the name ════════════════════════════════════════════════ */

/** EVERY STRING THE SERVER REFUSES AS A NAME, and the reason the list is here
 *  rather than inside one test: `checkName` on the server and `whyNot` in the
 *  picker are one rule said twice, and the second test below walks this same
 *  list through the client half. NUL and its neighbours are spelled as escapes —
 *  a literal control character in a source file is a character nobody reviewing
 *  it can see, and the one that used to sit in this array was exactly that. */
const REFUSED = [
  "a/b", "a\\b", ".", "..", ".hidden", "", "   ",
  // A NUL truncates the path at the system call, so what is checked and what is
  // created would be two different paths. The rest go with it: none of them is
  // a name anybody meant to type, and a pasted one is invisible in the field.
  "a\u0000b", "a\u0009b", "a\u001fb",
];

test("a name is a folder name and nothing else", async () => {
  const root = await scratch();
  try {
    expect(checkName("  Work notes  ")).toBe("Work notes");
    // Sent apart from the parent precisely so this cannot become a folder
    // somewhere else: the join is the server's.
    for (const bad of REFUSED) {
      expect(() => checkName(bad)).toThrow();
    }
    // The refusals are sentences about the NAME, and they arrive before anything
    // is written.
    await expect(creatable(root, "a/b")).rejects.toThrow(/name, not a path/);
    await expect(creatable(root, ".hidden")).rejects.toThrow(/hidden/);
    expect(readdirSync(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the picker's half of the name rule refuses everything the server's half does", () => {
  // THE CLAIM WAS WRITTEN DOWN AND NOT HELD TO. `whyNot` carried a comment
  // saying this file kept it in step with `checkName`, and no test here imported
  // it — so the two had already drifted: the server refuses every control
  // character, NUL among them, and the picker refused none. A pasted name with
  // one in it read as fine under the field and was turned away a moment later by
  // a round trip, which is the whole thing `whyNot` exists to save.
  for (const bad of REFUSED) {
    expect(whyNot(bad, [])).not.toBeNull();
  }
  // And an ordinary name passes both, trimmed the same way.
  expect(whyNot("  Work notes  ", [])).toBeNull();
  expect(checkName("  Work notes  ")).toBe("Work notes");

  // The half that is only the picker's: the listing on screen. It is a MOMENT
  // OLD, which is why it is a courtesy and `creatable` asks the disk again
  // before anything is written — and why the two sentences differ.
  expect(whyNot("taken", [{ name: "taken", path: "/w/taken", vault: true }]))
    .toMatch(/already a workspace/);
  expect(whyNot("taken", [{ name: "taken", path: "/w/taken", vault: false }]))
    .toMatch(/already a folder/);
});

/* ══ making one: the ancestor walk ═══════════════════════════════════════ */

test("a workspace can never start inside another one, at any depth", async () => {
  const root = await scratch();
  try {
    const outer = join(root, "outer");
    // A workspace is a folder with `pages/` in it — the pages are the vault, and
    // the database is a rebuildable index beside them.
    await mkdir(join(outer, "pages/home/children/Notes"), { recursive: true });

    expect(ancestorVault(outer)).toBe(outer);
    await expect(creatable(outer, "inside")).rejects.toThrow(/inside the workspace at/);

    // DEPTH CHANGES NOTHING, and this is the case a parent-only check passes: the
    // folder's own parent is `children/`, which is not a workspace, and it is
    // four levels inside one.
    const deep = join(outer, "pages/home/children/Notes");
    expect(ancestorVault(deep)).toBe(outer);
    await expect(creatable(deep, "inside")).rejects.toThrow(/inside the workspace at/);
    // The refusal NAMES the ancestor, which is the one thing the person cannot
    // see for themselves — the whole point of the walk is that it is somewhere
    // they did not look.
    await expect(creatable(deep, "inside")).rejects.toThrow(outer);

    // SIBLINGS ARE NOT ANCESTRY. A folder with three workspaces in it is the
    // ordinary case — it is what Recent is a list of.
    const shelf = join(root, "shelf");
    for (const name of ["one", "two", "three"]) await mkdir(join(shelf, name, "pages"), { recursive: true });
    expect(ancestorVault(shelf)).toBeNull();
    expect(await creatable(shelf, "four")).toBe(join(shelf, "four"));

    // AND IT TERMINATES. `dirname` at the filesystem root answers itself, which
    // is the same stop `browse`'s own `up` link uses — so a walk from anywhere
    // ends rather than looping, whether or not it finds anything.
    let at = root;
    while (dirname(at) !== at) at = dirname(at);
    expect(ancestorVault(at)).toBeNull();

    expect(readdirSync(root).sort()).toEqual(["outer", "shelf"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ making one: a name that is already taken ════════════════════════════ */

test("create never writes into something that is there, and each refusal is its own sentence", async () => {
  const root = await scratch();
  try {
    // NOTHING — the one answer Create is for.
    expect(await creatable(root, "brand new")).toBe(join(root, "brand new"));

    // A FOLDER HOLDING A WORKSPACE. The way in is Browse or Recent, not Create.
    await mkdir(join(root, "taken/pages"), { recursive: true });
    await expect(creatable(root, "taken")).rejects.toThrow(/already a workspace with that name/);

    // A FOLDER HOLDING ANYTHING ELSE, A DOTFILE INCLUDED. This is `openable`'s
    // rule and its argument — a folder with anything in it belongs to whoever
    // put that there — said before the folder is made rather than after.
    await mkdir(join(root, "theirs"));
    await writeFile(join(root, "theirs/.DS_Store"), "");
    await expect(creatable(root, "theirs")).rejects.toThrow(/not empty/);

    // AN EMPTY FOLDER. Refused too: creating a folder that exists is not what
    // the button says, and the way in is Open.
    await mkdir(join(root, "empty"));
    await expect(creatable(root, "empty")).rejects.toThrow(/already an empty folder/);

    // A FILE.
    await writeFile(join(root, "notes.txt"), "invented, and says so");
    await expect(creatable(root, "notes.txt")).rejects.toThrow(/already a file/);

    // And every one of those is untouched afterwards.
    expect(readdirSync(join(root, "theirs"))).toEqual([".DS_Store"]);
    expect(readdirSync(join(root, "empty"))).toEqual([]);
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("invented, and says so");
    expect(existsSync(join(root, "brand new"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("what create makes is an ordinary folder, and opening it is the ordinary path", async () => {
  // The sequence is what makes `check`'s refusal of a missing path stay correct:
  // create makes the folder, and open then walks a folder that exists. A `check`
  // that created what it was asked about would be a function that browses and a
  // function that writes, which are different powers.
  const root = await scratch();
  try {
    const made = await createVault(join(root, "parent"), "Studio").catch(() => null);
    // The parent has to be there — browsing only ever offers folders that are.
    expect(made).toBeNull();

    await mkdir(join(root, "parent"));
    const abs = await createVault(join(root, "parent"), "Studio");
    expect(abs).toBe(join(root, "parent/Studio"));
    expect(statSync(abs).isDirectory()).toBe(true);
    // Made and NOT seeded: seeding is the mount's job, and it is the same mount
    // every other folder gets.
    expect(readdirSync(abs)).toEqual([]);

    const host = await hostAt(root, abs);
    try {
      expect(existsSync(join(abs, "pages/home/content.yaml"))).toBe(true);
      // No plugin of its own: the framework's draw it, through the rung.
      expect(existsSync(join(abs, "plugins"))).toBe(false);
      // The guide is the framework's and lands off the mount path.
      await host.settled(abs);
      expect(existsSync(join(abs, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(abs, "INSTRUCTIONS.md"))).toBe(true);
      // The name typed is the folder's name, and the workspace's.
      expect((await (await host.deps(abs)).vault.info()).name).toBe("Studio");
    } finally {
      host.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a folder the filesystem will not make is refused in a sentence, not answered with `internal`", async () => {
  // `creatable` answers every question that can be answered by LOOKING. What is
  // left is what only the filesystem knows — a read-only parent here, and a name
  // the volume will not take, or a full disk, elsewhere — and the `mkdir` was
  // unguarded, so each of those arrived as a raw Error with no `code` on it and
  // the API answered `internal`. A five-hundred for a folder the person could
  // have renamed, or put somewhere they can write.
  //
  // Skipped as root, where the mode bits refuse nothing.
  if (process.getuid?.() === 0) return;
  const root = await scratch();
  const parent = join(root, "locked");
  await mkdir(parent);
  await chmod(parent, 0o500);
  try {
    // The refusal carries the closed code, which is what keeps the API off
    // `internal`, and a sentence naming the two things that can be changed.
    const err = await createVault(parent, "Studio").then(() => null, (e: unknown) => e);
    expect((err as { code?: string }).code).toBe("bad_request");
    expect((err as Error).message).toMatch(/could not be made/);
    // And no path in it, like every other refusal in that file.
    expect((err as Error).message).not.toContain(parent);
  } finally {
    await chmod(parent, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});
