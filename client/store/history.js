// SPDX-License-Identifier: AGPL-3.0-only
// Layer 9 — THIS WINDOW'S COPY OF THE HISTORY, and its reports to the server.
//
// It holds the entries the server appended, in `seq` order, each with the
// time THIS WINDOW RECEIVED it, read off the clock it is handed — the switcher
// times everything by that and never by the server's `at`, which is what lets
// an end-to-end test move one window's time with Playwright's clock. It
// catches up with `history.read` on arrival and on every reconnect, merges the
// stream's batches by `seq` so nothing is taken twice, and reports this
// window's context with `window.report` — with `moved` when the screen moved,
// and by whom.
//
// A CATCH-UP READS EVERYTHING AGAIN, and does not trust what it held. The
// history lives in the server's memory, so a server that restarted has a new
// one whose `seq` starts again at 1 — and an entry held from before would be
// mistaken, by `seq`, for a different entry of the new one. A reconnect is the
// only moment that can have happened, and it is rare, so the whole history is
// read again rather than guessed at. Between reconnects the stream is the
// feed, and a hole in it — a batch whose `seq` jumps — is filled from `head`.
//
// WHAT CAME FROM WHERE IS KEPT, because only one of them may move the screen.
// An entry the stream brought is `live`: it happened just now, and the
// switcher follows a live edit. One a read or a report answer brought is the
// past, read back — after a reload that is every entry, and following any of
// them would bring up a page an agent wrote minutes ago.
//
// REPORTS GO ONE AT A TIME, in the order they were made. Two in flight at
// once could land at the server the other way round, and a history that says
// the person opened a page and then the switcher brought up the one before it
// is a history that has the screen wrong. Each answer is the entries it
// appended, and they are taken before the next report goes, so the window
// knows them without waiting for the stream. The reports still in flight are
// readable (`unanswered`), because *Go back to* is computed from this window's
// views and the one being reported is already on screen.
//
// A MESSAGE TO AN AGENT GOES IN THE SAME LINE (`inLine`). The server adds the
// page on screen to a message from the context this window last reported, so
// the message leaves only once every report made before it is answered —
// which is when the server has kept that context — and a report made after it
// waits for the message's answer, by which time the server has read it. Two
// separate requests promise no order on the way; one line does.

/** @import { HistoryEntry, HistoryRead, Move, Transport, WindowReport } from "../../contracts/types.ts" */

import { PROTOCOL, nextId } from "../../contracts/wire.js";
import { isHistoryEntry } from "../transport/chat.js";

/**
 * @typedef {object} Received An entry, and when and how this window got it.
 * @property {HistoryEntry} entry
 * @property {number} got By this window's own clock.
 * @property {boolean} live It arrived on the stream, as it happened — not
 *   read back by a catch-up or a report's answer.
 */

/**
 * @typedef {object} Unanswered A report in flight that moved the screen.
 * @property {WindowReport} context
 * @property {Move} moved
 */

/**
 * @typedef {object} HistoryStore
 * @property {() => readonly Received[]} get Every entry held, `seq` ascending.
 * @property {() => number} head The `seq` through which nothing is missing.
 * @property {(fn: (added: readonly Received[]) => void) => () => void} on
 *   Hear what was taken, each entry once: a batch, a report's answer, or what
 *   a catch-up read back. An empty batch says the reports in flight changed.
 * @property {(entries: readonly HistoryEntry[], live?: boolean) => void} take
 *   A batch off the stream (`live`), or entries read back.
 * @property {() => Promise<void>} catchUp Read the whole history again.
 * @property {(context: WindowReport, moved?: Move) => Promise<readonly HistoryEntry[]>} report
 *   Say what this window has open, and who moved it; answers what was appended.
 * @property {() => readonly Unanswered[]} unanswered The reports that moved
 *   the screen and have not been answered yet, oldest first.
 * @property {<T>(call: () => Promise<T>) => Promise<T>} inLine Make a call in
 *   line with the reports: once every report made before it is answered, and
 *   before any made after it leaves. Answers the call's own answer, or its
 *   failure; the reports after it go on either way.
 */

