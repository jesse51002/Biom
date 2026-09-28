// SPDX-License-Identifier: AGPL-3.0-only
// THE WATCHER'S SETTLE, AT SCALE — `settle` in `server/main.ts`, and the
// `change` it says on the stream.
//
// What is held: an outside write to one page costs at most two parses, names
// that page and names no level; one that renames it names its parent's level
// too; a page arriving, or deleted, names its parent's level and the one
// above it — even where the index was asked about it first — and
// the index is told only about its folder; a folder moved in a file manager
// names both parents and takes its runs with it by identity; a page whose
// `uid` an outside save dropped is given one on the next settle where a page
// arrives, and not on an edit; and a burst too
// big to name says `all`. Nothing here lists every page. Every page, run and
// word is invented.

import { test, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { handle } from "../server/api/routes.ts";
import { makePageIndex } from "../server/domain/pageindex.ts";
import type { PageIndex, PageIndexDeps } from "../server/domain/pageindex.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { countingYaml } from "./scale-helpers.ts";
import { LOCATE_MAX, PROTOCOL } from "../contracts/wire.js";
import type { ApiRequest, ApiResponse, ChangeEvent } from "../contracts/types.ts";

const FRAMEWORK = join(import.meta.dir, "..");
const unix = process.platform !== "win32";
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const doc = (name: string, uid: string) => `name: ${name}\nuid: ${uid}\nplugin: biom-doc\ncontents:\n  - name: s0\n    parts:\n      body: |\n        Invented words for ${name}.\n`;
const dirOf = (vault: string, id: string) => join(vault, "pages", id.split("/").join("/children/"));

/** A vault of a root, two sections and a few pages under each, and a host over
 *  it whose index records what it is told and whose codec counts. */
async function stand(extra = 0) {
  const ground = await mkdtemp(join(tmpdir(), "biom-settle-scale-"));
  made.push(ground);
  const vault = join(ground, "vault");
  const put = async (id: string, name: string, uid: string) => {
    await mkdir(dirOf(vault, id), { recursive: true });
    await writeFile(join(dirOf(vault, id), "content.yaml"), doc(name, uid));
  };
  await put("home", "Home", "invsettlehome");
  for (const top of ["Left", "Right"]) {
    await put(`home/${top}`, top, `invsettle${top.toLowerCase()}`);
    for (let i = 0; i < 5; i++) await put(`home/${top}/P${i}`, `${top} ${i}`, `invsettle${top.toLowerCase()}${i}xx`);
  }
  for (let i = 0; i < extra; i++) await put(`home/Left/Burst${i}`, `Burst ${i}`, `invburst${String(i).padStart(6, "0")}`);
  const count = countingYaml({ parse, parseAny, format, formatAny });
  const told: string[][] = [];
  const pageIndex = (deps: PageIndexDeps): PageIndex => {
    const inner = makePageIndex(deps);
    return new Proxy(inner, {
      get(target, key, receiver) {
        if (key === "invalidate") return async (rels: readonly string[]) => { told.push([...rels]); return await target.invalidate(rels); };
        return Reflect.get(target, key, receiver);
      },
    });
  };
  const host = await makeHost({
    vault, memory: join(ground, "vaults.json"), presets: join(FRAMEWORK, "presets"), agentsHome: join(ground, "agents"),
    yaml: count.yaml as never, pageIndex,
  });
  await host.settled(vault);
  const changes: ChangeEvent[] = [];
  const off = await host.watch(vault, (c) => void changes.push(c as ChangeEvent));
  return { vault, host, count, told, changes, off, put };
}

async function until(ok: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return true;
    await Bun.sleep(20);
  }
  return ok();
}

let n = 0;
const call = async (host: Host, vault: string, o: Record<string, unknown>): Promise<ApiResponse> =>
  await handle({ id: `s${++n}`, g: PROTOCOL, ...o } as ApiRequest, await host.deps(vault));

