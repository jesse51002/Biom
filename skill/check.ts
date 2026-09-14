#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
// skill/check.ts — the mechanical half of `.agents/skills/pages/SKILL.md`.
//
//   bun run .agents/skills/check.ts pages/home/children/rates-note
//   bun run .agents/skills/check.ts pages/home/children/*
//   bun run skill/check.ts market/*            # a listing directory checks too
//
// Given a page directory, say whether the page complied. It also finds the
// workspace the directory sits in and says what is about the WORKSPACE at the
// end of a run rather than once per page — the design language and the house
// type scale are facts about the vault and not about any page in it. `checkVault`
// is the whole of that half. Every rule in here has
// a numbered twin in one of the SKILL.md files, and the two are meant to be read
// together: the prose says why, the code says exactly what. A rule that cannot be
// checked mechanically is prose only and says so there rather than pretending
// here.
//
// **THE NUMBERS ARE THE JOIN.** A rule that changes meaning gets a NEW number
// rather than a quiet edit, and a number is never reused, because a finding
// cites its number and reusing one makes every old finding mean something else.
// **`.agents/skills/pages/SKILL.md` CARRIES THE INDEX AND THE RETIRED TABLE, and it is
// the authority on which number means what** — this file cites, it does not
// number. Nothing here may spend a number that table has not been told about.
//
// The sidecar took four with it: R2 (the flat sidecar's key grammar), R4
// (`order:` as a separate statement of the order), R5 (a dotted key belonging to
// a section) and R12 (a slot colliding with a top-level key).
//
// THE RENDER TOOK NINE MORE, and they are worth naming here because half of what
// this file used to say is now false rather than merely differently spelled:
//
//   R3   `kind:` and `render:` described the page and had to agree with what was
//        on disk. Both keys are refused now, so there is no disagreement left to
//        catch. R47 is what remains: a page states its name and its contents.
//   R7   `data-g-slot` named a VARIABLE in scope. `data-g-part` names a SLOT,
//        and a slot is FILLED by a plugin rather than substituted — see R51.
//   R8   a string no slot showed was an edit mode that lied. A variable is
//        reached only by `{{name}}` now, so R46 says the whole of it.
//   R10  a slot was a text LEAF, because the shim dressed one. A plugin FILLS
//        the node — markdown becomes paragraphs, a table becomes a grid — so an
//        element child is the normal case rather than the broken one.
//   R11  a list variable was the page's own business, because the shim stepped
//        over lists while hydrating slots. There is no hydration to step.
//   R22  `height: 100%` and `vh` collapsed a self-sizing frame. There is ONE
//        frame per page now, it is handed the canvas, and it scrolls inside
//        itself — so a viewport length in a section is correct.
//   R27  `position: fixed` pinned to a block's own box rather than the window.
//        The frame's viewport IS the canvas now, which is what an author
//        writing `fixed` already expects.
//   R36  the file carried the current value, because the variables won at load.
//        A section's words live in `content.yaml` and its file is markup, so a
//        copy of the prose in the file is the second copy R45 exists to stop.
//   R39  a `contents` entry had one of four types. A `contents` entry is a
//        SECTION and has no type at all; the four types moved down into a
//        section's `parts` — see R48 and R49.
//
// R0 went too, and is prose only: it said add a block rather than making a new
// KIND of page, and there is one kind of page now.
//
// THE NEW ONES, and what each is derived from rather than invented:
//
//   R47  the keys a page states itself — `name` and `contents` — and the FAIL a
//        preset gets for omitting one, which used to be half of R35.
//   R48  a slot's value is a string or a `Content`, and a `Content` has no
//        `name`: the key it sits under already states the id.
//   R49  the four part types and how `data` reads for each. R39's sentence, one
//        level down, where the types now live.
//   R51  the parts and the `data-g-part`s are one set stated twice.
//   R53  a workspace that never chose a palette or wrote its own design doc.
//   R54  a line in a type scale that the reader threw away.
//   R55  a `markdown.yaml` that does not parse as YAML at all.
//   R56  a word written into a section's markup, where nobody can ever edit it.
//   R57  prose cut into slots that are only stacked, which markdown already does.
//        The framework edits markdown live and always, so a markdown part is a
//        place a person can click and type and a string in an html file is not.
//   R58  a section written against the edit mode that no longer exists, whose
//        controls are therefore hidden for good on a page that looks finished.
//   R59  a section holding a list that the reader can neither add to nor take
//        from — the commonest way a generated page turns out to be a picture.
//   R60  a container feature asked of `@media`, which matches nothing and takes
//        the collapse it describes with it, in silence.
//   R61  a page naming a plugin that nothing here can draw with, and a doc's
//        `contents:` left on a page drawn by something else.
//
// **R50 IS NOT IN HERE.** It belongs to `.agents/skills/plugins/SKILL.md` — a vault
// plugin may never claim a shipped id — and is checked where plugins are
// registered rather than where pages are read.
//
// **IT NEVER BLOCKS RENDERING.** The host does not run this. A page that fails
// every rule still loads, still draws, and still opens its raw-YAML fallback —
// `server/domain/docs.ts` exists for exactly that, and `client/render/plain.js`
// draws a custom block whatever is inside it. A page that cannot be shown is
// worse than a page that is clumsy, and a checker with a veto is one bad regex
// away from being the thing that broke the demo. This is a report, written for
// the agent that just generated the page and for the person reading the diff.
//
// The CLI exits 1 when a FAIL survives, because Claude Code should be able to
// gate on it. That is the tool having an opinion, not the host having a gate.
//
// **THERE IS ONE SIZING MODE, SO NO RULE BRANCHES ON ONE.** A page is one frame,
// the frame is handed the canvas, and it scrolls inside itself. That is the whole
// of it — there is no second mount to be in, no `{ fill: true }` to be told
// apart, and no declaration that is right in one mode and a bug in the other.
// Every rule about height, viewport length and fixed positioning that existed to
// tell the two apart is retired above rather than rewritten, because the thing
// they told apart is gone.
//
// **ONE FILE HOLDS EVERYTHING A PAGE SAYS.** `content.yaml` is the page: `name`,
// `variables`, an optional `page:` list of plugins that mount once for the whole
// page, and `contents` — the ordered list of SECTIONS and nothing else. A section
// is a div: it names its own HTML in `data:` (or takes the shipped default), and
// its `parts` map says what goes in each `data-g-part` that HTML declares. There
// is no `kind:`, because there is one kind of page; no `render:`, because there
// is one reader; no `order:`, because the list IS the order; and no `.md` files,
// because a section's prose is a string in its own `parts`.
//
// **IT IMPORTS ALMOST NOTHING, AND THAT IS THE POINT.** It runs in two places:
// here, where `contracts/` and `server/` sit beside it, and inside a VAULT, where
// neither exists and there is no `vendor/` and no `node_modules/`. It used to
// reach through `_lib/` at the server's YAML parser, which reaches in turn at a
// vendored `yaml` package by a bare specifier — so in a vault `bun run
// .agents/skills/check.ts` tried to install an unpinned package off npm and died with no
// network. The reader below is therefore its own: a small parser for exactly the
// document this format writes, pinned to the server's by a test that runs both
// over every `content.yaml` in the repo and demands the same answer. A second
// implementation is a second opinion only if nothing holds the two together.
//
// THE RUNTIME IMPORTS THAT ARE LEFT ARE THINGS THAT MUST BE DECIDED IN ONE
// PLACE, and there is nothing else in the list. `./_lib/wire.js` carries
// `SLOT_ATTR`, because the attribute has already been spelled two ways — it was
// `data-g-slot` when it named a variable and is `data-g-part` now that it names a
// slot — and the constant is the one place either spelling is decided.
// `./_lib/scale.ts` carries `scaleOf`, the walk that narrows a `markdown.yaml`:
// the page reader drops what it cannot use and says nothing, and R54 below is
// that same walk keeping what it dropped. **A SECOND VALIDATOR WOULD BE THE ONE
// THAT DISAGREES WITH THE READER** — it would send somebody to fix a line that
// draws perfectly well, or stay quiet about one that never arrived. `_lib/` is a
// re-export shim in this repo and a verbatim copy of the real module in a vault,
// so one import spelling works in both.
//
// **PROVE IT RUNS, NEVER THAT IT IS THERE.** Copying the checker alone once
// shipped a command that died on module resolution while a test asserting the
// file was present stayed green, and `bun run .agents/skills/check.ts` is the one command
// every vault's AGENTS.md tells an agent to run. The test that matters stands the
// vault layout up — this file, plus `_lib/` as verbatim copies, and no
// `contracts/`, no `vendor/` and no `node_modules/` anywhere above it — and runs
// the command.
//
// It is not on the layering stack — `tools/layers.mjs` skips `skill/` the way it
// skips `tools/`. It is also OUTSIDE `tsconfig.json`'s `include`, which is why
// `bun x tsc --noEmit` says nothing about it either way: typecheck it by naming
// it, or the next `PageKind` that stops existing goes unreported until somebody
// runs the command.

import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SLOT_ATTR } from "./_lib/wire.js";
import { scaleOf } from "./_lib/scale.ts";
import type { ScaleFault } from "./_lib/scale.ts";
import type { VarValue, Variables } from "./_lib/types.ts";

/* ── what a report is ───────────────────────────────────────────────────── */

export type Severity = "FAIL" | "WARN";

export interface Finding {
  /** `R7`. The same number as the rule in a SKILL.md, so a finding is citable. */
  rule: string;
  severity: Severity;
  /** The file inside the page directory, or `content.yaml`. */
  file: string;
  /** 1-based. 0 when the finding is about the file rather than a line in it. */
  line: number;
  /** One sentence, in the same voice as the skill: what is wrong and what to do. */
  says: string;
}

export interface Report {
  /** The page directory's name — the last segment of its page id. */
  page: string;
  findings: Finding[];
  fails: number;
  warns: number;
  /** No FAIL survived. WARNs do not clear this flag; they are advice. */
  ok: boolean;
  /** Every slot the checker could see, qualified by the section that holds it —
   *  `hero.headline`. A slot's id is the key it sits under in that section's
   *  `parts`, so this is the join between the document and the markup. */
  slots: string[];
  /** The HTML files checked, in the order they were read. */
  artifacts: string[];
  /** Which plugin draws this page. `html` where the document names none. */
  plugin: string;
  /** How many sections `contents` holds. */
  sections: number;
  /** How many of them named no file and took the shipped default. Counted and
   *  reported; there is no rule against it, because most of a document IS the
   *  default section. */
  defaults: number;
}

/** A page directory, as text. `check` is pure and takes this, so the rules can
 *  be tested without a disk and a generated page can be checked before it is
 *  written. `checkDir` is the thin half that reads one off disk. */
export interface PageSource {
  /** The directory name — ONE SEGMENT of a page id, `^[A-Za-z0-9][A-Za-z0-9_-]*$`. The
   *  id is the path of segments that reach it, and the segments above this one
   *  belong to pages this checker is not looking at. */
  id: string;
  /** `content.yaml`, verbatim. `null` when the directory has none — which is
   *  what makes a directory not a page at all. */
  doc: string | null;
  /** Every other file in the directory, by name. `hero.html`, `child.html`,
   *  `@page-notes.html`, and `_assets/<name>.html` one level down — an `html`
   *  part may name a file in there, so a checker that could not see into it
   *  reported every one of them as missing. `children/` is NOT walked: a child
   *  is a page of its own and is checked as one. */
  files: Record<string, string>;
  /** What the checker learned about the workspace this page sits in, or null
   *  when it was handed a directory in isolation. Only R53 reads it, and R53 is
   *  about the vault rather than about this page — see `checkVault`. */
  vault?: VaultSource | null;
}

/** The vault root, as text, for the one rule that is about the workspace rather
 *  than about a page in it. */
export interface VaultSource {
  /** `design/content.yaml`, verbatim, or null when there is none. */
  design: string | null;
  /** The names of the other files in `design/`. A section file in there is the
   *  clearest sign somebody has actually written this workspace's design. */
  designFiles: string[];
  /** `theme.json`, verbatim, or null when there is none. */
  theme: string | null;
  /** Does `pages/` hold anything at all? A vault with no pages in it has not
   *  skipped its design work; it has not started. */
  pages: boolean;
  /** `markdown.yaml` at the vault root, verbatim, or null when there is none —
   *  the HOUSE type scale every page in the workspace inherits. R54 and R55 read
   *  it here rather than once per page for the same reason R53 is here: a line
   *  the house scale lost is one fact about the workspace, and repeating it per
   *  directory would bury every finding about the pages themselves. */
  scale: string | null;
}

/* ── the vault's own grammars, copied because they are the format ───────── */

/** ONE SEGMENT of a page id. The whole id is a path — the folder is the
 *  hierarchy — and this is the part a single directory can speak for. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** A section name. No dot: the dotted key belonged to the flat sidecar, where a
 *  section owned a namespace inside one file. A section owns its own map now. */
const NAME = /^[a-z][a-z0-9_-]*$/;
/** The section name standing for one of this page's children, and the whole of
 *  what makes the built-in drawing replaceable: `contracts/types.ts` derives it
 *  as `@${kind}-${segment}`, so the same child always yields the same key, an
 *  entry already placed is left where it is, and `@page-notes.html` beside
 *  `content.yaml` turns that one entry into an ordinary custom block.
 *
 *  ONE SEGMENT, never a path: a page's `contents` only ever name its DIRECT
 *  children, which is what keeps the key a legal filename and lets two parents
 *  each hold a `notes`. */
const CHILD_KEY = /^@(?:page|table)-[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** THE PLUGINS THAT LET A READER ADD AN ITEM OR TAKE ONE AWAY — the seeded set,
 *  named once because R59 is the one rule that has to know which plugins write a
 *  list back. `reveal` and `child` are plugins too and neither of them can, so a
 *  node naming one is not an answer to that rule.
 *
 *  A NAME AND NOT A CAPABILITY, because this runs on a page directory and cannot
 *  see `plugins/` around it. A vault that rewrites `items.js` into something that
 *  writes nothing is out of reach here; a vault that writes its own adder under
 *  its own id is too, and calls `ctx.write` where this rule can see it. */
const MUTATES = new Set(["items", "open-list", "checklist"]);

/** The per-page assets directory, one level down, holding markup an `html` part
 *  may name. `_` is reserved for the host by the vault format, so nothing a
 *  person writes can collide with it. */
const ASSETS = "_assets";
/** A file a page may hold, optionally one level down in `_assets/`. */
const FILE = /^[A-Za-z0-9@][A-Za-z0-9._-]*$/;
/** A variable, as a template names it. Camel case is the house shape; a dot
 *  stays legal because a page's own `variables` are one dictionary and a
 *  namespace inside it is how a page keeps two groups apart. */
/** A NAME THE RUNTIME CAN ACTUALLY RESOLVE. Kept no wider than the runtime's own
 *  `HOLE` in `guest/runtime/sections.js`, because anything this accepts and that
 *  does not is a template the checker passes and the reader sees with its braces
 *  still on. A dot used to be allowed here and never was there, so `{{a.b}}` was
 *  a silent hole: legal to the gate, unresolvable on the page.
 *
 *  Stricter than the runtime in one place on purpose: a leading `_` is refused,
 *  because names starting with `_` belong to the host everywhere in this repo. */
const VAR_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** `content.yaml` — the page. */
const DOC = "content.yaml";

/** `markdown.yaml` — the type scale. The one other file a page directory holds
 *  that the reader looks for BY NAME, and the same name at the vault root is the
 *  house scale every page inherits. Optional in both places: delete it and the
 *  workspace looks exactly as it did before, which is why nothing here ever
 *  reports its absence. */
const SCALE = "markdown.yaml";

/** `child.html` — how a page looks INSIDE ITS PARENT, read from the child's own
 *  directory when the parent draws it.
 *
 *  IT IS NOT A CONTENT OF THE PAGE IT SITS IN, and treating it as one made every
 *  newly created page report seven failures: its slots resolve against whichever
 *  page MOUNTS it, so `title` was reported missing from a document that was never
 *  going to hold it. It is still an artifact and still checked as one — the host
 *  surface, the house style and the colour rules all apply — with only the rules
 *  that couple a slot to THIS page's variables held back. */
const CHILD_DRAW = "child.html";
/** THE PAGE'S OWN DOCUMENT, when it draws itself rather than naming a plugin. */
const PAGE_DOCUMENT = "index.html";

/** Everything `content.yaml` may say, and nothing else. `server/platform/yaml.ts`
 *  REFUSES an unknown key rather than dropping it, so a page carrying one does
 *  not open at all — which is why this is R1 and not a note about tidiness. */
const PAGE_KEYS = new Set(["name", "plugin", "variables", "contents", "input"]);
/** The keys a SECTION may carry. There is no `type:`, because a section is the
 *  only thing `contents` can hold and a key that distinguishes nothing is a key
 *  that can be written wrong. */
const SECTION_KEYS = new Set(["name", "data", "parts", "variables"]);
/** The keys a `Content` may carry, which is what a `parts` entry is when it is
 *  written as a map rather than as a bare markdown string. There is no `name:`
 *  either: a slot's id is the key it sits under, so there is no second statement
 *  of it to disagree. */
const PART_KEYS = new Set(["type", "data", "variables"]);
/** R47 — the keys a page must state itself, and the ones a preset MUST state
 *  because installing copies its `content.yaml` verbatim. `variables` is
 *  deliberately not among them: it is left out entirely when the page has none,
 *  and neither is `page:`, which most pages simply do not have. */
const REQUIRED = ["name", "contents"];
/** The reader that draws a page. A page naming none is its own `index.html`. */
const DOC_PLUGIN = "doc";
const PLUGIN_NAME = /^[a-z][a-z0-9-]*$/;
/** The old format's keys, named on sight so "this page will not open" reads as
 *  "this page has not been migrated". `kind:` and `render:` are here rather than
 *  in `PAGE_KEYS` because the render is gone: there is one kind of page and one
 *  reader, so both keys now stop the document parsing at all. */
const RETIRED_KEYS = new Set(["order", "parent", "sections", "kind", "render", "page"]);
/** The same, one level down. A `contents` entry used to be a content and carried
 *  a `type:`; it is a section now, and the type moved into `parts`. */
const RETIRED_SECTION_KEYS = new Set(["type", "order", "kind", "render"]);

/** THERE IS NO DIAGRAM TYPE. A diagram is a drawing in a section's own markup,
 *  or a fence a workspace's own plugin upgrades in place — the file type was a
 *  mechanism invented for a case that already had one. */
const TYPES = new Set(["markdown", "html", "table", "child"]);
/** The old format's files. Prose lives in `content.yaml` now, and a `.md` beside
 *  it is words nothing will ever read. */
const RETIRED_EXT = /\.(?:md|mermaid)$/;

/** THE SHIPPED DEFAULT SECTION'S ONE SLOT. A section that names no file takes
 *  `guest/sections/default.html`, which is one centred slot called `body` — and
 *  a vault has no copy of that file to read, so the id is written here instead.
 *  `contracts/types.ts` states it on `Section.data`; this constant is a copy of
 *  that sentence and nothing else.
 *
 *  THE DEFAULT IS A FILE AND NOT A BRANCH, which is why a default section is
 *  checked by the same rule as every other one rather than by an exception. */
const DEFAULT_PARTS = new Set(["body"]);

/** The palette a fresh vault ships with, by name — copied from `BRAND` in
 *  `server/workspace/presets.ts`, which is the one place on the server allowed
 *  to name a colour. R53 reads it to tell a workspace that has chosen its own
 *  scheme from one that never opened the Theme page.
 *
 *  A NAME RATHER THAN A DIGEST, deliberately. A digest of the shipped file would
 *  be wrong the first time anybody edited a shipped default and would then go on
 *  being wrong silently; a name is a thing a person changes when they mean to
 *  change the palette. It fails in the safe direction either way: if the shipped
 *  palette is ever renamed, R53 stops firing rather than firing on every vault. */
const SHIPPED_PALETTE = "Biom";

/** THE SECTION FILES `design/` SHIPS WITH, by name — the masthead, the specimen
 *  of the workspace as it stands, and the three worlds under it.
 *
 *  The seeded design doc DRAWS rather than describes: it shows the shipped
 *  palette small and then three complete designs somebody could ask for in one
 *  sentence, which means it arrives with markup of its own. So "has this
 *  workspace been designed" can no longer be answered by *is there an .html file
 *  in design/* — that is true of every vault on its first run.
 *
 *  A NAME RATHER THAN A DIGEST, exactly as above and for the same reason: a
 *  digest would be wrong the moment anybody edited a shipped band and would then
 *  go on being wrong in silence, while a file somebody ADDED is a file somebody
 *  meant to add. It fails in the same safe direction — rename a shipped band
 *  here and R53 goes quiet rather than firing on every vault. */
const SHIPPED_DESIGN = new Set(["masthead.html", "default.html", "news.html", "paper.html", "panel.html"]);

/** A pixel width under this is an icon or a rule, not a layout decision. */
const ICON_PX = 32;

/* ── the reader ─────────────────────────────────────────────────────────── */
//
// A parser for the subset of YAML this format writes, and nothing wider. It is
// here rather than behind an import because the checker has to run inside a
// vault, where there is no `vendor/` and no network — see the header. What holds
// it honest is a test, not a promise: `tests/skill.test.ts` runs this and
// `server/platform/yaml.ts` over every `content.yaml` in the repo and demands
// they agree.

/** Anything a page document can hold once it is read. */
export type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };

