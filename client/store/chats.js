// SPDX-License-Identifier: AGPL-3.0-only
// Layer 9 — THIS WINDOW'S COPY OF THE CHATS AND THE AGENTS: the list of
// chats, the open chat's stream, what this machine has, and every act the
// input box, the pickers and the pop-ups perform.
//
// EVERY ACT HERE IS ONE `chat.*` OR `agents.*` KIND THROUGH THE TRANSPORT, and
// every one of them is the host's to say: nothing in a box can reach this
// store. The kinds are outer ring and answered only to this machine's own
// window (the capability cookie), so the words a chat's agent is handed are
// only ever the words the person typed into Biom's own input box.
//
// NOTHING IS REPLAYED ON THE STREAM, so this store reads what it missed on
// every open of it (`resync`): the list, the agents, and the open chat's
// stream from the last `seq` it holds.
//
// THE OPEN CHAT'S STREAM IS FOLDED BY THE CONTRACT'S RULE (`fold` below) and
// held small: a tool line is whole and replaces itself where it first stood; a
// reply or a thought arriving a few characters at a time is one update per run
// of them, so a long chat is the size of what it says and not of how it was
// streamed; and a `config`, `commands`, `usage` or `plan` update replaces the
// one before it, because only the last of each is ever read. Only the open
// chat's stream is held at all — a chat in the background is its summary.
//
// A MESSAGE GOES IN LINE WITH THIS WINDOW'S REPORTS (`inLine`, the history
// store's): the server adds the page on screen to it from what this window
// last reported, so it leaves only once every report made before it has
// landed, and none made after it overtakes it.
//
// WHEN THIS WINDOW SENT is the switcher's `lastSent`, and a message that
// waits in the chat's queue is not sent yet: it is sent when it goes out,
// which the stream says with an `unqueued` update for its id. So a queued
// message never hands the screen over early, and one going out does.
//
// A CHAT DELETED — here, or in another window, which the stream says with a
// push saying `deleted`, or while this window's stream was shut, which the
// list read on its reopening says by leaving it out — is dropped from the list
// and never taken back, and `gone` says so for the view that has it open.
//
// THE CHAT'S KEPT CHOICES are the workspace's (`settings.read`), read on
// every open of the stream as the rest is, and again after this window makes
// a chat, sets a picker or switches agent — each of which the server keeps.
// The view is the one choice kept from here (`settings.set`), drawn at once
// and put back if the server refuses it.
//
// IT DOES NO OTHER I/O. Which chat a window has open is the ui store's
// (`UiState.chat`); the composition root remembers it for the session.

/** @import { AgentInfo, AgentKey, AgentReason, ApiRequest, ChatId, ChatPush, ChatRead, ChatSent, ChatSettings, ChatSummary, ChatUpdate, ChatView, ConfigChoice, ConfigOption, ConfigValue, Page, PageId, PickerCategory, RegistryAgent, SignIn, SlashCommand, Transport, UiState } from "../../contracts/types.ts" */
/** @import { Ui } from "./ui.js" */

import { emitter } from "../../contracts/emitter.js";
import { isChatView, isOpaqueId } from "../../contracts/guards.js";
import { AGENT_PAGE, PROTOCOL, nextId } from "../../contracts/wire.js";

/**
 * @typedef {object} ChatState
 * @property {ChatSummary[]} chats Newest first, by `updated`.
 * @property {AgentInfo[]} agents What this machine has, as the server last said.
 * @property {boolean} agentsKnown Whether the server has said at all yet.
 * @property {ChatId | null} open The chat whose stream is held.
 * @property {boolean} loading That chat's first read is still in flight.
 * @property {ChatUpdate[]} updates That chat's stream, folded. THE LIVE ARRAY:
 *   read it, never keep it.
 * @property {ConfigOption[] | null} config The open chat's last `config`
 *   update — what its pickers show — or null before it has one.
 * @property {SlashCommand[] | null} commands The open chat's last `commands`
 *   update — its / menu, merged by the server — or null.
 * @property {number} epoch Which read of the open chat's stream this is: it
 *   moves every time the stream is read from the start, so a reader that was
 *   handed the stream whole knows when it must be handed it whole again.
 * @property {ChatSettings | null} settings The workspace's kept choices — the
 *   view, the agent last picked, each agent's last pickers — as last read, or
 *   null before they have been.
 */

