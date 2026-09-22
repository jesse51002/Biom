// SPDX-License-Identifier: AGPL-3.0-only
// The two stores, against a fake Transport.
//
// These are the tests that matter for the client, because the store is the only
// module that caches server state and the only one every view depends on. What
// is checked here is not "does it call the server" — it is the four properties
// the mock's store could not have: one emit per action, an optimistic write
// that rolls back, a reload that drops what was cached, and an unsubscribe that
// actually stops.

import { test, expect } from "bun:test";
import { makeWorkspace, rebase, scopeOf, childKey, parentOf, segmentOf, ROOT_PAGE } from "../client/store/workspace.js";
import { makeUi } from "../client/store/ui.js";
import { childKey as contractKey, ROOT_PAGE as contractRoot,
         parentOf as contractParent, segmentOf as contractSegment } from "../contracts/types.ts";

/* ── a fake server ───────────────────────────────────────────────────────
   It answers the kinds the store sends, records every request, and can be
   told to fail one kind or to hold one kind open so the optimistic window is
   observable from a test. */

const THEME = {
  palette: { name: "Press Proof", colors: { ink: "x" }, extra: [] },
  fonts: { roles: { sheet: "a", furniture: "b", gauge: "c" }, available: [] },
};

function fake() {
  const t = {
    calls: [],
    /** kinds that answer with a failure, and the code they answer with */
    fail: new Map(),
    /** one kind held open until release() is called */
    gate: null,

    // NO `parent` FIELD. The folder is the hierarchy and the id is the path to
    // it, so a page's parent is everything before its last segment — derived,
    // never stored, and so never able to disagree with where the page is.
    pages: [
      { id: "notes", name: "Notes" },
      { id: "board", name: "Job board" },
    ],
    // Layer one: what each page holds, pages and tables in the same list. The
    // root page holds the top level, and `jobs` is deliberately NOT in home's
    // order — a child the page has never placed is the normal state, and the
    // order a move is built on has to materialise it rather than lose it.
    kids: {
      home: [
        { kind: "page", id: "notes", name: "Notes" },
        { kind: "table", id: "jobs", name: "jobs", rows: 2 },
      ],
      notes: [{ kind: "page", id: "board", name: "Job board" }],
    },
    /** ONE FILE HOLDS EVERYTHING A PAGE SAYS: its name, its sections in order,
     *  the prose inside them, and the variables each one resolves against. This
     *  is that file, parsed — which is what `page.read` resolves into
     *  `DrawnSection[]` and what `variables.patch` answers with.
     *
     *  SECTIONS AND NOTHING ELSE: no `type` key, because a section is the only
     *  thing `contents` can hold; no `kind:`, because there is one kind of page;
     *  no `render:`, because there is one reader. A bare string in `parts` is
     *  markdown, which is what most slots hold. */
    docs: {
      home: {
        name: "Home", variables: {},
        contents: [{ name: "intro", parts: { body: "# Home" } }],
      },
      notes: {
        name: "Notes", variables: { rate: 62 },
        contents: [
          { name: "title", parts: { body: "# Notes\n\nThe rate is {{rate}}." } },
          // TWO SLOTS IN ONE SECTION, which the flat list before this could not
          // express at all: three columns of prose is one section, not three.
          { name: "body", parts: { left: "Words.", right: "More words." } },
          { name: "tail", data: "tail.html", parts: { body: "More." }, variables: { rate: 70 } },
        ],
      },
      board: { name: "Job board", variables: {}, contents: [] },
    },
    rows: [
      { id: 1, cells: { name: "Ash St", stage: "Quoted" } },
      { id: 2, cells: { name: "Bell Rd", stage: "Done" } },
    ],
    tables: [{ name: "jobs", kind: "basic", rows: 2 }],
    nextRowId: 3,

    /** The design doc's own document, and its own files. It lives at `design/`,
     *  outside `pages/`, so nothing above can see it. */
    design: {
      name: "Design", variables: {},
      contents: [{ name: "voice", parts: { body: "# Voice" }, variables: { heading: "Voice" } }],
    },
    designFiles: [],

    // The vault, which is which folder all of the above came out of. Opening one
    // means the server builds every module again against a different directory —
    // a new Files, a new Db, a new everything above them — so the fake swaps the
    // lot rather than editing it, which is exactly what the client has to cope
    // with.
    vault: { path: "/w/one", name: "one", seeded: true },
    recents: [
      { path: "/w/one", name: "one", seeded: true },
      { path: "/w/two", name: "two", seeded: true },
    ],
    dirs: {
      "/w": {
        at: "/w", up: "/",
        dirs: [
          { name: "one", path: "/w/one", vault: true },
          { name: "fresh", path: "/w/fresh", vault: false },
        ],
      },
    },

    /** hold(kind) -> release(); the store's next call of that kind waits */
    hold(kind) {
      let open;
      const p = new Promise((r) => { open = r; });
      t.gate = { kind, p };
      return () => { t.gate = null; open(); };
    },

    count: (kind) => t.calls.filter((c) => c.kind === kind).length,

    /** The document RESOLVED, which is what `Page` is: every section's HTML
     *  loaded, every slot filled and every scope gathered. RESOLUTION IS
     *  SERVER-SIDE and not an optimisation — the runtime that draws this lives
     *  in an opaque-origin frame and cannot fetch, so a part naming a file the
     *  guest was expected to load would simply never draw.
     *
     *  The markdown comes back RAW, braces and all: interpolation happens where
     *  the part is drawn, because prose is editable in place and writes back.
     *
     *  THE SCOPE IS WRITTEN AT BOTH LEVELS because it is read at both: a section
     *  carries it, and so does every markdown or html part inside it, since a
     *  part is drawn from its own `vars` and never reaches up. */
    pageOf(id, doc) {
      return {
        id, name: doc.name, variables: doc.variables,
        sections: doc.contents.map((section) => {
          const vars = { ...doc.variables, ...(section.variables ?? {}) };
          const parts = {};
          for (const [slot, held] of Object.entries(section.parts ?? {})) {
            // A bare string is markdown; a map is a full Content.
            const c = typeof held === "string" ? { type: "markdown", data: held } : held;
            const own = { ...vars, ...(c.variables ?? {}) };
            parts[slot] =
              c.type === "markdown" ? { kind: "markdown", md: c.data, vars: own }
              : c.type === "html" ? { kind: "html", file: c.data, html: "", vars: own }
              : c.type === "table" ? { kind: "table", table: c.data }
              : { kind: "child", child: { kind: "page", id: c.data, name: c.data } };
          }
          // `data` omitted resolves to the shipped default SECTION FILE, and
          // `fallback` is how the page says so.
          return { name: section.name, html: "", fallback: section.data === undefined, parts, vars };
        }),
        page: [], ports: null,
      };
    },

    async call(req) {
      t.calls.push(req);
      if (t.gate && t.gate.kind === req.kind) await t.gate.p;
      if (t.fail.has(req.kind)) {
        return {
          id: req.id, g: req.g, ok: false,
          error: { code: t.fail.get(req.kind), message: "no", retryable: false },
        };
      }
      // Cloned, because the wire is JSON: a store that held a live reference to
      // the server's own object would pass tests it should fail.
      return { id: req.id, g: req.g, ok: true, value: structuredClone(t.value(req)) };
    },

    value(req) {
      switch (req.kind) {
        case "page.list": return t.pages;
        case "table.list": return t.tables;
        case "theme.get": return THEME;
        case "children": return t.kids[req.page] ?? [];
        // The whole tree in one answer, keyed by id, root included — what the
        // store reads now; the per-page kind stays for a box asking about its
        // own page.
        case "children.all": return Object.fromEntries(Object.entries(t.kids));
        case "page.read": {
          const doc = t.docs[req.page];
          if (!doc) return null;
          return t.pageOf(req.page, doc);
        }
        case "section.remove": {
          // It got SIMPLER when the sidecar went: the entry carries its own text
          // and its own variables, so removing the entry removes all three, and
          // the only thing left to chase is the file the section names.
          const doc = t.docs[req.page];
          doc.contents = doc.contents.filter((c) => c.name !== req.section);
          return doc.contents.map((c) => c.name);
        }
        // ONE SLOT'S TEXT — a page, a section AND a part, because a slot has no
        // name of its own: its id is the key it sits under in `parts`. It fires
        // on a debounce while somebody is typing, so it carries the one slot it
        // changed and nothing else.
        case "section.write": {
          const doc = t.docs[req.page];
          const held = doc.contents.find((c) => c.name === req.section);
          held.parts[req.part] = req.data;
          return null;
        }
        // THE ORDER, AND WHAT IS IN IT, matched by name — a name already in the
        // document keeps its own entry and takes only its new position, which is
        // what makes it safe to build the list out of what is on screen.
        case "section.order": {
          const doc = t.docs[req.page];
          const stored = new Map(doc.contents.map((c) => [c.name, c]));
          doc.contents = req.sections.map((c) => stored.get(c.name) ?? c);
          return doc.contents;
        }
        case "page.create": {
          // The id is where it sits: the parent plus its own segment, so a page
          // cannot be created anywhere other than where its id says it is.
          const id = `${req.init.parent ?? "home"}/made`;
          t.docs[id] = { name: req.init.name, variables: {}, contents: [] };
          return { id, name: req.init.name };
        }
        case "page.rename": {
          // A RENAME IS A MOVE: the last segment is spelled from the name, so
          // the id changes and everything beneath it changes with it, and the
          // answer is the new id.
          const to = `${req.page.slice(0, req.page.lastIndexOf("/") + 1)}${req.name.replace(/\s+/g, "-")}`;
          for (const id of Object.keys(t.docs)) {
            const moved = rebase(id, req.page, to);
            if (moved === id) continue;
            t.docs[moved] = t.docs[id];
            delete t.docs[id];
          }
          t.docs[to].name = req.name;
          t.pages = t.pages.map((p) => ({
            ...p, id: rebase(p.id, req.page, to), name: p.id === req.page ? req.name : p.name,
          }));
          for (const [parent, held] of Object.entries(t.kids)) {
            t.kids[parent] = held.map((c) =>
              (c.kind === "page" && c.id === req.page ? { ...c, id: to, name: req.name } : c));
          }
          return to;
        }
        case "page.move": {
          // A REAL MOVE: the directory goes under the new parent, so the page's
          // id changes and every id beneath it changes with it. The answer is
          // the new one, because nothing forwards.
          const next = `${req.parent}/${segmentOf(req.page)}`;
          for (const id of Object.keys(t.docs)) {
            const moved = rebase(id, req.page, next);
            if (moved === id) continue;
            t.docs[moved] = t.docs[id];
            delete t.docs[id];
          }
          t.pages = t.pages.map((p) => ({ ...p, id: rebase(p.id, req.page, next) }));
          for (const [parent, held] of Object.entries(t.kids)) {
            t.kids[parent] = held.filter((c) => !(c.kind === "page" && c.id === req.page));
          }
          t.kids[req.parent] = [...(t.kids[req.parent] ?? []),
            { kind: "page", id: next, name: t.docs[next].name }];
          return next;
        }
        case "table.get": return {
          schema: { name: req.name, kind: "basic", columns: [{ name: "name", type: "text" }] },
          rows: t.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
          total: t.rows.length,
        };
        case "row.insert": {
          const id = t.nextRowId++;
          t.rows.push({ id, cells: { ...req.row } });
          t.tables[0].rows = t.rows.length;
          return id;
        }
        case "row.update": {
          const row = t.rows.find((r) => r.id === req.row);
          if (row) Object.assign(row.cells, req.patch);
          return null;
        }
        case "row.remove":
          t.rows = t.rows.filter((r) => r.id !== req.row);
          t.tables[0].rows = t.rows.length;
          return null;
        case "variables.patch": {
          // ONE SCOPE, and which one is the whole of what this decides: a null
          // section is the page's own values, in scope everywhere on it; a name
          // is that section's, which is where a slot writes. The answer is the
          // whole document.
          const doc = t.docs[req.page];
          if (req.section === null) doc.variables = { ...doc.variables, ...req.patch };
          else {
            const held = doc.contents.find((c) => c.name === req.section);
            held.variables = { ...(held.variables ?? {}), ...req.patch };
          }
          return doc;
        }
        case "vault.info": return t.vault;
        case "vault.recent": return t.recents;
        case "vault.browse": return t.dirs[req.path ?? "/w"] ?? { at: "/", up: null, dirs: [] };
        case "vault.open": {
          t.vault = { path: req.path, name: req.path.split("/").pop(), seeded: true };
          t.recents = [t.vault, ...t.recents.filter((v) => v.path !== req.path)];
          // A different workspace entirely. Nothing the client is holding
          // survives this, which is the whole point of the test below.
          t.pages = [{ id: "welcome", name: "Welcome" }];
          t.kids = { home: [{ kind: "page", id: "welcome", name: "Welcome" }] };
          t.tables = [{ name: "notes", kind: "basic", rows: 0 }];
          t.docs = {
            home: { name: "Home", variables: {}, contents: [] },
            welcome: { name: "Welcome", variables: {}, contents: [] },
          };
          return t.vault;
        }
        // The design doc, which is ONE page at `design/` and is deliberately
        // not in `pages/` — so it is a separate store here, exactly as it is a
        // separate directory in the vault, and the page fixtures above cannot
        // reach it. Note the page called "design" put into `t.docs` by the
        // test below: two id spaces, no collision.
        case "design.read": return t.pageOf("design", t.design);
        case "design.patch": {
          if (req.section === null) t.design.variables = { ...t.design.variables, ...req.patch };
          else {
            const held = t.design.contents.find((c) => c.name === req.section);
            held.variables = { ...(held.variables ?? {}), ...req.patch };
          }
          return t.design;
        }
        case "design.writeFile":
          t.designFiles.push({ file: req.file, text: req.text });
          return null;
        default: return null;
      }
    },
  };
  return t;
}

