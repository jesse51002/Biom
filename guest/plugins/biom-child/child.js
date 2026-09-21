// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-child.js — one of this page's children, drawn in place. A
 * classic script sharing globals; see `guest/runtime/registry.js` for why there
 * are no imports in here.
 *
 * THERE IS NO FOLDER. A page that draws its children is what a folder was, so
 * this is not a special kind of block — it is one slot holding one `Child`, and
 * a page holding six of them is a folder without the concept having been
 * invented. The data is already resolved: `page.read` looked the child up, so
 * the name, the kind and a table's row count are here without a second call.
 *
 * THE CHILD'S OWN `child.html` WINS. When `draw` is present it is the markup the
 * CHILD keeps in its own directory, and mounting it is the whole point: a page
 * knows how it wants to be summarised better than every page that might hold it.
 * The alternative was `@page-<id>.html` written on the PARENT — authored once
 * per parent, and stale the moment the same page was held somewhere else.
 *
 * WITHOUT IT, THE BUILT-IN ROW. Deleting `child.html` is a supported act, not a
 * broken page, so the fallback is a real row rather than a message: the name, a
 * word for what it is, and for a table how many rows it has.
 *
 * EITHER WAY IT IS CLICKABLE, AND THAT IS WHY `open` EXISTS ON THE WIRE AT ALL.
 * The built-in row used to navigate through host code, so the first custom
 * `child.html` silently LOST the click and drew a row that led nowhere. A row
 * you cannot follow is not a row. `ctx.call("open", …)` takes exactly the shape
 * `Child` already has, so following a row is the object it was drawn from — and
 * it is a REQUEST rather than a guarantee: the host refuses an id it does not
 * hold, which is what stops a page trapping somebody on it.
 *
 * THE CHILD'S MARKUP IS SCOPED AND ITS SCRIPTS ARE NOT RUN. Both for the same
 * reason `guest/plugins/biom-html.js` gives at length: a `<style>` in a slot applies
 * to the whole document unless something wraps it, and a `<script>` inserted as
 * markup never executes anyway, so leaving one in place is a silent nothing
 * dressed as code. The child says how it LOOKS; the section it is mounted in
 * says how the page BEHAVES.
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

  /* ── the stylesheet ────────────────────────────────────────────────────── */

  /** The built-in row only. A child that brought its own `child.html` brought
   *  its own rules with it and none of these apply to it.
   *
   *  A ROW IN A LIST, NOT A CARD. It sits in a run of rows — some of them the
   *  children's own — and has to look like it belongs beside them rather than
   *  shouting over them, so it is one line of type on the page's own paper.
   *  Every colour is a palette token; the fallbacks mix `currentColor` down so a
   *  box drawn before the theme arrives is still legible without this file ever
   *  naming a colour. */
  const STYLE_ID = "g-style-child";
  const SHEET = [
    ".g-kid {",
    "  --g-ink: var(--ink, currentColor);",
    "  --g-dim: var(--ink-3, color-mix(in srgb, currentColor 62%, transparent));",
    "  --g-rule-soft: var(--rule-soft, color-mix(in srgb, currentColor 16%, transparent));",
    "  display: grid; grid-template-columns: auto 1fr auto; align-items: center;",
    "  gap: .5rem; width: 100%; padding: .45rem .6rem;",
    "  background: none; border: 0; border-radius: .25rem;",
    "  color: var(--g-ink); font: inherit; text-align: left; cursor: pointer;",
    "  border-bottom: 1px solid var(--g-rule-soft);",
    "}",
    ".g-kid:hover { background: color-mix(in srgb, var(--cyan, currentColor) 10%, transparent); }",
    ".g-kid:focus-visible { outline: 2px solid var(--cyan, currentColor); outline-offset: 1px; }",
    ".g-kid-dot { width: .4rem; height: .4rem; border-radius: 50%; background: var(--nonrepro, currentColor); }",
    ".g-kid-name { min-width: 0; overflow-wrap: anywhere; }",
    ".g-kid-tag {",
    "  font-family: var(--gauge-face, ui-monospace, monospace); font-size: .58rem;",
    "  letter-spacing: .12em; text-transform: uppercase; color: var(--g-dim); white-space: nowrap;",
    "}",
    /* The child's own markup gets the pointer and the focus ring and nothing
       else, so a `child.html` that draws a card is a card and not a card inside
       a row this file drew around it. */
    "[data-g-child-open] { cursor: pointer; }",
    "[data-g-child-open]:focus-visible { outline: 2px solid var(--cyan, currentColor); outline-offset: 2px; }",
  ].join("\n");

  function styles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = SHEET;
    document.head.appendChild(el);
  }

  /* ── the child's own markup ────────────────────────────────────────────── */

  let seq = 0;

  /** A `<style>` in a slot reaches the WHOLE DOCUMENT wherever it sits, so a
   *  child that styled `h2` would restyle every section under it and the page
   *  would depend on the order its children happen to be in. The runtime already
   *  solves this for a section's own stylesheet; this is the same call on the
   *  same code, which is why it is reached for rather than reimplemented — a
   *  second copy of the hoist set is a second thing to get out of step.
   *
   *  The node needs a selector to be scoped to, and a slot usually has no id, so
   *  one is minted. It is minted only when there is none: an id the section
   *  wrote is the section's, and taking it would break its own CSS.
   *  @param {Element} node @param {DocumentFragment} frag */
  function scopeStyles(node, frag) {
    const sheets = Array.from(frag.querySelectorAll("style"));
    if (sheets.length === 0) return;
    if (!node.id) node.id = "g-child-" + ++seq;
    // Escaped, because a slot's id may legally be something a bare selector
    // cannot say — a section may be named `@page-notes`, and the runtime escapes
    // its own selector for exactly this reason.
    const target = "#" + CSS.escape(node.id);
    for (const sheet of sheets) {
      const css = sheet.textContent || "";
      sheet.textContent =
        rt.sections && typeof rt.sections.scopeCss === "function" ? rt.sections.scopeCss(css, target) : css;
    }
  }

  /** THE CHILD'S FIELDS ARE THE NEAREST SCOPE. `{{name}}` inside a `child.html`
   *  means the child's own name and cannot mean anything else, which is what
   *  lets the file be written once and copied into any page: the name is never
   *  hand-written into the markup, so renaming the page renames the row.
   *  @param {any} child @param {any} ctx @param {string} html @returns {string} */
  function resolve(child, ctx, html) {
    const own = {
      name: child.name,
      kind: child.kind,
      id: child.id,
      rows: typeof child.rows === "number" ? child.rows : "",
    };
    if (rt.sections && typeof rt.sections.interpolate === "function")
      return rt.sections.interpolate(html, Object.assign({}, ctx.vars, own));
    return ctx.text(html);
  }

  /* ── the built-in row ──────────────────────────────────────────────────── */

  /** What it IS, in one word, plus the one number a table has and a page does
   *  not. `rows` is only ever set for a table, so there is no branch to get
   *  wrong — an absent count simply says nothing rather than saying zero.
   *  @param {any} child @returns {string} */
  function tag(child) {
    if (child.kind !== "table") return "Page";
    if (typeof child.rows !== "number") return "Table";
    return child.rows === 1 ? "Table · 1 row" : "Table · " + child.rows + " rows";
  }

  /** @param {any} child @returns {HTMLElement} */
  function row(child) {
    const button = document.createElement("button");
    button.className = "g-kid";
    // A real button, so the keyboard reaches it without a role being invented
    // and Enter and Space already do what they should. Spans inside, because a
    // button may hold only phrasing content.
    button.type = "button";

    const dot = document.createElement("span");
    dot.className = "g-kid-dot";
    button.appendChild(dot);

    const name = document.createElement("span");
    name.className = "g-kid-name";
    name.textContent = String(child.name || child.id);
    button.appendChild(name);

    const word = document.createElement("span");
    word.className = "g-kid-tag";
    word.textContent = tag(child);
    button.appendChild(word);

    return button;
  }

  /* ── following it ──────────────────────────────────────────────────────── */

  /** Anything the browser already makes reachable by keyboard. When the child's
   *  own markup contains one, the click travels up to the node and this file
   *  adds no role of its own — a button inside a thing pretending to be a button
   *  is two tab stops for one row and a screen reader announcing it twice.
   *  @param {Element} node @returns {boolean} */
  const focusable = (node) => node.querySelector("a[href], button, [tabindex]") !== null;

  /**
   * @param {Element} node @param {any} child @param {any} ctx @param {boolean} own
   *   true when the child drew itself and may already be reachable
   */
  function follow(node, child, ctx, own) {
    const go = () => {
      // A refusal is the host's to make and is reported rather than swallowed:
      // an id nothing holds means the page's shape moved under this row, which
      // is worth a notice even though the page is otherwise fine.
      ctx.call("open", { target: { kind: child.kind, id: child.id } }).catch((/** @type {any} */ e) => {
        say('"' + String(child.name || child.id) + '" could not be opened: ' + String((e && e.message) || e));
      });
    };

    node.addEventListener("click", go);
    ctx.onTeardown(() => node.removeEventListener("click", go));

    if (!own || focusable(node)) return;

    // The child drew itself and drew nothing the keyboard can reach, so the
    // whole drawing becomes the control. Enter and Space are handled by hand
    // because only a real button gets them for free.
    node.setAttribute("data-g-child-open", "");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", String(child.name || child.id));
    /** @param {Event} ev */
    const key = (ev) => {
      const k = /** @type {KeyboardEvent} */ (ev).key;
      if (k !== "Enter" && k !== " ") return;
      ev.preventDefault();
      go();
    };
    node.addEventListener("keydown", key);
    ctx.onTeardown(() => node.removeEventListener("keydown", key));
  }

  glob.biom.plugins.register({
    id: "biom-child",

    /** A child row holds no text of its own: every word in it is the CHILD's —
     *  its name, its kind, its row count — so editing it here would be editing
     *  another page through a summary of it. */
    edit: false,

    /**
     * @param {Element} node the slot, filled in place
     * @param {any} content the resolved `Part`
     * @param {any} ctx
     */
    mount(node, content, ctx) {
      const child = content && content.kind === "child" ? content.child : null;
      if (!child || typeof child.id !== "string") {
        node.setAttribute("data-g-failed", "");
        node.textContent = "this slot stands for a child page or table, and the page did not say which";
        say("a child slot arrived with no child on it");
        return;
      }

      const drawn = content.draw && typeof content.draw.html === "string" ? content.draw : null;

      if (!drawn) {
        styles();
        node.replaceChildren(row(child));
        follow(node, child, ctx, false);
        return;
      }

      const tpl = document.createElement("template");
      tpl.innerHTML = resolve(child, ctx, drawn.html);

      // Removed rather than left where it sits. A `<script>` inserted as markup
      // never runs — that is a browser rule — so leaving one in the row would be
      // dead code that looks live, and the person who wrote it would have no way
      // to tell. `html.js` carries the full reasoning; the short of it is that a
      // slot holds content and the section around it holds the code.
      const scripts = Array.from(tpl.content.querySelectorAll("script"));
      for (const s of scripts) s.remove();
      if (scripts.length > 0)
        say(
          '"' + String(drawn.file || "child.html") + '" has a <script> in it, which is not run where a child is ' +
            "drawn — put it in the section's own HTML, where the runtime gives it section, ctx and onTeardown",
        );

      scopeStyles(node, tpl.content);
      node.replaceChildren(tpl.content);
      follow(node, child, ctx, true);
    },
  });
})();
