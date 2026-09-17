// SPDX-License-Identifier: AGPL-3.0-only
// THE SEEDED SLOT PLUGINS, AND THE ONE THING EVERY ONE OF THEM OWES A PAGE:
// where its node is misplaced it REFUSES IN WORDS, in its own node, and the rest
// of the page draws.
//
// That is the bar rather than a nicety. Every `plugins/*.js` in a vault is
// global to every page in it, so a plugin that drew a blank rectangle when its
// attributes were wrong would be a blank rectangle somebody spends an hour
// attributing to their own section. A sentence naming the attribute that is
// missing is read and acted on.
//
// There is no DOM here. Each plugin is loaded exactly as the box loads it — a
// classic script against a shared global — and mounted against a node that is
// only what `mount` actually touches on the refusal path.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

/** Load the registry and every seeded slot plugin into one fresh realm-ish
 *  global, the way the loader's one script does. */
function box() {
  const glob = /** @type {any} */ (globalThis);
  const said = [];
  glob.__gRuntime = { report: (m) => said.push(m) };
  delete glob.biom;
  // `whereFrom` falls back to `document.currentScript` when the loader named no
  // file; there is no DOM here, so it gets the smallest stand-in that lets the
  // question be asked at all.
  glob.document = { currentScript: null };
  const load = (name) =>
    new Function(readFileSync(new URL(`../guest/${name}`, import.meta.url), "utf8"))();
  load("runtime/registry.js");
  for (const id of ["items", "open-list", "checklist", "reveal"]) load(`plugins/${id}.js`);
  return { plugins: glob.__gRuntime.plugins, said, done: () => { delete glob.document; } };
}

/** A node that answers only what a refusal touches. */
function node() {
  return { textContent: "", replaceChildren() {} };
}

/** A mount context with a section root that holds the named slots and no others. */
function ctx(options, slots) {
  return {
    options,
    root: { querySelector: (sel) => (slots.some((s) => sel.includes(`"${s}"`)) ? { querySelector: () => null } : null) },
    section: "one",
    read: () => "",
    write: () => true,
    has: (id) => id === "items",
    use: () => { throw new Error("not reached"); },
  };
}

test("every seeded slot plugin registers, under its own id, from the vault", () => {
  const g = box();
  for (const id of ["items", "open-list", "checklist", "reveal"]) {
    expect([id, g.plugins.has(id)]).toEqual([id, true]);
    // THE FILE IT CAME FROM, which is what a refusal has to name when a second
    // file claims the same id. There is no `shipped` any more: every plugin is a
    // file in the vault, so the person's copy IS the plugin. These are loaded
    // here without the loader's wrapper around them, so what the registry can
    // say about their provenance is that it was not told.
    expect([id, g.plugins.get(id).from]).toEqual([id, "an unnamed script"]);
  }
  expect(g.said).toEqual([]);
  g.done();
});

test("none of them claims a part kind, which is what R50 would refuse", () => {
  const g = box();
  for (const id of ["markdown", "html", "table", "child"]) {
    expect([id, g.plugins.has(id)]).toEqual([id, false]);
  }
  g.done();
});

test("items refuses in words when no slot is named, and when the slot is not this section's", () => {
  const g = box();
  const items = g.plugins.get("items");

  const bare = node();
  items.mount(bare, null, ctx({}, ["steps"]));
  expect(bare.textContent).toContain("data-g-for");

  const wrong = node();
  items.mount(wrong, null, ctx({ for: "nope" }, ["steps"]));
  expect(wrong.textContent).toContain('no slot called "nope"');
  g.done();
});

test("checklist refuses in words when the vocabulary is missing, because the word is the page's", () => {
  // THE PLUGIN HOLDS NO VOCABULARY OF ITS OWN. A default word would be this
  // framework's word appearing in somebody else's document the first time they
  // ticked something — "built" in a list of invoices.
  const g = box();
  const checklist = g.plugins.get("checklist");

  const bare = node();
  checklist.mount(bare, null, ctx({ for: "ideas" }, ["ideas"]));
  expect(bare.textContent).toContain("data-g-done");

  const noSlot = node();
  checklist.mount(noSlot, null, ctx({ done: "Built" }, ["ideas"]));
  expect(noSlot.textContent).toContain("data-g-for");

  const wrong = node();
  checklist.mount(wrong, null, ctx({ for: "nope", done: "Built" }, ["ideas"]));
  expect(wrong.textContent).toContain('no slot called "nope"');
  g.done();
});

