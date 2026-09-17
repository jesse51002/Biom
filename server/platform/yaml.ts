// SPDX-License-Identifier: AGPL-3.0-only
// The vault format: `content.yaml` in, `PageDoc` out, and back again. Layer 1:
// no I/O, no Biom vocabulary beyond the shape contracts freeze, and its
// only imports are the frozen types and a vendored parser.
//
// IT USED TO BE HAND-ROLLED, and the header said why: the sidecar was FLAT —
// one key per line, no value ever spanning one — and a real YAML library would
// happily have accepted the nesting that broke the one-key-one-editable-region
// mapping. Enforcing flatness at the only door into the format was cheaper than
// enforcing it with a linter nobody runs.
//
// THAT REASON IS GONE. One file holds everything a page says now: `contents` is
// a list of maps and prose is a block scalar, so hand-rolling would mean
// inventing a YAML parser rather than refusing one. It is vendored instead —
// `yaml@2.9.0`, reached by a bare specifier through `tsconfig` `paths`, exactly
// as `markdown-it` is. ONLY THE SERVER PARSES: the client is handed `Page` as
// JSON and never sees YAML, so there is no import map and no browser build.
//
// The format, complete:
//
//   name: Q3 review
//   variables:
//     quarter: Q3
//   page:
//     - plugin: progress
//   contents:
//     - name: intro
//       parts:
//         body: |
//           We shipped {{quarter}} on time.
//     - name: hero
//       data: hero.html
//       parts:
//         headline: "# Ship faster"
//         figures: { type: table, data: jobs }
//
// A PAGE HOLDS SECTIONS AND NOTHING ELSE, which is what took `kind:` and
// `render:` out of this file. There used to be one render for the whole sheet,
// so a page had exactly one treatment; a section owns its own markup and its
// own layout, so the sheet has nothing left to decide and the keys that decided
// it are gone. Both are refused BY NAME below rather than ignored, because a
// file still carrying one was written against a format this reader does not
// have, and reading it silently would drop whatever that format put there.
//
// A SLOT'S ID IS ITS KEY IN `parts`. There is no `name:` on a content any more:
// the map already states it, and a second statement is a chance for the two to
// disagree. A bare string is markdown, because prose is most of what a slot
// holds and `body: "..."` should not need a wrapper; a map is a full `Content`,
// so a slot takes a table or a child just as easily.
//
// WHAT THIS MODULE STILL DOES NOT KNOW: that `hero.html` is a file, that a
// `@page-` name is a child, or that `{{rate}}` means anything. Interpolation in
// particular is THE CLIENT'S JOB — `data` comes back raw, braces and all,
// because prose is edited in place and writes back, so resolving here would
// round-trip `62` over the top of `{{rate}}` the first time somebody touched
// the paragraph it sits in.
//
// TWO PROPERTIES ARE LOAD-BEARING, and both are tested:
//
//   parse(format(d)) equals d          nothing a page says is lost on a save
//   format(parse(t)) is t              for any t this module wrote, so a slot
//                                      edit is a one-line diff and not a reflow
//
// The first is equality OF MEANING and not of spelling, and the one place that
// matters is a slot: `body: hello` and `body: {type: markdown, data: hello}`
// are the same part, so `format` writes the short spelling and the check below
// compares both sides canonicalised. Anything stricter would refuse to write a
// document it had just read.
//
// The second follows from the first, because `format` is a pure function of the
// document. The first is not assumed: `format` re-reads what it just wrote and
// refuses to hand back text that would not come back as the same page. A
// document that will not parse throws, and NOTHING HERE EVER WRITES A FILE IT
// COULD NOT READ.
//
// ONE THING THE VENDORED WRITER LEAVES RAW, and it is worth knowing: U+2028 and
// U+2029, the Unicode line separators. The hand-rolled writer escaped them
// because it split lines with a regex and a raw one split a line that must
// never split. YAML 1.2 does not treat them as breaks, so this parser reads
// back exactly what it wrote — but an EDITOR does, and so does a `.`-based
// pattern, so a page carrying one looks like it has an extra line in it. Word
// emits U+2028 for a soft line break, so it arrives the first time somebody
// pastes a sentence in. It is recorded rather than worked around: the fixes are
// editing a vendored file or dropping a character out of somebody's sentence,
// and neither is worth a cosmetic line break. tests/platform.test.ts pins the
// behaviour so a version bump that changes it is visible.

import { Document, Scalar, isMap, isScalar, isSeq, parseDocument } from "yaml";

