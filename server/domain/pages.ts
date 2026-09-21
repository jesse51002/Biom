// SPDX-License-Identifier: AGPL-3.0-only
// The vault format. It lives here and nowhere else.
//
// The paragraph below is the agent-legibility test from the vault design:
// everything a coding agent that has never seen this layout needs, in one
// paragraph.
//
// > A workspace is a directory. `pages/` holds the root page, and every other
// > page lives inside somebody's `children/`: a directory is a page if it
// > contains `content.yaml`, and a page's id is the path of the segments that
// > reach it — `pages/home/children/clients/children/ashgrove/` is
// > `home/clients/ashgrove`. THE FOLDER IS THE HIERARCHY: there is no `parent:`
// > key, because a second statement of a fact is a chance for the two to
// > disagree. `content.yaml` is the whole page: `name`, `variables` (values
// > somebody can change without writing code), `page` (plugins that mount once
// > for the whole page) and `contents` — the ordered list of SECTIONS, which is
// > the only thing a page holds. A section has a `name`, a `data` naming the
// > html file that draws it (omitted takes the shipped default), `parts` mapping
// > each slot the html declares onto what goes in it, and optionally its own
// > `variables`. A part is a string, which is markdown, or a map with a `type`
// > (`markdown`, `html`, `table` or `child`) and a `data`. `{{name}}` inside a
// > part resolves against that part's variables first, its section's second and
// > the page's third, and it is resolved where it is DRAWN rather than here.
// > `child.html` is not a section: it is how THIS page is drawn when another
// > page holds it as a child, it lives in this page's own directory, and
// > deleting it falls back to the built-in row. Names starting with `_` or `.`
// > belong to the host.
//
// A PAGE HOLDS SECTIONS AND NOTHING ELSE, and that is the whole of the change
// from the heterogeneous `contents` it replaced. There used to be one `render`
// pinned to the page, drawing a list of markdown, html and table entries — so a
// page had exactly one treatment and prose was one column at one measure. A
// section is a div: it is full width, it owns its own layout, and it holds any
// number of slots wherever its own html puts them, so three columns of prose is
// ONE section with three markdown parts, which the old shape could not express
// at all. `kind:` went with it, because there is nothing left for it to
// distinguish: a page whose whole reason to exist is the surface it draws is
// one section whose `data` names the file that draws it.
//
// A SLOT'S ID IS ITS KEY IN `parts`. A content has no `name` of its own — the
// map already states it — which is why `writeSlot` addresses a section AND a
// part rather than one id.
//
// ONE FILE HOLDS EVERYTHING A PAGE SAYS. There are no `.md` files: an agent
// asked to change what a page says opens one document rather than a sidecar to
// learn the shape and one file per section to learn the words. What it costs is
// stated rather than hidden — a `content.yaml` that will not parse now loses the
// page's prose as well as its shape — and the answer is that the vault is a git
// repo, the server commits ahead of every agent write, and `docs.ts` still hands
// the raw text back for repair by hand.
//
// AND BECAUSE THE WORDS ARE IN THE DOCUMENT, WRITING THEM IS A WRITE TO IT. Two
// operations do that and they are deliberately not one: `writeSlot` replaces ONE
// part's `data` and fires on a debounce while somebody is typing, so it must
// never carry anything it did not change; `setSections` replaces the LIST, which
// is the order, so adding, reordering and removing are one edit rather than three
// ways to leave a page half-changed.
//
// RESOLUTION IS MANDATORY AND IT HAPPENS HERE. `read` answers `DrawnSection[]`,
// not the stored `Section[]`: every section's html is LOADED and every part is
// resolved before the answer leaves the server. That is not an optimisation. The
// runtime that draws a page lives in an opaque-origin frame and cannot fetch, so
// a part that named a file and expected the guest to load it would simply never
// draw.
//
// THERE IS NO FOLDER, and this is the module where that stops being a type and
// becomes a format. Any page may have children; a page that draws them is what a
// folder was. It is two layers and keeping them apart is the point:
//
//   Layer one, the data — `children(id)`: the page directories under
//   `<dir>/children/` and every table parented here, normalised into `Child`,
//   available to a page whether or not it draws any of them. It reads the
//   FILESYSTEM rather than every page's claim about who its parent is, which is
//   the whole reason the folder became the truth.
//
//   Layer two, the drawing — on every read, each child is guaranteed a SECTION
//   whose name is `childKey(child)`, holding one part of type `child`.
//   Reconciliation is ADDITIVE ONLY: a section already in `contents` is left
//   exactly where it is, because the user dragged it there, and a missing one is
//   appended at the bottom, which is what happens when you add something to a
//   folder. A section whose child has gone does not draw and KEEPS ITS PLACE, so
//   a child that comes back returns to where it was.
//
// A CHILD KEY IS ONE SEGMENT. `contents` only ever names a page's DIRECT
// children, so `@page-notes` carries no path, stays a legal filename, and two
// parents may each hold a "notes" without colliding.
//
// Drawing is replaceable from EITHER END, and the two do not compete:
//
//   The PARENT decides for one arrangement — `@page-ashgrove.html` beside its own
//   `content.yaml` becomes that section's own markup, so the parent draws the
//   child however it likes. It wins, because a parent is looking at this
//   particular arrangement and the child is not.
//
//   The CHILD decides for everywhere else — `child.html` in its OWN directory,
//   read here and carried on the part as `draw`. A page knows how it wants to be
//   summarised better than every page that might hold it, and one file travels
//   with it instead of one per parent going stale behind it.
//
// A PAGE IS THE UNIT OF A FAULT. A `content.yaml` that will not parse loses one
// page and never the tree: it still lists and it still opens, with no sections
// and its own segment for a name, which is exactly enough to reach the raw
// fallback and repair it. A page directory with NO `content.yaml` is not a page
// at all and `read` answers `not_found` — a deliberate tightening, because a
// silently empty page is a page somebody spends an afternoon looking for the
// missing half of. Nothing on this path rewrites a file it could not read, or
// opening the broken page would be the act that emptied it.
//
// This module receives Files and YamlCodec and never touches a path itself, and
// it never imports db.ts or tables.ts — a page has no rows, and that separation
// is structural rather than a matter of taste. What it cannot see it is handed:
// `tableList` is the whole of its knowledge of tables, and it is three fields,
// and the shipped default section is a string it is given rather than a file it
// goes looking for.

import type { BlockId, Child, Content, ContentType, DrawnSection, Files, HostErrorCode, MarkdownScale, Page, PageDoc, PageId, PageInit, PageRef, Pages, Part, PluginName, PartValue, Section, TableName, VarValue, Variables, YamlCodec, PluginExtension } from "../../contracts/types.ts";
import { DEFAULT_PLUGIN, DOC_PLUGIN, PLUGIN_NAME, ROOT_PAGE, UID, childKey, parentOf, segmentOf } from "../../contracts/types.ts";
import { foldId } from "../../contracts/wire.js";
import { DESIGN_PAGE, MAP_PAGE } from "../../contracts/wire.js";
import { scaleOf } from "../../contracts/scale.ts";

const PAGES_DIR = "pages";
/** A workspace's OWN plugins, a root sibling of `pages/`. The server serves
 *  this directory to the box as classic scripts and reads a page's document out
 *  of it FIRST — a file here at the framework's path is an override, and it
 *  wins by being there. */
export const PLUGINS_DIR_VAULT = "plugins";
/** Where the design doc lives: beside `pages/` rather than inside it, which is
 *  what keeps it out of the tree without a reserved id inside the tree. */
const DESIGN_DIR = "design";
/** The one subdirectory that is structure rather than content: a page's direct
 *  children live in it, one directory each. It is named rather than implicit so
 *  a page's own files and its children can never be mistaken for each other —
 *  `_assets` is host bookkeeping, `children` is the tree. */
const CHILDREN = "children";
/** THE FILE THAT MAKES A DIRECTORY A PAGE. Exported because the composition
 *  root has to ask that question of a changed directory the watcher reported,
 *  and the alternative was a second spelling of it up there. Not to be confused
 *  with `PAGE_DOCUMENT` below, which is how a page draws itself INSIDE another
 *  one — a page almost never has that, and every page has this. */
export const PAGE_DOC = "content.yaml";
const DOC = PAGE_DOC;
/** HOW THIS PAGE LOOKS INSIDE SOMEBODY ELSE'S. It sits in the page's OWN
 *  directory and is read by whatever draws the page as a child, which inverts
 *  who decides: a page knows how it wants to be summarised better than every
 *  page that might hold it, and the alternative was `@page-<name>.html` on the
 *  PARENT — written once per parent, and stale the moment the same page was held
 *  somewhere else.
 *
 *  It is NOT a section of the page it lives in. Nothing derives contents off
 *  disk any more, so it simply never appears in `contents` unless somebody
 *  writes it there. */
const CHILD_DRAW = "child.html";
/** THE MARKDOWN TYPE SCALE. One at the vault root is the house scale every page
 *  inherits; one in a page's own directory is that page's, merged over the house
 *  a property at a time — so a page states only what differs and a workspace's
 *  pages match without anybody keeping eight copies in step.
 *
 *  It is a page-shaped concern rather than a theme-shaped one: `theme.json` says
 *  what the type ROLES are (a serif for reading, a narrow sans for labels) and
 *  this says how big a heading is in prose. The first is the workspace's
 *  identity; the second is a document's texture, and a brief and a reference
 *  page reasonably disagree about it. */
const SCALE = "markdown.yaml";
/** The bundled default, IN THE VAULT, put there by the seeder along with the
 *  rest of `base/`. `pages.create` copies it into every new page so an agent
 *  working in a vault finds the file already written and edits it rather than
 *  having to know it could exist.
 *
 *  Read from the vault rather than compiled in, so the workspace's own copy is
 *  the default. Absent, a new page simply has no `child.html` and draws the
 *  built-in row, which is the same state deleting the file leaves. */
export const CHILD_DEFAULT = "base/child/index.html";
/** The one reserved subdirectory of a page's own files. A name starting with `_`
 *  or `.` belongs to the host — one rule, true everywhere including the
 *  database. */
const ASSETS = "_assets";

/** THE SHIPPED DEFAULT SECTION, AS A FILE IN THE FRAMEWORK. A section that names
 *  no `data` draws with this, and it is a real file rather than a branch in the
 *  runtime for a reason worth stating: a default that lived in code would be the
 *  one shape nothing else could reach, and "the document" would be privileged
 *  again — which is exactly what the old doc render kept collapsing into. As a
 *  file it is the same mechanism every other section uses, and it is legible,
 *  copyable and replaceable.
 *
 *  It is READ BY THE COMPOSITION ROOT and handed down, because it belongs to the
 *  framework rather than to any vault and nothing may import `guest/`. */
export const DEFAULT_SECTION_FILE = "guest/sections/default.html";

/** WHERE THE FRAMEWORK'S OWN PLUGINS ARE, AND IT IS THE FALLBACK RUNG. Nothing
 *  is copied out of here any more: a page's document is read from the vault's
 *  `plugins/` first and from here second, so a vault holds only the plugins it
 *  wrote or overrode and the rest follow the framework. The composition root
 *  names this directory when it builds the read-only `Files` handed to
 *  `makePages` — on disk in a checkout, out of the embedded map in a build. */
export const PLUGINS_DIR = "guest/plugins";

