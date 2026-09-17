// SPDX-License-Identifier: AGPL-3.0-only
// The box's own code, run outside the box.
//
// `guest/` is classic scripts sharing globals — no imports, no exports, and a
// `biom.plugins.register` call at the top level — because a module script
// does not load at an opaque origin. That shape is right for the browser and
// awkward for a test runner, so the file is read and evaluated against a
// stand-in registry. It is the same source the box loads, byte for byte; only
// the globals around it are ours.
//
// WHAT THIS CANNOT SEE, stated so nobody reads a green run as more than it is:
// there is no DOM here, so mounting, the caret and the chrome are not covered.
// They are covered in a browser, which is where they are real.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import MarkdownIt from "../vendor/markdown-it.mjs";

const glob = /** @type {any} */ (globalThis);

/** The two globals the box provides, left in place for the whole file rather
 *  than restored around each load. A plugin builds its renderer LAZILY, on the
 *  first call — so restoring `markdownit` after evaluation takes the library
 *  away before the plugin ever reaches for it, and every answer quietly becomes
 *  the plugin's own library-is-missing fallback. Which is a green-looking way
 *  to test nothing. */
glob.markdownit = (/** @type {any} */ o) => new MarkdownIt(o);

/** Evaluate a guest plugin and hand back what it registered. @param {string} rel */
function plugin(rel) {
  /** @type {any} */
  let registered = null;
  glob.biom = { plugins: { register: (/** @type {any} */ d) => { registered = d; } } };
  new Function(readFileSync(new URL("../" + rel, import.meta.url), "utf8"))();
  return registered;
}

const markdown = plugin("guest/plugins/biom-markdown.js");

/** The edit wave, evaluated the same way. It hangs itself on the runtime
 *  namespace and, finding no `rt.page`, reports that it loaded early and wires
 *  no listeners — which is exactly the shape that lets its pure half be tested
 *  here. `segments` is that half. */
function editWave() {
  glob.__gRuntime = { report: () => {} };
  new Function(readFileSync(new URL("../guest/runtime/edit.js", import.meta.url), "utf8"))();
  return glob.__gRuntime.edit;
}

const edit = editWave();

/* ── where one block ends and the next begins ──────────────────────────── */

test("a fence holding a blank line is ONE block, and so is a list", () => {
  // The reason `blocks` asks markdown-it instead of splitting on blank lines.
  // Both of these tear in half under the obvious implementation, and they tear
  // WHILE somebody is typing in them, which is the worst moment for it.
  const src = [
    "# Title",
    "",
    "A paragraph.",
    "",
    "```js",
    "let a = 1;",
    "",
    "let b = 2;",
    "```",
    "",
    "- one",
    "- two",
    "",
    "Last.",
  ].join("\n");

  const cut = markdown.blocks(src).map((r) => src.slice(r.start, r.end));
  expect(cut).toEqual([
    "# Title",
    "A paragraph.",
    "```js\nlet a = 1;\n\nlet b = 2;\n```",
    "- one\n- two",
    "Last.",
  ]);
});

test("the ranges do NOT cover the string, so the editor can draw the gaps as gaps", () => {
  // The blank lines between blocks belong to no block. The editor draws them as
  // segments of their own, so somebody's spacing comes back exactly as they
  // left it rather than being renormalised the first time they type.
  const src = "One.\n\n\n\nTwo.";
  const ranges = markdown.blocks(src);
  expect(ranges.map((r) => src.slice(r.start, r.end))).toEqual(["One.", "Two."]);
});

test("SEGMENTS COVER THE SOURCE, which is what makes the editor's text the stored text", () => {
  // The identity the whole open-slot design rests on: the editor's children hold
  // exact slices, so reading them back in order IS the source. If this can fail,
  // typing anywhere can silently rewrite the parts nobody touched.
  const src = "# Title\n\nA paragraph.\n\n\n- one\n- two\n";
  const segs = edit.segments(src, markdown.blocks(src));
  expect(segs.map((s) => src.slice(s.from, s.to)).join("")).toBe(src);
  expect(segs.map((s) => s.kind + ":" + s.tag)).toEqual([
    "blk:h1", "gap:div", "blk:p", "gap:div", "blk:ul",
  ]);
});

