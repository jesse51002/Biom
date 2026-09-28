// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — THE CHATS: one agent process per chat, several at once, each
// spoken to over ACP, and Biom's own copy of every chat's stream.
//
// What it owes (*Chat*, `acp`, `turn`, `history`, `skills`, `slash`,
// `switching`; *History and View Switcher*, `door`, `agents`), and how:
//
// ONE AGENT PER CHAT, STARTED WHEN A MESSAGE NEEDS IT. A chat's agent starts
// in the vault's root with the environment the agents module resolved, and is
// given a NEW AgentId each time it starts — a restart after a crash, a
// reopening after the server restarted, a switch. Nothing starts before a
// message: the probe session the agents module keeps fills the pickers and the
// / menu until then (*Chat*, `slash`: *it is there before the first message*),
// so an open chat nobody writes in costs no process. `initialize` offers `fs`
// both ways, no terminal and both terminal sign-in flags (`acp-wire.ts`);
// `session/new` carries the vault as `cwd` and no MCP servers.
//
// A HELD MESSAGE. A chat created with no agent, whose agent is not Active and
// has no session of the chat's open — its Gateway down, installing, failed,
// being looked at — or whose agent refused for want of a sign-in, keeps its
// message and says `held`. The subscription to the agents list is how it
// goes out: the first agent to turn Active takes a chat with none, the chat's
// own agent turning Active sends it, and after a sign-in refusal only once it
// has been seen Inactive and then Active again. `switchAgent` on a held chat re-targets it and mints
// nothing. A refusal is retried at most twice, so an agent whose probe opens a
// session and whose chat session refuses cannot loop.
//
// ONE MESSAGE AT A TIME. `send` while a turn is held, starting or running is
// refused with `limit`; Stop is `session/cancel`, and an agent that has not
// answered it within a grace is ended, because the next message cannot wait
// on it. The stop reason turns the light: amber while working, green for ten
// minutes after `end_turn`, none after `cancelled`, red for `refusal`,
// `max_tokens`, `max_turn_requests` and a crash — and red STAYS until the
// next turn starts, as the Chat spec's mockup has it. The light is computed
// from the last turn's end, so it survives a restart, and a timer says when
// green lapses.
//
// PERMISSION IS ANSWERED, NEVER SHOWN: `allow_always`, else `allow_once`.
//
// THE FILES. `fs/read_text_file` and `fs/write_text_file` are confined to the
// vault — resolved, both spellings of a root reached through a symlink tried —
// and go through `deps.files`, whose `safe()` refuses `..` and a symlink out
// with an error the agent sees. The write is `Files.write`, the atomic one,
// over a `Files` built WITHOUT the vault's `Seen`, so the watcher takes it as
// an outside change and the page redraws. Nothing is written inside `.git/` or
// the framework's `.biom/`. The vault is committed once before a turn's first
// such write: the framework's rule that the server commits before an agent
// writes, at the grain of a turn.
//
// EVERY WRITE SEEN IS REPORTED ONCE, THROUGH `deps.onEdit` AND NOTHING ELSE,
// stamped with the agent's id and the turn: an `fs` write Biom carried out, a
// completed edit, delete or move tool call, a plain shell write read from an
// `execute` call's command line (`edits.ts`, `shellwrites.ts`). An `fs` write
// and the tool call that made it are one edit: the write claims the tool call
// in flight that names its path, or waits, unclaimed, for the one that
// completes naming it. At the turn's end a `changed` update is kept: every file
// the turn changed, its place, what happened, and lines added and removed —
// counted from the tool calls' LAST states, since an agent may refine a diff
// after the call completes.
//
// THE / MENU is the agent's `available_commands_update` — the probe session's
// until the chat's own sends one — and then every workspace skill it did not
// list, sent as a `commands` update whenever the merged list changes. A message
// naming a workspace skill the agent did not list goes out as a sentence
// pointing at its `SKILL.md`, never as `/name`, which that agent would not
// know. CONFIG is the session's config options — the probe's until the chat
// has a session — sent as a `config` update whenever they change. A value
// picked with no agent running, or mid-turn, is kept and applied before the
// next message: the spec promises the next message and no sooner.
//
// THE KEPT LOG. Every chat's stream is appended, as it arrives, to
// `<logDir>/chats/<id>.jsonl` — under `.biom/`, which ignores itself in git
// and which the watcher skips — one record per line: a header, the chat's
// agent, its session (for `session/resume` or `session/load` after a restart),
// the config values kept for the next start, and every update. It survives a
// restart: at construction every log is scanned for its summary, and a chat's
// updates are read into memory only when somebody reads or writes it. A turn
// the server died in the middle of is ended `crashed` on the scan. A torn last
// line is skipped. Reply and thought chunks arriving together are joined into
// one update before it is published, and a TOOL LINE IS COMPACTED: its update
// replaces the line's earlier one IN PLACE, carrying the newer `seq` — so the
// stream keeps the order lines first appeared in, a reader after `since` still
// hears every line that changed, and `seq` rises across everything except a
// compacted tool line, which a reader replaces by id. The file is rewritten
// compact at a turn's end once enough of it is superseded.
//
// REOPENING. A chat whose agent is gone — closed, crashed, the server
// restarted — starts it again on its next message, and reopens its session by
// `session/resume`, else `session/load` (whose replay is not news and is
// dropped), where the agent offers them. Otherwise, and on every switch of
// agent, a new session's first message is HANDED THE CHAT SO FAR: the person's
// messages, the replies and the actions' titles, the oldest dropped past a
// bound.
//
// AN AGENT THAT WANTS `authenticate` IN EVERY PROCESS — Grok Build, Cursor,
// Junie — is sent it, with the method that last signed it in, before its
// session is opened or reopened; one whose method is refused is a sign-in
// refusal like any other. No other agent is ever sent `authenticate` here.
//
// AN IDLE AGENT IS ENDED: `reap`, on the composition root's timer, ends a
// chat's agent that has had no turn for thirty minutes when no window has the
// chat open. Its chat is untouched; the next message starts it again exactly
// as a reopening does.
//
// NO AGENT OUTLIVES ITS CHAT OR THE SERVER: `close` ends a chat's, `endAll`
// every one with the TERM–grace–KILL ladder, and `killAll` KILLs them all at
// once for the exit handler.

import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type {
  AgentId, AgentInfo, AgentKey, AgentLaunch, ChangedFile, ChatId, ChatLight, ChatPush, ChatRead, ChatSummary, ChatUpdate, ConfigOption,
  ConfigValue, EditVia, Face, Files, HostErrorCode, PageId, Place, SlashCommand, TurnEnd, TurnPhase, Writer,
} from "../../contracts/types.ts";
import type { AcpConnection, AcpExit } from "../platform/acp.ts";
import { AcpRpcError, INTERNAL_ERROR, INVALID_PARAMS, RESOURCE_NOT_FOUND, isAuthRequired, isClosed } from "../platform/acp.ts";
import type { ToolState } from "../platform/acp-wire.ts";
import {
  ACP_PROTOCOL_VERSION, choosePermission, initializeParams, mergeTool, newSessionParams, promptParams, readInitialize, readSession, readStop,
  readUpdate, reopenParams, setConfigRequest, textOf, toConfigOptions, toPlan, toSlashCommands, toUsage,
} from "../platform/acp-wire.ts";
import { within } from "../platform/files.ts";
import { parseAny } from "../platform/yaml.ts";
import type { Edit, EditEvent, VaultRoots } from "../domain/edits.ts";
import { TOOL_EDIT_KINDS, editsOf, toolLineOf, toolPaths } from "../domain/edits.ts";
import type { TurnSignal } from "../domain/jev.ts";

/** One workspace skill, as `.agents/skills/<name>/SKILL.md`'s frontmatter
 *  says it: the / menu's half that is not the agent's. */
export interface Skill {
  name: string;
  description: string;
  /** Vault-relative, forward-slashed: `.agents/skills/<name>/SKILL.md`. */
  path: string;
}

/** Where a vault keeps its skills, one folder each. */
const SKILLS_DIR = ".agents/skills";

/** THE WORKSPACE'S SKILLS, as the / menu lists them: every folder under
 *  `.agents/skills/` holding a `SKILL.md`, named and described by its
 *  frontmatter — the folder's name where the frontmatter names none, and no
 *  description where it will not parse. A folder starting `_` is the
 *  checker's and is not a skill. What `ChatsDeps.skills` is, over the vault's
 *  own `Files`. */
export async function readSkills(files: Files): Promise<Skill[]> {
  let dirs: { name: string; dir: boolean }[];
  try {
    dirs = await files.list(SKILLS_DIR);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const d of dirs) {
    if (!d.dir || d.name.startsWith("_") || d.name.startsWith(".")) continue;
    const path = `${SKILLS_DIR}/${d.name}/SKILL.md`;
    let text: string | null;
    try {
      text = await files.read(path);
    } catch {
      text = null;
    }
    if (text === null) continue;
    let name = d.name;
    let description = "";
    const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (m) {
      try {
        const front = parseAny(m[1] as string) as Record<string, unknown> | null;
        if (front && typeof front.name === "string" && front.name.trim() !== "") name = front.name.trim();
        if (front && typeof front.description === "string") description = front.description.trim();
      } catch {
        // A frontmatter that will not parse still names its folder.
      }
    }
    out.push({ name, description, path });
  }
  return out;
}

