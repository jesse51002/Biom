// SPDX-License-Identifier: AGPL-3.0-only
// A file changing on disk is a reason to press Reload, and the server presses
// it. This is the half that can be tested without a browser: the watch itself,
// what it decides a notification means, and who hears about it.
//
// REAL TEMP DIRECTORIES AND A REAL `fs.watch`, because the one thing this code
// does is notice a filesystem move, and a fake filesystem would be testing the
// fake. That makes these the slowest tests in the suite by a wide margin — every
// assertion waits for a real notification to travel and for the burst to settle —
// so the waiting is done by polling a condition rather than by sleeping a fixed
// time, and the budgets are generous.
//
// THE FOUR PROPERTIES WORTH READING:
//
//   · A watch starts on the FIRST subscriber and is released on the LAST.
//     Mounting does not unmount, so the subscriber count is the only lifetime
//     this code can offer — and it is the only one a test can observe.
//
//   · THE APP'S OWN WRITE IS DROPPED BY CONTENT HASH. A write through the app
//     lands in `pages/` and looks exactly like an agent's; the baseline in
//     `files.ts` is what tells them apart. Without this, a person typing gets
//     their own page redrawn under their caret every time they stop.
//
//   · A HALF-WRITTEN FILE CHANGES NOTHING — not the drawn page and not the
//     baseline — so the completed write reads as changed rather than as more of
//     the same.
//
//   · AN EVENT CANNOT CROSS BETWEEN VAULTS. Two mounts, a write in one, and only
//     that one's subscribers hear it.

