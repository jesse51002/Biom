// SPDX-License-Identifier: AGPL-3.0-only
// Turn a folder of markdown notes into pages in a workspace.
//
// WHAT IT IS FOR. The strategy vault is an Obsidian folder — one `.md` per note,
// frontmatter at the top, `[[wikilinks]]` between them — and the workspace is
// where everything else about this company already lives. This is the one-way
// move: every note becomes a page, and the mirror at `_markdown/` puts the
// markdown back on disk for Obsidian and for a brain to read.
//
// A NOTE IS ONE SECTION AND NOT SEVERAL. Sections are structure somebody wrote,
// and a heading in a note is not one — chopping a note into a section per
// heading would invent a shape its author never chose, and would make the round
// trip below depend on how the chopping put it back together. One section holds
// the whole note.
//
// THE ID IS THE FILENAME, VERBATIM, and the NAME is the note's own `# H1`. Those
// are two different jobs: the id is the folder, the URL and the mirror file, so
// keeping it means `_markdown/` reproduces the source folder exactly and nothing
// that reads markdown notices it moved. The name is what a person sees in the
// rail, and a filename like `2026-09-04-00-Office_Hours_Notion_For_Builders` is
// not that. `projectDoc` drops a leading `# Title` that matches the page's name,
// so the H1 becomes the name and the mirror writes it back — the same line, in
// the same place, out of two fields instead of one.
//
// A FOLDER'S `_Index.md` IS THE FOLDER'S OWN PAGE. It is the vault's folder
// note, and a workspace already has that shape — a page holds pages, so the
// index note's words are what the folder page says. Importing it as a child
// would ALSO have failed silently: a leading `_` is the one position a page
// segment refuses, because that is what keeps `_markdown` and `_assets` out of
// the tree, so `Companies/_Index` was written to disk and then listed by
// nothing. Four notes went that way before this rule existed.
//
// AND IT IS NAMED FOR THE FOLDER, not for its own heading. `_Index.md` opens
// `# Companies Index` because in a folder of files it has to say which folder it
// belongs to; as the page for that folder it does not, and "Companies Index"
// sitting in the rail next to "Companies" reads as two things. So the name is
// the folder's, and the note's own opening heading comes off the body — the
// mirror writes the name back as the `# H1`, so the file still opens with one.
//
// FRONTMATTER BECOMES `variables:`, which the mirror writes back out as
// frontmatter. Tags and a status are real information and losing them was the
// one thing that made this import lossy.
//
// WIKILINKS ARE REWRITTEN, because they have to be. A vault's links are written
// from the vault root — `[[Companies/Airtable|Airtable]]` — and the pages land
// under the workspace's root page, so `_markdown/home/Companies/Airtable.md` is
// where the file is and Obsidian resolves a path link from the root or not at
// all. Every link whose target this can identify is rewritten to the page id it
// now names; one it cannot is left alone and REPORTED, because a silently
// dropped link is a hole in the graph nobody will notice.
//
// NOTHING IS WRITTEN UNTIL EVERY NOTE ROUND-TRIPS. Each page is projected in
// memory and compared to the source it came from, body and frontmatter both. A
// note that does not survive the trip is reported and the import fails whole —
// a half-imported vault is worse than none, because the half that landed is the
// half nobody knows to check.
//
//   bun run tools/import-vault.ts <source-folder> <workspace> [--under <page>] [--dry]

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DrawnSection, Page, PageDoc, PageId, VarValue, Variables } from "../contracts/types.ts";
import { DOC_PLUGIN, ROOT_PAGE } from "../contracts/types.ts";
import { projectDoc } from "../contracts/projection.ts";
import { parseAny, format } from "../server/platform/yaml.ts";

/* ── reading the source ────────────────────────────────────────────────── */

/** One note, as it sits on disk. */
interface Note {
  /** Path from the source root, without `.md`: `Companies/Airtable`. */
  path: string;
  /** The frontmatter block, parsed, or an empty map where there was none. */
  front: Variables;
  /** Everything after the frontmatter, verbatim. */
  body: string;
  /** The note's own first `# H1`, which becomes the page's name. */
  title: string;
}

/** A leading `---` block, and what follows it. Split textually rather than
 *  parsed-and-reformatted, because the body has to come out of here byte for
 *  byte — it is the thing being preserved. */
