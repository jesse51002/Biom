// SPDX-License-Identifier: AGPL-3.0-only
// THE LOADER — every plugin folder in the vault, reached because the server
// reads the folders rather than because a file in the client names them.
//
// What it replaced is worth stating, because these tests are the guard on it: a
// list of five ids lived in `client/platform/document.js`, so a workspace could
// put a plugin on disk, the server would serve it on request, and nothing ever
// requested it. A `data-g-plugin="mine"` node drew `no plugin named "mine" is
// registered`, which reads as the page author's bug and was the harness's.
//
// EVERY PLUGIN IS A FOLDER NOW — `plugins/<id>/` with its scripts inside, its
// inner plugins under `plugins/`, and the same shape under the framework's
// `guest/plugins/` and a page's own `plugins/`. A loose `plugins/reveal.js` is
// the old shape and is refused in a sentence naming the folder to move it into.
//
// Nothing here crosses the wire as a kind. The route already exists, the base is
// the one `contracts/wire.js` spells, and `contracts/` is untouched.

import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { pluginBundle } from "../server/main.ts";
import { makeFiles } from "../server/platform/files.ts";

/** A vault whose `plugins/` holds the given files by vault-relative path under
 *  `plugins/` — `mine/mine.js`, `biom-doc/extensions.yaml` — or no `plugins/`
 *  at all when `files` is null. Paths under `pages/…` are written as they are. */
function vaultWith(files: Record<string, string> | null): string {
  const root = mkdtempSync(join(tmpdir(), "biom-loader-"));
  if (files !== null) {
    mkdirSync(join(root, "plugins"), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      const at = name.startsWith("pages/") || name.startsWith("design/") ? join(root, name) : join(root, "plugins", name);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, text);
    }
  }
  return root;
}

/** THE REAL REGISTRY, in a fresh realm-ish global, with the bundle run against
 *  it exactly as the box runs it. A stub that took every registration would pass
 *  the loader's tests and prove nothing about the rule the loader now carries —
 *  which folder a part kind may be drawn from is decided inside `register`. */
function run(bundle: string): { took: string[]; said: string[] } {
  const said: string[] = [];
  const glob = globalThis as any;
  const hadRt = glob.__gRuntime;
  const hadBiom = glob.biom;
  const hadDoc = glob.document;
  glob.__gRuntime = { report: (m: string) => said.push(m) };
  delete glob.biom;
  // `whereFrom` asks the document for the script that is running when the loader
  // did not name a file; there is no DOM here, so it gets the smallest stand-in
  // that lets the question be asked at all.
  glob.document = { currentScript: null };
  try {
    new Function(REGISTRY)();
    new Function(bundle)();
    return { took: glob.__gRuntime.plugins.ids(), said };
  } finally {
    glob.__gRuntime = hadRt;
    glob.biom = hadBiom;
    glob.document = hadDoc;
  }
}

const REGISTRY = await Bun.file(new URL("../guest/runtime/registry.js", import.meta.url).pathname).text();

const plugin = (id: string) => `(function () { biom.plugins.register({ id: ${JSON.stringify(id)}, mount: function () {} }); })();`;

/** A framework root holding the given files under `guest/plugins/`-shaped paths. */
function frameworkWith(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "biom-fw-"));
  for (const [name, text] of Object.entries(files)) {
    const at = join(root, name);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  return { root, files: makeFiles(root) };
}

test("a vault's own plugin loads because the folder is what is read, with no list of ids anywhere", async () => {
  const root = vaultWith({ "timeline/timeline.js": plugin("timeline") });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle).took).toEqual(["timeline"]);
  rmSync(root, { recursive: true, force: true });
});

