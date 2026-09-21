// SPDX-License-Identifier: AGPL-3.0-only
// THE BOARD OF CHILDREN AS A PLUGIN — `guest/plugins/biom-doc/plugins/biom-holds/holds.js`,
// registering `biom-holds`, which the `doc` document's `foot: biom-holds` puts
// under every document and a section may place with `data-g-plugin`.
//
// It used to be a script hard-wired into the document; these are its tests,
// run against the plugin's `mount` with the smallest DOM that lets it draw.
// Everything here answers exactly what the plugin touches: a stub that grew a
// feature nobody called would be a second implementation to keep honest.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const HOLDS = readFileSync(new URL("../guest/plugins/biom-doc/plugins/biom-holds/holds.js", import.meta.url), "utf8");

test("it registers biom-holds, from a folder inside the document's own, and inks nothing", () => {
  expect(HOLDS).toContain('id: "biom-holds"');
  // A plugin inks nothing: the look is the document's stylesheet, in its own
  // layer, keyed on the root this draws.
  const code = HOLDS.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(code).not.toContain("<style");
  expect(code).not.toContain("createElement(\"style\")");
  expect(HOLDS).not.toContain('className = "g-holds"');
  expect(HOLDS).toContain('el("div", "g-holds")');
  // It reads the children rather than anything written into the page — R38 —
  // and redraws when one is added or removed.
  expect(HOLDS).toContain("biom.children()");
  expect(HOLDS).toContain("biom.onRefresh");
  // The parent's own line about a child is two parallel lists.
  expect(HOLDS).toContain("vars.holds");
  expect(HOLDS).toContain("vars.holdWords");
});

/** The plugin, mounted into a node, against a DOM of stubs. */
function board(kids: { kind: string; id: string; name: string }[], vars: Record<string, unknown> = {}) {
  const made: any[] = [];
  const el = (tag: string): any => {
    const node: any = {
      tag,
      className: "",
      hidden: false,
      type: "",
      style: { setProperty() {} },
      classes: [] as string[],
      classList: { add(c: string) { node.classes.push(c); } },
      kids: [] as any[],
      on: {} as Record<string, (e: any) => void>,
      attrs: {} as Record<string, string>,
      append(...children: any[]) { node.kids.push(...children); },
      appendChild(child: any) { node.kids.push(child); return child; },
      setAttribute(k: string, v: string) { node.attrs[k] = v; },
      getAttribute(k: string) { return node.attrs[k] ?? null; },
      addEventListener(type: string, fn: (e: any) => void) { node.on[type] = fn; },
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

  const glob = globalThis as any;
  const had = { document: glob.document, biom: glob.biom, io: glob.IntersectionObserver };
  let observed: any = null;
  let disconnected = 0;
  glob.document = { createElement: el };
  glob.IntersectionObserver = class { observe(n: any) { observed = n; } disconnect() { disconnected++; } };
  let refresh: (() => void) | null = null;
  let offed = 0;
  const opened: any[] = [];
  glob.biom = {
    children: () => Promise.resolve(kids),
    data: () => Promise.resolve(vars),
    onRefresh(fn: () => void) { refresh = fn; return () => { offed++; }; },
    open(child: any) { opened.push(child); },
    plugins: { register(def: any) { registered = def; return true; } },
  };
  let registered: any = null;
  new Function(HOLDS)();
  expect(registered.id).toBe("biom-holds");

  const teardowns: (() => void)[] = [];
  const node = el("div");
  registered.mount(node, null, { onTeardown: (fn: () => void) => teardowns.push(fn) });

  const holds = node.kids[0];
  const find = (pred: (n: any) => boolean) => made.find(pred);
  const rows = find((n) => n.className === "rows");
  const byName = find((n) => n.attrs["data-by"] === "name");
  const byDate = find((n) => n.attrs["data-by"] === "date");
  const dirBtn = find((n) => n.attrs["data-dir"] !== undefined);
  const tally = find((n) => n.tag === "b");
  const unit = find((n) => n.className === "unit");

  /** The names on screen, in the order they were drawn. */
  const drawn = () => rows.kids.map((row: any) => row.kids[1].textContent);
  /** What the direction button says: ↓ is ascending, ↑ is descending. */
  const facing = () => dirBtn.textContent;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    node, holds, rows, drawn, facing, settle, opened,
    tally: () => tally.textContent + " " + unit.textContent,
    blurbs: () => rows.kids.map((row: any) => row.kids[4].textContent),
    name: () => byName.on.click({}),
    date: () => byDate.on.click({}),
    flip: () => dirBtn.on.click({}),
    refresh: () => { if (refresh) refresh(); },
    teardown: () => { for (const fn of teardowns) fn(); },
    observed: () => observed,
    disconnected: () => disconnected,
    offed: () => offed,
    done: () => { glob.document = had.document; glob.biom = had.biom; glob.IntersectionObserver = had.io; },
  };
}

const DATED = ["2026-01-01-alpha", "2026-03-01-zulu", "2026-02-01-mike"].map((id) => ({ kind: "page", id: "home/" + id, name: id }));

test("it draws into the node it was given, hidden until there are children, and counts what it holds", async () => {
  const b = board([]);
  await b.settle();
  expect(b.holds.className).toBe("g-holds");
  expect(b.holds.hidden).toBe(true);
  b.done();

  const c = board([{ kind: "page", id: "home/a", name: "A" }, { kind: "table", id: "leads", name: "Leads" }]);
  await c.settle();
  expect(c.holds.hidden).toBe(false);
  expect(c.tally()).toBe("2 items");
  expect(c.observed()).toBe(c.holds);
  c.done();
});

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

test("the parent's line about a child comes off holds and holdWords, keyed by the child's own segment, and a row opens the child", async () => {
  const kids = [{ kind: "page", id: "home/notes", name: "Notes" }, { kind: "page", id: "home/plans", name: "Plans" }];
  const b = board(kids, { holds: ["plans"], holdWords: ["what is next"] });
  await b.settle();
  expect(b.drawn()).toEqual(["Notes", "Plans"]);
  expect(b.blurbs()).toEqual(["", "what is next"]);
  b.rows.kids[0].on.click({});
  expect(b.opened).toEqual([kids[0]]);
  b.done();
});

test("it redraws on refresh, and the teardown lets go of the refresh listener and the observer", async () => {
  const b = board(DATED);
  await b.settle();
  expect(b.drawn()).toHaveLength(3);
  b.refresh();
  await b.settle();
  expect(b.drawn()).toHaveLength(3);
  b.teardown();
  expect(b.offed()).toBe(1);
  expect(b.disconnected()).toBe(1);
  b.done();
});
