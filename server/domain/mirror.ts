// SPDX-License-Identifier: AGPL-3.0-only
// The markdown mirror: `_markdown/` in the vault root, one `.md` per page.
//
// WHY IT EXISTS. A markdown indexer — a search tool, a retrieval brain, an
// editor pointed at the folder — reads markdown files and nothing else, so a
// workspace whose prose lives inside `content.yaml` is invisible to one however
// much writing is in there. The mirror is the archive half of the bargain: the
// page is HTML and stays HTML, and a derived markdown copy of it exists at all
// times for whatever reads markdown.
//
// IT IS DERIVED, ONE-WAY, AND READ-ONLY. Nothing is ever authored by editing a
// file in here — the next projection overwrites it without looking. The folder
// carries its own `AGENTS.md` and `README.md` saying so, because the first thing
// anybody does with a folder of markdown is edit one.
//
// WHO COMPUTES A PROJECTION IS THE PAGE. A doc page is pure data, so this module
// renders one itself through `contracts/projection.ts`; every other page kind
// can only be projected by the code that draws it, which reports its markdown
// from inside the box. This module is what puts either on disk.
//
// COMMITS. Nothing in here commits. `files.commit` is `git add -A` BEFORE the
// next write, so a projection written inside the same request as the change it
// mirrors is swept into the same commit as that change — which is the whole
// reason it is written synchronously rather than on a timer. The one exception
// is the rebuild on mount, which has no change to ride and says so itself.

import type { Files, HostErrorCode, PageId, PageRef, Pages, VarValue, Variables } from "../../contracts/types.ts";
import { DOC_PLUGIN, parentOf } from "../../contracts/types.ts";
import { projectDoc } from "../../contracts/projection.ts";

const bad = (code: HostErrorCode, message: string) => Object.assign(new Error(message), { code });

/** The one directory this module writes. `_` is the host's prefix — `pages.ts`
 *  skips such names when it walks a page's directory and nothing lists the vault
 *  root — so it cannot be mistaken for a page however deep the tree goes. */
export const MIRROR_DIR = "_markdown";

/** ONE SEGMENT of a page id, as `pages.ts` spells it. It is here because this
 *  module walks a folder that is ALSO somebody's Obsidian vault — a hand-added
 *  note, a `.trash/`, a name with a space — and anything that is not a legal
 *  segment is not a page and must never be turned into an id. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The two spellings the page tree is laid out with, as `pages.ts` writes them.
 *  They are repeated here for the same reason `SEGMENT` is: this module is the
 *  one that walks a real directory path and decides whether it is a page, and
 *  `pages.ts` is a sibling it may not import. */
const PAGES_DIR = "pages";
const CHILDREN = "children";

/** WHICH PAGE A CHANGED FILE BELONGS TO, and what is left of the path below it.
 *
 *  The watcher reports a path; this is the only thing that turns one into an id.
 *  It is here rather than beside the watcher because the walk and its `SEGMENT`
 *  rule are already here, and for the reason they are: the vault root is also
 *  somebody's Obsidian folder, so a name that is not a legal segment is not a
 *  page and must never be turned into an id.
 *
 *  `rest` is empty when the path IS the page's own directory, which is what a
 *  page arriving or leaving looks like — the caller reads that as structural,
 *  because a parent lists its children.
 *
 *  @param rel a vault-relative, `/`-separated path
 */
export function pageAt(rel: string): { id: PageId; rest: string } | null {
  const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
  const head = parts[1];
  if (parts[0] !== PAGES_DIR || head === undefined || !SEGMENT.test(head)) return null;
  const ids = [head];
  let at = 2;
  for (;;) {
    const next = parts[at + 1];
    if (parts[at] !== CHILDREN || next === undefined || !SEGMENT.test(next)) break;
    ids.push(next);
    at += 2;
  }
  return { id: ids.join("/") as PageId, rest: parts.slice(at).join("/") };
}

/** What the mirror can be asked to do. It lives here rather than in
 *  `contracts/types.ts` because nothing crosses the wire to reach it — the wire
 *  carries a page's markdown and this is what happens to it afterwards, the same
 *  arrangement `ThemeStore` already has. */
export interface Mirror {
  /** Put one page's markdown on disk, wrapped in its frontmatter. */
  write(id: PageId, markdown: string): Promise<void>;
  /** Compute a doc page's projection here and write it. */
  project(id: PageId): Promise<void>;
  /** Take a page's file and anything under it away. */
  drop(id: PageId): Promise<void>;
  /** Carry a moved page's files, and everything under it, to its new id. */
  rename(from: PageId, to: PageId): Promise<void>;
  /** Remove every file in the mirror that no longer names a page; answers what
   *  it took. */
  prune(ids: readonly PageId[]): Promise<string[]>;
  /** Write the read-only notice where it differs; answers whether it wrote. */
  guide(): Promise<boolean>;
}