test("every plugin is there, in name order, each preceded by a comment naming its file under its root", async () => {
  const root = vaultWith({
    "zebra/zebra.js": plugin("zebra"),
    "alpha/alpha.js": plugin("alpha"),
    "markdown/markdown.js": plugin("markdown"),
    // Not a script, and therefore not in the bundle: a page plugin is a DOCUMENT
    // and needs no loader, because the server hands it to the page that named it.
    "notes/index.html": "<main></main>",
    "notes/README.md": "not a plugin",
  });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle)).toEqual({ took: ["alpha", "markdown", "zebra"], said: [] });
  expect(bundle).toContain("/* plugins/alpha/alpha.js */");
  expect(bundle).toContain("/* plugins/markdown/markdown.js */");
  expect(bundle.indexOf("/* plugins/alpha/alpha.js */")).toBeLessThan(bundle.indexOf("/* plugins/zebra/zebra.js */"));
  rmSync(root, { recursive: true, force: true });
});

test("a folder's own scripts load in name order, then its inner plugins, to any depth", async () => {
  const root = vaultWith({
    "outer/b.js": plugin("outer-b"),
    "outer/a.js": plugin("outer-a"),
    "outer/plugins/inner/inner.js": plugin("inner"),
    "outer/plugins/inner/plugins/deeper/deeper.js": plugin("deeper"),
    "outer/plugins/another/another.js": plugin("another"),
  });
  const bundle = await (await pluginBundle(root)).text();
  // The folder's own two first, in name order; then its inner plugins in name
  // order, each with its own inner plugins right after it.
  expect(run(bundle)).toEqual({ took: ["outer-a", "outer-b", "another", "inner", "deeper"], said: [] });
  expect(bundle).toContain("/* plugins/outer/plugins/inner/plugins/deeper/deeper.js */");
  rmSync(root, { recursive: true, force: true });
});

