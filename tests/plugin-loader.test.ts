// SPDX-License-Identifier: AGPL-3.0-only
// THE LOADER — a vault's own slot plugins, reached because the server reads the
// folder rather than because a file in the client names them.
//
// What it replaced is worth stating, because these tests are the guard on it: a
// list of five ids lived in `client/platform/document.js`, so a workspace could
// put `plugins/mine.js` on disk, the server would serve it on request, and
// nothing ever requested it. A `data-g-plugin="mine"` node drew `no plugin named
// "mine" is registered`, which reads as the page author's bug and was the
// harness's.
//
// Nothing here crosses the wire as a kind. The route already exists, the base is
// the one `contracts/wire.js` spells, and `contracts/` is untouched.

import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pluginBundle } from "../server/main.ts";

/** A folder with a `plugins/` in it, or without one when `files` is null. */
function vaultWith(files: Record<string, string> | null): string {
  const root = mkdtempSync(join(tmpdir(), "biom-loader-"));
  if (files !== null) {
    mkdirSync(join(root, "plugins"), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "plugins", name), text);
  }
  return root;
}

/** THE REAL REGISTRY, in a fresh realm-ish global, with the bundle run against
 *  it exactly as the box runs it. A stub that took every registration would pass
 *  the loader's tests and prove nothing about the rule the loader now carries —
 *  which file a part kind may be drawn from is decided inside `register`. */
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

test("a vault's own plugin loads because the folder is what is read, with no list of ids anywhere", async () => {
  const root = vaultWith({ "timeline.js": plugin("timeline") });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle).took).toEqual(["timeline"]);
  rmSync(root, { recursive: true, force: true });
});

test("every plugin is there, in id order, each preceded by a comment naming its file", async () => {
  const root = vaultWith({
    "zebra.js": plugin("zebra"),
    "alpha.js": plugin("alpha"),
    "markdown.js": plugin("markdown"),
    // Not a script, and therefore not in the bundle: a page plugin is a DOCUMENT
    // and needs no loader, because the server hands it to the page that named it.
    "notes.txt": "not a plugin",
  });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle).took).toEqual(["alpha", "markdown", "zebra"]);
  expect(bundle).toContain("/* plugins/alpha.js */");
  expect(bundle).toContain("/* plugins/markdown.js */");
  expect(bundle.indexOf("/* plugins/alpha.js */")).toBeLessThan(bundle.indexOf("/* plugins/zebra.js */"));
  rmSync(root, { recursive: true, force: true });
});