/** Counts emits, records what the change feed said, and hands back the store.
 *  The two are separate signals on purpose: `on` says redraw, `onChange` says
 *  WHAT moved — which is the half a mounted artifact needs, because it cannot
 *  observe anything outside its own frame. */
function wired() {
  const server = fake();
  const ws = makeWorkspace(server);
  const seen = { n: 0 };
  const changes = [];
  const off = ws.on(() => { seen.n++; });
  ws.onChange((c) => changes.push(c));
  return { server, ws, seen, changes, off };
}

/* ── the workspace store ─────────────────────────────────────────────── */

test("loadTree reads the whole shell and emits once", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTree();

  expect(seen.n).toBe(1);                       // four requests, one repaint
  const s = ws.get();
  expect(s.pages).toHaveLength(2);
  expect(s.tables[0].name).toBe("jobs");
  expect(s.theme.palette.name).toBe("Press Proof");
  expect(server.count("page.list")).toBe(1);
});

test("an empty store names no colour", () => {
  const { ws } = wired();
  expect(ws.get().theme.palette.colors).toEqual({});
  expect(ws.get().page).toBe(null);
});

test("a page already open is not refetched; reload always is", async () => {
  const { server, ws, seen } = wired();

  await ws.loadPage("notes");
  expect(seen.n).toBe(1);
  expect(server.count("page.read")).toBe(1);

  await ws.loadPage("notes");                   // a route back to it
  expect(seen.n).toBe(1);                       // no request, no repaint
  expect(server.count("page.read")).toBe(1);

  await ws.reloadPage("notes");
  expect(server.count("page.read")).toBe(2);
  // Two emits, on purpose: the first drops every mounted frame, the second
  // builds them again from what is now on disk.
  expect(seen.n).toBe(3);
  expect(ws.get().page.id).toBe("notes");
});

