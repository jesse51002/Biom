// SPDX-License-Identifier: AGPL-3.0-only
// THE PARSE BUDGET — what the pages domain and the page index may parse to
// answer what is on screen, on a workspace of two thousand pages.
//
// The rule the twelfth contracts edit builds to: nothing on the path to what
// is on screen parses every page. Reading is not the cost, parsing is — so the
// budget is counted in parses, with `countingYaml`, and never in milliseconds,
// which a slow machine would make a flake of. A level is ONE parse (its
// parent's own order), whatever its size; a page read is ONE; a list after a
// sweep, a hundred uids located, a search and a sweep over a vault that has
// not changed are NONE. And the same level and read cost the same without the
// index, named from heads.
//
// The workspace is generated here and every page in it is invented: seven top
// pages, one of 228 children in a single level, and about 1,400 pages two
// levels down — the shape of the workspace this was measured on.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { makePageIndex } from "../server/domain/pageindex.ts";
import type { PageIndex } from "../server/domain/pageindex.ts";
import { makePages, pageDir, PAGE_DOC } from "../server/domain/pages.ts";
import type { PageLevels } from "../server/domain/pages.ts";
import { makeFiles, makeSeen } from "../server/platform/files.ts";
import { makeDb } from "../server/platform/db.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { countingYaml } from "./scale-helpers.ts";

const real = { parse, parseAny, format, formatAny };
let root = "";
let pages = 0;
const uids: string[] = [];

function put(id: string, name: string, uid: string, contents = "[]"): void {
  const at = join(root, pageDir(id), PAGE_DOC);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(
    at,
    `name: ${name}\nuid: ${uid}\nplugin: biom-doc\nvariables:\n  status: draft\ncontents: ${contents}\n` +
      "  # invented words, enough to make a document more than its head\n",
  );
  pages++;
  uids.push(uid);
}
const uidFor = (n: number) => `inv${String(n).padStart(9, "0")}`;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "biom-scale-")));
  let n = 0;
  put("home", "Home", uidFor(n++), "\n  - name: title\n    parts:\n      body: '# Home'\n");
  const tops: [string, number, number][] = [
    ["Automations", 32, 44], ["Historic", 228, 0], ["Boards", 143, 0], ["Docs", 20, 3], ["Architecture", 29, 0], ["Specs", 22, 0], ["Demos", 14, 0],
  ];
  for (const [top, count, grand] of tops) {
    put(`home/${top}`, top, uidFor(n++), "\n  - name: title\n    parts:\n      body: '# A top page'\n");
    for (let i = 0; i < count; i++) {
      const id = `home/${top}/2026-09-${String(1 + (i % 28)).padStart(2, "0")}-${top}_${i}`;
      put(id, `${top} ${i}`, uidFor(n++));
      for (let j = 0; j < grand; j++) put(`${id}/run-${String(j).padStart(3, "0")}`, `Run ${j} of ${top} ${i}`, uidFor(n++));
    }
  }
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** A fresh index over the workspace, with a counting codec, and the pages
 *  domain over it as the composition root builds it. */
function stand(label: string) {
  const counting = countingYaml(real);
  const index: PageIndex = makePageIndex({
    db: makeDb(join(root, ".biom", `${label}.db`)),
    disk: makeFiles(root),
    yaml: counting.yaml,
    tables: () => [],
    now: Date.now,
  });
  const domain = makePages(makeFiles(root, makeSeen()), counting.yaml, () => [], undefined, "Home", undefined, null, async () => ({}), index as PageLevels);
  return { counting, index, domain };
}

/** How many parses one call costs. */
async function spend(counting: ReturnType<typeof countingYaml>, run: () => Promise<unknown>): Promise<number> {
  counting.reset();
  await run();
  return counting.parses();
}

test("the generated workspace is the size this budget is about", () => {
  expect(pages).toBeGreaterThan(1900);
});

test("A LEVEL IS ONE PARSE — its parent's own order — whatever its size, and none once that is kept", async () => {
  const { counting, domain, index } = stand("level");
  expect(await spend(counting, () => domain.children("home/Historic"))).toBe(1);
  expect((await domain.children("home/Historic")).length).toBe(228);
  expect(await spend(counting, () => domain.children("home/Historic"))).toBe(0);
  expect(await spend(counting, () => domain.children("home/Specs"))).toBe(1);
  expect(await spend(counting, () => domain.children("home/Automations/2026-09-01-Automations_0"))).toBe(1);
  index.close();
});

test("A PAGE READ IS ONE PARSE: a leaf, and a page of 228 children", async () => {
  const { counting, domain, index } = stand("read");
  expect(await spend(counting, () => domain.read("home/Specs/2026-09-01-Specs_0"))).toBe(1);
  expect(await spend(counting, () => domain.read("home/Historic"))).toBe(1);
  expect((await domain.read("home/Historic"))!.id).toBe("home/Historic");
  index.close();
});

test("A SWEEP READS HEADS AND PARSES NOTHING; after it, the list, a hundred uids and a search parse nothing either", async () => {
  const { counting, domain, index } = stand("sweep");
  expect(await spend(counting, () => index.sweep())).toBe(0);
  expect(await spend(counting, () => index.sweep())).toBe(0);
  let listed = 0;
  expect(await spend(counting, async () => { listed = (await domain.list()).length; })).toBe(0);
  expect(listed).toBe(pages);
  const hundred = uids.slice(100, 200);
  let found = 0;
  expect(await spend(counting, async () => { found = (await index.locate({ uids: hundred })).length; })).toBe(0);
  expect(found).toBe(100);
  expect(await spend(counting, () => index.search("historic", 50))).toBe(0);
  const hits = await index.search("historic", 50);
  expect([hits.hits.length, hits.more, hits.complete]).toEqual([50, true, true]);
  index.close();
});

test("WITHOUT THE INDEX the same answers cost the same: a level one parse, a read one, the list none", async () => {
  const counting = countingYaml(real);
  const domain = makePages(makeFiles(root), counting.yaml, () => []);
  expect(await spend(counting, () => domain.children("home/Historic"))).toBe(1);
  expect(await spend(counting, () => domain.read("home/Historic"))).toBe(1);
  expect(await spend(counting, () => domain.read("home/Specs/2026-09-01-Specs_0"))).toBe(1);
  expect(await spend(counting, () => domain.list())).toBe(0);
}, 30000);

test("A TYPE SCALE IS PARSED ONCE and read again only when its stat moves", async () => {
  const at = join(root, pageDir("home/Docs"), "markdown.yaml");
  const house = join(root, "markdown.yaml");
  writeFileSync(house, "measure: 40ch\n");
  writeFileSync(at, "measure: 48ch\n");
  try {
    const counting = countingYaml(real);
    const domain = makePages(makeFiles(root), counting.yaml, () => []);
    // The page, the house scale and the page's own: three the first time …
    expect(await spend(counting, () => domain.read("home/Docs"))).toBe(3);
    // … and the page alone after, while neither scale has moved.
    expect(await spend(counting, () => domain.read("home/Docs"))).toBe(1);
    expect((await domain.read("home/Docs"))!.markdown).toMatchObject({ "--md-measure": "48ch" });
    writeFileSync(at, "measure: 52ch\n");
    expect(await spend(counting, () => domain.read("home/Docs"))).toBe(2);
    expect((await domain.read("home/Docs"))!.markdown).toMatchObject({ "--md-measure": "52ch" });
    rmSync(at);
    expect((await domain.read("home/Docs"))!.markdown).toMatchObject({ "--md-measure": "40ch" });
  } finally {
    rmSync(at, { force: true });
    rmSync(house, { force: true });
  }
});
