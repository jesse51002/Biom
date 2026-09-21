// SPDX-License-Identifier: AGPL-3.0-only
// The design doc — ONE page, living at `design/` in the vault root rather than
// under `pages/`.
//
// THAT PLACEMENT IS THE WHOLE MODULE. The rail draws `pages/`, so a doc that
// sits beside `pages/` is out of the page tree by construction: no reserved id,
// no hidden-id list, no third page kind, and nothing in pages.ts had to learn
// that this file exists. A user is still perfectly free to keep a page of their
// own called `design` under `pages/`; the two never meet, which is why the wire
// gave this its own `design.*` kinds instead of `page.*` with a reserved id.
//
// It is a page in every way that matters — a `content.yaml`, its sections, its
// variables, the same runtime — so this module answers the SAME `Page` shape
// `pages.read` answers with, and the client draws it with the same view.
//
// It takes a `Files` ALREADY ROOTED AT `design/`, exactly as makePages takes one
// rooted at the vault — so everything below reads from the root of the Files it
// was handed rather than from `pages/<id>/`. That one difference from pages.ts
// is the entire reason this is a second module and not a parameter.
//
// EVERYTHING ELSE IS BORROWED, DELIBERATELY. The document normaliser, the
// section resolver and the variables merge all come from the modules beside it —
// same directory, so the layering gate reads them as one module. This doc had a
// copy of section resolution once, and when a new file form arrived it reached
// one copy and not the other: a diagram in the design doc read as an empty
// markdown block, silently, with nothing anywhere to say so. Two copies of a rule
// is two chances to have a different one.
//
// WHAT IT DELIBERATELY DOES NOT HAVE, and it is the same three-kind sentence
// read from the other end: there is no `design.write` and no `design.order`, so
// this module has no `writeSlot` and no `setSections`. A page under `pages/`
// gained both when `section.write` and `section.order` landed on the wire — its
// prose is live and its sections drag — and this one did not, so its prose is
// drawn as an atomic island and its sections have no grip. That is a gap in the
// wire stated rather than papered over: faking either from `writeFile` — read the
// document, splice the text, write the file back — would put a second copy of the
// format's write rules in the module that exists because two copies of a rule is
// two chances to have a different one.
//
// IT HAS NO CHILDREN, and that is why a `child` part resolves to nothing here:
// this doc is not in the tree, so there is nothing for one to point at.
//
// It never writes on read. pages.ts has to reconcile child keys into `contents`
// and therefore has to be careful not to rewrite a document it could not parse;
// this has no children and no reconciliation, so a `content.yaml` that will not
// parse degrades to a doc that still opens and is still repairable through
// `writeFile` — which is the raw fallback here, because `doc.raw` addresses a
// page under `pages/` and cannot reach this directory.

import type { BlockId, Design, DrawnSection, Files, HostErrorCode, MarkdownScale, Page, PageDoc, VarPatch, YamlCodec } from "../../contracts/types.ts";
import { scaleOf } from "../../contracts/scale.ts";
import { DOC_PLUGIN } from "../../contracts/types.ts";
import { DEFAULT_SECTION, docOf, drawSection, pageFile } from "./pages.ts";
import { mergeVariables } from "./docs.ts";

const DOC = "content.yaml";
/** This doc's own type scale, merged over the workspace's. */
const SCALE = "markdown.yaml";

/** The id this page answers to. It is not a `pages/` directory name and never
 *  collides with one: nothing resolves a `PageId` against `design/`, and the
 *  three `design.*` wire kinds carry no id at all. It exists so the client has
 *  something stable to key a frame and a route on. */
const DESIGN: string = "design";

const bad = (code: HostErrorCode, message: string) => Object.assign(new Error(message), { code });

/**
 * @param defaultSection the shipped default section's markup, handed down by the
 *   composition root exactly as it is to makePages — see `DEFAULT_SECTION_FILE`
 *   there. Two readers of one format must draw the same default, so there is one
 *   string and it arrives from one place.
 */
