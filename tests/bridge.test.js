// SPDX-License-Identifier: AGPL-3.0-only
// The chokepoint's own tests.
//
// bridge.js and guest/biom.js are the two halves of the one contract in
// this framework expected to outlive it, so these are conformance checks rather
// than coverage: every kind a section may say resolves, every kind only the
// RUNTIME may say is refused on the guest port and answered on the privileged
// one, every kind only the workspace UI may say is refused on both, a malformed
// envelope is refused, an unknown major is dropped in silence, and the in-flight
// cap answers rather than hangs.
//
// THE RINGS ARE THE POINT. `HostRequest` ⊂ `RuntimeRequest` ⊂ `ApiRequest`, and
// the two inner ones are the two doors this module has. A section must not be
// able to say `section.order` — a generated page that could reorder its own
// document could restructure the workspace it was asked to decorate — and the
// runtime must be able to, or nothing draws. Both halves of that are pinned
// below, because a ring that is only checked in one direction is not a ring.
//
// The bridge is DOM-free, which is exactly why it can be tested like this at
// all. frame.js is not, so the two frame tests below stand up the smallest fake
// document that will hold an iframe — enough to prove the one property that is
// the difference between a working demo and one that flickers on every
// keystroke, and enough to prove that the ORDER of the two granted ports is the
// protocol.

import { test, expect, mock } from "bun:test";
import { PROTOCOL, MAX_INFLIGHT, ERRORS } from "../contracts/wire.js";
import { makeBridge } from "../client/bridge/bridge.js";

/* ── the doubles ───────────────────────────────────────────────────────────
 * A WorkspaceStore and a Transport, only as far as the bridge reaches into
 * them. Writing a fuller fake would be writing the modules under test twice. */

const THEME = {
  palette: { name: "press", colors: { ink: "#231F20" }, extra: [] },
  fonts: { roles: { sheet: "a", furniture: "b", gauge: "c" }, available: [] },
};

/** @param {string} name @param {Record<string, any>} parts @param {object} [rest] */
const section = (name, parts, rest = {}) =>
  ({ name, html: "<div data-g-part=\"body\"></div>", fallback: true, parts, vars: {}, ...rest });

/** A page whose one section takes the whole sheet — its own HTML in one slot,
 *  and no prose anywhere on it. Its variables are all there are, which is why a
 *  dotted NAME is ordinary here: `board.done` is one key in one dictionary, not
 *  a section prefix, and nothing strips it. */
const PAGE = {
  id: "job-board",
  name: "Job board",
  variables: { "board.heading": "This week", "board.done": "Done", other: "x" },
  sections: [
    section("board",
      { body: { kind: "html", file: "board.html", html: "<main></main>", vars: {} } },
      { html: "<main data-g-part=\"body\"></main>", fallback: false }),
  ],
  page: [],
  ports: null,
};

/** A doc, with the values grouped where they are used. `calc` carries its own
 *  `heading` and the page carries `rate`, so the scope `calc` sees is both —
 *  nearest last — and that is what a slot in `calc.html` reads and writes.
 *
 *  `split` is the shape the old flat list could not express at all: ONE section
 *  holding two markdown slots. It is here because `doc.get` has to walk slots as
 *  well as sections, and a fixture with one part per section could not tell. */
const NOTES = {
  id: "notes",
  name: "Notes",
  variables: { rate: 62, heading: "The page's own" },
  sections: [
    section("intro", {
      body: { kind: "markdown", md: "# Notes\n\nThe rate is {{rate}}.", vars: { rate: 62, heading: "The page's own" } },
    }, { vars: { rate: 62, heading: "The page's own" } }),
    section("split", {
      left: { kind: "markdown", md: "Left column.", vars: { rate: 62, heading: "The page's own" } },
      right: { kind: "markdown", md: "Right column.", vars: { rate: 62, heading: "The page's own" } },
    }, { vars: { rate: 62, heading: "The page's own" } }),
    section("grid", { body: { kind: "table", table: "jobs" } }),
    section("calc", {
      body: { kind: "html", file: "calc.html", html: "<p></p>",
              vars: { rate: 62, heading: "What a job costs", done: "Done" } },
    }, { vars: { rate: 62, heading: "What a job costs", done: "Done" } }),
    section("outro", {
      body: { kind: "markdown", md: "Last.", vars: { rate: 62, heading: "The page's own" } },
    }, { vars: { rate: 62, heading: "The page's own" } }),
  ],
  page: [],
  ports: null,
};

/** What `variables.patch` answers with: the whole document, which is everything
 *  needed to say what the page now shows without a re-read. SECTIONS AND NOTHING
 *  ELSE — no `kind:`, no `render:`, and the array is the order. */
const NOTES_DOC = {
  name: "Notes",
  plugin: "doc",
  variables: { rate: 62, heading: "The page's own" },
  contents: [
    { name: "intro", parts: { body: "# Notes\n\nThe rate is {{rate}}." } },
    { name: "split", parts: { left: "Left column.", right: "Right column." } },
    { name: "grid", parts: { body: { type: "table", data: "jobs" } } },
    { name: "calc", data: "calc.html", parts: { body: { type: "html", data: "calc.html" } },
      variables: { heading: "What a job costs", done: "Done" } },
    { name: "outro", parts: { body: "Last." } },
  ],
};

function doubles(overrides = {}) {
  const calls = [];
  const store = {
    pages: [{ id: "job-board", name: "Job board" }],
    tables: [{ name: "jobs", kind: "basic", rows: 3 }],
    theme: THEME,
    page: PAGE,
    table: null,
  };
  const ws = {
    get: () => store,
    patchVariables: async (id, sectionName, patch) => {
      // What the server does: the patch lands in ONE scope, and the whole
      // document comes back. A null section is the page's own values.
      const doc = structuredClone(NOTES_DOC);
      if (sectionName === null) Object.assign(doc.variables, patch);
      else {
        const held = doc.contents.find((c) => c.name === sectionName);
        if (held) held.variables = { ...(held.variables ?? {}), ...patch };
      }
      calls.push({ kind: "variables.patch", page: id, section: sectionName, patch });
      return doc;
    },
    // Through the store, exactly as `removeSection` is: `section.order` moves
    // the shape of a page, and a forward past here is a section that reaches
    // the file while nothing on screen redraws.
    setSections: async (page, sections) => {
      calls.push({ kind: "setSections", page, sections });
      return sections;
    },
    removeSection: async (page, name) => { calls.push({ kind: "removeSection", page, section: name }); },
    insertRow: async () => 7,
    updateRow: async () => {},
    removeRow: async () => {},
    ...overrides.ws,
  };
  const transport = {
    call: async (req) => {
      calls.push(req);
      if (overrides.answer) return overrides.answer(req);
      const value =
        req.kind === "page.read" ? (req.page === "notes" ? NOTES : PAGE)
        : req.kind === "table.get" ? { schema: { name: req.name, kind: "basic", columns: [] }, rows: [], total: 0 }
        : req.kind === "table.schema" ? { name: req.name, kind: "basic", columns: [] }
        : req.kind === "sql" ? { columns: ["n"], rows: [[1]], changes: 0 }
        : req.kind === "fetch" ? { status: 200, headers: {}, body: "ok" }
        : null;
      return { id: req.id, g: PROTOCOL, ok: true, value };
    },
  };
  return { ws, transport, calls, store };
}

/** ONE BOX IS ONE PAGE, so a context is one field. There is no block in it any
 *  more, and nothing on either port can name one. */
const CTX = { page: "job-board" };
const NOTES_CTX = { page: "notes" };
const req = (o) => ({ id: "c1", g: PROTOCOL, ...o });

