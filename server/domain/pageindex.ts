// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE PAGE INDEX: every page's head, kept on disk and trusted only
// while a stat agrees, so nothing on the path to what is on screen has to read
// or parse every page. The server half of the twelfth contracts edit.
//
// WHY IT EXISTS. On a workspace of two thousand pages, READING every document
// is about fifty milliseconds and PARSING them is well over a second — and a
// level of the tree, a page's identity, a search and a link used to be answered
// by parsing every page, some of them several times over. So this answers them
// from HEADS:
//
//   - A PAGE'S HEAD: the first `HEAD_BYTES` of its `content.yaml`
//     (`DiskFiles.head`), read by `headOf` in `platform/yaml.ts` — the one head
//     parser, which takes the column-0 `name:`, `uid:` and `plugin:` lines and
//     parses those alone — and ONE full parse of that one document wherever the
//     head cannot say. A document that will not parse at all is named by its
//     segment, as the tolerant listing names it.
//   - KEPT IN `.biom/pages.db` (the `db` handed in): a cache in the framework's
//     own ignored folder, never the truth and never committed. Any fault in it
//     — corrupt, locked, from a newer build — is answered by dropping it and
//     starting again.
//   - TRUSTED ONLY WHILE A STAT AGREES: every use that decides something stats
//     the file (`DiskFiles.stat`) and compares inode, size and modification
//     time; a row whose file is gone goes, with every row under its folder.
//   - FILLED LAZILY by everything that touches a page, and SWEPT once after
//     mount off every critical path — readdir and stat of every page folder, a
//     head read only where the stat moved, yielding while it goes because the
//     server has one thread. Nothing on a critical path waits on the sweep but a
//     `uid` it has never seen (bounded at `UNSEEN_MS`) and a search's
//     `complete`.
//   - A LEVEL from the folder listing and the heads, never from a parse of a
//     child: ordered by id and then by the parent's own `contents` — one parse
//     of the parent per level, kept by the parent's stat — with each page's
//     `uid`, `children` and `created`, and the tables whose parent it is. A
//     table whose parent page is gone is listed under the root.
//   - NEVER EVERY PAGE IN MEMORY: SQLite holds the rows, and a question reads
//     the rows it needs.
//
// THE FOLDER IS THE HIERARCHY, spelled here a third time for the reason
// `history.ts` and `mirror.ts` spell it: `pages.ts` is a sibling and may not
// be imported. `tests/pageindex.test.ts` holds `dirOfPage` equal to `pageDir`.

import type { Child, Db, PageId, PageRef, PageSearch, YamlCodec } from "../../contracts/types.ts";
import { ROOT_PAGE, parentOf, segmentOf } from "../../contracts/types.ts";
import { DESIGN_PAGE, foldId } from "../../contracts/wire.js";
import { headOf } from "../platform/yaml.ts";
import type { DiskFiles, FileStat } from "../platform/files.ts";

/** How much of a document is its head, in bytes. */
export const HEAD_BYTES = 4096;

/** How long a `uid` the index has never seen may wait for the sweep, in ms,
 *  before it is answered absent. */
export const UNSEEN_MS = 2000;

/** How long the sweep works before it lets the rest of the server run, in ms. */
const SLICE_MS = 8;

/** The version of the table's shape. A file from another build is dropped and
 *  built again rather than read. */
const SCHEMA = "1";

/** One page's head, as the index keeps it. */
export interface PageHead {
  id: PageId;
  /** Vault-relative: `pages/home/children/Specs`. */
  dir: string;
  name: string;
  uid: string | null;
  plugin: string | null;
  /** When the page's FOLDER was made — its birth time where the filesystem
   *  records one, else its modification time — as `Child.created` has always
   *  read it. */
  bornMs: number;
  /** Whether the page's `children/` holds a page. */
  children: boolean;
}

/** What the index learned that other modules act on:
 *  - `noUid`: pages it found with no `uid` — arrived with none, or written
 *    since without the one they had — for the identities to give one;
 *  - `moved`: a `uid` that left one folder and turned up at another, which
 *    runs follow;
 *  - `gone`: pages whose folder went and did not turn up anywhere else. */
export interface IndexNews {
  noUid: PageId[];
  moved: { uid: string; from: PageId; to: PageId }[];
  gone: PageId[];
}

/** What the index is handed. The composition root opens the database and
 *  builds a `DiskFiles` with NO baseline — `makeFiles(root)`, never the
 *  vault's own — so nothing the index reads silences the watcher. */
