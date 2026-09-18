// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — the workspace. What a brand-new vault contains.
//
// This layer exists because it is the first module that needs two layer-2 modules
// at once, and the no-siblings rule sends it up. It constructs nothing: main.ts
// hands it the domain modules and the file roots.
//
// A NEW VAULT IS EMPTY. The root page and nothing else under `pages/`.
//
// It used to seed four pages and a twelve-row table about a trade business, on
// the cold-start argument that a tool for building tools has an empty
// empty-state. That argument is right and the answer was wrong: what a stranger
// actually got was somebody else's invented workspace, and the first thing they
// had to do was work out which of it was theirs and delete the rest. Noise
// before the first useful act.
//
// THE EMPTY EMPTY-STATE HAS NO ANSWER RIGHT NOW, and that is stated rather than
// papered over. It used to be the marketplace — a catalogue in the vault at
// `market/<id>/`, previewed by mounting it and installed by copying it into
// `pages/` — and the catalogue was written against the render layer, page kinds
// and a heterogeneous `contents` list, all three of which are gone. Every
// listing was a page in a format that no longer parses, so the shop went with
// them rather than being ported to a shape nothing has yet drawn. Until it is
// rebuilt, a new vault is a root page and the only way to fill it is to ask an
// agent.
//
// What still seeds is FURNITURE, none of which is content, and all of it is
// additive file by file so a vault made before any piece existed gains it on
// the next start:
//
//   · The ROOT PAGE. Not seeded so much as guaranteed: pages.ts conjures it the
//     instant anything asks for the page list, because every ordering in the
//     product is some page's `contents` and the top level is the root's children.
//     Its name is the user's to change; its id is not. It is born DRAWING
//     ITSELF — its own `index.html`, written beside its document out of
//     `guest/pages/welcome.html` — so what a stranger meets is a shape rather
//     than a stack of sections. `ensureRoot` in pages.ts owns the whole of it.
//
//   · INSTRUCTIONS.md, copied from vault/: the person's own guide, a stub that
//     says what goes in it, theirs from the moment it lands and filled once like
//     everything below.
//
//   · NOT AGENTS.md, NOT docs/, NOT .agents/skills/. The guide, the manual, the
//     skills, the checker and its `_lib/` are the FRAMEWORK's inside a vault, not
//     the person's: they are rewritten whole on every open by
//     `server/workspace/framework.ts`, off the mount path, so a framework release
//     reaches every vault and a change made in one is gone on the next open. A
//     Biom vault is a folder somebody points Claude Code, Cursor or Codex at
//     directly, and the format guide has to be IN the folder and CURRENT — one
//     seeded once went stale exactly as a skill did. The walk below leaves all
//     three out on purpose; `AGENTS.md`'s first line sends the agent to
//     `INSTRUCTIONS.md`.
//
//   · design/ — the design doc, copied from vault/design/. One page,
//     beside `pages/` rather than inside it, holding the workspace's own design
//     language. It is what keeps generated UI coherent instead of generic.
//
//   · base/ — reusable BLOCKS, one directory each, in the shape a page has. A
//     copy is what you get: its `index.html` beside a page's `content.yaml`
//     becomes a section's own markup, and the copy is yours to change afterwards
//     like anything else. It rides the same walk as `.agents/skills/` and `design/` and
//     needed no new mechanism, which is the whole argument for it being a
//     directory under vault/ rather than a second seed root.
//     `vault/base/README.md` states it once.
//
//     ONE OF THEM IS LOAD-BEARING. `base/child/index.html` is not only an
//     example: it is the file `pages.create` copies into every new page as
//     `child.html`, which is how a page says what it looks like inside its
//     parent. Reading it out of the vault rather than out of this file is what
//     makes it the WORKSPACE's default — edit it and every page made afterwards
//     starts from that — and it is why this walk failing is worth a sentence
//     rather than a silence, since what is lost is a file on every future page.
//
//   · NOT plugins/. The framework's plugins used to be copied in here too, and
//     the cost — named at the time — was that a framework fix never reached a
//     copy already made. They are the FALLBACK RUNG now: `pages.ts` reads the
//     vault's `plugins/` first and the framework's own set second, so a vault
//     holds only what it wrote or overrode. What a person can open to read is
//     the mirror `server/workspace/framework.ts` writes into `docs/plugins/` on
//     every open, and what they can change is a copy of it in `plugins/`.
//
//   · The THEME.
//
//   · A PRESET is a directory under a seed root, and nothing about it is code.
//     Nothing installs one on first run — a preset is a page and a page is
//     content — but `install` stays, because it is how a page gets made out of a
//     directory somebody wrote, and it is the mechanism a rebuilt shop would
//     reach for. Nothing ships one right now, which is why the seed root is
//     optional.
//
// Fixtures are invented and say so.

