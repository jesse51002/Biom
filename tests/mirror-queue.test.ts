// SPDX-License-Identifier: AGPL-3.0-only
// THE MARKDOWN MIRROR, KEPT IN THE BACKGROUND — `server/domain/mirror.ts`,
// through the API route that asks it and the mount that brings it up to date.
//
// What is held: a write answers before its projection lands, and the queue's
// `idle()` settles after it; a page asked for twice in a row is projected once;
// a projection reads its page once, and a file whose bytes would not change is
// not written; the mount's pass projects only a page newer than its `.md` and
// prunes a page that has gone, so a mount after which nothing changed writes
// nothing and commits nothing; a page made after the mount's walk keeps its
// file, and the prune takes its turn on the queue. The vaults are temporary
// folders, and every page and word in them is invented.

import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handle } from "../server/api/routes.ts";
import type { Deps } from "../server/api/routes.ts";
import { initVault, makeFiles } from "../server/platform/files.ts";
import type { DiskFiles } from "../server/platform/files.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { makePages, pageDirs } from "../server/domain/pages.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { makeMirror, mirrorPath, refresh } from "../server/domain/mirror.ts";
import { makeHost } from "../server/main.ts";
import { PROTOCOL } from "../contracts/wire.js";
import type { ApiRequest, Docs, PageId, Pages } from "../contracts/types.ts";

const yaml = { parse, parseAny, format, formatAny };
const FRAMEWORK = join(import.meta.dir, "..");