/**
 * @typedef {object} ChatStore
 * @property {() => ChatState} get
 * @property {(fn: () => void) => () => void} on Anything moved.
 * @property {(fn: (chat: ChatId, updates: ChatUpdate[]) => void) => () => void} onUpdates
 *   The open chat's stream grew: the updates just folded in, as they arrived.
 *   Not said for the first read of a chat, which `on` says with `loading`
 *   going false.
 * @property {(push: ChatPush) => void} takeChat A `chat` event off the stream.
 * @property {(agents: AgentInfo[]) => void} takeAgents An `agents` event.
 * @property {(chat: ChatId | null) => Promise<void>} open Hold this chat's stream.
 * @property {() => Promise<void>} resync The stream (re)opened: read what was missed.
 * @property {(chat: ChatId) => ChatSummary | null} summary
 * @property {(chat: ChatId) => number | null} lastSent When THIS WINDOW last
 *   sent a message in the chat, by its own clock — the switcher's `lastSent`.
 * @property {(init: { agent?: AgentKey, text?: string, page?: PageId, config?: Record<string, ConfigValue> }) => Promise<ChatSummary>} create
 * @property {(chat: ChatId, text: string) => Promise<ChatSent>} send Out now
 *   to an idle chat, else into its queue: the answer says which.
 * @property {(chat: ChatId) => Promise<ChatSummary>} sendQueued Send a held queue.
 * @property {(chat: ChatId, queued: string) => Promise<ChatSummary>} unqueue Take
 *   one message out of the queue.
 * @property {(chat: ChatId) => Promise<ChatSummary>} cancel
 * @property {(chat: ChatId, option: string, value: ConfigValue) => Promise<ChatSummary>} config
 * @property {(chat: ChatId, agent: AgentKey) => Promise<ChatSummary>} switchAgent
 * @property {(chat: ChatId) => Promise<ChatSummary>} close
 * @property {(chat: ChatId) => Promise<void>} remove Delete the chat — said
 *   only after the person's yes in Biom's own dialog.
 * @property {(chat: ChatId) => boolean} gone Whether the chat was deleted.
 * @property {(q: { chat?: ChatId, agent?: AgentKey }) => Promise<SlashCommand[]>} commands
 * @property {(agent: AgentKey) => Promise<AgentInfo>} probe
 * @property {(agent: AgentKey) => Promise<AgentInfo>} start
 * @property {(agent: AgentKey) => Promise<AgentInfo>} install
 * @property {(agent: AgentKey, method: string) => Promise<SignIn>} signIn
 * @property {() => Promise<RegistryAgent[]>} registry
 * @property {() => Promise<ChatSettings | null>} readSettings Read the kept
 *   choices again; null where the server would not say.
 * @property {(view: ChatView) => Promise<void>} setView Keep the view: drawn at
 *   once, and put back if the server refuses it.
 * @property {() => Promise<Page>} lookPage The Agent screen's own document:
 *   `@agent`, read as the bare plugin page the server answers it with — read
 *   here rather than through the workspace store, whose `page` is the page on
 *   screen and must not become the Agent screen's.
 */

/** The kinds of update that come a few characters at a time and are joined. */
const CHUNKS = new Set(["reply", "thought"]);
/** The kinds of which only the last is ever read, kept once each. */
const LATEST = new Set(["config", "commands", "usage", "plan"]);

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** An update this store can hold: a seq, a turn and a kind, and for the kinds
 *  it folds by their contents, those contents. Anything else is dropped rather
 *  than guessed at. @param {unknown} u @returns {u is ChatUpdate} */
export function isUpdate(u) {
  if (!isObj(u) || !Number.isInteger(u.seq) || u.seq < 1 || typeof u.kind !== "string" || typeof u.turn !== "number") return false;
  if (u.kind === "tool") return isObj(u.tool) && typeof u.tool.id === "string" && u.tool.id !== "";
  if (CHUNKS.has(u.kind)) return typeof u.text === "string";
  return true;
}

/**
 * ONE CHAT'S STREAM, AS HELD.
 * @typedef {object} Held
 * @property {ChatUpdate[]} updates
 * @property {Map<string, number>} tools where each tool line stands, by its id
 * @property {Map<string, number>} latest where each LATEST kind stands
 * @property {number} seq the highest seq held
 */

/** @returns {Held} */
export const held = () => ({ updates: [], tools: new Map(), latest: new Map(), seq: 0 });

/**
 * FOLD ONE BATCH INTO A CHAT'S STREAM, by the contract's rule, and answer the
 * updates that were new, as they arrived.
 *
 * "NEW" IS MEASURED ONCE PER BATCH. The server's kept log compacts a tool line
 * to its LAST state where it FIRST stood, and its stream gathers a batch with
 * tool lines replaced the same way — so seqs inside one batch are not in
 * order, and every update the server emits after a batch is numbered above
 * all of it. A running maximum would drop the reply chunks that follow a tool
 * line replaced by a later state; the maximum held when the batch BEGAN does
 * not. A tool line is new when its seq is above the one held for that line.
 *
 * @param {Held} h
 * @param {readonly unknown[]} batch
 * @returns {ChatUpdate[]}
 */