/** WHAT THE FRAMEWORK'S OWN PLUGINS ARE CALLED. Every plugin the framework
 *  ships is `biom-<name>` — the file `guest/plugins/biom-markdown.js`, the
 *  document `guest/plugins/biom-doc/index.html`, and the id each registers —
 *  so a plugin a workspace wrote can never share a name with one the framework
 *  ships later. A page goes on saying the bare name: `plugin: doc` is resolved
 *  nearest-first, the vault's own `plugins/doc/` and then the framework's
 *  `biom-doc/`, which is the same rule `guest/runtime/registry.js` applies to
 *  an id in the box. Spelled there as well, and a test holds the two equal. */
export const OURS = "biom-";

/** The `doc` plugin's document, in the vault: the workspace's own override of
 *  it, when it has one. The framework's is `biom-doc/index.html` under
 *  `PLUGINS_DIR`, and `frameworkPlugin` below is the one spelling of that
 *  fallback. The design doc is always a doc page, and design.ts is rooted at
 *  `design/` and cannot see either — so the composition root reads them and
 *  hands the result down. */
export const DOC_PLUGIN_DOCUMENT = "plugins/doc/index.html";

/** The path under the framework's plugin root that a bare plugin id falls back
 *  to: `doc/index.html` is asked for as `biom-doc/index.html`. An id that
 *  already wears the prefix is asked for as it is. */
export const frameworkPlugin = (id: string): string =>
  id.startsWith(OURS) ? `${id}/index.html` : `${OURS}${id}/index.html`;

/** The `mindmap` document the rail's own Map row draws with — resolved like
 *  every other plugin document: the vault's own if it has one, the framework's
 *  otherwise. */
export const MAP_PLUGIN = "mindmap";

/** The page's own document, when it draws itself. */
export const PAGE_DOCUMENT = "index.html";

/** THE ROOT PAGE'S OWN MARKUP, which a new vault is born holding a copy of.
 *
 *  It is a file for the same reason the default section is one: it belongs to
 *  the framework rather than to any vault, nothing under `server/` may import
 *  `guest/`, and a stranger's first page has to be a page they can open and
 *  change — a document built out of a string in a server module is not. The
 *  composition root reads it and hands it down; `ensureRoot` writes the copy. */
export const ROOT_PAGE_FILE = "guest/pages/welcome.html";

/** WHAT A PAGE DRAWS WHEN ITS PLUGIN IS NOWHERE TO BE FOUND. It is a page rather
 *  than an error for the same reason a broken `content.yaml` still opens: the
 *  way back is through the app, and a blank canvas offers nothing to act on. */
export const MISSING_DOCUMENT =
  '<!doctype html><meta charset="utf-8"><title>Nothing draws this page</title>' +
  '<body><p style="font: 1rem/1.5 system-ui; margin: 3rem auto; max-width: 32rem">' +
  "This page names a plugin that is not installed, and has no <code>index.html</code> of its own." +
  "</p></body>";

/** What a section draws with when the file above could not be read — a test
 *  standing this module up on its own, or a checkout missing it.
 *
 *  IT IS NOT A SECOND DEFAULT. `guest/sections/default.html` is the default;
 *  this is the answer to "the framework could not read its own file", which is a
 *  state that has to draw something rather than nothing, and it is deliberately
 *  the same shape — one slot named `body`, which is what `DEFAULT_SLOT` says
 *  and what a reconciled child section fills. Do not invent a third anywhere. */
export const DEFAULT_SECTION = '<div class="g-section"><div data-g-part="body"></div></div>\n';

/** The slot the shipped default section declares, and the one a reconciled
 *  child section puts its child in. Named once, because a child section that
 *  filled a slot the default does not have would draw nothing at all. */
export const DEFAULT_SLOT = "body";

/** ONE SEGMENT of a page id, and the whole of the path grammar. A page id is
 *  now user-shaped — it is a path — so this is checked before anything is joined
 *  onto it rather than trusted to files.ts: `..`, `/`, a leading `_` and a
 *  leading `.` are all excluded by the character class, so an id that would
 *  escape the vault cannot be spelled. files.ts refuses one too; this layer is
 *  the one that knows the difference between a bad id and a missing page, and
 *  the refusal has to be the first of those.
 *
 *  CASE IS KEPT. A segment is what somebody named the page, so `Office_Hours`
 *  stays `Office_Hours` in the folder, the URL and the mirror file — a vault
 *  read in Obsidian should look like the vault, not like a slug of it. What case
 *  costs is one rule, enforced in `create` and `move` and nowhere else: two
 *  siblings may not differ only in case, because a case-insensitive filesystem
 *  would make them one directory. See `foldId`. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** A section name, and a slot name: lowercase, no dot, no `@`. A section may
 *  also be a child key, which is the one form that starts with `@`; the two
 *  namespaces cannot collide because this cannot match the character that
 *  decides. A slot is never a child key — a slot is a `data-g-part` in some
 *  html, and the html is the thing that names it. */
const NAME = /^[a-z][a-z0-9_-]*$/;
/** A file inside a page directory, optionally one level down in `_assets/`. `@`
 *  leads the set because customising a child's section means writing
 *  `@page-ashgrove.html` beside it. */
const FILE = /^[A-Za-z0-9@][A-Za-z0-9._-]*$/;

/** A section standing for a child rather than something the page wrote. One
 *  character decides it, and NAME excludes that character, so no name is ever
 *  both. The rest of the key is not re-parsed: the child it names is found by
 *  matching `childKey`, so the two sides cannot drift. */
export const isChildKey = (name: string): boolean => name.startsWith("@");

/** A section name is a name or a child key. Exported because `design.ts` reads
 *  the same shape out of `design/` and a second opinion about what a legal name
 *  is is how the two drift apart. */
export const isSectionName = (name: string): boolean =>
  isChildKey(name) ? FILE.test(name) && !name.includes("..") : NAME.test(name);

/** A slot's id, which is a `data-g-part` value in a section's html. Deliberately
 *  narrower than a section name: a slot is never a child key, because a child is
 *  what goes IN a slot rather than a name for one. */
export const isPartName = (name: string): boolean => NAME.test(name);

const TYPES: ReadonlySet<string> = new Set(["markdown", "html", "table", "child", "grid"]);

/** Domain failures carry one of the contract's closed error codes, so the API
 *  layer can answer with it instead of falling back to `internal`. The message
 *  never carries a path or an id: it is a leak channel and is treated as one. */
const bad = (code: HostErrorCode, message: string) => Object.assign(new Error(message), { code });

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A filename a page may hold, or null. A section NAMES its html file and so
 *  does an `html` part, so the string comes out of a document a stranger may
 *  have written and is checked here rather than handed to files.ts. */
export function pageFile(data: unknown): string | null {
  if (typeof data !== "string") return null;
  const parts = data.split("/");
  // AN AUTOMATION'S FILES, under `automations/<folder>/`: the manifest, the
  // kickoff, the instructions, and anything under `skills/` or `code/`. The
  // page's Files screen writes them through `page.writeFile`, and `runs.ts`
  // reads them with the same grammar spelled as `pageFileOk` — two spellings
  // because the two modules are siblings, held equal by a test.
  if (parts[0] === AUTOMATIONS && parts.length >= 3) {
    const folder = parts[1] ?? "";
    if (!AUTOMATION_FOLDER.test(folder)) return null;
    const rest = parts.slice(2);
    if (!rest.every((p) => FILE.test(p) && !p.includes(".."))) return null;
    const head = rest[0] ?? "";
    const ok = rest.length === 1
      ? head === "automation.yaml" || head === "kickoff.md" || head === "INSTRUCTIONS.md"
      : (head === "skills" || head === "code");
    return ok ? data : null;
  }
  const name =
    parts.length === 2 && parts[0] === ASSETS ? parts[1]
    : parts.length === 1 ? parts[0]
    : undefined;
  if (name === undefined || !FILE.test(name) || name.includes("..")) return null;
  return parts.length === 2 ? `${ASSETS}/${name}` : name;
}

/** Where a page's automations live, and what one is called. Spelled here and
 *  in `runs.ts`, which owns them; this file only has to let their files be
 *  written. */
const AUTOMATIONS = "automations";
const AUTOMATION_FOLDER = /^[a-z][a-z0-9-]*$/;

/** Turn a page name into the directory segment a human would have typed. */
function slug(name: string): string {
  // Case survives, and so does `_`: the names this has to carry are a person's
  // file names — `Office_Hours`, `HTML_And_Markdown` — and folding them produced
  // an id nobody recognised as the thing they had written. A leading `_` is
  // still stripped, because SEGMENT reserves that position to keep `_markdown`
  // and `_assets` out of the page tree.
  //
  // 100 rather than 60: the longest name in the strategy vault is 76 characters,
  // and a truncating cap turns two distinct notes into one taken segment plus a
  // silent `-2`.
  const s = name.normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 100);
  return SEGMENT.test(s) ? s : "page";
}

/** THE TWO SPELLINGS OF A SLOT, MADE ONE. A bare string is markdown with no
 *  values of its own — that is the whole of the short form — so everything below
 *  works on the canonical `Content` and the format keeps the spelling somebody
 *  actually wrote. yaml.ts has the same function for the same reason; it is
 *  layer 1 and cannot reach this, and the two agreeing is what one hand owning
 *  both files is for. */
export function contentOf(part: unknown): Content | null {
  if (typeof part === "string") return { type: "markdown", data: part };
  // `body: 2026` is prose YAML read as a number. The parser already coerces it,
  // and this is the same answer for a document that arrived some other way.
  if (typeof part === "number" || typeof part === "boolean") {
    return { type: "markdown", data: String(part) };
  }
  if (typeof part !== "object" || part === null || Array.isArray(part)) return null;

  const raw = part as Partial<Content>;
  if (typeof raw.type !== "string" || !TYPES.has(raw.type)) return null;
  const out: Content = {
    type: raw.type as ContentType,
    data: typeof raw.data === "string" ? raw.data : "",
  };
  // A GRID CARRIES ROWS AND A HEAD, squared here the way the codec squares
  // them, because a document can arrive some other way than off disk — over
  // `section.order` from the box, for one — and the drawing wants every row as
  // long as the widest whichever door it came through.
  if (out.type === "grid") {
    out.data = "";
    out.rows = rowsOf(raw.rows);
    out.head = raw.head !== false;
  }
  const vars = varsOf(raw.variables);
  if (Object.keys(vars).length > 0) out.variables = vars;
  return out;
}

/** Cell for cell, row for row. */
function sameRows(a: string[][], b: string[][]): boolean {
  return a.length === b.length && a.every((row, i) => {
    const other = b[i];
    return other !== undefined && row.length === other.length && row.every((cell, c) => cell === other[c]);
  });
}

/** A grid's rows, made square. A row that is not a list is dropped and a cell
 *  that is not text reads as its text, on the rule that one unreadable entry
 *  must not cost the others — the codec refuses the same shapes by name at the
 *  file, which is where a person can act on it. */
function rowsOf(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  const rows: string[][] = [];
  for (const row of v) {
    if (!Array.isArray(row)) continue;
    rows.push(row.map((cell) => (typeof cell === "string" ? cell : cell === null || cell === undefined ? "" : String(cell))));
  }
  const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
  for (const row of rows) while (row.length < width) row.push("");
  return rows;
}

