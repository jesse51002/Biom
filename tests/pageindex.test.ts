// SPDX-License-Identifier: AGPL-3.0-only
// THE PAGE INDEX — `server/domain/pageindex.ts`, and the one head parser it
// reads with, `headOf` in `server/platform/yaml.ts`.
//
// A level, a lookup, a search and a link are answered from each page's head —
// its column-0 `name:`, `uid:` and `plugin:` — kept in `.biom/pages.db` and
// trusted only while a stat of the document agrees. What is held here:
//
//   - the head, one case per shape, and the shapes it declines — where the
//     one full parse of that document is the answer;
//   - a kept head is read again the moment its stat moves — a new time at the
//     same size, a new inode, a new size — and a folder that went takes its
//     subtree's rows with it;
//   - the sweep reads every head once, then none, then only what changed; a
//     second call joins the first; and it lets the loop run while it goes;
//   - `locate` by id and by uid, a stale row, a page gone, a folder renamed on
//     disk, a uid nobody holds (bounded), and a uid two pages hold;
//   - `search`'s three tiers, its limit, `more`, and `complete`;
//   - a level in exactly the order `pages.ts` answers without the index, with
//     its tables — an orphan's under the root — and `children` and `uid`;
//   - `resolveLink`'s four tries and its refusal to guess; `moved`; what the
//     watcher's paths turn into; the identities getting a page's own uid back
//     through the index; and a corrupt index file rebuilt.
//
// Every folder here is temporary and every page, name and uid is invented.

import { test, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { HEAD_BYTES, UNSEEN_MS, dirOfPage, makePageIndex, pageOfPath } from "../server/domain/pageindex.ts";
import type { PageIndex, TableAt } from "../server/domain/pageindex.ts";
import { makeIdentities, makePages, pageDir, PAGE_DOC } from "../server/domain/pages.ts";
import { makeFiles } from "../server/platform/files.ts";
import type { DiskFiles } from "../server/platform/files.ts";
import { makeDb } from "../server/platform/db.ts";
import { headOf, parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";

const yaml = { parse, parseAny, format, formatAny };
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function scratch(label: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `biom-index-${label}-`)));
  made.push(dir);
  return dir;
}

const docAt = (root: string, id: string) => join(root, pageDir(id), PAGE_DOC);
function put(root: string, id: string, text: string): void {
  mkdirSync(dirname(docAt(root, id)), { recursive: true });
  writeFileSync(docAt(root, id), text);
}
const doc = (name: string, uid?: string, contents = "[]") =>
  `name: ${name}\n${uid ? `uid: ${uid}\n` : ""}plugin: biom-doc\ncontents: ${contents}\n`;

/** A `DiskFiles` that counts its head reads and whole reads. */
function counted(root: string) {
  const inner = makeFiles(root);
  let heads = 0;
  let reads = 0;
  const disk: DiskFiles = {
    ...inner,
    head: (rel, bytes) => { heads++; return inner.head(rel, bytes); },
    read: (rel) => { reads++; return inner.read(rel); },
  };
  return { disk, heads: () => heads, reads: () => reads, clear: () => { heads = 0; reads = 0; } };
}

function indexOf(root: string, over: { disk?: DiskFiles; tables?: TableAt[] } = {}): PageIndex {
  const path = join(root, ".biom", "pages.db");
  return makePageIndex({
    db: makeDb(path),
    disk: over.disk ?? makeFiles(root),
    yaml,
    tables: () => over.tables ?? [],
    now: Date.now,
  });
}

/** A small workspace: the root, three top pages, a branch and a leaf. */
function small(): string {
  const root = scratch("small");
  put(root, "home", doc("Home", "h0meinvented0001"));
  put(root, "home/Alpha", doc("The Alpha Page", "alphainvented001"));
  put(root, "home/Beta", doc("Beta", "betainvented0001"));
  put(root, "home/Gamma", doc("Gamma"));
  put(root, "home/Alpha/Notes", doc("Alpha notes", "alphanotes000001"));
  return root;
}

