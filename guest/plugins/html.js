// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/html.js — a slot whose content is markup somebody wrote. A
 * classic script sharing globals; see `guest/runtime/registry.js` for why there
 * are no imports in here.
 *
 * `html` IS A `PartKind` IN A FROZEN CONTRACT, so until this file existed the
 * runtime drew the words *nothing draws a html part* in the middle of any page
 * that used one. A kind in the contract with no plugin behind it is not a
 * missing feature, it is a page that cannot be drawn.
 *
 * IT ARRIVES ALREADY LOADED, AND THAT IS NOT AN OPTIMISATION. `Content.data` is
 * a FILENAME beside `content.yaml` — html is long, is code rather than prose,
 * and is the one thing a person is not editing in a field, so it stays a file.
 * The box it is drawn in has an opaque origin and cannot `fetch`, so a part that
 * named a file and expected the guest to load it would simply never draw.
 * `page.read` reads the file on the server and `Part` carries both: `file` for
 * saying which one when something is wrong, and `html` for drawing.
 *
 * `{{name}}` IS RESOLVED BEFORE THE MARKUP IS PARSED, which is the only order
 * that can work. An attribute value is not a node and cannot be filled after the
 * fact, so `<img alt="{{caption}}">` is only possible while the document is
 * still a string. The runtime does exactly this to a section's own markup for
 * exactly this reason. `ctx.text` resolves against the three scopes already
 * merged for this slot — this part's own variables first, then the section's,
 * then the page's — and a name nothing answers is left verbatim rather than
 * blanked, because a visible `{{tota1}}` is a typo somebody can fix and an empty
 * space is not.
 *
 * NOTHING IS ESCAPED ON THE WAY IN. This is the page author's own file, in their
 * own box, at an opaque origin with no credentials to steal and no path to the
 * server but a port. Say it plainly rather than leave it to be discovered: a
 * variable holding `<` will be read as markup here, the same as it is in a
 * section's own HTML.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A `<script>` INSIDE AN html PART DOES NOT RUN, AND IS REMOVED RATHER THAN
 * LEFT WHERE IT SITS.
 *
 * The question is a fair one, because a section's own `<script>` IS run — the
 * runtime treats it as an inline plugin, clones it into a fresh node and binds
 * `section`, `ctx` and `onTeardown` into its scope. So why not this?
 *
 * NOT BECAUSE OF TRUST. Both files are the same person's, in the same vault,
 * served by the same server into the same sandboxed box. A trust argument here
 * would be theatre.
 *
 * BECAUSE OF MECHANISM, in three parts.
 *
 * First, a `<script>` inserted through `innerHTML` NEVER EXECUTES. That is a
 * browser rule, not a preference. So "leave it alone" does not mean "let it
 * run" — it means the script sits in the page looking like code that ran, and
 * the person who wrote it has no way to tell it did not. Removing it and saying
 * so turns a silent nothing into a sentence naming the file.
 *
 * Second, running it would mean rebuilding the runtime's wrapper out here. What
 * makes a section script an inline PLUGIN rather than a loose script is
 * everything around it: a function scope, so two sections may both declare
 * `let i`; the three bound names; and above all `onTeardown`, which is what
 * makes its observers and listeners die when the section is redrawn. The
 * runtime redraws the WHOLE STACK on every refresh, so a script here with no
 * teardown would leave an `IntersectionObserver` per redraw holding detached
 * nodes — the exact leak the teardown rule exists to prevent, and one that gets
 * measurably worse the longer somebody edits the page.
 *
 * Third, the door already exists and it is one line away. A section's own HTML
 * may hold the `<script>`, where it gets all of that; or it may place a
 * `data-g-plugin` node, which the runtime mounts. An html part that needs
 * behaviour is a section that has not been written yet, and the format makes
 * writing one cheap.
 *
 * ONE CONSEQUENCE IS WORTH STATING BECAUSE IT SURPRISES: a `data-g-plugin` node
 * INTRODUCED BY an html part is not mounted either. `fillSlots` snapshots both
 * node lists before any plugin runs, so a node this file inserts is not in the
 * list the runtime is walking. The door is in the section's markup, not inside
 * the html file.
 *
 * A `<style>`, by contrast, DOES apply the moment it is inserted — to the whole
 * document, wherever it sits. So it is scoped to this slot on the way in, using
 * the same `scopeCss` the runtime wraps a section's own stylesheet with. Without
 * that, an html part styling `h2` would restyle every section under it and the
 * page would depend on the order its slots happen to be filled in.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /** @param {string} message */
  function say(message) {
    if (typeof rt.report === "function") rt.report(message);
    else console.error("[biom] " + message);
  }

  let seq = 0;

  /** Wrap this part's stylesheets so they cannot reach the section below.
   *  Reached for rather than reimplemented: a second copy of the hoist set —
   *  `@keyframes` must stay at the top level or the browser drops it — is a
   *  second thing to get out of step with the first.
   *  @param {Element} node @param {DocumentFragment} frag */
  function scopeStyles(node, frag) {
    const sheets = Array.from(frag.querySelectorAll("style"));
    if (sheets.length === 0) return;
    // An id is minted only when the slot has none. One the section wrote is the
    // section's, and taking it would break the section's own CSS. Escaped,
    // because a slot may legally be named something a bare selector cannot say.
    if (!node.id) node.id = "g-html-" + ++seq;
    const target = "#" + CSS.escape(node.id);
    for (const sheet of sheets) {
      const css = sheet.textContent || "";
      sheet.textContent =
        rt.sections && typeof rt.sections.scopeCss === "function" ? rt.sections.scopeCss(css, target) : css;
    }
  }

  glob.biom.plugins.register({
    id: "html",

    /** `edit: false`, and the reason is in the format rather than in this file.
     *  What is STORED for this slot is a filename, so an in-place edit would
     *  write the paragraph somebody typed over the name of the file it came
     *  from. Every string an html part SHOWS belongs in `variables`, which are
     *  edited where variables are edited and interpolate through `ctx.text`
     *  above. */
    edit: false,

    /**
     * @param {Element} node the slot, filled in place
     * @param {any} content the resolved `Part`
     * @param {any} ctx
     */
    mount(node, content, ctx) {
      if (!content || content.kind !== "html" || typeof content.html !== "string") {
        node.setAttribute("data-g-failed", "");
        node.textContent = "this slot holds a html file and the page did not say which";
        say("a html slot arrived with no markup on it");
        return;
      }

      const file = typeof content.file === "string" && content.file ? content.file : "an html part";

      const tpl = document.createElement("template");
      tpl.innerHTML = ctx.text(content.html);

      const scripts = Array.from(tpl.content.querySelectorAll("script"));
      for (const s of scripts) s.remove();
      if (scripts.length > 0)
        say(
          '"' + file + '" has a <script> in it, which is not run where an html part is drawn — ' +
            "put it in the section's own HTML, where the runtime gives it section, ctx and onTeardown",
        );

      scopeStyles(node, tpl.content);
      node.replaceChildren(tpl.content);
    },
  });
})();
