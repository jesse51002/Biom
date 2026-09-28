// SPDX-License-Identifier: AGPL-3.0-only
// ONE COMMIT AT A TIME PER VAULT — `commit` in `server/platform/files.ts`.
//
// Several `Files` stand over one vault: its own, the one identities write
// through, the one a chat's agent writes through, the one runs commit with.
// Each commit is `git add -A` then `git commit`, and git holds
// `.git/index.lock` for the length of each; two at once over one repository
// fail with a warning and a lost commit. Background work — identities given
// after a sweep, the mirror's commit — runs beside the person's own writes
// now, so every commit over one root is queued, in the order it was asked.
// And a write landing while git walks the tree — every write here is a
// sibling renamed onto its path — never costs the commit.
// The vault is a temporary folder and every file and message is invented.

import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initVault, makeFiles, makeSeen } from "../server/platform/files.ts";

test.if(process.platform !== "win32")("COMMITS OVER ONE VAULT NEVER OVERLAP: three Files, forty commits asked at once, every one made, in the order asked, and git never finds its index locked", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-commit-queue-"));
  await initVault(root);
  const own = makeFiles(root, makeSeen());
  const identities = makeFiles(root);
  const agent = makeFiles(root);
  const said: string[] = [];
  const was = console.warn;
  console.warn = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  try {
    const asked: Promise<void>[] = [];
    /** The order the commits were asked in, which is when each write landed. */
    const messages: string[] = [];
    for (let i = 0; i < 40; i++) {
      const by = [own, identities, agent][i % 3]!;
      const message = `Invented commit ${String(i).padStart(2, "0")}`;
      // Each has something of its own to commit, written just before it asks.
      asked.push(by.write(`notes/${i}.md`, `invented ${i}\n`).then(() => {
        messages.push(message);
        return by.commit(message);
      }));
    }
    await Promise.all(asked);
    const log = spawnSync("git", ["log", "--format=%s"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter((l) => l.startsWith("Invented commit"));
    // No warning of any kind, and none about the lock above all.
    expect(said.filter((s) => /index\.lock|git/i.test(s))).toEqual([]);
    // Every file is in a commit.
    const tracked = spawnSync("git", ["ls-files", "notes"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    expect(tracked.length).toBe(40);
    // And the commits that carried them were made one after another, in the
    // order they were asked — newest first in the log.
    expect([...log].reverse()).toEqual(messages.filter((m) => log.includes(m)));
  } finally {
    console.warn = was;
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("a failed commit never throws and never holds the queue: the next one still runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-commit-fail-"));
  await initVault(root);
  const files = makeFiles(root);
  // Said once per process, by design; this test does not count it.
  const was = console.warn;
  console.warn = () => {};
  try {
    // A lock git did not take: the commit fails, quietly for its caller.
    await Bun.write(join(root, ".git", "index.lock"), "");
    await files.write("a.md", "invented\n");
    await files.commit("Invented, refused");
    await rm(join(root, ".git", "index.lock"));
    await files.write("b.md", "invented\n");
    await files.commit("Invented, made");
    const log = spawnSync("git", ["log", "--format=%s"], { cwd: root, encoding: "utf8" }).stdout;
    expect(log).toContain("Invented, made");
  } finally {
    console.warn = was;
    await rm(root, { recursive: true, force: true });
  }
});

test.if(process.platform !== "win32")("A WRITE LANDING WHILE GIT WALKS THE TREE costs no commit: forty commits beside a writer renaming files into place, and every one made", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-commit-walk-"));
  await initVault(root);
  const files = makeFiles(root);
  const said: string[] = [];
  const was = console.warn;
  console.warn = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  // The markdown mirror's shape: a file rewritten over and over in the
  // background, each write a sibling renamed onto the path.
  let writing = true;
  const writer = (async () => {
    for (let i = 0; writing; i++) await files.write(`_markdown/n${i % 50}.md`, `invented ${i}\n`.repeat(2000));
  })();
  try {
    const count = () => Number(spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim());
    let made = 0;
    for (let c = 0; c < 40; c++) {
      await files.write(`pages/p${c}.yaml`, `invented ${c}\n`);
      const before = count();
      await files.commit(`Invented commit ${c}`);
      if (count() > before) made++;
    }
    expect(said).toEqual([]);
    expect(made).toBe(40);
  } finally {
    writing = false;
    await writer;
    console.warn = was;
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