/* ── the head ──────────────────────────────────────────────────────────── */

test("headOf, plain: the three lines at the left edge", () => {
  expect(headOf("name: Field notes\nuid: f1eldnotes01\nplugin: biom-doc\ncontents: []\n")).toEqual({ name: "Field notes", uid: "f1eldnotes01", plugin: "biom-doc" });
  // In any order, and wherever they sit among the others.
  expect(headOf("plugin: html\nvariables:\n  a: 1\nname: Later\n")).toEqual({ name: "Later", uid: null, plugin: "html" });
});

test("headOf, quoted: a colon and a hash inside quotes are the name's, and a trailing comment is not", () => {
  expect(headOf('name: "Pivot: the #1 idea" # a comment\n')?.name).toBe("Pivot: the #1 idea");
  expect(headOf("name: 'It''s: done'\n")?.name).toBe("It's: done");
  expect(headOf("name: Plain words # and a comment\n")?.name).toBe("Plain words");
});

test("headOf, escaped: a double-quoted escape is decoded as a full parse decodes it", () => {
  expect(headOf('name: "caf\\u00e9 \\"quoted\\"\\ttab"\n')?.name).toBe('café "quoted"\ttab');
});

test("headOf declines what it cannot say for sure, and a full parse is the answer", () => {
  for (const text of [
    "name: |\n  Block\n  scalar\n",
    "name: >-\n  Folded\n",
    "name: &a Anchored\nplugin: biom-doc\n",
    "name: *a\n",
    "name: !tag Tagged\n",
    "plugin: biom-doc\ncontents: []\n", // no name at all
    "name: A\nname: B\n", // twice
    "name: Spread\n  over two lines\n",
    "name: Spread\n\n  after a blank line\n",
    "name:\n  nested: map\n",
    "name: [a, b]\n",
    "name: A\nuid: NOT-A-UID\n",
    "name: A\nplugin: Not A Plugin\n",
    'variables: "open quote\nname: inside the quote"\n',
    "name: One\n---\nname: Two\n",
  ]) {
    expect([text, headOf(text)]).toEqual([text, null]);
  }
});

test("headOf: an empty name is no name, a number is its text, and no uid is null", () => {
  expect(headOf("name:\nplugin: biom-doc\n")).toEqual({ name: null, uid: null, plugin: "biom-doc" });
  expect(headOf("name: 2026\n")?.name).toBe("2026");
  expect(headOf("name: Only a name\n")).toEqual({ name: "Only a name", uid: null, plugin: null });
});

test("headOf: CRLF line ends and a byte-order mark", () => {
  expect(headOf("\ufeffname: Windows\r\nuid: w1ndowsinvented\r\nplugin: biom-doc\r\n")).toEqual({ name: "Windows", uid: "w1ndowsinvented", plugin: "biom-doc" });
});

test("headOf: a nested `name:` is never taken for the page's", () => {
  const text = "plugin: biom-doc\ncontents:\n  - name: title\n    parts:\n      name: not this either\n";
  expect(headOf(text)).toBeNull();
  expect(headOf(`${text}name: The page\n`)?.name).toBe("The page");
});

test("a head cut mid-character loses its partial line, and the page is named right", async () => {
  const root = scratch("cut");
  put(root, "home", doc("Home", "h0meinvented0001"));
  // A name of two-byte characters long enough that byte HEAD_BYTES falls
  // inside one of them.
  const long = "é".repeat(HEAD_BYTES / 2 + 7);
  put(root, "home/Long", `name: ${long}\nuid: l0nginvented0001\nplugin: biom-doc\ncontents: []\n`);
  const idx = indexOf(root);
  const head = await idx.head("home/Long");
  expect(head?.name).toBe(long);
  expect(head?.name.includes("\ufffd")).toBe(false);
  expect(head?.uid).toBe("l0nginvented0001");
  // And a short name followed by a long body is read off its head alone.
  const c = counted(root);
  put(root, "home/Short", `name: Short\nuid: sh0rtinvented001\nplugin: biom-doc\ncontents:\n  - name: s\n    parts:\n      body: "${"ü".repeat(HEAD_BYTES)}"\n`);
  const again = indexOf(root, { disk: c.disk });
  c.clear();
  expect((await again.head("home/Short"))?.name).toBe("Short");
  expect(c.reads()).toBe(0);
  idx.close();
  again.close();
});