export interface PageIndexDeps {
  db: Db;
  disk: DiskFiles;
  yaml: YamlCodec;
  /** The tables, as the registry lists them — a sibling module's, so a
   *  function the root closes over. */
  tables: () => readonly TableAt[];
  now: () => number;
  /** A FRESH DATABASE WHERE THE FILE WAS: the root closes the handle, deletes
   *  the file and opens it again. A file that is not a database at all fails
   *  every statement, dropping its tables included, so this is the only way
   *  back from one. Absent, the tables are dropped and made again, and where
   *  even that fails the index carries on with no cache — every answer read
   *  off the disk, correct and slower. */
  reset?: () => Db;
}

/** A table, as a level needs it. */
export interface TableAt {
  name: string;
  rows: number;
  parent: PageId | null;
}

/** What a caller of `level` may already hold. */
export interface LevelGiven {
  order?: readonly string[];
  tables?: readonly TableAt[];
}

export interface PageIndex {
  /** One page's children, ordered, each page with its `uid`, `children` and
   *  `created`, and the tables it holds. Empty for a page that is not there.
   *  `given.order` is the parent's own `contents` names where the caller has
   *  just parsed them, so the level costs no parse at all; `given.tables` the
   *  registry's list where the caller already asked it, so a request asks it
   *  once however many levels it lists. */
  level(id: PageId, given?: LevelGiven): Promise<Child[]>;
  /** One page's head, or null where there is no page. */
  head(id: PageId): Promise<PageHead | null>;
  /** The pages these ids and uids name — what `page.locate` answers. Every
   *  current holder of a `uid`; a `uid` not found waits for the sweep, bounded
   *  at `UNSEEN_MS`. */
  locate(q: { ids?: PageId[]; uids?: string[] }): Promise<PageRef[]>;
  /** The pages holding this `uid` now, off the rows and their stats, WITHOUT
   *  waiting for anything — for a question on the history's path. */
  holders(uid: string): Promise<PageId[]>;
  /** The `uid` this page's folder last carried, as the index last read it —
   *  whatever its document says now. What a page written whole without its
   *  `uid` is given back. */
  uidWas(id: PageId): Promise<string | null>;
  /** Pages by name, ranked and bounded — what `page.search` answers. */
  search(query: string, limit: number): Promise<PageSearch>;
  /** What a `[[wikilink]]` names, unambiguously, or null: the id exactly, the
   *  id folded, the id's tail, the page's name — the four tries the bridge
   *  used to make over a full list in the window. */
  resolveLink(target: string): Promise<{ kind: "page"; id: PageId } | null>;
  /** Every page, depth first, parents before their children, siblings by id —
   *  for `page.list`, `doc.list` and `children.all`, which no screen asks.
   *  From the rows, after a sweep; never from a parse. */
  list(): Promise<PageRef[]>;
  /** The watcher's settle: these vault-relative paths changed. Re-read their
   *  pages' heads, drop what departed, index what arrived. */
  invalidate(rels: readonly string[]): Promise<IndexNews>;
  /** The app moved or renamed a page: its rows and everything under it, by
   *  prefix, in one transaction. */
  moved(from: PageId, to: PageId): void;
  /** The background pass: every folder, every stat, a head only where the stat
   *  moved. Resolves when it is done; a second call while one runs joins it. */
  sweep(): Promise<IndexNews>;
  /** Whether a sweep has finished since the index was opened. */
  swept(): boolean;
  close(): void;
}

/* ── the folder is the hierarchy ──────────────────────────────────────── */

const PAGES_DIR = "pages";
const CHILDREN = "children";
const DOC = "content.yaml";
/** One segment of a page id, as `pages.ts` writes them. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** The depth `pages.ts` refuses past. */
const DEPTH = 12;

/** A page's folder, vault-relative, or null for an id that names no folder in
 *  the tree — a reserved screen, the design doc, or an id off the grammar. */
export function dirOfPage(id: PageId): string | null {
  if (typeof id !== "string" || id === "" || id.startsWith("@")) return null;
  const parts = id.split("/");
  if (parts.length > DEPTH || !parts.every((p) => SEGMENT.test(p))) return null;
  return `${PAGES_DIR}/${parts.join(`/${CHILDREN}/`)}`;
}

/** A vault-relative path's page: the deepest page folder the path is in, by
 *  the format's rule — `pages/<a>/children/<b>/…` is `a/b` — and what is left
 *  below it. Null for a path outside `pages/<a>`. */
