// SPDX-License-Identifier: AGPL-3.0-only
/* guest/biom.js — the guest half of the Biom contract, major 1.
 *
 * Host code, served by the host, inlined by the host ahead of everything else in
 * the box. Nothing in a workspace ships one, imports one or pins one — which is
 * the single most valuable versioning property in the design: shipping a new
 * host ships a new guest half to every page that already exists.
 *
 * IT IMPORTS NOTHING AND NOTHING IMPORTS IT. It is delivered as one self-
 * contained script into a frame with an opaque origin, so it could not have a
 * dependency even if one were wanted. The constants below are therefore
 * DUPLICATED FROM contracts/wire.js DELIBERATELY. That is the one duplication in
 * the framework, it is why wire.js is tiny, and the two must be kept in step.
 *
 * NO TYPE REACHES THIS FILE, and that is worth stating plainly because it looks
 * checked. `tsc` does read it — it will catch a syntax error or an implicit any
 * — but the file imports nothing, so there is no `HostEvent`, no `GuestNotice`
 * and no `Child` bound to anything in here. Every message name and every field
 * name below is a HAND-COPY of `contracts/types.ts` that only a reader can keep
 * true, and a wrong one compiles perfectly and simply never fires. Change one,
 * read the other.
 *
 * IT IS ALSO THE BOOTSTRAP, and that is new. The document in the box is the
 * SECTION RUNTIME'S, not an artifact's: the host builds a page that loads the
 * runtime, the plugins and the page's own sections, and this script runs in
 * front of all of it. So it does the handshake for the whole box — it says
 * hello, it catches the two ports the host transfers back, and it publishes them
 * as `window.__g` for the runtime to pick up. See "the handshake" at the bottom.
 *
 * TWO PORTS, AND ONLY ONE OF THEM IS THIS FILE'S. The runtime needs to read the
 * page and write its shape back; a section must never be able to. So the host
 * grants a privileged port speaking `RuntimeRequest` and an ordinary one
 * speaking `HostRequest`. THIS FILE KEEPS THE ORDINARY ONE and hands the other
 * straight on — everything below is the section-facing surface, and there is no
 * call in here that can restructure a page.
 *
 * SAY WHAT THAT SPLIT IS AND IS NOT. Inside this realm it is a CLOSURE, NOT A
 * BROWSER GUARANTEE: section code runs in the same realm as the runtime and
 * could reach into it. The wall the browser enforces is between THIS BOX AND THE
 * APP — no fetch, no cookies, no host DOM, and nothing out of here but the two
 * ports the host handed in — and that is the boundary protecting the files, the
 * server and every other page. Nothing in this repository may describe the
 * in-box split as a security boundary.
 *
 * What it does beyond wrapping postMessage:
 *   · correlates request ids and rejects on `ok: false` with the closed error
 *   · re-declares the palette, because custom properties do not cross a document
 *     boundary and `var(--ink)` is otherwise undefined in here
 *   · hydrates `data-g-part` text leaves from the page's variables, UNLESS the
 *     section runtime has claimed the slots for itself
 *
 * IT NEVER REPORTS A HEIGHT, and that is a mechanism rather than an omission.
 * There is one box per page, it fills the canvas and it scrolls inside itself.
 * If it sized itself to its content and the HOST page scrolled, the scroll
 * container would be outside the box: `animation-timeline: scroll()` would find
 * no scroller, `position: sticky` would never stick, `100vh` would be
 * meaningless and an `IntersectionObserver` would have no root. Filling is what
 * makes the box its own viewport, and being its own viewport is the whole reason
 * a section can drive a scroll effect. `GuestNotice` has no `size` for exactly
 * this reason — do not add one back.
 */
