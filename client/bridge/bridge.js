// SPDX-License-Identifier: AGPL-3.0-only
// The biom.* chokepoint. Layer 10.
//
// One request in, one HostResponse out. This module and guest/biom.js are
// the two halves of the only contract in the framework expected to outlive it,
// which is why this file is the one place here that is not throwaway.
//
// DOM-FREE, absolutely. It never sees an iframe, never touches an element and
// never knows the page is in a box at all. That is what makes it unit-testable
// without a browser and what makes the transport swap — postMessage today, a
// webview host or a socket later — invisible from in here.
//
// TWO ENTRY POINTS, AND THE PAIR IS THE DESIGN.
//
//   `resolve` answers a `HostRequest`: everything a SECTION may say.
//   `runtime` answers a `RuntimeRequest`: that, plus reading the page and
//   writing its shape back.
//
// The runtime draws the page and owns editing it, so it needs `page.read` and
// `section.order`. A section must never have either — a generated page that
// could reorder its own document could restructure the workspace it was asked
// to decorate. So the box is handed two ports at the handshake, the runtime
// takes the privileged one into a closure, and everything mounted afterwards
// gets the ordinary one that `biom.*` wraps.
//
// EACH ENTRY IS A TYPE NARROWING, NOT AN ALLOW-LIST BRANCH. `isHostRequest` and
// `isRuntimeRequest` narrow; there is no permission table to keep in sync with a
// second place and no branch that can be got wrong. A section cannot ask to
// reorder a page for the same reason it cannot ask in French.
//
// SAY WHAT THE SPLIT IS AND IS NOT. Inside the box it is a closure, not a
// browser guarantee: section code shares a realm with the runtime and could
// interfere with it. The browser-enforced wall is between THE BOX AND THE APP,
// and that is the one protecting the files, the server and every other page.
// Nothing in this repository may describe the in-box split as a security
// boundary.
//
// Beyond narrowing, it does four things and nothing else:
//
//   1. Scopes by context. One box is one page, so the context is one page id.
//      Reaching another page is `variables` or `doc.get`, which are calls and
//      never templates.
//   2. Caps in flight, per ring. A MessagePort has no backpressure, so the first
//      page with a loop would otherwise take the host down.
//   3. Routes. Writes go through the store so the grid the user is looking at
//      updates; reads the store does not cache go straight to the transport.
//   4. Flattens failure into the closed error enumeration.
//
// The framework grants UNRESTRICTED data access: table.get, row.insert, sql and
// fetch all resolve for real, against any table, with no scoping and no
// permission check. Scoping later is a change in this file and nowhere else —
// which is the entire reason Port and Binding ship empty rather than not at all.

/** @import { ApiRequest, BlockId, Bridge, BridgeContext, HostError, HostErrorCode, HostRequest, HostResponse, Page, PageDoc, PageId, PageRef, Part, RuntimeRequest, Transport, UiStore, Variables, WorkspaceStore } from "../../contracts/types.ts" */

import { isHostRequest, isRuntimeRequest } from "../../contracts/guards.js";
import { weaveRuntime } from "../platform/document.js";
import { DESIGN_PAGE, ERRORS, MAX_INFLIGHT, PROTOCOL, fail, foldId, nextId } from "../../contracts/wire.js";

/** `Bridge` plus the privileged half. The contract names the ordinary entry,
 *  because that is the one an artifact's half of the world is written against;
 *  the runtime entry is a second door in the same wall and only the frame host,
 *  which decides which door a message came through, ever needs to name it.
 *  @typedef {Bridge & {
 *    runtime(req: RuntimeRequest, ctx: BridgeContext): Promise<HostResponse>
 *  }} PageBridge */

/** @param {string} id @param {unknown} value @returns {HostResponse} */
const yes = (id, value) => ({ id, g: PROTOCOL, ok: true, value });

/** `fail` types its code as a string, so the one cast in this file lives here.
 *  @param {string} id @param {HostErrorCode} code @param {string} message
 *  @returns {HostResponse} */
const no = (id, code, message) => ({
  id,
  g: PROTOCOL,
  ok: false,
  error: /** @type {HostError} */ (fail(code, message)),
});

/** The closed enumeration, as a set, so a code thrown by a lower layer can be
 *  believed only when it is one of ours. Anything else becomes `internal`.
 *  @type {Set<string>} */
const CODES = new Set(Object.values(ERRORS));

/** `message` is a leak channel: it never carries a path, a query or a caught
 *  error's own text. The detail goes to the console, where the person running
 *  the framework can see it and the page cannot.
 *  @type {Record<string, string>} */