/** THE TWO FILES THAT ARE NOT PAGES. Named here rather than at each use,
 *  because `guide` writes them and `prune` has to know not to sweep them: a page
 *  id may begin with a capital, so `AGENTS` is a legal segment and the sweep
 *  cannot tell the notice from a stale page by its shape. It did exactly that —
 *  `guide()` wrote both on mount and `prune()` deleted them in the same rebuild,
 *  so the folder has never once carried the warning it exists to carry. */
const NOTICE = ["AGENTS.md", "README.md"];

/** Guide and README hold the same words for two readers: an agent opening the
 *  folder, and a person who found it in Obsidian. Written whenever they differ
 *  from what is on disk, unlike the vault's own furniture, which is seeded once
 *  and never refreshed — a stale warning about a read-only folder is worse than
 *  none, because it is the file somebody will trust before overwriting work. */
const GUIDE = `# This folder is generated, and nothing in it is edited

Every file here is a **projection** of a page in this workspace: the page's words
as markdown, rewritten whenever that page is drawn or saved. It exists so tools
that read markdown — Obsidian, a brain, a grep — can read this workspace.

**Do not edit anything in this folder.** There is no merge and no warning: the
next time the page it came from is opened, whatever you typed here is gone.

**Edit the page instead.** A page lives in \`pages/<id>/\`, and its words are in
that directory's \`content.yaml\`. Change them there and this folder follows.

**A file's frontmatter is the page's \`variables:\`**, so a tag or a status is
changed in \`content.yaml\` like everything else. \`id\`, \`parent\`, \`source\` and
\`generated\` are the host's and are written here rather than stored.

**This folder is the Obsidian vault root.** Links between pages are written
relative to it, so \`[[home/clients/ashgrove|Ashgrove]]\` resolves by opening
\`_markdown/\` itself rather than the workspace around it.

**A page that has never been opened has no file here yet.** A projection is
computed by the page, so it arrives the first time somebody looks at that page.
`;

/** One value, as YAML. Quoted where it is text, because a variable holding
 *  `2026-08-20` or `yes` or `- a` is a string the page stores and must not
 *  become a date, a boolean or a list on the way out. */
function yamlValue(v: VarValue): string {
  if (Array.isArray(v)) return `[${v.map((one) => yamlValue(one)).join(", ")}]`;
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
}

/** A key safe to write unquoted. Anything else is skipped rather than escaped:
 *  a variable named with a colon in it would produce frontmatter that does not
 *  parse, and a mirror file nobody can read is worse than one key missing. */
const VAR_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Frontmatter for one page. `aliases` rather than `title`: the body opens with
 *  the name as an H1 already, and Obsidian resolves a page by its aliases — a
 *  `title:` duplicating the heading is the one key the vault's own conventions
 *  name as a mistake. No timestamps: a generated file that changes on every
 *  rebuild is a commit on every rebuild.
 *
 *  A PAGE'S VARIABLES ARE ITS FRONTMATTER, and this is where they come back out.
 *  A vault note carries `tags`, `status`, `verified` — real information, read by
 *  the conventions the vault is written under and by anything asking a brain a
 *  question — and a mirror that wrote five fixed keys and dropped the rest would
 *  lose all of it the first time a note became a page. Variables are already the
 *  page's own scalars and lists of scalars, which is exactly the shape
 *  frontmatter has, so nothing had to be invented to hold them.
 *
 *  FOUR KEYS ARE THE HOST'S and a variable may not claim one: `id`, `parent`,
 *  `source` and `generated` say where the file came from, and a page that could
 *  overwrite them could point its own archive copy at somebody else's document.
 *  `aliases` is the one that MERGES — the page's name first, then whatever the
 *  note called itself — because both are true and Obsidian resolves on either. */
