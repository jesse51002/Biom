// SPDX-License-Identifier: AGPL-3.0-only
// THE SEEDED `doc` DOCUMENT — the page every `plugin: doc` page in every vault
// loads, and the two things it carries beyond `<main id="g-page">`.
//
// A rule in this file's head is a DOCUMENT stylesheet and genuinely reaches a
// section; a section's own `<style>` is wrapped in `@scope (#sec-<name>)` and
// reaches only itself. That asymmetry is the whole reason the figure frame can
// live here at all, and the reason it has to stay in a cascade layer: an
// unlayered author rule beats every layered one, so a section that declares any
// of it still wins.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const DOC = readFileSync(new URL("../guest/plugins/biom-doc/index.html", import.meta.url), "utf8");

/** The stylesheet only. The file's header comment quotes CSS at length, so a
 *  rule ABOUT the stylesheet must never be checked against the prose explaining
 *  it — the first `<style>` in the file is inside that comment. */
const STYLES = (DOC.replace(/<!--[\s\S]*?-->/g, "").match(/<style>[\s\S]*?<\/style>/) ?? [""])[0];

test("the document is still the page the runtime draws into, and says nothing else about layout", () => {
  expect(DOC).toContain('<main id="g-page"></main>');
  // The runtime is spliced in by the host. A document that named it would be a
  // second list of those scripts, and the one that fell behind would be somebody
  // else's page failing to draw.
  expect(DOC).not.toContain("/guest/runtime/");
  // No file in a vault may name the install directory, and this file is seeded
  // into every vault.
  expect(DOC).not.toContain("/guest/plugins/");
});

test("the figure frame is a document stylesheet, in a layer, so a section that declares it still wins", () => {
  // IN A LAYER. `@layer` inverts the cascade by origin rather than by counting:
  // an unlayered author rule beats every layered one whatever its specificity,
  // which is what makes the frame a default and never a ceiling. The same
  // bargain `markdown.yaml`'s type scale already makes.
  expect(DOC).toContain("@layer biom.frame {");

  // The motion switch and its reduced-motion twin, so an animation is written
  // once and turned off in one place.
  expect(DOC).toContain("--motion: 1;");
  expect(DOC).toContain("@media (prefers-reduced-motion: reduce) { :root { --motion: 0; } }");

  // The wrap: a figure's own column, centred, wider than prose, padded off the
  // edge of a phone.
  expect(DOC).toContain(".wrap {");
  expect(DOC).toContain("max-inline-size: 64rem;");
  expect(DOC).toContain("margin-inline: auto;");
  expect(DOC).toContain("padding-inline: 1.25rem;");

  // The flatten pair, reaching the blocks inside a slot and never the slot.
  expect(DOC).toContain(".wrap > * > :first-child { margin-block-start: 0; }");
  expect(DOC).toContain(".wrap > * > :last-child { margin-block-end: 0; }");

  // The reading measure, off the workspace's own scale where it names one.
  expect(DOC).toContain("max-inline-size: var(--md-measure, 34rem);");
});

test("the frame's layer is ordered after the scale's, or the flatten pair is inert", () => {
  // `guest/runtime/scale.js` APPENDS `@layer biom.scale` to this document's head
  // at draw time, so without a declared order it is the LATER layer and beats
  // the frame whatever the specificity — and its `[data-g-md] p { margin-block }`
  // is exactly what the flatten pair is there to remove. Measured on a workspace
  // of 360 sections: every slot's outer margins came back the moment the
  // sections stopped declaring the pair for themselves.
  const order = DOC.indexOf("@layer biom.scale, biom.frame;");
  expect(order).toBeGreaterThan(-1);
  // BEFORE the block, because an order statement only counts where it is first.
  expect(order).toBeLessThan(DOC.indexOf("@layer biom.frame {"));
});

test("the default ink is said in the frame and not said again here", () => {
  // IT USED TO BE HERE, and saying it here meant only a `doc` page read
  // correctly: the design doc's box is woven with no document at all, so it drew
  // its title in black on charcoal on a brand-new vault, and so did any page an
  // author wrote without thinking to say `color: var(--ink)`. `INK` in
  // `client/frame/frame.js` is woven into every box now. Two statements of one
  // rule is one of them going stale, and this is what stops the second coming
  // back.
  expect(STYLES).not.toContain("var(--ink, CanvasText)");
  expect(STYLES).not.toContain("var(--cyan, LinkText)");
});