import type { Content, ContentType, PageDoc, PartValue, PluginName, Section, VarScalar, VarValue, Variables } from "../../contracts/types.ts";
import { DEFAULT_PLUGIN, DOC_PLUGIN, PLUGIN_NAME } from "../../contracts/types.ts";

/** Anything that is not a legal page document. Carries the line so the raw-YAML
 *  fallback in the chrome can say where, which is the difference between a
 *  broken demo and a clumsy one.
 *
 *  THE API LAYER MAPS THIS ONTO THE `flatness` WIRE CODE. Catch the base class:
 *  a syntax error and a shape error are both "this file is not a page", and a
 *  caller that only caught one of them would map the other onto `internal`. */
export class YamlError extends Error {
  readonly line: number;
  constructor(message: string, line = 0) {
    super(line > 0 ? message + " — line " + String(line) : message);
    this.name = "YamlError";
    this.line = line;
  }
}

/** Specifically: it IS YAML, and it is not a page. The name is historical — it
 *  used to mean "this document nests" — and it is kept because the wire code it
 *  maps onto is `flatness` and renaming a frozen contract to tidy a class name
 *  is not a trade worth making. What it means now is SHAPE: `contents` is not a
 *  list, a section has no name, a variable is a nested map.
 *
 *  Separate from YamlError so a caller can tell "this file has a typo in it"
 *  from "this file is about something else" without reading a message. */
export class FlatnessError extends YamlError {
  constructor(message: string, line = 0) {
    super(message, line);
    this.name = "FlatnessError";
  }
}

/* ── the shape, as constants ───────────────────────────────────────────── */

/** What the top level of a page may hold, on every kind of page. A plugin's own
 *  configuration goes UNDER `input:` rather than beside these, so the host's keys
 *  and the plugin's can never collide — which they would: a board wants to name
 *  the column its cards are titled by, and the obvious name for it is `name`.
 *
 *  Anything else at the top level is refused rather than dropped, on any page: a
 *  page that is not a page is a broken page, not a quiet one. */
const PAGE_KEYS = new Set(["name", "plugin", "variables", "contents", "input"]);
/** A section: its id, its markup, its slots, its own values. No `type`, because
 *  a section is the only thing `contents` can hold and a key that distinguishes
 *  nothing is a key that can be written wrong. */
const SECTION_KEYS = new Set(["name", "data", "parts", "variables"]);
/** A slot's long spelling. No `name`: the key in `parts` is the slot's id.
 *  `rows` and `head` are a grid's and nothing else's — read for a grid, refused
 *  on anything else, because a `rows` on a markdown slot is a key nothing
 *  draws. */
const CONTENT_KEYS = new Set(["type", "data", "variables", "rows", "head"]);

/** The keys a page used to have and does not, each with the sentence that says
 *  what replaced it. Named one by one so a file written for an older format is
 *  told which one it was written for, rather than "unknown key". */
const RETIRED: ReadonlyMap<string, string> = new Map([
  ["kind", "there is one kind of page, and a section decides its own treatment"],
  ["render", "the render is gone: a section carries its own html"],
  ["order", "contents IS the order"],
  ["parent", "the folder a page sits in is where it is"],
  ["sections", "the key is contents"],
  ["page", "page-level plugins are gone: a page names ONE plugin, with plugin:"],
]);

/** No `diagram`. A diagram in a doc is a drawing in a section's own markup, or
 *  a fence a workspace's own plugin upgrades in place — the file type was a
 *  mechanism invented for a case that already had one. `grid` is the document's
 *  own table: its value is `rows`, not `data`. */
const CONTENT_TYPES = new Set<string>(["markdown", "html", "table", "child", "grid"]);

/** Assigning it would rewrite the prototype rather than add a key, and every
 *  key here comes off disk or out of an artifact. */
const FORBIDDEN_KEY = "__proto__";

/* ── reading ───────────────────────────────────────────────────────────── */

/** Read a `content.yaml`. Throws YamlError on YAML that will not parse and
 *  FlatnessError on YAML that parses into something that is not a page.
 *
 *  Defaults, all of them deliberate and none of them silent about a broken
 *  file: an absent `name` is `""` and the domain names the page after its
 *  folder; absent `variables`, `page` and `contents` are empty.
 *  Present-but-wrong is always a throw. */
/** ANY yaml, parsed and handed back as-is.
 *
 *  `parse` below narrows to a `PageDoc` and refuses everything that is not one,
 *  which is exactly right for `content.yaml` and wrong for every other file a
 *  vault holds. `markdown.yaml` is not a page and must not be shaped like one on
 *  the way in — put through `parse` it would come back as a document with no
 *  contents and the scale would be silently gone.
 *
 *  It narrows NOTHING. Whoever asked knows what they expect and validates it
 *  themselves; this only turns text into values and reports a syntax error in
 *  the same sentence and with the same line number `parse` would. */
