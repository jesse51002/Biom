// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — which folder this workspace IS, the folders it could be, the ones it
// has been, and how a new one is MADE.
//
// The workspace folder is picked in the UI rather than set by an environment
// variable somebody has to know about, so four things have to exist: a way to
// LOOK at the filesystem, a way to say whether a folder is a workspace already,
// a memory of the ones opened before, and — because a first launch has no folder
// to pick — a way to make one where the person says. All four are here.
//
// MAKING ONE IS A PARENT AND A NAME. The person chooses a folder they already
// have and types a name; `creatable` decides and `createVault` acts. There is no
// path field with a default in it, and no invented `~/Biom`: a prefilled
// absolute path is a decision made for somebody about a folder they have not
// looked at, and the one thing a person knows on a first launch is where they
// keep their own work.
//
// `open` is NOT here, and cannot be. Opening a vault means building every server
// module again against a different folder — a new Files, a new Db, a new
// everything above them — and the composition root is the only module in the
// server that constructs anything. It implements `Vault`; this file is what it
// is handed.
//
// THE ONE EXCEPTION IN THE FRAMEWORK, named rather than hidden: this module reads
// the filesystem through node:fs directly, where everything above layer 1 goes
// through `Files`. It has to. `Files` is rooted at one directory and refuses
// every path that leaves it, which is exactly the property browsing must not
// have — browsing is walking around OUTSIDE the vault, looking for the next one.
// A `Files` rooted at "/" would be the same power with its one guard switched
// off, and a layering violation on top of it.
//
// That the server browses its own disk at all is only reasonable because the
// framework is local and unsecured BY DECISION. The product's answer is a
// workspace on a server and looks nothing like this. Nothing here is a pattern
// to carry forward.

import { access, mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { hasHistory, within } from "../platform/files.ts";

import type { DirEntry } from "../../contracts/types.ts";
import type { DirListing } from "../../contracts/types.ts";
import type { VaultInfo } from "../../contracts/types.ts";

/** What makes a folder look like a workspace rather than an empty folder about
 *  to become one. It is `pages/` and not `workspace.db`, because the pages are
 *  the vault — the database is a rebuildable index beside them, and a folder
 *  holding only one is a folder somebody has not finished with. */
const PAGES = "pages";

/** How many vaults the picker remembers. Long enough that the common case is one
 *  click, short enough that the list is still readable. */
const REMEMBER = 8;

/** Domain failures carry one of the contract's closed error codes so the API
 *  layer answers with it rather than falling back to `internal`. The message
 *  never carries the path it refused: the caller already knows what it asked
 *  for, and a message is a leak channel. */
const bad = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code });

/** True when this folder already holds a workspace. Synchronous and cheap: it is
 *  asked once per entry in a directory listing. */
export function seeded(path: string): boolean {
  return existsSync(join(path, PAGES));
}

/* ── where this MACHINE keeps its Biom data ─────────────────────────────── */

/** The folder the default vault and the remembered list live in.
 *
 *  NOT BESIDE THE INSTALL, and that is the whole of it. A server that wrote next
 *  to its own files cannot run from `/usr/local/bin` or `/Applications` — and one
 *  that can has just written a workspace into the middle of somebody's source
 *  tree, which is exactly what this framework did to its own repository.
 *
 *  One directory rather than a config half and a data half: there are two files
 *  in it, they are both this machine's answer to "where were we", and a split
 *  would be two paths to get wrong for no reader's benefit.
 *
 *  A RELATIVE `XDG_DATA_HOME` IS IGNORED, which is the XDG spec's own rule — the
 *  variable is defined as an absolute path and a relative one is a misconfigured
 *  environment rather than a folder to create under the current directory. */
export function dataHome(): string {
  const home = homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    return local !== undefined && local.trim() !== ""
      ? join(local, "Biom")
      : join(home, "AppData", "Local", "Biom");
  }
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Biom");
  const xdg = process.env.XDG_DATA_HOME;
  return xdg !== undefined && isAbsolute(xdg) ? join(xdg, "biom") : join(home, ".local", "share", "biom");
}