test("A BLOCK OWNS THE NEWLINE THAT ENDS IT, so a gap of two newlines is one blank line", () => {
  // A pre-wrap block draws no extra line for a trailing newline. Left in the
  // gap instead, every paragraph would sit a line lower than the same source
  // does in a file.
  const src = "# T\n\nP";
  const segs = edit.segments(src, markdown.blocks(src));
  expect(segs.map((s) => src.slice(s.from, s.to))).toEqual(["# T\n", "\n", "P"]);
});

test("a block's tag is the one the renderer would draw it as, and an unknown one opens as a paragraph", () => {
  // What the sizing rests on now: no computed style is mirrored anywhere, so a
  // block is heading-sized because it IS an h1 in a region the scale styles.
  const tags = (/** @type {string} */ src) => markdown.blocks(src).map((r) => r.tag);
  expect(tags("## Two")).toEqual(["h2"]);
  expect(tags("```js\nlet a = 1;\n```")).toEqual(["pre"]);
  expect(tags("    indented")).toEqual(["pre"]);
  expect(tags("- one\n- two")).toEqual(["ul"]);
  expect(tags("> quoted")).toEqual(["blockquote"]);
  // An html block has no tag of its own; the editor falls back to a paragraph.
  expect(tags("<figure>hi</figure>")).toEqual([""]);
  expect(edit.segments("<figure>hi</figure>", markdown.blocks("<figure>hi</figure>"))[0].tag).toBe("p");
});

test("a variable is still a variable after a block has been cut out of the source", () => {
  // The whole reason live preview exists rather than contenteditable over the
  // rendered output: what is edited is the SOURCE, so `{{rate}}` survives being
  // typed around instead of being replaced by whatever it happened to resolve
  // to.
  const src = "The rate is {{rate}}.\n\nAnd it holds.";
  const [first] = markdown.blocks(src);
  expect(src.slice(first.start, first.end)).toBe("The rate is {{rate}}.");
});

test("an empty source has no blocks, and unparseable source is one block", () => {
  expect(markdown.blocks("")).toEqual([]);
  // Not a failure mode — somebody is mid-sentence. One region is a worse edit
  // surface than five and a far better one than none.
  expect(markdown.blocks("just words").length).toBe(1);
});

test("`edit` and `blocks` travel together, and a plugin that declares neither is not editable", () => {
  expect(markdown.edit).toBe(true);
  expect(typeof markdown.blocks).toBe("function");
  for (const rel of ["guest/plugins/biom-table.js", "guest/plugins/biom-child.js", "guest/plugins/biom-html.js"]) {
    // Each says `edit: false` for its own reason, in its own file. None of them
    // is the absence of a decision.
    expect(plugin(rel).edit).toBe(false);
  }
});

test("a heading and the paragraph under it are two blocks, so each is drawn at its own size", () => {
  // What the editor's sizing rests on. The whole slot opens at once, and each
  // block inside it is an element of its own tag — so the heading has to BE its
  // own block, or its line and the line under it would share one size.
  const src = "# Visiting\n\nNo address established.";
  const found = markdown.blocks(src);
  expect(found.map((r) => src.slice(r.start, r.end)))
    .toEqual(["# Visiting", "No address established."]);
  expect(found.map((r) => r.tag)).toEqual(["h1", "p"]);
});

/* ── the type scale's one non-mechanical decision ──────────────────────── */

/** `scale.js` is a classic script that hangs itself on the runtime namespace and
 *  touches the DOM only when it installs. Evaluating it against a stand-in gives
 *  the generated stylesheet without a browser. */
function scaleSheet() {
  const glob = /** @type {any} */ (globalThis);
  glob.__gRuntime = {};
  new Function(readFileSync(new URL("../guest/runtime/scale.js", import.meta.url), "utf8"))();
  return String(glob.__gRuntime.scale.sheet());
}