export function parseAny(text: string): unknown {
  const doc = parseDocument(text, { version: "1.2", uniqueKeys: true, prettyErrors: true });
  const failure = doc.errors[0];
  if (failure !== undefined) throw new YamlError(headline(failure.message), lineOf(failure));
  return doc.toJS();
}

export function parse(text: string): PageDoc {
  const doc = parseDocument(text, { version: "1.2", uniqueKeys: true, prettyErrors: true });

  const failure = doc.errors[0];
  if (failure !== undefined) throw new YamlError(headline(failure.message), lineOf(failure));

  let js: unknown;
  try {
    js = doc.toJS();
  } catch (e) {
    // An alias with no anchor, or an alias expanded past the bomb limit. The
    // parser reports neither as an error; both throw here.
    throw new YamlError(headline(e instanceof Error ? e.message : String(e)));
  }

  return asPageDoc(js);
}

/** The first line of an upstream message. The rest is a blank line, the
 *  offending source and a caret under it — useful in a terminal, wrong in a
 *  toast, and it carries the file's own content into a message that gets
 *  handed to the wire. */
function headline(message: string): string {
  const first = message.split("\n", 1)[0] ?? message;
  // Upstream ends the sentence with " at line 3, column 1:" — the line is
  // carried structurally, so the duplicate and its dangling colon come off.
  return first.replace(/\s+at line \d+, column \d+:?$/, "").trim() || message.trim();
}

function lineOf(failure: { linePos?: [{ line: number }, { line: number }] }): number {
  return failure.linePos?.[0]?.line ?? 0;
}

function asPageDoc(js: unknown): PageDoc {
  const map = asMap(js, "a page");
  const plugin = asPluginName(map["plugin"]);

  unknownKeys(map, PAGE_KEYS, "a page");

  return {
    name: asName(map["name"]),
    plugin: plugin,
    variables: asVariables(map["variables"], "the page"),
    // SECTIONS ARE THE DOC PLUGIN'S INPUT and nobody else's, so `contents` on a
    // page drawn by anything else is a key belonging to a reader that is not
    // drawing it.
    contents: plugin === DOC_PLUGIN ? asContents(map["contents"]) : [],
    input: asInput(map["input"]),
  };
}

/** A PLUGIN'S OWN CONFIGURATION, carried through untouched. The host has no
 *  opinion about it and never validates it, because a host that validated one
 *  would have to know every plugin — so the plugin reports its own missing key,
 *  in words, where the page is drawn. */
function asInput(v: unknown): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  return asMap(v, "input");
}

/** WHICH READER DRAWS THIS PAGE. Absent is `html`: a directory with an
 *  `index.html` in it is a page, and everything else is a reader somebody
 *  chose. */
function asPluginName(v: unknown): PluginName {
  if (v === undefined || v === null) return DEFAULT_PLUGIN;
  if (typeof v !== "string" || !PLUGIN_NAME.test(v)) {
    throw new FlatnessError("plugin is a name in lowercase letters, digits and dashes");
  }
  return v;
}

function asName(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  // `name: 2026` is a page called "2026" that YAML read as a number. Reading it
  // back as text is the honest answer; refusing it is pedantry about quoting.
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new FlatnessError("name is a line of text");
}

function asContents(v: unknown): Section[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new FlatnessError("contents is a list — one entry per section, in order");
  }

  const out: Section[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of v.entries()) {
    const where = "contents entry " + String(i + 1);
    const map = asMap(raw, where);
    unknownKeys(map, SECTION_KEYS, where);

    const name = map["name"];
    if (typeof name !== "string" || name.trim() === "") {
      throw new FlatnessError(where + " has no name, and a section is addressed by its name");
    }
    if (seen.has(name)) {
      throw new FlatnessError('two sections are called "' + name + '" — a name is unique within a page');
    }
    seen.add(name);

    const section: Section = { name };
    // Absent means the shipped default section. A file named here is this
    // section's own markup, and it is a filename rather than inline html
    // because html is code, is long, and is the one thing nobody edits in a
    // field.
    const data = map["data"];
    if (data !== undefined && data !== null) section.data = asData(data, name);

    const parts = asParts(map["parts"], name);
    if (Object.keys(parts).length > 0) section.parts = parts;

    // Absent rather than empty, because the contract has it optional and a
    // format that writes `variables: {}` on every section is noise.
    const variables = asVariables(map["variables"], '"' + name + '"');
    if (Object.keys(variables).length > 0) section.variables = variables;

    out.push(section);
  }
  return out;
}