/** WHAT A SECTION DRAWS AS: its html loaded and every slot in it resolved.
 *
 *  Exported because `pages/` is not the only page-shaped directory in the vault:
 *  `design.ts` reads one at `design/`. They each had their own copy of the
 *  resolver once, and when a file form arrived it reached exactly one of them —
 *  a diagram in the design doc read as an empty markdown block, silently. Two
 *  copies of a rule is two chances to have a different one.
 *
 *  `read` is passed in rather than a `Files`, because the callers are rooted
 *  differently and the only thing this needs is how to fetch one of its own
 *  files. `child` is passed in for the same reason: resolving one needs the
 *  page's own children and the directory a child sits in, and the design doc has
 *  neither.
 *
 *  THE MARKDOWN COMES BACK RAW, with `{{name}}` still in it. Interpolation
 *  happens where the part is drawn, because prose is editable in place and
 *  writes back: resolving here would round-trip `62` over the top of `{{rate}}`
 *  the first time somebody touched the paragraph it sits in. `vars` is what to
 *  resolve against, NEAREST FIRST — the part's own values over the section's
 *  over the page's. */
export async function drawSection(
  section: Section,
  pageVars: Variables,
  read: (file: string) => Promise<string | null>,
  fallbackHtml: string,
  child: (content: Content) => Promise<Part | null> = async () => null,
): Promise<DrawnSection> {
  const vars: Variables = { ...pageVars, ...(section.variables ?? {}) };

  // The section's own markup, or the shipped default. A file NAMED here that is
  // not on disk takes the default too: the slots still draw, so the words are
  // still on screen and the fault reads as a section that lost its layout rather
  // than as a page that lost a section. `fallback` says the default was used
  // either way, which is exactly what the editor and the checker want to know.
  const file = pageFile(section.data);
  const own = file === null ? null : await read(file);
  const html = own ?? fallbackHtml;

  const parts: Record<string, Part> = {};
  for (const [slot, held] of Object.entries(section.parts ?? {})) {
    if (!isPartName(slot)) continue;

    // A LIST RESOLVES ITEM BY ITEM. An entry that does not resolve is dropped
    // rather than left as a hole, so the list a section draws is the list of
    // things that actually have something in them — and an empty list is a real
    // answer, not a missing slot: it is what a page holds before anybody has
    // added the first item.
    if (Array.isArray(held)) {
      const items: Part[] = [];
      for (const one of held) {
        const content = contentOf(one);
        if (content === null) continue;
        const item = await partOf(content, vars, read, child);
        if (item !== null) items.push(item);
      }
      parts[slot] = { kind: "list", items };
      continue;
    }

    const content = contentOf(held);
    if (content === null) continue;
    const part = await partOf(content, vars, read, child);
    if (part !== null) parts[slot] = part;
  }

  return { name: section.name, html, fallback: own === null, parts, vars, source: section };
}

async function partOf(
  content: Content,
  sectionVars: Variables,
  read: (file: string) => Promise<string | null>,
  child: (content: Content) => Promise<Part | null>,
): Promise<Part | null> {
  const vars: Variables = { ...sectionVars, ...(content.variables ?? {}) };

  switch (content.type) {
    case "markdown":
      return { kind: "markdown", md: content.data, vars };
    case "html": {
      const file = pageFile(content.data);
      if (file === null) return null;
      // A named file that is not there is an EMPTY slot rather than a missing
      // one: the entry is in the document, somebody can see it, and a slot that
      // quietly disappeared would leave nothing to repair from.
      const html = (await read(file)) ?? "";
      return { kind: "html", file, html, vars };
    }
    case "table": {
      const table = str(content.data);
      return table === null ? null : { kind: "table", table };
    }
    case "grid":
      // Raw cells, for the reason `md` is raw: a cell opens under the caret and
      // writes back, so `{{name}}` resolves where it is drawn and never here.
      return { kind: "grid", rows: (content.rows ?? []).map((row) => row.slice()), head: content.head !== false, vars };
    default:
      return await child(content);
  }
}

/** A parsed document, made safe to read. The codec answers `PageDoc`, but the
 *  text behind it was written by a person or an agent, so every field is
 *  narrowed here before anything is derived from it. A page whose `contents` is
 *  a string is a page with no sections, not a crash. */
export function docOf(value: unknown, fallbackName: string): PageDoc {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Partial<PageDoc>;
  const contents: Section[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.contents) ? raw.contents : []) {
    const section = sectionOf(entry);
    // One name, one section: two called `calc` would give a slot write two
    // places to land and the reader no way to say which.
    if (section === null || seen.has(section.name)) continue;
    seen.add(section.name);
    contents.push(section);
  }
  // THE TOLERANT READ, so `plugin:` behaves here the way it does in the codec:
  // a name that is not a name is the default rather than an exception, because
  // this path exists to get SOMETHING back out of a document that may be damaged.
  const named = str(raw.plugin);
  const plugin = named !== null && PLUGIN_NAME.test(named) ? named : DEFAULT_PLUGIN;
  const bag = raw.input;
  const input: Record<string, unknown> = {};
  if (typeof bag === "object" && bag !== null && !Array.isArray(bag)) {
    for (const key of Object.keys(bag)) {
      if (key === "__proto__") continue;
      input[key] = (bag as Record<string, unknown>)[key];
    }
  }
  const uid = str(raw.uid);
  return {
    name: str(raw.name) ?? fallbackName,
    ...(uid !== null && UID.test(uid) ? { uid } : {}),
    plugin: plugin,
    variables: varsOf(raw.variables),
    contents: plugin === DOC_PLUGIN ? contents : [],
    input: input,
  };
}

/** Values a person can change without writing code: scalars and lists of
 *  scalars, and nothing else. Anything nested is dropped rather than carried,
 *  because a variable is a thing you type into a field. */
export function varsOf(value: unknown): Variables {
  const out: Variables = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "" || key === "__proto__") continue;
    if (isVar(v)) out[key] = v;
  }
  return out;
}

const isScalar = (v: unknown): boolean =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const isVar = (v: unknown): v is VarValue =>
  isScalar(v) || (Array.isArray(v) && v.every(isScalar));

function sectionOf(value: unknown): Section | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Partial<Section>;
  if (typeof raw.name !== "string" || !isSectionName(raw.name)) return null;

  const out: Section = { name: raw.name };
  if (typeof raw.data === "string" && raw.data !== "") out.data = raw.data;

  const parts: Record<string, PartValue> = {};
  if (typeof raw.parts === "object" && raw.parts !== null && !Array.isArray(raw.parts)) {
    for (const [slot, held] of Object.entries(raw.parts as Record<string, unknown>)) {
      if (!isPartName(slot)) continue;

      // A LIST, kept as a list. An entry that is not a value is dropped and the
      // rest of the list stands: one unreadable item must not cost the others,
      // because the others are somebody's writing. An EMPTY list survives — it
      // is what a slot holds before the first item is added, and turning it into
      // no slot at all would make adding the first item impossible.
      if (Array.isArray(held)) {
        const items: (string | Content)[] = [];
        for (const one of held) {
          const content = contentOf(one);
          if (content === null) continue;
          items.push(typeof one === "string" ? one : content);
        }
        parts[slot] = items;
        continue;
      }

      const content = contentOf(held);
      if (content === null) continue;
      // The short spelling is kept where it is what the document said, so a save
      // does not rewrite `body: hello` into a three-line map.
      parts[slot] = typeof held === "string" ? held : content;
    }
  }
  if (Object.keys(parts).length > 0) out.parts = parts;

  const vars = varsOf(raw.variables);
  if (Object.keys(vars).length > 0) out.variables = vars;
  return out;
}

/** EVERY PAGE DIRECTORY IN A VAULT, in id order, the design doc's last — the
 *  directories alone, with no document read out of any of them. The loader
 *  asks this to find every page's own `plugins/`, and it is a walk of
 *  `readdir` rather than of `content.yaml` because a bundle is asked for once
 *  per box and a vault of three hundred pages must not parse three hundred
 *  documents to answer. A directory is a page directory by position — under
 *  `pages/` and under a `children/` — and not by holding a document: a
 *  directory that has none has no page to read but may still hold plugins
 *  somebody is about to write a page beside. */
export async function pageDirs(files: Files): Promise<string[]> {
  const out: string[] = [];
  const dirs = async (rel: string): Promise<string[]> => {
    let entries: { name: string; dir: boolean }[];
    try {
      entries = await files.list(rel);
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.dir && SEGMENT.test(e.name))
      .map((e) => e.name)
      .sort();
  };
  const walk = async (dir: string): Promise<void> => {
    out.push(dir);
    for (const name of await dirs(`${dir}/${CHILDREN}`)) await walk(`${dir}/${CHILDREN}/${name}`);
  };
  for (const name of await dirs(PAGES_DIR)) await walk(`${PAGES_DIR}/${name}`);
  out.push(DESIGN_DIR);
  return out;
}

/** THE ONE PLACE A PAGE BECOMES A DIRECTORY, and it is a walk: `a/b/c` is
 *  `pages/a/children/b/children/c`.
 *
 *  Every segment is checked before it is joined, so an id that would leave the
 *  vault cannot be spelled. files.ts refuses one too — but the id is USER-SHAPED
 *  now, it is a path rather than a directory name, so it is checked at the layer
 *  that can tell a bad id from a missing page and answer with the first.
 *
 *  Exported because `docs.ts` addresses the same file from the same directory,
 *  and two copies of the walk is two chances to disagree about where a page is. */
export function pageDir(id: PageId): string {
  if (typeof id !== "string" || id === "") throw bad("bad_request", "that is not a page id");
  // THE DESIGN DOC IS A PAGE THAT LIVES SOMEWHERE ELSE. One branch, and it is
  // what makes the whole of this module work on it: reading, writing a slot,
  // reordering, removing a section and patching a scope all address a page by
  // id, so giving the design doc an id gives it every one of them for free. The
  // alternative was a second implementation of each, kept in step by hand.
  //
  // `@design` cannot collide with anything: SEGMENT forbids `@`, so no page a
  // person creates can ever be called this.
  if (id === DESIGN_PAGE) return DESIGN_DIR;
  const parts = id.split("/");
  // A depth nothing legitimate reaches, and a cheap end to a pathological id.
  if (parts.length > 12 || !parts.every((p) => SEGMENT.test(p))) {
    throw bad("bad_request", "that is not a page id");
  }
  return `${PAGES_DIR}/${parts.join(`/${CHILDREN}/`)}`;
}

/** The document a page IS, addressed. `docs.ts` writes this file whole and
 *  `pages.ts` writes it whole; nothing else may. */
export const pageDocPath = (id: PageId): string => `${pageDir(id)}/${DOC}`;

/** Everything this module is allowed to know about tables, and it is
 *  deliberately the smallest thing that can build a `Child`: the name, the row
 *  count, and where it sits. `tables.ts` is a sibling and there is no sideways,
 *  so the composition root closes over it and hands this down — `() =>
 *  tables.list()` satisfies it exactly, because `TableRef` is a superset of this
 *  shape.
 *
 *  A table has no directory, so it is the one child the folder cannot state. Its
 *  parent is registry state and arrives here. */
export type TableList = () => readonly { name: TableName; rows: number; parent: PageId | null }[];

/** The merged variables of every plugin that declares any, for the page whose
 *  directory is given — null for a page with none, which reads the framework's
 *  and the vault's rungs alone. `makePlugins` in `plugins.ts` builds one. */
export type ExtensionsFor = (pageDir: string | null) => Promise<Record<string, PluginExtension>>;

