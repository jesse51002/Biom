// SPDX-License-Identifier: AGPL-3.0-only
// Layer 4 — one HTTP request in, one ApiRequest and one ApiResponse out.
//
// There is ONE API route: POST /api/call, carrying the ApiRequest tagged union.
// Not REST, and the reason matters: the same envelope has to travel over HTTP
// today and postMessage tomorrow, and a URL vocabulary does not survive that
// move while a tagged union is already the message. It also collapses the client
// transport to one function with one type, and it makes `handle` testable with
// no server running at all — which is why the two halves are exported separately.
//
// This module constructs nothing. It receives Deps and may not import
// server/platform/: it has never seen a filesystem path, a SQL string or a
// database handle, and the only thing above it that has is main.ts.

import type { ApiRequest } from "../../contracts/types.ts";
import type { ApiResponse } from "../../contracts/types.ts";
import type { Envelope } from "../../contracts/types.ts";
import type { HostError } from "../../contracts/types.ts";
import type { HostErrorCode } from "../../contracts/types.ts";
import type { Design } from "../../contracts/types.ts";
import type { Docs } from "../../contracts/types.ts";
import type { HostFetchResult } from "../../contracts/types.ts";
import type { PageId } from "../../contracts/types.ts";
import type { Pages } from "../../contracts/types.ts";
import type { Presets } from "../../contracts/types.ts";
import type { Tables } from "../../contracts/types.ts";
import type { Vault } from "../../contracts/types.ts";
import type { ThemeStore } from "../workspace/presets.ts";
import type { Mirror } from "../domain/mirror.ts";
import type { Sharer } from "../domain/share.ts";
import { follow } from "../domain/mirror.ts";

/** THE MIRROR NEVER FAILS A WRITE, AND NEVER FAILS A REDRAW. It is derived: the
 *  page is already saved when this runs, and the next draw of that page rewrites
 *  its file anyway. So a failure is logged where somebody running the server sees
 *  it and swallowed everywhere else — an editor that refused a keystroke because
 *  a projection could not be written would be trading the thing for its shadow,
 *  and so would a page that refused to redraw.
 *
 *  Exported because the composition root refreshes the mirror on the watcher's
 *  path and has to do it under exactly this policy. It is one statement and it
 *  lives here, with the other calls it governs. */
export const mirrored = (what: Promise<unknown>): Promise<void> =>
  what.then(() => {}, (e: unknown) => { console.warn("the markdown mirror", e); });
import { PROTOCOL } from "../../contracts/wire.js";
import { fail } from "../../contracts/wire.js";

// Undo is deliberately absent from this file. The vault is a git repo and the
// server commits ahead of every write, but that belongs to the layer that knows
// what it is about to write: pages.ts commits before a file write and before a
// removal, docs.ts commits before a hand edit and deliberately not before a
// slot losing focus. Adding a commit here would put the same policy in two
// layers, and the one further from the disk would be the one that got it wrong.
export interface Deps {
  pages: Pages;
  /** The design doc — one page at `design/` in the vault root, beside `pages/`
   *  rather than inside it. Its own dependency for the same reason it has its
   *  own wire kinds: it is not addressed by a `PageId` and `Pages` is rooted
   *  somewhere else. */
  design: Design;
  /** THE DOCUMENT A PAGE IS. It was `sidecars`, and the rename is the change:
   *  there is nothing beside the file any more, because `content.yaml` carries
   *  the page's prose as well as its shape. */
  docs: Docs;
  tables: Tables;
  /** CONSTRUCTED AND NOT CALLED FROM HERE. Seeding happens in the composition
   *  root on mount, and the two other members are dead on the wire — see the
   *  note on `Presets` in `contracts/types.ts`. */
  presets: Presets;
  theme: ThemeStore;
  /** THE MARKDOWN MIRROR. It is touched from this layer and not from `pages.ts`
   *  for the reason `restack` is: the mirror READS a page through `Pages`, so a
   *  page write cannot call it without a cycle, and this is the lowest layer
   *  holding both. Every mutation below re-projects the page it changed in the
   *  same request, so the projection is swept into the same commit as the change
   *  it mirrors. */
  mirror: Mirror;
  /** SHARE A PAGE — the stop-gap. Built by the composition root against the
   *  folder, because the capture names the folder in the address it opens and
   *  the rewrite reads the folder's own assets. Refused in production: the
   *  capture drives Playwright, which is a development dependency. */
  share: Sharer;
  /** WHICH BUILD THIS IS, and it is here rather than in `contracts/` on purpose.
   *  The kinds still exist: `ApiRequest` goes on spelling `sql`, `fetch` and
   *  `vault.browse`, the guards go on admitting them, and one server answers
   *  where another refuses. A type narrowed by environment would be a type that
   *  means two different things.
   *
   *  Optional, and absent means development — which is what keeps every existing
   *  caller, this layer's own tests included, saying exactly what it said before.
   *  `server/main.ts` sets it the way it sets every other member here. */
  production?: boolean;
  /** WHICH FOLDER this workspace is, and how to make it a different one.
   *  Implemented by the composition root and by nothing else: opening a vault
   *  rebuilds every module beside this one, and this layer constructs nothing.
   *
   *  Note what the other five have in common and this one does not — they are
   *  built AGAINST a vault, and this one outlives every swap. It is the only
   *  member of Deps that is the same object from one request to the next. */
  vault: Vault;
}