/** SLOT ID → WHAT GOES IN IT. The key is the slot's id, which is why a content
 *  carries no `name`. A bare string is markdown; a map is the long spelling. */
function asParts(v: unknown, section: string): Record<string, PartValue> {
  if (v === undefined || v === null) return {};
  const map = asMap(v, 'the parts of "' + section + '"');

  const out: Record<string, PartValue> = {};
  for (const key of Object.keys(map)) {
    if (key.trim() === "") throw new FlatnessError('a slot in "' + section + '" has no name');
    const held = map[key];
    // A LIST IS A LIST. Each item is read exactly as a single value is, so a
    // list of plain markdown is a list of block scalars and reads like what
    // somebody typed. An empty list is kept: it is what a slot holds before the
    // first item is added, and dropping it would leave nowhere to add one.
    out[key] = Array.isArray(held)
      ? held.map((one, at) => asPart(one, section, key + "[" + String(at) + "]"))
      : asPart(held, section, key);
  }
  return out;
}

function asPart(v: unknown, section: string, slot: string): string | Content {
  const where = '"' + slot + '" in "' + section + '"';
  // Prose is most of what a slot holds, so the short spelling is a bare string.
  // A number or a boolean is prose YAML read as a value — `body: 2026` — and
  // reads back as its own text rather than being refused over a missing quote.
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === undefined || v === null) return "";

  const map = asMap(v, where);
  unknownKeys(map, CONTENT_KEYS, where);

  const type = map["type"];
  if (typeof type !== "string" || !CONTENT_TYPES.has(type)) {
    throw new FlatnessError(where + " has type " + describe(type) + " — it is markdown, html, table, child or grid");
  }

  // A GRID HOLDS ROWS AND NOT DATA. `rows` on any other type is a key nothing
  // draws, and `data` on a grid is a string nothing reads; both are refused by
  // name rather than dropped, on the rule that a page that is not a page is a
  // broken page and not a quiet one.
  if (type === "grid") {
    if (map["data"] !== undefined && map["data"] !== null && map["data"] !== "") {
      throw new FlatnessError(where + " is a grid, and a grid holds rows rather than data");
    }
    const content: Content = { type: "grid", data: "", rows: asRows(map["rows"], where), head: asHead(map["head"], where) };
    const variables = asVariables(map["variables"], where);
    if (Object.keys(variables).length > 0) content.variables = variables;
    return content;
  }
  if (map["rows"] !== undefined) throw new FlatnessError(where + " has rows, and only a grid holds rows");
  if (map["head"] !== undefined) throw new FlatnessError(where + " has head, and only a grid has one");

  const content: Content = { type: type as ContentType, data: asData(map["data"], slot) };
  const variables = asVariables(map["variables"], where);
  if (Object.keys(variables).length > 0) content.variables = variables;
  return content;
}

/** A GRID'S ROWS: a list of lists of cells, every cell a string. A cell that is
 *  a number or a boolean is prose YAML read as a value — `- [2026, done]` — and
 *  reads back as its own text, the way a slot does. A row that is not a list, or
 *  a cell that is a map or a list, is refused: a cell is markdown and never a
 *  structure. An absent `rows` is an empty grid, which is what one holds before
 *  the first row is added. Every row is padded to the widest, so what the
 *  reader hands on is square and a column is a column all the way down. */
function asRows(v: unknown, where: string): string[][] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new FlatnessError("the rows of " + where + " are a list — one list per row");
  const rows: string[][] = v.map((row, at) => {
    if (!Array.isArray(row)) {
      throw new FlatnessError("row " + String(at + 1) + " of " + where + " is " + describe(row) + " — a row is a list of cells");
    }
    return row.map((cell, c) => {
      if (cell === undefined || cell === null) return "";
      if (typeof cell === "string") return cell;
      if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
      throw new FlatnessError("cell " + String(c + 1) + " of row " + String(at + 1) + " of " + where + " is " + describe(cell) + " — a cell is text");
    });
  });
  const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
  for (const row of rows) while (row.length < width) row.push("");
  return rows;
}

/** Whether the first row is the header. Absent is true, because a grid comes
 *  from a markdown table and every markdown table has one. */
function asHead(v: unknown, where: string): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "boolean") return v;
  throw new FlatnessError("the head of " + where + " is true or false — whether the first row is the header");
}