export function fold(h, batch) {
  const before = h.seq;
  /** @type {ChatUpdate[]} */
  const took = [];
  for (const u of batch) {
    if (!isUpdate(u)) continue;
    if (u.kind === "tool") {
      const at = h.tools.get(u.tool.id);
      if (at !== undefined) {
        if (/** @type {ChatUpdate} */ (h.updates[at]).seq >= u.seq) continue;
        h.updates[at] = u;
      } else {
        h.tools.set(u.tool.id, h.updates.length);
        h.updates.push(u);
      }
    } else {
      if (u.seq <= before) continue;
      const last = h.updates[h.updates.length - 1];
      if (LATEST.has(u.kind)) {
        const at = h.latest.get(u.kind);
        if (at !== undefined) h.updates[at] = u;
        else { h.latest.set(u.kind, h.updates.length); h.updates.push(u); }
      } else if (last && CHUNKS.has(u.kind) && last.kind === u.kind && last.turn === u.turn) {
        // ONE UPDATE PER RUN OF CHUNKS: the words joined and the latest seq
        // kept, so a patch after this read cannot say a chunk of it again.
        const was = /** @type {ChatUpdate & { text: string }} */ (last);
        const add = /** @type {ChatUpdate & { text: string }} */ (u);
        h.updates[h.updates.length - 1] = /** @type {ChatUpdate} */ ({ ...was, text: was.text + add.text, seq: Math.max(was.seq, add.seq) });
      } else {
        h.updates.push(u);
      }
    }
    if (u.seq > h.seq) h.seq = u.seq;
    took.push(u);
  }
  return took;
}

/** The last update of a kind in a held stream, or null.
 *  @param {Held} h @param {"config" | "commands"} kind @returns {any} */
function latestOf(h, kind) {
  const at = h.latest.get(kind);
  return at === undefined ? null : h.updates[at] ?? null;
}

/** @param {ChatSummary} a @param {ChatSummary} b */
const newest = (a, b) => b.updated - a.updated || b.created - a.created;

/** @param {unknown} s @returns {s is ChatSummary} */
const isSummary = (s) => isObj(s) && typeof s.id === "string" && s.id !== "" && typeof s.updated === "number";

/** @param {unknown} a @returns {a is AgentInfo} */
const isAgent = (a) => isObj(a) && typeof a.key === "string" && a.key !== "" && typeof a.name === "string";

/**
 * @param {{ transport: Transport, now?: () => number, inLine?: <T>(call: () => Promise<T>) => Promise<T> }} deps
 *   `inLine` is where a message waits its turn among this window's reports —
 *   the history store's — so the server reads the page it was sent from. Absent,
 *   a message goes at once: a window that reports nothing.
 * @returns {ChatStore}
 */
