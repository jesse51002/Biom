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
// THREE WAYS TO MOVE THE SCREEN, AND WHICH ONE WAS USED IS KEPT BESIDE THE
// ROUTE. Only the person and the switcher move the screen (*History and View
// Switcher*, `switcher`), and the history records the two differently — an
// open by the person, a view under an agent — so a route change has to say who
// made it:
//
//   `open`   the person opening a place: the rail, a link, the page path,
//            search, Home, a pop-up, the tree, a page just made, Back. Off
//            the full Agent screen it brings the open chat along, in the
//            panel beside what was opened.
//   `follow` the switcher bringing a page up for an agent, with the chat in
//            the panel beside it.
//   `go`     the system re-pointing the route with nobody asking: a cold
//            start, a rename or a delete, a trouble screen. It is the
//            contract's `UiStore.go`, which is why it is the one that keeps the
//            plain name.
//
// `cause()` answers the latest of them. It is not a field of `UiState`, which
// is frozen in `contracts/` and has no room for it; it is read by the two
// things that care — the switcher, which reports it, and the shell, which
// decides from it whether the browser's history gets a new entry.
//
// It cannot see the DOM, the transport, or the workspace store. It is the
// bottom of the client's own stack.

/** @import { Address, AgentId, ChatId, PageScreen, UiState, UiStore, ViewName } from "../../contracts/types.ts" */

import { emitter } from "../../contracts/emitter.js";
import { address, normalAddress } from "../../contracts/address.js";

/**
 * WHO MOVED THE SCREEN LAST. `system` is nobody: the route was re-pointed
 * because something else happened.
 * @typedef {{ by: "you" } | { by: "system" } | { by: "switcher", agent: AgentId, chat: ChatId }} Mover
 */

/**
 * THE LATEST MOVE, AND HOW THE ADDRESS BAR TAKES IT. `seq` counts moves from 0,
 * the route this store was built with, so a reader can tell a new move from a
 * repaint — including a move to the address already on screen, which is still
 * a move: the person opening the page they are on is an open. `replace` says
 * the browser's history should not gain an entry for it.
 * @typedef {object} Cause
 * @property {number} seq
 * @property {Mover} mover
 * @property {boolean} replace
 */

/**
 * The contract's store, and the two moves the contract does not name.
 * @typedef {UiStore & {
 *   open(view: ViewName, id: string, screen?: PageScreen, panel?: boolean): void,
 *   follow(to: Address, by: { agent: AgentId, chat: ChatId }, replace: boolean): void,
 *   cause(): Cause,
 * }} Ui
 */

/**
 * @param {Partial<UiState>} [initial] the route boot resolved from the URL
 * @returns {Ui}
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

  /** The route this store was built with is move 0, made by nobody: a cold
   *  start is the system's, and whose the screen is then is the history's to
   *  say (the switcher reads it back when it starts).
   *  @type {Cause} */
  let cause = Object.freeze({ seq: 0, mover: Object.freeze({ by: "system" }), replace: true });

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

  /**
   * A MOVE: the route to `to`, whoever made it, and the rest of `extra`. The
   * cause is written BEFORE the emit, so every listener that hears the route
   * change reads who changed it. The route is always a fresh object here, so a
   * move always emits — a view may want to scroll to the top even when it
   * lands where it already was, and a move to the same place is still a move.
   *
   * Lifted from the mock: opening something closes the inserter.
   * @param {Address} to @param {Mover} mover @param {boolean} replace
   * @param {Partial<UiState>} [extra]
   */
  function move(to, mover, replace, extra) {
    cause = Object.freeze({ seq: cause.seq + 1, mover: Object.freeze(mover), replace });
    const next = withRoute({ ...state, ...extra, inserting: null }, to);
    apply(next.route === state.route ? { ...next, route: { ...next.route } } : next);
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
      if (!patch.route) { apply(next); return; }
      const routed = withRoute(next, patch.route);
      // A ROUTE WRITTEN THROUGH `set` IS NOBODY'S MOVE, because nothing that
      // knows who asked goes through here: every place a person moves the
      // screen says `open`, and the switcher says `follow`. It is counted,
      // though, so a reader never mistakes it for the move before it.
      if (routed.route !== state.route) {
        cause = Object.freeze({ seq: cause.seq + 1, mover: Object.freeze({ by: "system" }), replace: true });
      }
      apply(routed);
    },

    go(view, id, screen) {
      // THE SYSTEM, RE-POINTING THE ROUTE. Nobody opened anything: a cold start
      // landing on the first page, a rename or a move that took the page's id
      // with it, a delete leaving, a workspace that would not open. So the
      // history records no open, and the address bar REPLACES its entry —
      // Back to an id that no longer names anything is a Back to nothing.
      //
      // THE AGENT SCREEN NAMES ITS CHAT, and the window remembers it: going
      // there sets `chat` to the address's id, or null for the start screen,
      // so the rail's Agent comes back to whichever was last open.
      move(address(view, id, screen), { by: "system" }, true);
    },

    open(view, id, screen, panel) {
      // THE PERSON, opening a place. Recorded as an open, and a new entry in
      // the browser's history, so Back leaves it. `panel` opens the chat panel
      // in the same move.
      //
      // OFF THE FULL AGENT SCREEN, THE OPEN CHAT COMES ALONG: whatever the
      // person opens from a chat on the full screen — the tree, the crumbs,
      // search, Home, the rail, Back — comes up with that chat in the panel
      // beside it, as the mockup's Agent screen has it, and never as a bare
      // page with the chat gone. It is decided here, once, rather than by
      // every caller remembering to ask: a caller that forgot is exactly how
      // the chat used to vanish, and with it the switcher's reason to follow
      // the chat's next write. The start screen has no chat to bring, and the
      // workspace picker draws no panel.
      const along = state.route.view === "agent" && state.chat !== null && view !== "agent" && view !== "vault";
      move(address(view, id, screen), { by: "you" }, false, panel === true || along ? { panel: true } : undefined);
    },

    follow(to, by, replace) {
      // THE SWITCHER, bringing a page up for an agent: always with the chat
      // in the panel beside it, because the switcher follows only a chat that
      // is open — on the Agent screen or in the panel — and a move off the
      // full Agent screen must never leave a bare page with the chat gone.
      // `replace` is the switcher's to decide: it keeps the person's own
      // screen in the browser's history and never stacks one of its own on
      // another, so Back from anything it brought up lands where they were.
      move(normalAddress(to), { by: "switcher", agent: by.agent, chat: by.chat }, replace, { panel: true });
    },

    cause() {
      return cause;
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
