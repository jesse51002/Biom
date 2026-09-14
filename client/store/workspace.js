// SPDX-License-Identifier: AGPL-3.0-only
// The client's single copy of the workspace. Every read of workspace data and
// every write to it passes through here.
//
// That is the whole reason it holds actions instead of being a bag of state:
// when an artifact writes a row through the bridge, the bridge calls the same
// `updateRow` the grid calls, so the grid the user is looking at changes without
// a reload. The mock could not do this — it had 49 `set()` call sites, 25 of
// them a bare `set({})` used as a repaint signal, so the store never knew what
// had changed and could not address a write, invalidate a region, or roll one
// back. Every action below names exactly what it changed.
//
// It emits once per action. Not once per request, not once per intermediate
// state — a caller that awaits an action and reads `get()` sees one consistent
// snapshot and the views repainted once. `reloadPage` is the single deliberate
// exception and says why at the call site.
//
// It also holds LAYER ONE — what each page holds, pages and tables alike, read
// for every page at once and kept beside the snapshot. That is a separate read
// from `loadPage` on purpose: the rail needs several pages' children while the
// user is looking at a different page, and `loadPage` owns the open-page slot.
// `moveChild` is the only write against it, and it MOVES A DIRECTORY now: there
// is no `parent:` to patch, so a page moves with `page.move` and comes back
// wearing a NEW ID, which the caller re-routes onto.
//
// It cannot see the DOM or a view. Views subscribe through `on()` and
// a composition root registers the callback; the store has no idea a view
// exists. That is the only upward mechanism in the framework and it is what keeps
// the import graph acyclic.

/** @import { ApiRequest, BlockId, Change, Child, DirListing, DrawnSection, Envelope, Page, PageDoc,
 *            PageId, PageRef, Part, Row, RowId, RowQuery, Section, TableName,
 *            TableRef, TableView, Theme, Transport, Variables, VarPatch, VaultInfo, WorkspaceStore }
 *            from "../../contracts/types.ts" */

import { emitter } from "../../contracts/emitter.js";
import { ERRORS, PROTOCOL, nextId } from "../../contracts/wire.js";

/* ── the four runtime values the client cannot import ────────────────────── */

// `childKey`, `ROOT_PAGE`, `parentOf` and `segmentOf` are runtime values in
// contracts/types.ts, and the server imports them from there. The client cannot:
// there is no build step, so a browser cannot load a .ts file. They are declared
// here — one layer below every view, which is the lowest client layer that needs
// them — so the client has exactly ONE copy rather than one per view, and
// store.test.js asserts the definitions agree. Same duplication
// guest/biom.js makes of wire.js, for the same reason and with the same
// obligation to keep them in step.

/** The page whose children are the top level. The rail is this page's children,
 *  and every level below it is some page's own `children/` directory. */
export const ROOT_PAGE = "home";

/** THE FOLDER IS THE HIERARCHY, so a page's parent is everything before its last
 *  segment — derived, never stored, and so never able to disagree with where the
 *  page actually is. `null` for a top-level page.
 *  @param {PageId} id @returns {PageId | null} */
export const parentOf = (id) => {
  const cut = id.lastIndexOf("/");
  return cut < 0 ? null : id.slice(0, cut);
};

/** The segment a page is called by inside its parent's `children/`.
 *  @param {PageId} id @returns {string} */
export const segmentOf = (id) => id.slice(id.lastIndexOf("/") + 1);

/** The block id standing for a child. Derived rather than generated, because
 *  the guarantee is that a block already placed stays where the user put it —
 *  which is only possible if the same child yields the same key every read.
 *
 *  ONE SEGMENT, never a path: a page's contents only ever name its DIRECT
 *  children, which is what keeps `@page-notes` a legal filename and lets two
 *  parents each hold a "notes".
 *  @param {Child} c @returns {BlockId} */
export const childKey = (c) =>
  `@${c.kind}-${c.kind === "page" ? segmentOf(c.id) : c.id}`;

/**
 * An id that was under `from` said again under `to`. Pure, and the whole of what
 * a client holding an id has to do when a page moves.
 *
 * MOVING A PAGE RENAMES EVERY PAGE INSIDE IT, because the id is the path. The
 * server answers with the new id of the page that moved and says nothing about
 * the subtree — it does not have to, since every descendant's id is the old one
 * with a new prefix. An id that was not under `from` is handed back untouched,
 * so this is safe to call on whatever the client happens to be looking at.
 *
 * @param {PageId} id @param {PageId} from @param {PageId} to @returns {PageId}
 */
