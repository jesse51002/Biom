// SPDX-License-Identifier: AGPL-3.0-only
// The rail: ONE tree, holding everything the workspace has.
//
// THERE IS NO FOLDER, so there is no folder section either — and there is no
// table section beside it. Pages and tables sit in the same list, each row
// carrying a quiet tag saying what it is, because a table that can live directly
// under the page that uses it is the entire point: grouping is meaning, and a
// workspace that files every table in one drawer marked TABLES has thrown that
// meaning away before the user could express it.
//
// THE TREE IS `ROOT_PAGE`'S CHILDREN, RECURSIVELY — not a flat page list sorted
// by a `parent` field. THE FOLDER IS THE HIERARCHY: a page's children are the
// directories under its own `children/`, and its id is the path to it. Every
// level of it is some page's `contents`, which is the same list that page's body
// draws from, so the rail and the page are two views of one thing.
//
// Drag is the only write this view makes, and it resolves to exactly one call —
// `ws.moveChild`, which MOVES A DIRECTORY and hands back the page's NEW ID,
// because a page's id is where it sits. Everything inside it is renamed with it,
// so a rail standing on one of those pages re-routes rather than being left
// pointing at nothing.
//
// A DROP LANDS AT THE BOTTOM, WHEREVER IT WAS AIMED. There is one drop target
// now — a page row, meaning inside that page — and the hairline between two rows
// went with the ordering it wrote: a level's order is the parent's `contents`,
// and no wire kind writes one. A gesture that appeared to place a row and lost
// it on reload is worse than a gesture that is not offered.
//
// Expansion is UI state and lives in the UiStore, because it must not survive a
// reload of workspace data and must survive a redraw.

/** @import { Child, PageId, TableSchema, PageRef, TableRef, UiStore } from "../../contracts/types.ts" */
/** @import { Workspace } from "../store/workspace.js" */

import { ROOT_PAGE, parentOf, rebase } from "../store/workspace.js";
import { popover, popItem, popInput, popSep, popLabel } from "../widgets/popover.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** One row of the rail. `parent` is carried because a drop needs to know whose
 *  `contents` the row currently sits in, and the flattened list is the only place
 *  that is still known.
 *  @typedef {{ child: Child, parent: PageId, depth: number, open: boolean, kids: boolean }} TreeRow */

/**
 * @typedef {object} TreeViewDeps
 * @property {H} h
 * @property {Workspace} ws
 * @property {UiStore} ui
 */

/**
 * @param {TreeViewDeps} deps
 * @returns {() => HTMLElement}
 */
