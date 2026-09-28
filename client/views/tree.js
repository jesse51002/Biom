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
// A LEVEL IS LISTED WHEN IT IS OPENED, AND DRAWN ONLY ONCE IT IS HELD. Opening
// a row is the act that asks for its level (`ws.expand`); drawing reads what
// the store holds and asks for nothing, because a view that fetched while
// drawing would fetch again on the repaint its own answer caused. A page row
// wears its chevron from the listing's own word on it — `Child.children`,
// whether its folder holds pages — or from a table the rack says sits under
// it, so a branch is drawn without being fetched.
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
// EVERY OPEN PAGE ENDS IN A PLUS. The last row under an expanded page is not a
// child but a way to make one there — a `+ New page` at the children's own
// depth. The hover-only plus on each row already said the same thing, and it
// was found by nobody: a control that is invisible until the pointer is on the
// row is a control that is not there. The top level keeps the button under the
// whole tree, which is the same row for the root.
//
// Expansion is UI state and lives in the UiStore, because it must not survive a
// reload of workspace data and must survive a redraw.

/** @import { Child, PageId, TableSchema } from "../../contracts/types.ts" */
/** @import { Workspace } from "../store/workspace.js" */
/** @import { Ui } from "../store/ui.js" */

import { ROOT_PAGE, rebase } from "../store/workspace.js";
import { popover, popItem, popInput, popSep, popLabel, closePopover } from "../widgets/popover.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** One row of the rail. `parent` is carried because a drop needs to know whose
 *  `contents` the row currently sits in, and the flattened list is the only place
 *  that is still known.
 *  @typedef {{ child: Child, parent: PageId, depth: number, open: boolean, kids: boolean }} TreeRow */