test("BODY SIZE IS DECLARED ON THE PAGE, so a section rule at ANY depth wins", () => {
  // Three real failures pin this, all the same mistake wearing different
  // clothes, all measured on real pages:
  //
  //   `font-size` on `p`    — a section sizing the SLOT lost, because markdown
  //                           wraps its words in a block the section never named
  //   `max-width` on region — every region got a reading measure nobody asked for
  //   `font-size` on region — a section sizing an ANCESTOR of the slot lost, and
  //                           a ledger's values drew at 17px instead of .7rem
  //
  // The cascade layer never helped, because an unlayered rule beats a layered
  // one only where the two target the SAME element. Declared on the page and
  // inherited, the scale competes with nobody.
  const css = scaleSheet();
  const page = css.match(/#g-page \{([^}]*)\}/);
  expect(page, "the page rule must exist").not.toBeNull();
  expect(page[1]).toContain("font-size: var(--md-p-size");
  expect(page[1]).toContain("line-height: var(--md-p-leading");
  // And nothing sets a size on the region itself, or a section sizing the row
  // above a slot would lose all over again.
  expect(css).not.toMatch(/\[data-g-md\] \{[^}]*font-size/);

  const para = css.match(/\[data-g-md\] p \{([^}]*)\}/);
  expect(para, "the paragraph rule must exist").not.toBeNull();
  // Not repeated here, or the point would be undone.
  expect(para[1]).not.toContain("font-size");
  expect(para[1]).not.toContain("line-height");
  // What is left is the part a section rarely sets and the scale should own.
  expect(para[1]).toContain("margin-block-start");
});

test("a heading keeps its own size, because inheriting would flatten every one of them", () => {
  // The opposite decision, and for the opposite reason: a heading is DELIBERATELY
  // unlike body text, so on a workspace with no scale at all it must fall back to
  // the browser's own size rather than to the region's.
  const css = scaleSheet();
  const h1 = css.match(/\[data-g-md\] h1 \{([^}]*)\}/);
  expect(h1[1]).toContain("font-size: var(--md-h1-size, revert)");

  // A list is the in-between case: it follows the region unless the scale speaks
  // about lists on purpose, so a list inside a small-text region stays small.
  const li = css.match(/\[data-g-md\] li \{([^}]*)\}/);
  expect(li[1]).toContain("font-size: var(--md-li-size, inherit)");
});

test("the whole sheet is in a cascade layer, which is what makes a section win", () => {
  expect(scaleSheet().startsWith("@layer biom.scale {")).toBe(true);
});

/* ── the order a section is built in ───────────────────────────────────── */

test("A SECTION IS DRESSED BETWEEN FILLING ITS SLOTS AND RUNNING ITS SCRIPT", () => {
  // This is a source-order assertion because there is no DOM here, and it is
  // worth having anyway: the bug it guards was invisible and expensive.
  //
  // The edit wave re-draws a markdown slot as a run of separately-tagged blocks,
  // which replaces every node the plugin just made. It used to run as a pass
  // over the FINISHED page — after every section's script had already decorated
  // what was on screen — so a script that classed a table's cells had its work
  // thrown away moments later. The symptom was a script that plainly ran, threw
  // nothing, and plainly did nothing: on the report page the share column's bars
  // and its flagged rows simply never drew, and it read as a broken script
  // rather than as a runtime that had undone it.
  const src = readFileSync(new URL("../guest/runtime/sections.js", import.meta.url), "utf8");
  const draw = src.slice(src.indexOf("function draw("));

  const fill = draw.indexOf("fillSlots(el,");
  const dress = draw.indexOf("env.dress(el,");
  const scripts = draw.indexOf("runScripts(el,");

  expect(fill, "draw() must fill the slots").toBeGreaterThan(-1);
  expect(dress, "draw() must hand the section to the edit wave").toBeGreaterThan(-1);
  expect(scripts, "draw() must run the section's scripts").toBeGreaterThan(-1);

  expect(dress).toBeGreaterThan(fill);
  expect(scripts).toBeGreaterThan(dress);
});

/* ── every page renders itself as markdown ─────────────────────────────── */

/** `project.js` is a classic script hanging itself on the runtime namespace, and
 *  it is a HAND COPY of `contracts/projection.ts` — nothing may import `guest/`
 *  and `guest/` imports nothing, so the box cannot share the server's module.
 *  This is the pair that keeps them from drifting. */
function guestProject() {
  const glob = /** @type {any} */ (globalThis);
  glob.__gRuntime = {};
  new Function(readFileSync(new URL("../guest/runtime/project.js", import.meta.url), "utf8"))();
  return glob.__gRuntime.project;
}