test("open-list refuses in words when the harness it composes on is not in the vault", () => {
  // `ctx.use` throws on a name nothing registered, and that is right — but a
  // thrown error reaches the page as a failed node with a stack in it. The
  // absent-dependency case has a sentence of its own, because it is a real state
  // in a vault somebody emptied.
  const g = box();
  const openList = g.plugins.get("open-list");

  const bare = node();
  openList.mount(bare, null, ctx({}, ["questions"]));
  expect(bare.textContent).toContain("data-g-for");

  const alone = node();
  const without = ctx({ for: "questions" }, ["questions"]);
  without.has = () => false;
  openList.mount(alone, null, without);
  expect(alone.textContent).toContain("plugins/items.js is missing");
  g.done();
});

test("reveal refuses in words when its selector matches nothing in the section", () => {
  // A typo'd selector is exactly the case that looks like a broken plugin: the
  // class never lands, the animation never plays, and nothing anywhere says why.
  const g = box();
  const reveal = g.plugins.get("reveal");

  const missing = node();
  reveal.mount(missing, null, ctx({ on: ".nothing" }, []));
  expect(missing.textContent).toContain('nothing in this section matches ".nothing"');

  const noSection = node();
  const paged = ctx({}, []);
  paged.root = null;
  reveal.mount(noSection, null, paged);
  expect(noSection.textContent).toContain("no section here to watch");
  g.done();
});

test("open-list hands its OWN options to the harness, because use() builds a fresh context", () => {
  // FOUND IN A BROWSER AND NOT HERE, the first time. `ctx.use(id).mount` builds
  // the mounted plugin a context of its own, and its `options` default to empty
  // — there is no node with `data-g-*` on it when one plugin mounts another. So
  // `items` was refusing in words on a correctly written section: "name one of
  // this section's list slots in data-g-for", pointing at an attribute that was
  // right there on the node.
  const g = box();
  let handed = null;
  const c = ctx({ for: "questions", add: "＋ One more" }, ["questions"]);
  c.use = () => ({ mount: (_n, _c, opts) => { handed = opts; } });
  // The slot it finds has to answer the two calls the dressing pass makes, and
  // the observer it starts has to exist. There is no DOM here, so both are
  // stood in for.
  c.root = { querySelector: () => ({ querySelectorAll: () => [] }) };
  const glob = /** @type {any} */ (globalThis);
  const hadObserver = glob.MutationObserver;
  glob.MutationObserver = class { observe() {} disconnect() {} };
  g.plugins.get("open-list").mount(node(), null, c);
  glob.MutationObserver = hadObserver;
  expect(handed).toEqual({ for: "questions", add: "＋ One more" });
  g.done();
});

/* ── the two rules a vault is handed before it is asked ─────────────────── */

// THEY ARE IN THE SEEDED `AGENTS.md` AND NOT ONLY IN A SKILL, and the difference
// is who reads what. A skill is opened by somebody who has already decided to
// look something up; these two are the decision itself, so they have to be
// carried before the work starts rather than found once it has gone wrong.
//
// A later rewrite of that file is expected — this holds the two rules across it
// by what they SAY rather than by where they sit, so moving them is free and
// dropping them is not.

const AGENTS = readFileSync(new URL("../vault/AGENTS.md", import.meta.url), "utf8");
// Every framework skill's directory wears `biom-`, so its name can never meet
// a skill a workspace wrote — see `SKILL_PREFIX` in `server/workspace/framework.ts`.
const skill = (name) =>
  readFileSync(new URL(`../vault/.agents/skills/biom-${name}/SKILL.md`, import.meta.url), "utf8");

test("the seeded AGENTS.md carries modularity, and the skills where the work happens echo it", () => {
  expect(AGENTS).toContain("even a small chance");
  expect(AGENTS).toContain("plugins/<id>.js");
  // `plugins` is where the route is, so that is where the rule has to be
  // actionable rather than merely stated.
  expect(skill("plugins")).toContain("even a small chance");
  // And `sections`, because a section script is the thing it is a rule against.
  expect(skill("sections")).toContain("even a small chance");
});

test("the seeded AGENTS.md carries visual by default, echoed in pages and sections", () => {
  expect(AGENTS).toContain("not a plain markdown framework");
  expect(AGENTS).toContain("without being asked");
  // `pages` is the page's shape and `sections` is the drawing — the two halves
  // of what the rule obliges.
  expect(skill("pages")).toContain("without being asked");
  expect(skill("sections")).toContain("not a plain markdown framework");
});