export function pageOfPath(rel: string): { id: PageId; dir: string; rest: string } | null {
  const parts = rel.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts[0] !== PAGES_DIR) return null;
  const head = parts[1];
  if (head === undefined || !SEGMENT.test(head)) return null;
  const ids = [head];
  let at = 2;
  for (;;) {
    const next = parts[at + 1];
    if (parts[at] !== CHILDREN || next === undefined || !SEGMENT.test(next) || ids.length >= DEPTH) break;
    ids.push(next);
    at += 2;
  }
  return { id: ids.join("/"), dir: parts.slice(0, at).join("/"), rest: parts.slice(at).join("/") };
}

/** A folder name under `children/` that may be a page: the grammar, and not
 *  a name `pages.ts` passes over. */
const candidate = (name: string): boolean => SEGMENT.test(name) && !name.startsWith("_") && !name.startsWith(".");

/* ── the rows ─────────────────────────────────────────────────────────── */

interface Row {
  dir: string;
  id: string;
  parent: string | null;
  uid: string | null;
  /** The last `uid` this folder carried, kept when its document loses it. */
  was: string | null;
  name: string;
  plugin: string | null;
  ino: number;
  size: number;
  mtime: number;
  born: number;
  /** The page's own `contents` names, as JSON, while the stat holds. */
  order_json: string | null;
}

const COLUMNS = "dir, id, parent, uid, was, name, plugin, ino, size, mtime, born, order_json";

const same = (row: Row, st: FileStat): boolean => row.ino === st.ino && row.size === st.size && row.mtime === st.mtimeMs;

/** `%`, `_` and the escape itself, taken literally in a LIKE. */
const likeText = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A macrotask: timers and requests waiting on the loop run before it resolves. */
const yieldNow = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