/** A page exercising every branch: a heading the page's own name repeats, a
 *  markdown part with a variable, a list, an html part that says nothing, a
 *  table named rather than inlined, and two child links that have to run
 *  together as one list. */
const PROJECTED = {
  name: "Clients",
  variables: { rate: 62, crew: ["Ana", "Bo"], quarter: null },
  sections: [
    {
      name: "intro",
      fallback: false,
      parts: {
        body: { kind: "markdown", md: "# Clients\n\nThe rate is {{rate}} with {{crew}}.", vars: { rate: 62, crew: ["Ana", "Bo"] } },
        aside: { kind: "html", file: "aside.html", html: "<p>Drawn, not written</p>", vars: {} },
      },
      vars: {},
    },
    {
      name: "jobs",
      fallback: false,
      parts: {
        items: { kind: "list", items: [
          { kind: "markdown", md: "### Alpha", vars: {} },
          { kind: "markdown", md: "### Bravo", vars: {} },
        ] },
        grid: { kind: "table", table: "jobs" },
      },
      vars: {},
    },
    { name: "@page-Ashgrove", fallback: false, parts: { body: { kind: "child", child: { kind: "page", id: "home/Clients/Ashgrove", name: "Ashgrove" } } }, vars: {} },
    { name: "@page-benn", fallback: false, parts: { body: { kind: "child", child: { kind: "page", id: "home/Clients/benn", name: "Benn & Co" } } }, vars: {} },
    { name: "empty", fallback: false, parts: {}, vars: {} },
  ],
};

test("the box and the server project a doc page to the same markdown, character for character", async () => {
  const { projectDoc } = await import("../contracts/projection.ts");
  expect(guestProject().doc(PROJECTED)).toBe(projectDoc(/** @type {any} */ (PROJECTED)));
});