/* ── the checker, where a rule it states stopped being true ─────────────── */

test("R59 is satisfied by a plugin node naming the slot, not only by ctx.write", async () => {
  // The rule asks whether a reader can add an item and take one away. Before the
  // loader, the only answer was a script in the section; now one node is the
  // ordinary answer, and a rule that could not see it would report every correct
  // section that took the plugin — which would teach the opposite of the rule.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const root = mkdtempSync(join(tmpdir(), "biom-r59-"));
  const page = join(root, "pages", "one");
  mkdirSync(page, { recursive: true });
  writeFileSync(join(page, "content.yaml"),
    "name: One\nplugin: doc\ncontents:\n  - name: steps\n    data: index.html\n    parts:\n      steps:\n        - First\n        - Second\n");

  const run = async () => {
    const out = Bun.spawnSync({
      cmd: ["bun", "run", join(import.meta.dir, "..", "skill", "check.ts"), join("pages", "one")],
      cwd: root,
    });
    return new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
  };

  writeFileSync(join(page, "index.html"), '<div data-g-part="steps"></div>\n');
  expect(await run()).toContain("R59");

  writeFileSync(join(page, "index.html"),
    '<div data-g-part="steps"></div>\n<span data-g-plugin="items" data-g-for="steps"></span>\n');
  expect(await run()).not.toContain("R59");

  // A PLUGIN THAT DOES NOT WRITE THE LIST BACK IS NOT AN ANSWER. `reveal`
  // animates the slot and changes nothing in it, so a section with only this is
  // still a list a reader can only retype — which is the section this rule
  // exists to find.
  writeFileSync(join(page, "index.html"),
    '<div data-g-part="steps"></div>\n<span data-g-plugin="reveal" data-g-for="steps"></span>\n');
  expect(await run()).toContain("R59");

  // And a misspelled id registers nothing at all, so the page draws a refusal
  // where the controls were meant to be. Taking it as proof would silence the
  // warning on the page that most needs it.
  writeFileSync(join(page, "index.html"),
    '<div data-g-part="steps"></div>\n<span data-g-plugin="itmes" data-g-for="steps"></span>\n');
  expect(await run()).toContain("R59");

  // open-list and checklist write the list back too, and each is a whole answer.
  for (const id of ["open-list", "checklist"]) {
    writeFileSync(join(page, "index.html"),
      '<div data-g-part="steps"></div>\n<span data-g-plugin="' + id + '" data-g-for="steps" data-g-done="Built"></span>\n');
    expect([id, (await run()).includes("R59")]).toEqual([id, false]);
  }

  rmSync(root, { recursive: true, force: true });
});

/* ── A FENCE IS HANDED TO THE PLUGIN ITS INFO STRING NAMES ──────────────── */
//
// MERMAID IS NOT SHIPPED ANY MORE, and this is the half of that decision that
// had to keep working. The whole point of the format is a CUSTOM drawing — a
// figure is HTML a section writes, and a diagram of relationships is that same
// drawing — so nothing in `guest/plugins/` draws a mermaid fence
// and a fresh vault gets no `plugins/mermaid.js`.
//
// What the framework kept is the MECHANISM rather than the name. `markdown.js`
// upgrades a fence whose info string names a REGISTERED plugin, whatever that
// plugin is, so a workspace that writes `plugins/flow.js` gets ```flow drawn by
// it — and a workspace carrying its own copy of the retired mermaid plugin gets
// ```mermaid drawn by that, with nothing in the framework naming either. That
// is what these two tests hold: the dispatch by name, and the part kinds that
// are excluded from it because ```html in a code sample is a code sample.
//
// There is no DOM here either, so the nodes below answer exactly what
// `upgradeFences` touches and nothing more.

/** A node that behaves enough like an element for the upgrade to run. */
function elem(tag) {
  return {
    tagName: tag,
    className: "",
    textContent: "",
    parentElement: null,
    attrs: /** @type {Record<string, string>} */ ({}),
    kids: /** @type {any[]} */ ([]),
    setAttribute(name, value) { this.attrs[name] = value; },
    replaceWith(next) {
      const parent = this.parentElement;
      next.parentElement = parent;
      parent.kids[parent.kids.indexOf(this)] = next;
    },
  };
}