function split(text: string): { front: string; body: string } {
  if (!text.startsWith("---\n")) return { front: "", body: text };
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) return { front: "", body: text };
  return { front: text.slice(4, end + 1), body: text.slice(end + 5) };
}

/** The first `# ` heading in a body. Every note in the vault this was written
 *  for has one; a note without one falls back to its filename, which is at least
 *  something a person can recognise. */
function titleOf(body: string, path: string): string {
  for (const line of body.split("\n")) {
    if (line.startsWith("# ")) return line.slice(2).trim();
    if (line.trim() !== "" && !line.startsWith("#")) break;
  }
  return path.slice(path.lastIndexOf("/") + 1).replace(/_/g, " ");
}

/** Every `.md` under `root`, depth first, skipping dot-directories and the
 *  names given. A dot-directory is tooling — `.obsidian`, `.claude` — and is
 *  never a note. */
async function notesIn(root: string, skip: Set<string>, at = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    const rel = at === "" ? entry.name : `${at}/${entry.name}`;
    if (entry.name.startsWith(".") || skip.has(rel)) continue;
    if (entry.isDirectory()) out.push(...(await notesIn(root, skip, rel)));
    else if (entry.name.endsWith(".md")) out.push(rel.slice(0, -3));
  }
  return out.sort();
}

/* ── wikilinks ─────────────────────────────────────────────────────────── */

const LINK = /\[\[([^\]\n]+)\]\]/g;

/** Rewrite every `[[target|label]]` whose target names a note, and report the
 *  ones that name nothing.
 *
 *  Two ways a target is recognised, and both are how the vault actually writes
 *  them: the note's path from the vault root, and its bare filename. Matching is
 *  case-insensitive on both, because a link typed while reading is typed the way
 *  the reader remembers the name rather than the way the file spells it. */
function relink(
  body: string,
  byPath: Map<string, PageId>,
  byName: Map<string, PageId | null>,
  missed: string[],
): string {
  return body.replace(LINK, (whole, inner: string) => {
    const bar = inner.indexOf("|");
    const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const label = bar < 0 ? "" : inner.slice(bar + 1);
    const found = byPath.get(target.toLowerCase()) ?? byName.get(target.toLowerCase()) ?? null;
    if (found === null) {
      missed.push(target);
      return whole;
    }
    return `[[${found}${bar < 0 ? `|${target}` : `|${label}`}]]`;
  });
}

/* ── the page a note becomes ───────────────────────────────────────────── */

const SECTION = "note";

function docOf(note: Note, body: string): PageDoc {
  return {
    name: nameOf(note),
    plugin: DOC_PLUGIN,
    // The note's own frontmatter, which the mirror writes back out as
    // frontmatter. `aliases` is merged with the page's name there rather than
    // here, so what is stored stays what the note said.
    variables: note.front,
    contents: [{ name: SECTION, parts: { body: body } }],
    input: {},
  };
}

/** The page as the reader would resolve it, for one section of pure markdown.
 *  Enough for `projectDoc` and nothing more — this exists to answer one
 *  question, which is whether the words come back. */
function drawnFrom(id: PageId, doc: PageDoc, body: string): Page {
  const section: DrawnSection = {
    name: SECTION,
    html: "",
    fallback: true,
    parts: { body: { kind: "markdown", md: body, vars: doc.variables } },
    vars: doc.variables,
    stored: doc.contents[0]!,
  };
  return {
    id,
    name: doc.name,
    markdown: {},
    variables: doc.variables,
    sections: [section],
    plugin: DOC_PLUGIN,
    html: "",
    input: {},
    ports: null,
  };
}

/** What the mirror will write as this page's body: the page's name as an H1,
 *  then its projection. Spelled here rather than imported because `mirror.ts`
 *  builds it inline around frontmatter this does not need. */
const projected = (page: Page): string => `# ${page.name}\n\n${projectDoc(page)}`.trimEnd();

/* ── the run ───────────────────────────────────────────────────────────── */

