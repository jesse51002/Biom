// SPDX-License-Identifier: AGPL-3.0-only
// OPENING A WORKSPACE OF TWO THOUSAND PAGES — `mount` and the work after it in
// `server/main.ts`.
//
// The rule is that nothing on the path to what is on screen reads or parses
// every page. What is held here, on a generated vault of about two thousand
// pages:
//
//   - the mount parses at most five documents, and never asks for every page;
//   - the format gate runs once per vault per build: a vault stamped by this
//     build is not walked again, so a page in an older format dropped in
//     after the stamp does not refuse the mount — it opens saying its plugin
//     is not there — while a stamp from another build is walked again;
//   - requests are answered promptly while the work after the mount — the
//     sweep, identities, runs, the mirror — goes on in the background.
//
// Every page, word and id here is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { handle } from "../server/api/routes.ts";
import { FORMAT_STAMP } from "../server/workspace/migrate.ts";
import { MISSING_DOCUMENT } from "../server/domain/pages.ts";
import { makePageIndex } from "../server/domain/pageindex.ts";
import type { PageIndex, PageIndexDeps } from "../server/domain/pageindex.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { countingYaml } from "./scale-helpers.ts";
import { PROTOCOL } from "../contracts/wire.js";
import type { ApiRequest, ApiResponse, Page } from "../contracts/types.ts";

const FRAMEWORK = join(import.meta.dir, "..");
const yaml = { parse, parseAny, format, formatAny };

/** A vault shaped like a large real one — seven sections, one of them holding
 *  most pages two levels down — with small invented documents. */
async function bigVault(root: string, pages = 2000): Promise<number> {
  let n = 0;
  const page = async (dir: string, name: string) => {
    await mkdir(dir, { recursive: true });
    const uid = `inv${String(n++).padStart(9, "0")}`;
    await writeFile(join(dir, "content.yaml"), `name: ${name}\nuid: ${uid}\nplugin: biom-doc\nvariables:\n  status: draft\ncontents:\n  - name: s0\n    parts:\n      body: |\n        Invented words for ${name}.\n`);
  };
  await page(join(root, "pages/home"), "Home");
  const tops = ["Automations", "Historic", "Boards", "Docs", "Architecture", "Specs", "Demos"];
  for (const top of tops) await page(join(root, "pages/home/children", top), top);
  let i = 0;
  while (n < pages) {
    const top = tops[i % tops.length]!;
    const seg = `Item_${i}`;
    const dir = join(root, "pages/home/children", top, "children", seg);
    await page(dir, `${top} ${i}`);
    if (top === "Automations" && n < pages) await page(join(dir, "children", `run-${i}`), `Run ${i}`);
    i++;
  }
  return n;
}

let ground = "";
let big = "";
let data = "";
beforeAll(async () => {
  ground = await mkdtemp(join(tmpdir(), "biom-mount-scale-"));
  big = join(ground, "big");
  data = join(ground, "data");
  await mkdir(data, { recursive: true });
  await bigVault(big);
}, 60_000);
afterAll(async () => {
  await rm(ground, { recursive: true, force: true });
});

let n = 0;
const call = async (host: Host, vault: string, o: Record<string, unknown>): Promise<ApiResponse> =>
  await handle({ id: `m${++n}`, g: PROTOCOL, ...o } as ApiRequest, await host.deps(vault));

/** The index the mount is handed: the real one, counting its whole-list
 *  reads, and with its sweep held until the test lets it go — so nothing of
 *  the background runs while the mount is being counted. */
function heldIndex() {
  let lists = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const make = (deps: PageIndexDeps): PageIndex => {
    const inner = makePageIndex(deps);
    return new Proxy(inner, {
      get(target, key, receiver) {
        if (key === "list") return async () => { lists++; return await target.list(); };
        if (key === "sweep") return async () => { await gate; return await target.sweep(); };
        return Reflect.get(target, key, receiver);
      },
    });
  };
  return { make, lists: () => lists, release: () => release() };
}

test("MOUNTING TWO THOUSAND PAGES PARSES AT MOST FIVE DOCUMENTS, and never asks for every page", async () => {
  const count = countingYaml(yaml);
  const held = heldIndex();
  const host = await makeHost({
    vault: big, memory: join(data, "a.json"), presets: join(FRAMEWORK, "presets"), agentsHome: join(data, "agents"),
    yaml: count.yaml as never, pageIndex: held.make,
  });
  try {
    expect(host.open()).toEqual([big]);
    expect(count.parses()).toBeLessThanOrEqual(5);
    expect(held.lists()).toBe(0);
  } finally {
    held.release();
    await host.settled(big);
    host.close();
  }
}, 60_000);

test("A STAMPED VAULT SKIPS THE FORMAT GATE: a page in an older format dropped in afterwards opens saying its plugin is not there, and another build's stamp walks again", async () => {
  const small = join(ground, "stamped");
  await mkdir(join(small, "pages/home"), { recursive: true });
  await writeFile(join(small, "pages/home/content.yaml"), "name: Home\nuid: invstampedhome\nplugin: biom-doc\ncontents: []\n");
  const open = async () => {
    const host = await makeHost({ vault: small, memory: join(data, "b.json"), presets: join(FRAMEWORK, "presets"), agentsHome: join(data, "agents") });
    return host;
  };
  const first = await open();
  expect(first.trouble).toBeNull();
  await first.settled(small);
  first.close();
  const stamp = JSON.parse(await readFile(join(small, FORMAT_STAMP), "utf8")) as { format: number; build: string };
  expect(stamp.format).toBe(5);

  // Format 4's tell: a framework plugin named by its bare word.
  await mkdir(join(small, "pages/home/children/Old"), { recursive: true });
  await writeFile(join(small, "pages/home/children/Old/content.yaml"), "name: Old\nuid: invstampedold1\nplugin: doc\ncontents: []\n");
  const second = await open();
  try {
    expect(second.trouble).toBeNull();
    const old = await call(second, small, { kind: "page.read", page: "home/Old" });
    expect(old.ok).toBe(true);
    expect((old as { value: Page }).value.html).toBe(MISSING_DOCUMENT);
  } finally {
    await second.settled(small);
    second.close();
  }

  // A stamp another build wrote is no stamp: the walk runs, and refuses.
  await writeFile(join(small, FORMAT_STAMP), JSON.stringify({ format: 5, build: "an invented other build" }));
  const third = await open();
  try {
    expect(third.trouble).toContain("vault format 4");
  } finally {
    third.close();
  }
}, 60_000);

test("REQUESTS ARE ANSWERED PROMPTLY WHILE THE WORK AFTER THE MOUNT RUNS: the sweep, identities, runs and the mirror of two thousand pages yield between pages", async () => {
  const vault = join(ground, "busy");
  await bigVault(vault);
  const host = await makeHost({ vault, memory: join(data, "c.json"), presets: join(FRAMEWORK, "presets"), agentsHome: join(data, "agents") });
  try {
    // The mirror has never been written: the work after the mount projects
    // every page. Ask things while it does.
    const slowest: number[] = [];
    let settled = false;
    const done = host.settled(vault).then(() => { settled = true; });
    while (!settled && slowest.length < 200) {
      const a = performance.now();
      const r = await call(host, vault, { kind: "vault.info" });
      expect(r.ok).toBe(true);
      slowest.push(performance.now() - a);
      await Bun.sleep(5);
    }
    await done;
    expect(slowest.length).toBeGreaterThan(5);
    const worst = Math.max(...slowest);
    expect(worst).toBeLessThan(100);
  } finally {
    host.close();
  }
}, 120_000);