/** EVERYTHING THE CHATS ARE HANDED, and they reach nothing else. */
export interface ChatsDeps {
  /** How to start an agent — the agents module's `Agents.launch`. Null where it cannot
   *  be started, which makes the chat's light red with a sentence. */
  launch: (key: AgentKey) => Promise<AgentLaunch | null>;
  /** What this machine has now — `Agents.list` — and its subscription,
   *  which is how a HELD first message goes out the moment an agent is
   *  Active, and how the probe session's commands fill the / menu before a
   *  chat has a session of its own. */
  agents: () => AgentInfo[];
  onAgents: (fn: (agents: AgentInfo[]) => void) => () => void;
  /** A session or a first message was refused with ACP's auth-required error:
   *  the agents module marks it Inactive with `signin`, and Sign in is offered. */
  refused: (key: AgentKey) => void;
  /** THE SIGN-IN METHOD AN AGENT WANTS IN EVERY PROCESS, or null —
   *  `Agents.signedInWith`. Grok Build, Cursor and Junie refuse a session in
   *  a process that has not called `authenticate`, even when the person is
   *  signed in; every other agent answers null here, because `authenticate`
   *  on an agent already signed in can sign it out or open a browser for
   *  nothing. Where it is not null, every process a chat starts calls
   *  `authenticate` with it before opening a session. */
  signedInWith: (key: AgentKey) => string | null;
  /** THE CHATS OPEN IN A WINDOW NOW — on an Agent screen or in a panel, as
   *  the windows report it (the history's `windows()`, handed down; this
   *  module reads no history). An idle agent is ended only for a chat nobody
   *  has open. */
  openIn: () => Iterable<ChatId>;
  /** Open one ACP connection — `connectAcp` in `server/platform/acp.ts` in the
   *  running server, a scripted fake in a test. */
  connect: (launch: AgentLaunch, cwd: string) => AcpConnection;
  /** The vault's root, absolute: every agent's `cwd`, and the one folder
   *  `fs/*` requests are confined to. */
  root: string;
  /** Where each chat's kept log is written: beside the workspace as the run
   *  logs are (`.biom/`), ignored by git and by the watcher. The logs go in
   *  `chats/` under it. */
  logDir: string;
  /** Files over the vault's root for the agent's `fs/write_text_file` — the
   *  atomic write, built WITHOUT the vault's baseline (`makeFiles(root)`), so
   *  the watcher takes an agent's write for a change and the page redraws. The
   *  history hears of it through `onEdit` and never through these. */
  files: Files;
  /** The workspace's skills, read fresh for each / menu. */
  skills: () => Promise<Skill[]>;
  /** The screen a vault-relative path is shown at — the history's own
   *  `placeOf`, the one path-to-place lookup — for a `changed` update, so a
   *  turn's changes and the history's edits name a page the same way. */
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
  /** Where a diagnostic line goes — the server's log, never a client.
   *  `console.error` where none is given. */
  log?: (line: string) => void;
  /** After Stop, how long the agent has to answer `cancelled` before it is
   *  ended — `CANCEL_GRACE_MS`, fifteen seconds, where none is given. A test
   *  shortens it. */
  cancelGraceMs?: number;
}

export interface Chats {
  create(init: { agent?: AgentKey; text?: string; page?: PageId; config?: Record<string, ConfigValue> }): Promise<ChatSummary>;
  /** Every chat, the most recently changed first. */
  list(): ChatSummary[];
  read(chat: ChatId, since?: number): Promise<ChatRead>;
  send(chat: ChatId, text: string): Promise<ChatSummary>;
  cancel(chat: ChatId): Promise<ChatSummary>;
  config(chat: ChatId, option: string, value: ConfigValue): Promise<ChatSummary>;
  switchAgent(chat: ChatId, agent: AgentKey): Promise<ChatSummary>;
  /** End the chat's agent. The chat stays, and its next message starts one
   *  again. */
  close(chat: ChatId): Promise<ChatSummary>;
  /** The / menu, merged. */
  commands(q: { chat?: ChatId; agent?: AgentKey }): Promise<SlashCommand[]>;
  /** The chat, harness and turn an agent id is running for — the history names
   *  the switcher's views with it. Answered for any agent this server started,
   *  running or not. */
  agentOf(agent: AgentId): { chat: ChatId; harness: string; turn: number } | null;
  /** The agent running for a chat — how the server derives a window report's
   *  `agent` from its `chat`, ignoring what the window sent. */
  agentOfChat(chat: ChatId): AgentId | null;
  /** Jev's face for a turn (`turn` a number) or for the name (`turn` null). */
  face(chat: ChatId, turn: number | null, face: Face): void;
  /** Hear every chat's pushes. Answers the unsubscribe. */
  on(fn: (push: ChatPush) => void): () => void;
  /** Settles once every kept log has been scanned; `list` is whole after it. */
  readonly loaded: Promise<void>;
  /** End every agent: TERM, a grace, KILL. A turn in flight ends `crashed`. */
  endAll(): Promise<void>;
  /** KILL every agent now, synchronously, for the process's exit handler. */
  killAll(): void;
  /** END EVERY IDLE AGENT: one whose chat has had no turn for `IDLE_MS` and is
   *  open in no window. Its chat is untouched, and the next message starts
   *  the agent again as a reopening does — resumed, reloaded or handed the
   *  chat so far — under a new id. Answers how many were ended. The
   *  composition root calls it on a timer. */
  reap(): number;
}

/* ── bounds and times ─────────────────────────────────────────────────── */

/** How long pushes are gathered before one goes out. */
const PUSH_MS = 30;
/** HOW LONG A CHAT'S AGENT MAY SIT WITH NO TURN before it is ended, when no
 *  window has the chat open. One process per chat, started for a message and
 *  kept for the next, is a process per chat anybody ever wrote in; this is
 *  what bounds that without ending one a person is looking at. */
export const IDLE_MS = 30 * 60 * 1000;
/** How long a light stays green after `end_turn`. */
export const GREEN_MS = 10 * 60 * 1000;
/** `initialize` and opening a session: generous, because the first start of
 *  an agent run through `npx` may be fetching it. There is no deadline on a
 *  turn. */
const START_MS = 120_000;
const CONFIG_MS = 30_000;
/** After Stop, how long the agent has to answer `cancelled` before it is
 *  ended, unless `ChatsDeps.cancelGraceMs` says otherwise. */
export const CANCEL_GRACE_MS = 15_000;
/** A reply or thought update grows by joining chunks up to this. */
const TEXT_JOIN = 16 * 1024;
/** How much of the chat so far a new session is handed. */
const HANDOFF_MAX = 60_000;
const NAME_MAX = 60;
/** The largest file an agent reads or writes through Biom, in characters.
 *  The connection's bound on a line (`MAX_LINE` in `acp.ts`) is held above
 *  this file escaped at JSON's worst, so a write past it is refused here in
 *  words and never ends the agent. */
export const FILE_MAX = 32 * 1024 * 1024;
/** How many sign-in refusals a held message is retried through. */
const AUTH_RETRIES = 2;
/** Superseded tool lines in a log before it is rewritten compact. */
const COMPACT_AFTER = 200;
/** Notifications heard before a new session's id is known. */
const EARLY_MAX = 1000;
const LOG_DIR = "chats";

const RED: ReadonlySet<TurnEnd> = new Set<TurnEnd>(["refusal", "max_tokens", "max_turn_requests", "crashed"]);
/** Folders inside the vault that are the framework's and git's, never an
 *  agent's to write through Biom. */
const NOT_WRITABLE = new Set([".git", ".biom"]);

type Body = ChatUpdate extends infer U ? (U extends ChatUpdate ? Omit<U, "seq" | "at" | "turn"> : never) : never;
type Notice = Record<string, unknown> & { sessionUpdate: string };

const bad = (code: HostErrorCode, message: string) => Object.assign(new Error(message), { code });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const said = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/* ── the state ────────────────────────────────────────────────────────── */

/** One agent process for one chat, from the moment it is asked for. */
interface Live {
  agentId: AgentId;
  key: AgentKey;
  harness: string;
  conn: AcpConnection | null;
  sessionId: string | null;
  /** Settles true once the session is open, false where it never will be. */
  ready: Promise<boolean>;
  opened: boolean;
  /** Ended or ending: nothing it says is news any more. */
  gone: boolean;
  /** Biom ended it, so its exit is no crash. */
  ending: boolean;
  /** Inside `session/load`: the agent is replaying what the log already has. */
  replaying: boolean;
  early: { sessionId: string; update: Notice }[];
  rawConfig: unknown;
  rawModes: unknown;
  legacyMode: string | null;
  cancelTimer: ReturnType<typeof setTimeout> | null;
  /** When it was started, by the server's clock — idle from here when no
   *  turn has ended since. */
  since: number;
}

/** One tool call of this chat's agent, merged whole. */
interface ToolRecord {
  state: ToolState;
  turn: number;
  /** Completed or failed: its edits, if any, are recorded. */
  done: boolean;
  /** Paths an `fs` write already recorded for it. */
  claimed: Set<string>;
}

/** Something that changed one path in a turn, for the `changed` update. */
type Contribution =
  | { kind: "fs"; op: ChangedFile["op"]; added?: number; removed?: number }
  /** A tool call's, recounted from its last state at the turn's end. */
  | { kind: "tool"; tool: string };

interface TurnState {
  turn: number;
  changes: Map<string, Contribution[]>;
  /** `fs` writes no tool call has claimed yet, by path. */
  unclaimed: Map<string, number>;
  committed: boolean;
}

