// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-grid.js — THE DOCUMENT'S OWN TABLE, DRAWN AS A BOARD AND EDITED
 * ONE CELL AT A TIME.
 *
 * A `grid` part holds its rows in `content.yaml` — a list of lists of markdown
 * strings, the first row the header where `head` is true — and this file is the
 * one that draws it: the framework's `biom-grid`, which a `grid` slot resolves
 * to unless the workspace has a `plugins/grid.js` of its own. It is not the
 * `table` plugin: that one draws rows the server holds in `workspace.db`,
 * reached by name, edited in the workspace's grid; this one draws rows the page
 * holds, edited here, that travel with the page and are projected into the
 * mirror as a markdown table. Both look like a board. Which to reach for is
 * `docs/tables.md`.
 *
 * EDITING IS IN PLACE, PER CELL. Click a cell and it opens as its raw markdown,
 * braces and all, the same as any slot; Enter or leaving the cell writes the
 * rows back whole through `ctx.write`, Escape puts the cell back. The cell is
 * re-rendered where it stands and the document is written only when the value
 * changed — the page is NOT redrawn for a write this plugin made, which is what
 * lets the next cell open on the next click rather than the one after.
 *
 * THE CONTROLS ARE OUTSIDE THE GRID AND SAY WHAT THEY DO. A gutter down the
 * left holds one `Delete row` per row, in the row's own line; a gutter across
 * the top holds one `Delete column` per column, over its header. Nothing that
 * removes anything sits inside a cell, because a mark inside a cell reads as
 * the cell's. `Add row` is the grid's last line and `Add column` sits beside
 * the last column. The header stays when the last row under it is deleted;
 * deleting the last column is refused in words, because a grid with no columns
 * is not a grid. Everything positional is computed from the rows.
 *
 * A PIPE IN A CELL IS A CHARACTER. Nothing here splits a cell on anything: a
 * cell is a cell, which is the whole reason a grid is a part kind and not a
 * markdown table dressed up. The projection escapes the pipe on the way to the
 * mirror, where a row is a line again.
 *
 * NOTHING HERE INKS A COLOUR THAT IS NOT A TOKEN, and the fallbacks are
 * `currentColor` mixed down rather than a hex, for the reason `biom-table.js`
 * gives: a box drawn before the theme lands must still be legible. The look is
 * deliberately plain — one hairline, the header in the furniture face, the
 * cells in the sheet face — because every workspace wears it until it writes a
 * `plugins/grid.js` of its own over it.
 *
 * A GRID INSIDE A LIST SLOT IS DRAWN AND NOT EDITED. `ctx.write` writes a whole
 * slot, and a list slot's whole is the list, so a grid that is one item of it
 * has no door of its own yet. It draws its rows and its controls stay away.
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

  /** ONE STYLESHEET FOR EVERY GRID ON THE PAGE, in the head, which survives a
   *  redraw — the guard is enough. Every selector starts at a `g-grid` class,
   *  which nothing but this file writes. */
  const STYLE_ID = "g-style-grid";
  const SHEET = [
    ".g-grid-box {",
    "  --g-ink: var(--ink, currentColor);",
    "  --g-ink-2: var(--ink-2, color-mix(in srgb, currentColor 78%, transparent));",
    "  --g-dim: var(--ink-3, color-mix(in srgb, currentColor 62%, transparent));",
    "  --g-rule: var(--rule, color-mix(in srgb, currentColor 32%, transparent));",
    "  --g-rule-soft: var(--rule-soft, color-mix(in srgb, currentColor 16%, transparent));",
    "  --g-stock: var(--stock, transparent);",
    "  --g-stock-hi: var(--stock-hi, color-mix(in srgb, currentColor 6%, transparent));",
    "  --g-led: var(--led, currentColor);",
    "  --g-no: var(--led-red, currentColor);",
    "  --g-furniture: var(--furniture-face, inherit);",
    "  --g-gauge: var(--gauge-face, ui-monospace, monospace);",
    "  max-width: 100%;",
    // THE WIDE THING SCROLLS, NOT THE PAGE — the rule `biom-table.js` keeps and the
    // reason it keeps it: the box is the page's own scroller.
    "  overflow-x: auto;",
    "  overscroll-behavior-x: contain;",
    "  color: var(--g-ink);",
    "}",
    // A gutter column first, a gutter row first, and a trailing column for the
    // add — none of the three is part of the board, so the board reads as the
    // cells alone and the controls read as sitting beside it.
    ".g-grid { display: grid; grid-template-columns: auto repeat(var(--g-cols, 1), minmax(6rem, 1fr)) auto; align-items: stretch; font-size: .92em; line-height: 1.5; }",
    ".g-grid-cell { position: relative; min-width: 0; padding: .5rem .75rem; background: var(--g-stock); border-inline-start: 1px solid var(--g-rule-soft); border-block-end: 1px solid var(--g-rule-soft); overflow-wrap: anywhere; }",
    ".g-grid-cell.is-first { border-inline-start: 1px solid var(--g-rule); }",
    ".g-grid-cell.is-last { border-inline-end: 1px solid var(--g-rule); }",
    ".g-grid-cell.is-top { border-block-start: 1px solid var(--g-rule); }",
    ".g-grid-cell.is-bottom { border-block-end: 1px solid var(--g-rule); }",
    ".g-grid-cell.is-head { font-family: var(--g-furniture); font-size: .74em; letter-spacing: .08em; text-transform: uppercase; color: var(--g-dim); background: var(--g-stock-hi); border-block-end: 1px solid var(--g-rule); }",
    // THE SAME METRICS RENDERED AND RAW. A rendered cell is a paragraph the type
    // scale gave margins; the raw text on open is a bare span. Both are set to
    // one face, one line height and no margin, so opening a cell changes its
    // colour and nothing about where a word is.
    ".g-grid-text { display: block; font: inherit; line-height: inherit; min-height: 1.5em; outline: none; cursor: text; }",
    ".g-grid-text > * { margin: 0; font: inherit; line-height: inherit; }",
    ".g-grid-text > * + * { margin-block-start: .4em; }",
    ".g-grid-text[contenteditable] { white-space: pre-wrap; }",
    ".g-grid-cell.is-open { background: var(--g-stock-hi); box-shadow: inset 0 0 0 1px var(--g-led); color: var(--g-ink); }",
    ".g-grid-cell.is-open.is-head { text-transform: none; letter-spacing: 0; font-family: inherit; font-size: inherit; }",
    // THE GUTTERS: quiet marks that come up when the pointer is on their row or
    // over their column, holding their space so nothing shifts.
    ".g-grid-gut { display: flex; align-items: center; padding: .15rem .5rem .15rem 0; }",
    ".g-grid-gut.is-col { align-items: end; justify-content: center; padding: 0 0 .35rem; }",
    ".g-grid-gut.is-corner { padding: 0; }",
    ".g-grid-gut .g-grid-ctl { opacity: 0; transition: opacity 120ms ease; }",
    ".g-grid-gut.is-on .g-grid-ctl, .g-grid-gut:hover .g-grid-ctl, .g-grid-gut:focus-within .g-grid-ctl { opacity: 1; }",
    "@media (hover: none) { .g-grid-gut .g-grid-ctl { opacity: 1; } }",
    "@media (prefers-reduced-motion: reduce) { .g-grid-gut .g-grid-ctl { transition: none; } }",
    ".g-grid-ctl { font: inherit; font-family: var(--g-gauge); font-size: .66em; line-height: 1; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; color: var(--g-dim); background: transparent; border: 1px solid var(--g-rule); cursor: pointer; padding: .22rem .45rem; }",
    ".g-grid-ctl:hover { color: var(--g-ink); border-color: var(--g-dim); }",
    ".g-grid-ctl:focus-visible { outline: 2px solid var(--g-led); outline-offset: 1px; }",
    ".g-grid-ctl.is-del:hover { color: var(--g-no); border-color: var(--g-no); }",
    ".g-grid-tail { grid-column: 2 / -2; padding-block-start: .5rem; }",
    ".g-grid-side { display: flex; align-items: end; padding: 0 0 .35rem .5rem; }",
    // The refusal, in words, where the pointer is.
    ".g-grid-say { font-family: var(--g-gauge); font-size: .74em; color: var(--g-no); min-height: 1.2em; margin-block-start: .25rem; }",
    ".g-grid-say:empty { display: none; }",
  ].join("\n");

  function ensureSheet() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = SHEET;
    document.head.appendChild(style);
  }

  /* ── the rows ──────────────────────────────────────────────────────────── */

  /** A copy of the rows, every row as long as the widest, every cell a string.
   *  @param {unknown} v @returns {string[][]} */
  function square(v) {
    /** @type {string[][]} */
    const rows = [];
    if (Array.isArray(v)) {
      for (const row of v) {
        if (!Array.isArray(row)) continue;
        rows.push(row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
      }
    }
    const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
    for (const row of rows) while (row.length < width) row.push("");
    return rows;
  }

  /** @param {string[][]} rows */
  function widthOf(rows) {
    return rows.reduce((w, row) => Math.max(w, row.length), 0);
  }

  /* ── the plugin ────────────────────────────────────────────────────────── */

  glob.biom.plugins.register({
    id: "biom-grid",

    /** `edit: false` is a statement rather than a default, exactly as it is on
     *  `biom-table`: a grid IS editable, cell by cell, and this file does the
     *  editing. What the runtime's editor does with `edit: true` — open the
     *  whole part as one region of markdown — is the wrong shape for a board,
     *  so the editor stays away and the writes go through `ctx.write`. */
    edit: false,

    /**
     * @param {Element} node the slot this grid fills
     * @param {any} content the resolved part: `{ kind: "grid", rows, head, vars }`
     * @param {any} ctx the mount context; see `makeCtx` in sections.js
     */
    mount(node, content, ctx) {
      ensureSheet();
      const md = ctx && typeof ctx.has === "function" && ctx.has("markdown") ? ctx.use("markdown") : null;
      /** @type {string[][]} */
      let rows = square(content && content.rows);
      const head = !(content && content.head === false);
      const vars = (content && content.vars) || (ctx && ctx.vars) || {};
      /* A GRID THAT IS ONE ITEM OF A LIST has no door of its own — see the
         header — so it is drawn and its controls are not. A grid drawn by a
         page plugin with no section is the same case. */
      const editable = !!(ctx && ctx.section && ctx.part && !node.hasAttribute("data-g-item"));

      const box = document.createElement("div");
      box.className = "g-grid-box";
      const grid = document.createElement("div");
      grid.className = "g-grid";
      grid.setAttribute("role", "grid");
      const said = document.createElement("div");
      said.className = "g-grid-say";
      said.setAttribute("aria-live", "polite");
      box.appendChild(grid);
      box.appendChild(said);
      node.replaceChildren(box);

      /** Write the rows back, whole. The document is the truth and this copy
       *  is what was just written to it. @param {string[][]} next */
      function write(next) {
        rows = square(next);
        if (!editable) return;
        if (!ctx.write(ctx.part, rows.map((row) => row.slice()))) say("the grid's rows could not be written");
      }

      /** @param {string} kind @param {number} i */
      function light(kind, i) {
        const guts = grid.querySelectorAll(".g-grid-gut." + kind);
        Array.prototype.forEach.call(guts, (g) => {
          g.classList.toggle("is-on", Number(g.getAttribute(kind === "is-row" ? "data-r" : "data-c")) === i);
        });
      }

      /** A cell is markdown, header or body alike, resolved against the same
       *  scopes a markdown part is. @param {Element} el @param {string} text */
      function render(el, text) {
        el.replaceChildren();
        if (md && text !== "") md.mount(el, { kind: "markdown", md: text, vars: vars });
        else el.textContent = text;
      }

      /** @param {string} cls @param {string} label @param {string} title @param {() => void} go */
      function control(cls, label, title, go) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "g-grid-ctl " + cls;
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          said.textContent = "";
          go();
        });
        return b;
      }

      /* IN-PLACE EDIT. The cell opens as its raw markdown, and blur or Enter
         writes the rows whole; Escape puts the cell back. Either way the cell
         is re-rendered where it stands and nothing else on the page moves. */
      /** @param {Element} cell @param {HTMLElement} textEl @param {number} r @param {number} c @param {boolean} isHead */
      function open(cell, textEl, r, c, isHead) {
        if (textEl.getAttribute("contenteditable") === "true") return;
        const current = (rows[r] || [])[c] || "";
        let cancel = false;
        cell.classList.add("is-open");
        textEl.textContent = current;
        textEl.setAttribute("contenteditable", "true");
        textEl.focus();
        try {
          const range = document.createRange();
          range.selectNodeContents(textEl);
          const sel = getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        } catch { /* a cell with nothing to select */ }
        /** @param {KeyboardEvent} e */
        function onKey(e) {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
          if (e.key === "Escape") { e.preventDefault(); cancel = true; textEl.blur(); }
        }
        function onBlur() {
          textEl.removeEventListener("blur", onBlur);
          textEl.removeEventListener("keydown", onKey);
          textEl.removeAttribute("contenteditable");
          cell.classList.remove("is-open");
          // A PIPE STAYS A PIPE. The value is what was typed, trimmed of the
          // whitespace a contenteditable leaves at the ends and nothing else.
          const value = String(textEl.textContent || "").replace(/\u00a0/g, " ").trim();
          if (cancel || value === current) { render(textEl, current); return; }
          render(textEl, value);
          const next = rows.map((row) => row.slice());
          while (next.length <= r) next.push(new Array(widthOf(next) || 1).fill(""));
          while ((next[r] || []).length <= c) /** @type {string[]} */ (next[r]).push("");
          /** @type {string[]} */ (next[r])[c] = value;
          write(next);
        }
        textEl.addEventListener("keydown", onKey);
        textEl.addEventListener("blur", onBlur);
      }

      /** @param {string} text @param {number} r @param {number} c @param {boolean} isHead @param {number} w @param {number} n */
      function cell(text, r, c, isHead, w, n) {
        const el = document.createElement("div");
        el.className = "g-grid-cell" + (isHead ? " is-head" : "") + (c === 0 ? " is-first" : "") + (c === w - 1 ? " is-last" : "") + (r === 0 ? " is-top" : "") + (r === n - 1 ? " is-bottom" : "");
        el.setAttribute("role", isHead ? "columnheader" : "gridcell");
        el.setAttribute("data-r", String(r));
        el.setAttribute("data-c", String(c));
        const textEl = document.createElement("span");
        textEl.className = "g-grid-text";
        render(textEl, text);
        el.appendChild(textEl);
        if (editable) {
          textEl.setAttribute("tabindex", "0");
          textEl.addEventListener("click", (ev) => {
            // A link in a cell is a link; the click follows it and opens nothing.
            const t = /** @type {Element | null} */ (ev.target);
            if (t && typeof t.closest === "function" && t.closest("a[href]")) return;
            ev.stopPropagation();
            open(el, textEl, r, c, isHead);
          });
          textEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && textEl.getAttribute("contenteditable") !== "true") { e.preventDefault(); open(el, textEl, r, c, isHead); }
          });
        }
        // The pointer on a cell lights that row's Delete out in the gutter, and
        // a header cell lights its column's too.
        el.addEventListener("pointerenter", () => { light("is-row", r); if (isHead) light("is-col", c); });
        el.addEventListener("pointerleave", () => { light("is-row", -1); light("is-col", -1); });
        return el;
      }

      /** @param {number} r @param {number} n */
      function rowGutter(r, n) {
        const g = document.createElement("div");
        g.className = "g-grid-gut is-row";
        g.setAttribute("data-r", String(r));
        // THE HEADER HAS NO DELETE: it stays when the last row under it goes,
        // so its gutter holds nothing rather than a control that refuses.
        if (!editable || (head && r === 0)) return g;
        const del = control("is-del", "Delete row", "Delete this row", () => {
          // THE LAST ROW STAYS where there is no header to stay instead: a grid
          // with no rows at all has nothing to add a column to.
          if (!head && n <= 1) { said.textContent = "A grid keeps at least one row."; return; }
          const next = rows.map((row) => row.slice());
          next.splice(r, 1);
          write(next);
          draw();
        });
        del.addEventListener("pointerenter", () => light("is-row", r));
        del.addEventListener("pointerleave", () => light("is-row", -1));
        g.appendChild(del);
        return g;
      }

      /** @param {number} c @param {number} w */
      function colGutter(c, w) {
        const g = document.createElement("div");
        g.className = "g-grid-gut is-col";
        g.setAttribute("data-c", String(c));
        if (!editable) return g;
        const del = control("is-del", "Delete column", "Delete this column", () => {
          // REFUSED IN WORDS: a grid with no columns is not a grid.
          if (w <= 1) { said.textContent = "A grid keeps at least one column."; return; }
          write(rows.map((row) => { const next = row.slice(); next.splice(c, 1); return next; }));
          draw();
        });
        del.addEventListener("pointerenter", () => light("is-col", c));
        del.addEventListener("pointerleave", () => light("is-col", -1));
        g.appendChild(del);
        return g;
      }

      /** Draw the board from the rows. Called on mount and after a row or a
       *  column is added or removed — a cell's own edit is rendered in place
       *  and never comes through here. */
      function draw() {
        const w = Math.max(widthOf(rows), 1);
        const n = rows.length;
        grid.style.setProperty("--g-cols", String(w));
        grid.replaceChildren();
        said.textContent = "";

        // The gutter row: a corner, one Delete column over each column, and
        // Add column beside the last.
        const corner = document.createElement("div");
        corner.className = "g-grid-gut is-corner";
        grid.appendChild(corner);
        for (let c = 0; c < w; c++) grid.appendChild(colGutter(c, w));
        const side = document.createElement("div");
        side.className = "g-grid-side";
        if (editable) {
          side.appendChild(control("is-add", "＋ Add column", "Add a column after the last", () => {
            write(rows.map((row) => row.concat([""])));
            draw();
          }));
        }
        grid.appendChild(side);

        rows.forEach((row, r) => {
          grid.appendChild(rowGutter(r, n));
          for (let c = 0; c < w; c++) grid.appendChild(cell(row[c] || "", r, c, head && r === 0, w, n));
          const trail = document.createElement("div");
          trail.className = "g-grid-gut is-corner";
          grid.appendChild(trail);
        });

        // Add row is the grid's last line: an empty gutter and one cell across
        // every column, so it lines up without measuring anything.
        if (editable) {
          const lead = document.createElement("div");
          lead.className = "g-grid-gut is-corner";
          grid.appendChild(lead);
          const tail = document.createElement("div");
          tail.className = "g-grid-tail";
          tail.appendChild(control("is-add", "＋ Add row", "Add a row under the last", () => {
            write(rows.concat([new Array(w).fill("")]));
            draw();
          }));
          grid.appendChild(tail);
          const trail = document.createElement("div");
          trail.className = "g-grid-gut is-corner";
          grid.appendChild(trail);
        }
      }

      draw();
    },
  });
})();