/** THE HOUSE MARKDOWN SCALE, HANDED IN RATHER THAN READ.
 *
 *  This module's `files` is rooted at `<vault>/design`, and the house scale sits
 *  at the vault ROOT — one level up, which `under()` correctly refuses. So the
 *  composition root reads it and passes it, exactly as it passes the shipped
 *  default section for the same class of reason: what this module cannot see, it
 *  is given. The design doc's own `markdown.yaml` merges over it, because the
 *  design doc is a page and a page may have its own scale.
 *
 *  `docDocument` IS THE SAME CLASS OF THING, one step further out. The design doc
 *  is always a doc page, and the `doc` plugin's document now lives in the vault's
 *  own `plugins/` — which this module's `files` cannot see either, being rooted a
 *  level down. So it is handed a way to ask rather than a string: read live, so
 *  editing the plugin in the vault changes the design doc on the next draw. */
export function makeDesign(
  files: Files,
  yaml: YamlCodec,
  defaultSection: string = DEFAULT_SECTION,
  house: () => Promise<MarkdownScale> = async () => ({}),
  docDocument: () => Promise<string> = async () => "",
): Design {
  /** An empty document is "no design doc yet" — a vault whose `design/` has not
   *  been seeded, or one an agent is part-way through writing. `broken` is a
   *  document that will not parse, and it costs the page's sections rather than
   *  the page. */
  const readDoc = async (): Promise<{ doc: PageDoc } | { broken: true }> => {
    const text = await files.read(DOC);
    if (text === null) return { doc: docOf({}, "Design") };
    try {
      return { doc: docOf(yaml.parse(text), "Design") };
    } catch {
      return { broken: true };
    }
  };

  /** The design doc's own scale, if it has one. A file that will not parse is
   *  nothing: a broken type scale must not be the reason the design doc stops
   *  opening. */
  const ownScale = async (): Promise<MarkdownScale> => {
    const text = await files.read(SCALE);
    if (text === null) return {};
    try {
      return scaleOf(yaml.parseAny(text));
    } catch {
      return {};
    }
  };

  return {
    async read(): Promise<Page> {
      const found = await readDoc();
      // A `design/` that is not there at all, or one that will not parse, reads
      // as an empty doc. That is the state a vault made before the design doc
      // existed is in until the next start seeds it, and it opens rather than
      // failing.
      const doc = "doc" in found ? found.doc : docOf({}, "Design");

      const sections: DrawnSection[] = [];
      for (const section of doc.contents) {
        // The same sections a page has, resolved by the same function, so the
        // design doc cannot drift from `pages/`. A `child` part resolves to
        // nothing here and that is correct: this doc is not in the tree, so it
        // has no children to draw.
        sections.push(await drawSection(section, doc.variables, (f) => files.read(f), defaultSection));
      }

      return {
        id: DESIGN,
        name: doc.name,
        markdown: { ...(await house()), ...(await ownScale()) },
        variables: doc.variables,
        sections,
        // THE DESIGN DOC IS A DOC PAGE, always. It is the one page in the vault
        // whose kind is not the author's to choose: it exists to be read as a
        // document, and the host renders it itself until `design.read` joins the
        // runtime's ring.
        plugin: DOC_PLUGIN,
        html: await docDocument(),
        input: {},
        ports: null,
        // NONE HERE. This kind is `design.read`, which nothing in the client
        // calls any more; the design doc is drawn through `page.read` as
        // `@design`, and that read carries its rungs like every other page's.
        extensions: {},
      };
    },

    async writeFile(file: string, text: string): Promise<void> {
      const rel = pageFile(file);
      if (rel === null) throw bad("bad_request", "not a file the design doc can hold");
      // Undo exists because the vault is a git repo and the server commits ahead
      // of the write, not because a snapshot mechanism was built. This is also
      // the raw fallback for a `content.yaml` somebody broke: `doc.raw` addresses
      // a page under `pages/` and cannot reach this directory.
      await files.commit("Before a write to the design doc");
      await files.write(rel, text);
    },

    async patch(section: BlockId | null, patch: VarPatch): Promise<PageDoc> {
      const found = await readDoc();
      // Never rewrite a file that did not parse — the same rule pages.ts holds,
      // and here it is the difference between a design doc somebody can repair
      // through `writeFile` and one that editing a slot silently emptied.
      if (!("doc" in found)) {
        throw bad("flatness", "the design document does not parse, and must be repaired before it is patched");
      }
      // The same merge a page gets, into the same two scopes: null is the doc's
      // own variables, a name is that section's.
      const next = mergeVariables(found.doc, section, patch);
      // No commit. This is a slot losing focus, and a commit per keystroke would
      // bury the agent writes the vault's history exists to make undoable.
      await files.write(DOC, yaml.format(next));
      return next;
    },
  };
}