interface Chat {
  id: ChatId;
  name: string;
  face: Face | null;
  agent: AgentKey | null;
  harness: string | null;
  page: Place | null;
  created: number;
  updated: number;
  phase: TurnPhase;
  turn: number;
  stop: TurnEnd | null;
  reason: string | null;
  endedAt: number | null;
  live: Live | null;
  /** The session to reopen, where the agent can. */
  session: { agent: AgentKey; id: string } | null;
  /** The session now open is new and knows nothing of the chat so far. */
  handoff: boolean;
  /** The message waiting to go out, from `send` until `session/prompt`.
   *  `signin`: its agent refused for want of a sign-in, and it goes out only
   *  once that agent has been seen Inactive (`off`) and then Active again —
   *  never on the list it was refused against. */
  held: { text: string; tries: number; signin: boolean; off: boolean } | null;
  /** Bumped by Stop, a switch and close, so a start in flight can tell it was
   *  overtaken. */
  gen: number;
  cancelling: boolean;
  pendingConfig: Map<string, ConfigValue>;
  options: ConfigOption[] | null;
  agentCommands: SlashCommand[] | null;
  sentConfig: string | null;
  sentCommands: string | null;
  /** In memory once somebody reads or writes it; null until then. */
  updates: ChatUpdate[] | null;
  loading: Promise<void> | null;
  /** What was emitted while `updates` was null, merged in on load. */
  unloaded: ChatUpdate[];
  seq: number;
  toolIndex: Map<string, number>;
  superseded: number;
  batch: ChatUpdate[];
  /** The reply or thought update still growing, unpublished. */
  open: ChatUpdate | null;
  dirty: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  greenTimer: ReturnType<typeof setTimeout> | null;
  tools: Map<string, ToolRecord>;
  turnState: TurnState | null;
  /** The chat's own order for its bookkeeping: edits, then the turn's end. */
  queue: Promise<void>;
  /** Config changes, one after another. Apart from `queue`, because each
   *  waits on the agent and bookkeeping never should. */
  configQueue: Promise<void>;
  /** The last agent this chat ended, still going: a new start waits for it,
   *  so two processes never hold one session. */
  ending: Promise<unknown> | null;
  log: LogWriter;
}

/* ── the kept log ─────────────────────────────────────────────────────── */

/** One line of a chat's log. */
type LogRecord =
  | { t: "chat"; v: 1; id: ChatId; created: number; page: Place | null }
  | { t: "target"; agent: AgentKey | null; harness: string | null }
  | { t: "session"; agent: AgentKey; id: string }
  | { t: "config"; values: Record<string, ConfigValue> }
  | { t: "u"; u: ChatUpdate };

interface LogWriter {
  append(records: LogRecord[]): void;
  rewrite(records: LogRecord[]): void;
  /** Settles when everything asked of it so far is on disk, or has failed. */
  flushed(): Promise<void>;
}

function makeLog(path: string, torn: boolean, say: (line: string) => void): LogWriter {
  let chain: Promise<void> = Promise.resolve();
  let made = false;
  let needsBreak = torn;
  let failing = false;
  const fail = (e: unknown) => {
    if (failing) return;
    failing = true;
    say(`chats: the log ${path} could not be written: ${said(e)}`);
  };
  const ready = async () => {
    if (made) return;
    await mkdir(dirname(path), { recursive: true });
    made = true;
  };
  return {
    append(records) {
      if (records.length === 0) return;
      const text = `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
      chain = chain.then(async () => {
        await ready();
        // A line torn by a crash is closed off, so it spoils only itself.
        await appendFile(path, needsBreak ? `\n${text}` : text);
        needsBreak = false;
        failing = false;
      }).catch(fail);
    },
    rewrite(records) {
      const text = `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
      chain = chain.then(async () => {
        await ready();
        const tmp = join(dirname(path), `.${randomBytes(4).toString("hex")}.tmp`);
        try {
          await writeFile(tmp, text, "utf8");
          await rename(tmp, path);
        } catch (e) {
          await rm(tmp, { force: true });
          throw e;
        }
        needsBreak = false;
      }).catch(fail);
    },
    flushed() {
      return chain;
    },
  };
}

/* ── the module ───────────────────────────────────────────────────────── */