const SAYS = {
  [ERRORS.NOT_FOUND]: "no such thing",
  [ERRORS.FLATNESS]: "a variable is a scalar or a list of scalars",
  [ERRORS.SQL_ERROR]: "the query did not run",
  [ERRORS.FETCH_FAILED]: "the request did not complete",
  [ERRORS.INTERNAL]: "the host could not answer",
};

/**
 * A store or transport call rejected. Recover its code when it carries one of
 * ours — the store throws rather than returning a HostResponse, so this is the
 * one seam where a real server code can be lost, and it is lost to `internal`
 * rather than to a stack trace reaching the page.
 * @param {unknown} err
 * @returns {HostErrorCode}
 */
function codeOf(err) {
  const c = err && typeof err === "object" ? /** @type {{code?: unknown}} */ (err).code : null;
  return typeof c === "string" && CODES.has(c)
    ? /** @type {HostErrorCode} */ (c)
    : ERRORS.INTERNAL;
}

/* ── the scope a page sees ─────────────────────────────────────────────────
 * VARIABLES NEST THREE DEEP NOW, AND THE NEAREST ONE WINS: a `{{rate}}` written
 * inside a part resolves against that part's own `variables` first, its
 * section's second, and the page's third. It was two deep when a page held a
 * flat list of contents; a section sits between them now, and it is a real
 * level — three columns of prose in one section share the section's values and
 * each column may still override one.
 *
 * WHERE EACH LEVEL IS RESOLVED IS NOT ALL IN HERE, and it must not be:
 *
 *   · The part level is resolved by the SERVER. `page.read` hands back a
 *     `Part` with `vars` already merged, because the runtime that draws the
 *     part lives in an opaque-origin box and cannot fetch anything to finish
 *     the job. `{{name}}` is then substituted where the part is DRAWN, with the
 *     braces still in it over the wire — prose is editable in place and writes
 *     back, so resolving earlier would round-trip `62` over the top of
 *     `{{rate}}` the first time somebody touched the paragraph.
 *   · The section level is the deepest thing the WIRE can address:
 *     `variables.patch` names a page and a section, and `scopeOfSection` below
 *     is the read-back for exactly that.
 *   · The page level is what an unaddressed `data.get` means. ONE BOX IS ONE
 *     PAGE — there is no block in the context any more — so a section asking
 *     for "my variables" over the guest port can only be asking for the page's,
 *     and a section that wants its own reads them off the page the runtime
 *     already holds rather than making the host guess at a mount.             */

/** @param {PageDoc} doc @param {BlockId | null} section @returns {Variables} */
function scopeOfSection(doc, section) {
  if (section === null) return doc.variables;
  const held = doc.contents.find((s) => s.name === section);
  return { ...doc.variables, ...((held && held.variables) || {}) };
}

/** The prose of a page, in order, RAW — `{{rate}}` and all.
 *
 *  Every markdown part of every section, which is what "what this page says"
 *  means once a section can hold three columns of it. A table, an html part or
 *  a child is not prose and does not project into this: a page reading another
 *  page is reading what it says, not reconstructing its structure.
 *
 *  Section order is the array; slot order within a section is the insertion
 *  order of `parts`, which is the order the document declares them in. Neither
 *  is a second statement of anything, so neither can disagree with the file.
 *
 *  It is deliberately not interpolated. Resolving here would mean resolving
 *  against ANOTHER page's variables, which is the join `biom.variables`
 *  exists to make explicit — and a page that wants the words with the numbers
 *  in them can make both calls and say so. @param {Page} page */
const proseOf = (page) =>
  page.sections
    .flatMap((s) =>
      Object.values(s.parts).flatMap((/** @type {Part} */ p) => (p.kind === "markdown" ? [p.md] : [])),
    )
    .join("\n\n");

/**
 * @param {WorkspaceStore} ws
 * @param {Transport} transport
 * @param {UiStore} ui WHERE THE PERSON IS LOOKING. The one thing this module
 *   touches that is not data — `open` asks the host to go somewhere, and going
 *   somewhere is a UI fact. Passed in rather than imported so the bridge still
 *   constructs nothing and can still be stood up in a test with a stub.
 * @param {string} [vault] WHICH FOLDER THIS TAB IS, absolute. A nested page's
 *   document names the vault's own plugins, exactly as the page view's does, so
 *   the one answer here that is a document rather than data needs it. Defaulted
 *   so a test that only asks for data need not name a folder.
 * @returns {PageBridge}
 */