/* ── trusted only while a stat agrees ──────────────────────────────────── */

test("A NEW TIME AT THE SAME SIZE is read again", async () => {
  const root = small();
  const idx = indexOf(root);
  expect((await idx.head("home/Beta"))?.name).toBe("Beta");
  const at = docAt(root, "home/Beta");
  const was = statSync(at);
  writeFileSync(at, doc("Beto", "betainvented0001")); // one letter, same size, same inode
  utimesSync(at, was.atime, new Date(was.mtimeMs + 5000));
  expect(statSync(at).size).toBe(was.size);
  expect(statSync(at).ino).toBe(was.ino);
  expect((await idx.head("home/Beta"))?.name).toBe("Beto");
  idx.close();
});

test("AN ATOMIC WRITE — a new inode, the same size and time — is read again", async () => {
  const root = small();
  const idx = indexOf(root);
  expect((await idx.head("home/Beta"))?.name).toBe("Beta");
  const at = docAt(root, "home/Beta");
  // A whole second, so the time round-trips exactly through `utimes`.
  const when = new Date(Math.floor(statSync(at).mtimeMs / 1000) * 1000 - 60_000);
  utimesSync(at, when, when);
  expect((await idx.head("home/Beta"))?.name).toBe("Beta");
  const was = statSync(at);
  const tmp = `${at}.tmp`;
  writeFileSync(tmp, doc("Beto", "betainvented0001"));
  utimesSync(tmp, when, when);
  renameSync(tmp, at);
  const now = statSync(at);
  expect(now.ino).not.toBe(was.ino);
  expect([now.size, now.mtimeMs]).toEqual([was.size, was.mtimeMs]);
  expect((await idx.head("home/Beta"))?.name).toBe("Beto");
  idx.close();
});

test("an edit in place that changes the size is read again", async () => {
  const root = small();
  const idx = indexOf(root);
  expect((await idx.head("home/Gamma"))?.uid).toBeNull();
  writeFileSync(docAt(root, "home/Gamma"), doc("Gamma, edited", "gammainvented001"));
  expect(await idx.head("home/Gamma")).toMatchObject({ name: "Gamma, edited", uid: "gammainvented001" });
  idx.close();
});

test("A FOLDER THAT WENT takes its rows and every row under it", async () => {
  const root = small();
  const idx = indexOf(root);
  await idx.sweep();
  expect(await idx.uidWas("home/Alpha/Notes")).toBe("alphanotes000001");
  rmSync(join(root, pageDir("home/Alpha")), { recursive: true, force: true });
  expect(await idx.head("home/Alpha")).toBeNull();
  expect(await idx.uidWas("home/Alpha")).toBeNull();
  expect(await idx.uidWas("home/Alpha/Notes")).toBeNull();
  idx.close();
});

/* ── the sweep ─────────────────────────────────────────────────────────── */

test("THE SWEEP reads every head once, then none, then only the one that changed", async () => {
  const root = small();
  const c = counted(root);
  const idx = indexOf(root, { disk: c.disk });
  const first = await idx.sweep();
  expect(c.heads()).toBe(5);
  expect(first.noUid).toEqual(["home/Gamma"]);
  expect(idx.swept()).toBe(true);
  c.clear();
  await idx.sweep();
  expect([c.heads(), c.reads()]).toEqual([0, 0]);
  writeFileSync(docAt(root, "home/Beta"), doc("Beta, edited", "betainvented0001"));
  c.clear();
  await idx.sweep();
  expect([c.heads(), c.reads()]).toEqual([1, 0]);
  idx.close();
});