export function rebase(id, from, to) {
  if (id === from) return to;
  return id.startsWith(from + "/") ? to + id.slice(from.length) : id;
}

/** The null theme. Every field is empty rather than invented, because nothing
 *  outside the theme data may name a colour and that includes a default.
 *  `loadTree()` replaces it before boot mounts the shell.
 *  @type {Theme} */
const NO_THEME = {
  palette: { name: "", colors: {}, extra: [] },
  fonts: { roles: { sheet: "", furniture: "", gauge: "" }, available: [] },
};

/**
 * ONE SCOPE, RESOLVED, as a slot sees it: the page's variables with the
 * section's own written over the top. THE NEAREST ONE WINS, which is the whole
 * of the rule — a bare `{{rate}}` is always the closest one and never a
 * surprise.
 *
 * It is derived here as well as on the server, and that is deliberate rather
 * than sloppy: a variables patch answers with the whole `PageDoc`, and re-reading
 * the page to learn what six words in a paragraph now say would replace the page
 * object — and the frame keyed off it — on every keystroke. The rule is two
 * lines and it is stated in `Section.variables`, so both copies are reading the
 * same sentence.
 *
 * @param {Variables} pageVars @param {Variables | undefined} own
 * @returns {Variables}
 */
export const scopeOf = (pageVars, own) => ({ ...pageVars, ...(own ?? {}) });

/**
 * The store, plus the two things the tree needs and `WorkspaceStore` — frozen —
 * does not carry.
 *
 * They are an intersection declared here rather than a widening of the contract:
 * `children` is a read of layer one (what a page holds) that must NOT go through
 * `loadPage`, because the rail needs several pages' children at once while the
 * user is looking at a different page and `loadPage` owns the open-page slot.
 * `moveChild` is the write that answers it.
 *
 * `moveChild` ANSWERS THE NEW ID, and has to. Moving a page moves its directory,
 * so its id becomes `<parent>/<segment>` and every id beneath it changes with
 * it. Nothing forwards: whoever is holding the old one is holding an id that has
 * just stopped existing, and the only correct thing to do with it is re-route.
 * `null` when nothing moved.
 *
 * `writeSlot` and `setSections` are the same kind of addition and for the same
 * reason: `section.write` and `section.order` are on the wire and
 * `WorkspaceStore` — frozen — does not carry them. They are the whole of how a
 * page's own words and its own shape get back to disk, so they are declared here
 * rather than reached for through the transport by a view. Both are named for
 * the `Pages` methods they stand in front of, so one vocabulary reaches from the
 * wire to the screen.
 *
 * @typedef {WorkspaceStore & {
 *   children(id: PageId): Child[],
 *   moveChild(child: Child, from: PageId, to: PageId): Promise<PageId | null>,
 *   writeSlot(id: PageId, section: BlockId, part: string, data: string): Promise<void>,
 *   setSections(id: PageId, sections: Section[]): Promise<Section[]>,
 * }} Workspace
 */

/**
 * @param {Transport} transport
 * @returns {Workspace}
 */