/** The vault a run with nothing else to go on opens. It is created and seeded on
 *  first use, which is the ordinary headless first run — a person who picks a
 *  folder in the UI never meets it. */
export function defaultVault(): string {
  return join(dataHome(), "workspace");
}

/** Where the choice of folder is remembered. It is ABOUT vaults, so it cannot
 *  live in one; it is this machine's and not the repo's, so it cannot live beside
 *  the install either. `VAULTS` overrides it, and the tests need that. */
export function memoryFile(): string {
  return join(dataHome(), "vaults.json");
}

/** True when `path` lies STRICTLY inside the data directory — the one place a
 *  delete is this framework's to make. The data directory itself is excluded: it
 *  holds the remembered list, and dropping a vault is not forgetting every vault. */
export function insideDataHome(path: string): boolean {
  return within(dataHome(), path, true);
}

/** The database beside the pages. Named here as well as in the composition root
 *  because this is where a folder is asked whether it can be served, and a file
 *  by that name which is not a database is one of the ways it cannot. */
const DB = "workspace.db";

/** WHAT EVERY SQLITE FILE STARTS WITH, from the format's own header definition:
 *  the string and the NUL that terminates it, sixteen bytes. A file that is
 *  shorter than that, or that starts with anything else, is not a database —
 *  which `bun:sqlite` discovers by throwing `SQLITE_NOTADB` out of the first
 *  statement, from inside the composition root, where there is nothing left to
 *  do with it but die. */
const SQLITE_MAGIC = "SQLite format 3\u0000";

/** Is the file at `abs` a SQLite database? A file that is not there at all
 *  answers YES — an absent database is the ordinary state of a vault that has
 *  never been opened, and `makeDb` creates one. An empty file answers yes too:
 *  SQLite treats a zero-length file as a fresh database and so does this.
 *
 *  It reads the header rather than opening the file, because opening it is the
 *  act this is standing in front of. */
async function looksLikeADatabase(abs: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(abs, "r");
  } catch {
    // Not there, or not readable. The first is fine and the second is caught by
    // the readable check above this one; either way it is not THIS refusal.
    return true;
  }
  try {
    const head = Buffer.alloc(SQLITE_MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (bytesRead === 0) return true;
    return head.subarray(0, bytesRead).toString("latin1") === SQLITE_MAGIC.slice(0, bytesRead);
  } catch {
    return true;
  } finally {
    await handle.close().catch(() => {});
  }
}

/** THE LAST GATE BEFORE A FOLDER IS MOUNTED, and the conditions it holds are the
 *  ones `check` cannot: `check` asks whether a path names a readable directory,
 *  which is everything a person PICKING one needs; this asks whether the program
 *  can actually serve a workspace out of it, which is a different question and
 *  only matters a moment later.
 *
 *  BOTH OF THESE WERE MEASURED AS A DEAD PROCESS. A folder with no write
 *  permission reached `makeDb`, which creates the database file, and the
 *  `SQLITE_CANTOPEN` came out of the composition root with a stack trace and no
 *  window. A `workspace.db` that is not a database reached the first statement
 *  and came out as `SQLITE_NOTADB` the same way. Neither is a workspace that
 *  cannot be opened in any interesting sense — both are one sentence and a
 *  picker.
 *
 *  NOTHING HERE IS WRITTEN, tried or repaired. A database that will not open is
 *  left exactly where it is: it holds the person's rows, and a framework that
 *  moved it aside to get itself started would be the one thing worse than
 *  refusing. */
export async function mountable(abs: string): Promise<string> {
  try {
    await access(abs, constants.W_OK | constants.X_OK);
  } catch {
    throw bad("bad_request", "that folder cannot be written to — a workspace keeps its pages, its history and its database inside it");
  }
  if (!(await looksLikeADatabase(join(abs, DB)))) {
    throw bad(
      "bad_request",
      `that folder holds a ${DB} that is not a database — move it aside and open the folder again, and a new one is built from the pages`,
    );
  }
  return abs;
}