/* ── every kind an artifact may say ────────────────────────────────────── */

test("data.get is the PAGE's variables, because there is no narrower scope to name", async () => {
  const { ws, transport, store } = doubles();
  store.page = NOTES;
  const res = await makeBridge(ws, transport).resolve(req({ kind: "data.get" }), NOTES_CTX);
  expect(res.ok).toBe(true);
  // A section asking for "my variables" over the guest port can only be asking
  // for the page's: the box is the page, and a mount is a client-side fact this
  // request does not carry. A section that wants its own reads them off the page
  // the runtime already holds. `calc`'s own `heading` is deliberately NOT here.
  expect(res.value).toEqual({ rate: 62, heading: "The page's own" });
});

test("data.get on a page that took the whole sheet is the page's own variables", async () => {
  const { ws, transport } = doubles();
  const res = await makeBridge(ws, transport).resolve(req({ kind: "data.get" }), CTX);
  // A dot in a NAME is just a character — which is what makes the namespace
  // inside one dictionary work on a page like this.
  expect(res.value).toEqual({ "board.heading": "This week", "board.done": "Done", other: "x" });
});

test("data.get reads the page from the server when it is not the open one", async () => {
  const { ws, transport, calls, store } = doubles();
  store.page = NOTES;
  const res = await makeBridge(ws, transport).resolve(req({ kind: "data.get" }), CTX);
  expect(calls.some((c) => c.kind === "page.read" && c.page === "job-board")).toBe(true);
  expect(res.value).toEqual(PAGE.variables);
});

test("data.set lands on the PAGE, and answers the scope it made", async () => {
  const { ws, transport, calls, store } = doubles();
  store.page = NOTES;
  const bridge = makeBridge(ws, transport);

  const ok = await bridge.resolve(req({ kind: "data.set", patch: { heading: "Next week" } }), NOTES_CTX);
  expect(ok.ok).toBe(true);
  // NULL, and that is the assertion. Nothing on this port can address a section:
  // the runtime knows which section a plugin is mounted in and the host does not,
  // so the addressed write is `variables.patch` on the privileged port and this
  // one is deliberately the page-wide form.
  expect(calls.filter((c) => c.kind === "variables.patch")).toEqual([
    { kind: "variables.patch", page: "notes", section: null, patch: { heading: "Next week" } },
  ]);
  expect(ok.value).toEqual({ rate: 62, heading: "Next week" });
});

test("a slot key carrying a dot is a name like any other now", async () => {
  const { ws, transport, calls, store } = doubles();
  store.page = NOTES;
  // The host used to add the prefix and refuse a key that already had one. The
  // grouping is structural now, so `board.done` on a whole-page artifact is an
  // ordinary name and refusing it would break the pages that rely on it.
  const res = await makeBridge(ws, transport)
    .resolve(req({ kind: "data.set", patch: { "board.done": "Sent" } }), CTX);
  expect(res.ok).toBe(true);
  expect(calls.some((c) => c.kind === "variables.patch" && c.section === null)).toBe(true);
});

// ANOTHER PAGE VARIABLES, which is how a page reads what another page knows —
// the local-first join, and the reason reaching across a page boundary is a call
// rather than a template: prose stays readable without chasing it, and a page
// that depends on one somebody may rename fails visibly instead of leaving a
// blank in a paragraph.
//
// It is FORWARDED ADDRESSED, with the mounted page filled in when the artifact
// omits it, because a mount is a client-side fact the server must never guess —
// the same rule `data.get` and `children` follow.
test("variables is forwarded, and an omitted page means the one you are mounted on", async () => {
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport, { go: () => {} });

  const named = await bridge.resolve(req({ kind: "variables", page: "home/Rates" }), NOTES_CTX);
  expect(named.ok).toBe(true);
  expect(calls.filter((c) => c.kind === "variables").map((c) => c.page)).toEqual(["home/Rates"]);

  await bridge.resolve(req({ kind: "variables" }), NOTES_CTX);
  expect(calls.filter((c) => c.kind === "variables").map((c) => c.page)).toEqual(["home/Rates", NOTES_CTX.page]);
});

test("doc.get answers prose, and doc.list answers the tree the user sees", async () => {
  const { ws, transport } = doubles();
  const bridge = makeBridge(ws, transport);
  const doc = await bridge.resolve(req({ kind: "doc.get", page: "notes" }), CTX);
  // RAW, with the braces still in it. Every MARKDOWN slot of every section, in
  // section order and then slot order: `split` contributes two paragraphs from
  // one section, which is exactly what "a page holds sections and a section
  // holds slots" buys. A table, an html slot and a child are not prose and do
  // not project — and resolving `{{rate}}` here would resolve it against another
  // page's variables, which is the join `biom.variables` exists to make
  // explicit rather than to smuggle into a string.
  expect(doc.value).toBe(
    "# Notes\n\nThe rate is {{rate}}.\n\nLeft column.\n\nRight column.\n\nLast.");
  const list = await bridge.resolve(req({ kind: "doc.list" }), CTX);
  expect(list.value).toEqual([{ id: "job-board", name: "Job board" }]);
});

test("table reads pass through and do not disturb the grid the user has open", async () => {
  const { ws, transport, calls, store } = doubles();
  const bridge = makeBridge(ws, transport);

  const got = await bridge.resolve(req({ kind: "table.get", name: "jobs", query: { limit: 5 } }), CTX);
  expect(got.ok).toBe(true);
  expect(got.id).toBe("c1");                       // re-labelled with the artifact's own id
  expect(got.value.total).toBe(0);
  expect(calls.at(-1)).toMatchObject({ kind: "table.get", name: "jobs", query: { limit: 5 } });
  expect(store.table).toBe(null);                  // the open table never moved

  expect((await bridge.resolve(req({ kind: "table.schema", name: "jobs" }), CTX)).value.name).toBe("jobs");
  expect((await bridge.resolve(req({ kind: "table.list" }), CTX)).value).toEqual(store.tables);
});

test("row writes go through the store, which is what makes them show up in the grid", async () => {
  const seen = [];
  const { ws, transport } = doubles({
    ws: {
      insertRow: async (name, row) => { seen.push(["insert", name, row]); return 7; },
      updateRow: async (name, id, patch) => { seen.push(["update", name, id, patch]); },
      removeRow: async (name, id) => { seen.push(["remove", name, id]); },
    },
  });
  const bridge = makeBridge(ws, transport);

  expect((await bridge.resolve(req({ kind: "row.insert", name: "jobs", row: { job: "Ash" } }), CTX)).value).toBe(7);
  expect((await bridge.resolve(req({ kind: "row.update", name: "jobs", row: 7, patch: { job: "Ashgrove" } }), CTX)).ok).toBe(true);
  expect((await bridge.resolve(req({ kind: "row.remove", name: "jobs", row: 7 }), CTX)).ok).toBe(true);
  expect(seen).toEqual([
    ["insert", "jobs", { job: "Ash" }],
    ["update", "jobs", 7, { job: "Ashgrove" }],
    ["remove", "jobs", 7],
  ]);
});

test("sql and fetch are proxied, because the frame's origin cannot reach anything", async () => {
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport);

  const sql = await bridge.resolve(req({ kind: "sql", query: "select 1 as n", params: [] }), CTX);
  expect(sql.value.rows).toEqual([[1]]);

  const out = await bridge.resolve(req({ kind: "fetch", url: "https://example.com", init: { method: "GET" } }), CTX);
  expect(out.value.status).toBe(200);
  expect(calls.at(-1)).toMatchObject({ kind: "fetch", url: "https://example.com" });
});

