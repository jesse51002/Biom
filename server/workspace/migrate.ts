// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — the vault format GATE. It runs before anything reads, and it does
// not convert.
//
// IT WAS A CONVERTER AND THE DELETION IS THE CHANGE. It read the flat sidecar,
// pulled every `<id>.md` into the document, turned `order:` into `contents:`,
// rewrote a dotted key into the section it belonged to, and moved every page
// under its parent's `children/`. All of that was written against a format that
// held `kind:`, `render:` and a heterogeneous `contents` list, and all three are
// gone: a page holds SECTIONS now, and a section is a div with its own html and
// its own named slots.
//
// THERE IS NO CONVERTER TO FORMAT 3 AND THERE WILL NOT BE ONE, because the thing
// a conversion would have to produce cannot be derived from what an old vault
// says. A section IS its markup. An old `markdown` entry drawn by the `folio`
// render and the same entry drawn by `plain` were two different pages, and
// neither of them wrote down the html — the render did, in code that no longer
// exists. A converter could only put every entry into the default section and
// call it migrated, which would silently flatten every page in the workspace into
// one treatment and leave nothing behind saying what it used to be. Refusing is
// the honest answer, and it is cheap: the vault is a git repo, so an old one is
// still there, readable, and openable by an older checkout.
//
// SO THIS ASKS ONE QUESTION AND REFUSES OUT LOUD. It walks every page-shaped
// directory looking for a top-level key the format no longer has, and if it finds
// one it throws a sentence naming the version this server reads and the key that
// gave the vault away. Nothing is written, nothing is committed, and no module
// that could read a page is constructed — main.ts runs this before it builds one,
// so a workspace in an older format never half-opens.
//
// WHAT IT DELIBERATELY DOES NOT CATCH: a hand-written page carrying only `name:`
// and a set of `.md` files beside it. That was expressible in format 1 and it is
// a legal, empty page in format 3, so there is nothing to distinguish — it opens
// with no sections, which is what it now says. Every file the old server WROTE
// carries `kind:` and `render:`, so every vault that was ever used is caught.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** THE VAULT FORMAT THIS SERVER READS.
 *
 *    1  the flat sidecar: one `key: value` per line, `order:` naming the
 *       sections and a `<id>.md` file beside it holding each one's words.
 *    2  one document per page — `contents` a list of entries, each with a
 *       `type` — plus `kind:` for what the page was and `render:` for the one
 *       treatment the whole sheet took.
 *    3  sections. `contents` holds nothing but them, a section carries its own
 *       html and its own named slots, and both keys above are gone because
 *       there is nothing left for either to decide.
 *    4  a page names the PLUGIN that draws it. `doc` is the section runtime,
 *       so format 3's pages are format 4 doc pages with one line added; a page
 *       naming none draws its own `index.html`. This one CAN be converted,
 *       because nothing about the page changed — only what it says about
 *       itself — and `tools/migrate-format-4.ts` is the converter.
 *    5  a plugin is named by its FOLDER, everywhere. The framework's plugins
 *       are `biom-<name>/` and a page says `plugin: biom-doc`, a section says
 *       `data-g-plugin="biom-reveal"`, a rung sits under `plugins/biom-doc/`;
 *       a bare word is a plugin of the workspace's own and nothing else. Format
 *       4 let a page say the bare word and had the server and the box put the
 *       prefix on where the workspace had no plugin of that name — one place
 *       a name was not the name, taken out on 2026-09-21. This one converts
 *       too, and `tools/migrate-format-5.ts` is the converter: the words
 *       change and nothing else does.
 *
 *  Bumping this is what makes an old vault refuse rather than half-open. */
export const VAULT_FORMAT = 5;

/** The one file a page is. */
const DOC = "content.yaml";
/** Where a page's children live, and the only structural directory in a page. */
const CHILDREN = "children";
const PAGES = "pages";
/** The page-shaped roots that are not pages: the design doc and the bundled
 *  blocks. Each one is a `content.yaml` in the shape a page has, so each one is
 *  read by exactly the same check. */
const DESIGN = "design";
const BASE = "base";
/** The workspace's own plugins, one folder each. */
const PLUGINS = "plugins";

/** A key at column zero that format 3 does not have, with what it used to mean.
 *  `contents` could not be written by format 1 — a value never spanned a line —
 *  so its absence beside one of these is what tells the two apart. */
const RETIRED: ReadonlyMap<string, string> = new Map([
  ["kind", "what the page was"],
  ["render", "the one treatment the whole sheet took"],
  ["order", "the section order, kept beside the sections"],
  ["parent", "which page this one belonged to"],
  ["sections", "the section order under its earlier name"],
]);

const RETIRED_KEY = /^(kind|render|order|parent|sections)[ \t]*:/m;
/** The key format 1 could not write, which is why it is the version tell. */
const HAS_CONTENTS = /^contents[ \t]*:/m;
/** What format 4 added. A page with sections and no `plugin:` is format 3: this
 *  server would read it as an html page with no document, which draws nothing —
 *  so it is refused with the name of the tool rather than opened empty. */
