// SPDX-License-Identifier: AGPL-3.0-only
// The shipped map page, run outside the box.
//
// It is a PAGE rather than a slot plugin — it registers nothing, it reads
// `biom.input` and draws a whole document — so it is loaded here the way the
// box loads it and its pure half is read off the global it hangs itself on.
//
// WHAT THIS CANNOT SEE: there is no DOM here, so the canvas, the physics and
// the hand are not covered. What IS covered is every decision the map makes
// before it draws — which page a link names, what a page's parent and kind are,
// what the graph holds, and what the whole sky says as markdown — and the one
// fact that keeps the rail's map and the plugin's own document from drifting.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { MAP_DOCUMENT } from "../client/views/page.js";

const glob = /** @type {any} */ (globalThis);

/** The file, evaluated with no `document` and no `biom` — which is exactly
 *  how it decides to skip its drawing half. */
function mindmap() {
  delete glob.biom;
  delete glob.__gMindmap;
  new Function(readFileSync(new URL("../guest/plugins/biom-mindmap/mindmap.js", import.meta.url), "utf8"))();
  return glob.__gMindmap;
}

const mm = mindmap();

test("the rail's map and the plugin's own document are one string, said twice", () => {
  // The host cannot import `guest/` and the box cannot fetch, so `page.js`
  // carries the document again. This is what stops the copy drifting.
  const own = readFileSync(new URL("../guest/plugins/biom-mindmap/index.html", import.meta.url), "utf8");
  expect(MAP_DOCUMENT).toBe(own);
});

test("a page's parent is its id path and its kind is the top-level page it sits under", () => {
  expect(mm.parentOf("home")).toBeNull();
  expect(mm.parentOf("home/Strategy/Journey")).toBe("home/Strategy");
  expect(mm.kindOf("home")).toBe("home");
  expect(mm.kindOf("home/Pivots/2026-08-13-22-extensible-workspace")).toBe("Pivots");
});

test("targets are the wikilinks in a run of prose, aliases and anchors dropped, once each", () => {
  const md = "See [[home/Strategy/Journey|the journey]] and [[Airtable#Pricing]], then [[home/Strategy/Journey]] again.";
  expect(mm.targetsOf(md)).toEqual(["home/Strategy/Journey", "Airtable"]);
  expect(mm.targetsOf("")).toEqual([]);
});

test("a link names a page by its whole id, or by a bare name only one page ends in", () => {
  const pages = [{ id: "home", name: "Home" }, { id: "home/Companies/Airtable", name: "Airtable" }, { id: "home/Strategy/Journey", name: "Journey" }, { id: "home/Research/Journey", name: "A journey" }];
  const g = mm.graphOf(pages, {
    "home": "[[home/Companies/Airtable]] [[airtable]] [[Journey]] [[Strategy/Journey]] [[Nowhere]]",
  });
  // The whole id, and the folded bare name, both land; the bare name two pages
  // end in lands nowhere, because the map does not guess; a path fragment that
  // narrows it to one does.
  expect(g.links.map((l) => l[1].id)).toEqual(["home/Companies/Airtable", "home/Strategy/Journey"]);
  expect(g.byId["home"].out).toBe(2);
  expect(g.byId["home/Companies/Airtable"].inn).toBe(1);
  expect(g.byId["home/Strategy/Journey"].inn).toBe(1);
});

test("the graph carries the tree as one edge per parent, and what each page holds", () => {
  const pages = [{ id: "home", name: "Home" }, { id: "home/Strategy", name: "Strategy" }, { id: "home/Strategy/Journey", name: "Journey" }, { id: "home/Orphan", name: "Orphan" }];
  const g = mm.graphOf(pages, { "home/Strategy/Journey": "[[home/Strategy/Journey]] links to itself, which is not a link." });
  expect(g.tree.map((e) => e[0].id + ">" + e[1].id)).toEqual(["home>home/Strategy", "home/Strategy>home/Strategy/Journey", "home>home/Orphan"]);
  expect(g.byId["home"].kids).toBe(2);
  expect(g.byId["home/Strategy"].kids).toBe(1);
  expect(g.links).toEqual([]);
});

test("the projection says what the sky says at a glance: the suns, then how many are alone", () => {
  const pages = [{ id: "home", name: "Home" }, { id: "home/A", name: "A" }, { id: "home/B", name: "B" }, { id: "home/C", name: "C" }];
  const g = mm.graphOf(pages, { "home/A": "[[home/B]]", "home/C": "[[home/B]] [[home/A]]" });
  const md = mm.toMarkdown(g.nodes);
  expect(md).toContain("## What the vault leans on");
  expect(md.indexOf("**B** · linked from 2")).toBeLessThan(md.indexOf("**A** · linked from 1"));
  // The root holds pages, so it is not alone; nothing else here is either.
  expect(md).toContain("0 pages that nothing links to");
});
