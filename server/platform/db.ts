// SPDX-License-Identifier: AGPL-3.0-only
// One SQLite file, parameterised statements. Layer 1: it has no idea what is
// stored in it — no registry, no column types, no page ids.
//
// Nothing in the framework may import this file except `server/domain/tables.ts`
// and `server/domain/runs.ts`, and the layering gate is what makes that
// provable. The point of the rule is that every CREATE, ALTER, SELECT, INSERT
// and PRAGMA in the framework lives in one of those three files, so swapping
// SQLite for a server database is three files and the blast radius is a fact
// rather than a hope. `runs.ts` is the second database — `<vault>/.biom/runs.db`,
// the registry of what has been started from this workspace on this machine,
// beside `workspace.db` and never in git — and it widened the rule by exactly
// one module on 2026-09-17.
//
// bun:sqlite is synchronous and this wrapper stays synchronous. An async facade
// over a sync call would be a lie about where the time goes, and at one user
// there is no time to go anywhere.

// bun:sqlite is typed by @types/bun, which this framework deliberately does not
// depend on — nothing the server runs is a package. Bun runs this file as
// written; tsc cannot see the module, so the import is suppressed and the
// public surface below is typed by hand against the frozen `Db`.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Cell, Db, SqlParam } from "../../contracts/types.ts";

/** SQLite has no boolean, and bun binds one as an integer; doing it here means
 *  the layer above can hand over the `Cell` it already has. */
const bind = (params: SqlParam[]): SqlParam[] =>
  params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));

/** Open (or create) one SQLite file. `:memory:` works and is what the tests
 *  use. */
export function makeDb(path: string): Db {
  if (!path.startsWith(":")) mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });

  // The registry's ON DELETE CASCADE only means anything with this on, and
  // SQLite ships it off by default, per connection.
  db.run("PRAGMA foreign_keys = ON");
  // Journal mode is left alone on purpose: WAL would put -wal and -shm beside
  // the database inside a vault that `git add -A` sweeps up on every write.

  const api: Db = {
    all<T = Record<string, Cell>>(sql: string, params: SqlParam[] = []): T[] {
      // query() caches the prepared statement by SQL text, which is the right
      // trade at one user — the workspace issues the same dozen statements.
      return db.query(sql).all(...bind(params)) as T[];
    },

    run(sql: string, params: SqlParam[] = []): { changes: number; lastInsertRowid: number } {
      // With no parameters bun runs a whole script, which is how a generated
      // tables/<name>.sql lands in one call. With parameters it is one
      // statement, because a bound script has nowhere to put the bindings.
      const r = params.length > 0 ? db.query(sql).run(...bind(params)) : db.run(sql);
      return {
        changes: Number(r?.changes ?? 0),
        lastInsertRowid: Number(r?.lastInsertRowid ?? 0),
      };
    },

    tx<T>(fn: () => T): T {
      // bun's own transaction wrapper: it commits on return, rolls back on a
      // throw, and nests through SAVEPOINT, which hand-rolled BEGIN does not.
      return db.transaction(fn)() as T;
    },

    close(): void {
      db.close();
    },
  };

  return api;
}