function asData(v: unknown, name: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  // A markdown slot that is only a number is prose YAML read as a number, and
  // an html slot pointing at a file called `2026` is the same mistake. Both
  // read back as their own text rather than being refused over a missing quote.
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new FlatnessError('the data of "' + name + '" is text — prose, a filename, or a name');
}

function asVariables(v: unknown, where: string): Variables {
  if (v === undefined || v === null) return {};
  const map = asMap(v, "the variables of " + where);

  const out: Variables = {};
  for (const key of Object.keys(map)) {
    out[key] = asVarValue(map[key], where, key);
  }
  return out;
}

function asVarValue(v: unknown, where: string, key: string): VarValue {
  if (Array.isArray(v)) {
    return v.map((item) => asVarScalar(item, where, key, true));
  }
  return asVarScalar(v, where, key, false);
}

function asVarScalar(v: unknown, where: string, key: string, inList: boolean): VarScalar {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new FlatnessError(String(v) + " is not a value anything can be set to — " + key + ", in " + where);
    }
    return v;
  }
  // A variable is a thing you type into a field. Nesting one is how the old
  // sidecar's one-key-one-region mapping broke, and the answer is the same:
  // refuse it at the door rather than let a form try to draw it.
  throw new FlatnessError(
    inList
      ? 'the list "' + key + '" in ' + where + " holds a map or a list — a variable is a scalar, or a list of them"
      : '"' + key + '" in ' + where + " is a map or a nested list — a variable is a scalar, or a list of them",
  );
}

/** A plain object off `toJS`, refusing an array and a scalar with a message
 *  that says what was expected rather than what arrived. */
function asMap(v: unknown, where: string): Record<string, unknown> {
  if (v === null || v === undefined) {
    throw new FlatnessError(where + " is empty — it is a map of keys");
  }
  if (Array.isArray(v) || typeof v !== "object") {
    throw new FlatnessError(where + " is " + describe(v) + " — it is a map of keys");
  }
  const map = v as Record<string, unknown>;
  if (Object.hasOwn(map, FORBIDDEN_KEY)) {
    throw new FlatnessError(FORBIDDEN_KEY + " is not a key");
  }
  return map;
}

function unknownKeys(map: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(map)) {
    if (allowed.has(key)) continue;
    // A key the format USED to have is named for what it was, which turns
    // "this page will not open" into "this page was written for the format
    // before this one".
    const was = RETIRED.get(key);
    throw new FlatnessError(
      was !== undefined
        ? '"' + key + '" is from an older format — ' + was
        : '"' + key + '" is not part of ' + where,
    );
  }
}

function describe(v: unknown): string {
  if (v === null || v === undefined) return "nothing";
  if (Array.isArray(v)) return "a list";
  switch (typeof v) {
    case "object":
      return "a map";
    case "string":
      return '"' + v + '"';
    default:
      return String(v);
  }
}

/* ── writing ───────────────────────────────────────────────────────────── */

/** How the document is written, and every one of these is load-bearing.
 *
 *  `lineWidth: 0` disables folding. A folded line reads back identically, so
 *  this is not about correctness — it is that folding turns one edited sentence
 *  into a reflowed paragraph, and the diff is the thing somebody reads to see
 *  what an agent did.
 *
 *  `nullStr: "null"` rather than the empty string, because a variable somebody
 *  deliberately cleared should read as cleared rather than as a key that forgot
 *  to say anything. */
/** `flowCollectionPadding: false` is for the one flow collection this writer
 *  makes — a grid's row, `[Piece, Where]` rather than `[ Piece, Where ]` — and
 *  touches nothing else, because everything else is written in block style. */
const WRITE = { lineWidth: 0, indent: 2, nullStr: "null", singleQuote: false, blockQuote: true, flowCollectionPadding: false } as const;

/** Key order in the file, fixed. What the page IS, then what it says.
 *  `plugin` second because it decides how everything under it is read, and
 *  `input` before `contents` for the reason `variables` is: it is short and
 *  contents is long, and a person opening the file should reach the prose by
 *  scrolling once. Inside `input` the keys keep the order they were written in,
 *  because they are the plugin's and this file has no opinion about them. */
const PAGE_ORDER = ["name", "plugin", "variables", "input", "contents"] as const;
/** A section, in the order somebody reads one: what it is called, what draws
 *  it, what it knows, and then the slots — which are the long part. */
const SECTION_ORDER = ["name", "data", "variables", "parts"] as const;