function frontmatter(id: PageId, name: string, source: string, vars: Variables, heading: string): string {
  const parent = parentOf(id);
  // THE PAGE'S OWN HEADING IS AN ALIAS TOO, where it has one and it differs.
  // A page's name is its folder name, so for anything that came out of a
  // markdown file the readable title is the body's first line — and that is what
  // somebody types in a link and what a brain looks a page up by. Without this
  // the title stops being a key to the page it titles.
  const aliases = [String(name)];
  if (heading !== "" && heading !== String(name)) aliases.push(heading);
  const own: string[] = [];
  for (const [key, value] of Object.entries(vars || {})) {
    if (!VAR_KEY.test(key) || RESERVED.has(key)) continue;
    if (key === "aliases") {
      for (const one of Array.isArray(value) ? value : [value]) {
        const text = one === null ? "" : String(one);
        if (text !== "" && !aliases.includes(text)) aliases.push(text);
      }
      continue;
    }
    own.push(`${key}: ${yamlValue(value)}`);
  }
  const lines = [
    "---",
    `id: ${id}`,
    `aliases: [${aliases.map((a) => JSON.stringify(a)).join(", ")}]`,
    ...(parent === null ? [] : [`parent: ${parent}`]),
    `source: ${source}`,
    "generated: true",
    ...own,
    "---",
  ];
  return lines.join("\n");
}

/** What the host says about a file and a page may not. */
const RESERVED = new Set(["id", "parent", "source", "generated"]);

/** `home/clients/ashgrove` → `_markdown/home/clients/ashgrove.md`.
 *
 *  The id IS the path, so the `children/` hops that `pageDir` inserts are simply
 *  not inserted here: a mirror that spelled them would be a folder tree nobody
 *  could read, and the wikilinks in it would carry them too. A page with
 *  children is both `<id>.md` and `<id>/`, which is the folder-note shape
 *  Obsidian already understands. */
export const mirrorPath = (id: PageId): string => `${MIRROR_DIR}/${id}.md`;