export function makeChatStore(deps) {
  const { transport } = deps;
  const now = deps.now ?? Date.now;
  const inLine = deps.inLine ?? ((call) => call());
  const changed = emitter();
  /** @type {{ on: (fn: (v: { chat: ChatId, updates: ChatUpdate[] }) => void) => () => void, emit: (v: { chat: ChatId, updates: ChatUpdate[] }) => void }} */
  const grew = /** @type {any} */ (emitter());

  /** @type {ChatSummary[]} */
  let chats = [];
  /** @type {AgentInfo[]} */
  let agents = [];
  let agentsKnown = false;
  /** @type {ChatId | null} */
  let open = null;
  let loading = false;
  let h = held();
  /** Batches for the open chat that arrived while a read of it was in flight
   *  — its first, or a catch-up — which the read may or may not have seen:
   *  folded AFTER the read, and `fold` says which were new. Folding one first
   *  would move the seq held past what the read brings, and the read's words
   *  would be dropped as said. Null while no read is out.
   *  @type {unknown[][] | null} */
  let early = null;
  /** A catch-up was asked for while the first read was out: the stream closed
   *  and opened under it, and what it missed is read once that read lands. */
  let catchAfter = false;
  /** Every read of a stream from the start, counted. */
  let epoch = 0;
  /** Which open this is, so a read that lands after another open is dropped. */
  let gen = 0;
  /** @type {Map<ChatId, number>} */
  const sent = new Map();
  /** The queued messages this window sent, by id, to the chat each waits in:
   *  sent, for `lastSent`, when the stream says it went out.
   *  @type {Map<string, ChatId>} */
  const mine = new Map();

  /** A MESSAGE OF THIS WINDOW'S WENT OUT OF A QUEUE, or was taken out: sent
   *  now, by this window's clock, or forgotten. @param {readonly unknown[]} updates */
  function outOfQueue(updates) {
    for (const u of updates) {
      if (!isObj(u) || u.kind !== "unqueued" || typeof u.id !== "string") continue;
      const chat = mine.get(u.id);
      if (chat === undefined) continue;
      mine.delete(u.id);
      if (u.sent === true) sent.set(chat, now());
    }
  }
  /** @type {ChatSettings | null} */
  let settings = null;
  /** Every chat this window has seen deleted: dropped, and never taken back
   *  from an answer or a push that was on its way when it went.
   *  @type {Set<ChatId>} */
  const deleted = new Set();
  /** Bumped by every view picked here, so a read that lands after a pick
   *  never puts the old view back. */
  let viewGen = 0;

  /** @type {ChatState} */
  let state = snapshot();

  /** @returns {ChatState} */
  function snapshot() {
    return {
      chats,
      agents,
      agentsKnown,
      open,
      loading,
      updates: h.updates,
      config: latestOf(h, "config")?.options ?? null,
      commands: latestOf(h, "commands")?.commands ?? null,
      epoch,
      settings,
    };
  }

  function emit() {
    state = snapshot();
    changed.emit(undefined);
  }

  /**
   * One request. Its value, or an Error carrying the wire's own code.
   * @param {Record<string, unknown>} body the kind and its fields
   * @returns {Promise<any>}
   */
  async function ask(body) {
    const req = /** @type {ApiRequest} */ (/** @type {unknown} */ ({ ...body, id: nextId(), g: PROTOCOL }));
    const res = await transport.call(req);
    if (res.ok) return res.value;
    throw Object.assign(new Error(res.error.message), { code: res.error.code });
  }

  /** TAKE ONE SUMMARY, unless it is older than the one held — an answer to a
   *  call can land after a stream event that already said something newer.
   *  Answers whether the list moved. @param {unknown} s */
  function takeSummary(s) {
    if (!isSummary(s) || deleted.has(s.id)) return false;
    const at = chats.findIndex((c) => c.id === s.id);
    if (at >= 0) {
      const was = /** @type {ChatSummary} */ (chats[at]);
      if (s.updated < was.updated) return false;
      if (JSON.stringify(was) === JSON.stringify(s)) return false;
    }
    chats = [...chats.filter((c) => c.id !== s.id), s].sort(newest);
    return true;
  }

  /** A CHAT GONE: out of the list, and out of the store if it was the one
   *  open. Answers whether anything moved. @param {ChatId} chat */
  function drop(chat) {
    const had = chats.some((c) => c.id === chat) || open === chat;
    deleted.add(chat);
    if (!had) return false;
    chats = chats.filter((c) => c.id !== chat);
    if (open === chat) {
      gen++;
      open = null;
      h = held();
      epoch++;
      early = null;
      catchAfter = false;
      loading = false;
    }
    return true;
  }

  /** One agent as a call answered it, in its place in the list. @param {unknown} a */
  function takeAgent(a) {
    if (!isAgent(a)) return;
    const at = agents.findIndex((x) => x.key === a.key);
    agents = at >= 0 ? agents.map((x, i) => (i === at ? a : x)) : [...agents, a];
    emit();
  }

  /** @param {ChatSummary} s */
  const summarised = (s) => { if (takeSummary(s)) emit(); return s; };

  /* ── the open chat ─────────────────────────────────────────────────── */

  /** @param {ChatId | null} chat */
  async function openChat(chat) {
    if (chat === open) return;
    const my = ++gen;
    open = chat;
    h = held();
    epoch++;
    early = null;
    catchAfter = false;
    loading = chat !== null;
    emit();
    if (chat === null) return;
    early = [];
    try {
      if (!isOpaqueId(chat)) throw Object.assign(new Error("there is no such chat"), { code: "not_found" });
      /** @type {ChatRead} */
      const read = await ask({ kind: "chat.read", chat });
      if (my !== gen) return;
      takeSummary(read.chat);
      fold(h, Array.isArray(read.updates) ? read.updates : []);
      for (const b of early) fold(h, b);
    } catch (e) {
      if (my !== gen) return;
      // NOTHING IS HELD FOR IT, so it is not the open chat: the next open of
      // it reads it again rather than drawing it empty for good.
      open = null;
      loading = false;
      early = null;
      emit();
      throw e;
    }
    early = null;
    loading = false;
    epoch++;
    emit();
    if (catchAfter) { catchAfter = false; void catchUp().catch((e) => console.warn("[biom] the chat could not be read again", e)); }
  }

  /** What was missed while the stream was shut: the open chat's stream from
   *  the last seq held, folded as a batch — and what the stream brings while
   *  the read is out, folded after it. */
  async function catchUp() {
    const chat = open;
    if (chat === null) return;
    if (loading || early !== null) { catchAfter = true; return; }
    const my = gen;
    early = [];
    /** @type {ChatRead | null} */
    let read = null;
    /** @type {unknown} */
    let failed = null;
    try {
      read = await ask({ kind: "chat.read", chat, since: h.seq });
    } catch (e) {
      failed = e;
    }
    // Another chat opened meanwhile: it owns `early` now, and this is moot.
    if (my !== gen) return;
    const batches = early;
    early = null;
    /** @type {ChatUpdate[]} */
    let took = [];
    if (read !== null) {
      takeSummary(read.chat);
      took = fold(h, Array.isArray(read.updates) ? read.updates : []);
    }
    // What the stream brought meanwhile is never lost, read or no read.
    for (const b of batches) took = took.concat(fold(h, b));
    outOfQueue(took);
    emit();
    if (took.length) grew.emit({ chat, updates: took });
    if (failed !== null) throw failed;
    if (catchAfter) { catchAfter = false; await catchUp(); }
  }

  async function readList() {
    // What was held when the list was asked for: a chat among it that the
    // list leaves out was deleted while this window was not listening.
    const before = new Set(chats.map((c) => c.id));
    /** @type {ChatSummary[]} */
    const list = await ask({ kind: "chat.list" });
    // Otherwise the list is a union: a chat made since the list was taken
    // stays, and a summary newer than the list's stays.
    let moved = false;
    const listed = new Set();
    for (const s of Array.isArray(list) ? list : []) {
      if (isSummary(s)) listed.add(s.id);
      moved = takeSummary(s) || moved;
    }
    for (const id of before) if (!listed.has(id)) moved = drop(id) || moved;
    if (moved) emit();
  }

  async function readAgents() {
    /** @type {AgentInfo[]} */
    const list = await ask({ kind: "agents.list" });
    agents = Array.isArray(list) ? list.filter(isAgent) : [];
    agentsKnown = true;
    emit();
  }

  /** THE KEPT CHOICES, read. A view picked here while the read was out wins
   *  over the view it brings. @returns {Promise<ChatSettings | null>} */
  async function readSettings() {
    const my = viewGen;
    /** @type {unknown} */
    let got;
    try {
      got = await ask({ kind: "settings.read" });
    } catch (e) {
      console.warn("[biom] the chat's kept choices could not be read", e);
      return settings;
    }
    if (!isSettings(got)) return settings;
    settings = my === viewGen || settings === null ? got : { ...got, view: settings.view };
    emit();
    return settings;
  }

  /** After a call the server kept a choice for: read what it keeps now. */
  const rekept = () => { void readSettings(); };

  /** @type {Promise<void> | null} */
  let syncing = null;
  let again = false;

  return {
    get: () => state,

    on(fn) {
      return changed.on(() => fn());
    },

    onUpdates(fn) {
      return grew.on((g) => fn(g.chat, g.updates));
    },

    takeChat(push) {
      if (!isObj(push) || !isSummary(push.chat)) return;
      if (push.deleted === true) {
        if (drop(push.chat.id)) emit();
        return;
      }
      if (Array.isArray(push.updates)) outOfQueue(push.updates);
      let moved = takeSummary(push.chat);
      const updates = Array.isArray(push.updates) ? push.updates : [];
      /** @type {ChatUpdate[]} */
      let took = [];
      if (push.chat.id === open && updates.length) {
        if (early !== null) early.push(updates);
        else took = fold(h, updates);
        moved = moved || took.length > 0;
      }
      if (moved) emit();
      if (took.length && open !== null) grew.emit({ chat: open, updates: took });
    },

    takeAgents(list) {
      if (!Array.isArray(list)) return;
      agents = list.filter(isAgent);
      agentsKnown = true;
      emit();
    },

    open: openChat,

    resync() {
      if (syncing) { again = true; return syncing; }
      syncing = (async () => {
        do {
          again = false;
          const done = await Promise.allSettled([readList(), readAgents(), catchUp(), readSettings()]);
          for (const d of done) if (d.status === "rejected") console.warn("[biom] the chats could not be read again", d.reason);
        } while (again);
      })().finally(() => { syncing = null; });
      return syncing;
    },

    summary(chat) {
      return chats.find((c) => c.id === chat) ?? null;
    },

    lastSent(chat) {
      return sent.get(chat) ?? null;
    },

    async create(init) {
      /** @type {Record<string, unknown>} */
      const body = { kind: "chat.new" };
      if (typeof init.agent === "string" && init.agent !== "") body.agent = init.agent;
      if (typeof init.text === "string" && init.text.trim() !== "") body.text = init.text;
      if (typeof init.page === "string" && init.page !== "") body.page = init.page;
      if (init.config && Object.keys(init.config).length) body.config = init.config;
      const at = now();
      // A first message goes with the page on screen: in line with the reports.
      /** @type {ChatSummary} */
      const s = await (body.text === undefined ? ask(body) : inLine(() => ask(body)));
      if (body.text !== undefined && isSummary(s)) sent.set(s.id, at);
      rekept();
      return summarised(s);
    },

    async send(chat, text) {
      // SENT NOW unless a turn is going, when it will be queued: the time is
      // taken before the call, because the agent's first write can reach this
      // window before the answer does.
      const was = sent.get(chat);
      const busy = (chats.find((c) => c.id === chat)?.phase ?? "idle") !== "idle";
      const at = now();
      if (!busy) sent.set(chat, at);
      /** @type {ChatSent} */
      const r = await inLine(() => ask({ kind: "chat.send", chat, text }));
      const queued = isObj(r) && isObj(r.queued) && typeof r.queued.id === "string" ? r.queued : null;
      if (queued !== null) {
        // It waits: it is sent when the stream says it went out.
        if (!busy) { if (was === undefined) sent.delete(chat); else sent.set(chat, was); }
        mine.set(queued.id, chat);
      } else if (busy) sent.set(chat, at);
      if (isObj(r) && isSummary(r.chat)) summarised(r.chat);
      return r;
    },

    async sendQueued(chat) {
      return summarised(await ask({ kind: "chat.sendQueued", chat }));
    },

    async unqueue(chat, queued) {
      return summarised(await ask({ kind: "chat.unqueue", chat, queued }));
    },

    async cancel(chat) {
      return summarised(await ask({ kind: "chat.cancel", chat }));
    },

    async config(chat, option, value) {
      const s = await ask({ kind: "chat.config", chat, option, value });
      rekept();
      return summarised(s);
    },

    async switchAgent(chat, agent) {
      const s = await ask({ kind: "chat.switchAgent", chat, agent });
      rekept();
      return summarised(s);
    },

    async close(chat) {
      return summarised(await ask({ kind: "chat.close", chat }));
    },

    async remove(chat) {
      await ask({ kind: "chat.delete", chat });
      if (drop(chat)) emit();
    },

    gone(chat) {
      return deleted.has(chat);
    },

    async commands(q) {
      /** @type {Record<string, unknown>} */
      const body = { kind: "chat.commands" };
      if (q.chat) body.chat = q.chat;
      else if (q.agent) body.agent = q.agent;
      const list = await ask(body);
      return Array.isArray(list) ? list : [];
    },

    async probe(agent) {
      const a = await ask({ kind: "agents.probe", agent });
      takeAgent(a);
      return a;
    },

    async start(agent) {
      const a = await ask({ kind: "agents.start", agent });
      takeAgent(a);
      return a;
    },

    async install(agent) {
      const a = await ask({ kind: "agents.install", agent });
      takeAgent(a);
      return a;
    },

    async signIn(agent, method) {
      return ask({ kind: "agents.signIn", agent, method });
    },

    async registry() {
      const list = await ask({ kind: "agents.registry" });
      return Array.isArray(list) ? list : [];
    },

    readSettings,

    async setView(view) {
      const was = settings;
      const gen = ++viewGen;
      settings = { ...(settings ?? { agent: null, agents: {} }), view };
      emit();
      /** @type {unknown} */
      let got;
      try {
        got = await ask({ kind: "settings.set", view });
      } catch (e) {
        // Put back only if nothing was picked since.
        if (gen === viewGen) { settings = was; emit(); }
        throw e;
      }
      if (gen === viewGen && isSettings(got)) { settings = got; emit(); }
    },

    async lookPage() {
      return ask({ kind: "page.read", page: AGENT_PAGE });
    },
  };
}