/** Write a `content.yaml`.
 *
 *  Deterministic: the same PageDoc always produces the same bytes. It does NOT
 *  sort — `contents` is the page's order and `variables` keeps the order it was
 *  read in, because sorting a document whose order is its meaning would reflow
 *  the file on every save.
 *
 *  MARKDOWN COMES BACK AS A BLOCK SCALAR wherever a block scalar can hold it.
 *  A person opens this file; prose folded onto one line with \n in it is the
 *  format failing at the only thing it exists for.
 *
 *  It verifies before it answers. `parse` is run over the text and the result
 *  compared with what was asked for, so text that would not read back as this
 *  page is never returned — and a caller writing it to disk cannot write a file
 *  it could not read. */
export function format(doc: PageDoc): string {
  const text = write(doc, true);
  if (sameDoc(readBack(text), doc)) return text;

  // A block scalar has spellings a value can slip out of — a line that is only
  // whitespace is the one that actually arrives. Fall back to the quoted form,
  // which is uglier and always exact, rather than hand back a lie.
  const quoted = write(doc, false);
  if (sameDoc(readBack(quoted), doc)) return quoted;

  throw new FlatnessError("this page has no spelling in the vault format");
}

function readBack(text: string): PageDoc | null {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

function write(doc: PageDoc, blocks: boolean): string {
  const isDoc = doc.plugin === DOC_PLUGIN;
  const shape: Record<string, unknown> = {
    name: doc.name,
    // ALWAYS WRITTEN, even where the file it came from left it out. A page that
    // states what draws it can be read by somebody who has never seen this
    // format, and the default is only a default at the moment of parsing.
    plugin: doc.plugin,
    // Absent rather than `{}`: an empty map on a page that has no variables is
    // furniture nobody put there.
    ...(Object.keys(doc.variables ?? {}).length > 0 ? { variables: doc.variables } : {}),
    // Absent rather than `{}` for the same reason `variables` is.
    ...(Object.keys(doc.input ?? {}).length > 0 ? { input: doc.input } : {}),
    // `contents` is a doc page's spine, so it is always present there even when
    // empty — a file without it reads as truncated. On any other page it would
    // be a key belonging to a reader that is not drawing it.
    ...(isDoc ? { contents: (doc.contents ?? []).map(sectionShape) } : {}),
  };

  const out = new Document(orderKeys(shape, PAGE_ORDER), { version: "1.2" });
  if (blocks) markBlockScalars(out);
  markGridRows(out);
  return out.toString(WRITE);
}

function sectionShape(section: Section): Record<string, unknown> {
  const shape: Record<string, unknown> = { name: section.name };
  // Omitted means the shipped default, so writing `data: null` on every plain
  // section would put a key in the file that says nothing.
  if (typeof section.data === "string" && section.data !== "") shape["data"] = section.data;
  if (Object.keys(section.variables ?? {}).length > 0) shape["variables"] = section.variables;

  const parts = section.parts ?? {};
  if (Object.keys(parts).length > 0) {
    const out: Record<string, unknown> = {};
    for (const [slot, part] of Object.entries(parts)) out[slot] = partShape(part);
    shape["parts"] = out;
  }
  return orderKeys(shape, SECTION_ORDER);
}

/** THE SHORT SPELLING WHERE IT MEANS THE SAME THING. A markdown slot with no
 *  values of its own is written as a bare string, because that is the spelling
 *  a person writes and the one the format exists for. Everything else takes the
 *  map, which says what it is. `sameDoc` canonicalises both, so a document read
 *  in one spelling and written in the other is still the same page. */
function partShape(part: PartValue): unknown {
  // A LIST IS WRITTEN AS A LIST. Each item is shaped the way a single value is,
  // so a list of plain markdown comes back as a list of block scalars and reads
  // like what somebody typed.
  if (Array.isArray(part)) return part.map((one) => partShape(one));
  const content = partOf(part);
  if (content.type === "markdown" && Object.keys(content.variables ?? {}).length === 0) {
    return content.data;
  }
  // A GRID IS WRITTEN AS ROWS AND NO DATA. `head` is written only when it is
  // false, because true is what absent means and a key that says the default
  // on every grid is furniture.
  if (content.type === "grid") {
    const shape: Record<string, unknown> = { type: "grid" };
    if (content.head === false) shape["head"] = false;
    shape["rows"] = (content.rows ?? []).map((row) => row.slice());
    if (Object.keys(content.variables ?? {}).length > 0) shape["variables"] = content.variables;
    return shape;
  }
  const shape: Record<string, unknown> = { type: content.type, data: content.data };
  if (Object.keys(content.variables ?? {}).length > 0) shape["variables"] = content.variables;
  return shape;
}

/** An object with its keys in a stated order, so the file's shape is this
 *  module's decision rather than whatever order the caller happened to build
 *  the object in. */
function orderKeys(shape: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (Object.hasOwn(shape, key)) out[key] = shape[key];
  }
  // ANYTHING THE ORDER DOES NOT NAME FOLLOWS, in the order it was written. The
  // fixed list is the keys the HOST reads; a plugin's own input is the rest, and
  // a writer that dropped what it did not recognise would quietly empty every
  // page it did not understand — which it did, once, for exactly one commit.
  for (const key of Object.keys(shape)) {
    if (!Object.hasOwn(out, key)) out[key] = shape[key];
  }
  return out;
}

