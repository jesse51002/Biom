// SPDX-License-Identifier: AGPL-3.0-only
// The New dialog. Layer 15.
//
// It used to ask for a name, a kind and a parent before it would make anything.
// Two of those were answerable later and better: a parent is the row whose plus
// you pressed, and the kind stopped existing. THE NAME CAME BACK, because it was
// never answerable later — a page cannot be renamed from the app, the wire has no
// kind that writes one, so a page made as Untitled stayed Untitled, and the first
// thing a stranger does with a new page is hand it to an agent by name.
//
// THERE IS NO PAGE-KIND PICKER, and there is nothing left to pick. A page held
// sections drawn by a render, or it took the whole sheet with its own HTML, and
// choosing between those was the first thing this dialog asked. A page is now
// one thing — sections, drawn by one runtime — so the question has one answer
// and asking it would be a control that cannot be got wrong or right.
//
// So it asks one thing, and it is optional: a name. Enter makes a page with it,
// either button makes that kind with it, and a field left empty falls back to the
// name the thing would have had anyway. A failure keeps what was typed and says
// why, because a dialog that closed on a refusal would have thrown the name away.
//
// There WAS a button that asked what you wanted and handed back a prompt to
// paste, and another that opened the catalogue. The first went because it was a
// thing pretending to be a kind; the second went with the marketplace itself.
// Wanting a page to be something in particular is a sentence you give the agent
// — which is the other half of this workspace already, not a box in a dialog.

/** @import { PageId, UiStore } from "../../contracts/types.ts" */
/** @import { Workspace } from "../store/workspace.js" */

// Re-exported by the store rather than reached for in contracts, which is where
// every other client module takes it from — one spelling, one import.
import { ROOT_PAGE, segmentOf } from "../store/workspace.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/**
 * @typedef {object} DialogDeps
 * @property {H} h
 * @property {Workspace} ws
 * @property {UiStore} ui
 */

/** What a page is called when the name field was left empty. A real name rather
 *  than an empty one, because a nameless row cannot be clicked back to. */
export const UNTITLED = "Untitled";

/** The two things you can make, described the way they read on screen rather
 *  than by their type names. A page is sections — prose, a board, a chart, or
 *  all three, whatever its sections draw. A table is the data those sections
 *  read.
 *
 *  A table is here because it is a child in the tree exactly as a page is, so
 *  the plus on a row that offered only pages was offering half the answer. */
const KINDS = /** @type {const} */ ([
  { kind: "page", label: "Page", note: "sections, and whatever they draw" },
  { kind: "table", label: "Table", note: "typed rows and columns" },
]);

/** What a new table is called, and its one column. A table with no columns is a
 *  thing you cannot type into, so it opens with one rather than with a grid
 *  that has nowhere to put anything. */
export const NEW_TABLE = "table";
const FIRST_COLUMN = "Name";

/** The first name in `taken`'s sequence that nobody holds. Tables are named by
 *  the person and the server refuses a duplicate, so a plus pressed twice in a
 *  row must not fail the second time.
 *  @param {readonly string[]} taken @returns {string} */
export function freeTableName(taken) {
  const used = new Set(taken);
  if (!used.has(NEW_TABLE)) return NEW_TABLE;
  for (let n = 2; ; n++) {
    const tried = `${NEW_TABLE} ${n}`;
    if (!used.has(tried)) return tried;
  }
}

/** Why something was not made, in words somebody can act on.
 *  @param {unknown} err @returns {string} */
const reason = (err) => (err instanceof Error && err.message ? err.message : "the server refused it");

/**
 * @param {DialogDeps} deps
 */