/** @param {unknown} v @returns {v is ChatSettings} */
function isSettings(v) {
  return isObj(v) && isChatView(v.view) && (v.agent === null || typeof v.agent === "string") && isObj(v.agents);
}

/* ── pure, and therefore testable ──────────────────────────────────────── */

/** WHERE THE AGENT SCREEN IS DRAWN IN THIS WINDOW, from its context alone:
 *  the whole screen on `#/agent`; the panel beside whatever else is on screen
 *  while the panel is open; nowhere otherwise — and never over the start page,
 *  which has no workspace to chat in.
 *  @param {Pick<UiState, "route" | "panel">} u
 *  @returns {"screen" | "panel" | "none"} */
export function agentMode(u) {
  if (u.route.view === "agent") return "screen";
  if (u.panel && u.route.view !== "vault") return "panel";
  return "none";
}

/** A NEW THREAD, wherever the Agent screen is: the start screen with the list
 *  of chats open beside it on the full screen — the list is left as it is
 *  when it already shows — and the start screen in the panel beside a page.
 *  The person's open either way; on the full screen it is an address.
 *  @param {Pick<Ui, "get" | "set" | "open">} ui */
export function freshThread(ui) {
  const u = ui.get();
  if (agentMode(u) === "screen") {
    ui.open("agent", "");
    if (!ui.get().chatList) ui.set({ chatList: true });
  } else {
    ui.set({ chat: null });
  }
}