/** Ask for `|` on every markdown slot whose text a block scalar can actually
 *  hold. The request is checked afterwards by `format`, not trusted: the
 *  stringifier silently falls back to a quoted form for some values and loses
 *  whitespace-only lines on others.
 *
 *  It walks `contents[].parts` rather than the sections themselves, because a
 *  section holds no prose — its slots do. Only a scalar is looked at: a map
 *  there is a table, a child or an html file, and none of them is text that
 *  somebody reads in this file. */
function markBlockScalars(out: Document): void {
  const contents = out.get("contents", true);
  if (!isSeq(contents)) return;

  for (const item of contents.items) {
    if (!isMap(item)) continue;
    const parts = item.get("parts", true);
    if (!isMap(parts)) continue;

    for (const pair of parts.items as { value?: unknown }[]) {
      const value = pair.value;
      if (!isScalar(value)) continue;
      const text: unknown = value.value;
      if (typeof text === "string" && blockSafe(text)) value.type = Scalar.BLOCK_LITERAL;
    }
  }
}

/** A GRID'S ROWS ARE WRITTEN ONE ROW PER LINE, `- [Piece, Where, What changes]`,
 *  so the file reads as the table it is: a column is a column down the page and
 *  a row is a line a person can read across. Block style would put every cell
 *  on a line of its own and lose the shape. A cell holding a newline or a
 *  comma is quoted by the writer inside the flow row, which `format` still
 *  verifies reads back exactly. Only a `rows` under a `type: grid` map is
 *  touched; a list slot of the same name is somebody's list. */
function markGridRows(out: Document): void {
  const contents = out.get("contents", true);
  if (!isSeq(contents)) return;

  for (const item of contents.items) {
    if (!isMap(item)) continue;
    const parts = item.get("parts", true);
    if (!isMap(parts)) continue;

    for (const pair of parts.items as { value?: unknown }[]) {
      const value = pair.value;
      // A slot is one grid or a list of contents; a grid inside a list is
      // walked too, because a list of grids is a legal thing to hold.
      const held = isSeq(value) ? value.items : [value];
      for (const one of held) {
        if (!isMap(one)) continue;
        const type = one.get("type", true);
        if (!isScalar(type) || type.value !== "grid") continue;
        const rows = one.get("rows", true);
        if (!isSeq(rows)) continue;
        for (const row of rows.items) {
          if (!isSeq(row)) continue;
          row.flow = true;
          // A cell with a line break in it is double-quoted, `"two\nlines"`, so
          // the row stays one line. Left to the writer it folds the plain
          // scalar across three lines and the row stops reading as a row.
          for (const cell of row.items) {
            if (isScalar(cell) && typeof cell.value === "string" && /[\r\n]/.test(cell.value)) cell.type = Scalar.QUOTE_DOUBLE;
          }
        }
      }
    }
  }
}

/** Whether a block scalar can hold this text without changing it.
 *
 *  A block scalar is indented text, so what it cannot hold is anything the
 *  indentation would eat or the reader would not see: trailing whitespace on a
 *  line, a line that is only whitespace, a carriage return, a control
 *  character, a Unicode line separator, a lone surrogate. Prose has none of
 *  these, which is why prose gets the readable spelling and the rest gets
 *  quotes. */
function blockSafe(s: string): boolean {
  if (s === "") return false;
  // Everything that is not text on a line: the controls except \n, DEL, the two
  // Unicode line separators, and an unpaired surrogate (matched as a code
  // point, so a properly paired emoji is left alone).
  if (/[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]|[\uD800-\uDFFF]/u.test(s)) return false;

  const lines = s.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line === "") continue;
    // Trailing whitespace is invisible in the file and is not read back.
    if (/[ \t]$/.test(line)) return false;
    // A first line that starts indented needs an explicit indentation
    // indicator, which is a spelling this format has no reason to use.
    if (i === 0 && /^[ \t]/.test(line)) return false;
  }
  return true;
}

