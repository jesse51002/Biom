// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-kanban/kanban.js — a table drawn as lanes. A classic script; see
 * registry.js for why there are no imports in here.
 *
 * A PLUGIN IS A PAGE THAT READS A DECLARED INPUT, and this is the second one.
 * The page says `plugin: kanban` and puts the rest under `input:`; this file
 * reads that, asks for the table over the guest port, and draws it. It registers
 * nothing with the plugin registry: a registered plugin fills a SLOT inside
 * somebody else's page, and this IS the page.
 *
 * IT IS THE SAME CONTRACT AN INSTALLED PLUGIN WOULD HAVE. Nothing here is
 * reachable only because the file ships in this repo — it asks the host the same
 * questions a workspace's own board would, over the same port, and a vault that
 * wrote its own `plugins/kanban/index.html` would replace this one by being
 * found first.
 *
 * THE LANES COME FROM THE COLUMN, NOT FROM THIS FILE. A `categories` column
 * carries its own options, in the order somebody put them in, each with a palette
 * role for its colour — so the board's shape and its colours are the table's and
 * this file invents neither. The one lane it does invent is the trailing one for
 * rows whose value is empty or is a label the column no longer offers, because
 * those rows exist and a board that hid them would be a board that lied.
 *
 * COLOURS ARE TOKENS. The shim re-declares the vault's palette on `:root` inside
 * this box, so `var(--cyan)` resolves here and the board takes the workspace's
 * paper rather than the chrome's. That is the whole difference between this and
 * the app around it: the chrome has one scheme, a page has the vault's.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);

  /* ── the part with no DOM in it ────────────────────────────────────────── */

  /** A palette ROLE as a custom property, or the quiet default.
   *
   *  Lowercased first, because `_options` holds what somebody typed and the
   *  roles in a real workspace are spelled `Won` and `Warning` as often as
   *  `cyan`. Validated because the value ends up inside `var(--…)`. */
  /** @param {unknown} role @returns {string} */
  function roleVar(role) {
    const name = String(role || "").toLowerCase();
    return /^[a-z][a-z0-9-]*$/.test(name) ? "var(--" + name + ", currentColor)" : "var(--ink-3, currentColor)";
  }

  /** The labels in a categories cell. Stored as a JSON array; tolerant of the
   *  two spellings a CSV import leaves behind. */
  /** @param {unknown} value @returns {string[]} */
  function labelsOf(value) {
    if (value === null || value === undefined || value === "") return [];
    if (typeof value !== "string") return [String(value)];
    const text = value.trim();
    if (text.startsWith("[")) {
      try {
        const list = JSON.parse(text);
        if (Array.isArray(list)) return list.map((/** @type {unknown} */ v) => String(v)).filter(Boolean);
      } catch { /* fall through */ }
    }
    return text.split(/\s*[;,]\s*/).filter(Boolean);
  }

  /** The lanes a column offers, in its own order, plus the one for everything
   *  else. @param {any} column @param {string} named */
  /** @param {any} column @param {string} named @returns {any[]} */
  function lanesOf(column, named) {
    const out = (column && Array.isArray(column.options) ? column.options : []).map((/** @type {any} */ o) => ({
      label: String(o.label),
      colour: roleVar(o.colour),
      none: false,
      rows: [],
    }));
    out.push({ label: "No " + named, colour: roleVar("ink-3"), none: true, rows: [] });
    return out;
  }

  /** Which lane a cell belongs in. THE FIRST LABEL WINS where there are several:
   *  a cell can hold more than one and a card cannot be in two places, so the
   *  board reads the first and a drop replaces all of them. */
  /** @param {unknown} cell @param {Set<string>} known @returns {string | null} */
  function laneOf(cell, known) {
    const first = labelsOf(cell)[0];
    return first !== undefined && known.has(first) ? first : null;
  }

  /** Fill each lane's rows. Returns the lanes, for reading. */
  /** @param {any[]} rows @param {any[]} lanes @returns {any[]} */
  function group(rows, lanes) {
    const known = new Set(lanes.filter((l) => !l.none).map((l) => l.label));
    const byLabel = new Map(lanes.map((l) => [l.label, l]));
    const rest = lanes[lanes.length - 1];
    for (const row of rows) {
      const label = laneOf(row.lane, known);
      const lane = label === null ? rest : byLabel.get(label);
      if (lane) lane.rows.push(row);
    }
    // THE INVENTED LANE EARNS ITS PLACE ONLY WHEN SOMETHING IS IN IT. It exists
    // because rows with no lane exist and a board that hid them would be a board
    // that lied — but with nothing in it there is nothing to hide, and an
    // always-drawn empty lane costs a whole column on a window that has four.
    return rest && rest.none && rest.rows.length === 0 ? lanes.slice(0, -1) : lanes;
  }

  /** One cell as words. A `page` cell is an id and reads as one; a `link` names
   *  a row in another table and is not a page, so it is never opened. */
  /** @param {unknown} value @param {any} column @returns {string} */
  function textOf(value, column) {
    if (column && column.type === "categories") return labelsOf(value).join(", ");
    if (value === null || value === undefined) return "";
    if (column && column.type === "checkbox") return value ? "yes" : "";
    return String(value);
  }

  /** The card for one row, as data. @param {any} row @param {any} input
   *  @param {Record<string, any>} columns */
  /** @param {any} row @param {any} input @param {Record<string, any>} columns */
  function cardOf(row, input, columns) {
    const cells = row.cells || {};
    const shown = Array.isArray(input.show) ? input.show : [];
    return {
      id: row.id,
      title: textOf(cells[input.name], columns[input.name]) || "Untitled",
      page: input.page && columns[input.page] && columns[input.page].type === "page"
        ? (cells[input.page] ? String(cells[input.page]) : null)
        : null,
      // EVERY FIELD THE PAGE ASKED FOR, blank ones included. A card that hides
      // its empties is a card whose shape changes row by row, and a column of
      // them cannot be read down — which is the whole reason a board is columns.
      fields: shown.map((/** @type {string} */ name) => ({
        name: name,
        text: textOf(cells[name], columns[name]),
        labels: columns[name] && columns[name].type === "categories" ? labelsOf(cells[name]) : [],
      })),
    };
  }

  /** THE BOARD AS MARKDOWN, which is this page's half of the archive.
   *
   *  A lane is a heading and a card is a bullet, because that is what a board IS
   *  when the columns are taken away: a grouping, in an order, of named things.
   *  An empty lane is written anyway — that a stage is empty is a fact about the
   *  work, and a projection that dropped it would read as a board with fewer
   *  stages than it has. */
  /** @param {any[]} lanes @returns {string} */
  function toMarkdown(lanes) {
    return lanes
      .map((/** @type {any} */ lane) => {
        const cards = lane.rows.map((/** @type {any} */ card) => {
          // The projection leaves blanks out: an em dash in a markdown bullet
          // is a word about nothing, where on a card it is a column holding its
          // shape.
          const tail = card.fields
            .filter((/** @type {any} */ f) => f.text !== "")
            .map((/** @type {any} */ f) => f.name + ": " + f.text)
            .join(" · ");
          return "- **" + card.title + "**" + (tail === "" ? "" : " · " + tail);
        });
        return "## " + lane.label + "\n\n" + (cards.length ? cards.join("\n") : "*(nothing here)*");
      })
      .join("\n\n");
  }

  glob.__gKanban = { roleVar, labelsOf, lanesOf, laneOf, group, textOf, cardOf, toMarkdown };

  /* ── the part that draws ───────────────────────────────────────────────── */

  if (typeof document === "undefined" || !glob.biom) return;

  const biom = glob.biom;
  const CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; background: var(--stock, #fff); color: var(--ink, #111);
         font: 400 0.9rem/1.5 var(--furniture-face, system-ui, sans-serif); }

  /* THE BOARD IS THE VIEWPORT. It fills the box and scrolls in both directions
     inside itself: the lanes move together vertically, so a card in one column
     stays level with a card in the next, and the horizontal scrollbar sits at
     the bottom of the SCREEN rather than below the tallest lane — which on two
     hundred cards would be forty thousand pixels down and unreachable.

     Lanes size to their own content and scroll with the board rather than each
     one scrolling separately. */
  .kb { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
  .kb-head { flex: 0 0 auto; padding: 1.5rem 1.25rem 0.75rem; }
  .kb-bar { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
  .kb-tools { display: flex; align-items: center; gap: 0.4rem; flex: 0 0 auto; }
  .kb-title { margin: 0; font: 600 1.4rem/1.2 var(--sheet-face, Georgia, serif); color: var(--ink, #111); }

  .kb-set {
    font: 0.72rem/1.4 var(--furniture-face, system-ui, sans-serif);
    letter-spacing: 0.05em; text-transform: uppercase;
    padding: 0.25rem 0.6rem; cursor: pointer;
    border: 1px solid var(--rule, rgba(0,0,0,0.2)); border-radius: 2px;
    background: none; color: var(--ink-3, #666);
  }
  .kb-set:hover { color: var(--ink, #111); border-color: var(--ink-3, #666); }
  .kb-set[aria-expanded="true"] { color: var(--ink, #111); background: var(--stock-hi, rgba(0,0,0,0.03)); }

  /* THE PANEL IS PART OF THE PAGE rather than floating over it, so opening it
     never covers the board it is describing — a setting is chosen by watching
     what it does. */
  /* AN EXPLICIT display BEATS THE BROWSER'S OWN [hidden] RULE, so the panel has
     to say so itself. The default sheet carries [hidden] display:none at the very
     bottom of the cascade; a rule here setting display:grid wins against it on
     specificity alone, and the panel stayed on screen with its hidden property
     perfectly true. */
  .kb-panel[hidden] { display: none; }
  .kb-panel {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 1rem 1.5rem; margin-block-start: 0.875rem; padding: 0.875rem 1rem;
    border: 1px solid var(--rule, rgba(0,0,0,0.15)); border-radius: 2px;
    background: var(--stock-hi, rgba(0,0,0,0.02));
  }
  .kb-group-name {
    margin: 0 0 0.15rem; font: 600 0.7rem/1.3 var(--furniture-face, system-ui, sans-serif);
    letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink, #111);
  }
  .kb-group-note { margin: 0 0 0.4rem; font: 0.7rem/1.35 var(--furniture-face, system-ui, sans-serif); color: var(--ink-3, #666); }
  .kb-choices { display: flex; flex-direction: column; gap: 0.1rem; max-height: 11rem; overflow-y: auto; }
  .kb-choice {
    display: flex; align-items: center; gap: 0.4rem; cursor: pointer;
    font: 0.78rem/1.5 var(--sheet-face, Georgia, serif); color: var(--ink-2, #333);
  }
  .kb-choice:hover { color: var(--ink, #111); }
  .kb-choice input { accent-color: var(--cyan, #1543D6); margin: 0; }
  .kb-none { margin: 0; font: 0.75rem/1.4 var(--furniture-face, system-ui, sans-serif); color: var(--ink-3, #666); }

  .kb-lanes {
    flex: 1 1 auto; min-height: 0;
    /* THE LANES SHARE THE WIDTH, down to a floor, and scroll below it. They were
       sized minmax(26rem, 1fr) on grid-auto-columns, which never shrinks — so a
       four-lane board wanted 1746px, the app's own 1440 window gave it 1246, and
       the last lane was simply never on screen. A board whose final column
       cannot be seen is not a board. The count comes in as --kb-lanes, set where
       the lanes are drawn, because CSS cannot count them and auto-fit would wrap
       them onto a second row — and a board's lanes are one row. */
    display: grid; grid-template-columns: repeat(var(--kb-lanes, 1), minmax(16rem, 1fr));
    /* EVERY LANE IS AS TALL AS THE TALLEST, which is what stretch on a grid row
       means: the row takes the height of its biggest item and the rest fill it.
       Sized to their own cards instead, a short lane ended part way down and its
       sticky heading stopped with it — so the lane you were scrolling past still
       said which lane it was, and the empty ones beside it did not. */
    gap: 0.875rem; align-items: stretch;
    overflow: auto; overscroll-behavior-x: contain;
    padding: 0 1.25rem 1.25rem;
    /* THE BAR BRIGHTENS WHILE THE POINTER IS MOVING and settles back when it
       stops. A scrollbar that is always at full strength is a stripe across the
       bottom of every board; one that is always faint is a board that looks
       cut off. This is the middle: quiet at rest, obvious the moment somebody
       reaches for it. */
    scrollbar-width: auto;
    scrollbar-color: var(--rule, rgba(0,0,0,0.25)) transparent;
    transition: scrollbar-color 160ms ease;
  }
  .kb-lanes[data-live] { scrollbar-color: var(--ink-3, rgba(0,0,0,0.45)) transparent; }
  .kb-lanes::-webkit-scrollbar { height: 0.85rem; width: 0.85rem; }
  .kb-lanes::-webkit-scrollbar-track { background: transparent; }
  .kb-lanes::-webkit-scrollbar-thumb {
    background: var(--rule, rgba(0,0,0,0.22)); border-radius: 999px;
    border: 4px solid transparent; background-clip: content-box;
    transition: background-color 160ms ease;
  }
  .kb-lanes[data-live]::-webkit-scrollbar-thumb { background: var(--ink-3, rgba(0,0,0,0.45)); background-clip: content-box; }
  .kb-lanes::-webkit-scrollbar-thumb:hover { background: var(--ink-2, rgba(0,0,0,0.6)); background-clip: content-box; }

  .kb-lane {
    display: flex; flex-direction: column; gap: 0.5rem;
    min-inline-size: 0; padding: 0 0.625rem 0.625rem;
    border: 1px solid var(--rule, rgba(0,0,0,0.15)); border-radius: 2px;
    background: var(--stock-hi, rgba(0,0,0,0.02));
  }
  .kb-lane[data-over] { border-color: var(--ink-3, #666); }

  /* THE HEAD STAYS while its cards go past. Two hundred cards deep in a lane,
     the thing you most need to know is which lane you are in — and the count
     beside it is what says whether you have reached the end of it.

     It carries the lane's own top padding rather than the lane carrying it, so
     the background it sticks with covers the gap above the first card instead of
     letting a card show through above the heading. */
  .kb-lane-head {
    position: sticky; top: 0; z-index: 1;
    display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem;
    padding-block: 0.625rem 0.45rem;
    background: var(--stock-hi, rgba(0,0,0,0.02));
    border-block-end: 2px solid var(--tint, var(--rule, rgba(0,0,0,0.2)));
  }
  .kb-lane-name {
    font: 600 0.74rem/1.2 var(--furniture-face, system-ui, sans-serif);
    letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink, #111);
  }
  .kb-count { font: 0.74rem/1 var(--gauge-face, ui-monospace, monospace); color: var(--ink-3, #666); }

  .kb-card {
    display: block; inline-size: 100%; text-align: start;
    padding: 0.55rem 0.625rem;
    border: 1px solid var(--rule, rgba(0,0,0,0.15)); border-radius: 2px;
    background: var(--stock, #fff); color: inherit; font: inherit;
    cursor: grab;
  }
  .kb-card:focus-visible { outline: 2px solid var(--ink, #111); outline-offset: 2px; }
  .kb-card[data-lifting] { opacity: 0.45; }
  .kb-card[data-open]:hover { border-color: var(--ink-3, #666); }

  .kb-card-title { display: block; font: 500 0.92rem/1.25 var(--sheet-face, Georgia, serif); color: var(--ink, #111); }

  /* THE FIELDS ARE A DEFINITION LIST, two columns: the name in small uppercase
     furniture on the left, the value in the sheet face on the right. Every field
     the page asked for is drawn even when it is empty, because a card that hides
     its blanks is a card whose shape changes row by row and cannot be scanned
     down a column. */
  .kb-fields {
    display: grid; grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr);
    gap: 0.15rem 0.5rem; margin-block-start: 0.4rem;
  }
  .kb-fields dt {
    font: 0.68rem/1.4 var(--furniture-face, system-ui, sans-serif);
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-3, #666);
  }
  .kb-fields dd { margin: 0; font: 0.78rem/1.4 var(--sheet-face, Georgia, serif); color: var(--ink-2, #333); min-inline-size: 0; }
  .kb-fields dd[data-empty] { color: var(--ink-3, #666); }

  .kb-tag {
    display: inline-block; padding: 0.05rem 0.35rem; margin-inline-end: 0.2rem;
    border: 1px solid currentColor; border-radius: 2px;
    font: 0.68rem/1.5 var(--furniture-face, system-ui, sans-serif);
    color: var(--tag-ink, var(--ink-3, #666));
  }

  .kb-empty { font: 0.74rem/1.4 var(--furniture-face, system-ui, sans-serif); color: var(--ink-3, #666); padding: 0.15rem 0 0.35rem; }
  .kb-lane:has(.kb-card) .kb-empty { display: none; }

  .kb-fault { margin: 1.5rem 1.25rem; font: 0.8rem/1.5 var(--furniture-face, system-ui, sans-serif); color: var(--magenta-t, #a11); }

  @container (width <= 40rem) {
    /* On a phone a lane is read one at a time, so they stop sharing and scroll. */
    .kb-lanes { grid-template-columns: repeat(var(--kb-lanes, 1), minmax(20rem, 92cqi)); }
  }
  `;

  /** @type {any[]} */
  let current = [];
  let generation = 0;

  /** @param {string} tag @param {string | null} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** @param {Element} root @param {string} words */
  function fault(root, words) {
    root.replaceChildren(el("p", "kb-fault", words));
  }

  /** @param {Element} root @param {any} input */
  async function load(root, input) {
    const mine = ++generation;
    for (const key of ["table", "lanes", "name"]) {
      if (typeof input[key] !== "string" || input[key] === "") {
        fault(root, "this board needs " + key + " set: table names the table, " +
          "lanes the categories column its lanes come from, and name the column a " +
          "card is titled by. Set them under Settings, or in the page's variables.");
        return null;
      }
    }
    const [schema, view] = await Promise.all([
      biom.schema(input.table).catch((/** @type {any} */ e) => ({ __fail: e })),
      biom.table(input.table).catch((/** @type {any} */ e) => ({ __fail: e })),
    ]);
    if (mine !== generation) return null;

    // The two fail apart, and the schema is the one that decides whether there
    // is a board at all.
    if (!schema || schema.__fail) {
      fault(root, 'the table "' + input.table + '" could not be read: ' +
        String((schema && schema.__fail && schema.__fail.message) || "no such table"));
      return null;
    }
    /** @type {Record<string, any>} */
    const columns = {};
    for (const col of schema.columns || []) columns[col.name] = col;
    const laneCol = columns[input.lanes];
    if (!laneCol || laneCol.type !== "categories") {
      fault(root, '"' + input.lanes + '" is not a categories column on ' + input.table +
        ", and lanes come from a column's own options.");
      return schema;
    }
    if (!columns[input.name]) {
      fault(root, '"' + input.name + '" is not a column on ' + input.table + ", so a card has no title.");
      return schema;
    }
    const rows = (view && !view.__fail && view.rows) || [];
    const cards = rows.map((/** @type {any} */ row) => {
      /** @type {any} */
      const card = cardOf(row, input, columns);
      // The cell the lane is decided from, carried on the card so grouping does
      // not have to reach back into the row.
      card.lane = (row.cells || {})[input.lanes];
      return card;
    });
    current = group(cards, lanesOf(laneCol, input.lanes));
    draw(root, input, columns);
    return schema;
  }

  /** @param {Element} root @param {any} input @param {Record<string, any>} columns */
  function draw(root, input, columns) {
    const lanes = /** @type {HTMLElement} */ (el("div", "kb-lanes"));
    // The count is a fact the grid needs and CSS cannot count, so it is handed
    // over rather than guessed at with auto-fit — which would wrap lanes onto a
    // second row, and a board's lanes are a row.
    lanes.style.setProperty("--kb-lanes", String(current.length));
    for (const lane of current) lanes.appendChild(laneNode(lane, root, input, columns));
    root.replaceChildren(lanes);
    wakeTheBar(lanes);
    // THE ROWS ARRIVED AFTER THE PAGE DREW, so the projection taken at the draw
    // was of an empty board. This is the page saying it has something to say now.
    document.dispatchEvent(new CustomEvent("biom:rendered"));
  }

  /** Brighten the scrollbars while the pointer is moving over the board, and let
   *  them settle once it stops. @param {HTMLElement} lanes */
  function wakeTheBar(lanes) {
    /** @type {any} */
    let resting = 0;
    const wake = () => {
      lanes.setAttribute("data-live", "");
      clearTimeout(resting);
      resting = setTimeout(() => lanes.removeAttribute("data-live"), 900);
    };
    lanes.addEventListener("pointermove", wake, { passive: true });
    lanes.addEventListener("scroll", wake, { passive: true });
    lanes.addEventListener("pointerleave", () => {
      clearTimeout(resting);
      lanes.removeAttribute("data-live");
    });
  }

  /** THE SETTINGS THE BOARD OFFERS, drawn by the board itself.
   *
   *  Every choice here is a column of the table it is already reading, so the
   *  panel is built from the schema rather than from anything typed in: a column
   *  added to the table turns up here without this file changing. The board is
   *  the one that knows what a lane means, so the board is what asks — nothing in
   *  the host has to learn what a kanban is for this to work, which is the whole
   *  point of a plugin being a page.
   *
   *  `table` is deliberately not offered. Pointing a board at a different table
   *  invalidates every other setting on it at once, and that is a new board
   *  rather than a setting changed.
   *  @param {HTMLElement} panel @param {any} schema @param {any} input
   *  @param {(patch: Record<string, any>) => void} apply */
  function settingsPanel(panel, schema, input, apply) {
    const columns = (schema && schema.columns) || [];
    panel.replaceChildren();

    /** One group of choices. @param {string} label @param {string} note */
    const group = (label, note) => {
      const box = el("section", "kb-group");
      box.appendChild(el("h2", "kb-group-name", label));
      if (note) box.appendChild(el("p", "kb-group-note", note));
      const list = el("div", "kb-choices");
      box.appendChild(list);
      panel.appendChild(box);
      return list;
    };

    /** @param {string} kind @param {string} name @param {string} text
     *  @param {boolean} on @param {() => void} pick */
    const choice = (kind, name, text, on, pick) => {
      const label = el("label", "kb-choice");
      const box = /** @type {HTMLInputElement} */ (document.createElement("input"));
      box.type = kind;
      box.name = name;
      box.checked = on;
      box.addEventListener("change", pick);
      label.appendChild(box);
      label.appendChild(el("span", null, text));
      return label;
    };

    // GROUP BY — a categories column, because the lanes ARE that column's own
    // options and no other type carries any.
    const lanes = group("Group by", "The lanes are this column's options, in the order the table keeps them.");
    const laneCols = columns.filter((/** @type {any} */ c) => c.type === "categories");
    if (laneCols.length === 0) lanes.appendChild(el("p", "kb-none", "This table has no categories column, so it cannot be grouped."));
    for (const col of laneCols) {
      lanes.appendChild(choice("radio", "lanes", col.name, col.name === input.lanes, () => apply({ lanes: col.name })));
    }

    // CARD TITLE — any column can name a card, because any column might be what
    // a row is called.
    const title = group("Card title", "");
    for (const col of columns) {
      title.appendChild(choice("radio", "name", col.name, col.name === input.name, () => apply({ name: col.name })));
    }

    // OPENS — only a `page` column holds a page id. A `link` names a row in
    // another table and is not a page, which is why it is not offered.
    const opens = group("Opening a card", "Only a page column holds a page to open.");
    const pageCols = columns.filter((/** @type {any} */ c) => c.type === "page");
    opens.appendChild(choice("radio", "page", "nothing", !input.page, () => apply({ page: "" })));
    for (const col of pageCols) {
      opens.appendChild(choice("radio", "page", col.name, col.name === input.page, () => apply({ page: col.name })));
    }

    // SHOWN — every column, in the table's own order, and the order they are
    // ticked in is the order they are drawn in.
    const shown = group("Shown on a card", "In the order the table keeps them.");
    for (const col of columns) {
      const on = input.show.indexOf(col.name) >= 0;
      shown.appendChild(choice("checkbox", "show", col.name, on, () => {
        const next = on
          ? input.show.filter((/** @type {string} */ n) => n !== col.name)
          : [...input.show, col.name];
        apply({ show: next });
      }));
    }
  }

  /** ONE LANE: a heading with the column's own colour under it, and its cards.
   *  A drop writes the lane column and nothing else — the card jumps under the
   *  pointer first because the answer takes a round trip and a board that waited
   *  would feel broken, and the refresh that follows redraws from what was
   *  actually stored.
   *  @param {any} lane @param {Element} root @param {any} input
   *  @param {Record<string, any>} columns */
  function laneNode(lane, root, input, columns) {
    const node = el("section", "kb-lane");
    node.style.setProperty("--tint", lane.colour);

    const head = el("div", "kb-lane-head");
    head.appendChild(el("span", "kb-lane-name", lane.label));
    head.appendChild(el("span", "kb-count", String(lane.rows.length)));
    node.appendChild(head);

    node.appendChild(el("p", "kb-empty", "Nothing at this stage."));
    for (const card of lane.rows) node.appendChild(cardNode(card, input, columns));

    node.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      node.setAttribute("data-over", "");
    });
    node.addEventListener("dragleave", (ev) => {
      if (!node.contains(/** @type {Node | null} */ (ev.relatedTarget))) node.removeAttribute("data-over");
    });
    node.addEventListener("drop", (ev) => {
      ev.preventDefault();
      node.removeAttribute("data-over");
      const id = ev.dataTransfer && ev.dataTransfer.getData("text/plain");
      if (!id) return;
      /** @type {Record<string, string>} */
      const patch = {};
      patch[input.lanes] = lane.none ? "[]" : JSON.stringify([lane.label]);
      biom.update(input.table, Number(id), patch).catch((/** @type {any} */ e) => {
        fault(root, "that card could not be moved: " + String((e && e.message) || e));
      });
    });
    return node;
  }

  /** @param {any} card @param {any} input @param {Record<string, any>} columns */
  function cardNode(card, input, columns) {
    const node = /** @type {HTMLButtonElement} */ (el("button", "kb-card"));
    node.type = "button";
    node.draggable = true;
    node.appendChild(el("span", "kb-card-title", card.title));

    if (card.fields.length > 0) {
      const list = el("dl", "kb-fields");
      for (const field of card.fields) {
        list.appendChild(el("dt", null, field.name));
        const dd = el("dd");
        const col = columns[field.name];
        if (col && col.type === "categories" && field.labels.length > 0) {
          // A categories value reads as the pills the table draws it with, and
          // takes each label's own colour where the column gave it one.
          for (const label of field.labels) {
            const tag = el("span", "kb-tag", label);
            const opt = (col.options || []).find((/** @type {any} */ o) => o.label === label);
            if (opt) tag.style.setProperty("--tag-ink", roleVar(opt.colour));
            dd.appendChild(tag);
          }
        } else if (field.text === "") {
          dd.setAttribute("data-empty", "");
          dd.textContent = "—";
        } else {
          dd.textContent = field.text;
        }
        list.appendChild(dd);
      }
      node.appendChild(list);
    }

    node.addEventListener("dragstart", (ev) => {
      if (ev.dataTransfer) {
        ev.dataTransfer.setData("text/plain", String(card.id));
        ev.dataTransfer.effectAllowed = "move";
      }
      node.setAttribute("data-lifting", "");
    });
    node.addEventListener("dragend", () => node.removeAttribute("data-lifting"));

    if (card.page) {
      node.setAttribute("data-open", "");
      node.title = "Open " + card.title;
      node.addEventListener("click", () => biom.open({ kind: "page", id: card.page }));
    }
    return node;
  }

  /** WHAT THE BOARD IS SET TO, and it lives in the page's VARIABLES.
   *
   *  Not under `input:`, and the difference is the whole reason this board can be
   *  configured at all: `variables` is defined as the values a person may change
   *  without writing code, so the wire already carries both halves — `data.get`
   *  reads them and `data.set` writes them, scoped to the page the box is mounted
   *  on. A setting kept anywhere else would need the host to grow a way to write
   *  it, and the host would then have to know what a board's settings mean.
   *
   *  So every plugin page gets this for free: whatever it reads out of its own
   *  variables, it can also offer to change. */
  const SETTINGS = ["table", "lanes", "name", "page", "show"];

  /** @param {Record<string, any>} vars */
  function settingsOf(vars) {
    const out = /** @type {Record<string, any>} */ ({});
    for (const key of SETTINGS) if (vars[key] !== undefined) out[key] = vars[key];
    out.show = Array.isArray(out.show) ? out.show.map(String) : [];
    return out;
  }

  async function main() {
    // THIS DOCUMENT'S OWN ELEMENT, AND THE GUARD. The runtime does not build a
    // root on a page it is not drawing — it did once, and cleared it, which
    // deleted the board a moment after it was drawn — so the board owns its
    // markup outright. And this script is in the bundle every page carries,
    // because every plugin folder's scripts are: on a page that is not a board
    // there is no `#g-board`, and the script does nothing at all.
    const root = document.getElementById("g-board");
    if (!root) return;

    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const page = biom.input || {};

    const shell = el("div", "kb");
    const head = el("div", "kb-head");
    const bar = el("div", "kb-bar");
    bar.appendChild(el("h1", "kb-title", page.name || "Board"));
    const tools = el("div", "kb-tools");
    // THE TABLE THE BOARD IS OF. A board is one reading of a table and never the
    // whole of it — the columns it does not show are still there — so the way
    // back to all of it belongs on the board rather than only in the sidebar.
    // `open` already carries a table target and the app already has the grid.
    const tableBtn = /** @type {HTMLButtonElement} */ (el("button", "kb-set", "View table"));
    tableBtn.type = "button";
    tools.appendChild(tableBtn);
    const settingsBtn = /** @type {HTMLButtonElement} */ (el("button", "kb-set", "Settings"));
    settingsBtn.type = "button";
    tools.appendChild(settingsBtn);
    bar.appendChild(tools);
    head.appendChild(bar);
    const panel = el("div", "kb-panel");
    panel.hidden = true;
    head.appendChild(panel);
    shell.appendChild(head);
    const body = el("div");
    body.style.cssText = "flex:1 1 auto; min-height:0; display:flex;";
    shell.appendChild(body);
    root.replaceChildren(shell);

    /** THE PANEL IS SHUT UNLESS IT WAS ASKED FOR, and three things shut it: the
     *  button again, a press anywhere else, and Escape. A panel that can only be
     *  closed by finding the one control that opened it is a panel people leave
     *  open, and this one takes room from the board it is describing. */
    const showPanel = (/** @type {boolean} */ on) => {
      panel.hidden = !on;
      settingsBtn.setAttribute("aria-expanded", String(on));
    };
    showPanel(false);

    tableBtn.addEventListener("click", () => {
      const table = String((input && input.table) || "");
      if (table !== "") biom.open({ kind: "table", id: table });
    });

    // THE PRESS AND THE CLICK ARE TWO EVENTS, and the press comes first. The
    // document closes the panel on any pointerdown outside it, so a pointerdown
    // on this button closed the panel and the click that followed reopened it —
    // the button did nothing at all while the panel was open, twice over.
    // Stopping the click was not enough; the press is what has to be kept from
    // the document.
    settingsBtn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    settingsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      showPanel(panel.hidden);
    });
    // A press inside the panel is somebody using it, so it stops here rather
    // than reaching the document and closing the thing being used.
    panel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    document.addEventListener("pointerdown", () => {
      if (!panel.hidden) showPanel(false);
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !panel.hidden) {
        showPanel(false);
        settingsBtn.focus();
      }
    });

    // The projection is asked for by the runtime after every draw, so it reads
    // whatever the last load put here.
    biom.toMarkdown = () => toMarkdown(current);

    let input = settingsOf(await biom.data().catch(() => ({})));

    const redraw = async () => {
      const schema = await load(body, input);
      if (schema) settingsPanel(panel, schema, input, apply);
    };

    /** A setting changed: write it to the page and draw what it now says. The
     *  write is not awaited before drawing, because the board already knows what
     *  it was told and a panel that waited on a round trip would feel broken.
     *  @param {Record<string, any>} patch */
    const apply = (patch) => {
      input = { ...input, ...patch };
      void biom.setData(patch).catch((/** @type {any} */ e) => {
        fault(body, "that setting could not be saved: " + String((e && e.message) || e));
      });
      void redraw();
    };

    await redraw();
    biom.onRefresh(() => void redraw());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true });
  else main();
})();
