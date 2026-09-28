// SPDX-License-Identifier: AGPL-3.0-only
// THE PLUGIN BUNDLE OVER TWO THOUSAND PAGES — `pluginBundle` in
// `server/main.ts`.
//
// Every box a window opens asks for the bundle, and the bundle holds every
// page's own `plugins/` — which meant a listing of every page's folder on every
// page switch. What is held: over a vault that has not changed, the second
// bundle does not walk the pages again, and it is still right, with no
// watcher running, after a page gains a plugin, a page arrives with one, a
// page's plugin is edited, and a page with one is deleted. Every page, plugin
// and word here is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pluginBundle } from "../server/main.ts";

let ground = "";
let vault = "";
/** Every page folder, so the test can age them. */
const dirs: string[] = [];

const put = async (rel: string, name: string) => {
  const dir = join(vault, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "content.yaml"), `name: ${name}\nplugin: biom-doc\ncontents: []\n`);
  dirs.push(dir);
};
const plugin = async (pageRel: string, id: string, said: string) => {
  const dir = join(vault, pageRel, "plugins", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.js`), `window.__invented = ${JSON.stringify(said)};\n`);
};
/** Every folder in the vault last changed an hour ago: a vault nobody is
 *  touching, the way a workspace sits between two page switches. */
const age = async () => {
  const then = new Date(Date.now() - 3_600_000);
  for (const dir of dirs) {
    await utimes(dir, then, then).catch(() => {});
    await utimes(join(dir, "children"), then, then).catch(() => {});
    await utimes(join(dir, "plugins"), then, then).catch(() => {});
  }
  await utimes(join(vault, "pages"), then, then).catch(() => {});
};
const bundle = async (): Promise<string> => await (await pluginBundle(vault)).text();

beforeAll(async () => {
  ground = await mkdtemp(join(tmpdir(), "biom-bundle-scale-"));
  vault = join(ground, "vault");
  await put("pages/home", "Home");
  for (let t = 0; t < 20; t++) {
    await put(`pages/home/children/T${t}`, `Top ${t}`);
    for (let i = 0; i < 100; i++) await put(`pages/home/children/T${t}/children/P${i}`, `Page ${t}.${i}`);
  }
  await plugin("pages/home/children/T3/children/P7", "invented-one", "first words");
  await age();
}, 60_000);
afterAll(async () => {
  await rm(ground, { recursive: true, force: true });
});

test("OVER A VAULT THAT HAS NOT CHANGED, the second bundle does not walk two thousand pages again", async () => {
  const t0 = performance.now();
  const first = await bundle();
  const walked = performance.now() - t0;
  const times: number[] = [];
  let again = "";
  for (let i = 0; i < 3; i++) {
    const t1 = performance.now();
    again = await bundle();
    times.push(performance.now() - t1);
  }
  expect(again).toBe(first);
  expect(first).toContain("first words");
  // A walk of every page folder is two listings a page; what is left is a
  // look at each folder's time. A quarter is a wide margin on either machine.
  expect(Math.min(...times)).toBeLessThan(walked / 4);
}, 60_000);

test("with no watcher running, a remembered walk still sees a plugin a page gained, one a new page brought, a plugin added beside another, an edit, and a deleted page's going", async () => {
  /** A quiet vault, and a bundle that remembered its walk of it. */
  const settled = async () => {
    await age();
    await bundle();
  };
  await settled();
  await plugin("pages/home/children/T5/children/P1", "invented-two", "second words");
  expect(await bundle()).toContain("second words");

  await settled();
  await put("pages/home/children/T9/children/Arrived", "Arrived");
  await plugin("pages/home/children/T9/children/Arrived", "invented-three", "third words");
  expect(await bundle()).toContain("third words");

  await settled();
  await plugin("pages/home/children/T3/children/P7", "invented-four", "fourth words");
  expect(await bundle()).toContain("fourth words");

  await settled();
  await plugin("pages/home/children/T3/children/P7", "invented-one", "first words, edited");
  expect(await bundle()).toContain("first words, edited");

  await settled();
  await rm(join(vault, "pages/home/children/T5/children/P1"), { recursive: true, force: true });
  expect(await bundle()).not.toContain("second words");
}, 60_000);
