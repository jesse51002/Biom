// SPDX-License-Identifier: AGPL-3.0-only
// Watching a vault's authored files. Layer 1, beside `files.ts`, because
// `fs.watch` is a raw platform capability and this module has no vocabulary: it
// knows directories, paths and exclusions, and nothing at all about pages.
//
// WHAT A CHANGED PATH MEANS IS NOT HERE. Whether a path is a page, which page,
// and whether the change is structural belongs to `server/domain/mirror.ts`,
// which already carries the segment walk and its `SEGMENT` rule for exactly
// this reason: the vault root is also somebody's Obsidian folder, and a name
// that is not a legal page segment is not a page and must never be turned into
// an id.
//
// DIRECTORIES ARE WATCHED, NEVER FILES, and that is the one decision in here
// worth reading twice. An editor that saves by replacing — write a temporary
// file, rename it over the target — leaves a watch on the old inode watching
// nothing, and the file silently stops reporting after its first change. A
// directory watch survives the rename and reports it as a change to its entry.
//
// RECURSION IS A PLATFORM FACT. macOS and Windows implement `recursive: true`
// natively; Linux does not, so one watch is kept per directory. Either way a
// directory that appears is picked up on the notification that announced it —
// including a WATCHED ROOT that was not there when the watch started, which on a
// fresh vault is `assets/` and `plugins/` and is the ordinary case rather than
// the odd one.
//
// A WATCH IS CHEAP AND A WATCHER IS NOT FOREVER. Nothing here starts on mount:
// `main.ts` starts one when the first stream for a vault connects and closes it
// when the last one disconnects, which is the only lifetime the mount registry
// can actually offer — mounting does not unmount.

// Node's builtins are typed by a package this framework deliberately does not
// depend on, so the import is annotated by hand below, exactly as `files.ts`
// does it.
import { readdirSync, watch } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** HOW LONG A BURST IS COALESCED FOR, in ms. A save is rarely one notification
 *  and a directory being created and filled is many, so the watcher waits for
 *  them to stop and then reports once. It is the only latency number in the
 *  feature: short enough that a write feels immediate, long enough that an
 *  editor's write-then-rename is one settle rather than two. */
export const SETTLE = 120;

/** WHAT A PERSON OR AN AGENT WRITES. Anything under one of these is authored
 *  input and a reason to redraw; a path under neither this nor `EXCLUDED` is
 *  ignored rather than guessed at. */
export const WATCHED_DIRS: readonly string[] = ["pages", "design", "base", "plugins", "assets"];

/** The two files in the vault ROOT that change how a page draws. They are named
 *  rather than swept in, because the root also holds `AGENTS.md`, a `.gitignore`
 *  and whatever else somebody has put there. */
export const WATCHED_FILES: readonly string[] = ["theme.json", "markdown.yaml"];

/** THE APP'S OWN OUTPUT AND MACHINERY, which the watcher must never mistake for
 *  fresh authored content. `_markdown/` is the mirror, written by the refresh
 *  this watcher triggers — excluding it is what stops that loop feeding itself.
 *  `.git/` is touched by every write, because the server commits ahead of
 *  itself. `workspace.db` and its sidecars are the server's own and no redraw
 *  reads them.
 *
 *  THE FOURTH EXCLUSION IS NOT A PATH and is not here: a write made through the
 *  app lands in `pages/` and looks exactly like an agent's. It is suppressed by
 *  content hash — `Seen` in `files.ts` — at the layer that can compare. */
export const EXCLUDED: ReadonlySet<string> = new Set([
  "_markdown",
  ".git",
  "workspace.db",
  "workspace.db-wal",
  "workspace.db-shm",
  // THE FRAMEWORK'S OWN FOLDER INSIDE A VAULT: the registry of runs and every
  // run's directory, whose two logs GROW while a run is alive. The dotfile
  // rule below already declines it; it is named here anyway, beside the other
  // database, because a log growing must never redraw a page and a rule that
  // is only implied is a rule somebody edits away.
  ".biom",
]);