test("theme.get hands over the palette as data, because tokens do not cross a frame", async () => {
  const { ws, transport } = doubles();
  const res = await makeBridge(ws, transport).resolve(req({ kind: "theme.get" }), CTX);
  expect(res.value).toBe(THEME);
});

/* ── the refusal, and the two rings it draws ───────────────────────────── */

test("every kind only the workspace UI may say is refused on BOTH ports", async () => {
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport);
  for (const kind of [
    "page.list", "page.create", "page.remove", "page.writeFile", "page.move",
    "doc.raw", "doc.writeRaw",
    "table.create", "table.alter", "table.remove", "table.setParent", "table.importCsv",
    "theme.set",
    // `vault.info` is not here any more — it is inner-ring, and the test below
    // is where it lives. The four that remain each NAME a folder that is not
    // this one, which is the whole of the line between them.
    "vault.browse", "vault.open", "vault.create", "vault.recent",
    "design.read", "design.patch", "design.writeFile",
  ]) {
    for (const res of [
      await bridge.resolve(req({ kind }), CTX),
      // The middle ring is strictly narrower than the server's own surface, so a
      // page created or a folder opened stays unsayable even from the runtime.
      await bridge.runtime(req({ kind }), CTX),
    ]) {
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe(ERRORS.UNKNOWN_KIND);
      expect(res.error.retryable).toBe(false);
    }
  }
  expect(calls).toEqual([]);   // nothing reached the server on the way to being refused
});

test("vault.info answers the MOUNTED folder, on both ports, and cannot name another", async () => {
  // A page may know where it lives because a person reading it has to be able to
  // point an agent at it. The answer is the store's own — the same call the
  // workspace's own screens make — so a page and the panel beside it can never
  // disagree about where the workspace is.
  const INFO = { path: "/home/you/Notes", name: "Notes", seeded: true, history: true };
  const { ws, transport, calls } = doubles({ ws: { vaultInfo: async () => INFO } });
  const bridge = makeBridge(ws, transport);

  expect((await bridge.resolve(req({ kind: "vault.info" }), CTX)).value).toEqual(INFO);
  expect((await bridge.runtime(req({ kind: "vault.info" }), CTX)).value).toEqual(INFO);

  // AND IT CANNOT REACH PAST THE FOLDER IT WAS ADDRESSED TO. A path smuggled
  // onto the envelope is ignored rather than honoured: there is no field for it
  // on the kind and nothing in the route reads one, so the answer is the same
  // one folder. A store is one vault for as long as it exists.
  const sneaky = await bridge.resolve(
    req({ kind: "vault.info", path: "/somewhere/else", vault: "/somewhere/else" }), CTX);
  expect(sneaky.value).toEqual(INFO);

  // Nothing went to the server for any of it — it is answered in-process.
  expect(calls).toEqual([]);
});

test("A SECTION CANNOT SAY `section.order`, AND THE RUNTIME CAN", async () => {
  // The ring boundary, in the one direction that matters. A generated page that
  // could reorder its own document could restructure the workspace it was asked
  // to decorate — so these are well-formed, they are routed, and the guest port
  // still refuses every one of them before the case can run.
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport);

  const runtimeOnly = [
    req({ kind: "page.read", page: "notes" }),
    req({ kind: "section.write", page: "notes", section: "intro", part: "body", data: "Rates went up." }),
    req({ kind: "section.order", page: "notes", sections: [{ name: "outro" }, { name: "intro" }] }),
    req({ kind: "section.remove", page: "notes", section: "intro" }),
    req({ kind: "variables.patch", page: "notes", section: "calc", patch: { rate: 80 } }),
  ];

  for (const r of runtimeOnly) {
    const refused = await bridge.resolve(r, NOTES_CTX);
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe(ERRORS.UNKNOWN_KIND);
  }
  expect(calls).toEqual([]);   // refused before anything below was touched

  for (const r of runtimeOnly) {
    const answered = await bridge.runtime(r, NOTES_CTX);
    expect({ kind: r.kind, ok: answered.ok }).toEqual({ kind: r.kind, ok: true });
  }
});

test("`section.order` goes THROUGH THE STORE, because it moves the shape of a page", async () => {
  // The bug this pins, exactly as it presented: pressing `+` wrote the new
  // section to disk and nothing on screen ever changed. `section.order` was
  // forwarded straight down the transport, so no Change was emitted, so no box
  // was told to re-read and the rail went on drawing the old order. Dragging
  // looked fine only because the runtime moves the elements itself — which is
  // what made it look like an "add" bug rather than a routing one.
  //
  // `ws.setSections` was implemented, documented and tested throughout; it was
  // simply never called, and `WorkspaceStore` never declared it, so nothing
  // failed to typecheck either.
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport);

  const sections = [{ name: "outro" }, { name: "intro" }];
  const answered = await bridge.runtime(
    req({ kind: "section.order", page: "notes", sections }),
    NOTES_CTX,
  );

  expect(answered.ok).toBe(true);
  expect(calls).toEqual([{ kind: "setSections", page: "notes", sections }]);
  // Never the transport. Going past the store is the whole defect.
  expect(calls.some((c) => c.kind === "section.order")).toBe(false);
});

test("the runtime's own kinds go where they have to go, and nowhere else", async () => {
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport);

  // `page.read` is a straight pass-through and NOT a read of the store's copy:
  // `section.write` fires on a debounce while somebody is typing and does not go
  // through the store, so the store's copy is behind the file by design.
  await bridge.runtime(req({ kind: "page.read", page: "notes" }), NOTES_CTX);
  expect(calls.at(-1)).toMatchObject({ kind: "page.read", page: "notes" });

  // ONE SLOT'S TEXT — a page, a section AND a part, because a slot has no name
  // of its own; its id is the key it sits under in the section's `parts`.
  await bridge.runtime(req({
    kind: "section.write", page: "notes", section: "intro", part: "body", data: "Rates went up.",
  }), NOTES_CTX);
  expect(calls.at(-1)).toMatchObject({
    kind: "section.write", page: "notes", section: "intro", part: "body", data: "Rates went up.",
  });

  // Through the STORE, so the rail and the grid learn that the page's shape
  // moved — and the answer is null rather than the sections that remain.
  const removed = await bridge.runtime(req({ kind: "section.remove", page: "notes", section: "intro" }), NOTES_CTX);
  expect(calls.at(-1)).toEqual({ kind: "removeSection", page: "notes", section: "intro" });
  expect(removed.value).toBe(null);
});

test("the addressed patch answers THE SECTION'S scope, with the page's underneath", async () => {
  // THE NEAREST ONE WINS, and this is the read-back for exactly the level the
  // wire can address. `calc` carries its own `heading`; `rate` comes from the
  // page; the same rule resolves `{{heading}}` in the prose two sections away.
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport);

  const scoped = await bridge.runtime(
    req({ kind: "variables.patch", page: "notes", section: "calc", patch: { done: "Sent" } }), NOTES_CTX);
  expect(scoped.value).toEqual({ rate: 62, heading: "What a job costs", done: "Sent" });
  expect(calls.at(-1)).toMatchObject({ kind: "variables.patch", page: "notes", section: "calc" });

  // A null section is the page's own values, in scope for every section on it.
  const wide = await bridge.runtime(
    req({ kind: "variables.patch", page: "notes", section: null, patch: { rate: 90 } }), NOTES_CTX);
  expect(wide.value).toEqual({ rate: 90, heading: "The page's own" });
});