test.if(unix)("AN OUTSIDE WRITE TO ONE PAGE costs at most two parses, names that page, and names no level", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.count.reset();
    w.changes.length = 0;
    await writeFile(join(dirOf(w.vault, "home/Left/P2"), "content.yaml"), doc("Left 2", "invsettleleft2xx").replace("Invented words for Left 2.", "Invented words, edited outside."));
    expect(await until(() => w.changes.length > 0)).toBe(true);
    expect(w.changes[0]).toEqual({ pages: ["home/Left/P2"], levels: [] });
    expect(w.count.parses()).toBeLessThanOrEqual(2);
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A PAGE RENAMED FROM OUTSIDE names its parent's level as well as itself, so the rail is listed again with the new name", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    await writeFile(join(dirOf(w.vault, "home/Left/P1"), "content.yaml"), doc("Left 1, renamed outside", "invsettleleft1xx"));
    expect(await until(() => w.changes.length > 0)).toBe(true);
    expect(w.changes[0]).toEqual({ pages: ["home/Left/P1"], levels: ["home/Left"] });
    const level = (await call(w.host, w.vault, { kind: "children", page: "home/Left" })) as { ok: true; value: { id: string; name: string }[] };
    expect(level.value.find((c) => c.id === "home/Left/P1")?.name).toBe("Left 1, renamed outside");
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A PAGE AN AGENT MAKES, found by its uid before the watcher's settle, is still an arrival that names its parent's level", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    // Its folder and document in one go, as an agent's write through Biom
    // makes them — and the history, or the switcher, asks the index for the
    // page before the settle has run.
    await w.put("home/Right/Made", "Made", "invsettlemade01");
    await call(w.host, w.vault, { kind: "page.locate", uids: ["invsettlemade01"] });
    expect(await until(() => w.changes.length > 0)).toBe(true);
    await Bun.sleep(300);
    expect(w.changes.flatMap((c) => c.levels)).toContain("home/Right");
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A PAGE A WINDOW READ BEFORE THE WATCHER'S SETTLE is still an arrival that names its parent's level", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    // Made from outside, and read at once — the switcher following an agent's
    // write, or the history naming it — before the settle has run.
    await w.put("home/Left/Seen", "Seen", "invsettleseen01");
    expect((await call(w.host, w.vault, { kind: "page.read", page: "home/Left/Seen" })).ok).toBe(true);
    expect(await until(() => w.changes.length > 0)).toBe(true);
    await Bun.sleep(300);
    expect(w.changes.flatMap((c) => c.levels)).toContain("home/Left");
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A FIRST CHILD names the level above its parent too, where the parent's row learns that it holds a page", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    await w.put("home/Left/P1/First", "First", "invsettlefirst1");
    expect(await until(() => w.changes.length > 0)).toBe(true);
    await Bun.sleep(300);
    const levels = w.changes.flatMap((c) => c.levels);
    expect(levels).toContain("home/Left/P1");
    expect(levels).toContain("home/Left");
    const level = (await call(w.host, w.vault, { kind: "children", page: "home/Left" })) as { ok: true; value: { id: string; children?: boolean }[] };
    expect(level.value.find((c) => c.id === "home/Left/P1")?.children).toBe(true);
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A PAGE ARRIVING names its parent's level, and the index is told only about its folder", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    w.told.length = 0;
    await w.put("home/Right/Arrived", "Arrived", "invsettlearrived");
    expect(await until(() => w.changes.some((c) => c.levels.includes("home/Right")))).toBe(true);
    const change = w.changes.find((c) => c.levels.includes("home/Right"))!;
    expect(change.all).toBeUndefined();
    expect(change.pages).toContain("home/Right/Arrived");
    const here = join("pages", "home", "children", "Right", "children");
    for (const rels of w.told) for (const rel of rels) expect(rel === here || rel.startsWith(`${here}/Arrived`)).toBe(true);
    // And the level the window rereads has it.
    const level = (await call(w.host, w.vault, { kind: "children", page: "home/Right" })) as { ok: true; value: { id: string }[] };
    expect(level.value.some((c) => c.id === "home/Right/Arrived")).toBe(true);
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A PAGE DELETED FROM OUTSIDE that this process never read names itself, its parent's level and the one above, and leaves the level", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    await rm(dirOf(w.vault, "home/Right/P2"), { recursive: true, force: true });
    expect(await until(() => w.changes.some((c) => c.levels.includes("home/Right")))).toBe(true);
    expect(w.changes.find((c) => c.levels.includes("home/Right"))).toEqual({ pages: ["home/Right/P2"], levels: ["home/Right", "home"] });
    const level = (await call(w.host, w.vault, { kind: "children", page: "home/Right" })) as { ok: true; value: { id: string }[] };
    expect(level.value.some((c) => c.id === "home/Right/P2")).toBe(false);
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("a page the app removes, moves or renames says nothing on the stream: the window re-lists what it changed itself", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    expect((await call(w.host, w.vault, { kind: "page.remove", page: "home/Right/P3" })).ok).toBe(true);
    expect((await call(w.host, w.vault, { kind: "page.rename", page: "home/Right/P4", name: "Wanderer" })).ok).toBe(true);
    expect((await call(w.host, w.vault, { kind: "page.move", page: "home/Right/Wanderer", parent: "home/Left" })).ok).toBe(true);
    await Bun.sleep(1200);
    expect(w.changes).toEqual([]);
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A PAGE WHOSE UID AN OUTSIDE SAVE DROPPED keeps none through edits, and is given one on the next settle where a page arrives", async () => {
  const w = await stand();
  try {
    await Bun.sleep(300);
    const lost = join(dirOf(w.vault, "home/Left/P4"), "content.yaml");
    w.changes.length = 0;
    await writeFile(lost, doc("Left 4", "x").replace("uid: x\n", ""));
    expect(await until(() => w.changes.length > 0)).toBe(true);
    await Bun.sleep(300);
    expect(await Bun.file(lost).text()).not.toMatch(/^uid:/m);
    await w.put("home/Right/Newcomer", "Newcomer", "invsettlenewcomer");
    expect(await until(() => /^uid: \S+$/m.test(readFileSync(lost, "utf8")))).toBe(true);
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A FOLDER MOVED IN A FILE MANAGER names both parents and takes its runs with it, by identity", async () => {
  const w = await stand();
  try {
    // A run of a page with one automation, written the way an agent writes one.
    const auto = join(dirOf(w.vault, "home/Left/P3"), "automations", "blip");
    await mkdir(auto, { recursive: true });
    await writeFile(join(auto, "automation.yaml"), "name: Blip\ncommand: [sh, -c, \"echo invented\"]\n");
    const started = (await call(w.host, w.vault, { kind: "run.start", page: "home/Left/P3", automation: "blip", inputs: {}, by: null })) as { ok: true; value: { id: string } };
    expect(started.ok).toBe(true);
    const row = () => call(w.host, w.vault, { kind: "run.get", run: started.value.id }) as Promise<{ ok: true; value: { page: string; status: string } }>;
    for (let i = 0; i < 100 && (await row()).value.status === "running"; i++) await Bun.sleep(50);
    await Bun.sleep(400);
    w.changes.length = 0;

    await rename(dirOf(w.vault, "home/Left/P3"), dirOf(w.vault, "home/Right/Moved"));
    expect(await until(() => w.changes.some((c) => c.levels.includes("home/Left") && c.levels.includes("home/Right")) || w.changes.flatMap((c) => c.levels).includes("home/Left") && w.changes.flatMap((c) => c.levels).includes("home/Right"))).toBe(true);
    await Bun.sleep(300);
    for (let i = 0; i < 50 && (await row()).value.page !== "home/Right/Moved"; i++) await Bun.sleep(50);
    expect((await row()).value.page).toBe("home/Right/Moved");
  } finally {
    w.off();
    w.host.close();
  }
}, 30_000);

test.if(unix)("A BURST TOO BIG TO NAME says all, and names nothing", async () => {
  const many = LOCATE_MAX + 44;
  const w = await stand(many);
  try {
    await Bun.sleep(300);
    w.changes.length = 0;
    // Every one of them edited from outside at once, as a checkout does.
    for (let i = 0; i < many; i++) {
      await writeFile(join(dirOf(w.vault, `home/Left/Burst${i}`), "content.yaml"), doc(`Burst ${i}, checked out`, `invburst${String(i).padStart(6, "0")}`));
    }
    expect(await until(() => w.changes.some((c) => c.all === true), 15_000)).toBe(true);
    expect(w.changes.find((c) => c.all === true)).toEqual({ pages: [], levels: [], all: true });
  } finally {
    w.off();
    w.host.close();
  }
}, 60_000);
