// SPDX-License-Identifier: AGPL-3.0-only
// One live stream from the server: what happened under this vault. Layer 7,
// beside `http.js`, and for the same reason — it is the swap the transport
// layer was written for. `EventSource` here, a postMessage or a socket next,
// and its subscribers never learn.
//
// TWO KINDS OF EVENT RIDE IT, and they are told apart by name (`STREAM` in
// `contracts/wire.js`).
//
//   `change` and `run` CARRY NOTHING, AND THAT IS THEIR DESIGN. The event says
//   *something under this vault changed*; the answer is to reread disk, which
//   is the work Reload already does. A payload naming files would be a second,
//   faster description of the workspace that can disagree with the first.
//
//   `history`, `chat` and `agents` CARRY JSON, because none of what they say is
//   on disk to be reread: the history lives in memory, a chat's words arrive as
//   the agent streams them, and an agent signing in is a fact about a process.
//   This module hands their raw `data` up by name (`onNamed`) and knows nothing
//   of what is in it; `chat.js` beside it is what reads the shapes.
//
// RECONNECTION CATCHES UP BY REREADING, NOT BY REPLAYING. `EventSource`
// reconnects on its own, and a reconnect is itself a reason to reread: the
// server was away, the disk may have moved, and the current state of it is the
// whole of the answer. So there are no event ids, no backlog and nothing to
// replay — which is also why killing the server and bringing it back cannot
// start a redraw loop: one reconnect, one reread, done. The JSON events catch
// up the same way: `onOpen` fires on every open, the first included, and what
// listens to it reads what it missed (the history from `history.read`, and the
// window's context reported again, because the server forgets a window whose
// stream closed).
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
 * @property {(name: string, hear: (data: string) => void) => () => void} onNamed
 *   ONE NAMED EVENT'S RAW `data`, for the events that carry some — `history`,
 *   `chat`, `agents`. What the text means is `chat.js`'s to read.
 * @property {(hear: () => void) => () => void} onOpen THE STREAM OPENED — the
 *   first time and every reconnect after it. The one moment a listener knows
 *   it may have missed something and the server may have forgotten this
 *   window.
 * @property {() => void} close Let the stream go. The tab going away does this
 *   for us; a test does not have one.
 */

/**
 * @param {string} baseUrl "" when this tab has chosen no folder, in which case
 *   nothing is opened at all: there is no vault to watch and the unprefixed
 *   route has no stream.
 * @param {string} [query] WHAT THE STREAM'S ADDRESS CARRIES, `?…` or "": the
 *   launch token in the built application, because the stream carries the
 *   chats and the history now and answers only this launch's window, and the
 *   window's own id (`WINDOW_PARAM`), because the server keeps a window's
 *   context exactly as long as its stream is open. Built by `client/boot.js`,
 *   which holds both; this module never learns either. The capability cookie
 *   needs nothing here: an `EventSource` sends the same-origin cookie by itself.
 * @returns {Events}
 */
export function makeEvents(baseUrl, query = "") {
  /** @type {Set<() => void>} */
  const hears = new Set();
  /** A run started or ended: the stream's second named event, which is a
   *  reason to reread `run.list` and never to redraw a page.
   *  @type {Set<() => void>} */
  const runHears = new Set();
  /** The events that carry data, by name, and who hears each.
   *  @type {Map<string, Set<(data: string) => void>>} */
  const named = new Map();
  /** Every open, the first included. @type {Set<() => void>} */
  const openHears = new Set();
  /** Which names the current source has a listener for, so a name first asked
   *  for after the stream opened is still heard. @type {Set<string>} */
  const wired = new Set();
  /** @type {EventSource | null} */
  let source = null;
  /** How many times the connection has opened. The FIRST one is this tab
   *  arriving and must not redraw anything; every one after it is a reconnect,
   *  and a reconnect is a reason to reread. */
  let opens = 0;

  /** Call each, and a listener that throws is one line in the console rather
   *  than the end of every listener after it.
   *  @template T @param {Iterable<(v: T) => void>} set @param {T} v @param {string} what */
  const each = (set, v, what) => {
    for (const hear of [...set]) {
      try {
        hear(v);
      } catch (e) {
        console.warn(what + " listener threw", e);
      }
    }
  };

  const tell = () => each(hears, undefined, "a live-change");

  /** One named event onto the current source, once. @param {string} name */
  function wire(name) {
    if (source === null || wired.has(name)) return;
    wired.add(name);
    source.addEventListener(name, (ev) => {
      const set = named.get(name);
      if (!set || set.size === 0) return;
      const data = /** @type {MessageEvent} */ (ev).data;
      each(set, typeof data === "string" ? data : "", "a " + name);
    });
  }

  function open() {
    if (source !== null || baseUrl === "") return;
    if (typeof EventSource !== "function") return;
    try {
      source = new EventSource(baseUrl + EVENTS_ROUTE + query);
    } catch {
      source = null;
      return;
    }
    wired.clear();
    source.addEventListener("open", () => {
      opens++;
      each(openHears, undefined, "a stream-open");
      if (opens > 1) tell();
    });
    // NAMED, not the default `message`. The server sends comment frames to keep
    // the connection alive and those are not events at all; a named event is the
    // only thing that means a file moved.
    source.addEventListener("change", () => tell());
    source.addEventListener("run", () => each(runHears, undefined, "a run"));
    for (const name of named.keys()) wire(name);
    // No handler for `error`. `EventSource` reconnects on its own, and a console
    // line on every server restart is noise in the one signal worth watching.
  }

  /** Whether nobody is listening to anything any more. */
  const idle = () => hears.size === 0 && runHears.size === 0 && openHears.size === 0 &&
    [...named.values()].every((set) => set.size === 0);

  /** @type {Events} */
  const events = {
    on(hear) {
      hears.add(hear);
      open();
      return () => {
        hears.delete(hear);
        if (idle()) events.close();
      };
    },
    onRun(hear) {
      runHears.add(hear);
      open();
      return () => {
        runHears.delete(hear);
        if (idle()) events.close();
      };
    },
    onNamed(name, hear) {
      let set = named.get(name);
      if (!set) { set = new Set(); named.set(name, set); }
      set.add(hear);
      open();
      wire(name);
      return () => {
        named.get(name)?.delete(hear);
        if (idle()) events.close();
      };
    },
    onOpen(hear) {
      openHears.add(hear);
      open();
      return () => {
        openHears.delete(hear);
        if (idle()) events.close();
      };
    },
    close() {
      if (source === null) return;
      source.close();
      source = null;
      wired.clear();
      opens = 0;
    },
  };
  return events;
}