test("a second sweep while one runs joins it", async () => {
  const root = small();
  const idx = indexOf(root);
  const a = idx.sweep();
  const b = idx.sweep();
  expect(b).toBe(a);
  await a;
  idx.close();
});

test("THE SWEEP LETS THE LOOP RUN: a timer set before it fires while it is still going, on two thousand folders", async () => {
  const root = scratch("yield");
  put(root, "home", doc("Home", "h0meinvented0001"));
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 50; j++) put(root, `home/B${i}/P${j}`, doc(`Page ${i}.${j}`, `y${String(i * 50 + j).padStart(10, "0")}`));
    put(root, `home/B${i}`, doc(`Branch ${i}`, `b${String(i).padStart(10, "0")}`));
  }
  const idx = indexOf(root);
  let done = false;
  let firedDuring: boolean | null = null;
  setTimeout(() => { firedDuring = !done; }, 0);
  const news = await idx.sweep();
  done = true;
  expect(firedDuring).toBe(true);
  expect(news.noUid).toEqual([]);
  expect((await idx.list()).length).toBe(1 + 40 + 2000);
  idx.close();
}, 30000);

/* ── locate ────────────────────────────────────────────────────────────── */

test("locate by id and by uid, a stale row read again, and a page gone is absent", async () => {
  const root = small();
  const idx = indexOf(root);
  await idx.sweep();
  expect(await idx.locate({ ids: ["home/Alpha", "home/Nowhere"] })).toEqual([{ id: "home/Alpha", name: "The Alpha Page", uid: "alphainvented001" }]);
  expect(await idx.locate({ uids: ["betainvented0001"] })).toEqual([{ id: "home/Beta", name: "Beta", uid: "betainvented0001" }]);
  // Beta's uid changes on disk: the row is stale, and read again.
  writeFileSync(docAt(root, "home/Beta"), doc("Beta", "betanewinvented1"));
  // The old uid's row fails its stat and is read again: nobody holds it now.
  expect(await idx.locate({ uids: ["betainvented0001"] })).toEqual([]);
  // The new one no row held: the sweep it waits for reads Beta's head again.
  expect(await idx.locate({ uids: ["betanewinvented1"] })).toEqual([{ id: "home/Beta", name: "Beta", uid: "betanewinvented1" }]);
  expect(await idx.locate({ ids: ["home/Beta"] })).toEqual([{ id: "home/Beta", name: "Beta", uid: "betanewinvented1" }]);
  rmSync(join(root, pageDir("home/Gamma")), { recursive: true, force: true });
  expect(await idx.locate({ ids: ["home/Gamma"] })).toEqual([]);
  idx.close();
});

test("A FOLDER RENAMED ON DISK is found by its uid after the sweep", async () => {
  const root = small();
  const idx = indexOf(root);
  await idx.sweep();
  renameSync(join(root, pageDir("home/Alpha")), join(root, pageDir("home/Renamed")));
  expect(await idx.locate({ uids: ["alphanotes000001"] })).toEqual([{ id: "home/Renamed/Notes", name: "Alpha notes", uid: "alphanotes000001" }]);
  expect(await idx.uidWas("home/Alpha")).toBeNull();
  idx.close();
});

test("A UID NOBODY HOLDS waits for the sweep no longer than UNSEEN_MS, and is absent", async () => {
  const root = scratch("unseen");
  put(root, "home", doc("Home", "h0meinvented0001"));
  for (let i = 0; i < 300; i++) put(root, `home/P${i}`, doc(`P ${i}`, `u${String(i).padStart(10, "0")}`));
  // A disk slow enough that the sweep outlasts the bound.
  const inner = makeFiles(root);
  const slow: DiskFiles = { ...inner, stat: async (rel) => { await Bun.sleep(12); return inner.stat(rel); } };
  const idx = indexOf(root, { disk: slow });
  const t0 = performance.now();
  expect(await idx.locate({ uids: ["n0b0dyholdsthis1"] })).toEqual([]);
  const took = performance.now() - t0;
  expect(took).toBeGreaterThanOrEqual(UNSEEN_MS - 50);
  expect(took).toBeLessThan(UNSEEN_MS + 1500);
  await idx.sweep();
  idx.close();
}, 30000);