test("a projection resolves variables, links children as one list, and says nothing for html", () => {
  const md = guestProject().doc(PROJECTED);
  // The page's own `# Clients` is dropped: the file the mirror writes opens with
  // the name already, and two identical H1s is the first thing a reader notices
  // about a generated archive.
  expect(md.startsWith("# Clients")).toBe(false);
  // A list variable joins with ", " and reads as a sentence.
  expect(md).toContain("The rate is 62 with Ana, Bo.");
  // A SECTION'S NAME NEVER BECOMES A HEADING. It is a block id — the handle the
  // runtime addresses it by — and a heading named after one is a heading nobody
  // wrote. Emitting them also put `## note` above a page's real title, which
  // stopped the projection opening with that title and defeated the dedupe
  // above: the file came out with three headings.
  expect(md).not.toContain("## jobs");
  expect(md).not.toMatch(/^## /m);
  // An html part contributes nothing: its markup is the section's drawing and
  // its words are markdown parts beside it.
  expect(md).not.toContain("Drawn, not written");
  // A table names itself rather than inlining rows that change without the page
  // changing.
  expect(md).toContain("*(table: jobs)*");
  // Two children are two bullets of ONE list, not two lists of one.
  expect(md).toContain("- [[home/Clients/Ashgrove|Ashgrove]]\n- [[home/Clients/benn|Benn & Co]]");
});

test("a page with one section gets no heading it did not ask for", () => {
  const one = { name: "Solo", variables: {}, sections: [PROJECTED.sections[1]] };
  expect(guestProject().doc(one)).not.toContain("## jobs");
});

test("the registry carries `blocks` through, because a plugin's def is not what the runtime holds", () => {
  // The gap this closes was found in a browser and not here: `blocks` was on the
  // plugin and absent from the registry's copy, so every part was edited whole
  // while every test that asked the PLUGIN said otherwise. The registry builds
  // its entry field by field on purpose — a plugin cannot smuggle one past it —
  // which is exactly why a new field has to be added in two places.
  const glob = /** @type {any} */ (globalThis);
  glob.__gRuntime = {};
  // `whereFrom` falls back to `document.currentScript` when the loader named no
  // file; there is no DOM here, so it gets the smallest stand-in that lets the
  // question be asked at all.
  glob.document = { currentScript: null };
  new Function(readFileSync(new URL("../guest/runtime/registry.js", import.meta.url), "utf8"))();
  const rt = glob.__gRuntime;
  rt.plugins.register({ id: "probe", edit: true, mount() {}, blocks: (s) => [{ start: 0, end: s.length }] });
  const held = rt.plugins.get("probe");
  expect(typeof held.blocks).toBe("function");
  expect(held.blocks("abc")).toEqual([{ start: 0, end: 3 }]);
  // And a plugin that declares none is edited as one region, with nothing there
  // to call.
  rt.plugins.register({ id: "plain", edit: true, mount() {} });
  expect(rt.plugins.get("plain").blocks).toBeUndefined();
  delete glob.document;
});

test("the registry's PART_KINDS is the format's own PartKind, because the box cannot import it", async () => {
  // The registry's header says this pair exists and it did not, which is the
  // worst state for a roster to be in: a kind added to `PartKind` without being
  // added there would be a part whose slot draws nothing, reported as a page
  // author's mistake, with a comment in the registry promising a test that would
  // have caught it. Same arrangement as `project.js` above.
  const types = readFileSync(new URL("../contracts/types.ts", import.meta.url), "utf8");
  const union = /export type PartKind =([^;]+);/.exec(types);
  expect(union).not.toBeNull();
  const kinds = [...union[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
  expect(kinds.length).toBeGreaterThan(0);

  // Read off the RUNNING registry rather than off its source: what the rule is
  // enforced against is the behaviour, so that is what is held equal.
  const glob = /** @type {any} */ (globalThis);
  glob.__gRuntime = {};
  glob.document = { currentScript: null };
  new Function(readFileSync(new URL("../guest/runtime/registry.js", import.meta.url), "utf8"))();
  const rt = glob.__gRuntime;
  const said = [];
  rt.report = (m) => said.push(m);

  // A kind is reserved: only `plugins/<kind>.js` may draw it, and any other file
  // is refused in the sentence naming it.
  const refused = kinds.filter((kind) => {
    rt.pluginFile = "0-notes.js";
    return rt.plugins.register({ id: kind, mount() {} }) === false;
  });
  expect(refused).toEqual(kinds);
  expect(said.filter((m) => m.includes("is a part kind"))).toHaveLength(kinds.length);

  // And a kind the format does NOT have is an ordinary id, free for anybody's
  // file — which is what makes the list above a list rather than a habit.
  rt.pluginFile = "0-notes.js";
  expect(rt.plugins.register({ id: "timeline", mount() {} })).toBe(true);

  delete rt.pluginFile;
  delete glob.document;
});

test("a page that fills itself later can ask for its projection to be taken again", () => {
  // The projection is taken the moment a page has drawn, which is right for a
  // document and wrong for anything that fetches: a board asks for its rows over
  // the port, so at the moment it drew it was an empty board — and the empty
  // projection it reported went to disk and stayed there. The page says when it
  // has something to say, and it says it with a DOM event because the message
  // never leaves the box.
  const boot = readFileSync(new URL("../guest/runtime/boot.js", import.meta.url), "utf8");
  expect(boot).toContain('document.addEventListener("biom:rendered"');
  // Coalesced, or a board that draws per row writes a file per row.
  expect(boot).toContain("projectSoon");
  const kanban = readFileSync(new URL("../guest/plugins/biom-kanban/kanban.js", import.meta.url), "utf8");
  expect(kanban).toContain('new CustomEvent("biom:rendered")');
  // The map reads every page over the port before it has anything to say.
  const mindmap = readFileSync(new URL("../guest/plugins/biom-mindmap/mindmap.js", import.meta.url), "utf8");
  expect(mindmap).toContain('new CustomEvent("biom:rendered")');
});

/* ── wikilinks ─────────────────────────────────────────────────────────── */

// A `[[wikilink]]` IS A PARSER RULE and not a pass over the rendered output.
// That is the whole reason one inside a fence or a code span survives: those are
// decided by earlier rules, and this one never sees the text.

/** Mount the plugin against a node that is only what `mount` actually touches,
 *  and hand back the html it wrote. There is no DOM here, and the alternative —
 *  reaching into the plugin's private renderer — would test a different object
 *  than the one a page uses. */
function rendered(source) {
  let html = "";
  const node = {
    setAttribute() {},
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelectorAll: () => [],
  };
  markdown.mount(node, { kind: "markdown", md: source }, {
    text: (/** @type {string} */ t) => t,
    options: {},
    has: () => false,
    use: () => null,
  });
  return html;
}

test("a wikilink becomes a link carrying its raw target, and resolves nothing", () => {
  const out = rendered("See [[home/Companies/Airtable|Airtable]] for the pricing.");
  expect(out).toContain('data-g-link="home/Companies/Airtable"');
  expect(out).toContain(">Airtable</a>");
  // An href, because an anchor without one cannot be tabbed to — and because the
  // edit wave leaves `a[href]` alone, so without it a click would open the
  // paragraph for editing instead of following the link.
  expect(out).toContain('href="#"');
});

test("a wikilink with no alias reads as its target", () => {
  const out = rendered("[[Airtable]]");
  expect(out).toContain('data-g-link="Airtable"');
  expect(out).toContain(">Airtable</a>");
});

test("a wikilink inside code is not a link, in a fence or in a span", () => {
  const fence = rendered("```\n[[Airtable]]\n```");
  expect(fence).not.toContain("data-g-link");
  expect(fence).toContain("[[Airtable]]");

  const span = rendered("write `[[Airtable]]` to link it");
  expect(span).not.toContain("data-g-link");
  expect(span).toContain("[[Airtable]]");
});

test("two brackets that are not a wikilink are left to markdown-it", () => {
  // No closing pair: this is text, and the ordinary rules read it.
  expect(rendered("[[unclosed and then nothing")).not.toContain("data-g-link");
  // An ordinary link still works, and a nested one is not a wikilink.
  const ordinary = rendered("[label](https://example.com)");
  expect(ordinary).toContain('href="https://example.com"');
  expect(ordinary).not.toContain("data-g-link");
  // An empty target names nothing, so it is not one.
  expect(rendered("[[]]")).not.toContain("data-g-link");
});

// AN ORDINARY LINK WHOSE LABEL HOLDS A WIKILINK STAYS AN ORDINARY LINK, and
// getting this wrong was not a corner: markdown-it counts a nested `[` only when
// the rule it asked advanced by EXACTLY ONE character, so a rule that jumps past
// `]]` while VALIDATING a label makes it abandon the whole `link` rule. The
// symptom was `[read the [[Pricing]] note](https://…)` rendering as literal
// brackets with the url linkified beside them.
test("a wikilink inside a real link's label leaves that link alone", () => {
  const out = rendered("[read the [[Pricing]] note](https://example.com/pricing)");
  expect(out).toContain('href="https://example.com/pricing"');
  // One anchor, not two: the url must not have been linkified separately.
  expect(out.match(/<a /g)).toHaveLength(1);
  // And no nested anchor, which is not a thing HTML has.
  expect(out).not.toContain("data-g-link");
  expect(out).toContain("[[Pricing]]");

  // AN IMAGE IS THE ONE PLACE IT STILL FIRES, and that is the better reading.
  // `linkLevel` is not raised for an image's label, so the rule runs and
  // markdown-it flattens the tokens to text for `alt` — which drops the brackets
  // and keeps the words. Nothing in alt text can be clicked, so a wikilink
  // written there meant its label; the image itself is untouched.
  const img = rendered("![img [[a]] x](u.png)");
  expect(img).toContain('src="u.png"');
  expect(img).toContain('alt="img a x"');
  expect(img).not.toContain("<a ");
});

test("a wikilink survives being split into blocks, so it can be edited", () => {
  // `blocks` reads top-level tokens, and an inline rule adds none — a paragraph
  // holding a link is one block, exactly as it was before.
  const src = "First.\n\nSee [[Airtable]] here.\n\nLast.";
  expect(markdown.blocks(src).map((r) => src.slice(r.start, r.end)))
    .toEqual(["First.", "See [[Airtable]] here.", "Last."]);
});

/* ── the shim's own surface ────────────────────────────────────────────────
 * `guest/biom.js` is what a section actually holds, and it is the half of the
 * contract that cannot be typechecked: it builds its requests as object
 * literals, so a field spelled wrong here is a call that resolves to nothing
 * and says nothing. These stand the shim up against a window of our own and
 * read what it puts on the wire.                                            */

/** The smallest window and document the shim will boot against, plus the two
 *  ports the host transfers at the handshake. `sent` is everything that went
 *  down the ordinary port; `answer` replies to one call by id.
 *  @param {Record<string, any>} [answers] one value per kind */
function shim(answers = {}) {
  /** @type {any[]} */
  const sent = [];
  /** @type {((ev: any) => void)[]} */
  const onWindowMessage = [];

  /** A port far enough to carry a call and its answer back. */
  const makePort = () => {
    /** @type {any} */
    const p = {
      onmessage: null,
      postMessage(/** @type {any} */ m) {
        sent.push(m);
        // Answer what we were given an answer for, on the next task, exactly as
        // a real host does. A kind with no answer here simply never resolves,
        // which is the honest stand-in for a host that does not know it.
        if (!(m.kind in answers)) return;
        queueMicrotask(() =>
          p.onmessage && p.onmessage({ data: { id: m.id, g: 1, ok: true, value: answers[m.kind] }, ports: [] }));
      },
      close() {},
    };
    return p;
  };

  const el = () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {} },
    children: [],
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
  });

  /** @type {any} */
  const doc = {
    documentElement: el(),
    scrollingElement: null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: el,
    head: { appendChild() {} },
  };

  /** The box's own scroll listeners — what `keep()` registers on a box of its own. */
  /** @type {(() => void)[]} */
  const onScroll = [];

  /** @type {any} */
  const win = {
    parent: { postMessage() {} },
    addEventListener(/** @type {string} */ k, /** @type {any} */ fn) {
      if (k === "message") onWindowMessage.push(fn);
      if (k === "scroll") onScroll.push(fn);
    },
    removeEventListener(/** @type {string} */ k, /** @type {any} */ fn) {
      const at = onWindowMessage.indexOf(fn);
      if (k === "message" && at >= 0) onWindowMessage.splice(at, 1);
    },
    scrollTo() {},
  };

  const src = readFileSync(new URL("../guest/biom.js", import.meta.url), "utf8");
  new Function("window", "document", "setTimeout", "clearTimeout", src)(
    win, doc, (/** @type {any} */ fn, /** @type {any} */ ms) => setTimeout(fn, ms), clearTimeout);

  const ports = [makePort(), makePort()];
  for (const fn of [...onWindowMessage])
    fn({ data: { kind: "ports", g: 1, page: "home" }, ports });

  return { biom: win.biom, sent, win, doc, ports, scroll: onScroll };
}