/**
 * @typedef {object} TreeViewDeps
 * @property {H} h
 * @property {Workspace} ws
 * @property {Ui} ui WHERE THE PERSON IS. A row pressed is THEIR open; a route
 *   re-pointed after a rename, a move or a delete is the system's, because
 *   nobody opened anything — the page they were on changed its id or went.
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
    const { tables } = ws.get();
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
    // A page holds something when its listed level does, or — before it is
    // listed — when the listing said its folder holds pages, or the rack says
    // a table sits under it.
    const holders = new Set(tables.map((t) => t.parent ?? ROOT_PAGE));
    /** @param {Child} c */
    const holds = (c) => (ws.held(c.id) ? ws.children(c.id).length > 0 : c.children !== false || holders.has(c.id));
    const rows = nest(kids, expanded, holds);

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
          ui.open(isPage ? "page" : "table", child.id);
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

    /** The plus at the foot of an open page's children: a new page inside it,
     *  at the depth its children sit at, so it reads as the last thing in the
     *  folder rather than as a sibling of the folder.
     *  @param {TreeRow} row */
    const addEl = (row) => h("li.treerow.addrow",
      h("button.rowaddin", {
        type: "button",
        style: { "--depth": String(row.depth + 1) },
        "aria-label": "New page inside " + row.child.name,
        onclick: (/** @type {Event} */ e) => {
          e.preventDefault();
          ui.set({ dialog: true, dialogParent: row.child.id });
        },
      }, "New page"));

    // The rows, with a plus closing every open page. The flat list carries the
    // nesting as depth alone, so a page's children END where the next row is no
    // deeper than the page — that is where its plus goes, and every open page
    // still on the stack at the end of the list gets one at the foot.
    /** @type {HTMLElement[]} */
    const els = [];
    /** @type {TreeRow[]} */
    const open = [];
    for (const row of rows) {
      for (let top = open.at(-1); top && row.depth <= top.depth; top = open.at(-1)) {
        els.push(addEl(top));
        open.pop();
      }
      els.push(rowEl(row));
      if (row.open) open.push(row);
    }
    for (let top = open.pop(); top; top = open.pop()) els.push(addEl(top));

    return h("ul.tree", ...els, outdent());
  };

  /** Rename and delete, which is everything a row can do to itself.
   *
   *  A page and a table both rename here, and they are two different writes. A
   *  table's name is its schema and `table.alter` carries one; a page's name is
   *  a key of its document AND the spelling of its last segment, so
   *  `page.rename` writes the key and moves the directory, and answers the new
   *  id — which a rail standing on that page, or under it, re-routes onto, the
   *  way a drop does.
   *  @param {HTMLElement} anchor @param {Child} child */
  function menu(anchor, child) {
    const isPage = child.kind === "page";

    popover(anchor, () => {
      const name = /** @type {HTMLInputElement} */ (popInput({ value: child.name, "aria-label": "Name" }));

      const rename = async () => {
        const next = String(name.value).trim();
        if (next === "" || next === child.name) return;
        if (isPage) {
          const open = ui.get().route;
          const standing = open.view === "page" &&
            (open.id === child.id || open.id.startsWith(child.id + "/"));
          const moved = await ws.renamePage(child.id, next);
          // THE ID THE ROUTE IS HOLDING MAY HAVE JUST STOPPED EXISTING, the
          // same way it does after a drag: the page and everything beneath it
          // were renamed, so the route is re-pointed at the same page under
          // its new name.
          // The SCREEN goes with it: a rename on the page's Instructions
          // leaves the person on the renamed page's Instructions.
          if (moved !== child.id && standing) ui.go("page", rebase(open.id, child.id, moved), open.screen);
        } else {
          await ws.alterTable(child.id, { ...tableSchema(child.id), name: next });
        }
        // Done is done: the row now says the name, and a menu still open over
        // it reads as a rename that did not take.
        closePopover();
      };

      const remove = async () => {
        if (isPage) await ws.removePage(child.id);
        else await ws.dropTable(child.id);
        // Standing on a page that no longer exists — or on one beneath it,
        // which went with it — is a blank canvas and no explanation, so
        // leaving is part of deleting.
        const at = ui.get().route;
        const gone = isPage
          ? at.view === "page" && (at.id === child.id || at.id.startsWith(child.id + "/"))
          : at.view === "table" && at.id === child.id;
        if (gone) ui.go("page", ROOT_PAGE);
      };

      name.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        rename().catch((err) => console.error("the rail could not rename that", err));
      });

      return [
        popLabel("Name"),
        name,
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

  /** Is `id` somewhere under `root`? The id is the path, so it is under
   *  exactly when it starts with it — whatever levels this window has listed.
   *  @param {PageId} id @param {PageId} root */
  function inside(id, root) {
    return id.startsWith(root + "/");
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
        if (moved !== null && standing) ui.go("page", rebase(open.id, moving.child.id, moved), open.screen);
      })
      .catch((err) => console.error("the rail could not move that", err));
  }

  /** A row opened or shut. OPENING IS THE ACT THAT LISTS ITS LEVEL, once:
   *  the rail draws what is held and asks for nothing while it draws.
   *  @param {PageId} id */
  function toggle(id) {
    const next = new Set(ui.get().expanded);
    const opening = !next.delete(id);
    if (opening) next.add(id);
    ui.set({ expanded: next });
    if (opening) ws.expand(id).catch((err) => console.warn("[biom] the rail could not open that", err));
  }
}

/* ── pure, and therefore testable ─────────────────────────────────────── */

/**
 * Flatten the levels this window holds into the rows the rail draws, starting
 * from the root page's children and descending into whatever is expanded.
 *
 * THERE IS NO ORPHAN RESCUE HERE ANY MORE. A table whose page is gone is
 * listed under the root by the server, which is the one place that sees every
 * table; and a window that holds a level at a time cannot tell a page whose
 * parent is gone from one whose parent it has simply not listed. The `seen`
 * set is not paranoia: children come off disk, and a page that claims its own
 * descendant would otherwise loop here forever.
 *
 * @param {(id: PageId) => Child[]} children the held level of a page, or empty
 * @param {ReadonlySet<PageId>} expanded
 * @param {(child: Child) => boolean} holds whether a page row has anything
 *   under it, listed or not — which is what gives it a chevron
 * @returns {TreeRow[]}
 */
export function nest(children, expanded, holds) {
  /** @type {TreeRow[]} */
  const rows = [];
  const seen = new Set();

  /** @param {Child} child @param {PageId} parent @param {number} depth */
  const push = (child, parent, depth) => {
    const mark = child.kind + ":" + child.id;
    if (seen.has(mark)) return;
    seen.add(mark);
    const kids = child.kind === "page" && holds(child);
    const open = kids && expanded.has(child.id);
    rows.push({ child, parent, depth, open, kids });
    if (open) walk(child.id, depth + 1);
  };

  /** @param {PageId} parent @param {number} depth */
  const walk = (parent, depth) => {
    for (const child of children(parent)) push(child, parent, depth);
  };

  walk(ROOT_PAGE, 0);

  return rows;
}