test("reload drops the cached page before it reads", async () => {
  const { ws } = wired();
  await ws.loadPage("notes");

  let sawNull = false;
  ws.on(() => { if (ws.get().page === null) sawNull = true; });
  await ws.reloadPage("notes");

  expect(sawNull).toBe(true);
  expect(ws.get().page).not.toBe(null);
});

test("renaming a page is a move: the rail is re-listed and the open page re-read under its new id", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  const paints = seen.n;

  const to = await ws.renamePage("notes", "Field notes");
  // THE ANSWER IS THE NEW ID, because the one sent has stopped existing.
  expect(to).toBe("Field-notes");
  expect(server.count("page.rename")).toBe(1);
  // The rail is re-read rather than patched: the server owns names as it owns
  // ids. The open page was the one renamed, so it is re-read under the new id
  // — that read is what carries the new name.
  expect(server.count("page.list")).toBe(2);
  expect(server.count("page.read")).toBe(2);
  expect(ws.get().pages.find((p) => p.id === to).name).toBe("Field notes");
  expect(ws.get().pages.some((p) => p.id === "notes")).toBe(false);
  expect(ws.get().page.id).toBe(to);
  expect(ws.get().page.name).toBe("Field notes");
  expect(seen.n).toBe(paints + 1);
});

test("a page that is not there is an answer, not a failure", async () => {
  const { server, ws } = wired();
  server.fail.set("page.read", "not_found");
  expect(await ws.loadPage("gone")).toBe(null);
  expect(ws.get().page).toBe(null);
});

test("any other failure throws, carrying the wire's own code", async () => {
  const { server, ws } = wired();
  server.fail.set("page.read", "internal");
  expect(ws.loadPage("notes")).rejects.toMatchObject({ code: "internal" });
});

