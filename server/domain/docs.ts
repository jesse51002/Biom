// SPDX-License-Identifier: AGPL-3.0-only
// The document a page IS: read it, merge values into it, and write it whole.
//
// It was called sidecar.ts, and the rename is the change. There is no sidecar,
// because there is nothing beside the file: `content.yaml` carries the page's
// prose as well as its shape, so this module is not editing metadata about a
// page any more — it is editing the page.
//
// This is a separate module from pages.ts because it has two consumers with
// different risk. `merge` is the artifact write path — what arrives through
// `biom.setData()` when someone edits a slot, and it lands on ONE scope: a
// null section patches the page's own variables, a name patches that section's,
// which is where a slot writes. `readRaw`/`writeRaw` are the raw fallback the
// host chrome shows when a page will not parse.
//
// THE RAW FALLBACK MATTERS MORE THAN IT DID. The prose used to live in `.md`
// files that survived a broken `content.yaml` untouched; now one bad character
// takes the page's words with it, and this is the only way back to them. Which is
// why `writeRaw` validates BEFORE it writes and then writes the user's own bytes:
// the surface that exists to repair the file must not be able to corrupt it, and
// must not reformat what somebody typed either.
//
// Both paths run the same check, and it is a format check rather than a
// permission check. Something is refused because the reader could not read it
// back, never because of who asked — artifacts have unrestricted access here by
// decision.
//
// It never touches a path itself. It shares `pageDocPath` and the document
// normaliser with pages.ts, which is the same directory and therefore the same
// module to the layering gate: where a page lives is one fact, and two copies of
// the walk is two chances to disagree about it.

import type { BlockId, Content, Docs, Files, HostErrorCode, PageDoc, PageId, Section, VarPatch, YamlCodec } from "../../contracts/types.ts";
import { PLUGIN_NAME, segmentOf } from "../../contracts/types.ts";
import { isVarValue } from "../../contracts/guards.js";
import { contentOf, docOf, isPartName, isSectionName, pageDocPath } from "./pages.ts";

const bad = (code: HostErrorCode, message: string) => Object.assign(new Error(message), { code });

/** Merge a patch into ONE scope of a document, and answer the document it made.
 *  `section` null is the page's own variables; a name is that section's.
 *
 *  THE NEAREST ONE WINS when a template is resolved, so where a value lands is
 *  the whole of what this decides: a value written to the page is in scope
 *  everywhere and a value written to a section is not, and a slot writing to the
 *  page would quietly change what every other section on it says.
 *
 *  IT STOPS AT THE SECTION and does not reach a slot, which is a deliberate
 *  narrowing rather than a gap. A slot's own `variables` are the innermost
 *  scope, and nothing on the wire addresses one: `variables.patch` carries a
 *  section, `data.set` carries a mount, and a section is the smallest thing both
 *  can name. A value a slot alone should hold is a value written into that
 *  slot's `Content` by hand.
 *
 *  Pure, and exported, because `design.ts` patches the same shape in a directory
 *  of its own — the design doc is a page in every way except where it lives. */
export function mergeVariables(doc: PageDoc, section: BlockId | null, patch: VarPatch): PageDoc {
  checkPatch(patch);
  if (section === null) {
    return { ...doc, variables: { ...doc.variables, ...patch } };
  }
  const target = doc.contents.find((c) => c.name === section);
  // A slot whose section has gone. Refused rather than written to the page,
  // because landing it one scope out would put the value in scope for every
  // other section on the page.
  if (target === undefined) throw bad("not_found", "no section by that name");
  const merged: Section = { ...target, variables: { ...(target.variables ?? {}), ...patch } };
  return { ...doc, contents: doc.contents.map((c) => (c === target ? merged : c)) };
}

/** What a patch may carry. A variable is a value somebody types into a field:
 *  a scalar, or a list of scalars. Nothing nested, because a nested variable has
 *  no field to be typed into and no `{{name}}` that could name it. */