/** ONE PLACE A FOLDER IS VALIDATED BEFORE IT IS MOUNTED, and every caller that
 *  mounts goes through it: the boot vault, `vault.open`, `vault.create`'s second
 *  half, and every request that names a folder in its url.
 *
 *  It is the two gates in order, because each answers a different sentence and
 *  the first one that is false is the one worth saying. */
export async function usable(path: unknown): Promise<string> {
  return await mountable(await check(path));
}

/** Refuses a folder that is somebody else's. **Seed only an empty folder**: a
 *  directory with anything at all in it that is not already a workspace belongs
 *  to whoever put that there, and opening it would write a `pages/` tree, a
 *  database and a git history into the middle of it.
 *
 *  This is not a hypothetical. The framework was pointed at the repo that builds
 *  it; `initVault` found a `.git` already present, correctly declined to create
 *  one, and then committed into it anyway — twelve commits of workspace onto a
 *  project's main branch, plus every untracked file in the tree swept along by
 *  the same `add`. Nothing in the path refused, because nothing in the path was
 *  ever asked whether the folder was free.
 *
 *  `check` deliberately does NOT do this: browsing has to walk through
 *  non-empty folders to reach an empty one, so the rule belongs to opening.
 *
 *  A dotfile counts. `.DS_Store` in a folder means a person has been there, and
 *  guessing which hidden files are ignorable is how a rule like this rots. */
export async function openable(abs: string): Promise<string> {
  if (seeded(abs)) return abs;
  // INSIDE ANOTHER WORKSPACE IS ITS OWN SENTENCE, and it is said before the
  // generic one because it is the case somebody cannot act on without being
  // told which folder. `<vault>/pages/home/children/Notes` is non-empty, so the
  // refusal below was technically true and completely unhelpful: the person had
  // opened their own workspace's page tree, and "pick an empty one" invites
  // them to make a second workspace inside the first — which is the two
  // databases, two mirrors, two git repositories case `creatable` already walks
  // the whole ancestry to prevent. This is the same walk on the same rule, said
  // on the way IN rather than only on the way to a new folder.
  const ancestor = ancestorVault(abs);
  if (ancestor !== null) {
    throw bad("bad_request", `that folder is inside the workspace at ${ancestor} — open that one instead`);
  }
  const held = await readdir(abs);
  if (held.length > 0) {
    throw bad(
      "bad_request",
      "that folder is not empty — pick an empty one, or one that already holds a workspace",
    );
  }
  return abs;
}

/** THE FIRST DIRECTORY AT OR ABOVE `abs` THAT IS ACTUALLY THERE, or the home
 *  directory if none of them is.
 *
 *  It exists for one screen. The picker opens beside the folder you were last
 *  in — and the reason it is open may be that that folder is gone, or that the
 *  drive it was on is not connected, in which case its parent is gone too and
 *  `check` refuses a path that is not there. What a person then got, on the ONE
 *  screen that could fix their problem, was a refusal. Walking up answers the
 *  mount point for a missing volume and the containing folder for a deleted
 *  workspace, which is where somebody would have looked first anyway.
 *
 *  Synchronous, cheap and bounded by the depth of the path, like `ancestorVault`
 *  above it and for the same reasons. It ends at the filesystem root, where
 *  `dirname` stops moving. */
export function nearest(abs: string): string {
  let at = resolve(abs);
  for (;;) {
    if (existsSync(at)) return at;
    const up = dirname(at);
    if (up === at) return homedir();
    at = up;
  }
}

/* ── what to open on the way up ─────────────────────────────────────────── */

