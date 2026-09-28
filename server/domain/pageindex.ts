// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE PAGE INDEX: every page's head, kept on disk and trusted only
// while a stat agrees, so nothing on the path to what is on screen has to read
// or parse every page. The twelfth contracts edit's server half (the SCALE
// design, 2026-09-28).
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; track SC-S1 builds it, and may reshape
// anything here nothing else has started to call. What it owes:
//
//   - A PAGE'S HEAD: the first 4 KB of its `content.yaml` (`DiskFiles.head`),
//     its top-level `name:`, `uid:` and `plugin:` lines — column 0 only, so
//     nothing nested matches — parsed as those lines alone with the real YAML
//     codec, so quoting is right; and ONE full parse of that one document
//     wherever the head cannot say: no `name:` in it, a block scalar, an anchor,
//     a head that will not parse. A document that will not parse at all is
//     named by its segment, as the tolerant listing names it today.
//   - KEPT IN `.biom/pages.db` (the `db` handed in): a cache in the framework's
//     own ignored folder, never the truth and never committed. Any fault in it
//     — corrupt, locked, from a newer build — is answered by dropping it and
//     starting again.
//   - TRUSTED ONLY WHILE A STAT AGREES: every use that decides something stats
//     the file (`DiskFiles.stat`) and compares inode, size and modification
//     time; a row whose file is gone goes, with every row under its folder.
//   - FILLED LAZILY by everything that touches a page, and SWEPT once after
//     mount off every critical path — readdir and stat of every page folder, a
//     head read only where the stat moved, yielding between folders because the
//     server has one thread. Nothing on a critical path waits on the sweep but a
//     uid it has never seen (bounded at `UNSEEN_MS`) and a search's `complete`.
//   - A LEVEL from the folder listing and the heads, never from a parse of a
//     child: ordered by id and then by the parent's own `contents` — one parse
//     of the parent per level, kept by the parent's stat — with each page's
//     `uid`, `children` (does its `children/` hold a page) and `created`, and
//     the tables whose parent it is. A table whose parent page is gone is listed
//     under the root.
//   - NEVER EVERY PAGE IN MEMORY: SQLite holds the rows, and a question reads
//     the rows it needs.

import type { Child, Db, PageId, PageRef, PageSearch, YamlCodec } from "../../contracts/types.ts";
import type { DiskFiles } from "../platform/files.ts";

/** How much of a document is its head, in bytes. */
export const HEAD_BYTES = 4096;

/** How long a `uid` the index has never seen may wait for the sweep, in ms,
 *  before it is answered absent. */
export const UNSEEN_MS = 2000;

/** One page's head, as the index keeps it. */
export interface PageHead {
  id: PageId;
  /** Vault-relative: `pages/home/children/Specs`. */
  dir: string;
  name: string;
  uid: string | null;
  plugin: string | null;
  /** Birth time where the filesystem records one, else modification time. */
  bornMs: number;
  /** Whether the page's `children/` holds a page. */
  children: boolean;
}

/** What the index learned that other modules act on: a page that arrived with
 *  no identity (to be given one), a `uid` whose folder changed (runs follow
 *  it), and folders that went. */
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
  tables: () => readonly { name: string; rows: number; parent: PageId | null }[];
  now: () => number;
}

export interface PageIndex {
  /** One page's children, ordered, each page with its `uid`, `children` and
   *  `created`, and the tables it holds. Empty for a page that is not there. */
  level(id: PageId): Promise<Child[]>;
  /** One page's head, or null where there is no page. */
  head(id: PageId): Promise<PageHead | null>;
  /** The pages these ids and uids name — what `page.locate` answers. */
  locate(q: { ids?: PageId[]; uids?: string[] }): Promise<PageRef[]>;
  /** Pages by name, ranked and bounded — what `page.search` answers. */
  search(query: string, limit: number): Promise<PageSearch>;
  /** What a `[[wikilink]]` names, unambiguously, or null: the id exactly, the
   *  id folded, the id's tail, the page's name — the four tries the bridge
   *  used to make over a full list in the window. */
  resolveLink(target: string): Promise<{ kind: "page"; id: PageId } | null>;
  /** Every page — for `page.list`, `doc.list` and `children.all`, which no
   *  screen asks. From the rows once the sweep has run, never from a parse. */
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

/** NOT BUILT: throws. */
export function makePageIndex(_deps: PageIndexDeps): PageIndex {
  throw new Error("server/domain/pageindex.ts: the page index is not built yet");
}
