// SPDX-License-Identifier: AGPL-3.0-only
// Layer 9 — THIS WINDOW'S COPY OF THE HISTORY, and its reports to the server.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the history track builds it.
//
// It holds the entries the server appended, each with the time THIS WINDOW
// RECEIVED it, read off the clock it is handed — the switcher times
// everything by that and never by the server's `at`, which is what lets an
// end-to-end test move one window's time with Playwright's clock. It catches
// up with `history.read` from the last `seq` it holds on arrival and on every
// reconnect, merges the stream's batches by `seq` so nothing is taken twice,
// and reports this window's context with `window.report` whenever the screen,
// the panel or the chat in it changes — with `moved` when the screen moved,
// and by whom.

/** @import { HistoryEntry, Move, Transport, WindowReport } from "../../contracts/types.ts" */

/**
 * @typedef {object} Received An entry, and when this window got it.
 * @property {HistoryEntry} entry
 * @property {number} got By this window's own clock.
 */

/**
 * @typedef {object} HistoryStore
 * @property {() => readonly Received[]} get
 * @property {(fn: () => void) => () => void} on
 * @property {(entries: HistoryEntry[]) => void} take A batch off the stream,
 *   or a `window.report`'s answer.
 * @property {() => Promise<void>} catchUp `history.read` from the last seq held.
 * @property {(context: WindowReport, moved?: Move) => Promise<void>} report
 */

/**
 * NOT BUILT: throws.
 * @param {{ transport: Transport, now: () => number }} _deps
 * @returns {HistoryStore}
 */
export function makeHistoryStore(_deps) {
  throw new Error("client/store/history.js: the history store is not built yet");
}