test("two folders holding one uid are both answered", async () => {
  const root = small();
  put(root, "home/Copy", readFileSync(docAt(root, "home/Beta"), "utf8"));
  const idx = indexOf(root);
  await idx.sweep();
  const found = await idx.locate({ uids: ["betainvented0001"] });
  expect(found.map((r) => r.id).sort()).toEqual(["home/Beta", "home/Copy"]);
  expect((await idx.holders("betainvented0001")).sort()).toEqual(["home/Beta", "home/Copy"]);
  idx.close();
});

/* ── search ────────────────────────────────────────────────────────────── */

test("SEARCH: names that start with it, then names that contain it, then ids; bounded, with `more` and `complete`", async () => {
  const root = scratch("search");
  put(root, "home", doc("Home", "h0meinvented0001"));
  put(root, "home/Z1", doc("Beta release", "z1invented000001"));
  put(root, "home/Z2", doc("Alpha beta", "z2invented000001"));
  put(root, "home/beta-notes", doc("Notes", "z3invented000001"));
  put(root, "home/Z4", doc("Gamma", "z4invented000001"));
  const idx = indexOf(root);
  // Before a sweep only what was seen is searched, and it says so.
  expect(await idx.search("beta", 10)).toEqual({ hits: [], more: false, complete: false });
  await idx.sweep();
  const all = await idx.search("BETA", 10);
  expect(all.hits.map((h) => h.id)).toEqual(["home/Z1", "home/Z2", "home/beta-notes"]);
  expect([all.more, all.complete]).toEqual([false, true]);
  const two = await idx.search("beta", 2);
  expect(two.hits.map((h) => h.id)).toEqual(["home/Z1", "home/Z2"]);
  expect(two.more).toBe(true);
  // A wildcard is a character like any other.
  expect((await idx.search("%", 10)).hits).toEqual([]);
  // A hit is checked before it is answered: renamed on disk, it is answered as it is now.
  writeFileSync(docAt(root, "home/Z1"), doc("Renamed", "z1invented000001"));
  expect((await idx.search("beta", 10)).hits.map((h) => h.id)).toEqual(["home/Z2", "home/beta-notes"]);
  idx.close();
});

/* ── a level ───────────────────────────────────────────────────────────── */

test("A LEVEL is exactly what `pages.ts` answers without the index — the order by `contents`, the tables, `children` and `uid`", async () => {
  const root = scratch("level");
  const contents = "\n  - name: '@page-Zeta'\n  - name: '@table-jobs'\n  - name: title\n";
  put(root, "home", doc("Home", "h0meinvented0001", contents));
  put(root, "home/Zeta", doc("Zeta", "zetainvented0001"));
  put(root, "home/Alpha", doc("Alpha")); // no uid
  put(root, "home/Alpha/Inner", doc("Inner", "innerinvented001"));
  put(root, "home/Mid", doc("Mid", "midinvented00001"));
  mkdirSync(join(root, pageDir("home/Mid"), "children", "Empty"), { recursive: true }); // a folder, not a page
  mkdirSync(join(root, pageDir("home"), "children", "_hidden"), { recursive: true });
  const tables: TableAt[] = [
    { name: "jobs", rows: 3, parent: "home" },
    { name: "people", rows: 1, parent: "HOME" }, // folded
    { name: "inner", rows: 2, parent: "home/alpha" },
    { name: "orphan", rows: 5, parent: "home/Gone" },
  ];
  const idx = indexOf(root, { tables });
  const plain = makePages(makeFiles(root), yaml, () => tables);
  const level = await idx.level("home");
  expect(level).toEqual(await plain.children("home"));
  expect(level.map((c) => c.id)).toEqual(["home/Zeta", "jobs", "home/Alpha", "home/Mid", "people", "orphan"]);
  expect(level.find((c) => c.id === "home/Alpha")).toMatchObject({ children: true });
  expect(level.find((c) => c.id === "home/Alpha")!.uid).toBeUndefined();
  expect(level.find((c) => c.id === "home/Mid")).toMatchObject({ children: false, uid: "midinvented00001" });
  // The orphan is the root's alone; a level below does not claim it.
  expect((await idx.level("home/Alpha")).map((c) => c.id)).toEqual(["home/Alpha/Inner", "inner"]);
  expect(await idx.level("home/Alpha")).toEqual((await plain.children("home/Alpha")).concat());
  idx.close();
});

