// SPDX-License-Identifier: AGPL-3.0-only
// The shipped runs page type, run outside the box.
//
// `guest/plugins/biom-automations-runs/` is a PAGE — it registers nothing,
// reads the page's children and draws a whole document — so its script is
// loaded here the way the box loads it and its pure half is read off the
// global it hangs itself on, exactly as the map's is.
//
// WHAT THIS CANNOT SEE: there is no DOM here, so the strips, the bar, the
// embed and the two mounted slides are not covered. What IS covered is every
// decision the page type makes before it draws — which children are shown,
// in what order, what a child's title is — and the shape of the folder: a
// document, a script, and a flat contract declaring three keys and nothing
// else, because that is the whole of what a vault can tell it.

import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const glob = /** @type {any} */ (globalThis);
const FOLDER = new URL("../guest/plugins/biom-automations-runs/", import.meta.url);

/** The file, evaluated with no `document` and no `biom` — which is exactly
 *  how it decides to skip its drawing half. */
function runs() {
  delete glob.biom;
  delete glob.__gAutomationsRuns;
  new Function(readFileSync(new URL("automations-runs.js", FOLDER), "utf8"))();
  return glob.__gAutomationsRuns;
}

const rt = runs();
const page = (id, name, created) => ({ kind: "page", id, name: name || id.slice(id.lastIndexOf("/") + 1), ...(created ? { created } : {}) });

test("the folder is the one shape: the document, one script, a flat contract of three keys, and nothing else", () => {
  expect(readdirSync(FOLDER).sort()).toEqual(["automations-runs.js", "index.html", "plugin.yaml"]);
  const contract = readFileSync(new URL("plugin.yaml", FOLDER), "utf8");
  const keys = contract.split("\n").filter((l) => /^[a-z]/.test(l)).map((l) => l.slice(0, l.indexOf(":")));
  expect(keys).toEqual(["home", "progress", "skip"]);
  // Flat: a key and its default, no wrapper, and a list where a list goes.
  expect(contract).toContain("home: \"\"");
  expect(contract).toContain("progress: \"\"");
  expect(contract).toContain("skip: []");
  // The document names no script: the bundle carries it, guarded on its root.
  const doc = readFileSync(new URL("index.html", FOLDER), "utf8");
  expect(doc).not.toContain("<script");
  expect(doc).toContain('id="g-runs"');
  // It knows nothing about runs: no table, no registry, no session.
  const script = readFileSync(new URL("automations-runs.js", FOLDER), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const word of ["biom.table(", "biom.runs(", "biom.run(", "biom.readRun(", "biom.start(", "session"]) expect(script).not.toContain(word);
  expect(script).toContain("biom.children()");
  expect(script).toContain("biom.embedInto(");
  expect(script).toContain("biom.plugin.extensions()");
});

test("a child is stamped by created, by the date its name leads with, or not at all", () => {
  expect(rt.stampOf(page("home/Runs/a", "A", "2026-09-20T10:04:00.000Z"))).toBe(Date.parse("2026-09-20T10:04:00.000Z"));
  // The name's date is read in local time, to the minute where the name has one.
  expect(rt.stampOf(page("home/Runs/2026-09-20-10-04-7f7c115f"))).toBe(new Date(2026, 8, 20, 10, 4).getTime());
  expect(rt.stampOf(page("home/Runs/2026-09-19-note", "A dated note"))).toBe(new Date(2026, 8, 19).getTime());
  // `created` wins over the name where both are there.
  expect(rt.stampOf(page("home/Runs/2026-09-19-x", "x", "2026-09-21T00:00:00.000Z"))).toBe(Date.parse("2026-09-21T00:00:00.000Z"));
  expect(rt.stampOf(page("home/Runs/Product_Pricing", "Product pricing"))).toBe(null);
  expect(rt.stampOf(page("home/Runs/2026-13-99-not-a-date"))).not.toBe(null); // the shape is read, not the calendar
});

test("children are shown newest first, the undated after every dated one by name, tables and skipped names left out", () => {
  const kids = [
    { kind: "table", id: "socials_runs", name: "socials_runs", rows: 4 },
    page("home/Runs/2026-09-19-22-13-c64af0c5"),
    page("home/Runs/Talks"),
    page("home/Runs/2026-09-21-06-30-faf99f85"),
    page("home/Runs/Product_Pricing", "Product pricing"),
    page("home/Runs/old", "Old", "2026-09-22T01:00:00.000Z"),
    page("home/Runs/2026-09-20-10-04-7f7c115f"),
  ];
  expect(rt.shown(kids, ["Talks"]).map((c) => c.id)).toEqual([
    "home/Runs/old",
    "home/Runs/2026-09-21-06-30-faf99f85",
    "home/Runs/2026-09-20-10-04-7f7c115f",
    "home/Runs/2026-09-19-22-13-c64af0c5",
    "home/Runs/Product_Pricing",
  ]);
  // `skip` matches the child's name or its segment, and a bare string is one name.
  expect(rt.shown(kids, "Product pricing").map((c) => c.id)).toContain("home/Runs/Talks");
  expect(rt.shown(kids, "Product pricing").map((c) => c.id)).not.toContain("home/Runs/Product_Pricing");
  expect(rt.shown(kids, undefined).length).toBe(6);
  expect(rt.shown(null, [])).toEqual([]);
  // Stable and pure: the list handed in is not reordered.
  expect(kids[1].id).toBe("home/Runs/2026-09-19-22-13-c64af0c5");
});

test("a child's title is the H1 of its prose, marks stripped, and null where it has none", () => {
  expect(rt.titleIn("# A burst, then a fade\n\nDrawn as lanes.")).toBe("A burst, then a fade");
  expect(rt.titleIn("The caption first.\n\n## Not the title\n\n# **Two** handles `drew`, [[home/x|one]] did not #")).toBe("Two handles drew, one did not");
  expect(rt.titleIn("## Only a subheading\n\nwords")).toBe(null);
  expect(rt.titleIn("")).toBe(null);
  expect(rt.titleIn(null)).toBe(null);
  // A `{{name}}` in it is filled from the page's own variables, empty where none.
  expect(rt.filled("The week of {{date}} on {{ account }}", { date: "2026-09-20" })).toBe("The week of 2026-09-20 on ");
});