const pageDir = (root: string, id: PageId) =>
  join(root, "pages", ...id.split("/").flatMap((s, i) => (i === 0 ? [s] : ["children", s])));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const underAt = args.indexOf("--under");
  const under = underAt >= 0 ? args[underAt + 1]! : ROOT_PAGE;
  // `--under`'s VALUE is not positional. Guarded on `underAt >= 0`, because
  // `-1 + 1` is the first argument and dropping that one silently made every
  // run without `--under` print the usage line.
  const positional = args.filter((a, i) =>
    !a.startsWith("--") && !(underAt >= 0 && i === underAt + 1));
  const [source, workspace] = positional;
  if (!source || !workspace) {
    console.error("usage: import-vault.ts <source-folder> <workspace> [--under <page>] [--dry]");
    process.exit(2);
  }
  const src = resolve(source);
  const dst = resolve(workspace);

  // `AGENTS.md` is the vault's conventions and `USER.md` is one person's private
  // context — neither is a note, and the second must never land in a committed
  // workspace.
  const skip = new Set(["AGENTS.md", "USER.md"]);
  const paths = await notesIn(src, skip);
  console.log(`${paths.length} notes under ${src}`);
  // An index note at the top of the source would land ON the page everything
  // else is going under, taking whatever that page already says with it.
  const atRoot = paths.filter((one) => isIndex(one) && !one.includes("/"));
  if (atRoot.length > 0) {
    console.error(`  ${atRoot.join(", ")} would overwrite ${under} itself — move it into a folder first`);
    process.exit(1);
  }

  /* Read them all first: the link map has to be complete before any body is
     rewritten, or a note would only link to the notes read before it. */
  const notes: Note[] = [];
  for (const path of paths) {
    const raw = await readFile(join(src, `${path}.md`), "utf8");
    const { front, body } = split(raw);
    const parsed = front === "" ? {} : parseAny(front);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      notes.push({ path, front: parsed as Variables, body, title: titleOf(body, path) });
    } else {
      console.error(`  ${path}: frontmatter is not a map`);
      process.exit(1);
    }
  }

  /* The map from what a link says to the page it now names. A NAME CLAIMED BY
     TWO NOTES IS CLAIMED BY NEITHER: a bare `[[Notion]]` where two notes are
     called Notion cannot be resolved, and guessing is worse than leaving it. */
  const byPath = new Map<string, PageId>();
  const byName = new Map<string, PageId | null>();
  for (const note of notes) {
    const id = idOf(under, note.path);
    // Both spellings reach a folder note: the folder, and the index file inside
    // it — the vault writes links each way and both are the same page now.
    byPath.set(folderOf(note.path).toLowerCase(), id);
    byPath.set(note.path.toLowerCase(), id);
    const stem = segmentOfPath(isIndex(note.path) ? folderOf(note.path) : note.path).toLowerCase();
    byName.set(stem, byName.has(stem) ? null : id);
    for (const alias of aliasesOf(note.front)) {
      const key = alias.toLowerCase();
      if (!byPath.has(key)) byName.set(key, byName.has(key) ? null : id);
    }
  }

  /* Rewrite, build, and verify — all of it before a single file is written. */
  const missed: string[] = [];
  const failed: string[] = [];
  const built: { id: PageId; doc: PageDoc }[] = [];
  let relinked = 0;

  for (const note of notes) {
    const id = idOf(under, note.path);
    const before = note.body;
    const linked = relink(before, byPath, byName, missed);
    if (linked !== before) relinked++;
    const body = bodyOf(note, linked);
    const doc = docOf(note, body);

    // THE ROUND TRIP, in memory. The body has to come back exactly, and the
    // variables have to survive being written as YAML and read again — which is
    // where a date, a `yes`, or a number-shaped string would quietly change.
    const back = projected(drawnFrom(id, doc, body));
    const want = `# ${doc.name}\n\n${stripTitle(body, doc.name)}`.trimEnd();
    if (back !== want) {
      failed.push(`${note.path}: the body does not come back — ${diffAt(want, back)}`);
      continue;
    }
    const reread = parseAny(format(doc as unknown as Record<string, unknown>));
    const vars = (reread as { variables?: Variables } | null)?.variables ?? {};
    const drift = varsDiffer(note.front, vars);
    if (drift !== null) failed.push(`${note.path}: frontmatter changed — ${drift}`);
    else built.push({ id, doc });
  }

  if (missed.length > 0) {
    const unique = [...new Set(missed)].sort();
    console.log(`\n${missed.length} links name nothing in this folder (${unique.length} distinct), left as they were:`);
    for (const one of unique) console.log(`  [[${one}]]`);
  }
  console.log(`\n${relinked} notes had a link rewritten`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} notes do not round-trip. NOTHING WAS WRITTEN.`);
    for (const one of failed) console.error(`  ${one}`);
    process.exit(1);
  }
  console.log(`${built.length} notes round-trip, body and frontmatter both`);

  if (dry) {
    console.log("\n--dry: stopping before anything is written");
    return;
  }

  /* Folders first, so a note's parent exists before it does. A folder with no
     index note of its own is a page with no words: the host reconciles its
     children onto it, and what it holds is what it says. One WITH an index note
     is already in `built`, and must not be overwritten by an empty shell. */
  const written = new Set(built.map((one) => one.id));
  const folders = new Set<string>();
  for (const { id } of built) {
    const parts = id.split("/");
    for (let i = under.split("/").length + 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }
  for (const id of [...folders].sort()) {
    if (written.has(id)) continue;
    const dir = pageDir(dst, id);
    await mkdir(dir, { recursive: true });
    const at = join(dir, "content.yaml");
    if (await exists(at)) continue; // already a page — the folder being imported meets one the workspace already has
    const name = segmentOfPath(id).replace(/_/g, " ");
    await writeFile(at, format({ name, plugin: DOC_PLUGIN, variables: {}, contents: [] }), "utf8");
  }
  for (const { id, doc } of built) {
    const dir = pageDir(dst, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "content.yaml"), format(doc as unknown as Record<string, unknown>), "utf8");
  }
  console.log(`\nwrote ${folders.size} folders and ${built.length} notes into ${dst}`);
  console.log("the mirror follows on the next mount — restart the server");
}

/* ── the small helpers the run leans on ────────────────────────────────── */

/** A note that IS its folder rather than one inside it. Obsidian's folder note,
 *  and a workspace's page-that-holds-pages, are the same shape. */
const isIndex = (path: string): boolean => /(^|\/)_index$/i.test(path);

/** What a page is called. A note's own `# H1`, except for a folder note, which
 *  is called after the folder it is the page for. */