test("a malformed envelope is refused and still correlates when it can", async () => {
  const { ws, transport } = doubles();
  const bridge = makeBridge(ws, transport);

  const noKind = await bridge.resolve(req({ kind: "table.get" }), CTX);   // no name
  expect(noKind.ok).toBe(false);
  expect(noKind.error.code).toBe(ERRORS.UNKNOWN_KIND);
  expect(noKind.id).toBe("c1");

  const noId = await bridge.resolve({ g: PROTOCOL, kind: "data.get" }, CTX);
  expect(noId.ok).toBe(false);
  expect(noId.id).toBe("");                                              // nothing to correlate to

  for (const junk of [null, undefined, [], "data.get", 7]) {
    const res = await bridge.resolve(junk, CTX);
    expect(res.ok).toBe(false);
  }

  // The privileged door narrows with its own guard rather than trusting the
  // port: a runtime that sent nonsense is refused exactly as a section is.
  const badRuntime = await bridge.runtime(req({ kind: "section.write", page: "notes" }), NOTES_CTX);
  expect(badRuntime.ok).toBe(false);
  expect(badRuntime.error.code).toBe(ERRORS.UNKNOWN_KIND);
});

test("an error from below arrives as a closed code and never as a message", async () => {
  const { ws, transport } = doubles({
    ws: { insertRow: async () => { throw Object.assign(new Error("no such table: /home/someone/vault/workspace.db jobs"), { code: "not_found" }); } },
  });
  const res = await makeBridge(ws, transport).resolve(req({ kind: "row.insert", name: "jobs", row: {} }), CTX);
  expect(res.ok).toBe(false);
  expect(res.error.code).toBe(ERRORS.NOT_FOUND);
  expect(res.error.message).not.toContain("/home");
});

test("an unrecognised code from below collapses to internal rather than leaking", async () => {
  const { ws, transport } = doubles({
    ws: { insertRow: async () => { throw Object.assign(new Error("boom"), { code: "E_SOMETHING" }); } },
  });
  const res = await makeBridge(ws, transport).resolve(req({ kind: "row.insert", name: "jobs", row: {} }), CTX);
  expect(res.error.code).toBe(ERRORS.INTERNAL);
});

/* ── the cap ───────────────────────────────────────────────────────────── */

test("the in-flight cap answers `limit` instead of hanging, and frees up again", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { ws, transport } = doubles({ ws: { insertRow: async () => { await held; return 1; } } });
  const bridge = makeBridge(ws, transport);

  const flight = [];
  for (let i = 0; i < MAX_INFLIGHT; i++)
    flight.push(bridge.resolve(req({ id: "c" + i, kind: "row.insert", name: "jobs", row: {} }), CTX));

  const over = await bridge.resolve(req({ id: "over", kind: "row.insert", name: "jobs", row: {} }), CTX);
  expect(over.ok).toBe(false);
  expect(over.error.code).toBe(ERRORS.LIMIT);
  expect(over.error.retryable).toBe(true);         // a cap is the one failure worth retrying

  // A different mount is not held back by this one's runaway loop.
  const elsewhere = await bridge.resolve(req({ kind: "table.list" }), { page: "other" });
  expect(elsewhere.ok).toBe(true);

  release();
  await Promise.all(flight);
  expect((await bridge.resolve(req({ kind: "row.insert", name: "jobs", row: {} }), CTX)).ok).toBe(true);
});

test("THE TWO RINGS ARE COUNTED SEPARATELY, so a section in a loop cannot blind the runtime", async () => {
  // They share a box. A section spinning on the guest port would otherwise spend
  // the whole budget and the RUNTIME would stop being able to draw, which turns
  // one bad plugin into a blank page.
  let release;
  const held = new Promise((r) => { release = r; });
  const { ws, transport } = doubles({ ws: { insertRow: async () => { await held; return 1; } } });
  const bridge = makeBridge(ws, transport);

  const flight = [];
  for (let i = 0; i < MAX_INFLIGHT; i++)
    flight.push(bridge.resolve(req({ id: "c" + i, kind: "row.insert", name: "jobs", row: {} }), CTX));

  expect((await bridge.resolve(req({ id: "over", kind: "row.insert", name: "jobs", row: {} }), CTX)).error.code)
    .toBe(ERRORS.LIMIT);
  // Same box, same page, its own budget.
  expect((await bridge.runtime(req({ kind: "page.read", page: "job-board" }), CTX)).ok).toBe(true);

  release();
  await Promise.all(flight);
});

/* ── the frame ─────────────────────────────────────────────────────────────
 * Enough of a document to hold an iframe and no more. If this ever needs to
 * grow much, the thing to do is delete it — the property under test is one
 * line of frame.js and a fake DOM that outgrows it is testing itself.       */

function fakeDom() {
  const listeners = new Map();
  const made = [];
  globalThis.document = {
    createElement(tag) {
      const el = {
        tag,
        style: {},
        attrs: {},
        srcdoc: "",
        title: "",
        className: "",
        contentWindow: { postMessage() {} },
        setAttribute(k, v) { this.attrs[k] = v; },
        remove() { el.removed = true; },
        dispatchEvent() { return true; },
        removed: false,
      };
      made.push(el);
      return el;
    },
  };
  globalThis.window = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  return { made, listeners };
}

/** A box's half of the handshake. THE ORDER IS THE PROTOCOL: `ev.ports[0]` is
 *  the privileged runtime port and `ev.ports[1]` is the ordinary guest port, and
 *  there is no field naming them because a transfer list is positional and a
 *  name beside it could only ever contradict the position.
 *  @param {{ listeners: Map<string, Function> }} dom @param {{ el: any }} frame */