test("biom.vault() asks the host which folder this is, and names no folder of its own", async () => {
  // A page may know where it lives because a person reading it has to be able
  // to point an agent at it. It may NOT look around: the kind carries no path,
  // so there is nothing to ask about a folder that is not this one.
  const info = { path: "/home/you/Notes", name: "Notes", seeded: true, history: true };
  const { biom, sent } = shim({ "theme.get": null, "data.get": {}, "vault.info": info });

  expect(await biom.vault()).toEqual(info);

  const asked = sent.filter((m) => m.kind === "vault.info");
  expect(asked).toHaveLength(1);
  // The envelope and the kind, and NOTHING else. A field here would be a field
  // a page could point at another folder.
  expect(Object.keys(asked[0]).sort()).toEqual(["g", "id", "kind"]);
});

test("the shim offers no way to browse, open or make a folder", () => {
  // The other four `vault.*` kinds are outer-ring. Nothing in here wraps one,
  // and the guard would refuse it if something did.
  const { biom } = shim({ "theme.get": null, "data.get": {} });
  for (const name of ["browse", "openVault", "createVault", "recentVaults", "vaults"])
    expect(biom[name]).toBeUndefined();
});

/* ── a redraw keeps the reader's place, and the box is the half that measures ──
 * The host holds where the old realm said it was scrolled to and hands it to
 * the new one as `place`; what the new realm does with it is clamp it to ITS
 * run and go there instantly — one frame on, and once more after a bounded
 * settle for a layout that was still growing. And it says where it is as it
 * scrolls, one `position` per frame, which is what the host has to hand back.
 * The fake window has no rAF, so a "frame" here is a task; the settle is the
 * shim's own constant and the waits below are longer than it.                */

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