test("a row update shows before the server answers, and rolls back if refused", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTable("jobs");
  const base = seen.n;

  const release = server.hold("row.update");
  const pending = ws.updateRow("jobs", 1, { stage: "Won" });

  // The optimistic window: the grid has moved and the server has not answered.
  expect(ws.get().table.rows[0].cells.stage).toBe("Won");
  expect(seen.n).toBe(base + 1);
  release();
  await pending;
  expect(seen.n).toBe(base + 1);                // confirming is not a second repaint
  expect(ws.get().table.rows[0].cells.stage).toBe("Won");

  server.fail.set("row.update", "bad_request");
  expect(ws.updateRow("jobs", 1, { stage: "Lost" })).rejects.toMatchObject({ code: "bad_request" });
  await Bun.sleep(0);
  expect(ws.get().table.rows[0].cells.stage).toBe("Won");   // put back exactly
  expect(seen.n).toBe(base + 3);                            // optimistic, then the rollback
});

test("a rejected edit rolls back into the view it was taken from, or into nothing", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTable("jobs");

  // The optimistic write goes in, and then the user walks away from the table
  // before the server refuses it. A rollback aimed at "the open view" would put
  // a jobs value into whatever grid is on screen — corrupting a table nobody
  // touched, with the value on disk already correct underneath it.
  server.fail.set("row.update", "bad_request");
  const release = server.hold("row.update");
  const pending = ws.updateRow("jobs", 1, { stage: "Won" });
  expect(ws.get().table.rows[0].cells.stage).toBe("Won");

  server.rows = [{ id: 1, cells: { name: "Rate card", stage: "Open" } }];
  await ws.loadTable("rates");
  expect(ws.get().table.schema.name).toBe("rates");
  const shown = ws.get().table.rows;
  const base = seen.n;

  release();
  expect(pending).rejects.toMatchObject({ code: "bad_request" });
  await Bun.sleep(0);

  expect(ws.get().table.schema.name).toBe("rates");
  expect(ws.get().table.rows).toBe(shown);        // the same array, never rewritten
  expect(ws.get().table.rows[0].cells.name).toBe("Rate card");
  expect(ws.get().table.rows[0].cells.stage).toBe("Open");
  expect(seen.n).toBe(base);                      // and no repaint of a view that did not move
});

test("a write to a table nobody is looking at leaves the open view alone", async () => {
  const { ws } = wired();
  await ws.loadTable("jobs");
  const rows = ws.get().table.rows;

  await ws.updateRow("rates", 1, { stage: "Won" });
  expect(ws.get().table.rows).toBe(rows);       // same array, untouched
});

test("insert is confirmed, re-reads the view, and moves the count once", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTable("jobs");
  await ws.loadTree();
  const base = seen.n;

  const id = await ws.insertRow("jobs", { name: "Cole Way", stage: "Quoted" });

  expect(id).toBe(3);
  expect(seen.n).toBe(base + 1);                // insert + re-read = one repaint
  expect(ws.get().table.rows).toHaveLength(3);
  expect(ws.get().table.rows[2].cells.name).toBe("Cole Way");
  expect(ws.get().tables[0].rows).toBe(3);
  expect(server.count("table.get")).toBe(2);    // the view was re-read, not guessed
});

test("remove takes the row out immediately and puts it back if refused", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTable("jobs");
  await ws.loadTree();

  await ws.removeRow("jobs", 1);
  expect(ws.get().table.rows.map((r) => r.id)).toEqual([2]);
  expect(ws.get().table.total).toBe(1);
  expect(ws.get().tables[0].rows).toBe(1);

  server.fail.set("row.remove", "internal");
  const before = seen.n;
  expect(ws.removeRow("jobs", 2)).rejects.toMatchObject({ code: "internal" });
  await Bun.sleep(0);
  expect(ws.get().table.rows.map((r) => r.id)).toEqual([2]);   // back in place
  expect(ws.get().table.total).toBe(1);
  expect(seen.n).toBe(before + 2);
});

test("writing a file re-reads the page, because a file is what makes a block", async () => {
  const { server, ws, seen } = wired();
  await ws.loadPage("notes");
  const base = seen.n;

  await ws.writeFile("notes", "calc.html", "<div></div>");
  expect(server.count("page.read")).toBe(2);
  expect(seen.n).toBe(base + 1);
});

test("deleting a section is one request, one repaint, and says the shape moved", async () => {
  const { server, ws, seen, changes } = wired();
  await ws.loadPage("notes");
  const base = seen.n;
  changes.length = 0;

  await ws.removeSection("notes", "body");

  // ONE request for three writes on disk. Three would leave every failure mode
  // half-done and put three commits in the vault for one thing the user did.
  expect(server.count("section.remove")).toBe(1);
  expect(server.calls.at(-1).kind).toBe("page.read");   // and it re-reads after
  expect(seen.n).toBe(base + 1);

  // The middle section is gone and the ones around it are still in order.
  expect(ws.get().page.sections.map((s) => s.name)).toEqual(["title", "tail"]);

  // The SHAPE moved, not only the content: a consumer holding derived structure
  // has to rebuild rather than patch, and there is no other way for an artifact
  // in an opaque-origin frame to find out.
  expect(changes).toEqual([{ page: "notes", shape: true }]);
});

test("deleting a section re-reads the page instead of dropping it", async () => {
  // `reloadPage` drops the page first, on purpose, because that tears every
  // frame down. This must not: a section going is no reason to restart an
  // artifact mounted three sections above it.
  const { ws } = wired();
  await ws.loadPage("notes");

  let sawNull = false;
  ws.on(() => { if (ws.get().page === null) sawNull = true; });
  await ws.removeSection("notes", "body");

  expect(sawNull).toBe(false);
  expect(ws.get().page.id).toBe("notes");
});