/** A CHAT SHOWN WHERE THE AGENT SCREEN IS: on the full screen, its address —
 *  the person's open when they picked it, and the start screen's own entry
 *  REPLACED when the chat was just made from it, so Back does not land on an
 *  empty start screen; in the panel, the panel's chat, which moves nothing.
 *  @param {Pick<Ui, "get" | "set" | "open" | "go">} ui @param {ChatId} chat
 *  @param {"open" | "made"} how */
export function showChat(ui, chat, how) {
  const u = ui.get();
  if (agentMode(u) === "screen") {
    if (how === "made") ui.go("agent", chat);
    else ui.open("agent", chat);
  } else {
    ui.set({ chat });
  }
}

/** WHAT THE / MENU IS ASKED FOR, or null when it is shut: it opens while the
 *  input is a `/` at the very start and one word with no space after it, and
 *  the word is what narrows it.
 *  @param {string} text @returns {string | null} */
export function slashQuery(text) {
  const m = /^\/(\S*)$/.exec(text);
  return m ? (m[1] ?? "").toLowerCase() : null;
}

/** THE / MENU'S ROWS for what is typed: every command whose name starts with
 *  it, each name once, in name order. The server has already merged the
 *  agent's own commands with the workspace's skills it did not list.
 *  @param {readonly SlashCommand[]} commands @param {string} q
 *  @returns {SlashCommand[]} */
