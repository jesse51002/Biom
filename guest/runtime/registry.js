// SPDX-License-Identifier: AGPL-3.0-only
/* guest/runtime/registry.js — the plugin registry, and the whole of composition.
 *
 * A CLASSIC SCRIPT SHARING GLOBALS, and that is not a shortcut. The page lives
 * in one box with `sandbox="allow-scripts"` and no `allow-same-origin`, so its
 * origin is opaque: a classic `<script src>` loads there, while a MODULE script
 * is CORS-gated and blocked and `fetch` is blocked too. Measured, not assumed —
 * `vendor/README.md` records the run. So there is no import graph to be had in
 * here, and the registry below is what stands in its place: a plugin is reached
 * by NAME through a lookup, never by a specifier through a resolver.
 *
 * THIS IS THE FILE THE NEXT WAVE CODES AGAINST. `table`, `child`, `reveal` and
 * every plugin a vault ever ships is one call to `biom.plugins.register`,
 * so the shape here is a contract rather than an implementation detail:
 *
 *     biom.plugins.register({
 *       id: "markdown",
 *       mount(node, content, ctx) { … },
 *       edit: true,
 *     });
 *
 * `mount` FILLS ONE NODE and returns nothing, or a teardown function. `content`
 * is the resolved `Part` the server sent for that slot, or null for a node that
 * carries `data-g-plugin` and is configured entirely by its `data-g-*`
 * attributes. `ctx` is documented at `makeCtx` in sections.js — the one thing
 * to know here is `ctx.use(id)`, which is how a plugin reaches another plugin
 * and is therefore the ENTIRE composition mechanism. There are no imports to
 * have, so a plugin that wants markdown inside its cells asks for it by name.
 *
 * `edit: true` DECLARES THAT THE CONTENT IS EDITABLE. It is a declaration and
 * not a capability: the runtime holds the only port that can call
 * `section.write`, and nothing on `ctx` can write a file. A plugin that wants
 * its text edited says so and the runtime does the writing.
 *
 * THE PART KINDS ARE SPOKEN FOR BY THE FORMAT, AND ONE FILE EACH DRAWS THEM.
 * `markdown`, `html`, `table`, `child` and `grid` are not plugins the framework
 * happens to ship: they are the PART KINDS, and a slot's plugin is named by its part's
 * kind. So a second file registering `markdown` does not add a plugin — it
 * replaces the drawing of every markdown slot in the workspace, on every page,
 * including pages its author never opened. That is refused in a sentence naming
 * the reason.
 *
 * `PART_KINDS` BELOW IS THE FORMAT'S OWN LIST AND NOT THIS FILE'S OPINION. It is
 * `PartKind` in `contracts/types.ts`, said again here because the box has no
 * import graph to reach it through — and `tests/new-vault.test.ts` holds the two
 * equal, exactly as `tests/guest.test.js` holds `project.js` equal to
 * `contracts/projection.ts`. A kind added to the format without being added here
 * fails that test, which is what keeps this from being the roster that is wrong
 * in the release where being right matters.
 *
 * A RESERVED ID IS FILLED BY THE FOLDER THE FORMAT NAMES, NOT BY WHOEVER IS
 * FIRST. It used to be first-past-the-post, which quietly made the reservation
 * a race the alphabet decided: the loader concatenates the vault's plugins in
 * name order, so a file called `0-notes.js` sorted ahead of `table.js` and took
 * `table`. Every plugin is a FOLDER now — `plugins/<id>/` with its scripts
 * inside — and `plugins/<kind>/` is the one folder that may draw `<kind>`:
 * the vault's own, or the framework's `biom-<kind>/`, and only a folder at
 * the top of its root, never an inner one. Adding a second folder that claims
 * the name is refused in a sentence naming both.
 *
 * WHICH FILE IS REGISTERING IS A FACT THE LOADER HANDS OVER. Every plugin in a
 * vault arrives inside one concatenated script, so `document.currentScript` says
 * "the bundle" for all of them; the loader sets `rt.pluginFile` — the path
 * under its root, `biom-doc/plugins/biom-holds/holds.js` — and `rt.pluginRoot` —
 * `framework`, `plugins`, or a page's `pages/…/plugins` — around each file's
 * own function, and `whereFrom()` below reads them. They are what the
 * reservation is decided on, what a refusal prints, and what
 * `biom.plugin.list()` answers as each plugin's root.
 *
 * A `biom-` ID IS THE FRAMEWORK'S TO REGISTER. A vault or a page script
 * registering one is refused by name: the prefix is what keeps a workspace's
 * plugin from ever colliding with one the framework ships later, and a vault
 * that could wear it would be back to file-based overrides by another route.
 *
 * THERE IS NO `shipped` ANY MORE, and dropping it was the point of the vault
 * owning every plugin. A vault's `table/` IS the table plugin — the person's
 * edit of it is the shipped one — so there is nothing left to shadow.
 * What is refused is a SECOND file taking an id that is already drawn, part kind
 * or not, in a sentence naming both files.
 *
 * `biom.plugin` IS THE READING SIDE, beside `biom.plugins` the registration
 * side: `list()` answers every registered plugin and where it came from,
 * `get(id)` answers one as `ctx.use` does, and `extensions(id?)` answers the
 * merged variables the server put on the page read — the drawing plugin's
 * when the id is left out — current on every draw. A test holds `biom.plugin.get`
 * and `biom.plugins.get` equal.
 */