test("a refused delete throws and moves nothing", async () => {
  const { server, ws, seen, changes } = wired();
  await ws.loadPage("notes");
  const base = seen.n;
  changes.length = 0;

  // What the server answers for a child key: the entry is reconciled from what
  // the page holds, so removing it would only make it come back.
  server.fail.set("section.remove", "bad_request");
  expect(ws.removeSection("notes", "@page-Board")).rejects.toMatchObject({ code: "bad_request" });
  await Bun.sleep(0);

  expect(ws.get().page.sections.map((s) => s.name)).toEqual(["title", "body", "tail"]);
  expect(seen.n).toBe(base);
  expect(changes).toEqual([]);
});

test("a patch is ADDRESSED: a page, a scope, and the values", async () => {
  const { server, ws } = wired();
  await ws.loadPage("notes");

  const doc = await ws.patchVariables("notes", "tail", { rate: 80 });

  // The whole document comes back, which is everything needed to say what the
  // page now shows without re-reading it.
  expect(doc.contents.find((c) => c.name === "tail").variables).toEqual({ rate: 80 });
  // An artifact's own `data.set` carries no page — it is scoped to the box it
  // came from, and a mount is a client-side fact the server must never guess —
  // so the store uses the form that names both the page and the SECTION.
  const sent = server.calls.find((c) => c.kind === "variables.patch");
  expect([sent.page, sent.section]).toEqual(["notes", "tail"]);
});

test("THE NEAREST ONE WINS, and the open page picks up both scopes", async () => {
  const { ws } = wired();
  await ws.loadPage("notes");

  await ws.patchVariables("notes", null, { rate: 90 });
  const sections = () => Object.fromEntries(ws.get().page.sections.map((s) => [s.name, s.vars.rate]));
  /** THE SAME SCOPE, ONE LEVEL DOWN. A part is drawn from its own `vars` and
   *  never reaches up for its section's, so a patch that moved one and not the
   *  other would leave the words showing the old number while the section
   *  claimed the new one. */
  const slots = () => Object.fromEntries(ws.get().page.sections.flatMap((s) =>
    Object.entries(s.parts).map(([slot, part]) => [s.name + "." + slot, part.vars.rate])));

  // The page's value reaches every section that has not written its own. `tail`
  // carries `rate: 70` of its own, so it is untouched by a page-level write —
  // which is the whole of the rule, and the reason a slot writes to a section
  // rather than to the page.
  expect(ws.get().page.variables.rate).toBe(90);
  expect(sections()).toEqual({ title: 90, body: 90, tail: 70 });
  expect(slots()).toEqual({
    "title.body": 90, "body.left": 90, "body.right": 90, "tail.body": 70,
  });

  await ws.patchVariables("notes", "tail", { rate: 95 });
  expect(sections()).toEqual({ title: 90, body: 90, tail: 95 });
  expect(slots()["tail.body"]).toBe(95);
});

test("a slot flush re-reads NOTHING, because the document says what moved", async () => {
  // The reason the merge is local: this call is usually a keystroke landing, and
  // a re-read per keystroke replaces the page object — and every frame keyed off
  // it — restarting the artifact that did the writing.
  const { server, ws, seen } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  const reads = server.count("page.read");
  const lists = server.count("page.list");
  const kids = server.count("children.all");
  const base = seen.n;

  await ws.patchVariables("notes", "title", { heading: "This week" });

  expect(server.count("page.read")).toBe(reads);
  expect(server.count("page.list")).toBe(lists);
  expect(server.count("children.all")).toBe(kids);
  expect(seen.n).toBe(base + 1);
});

test("a variables patch never claims the shape moved", async () => {
  // It cannot: there is no order in it and no key that decides how the page is
  // drawn. A consumer holding derived structure is told to rebuild only when it
  // has to, and a slot flush is the most common write there is.
  const { ws, changes } = wired();
  await ws.loadPage("notes");
  changes.length = 0;
  await ws.patchVariables("notes", "title", { heading: "This week" });
  expect(changes).toEqual([{ page: "notes" }]);
});

/* ── PROSE WRITES BACK, which is the exit condition of the whole thing ────
 *
 * AND THE TWO WRITES ARE DELIBERATELY ASYMMETRIC. `setSections` announces that
 * the page's shape moved; `writeSlot` announces nothing at all. That is not an
 * oversight in one of them — it is one decision, stated twice, and each half is
 * tested here so neither can be "tidied up" into the other.                   */

test("a prose write is one request, and page.read is not the second", async () => {
  // The same judgement a slot flush makes, and for the same reason: this fires
  // on a debounce while somebody is typing, so a re-read here would replace the
  // page object — and every frame keyed off it — mid-keystroke.
  const { server, ws } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  const reads = server.count("page.read");

  await ws.writeSlot("notes", "body", "left", "Rates went up in March.");

  // A PAGE, A SECTION AND A PART. A slot has no name of its own — its id is the
  // key it sits under in the section's `parts` — so all three have to be said,
  // and `body` holds two slots precisely so that "which part" cannot be guessed.
  expect(server.calls.at(-1)).toMatchObject({
    kind: "section.write", page: "notes", section: "body", part: "left",
    data: "Rates went up in March.",
  });
  expect(server.count("page.read")).toBe(reads);
  expect(server.count("children.all")).toBe(1);  // the tree was not re-read either
});

test("A SLOT WRITE TELLS NOBODY, and that asymmetry is the decision", async () => {
  // A `Change` reaches every box mounted on the page and asks it to re-read. On
  // a debounced keystroke that would re-fill the slot the caret is sitting in,
  // from a server copy of the words the caret is in the middle of changing. The
  // runtime that sent this is the one thing on screen showing the text, and it
  // already shows it — so this write is silent on BOTH signals.
  const { ws, seen, changes } = wired();
  await ws.loadPage("notes");
  const base = seen.n;
  changes.length = 0;

  await ws.writeSlot("notes", "title", "body", "# Notes\n\nSame words, new day.");

  expect(seen.n).toBe(base);                     // no repaint: nothing in the chrome draws a slot
  expect(changes).toEqual([]);                   // and no box is told to re-read
});