function sayHello(dom, frame) {
  const box = { taken: null, postMessage: (msg, _origin, ports) => { box.taken = { msg, ports }; } };
  frame.el.contentWindow = box;
  dom.listeners.get("message")({ source: box, data: { kind: "hello", g: PROTOCOL } });
  return { box, runtime: box.taken?.ports[0] ?? null, guest: box.taken?.ports[1] ?? null,
           msg: box.taken?.msg ?? null };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("a redraw with unchanged html hands back the same frame; changed html rebuilds it", async () => {
  const { made } = fakeDom();
  const { makeFrameHost, weave } = await import("../client/frame/frame.js");
  const host = makeFrameHost({ resolve: mock(async () => ({})), runtime: mock(async () => ({})) });
  host.setShim("/* shim */");

  const a = host.for("job-board", "<main>one</main>", CTX);
  const again = host.for("job-board", "<main>one</main>", CTX);
  expect(again).toBe(a);
  expect(again.el).toBe(a.el);
  expect(made.length).toBe(1);                     // the redraw created nothing

  const changed = host.for("job-board", "<main>two</main>", CTX);
  expect(changed.el).toBe(a.el);                   // the element survives; the realm does not
  expect(changed.el.srcdoc).toContain("two");
  expect(made.length).toBe(1);

  expect(a.el.attrs.sandbox).toBe("allow-scripts");   // and never allow-same-origin
  // NO `scrolling="no"`, and its absence is load-bearing: the box is the page's
  // viewport and the sections scroll inside it.
  expect(a.el.attrs.scrolling).toBe("auto");
  expect(a.el.style.height).toBe("100%");             // it always fills; there is no self-sizing mode
  expect(host.compliance("job-board")).toBe(null);    // nothing self-reported yet

  host.drop("job-board");
  expect(a.el.removed).toBe(true);
  expect(host.compliance("job-board")).toBe(null);

  // The shim goes ahead of the artifact's own markup, whatever shape it is in.
  // `INK` rides between the two — see the block below for what it is.
  expect(weave("S", "<!doctype html><html><head><title>x</title></head><body>b</body></html>"))
    .toContain("<head>" + INK + "<script>S</script><title>");
  expect(weave("S", "<main>bare</main>")).toContain("<head><meta charset=\"utf-8\">" + INK + "<script>S</script></head>");
  // The `<base>` goes BEFORE the shim: a base declared after a script has
  // already resolved a url is a base that arrived too late.
  expect(weave("S", "<main>bare</main>", "/v/x/asset/"))
    .toContain('<base href="/v/x/asset/">' + INK + "<script>S</script>");
  // The box's own `@font-face` rules ride between the base and the shim: after
  // the base so the base cannot rewrite their absolute urls, before the shim so
  // the first paint has them. Absent, nothing is written at all.
  expect(weave("S", "<main>bare</main>", "/v/x/asset/", "@font-face{f}"))
    .toContain('<base href="/v/x/asset/">' + INK + "<style>@font-face{f}</style><script>S</script>");
  expect(weave("S", "<main>bare</main>")).not.toContain("@font-face");
});

/** THE DOCUMENT'S OWN INK, as `weave()` writes it. Spelled here rather than
 *  imported, because the assertions below are what hold the string still — an
 *  import would let it change and take every expectation with it. */
const INK = "<style>@layer biom.ink{:root{color:var(--ink,CanvasText)}a{color:var(--cyan,LinkText)}}</style>";

/* ══ the default ink, for every box and not for the doc plugin's alone ═════
 *
 * The shim declares the palette on `:root` as custom properties and nothing
 * else, and a browser's default text colour is black — unreadable the moment a
 * workspace ships light ink on a dark board, which the shipped brand palette
 * does. `guest/plugins/doc/index.html` used to be the only place that said so,
 * so a `doc` page read correctly and nothing else in the same workspace did:
 * the design doc, whose box is woven with NO document at all, drew its title
 * and its whole shipped-default band in black on charcoal.
 */

test("every woven document takes the palette's ink, in a layer anything can beat", async () => {
  const { weave } = await import("../client/frame/frame.js");

  // EVERY DOCUMENT, whatever shape the author wrote it in and whether or not
  // there is a workspace to point a base at. The design doc's box is the bare
  // one — `weaveRuntime("")` — and it is covered by the same statement.
  for (const html of [
    "<!doctype html><html><head><title>x</title></head><body>b</body></html>",
    "<html><body>b</body></html>",
    "<main>bare</main>",
    "",
  ]) expect(weave("S", html)).toContain(INK);

  // IN A LAYER, which is what makes it a default and never a ceiling: an
  // unlayered author rule beats every layered one whatever its specificity, so
  // a section's `<style>`, a plugin document's stylesheet and a page somebody
  // wrote all win by existing.
  expect(INK).toContain("@layer biom.ink{");

  // FIRST, ahead of the document's own head, which is what keeps `biom.ink` the
  // lowest layer: `guest/plugins/doc/index.html` declares `@layer biom.scale,
  // biom.frame`, and a layer named later sorts after one named earlier.
  const woven = weave("S", "<!doctype html><html><head><style>html{color:blue}</style></head><body></body></html>");
  expect(woven.indexOf(INK)).toBeLessThan(woven.indexOf("html{color:blue}"));

  // IT NAMES NO COLOUR. `--ink` and `--cyan` are tokens, and `CanvasText` and
  // `LinkText` are the system's own, which is what paints in the moment before
  // `theme.get` answers.
  expect(/#[0-9a-fA-F]{3,8}\b/.test(INK)).toBe(false);
  expect(/\brgba?\(/.test(INK)).toBe(false);
});

// AND THE ONE DOCUMENT THE FRAMEWORK ITSELF WRITES IS COVERED BY THAT STATEMENT
// RATHER THAN BY A SECOND ONE.
//
// `MISSING_DOCUMENT` is what a page draws when it names a plugin that is not
// installed — a sentence and a way back, because a blank canvas offers nothing
// to act on. It carries an inline `font:` and no colour at all, which under the
// brand palette is the exact shape of the fault this layer was written for: the
// last version of this that named its own ink read black on charcoal.
//
// Measured in a real browser against a freshly seeded vault before this was
// written: the paragraph computes to `rgb(237, 230, 214)` — the brand's cream,
// `--ink` — on the charcoal ground, because `weave` reaches this document like
// every other. So the fix is NOT to give it a colour of its own. Two statements
// of one rule is one of them going stale, which is the argument
// `tests/doc-document.test.ts` already makes about the `doc` plugin; what is
// pinned here is that the document stays free of a colour and that weaving it
// really does hand it the layer.
test("the page that names a plugin nobody installed takes the vault's ink, not the browser's black", async () => {
  const { weave } = await import("../client/frame/frame.js");
  const { MISSING_DOCUMENT } = await import("../server/domain/pages.ts");

  // IT SAYS NOTHING ABOUT COLOUR. Not a literal, and not a token either — a
  // `color:` here would be the second statement of the rule above.
  expect(/#[0-9a-fA-F]{3,8}\b/.test(MISSING_DOCUMENT)).toBe(false);
  expect(/\b(rgba?|hsla?|oklch)\(/.test(MISSING_DOCUMENT)).toBe(false);
  expect(MISSING_DOCUMENT).not.toContain("color:");

  // It has no `<head>` and no `<html>`, so it takes `weave`'s third arm — the
  // one that builds a document around it. That arm is what was measured, and it
  // carries the ink.
  expect(/<head\b/i.test(MISSING_DOCUMENT)).toBe(false);
  expect(/<html\b/i.test(MISSING_DOCUMENT)).toBe(false);
  expect(weave("S", MISSING_DOCUMENT)).toContain(INK);
});

test("two ports are granted, and which one a message arrived on IS the authorisation", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const resolve = mock(async (r) => ({ id: r.id, g: PROTOCOL, ok: true, value: "guest" }));
  const runtime = mock(async (r) => ({ id: r.id, g: PROTOCOL, ok: true, value: "runtime" }));
  const host = makeFrameHost({ resolve, runtime });
  host.setShim("");

  const frame = host.for("k", "<main></main>", CTX);
  const hs = sayHello(dom, frame);

  expect(hs.runtime).not.toBe(null);
  expect(hs.guest).not.toBe(null);
  expect(hs.guest).not.toBe(hs.runtime);
  // WHICH PAGE travels WITH the ports, in the same message, because the
  // bootstrap publishes both together as `window.__g` and the runtime reads that
  // object once. A separate event carrying the same fact could disagree with it.
  expect(hs.msg).toEqual({ kind: "ports", g: PROTOCOL, page: CTX.page });

  const fromRuntime = [];
  const fromGuest = [];
  hs.runtime.onmessage = (ev) => fromRuntime.push(ev.data);
  hs.guest.onmessage = (ev) => fromGuest.push(ev.data);

  hs.runtime.postMessage({ id: "r1", g: PROTOCOL, kind: "data.get" });
  hs.guest.postMessage({ id: "g1", g: PROTOCOL, kind: "data.get" });
  await settle();

  // Nothing in frame.js inspects the message to decide what it may be: it hands
  // it to the bridge entry that port is wired to, and that entry narrows.
  expect(runtime).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(fromRuntime).toEqual([{ id: "r1", g: PROTOCOL, ok: true, value: "runtime" }]);
  expect(fromGuest).toEqual([{ id: "g1", g: PROTOCOL, ok: true, value: "guest" }]);

  // BOTH PORTS HEAR EVERY HOST EVENT. The asymmetry is entirely in what may be
  // SENT; a second asymmetry in what may be HEARD would give one side a stale
  // picture of the theme or of what moved underneath it.
  const event = { kind: "refresh", change: { kind: "page", id: "notes" } };
  host.broadcast(event);
  await settle();
  expect(fromRuntime.at(-1)).toEqual(event);
  expect(fromGuest.at(-1)).toEqual(event);
});

test("the section count is the RUNTIME's alone, and an unknown major is dropped in silence", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const resolve = mock(async () => ({ id: "n2", g: PROTOCOL, ok: true, value: null }));
  const host = makeFrameHost({ resolve, runtime: mock(async () => ({})) });
  host.setShim("");

  const frame = host.for("k", "<main></main>", CTX);

  // Stand in for the guest half of the handshake. It is in two parts: `hello`
  // goes over window.postMessage before the DOM exists and buys the ports, and
  // `ready` follows over the PRIVILEGED one once the runtime has drawn. A
  // handshake that waited for the DOM would deadlock any module script holding
  // a top-level await, because such a script is exactly what delays the event.
  const hs = sayHello(dom, frame);
  expect(host.compliance("k")).toBe(null);              // nothing counted yet

  const answers = [];
  hs.guest.onmessage = (ev) => answers.push(ev.data);

  // A `ready` on the GUEST port is a section claiming to be the runtime.
  hs.guest.postMessage({ kind: "ready", g: PROTOCOL, sections: 99 });
  await settle();
  expect(host.compliance("k")).toBe(null);

  hs.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 3 });
  await settle();
  // Self-reported; there is nothing to scrape. The host cannot read inside a
  // null-origin frame, so this number is what the page says about itself.
  expect(host.compliance("k")).toEqual({ sections: 3 });

  hs.guest.postMessage({ id: "n1", g: 99, kind: "data.get" });   // a major this host has never met
  hs.guest.postMessage({ g: PROTOCOL, kind: "data.get" });       // nothing to correlate an answer to
  hs.guest.postMessage("not a message");
  await settle();
  expect(resolve).not.toHaveBeenCalled();
  expect(answers).toEqual([]);

  hs.guest.postMessage({ id: "n2", g: PROTOCOL, kind: "data.get" });
  await settle();
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(answers).toEqual([{ id: "n2", g: PROTOCOL, ok: true, value: null }]);

  // A second hello revokes both ports and grants a new pair, so a realm that
  // announced late — after its own frame was rebuilt under it — cannot walk off
  // with the channel the live realm needs.
  const second = sayHello(dom, frame);
  expect(second.runtime).not.toBe(null);
  expect(second.runtime).not.toBe(hs.runtime);
  expect(second.guest).not.toBe(hs.guest);

  // Re-granting clears the old realm's section count rather than carrying it
  // over. The number describes a document, and this is a different document — a
  // stale count would report compliance for markup no longer on screen.
  expect(host.compliance("k")).toBe(null);

  second.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 9 });
  await settle();
  expect(host.compliance("k")).toEqual({ sections: 9 });

  // Zero is a real answer and means an empty page, not a failure.
  const third = sayHello(dom, frame);
  third.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 0 });
  await settle();
  expect(host.compliance("k")).toEqual({ sections: 0 });
});

