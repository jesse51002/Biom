// SPDX-License-Identifier: AGPL-3.0-only
// Text files under one root. Layer 1: it knows nothing about pages, blocks or
// tables — every path it takes is a vault-relative string, and every path that
// would leave the root is refused rather than clamped.
//
// It also owns git, because the vault is a git repo and `commit()` before an
// agent write is how undo exists without an undo mechanism being built. That is
// storage, not vocabulary: nothing above here knows the vault has a history.
//
// The path guard is the only security-shaped thing in the framework, and it is
// worth reading twice. `..` and an absolute path are refused by string; a
// symlink pointing out of the vault is refused by resolving the real path of
// the deepest existing ancestor, so a file about to be *written* is checked as
// strictly as one being read.
//
// COMPOSITION: `main.ts` must `await initVault(root)` before `makeFiles(root)`
// is useful — it creates the directory and inits the git repo. Without it every
// `commit()` is a silent no-op, which is exactly the contract but leaves the
// vault with no history at all.

// Node's builtins are typed by a package this framework deliberately does not
// depend on — nothing the server runs is a package. Bun runs this file as
// written; tsc cannot see the module, so the import is suppressed and every
// value that comes out of it is annotated by hand below.
import { mkdir, open, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

import type { FileEntry, Files } from "../../contracts/types.ts";

/** WHAT THIS PROCESS LAST PUT IN A FILE, OR LAST READ OUT OF ONE, as a hash.
 *
 *  It exists for one question the filesystem cannot answer. A write made
 *  through the app lands in `pages/` and looks exactly like an agent's, so a
 *  watcher with no memory redraws a person's own page under their caret every
 *  time they stop typing. A timestamp window would be a guess about how slow
 *  this disk is; a set of paths a request is about to touch would be a promise
 *  about ordering. A hash IS the content, and comparing it is not a guess:
 *  equal to what this process wrote means nobody outside wrote it, whoever did.
 *
 *  A READ AND A WRITE ARE NOT THE SAME BASELINE. What was written, or what the
 *  watcher has already reported, silences a notification carrying the same
 *  bytes; what was merely read does not, because a read may have landed after
 *  an outside write and before the watcher got to it — `sight` below.
 *
 *  It lives here because this is the only module that both writes a file and
 *  reads one, and the baseline has to be recorded at the moment of the write.
 *  The layer that COMPARES is above; the layer that RECORDS is this one.
 *
 *  KEYED BY ABSOLUTE PATH, so the design doc's own `Files` — rooted a level down
 *  at `<vault>/design` — and the vault's own share one map without either
 *  knowing the other exists. */
export interface Seen {
  /** Remember what `abs` holds right now, as something this process WROTE or
   *  the watcher has REPORTED: a notification carrying these bytes back is
   *  nothing that happened. */
  note(abs: string, text: string): void;
  /** Remember that this process READ `abs` and found `text`. A sighting makes
   *  the path known — a page directory's arrival and departure are told by it —
   *  and SILENCES NOTHING, which is the difference from `note` and the reason
   *  there are two. A read lands wherever it lands: after an outside write and
   *  before the watcher has read that write's notification, as often as not,
   *  because the box asks for the page and the mirror reads it to project it.
   *  A read that set the baseline made the notification a match, and the one
   *  change somebody outside had just made was dropped as nothing that
   *  happened — measured, a page that never redrew. So a sighting of bytes
   *  the watcher has not reported leaves the notification to report them, and
   *  the cost of that is one redundant redraw when a read turns out to have
   *  drawn them already. A sighting of the bytes already noted keeps the note. */
  sight(abs: string, text: string): void;
  /** Is `text` exactly what this process last wrote there, or last reported? A
   *  path never seen answers false, and so does one only ever READ: unknown
   *  content is changed content, and so is content nobody has reported. */
  matches(abs: string, text: string): boolean;
  /** Has this path a baseline at all — noted or sighted? A file the server has
   *  never seen counts as changed, and the caller wants to know which of the
   *  two it is. */
  known(abs: string): boolean;
  /** Is anything BENEATH this path known? A directory is never noted, so a
   *  departed one — a page's `plugins/` deleted whole, say — is recognised by
   *  the files this process had read inside it. It says nothing about whether
   *  the path is still there: `children/` is one that is, and it holds every
   *  page inside it, so the caller asks the disk before asking this. */
  holds(abs: string): boolean;
  /** Drop `abs` and everything beneath it. A deleted path drops its baseline, so
   *  a file written again under that name reads as changed. */
  forget(abs: string): void;
}

const digest = (text: string): string => createHash("sha1").update(text).digest("hex");

/** ONE WRITE AT A TIME PER PATH, process-wide. Keyed by absolute path rather
 *  than held per `Files`, because the design doc's own `Files` and the vault's
 *  can both write `design/content.yaml`. The rename below makes each write
 *  whole; this makes the order of two the order they were asked in, so the
 *  later call is the file's last word rather than whichever finished last. A
 *  write that fails does not hold up the next. */
const tails = new Map<string, Promise<void>>();
function oneAtATime<T>(abs: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(abs) ?? Promise.resolve();
  const next = prev.then(run);
  const tail = next.then(() => undefined, () => undefined);
  tails.set(abs, tail);
  void tail.then(() => {
    if (tails.get(abs) === tail) tails.delete(abs);
  });
  return next;
}

/** ONE COMMIT AT A TIME PER REPOSITORY, whichever `Files` asks. A vault has
 *  several — its own, the one identities write through, the one a chat's agent
 *  writes through — and every commit is `git add -A` and then `git commit`,
 *  each holding `.git/index.lock` while it runs: two at once over one
 *  repository fail, and the one that loses is a warning and a lost commit.
 *  Background work commits beside the person's own writes (identities given
 *  after a sweep, the mirror's pass), so every commit over one root waits for
 *  the one before it, in the order asked. Keyed by the root's real path, so two
 *  spellings of one folder are one queue; a commit that fails does not hold up
 *  the next. */
const commitTails = new Map<string, Promise<void>>();

/** The siblings `write` and `replace` fill before renaming them onto a path —
 *  `.<name>.<eight hex>.tmp` — as a pathspec git leaves out of `add`. */
const HALF_WRITTEN = ":(exclude,glob)**/.*.????????.tmp";
/** What git says when a file its walk listed is gone before it could be read. */
const VANISHED = /unable to stat|No such file or directory|unable to index file/i;
/** How many fresh walks an add gets after one met a vanished file. */
const ADD_RETRIES = 3;
function oneCommitAtATime(root: string, run: () => Promise<void>): Promise<void> {
  const prev = commitTails.get(root) ?? Promise.resolve();
  const next = prev.then(run);
  const tail = next.then(() => undefined, () => undefined);
  commitTails.set(root, tail);
  void tail.then(() => {
    if (commitTails.get(root) === tail) commitTails.delete(root);
  });
  return next;
}

/** The baseline map. One per mounted vault, built by the composition root and
 *  handed to every `Files` rooted inside that vault. */
export function makeSeen(): Seen {
  /** The hash, and whether it was noted (written or reported) or only sighted
   *  (read). A sighting is a baseline for `known` and never for `matches`. */
  const held = new Map<string, { hash: string; noted: boolean }>();
  return {
    note: (abs: string, text: string) => void held.set(abs, { hash: digest(text), noted: true }),
    sight(abs: string, text: string) {
      const hash = digest(text);
      const had = held.get(abs);
      if (had !== undefined && had.hash === hash) return;
      held.set(abs, { hash, noted: false });
    },
    matches(abs: string, text: string) {
      const had = held.get(abs);
      return had !== undefined && had.noted && had.hash === digest(text);
    },
    known: (abs: string) => held.has(abs),
    holds(abs: string) {
      const under = abs + sep;
      for (const key of held.keys()) if (key.startsWith(under)) return true;
      return false;
    },
    forget(abs: string) {
      held.delete(abs);
      const under = abs + sep;
      for (const key of [...held.keys()]) if (key.startsWith(under)) held.delete(key);
    },
  };
}

/** A baseline that remembers nothing, for every `Files` that is not inside a
 *  watched vault — the presets, the vault seed, the checker's library. */
const FORGETFUL: Seen = {
  note: () => {},
  sight: () => {},
  matches: () => false,
  holds: () => false,
  known: () => false,
  forget: () => {},
};

/** A path that would leave the vault. Never carries the absolute path it
 *  refused: the message is a leak channel and the caller already knows what it
 *  asked for. */
export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

/** Is `path` inside `root`? THE ONE ANSWER TO THAT QUESTION IN THE SERVER, and
 *  it was three: the vault guard below, `under()` in `main.ts` serving a static
 *  file, and `insideDataHome()` deciding whether `fresh` may delete a folder.
 *  Three hand-rolled containments is three chances to write the one that says
 *  yes to `/srv/clientele` when it was asked about `/srv/client` — and the third
 *  of them is in front of an `rm -rf`.
 *
 *  PATHS, NOT STRINGS. Both sides are resolved first, so `..` is normalised away
 *  and a `#` or a `?` in the path is a character in a filename rather than the
 *  start of a fragment; then they are equal, or separated by the platform's own
 *  separator. A bare `startsWith` on the string would serve the sibling next
 *  door whose name begins with the root's.
 *
 *  `strict` excludes the root itself, which is the difference between "this is
 *  in the vault" and "this is a folder I may delete inside my data directory". */
export function within(root: string, path: string, strict = false): boolean {
  const base = resolve(root);
  const abs = resolve(path);
  if (abs === base) return !strict;
  return abs.startsWith(base + sep);
}

/** True when this folder is keeping versions — which is to say, when it is a git
 *  repo. A vault with no history still reads, writes, mirrors and seeds; the only
 *  thing it does not have is undo, and the person is entitled to know that rather
 *  than find out when they ask for a page back.
 *
 *  `.git` ON DISK, not `git rev-parse --is-inside-work-tree`: a vault nested
 *  inside another repo would get a yes from the PARENT and stage itself into it.
 *  That is not hypothetical — it is what put twelve commits of workspace onto
 *  this project's own main branch. `commit()` and `initVault()` below both turn
 *  on this answer, and so does the boot line that says a vault has no versions. */
export function hasHistory(path: string): boolean {
  return existsSync(join(resolve(path), ".git"));
}

/** ENOENT and its neighbours — "there is no text file here", which `read` and
 *  `list` answer with an empty result rather than an exception. */
const MISSING = new Set(["ENOENT", "EISDIR", "ENOTDIR"]);
const isMissing = (e: unknown): boolean =>
  typeof e === "object" && e !== null && MISSING.has(String((e as { code?: string }).code));

/** Whether a file is at `abs` right now — not a folder, and not nothing. */
async function isFile(abs: string): Promise<boolean> {
  try {
    const found: { isFile(): boolean } = await stat(abs);
    return found.isFile();
  } catch (e) {
    if (isMissing(e)) return false;
    throw e;
  }
}

const byName = (a: FileEntry, b: FileEntry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** `Files` ON A DISK, with the one write a store in memory has no need of —
 *  kept here rather than in the contract, which is `Files` everywhere else. */
export interface DiskFiles extends Files {
  /** WRITE OVER A FILE THAT IS THERE, and only then: its folder is never made
   *  and a file deleted meanwhile is never brought back. Answers whether it
   *  wrote. For a write decided from a read a moment before — a page's `uid`
   *  written back — where the page may have been deleted from outside since. */
  replace(rel: string, text: string): Promise<boolean>;
  /** WHAT A PATH IS, WITHOUT READING IT — or null where nothing is there. The
   *  inode, the size and the modification time together are how a cached head
   *  of a page is trusted or thrown away: an edit moves the size or the time,
   *  and an atomic write — a sibling renamed over the file — moves the inode.
   *  It never touches the baseline: knowing a file is there is not a sighting
   *  of its bytes. The twelfth contracts edit's page index reads it. */
  stat(rel: string): Promise<FileStat | null>;
  /** THE FIRST `bytes` OF A FILE, as UTF-8, or null where nothing is there — a
   *  page's head: its `name:` and `uid:` without the rest of its document. A
   *  character cut at the end is decoded as a replacement, which is why a
   *  caller looks for whole lines. It never touches the baseline either: a
   *  head is not the file, and a sighting of part of one would silence the
   *  watcher's verdict on the whole. */
  head(rel: string, bytes: number): Promise<string | null>;
}

/** What `DiskFiles.stat` answers. Times are milliseconds since the epoch, with
 *  whatever fraction the platform keeps; `born` is the birth time where the
 *  filesystem records one and the modification time where it does not. */
export interface FileStat {
  ino: number;
  size: number;
  mtimeMs: number;
  bornMs: number;
  dir: boolean;
}

/** Text files under `root`, and the git repo they live in.
 *
 *  `seen` is the content baseline this module keeps up to date as it reads and
 *  writes — see `Seen`. It is optional and defaults to remembering nothing,
 *  because most of the `Files` in this process are rooted outside any vault
 *  and nothing watches them. */
export function makeFiles(root: string, seen: Seen = FORGETFUL): DiskFiles {
  const ROOT = resolve(root);
  // The root itself may be reached through a symlink — a home directory on a
  // separate volume, say — so every comparison is made in real-path space.
  let realRoot: string | null = null;
  const rootReal = async (): Promise<string> => (realRoot ??= await real(ROOT));

  /** Vault-relative in, absolute out. Throws on anything that escapes. */
  const safe = async (rel: string, allowRoot = false): Promise<string> => {
    if (typeof rel !== "string") throw new PathError("a path must be a string");
    if (rel.includes("\0")) throw new PathError("a path may not contain a null byte");
    if (isAbsolute(rel)) throw new PathError("a path must be vault-relative");
    if (/^[a-zA-Z]:/.test(rel)) throw new PathError("a path must be vault-relative");

    const abs = resolve(ROOT, rel);
    if (!within(ROOT, abs)) throw new PathError("a path may not leave the vault");
    if (abs === ROOT && !allowRoot) throw new PathError("the vault root is not a file");

    if (!within(await rootReal(), await real(abs))) {
      throw new PathError("a symlink may not leave the vault");
    }
    return abs;
  };

  const git = (args: string[]) => run(ROOT, args);

  return {
    async read(rel: string): Promise<string | null> {
      const abs = await safe(rel);
      try {
        const text: string = await readFile(abs, "utf8");
        // A READ IS A SIGHTING AND NOT A NOTE. It makes the path known — a page
        // this process has read is one whose directory departing is a change —
        // and it silences no notification, because a read may land after an
        // outside write and before the watcher has reported it. `Seen.sight`
        // says why.
        seen.sight(abs, text);
        return text;
      } catch (e) {
        // A MISS FORGETS NOTHING. A path with a baseline that is not there any
        // more was taken away from outside, and the baseline is what the
        // watcher recognises the departure by — a parent projected while one
        // of its pages was being deleted read the page's file, missed, and
        // forgot it, and the directory notification that followed found
        // nothing this process had ever known there. The app's own remove
        // forgets, below, because that one is not a departure to report.
        if (isMissing(e)) return null;
        throw e;
      }
    },

    async write(rel: string, text: string): Promise<void> {
      // THE QUEUE IS JOINED BEFORE THE FIRST AWAIT, on the path as resolved
      // rather than as realpath'd, so two calls made in one order are written
      // in that order — `safe` resolves symlinks asynchronously and two of it
      // in flight finish in whichever order the disk answers.
      await oneAtATime(resolve(ROOT, rel), async () => {
        const abs = await safe(rel);
        await mkdir(dirname(abs), { recursive: true });
        // WHOLE OR NOT AT ALL. The bytes go to a sibling under a name nobody
        // reads, and the rename is the write: a reader — the watcher, the other
        // server on this folder, the person's editor — sees the old file or the
        // new one and never a torn one. `writeFile` straight onto the path
        // truncates and then fills, and two of them in flight on one path left
        // a page holding the front of one write and a run of NUL bytes where the
        // rest of the other should have been — `Missing closing quote`, and the
        // page drawn as one naming a plugin nobody installed. Measured, and
        // reproduced in one process with two concurrent writeFile calls.
        const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(4).toString("hex")}.tmp`);
        await writeFile(tmp, text, "utf8");
        // AT THE MOMENT OF THE WRITE, and not after the notification arrives. The
        // watcher may already be reading this file by the time the next line
        // runs, so the baseline has to be true before anything can ask it.
        seen.note(abs, text);
        try {
          await rename(tmp, abs);
        } catch (e) {
          await rm(tmp, { force: true });
          throw e;
        }
      });
    },

    async replace(rel: string, text: string): Promise<boolean> {
      // ON `write`'S QUEUE, so a replace and a write to one path land in the
      // order they were asked, and whole in the same way: a sibling, renamed.
      return await oneAtATime(resolve(ROOT, rel), async () => {
        const abs = await safe(rel);
        // NO FOLDER IS MADE. A page deleted from outside after its caller read
        // it was brought back by `write`, whose mkdir made the folder again:
        // here the sibling cannot be written into a folder that is gone.
        const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(4).toString("hex")}.tmp`);
        try {
          await writeFile(tmp, text, "utf8");
        } catch (e) {
          if (isMissing(e)) return false;
          throw e;
        }
        try {
          // AND NO FILE IS BROUGHT BACK: one deleted with its folder left
          // stays deleted. Nothing an outside `rm` honours can hold the file
          // between this look and the rename, so this narrows the gap to those
          // two calls, where it was a read, a parse and a write.
          if (!(await isFile(abs))) {
            await rm(tmp, { force: true });
            return false;
          }
          seen.note(abs, text);
          await rename(tmp, abs);
          return true;
        } catch (e) {
          await rm(tmp, { force: true });
          throw e;
        }
      });
    },

    async remove(rel: string): Promise<void> {
      const abs = await safe(rel);
      // Recursive, because a page is a directory; force, because removing what
      // is already gone is the same outcome the caller asked for.
      await rm(abs, { recursive: true, force: true });
      seen.forget(abs);
    },

    async list(rel: string): Promise<FileEntry[]> {
      const abs = await safe(rel === "" ? "." : rel, true);
      let entries: { name: string; isDirectory(): boolean }[];
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch (e) {
        if (isMissing(e)) return [];
        throw e;
      }
      return entries
        // This module's own bookkeeping. Nothing above ever asked for it, and
        // the vault tree would show it as a page directory if it did.
        .filter((e) => e.name !== ".git")
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        // readdir order is whatever the filesystem feels like; the page tree
        // must not reshuffle between two runs.
        .sort(byName);
    },

    async stat(rel: string): Promise<FileStat | null> {
      const abs = await safe(rel === "" ? "." : rel, true);
      try {
        const found = await stat(abs);
        return {
          ino: found.ino,
          size: found.size,
          mtimeMs: found.mtimeMs,
          bornMs: found.birthtimeMs > 0 ? found.birthtimeMs : found.mtimeMs,
          dir: found.isDirectory(),
        };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },

    async head(rel: string, bytes: number): Promise<string | null> {
      const abs = await safe(rel);
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(abs, "r");
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
      try {
        const want = Math.max(0, Math.floor(bytes));
        const buf = Buffer.alloc(want);
        const { bytesRead } = await handle.read(buf, 0, want, 0);
        return buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
    },

    async created(rel: string): Promise<string | null> {
      const abs = await safe(rel === "" ? "." : rel, true);
      let found: { birthtimeMs: number; mtimeMs: number };
      try {
        found = await stat(abs);
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
      // A filesystem that keeps no birth time reports zero, and the
      // modification time is the nearest thing it has.
      const ms = found.birthtimeMs > 0 ? found.birthtimeMs : found.mtimeMs;
      return new Date(ms).toISOString();
    },

    async commit(message: string): Promise<void> {
      // No repo, no history, and that is the contract rather than a failure: the
      // write above it goes through either way. See `hasHistory` for why it is
      // `.git` on disk and never `git rev-parse`.
      if (!hasHistory(ROOT)) return;

      let key = ROOT;
      try {
        key = realpathSync(ROOT);
      } catch {
        /* the root as given; a folder that is not there commits nothing anyway */
      }
      await oneCommitAtATime(key, async () => {
        // A FILE THAT WENT WHILE GIT LISTED THE TREE. Every write here is a
        // sibling renamed onto the path, and `git add -A` stats whatever its walk
        // met — so a write landing during the walk made the sibling vanish under
        // it, git refused the whole add, and the commit, the undo point asked
        // for, was never made. The mirror writes in the background beside every
        // commit now, so this was a lost commit in a busy minute, not a rarity.
        // The siblings are left out by name, and a file somebody else's program
        // removed mid-walk is asked about once more on a fresh walk.
        let added = await git(["add", "-A", "--", ".", HALF_WRITTEN]);
        for (let again = 0; added.code !== 0 && again < ADD_RETRIES && VANISHED.test(added.err); again++) {
          added = await git(["add", "-A", "--", ".", HALF_WRITTEN]);
        }
        if (added.code !== 0) return warn(added.err || "git add failed");

        const done = await git(["commit", "-m", message]);
        // Exit 1 with nothing staged is the ordinary case — two writes in a row
        // where the second changed nothing. It is not a failure.
        if (done.code !== 0 && !/nothing to commit|nothing added/i.test(done.out + done.err)) {
          warn(done.err || done.out || "git commit failed");
        }
      });
    },
  };
}

/** Create the vault directory and make it a git repo, which is what gives the
 *  workspace an undo. Returns true when it created one. Safe to call on a vault
 *  that already exists — that is the ordinary case on every run after the first. */
export async function initVault(root: string): Promise<boolean> {
  const ROOT = resolve(root);
  await mkdir(ROOT, { recursive: true });
  if (hasHistory(ROOT)) return false;

  const init = await run(ROOT, ["init", "-b", "main"]);
  if (init.code !== 0) {
    warn(init.err || "git init failed — the vault will have no history");
    return false;
  }

  // A machine with no global git identity cannot commit at all. Set one on this
  // repo only, and only when nothing is configured already, so the vault's
  // history is attributable and nobody's global config is touched.
  if ((await run(ROOT, ["config", "user.email"])).code !== 0) {
    await run(ROOT, ["config", "user.email", "framework@biom.local"]);
  }
  if ((await run(ROOT, ["config", "user.name"])).code !== 0) {
    await run(ROOT, ["config", "user.name", "Biom framework"]);
  }
  return true;
}

interface GitResult {
  code: number;
  out: string;
  err: string;
}

function run(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise<GitResult>((done) => {
    // No shell, so an argument is an argument and a page name full of quotes is
    // just a page name.
    const ps = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    ps.stdout.on("data", (d: unknown) => {
      out += String(d);
    });
    ps.stderr.on("data", (d: unknown) => {
      err += String(d);
    });
    // git missing from the machine entirely: -1, and the caller treats it as a
    // vault with no history rather than a failed write.
    ps.on("error", (e: unknown) => done({ code: -1, out, err: String(e) }));
    ps.on("close", (code: number | null) => done({ code: code ?? -1, out, err }));
  });
}

let warned = false;
function warn(message: string): void {
  // Once. A vault whose history is broken should say so, and should not say so
  // on every keystroke — and it must never break the write it was protecting.
  if (warned) return;
  warned = true;
  console.warn(`[files] the vault history is not being written: ${message.trim()}`);
}

/** The real path of `p`, resolving symlinks — including for a path that does
 *  not exist yet, by resolving the deepest ancestor that does and re-attaching
 *  the rest. A dangling symlink is followed by hand, because writing through
 *  one lands wherever it points. */
async function real(p: string): Promise<string> {
  // THE COMMON CASE, ASKED SYNCHRONOUSLY: a path that is there, resolved by
  // the C library in one call of a few microseconds. The promise form is the
  // same question sent through the thread pool, and at three or four times
  // the price it was most of what a sweep of two thousand folders cost — this
  // check runs on every access. Same answer, same containment test after it;
  // a path that is not there yet falls through to the walk below.
  try {
    return realpathSync.native(p);
  } catch {
    // Not there, or a dangling link: resolved by hand below.
  }
  let cur = p;
  const tail: string[] = [];
  for (let hop = 0; hop < 32; hop++) {
    try {
      const resolved: string = await realpath(cur);
      return tail.length > 0 ? join(resolved, ...tail) : resolved;
    } catch {
      let link: string | null = null;
      try {
        link = await readlink(cur);
      } catch {
        link = null;
      }
      if (link !== null) {
        cur = resolve(dirname(cur), link);
        continue;
      }
      const up = dirname(cur);
      if (up === cur) return p;
      tail.unshift(basename(cur));
      cur = up;
    }
  }
  return p;
}