const HAS_PLUGIN = /^plugin[ \t]*:/m;
/** Format 3's page-level plugins, which format 4 replaced with one `plugin:`. */
const HAS_PAGE_KEY = /^page[ \t]*:/m;

/** THE PREFIX THE FRAMEWORK'S PLUGINS WEAR — `OURS` in `pages.ts`, said here
 *  because this gate runs before that module is constructed. */
const OURS = "biom-";
/** A page's `plugin:` line, and the word on it. */
const PLUGIN_LINE = /^plugin[ \t]*:[ \t]*([A-Za-z0-9_-]+)[ \t]*$/gm;
/** A slot's plugin, in a section's or a document's markup. */
const SLOT_PLUGIN = /data-g-plugin="([A-Za-z0-9_-]+)"/g;

/** One word that format 4 let stand for a framework plugin, where it is, and
 *  what format 5 says instead. */
export interface BareName {
  /** Vault-relative, forward-slashed. */
  file: string;
  line: number;
  from: string;
  to: string;
}

/** Every plugin the framework ships, by id, and whether it carries a document
 *  a page can name — `biom-doc` does, `biom-reveal` does not. The composition
 *  root walks its folders for this; the tool walks the checkout's. */
export type Shipped = ReadonlyMap<string, boolean>;

/** WHICH WORDS ARE THE FRAMEWORK'S, in a file. `plugin: doc` on a page and
 *  `data-g-plugin="reveal"` in markup name the framework's `biom-doc` and
 *  `biom-reveal` — format 4's spelling — when the framework ships a plugin of
 *  that name and the workspace has none of its own under the bare word. A
 *  bare word the workspace owns is left exactly alone: `plugin: digest` with a
 *  `plugins/digest/` beside it is the workspace's, in both formats. On a page
 *  only a plugin WITH A DOCUMENT counts: `plugin: html` is the page's own
 *  `index.html` and has nothing to do with `biom-html`, which draws a part.
 *  @param text the file
 *  @param kind whether it is a page document or markup
 *  @param shipped every id the framework ships, and whether it has a document
 *  @param own every plugin folder the workspace has under a bare name, the
 *    page's own included */
export function bareNames(
  file: string, text: string, kind: "page" | "markup",
  shipped: Shipped, own: ReadonlySet<string>,
): BareName[] {
  const out: BareName[] = [];
  const re = kind === "page" ? PLUGIN_LINE : SLOT_PLUGIN;
  re.lastIndex = 0;
  for (let hit = re.exec(text); hit !== null; hit = re.exec(text)) {
    const word = hit[1] ?? "";
    if (word.startsWith(OURS) || own.has(word) || !shipped.has(OURS + word)) continue;
    if (kind === "page" && shipped.get(OURS + word) !== true) continue;
    const line = text.slice(0, hit.index).split("\n").length;
    out.push({ file, line, from: word, to: OURS + word });
  }
  return out;
}

/** A workspace this server will not open. It carries the directories rather than
 *  putting them in the message: the message crosses into the API and is a leak
 *  channel, and the caller that logs this is the one already holding the path. */
export class VaultFormatError extends Error {
  /** One of the contract's closed error codes, so the API layer answers with it
   *  rather than falling back to `internal`. */
  readonly code = "bad_request";
  /** Vault-relative, most useful first. */
  readonly where: string[];
  constructor(message: string, where: string[]) {
    super(message);
    this.name = "VaultFormatError";
    this.where = where;
  }
}

/**
 * Refuse a workspace written for an older format, and answer nothing otherwise.
 *
 * Safe to call on every start — that is the point of it — and it writes nothing
 * ever, so there is no commit to take and no half-done state to resume from.
 *
 * @param root the vault, absolute
 * @param shipped every plugin id the framework ships, `biom-` and all, and
 *   whether each has a document — the composition root walks its own folders
 *   for them, and a test names a few
 */
