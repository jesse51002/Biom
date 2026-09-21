// SPDX-License-Identifier: AGPL-3.0-only
// Name the framework's plugins by their folders, everywhere in a workspace, and
// change nothing else.
//
// WHAT FORMAT 5 CHANGED is one spelling. The framework's plugins have always
// been folders wearing `biom-` — `guest/plugins/biom-doc/`, `biom-reveal/` —
// and a page went on saying the bare word, `plugin: doc`, with the server and
// the box putting the prefix on wherever the workspace had no plugin of that
// name. That was one place a name was not the name: a page said one word, a
// folder wore another, and every reader of either had to know the rule. Format
// 5 says the folder: `plugin: biom-doc` on a page, `data-g-plugin="biom-reveal"`
// in a section, `ctx.use("biom-items")` in a plugin. A bare word is a plugin of
// the workspace's own and nothing else.
//
// IT EDITS TEXT RATHER THAN GOING THROUGH THE CODEC, for the reason
// `migrate-format-4.ts` gives: a page parsed and written back reflows the whole
// file, and a migration nobody asked for would land in the diff beside the one
// word that was wanted. Each rewrite is one word on one line, so the diff of a
// converted workspace is exactly the list of words that changed.
//
// WHICH WORDS: `bareNames` in `server/workspace/migrate.ts`, the same reading
// the format gate refuses on — a word the framework ships as `biom-<word>`,
// where the workspace has no plugin folder of its own under the bare word, the
// page's own `plugins/` counted. `plugin: digest` beside a `plugins/digest/` is
// the workspace's and is left exactly alone.
//
// WHAT IT CANNOT REWRITE IT NAMES: a `ctx.use("items")` or `biom.use("reveal")`
// in the workspace's own plugin code is code, and this prints the file and the
// line rather than editing a script. The box says the same thing in words the
// next time that plugin draws.
//
// It is idempotent: a word already wearing the prefix is not a bare word.
//
//   bun run tools/migrate-format-5.ts <vault>...

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initVault, makeFiles } from "../server/platform/files.ts";
import { walkPlugins } from "../server/domain/plugins.ts";
import { bareNames, markupIn, pageShaped } from "../server/workspace/migrate.ts";
import type { BareName, Shipped } from "../server/workspace/migrate.ts";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
/** The framework's own folders, beside this tool: what `biom-` names. */
const FRAMEWORK_PLUGINS = join(HERE, "guest", "plugins");
const PLUGINS = "plugins";
const DOC = "content.yaml";
/** A plugin reached from code, which this reports and never edits. */
const USE = /\b(?:ctx|biom)\.use\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g;

/** Every id the framework ships, walked off its folders, and whether each
 *  carries a document a page can name. */
async function shippedIds(): Promise<Shipped> {
  const walk = await walkPlugins(makeFiles(FRAMEWORK_PLUGINS), "", "framework");
  return new Map(walk.folders.map((f) => [f.id, f.document]));
}

const dirs = async (at: string): Promise<string[]> => {
  try {
    return (await readdir(at, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

/** Rewrite one file's bare words in place, one word on one line each. */
function rewrite(text: string, found: BareName[]): string {
  const lines = text.split("\n");
  for (const one of found) {
    const at = one.line - 1;
    const line = lines[at];
    if (line === undefined) continue;
    // The word as it appears in that spelling — on a page after `plugin:`, in
    // markup inside the attribute's quotes — and nowhere else on the line.
    lines[at] = line
      .replace(new RegExp(`^(plugin[ \\t]*:[ \\t]*)${one.from}([ \\t]*)$`), `$1${one.to}$2`)
      .replace(new RegExp(`data-g-plugin="${one.from}"`, "g"), `data-g-plugin="${one.to}"`);
  }
  return lines.join("\n");
}

async function migrate(vault: string, shipped: Shipped): Promise<{ files: number; words: number }> {
  const root = resolve(vault);
  const own = new Set(await dirs(join(root, PLUGINS)));
  let files = 0;
  let words = 0;

  const fix = async (rel: string, kind: "page" | "markup", mine: ReadonlySet<string>): Promise<void> => {
    const at = join(root, rel);
    let text: string;
    try {
      text = await readFile(at, "utf8");
    } catch {
      return;
    }
    const found = bareNames(rel, text, kind, shipped, mine);
    if (found.length === 0) return;
    await writeFile(at, rewrite(text, found), "utf8");
    files++;
    words += found.length;
    console.log(`  ${rel}: ${found.map((b) => `${b.from} → ${b.to}`).join(", ")}`);
  };

  for (const rel of await pageShaped(root)) {
    const mine = new Set([...own, ...(await dirs(join(root, rel, PLUGINS)))]);
    await fix(`${rel}/${DOC}`, "page", mine);
    for (const file of await markupIn(join(root, rel))) await fix(`${rel}/${file}`, "markup", mine);
  }
  for (const folder of own) {
    for (const file of await markupIn(join(root, PLUGINS, folder))) await fix(`${PLUGINS}/${folder}/${file}`, "markup", own);
  }
  return { files, words };
}

/** A framework plugin reached from the workspace's own code, by its bare word.
 *  Named and not edited. */
async function usesInCode(vault: string, shipped: Shipped): Promise<string[]> {
  const root = resolve(vault);
  const own = new Set(await dirs(join(root, PLUGINS)));
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const at = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) await walk(at);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      const text = await readFile(join(root, at), "utf8");
      USE.lastIndex = 0;
      for (let hit = USE.exec(text); hit !== null; hit = USE.exec(text)) {
        const word = hit[1] ?? "";
        if (word.startsWith("biom-") || own.has(word) || !shipped.has("biom-" + word)) continue;
        const line = text.slice(0, hit.index).split("\n").length;
        out.push(`${at}:${String(line)} reaches "${word}" from code — the framework's is "biom-${word}"; edit it by hand`);
      }
    }
  };
  await walk(PLUGINS);
  return out;
}

const vaults = process.argv.slice(2);
if (vaults.length === 0) {
  console.error("usage: bun run tools/migrate-format-5.ts <vault>...");
  process.exit(1);
}

const shipped = await shippedIds();
for (const vault of vaults) {
  const root = resolve(vault);
  console.log(root);
  // The vault's own history, before anything is written into it — the same
  // commit-before-a-write the server makes, for the same reason.
  await initVault(root);
  await makeFiles(root).commit("Before naming the framework's plugins by their folders");

  const { files, words } = await migrate(vault, shipped);
  console.log(`  ${String(words)} word${words === 1 ? "" : "s"} in ${String(files)} file${files === 1 ? "" : "s"} now name the folder`);
  for (const said of await usesInCode(vault, shipped)) console.log(`  ${said}`);
}
