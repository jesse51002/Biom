// SPDX-License-Identifier: AGPL-3.0-only
// The types every module speaks. Layer 0: imports nothing, does no I/O.
//
// FROZEN. Changing anything here is the one edit that touches every module, so
// it happens at a barrier and never inside a wave.
//
// The server reads these directly. The client reads them through JSDoc
// `@import`, which is why the runtime half lives in the sibling .js files and
// nothing in here emits code.

/* ── identity ──────────────────────────────────────────────────────────── */

/** WHERE A PAGE SITS, as a path: `architecture/architecture-graph`.
 *
 *  It used to be one flat directory name, unique across the vault, with a
 *  `parent:` line in the sidecar saying where it belonged — two statements of
 *  one fact, and the folder itself said nothing. An agent had to read every
 *  `content.yaml` under `pages/` to learn the shape of the workspace.
 *
 *  Now THE FOLDER IS THE HIERARCHY. A page lives at
 *  `pages/<a>/children/<b>/children/<c>/`, its id is `a/b/c`, and `parent:` is
 *  gone because a second statement of a fact is a chance for the two to
 *  disagree. Renaming a parent rewrites every id beneath it, which is the price
 *  of the folder being the truth rather than a mirror of it.
 *
 *  A CHILD KEY IS STILL ONE SEGMENT. A page's `contents` only ever name its
 *  DIRECT children, so `@page-<name>` carries no path and stays a legal
 *  filename. Two parents may each hold a "notes": the key is scoped to the file
 *  it appears in, and the filesystem already forbids two `children/notes` in one
 *  place. */
export type PageId = string;
export type BlockId = string; // section id, unique within a page, e.g. "board"
export type TableName = string; // sqlite table name
export type RowId = number; // sqlite rowid
export type PresetId = string;

/* ── the vault ─────────────────────────────────────────────────────────── */

/** A value somebody can change without writing code. Scalars and lists of
 *  scalars — never a nested structure, because a variable is a thing you type
 *  into a field. */
export type VarScalar = string | number | boolean | null;
export type VarValue = VarScalar | VarScalar[];
export type Variables = Record<string, VarValue>;
export type VarPatch = Record<string, VarValue>;

/** ONE FILE HOLDS EVERYTHING A PAGE SAYS.
 *
 *  `content.yaml` used to be flat — one `key: value` per line, no value ever
 *  containing a newline — with the prose in `<id>.md` files beside it and the
 *  section order in `order:`. Reading a page meant opening the sidecar to learn
 *  the shape and then one file per section to learn the words, and the values a
 *  section could show were bound to it by a naming convention: `calc.title`
 *  belonged to `calc` because of the dot.
 *
 *  It is one document now. `contents` is the ordered list, each entry carrying
 *  its own text, and `variables` are grouped where they are used instead of
 *  prefixed. An agent asked to change what a page says opens one file.
 *
 *  WHAT THAT COSTS, stated rather than hidden: a `content.yaml` that will not
 *  parse now loses the page's words as well as its shape, where prose in `.md`
 *  files used to survive it untouched. The answer is that the vault is a git
 *  repo and the server commits ahead of every agent write, so the last good
 *  version is one revert away, and the raw-YAML fallback still opens the file
 *  for repair by hand. */
/** WHAT A SLOT HOLDS. Never what a page holds — see `Section`. */
export type ContentType =
  /** `data` IS the markdown. `{{name}}` in it resolves against this content's
   *  variables, then the section's, then the page's. */
  | "markdown"
  /** `data` is a FILENAME beside `content.yaml`. HTML is long, is code rather
   *  than prose, and is the one thing a person is not editing in a field — so
   *  it stays a file. Every string it SHOWS still belongs in `variables`. */
  | "html"
  /** `data` is the table's name. */
  | "table"
  /** `data` is the direct child's segment — `notes`, never a path. Placed by
   *  reconciliation rather than written by hand. */
  | "child";

/** WHAT A SLOT HOLDS. It has no `name`: a slot's id is the key it sits under
 *  in `Section.parts`, so there is no second statement of it to disagree. */
/** What one slot holds: a bare string (markdown), a full `Content`, or a LIST of
 *  either — which is how a repeating thing is written. */
export type PartValue = string | Content | (string | Content)[];

export interface Content {
  type: ContentType;
  /** What it is or where it lives, depending on `type`. The two readings are the
   *  one wart in this shape and they are worth it: inlining an HTML file would
   *  put a program inside a document, and pointing at a markdown file would give
   *  back the second read this format exists to remove. */
  data: string;
  /** This content's own values. THE NEAREST ONE WINS: `{{rate}}` inside a
   *  content is this dict first, the section's second and the page's third, so a
   *  bare name is always the closest one and never a surprise. Reaching further
   *  than the page is a call rather than a template — see `variables` on the
   *  host surface. */
  variables?: Variables;
}

/** WHAT A PAGE HOLDS, AND THE ONLY THING A PAGE HOLDS.
 *
 *  A page used to hold a heterogeneous `contents` list — a markdown entry, an
 *  html entry, a table entry — drawn by whichever `render` the page had pinned.
 *  One render owned the whole sheet, so a page could have exactly one treatment
 *  and prose was one column at one measure. That is the limit this format
 *  exists to remove, and removing it took the render with it.
 *
 *  A section is a div. It is full width, it owns its own layout, and it holds
 *  any number of plugins wherever its own HTML puts them — so three columns of
 *  prose is ONE section with three markdown slots, which the old shape could
 *  not express at all.
 *
 *  THERE IS NO `type` KEY, because a section is the only thing `contents` can
 *  hold and a key that distinguishes nothing is a key that can be written
 *  wrong. A table on a page is a section whose one slot holds a table, not a
 *  different kind of entry with its own parser path. One shape, one code path,
 *  all the way down. */
export interface Section {
  /** Unique within the page. `^[a-z][a-z0-9_-]*$`, or a child key `@page-notes`. */
  name: BlockId;
  /** A FILENAME beside `content.yaml`, holding this section's own HTML.
   *
   *  Omitted resolves to the shipped default section — `guest/sections/default.html`,
   *  one centred slot named `body`. THE DEFAULT IS A FILE AND NOT A BRANCH, and
   *  that is load-bearing: a default living in the runtime would be the one
   *  shape nothing else could reach, and "the document" would be privileged
   *  again, which is exactly what the old doc render kept collapsing into. As a
   *  file it is the same mechanism every other section uses, and it is legible,
   *  copyable and replaceable.
   *
   *  The reading measure lives in that file rather than on the sheet, which is
   *  why full-bleed costs a section nothing. */
  data?: string;
  /** SLOT ID → WHAT GOES IN IT. One entry per `data-g-part` the section's HTML
   *  declares. A bare string is markdown, because prose is most of what a slot
   *  holds and `body: "..."` should not need a wrapper; an object is a full
   *  `Content`, so a slot takes a table or a child just as easily. */
  /** Slot id → what goes in it. A bare string is markdown, a map is a full
   *  `Content`, and **an ARRAY is a list of items** — each entry its own value,
   *  its own editable region, and its own thing to add or remove.
   *
   *  THE ARRAY IS WHY THERE IS NO CONVENTION. A repeating thing used to be one
   *  markdown string that the section cut up itself, at each `###` or at each
   *  list item — a format invented inside a format. The section and the person
   *  typing had to agree about a separator neither could see, and a heading
   *  typed by hand either became an item or silently did not. An item is an
   *  element now, so there is nothing to agree about and nothing to parse. */
  parts?: Record<string, PartValue>;
  /** This section's own values, in scope for every slot in it. */
  variables?: Variables;
}

/** WHAT THE RUNTIME DRAWS, which is not what the vault stores.
 *
 *  `Content` is the stored form — one entry in a section's `parts`, carrying
 *  its text or a filename. `Part` is that entry RESOLVED: the file loaded, the
 *  child looked up, and the variables in scope gathered. Keeping them apart is
 *  what confines the format change to the server.
 *
 *  There is no `diagram` kind. A diagram is a drawing a section makes — an
 *  inline svg laid out by the section's own script from its variables — or a
 *  fence handed to whichever plugin its info string names; a file type was a
 *  mechanism invented for a case that already had one. */
export type PartKind = "markdown" | "html" | "table" | "child";

export type Part =
  /** `md` is RAW, with `{{name}}` still in it. Interpolation happens where the
   *  part is drawn rather than where it is read, because prose is editable in
   *  place and writes back: resolving on the server would round-trip `62` over
   *  the top of `{{rate}}` and destroy the variable the first time somebody
   *  touched the paragraph it sits in. `vars` is what to resolve against. */
  | { kind: "markdown"; md: string; vars: Variables }
  | { kind: "html"; file: string; html: string; vars: Variables }
  /** A table drawn inline as a grid. Not the same as a `child` pointing at one:
   *  this embeds the data, that points at it. */
  | { kind: "table"; table: TableName }
  /** One of this page's children, drawn in place. Resolved at read time so the
   *  drawing has the name and kind without a second call.
   *
   *  `draw` is THE CHILD'S OWN `child.html`, read from the child's directory
   *  rather than the parent's. It inverts who decides how a child looks: a page
   *  knows how it wants to be summarised better than every page that might hold
   *  it, and without this the only way to customise a row was
   *  `@page-<id>.html` on the PARENT — written once per parent, and stale the
   *  moment the same page was held somewhere else.
   *
   *  Absent when the child has no `child.html`, and the child plugin draws its
   *  built-in row instead. That is the fallback, so deleting the file is a
   *  supported act rather than a broken page.
   *
   *  A parent's own `@page-<id>.html` still wins: the parent is looking at this
   *  particular arrangement and the child is not. */
  | { kind: "child"; child: Child; draw?: { file: string; html: string } }
  /** A LIST, resolved. Each item is a `Part` in its own right, drawn in order
   *  into the one slot and edited as its own region — so adding, removing and
   *  reordering are operations on an array rather than on a separator somebody
   *  has to parse out of a string. `items` never holds a list itself: a list of
   *  lists has no meaning here and is flattened when the page is read. */
  | { kind: "list"; items: Part[] };