/** THE ONE DECISION ABOUT A BAD REMEMBERED ENTRY, so there is one place it is
 *  made and one rule to read. `path` is the folder to mount, or null for a
 *  launch that mounts nothing; `why` is the sentence, or null when there was
 *  nothing to say. */
export interface BootVault {
  path: string | null;
  why: string | null;
}

/** WHICH FOLDER A RUN OPENS, and the asymmetry between the two candidates is the
 *  whole of it.
 *
 *  `VAULT=` IS TRUSTED AND CREATED. Somebody typed it on this launch, so a
 *  folder that is not there yet is a folder they are asking for — that is the
 *  ordinary headless first run, and it is the one place this program still makes
 *  a directory nobody clicked on.
 *
 *  A REMEMBERED ENTRY IS CHECKED, AND THIS IS THE BUG IT CLOSES. It is a folder
 *  somebody opened once and has not named since, so it is a claim about the past
 *  rather than a request — and the past goes stale. Measured, on a real run:
 *  a remembered vault that had been deleted was RECREATED by `initVault`'s
 *  `mkdir -p` and seeded from scratch, so the application opened on an empty
 *  workspace wearing the name of the one the person had lost; a remembered vault
 *  on a volume that was not mounted had its whole missing path created inside
 *  the empty mount point. Neither said anything. A remembered folder is
 *  therefore opened only if it is still a workspace, and anything else is a
 *  launch that mounts nothing and says why — which is the picker.
 *
 *  IT WRITES NOTHING AND REPAIRS NOTHING, including the remembered list: the
 *  entry stays in the file, because a volume that is not mounted this morning is
 *  not a workspace anybody forgot. `recent()` already filters what is not there. */
export async function bootVault(named: string | undefined, remembered: string | null): Promise<BootVault> {
  const typed = named?.trim();
  if (typed !== undefined && typed !== "") return { path: resolve(typed), why: null };
  if (remembered === null || remembered.trim() === "") return { path: null, why: null };

  // WHAT IT IS SAYS HALF THE SENTENCE. `usable`'s refusals are written for
  // somebody who just picked a folder and already knows which one; here nobody
  // picked anything — the picker is about to appear on its own — so the sentence
  // has to say WHICH folder it is about before it says what was wrong with it.
  // *There is no folder there* on a screen nobody asked for names nothing at
  // all.
  const said = (why: string): BootVault => ({ path: null, why: `the workspace you had open did not open — ${why}` });

  const abs = resolve(remembered.trim());
  try {
    await usable(abs);
  } catch (e) {
    return said(e instanceof Error ? e.message : "that folder could not be opened");
  }
  if (!seeded(abs)) {
    // A folder that IS there and is no longer a workspace. Seeding it would be
    // this process deciding, on its own, that an emptied folder wants a fresh
    // workspace in it — which is the same act as recreating a deleted one.
    return said("that folder no longer holds one");
  }
  return { path: abs, why: null };
}

/* ── making one ─────────────────────────────────────────────────────────── */

/** WHY A PARENT AND A NAME RATHER THAN A PATH. Sending the joined path would put
 *  the join in the caller and the validation here, which is how a name carrying
 *  a separator becomes a folder somewhere else entirely. Sent apart, the join is
 *  done once, here, and a name is a name on both sides.
 *
 *  A folder name and NOTHING ELSE: no separator of either kind, not `.` or `..`,
 *  no leading dot, no NUL and no control character. The leading dot is refused
 *  because `browse` hides dot-directories — a workspace made there would be
 *  invisible in the one screen that lists workspaces. */
export function checkName(name: unknown): string {
  if (typeof name !== "string" || name.trim() === "") {
    throw bad("bad_request", "a workspace needs a name — type one");
  }
  const trimmed = name.trim();
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw bad("bad_request", "that is a name, not a path — a workspace is made inside the folder above");
  }
  if (trimmed === "." || trimmed === "..") {
    throw bad("bad_request", "that is not a name a folder can have");
  }
  if (trimmed.startsWith(".")) {
    throw bad("bad_request", "a name starting with a dot is hidden — the picker would never show it again");
  }
  // A NUL truncates the path at the system call, so what is checked and what is
  // created would be two different paths. The other control characters are
  // refused with it rather than one at a time: none of them is a name anybody
  // meant to type.
  if (/[\u0000-\u001f]/.test(trimmed)) throw bad("bad_request", "that is not a name a folder can have");
  return trimmed;
}

