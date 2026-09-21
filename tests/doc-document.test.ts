// SPDX-License-Identifier: AGPL-3.0-only
// THE `doc` DOCUMENT — the page every `plugin: doc` page in every vault loads:
// the frame, the hide rule, the conversion, and the two nodes of its own that
// take what `head` and `foot` name. The board those used to hard-wire is
// `tests/holds.test.ts` now, as the plugin it became.
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
  const order = DOC.indexOf("@layer biom.scale, biom.frame, biom.holds;");
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

test("the document draws two nodes of its own around the stack, and they are empty until a variable names something", () => {
  const head = DOC.indexOf('<header id="g-head"></header>');
  const main = DOC.indexOf('<main id="g-page"></main>');
  const foot = DOC.indexOf('<footer id="g-foot"></footer>');
  expect(head).toBeGreaterThan(-1);
  expect(main).toBeGreaterThan(head);
  expect(foot).toBeGreaterThan(main);
  // Nothing is spliced and nothing is hard-wired: the board is a plugin the
  // contract names, and the document reads the name off its own variables.
  const code = DOC.replace(/<!--[\s\S]*?-->/g, "");
  expect(code).not.toContain("biom.children()");
  expect(code).not.toContain('id="g-holds"');
  expect(code).toContain("biom.plugin.extensions()");
  expect(code).toContain("rt.page.mount(");
});

test("the contract declares head with no default, foot as the framework's board, and rows off — and nothing else", () => {
  const contract = readFileSync(new URL("../guest/plugins/biom-doc/plugin.yaml", import.meta.url), "utf8");
  const keys = contract.split("\n").filter((l) => /^[a-z]/.test(l)).map((l) => l.split(":")[0]);
  expect(keys).toEqual(["head", "foot", "rows", "convert"]);
  expect(contract).toMatch(/^head:\s*$/m);
  expect(contract).toMatch(/^foot: biom-holds$/m);
  expect(contract).toMatch(/^rows: false$/m);
  expect(contract).toMatch(/^convert: true$/m);
});

test("the conversion is switched by the document's own convert variable, so a page whose sections hold specimen tables keeps them", async () => {
  // THE BUG THIS IS THE GUARD ON: the design doc is drawn by this document
  // now, its worlds hold markdown tables as specimens, and the first open of a
  // fresh vault's design doc cut eight of them out into grid sections. The
  // seeded design doc says `convert: false` in its rung; this holds the script
  // to reading it.
  const run = async (extensions: Record<string, unknown>) => {
    const glob = globalThis as any;
    const had = { biom: glob.biom, rt: glob.__gRuntime };
    const writes: any[] = [];
    const orders: any[] = [];
    let draw: (() => void) | null = null;
    const withTable = [{
      name: "one", html: "", fallback: true, source: { name: "one", parts: { body: "| a | b |\n|---|---|\n| 1 | 2 |\n" } },
      parts: { body: { kind: "markdown", md: "| a | b |\n|---|---|\n| 1 | 2 |\n", vars: {} } }, vars: {},
    }];
    glob.__gRuntime = {
      page: {
        onDraw: (fn: () => void) => { draw = fn; },
        sections: () => withTable,
        write: (...a: any[]) => { writes.push(a); return Promise.resolve(); },
        order: (...a: any[]) => { orders.push(a); return Promise.resolve(); },
      },
    };
    glob.biom = { plugin: { extensions: () => extensions } };
    const script = [...DOC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "").find((s) => s.includes("rt.convert")) ?? "";
    try {
      new Function(script)();
      if (draw) draw();
      // The order is written after the prose writes settle, a tick later.
      await new Promise((r) => setTimeout(r, 0));
      return { writes, orders };
    } finally {
      glob.biom = had.biom;
      glob.__gRuntime = had.rt;
    }
  };
  // Off: the table stays where it is.
  expect(await run({ convert: false })).toEqual({ writes: [], orders: [] });
  // On, and when nothing was declared at all: the table is cut out.
  expect((await run({ convert: true })).orders).toHaveLength(1);
  expect((await run({})).orders).toHaveLength(1);
});