/** A preset directory. Every file beside preset.yaml is copied verbatim into the
 *  page directory, which is what makes the filesystem the registry — Claude Code
 *  creating board.html is what MAKES the section.
 *
 *    presets/
 *      kanban/
 *        preset.yaml    flat: name, page
 *        content.yaml   the page, whole: its name, its variables, its sections
 *        board.html     the section that draws it
 *
 *  One preset installs one page. A preset wanting two pages is not in scope and
 *  would be a second mechanism rather than a bigger one. */

import type { FileEntry } from "../../contracts/types.ts";
import type { Files } from "../../contracts/types.ts";
import type { Palette } from "../../contracts/types.ts";
import type { PageRef } from "../../contracts/types.ts";
import type { Pages } from "../../contracts/types.ts";
import type { PresetId } from "../../contracts/types.ts";
import type { Presets } from "../../contracts/types.ts";
import type { Tables } from "../../contracts/types.ts";
import type { Theme } from "../../contracts/types.ts";
import type { YamlCodec } from "../../contracts/types.ts";
import type { TableTree } from "../domain/tables.ts";
import { ROOT_PAGE } from "../../contracts/types.ts";
// The one file in `base/` that is not only an example: `pages.create` copies it
// into every new page. Imported rather than spelled again so the seeder and the
// reader cannot end up naming two different files.
import { CHILD_DEFAULT } from "../domain/pages.ts";

export interface PresetDeps {
  pages: Pages;
  /** `TableTree` on top of `Tables` because a seeded table has to be placed in
   *  the tree, and `TableSchema` carries no parent — a table's position is
   *  workspace state, not part of what the table IS. */
  tables: Tables & TableTree;
  /** The vault. Workspace state that is not a page: the theme, and the
   *  furniture every vault gets at its root. */
  files: Files;
  /** Where installable page directories live. Read, never written.
   *
   *  OPTIONAL, because nothing ships one: the catalogue that used to fill this
   *  went with the render layer it was written against, and a caller that has no
   *  directory of presets should say so by omitting the root rather than by
   *  pointing at one that is not there. */
  seed?: Files;
  /** Rooted at vault/, which MIRRORS THE VAULT ROOT: `INSTRUCTIONS.md`,
   *  `design/` and `base/`, in exactly the shape they take on disk in a
   *  workspace. Copying it is therefore a walk rather than a translation. Its
   *  `AGENTS.md`, `docs/` and `.agents/skills/` are skipped here and rewritten
   *  by `framework.ts` instead. Read, never written.
   *
   *  OPTIONAL because `contracts/` is frozen, this interface is not, and a
   *  required field would fail the build of a caller that predates it. A
   *  workspace handed no seed root says so once and opens without the guide —
   *  which is a state, not an error. */
  vaultSeed?: Files;
  yaml: YamlCodec;
}

/** The theme is workspace state and no module in contracts/types.ts owns it, so
 *  it lands in the workspace layer beside the other thing a fresh vault needs.
 *  It is one file at the vault root rather than a key on a page because a
 *  palette is workspace state and belongs to no page. */
export interface ThemeStore {
  get(): Promise<Theme>;
  set(patch: Partial<Theme>): Promise<Theme>;
}

const THEME_FILE = "theme.json";

/* ── what a vault gets at its root ──────────────────────────────────────── */

/** What under vault/ the walk below leaves alone: the framework's guide, its
 *  manual and its skills are rewritten by `framework.ts` rather than filled
 *  here. Spelled here as well as there because this module may not import a
 *  sibling; a test holds the two equal. */