/* ── the check that makes the round trip a property and not a hope ─────── */

/** THE TWO SPELLINGS OF A SLOT, MADE ONE. A bare string is markdown with no
 *  values of its own, which is exactly what the map spells out — so the only
 *  honest comparison is between the canonical forms. It sits beside
 *  `partShape`, which is the function that chooses between them. */
function partOf(part: string | Content): Content {
  if (typeof part === "string") return { type: "markdown", data: part };
  return part;
}

/** Whether reading the text back gave the page that was asked for. Absent and
 *  empty `variables` are the same thing, on a page, a section and a slot alike:
 *  `format` writes none of them, so a caller who handed in `{}` still gets what
 *  they meant. */
function sameDoc(a: PageDoc | null, b: PageDoc): boolean {
  if (a === null) return false;
  if (a.name !== b.name) return false;
  if (!sameVariables(a.variables, b.variables)) return false;
  if (a.plugin !== b.plugin) return false;
  if (!sameValue(a.input ?? {}, b.input ?? {})) return false;
  if (a.contents.length !== b.contents.length) return false;

  for (const [i, one] of a.contents.entries()) {
    const two = b.contents[i];
    if (two === undefined) return false;
    if (one.name !== two.name) return false;
    if ((one.data ?? "") !== (two.data ?? "")) return false;
    if (!sameVariables(one.variables, two.variables)) return false;
    if (!sameParts(one.parts, two.parts)) return false;
  }
  return true;
}

/** Slot for slot, IN ORDER. The order of the slots is the section's html to
 *  decide and not this map's — but a map that reordered its keys on a save
 *  would still turn a one-word edit into an unreadable diff, so it is held. */
/** Two single slot values, compared as the format sees them. */
function samePart(a: string | Content, b: string | Content): boolean {
  const x = partOf(a);
  const y = partOf(b);
  // A grid handed in with no `data` at all — off the wire, or built by hand —
  // is the grid read back with `data: ""`, because a grid has no data.
  return x.type === y.type && (x.data ?? "") === (y.data ?? "") && sameVariables(x.variables, y.variables) && sameRows(x, y);
}

/** A grid is the same grid when its rows are, cell for cell, and its head is.
 *  Anything that is not a grid has no rows to differ on. Absent `head` and
 *  `true` are one answer, because that is what the reader makes of absence. */
function sameRows(x: Content, y: Content): boolean {
  if (x.type !== "grid") return true;
  if ((x.head ?? true) !== (y.head ?? true)) return false;
  const a = x.rows ?? [];
  const b = y.rows ?? [];
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return other !== undefined && row.length === other.length && row.every((cell, c) => cell === other[c]);
  });
}

function sameParts(
  a: Record<string, PartValue> | undefined,
  b: Record<string, PartValue> | undefined,
): boolean {
  const one = a ?? {};
  const two = b ?? {};
  const here = Object.keys(one);
  const there = Object.keys(two);
  if (here.length !== there.length) return false;

  for (const [i, key] of here.entries()) {
    if (there[i] !== key) return false;
    const held = two[key];
    if (held === undefined) return false;
    const mine = one[key] ?? "";
    // A list matches a list, item for item and in order. Two lists of different
    // lengths are different however equal their first entries are.
    if (Array.isArray(mine) || Array.isArray(held)) {
      if (!Array.isArray(mine) || !Array.isArray(held)) return false;
      if (mine.length !== held.length) return false;
      if (!mine.every((item, at) => samePart(item, held[at] ?? ""))) return false;
      continue;
    }
    if (!samePart(mine, held)) return false;
  }
  return true;
}


function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const one = a as Record<string, unknown>;
  const two = b as Record<string, unknown>;
  const keys = Object.keys(one);
  if (keys.length !== Object.keys(two).length) return false;
  return keys.every((key) => Object.hasOwn(two, key) && sameValue(one[key], two[key]));
}

function sameVariables(a: Variables | undefined, b: Variables | undefined): boolean {
  const one = a ?? {};
  const two = b ?? {};
  const keys = Object.keys(one);
  if (keys.length !== Object.keys(two).length) return false;

  for (const key of keys) {
    if (!Object.hasOwn(two, key)) return false;
    const x = one[key];
    const y = two[key];
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (const [i, item] of x.entries()) {
        if (item !== y[i]) return false;
      }
      continue;
    }
    if (x !== y) return false;
  }
  return true;
}