/* ══ a redraw keeps the reader's place ════════════════════════════════════
 *
 * The box scrolls inside itself and the host cannot read where to, so the
 * shim reports it as a `position` notice and the mount — which outlives the
 * realm a redraw tears down — keeps the latest. The shell says `keep` before
 * it reloads; the new realm's `ready` is when the place is handed back as a
 * `place` event, once, and the box clamps it to its new run. Said by nothing
 * but a redraw, so a page navigated to still starts at the top.
 */

test("a redraw puts the new realm where the old one was scrolled to, once, and only when asked", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const host = makeFrameHost({ resolve: mock(async () => ({})), runtime: mock(async () => ({})) });
  host.setShim("");

  const frame = host.for("k", "<main></main>", CTX);
  /** Every notice the shell would hear as a DOM event off this box. */
  const notices = [];
  frame.el.dispatchEvent = (ev) => { notices.push(ev.detail); return true; };
  const first = sayHello(dom, frame);
  /** @param {{ runtime: any, guest: any }} hs */
  const hear = (hs) => {
    const heard = { runtime: [], guest: [] };
    hs.runtime.onmessage = (ev) => heard.runtime.push(ev.data);
    hs.guest.onmessage = (ev) => heard.guest.push(ev.data);
    return heard;
  };
  hear(first);

  // The latest position is what is kept, and it arrives on the ordinary port —
  // the shim holds that one, and the runtime's `ready` is the only notice
  // that insists on the privileged port.
  first.guest.postMessage({ kind: "position", g: PROTOCOL, top: 120 });
  first.guest.postMessage({ kind: "position", g: PROTOCOL, top: 640 });
  await settle();

  // A REBUILD NOBODY ASKED TO KEEP — a navigation back to this page — starts
  // at the top: the new realm's `ready` earns no `place`.
  const second = sayHello(dom, frame);
  const quiet = hear(second);
  second.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 2 });
  await settle();
  expect(quiet.runtime.filter((m) => m.kind === "place")).toEqual([]);
  expect(quiet.guest.filter((m) => m.kind === "place")).toEqual([]);

  // THE REDRAW. `keep` is said while the realm that reported 640 is the one on
  // the mount; the re-hello revokes its ports, and the position survives that
  // — it is exactly the realm going away whose place is wanted.
  host.keep("k");
  const third = sayHello(dom, frame);
  const heard = hear(third);
  expect(heard.guest).toEqual([]);                         // nothing before `ready`
  third.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 2 });
  await settle();
  // Both ports hear it, like every host event; the shim acts on it and the
  // runtime ignores it. Pixels, unclamped: the box is the only side that can
  // measure the new run.
  expect(heard.guest.filter((m) => m.kind === "place")).toEqual([{ kind: "place", top: 640 }]);
  expect(heard.runtime.filter((m) => m.kind === "place")).toEqual([{ kind: "place", top: 640 }]);

  // ONCE. A second `ready` from the same realm — or a rebuild nobody asked to
  // keep — gets nothing: the place was spent on the redraw it was kept for.
  third.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 2 });
  await settle();
  expect(heard.guest.filter((m) => m.kind === "place")).toHaveLength(1);

  // A box that never reported a position has nothing to keep.
  const fresh = host.for("j", "<main></main>", CTX);
  host.keep("j");
  const hs = sayHello(dom, fresh);
  const nothing = hear(hs);
  hs.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 1 });
  await settle();
  expect(nothing.guest.filter((m) => m.kind === "place")).toEqual([]);

  // `keep` on a key with no mount is not an error; the shell may say it for a
  // page whose box has not been built yet.
  expect(() => host.keep("nowhere")).not.toThrow();
  // And a position is a notice for the host alone: the shell never hears it as
  // a DOM event, so a scroll does not repaint the strip — `ready` still does.
  expect(notices.filter((n) => n && n.kind === "position")).toEqual([]);
  expect(notices.filter((n) => n && n.kind === "ready").length).toBeGreaterThan(0);
});

/** The bridge half of `page.embed`, as the frame host sees it: a document for
 *  the page named. The frame host is what adds the ports. */
const embedding = async (r) => r.kind === "page.embed"
  ? ({ id: r.id, g: PROTOCOL, ok: true, value: { page: r.page, html: "<main data-target=\"" + r.page + "\"></main>" } })
  : ({ id: r.id, g: PROTOCOL, ok: true, value: "guest" });