const NOT_FILLED: readonly string[] = ["AGENTS.md", "docs", ".agents/skills"];

/* ── the default theme ──────────────────────────────────────────────────── */

// The one place on the SERVER allowed to name a colour. Everything else resolves
// to a token, and every token is rewritten at runtime from this palette — which
// is also what is handed to an artifact frame as data, because custom properties
// do not cross a document boundary.
//
// **THIS IS THE SECOND OF TWO COPIES AND THE TEST HOLDS THEM EQUAL.** The other
// is `BRAND` in `client/theme/palettes.js`, which is the fallback painted before
// `theme.get` answers; this one is what a NEW vault's `theme.json` is written
// from. Neither can import the other — the client sits at layer 13 and this file
// at layer 3, so the edge would be upward — and the shared value cannot move to
// `contracts/`, which is frozen between barriers. So `tests/theme.test.js` reads
// the block below out of this source and asserts it equals the client's, key for
// key: a fresh vault must not flash one scheme and settle into another.
//
// The values are the product's brand — charcoal ground, cream type, Sunflower as
// the one hot colour. `client/theme/palettes.js` carries the reasoning for the
// three roles the brand does not itself name.
const BRAND: Palette = {
  name: "Biom",
  colors: {
    stock: "#0E0F11", stockHi: "#16181B", stockLo: "#0A0B0C", stockEdge: "#3A3F47",
    field: "#1D2024",
    ink: "#EDE6D6", ink2: "#B9B3A5", ink3: "#8F8A7C",
    rule: "#2C3036", ruleSoft: "#23262B",
    cyan: "#FFB020", magenta: "#7AB4FF", yellow: "#FFB020",
    cyanT: "#FFC759", magentaT: "#A9CEFF",
    nonrepro: "#3A3F47", nonreproT: "#6C7682",
    room: "#121316", room2: "#0A0B0C", roomRule: "#2C3036",
    roomInk: "#EDE6D6", roomInk2: "#B9B3A5", roomInk3: "#8F8A7C",
    // Text laid on a filled button, picked against THIS palette's own accents
    // rather than assumed to be white: the darkest paper here, because both
    // fills are light. A palette with dark accents names its lightest instead.
    onSpot: "#16181B",
  },
  extra: [
    { name: "Warning", value: "#FF7A2F" },
    { name: "Won", value: "#5BE37D" },
  ],
};

/** THE THEME IS A PALETTE AND A SET OF TYPE ROLES, AND NOTHING ELSE NOW. It
 *  carried a `background` and a `backgroundOn` — a tiled or shader-drawn layer
 *  under the whole workspace, costing a vendored WebGL bundle, a per-element
 *  mount registry and a fallback path, for a decoration that competed with the
 *  writing. It carried a `render` too, naming the treatment every page followed
 *  by default. A section draws its own background in ordinary CSS and decides
 *  its own treatment, so both keys had nothing left to say. */
const DEFAULT_THEME: Theme = {
  palette: BRAND,
  fonts: {
    roles: { sheet: "C059", furniture: "Nimbus Sans Narrow", gauge: "Cascadia Code" },
    available: [
      { name: "C059", stack: '"Sheet", Georgia, serif', note: "shipped" },
      { name: "Nimbus Sans Narrow", stack: '"Furniture", Arial, sans-serif', note: "shipped" },
      { name: "Cascadia Code", stack: '"Gauge", ui-monospace, monospace', note: "shipped" },
      { name: "Georgia", stack: "Georgia, serif", note: "system" },
      { name: "Helvetica", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif', note: "system" },
    ],
  },
};

/* ── the one flat file left ─────────────────────────────────────────────── */

// `YamlCodec` parses a PAGE — it answers a PageDoc, because that is the one
// document the vault format has. A preset's manifest is not a page, so it is
// read here, and the reader is deliberately the smallest thing that can read
// one: a scalar or an inline list, and no attempt at anything else.

/** A preset's manifest: name, page. One key a line, and every value a scalar or
 *  an inline list of them. It stayed flat while `content.yaml` grew a document
 *  inside it because nothing on it is prose that somebody edits in place. */
const MANIFEST = "preset.yaml";

type Card = Record<string, string | string[]>;

function readCard(text: string): Card {
  const out: Card = {};
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const m = /^([^\s:][^:]*?)[ \t]*:(?:[ \t]+([^]*))?$/.exec(raw);
    if (m === null) continue;
    const key = (m[1] ?? "").trim();
    if (key === "" || key === "__proto__") continue;
    out[key] = cardValue((m[2] ?? "").trim());
  }
  return out;
}