/** A `<pre><code class="language-<info>">source</code></pre>` pair, which is
 *  exactly what markdown-it leaves behind — `tests/markdown.test.js` holds that
 *  joint against the real parser. */
function fence(info, source) {
  const box = elem("DIV");
  const pre = elem("PRE");
  const code = elem("CODE");
  code.className = "language-" + info;
  code.textContent = source;
  code.parentElement = pre;
  pre.kids = [code];
  pre.parentElement = box;
  box.kids = [pre];
  return { box, pre, code };
}

/** Load `guest/plugins/markdown.js` and reach its private `upgradeFences` the
 *  way a page reaches it: through `mount`. Markdown-it is stubbed to a renderer
 *  that draws nothing, because the rendered HTML is not what is under test —
 *  `tests/markdown.test.js` holds the real parser to the joint this relies on,
 *  and what is under test here is the dispatch that happens after it. */
function fences(registered, made) {
  const glob = /** @type {any} */ (globalThis);
  const said = [];
  // THE LOADER NAMES THE FILE, and it has to here: `markdown` is a part kind, so
  // only `plugins/markdown.js` may register it. Left unset the registry refuses
  // the plugin and the test fails on the reservation rather than on the fence.
  glob.__gRuntime = { report: (m) => said.push(m), pluginFile: "markdown.js" };
  delete glob.biom;
  glob.document = {
    currentScript: null,
    createElement: (tag) => elem(tag.toUpperCase()),
  };
  glob.markdownit = () => ({
    inline: { ruler: { before() {} } },
    render: () => "",
    parse: () => [],
  });
  new Function(readFileSync(new URL("../guest/runtime/registry.js", import.meta.url), "utf8"))();
  new Function(readFileSync(new URL("../guest/plugins/markdown.js", import.meta.url), "utf8"))();

  /** @type {{id: string, source: string}[]} */
  const drew = [];
  const ctx = {
    options: {},
    text: (s) => s,
    has: (id) => registered.includes(id),
    use: (id) => ({
      id,
      mount: (_node, _content, opts) => { drew.push({ id, source: opts.source }); },
    }),
  };
  const node = {
    setAttribute() {},
    set innerHTML(_v) {},
    querySelectorAll: () => made.map((m) => m.code),
  };
  glob.__gRuntime.plugins.get("markdown").mount(node, null, ctx);
  delete glob.document;
  delete glob.markdownit;
  return { drew, said };
}

test("a fence naming a plugin this vault carries is handed to it — mermaid included", () => {
  // THE VAULT'S OWN COPY. Nothing in the framework names mermaid any more, and
  // this passes anyway: the vault registered a plugin called `mermaid`, so the
  // fence that names it goes there. The same line is what makes `plugins/flow.js`
  // and a ```flow fence work, which is the point of dropping the name.
  const made = [fence("mermaid", "flowchart TB\n  a --> b")];
  const { drew } = fences(["markdown", "mermaid"], made);
  expect(drew).toEqual([{ id: "mermaid", source: "flowchart TB\n  a --> b" }]);
  // The fence was REPLACED in place, and the holder says which plugin took it.
  expect(made[0].box.kids[0].tagName).toBe("DIV");
  expect(made[0].box.kids[0].attrs["data-g-fence"]).toBe("mermaid");
});

test("a fence naming nothing registered stays an ordinary code block", () => {
  // THE DEFAULT NOW THAT MERMAID IS NOT SHIPPED. A fresh vault has no plugin by
  // that name, so a page carrying an old mermaid fence draws its source rather
  // than a blank rectangle — which is the correct reading of a fence naming a
  // language this workspace has no drawing for.
  const made = [fence("mermaid", "flowchart TB\n  a --> b"), fence("js", "var a = 1;")];
  const { drew } = fences(["markdown"], made);
  expect(drew).toEqual([]);
  expect(made[0].box.kids[0].tagName).toBe("PRE");
});

test("a fence naming a PART KIND is a code sample and is never executed", () => {
  // ```html in a page about section markup is somebody showing their markup.
  // Every part kind is also a registered plugin, so without the exclusion the
  // sample would be drawn as the page instead of shown as a sample.
  const made = [fence("html", "<div data-g-part=\"body\"></div>"), fence("markdown", "# a heading")];
  const { drew } = fences(["markdown", "html", "table", "child"], made);
  expect(drew).toEqual([]);
});
