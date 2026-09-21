// SPDX-License-Identifier: AGPL-3.0-only
// A PAGE'S IDENTITY, which survives a move. The id is where a page sits and
// changes when the page does; the uid is minted once and stays. It is what a
// run's row names, so a page moved under another parent still owns the runs it
// started. These hold the mint, the backfill on mount, the round trip through
// the real codec, and the grammar the codec refuses.

import { test, expect } from "bun:test";
import { makePages } from "../server/domain/pages.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { UID } from "../contracts/types.ts";
import type { FileEntry, Files } from "../contracts/types.ts";

function memFiles(): Files & { at(rel: string): string | undefined; commits: string[] } {
  const store = new Map<string, string>();
  const commits: string[] = [];
  return {
    async read(rel) { return store.get(rel) ?? null; },
    async write(rel, text) { store.set(rel, text); },
    async remove(rel) {
      store.delete(rel);
      for (const k of [...store.keys()]) if (k.startsWith(rel + "/")) store.delete(k);
    },
    async list(rel) {
      const prefix = rel === "" || rel === "." ? "" : rel + "/";
      const seen = new Map<string, boolean>();
      for (const k of store.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) seen.set(rest, false);
        else seen.set(rest.slice(0, cut), true);
      }
      if (seen.size === 0 && prefix !== "") throw new Error("ENOENT");
      const out: FileEntry[] = [];
      for (const [name, dir] of seen) out.push({ name, dir });
      return out;
    },
    async commit(message) { commits.push(message); },
    at: (rel) => store.get(rel),
    commits,
  };
}

const yaml = { parse, parseAny, format };

test("a new page is born with a uid, under its name, and the codec round-trips it", async () => {
  const files = memFiles();
  const pages = makePages(files, yaml);
  const made = await pages.create({ name: "Socials" });
  expect(made.uid).toMatch(UID);
  const text = files.at("pages/home/children/Socials/content.yaml") ?? "";
  // Right under the name: the first two keys of the file.
  expect(text.split("\n").slice(0, 2)).toEqual([`name: Socials`, `uid: ${made.uid}`]);
  expect(parse(text).uid).toBe(made.uid);
  // Listed with it, and read with it.
  const listed = (await pages.list()).find((p) => p.id === made.id);
  expect(listed?.uid).toBe(made.uid);
  expect((await pages.read(made.id))?.uid).toBe(made.uid);
});

test("identify writes a uid into every page that has none and never touches one that has", async () => {
  const files = memFiles();
  // Two pages written by hand, one of them already identified, and a root.
  await files.write("pages/home/content.yaml", "name: Home\nplugin: biom-doc\ncontents: []\n");
  await files.write("pages/home/children/a/content.yaml", "name: A\nplugin: biom-doc\ncontents: []\n");
  await files.write("pages/home/children/b/content.yaml", "name: B\nuid: keepmekeepme\nplugin: biom-doc\ncontents: []\n");
  // And one that will not parse, which is left alone.
  await files.write("pages/home/children/c/content.yaml", "name: [\n");
  const pages = makePages(files, yaml);
  expect(await pages.identify()).toBe(2);
  // One commit ahead of the sweep, never one per page.
  expect(files.commits).toEqual(["Before every page was given an identity"]);
  const a = parse(files.at("pages/home/children/a/content.yaml") ?? "");
  const b = parse(files.at("pages/home/children/b/content.yaml") ?? "");
  expect(a.uid).toMatch(UID);
  expect(b.uid).toBe("keepmekeepme");
  expect(files.at("pages/home/children/c/content.yaml")).toBe("name: [\n");
  // Idempotent: a second sweep writes nothing and commits nothing.
  expect(await pages.identify()).toBe(0);
  expect(files.commits.length).toBe(1);
});

test("the codec refuses a uid that is not one, and keeps one through a rewrite", () => {
  expect(() => parse("name: X\nuid: 12\nplugin: biom-doc\ncontents: []\n")).toThrow(/uid/);
  expect(() => parse("name: X\nuid: [a]\nplugin: biom-doc\ncontents: []\n")).toThrow();
  const doc = parse("name: X\nuid: abcdefgh12345678\nplugin: biom-doc\ncontents: []\n");
  expect(format(doc)).toContain("uid: abcdefgh12345678\n");
  // A document with none is written with none: nothing invents one on the way out.
  expect(format(parse("name: X\nplugin: biom-doc\ncontents: []\n"))).not.toContain("uid:");
});

test("a page moved to another parent keeps its uid", async () => {
  const files = memFiles();
  const pages = makePages(files, yaml);
  const a = await pages.create({ name: "A" });
  const b = await pages.create({ name: "B" });
  const moved = await pages.move(a.id, b.id);
  expect(moved).not.toBe(a.id);
  expect((await pages.read(moved))?.uid).toBe(a.uid);
});