test("a page's folder is spelled as `pages.ts` spells it, and a path finds its page", () => {
  for (const id of ["home", "home/Specs", "home/Specs/Chat", "a/b/c/d"]) expect(dirOfPage(id)).toBe(pageDir(id));
  expect(dirOfPage("@design")).toBeNull();
  expect(dirOfPage("home/../x")).toBeNull();
  expect(pageOfPath("pages/home/children/Specs/content.yaml")).toEqual({ id: "home/Specs", dir: "pages/home/children/Specs", rest: "content.yaml" });
  expect(pageOfPath("pages/home/children")).toEqual({ id: "home", dir: "pages/home", rest: "children" });
  expect(pageOfPath("assets/x.png")).toBeNull();
});

/* ── links, moves, the watcher, identities, a corrupt file ─────────────── */

test("RESOLVELINK: the id, the id folded, the id's tail, the name — each only when one page answers", async () => {
  const root = small();
  put(root, "home/Beta/Notes", doc("Beta notes", "betanotes0000001"));
  const idx = indexOf(root);
  expect(await idx.resolveLink("home/Alpha")).toEqual({ kind: "page", id: "home/Alpha" });
  expect(await idx.resolveLink("/HOME/ALPHA/")).toEqual({ kind: "page", id: "home/Alpha" });
  expect(await idx.resolveLink("gamma")).toEqual({ kind: "page", id: "home/Gamma" });
  expect(await idx.resolveLink("the alpha page")).toEqual({ kind: "page", id: "home/Alpha" });
  expect(await idx.resolveLink("@design")).toEqual({ kind: "page", id: "@design" });
  // Two pages end in `notes`, and no name is `notes`: nothing is guessed.
  expect(await idx.resolveLink("notes")).toBeNull();
  expect(await idx.resolveLink("nothing like it")).toBeNull();
  expect(await idx.resolveLink("  ")).toBeNull();
  idx.close();
});

test("MOVED rewrites a page's rows and everything under it", async () => {
  const root = small();
  const idx = indexOf(root);
  await idx.sweep();
  idx.moved("home/Alpha", "home/Beta/Alpha");
  expect(await idx.uidWas("home/Alpha")).toBeNull();
  expect(await idx.uidWas("home/Alpha/Notes")).toBeNull();
  expect(await idx.uidWas("home/Beta/Alpha")).toBe("alphainvented001");
  expect(await idx.uidWas("home/Beta/Alpha/Notes")).toBe("alphanotes000001");
  idx.close();
});