test("a plugin that throws is reported by its FILE, and every other plugin still registers", async () => {
  const root = vaultWith({
    "before.js": plugin("before"),
    "broken.js": `(function () { throw new Error("no table here"); })();`,
    "after.js": plugin("after"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  // The two good ones are unaffected, which is the property the wrapper buys.
  expect(took).toEqual(["after", "before"]);
  expect(said).toHaveLength(1);
  // The FILE, because the page saying `no plugin named "…" is registered` reads
  // as the author's bug and is the plugin's.
  expect(said[0]).toContain("plugins/broken.js");
  expect(said[0]).toContain("no table here");
  rmSync(root, { recursive: true, force: true });
});

test("a plugin that does not PARSE is the case a try cannot catch, so it never reaches the bundle", async () => {
  // A syntax error is thrown when the script is parsed, before any `try` in it
  // runs — so one unparseable file in a vault would take every plugin in that
  // vault down with it, and the page would draw nothing at all. It is parsed on
  // the server instead and replaced by the sentence saying so.
  const root = vaultWith({
    "fine.js": plugin("fine"),
    "syntax.js": `(function () { this is not javascript )`,
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["fine"]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain("plugins/syntax.js");
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

test("a part kind is drawn by the file the format names, and no file can take it by sorting first", async () => {
  // THE BUG THIS IS THE GUARD ON. The reservation used to be first-past-the-post
  // and the bundle concatenates `plugins/*.js` in name order, so a vault file
  // called `0-notes.js` sorted ahead of `table.js` and took `table` — replacing
  // the drawing of every table in the workspace with nothing anywhere saying so.
  // It is bound to the FILE now, and a file name is not a race.
  const root = vaultWith({
    "0-notes.js": `(function () { ["markdown", "html", "table", "child"].forEach(function (id) { biom.plugins.register({ id: id, mount: function () {} }); }); })();`,
    "markdown.js": plugin("markdown"),
    "html.js": plugin("html"),
    "table.js": plugin("table"),
    "child.js": plugin("child"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  // The four part kinds are drawn by their own files and by nothing else, even
  // though the seizing file ran first.
  expect(took).toEqual(["child", "html", "markdown", "table"]);
  expect(said).toHaveLength(4);
  for (const kind of ["markdown", "html", "table", "child"]) {
    expect(said.join(" ")).toContain('"' + kind + '" is a part kind and only plugins/' + kind + '.js draws it');
  }
  expect(said.join(" ")).toContain("plugins/0-notes.js must register under an id of its own");
  rmSync(root, { recursive: true, force: true });
});

test("a SECOND file claiming an id already taken is refused, in a sentence naming both files", async () => {
  // There is no shipped-versus-yours now that every plugin is a file in the
  // vault: the person's edit of `flow.js` IS the flow plugin, so there is
  // nothing to shadow. The failure is a second file taking the id, part kind or
  // not — and the reader has two files, so the refusal names two files.
  const root = vaultWith({
    "aaa-flow.js": plugin("flow"),
    "flow.js": plugin("flow"),
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["flow"]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('two plugins registered as "flow"');
  expect(said[0]).toContain("plugins/aaa-flow.js has it");
  expect(said[0]).toContain("plugins/flow.js is refused");
  rmSync(root, { recursive: true, force: true });
});

test("a vault's own edit of plugins/markdown.js still draws every markdown slot", async () => {
  // The other half of the same rule, and the one the vault owning its plugins is
  // for: the seeded file — or the person's rewrite of it — fills the reservation
  // because it is the file the format names.
  const root = vaultWith({ "markdown.js": plugin("markdown") });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle)).toEqual({ took: ["markdown"], said: [] });
  rmSync(root, { recursive: true, force: true });
});

test("each file gets a scope of its own, so a shared name is not a shared variable", async () => {
  // A `try` BLOCK is not a scope for `var` or for a function declaration, so two
  // plugins that each declared `var state` at their top level were one variable,
  // and the second file's assignment reached into the first one's closures. The
  // wrapper is a function per file now.
  const root = vaultWith({
    "one.js": `var state = "one"; function who() { return state; } biom.plugins.register({ id: "one", mount: function () {}, blocks: who });`,
    "two.js": `var state = "two"; function who() { return state; } biom.plugins.register({ id: "two", mount: function () {}, blocks: who });`,
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
    "strict.js": `"use strict"; try { undeclared = 1; } catch (e) { biom.plugins.register({ id: "strict", mount: function () {} }); }`,
  });
  const bundle = await (await pluginBundle(root)).text();
  expect(run(bundle).took).toEqual(["strict"]);
  rmSync(root, { recursive: true, force: true });
});

test("a plugin larger than the cap is refused by name and the rest of the folder still loads", async () => {
  const root = vaultWith({
    "fine.js": plugin("fine"),
    "huge.js": `/* ${"x".repeat(600 * 1024)} */`,
  });
  const bundle = await (await pluginBundle(root)).text();
  const { took, said } = run(bundle);
  expect(took).toEqual(["fine"]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain("plugins/huge.js");
  expect(said[0]).toContain("larger than a plugin may be");
  // The bytes are not in the bundle, which is the point of the cap.
  expect(bundle.length).toBeLessThan(100 * 1024);
  rmSync(root, { recursive: true, force: true });
});

test("the bundle is memoised per vault and rebuilt the moment a plugin file changes", async () => {
  // Every page in a vault carries this tag, so the rail is a request per page and
  // the folder was read and recompiled on every one of them, on a single thread.
  const root = vaultWith({ "one.js": plugin("one") });
  const first = await (await pluginBundle(root)).text();
  expect(await (await pluginBundle(root)).text()).toBe(first);

  // A write through the app is a write to the file, and the key is the listing
  // plus each file's mtime and size — so the next request misses the memo.
  writeFileSync(join(root, "plugins", "one.js"), plugin("renamed"));
  const after = await (await pluginBundle(root)).text();
  expect(after).not.toBe(first);
  expect(run(after).took).toEqual(["renamed"]);

  // And a new file in the folder is a new listing.
  writeFileSync(join(root, "plugins", "two.js"), plugin("two"));
  expect(run(await (await pluginBundle(root)).text()).took).toEqual(["renamed", "two"]);
  rmSync(root, { recursive: true, force: true });
});