/** A running watch over one vault. Closing it releases every handle it holds,
 *  which is what makes "released on the last subscriber" a testable claim. */
export interface Watcher {
  /** Absolute directories currently watched. The tests read it; nothing else
   *  does. */
  handles(): string[];
  close(): void;
}

/** One notification, as an ABSOLUTE path. It says a path changed and nothing
 *  more — the caller reads disk, because a payload naming contents would be a
 *  second, faster description of the workspace that can disagree with the
 *  first. */
export type Notify = (abs: string) => void;

/** True where `fs.watch` implements `recursive` natively. Linux does not, and a
 *  recursive watch there silently watches only the top directory — which reads
 *  as "the feature works for files in the root and nowhere else". */
export const RECURSIVE: boolean =
  typeof process !== "undefined" && (process.platform === "darwin" || process.platform === "win32");

/** Is `rel` — a vault-relative path with `/` separators — authored input? */
export function watched(rel: string): boolean {
  const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) return false;
  for (const part of parts) {
    if (EXCLUDED.has(part)) return false;
    // A dotfile is somebody's editor, their `.DS_Store` or their `.obsidian/`.
    // None of it draws a page, and `.git/` is only the loudest of them.
    if (part.startsWith(".")) return false;
  }
  const head = parts[0];
  if (head === undefined) return false;
  if (parts.length === 1) return WATCHED_FILES.includes(head) || WATCHED_DIRS.includes(head);
  return WATCHED_DIRS.includes(head);
}

/**
 * Watch `root`'s authored input and call `notify` with an absolute path every
 * time one changes. Coalescing is the caller's, because the caller is the one
 * that knows what a burst is for.
 *
 * Never throws. A machine at its watch-descriptor limit, or a filesystem where
 * `fs.watch` does not work at all, says so once and leaves the Reload button as
 * the way — a workspace that refused to open because it could not watch itself
 * would be trading the thing for its shadow.
 */
