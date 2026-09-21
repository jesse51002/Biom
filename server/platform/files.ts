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
import { mkdir, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
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
 *  equal to the baseline means nobody outside wrote it, whoever did.
 *
 *  It lives here because this is the only module that both writes a file and
 *  reads one, and the baseline has to be recorded at the moment of the write.
 *  The layer that COMPARES is above; the layer that RECORDS is this one.
 *
 *  KEYED BY ABSOLUTE PATH, so the design doc's own `Files` — rooted a level down
 *  at `<vault>/design` — and the vault's own share one map without either
 *  knowing the other exists. */
export interface Seen {
  /** Remember what `abs` holds right now. */
  note(abs: string, text: string): void;
  /** Is `text` exactly what this process last wrote or read there? A path never
   *  seen answers false: unknown content is changed content. */
  matches(abs: string, text: string): boolean;
  /** Has this path a baseline at all? A file the server has never seen counts as
   *  changed, and the caller wants to know which of the two it is. */
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

/** The baseline map. One per mounted vault, built by the composition root and
 *  handed to every `Files` rooted inside that vault. */
export function makeSeen(): Seen {
  const held = new Map<string, string>();
  return {
    note: (abs: string, text: string) => void held.set(abs, digest(text)),
    matches: (abs: string, text: string) => held.get(abs) === digest(text),
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

const byName = (a: FileEntry, b: FileEntry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Text files under `root`, and the git repo they live in.
 *
 *  `seen` is the content baseline this module keeps up to date as it reads and
 *  writes — see `Seen`. It is optional and defaults to remembering nothing,
 *  because most of the `Files` in this process are rooted outside any vault
 *  and nothing watches them. */
export function makeFiles(root: string, seen: Seen = FORGETFUL): Files {
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
        // THE BASELINE IS SET BY A READ AS WELL AS BY A WRITE. A page drawn is a
        // page whose files this process has seen; a notification that carries the
        // same bytes back is nothing that happened.
        seen.note(abs, text);
        return text;
      } catch (e) {
        if (isMissing(e)) {
          seen.forget(abs);
          return null;
        }
        throw e;
      }
    },

    async write(rel: string, text: string): Promise<void> {
      const abs = await safe(rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text, "utf8");
      // AT THE MOMENT OF THE WRITE, and not after the notification arrives. The
      // watcher may already be reading this file by the time the next line runs,
      // so the baseline has to be true before anything can ask it.
      seen.note(abs, text);
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

    async commit(message: string): Promise<void> {
      // No repo, no history, and that is the contract rather than a failure: the
      // write above it goes through either way. See `hasHistory` for why it is
      // `.git` on disk and never `git rev-parse`.
      if (!hasHistory(ROOT)) return;

      const added = await git(["add", "-A"]);
      if (added.code !== 0) return warn(added.err || "git add failed");

      const done = await git(["commit", "-m", message]);
      // Exit 1 with nothing staged is the ordinary case — two writes in a row
      // where the second changed nothing. It is not a failure.
      if (done.code !== 0 && !/nothing to commit|nothing added/i.test(done.out + done.err)) {
        warn(done.err || done.out || "git commit failed");
      }
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
