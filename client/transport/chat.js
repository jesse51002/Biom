// SPDX-License-Identifier: AGPL-3.0-only
// Layer 7 — THE STREAM'S THREE JSON EVENTS, TYPED: `history`, `chat` and
// `agents` (`STREAM` in `contracts/wire.js`, `StreamEvent` in `types.ts`).
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the chat client track builds it.
//
// There is ONE stream per tab and `events.js` owns it — a second
// `EventSource` would be a second watcher on the server for the same folder.
// So this reads the named events off that one stream: `events.js` gains a
// hook that hands up a named event's raw `data`, and this turns each into the
// shape the contract says it carries, dropping one that does not parse rather
// than throwing into a listener. `change` and `run` stay `events.js`'s own.

/** @import { AgentInfo, ChatPush, HistoryEntry, StreamEvent } from "../../contracts/types.ts" */

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

/**
 * One named event's data, decoded to what the contract says it carries, or
 * null. NOT BUILT: answers null.
 * @param {string} _name
 * @param {string} _data
 * @returns {StreamEvent | null}
 */
export function decodeStream(_name, _data) {
  return null;
}

/**
 * NOT BUILT: throws.
 * @param {NamedStream} _stream
 * @returns {ChatStream}
 */
export function makeChatStream(_stream) {
  throw new Error("client/transport/chat.js: the chat stream is not built yet");
}