/** Ask a realm's guest port to embed a page, and hand back what came with the
 *  answer: the value, and the two ports off its transfer list. */
async function embed(guestPort, page, id = "e") {
  // Only the answer with this id: a sticky theme may arrive on the port first.
  const got = new Promise((r) => { guestPort.onmessage = (ev) => { if (ev.data?.id === id) r({ data: ev.data, ports: ev.ports }); }; });
  guestPort.postMessage({ id, g: PROTOCOL, kind: "page.embed", page });
  const ev = await got;
  return { res: ev.data, runtime: ev.ports[0] ?? null, guest: ev.ports[1] ?? null };
}

test("page.embed answers with a woven document AND two ports for THAT page, wired like a box's", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const resolve = mock(embedding);
  const runtime = mock(async (r) => ({ id: r.id, g: PROTOCOL, ok: true, value: "runtime" }));
  const host = makeFrameHost({ resolve, runtime }, "http://h/v/x/assets/");
  host.setShim("/* shim */");
  host.broadcast({ kind: "theme", theme: { name: "sticky" } });

  const frame = host.for("k", "<main></main>", CTX);
  const hs = sayHello(dom, frame);
  const e = await embed(hs.guest, "notes");

  // The answer is correlated like any other and carries the token the box
  // will close the session with. The document is COMPLETE: the shim and the
  // base are woven in here, because the bridge answered the runtime layer only.
  expect(e.res.id).toBe("e");
  expect(e.res.ok).toBe(true);
  expect(e.res.value.page).toBe("notes");
  expect(e.res.value.embed).toMatch(/^e\d+$/);
  expect(e.res.value.html).toContain("/* shim */");
  expect(e.res.value.html).toContain('<base href="http://h/v/x/assets/">');
  expect(e.res.value.html).toContain('data-target="notes"');
  // PRIVILEGED FIRST, ORDINARY SECOND — the order the shim reads at a handshake.
  expect(e.runtime).not.toBe(null);
  expect(e.guest).not.toBe(null);
  expect(e.guest).not.toBe(e.runtime);

  // A realm born after the theme was set never heard it, same as a box. The
  // queued message is still in the port when the listener is attached.
  const heard = [];
  e.guest.onmessage = (ev) => heard.push(ev.data);
  await settle();
  expect(heard).toEqual([{ kind: "theme", theme: { name: "sticky" } }]);

  // What the nested runtime says arrives with the TARGET page as context, on
  // the ring its port selects — nothing about an embedded realm is narrower
  // than a box of its own, and nothing is wider.
  const fromRuntime = [];
  e.runtime.onmessage = (ev) => fromRuntime.push(ev.data);
  e.runtime.postMessage({ id: "r1", g: PROTOCOL, kind: "page.read", page: "notes" });
  e.guest.postMessage({ id: "g1", g: PROTOCOL, kind: "data.get" });
  await settle();
  expect(runtime).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "page.read" }), { page: "notes" });
  expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "data.get" }), { page: "notes" });
  expect(fromRuntime.filter((m) => "ok" in m)).toEqual([{ id: "r1", g: PROTOCOL, ok: true, value: "runtime" }]);
});

test("an embedded realm hears its own page's refresh and every broadcast, and its `ready` is not the box's", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const host = makeFrameHost({ resolve: mock(embedding), runtime: mock(async () => ({})) });
  host.setShim("");

  const frame = host.for("k", "<main></main>", CTX);
  const hs = sayHello(dom, frame);
  const e = await embed(hs.guest, "notes");
  const box = [];
  const nested = [];
  hs.guest.onmessage = (ev) => box.push(ev.data);
  e.guest.onmessage = (ev) => nested.push(ev.data);

  host.refresh({ page: "notes" });
  host.refresh({ page: CTX.page });
  host.broadcast({ kind: "theme", theme: {} });
  await settle();
  expect(nested.map((m) => m.kind + ":" + (m.change?.page ?? ""))).toEqual(["refresh:notes", "theme:"]);
  expect(box.map((m) => m.kind + ":" + (m.change?.page ?? ""))).toEqual(["refresh:" + CTX.page, "theme:"]);

  // The nested runtime drew four sections. That is ITS count: the strip shows
  // the box's, and the box has not said.
  e.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 4 });
  await settle();
  expect(host.compliance("k")).toBe(null);
  hs.runtime.postMessage({ kind: "ready", g: PROTOCOL, sections: 1 });
  await settle();
  expect(host.compliance("k")).toEqual({ sections: 1 });
});

test("an embedded session dies with `unembed`, and with the realm that opened it", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const resolve = mock(embedding);
  const host = makeFrameHost({ resolve, runtime: mock(async () => ({})) });
  host.setShim("");

  const frame = host.for("k", "<main></main>", CTX);
  const hs = sayHello(dom, frame);
  const first = await embed(hs.guest, "notes", "e1");

  // Let go by token: the ports are closed, and a question down them goes nowhere.
  hs.guest.postMessage({ kind: "unembed", g: PROTOCOL, embed: first.res.value.embed });
  await settle();
  const before = resolve.mock.calls.length;
  first.guest.postMessage({ id: "x", g: PROTOCOL, kind: "data.get" });
  await settle();
  expect(resolve.mock.calls.length).toBe(before);

  // A token that is not this realm's closes nothing, and does not throw.
  hs.guest.postMessage({ kind: "unembed", g: PROTOCOL, embed: "e999" });
  await settle();

  // The box's html changes, so its realm is replaced — and the session it
  // embedded has nobody left to relay for it, so it goes too.
  const second = await embed(hs.guest, "notes", "e2");
  host.for("k", "<main>two</main>", CTX);
  const again = resolve.mock.calls.length;
  second.guest.postMessage({ id: "y", g: PROTOCOL, kind: "data.get" });
  await settle();
  expect(resolve.mock.calls.length).toBe(again);
});

test("nesting is capped: a page that embeds itself stops at the depth limit with `limit`, before the bridge is asked", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const resolve = mock(embedding);
  const host = makeFrameHost({ resolve, runtime: mock(async () => ({})) });
  host.setShim("");

  const frame = host.for("k", "<main></main>", CTX);
  let port = sayHello(dom, frame).guest;
  let depth = 0;
  for (;;) {
    const e = await embed(port, CTX.page, "d" + depth);
    if (!e.res.ok) {
      expect(e.res.error.code).toBe(ERRORS.LIMIT);
      expect(e.runtime).toBe(null);
      break;
    }
    port = e.guest;
    depth += 1;
    expect(depth).toBeLessThan(10);
  }
  expect(depth).toBe(4);
  expect(resolve).toHaveBeenCalledTimes(4);
});

test("an answer that outlives its realm is dropped, never delivered to the one that replaced it", async () => {
  const dom = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");

  // A call the host has started and not finished. This is the whole window the
  // bug lives in: the artifact asked, the frame was rebuilt underneath it, and
  // the answer is still on its way back.
  let release;
  const held = new Promise((r) => { release = r; });
  const resolve = mock(async (req) => {
    await held;
    return { id: req.id, g: PROTOCOL, ok: true, value: "late" };
  });
  const host = makeFrameHost({ resolve, runtime: mock(async () => ({})) });
  host.setShim("");

  const frame = host.for("k", "<main>one</main>", CTX);
  const first = sayHello(dom, frame);

  first.guest.postMessage({ id: "c1", g: PROTOCOL, kind: "data.get" });
  await settle();
  expect(resolve).toHaveBeenCalledTimes(1);

  // The html changed, so the realm is gone and a new one loads in the same
  // element. Correlation ids restart with it — this realm's own first call is
  // "c1" too — so an answer posted to whatever port is current now is an answer
  // to a question this page never asked.
  host.for("k", "<main>two</main>", CTX);
  const second = sayHello(dom, frame);

  const answers = [];
  second.guest.onmessage = (ev) => answers.push(ev.data);

  release();
  await settle();
  expect(answers).toEqual([]);

  // And the live realm is not poisoned by the drop: its own calls still answer.
  release = undefined;
  second.guest.postMessage({ id: "c1", g: PROTOCOL, kind: "data.get" });
  await settle();
  expect(answers).toEqual([{ id: "c1", g: PROTOCOL, ok: true, value: "late" }]);
});