export function watchTree(root: string, notify: Notify): Watcher {
  const ROOT = resolve(root);
  /** Absolute directory → its handle. A directory is watched once. */
  const handles = new Map<string, { close(): void }>();
  let shut = false;

  /** ENOSPC (the inotify limit), EMFILE, or a filesystem with no watch at all.
   *  One line, and the rest of the tree goes on being watched.
   *
   *  PER WATCHER RATHER THAN PER PROCESS, so a second workspace's real trouble
   *  is not swallowed by a line printed about the first — and NEVER for a
   *  directory that is simply not there, which is the ordinary state of
   *  `assets/` and `plugins/` in a fresh vault and is not trouble at all. It
   *  used to be the first thing printed on every new workspace, which is what a
   *  process-wide flag then hid a real fault behind. */
  let warned = false;
  const trouble = (e: unknown): void => {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "ENOENT") return;
    if (warned) return;
    warned = true;
    console.warn(
      `[watch] this workspace is not being watched for outside changes: ${String(e)} — ` +
        "the Reload button still rereads it",
    );
  };

  /** Vault-relative, `/`-separated, for a path known to be inside the root. */
  const relOf = (abs: string): string => relative(ROOT, abs).split(sep).join("/");

  const add = (abs: string): void => {
    if (shut || handles.has(abs)) return;
    let handle: { close(): void };
    try {
      handle = watch(abs, { recursive: RECURSIVE && abs !== ROOT }, (_event: string, name: string | null) => {
        // The root's own watch is never recursive — `.git/` and `_markdown/`
        // live under it — so a name from there is one segment.
        const changed = name === null || name === "" ? abs : join(abs, ...String(name).split(/[\\/]/));
        hear(changed);
      });
    } catch (e) {
      trouble(e);
      return;
    }
    // A handle whose directory goes away emits `error` rather than throwing, and
    // an unhandled one takes the process down.
    const maybe = handle as { on?: (event: string, fn: (e: unknown) => void) => void };
    if (typeof maybe.on === "function") maybe.on("error", () => drop(abs));
    handles.set(abs, handle);
  };

  const drop = (abs: string): void => {
    const handle = handles.get(abs);
    if (!handle) return;
    handles.delete(abs);
    try {
      handle.close();
    } catch {
      /* already gone */
    }
  };

  function hear(abs: string): void {
    if (shut) return;
    if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return;
    const rel = relOf(abs);
    if (rel === "" || !watched(rel)) return;
    // A DIRECTORY THAT APPEARED IS WATCHED BEFORE IT IS REPORTED, which is what
    // makes "create a nested directory then write inside it" work on Linux: the
    // write that follows arrives on a handle that already exists. It is
    // deliberately synchronous — an await here is a window in which a file
    // written into a brand-new directory reports to nobody.
    if (!RECURSIVE) follow(abs, true);
    // A WATCHED DIRECTORY THAT WAS NOT THERE WHEN THE WATCH STARTED, on the
    // platforms where the kernel recurses. A fresh vault has no `assets/` and no
    // `plugins/`, so `add` threw ENOENT on each of them below and the root's own
    // watch is the only thing that ever reports one appearing. On Linux `follow`
    // above picks it up; here nothing did, and the folder stayed unwatched for
    // the life of the process — the feature simply absent for the first picture
    // anybody added. `add` is a no-op when the handle is already there.
    else {
      const head = rel.split("/")[0];
      if (head !== undefined && WATCHED_DIRS.includes(head)) add(join(ROOT, head));
    }
    notify(abs);
  }

  /** Pick up whatever is under `abs` that is not watched yet, and let go of
   *  whatever is no longer there. Linux only; elsewhere the kernel does it.
   *
   *  SYNCHRONOUS, and that is the point rather than an oversight: a watch
   *  installed one tick late is a write nothing reported, and the trees this
   *  walks are a workspace's directories. */
  function follow(abs: string, report: boolean): void {
    if (shut) return;
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      // Not a directory, or gone. Either way nothing under it is watched.
      drop(abs);
      for (const held of [...handles.keys()]) if (held.startsWith(abs + sep)) drop(held);
      return;
    }
    const fresh = !handles.has(abs);
    add(abs);
    for (const entry of entries) {
      const here = join(abs, entry.name);
      if (!watched(relOf(here))) continue;
      if (entry.isDirectory()) {
        if (!handles.has(here)) follow(here, report);
        continue;
      }
      // WHAT WAS ALREADY IN A DIRECTORY WE HAVE ONLY JUST STARTED WATCHING.
      // Between a directory being created and a watch being installed on it
      // there is a window, and `mkdir -p` followed immediately by a write lands
      // squarely in it — so a file found inside a freshly watched directory is
      // reported as if the watch had been there. The layer above answers by
      // content hash, so a file that has not moved costs nothing.
      if (report && fresh) notify(here);
    }
  }

  /** The first walk, run before this function returns, so a caller that
   *  subscribed and then wrote a file is heard. The root is always watched on
   *  its own and never recursively — `.git/` and `_markdown/` are under it — so
   *  `theme.json` and `markdown.yaml` report, and so a watched directory that
   *  does not exist yet is noticed the moment it appears. */
  add(ROOT);
  for (const dir of WATCHED_DIRS) {
    const abs = join(ROOT, dir);
    if (RECURSIVE) add(abs);
    else follow(abs, false);
  }

  return {
    handles: () => [...handles.keys()].sort(),
    close() {
      shut = true;
      for (const abs of [...handles.keys()]) drop(abs);
    },
  };
}

/** A path that is inside `root`, as a vault-relative `/`-separated string, or
 *  null when it is not. Exported because the layer above compares paths and
 *  must not have to know what a separator is on this machine. */
export function insideOf(root: string, abs: string): string | null {
  const ROOT = resolve(root);
  if (!isAbsolute(abs)) return null;
  if (abs === ROOT) return "";
  if (!abs.startsWith(ROOT + sep)) return null;
  return relative(ROOT, abs).split(sep).join("/");
}