function checkPatch(patch: VarPatch): void {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw bad("bad_request", "a patch is a set of names and values");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "" || /\s/.test(key)) throw bad("bad_request", "a name cannot be blank or contain a space");
    // Assigning it would rewrite the prototype rather than add a value, and
    // these names come off the wire.
    if (key === "__proto__") throw bad("bad_request", "__proto__ is not a name");
    if (!isVarValue(value)) {
      throw bad("flatness", "a value is a scalar or a list of scalars, and nothing else");
    }
  }
}

/** THE WHOLE DOCUMENT, checked strictly — every rule whose violation would make
 *  the reader DROP something, and only those.
 *
 *  `docOf` in pages.ts is the tolerant twin: it repairs what it can, because a
 *  page that half-parses should still open. This one THROWS, because it guards
 *  the raw fallback, and a fallback that silently dropped half the sections it
 *  was handed would be a worse liar than the file it was fixing.
 *
 *  IT DOES NOT CHECK FOR KEYS THE FORMAT NO LONGER HAS. `kind:`, `render:`,
 *  `order:` and `parent:` are refused by the parser, at the door, with a
 *  sentence naming what replaced each one — so a second opinion here could only
 *  be a worse one, and it would go stale the next time the format moved.
 *
 *  What is deliberately not checked: whether a section's `data` names a file
 *  that exists, whether a table is real, or whether a child key matches a child.
 *  All three are answered by the vault at read time and all three change under
 *  the document's feet — refusing them here would make the fallback a source of
 *  failures rather than the cure for them. */
export function checkDoc(value: unknown, fallbackName: string): PageDoc {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad("flatness", "a page is a document with name, variables, page and contents");
  }
  const raw = value as Partial<PageDoc>;

  if (raw.name !== undefined && (typeof raw.name !== "string" || raw.name.trim() === "")) {
    throw bad("bad_request", "name is the page's title");
  }
  checkVariables(raw.variables, "the page's variables");

  if (raw.plugin !== undefined && (typeof raw.plugin !== "string" || !PLUGIN_NAME.test(raw.plugin))) {
    throw bad("bad_request", "plugin is a name in lowercase letters, digits and dashes");
  }

  if (raw.contents !== undefined && !Array.isArray(raw.contents)) {
    throw bad("flatness", "contents is the ordered list of sections");
  }
  const seen = new Set<string>();
  for (const entry of raw.contents ?? []) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw bad("flatness", "a section is a name, an html file, its slots and its own variables");
    }
    const section = entry as Partial<Section>;
    if (typeof section.name !== "string" || !isSectionName(section.name)) {
      throw bad("bad_request", "a section name is lowercase, or a child key like @page-notes");
    }
    // One name, one section: two called `calc` give a slot write two places to
    // land and the reader no way to say which.
    if (seen.has(section.name)) throw bad("bad_request", "two sections cannot share a name");
    seen.add(section.name);
    if (section.data !== undefined && typeof section.data !== "string") {
      throw bad("bad_request", "a section's data is the name of the html file that draws it");
    }
    checkVariables(section.variables, "a section's variables");
    checkParts(section.parts);
  }

  return docOf(value, fallbackName);
}

/** SLOT ID → WHAT GOES IN IT. The key is the slot's id, so an unusable key is a
 *  slot the reader drops — which is exactly the class of thing this guards. */
function checkParts(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad("flatness", "parts maps each slot in the section's html onto what goes in it");
  }
  for (const [slot, held] of Object.entries(value as Record<string, unknown>)) {
    if (!isPartName(slot)) throw bad("bad_request", "a slot name is lowercase, as it is in the html");
    const content = contentOf(held);
    if (content === null) {
      throw bad("bad_request", "a slot holds markdown as text, or a map saying markdown, html, table, child or grid");
    }
    // A child key names ONE SEGMENT of a direct child. A path here is a page
    // reaching past its own children, which the format does not have.
    if (content.type === "child" && content.data.includes("/")) {
      throw bad("bad_request", "a child is one segment, never a path");
    }
    checkVariables((held as Partial<Content>).variables, "a slot's variables");
  }
}

function checkVariables(value: unknown, what: string): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad("flatness", `${what} are names and values`);
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "" || key === "__proto__") throw bad("bad_request", "that is not a variable name");
    if (!isVarValue(v)) {
      throw bad("flatness", "a value is a scalar or a list of scalars, and nothing else");
    }
  }
}

