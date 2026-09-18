// SPDX-License-Identifier: AGPL-3.0-only
// State that is never persisted: the route, the inserter, the dialog, and
// which folders are open in the tree.
//
// It is a separate store from the workspace and the reason is structural rather
// than tidy: ephemeral UI state and a cached replica of server state have
// opposite lifetimes. Mixing them is how a reload button ends up resetting
// somebody's scroll position, and how a route change ends up refetching a page
// that was already in hand. Keeping them apart is what lets `loadPage` return
// the cached page without a request.
//
// It cannot see the DOM, the transport, or the workspace store. It is the
// bottom of the client's own stack.

/** @import { UiState, UiStore } from "../../contracts/types.ts" */

import { emitter } from "../../contracts/emitter.js";

/**
 * @param {Partial<UiState>} [initial] the route boot resolved from the URL
 * @returns {UiStore}
 */
export function makeUi(initial) {
  const bus = emitter();

  /** @type {UiState} */
  let state = {
    route: { view: "page", id: "" },
    inserting: null,
    dialog: false,
    dialogParent: null,
    expanded: new Set(),
    treeOrder: "asc",
    ...initial,
  };

  /**
   * The one write path. It emits only when something actually differs, which is
   * what kills the mock's `set({})`-as-a-repaint-signal: a store that repaints
   * on a no-op cannot be trusted to say what changed, and the popover had to
   * grow a last-good-rect guard because of the repaints that produced.
   *
   * The rule that follows from it, and it is the one thing to know about this
   * file: **a collection you mutated in place is the same reference and will
   * not emit.** Build a new one — `set({ expanded: new Set(prev).add(id) })`.
   *
   * @param {UiState} next
   */
  function apply(next) {
    const keys = /** @type {(keyof UiState)[]} */ (Object.keys(next));
    if (keys.every((k) => Object.is(state[k], next[k]))) return;
    state = next;
    bus.emit(undefined);
  }

  return {
    get() {
      return state;
    },

    on(fn) {
      return bus.on(fn);
    },

    set(patch) {
      apply({ ...state, ...patch });
    },

    go(view, id) {
      // Lifted from the mock: opening something closes the inserter. `route`
      // is a fresh object, so a navigation always repaints — a view may want to
      // scroll to the top even when it lands where it already was.
      apply({
        ...state,
        route: { view, id },
        inserting: null,
      });
    },
  };
}
