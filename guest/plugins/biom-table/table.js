// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-table.js — a workspace table drawn as a grid in a slot. A
 * classic script sharing globals; see `guest/runtime/registry.js` for why there
 * are no imports in here.
 *
 * THE ROWS ARRIVE OVER THE PORT AND THERE IS NO OTHER WAY TO GET THEM. A `table`
 * part carries the table's NAME and nothing else — `page.read` resolves prose
 * and children inline because the box cannot fetch, but a table is unbounded and
 * inlining every row of it into every page that mentions it would make the page
 * read the size of the database. So this plugin asks, over `ctx.call`, which is
 * the guest port and therefore `HostRequest` and nothing wider.
 *
 * IT ASKS TWICE, ON PURPOSE. `table.get` answers a `TableView`, which already
 * carries the schema it answered with; `table.schema` is asked beside it because
 * the two fail apart. A table that has been renamed answers `not_found` to the
 * first while the second still describes something; a table with no rows yet
 * answers an empty `rows` and the header still has to be drawn. Asking for both
 * and drawing with whichever arrived is the difference between a header over an
 * empty body — which reads as "this table is empty" — and a blank rectangle,
 * which reads as "the product is broken". They go out together rather than in
 * sequence, so the second is not waiting on the first.
 *
 * A COLUMN'S TYPE IS HOW ITS CELL IS DRAWN, and that is the whole reason the
 * type exists. A checkbox is a box, not the word `true`; a number is aligned on
 * its last digit so a column of them can be read down; a categories value is its
 * labels, each taking the palette colour the schema gave it. A grid that drew
 * every cell as text would be a CSV with lines around it.
 *
 * IT IS READ-ONLY, AND `edit` SAYS SO. Editing a table happens in the app's own
 * grid, which is client zero of this same contract and issues the same
 * `table.get` and `row.insert` a page does. A second editing surface inside the
 * box would be a second set of rules about what a cell may hold, and the two
 * would drift.
 *
 * WIDE CONTENT SCROLLS INSIDE ITS OWN BOX. The runtime's one iframe fills the
 * canvas and IS the scroller for the page, which is what makes `position:
 * sticky` and a `scroll()` timeline work in a section at all. A twenty-column
 * table that widened the document would take that scroller sideways and drag
 * every section on the page with it, so the grid is put in a box of its own that
 * scrolls horizontally and the page never learns the table was wide.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /** Report through the runtime where it exists, so a failure inside an
   *  opaque-origin box reaches the host as a notice rather than dying in a
   *  console nobody outside can read. Late-bound and guarded for the same reason
   *  the registry's copy is: this file is verified in a bare frame with no boot
   *  in it. @param {string} message */
  function say(message) {
    if (typeof rt.report === "function") rt.report(message);
    else console.error("[biom] " + message);
  }

  /* ── the stylesheet ────────────────────────────────────────────────────── */

  /** ONE STYLESHEET FOR EVERY GRID ON THE PAGE, in the document's head rather
   *  than in each node. A page can hold a dozen tables and a `<style>` per mount
   *  would be a dozen copies of the same rules; the head survives a redraw,
   *  which is exactly what makes the guard below enough.
   *
   *  IT IS NOT SCOPED and does not need to be: every selector in it starts at a
   *  `g-tbl` class, which nothing but this file writes.
   *
   *  NOTHING HERE SETS A COLOUR. Every one resolves to a palette token the shim
   *  declared on `:root` when the theme arrived. The fallbacks are not colours
   *  either — they are `currentColor` mixed down — because a box drawn before
   *  the theme lands, or verified in a frame with no shim in it, must still be
   *  legible rather than invisible, and a hex literal here would be the one
   *  thing a palette change could not repaint. */
  const STYLE_ID = "g-style-table";
  const SHEET = [
    ".g-tbl-box {",
    "  --g-ink: var(--ink, currentColor);",
    "  --g-dim: var(--ink-3, color-mix(in srgb, currentColor 62%, transparent));",
    "  --g-rule: var(--rule, color-mix(in srgb, currentColor 32%, transparent));",
    "  --g-rule-soft: var(--rule-soft, color-mix(in srgb, currentColor 16%, transparent));",
    "  --g-wash: color-mix(in srgb, var(--cyan, currentColor) 7%, transparent);",
    "  --g-gauge: var(--gauge-face, ui-monospace, monospace);",
    "  max-width: 100%;",
    // The rule this file exists to keep: the WIDE THING scrolls, not the page.
    "  overflow-x: auto;",
    "  overscroll-behavior-x: contain;",
    "  color: var(--g-ink);",
    "}",
    // `max-content` AND NOT `100%`, which was measured rather than reasoned
    // about. A table set to `width: 100%` always fits its box exactly — Chrome
    // compresses eighteen columns into eighteen slivers and even breaks a word
    // no `overflow-wrap` rule asked it to break — so the scroller above it never
    // has anything to scroll and the rule it exists for silently does nothing.
    // Taking the width the content wants, floored at the width of the box, is
    // what makes a wide grid a wide grid: it scrolls sideways inside its own box
    // and a narrow one still fills the measure.
    ".g-tbl { border-collapse: collapse; width: max-content; min-width: 100%; font: inherit; }",
    ".g-tbl th, .g-tbl td { padding: .34rem .6rem; text-align: left; vertical-align: top; }",
    ".g-tbl th {",
    "  font-family: var(--g-gauge); font-size: .58rem; font-weight: 600;",
    "  letter-spacing: .12em; text-transform: uppercase; color: var(--g-dim);",
    "  border-bottom: 1px solid var(--g-rule); white-space: nowrap;",
    "}",
    ".g-tbl td { border-bottom: 1px solid var(--g-rule-soft); }",
    ".g-tbl tbody tr:nth-child(even) td { background: var(--g-wash); }",
    // A number is read down a column, so it is aligned on its last digit and set
    // in figures of one width. Anything else makes a column of them unreadable.
    ".g-tbl .g-num { text-align: right; font-variant-numeric: tabular-nums; }",
    ".g-tbl .g-check { display: block; margin: 0; }",
    ".g-tbl-tag {",
    "  display: inline-block; margin: 0 .25rem .15rem 0; padding: .02rem .42rem;",
    "  border-radius: .8rem; font-size: .82em; line-height: 1.5;",
    "  color: var(--g-ink);",
    "  background: color-mix(in srgb, var(--g-c, currentColor) 20%, transparent);",
    "  border: 1px solid color-mix(in srgb, var(--g-c, currentColor) 45%, transparent);",
    "}",
    ".g-tbl-note {",
    "  margin: .4rem 0 0; font-family: var(--g-gauge); font-size: .6rem;",
    "  letter-spacing: .08em; text-transform: uppercase; color: var(--g-dim);",
    "}",
    ".g-tbl-say { margin: 0; color: var(--magenta-t, currentColor); }",
  ].join("\n");

  function styles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = SHEET;
    document.head.appendChild(el);
  }

  /* ── values ────────────────────────────────────────────────────────────── */

  /** A palette ROLE, never a colour: `cyan`, `ink-3`, `magenta-t`. It is checked
   *  against the shape a token name may have before it is put into a custom
   *  property, because the value comes out of the vault and a name nobody
   *  validated would be a string from a file going into a stylesheet.
   *  @param {unknown} role @returns {string} */
  function roleVar(role) {
    const name = typeof role === "string" && /^[a-z][a-z0-9-]*$/.test(role) ? role : "ink-3";
    return "var(--" + name + ", currentColor)";
  }

  /** A categories cell is a JSON array of labels — `["Render","Scaffold"]` —
   *  and it is read tolerantly for the reason `client/views/table.js` reads it
   *  tolerantly: a CSV import puts whatever was in the file into the column, and
   *  a cell reading `Done` should mean one label rather than nothing.
   *  @param {any} value @returns {string[]} */
  function categories(value) {
    if (value === null || value === undefined || value === "") return [];
    if (typeof value !== "string") return [String(value)];
    const text = value.trim();
    if (text.charAt(0) === "[") {
      try {
        const list = JSON.parse(text);
        if (Array.isArray(list)) return list.map((v) => String(v)).filter(Boolean);
      } catch {
        /* not JSON after all; the delimiter reading below is the honest one */
      }
    }
    return text.split(/\s*[;,]\s*/).filter(Boolean);
  }

  /** Fill one cell according to its column's type.
   *
   *  A URL, AN EMAIL AND A PHONE ARE TEXT HERE, and that is a consequence of the
   *  box rather than an oversight. The frame is `sandbox="allow-scripts"` with
   *  no `allow-popups` and no `allow-top-navigation`, so an anchor either does
   *  nothing at all or navigates the box itself — which would replace the whole
   *  page the person is reading with somebody's website and leave no way back.
   *  A link that cannot be followed safely is better drawn as the address it is.
   *  @param {HTMLElement} td @param {any} value @param {any} col */
  function fill(td, value, col) {
    const type = col && typeof col.type === "string" ? col.type : "text";

    if (type === "checkbox") {
      const box = document.createElement("input");
      box.className = "g-check";
      box.type = "checkbox";
      box.checked = value === true || value === 1 || value === "1" || value === "true";
      // Read-only, and said twice: `disabled` so it cannot be clicked, and a
      // label so a screen reader says which column the box belongs to — the
      // header is nowhere near it once a table is long.
      box.disabled = true;
      box.setAttribute("aria-label", String(col && col.name ? col.name : "checkbox"));
      td.appendChild(box);
      return;
    }

    if (type === "categories") {
      const options = Array.isArray(col && col.options) ? col.options : [];
      for (const label of categories(value)) {
        const found = options.find((/** @type {any} */ o) => o && o.label === label);
        const tag = document.createElement("span");
        tag.className = "g-tbl-tag";
        tag.style.setProperty("--g-c", roleVar(found && found.colour));
        tag.textContent = label;
        td.appendChild(tag);
      }
      return;
    }

    if (type === "number") td.classList.add("g-num");

    // An empty cell is left EMPTY. A dash or an "(none)" would be this plugin
    // inventing content for a row somebody wrote, and the person reading it
    // cannot tell the invention from the data.
    if (value === null || value === undefined) return;
    td.textContent = String(value);
  }

  /* ── drawing ───────────────────────────────────────────────────────────── */

  /** @param {Element} node @param {string} message */
  function fail(node, message) {
    node.setAttribute("data-g-failed", "");
    node.textContent = message;
    say(message);
  }

  /** @param {any} view @param {any} schema @param {number} max @returns {Element} */
  function grid(view, schema, max) {
    const columns = Array.isArray(schema && schema.columns) ? schema.columns : [];
    const rows = Array.isArray(view && view.rows) ? view.rows : [];
    const total = view && typeof view.total === "number" ? view.total : rows.length;

    const box = document.createElement("div");
    box.className = "g-tbl-box";

    const table = document.createElement("table");
    table.className = "g-tbl";

    // A width the user set in the grid is honoured, because a column they
    // widened to read a long name is a decision they already made once.
    if (columns.some((/** @type {any} */ c) => typeof c.width === "number" && c.width > 0)) {
      const group = document.createElement("colgroup");
      for (const col of columns) {
        const c = document.createElement("col");
        if (typeof col.width === "number" && col.width > 0) c.style.width = col.width + "px";
        group.appendChild(c);
      }
      table.appendChild(group);
    }

    const head = document.createElement("thead");
    const hrow = document.createElement("tr");
    for (const col of columns) {
      const th = document.createElement("th");
      th.scope = "col";
      if (col.type === "number") th.classList.add("g-num");
      th.textContent = String(col.name);
      hrow.appendChild(th);
    }
    head.appendChild(hrow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      const cells = (row && row.cells) || {};
      for (const col of columns) {
        const td = document.createElement("td");
        fill(td, cells[col.name], col);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    box.appendChild(table);

    const holder = document.createElement("div");
    holder.appendChild(box);

    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "g-tbl-note";
      p.textContent = columns.length === 0 ? "This table has no columns yet." : "No rows yet.";
      holder.appendChild(p);
    } else if (rows.length < total) {
      // Only when it is TRUE. A count printed under every table would be
      // furniture; printed under a table that has been cut short it is the one
      // fact the reader cannot otherwise have.
      const p = document.createElement("p");
      p.className = "g-tbl-note";
      p.textContent = "Showing " + rows.length + " of " + total + " rows";
      holder.appendChild(p);
    }

    return holder;
  }

  glob.biom.plugins.register({
    id: "biom-table",

    /** `edit: false` is a statement rather than a default. A table IS editable —
     *  in the app's grid, which speaks the same `row.update` this box could —
     *  and declaring it here would put a second editing surface on the same
     *  rows, with its own idea of what a cell may hold. */
    edit: false,

    /**
     * @param {Element} node the slot, filled in place
     * @param {any} content the resolved `Part`, or null for a `data-g-plugin`
     *   node — which names its table with `data-g-table` instead
     * @param {any} ctx
     */
    mount(node, content, ctx) {
      const named =
        content && content.kind === "table" && typeof content.table === "string"
          ? content.table
          : typeof ctx.options.table === "string"
            ? ctx.options.table
            : "";

      // Interpolated like everything else a section writes, so a section can say
      // `data-g-table="{{table}}"` and one file can draw a different table per
      // page. `{{name}}` reaches the stored table name for the same reason it
      // reaches prose: it is resolved where it is drawn.
      const name = ctx.text(named).trim();
      if (!name) {
        fail(node, "this slot holds a table but does not say which one");
        return;
      }

      // `data-g-max-rows="20"` reads as `options.maxRows`. It is applied as the
      // QUERY'S LIMIT rather than as a slice after the fact, so a page showing
      // the first five rows of a hundred-thousand-row table moves five rows over
      // the port. `total` still counts what matched, which is what lets the note
      // under the grid say how much was left out.
      const asked = Number.parseInt(String(ctx.options.maxRows || ""), 10);
      const max = Number.isFinite(asked) && asked > 0 ? asked : 0;

      styles();

      // Everything below this line happens after an await, and the section may
      // be gone by then — a refresh redraws the whole stack, and painting into a
      // node that has been thrown away is work nobody sees and a reference that
      // keeps the old tree alive.
      let live = true;
      ctx.onTeardown(() => {
        live = false;
      });

      node.textContent = "";

      void (async () => {
        // Together rather than in sequence: the second question is not waiting
        // on the first, and `allSettled` because each is useful without the
        // other — see the header.
        const [got, described] = await Promise.allSettled([
          ctx.call("table.get", max > 0 ? { name: name, query: { limit: max } } : { name: name }),
          ctx.call("table.schema", { name: name }),
        ]);
        if (!live) return;

        const view = got.status === "fulfilled" ? got.value : null;
        const schema = described.status === "fulfilled" ? described.value : (view && view.schema) || null;

        if (!schema) {
          const why =
            described.status === "rejected" && described.reason && described.reason.message
              ? String(described.reason.message)
              : "the workspace has no table called that";
          fail(node, 'the table "' + name + '" could not be read: ' + why);
          return;
        }

        node.removeAttribute("data-g-failed");
        node.replaceChildren(grid(view, schema, max));
      })();
    },
  });
})();