export function makeBridge(ws, transport, ui, vault = "") {
  /** In flight, per ring per page. The cap is here rather than in the frame
   *  because the frame is one transport of several and this is the resolver all
   *  of them terminate at.
   *
   *  THE TWO RINGS ARE COUNTED SEPARATELY, and that is not tidiness. They share
   *  a box: a section stuck in a loop on the guest port would otherwise spend
   *  the whole budget and the RUNTIME would stop being able to draw, which turns
   *  one bad plugin into a blank page. Its own budget is what keeps the runtime
   *  answering while a section is starving itself. @type {Map<string, number>} */
  const busy = new Map();

  /** Forward one ApiRequest and hand its answer straight back, re-labelled with
   *  the caller's own correlation id. Pass-through reads keep the server's real
   *  error code — `sql_error`, `not_found` — instead of flattening it.
   *  @param {string} id @param {Record<string, unknown>} sub
   *  @returns {Promise<HostResponse>} */
  async function forward(id, sub) {
    const req = /** @type {ApiRequest} */ (/** @type {unknown} */ ({ ...sub, id: nextId(), g: PROTOCOL }));
    const out = await transport.call(req);
    return { ...out, id };
  }

  /** @param {HostRequest} req @param {BridgeContext} ctx */
  async function route(req, ctx) {
    switch (req.kind) {
      /* ── this page's variables. There is no narrower scope to name. ─────── */
      case "data.get": {
        const open = ws.get().page;
        const page = open && open.id === ctx.page ? open : await readPage(ctx.page);
        return yes(req.id, page.variables);
      }
      case "data.set": {
        // IT LANDS ON THE PAGE, because the box is the page and nothing on this
        // port can address a section. The runtime, which knows exactly which
        // section a plugin is mounted in, has `variables.patch` for the
        // addressed write — a mount is a client-side fact and the server must
        // never guess at it, which is why the addressed form exists at all.
        const doc = await ws.patchVariables(ctx.page, null, req.patch);
        return yes(req.id, doc.variables);
      }

      /* ── other pages ───────────────────────────────────────────────────── */
      case "doc.get":
        return yes(req.id, proseOf(await readPage(req.page)));
      case "doc.list":
        return yes(req.id, ws.get().pages);
      // ANOTHER PAGE'S VARIABLES, and reaching one is a CALL rather than a
      // template on purpose: `{{name}}` stays inside a page so prose can be read
      // without chasing it, and a page that depends on a page somebody else may
      // rename fails visibly here instead of leaving a blank in a paragraph.
      // Omit `page` for the page this box is mounted on.
      case "variables":
        return forward(req.id, { kind: "variables", page: req.page ?? ctx.page });

      /* ── tables. Reads pass through so a page reading a table does not move
       *    the grid the user has open; writes go through the store, which is
       *    what makes a page's insert appear in that grid at once.          ── */
      case "table.get":
        return forward(req.id, { kind: "table.get", name: req.name, query: req.query });
      case "table.schema":
        return forward(req.id, { kind: "table.schema", name: req.name });
      case "table.list":
        return yes(req.id, ws.get().tables);
      case "row.insert":
        return yes(req.id, await ws.insertRow(req.name, req.row));
      case "row.update":
        await ws.updateRow(req.name, req.row, req.patch);
        return yes(req.id, null);
      case "row.remove":
        await ws.removeRow(req.name, req.row);
        return yes(req.id, null);

      /* ── the two pass-throughs. `sql` may mutate and the host cannot tell
       *    without parsing it, so the grid is not refreshed after one — the
       *    reload button is the honest answer and the skill says to prefer
       *    row.insert. `fetch` is proxied because the box's origin is opaque
       *    and connect-src is none: this is the only way out.              ── */
      case "sql":
        return forward(req.id, { kind: "sql", query: req.query, params: req.params });
      case "fetch":
        return forward(req.id, { kind: "fetch", url: req.url, init: req.init });

      // Layer one. The caller omits `page`, meaning the page the box is mounted
      // on — a mount is a client-side fact and this is the only place that knows
      // it, which is why the server refuses the unaddressed form.
      case "children":
        return forward(req.id, { kind: "children", page: req.page ?? ctx.page });

      /* ── the palette as data. Custom properties do not cross a document
       *    boundary, so the box is handed the theme and re-declares it.    ── */
      case "theme.get":
        return yes(req.id, ws.get().theme);

      // WHICH FOLDER THIS IS. Answered by the store, which is to say by exactly
      // the call the workspace UI's own screens make — one answer about one
      // folder, so a page and the Modify panel beside it can never disagree
      // about where the workspace is.
      //
      // IT CANNOT NAME ANOTHER FOLDER, AND NOT BECAUSE ANYTHING HERE CHECKS. A
      // store is one vault for as long as it exists — the vault is settled in
      // `boot.js` out of the tab's url before a single module is constructed —
      // and the kind carries no path with which to ask about a different one.
      // The other four `vault.*` kinds, which do name a folder, are outer-ring
      // and are refused by the guard one line before this switch is reached.
      case "vault.info":
        return yes(req.id, await ws.vaultInfo());

      // WHAT A `[[wikilink]]` NAMES. Answered here rather than by the server
      // because the client already holds the whole tree — the rail is drawn from
      // it — so this is a lookup and not a round trip.
      case "link.resolve":
        return yes(req.id, resolveLink(req.target, ws.get()));

      // The host decides. An id nothing holds is refused rather than navigated
      // to, because a blank screen is a worse answer than a no.
      //
      // THE DESIGN DOC IS THE ONE PAGE THE TREE CANNOT ANSWER FOR, and it is
      // named here rather than made findable. It lives at `design/`, outside
      // `pages/`, so it is in no snapshot — which meant a page could not link
      // to it at all, and the seeded root has to: everything an agent generates
      // in a workspace comes out of the design doc, so *go there first* is the
      // first thing that page says. `@` is outside a page segment's grammar, so
      // this arm can never shadow a page somebody made. Its own view rather
      // than the page view, because `makeDesignView` is a separate mount.
      case "open": {
        const t = req.target;
        if (t.kind === "page" && t.id === DESIGN_PAGE) {
          ui.go("design", "");
          return yes(req.id, null);
        }
        const w = ws.get();
        const there = t.kind === "table"
          ? w.tables.some((x) => x.name === t.id)
          : w.pages.some((x) => x.id === t.id);
        if (!there) return no(req.id, ERRORS.NOT_FOUND, "no such page or table");
        ui.go(t.kind === "table" ? "table" : "page", t.id);
        return yes(req.id, null);
      }

      // ANOTHER PAGE, DRAWN. The one answer that is a document rather than data,
      // and it is the same document the page view would build for that page —
      // `readPage` resolves the plugin, `weaveRuntime` splices the runtime in.
      // The ports are not minted here: this module never sees a frame, so the
      // frame host reads this answer, mints a session for the page it names and
      // adds the two ports to the transfer list on the way out.
      case "page.embed": {
        const page = await readPage(req.page);
        const input = { id: page.id, name: page.name, plugin: page.plugin, input: page.input };
        return yes(req.id, { page: page.id, html: weaveRuntime(page.html, input, vault) });
      }

      /* ── automations and runs. Pass-throughs, but for one field. ─────── */

      // THE STAMP. A run's row says which page started it, and that fact is
      // written HERE, over whatever the box sent: the bridge holds the page a
      // box was mounted on as `ctx.page`, and the page's `uid` is in the tree
      // the store already holds. So *started by* is a fact the browser
      // enforces and never a claim a page made — and it is provenance, not a
      // filter: nothing anywhere reads it to refuse.
      case "run.start":
        return forward(req.id, {
          kind: "run.start",
          page: req.page,
          automation: req.automation,
          inputs: req.inputs ?? {},
          by: uidOf(ctx.page),
        });
      case "automation.list":
        return forward(req.id, { kind: "automation.list", page: req.page });
      case "run.list":
        return forward(req.id, { kind: "run.list", page: req.page, automation: req.automation });
      case "run.get":
        return forward(req.id, { kind: "run.get", run: req.run });
      case "run.read":
        return forward(req.id, { kind: "run.read", run: req.run, stream: req.stream, from: req.from, max: req.max });
      case "run.kill":
        return forward(req.id, { kind: "run.kill", run: req.run });
    }
  }

  /** The identity of the page a box is mounted on, read off the tree the store
   *  holds, or null where the page has none — a page whose document would not
   *  parse, or one made before this server first opened the folder.
   *  @param {PageId} id @returns {string | null} */
  function uidOf(id) {
    const ref = ws.get().pages.find((p) => p.id === id);
    return ref && typeof ref.uid === "string" ? ref.uid : null;
  }

  /** WHAT A WIKILINK TARGET NAMES, or null.
   *
   *  Four attempts, narrowest first, and each one is only an answer when it is
   *  UNAMBIGUOUS — two pages matching is no match, because opening one of them
   *  at random is worse than a link that visibly did not resolve.
   *
   *    1. the id, exactly
   *    2. the id, folded — `foldId` is the one place case is ignored, and this
   *       is its second caller. A page id keeps its case, so `companies/airtable`
   *       typed by hand still finds `home/Companies/Airtable`.
   *    3. the id's TAIL. A vault's own links are written from the vault root
   *       (`Companies/Airtable`) and a page's id has the workspace's root page
   *       on the front of it, so the leading segments are exactly what a person
   *       does not write.
   *    4. the page's NAME. `[[Airtable]]` is how somebody writes a link while
   *       reading, and the name is what they see on the page.
   *
   *  Then the same for a table, which is named rather than pathed.
   *  @param {string} target @param {{pages: PageRef[], tables: {name: string}[]}} w
   *  @returns {{kind: "page" | "table", id: string} | null} */
  function resolveLink(target, w) {
    const want = String(target).trim().replace(/^\/+|\/+$/g, "");
    if (want === "") return null;
    const page = (/** @type {string} */ id) => ({ kind: /** @type {const} */ ("page"), id: id });

    // THE DESIGN DOC, WHICH NO SEARCH BELOW COULD EVER FIND: it is not in
    // `pages/` and so not in the snapshot the four attempts walk. Exact and
    // never folded — the id is a reserved spelling rather than something
    // somebody typed while reading, and `open` above takes it from here with no
    // translation.
    if (want === DESIGN_PAGE) return page(DESIGN_PAGE);

    const exact = w.pages.find((p) => p.id === want);
    if (exact) return page(exact.id);

    const folded = foldId(want);
    /** The one page a test matches, or null where none or several do. */
    const only = (/** @type {(p: PageRef) => boolean} */ test) => {
      const hits = w.pages.filter(test);
      const one = hits.length === 1 ? hits[0] : undefined;
      return one ? page(one.id) : null;
    };

    /** The one table a test matches, or null where none or several do. */
    const table = (/** @type {(t: {name: string}) => boolean} */ test) => {
      const hits = w.tables.filter(test);
      const one = hits.length === 1 ? hits[0] : undefined;
      return one ? { kind: /** @type {const} */ ("table"), id: one.name } : null;
    };

    return only((p) => foldId(p.id) === folded)
      || only((p) => foldId(p.id).endsWith("/" + folded))
      || only((p) => foldId(p.name) === folded)
      || table((t) => t.name === want)
      || table((t) => foldId(t.name) === folded);
  }

  /** The five kinds only the section runtime may say, and then everything a
   *  section may say — because the middle ring is a superset and a runtime that
   *  could not also read a table would need a second channel to do it on.
   *  @param {RuntimeRequest} req @param {BridgeContext} ctx */
  async function routeRuntime(req, ctx) {
    switch (req.kind) {
      // THE PAGE, RESOLVED — sections, slots, files loaded and children looked
      // up. It is a straight pass-through rather than a read of the store's
      // copy, and deliberately: `section.write` fires on a debounce while
      // somebody is typing and does NOT go through the store, so the store's
      // copy is behind the file by design. A re-read has to come off disk or it
      // would hand back the version the typist has already moved past.
      case "page.read":
        return forward(req.id, { kind: "page.read", page: req.page });

      // ONE SLOT'S TEXT, and it does not go through the store ON PURPOSE. It
      // fires on a debounce while somebody is typing, and a store write emits a
      // Change, which reaches this very box as a `refresh`, which re-fills the
      // slot the cursor is sitting in. The prose path has to be the one write
      // that does not tell everybody about itself.
      case "section.write":
        return forward(req.id, {
          kind: "section.write",
          page: req.page,
          section: req.section,
          part: req.part,
          data: req.data,
        });

      // THE ORDER, AND WHAT IS IN IT — added, reordered, duplicated and removed
      // in one edit, because `contents` IS the order.
      //
      // THROUGH THE STORE, exactly as `section.remove` below is, and for the
      // reason `ws.setSections` states in its own body: this moves the SHAPE of
      // a page. The rail draws that order, the Config screen counts it, and the
      // box that sent the request is drawing it — so a request that went past
      // the store would move the page on disk while every one of them went on
      // showing what it was. It DID go past, and the symptom was precise: a
      // section added with `+` reached the file and never appeared, because
      // nothing announced the change and so nothing redrew. Dragging looked fine
      // only because the runtime moves the elements itself.
      //
      // `section.write` above is deliberately the other way and says why.
      case "section.order":
        return yes(req.id, await ws.setSections(req.page, req.sections));

      // Through the store, so the rail and the grid learn that the page's shape
      // moved. The answer is null rather than the sections that remain: the
      // store reports the change instead of the leftovers, and a runtime that
      // just deleted a section re-reads the page it is about to redraw anyway.
      case "section.remove":
        await ws.removeSection(req.page, req.section);
        return yes(req.id, null);

      // THE PAGE'S OWN MARKDOWN, on its way to `_markdown/`. Forwarded rather
      // than routed through the store, for a sharper version of the reason
      // `section.write` above is: a store write emits a Change, the frame turns
      // that into a `refresh`, the runtime redraws, and a redraw sends another
      // projection. That is not a slow path, it is a loop with no exit.
      case "page.projection":
        return forward(req.id, {
          kind: "page.projection",
          page: req.page,
          markdown: req.markdown,
        });

      // The addressed form of `data.set`: the runtime knows which section a
      // plugin is mounted in and the host does not, so the runtime says it.
      // `section` null patches the page's own values.
      case "variables.patch": {
        const doc = await ws.patchVariables(req.page, req.section, req.patch);
        return yes(req.id, scopeOfSection(doc, req.section));
      }

      // Everything a section may say, answered by the same code that answers it
      // on the other port. One implementation, two doors.
      default:
        return route(req, ctx);
    }
  }

  /** @param {PageId} id @returns {Promise<Page>} */
  async function readPage(id) {
    const res = await transport.call({ id: nextId(), g: PROTOCOL, kind: "page.read", page: id });
    if (!res.ok) throw res.error;
    if (!res.value) throw { code: ERRORS.NOT_FOUND };
    return /** @type {Page} */ (res.value);
  }

  /** The budget, the flattening and the console line — identical for both rings,
   *  because they are the same host answering out of the same process. Only the
   *  narrowing above differs, which is the whole point of there being two doors
   *  rather than two bridges.
   *  @template {HostRequest | RuntimeRequest} T
   *  @param {"runtime" | "guest"} ring
   *  @param {T} req
   *  @param {BridgeContext} ctx
   *  @param {(req: T, ctx: BridgeContext) => Promise<HostResponse>} run
   *  @returns {Promise<HostResponse>} */
  async function guarded(ring, req, ctx, run) {
    // The escape, never a literal: a NUL in source is invisible and makes grep
    // treat the whole file as binary, so every search of it comes back empty.
    const mount = ring + "\u0000" + ctx.page;
    const n = busy.get(mount) ?? 0;
    if (n >= MAX_INFLIGHT) return no(req.id, ERRORS.LIMIT, "too many calls in flight");
    busy.set(mount, n + 1);

    try {
      return await run(req, ctx);
    } catch (err) {
      const code = codeOf(err);
      console.warn("[biom] " + req.kind + " failed", err);
      return no(req.id, code, SAYS[code] ?? "the host could not answer");
    } finally {
      const left = (busy.get(mount) ?? 1) - 1;
      if (left > 0) busy.set(mount, left);
      else busy.delete(mount);
    }
  }

  /** Recover just enough of a refused envelope to correlate the refusal to the
   *  call. Both guards narrow their argument to `never` on the failing branch,
   *  which is exactly what is wanted and leaves nothing to read off it.
   *  @param {unknown} req @returns {string} */
  const idOf = (req) => {
    const loose = /** @type {{id?: unknown}} */ (req);
    return loose && typeof loose.id === "string" ? loose.id : "";
  };

  return {
    async resolve(req, ctx) {
      // The refusal, and it is a type narrowing rather than a permission check:
      // there is no allow-list to keep in sync and no branch that can be got
      // wrong. A section cannot ask to reorder a page for the same reason it
      // cannot ask in French.
      if (!isHostRequest(req))
        return no(idOf(req), ERRORS.UNKNOWN_KIND, "not something a section may ask for");
      return guarded("guest", req, ctx, route);
    },

    async runtime(req, ctx) {
      // The same mechanism one ring out. `isRuntimeRequest` is strictly wider
      // than `isHostRequest` and strictly narrower than the server's own
      // surface, so a page created or a table dropped stays unsayable here too.
      if (!isRuntimeRequest(req))
        return no(idOf(req), ERRORS.UNKNOWN_KIND, "not something the runtime may ask for");
      return guarded("runtime", req, ctx, routeRuntime);
    },
  };
}
