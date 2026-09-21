// SPDX-License-Identifier: AGPL-3.0-only
/* guest/runtime/sections.js — drawing one section: its CSS, its slots and its
 * scripts. A classic script sharing globals; see registry.js for why there are
 * no imports in here.
 *
 * A SECTION IS A DIV. It is full width, it owns its own layout, and it holds any
 * number of plugins wherever its own HTML puts them — so three columns of prose
 * is ONE section with three markdown slots, which the shape this replaced could
 * not express at all. Nothing here privileges prose, a measure or a column: the
 * reading measure lives in the section's file, which is why a full-bleed section
 * costs nothing.
 *
 * THREE MECHANISMS, AND EACH ONE IS HERE FOR A NAMED FAILURE.
 *
 * `@scope` around the section's own `<style>`. A `<style>` element applies to
 * the whole document wherever it sits, so a section that styled `h2` would
 * restyle every section under it and the page would depend on the order its
 * sections happen to be in. Wrapping the rules in `@scope (#sec-<name>)` lets a
 * section style itself as freely as if it were the only thing on the page, which
 * is the freedom the format exists to give.
 *
 * `{{name}}` resolved at DRAW time against three scopes, nearest first: the
 * part's own variables, then the section's, then the page's. It arrives raw and
 * it STAYS raw in the stored data — prose is edited in place and writes back, so
 * resolving before an edit would round-trip `62` over the top of `{{rate}}` and
 * destroy the variable the first time somebody touched the paragraph it sits in.
 * A name nothing answers is left verbatim rather than blanked, because a visible
 * `{{tota1}}` is a typo somebody can fix and an empty space is not.
 *
 * SCRIPTS CLONED INTO FRESH NODES. A `<script>` inserted through `innerHTML`
 * never executes — that is a browser rule, not a preference — so the section's
 * scripts have to be re-created either way. Since we are building the node
 * anyway, three names are bound into its scope while we do it: `section` (its
 * own element, so a section script never has to guess which of five copies on
 * the page it belongs to), `ctx` (the same context object a named plugin gets,
 * `ctx.use` and all), and `onTeardown`.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /** `@scope` is what we want; nesting is what we settle for. They scope
   *  descendants the same way, and what nesting lacks is the donut hole —
   *  `@scope (a) to (b)` — which nothing here uses yet. Feature-detected rather
   *  than version-sniffed, because the box is whatever browser the user has. */
  const SCOPED = "CSSScopeRule" in glob;

  /** At-rules that must NOT go inside the scope wrapper. `@keyframes` is the one
   *  that matters: a scroll-driven section is `animation-timeline: view()` plus
   *  a `@keyframes` block, and a `@keyframes` nested inside `@scope` is not a
   *  valid nested rule — the browser drops it and the animation silently does
   *  nothing. The rest are here for the same reason: they name something for the
   *  whole document and have no meaning scoped to a subtree. */
  const HOIST = new Set([
    "import", "charset", "namespace", "font-face", "keyframes", "-webkit-keyframes",
    "property", "counter-style", "font-feature-values", "font-palette-values",
  ]);

  /** A `<script>` we should run. Anything else with a `type` is a data island —
   *  `application/json`, `text/template` — and is left exactly where the section
   *  put it, because extracting it would delete data the section is reading. */
  const CLASSIC = new Set(["", "text/javascript", "application/javascript"]);

  /** @param {string} message */
  function say(message) {
    if (typeof rt.report === "function") rt.report(message);
    else console.error("[biom] " + message);
  }

  /* ── variables ─────────────────────────────────────────────────────────── */

  /** Nearest wins, so the nearer dictionary is the later argument. `null` is a
   *  value a person can type into a field, so it is kept rather than skipped.
   *  @param {any} outer @param {any} inner @returns {Record<string, any>} */
  const merge = (outer, inner) => Object.assign({}, outer || {}, inner || {});

  const HOLE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

  /** Resolve `{{name}}` against one already-merged scope.
   *
   *  A LIST JOINS WITH ", " and `null` reads as empty, because a variable is a
   *  scalar or a list of scalars — never a structure — and both of those have an
   *  obvious reading in a sentence. An unknown name is returned untouched.
   *  @param {string} text @param {Record<string, any>} vars @returns {string} */
  function interpolate(text, vars) {
    if (typeof text !== "string" || text.indexOf("{{") < 0) return text;
    return text.replace(HOLE, (whole, name) => {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole;
      const v = vars[name];
      if (v === null || v === undefined) return "";
      if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? "" : String(x))).join(", ");
      return String(v);
    });
  }

  /* ── css ───────────────────────────────────────────────────────────────── */

  /** @param {string} css @param {number} at index of the opening quote */
  function skipString(css, at) {
    const quote = css[at];
    let i = at + 1;
    while (i < css.length) {
      if (css[i] === "\\") i += 2;
      else if (css[i] === quote) return i + 1;
      else i++;
    }
    return i;
  }

  /** Split a stylesheet into the at-rules that must stay at the top level and
   *  everything else. Brace-aware and string-aware, which is the whole of what
   *  is needed: this is not a CSS parser and does not need to be one — it only
   *  has to find the top-level rule boundaries, and a `}` inside a string or a
   *  comment is the only thing that could move one.
   *  @param {string} css @returns {{ hoisted: string, scoped: string }} */
  function splitCss(css) {
    let hoisted = "";
    let scoped = "";
    let depth = 0;
    let start = 0;
    let i = 0;

    /** @param {string} chunk */
    const emit = (chunk) => {
      const t = chunk.trim();
      if (!t) {
        scoped += chunk;
        return;
      }
      if (t.charCodeAt(0) === 64 /* @ */) {
        const m = /^@([-\w]+)/.exec(t);
        if (m && m[1] && HOIST.has(m[1].toLowerCase())) {
          hoisted += chunk + "\n";
          return;
        }
      }
      scoped += chunk;
    };

    while (i < css.length) {
      const c = css[i];
      if (c === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end < 0 ? css.length : end + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i = skipString(css, i);
        continue;
      }
      if (c === "{") {
        depth++;
        i++;
        continue;
      }
      if (c === "}") {
        depth--;
        i++;
        if (depth <= 0) {
          emit(css.slice(start, i));
          start = i;
          depth = 0;
        }
        continue;
      }
      if (c === ";" && depth === 0) {
        i++;
        emit(css.slice(start, i));
        start = i;
        continue;
      }
      i++;
    }
    if (start < css.length) emit(css.slice(start));
    return { hoisted: hoisted, scoped: scoped };
  }

  /** Wrap a section's own stylesheet so it cannot reach the section below it.
   *  `:scope` inside the result is the section element itself, which is how a
   *  section sets its own layout.
   *  @param {string} css @param {string} selector already escaped
   *  @returns {string} */
  function scopeCss(css, selector) {
    const split = splitCss(css);
    if (!split.scoped.trim()) return split.hoisted;
    const body = SCOPED
      ? "@scope (" + selector + ") {\n" + split.scoped + "\n}\n"
      : selector + " {\n" + split.scoped + "\n}\n";
    return split.hoisted ? split.hoisted + "\n" + body : body;
  }

  /* ── the context every plugin and every section script is given ────────── */

  /** The `data-g-*` attributes that are the RUNTIME's and never a plugin's. */
  const RESERVED = new Set(["part", "plugin", "scope", "section", "empty", "default", "failed"]);

  /** A node's `data-g-*` attributes as a plain object, minus the runtime's own.
   *  `data-g-max-rows` reads as `options.maxRows`, which is what `dataset`
   *  already spells it as with the leading `g` taken off.
   *  @param {Element} node @returns {Record<string, string>} */
  function optionsOf(node) {
    /** @type {Record<string, string>} */
    const out = {};
    const data = /** @type {HTMLElement} */ (node).dataset;
    if (!data) return out;
    for (const key of Object.keys(data)) {
      if (key.length < 2 || key.charAt(0) !== "g") continue;
      const name = key.charAt(1).toLowerCase() + key.slice(2);
      if (RESERVED.has(name)) continue;
      const v = data[key];
      if (typeof v === "string") out[name] = v;
    }
    return out;
  }

  /**
   * @typedef {object} GSpec
   * @property {string} page
   * @property {string | null} section the section's name, null for a page plugin
   * @property {string | null} part the slot id, null for `data-g-plugin`, a page
   *   plugin and a section script
   * @property {string | null} plugin which plugin is mounting, null for a script
   * @property {Record<string, any>} vars already merged, nearest last
   * @property {Element} root the section's own element, or the page root for a
   *   page plugin and for a `data-g-scope="page"` script
   * @property {string} bucket which teardown bucket this mount registers into
   * @property {Element} [node] the node being filled, for `ctx.options`
   * @property {Record<string, string>} [options] overrides what the node says
   * @property {(kind: string, params?: Record<string, unknown>) => Promise<any>} call
   */

  /** THE PLUGIN CONTEXT. One shape for a named plugin, a page plugin and a
   *  section script alike, because the three differ in what they are given and
   *  not in what they may do — and a script that had a smaller context than a
   *  plugin would be a second API to learn for no reason.
   *
   *  NOTHING ON IT CAN WRITE A FILE. `ctx.call` speaks over the GUEST port,
   *  which carries `HostRequest` and nothing else; `section.write`,
   *  `section.order` and `section.remove` travel the runtime's own port, which
   *  never leaves boot.js. A plugin declares `edit: true` and the runtime does
   *  the writing.
   *  @param {GSpec} spec @returns {any} */
  function makeCtx(spec) {
    const options = spec.options || (spec.node ? optionsOf(spec.node) : {});

    const ctx = {
      /** Which page this is. */
      page: spec.page,
      /** Which section — the `name` in `contents` — or null for a page plugin. */
      section: spec.section,
      /** Which slot, or null for a `data-g-plugin` node and a section script. */
      part: spec.part,
      /** Which plugin is mounting, or null inside a section script. */
      plugin: spec.plugin,
      /** The section's own element, or the page root for a page-scoped mount. */
      root: spec.root,
      /** The three scopes already merged, nearest last. Read it directly for a
       *  value; use `ctx.text` to fill a template with it. */
      vars: spec.vars,
      /** This node's `data-g-*` attributes. A `data-g-plugin` node is configured
       *  entirely by these and has no stored content at all. */
      options: options,
      /** Resolve `{{name}}` in a string against this mount's scopes.
       *  @param {string} text */
      text(text) {
        return interpolate(text, spec.vars);
      },

      /** READ ONE OF THIS SECTION'S OWN SLOTS, as the markdown it stores —
       *  braces and all, because that is what is on disk and what an edit has to
       *  write back.
       *
       *  A LIST SLOT ANSWERS AN ARRAY, one entry per item. That is the shape a
       *  section works in: adding is a push, removing is a splice, reordering is
       *  a move, and none of them needs a separator to be agreed about. A GRID
       *  SLOT ANSWERS ITS ROWS, an array of arrays, one string per cell.
       *  @param {string} part @returns {string | string[] | string[][]} */
      read(part) {
        if (spec.section === null || !rt.edit) return "";
        return rt.edit.read(spec.section, part);
      },

      /** WRITE ONE OF THIS SECTION'S OWN SLOTS.
       *
       *  This is what lets a section build its own adding, removing and
       *  reordering with NO CEILING on how many items it holds. An item is a
       *  block of markdown inside a slot that already exists, so there is
       *  nothing to declare ahead of time and no limit to run into — which the
       *  first attempt at this had, and it was wrong.
       *
       *  It reaches this section's slots and no other's. That is a closure
       *  rather than a browser guarantee, as everything inside the box is, and
       *  it grants nothing a person typing into the page could not already do.
       *
       *  A GRID'S ROWS ARE WRITTEN THE SAME WAY, as an array of arrays, and
       *  the page is not redrawn for them: the grid plugin draws what it
       *  changed and the write is the record of it.
       *  @param {string} part @param {string | string[] | string[][]} markdown
       *  @returns {boolean} */
      write(part, markdown) {
        if (spec.section === null || !rt.edit) return false;
        return rt.edit.write(spec.section, part, markdown);
      },

      /** One request over the guest port — `HostRequest` and nothing wider. The
       *  shim's `biom.*` wraps the same port with a friendlier surface and
       *  is the ordinary way to ask; this is here so the runtime is complete on
       *  its own and so a plugin can send a kind the shim has not wrapped yet.
       *  @param {string} kind @param {Record<string, unknown>} [params] */
      call(kind, params) {
        return spec.call(kind, params);
      },

      /** Is a plugin registered. The optional half of composition: markdown
       *  hands a fence to the plugin its info string names only where that
       *  plugin exists, and draws an ordinary code block where it does not.
       *  @param {string} id */
      has(id) {
        return rt.plugins.has(id);
      },

      /** REACH ANOTHER PLUGIN. There are no imports in here, so this is the
       *  entire composition mechanism: a table plugin that wants markdown in its
       *  cells asks for it by name and mounts it into a cell.
       *
       *      const md = ctx.use("markdown");
       *      md.mount(cell, { kind: "markdown", md: text, vars: {} });
       *
       *  It THROWS on a name nothing registered rather than returning null,
       *  because a plugin composing on a plugin that is not there is a bug its
       *  author has to see — a silent null draws a blank cell and looks like
       *  missing data. Ask `ctx.has` first when the dependency is optional.
       *  @param {string} id */
      use(id) {
        const def = rt.plugins.get(id);
        if (!def) {
          throw new Error(
            'no plugin named "' + id + '" is registered — ' +
              (rt.plugins.ids().join(", ") || "none are") +
              ". Ask ctx.has(id) first when it is optional.",
          );
        }
        return {
          id: def.id,
          edit: def.edit === true,
          /** @param {Element} node @param {any} [content] @param {Record<string, string>} [opts] */
          mount(node, content, opts) {
            const sub = makeCtx({
              page: spec.page,
              section: spec.section,
              part: spec.part,
              plugin: def.id,
              vars: spec.vars,
              root: spec.root,
              // The child's teardowns belong to the same bucket, so a section
              // coming down takes everything mounted underneath it with it.
              bucket: spec.bucket,
              node: node,
              options: opts,
              call: spec.call,
            });
            return mountWith(def, node, content === undefined ? null : content, sub);
          },
        };
      },

      /** Run `fn` when this section is redrawn or removed. Without it an
       *  `IntersectionObserver` outlives the nodes it was watching and the page
       *  gets slower every time somebody edits it.
       *  @param {() => void} fn */
      onTeardown(fn) {
        rt.effects.onTeardown(spec.bucket, fn);
      },
    };

    return ctx;
  }

  /** Draw a plugin into a node, and keep a failure inside that node. A plugin
   *  that throws is one slot the page could not draw; letting it escape would
   *  stop the section — and every section under it — from drawing at all.
   *  @param {any} def @param {Element} node @param {any} content @param {any} ctx */
  function mountWith(def, node, content, ctx) {
    try {
      const teardown = def.mount(node, content, ctx);
      // Both are honoured. A plugin with one observer finds the return easier; a
      // plugin that mounts several children finds the callback easier, and being
      // made to pick would only make one of them write a wrapper.
      if (typeof teardown === "function") ctx.onTeardown(teardown);
      return teardown;
    } catch (e) {
      fail(node, 'the "' + def.id + '" plugin failed: ' + String((e && /** @type {Error} */ (e).message) || e));
      return undefined;
    }
  }

  /** Say what went wrong WHERE it went wrong. A blank rectangle in the middle of
   *  a page is indistinguishable from an empty slot, and the person looking at
   *  it is usually the person who can fix it.
   *  @param {Element} node @param {string} message */
  function fail(node, message) {
    node.setAttribute("data-g-failed", "");
    node.textContent = message;
    say(message);
  }

  /* ── drawing ───────────────────────────────────────────────────────────── */

  /**
   * Build one section, put it in the page and fill it.
   *
   * @param {any} drawn a `DrawnSection`: `{ name, html, fallback, parts, vars }`
   * @param {any} env `{ page, root, pageVars, call, dress }`
   * @returns {HTMLElement}
   */
  function draw(drawn, env) {
    const name = String(drawn.name);
    const el = document.createElement("section");
    el.id = "sec-" + name;
    el.setAttribute("data-g-section", name);
    // The editor reads this, and so does the checker warning about a page that
    // is nothing but defaults — a generation that did not use the freedom it had.
    if (drawn.fallback) el.setAttribute("data-g-default", "");

    // A section may be named `@page-notes`, which is a legal id attribute and an
    // illegal selector written bare. Escaping is what lets the two agree.
    const selector = "#" + CSS.escape(el.id);
    const vars = merge(env.pageVars, drawn.vars);

    // The section's own markup is interpolated as TEXT, before it is parsed,
    // which is the only way `<img alt="{{caption}}">` can work at all — an
    // attribute value is not a node and cannot be filled after the fact. The
    // values are scalars a person typed into a field and the markup is the
    // page author's own code, in a box with an opaque origin and no credentials
    // to steal, so nothing is escaped on the way in. Say it plainly rather than
    // leave it to be discovered: a variable holding `<` will be read as markup.
    const tpl = document.createElement("template");
    tpl.innerHTML = interpolate(String(drawn.html || ""), vars);

    for (const style of Array.from(tpl.content.querySelectorAll("style")))
      style.textContent = scopeCss(style.textContent || "", selector);

    /** @type {HTMLScriptElement[]} */
    const scripts = [];
    for (const s of Array.from(tpl.content.querySelectorAll("script"))) {
      const type = (s.getAttribute("type") || "").toLowerCase().trim();
      if (type === "module") {
        // The box has an opaque origin: a module script is CORS-gated and never
        // loads in here. Saying so is the whole remedy — silently running it as
        // a classic script would turn its `import` line into a syntax error and
        // report that instead of the real cause.
        s.remove();
        say('section "' + name + '" has a <script type="module">, which cannot load in the page box — use a classic script');
        continue;
      }
      if (!CLASSIC.has(type)) continue; // a data island, left where it was put
      scripts.push(/** @type {HTMLScriptElement} */ (s));
      s.remove();
    }

    el.appendChild(tpl.content);
    env.root.appendChild(el);

    fillSlots(el, drawn, vars, env, name);
    // BETWEEN THE TWO, AND THAT ORDER IS LOAD-BEARING. The edit wave re-draws a
    // markdown slot as a run of separately-tagged blocks, which replaces every
    // node the plugin just made. A section's script decorates what is on the
    // page — classing a table's cells, measuring a figure — so a wave that
    // arrived AFTER the scripts silently threw their work away, and the symptom
    // was a script that plainly ran and plainly did nothing.
    if (typeof env.dress === "function") env.dress(el, drawn, vars);
    runScripts(el, scripts, name, vars, env);
    return el;
  }

  /**
   * @param {HTMLElement} el @param {any} drawn @param {Record<string, any>} vars
   * @param {any} env @param {string} name
   */
  function fillSlots(el, drawn, vars, env, name) {
    const parts = drawn.parts || {};

    // Both queries are taken BEFORE anything is mounted. A plugin fills its node
    // by replacing what is inside it, so a `data-g-plugin` node that lived inside
    // a slot is gone by the time the slot has been drawn — and mounting markup a
    // plugin generated is not the same thing as mounting markup the section
    // wrote. Snapshot, then check what survived.
    const partNodes = Array.from(el.querySelectorAll("[data-g-part]"));
    const pluginNodes = Array.from(el.querySelectorAll("[data-g-plugin]"));

    for (const node of partNodes) {
      const id = node.getAttribute("data-g-part") || "";
      const content = parts[id];
      if (!content) {
        // A slot the page has not filled yet is not a failure: it is where
        // somebody types first. Whatever the section put inside it stays, so a
        // section can carry its own placeholder.
        node.setAttribute("data-g-empty", "");
        continue;
      }
      // A LIST DRAWS ITS ITEMS IN ORDER INTO THE ONE SLOT, ONE ELEMENT EACH.
      //
      // An item gets a wrapper and a block does not, and the difference is what
      // each one IS. A block is part of a passage — a div around it would break
      // `.prose > p` and change nothing for the better. An item is a THING: the
      // section lays out one box per item, which is what `.cards > *` already
      // means, and a region that is one element is a region the editor can take,
      // mount into and redraw. The index on the wrapper is how the editor and
      // the section address it.
      if (content.kind === "list") {
        node.textContent = "";
        (content.items || []).forEach((/** @type {any} */ item, /** @type {number} */ at) => {
          const itemDef = rt.plugins.get(String(item.kind));
          const holder = document.createElement("div");
          if (!itemDef) {
            fail(holder, 'nothing draws a "' + String(item.kind) + '" item');
          } else {
            mountWith(
              itemDef, holder, item,
              makeCtx({
                page: env.page, section: name, part: id, plugin: itemDef.id,
                vars: merge(vars, item.vars), root: el, bucket: name,
                node: holder, call: env.call,
              }),
            );
          }
          holder.setAttribute("data-g-item", String(at));
          node.appendChild(holder);
        });
        node.setAttribute("data-g-list", String((content.items || []).length));
        continue;
      }

      const def = rt.plugins.get(String(content.kind));
      if (!def) {
        fail(node, 'nothing draws a "' + String(content.kind) + '" part — the plugin for it is not registered');
        continue;
      }
      // WHAT KIND OF THING THE SLOT HOLDS, said on the slot, so a section's own
      // stylesheet can size a slot by what is in it — the default section widens
      // for a grid and stays at the reading measure for prose — without the
      // section knowing what any plugin draws.
      node.setAttribute("data-g-kind", String(content.kind));
      mountWith(
        def,
        node,
        content,
        makeCtx({
          page: env.page,
          section: name,
          part: id,
          plugin: def.id,
          // The third scope. `content.vars` is the part's own and wins, then the
          // section's, then the page's — nearest first, so a bare name in prose
          // is always the closest one and never a surprise.
          vars: merge(vars, content.vars),
          root: el,
          bucket: name,
          node: node,
          call: env.call,
        }),
      );
    }

    for (const node of pluginNodes) {
      if (!el.contains(node)) continue;
      const id = node.getAttribute("data-g-plugin") || "";
      const def = rt.plugins.get(id);
      if (!def) {
        fail(node, 'no plugin named "' + id + '" is registered');
        continue;
      }
      mountWith(
        def,
        node,
        // NO STORED CONTENT, deliberately. A `data-g-plugin` node is configured
        // entirely by its `data-g-*` attributes, which is what makes a section
        // able to place a chrome element — a rule, a progress bar, a spacer —
        // without inventing a slot in `content.yaml` for something nobody edits.
        null,
        makeCtx({
          page: env.page,
          section: name,
          part: null,
          plugin: def.id,
          vars: vars,
          root: el,
          bucket: name,
          node: node,
          call: env.call,
        }),
      );
    }
  }

  /** Scratch space for the three values a cloned script is handed. A script
   *  element carries text and nothing else, so the values are left here for the
   *  wrapper to claim by index the moment it runs — and cleared immediately
   *  after, because the whole page's contexts would otherwise be reachable from
   *  one array for as long as the box is open. @type {any[]} */
  const bench = [];
  rt.claim = (/** @type {number} */ n) => bench[n];

  /** The wrapper. A section script is not a global script: its `var`s and
   *  functions are function-scoped, so two sections that both declare `let i`
   *  do not collide, and `return` at the top level is legal. That is a
   *  difference from a real `<script>` and it is the right one — a section
   *  should not be able to name a global by accident.
   *  @param {number} n @param {string} src */
  const wrap = (n, src) =>
    ";(function () {\n" +
    "var $ = window.__gRuntime.claim(" + n + ");\n" +
    "(function (section, ctx, onTeardown) {\n" +
    src +
    "\n})($.section, $.ctx, $.onTeardown);\n" +
    "})();\n";

  /**
   * @param {HTMLElement} el @param {HTMLScriptElement[]} scripts
   * @param {string} name @param {Record<string, any>} vars @param {any} env
   */
  function runScripts(el, scripts, name, vars, env) {
    scripts.forEach((old, i) => {
      // `data-g-scope="page"` rebinds `section` to the page root: the script is
      // about the whole stack rather than about the div it was declared in. It
      // is also the only kind of script a reorder re-runs, because it is the
      // only kind whose picture of the page a reorder invalidates.
      const paged = old.getAttribute("data-g-scope") === "page";
      const bound = paged ? env.root : el;
      const bucket = paged ? name + "::script" + i : name;

      /** @type {HTMLScriptElement | null} */
      let node = null;

      const run = () => {
        // A script element that has already run does not run again when it is
        // moved, so a replay is a NEW node every time. The old one is inert and
        // is removed rather than left to accumulate.
        if (node) node.remove();
        const s = document.createElement("script");
        for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
        if (old.hasAttribute("src")) {
          // An external section script gets no bindings — there is nothing to
          // wrap. It can still reach `biom` and `window.__gRuntime`, which
          // is how vendored code loaded by a section works at all.
          el.appendChild(s);
          node = s;
          return;
        }
        const ctx = makeCtx({
          page: env.page,
          section: name,
          part: null,
          plugin: null,
          vars: vars,
          root: bound,
          bucket: bucket,
          node: old,
          call: env.call,
        });
        const slot = bench.push({ section: bound, ctx: ctx, onTeardown: ctx.onTeardown }) - 1;
        s.textContent = wrap(slot, old.textContent || "");
        el.appendChild(s);
        bench[slot] = null;
        node = s;
      };

      if (paged) rt.effects.remember(name, bucket, run);
      run();
    });
  }

  rt.sections = {
    draw: draw,
    interpolate: interpolate,
    merge: merge,
    scopeCss: scopeCss,
    splitCss: splitCss,
    makeCtx: makeCtx,
    mountWith: mountWith,
    fail: fail,
    // For a page that has no sections: its own document declares the slots and
    // the page's top-level keys fill them, so the filler is reached directly
    // rather than through `draw`.
    fillSlots: fillSlots,
  };
})();