export function makeDialog(deps) {
  const { h, ws, ui } = deps;

  let busy = false;
  /** The name typed so far, and what the last attempt said. Both live out here
   *  rather than on the card, which is rebuilt on every repaint. */
  let typed = "";
  let said = "";
  /** @type {HTMLElement | null} */
  let shown = null;

  const close = () => {
    typed = "";
    said = "";
    ui.set({ dialog: false, dialogParent: null });
  };

  /** Say what went wrong without rebuilding the card, so the field keeps its text
   *  and its caret. @param {string} text */
  const say = (text) => {
    said = text;
    if (shown) shown.textContent = text;
  };

  async function makePage() {
    if (busy) return;
    busy = true;
    try {
      const parent = ui.get().dialogParent;
      const ref = await ws.createPage({ name: typed.trim() || UNTITLED, parent: parent ?? undefined });
      close();
      ui.go("page", ref.id);
    } catch (err) {
      console.error("the page was not made", err);
      say("The page was not made: " + reason(err));
    } finally {
      busy = false;
    }
  }

  /** A table, made and then PLACED. `TableSchema` carries no parent — a table's
   *  position is workspace state rather than part of what the table is — so
   *  where it goes is a second call, the same one the rail makes when you drag
   *  one. Without it, pressing the plus on a row would put the table at the top
   *  level, which is not what the plus on a row means. */
  async function makeTable() {
    if (busy) return;
    busy = true;
    try {
      const parent = ui.get().dialogParent;
      const name = typed.trim() || freeTableName(ws.get().tables.map((t) => t.name));
      await ws.createTable({
        name,
        kind: "basic",
        columns: [{ name: FIRST_COLUMN, type: "text" }],
      });
      if (parent && parent !== ROOT_PAGE) {
        await ws.moveChild({ kind: "table", id: name, name }, ROOT_PAGE, parent);
      }
      close();
      ui.go("table", name);
    } catch (err) {
      console.error("the table was not made", err);
      say("The table was not made: " + reason(err));
    } finally {
      busy = false;
    }
  }

  /** A name, then the choices two across, then what the last attempt said.
   *
   *  There is no Custom Page button. It asked for a sentence and handed back a
   *  prompt to paste, which is a thing pretending to be a kind — and the two
   *  above ARE what you can make. Wanting one of them to be something in
   *  particular is a sentence you give the agent, and the agent is already the
   *  other half of this workspace.
   *  @param {HTMLElement} card */
  function pickFace(card) {
    const named = /** @type {HTMLInputElement} */ (h("input.popinput.named", {
      type: "text", spellcheck: "false", placeholder: UNTITLED, "aria-label": "Name", value: typed,
    }));
    named.addEventListener("input", () => { typed = named.value; });
    // ENTER MAKES A PAGE, ONCE. `busy` is what makes a held key or a double
    // press one page rather than two; reading the field here rather than trusting
    // the last `input` event is what makes a pasted name count.
    named.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      typed = named.value;
      void makePage();
    });
    setTimeout(() => named.focus(), 0);

    shown = h("p.said.bad", said);

    return [
      named,
      h("div.kinds",
        ...KINDS.map(({ kind, label, note }) =>
          h("button.kind", {
            type: "button",
            onclick: () => {
              typed = named.value;
              void (kind === "table" ? makeTable() : makePage());
            },
          }, h("b", label), h("span", note)))),

      shown,
      h("p.foot", h("button.btn.ghost", { type: "button", onclick: close }, "Cancel")),
    ];
  }

  /** The parent BY ITS NAME. It printed the id, which is a path of folder
   *  segments nobody chose to read — `home/Boards/Open_Source_Release` for what
   *  the rail calls Open source release. */
  const head = () => {
    const inside = ui.get().dialogParent;
    if (!inside) return h("h2", "New");
    const ref = ws.get().pages.find((p) => p.id === inside);
    return h("h2", "New inside " + (ref ? ref.name : segmentOf(inside)));
  };

  return function dialog() {
    const card = h("div.dialog", { role: "dialog", "aria-modal": "true", "aria-label": "New" });
    card.replaceChildren(head(), ...pickFace(card));

    return h("div.scrim", {
      onclick: (/** @type {MouseEvent} */ e) => { if (e.target === e.currentTarget) close(); },
    }, card);
  };
}
