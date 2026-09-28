// SPDX-License-Identifier: AGPL-3.0-only
// WHAT A PAGE IS HANDED DOES NOT MOVE WHEN THE WIRE STOPS COPYING SCOPES — the
// fourteenth contracts edit's equivalence suite, in bun. Its instruments and
// the rule its goldens are kept by are in `scopes-fixture.ts`; the drawn DOM,
// in a real browser, is `e2e/scopes-dom.e2e.ts`.
//
// THE EDIT. `DrawnSection.vars` and a `Part`'s `vars` carry the entry's own
// `variables:` rather than the page's, the section's and the part's already
// merged, and the page's values travel once, in `Page.variables`. The box's
// runtime merges the scopes again when it draws, so what a slot, a list item,
// a `data-g-plugin` node and a section script are handed must come out the same
// — and every reader of `.vars` that did not merge must now merge.
//
// WHAT IS HELD, against goldens captured from the code before the edit:
//
//   1. every mount of every corpus page, drawn by the real `sections.js` from
//      what the server answers now;
//   2. the same, drawn from the OLD answer — a new runtime behind a stale
//      server — and from the answer spelled own-only;
//   3. every page's projected markdown, in both copies of the rule, and its
//      mirror file, byte for byte — from the answer now and from the own-only
//      one;
//   4. a page the shape of Talks: its mounts and its projection by digest, and
//      its answer's size.
//
// `test.failing` marks what holds only once the fourteenth edit is BUILT —
// the server stops merging and the runtime rebuilds the content it hands a
// slot plugin. Track F turns each into `test` and changes nothing else here:
// not a golden, not the corpus, not what a check compares.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFiles } from "../server/platform/files.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { makePages } from "../server/domain/pages.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { makeMirror, mirrorPath } from "../server/domain/mirror.ts";
import { readOnly } from "../server/main.ts";
import { projectDoc } from "../contracts/projection.ts";
import type { Page } from "../contracts/types.ts";
import {
  CORPUS_PAGES, TALKS, clockless, copyCorpus, drawnMounts, fileOf, golden, inventTalks, markupBytes, ownWire, pretty, sha, stable, wireOf,
} from "./scopes-fixture.ts";
import type { Wire } from "./scopes-fixture.ts";

const HERE = join(import.meta.dir, "..");
const yaml = { parse, parseAny, format };
/** The default section the server really sends, comment and all — what a
 *  section that names no file draws with, and part of what Talks weighs. */
const DEFAULT_HTML = readFileSync(join(HERE, "guest", "sections", "default.html"), "utf8");

/** The hand copy of the projection, as the box evaluates it. */
function guestProject(): { doc: (page: unknown) => string } {
  const glob = globalThis as Record<string, unknown>;
  const was = glob.__gRuntime;
  glob.__gRuntime = {};
  try {
    new Function(readFileSync(join(HERE, "guest", "runtime", "project.js"), "utf8"))();
    return (glob.__gRuntime as { project: { doc: (page: unknown) => string } }).project;
  } finally {
    glob.__gRuntime = was;
  }
}