export class DocError extends Error {
  readonly line: number;
  constructor(message: string, line = 0) {
    super(message);
    this.name = "DocError";
    this.line = line;
  }
}

interface Ln {
  /** 1-based line number in the original text. */
  n: number;
  indent: number;
  /** The line with its indentation removed. */
  text: string;
}

/** Read a page document. Throws `DocError` with the line on anything this format
 *  does not write — which is the same answer the server gives, because the
 *  server's parser refuses the same shapes. */
export function readYaml(text: string): Yaml {
  const raw = text.split(/\r?\n/);
  const lines: Ln[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i] ?? "";
    const body = line.replace(/^[ \t]+/, "");
    if (body === "" || body.startsWith("#")) continue;
    lines.push({ n: i + 1, indent: line.length - body.length, text: body });
  }
  if (lines.length === 0) return null;

  let at = 0;

  const node = (indent: number): Yaml => {
    const line = lines[at];
    if (line === undefined || line.indent < indent) return null;
    return /^-(?:[ \t]|$)/.test(line.text) ? seq(line.indent) : map(line.indent);
  };

  const map = (indent: number): Yaml => {
    const out: { [key: string]: Yaml } = {};
    while (at < lines.length) {
      const line = lines[at];
      if (line === undefined || line.indent < indent) break;
      if (line.indent > indent) throw new DocError("this line is indented past the key above it", line.n);
      if (/^-(?:[ \t]|$)/.test(line.text)) break;

      const split = keySplit(line.text);
      if (split === null) throw new DocError("this line is not a key and a value", line.n);
      const [key, rest] = split;
      if (key === "__proto__") throw new DocError("__proto__ is not a key", line.n);
      if (Object.hasOwn(out, key)) throw new DocError('"' + key + '" is written twice', line.n);
      at++;

      if (rest.startsWith("|") || rest.startsWith(">")) {
        out[key] = block(rest, indent, line.n, raw);
        continue;
      }
      if (rest === "" || rest.startsWith("#")) {
        const next = lines[at];
        out[key] =
          next !== undefined && next.indent === indent && /^-(?:[ \t]|$)/.test(next.text)
            ? seq(indent)
            : node(indent + 1);
        continue;
      }
      out[key] = scalar(rest, line.n);
    }
    return out;
  };

  const seq = (indent: number): Yaml => {
    const out: Yaml[] = [];
    while (at < lines.length) {
      const line = lines[at];
      if (line === undefined || line.indent < indent) break;
      if (line.indent > indent) throw new DocError("this list item is indented past the one above it", line.n);
      if (!/^-(?:[ \t]|$)/.test(line.text)) break;

      const rest = line.text.slice(1).replace(/^[ \t]+/, "");
      if (rest === "" || rest.startsWith("#")) {
        at++;
        out.push(node(indent + 1));
        continue;
      }
      // An entry that starts a map on the dash's own line — which is how every
      // `contents` entry is written. The map's indent is the column the key
      // starts at, so the line is rewritten in place and read as one.
      if (keySplit(rest) !== null) {
        const column = line.indent + (line.text.length - rest.length);
        lines[at] = { n: line.n, indent: column, text: rest };
        out.push(node(column));
        continue;
      }
      if (rest.startsWith("|") || rest.startsWith(">")) {
        out.push(block(rest, line.indent, line.n, raw));
        continue;
      }
      at++;
      out.push(scalar(rest, line.n));
    }
    return out;
  };

  /** A block scalar: everything indented past the key, with the indentation
   *  taken off. `|` keeps the line breaks, `>` folds them, and `-` and `+` say
   *  what happens to the last one. */
  const block = (header: string, keyIndent: number, keyLine: number, source: string[]): string => {
    const shape = /^([|>])([+-]?)(\d*)([+-]?)\s*(?:#.*)?$/.exec(header.trim());
    if (shape === null) throw new DocError("that is not a block scalar", keyLine);
    const folded = shape[1] === ">";
    const chomp = (shape[2] || shape[4] || "") as "" | "-" | "+";
    const stated = shape[3] === "" ? 0 : Number(shape[3]);

    const body: string[] = [];
    let last = keyLine - 1; // 0-based index of the key's own line
    for (let i = keyLine; i < source.length; i++) {
      const line = source[i] ?? "";
      const bare = line.replace(/^[ \t]+/, "");
      if (bare !== "" && line.length - bare.length <= keyIndent) break;
      body.push(line);
      last = i;
    }
    while (at < lines.length && (lines[at]?.n ?? Infinity) <= last + 1) at++;
    if (body.every((line) => line.trim() === "")) return "";

    let width = stated > 0 ? keyIndent + stated : 0;
    if (width === 0) {
      for (const line of body) {
        const bare = line.replace(/^[ \t]+/, "");
        if (bare === "") continue;
        width = line.length - bare.length;
        break;
      }
    }

    const rows = body.map((line) => (line.trim() === "" ? "" : line.slice(width)));

    // Every line of a block scalar ends in a break; the chomping indicator only
    // decides what happens to the run of them at the end. `-` takes them all,
    // `+` keeps them all, and the default clips to exactly one.
    let out = folded ? fold(rows) : rows.join("\n");
    out += "\n";
    if (chomp === "-") out = out.replace(/\n+$/, "");
    else if (chomp === "") out = out.replace(/\n+$/, "\n");
    return out;
  };

  /** A folded scalar: a break between two written lines is a space, and a blank
   *  line is a break of its own. */
  const fold = (rows: string[]): string => {
    let out = "";
    let started = false;
    let breaks = 0;
    for (const row of rows) {
      if (row === "") { breaks++; continue; }
      if (!started) { out = row; started = true; }
      else out += (breaks === 0 ? " " : "\n".repeat(breaks)) + row;
      breaks = 0;
    }
    return out + "\n".repeat(breaks);
  };

  const value = node(lines[0]?.indent ?? 0);
  if (at < lines.length) {
    throw new DocError("this line is not part of the document above it", lines[at]?.n ?? 0);
  }
  return value;
}

/** Split `key: value` at the first colon outside quotes that is followed by
 *  whitespace or the end of the line. `null` when the line is not a key. */
function keySplit(text: string): [string, string] | null {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\" && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && i > 0 && /[ \t]/.test(text[i - 1] ?? "")) return null;
    if (c !== ":") continue;
    const after = text[i + 1];
    if (after !== undefined && after !== " " && after !== "\t") continue;
    const key = unquote(text.slice(0, i).trim());
    if (key === "") return null;
    return [key, text.slice(i + 1).replace(/^[ \t]+/, "")];
  }
  return null;
}

/** One value on one line: a quoted string, a flow collection, or a plain scalar
 *  read the way YAML 1.2's core schema reads it. */
function scalar(text: string, line: number): Yaml {
  const body = strip(text).trim();
  if (body === "") return null;
  if (body.startsWith("[") || body.startsWith("{")) return flow(body, line);
  if (body.startsWith('"') || body.startsWith("'")) return unquote(body);
  if (body === "~" || body === "null" || body === "Null" || body === "NULL") return null;
  if (body === "true" || body === "True" || body === "TRUE") return true;
  if (body === "false" || body === "False" || body === "FALSE") return false;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(body)) return Number(body);
  if (/^[-+]?0x[0-9a-fA-F]+$/.test(body)) return Number(body);
  return body;
}

/** A trailing `# comment`, taken off. Only when the hash follows whitespace: a
 *  hash inside a word is part of the word, which is how YAML reads it too. */
function strip(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\" && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && (i === 0 || /[ \t]/.test(text[i - 1] ?? ""))) return text.slice(0, i);
  }
  return text;
}

function unquote(text: string): string {
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (text.length > 1 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

/** `[a, b]` and `{a: b}`, one level or many. The format writes these only for an
 *  empty collection and the odd short list, so this is small on purpose. */
function flow(text: string, line: number): Yaml {
  let at = 0;

  const skip = () => {
    while (at < text.length && /[\s,]/.test(text[at] ?? "")) at++;
  };

  const token = (): string => {
    let quote: string | null = null;
    const from = at;
    while (at < text.length) {
      const c = text[at];
      if (quote !== null) {
        if (c === "\\" && quote === '"') at++;
        else if (c === quote) quote = null;
        at++;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; at++; continue; }
      if (c === "," || c === "]" || c === "}" || c === ":") break;
      at++;
    }
    return text.slice(from, at).trim();
  };

  const value = (): Yaml => {
    skip();
    const c = text[at];
    if (c === "[") {
      at++;
      const out: Yaml[] = [];
      for (;;) {
        skip();
        if (at >= text.length) throw new DocError("this list is never closed", line);
        if (text[at] === "]") { at++; return out; }
        out.push(value());
      }
    }
    if (c === "{") {
      at++;
      const out: { [key: string]: Yaml } = {};
      for (;;) {
        skip();
        if (at >= text.length) throw new DocError("this map is never closed", line);
        if (text[at] === "}") { at++; return out; }
        const key = unquote(token());
        skip();
        if (text[at] === ":") at++;
        out[key] = value();
      }
    }
    const raw = token();
    if (raw === "") return null;
    return scalar(raw, line);
  };

  const out = value();
  skip();
  if (at < text.length) throw new DocError("there is more here than one value", line);
  return out;
}

/* ── small helpers ──────────────────────────────────────────────────────── */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isMap = (v: Yaml): v is { [key: string]: Yaml } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isScalar = (v: Yaml): boolean =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** 1-based line of an index into `text`. */
function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Where a key was written, so a finding points at a line rather than a file.
 *  Indentation-insensitive: the document nests now, and a key is still the only
 *  thing before the first colon on its own line. */
function lineOfKey(text: string, key: string): number {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/^[ \t]*-?[ \t]*/, "");
    const cut = line.indexOf(":");
    if (cut > 0 && line.slice(0, cut).trim() === key) return i + 1;
  }
  return 0;
}

/** Where a `contents` entry was written: its own `name:` line. */
function lineOfContent(text: string, name: string): number {
  const lines = text.split(/\r?\n/);
  const want = new RegExp("^[ \\t]*-?[ \\t]*name:[ \\t]*[\"']?" + escapeRe(name) + "[\"']?[ \\t]*$");
  for (let i = 0; i < lines.length; i++) {
    if (want.test(lines[i] ?? "")) return i + 1;
  }
  return 0;
}

/** Is this index inside a start tag? Walk back to the nearest angle bracket:
 *  a `<` first means yes, a `>` first means we are in text or in a script.
 *  Cheap, and enough to tell an attribute from a variable called `style`. */
function inTag(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const c = text.charCodeAt(i);
    if (c === 60) return true; // <
    if (c === 62) return false; // >
  }
  return false;
}

/* `VOID`, `textAfter` AND `hasChildTag` STOOD HERE, and all three answered one
 * question: is the element carrying this slot a text leaf with words already in
 * it? R10 and R36 were the only callers and both are retired. A plugin FILLS the
 * node now — markdown becomes paragraphs, a table becomes a grid — so an element
 * child is the ordinary case rather than the broken one; and the words come from
 * the document rather than from the markup, so an empty slot in a section file
 * is correct rather than a diff nobody can read. */

/** Blank out comments and string literals, keeping every offset and newline, so
 *  a scan is not thrown by a `{` inside a message. Not a parser and not trying
 *  to be: it is wrong about a regex literal containing a quote, which is a shape
 *  no generated page has yet produced. */
function blankStrings(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      blank(i, end === -1 ? src.length : end + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "\u0060") {
      let k = i + 1;
      while (k < src.length) {
        if (src[k] === "\\") { k += 2; continue; }
        if (src[k] === c) break;
        k++;
      }
      blank(i, Math.min(k + 1, src.length));
      i = k + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Every `<tag>…</tag>` block, with the offset of its body.
 *
 *  A TAG INSIDE AN HTML COMMENT IS NOT A TAG, and finding the boundaries in a
 *  comment-blanked copy is what makes that true. A guide-quality section file
 *  describes its own mechanism — "append a `<script src="/vendor/three.min.js">`
 *  on mount" — and both halves of that went wrong before this: R35 reported the
 *  sentence as an unconditional load, and where the mention had no closing tag
 *  the slice ran from the comment to the REAL script's `</script>`, so the file's
 *  one script was scanned twice and every finding in it was reported twice.
 *
 *  The BODIES are still sliced out of the original text, never out of the
 *  blanked copy: a script may legally contain `<!--`, which is a line comment in
 *  JavaScript, and blanking from there to the next `-->` would hide real code
 *  from every rule that reads a script. Positions come from the mask; content
 *  comes from the file. */
function blocks(html: string, tag: string): { attrs: string; body: string; at: number }[] {
  const masked = html.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, " "));
  const out: { attrs: string; body: string; at: number }[] = [];
  const open = new RegExp("<" + tag + "\\b([^>]*)>", "gi");
  for (const m of masked.matchAll(open)) {
    const from = (m.index ?? 0) + m[0].length;
    const close = masked.toLowerCase().indexOf("</" + tag, from);
    const to = close === -1 ? masked.length : close;
    out.push({ attrs: m[1] ?? "", body: html.slice(from, to), at: from });
  }
  return out;
}

/** The same text with its CSS and JS COMMENTS blanked, offsets and lines intact.
 *
 *  A rule that looks for a mistake by name finds the paragraph warning about it,
 *  and that is not a hypothetical: R60 went out and immediately failed the two
 *  starters whose comments exist to say `@media (max-inline-size: …)` is not a
 *  media feature. A guide that cannot describe the trap it is guarding against
 *  is a guide with the useful half removed.
 *
 *  `//` is blanked only at the start of a line, because `url(https://…)` is the
 *  ordinary case and cutting it at the slashes would break the value the rule
 *  above it is reading. */
function withoutComments(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/[^\n]*/gm, blank);
}

