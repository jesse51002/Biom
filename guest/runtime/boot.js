// SPDX-License-Identifier: AGPL-3.0-only
/* guest/runtime/boot.js — the entry. Takes the two ports, reads the page, draws
 * the stack, and says `ready`. A classic script sharing globals; see
 * registry.js for why there are no imports in here.
 *
 * WHAT THE DOCUMENT MUST LOAD, AND IN THIS ORDER. These are classic scripts and
 * order is the only sequencing there is:
 *
 *     <script>…the shim, inlined…</script>   posts `hello`, publishes `window.__g`
 *     <script src="/guest/runtime/registry.js">
 *     <script src="/guest/runtime/effects.js">
 *     <script src="/guest/runtime/sections.js">
 *     <script src="/guest/runtime/scale.js">
 *     <script src="/guest/runtime/project.js">  the markdown a doc page is
 *     <script src="/guest/runtime/boot.js">
 *     <script src="/guest/runtime/edit.js">  builds on `rt.page`, so it is after
 *     <script src="/v/<enc>/plugin/…">       the plugins — every one of them a
 *                                            file in THIS workspace's own
 *                                            `plugins/`, nothing shipped
 *
 * Nothing draws until BOTH the ports have arrived and the document has finished
 * parsing, so a plugin tag may sit anywhere after this file and still be
 * registered in time. Waiting for the parse is not politeness: a page whose
 * sections named a plugin that had not loaded yet would draw a stack of "no
 * plugin named …" messages and then never redraw.
 *
 * THE HANDSHAKE, and both halves of it are somebody else's:
 *
 *   1. the shim posts `{ kind: "hello", g: 1 }` to the parent the instant it runs
 *   2. the host answers `{ kind: "ports", g: 1, page }` with two transferred
 *      ports — privileged first, ordinary second, because a transfer list is
 *      positional and a field naming them could only ever contradict the order
 *   3. the shim publishes `window.__g = { runtime, guest, page }`
 *   4. THIS FILE reads that object once and deletes it immediately
 *   5. once it has drawn, it posts `{ kind: "ready", g: 1, sections: N }`
 *
 * `window.__g` arrives ASYNCHRONOUSLY — step 2 is a message, so the object is
 * undefined for at least one task after the shim runs, and this script has
 * usually finished loading before it lands. `take` below handles both the object
 * already being there and it turning up later. The host publishes it and never
 * deletes it; deleting it is ours.
 *
 * THERE IS NO EDIT MODE, AND THERE IS NO FLAG SAYING WHETHER EDITING IS ON. A
 * page is editable the moment it is on screen: the words take a caret, and every
 * section draws its own way to add a part and take one away. The answer to "is
 * this editable" was always yes, so the state that used to hold it only ever
 * bought a way to be wrong. Nothing is drawn OVER the page to say so — the
 * sections themselves have no handles, because their order is an agent's
 * business rather than a gesture's.
 *
 * THE PAGE'S SLOTS ARE STILL CLAIMED FROM THE SHIM AT LOAD, and that is not
 * optional. The shim hydrates every `data-g-part` region — the attribute this
 * runtime fills its slots through — from the page's VARIABLES, while this
 * runtime fills them from the page's PARTS and saves with `section.write`. Two
 * writers on one element is the one state nobody can reason about, so
 * `biom.claimSlots()` stands the shim down for the whole page. It is the
 * whole page and never a slot, because a half-claimed page is the same problem
 * with a smaller blast radius.
 *
 * THE RUNTIME PORT NEVER LEAVES THIS CLOSURE. It speaks `RuntimeRequest`:
 * `page.read`, `section.write`, `section.order`, `section.remove` and
 * `variables.patch`. A section that could call `section.order` could restructure
 * the workspace it was asked to decorate, so it is not given the means.
 *
 * SAY WHAT THAT IS AND IS NOT. Inside the box that separation is A CLOSURE, NOT
 * A BROWSER GUARANTEE: section code shares a realm with this file and could
 * interfere with it. The browser-enforced wall is between THE BOX AND THE APP —
 * no fetch, no cookies, no host DOM — and that is the boundary protecting the
 * files, the server and every other page. Nothing here is a security boundary.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /* ── duplicated from contracts/wire.js ───────────────────────────────────
   * The same deliberate duplication `guest/biom.js` carries, and for the
   * same reason: nothing served into the box can import, so layer 0 is copied
   * rather than reached. It is why wire.js is tiny, and the two must be kept in
   * step.                                                                    */
  const PROTOCOL = 1;
  const CALL_TIMEOUT = 15000;
  const MAX_INFLIGHT = 32;

  /* ── state ─────────────────────────────────────────────────────────────── */

  /** @type {MessagePort | null} */
  let runtimePort = null;
  /** @type {MessagePort | null} */
  let guestPort = null;
  /** @type {string} */
  let pageId = "";
  /** @type {HTMLElement | null} */
  let pageRoot = null;

  let parsed = document.readyState !== "loading";
  let started = false;
  /** Bumped on every draw. An answer to a `page.read` from a draw that has since
   *  been superseded is dropped rather than painted, because two refreshes
   *  arriving close together would otherwise race to fill one root. */
  let generation = 0;
  /** @type {(() => void)[]} */
  const drawListeners = [];
  /** @type {any[]} */
  let drawnSections = [];
  /** The page's own variables, kept because a slot's three scopes are merged
   *  from them and the edit wave has to reproduce that merge exactly when it
   *  re-renders one block of one part. @type {Record<string, any>} */
  let pageVariables = {};
  /** WHICH READER DREW THIS PAGE, and what it was handed. `doc` is the section
   *  stack; anything else drew its own document and reads `input` for whatever
   *  it declared. @type {string} */
  let pagePlugin = "doc";
  /** @type {Record<string, any>} */
  let pageInput = {};
  /** The page's own name, which its projection opens with. @type {string} */
  let pageName = "";
  /** HOW MANY OF OUR OWN WRITES ARE STILL IN THE AIR.
   *
   *  A `section.write` lands on disk, the server commits it and the change comes
   *  straight back as a `refresh` — which redraws the whole stack and takes the
   *  caret of the person who is still typing with it. `drawPage` says the
   *  narrowing belongs with the code that does the writing, and this is it:
   *  while a write of ours is outstanding, a refresh naming THIS page is the
   *  echo of that write and is dropped.
   *
   *  The cost is stated rather than hidden: a change to this page made somewhere
   *  else in the same half-second is dropped with it. In a local single-user
   *  instrument that is the right trade against throwing the caret away on every
   *  keystroke, and it is why the window is short. */
  let writesInFlight = 0;

  /* ── reporting ─────────────────────────────────────────────────────────── */

  /** Everything in the runtime reports through here, and the registry and the
   *  effects table look it up late for exactly that reason. A failure inside an
   *  opaque-origin box is otherwise a blank rectangle and no console line
   *  anybody outside can see, so it goes to the host as a notice as well.
   *  @param {string} message @param {unknown} [err] */
  function report(message, err) {
    const e = /** @type {any} */ (err);
    console.error("[biom] " + message, e || "");
    try {
      if (runtimePort)
        runtimePort.postMessage({
          kind: "error",
          message: message,
          stack: e && e.stack ? String(e.stack) : undefined,
        });
    } catch {
      /* the box is going away; there is nowhere left to say so */
    }
  }
  rt.report = report;

  /* ── the wire ──────────────────────────────────────────────────────────── */

  /**
   * One request/response correlator over one port.
   *
   * THE ID PREFIX IS NOT DECORATION. The guest port is SHARED: the shim wraps it
   * as `biom.*` and mints its own ids on it, and both listeners see every
   * message that arrives. Two correlators handing out the same id on one port
   * would each resolve the other's calls — the caller would be given the answer
   * to a question it never asked. Distinct prefixes are the whole remedy, and
   * they cost nothing because an id only has to be unique per port.
   *
   * @param {MessagePort} port @param {string} prefix
   */
  function correlator(port, prefix) {
    /** @type {Map<string, {resolve: (v: any) => void, reject: (e: any) => void, timer: any}>} */
    const pending = new Map();
    let seq = 0;

    /** @param {any} m @returns {boolean} true when this message was ours */
    function settle(m) {
      if (!m || typeof m !== "object" || typeof m.id !== "string" || !("ok" in m)) return false;
      const rec = pending.get(m.id);
      if (!rec) return false; // somebody else's call on a shared port, or one we gave up on
      if (m.g !== PROTOCOL) return false; // an unknown major is dropped, never answered
      pending.delete(m.id);
      clearTimeout(rec.timer);
      if (m.ok) rec.resolve(m.value);
      else rec.reject(new Error((m.error && m.error.message) || "the host refused the call"));
      return true;
    }

    /** @param {string} kind @param {Record<string, unknown>} [params] @returns {Promise<any>} */
    function call(kind, params) {
      // The host caps in flight too and its cap is the real one. This one saves
      // a round trip and fails an obvious loop where it started.
      if (pending.size >= MAX_INFLIGHT) return Promise.reject(new Error("too many calls in flight"));
      const id = prefix + ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("the host did not answer " + kind + " in time"));
        }, CALL_TIMEOUT);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        port.postMessage(Object.assign({ id: id, g: PROTOCOL, kind: kind }, params));
      });
    }

    function abandon() {
      for (const rec of pending.values()) {
        clearTimeout(rec.timer);
        rec.reject(new Error("the page is closing"));
      }
      pending.clear();
    }

    return { call: call, settle: settle, abandon: abandon };
  }

  /** @type {ReturnType<typeof correlator> | null} */
  let runtime = null;
  /** @type {ReturnType<typeof correlator> | null} */
  let guest = null;

  /** What every plugin, every page plugin and every section script is handed as
   *  `ctx.call`. It goes over the GUEST port, so it carries `HostRequest` and
   *  nothing wider — there is no path from a plugin to `section.write`.
   *  @param {string} kind @param {Record<string, unknown>} [params] */
  function guestCall(kind, params) {
    if (!guest) return Promise.reject(new Error("the page box has no port yet"));
    return guest.call(kind, params);
  }

  /* ── taking the ports ──────────────────────────────────────────────────── */

  /**
   * Read `window.__g` once, whenever it turns up, and delete it.
   *
   * Two arrivals are possible and both are ordinary. The ports come back on a
   * message, so usually this script has already loaded and the object appears
   * afterwards — an accessor is how an assignment is heard the moment it
   * happens, with no polling and no missed window. But the reply can also beat
   * the script over the network, in which case the object is simply there.
   *
   * @param {(g: any) => void} then
   */
  function take(then) {
    const now = glob.__g;
    if (now && now.runtime && now.guest) {
      delete glob.__g;
      then(now);
      return;
    }
    Object.defineProperty(glob, "__g", {
      configurable: true,
      get() {
        return undefined;
      },
      set(v) {
        // Delete first: this removes the accessor itself, so the object is gone
        // from the realm before a single line of section code has run.
        delete glob.__g;
        if (v && v.runtime && v.guest) then(v);
        else report("the handshake published no ports");
      },
    });
  }

  /* ── drawing ───────────────────────────────────────────────────────────── */

  /** Where the stack goes. The host's document may declare it; if it does not,
   *  one is made. THE DOCUMENT ITSELF IS THE SCROLLER and this is deliberately
   *  not a scroll container — the box fills the canvas, so `scroll()` timelines,
   *  `position: sticky`, `100vh` and an `IntersectionObserver` with a null root
   *  all resolve against the box, which is the whole reason a section can drive
   *  a scroll effect at all. A scrolling div in here would take that away.
   *  @returns {HTMLElement} */
  function root() {
    if (pageRoot && pageRoot.isConnected) return pageRoot;
    let el = document.getElementById("g-page");
    if (!el) {
      el = document.createElement("main");
      el.id = "g-page";
      document.body.appendChild(el);
    }
    pageRoot = /** @type {HTMLElement} */ (el);
    return pageRoot;
  }

  /** `page.read` answers a `Page`. An array is accepted as the degenerate form —
   *  sections and nothing else — so a server half that has not grown the page's
   *  own variables yet still draws.
   *  @param {any} answer */
  function normalise(answer) {
    const bare = { sections: [], variables: {}, markdown: {}, plugin: "html", input: {}, name: "" };
    if (Array.isArray(answer)) return { ...bare, sections: answer, plugin: "doc" };
    if (!answer || typeof answer !== "object") return bare;
    return {
      sections: Array.isArray(answer.sections) ? answer.sections : [],
      variables: answer.variables || {},
      markdown: answer.markdown || {},
      plugin: typeof answer.plugin === "string" ? answer.plugin : "html",
      input: answer.input && typeof answer.input === "object" ? answer.input : {},
      name: typeof answer.name === "string" ? answer.name : "",
    };
  }

  /** A page that is NOT a document: its own html, or a plugin's, already loaded
   *  into this box by the host. There is no stack of sections here and there is
   *  nothing to build — the markup IS the page — so all this does is the two
   *  things the markup cannot do for itself.
   *
   *  `{{name}}` is resolved against the page's variables AFTER the document has
   *  parsed, over text nodes and attribute values, keeping each node's template
   *  so a later redraw resolves from the template rather than from last time's
   *  value. It is done here rather than on the server because a variables patch
   *  would otherwise change the page's HTML, which would rebuild the box and
   *  restart whatever the page was doing.
   *
   *  Then every `data-g-part` slot is filled from the page's own top-level keys
   *  and handed to the edit wave, so the words in a hand-written page are as
   *  editable as the words in a document. The key IS the part: there is no
   *  section between them, which is what `section: null` means on the wire.
   *  @param {any} page @param {any} env */
  function drawDocument(page, env) {
    /** @type {Record<string, any>} */
    const parts = {};
    for (const key of Object.keys(page.input || {})) {
      const value = page.input[key];
      if (typeof value === "string") {
        parts[key] = { kind: "markdown", md: value, vars: page.variables };
      } else if (Array.isArray(value) && value.every((one) => typeof one === "string")) {
        parts[key] = {
          kind: "list",
          items: value.map((one) => ({ kind: "markdown", md: one, vars: page.variables })),
        };
      }
      // Anything else is this plugin's own configuration rather than words, and
      // is left for the plugin to read off `biom.input`.
    }

    interpolateTree(document.body, page.variables);

    const drawn = { name: PAGE_SLOTS, html: "", fallback: false, parts: parts, vars: page.variables };
    rt.sections.fillSlots(document.body, drawn, page.variables, env, PAGE_SLOTS);
    env.dress(document.body, drawn, page.variables);
  }

  /** The name a page's own slots are gathered under. It is not a section — there
   *  is no section — and it is spelled with the `@` that no section name may
   *  carry, so it can never collide with one. `rt.page.write` turns it back into
   *  the `null` the wire wants. */
  const PAGE_SLOTS = "@page";

  /** Resolve `{{name}}` in a document that is already parsed.
   *
   *  The template is kept per node so this is idempotent: resolving in place
   *  would replace `{{rate}}` with `62` and the next resolve would have nothing
   *  left to work with, so a variable that changed could never change back.
   *  @param {HTMLElement} root @param {Record<string, any>} vars */
  const templates = new WeakMap();
  /** @param {HTMLElement} root @param {Record<string, any>} vars */
  function interpolateTree(root, vars) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        // A script's or a style's text is code, and interpolating it would put a
        // value where a variable name was in somebody's source.
        if (parent && (parent.tagName === "SCRIPT" || parent.tagName === "STYLE")) continue;
        let template = templates.get(node);
        if (template === undefined) {
          template = node.nodeValue || "";
          if (template.indexOf("{{") < 0) continue;
          templates.set(node, template);
        }
        node.nodeValue = rt.sections.interpolate(template, vars);
        continue;
      }
      const el = /** @type {Element} */ (node);
      for (const attr of Array.from(el.attributes || [])) {
        if (attr.value.indexOf("{{") < 0 && !templates.has(attr)) continue;
        let template = templates.get(attr);
        if (template === undefined) {
          template = attr.value;
          templates.set(attr, template);
        }
        attr.value = rt.sections.interpolate(template, vars);
      }
    }
  }

  /** Read the page and draw the whole stack. Everything mounted before it comes
   *  down first — every `onTeardown` a section registered — because an
   *  `IntersectionObserver` left holding detached nodes keeps firing, and a page
   *  that is edited for ten minutes gets measurably slower without this. */
  async function drawPage() {
    const mine = ++generation;
    /** @type {any} */
    let answer;
    try {
      answer = await (runtime ? runtime.call("page.read", { page: pageId }) : Promise.reject(new Error("no port")));
    } catch (e) {
      report("the page could not be read: " + String((e && /** @type {Error} */ (e).message) || e), e);
      answer = null;
    }
    if (mine !== generation) return; // a later draw has already started

    const page = normalise(answer);
    rt.effects.disposeAll();

    // THE RUNTIME OWNS THE ROOT ONLY ON A DOCUMENT. A doc page's body is the
    // runtime's to build and to empty; every other page's body is the author's,
    // already parsed, and clearing it would delete the page in order to draw it
    // — which is exactly what happened the first time a board was asked to draw
    // itself. So the root is made and cleared for `doc`, and for anything else
    // the type scale goes on the document element and nothing is touched.
    const owns = page.plugin === "doc";
    const el = owns ? root() : document.documentElement;
    if (owns) el.textContent = "";

    const env = {
      page: pageId,
      root: /** @type {HTMLElement} */ (el),
      pageVars: page.variables,
      call: guestCall,
      /** Hand each section to the edit wave the moment its slots are filled and
       *  before its script runs. Guarded because the runtime is verified in a
       *  bare box with no edit wave in it. */
      dress: (/** @type {HTMLElement} */ el, /** @type {any} */ drawn, /** @type {any} */ vars) => {
        if (rt.edit && typeof rt.edit.dress === "function") rt.edit.dress(el, drawn, vars);
      },
    };

    drawnSections = page.sections;
    pageVariables = page.variables;
    pagePlugin = page.plugin;
    pageInput = page.input;
    pageName = page.name;
    if (rt.edit && typeof rt.edit.reset === "function") rt.edit.reset();
    // THE TYPE SCALE, before a section is drawn. It is inherited, so declaring
    // it on the root first means the first section is measured against the same
    // scale as the last — applying it after would reflow every region once.
    if (rt.scale) rt.scale.apply(el, page.markdown || {});

    // A PAGE THAT IS NOT A DOCUMENT DRAWS ITSELF. Its markup is already in this
    // box; there is no stack to build, so the branch is here and nowhere else.
    if (!owns) {
      try {
        drawDocument(page, env);
      } catch (e) {
        report("this page could not be drawn: " + String((e && /** @type {Error} */ (e).message) || e), e);
      }
      if (runtimePort) runtimePort.postMessage({ kind: "ready", g: PROTOCOL, sections: 0 });
      for (const fn of drawListeners.slice()) {
        try { fn(); } catch (e) { report("a draw listener threw", e); }
      }
      sendProjection();
      return;
    }

    for (const section of page.sections) {
      try {
        rt.sections.draw(section, env);
      } catch (e) {
        report(
          'section "' + String(section && section.name) + '" could not be drawn: ' +
            String((e && /** @type {Error} */ (e).message) || e),
          e,
        );
      }
    }
    // Zero is a real answer and means an empty page, not a failure.
    if (runtimePort) runtimePort.postMessage({ kind: "ready", g: PROTOCOL, sections: page.sections.length });

    // AFTER the stack is on screen, never before: the edit wave dresses nodes
    // that exist, and a listener that ran mid-draw would dress half a page and
    // silently miss the rest.
    for (const fn of drawListeners.slice()) {
      try {
        fn();
      } catch (e) {
        report("a draw listener threw", e);
      }
    }

    // AFTER the draw listeners, because the edit wave dresses the page in one of
    // them and a projection taken mid-dress would be of a half-built page.
    sendProjection();
  }

  /* ── host events ───────────────────────────────────────────────────────── */

  /** CLAIM THE PAGE'S SLOTS FROM THE SHIM, at load, before anything is drawn.
   *
   *  The shim makes every `data-g-part` region contenteditable and writes what
   *  is typed back through `data.set` — which fills those same regions from the
   *  page's variables. This runtime fills them from the page's `parts` and
   *  writes back through `section.write`. Both are correct on their own and
   *  together they are two writers on one node, so the claim stands the shim
   *  down for the whole page and the writing becomes this runtime's.
   *
   *  Guarded because the shim is a separate file and the runtime is verified in
   *  a bare box without it.
   *
   *  IT COVERS THE SHIM'S HYDRATE PASS, which is the half that used to be
   *  missed and was measured rather than reasoned about: the shim answered a
   *  `refresh` by reading the page's VARIABLES and writing them into any
   *  `data-g-part` element with no element children, and a page variable called
   *  `missing` landed in an empty slot called `missing`. A filled slot escaped
   *  only by accident, because rendered markdown leaves element children. The
   *  claim now gates hydrate as well, in the shim, where it belongs. */
  function claimSlots() {
    const g = glob.biom;
    if (!g || typeof g.claimSlots !== "function") return;
    try {
      g.claimSlots();
    } catch (e) {
      report("the page's slots could not be claimed from the shim", e);
    }
  }

  /** BOTH PORTS SEE EVERY HOST EVENT — the asymmetry between them is entirely in
   *  what may be SENT. The runtime acts on `refresh`, because re-reading the page
   *  and re-filling every slot is its job; the shim acts on `theme`, because
   *  re-declaring the palette is its.
   *  @param {any} m */
  function onEvent(m) {
    if (m.kind === "refresh") {
      const change = m.change || {};
      // A change to a table is a plugin's business — it registers
      // `biom.onRefresh` and redraws itself. A change to THIS PAGE is ours.
      //
      // This is a whole-stack redraw, and the edit wave will have to narrow it:
      // a debounced `section.write` while somebody is typing comes back as a
      // refresh, and redrawing the paragraph under the caret would take the
      // caret with it. The narrowing belongs with the code that does the
      // writing, which is why it is not guessed at here.
      // The echo of our own `section.write`, arriving while somebody is still
      // typing. Redrawing here would replace the paragraph under the caret with
      // an identical one and put the caret at the top of the page.
      if (writesInFlight > 0 && change.page === pageId && !change.shape) return;
      if (change.page === undefined || change.page === pageId || change.shape) void drawPage();
      return;
    }
  }

  /* ── the surface the edit wave builds on ───────────────────────────────── */

  /** THE FOUR PRIVILEGED KINDS, and the only place in the box they can be sent
   *  from. They are exposed on the runtime's own namespace rather than on
   *  `biom`, because `biom` is what a section is handed and a section
   *  must not be able to restructure the page it decorates.
   *
   *  That is a closure and not a browser guarantee — same realm, same globals —
   *  and it is written down here so nobody reads it as one. */
  /** THE PAGE'S OWN MARKDOWN, on its way to the archive copy in `_markdown/`.
   *
   *  Every page renders itself as markdown, and the page is the only thing that
   *  can: the box runs the page's code, so it is the only half that knows what a
   *  board or a hand-written document says in words — and it cannot write a file,
   *  so it says the words and the host writes them.
   *
   *  A doc page is projected by `rt.project.doc`, which is a hand copy of the
   *  server's own rule so the two cannot drift. Anything else answers with its
   *  `biom.toMarkdown`, if it set one, and with the document's visible text
   *  otherwise — which is a poor projection and an honest one, and is what a page
   *  that never thought about the archive should get rather than nothing.
   *
   *  It never throws and never rejects into the page: a projection that could not
   *  be stored is a stale archive file, not a page that failed to draw. */
  function projectionOf() {
    if (pagePlugin === "doc") {
      if (!rt.project || typeof rt.project.doc !== "function") return null;
      return rt.project.doc({
        name: pageName,
        sections: drawnSections,
        variables: pageVariables,
      });
    }
    const own = glob.biom && glob.biom.toMarkdown;
    if (typeof own === "function") return String(own());
    return document.body ? String(document.body.innerText || "") : "";
  }

  /** A PAGE THAT FILLS ITSELF LATER SAYS SO, and the runtime asks it again.
   *
   *  The projection is taken the moment a page has drawn, which is right for a
   *  document — its words arrived with it — and wrong for anything that fetches.
   *  A board asks for its rows over the port, so at the moment it "drew" it is an
   *  empty board, and the empty projection it reported went to disk and stayed
   *  there. Measured: three boards whose archive copy held nothing but a title.
   *
   *  So a page dispatches `biom:rendered` when its content settles and the
   *  runtime takes the projection again. It is a DOM event rather than a new
   *  wire kind because it never leaves the box — the page is telling the runtime
   *  it shares a document with, and the wire already has the kind that carries
   *  the answer out. Coalesced, because a board that redraws per row would
   *  otherwise write a file per row. */
  /** @type {any} */
  let projectionDue = 0;
  function projectSoon() {
    clearTimeout(projectionDue);
    projectionDue = setTimeout(() => sendProjection(), 120);
  }

  function sendProjection() {
    if (!runtime) return;
    /* A PAGE THE MIRROR REFUSES IS NOT ASKED, and the design doc is the one
       there is. `_markdown/` is a folder tree keyed by page id, `@` is outside a
       path segment's grammar, and the mirror refuses such an id BY NAME so that
       a caller which meant it hears about it. This runtime never means it — it
       projects every page it draws — so the refusal was a stack trace on the
       server and a console line in the box every time somebody opened Design.
       The reserved shape is spelled here rather than imported because there are
       no imports in the box, exactly as `childKey` is. */
    if (typeof pageId === "string" && pageId.charAt(0) === "@") return;
    let markdown;
    try {
      markdown = projectionOf();
    } catch (e) {
      report("this page's markdown could not be computed", e);
      return;
    }
    if (markdown === null) return;
    runtime.call("page.projection", { page: pageId, markdown: markdown }).catch((e) => {
      report("this page's markdown could not be stored: " + String((e && e.message) || e), e);
    });
  }

  /** Put a saved slot back into the drawn copy, so the projection that follows a
   *  write reflects what was written without re-reading the page.
   *  @param {string | null} section @param {string} part @param {any} data */
  function patchHeld(section, part, data) {
    const held = section === null
      ? null
      : drawnSections.find((/** @type {any} */ one) => String(one.name) === section);
    const parts = held ? held.parts : null;
    if (section === null) {
      pageInput = { ...pageInput, [part]: data };
      return;
    }
    if (!parts || !parts[part]) return;
    const was = parts[part];
    // A grid's rows, written whole: the held copy takes them so the projection
    // reads the table as it now is.
    if (Array.isArray(data) && data.length > 0 && data.every((row) => Array.isArray(row))) {
      if (was.kind !== "grid") return;
      was.rows = data.map((row) => /** @type {string[]} */ (row).map((cell) => String(cell)));
      return;
    }
    if (Array.isArray(data)) {
      if (was.kind !== "list") return;
      was.items = data.map((md, i) => ({
        kind: "markdown",
        md: md,
        vars: (was.items[i] && was.items[i].vars) || pageVariables,
      }));
      return;
    }
    if (was.kind === "markdown") was.md = String(data);
  }

  rt.page = {
    get id() {
      return pageId;
    },
    get root() {
      return root();
    },
    /** The `DrawnSection`s currently on screen, in order. */
    sections() {
      return drawnSections.slice();
    },
    /** The PAGE scope, the outermost of the three. A slot's variables are
     *  `merge(merge(pageVars, section.vars), part.vars)`, and the edit wave
     *  re-renders one block at a time through the same plugin the draw used, so
     *  it has to arrive at the same merge or `{{name}}` resolves differently
     *  under the caret than it does two lines above it. */
    vars() {
      return pageVariables;
    },
    /** Run after every draw, once the whole stack is on screen. This is how the
     *  edit wave finds its nodes: a redraw replaces every element, so anything
     *  dressed onto one has to be dressed on again.
     *  @param {() => void} fn */
    onDraw(fn) {
      drawListeners.push(fn);
      return () => {
        const i = drawListeners.indexOf(fn);
        if (i >= 0) drawListeners.splice(i, 1);
      };
    },
    redraw() {
      return drawPage();
    },
    /** One slot's contents. It writes one part of one section and touches
     *  nothing else, because it fires on a debounce while somebody is typing.
     *
     *  `data` is the slot's markdown, or an ARRAY of it when the slot holds a
     *  list — a list is written whole, because what the document holds is the
     *  array and an index on the wire is the thing that goes wrong when two
     *  edits cross — or an ARRAY OF ARRAYS when it holds a grid, its rows,
     *  whole for the same reason.
     *  @param {string} section @param {string} part @param {string | string[] | string[][]} data */
    write(section, part, data) {
      if (!runtime) return Promise.reject(new Error("no port"));
      writesInFlight++;
      // The count comes down on a timer rather than on the answer, and the delay
      // is the point: the `refresh` this write causes is sent by the server
      // AFTER it answers, so releasing on the answer would open the window a
      // moment before the echo arrives through it.
      const settle = () => setTimeout(() => {
        if (writesInFlight > 0) writesInFlight--;
      }, 400);
      // `@page` is not a section: it is where a page's own slots are gathered on
      // a page that has none, and the wire spells that `null`.
      const named = section === PAGE_SLOTS ? null : section;
      return runtime.call("section.write", { page: pageId, section: named, part: part, data: data }).then(
        (v) => {
          settle();
          // WHAT WAS JUST SAVED, into the copy the projection is computed from.
          // Re-reading the page instead would be a second round trip on every
          // debounce, and the answer would be a page the typist has already
          // moved past.
          patchHeld(named, part, data);
          sendProjection();
          return v;
        },
        (e) => {
          settle();
          throw e;
        },
      );
    },
    /** WHICH READER DREW THIS PAGE, and the input it was given — a plugin page's
     *  own document reads its configuration off here. */
    get plugin() {
      return pagePlugin;
    },
    get input() {
      return pageInput;
    },
    /** The order, and what is in it. Adding, reordering, duplicating and
     *  removing are one kind because they are one edit to one list.
     *  @param {any[]} sections */
    order(sections) {
      if (!runtime) return Promise.reject(new Error("no port"));
      return runtime.call("section.order", { page: pageId, sections: sections });
    },
    /** @param {string} section */
    remove(section) {
      if (!runtime) return Promise.reject(new Error("no port"));
      return runtime.call("section.remove", { page: pageId, section: section });
    },
    /** `section` null patches the PAGE's variables.
     *  @param {string | null} section @param {Record<string, unknown>} patch */
    patch(section, patch) {
      if (!runtime) return Promise.reject(new Error("no port"));
      return runtime.call("variables.patch", { page: pageId, section: section, patch: patch });
    },

    /** MOVE THE SECTIONS ON SCREEN, without redrawing them.
     *
     *  Re-appending an element does not re-run its script and does not tear down
     *  its effects, which is exactly right for a section-local script: it is
     *  bound to its own element and to nothing else, and its picture of the page
     *  did not change because the page moved around it. Re-running every script
     *  would restart every effect mid-scroll and be visibly janky.
     *
     *  A `data-g-scope="page"` script is the opposite case — it measured the
     *  whole stack — so exactly those are torn down and re-run, in the new
     *  order. Re-running nothing is quietly broken, which is worse than janky.
     *  @param {string[]} names */
    reorder(names) {
      const el = root();
      for (const name of names) {
        const child = el.querySelector('[data-g-section="' + CSS.escape(name) + '"]');
        if (child) el.appendChild(child);
      }
      rt.effects.replay(el);
    },
  };

  /* ── start ─────────────────────────────────────────────────────────────── */

  function start() {
    // Both conditions, whichever is last: the ports, and a document whose
    // <script> tags have all run. A plugin registered by a tag further down the
    // document has to exist before the first slot asks for it.
    if (started || !runtimePort || !parsed) return;
    started = true;
    void drawPage();
  }

  // At load, not at draw: the shim is inlined ahead of every runtime file, so it
  // is already there, and a `refresh` can reach it before the first draw has
  // finished.
  claimSlots();

  document.addEventListener("biom:rendered", () => projectSoon());

  /** FOLLOWING A `[[wikilink]]`, which is two questions and one gesture.
   *
   *  The markdown plugin draws one as an anchor carrying the raw target and
   *  resolves nothing, because a box has no page list. So the click asks what
   *  the target names and then asks to go there — `link.resolve` answers the
   *  same `{kind, id}` shape `open` takes, so there is nothing in between.
   *
   *  A TARGET THAT NAMES NOTHING MARKS THE LINK rather than doing nothing at
   *  all. A reference that silently ignores a click reads as a broken app; one
   *  that says it goes nowhere reads as a note to write. The mark is an
   *  attribute, so the page's own stylesheet decides what an unresolved link
   *  looks like, and it is set on the answer rather than at draw time — nothing
   *  is asked about a link nobody has followed. */
  document.addEventListener("click", (ev) => {
    const at = /** @type {Element | null} */ (/** @type {any} */ (ev).target);
    if (!at || typeof at.closest !== "function") return;
    const link = at.closest("a[data-g-link]");
    if (!link) return;
    ev.preventDefault();
    if (!runtime) return;
    const target = link.getAttribute("data-g-link") || "";
    runtime.call("link.resolve", { target: target }).then((found) => {
      if (!found) {
        link.setAttribute("data-g-link-dead", "");
        return;
      }
      link.removeAttribute("data-g-link-dead");
      return runtime && runtime.call("open", { target: found });
    }).catch((e) => report("that link could not be followed", e));
  }, false);

  if (!parsed)
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        parsed = true;
        start();
      },
      { once: true },
    );

  take((g) => {
    // Held as locals as well as in the file's state, because everything below
    // this line closes over them and a nullable field would have to be
    // re-checked inside each closure for a value that cannot change again.
    const rport = /** @type {MessagePort} */ (g.runtime);
    const qport = /** @type {MessagePort} */ (g.guest);
    runtimePort = rport;
    guestPort = qport;
    pageId = typeof g.page === "string" ? g.page : "";

    runtime = correlator(rport, "r");
    guest = correlator(qport, "q");

    rport.onmessage = (ev) => {
      const m = ev.data;
      if (!m || typeof m !== "object") return;
      if (/** @type {any} */ (runtime).settle(m)) return;
      onEvent(m);
    };

    // The guest port is SHARED with the shim, which sets its own `onmessage` on
    // it, so this listens rather than assigns — replacing `onmessage` would take
    // the shim's channel away. Starting it is deferred by one task because the
    // shim publishes `window.__g` and installs its own handler in the same
    // synchronous run: starting the port from inside that run would deliver a
    // message before the shim had somewhere to receive it.
    qport.addEventListener("message", (ev) => {
      const m = /** @type {MessageEvent} */ (ev).data;
      if (m && typeof m === "object") /** @type {any} */ (guest).settle(m);
    });
    setTimeout(() => {
      try {
        qport.start();
      } catch {
        /* already started by the shim, which is the ordinary case */
      }
    }, 0);

    start();
  });

  window.addEventListener("error", (e) => report(String(e.message || "an error escaped"), e.error));
  window.addEventListener("unhandledrejection", (e) =>
    report("a promise was rejected and nothing caught it", /** @type {any} */ (e).reason),
  );
  window.addEventListener("pagehide", () => {
    rt.effects.disposeAll();
    if (runtime) runtime.abandon();
    if (guest) guest.abandon();
  });
})();