export function makeTreeView(deps) {
  const { h, ws, ui } = deps;

  /** What is being dragged, and where it was. Held in the view's closure rather
   *  than on the event, because the rail is rebuilt on every repaint and a drag
   *  outlives several of them.
   *  @type {{ child: Child, parent: PageId } | null} */
  let dragging = null;

  return function treeView() {
    const { pages, tables } = ws.get();
    const { route, expanded, treeOrder } = ui.get();
    // WHICH WAY THE RAIL READS, and it REVERSES rather than re-sorts.
    //
    // The order the server hands back is the parent's own `contents` order, and
    // that is the user's arrangement — sorting again here would quietly overrule
    // it, which is the one thing the format says a reader must not do. So
    // ascending is exactly what arrived, and descending is the same list read
    // the other way. Where the arrangement is id order, which is what the reader
    // writes, that IS descending by id: a folder of notes named `2026-07-30-…`
    // reads newest first.
    const kids = treeOrder === "desc"
      ? (/** @type {PageId} */ id) => ws.children(id).slice().reverse()
      : (/** @type {PageId} */ id) => ws.children(id);
    const rows = nest(kids, expanded, pages, tables);

    if (!rows.length) {
      return h("ul.tree", h("li", h("p.treenote", "Nothing here yet.")));
    }

    /** The top level as a drop target: a row dragged onto it leaves whatever
     *  page holds it and becomes a child of the root. It is one line at the
     *  bottom of the rail rather than a hairline between every pair of rows,
     *  because "which level" is the only question a drop can still answer.
     *  @returns {HTMLElement} */
    const outdent = () => {
      const li = h("li.gap", {
        ondragover: (/** @type {Event} */ e) => {
          if (!dragging || !takes(ROOT_PAGE)) return;
          e.preventDefault();
          li.classList.add("over");
        },
        ondragleave: () => li.classList.remove("over"),
        ondrop: (/** @type {Event} */ e) => {
          e.preventDefault();
          li.classList.remove("over");
          drop(ROOT_PAGE);
        },
      });
      return li;
    };

    /** @param {TreeRow} row */
    const rowEl = (row) => {
      const { child } = row;
      const isPage = child.kind === "page";
      const current = isPage
        ? route.view === "page" && route.id === child.id
        : route.view === "table" && route.id === child.id;

      const caret = row.kids
        ? h("span.caret" + (row.open ? ".open" : ""), {
            role: "button", tabindex: "0",
            "aria-label": row.open ? "Collapse" : "Expand",
            "aria-expanded": String(row.open),
            onclick: (/** @type {Event} */ e) => { e.preventDefault(); e.stopPropagation(); toggle(child.id); },
            onkeydown: (/** @type {KeyboardEvent} */ e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault(); e.stopPropagation(); toggle(child.id);
            },
          })
        // THE SPACE IS KEPT EVEN WHEN THERE IS NOTHING TO PUT IN IT. A row with
        // no children used to render no caret at all, so its name started where
        // another row's triangle did and the whole list looked ragged — the
        // pages that happen to hold something appeared indented from the ones
        // that do not, which says something about the tree that is not true.
        // Inert: no role, no tab stop, nothing to announce, nothing to click.
        : h("span.caret.bare", { "aria-hidden": "true" });

      const a = h("a", {
        href: "#",
        draggable: "true",
        style: { "--depth": String(row.depth) },
        "aria-current": current ? "page" : null,
        title: child.kind === "table" ? (child.rows ?? 0) + " rows" : null,
        onclick: (/** @type {Event} */ e) => {
          e.preventDefault();
          // Opening a page with children opens the branch too: clicking a page
          // that holds things and watching nothing move is the moment people
          // decide the tree is broken.
          if (isPage && row.kids && !row.open) toggle(child.id);
          ui.go(isPage ? "page" : "table", child.id);
        },
        ondragstart: (/** @type {DragEvent} */ e) => {
          dragging = { child, parent: row.parent };
          a.classList.add("dragging");
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            // Something has to be on the transfer or Firefox refuses the drag.
            e.dataTransfer.setData("text/plain", child.kind + ":" + child.id);
          }
        },
        ondragend: () => { dragging = null; a.classList.remove("dragging"); },
        ondragover: (/** @type {Event} */ e) => {
          if (!isPage || !takes(child.id)) return;
          e.preventDefault();
          a.classList.add("into");
        },
        ondragleave: () => a.classList.remove("into"),
        ondrop: (/** @type {Event} */ e) => {
          if (!isPage || !takes(child.id)) return;
          e.preventDefault();
          a.classList.remove("into");
          // Into a page means at the end of it, so nothing already placed moves.
          const into = child.id;
          drop(into);
          // and it opens, or the thing you just dropped vanishes into a closed
          // row and reads as lost.
          if (!ui.get().expanded.has(into)) toggle(into);
        },
      },
        // A GLYPH, NOT A WORD. The stylesheet draws a sheet or a grid from
        // `data-kind`, in the row's own colour. Two kinds and no third: a page
        // is a page however it draws itself. Drawn in CSS rather than as SVG
        // because the rail is built through `h`, which makes HTML elements,
        // and an <svg> made that way is not an SVG.
        h("span.nm", caret,
          h("span.kindtag", { "data-kind": child.kind, "aria-hidden": "true" }),
          child.name));

      // Any page may hold pages, so every page row can start one. On the row
      // rather than in a dialog because the level IS the answer to "where" —
      // asking again in a modal after you have already pointed at the place is
      // the question the New dialog stopped asking.
      const add = isPage ? h("button.rowadd", {
        type: "button",
        "aria-label": "New page inside " + child.name,
        title: "New page inside",
        onclick: (/** @type {Event} */ e) => {
          e.preventDefault(); e.stopPropagation();
          // Open the parent first, or whatever is made lands inside a shut row
          // and reads as having gone nowhere.
          if (!ui.get().expanded.has(child.id)) toggle(child.id);
          // The dialog carries the level rather than asking for it: a doc, a
          // page, something described, or something from the shop all belong
          // inside the row you pressed.
          ui.set({ dialog: true, dialogParent: child.id });
        },
      }, "+") : null;

      const more = h("button.rowmore", {
        type: "button",
        "aria-label": "More",
        title: "Rename, delete",
        onclick: (/** @type {Event} */ e) => { e.preventDefault(); e.stopPropagation(); menu(more, child); },
      }, "\u22EF");

      return h("li.treerow", a, add, more);
    };

    return h("ul.tree", ...rows.map(rowEl), outdent());
  };

  /** Rename and delete, which is everything a row can do to itself.
   *
   *  A table renames here and a page does not. A page's name is a key of its
   *  document and the wire has no kind that writes one, so a page is named once,
   *  in the New dialog, and this menu says that plainly — it used to send people
   *  to edit YAML by hand, which is not a thing a person using this should do.
   *  @param {HTMLElement} anchor @param {Child} child */
  function menu(anchor, child) {
    const isPage = child.kind === "page";

    popover(anchor, () => {
      const name = /** @type {HTMLInputElement} */ (popInput({ value: child.name, "aria-label": "Name" }));

      const rename = async () => {
        const next = String(name.value).trim();
        if (next === "" || next === child.name) return;
        // A TABLE CAN BE RENAMED AND A PAGE CANNOT, which is a fact about the
        // wire and not about the two things. A table's name is its schema and
        // `table.alter` carries one; a page's name is a key of its document, and
        // the only structured write there is reaches variables. So the field is
        // offered where it can be answered and the page case says where the name
        // actually lives.
        if (!isPage) await ws.alterTable(child.id, { ...tableSchema(child.id), name: next });
      };

      const remove = async () => {
        if (isPage) await ws.removePage(child.id);
        else await ws.dropTable(child.id);
        // Standing on a page that no longer exists is a blank canvas and no
        // explanation, so leaving is part of deleting.
        if (ui.get().route.id === child.id) ui.go("page", ROOT_PAGE);
      };

      name.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        void rename();
      });

      return [
        popLabel("Name"),
        isPage ? popLabel("A page keeps the name it was made with — renaming one is not built yet") : name,
        popSep(),
        popItem("Delete", () => void remove(), { danger: true }),
        // A table's rows are in the database, and the vault's history does not
        // reach them — so this one really is gone. Saying so is the whole
        // guard there is.
        isPage ? null : popLabel("Rows are not kept in the page history"),
      ].filter(Boolean);
    }, { onClose: () => {} });
  }

  /** The open table's schema, which `alterTable` needs in full to rename one.
   *  @param {string} id @returns {TableSchema} */
  function tableSchema(id) {
    const open = ws.get().table;
    if (open && open.schema.name === id) return open.schema;
    return { name: id, kind: "basic", columns: [] };
  }

  /** Whether the page being dragged can be put inside `id` — never itself, and
   *  never one of its own descendants, which would cut the branch off the tree.
   *  @param {PageId} id */
  function takes(id) {
    if (!dragging) return false;
    const moving = dragging.child;
    if (moving.kind !== "page") return true;
    if (moving.id === id) return false;
    return !inside(id, moving.id);
  }

  /** Is `id` somewhere under `root`? @param {PageId} id @param {PageId} root */
  function inside(id, root) {
    const seen = new Set([root]);
    const queue = [root];
    for (const at of queue) {
      for (const child of ws.children(at)) {
        if (child.kind !== "page" || seen.has(child.id)) continue;
        if (child.id === id) return true;
        seen.add(child.id);
        queue.push(child.id);
      }
    }
    return false;
  }

  /** @param {PageId} parent */
  function drop(parent) {
    const moving = dragging;
    dragging = null;
    if (!moving) return;
    // The same refusal `takes` makes, asked after the drag state was cleared.
    if (moving.child.kind === "page"
      && (parent === moving.child.id || inside(parent, moving.child.id))) return;
    // Where it already is.
    if (moving.parent === parent) return;

    const open = ui.get().route;
    const standing = open.view === "page" && moving.child.kind === "page" &&
      (open.id === moving.child.id || open.id.startsWith(moving.child.id + "/"));

    ws.moveChild(moving.child, moving.parent, parent)
      .then((moved) => {
        // THE ID THE ROUTE IS HOLDING HAS JUST STOPPED EXISTING. Moving a page
        // renames it and everything beneath it, and nothing forwards — so a
        // route left on the old one asks for a page that is not there and gets
        // an empty screen. It is re-pointed at the same page under its new name.
        if (moved !== null && standing) ui.go("page", rebase(open.id, moving.child.id, moved));
      })
      .catch((err) => console.error("the rail could not move that", err));
  }

  /** @param {PageId} id */
  function toggle(id) {
    const next = new Set(ui.get().expanded);
    if (!next.delete(id)) next.add(id);
    ui.set({ expanded: next });
  }
}

