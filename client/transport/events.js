// SPDX-License-Identifier: AGPL-3.0-only
// One live stream from the server: this vault changed on disk. Layer 7, beside
// `http.js`, and for the same reason — it is the swap the transport layer was
// written for. `EventSource` here, a postMessage or a socket next, and its one
// subscriber never learns.
//
// IT CARRIES NOTHING AND THAT IS THE DESIGN. An event says *something under this
// vault changed*; the answer is to reread disk, which is the work Reload already
// does. A payload naming files would be a second, faster description of the
// workspace that can disagree with the first.
//
// RECONNECTION CATCHES UP BY REREADING, NOT BY REPLAYING. `EventSource`
// reconnects on its own, and a reconnect is itself a reason to reread: the
// server was away, the disk may have moved, and the current state of it is the
// whole of the answer. So there are no event ids, no backlog and nothing to
// replay — which is also why killing the server and bringing it back cannot
// start a redraw loop: one reconnect, one reread, done.
//
// IT NEVER THROWS AND IT NEVER BLOCKS BOOT. A browser with no `EventSource`, or
// a tab with no folder chosen, gets a stream that is simply never going to fire,
// and the Reload button is still the way.

import { EVENTS_ROUTE } from "../../contracts/wire.js";

/**
 * @typedef {object} Events
 * @property {(hear: () => void) => () => void} on Subscribe. Answers the
 *   unsubscribe, which also closes the stream when it was the last one.
 * @property {(hear: () => void) => () => void} onRun The stream's second
 *   named event: a run started or ended under this folder. A reason to reread
 *   `run.list`, never to redraw a page.
 * @property {() => void} close Let the stream go. The tab going away does this
 *   for us; a test does not have one.
 */

/**
 * @param {string} baseUrl "" when this tab has chosen no folder, in which case
 *   nothing is opened at all: there is no vault to watch and the unprefixed
 *   route has no stream.
 * @returns {Events}
 */
export function makeEvents(baseUrl) {
  /** @type {Set<() => void>} */
  const hears = new Set();
  /** A run started or ended: the stream's second named event, which is a
   *  reason to reread `run.list` and never to redraw a page.
   *  @type {Set<() => void>} */
  const runHears = new Set();
  /** @type {EventSource | null} */
  let source = null;
  /** How many times the connection has opened. The FIRST one is this tab
   *  arriving and must not redraw anything; every one after it is a reconnect,
   *  and a reconnect is a reason to reread. */
  let opens = 0;

  const tell = () => {
    for (const hear of [...hears]) {
      try {
        hear();
      } catch (e) {
        console.warn("a live-change listener threw", e);
      }
    }
  };

  function open() {
    if (source !== null || baseUrl === "") return;
    if (typeof EventSource !== "function") return;
    try {
      source = new EventSource(baseUrl + EVENTS_ROUTE);
    } catch {
      source = null;
      return;
    }
    source.addEventListener("open", () => {
      opens++;
      if (opens > 1) tell();
    });
    // NAMED, not the default `message`. The server sends comment frames to keep
    // the connection alive and those are not events at all; a named event is the
    // only thing that means a file moved.
    source.addEventListener("change", () => tell());
    source.addEventListener("run", () => {
      for (const hear of [...runHears]) {
        try {
          hear();
        } catch (e) {
          console.warn("a run listener threw", e);
        }
      }
    });
    // No handler for `error`. `EventSource` reconnects on its own, and a console
    // line on every server restart is noise in the one signal worth watching.
  }

  return {
    on(hear) {
      hears.add(hear);
      open();
      return () => {
        hears.delete(hear);
        if (hears.size === 0 && runHears.size === 0) this.close();
      };
    },
    /** A run started or ended. Same stream, its own event: the screens that
     *  draw runs reread on it, and nothing else moves.
     *  @param {() => void} hear @returns {() => void} */
    onRun(hear) {
      runHears.add(hear);
      open();
      return () => {
        runHears.delete(hear);
        if (hears.size === 0 && runHears.size === 0) this.close();
      };
    },
    close() {
      if (source === null) return;
      source.close();
      source = null;
      opens = 0;
    },
  };
}