export async function checkVaultFormat(root: string, shipped: Shipped): Promise<void> {
  const found: { rel: string; key: string; version: number }[] = [];

  /** Format 3: sections, and nothing saying which reader draws them. */
  const three: string[] = [];
  /** Format 4: a framework plugin named by its bare word. */
  const four: BareName[] = [];
  const own = new Set(await dirs(join(root, PLUGINS)));

  for (const rel of await pageShaped(root)) {
    const raw = await text(join(root, rel, DOC));
    if (raw === null) continue;
    const hit = RETIRED_KEY.exec(raw);
    if (hit === null) {
      // A page with sections and no `plugin:` — or one still carrying format 3's
      // `page:` — was written for the format before this one. It is a separate
      // list because it has a converter and the two below do not.
      if (!HAS_PLUGIN.test(raw) && (HAS_CONTENTS.test(raw) || HAS_PAGE_KEY.test(raw))) three.push(rel);
      // FORMAT 4'S ONE TELL IS A WORD: a framework plugin named bare, on the
      // page or in a section's markup beside it. The page's own `plugins/`
      // counts as the workspace's, because a folder there is a plugin of the
      // page's own under that word.
      const mine = new Set([...own, ...(await dirs(join(root, rel, PLUGINS)))]);
      four.push(...bareNames(`${rel}/${DOC}`, raw, "page", shipped, mine));
      for (const file of await markupIn(join(root, rel))) {
        const markup = await text(join(root, rel, file));
        if (markup !== null) four.push(...bareNames(`${rel}/${file}`, markup, "markup", shipped, mine));
      }
      continue;
    }
    // Format 1 could not write a `contents:` key, so a file carrying one of the
    // retired keys AND a `contents:` is the document format that came between.
    found.push({ rel, key: hit[1] ?? "", version: HAS_CONTENTS.test(raw) ? 2 : 1 });
  }
  // THE WORKSPACE'S OWN PLUGIN DOCUMENTS SAY SLOT PLUGINS TOO, and a bare word
  // there is the same tell.
  for (const folder of own) {
    for (const file of await markupIn(join(root, PLUGINS, folder))) {
      const markup = await text(join(root, PLUGINS, folder, file));
      if (markup !== null) four.push(...bareNames(`${PLUGINS}/${folder}/${file}`, markup, "markup", shipped, own));
    }
  }

  if (found.length === 0 && three.length === 0 && four.length > 0) {
    const first = four[0]!;
    const shown = four.slice(0, 3).map((b) => `${b.file}:${String(b.line)} says "${b.from}"`).join(", ");
    throw new VaultFormatError(
      `This workspace is in vault format 4 and this server reads format ${String(VAULT_FORMAT)}. ` +
        `It names the framework's plugins by a bare word — ${shown}${four.length > 3 ? `, and ${String(four.length - 3)} more` : ""} — ` +
        `and format ${String(VAULT_FORMAT)} names a plugin by its folder: "${first.to}" for "${first.from}", ` +
        `plugin: biom-doc on a page, data-g-plugin="biom-reveal" in a section. ` +
        `THIS ONE CONVERTS: the words change and nothing else does, so run\n\n` +
        `    bun run tools/migrate-format-5.ts <this folder>\n\n` +
        `which rewrites every one of them and nothing else.`,
      [...new Set(four.map((b) => b.file))],
    );
  }

  if (found.length === 0 && three.length > 0) {
    throw new VaultFormatError(
      `This workspace is in vault format 3 and this server reads format ${String(VAULT_FORMAT)}. ` +
        `Its pages do not say which plugin draws them, and a page that says nothing draws its own ` +
        `index.html — which these do not have, so every one of them would open blank. ` +
        `THIS ONE CONVERTS: nothing about the pages changed, only what they say about themselves, ` +
        `so run\n\n    bun run tools/migrate-format-4.ts <this folder>\n\n` +
        `which adds "plugin: biom-doc" to every page here and nothing else.`,
      three,
    );
  }

  if (found.length === 0) return;

  const first = found[0]!;
  const was = RETIRED.get(first.key) ?? "a key this format does not have";
  const version = Math.min(...found.map((f) => f.version));
  throw new VaultFormatError(
    `This workspace is in vault format ${String(version)} and this server reads format ` +
      `${String(VAULT_FORMAT)}. Its pages still carry "${first.key}:" — ${was} — which format ` +
      `${String(VAULT_FORMAT)} does not have, because a page holds sections and a section ` +
      `carries its own html. There is no converter: the markup a section draws with lived in ` +
      `the render layer rather than in the vault, so nothing here could work out what these ` +
      `pages are supposed to look like. Open this folder with an older build, or start a new ` +
      `workspace.`,
    found.map((f) => join(f.rel, DOC)),
  );
}

/** Every directory in the vault that holds a page-shaped `content.yaml`: the
 *  page tree, the design doc and the bundled blocks. `market/` used to be here
 *  and is not — the catalogue went with the render layer it was written
 *  against. */
export async function pageShaped(root: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (rel: string): Promise<void> => {
    if ((await text(join(root, rel, DOC))) !== null) out.push(rel);
    for (const name of await dirs(join(root, rel))) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      await walk(join(rel, name));
    }
  };
  for (const name of await dirs(join(root, PAGES))) await walk(join(PAGES, name));

  if ((await text(join(root, DESIGN, DOC))) !== null) out.push(DESIGN);
  for (const id of await dirs(join(root, BASE))) {
    if ((await text(join(root, BASE, id, DOC))) !== null) out.push(join(BASE, id));
  }
  return out;
}

/** The markup files directly inside a directory — a section's own file, a
 *  page's `index.html`, its `child.html`, a plugin's document. Not below it:
 *  `children/` is other pages, and anything else beneath is not drawn. */
export async function markupIn(at: string): Promise<string[]> {
  try {
    return (await readdir(at, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".html"))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const text = async (at: string): Promise<string | null> => {
  try {
    return await readFile(at, "utf8");
  } catch {
    return null;
  }
};

const dirs = async (at: string): Promise<string[]> => {
  try {
    return (await readdir(at, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};