export function makePageIndex(deps: PageIndexDeps): PageIndex {
  const { disk, yaml } = deps;
  let db: Db = deps.db;
  /** The cache could not be made to work: every answer is read off the disk. */
  let off = false;
  let sweptOnce = false;
  let running: Promise<IndexNews> | null = null;

  const create = (): void => {
    try {
      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA synchronous = NORMAL");
    } catch {
      // A cache that cannot change its journal still works.
    }
    db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const had = db.all<{ value: string }>("SELECT value FROM meta WHERE key = 'schema'")[0]?.value;
    if (had !== undefined && had !== SCHEMA) db.run("DROP TABLE IF EXISTS pages");
    db.run(
      "CREATE TABLE IF NOT EXISTS pages (dir TEXT PRIMARY KEY, id TEXT NOT NULL, parent TEXT, uid TEXT, was TEXT, " +
        "name TEXT NOT NULL, lname TEXT NOT NULL, lid TEXT NOT NULL, plugin TEXT, ino REAL NOT NULL, size INTEGER NOT NULL, " +
        "mtime REAL NOT NULL, born REAL NOT NULL, order_json TEXT)",
    );
    db.run("CREATE INDEX IF NOT EXISTS pages_uid ON pages(uid)");
    db.run("CREATE INDEX IF NOT EXISTS pages_parent ON pages(parent)");
    db.run("CREATE INDEX IF NOT EXISTS pages_lname ON pages(lname)");
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)", [SCHEMA]);
  };

  /** START AGAIN: a fresh file where the root can give one, the tables dropped
   *  and made again where it cannot, and no cache at all where neither works. */
  const rebuild = (): void => {
    if (deps.reset !== undefined) {
      try {
        db = deps.reset();
        create();
        return;
      } catch {
        // Fall through to the tables.
      }
    }
    try {
      db.run("DROP TABLE IF EXISTS pages");
      db.run("DROP TABLE IF EXISTS meta");
      create();
    } catch {
      off = true;
    }
  };

  /** Every use of the database, and what a failed one answers. One fault is
   *  one rebuild and one more try; the second fault is the fallback. */
  function guard<T>(use: () => T, fallback: T): T {
    if (off) return fallback;
    try {
      return use();
    } catch {
      rebuild();
      if (off) return fallback;
      try {
        return use();
      } catch {
        off = true;
        return fallback;
      }
    }
  }

  try {
    create();
  } catch {
    rebuild();
  }

  const rowAt = (dir: string): Row | null =>
    guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE dir = ?`, [dir])[0] ?? null, null);

  const put = (row: Row): void => {
    guard(() => {
      db.run(
        "INSERT OR REPLACE INTO pages (dir, id, parent, uid, was, name, lname, lid, plugin, ino, size, mtime, born, order_json) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [row.dir, row.id, row.parent, row.uid, row.was, row.name, row.name.toLowerCase(), foldId(row.id), row.plugin,
          row.ino, row.size, row.mtime, row.born, row.order_json],
      );
    }, undefined);
  };

  /** The rows at and under a folder. */
  const rowsUnder = (dir: string): Row[] =>
    guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE dir = ? OR dir LIKE ? ESCAPE '\\'`, [dir, `${likeText(dir)}/%`]), []);

  const dropUnder = (dir: string): void => {
    guard(() => {
      db.run("DELETE FROM pages WHERE dir = ? OR dir LIKE ? ESCAPE '\\'", [dir, `${likeText(dir)}/%`]);
    }, undefined);
  };

  /* ── reading a head off the disk ───────────────────────────────────── */

  /** What one document says of itself: its head, and its `contents` order
   *  where it had to be parsed whole anyway. */
  interface Said {
    name: string;
    uid: string | null;
    plugin: string | null;
    order: string[] | null;
  }

  /** The whole document, parsed once: its head and its order. A document that
   *  will not parse is named by its segment and has no say in the order. */
  const parsed = (id: PageId, text: string): Said => {
    try {
      const doc = yaml.parse(text);
      return {
        name: doc.name !== "" ? doc.name : segmentOf(id),
        uid: typeof doc.uid === "string" ? doc.uid : null,
        plugin: doc.plugin,
        order: doc.contents.map((c) => c.name),
      };
    } catch {
      return { name: segmentOf(id), uid: null, plugin: null, order: [] };
    }
  };

  /** THE HEAD, and the one full parse where the head cannot say. A head cut off
   *  at `HEAD_BYTES` loses its last, partial line — the one a character may be
   *  cut in half on. Null where the document has gone. */
  const readSaid = async (id: PageId, dir: string, st: FileStat): Promise<Said | null> => {
    const raw = await disk.head(`${dir}/${DOC}`, HEAD_BYTES);
    if (raw === null) return null;
    const cut = st.size > HEAD_BYTES || Buffer.byteLength(raw, "utf8") >= HEAD_BYTES;
    const text = cut ? raw.slice(0, raw.lastIndexOf("\n") + 1) : raw;
    const head = headOf(text);
    if (head !== null) return { name: head.name ?? segmentOf(id), uid: head.uid, plugin: head.plugin, order: null };
    const whole = await disk.read(`${dir}/${DOC}`);
    return whole === null ? null : parsed(id, whole);
  };

  /** Write what was read into a row, stamped with the stat taken BEFORE the
   *  read: a file changed since then fails the stat on its next use and is read
   *  again, so the row can be stale but never trusted stale. */
  const record = async (id: PageId, dir: string, st: FileStat, said: Said, had: Row | null): Promise<Row> => {
    const folder = await disk.stat(dir);
    const row: Row = {
      dir,
      id,
      parent: parentOf(id),
      uid: said.uid,
      was: said.uid ?? had?.uid ?? had?.was ?? null,
      name: said.name,
      plugin: said.plugin,
      ino: st.ino,
      size: st.size,
      mtime: st.mtimeMs,
      born: folder?.bornMs ?? st.bornMs,
      order_json: said.order === null ? null : JSON.stringify(said.order),
    };
    put(row);
    return row;
  };

  /** THE CURRENT HEAD OF ONE PAGE: its row where the stat agrees, read again
   *  where it does not, and nothing — its rows and everything under it gone —
   *  where there is no `content.yaml`. `fresh` says whether the row was just
   *  written, and `had` what the row said before. */
  const current = async (id: PageId, dir: string): Promise<{ row: Row; fresh: boolean; had: Row | null } | null> => {
    const st = await disk.stat(`${dir}/${DOC}`);
    const had = rowAt(dir);
    if (st === null || st.dir) {
      if (had !== null) dropUnder(dir);
      return null;
    }
    if (had !== null && same(had, st)) return { row: had, fresh: false, had };
    const said = await readSaid(id, dir, st);
    if (said === null) {
      dropUnder(dir);
      return null;
    }
    return { row: await record(id, dir, st, said, had), fresh: true, had };
  };

  /** THE FOLDERS UNDER A PAGE'S `children/` THAT MAY BE PAGES, by name. The
   *  page's own folder is listed first: most pages are leaves with no
   *  `children/` at all, and listing a folder that is there is half the price
   *  of failing to list one that is not. */
  const candidates = async (dir: string): Promise<string[]> => {
    if (!(await disk.list(dir)).some((e) => e.dir && e.name === CHILDREN)) return [];
    return (await disk.list(`${dir}/${CHILDREN}`)).filter((e) => e.dir && candidate(e.name)).map((e) => e.name);
  };

  /** Does this page's `children/` hold a page? Its listing, and a stat of each
   *  candidate until one holds a document — nearly always the first. */
  const holdsPages = async (dir: string): Promise<boolean> => {
    for (const name of await candidates(dir)) {
      const st = await disk.stat(`${dir}/${CHILDREN}/${name}/${DOC}`);
      if (st !== null && !st.dir) return true;
    }
    return false;
  };

  /** A page's own `contents` names: off its row while the stat holds, else ONE
   *  parse of the document, kept with the stat it was read under. */
  const orderOf = async (id: PageId, dir: string): Promise<string[]> => {
    const st = await disk.stat(`${dir}/${DOC}`);
    if (st === null || st.dir) return [];
    const had = rowAt(dir);
    if (had !== null && same(had, st) && had.order_json !== null) {
      try {
        const names = JSON.parse(had.order_json) as unknown;
        if (Array.isArray(names)) return names.filter((n): n is string => typeof n === "string");
      } catch {
        // Read it again below.
      }
    }
    const text = await disk.read(`${dir}/${DOC}`);
    if (text === null) return [];
    const said = parsed(id, text);
    await record(id, dir, st, said, had);
    return said.order ?? [];
  };

  const refOf = (row: Row): PageRef => (row.uid !== null ? { id: row.id, name: row.name, uid: row.uid } : { id: row.id, name: row.name });

  /* ── a level ───────────────────────────────────────────────────────── */

  /** Does a page folding to `id` exist? A table's parent is written by hand,
   *  so its case may not be the folder's: the tree is walked a level at a time,
   *  folding each segment, and only as far as the id goes. */
  const pageFolds = async (id: PageId): Promise<boolean> => {
    const segs = id.split("/");
    if (segs.length > DEPTH || !segs.every((s) => SEGMENT.test(s))) return false;
    let dir = PAGES_DIR;
    for (let i = 0; i < segs.length; i++) {
      const want = foldId(segs[i] ?? "");
      const under = i === 0 ? dir : `${dir}/${CHILDREN}`;
      const hit = (await disk.list(under)).find((e) => e.dir && foldId(e.name) === want);
      if (hit === undefined) return false;
      dir = `${under}/${hit.name}`;
    }
    const st = await disk.stat(`${dir}/${DOC}`);
    return st !== null && !st.dir;
  };

  const level = async (id: PageId, given: LevelGiven = {}): Promise<Child[]> => {
    const dir = dirOfPage(id);
    if (dir === null) return [];
    const kids: Child[] = [];
    const here = new Set<string>();
    for (const name of await candidates(dir)) {
      const childId = `${id}/${name}`;
      const childDir = `${dir}/${CHILDREN}/${name}`;
      const got = await current(childId, childDir);
      if (got === null) continue;
      here.add(childDir);
      const child: Child = { kind: "page", id: childId, name: got.row.name };
      if (Number.isFinite(got.row.born) && got.row.born > 0) child.created = new Date(got.row.born).toISOString();
      if (got.row.uid !== null) child.uid = got.row.uid;
      child.children = await holdsPages(childDir);
      kids.push(child);
    }
    // Rows of children that are no longer there, and everything under them.
    for (const row of guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE parent = ?`, [id]), [])) {
      if (!here.has(row.dir)) dropUnder(row.dir);
    }
    // BY ID, WHICH IS THE FOLDER'S NAME, exactly as `pages.ts` orders them.
    kids.sort((a, b) => a.id.localeCompare(b.id));

    // FOLDED, as `pages.ts` folds them: a table's parent is written by hand.
    const fold = foldId(id);
    const tables = given.tables ?? deps.tables();
    for (const t of tables) {
      const parent = t.parent ?? ROOT_PAGE;
      if (foldId(parent) === fold) kids.push({ kind: "table", id: t.name, name: t.name, rows: t.rows });
    }
    // A TABLE WHOSE PARENT PAGE IS GONE is the root's, so it is still in the
    // tree somewhere; the window used to rescue it, and now the server does.
    if (id === ROOT_PAGE) {
      for (const t of tables) {
        const parent = t.parent ?? ROOT_PAGE;
        if (foldId(parent) === fold) continue;
        if (!(await pageFolds(parent))) kids.push({ kind: "table", id: t.name, name: t.name, rows: t.rows });
      }
    }

    const names = given.order ?? (await orderOf(id, dir));
    const at = (c: Child): number => {
      const key = `@${c.kind}-${c.kind === "page" ? segmentOf(c.id) : c.id}`;
      const i = names.indexOf(key);
      return i === -1 ? names.length : i;
    };
    return kids.sort((a, b) => at(a) - at(b));
  };

  const head = async (id: PageId): Promise<PageHead | null> => {
    const dir = dirOfPage(id);
    if (dir === null) return null;
    const got = await current(id, dir);
    if (got === null) return null;
    return {
      id,
      dir,
      name: got.row.name,
      uid: got.row.uid,
      plugin: got.row.plugin,
      bornMs: got.row.born,
      children: await holdsPages(dir),
    };
  };

  /* ── the sweep ─────────────────────────────────────────────────────── */

  /** Pages that left, as their rows said, matched against the uids that turned
   *  up elsewhere: a departure whose `uid` is now at another folder is a move,
   *  and the rest are gone. */
  const settle = (left: Row[], arrived: Row[], news: IndexNews): void => {
    const byUid = new Map<string, Row>();
    for (const row of arrived) if (row.uid !== null) byUid.set(row.uid, row);
    for (const row of left) {
      const uid = row.uid ?? row.was;
      const now = uid === null ? undefined : byUid.get(uid);
      if (uid !== null && now !== undefined && now.dir !== row.dir) news.moved.push({ uid, from: row.id, to: now.id });
      else news.gone.push(row.id);
    }
  };

  /** EVERY PAGE UNDER ONE FOLDER, depth first: its stat, its head only where
   *  the stat moved, and a turn of the loop given back every `SLICE_MS`. */
  const visit = async (
    id: PageId,
    dir: string,
    seen: Set<string>,
    fresh: Row[],
    news: IndexNews,
    clock: { at: number },
  ): Promise<void> => {
    const got = await current(id, dir);
    if (got === null) return;
    seen.add(dir);
    if (got.had === null) fresh.push(got.row);
    else if (got.fresh && got.row.uid !== null && got.row.uid !== got.had.uid) fresh.push(got.row);
    if (got.row.uid === null) news.noUid.push(id);
    if (performance.now() - clock.at > SLICE_MS) {
      await yieldNow();
      clock.at = performance.now();
    }
    for (const name of await candidates(dir)) {
      await visit(`${id}/${name}`, `${dir}/${CHILDREN}/${name}`, seen, fresh, news, clock);
    }
  };

  const sweepOnce = async (): Promise<IndexNews> => {
    const news: IndexNews = { noUid: [], moved: [], gone: [] };
    const seen = new Set<string>();
    const fresh: Row[] = [];
    const before = guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages`), []);
    const rootDir = dirOfPage(ROOT_PAGE) as string;
    await visit(ROOT_PAGE, rootDir, seen, fresh, news, { at: performance.now() });
    // WHAT THE PASS DID NOT MEET is asked once more before it goes: a page made
    // behind the pass, in a folder it had already left, is still there.
    const left: Row[] = [];
    for (const row of before) {
      if (seen.has(row.dir)) continue;
      const st = await disk.stat(`${row.dir}/${DOC}`);
      if (st !== null && !st.dir) continue;
      left.push(row);
      dropUnder(row.dir);
    }
    settle(left, fresh, news);
    sweptOnce = true;
    return news;
  };

  const sweep = (): Promise<IndexNews> => {
    if (running !== null) return running;
    const run = sweepOnce().finally(() => {
      if (running === run) running = null;
    });
    running = run;
    return run;
  };

  /* ── asking by uid ─────────────────────────────────────────────────── */

  const holders = async (uid: string): Promise<PageId[]> => {
    const out: PageId[] = [];
    for (const row of guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE uid = ?`, [uid]), [])) {
      const got = await current(row.id, row.dir);
      if (got !== null && got.row.uid === uid) out.push(row.id);
    }
    return out;
  };

  const locate = async (q: { ids?: PageId[]; uids?: string[] }): Promise<PageRef[]> => {
    const out: PageRef[] = [];
    const listed = new Set<PageId>();
    const add = (row: Row): void => {
      if (listed.has(row.id)) return;
      listed.add(row.id);
      out.push(refOf(row));
    };
    for (const id of q.ids ?? []) {
      const dir = dirOfPage(id);
      if (dir === null) continue;
      const got = await current(id, dir);
      if (got !== null) add(got.row);
    }
    const found = async (uid: string): Promise<boolean> => {
      let any = false;
      for (const row of guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE uid = ?`, [uid]), [])) {
        const got = await current(row.id, row.dir);
        if (got !== null && got.row.uid === uid) {
          add(got.row);
          any = true;
        }
      }
      return any;
    };
    const unseen: string[] = [];
    for (const uid of q.uids ?? []) if (!(await found(uid))) unseen.push(uid);
    if (unseen.length > 0) {
      // A `uid` NO ROW HOLDS is a page moved or made where nothing watched, or
      // one that is gone: the sweep finds the first, bounded, and the second is
      // absent.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<void>((done) => { timer = setTimeout(done, UNSEEN_MS); });
      try {
        await Promise.race([sweep().then(() => undefined, () => undefined), late]);
      } finally {
        clearTimeout(timer);
      }
      for (const uid of unseen) await found(uid);
    }
    return out;
  };

  const uidWas = async (id: PageId): Promise<string | null> => {
    const dir = dirOfPage(id);
    if (dir === null) return null;
    const row = rowAt(dir);
    return row === null ? null : row.uid ?? row.was;
  };

  /* ── search and links ──────────────────────────────────────────────── */

  const search = async (query: string, limit: number): Promise<PageSearch> => {
    const q = query.trim().toLowerCase();
    const complete = sweptOnce;
    const bound = Math.max(1, Math.floor(limit));
    if (q === "") return { hits: [], more: false, complete };
    const like = likeText(q);
    const tierOf = (row: Row): number => {
      const name = row.name.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      return foldId(row.id).includes(q) ? 2 : 3;
    };
    const rows = guard(() => db.all<Row>(
      `SELECT ${COLUMNS} FROM pages WHERE lname LIKE ? ESCAPE '\\' OR lid LIKE ? ESCAPE '\\' ` +
        "ORDER BY CASE WHEN lname LIKE ? ESCAPE '\\' THEN 0 WHEN lname LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, lname, id LIMIT ?",
      [`%${like}%`, `%${like}%`, `${like}%`, `%${like}%`, bound + 1],
    ), []);
    const hits: { row: Row; tier: number }[] = [];
    for (const row of rows.slice(0, bound)) {
      // A HIT IS CHECKED BEFORE IT IS ANSWERED: its stat, and whether what it
      // says now still matches.
      const got = await current(row.id, row.dir);
      if (got === null) continue;
      const tier = tierOf(got.row);
      if (tier < 3) hits.push({ row: got.row, tier });
    }
    hits.sort((a, b) => a.tier - b.tier || a.row.name.toLowerCase().localeCompare(b.row.name.toLowerCase()) || a.row.id.localeCompare(b.row.id));
    return { hits: hits.map((h) => refOf(h.row)), more: rows.length > bound, complete };
  };

  const resolveLink = async (target: string): Promise<{ kind: "page"; id: PageId } | null> => {
    const want = String(target).trim().replace(/^\/+|\/+$/g, "");
    if (want === "") return null;
    const page = (id: PageId) => ({ kind: "page" as const, id });
    // The design doc is in no tree, and is named exactly or not at all.
    if (want === DESIGN_PAGE) return page(DESIGN_PAGE);
    const exact = dirOfPage(want);
    if (exact !== null && (await current(want, exact)) !== null) return page(want);

    // THE OTHER THREE ARE ONLY UNAMBIGUOUS OVER EVERY PAGE, so they wait for
    // the first sweep — once a mount, and a tenth of a second at two thousand.
    if (!sweptOnce) await sweep();
    const folded = foldId(want);
    const only = async (where: string, param: string, test: (row: Row) => boolean): Promise<{ kind: "page"; id: PageId } | null> => {
      const live: Row[] = [];
      for (const row of guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE ${where}`, [param]), [])) {
        const got = await current(row.id, row.dir);
        if (got !== null && test(got.row)) live.push(got.row);
      }
      const one = live.length === 1 ? live[0] : undefined;
      return one === undefined ? null : page(one.id);
    };
    return (await only("lid = ?", folded, (r) => foldId(r.id) === folded))
      ?? (await only("lid LIKE ? ESCAPE '\\'", `%/${likeText(folded)}`, (r) => foldId(r.id).endsWith(`/${folded}`)))
      ?? (await only("lname = ?", folded, (r) => r.name.toLowerCase() === folded));
  };

  /* ── every page ────────────────────────────────────────────────────── */

  const list = async (): Promise<PageRef[]> => {
    // A WHOLE-LIST CALL NOBODY ON SCREEN MAKES: it sweeps first — stats only,
    // where nothing changed — so the rows it answers from are current.
    await sweep();
    const rows = guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages`), []);
    const kids = new Map<string | null, Row[]>();
    for (const row of rows) {
      const under = kids.get(row.parent) ?? [];
      under.push(row);
      kids.set(row.parent, under);
    }
    const out: PageRef[] = [];
    const walk = (id: PageId): void => {
      const under = (kids.get(id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
      for (const row of under) {
        out.push(refOf(row));
        walk(row.id);
      }
    };
    const root = rows.find((r) => r.id === ROOT_PAGE);
    if (root !== undefined) out.push(refOf(root));
    walk(ROOT_PAGE);
    return out;
  };

  /* ── what the watcher saw ──────────────────────────────────────────── */

  const invalidate = async (rels: readonly string[]): Promise<IndexNews> => {
    const news: IndexNews = { noUid: [], moved: [], gone: [] };
    const pages = new Map<string, PageId>();
    const levels = new Map<string, PageId>();
    for (const rel of rels) {
      const at = pageOfPath(rel);
      if (at === null) continue;
      pages.set(at.dir, at.id);
      // A change in `children/` itself is a level: something came or went.
      if (at.rest === CHILDREN || at.rest.startsWith(`${CHILDREN}/`)) levels.set(at.dir, at.id);
    }
    const left: Row[] = [];
    const fresh: Row[] = [];
    const seen = new Set<string>();

    const look = async (id: PageId, dir: string): Promise<void> => {
      if (seen.has(dir)) return;
      const had = rowsUnder(dir);
      const got = await current(id, dir);
      if (got === null) {
        for (const row of had) left.push(row);
        return;
      }
      seen.add(dir);
      if (got.had === null) {
        // ARRIVED: the whole subtree it brought with it, and no more.
        fresh.push(got.row);
        if (got.row.uid === null) news.noUid.push(id);
        const clock = { at: performance.now() };
        for (const name of await candidates(dir)) await visit(`${id}/${name}`, `${dir}/${CHILDREN}/${name}`, seen, fresh, news, clock);
        return;
      }
      if (got.fresh) {
        if (got.row.uid === null) news.noUid.push(id);
        else if (got.row.uid !== got.had.uid) fresh.push(got.row);
      }
    };

    for (const [dir, id] of pages) await look(id, dir);
    for (const [dir, id] of levels) {
      const there = new Set<string>();
      for (const name of await candidates(dir)) {
        const childDir = `${dir}/${CHILDREN}/${name}`;
        there.add(childDir);
        await look(`${id}/${name}`, childDir);
      }
      for (const row of guard(() => db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE parent = ?`, [id]), [])) {
        if (there.has(row.dir) || seen.has(row.dir)) continue;
        const st = await disk.stat(`${row.dir}/${DOC}`);
        if (st !== null && !st.dir) continue;
        for (const r of rowsUnder(row.dir)) left.push(r);
        dropUnder(row.dir);
      }
    }
    settle(left, fresh, news);
    return news;
  };

  const moved = (from: PageId, to: PageId): void => {
    if (dirOfPage(from) === null || dirOfPage(to) === null) return;
    guard(() => db.tx(() => {
      const rows = db.all<Row>(`SELECT ${COLUMNS} FROM pages WHERE id = ? OR id LIKE ? ESCAPE '\\'`, [from, `${likeText(from)}/%`]);
      for (const row of rows) {
        const id = `${to}${row.id.slice(from.length)}`;
        const dir = dirOfPage(id);
        if (dir === null) continue;
        db.run("DELETE FROM pages WHERE dir = ?", [dir]);
        db.run("UPDATE pages SET dir = ?, id = ?, lid = ?, parent = ? WHERE dir = ?", [dir, id, foldId(id), parentOf(id), row.dir]);
      }
    }), undefined);
  };

  return {
    level,
    head,
    locate,
    holders,
    uidWas,
    search,
    resolveLink,
    list,
    invalidate,
    moved,
    sweep,
    swept: () => sweptOnce,
    close() {
      try {
        db.close();
      } catch {
        // Closed already.
      }
    },
  };
}