function cardValue(raw: string): string | string[] {
  if (!raw.startsWith("[")) return unquote(raw);
  const items: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (let i = 1; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (quote !== null) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if ((c === '"' || c === "'") && buf.trim() === "") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "]") break;
    if (c === ",") {
      items.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (items.length > 0 || buf.trim() !== "") items.push(buf);
  return items.map((item) => unquote(item.trim()));
}

/** A quoted value gives back what is inside the quotes. `\n` and `\"` are the
 *  only escapes a manifest has ever carried. */
function unquote(t: string): string {
  if (t.startsWith('"') && t.endsWith('"') && t.length > 1) {
    return t.slice(1, -1).replaceAll('\\n', "\n").replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length > 1) return t.slice(1, -1).replaceAll("''", "'");
  const hash = t.search(/\s#/);
  return (hash < 0 ? t : t.slice(0, hash)).trim();
}

const str = (v: string | string[] | undefined): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/* ── the module ─────────────────────────────────────────────────────────── */

export function makePresets(deps: PresetDeps): Presets {
  const { pages, files, seed, vaultSeed } = deps;

  /** Domain failures carry one of the contract's closed error codes, so the API
   *  layer answers with it rather than falling back to `internal`. The message
   *  names no path and no id. */
  const bad = (code: string, message: string) => Object.assign(new Error(message), { code });

  /** One level of the presets root. No root, or a missing directory, is the
   *  normal state — nothing ships a preset — rather than an error. */
  async function ids(): Promise<PresetId[]> {
    if (seed === undefined) return [];
    try {
      const entries = await seed.list(".");
      return entries.filter((e) => e.dir).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async function manifest(id: PresetId): Promise<{ name: string; page: string } | null> {
    if (seed === undefined) return null;
    let text: string | null = null;
    try {
      text = await seed.read(`${id}/${MANIFEST}`);
    } catch {
      return null;
    }
    if (text === null) return null;

    const doc = readCard(text);
    const name = str(doc["name"]);
    const page = str(doc["page"]) ?? name;
    if (name === null || page === null) return null;
    return { name, page };
  }

  async function install(id: PresetId): Promise<PageRef[]> {
    const found = await manifest(id);
    // Carries one of the contract's closed error codes so the API layer answers
    // with it rather than falling back to `internal`. The message names no path.
    if (found === null || seed === undefined) throw bad("not_found", "no such preset");

    // WHERE IT LANDS IS THE WORKSPACE'S BUSINESS, and it is settled by the one
    // act of creating the page: the folder is the hierarchy, so a page made
    // inside the root IS inside the root and there is no key left that could say
    // otherwise. The preset used to ship `parent: null` in its own file and the
    // seeder had to write over it, which is a whole class of bug that went away
    // with the key.
    const ref = await pages.create({ name: found.page, parent: ROOT_PAGE });

    // Everything beside preset.yaml goes into the page directory untouched,
    // content.yaml included: the preset owns its own document, and a preset
    // whose words the host rewrote on the way in would not be the page anyone
    // wrote.
    const entries = await seed.list(id);
    for (const entry of entries) {
      if (entry.dir || entry.name === MANIFEST) continue;
      const text = await seed.read(`${id}/${entry.name}`);
      if (text === null) continue;
      await pages.writeFile(ref.id, entry.name, text);
    }
    return [ref];
  }

  /* ── the vault's own furniture ────────────────────────────────────────── */

  /** One file into the vault, and only if there is nothing there. THIS IS THE
   *  PROPERTY THAT MATTERS MOST in everything below: a vault made before a skill
   *  or the design doc existed gains it on the next start, and anything the user
   *  edited stays exactly as they left it. Gating a whole directory on "is it
   *  empty" is what froze the old catalogue at whatever shipped the day the
   *  vault was made. */
  async function fill(at: string, text: string | null): Promise<void> {
    if (text === null) return;
    if ((await files.read(at)) !== null) return;
    await files.write(at, text);
  }

  /** Copy vault/ into the vault root. It MIRRORS the root layout —
   *  `AGENTS.md`, `.agents/skills/<concept>/SKILL.md`, `design/`, `base/<block>/` — so
   *  this is a walk of two levels rather than a translation, and adding a skill
   *  or a base block is adding a file that nothing in this module has to be
   *  told about.
   *
   *  Why it exists at all: a Biom vault is a folder somebody points Claude
   *  Code, Cursor or Codex at directly. Until this landed, that folder was YAML
   *  and HTML with nothing in it saying what any of it meant — the format guide
   *  lived in the framework repo, which the agent working in somebody else's vault
   *  never sees. "Point an agent at the folder and it just works" was false. */
  async function seedVaultRoot(): Promise<void> {
    if (vaultSeed === undefined) {
      console.warn("vault: no root seed was handed to this workspace — it will carry no AGENTS.md and no skills");
      return;
    }
    let here: FileEntry[];
    try {
      here = await vaultSeed.list(".");
    } catch {
      here = [];
    }
    if (here.length === 0) {
      console.warn("vault: nothing on disk to seed the vault root with — it will carry no AGENTS.md and no skills");
      return;
    }

    for (const entry of here) {
      if (NOT_FILLED.includes(entry.name)) continue;
      if (!entry.dir) {
        await fill(entry.name, await vaultSeed.read(entry.name));
        continue;
      }
      await walk(vaultSeed, entry.name, "", NOT_FILLED);
    }
  }

  /** Copy a directory of the seed, whatever depth it turns out to be.
   *
   *  IT USED TO STOP AT TWO LEVELS, on the reasoning that two was all the shape
   *  had — `.agents/skills/<concept>/SKILL.md`, `design/content.yaml`,
   *  `base/<block>/index.html`. The skills moved to `.agents/skills/<concept>/`
   *  and every one of them silently stopped travelling: the walk found
   *  `.agents/`, found `.agents/skills/` inside it, and hit its own floor before
   *  reaching a single `SKILL.md`. A vault seeded that way opens with the guide
   *  telling the agent to read files that are not there.
   *
   *  IT CATCHES NOTHING. `Files.list` already answers "there is nothing here"
   *  with an empty array — ENOENT, EISDIR and ENOTDIR are its own MISSING set —
   *  so the only throws left are the ones that mean something is wrong with the
   *  install: a directory that cannot be read, a disk that failed. Swallowing
   *  those seeds half a vault and says nothing, which is the one outcome worse
   *  than refusing to mount. */
  async function walk(root: Files, dir: string, into: string, skip: readonly string[] = []): Promise<void> {
    for (const entry of await root.list(dir)) {
      // `.` is the root of a seed and is not a path segment. Spelled with the
      // format's own forward slash and never `path.join`: these are vault-
      // relative logical paths, and a backslash in one is a file Windows would
      // put somewhere else.
      const rel = dir === "." ? entry.name : `${dir}/${entry.name}`;
      // WHAT IS NOT THE PERSON'S. The framework's guide, manual and skills are
      // rewritten on every open rather than filled once.
      if (skip.includes(rel)) continue;
      if (entry.dir) await walk(root, rel, into, skip);
      else await fill(into === "" ? rel : `${into}/${rel}`, await root.read(rel));
    }
  }

  return {
    async list() {
      const out: { id: PresetId; name: string }[] = [];
      for (const id of await ids()) {
        const found = await manifest(id);
        if (found !== null) out.push({ id, name: found.name });
      }
      return out;
    },

    install,

    async seedIfEmpty() {
      // NOTHING HERE IS GATED, and it no longer needs to be. Everything this
      // seeds is furniture rather than content, every write goes through `fill`,
      // and `fill` never touches a file that is already there — so "opening a
      // workspace touches nothing" is now a property of each write rather than
      // of one check at the top, and a vault made before any of this existed
      // gains the missing pieces on the next start.
      //
      // The old gate was `has this workspace got a page or a table in it`, and
      // it worked only because seeding used to CREATE pages. A new vault is
      // empty now, so that test would have answered "not yet" on every run
      // forever and re-run the seed each time.

      // THE VAULT'S OWN GUIDE, and the reason the premise is true: an agent
      // pointed at this folder finds `AGENTS.md` at the root telling it what the
      // folder is and where the skills are, and reads a skill when it needs to
      // go deeper. Before this, that knowledge lived only in the framework repo.
      await seedVaultRoot();

      // THE ROOT PAGE, which is guaranteed rather than seeded: pages.ts conjures
      // it the instant anything asks for the page list, because every ordering
      // in the product is some page's `contents` and the top level is the root's
      // children. Asking is what puts it on disk. Its name is the user's to
      // change from that moment on, and nothing here writes over it again.
      //
      // AFTER THE GUIDE, not before it. A new root is born telling its reader to
      // point an agent at `AGENTS.md`, so the file it names has to be on disk by
      // the time the words are; the other order left a moment in which the first
      // page gave an instruction the folder could not yet follow.
      await pages.list();

      // AND THE ONE PIECE OF IT THAT IS NOT DECORATION. Every page made from now
      // on copies `base/child/index.html` into itself as `child.html`; without
      // it every page falls back to the built-in row, which is a working state
      // and therefore a silent one. Said once, here, because the alternative is
      // wondering later why no page in this vault has the file the skills
      // describe.
      if ((await files.read(CHILD_DEFAULT)) === null) {
        console.warn("vault: base/child is missing — new pages will carry no child.html");
      }

      // The theme, which is workspace state rather than a page. Filled rather
      // than written, so a palette somebody changed survives every restart.
      await fill(THEME_FILE, JSON.stringify(DEFAULT_THEME, null, 2) + "\n");
    },
  };
}

/** One theme over another, KEY BY KEY where the shape is a record.
 *
 *  A top-level spread was what both callers below used to be, and it meant a
 *  patch carrying a `palette` replaced the whole of the base's — so a colour it
 *  did not mention was not defaulted, it was ABSENT. `themeVars` never emitted
 *  the token, the shim never declared it, and `var(--on-spot)` was an invalid
 *  substitution: no warning, no fallback, a filled button's label drawn in
 *  inherited ink. Every theme.json in this repo was missing `onSpot` when that
 *  was found, which stayed invisible only while the chrome had a scheme of its
 *  own — the chrome paints from this now, so an absent key is a hole in it.
 *
 *  Records merge and arrays replace, which is the only reading that makes sense
 *  of each: a colour or a role is one value the patch may or may not have an
 *  opinion about, while `extra` and `available` are LISTS — merging those would
 *  make a colour or a face impossible to remove. */
function over(base: Theme, patch: Partial<Theme>): Theme {
  return {
    palette: {
      name: patch.palette?.name ?? base.palette.name,
      colors: { ...base.palette.colors, ...patch.palette?.colors },
      extra: patch.palette?.extra ?? base.palette.extra,
    },
    fonts: {
      roles: { ...base.fonts.roles, ...patch.fonts?.roles },
      available: patch.fonts?.available ?? base.fonts.available,
    },
  };
}

/** The workspace theme, persisted beside the pages so it survives a restart and
 *  so an artifact frame can be handed the palette as data. */
export function makeTheme(files: Files): ThemeStore {
  async function read(): Promise<Theme> {
    const text = await files.read(THEME_FILE);
    if (text === null) return DEFAULT_THEME;
    try {
      return over(DEFAULT_THEME, JSON.parse(text) as Partial<Theme>);
    } catch {
      // A theme file somebody hand-edited into invalid JSON must not stop the
      // workspace opening. The default is always a working answer.
      console.warn("theme: theme.json did not parse — falling back to the default");
      return DEFAULT_THEME;
    }
  }

  return {
    get: read,
    async set(patch) {
      const next = over(await read(), patch);
      await files.write(THEME_FILE, JSON.stringify(next, null, 2) + "\n");
      return next;
    },
  };
}