test("the slot the caret is in shows what was just typed, without a round trip", async () => {
  const { ws } = wired();
  await ws.loadPage("notes");

  await ws.writeSlot("notes", "title", "body", "# Notes\n\nThe rate is {{rate}}, still.");

  const part = ws.get().page.sections.find((s) => s.name === "title").parts.body;
  expect(part.md).toBe("# Notes\n\nThe rate is {{rate}}, still.");
  // AND THE BRACES ARE STILL IN IT. Interpolation happens where the part is
  // drawn, so the store carries the template and never the number.
  expect(part.md).toContain("{{rate}}");
  // The scope is untouched: a prose write says what a paragraph SAYS, never what
  // it resolves against.
  expect(part.vars).toEqual({ rate: 62 });
  // AND NOTHING ELSE ON THE PAGE MOVED. The merge is one slot of one section.
  expect(ws.get().page.sections.map((s) => s.name)).toEqual(["title", "body", "tail"]);
  expect(ws.get().page.sections.find((s) => s.name === "body").parts.left.md).toBe("Words.");
});

test("a slot write to a page nobody is looking at merges into nothing", async () => {
  // The merge is guarded on the open page. Without that, typing in one page
  // would put its words into whichever page the store happens to be holding.
  const { ws } = wired();
  await ws.loadPage("notes");

  await ws.writeSlot("home", "intro", "body", "# Somewhere else");

  expect(ws.get().page.id).toBe("notes");
  expect(ws.get().page.sections.find((s) => s.name === "title").parts.body.md)
    .toBe("# Notes\n\nThe rate is {{rate}}.");
});

test("the order is one write, and the page and the rail are both re-read from it", async () => {
  // `contents` IS the order, so adding, reordering and removing are one request.
  // The server owns what comes back — a child entry it put back, an entry the
  // view could not see — so this one is re-read rather than merged.
  const { server, ws, seen, changes } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  const base = seen.n;
  changes.length = 0;
  // THE BOX IS TOLD BEFORE THE TREE IS RE-READ. A box re-reads the page from
  // the server on its own, so the change can go out the moment the order has
  // landed — and `children.all` on a large workspace is seconds, which is how
  // long the doc document's table-to-grid conversion used to sit undrawn.
  /** @type {number[]} */
  const treeReadsWhenTold = [];
  ws.onChange(() => treeReadsWhenTold.push(server.count("children.all")));

  const next = await ws.setSections("notes", [
    { name: "tail", parts: { body: "More." } },
    { name: "title", parts: { body: "# Notes" } },
  ]);

  expect(server.calls.filter((c) => c.kind === "section.order")).toHaveLength(1);
  expect(next.map((c) => c.name)).toEqual(["tail", "title"]);
  // `body` was absent from the list, so it is gone — removal is by absence,
  // because the list is the whole of what the page holds.
  expect(ws.get().page.sections.map((s) => s.name)).toEqual(["tail", "title"]);
  // A name that stayed keeps its own text and its own variables: the client sent
  // "More." for `tail` and the document's own entry is what survived.
  expect(ws.get().page.sections.find((s) => s.name === "tail").vars).toEqual({ rate: 70 });
  // THE RAIL DRAWS THIS ORDER TOO — a page's children come back in the order its
  // own contents put them — so the tree is re-read with the page: one request
  // for the whole tree, twice.
  expect(server.count("children.all")).toBe(2);
  // THE OTHER HALF OF THE ASYMMETRY. The shape of the page moved — the rail
  // draws that order, and another box mounted on the same page is drawing it —
  // so unlike a slot write, this one says so.
  expect(seen.n).toBe(base + 1);
  expect(changes).toEqual([{ page: "notes", shape: true }]);
  // Told once, with the tree still un-re-read at that moment.
  expect(treeReadsWhenTold).toEqual([1]);
});

/* ── the design doc: one page, and it is not in the page tree ──────────── */

// It is the workspace's own design language — what an agent reads before it
// writes UI and writes back to when the language moves. It sits at `design/`,
// beside `pages/`, which is the whole of how it stays out of the rail: no
// reserved id, no hidden-id list, no third page kind.

test("the design doc reads through its own kind, not through page.read", async () => {
  const { server, ws } = wired();
  await ws.loadTree();

  const page = await ws.readDesign();

  expect(page.id).toBe("design");
  expect(page.sections[0].vars.heading).toBe("Voice");
  expect(server.calls.at(-1)).toMatchObject({ kind: "design.read" });
  expect(server.count("page.read")).toBe(0);
});

test("a design write moves nothing in the snapshot, so it repaints nothing", async () => {
  const { server, ws, seen, changes } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  const base = seen.n;
  const pages = ws.get().pages;

  const merged = await ws.patchDesign("voice", { heading: "How we write" });
  await ws.writeDesignFile("voice.html", "<p>How we write</p>");

  expect(merged.contents[0].variables.heading).toBe("How we write");
  expect(server.designFiles).toEqual([{ file: "voice.html", text: "<p>How we write</p>" }]);

  // NOTHING IN WorkspaceSnapshot CAN SEE THIS DOC, so an emit would repaint the
  // whole workspace to say that nothing in it changed — and on a prose flush
  // that is a repaint per keystroke. The screen that wants it re-reads instead.
  expect(seen.n).toBe(base);
  expect(changes).toEqual([]);
  expect(ws.get().pages).toBe(pages);
  expect(ws.get().page.id).toBe("notes");
});