/** The closed enumeration, as a set, so a `code` thrown by a lower layer can be
 *  believed only when it is one of ours. */
const CODES = new Set<string>([
  "unknown_kind", "bad_request", "not_found", "flatness",
  "sql_error", "fetch_failed", "limit", "timeout", "identity", "unsupported", "internal",
]);

const ok = (id: string, value: unknown): ApiResponse => ({ id, g: PROTOCOL, ok: true, value });

/** WHAT A BUILD THAT DOES NOT OFFER A KIND SAYS BACK.
 *
 *  IT SPENDS ITS OWN WORD NOW. This used to answer `not_found`, which was the
 *  least wrong member of a closed enumeration that had no right one: the kind
 *  is known, so `unknown_kind` was a lie; the request was correct, so
 *  `bad_request` blamed the caller; and the retryable codes would have had an
 *  artifact backing off and asking forever. `unsupported` joined
 *  `HostErrorCode` at the barrier and says the thing itself — the kind exists,
 *  this build does not offer it, and asking again will not change that. The
 *  SENTENCE is still what a page author actually reads, so it goes on saying
 *  plainly that the build refuses them rather than that they got it wrong. */
const refused = (id: string, what: string): ApiResponse =>
  err(id, "unsupported", `this build does not offer ${what}`);

/** WHETHER THE NATIVE DIRECTORY DIALOG IS BUILT. It is, so this is true, and
 *  the refusal below is live.
 *
 *  `vault.browse` is the server walking its own filesystem for the picker's
 *  Browse group, and Browse WAS the only way to reach a workspace that is on
 *  disk and not in `Recent` — so refusing it before there was another way would
 *  have left a built application that could not reach a folder at all. The other
 *  way is `app/preload.js`: the shell injects one function, the operating
 *  system's folder dialog, and the picker uses it for Open as well as for
 *  Create's parent. This constant is what released the held refusal.
 *
 *  DEVELOPMENT STILL ANSWERS IT, because `make dev` is a browser
 *  and a browser has no dialog. It has a twin in `client/views/vault.js`, which
 *  hides the group, and the two cannot be one: `contracts/` is the only file
 *  both could import from and it is frozen. A test holds the two literals
 *  equal. */
const NATIVE_DIALOG = true;

// `fail` lives in wire.js, which is JavaScript and so cannot type its own return
// as the closed enum. One cast, here, rather than a second copy of the retryable
// table in TypeScript.
const err = (id: string, code: HostErrorCode, message: string): ApiResponse => ({
  id,
  g: PROTOCOL,
  ok: false,
  error: fail(code, message) as HostError,
});

/** A lower layer's error is trusted only for its code, never for its message:
 *  `message` is a leak channel and never carries a path, a table name or a
 *  query, so every string a caller sees is written here. */
function codeOf(e: unknown, fallback: HostErrorCode): HostErrorCode {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === "string" && CODES.has(c) ? (c as HostErrorCode) : fallback;
}

/**
 * Resolve one ApiRequest. Never throws: every failure comes back as an
 * `ok: false` carrying a code from the closed enumeration, because a contract
 * whose error case is "it throws something" is not a contract.
 */