/** THE ANCESTOR WALK. The first workspace at or above `abs`, or null.
 *
 *  A VAULT MUST NEVER START INSIDE ANOTHER VAULT AT ANY DEPTH, and a parent-only
 *  check never was enough: `<vault>/pages/home/children/Notes` has a parent that
 *  is not a workspace and is four levels inside one. A person who made that
 *  folder in a file manager and picked it here would be handed a workspace nested
 *  in the middle of another workspace's page tree — two databases, two mirrors
 *  and two git repositories over one set of files.
 *
 *  It walks by `dirname` and stops where `browse`'s own `up` link stops:
 *  `dirname(abs) === abs` is the filesystem root, so a vault sitting AT the root
 *  is found and the walk ends rather than looping.
 *
 *  Synchronous, cheap and bounded by the depth of the path — which is what
 *  `seeded` was written to be. A directory that cannot be read answers no, like
 *  any other directory with no `pages/` in it: refusing to create because a
 *  folder somewhere above is unreadable would refuse for a reason the person can
 *  do nothing about.
 *
 *  WHAT IT DOES NOT DO is refuse a parent that merely CONTAINS a workspace. A
 *  folder with three of them in it is the ordinary case — it is what Recent is a
 *  list of — and the rule is about ancestry, not siblings. */