import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { events, makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { EXCLUDED, WATCHED_DIRS, WATCHED_FILES, watched } from "../server/platform/watch.ts";
import { makeSeen } from "../server/platform/files.ts";
import { pageAt } from "../server/domain/mirror.ts";
import { handle } from "../server/api/routes.ts";
import { PROTOCOL } from "../contracts/wire.js";
import type { ApiRequest, ApiResponse } from "../contracts/types.ts";

const FRAMEWORK = join(import.meta.dir, "..");

let seq = 0;
const req = (o: Record<string, unknown>): ApiRequest => ({ id: `w${++seq}`, g: PROTOCOL, ...o }) as ApiRequest;

const value = (res: ApiResponse): unknown => {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.value;
};

/** A temp root, and the memory file beside it — never the developer's own. */
async function ground() {
  const root = await mkdtemp(join(tmpdir(), "biom-watch-"));
  return {
    root,
    memory: join(root, "vaults.json"),
    at: (name: string) => join(root, name),
    async drop() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

const stand = (vault: string, memory: string): Promise<Host> =>
  makeHost({ vault, memory, presets: join(FRAMEWORK, "presets") });

const call = async (host: Host, at: string, o: Record<string, unknown>): Promise<ApiResponse> =>
  await handle(req(o), await host.deps(at));

/** A counter that can be waited on. Every subscription in this file is one. */
function ear() {
  let count = 0;
  return { hear: () => void count++, get: () => count };
}

/** Wait until `ok()` or give up. Polling rather than a fixed sleep: a real
 *  notification arrives when the kernel says so, and a test that sleeps long
 *  enough for the slowest machine is a test everybody waits for. */
async function until(ok: () => boolean | Promise<boolean>, budget = 4000): Promise<boolean> {
  const stop = Date.now() + budget;
  while (Date.now() < stop) {
    if (await ok()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return await ok();
}

/** The other half of the same question: nothing happened, and it kept on not
 *  happening for long enough that a notification would have arrived. */
async function quiet(ms = 900): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** A page directory, written the way an agent writes one: straight to disk,
 *  behind the server's back. */
const pageDir = (vault: string, id: string) =>
  join(vault, "pages", ...id.split("/").join("/children/").split("/"));

/* ── what a path means, without a filesystem ───────────────────────────── */

test("the watched inputs and the exclusions are one list each, and a path under neither is ignored", () => {
  // Authored input. These are what a person or an agent writes.
  expect(watched("pages/home/content.yaml")).toBe(true);
  expect(watched("pages/home/children/notes/section.html")).toBe(true);
  expect(watched("design/content.yaml")).toBe(true);
  expect(watched("base/list/section.html")).toBe(true);
  expect(watched("plugins/doc/index.html")).toBe(true);
  expect(watched("assets/kitchen.jpg")).toBe(true);
  expect(watched("theme.json")).toBe(true);
  expect(watched("markdown.yaml")).toBe(true);

  // The app's own output and machinery. `_markdown/` is the one that would make
  // the refresh feed itself, and `.git/` is touched by every write because the
  // server commits ahead of itself.
  expect(watched("_markdown/home.md")).toBe(false);
  expect(watched(".git/index")).toBe(false);
  expect(watched("workspace.db")).toBe(false);
  expect(watched("workspace.db-wal")).toBe(false);
  expect(watched("workspace.db-shm")).toBe(false);

  // Under neither list: ignored rather than guessed at.
  expect(watched("AGENTS.md")).toBe(false);
  expect(watched("notes.txt")).toBe(false);
  expect(watched("tables.json")).toBe(false);
  expect(watched(".DS_Store")).toBe(false);
  expect(watched(".agents/skills/pages/SKILL.md")).toBe(false);

  // And the two lists do not overlap, which is what makes "one list each" a
  // statement rather than a hope.
  for (const dir of WATCHED_DIRS) expect(EXCLUDED.has(dir)).toBe(false);
  for (const file of WATCHED_FILES) expect(EXCLUDED.has(file)).toBe(false);
});

test("a changed path names the page it belongs to, and nothing that is not a page", () => {
  expect(pageAt("pages/home/content.yaml")).toEqual({ id: "home", rest: "content.yaml" });
  expect(pageAt("pages/home/children/notes/content.yaml"))
    .toEqual({ id: "home/notes", rest: "content.yaml" });
  expect(pageAt("pages/home/children/notes/children/deep/bits/one.html"))
    .toEqual({ id: "home/notes/deep", rest: "bits/one.html" });
  // The page's own directory. `rest` empty is what the caller reads as
  // structural — a page arriving or leaving changes the page above it too.
  expect(pageAt("pages/home/children/notes")).toEqual({ id: "home/notes", rest: "" });

  // The vault root is ALSO somebody's Obsidian folder. A name that is not a
  // legal segment is not a page and must never be turned into an id.
  expect(pageAt("pages/.trash/note.md")).toBe(null);
  expect(pageAt("pages/a note/content.yaml")).toBe(null);
  expect(pageAt("design/content.yaml")).toBe(null);
  expect(pageAt("theme.json")).toBe(null);
  expect(pageAt("pages")).toBe(null);
});

test("the content baseline answers about content and forgets a whole subtree", () => {
  const seen = makeSeen();
  const a = join("/w", "pages", "home", "content.yaml");
  expect(seen.known(a)).toBe(false);
  expect(seen.matches(a, "x")).toBe(false);

  seen.note(a, "name: Home\n");
  expect(seen.known(a)).toBe(true);
  expect(seen.matches(a, "name: Home\n")).toBe(true);
  expect(seen.matches(a, "name: Away\n")).toBe(false);

  // A page removed takes its files' baselines with it, so a page written again
  // under that name reads as changed rather than as what used to be there.
  seen.forget(join("/w", "pages", "home"));
  expect(seen.known(a)).toBe(false);
});

/* ── the watch itself ──────────────────────────────────────────────────── */

test("a watch starts on the first subscriber and is released on the last", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    // Mounted, and watching nothing. Mounting does not unmount, so a watcher
    // hung on the mount would be a watcher nothing could ever release.
    expect(host.open()).toEqual([g.at("one")]);
    expect(host.watching()).toEqual([]);

    const first = ear();
    const off = await host.watch(g.at("one"), first.hear);
    const live = host.watching();
    expect(live.length).toBe(1);
    expect(live[0]?.path).toBe(g.at("one"));
    // Directories, never files: a watch on a file is a watch on an inode, and an
    // editor that saves by replacing leaves it watching nothing.
    expect(live[0]?.handles.length).toBeGreaterThan(0);

    // A second subscriber shares the one watcher rather than starting another.
    const second = ear();
    const alsoOff = await host.watch(g.at("one"), second.hear);
    expect(host.watching().length).toBe(1);

    // And the first one going does not take it away.
    off();
    expect(host.watching().length).toBe(1);

    alsoOff();
    expect(host.watching()).toEqual([]);
    // Twice is harmless.
    alsoOff();

    // Subscribing again starts it again.
    const third = ear();
    const lastOff = await host.watch(g.at("one"), third.hear);
    expect(host.watching().length).toBe(1);
    lastOff();
    expect(host.watching()).toEqual([]);
  } finally {
    host.close();
    await g.drop();
  }
});

test("a page written from outside is heard, and its markdown follows", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);

    // AN AGENT'S WRITE: a new page directory with its own `content.yaml`,
    // straight to disk, with the server told nothing.
    const dir = pageDir(g.at("one"), "home/notes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "content.yaml"), "name: Notes\nplugin: doc\ncontents: []\n", "utf8");

    expect(await until(() => heard.get() > 0)).toBe(true);

    // THE MIRROR RIDES THE WATCHER. This is the one case `_markdown/` used to go
    // stale in: a file edited outside the app.
    expect(await until(() => Bun.file(join(g.at("one"), "_markdown", "home", "notes.md")).size > 0))
      .toBe(true);

    // And the page is really there to be read.
    const read = value(await call(host, g.at("one"), { kind: "page.read", page: "home/notes" }));
    expect((read as { name: string }).name).toBe("Notes");

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("a burst settles into one event, and a directory created after the watch started is watched", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);

    // A NESTED DIRECTORY CREATED AFTER THE WATCH STARTED, then filled. On Linux
    // that is a watch this code has to add for itself; everywhere else the
    // kernel does it. Either way the writes inside have to report.
    const dir = pageDir(g.at("one"), "home/deep");
    await mkdir(join(dir, "children", "deeper"), { recursive: true });
    await writeFile(join(dir, "content.yaml"), "name: Deep\nplugin: doc\ncontents: []\n", "utf8");
    await writeFile(
      join(dir, "children", "deeper", "content.yaml"),
      "name: Deeper\nplugin: doc\ncontents: []\n",
      "utf8",
    );
    await writeFile(join(dir, "bits.html"), "<p>\n", "utf8");

    expect(await until(() => heard.get() > 0)).toBe(true);
    // COALESCED. Five filesystem moves in one burst are one reason to reread,
    // not five — and the settle timer is what makes repeated notifications
    // settle rather than queue redraws.
    await quiet();
    expect(heard.get()).toBeLessThanOrEqual(2);

    const names = value(await call(host, g.at("one"), { kind: "page.list" })) as { id: string }[];
    expect(names.map((p) => p.id)).toContain("home/deep/deeper");

    // A SECOND WRITE INSIDE THE NEW DIRECTORY still reports, which is the whole
    // point of picking it up.
    const before = heard.get();
    await writeFile(
      join(dir, "children", "deeper", "content.yaml"),
      "name: Deeper still\nplugin: doc\ncontents: []\n",
      "utf8",
    );
    expect(await until(() => heard.get() > before)).toBe(true);

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("two sibling pages created in one burst each get their markdown", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);

    // The directories first, and let that settle, so the two documents land in
    // ONE burst — which is the shape this is about.
    const dirs = ["alpha", "beta"].map((name) => pageDir(g.at("one"), `home/${name}`));
    for (const dir of dirs) await mkdir(dir, { recursive: true });
    await quiet(400);

    // TWO SIBLINGS WRITTEN TOGETHER. Projecting the first projects the PARENT
    // too, because a parent lists its children — and reading a parent reads
    // every child's `content.yaml`, which notes the baseline. A verdict taken
    // after that projection reads the second page as nothing that happened, and
    // its markdown is never written. Every verdict in a burst is therefore
    // taken before any projection runs.
    await Promise.all(dirs.map((dir, i) =>
      writeFile(join(dir, "content.yaml"), `name: ${["Alpha", "Beta"][i]}\nplugin: doc\ncontents: []\n`, "utf8")));

    expect(await until(() => heard.get() > 0)).toBe(true);
    for (const name of ["alpha", "beta"]) {
      expect(await until(() => Bun.file(join(g.at("one"), "_markdown", "home", `${name}.md`)).size > 0))
        .toBe(true);
    }

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("a watched directory that did not exist when the watch started is watched when it appears", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);

    // A FRESH VAULT HAS NO `assets/` AND NO `plugins/`. Both are watched inputs,
    // so the first walk tries each of them and gets ENOENT — which is not
    // trouble and must not be reported as any, and which on macOS and Windows
    // used to be the end of it: the root's own watch reports the folder
    // appearing, and nothing turned that into a watch. The directory then stayed
    // unwatched for the life of the process.
    const assets = g.at("one") + "/assets";
    expect(host.watching()[0]?.handles).not.toContain(assets);

    await mkdir(assets, { recursive: true });
    expect(await until(() => (host.watching()[0]?.handles ?? []).includes(assets))).toBe(true);

    // And a file written into it reports, which is the whole point of picking it
    // up rather than merely holding a handle.
    const before = heard.get();
    await writeFile(join(assets, "kitchen.svg"), "<svg/>\n", "utf8");
    expect(await until(() => heard.get() > before)).toBe(true);

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("a file replaced by rename goes on reporting", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    const dir = pageDir(g.at("one"), "home/swap");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "content.yaml"), "name: Swap\nplugin: doc\ncontents: []\n", "utf8");

    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);
    // Read it once so the baseline holds what is there.
    value(await call(host, g.at("one"), { kind: "page.read", page: "home/swap" }));

    // WRITE A TEMPORARY FILE AND RENAME IT OVER THE TARGET, which is how a great
    // many editors save. A watch on the FILE would be left holding the old inode
    // and would never report again; a watch on the DIRECTORY survives it.
    for (const name of ["One", "Two", "Three"]) {
      const tmp = join(dir, ".content.yaml.tmp");
      await writeFile(tmp, `name: ${name}\nplugin: doc\ncontents: []\n`, "utf8");
      await rename(tmp, join(dir, "content.yaml"));
      const before = heard.get();
      expect(await until(() => heard.get() > before)).toBe(true);
    }

    const read = value(await call(host, g.at("one"), { kind: "page.read", page: "home/swap" }));
    expect((read as { name: string }).name).toBe("Three");

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("a page deleted from outside loses its markdown", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);

    const mirror = join(g.at("one"), "_markdown", "home", "removed.md");
    const dir = pageDir(g.at("one"), "home/removed");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "content.yaml"), "name: Removed\nplugin: doc\ncontents: []\n", "utf8");
    expect(await until(() => Bun.file(mirror).size > 0)).toBe(true);

    // A PAGE DIRECTORY TAKEN AWAY FROM OUTSIDE. The only notification this gets
    // is the BARE DIRECTORY PATH, reported on the parent's watch — measured, and
    // the file inside it is not reported separately. So the branch that reads a
    // departure has to work off a directory, which is exactly what the baseline
    // cannot be asked about: it is keyed by file. The question with an answer is
    // whether this process ever saw the page document that was in there.
    const before = heard.get();
    await rm(dir, { recursive: true, force: true });
    expect(await until(() => heard.get() > before)).toBe(true);

    // AND ITS MARKDOWN GOES WITH IT. `follow` alone cannot do this — `project`
    // returns on a page it cannot read — so the mirror would keep a file about a
    // page that is not there, exactly as the app's own remove path drops first.
    expect(await until(async () => !(await Bun.file(mirror).exists()))).toBe(true);
    // The parent is re-projected, because a parent lists its children and has
    // just lost one.
    expect(await Bun.file(join(g.at("one"), "_markdown", "home.md")).exists()).toBe(true);

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("the app's own write is dropped by content hash, and so is its commit and its mirror", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    // A page with a slot to type into, written from outside and then read, so
    // everything about it is in the baseline before the subscription starts.
    const dir = pageDir(g.at("one"), "home/typed");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "content.yaml"),
      "name: Typed\nplugin: doc\ncontents:\n  - name: t\n    parts:\n      body: |\n        Before.\n",
      "utf8",
    );
    value(await call(host, g.at("one"), { kind: "page.read", page: "home/typed" }));

    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);

    // TYPING IN THE APP. It lands in `pages/` and looks exactly like an agent's
    // write; the server also commits ahead of it, which touches `.git/`, and
    // writes the page's projection, which touches `_markdown/`. None of the
    // three may reach the screen.
    value(await call(host, g.at("one"), {
      kind: "section.write", page: "home/typed", section: "t", part: "body", data: "After.\n",
    }));

    await quiet(1200);
    expect(heard.get()).toBe(0);

    // AND THE WATCH IS STILL LIVE. A suppression that worked by going deaf would
    // pass the line above and fail the person.
    await writeFile(join(dir, "content.yaml"),
      "name: Typed\nplugin: doc\ncontents:\n  - name: t\n    parts:\n      body: |\n        An agent wrote this.\n",
      "utf8");
    expect(await until(() => heard.get() > 0)).toBe(true);

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("a half-written file is ignored, and the finished save recovers", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    const dir = pageDir(g.at("one"), "home/torn");
    await mkdir(dir, { recursive: true });
    const good = "name: Torn\nplugin: doc\ncontents: []\n";
    await writeFile(join(dir, "content.yaml"), good, "utf8");
    value(await call(host, g.at("one"), { kind: "page.read", page: "home/torn" }));

    const heard = ear();
    const off = await host.watch(g.at("one"), heard.hear);

    // THE MIDDLE OF SOMEBODY ELSE'S SAVE. This is a normal intermediate state of
    // an editor, not a fault: the drawn page holds, nothing is written back over
    // the broken file, and — the part that is easy to get wrong — the BASELINE
    // is left where it was.
    await writeFile(join(dir, "content.yaml"), "name: Torn\n  contents: []\n", "utf8");
    await quiet(1200);
    expect(heard.get()).toBe(0);

    // Nothing wrote over it while it was broken.
    expect(await Bun.file(join(dir, "content.yaml")).text()).toBe("name: Torn\n  contents: []\n");

    // THE FINISHED SAVE RECOVERS. It only can because the baseline never moved
    // to the broken bytes — had it, this write would have looked like more of
    // the same to everything except the disk.
    await writeFile(join(dir, "content.yaml"), "name: Mended\nplugin: doc\ncontents: []\n", "utf8");
    expect(await until(() => heard.get() > 0)).toBe(true);
    const read = value(await call(host, g.at("one"), { kind: "page.read", page: "home/torn" }));
    expect((read as { name: string }).name).toBe("Mended");

    off();
  } finally {
    host.close();
    await g.drop();
  }
});