test("`place` puts the box at the old position clamped to the new run, twice and no more", async () => {
  const { win, doc, ports } = shim({ "theme.get": null, "data.get": {} });
  const root = doc.documentElement;
  Object.assign(root, { scrollTop: 0, scrollLeft: 0, scrollHeight: 1000, clientHeight: 600 });
  /** @type {any[]} */
  const moves = [];
  win.scrollTo = (/** @type {any} */ o) => { moves.push(o); root.scrollTop = Math.min(o.top, root.scrollHeight - root.clientHeight); };

  // The page got shorter: 900 is past the foot of a 400-pixel run, so the box
  // lands at the foot rather than past it. INSTANT, whatever the page's own
  // `scroll-behavior` says.
  root.style.overflowAnchor = "auto";
  ports[1].onmessage({ data: { kind: "place", top: 900 }, ports: [] });
  await wait(60);
  expect(moves).toEqual([{ top: 400, left: 0, behavior: "instant" }]);
  // SCROLL ANCHORING IS OFF WHILE THE TWO APPLICATIONS RUN. Measured: the
  // fonts landed after the first one and the browser moved the box 52 px to
  // keep the visible anchor still, and the second read that as the reader's.
  // The rule is the same scrollTop, not the same anchor.
  expect(root.style.overflowAnchor).toBe("none");

  // The layout grew before the settle — fonts, images, a section script — and
  // the box is still exactly where the first application put it, so the
  // second one takes it the rest of the way.
  root.scrollHeight = 2000;
  await wait(300);
  expect(moves).toEqual([
    { top: 400, left: 0, behavior: "instant" },
    { top: 900, left: 0, behavior: "instant" },
  ]);

  // And no third: nothing polls. Another 300 ms changes nothing, and the
  // page's own anchoring is back the way it was.
  root.scrollHeight = 3000;
  await wait(300);
  expect(moves).toHaveLength(2);
  expect(root.style.overflowAnchor).toBe("auto");
});