export function makeMirror(files: Files, pages: Pages): Mirror {
  /** The design doc has an id but is not in the page tree, and a page id with a
   *  `@` in it cannot be a path segment anywhere. Refused by name rather than
   *  silently skipped, so a caller that meant it hears about it. */
  const check = (id: PageId): void => {
    if (typeof id !== "string" || id === "") throw bad("bad_request", "that is not a page id");
    if (id.startsWith("@")) throw bad("bad_request", "that page is not mirrored");
    const parts = id.split("/");
    if (parts.length > 12 || !parts.every((p) => SEGMENT.test(p))) {
      throw bad("bad_request", "that is not a page id");
    }
  };

  /** A page's markdown is capped, because a projection arrives from a page and a
   *  page can loop. The limit is far above any document somebody wrote and far
   *  below anything that fills a disk. */
  const MAX = 2 * 1024 * 1024;

  const write = async (id: PageId, markdown: string): Promise<void> => {
    check(id);
    if (typeof markdown !== "string") throw bad("bad_request", "a projection is text");
    if (markdown.length > MAX) throw bad("limit", "that projection is too long to store");
    const page = await pages.read(id);
    if (page === null) throw bad("not_found", "no such page");
    const body = markdown.trim();
    // The page's own title, where the body opens with one. Read from the FIRST
    // LINE only: a `#` further down is a section heading, not the page's name.
    const heading = /^#\s+(.+)$/.exec(body.split("\n", 1)[0] ?? "")?.[1]?.trim() ?? "";
    const head = frontmatter(
      id, page.name, `pages/${id.split("/").join("/children/")}/content.yaml`, page.variables, heading,
    );
    // THE PAGE'S OWN HEADING WINS WHERE IT HAS ONE.
    //
    // A page's name is its folder name, so writing it as the file's `# H1` would
    // put `2026-07-30-22-autonomous-is-the-promise` above a note whose real
    // title is the line underneath. A markdown file opens with its title, and
    // for anything that came from a markdown file that title is already the
    // first line of the body.
    //
    // So the name is written as the heading only where the body brings none —
    // which is every page made in the app, and every board, whose projection is
    // a list of cards with nothing above it.
    const titled = /^#\s/.test(body);
    await files.write(
      mirrorPath(id),
      titled
        ? `${head}\n\n${body}\n`
        : `${head}\n\n# ${page.name}\n${body === "" ? "" : `\n${body}\n`}`,
    );
  };

  /** The words a projection wraps, taken back out — the inverse of what `write`
   *  puts around them. A moved page's file has to be rewritten rather than
   *  copied, because its frontmatter states an id and a parent that have just
   *  changed. */
  const bodyOf = (text: string): string => {
    let rest = text;
    if (rest.startsWith("---\n")) {
      const end = rest.indexOf("\n---\n", 3);
      if (end >= 0) rest = rest.slice(end + 5);
    }
    return rest.replace(/^\s*#[^\n]*\n?/, "").trim();
  };

  /** The projection this module can compute ON ITS OWN, which is a doc page's
   *  and nobody else's.
   *
   *  A DOC PAGE IS PURE DATA — sections and slots, all of it in `content.yaml`
   *  — so it can be rendered here without running anything, and that is what
   *  fills a mirror on mount and what the migration tool uses. Every other kind
   *  of page can only be projected by the code that draws it, so this must not
   *  guess: rendering a board with the doc rule answers the empty string,
   *  which would overwrite the board's own markdown with nothing on every
   *  restart. Measured, on two boards, immediately.
   *
   *  So a page this cannot render keeps whatever the box last reported. Where
   *  there is nothing yet it gets its frontmatter and its title, so the page is
   *  in the graph and its own projection fills the body the first time somebody
   *  opens it. */
  const project = async (id: PageId): Promise<void> => {
    const page = await pages.read(id);
    if (page === null) return;
    if (page.plugin === DOC_PLUGIN) {
      await write(id, projectDoc(page));
      return;
    }
    if ((await files.read(mirrorPath(id))) !== null) return;
    await write(id, "");
  };

  const drop = async (id: PageId): Promise<void> => {
    check(id);
    // Both halves of the folder-note shape: the page's own file, and the
    // directory holding whatever was under it. `files.remove` is recursive and
    // silent about what was not there.
    await files.remove(mirrorPath(id));
    await files.remove(`${MIRROR_DIR}/${id}`);
  };

  return {
    write: write,
    project: project,
    drop: drop,

    /** FOLLOW A MOVED PAGE, subtree and all.
     *
     *  A move renames every id beneath it, and a mirror file is NAMED by its id
     *  — so dropping the old path and projecting the new one leaves everything
     *  underneath deleted. Measured on the real workspace: moving three boards
     *  took 135 markdown files with them, which is the whole thing as far as
     *  anything reading markdown is concerned.
     *
     *  The two halves are different and both matter. A DOC PAGE is re-projected,
     *  because its projection SPELLS the ids of its children and those ids have
     *  just changed — carrying its old text across would carry stale wikilinks
     *  with it. Every other kind can only be projected by the page itself, so its
     *  last reported words are carried and the frontmatter rewritten around them;
     *  the body comes right on its own the next time somebody opens it. */
    async rename(from: PageId, to: PageId): Promise<void> {
      check(from);
      check(to);
      if (from === to) return;

      const carried: [PageId, string][] = [];
      const gather = async (id: PageId, depth: number): Promise<void> => {
        const text = await files.read(mirrorPath(id));
        if (text !== null) carried.push([to + id.slice(from.length), bodyOf(text)]);
        // A LEGAL SEGMENT ONLY, and the same filter `dirsIn` applies to the page
        // tree. This folder is the Obsidian vault root: somebody's own note, a
        // `.trash/`, a filename with a space in it are all expected here, and
        // none of them is a page. Turning one into an id built an id that
        // `pageDir` REFUSES — and it throws rather than answering null, so the
        // restore loop below died on it and every file after it in `carried` was
        // never written, having already been dropped. Measured: one
        // `.obsidian/notes.md` under a moved page took its real children with it.
        //
        // The depth bound is the same rule `check` applies to the two endpoints;
        // without it a deep tree reaches the same throw from the other side.
        if (depth >= 12) return;
        // `<id>.md` and `<id>/` are the two halves of one folder note, so a
        // segment reached both ways is one page and is walked once.
        const seen = new Set<string>();
        for (const entry of await files.list(`${MIRROR_DIR}/${id}`)) {
          const seg = entry.dir ? entry.name
            : entry.name.endsWith(".md") ? entry.name.slice(0, -3)
            : null;
          if (seg === null || seen.has(seg) || !SEGMENT.test(seg)) continue;
          seen.add(seg);
          await gather(`${id}/${seg}`, depth + 1);
        }
      };
      await gather(from, from.split("/").length);

      // WRITTEN BEFORE THE OLD IS DROPPED, so a failure anywhere leaves the
      // words somewhere rather than nowhere. The new paths cannot collide with
      // the old ones — the page has already moved, so `to` is a different
      // path — and `drop` then takes only what is left behind.
      //
      // A page this cannot resolve is SKIPPED rather than fatal: one unwritable
      // file must not cost the other three hundred their words.
      for (const [id, body] of carried) {
        try {
          if ((await pages.read(id)) === null) continue;
          await write(id, body);
        } catch {
          /* the projection pass below is the second chance; a doc page recomputes */
        }
      }
      await drop(from);
      // Then the projection pass, where a doc page's text is recomputed against
      // the ids it now has — its old copy spells the ids of its children.
      for (const [id] of carried) {
        try {
          await project(id);
        } catch {
          /* nothing here is worth losing the move over */
        }
      }
    },

    /** Everything in the mirror that is no longer a page. Answers what it took,
     *  so the caller can decide whether anything happened worth committing.
     *
     *  It walks the mirror rather than the pages, because the files that need
     *  removing are exactly the ones no page names — a page removed while the
     *  server was not running leaves nothing else behind to notice. */
    async prune(ids: readonly PageId[]): Promise<string[]> {
      const live = new Set(ids);
      const gone: string[] = [];

      const walk = async (rel: string, prefix: string): Promise<void> => {
        for (const entry of await files.list(rel)) {
          const path = `${rel}/${entry.name}`;
          // A DOT-DIRECTORY IS NOT A PAGE AND NEVER WILL BE: a page segment
          // cannot begin with `.`, so nothing here can ever claim one. That
          // makes it somebody else's, and this folder is a vault root — the
          // first thing anybody does with it is open it in Obsidian, which
          // writes `.obsidian/` beside the notes. Swept, it would be deleted on
          // every mount and their theme, plugins and graph settings with it.
          if (entry.dir && entry.name.startsWith(".")) continue;
          if (entry.dir) {
            const id = prefix + entry.name;
            // A directory stays while any page lives under it, even where the
            // page it is named for has gone — a parent removed with its children
            // still standing is not a shape this reaches, but a mirror that
            // deleted a live page's file would be.
            const holds = [...live].some((one) => one.startsWith(`${id}/`));
            if (holds) await walk(path, `${id}/`);
            else { await files.remove(path); gone.push(path); }
            continue;
          }
          if (!entry.name.endsWith(".md")) continue;
          // The read-only notice, at the root, which is not a page and must not
          // be swept as a stale one. See NOTICE.
          if (rel === MIRROR_DIR && NOTICE.includes(entry.name)) continue;
          const id = prefix + entry.name.slice(0, -3);
          if (live.has(id)) continue;
          await files.remove(path);
          gone.push(path);
        }
      };

      await walk(MIRROR_DIR, "");
      return gone;
    },

    /** The two files telling a reader not to edit here. Answers whether it wrote
     *  anything, so a mount that changed nothing makes no commit. */
    async guide(): Promise<boolean> {
      let wrote = false;
      for (const name of NOTICE) {
        const rel = `${MIRROR_DIR}/${name}`;
        if ((await files.read(rel)) === GUIDE) continue;
        await files.write(rel, GUIDE);
        wrote = true;
      }
      return wrote;
    },
  };
}

/** Rebuild every page's projection and take away what is no longer a page.
 *
 *  Run at mount, where it is the only thing that can notice a page removed while
 *  the server was down. It is also the answer to a page nobody has opened since
 *  the mirror shipped: a doc page's input is pure data, so the local process can
 *  render it without the box.
 *
 *  Answers whether anything changed on disk. */
export async function rebuild(mirror: Mirror, refs: readonly PageRef[]): Promise<boolean> {
  const wrote = await mirror.guide();
  for (const ref of refs) await mirror.project(ref.id);
  const gone = await mirror.prune(refs.map((r) => r.id));
  return wrote || gone.length > 0 || refs.length > 0;
}

/** Re-project one page and, where the change was structural, its parent too —
 *  a parent lists its children, so a page arriving or leaving changes the page
 *  above it as much as itself.
 *
 *  Exported for the API layer, which is the lowest one holding both a page write
 *  and the mirror. `pages.ts` cannot call it: this module imports that one. A
 *  reserved id — the design doc — is returned on rather than refused, below. */
export async function follow(mirror: Mirror, id: PageId, structural = false): Promise<void> {
  // A RESERVED PAGE HAS NO MIRROR AND IS NOT ASKED FOR ONE. The API layer
  // follows every write, and the design doc is written like any page — a slot
  // edited, its document converted — so a write to `@design` used to reach
  // `check`, which refuses a reserved id by name, and the refusal was a stack
  // trace in the log for every keystroke on it. `sendProjection` in the runtime
  // returns on the same id for the same reason; `project`, `write` and `drop`
  // keep refusing, for a caller that meant it.
  if (id.startsWith("@")) return;
  await mirror.project(id);
  if (!structural) return;
  const parent = parentOf(id);
  if (parent !== null) await mirror.project(parent);
}