test("a page called design and the design doc are two different things", async () => {
  // The reason `design.*` exists rather than `page.*` with a reserved id: a
  // user is free to keep a page of their own called "design", and one id space
  // cannot hold both.
  const { server, ws } = wired();
  server.docs.design = { name: "Design notes", variables: {}, contents: [] };

  const mine = await ws.loadPage("design");
  const theirs = await ws.readDesign();

  expect(mine.name).toBe("Design notes");
  expect(theirs.name).toBe("Design");
});

/* ── the vault: the one action that invalidates everything at once ────────
 *
 * Every other action in the store changes one thing and says which. This one
 * changes which workspace this IS, so the tests are about what must NOT be left
 * behind: the open page, the open table view, the tree and the children map all
 * belonged to a folder that is no longer open.                                 */

test("the three vault reads are round trips and change nothing on screen", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  const base = seen.n;

  expect(await ws.vaultInfo()).toEqual({ path: "/w/one", name: "one", seeded: true });
  expect((await ws.recentVaults()).map((v) => v.name)).toEqual(["one", "two"]);

  // The server's own filesystem, and nothing about it is cached: a folder made
  // in a terminal a second ago has to turn up.
  const listing = await ws.browseVault("/w");
  expect(listing.at).toBe("/w");
  expect(listing.dirs.map((d) => d.name + ":" + d.vault)).toEqual(["one:true", "fresh:false"]);
  expect(server.count("vault.browse")).toBe(1);

  expect(seen.n).toBe(base);
  expect(ws.get().page.id).toBe("notes");
});

// THREE TESTS USED TO LIVE HERE, and what replaced them is worth reading.
//
// `openVault` was the one action that invalidated everything at once: every
// page, every table and the theme belonged to the folder that was no longer
// open, so all of it was dropped in a deliberate first emit — tearing
// every artifact frame down before anything of the new workspace could arrive —
// and the whole shell was read again in a second. Three tests pinned that
// sequence, because getting its order wrong left an artifact from one workspace
// mounted over another's data.
//
// A tab's vault is in its url and is settled before this store exists, so the
// sequence is gone rather than fixed. What is left is the check, and the store
// having no way at all to move.

test("opening a vault checks the folder and changes nothing on screen", async () => {
  const { server, ws, seen, changes } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  await ws.loadTable("jobs");
  const base = seen.n;
  changes.length = 0;

  const info = await ws.openVault("/w/two");

  // It answers with the folder, which is what the picker navigates to.
  expect(info).toEqual({ path: "/w/two", name: "two", seeded: true });

  // AND NOTHING HERE MOVED. Not the pages, not the open page, not the table on
  // screen, not the query it was read with — because this store is still the
  // store of the folder it was constructed for, and always will be.
  expect(ws.get().pages.map((p) => p.id)).toEqual(["notes", "board"]);
  expect(ws.get().page.id).toBe("notes");
  expect(ws.get().table.schema.name).toBe("jobs");
  expect(server.count("page.list")).toBe(1);

  // No emit, so no repaint, so no frame torn down. A workspace that cannot
  // switch cannot be caught half-switched, and this is that claim as a test.
  expect(seen.n).toBe(base);
  expect(changes).toEqual([]);
});

test("a row written after an open still goes to this store's own workspace", async () => {
  const { server, ws } = wired();
  await ws.loadTable("jobs");
  await ws.openVault("/w/two");

  // The view is the one it always was, and a write re-reads THAT — the other
  // folder is another tab's problem and this one cannot reach it.
  await ws.insertRow("jobs", { name: "First" });
  expect(ws.get().table.schema.name).toBe("jobs");
  expect(server.count("table.get")).toBeGreaterThan(0);
});

test("an open the server refuses throws and moves nothing", async () => {
  const { server, ws, seen, changes } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");
  const base = seen.n;
  changes.length = 0;

  server.fail.set("vault.open", "not_found");
  expect(ws.openVault("/w/nope")).rejects.toMatchObject({ code: "not_found" });
  await Bun.sleep(0);

  // Nothing is dropped until the server says the folder is open, so a refusal
  // leaves the workspace exactly as it was rather than empty.
  expect(ws.get().pages).toHaveLength(2);
  expect(ws.get().page.id).toBe("notes");
  expect(seen.n).toBe(base);
  expect(changes).toEqual([]);
});

/* ── layer one: what a page holds ────────────────────────────────────── */

test("the client's copy of the four contract values is the contract's", () => {
  // They are runtime values in contracts/types.ts and the client cannot import
  // it — there is no build step, so a browser cannot load a .ts file. This is
  // the whole reason the duplicate is allowed to exist, and this is the guard.
  expect(ROOT_PAGE).toBe(contractRoot);
  for (const id of ["home", "home/Notes", "home/Notes/deep"]) {
    expect(parentOf(id)).toBe(contractParent(id));
    expect(segmentOf(id)).toBe(contractSegment(id));
  }
  for (const child of [
    { kind: "page", id: "home/team/Notes", name: "" },
    { kind: "table", id: "jobs", name: "" },
  ]) {
    expect(childKey(child)).toBe(contractKey(child));
  }
  // A CHILD KEY IS ONE SEGMENT, never a path: a page's contents only ever name
  // its DIRECT children, which is what keeps it a legal filename and lets two
  // parents each hold a "notes".
  expect(childKey({ kind: "page", id: "home/team/Notes", name: "" })).toBe("@page-Notes");
  expect(parentOf("home")).toBe(null);
});

test("loadTree reads what every page holds, without taking the open-page slot", async () => {
  const { server, ws, seen } = wired();
  await ws.loadTree();

  expect(seen.n).toBe(1);                       // still one repaint for the lot
  // ONE REQUEST FOR THE WHOLE TREE, however many pages it holds — and never one
  // per page, which a browser refuses past a few hundred in flight. The root is
  // in the map whether or not it is in the page list.
  expect(server.count("children.all")).toBe(1);
  expect(server.count("children")).toBe(0);
  expect(ws.children("home").map((c) => c.kind + ":" + c.id))
    .toEqual(["page:notes", "table:jobs"]);
  expect(ws.children("board")).toEqual([]);
  expect(ws.get().page).toBe(null);             // nothing stole the open page
});

