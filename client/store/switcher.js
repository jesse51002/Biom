// SPDX-License-Identifier: AGPL-3.0-only
// Layer 9 — THE SWITCHER: one per window, watching the history and the
// context from above and deciding, on its own, whether an agent's write
// brings its screen up, is offered in **Go to page**, or does nothing.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the switcher track builds it.
//
// Nobody asks it anything. What it owes (*History and View Switcher*,
// `yours`, `switcher`, `moves`, `popups`):
//
//   - it follows an agent only while that agent's chat is open in this window
//     — on the Agent screen or in the panel — and only its WRITES, to a file a
//     screen shows; a chat in the background and a run never move the screen;
//   - a screen is the person's when they opened it, touched it, or kept it on
//     screen `adopt` with the window in front; the person's work is the latest
//     screen in the history that is theirs;
//   - it moves when the screen is not the person's, or their last touch was
//     more than `idle` ago, touches before their latest message not counting;
//     otherwise it offers **Go to page**; never off a held screen; never
//     sooner than `settle` after its last move;
//   - **Go back to** names the person's work while an agent has the screen.
//
// ITS CLOCK AND ITS TIMES ARE INJECTED AND THERE IS NO OTHER SWITCH. The
// factory takes `now` and `timing`; `client/boot.js` passes `Date.now` and
// five minutes, two minutes and five seconds, and a test passes its own. It
// reads only this window's clock — the time an entry was RECEIVED, never the
// server's `at` — so Playwright's page clock fast-forwards it in end-to-end.
// `decide` is pure, so every rule above is a table of cases in a unit test.

/** @import { Address, AgentId, ChatId, UiStore } from "../../contracts/types.ts" */

/**
 * @typedef {object} SwitcherTiming
 * @property {number} adopt Kept on screen this long with the window in front,
 *   a screen is the person's. Five minutes.
 * @property {number} idle A touch this recent holds the screen. Two minutes.
 * @property {number} settle After a move the screen stays at least this long.
 *   Five seconds.
 */

/**
 * @typedef {object} SwitcherView What the screen shows because of the switcher.
 * @property {Address | null} back **Go back to**, top left: the person's work,
 *   while an agent has the screen.
 * @property {Address | null} offer **Go to page**, above the chat's input.
 */

/**
 * @typedef {{ kind: "move", to: Address, agent: AgentId, chat: ChatId }
 *   | { kind: "offer", to: Address }
 *   | { kind: "none" }} Verdict
 */

/**
 * WHAT ONE WRITE DOES TO THE SCREEN, from everything the switcher knows —
 * pure, and every time in it by this window's clock. The shape of `facts` is
 * the switcher track's to settle. NOT BUILT: answers `none`.
 * @param {unknown} _facts
 * @param {SwitcherTiming} _timing
 * @returns {Verdict}
 */
export function decide(_facts, _timing) {
  return { kind: "none" };
}

/**
 * @typedef {object} Switcher
 * @property {() => SwitcherView} get
 * @property {(fn: () => void) => () => void} on
 * @property {() => void} touched The person touched the screen.
 * @property {() => void} sent The person sent a message in the open chat.
 * @property {() => void} back **Go back to** was pressed.
 * @property {() => void} go **Go to page** was pressed.
 */

/**
 * NOT BUILT: throws.
 * @param {{ ui: UiStore, history: unknown, chats: unknown, now: () => number, timing: SwitcherTiming }} _deps
 * @returns {Switcher}
 */
export function makeSwitcher(_deps) {
  throw new Error("client/store/switcher.js: the switcher is not built yet");
}