test("nothing in the document names a colour, because every colour resolves to a token", () => {
  // The palette is re-declared inside the box by the shim, so `var(--ink)` works
  // there — and a literal would be wrong on every palette but one.
  expect(STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(STYLES).not.toMatch(/\b(rgb|hsl|oklch)\(/);
});

test("the board of children is a sibling of the stack, so nothing can place it wrong", () => {
  // INSIDE the stack it would be a section: something to order, something to
  // delete, and something every folder page could get wrong. As a sibling of
  // `<main>` it is unconditionally last and there is nothing to decide.
  const main = DOC.indexOf('<main id="g-page">');
  const board = DOC.indexOf('<footer id="g-holds"');
  expect(board).toBeGreaterThan(main);
  expect(DOC.slice(main, board)).toContain("</main>");
});

test("the board reads the children rather than anything written into the page", () => {
  // R38 — a drawing of a child reads the child. A name copied into a parent is
  // wrong the moment somebody renames that page, with nothing on screen to say
  // so. `children()` is the one place to ask.
  expect(DOC).toContain("biom.children()");
  // And it redraws when one is added or removed, so the board is right without
  // anybody reloading.
  expect(DOC).toContain("biom.onRefresh");
});

test("the parent's own line about a child is two parallel lists, because a variable is never a map", () => {
  expect(DOC).toContain("vars.holds");
  expect(DOC).toContain("vars.holdWords");
});

test("only a BARE reconciled section is hidden, so a parent that wrote a row still gets it", () => {
  // The entries stay and stay authoritative — reconciliation is what guarantees
  // a page created in any way is never missing from its parent. What the
  // document declines is drawing a bare one twice. `[data-g-default]` is the
  // mark the runtime puts on a section that resolved to the shipped default
  // because it named no file of its own, so a `@page-notes.html` somebody wrote
  // is still drawn: they meant that row.
  expect(DOC).toContain('#g-page > [id^="sec-@page-"][data-g-default]');
  expect(DOC).toContain('#g-page > [id^="sec-@table-"][data-g-default]');
  // No `!important` in the stylesheet: nothing here is fighting a section, and
  // nothing is deleted from the DOM that the edit wave might be holding.
  expect(STYLES).not.toContain("!important");
});

/* ── the board's sort, run rather than read ──────────────────────────────── */

/** The board's script, against the smallest DOM that lets it draw. Everything
 *  here answers exactly what the script touches: a stub that grew a feature
 *  nobody called would be a second implementation to keep honest. */
function board(kids: { kind: string; id: string; name: string }[]) {
  const made: any[] = [];
  const el = (): any => {
    const node: any = {
      className: "",
      hidden: false,
      style: { setProperty() {} },
      classList: { add() {} },
      kids: [] as any[],
      on: {} as Record<string, (e: any) => void>,
      attrs: {} as Record<string, string>,
      append(...children: any[]) { node.kids.push(...children); },
      setAttribute(k: string, v: string) { node.attrs[k] = v; },
      getAttribute(k: string) { return node.attrs[k] ?? null; },
      addEventListener(type: string, fn: (e: any) => void) { node.on[type] = fn; },
      querySelector() { return null; },
    };
    // Setting textContent empties the element, which is how the board clears the
    // rows before redrawing them — a stub without it appends every draw to the
    // last one and the test reads a list that never existed.
    let text = "";
    Object.defineProperty(node, "textContent", {
      get: () => text,
      set: (v: string) => { text = String(v); node.kids.length = 0; },
    });
    made.push(node);
    return node;
  };

  const rows = el(), tally = el(), unit = el(), byName = el(), byDate = el(), dirBtn = el();
  const holds = el();
  holds.querySelector = (sel: string) => {
    if (sel === ".rows") return rows;
    if (sel === ".tally b") return tally;
    if (sel === ".tally .unit") return unit;
    if (sel.includes('"name"')) return byName;
    if (sel.includes('"date"')) return byDate;
    if (sel.includes("data-dir")) return dirBtn;
    return null;
  };

  const glob = globalThis as any;
  const had = { document: glob.document, biom: glob.biom, io: glob.IntersectionObserver };
  glob.document = { getElementById: (id: string) => (id === "g-holds" ? holds : null), createElement: el };
  glob.IntersectionObserver = class { observe() {} disconnect() {} };
  glob.biom = {
    children: () => Promise.resolve(kids),
    data: () => Promise.resolve({}),
    onRefresh() {},
    open() {},
  };

  // THE BOARD'S OWN SCRIPT, found by what it draws rather than by position:
  // the document carries a second script now — the conversion of a markdown
  // table into a grid section, verified in tests/grid.test.ts — and a test
  // that took the last one would be evaluating that.
  const script = [...DOC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "").find((s) => s.includes("g-holds")) ?? "";
  new Function(script)();

  /** The names on screen, in the order they were drawn. */
  const drawn = () => rows.kids.map((row: any) => row.kids[1].textContent);
  /** What the direction button says: ↓ is ascending, ↑ is descending. */
  const facing = () => dirBtn.textContent;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    drawn, facing, settle,
    name: () => byName.on.click({}),
    date: () => byDate.on.click({}),
    flip: () => dirBtn.on.click({}),
    done: () => { glob.document = had.document; glob.biom = had.biom; glob.IntersectionObserver = had.io; },
  };
}

const DATED = ["2026-01-01-alpha", "2026-03-01-zulu", "2026-02-01-mike"].map((id) => ({ kind: "page", id: "home/" + id, name: id }));

test("a folder of dated pages opens newest first, and a folder of names opens A to Z", async () => {
  const b = board(DATED);
  await b.settle();
  expect(b.drawn()).toEqual(["zulu", "mike", "alpha"]);
  expect(b.facing()).toBe("↑");
  b.done();
});

test("switching the sort key takes that key's own direction, rather than keeping the last one", async () => {
  // The bug this is the guard on: the key changed and the direction did not, so
  // a folder that opened newest-first switched to names running Z to A — which
  // reads as a broken sort rather than a remembered one.
  const b = board(DATED);
  await b.settle();
  b.name();
  await b.settle();
  expect(b.drawn()).toEqual(["alpha", "mike", "zulu"]);
  expect(b.facing()).toBe("↓");

  // And back the other way: dates want the newest first however names were left.
  b.date();
  await b.settle();
  expect(b.drawn()).toEqual(["zulu", "mike", "alpha"]);
  b.done();
});

test("the direction button stays the deliberate toggle, and pressing the key you are on is not a switch", async () => {
  const b = board(DATED);
  await b.settle();
  b.name();
  await b.settle();
  b.flip();
  await b.settle();
  expect(b.drawn()).toEqual(["zulu", "mike", "alpha"]);

  // Pressing Name again is not a change of key, so the toggle the reader just
  // pressed is not undone under them.
  b.name();
  await b.settle();
  expect(b.drawn()).toEqual(["zulu", "mike", "alpha"]);
  b.done();
});