test("an event in one vault reaches only that vault's subscribers", async () => {
  const g = await ground();
  const host = await stand(g.at("one"), g.memory);
  try {
    await mkdir(g.at("two"), { recursive: true });
    value(await call(host, g.at("two"), { kind: "page.list" }));
    expect(host.open().sort()).toEqual([g.at("one"), g.at("two")].sort());

    const one = ear();
    const two = ear();
    const offOne = await host.watch(g.at("one"), one.hear);
    const offTwo = await host.watch(g.at("two"), two.hear);
    expect(host.watching().length).toBe(2);

    const dir = pageDir(g.at("two"), "home/only-here");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "content.yaml"), "name: Only here\nplugin: doc\ncontents: []\n", "utf8");

    expect(await until(() => two.get() > 0)).toBe(true);
    await quiet();
    // The tab on the other folder heard nothing, which is structural rather than
    // checked: the stream url carries the vault and the server keys subscribers
    // by mount.
    expect(one.get()).toBe(0);

    offOne();
    offTwo();
    expect(host.watching()).toEqual([]);
  } finally {
    host.close();
    await g.drop();
  }
});

/* ── the stream itself ─────────────────────────────────────────────────── */

test("a stream cancelled before its watch resolves still releases it", async () => {
  // THE ORDERING THAT LEAKS. `cancel` fires the moment the connection drops,
  // which on a tab closed straight after it opened is BEFORE `host.watch` has
  // resolved — so the stop had no watch to release. A watch that arrives after
  // its stream has gone has to be let go the moment it arrives; otherwise the
  // vault's watcher and the keepalive interval outlive the tab for the life of
  // the process, and nothing ever notices because the stream looks closed.
  let released = 0;
  let arrive: (() => void) | null = null;
  const host = {
    watch: (_path: string, _hear: () => void) =>
      new Promise<() => void>((resolve) => {
        arrive = () => resolve(() => void released++);
      }),
  } as unknown as Host;

  const body = events(host, "/nowhere").body;
  expect(body).not.toBe(null);
  // The tab goes while the watch is still being set up.
  await body!.cancel();
  expect(released).toBe(0);

  expect(arrive).not.toBe(null);
  (arrive as unknown as () => void)();
  expect(await until(() => released === 1)).toBe(true);

  // And it is released ONCE. A second cancel on a stream already gone must not
  // unsubscribe somebody else's watch.
  await body!.cancel();
  await quiet(100);
  expect(released).toBe(1);
});

test("a stream over a folder that cannot be a workspace ends rather than hanging", async () => {
  const host = {
    watch: () => Promise.reject(new Error("not a workspace")),
  } as unknown as Host;

  const body = events(host, "/nowhere").body;
  expect(body).not.toBe(null);
  const reader = body!.getReader();
  // Closed, with nothing sent: the tab's own reconnect keeps asking, which is
  // correct, because the folder may be there in a moment.
  const first = await reader.read();
  expect(first.done).toBe(true);
});
