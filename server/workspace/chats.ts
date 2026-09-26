// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — THE CHATS: one agent process per chat, several at once, each
// spoken to over ACP, and Biom's own copy of every chat's stream.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the chats track builds it, and may
// reshape anything here nothing else has started to call.
//
// What it owes (*Chat*, `acp`, `turn`, `history`, `skills`, `slash`,
// `switching`; *History and View Switcher*, `door`, `agents`):
//
//   - an agent started in the vault's root with the login environment, and a
//     new AgentId minted when it starts — a new one on every switch, whose new
//     session is handed the chat so far;
//   - `session/new` with the vault as `cwd` and NO MCP servers;
//   - one message at a time, refused with `limit` while a turn runs; Stop is
//     `session/cancel`; the stop reason turns the light;
//   - `session/request_permission` answered `allow_always`, else `allow_once`,
//     and never shown;
//   - `fs/read_text_file` and `fs/write_text_file` confined to the vault, the
//     write through the atomic `Files.write`;
//   - every write it sees reported ONCE to the history, stamped with the
//     agent's id: a write it carried out (`fs`), a completed edit, delete or
//     move tool call (`tool`), a plain shell write read by `shellwrites.ts`
//     (`shell`);
//   - the stream kept as it arrived, beside the workspace like run logs and
//     never in git, surviving a restart; reopening by `session/resume` or
//     `session/load` where offered, else a new session handed the chat so far;
//   - no agent process outliving its chat or the server.

import type { AgentId, AgentKey, ChatId, ChatPush, ChatRead, ChatSummary, ConfigValue, EditVia, Face, PageId, SlashCommand, Writer } from "../../contracts/types.ts";
import type { TurnSignal } from "../domain/jev.ts";

/** What the chats are handed, beyond the launch the agents resolve. */
export interface ChatsDeps {
  /** Every write an agent made that Biom saw, once each. */
  onEdit: (path: string, via: EditVia, writer: Writer) => void;
  /** Every turn's signals, for Jev. */
  onTurn: (signal: TurnSignal) => void;
}

export interface Chats {
  create(init: { agent: AgentKey; text?: string; page?: PageId; config?: Record<string, ConfigValue> }): Promise<ChatSummary>;
  list(): ChatSummary[];
  read(chat: ChatId, since?: number): Promise<ChatRead>;
  send(chat: ChatId, text: string): Promise<ChatSummary>;
  cancel(chat: ChatId): Promise<ChatSummary>;
  config(chat: ChatId, option: string, value: ConfigValue): Promise<ChatSummary>;
  switchAgent(chat: ChatId, agent: AgentKey): Promise<ChatSummary>;
  close(chat: ChatId): Promise<ChatSummary>;
  /** The / menu: the agent's commands, then every workspace skill it did not
   *  list. */
  commands(q: { chat?: ChatId; agent?: AgentKey }): Promise<SlashCommand[]>;
  /** The chat and harness an agent id is running for — the history names the
   *  switcher's views with it. */
  agentOf(agent: AgentId): { chat: ChatId; harness: string } | null;
  /** Jev's face for a turn (`turn` a number) or for the name (`turn` null). */
  face(chat: ChatId, turn: number | null, face: Face): void;
  /** Hear every chat's pushes. Answers the unsubscribe. */
  on(fn: (push: ChatPush) => void): () => void;
  /** End every agent: TERM, a grace, KILL. */
  endAll(): Promise<void>;
  /** KILL every agent now, synchronously, for the process's exit handler. */
  killAll(): void;
}

/** NOT BUILT: throws. */
export function makeChats(_deps: ChatsDeps): Chats {
  throw new Error("server/workspace/chats.ts: chats are not built yet");
}
