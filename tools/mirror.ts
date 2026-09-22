// SPDX-License-Identifier: AGPL-3.0-only
// Rebuild a workspace's markdown mirror, with no server and no port.
//
// WHY IT EXISTS. `_markdown/` is derived, and NOTHING WATCHES THE FILESYSTEM
// when no server is up. It is rewritten on mount, in the same request as a
// write through the app, and when a page reports its own markdown after being
// drawn — so an agent that writes twenty `content.yaml` files in an editor with
// nothing running has changed twenty pages and no markdown. Anything that reads
// markdown then reads what the mirror said before those pages existed.
//
// So this is the step between writing pages with no server up and pointing a
// markdown indexer at the folder.
//
// IT COMMITS, and that is the point rather than a side effect. An indexer that
// follows git commits rather than the working tree cannot see a mirror that was
// rebuilt and left uncommitted — the rebuild would look like it worked and the
// index would go on answering off the old text. The vault is a git repo of its
// own, which is where the commit lands.
//
// It builds the same stack `server/main.ts` does, against one folder, exactly as
// the tests do.
//
//   bun run tools/mirror.ts <vault>
//   bun run tools/mirror.ts <vault> <another vault>

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeFiles } from "../server/platform/files.ts";
import { makeDb } from "../server/platform/db.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { makePages } from "../server/domain/pages.ts";
import { makeTables } from "../server/domain/tables.ts";
import { makeMirror, rebuild } from "../server/domain/mirror.ts";
import { walkPlugins } from "../server/domain/plugins.ts";
import { checkVaultFormat } from "../server/workspace/migrate.ts";
import type { Shipped } from "../server/workspace/migrate.ts";

declare const Bun: { argv: string[] };

/** This checkout's own plugins, which are what the format gate means by
 *  "shipped": a vault naming one of them by its bare word is format 4. Walked
 *  once, the way `server/main.ts` walks them at start, because it is the same
 *  set whichever vault is being mirrored. */
const FRAMEWORK_PLUGINS = join(resolve(fileURLToPath(new URL(".", import.meta.url)), ".."), "guest", "plugins");
async function shippedIds(): Promise<Shipped> {
  const walk = await walkPlugins(makeFiles(FRAMEWORK_PLUGINS), "", "framework");
  return new Map(walk.folders.map((f) => [f.id, f.document]));
}

/** One workspace. Answers how many pages it projected, or null where the folder
 *  is not a workspace — which is a message and not a crash, because the usual
 *  way to get here is a typo in a path. */
async function mirrorOf(path: string, shipped: Shipped): Promise<number | null> {
  const root = resolve(path);
  const files = makeFiles(root);

  // A page directory is the only thing that makes this a workspace worth
  // mirroring. Checked before the format gate so a wrong path says so plainly.
  if ((await files.read("pages/home/content.yaml")) === null) {
    console.error(`  ${path}: no pages/home/content.yaml — not a workspace`);
    return null;
  }

  // The same gate the server applies before it builds anything that could read
  // a page. An older format must refuse here too rather than be half-projected.
  await checkVaultFormat(root, shipped);

  const db = makeDb(`${root}/workspace.db`);
  try {
    const tables = makeTables(db);
    const pages = makePages(files, { parse, parseAny, format }, () => tables.list());
    const mirror = makeMirror(files, pages);

    const refs = await pages.list();
    const changed = await rebuild(mirror, refs);
    // COMMITTED, or an indexer that follows commits cannot see it.
    // `files.commit` is the vault's own repo — `git add -A` and a commit —
    // which is the history such a tool checkpoints against.
    if (changed) await files.commit("The markdown mirror, rebuilt");
    return refs.length;
  } finally {
    db.close();
  }
}

const paths = Bun.argv.slice(2).filter((a) => !a.startsWith("--"));
if (paths.length === 0) {
  console.error("usage: mirror.ts <workspace>...");
  process.exit(2);
}

let failed = 0;
const shipped = await shippedIds();
for (const path of paths) {
  try {
    const pages = await mirrorOf(path, shipped);
    if (pages === null) failed++;
    else console.log(`  ${path}: ${pages} pages projected`);
  } catch (e) {
    failed++;
    console.error(`  ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