/** A SECTION RESOLVED: its HTML loaded and its slots filled.
 *
 *  RESOLUTION HAPPENS ON THE SERVER, AND THAT IS NOT AN OPTIMISATION. The
 *  runtime that draws this lives in an opaque-origin frame — it cannot fetch,
 *  so anything it draws has to arrive inline in the `page.read` answer. A part
 *  that named a file and expected the guest to load it would simply never
 *  draw. */
export interface DrawnSection {
  name: BlockId;
  /** This section's markup: its own file, or the shipped default section. */
  html: string;
  /** True when the section named no file and took the shipped default. The
   *  editor reads it, and so does the checker warning about a page that is
   *  nothing but defaults — a generation that did not use the freedom it had. */
  fallback: boolean;
  /** Slot id → what is in it, resolved. Keyed exactly as `Section.parts` was. */
  parts: Record<string, Part>;
  vars: Variables;
  /** THE STORED ENTRY THIS WAS DRAWN FROM, carried so the runtime can DUPLICATE
   *  a section.
   *
   *  Everything else here is resolved and therefore lossy in the one direction
   *  that matters: `html` is the markup and not the filename that named it,
   *  `parts` holds loaded content and not the `data:` that pointed at it, and
   *  `vars` is the three scopes already merged rather than the section's own. A
   *  copy rebuilt from those would name no file, inline what was a pointer, and
   *  bake the page's variables into the section — which is three bugs to explain
   *  rather than one field to send.
   *
   *  It is the entry as the reader was handed it, so for a child section drawn
   *  by its parent the `data` is the one the parent supplied. Nothing duplicates
   *  a child section: a child's place is reconciled from the filesystem and
   *  `setSections` refuses one in the caller's list. */
  source: Section;
}

/** THERE IS NO FOLDER. Any page may have children, and a page that draws them
 *  is what a folder was — which is why the kind went away rather than being
 *  kept alongside. The workspace's Architecture page says a folder is a page
 *  that draws its children; this is that, with the special case removed
 *  instead of implemented.
 *
 *  Layer one of two, and the layer that matters: this is the DATA — what the
 *  children are and what kind each is — normalised and available to every page
 *  through `biom.children()`, whether or not the page draws any of them.
 *  Layer two is the drawing, and it is replaceable precisely because it reads
 *  this and nothing else. */
export interface Child {
  kind: "page" | "table";
  /** A PageId or a TableName. */
  id: string;
  name: string;
  /** Tables only. */
  rows?: number;
}

/** The block id standing for a child, and it has to be derived rather than
 *  generated: the whole guarantee is that a block already placed is left where
 *  it is, which is only possible if the same child yields the same key on every
 *  read. Prefixed and kind-tagged so it cannot collide with a section someone
 *  named `jobs`, and filename-safe because customising an entry means writing
 *  `@page-team-notes.html` beside it. */
/** ONE SEGMENT, never a path. A page's contents only ever name its DIRECT
 *  children, so the key is scoped to the file it appears in and two parents may
 *  each hold a "notes" without colliding. It also has to stay a legal filename,
 *  because customising an entry means writing `@page-notes.html` beside it. */
export const childKey = (c: Child): BlockId =>
  `@${c.kind}-${c.kind === "page" ? segmentOf(c.id) : c.id}`;

/** The page whose children are the top level. Every ordering in the product is
 *  then some page's `order:` — the rail is this page's children, a folder is any
 *  page's children, and there is no second mechanism and no workspace-level
 *  order file. Its name is the user's to change; its id is not. */
export const ROOT_PAGE: PageId = "home";

/** WHAT DRAWS A PAGE. A plugin is a page that reads a declared input, so naming
 *  one is how a page says which reader it is for — `html` reads the page's own
 *  `index.html`, `doc` reads `contents`, `kanban` reads a table and a column.
 *
 *  `kind:` was refused for years and this is not its return. That key claimed a
 *  page could be one of a closed set of THINGS the host understood; this one
 *  names a document that draws it, shipped or installed, and the host has no
 *  opinion about what any of them do beyond handing over the input. The set is
 *  open by construction: a plugin nothing ships is reached the same way. */
export type PluginName = string;

/** A page that names no plugin is its own html, because that is the shape with
 *  the fewest assumptions in it: a directory with an `index.html` is a page, and
 *  everything else is a reader somebody chose. */
export const DEFAULT_PLUGIN: PluginName = "html";
/** The document reader: sections, slots, markdown, the type scale. What every
 *  page in this format was before there was more than one kind of page. */
export const DOC_PLUGIN: PluginName = "doc";
/** The grammar a plugin name has to satisfy, which is a page-segment's grammar:
 *  it becomes a directory under the vault's `plugins/` — `plugins/<id>/index.html`
 *  for a plugin that draws a page, `plugins/<id>.js` for one that fills a
 *  slot. Nothing is shipped alongside any more: every plugin is a file in the
 *  workspace, so one name space, in one folder, answers for all of them. */
export const PLUGIN_NAME = /^[a-z][a-z0-9-]*$/;

/** What a page's `uid` looks like: lowercase letters and digits, eight to
 *  thirty-two of them, minted by the framework and never typed. One grammar,
 *  read by the codec that refuses anything else and by the mint. */
export const UID = /^[a-z0-9]{8,32}$/;

/** NO `parent`. The id is a path and the folder is the hierarchy, so a page's
 *  parent is everything before its last segment — derived, never stored, and so
 *  never able to disagree with where the page actually is. */
export interface PageRef {
  id: PageId;
  name: string;
  /** AN IDENTITY THAT SURVIVES A MOVE. The id is where a page sits and changes
   *  when the page does; this does not. Minted on `page.create`, written into
   *  every page that has none on mount, and named by every run a page starts,
   *  so a page moved under another parent still owns the runs it started.
   *  Absent only on a page whose document would not parse — the tolerant
   *  listing has no file to read it out of. The SIXTH contracts edit, taken
   *  with the automation kinds below on 2026-09-17. */
  uid?: string;
}

/** The markdown type scale. Its shape, its grammar and the walk that narrows
 *  a `markdown.yaml` into it live in `contracts/scale.ts`, which the page
 *  reader, the design reader and the checker all share. Imported as well as
 *  re-exported, because `Page` below names it. */
import type { MarkdownScale } from "./scale.ts";
export type { MarkdownScale } from "./scale.ts";

export interface Page extends PageRef {
  /** The markdown type scale for this page: the workspace's, with this page's
   *  own merged over it. Resolved here for the same reason sections are — the
   *  box cannot fetch, so a page that named a file would never draw it. */
  markdown: MarkdownScale;
  /** The page's own values, in scope for every section and every slot on it. */
  variables: Variables;
  /** What the page IS, in order, RESOLVED. The array is the order: there is no
   *  `index:` and no `order:`, so there is no second statement of it that can
   *  disagree with the first. */
  sections: DrawnSection[];
  /** WHICH READER DRAWS IT, and THE DOCUMENT THAT READER IS.
   *
   *  `html` is resolved by the server for the same reason a section's markup is:
   *  the box has an opaque origin and cannot fetch, so a page that named a file
   *  and expected the box to load it would never draw. It is the page's own
   *  `index.html` for an html page, and a shipped or installed plugin's
   *  `index.html` otherwise — the box does not know or care which. */
  plugin: PluginName;
  html: string;
  /** The page's own top-level keys, minus `name` and `plugin`: whatever the
   *  plugin drawing it declared it reads. Empty on a doc page. */
  input: Record<string, unknown>;
  /** Declared but never enforced in the framework. See PortSet. */
  ports: PortSet | null;
}


export interface PageInit {
  name: string;
  /** Which page it goes inside. The id it gets is this plus its own segment, so
   *  a page cannot be created anywhere other than where its id says it is. */
  parent?: PageId | null;
}

/** The parent of a page id, and the segment it is called by. `""` and the whole
 *  id for a top-level page. Derived rather than stored — see `PageRef`. */
export const parentOf = (id: PageId): PageId | null => {
  const cut = id.lastIndexOf("/");
  return cut < 0 ? null : id.slice(0, cut);
};
export const segmentOf = (id: PageId): string => id.slice(id.lastIndexOf("/") + 1);

/** `foldId` — an id folded for comparison — is a VALUE, so it lives in
 *  `wire.js` where the browser can load it, exactly like `DESIGN_PAGE`. See the
 *  note there for what it is for and why it is called in so few places. */

/** The design doc's address is a runtime VALUE, so it lives in `wire.js`
 *  where the browser can load it — this file is erased at runtime and a client
 *  module cannot import a value from it. See `DESIGN_PAGE` there. */

/* ── tables ────────────────────────────────────────────────────────────── */

/** "categories" is select + multi-select + status collapsed into one type: a
 *  value is any number of labels, each taking a colour from the workspace
 *  palette. Three types differing only in how many values they allowed was a
 *  distinction the user had to learn for nothing.
 *  "link" points at a row in another table; "page" points at a workspace page.
 *  Neither is ever expressed as a query — no SQL reaches the interface. */
export type ColumnType =
  | "text" | "number" | "checkbox" | "date" | "categories"
  | "person" | "url" | "email" | "phone" | "link" | "page";

export interface Column {
  name: string;
  type: ColumnType;
  /** Set ONLY on a column being renamed, and only in a `table.alter` request:
   *  the name this column had before. Without it `alter` receives two name
   *  lists and has to infer renames by position, which reads "drop one column
   *  and add another" as a rename — and guessing wrong silently destroys a
   *  column of data. An explicit `from` removes the guess entirely. */
  from?: string;
  /** categories only: the labels and the palette role each one takes. */
  options?: { label: string; colour: string }[];
  /** link only: which table, and which of its columns to show. */
  table?: TableName;
  show?: string;
  /** rendered width in px; null means the grid decides. */
  width?: number | null;
}

export interface TableSchema {
  name: TableName;
  /** "basic" = a typed grid the user edits. "sql" = the agent's own, listed
   *  and readable but not a primary surface. */
  kind: "basic" | "sql";
  columns: Column[];
}