/** Every run of VISIBLE TEXT in a file of markup, with the offset it starts at —
 *  what R56 reports. A run is what sits between tags: `<h1>Ship faster</h1>`
 *  gives one run, and `<span>Ship</span> <span>faster</span>` gives two, because
 *  a tag ends a run and whitespace inside one does not.
 *
 *  FOUR THINGS ARE HIDDEN BEFORE THE SCAN, and each is hidden because it is not
 *  a word a reader reads:
 *
 *    - a comment, which is written for whoever opens the file;
 *    - `<style>` and `<script>`, which are the section's look and its behaviour
 *      — `content: " rows"` in a stylesheet is a rule, not a sentence;
 *    - `<svg>`, WHICH IS A DELIBERATE EXCEPTION. A label on an axis or inside a
 *      chart is part of the DRAWING, and pulling it out into a slot breaks the
 *      artwork rather than making it editable;
 *    - `<button>` and `<summary>`, WHICH ARE THE OTHER ONE. A control's label is
 *      furniture and not the document's words: nobody wants to click into
 *      "Delete this column" and rewrite it, and putting it in `content.yaml`
 *      would make the section's own chrome a thing the page could lose. The
 *      exemption is the same one `aria-label` and `title` already had, granted
 *      for the same reason — and without it every control a section draws had to
 *      be a bare glyph, which is exactly the "three unlabelled marks in a corner"
 *      that a page's own add and delete must not be;
 *    - `{{name}}`, which is a variable and therefore already a thing somebody
 *      can change without opening this file.
 *
 *  Hiding is done by writing a space over the character, so every offset — and
 *  therefore every line number — survives, and a `<` inside a comment cannot
 *  start a tag in the pass that follows. */
function textRuns(html: string): { text: string; at: number }[] {
  const kept = html.split("");
  const hide = (from: number, to: number) => {
    for (let k = Math.max(0, from); k < to && k < kept.length; k++) if (kept[k] !== "\n") kept[k] = " ";
  };
  const now = () => kept.join("");

  for (const m of html.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) hide(m.index ?? 0, (m.index ?? 0) + m[0].length);
  for (const tag of ["style", "script"]) {
    const text = now();
    for (const m of text.matchAll(new RegExp("<" + tag + "\\b[\\s\\S]*?(?:</" + tag + "\\s*>|$)", "gi"))) {
      hide(m.index ?? 0, (m.index ?? 0) + m[0].length);
    }
  }
  // `<svg>` NESTS LEGALLY, so this counts depth rather than stopping at the
  // first close: a nested drawing would otherwise release the outer one early
  // and every label after it would read as prose.
  {
    const text = now();
    const marks = [...text.matchAll(/<(\/?)svg\b[^>]*>/gi)];
    let depth = 0;
    let from = 0;
    for (const m of marks) {
      const closing = m[1] === "/";
      if (!closing) { if (depth === 0) from = m.index ?? 0; depth++; continue; }
      if (depth === 0) continue;
      depth--;
      if (depth === 0) hide(from, (m.index ?? 0) + m[0].length);
    }
    if (depth > 0) hide(from, html.length); // unclosed: the rest is the drawing
  }
  // A CONTROL'S LABEL IS FURNITURE, and this has to run BEFORE the tags are
  // blanked or there is no `<button` left to find. Measured: written after them,
  // it matched nothing and every control label was still reported.
  for (const tag of ["button", "summary"]) {
    const text = now();
    for (const m of text.matchAll(new RegExp("<" + tag + "\\b[\\s\\S]*?(?:</" + tag + "\\s*>|$)", "gi"))) {
      hide(m.index ?? 0, (m.index ?? 0) + m[0].length);
    }
  }
  // A TAG ENDS AT A `>` THAT IS NOT INSIDE A QUOTED VALUE. The simple form
  // stopped at the first `>` anywhere, so an attribute holding one —
  // `data-g-src="graph TD; a-->b"` is the obvious case, and it is what the
  // diagrams skill's own example writes — was cut short and the rest of the tag
  // leaked out as prose. R56 then reported markup as words.
  for (const m of now().matchAll(/<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g)) {
    hide(m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  for (const m of now().matchAll(/\{\{[^}]*\}\}/g)) hide(m.index ?? 0, (m.index ?? 0) + m[0].length);

  const out: { text: string; at: number }[] = [];
  let start = -1;
  for (let i = 0; i <= html.length; i++) {
    const shown = i < html.length && kept[i] === html[i];
    if (shown && start === -1) start = i;
    if (shown || start === -1) continue;
    const text = html.slice(start, i).trim();
    if (text !== "") out.push({ text, at: start });
    start = -1;
  }
  return out;
}

/** Does a run of text carry a WORD, rather than a space, an entity or a piece of
 *  punctuation a section drew as decoration? `&mdash;`, `·` and `→` are things
 *  the markup is allowed to say, because none of them is a word anybody would
 *  ever want to edit. A letter or a digit is. */
function isWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text.replace(/&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);/g, " "));
}

/** A filename a page may hold, or null. A section NAMES its markup in `data:`
 *  and an `html` part names its own, so the string comes out of a document a
 *  stranger may have written. Kept identical to `pageFile` in
 *  `server/domain/pages.ts`. */
function pageFile(data: unknown): string | null {
  if (typeof data !== "string") return null;
  const parts = data.split("/");
  const name =
    parts.length === 2 && parts[0] === "_assets" ? parts[1]
    : parts.length === 1 ? parts[0]
    : undefined;
  if (name === undefined || !FILE.test(name) || name.includes("..")) return null;
  return parts.length === 2 ? "_assets/" + name : name;
}

/* ── the banned identifiers ─────────────────────────────────────────────── */

/** A banned identifier and what to say instead. Matched on the source with its
 *  strings and comments blanked, so a rule named in a comment is not a finding. */
interface Ban {
  rule: string;
  severity: Severity;
  re: RegExp;
  says: string;
}

/** THE NAMES THE GLOBAL OBJECT ANSWERS TO, as an optional prefix.
 *
 * Every banned global below is reachable two ways — `fetch(...)` and
 * `window.fetch(...)` — and they are the same call. A rule written against the
 * bare identifier alone passes every dotted spelling, which is how R14 came to
 * miss `window.fetch`, the exact call its own sentence names. A checker with a
 * false negative is worse than no checker, because a report of nothing is read
 * as approval.
 *
 * `\b` already carries the dotted form for a rule matched on the identifier
 * alone. This exists for the rules that CANNOT be written that way: `fetch` and
 * `eval` are ordinary words a page's own helper may legitimately be called, so
 * they are anchored with `(?<![.\w])` to keep `g.fetch(...)` out of the report —
 * and that anchor is exactly what shuts the dotted form out too. */
const GLOBAL = String.raw`(?:(?:window|globalThis|self|frames)\s*\.\s*)?`;