/* ── pure, and therefore testable ─────────────────────────────────────── */

/**
 * Flatten the workspace into the rows the rail draws, starting from the root
 * page's children and descending into whatever is expanded.
 *
 * Anything the walk never reached is shown at the root rather than hidden. A
 * page whose parent is missing, or a table no page has claimed, is a thing you
 * must be able to click on in order to file or delete it — and the rail is the
 * only place either is visible at all now that there is no table section. The
 * `seen` set is not paranoia either: children come off disk, and a page that
 * claims its own descendant would otherwise loop here forever.
 *
 * @param {(id: PageId) => Child[]} children
 * @param {ReadonlySet<PageId>} expanded
 * @param {PageRef[]} pages
 * @param {TableRef[]} tables
 * @returns {TreeRow[]}
 */
export function nest(children, expanded, pages, tables) {
  /** @type {TreeRow[]} */
  const rows = [];
  const seen = new Set();

  /** @param {Child} child @param {PageId} parent @param {number} depth */
  const push = (child, parent, depth) => {
    const mark = child.kind + ":" + child.id;
    if (seen.has(mark)) return;
    seen.add(mark);
    const kids = child.kind === "page" && children(child.id).length > 0;
    const open = kids && expanded.has(child.id);
    rows.push({ child, parent, depth, open, kids });
    if (open) walk(child.id, depth + 1);
  };

  /** @param {PageId} parent @param {number} depth */
  const walk = (parent, depth) => {
    for (const child of children(parent)) push(child, parent, depth);
  };

  walk(ROOT_PAGE, 0);

  // The orphan rescue, and it has to know the difference between LOST and
  // MERELY HIDDEN. Anything the walk did not reach is either parented to a page
  // that no longer exists — in which case it is unreachable and belongs at the
  // root where it can be found and moved — or it is sitting inside a collapsed
  // ancestor, which is not a problem at all. Surfacing the second kind put the
  // same page at the root whenever its folder was shut, so closing a folder
  // appeared to move its contents out of it.
  const known = new Set([ROOT_PAGE, ...pages.map((p) => p.id)]);
  /** @param {PageId | null} parent */
  const lost = (parent) => parent === null || !known.has(parent);

  for (const page of pages) {
    // Derived from the id, because the folder IS the hierarchy: there is no
    // `parent` field to read and nothing that could disagree with the path.
    if (page.id === ROOT_PAGE || !lost(parentOf(page.id))) continue;
    push({ kind: "page", id: page.id, name: page.name }, ROOT_PAGE, 0);
  }
  for (const table of tables) {
    if (!lost(table.parent)) continue;
    push({ kind: "table", id: table.name, name: table.name, rows: table.rows }, ROOT_PAGE, 0);
  }

  return rows;
}
