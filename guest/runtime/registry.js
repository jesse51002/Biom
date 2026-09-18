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
 * `markdown`, `html`, `table` and `child` are not plugins the framework happens
 * to ship: they are the PART KINDS, and a slot's plugin is named by its part's
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
 * A RESERVED ID IS FILLED BY THE FILE THE FORMAT NAMES, NOT BY WHOEVER IS FIRST.
 * It used to be first-past-the-post, which quietly made the reservation a race
 * the alphabet decided: the loader concatenates `plugins/*.js` in name order, so
 * a vault file called `0-notes.js` sorted ahead of `table.js` and took `table`.
 * `plugins/<kind>.js` is the one file that may draw `<kind>` — which is still
 * A FILE IN THE VAULT, so editing the seeded `markdown.js` is editing the
 * drawing, exactly as intended. Adding a second file that claims the name is not.
 *
 * WHICH FILE IS REGISTERING IS A FACT THE LOADER HANDS OVER. Every plugin in a
 * vault arrives inside one concatenated script, so `document.currentScript` says
 * "the bundle" for all of them; the loader sets `rt.pluginFile` around each
 * file's own function instead, and `whereFrom()` below reads it. It is what the
 * reservation is decided on and what a refusal prints, because a refusal that
 * does not name the two files is one the reader cannot act on.
 *
 * THERE IS NO `shipped` ANY MORE, and dropping it was the point of the vault
 * owning every plugin. A vault's `table.js` IS the table plugin — the person's
 * edit of it is the shipped one — so there is nothing left to shadow.
 * What is refused is a SECOND file taking an id that is already drawn, part kind
 * or not, in a sentence naming both files.
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
   *   named by its part's kind, so `markdown`, `html`, `table` and `child` are
   *   spoken for by the format itself.
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
   *   registered this plugin — `plugins/<name>.js`, a `/guest/` path for the
   *   runtime's own, or `an unnamed script`. Read when a second file claims the
   *   same id, so the refusal can name both.
   */

  /** @type {Map<string, GPlugin>} */
  const byId = new Map();

  const NAME = /^[a-z][a-z0-9-]*$/;

  /** THE FORMAT'S PART KINDS — `PartKind` in `contracts/types.ts`. Held equal to
   *  it by a test; see the header. `reveal` is deliberately NOT here: it is a
   *  plugin a vault happens to ship, not a kind a slot can be. */
  const PART_KINDS = new Set(["markdown", "html", "table", "child"]);

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
   *  bundle wraps each source in a function and sets `rt.pluginFile` to the file
   *  name around the call, so this reads the file that is executing right now.
   *
   *  `/guest/` IS THE RUNTIME AND NOTHING ELSE NOW — every plugin is a file in
   *  the vault, served from `/v/<enc>/plugin/` — so a script src under it is the
   *  framework's own code registering, which is the other thing this has to be
   *  able to say.
   *  @returns {string} */
  function whereFrom() {
    if (typeof rt.pluginFile === "string" && rt.pluginFile) return "plugins/" + rt.pluginFile;
    const cur = typeof document === "object" && document ? document.currentScript : null;
    const src = cur && /** @type {HTMLScriptElement} */ (cur).src;
    if (!src) return "an unnamed script";
    try {
      return new URL(src, location.href).pathname;
    } catch {
      return "an unnamed script";
    }
  }

  /** Is this the framework's own runtime registering? `/guest/` is served to the
   *  box by the framework and by nothing else. @param {string} from */
  function isRuntime(from) {
    return from.startsWith("/guest/");
  }

  /** THE ONE FILE A PART KIND MAY BE DRAWN FROM. A reserved id is not filled by
   *  whoever registers first — that made the reservation a race the alphabet
   *  decided, and `plugins/0-notes.js` could take `table` from `plugins/table.js`
   *  by sorting ahead of it. It is filled by the file the format names: the
   *  vault's own `plugins/<kind>.js`, or the framework's `biom-<kind>.js`, and
   *  the id says which. @param {string} id @param {string} from */
  function mayReserve(id, from) {
    return from === "plugins/" + id + ".js" || isRuntime(from);
  }

  /** WHAT THE FRAMEWORK'S OWN PLUGINS ARE CALLED, and why a bare name is not.
   *  Every plugin the framework ships registers as `biom-<name>` — `biom-markdown`,
   *  `biom-reveal`, `biom-doc` — so a plugin a workspace wrote can never share
   *  an id with one the framework ships later and be refused as its duplicate
   *  on the next release. A page, a slot and a plugin go on saying the bare
   *  name: `resolve` below answers the workspace's own first and the
   *  framework's second, which is the same nearest-first rule the server
   *  applies to a plugin's file. Spelled once here and once in
   *  `server/domain/pages.ts`, which is the other side of the same lookup, and
   *  a test holds the two equal. */
  const OURS = "biom-";

  /** A part kind, or the framework's own plugin for one. Both are reserved to
   *  the file that carries the name, because a `biom-markdown` registered by
   *  some other file is the same theft as a `markdown` would be. @param {string} id */
  function isKind(id) {
    return PART_KINDS.has(id) || (id.startsWith(OURS) && PART_KINDS.has(id.slice(OURS.length)));
  }

  /** THE LOOKUP, NEAREST FIRST. A bare id is the workspace's own if it
   *  registered one, and the framework's `biom-<id>` otherwise; a prefixed id
   *  is exactly what it says. That is the whole of how `plugin: doc`,
   *  `data-g-plugin="reveal"` and a `markdown` slot go on working when the
   *  framework's files and ids wear the prefix — and how a workspace that
   *  registers its own `reveal` is what those draw with, by having one.
   *  @param {string} id @returns {string | null} the id that is registered */
  function resolve(id) {
    if (byId.has(id)) return id;
    if (!id.startsWith(OURS) && byId.has(OURS + id)) return OURS + id;
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
      if (isKind(id) && !mayReserve(id, from)) {
        say('"' + id + '" is a part kind and only plugins/' + id + '.js draws it — ' + from + " must register under an id of its own");
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
      });
      return true;
    },

    /** @param {string} id @returns {boolean} */
    has(id) {
      return resolve(id) !== null;
    },

    /** The definition, or null — the workspace's own for a bare id, the
     *  framework's `biom-` one when it has none. Public because a plugin
     *  composing on another wants to know whether it declares `edit` before
     *  offering to edit it. @param {string} id @returns {GPlugin | null} */
    get(id) {
      const found = resolve(id);
      return found === null ? null : byId.get(found) || null;
    },

    /** Every id registered, in registration order. For the section menu the
     *  edit wave will build, and for saying what went wrong when a section
     *  names a plugin nothing registered. @returns {string[]} */
    ids() {
      return [...byId.keys()];
    },
  };

  rt.plugins = plugins;

  /* biom.plugins IS THE PUBLIC NAME. The shim owns `window.biom` and
   * is loaded ahead of this file, so the ordinary case is attaching to an object
   * that is already there. The other case is real and is not a fallback for a
   * bug: the runtime is verified in a bare frame with no shim at all, because a
   * verification that needed the shim would be testing two files and telling you
   * about one. A stand-in carrying nothing but `plugins` keeps that frame
   * honest. */
  const g = glob.biom;
  if (g && typeof g === "object") g.plugins = plugins;
  else glob.biom = { plugins: plugins };
})();