(function () {
  "use strict";

  /** The runtime's shared namespace. Built up by whichever of its files loads
   *  first, because classic scripts have no order to rely on beyond the one the
   *  document gives them, and a file that assumed it was first would break the
   *  day somebody moved a tag. @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /**
   * @typedef {object} GPlugin
   * @property {string} id lowercase, `^[a-z][a-z0-9-]*$`. A slot's plugin is
   *   named by its part's kind, so `markdown`, `html`, `table`, `child` and
   *   `grid` are spoken for by the format itself.
   * @property {(node: Element, content: any, ctx: any) => (void | (() => void))} mount
   *   Fill this one node. Return a teardown, or call `ctx.onTeardown` — both
   *   are honoured, because a plugin that composes several children finds the
   *   callback easier and a plugin with one observer finds the return easier.
   * @property {(source: string) => {start: number, end: number}[]} [blocks] where
   *   one editable block ends and the next begins, as character ranges into the
   *   stored source. Only meaningful with `edit`; omit it and the whole part is
   *   one region.
   * @property {boolean} [edit] this plugin's content is editable in place.
   * @property {string} [from] set here, never by the caller: the file that
   *   registered this plugin — `plugins/<id>/<file>.js`, `framework/…`, a
   *   page's `pages/…/plugins/…`, a `/guest/` path for the runtime's own, or
   *   `an unnamed script`. Read when a second file claims the same id, so the
   *   refusal can name both.
   * @property {"framework" | "vault" | "page" | "runtime"} [root] set here: which
   *   root the registering file was read from, which is what
   *   `biom.plugin.list()` answers.
   */

  /** @type {Map<string, GPlugin>} */
  const byId = new Map();

  const NAME = /^[a-z][a-z0-9-]*$/;

  /** THE FORMAT'S PART KINDS — `PartKind` in `contracts/types.ts`. Held equal to
   *  it by a test; see the header. `reveal` is deliberately NOT here: it is a
   *  plugin a vault happens to ship, not a kind a slot can be. */
  const PART_KINDS = new Set(["markdown", "html", "table", "child", "grid"]);

  /** Report a refusal. Late-bound rather than captured, because `rt.report`
   *  belongs to boot.js and boot.js may not have loaded yet — a plugin script
   *  can sit ahead of it in the document. Falling back to the console keeps the
   *  registry usable on its own, which is how it is verified.
   *  @param {string} message */
  function say(message) {
    if (typeof rt.report === "function") rt.report(message);
    else console.error("[biom] " + message);
  }

  /** WHICH FILE IS REGISTERING, said as the words a refusal has to print.
   *
   *  THE BUNDLE NAMES ITS OWN SEGMENTS. Every plugin in a vault arrives inside
   *  one concatenated script, so `document.currentScript` is that one script for
   *  all of them and cannot tell two files apart. The loader that builds the
   *  bundle wraps each source in a function and sets `rt.pluginFile` to the path
   *  under its root and `rt.pluginRoot` to the root's words around the call, so
   *  this reads the file that is executing right now.
   *
   *  `/guest/` IS THE RUNTIME AND NOTHING ELSE NOW — every plugin is a file in
   *  the vault, served from `/v/<enc>/plugin/` — so a script src under it is the
   *  framework's own code registering, which is the other thing this has to be
   *  able to say.
   *  @returns {string} */
  function whereFrom() {
    if (typeof rt.pluginFile === "string" && rt.pluginFile) {
      return (typeof rt.pluginRoot === "string" && rt.pluginRoot ? rt.pluginRoot : "plugins") + "/" + rt.pluginFile;
    }
    const cur = typeof document === "object" && document ? document.currentScript : null;
    const src = cur && /** @type {HTMLScriptElement} */ (cur).src;
    if (!src) return "an unnamed script";
    try {
      return new URL(src, location.href).pathname;
    } catch {
      return "an unnamed script";
    }
  }

  /** WHICH ROOT IS REGISTERING: the loader's words, read back as the answer
   *  `biom.plugin.list()` gives. The runtime's own scripts come from `/guest/`.
   *  @returns {"framework" | "vault" | "page" | "runtime"} */
  function rootNow() {
    if (typeof rt.pluginFile !== "string" || !rt.pluginFile) return "runtime";
    const root = typeof rt.pluginRoot === "string" ? rt.pluginRoot : "plugins";
    return root === "framework" ? "framework" : root === "plugins" ? "vault" : "page";
  }

  /** Is this the framework's own runtime registering? `/guest/` is served to the
   *  box by the framework and by nothing else. @param {string} from */
  function isRuntime(from) {
    return from.startsWith("/guest/");
  }

  /** THE ONE FOLDER A PART KIND MAY BE DRAWN FROM. A reserved id is not filled
   *  by whoever registers first — that made the reservation a race the alphabet
   *  decided, and a `0-notes.js` could take `table` from `table.js` by sorting
   *  ahead of it. It is filled by the folder the format names: the vault's own
   *  `plugins/<kind>/`, or the framework's `biom-<kind>/`, at the top of its
   *  root and never inside another plugin — a page's `plugins/` may not, because
   *  one bundle serves every page and a part kind is every page's.
   *  @param {string} id @param {string} from */
  function mayReserve(id, from) {
    if (isRuntime(from)) return true;
    const root = rootNow();
    if (root !== "vault" && root !== "framework") return false;
    const name = String(rt.pluginFile);
    const cut = name.indexOf("/");
    if (cut < 0) return false;
    return name.slice(0, cut) === id && name.indexOf("/", cut + 1) < 0;
  }

  /** The folder a part kind must be drawn from, as a refusal says it.
   *  @param {string} id */
  function folderFor(id) {
    return (id.startsWith(OURS) ? "framework/" : "plugins/") + id + "/";
  }

  /** WHAT THE FRAMEWORK'S OWN PLUGINS ARE CALLED, AND WHAT EVERYTHING SAYS.
   *  Every plugin the framework ships registers as `biom-<name>` — `biom-markdown`,
   *  `biom-reveal`, `biom-doc` — so a plugin a workspace wrote can never share
   *  an id with one the framework ships later and be refused as its duplicate
   *  on the next release. And that IS the name: a page says `plugin: biom-doc`,
   *  a section says `data-g-plugin="biom-reveal"`, a plugin says
   *  `ctx.use("biom-items")`. There used to be a translation here — a bare
   *  name answered by the framework's `biom-` one when the workspace had none
   *  — and it went on 2026-09-21 with vault format 5, as the one place a name
   *  was not the name. The one lookup that still crosses the prefix is a PART
   *  KIND, `forKind` below, because `markdown` there is a word of the format
   *  and not a plugin anybody named. Spelled once here and once in
   *  `server/domain/pages.ts`, which is the other side of the same rule, and
   *  a test holds the two equal. */
  const OURS = "biom-";

  /** A part kind, or the framework's own plugin for one. Both are reserved to
   *  the file that carries the name, because a `biom-markdown` registered by
   *  some other file is the same theft as a `markdown` would be. @param {string} id */
  function isKind(id) {
    return PART_KINDS.has(id) || (id.startsWith(OURS) && PART_KINDS.has(id.slice(OURS.length)));
  }

  /** THE LOOKUP, EXACT. An id is what it says: the workspace's own under its
   *  own name, the framework's under `biom-`. Nothing is tried under another
   *  spelling — `data-g-plugin="reveal"` in a workspace with no `reveal` of its
   *  own is a slot nothing draws, said in words, and not `biom-reveal`.
   *  @param {string} id @returns {string | null} the id that is registered */
  function resolve(id) {
    return byId.has(id) ? id : null;
  }

  /** THE ONE LOOKUP THAT CROSSES THE PREFIX: which plugin draws a PART KIND.
   *  `markdown`, `html`, `table`, `child` and `grid` are words of the format —
   *  a slot's `kind`, said by nobody as a plugin name — and the format says the
   *  workspace's own `plugins/<kind>/` draws the kind when a folder reserved
   *  it, the framework's `biom-<kind>/` otherwise. That is a reservation the
   *  folder rule above decides, not a translation of a name a person wrote.
   *  @param {string} kind @returns {string | null} the id that draws it */
  function drawerOf(kind) {
    if (byId.has(kind)) return kind;
    if (byId.has(OURS + kind)) return OURS + kind;
    return null;
  }

  const plugins = {
    /**
     * Take a plugin, or refuse it out loud. The return value says which, so a
     * vault file registering three plugins keeps the two that were fine.
     * @param {GPlugin} def
     * @returns {boolean}
     */
    register(def) {
      if (!def || typeof def !== "object") {
        say("a plugin must be an object with an id and a mount");
        return false;
      }
      const id = def.id;
      if (typeof id !== "string" || !NAME.test(id)) {
        say('a plugin id must be lowercase letters, digits and dashes — refused "' + String(id) + '"');
        return false;
      }
      if (typeof def.mount !== "function") {
        say('plugin "' + id + '" has no mount function');
        return false;
      }

      const from = whereFrom();

      /* A PART KIND IS DRAWN BY THE FILE THE FORMAT NAMES, and by nothing else.
         This used to be "whoever registers first", which made the reservation a
         race decided by the alphabet: the bundle concatenates `plugins/*.js` in
         name order, so a vault file called `0-notes.js` sorted ahead of
         `table.js` and took `table` — replacing the drawing of every table in
         the workspace, on pages its author never opened, with nothing anywhere
         saying so. The file name is not a race. */
      /* THE PREFIX IS THE FRAMEWORK'S. A vault or a page script wearing it is
         a copy by another name, and it is refused before anything else is
         asked about the id. */
      const root = rootNow();
      if (id.startsWith(OURS) && root !== "framework" && root !== "runtime") {
        say('"' + id + '" wears the framework\'s prefix — ' + from + " must register under a name of its own");
        return false;
      }

      if (isKind(id) && !mayReserve(id, from)) {
        say('"' + id + '" is a part kind and only ' + folderFor(id) + " draws it — " + from + " must register under an id of its own");
        return false;
      }

      const had = byId.get(id);
      if (had) {
        /* THE SECOND FILE TO CLAIM A NAME IS THE FAILURE, and naming both is
           what makes the sentence actionable — the person has two files and has
           to be told which two. There is no shipped-versus-yours here any more:
           every plugin is a file in the vault and your edit of `table.js` IS the
           table plugin. What cannot happen is a SECOND file taking the id out
           from under it. */
        say('two plugins registered as "' + id + '": ' + had.from + " has it and " + from + " is refused — rename one of them");
        return false;
      }

      byId.set(id, {
        id: id,
        mount: def.mount,
        edit: def.edit === true,
        // WHERE ONE BLOCK ENDS AND THE NEXT BEGINS, and it is only meaningful
        // beside `edit`. A plugin that declares neither is edited as one region.
        // It is copied field by field like the rest rather than by spreading the
        // caller's object, so what the registry holds is a shape this file states
        // — a plugin cannot smuggle a field past it, and a plugin that adds one
        // is a change here, which is where somebody will look for it.
        blocks: typeof def.blocks === "function" ? def.blocks : undefined,
        from: from,
        root: root,
      });
      return true;
    },

    /** @param {string} id @returns {boolean} */
    has(id) {
      return resolve(id) !== null;
    },

    /** The definition, or null — by the id as written and no other. Public
     *  because a plugin composing on another wants to know whether it declares
     *  `edit` before offering to edit it. @param {string} id @returns {GPlugin | null} */
    get(id) {
      const found = resolve(id);
      return found === null ? null : byId.get(found) || null;
    },

    /** The definition that draws a part kind, or null: the workspace's own
     *  `<kind>` where a folder reserved it, the framework's `biom-<kind>`
     *  otherwise. The runtime's slot drawing asks this and never `get`,
     *  because a kind is the format's word and not a plugin's name.
     *  @param {string} kind @returns {GPlugin | null} */
    forKind(kind) {
      const found = drawerOf(kind);
      return found === null ? null : byId.get(found) || null;
    },

    /** WHAT `ctx.use` AND `ctx.has` REACH: a plugin by its name as written,
     *  or — for the five words that are part kinds — the drawer of that kind.
     *  `ctx.use("markdown")` is a plugin asking for whatever draws markdown
     *  here, which is the format's question and not a name's; `ctx.use("reveal")`
     *  is a name, and reaches the workspace's own `reveal` or nothing.
     *  @param {string} id @returns {GPlugin | null} */
    reach(id) {
      const named = resolve(id);
      if (named !== null) return byId.get(named) || null;
      return PART_KINDS.has(id) ? plugins.forKind(id) : null;
    },

    /** Every id registered, in registration order. For the section menu the
     *  edit wave will build, and for saying what went wrong when a section
     *  names a plugin nothing registered. @returns {string[]} */
    ids() {
      return [...byId.keys()];
    },
  };

  rt.plugins = plugins;

  /** THE READING SIDE. `biom.plugins` registers; this answers. It is one
   *  object rather than three more methods on the registry because a plugin
   *  asking what it may read is a different act from a file saying what it
   *  draws, and the two names say which. */
  const plugin = {
    /** Every registered plugin and where it came from, in registration order.
     *  @returns {{ id: string, root: string, file: string }[]} */
    list() {
      return [...byId.values()].map((def) => ({ id: def.id, root: def.root || "runtime", file: def.from || "" }));
    },

    /** One plugin, as `ctx.use` finds it: by the id as written. Held equal to
     *  `biom.plugins.get` by a test. @param {string} id @returns {GPlugin | null} */
    get(id) {
      return plugins.get(id);
    },

    /** THE MERGED VARIABLES OF ONE PLUGIN, as the server put them on the page
     *  read: its `plugin.yaml` defaults, the vault's `extensions.yaml` over
     *  them, the page's over those, one key at a time. Left out, the id is the
     *  plugin drawing this page. By the id as written. Synchronous, off the
     *  last read: empty before the first draw, and current on every one after,
     *  because the read that draws the page is the read that carries them.
     *  @param {string} [id] @returns {Record<string, any>} */
    extensions(id) {
      const held = rt.page && typeof rt.page.extensions === "function" ? rt.page.extensions() : {};
      const want = id === undefined || id === null || id === "" ? (rt.page ? String(rt.page.plugin || "") : "") : String(id);
      if (!want || !held[want]) return {};
      const values = held[want] && held[want].values;
      return values && typeof values === "object" ? Object.assign({}, values) : {};
    },
  };

  rt.plugin = plugin;

  /* biom.plugins IS THE PUBLIC NAME. The shim owns `window.biom` and
   * is loaded ahead of this file, so the ordinary case is attaching to an object
   * that is already there. The other case is real and is not a fallback for a
   * bug: the runtime is verified in a bare frame with no shim at all, because a
   * verification that needed the shim would be testing two files and telling you
   * about one. A stand-in carrying nothing but `plugins` keeps that frame
   * honest. */
  const g = glob.biom;
  if (g && typeof g === "object") {
    g.plugins = plugins;
    g.plugin = plugin;
  } else glob.biom = { plugins: plugins, plugin: plugin };
})();