let tmp = "";
/** What the server answers now, per corpus page. */
const now = new Map<string, Wire>();
/** Each corpus page's mirror file, as the mirror writes it now. */
const mirrored = new Map<string, string>();
/** What the server answered BEFORE the edit, per corpus page. */
const old = new Map<string, Wire>();
let talks: Wire;
let talksMirror = "";

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "biom-scopes-"));
  const vault = join(tmp, "corpus");
  copyCorpus(vault);
  const files = clockless(makeFiles(vault));
  const pages = makePages(files, yaml, () => [], DEFAULT_HTML);
  const mirror = makeMirror(files, makePages(readOnly(files), yaml, () => [], DEFAULT_HTML), makeDocs(readOnly(files), yaml));
  for (const id of CORPUS_PAGES) {
    const page = await pages.read(id);
    if (page === null) throw new Error(`the corpus has no page ${id}`);
    now.set(id, wireOf(page));
    // IN THE ORDER IT CAME, not sorted: a part's place among its section's
    // parts is the order it projects in.
    old.set(id, JSON.parse(golden(`wire/${fileOf(id)}.json`, `${JSON.stringify(wireOf(page), null, 2)}\n`)) as Wire);
    if (id.startsWith("@")) continue;
    await mirror.project(id);
    mirrored.set(id, (await files.read(mirrorPath(id))) ?? "");
  }

  const big = join(tmp, "talks");
  inventTalks(big);
  const bigFiles = clockless(makeFiles(big));
  const bigPages = makePages(bigFiles, yaml, () => [], DEFAULT_HTML);
  const page = await bigPages.read(TALKS.id);
  if (page === null) throw new Error("the invented Talks did not read");
  talks = wireOf(page);
  const bigMirror = makeMirror(bigFiles, makePages(readOnly(bigFiles), yaml, () => [], DEFAULT_HTML), makeDocs(readOnly(bigFiles), yaml));
  await bigMirror.project(TALKS.id);
  talksMirror = (await bigFiles.read(mirrorPath(TALKS.id))) ?? "";
}, 60_000);

afterAll(() => {
  if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
});

/** A page's mounts, and its golden. */
function scopesOf(id: string, wire: Wire): { actual: unknown; want: unknown } {
  const actual = drawnMounts(wire);
  const want = JSON.parse(golden(`scopes/${fileOf(id)}.json`, pretty(actual)));
  return { actual: JSON.parse(pretty(actual)), want };
}

/** Only what a mount is handed as its scope, and the markup's digest. */
function scopesOnly(drawn: unknown): unknown {
  const d = drawn as { sections: { name: string; markup: string; mounts: { ctx: unknown }[] }[] };
  return d.sections.map((s) => ({ name: s.name, markup: s.markup, ctx: s.mounts.map((m) => ({ ...m, content: undefined })) }));
}

/* ── 1 and 2: the scopes ─────────────────────────────────────────────────── */

test("every mount of every corpus page is handed what it was handed before the fourteenth edit", () => {
  for (const id of CORPUS_PAGES) {
    const { actual, want } = scopesOf(id, now.get(id) as Wire);
    expect([id, actual]).toStrictEqual([id, want]);
  }
});

test("the corpus makes real mounts: every door, a list's items in order, and nothing refused", () => {
  const all = CORPUS_PAGES.flatMap((id) => drawnMounts(old.get(id) as Wire).sections.flatMap((s) => s.mounts));
  for (const via of ["slot", "item", "node", "script"]) expect([via, all.some((m) => m.via === via)]).toEqual([via, true]);
  const items = drawnMounts(old.get("home/Shadowing") as Wire).sections.find((s) => s.name === "cards")?.mounts.filter((m) => m.via === "item");
  expect(items?.map((m) => m.item)).toEqual([0, 1, 2, 3, 4]);
  for (const id of CORPUS_PAGES) expect([id, drawnMounts(old.get(id) as Wire).said]).toEqual([id, []]);
});

test("a new runtime behind a stale server draws the OLD answer exactly as the goldens say", () => {
  for (const id of CORPUS_PAGES) {
    const { actual, want } = scopesOf(id, old.get(id) as Wire);
    expect([id, actual]).toStrictEqual([id, want]);
  }
});

test("the runtime's merge is idempotent: the answer spelled own-only hands every mount the same scope", () => {
  for (const id of CORPUS_PAGES) {
    const { want } = scopesOf(id, old.get(id) as Wire);
    const own = JSON.parse(pretty(drawnMounts(ownWire(old.get(id) as Wire))));
    expect([id, scopesOnly(own)]).toStrictEqual([id, scopesOnly(want)]);
  }
});