test("the board's look is a document stylesheet in its own layer, keyed on what the plugin draws, so it reaches the board wherever it is mounted", () => {
  expect(DOC).toContain("@layer biom.scale, biom.frame, biom.holds;");
  expect(DOC).toContain("@layer biom.holds {");
  expect(STYLES).toContain(".g-holds .row {");
  expect(STYLES).not.toContain("#g-holds");
  expect(STYLES).not.toContain("#g-foot .");
});

test("only a BARE reconciled section is hidden, the rule is the document's rather than the board's, and rows shows them again", () => {
  // The entries stay and stay authoritative — reconciliation is what guarantees
  // a page created in any way is never missing from its parent. What the
  // document declines is drawing a bare one twice. `[data-g-default]` is the
  // mark the runtime puts on a section that resolved to the shipped default
  // because it named no file of its own, so a `@page-notes.html` somebody wrote
  // is still drawn: they meant that row.
  expect(DOC).toContain(':root:not(.g-rows) #g-page > [id^="sec-@page-"][data-g-default]');
  expect(DOC).toContain(':root:not(.g-rows) #g-page > [id^="sec-@table-"][data-g-default]');
  // No `!important` in the stylesheet: nothing here is fighting a section, and
  // nothing is deleted from the DOM that the edit wave might be holding.
  expect(STYLES).not.toContain("!important");
});

/* ── the mounting script, run rather than read ───────────────────────────── */

/** The first script of the document — the one that mounts what `head` and
 *  `foot` name — against the smallest runtime that lets it run. `extensions`
 *  is what the server would have merged; `mounted` is what the script asked
 *  the runtime to mount, node by node. */
function mounting(extensions: Record<string, any>) {
  const glob = globalThis as any;
  const had = { document: glob.document, biom: glob.biom, rt: glob.__gRuntime };
  const node = (id: string): any => ({ id, hidden: false, textContent: "", attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } });
  const nodes: Record<string, any> = { "g-head": node("g-head"), "g-foot": node("g-foot") };
  const root: any = { classes: [] as string[], classList: { add(c: string) { root.classes.push(c); } } };
  glob.document = { getElementById: (id: string) => nodes[id] ?? null, documentElement: root };
  const mounted: [string, string][] = [];
  const failed: [string, string][] = [];
  let draw: (() => void) | null = null;
  glob.__gRuntime = {
    page: { onDraw: (fn: () => void) => { draw = fn; }, mount: (n: any, id: string) => { mounted.push([n.id, id]); return true; } },
    sections: { fail: (n: any, message: string) => { failed.push([n.id, message]); } },
  };
  glob.biom = { plugin: { extensions: () => extensions } };
  const script = [...DOC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "").find((s) => s.includes("g-head")) ?? "";
  new Function(script)();
  return {
    draw: () => { if (draw) draw(); },
    mounted, failed, nodes, root,
    done: () => { glob.document = had.document; glob.biom = had.biom; glob.__gRuntime = had.rt; },
  };
}

test("once the stack has drawn, head and foot each mount the plugin they name, once per box, and an empty one hides its node", () => {
  const m = mounting({ head: "board-look", foot: "biom-holds", rows: false });
  // Nothing before the first draw: the script only registered for it.
  expect(m.mounted).toEqual([]);
  m.draw();
  expect(m.mounted).toEqual([["g-head", "board-look"], ["g-foot", "biom-holds"]]);
  // A second draw — a section edit redrawing the stack — mounts nothing again.
  m.draw();
  expect(m.mounted).toHaveLength(2);
  expect(m.root.classes).toEqual([]);
  m.done();

  const empty = mounting({ head: null, foot: "", rows: true });
  empty.draw();
  expect(empty.mounted).toEqual([]);
  expect(empty.nodes["g-head"].hidden).toBe(true);
  expect(empty.nodes["g-foot"].hidden).toBe(true);
  // `rows: true` is the one line that shows the bare reconciled rows again.
  expect(empty.root.classes).toEqual(["g-rows"]);
  empty.done();
});

test("a value that is not a name fails in its node, in words, and the other node still mounts", () => {
  const m = mounting({ head: ["a", "b"], foot: "biom-holds" });
  m.draw();
  expect(m.failed).toEqual([["g-head", "head holds a list where a plugin name goes"]]);
  expect(m.mounted).toEqual([["g-foot", "biom-holds"]]);
  m.done();
});