export async function handle(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  // The envelope is checked at runtime even though the parameter is typed: this
  // is where JSON off the wire arrives, and a type is not a parse. `null` and a
  // bare string are both valid JSON and both arrive here.
  const shape = typeof req === "object" && req !== null ? req : {};
  const env = shape as Partial<Envelope> & { kind?: unknown };
  const id = typeof env.id === "string" && env.id !== "" ? env.id : "";
  if (id === "") return err("", "bad_request", "the envelope carries no correlation id");
  if (env.g !== PROTOCOL) return err(id, "bad_request", "unknown protocol major");
  if (typeof env.kind !== "string") return err(id, "bad_request", "the envelope names no kind");

  try {
    switch (req.kind) {
      /* ── what an artifact may say ────────────────────────────────────── */

      // data.get and data.set are scoped to the page an artifact is mounted on,
      // and a mount is a client-side fact: the bridge holds the context and
      // resolves both against the workspace store. Nothing addresses them here,
      // because an HTTP request carries no mount and the server must never guess
      // which page — or which SECTION — a variables patch was meant for.
      case "data.get":
      case "data.set":
        return err(id, "bad_request", "scoped to a mount, and a mount is not addressable over this route");

      case "doc.get": {
        const page = await deps.pages.read(req.page);
        if (page === null) return err(id, "not_found", "no such page");
        // A doc read by a plugin is the page's prose: every markdown slot, in
        // section order and then in the order the section's own html declares
        // its slots. A page whose sections hold no prose honestly returns none.
        const md = page.sections
          .flatMap((s) => Object.values(s.parts))
          .filter((p): p is Extract<typeof p, { kind: "markdown" }> => p.kind === "markdown")
          .map((p) => p.md)
          .join("\n\n");
        return ok(id, md);
      }

      case "doc.list":
      case "page.list":
        return ok(id, await deps.pages.list());

      // Layer one: what a page holds, pages and tables alike, normalised. An
      // artifact may ask this — it is how a page draws its own children its own
      // way — and an artifact omits `page`, meaning the page it is mounted on.
      // A mount is a client-side fact, so the bridge fills that in against its
      // BridgeContext and this route refuses the unaddressed form for exactly
      // the reason `data.get` above does: an HTTP request carries no mount and
      // the server must never guess which page was meant.
      case "children": {
        if (typeof req.page !== "string" || req.page === "") {
          return err(id, "bad_request", "scoped to a mount, and a mount is not addressable over this route");
        }
        return ok(id, await deps.pages.children(req.page));
      }

      // ANOTHER PAGE'S VARIABLES — the local-first join. A page can read what
      // another page knows and draw something richer than a table with it, and
      // reaching across a page boundary is a CALL rather than a template so that
      // `{{name}}` stays inside one page and a dependency on a page somebody may
      // rename fails visibly instead of leaving a blank in a paragraph.
      //
      // IT HAD NO CASE HERE AT ALL until this rewrite, and that is the FOURTH
      // time this seam has bitten: the kind was in `HostRequest`, in HOST_KINDS
      // and forwarded by the bridge, and fell through to `unknown_kind` — so the
      // join has never once worked and nothing said why. Adding a capability is
      // one line in `HostRequest`, one in the guard's set, one case in the
      // bridge AND ONE CASE HERE.
      //
      // Unaddressed it is refused for the same reason `children` is: an artifact
      // omits `page` meaning the one it is mounted on, a mount is a client-side
      // fact, and the server must never guess which page was meant.
      case "variables": {
        if (typeof req.page !== "string" || req.page === "") {
          return err(id, "bad_request", "scoped to a mount, and a mount is not addressable over this route");
        }
        try {
          const doc = await deps.docs.read(req.page);
          return ok(id, doc.variables);
        } catch (e) {
          console.error("variables", e);
          return err(id, codeOf(e, "not_found"), "no such page");
        }
      }

      case "table.get":
        return ok(id, deps.tables.rows(req.name, req.query));

      case "table.schema": {
        const schema = deps.tables.schema(req.name);
        if (schema === null) return err(id, "not_found", "no such table");
        return ok(id, schema);
      }

      case "table.list":
        return ok(id, deps.tables.list());

      case "row.insert":
        return ok(id, deps.tables.insert(req.name, req.row));

      case "row.update":
        deps.tables.update(req.name, req.row, req.patch);
        return ok(id, null);

      case "row.remove":
        deps.tables.remove(req.name, req.row);
        return ok(id, null);

      case "sql":
        // A page that calls `biom.sql` works in development and stops working in
        // the built application, and that is the one place this build DOES less
        // rather than merely showing less. `Architecture/Egress` is what this
        // stands in for — a declared, approved, recorded grant per artifact —
        // and none of it is built; a flat refusal is the floor under a mechanism
        // that is specified and absent, not the design.
        if (deps.production) return refused(id, "SQL from a page");
        try {
          return ok(id, deps.tables.sql(req.query, req.params));
        } catch (e) {
          console.error("sql", e);
          return err(id, codeOf(e, "sql_error"), "the query did not run");
        }

      case "fetch":
        // The other half of the same sentence. Refusing both costs the shipped
        // screens nothing: the workspace's own chrome is client zero of the
        // artifact contract and issues `table.get` and `row.insert`, never
        // either of these.
        if (deps.production) return refused(id, "calling out to the internet from a page");
        return await proxy(id, req.url, req.init);

      case "theme.get":
        return ok(id, await deps.theme.get());

      /* ── what only the workspace UI may say ──────────────────────────── */

      case "page.read": {
        const page = await deps.pages.read(req.page);
        if (page === null) return err(id, "not_found", "no such page");
        return ok(id, page);
      }

      case "page.share":
        if (deps.production) return refused(id, "sharing a page");
        return ok(id, await deps.share.share(req.page));
      case "page.create": {
        const made = await deps.pages.create(req.init);
        await mirrored(follow(deps.mirror, made.id, true));
        return ok(id, made);
      }

      case "page.remove":
        await deps.pages.remove(req.page);
        // The page is gone, so its projection is a file about nothing. The
        // parent is re-projected because it lists its children and has just lost
        // one.
        await mirrored(deps.mirror.drop(req.page));
        await mirrored(follow(deps.mirror, req.page, true));
        return ok(id, null);

      case "page.rename":
        // A RENAME IS A MOVE: the last segment of an id is spelled from the
        // name, so the directory follows it and the answer is the NEW id. So
        // everything `page.move` does for the ids beneath a page is done here
        // too — the tables re-pointed, the mirror carried — and the one parent
        // is re-projected because it lists its children by name.
        try {
          const to = await deps.pages.rename(req.page, req.name);
          if (to !== req.page) restack(deps, req.page, to);
          if (to !== req.page) await mirrored(deps.mirror.rename(req.page, to));
          await mirrored(follow(deps.mirror, to, true));
          return ok(id, to);
        } catch (e) {
          console.error("page.rename", e);
          const code = codeOf(e, "internal");
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "no such page"
              : said !== "" ? said
              : "that page could not be renamed",
          );
        }

      case "page.writeFile":
        // The agent seam. Claude Code writes into the vault directly today and
        // this route exists for the day it does not; the markdown editor and the
        // raw-YAML fallback are its first consumers, so it is exercised by the
        // UI before an agent is ever built.
        await deps.pages.writeFile(req.page, req.file, req.text);
        return ok(id, null);

      // A section is its entry in `contents` — which carries its own variables
      // and its slots — plus its own html file and the file of every `html` slot
      // in it. So it is one kind and the server does all of it or none. Two
      // requests would leave the failure modes half-done and put two commits in
      // the vault for one thing the user did.
      //
      // THE MIDDLE RING, and checked rather than assumed: `section.remove` is in
      // `RuntimeRequest` and not in `HostRequest`, so `isHostRequest` refuses it
      // and a section cannot restructure the page it is drawn on — only the
      // runtime that draws the page can.
      case "section.remove":
        try {
          const left = await deps.pages.removeSection(req.page, req.section);
          await mirrored(follow(deps.mirror, req.page));
          return ok(id, left);
        } catch (e) {
          console.error("section.remove", e);
          const code = codeOf(e, "internal");
          // The domain's own sentence, when it has one — the refusals here are
          // written FOR A PERSON and carry no path or id, and the one that
          // matters says what DOES remove a child. Flattened to "that could not
          // be removed" it reads as the button being broken.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "no such page"
              : said !== "" ? said
              : "that section could not be removed",
          );
        }

      // WRITING A PARAGRAPH BACK, which is the exit condition of the whole
      // framework and the one thing the format change nearly took with it: the
      // prose used to live in `<id>.md` and go back through `page.writeFile`,
      // and once it moved inside the document nothing on the wire could put a
      // typed paragraph on disk.
      //
      // ONE SLOT'S TEXT AND NOTHING ELSE, which is why it names a page, a
      // section AND a part. It fires on a debounce while somebody is typing, so
      // a kind that carried the whole document would make every keystroke a
      // chance to overwrite a change that arrived in between.
      //
      // THE MIDDLE RING: it is in `RuntimeRequest` and not in `HostRequest`, so
      // `isHostRequest` refuses it. The runtime owns editing the page it drew; a
      // section drawn on that page must not be able to rewrite its neighbours.
      case "section.write":
        try {
          await deps.pages.writeSlot(req.page, req.section, req.part, req.data);
          await mirrored(follow(deps.mirror, req.page));
          return ok(id, null);
        } catch (e) {
          console.error("section.write", e);
          // The domain's own sentence, which is the only one that can tell "no
          // such page" from "no such section" from "no such slot" — and all
          // three are written for a person and carry no path or id.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            codeOf(e, "internal"),
            said !== "" ? said : "that text could not be written",
          );
        }

      // THE PAGE'S OWN MARKDOWN, reported by whatever drew it, on its way to
      // `_markdown/`. This is the only write on this route whose CONTENT the
      // server did not compute: the box runs the page's code, so the box is the
      // only half that knows what a board or a hand-written document says in
      // words, and it cannot write a file.
      //
      // THE MIDDLE RING, and that matters here: a section drawn on a page must
      // not be able to rewrite the archive copy of the page it sits on. The
      // runtime that drew the whole page is what may speak for it.
      case "page.projection":
        try {
          await deps.mirror.write(req.page, req.markdown);
          return ok(id, null);
        } catch (e) {
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          // A SENTENCE AND NOT A STACK, which is the one arm on this route where
          // the difference is visible in ordinary use. `@design` and `@map` are
          // pages the framework itself mounts and neither is mirrored — a page
          // id with an `@` in it cannot be a path segment — so the runtime
          // projects, `mirror.write` refuses by name, and this printed a full
          // stack trace every single time anybody opened the design doc or the
          // map. A frame on stderr is supposed to mean something threw where a
          // refusal was meant to be a sentence; printing one for a refusal is
          // what makes that signal unreadable. The code and the sentence are
          // still said here, and the box logs its own.
          console.warn("page.projection", codeOf(e, "internal"), said !== "" ? said : "that projection could not be stored");
          return err(id, codeOf(e, "internal"), said !== "" ? said : "that projection could not be stored");
        }

      // THE ORDER, AND WHAT IS IN IT. Adding, reordering, duplicating and
      // removing are one kind because they are one edit to one list — `contents`
      // IS the order, so there is no second place for a name to be in a
      // different position and no way for the two to disagree. Entries are
      // matched by name.
      case "section.order":
        try {
          const now = await deps.pages.setSections(req.page, req.sections);
          await mirrored(follow(deps.mirror, req.page));
          return ok(id, now);
        } catch (e) {
          console.error("section.order", e);
          // The domain's own sentence, which is written for a person and carries
          // no path or id — and the one that matters says what a child key is
          // and why it is not the caller's to place.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            codeOf(e, "internal"),
            said !== "" ? said : "that page could not be reordered",
          );
        }

      // MOVE A PAGE, WHICH IS NOW MOVING A DIRECTORY, and the answer is the NEW
      // id. There is no `parent:` to patch: the folder is the hierarchy, so the
      // page's id becomes `<parent>/<its own segment>` and every id beneath it
      // changes with it.
      //
      // NOTHING FORWARDS. A caller holding the old id gets `not_found` on its
      // next read rather than somebody else's page, which is a visible failure
      // instead of a quiet substitution — so the client re-routes on what comes
      // back here.
      case "page.move":
        try {
          const to = await deps.pages.move(req.page, req.parent);
          // A TABLE PARENTED UNDER THE PAGE THAT MOVED WOULD GO STALE. A table
          // has no directory, so its parent is registry state rather than a
          // fact the filesystem restates — the move renames the pages and the
          // registry goes on naming an id that no longer exists, and the table
          // disappears from the tree while still claiming a parent.
          //
          // It is fixed HERE and it belongs here: pages.ts and tables.ts are
          // siblings and there is no sideways, so this layer is the lowest one
          // holding both. Every table under the moved subtree is re-pointed at
          // the same position under the new id, in the same request, so the
          // move is one thing that happened rather than two.
          if (to !== req.page) restack(deps, req.page, to);
          // The old path names nothing now and the new one names a page nobody
          // has drawn yet, so both halves are done here rather than waiting for
          // somebody to open it. The mirror is CARRIED rather than dropped and
          // re-projected: a file in it is named by its id, and every id under
          // the page that moved has just changed — dropping the old path and
          // projecting only the new one deletes the whole subtree's markdown.
          // Both parents are re-projected too, because a parent lists its
          // children and one has just left while another arrived.
          if (to !== req.page) await mirrored(deps.mirror.rename(req.page, to));
          await mirrored(follow(deps.mirror, req.page, true));
          await mirrored(follow(deps.mirror, to, true));
          return ok(id, to);
        } catch (e) {
          console.error("page.move", e);
          const code = codeOf(e, "internal");
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "no such page"
              : said !== "" ? said
              : "that page could not be moved",
          );
        }

      case "doc.raw":
        return ok(id, await deps.docs.readRaw(req.page));

      case "variables.patch":
        // The addressed merge. `data.set` above refuses precisely because it
        // carries no page and this route has no mount to resolve one from; this
        // kind supplies both halves explicitly — the page, and WHICH SCOPE on it
        // — so the merge happens server-side against the file on disk rather
        // than as a lossy client-side read-modify-write two writers can
        // interleave.
        //
        // `section` null is the page's own variables; a name is that section's,
        // which is where a slot writes. The nearest one wins when a template is
        // resolved, so landing a slot write one scope out would quietly change
        // what every other section on the page says.
        try {
          const merged = await deps.docs.merge(req.page, req.section, req.patch);
          await mirrored(follow(deps.mirror, req.page));
          return ok(id, merged);
        } catch (e) {
          console.error("variables.patch", e);
          return err(id, codeOf(e, "flatness"), "a variable is a scalar or a list of scalars");
        }

      case "doc.writeRaw":
        // The ugly, always-available fallback, and it MATTERS MORE THAN IT DID:
        // the prose lives in this file now, so one bad character takes the
        // page's words with its shape and this is the only way back to them.
        try {
          const doc = await deps.docs.writeRaw(req.page, req.text);
          await mirrored(follow(deps.mirror, req.page));
          return ok(id, doc);
        } catch (e) {
          console.error("doc.writeRaw", e);
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            codeOf(e, "flatness"),
            // The parser's own sentence, which carries the line — that is the
            // difference between a fallback somebody can repair a file with and
            // one that says "something broke". It names no path: yaml.ts writes
            // these for a person and about the document alone.
            said !== "" ? said : "that is not a page document",
          );
        }

      case "table.create":
        deps.tables.create(req.schema);
        return ok(id, null);

      case "table.alter":
        deps.tables.alter(req.name, req.schema);
        return ok(id, null);

      case "table.setParent":
        deps.tables.setParent(req.name, req.parent);
        return ok(id, null);

      case "table.remove":
        deps.tables.drop(req.name);
        return ok(id, null);

      case "table.importCsv":
        return ok(id, deps.tables.importCsv(req.name, req.csv));

      case "theme.set":
        return ok(id, await deps.theme.set(req.theme));

      /* ── the design doc, which is workspace-level and never an artifact's ── */
      //
      // Checked rather than assumed: `HostRequest` does not carry these three
      // kinds, so the bridge — which accepts only a HostRequest — refuses them
      // with no allow-list anywhere. An artifact has no business rewriting the
      // workspace's own design language; it is the thing the agent reads BEFORE
      // it writes an artifact.
      //
      // Their own kinds rather than `page.*` with a reserved id, because the doc
      // lives at `design/` and a user is free to keep a page of their own called
      // `design` under `pages/`. One id space cannot hold both.

      case "design.read":
        return ok(id, await deps.design.read());

      case "design.patch":
        // Same two scopes the addressed `variables.patch` has, and the same
        // code: `section` null is the doc's own variables, a name is that
        // section's, and a value that could not be read back is refused rather
        // than written.
        try {
          return ok(id, await deps.design.patch(req.section, req.patch));
        } catch (e) {
          console.error("design.patch", e);
          return err(id, codeOf(e, "flatness"), "a variable is a scalar or a list of scalars");
        }

      case "design.writeFile":
        // The agent seam again, and the raw fallback: `doc.raw` addresses a
        // page under `pages/` and cannot reach `design/`, so writing
        // `content.yaml` through here is how a broken one gets repaired.
        await deps.design.writeFile(req.file, req.text);
        return ok(id, null);

      /* ── the vault, which is workspace-level and never an artifact's ──── */
      //
      // An artifact cannot say any of these, and the mechanism is the type
      // rather than a check here: `HostRequest` does not carry them, and the
      // bridge accepts only a HostRequest. An artifact has no business knowing
      // the workspace is a folder, let alone which one, let alone changing it.

      case "vault.info":
        return ok(id, await deps.vault.info());

      // `path` omitted means "wherever is sensible", and where that is belongs
      // to the root — it is the module that knows which vault is open.
      case "vault.browse":
        // Refused in the built application, where the picker's chooser is the
        // operating system's own dialog and nothing on screen asks for this.
        // Hiding the Browse group without refusing the kind would only move the
        // listing out of sight, and it is reachable by a typed request.
        if (deps.production && NATIVE_DIALOG) return refused(id, "listing folders");
        try {
          return ok(id, await deps.vault.browse(req.path));
        } catch (e) {
          console.error("vault.browse", e);
          return err(id, codeOf(e, "not_found"), "that folder cannot be listed");
        }

      // THE ONE REQUEST THAT REPLACES EVERYTHING. Every module below this line
      // is rebuilt against a different folder before the answer comes back, so
      // the client's whole snapshot is stale the moment it does — which is why
      // the store re-reads the shell rather than patching it.
      case "vault.open":
        try {
          return ok(id, await deps.vault.open(req.path));
        } catch (e) {
          console.error("vault.open", e);
          const code = codeOf(e, "internal");
          // The domain's own sentence, when it has one. It writes these FOR A
          // PERSON and never puts the path in them, which is what makes passing
          // one through safe — and the commonest refusal is now "that folder is
          // not empty", where a flattened "cannot be a workspace" reads as the
          // picker being broken rather than as the answer to what to do next.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "there is no folder there"
              : said !== "" ? said
              : "that folder cannot be a workspace",
          );
        }

      // A FOLDER THAT DOES NOT EXIST YET, which is what separates this from
      // `vault.open` beside it: open walks to something already there, and this
      // makes the thing. The parent and the name stay apart all the way down —
      // the domain joins them, after the name has satisfied the name rule, so a
      // name carrying a separator cannot become a folder somewhere else.
      case "vault.create":
        try {
          return ok(id, await deps.vault.create(req.parent, req.name));
        } catch (e) {
          console.error("vault.create", e);
          const code = codeOf(e, "internal");
          // The domain's own sentence, as `vault.open` above takes it and for
          // the same reason: `creatable` writes one per row of the collision
          // table, for a person, with no path in it, and a flattened "cannot be
          // a workspace" is what makes a picker read as broken.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "there is no folder there"
              : said !== "" ? said
              : "that folder cannot be a workspace",
          );
        }

      case "vault.recent":
        return ok(id, await deps.vault.recent());

    }
  } catch (e) {
    // A thrown error carrying one of the closed codes is a REFUSAL the domain
    // chose to make — `vault.info` with nothing mounted, a name that cannot be
    // a folder — and it goes back as its own sentence, without a stack trace on
    // the server's stderr, because nothing failed. Only an error carrying no
    // code (or `internal`) is the host not answering, and that one is logged.
    const code = codeOf(e, "internal");
    if (code !== "internal") return err(id, code, e instanceof Error ? e.message : String(e));
    console.error(String(env.kind), e);
    return err(id, code, "the host could not answer that");
  }

  // `open` IS IN THE TYPE AND HAS NO CASE HERE ON PURPOSE, and this note exists
  // because its absence has already been diagnosed once as the same seam bug
  // that `variables` really was. It is not. `open` asks the HOST to change what
  // the person is looking at, which is a client-side fact the server cannot know
  // and has no business acting on — `client/bridge/bridge.js` answers it locally
  // by calling `ui.go` and never forwards it, so it does not reach here from the
  // product at all. It is in `ApiRequest` only because that type is a superset of
  // `HostRequest`. If you are here because a test called `handle` with it
  // directly: the refusal below is correct, and implementing navigation on the
  // server would be the bug.
  //
  // Otherwise: unreachable through the type and reachable off the wire, which is
  // the whole reason the enumeration has this member.
  return err(id, "unknown_kind", "not a request this host answers");
}