/** A vault of a root and `n` invented doc pages under it. */
async function vault(n = 3): Promise<{ root: string; files: DiskFiles; drop: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "biom-mirror-queue-"));
  await mkdir(join(root, "pages/home/children"), { recursive: true });
  await writeFile(join(root, "pages/home/content.yaml"), "name: Home\nuid: inventedhome0001\nplugin: biom-doc\ncontents: []\n");
  for (let i = 0; i < n; i++) {
    const dir = join(root, `pages/home/children/Note${i}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "content.yaml"), `name: Note ${i}\nuid: inventednote000${i}\nplugin: biom-doc\nvariables:\n  status: draft\ncontents:\n  - name: body\n    parts:\n      body: |\n        Invented words of note ${i}.\n`);
  }
  return { root, files: makeFiles(root), drop: () => rm(root, { recursive: true, force: true }) };
}

/** Pages and docs that count their reads, and pages whose reads can be held. */
function counted(files: DiskFiles) {
  const base = makePages(files, yaml);
  const docsBase = makeDocs(files, yaml);
  let pageReads = 0;
  let docReads = 0;
  let gate: Promise<void> | null = null;
  const pages = new Proxy(base, {
    get(target, key) {
      if (key === "read") {
        return async (id: PageId) => {
          pageReads++;
          if (gate !== null) await gate;
          return target.read(id);
        };
      }
      return (target as unknown as Record<string | symbol, unknown>)[key];
    },
  }) as Pages;
  const docs: Docs = { ...docsBase, read: async (id: PageId) => { docReads++; return docsBase.read(id); } };
  return {
    pages, docs, base,
    reads: () => ({ pages: pageReads, docs: docReads }),
    hold() {
      let release!: () => void;
      gate = new Promise((r) => { release = r; });
      return () => { gate = null; release(); };
    },
  };
}

test("A WRITE ANSWERS BEFORE ITS PROJECTION, and the queue's idle() settles once the projection is on disk", async () => {
  const v = await vault();
  try {
    const c = counted(v.files);
    const mirror = makeMirror(v.files, c.pages, c.docs);
    const deps = { pages: c.base, docs: makeDocs(v.files, yaml), mirror } as unknown as Deps;
    const release = c.hold();
    const r = await handle({ id: "w1", g: PROTOCOL, kind: "section.write", page: "home/Note1", section: "body", part: "body", data: "Invented words, written now." } as ApiRequest, deps);
    // Answered, and the projection is still waiting on its read.
    expect(r.ok).toBe(true);
    expect(mirror.queue.pending()).toBeGreaterThan(0);
    expect(await v.files.read(mirrorPath("home/Note1"))).toBeNull();
    release();
    await mirror.queue.idle();
    expect(mirror.queue.pending()).toBe(0);
    expect(String(await v.files.read(mirrorPath("home/Note1")))).toContain("Invented words, written now.");
  } finally {
    await v.drop();
  }
});

test("a page asked for twice in a row is projected once, reading its page once and its frontmatter from that same read", async () => {
  const v = await vault();
  try {
    const c = counted(v.files);
    const mirror = makeMirror(v.files, c.pages, c.docs);
    const release = c.hold();
    // The first starts at once and waits on its read; the two after it are one.
    mirror.queue.follow("home/Note0");
    mirror.queue.follow("home/Note2");
    mirror.queue.follow("home/Note2");
    release();
    await mirror.queue.idle();
    expect(c.reads()).toEqual({ pages: 2, docs: 0 });
    expect(await v.files.read(mirrorPath("home/Note2"))).not.toBeNull();
  } finally {
    await v.drop();
  }
});

test("a projection whose bytes are what is on disk is not written again", async () => {
  const v = await vault();
  try {
    const c = counted(v.files);
    const mirror = makeMirror(v.files, c.pages, c.docs);
    mirror.queue.follow("home/Note0");
    await mirror.queue.idle();
    const first = await stat(join(v.root, mirrorPath("home/Note0")));
    await Bun.sleep(20);
    mirror.queue.follow("home/Note0");
    await mirror.queue.idle();
    const second = await stat(join(v.root, mirrorPath("home/Note0")));
    expect(second.mtimeMs).toBe(first.mtimeMs);
    expect(second.ino).toBe(first.ino);
  } finally {
    await v.drop();
  }
});

test("THE MOUNT'S PASS projects only a page newer than its .md, prunes a page that has gone, and writes nothing when nothing changed", async () => {
  const v = await vault(4);
  try {
    const c = counted(v.files);
    const mirror = makeMirror(v.files, c.pages, c.docs);
    const first = await refresh(mirror, v.files, await pageDirs(v.files));
    await mirror.queue.idle();
    expect(first.queued).toBe(5);
    expect(first.wrote).toBe(true);

    // Nothing changed: nothing asked, nothing written.
    const before = c.reads();
    const again = await refresh(mirror, v.files, await pageDirs(v.files));
    await mirror.queue.idle();
    expect(again).toEqual({ queued: 0, wrote: false });
    expect(c.reads()).toEqual(before);

    // One document edited after its projection: that page, and only it.
    const doc = join(v.root, "pages/home/children/Note3/content.yaml");
    await writeFile(doc, (await readFile(doc, "utf8")).replace("Invented words of note 3.", "Invented words, edited outside."));
    const later = new Date(Date.now() + 5000);
    await utimes(doc, later, later);
    const edited = await refresh(mirror, v.files, await pageDirs(v.files));
    await mirror.queue.idle();
    expect(edited.queued).toBe(1);
    expect(String(await v.files.read(mirrorPath("home/Note3")))).toContain("edited outside");

    // One page gone while nothing was watching: its file goes.
    await rm(join(v.root, "pages/home/children/Note2"), { recursive: true, force: true });
    const pruned = await refresh(mirror, v.files, await pageDirs(v.files));
    expect(pruned.wrote).toBe(true);
    expect(await v.files.read(mirrorPath("home/Note2"))).toBeNull();
    expect(await v.files.read(mirrorPath("home/Note1"))).not.toBeNull();
  } finally {
    await v.drop();
  }
});

test.if(process.platform !== "win32")("A MOUNT AFTER WHICH NOTHING CHANGED writes nothing and commits nothing", async () => {
  const v = await vault(3);
  const data = await mkdtemp(join(tmpdir(), "biom-mirror-mount-data-"));
  try {
    await initVault(v.root);
    const open = async () => {
      const host = await makeHost({ vault: v.root, memory: join(data, "vaults.json"), presets: join(FRAMEWORK, "presets"), agentsHome: join(data, "agents") });
      await host.settled(v.root);
      host.close();
    };
    await open();
    const log = () => spawnSync("git", ["log", "--format=%s"], { cwd: v.root, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const commits = log().length;
    const md = await stat(join(v.root, mirrorPath("home/Note1")));
    await Bun.sleep(20);
    await open();
    expect(log().length).toBe(commits);
    expect((await stat(join(v.root, mirrorPath("home/Note1")))).mtimeMs).toBe(md.mtimeMs);
    expect(spawnSync("git", ["status", "--porcelain", "_markdown"], { cwd: v.root, encoding: "utf8" }).stdout).toBe("");
  } finally {
    await v.drop();
    await rm(data, { recursive: true, force: true });
  }
}, 30_000);

test("A BOX'S PROJECTION LANDS AFTER A PROJECTION ALREADY UNDER WAY FOR ITS PAGE, never beneath it", async () => {
  const v = await vault(0);
  try {
    // A page only its own box can project: the host's projection of it is an
    // empty file where there is none yet, and the box's words replace it.
    await mkdir(join(v.root, "pages/home/children/Board"), { recursive: true });
    await writeFile(join(v.root, "pages/home/children/Board/content.yaml"), "name: Board\nuid: inventedboard001\nplugin: html\n");
    const board = mirrorPath("home/Board");
    // The host's projection reads whether the file is there, and its answer —
    // nothing yet — is held until the box's words have had every chance to
    // land.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let reached!: () => void;
    const atGate = new Promise<void>((r) => { reached = r; });
    let holding = true;
    const files = new Proxy(v.files, {
      get(target, key, receiver) {
        if (key === "read") {
          return async (rel: string) => {
            const text = await target.read(rel);
            if (rel === board && holding) {
              holding = false;
              reached();
              await gate;
            }
            return text;
          };
        }
        return Reflect.get(target, key, receiver);
      },
    }) as DiskFiles;
    const mirror = makeMirror(files, makePages(files, yaml), makeDocs(files, yaml));
    const deps = { mirror } as unknown as Deps;
    mirror.queue.follow("home/Board");
    await atGate;
    const answered = handle({ id: "b1", g: PROTOCOL, kind: "page.projection", page: "home/Board", markdown: "- a card only the box knows" } as ApiRequest, deps);
    // Every chance: until the box's answer comes back, or a moment passes.
    await Promise.race([answered, Bun.sleep(200)]);
    release();
    expect((await answered).ok).toBe(true);
    await mirror.queue.idle();
    expect(String(await v.files.read(board))).toContain("- a card only the box knows");
  } finally {
    await v.drop();
  }
});

test("A PAGE MADE AFTER THE MOUNT'S WALK keeps the file the watcher wrote for it, and a page that has gone still loses its own", async () => {
  // THE WALK IS TAKEN BEFORE THE PRUNE RUNS. The mount lists every page
  // folder, stats every page against its `.md`, and only then takes away the
  // files the list did not name — and all the while the watcher goes on
  // projecting. A page an agent made after the walk had a file the watcher
  // had already written, and the prune took it on the list's word: the page
  // beside one the list held lost its `.md`, and the first child of a page
  // the list never saw lost the folder its `.md` was in. The list handed in
  // here is taken before those pages are made, which is the order the mount
  // meets them in.
  const v = await vault(1);
  try {
    const c = counted(v.files);
    const mirror = makeMirror(v.files, c.pages, c.docs);
    const walked = await pageDirs(v.files);
    for (const [id, name] of [["home/Late", "Late"], ["home/Late/Deeper", "Deeper"]] as const) {
      const dir = join(v.root, "pages", id.split("/").join("/children/"));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "content.yaml"), `name: ${name}\nplugin: biom-doc\ncontents: []\n`);
      mirror.queue.follow(id, true);
    }
    await mirror.queue.idle();
    // And files about a page that is gone from disk, which the prune does take.
    await v.files.write(mirrorPath("home/Gone"), "# Gone\n");
    await v.files.write(mirrorPath("home/Gone/Under"), "# Under\n");

    const done = await refresh(mirror, v.files, walked);
    expect(done.wrote).toBe(true);
    expect(await v.files.read(mirrorPath("home/Late"))).toContain("Late");
    expect(await v.files.read(mirrorPath("home/Late/Deeper"))).toContain("Deeper");
    expect(await v.files.read(mirrorPath("home/Note0"))).not.toBeNull();
    expect(await v.files.read(mirrorPath("home/Gone"))).toBeNull();
    expect(await v.files.read(mirrorPath("home/Gone/Under"))).toBeNull();
  } finally {
    await v.drop();
  }
});

test("A PRUNE TAKES ITS TURN on the queue: after the projection asked before it, never beside it", async () => {
  // So nothing the queue writes lands between the prune's look at the disk
  // and its delete. Held here with the projection stopped at its page read.
  const v = await vault(1);
  try {
    const order: string[] = [];
    const files = new Proxy(v.files, {
      get(target, key, receiver) {
        if (key === "write") return async (rel: string, text: string) => { order.push(`write ${rel}`); await target.write(rel, text); };
        if (key === "list") return async (rel: string) => { if (rel === "_markdown") order.push("prune"); return await target.list(rel); };
        return Reflect.get(target, key, receiver);
      },
    }) as DiskFiles;
    const c = counted(files);
    const mirror = makeMirror(files, c.pages, c.docs);
    const release = c.hold();
    mirror.queue.follow("home/Note0");
    const pruned = mirror.queue.prune(["home", "home/Note0"]);
    release();
    await pruned;
    expect(order).toEqual([`write ${mirrorPath("home/Note0")}`, "prune"]);
  } finally {
    await v.drop();
  }
});