export function ancestorVault(abs: string): string | null {
  let at = resolve(abs);
  for (;;) {
    if (seeded(at)) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/** Where `<parent>/<name>` would go, or a refusal saying why it cannot.
 *
 *  NOTHING IS WRITTEN BY THIS. It is the whole of the decision and none of the
 *  act, which is what lets the picker ask it as the name is typed and the create
 *  kind ask it again a moment later — the picker's listing is always a moment
 *  old, so the second ask is the one that counts.
 *
 *  THE REFUSALS NAME THE ANCESTOR, which is the one exception to this file's rule
 *  that a message carries no path. Everywhere else the caller already knows what
 *  it asked for; here it does not — the whole point of the walk is that the
 *  workspace it found is somewhere the person did not look. */
export async function creatable(parent: unknown, name: unknown): Promise<string> {
  const wanted = checkName(name);
  const above = await check(parent);

  const ancestor = ancestorVault(above);
  if (ancestor !== null) {
    throw bad(
      "bad_request",
      `that folder is inside the workspace at ${ancestor} — a workspace cannot hold another one`,
    );
  }

  const abs = join(above, wanted);
  let entry: { isDirectory(): boolean };
  try {
    entry = await stat(abs);
  } catch {
    // NOTHING IS THERE, which is the one answer Create is for.
    return abs;
  }
  if (!entry.isDirectory()) throw bad("bad_request", "there is already a file with that name");
  if (seeded(abs)) {
    throw bad("bad_request", "there is already a workspace with that name — open it instead of creating it");
  }
  let held: string[];
  try {
    held = await readdir(abs);
  } catch {
    throw bad("bad_request", "there is already a folder with that name, and it cannot be read");
  }
  // `openable`'s rule and its argument, said BEFORE the folder is made rather
  // than after: a folder with anything at all in it belongs to whoever put that
  // there. A dotfile counts.
  if (held.length > 0) throw bad("bad_request", "there is already a folder with that name, and it is not empty");
  // An EMPTY folder is the friendly-looking case and is still refused. Creating a
  // folder that exists is not what the button says, and the way in is Open.
  throw bad("bad_request", "there is already an empty folder with that name — open it instead of creating it");
}

/** MAKE IT, and hand back the absolute path so the caller can open it.
 *
 *  Every refusal happens before a single byte is written, which is why the check
 *  is a function of its own above. What happens after is the ordinary open path:
 *  the composition root mounts the folder, `initVault` makes the repo and the
 *  seeder fills it. Nothing about a newly created folder is special once it
 *  exists — which is the property worth having, because it means Create shares
 *  every line of behaviour with Open rather than being a second way in.
 *
 *  THE WRITE ITSELF STILL REFUSES, and it has to say so in this file's own
 *  vocabulary. `creatable` answers every question that can be answered by
 *  looking, and the ones left are the ones only the filesystem knows: a parent
 *  that is read-only (EACCES), a name the volume will not take however ordinary
 *  it looked (ENAMETOOLONG, and a Windows-reserved word or trailing dot, which
 *  arrives as EINVAL), a full disk (ENOSPC). Unguarded, each of those left here
 *  as node's own error carrying an ERRNO — which is not one of the contract's
 *  closed codes, so `codeOf` in the API layer drops it and answers `internal`: a
 *  five-hundred for a folder the person could have renamed, or put somewhere
 *  they can write. One sentence, refused the way everything else here is. */
export async function createVault(parent: unknown, name: unknown): Promise<string> {
  const abs = await creatable(parent, name);
  try {
    await mkdir(abs);
  } catch {
    // No path, no errno, like every other message here: the caller already knows
    // what it asked for, and a message is a leak channel. What it does carry is
    // the two things the person can act on — the name and the folder above it.
    throw bad("bad_request", "that folder could not be made — check the name, and that the folder above it can be written to");
  }
  return abs;
}

/** What the UI shows for a folder. The name is the folder's own — a vault has no
 *  name of its own, because the folder IS the workspace. */
export function infoOf(path: string): VaultInfo {
  const abs = resolve(path);
  // WHETHER UNDO EXISTS, read off disk every time rather than remembered from
  // the mount. `git init` can fail on a machine with no git, and git can arrive
  // later — the answer is `.git` being there now, which is the same check
  // `commit()` and `initVault()` turn on and must never diverge from.
  return { path: abs, name: basename(abs) || abs, seeded: seeded(abs), history: hasHistory(abs) };
}

/** Absolute, existing, a directory, and readable — in that order, because each
 *  answer is a different sentence for the person who picked it.
 *
 *  A path that does not exist is refused rather than created: browsing only ever
 *  offers folders that are there, so a missing one means something moved under
 *  the picker. The composition root creates the DEFAULT vault on boot, which is
 *  a different thing entirely from opening one somebody chose. */
export async function check(path: unknown): Promise<string> {
  if (typeof path !== "string" || path.trim() === "") {
    throw bad("bad_request", "a workspace is a folder, and none was named");
  }
  // A NUL truncates the path at the system call, so what is checked and what is
  // opened would be two different paths.
  if (path.includes("\u0000")) throw bad("bad_request", "that is not a folder path");

  const abs = resolve(path.trim());
  let entry: { isDirectory(): boolean };
  try {
    entry = await stat(abs);
  } catch {
    throw bad("not_found", "there is no folder there");
  }
  if (!entry.isDirectory()) throw bad("bad_request", "that is a file, not a folder");
  try {
    await readdir(abs);
  } catch {
    throw bad("bad_request", "that folder cannot be read");
  }
  return abs;
}

/** One level of the filesystem, folders only. Files are not shown because a
 *  workspace is never a file, and a picker showing them would be a file browser
 *  wearing a workspace's clothes.
 *
 *  Dot-directories are hidden: `.git`, `.cache` and their neighbours are
 *  machinery, and one of them is the vault's own history. */
export async function browse(at: unknown): Promise<DirListing> {
  const abs = await check(at);

  let entries: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[];
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    // Checked as readable a moment ago; a folder that stopped being readable
    // between the two is an empty listing rather than a failure.
    entries = [];
  }

  const dirs: DirEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(abs, entry.name);
    // A symlink to a directory is a directory as far as a person picking one is
    // concerned — home directories on a second volume are usually exactly that.
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink()) continue;
      try {
        if (!(await stat(path)).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    dirs.push({ name: entry.name, path, vault: seeded(path) });
  }
  // Stable and case-insensitive, because the same folder must not move between
  // two openings of the same picker.
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.name < b.name ? -1 : 1));

  const up = dirname(abs);
  return { at: abs, up: up === abs ? null : up, dirs };
}