/** Follow a page move with the tables that were parented under it.
 *
 *  A page's position is the folder it sits in, so moving the directory moves
 *  every page beneath it and renames every id in one act. A TABLE HAS NO
 *  DIRECTORY: it lives in SQLite and its parent is a row in the registry, which
 *  is the one piece of tree state the filesystem does not restate. Left alone it
 *  goes on naming an id that stopped existing, and the table vanishes out of the
 *  tree while still claiming a parent — invisible, and correct-looking.
 *
 *  Synchronous because `Tables` is: the registry is one SQLite file and the move
 *  above has already returned, so this cannot be the half that is awaited when
 *  something else reads.
 *
 *  It is a rename of a prefix and never a search: `a/b` moving to `c/b` takes
 *  `a/b` itself and everything under `a/b/`, and nothing else can match. */
function restack(deps: Deps, from: PageId, to: PageId): void {
  for (const table of deps.tables.list()) {
    const parent = table.parent;
    if (parent === null) continue;
    if (parent === from) {
      deps.tables.setParent(table.name, to);
      continue;
    }
    if (parent.startsWith(`${from}/`)) {
      deps.tables.setParent(table.name, to + parent.slice(from.length));
    }
  }
}

/** The one way out. The framework grants unrestricted access, so nothing is
 *  allow-listed and nothing is logged — but the call goes through the host, so
 *  an egress proxy later is a change here rather than a rewrite of every
 *  artifact that exists. */