test("WHAT THE WATCHER SAW: an arrival is indexed with its subtree, a departure is gone, a rename is a move", async () => {
  const root = small();
  const idx = indexOf(root);
  await idx.sweep();
  // Arrived, a subtree at once, one page with no uid.
  put(root, "home/New", doc("New", "newinvented00001"));
  put(root, "home/New/Deep", doc("Deep"));
  const arrived = await idx.invalidate(["pages/home/children/New", "pages/home/children"]);
  expect(arrived).toEqual({ noUid: ["home/New/Deep"], moved: [], gone: [] });
  expect(await idx.uidWas("home/New")).toBe("newinvented00001");
  // Renamed on disk: the uid left one folder and turned up at another.
  renameSync(join(root, pageDir("home/Beta")), join(root, pageDir("home/Bravo")));
  const renamed = await idx.invalidate(["pages/home/children/Beta", "pages/home/children/Bravo"]);
  expect(renamed.moved).toEqual([{ uid: "betainvented0001", from: "home/Beta", to: "home/Bravo" }]);
  expect(renamed.gone).toEqual([]);
  // Gone.
  rmSync(join(root, pageDir("home/Gamma")), { recursive: true, force: true });
  expect((await idx.invalidate(["pages/home/children/Gamma"])).gone).toEqual(["home/Gamma"]);
  // A page written whole without its uid is news for the identities.
  writeFileSync(docAt(root, "home/Alpha"), doc("The Alpha Page"));
  expect((await idx.invalidate(["pages/home/children/Alpha/content.yaml"])).noUid).toEqual(["home/Alpha"]);
  idx.close();
});

test("THE IDENTITIES ASK THE INDEX: a page nobody asked about this session, written whole without its uid, gets its own back", async () => {
  const root = small();
  const idx = indexOf(root);
  await idx.sweep();
  // Nothing has asked the identities anything; their memory is empty.
  const ids = makeIdentities(makeFiles(root), yaml, () => {}, idx);
  writeFileSync(docAt(root, "home/Beta"), doc("Beta, rewritten by an agent"));
  expect(await ids.of("home/Beta")).toBe("betainvented0001");
  await ids.written();
  expect(readFileSync(docAt(root, "home/Beta"), "utf8")).toContain("uid: betainvented0001");
  // And a uid another page holds now is not handed out twice.
  put(root, "home/Clone", doc("Clone", "alphainvented001"));
  await idx.head("home/Clone");
  writeFileSync(docAt(root, "home/Alpha"), doc("The Alpha Page"));
  rmSync(join(root, pageDir("home/Clone")), { recursive: true, force: true });
  put(root, "home/Clone", doc("Clone", "alphainvented001"));
  await idx.head("home/Clone");
  const fresh = await ids.of("home/Alpha");
  expect(fresh).not.toBe("alphainvented001");
  idx.close();
});

test("A CORRUPT INDEX FILE is rebuilt, and an index that cannot keep a cache still answers", async () => {
  const root = small();
  const path = join(root, ".biom", "pages.db");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "this is not a database, it is invented junk ".repeat(40));
  const first = makeDb(path);
  let closedFirst = false;
  let closedBeforeReset: boolean | null = null;
  const idx = makePageIndex({
    db: { ...first, close: () => { closedFirst = true; first.close(); } },
    disk: makeFiles(root),
    yaml,
    tables: () => [],
    now: Date.now,
    reset: () => {
      // The index lets go of the old file before the root deletes it.
      closedBeforeReset = closedFirst;
      rmSync(path, { force: true });
      return makeDb(path);
    },
  });
  expect((await idx.level("home")).map((c) => c.id)).toEqual(["home/Alpha", "home/Beta", "home/Gamma"]);
  expect(closedBeforeReset).toBe(true);
  await idx.sweep();
  expect(await idx.uidWas("home/Beta")).toBe("betainvented0001");
  idx.close();
  // With no way to a fresh file, every answer is still right, off the disk.
  writeFileSync(path, "junk again ".repeat(40));
  const blind = makePageIndex({ db: makeDb(path), disk: makeFiles(root), yaml, tables: () => [], now: Date.now });
  expect((await blind.level("home")).map((c) => c.id)).toEqual(["home/Alpha", "home/Beta", "home/Gamma"]);
  expect(await blind.locate({ ids: ["home/Beta"] })).toEqual([{ id: "home/Beta", name: "Beta", uid: "betainvented0001" }]);
  blind.close();
});

test("a whole list is depth first, siblings by id, and read after a sweep", async () => {
  const root = small();
  const idx = indexOf(root);
  const plain = makePages(makeFiles(root), yaml);
  expect(await idx.list()).toEqual(await plain.list());
  idx.close();
});