(() => {
  "use strict";

  /* ── duplicated from contracts/wire.js ─────────────────────────────────── */
  const PROTOCOL = 1;
  /** WHERE A SLOT IS. It was `data-g-slot` and it named a VARIABLE; a section
   *  holds `parts` now and this names one of them — the key the entry sits under
   *  in the section's own document. The spelling moved with the meaning. */
  const SLOT_ATTR = "data-g-part";
  const CALL_TIMEOUT = 15000;
  const MAX_INFLIGHT = 32;
  /** The closed enumeration, as far as the guest mints codes of its own. */
  const LIMIT = "limit";
  const INTERNAL = "internal";

  /** How long a slot waits after the last keystroke before it writes. */
  const SETTLE = 400;

  /* ── state ─────────────────────────────────────────────────────────────── */

  /** @type {MessagePort | null} */
  let port = null;
  /** @type {Map<string, {resolve: (v: any) => void, reject: (e: any) => void, timer: any}>} */
  const pending = new Map();
  /** Calls and notices made before the port arrived. Queued, never lost — an
   *  artifact whose top-level body calls biom.data() must work, or every
   *  generated page has to start with `await biom.ready` and Claude Code
   *  will forget half the time. @type {any[]} */
  const outbox = [];
  let seq = 0;

  /** Set by `claimSlots()`. THE SLOTS ON THIS PAGE BELONG TO SOMEBODY ELSE, so
   *  this shim must not write into them. It is the whole page and never one
   *  slot, because a half-claimed page is the state nobody can reason about. */
  let claimed = false;
  /** @type {((theme: any) => void)[]} */
  const themeListeners = [];
  /** @type {((change: any) => void)[]} */
  const refreshListeners = [];

  /** @type {any} */
  let lastTheme = null;

  /** WHICH PAGE THIS BOX IS, from the `ports` message that opened the channel.
   *
   *  There is no block beside it any more, and there is no `biom.block`.
   *  One box is one page: a section is not a mount, it is a div the runtime drew
   *  inside this one document, so "which block am I" has no answer the host
   *  could give and no question it would answer. A plugin that needs to know
   *  which section it is in is told by the runtime that mounted it.
   *
   *  Null until the host answers, so read it after `ready`.
   *  @type {string | null} */
  let mountedPage = null;
  /** @type {(v: any) => void} */
  let resolveReady = () => {};
  const ready = new Promise((r) => { resolveReady = r; });

  /** A contract whose failure mode is "it throws something" is not a contract.
   *  `instanceof BiomError` works, `err.code` is one of the closed set, and
   *  `err.retryable` drives retry rather than copy. */
  class BiomError extends Error {
    /** @param {any} e */
    constructor(e) {
      super((e && e.message) || "biom error");
      this.name = "BiomError";
      this.code = (e && e.code) || INTERNAL;
      this.retryable = !!(e && e.retryable);
    }
  }

  /* ── the wire ──────────────────────────────────────────────────────────── */

  /** @param {any} m */
  const post = (m) => { if (port) port.postMessage(m); else outbox.push(m); };

  /**
   * @param {string} kind
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<any>}
   */
  function call(kind, params) {
    // The host caps in flight too, and its cap is the real one. This one saves a
    // round trip and fails an obvious loop where it started.
    if (pending.size >= MAX_INFLIGHT)
      return Promise.reject(new BiomError({ code: LIMIT, message: "too many calls in flight", retryable: true }));

    const id = "a" + ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // There is no `timeout` code in the closed enumeration. `limit` is the
        // closest and, unlike `internal`, it agrees with the host about being
        // retryable — a code that means one thing on each side is worse than a
        // loose one that means the same thing on both.
        reject(new BiomError({ code: LIMIT, message: "the host did not answer in time", retryable: true }));
      }, CALL_TIMEOUT);
      pending.set(id, { resolve, reject, timer });
      post(Object.assign({ id: id, g: PROTOCOL, kind: kind }, params));
    });
  }

  /** @param {MessageEvent} ev */
  function onPortMessage(ev) {
    /** @type {any} */
    const m = ev.data;
    if (!m || typeof m !== "object") return;

    if (typeof m.id === "string" && "ok" in m) {
      if (m.g !== PROTOCOL) return;              // an unknown major is dropped, not answered
      const rec = pending.get(m.id);
      if (!rec) return;                          // a late answer to a call we gave up on
      pending.delete(m.id);
      clearTimeout(rec.timer);
      // AN ANSWER MAY CARRY PORTS. They are in the message's transfer list, not
      // in its data, so they are handed on beside the value as `ports` — today
      // only `page.embed` answers this way, with the two the host minted for
      // the page it named.
      if (m.ok) rec.resolve(ev.ports && ev.ports.length ? Object.assign({}, m.value, { ports: Array.prototype.slice.call(ev.ports) }) : m.value);
      else rec.reject(new BiomError(m.error));
      return;
    }

    if (m.kind === "theme") applyTheme(m.theme);
    else if (m.kind === "refresh") void onRefresh(m.change || {});
  }

  /** Something this page draws from moved underneath it — a section added or
   *  reordered, a row edited in the grid, an agent rewriting the document, A
   *  CHILD ADDED OR REMOVED. The host cannot see what this box drew, so it says
   *  what moved and the page decides.
   *
   *  The page's variables are re-read here rather than by the page, so a page
   *  that merely MARKS its slots stays current for nothing — the same bargain
   *  edit mode makes. A page that draws from a table has to redraw itself and
   *  registers onRefresh to do it. The SECTIONS are the runtime's to re-fill,
   *  and it takes the same event over its own port.
   *
   *  A CHILD LIST IS NOT RE-READ FOR YOU, and cannot be: the shim never learns
   *  whether this page asked for its children, let alone what it drew with them.
   *  `change.shape` is the signal — a child added or removed IS an entry added
   *  to or removed from this page's `contents`, so the shape flag already says
   *  it and no new field is needed. A page that draws its own children re-reads
   *  `biom.children()` from onRefresh; the listeners below fire on every
   *  refresh, whatever moved, so nothing has to be inferred from the flags to
   *  stay current.
   *  @param {any} change */
  async function onRefresh(change) {
    if (change.page !== undefined || change.shape) {
      try { hydrate(await call("data.get")); } catch (e) { report(e); }
    }
    for (const fn of refreshListeners.slice()) safely(fn, change);
  }

  /** @param {any} e */
  const report = (e) => {
    try {
      post({ kind: "error", message: String((e && e.message) || e), stack: e && e.stack ? String(e.stack) : undefined });
    } catch { /* the frame is going away; there is nowhere left to say so */ }
  };

  /** @param {(v: any) => void} fn @param {any} v */
  const safely = (fn, v) => { try { fn(v); } catch (e) { report(e); } };

  /* ── the palette, re-declared ──────────────────────────────────────────────
   * Custom properties inherit down a DOM tree and a frame is a different tree,
   * so nothing the host declared exists in here. The theme arrives as data and
   * the shim writes it onto :root, which is what makes `var(--ink)` free for a
   * generated page after all — and what keeps the promise true for exactly the
   * pages that matter most. Canvas and WebGL want the raw values instead, which
   * is why biom.theme() hands back the same object.                     */

  /** stockHi → --stock-hi, room2 → --room-2. Deterministic, so the host's token
   *  names and the frame's agree without either shipping a table.
   *  @param {string} name */
  const cssVar = (name) =>
    "--" + name.replace(/([A-Z])/g, "-$1").replace(/(\d+)/g, "-$1").toLowerCase();

  /** @param {any} theme */
  function applyTheme(theme) {
    if (!theme || typeof theme !== "object") return;
    lastTheme = theme;
    const root = document.documentElement;
    const palette = theme.palette || {};
    for (const key of Object.keys(palette.colors || {}))
      root.style.setProperty(cssVar(key), String(palette.colors[key]));
    for (const x of palette.extra || []) if (x && x.name) root.style.setProperty(cssVar(x.name), String(x.value));

    // This only sets the STACKS. The `@font-face` rules that make a family in
    // one of them real inside this opaque origin are woven into the document
    // head by the host (`client/theme/faces.js` through `frame.js`), because a
    // stylesheet on the host's origin is not this document's. A face the host
    // did not ship falls back to the generic at the end of its stack.
    const fonts = theme.fonts;
    if (fonts && fonts.roles) {
      for (const role of Object.keys(fonts.roles)) {
        const face = (fonts.available || []).find((/** @type {any} */ f) => f.name === fonts.roles[role]);
        if (face) root.style.setProperty("--" + role + "-face", face.stack);
      }
    }
    for (const fn of themeListeners) safely(fn, theme);
  }

  /* ── slots ─────────────────────────────────────────────────────────────── */

  const slotEls = () => Array.from(document.querySelectorAll("[" + SLOT_ATTR + "]"));

  /** A slot is a text leaf. An element with element children is a list container
   *  or a layout mistake; either way the default behaviour leaves it alone.
   *  @param {Element} el */
  const isLeaf = (el) => el.children.length === 0;

  /** The file carries a default and the variables win, so an edit survives a
   *  reload and a hand-edited content.yaml takes effect without regeneration.
   *  Nothing else does this: the host cannot reach into a null-origin document.
   *  @param {any} data */
  function hydrate(data) {
    // THE RUNTIME OWNS THE PAGE ONCE IT HAS CLAIMED IT. Without this gate, a
    // `refresh` delivered to
    // both ports walks every `data-g-part` region and writes the page's
    // VARIABLES into it — over the top of what the section runtime just filled
    // from its PARTS. Measured rather than reasoned about: a page variable
    // named `missing` landed in an empty slot named `missing`, and filled slots
    // escaped only by accident, because rendered markdown leaves element
    // children and `isLeaf` skips them. A plugin that wrote plain text would
    // not have been so lucky.
    //
    // It is checked HERE and not at the two call sites deliberately. A third
    // caller is the obvious way this comes back, and a gate on the function
    // cannot be forgotten by one.
    //
    // The section runtime claims the page at load, so on a real page this
    // returns on the first line and the loop below never runs. It is still here
    // because the shim must keep working in a box the runtime never booted in.
    if (claimed) return;
    if (!data || typeof data !== "object") return;
    for (const el of slotEls()) {
      const key = el.getAttribute(SLOT_ATTR);
      if (!key || !isLeaf(el) || !(key in data)) continue;
      const v = data[key];
      if (v === null || Array.isArray(v)) continue;  // a list slot is the page's own business
      const text = String(v);
      if (el.textContent !== text) el.textContent = text;
    }
  }

  /* ── no height, and no ResizeObserver ──────────────────────────────────────
   * There was a `measure()` here that posted `{ kind: "size", height }` on every
   * resize, because a box that sized itself to its content had to tell the host
   * how tall it had become.
   *
   * It is gone with the thing it served. There is one box per page now and it
   * FILLS the canvas: the scroll container is in here rather than out there,
   * which is what makes `scroll()` and `view()` timelines, `position: sticky`,
   * `100vh` and an `IntersectionObserver` root work at all inside a section. A
   * box that measured itself would put the scroller back outside and take every
   * one of those away. `GuestNotice` has no `size` and this file must never
   * post one.                                                                 */

  /* ── teardown ──────────────────────────────────────────────────────────── */

  function teardown() {
    for (const rec of pending.values()) {
      clearTimeout(rec.timer);
      rec.reject(new BiomError({ code: INTERNAL, message: "the page is closing", retryable: false }));
    }
    pending.clear();
    if (port) { port.close(); port = null; }
  }

  /* ── the surface ───────────────────────────────────────────────────────── */

  const api = {
    /** Resolves once the guest port is open, the palette is applied and the
     *  page's variables have been read. Waiting on it is optional: calls made
     *  before it are queued and sent the moment the port arrives. */
    get ready() { return ready; },

    /** THIS PAGE'S VARIABLES — the block of values at the top of its one
     *  document, in scope for every section and every slot on it.
     *
     *  IT USED TO MEAN THE BLOCK'S, and it stopped meaning that when the box
     *  stopped being the block. There was a frame per custom block, so the host
     *  knew which content a call came from and scoped the answer to it. There is
     *  one box per page now and this port is shared by every section in it, so
     *  the host cannot tell one caller from another and does not guess: it
     *  answers the one scope the whole box is unambiguously in.
     *
     *  A page's variables nest three deep — page, then section, then part, and
     *  the NEAREST one wins where `{{name}}` is resolved. A plugin that wants
     *  its own part's values reads them off the page the runtime already holds
     *  rather than asking here, because the runtime is the only thing on this
     *  side that knows where the plugin was mounted. */
    data: () => call("data.get"),
    /** Merges into THIS PAGE'S variables, which every section on the page can
     *  see. There is no narrower write on this port for the same reason there is
     *  no narrower read: a mount is a client-side fact and the host must never
     *  guess at one. The runtime has the addressed form and uses it on the other
     *  port. @param {Record<string, any>} patch */
    setData: (patch) => call("data.set", { patch }),

    // other pages, as prose
    /** @param {string} page */
    doc: (page) => call("doc.get", { page }),
    docs: () => call("doc.list"),

    /** ANOTHER PAGE'S VARIABLES. Reaching across a page boundary is a CALL and
     *  never a template: `{{name}}` stays inside one page so prose can be read
     *  without chasing it, and a page that depends on a page somebody else may
     *  rename fails here, visibly, instead of leaving a blank in a paragraph.
     *
     *  This is the local-first join — a page can read what another page knows
     *  and draw something richer than a table with it. Omit `page` for the page
     *  this artifact is mounted on.
     *  @param {string} [page] */
    variables: (page) => call("variables", page === undefined ? undefined : { page: page }),

    /** WHICH PAGE this box is. Null until the host has answered, so read it
     *  after `ready`.
     *
     *  There is no `biom.block` beside it any more. It named the mount, and
     *  a mount was a block: one frame per custom block, so a drawing could ask
     *  which of its page's children it stood for. One box is one page now — a
     *  section is a div in this same document — so there is nothing for the host
     *  to name. A plugin learns which section it is in from the runtime that
     *  mounted it, which is the only thing in here that knows. */
    get page() { return mountedPage; },

    /** WHAT THIS PAGE IS, for a page that draws itself.
     *
     *  A plugin is a page that reads a declared input, and this is where it
     *  reads it: `{ id, name, plugin, input }`, with `input` the page's own
     *  `input:` map exactly as it is written in `content.yaml`. The host has no
     *  opinion about what is in there and never validates it — a host that
     *  validated a plugin's configuration would have to know every plugin — so a
     *  page that is missing a key of its own says so itself, in words, where it
     *  is drawn.
     *
     *  It arrives with the document rather than over a port. The host builds the
     *  document for this page and inlines the answer in front of everything
     *  else, so it is here synchronously and a board does not have to draw an
     *  empty frame while it asks what it is. */
    get input() {
      const held = /** @type {any} */ (window).__gInput;
      return held && typeof held === "object" ? held : {};
    },

    /** LAYER ONE, from inside the box: everything this page HOLDS — its
     *  children, pages and tables alike, in the order the page's own `contents`
     *  puts them. Each one is `{ kind: "page" | "table", id, name }`, with
     *  `rows` on a table. THERE IS NO `pageKind`: there is one kind of page, so
     *  there is nothing left for it to have said.
     *
     *  THERE IS NO FOLDER either. Any page may have children, and a page that
     *  draws them is what a folder was. Asking is separate from drawing on
     *  purpose: the host reconciles a section for every child, and a page that
     *  wants to draw its children ITS OWN WAY reads this and draws it. That is
     *  what makes the built-in drawing replaceable rather than privileged — the
     *  replacement reads the same data through the same call.
     *
     *  Omit `page` for the page this box is mounted on.
     *  @param {string} [page] */
    children: (page) => call("children", page === undefined ? undefined : { page: page }),

    // tables. `table` answers { schema, rows, total }.
    /** @param {string} name @param {any} [query] */
    table: (name, query) => call("table.get", { name: name, query: query }),
    /** @param {string} name */
    schema: (name) => call("table.schema", { name: name }),
    tables: () => call("table.list"),
    /** @param {string} name @param {Record<string, any>} row */
    insert: (name, row) => call("row.insert", { name: name, row: row }),
    /** @param {string} name @param {number} row @param {Record<string, any>} patch */
    update: (name, row, patch) => call("row.update", { name: name, row: row, patch: patch }),
    /** @param {string} name @param {number} row */
    remove: (name, row) => call("row.remove", { name: name, row: row }),
    /** Prefer table/insert. A page written on sql is a page that has to be
     *  rewritten when ports arrive. @param {string} query @param {any[]} [params] */
    sql: (query, params) => call("sql", { query: query, params: params }),

    // the only way out. The frame's origin is opaque and connect-src is none, so
    // window.fetch cannot work in here even if a page tries.
    /** @param {string} url @param {any} [init] */
    fetch: (url, init) => call("fetch", { url: url, init: init }),

    /** The palette as data, for a canvas or a shader — WebGL cannot read a CSS
     *  custom property. The tokens are already declared; this is for raw values. */
    theme: () => call("theme.get"),

    /** WHICH FOLDER THIS WORKSPACE IS. Answers `{ path, name, seeded, history }`
     *  — `path` absolute, which is what somebody types after `cd` to reach the
     *  agent that edits these pages.
     *
     *  A PAGE MAY KNOW WHERE IT LIVES, because a person reading it has to be
     *  able to point an agent at it. A page that carried the folder in a
     *  variable instead would be carrying a fact that stops being true the day
     *  the workspace moves; this is read where it is drawn and cannot go stale.
     *
     *  IT TAKES NO ARGUMENT, and that is the whole of the restriction. The vault
     *  is an ADDRESS rather than a message, so this asks about the folder this
     *  box is already in and there is nothing with which to name another.
     *  Walking to a folder, opening one and making one stay the workspace UI's
     *  alone. */
    vault: () => call("vault.info"),

    /** GO SOMEWHERE — a page or a table. The only call here that is not about
     *  data: it asks the host to change what the person is looking at.
     *
     *  It takes what `children()` hands back, so a row that opens the thing it
     *  names is one line:
     *
     *      button.addEventListener("click", () => g.open(child));
     *
     *  MATCHING A CHILD TO THE SECTION THAT STANDS FOR IT — which is what a page
     *  drawing its own children has to do — goes through the key the host
     *  derives, and A PAGE'S KEY IS ITS LAST SEGMENT AND NOT ITS WHOLE ID:
     *
     *      const key = (c) => "@" + c.kind + "-" +
     *        (c.kind === "page" ? c.id.slice(c.id.lastIndexOf("/") + 1) : c.id);
     *
     *  That line used to read `"@" + c.kind + "-" + c.id` here, and it had never
     *  once worked for a page. A page id is a PATH — `home/team/notes` — so it
     *  built `@page-home/team/notes` while the host had written `@page-notes`,
     *  the match failed silently and the row drew blank. `childKey` in
     *  contracts/types.ts is the one true spelling; this is a hand-copy of it,
     *  because this file cannot import.
     *
     *  ANY drawing that stands for something must do this. A child row replaced
     *  by a custom one and left unclickable is a worse row than the built-in it
     *  replaced — following it is most of what it is for.
     *
     *  The host decides: an id nothing holds is refused rather than navigated
     *  to. @param {{kind: "page" | "table", id: string}} target */
    open: (target) => call("open", {
      // Narrowed to the two fields the wire wants. A Child carries a name and a
      // count as well, and sending the whole object would put whatever else it
      // grows next through the chokepoint by accident.
      target: target && { kind: target.kind, id: target.id },
    }),

    /** ANOTHER PAGE, DRAWN — the raw half. Answers `{ page, embed, html, ports }`:
     *  a complete document for an iframe's `srcdoc`, and the two ports the host
     *  minted for that page, privileged first. The nested frame's shim says
     *  `hello` to ITS parent, which is this realm and not the host, so whoever
     *  takes this must listen for that hello on `window` BEFORE assigning the
     *  srcdoc and answer it with `{ kind: "ports", g, page }` and the two ports
     *  transferred — which is exactly what `embedInto` does. Take this one only
     *  to do something `embedInto` does not.
     *  @param {string} page @returns {Promise<{page: string, embed: string, html: string, ports: MessagePort[]}>} */
    embed: (page) => call("page.embed", { page: page }),

    /** ANOTHER PAGE, DRAWN, IN THIS IFRAME. Asks the host for the page, puts
     *  its document in the frame, and relays the handshake the way the host
     *  does for a box: the nested realm's `hello` is matched by IDENTITY against
     *  this frame's window, answered once with the ports, and a second hello —
     *  the frame reloaded — is answered with a FRESH grant, because the ports
     *  already given died with the realm that held them.
     *
     *  The sandbox is inherited, so the nested page is as boxed as this one, and
     *  what it holds is two ports the host minted for that one page. It draws
     *  with its own runtime, edits through its own ports and hears its own
     *  refreshes; nothing about it is re-rendered from prose.
     *
     *  Resolves to a handle. `close()` when the frame is removed, or before it
     *  is reused for another page — a section script does that in `onTeardown`,
     *  because a doc page's runtime empties the section stack on every redraw
     *  and an iframe inside a section goes with it.
     *  @param {HTMLIFrameElement} iframe
     *  @param {string} page
     *  @returns {Promise<{page: string, close(): void}>} */
    embedInto: function (iframe, page) {
      /** @type {string | null} */
      let token = null;
      let live = true;
      let granted = false;

      /** @param {string} t */
      const letGo = (t) => post({ kind: "unembed", g: PROTOCOL, embed: t });

      return api.embed(page).then((grant) => {
        if (!live) { letGo(grant.embed); throw new BiomError({ code: LIMIT, message: "closed before the page arrived", retryable: false }); }
        token = grant.embed;
        /** @type {MessagePort[]} */
        let ports = grant.ports || [];

        /** @type {Array<(at: number) => void>} */
        const scrollListeners = [];

        /** @param {MessageEvent} ev */
        function onHello(ev) {
          if (!live || ev.source !== iframe.contentWindow) return;
          const d = /** @type {any} */ (ev.data);
          if (!d || d.g !== PROTOCOL) return;
          // WHERE THE NESTED PAGE IS SCROLLED TO, as a fraction of its own run.
          // It says so only because it was told it is embedded; a box of its own
          // never reports this, because nobody is listening.
          if (d.kind === "scrolled") {
            if (typeof d.at === "number") for (const fn of scrollListeners.slice()) safely(fn, d.at);
            return;
          }
          if (d.kind !== "hello") return;
          /** @param {MessagePort[]} ps */
          const answer = (ps) => {
            if (!ps || ps.length < 2 || !iframe.contentWindow) return;
            iframe.contentWindow.postMessage({ kind: "ports", g: PROTOCOL, page: grant.page, embedded: true }, "*", ps);
          };
          if (!granted) { granted = true; answer(ports); ports = []; return; }
          // The realm reloaded. What it had is gone with it; ask for a fresh pair.
          if (token !== null) letGo(token);
          token = null;
          api.embed(page).then((again) => {
            if (!live) { letGo(again.embed); return; }
            token = again.embed;
            answer(again.ports || []);
          }, report);
        }
        window.addEventListener("message", onHello);

        // No allow-same-origin here either — inherited anyway, written so a
        // reader sees it. Assigning srcdoc navigates the frame, which is what
        // makes it say hello.
        iframe.setAttribute("sandbox", "allow-scripts");
        iframe.srcdoc = grant.html;

        return {
          page: grant.page,
          /** Hear where the nested page scrolls to — a fraction of its run, 0
           *  at the top and 1 at the bottom — so two pages can be kept level
           *  by proportion, whatever their lengths. @param {(at: number) => void} fn */
          onScroll: function (fn) {
            scrollListeners.push(fn);
            return () => { const i = scrollListeners.indexOf(fn); if (i >= 0) scrollListeners.splice(i, 1); };
          },
          /** Put the nested page at a fraction of its run. The page it lands on
           *  does not report that scroll back, so two pages following each
           *  other cannot chase. @param {number} at */
          scrollTo: function (at) {
            if (!live || !iframe.contentWindow) return;
            iframe.contentWindow.postMessage({ kind: "scroll", g: PROTOCOL, at: Math.min(1, Math.max(0, Number(at) || 0)) }, "*");
          },
          close: function () {
            if (!live) return;
            live = false;
            window.removeEventListener("message", onHello);
            if (token !== null) letGo(token);
            token = null;
            iframe.removeAttribute("srcdoc");
          },
        };
      });
    },

    /** THE SLOTS ON THIS PAGE ARE MINE — say so, and this shim stops writing
     *  into `data-g-part` regions altogether.
     *
     *  The section runtime fills every slot from the page's `parts` and saves an
     *  edit with `section.write`; left unclaimed, this shim hydrates the same
     *  regions from the page's VARIABLES. Two writers on one element is the one
     *  state nobody can reason about, and this is how the second one stands
     *  down. It is the whole page and never one slot, for the same reason.
     *
     *  A plugin has no reason to call it. It exists for the runtime that draws
     *  the page, and there is one of those. */
    claimSlots() {
      claimed = true;
    },

    /** Called when something this page draws from moved: a content reordered,
     *  a row changed in the grid or by another artifact, a document rewritten by
     *  the agent, a child added to or removed from this page. Text slots are
     *  re-hydrated for you before this fires — take this only if the page draws
     *  from a table, from another page or from `children()`, and redraw from a
     *  fresh read rather than from what you cached at boot. It fires on every
     *  refresh, so a page that redraws unconditionally is correct; the flags on
     *  `change` are there to let an expensive redraw skip.
     *  @param {(change: any) => void} fn */
    onRefresh(fn) {
      refreshListeners.push(fn);
      return () => { const i = refreshListeners.indexOf(fn); if (i >= 0) refreshListeners.splice(i, 1); };
    },

    /** @param {(theme: any) => void} fn */
    onTheme(fn) {
      themeListeners.push(fn);
      if (lastTheme) safely(fn, lastTheme);
      return () => { const i = themeListeners.indexOf(fn); if (i >= 0) themeListeners.splice(i, 1); };
    },

    /** Assignable, stored, and NEVER CALLED — say so rather than let a reader
     *  assume otherwise. The workspace's Architecture page requires a markdown projection of every
     *  artifact, but this contract has no host→guest request: HostEvent is
     *  fire-and-forget and GuestNotice carries no projection. Until one of the
     *  two exists, a page that follows the house rule and assigns this is simply
     *  not broken by doing so. @type {null | (() => string)} */
    toMarkdown: null,
  };

  // Non-writable and non-configurable, so a page cannot replace the shim with
  // its own object. The object itself is left extensible: `biom.toMarkdown
  // = fn` is the house rule, and an assignment that threw would break every page
  // written to it. There is nothing to protect inside one artifact's own realm.
  Object.defineProperty(window, "biom", { value: api, writable: false, configurable: false });

  /* ── the handshake, and the two ports ──────────────────────────
   *
   * IT IS IN TWO HALVES AND THE SPLIT IS LOAD-BEARING.
   *
   * `hello` goes out the instant this script runs — it is inlined ahead of
   * everything else in the box, so this happens before the runtime, before any
   * plugin and before any section script. Its only job is to ask for the ports.
   *
   * It must NOT wait for DOMContentLoaded. A `<script type="module">` is
   * deferred, and DOMContentLoaded fires only after deferred scripts finish, so
   * a handshake that waited for that event would be waiting on the very script
   * that is waiting on the ports. The page would stall for the call timeout and
   * then render nothing, with no error a person could act on — and a module
   * script with a top-level await is a completely ordinary thing to write.
   *
   * The host answers once, to this frame, with `ports` and TWO transferred
   * ports. THE ORDER IS THE PROTOCOL: `ev.ports[0]` speaks `RuntimeRequest` and
   * `ev.ports[1]` speaks `HostRequest`. There is no field naming them, because a
   * transfer list is positional and a name beside it could only ever contradict
   * the position.
   *
   * `ready` IS NOT SENT FROM HERE, and this is the second half that moved. It
   * used to carry a slot count this file could see by querying the document. It
   * carries the number of SECTIONS now, and this script draws none of them — the
   * runtime does, so the runtime says so, over the privileged port, once it has
   * actually drawn them.                                                       */

  /** THE HAND-OFF TO THE RUNTIME, and the whole of it.
   *
   * The runtime is a classic script in this same document. It cannot import and
   * neither can this file — a module script will not even load at an opaque
   * origin — so a shared global is the only channel there is between them. This
   * object is that channel, and it is exactly three fields:
   *
   *     window.__g = { runtime: MessagePort, guest: MessagePort, page: PageId }
   *
   * The runtime reads it once and DELETES it, which is what keeps a section
   * script that loads later from finding the privileged port lying about.
   * Deleting is the runtime's to do and never this file's: by then this file has
   * taken the guest port into a closure and holds nothing that can go missing.
   *
   * IT IS A CLOSURE, NOT A GUARANTEE. A script that runs between the assignment
   * and the delete can read it, and after the delete a section still shares a
   * realm with the runtime and could reach into it anyway. The wall the browser
   * enforces is around this whole box — no fetch, no cookies, no host DOM. Do
   * not describe the split inside it as a security boundary anywhere.
   *
   * IT ARRIVES ASYNCHRONOUSLY, and anything reading it has to cope. The ports
   * come back in a message, so `window.__g` is undefined for at least one task
   * after this script executes: a runtime that reads it at the top of its own
   * body finds nothing there. Handling that is the runtime's, and it is written
   * down here because this is the file that decides when the object appears.
   * @param {MessagePort} runtime @param {MessagePort} guest @param {string | null} page */
  function publish(runtime, guest, page) {
    /** @type {any} */ (window).__g = { runtime: runtime, guest: guest, page: page };
  }

  // An embed grant never arrives here: it rides the answer to `page.embed` on
  // the port, so the only `ports` this window ever hears is its own from the
  // host — and a nested frame's is posted at THAT frame's window, not this one.
  window.addEventListener("message", function onPorts(ev) {
    /** @type {any} */
    const m = ev.data;
    if (!m || m.kind !== "ports" || m.g !== PROTOCOL) return;
    // Both, or neither. A grant that arrived half-transferred is a grant this
    // box cannot honour, and taking one port from it would leave the runtime
    // waiting on a channel that is never coming.
    if (!ev.ports || ev.ports.length < 2 || !ev.ports[0] || !ev.ports[1]) return;
    window.removeEventListener("message", onPorts);

    // WHICH PAGE comes with the ports rather than as an event of its own, so
    // there is one statement of it and `window.__g.page` cannot disagree with
    // `biom.page`.
    mountedPage = typeof m.page === "string" ? m.page : null;
    publish(ev.ports[0], ev.ports[1], mountedPage);
    if (m.embedded === true) follow();

    // The ordinary one, and the only one this file ever touches.
    port = ev.ports[1];
    port.onmessage = onPortMessage;
    for (const q of outbox.splice(0)) port.postMessage(q);
    void start();
  });

  async function start() {
    try { applyTheme(await call("theme.get")); } catch (e) { report(e); }
    try { hydrate(await call("data.get")); } catch (e) { report(e); }
    resolveReady(api);
  }

  /* AN EMBEDDED REALM SAYS WHERE IT IS SCROLLED TO, and goes where it is put.
     Both travel over `window` to and from the parent — the box that embedded
     this page — as a fraction of the run, so pages of different lengths can be
     held level. A position put here is not reported back: the scroll it causes
     is recognised and swallowed, which is what stops two pages following each
     other from chasing. Only a realm told it is embedded does any of this; a
     box of its own has a host for a parent and the host is not listening. */
  function follow() {
    const doc = document.scrollingElement || document.documentElement;
    /** @type {number | null} */
    let placed = null;
    const run = () => Math.max(0, doc.scrollHeight - doc.clientHeight);
    window.addEventListener("scroll", () => {
      if (placed !== null) {
        if (Math.abs(doc.scrollTop - placed) < 2) { placed = null; return; }
        placed = null;
      }
      const r = run();
      window.parent.postMessage({ kind: "scrolled", g: PROTOCOL, at: r > 0 ? doc.scrollTop / r : 0 }, "*");
    }, { passive: true });
    window.addEventListener("message", (ev) => {
      if (ev.source !== window.parent) return;
      /** @type {any} */
      const m = ev.data;
      if (!m || m.kind !== "scroll" || m.g !== PROTOCOL || typeof m.at !== "number") return;
      const to = Math.round(m.at * run());
      if (Math.abs(doc.scrollTop - to) < 2) return;
      placed = to;
      // INSTANT, whatever the page's own `scroll-behavior` says. A page that
      // smooths its scrolling would otherwise ease into every position it is
      // put at and sit a beat behind the page being scrolled.
      window.scrollTo({ top: to, left: doc.scrollLeft, behavior: "instant" });
    });
  }

  function hello() {
    // "*" is required and is safe: a sandboxed frame has no origin to target,
    // and the host checks object identity against the frame it created.
    window.parent.postMessage({ kind: "hello", g: PROTOCOL }, "*");
  }

  window.addEventListener("error", (e) => report(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => report(e.reason));
  window.addEventListener("pagehide", teardown);

  hello();
})();