const BANS: Ban[] = [
  // R13 — storage
  { rule: "R13", severity: "FAIL", re: /\blocalStorage\b/, says: "localStorage throws in here — the frame has an opaque origin. State that must survive a reload is a variable in content.yaml." },
  { rule: "R13", severity: "FAIL", re: /\bsessionStorage\b/, says: "sessionStorage throws in here — the frame has an opaque origin. State that must survive a reload is a variable in content.yaml." },
  { rule: "R13", severity: "FAIL", re: /\bindexedDB\b/, says: "indexedDB is unavailable to an opaque origin. Rows belong in a table, through biom.insert." },
  { rule: "R13", severity: "FAIL", re: /document\s*\.\s*cookie/, says: "there are no cookies in an opaque origin. Nothing to read and nothing to set." },
  { rule: "R13", severity: "FAIL", re: /\bcaches\s*\./, says: "the Cache API is unavailable to an opaque origin." },

  // R14 — the network
  { rule: "R14", severity: "FAIL", re: new RegExp(String.raw`(?<!biom\s*\.\s*)(?<![.\w])${GLOBAL}fetch\s*\(`), says: "window.fetch cannot reach anything from an opaque origin. biom.fetch(url, init) is the only way out, and the host performs the request." },
  { rule: "R14", severity: "FAIL", re: /\bXMLHttpRequest\b/, says: "XMLHttpRequest cannot reach anything from here. Use biom.fetch." },
  { rule: "R14", severity: "FAIL", re: /\bWebSocket\b/, says: "a socket cannot be opened from an opaque origin, and the contract has no streaming call." },
  { rule: "R14", severity: "FAIL", re: /\bEventSource\b/, says: "server-sent events cannot be opened from an opaque origin." },
  { rule: "R14", severity: "FAIL", re: /sendBeacon\s*\(/, says: "navigator.sendBeacon leaves without the host knowing. Every destination goes through biom.fetch." },

  // R15 — reaching past the shim
  { rule: "R15", severity: "FAIL", re: /\b(?:window|globalThis|self|frames)\s*\.\s*(?:parent|top|opener)\b/, says: "the shim owns the channel to the host. Talking to the parent window directly bypasses the one contract this page has." },
  { rule: "R15", severity: "FAIL", re: /(?<![.\w])(?:parent|top|opener)\s*\.\s*postMessage\s*\(/, says: "the shim owns the channel to the host. Use biom.*, which is the same channel with a contract on it." },
  { rule: "R15", severity: "FAIL", re: /document\s*\.\s*referrer/, says: "the frame is loaded with referrerpolicy=no-referrer and has no origin. There is nothing here to learn about the host." },

  // R17 — code from a string
  { rule: "R17", severity: "FAIL", re: new RegExp(String.raw`(?<![.\w])${GLOBAL}eval\s*\(`), says: "eval is banned outright. A page that builds code from text cannot be reviewed by reading it." },
  { rule: "R17", severity: "FAIL", re: new RegExp(String.raw`new\s+${GLOBAL}Function\s*\(`), says: "new Function is eval with a longer name." },
  { rule: "R17", severity: "FAIL", re: /document\s*\.\s*write\s*\(/, says: "document.write reopens the document and takes the shim with it." },

  // R19 — SQL. Matched on `.sql(` rather than on `biom.sql(`, for the reason
  // R38 is matched on `.children(`: the house shape aliases the shim — `const g =
  // window.biom` — so a rule that only fired on the long spelling is a rule
  // that never fires.
  { rule: "R19", severity: "WARN", re: /\.\s*sql\s*\(/, says: "biom.sql works and is the call to avoid: a page written on SQL is a page that has to be rewritten when ports arrive. Prefer biom.table and biom.insert." },

  // R20 — the platform
  { rule: "R20", severity: "WARN", re: /navigator\s*\.\s*(?:userAgent|platform|vendor|userAgentData)\b/, says: "an artifact never branches on the platform. It responds to the canvas it was handed and asks nothing about who handed it over." },

  // R21 — markup from a string
  { rule: "R21", severity: "WARN", re: /\.\s*innerHTML\s*=/, says: "innerHTML is the stored cross-site-scripting path, and variables and table rows are written by other people. Build nodes with createElement and set textContent." },
  { rule: "R21", severity: "WARN", re: /\.\s*outerHTML\s*=/, says: "outerHTML parses markup out of text. Build nodes instead." },
  { rule: "R21", severity: "WARN", re: /insertAdjacentHTML\s*\(/, says: "insertAdjacentHTML parses markup out of text. Build nodes instead." },

  // R24 — measuring the canvas
  { rule: "R24", severity: "FAIL", re: /\b(?:inner|outer)Width\b/, says: "the artifact is never told how wide it is and must never ask. Lay out with grid, flex-wrap and container queries, which respond to the canvas without measuring it." },
  { rule: "R24", severity: "FAIL", re: /\bscreen\s*\.\s*(?:width|availWidth|height|availHeight)\b/, says: "the screen is not the canvas. The frame is whatever width the page gave it, and it changes when a panel opens." },
  { rule: "R24", severity: "FAIL", re: /\bmatchMedia\s*\(/, says: "a media query asks about the viewport, which the artifact does not own. Ask about the container instead." },

  // R29 — an inline style, set from script.
  //
  // The attribute is the obvious spelling and the one the markup scan catches.
  // These are the three that reach the same object from JavaScript, and they are
  // here for the reason `window.fetch` is anchored two rules up: a rule that
  // fires on one spelling of an act and not on the others is a rule that reports
  // nothing and is read as approval. A section can do more now than a block ever
  // could, so there is more script here to get this wrong in.
  //
  // `setProperty` is NOT here, and the reason is mechanical: these are matched
  // on the source with its STRING LITERALS BLANKED, so a rule that has to read
  // the first argument cannot be one of them. It is scanned raw beside the
  // `setAttribute("style")` scan instead, where the argument is still there to
  // be read — the custom-property form has to be let through and every other
  // one caught, and that is a distinction only the literal makes.
  { rule: "R29", severity: "FAIL", re: /\.\s*style\s*\.\s*cssText\s*=(?!=)/, says: "cssText replaces the whole inline style. Presentation goes in the one <style> block, where a person can change it in one place and a diff shows what moved." },
  { rule: "R29", severity: "FAIL", re: /\.\s*style\s*\.\s*(?!cssText\b)[A-Za-z][A-Za-z0-9]*\s*=(?!=)/, says: "an inline style, set from script. Toggle a class and let the one <style> block decide what the class looks like — or set a custom property, which is the one thing script may write onto an element's style." },
];

/* ── colour ─────────────────────────────────────────────────────────────── */

/** Every property whose value can BE a colour. Longer than it was, and the
 *  additions are the ones a section reaches for that a block never did: a
 *  gradient is `background-image`, a section that draws its own scheme sets
 *  logical border colours, and an inline SVG paints with `stop-color` and
 *  `flood-color`. A property missing from this list is a raw colour R30 does not
 *  see, and a rule that misses is read as approval. */
const COLOUR_PROPS =
  /(?:^|[;{\s])(color|background|background-color|background-image|border|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|border-block-color|border-block-start-color|border-block-end-color|border-inline-color|border-inline-start-color|border-inline-end-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|text-decoration|text-decoration-color|text-emphasis-color|-webkit-text-fill-color|-webkit-text-stroke-color|caret-color|accent-color|column-rule|column-rule-color|scrollbar-color|stop-color|flood-color|lighting-color)\s*:\s*([^;}{]*)/gi;

/** A CUSTOM PROPERTY declaration, so a section that mints its own token cannot
 *  put a literal behind it. `--panel: #eee` is the palette being routed around
 *  one indirection further out, and the Theme page can see it just as little. */
const CUSTOM_PROP = /(?:^|[;{\s])(--[A-Za-z][\w-]*)\s*:\s*([^;}{]*)/g;

/** The presentation attributes markup can paint with, which is how an inline
 *  SVG sets a colour without ever touching the stylesheet. The hex scan already
 *  reads the whole file, so this exists for the NAMED spellings. */
const PAINT_ATTR = /\s(fill|stroke|color|stop-color|flood-color|lighting-color|bgcolor)\s*=\s*["']([^"']*)["']/gi;

/** The CSS colour keywords a generated page actually reaches for. Not the whole
 *  147: a checker that flags `linen` in a sentence is a checker people turn off. */
const NAMED = new Set([
  "white", "black", "red", "green", "blue", "grey", "gray", "yellow", "orange", "purple",
  "pink", "brown", "silver", "gold", "navy", "teal", "olive", "lime", "aqua", "cyan",
  "magenta", "fuchsia", "maroon", "crimson", "indigo", "violet", "coral", "salmon",
  "turquoise", "beige", "ivory", "khaki", "plum", "orchid", "lavender", "tan", "wheat",
  "darkgrey", "darkgray", "lightgrey", "lightgray", "whitesmoke", "gainsboro", "dimgrey", "dimgray",
]);

const FUNCS = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi;

/* ── what a section is, once it has been read ───────────────────────────── */

/** One entry in a section's `parts`, read. A bare string in the document is a
 *  markdown part, because prose is most of what a slot holds and `body: "…"`
 *  should not need a wrapper; a map is a full `Content`. */
interface Part {
  /** THE KEY IT SAT UNDER, which is the slot's id. A part has no name of its
   *  own — that is the second statement this format removed. */
  id: string;
  /** Null when the map declared no type, or one that is not a type. A bare
   *  string always arrives here as "markdown". A LIST takes its items' type,
   *  because a list of markdown is a slot full of markdown. */
  type: string | null;
  /** WHETHER THE SLOT HOLDS A LIST. It is still one part — one slot, one id —
   *  and this is the one thing about it a rule can need to know, because what
   *  can be done to a list is not what can be done to a paragraph. */
  list: boolean;
  /** The prose of the slot: the value's own, or every item's with a blank line
   *  between, which is what the words of a list slot are. */
  data: string;
  /** What the part itself declared, before anything above it is folded in. */
  own: Variables;
  /** Own, then the section's, then the page's — what `{{name}}` resolves
   *  against, nearest first, which is the whole of the scoping rule. */
  scope: Variables;
  line: number;
}

interface Sect {
  name: string;
  /** The section's own HTML, or null when it named none and took the shipped
   *  default. Null is the ORDINARY case for a hand-written page and is not on
   *  its own a finding: most of a document is the default section. */
  file: string | null;
  /** True when `data:` named something this page cannot hold, or named a file
   *  that is not here. THE SECTION STILL DRAWS: the server falls back to the
   *  shipped default and `DrawnSection.fallback` is true either way, so this is
   *  a default section as far as the count is concerned. What it is NOT
   *  is a default taken on purpose, which is why R42 says so and why the rules
   *  that would judge the file the author meant to write hold back. */
  broken: boolean;
  /** Slot id → what goes in it, in the order the document wrote them. */
  parts: Part[];
  /** What the section itself declared, before the page's are folded in. */
  own: Variables;
  /** Own, then the page's underneath. */
  scope: Variables;
  line: number;
}

/* ── the markdown type scale ────────────────────────────────────────────── */

/** R55 and R54 — one `markdown.yaml`, held against the reader that draws it.
 *
 *  THE PAGE READER DROPS WHAT IT CANNOT USE AND SAYS NOTHING. That is
 *  deliberate: a page is the unit of a fault everywhere else in this format, and
 *  a typo in a type scale must not be the thing that stops a document opening.
 *  It is only defensible if somebody is told, and this is where they are told —
 *  `scaleOf` keeps what it threw away when it is handed somewhere to put it, so
 *  THE REPORT AND THE READER ARE ONE WALK. A checker with its own idea of the
 *  grammar would eventually disagree with the file that actually draws.
 *
 *  R54 IS A WARN because the page still draws: one line goes and the rest of the
 *  scale applies, so the property it was setting is simply the browser's own.
 *  R55 IS A FAIL because it is not one line, it is the whole file — a scale that
 *  will not parse is dropped entire, in silence, and the page comes out looking
 *  exactly as it would have with no scale written at all.
 *
 *  It says nothing about a scale that is not there. Every property is optional
 *  and so is the file, so an absent one is the ordinary case and never a
 *  finding. */
function checkScale(text: string, file: string, out: Finding[]): void {
  let raw: Yaml;
  try {
    raw = readYaml(text);
  } catch (e) {
    out.push({
      rule: "R55",
      severity: "FAIL",
      file,
      line: e instanceof DocError ? e.line : 0,
      says: "the type scale does not parse: " + (e instanceof Error ? e.message : String(e)) +
        ". The whole file is dropped rather than half of it, and nothing on screen says so — the type this was written to set never arrives, and the page looks exactly as it would with no scale at all.",
    });
    return;
  }

  const faults: ScaleFault[] = [];
  scaleOf(raw, faults);
  for (const fault of faults) {
    /* THE LINE IS THE ELEMENT'S, not the property's. An element is written on a
     * line of its own in either spelling, and a property inside a flow map —
     * `h1: { size: 2rem }`, which is how a scale is usually written — is not on
     * one at all, so a fault about `h1.size` points at `h1` and the reader finds
     * it from there. */
    const whole = fault.where === "the file";
    out.push({
      rule: "R54",
      severity: "WARN",
      file,
      line: whole ? 0 : lineOfKey(text, fault.where.split(".")[0] ?? ""),
      says: (whole ? "" : '"' + fault.where + '": ') + fault.says + ". " + (whole
        ? "Nothing in it is read, so the type this was written to set never arrives."
        : "The reader drops the line and keeps the rest, so the page still draws — this one property simply never takes effect."),
    });
  }
}

/* ── the check ──────────────────────────────────────────────────────────── */

export function check(src: PageSource): Report {
  const findings: Finding[] = [];
  const slots: string[] = [];
  const artifacts: string[] = [];
  const sections: Sect[] = [];

  const say = (rule: string, severity: Severity, file: string, line: number, says: string) =>
    findings.push({ rule, severity, file, line, says });

  /** Which plugin draws this page, filled in as soon as the document says. It is
   *  on the report because it decides which rules applied at all — a reader of a
   *  report with no findings should be able to tell a clean document from a page
   *  the section rules never looked at. */
  let plugin = "html";

  const done = (): Report => {
    const fails = findings.filter((f) => f.severity === "FAIL").length;
    const defaults = sections.filter((s) => s.file === null).length;
    return {
      page: src.id, findings, fails, warns: findings.length - fails, ok: fails === 0,
      slots, artifacts, plugin, sections: sections.length, defaults,
    };
  };

  /* R6 — the directory name is one segment of the page's id */
  if (!SEGMENT.test(src.id)) {
    say("R6", "FAIL", ".", 0, '"' + src.id + '" is not a page segment — a directory name of letters, digits, dashes and underscores, starting with a letter or a digit. Case is kept; a leading underscore is the one refused position. The page\'s id is the segments that reach it, joined with a slash.');
  }

  /* R1 — the document is there, and it reads back as a page.
   *
   * A DIRECTORY WITH NO `content.yaml` IS A FAIL AND NOT A SHRUG. It used to be
   * possible to read one as an empty page and move on; there is nothing left
   * that could mean — the document is the page's name, its variables, its
   * plugins and every word on it, so a directory without one is either a page
   * whose generation stopped half way or a folder that was never a page. Both
   * are worth stopping on, and neither is worth guessing between. */
  if (src.doc === null) {
    say("R1", "FAIL", DOC, 0, "a directory is a page if and only if it holds content.yaml. Without one nothing here is a page: the host will not list it, and the words, the sections and the name that would have been in it do not exist anywhere else.");
    return done();
  }
  const text = src.doc;

  let raw: Yaml;
  try {
    raw = readYaml(text);
  } catch (e) {
    const line = e instanceof DocError ? e.line : 0;
    say("R1", "FAIL", DOC, line, "the document does not parse: " + (e instanceof Error ? e.message : String(e)) + '. The host answers "flatness" and falls back to the raw editor — and the page\'s words are in here now, so the fallback is the only way back to them.');
    return done();
  }
  if (!isMap(raw)) {
    say("R1", "FAIL", DOC, 0, "this is not a page. content.yaml is a map of keys: name, an optional plugin:, variables, and — on a doc page — contents.");
    return done();
  }
  const doc = raw;

  /* R1 — WHICH READER DRAWS THIS PAGE, and what that decides about the rest.
   *
   * A page naming no plugin is its own `index.html`; `doc` is the section
   * runtime. It matters here because it decides what the rest of the file MEANS:
   * a doc page has a closed shape this checker can hold it to, and every other
   * plugin declares what it reads, so its keys are that plugin's input and this
   * has no way to know whether one is missing. */
  const rawPlugin = doc["plugin"];
  if (rawPlugin !== undefined && (typeof rawPlugin !== "string" || !PLUGIN_NAME.test(rawPlugin))) {
    say("R1", "FAIL", DOC, lineOfKey(text, "plugin"), "plugin: is a name in lowercase letters, digits and dashes — the id of the plugin that draws this page. Leave it out and the page draws its own index.html.");
  }
  plugin = typeof rawPlugin === "string" && PLUGIN_NAME.test(rawPlugin) ? rawPlugin : (rawPlugin === undefined ? "html" : DOC_PLUGIN);
  const isDoc = plugin === DOC_PLUGIN;

  /* R61 — the plugin has to resolve to a document somebody can draw with.
   *
   * A page names one and the host looks in two places, in this order: the
   * page's OWN `index.html`, then this workspace's `plugins/<id>/index.html`.
   * NOTHING IS SHIPPED — every plugin is a file in the vault — so there is no
   * third rung, and finding neither draws a stand-in saying so, which is a page
   * nobody can use.
   *
   * ONLY THE FIRST OF THE TWO IS VISIBLE FROM HERE. This checker is handed one
   * page directory and cannot see the workspace around it, so a page naming a
   * plugin is not a finding — it is a page whose plugin is very probably in
   * `plugins/`. What IS a finding is the case with no ambiguity in it: a page
   * that names NO plugin, and so is its own `index.html`, and has none.
   */
  if (plugin === "html" && src.files[PAGE_DOCUMENT] === undefined) {
    say("R61", "FAIL", DOC, lineOfKey(text, "plugin"), "this page names no plugin, so it draws its own " + PAGE_DOCUMENT + " — and there is no " + PAGE_DOCUMENT + " in this directory. Write one, or name the plugin that should draw the page: plugin: doc is the document (sections, slots, markdown), and it is what almost every page wants.");
  }

  /* R61 — `contents:` on a page a document is not drawing.
   *
   * Sections are the doc plugin's input and nobody else's, so this key is read
   * by nothing here: the page draws from its own html or from its plugin's, and
   * every word in `contents` is invisible. It is the shape a page ends up in
   * when `plugin:` was changed and the body was not. */
  if (!isDoc && Object.hasOwn(doc, "contents")) {
    say("R61", "WARN", DOC, lineOfKey(text, "contents"), "contents: is the doc plugin's input, and this page is drawn by " + plugin + " — so nothing here reads it and every word in it is invisible. Move the words into the page that draws them, or say plugin: doc.");
  }

  for (const key of Object.keys(doc)) {
    if (PAGE_KEYS.has(key)) continue;
    // A retired key is refused wherever it appears, plugin input included: a
    // file still carrying `kind:` was written for a format this server does not
    // read, and passing it to a plugin as input would hand it a value from a
    // different era rather than telling anybody.
    if (RETIRED_KEYS.has(key)) {
      say("R1", "FAIL", DOC, lineOfKey(text, key), '"' + key + '" is the old format — there is one kind of page and one reader, contents is the order, and the folder is the hierarchy. The parser refuses it, so this page does not open at all until it is taken out.');
      continue;
    }
    say("R1", "FAIL", DOC, lineOfKey(text, key), '"' + key + '" is not part of a page. A plugin\'s own configuration goes under input:, so the host\'s keys and the plugin\'s cannot collide. The parser refuses an unknown key rather than dropping it, so this page does not open at all.');
  }

  /* ── the page's own values ────────────────────────────────────────────── */

  const pageVars = readVars(doc["variables"], DOC, "the page");
  const names = Object.keys(src.files);

  /* R47 — the keys a page states itself, and the ones a preset MUST.
   *
   * Two, and all that is left of the keys that used to DESCRIBE a page: `kind:`
   * and `render:` are gone and took R3 with them, because there is no second
   * reader to pin, no second kind to declare, and no file on disk that could
   * disagree with what the document says the page is.
   *
   * `pages.create` writes both, so a page the host made already has them. A page
   * an agent wrote by hand often does not, and ON A PRESET THE OMISSION SHIPS:
   * installing copies `content.yaml` verbatim over the document `pages.create`
   * has just written, so a preset missing `name` installs under its slug and
   * nothing else catches it. That escalation used to live on R35, which is now
   * the `/vendor/` rule and nothing else. */
  const isPreset = src.files["preset.yaml"] !== undefined;
  const said = new Set<string>();
  for (const key of REQUIRED) {
    if (Object.hasOwn(doc, key)) continue;
    // `contents` IS the doc plugin's input. On a page drawn by anything else it
    // would be a key belonging to a reader that is not drawing this page, so its
    // absence is the correct shape rather than a missing spine.
    if (key === "contents" && !isDoc) continue;
    said.add(key);
    // The line only when the key is actually there. `lineOfKey` reads the first
    // `<key>:` in the file whatever it is indented under, and every section has
    // a `name:` — so pointing at a line when the PAGE has none points at
    // somebody else's, which reads as a finding about the wrong thing.
    say("R47", isPreset ? "FAIL" : "WARN", DOC, 0, isPreset
      ? "a preset with no " + key + ":. Installing copies this file verbatim over the document the host just wrote, so every key it omits is a key the installed page does not have."
      : key === "name"
        ? "no name: — the host falls back to the directory's own segment, which is an id and not a title."
        : "no contents: — it is the page's spine and is written even when it is empty, because a file without it reads as truncated rather than as empty.");
  }
  if (!said.has("name") && (typeof doc["name"] !== "string" || doc["name"] === "")) {
    say("R47", "WARN", DOC, lineOfKey(text, "name"), "name: is empty, so the host falls back to the directory's own segment, which is an id and not a title.");
  }

  /* ── contents, which is sections and nothing else ─────────────────────── */

  /* R1 — `contents` is a list of SECTIONS.
   *
   * There is no `type:` on an entry, because a section is the only thing this
   * list can hold and a key that distinguishes nothing is a key that can be
   * written wrong. What a section HOLDS — markdown, a table, a child — is one
   * level down, in `parts`, and R48 and R49 are the rules about that.
   *
   * The SHAPE of the list is R1: a `contents` that is not a list, or an entry in
   * it that is not a map, is a file that does not read back as a page, which is
   * the whole of what R1 says. */
  const rawContents = doc["contents"];
  if (rawContents !== undefined && rawContents !== null && !Array.isArray(rawContents)) {
    say("R1", "FAIL", DOC, lineOfKey(text, "contents"), "contents is a list — one entry per SECTION, in the order a person reads them. A section is a div: it owns its own layout and holds any number of parts.");
  }

  const seen = new Set<string>();
  for (const [i, item] of (Array.isArray(rawContents) ? rawContents : []).entries()) {
    const where = "contents entry " + String(i + 1);
    if (!isMap(item)) {
      say("R1", "FAIL", DOC, 0, where + " is not a map. A section is a name, optionally the file holding its markup, and the parts that go in it.");
      continue;
    }
    const name = typeof item["name"] === "string" ? item["name"] : "";
    const line = name === "" ? 0 : lineOfContent(text, name);

    for (const key of Object.keys(item)) {
      if (SECTION_KEYS.has(key)) continue;
      say("R1", "FAIL", DOC, line, RETIRED_SECTION_KEYS.has(key)
        ? '"' + key + '" on "' + (name || where) + '" is the old format — a contents entry is a SECTION now, and the four content types moved down into its parts. The parser refuses it, so this page does not open at all until it is taken out.'
        : '"' + key + '" is not part of a section. The parser refuses an unknown key rather than dropping it, so this page does not open at all.');
    }

    /* R6 — a section the host cannot name is a section nothing can address */
    if (name === "") {
      say("R6", "FAIL", DOC, 0, where + " has no name, and a section is addressed by its name — by the editor reordering it, by the runtime redrawing it, and by every finding about it.");
      continue;
    }
    if (name.startsWith("@")) {
      /* R37 — a child key is derived from the child, never chosen */
      if (!CHILD_KEY.test(name)) {
        say("R37", "FAIL", DOC, line, '"' + name + '" starts with @ but is not a child key. A child\'s section name is @page-<segment> or @table-<name>, derived from the child itself so the same child always lands on the same section — anything else names a section no child will ever be reconciled onto.');
      }
    } else if (!NAME.test(name)) {
      say("R6", "FAIL", DOC, line, '"' + name + '" is not a section name — lowercase, starting with a letter, no dot. The host skips a section it cannot name and it never draws.');
    }

    /* R43 — one name, one section */
    if (seen.has(name)) {
      say("R43", "FAIL", DOC, line, 'two sections are called "' + name + '". The reader keeps the first and drops the second, so half of what is written here never draws — and the editor has two things to reorder under one id and no way to say which.');
      continue;
    }
    seen.add(name);

    const own = readVars(item["variables"], DOC, '"' + name + '"', line);
    const scope: Variables = { ...pageVars, ...own };

    /* R42 — a section's `data:` names markup that is here.
     *
     * OMITTED IS ORDINARY and is not a finding: it resolves to the shipped
     * default section, which is a file like any other and is the whole reason
     * the default is not a branch in the runtime.
     *
     * A NAMED FILE THAT IS NOT THERE FALLS BACK TO THE DEFAULT TOO, which is why
     * this is a WARN and not a FAIL: the slots still draw and the words are
     * still on screen, so the fault reads as a section that lost its layout
     * rather than as a page that lost a section. It is R42 rather than a number
     * of its own because R42 is already the rule that what `data` names has to
     * be there — this is that one level up, on the section instead of the part. */
    let file: string | null = null;
    let broken = false;
    const rawData = item["data"];
    if (rawData !== undefined && rawData !== null) {
      const named = pageFile(rawData);
      if (named === null) {
        broken = true;
        say("R42", "WARN", DOC, line, '"' + name + '" names ' + JSON.stringify(rawData) + ' as its markup, which is not a file this page can hold, so the section falls back to the shipped default. A section\'s data: is a filename beside content.yaml, or one inside _assets/.');
      } else if (src.files[named] === undefined) {
        broken = true;
        say("R42", "WARN", DOC, line, '"' + name + '" names ' + named + ', which is not in this directory, so the section falls back to the shipped default. The words still draw; the layout this section was written to have does not.');
      } else {
        file = named;
      }
    }

    /* ── the parts ──────────────────────────────────────────────────────── */

    /** ONE VALUE OF A SLOT, read and reported on. A slot holds one of these, or
     *  a LIST of them in exactly the same spellings — so a list entry is not a
     *  second kind of thing to get right, and this is a function rather than a
     *  branch. Null when what is there is not a value at all.
     *
     *  `label` is what the findings call it: the slot's id for a single value,
     *  and the id with the entry's index on it for one item of a list. */
    const valueOf = (
      held: Yaml,
      label: string,
      at: number,
    ): { type: string | null; data: string; own: Variables } | null => {
      /* R48 — A BARE STRING IS MARKDOWN. Prose is most of what a slot holds and
       * `body: "…"` should not need a wrapper.
       *
       * A BARE NUMBER OR BOOLEAN IS TOO, and is not a finding: `body: 2026` is
       * prose YAML happens to read as a value, and it reads back as its own text
       * rather than being refused over a missing quote. Failing it would be the
       * checker enforcing a quoting convention nothing else has. */
      if (typeof held === "string" || typeof held === "number" || typeof held === "boolean") {
        return { type: "markdown", data: String(held), own: {} };
      }
      if (!isMap(held)) {
        say("R48", "FAIL", DOC, at, '"' + label + '" on "' + name + '" is ' + (Array.isArray(held) ? "a list inside a list" : "empty") + '. A slot\'s value is a string, which is markdown, or a map, which is a full Content — type, data, and the part\'s own variables — or a LIST of either, which is a list of items. A list of lists is not one of them: an item is a value.');
        return null;
      }
      /* R48 — and a Content has no `name`. The map it sits in already states the
       * slot's id, and a second statement is a chance for the two to disagree. */
      for (const key of Object.keys(held)) {
        if (PART_KEYS.has(key)) continue;
        say("R48", "FAIL", DOC, at, key === "name"
          ? 'a Content with a name: on it. A slot\'s id is the key it sits under — "' + label + '" — so this is a second statement of it that can only disagree, and the parser refuses the key rather than dropping it.'
          : '"' + key + '" is not part of a Content, which carries type, data and its own variables and nothing else. The parser refuses an unknown key rather than dropping it, so this page does not open at all.');
      }
      const type = typeof held["type"] === "string" && TYPES.has(held["type"]) ? held["type"] : null;
      if (type === null) {
        say("R49", "FAIL", DOC, at, '"' + label + '" on "' + name + '" has no usable type. A part is markdown, html, table or child — and there is no diagram type: a diagram is drawn in the section\'s own markup, or written as a fence a plugin in this workspace upgrades in place.');
      }
      const partData = held["data"];
      const data = typeof partData === "string" ? partData
        : typeof partData === "number" || typeof partData === "boolean" ? String(partData)
        : "";
      if (partData !== undefined && partData !== null && !isScalar(partData)) {
        say("R49", "FAIL", DOC, at, 'the data of "' + label + '" on "' + name + '" is text — the prose itself, a filename, a table name, or a child\'s segment, depending on the type.');
      }
      return { type, data, own: readVars(held["variables"], DOC, '"' + name + "." + label + '"', at) };
    };

    const parts: Part[] = [];
    const rawParts: Yaml = item["parts"] ?? null;
    if (rawParts !== null && !isMap(rawParts)) {
      say("R1", "FAIL", DOC, line, 'the parts of "' + name + '" are a map: slot id → what goes in it. The id is the key, matching one ' + SLOT_ATTR + ' in the section\'s markup, so there is no name: on a part and no list to keep in step with the HTML.');
    }
    for (const [id, value] of Object.entries(isMap(rawParts) ? rawParts : {})) {
      const at = lineOfKey(text, id) || line;
      /* R6 — the ids are the format, and a slot id is one of them. It takes the
       * same shape a section name does and for the same reason: it is written in
       * two places, once as a key and once as an attribute value, and anything
       * that has to survive both is better off narrow. */
      if (id === "") {
        say("R6", "FAIL", DOC, at, 'a part of "' + name + '" has no id. A slot\'s id is the key it sits under, and it is what the ' + SLOT_ATTR + ' in the markup names.');
        continue;
      }
      if (!NAME.test(id)) {
        say("R6", "FAIL", DOC, at, '"' + id + '" is not a slot id — lowercase, starting with a letter, no dot. It is written twice, as this key and as a ' + SLOT_ATTR + ' in the markup, and the two have to be the same string.');
      }
      /* R48 — A LIST IS A LIST OF VALUES, which is how a repeating thing is
       * written: each entry is its own value, its own editable region, and its
       * own thing to add or remove. It stays ONE part, because the slot is one
       * slot and what it holds is the array — so nothing here counts items or
       * looks for a separator, and the rules below read the list's prose as the
       * words of the slot they are the words of. */
      if (Array.isArray(value)) {
        const read = value.map((one, n) => valueOf(one, id + "[" + String(n) + "]", at));
        const held = read.filter((one) => one !== null);
        const listOwn: Variables = {};
        for (const one of held) Object.assign(listOwn, one.own);
        parts.push({
          id,
          list: true,
          type: held.length === 0 ? "markdown" : held[0]!.type,
          data: held.map((one) => one.data).join("\n\n"),
          own: listOwn,
          scope: { ...scope, ...listOwn },
          line: at,
        });
        continue;
      }
      const only = valueOf(value, id, at);
      if (only === null) continue;
      parts.push({ id, list: false, type: only.type, data: only.data, own: only.own, scope: { ...scope, ...only.own }, line: at });
    }

    sections.push({ name, file, broken, parts, own, scope, line });
  }

  /* ── which files the sections claim ───────────────────────────────────── */

  /** file name → the sections whose `data:` named it. R51 reads this: the parts
   *  in the document and the slots in the markup have to be the same set.
   *
   *  A LIST, BECAUSE TWO SECTIONS MAY SHARE ONE FILE, and doing so is the point
   *  of a section being a file at all — a page with three bands of the same
   *  shape writes `band.html` once and names it three times. Keyed by section
   *  it would have lost the duplicates; keyed by file with one value it lost all
   *  but the last, which is what it did: every section but one fell out of R51
   *  entirely and the rule reported nothing on exactly the page that reuses its
   *  own layout. The file is still READ once; only the answer is shared out. */
  const sectionFiles = new Map<string, Sect[]>();
  /** file name → the html part that named it. A part's file is markup for ONE
   *  slot, so it declares no slots of its own and R51 has nothing to say. */
  const partFiles = new Map<string, { sect: Sect; part: Part }>();
  /** Everything anything names, which is what R42's unnamed-file WARN is the
   *  complement of. */
  const claimed = new Set<string>();

  for (const sect of sections) {
    if (sect.file !== null) {
      const held = sectionFiles.get(sect.file);
      if (held === undefined) sectionFiles.set(sect.file, [sect]);
      else held.push(sect);
      claimed.add(sect.file);
    }
    /* A CHILD'S SECTION MAY BE DRAWN BY A FILE NAMED FOR THE CHILD, and the
     * parent's copy wins over the child's own `child.html` — the parent is
     * looking at this particular arrangement and the child is not. Whether that
     * file is reached by `data:` or by the name alone is the server's business
     * and the contract does not say, so BOTH spellings claim it here. Claiming
     * it either way is what keeps a correct page out of R42's unnamed-file WARN;
     * it is checked as an ordinary artifact and R51 is held back, because there
     * is nothing in the contract that says what parts a child drawing has. */
    if (sect.name.startsWith("@")) {
      const own = sect.name + ".html";
      if (src.files[own] !== undefined) claimed.add(own);
    }
    for (const part of sect.parts) {
      if (part.type !== "html") continue;
      const named = pageFile(part.data);
      /* R42 — the type and the data have to agree */
      if (named === null) {
        say("R42", "FAIL", DOC, part.line, '"' + sect.name + "." + part.id + '" is an html part whose data is not a filename this page can hold. It names a file beside content.yaml, or one inside _assets/.');
      } else if (src.files[named] === undefined) {
        say("R42", "FAIL", DOC, part.line, '"' + sect.name + "." + part.id + '" names ' + named + ', which is not in this directory. The slot is drawn EMPTY rather than skipped, so the hole is visible and there is nothing in it.');
      } else {
        partFiles.set(named, { sect, part });
        claimed.add(named);
      }
    }
  }

  for (const sect of sections) {
    for (const part of sect.parts) {
      if (part.type === "markdown") {
        /* R42 — a markdown part's data IS the prose. A filename in there is the
         * old format's habit and draws the filename as a paragraph. */
        const body = part.data.trim();
        if (RETIRED_EXT.test(body) || /^[A-Za-z0-9@][A-Za-z0-9._-]*\.html$/.test(body)) {
          say("R42", "FAIL", DOC, part.line, '"' + sect.name + "." + part.id + '" is a markdown part whose data looks like a filename. A markdown part\'s data IS its prose, inline — the runtime draws this string, so the page would show the filename.');
        }
        continue;
      }
      if (part.type === "table" && part.data.trim() === "") {
        say("R42", "FAIL", DOC, part.line, '"' + sect.name + "." + part.id + '" is a table part that names no table. Its data is the table\'s name.');
        continue;
      }
      if (part.type === "child") {
        if (part.data.includes("/")) {
          say("R42", "FAIL", DOC, part.line, '"' + sect.name + "." + part.id + '" names a child by a path. A page\'s contents only ever name its DIRECT children, so a child\'s data is one segment.');
        } else if (part.data.trim() === "") {
          say("R42", "FAIL", DOC, part.line, '"' + sect.name + "." + part.id + '" is a child part that names no child. Its data is the direct child\'s own segment.');
        }
      }
    }
  }

  /* R42 — a file on disk that nothing names is invisible.
   *
   * `child.html` is exempt: it is read from the CHILD'S directory by whichever
   * page draws it, so nothing in this document ever names it and its absence
   * from the list is the normal case rather than the broken one.
   *
   * `index.html` is exempt too, and for a stronger reason: it is THE PAGE. A
   * page that draws itself names no file anywhere because the file is what the
   * box loads, and a document that had to name it would be a second statement of
   * something the directory already says. */
  const strayHtml = names.filter((n) => n !== CHILD_DRAW && n !== PAGE_DOCUMENT && n.endsWith(".html")).sort();
  for (const fileName of strayHtml) {
    if (claimed.has(fileName)) continue;
    say("R42", "WARN", fileName, 0, fileName + " is on disk and nothing in the document names it. The document is the only thing the host reads, so nothing draws this file — give a section data: " + fileName + ", point an html part at it, or delete it.");
  }

  /* R45 — the page's words are in content.yaml */
  for (const fileName of names) {
    if (!RETIRED_EXT.test(fileName)) continue;
    say("R45", "FAIL", fileName, 0, fileName + " is the old format. A markdown part carries its own prose inline and a diagram is drawn in the section that holds it, so nothing reads a file beside content.yaml — the words in here are invisible, and two copies of a paragraph is one of them going stale.");
  }

  /* R40 — `contents` IS the order, and a section with nothing in it draws an
   * empty band.
   *
   * There is no `order:` to disagree with the list — the list IS the order, one
   * statement instead of two — so the only thing left to be wrong is a section
   * that draws nothing. It is a WARN because emptying one is a RECOVERABLE act
   * and deleting it takes the words with it: an empty section keeps its place,
   * which is what makes the thing come back where it was. */
  for (const sect of sections) {
    if (sect.file === null && !sect.broken && sect.parts.length === 0) {
      say("R40", "WARN", DOC, sect.line, '"' + sect.name + '" took the default section and put nothing in it. It keeps its place and draws an empty band until there is a part in it — body: with the prose in it is the whole of the ordinary case.');
    }
    for (const part of sect.parts) {
      if (part.type === "markdown" && part.data.trim() === "") {
        say("R40", "WARN", DOC, part.line, '"' + sect.name + "." + part.id + '" is a markdown part with no prose in it. The slot keeps its place and draws nothing until there are words in its data.');
      }
    }
    if (sect.file === null) continue;
    const html = src.files[sect.file];
    if (html !== undefined && html.trim() === "") {
      say("R40", "WARN", sect.file, 0, sect.file + " is empty. The section is in the order and there is no markup to draw, so the page has a gap where it is.");
    }
  }

  /* R37 — a file named as a child key is named for the child it draws */
  for (const fileName of names) {
    if (!fileName.startsWith("@")) continue;
    const stem = fileName.replace(/\.html$/, "");
    if (!CHILD_KEY.test(stem)) {
      say("R37", "FAIL", fileName, 0, '"' + stem + '" starts with @ but is not a child key. Name it for the child it draws — @page-<segment>.html or @table-<name>.html — because the host derives that name from the child and matches on it.');
    }
  }

  /* ── the templates ────────────────────────────────────────────────────── */

  /* R41 — every {{name}} resolves to something in scope.
   *
   * THE NEAREST ONE WINS, and there are three scopes now rather than two: the
   * part's own values, then the section's, then the page's. A bare name is
   * always the closest one and never a surprise.
   *
   * THERE IS NO CROSS-SLOT FORM ANY MORE. `{{rate::calc}}` was a mechanism for a
   * flat file where every value shared one dictionary; the scopes nest now, so
   * it names nothing and the runtime leaves it on the page verbatim. It is not
   * special-cased below: `::` simply does not match a variable name, so it lands
   * in the same finding every other unresolvable body does.
   *
   * A NAME NOTHING ANSWERS IS LEFT VERBATIM RATHER THAN BLANKED, which is why
   * this is worth a FAIL: the reader sees the braces. A visible `{{tota1}}` is a
   * typo somebody can fix, which is the whole reason the runtime does not blank
   * it — and the whole reason the checker has to be the thing that finds it. */
  const read = new Map<string, Set<string>>(); // "section.part" or "section" or "" -> names read
  const mark = (where: string, key: string) => {
    const set = read.get(where) ?? new Set<string>();
    set.add(key);
    read.set(where, set);
  };

  /** One body of text the runtime interpolates, checked against the scopes it is
   *  interpolated in — NEAREST FIRST, which is both how a name resolves and how
   *  R46 knows which dictionary to credit it to. A `[label, vars]` pair whose
   *  label is `""` is the page, whose variables belong to nobody in particular
   *  and are therefore never reported as dead. */
  const templates = (
    body: string, where: string, line: number, file: string,
    scopes: [string, Variables][],
  ): void => {
    for (const m of body.matchAll(/\{\{([^}]*)\}\}/g)) {
      const inner = (m[1] ?? "").trim();
      if (!VAR_NAME.test(inner)) {
        say("R41", "FAIL", file, line, '"{{' + inner + '}}" in "' + where + '" does not name a variable' + (inner.includes("::")
          ? ": the cross-slot form is gone. It belonged to a flat file where every value shared one dictionary, and the scopes nest now — a bare name reaches this part's variables, then the section's, then the page's."
          : ". It is {{name}}, resolved against this part's variables, then the section's, then the page's.") + " The runtime leaves an unresolvable name on the page with its braces still on it.");
        continue;
      }
      const held = scopes.find(([, vars]) => Object.hasOwn(vars, inner));
      if (held === undefined) {
        say("R41", "FAIL", file, line, '"{{' + inner + '}}" in "' + where + '" resolves to nothing. Nothing by that name is in scope, so the reader sees the braces with the name still in them. Reaching another PAGE is a call — biom.variables(page) — and never a template.');
        continue;
      }
      mark(held[0], inner);
    }
  };

  for (const sect of sections) {
    /* THE SECTION'S MARKUP IS INTERPOLATED TOO, as text and before it is parsed —
     * which is the only way `<img alt="{{caption}}">` can work at all, because an
     * attribute value is not a node and cannot be filled after the fact. A
     * `{{name}}` in there resolves against the SECTION's scope: there is no part
     * around it to be nearer. Without this the markup's names went unchecked and,
     * worse, every variable a section had put there read as dead to R46. */
    if (sect.file !== null) {
      const html = src.files[sect.file];
      if (html !== undefined) {
        templates(html, sect.name, 0, sect.file, [[sect.name, sect.own], ["", pageVars]]);
        /* AND A SECTION'S SCRIPT READS THEM THROUGH `ctx.vars`, WHICH IS NOT A
         * TEMPLATE. A figure laid out from the document's own words — the nodes
         * and edges of a drawing, the rows of a chart — never writes `{{nodes}}`
         * anywhere, because the script is what turns the list into geometry. Left
         * to the braces alone R46 called every one of those variables dead, which
         * is the warning that teaches somebody to delete the diagram.
         *
         * IT IS DELIBERATELY COARSE: the file has to reach `ctx.vars` at all, and
         * then the NAME has to appear in it after a dot, a bracket or a quote.
         * Parsing the script to be sure would be a second language in here, and
         * the failure direction is the safe one — R46 is a WARN about dead weight,
         * so missing one is a tidy-up nobody was prompted to do and inventing one
         * is a correct page reported as wrong. */
        if (/\bctx\s*\.\s*vars\b/.test(html)) {
          for (const key of Object.keys(sect.own)) {
            const name = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (new RegExp('(?:\\.|\\[\\s*["\']?)\\s*' + name + '\\b').test(html)) mark(sect.name, key);
          }
        }
      }
    }
    for (const part of sect.parts) {
      if (part.type !== "markdown") continue;
      const at = sect.name + "." + part.id;
      templates(part.data, at, part.line, DOC, [[at, part.own], [sect.name, sect.own], ["", pageVars]]);
    }
  }

  /* ── each artifact file ───────────────────────────────────────────────── */

  /** Which slots each section's own markup declares, so R51 can hold that
   *  against the parts the document wrote. Null when the file computes a slot
   *  name and the checker could not read the set. */
  const declared = new Map<string, Set<string> | null>();

  for (const [fileName, sects] of sectionFiles) {
    const html = src.files[fileName];
    if (html === undefined) continue;
    artifacts.push(fileName);
    // Read once, and the answer shared out: the house rules are about the FILE
    // and would say the same thing as many times as it is named.
    const found = checkArtifact(fileName, html, sects[0] ?? null);
    for (const sect of sects) {
      declared.set(sect.name, found);
      for (const id of found ?? []) slots.push(sect.name + "." + id);
    }
  }
  for (const [fileName, held] of partFiles) {
    const html = src.files[fileName];
    if (html === undefined) continue;
    artifacts.push(fileName);
    // A part's file is the markup for ONE slot. It declares no slots of its own,
    // so it is checked for the house rules and nothing else.
    checkArtifact(fileName, html, null, held.sect.name + "." + held.part.id);
  }
  for (const fileName of strayHtml) {
    if (sectionFiles.has(fileName) || partFiles.has(fileName)) continue;
    if (!claimed.has(fileName)) continue; // an unnamed file is R42's, not checked
    const html = src.files[fileName];
    if (html === undefined) continue;
    artifacts.push(fileName);
    // A child drawing named for its child. It stands in place of the built-in
    // row and its parts are the child's, not this document's — see the note
    // where it is claimed.
    checkArtifact(fileName, html, null);
  }

  // `child.html` is checked but never counted: it is this page's drawing INSIDE
  // ANOTHER, so it says nothing about whether this page has an artifact in it.
  const childDraw = src.files[CHILD_DRAW];
  if (childDraw !== undefined) checkArtifact(CHILD_DRAW, childDraw, null);

  /* R51 — the parts and the slots are the same set.
   *
   * A section's markup declares one `data-g-part` per hole; its `parts` map says
   * what goes in each. THE TWO ARE ONE STATEMENT MADE TWICE, once in HTML and
   * once in the document, and the whole reason a slot has no `name:` is that the
   * key IS the id — so the only thing left to get wrong is the two sets not
   * matching. Both directions are wrong in the same quiet way: a slot with no
   * part draws an empty hole, a part with no slot is words nothing renders, and
   * neither says anything on the page.
   *
   * A SECTION THAT TOOK THE DEFAULT IS CHECKED THE SAME WAY, against the one
   * slot that file has. That is the payoff for the default being a file rather
   * than a branch: it is not an exception here either.
   *
   * THE TWO DIRECTIONS ARE NOT THE SAME SEVERITY, and that asymmetry is the
   * rule rather than a softening of it. A part with no node never draws and
   * nothing on screen says the words are there — a FAIL. A slot the document
   * has not filled is where the `+` goes in edit mode, and whatever the section
   * put inside it stays as its own placeholder, so an unfilled slot is a page
   * waiting to be written rather than one that is wrong. Only a section where
   * EVERY slot is unfilled is worth a word: that is a layout with nothing in it. */
  for (const sect of sections) {
    if (sect.broken) continue;
    const inFile = sect.file === null ? DEFAULT_PARTS : declared.get(sect.name);
    if (inFile === null || inFile === undefined) continue; // computed, or no file read
    const where = sect.file ?? "the shipped default section";
    for (const part of sect.parts) {
      if (inFile.has(part.id)) continue;
      say("R51", "FAIL", DOC, part.line, '"' + sect.name + "." + part.id + '" is a part with no slot to go in. ' + (sect.file === null
        ? 'This section took the shipped default, which is one slot called "body" — give the section its own data: file with a ' + SLOT_ATTR + '="' + part.id + '" in it, or move the content into body.'
        : where + " declares no " + SLOT_ATTR + '="' + part.id + '". The runtime has nowhere to put this, so it is written down and never drawn.'));
    }
    if (sect.file === null) continue; // an empty default section is R40's
    if (inFile.size === 0) continue;
    if (sect.parts.some((p) => inFile.has(p.id))) continue;
    say("R51", "WARN", sect.file, 0, sect.file + " declares " + String(inFile.size) + " slot" + (inFile.size === 1 ? "" : "s") + ' and "' + sect.name + '" has filled none of them. The section draws its layout with every hole empty — which is where the + goes in edit mode, so it is a page waiting to be written rather than a page that is wrong. Put the words in parts: ' + [...inFile].sort().join(", ") + ".");
  }

  /* R46 — a variable nothing in its scope reads */
  for (const sect of sections) {
    for (const key of Object.keys(sect.own)) {
      if (read.get(sect.name)?.has(key)) continue;
      say("R46", "WARN", DOC, sect.line, '"' + key + '" on "' + sect.name + '" is a variable nothing reads: no {{' + key + '}} in the section\'s parts, and none in its markup either. A variable nothing reads is dead weight — either put it where the words are, or take it out.');
    }
    for (const part of sect.parts) {
      const at = sect.name + "." + part.id;
      for (const key of Object.keys(part.own)) {
        if (read.get(at)?.has(key)) continue;
        say("R46", "WARN", DOC, part.line, '"' + key + '" on "' + at + '" is a variable no {{' + key + '}} in its prose reads. A variable nothing reads is dead weight — either put it where the words are, or take it out.');
      }
    }
  }

  /* R55 and R54 — this page's own type scale.
   *
   * `markdown.yaml` beside `content.yaml` is the one other file the page reader
   * looks for by name, and the only one whose mistakes are invisible: a line it
   * cannot use is dropped in silence and the page draws exactly as it would have
   * without it. The workspace's own scale is checked once per RUN rather than
   * here — see `checkVault`. */
  const ownScale = src.files[SCALE];
  if (ownScale !== undefined) checkScale(ownScale, SCALE, findings);

  /* R53 — the workspace's design language is still the one it shipped with */
  if (src.vault !== undefined && src.vault !== null) findings.push(...checkVault(src.vault));

  return done();

  /* ── one document's variables ───────────────────────────────────────── */

  /** R44 — a variable is a scalar or a list of scalars, and nothing else. A
   *  variable is a thing somebody types into a field: there is no field for a
   *  nested map and no `{{name}}` that could name a leaf of one, and the server
   *  refuses it at the same door. */
  function readVars(value: Yaml | undefined, file: string, where: string, line = 0): Variables {
    const out: Variables = {};
    if (value === undefined || value === null) return out;
    if (!isMap(value)) {
      say("R44", "FAIL", file, line || lineOfKey(text, "variables"), "the variables of " + where + " are names and values — a map, not " + (Array.isArray(value) ? "a list" : "a scalar") + ".");
      return out;
    }
    for (const [key, v] of Object.entries(value)) {
      const at = lineOfKey(text, key) || line;
      if (key === "__proto__") {
        say("R44", "FAIL", file, at, "__proto__ is not a variable name — assigning it rewrites the prototype rather than adding a value.");
        continue;
      }
      if (isScalar(v)) {
        out[key] = v as VarValue;
        continue;
      }
      if (Array.isArray(v) && v.every(isScalar)) {
        out[key] = v as VarValue;
        continue;
      }
      say("R44", "FAIL", file, at, '"' + key + '" in ' + where + ' holds ' + (Array.isArray(v) ? "a list with a map or a list in it" : "a map") + ". A variable is a scalar, or a list of scalars, and nothing else — anything tabular is parallel lists sharing a stem and the same length.");
    }
    return out;
  }

  /* ── one HTML file ────────────────────────────────────────────────────── */

  /** `sect` — the section whose markup this is, when it is a section's own file.
   *  `null` for every other kind of HTML a page holds: the markup of one `html`
   *  part, a `@page-<segment>.html` standing in for a child's drawing, and
   *  `child.html`, which is this page's drawing INSIDE ANOTHER and whose slots
   *  belong to whichever page mounts it.
   *
   *  Answers the slot ids the file declares, so R51 can hold them against the
   *  parts the document wrote — or `null` when a slot name is computed and the
   *  set could not be read. Only a section's own file has a set worth holding
   *  against anything; the rest is checked for the house rules and no more. */
  function checkArtifact(file: string, html: string, sect: Sect | null, part = ""): Set<string> | null {
    const at = (i: number) => lineAt(html, i);
    /** Only reached when there is no section, so this names the part whose
     *  markup this is, or nothing at all for a child drawing. */
    const qualify = (key: string) => (part === "" ? key : part + "/" + key);

    /* R38 — a file that replaces one child's drawing reads the child.
     *
     * This is the one hardcoded-child case a checker can actually see. The file
     * is named for a child, so it stands in place of the built-in drawing of
     * that child — and the only honest source for the child's name, kind and row
     * count is `biom.children()`, which answers the same data the built-in
     * drawing reads. A copy in the markup or in a variable is a name that goes
     * stale the moment somebody renames the page, with nothing to say so.
     *
     * Matched on `.children(` rather than on `biom.children(` because the
     * house shape aliases the shim — `const g = window.biom`. */
    // UNLESS A `child` PART IS DOING THE READING. A parent may keep the child
    // part — which the child plugin draws, reading the child's name and kind
    // itself — and add slots of its own around it for the words that belong to
    // this page. Nothing in that file has to call `children()`, and failing it
    // failed a correct page: the rule was written for the other shape, where the
    // file replaces the drawing entirely and would otherwise hardcode a name
    // that goes stale the moment somebody renames the page.
    const drawnByChildPart = (sect?.parts ?? []).some((one) => one.type === "child");
    if (file.startsWith("@") && !drawnByChildPart && !/\.\s*children\s*\(/.test(html)) {
      say("R38", "FAIL", file, 0, file + " draws one of this page's children and never calls biom.children(). The child's name, kind and row count belong to the child, not to this file — read them, and pick yours out by matching this section\'s own name, which is @page-<segment> for a page and @table-<name> for a table.");
    }

    /* the slots this file declares */
    //
    // A COMMENTED-OUT SLOT IS NOT A SLOT. The scan below counts every mention of
    // the attribute and compares it with the ones it could read as literals, so
    // a `data-g-part` inside an HTML comment — an example in a banner, a line
    // somebody parked — counted as a mention nobody could read and reported the
    // file as declaring a slot from a computed value. Blanked with spaces rather
    // than removed, so every offset still lands on the right line.
    const scan = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
    const seenSlots = new Map<string, number>(); // id -> line
    const dupes: string[] = [];
    const markup = new RegExp(escapeRe(SLOT_ATTR) + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', "g");
    const inJs = new RegExp('["\']' + escapeRe(SLOT_ATTR) + '["\']\\s*[,:]\\s*(?:"([^"]*)"|\'([^\']*)\')', "g");
    // Every mention of the attribute EXCEPT a selector — `[data-g-part]` and
    // `[data-g-part="x"]` alike, in CSS or in a querySelectorAll, are reading
    // slots rather than declaring one.
    let mentions = 0;
    for (const m of scan.matchAll(new RegExp(escapeRe(SLOT_ATTR) + '(?!\\s*["\']?\\s*\\])', "g"))) {
      const before = scan.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0);
      if (before === "[") continue;
      mentions++;
    }

    /** AN ATTRIBUTE SELECTOR IS NOT A DECLARATION. `[data-g-part="items"]` in a
     *  stylesheet or inside `querySelector` is READING a slot the markup already
     *  declared — a section that styles its slots by the name the document
     *  already uses, rather than by a class it invented, is doing something
     *  entirely reasonable. Counted as declarations they were a second element
     *  carrying the same id, and R9 failed the file for it.
     *
     *  The `[` immediately before is the whole discriminator: markup writes
     *  `<div data-g-part="x">` after whitespace, and every selector form —
     *  CSS, `querySelector`, `closest` — writes it after a bracket.
     *  @param {number} at */
    const isSelector = (at: number) => {
      for (let i = at - 1; i >= 0; i--) {
        const ch = scan[i];
        if (ch === "[") return true;
        if (ch !== " " && ch !== "\t") return false;
      }
      return false;
    };

    let literal = 0;
    for (const re of [markup, inJs]) {
      for (const m of scan.matchAll(re)) {
        if (isSelector(m.index ?? 0)) continue;
        literal++;
        const key = (m[1] ?? m[2] ?? "").trim();
        const line = at(m.index ?? 0);
        if (key === "") { say("R51", "FAIL", file, line, "an empty " + SLOT_ATTR + ". A slot carries the id of the part that goes in it, which is the key that part sits under in the section's parts."); continue; }
        if (seenSlots.has(key)) dupes.push(key);
        else seenSlots.set(key, line);
        // A SECTION'S slots are recorded by the caller, once per section that
        // named this file — two sections may share one, and each of them holds
        // the slots. Everything else has no section to be qualified by.
        if (sect === null) slots.push(qualify(key));
      }
    }
    const computed = mentions > literal;
    if (computed) {
      say("R51", "WARN", file, 0, SLOT_ATTR + " is set from a value the checker cannot read. A slot whose id is computed is legal and invisible here — write it as a literal, so the markup and the document can be held against each other by anything other than running the page.");
    }

    /* R57 — prose cut into slots that are only stacked on top of each other.
     *
     * Markdown already stacks. Two slots one after another, with nothing between
     * them and nothing on either to tell them apart, draw exactly what ONE part
     * holding both paragraphs would draw — and the one part is the better
     * document: it opens as a single region, so a sentence can be moved between
     * the paragraphs, a third can be added, and the order can change, none of
     * which is possible across a slot boundary. Cutting there buys nothing and
     * costs the edit.
     *
     * WHAT KEEPS THIS QUIET is the bareness test. A slot carrying a class, an id
     * or a style is placed or painted by its section — a label beside a value, a
     * cell in a grid — and splitting it is the whole point. Only slots with
     * `data-g-part` and NOTHING else are reported, because those are the ones
     * that were cut for no reason the markup can name.
     */
    /** Tags whose ADJACENCY MEANS SOMETHING, so two of them in a row is not a
     *  cut anybody made by accident. A table cell sits beside its neighbour
     *  rather than under it and merging two would destroy the row; `dt` and `dd`
     *  are a pair by definition; a list item is one of a list. Reporting these
     *  was the difference between a rule worth reading and a rule worth
     *  ignoring — measured on this workspace, they were most of what it found. */
    const PAIRED = new Set(["td", "th", "dt", "dd", "li", "option", "tr"]);

    const EMPTY_SLOT = new RegExp("<([a-zA-Z][\\w-]*)\\b([^>]*)>\\s*</\\1\\s*>", "g");
    const stacked: { id: string; tag: string; from: number; to: number; classes: string[]; bare: boolean }[] = [];
    const classesOf = (one: { classes: string[] }) => one.classes;
    for (const m of scan.matchAll(EMPTY_SLOT)) {
      const attrs = m[2] ?? "";
      const named = new RegExp(escapeRe(SLOT_ATTR) + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(attrs);
      if (named === null) continue;
      const id = (named[1] ?? named[2] ?? "").trim();
      const rest = attrs.replace(named[0], "").trim();
      const from = m.index ?? 0;
      const tag = (m[1] ?? "").toLowerCase();
      stacked.push({
        id, tag, from, to: from + m[0].length,
        classes: (/class\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs)?.[1] ?? "").trim().split(/\s+/).filter(Boolean),
        // A slot carrying anything OTHER than a class or the part attribute — an
        // id, a style, a data hook a script reads — was singled out on purpose.
        bare: rest.replace(/class\s*=\s*(?:"[^"]*"|'[^']*')/, "").trim() === "" && !PAIRED.has(tag),
      });
    }

    /* THE CONTAINER DECIDES, and the rule has to ask it.
     *
     * Adjacent in the markup is not stacked on the screen. Three bare `<div>`s
     * that a grid lays out in a row are a row, and joining them into one part
     * collapses it — measured, not imagined: on one page all four candidates
     * were chart axis ticks in a twelve-track grid and totals in a flex row, and
     * a control run of the merge turned a twelve-tick axis into three cells.
     *
     * So a run whose PARENT is laid out by flex or grid is not reported. A flex
     * or grid container CAN stack, and skipping it therefore misses a real cut
     * now and then — which is the right way round to be wrong. A missed
     * suggestion is invisible; a warning that is usually wrong gets ignored, and
     * then so does every warning printed beside it. Before this, eleven of the
     * thirteen runs in the reference workspace were wrong.
     */
    const styleText = blocks(html, "style").map((b) => b.body).join("\n");

    /** Classes whose rule lays their children out ACROSS rather than down: flex
     *  in its default row direction, or a grid with more than one column. A grid
     *  of one column and a flex column both stack, and skipping those was
     *  missing the very cut this rule is for. */
    const laysOutInARow = new Set<string>();
    /** Classes whose rule PLACES the element it is on — as opposed to painting
     *  it. See the run test below for why the difference decides everything. */
    const places = new Set<string>();
    /** PLACED MEANS POSITIONED RELATIVE TO ITS SIBLINGS, and nothing weaker.
     *
     *  A width or a measure looked like placement at first and is not: a measure
     *  can be re-aimed at the paragraph markdown produces (`.head p { … }`), so
     *  it is no reason to keep two slots apart. What cannot be re-aimed is an
     *  element sitting in a named grid area, pulled out of flow, or ordered
     *  against its neighbours — merge those and the arrangement is gone.
     *
     *  Too wide a list made the rule silent on the case it exists for: three
     *  slots stacked in a plain box, one carrying a 34rem measure, and the
     *  measure alone excused the cut. */
    const PLACING = /(?:^|;)\s*(?:position|float|grid-area|grid-column|grid-row|order|align-self|justify-self|place-self)\s*:/;

    for (const m of styleText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2] ?? "";
      const across =
        (/display\s*:\s*(?:inline-)?flex/.test(body) && !/flex-direction\s*:\s*column/.test(body)) ||
        (/display\s*:\s*(?:inline-)?grid/.test(body) &&
          /grid-template-columns\s*:[^;]*(?:repeat|,|\s\S+\s+\S+)/.test(body));
      for (const c of (m[1] ?? "").matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        if (across) laysOutInARow.add(c[1]!);
        if (PLACING.test(";" + body)) places.add(c[1]!);
      }
    }

    /** The classes on the element a run sits inside. A scan rather than a parse:
     *  walk the tags before the run and keep the ones still open. */
    function parentClasses(upto: number): string[] {
      const open: string[][] = [];
      const TAG = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g;
      for (const m of html.slice(0, upto).matchAll(TAG)) {
        const tag = (m[2] ?? "").toLowerCase();
        if (tag === "br" || tag === "img" || tag === "input" || tag === "hr" || tag === "meta") continue;
        if ((m[3] ?? "").trimEnd().endsWith("/")) continue;
        if (m[1] === "/") open.pop();
        else {
          const cls = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[3] ?? "");
          open.push(((cls?.[1] ?? cls?.[2] ?? "").trim().split(/\s+/).filter(Boolean)));
        }
      }
      return open.length > 0 ? open[open.length - 1]! : [];
    }

    for (let i = 0; i < stacked.length; ) {
      let j = i;
      // A run is bare slots separated by whitespace and nothing else.
      while (
        j + 1 < stacked.length &&
        stacked[j]!.bare &&
        stacked[j + 1]!.bare &&
        // Two different elements were chosen to be different. Only a run of the
        // SAME tag, carrying nothing to tell one from the next, is a cut with
        // no reason behind it.
        stacked[j]!.tag === stacked[j + 1]!.tag &&
        html.slice(stacked[j]!.to, stacked[j + 1]!.from).trim() === ""
      ) j++;
      const inARow = parentClasses(stacked[i]!.from).some((c) => laysOutInARow.has(c));
      // ONLY MARKDOWN CAN BE MERGED INTO MARKDOWN. A run holding a table, a
      // child or an html slot is not a cut anybody could undo: those are not
      // prose and there is nowhere for them to go. Reported once, it read as the
      // rule not knowing what a slot held — which is exactly what it did not.
      //
      // A LIST IS NOT PROSE EITHER, however much of it is markdown. Its items
      // are added, removed and reordered one at a time, and the advice this rule
      // gives — put them in ONE part with a blank line between — is the very
      // thing the list format exists to stop somebody doing.
      const allProse = stacked.slice(i, j + 1).every((one) => {
        const held = (sect?.parts ?? []).find((part) => part.id === one.id);
        return held === undefined || (!held.list && (held.type === null || held.type === "markdown"));
      });
      // PAINTED APART IS NOT PLACED APART, and that is the whole test.
      //
      // Three slots stacked in a plain box, one styled as a kicker, one as a
      // heading and one as a lede, look deliberately cut — and are not. Markdown
      // already tells a heading from a paragraph, so one part holding all three
      // draws the same page and is one region somebody can restructure. The cut
      // buys three sealed boxes and a class each.
      //
      // A slot its section PLACES — a grid area, an order, a measure of its own,
      // anything that decides WHERE it sits — is doing work markdown cannot do,
      // and is left alone however bare it looks.
      const anyPlaced = stacked.slice(i, j + 1).some((one) =>
        classesOf(one).some((c) => places.has(c)),
      );
      if (j > i && !inARow && !anyPlaced && allProse) {
        const run = stacked.slice(i, j + 1).map((one) => one.id);
        say("R57", "WARN", file, at(stacked[i]!.from),
          run.join(", ") + " sit one under another with nothing between them and nothing to tell them apart, so each is a sealed box where one region would do. If they are one passage, make them ONE part and let markdown stack them — a blank line between draws the same page and lets a sentence move between paragraphs. If they are several of the SAME THING, make the slot a LIST: one slot, an array in the document, one element per item, and adding or removing one is an array operation rather than an edit to the markup. Cut a separate slot only where the section PLACES the pieces differently.",
        );
      }
      i = j + 1;
    }

    /* R60 — a container feature asked of `@media`.
     *
     * `inline-size` and `block-size` are container features and CSS properties.
     * They are not media features, so `@media (max-inline-size: 52rem)` matches
     * NOTHING — and a media query that never matches looks exactly like a page
     * that was never narrow, which is why this survived in three shipped pages
     * and two starters while the guide beside them warned about it.
     *
     * A FAIL rather than a warning for the same reason R58 is: the page draws,
     * the CSS is valid, nothing anywhere reports a fault, and the collapse the
     * author wrote simply never happens on the one screen that needed it.
     *
     * The whole prelude is scanned and not the first parenthesis, because
     * `(min-width: 40rem) and (max-inline-size: 20rem)` is two of them. Stopping
     * at the `{` is what keeps a declaration INSIDE the block — where
     * `inline-size` is the correct property — out of it.
     */
    for (const s of blocks(html, "style")) {
      for (const m of withoutComments(s.body).matchAll(/@media[^{]*/g)) {
        const feature = /(?:min-|max-)?(inline|block)-size/.exec(m[0] ?? "");
        if (feature === null) continue;
        say("R60", "FAIL", file, at(s.at + (m.index ?? 0)), feature[0] + " is not a media feature — it is a CONTAINER feature and a CSS property. This query matches nothing at all, so the collapse it describes never happens, and a media query that never matches looks exactly like a page that was never narrow. Write a container query, which is what a section wants anyway: declare container-type: inline-size on :scope and ask @container. @media (width <= …) is the other answer, but it measures the whole canvas rather than this section.");
      }
    }

    /* R58 — written against a mode that is gone.
     *
     * There is no edit mode. A page is editable the moment it is drawn, and the
     * two things a section used to ask about it — the `data-g-editing` attribute
     * and `biom.onEdit` — were removed with the toggle they followed.
     *
     * IT IS A FAIL BECAUSE THE PAGE STILL LOOKS RIGHT. A `:scope[data-g-editing]`
     * rule is valid CSS that can never match, so whatever it was revealing — the
     * add, the delete, the whole bar — is hidden for good, and nothing anywhere
     * reports a fault. `biom.onEdit` is worse and louder: it throws, which
     * takes the rest of that script's top level with it.
     */
    const live = withoutComments(scan);
    for (const m of live.matchAll(/data-g-editing/g)) {
      say("R58", "FAIL", file, at(m.index ?? 0), "data-g-editing is never set on anything now. There is no edit mode — a page is editable the moment it is drawn — so a rule written against this attribute is valid CSS that can never match, and whatever it was revealing is hidden for good on a page that otherwise looks finished. Draw the controls in the layout and keep them quiet with :hover and :focus-within instead.");
    }
    for (const m of live.matchAll(/biom\s*\.\s*onEdit|ctx\s*\.\s*editing/g)) {
      say("R58", "FAIL", file, at(m.index ?? 0), (m[0] ?? "").replace(/\s+/g, "") + " does not exist any more. There is no edit mode to hear about or ask about; biom.onEdit throws, and everything after it in that script's top level never runs. Whatever it was dressing, dress it always and keep it quiet in CSS.");
    }

    /* R59 — a list nobody can add to or take from.
     *
     * A list slot is the shape a page GROWS in: one entry per item, and adding
     * or removing one is a splice of an array the document already holds. The
     * runtime ships no add, no delete and no reorder: where a control sits is
     * the section's own design, and a shipped one would land in the corner of
     * somebody's masthead. `ctx.write(part, array)` takes the whole array, so
     * moving an item is the same call as adding one.
     *
     * So a section that draws a list, places no plugin node at it and never
     * calls `ctx.write` has given the
     * reader a row of things they can retype and never re-count, which is the
     * commonest way a page that renders beautifully turns out to be a picture of
     * a document. It is a WARN and not a FAIL because the page is not broken and
     * a genuinely fixed list — the four suits, the twelve months — is a real
     * thing to want; it just needs saying out loud rather than by omission.
     */
    if (sect !== null) {
      const lists = sect.parts.filter((one) => one.list).map((one) => one.id);
      const writes = blocks(html, "script").some((s) => /\bctx\s*\.\s*write\s*\(/.test(s.body));
      /* A MUTATING PLUGIN POINTED AT THE SLOT COUNTS, and that is the half this
       * rule was missing. `items`, `open-list` and `checklist` are files in the
       * workspace's own `plugins/`, and a section that places
       * `<span data-g-plugin="items" data-g-for="steps">` has given the reader
       * exactly what this rule is asking for — with one node instead of forty
       * lines, which is the whole point of the plugins existing.
       *
       * ONLY THOSE THREE, because only those three write the list back. Any
       * `data-g-plugin` at all used to count, so a `reveal` node pointed at a
       * list — which animates it and changes nothing — silenced the warning, and
       * so did a misspelled `data-g-plugin="itmes"` that registers nothing at
       * all. Both are the exact section this rule exists to find.
       *
       * IT STILL CANNOT KNOW WHAT THE PLUGIN DOES, and does not try. This
       * checker is handed one page directory and cannot see `plugins/` around
       * it, so what it reads is the CLAIM — but the claim has to be one of the
       * names that can make it. A vault that rewrites `items.js` to do nothing
       * is out of reach either way, and that is the right amount of trust for a
       * WARN. */
      const handled = new Set(
        [...html.matchAll(/<[^>]*\bdata-g-plugin\s*=\s*"([^"]*)"[^>]*>/g)]
          .filter((m) => MUTATES.has(m[1] ?? ""))
          .flatMap((m) => [...(m[0] ?? "").matchAll(/\bdata-g-for\s*=\s*"([^"]*)"/g)])
          .map((m) => m[1] ?? ""),
      );
      const bare = lists.filter((id) => !handled.has(id));
      if (bare.length > 0 && !writes) {
        say("R59", "WARN", file, 0, bare.join(", ") + (bare.length > 1 ? " hold lists" : " holds a list") + " and nothing in this section can add an item or take one away. The short way is the harness this workspace already has: <span data-g-plugin=\"items\" data-g-for=\"" + bare[0] + "\"></span> draws the add and the per-item delete and inks nothing, so the look stays yours — open-list numbers as well, and checklist reads a status word off each item. The long way is your own script: ctx.read(part) answers the array, ctx.write(part, array) puts it back whole, and the page redraws itself — order included, since the array you write is the order. A list a reader can only retype is a picture of a document.");
      }
    }

    /* R9 — one element per part.
     *
     * The runtime fills by id, so two elements carrying one id is one part drawn
     * where the author meant two things, or drawn once and left stale in the
     * other place. It survived the render going away unchanged: what a slot IS
     * moved from a variable to a part, and neither has two homes. */
    for (const key of new Set(dupes)) {
      say("R9", "FAIL", file, seenSlots.get(key) ?? 0, '"' + key + '" is on more than one element. The runtime fills one node per part, so the second is either drawn stale or not drawn at all — and an editable part commits one value, which leaves the other wrong until a reload.');
    }

    /* ── the scripts ────────────────────────────────────────────────────── */

    const scripts = blocks(html, "script");
    for (const s of scripts) {
      const isModule = /\btype\s*=\s*["']module["']/i.test(s.attrs);
      const source = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(s.attrs);
      if (source) {
        const url = source[1] ?? "";
        // R35 — /vendor/ is the host handing you a library, not the network. A
        // CLASSIC script from that one route loads; a MODULE script does not,
        // because an opaque origin makes it CORS-gated, and it fails silently.
        if (/^\/vendor\/[A-Za-z0-9._-]+$/.test(url)) {
          if (isModule) {
            say("R35", "FAIL", file, at(s.at), '<script type="module" src="' + url + '"> — a module script is CORS-gated and the frame\'s origin is opaque, so this never loads and nothing says why. Load the classic build.');
          } else {
            say("R35", "WARN", file, at(s.at), '<script src="' + url + '"> is loaded on every mount. Append it when the page actually needs it, so a page with nothing to draw pays nothing.');
          }
          continue;
        }
        say("R16", "FAIL", file, at(s.at), url.includes("biom")
          ? "the host inlines the shim ahead of your markup. A page that loads it itself gets two of them, and the second one takes the port."
          : '<script src="' + url + '"> — a section is one file. The one exception is /vendor/<file>, which is the host handing you a library (R35); nothing else may arrive from outside the frame.');
        continue;
      }
      /* R23 — a SECTION script already runs after the document is parsed.
       *
       * It used to be about module scripts and their deferral. It is wider now
       * and for a different reason: the runtime clones every section script into
       * a fresh node at draw time, which is long after `DOMContentLoaded` has
       * fired — a script inserted through `innerHTML` never executes, so it has
       * to be rebuilt either way. So the listener is not merely redundant, it
       * NEVER FIRES, and everything inside it never runs. The rule kept its
       * number because its sentence did not change: do the work at the top
       * level, because by the time this script exists the document is parsed. */
      if (/addEventListener\s*\(\s*["']DOMContentLoaded/.test(s.body)) {
        say("R23", "WARN", file, at(s.at), "DOMContentLoaded inside a section script. The runtime clones this script into a live node when it draws the section, which is after the document was parsed — so the event has already fired, the listener never runs, and everything inside it is dead. Do the work at the top level; `section` is your own element and is already there.");
      }
    }

    /* the banned identifiers, on the script bodies with strings blanked */
    const code = scripts.map((s) => ({ text: blankStrings(s.body), at: s.at }));
    for (const ban of BANS) {
      const re = new RegExp(ban.re.source, ban.re.flags.includes("g") ? ban.re.flags : ban.re.flags + "g");
      for (const chunk of code) {
        for (const m of chunk.text.matchAll(re)) {
          say(ban.rule, ban.severity, file, at(chunk.at + (m.index ?? 0)), ban.says);
        }
      }
    }

    /* ── the markup ─────────────────────────────────────────────────────── */

    /* R18 — an inline handler */
    for (const m of html.matchAll(/\son[a-z]{2,}\s*=\s*["']/gi)) {
      if (!inTag(html, m.index ?? 0)) continue;
      say("R18", "FAIL", file, at(m.index ?? 0), m[0].trim().replace(/\s*=.*/, "") + " is an inline handler. Attach it in the script by id, so the behaviour of the page is in one place and reads as a diff.");
    }

    /* R29 — style attributes */
    for (const m of html.matchAll(/\sstyle\s*=\s*["']/gi)) {
      if (!inTag(html, m.index ?? 0)) continue;
      say("R29", "FAIL", file, at(m.index ?? 0), "an inline style. Presentation goes in the one <style> block, where a person can change it in one place and a diff shows what moved.");
    }
    for (const m of html.matchAll(/setAttribute\s*\(\s*["']style["']/g)) {
      say("R29", "FAIL", file, at(m.index ?? 0), "an inline style, set from script. Presentation goes in the one <style> block.");
    }
    /* SETTING A CUSTOM PROPERTY IS THE ONE THING SCRIPT MAY WRITE onto an
     * element's style, and it is how a value computed at runtime reaches the
     * stylesheet without a literal being written anywhere. Every other first
     * argument is an inline style with a longer name. Scanned here rather than
     * with the other banned identifiers because those run on the source with its
     * string literals blanked, and the whole distinction is in the literal. */
    for (const m of html.matchAll(/\.\s*style\s*\.\s*setProperty\s*\(\s*["']([^"']*)["']/g)) {
      if ((m[1] ?? "").startsWith("--")) continue;
      say("R29", "FAIL", file, at(m.index ?? 0), 'setProperty("' + (m[1] ?? "") + '", …) is an inline style with a longer name. Presentation goes in the one <style> block; setProperty is for a CUSTOM property — setProperty("--accent", var(--cyan)) — which is how a computed value reaches the stylesheet with the palette still in charge of what it resolves to.');
    }

    /* R16 — a remote stylesheet */
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      if (/\brel\s*=\s*["']?(?:stylesheet|preload|prefetch)/i.test(m[0])) {
        say("R16", "FAIL", file, at(m.index ?? 0), "a section is one file, and the frame's origin is opaque. Host CSS does not cross the boundary — the palette does, as data, and the shim re-declares it as custom properties. Write the CSS here and use var(--ink).");
      }
    }
    for (const m of html.matchAll(/@import\b/g)) {
      say("R16", "FAIL", file, at(m.index ?? 0), "@import fetches a stylesheet. A section is one file.");
    }
    for (const m of html.matchAll(/\bimport\s*\(\s*["'](?:https?:)?\/\//g)) {
      say("R16", "FAIL", file, at(m.index ?? 0), "a dynamic import of a URL. A section is one file and imports nothing.");
    }

    /* ── the style block ────────────────────────────────────────────────── */

    const styles = blocks(html, "style");
    if (styles.length > 1) {
      say("R33", "WARN", file, at(styles[1]?.at ?? 0), String(styles.length) + " <style> blocks. One, in the head, so the page has a single place its look is decided.");
    }
    const css = styles.map((s) => s.body).join("\n");
    const cssAt = styles[0]?.at ?? 0;

    /* R25 / R26 — a width that ignores the canvas */
    for (const m of css.matchAll(/(?:^|[;{\s])(min-width|width)\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      const px = Number(m[2] ?? 0);
      if (px <= ICON_PX) continue;
      say("R25", "FAIL", file, at(cssAt + (m.index ?? 0)), m[1] + ": " + String(px) + "px. The artifact is handed a canvas and never told how wide it will be — a panel opens, the window resizes, the same file renders on a phone. Reflow with grid or flex-wrap; a length in px is only for something whose size is fixed by what it is, like an icon.");
    }
    for (const m of css.matchAll(/(?:^|[;{\s])max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      const px = Number(m[1] ?? 0);
      if (px <= ICON_PX) continue;
      say("R26", "WARN", file, at(cssAt + (m.index ?? 0)), "max-width: " + String(px) + "px. A measure on prose is right; write it in rem so it tracks the reader's type size rather than the device's pixels.");
    }
    for (const m of html.matchAll(/<(?:div|section|main|table|img|svg)\b[^>]*\bwidth\s*=\s*["']?(\d+)/gi)) {
      if (Number(m[1] ?? 0) <= ICON_PX) continue;
      say("R25", "FAIL", file, at(m.index ?? 0), "a width attribute in pixels. The artifact does not know how wide it is; let the box reflow.");
    }

    /* R22 AND R27 STOOD HERE, and what they told apart is gone.
     *
     * There is ONE frame per page. It is handed the canvas, it fills it, and it
     * scrolls inside itself — so `vh`, `height: 100%` and `position: fixed` all
     * mean what an author writing them expects, and the two rules that failed
     * them are retired rather than inverted. Retired and never reused: a finding
     * cites its number, and R22 already means something to every report that
     * carries it. `fillGuarded` went with them, because the `[data-g-fill]`
     * guard existed only so a file written for BOTH mounts could say which half
     * of itself was for which. */

    /* R28 — wide content scrolls inside its own box */
    if (/<table\b/i.test(html) && !/overflow-x\s*:\s*(?:auto|scroll)/i.test(css)) {
      const m = /<table\b/i.exec(html);
      say("R28", "WARN", file, at(m?.index ?? 0), "a table with nothing to scroll it. Put it in a wrapper with overflow-x: auto, so a wide table scrolls inside its own box instead of pushing the page sideways.");
    }

    /* R30 — colour */
    for (const m of html.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      const hex = m[1] ?? "";
      if (![3, 4, 6, 8].includes(hex.length)) continue;
      const rest = html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 120);
      const brace = rest.indexOf("{");
      const stop = rest.search(/[;}]/);
      if (brace >= 0 && (stop < 0 || brace < stop)) continue; // an id selector, not a value
      say("R30", "FAIL", file, at(m.index ?? 0), "#" + hex + " is a raw colour. Every colour resolves to a token the workspace palette rewrites — var(--ink), var(--cyan), var(--rule). A literal is invisible to the Theme page and stays wrong on every palette but the one it was written against.");
    }
    for (const m of css.matchAll(FUNCS)) {
      say("R30", "FAIL", file, at(cssAt + (m.index ?? 0)), (m[0] ?? "").trim() + " builds a raw colour. Take the token and adjust it — color-mix(in srgb, var(--cyan) 12%, transparent) keeps the palette in charge.");
    }
    /** The first named colour in a value, ignoring anything already inside a
     *  `var()` or a `url()`.
     *
     *  `var()` because a token whose name happens to contain a colour word is
     *  the palette working, not a literal. `url()` because it points at
     *  something by NAME — `fill: url(#plate-cyan)` names an SVG gradient, and
     *  reading the word out of a reference and calling it a raw colour is the
     *  rule failing a page that is doing exactly what it asks. Found by an agent
     *  drawing a four-colour press, where every gradient is honestly called
     *  cyan, magenta or yellow. */
    const namedIn = (value: string): string | null => {
      const bare = value.replace(/(?:var|url)\([^)]*\)/g, " ").toLowerCase();
      for (const word of bare.split(/[^a-z]+/)) if (NAMED.has(word)) return word;
      return null;
    };

    for (const m of css.matchAll(COLOUR_PROPS)) {
      const word = namedIn(m[2] ?? "");
      if (word !== null) say("R30", "FAIL", file, at(cssAt + (m.index ?? 0)), m[1] + ": " + word + " is a raw colour. Use a palette token.");
    }
    /* A CUSTOM PROPERTY IS NOT A HIDING PLACE. `--panel: whitesmoke` is the
     * palette routed around one indirection further out: every use of it reads
     * as a token, and the Theme page can see it exactly as little as a literal
     * in the rule itself. Define yours FROM one — `--panel: var(--stock-hi)` — or
     * mix one, and the section stays inside the scheme when the palette moves. */
    for (const m of css.matchAll(CUSTOM_PROP)) {
      const word = namedIn(m[2] ?? "");
      if (word !== null) say("R30", "FAIL", file, at(cssAt + (m.index ?? 0)), m[1] + ": " + word + " is a raw colour behind a custom property, which is the palette routed around rather than used. Define it from a token — " + m[1] + ": var(--stock-hi) — or mix one.");
    }
    /* AND MARKUP PAINTS TOO. An inline SVG sets `fill` and `stroke` as
     * attributes without ever reaching the stylesheet, so a rule that read only
     * the `<style>` block had nothing to say about the one place a generated
     * page draws its own shapes. */
    for (const m of html.matchAll(PAINT_ATTR)) {
      if (!inTag(html, m.index ?? 0)) continue;
      const word = namedIn(m[2] ?? "");
      if (word !== null) say("R30", "FAIL", file, at(m.index ?? 0), m[1] + '="' + (m[2] ?? "") + '" is a raw colour on an attribute. Paint from a token — ' + m[1] + '="var(--ink)" — or set the property in the one <style> block, where the palette is already in charge.');
    }

    /* R31 — a button says what it is */
    for (const m of html.matchAll(/<button\b([^>]*)>/gi)) {
      if (!/\btype\s*=/.test(m[1] ?? "")) {
        say("R31", "WARN", file, at(m.index ?? 0), 'a <button> with no type. Inside a form the default is submit, which reloads the frame and loses the page — write type="button".');
      }
    }

    /* R32 — a control says what it is for */
    const labelled = new Set<string>();
    for (const m of html.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']*)["']/gi)) labelled.add(m[1] ?? "");
    for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      const attrs = m[2] ?? "";
      if (/\btype\s*=\s*["'](?:hidden|button|submit|reset)["']/i.test(attrs)) continue;
      const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(attrs);
      const named = /\baria-label(?:ledby)?\s*=/i.test(attrs) || (id !== null && labelled.has(id[1] ?? ""));
      if (!named) {
        say("R32", "WARN", file, at(m.index ?? 0), "a <" + m[1] + "> with no label. Give it an id and a <label for>, or an aria-label — a control nobody can name is a control nobody can use.");
      }
    }

    /* R56 — the words are in the document; the markup carries none of them.
     *
     * ALL TEXT IS MARKDOWN, in `content.yaml`, addressed by a `data-g-part`
     * slot. Markup is for VISUALS AND STRUCTURE — layout, grids, rules, bands,
     * SVG, decoration — and it carries no words.
     *
     * The reason is not taste. The framework edits markdown live and always: click
     * a paragraph and it opens as its raw markdown, every other block stays
     * rendered, and it writes back to `content.yaml`. So every markdown part is
     * a place a person can click and type — and A WORD BAKED INTO A SECTION'S
     * HTML FILE IS A WORD NOBODY CAN EVER EDIT. It is the difference between a
     * page that can be used and one that can only be looked at.
     *
     * IT IS A WARN AND NEVER A FAIL. The page draws, it reads, and the words are
     * on screen; what is missing is the ability to change them. The answer is a
     * slot and a `parts` entry, which is an edit rather than a rewrite.
     *
     * THE ONE EXCEPTION IS THE ARTWORK, and it is hidden by `textRuns` rather
     * than argued about here: a label inside an `<svg>` is part of a drawing, and
     * pulling it into a slot breaks the drawing. `{{name}}` is hidden too — a
     * variable is already something somebody can change without opening this
     * file.
     *
     * ONE FINDING PER FILE, WITH THE WORDS IN IT. A document-shaped section holds
     * dozens of runs, and dozens of warnings would bury every other finding on
     * the page and teach whoever reads the report to stop reading it. Naming what
     * was found is what makes the finding actionable instead of a scolding. */
    const words = textRuns(html).filter((run) => isWords(run.text));
    if (words.length > 0) {
      const shown = words.slice(0, 3).map((run) => '"' + (run.text.length > 48 ? run.text.slice(0, 45) + "…" : run.text).replace(/\s+/g, " ") + '"');
      const rest = words.length - shown.length;
      say("R56", "WARN", file, at(words[0]?.at ?? 0), "words are written into the markup: " + shown.join(", ") + (rest > 0 ? " and " + String(rest) + " more" : "") + ". Text is markdown in content.yaml, reached through a " + SLOT_ATTR + " slot — a word in this file is a word nobody can edit in the app, because only a markdown part opens under the caret. Markup carries the layout, the bands and the drawings; the document carries every word. A label inside an <svg> is the exception, because it is part of the drawing.");
    }

    /* R33 — deterministic formatting */
    if (html.includes("\r\n")) say("R33", "WARN", file, 0, "CRLF line endings. LF, so a diff is a diff.");
    if (!html.endsWith("\n")) say("R33", "WARN", file, at(html.length), "no trailing newline.");
    const tab = html.indexOf("\n\t");
    if (tab >= 0) say("R33", "WARN", file, at(tab + 1), "tab indentation. Two spaces, so the file reads the same wherever it is opened.");

    /* R34 — RETIRED, and the number is burned rather than reused.
     *
     * It warned that a file had not assigned `biom.toMarkdown`, and its
     * premise was one artifact per document: one file, one projection of it into
     * markdown. That is gone. A page is a stack of SECTIONS drawn in ONE box, so
     * this fired once per section FILE while the hook it is about is page-wide —
     * a six-section page collected six warnings for a thing it could only ever do
     * once, and if six sections did each assign it, five would silently lose.
     *
     * Found the way a rule like this should be: two agents building real pages
     * hit it independently, and the workspace's own reference section tripped it
     * too. A rule that fires on correct work is worse than no rule, because it
     * teaches people to stop reading the report.
     *
     * Whatever replaces it belongs to the RUNTIME, which owns the page, and it
     * takes a new number. */
    // The set R51 holds against the document, or null when a slot id is computed
    // and the checker could only see that there are more of them than it read.
    return computed ? null : new Set(seenSlots.keys());
  }
}

/* ── the workspace a page sits in ───────────────────────────────────────── */

/** What is true of the WORKSPACE rather than of a page in it: R53, and R54/R55
 *  over the house type scale at the vault root.
 *
 *  It is a function of its own rather than a rule inside `check` because the CLI
 *  says these once at the end of a run instead of once per directory in it.
 *
 *  R53 — pages exist here, and the workspace still has the design language it
 *  shipped with.
 *
 *  DESIGN-FIRST IS TAUGHT, NOT ENFORCED. Nothing refuses, nothing is broken, and
 *  a workspace is perfectly allowed to keep what it was given — this is a WARN
 *  and it is worded as a prompt, because the thing it is asking for is judgement
 *  rather than a fix. It is here at all because `design/` and `theme.json` are
 *  what everything generated in a vault comes OUT of: generate first and design
 *  afterwards and every page has to be generated twice.
 *
 *  BOTH HALVES HAVE TO BE UNTOUCHED before it says anything. Somebody who has
 *  set a palette has started; so has somebody who has written the design doc a
 *  section of its own. BOTH are compared BY NAME against what a fresh vault
 *  ships with — `SHIPPED_PALETTE` and `SHIPPED_DESIGN` — because the seeded
 *  design doc now arrives WITH markup of its own: it draws three worlds rather
 *  than describing them, so the mere existence of an `.html` file in `design/`
 *  stopped meaning anything. See `SHIPPED_PALETTE` for why a name rather than a
 *  digest, and which direction it fails in.
 *
 *  It is about the VAULT and not about a page, and it stays quiet in both
 *  directions: a fresh workspace with nothing in `pages/` has not skipped its
 *  design work, and a page directory handed over on its own has no workspace to
 *  be judged for. */
export function checkVault(src: VaultSource): Finding[] {
  const out: Finding[] = [];

  /* R55 and R54 — the HOUSE type scale, which every page here inherits.
   *
   * It is checked with the workspace rather than with a page for the same reason
   * R53 is: it is one fact about the vault, and a run over `pages/*` that
   * repeated it per directory would make the loudest thing in the report the one
   * least about the pages in front of you. */
  if (typeof src.scale === "string") checkScale(src.scale, SCALE, out);

  if (!src.pages) return out;

  const worked =
    src.designFiles.some((f) => f.endsWith(".html") && !SHIPPED_DESIGN.has(f)) ||
    designHasSection(src.design);
  if (worked) return out;

  let palette: string | null = null;
  if (src.theme !== null) {
    try {
      const parsed: unknown = JSON.parse(src.theme);
      const held = isMap(parsed as Yaml) ? (parsed as { palette?: { name?: unknown } }).palette : undefined;
      if (held !== undefined && typeof held.name === "string") palette = held.name;
    } catch {
      // A theme.json that does not parse is the server's finding, not this one:
      // it falls back to the default palette and says so in its own log.
      palette = SHIPPED_PALETTE;
    }
  }
  if (palette !== null && palette !== SHIPPED_PALETTE) return out;

  out.push({
    rule: "R53",
    severity: "WARN",
    file: "design/",
    line: 0,
    says: "there are pages in this workspace and its design language is still the one it shipped with — no section of its own in design/, and the palette is still \"" + SHIPPED_PALETTE + "\". Everything generated here comes out of those two, so this is worth doing before the next page rather than after: write this workspace's brand, voice and patterns into design/, and set a palette on the Theme page.",
  });
  return out;
}

/** Does the design doc hold a section that named markup of ITS OWN — markup this
 *  workspace did not ship with? One is enough: a design doc that has been given a
 *  layout somebody chose has been worked on, whatever else is or is not in it.
 *  The bands the vault ships with are not that, which is why they are named in
 *  `SHIPPED_DESIGN` and skipped here.
 *
 *  Read with the same reader as everything else and deliberately forgiving — a
 *  design doc that will not parse is somebody's problem but it is not R53's, and
 *  answering "worked on" is the quiet direction to be wrong in. */
function designHasSection(text: string | null): boolean {
  if (text === null) return true;
  let doc: Yaml;
  try {
    doc = readYaml(text);
  } catch {
    return true;
  }
  if (!isMap(doc)) return true;
  const contents = doc["contents"];
  if (!Array.isArray(contents)) return true;
  return contents.some((s) =>
    isMap(s) && typeof s["data"] === "string" && s["data"] !== "" && !SHIPPED_DESIGN.has(s["data"] as string));
}

/* ── reading a page off disk ────────────────────────────────────────────── */

/** An empty report for a directory that could not be read at all. Written out
 *  rather than built, so adding a field to `Report` cannot leave this one
 *  quietly short of it. */
const noReport = (id: string, says: string): Report => ({
  page: id,
  findings: [{ rule: "R1", severity: "FAIL", file: ".", line: 0, says }],
  fails: 1, warns: 0, ok: false, slots: [], artifacts: [], plugin: "html", sections: 0, defaults: 0,
});

export async function checkDir(dir: string, vault: VaultSource | null = null): Promise<Report> {
  const id = basename(dir.replace(/\/+$/, ""));
  const files: Record<string, string> = {};
  let doc: string | null = null;

  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return noReport(id, "no such directory.");
  }

  for (const name of entries) {
    // `.` belongs to the tooling, and `children/` is where the page's children
    // live — each is a page of its own and is checked as one.
    if (name.startsWith(".") || name === "children") continue;
    // `_assets/` is the ONE directory that is read, one level down and html
    // only. An `html` part may name `_assets/<file>` and the server will find
    // it, so a checker that could not see in there reported every one of them
    // as a file that is not in this directory — a FAIL on a page that was right.
    if (name === ASSETS) {
      let assets: string[] = [];
      try {
        assets = await readdir(join(dir, name));
      } catch {
        continue;
      }
      for (const asset of assets) {
        if (!asset.endsWith(".html")) continue;
        try {
          files[ASSETS + "/" + asset] = await readFile(join(dir, name, asset), "utf8");
        } catch {
          continue;
        }
      }
      continue;
    }
    if (name.startsWith("_")) continue; // the rest of `_` belongs to the host
    // Every extension the format gives a meaning to, plus the two it RETIRED:
    // a `.md` the reader could not see is a `.md` R45 could never report, and
    // the old format's files are exactly what has to be found and taken out.
    if (!/\.(?:yaml|yml|html|md|mermaid)$/.test(name)) continue;
    let text: string;
    try {
      text = await readFile(join(dir, name), "utf8");
    } catch {
      continue; // a directory, or something unreadable — neither is a page file
    }
    if (name === DOC) doc = text;
    else files[name] = text;
  }

  return check({ id, doc, files, vault });
}

/* ── reading the workspace off disk ─────────────────────────────────────── */

/** The vault a page directory sits in, found by walking up until a folder looks
 *  like one — `pages/` beside `theme.json`. Null when nothing up the tree does,
 *  which is the ordinary answer for a directory handed over on its own and is
 *  why R53 says nothing in that case rather than guessing.
 *
 *  It stops at the filesystem root and never at `..` of it, so a page outside a
 *  workspace costs one walk and no findings. */
export async function findVault(from: string): Promise<string | null> {
  let at = resolve(from);
  for (;;) {
    const up = dirname(at);
    try {
      const entries = await readdir(at);
      if (entries.includes("pages") && entries.includes("theme.json")) return at;
    } catch {
      // unreadable, which is the same answer as not being one
    }
    if (up === at) return null;
    at = up;
  }
}

/** Read what `checkVault` needs out of a vault root. Every part of it is
 *  optional: a vault missing `design/` entirely is a vault that has not been
 *  seeded yet, a vault with no `markdown.yaml` is one that never wrote a type
 *  scale, and nothing here has anything to say about either. */
export async function readVault(root: string): Promise<VaultSource> {
  const read = async (rel: string): Promise<string | null> => {
    try {
      return await readFile(join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const list = async (rel: string): Promise<string[]> => {
    try {
      return await readdir(join(root, rel));
    } catch {
      return [];
    }
  };
  const design = await read(join("design", DOC));
  const designFiles = (await list("design")).filter((n) => n !== DOC);
  const theme = await read("theme.json");
  const pages = (await list("pages")).some((n) => !n.startsWith("."));
  const scale = await read(SCALE);
  return { design, designFiles, theme, pages, scale };
}

/* ── saying it ──────────────────────────────────────────────────────────── */

export function formatReport(r: Report): string {
  const lines: string[] = [];
  const where = (f: Finding) => (f.line > 0 ? f.file + ":" + String(f.line) : f.file);
  const count = (n: number, one: string) => String(n) + " " + one + (n === 1 ? "" : "s");
  lines.push(
    r.page + " — " + count(r.sections, "section") +
    (r.defaults > 0 ? " (" + String(r.defaults) + " default)" : "") +
    " — " + String(r.fails) + " fail, " + String(r.warns) + " warn, " + count(r.slots.length, "slot"),
  );
  for (const f of [...r.findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "FAIL" ? -1 : 1))) {
    lines.push("  " + f.severity + "  " + f.rule + "  " + where(f) + "\n        " + f.says);
  }
  if (r.findings.length === 0) lines.push("  nothing to report.");
  return lines.join("\n");
}

/* ── the CLI ────────────────────────────────────────────────────────────── */

declare const process: { argv: string[]; exitCode?: number };

if (import.meta.main) {
  const dirs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (dirs.length === 0) {
    console.log("usage: bun run .agents/skills/check.ts <page-directory>...");
  } else {
    // WHAT IS ABOUT THE WORKSPACE IS SAID ONCE, at the end, however many pages
    // were checked — the design language, and the house type scale every page
    // here inherits. Repeating either per directory would be the loudest finding
    // in a run over `pages/*` and the least about the pages in front of you. The
    // vault is found from the first directory given: a run spanning two
    // workspaces is not a thing anybody does.
    const vault = await findVault(dirs[0] ?? ".");
    const source = vault === null ? null : await readVault(vault);

    let bad = 0;
    for (const dir of dirs) {
      const report = await checkDir(dir);
      console.log(formatReport(report));
      if (!report.ok) bad++;
    }
    if (source !== null) {
      for (const f of checkVault(source)) {
        console.log("\n" + basename(vault ?? ".") + " — the workspace\n  " + f.severity + "  " + f.rule + "  " + f.file + "\n        " + f.says);
      }
    }
    // The host never gates on this. This exit code is for the agent that just
    // wrote the page, so a generation loop can stop on its own mistake. Nothing
    // `checkVault` says reaches it, R55 included: a workspace that has not been
    // designed yet is not a page that failed, and neither is a house type scale
    // somebody has to go and fix at the vault root.
    if (bad > 0) process.exitCode = 1;
  }
}