export function makeWorkspace(transport) {
  const bus = emitter();

  /** @type {PageRef[]} */ let pages = [];
  /** @type {TableRef[]} */ let tables = [];
  /** @type {Theme} */ let theme = NO_THEME;
  /** @type {Page | null} */ let page = null;
  /** @type {TableView | null} */ let table = null;

  /** Layer one, for every page at once: what each one holds, pages and tables
   *  alike. It is a map beside the snapshot rather than a field in it because
   *  `WorkspaceSnapshot` is frozen — and because a view asking for one page's
   *  children must not have to hold the whole thing to do it.
   *  @type {Map<PageId, Child[]>} */
  let kids = new Map();

  /** The query the open view was read with, kept so a write can re-read the
   *  same view. A row's place in a filtered, sorted view is the server's
   *  answer, not something the client can work out from the row it just sent.
   *  @type {{ name: TableName, query: RowQuery | undefined } | null} */
  let open = null;

  const emit = () => bus.emit(undefined);

  /** What moved, for consumers that cannot act on a bare repaint — the frame
   *  host has to know WHICH page and WHICH tables in order to tell the right
   *  artifacts. Always fired after `emit`, so the host UI is consistent by the
   *  time an artifact is told to re-read. */
  const changes = emitter();
  /** @param {Change} c */
  const changed = (c) => changes.emit(c);

  /** The envelope every request carries. Annotated, because an object literal
   *  widens `g` to number and the protocol major is the literal 1.
   *  @returns {Envelope} */
  const env = () => ({ id: nextId(), g: PROTOCOL });

  /**
   * One request. Resolves its value, or throws an Error carrying the wire's own
   * code — every action below returns the thing that was asked for or nothing at
   * all, so a failure cannot be mistaken for an empty answer.
   * @param {ApiRequest} req
   * @returns {Promise<unknown>}
   */
  async function ask(req) {
    const res = await transport.call(req);
    if (res.ok) return res.value;
    throw Object.assign(new Error(res.error.message), { code: res.error.code });
  }

  /**
   * The same, for the two reads whose contract says `| null`. A page that is
   * not there is an answer; anything else is still a failure.
   * @param {ApiRequest} req
   * @returns {Promise<unknown>}
   */
  async function askOrNull(req) {
    const res = await transport.call(req);
    if (res.ok) return res.value;
    if (res.error.code === ERRORS.NOT_FOUND) return null;
    throw Object.assign(new Error(res.error.message), { code: res.error.code });
  }

  /** Everything the chrome draws before a page is open, in one round of
   *  requests, so any change to the shape of the workspace is one repaint. */
  async function readShell() {
    const [p, t, th] = await Promise.all([
      ask({ ...env(), kind: "page.list" }),
      ask({ ...env(), kind: "table.list" }),
      ask({ ...env(), kind: "theme.get" }),
    ]);
    pages = /** @type {PageRef[]} */ (p);
    tables = /** @type {TableRef[]} */ (t);
    theme = /** @type {Theme} */ (th);
    await readChildren();
  }

  /** A page read WITHOUT taking the open-page slot. Everything that wants a page
   *  other than the one on screen — an order to patch, a parent to check — comes
   *  through here; only `loadPage` and `reloadPage` assign to `page`.
   *  @param {PageId} id */
  async function readPage(id) {
    return /** @type {Page | null} */ (await askOrNull({ ...env(), kind: "page.read", page: id }));
  }

  /** Layer one for the whole workspace, in one round.
   *
   *  Eager and complete rather than fetched as the rail expands, and that is the
   *  cheap answer to a real hazard: a view that fetched what it was missing
   *  while drawing would fetch again on the repaint its own answer caused. The
   *  cost is one request per page on a workspace of a few dozen pages, which is
   *  a throwaway instrument's kind of cost.
   *
   *  ROOT_PAGE is asked for whether or not it is in `pages`, because the rail is
   *  its children and a workspace whose root has not been seeded yet should draw
   *  an empty rail rather than fail. */
  async function readChildren() {
    const ids = [...new Set([ROOT_PAGE, ...pages.map((p) => p.id)])];
    const got = await Promise.all(ids.map((id) =>
      askOrNull({ ...env(), kind: "children", page: id })));
    kids = new Map(ids.map((id, i) => [id, /** @type {Child[]} */ (got[i]) ?? []]));
  }

  /** The tree, after a create, a remove or a move. Re-listed rather than patched
   *  locally: the server owns ids and ordering, and it owns which page holds
   *  what — the client must never decide that twice. */
  async function readPages() {
    pages = /** @type {PageRef[]} */ (await ask({ ...env(), kind: "page.list" }));
    await readChildren();
  }

  async function readTables() {
    tables = /** @type {TableRef[]} */ (await ask({ ...env(), kind: "table.list" }));
  }

  /** The open page with a document's values written over it, WITHOUT a re-read.
   *
   *  A variables patch answers with the whole `PageDoc`, and that is everything
   *  needed to say what the page now shows: the page's own values, and each
   *  section's. What it cannot say is anything about SHAPE — which sections
   *  exist, which HTML each drew with, which child each stands for — so nothing
   *  here touches that, and a section the document no longer carries keeps its
   *  old scope until something re-reads.
   *
   *  THE SCOPE IS WRITTEN IN TWO PLACES because it is read in two: a section
   *  carries it, and so does every markdown or html part inside it, since a part
   *  is drawn from its own `vars` and never reaches up for the section's.
   *
   *  Re-reading instead would replace the page object on every slot flush, and
   *  the frame keyed off it with it, which restarts the runtime that did the
   *  writing. That is the bug this function exists to avoid.
   *  @param {Page} open @param {PageDoc} doc @returns {Page} */
  function withDoc(open, doc) {
    const byName = new Map(doc.contents.map((c) => [c.name, c]));
    /** @type {DrawnSection[]} */
    const sections = open.sections.map((s) => {
      const held = byName.get(s.name);
      if (held === undefined) return s;
      const vars = scopeOf(doc.variables, held.variables);
      /** @type {Record<string, Part>} */
      const parts = {};
      for (const [slot, part] of Object.entries(s.parts)) {
        parts[slot] = part.kind === "markdown" || part.kind === "html" ? { ...part, vars } : part;
      }
      return { ...s, vars, parts };
    });
    return { ...open, name: doc.name, variables: doc.variables, sections };
  }

  /** Re-read the open view, silently. Callers emit once when they are done.
   *  @param {TableName} name */
  async function reopen(name) {
    if (!open || open.name !== name) return;
    table = /** @type {TableView | null} */ (
      await askOrNull({ ...env(), kind: "table.get", name, query: open.query })
    );
  }

  /** Keep the row count in the rack honest without re-listing every table.
   *  @param {TableName} name @param {number} delta */
  function bump(name, delta) {
    tables = tables.map((t) => (t.name === name ? { ...t, rows: Math.max(0, t.rows + delta) } : t));
  }

  /** True when the open view is this table — the only case in which a row write
   *  touches the cache at all. An artifact writing to a table nobody is looking
   *  at must not invent rows in the view that is on screen.
   *  @param {TableName} name */
  const showing = (name) => table !== null && table.schema.name === name;

  /** @param {RowId} id */
  const rowAt = (id) => (table ? table.rows.findIndex((r) => r.id === id) : -1);

  /** Swap one row for another, or drop it. Every write builds new objects: a
   *  view that kept the previous snapshot must be able to see that it is old.
   *  @param {number} at @param {Row | null} next */
  function spliceRow(at, next) {
    if (!table) return;
    const rows = table.rows.slice();
    if (next) rows.splice(at, 1, next);
    else rows.splice(at, 1);
    table = { ...table, rows, total: table.total + (next ? 0 : -1) };
  }

  /** @type {Workspace} */
  const store = {
    get() {
      return { pages, tables, theme, page, table };
    },

    children(id) {
      return kids.get(id) ?? [];
    },

    on(fn) {
      return bus.on(fn);
    },

    onChange(fn) {
      return changes.on(fn);
    },

    /* ── the workspace ───────────────────────────────────────────────── */

    async loadTree() {
      await readShell();
      emit();
    },

    /* ── pages ───────────────────────────────────────────────────────── */

    async loadPage(id) {
      // A route back to a page already open does not go to the server. That is
      // the whole reason the two stores are separate: navigation lives in the
      // ui store and has a different lifetime from a replica of server state.
      if (page && page.id === id) return page;
      page = await readPage(id);
      emit();
      return page;
    },

    async reloadPage(id) {
      // The reload button, and the only thing in the client that can make the
      // layers above throw away what they built. A frame is reused while its
      // HTML is unchanged — that is what stops an artifact writing its own
      // document from destroying the frame the user is typing in — so a reload
      // that changed only a variable would otherwise leave the old frame on
      // screen. Dropping the page first tears every frame down; the read that
      // follows builds them again from disk. Two emits, on purpose, and this is
      // the only action in the file that does it.
      page = null;
      emit();
      page = await readPage(id);
      emit();
      changed({ page: id, shape: true });
      return page;
    },

    async createPage(init) {
      const ref = /** @type {PageRef} */ (await ask({ ...env(), kind: "page.create", init }));
      await readPages();
      emit();
      return ref;
    },

    async removePage(id) {
      await ask({ ...env(), kind: "page.remove", page: id });
      if (page && page.id === id) page = null;
      await readPages();
      emit();
    },

    async removeSection(id, section) {
      // ONE request, because a section is its entry, its own variables and — if
      // it names one — a file. It got simpler when the sidecar went, and it is
      // still one kind: doing it as two would leave a file nothing names sitting
      // invisible on disk, and would put two commits in the vault for one thing
      // the user did.
      await ask({ ...env(), kind: "section.remove", page: id, section });
      // Re-read, never dropped. A `DrawnSection` is resolved by the server —
      // the HTML loaded, the children looked up, the scopes gathered — and the
      // client must not re-derive any of that; but dropping the page first, the
      // way `reloadPage` does, would tear the frame down and restart a runtime
      // that had nothing to do with the section that went.
      if (page && page.id === id) page = await readPage(id);
      emit();
      // The SHAPE moved — an entry left `contents`, which is the list the page
      // IS — so a consumer holding derived structure has to rebuild rather than
      // patch.
      //
      // The rail is deliberately NOT re-read. A child key cannot be removed this
      // way — `@page-<id>` is reconciled from what the page actually holds, so
      // the server refuses it — which means what this page holds is exactly what
      // it held a moment ago.
      changed({ page: id, shape: true });
    },

    async writeSlot(id, section, part, data) {
      // THE PROSE WRITE, and it is one request that carries ONE SLOT'S text. It
      // fires on a debounce while somebody is typing, so anything larger would
      // make every keystroke a chance to put the screen's idea of the page over
      // a change that arrived from somewhere else in between.
      await ask({ ...env(), kind: "section.write", page: id, section, part, data });

      // IT TELLS NOBODY, AND THAT ASYMMETRY WITH `setSections` IS THE DECISION
      // WORTH READING. A `Change` reaches every box mounted on the page and asks
      // it to re-read; on a debounced keystroke that would re-fill the slot the
      // caret is sitting in, from a server copy of the words the caret is in the
      // middle of changing. The runtime that sent this is the one thing on
      // screen showing the text, and it already shows it. `emit()` is left out
      // for the smaller version of the same reason: nothing in the chrome draws
      // a slot's words, so a repaint per keystroke says nothing.
      //
      // The merge is still made, silently. It costs one object and it keeps the
      // store's copy honest, so the next repaint — caused by something else
      // entirely — draws what is on disk rather than what was there before the
      // paragraph was typed.
      if (page && page.id === id) {
        page = {
          ...page,
          sections: page.sections.map((s) => {
            if (s.name !== section) return s;
            const held = s.parts[part];
            if (!held || held.kind !== "markdown") return s;
            return { ...s, parts: { ...s.parts, [part]: { ...held, md: data } } };
          }),
        };
      }
    },

    async setSections(id, sections) {
      // ONE REQUEST FOR ADDING, REORDERING AND REMOVING, because `contents` IS
      // the order: there is no second place for a name to be in a different
      // position, so there is no pair of writes that can disagree.
      //
      // AND IT GOES THROUGH THE STORE RATHER THAN STRAIGHT DOWN THE TRANSPORT,
      // which is the whole reason this method exists. `section.order` moves the
      // SHAPE of a page — the rail draws that order, the Config screen counts it,
      // and another box mounted on the same page is drawing it — and a request
      // that went past here would move it while every one of them went on showing
      // what it was. `writeSlot` above is deliberately the other way, and says
      // why.
      const next = /** @type {Section[]} */ (
        await ask({ ...env(), kind: "section.order", page: id, sections })
      );
      // Re-read, never merged. The server owns what a page holds — a child key
      // it put back, an entry the caller could not see — and a `DrawnSection` is
      // that list resolved. Dropping the page first, the way `reloadPage` does,
      // would tear the frame down and restart a runtime that had nothing to do
      // with the section that moved.
      if (page && page.id === id) page = await readPage(id);
      // THE RAIL DRAWS THIS ORDER TOO. A page's children come back in the order
      // its own `contents` puts them, so moving `@page-x` moves the row in the
      // tree — and a rail left holding the old order is the drag that appears
      // not to have happened.
      await readChildren();
      emit();
      changed({ page: id, shape: true });
      return next;
    },

    async writeFile(id, file, text) {
      await ask({ ...env(), kind: "page.writeFile", page: id, file, text });
      // The page is re-read rather than patched, because writing a file is what
      // MAKES a block — the filesystem is the registry — so a write can change
      // the page's shape and not only its bytes.
      if (page && page.id === id) page = await readPage(id);
      emit();
      changed({ page: id, shape: true });
    },

    async moveChild(child, from, to) {
      // THE ONE WRITE THE TREE MAKES, AND IT IS A REAL MOVE NOW. It used to be
      // two sidecar patches — take the key out of one `order:`, put it into
      // another, and write `parent:` on the page. There is no `parent:` and no
      // `order:`: the folder IS the hierarchy, so moving a page moves its
      // directory and its id changes, and every id beneath it changes with it.
      //
      // WHERE IN THE LEVEL IS NOT SAYABLE, which is why there is no `before`
      // any more. A level's order is the parent's `contents`, and no ApiRequest
      // kind writes one — a child arrives at the bottom, which is where a thing
      // added to a folder turns up anyway, and reordering waits for a kind that
      // can carry it. Reported rather than faked: patching an order the wire
      // cannot express would be a drag that appears to work and does not
      // survive a reload.
      if (from === to) return null;
      // A page cannot hold itself or its own descendant. The rail refuses this
      // before it starts, but the store is the layer that must not be able to
      // write it — and the server refuses it a third time, because a directory
      // cannot contain the directory it is being copied out of.
      if (child.kind === "page" && (to === child.id || to.startsWith(child.id + "/"))) return null;

      /** @type {PageId | null} */
      let moved = null;
      if (child.kind === "page") {
        // THE ANSWER IS THE NEW ID, and taking it is not optional: the id we
        // sent has stopped existing, nothing forwards, and a stale one gets
        // `not_found` rather than somebody else's page.
        moved = /** @type {PageId} */ (
          await ask({ ...env(), kind: "page.move", page: child.id, parent: to })
        );
      } else {
        // A table has no directory, so its parent is registry state and moves
        // through its own call — without which a dragged table went on being
        // listed under the page it came from.
        await ask({ ...env(), kind: "table.setParent", name: child.id, parent: to });
      }

      // Re-read rather than reconcile: the server owns what a page holds, and
      // the rail is the one place a client-side guess would be visible as the
      // thing you just dragged jumping back.
      await readPages();
      // THE OPEN PAGE MAY HAVE BEEN RENAMED UNDERNEATH THE ROUTE. It is the
      // page that moved, or anything beneath it — the whole subtree was rewritten
      // — so the open id is rebuilt onto the new prefix rather than re-read,
      // which would ask for a page that is no longer there.
      if (page) {
        const now = moved === null ? page.id : rebase(page.id, child.id, moved);
        if (now !== page.id || page.id === from || page.id === to) page = await readPage(now);
      }
      emit();
      // Both ends moved, and an artifact mounted on either has to hear it —
      // `Change` names one page, so a move that crossed a boundary is two.
      changed({ page: from, shape: true });
      changed({ page: to, shape: true });
      return moved;
    },

    /* ── variables, which are what a page can be told without code ───── */

    async patchVariables(id, section, patch) {
      // The ADDRESSED form. An artifact's own `data.set` carries no page because
      // it is scoped to the mount it came from, and a mount is a client-side
      // fact the server must never guess at — so the bridge translates one into
      // the other and this store, which is always called with a page id,
      // addresses the merge directly.
      //
      // `section` null is the PAGE's own variables; a name is that section's,
      // which is where a slot writes. Where the value lands is the whole of what
      // this decides, because the nearest one wins: a value written to the page
      // is in scope for every section on it, and one written to a section is
      // not.
      const doc = /** @type {PageDoc} */ (
        await ask({ ...env(), kind: "variables.patch", page: id, section, patch })
      );
      // MERGED, NEVER RE-READ. A variables patch cannot change a page's shape —
      // there is no `order:` in it and no key that decides how the page is drawn
      // — so the document that comes back says everything that moved. Re-reading
      // would replace the page object on every slot flush and restart every
      // artifact mounted on it, including the one that did the writing.
      if (page && page.id === id) page = withDoc(page, doc);
      emit();
      changed({ page: id });
      return doc;
    },

    async readDocRaw(id) {
      // The ugly, always-available fallback for a page whose document did not
      // come out right. It matters MORE than it did: the prose is in there now,
      // so this is the only way back to a page whose one bad character took its
      // words with it. Nothing is cached — it is read to be edited, and a stale
      // copy of it is worse than a round trip.
      return /** @type {string} */ (await ask({ ...env(), kind: "doc.raw", page: id }));
    },

    async writeDocRaw(id, text) {
      const merged = /** @type {PageDoc} */ (
        await ask({ ...env(), kind: "doc.writeRaw", page: id, text })
      );
      // Always re-read: the raw fallback replaces the whole file, so the
      // sections, their order and the name may all have moved at once. It is the
      // hand-edit escape hatch and it is not on any hot path, so the round trip
      // costs nothing worth counting.
      if (page && page.id === id) page = await readPage(id);
      await readChildren();
      emit();
      changed({ page: id, shape: true });
      return merged;
    },

    /* ── tables ──────────────────────────────────────────────────────── */

    async loadTable(name, q) {
      const view = /** @type {TableView | null} */ (
        await askOrNull({ ...env(), kind: "table.get", name, query: q })
      );
      table = view;
      open = view ? { name, query: q } : null;
      emit();
      return view;
    },

    async insertRow(name, row) {
      // Confirmed rather than optimistic, and the reason is the query: where a
      // new row lands in a filtered, sorted view is the server's answer. The
      // view is re-read before anything is emitted, so the grid moves once.
      const id = /** @type {RowId} */ (await ask({ ...env(), kind: "row.insert", name, row }));
      bump(name, +1);
      await reopen(name);
      emit();
      changed({ tables: [name] });
      return id;
    },

    async updateRow(name, id, patch) {
      // Optimistic: a grid that waits for a round trip to show a keystroke
      // reads as broken, and this one is also written to by artifacts, where
      // the wait would be visible as a lag between two surfaces.
      //
      // The server returns nothing to reconcile against — `row.update` answers
      // with no row — so a rejected write is put back exactly as it was and the
      // caller's error says why. The cost is that a value the server coerced
      // (a number typed as text, a category widened) stays as the client sent
      // it until the next read. Worth it; the alternative is a re-read per
      // keystroke.
      const at = showing(name) ? rowAt(id) : -1;
      const before = at >= 0 && table ? table.rows[at] : undefined;
      // The view the optimistic write was made against. `open` is replaced
      // whole every time a view is opened, altered or dropped, so holding the
      // object is holding the answer to "is this still the same view".
      const from = open;
      if (before) {
        spliceRow(at, { id: before.id, cells: { ...before.cells, ...patch } });
        emit();
      }
      try {
        await ask({ ...env(), kind: "row.update", name, row: id, patch });
        changed({ tables: [name] });
      } catch (e) {
        // A ROLLBACK IS ONLY EVER APPLIED TO THE VIEW IT WAS TAKEN FROM.
        //
        // The user can edit a cell in jobs, navigate to another table, and only
        // then have the server refuse it. Putting `before` back by row id would
        // write a jobs value into whatever grid is now on screen — corrupting a
        // table nobody touched, and doing it invisibly, because a row id is just
        // an integer and every table has some.
        //
        // Dropping it is the whole remedy. The value on disk never moved: the
        // server refused the write, so the row is already what `before` holds,
        // and the next read of that view shows it.
        if (before && open === from && showing(name)) {
          const now = rowAt(id);
          if (now >= 0) spliceRow(now, before);
          emit();
        }
        throw e;
      }
    },

    async removeRow(name, id) {
      const at = showing(name) ? rowAt(id) : -1;
      const before = at >= 0 && table ? table.rows[at] : undefined;
      if (before) {
        spliceRow(at, null);
        bump(name, -1);
        emit();
      }
      try {
        await ask({ ...env(), kind: "row.remove", name, row: id });
      } catch (e) {
        if (before && table) {
          const rows = table.rows.slice();
          rows.splice(at, 0, before);
          table = { ...table, rows, total: table.total + 1 };
          bump(name, +1);
          emit();
        }
        throw e;
      }
      // The row was not in the open view — an artifact deleting from a table
      // nobody is looking at. The count in the rack still moves.
      if (!before) { bump(name, -1); emit(); }
      changed({ tables: [name] });
    },

    async createTable(schema) {
      await ask({ ...env(), kind: "table.create", schema });
      // A table is a child of some page, so the rail moved as well as the rack.
      await Promise.all([readTables(), readChildren()]);
      emit();
      changed({ tables: [schema.name] });
    },

    async alterTable(name, next) {
      await ask({ ...env(), kind: "table.alter", name, schema: next });
      // A column added, retyped or dropped changes every cell in the view, so
      // the open view is re-read rather than reconciled.
      if (open && open.name === name) open = { name: next.name, query: open.query };
      // A rename changes the child key, so the rail is re-read with the rack.
      await Promise.all([readTables(), readChildren(), reopen(next.name)]);
      emit();
      changed({ tables: [name, next.name] });
    },

    async dropTable(name) {
      await ask({ ...env(), kind: "table.remove", name });
      if (showing(name)) { table = null; open = null; }
      await Promise.all([readTables(), readChildren()]);
      emit();
      changed({ tables: [name] });
    },

    async importCsv(name, csv) {
      const added = /** @type {{ added: number }} */ (
        await ask({ ...env(), kind: "table.importCsv", name, csv })
      );
      await Promise.all([readTables(), reopen(name)]);
      emit();
      changed({ tables: [name] });
      return added;
    },

    /* ── theme ───────────────────────────────────────────────────────── */

    async setTheme(patch) {
      await ask({ ...env(), kind: "theme.set", theme: patch });
      // Merged locally rather than re-read. The theme is one small object and
      // the palette editor writes to it on every drag of a colour; a round trip
      // per drag would be visible.
      theme = { ...theme, ...patch };
      emit();
      changed({ theme: true });
    },

    /* ── the vault, which is which folder this workspace IS ──────────── */

    async vaultInfo() {
      return /** @type {VaultInfo} */ (await ask({ ...env(), kind: "vault.info" }));
    },

    async browseVault(path) {
      // Never cached. This is the server's own filesystem — the one capability
      // that is honestly server-side, because a browser cannot hand out an
      // absolute path — and a folder somebody made in a terminal a second ago
      // has to turn up. Omitting `path` asks for wherever the server starts.
      return /** @type {DirListing} */ (
        await ask({ ...env(), kind: "vault.browse", path })
      );
    },

    async recentVaults() {
      return /** @type {VaultInfo[]} */ (await ask({ ...env(), kind: "vault.recent" }));
    },

    async openVault(path) {
      // MOUNT IT, AND SAY WHAT IT IS. That is the whole of it now, and the thing
      // worth reading is everything this no longer does.
      //
      // It used to be the one action that invalidated everything at once: every
      // page, every table, the theme and the catalogue belonged to the folder
      // that was no longer open, so all of it was dropped, every frame torn down
      // in a deliberate first emit, and the whole shell read again. Getting the
      // order wrong left an artifact from the old workspace mounted over data
      // from the new one.
      //
      // A tab's vault is in its url and is settled before this store is
      // constructed, so there is no swap to sequence. Opening a folder is
      // checking that it CAN be a workspace — which is why this call is still
      // made, and made from the picker, where a refusal can be read — and then
      // going there. A store that cannot switch cannot be caught half-switched.
      return /** @type {VaultInfo} */ (await ask({ ...env(), kind: "vault.open", path }));
    },

    async createVault(parent, name) {
      // THE PARENT AND THE NAME STAY APART all the way to the filesystem, which
      // is why this takes two arguments rather than a joined path. A name is one
      // segment the server checks against the name rule; joined here, a name
      // carrying a separator would arrive as a parent nobody chose.
      //
      // What comes back is the vault, mounted — the server makes the folder and
      // then opens it the way it opens any empty one — so the caller navigates
      // to it exactly as it does after `openVault`.
      return /** @type {VaultInfo} */ (
        await ask({ ...env(), kind: "vault.create", parent, name })
      );
    },

    /* ── the design doc, which is one page outside the page tree ─────── */

    // ONE DOC AT `design/`, beside `pages/` and `market/` rather than inside
    // any of them. That placement is the whole design: the rail draws `pages/`,
    // so this is out of the tree by construction — no reserved id, no hidden-id
    // list, no third page kind — and a user is still free to keep a page of
    // their own called "design", which is why these are `design.*` on the wire
    // rather than `page.*` with an id nobody may use.
    //
    // NOTHING BELOW TOUCHES THE SNAPSHOT and none of it emits. The three fields
    // a page write moves — `pages`, `page`, `kids` — cannot see this doc, so an
    // emit would repaint the whole workspace to say that nothing in it changed,
    // and on a prose flush that is a repaint per keystroke. The one screen that
    // wants this reads it on demand and shows its own edit by re-reading; every
    // other screen is right without being told.

    async readDesign() {
      return /** @type {Page} */ (await ask({ ...env(), kind: "design.read" }));
    },

    async patchDesign(section, patch) {
      return /** @type {PageDoc} */ (
        await ask({ ...env(), kind: "design.patch", section, patch })
      );
    },

    async writeDesignFile(file, text) {
      await ask({ ...env(), kind: "design.writeFile", file, text });
    },
  };

  return store;
}
