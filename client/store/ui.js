// SPDX-License-Identifier: AGPL-3.0-only
// State that is never persisted: the route, the inserter, the dialog, which
// folders are open in the tree — and, since the eleventh contracts edit, the
// rest of the window's CONTEXT: whether the chat panel is open, which chat is
// in it and whether the list of chats is showing. The context of the *History
// and View Switcher* spec is this store with those fields added, not a second
// copy of it.
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
import { address, normalAddress } from "../../contracts/address.js";

/**
 * @param {Partial<UiState>} [initial] the route boot resolved from the URL
 * @returns {UiStore}
 */
export function makeUi(initial) {
  const bus = emitter();

  /** @type {UiState} */
  let state = {
    route: address("page"),
    panel: false,
    chat: null,
    chatList: false,
    inserting: null,
    dialog: false,
    dialogParent: null,
    expanded: new Set(),
    treeOrder: "asc",
    ...initial,
  };
  // EVERY ROUTE IN HERE IS AN ADDRESS, NORMALISED — a page's own screen only
  // where there is a page. A route handed in before the screen joined it reads
  // as the page itself, and one that already was normal is the same object, so
  // normalising on every write never turns a no-op into a repaint. And a route
  // on the Agent screen names the window's chat: a reload at `#/agent/<chat>`
  // comes back with that chat open, not with the route and the chat apart.
  state = withRoute(state, state.route);

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
      const next = { ...state, ...patch };
      apply(patch.route ? withRoute(next, patch.route) : next);
    },

    go(view, id, screen) {
      // Lifted from the mock: opening something closes the inserter and lands
      // on the page's own face unless a screen of it was named. `route` is a
      // fresh object, so a navigation always repaints — a view may want to
      // scroll to the top even when it lands where it already was.
      //
      // THE AGENT SCREEN NAMES ITS CHAT, and the window remembers it: going
      // there sets `chat` to the address's id, or null for the start screen,
      // so the rail's Agent comes back to whichever was last open.
      apply({ ...withRoute(state, address(view, id, screen)), inserting: null });
    },
  };
}

/**
 * A state with this route in it, normalised, and — on the Agent screen — the
 * chat the route names as the window's open chat, or null for the start
 * screen. Anywhere else the chat the window last had open stays.
 * @param {UiState} state
 * @param {{ view: UiState["route"]["view"], id: string, screen?: UiState["route"]["screen"] }} route
 * @returns {UiState}
 */
function withRoute(state, route) {
  const next = normalAddress(route);
  if (next.view !== "agent") return next === state.route ? state : { ...state, route: next };
  const chat = next.id === "" ? null : next.id;
  return next === state.route && chat === state.chat ? state : { ...state, route: next, chat };
}
