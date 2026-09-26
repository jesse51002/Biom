// SPDX-License-Identifier: AGPL-3.0-only
// Layer 9 — THIS WINDOW'S COPY OF THE CHATS AND THE AGENTS: the list of
// chats, the open chat's stream, what this machine has, and every act the
// input box, the pickers and the pop-ups perform.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the chat client track builds it.
//
// Every act here is one `chat.*` or `agents.*` kind through the transport,
// and every one of them is the host's to say: nothing in a box can reach
// this store. It takes the stream's `chat` and `agents` events, keeps the
// open chat's updates in `seq` order with nothing taken twice, and catches up
// with `chat.read` from the last `seq` it holds on arrival and on reconnect.

/** @import { AgentInfo, AgentKey, ChatId, ChatPush, ChatSummary, ChatUpdate, ConfigValue, PageId, SlashCommand, Transport } from "../../contracts/types.ts" */

/**
 * @typedef {object} ChatState
 * @property {ChatSummary[]} chats Newest first.
 * @property {AgentInfo[]} agents
 * @property {ChatId | null} open The chat whose stream is held.
 * @property {ChatUpdate[]} updates That chat's stream, in `seq` order.
 */

/**
 * @typedef {object} ChatStore
 * @property {() => ChatState} get
 * @property {(fn: () => void) => () => void} on
 * @property {(push: ChatPush) => void} takeChat
 * @property {(agents: AgentInfo[]) => void} takeAgents
 * @property {(chat: ChatId | null) => Promise<void>} open
 * @property {(agent: AgentKey, text?: string, page?: PageId, config?: Record<string, ConfigValue>) => Promise<ChatSummary>} create
 * @property {(chat: ChatId, text: string) => Promise<ChatSummary>} send
 * @property {(chat: ChatId) => Promise<void>} cancel
 * @property {(chat: ChatId, option: string, value: ConfigValue) => Promise<void>} config
 * @property {(chat: ChatId, agent: AgentKey) => Promise<void>} switchAgent
 * @property {(q: { chat?: ChatId, agent?: AgentKey }) => Promise<SlashCommand[]>} commands
 */

/**
 * NOT BUILT: throws.
 * @param {{ transport: Transport }} _deps
 * @returns {ChatStore}
 */
export function makeChatStore(_deps) {
  throw new Error("client/store/chats.js: the chat store is not built yet");
}