/* ── going somewhere ────────────────────────────────────────────────────── */

// THE ONLY REQUEST HERE THAT IS NOT ABOUT DATA. It exists because there was no
// way to make a drawing clickable, and that was a hole the moment a page could
// draw its own row: the built-in child row navigates through host code an
// artifact cannot reach, so replacing it with child.html silently LOST the
// click. A row you cannot follow is not a row.

const uiSpy = () => {
  const went = [];
  return { went, go: (view, id) => went.push(view + ":" + id) };
};

test("open navigates the host to a page, and to a table", async () => {
  const ui = uiSpy();
  const { ws, transport, store } = doubles();
  store.pages = [{ id: "notes", name: "Notes" }];
  const bridge = makeBridge(ws, transport, ui);

  const toPage = await bridge.resolve(req({ kind: "open", target: { kind: "page", id: "notes" } }), CTX);
  expect(toPage.ok).toBe(true);
  expect(ui.went).toEqual(["page:notes"]);

  const toTable = await bridge.resolve(req({ kind: "open", target: { kind: "table", id: "jobs" } }), CTX);
  expect(toTable.ok).toBe(true);
  expect(ui.went).toEqual(["page:notes", "table:jobs"]);
});

// ANOTHER PAGE, DRAWN. The bridge answers a DOCUMENT — the same one the page
// view would build for that page — and knows nothing about ports: minting them
// is the frame host's, which never sees this module's answer except to add the
// transfer list on the way out.
test("page.embed answers the target page's woven document, and not_found for a page that is not there", async () => {
  const { ws, transport, calls } = doubles();
  const bridge = makeBridge(ws, transport, uiSpy());

  const res = await bridge.resolve(req({ kind: "page.embed", page: "notes" }), CTX);
  expect(res.ok).toBe(true);
  expect(calls.some((c) => c.kind === "page.read" && c.page === "notes")).toBe(true);
  expect(res.value.page).toBe("notes");
  // The runtime is woven in and the page's own input is inlined ahead of it,
  // so the nested realm draws itself the way a box of its own would.
  expect(res.value.html).toContain("/guest/runtime/boot.js");
  expect(res.value.html).toContain("window.__gInput=");
  expect(res.value.html).toContain('"id":"notes"');

  const missing = await makeBridge(ws, {
    call: async (r) => ({ id: r.id, g: PROTOCOL, ok: false, error: { code: ERRORS.NOT_FOUND, message: "no", retryable: false } }),
  }, uiSpy()).resolve(req({ kind: "page.embed", page: "gone" }), CTX);
  expect(missing.ok).toBe(false);
  expect(missing.error.code).toBe(ERRORS.NOT_FOUND);
});

// A `[[wikilink]]` IS THE OTHER HALF OF `open`. A box has no page list, so what
// a link names is a question for the host — and the answer is shaped like what
// `open` takes, so following one is resolve-then-open with nothing in between.
test("link.resolve answers what a wikilink names, four ways, and refuses an ambiguous one", async () => {
  const { ws, transport, store } = doubles();
  store.pages = [
    { id: "home/Companies/Airtable", name: "Airtable" },
    { id: "home/Companies/Notion", name: "Notion" },
    { id: "home/Research/Notion", name: "Notion" },
  ];
  store.tables = [{ name: "contacts", kind: "basic", rows: 2 }];
  const bridge = makeBridge(ws, transport, uiSpy());
  const ask = async (target) =>
    (await bridge.resolve(req({ kind: "link.resolve", target }), CTX)).value;

  // 1. the id, exactly — what the mirror writes and what an import produces.
  expect(await ask("home/Companies/Airtable")).toEqual({ kind: "page", id: "home/Companies/Airtable" });
  // 2. the id, folded. An id KEEPS its case, so this is the one place a link
  //    typed in another spelling is allowed to find it.
  expect(await ask("HOME/companies/airtable")).toEqual({ kind: "page", id: "home/Companies/Airtable" });
  // 3. the id's tail. A vault's own links are written from the vault root, so
  //    the root page on the front of the id is exactly what nobody types.
  expect(await ask("Companies/Airtable")).toEqual({ kind: "page", id: "home/Companies/Airtable" });
  // 4. the page's name, which is what somebody reading the page can see.
  expect(await ask("airtable")).toEqual({ kind: "page", id: "home/Companies/Airtable" });
  // A table is named rather than pathed, and answers in the same shape.
  expect(await ask("contacts")).toEqual({ kind: "table", id: "contacts" });

  // AMBIGUOUS IS NO ANSWER. Two pages are called Notion; opening one of them at
  // random is worse than a link that visibly went nowhere.
  expect(await ask("Notion")).toBeNull();
  // And so is nothing at all.
  expect(await ask("nowhere-at-all")).toBeNull();
});

// THE DESIGN DOC IS THE ONE PAGE NO SNAPSHOT HOLDS. It lives at `design/`,
// outside `pages/`, so every search `resolveLink` makes walks past it and the
// tree check in `open` refuses it — which meant a page could not link to it at
// all. The seeded root has to: everything an agent generates in a workspace
// comes out of the design doc, so *go there first* is the first thing it says.
test("a page may link to the design doc, and following it opens the design view", async () => {
  const ui = uiSpy();
  const { ws, transport, store } = doubles();
  store.pages = [{ id: "notes", name: "Notes" }];
  store.tables = [];
  const bridge = makeBridge(ws, transport, ui);

  // Resolve first, then open — the two halves of following a `[[wikilink]]`,
  // with nothing in between, exactly as any other link is followed.
  const found = (await bridge.resolve(req({ kind: "link.resolve", target: "@design" }), CTX)).value;
  expect(found).toEqual({ kind: "page", id: "@design" });

  const went = await bridge.resolve(req({ kind: "open", target: found }), CTX);
  expect(went.ok).toBe(true);
  // ITS OWN VIEW rather than the page view: the design doc is a separate mount,
  // and an id carries nothing, because there is one design doc per workspace.
  expect(ui.went).toEqual(["design:"]);

  // EXACT AND NEVER FOLDED. The id is a reserved spelling rather than something
  // somebody typed while reading, and a page of their own called `design` is a
  // perfectly legal page that must keep answering for itself.
  expect((await bridge.resolve(req({ kind: "link.resolve", target: "design" }), CTX)).value).toBeNull();
});

test("the host decides: an id nothing holds is refused, not navigated to", async () => {
  // A blank screen is a worse answer than a no, and a page that could send you
  // anywhere by name could send you somewhere that is not there.
  const ui = uiSpy();
  const { ws, transport, store } = doubles();
  store.pages = [];
  store.tables = [];
  const res = await makeBridge(ws, transport, ui).resolve(
    req({ kind: "open", target: { kind: "page", id: "nowhere" } }), CTX);

  expect(res.ok).toBe(false);
  expect(res.error.code).toBe("not_found");
  expect(ui.went).toEqual([]);
});