export function makeDocs(files: Files, yaml: YamlCodec): Docs {
  /** One promise chain per page, and the reason it exists is that every write
   *  here is a read-modify-write over a whole file. Two overlapping patches — an
   *  artifact saving a slot while the user edits the prose two sections down,
   *  which is an entirely ordinary pair of things to be happening at once — both
   *  read the same text, both write a whole document back, and the first one's
   *  value is gone. Nothing throws: both callers are told they succeeded, which
   *  is what makes it worth serialising rather than detecting.
   *
   *  It matters more than it did, because the file now holds the words as well as
   *  the values: a lost write is a lost paragraph.
   *
   *  Keyed by page because the unit of the file is the page: two pages are two
   *  files and must not queue behind each other. A promise chain and not a lock
   *  file — the server is one process, and a lock on disk would be machinery
   *  guarding against a second one that does not exist. */
  const queues = new Map<PageId, Promise<unknown>>();

  const serialised = <T>(id: PageId, run: () => Promise<T>): Promise<T> => {
    // The chain is joined at CALL time, so the order writes land in is the order
    // they were issued in. Last writer wins, and which one that is is decided by
    // the caller rather than by whichever read happened to finish first.
    const after = (queues.get(id) ?? Promise.resolve()).then(run, run);
    // A failed write must not poison the queue behind it: the next patch is a
    // different patch and deserves its own attempt.
    const tail = after.then(
      () => {},
      () => {},
    );
    queues.set(id, tail);
    // Drain the map when the last write for a page settles, or a long-lived
    // server holds one promise per page it has ever touched.
    void tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return after;
  };

  const readText = async (id: PageId): Promise<string> => {
    const text = await files.read(pageDocPath(id));
    if (text === null) throw bad("not_found", "no such page");
    return text;
  };

  /** yaml.parse throws rather than accepting a document it cannot read. The wire
   *  has one code for "this is not a page document" and it covers a syntax error
   *  too, because from the caller's side they are the same problem. */
  const parse = (id: PageId, text: string): unknown => {
    try {
      return yaml.parse(text);
    } catch (e) {
      throw bad("flatness", e instanceof Error ? e.message : "the document does not parse");
    }
  };

  return {
    async read(id: PageId): Promise<PageDoc> {
      // The whole document, sections included. `Page` is the interpretation of
      // this — files loaded, children looked up — and the two must not drift into
      // meaning different things.
      return docOf(parse(id, await readText(id)), segmentOf(id));
    },

    readRaw(id: PageId): Promise<string> {
      return readText(id);
    },

    merge(id: PageId, section: BlockId | null, patch: VarPatch): Promise<PageDoc> {
      // Serialised, because everything between the read and the write is a window
      // another writer can land in — and this is the artifact path, so the other
      // writer is the user and neither is told anything went wrong.
      return serialised(id, async () => {
        const now = docOf(parse(id, await readText(id)), segmentOf(id));
        const next = mergeVariables(now, section, patch);
        // No commit here. This is a slot losing focus, and a commit per keystroke
        // would bury the agent writes the vault's history exists to make undoable.
        await files.write(pageDocPath(id), yaml.format(next));
        return next;
      });
    },

    writeRaw(id: PageId, text: string): Promise<PageDoc> {
      // Same queue as `merge`: this one reads, checks, commits and then writes,
      // which is a wider window over the same file rather than a narrower one.
      return serialised(id, async () => {
        const rel = pageDocPath(id);
        if ((await files.read(rel)) === null) throw bad("not_found", "no such page");

        // Checked before writing, so the fallback cannot be the thing that
        // corrupts the file it exists to repair.
        const doc = checkDoc(parse(id, text), segmentOf(id));

        await files.commit("Before a hand edit of a page document");
        // The user's own bytes, not a reformat. They typed it; it parsed; it is
        // theirs. Re-serialising here would make the raw editor a lying mirror —
        // and it holds their prose now, so a reflow is not cosmetic.
        await files.write(rel, text);
        return doc;
      });
    },
  };
}