test("the second application yields to a box that has moved since the first", async () => {
  const { win, doc, ports } = shim({ "theme.get": null, "data.get": {} });
  const root = doc.documentElement;
  Object.assign(root, { scrollTop: 0, scrollLeft: 0, scrollHeight: 2000, clientHeight: 600 });
  /** @type {any[]} */
  const moves = [];
  win.scrollTo = (/** @type {any} */ o) => { moves.push(o); root.scrollTop = o.top; };

  ports[1].onmessage({ data: { kind: "place", top: 640 }, ports: [] });
  await wait(60);
  expect(moves).toEqual([{ top: 640, left: 0, behavior: "instant" }]);

  // The reader scrolled on in the meantime. Where they went is where they stay.
  root.scrollTop = 1200;
  await wait(300);
  expect(moves).toHaveLength(1);

  // A malformed `place` is ignored rather than sending the box to the top.
  ports[1].onmessage({ data: { kind: "place" }, ports: [] });
  ports[1].onmessage({ data: { kind: "place", top: "640" }, ports: [] });
  await wait(60);
  expect(moves).toHaveLength(1);
});

test("a box of its own reports where it is scrolled to, one `position` per frame, in pixels", async () => {
  const { sent, doc, scroll } = shim({ "theme.get": null, "data.get": {} });
  const root = doc.documentElement;
  Object.assign(root, { scrollTop: 0, scrollHeight: 2000, clientHeight: 600 });
  // Registered once the ports arrived — a box of its own, not told it is
  // embedded, is the one that reports to the host.
  expect(scroll).toHaveLength(1);

  // Three scroll events in one frame are one notice, carrying where the box
  // IS when the frame comes round, not where it was at the first event.
  root.scrollTop = 100; scroll[0]();
  root.scrollTop = 250; scroll[0]();
  root.scrollTop = 640; scroll[0]();
  await wait(60);
  const said = sent.filter((m) => m.kind === "position");
  expect(said).toEqual([{ kind: "position", g: 1, top: 640 }]);

  // The next frame's scroll is the next notice. Pixels from the top, never a
  // fraction and never a height: the run is measured where it is put back.
  root.scrollTop = 0; scroll[0]();
  await wait(60);
  expect(sent.filter((m) => m.kind === "position")).toEqual([
    { kind: "position", g: 1, top: 640 },
    { kind: "position", g: 1, top: 0 },
  ]);
});