/** WHAT A NEW VAULT'S ROOT PAGE SAYS, and it is every word on it.
 *
 *  The page is its own `index.html` — `ROOT_PAGE_FILE` — so these are the
 *  page's own top-level slots rather than a section's: on a page with no
 *  sections the key IS the part, which is what keeps each of them editable
 *  under the caret in the app and writeable back to this file.
 *
 *  IT SAYS ONE THING TO DO AND NOTHING ELSE. It used to explain `content.yaml`,
 *  New page, Modify page and Reload — a format lesson given to somebody who has
 *  just arrived and has not yet seen a page. What a stranger needs is where to
 *  start their agent and what they are allowed to ask for; the folder is the
 *  first and the asks are the second.
 *
 *  WHO IT IS WRITTEN FOR is somebody technical building something for
 *  themselves — a second brain, a scraper, a digest, a board of what they are
 *  making — and `about` is where that is said. It ends by sending them to the
 *  design doc, because everything an agent generates in a workspace comes out
 *  of `design/` and a page restyled afterwards is a page written twice. The
 *  link is a `[[wikilink]]` on the reserved id, so it is a word in the document
 *  that opens under the caret rather than an anchor buried in the markup.
 *
 *  AN ASK IS ONE ITEM CARRYING TWO BLOCKS, AND A PARALLEL `prompts` LIST WAS
 *  REJECTED. The short line is what the module is; the paragraph under it is a
 *  real prompt somebody can paste into their agent, which is the difference
 *  between a figure that says what is possible and one a person can act on. They
 *  are one markdown item because the runtime draws a list as one region per
 *  ITEM — so a second list would be a second set of regions the grid could not
 *  interleave with the first, and adding an ask through the page's own harness
 *  would grow one list and not the other. Two blocks in one item add and delete
 *  together, open under one caret, and write back as one string. The page's own
 *  script reads the second block off the drawn item to put a Copy beside it, so
 *  a prompt somebody rewrites here is the prompt that gets copied.
 *
 *  NOTHING IN A PROMPT MAY PROMISE MORE THAN THE BUILD DOES. The agent reads and
 *  writes files in the folder and the app draws what it finds and redraws when
 *  it changes; there is no model inside the app and no scheduler inside it
 *  either. The app CAN start an automation — a folder under a page, from the
 *  page's Automations screen or the rail's — so every recurring ask says to
 *  make it one, and then says *there is no clock in this workspace* and sends
 *  the schedule to the agent's own tooling rather than describing a feature
 *  this program does not have.
 *
 *  THE FOLDER IS NOT IN HERE. `biom.vault()` answers it where the page is
 *  drawn, which is what makes it survive somebody moving the workspace. A path
 *  seeded into the document would be wrong the first time, and wrong silently.
 *
 *  Every instruction in it has to be true of the build a stranger is holding:
 *  what the agent writes appears on its own because the server watches the
 *  folder and re-reads it. When that changes, this is one of the places that
 *  changes. */
const ROOT_WORDS: Record<string, string | string[]> = {
  heading: "# Point your agent at this folder.\n",
  lede: "Start your agent in the folder below, then tell it what you want. **What you ask for appears here**, on its own.\n",
  about:
    "Second brain, daily digest, a scraper that runs every morning, a board of what you are building: your agent makes them here as real pages, drawn, not as a wall of text. Point it at your feeds, your notes, your repos, and this is where the result lands every day.\n" +
    "\n" +
    "First, open **[[@design|Design]]** and tell your agent the look you want.\n",
  asksHeading: "## Ask for any of these.\n",
  asksAside: "Or something nobody here has thought of.\n",
  asks: [
    "convert my Obsidian vault into a workspace here\n\nRead the Obsidian vault at the path I give you and make a page here for every note in it, under a page called Notes, keeping the folders as the nesting. Keep the links between notes as links between the new pages, and keep each note's tags and frontmatter as that page's variables. Where a note is really a table or a list of things, draw it as one rather than leaving it as text.\n",
    "be my second brain: everything I read, note and decide, linked and asked back\n\nMake a page called Second Brain, and file everything I drop in this folder or paste to you under it as its own page — what I read, what I noted, what I decided. Link each new page to the ones it touches, and fold anything I tell you in passing into the page it belongs to. Draw the whole thing on Second Brain as a graph of pages joined by their links. When I ask you something, answer out of those pages and name the ones you read.\n",
    "every morning pull the feeds and repos I follow and draw what changed\n\nMake a page called Changed Overnight. Read the feed URLs and the repositories out of the file I keep in this folder, fetch each one, and put the newest items at the top of that page, one row each, with what moved since yesterday beside it. Draw the day's counts as a small figure above the rows. Make it an automation on that page, so it can be started from the page's Automations screen; running it every morning at 7 is still your own scheduling — there is no clock in this workspace.\n",
    "daily digest of my inbox, my calendar and my notes, on one page\n\nMake it an automation on that page, so it can be started from here, and run it every morning at 7 with your own scheduling — there is no clock in this workspace. Read what you can reach of my mail and today's calendar, and whatever I wrote in this folder yesterday. Write it up as a new page under a page called Digest, named for that day's date, with three or four headings for what the day is about and a line under each saying what needs me. Leave the earlier days alone: a new page each morning, never a rewrite of the last.\n",
    "scrape the listings I watch and keep a table of every new one\n\nMake a page called Listings with a table behind it. Fetch the listing URLs I name, take the title, the price, the place and the link out of each one, and add a row for anything that is not in the table already. Draw the table on the page, newest first, with today's arrivals picked out. Make it an automation on that page, so it can be started from the page's Automations screen; running it every morning at 7 is still your own scheduling — there is no clock in this workspace.\n",
    "dashboard my week: commits, PRs, hours, spend, with the numbers moving\n\nMake a page called This Week. Take the commits and the merged pull requests out of the git log of the repository I name, and the hours and the spend out of the files I keep in this folder. Print those across the top of the page and draw one bar per day underneath, with the busiest day picked out. Rewrite the page in place each time I ask.\n",
    "draw a live architecture diagram of my project, redrawn as the code changes\n\nMake a page called Architecture. Read the source tree of the repository I name and work out which module depends on which, then draw it as a diagram — a box per module, an arrow from each one to what it imports — with the module everything leans on in the middle. Redraw it from the tree whenever I tell you the code has moved, rather than editing the boxes by hand.\n",
    "make me a board of my side projects, with what each is blocked on\n\nMake a page called Side Projects and put them on it as a board. Take one card per project out of the notes I keep in this folder, carrying the project's name and the one thing it is blocked on, and give the board a column for each state a project can be in. Put the number of cards at the top of each column.\n",
    "every night read what I saved today and file it where it belongs\n\nMake it an automation on the page it files into, so it can be started from here, and run it every night at 11 with your own scheduling — there is no clock in this workspace. Read whatever I dropped into this folder that day and file each thing as a page under the page it belongs to, making that page where there is not one. Put a line on a page called Filed Tonight for each one: the time, what it was, and where it went. Leave anything you cannot place where it is and say so on that page.\n",
    "put two versions of a page side by side\n\nMake a page called Side By Side that draws two of my pages in two panes, each one as it actually is rather than as a list of differences. Let me name which two. Pick out the lines that differ, and put the same chart under both so the two can be read against one another.\n",
  ],
};

/** What the root page draws with when the framework could not read its own
 *  `ROOT_PAGE_FILE` — a test standing this module up on its own, or a checkout
 *  missing it. It is not a second welcome page: it is the answer to a state
 *  that still has to draw something, and it draws the same words through the
 *  same slots. */
export const ROOT_PAGE_STANDIN =
  '<main class="g-page">\n' +
  '  <div data-g-part="heading"></div>\n' +
  '  <div data-g-part="lede"></div>\n' +
  '  <div data-g-part="about"></div>\n' +
  '  <div data-g-part="asksHeading"></div>\n' +
  '  <div data-g-part="asksAside"></div>\n' +
  '  <div data-g-part="asks"></div>\n' +
  "</main>\n";

/**
 * @param defaultSection the shipped default section's markup, read by the
 *   composition root out of `DEFAULT_SECTION_FILE`. It is a string rather than a
 *   path because nothing may import `guest/` and this module owns no paths of
 *   its own — and it is defaulted so a test can stand this up with one argument.
 * @param rootName the root page's display name the first time it is created.
 *   A vault has no name of its own beyond its folder's — `vault.ts:infoOf`
 *   says so for the picker, and this is the same fact reaching the page a
 *   fresh vault opens on. The composition root passes the vault's own folder
 *   name; a test that does not care about the root's display text can leave
 *   it at the default.
 * @param rootPage the markup a new vault's root page is born with, read by the
 *   composition root out of `ROOT_PAGE_FILE` for the same reason
 *   `defaultSection` is: it lives in `guest/` and nothing here may import it.
 *   Written into the page's directory as its own `index.html` and never read
 *   again, so a person editing that copy is editing their page.
 * @param framework the framework's own plugins, rooted at `guest/plugins/` and
 *   read-only — the last rung a page's document is resolved from. Left out, a
 *   page names a plugin the vault has not got and draws `MISSING_DOCUMENT`,
 *   which is what a test that stands the module up alone should see.
 * @param extensionsFor EVERY PLUGIN'S VARIABLES, MERGED FOR ONE PAGE — the
 *   contract, the vault's rung and the page's rung, one key at a time — handed
 *   in by the composition root because `domain/plugins.ts` is this module's
 *   sibling and the layering rule forbids reaching it. It takes the page's
 *   directory, whose own `plugins/` is the nearest rung, and null for a page
 *   that has no directory. Left out, every page reads no extensions at all.
 */
