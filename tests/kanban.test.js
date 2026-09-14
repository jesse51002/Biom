// SPDX-License-Identifier: AGPL-3.0-only
// The shipped kanban page, run outside the box.
//
// It is a PAGE rather than a slot plugin — it registers nothing, it reads
// `biom.input` and draws a whole document — so it is loaded here the way
// the box loads it and its pure half is read off the global it hangs itself on.
//
// WHAT THIS CANNOT SEE: there is no DOM here, so drawing, the drag and the drop
// are not covered. What IS covered is every decision the board makes before it
// touches an element — which lane a card belongs in, what a card says, and what
// the whole board says as markdown.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const glob = /** @type {any} */ (globalThis);

/** The file, evaluated with no `document` and no `biom` — which is exactly
 *  how it decides to skip its drawing half. */
function kanban() {
  delete glob.biom;
  delete glob.__gKanban;
  new Function(readFileSync(new URL("../guest/plugins/kanban/kanban.js", import.meta.url), "utf8"))();
  return glob.__gKanban;
}

const kb = kanban();

/** A `categories` column with options on it, as `table.schema` answers it: the
 *  options in their stored order, each with a palette role. */
const STATUS = {
  name: "status",
  type: "categories",
  options: [
    { label: "Ready", colour: "cyan" },
    { label: "Blocked", colour: "nonrepro" },
    { label: "Waiting", colour: "ink-3" },
    { label: "Archived", colour: "yellow" },
  ],
};

test("the lanes are the column's own options, in its own order, plus one for everything else", () => {
  const lanes = kb.lanesOf(STATUS, "status");
  expect(lanes.map((l) => l.label)).toEqual(["Ready", "Blocked", "Waiting", "Archived", "No status"]);
  // The board's shape and its colours are the TABLE'S. Nothing here invents a
  // lane except the last, which exists because rows with no label exist and a
  // board that hid them would be a board that lied.
  expect(lanes[0].colour).toBe("var(--cyan, currentColor)");
  expect(lanes.at(-1).none).toBe(true);
});

test("a role is a token, lowercased, and anything that is not a name is the quiet default", () => {
  // `_options` holds what somebody typed, and a real workspace spells them
  // `Won` and `Warning` as readily as `cyan`.
  expect(kb.roleVar("Won")).toBe("var(--won, currentColor)");
  // It ends up inside `var(--…)`, so it is checked rather than trusted.
  expect(kb.roleVar("x; y")).toBe("var(--ink-3, currentColor)");
  expect(kb.roleVar(null)).toBe("var(--ink-3, currentColor)");
});

test("a cell decides one lane, and everything unplaceable lands in the last one", () => {
  const lanes = kb.lanesOf(STATUS, "status");
  const known = new Set(["Ready", "Blocked", "Waiting", "Archived"]);
  // Stored as a JSON array, which is what the server writes.
  expect(kb.laneOf('["Blocked"]', known)).toBe("Blocked");
  // THE FIRST LABEL WINS where a cell holds several: a card cannot be in two
  // places, so the board reads the first and a drop replaces all of them.
  expect(kb.laneOf('["Archived","Ready"]', known)).toBe("Archived");
  // A CSV import leaves a bare label behind, and it still means the lane.
  expect(kb.laneOf("Ready", known)).toBe("Ready");
  // Empty, absent, or a label the column no longer offers.
  for (const cell of [null, "", "[]", '["Nope"]']) expect(kb.laneOf(cell, known)).toBe(null);
  expect(lanes.at(-1).label).toBe("No status");
});

test("every row lands in exactly one lane, including the ones with nothing in the column", () => {
  const rows = [
    { id: 1, lane: '["Ready"]' },
    { id: 2, lane: '["Blocked"]' },
    { id: 3, lane: null },
    { id: 4, lane: '["Gone"]' },
  ];
  const lanes = kb.group(rows, kb.lanesOf(STATUS, "status"));
  expect(lanes.map((l) => l.rows.length)).toEqual([1, 1, 0, 0, 2]);
  expect(lanes.reduce((n, l) => n + l.rows.length, 0)).toBe(rows.length);
});

test("a card is titled by one column and carries every column it was asked for", () => {
  const columns = {
    item: { name: "item", type: "text" },
    tags: { name: "tags", type: "categories" },
    count: { name: "count", type: "number" },
    doc: { name: "doc", type: "page" },
    link: { name: "link", type: "url" },
  };
  const row = { id: 7, cells: { item: "Kettle", tags: '["Copper","Hot"]', count: 25, doc: "home/things/kettle", link: "x" } };
  const card = kb.cardOf(row, { name: "item", show: ["tags", "count"], page: "doc" }, columns);
  expect(card.title).toBe("Kettle");
  // A categories cell reads as a sentence rather than as its storage, and keeps
  // its labels so the card can draw them as the pills the table draws them with.
  expect(card.fields).toEqual([
    { name: "tags", text: "Copper, Hot", labels: ["Copper", "Hot"] },
    { name: "count", text: "25", labels: [] },
  ]);
  // The page column is what makes a card openable, and only a `page` column is.
  expect(card.page).toBe("home/things/kettle");
  expect(kb.cardOf(row, { name: "item", show: [], page: "link" }, columns).page).toBe(null);
  // AN EMPTY FIELD IS KEPT, and the card draws it as an em dash. A card that
  // hides its blanks is a card whose shape changes row by row, and a column of
  // those cannot be read down — which is the whole reason a board is columns.
  const bare = kb.cardOf({ id: 8, cells: { item: "Lathe" } }, { name: "item", show: ["tags"] }, columns);
  expect(bare.fields).toEqual([{ name: "tags", text: "", labels: [] }]);
  // A row with nothing in the title column is still a card.
  expect(kb.cardOf({ id: 9, cells: {} }, { name: "item", show: [] }, columns).title).toBe("Untitled");
});

test("the board's markdown is its lanes and its cards, empty lanes included", () => {
  const lanes = kb.group(
    [
      { id: 1, lane: '["Ready"]', title: "Kettle", fields: [{ name: "count", text: "25", labels: [] }, { name: "seen", text: "", labels: [] }] },
      { id: 2, lane: null, title: "Lathe", fields: [{ name: "count", text: "", labels: [] }] },
    ],
    kb.lanesOf({ name: "status", type: "categories", options: [{ label: "Ready", colour: "cyan" }, { label: "Blocked", colour: "nonrepro" }] }, "status"),
  );
  expect(kb.toMarkdown(lanes)).toBe(
    [
      // A blank field is left OUT of the projection: an em dash in a markdown
      // bullet is a word about nothing, where on a card it is a column holding
      // its shape.
      "## Ready", "", "- **Kettle** · count: 25", "",
      // AN EMPTY LANE IS WRITTEN ANYWAY: that a stage is empty is a fact about
      // the work, and a projection that dropped it would read as a board with
      // fewer stages than it has.
      "## Blocked", "", "*(nothing here)*", "",
      "## No status", "", "- **Lathe**",
    ].join("\n"),
  );
});