export function slashRows(commands, q) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {SlashCommand[]} */
  const rows = [];
  for (const c of commands) {
    if (!isObj(c) || typeof c.name !== "string") continue;
    const name = c.name.replace(/^\//, "");
    if (name === "" || /\s/.test(name) || seen.has(name)) continue;
    seen.add(name);
    if (name.toLowerCase().startsWith(q)) rows.push(name === c.name ? c : { ...c, name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** THE PICKERS UNDER THE INPUT, in the spec's order — model, mode, effort —
 *  each the first of the agent's options in its category. Everything else is
 *  `other` and is not drawn yet.
 *  @param {readonly ConfigOption[]} options @returns {ConfigOption[]} */
export function pickersOf(options) {
  /** @type {ConfigOption[]} */
  const out = [];
  for (const cat of ["model", "mode", "thought_level"]) {
    const o = options.find((x) => isObj(x) && x.category === cat);
    if (o) out.push(o);
  }
  return out;
}

/** How many choices a picker's own menu shows before **More models**. */
export const SHOWN_CHOICES = 5;

/** THE CHOICES A PICKER'S MENU SHOWS: all of them up to five; past five, the
 *  one chosen and the next four in the agent's own order, and **More** for
 *  the rest.
 *  @param {ConfigOption} option @returns {{ shown: ConfigChoice[], more: boolean }} */
export function shownChoices(option) {
  const all = option.choices;
  if (all.length <= SHOWN_CHOICES) return { shown: all, more: false };
  const now = all.find((c) => c.value === option.value);
  const rest = all.filter((c) => c !== now);
  return { shown: now ? [now, ...rest.slice(0, SHOWN_CHOICES - 1)] : all.slice(0, SHOWN_CHOICES), more: true };
}

/** THE LONG LIST, GROUPED THE WAY THE AGENT GROUPS IT, narrowed by a search
 *  over the choice's name, its line and its group's name. Groups keep the
 *  agent's order and are contiguous in it, so a group is a run.
 *  @param {ConfigOption} option @param {string} q
 *  @returns {{ group: string | null, choices: ConfigChoice[] }[]} */
export function groupedChoices(option, q) {
  const want = q.trim().toLowerCase();
  /** @type {{ group: string | null, choices: ConfigChoice[] }[]} */
  const out = [];
  for (const c of option.choices) {
    const hay = (c.name + " " + (c.description ?? "") + " " + (c.group ?? "")).toLowerCase();
    if (want && !hay.includes(want)) continue;
    const last = out[out.length - 1];
    if (last && last.group === c.group) last.choices.push(c);
    else out.push({ group: c.group, choices: [c] });
  }
  return out;
}

/** What a picker's chip says: the chosen choice's name, or the value itself.
 *  @param {ConfigOption} option @returns {string} */
export function choiceName(option) {
  if (option.type === "boolean") return option.name + (option.value === true ? " on" : " off");
  const c = option.choices.find((x) => x.value === option.value);
  return c ? c.name : String(option.value);
}

/** The options with the values the person set on the start screen laid over.
 *  @param {readonly ConfigOption[]} options @param {ReadonlyMap<string, ConfigValue>} set
 *  @returns {ConfigOption[]} */
export function withValues(options, set) {
  return options.map((o) => (set.has(o.id) ? { ...o, value: /** @type {ConfigValue} */ (set.get(o.id)) } : o));
}

/** AN AGENT'S KEPT VALUES THAT ITS LIST STILL OFFERS, by the option id each
 *  goes on — what the start screen's pickers show for it, as the server
 *  starts a new chat on them: each on the picker of its category (the first
 *  option in it), and only where that picker offers it. A dropped model, a
 *  word kept for a switch, a switch kept for a list, are left out.
 *  @param {readonly ConfigOption[]} options
 *  @param {Partial<Record<PickerCategory, ConfigValue>> | undefined} kept
 *  @returns {Map<string, ConfigValue>} */
export function keptValues(options, kept) {
  /** @type {Map<string, ConfigValue>} */
  const out = new Map();
  if (!isObj(kept)) return out;
  for (const o of pickersOf(options)) {
    const cat = /** @type {PickerCategory} */ (o.category);
    if (!Object.prototype.hasOwnProperty.call(kept, cat)) continue;
    const v = kept[cat];
    const offered = o.type === "boolean" ? typeof v === "boolean" : typeof v === "string" && o.choices.some((c) => c.value === v);
    if (offered) out.set(o.id, /** @type {ConfigValue} */ (v));
  }
  return out;
}

/** An agent's kept choices out of the kept whole, by its own key only.
 *  @param {ChatSettings | null} settings @param {AgentKey | null} key */
export function keptFor(settings, key) {
  if (settings === null || key === null || !Object.prototype.hasOwnProperty.call(settings.agents, key)) return undefined;
  return settings.agents[key];
}

/** THIS MACHINE'S AGENTS AS THE PICKER LISTS THEM: the Active ones first, then
 *  the Inactive, each in the order the server found them.
 *  @param {readonly AgentInfo[]} agents @returns {AgentInfo[]} */
export function machineAgents(agents) {
  return [...agents.filter((a) => a.state === "active"), ...agents.filter((a) => a.state !== "active")];
}

/** THE AGENT A NEW CHAT GOES TO: the one the person picked in this window
 *  while it is still on this machine, else the one the workspace kept as last
 *  picked while it is, else the first Active one, else the first there is.
 *  @param {readonly AgentInfo[]} agents @param {AgentKey | null} picked
 *  @param {AgentKey | null} [kept]
 *  @returns {AgentKey | null} */
export function defaultAgent(agents, picked, kept = null) {
  if (picked !== null && agents.some((a) => a.key === picked)) return picked;
  if (kept !== null && agents.some((a) => a.key === kept)) return kept;
  const active = agents.find((a) => a.state === "active");
  if (active) return active.key;
  return agents[0]?.key ?? null;
}

/** THE ONE BUTTON AN INACTIVE AGENT CARRIES, by why it is inactive — or null
 *  for an Active one and for one nothing the person can press would fix yet.
 *  @param {AgentInfo} a @returns {"signin" | "gateway" | null} */
export function buttonOf(a) {
  if (a.state === "active") return null;
  const r = /** @type {AgentReason | null} */ (a.reason);
  return r === "signin" ? "signin" : r === "gateway" ? "gateway" : null;
}

/** What the picker says under an agent's name: **Active** or **Inactive**
 *  and nothing else (*Chat*, `picker`: an agent is Active or Inactive, and an
 *  Inactive one carries the one thing that makes it Active). Work under way —
 *  a look, an install — is the lamp pulsing beside it and, in More agents, the
 *  button held while it runs; why an agent is Inactive is its line.
 *  @param {AgentInfo} a @returns {"Active" | "Inactive"} */
export function stateWords(a) {
  return a.state === "active" ? "Active" : "Inactive";
}

/** WHY A HELD MESSAGE IS WAITING, in one sentence for the top of More agents
 *  (*Chat*, `picker`): whose sign-in or Gateway it waits for, or that it waits
 *  for any agent at all.
 *  @param {ChatSummary} chat @param {readonly AgentInfo[]} agents @returns {string} */
export function waitingWords(chat, agents) {
  const a = chat.agent === null ? null : agents.find((x) => x.key === chat.agent) ?? null;
  const others = agents.some((x) => x.state === "active" && x.key !== chat.agent);
  const or = others ? ", or pick another," : "";
  if (a === null) {
    if (chat.agent !== null) return `Your message is waiting. ${chat.harness ?? "That agent"} is not on this machine; ${others ? "pick another" : "install one"} and it goes out.`;
    return agents.length === 0
      ? "Your message is waiting. Install an agent and it goes out."
      : "Your message is waiting. Sign in to an agent, or install one, and it goes out.";
  }
  if (a.state === "active") return `Your message is waiting for ${a.name}, and goes out in a moment.`;
  if (a.reason === "signin") return `Your message is waiting. Sign in to ${a.name}${or} and it goes out.`;
  if (a.reason === "gateway") return `Your message is waiting. Start ${a.name}’s Gateway${or} and it goes out.`;
  return `Your message is waiting for ${a.name} to be ready${others ? ", or pick another" : ""}.`;
}
