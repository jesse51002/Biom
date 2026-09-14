// SPDX-License-Identifier: AGPL-3.0-only
// Add `plugin: doc` to every page in a workspace, and nothing else.
//
// WHAT FORMAT 4 CHANGED is what a page SAYS about itself, not what it is. A page
// used to be sections and only sections; now it names the reader that draws it,
// and `doc` is that same section runtime. So every page written for format 3 is
// a format 4 doc page with one line added — which is why this converter exists
// where the format 1 and 2 ones deliberately do not. Those lost information the
// vault never held (the markup lived in a render layer that is gone); this loses
// nothing at all.
//
// IT EDITS TEXT RATHER THAN GOING THROUGH THE CODEC, and that is the whole
// design. Parsing and re-writing a page would reflow every file — the comments
// go, the blank lines between sections go, a block scalar's spelling may change
// — so a migration nobody asked for would land in the diff beside the one line
// that was wanted. Inserting a line after `name:` is a one-line diff per page,
// and a one-line diff is a migration somebody can review.
//
// It is idempotent: a page that already names a plugin is left alone.
//
//   bun run tools/migrate-format-4.ts <vault>...

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { initVault, makeFiles } from "../server/platform/files.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { makeDb } from "../server/platform/db.ts";
import { makeTables } from "../server/domain/tables.ts";
import { makePages } from "../server/domain/pages.ts";
import { makeMirror, rebuild } from "../server/domain/mirror.ts";
import { pageShaped } from "../server/workspace/migrate.ts";

const HAS_PLUGIN = /^plugin[ \t]*:/m;
const NAME_LINE = /^name[ \t]*:.*$/m;
/** Format 3's page-level plugins. Nothing ever shipped one, so dropping the key
 *  loses no behaviour — but it is printed rather than removed silently, because
 *  a key disappearing out of somebody's file should be something they read. */
const PAGE_BLOCK = /^page[ \t]*:[^\n]*\n(?:[ \t]+[^\n]*\n|\n)*/m;

async function migrate(vault: string): Promise<number> {
  const root = resolve(vault);
  let changed = 0;

  for (const rel of await pageShaped(root)) {
    const at = join(root, rel, "content.yaml");
    const text = await readFile(at, "utf8");
    if (HAS_PLUGIN.test(text)) continue;

    let next = text;
    const hadPage = PAGE_BLOCK.exec(next);
    if (hadPage) {
      next = next.replace(PAGE_BLOCK, "");
      console.log(`  ${rel}: dropped page: — one page names one plugin now`);
    }

    // AFTER `name:`, which is where the writer puts it, so a file this touches
    // and a file the server rewrites later look the same.
    const name = NAME_LINE.exec(next);
    next = name && name.index !== undefined
      ? next.slice(0, name.index + name[0].length) + "\nplugin: doc" + next.slice(name.index + name[0].length)
      : "plugin: doc\n" + next;

    await writeFile(at, next);
    changed++;
  }
  return changed;
}

/** A first projection for every page, so no mirror starts blank. A doc page is
 *  pure data, so this is the one place the local process renders markdown
 *  itself — every other page kind reports its own from inside the box, which
 *  means it arrives the first time somebody opens that page. */
async function fillMirror(vault: string): Promise<number> {
  const root = resolve(vault);
  const files = makeFiles(root);
  const db = makeDb(join(root, "workspace.db"));
  try {
    const tables = makeTables(db);
    const pages = makePages(files, { parse, parseAny, format }, () => tables.list());
    const refs = await pages.list();
    await rebuild(makeMirror(files, pages), refs);
    return refs.length;
  } finally {
    db.close();
  }
}

const vaults = process.argv.slice(2);
if (vaults.length === 0) {
  console.error("usage: bun run tools/migrate-format-4.ts <vault>...");
  process.exit(1);
}

for (const vault of vaults) {
  const root = resolve(vault);
  console.log(root);
  // The vault's own history, before anything is written into it — the same
  // commit-before-a-write the server makes, for the same reason.
  await initVault(root);
  await makeFiles(root).commit("Before adding plugin: doc to every page");

  const changed = await migrate(vault);
  console.log(`  ${String(changed)} page${changed === 1 ? "" : "s"} now name a plugin`);
  const drawn = await fillMirror(vault);
  console.log(`  ${String(drawn)} page${drawn === 1 ? "" : "s"} projected into _markdown/`);
}