export interface TableRef {
  name: TableName;
  kind: "basic" | "sql";
  rows: number;
  /** Which page holds it. Tables sit in the tree beside pages rather than in a
   *  section of their own, so a table can live next to the page that uses it —
   *  which is the grouping the tree exists to make possible. */
  parent: PageId | null;
}

export type Cell = string | number | boolean | null;

/** Rows carry their own id. The mock kept a Set of array references and found
 *  rows by object identity, which cannot survive coming from a database. */
export interface Row {
  id: RowId;
  cells: Record<string, Cell>;
}

export type RowInput = Record<string, Cell>;

export interface RowQuery {
  where?: Record<string, Cell>;
  order?: { column: string; dir: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

export interface TableView {
  schema: TableSchema;
  rows: Row[];
  total: number;
}

export type SqlParam = string | number | boolean | null;

export interface SqlResult {
  columns: string[];
  rows: Cell[][];
  changes: number;
}

/* ── ports: declared, never enforced ───────────────────────────────────── */

/** The framework grants artifacts unrestricted access, so nothing below is
 *  checked. The types and the Config screen ship anyway, empty, so that
 *  scoping later is a change in bridge.js rather than an edit to every
 *  artifact that exists. A port is a role — `total: number` — not a table
 *  name and not a column name. */
export interface Port {
  role: string;
  type: ColumnType;
  dir: "read" | "write";
}

export interface Binding {
  role: string;
  table: TableName;
  column: string;
  state: "ok" | "proposed" | "unbound";
}

export interface Destination {
  site: string;
  why: string;
  carries: string | null;
}

export interface PortSet {
  ports: Port[];
  bindings: Binding[];
  out: Destination[];
}

/* ── theme ─────────────────────────────────────────────────────────────── */

/** Nothing outside the theme data may name a colour. Every token is
 *  rewritable at runtime, which is how a generated page stays inside the
 *  scheme. Custom properties do not cross a document boundary, so the frame
 *  is handed this as data and re-declares it inside the artifact. */
export interface Palette {
  name: string;
  /** Keys are camelCase role names — `stockHi`, `ruleSoft`, `ink`. The CSS
   *  custom property is derived by kebab-casing the key and prefixing `--`,
   *  and BOTH sides of the frame boundary derive it independently because the
   *  guest cannot import. Changing the key form silently breaks theming inside
   *  every artifact, so it is stated here rather than left to convention. */
  colors: Record<string, string>;
  /** Colours added in Theme, available to anything generated. */
  extra: { name: string; value: string }[];
}

export interface TypeRoles {
  roles: { sheet: string; furniture: string; gauge: string };
  available: { name: string; stack: string; note: string }[];
}

/** THE BACKGROUND IS GONE, and it is worth saying why rather than leaving a
 *  hole. It was a tiled or shader-drawn layer under the whole workspace, and it
 *  cost a vendored WebGL bundle, a per-element mount registry and a fallback
 *  path — for a decoration that competed with the writing. A section that wants
 *  a background now draws one, scoped to itself, in ordinary CSS. */
export interface Theme {
  palette: Palette;
  fonts: TypeRoles;
}

/* ── the vault, as a thing you can change ──────────────────────────────── */

/** Which folder this workspace IS. The choice belongs to the person using it,
 *  not to an environment variable they have to know about — so it is pickable,
 *  and picking one sets it up.
 *
 *  THE FRAMEWORK HOLDS SEVERAL OPEN AT ONCE. Every request names the vault it is
 *  for in its url rather than in this envelope, so two tabs sit on two folders
 *  and neither can move the other — see `vaultOf` in `wire.js` for why an
 *  address is not a message. `VaultInfo` is therefore the answer to "which
 *  folder did you ask about", never to "which folder is open".
 *
 *  This is the one capability that is honestly server-side. The browser cannot
 *  hand out an absolute path and the vault lives on disk beside the agent that
 *  edits it, so the server browses its own filesystem and the UI shows what it
 *  finds. That is only reasonable because the framework is local and unsecured by
 *  decision; the product's answer is a workspace on a server and looks nothing
 *  like this. */
export interface VaultInfo {
  /** Absolute, because it is also what you type after `cd` to reach the agent. */
  path: string;
  /** The folder's own name, which is what the UI shows. */
  name: string;
  /** Whether it already holds a workspace, as opposed to being an empty folder
   *  about to become one. */
  seeded: boolean;
  /** Whether the folder is keeping versions, which is to say whether `git init`
   *  worked. False is a workspace with no undo, and the UI says so — a screen
   *  that promised every version was kept while nothing was being kept is the
   *  one claim this field exists to stop. */
  history: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  /** True when it already looks like a vault — has `pages/` in it. Lets the
   *  picker mark one you have used before rather than making them all look
   *  alike. */
  vault: boolean;
}

export interface DirListing {
  /** Where the listing is, absolute. */
  at: string;
  /** The parent, or null at the root of the filesystem. */
  up: string | null;
  dirs: DirEntry[];
}

/** Implemented by the composition root, because opening a vault means building
 *  every server module against another folder — a new Files, a new Db, a new
 *  everything above them, kept BESIDE the ones already up rather than replacing
 *  them. Nothing below layer 5 can do that, so the API layer is handed this
 *  rather than reaching for it.
 *
 *  Three of the four are about vaults rather than in one, and the root answers
 *  them whether or not the request named a folder — which is what makes the
 *  picker reachable before anything has been chosen. Only `info` is scoped to
 *  the vault the url named. */
export interface Vault {
  /** The folder THIS request was addressed to. Fails when it was addressed to
   *  none, because "which folder is this" has no default once several are
   *  open — the last one opened is somebody else's tab, not an answer. */
  info(): Promise<VaultInfo>;
  browse(path?: string): Promise<DirListing>;
  /** Mount `path`, which must already exist — you pick a folder by walking to
   *  it, and a path that conjures directories is a footgun in a picker. An
   *  EMPTY one is seeded on the way in; one that already holds a workspace is
   *  opened untouched. Mounting one does not unmount any other, and mounting
   *  one already up is the same object rather than a second copy. The answer is
   *  the vault asked for, which the caller then navigates to. */
  open(path: string): Promise<VaultInfo>;
  /** Make a folder and open it as a workspace. The answer is the vault that was
   *  made, which the caller then navigates to, exactly as `open` gives it.
   *
   *  A PARENT AND A NAME RATHER THAN A JOINED PATH, and that is the whole of
   *  why this is two arguments. Handed one string, a name carrying a separator
   *  makes a folder somewhere the person never chose — `Q3/notes` typed into a
   *  name field would land a workspace a level down, or with `..` in it,
   *  anywhere at all. Kept apart, the parent is a folder that was walked to and
   *  the name is one segment that has to satisfy the name rule, and neither can
   *  turn into the other. */
  create(parent: string, name: string): Promise<VaultInfo>;
  /** Vaults opened before, most recent first, so the common case is one click
   *  rather than a walk down the filesystem. */
  recent(): Promise<VaultInfo[]>;
}

/* ── automations and runs ──────────────────────────────────────────────── */

/** One field a run asks for before it starts, declared in the manifest and
 *  drawn as a form by the framework's own screens. `text`, `number` and
 *  `boolean` are the three things a field can be typed into. */
export interface AutomationInput {
  name: string;
  type: "text" | "number" | "boolean";
  default?: VarScalar;
  required?: boolean;
}

/** THE MANIFEST, `automation.yaml`, and it is thin on purpose: it says only what
 *  the framework has to know to start the thing. `agent` is a label for people
 *  and the framework reads nothing off it — there are no adapters and no vendor
 *  is known by name. `env` is NAMES: each is checked present in the server's
 *  own environment and never read from a file in the vault. `command` is a
 *  LIST and never a shell string, so an input cannot become a second command;
 *  `{name}` in it is an input, `{vault}` the vault's absolute path, `{run}` the
 *  run directory's and `{kickoff}` the substituted prompt file's. */
export interface AutomationManifest {
  name: string;
  description: string;
  agent: string;
  env: string[];
  command: string[];
  inputs: AutomationInput[];
}

/** One automation folder under one page: `<page dir>/automations/<folder>/`.
 *  `manifest` is null and `trouble` says why when `automation.yaml` will not
 *  parse — listed rather than dropped, because a folder somebody wrote is a
 *  thing to repair and not a thing to hide. */
export interface Automation {
  page: PageId;
  /** The page's identity, so a screen can name it after a move. Absent where
   *  the page has none yet. */
  uid?: string;
  folder: string;
  manifest: AutomationManifest | null;
  trouble: string | null;
}

/** A starting point `automation.create` copies: one folder per harness the
 *  framework ships beside its own code, never in the vault. */
export interface Template {
  id: string;
  name: string;
  agent: string;
}

export type RunStatus = "running" | "exited" | "killed" | "lost";

/** ONE ROW OF THE REGISTRY, `<vault>/.biom/runs.db`, and it is the whole of
 *  what the framework knows about a run: the automation it came from, the page
 *  that holds it, who started it, what was actually started, when, and how it
 *  ended. What the process PRINTED is two files the framework serves byte for
 *  byte and never reads — see `run.read`. `page` is the page that holds the
 *  automation and `by` is the page that pressed the button; the two differ
 *  when one page starts another's. */
export interface RunRow {
  id: string;
  page: PageId;
  /** The holding page's `uid`, so the row outlives a move and a rename. */
  uid: string | null;
  automation: string;
  /** Provenance: the `uid` of the page whose box started it, stamped by the
   *  bridge and never by the page, or null for the workspace's own screen. */
  by: string | null;
  command: string[];
  inputs: Record<string, VarScalar>;
  pid: number | null;
  pgid: number | null;
  started: number;
  ended: number | null;
  status: RunStatus;
  exit: number | null;
  signal: string | null;
  endedBy: "page" | "screen" | "shutdown" | null;
}

/** What `run.read` answers: bytes of one stream from an offset, where to read
 *  from next, and whether the run has ended — so a page follows a live log by
 *  asking again and stops the moment `ended` is true and `next` has caught up.
 *  `text` is UTF-8 decoded leniently: a multibyte character cut by `max` is
 *  repaired on the next read. */
export interface RunRead {
  text: string;
  next: number;
  ended: boolean;
}

/* ── the wire: what an artifact may say ────────────────────────────────── */

/** The protocol major. Its runtime value lives in `wire.js`; an unknown major
 *  is dropped silently, and at most two majors are ever live at once. */
export type Protocol = 1;

export interface Envelope {
  id: string;
  g: Protocol;
}

/** The framework grants unrestricted access, so this union is generous. It stays
 *  a separate type from ApiRequest anyway: the bridge accepts only this, so
 *  narrowing it later is a type change in one file rather than an allow-list
 *  to keep in sync. An artifact cannot ask to create a page for the same
 *  reason it cannot ask in French. */
export type HostRequest = Envelope &
  (
    | { kind: "data.get" }
    | { kind: "data.set"; patch: VarPatch }
    | { kind: "doc.get"; page: PageId }
    | { kind: "doc.list" }
    /** Layer one, reachable from an artifact: what this page holds. A page that
     *  wants to draw its own children its own way asks for this and draws it,
     *  which is what makes the built-in drawing replaceable rather than
     *  privileged. Omit `page` for the page the artifact is mounted on. */
    | { kind: "children"; page?: PageId }
    | { kind: "table.get"; name: TableName; query?: RowQuery }
    | { kind: "table.schema"; name: TableName }
    | { kind: "table.list" }
    | { kind: "row.insert"; name: TableName; row: RowInput }
    | { kind: "row.update"; name: TableName; row: RowId; patch: RowInput }
    | { kind: "row.remove"; name: TableName; row: RowId }
    | { kind: "sql"; query: string; params?: SqlParam[] }
    | { kind: "fetch"; url: string; init?: HostFetchInit }
    | { kind: "theme.get" }
    /** GO SOMEWHERE. The first request an artifact makes that is not about data
     *  at all — it asks the host to change what the person is looking at.
     *
     *  It exists because there was no way to make a drawing clickable, and that
     *  turned out to be a hole the moment a page could draw its own row: the
     *  built-in child row navigates through host code an artifact cannot reach,
     *  so replacing it with `child.html` silently LOST the click. A row you
     *  cannot follow is not a row.
     *
     *  A page or a table, because both sit in the tree and both are things a
     *  person opens. The shape is deliberately what `biom.children()`
     *  already hands back, so `g.open(child)` works with no translation.
     *
     *  IT IS A REQUEST AND NOT A GUARANTEE. The host decides — an id that does
     *  not exist is refused, and nothing here promises that a navigation the
     *  user did not ask for will be honoured. Reserving that is what stops a
     *  page from being able to trap somebody on it. */
    | { kind: "open"; target: { kind: "page" | "table"; id: string } }
    /** WHAT A `[[wikilink]]` NAMES, or null.
     *
     *  A page's prose carries links written the way a person writes them —
     *  `[[home/Companies/Airtable|Airtable]]`, and sometimes just `[[Airtable]]`
     *  — and a box has no page list to answer them with. So it asks, and gets
     *  back the same `{kind, id}` shape `open` takes: resolve, then open, with
     *  no translation in between.
     *
     *  IT IS SEPARATE FROM `open` ON PURPOSE. Resolving and navigating are two
     *  questions, and only one of them is a side effect — a page that wants to
     *  know whether a link is live (to draw a dead one differently) must be able
     *  to ask without moving the person off the page they are reading. */
    | { kind: "link.resolve"; target: string }
    /** ANOTHER PAGE'S VARIABLES. Reaching across a page boundary is a CALL and
     *  never a template: `{{name}}` stays inside one page so prose can be read
     *  without chasing it, and a page that depends on a page somebody else may
     *  rename should fail visibly rather than leave a blank in a paragraph.
     *
     *  This is the local-first join: a page can read what another page knows and
     *  draw something richer than a table with it. Omit `page` for the page you
     *  are mounted on. */
    | { kind: "variables"; page?: PageId }
    /** ANOTHER PAGE, DRAWN. A box asks for a page and the host answers with
     *  that page's complete woven document and TWO TRANSFERRED PORTS minted for
     *  it — see `PageEmbed`. The box puts the document in a nested iframe and
     *  relays the handshake: the nested frame's `parent` is the box, so its
     *  `hello` arrives there and the box answers it with the ports it was
     *  handed. The sandbox is inherited, so the nested frame is as opaque as
     *  the box, and it only ever holds ports the host minted for that page.
     *
     *  It reads nothing the runtime could not already read: the answer is the
     *  document `page.read` would build for that page, and everything drawn in
     *  the nested frame goes down those ports as it would from a box of its
     *  own. What it adds is COMPOSITION — a page that compares two others side
     *  by side, drawn as they are rather than re-rendered from their prose. */
    | { kind: "page.embed"; page: PageId }
    /** WHICH FOLDER THIS IS. `VaultInfo` — the absolute path, the folder's own
     *  name, whether it is seeded, whether it is keeping versions.
     *
     *  IT IS IN THE INNER RING BECAUSE A PERSON READING A PAGE HAS TO BE ABLE TO
     *  POINT AN AGENT AT IT. Everything in this workspace is edited by an agent
     *  opened in a folder, and the one thing a page could never say was which
     *  folder that is — so a page that wanted to tell somebody where to start
     *  had to send them to a host screen for it, or carry a path somebody typed
     *  into a variable, which is a fact that stops being true the day the folder
     *  moves. The host knows, and the answer costs it nothing to give.
     *
     *  IT TAKES NO ARGUMENT, AND THAT IS THE WHOLE OF THE RESTRICTION. The vault
     *  is an ADDRESS rather than a message — `vaultOf` in `wire.js` argues it —
     *  so this asks about the folder the request was already addressed to and
     *  there is no field with which to name another. A page may know where it
     *  lives; it may not look around, and it may not move.
     *
     *  Which is why `vault.browse`, `vault.open`, `vault.create` and
     *  `vault.recent` stay in the outer ring: each of those is about a folder
     *  OTHER than this one, and an artifact has no business reaching for one. */
    | { kind: "vault.info" }
    /** AUTOMATIONS AND RUNS, IN THE INNER RING, and the SIXTH contracts edit,
     *  taken at its own barrier on 2026-09-17.
     *
     *  A page may see every automation in the workspace, start any of them,
     *  read any run's row and log, and end any run — not only its own. The
     *  ring is not the wall: what will narrow this is a page's VIEW
     *  permission, on the row's `page`, when the sync engine has a model for
     *  one, and until then every page sees everything. The stamp on a run is
     *  provenance and not a filter — the bridge writes the starting page's
     *  `uid` into `by` over whatever the box sent, so a row's *started by* is
     *  a fact the browser enforces and not a claim the page made.
     *
     *  Every one of these reaches only what the framework knows: a manifest,
     *  a row, a file it serves without reading. None of them names a folder
     *  outside this vault and none of them reads a value out of the
     *  environment. Omit `page` to mean every page. */
    | { kind: "automation.list"; page?: PageId }
    /** START ONE. The framework assembles a directory of the run's own under
     *  `.biom/runs/<id>/`, substitutes `inputs` into the kickoff and the
     *  command, starts the command there and answers the row. Refused by name
     *  for an unknown automation, a missing required input, an `env` name the
     *  server's environment has not got, or a command that cannot be started.
     *  `by` is overwritten by the bridge and carried only for the workspace's
     *  own screen, which has no box to be stamped from. */
    | { kind: "run.start"; page: PageId; automation: string; inputs?: Record<string, VarScalar>; by?: string | null }
    /** Rows, newest first, across the workspace; narrowed only when asked. */
    | { kind: "run.list"; page?: PageId; automation?: string }
    | { kind: "run.get"; run: string }
    /** BYTES OF ONE LOG FROM AN OFFSET — `stdout` or `stderr` — with the next
     *  offset and whether the run has ended, so any page can follow any live
     *  log by reading again and stop when it is told to. The framework serves
     *  the file and never parses it: a line that means something is the
     *  page's to draw from what the run wrote. */
    | { kind: "run.read"; run: string; stream: "stdout" | "stderr"; from?: number; max?: number }
    /** END IT: the whole process group, TERM, a short grace, then KILL. The
     *  row says `killed` and by whom. */
    | { kind: "run.kill"; run: string }
  );

/** What `page.embed` answers. `embed` names the session for the notice that
 *  closes it; `html` is a complete document for `srcdoc`; the two ports travel
 *  in the message's transfer list, privileged first, ordinary second — the
 *  order the shim already reads at the handshake. */
export interface PageEmbed {
  page: PageId;
  embed: string;
  html: string;
}

export interface HostFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HostFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Closed enumeration. A contract whose error case is "it throws something"
 *  is not a contract. `message` never carries a path or a table name. */
export type HostErrorCode =
  | "unknown_kind"
  | "bad_request"
  | "not_found"
  | "flatness"
  | "sql_error"
  | "fetch_failed"
  | "limit"
  /** The call outlived its deadline. Distinct from `limit`, which means the
   *  host refused to start it — a caller may retry a timeout on a slow answer
   *  but should back off on a limit. */
  | "timeout"
  | "identity"
  /** The kind is known and this build does not offer it. Not the caller's
   *  fault and not worth retrying: `unknown_kind` would be a lie about a kind
   *  that exists, `bad_request` blames a request that was correct, and the
   *  retryable codes would have an artifact backing off and asking forever.
   *  What it means is *ask a different build*, and the message says which
   *  screen or which command is the way to the same thing. */
  | "unsupported"
  | "internal";

export interface HostError {
  code: HostErrorCode;
  message: string;
  retryable: boolean;
}

export type HostResponse = Envelope &
  ({ ok: true; value: unknown } | { ok: false; error: HostError });

/** host → guest, unprompted. Not a reply; carries no correlation id. */
export type HostEvent =
  /** ONE PER PAGE, not one per block. The box is the page, so the mount says
   *  which page it is and nothing narrower. */
  | { kind: "mounted"; g: Protocol; page: PageId }
  | { kind: "theme"; theme: Theme }
  /** Something this page draws from moved underneath it.
   *
   *  A workspace that supports structural change — sections reordered, a row
   *  edited in the grid, an agent rewriting a sidecar — has to be able to say
   *  so, or every artifact on screen is quietly stale until someone reloads by
   *  hand. There is no other way for an artifact to find out: it lives in an
   *  opaque-origin frame and cannot observe anything outside itself.
   *
   *  The runtime answers this itself by re-reading the page and re-filling
   *  every slot, so prose and children stay current for free. A plugin that
   *  draws from a table has to redraw, and registers `biom.onRefresh` to
   *  do it. */
  | { kind: "refresh"; change: Change }
  /** WHERE TO PUT THE BOX'S SCROLL, in pixels from the top, after a redraw.
   *
   *  A redraw is cold — the realm is torn down and built again from disk — so
   *  the position the reader was at dies with the old realm unless the host
   *  carries it across. The host cannot read it: it holds the last `position`
   *  notice the old realm sent, and hands it to the new realm on its `ready`.
   *  The shim clamps it to the new document's run, so a page that got shorter
   *  lands at its foot rather than past it, and applies it INSTANTLY, one frame
   *  after `ready` and once more after a short bounded delay for a layout that
   *  was still settling — never on a loop. It is sent only across a redraw the
   *  shell asked for (`FrameHost.keep`), so a page opened afresh starts at the
   *  top as it always did. */
  | { kind: "place"; top: number };

/** guest → host, unprompted. A null-origin frame's DOM cannot be read by the
 *  host, so everything the host needs to know arrives here.
 *
 *  THERE IS NO `size`. The box fills the canvas and scrolls inside itself, so
 *  it never reports a height — and that is load-bearing rather than a
 *  simplification. If the box sized itself to its content and the HOST page
 *  scrolled, the scroll container would be outside the box: `scroll()` and
 *  `view()` timelines would find no scroller, `position: sticky` would never
 *  stick, `100vh` would be meaningless and `IntersectionObserver` would have no
 *  root. Filling is what makes the box its own viewport, and it is why a
 *  section can drive a scroll effect at all. */
export type GuestNotice =
  /** Sent over `window.postMessage` the instant the shim runs, before any
   *  artifact script has executed. Its only job is to ask for the port, so it
   *  carries no slot count — the DOM does not exist yet.
   *
   *  Splitting this from `ready` is what stops a top-level `await` deadlocking
   *  the page. A `<script type="module">` is deferred, and DOMContentLoaded
   *  fires only after deferred scripts finish; so a handshake that waited for
   *  that event would be waiting on the very script that is waiting on the
   *  handshake, and the artifact would stall until the call timeout and then
   *  render nothing. Writing a module script with a top-level await is an
   *  entirely natural thing to do, so the contract accommodates it rather than
   *  forbidding it. */
  | { kind: "hello"; g: number }
  /** Sent over the port once the runtime has drawn, carrying the section count
   *  the host cannot scrape from an opaque-origin frame. Zero is a real answer
   *  and means an empty page, not a failure. */
  | { kind: "ready"; g: number; sections: number }
  | { kind: "error"; message: string; stack?: string }
  /** A box letting go of a session `page.embed` granted it — the nested frame
   *  was removed or is about to be reloaded. The host closes both ports and
   *  forgets the token. A session also dies with its parent, so this is the
   *  polite path and not the only one. */
  | { kind: "unembed"; g: number; embed: string }
  /** WHERE THE BOX IS SCROLLED TO, in pixels from the top. The shim reports it
   *  as the reader scrolls, coalesced to one per frame, and the host keeps only
   *  the latest — so that a redraw, which tears the realm down, can hand it
   *  back to the realm that replaces it as a `place` event. It is the box's own
   *  viewport and nothing about its content: a height is still never reported,
   *  and the clamp to the new run happens in the box, which is the only side
   *  that can measure it. */
  | { kind: "position"; g: number; top: number };

/* ── the wire: what the SECTION RUNTIME may say ────────────────────────── */

/** THE MIDDLE RING. `HostRequest` ⊂ `RuntimeRequest` ⊂ `ApiRequest`.
 *
 *  The runtime draws the page and owns editing it, so it needs to read the page
 *  and write its shape back. A section must never have those: a generated page
 *  that could call `section.order` could restructure the workspace it was asked
 *  to decorate. So the frame is handed TWO ports at the handshake — the runtime
 *  boots first, takes the privileged one into a closure and never exposes it,
 *  and everything mounted afterwards gets the guest port that `biom.*`
 *  wraps.
 *
 *  SAY WHAT THIS IS AND IS NOT. Inside the box that separation is a closure,
 *  not a browser guarantee: section code shares a realm with the runtime and
 *  could interfere with it. The browser-enforced wall is between THE BOX AND
 *  THE APP — no fetch, no cookies, no host DOM — and that is the boundary
 *  protecting the files, the server and every other page. Nothing in this
 *  repository may describe the in-box split as a security boundary. */
export type RuntimeRequest =
  | HostRequest
  | (Envelope &
      (
        | { kind: "page.read"; page: PageId }
        /** WRITE ONE SLOT'S TEXT. The prose path. It writes one part of one
         *  section and touches nothing else, because it fires on a debounce
         *  while somebody is typing — a kind that took the whole document would
         *  make every keystroke a chance to overwrite a change that arrived
         *  from somewhere else in between. */
        /** `data` is the slot's markdown, or an ARRAY of it when the slot holds a
       *  list. A list is written WHOLE: what the document holds is the array, and
       *  a wire that carried one item plus an index would have to be right about
       *  the index at a moment when another edit may have moved it. */
      /** `section` is null on a page that has no sections: an html page's slots
       *  are bound to the page's own top-level keys, so the key IS the part and
       *  there is nothing between it and the document. The same spelling
       *  `variables.patch` already uses for the page's own scope. */
      | { kind: "section.write"; page: PageId; section: BlockId | null; part: string; data: string | string[] }
        /** THE ORDER, AND WHAT IS IN IT. Adding, reordering, duplicating and
         *  removing are one kind because they are one edit to one list:
         *  `contents` IS the order, so there is no second place for a name to
         *  be in a different position. Entries are matched by name; a name that
         *  is new is added, one that is absent is removed with its text. */
        | { kind: "section.order"; page: PageId; sections: Section[] }
        /** Delete a section, ALL of it, in one operation: the entry, its parts
         *  and its HTML file. Three writes, one request, one commit in the
         *  vault's history for one thing the user did.
         *
         *  A CHILD KEY IS NOT DELETABLE THIS WAY and the server says so rather
         *  than pretending: `@page-<segment>` and `@table-<name>` are reconciled
         *  from what the page actually holds, so removing the entry only makes
         *  it reappend at the bottom. Deleting the CHILD is what removes it. */
        | { kind: "section.remove"; page: PageId; section: BlockId }
        /** The addressed form of `data.set`. A plugin's `data.set` carries no
         *  page because it is scoped to the box it was sent from, and a mount is
         *  a client-side fact the server must never guess at. `section` null
         *  patches the PAGE's variables. */
        | { kind: "variables.patch"; page: PageId; section: BlockId | null; patch: VarPatch }
        /** THE PAGE'S OWN MARKDOWN, reported by the code that drew it.
         *
         *  Every page renders itself as markdown, and the projection is derived
         *  rather than stored. WHO COMPUTES IT IS THE PAGE: the box is the only
         *  half that runs a page's code, so it is the only half that knows what
         *  a board or a hand-written document says in words — and the box cannot
         *  write a file, so it says the words and the host writes them.
         *
         *  It is in the MIDDLE RING and not the inner one. A section drawn on a
         *  page must not be able to rewrite the archive copy of the page it sits
         *  on; the runtime that drew the whole page is what may speak for it.
         *
         *  Sent after every draw and after every saved edit, so freshness is
         *  bounded by the last time somebody opened the page — which is what
         *  the workspace's Architecture page already accepts in exchange for a
         *  projection that cannot go stale against live data. */
        | { kind: "page.projection"; page: PageId; markdown: string }
      ));

/* ── the wire: what the workspace UI may say ───────────────────────────── */

/** THE OUTER RING, and a strict superset of `RuntimeRequest`. Everything here
 *  and not there is a thing neither a section nor the runtime may express — a
 *  page created or destroyed, a table's schema altered, another folder opened.
 *  The workspace UI is client zero of its own artifact contract: the grid
 *  issues the same `table.get` and `row.insert` a plugin does, so a contract
 *  that cannot express what the grid needs is found on day two rather than
 *  after generated pages exist in the wild. */
export type ApiRequest =
  | RuntimeRequest
  | (Envelope &
      (
        | { kind: "page.list" }
        | { kind: "page.create"; init: PageInit }
        | { kind: "page.remove"; page: PageId }
        /** MOVE A PAGE, which is now moving a directory.
         *
         *  It used to be a sidecar patch: `parent:` was a line in a file and
         *  reparenting was writing it. With the folder as the hierarchy there is
         *  no such line, so the move is real — the directory goes under the new
         *  parent's `children/`, and the page's id CHANGES because its id is
         *  where it sits. Every id beneath it changes too.
         *
         *  Which is why the answer is the NEW id: the caller is holding an id
         *  that has just stopped existing, and nothing forwards. A stale id gets
         *  `not_found` rather than somebody else's page, and the client re-routes
         *  on what comes back. */
        | { kind: "page.move"; page: PageId; parent: PageId }
        | { kind: "page.writeFile"; page: PageId; file: string; text: string }
        /** The whole document as text, for the fallback that opens a page whose
         *  YAML will not parse. It matters MORE than it did: the prose is in
         *  here now, so this is the only way back to a page whose one bad
         *  character took its words with it. */
        | { kind: "doc.raw"; page: PageId }
        | { kind: "doc.writeRaw"; page: PageId; text: string }
        | { kind: "table.create"; schema: TableSchema }
        | { kind: "table.alter"; name: TableName; schema: TableSchema }
        | { kind: "table.remove"; name: TableName }
        /** Move a table to another page. The page half of a move is a sidecar
         *  patch on the page itself; a table has no sidecar, so its parent is
         *  registry state and this is how it moves. */
        | { kind: "table.setParent"; name: TableName; parent: PageId | null }
        | { kind: "table.importCsv"; name: TableName; csv: string }
        | { kind: "theme.set"; theme: Partial<Theme> }
        /** ANOTHER folder — walked to, opened, made, or remembered. Every one of
         *  these is workspace-level state and an artifact may say none of them:
         *  a page that could open a folder could move the person off the
         *  workspace it was drawn in.
         *
         *  `vault.info` is NOT here, and the line between it and these is the
         *  argument for both. *Which folder is this* is about the folder the
         *  request already named, so it carries no path and cannot reach past
         *  the one it was addressed to; it sits in `HostRequest`, which says
         *  why. These four all name a folder that is not this one. */
        | { kind: "vault.browse"; path?: string }
        | { kind: "vault.open"; path: string }
        | { kind: "vault.create"; parent: string; name: string }
        | { kind: "vault.recent" }

        /** The design doc. Its own kinds, not `page.*` with a reserved id: the
         *  doc lives at `design/` rather than under `pages/`, and a user is
         *  free to keep a page of their own called `design` as well. */
        | { kind: "design.read" }
        | { kind: "design.patch"; section: BlockId | null; patch: VarPatch }
        | { kind: "design.writeFile"; file: string; text: string }

        /** HOW MANY RUNS ARE ALIVE, across every folder this process has
         *  mounted. The shell's one question before it closes a window, and
         *  the one kind that is about runs rather than in a vault — so it is
         *  answered on the UNPREFIXED route beside the three that are about
         *  vaults, where a request naming no folder can still ask it. */
        | { kind: "run.live" }
        /** A PAGE'S EDITABLE FILES, for its Instructions and Automations
         *  screens: its `INSTRUCTIONS.md`, and under `automations/<folder>/`
         *  each `kickoff.md`, `INSTRUCTIONS.md` and every file under `skills/`
         *  and `code/`. `page.writeFile` already writes one. */
        | { kind: "page.files"; page: PageId }
        | { kind: "page.readFile"; page: PageId; file: string }
        /** THE MANIFEST AS THE STRUCTURE THE FORM EDITS, read and written. The
         *  server is what writes the yaml, so a hand-edited file and a
         *  form-edited one are the same file. */
        | { kind: "automation.get"; page: PageId; automation: string }
        | { kind: "automation.set"; page: PageId; automation: string; manifest: AutomationManifest }
        /** The starting points New offers — one per harness the framework
         *  ships — and the copy it makes. `create` writes the template's files
         *  into `automations/<name>/` under the page and refuses a name that
         *  is already there. */
        | { kind: "automation.templates" }
        | { kind: "automation.create"; page: PageId; name: string; template: string }
        /** THE NAMES IN THE SERVER'S ENVIRONMENT, and nothing else about them,
         *  for the manifest form's picker. A value never crosses the wire. */
        | { kind: "env.names" }
        /** THE WORKSPACE'S OWN INSTRUCTIONS: `INSTRUCTIONS.md` at the vault
         *  root and the skills under `.agents/skills/`, and nowhere else. A
         *  skill the seeder wrote is marked `seeded` and the screens leave it
         *  out — the server knows its own roster, so no list travels here. */
        | { kind: "vault.files" }
        | { kind: "vault.readFile"; file: string }
        | { kind: "vault.writeFile"; file: string; text: string }

      ));

/** One editable file a page or the vault offers its screens. `seeded` is true
 *  of a file the framework wrote and rewrites — a copy nobody should edit in
 *  place. */
export interface VaultFile {
  path: string;
  seeded: boolean;
}

export type ApiResponse = HostResponse;

/* ── the module interfaces that cross an ownership boundary ────────────── */
//
// Everything below is implemented by one module and consumed by another, which
// is exactly what makes it a contract rather than an implementation detail.
// They live here so two people building either side cannot invent different
// shapes, and so a swap is one changed line in a composition root.

/** server/platform/files.ts — text files under one root, refusing every path
 *  that escapes it. Knows nothing about pages, blocks or tables. */
export interface FileEntry { name: string; dir: boolean }
export interface Files {
  read(rel: string): Promise<string | null>;
  write(rel: string, text: string): Promise<void>;
  remove(rel: string): Promise<void>;
  list(rel: string): Promise<FileEntry[]>;
  /** Commit the vault before an agent write, so undo exists without a
   *  snapshot mechanism. No-op when the vault is not a git repo. */
  commit(message: string): Promise<void>;
}

/** server/platform/db.ts — one SQLite file, parameterised statements. Has no
 *  idea what is stored in it. Nothing else in the framework may import it. */
export interface Db {
  all<T = Record<string, Cell>>(sql: string, params?: SqlParam[]): T[];
  run(sql: string, params?: SqlParam[]): { changes: number; lastInsertRowid: number };
  tx<T>(fn: () => T): T;
  close(): void;
}

/** WHAT content.yaml HOLDS, as it is stored. `Page` is this resolved — files
 *  loaded, children looked up — and this is what is written back.
 *
 *  `parent` is absent by design: the folder is the hierarchy and the id is a
 *  path, so where a page sits is where it IS rather than something it also
 *  claims. See `PageId`. */
export interface PageDoc {
  name: string;
  /** The page's identity, under `name:` in the file — see `PageRef.uid`. A
   *  host key and not a variable, so `{{uid}}` in prose resolves to nothing
   *  and a plugin's `input` cannot collide with it. Absent in a file this
   *  server has not yet opened; the mount writes one in. */
  uid?: string;
  /** WHICH READER DRAWS THIS PAGE. Absent in the file means `html`. */
  plugin: PluginName;
  variables: Variables;
  /** SECTIONS, and only on a doc page. `contents` IS the order — there is no
   *  `order:` and no `index:`, so there is no second statement of it that can
   *  disagree with the first. Empty on every other kind of page, because a
   *  section is the doc plugin's concept and nothing else knows what one is. */
  contents: Section[];
  /** EVERYTHING ELSE IN THE FILE, untouched. A plugin declares what it reads and
   *  the host validates none of it: `table`, `lanes` and `show` mean something
   *  to the kanban page and nothing here. Empty on a doc page, whose input is
   *  `contents` and `variables`.
   *
   *  It is a flat map of the top-level keys rather than a nested `input:` block
   *  because the file is what somebody reads: `table: plants` at the top of a
   *  page says what the page is far better than one more level of indent. */
  input: Record<string, unknown>;
}

/** server/platform/yaml.ts.
 *
 *  It was hand-rolled, and the header said why: flatness was the whole point,
 *  and a general parser would have accepted the nesting that broke the
 *  one-key-one-region mapping. That reason is gone with flatness — `contents`
 *  is a list of maps and prose is a block scalar — so it is a real parser now,
 *  vendored rather than invented. Only the SERVER parses; the client is handed
 *  `Page` as JSON and never sees YAML. */
export interface YamlCodec {
  parse(text: string): PageDoc;
  format(doc: PageDoc): string;
  /** ANY yaml, narrowed by whoever asked rather than by the codec. `parse`
   *  answers a `PageDoc` and refuses everything that is not one, which is right
   *  for `content.yaml` and useless for the other files a vault holds —
   *  `markdown.yaml` is not a page and must not be shaped like one on the way
   *  in. */
  parseAny(text: string): unknown;
}

/** server/domain/pages.ts — the vault format lives here and nowhere else. */
export interface Pages {
  list(): Promise<PageRef[]>;
  /** Layer one. Everything this page holds, pages and tables alike, in the
   *  order its own `order:` puts them. Available to every page whether or not
   *  it draws any of them. */
  children(id: PageId): Promise<Child[]>;
  read(id: PageId): Promise<Page | null>;
  /** REMOVE A CONTENT ENTIRELY, which is one write now and not three.
   *
   *  It used to be three: an entry in `order:`, the `<section>.*` keys in the
   *  flat sidecar, and the file holding the words. Two of those no longer
   *  exist — `contents` IS the order, and a content's variables live inside its
   *  own entry — so dropping the entry takes the text and the variables with it
   *  in a single write to `content.yaml`. Only an `html` content still names a
   *  file, and that file goes after the document rather than before it: a file
   *  nothing names is invisible, where an entry naming a file that is gone
   *  draws an empty block.
   *
   *  Answers the contents that remain. Refuses a child key, because
   *  `@page-<segment>` and `@table-<name>` are reconciled from what the page
   *  actually holds — removing the entry would only make it reappend. */
  removeSection(id: PageId, section: BlockId): Promise<BlockId[]>;
  /** One SLOT'S text, and nothing else on the page. The prose write path.
   *  `section` null is a top-level key of a page that has no sections. */
  writeSlot(id: PageId, section: BlockId | null, part: string, data: string | string[]): Promise<void>;
  /** The whole list, in order. Adding, reordering, duplicating and removing at
   *  once, because `contents` IS the order and they are one edit to one list. */
  setSections(id: PageId, sections: Section[]): Promise<Section[]>;
  writeFile(id: PageId, file: string, text: string): Promise<void>;
  create(init: PageInit): Promise<PageRef>;
  remove(id: PageId): Promise<void>;
  /** Move the directory under `parent`, and answer the page's NEW id. Everything
   *  beneath it moves with it and is renamed with it — the price of the folder
   *  being the hierarchy rather than a mirror of one. */
  move(id: PageId, parent: PageId): Promise<PageId>;
  /** WRITE A `uid` INTO EVERY PAGE THAT HAS NONE, file by file, never touching
   *  a page that has one. Run on mount. Answers how many were written. */
  identify(): Promise<number>;
}

/** server/domain/design.ts — the design doc, which is ONE page living at
 *  `design/` in the vault root rather than inside `pages/`.
 *
 *  It is a page in every way that matters — a `content.yaml`, sections, slots,
 *  the same runtime — and it is deliberately not in
 *  `pages/`, because that is what keeps it out of the tree without a reserved
 *  key, a hidden-id list or a third page kind. The rail draws `pages/`; this
 *  is not there; nothing had to learn about it.
 *
 *  It gets its own wire kinds rather than reusing `page.*` with a reserved id
 *  because a user may perfectly well keep a page of their own called
 *  `design`, and one id space cannot hold both.
 *
 *  Why it exists at all: it is the workspace's own design language — brand,
 *  voice, patterns, density — bundled by default and edited like any other
 *  doc, so that everything an agent generates in this vault comes out
 *  coherent instead of coming out generic. It is the thing an agent reads
 *  before it writes UI, and writes back to when the design language moves. */
export interface Design {
  read(): Promise<Page>;
  writeFile(file: string, text: string): Promise<void>;
  patch(section: BlockId | null, patch: VarPatch): Promise<PageDoc>;
}

/** The variables of a page, and the raw document behind them. Named for what
 *  it now is: there is no sidecar, because there is nothing beside the file. */
export interface Docs {
  read(id: PageId): Promise<PageDoc>;
  /** The raw fallback: ugly, always available, and the difference between a
   *  broken demo and a clumsy one. */
  readRaw(id: PageId): Promise<string>;
  /** Merge into one scope. `section` null patches the PAGE's variables; a name
   *  patches that section's, which is where a slot writes. */
  merge(id: PageId, section: BlockId | null, patch: VarPatch): Promise<PageDoc>;
  writeRaw(id: PageId, text: string): Promise<PageDoc>;
}

export interface Tables {
  list(): TableRef[];
  schema(name: TableName): TableSchema | null;
  rows(name: TableName, q?: RowQuery): TableView;
  insert(name: TableName, row: RowInput): RowId;
  update(name: TableName, id: RowId, patch: RowInput): void;
  remove(name: TableName, id: RowId): void;
  create(schema: TableSchema): void;
  /** Which page holds this table. A table sits in the tree beside pages, so
   *  moving one is this plus the two `order:` writes — the order decides where
   *  it sits, this decides whose child it is. Without it a dragged table leaves
   *  a key in the new page's order and stays listed under the old one. */
  setParent(name: TableName, parent: PageId | null): void;
  /** Add, rename, retype, reorder or drop columns against populated rows. */
  alter(name: TableName, next: TableSchema): void;
  drop(name: TableName): void;
  importCsv(name: TableName, csv: string): { added: number };
  sql(query: string, params?: SqlParam[]): SqlResult;
}

export interface Presets {
  /** DEAD ON THE WIRE, AND KEPT RATHER THAN DELETED. No `ApiRequest` kind
   *  reaches either of these two: they are what the marketplace called, and the
   *  catalogue went with the render layer it was written against. `contracts/`
   *  is frozen, so removing a member is a barrier edit and not a tidy-up —
   *  marked here so the next reader does not go looking for the caller. Only
   *  `seedIfEmpty` below is live. */
  list(): Promise<{ id: PresetId; name: string }[]>;
  install(id: PresetId): Promise<PageRef[]>;
  /** Set a vault up. A NEW VAULT HAS NO CONTENT: the root page and nothing
   *  else. Seeding somebody's folder with invented pages about a trade
   *  business was noise they had to delete before they could start.
   *
   *  What it does seed is the workspace's own furniture, none of which is
   *  content: the root page, the `design/` doc, the theme, and `AGENTS.md` +
   *  `.agents/skills/` so an agent pointed at the folder knows the format.
   *
   *  THE EMPTY EMPTY-STATE HAS NO ANSWER RIGHT NOW, and that is stated rather
   *  than papered over. It used to be the marketplace — install something that
   *  nearly works — and the catalogue went with the render layer it was written
   *  against. Until it is rebuilt, a new vault is a root page and the only way
   *  to fill it is to ask an agent.
   *
   *  It is ADDITIVE, file by file, and never overwrites. A vault made before
   *  a listing or a skill existed gains it on the next start; anything edited
   *  stays edited. */
  seedIfEmpty(): Promise<void>;
}

/** server/platform/process.ts — start a command in a directory with an
 *  environment, in a process group of its own, its two outputs piped to two
 *  files as they arrive; end a group with a signal, a grace and a kill. Layer
 *  1: it knows no vault and no run. */
export interface Started {
  pid: number;
  pgid: number;
  /** Settles when the process ends, however it ends. */
  done: Promise<{ exit: number | null; signal: string | null }>;
}
export interface ProcessRunner {
  start(spec: { cmd: string[]; cwd: string; env: Record<string, string>; stdout: string; stderr: string }): Started;
  /** TERM the group, wait `grace` ms, KILL what is left. Resolves when the
   *  group is gone. */
  end(pgid: number, grace: number): Promise<void>;
  alive(pid: number): boolean;
}

/** server/domain/runs.ts — the registry, the folder reader, the run
 *  directory's assembly, and the reconcile on mount. The one module beside
 *  `tables.ts` allowed to import `db.ts`. */
export interface Runs {
  automations(page?: PageId): Promise<Automation[]>;
  manifest(page: PageId, folder: string): Promise<AutomationManifest>;
  setManifest(page: PageId, folder: string, manifest: AutomationManifest): Promise<void>;
  templates(): Promise<Template[]>;
  create(page: PageId, name: string, template: string): Promise<Automation>;
  start(page: PageId, folder: string, inputs: Record<string, VarScalar>, by: string | null): Promise<RunRow>;
  list(filter?: { page?: PageId; automation?: string }): RunRow[];
  get(id: string): RunRow | null;
  read(id: string, stream: "stdout" | "stderr", from?: number, max?: number): Promise<RunRead>;
  kill(id: string, by: "page" | "screen" | "shutdown"): Promise<RunRow>;
  /** Every row still `running` whose process is not: marked `lost`. Run once
   *  on mount, before anything reads the table. */
  reconcile(): number;
  /** How many rows are `running` in this vault. */
  live(): number;
  /** End every live run, on the way out. */
  endAll(by: "shutdown"): Promise<void>;
  /** The files a page's screens may open and write. */
  pageFiles(page: PageId): Promise<VaultFile[]>;
  readPageFile(page: PageId, file: string): Promise<string | null>;
  /** The vault's own `INSTRUCTIONS.md` and `.agents/skills/`. */
  vaultFiles(): Promise<VaultFile[]>;
  readVaultFile(file: string): Promise<string | null>;
  writeVaultFile(file: string, text: string): Promise<void>;
}

/** client/transport/http.js — one method, one type. Two importers, both of
 *  which speak ApiRequest, so fetch → postMessage → network is one file. */
export interface Transport {
  call(req: ApiRequest): Promise<ApiResponse>;
}

/** What moved. Emitted by the store after every mutation it performs, and the
 *  single signal the whole workspace redraws from — the page views, the grid
 *  and every mounted artifact all consume this one feed rather than each
 *  guessing when their data went stale. */
export interface Change {
  /** The page whose files or sidecar moved. */
  page?: PageId;
  /** True when the page's SHAPE moved, not only its content — sections added,
   *  removed or reordered. A consumer holding derived structure must rebuild
   *  rather than patch. */
  shape?: boolean;
  /** Tables whose rows moved. Two artifacts can be two views of one table, so
   *  a write in either has to reach both. */
  tables?: TableName[];
  /** True when the workspace palette or type moved. */
  theme?: boolean;
}

export interface WorkspaceSnapshot {
  pages: PageRef[];
  tables: TableRef[];
  theme: Theme;
  /** The page currently open, fully read. */
  page: Page | null;
  table: TableView | null;
}

/** client/store/workspace.js — the client's single copy of workspace state.
 *  Every read of it and every write to it passes through here, which is what
 *  lets an artifact writing a row update the grid the user is looking at. */
export interface WorkspaceStore {
  get(): WorkspaceSnapshot;
  /** Redraw: something in the snapshot moved. Carries no detail, because a view
   *  reads the whole snapshot anyway. */
  on(fn: () => void): () => void;
  /** What moved. Separate from `on` because the frame host needs to know WHICH
   *  page and WHICH tables in order to tell the right artifacts, and a bare
   *  repaint signal cannot say. Fires after `on`, so the host UI is already
   *  consistent by the time an artifact is told to re-read. */
  onChange(fn: (change: Change) => void): () => void;

  loadTree(): Promise<void>;
  loadPage(id: PageId): Promise<Page | null>;
  /** The reload button: re-read from disk and drop every mounted frame. */
  reloadPage(id: PageId): Promise<Page | null>;
  createPage(init: PageInit): Promise<PageRef>;
  removePage(id: PageId): Promise<void>;
  /** ADDING, REORDERING AND DUPLICATING: one write, because `contents` IS the
   *  order and there is no second place for a name to sit.
   *
   *  It belongs on this interface for the same reason `removeSection` does — it
   *  moves the SHAPE of a page, so the rail, the Config screen and every box
   *  mounted on that page have to be told. It was implemented, documented and
   *  tested without ever being declared here, and the bridge forwarded past it
   *  to the transport instead: the section reached the file and nothing on
   *  screen ever heard about it. */
  setSections(id: PageId, sections: Section[]): Promise<Section[]>;
  /** Delete a section: the entry, the file and the keys, in one request so the
   *  vault gets one commit and the user gets one undo. */
  removeSection(id: PageId, section: BlockId): Promise<void>;
  writeFile(id: PageId, file: string, text: string): Promise<void>;

  /** `section` null is the page's own variables; a name is that section's. */
  patchVariables(id: PageId, section: BlockId | null, patch: VarPatch): Promise<PageDoc>;
  readDocRaw(id: PageId): Promise<string>;
  writeDocRaw(id: PageId, text: string): Promise<PageDoc>;

  loadTable(name: TableName, q?: RowQuery): Promise<TableView | null>;
  insertRow(name: TableName, row: RowInput): Promise<RowId>;
  updateRow(name: TableName, id: RowId, patch: RowInput): Promise<void>;
  removeRow(name: TableName, id: RowId): Promise<void>;
  createTable(schema: TableSchema): Promise<void>;
  alterTable(name: TableName, next: TableSchema): Promise<void>;
  dropTable(name: TableName): Promise<void>;
  importCsv(name: TableName, csv: string): Promise<{ added: number }>;

  setTheme(patch: Partial<Theme>): Promise<void>;

  /** The vault. ONE STORE IS ONE FOLDER, for as long as it exists: the vault a
   *  tab is on is in its url, so it is settled before this is constructed and
   *  nothing here can move it. `openVault` MOUNTS a folder on the server and
   *  answers with its info — it does not switch this store to it, and the
   *  caller navigates. That is why there is no invalidation here to get wrong;
   *  a store that half-swapped was the whole risk, and a store that cannot swap
   *  cannot half-swap. */
  vaultInfo(): Promise<VaultInfo>;
  browseVault(path?: string): Promise<DirListing>;
  openVault(path: string): Promise<VaultInfo>;
  /** Make a folder under `parent` called `name`, and mount it. Two arguments
   *  rather than a joined path, for the reason `Vault.create` gives: a name
   *  carrying a separator cannot become a folder somewhere nobody chose. */
  createVault(parent: string, name: string): Promise<VaultInfo>;
  recentVaults(): Promise<VaultInfo[]>;
  /** The design doc — read on demand rather than kept in the snapshot, because
   *  one screen wants it and nothing else redraws when it moves. */
  readDesign(): Promise<Page>;
  patchDesign(section: BlockId | null, patch: VarPatch): Promise<PageDoc>;
  writeDesignFile(file: string, text: string): Promise<void>;

  /* ── automations and runs: never cached, read on demand ──────────── */
  /** The workspace's own screens are client zero of the run kinds: the same
   *  six a page may say, through the transport with no box to be stamped
   *  from, and the outer-ring kinds beside them. Nothing here is kept in the
   *  snapshot — a run's row moves on its own clock and the stream says when. */
  automations(page?: PageId): Promise<Automation[]>;
  startRun(page: PageId, automation: string, inputs: Record<string, VarScalar>): Promise<RunRow>;
  runs(filter?: { page?: PageId; automation?: string }): Promise<RunRow[]>;
  run(id: string): Promise<RunRow | null>;
  readRun(id: string, stream: "stdout" | "stderr", from?: number, max?: number): Promise<RunRead>;
  killRun(id: string): Promise<RunRow>;
  liveRuns(): Promise<number>;
  pageFiles(page: PageId): Promise<VaultFile[]>;
  readPageFile(page: PageId, file: string): Promise<string | null>;
  manifest(page: PageId, automation: string): Promise<AutomationManifest>;
  setManifest(page: PageId, automation: string, manifest: AutomationManifest): Promise<void>;
  templates(): Promise<Template[]>;
  createAutomation(page: PageId, name: string, template: string): Promise<Automation>;
  envNames(): Promise<string[]>;
  vaultFiles(): Promise<VaultFile[]>;
  readVaultFile(file: string): Promise<string | null>;
  writeVaultFile(file: string, text: string): Promise<void>;
}

/** `map` is the rail's own map of the whole workspace, mounted on `MAP_PAGE`
 *  and drawn by the shipped `mindmap` plugin. It is a screen of the workspace
 *  like `design`, and it is the one addition this union has taken since. */
export type ViewName = "page" | "table" | "theme" | "vault" | "design" | "map" | "runs" | "instructions";

export interface UiState {
  route: { view: ViewName; id: string };
  /** WHICH SCREEN THE CANVAS HOLDS FOR THE OPEN PAGE. `page` is the box;
   *  `instructions` is one editor over the page's `INSTRUCTIONS.md`;
   *  `automation` is the page's automations — manifest, files, runs; `config`
   *  is the ports screen, offered in development only. */
  pageView: "page" | "instructions" | "automation" | "config";
  panel: null | "agent" | "history";
  inserting: number | null;
  dialog: boolean;
  /** Which page the New dialog will make something inside. Set by the plus on a
   *  row, so pointing at a level IS the answer to "where" and the dialog never
   *  asks again. `null` means the top level. */
  dialogParent: PageId | null;
  expanded: Set<PageId>;
  /** WHICH WAY THE RAIL READS. Ascending is the order the page itself puts its
   *  children in — which for anything the reader placed is id order, and an id
   *  is the directory name, so a folder of notes named `2026-07-30-…` is in date
   *  order because that is what putting the date first was for. Descending is
   *  that list read the other way: newest first, which is what you want the
   *  moment there are more than a screenful.
   *
   *  It REVERSES and never re-sorts. The order that arrived is the parent's own
   *  arrangement, and a view that sorted it again would overrule the one thing
   *  the format says belongs to the user.
   *
   *  THE ONE FIELD HERE THAT OUTLIVES THE TAB. It is a view preference and not
   *  workspace state — nobody else's rail changes because of it, and it is not
   *  written into any page — so it is remembered in `localStorage` rather than
   *  in the vault, seeded by the composition root and saved by the control that
   *  flips it. See the note on this interface. */
  treeOrder: "asc" | "desc";
}

/** client/store/ui.js — state the vault never sees. Separate from the workspace
 *  store because ephemeral UI state and a replica of server state have opposite
 *  lifetimes, and mixing them is how a reload button ends up resetting
 *  somebody's scroll position.
 *
 *  The store itself persists NOTHING and does no I/O. `treeOrder` is remembered
 *  across reloads, and it is the composition root that reads it out of
 *  `localStorage` on the way in and the control that writes it back — so this
 *  layer stays a plain box of values whichever fields happen to outlive a tab. */
export interface UiStore {
  get(): UiState;
  on(fn: () => void): () => void;
  set(patch: Partial<UiState>): void;
  go(view: ViewName, id: string): void;
}

/** client/bridge/bridge.js — resolves one HostRequest and refuses everything
 *  else. DOM-free by lint: it never sees an iframe and never knows the
 *  artifact is in a frame at all. */
/** ONE BOX IS ONE PAGE, so there is no block to name. Per-slot variable scope
 *  is resolved by the runtime out of the page it already holds, rather than
 *  being a fact the host has to be told on every call. */
export interface BridgeContext { page: PageId }

export interface Bridge {
  resolve(req: HostRequest, ctx: BridgeContext): Promise<HostResponse>;
}

/** client/frame/frame.js — the sandboxed iframe and the message plumbing.
 *  Frames are keyed and reused: without that, an artifact writing its own
 *  sidecar triggers a redraw that destroys the frame the user is working in. */
export interface Frame {
  el: HTMLIFrameElement;
  post(ev: HostEvent): void;
  drop(): void;
}
export interface FrameHost {
  setShim(source: string): void;
  for(key: string, html: string, ctx: BridgeContext): Frame;
  drop(key: string): void;
  broadcast(ev: HostEvent): void;
  /** Tell the artifacts a change actually reaches: frames mounted on the page
   *  that moved, and — because two artifacts are often two views of one table —
   *  every frame whenever a table moved. Sending it to everything would be
   *  simpler and would make each artifact re-read on every unrelated keystroke.
   */
  refresh(change: Change): void;
  /** Self-reported by the shim — the host cannot read a null-origin DOM. */
  compliance(key: string): { sections: number } | null;
  /** KEEP THE READER'S PLACE THROUGH THE REBUILD THAT FOLLOWS. The shell says
   *  this just before a redraw — the Reload button, or the watcher pressing it
   *  — and the box keyed `key` is put back where it was scrolled to, clamped,
   *  once the new realm says `ready`. Said before nothing, nothing is restored:
   *  a page opened afresh, or come back to, starts at the top as it always
   *  did. */
  keep(key: string): void;
}

/* ── the vault on disk ─────────────────────────────────────────────────── */
//  workspace/                     ← a git repo; the server commits before each
//    .git/                          agent write, so undo exists without an
//    workspace.db                   undo mechanism being built
//    theme.json
//    assets/                      ← images and anything else a page SHOWS but
//      kitchen.jpg                  does not read. Served, never parsed, and
//                                   beside pages/ rather than in it, because an
//                                   asset is usually wanted on more than one
//    plugins/                     ← this workspace's OWN plugins, served to the
//      timeline/                    box as classic scripts. A vault plugin may
//        plugin.js                  never claim a shipped id.
//    pages/
//      home/                      ← the root page, and the only one at the top
//        content.yaml
//        children/                ← structure, never the page's own files
//          q3-review/             ← id `home/q3-review`
//            content.yaml
//            hero.html            ← one section's markup
//            children/
//
//  THE FOLDER IS THE HIERARCHY. A page's id is the path of the segments that
//  reach it, there is no `parent:` key, and renaming a parent renames every id
//  beneath it — which is the price of the folder being the truth rather than a
//  mirror of it.
//
//  content.yaml is ONE DOCUMENT and `contents` is a list of SECTIONS AND
//  NOTHING ELSE. There is no `kind:`, because there is one kind of page; no
//  `render:`, because there is one reader; and no `order:`, because the array
//  IS the order and a second statement of it could only disagree:
//
//    name: Q3 review
//    variables:
//      quarter: Q3
//    page:
//      - plugin: progress         ← mounts once for the page, not per slot
//    contents:
//      - name: intro              ← no data: → the shipped default section,
//        parts:                     one centred slot named `body`
//          body: |
//            We shipped {{quarter}} on time.
//      - name: hero
//        data: hero.html          ← its own markup, its own layout
//        parts:
//          headline: "# Ship faster"
//          figures: { type: table, data: jobs }
//
//  A slot's value is markdown when it is a string and a `Content` when it is a
//  map, so a slot takes a table or a child as easily as prose. THERE ARE NO
//  `.md` FILES: an agent asked to change what a page says opens one document.
//
//  `{{name}}` comes back over the wire with the braces still in it, resolved
//  where the part is DRAWN and never here. Prose is editable in place and
//  writes back, so resolving on the server would round-trip `62` over the top of
//  `{{rate}}` the first time somebody touched the paragraph it sits in.