/** The vaults opened before, most recent first — and the last one opened, which
 *  is simply the head of that list. One list rather than a list and a pointer:
 *  two fields that must agree is a state that can disagree. */
export interface VaultMemory {
  /** The vault to open on boot when nothing else says otherwise. */
  last(): Promise<string | null>;
  /** Most recent first, and only the ones still on disk. */
  recent(): Promise<VaultInfo[]>;
  /** Move `path` to the head. Never throws: failing to remember which folder you
   *  opened must not stop you opening it. */
  remember(path: string): Promise<void>;
}

/** Persisted in one small JSON file in this machine's DATA DIRECTORY (see
 *  `memoryFile`), never inside a vault and never beside the install — it is about
 *  vaults, so it cannot live in one, and it is this machine's rather than the
 *  install's, so it cannot live next to the program either. It is not workspace
 *  state and it is not in git: it is the answer to "where were we". */
export function makeVaultMemory(file: string): VaultMemory {
  /** SAID ONCE PER PROCESS, not once per read. `last()` and `recent()` both read
   *  this file on the way up, so a list that will not parse used to print the
   *  same line twice before the server had said anything else — which reads as
   *  two faults rather than one, on the screen where somebody is deciding
   *  whether the program is broken. */
  let complained = false;

  async function read(): Promise<string[]> {
    let text: string;
    try {
      // NOT THERE IS THE ORDINARY STATE. It is written the first time a folder
      // is opened, so a first launch has no file and that is not a fault.
      text = await readFile(file, "utf8");
    } catch {
      return [];
    }
    // AN EMPTY FILE IS AN EMPTY LIST AND NOT A BROKEN ONE. It is what a crash
    // between `open` and `write` leaves behind, and it used to be reported as a
    // parse failure — a sentence claiming damage where there is nothing but an
    // absence, about a file nobody using this has ever seen.
    if (text.trim() === "") return [];
    try {
      const doc = JSON.parse(text) as { recent?: unknown };
      if (!Array.isArray(doc.recent)) return [];
      return doc.recent.filter((p): p is string => typeof p === "string" && p !== "");
    } catch {
      // Hand-edited into invalid JSON, or truncated in the middle of a write.
      // Either way it is a forgotten list rather than a framework that will not
      // start — and it is NOT rewritten here: the next `remember` replaces it,
      // and until then whatever somebody was in the middle of is still on disk.
      if (!complained) {
        complained = true;
        console.warn("vault: the remembered list did not parse — starting a new one");
      }
      return [];
    }
  }

  return {
    async last() {
      const [first] = await read();
      return first ?? null;
    },

    async recent() {
      // Filtered on read rather than pruned on write: a vault on a volume that
      // is not mounted right now has not been forgotten, it is just not there.
      return (await read()).filter((p) => existsSync(p)).map(infoOf);
    },

    async remember(path: string) {
      const abs = resolve(path);
      const next = [abs, ...(await read()).filter((p) => p !== abs)].slice(0, REMEMBER);
      try {
        // The data directory does not exist until something is written into it,
        // and this is usually the first thing there is. Made here rather than on
        // boot so a run that never remembers anything leaves no folder behind.
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ recent: next }, null, 2) + "\n", "utf8");
      } catch (e) {
        console.warn(`vault: the choice could not be remembered: ${String(e)}`);
      }
    },
  };
}
