// SPDX-License-Identifier: AGPL-3.0-only
// PAGES THE WINDOW HAS NOT LOADED, ANSWERED FROM THE INDEX — the `page.locate`,
// `page.search` and `link.resolve` cases in `server/api/routes.ts`, and the
// index told of the app's own moves.
//
// What is held: each kind is answered by the one index call it is, with its
// bounds checked on the way in and a malformed one refused as `bad_request`;
// a link no page answers falls through to a table, by name and then folded; a
// build with no index says it does not offer them; a page the app moves or
// renames is found by its `uid` at its new id with no sweep of the workspace;
// and a request made while the index sweeps two thousand folders is answered
// promptly. Every page, table and id here is invented.

import { test, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handle } from "../server/api/routes.ts";
import type { Deps } from "../server/api/routes.ts";
import { makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { makePageIndex } from "../server/domain/pageindex.ts";
import type { PageIndex, PageIndexDeps } from "../server/domain/pageindex.ts";
import { LOCATE_MAX, PROTOCOL, SEARCH_MAX } from "../contracts/wire.js";
import type { ApiRequest, ApiResponse, PageRef } from "../contracts/types.ts";

const FRAMEWORK = join(import.meta.dir, "..");
const unix = process.platform !== "win32";
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

let n = 0;
const ask = (deps: Deps, o: Record<string, unknown>): Promise<ApiResponse> =>
  handle({ id: `r${++n}`, g: PROTOCOL, ...o } as ApiRequest, deps);

/** An index that answers from a script and writes down what it was asked. */
function fakeIndex(links: Record<string, string> = {}) {
  const asked: unknown[][] = [];
  const index = {
    locate: async (q: unknown) => { asked.push(["locate", q]); return [{ id: "home/Found", name: "Found", uid: "inventedfound01" }] as PageRef[]; },
    search: async (query: string, limit: number) => { asked.push(["search", query, limit]); return { hits: [], more: false, complete: true }; },
    resolveLink: async (target: string) => { asked.push(["resolveLink", target]); return links[target] === undefined ? null : { kind: "page" as const, id: links[target]! }; },
    moved: (from: string, to: string) => { asked.push(["moved", from, to]); },
  };
  const tables = { list: () => [{ name: "Invented_Orders", rows: 3, parent: null }, { name: "Stock", rows: 1, parent: null }] };
  const deps = { index, tables } as unknown as Deps;
  return { deps, asked };
}

test("PAGE.LOCATE is the index's locate, with the lists as asked", async () => {
  const f = fakeIndex();
  const r = await ask(f.deps, { kind: "page.locate", ids: ["home/Found"], uids: ["inventedfound01"] });
  expect(r).toMatchObject({ ok: true, value: [{ id: "home/Found" }] });
  expect(f.asked).toEqual([["locate", { ids: ["home/Found"], uids: ["inventedfound01"] }]]);
});

test("a page.locate with no list, or one past LOCATE_MAX, is refused before the index is asked", async () => {
  const f = fakeIndex();
  expect(await ask(f.deps, { kind: "page.locate" })).toMatchObject({ ok: false, error: { code: "bad_request" } });
  const many = Array.from({ length: LOCATE_MAX + 1 }, (_, i) => `home/P${i}`);
  expect(await ask(f.deps, { kind: "page.locate", ids: many })).toMatchObject({ ok: false, error: { code: "bad_request" } });
  expect(f.asked).toEqual([]);
});

test("PAGE.SEARCH is the index's search, at SEARCH_MAX where no limit is asked", async () => {
  const f = fakeIndex();
  expect(await ask(f.deps, { kind: "page.search", query: "inv" })).toMatchObject({ ok: true, value: { hits: [], more: false, complete: true } });
  await ask(f.deps, { kind: "page.search", query: "inv", limit: 7 });
  expect(f.asked).toEqual([["search", "inv", SEARCH_MAX], ["search", "inv", 7]]);
  expect(await ask(f.deps, { kind: "page.search", query: "  " })).toMatchObject({ ok: false, error: { code: "bad_request" } });
  expect(await ask(f.deps, { kind: "page.search", query: "inv", limit: SEARCH_MAX + 1 })).toMatchObject({ ok: false, error: { code: "bad_request" } });
});

test("LINK.RESOLVE asks the index for a page first, then a table by its name, then folded, and answers null where nothing is named", async () => {
  const f = fakeIndex({ "Invented Page": "home/Invented_Page" });
  expect(await ask(f.deps, { kind: "link.resolve", target: "Invented Page" })).toMatchObject({ ok: true, value: { kind: "page", id: "home/Invented_Page" } });
  expect(await ask(f.deps, { kind: "link.resolve", target: "Invented_Orders" })).toMatchObject({ ok: true, value: { kind: "table", id: "Invented_Orders" } });
  expect(await ask(f.deps, { kind: "link.resolve", target: "stock" })).toMatchObject({ ok: true, value: { kind: "table", id: "Stock" } });
  expect(await ask(f.deps, { kind: "link.resolve", target: "Nothing Invented" })).toMatchObject({ ok: true, value: null });
  expect(await ask(f.deps, { kind: "link.resolve", target: "" })).toMatchObject({ ok: false, error: { code: "bad_request" } });
});

test("a build with no index says it does not offer the three", async () => {
  const deps = { tables: { list: () => [] } } as unknown as Deps;
  for (const o of [{ kind: "page.locate", ids: ["home"] }, { kind: "page.search", query: "x" }, { kind: "link.resolve", target: "x" }]) {
    expect(await ask(deps, o)).toMatchObject({ ok: false, error: { code: "unsupported" } });
  }
});

/** A small vault on disk, a host over it, and an index that counts its sweeps. */
async function small(): Promise<{ vault: string; host: Host; sweeps: () => number }> {
  const ground = await mkdtemp(join(tmpdir(), "biom-routes-scale-"));
  made.push(ground);
  const vault = join(ground, "vault");
  const put = async (rel: string, name: string, uid: string) => {
    await mkdir(join(vault, rel), { recursive: true });
    await writeFile(join(vault, rel, "content.yaml"), `name: ${name}\nuid: ${uid}\nplugin: biom-doc\ncontents: []\n`);
  };
  await put("pages/home", "Home", "inventedroutehome");
  await put("pages/home/children/Left", "Left", "inventedrouteleft");
  await put("pages/home/children/Right", "Right", "inventedrouteright");
  await put("pages/home/children/Left/children/Wander", "Wander", "inventedroutewander");
  await put("pages/home/children/Left/children/Wander/children/Under", "Under", "inventedrouteunder");
  let sweeps = 0;
  const pageIndex = (deps: PageIndexDeps): PageIndex => {
    const inner = makePageIndex(deps);
    return new Proxy(inner, {
      get(target, key, receiver) {
        if (key === "sweep") return () => { sweeps++; return target.sweep(); };
        return Reflect.get(target, key, receiver);
      },
    });
  };
  const host = await makeHost({ vault, memory: join(ground, "vaults.json"), presets: join(FRAMEWORK, "presets"), agentsHome: join(ground, "agents"), pageIndex });
  await host.settled(vault);
  return { vault, host, sweeps: () => sweeps };
}

test.if(unix)("A PAGE THE APP MOVES is found by its uid at its new id, and so is the page under it, with no sweep of the workspace", async () => {
  const s = await small();
  try {
    const deps = await s.host.deps(s.vault);
    const moved = await ask(deps, { kind: "page.move", page: "home/Left/Wander", parent: "home/Right" });
    expect(moved).toMatchObject({ ok: true, value: "home/Right/Wander" });
    const before = s.sweeps();
    const found = (await ask(deps, { kind: "page.locate", uids: ["inventedroutewander", "inventedrouteunder"] })) as { ok: true; value: PageRef[] };
    expect(found.value.map((p) => p.id).sort()).toEqual(["home/Right/Wander", "home/Right/Wander/Under"]);
    expect(s.sweeps()).toBe(before);
  } finally {
    s.host.close();
  }
}, 30_000);

test.if(unix)("the host's own deps answer a link by a page's name and by its id's tail, off its index", async () => {
  const s = await small();
  try {
    const deps = await s.host.deps(s.vault);
    expect(await ask(deps, { kind: "link.resolve", target: "Under" })).toMatchObject({ ok: true, value: { kind: "page", id: "home/Left/Wander/Under" } });
    expect(await ask(deps, { kind: "link.resolve", target: "wander" })).toMatchObject({ ok: true, value: { kind: "page", id: "home/Left/Wander" } });
    expect(await ask(deps, { kind: "doc.list" })).toMatchObject({ ok: true });
  } finally {
    s.host.close();
  }
}, 30_000);

test.if(unix)("A PAGE THE APP RENAMES is found by its uid at its new id, with no sweep of the workspace", async () => {
  const s = await small();
  try {
    const deps = await s.host.deps(s.vault);
    const renamed = await ask(deps, { kind: "page.rename", page: "home/Right", name: "Starboard" });
    expect(renamed).toMatchObject({ ok: true, value: "home/Starboard" });
    const before = s.sweeps();
    const found = (await ask(deps, { kind: "page.locate", uids: ["inventedrouteright"] })) as { ok: true; value: PageRef[] };
    expect(found.value.map((p) => p.id)).toEqual(["home/Starboard"]);
    expect(s.sweeps()).toBe(before);
  } finally {
    s.host.close();
  }
}, 30_000);

test.if(unix)("A REQUEST WHILE THE INDEX SWEEPS TWO THOUSAND FOLDERS is answered within 100 ms", async () => {
  const ground = await mkdtemp(join(tmpdir(), "biom-routes-sweep-"));
  made.push(ground);
  const vault = join(ground, "vault");
  const put = async (rel: string, name: string, uid: string) => {
    await mkdir(join(vault, rel), { recursive: true });
    await writeFile(join(vault, rel, "content.yaml"), `name: ${name}\nuid: ${uid}\nplugin: biom-doc\ncontents: []\n`);
  };
  await put("pages/home", "Home", "inventedsweephome");
  for (let t = 0; t < 20; t++) {
    await put(`pages/home/children/T${t}`, `Top ${t}`, `inventedsweeptop${String(t).padStart(3, "0")}`);
    for (let i = 0; i < 100; i++) await put(`pages/home/children/T${t}/children/P${i}`, `Page ${t}.${i}`, `inventedsweep${String(t * 100 + i).padStart(6, "0")}`);
  }
  const host = await makeHost({ vault, memory: join(ground, "vaults.json"), presets: join(FRAMEWORK, "presets"), agentsHome: join(ground, "agents") });
  try {
    await host.settled(vault);
    const deps = await host.deps(vault);
    // A cold cache: the next sweep reads every head again.
    const index = (deps as Deps & { index: PageIndex }).index;
    const all = await index.list();
    for (const p of all) await writeFile(join(vault, "pages", p.id.split("/").join("/children/"), "content.yaml"), `name: ${p.name}\nuid: ${p.uid}\nplugin: biom-doc\ncontents: []\n`);
    let done = false;
    const sweeping = index.sweep().then(() => { done = true; });
    const worst: number[] = [];
    while (!done) {
      const t0 = performance.now();
      const r = await ask(deps, { kind: "page.locate", ids: ["home/T7/P42"] });
      worst.push(performance.now() - t0);
      expect(r.ok).toBe(true);
      await Bun.sleep(5);
    }
    await sweeping;
    expect(worst.length).toBeGreaterThan(0);
    expect(Math.max(...worst)).toBeLessThan(100);
  } finally {
    host.close();
  }
}, 60_000);
