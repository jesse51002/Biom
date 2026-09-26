// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — THE CHATS: one agent process per chat, several at once, each
// spoken to over ACP, and Biom's own copy of every chat's stream.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; track A1 builds it, and may reshape
// anything here nothing else has started to call.
//
// What it owes (*Chat*, `acp`, `turn`, `history`, `skills`, `slash`,
// `switching`; *History and View Switcher*, `door`, `agents`):
//
//   - an agent started in the vault's root with the login environment, and a
//     new AgentId minted when it starts — a new one on every switch, whose new
//     session is handed the chat so far; a HELD chat has no agent yet, and a
//     switch on it re-targets the held message and mints nothing;
//   - `session/new` with the vault as `cwd` and NO MCP servers;
//   - one message at a time, refused with `limit` while a turn runs; Stop is
//     `session/cancel`; the stop reason turns the light, and red stays until
//     the next turn starts;
//   - `session/request_permission` answered `allow_always`, else `allow_once`,
//     and never shown;
//   - `fs/read_text_file` and `fs/write_text_file` confined to the vault, the
//     write through `deps.files` — atomic, and NOT the vault's baselined
//     `Files`, so the watcher sees an agent's write and the page redraws;
//   - every write it sees reported ONCE, through `deps.onEdit` and nothing
//     else, stamped with the agent's id and turn: a write it carried out
//     (`fs`), a completed edit, delete or move tool call (`tool`), a plain
//     shell write read by `shellwrites.ts` (`shell`). AGENT WRITES ARE
//     RECORDED ONLY HERE: `deps.files` is not wired to the history's own
//     writer callback, so an agent's `fs` write is never also the app's;
//   - at each turn's end, a kept `changed` update: every file the turn
//     changed, with its place, what happened, and lines added and removed;
//   - the / menu MERGED — the agent's `available_commands_update`, else the
//     probe session's, then every workspace skill it did not list — sent as a
//     `commands` update whenever it changes; config options sent as a
//     `config` update whenever they change, and a `chat.config` with no agent
//     running kept and applied when one starts;
//   - the stream kept as it arrived, under `deps.logDir` and never in git,
//     surviving a restart; a `tool` line may be compacted to its last state;
//     reopening by `session/resume` or `session/load` where offered, else a
//     new session handed the chat so far;
//   - no agent process outliving its chat or the server.

import type {
  AgentId, AgentInfo, AgentKey, AgentLaunch, ChatId, ChatPush, ChatRead, ChatSummary, ConfigValue, EditVia, Face, Files, PageId,
  Place, SlashCommand, Writer,
} from "../../contracts/types.ts";
import type { AcpConnection } from "../platform/acp.ts";
import type { TurnSignal } from "../domain/jev.ts";

/** One workspace skill, as `.agents/skills/<name>/SKILL.md`'s frontmatter
 *  says it: the / menu's half that is not the agent's. */
export interface Skill {
  name: string;
  description: string;
  /** Vault-relative, forward-slashed: `.agents/skills/<name>/SKILL.md`. */
  path: string;
}

/** EVERYTHING THE CHATS ARE HANDED, and they reach nothing else. */
export interface ChatsDeps {
  /** How to start an agent — track A2's `Agents.launch`. Null where it cannot
   *  be started, which makes the chat's light red with a sentence. */
  launch: (key: AgentKey) => Promise<AgentLaunch | null>;
  /** What this machine has now — A2's `Agents.list` — and its subscription,
   *  which is how a HELD first message goes out the moment an agent is
   *  Active, and how the probe session's commands fill the / menu before a
   *  chat has a session of its own. */
  agents: () => AgentInfo[];
  onAgents: (fn: (agents: AgentInfo[]) => void) => () => void;
  /** A session or a first message was refused with ACP's auth-required error:
   *  A2 marks the agent Inactive with `signin`, and the pop-up offers it. */
  refused: (key: AgentKey) => void;
  /** Open one ACP connection — `connectAcp` in `server/platform/acp.ts` in the
   *  running server, a scripted fake in a test. */
  connect: (launch: AgentLaunch, cwd: string) => AcpConnection;
  /** The vault's root, absolute: every agent's `cwd`, and the one folder
   *  `fs/*` requests are confined to. */
  root: string;
  /** Where each chat's kept log is written: beside the workspace as the run
   *  logs are (`.biom/`), ignored by git and by the watcher. */
  logDir: string;
  /** Files over the vault's root for the agent's `fs/write_text_file` — the
   *  atomic write, built WITHOUT the vault's baseline (`makeFiles(root)`) and
   *  without the history's writer callback. */
  files: Files;
  /** The workspace's skills, read fresh for each / menu. */
  skills: () => Promise<Skill[]>;
  /** The screen a vault-relative path is shown at — the history track's pure
   *  `placeOfPath`, closed over the page list — for a `changed` update. */
  placeOf: (path: string) => Promise<Place | null>;
  /** A page's `uid` by its id, for `chat.new`'s page, kept as a place. */
  uidOf: (page: PageId) => Promise<string | null>;
  /** Every write an agent made that Biom saw, once each. The ONLY route an
   *  agent's write takes into the history. */
  onEdit: (path: string, via: EditVia, writer: Writer) => void;
  /** Every turn's signals — its start, thinking, reply, tool titles, end —
   *  for Jev's schedule. */
  onTurn: (signal: TurnSignal) => void;
  /** The server's clock, for `at`, the light's ten minutes and the kept log. */
  now: () => number;
}

export interface Chats {
  create(init: { agent?: AgentKey; text?: string; page?: PageId; config?: Record<string, ConfigValue> }): Promise<ChatSummary>;
  list(): ChatSummary[];
  read(chat: ChatId, since?: number): Promise<ChatRead>;
  send(chat: ChatId, text: string): Promise<ChatSummary>;
  cancel(chat: ChatId): Promise<ChatSummary>;
  config(chat: ChatId, option: string, value: ConfigValue): Promise<ChatSummary>;
  switchAgent(chat: ChatId, agent: AgentKey): Promise<ChatSummary>;
  close(chat: ChatId): Promise<ChatSummary>;
  /** The / menu, merged. */
  commands(q: { chat?: ChatId; agent?: AgentKey }): Promise<SlashCommand[]>;
  /** The chat, harness and turn an agent id is running for — the history names
   *  the switcher's views with it. */
  agentOf(agent: AgentId): { chat: ChatId; harness: string; turn: number } | null;
  /** The agent running for a chat — how the server derives a window report's
   *  `agent` from its `chat`, ignoring what the window sent. */
  agentOfChat(chat: ChatId): AgentId | null;
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