/** HOW MANY ENTRIES A WINDOW KEEPS, and it is the server's own bound — the
 *  history's ring (`LIMIT` in `server/domain/history.ts`) holds five thousand,
 *  so a window never holds more than there is. */
export const HISTORY_LIMIT = 5000;

/**
 * @param {{ transport: Transport, now: () => number, limit?: number }} deps
 * @returns {HistoryStore}
 */
export function makeHistoryStore(deps) {
  const { transport, now } = deps;
  const limit = deps.limit ?? HISTORY_LIMIT;

  /** Seq ascending. @type {Received[]} */
  let held = [];
  /** @type {Set<number>} */
  let seqs = new Set();
  /** The seq through which nothing is missing. */
  let head = 0;
  /** @type {Set<(added: readonly Received[]) => void>} */
  const hears = new Set();

  /** Live entries taken while a catch-up's read is in flight, which the read
   *  cannot have seen and so must survive it. Null when no read is.
   *  @type {Received[] | null} */
  let during = null;
  /** @type {Promise<void> | null} */
  let reading = null;
  let again = false;
  /** @type {Promise<void> | null} */
  let filling = null;

  /** @type {Unanswered[]} */
  const inFlight = [];
  /** The tail every report waits behind. @type {Promise<unknown>} */
  let queue = Promise.resolve();
  /** What was last said about a failure, so a server that refuses every
   *  report is one line on the console and not one per click. */
  let said = "";

  /** @param {readonly Received[]} added */
  function tell(added) {
    for (const hear of [...hears]) {
      try {
        hear(added);
      } catch (e) {
        console.warn("a history listener threw", e);
      }
    }
  }

  /** @param {string} what @param {unknown} why */
  function warn(what, why) {
    const text = what + ": " + (why && typeof why === "object" && "message" in why ? String(/** @type {any} */ (why).message) : String(why));
    if (text === said) return;
    said = text;
    console.warn("[biom] " + text);
  }

  /** Insert one, in seq order; false when it was held already.
   *  @param {Received} r */
  function insert(r) {
    const seq = r.entry.seq;
    if (seqs.has(seq)) return false;
    seqs.add(seq);
    // Almost always the end; walk back from it when it is not.
    let at = held.length;
    while (at > 0 && /** @type {Received} */ (held[at - 1]).entry.seq > seq) at--;
    held.splice(at, 0, r);
    return true;
  }

  /** Walk `head` over everything that is now there, and drop the oldest past
   *  the limit — which cannot be missing any more either. */
  function settle() {
    while (seqs.has(head + 1)) head++;
    if (held.length > limit) {
      for (const gone of held.splice(0, held.length - limit)) seqs.delete(gone.entry.seq);
      const first = held[0];
      if (first && first.entry.seq - 1 > head) head = first.entry.seq - 1;
      while (seqs.has(head + 1)) head++;
    }
  }

  /** Take entries without saying so. @param {readonly unknown[]} entries
   *  @param {boolean} live @returns {Received[]} */
  function absorb(entries, live) {
    const got = now();
    /** @type {Received[]} */
    const added = [];
    for (const entry of entries) {
      if (!isHistoryEntry(entry)) {
        warn("a history entry that is not the shape the contract says was skipped", entry && typeof entry === "object" ? /** @type {any} */ (entry).seq : entry);
        continue;
      }
      const r = Object.freeze({ entry, got, live });
      if (insert(r)) {
        added.push(r);
        if (live && during !== null) during.push(r);
      }
    }
    settle();
    return added;
  }

  /** Whether something held sits beyond a hole. */
  const gapped = () => {
    const last = held[held.length - 1];
    return last !== undefined && last.entry.seq > head;
  };

  /** @param {number} [since] @returns {Promise<HistoryRead | null>} */
  async function read(since) {
    const res = await transport.call(/** @type {any} */ ({ id: nextId(), g: PROTOCOL, kind: "history.read", ...(since === undefined ? {} : { since }) }));
    if (!res.ok) { warn("the history could not be read", res.error); return null; }
    const v = /** @type {any} */ (res.value);
    if (!v || typeof v !== "object" || !Array.isArray(v.entries) || typeof v.head !== "number") {
      warn("the history read back was not a history", typeof v);
      return null;
    }
    return /** @type {HistoryRead} */ (v);
  }

  /** A HOLE IN THE FEED, filled from `head`. A server whose own head is behind
   *  ours restarted underneath us, and that is a catch-up rather than a fill. */
  function fill() {
    if (filling !== null || reading !== null) return;
    const since = head;
    filling = (async () => {
      const got = await read(since);
      if (got === null) return;
      if (got.head < since) { void catchUp(); return; }
      const added = absorb(got.entries, false);
      // Whatever the server no longer holds between `since` and its head is
      // gone for good, so the window is complete through the server's head.
      if (got.head > head) head = got.head;
      settle();
      if (added.length) tell(added);
    })().finally(() => { filling = null; });
  }

  /** @returns {Promise<void>} */
  function catchUp() {
    if (reading !== null) { again = true; return reading; }
    reading = (async () => {
      do {
        again = false;
        during = [];
        const got = await read();
        const kept = during;
        during = null;
        if (got === null) return;
        // THE READ REPLACES EVERYTHING, and what the stream brought while it
        // was in flight is put back on top where the read could not see it.
        held = [];
        seqs = new Set();
        head = got.head;
        const readBack = absorb(got.entries, false);
        for (const r of kept) if (r.entry.seq > got.head) insert(r);
        head = got.head;
        settle();
        // WHAT THE READ BROUGHT, and not what the stream brought while it
        // read: those were told when they came, live, and telling them again
        // would have the switcher follow one write twice.
        tell(readBack);
      } while (again);
    })().finally(() => { reading = null; });
    return reading;
  }

  return {
    get() {
      return held;
    },

    head() {
      return head;
    },

    on(fn) {
      hears.add(fn);
      return () => { hears.delete(fn); };
    },

    take(entries, live = false) {
      const added = absorb(entries, live);
      if (added.length) tell(added);
      // Only the stream is the feed; a report's answer can land ahead of the
      // stream's copy of what came before it, and that is not a hole.
      if (live && gapped()) fill();
    },

    catchUp,

    report(context, moved) {
      /** @type {Unanswered | null} */
      const item = moved === undefined ? null : Object.freeze({ context, moved });
      if (item !== null) inFlight.push(item);
      const run = queue.then(async () => {
        const res = await transport.call(/** @type {any} */ ({
          id: nextId(), g: PROTOCOL, kind: "window.report", context, ...(moved === undefined ? {} : { moved }),
        }));
        if (!res.ok) { warn("this window's context was not reported", res.error); return []; }
        const value = /** @type {unknown} */ (res.value);
        return Array.isArray(value) ? value : [];
      }).then((entries) => {
        // Taken, then the report stops being in flight, then ONE telling — so
        // a reader never sees the view twice or not at all.
        const added = absorb(entries, false);
        if (item !== null) inFlight.splice(inFlight.indexOf(item), 1);
        if (added.length || item !== null) tell(added);
        return /** @type {readonly HistoryEntry[]} */ (added.map((r) => r.entry));
      }, (e) => {
        if (item !== null) inFlight.splice(inFlight.indexOf(item), 1);
        warn("this window's context was not reported", e);
        tell([]);
        return /** @type {readonly HistoryEntry[]} */ ([]);
      });
      queue = run;
      return run;
    },

    unanswered() {
      return inFlight;
    },

    inLine(call) {
      const run = queue.then(call);
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}