test("a loose plugins/<id>.js is the old shape and is refused naming the folder to move it into", async () => {
  const root = vaultWith({
    "reveal.js": plugin("reveal"),
    "fine/fine.js": plugin("fine"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["fine"]);
  expect(said).toEqual(["plugins/reveal.js is a loose script — a plugin is a folder: move it into plugins/reveal/"]);
  expect(bundle).not.toContain(plugin("reveal"));
  rmSync(root, { recursive: true, force: true });
});

test("a plugin that throws is reported by its FILE, and every other plugin still registers", async () => {
  const root = vaultWith({
    "before/before.js": plugin("before"),
    "broken/broken.js": `(function () { throw new Error("no table here"); })();`,
    "after/after.js": plugin("after"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  // The two good ones are unaffected, which is the property the wrapper buys.
  expect(took).toEqual(["after", "before"]);
  expect(said).toHaveLength(1);
  // The FILE, because the page saying `no plugin named "…" is registered` reads
  // as the author's bug and is the plugin's.
  expect(said[0]).toContain("plugins/broken/broken.js");
  expect(said[0]).toContain("no table here");
  rmSync(root, { recursive: true, force: true });
});

test("a plugin that does not PARSE is the case a try cannot catch, so it never reaches the bundle", async () => {
  // A syntax error is thrown when the script is parsed, before any `try` in it
  // runs — so one unparseable file in a vault would take every plugin in that
  // vault down with it, and the page would draw nothing at all. It is parsed on
  // the server instead and replaced by the sentence saying so.
  const root = vaultWith({
    "fine/fine.js": plugin("fine"),
    "syntax/syntax.js": `(function () { this is not javascript )`,
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["fine"]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain("plugins/syntax/syntax.js");
  expect(bundle).not.toContain("this is not javascript");
  rmSync(root, { recursive: true, force: true });
});

test("a vault with no plugins folder at all answers an empty script and never an error", async () => {
  // Every box in that vault carries this tag, so a 404 here is a script that
  // fails to load on every page — and a page that draws nothing is what the
  // person would see. An empty script is a page with no plugins, which is what
  // an empty folder actually is.
  const root = vaultWith(null);
  const answer = await pluginBundle(root);
  expect(answer.status).toBe(200);
  expect(answer.headers.get("content-type")).toContain("javascript");
  const bundle = await answer.text();
  expect(run(bundle)).toEqual({ took: [], said: [] });
  rmSync(root, { recursive: true, force: true });
});

test("a part kind is drawn by the folder the format names, and no folder can take it by sorting first", async () => {
  // THE BUG THIS IS THE GUARD ON. The reservation used to be first-past-the-post
  // and the bundle concatenates the vault's plugins in name order, so a file
  // called `a-notes.js` sorted ahead of `table.js` and took `table` — replacing
  // the drawing of every table in the workspace with nothing anywhere saying so.
  // It is bound to the FOLDER now, and a folder name is not a race.
  const root = vaultWith({
    "a-notes/a-notes.js": `(function () { ["markdown", "html", "table", "child"].forEach(function (id) { biom.plugins.register({ id: id, mount: function () {} }); }); })();`,
    "markdown/markdown.js": plugin("markdown"),
    "html/html.js": plugin("html"),
    "table/table.js": plugin("table"),
    "child/child.js": plugin("child"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  // The four part kinds are drawn by their own folders and by nothing else, even
  // though the seizing file ran first.
  expect(took).toEqual(["child", "html", "markdown", "table"]);
  expect(said).toHaveLength(4);
  for (const kind of ["markdown", "html", "table", "child"]) {
    expect(said.join(" ")).toContain('"' + kind + '" is a part kind and only plugins/' + kind + "/ draws it");
  }
  expect(said.join(" ")).toContain("plugins/a-notes/a-notes.js must register under an id of its own");
  rmSync(root, { recursive: true, force: true });
});

test("an inner plugin may not take a part kind either, whatever its folder is called", async () => {
  // One bundle serves every page, and a part kind is every page's: the folder
  // the format names is at the top of its root, and `plugins/notes/plugins/table/`
  // is not it.
  const root = vaultWith({
    "notes/notes.js": plugin("notes"),
    "notes/plugins/table/table.js": plugin("table"),
  });
  const { took, said } = run(await (await pluginBundle(root)).text());
  expect(took).toEqual(["notes"]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('"table" is a part kind and only plugins/table/ draws it');
  rmSync(root, { recursive: true, force: true });
});

test("a SECOND file claiming an id already taken is refused, in a sentence naming both files", async () => {
  // There is no shipped-versus-yours now that every plugin is a file in the
  // vault: the person's edit of `flow/` IS the flow plugin, so there is
  // nothing to shadow. The failure is a second file taking the id, part kind or
  // not — and the reader has two files, so the refusal names two files.
  const root = vaultWith({
    "aaa-flow/aaa-flow.js": plugin("flow"),
    "flow/flow.js": plugin("flow"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["flow"]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('two plugins registered as "flow"');
  expect(said[0]).toContain("plugins/aaa-flow/aaa-flow.js has it");
  expect(said[0]).toContain("plugins/flow/flow.js is refused");
  rmSync(root, { recursive: true, force: true });
});

test("a vault's own plugins/markdown/ still draws every markdown slot", async () => {
  // The other half of the same rule, and the one the vault owning its plugins is
  // for: the person's own folder fills the reservation because it is the folder
  // the format names.
  const root = vaultWith({ "markdown/markdown.js": plugin("markdown") });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle)).toEqual({ took: ["markdown"], said: [] });
  rmSync(root, { recursive: true, force: true });
});

test("a vault script registering a biom- id is refused by name: the prefix is the framework's", async () => {
  const root = vaultWith({
    "holds/holds.js": plugin("biom-holds"),
    "mine/mine.js": plugin("mine"),
  });
  const { took, said } = run(await (await pluginBundle(root)).text());
  expect(took).toEqual(["mine"]);
  expect(said).toEqual(['"biom-holds" wears the framework\'s prefix — plugins/holds/holds.js must register under a name of its own']);
  rmSync(root, { recursive: true, force: true });
});

test("a vault folder wearing biom- is an extension and holds extensions.yaml alone: anything else in it is refused by name", async () => {
  const root = vaultWith({
    "biom-doc/extensions.yaml": "head: board-look\n",
    "biom-doc/doc.js": plugin("biom-doc"),
    "biom-doc/index.html": "<main></main>",
    "biom-doc/plugins/holds/holds.js": plugin("biom-holds"),
    "board-look/board-look.js": plugin("board-look"),
  });
  const { took, said } = run(await (await pluginBundle(root)).text());
  expect(took).toEqual(["board-look"]);
  expect(said).toEqual([
    "plugins/biom-doc/ extends the framework's biom-doc and may hold extensions.yaml alone — plugins/biom-doc/doc.js is refused",
    "plugins/biom-doc/ extends the framework's biom-doc and may hold extensions.yaml alone — plugins/biom-doc/index.html is refused",
    "plugins/biom-doc/ extends the framework's biom-doc and may hold extensions.yaml alone — plugins/biom-doc/plugins/ is refused",
  ]);
  rmSync(root, { recursive: true, force: true });
});

test("a page's own plugins/ loads after the vault's, in page-id order, and is named by its page", async () => {
  const root = vaultWith({
    "mine/mine.js": plugin("mine"),
    "pages/home/content.yaml": "name: Home\nplugin: doc\n",
    "pages/home/plugins/root-only/root-only.js": plugin("root-only"),
    "pages/home/children/zed/content.yaml": "name: Zed\nplugin: doc\n",
    "pages/home/children/zed/plugins/zed-look/zed-look.js": plugin("zed-look"),
    "pages/home/children/alpha/content.yaml": "name: Alpha\nplugin: doc\n",
    "pages/home/children/alpha/plugins/alpha-look/alpha-look.js": plugin("alpha-look"),
    "pages/home/children/alpha/plugins/loose.js": plugin("loose"),
    // A page called `plugins` under `children/` is still a page, and its
    // directory is not a plugins root.
    "pages/home/children/plugins/content.yaml": "name: Plugins\nplugin: doc\n",
    "pages/home/children/plugins/plugins/named/named.js": plugin("named"),
    "design/plugins/design-look/design-look.js": plugin("design-look"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["mine", "root-only", "alpha-look", "named", "zed-look", "design-look"]);
  expect(said).toEqual([
    "pages/home/children/alpha/plugins/loose.js is a loose script — a plugin is a folder: move it into pages/home/children/alpha/plugins/loose/",
  ]);
  expect(bundle).toContain("/* pages/home/children/zed/plugins/zed-look/zed-look.js */");
  rmSync(root, { recursive: true, force: true });
});

test("a page's plugins/ may not take a part kind: one bundle serves every page", async () => {
  const root = vaultWith({
    "pages/home/content.yaml": "name: Home\nplugin: doc\n",
    "pages/home/plugins/markdown/markdown.js": plugin("markdown"),
  });
  const { took, said } = run(await (await pluginBundle(root)).text());
  expect(took).toEqual([]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('"markdown" is a part kind and only plugins/markdown/ draws it');
  expect(said[0]).toContain("pages/home/plugins/markdown/markdown.js must register under an id of its own");
  rmSync(root, { recursive: true, force: true });
});

test("the framework's folders go first, a folder's id wears biom- whether or not its name does, and an inner folder is free to", async () => {
  const fw = frameworkWith({
    "biom-doc/index.html": "<main></main>",
    "biom-doc/plugins/holds/holds.js": plugin("biom-holds"),
    "biom-markdown/markdown.js": plugin("biom-markdown"),
  });
  const root = vaultWith({ "mine/mine.js": plugin("mine") });
  const bundle = await (await pluginBundle(root, fw.files)).text();
  const { took, said } = run(bundle);
  expect(said).toEqual([]);
  expect(took).toEqual(["biom-holds", "biom-markdown", "mine"]);
  expect(bundle).toContain("/* framework/biom-doc/plugins/holds/holds.js */");
  expect(bundle.indexOf("/* framework/")).toBeLessThan(bundle.indexOf("/* plugins/mine/mine.js */"));
  rmSync(root, { recursive: true, force: true });
  rmSync(fw.root, { recursive: true, force: true });
});

test("each file gets a scope of its own, so a shared name is not a shared variable", async () => {
  // A `try` BLOCK is not a scope for `var` or for a function declaration, so two
  // plugins that each declared `var state` at their top level were one variable,
  // and the second file's assignment reached into the first one's closures. The
  // wrapper is a function per file now.
  const root = vaultWith({
    "one/one.js": `var state = "one"; function who() { return state; } biom.plugins.register({ id: "one", mount: function () {}, blocks: who });`,
    "two/two.js": `var state = "two"; function who() { return state; } biom.plugins.register({ id: "two", mount: function () {}, blocks: who });`,
  });
  const bundle = await (await pluginBundle(root)).text();
  const kept: Record<string, any> = {};
  const glob = globalThis as any;
  const hadRt = glob.__gRuntime;
  const hadBiom = glob.biom;
  glob.__gRuntime = { report: () => {} };
  glob.biom = { plugins: { register: (def: any) => { kept[def.id] = def.blocks; return true; } } };
  try {
    new Function(bundle)();
  } finally {
    glob.__gRuntime = hadRt;
    glob.biom = hadBiom;
  }
  expect([kept.one(), kept.two()]).toEqual(["one", "two"]);
  // And nothing leaked out of the bundle into the page's own globals.
  expect((globalThis as any).state).toBeUndefined();
  rmSync(root, { recursive: true, force: true });
});

test("a file's own \"use strict\" is live, because it is a function's directive prologue", async () => {
  // Inside a shared `try` block it was an expression statement doing nothing, so
  // a plugin that had asked for strict mode was not getting it — which is a
  // silent difference right up to the assignment that should have thrown.
  const root = vaultWith({
    "strict/strict.js": `"use strict"; try { undeclared = 1; } catch (e) { biom.plugins.register({ id: "strict", mount: function () {} }); }`,
  });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle).took).toEqual(["strict"]);
  rmSync(root, { recursive: true, force: true });
});

test("a plugin larger than the cap is refused by name and the rest of the folder still loads", async () => {
  const root = vaultWith({
    "fine/fine.js": plugin("fine"),
    "huge/huge.js": `/* ${"x".repeat(600 * 1024)} */`,
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["fine"]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain("plugins/huge/huge.js");
  expect(said[0]).toContain("larger than a plugin may be");
  // The bytes are not in the bundle, which is the point of the cap.
  expect(bundle.length).toBeLessThan(100 * 1024);
  rmSync(root, { recursive: true, force: true });
});

test("the bundle is memoised per vault and rebuilt the moment a plugin file changes — a page's included", async () => {
  // Every page in a vault carries this tag, so the rail is a request per page and
  // the folder was read and recompiled on every one of them, on a single thread.
  const root = vaultWith({ "one/one.js": plugin("one"), "pages/home/content.yaml": "name: Home\nplugin: doc\n" });
  const first = await (await pluginBundle(root)).text();
  expect(await (await pluginBundle(root)).text()).toBe(first);

  // A write through the app is a write to the file, and the key is every
  // segment's name and a hash of its text — so the next request misses the memo.
  writeFileSync(join(root, "plugins", "one", "one.js"), plugin("renamed"));
  const after = await (await pluginBundle(root)).text();
  expect(after).not.toBe(first);
  expect(run(after).took).toEqual(["renamed"]);

  // And a new folder is a new listing — under a page as much as under the vault.
  mkdirSync(join(root, "pages", "home", "plugins", "two"), { recursive: true });
  writeFileSync(join(root, "pages", "home", "plugins", "two", "two.js"), plugin("two"));
  expect(run(await (await pluginBundle(root)).text()).took).toEqual(["renamed", "two"]);
  rmSync(root, { recursive: true, force: true });
});