async function proxy(id: string, url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<ApiResponse> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return err(id, "bad_request", "that is not a url");
  }
  // Not a permission check on data — a scheme check. `file:` would turn the one
  // way out into a way in, and reading the host's disk is not what "call any
  // public API" means.
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return err(id, "bad_request", "only http and https can be reached");
  }

  try {
    const res = await fetch(target, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const headers: Record<string, string> = {};
    // NO COOKIE CROSSES BACK TO A PAGE. A page has no cookie jar to put one in,
    // and the one this server sets on its own document is the terminal's
    // capability — a page asking this proxy for `http://localhost:<port>/` must
    // not be able to read it off the answer.
    res.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
    const value: HostFetchResult = { status: res.status, headers, body: await res.text() };
    return ok(id, value);
  } catch (e) {
    console.error("fetch", e);
    return err(id, "fetch_failed", "the site did not answer");
  }
}

/**
 * The HTTP half. Everything it knows about HTTP stops here: `handle` above has
 * never seen a Request, which is what makes fetch → postMessage → an in-process
 * call a replacement of this function alone.
 */
export async function route(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Use POST", { status: 405, headers: { allow: "POST" } });
  }

  // DELIBERATELY NO CORS HEADERS. This looks like an omission and it is the
  // opposite: the artifact frame is sandboxed without allow-same-origin, so it
  // has an opaque origin and cannot read a response from this route even though
  // the server is right there. That is the entire chokepoint — every path from
  // an artifact to workspace data is forced through postMessage and the bridge,
  // enforced by the browser for free. `Access-Control-Allow-Origin: *` or
  // `: null` would hand it back. Never add one.
  //
  // Two lines of belt to that brace, because a no-cors POST still executes on
  // the server even when its response is unreadable:
  const origin = request.headers.get("origin");
  if (origin === "null") {
    return new Response("Forbidden", { status: 403 });
  }
  // Requiring JSON forces a preflight this server never answers, so a simple
  // request cannot reach the switch above.
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return new Response("Expected application/json", { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ id: "", g: PROTOCOL, ok: false, error: fail("bad_request", "the body is not json") as HostError });
  }

  return json(await handle(body as ApiRequest, deps));
}

function json(value: ApiResponse): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