// THE RUNTIME'S HALF OF THE EDIT: a slot plugin and a list item are handed
// `content` with its `vars` merged, rebuilt in the box, because `biom-grid`
// and any workspace's own part-kind plugin read `content.vars` before
// `ctx.vars`. Before the edit the runtime hands the answer's part as it came.
test("the answer spelled own-only hands every mount the same content too", () => {
  for (const id of CORPUS_PAGES) {
    const { want } = scopesOf(id, old.get(id) as Wire);
    const own = JSON.parse(pretty(drawnMounts(ownWire(old.get(id) as Wire))));
    expect([id, own]).toStrictEqual([id, want]);
  }
});

// THE SERVER'S HALF: nothing on the wire is a merge any more.
test("every section's and every part's vars on the answer is its own", () => {
  for (const id of CORPUS_PAGES) {
    const wire = now.get(id) as Wire;
    expect([id, JSON.parse(stable(wire))]).toStrictEqual([id, JSON.parse(stable(ownWire(wire)))]);
  }
  expect(JSON.parse(stable(talks))).toStrictEqual(JSON.parse(stable(ownWire(talks))));
}, 30_000);

/* ── 3: the projection and the mirror ────────────────────────────────────── */

test("every corpus page projects to the markdown it projected before, in both copies of the rule", () => {
  const guest = guestProject();
  for (const id of CORPUS_PAGES) {
    const page = now.get(id) as unknown as Page;
    const want = golden(`projection/${fileOf(id)}.md`, projectDoc(page));
    expect([id, projectDoc(page)]).toEqual([id, want]);
    expect([id, guest.doc(page)]).toEqual([id, want]);
    expect([id, projectDoc(old.get(id) as unknown as Page)]).toEqual([id, want]);
  }
});

// THE BARRIER'S OWN FIX: `projectDoc` and its hand copy read a part's `vars`
// ALONE, which was right only while it held the merge — an own `{}` would win
// and leave `{{rate}}` unfilled. Each merges now, so either spelling projects
// the same, and this held on the barrier's second commit and failed on its
// first.
test("the answer spelled own-only projects to the same markdown, in both copies of the rule", () => {
  const guest = guestProject();
  for (const id of CORPUS_PAGES) {
    const own = ownWire(old.get(id) as Wire) as unknown as Page;
    const want = golden(`projection/${fileOf(id)}.md`, projectDoc(now.get(id) as unknown as Page));
    expect([id, projectDoc(own)]).toEqual([id, want]);
    expect([id, guest.doc(own)]).toEqual([id, want]);
  }
});

test("every corpus page's mirror file is byte for byte the file it was", () => {
  for (const [id, text] of mirrored) {
    expect([id, text]).toEqual([id, golden(`mirror/${fileOf(id)}.md`, text)]);
  }
  expect(mirrored.size).toBe(CORPUS_PAGES.filter((id) => !id.startsWith("@")).length);
});

/* ── 4: a page like Talks ────────────────────────────────────────────────── */

test("a page the shape of Talks draws, projects and mirrors as it did", () => {
  expect(talks.sections.length).toBe(TALKS.sections + 1);
  const bytes = Buffer.byteLength(stable(talks.variables));
  expect(bytes).toBeGreaterThan(TALKS.varBytes - 5_000);
  const actual = {
    sections: talks.sections.length,
    mounts: sha(stable(drawnMounts(talks))),
    projection: sha(projectDoc(talks as unknown as Page)),
    mirror: sha(talksMirror),
  };
  const want = JSON.parse(golden("talks.json", pretty(actual)));
  expect(JSON.parse(pretty(actual))).toStrictEqual(want);
  // The own-only spelling draws it the same scopes, as every corpus page does.
  expect(sha(stable(scopesOnly(drawnMounts(ownWire(talks)))))).toBe(sha(stable(scopesOnly(drawnMounts(talks)))));
}, 60_000);

// THE POINT OF THE EDIT, measured. The answer is weighed without its markup —
// every section's html, every html part's and every child's own drawing — so
// what is held is what the edit changes: the variables, sent once.
test("the Talks-shaped answer, less its markup, is under a megabyte", () => {
  const whole = Buffer.byteLength(JSON.stringify(talks));
  expect(whole - markupBytes(talks)).toBeLessThan(1_000_000);
}, 30_000);
