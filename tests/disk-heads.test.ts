// SPDX-License-Identifier: AGPL-3.0-only
// A FILE WITHOUT READING IT, AND THE HEAD OF ONE — `DiskFiles.stat` and
// `DiskFiles.head` in `server/platform/files.ts`, for the twelfth contracts
// edit's page index.
//
// The index keeps each page's head — its `name:` and `uid:` — and trusts a kept
// head only while a stat agrees: the inode, the size and the modification time.
// So this holds what those two calls promise: an edit moves the size or the
// time, an atomic write moves the inode, a missing path is null and never an
// error, the head is the first bytes and no more, neither call escapes the
// vault, and neither touches the watcher's baseline — a head is not a sighting
// of the file. The folder is temporary and its one page is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFiles, makeSeen } from "../server/platform/files.ts";

let root = "";
const DOC = "name: Field notes\nuid: f1eldnotes01\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body: |\n        Words, and more words.\n";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "biom-heads-"));
  await mkdir(join(root, "pages/home"), { recursive: true });
  await writeFile(join(root, "pages/home/content.yaml"), DOC);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

test("stat says what a path is — a file, a folder, or null — and never throws for a missing one", async () => {
  const files = makeFiles(root);
  const doc = await files.stat("pages/home/content.yaml");
  expect(doc).not.toBeNull();
  expect(doc!.dir).toBe(false);
  expect(doc!.size).toBe(Buffer.byteLength(DOC));
  expect(typeof doc!.ino).toBe("number");
  expect(doc!.mtimeMs).toBeGreaterThan(0);
  expect(doc!.bornMs).toBeGreaterThan(0);
  expect((await files.stat("pages/home"))!.dir).toBe(true);
  expect(await files.stat("pages/home/children")).toBeNull();
  expect(await files.stat("pages/nowhere/content.yaml")).toBeNull();
});

test("AN EDIT MOVES THE SIZE OR THE TIME, AND AN ATOMIC WRITE MOVES THE INODE — what a kept head is checked against", async () => {
  const files = makeFiles(root);
  const before = (await files.stat("pages/home/content.yaml"))!;
  // Through the app's own write, which is a sibling renamed over the file.
  await files.write("pages/home/content.yaml", DOC.replace("Field notes", "Field Notes"));
  const after = (await files.stat("pages/home/content.yaml"))!;
  expect(after.ino).not.toBe(before.ino);
  expect(after.size).toBe(before.size);
  // In place, from outside: the same inode, a different size.
  await writeFile(join(root, "pages/home/content.yaml"), DOC + "# more\n");
  const edited = (await files.stat("pages/home/content.yaml"))!;
  expect(edited.ino).toBe(after.ino);
  expect(edited.size).not.toBe(after.size);
  await writeFile(join(root, "pages/home/content.yaml"), DOC);
});

test("head is the first bytes and no more, and null where nothing is there", async () => {
  const files = makeFiles(root);
  expect(await files.head("pages/home/content.yaml", 16)).toBe(DOC.slice(0, 16));
  expect(await files.head("pages/home/content.yaml", 4096)).toBe(DOC);
  expect(await files.head("pages/home/content.yaml", 0)).toBe("");
  expect(await files.head("pages/nowhere/content.yaml", 4096)).toBeNull();
});

test("NEITHER TOUCHES THE WATCHER'S BASELINE: knowing a file is there, or its first line, is not a sighting of it", async () => {
  const seen = makeSeen();
  const files = makeFiles(root, seen);
  const abs = join(root, "pages/home/content.yaml");
  await files.stat("pages/home/content.yaml");
  await files.head("pages/home/content.yaml", 4096);
  expect(seen.known(abs)).toBe(false);
  // A whole read is a sighting, as it always was.
  await files.read("pages/home/content.yaml");
  expect(seen.known(abs)).toBe(true);
});

test("neither leaves the vault", async () => {
  const files = makeFiles(root);
  await expect(files.stat("../outside")).rejects.toThrow();
  await expect(files.head("../outside", 10)).rejects.toThrow();
  await expect(files.head("/etc/passwd", 10)).rejects.toThrow();
});