export function makeChats(deps: ChatsDeps): Chats {
  const say = deps.log ?? ((line: string) => console.error(line));
  const cancelGrace = typeof deps.cancelGraceMs === "number" && deps.cancelGraceMs > 0 ? deps.cancelGraceMs : CANCEL_GRACE_MS;
  const root = resolve(deps.root);
  let realRoot: string | null = null;
  try {
    const r = realpathSync(root);
    if (r !== root) realRoot = r;
  } catch {
    realRoot = null;
  }
  const roots: VaultRoots = { root, real: realRoot };
  const logDir = join(resolve(deps.logDir), LOG_DIR);

  const chats = new Map<ChatId, Chat>();
  /** Every agent this server started, to its chat and harness. */
  const agentIds = new Map<AgentId, { chat: ChatId; harness: string }>();
  const listeners = new Set<(push: ChatPush) => void>();
  let lastSkills: Skill[] = [];
  let stopping = false;

  const now = () => deps.now();

  /* ── the agents list ─────────────────────────────────────────────── */

  const agentList = (): AgentInfo[] => {
    try {
      return deps.agents();
    } catch {
      return [];
    }
  };
  /** The method an agent wants `authenticate` with in every process, or
   *  null — and null where the answer is not one. */
  const methodFor = (key: AgentKey): string | null => {
    try {
      const m = typeof deps.signedInWith === "function" ? deps.signedInWith(key) : null;
      return typeof m === "string" && m !== "" ? m : null;
    } catch {
      return null;
    }
  };
  const infoOf = (key: AgentKey | null): AgentInfo | null => (key === null ? null : agentList().find((a) => a.key === key) ?? null);
  const harnessOf = (key: AgentKey): string => infoOf(key)?.name ?? key;
  const isActive = (key: AgentKey | null): boolean => infoOf(key)?.state === "active";

  /* ── what a chat looks like ──────────────────────────────────────── */

  const lightOf = (c: Chat): ChatLight => {
    if (c.phase === "starting" || c.phase === "running") return "working";
    if (c.phase === "held") return "none";
    if (c.stop !== null && RED.has(c.stop)) return "error";
    if (c.stop === "end_turn" && c.endedAt !== null && now() - c.endedAt < GREEN_MS) return "done";
    return "none";
  };

  const summary = (c: Chat): ChatSummary => ({
    id: c.id,
    name: c.name,
    face: c.face,
    agent: c.agent,
    harness: c.harness,
    agentId: c.live && !c.live.gone ? c.live.agentId : null,
    page: c.page,
    phase: c.phase,
    turn: c.turn,
    light: lightOf(c),
    stop: c.stop,
    reason: c.reason,
    created: c.created,
    updated: c.updated,
  });

  const fresh = (id: ChatId, created: number, page: Place | null, torn: boolean): Chat => ({
    id, name: "", face: null, agent: null, harness: null, page, created, updated: created,
    phase: "idle", turn: 0, stop: null, reason: null, endedAt: null,
    live: null, session: null, handoff: false, held: null, gen: 0, cancelling: false,
    pendingConfig: new Map(), options: null, agentCommands: null, sentConfig: null, sentCommands: null,
    updates: null, loading: null, unloaded: [], seq: 0, toolIndex: new Map(), superseded: 0,
    batch: [], open: null, dirty: false, flushTimer: null, greenTimer: null,
    tools: new Map(), turnState: null, queue: Promise.resolve(), configQueue: Promise.resolve(), ending: null,
    log: makeLog(join(logDir, `${id}.jsonl`), torn, say),
  });

  /* ── publishing ──────────────────────────────────────────────────── */

  const schedule = (c: Chat): void => {
    if (c.flushTimer !== null) return;
    c.flushTimer = setTimeout(() => flush(c), PUSH_MS);
  };

  /** Everything gathered goes out: to the log, then to every listener. */
  const flush = (c: Chat): void => {
    if (c.flushTimer !== null) {
      clearTimeout(c.flushTimer);
      c.flushTimer = null;
    }
    if (c.batch.length === 0 && !c.dirty) return;
    const updates = c.batch;
    c.batch = [];
    c.open = null;
    c.dirty = false;
    c.log.append(updates.map((u) => ({ t: "u", u })));
    const push: ChatPush = { chat: summary(c), updates };
    for (const fn of [...listeners]) {
      try {
        fn(push);
      } catch (e) {
        say(`chats: a listener threw: ${said(e)}`);
      }
    }
  };

  /** The summary changed: say so with the next push. `bump` is whether it
   *  was something happening in the chat, which moves it up the list; a light
   *  going out, or a chat read back at start, is not. */
  const touch = (c: Chat, bump = true): void => {
    if (bump) c.updated = now();
    c.dirty = true;
    schedule(c);
  };

  /** Keep an update in its place: a tool line replaces its earlier update
   *  where that first appeared. Answers whether it superseded one. */
  const place = (list: ChatUpdate[], index: Map<string, number>, u: ChatUpdate): boolean => {
    if (u.kind === "tool") {
      const at = index.get(u.tool.id);
      if (at !== undefined) {
        list[at] = u;
        return true;
      }
      index.set(u.tool.id, list.length);
    }
    list.push(u);
    return false;
  };

  const emit = (c: Chat, body: Body, turn = c.turn): void => {
    const at = now();
    c.updated = at;
    // Chunks arriving together are one update, grown only while nobody has
    // been handed it.
    if ((body.kind === "reply" || body.kind === "thought") && c.open && c.open.kind === body.kind && c.open.turn === turn) {
      const open = c.open as ChatUpdate & { text: string };
      if (open.text.length + body.text.length <= TEXT_JOIN) {
        open.text += body.text;
        schedule(c);
        return;
      }
    }
    const u = { seq: ++c.seq, at, turn, ...body } as ChatUpdate;
    if (c.updates !== null) {
      if (place(c.updates, c.toolIndex, u)) c.superseded++;
    } else c.unloaded.push(u);
    // A tool line's newer state replaces an older one not yet sent.
    const inBatch = u.kind === "tool" ? c.batch.findIndex((b) => b.kind === "tool" && b.tool.id === u.tool.id) : -1;
    if (inBatch >= 0) c.batch[inBatch] = u;
    else c.batch.push(u);
    c.open = u.kind === "reply" || u.kind === "thought" ? u : null;
    schedule(c);
  };

  const signal = (s: TurnSignal): void => {
    try {
      deps.onTurn(s);
    } catch (e) {
      say(`chats: the turn listener threw: ${said(e)}`);
    }
  };

  /** Run in the chat's own order — its edits before its turn's end, one config
   *  change before the next. A failure is logged and the queue goes on. */
  const enqueue = (c: Chat, fn: () => Promise<void> | void): Promise<void> => {
    const run = c.queue.then(fn).catch((e: unknown) => {
      say(`chats: ${c.id}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    });
    c.queue = run;
    return run;
  };

  const clearGreen = (c: Chat): void => {
    if (c.greenTimer !== null) clearTimeout(c.greenTimer);
    c.greenTimer = null;
  };

  /** THE PUSH THAT SAYS GREEN IS OVER, when what is left of its ten minutes
   *  runs out: after a turn that ended `end_turn`, and for a chat read back
   *  green after a restart. A timer that fires a moment early waits out the
   *  rest, so the push never still says green. */
  const armGreen = (c: Chat): void => {
    clearGreen(c);
    if (c.stop !== "end_turn" || c.endedAt === null) return;
    const left = GREEN_MS - (now() - c.endedAt);
    if (left <= 0) return;
    c.greenTimer = setTimeout(() => {
      c.greenTimer = null;
      if (lightOf(c) === "done") armGreen(c);
      else touch(c, false);
    }, left);
    (c.greenTimer as { unref?: () => void }).unref?.();
  };

  /* ── loading ─────────────────────────────────────────────────────── */

  const parseLines = (text: string): LogRecord[] => {
    const out: LogRecord[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const r = JSON.parse(line) as unknown;
        if (isObj(r) && typeof r.t === "string") out.push(r as LogRecord);
      } catch {
        // A line torn by a crash; only a last line can be.
      }
    }
    return out;
  };

  /** A chat's summary from its log, and whether its last turn never ended. */
  const scan = (text: string): { chat: Chat; interrupted: boolean } | null => {
    const records = parseLines(text);
    const head = records[0];
    if (!head || head.t !== "chat" || typeof head.id !== "string") return null;
    const c = fresh(head.id, typeof head.created === "number" ? head.created : now(), head.page ?? null, text !== "" && !text.endsWith("\n"));
    let lastPrompt = 0;
    let lastEnd = 0;
    const toolsSeen = new Set<string>();
    for (const r of records) {
      if (r.t === "target") {
        c.agent = r.agent;
        c.harness = r.harness;
      } else if (r.t === "session") c.session = { agent: r.agent, id: r.id };
      else if (r.t === "config") c.pendingConfig = new Map(Object.entries(isObj(r.values) ? r.values : {}));
      else if (r.t === "u" && isObj(r.u)) {
        const u = r.u;
        if (typeof u.seq === "number") c.seq = Math.max(c.seq, u.seq);
        if (typeof u.turn === "number") c.turn = Math.max(c.turn, u.turn);
        if (typeof u.at === "number") c.updated = Math.max(c.updated, u.at);
        if (u.kind === "prompt") lastPrompt = Math.max(lastPrompt, u.turn);
        else if (u.kind === "name") {
          c.name = u.name;
          c.face = u.face ?? c.face;
        } else if (u.kind === "agent") {
          c.agent = u.agent;
          c.harness = u.harness;
        } else if (u.kind === "turn" && u.phase === "idle") {
          lastEnd = Math.max(lastEnd, u.turn);
          c.stop = u.stop;
          c.reason = u.reason;
          c.endedAt = u.at;
        } else if (u.kind === "config") c.sentConfig = JSON.stringify(u.options);
        else if (u.kind === "commands") c.sentCommands = JSON.stringify(u.commands);
        else if (u.kind === "tool") {
          if (toolsSeen.has(u.tool.id)) c.superseded++;
          else toolsSeen.add(u.tool.id);
        }
      }
    }
    return { chat: c, interrupted: lastPrompt > lastEnd };
  };

  const loaded: Promise<void> = (async () => {
    let names: string[];
    try {
      names = await readdir(logDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      let text: string;
      try {
        text = await readFile(join(logDir, name), "utf8");
      } catch (e) {
        say(`chats: the log ${name} could not be read: ${said(e)}`);
        continue;
      }
      const found = scan(text);
      if (!found || chats.has(found.chat.id) || `${found.chat.id}.jsonl` !== name) continue;
      const c = found.chat;
      chats.set(c.id, c);
      if (found.interrupted) {
        // The server stopped in the middle of this turn, and so did its agent.
        c.stop = "crashed";
        c.reason = "Biom stopped during this turn";
        c.endedAt = now();
        emit(c, { kind: "turn", phase: "idle", stop: c.stop, reason: c.reason });
      }
      // Read back green, it goes out when the rest of its ten minutes do.
      armGreen(c);
      touch(c, false);
    }
  })();

  /** A chat's updates into memory, once: what its log holds, then whatever
   *  was emitted while the log was being read. */
  const ensureLoaded = (c: Chat): Promise<void> => {
    if (c.updates !== null) return Promise.resolve();
    if (c.loading) return c.loading;
    c.loading = (async () => {
      flush(c);
      await c.log.flushed();
      let text = "";
      try {
        text = await readFile(join(logDir, `${c.id}.jsonl`), "utf8");
      } catch {
        text = "";
      }
      const list: ChatUpdate[] = [];
      const index = new Map<string, number>();
      let top = 0;
      let superseded = 0;
      for (const r of parseLines(text)) {
        if (r.t !== "u" || !isObj(r.u) || typeof r.u.seq !== "number") continue;
        top = Math.max(top, r.u.seq);
        if (place(list, index, r.u)) superseded++;
      }
      for (const u of c.unloaded) if (u.seq > top && place(list, index, u)) superseded++;
      c.unloaded = [];
      c.updates = list;
      c.toolIndex = index;
      c.superseded = superseded;
    })();
    return c.loading;
  };

  const must = async (id: unknown): Promise<Chat> => {
    await loaded;
    const c = typeof id === "string" ? chats.get(id) : undefined;
    if (!c) throw bad("not_found", "no such chat");
    await ensureLoaded(c);
    return c;
  };

  /** Everything a rewrite must say for the log to read back the same. */
  const records = (c: Chat): LogRecord[] => {
    const out: LogRecord[] = [{ t: "chat", v: 1, id: c.id, created: c.created, page: c.page }];
    out.push({ t: "target", agent: c.agent, harness: c.harness });
    if (c.session) out.push({ t: "session", agent: c.session.agent, id: c.session.id });
    if (c.pendingConfig.size > 0) out.push({ t: "config", values: Object.fromEntries(c.pendingConfig) });
    for (const u of c.updates ?? []) out.push({ t: "u", u });
    return out;
  };

  const maybeCompact = (c: Chat): void => {
    if (c.updates === null || c.superseded < COMPACT_AFTER) return;
    flush(c);
    c.superseded = 0;
    c.log.rewrite(records(c));
  };

  /* ── naming, config, commands ────────────────────────────────────── */

  const rename = (c: Chat, name: string): void => {
    if (name === "" || name === c.name) return;
    c.name = name;
    emit(c, { kind: "name", name, face: c.face });
  };

  const nameFrom = (text: string, max: number): string => {
    const first = text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
    const flat = first.replace(/\s+/g, " ");
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  };

  const target = (c: Chat, key: AgentKey | null): void => {
    c.agent = key;
    c.harness = key === null ? null : harnessOf(key);
    c.log.append([{ t: "target", agent: c.agent, harness: c.harness }]);
    touch(c);
  };

  const adoptIfAny = (c: Chat): boolean => {
    if (c.agent !== null) return false;
    const first = agentList().find((a) => a.state === "active");
    if (!first) return false;
    target(c, first.key);
    return true;
  };

  /** What the pickers show: the chat's own session's options, else the probe
   *  session's, with any value kept for the next message laid over them. */
  const shownOptions = (c: Chat): ConfigOption[] => {
    const base = c.options ?? infoOf(c.agent)?.options ?? [];
    if (c.pendingConfig.size === 0) return base;
    return base.map((o) => (c.pendingConfig.has(o.id) ? { ...o, value: c.pendingConfig.get(o.id) as ConfigValue } : o));
  };

  const emitConfig = (c: Chat): void => {
    const options = shownOptions(c);
    const key = JSON.stringify(options);
    if (key === c.sentConfig) return;
    c.sentConfig = key;
    emit(c, { kind: "config", options });
  };

  const agentCommandsOf = (c: Chat): SlashCommand[] => c.agentCommands ?? infoOf(c.agent)?.commands ?? [];

  const skillsNow = async (): Promise<Skill[]> => {
    try {
      lastSkills = await deps.skills();
    } catch (e) {
      say(`chats: the workspace's skills could not be read: ${said(e)}`);
    }
    return lastSkills;
  };

  const merged = async (fromAgent: SlashCommand[]): Promise<SlashCommand[]> => {
    const skills = await skillsNow();
    const out: SlashCommand[] = [];
    const names = new Set<string>();
    for (const k of fromAgent) {
      if (names.has(k.name)) continue;
      names.add(k.name);
      out.push({ name: k.name, description: k.description, hint: k.hint, source: "agent", skill: null });
    }
    for (const s of skills) {
      if (names.has(s.name)) continue;
      names.add(s.name);
      out.push({ name: s.name, description: s.description, hint: null, source: "skill", skill: s.path });
    }
    return out;
  };

  const emitCommands = (c: Chat): Promise<void> =>
    enqueue(c, async () => {
      const commands = await merged(agentCommandsOf(c));
      const key = JSON.stringify(commands);
      if (key === c.sentCommands) return;
      c.sentCommands = key;
      emit(c, { kind: "commands", commands });
    });

  /** The session's options, as its latest config and modes say them. */
  const takeOptions = (c: Chat, live: Live): void => {
    const read = toConfigOptions(live.rawConfig, live.rawModes);
    live.legacyMode = read.legacyMode;
    c.options = read.options;
  };

  /** Apply every value kept for the next message to an open session, on the
   *  chat's config chain. */
  const applyConfig = (c: Chat, live: Live): Promise<void> => {
    const run = c.configQueue.then(async () => {
      if (c.pendingConfig.size === 0) return;
      for (const [option, value] of [...c.pendingConfig]) {
        if (live.gone || !live.conn || live.sessionId === null) return;
        const req = setConfigRequest(live.sessionId, option, value, live.legacyMode);
        try {
          const r = await live.conn.request(req.method, req.params, { timeoutMs: CONFIG_MS });
          if (req.method === "session/set_mode") {
            if (isObj(live.rawModes)) live.rawModes = { ...live.rawModes, currentModeId: String(value) };
          } else if (isObj(r) && Array.isArray(r.configOptions)) live.rawConfig = r.configOptions;
          takeOptions(c, live);
        } catch (e) {
          if (isClosed(e)) return;
          const name = shownOptions(c).find((o) => o.id === option)?.name ?? option;
          emit(c, { kind: "error", message: `${live.harness} would not change ${name}.` });
        }
        // Only a value nobody picked again while it was being applied.
        if (c.pendingConfig.get(option) === value) c.pendingConfig.delete(option);
      }
      c.log.append([{ t: "config", values: Object.fromEntries(c.pendingConfig) }]);
      emitConfig(c);
    }).catch((e: unknown) => say(`chats: ${c.id}: applying config failed: ${said(e)}`));
    c.configQueue = run;
    return run;
  };

  /* ── the turn ────────────────────────────────────────────────────── */

  const setPhase = (c: Chat, phase: TurnPhase): void => {
    if (c.phase === phase) return;
    c.phase = phase;
    emit(c, { kind: "turn", phase, stop: null, reason: null });
    touch(c);
  };

  const combine = (prev: ChangedFile["op"] | null, next: ChangedFile["op"]): ChangedFile["op"] => {
    if (prev === null) return next;
    if (next === "deleted") return "deleted";
    if (prev === "deleted") return "edited";
    if (prev === "created" || prev === "moved") return prev;
    return next === "created" ? "edited" : next;
  };

  /** Every file the turn changed, counted from the tool calls' last states. */
  const changedOf = async (c: Chat, ts: TurnState): Promise<ChangedFile[]> => {
    const out: ChangedFile[] = [];
    for (const [path, contribs] of ts.changes) {
      let op: ChangedFile["op"] | null = null;
      let added = 0;
      let removed = 0;
      let counted = false;
      for (const k of contribs) {
        let e: { op: ChangedFile["op"]; added?: number; removed?: number } | undefined;
        if (k.kind === "tool") {
          const rec = c.tools.get(k.tool);
          e = rec ? editsOf({ kind: "tool", tool: rec.state }, roots).find((x) => x.path === path) : undefined;
          if (!e) e = { op: "edited" };
        } else e = k;
        op = combine(op, e.op);
        if (typeof e.added === "number") {
          added += e.added;
          removed += e.removed ?? 0;
          counted = true;
        }
      }
      let where: Place | null = null;
      try {
        where = await deps.placeOf(path);
      } catch {
        where = null;
      }
      const file: ChangedFile = { path, place: where, op: op ?? "edited" };
      if (counted) {
        file.added = added;
        file.removed = removed;
      }
      out.push(file);
    }
    return out;
  };

  /** THE TURN ENDS, once: what it changed, then how it ended. On the chat's
   *  queue, so every edit it saw is in. */
  const finishTurn = (c: Chat, turn: number, stop: TurnEnd, reason: string | null): Promise<void> =>
    enqueue(c, async () => {
      const over = (): boolean => c.turn !== turn || c.phase === "idle";
      if (over()) return;
      const ts = c.turnState;
      if (ts && ts.turn === turn && ts.changes.size > 0) {
        const edits = await changedOf(c, ts);
        if (over()) return;
        emit(c, { kind: "changed", edits });
      }
      c.turnState = null;
      c.held = null;
      c.cancelling = false;
      if (c.live?.cancelTimer) {
        clearTimeout(c.live.cancelTimer);
        c.live.cancelTimer = null;
      }
      c.phase = "idle";
      c.stop = stop;
      c.reason = reason;
      c.endedAt = now();
      armGreen(c);
      emit(c, { kind: "turn", phase: "idle", stop, reason });
      touch(c);
      signal({ kind: "end", chat: c.id, turn });
      maybeCompact(c);
    });

  const reasonOf = (stop: TurnEnd, harness: string): string | null => {
    switch (stop) {
      case "refusal":
        return `${harness} refused to carry on with this`;
      case "max_tokens":
        return `${harness} reached the most it can write in one answer`;
      case "max_turn_requests":
        return `${harness} reached the most steps it takes in one turn`;
      default:
        return null;
    }
  };

  const beginTurn = (c: Chat, text: string): void => {
    c.turn += 1;
    c.stop = null;
    c.reason = null;
    c.endedAt = null;
    clearGreen(c);
    // Tool calls older than the last turn are nobody's any more.
    for (const [id, rec] of c.tools) if (rec.turn < c.turn - 1) c.tools.delete(id);
    c.turnState = { turn: c.turn, changes: new Map(), unclaimed: new Map(), committed: false };
    emit(c, { kind: "prompt", text });
    if (c.name === "") rename(c, nameFrom(text, NAME_MAX));
    signal({ kind: "start", chat: c.id, turn: c.turn, text });
    c.held = { text, tries: 0, signin: false, off: false };
    if (c.agent === null && adoptIfAny(c)) {
      emitConfig(c);
      void emitCommands(c);
    }
    // HELD UNTIL AN AGENT CAN TAKE IT: none named, or one the list does not
    // say is Active — its Gateway down, installing, failed, being looked at —
    // with no session of this chat's open. Starting it would only end the
    // turn red; held, it goes out when the list says Active. A session this
    // chat has open is an agent that answers, whatever the list says now.
    const open = c.live !== null && c.live.opened && !c.live.gone;
    if (c.agent === null || (!open && !isActive(c.agent))) setPhase(c, "held");
    else go(c);
  };

  /** THE HELD MESSAGE GOES OUT: to the open session, or through a start. */
  const go = (c: Chat): void => {
    // A server on its way down starts nothing: `endAll` is ending this turn.
    if (stopping) return;
    const live = c.live;
    const gen = c.gen;
    const turn = c.turn;
    const send = (l: Live) =>
      prompt(c, l, gen).catch((e: unknown) => {
        // Nothing here should throw; if something does, the turn still ends.
        say(`chats: ${c.id}: sending a message failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        c.held = null;
        void finishTurn(c, turn, "crashed", "Biom could not send the message");
      });
    if (live && live.opened && !live.gone) {
      setPhase(c, "running");
      void send(live);
      return;
    }
    setPhase(c, "starting");
    void start(c).then((l) => {
      if (l && c.gen === gen && c.held) void send(l);
    });
  };

  /** Everything the chat said before this turn, for a session that did not
   *  hear it. */
  const handoffText = (c: Chat): string => {
    const turns: string[] = [];
    let current = -1;
    let block: string[] = [];
    let who = c.harness ?? "the agent";
    let reply = "";
    const endReply = () => {
      if (reply.trim() !== "") block.push(`${who}: ${reply.trim()}`);
      reply = "";
    };
    const endTurn = () => {
      endReply();
      if (block.length > 0) turns.push(block.join("\n\n"));
      block = [];
    };
    for (const u of c.updates ?? []) {
      if (u.turn >= c.turn || u.turn === 0) continue;
      if (u.turn !== current) {
        endTurn();
        current = u.turn;
      }
      if (u.kind === "agent") who = u.harness;
      else if (u.kind === "prompt") block.push(`The person: ${u.text}`);
      else if (u.kind === "reply") reply += u.text;
      else if (u.kind === "tool" && u.tool.status === "completed" && u.tool.title !== "") {
        endReply();
        block.push(`(${who} did: ${u.tool.title.split("\n")[0]})`);
      }
    }
    endTurn();
    if (turns.length === 0) return "";
    let body = turns.join("\n\n---\n\n");
    if (body.length > HANDOFF_MAX) body = `(the earliest of it is left out)\n\n${body.slice(body.length - HANDOFF_MAX)}`;
    return `This chat began before you joined it. Here is the conversation so far, so you can carry on from it; do not redo what it describes.\n\n${body}\n\n---\n\nThe person's new message:\n\n`;
  };

  /** What goes out for what the person typed: a workspace skill the agent did
   *  not list becomes a sentence pointing at its `SKILL.md`, and a new session
   *  is handed the chat so far. */
  const outgoing = async (c: Chat, text: string): Promise<string> => {
    let out = text;
    const m = /^\/([A-Za-z0-9][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (m) {
      const name = m[1] as string;
      if (!agentCommandsOf(c).some((k) => k.name === name)) {
        const skill = (await skillsNow()).find((s) => s.name === name);
        if (skill) out = `Use the workspace skill "${name}": read ${skill.path} and follow it.${m[2] ? `\n\n${m[2]}` : ""}`;
      }
    }
    return c.handoff ? handoffText(c) + out : out;
  };

  /** An agent's own error message, bounded. It is the agent's answer to Biom,
   *  not its stderr, and it is what the person can act on. */
  const agentWords = (e: unknown): string => {
    const flat = (e instanceof Error && e.message ? e.message : "no reason given").replace(/\s+/g, " ").trim();
    return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
  };

  const prompt = async (c: Chat, live: Live, gen: number): Promise<void> => {
    const held = c.held;
    if (!held) return;
    await applyConfig(c, live);
    if (c.held !== held || c.gen !== gen || live.gone || !live.conn || live.sessionId === null) return;
    const text = await outgoing(c, held.text);
    if (c.held !== held || c.gen !== gen || live.gone || !live.conn || live.sessionId === null) return;
    const handoff = c.handoff;
    c.held = null;
    c.handoff = false;
    setPhase(c, "running");
    const turn = c.turn;
    let result: unknown;
    try {
      result = await live.conn.request("session/prompt", promptParams(live.sessionId, text));
    } catch (e) {
      if (c.turn !== turn || c.phase === "idle") return;
      if (isAuthRequired(e)) {
        // Refused, so the session never took it — nor the chat so far it
        // carried, which goes with the message when it is sent again.
        c.held = { ...held };
        c.handoff = handoff;
        refusedSignIn(c, live);
        return;
      }
      // An ended connection is the exit's to report.
      if (isClosed(e)) return;
      void finishTurn(c, turn, "crashed", `${live.harness} answered with an error: ${agentWords(e)}`);
      return;
    }
    const stop = readStop(result) ?? "end_turn";
    void finishTurn(c, turn, stop, reasonOf(stop, live.harness));
  };

  /* ── an agent's life ─────────────────────────────────────────────── */

  const endLive = (c: Chat, live: Live): Promise<AcpExit | null> => {
    live.ending = true;
    live.gone = true;
    if (live.cancelTimer) {
      clearTimeout(live.cancelTimer);
      live.cancelTimer = null;
    }
    if (c.live === live) {
      c.live = null;
      touch(c, false);
    }
    const ending = live.conn ? live.conn.close() : Promise.resolve(null);
    c.ending = ending;
    return ending;
  };

  /** A start that failed: the message it was for ends red, with a sentence. */
  const failStart = (c: Chat, live: Live, reason: string): void => {
    void endLive(c, live);
    if (c.held && c.phase !== "idle") {
      c.held = null;
      void finishTurn(c, c.turn, "crashed", reason);
    }
  };

  /** The agent refused for want of a sign-in: the agents module is told, the
   *  process goes, and the message waits for the agent to be Active again. */
  const refusedSignIn = (c: Chat, live: Live): void => {
    void endLive(c, live);
    if (c.held) {
      c.held.tries += 1;
      if (c.held.tries > AUTH_RETRIES) {
        c.held = null;
        void finishTurn(c, c.turn, "crashed", `${live.harness} still asks to be signed in`);
      } else {
        c.held.signin = true;
        c.held.off = false;
        setPhase(c, "held");
        emit(c, { kind: "error", message: `${live.harness} needs you to sign in. Your message will go out once it is signed in.` });
      }
    }
    // Held first: a list the agents module sends back at once is judged
    // against the held chat.
    try {
      deps.refused(live.key);
    } catch (e) {
      say(`chats: refused() threw: ${said(e)}`);
    }
  };

  /** START THE CHAT'S AGENT, or join the start already under way. Answers the
   *  live agent with its session open, or null. */
  const start = (c: Chat): Promise<Live | null> => {
    const existing = c.live;
    if (existing && !existing.gone) return existing.ready.then((ok) => (ok && !existing.gone ? existing : null));
    const key = c.agent;
    if (key === null || stopping) return Promise.resolve(null);
    const live: Live = {
      agentId: randomUUID(), key, harness: harnessOf(key), conn: null, sessionId: null, ready: Promise.resolve(false),
      opened: false, gone: false, ending: false, replaying: false, early: [], rawConfig: null, rawModes: null, legacyMode: null,
      cancelTimer: null, since: now(),
    };
    c.live = live;
    c.harness = live.harness;
    agentIds.set(live.agentId, { chat: c.id, harness: live.harness });
    emit(c, { kind: "agent", agentId: live.agentId, agent: key, harness: live.harness });
    touch(c);
    live.ready = open(c, live).catch((e: unknown) => {
      say(`chats: ${c.id}: starting ${live.harness} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      if (!live.gone) failStart(c, live, `${live.harness} could not be started`);
      return false;
    });
    return live.ready.then((ok) => (ok && !live.gone ? live : null));
  };

  const open = async (c: Chat, live: Live): Promise<boolean> => {
    let launch: AgentLaunch | null = null;
    try {
      launch = await deps.launch(live.key);
    } catch {
      launch = null;
    }
    if (live.gone) return false;
    if (!launch) {
      failStart(c, live, `${live.harness} could not be started on this machine`);
      return false;
    }
    // The agent this chat last ended may still hold its session; its end is
    // bounded by the connection's own TERM–KILL ladder.
    const before = c.ending;
    if (before) {
      await before;
      if (c.ending === before) c.ending = null;
      if (live.gone) return false;
    }
    const conn = deps.connect(launch, root);
    live.conn = conn;
    if (live.gone) {
      void conn.close();
      return false;
    }
    wire(c, live, conn);

    try {
      const init = readInitialize(await conn.request("initialize", initializeParams(), { timeoutMs: START_MS }));
      if (init.protocolVersion !== ACP_PROTOCOL_VERSION) {
        failStart(c, live, `${live.harness} speaks ACP version ${init.protocolVersion ?? "unknown"}, and Biom speaks ${ACP_PROTOCOL_VERSION}`);
        return false;
      }
      // SIGNED IN AGAIN, IN THIS PROCESS, where the agent wants that: the
      // method that last signed it in, before any session is opened or
      // reopened. A refusal of it is a sign-in refusal — the method that
      // worked no longer does — and the message waits for the person.
      const method = methodFor(live.key);
      if (method !== null) {
        try {
          await conn.request("authenticate", { methodId: method }, { timeoutMs: START_MS });
        } catch (e) {
          if (live.gone) return false;
          if (isClosed(e)) throw e;
          refusedSignIn(c, live);
          return false;
        }
        if (live.gone) return false;
      }
      await session(c, live, conn, init.resume, init.loadSession);
    } catch (e) {
      if (live.gone) return false;
      if (isAuthRequired(e)) {
        refusedSignIn(c, live);
        return false;
      }
      if (isClosed(e)) say(`chats: ${c.id}: ${live.harness} stopped while starting; the last of its stderr:\n${conn.stderr().slice(-1000)}`);
      failStart(c, live, isClosed(e) ? `${live.harness} stopped before it was ready` : `${live.harness} would not open a session: ${agentWords(e)}`);
      return false;
    }
    if (live.gone) return false;
    live.opened = true;
    // What the agent said before its session had an id.
    const early = live.early;
    live.early = [];
    for (const n of early) if (n.sessionId === live.sessionId) apply(c, live, n.update);
    await applyConfig(c, live);
    emitConfig(c);
    touch(c);
    return !live.gone;
  };

  /** Open the chat's session: reopen the one it had where the agent can,
   *  otherwise a new one, handed the chat so far. */
  const session = async (c: Chat, live: Live, conn: AcpConnection, resume: boolean, load: boolean): Promise<void> => {
    const had = c.session;
    const reopen = async (method: "session/resume" | "session/load", id: string): Promise<boolean> => {
      live.sessionId = id;
      live.replaying = method === "session/load";
      try {
        const facts = readSession(await conn.request(method, reopenParams(id, root), { timeoutMs: START_MS }));
        live.rawConfig = facts.configOptions;
        live.rawModes = facts.modes;
        takeOptions(c, live);
        // A handoff still owed stays owed: only `session/new` sets it, and a
        // session reopened before it accepted a message has not heard the
        // chat so far any more than it had when it was new.
        return true;
      } catch (e) {
        if (isAuthRequired(e) || isClosed(e)) throw e;
        live.sessionId = null;
        return false;
      } finally {
        live.replaying = false;
      }
    };
    if (had && had.agent === live.key) {
      if (resume && (await reopen("session/resume", had.id))) return;
      if (load && (await reopen("session/load", had.id))) return;
    }
    const facts = readSession(await conn.request("session/new", newSessionParams(root), { timeoutMs: START_MS }));
    if (facts.sessionId === null) throw new AcpRpcError(INVALID_PARAMS, "the agent opened a session with no id");
    live.sessionId = facts.sessionId;
    live.rawConfig = facts.configOptions;
    live.rawModes = facts.modes;
    takeOptions(c, live);
    c.session = { agent: live.key, id: facts.sessionId };
    c.log.append([{ t: "session", agent: live.key, id: facts.sessionId }]);
    // A new session knows nothing: hand it every earlier turn.
    c.handoff = (c.updates ?? []).some((u) => u.kind === "prompt" && u.turn < c.turn);
  };

  const wire = (c: Chat, live: Live, conn: AcpConnection): void => {
    conn.handle("session/request_permission", async (params) => {
      if (live.gone || c.cancelling) return { outcome: { outcome: "cancelled" } };
      return choosePermission(params);
    });
    conn.handle("fs/read_text_file", async (params) => readText(live, params));
    conn.handle("fs/write_text_file", async (params) => writeText(c, live, params));
    conn.onNotification((method, params) => {
      if (method !== "session/update" || live.gone || c.live !== live) return;
      const n = readUpdate(params);
      if (!n) return;
      if (live.sessionId === null) {
        if (live.early.length < EARLY_MAX) live.early.push(n);
        return;
      }
      if (n.sessionId !== live.sessionId || live.replaying) return;
      apply(c, live, n.update);
    });
    void conn.closed.then((exit) => {
      // It went on its own — Biom ended nothing — whether or not its session
      // had opened. Before it had, this is a failed start, and it is said
      // HERE: `open()` may hear the request it was waiting on rejected only
      // after this has run, find the agent gone and say nothing, so a start
      // left to it could stay `starting` for ever.
      const crashed = !live.ending;
      live.gone = true;
      if (live.cancelTimer) {
        clearTimeout(live.cancelTimer);
        live.cancelTimer = null;
      }
      if (c.live === live) {
        c.live = null;
        touch(c, false);
      }
      if (!crashed) return;
      const how = exit.signal ? `was ended by ${exit.signal}` : `exited with code ${exit.code}`;
      say(`chats: ${c.id}: ${live.harness} ${how}; the last of its stderr:\n${conn.stderr().slice(-1000)}`);
      if (c.phase === "running" || c.phase === "starting") {
        c.held = null;
        void finishTurn(c, c.turn, "crashed", live.opened ? `${live.harness} stopped in the middle of the turn` : `${live.harness} stopped before it was ready`);
      }
    });
  };

  /* ── what the agent says ─────────────────────────────────────────── */

  const apply = (c: Chat, live: Live, u: Notice): void => {
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const text = textOf(u.content);
        if (text === null || text === "") return;
        emit(c, { kind: "reply", text });
        signal({ kind: "reply", chat: c.id, turn: c.turn, text });
        return;
      }
      case "agent_thought_chunk": {
        const text = textOf(u.content);
        if (text === null || text === "") return;
        emit(c, { kind: "thought", text });
        signal({ kind: "thought", chat: c.id, turn: c.turn, text });
        return;
      }
      case "tool_call":
      case "tool_call_update":
        tool(c, live, u);
        return;
      case "plan":
        emit(c, { kind: "plan", entries: toPlan(u.entries) });
        return;
      case "available_commands_update":
        c.agentCommands = toSlashCommands(u.availableCommands);
        void emitCommands(c);
        return;
      case "config_option_update":
        if (!Array.isArray(u.configOptions)) return;
        live.rawConfig = u.configOptions;
        takeOptions(c, live);
        emitConfig(c);
        return;
      case "current_mode_update":
        if (!isObj(live.rawModes) || typeof u.currentModeId !== "string") return;
        live.rawModes = { ...live.rawModes, currentModeId: u.currentModeId };
        takeOptions(c, live);
        emitConfig(c);
        return;
      case "usage_update": {
        const usage = toUsage(u);
        if (usage) emit(c, { kind: "usage", ...usage });
        return;
      }
      default:
        // `user_message_chunk` is the person's own words back.
        // `session_info_update` is the agent's own title for the session,
        // which does not rename the chat: a chat is named once, from its
        // first message, and its name's face is picked for that name (*Chat*,
        // `acp`: it arrives and is not drawn yet). Anything newer is not
        // drawn yet either.
        return;
    }
  };

  const tool = (c: Chat, live: Live, u: Record<string, unknown>): void => {
    const id = typeof u.toolCallId === "string" ? u.toolCallId : null;
    if (id === null || id === "") return;
    const known = c.tools.get(id);
    const state = mergeTool(known?.state ?? null, u);
    if (!state) return;
    const was = known?.state.title ?? "";
    let rec = known;
    if (!rec) {
      rec = { state, turn: c.turn, done: false, claimed: new Set() };
      c.tools.set(id, rec);
    } else rec.state = state;
    if (state.title !== "" && state.title !== was) signal({ kind: "tool", chat: c.id, turn: c.turn, text: state.title });
    emit(c, { kind: "tool", tool: toolLineOf(state, roots) });
    if (rec.done) return;
    if (state.status === "failed") {
      rec.done = true;
      return;
    }
    if (state.status !== "completed") return;
    rec.done = true;
    record(c, live, { kind: "tool", tool: state }, rec);
  };

  /* ── the edits ───────────────────────────────────────────────────── */

  /** A tool call in flight — not yet completed — that names this path. */
  const inFlight = (c: Chat, path: string): ToolRecord | null => {
    for (const rec of c.tools.values()) {
      if (rec.done || !TOOL_EDIT_KINDS.has(rec.state.kind)) continue;
      if (toolPaths(rec.state, roots).includes(path)) return rec;
    }
    return null;
  };

  const report = (path: string, via: EditVia, writer: Writer): void => {
    try {
      deps.onEdit(path, via, writer);
    } catch (e) {
      say(`chats: onEdit threw: ${said(e)}`);
    }
  };

  const contribute = (ts: TurnState | null, path: string, k: Contribution): void => {
    if (!ts) return;
    const list = ts.changes.get(path) ?? [];
    list.push(k);
    ts.changes.set(path, list);
  };

  /** EACH WRITE ONCE: an `fs` write and the tool call that made it are one
   *  edit, whichever Biom heard first. */
  const record = (c: Chat, live: Live, event: EditEvent, rec: ToolRecord | null): void => {
    let edits: Edit[];
    try {
      edits = editsOf(event, roots);
    } catch (e) {
      say(`chats: reading an edit failed: ${said(e)}`);
      return;
    }
    if (edits.length === 0) return;
    const ts = c.turnState;
    const writer: Writer = { kind: "agent", agent: live.agentId, chat: c.id, harness: live.harness, turn: c.turn };
    for (const e of edits) {
      if (event.kind === "fs") {
        const claimer = inFlight(c, e.path);
        if (claimer) claimer.claimed.add(e.path);
        else if (ts) ts.unclaimed.set(e.path, (ts.unclaimed.get(e.path) ?? 0) + 1);
        const k: Contribution = { kind: "fs", op: e.op };
        if (e.added !== undefined) k.added = e.added;
        if (e.removed !== undefined) k.removed = e.removed;
        contribute(ts, e.path, k);
        report(e.path, "fs", writer);
        continue;
      }
      if (e.via === "tool") {
        if (rec?.claimed.has(e.path)) continue;
        const waiting = ts?.unclaimed.get(e.path) ?? 0;
        if (ts && waiting > 0) {
          if (waiting === 1) ts.unclaimed.delete(e.path);
          else ts.unclaimed.set(e.path, waiting - 1);
          continue;
        }
        contribute(ts, e.path, { kind: "tool", tool: rec?.state.id ?? "" });
        report(e.path, "tool", writer);
        continue;
      }
      // A shell write is nobody else's report of the same write.
      contribute(ts, e.path, { kind: "tool", tool: rec?.state.id ?? "" });
      report(e.path, "shell", writer);
    }
  };

  /* ── the agent's files ───────────────────────────────────────────── */

  const outside = () => new AcpRpcError(INVALID_PARAMS, "Biom reads and writes only inside this workspace's folder");
  const stopped = () => new AcpRpcError(INVALID_PARAMS, "this chat's agent has been stopped");

  /** A path the agent named, as the vault-relative path `deps.files` takes.
   *  Refused outside the vault, whichever spelling of the root it used. */
  const confined = (p: unknown): string => {
    if (typeof p !== "string" || p === "" || p.includes("\u0000")) throw new AcpRpcError(INVALID_PARAMS, "a path is a non-empty string");
    const abs = resolve(root, p);
    for (const base of [root, realRoot]) {
      if (base !== null && within(base, abs, true)) return relative(base, abs);
    }
    throw outside();
  };

  /** The size of a file inside the vault, asked before it is read into
   *  memory; null where there is no file. Refused where the path leads out. */
  const sizeOf = async (rel: string): Promise<number | null> => {
    let real: string;
    try {
      real = await realpath(resolve(root, rel));
    } catch {
      return null;
    }
    if (!within(realRoot ?? root, real)) throw outside();
    try {
      const st = await stat(real);
      return st.isFile() ? st.size : null;
    } catch {
      return null;
    }
  };

  const readText = async (live: Live, params: unknown): Promise<unknown> => {
    if (live.gone) throw stopped();
    const p = isObj(params) ? params : {};
    const rel = confined(p.path);
    if (((await sizeOf(rel)) ?? 0) > FILE_MAX) throw new AcpRpcError(INVALID_PARAMS, "that file is too large to read through Biom");
    let text: string | null;
    try {
      text = await deps.files.read(rel);
    } catch (e) {
      if (e instanceof Error && e.name === "PathError") throw outside();
      throw new AcpRpcError(RESOURCE_NOT_FOUND, "that file could not be read");
    }
    if (text === null) throw new AcpRpcError(RESOURCE_NOT_FOUND, "there is no such file in this workspace");
    const line = typeof p.line === "number" && Number.isInteger(p.line) && p.line > 0 ? p.line : null;
    const limit = typeof p.limit === "number" && Number.isInteger(p.limit) && p.limit >= 0 ? p.limit : null;
    if (line === null && limit === null) return { content: text };
    const lines = text.split("\n");
    const from = (line ?? 1) - 1;
    return { content: lines.slice(from, limit === null ? undefined : from + limit).join("\n") };
  };

  const writeText = async (c: Chat, live: Live, params: unknown): Promise<unknown> => {
    if (live.gone) throw stopped();
    const p = isObj(params) ? params : {};
    const rel = confined(p.path);
    if (typeof p.content !== "string") throw new AcpRpcError(INVALID_PARAMS, "the content is a string");
    if (p.content.length > FILE_MAX) throw new AcpRpcError(INVALID_PARAMS, "that is too large to write through Biom");
    if (NOT_WRITABLE.has((rel.split(/[\\/]/)[0] as string).toLowerCase())) throw new AcpRpcError(INVALID_PARAMS, "that folder is the framework's, and Biom does not write in it for an agent");
    // What was there, for what the write changed: read only where it is small
    // enough to hold, and otherwise known only to have been there.
    const size = await sizeOf(rel);
    let old: string | null = null;
    if (size !== null && size <= FILE_MAX) {
      try {
        old = await deps.files.read(rel);
      } catch (e) {
        if (e instanceof Error && e.name === "PathError") throw outside();
        old = null;
      }
    }
    const ts = c.turnState;
    if (ts && !ts.committed) {
      ts.committed = true;
      try {
        await deps.files.commit(`Before ${live.harness} wrote in a chat`);
      } catch (e) {
        say(`chats: the commit before an agent's write failed: ${said(e)}`);
      }
    }
    if (live.gone) throw stopped();
    try {
      await deps.files.write(rel, p.content);
    } catch (e) {
      if (e instanceof Error && e.name === "PathError") throw outside();
      throw new AcpRpcError(INTERNAL_ERROR, "the file could not be written");
    }
    record(c, live, { kind: "fs", path: rel, old, text: p.content, existed: size !== null }, null);
    return {};
  };

  /* ── the agents list moving ──────────────────────────────────────── */

  let lastProbe = new Map<AgentKey, string>();
  deps.onAgents((list) => {
    const probe = new Map<AgentKey, string>();
    for (const a of list) probe.set(a.key, JSON.stringify([a.options, a.commands]));
    const was = lastProbe;
    lastProbe = probe;
    const moved = (key: AgentKey | null) => key !== null && probe.get(key) !== was.get(key);
    for (const c of chats.values()) {
      if (c.phase === "held" && c.held) {
        if (c.agent === null && adoptIfAny(c)) {
          emitConfig(c);
          void emitCommands(c);
        }
        const a = c.agent === null ? undefined : list.find((x) => x.key === c.agent);
        if (!a) continue;
        if (a.state !== "active") {
          c.held.off = true;
          continue;
        }
        if (c.held.signin && !c.held.off) continue;
        go(c);
        continue;
      }
      if (c.updates === null) continue;
      if (c.agent === null && adoptIfAny(c)) {
        emitConfig(c);
        void emitCommands(c);
        continue;
      }
      // A chat with no session of its own shows the probe's pickers and menu.
      if (moved(c.agent)) {
        if (c.options === null) emitConfig(c);
        if (c.agentCommands === null) void emitCommands(c);
      }
    }
  });

  /* ── the interface ───────────────────────────────────────────────── */

  const isFace = (f: unknown): f is Face => isObj(f) && typeof f.emoji === "string" && (f.art === null || typeof f.art === "string");

  return {
    loaded,

    async create(init) {
      await loaded;
      if (stopping) throw bad("unsupported", "Biom is stopping");
      const id = randomUUID();
      const created = now();
      let page: Place | null = null;
      if (typeof init.page === "string" && init.page !== "") {
        let uid: string | null = null;
        try {
          uid = await deps.uidOf(init.page);
        } catch {
          uid = null;
        }
        if (uid) page = { view: "page", uid, screen: "page" };
      }
      const c = fresh(id, created, page, false);
      c.updates = [];
      chats.set(id, c);
      c.log.append([{ t: "chat", v: 1, id, created, page }]);
      if (isObj(init.config)) {
        for (const [k, v] of Object.entries(init.config)) if (typeof v === "string" || typeof v === "boolean") c.pendingConfig.set(k, v);
        if (c.pendingConfig.size > 0) c.log.append([{ t: "config", values: Object.fromEntries(c.pendingConfig) }]);
      }
      if (typeof init.agent === "string" && init.agent !== "") target(c, init.agent);
      else adoptIfAny(c);
      emitConfig(c);
      await emitCommands(c);
      if (typeof init.text === "string" && init.text.trim() !== "") beginTurn(c, init.text);
      touch(c);
      return summary(c);
    },

    list() {
      return [...chats.values()].map(summary).sort((a, b) => b.updated - a.updated);
    },

    async read(id, since) {
      const c = await must(id);
      flush(c);
      const all = c.updates ?? [];
      const updates = typeof since === "number" ? all.filter((u) => u.seq > since) : all.slice();
      return { chat: summary(c), updates };
    },

    async send(id, text) {
      const c = await must(id);
      if (typeof text !== "string" || text.trim() === "") throw bad("bad_request", "a message has words in it");
      if (c.phase !== "idle") throw bad("limit", "one message at a time: this chat's turn is still going");
      if (stopping) throw bad("unsupported", "Biom is stopping");
      beginTurn(c, text);
      return summary(c);
    },

    async cancel(id) {
      const c = await must(id);
      const turn = c.turn;
      if (c.phase !== "idle" && c.held) {
        // Not yet handed to the agent: withdrawn, and a start under way for it
        // is ended with it.
        const live = c.live;
        c.held = null;
        c.gen++;
        if (c.phase === "starting" && live) void endLive(c, live);
        await finishTurn(c, turn, "cancelled", null);
      } else if (c.phase === "running" && !c.cancelling) {
        c.cancelling = true;
        const live = c.live;
        if (!live || live.gone || !live.conn || live.sessionId === null) await finishTurn(c, turn, "cancelled", null);
        else {
          live.conn.notify("session/cancel", { sessionId: live.sessionId });
          live.cancelTimer = setTimeout(() => {
            live.cancelTimer = null;
            if (c.turn !== turn || c.phase !== "running") return;
            // It did not answer Stop, and the next message cannot wait on it.
            void endLive(c, live);
            void finishTurn(c, turn, "cancelled", null);
          }, cancelGrace);
        }
      }
      return summary(c);
    },

    async config(id, option, value) {
      const c = await must(id);
      if (typeof option !== "string" || option === "") throw bad("bad_request", "an option is named");
      if (typeof value !== "string" && typeof value !== "boolean") throw bad("bad_request", "a value is a word or a switch");
      const known = shownOptions(c);
      const opt = known.find((o) => o.id === option);
      if (known.length > 0 && !opt) throw bad("not_found", "the agent offers no such option");
      if (opt?.type === "boolean" && typeof value !== "boolean") throw bad("bad_request", "that option is a switch");
      if (opt?.type === "select" && (typeof value !== "string" || (opt.choices.length > 0 && !opt.choices.some((ch) => ch.value === value)))) {
        throw bad("bad_request", "the agent offers no such choice");
      }
      c.pendingConfig.set(option, value);
      c.log.append([{ t: "config", values: Object.fromEntries(c.pendingConfig) }]);
      emitConfig(c);
      const live = c.live;
      // Mid-turn it waits for the next message; with no agent, for its start;
      // and no call waits on an agent — the answer arrives as a `config`
      // update.
      if (live && live.opened && !live.gone && c.phase === "idle") void applyConfig(c, live);
      touch(c);
      return summary(c);
    },

    async switchAgent(id, key) {
      const c = await must(id);
      if (typeof key !== "string" || key === "") throw bad("bad_request", "an agent is named");
      if (c.agent === key) return summary(c);
      if (c.phase === "starting" || c.phase === "running") throw bad("limit", "stop this turn before switching agent");
      if (c.live) void endLive(c, c.live);
      c.gen++;
      // A new agent opens a new session, which is handed the chat so far; the
      // old agent's session and its option ids are not the new one's.
      c.session = null;
      c.options = null;
      c.agentCommands = null;
      c.pendingConfig.clear();
      c.log.append([{ t: "config", values: {} }]);
      target(c, key);
      emitConfig(c);
      await emitCommands(c);
      if (c.held) {
        c.held.signin = false;
        c.held.off = false;
      }
      if (c.phase === "held" && c.held && isActive(key)) go(c);
      return summary(c);
    },

    async close(id) {
      const c = await must(id);
      if (c.phase !== "idle") {
        const live = c.live;
        if (c.phase === "running" && live?.conn && live.sessionId !== null) live.conn.notify("session/cancel", { sessionId: live.sessionId });
        c.held = null;
        c.gen++;
        await finishTurn(c, c.turn, "cancelled", null);
      }
      // The process ends in the background; a new start waits for it.
      if (c.live) void endLive(c, c.live);
      return summary(c);
    },

    async commands(q) {
      if (typeof q.chat === "string") {
        const c = await must(q.chat);
        return merged(agentCommandsOf(c));
      }
      if (typeof q.agent === "string") return merged(infoOf(q.agent)?.commands ?? []);
      return merged([]);
    },

    agentOf(agent) {
      const a = agentIds.get(agent);
      if (!a) return null;
      const c = chats.get(a.chat);
      if (!c) return null;
      return { chat: a.chat, harness: a.harness, turn: c.turn };
    },

    agentOfChat(id) {
      const c = chats.get(id);
      return c?.live && !c.live.gone ? c.live.agentId : null;
    },

    face(id, turn, face) {
      const c = chats.get(id);
      if (!c || !isFace(face)) return;
      const f: Face = { emoji: face.emoji, art: face.art };
      if (turn === null) {
        c.face = f;
        emit(c, { kind: "name", name: c.name, face: f });
        touch(c);
        return;
      }
      if (!Number.isInteger(turn) || turn < 1 || turn > c.turn) return;
      emit(c, { kind: "face", face: f }, turn);
    },

    on(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async endAll() {
      stopping = true;
      const ends: Promise<unknown>[] = [];
      for (const c of chats.values()) {
        if (c.phase === "idle") continue;
        c.held = null;
        c.gen++;
        ends.push(finishTurn(c, c.turn, "crashed", "Biom stopped during this turn"));
      }
      await Promise.all(ends);
      const closes: Promise<unknown>[] = [];
      for (const c of chats.values()) if (c.live) closes.push(endLive(c, c.live));
      await Promise.all(closes);
      const logs: Promise<unknown>[] = [];
      for (const c of chats.values()) {
        flush(c);
        clearGreen(c);
        logs.push(c.log.flushed());
      }
      await Promise.all(logs);
    },

    reap() {
      if (stopping) return 0;
      // Which chats a window has open — and when that cannot be said, none is
      // ended: ending the one a person is looking at is the worse mistake.
      let open: Set<ChatId>;
      try {
        open = new Set(deps.openIn());
      } catch (e) {
        say(`chats: which chats are open could not be read, so no idle agent was ended: ${said(e)}`);
        return 0;
      }
      const at = now();
      let ended = 0;
      for (const c of chats.values()) {
        const live = c.live;
        // Only an agent at rest: started, its session open, no turn held,
        // starting, running or being stopped — a turn in any of those owns it.
        if (live === null || live.gone || !live.opened) continue;
        if (c.phase !== "idle" || c.held !== null || c.cancelling) continue;
        if (open.has(c.id)) continue;
        const last = Math.max(c.endedAt ?? 0, live.since);
        if (at - last < IDLE_MS) continue;
        say(`chats: ${c.id}: ${live.harness} had no turn for ${Math.round((at - last) / 60_000)} minutes and no window has the chat open, so it was ended`);
        void endLive(c, live);
        ended++;
      }
      return ended;
    },

    killAll() {
      stopping = true;
      for (const c of chats.values()) {
        const live = c.live;
        if (!live) continue;
        live.ending = true;
        live.gone = true;
        live.conn?.kill();
      }
    },
  };
}