export function makePages(
  files: Files,
  yaml: YamlCodec,
  tableList: TableList = () => [],
  defaultSection: string = DEFAULT_SECTION,
  rootName: string = "Home",
  rootPage: string = ROOT_PAGE_STANDIN,
  framework: Files | null = null,
  extensionsFor: ExtensionsFor = async () => ({}),
): Pages {
  const dirOf = pageDir;

  /** THE DOCUMENT THE BOX LOADS, resolved here for the reason every other file
   *  a page needs is: the box has an opaque origin and cannot fetch.
   *
   *  THE ORDER IS THE WHOLE STATEMENT OF WHAT A PLUGIN IS, AND IT IS NEAREST
   *  FIRST. A page's OWN `index.html` wins, because a page that drew itself
   *  asked for nothing else. Then one in the page's own `plugins/`, which
   *  reaches this page alone. Then one in this workspace's `plugins/` under the
   *  BARE name the page said, which is a plugin of the workspace's own. Then
   *  the FRAMEWORK'S OWN under its `biom-` name, which a vault never shadows:
   *  what a vault changes about the framework's document is its variables,
   *  in a rung, and a vault that writes none follows every framework release.
   *  `MISSING_DOCUMENT` is what is left underneath, reached only by a page
   *  naming a plugin nobody has.
   *
   *  THE FRAMEWORK'S SET USED TO BE SEEDED INTO THE VAULT INSTEAD, so that the
   *  second rung was always occupied — and the cost, named at the time, was
   *  that a framework fix never reached a copy already made; then a copy under
   *  the prefixed name was the paved override, which was the same cost by
   *  choice. Neither stands: nothing is copied unasked and nothing copied
   *  shadows. `pluginDocument` below says the rest. */
  const htmlOf = async (id: PageId, doc: PageDoc): Promise<string> => {
    const dir = dirOf(id);
    const own = await files.read(`${dir}/${PAGE_DOCUMENT}`);
    if (own !== null) return own;
    // THE PAGE'S OWN `plugins/` IS THE NEAREST RUNG FOR A DOCUMENT TOO: a plugin
    // folder beside this page's `content.yaml`, under the bare name the page
    // said, draws this page and no other. A `biom-` folder there is an
    // extension and holds a rung alone, exactly as in the vault.
    if (!doc.plugin.startsWith(OURS)) {
      const mine = await files.read(`${dir}/${PLUGINS_DIR_VAULT}/${doc.plugin}/${PAGE_DOCUMENT}`);
      if (mine !== null) return mine;
    }
    return await pluginDocument(doc.plugin);
  };

  /** One plugin's document: the vault's own under the name the page said,
   *  then the framework's under its `biom-` name.
   *
   *  THE VAULT'S IS READ UNDER THE BARE NAME AND NOWHERE ELSE, and that is the
   *  rule rather than an omission. A vault folder wearing `biom-` is an
   *  EXTENSION — it holds `extensions.yaml` and nothing more, and the loader
   *  refuses anything else in it by name — so `plugins/biom-doc/index.html`
   *  dropped into a vault is never a document that draws. There are no
   *  file-based overrides: a workspace that wants a document of its own
   *  writes `plugins/doc/index.html`, a plugin of the workspace's OWN, and
   *  every page saying `plugin: doc` draws with it; one that wants the
   *  framework's document to draw differently changes its variables in a
   *  rung, or names a plugin of its own in one. */
  const pluginDocument = async (plugin: string): Promise<string> => {
    const mine = await files.read(`${PLUGINS_DIR_VAULT}/${plugin}/${PAGE_DOCUMENT}`);
    if (mine !== null) return mine;
    if (framework !== null) {
      const theirs = await framework.read(frameworkPlugin(plugin));
      if (theirs !== null) return theirs;
    }
    return MISSING_DOCUMENT;
  };

  /** The tolerant read, and the whole of the isolation: `null` is no page,
   *  `broken` is a page whose `content.yaml` will not parse.
   *
   *  One unreadable file used to fail the entire tree, so a single pasted
   *  character emptied the rail and made every good page unreachable. A page is
   *  the unit of a fault here: the broken one degrades to something that lists
   *  and opens — enough to reach the raw fallback and repair it — and every other
   *  page is untouched. */
  const readDoc = async (id: PageId): Promise<{ doc: PageDoc } | { broken: true } | null> => {
    const text = await files.read(`${dirOf(id)}/${DOC}`);
    if (text === null) return null;
    try {
      return { doc: docOf(yaml.parse(text), segmentOf(id)) };
    } catch {
      return { broken: true };
    }
  };

  /** Rewrite a page's own document. pages.ts owns `content.yaml`, and it cannot
   *  reach docs.ts to do this — that is the same directory, but the merge there
   *  is about variables and this is about shape. */
  const writeDoc = async (id: PageId, doc: PageDoc): Promise<void> => {
    await files.write(`${dirOf(id)}/${DOC}`, yaml.format(doc));
  };

  /** Directory entries, treating a directory that is not there as empty: a vault
   *  that has never been seeded has no `pages/`, and an empty workspace is not an
   *  error. */
  const entriesIn = async (rel: string): Promise<{ name: string; dir: boolean }[]> => {
    try {
      return await files.list(rel);
    } catch {
      return [];
    }
  };

  const dirsIn = async (rel: string): Promise<string[]> =>
    (await entriesIn(rel))
      .filter((e) => e.dir && !e.name.startsWith("_") && !e.name.startsWith("."))
      .map((e) => e.name)
      .filter((name) => SEGMENT.test(name));

  const filesIn = async (rel: string): Promise<Set<string>> =>
    new Set((await entriesIn(rel)).filter((e) => !e.dir).map((e) => e.name));

  /** The root page is not seeded, it is guaranteed. The top level is this page's
   *  children — `pages/home/children/` — so it has to exist before anything can
   *  ask what is at the top. Its name is the user's to change; its id is not.
   *
   *  IT IS BORN AS A PAGE THAT DRAWS ITSELF, with its own `index.html` beside
   *  its document. It used to be a `doc` page carrying one section of prose
   *  about `content.yaml`, New page and Reload — a format lesson read by
   *  somebody who has not yet seen a page. The shape the first screen wants is
   *  not a stack of sections: it is a band over a print carrying the one step a
   *  person has to take, and the doc plugin's frame exists to cap a part at the
   *  reading measure and centre it. A page whose SHAPE is the point draws
   *  itself, which is what the html page is for.
   *
   *  THE WORDS ARE STILL THE DOCUMENT'S. `ROOT_WORDS` goes into the page's own
   *  top-level keys, where the key IS the slot, so every sentence on that page
   *  opens under the caret and writes itself back — and the copy of the markup
   *  is theirs to restyle or throw away with the page.
   *
   *  THE MARKUP GOES DOWN FIRST, so there is no moment at which a document
   *  names a file that is not there: a page with no `plugin:` and no
   *  `index.html` draws the stand-in that says nothing draws it, and a first
   *  launch that raced itself would show a stranger exactly that.
   *
   *  An existing root is never touched — this only runs when there is none. */
  const ensureRoot = async (): Promise<void> => {
    if ((await files.read(`${PAGES_DIR}/${ROOT_PAGE}/${DOC}`)) !== null) return;
    await files.write(`${pageDir(ROOT_PAGE)}/${PAGE_DOCUMENT}`, rootPage);
    await writeDoc(ROOT_PAGE, {
      name: rootName,
      // No plugin: the page's own `index.html` is what draws it, and naming one
      // would be a second statement of something the directory already makes
      // true. `contents` is the doc plugin's input and is written by nobody
      // here for the same reason.
      plugin: DEFAULT_PLUGIN,
      variables: {},
      contents: [],
      input: { ...ROOT_WORDS },
    });
  };

  const refOf = (id: PageId, doc: PageDoc): PageRef =>
    typeof doc.uid === "string" ? { id, name: doc.name, uid: doc.uid } : { id, name: doc.name };

  /** A NEW IDENTITY. Sixteen characters of lowercase letters and digits off the
   *  platform's random source — long enough that two pages never share one and
   *  short enough to read in a file. It is minted here and in no second place:
   *  `create` writes one into a new page and `identify` into every page that
   *  has none. */
  const mintUid = (): string => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let out = "";
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  };

  /** What a page that cannot be read looks like in the tree. Its name is its own
   *  segment — the same thing a page with no `name:` already shows — and it is
   *  exactly where the folder says it is, because that fact never lived in the
   *  file that will not parse. */
  const brokenRef = (id: PageId): PageRef => ({ id, name: segmentOf(id) });

  /** The direct children of a page, off the FILESYSTEM: the directories under
   *  `<dir>/children/` that hold a `content.yaml`. Nothing reads a claim about
   *  who a parent is, and nothing has to read every page in the vault to find out
   *  who claims this one — which is the whole point of the folder being the
   *  hierarchy. */
  const childPages = async (id: PageId): Promise<Child[]> => {
    const out: Child[] = [];
    for (const name of await dirsIn(`${dirOf(id)}/${CHILDREN}`)) {
      const childId = `${id}/${name}`;
      const found = await readDoc(childId);
      if (found === null) continue; // a directory is a page iff it holds content.yaml
      out.push({ kind: "page", id: childId, name: "doc" in found ? found.doc.name : name });
    }
    // BY ID, WHICH IS THE DIRECTORY NAME, and never by the page's name.
    //
    // The tree draws these in order, so it has to be one the user can predict —
    // and the id is the thing they NAMED. A vault of dated notes is the case
    // that proves it: `2026-07-30-22-autonomous-is-the-promise` sorts into date
    // order for free, because somebody put the date at the front of the filename
    // for exactly that reason. Sorting by the page's NAME threw that away — a
    // note titled "Pivot: Autonomous Is the Promise" carries no date, so seven
    // pivots came out alphabetical by title and the folder stopped reading as a
    // history. It is also what Obsidian does with the same files, so the app and
    // the mirror agree about order rather than disagreeing quietly.
    return out.sort((a, b) => a.id.localeCompare(b.id));
  };

  /** Layer one. Pages and tables alike, in the order this page's own `contents`
   *  puts them — a child nobody has placed yet sorts after every one that has,
   *  which is the same bottom the reader appends it to.
   *
   *  It reads and never writes: placement is persisted by `read`, so asking a
   *  page what it holds cannot commit to the vault. */
  const childrenOf = async (id: PageId): Promise<Child[]> => {
    const kids = await childPages(id);
    // FOLDED, because a table's parent is the one page id in the system that did
    // not come out of the server's own tree — an agent writes it by hand when it
    // creates a table, and `home/notes` for a page called `home/Notes`
    // would leave the table matching no parent, rescued to the root by the rail
    // as an orphan, and left behind when its page moves.
    const here = foldId(id);
    for (const t of tableList()) {
      if (foldId(t.parent ?? ROOT_PAGE) !== here) continue;
      kids.push({ kind: "table", id: t.name, name: t.name, rows: t.rows });
    }

    // A page whose own document will not parse still HAS children — they are in
    // its `children/` directory, which is not the file that broke. It just has no
    // say in the order they come back in.
    const found = await readDoc(id);
    const names = found === null || !("doc" in found) ? [] : found.doc.contents.map((c) => c.name);
    const at = (c: Child): number => {
      const i = names.indexOf(childKey(c));
      return i === -1 ? names.length : i;
    };
    // Stable, so children nobody has placed keep the order they were gathered
    // in — pages by id, then tables.
    return kids.sort((a, b) => at(a) - at(b));
  };

  /** Depth first, parents before their children, siblings by id. A flat
   *  listing of a tree has to be ordered by something, and this is the order the
   *  rail draws in. */
  const walk = async (id: PageId, out: PageRef[]): Promise<void> => {
    for (const child of await childPages(id)) {
      const found = await readDoc(child.id);
      if (found === null) continue;
      // Listed even when it is broken, so the rail still reaches it and the
      // fallback can repair it.
      out.push("doc" in found ? refOf(child.id, found.doc) : brokenRef(child.id));
      await walk(child.id, out);
    }
  };

  const listPages = async (): Promise<PageRef[]> => {
    await ensureRoot();
    const out: PageRef[] = [];
    const root = await readDoc(ROOT_PAGE);
    if (root !== null) out.push("doc" in root ? refOf(ROOT_PAGE, root.doc) : brokenRef(ROOT_PAGE));
    await walk(ROOT_PAGE, out);
    return out;
  };

  /** Copy a page directory, subtree and all. `Files` has read, write, remove and
   *  list and no rename, which is the honest surface of a text-file store — so a
   *  move is a copy and a delete, and the commit ahead of it is what makes that
   *  survivable. */
  const copyTree = async (from: string, to: string): Promise<void> => {
    for (const entry of await entriesIn(from)) {
      if (entry.dir) {
        await copyTree(`${from}/${entry.name}`, `${to}/${entry.name}`);
        continue;
      }
      const text = await files.read(`${from}/${entry.name}`);
      if (text !== null) await files.write(`${to}/${entry.name}`, text);
    }
  };

  /** One `markdown.yaml`, or nothing. A file that will not parse is nothing too:
   *  a broken type scale must not be the reason a page stops opening, and the
   *  checker is where it is said out loud. */
  async function oneScale(path: string): Promise<MarkdownScale> {
    const text = await files.read(path);
    if (text === null) return {};
    try {
      return scaleOf(yaml.parseAny(text));
    } catch {
      return {};
    }
  }

  /** The house scale with this page's own merged over it, one property at a
   *  time — so a page that wants bigger headings says `h1` and inherits the rest
   *  rather than restating a scale that then drifts. */
  async function scaleFor(dir: string): Promise<MarkdownScale> {
    const [house, own] = await Promise.all([oneScale(SCALE), oneScale(`${dir}/${SCALE}`)]);
    return { ...house, ...own };
  }

  /** Does this section's markup declare that slot? Reads the section's own
   *  file, or the shipped default when it names none — the same two sources
   *  `drawSection` draws from, so the answer cannot disagree with what is on
   *  screen. */
  async function declaresSlot(id: PageId, held: Section | null, part: string): Promise<boolean> {
    // A page with no section is asked about its OWN document, which is where an
    // html page's slots are declared. The same guarantee either way: a part is
    // created only where some markup says the slot exists.
    let html: string;
    if (held === null) {
      html = (await files.read(`${dirOf(id)}/${PAGE_DOCUMENT}`)) ?? "";
    } else {
      const file = pageFile(held.data);
      const own = file === null ? null : await files.read(`${dirOf(id)}/${file}`);
      html = own ?? defaultSection;
    }
    // The attribute as the runtime matches it, in either quoting. A section that
    // builds its slots in script is not covered and says so by refusing: the
    // alternative is running the page's own code on the server.
    const wanted = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`data-g-part\\s*=\\s*["']${wanted}["']`).test(html);
  }

  return {
    list: listPages,

    async children(id: PageId): Promise<Child[]> {
      dirOf(id); // the id grammar, before anything is joined onto it
      return childrenOf(id);
    },

    /** ONE WALK FOR THE WHOLE TREE. The ids come from the same listing the
     *  rail draws, root first, and each page's children are read exactly as
     *  `children(id)` reads them, so the two can never disagree; a page whose
     *  children could not be read answers an empty list rather than taking
     *  the whole answer down with it. */
    async childrenAll(): Promise<Record<PageId, Child[]>> {
      const out: Record<PageId, Child[]> = {};
      const ids = [ROOT_PAGE, ...(await listPages()).map((p) => p.id).filter((id) => id !== ROOT_PAGE)];
      for (const id of ids) {
        try {
          out[id] = await childrenOf(id);
        } catch {
          out[id] = [];
        }
      }
      return out;
    },

    async read(id: PageId): Promise<Page | null> {
      // THE MAP HAS NO DIRECTORY, AND THAT IS THE DESIGN. `@map` is the rail's
      // own map of the whole workspace: a bare plugin page — the vault's own
      // `mindmap` document, no sections, no variables — answered here so the
      // runtime in the box has a page to read and draws nothing over the
      // plugin. Nothing is written for it, so there is nothing to migrate, move
      // or remove; `input.rail` tells the plugin it has no page to keep its
      // settings on. A page that wants a map of its own says `plugin: mindmap`.
      if (id === MAP_PAGE) {
        return {
          id,
          name: "Map",
          markdown: await scaleFor(DESIGN_DIR),
          variables: {},
          sections: [],
          plugin: MAP_PLUGIN,
          html: await pluginDocument(MAP_PLUGIN),
          input: { rail: true },
          ports: null,
          extensions: await extensionsFor(null),
        };
      }
      const dir = dirOf(id);
      const found = await readDoc(id);
      // NO `content.yaml`, NO PAGE. A directory under `children/` that holds no
      // document is not a page and never was; answering with an empty one would
      // put something in the rail that nothing can edit and nothing explains.
      if (found === null) return null;
      // It opens, and it opens without writing: the reconciliation below would
      // otherwise rewrite `content.yaml` from an empty document, and the act of
      // looking at the broken page would be the act that emptied it.
      if (!("doc" in found)) {
        return {
          ...brokenRef(id), markdown: {}, variables: {}, sections: [],
          plugin: DEFAULT_PLUGIN, html: MISSING_DOCUMENT, input: {}, ports: null, extensions: {},
        };
      }
      const doc = found.doc;

      const here = await filesIn(dir);
      const kids = await childrenOf(id);
      const byKey = new Map(kids.map((c) => [childKey(c), c]));

      // Layer two, and the whole of it. Additive only: a section already placed
      // is left exactly where the user put it, and the ones missing go at the
      // bottom, which is where a thing added to a folder turns up.
      //
      // ONLY ON A DOC PAGE. A section is the doc plugin's concept, so placing one
      // on a page drawn by anything else would write a key that page's own format
      // cannot hold — and the writer, which knows that, would refuse to spell the
      // document at all. A board still HAS its children; it asks for them with
      // `biom.children()` and draws them however it likes.
      const named = new Set(doc.contents.map((c) => c.name));
      const drawsSections = doc.plugin === DOC_PLUGIN;
      const added: Section[] = [];
      for (const [key, child] of byKey) {
        if (!drawsSections || named.has(key)) continue;
        // ONE SEGMENT, never a path: a page's contents only ever name its DIRECT
        // children, which is what keeps `@page-notes` a legal filename and lets
        // two parents each hold a "notes". It goes in the slot the shipped
        // default section declares, because that is what will draw it until
        // somebody writes a `@page-notes.html` beside the document.
        added.push({
          name: key,
          parts: {
            [DEFAULT_SLOT]: {
              type: "child",
              data: child.kind === "page" ? segmentOf(child.id) : child.id,
            },
          },
        });
      }
      if (added.length > 0) {
        doc.contents = [...doc.contents, ...added];
        // Persisted, or the position would not survive the next read. Written
        // only when something was actually added: a rewrite on every read would
        // put a commit in the vault every time a page was opened.
        await writeDoc(id, doc);
      }

      const sections: DrawnSection[] = [];
      for (const section of doc.contents) {
        const drawn = await sectionOfPage(section);
        if (drawn !== null) sections.push(drawn);
      }

      return {
        id,
        name: doc.name,
        ...(typeof doc.uid === "string" ? { uid: doc.uid } : {}),
        markdown: await scaleFor(dir),
        variables: doc.variables,
        sections,
        plugin: doc.plugin,
        html: await htmlOf(id, doc),
        input: doc.input,
        ports: null, // declared, never enforced — the framework grants everything
        // THE THREE RUNGS, MERGED FOR THIS PAGE. The page's own `plugins/` is
        // the nearest, and it reaches this page alone: a child's read walks
        // its own directory and never this one.
        extensions: await extensionsFor(dir),
      };

      async function sectionOfPage(section: Section): Promise<DrawnSection | null> {
        // THE PARENT'S OWN DRAWING, and it wins: a parent is looking at this
        // particular arrangement and the child is not. It is this section's
        // markup, so the parent draws the child however it likes and the child's
        // own `child.html` is not sent — it would be markup nothing asked for.
        const own = `${section.name}.html`;
        const parented = isChildKey(section.name) && here.has(own);
        const asked: Section = parented ? { ...section, data: own } : section;

        const drawn = await drawSection(
          asked,
          doc.variables,
          (f) => files.read(`${dir}/${f}`),
          defaultSection,
          async (content) => {
            // Resolved here so the runtime has the child's name and kind without
            // a second call. No child, no part — and the section keeps its place,
            // so if the child comes back it comes back where it was.
            const child = byKey.get(section.name);
            if (child === undefined) return null;
            // A TABLE HAS NO DIRECTORY, so there is nowhere for a `child.html` to
            // be and nothing is looked for. Only a page can say how it appears.
            if (parented || child.kind !== "page") return { kind: "child", child };

            // THE CHILD'S OWN DRAWING, read from the CHILD's directory. It rides
            // along on the part rather than replacing it, so the runtime still
            // has the name and the kind if it wants them — and when the file is
            // not there the part is exactly what it was and the built-in row
            // draws. Deleting it is therefore a supported act rather than a
            // broken page, which is why nothing on the read path ever puts it
            // back. `content` is not consulted: the child is found by matching
            // `childKey`, so the two sides cannot drift.
            void content;
            const html = await files.read(`${dirOf(child.id)}/${CHILD_DRAW}`);
            return html === null
              ? { kind: "child", child }
              : { kind: "child", child, draw: { file: CHILD_DRAW, html } };
          },
        );

        // A child section whose child has gone draws nothing at all. Its entry
        // stays in the document, so the place is kept.
        if (isChildKey(section.name) && !byKey.has(section.name)) return null;
        return drawn;
      }
    },

    /** Remove a section entirely — its entry, its own html file, the files its
     *  parts name, and its variables — in ONE operation.
     *
     *  It got SIMPLER when the sidecar went away, which is the point: the entry
     *  carries its own variables and its parts carry theirs, so removing the
     *  entry removes them, and the only things left to chase are the files it
     *  names. It used to be three writes and three ways to be half-done — an
     *  entry with no file drawing an empty block, a file nothing named sitting
     *  invisible on disk, and orphaned keys the checker warned about forever.
     *
     *  Answers the sections that remain, in order. */
    async removeSection(id: PageId, section: BlockId): Promise<BlockId[]> {
      const dir = dirOf(id);

      // A CHILD KEY IS NOT DELETABLE THIS WAY, and saying so is the point.
      // `@page-<name>` and `@table-<name>` are reconciled from what the page
      // actually holds, so dropping the entry only makes it reappend at the
      // bottom on the next read — the user would click delete and watch it come
      // back. The child is what removes it; its `.html` is what reverts the one
      // section to the default drawing.
      if (isChildKey(section)) {
        throw bad(
          "bad_request",
          "deleting the child removes it; deleting its .html puts the section back to the default drawing",
        );
      }
      if (!NAME.test(section)) throw bad("bad_request", "that is not a section name");

      const found = await readDoc(id);
      if (found === null) throw bad("not_found", "no such page");
      // Nothing on this path rewrites a file it could not read. The raw fallback
      // is where a broken document gets repaired, and removing a section through
      // one that will not parse would be the act that emptied it.
      if (!("doc" in found)) throw bad("flatness", "the document does not parse; repair it first");
      const doc = found.doc;

      const here = await filesIn(dir);
      const kept = doc.contents.filter((c) => c.name !== section);
      const names = kept.map((c) => c.name);

      // Everything on disk this section named: its own markup, and the file of
      // every `html` part in it.
      const gone = new Set<string>();
      for (const one of doc.contents) {
        if (one.name !== section) continue;
        for (const named of [one.data, ...Object.values(one.parts ?? {}).map(htmlFileOf)]) {
          const file = pageFile(named);
          if (file !== null && here.has(file)) gone.add(file);
        }
      }

      // Nothing to do is not a failure. A section already gone is the state the
      // caller asked for, and a commit for a no-op is noise in the history.
      if (kept.length === doc.contents.length && gone.size === 0) return names;

      await files.commit("Before removing a section from a page");
      // The document first: if a removal below fails, what is left is a file
      // nothing names, which is invisible. The other order leaves a section with
      // no markup, which draws the default over an empty slot.
      await writeDoc(id, { ...doc, contents: kept });
      for (const file of gone) await files.remove(`${dir}/${file}`);
      return names;
    },

    /** ONE SLOT'S TEXT, AND NOTHING ELSE ON THE PAGE.
     *
     *  This is the prose path, and it is the one the format nearly lost: the
     *  words used to live in `<id>.md` and go back through `writeFile`, and when
     *  they moved inside the document there was no longer anything that could
     *  write them. A typed paragraph had nowhere to go.
     *
     *  IT TOUCHES ONE SLOT BECAUSE IT FIRES ON A DEBOUNCE while somebody is
     *  typing. The file is read, one part's `data` is replaced, and the file is
     *  written back — so a value that arrived from somewhere else between two
     *  keystrokes survives, where a write that carried the whole document would
     *  put the screen's idea of the page over the top of it.
     *
     *  ONLY A MARKDOWN PART HOLDS ITS OWN TEXT. `data` means something different
     *  for every other type — a filename, a table, a child's segment — so writing
     *  prose into one of those would not be an edit, it would be the destruction
     *  of the pointer. Refused rather than allowed to happen once.
     *
     *  NO COMMIT. This is a keystroke path: a commit per debounce would bury the
     *  agent writes the vault's history exists to make undoable, which is the
     *  same judgement `docs.merge` already makes about a slot losing focus. */
    async writeSlot(id: PageId, section: BlockId | null, part: string, data: string | string[] | string[][]): Promise<void> {
      dirOf(id); // the id grammar, before anything is joined onto it
      if (section !== null && (typeof section !== "string" || !isSectionName(section))) {
        throw bad("bad_request", "that is not a section name");
      }
      if (typeof part !== "string" || !isPartName(part)) {
        throw bad("bad_request", "that is not a slot name");
      }
      // THREE SHAPES, TOLD APART BY THEIR FIRST ENTRY. Text is a slot's markdown;
      // a list of text is a list slot, written whole; a list of lists is a
      // grid's rows, written whole. An empty list is read as a list slot's
      // empty state, because a grid with no rows is still a grid and its rows
      // are written as `[]` by nobody — the grid plugin always writes at least
      // the header — so the ambiguity is settled towards the case that occurs.
      const grid = Array.isArray(data) && data.length > 0 && data.every((row) => Array.isArray(row));
      const list = Array.isArray(data) && !grid;
      if (!list && !grid && typeof data !== "string") throw bad("bad_request", "a slot's text is text");
      if (list && !(data as unknown[]).every((one) => typeof one === "string")) {
        throw bad("bad_request", "every item in a list is text");
      }
      if (grid && !(data as unknown[][]).every((row) => row.every((cell) => typeof cell === "string"))) {
        throw bad("bad_request", "every cell in a grid is text");
      }

      const found = await readDoc(id);
      if (found === null) throw bad("not_found", "no such page");
      // Nothing on this path rewrites a file it could not read: the raw fallback
      // is where a broken document is repaired, and saving a paragraph through
      // one that will not parse would be the act that emptied the page.
      if (!("doc" in found)) throw bad("flatness", "the document does not parse; repair it first");
      const doc = found.doc;

      // NO SECTION MEANS THE PAGE'S OWN TOP-LEVEL KEY, which is where an html
      // page keeps the words its `index.html` puts in a slot. There is nothing
      // between the slot and the document: the key IS the part.
      if (section === null) {
        if (doc.plugin === DOC_PLUGIN) {
          throw bad("bad_request", "a doc page's words are in its sections");
        }
        if (part === "name" || part === "plugin" || part === "variables") {
          throw bad("bad_request", "that name belongs to the page rather than to a slot");
        }
        const had = doc.input[part];
        if (had === undefined && !(await declaresSlot(id, null, part))) {
          throw bad("not_found", "no such slot");
        }
        if (had !== undefined && !(typeof had === "string" || (Array.isArray(had) && had.every((one) => typeof one === "string")))) {
          throw bad("bad_request", "that key does not hold words");
        }
        // A page's own top-level key holds words or a list of them, never a grid.
        if (grid) throw bad("bad_request", "a page's own slot holds words rather than a grid");
        if (!list && had === data) return;
        await writeDoc(id, { ...doc, input: { ...doc.input, [part]: data } });
        return;
      }

      const at = doc.contents.findIndex((c) => c.name === section);
      if (at === -1) throw bad("not_found", "no such section");
      const held = doc.contents[at]!;
      const was = held.parts?.[part];
      // A SLOT THE SECTION DECLARES AND THE YAML HAS NOT FILLED IS STILL A SLOT.
      // Its markup says `data-g-part="note"` and the page simply has nothing in
      // it yet, which is exactly the state somebody is in the moment before they
      // type the first word. Refusing that made "the words are always editable"
      // true of every slot except the empty ones — the ones most in need of it.
      //
      // THE MARKUP IS ASKED, not merely the caller. A part is created only where
      // the section's own html declares that slot, so a typo still lands on "no
      // such slot" instead of writing a key into `content.yaml` that nothing
      // draws and nobody can see. The file read is the cost of that guarantee
      // and it is paid once, on the first keystroke into an empty slot, never on
      // the debounced writes after it.
      if (was === undefined && !(await declaresSlot(id, held, part))) {
        throw bad("not_found", "no such slot");
      }
      // A LIST IS WRITTEN WHOLE, item for item. Each entry keeps the spelling it
      // had where the lengths still line up, so a list of plain markdown stays a
      // list of plain markdown and a `variables` on one item is not lost because
      // its neighbour was typed in.
      let next: PartValue;
      if (grid) {
        // A GRID'S ROWS REPLACE ITS ROWS AND NOTHING ELSE. `head` and the
        // content's own variables stay as they were, because the wire carries
        // rows and a write that reset the header to true would be the page's
        // editing surface deciding something nobody typed. Only a grid slot
        // takes rows: writing them over prose would destroy the prose, and
        // over a table would destroy the pointer.
        const content = was === undefined ? null : Array.isArray(was) ? null : contentOf(was);
        if (content === null || content.type !== "grid") {
          throw bad("bad_request", "only a grid slot holds rows");
        }
        const rows = rowsOf(data);
        if (sameRows(content.rows ?? [], rows)) return;
        next = { ...content, rows };
      } else if (list) {
        // A LIST GOES OVER A LIST, or over a lone markdown string a section is
        // promoting to one — never over a grid, a table, an html file or a
        // child. An empty array reads as a list, so without this `[]` sent at
        // a grid slot would replace its rows, its head and its variables with
        // an empty list and say nothing.
        if (was !== undefined && !Array.isArray(was) && typeof was !== "string") {
          const shape = contentOf(was);
          if (shape === null || shape.type !== "markdown") {
            throw bad("bad_request", "only a list slot takes a list" + (shape?.type === "grid" ? " — a grid takes its rows, one list per row" : ""));
          }
        }
        const before = Array.isArray(was) ? was : [];
        next = (data as string[]).map((text, at) => {
          const had = before[at];
          if (had === undefined || typeof had === "string") return text;
          const shape = contentOf(had);
          return shape === null || shape.type !== "markdown" ? text : { ...shape, data: text };
        });
      } else {
        const content = was === undefined ? { type: "markdown" as const, data: "" } : contentOf(was);
        if (content === null || content.type !== "markdown") {
          throw bad("bad_request", "only a markdown slot carries its own words");
        }
        // Nothing to do is not a failure, and it is the common case: the debounce
        // fires after a caret move as readily as after a keystroke.
        if (content.data === data) return;
        if (typeof data !== "string") throw bad("bad_request", "a slot's text is text");
        // The short spelling survives an edit to a plain paragraph, because that
        // is what somebody wrote and a save is not the moment to rewrite it.
        next = was === undefined || typeof was === "string" ? data : { ...content, data: data as string };
      }
      const contents = doc.contents.slice();
      contents[at] = { ...held, parts: { ...held.parts, [part]: next } };
      await writeDoc(id, { ...doc, contents });
    },

    /** THE ORDER, AND WHAT IS IN IT — adding, reordering and removing in one
     *  call, because `contents` IS the order and they are one edit to one list.
     *  There is no second place for a name to be in a different position.
     *
     *  ENTRIES ARE MATCHED BY NAME. A name already in the document keeps its own
     *  section — its markup, its slots and its variables — and takes only its new
     *  position from the caller, so a reorder built from what is on screen can
     *  never write a stale paragraph back over a newer one. A name that is new
     *  is added as given. A name that is absent is removed, and its text and its
     *  variables go with it, because they are IN the entry.
     *
     *  What it does NOT do is delete a file. `section.remove` is the operation
     *  that owns a section and everything on disk behind it, in one request and
     *  one commit; this one is about the list. A section dropped here leaves its
     *  html, which is why the delete control still goes through the other.
     *
     *  A CHILD KEY IS RECONCILED, NOT WRITTEN, and that decides both halves of
     *  what happens to one here. A stored child section the caller left out is
     *  put BACK, at the index it had — because dropping it would only make the
     *  next read reappend it at the bottom, so a reorder of two paragraphs would
     *  move somebody's child to the end of the page and nothing would say why.
     *  And a child key the caller INVENTED is refused: a section standing for a
     *  child that does not exist draws nothing and persists forever. Deleting the
     *  child is what removes its section, exactly as `removeSection` says. */
    async setSections(id: PageId, sections: Section[]): Promise<Section[]> {
      dirOf(id);
      if (!Array.isArray(sections)) throw bad("bad_request", "contents is a list");

      const asked: Section[] = [];
      const named = new Set<string>();
      for (const entry of sections) {
        const one = sectionOf(entry);
        if (one === null) throw bad("bad_request", "that is not a section");
        // One name, one section: two called `calc` would give a slot write two
        // places to land and the reader no way to say which.
        if (named.has(one.name)) throw bad("bad_request", "two sections cannot share a name");
        named.add(one.name);
        asked.push(one);
      }

      const found = await readDoc(id);
      if (found === null) throw bad("not_found", "no such page");
      if (!("doc" in found)) throw bad("flatness", "the document does not parse; repair it first");
      const doc = found.doc;

      const stored = new Map(doc.contents.map((c) => [c.name, c]));
      const next: Section[] = asked.map((one) => {
        const had = stored.get(one.name);
        if (had !== undefined) return had;
        if (isChildKey(one.name)) {
          throw bad(
            "bad_request",
            "a child's section is placed by the page holding it, not written into the list",
          );
        }
        return one;
      });

      // The child sections the caller could not see, put back where they were.
      // Ascending, so two of them keep their order relative to each other.
      doc.contents.forEach((c, i) => {
        if (!isChildKey(c.name) || named.has(c.name)) return;
        next.splice(Math.min(i, next.length), 0, c);
      });

      const same =
        next.length === doc.contents.length &&
        next.every((c, i) => c === doc.contents[i]);
      // A no-op is the state the caller asked for, and a commit for one is noise
      // in the history.
      if (same) return doc.contents;

      // This one IS a thing somebody did to the shape of a page — a section
      // added, dragged or dropped — so it is committed ahead of, exactly as a
      // removal is. The keystroke path above is the one that must not.
      await files.commit("Before changing what a page holds");
      await writeDoc(id, { ...doc, contents: next });
      return next;
    },

    async writeFile(id: PageId, file: string, text: string, quiet = false): Promise<void> {
      const dir = dirOf(id);
      const rel = pageFile(file);
      if (rel === null) throw bad("bad_request", "not a file this page can hold");
      if ((await files.read(`${dir}/${DOC}`)) === null) throw bad("not_found", "no such page");
      // Undo exists because the vault is a git repo and the server commits ahead
      // of the write, not because a snapshot mechanism was built. `quiet` is
      // the editor's keystroke path — a save every pause in typing — which
      // commits once when it opens the file rather than on every pause, the
      // way a slot losing focus does not commit either.
      if (!quiet) await files.commit(`Before a write to ${rel} on a page`);
      await files.write(`${dir}/${rel}`, text);
    },

    /** EVERY PAGE THAT HAS NO IDENTITY GETS ONE, on mount, file by file. A page
     *  that has one is never touched, and a page whose document will not parse
     *  is left alone rather than rewritten from nothing — the fallback repairs
     *  it and the next mount identifies it. One commit ahead of the sweep, not
     *  one per page: the vault's history should say *identified* once. */
    async identify(): Promise<number> {
      const refs = await listPages();
      // Read first, commit second: a page that will not parse is listed with no
      // uid and is not a page to write, so it must not be what earns a commit.
      const missing: { id: PageId; doc: PageDoc }[] = [];
      for (const ref of refs) {
        if (typeof ref.uid === "string") continue;
        const found = await readDoc(ref.id);
        if (found === null || !("doc" in found)) continue;
        missing.push({ id: ref.id, doc: found.doc });
      }
      if (missing.length === 0) return 0;
      await files.commit("Before every page was given an identity");
      for (const { id, doc } of missing) await writeDoc(id, { ...doc, uid: mintUid() });
      return missing.length;
    },

    async create(init: PageInit): Promise<PageRef> {
      await ensureRoot();
      // THE DESIGN DOC IS A PAGE, AND IT IS NOT IN THE TREE. Giving it an id
      // made every operation in this module reach it, including three that must
      // not: it has no parent to be created under, nowhere to be moved to, and
      // deleting it would take the workspace's design language with it. Its
      // CONTENT is fully editable — slots, sections, order, variables — which is
      // the whole point of the id; its existence is not.
      if (init.parent === DESIGN_PAGE) throw bad("bad_request", "the design doc holds no pages");
      if (init.parent === MAP_PAGE) throw bad("bad_request", "the map holds no pages");
      const name = typeof init.name === "string" ? init.name.trim() : "";
      if (name === "") throw bad("bad_request", "a page needs a name");

      // Nothing is parentless but the root. "No parent" means the top level, and
      // the top level is the root's children — that is the only place an ordering
      // for it could live, and now it is the only place on disk for it to be.
      const parent = init.parent ?? ROOT_PAGE;
      const parentDir = dirOf(parent);
      // The folder is the hierarchy, so a page cannot be created under a parent
      // that is not there: the directory would exist and nothing would ever walk
      // into it.
      if ((await files.read(`${parentDir}/${DOC}`)) === null) throw bad("not_found", "no such page");

      // FOLDED, which is the first of the two places case is ignored: a sibling
      // called `Airtable` makes `airtable` taken as well, because on a
      // case-insensitive filesystem they are the same directory and the second
      // page would be written into the first one's folder.
      const taken = new Set((await dirsIn(`${parentDir}/${CHILDREN}`)).map(foldId));
      const base = slug(name);
      let segment = base;
      for (let n = 2; taken.has(foldId(segment)); n++) segment = `${base}-${n}`;
      const id = `${parent}/${segment}`;

      // A page opens with something to read, and the words are IN the document —
      // there is no `.md` file beside it. One section, no `data`, so it takes the
      // shipped default and its one slot: the least a page can be that is still a
      // page, and the thing an agent edits first.
      // BORN WITH AN IDENTITY, so a run it starts today still names it after it
      // has been moved twice.
      const uid = mintUid();
      await writeDoc(id, {
        name,
        uid,
        // A NEW PAGE IS A DOCUMENT. It is the one kind somebody can start typing
        // into with nothing else in place; an html page needs a file written for
        // it, which is an agent's job rather than a dialog's.
        plugin: DOC_PLUGIN,
        variables: {},
        contents: [{ name: "title", parts: { [DEFAULT_SLOT]: `# ${name}\n` } }],
        input: {},
      });

      // EVERY NEW PAGE SAYS HOW IT LOOKS INSIDE ITS PARENT, from the first moment
      // it exists. The file is there to be edited rather than to be discovered.
      //
      // A vault with no `base/` — one never seeded, which is every unit test —
      // simply gets no file, and the page draws the built-in row. That is the
      // same state as deleting it, so there is one fallback and not two.
      const drawing = await files.read(CHILD_DEFAULT);
      if (drawing !== null) await files.write(`${dirOf(id)}/${CHILD_DRAW}`, drawing);

      return { id, name, uid };
    },

    async remove(id: PageId): Promise<void> {
      if (id === DESIGN_PAGE) throw bad("bad_request", "the design doc cannot be removed");
      if (id === MAP_PAGE) throw bad("bad_request", "the map is not a page and cannot be removed");
      const dir = dirOf(id);
      // The top level is this page's children. Removing it would leave every
      // ordering in the workspace with nowhere to live.
      // FOLDED, and this one is the reason the fold exists at all. `"Home"` is a
      // legal id now, an exact compare lets it past, and on macOS or Windows
      // `pages/Home` IS `pages/home` — so a remove of a page that does not exist
      // would take the root and every page in the workspace with it. Before ids
      // kept their case the segment grammar refused `Home` and nothing could
      // reach this line.
      if (foldId(id) === foldId(ROOT_PAGE)) throw bad("bad_request", "the root page cannot be removed");
      // Tolerant, because a page you cannot open is a page you cannot delete
      // either, and that is a trap rather than a fallback.
      const found = await readDoc(id);
      if (found === null) throw bad("not_found", "no such page");

      await files.commit("Before removing a page and everything inside it");
      // IT TAKES THE SUBTREE WITH IT, which is the price of the folder being the
      // hierarchy: the children are INSIDE this directory, and re-parenting them
      // would rewrite every id beneath it as a side effect of a delete. The vault
      // is a git repo and the commit above is one revert away, which is the same
      // answer the rest of the format gives.
      await files.remove(dir);
    },

    /** MOVE A PAGE, WHICH MOVES ITS DIRECTORY. There is no `parent:` to patch any
     *  more, so this is the only way one moves, and it is a real filesystem move:
     *  the page's id becomes `<parent>/<its own segment>` and EVERY ID BENEATH IT
     *  CHANGES TOO.
     *
     *  That cascade is the cost of the folder being the truth, and it is paid
     *  rather than hidden. Nothing in the vault forwards an old id: this answers
     *  the new one, and the caller — the store, which is the only thing that
     *  knows what the user is looking at — re-routes onto it. A client holding
     *  the old id gets `not_found` on its next read, which is a visible failure
     *  rather than a page quietly showing somebody else's content. */
    async move(id: PageId, parent: PageId): Promise<PageId> {
      if (id === DESIGN_PAGE) throw bad("bad_request", "the design doc cannot be moved");
      if (parent === DESIGN_PAGE) throw bad("bad_request", "the design doc holds no pages");
      if (id === MAP_PAGE) throw bad("bad_request", "the map is not a page and cannot be moved");
      if (parent === MAP_PAGE) throw bad("bad_request", "the map holds no pages");
      const from = dirOf(id);
      const parentDir = dirOf(parent);
      if (id === ROOT_PAGE) throw bad("bad_request", "the root page cannot be moved");
      // Into itself, or into its own descendant: the directory would have to
      // contain the directory it is being copied out of.
      // FOLDED for the same reason: `move("home/Notes", "home/notes/sub")` gets
      // past an exact compare, and `copyTree` then copies a directory into its
      // own descendant — which does not terminate.
      if (foldId(parent) === foldId(id) || foldId(parent).startsWith(`${foldId(id)}/`)) {
        throw bad("bad_request", "a page cannot be moved inside itself");
      }
      if ((await files.read(`${from}/${DOC}`)) === null) throw bad("not_found", "no such page");
      if ((await files.read(`${parentDir}/${DOC}`)) === null) throw bad("not_found", "no such page");

      const segment = segmentOf(id);
      const next = `${parent}/${segment}`;
      if (next === id) return id;
      const to = dirOf(next);
      // The filesystem already forbids two `children/notes` in one place, and
      // silently merging two pages into one directory is not a move.
      //
      // FOLDED, the second and last place case is ignored. Reading the target
      // path would answer this on a case-insensitive filesystem and miss it
      // here, so the same move would succeed on Linux and destroy a page on a
      // Mac. The check is made where the answer must not depend on the machine.
      const here = new Set((await dirsIn(`${parentDir}/${CHILDREN}`)).map(foldId));
      if (here.has(foldId(segment))) {
        throw bad("bad_request", "something by that name is already there");
      }

      await files.commit("Before moving a page");
      await copyTree(from, to);
      await files.remove(from);
      return next;
    },

    /** RENAME A PAGE, WHICH IS A MOVE WITH THE NAME WRITTEN FIRST. A page's
     *  last segment is spelled from its name when it is made, so a page called
     *  "Field notes" that still lives at `Notes/` has an id that says something
     *  the rail no longer does — the URL, the folder and the mirror file would
     *  all go on naming a page by a name it had. So the directory follows the
     *  name, by the same `slug` `create` used and with the same `-2` when a
     *  sibling already holds the segment, and the same cascade a move pays: every
     *  id beneath it changes, nothing forwards, and the answer is the new id.
     *
     *  A name that spells the segment the page already has is a rename of the
     *  name alone, and answers the same id — including a change of case, which
     *  the filesystem may not be able to tell apart. The ROOT keeps its id
     *  whatever it is called, because `ROOT_PAGE` is a constant every other id
     *  starts with. */
    async rename(id: PageId, name: string): Promise<PageId> {
      if (id === DESIGN_PAGE) throw bad("bad_request", "the design doc cannot be renamed");
      if (id === MAP_PAGE) throw bad("bad_request", "the map is not a page and cannot be renamed");
      const next = name.trim();
      if (next === "") throw bad("bad_request", "a page needs a name");
      const found = await readDoc(id);
      if (found === null) throw bad("not_found", "no such page");
      // A page whose document will not parse has words in it somebody wants
      // back, and rewriting the file from a document this could not read would
      // be how they are lost. The raw fallback is the way to repair it.
      if ("broken" in found) throw bad("flatness", "the page's document does not parse");

      const parent = parentOf(id);
      const segment = segmentOf(id);
      const from = dirOf(id);
      let to = id;
      if (parent !== null && foldId(slug(next)) !== foldId(segment)) {
        // The same folded check `create` and `move` make: a sibling that
        // differs only in case is the same directory on some machines.
        const taken = new Set((await dirsIn(`${dirOf(parent)}/${CHILDREN}`)).map(foldId));
        taken.delete(foldId(segment));
        const base = slug(next);
        let seg = base;
        for (let n = 2; taken.has(foldId(seg)); n++) seg = `${base}-${n}`;
        to = `${parent}/${seg}`;
      }

      await files.commit("Before renaming a page");
      await writeDoc(id, { ...found.doc, name: next });
      if (to === id) return id;
      await copyTree(from, dirOf(to));
      await files.remove(from);
      return to;
    },
  };
}

/** The file an `html` part names, or null for every other kind. Used only by
 *  `removeSection`, which has to take the whole of a section off disk. */
function htmlFileOf(part: PartValue): string | null {
  // A LIST has no single file: an `html` item inside one is named by that item,
  // and the caller wants every file this slot brought in. Answering the first is
  // the one thing that would be wrong, so a list answers for all of its items.
  if (Array.isArray(part)) {
    for (const one of part) {
      const found = htmlFileOf(one);
      if (found !== null) return found;
    }
    return null;
  }
  const content = contentOf(part);
  return content !== null && content.type === "html" ? content.data : null;
}
