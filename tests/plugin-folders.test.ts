// SPDX-License-Identifier: AGPL-3.0-only
// THE PLUGIN FOLDER AND ITS THREE RUNGS — `server/domain/plugins.ts`.
//
// Every plugin is a folder of one shape; a plugin's variables are its
// `plugin.yaml` defaults, the vault's `plugins/<id>/extensions.yaml` over them,
// and the same file in a page's own `plugins/` over those, merged one key at a
// time with the nearest rung winning. This file walks the shape and every
// refusal the merge can make, and then reads a real page through `makePages`
// to hold the result on the page read. Fixtures are invented and say so.

import { test, expect } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { makeFiles } from "../server/platform/files.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { CONTRACT, EXTENSIONS, makePlugins, mergeRungs, readRung, walkPlugins } from "../server/domain/plugins.ts";
import { makePages, pageDirs } from "../server/domain/pages.ts";
import { DESIGN_PAGE, MAP_PAGE } from "../contracts/wire.js";

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "biom-folders-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), text);
  }
  return root;
}

/* ══ the walk ════════════════════════════════════════════════════════════ */

test("a plugins root is walked as folders — own scripts in name order, inner plugins after — and everything else is a sentence", async () => {
  const root = await tree({
    "plugins/zed/zed.js": "",
    "plugins/alpha/b.js": "",
    "plugins/alpha/a.js": "",
    "plugins/alpha/plugin.yaml": "head:\n",
    "plugins/alpha/index.html": "<main></main>",
    "plugins/alpha/README.md": "words",
    "plugins/alpha/plugins/inner/inner.js": "",
    "plugins/alpha/plugins/inner/extensions.yaml": "",
    "plugins/loose.js": "",
    "plugins/notes.txt": "",
    "plugins/Bad Name/x.js": "",
    "plugins/.hidden/x.js": "",
    "plugins/biom-doc/extensions.yaml": "head: mine\n",
    "plugins/biom-doc/doc.js": "",
    "plugins/biom-doc/plugins/holds/holds.js": "",
  });
  try {
    const walk = await walkPlugins(makeFiles(root), "plugins", "vault");
    expect(walk.folders.map((f) => [f.id, f.path, f.scripts, f.contract, f.extensions, f.document, f.extension])).toEqual([
      ["alpha", "alpha", ["a.js", "b.js"], true, false, true, false],
      ["inner", "alpha/plugins/inner", ["inner.js"], false, true, false, false],
      ["biom-doc", "biom-doc", [], false, true, false, true],
      ["zed", "zed", ["zed.js"], false, false, false, false],
    ]);
    expect(walk.faults.map((f) => f.message)).toEqual([
      "plugins/Bad Name/ is not a plugin folder — a plugin's folder is its id: lowercase letters, digits and dashes",
      "plugins/biom-doc/ extends the framework's biom-doc and may hold extensions.yaml alone — plugins/biom-doc/doc.js is refused",
      "plugins/biom-doc/ extends the framework's biom-doc and may hold extensions.yaml alone — plugins/biom-doc/plugins/ is refused",
      "plugins/loose.js is a loose script — a plugin is a folder: move it into plugins/loose/",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("under the framework's root a folder's id wears biom- whether or not its name does, and biom- folders are plugins rather than extensions", async () => {
  const root = await tree({
    "biom-doc/index.html": "",
    "biom-doc/plugin.yaml": "foot: biom-holds\n",
    "biom-doc/plugins/holds/holds.js": "",
    "biom-markdown/markdown.js": "",
  });
  try {
    const walk = await walkPlugins(makeFiles(root), "", "framework");
    expect(walk.folders.map((f) => [f.id, f.path, f.extension])).toEqual([
      ["biom-doc", "biom-doc", false],
      ["biom-holds", "biom-doc/plugins/holds", false],
      ["biom-markdown", "biom-markdown", false],
    ]);
    expect(walk.faults).toEqual([]);
    expect(walk.words).toBe("framework");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a root that is not there is an empty walk and never an error", async () => {
  const root = await tree({});
  try {
    expect(await walkPlugins(makeFiles(root), "plugins", "vault")).toEqual({ folders: [], faults: [], words: "plugins" });
    expect(await walkPlugins(makeFiles(root), "pages/home/plugins", "page", "pages/home/plugins")).toEqual({ folders: [], faults: [], words: "pages/home/plugins" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ one rung ════════════════════════════════════════════════════════════ */

const contract = (text: string | null) => readRung(text, parseAny, `framework/biom-doc/${CONTRACT}`, "biom-doc", "plugin", null);
const rung = (text: string | null, declared: Record<string, any>) =>
  readRung(text, parseAny, `plugins/biom-doc/${EXTENSIONS}`, "biom-doc", "vault", declared);

test("a contract is a flat map of keys and defaults; an absent or empty file is an empty rung; a map value is refused by name and the key dropped", () => {
  expect(contract(null)).toEqual({ rung: "plugin", values: {}, faults: [] });
  expect(contract("")).toEqual({ rung: "plugin", values: {}, faults: [] });
  expect(contract("   \n")).toEqual({ rung: "plugin", values: {}, faults: [] });
  const read = contract("head:\nfoot: biom-holds\nrows: false\ntags: [a, b]\ndeep:\n  a: b\n");
  expect(read.values).toEqual({ head: null, foot: "biom-holds", rows: false, tags: ["a", "b"] });
  expect(read.faults).toEqual([`framework/biom-doc/${CONTRACT}: "deep" holds a map — a variable is a scalar or a list of scalars`]);
});

test("a file that does not parse is skipped and reported, and one that is not a map is refused as such", () => {
  const broken = contract("head: [unclosed\n");
  expect(broken.values).toEqual({});
  expect(broken.faults).toHaveLength(1);
  expect(broken.faults[0]).toContain(`framework/biom-doc/${CONTRACT} could not be read:`);
  expect(broken.faults[0]).toContain("the plugin has no defaults");
  const brokenRung = rung("head: [unclosed\n", { head: null });
  expect(brokenRung.faults[0]).toContain("the rung beneath stands");
  expect(rung("- a\n- b\n", { head: null }).faults).toEqual([`plugins/biom-doc/${EXTENSIONS} is not a map of variables — a key and its value, one per line`]);
});

test("a rung takes only keys the contract declares, and types each by the default's own type", () => {
  const declared = { head: null, foot: "biom-holds", rows: false, depth: 2, tags: ["a"] };
  const read = rung("head: board-look\nfoot:\nrows: true\ndepth: three\ntags: solo\nsort: date\n", declared);
  // `head` had no type and takes anything; `foot` emptied is a value; `rows`
  // is a boolean where a boolean goes; the two mistyped and the one undeclared
  // are refused by name and dropped, and the rest stand.
  expect(read.values).toEqual({ head: "board-look", foot: null, rows: true });
  expect(read.faults).toEqual([
    `plugins/biom-doc/${EXTENSIONS}: "depth" is a string where biom-doc's ${CONTRACT} holds a number — the rung beneath stands`,
    `plugins/biom-doc/${EXTENSIONS}: "tags" is a string where biom-doc's ${CONTRACT} holds a list — the rung beneath stands`,
    `plugins/biom-doc/${EXTENSIONS} names "sort", which biom-doc does not declare — its ${CONTRACT} holds head, foot, rows, depth, tags`,
  ]);
  // A map where a scalar goes is refused everywhere a variable is written.
  expect(rung("foot: {a: b}\n", declared).faults).toEqual([`plugins/biom-doc/${EXTENSIONS}: "foot" holds a map — a variable is a scalar or a list of scalars`]);
});

/* ══ the merge ═══════════════════════════════════════════════════════════ */

test("rungs merge one key at a time, nearest wins, and every fault travels", () => {
  const merged = mergeRungs([
    { rung: "plugin", values: { head: null, foot: "biom-holds", rows: false }, faults: ["a"] },
    { rung: "vault", values: { head: "board-look" }, faults: [] },
    { rung: "page", values: { foot: null }, faults: ["b"] },
  ]);
  expect(merged).toEqual({
    values: { head: "board-look", foot: null, rows: false },
    from: { head: "vault", foot: "page", rows: "plugin" },
    faults: ["a", "b"],
  });
});

/* ══ the three roots, on disk ════════════════════════════════════════════ */

const FRAMEWORK = {
  "biom-doc/index.html": "<main id=\"g-page\"></main>",
  "biom-doc/plugin.yaml": "head:\nfoot: biom-holds\nrows: false\n",
  "biom-doc/plugins/holds/holds.js": "",
  "biom-doc/plugins/holds/plugin.yaml": "sort: name\n",
  "biom-markdown/markdown.js": "",
};

test("extensionsFor merges the contract, the vault's rung and one page's rung, and a rung over nothing declared is a fault under its id", async () => {
  const fw = await tree(FRAMEWORK);
  const vault = await tree({
    "plugins/biom-doc/extensions.yaml": "head: board-look\n",
    "plugins/board-look/board-look.js": "",
    "plugins/board-look/plugin.yaml": "dots: true\n",
    "plugins/biom-nothing/extensions.yaml": "x: 1\n",
    "pages/home/content.yaml": "name: Home\nplugin: doc\n",
    "pages/home/children/notes/content.yaml": "name: Notes\nplugin: doc\n",
    "pages/home/children/notes/plugins/biom-doc/extensions.yaml": "foot:\nrows: true\n",
    "pages/home/children/notes/plugins/biom-holds/extensions.yaml": "sort: date\n",
    "pages/home/children/notes/plugins/own/own.js": "",
    "pages/home/children/notes/plugins/own/plugin.yaml": "lit: false\n",
  });
  try {
    const plugins = makePlugins(makeFiles(vault), makeFiles(fw), parseAny);
    // The page with its own rung: `head` from the vault, `foot` and `rows` from
    // the page, the inner plugin's `sort` from the page too, and the page's own
    // plugin's defaults beside them.
    const notes = await plugins.extensionsFor("pages/home/children/notes");
    expect(notes["biom-doc"]).toEqual({
      values: { head: "board-look", foot: null, rows: true },
      from: { head: "vault", foot: "page", rows: "page" },
      faults: [],
    });
    expect(notes["biom-holds"]).toEqual({ values: { sort: "date" }, from: { sort: "page" }, faults: [] });
    expect(notes["own"]).toEqual({ values: { lit: false }, from: { lit: "plugin" }, faults: [] });
    expect(notes["board-look"]).toEqual({ values: { dots: true }, from: { dots: "plugin" }, faults: [] });
    expect(notes["biom-nothing"]).toEqual({
      values: {},
      from: {},
      faults: ['plugins/biom-nothing/extensions.yaml extends "biom-nothing", which declares no plugin.yaml — there is nothing to extend'],
    });
    // The root page has no rung of its own: the vault's and the contract's alone,
    // and the child's rung reaches the child only.
    const home = await plugins.extensionsFor("pages/home");
    expect(home["biom-doc"]).toEqual({
      values: { head: "board-look", foot: "biom-holds", rows: false },
      from: { head: "vault", foot: "plugin", rows: "plugin" },
      faults: [],
    });
    expect(home["biom-holds"]).toEqual({ values: { sort: "name" }, from: { sort: "plugin" }, faults: [] });
    expect(home["own"]).toBeUndefined();
    // No page directory at all: the framework's and the vault's rungs.
    expect((await plugins.extensionsFor(null))["biom-doc"]!.values).toEqual({ head: "board-look", foot: "biom-holds", rows: false });
  } finally {
    await rm(fw, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("the page read carries the merged extensions, the design doc reads its own directory's rung, and the map reads the vault's", async () => {
  const fw = await tree(FRAMEWORK);
  const vault = await tree({
    "plugins/biom-doc/extensions.yaml": "head: board-look\n",
    "pages/home/content.yaml": "name: Home\nplugin: doc\ncontents: []\n",
    "pages/home/plugins/biom-doc/extensions.yaml": "rows: true\n",
    "design/content.yaml": "name: Design\nplugin: doc\ncontents: []\n",
    "design/plugins/biom-doc/extensions.yaml": "foot:\n",
  });
  try {
    const files = makeFiles(vault);
    const plugins = makePlugins(files, makeFiles(fw), parseAny);
    const pages = makePages(files, { parse, parseAny, format, formatAny }, () => [], undefined, "Home", undefined, makeFiles(fw), plugins.extensionsFor);
    const home = (await pages.read("home"))!;
    expect(home.extensions["biom-doc"]!.values).toEqual({ head: "board-look", foot: "biom-holds", rows: true });
    expect(home.extensions["biom-doc"]!.from).toEqual({ head: "vault", foot: "plugin", rows: "page" });
    const design = (await pages.read(DESIGN_PAGE))!;
    expect(design.extensions["biom-doc"]!.values).toEqual({ head: "board-look", foot: null, rows: false });
    const map = (await pages.read(MAP_PAGE))!;
    expect(map.extensions["biom-doc"]!.values).toEqual({ head: "board-look", foot: "biom-holds", rows: false });
    // A page read with no merge handed in reads no extensions at all.
    const bare = makePages(files, { parse, parseAny, format, formatAny });
    expect((await bare.read("home"))!.extensions).toEqual({});
  } finally {
    await rm(fw, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("a page's own plugins/<id>/index.html draws that page before the vault's and the framework's, and a biom- folder there never does", async () => {
  const fw = await tree(FRAMEWORK);
  const vault = await tree({
    "plugins/timeline/index.html": "<main>the vault's timeline</main>",
    "pages/home/content.yaml": "name: Home\nplugin: timeline\ncontents: []\n",
    "pages/home/plugins/timeline/index.html": "<main>this page's timeline</main>",
    "pages/home/children/notes/content.yaml": "name: Notes\nplugin: timeline\ncontents: []\n",
    "pages/home/children/other/content.yaml": "name: Other\nplugin: doc\ncontents: []\n",
    "pages/home/children/other/plugins/biom-doc/index.html": "<main>a copy by another name</main>",
    "pages/home/children/other/plugins/biom-doc/extensions.yaml": "rows: true\n",
  });
  try {
    const files = makeFiles(vault);
    const pages = makePages(files, { parse, parseAny, format, formatAny }, () => [], undefined, "Home", undefined, makeFiles(fw));
    expect((await pages.read("home"))!.html).toBe("<main>this page's timeline</main>");
    // The child reads its own directory and never its parent's.
    expect((await pages.read("home/notes"))!.html).toBe("<main>the vault's timeline</main>");
    // A `biom-` folder under a page is an extension: its document is not read
    // and the framework's draws.
    expect((await pages.read("home/other"))!.html).toContain('id="g-page"');
  } finally {
    await rm(fw, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("pageDirs walks positions and not documents, in id order, the design doc's last, and never a plugins/ or a _ folder as a page", async () => {
  const vault = await tree({
    "pages/home/content.yaml": "",
    "pages/home/plugins/x/x.js": "",
    "pages/home/_assets/pic.txt": "",
    "pages/home/children/zed/content.yaml": "",
    "pages/home/children/alpha/nothing.txt": "",
    "pages/home/children/alpha/children/deep/content.yaml": "",
    "pages/home/children/plugins/content.yaml": "",
    "design/content.yaml": "",
  });
  try {
    expect(await pageDirs(makeFiles(vault))).toEqual([
      "pages/home",
      "pages/home/children/alpha",
      "pages/home/children/alpha/children/deep",
      "pages/home/children/plugins",
      "pages/home/children/zed",
      "design",
    ]);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});