test("an id that moved is said again under its new parent", () => {
  // Pure, and the whole of what a client holding an id has to do when a page
  // moves: moving one renames every page inside it, because the id IS the path.
  expect(rebase("notes", "notes", "board/notes")).toBe("board/notes");
  expect(rebase("notes/sub", "notes", "board/notes")).toBe("board/notes/sub");
  // Untouched when it was never under the page that moved — which is what makes
  // it safe to call on whatever the client happens to be looking at.
  expect(rebase("other", "notes", "board/notes")).toBe("other");
  // And not fooled by a shared prefix that is not a path boundary.
  expect(rebase("notes-two", "notes", "board/notes")).toBe("notes-two");
});

test("one scope is the page's values with the content's over the top", () => {
  expect(scopeOf({ rate: 62, vat: 20 }, { rate: 70 })).toEqual({ rate: 70, vat: 20 });
  expect(scopeOf({ rate: 62 }, undefined)).toEqual({ rate: 62 });
});

test("a move inside the same page writes nothing at all", async () => {
  // WHERE IN THE LEVEL IS NOT SAYABLE. A level's order is the parent's
  // `contents`, and no wire kind writes one — so a drag that reordered would be
  // a gesture that appeared to work and did not survive a reload.
  const { server, ws, seen } = wired();
  await ws.loadTree();
  const base = seen.n;

  const moved = await ws.moveChild(ws.children("home")[0], "home", "home");

  expect(moved).toBe(null);
  expect(server.calls.filter((c) => c.kind === "page.move")).toHaveLength(0);
  expect(seen.n).toBe(base);
});

test("a move between pages MOVES THE DIRECTORY and answers the new id", async () => {
  const { server, ws, changes } = wired();
  await ws.loadTree();
  changes.length = 0;

  const notes = ws.children("home")[0];
  const moved = await ws.moveChild(notes, "home", "board");

  // The id is where the page sits, so moving it renames it. Nothing forwards:
  // the caller is holding an id that has just stopped existing, and the answer
  // is what it re-routes onto.
  expect(moved).toBe("board/notes");
  expect(server.calls.filter((c) => c.kind === "page.move"))
    .toEqual([expect.objectContaining({ page: "notes", parent: "board" })]);
  expect(ws.get().pages.map((p) => p.id)).toContain("board/notes");
  // Both ends moved, and an artifact mounted on either has to hear it.
  expect(changes).toEqual([{ page: "home", shape: true }, { page: "board", shape: true }]);
});

test("the open page is re-routed onto its new id rather than left pointing at nothing", async () => {
  const { ws } = wired();
  await ws.loadTree();
  await ws.loadPage("notes");

  await ws.moveChild(ws.children("home")[0], "home", "board");

  // A page open under an id that no longer exists reads back `not_found` and
  // shows an empty screen. The store is holding the only copy of "what is open",
  // so it is the layer that rebuilds it onto the new prefix.
  expect(ws.get().page.id).toBe("board/notes");
  expect(ws.get().page.name).toBe("Notes");
});

test("a table moves through its own call, because it has no directory", async () => {
  const { server, ws } = wired();
  await ws.loadTree();

  const jobs = ws.children("home").find((c) => c.kind === "table");
  expect(await ws.moveChild(jobs, "home", "notes")).toBe(null);

  expect(server.calls.filter((c) => c.kind === "table.setParent"))
    .toEqual([expect.objectContaining({ name: "jobs", parent: "notes" })]);
  expect(server.calls.filter((c) => c.kind === "page.move")).toHaveLength(0);
});

test("a page cannot be made its own child, or its own descendant's", async () => {
  const { server, ws } = wired();
  await ws.loadTree();
  const notes = ws.children("home")[0];
  await ws.moveChild(notes, "home", "notes");
  await ws.moveChild(notes, "home", "notes/deeper");
  expect(server.calls.filter((c) => c.kind === "page.move")).toHaveLength(0);
});

test("unsubscribe stops delivery", async () => {
  const { ws, seen, off } = wired();
  await ws.loadTree();
  off();
  await ws.loadPage("notes");
  expect(seen.n).toBe(1);
});

/* ── the ui store ────────────────────────────────────────────────────── */

test("a no-op set does not repaint — this is what killed set({})", () => {
  const ui = makeUi();
  let n = 0;
  ui.on(() => { n++; });

  ui.set({ dialog: true });
  expect(n).toBe(1);
  ui.set({ dialog: true });
  expect(n).toBe(1);
  ui.set({});
  expect(n).toBe(1);
  ui.set({ dialog: false });
  expect(n).toBe(2);
});

test("a collection has to be rebuilt to be seen", () => {
  const ui = makeUi();
  let n = 0;
  ui.on(() => { n++; });

  const same = ui.get().expanded;
  same.add("notes");
  ui.set({ expanded: same });                   // mutated in place: same reference
  expect(n).toBe(0);

  ui.set({ expanded: new Set(same).add("board") });
  expect(n).toBe(1);
  expect(ui.get().expanded.has("board")).toBe(true);
});

test("go resets the inserter", () => {
  const ui = makeUi();
  let n = 0;
  ui.on(() => { n++; });

  ui.set({ inserting: 2 });

  ui.go("page", "notes");
  expect(ui.get()).toMatchObject({ inserting: null });
  expect(ui.get().route).toEqual({ view: "page", id: "notes" });

  ui.go("table", "jobs");
  expect(n).toBe(3);                            // set, two gos
});

test("the ui store takes a route from boot", () => {
  const ui = makeUi({ route: { view: "table", id: "jobs" } });
  expect(ui.get().route).toEqual({ view: "table", id: "jobs" });
  expect(ui.get().inserting).toBe(null);
});
