// SPDX-License-Identifier: AGPL-3.0-only
// Layer 7 — THE STREAM'S THREE JSON EVENTS, TYPED: `history`, `chat` and
// `agents` (`STREAM` in `contracts/wire.js`, `StreamEvent` in `types.ts`).
//
// There is ONE stream per tab and `events.js` owns it — a second
// `EventSource` would be a second watcher on the server for the same folder.
// So this reads the named events off that one stream: `events.js` hands up a
// named event's raw `data`, and this turns each into the shape the contract
// says it carries, DROPPING ONE THAT DOES NOT PARSE rather than throwing into a
// listener. `change` and `run` stay `events.js`'s own.
//
// WHAT IS CHECKED IS WHAT A READER RELIES ON, and no more. A history entry is
// checked whole — its kind, its `seq`, its writer and its place — because the
// switcher acts on it and a malformed one would be followed or skipped by
// accident; a history batch holding one bad entry is dropped whole, because
// the reader tracks `seq` and a batch with a hole in it is a batch it would
// take as complete. A chat push and the agents list are checked as far as a
// store keys on them — the chat's id, each update's `seq` and `kind`, each
// agent's key — and what a look draws out of them is the look's to be careful
// with. The server is Biom's own, so a failure here is a bug to see, and it is
// said once on the console with the event's name.

/** @import { AgentInfo, ChatPush, HistoryEntry, Place, StreamEvent } from "../../contracts/types.ts" */

import { STREAM } from "../../contracts/wire.js";
import { PAGE_SCREENS, VIEW_NAMES } from "../../contracts/address.js";

/**
 * @typedef {object} NamedStream What this reads from: the one stream, by
 *   event name, handing up the raw `data` text.
 * @property {(name: string, hear: (data: string) => void) => () => void} onNamed
 */

/**
 * @typedef {object} ChatStream
 * @property {(hear: (entries: HistoryEntry[]) => void) => () => void} onHistory
 * @property {(hear: (push: ChatPush) => void) => () => void} onChat
 * @property {(hear: (agents: AgentInfo[]) => void) => () => void} onAgents
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v @returns {v is string} */
const isStr = (v) => typeof v === "string";
/** @param {unknown} v */
const isSeq = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** How Biom saw a write. @type {ReadonlySet<unknown>} */
const VIAS = new Set(["fs", "tool", "shell", "app"]);

/**
 * A place as the history keeps it: a page by its `uid` and one of its screens,
 * or another view by its id.
 * @param {unknown} v
 * @returns {v is Place}
 */
export function isPlace(v) {
  if (!isObj(v) || !isStr(v.view) || !VIEW_NAMES.has(/** @type {any} */ (v.view))) return false;
  if (v.view === "page") return isStr(v.uid) && v.uid !== "" && isStr(v.screen) && PAGE_SCREENS.has(/** @type {any} */ (v.screen));
  return isStr(v.id);
}

/** @param {unknown} v */
function isWriter(v) {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case "you": return isStr(v.window) && v.window !== "";
    case "agent": return isStr(v.agent) && isStr(v.chat) && isStr(v.harness) && typeof v.turn === "number" && Number.isInteger(v.turn);
    case "run": return isStr(v.session);
    default: return false;
  }
}

/**
 * ONE LINE OF THE HISTORY, whole: the stream's and `history.read`'s alike, so
 * the two routes into the mirror are checked by one statement.
 * @param {unknown} v
 * @returns {v is HistoryEntry}
 */
export function isHistoryEntry(v) {
  if (!isObj(v) || !isSeq(v.seq) || typeof v.at !== "number" || !isWriter(v.writer)) return false;
  switch (v.kind) {
    case "open":
    case "view":
      return isStr(v.window) && v.window !== "" && isPlace(v.place);
    case "edit":
      return (v.place === null || isPlace(v.place)) &&
        (v.path === null || isStr(v.path)) &&
        VIAS.has(v.via) &&
        (v.snapshot === null || isStr(v.snapshot));
    default:
      return false;
  }
}

/** @param {unknown} v @returns {v is ChatPush} */
function isChatPush(v) {
  return isObj(v) && isObj(v.chat) && isStr(v.chat.id) && v.chat.id !== "" &&
    Array.isArray(v.updates) &&
    v.updates.every((u) => isObj(u) && typeof u.seq === "number" && Number.isInteger(u.seq) && isStr(u.kind));
}

/** @param {unknown} v @returns {v is AgentInfo[]} */
const isAgents = (v) => Array.isArray(v) && v.every((a) => isObj(a) && isStr(a.key) && a.key !== "");

/**
 * One named event's data, decoded to what the contract says it carries, or
 * null — for a name this does not know, for text that is not JSON, and for
 * JSON that is not the shape. `change` and `run` carry a bare `1` and are
 * answered as that whatever the text said, because nothing reads it.
 * @param {string} name
 * @param {string} data
 * @returns {StreamEvent | null}
 */
export function decodeStream(name, data) {
  if (name === STREAM.CHANGE) return { event: "change", data: 1 };
  if (name === STREAM.RUN) return { event: "run", data: 1 };
  if (name !== STREAM.HISTORY && name !== STREAM.CHAT && name !== STREAM.AGENTS) return null;
  /** @type {unknown} */
  let v;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  switch (name) {
    case STREAM.HISTORY:
      return Array.isArray(v) && v.every(isHistoryEntry) ? { event: "history", data: v } : null;
    case STREAM.CHAT:
      return isChatPush(v) ? { event: "chat", data: v } : null;
    default:
      return isAgents(v) ? { event: "agents", data: v } : null;
  }
}

/**
 * The three JSON events, each to its own listeners, decoded. A listener that
 * throws is said on the console and the others still hear the event.
 * @param {NamedStream} stream
 * @returns {ChatStream}
 */
export function makeChatStream(stream) {
  /** @template T @param {string} name @param {(ev: StreamEvent) => T | null} pick */
  const hook = (name, pick) =>
    /** @param {(v: T) => void} hear */
    (hear) => stream.onNamed(name, (data) => {
      const ev = decodeStream(name, data);
      const v = ev === null ? null : pick(ev);
      if (v === null) {
        console.warn(`[biom] a ${name} event that is not the shape the contract says was dropped`);
        return;
      }
      try {
        hear(v);
      } catch (e) {
        console.warn(`a ${name} listener threw`, e);
      }
    });

  return {
    onHistory: hook(STREAM.HISTORY, (ev) => (ev.event === "history" ? ev.data : null)),
    onChat: hook(STREAM.CHAT, (ev) => (ev.event === "chat" ? ev.data : null)),
    onAgents: hook(STREAM.AGENTS, (ev) => (ev.event === "agents" ? ev.data : null)),
  };
}