const nameOf = (note: Note): string =>
  isIndex(note.path) ? segmentOfPath(folderOf(note.path)).replace(/_/g, " ") : note.title;

/** The body as it is stored. A folder note's opening heading comes off, because
 *  the page is no longer called that and the mirror writes the page's name back
 *  as the `# H1` — left in, the file would open with two of them. Every other
 *  note keeps its heading exactly where it was: its name IS that line, so
 *  `projectDoc` drops it on the way out and the file is unchanged. */
const bodyOf = (note: Note, body: string): string =>
  isIndex(note.path) ? stripTitle(body, note.title) : body;

const segmentOfPath = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The folder a note sits in, or the note itself where it has none. */
const folderOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path;

/** WHERE A NOTE LANDS. An index note takes its folder's id, so its words become
 *  the folder page's — which is also the only way it lands at all, since a
 *  segment may not begin with `_`. */
const idOf = (under: PageId, path: string): PageId =>
  isIndex(path) ? `${under}/${folderOf(path)}` : `${under}/${path}`;

const aliasesOf = (front: Variables): string[] => {
  const v = front["aliases"];
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map((one) => String(one)).filter((one) => one !== "");
};

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** A leading `# Title` matching the page's name, dropped — the same rule
 *  `projectDoc` applies, restated here so the expected answer is built the way
 *  the real one is rather than asserted to equal it. */
function stripTitle(body: string, name: string): string {
  const trimmed = body.trim();
  const cut = trimmed.indexOf("\n");
  const first = cut === -1 ? trimmed : trimmed.slice(0, cut);
  if (first.trim() !== `# ${name.trim()}`) return trimmed;
  return trimmed.slice(first.length).replace(/^\s+/, "");
}

/** Where two strings first differ, with enough either side to recognise it. */
function diffAt(want: string, got: string): string {
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i++;
  const show = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 30), i + 40));
  return `at ${i}: wanted ${show(want)}, got ${show(got)}`;
}

/** The first key whose value did not survive being written and read back, or
 *  null where every one did. */
function varsDiffer(was: Variables, now: Variables): string | null {
  const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
  for (const key of keys) {
    const a = JSON.stringify(normalise(was[key]));
    const b = JSON.stringify(normalise(now[key]));
    if (a !== b) return `${key}: ${a} became ${b}`;
  }
  return null;
}

/** A value as it will compare. A `Date` is what a YAML parser makes of an
 *  unquoted `2026-08-20`, and the two spellings of the same day have to count as
 *  the same value or every dated note would report drift it does not have. */
function normalise(v: VarValue | undefined): unknown {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map((one) => normalise(one));
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
}

await main();
