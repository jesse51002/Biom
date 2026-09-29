// SPDX-License-Identifier: AGPL-3.0-only
// THE AGENT SCREEN'S HOST SIDE: the chat store, the pure rules the input box
// and the pickers are drawn by, the bridge's answer to the look, and the view
// that mounts the look's box and feeds it.
//
// No browser here. The store runs against a transport double; the view against
// a recording element factory, a frame host double and the real ui store — the
// input box itself is DOM through and through and is walked in a real browser
// by `tests/e2e/agent-screen.e2e.ts`. Every chat, agent, page and word below is
// invented.

import { test, expect } from "bun:test";
import { AGENT_PAGE, ERRORS, PROTOCOL } from "../contracts/wire.js";
import {
  agentMode, choiceName, defaultAgent, fold, freshThread, groupedChoices, held, isUpdate, machineAgents,
  makeChatStore, pickersOf, showChat, shownChoices, slashQuery, slashRows, stateWords, buttonOf, waitingWords, withValues, keptFor, keptValues,
} from "../client/store/chats.js";
import { makeUi } from "../client/store/ui.js";
import { makeBridge } from "../client/bridge/bridge.js";
import { LOOK_KEY, PATCH_MAX, makeAgentView } from "../client/views/agent.js";

/* ── fixtures, invented ────────────────────────────────────────────────── */

const CHAT = "c1nvented-chat-0001";
const OTHER = "c1nvented-chat-0002";
const QUEUED = "q1nvented-queued-0001";

/** @param {Record<string, unknown>} [over] */
const summary = (over = {}) => ({
  id: CHAT, name: "Invented chat", face: null, agent: "claude-acp", harness: "Claude Code", agentId: null,
  page: null, phase: "idle", turn: 1, light: "none", stop: null, reason: null, created: 1, updated: 10, ...over,
});

/** @param {number} seq @param {string} kind @param {Record<string, unknown>} [extra] @param {number} [turn] */
const up = (seq, kind, extra = {}, turn = 1) => ({ seq, at: seq, turn, kind, ...extra });
/** @param {number} seq @param {string} id @param {string} status */
const tool = (seq, id, status) => up(seq, "tool", { tool: { id, title: "Invented " + id, kind: "edit", status, locations: [], diffs: [], output: "", truncated: false } });

/** @param {Record<string, unknown>} [over] */
const agent = (over = {}) => ({
  key: "claude-acp", name: "Claude Code", line: "Invented line", icon: null, source: "path", version: null,
  state: "active", reason: null, message: null, auth: [], options: [], commands: [], ...over,
});

/** A transport answering each kind from a table; a kind it has no answer for
 *  is refused `not_found`, a handler that throws is refused with its code. */
function transportOf(/** @type {Record<string, (req: any) => any>} */ answers) {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    transport: {
      /** @param {any} req */
      async call(req) {
        calls.push(req);
        const a = answers[req.kind];
        if (!a) return { id: req.id, g: PROTOCOL, ok: false, error: { code: "not_found", message: "not here" } };
        try {
          return { id: req.id, g: PROTOCOL, ok: true, value: await a(req) };
        } catch (e) {
          return { id: req.id, g: PROTOCOL, ok: false, error: { code: /** @type {any} */ (e).code ?? "internal", message: String(/** @type {any} */ (e).message) } };
        }
      },
    },
  };
}

/* ── the fold ──────────────────────────────────────────────────────────── */

test("a batch's new updates are measured against the seq held when it BEGAN, so a tool line replaced by a later state does not drop the words after it", () => {
  const h = held();
  fold(h, [up(1, "prompt", { text: "Invented" }), up(2, "reply", { text: "a" })]);
  // As the stream gathers them: the tool line's latest state where it first
  // stood, then the chunks that arrived after its first state.
  const took = fold(h, [tool(9, "t1", "completed"), up(7, "reply", { text: "b" }), up(8, "reply", { text: "c" })]);
  expect(took.map((u) => u.seq)).toEqual([9, 7, 8]);
  expect(h.seq).toBe(9);
  expect(h.updates.map((u) => u.kind)).toEqual(["prompt", "reply", "tool", "reply"]);
  // A run of chunks is one update, its words joined and its seq the latest.
  expect(h.updates[3]).toMatchObject({ kind: "reply", text: "bc", seq: 8 });
});

test("a tool line is replaced where it first stood, and only by a later state of it", () => {
  const h = held();
  fold(h, [tool(3, "t1", "pending"), up(4, "reply", { text: "x" })]);
  expect(fold(h, [tool(2, "t1", "in_progress")])).toEqual([]);
  fold(h, [tool(5, "t1", "completed")]);
  expect(h.updates.map((u) => u.kind)).toEqual(["tool", "reply"]);
  expect(/** @type {any} */ (h.updates[0]).tool.status).toBe("completed");
});

test("anything at or under the seq held is a word already said, and is dropped", () => {
  const h = held();
  fold(h, [up(1, "prompt", { text: "Invented" }), up(2, "reply", { text: "one" })]);
  expect(fold(h, [up(2, "reply", { text: "one" }), up(1, "prompt", { text: "Invented" })])).toEqual([]);
  expect(h.updates.length).toBe(2);
});

test("a reply joins only the reply just before it in the same turn: a tool line, a thought or a new turn starts another", () => {
  const h = held();
  fold(h, [up(1, "reply", { text: "a" }), up(2, "thought", { text: "t" }), up(3, "reply", { text: "b" }), up(4, "reply", { text: "c" }, 2)]);
  expect(h.updates.map((u) => [u.kind, /** @type {any} */ (u).text, u.turn])).toEqual([["reply", "a", 1], ["thought", "t", 1], ["reply", "b", 1], ["reply", "c", 2]]);
});

test("only the last config, commands, usage and plan are kept, each where the first stood", () => {
  const h = held();
  fold(h, [up(1, "config", { options: [] }), up(2, "commands", { commands: [] }), up(3, "config", { options: [{ id: "model" }] }), up(4, "usage", { used: 1, size: 2, cost: null }), up(5, "usage", { used: 2, size: 2, cost: null })]);
  expect(h.updates.map((u) => [u.kind, u.seq])).toEqual([["config", 3], ["commands", 2], ["usage", 5]]);
});

test("an update the store cannot hold is dropped rather than guessed at", () => {
  expect(isUpdate(up(1, "reply", { text: "ok" }))).toBe(true);
  expect(isUpdate({ seq: 0, turn: 1, kind: "reply", text: "x" })).toBe(false);
  expect(isUpdate(up(2, "reply"))).toBe(false);
  expect(isUpdate(up(3, "tool", { tool: { id: "" } }))).toBe(false);
  expect(isUpdate(null)).toBe(false);
});

/* ── the store ─────────────────────────────────────────────────────────── */

test("a chat opened is read from the start, and what the stream carried while the read was out is folded once, after it", async () => {
  /** @type {(v: any) => void} */
  let answer = () => {};
  const { transport } = transportOf({ "chat.read": () => new Promise((r) => { answer = r; }) });
  const store = makeChatStore({ transport });
  /** @type {any[]} */
  const grew = [];
  store.onUpdates((chat, updates) => grew.push([chat, updates.map((u) => u.seq)]));
  const opening = store.open(CHAT);
  expect(store.get().loading).toBe(true);
  // Pushes land before the read: one the read also has, and one after it.
  store.takeChat({ chat: summary({ updated: 11 }), updates: [up(2, "reply", { text: "b" })] });
  store.takeChat({ chat: summary({ updated: 12 }), updates: [up(3, "reply", { text: "c" })] });
  answer({ chat: summary({ updated: 11 }), updates: [up(1, "prompt", { text: "Invented" }), up(2, "reply", { text: "b" })] });
  await opening;
  const s = store.get();
  expect(s.loading).toBe(false);
  expect(s.updates.map((u) => [u.kind, /** @type {any} */ (u).text])).toEqual([["prompt", "Invented"], ["reply", "bc"]]);
  // The first read is said by `on`, with loading going false, not by onUpdates.
  expect(grew).toEqual([]);
  // After it, the stream grows the chat and says so.
  store.takeChat({ chat: summary({ updated: 13 }), updates: [up(4, "turn", { phase: "idle", stop: "end_turn", reason: null })] });
  expect(grew).toEqual([[CHAT, [4]]]);
});

test("a push may carry the summary alone, and an answer older than what the stream said never undoes it", async () => {
  const { transport } = transportOf({ "chat.send": () => summary({ updated: 15, phase: "starting" }) });
  const store = makeChatStore({ transport });
  let heard = 0;
  store.on(() => heard++);
  store.takeChat({ chat: summary({ updated: 20, phase: "running", light: "working" }), updates: [] });
  expect(store.summary(CHAT)?.phase).toBe("running");
  expect(heard).toBe(1);
  await store.send(CHAT, "Invented");
  expect(store.summary(CHAT)?.phase).toBe("running");
  // The same summary again moves nothing and says nothing.
  store.takeChat({ chat: summary({ updated: 20, phase: "running", light: "working" }), updates: [] });
  expect(heard).toBe(1);
});

test("A MESSAGE GOES IN LINE WITH THIS WINDOW'S REPORTS: a send and a first message each wait their turn behind them, so the server reads the page they were sent from", async () => {
  const { transport, calls } = transportOf({
    "chat.send": () => ({ chat: summary({ updated: 15 }), queued: null }),
    "chat.new": () => summary({ id: OTHER, updated: 16 }),
    "settings.read": () => ({ agent: null, agents: {} }),
  });
  /** @type {string[]} */
  const order = [];
  /** @type {() => void} */
  let release = () => {};
  const reported = new Promise((r) => { release = () => r(undefined); });
  const store = makeChatStore({
    transport,
    inLine: async (call) => {
      order.push("waits");
      await reported;
      order.push("goes");
      return call();
    },
  });
  store.takeChat({ chat: summary(), updates: [] });
  const messages = () => calls.filter((c) => c.kind === "chat.send" || c.kind === "chat.new").map((c) => c.kind);
  const sent = store.send(CHAT, "Invented");
  const made = store.create({ agent: "claude-acp", text: "Invented first message" });
  await new Promise((r) => setTimeout(r, 0));
  expect(messages()).toEqual([]);
  // When THIS window sent is taken as the person sent it, not when it left.
  expect(store.lastSent(CHAT)).not.toBe(null);
  release();
  await Promise.all([sent, made]);
  expect(messages()).toEqual(["chat.send", "chat.new"]);
  expect(order).toEqual(["waits", "waits", "goes", "goes"]);
});

test("the list is newest first, and a chat's updates reach the store only while it is the one open", () => {
  const { transport } = transportOf({});
  const store = makeChatStore({ transport });
  store.takeChat({ chat: summary({ id: OTHER, updated: 30 }), updates: [up(1, "prompt", { text: "x" })] });
  store.takeChat({ chat: summary({ updated: 40 }), updates: [] });
  expect(store.get().chats.map((c) => c.id)).toEqual([CHAT, OTHER]);
  expect(store.get().updates).toEqual([]);
});

test("reopening the stream reads what was missed: the list, the agents, and the open chat from the last seq held", async () => {
  let reads = 0;
  const { transport, calls } = transportOf({
    "chat.read": (req) => {
      reads++;
      return req.since === undefined
        ? { chat: summary(), updates: [up(1, "prompt", { text: "a" }), tool(6, "t1", "completed"), up(4, "reply", { text: "b" })] }
        : { chat: summary({ updated: 50 }), updates: [up(7, "reply", { text: "c" })] };
    },
    // The server lists every chat it has, the open one among them.
    "chat.list": () => [summary(), summary({ id: OTHER, updated: 5 })],
    "agents.list": () => [agent()],
  });
  const store = makeChatStore({ transport });
  await store.open(CHAT);
  /** @type {number[][]} */
  const grew = [];
  store.onUpdates((_c, u) => grew.push(u.map((x) => x.seq)));
  await store.resync();
  expect(calls.find((c) => c.kind === "chat.read" && c.since !== undefined)?.since).toBe(6);
  expect(grew).toEqual([[7]]);
  expect(store.get().agents.map((a) => a.key)).toEqual(["claude-acp"]);
  expect(store.get().agentsKnown).toBe(true);
  expect(store.get().chats.map((c) => c.id)).toEqual([CHAT, OTHER]);
  expect(reads).toBe(2);
});

test("A STREAM REOPENED MID-TURN LOSES NO WORDS: what the stream brings while the catch-up read is out is folded after the read, never before it", async () => {
  /** @type {(v: any) => void} */
  let answer = () => {};
  let first = true;
  const { transport } = transportOf({
    "chat.read": () => {
      if (first) { first = false; return { chat: summary(), updates: [up(1, "prompt", { text: "a" }), up(10, "reply", { text: "b" })] }; }
      return new Promise((r) => { answer = r; });
    },
    "chat.list": () => [summary()], "agents.list": () => [],
  });
  const store = makeChatStore({ transport });
  await store.open(CHAT);
  /** @type {number[][]} */
  const grew = [];
  store.onUpdates((_c, u) => grew.push(u.map((x) => x.seq)));
  const syncing = store.resync();
  await new Promise((r) => setTimeout(r, 0));
  // Live, while the read of 11 onward is out.
  store.takeChat({ chat: summary({ updated: 30 }), updates: [up(20, "reply", { text: "e" })] });
  expect(grew).toEqual([]);
  answer({ chat: summary({ updated: 29 }), updates: [up(11, "reply", { text: "c" }), up(19, "reply", { text: "d" })] });
  await syncing;
  expect(store.get().updates.map((u) => /** @type {any} */ (u).text)).toEqual(["a", "bcde"]);
  expect(grew).toEqual([[11, 19, 20]]);
});

test("a stream reopened while a chat's first read is out is caught up once that read lands", async () => {
  /** @type {(v: any) => void} */
  let answer = () => {};
  /** @type {any[]} */
  const reads = [];
  const { transport } = transportOf({
    "chat.read": (req) => {
      reads.push(req.since);
      if (req.since === undefined) return new Promise((r) => { answer = r; });
      return { chat: summary(), updates: [up(5, "reply", { text: "later" })] };
    },
    "chat.list": () => [], "agents.list": () => [],
  });
  const store = makeChatStore({ transport });
  const opening = store.open(CHAT);
  await store.resync();
  answer({ chat: summary(), updates: [up(1, "prompt", { text: "a" })] });
  await opening;
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  expect(reads).toEqual([undefined, 1]);
  expect(store.get().updates.map((u) => u.seq)).toEqual([1, 5]);
});

test("every read of a chat from the start is a new epoch, so a chat come back to is handed over whole", async () => {
  const { transport } = transportOf({ "chat.read": (req) => ({ chat: summary({ id: req.chat }), updates: [] }) });
  const store = makeChatStore({ transport });
  await store.open(CHAT);
  const a = store.get().epoch;
  await store.open(OTHER);
  await store.open(CHAT);
  expect(store.get().epoch).toBeGreaterThan(a);
});

test("a read that fails for a reason that may pass leaves nothing open, so the chat is read again rather than drawn empty", async () => {
  let fail = true;
  const { transport } = transportOf({ "chat.read": () => { if (fail) throw Object.assign(new Error("down"), { code: "internal" }); return { chat: summary(), updates: [up(1, "prompt", { text: "a" })] }; } });
  const store = makeChatStore({ transport });
  await expect(store.open(CHAT)).rejects.toMatchObject({ code: "internal" });
  expect(store.get().open).toBe(null);
  fail = false;
  await store.open(CHAT);
  expect(store.get().updates.length).toBe(1);
});

test("lastSent is this window's clock at the moment it sent, for the switcher", async () => {
  let t = 100;
  const { transport } = transportOf({ "chat.new": (req) => summary({ id: OTHER, phase: req.text ? "starting" : "idle" }), "chat.send": () => ({ chat: summary({ phase: "starting" }), queued: null }) });
  const store = makeChatStore({ transport, now: () => t });
  expect(store.lastSent(CHAT)).toBe(null);
  await store.create({ agent: "claude-acp" });
  expect(store.lastSent(OTHER)).toBe(null);
  t = 200;
  await store.create({ agent: "claude-acp", text: "Invented" });
  expect(store.lastSent(OTHER)).toBe(200);
  t = 300;
  await store.send(CHAT, "Invented again");
  expect(store.lastSent(CHAT)).toBe(300);
});

test("A QUEUED MESSAGE IS SENT WHEN IT GOES OUT, not when it was queued: lastSent moves only when the stream says this window's message left the queue for its turn", async () => {
  let t = 100;
  let n = 0;
  const { transport, calls } = transportOf({
    "chat.send": () => ({ chat: summary({ phase: "running", updated: 20 + n, queued: 1 }), queued: { id: `q1nvented-queued-0${++n}`, place: n } }),
  });
  const store = makeChatStore({ transport, now: () => t });
  // A turn is going in the chat, sent at 100.
  store.takeChat({ chat: summary({ phase: "running", updated: 15 }), updates: [] });
  await store.send(CHAT, "queued behind it");
  await store.send(CHAT, "and another");
  expect(calls.map((c) => c.kind)).toEqual(["chat.send", "chat.send"]);
  expect(store.lastSent(CHAT)).toBe(null);
  // Another window's queued message going out is not this window's send.
  t = 400;
  store.takeChat({ chat: summary({ updated: 40 }), updates: [up(9, "unqueued", { id: "q1nvented-elsewhere", sent: true })] });
  expect(store.lastSent(CHAT)).toBe(null);
  // Taken out, it never goes: nothing is sent.
  store.takeChat({ chat: summary({ updated: 41 }), updates: [up(10, "unqueued", { id: "q1nvented-queued-02", sent: false })] });
  expect(store.lastSent(CHAT)).toBe(null);
  // This window's goes out: sent now, by this window's clock.
  t = 500;
  store.takeChat({ chat: summary({ updated: 50, phase: "running" }), updates: [up(11, "unqueued", { id: "q1nvented-queued-01", sent: true }), up(12, "prompt", { text: "queued behind it" }, 2)] });
  expect(store.lastSent(CHAT)).toBe(500);
});

test("a message sent to an idle chat is sent at once, and one queued after all puts lastSent back", async () => {
  let t = 100;
  let queue = false;
  const { transport } = transportOf({ "chat.send": () => ({ chat: summary(), queued: queue ? { id: "q1nvented-queued-09", place: 1 } : null }) });
  const store = makeChatStore({ transport, now: () => t });
  store.takeChat({ chat: summary({ phase: "idle" }), updates: [] });
  await store.send(CHAT, "out at once");
  expect(store.lastSent(CHAT)).toBe(100);
  // The chat looked idle and a turn had begun: the server queued it.
  t = 200;
  queue = true;
  await store.send(CHAT, "queued after all");
  expect(store.lastSent(CHAT)).toBe(100);
});

test("a chat the server does not have is refused, and the store is left with nothing loading", async () => {
  const { transport } = transportOf({});
  const store = makeChatStore({ transport });
  await expect(store.open(CHAT)).rejects.toMatchObject({ code: "not_found" });
  expect(store.get().loading).toBe(false);
  await expect(store.open("not an id")).rejects.toMatchObject({ code: "not_found" });
});

test("chat.new sends only what was given: no agent when none is named, no page, no empty config", async () => {
  const { transport, calls } = transportOf({ "chat.new": () => summary({ agent: null, harness: null, phase: "held" }) });
  const store = makeChatStore({ transport });
  await store.create({ text: "Invented", config: {} });
  const made = () => calls.filter((c) => c.kind === "chat.new");
  const req = made()[0];
  expect(Object.keys(req).filter((k) => k !== "id" && k !== "g").sort()).toEqual(["kind", "text"]);
  await store.create({ agent: "claude-acp", text: "x", page: "home/Specs", config: { model: "opus" } });
  expect(made()[1]).toMatchObject({ kind: "chat.new", agent: "claude-acp", text: "x", page: "home/Specs", config: { model: "opus" } });
});

/* ── the pure rules ────────────────────────────────────────────────────── */

test("the / menu opens on a / at the start and one word, and narrows to what starts with it, each name once, in order", () => {
  expect(slashQuery("/")).toBe("");
  expect(slashQuery("/Co")).toBe("co");
  expect(slashQuery("/code review")).toBe(null);
  expect(slashQuery("hi /code")).toBe(null);
  expect(slashQuery("")).toBe(null);
  const commands = [
    { name: "compact", description: "c", hint: null, source: "agent", skill: null },
    { name: "code-review", description: "r", hint: null, source: "agent", skill: null },
    { name: "/init", description: "i", hint: null, source: "agent", skill: null },
    { name: "competitive-analysis", description: "s", hint: null, source: "skill", skill: ".agents/skills/competitive-analysis/SKILL.md" },
    { name: "compact", description: "twice", hint: null, source: "skill", skill: "x" },
    { name: "has space", description: "no", hint: null, source: "agent", skill: null },
  ];
  expect(slashRows(/** @type {any} */ (commands), "").map((c) => c.name)).toEqual(["code-review", "compact", "competitive-analysis", "init"]);
  expect(slashRows(/** @type {any} */ (commands), "c").map((c) => c.name)).toEqual(["code-review", "compact", "competitive-analysis"]);
  expect(slashRows(/** @type {any} */ (commands), "co").map((c) => c.name)).toEqual(["code-review", "compact", "competitive-analysis"]);
  expect(slashRows(/** @type {any} */ (commands), "code").map((c) => c.name)).toEqual(["code-review"]);
  expect(slashRows(/** @type {any} */ (commands), "zz")).toEqual([]);
});

test("a picker shows five choices and More past five, the chosen one first, and the long list keeps the agent's groups", () => {
  const choices = ["a", "b", "c", "d", "e", "f", "g"].map((v, i) => ({ value: v, name: v.toUpperCase(), description: null, group: i < 3 ? "Invented Labs" : i < 5 ? "Elsewhere" : null }));
  const option = { id: "model", name: "Model", category: /** @type {const} */ ("model"), type: /** @type {const} */ ("select"), value: "f", choices };
  const { shown, more } = shownChoices(option);
  expect(more).toBe(true);
  expect(shown.map((c) => c.value)).toEqual(["f", "a", "b", "c", "d"]);
  expect(shownChoices({ ...option, choices: choices.slice(0, 5) }).more).toBe(false);
  expect(groupedChoices(option, "").map((g) => [g.group, g.choices.length])).toEqual([["Invented Labs", 3], ["Elsewhere", 2], [null, 2]]);
  expect(groupedChoices(option, "elsew").map((g) => g.group)).toEqual(["Elsewhere"]);
  expect(choiceName(option)).toBe("F");
  expect(choiceName(withValues([option], new Map([["model", "b"]]))[0])).toBe("B");
  expect(pickersOf([{ ...option, category: "other", id: "x" }, { ...option, category: "thought_level", id: "e" }, option]).map((o) => o.id)).toEqual(["model", "e"]);
});

test("where the Agent screen is drawn is the route and the panel, and never over the start page", () => {
  expect(agentMode({ route: { view: "agent", id: "", screen: "page" }, panel: true })).toBe("screen");
  expect(agentMode({ route: { view: "page", id: "home", screen: "page" }, panel: true })).toBe("panel");
  expect(agentMode({ route: { view: "page", id: "home", screen: "page" }, panel: false })).toBe("none");
  expect(agentMode({ route: { view: "vault", id: "", screen: "page" }, panel: true })).toBe("none");
});

test("a new chat goes to the agent picked while it is here, else the first Active, else the first; Active ones are listed first", () => {
  const list = [agent({ key: "a", state: "inactive", reason: "signin" }), agent({ key: "b" }), agent({ key: "c", state: "inactive", reason: "gateway" })];
  expect(defaultAgent(/** @type {any} */ (list), null)).toBe("b");
  expect(defaultAgent(/** @type {any} */ (list), "c")).toBe("c");
  expect(defaultAgent(/** @type {any} */ (list), "gone")).toBe("b");
  expect(defaultAgent(/** @type {any} */ ([list[0]]), null)).toBe("a");
  expect(defaultAgent([], null)).toBe(null);
  expect(machineAgents(/** @type {any} */ (list)).map((a) => a.key)).toEqual(["b", "a", "c"]);
  // The agent the workspace kept as last picked comes after this window's own
  // pick and before the first Active, while it is on this machine.
  expect(defaultAgent(/** @type {any} */ (list), null, "c")).toBe("c");
  expect(defaultAgent(/** @type {any} */ (list), "a", "c")).toBe("a");
  expect(defaultAgent(/** @type {any} */ (list), null, "gone")).toBe("b");
});

test("the start screen's pickers show an agent's kept values its list still offers, each on the picker of its category", () => {
  const opts = [
    { id: "m", name: "Model", category: "model", type: "select", value: "a", choices: [{ value: "a", name: "A", description: null, group: null }, { value: "b", name: "B", description: null, group: null }] },
    { id: "m2", name: "Other model", category: "model", type: "select", value: "x", choices: [{ value: "b", name: "B", description: null, group: null }] },
    { id: "think", name: "Think", category: "thought_level", type: "boolean", value: false, choices: [] },
  ];
  expect([...keptValues(/** @type {any} */ (opts), { model: "b", thought_level: true, mode: "code" })]).toEqual([["m", "b"], ["think", true]]);
  expect([...keptValues(/** @type {any} */ (opts), { model: "gone", thought_level: "yes" })]).toEqual([]);
  expect([...keptValues(/** @type {any} */ (opts), undefined)]).toEqual([]);
  const kept = { agent: null, agents: { "claude-acp": { model: "b" } } };
  expect(keptFor(kept, "claude-acp")).toEqual({ model: "b" });
  expect(keptFor(kept, "constructor")).toBeUndefined();
  expect(keptFor(null, "claude-acp")).toBeUndefined();
});

test("A CHAT DELETED IS DROPPED AND NEVER TAKEN BACK: by a push saying so, by this window's own delete, and by a list read on reopening that leaves it out", async () => {
  let listed = [summary({ id: OTHER, updated: 5 })];
  const { transport } = transportOf({
    "chat.read": () => ({ chat: summary(), updates: [up(1, "prompt", { text: "a" })] }),
    "chat.list": () => listed,
    "agents.list": () => [],
    "chat.delete": () => null,
  });
  const store = makeChatStore({ transport });
  store.takeChat({ chat: summary(), updates: [] });
  store.takeChat({ chat: summary({ id: OTHER, updated: 5 }), updates: [] });
  await store.open(CHAT);
  expect(store.get().open).toBe(CHAT);
  const epoch = store.get().epoch;
  // A push saying the open chat is gone: out of the list and out of the store.
  store.takeChat({ chat: summary(), updates: [], deleted: true });
  expect(store.get().chats.map((c) => c.id)).toEqual([OTHER]);
  expect(store.get().open).toBe(null);
  expect(store.get().updates).toEqual([]);
  expect(store.get().epoch).toBeGreaterThan(epoch);
  expect(store.gone(CHAT)).toBe(true);
  // A push or an answer that was on its way when it went brings nothing back.
  store.takeChat({ chat: summary({ updated: 99 }), updates: [up(2, "reply", { text: "late" })] });
  expect(store.get().chats.map((c) => c.id)).toEqual([OTHER]);
  // This window's own delete.
  await store.remove(OTHER);
  expect(store.get().chats).toEqual([]);
  expect(store.gone(OTHER)).toBe(true);
  // A chat deleted while the stream was shut: the list on reopening leaves it out.
  const third = "c1nvented-chat-0003";
  store.takeChat({ chat: summary({ id: third, updated: 7 }), updates: [] });
  listed = [];
  await store.resync();
  expect(store.get().chats).toEqual([]);
  expect(store.gone(third)).toBe(true);
});

test("THE KEPT CHOICES ARE READ on every open of the stream, and again after this window makes a chat, sets a picker or switches agent", async () => {
  let reads = 0;
  const { transport } = transportOf({
    "settings.read": () => { reads++; return { agent: "claude-acp", agents: { "claude-acp": { model: "b" } } }; },
    "chat.list": () => [], "agents.list": () => [],
    "chat.new": () => summary(), "chat.config": () => summary(), "chat.switchAgent": () => summary(),
  });
  const store = makeChatStore({ transport });
  expect(store.get().settings).toBe(null);
  await store.resync();
  expect(reads).toBe(1);
  expect(store.get().settings).toEqual({ agent: "claude-acp", agents: { "claude-acp": { model: "b" } } });
  await store.create({ agent: "claude-acp", text: "x" });
  await store.config(CHAT, "model", "b");
  await store.switchAgent(CHAT, "codex-acp");
  await new Promise((r) => setTimeout(r, 0));
  expect(reads).toBe(4);
});

test("an agent is Active or Inactive and nothing else, and only a sign-in or a Gateway gives it a button", () => {
  const words = ["checking", "installing", "signin", "gateway", "failed"].map((reason) => stateWords(/** @type {any} */ (agent({ state: "inactive", reason }))));
  expect(words).toEqual(["Inactive", "Inactive", "Inactive", "Inactive", "Inactive"]);
  expect(stateWords(/** @type {any} */ (agent()))).toBe("Active");
  expect(["checking", "installing", "signin", "gateway", "failed"].map((reason) => buttonOf(/** @type {any} */ (agent({ state: "inactive", reason })))))
    .toEqual([null, null, "signin", "gateway", null]);
});

test("a held message says what it waits for", () => {
  const signin = agent({ key: "claude-acp", state: "inactive", reason: "signin" });
  const other = agent({ key: "codex-acp", name: "Codex" });
  expect(waitingWords(/** @type {any} */ (summary({ phase: "held" })), /** @type {any} */ ([signin]))).toBe("Your message is waiting. Sign in to Claude Code and it goes out.");
  expect(waitingWords(/** @type {any} */ (summary({ phase: "held" })), /** @type {any} */ ([signin, other]))).toBe("Your message is waiting. Sign in to Claude Code, or pick another, and it goes out.");
  expect(waitingWords(/** @type {any} */ (summary({ phase: "held", agent: null, harness: null })), [])).toBe("Your message is waiting. Install an agent and it goes out.");
  expect(waitingWords(/** @type {any} */ (summary({ phase: "held" })), /** @type {any} */ ([agent({ state: "inactive", reason: "gateway", name: "OpenClaw" })]))).toContain("Start OpenClaw’s Gateway");
});

test("a new thread on the full screen is the start screen with the list opened, in the panel the start screen beside the page; a chat just made replaces the start screen's entry", () => {
  const ui = makeUi({ route: { view: "agent", id: CHAT, screen: "page" } });
  freshThread(ui);
  expect(ui.get().route).toEqual({ view: "agent", id: "", screen: "page" });
  expect(ui.get().chat).toBe(null);
  expect(ui.get().chatList).toBe(true);
  expect(ui.cause().mover).toEqual({ by: "you" });
  showChat(ui, OTHER, "made");
  expect(ui.get().route.id).toBe(OTHER);
  expect(ui.cause().replace).toBe(true);
  showChat(ui, CHAT, "open");
  expect(ui.cause().mover).toEqual({ by: "you" });

  const beside = makeUi({ route: { view: "page", id: "home", screen: "page" }, panel: true, chat: CHAT });
  freshThread(beside);
  expect(beside.get().route.view).toBe("page");
  expect(beside.get().chat).toBe(null);
  showChat(beside, OTHER, "made");
  expect(beside.get().chat).toBe(OTHER);
  expect(beside.get().route.view).toBe("page");
});

/* ── the bridge's answer to the look ───────────────────────────────────── */

/** The smallest store and transport the bridge reaches for on these kinds. */
function bridgeDoubles() {
  /** @type {any[]} */
  const calls = [];
  const pages = [{ id: "home", name: "Home" }];
  // The window's directory: the page it knows, and nothing more to ask for.
  const ws = { get: () => ({ pages, tables: [] }), refOf: (/** @type {string} */ id) => pages.find((p) => p.id === id) ?? null, want: async () => {} };
  const transport = { call: async (/** @type {any} */ req) => { calls.push(req); return { id: req.id, g: PROTOCOL, ok: true, value: null }; } };
  /** @type {any[]} */
  const opened = [];
  const ui = { open: (/** @type {any[]} */ ...a) => { opened.push(a); } };
  return { ws, transport, ui, calls, opened };
}

/** @param {string} kind @param {Record<string, unknown>} [body] */
const look = (kind, body = {}) => /** @type {any} */ ({ id: "l" + kind, g: PROTOCOL, kind, ...body });

test("THE LOOK'S KINDS ARE ANSWERED FOR THE @agent BOX ALONE: another page's box, or any box before the Agent screen registers, is refused", async () => {
  const d = bridgeDoubles();
  const bridge = makeBridge(/** @type {any} */ (d.ws), d.transport, d.ui, "", { now: () => 0, wait: async () => {} });
  const agentCtx = { page: AGENT_PAGE };
  const pageCtx = { page: "home" };
  bridge.touched?.(agentCtx);
  bridge.touched?.(pageCtx);
  // Nobody registered yet.
  expect(await bridge.resolve(look("look.list", { open: true }), agentCtx)).toMatchObject({ ok: false, error: { code: ERRORS.IDENTITY } });
  /** @type {any[]} */
  const asked = [];
  bridge.answerLook((req, ctx) => { asked.push([req.kind, ctx]); return null; });
  for (const [kind, body] of /** @type {[string, any][]} */ ([["look.open", { chat: CHAT }], ["look.new", {}], ["look.list", { open: true }], ["look.panel", { to: "screen" }], ["look.delete", { chat: CHAT }], ["look.unqueue", { chat: CHAT, queued: QUEUED }], ["look.sendNow", { chat: CHAT, queued: QUEUED }]])) {
    expect(await bridge.resolve(look(kind, body), pageCtx)).toMatchObject({ ok: false, error: { code: ERRORS.IDENTITY } });
  }
  expect(asked).toEqual([]);
  expect(await bridge.resolve(look("look.panel", { to: "screen" }), agentCtx)).toMatchObject({ ok: true, value: null });
  // The very context object the frame host handed over, so the answer can
  // tell its own box from another on the same page.
  expect(asked[0][1]).toBe(agentCtx);
  expect(d.calls).toEqual([]);
});

test("the look is answered only just after a touch from its box, the list included; a refusal carries its own code", async () => {
  let t = 0;
  const d = bridgeDoubles();
  const bridge = makeBridge(/** @type {any} */ (d.ws), d.transport, d.ui, "", { now: () => t, wait: async () => {} });
  const ctx = { page: AGENT_PAGE };
  /** @type {string[]} */
  const asked = [];
  bridge.answerLook((req) => { asked.push(req.kind); return req.kind === "look.open" ? { code: ERRORS.NOT_FOUND, message: "there is no such chat" } : null; });
  expect(await bridge.resolve(look("look.new"), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.IDENTITY } });
  expect(await bridge.resolve(look("look.list", { open: false }), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.IDENTITY } });
  bridge.touched?.(ctx);
  expect(await bridge.resolve(look("look.list", { open: false }), ctx)).toMatchObject({ ok: true });
  expect(await bridge.resolve(look("look.new"), ctx)).toMatchObject({ ok: true });
  expect(await bridge.resolve(look("look.open", { chat: CHAT }), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.NOT_FOUND, message: "there is no such chat" } });
  t = 5000;
  expect(await bridge.resolve(look("look.panel", { to: "beside" }), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.IDENTITY } });
  expect(asked).toEqual(["look.list", "look.new", "look.open"]);
  // Asking for a chat to be deleted is gated the same way: with no touch
  // from the box, the host is not even asked to put the question. So is Send
  // now, which stops the running turn: a look on a loop could otherwise stop
  // every turn the person starts while anything waits in the queue.
  expect(await bridge.resolve(look("look.delete", { chat: CHAT }), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.IDENTITY } });
  expect(await bridge.resolve(look("look.sendNow", { chat: CHAT, queued: QUEUED }), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.IDENTITY } });
  expect(asked).toEqual(["look.list", "look.new", "look.open"]);
  t = 5100;
  bridge.touched?.(ctx);
  expect(await bridge.resolve(look("look.sendNow", { chat: CHAT, queued: QUEUED }), ctx)).toMatchObject({ ok: true, value: null });
  expect(asked).toEqual(["look.list", "look.new", "look.open", "look.sendNow"]);
  // And it names the message by ids alone: words riding on it are refused.
  expect(await bridge.resolve(look("look.sendNow", { chat: CHAT, queued: QUEUED, text: "Invented instruction" }), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.UNKNOWN_KIND } });
  // A field the guard does not name never gets as far as the answer.
  expect(await bridge.resolve(look("look.new", { text: "Invented instruction" }), ctx)).toMatchObject({ ok: false, error: { code: ERRORS.UNKNOWN_KIND } });
  expect(d.calls).toEqual([]);
});

test("a page the look opens comes up with the chat beside it; a page another box opens does not", async () => {
  const d = bridgeDoubles();
  const bridge = makeBridge(/** @type {any} */ (d.ws), d.transport, d.ui, "", { now: () => 0, wait: async () => {} });
  const lookCtx = { page: AGENT_PAGE };
  const pageCtx = { page: "home" };
  bridge.touched?.(lookCtx);
  bridge.touched?.(pageCtx);
  await bridge.resolve(look("open", { target: { kind: "page", id: "home" } }), lookCtx);
  await bridge.resolve(look("open", { target: { kind: "page", id: "home" } }), pageCtx);
  expect(d.opened).toEqual([["page", "home", undefined, true], ["page", "home", undefined, undefined]]);
});

/* ── the view ──────────────────────────────────────────────────────────── */

/** A recording element, shaped like the parts of the DOM the view touches. */
function element(tag) {
  /** @type {Record<string, any[]>} */
  const listeners = {};
  /** @type {Record<string, string>} */
  const attrs = {};
  /** @type {Record<string, string>} */
  const props = {};
  /** @type {any} */
  const el = {
    tagName: tag.toUpperCase(), attrs, props, listeners, children: /** @type {any[]} */ ([]), parentElement: null, hidden: false, textContent: "",
    style: { setProperty: (/** @type {string} */ k, /** @type {string} */ v) => { props[k] = v; } },
    setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => { attrs[k] = String(v); },
    getAttribute: (/** @type {string} */ k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (/** @type {string} */ k) => { delete attrs[k]; },
    addEventListener: (/** @type {string} */ k, /** @type {any} */ fn) => { (listeners[k] ||= []).push(fn); },
    append: (/** @type {any[]} */ ...kids) => { for (const k of kids) { if (k && typeof k === "object") { k.parentElement = el; k.moved = (k.moved ?? 0) + 1; } el.children.push(k); } },
    getBoundingClientRect: () => ({ width: 460, height: 700, top: 0, bottom: 700, left: 0, right: 460 }),
    releasePointerCapture() {}, setPointerCapture() {},
    /** @param {string} name @param {any} ev */
    fire(name, ev) { for (const fn of listeners[name] || []) fn(ev); },
  };
  return el;
}

/** @param {string} spec @param {any} [props] @param {...any} kids */
function h(spec, props, ...kids) {
  const [head, ...classes] = String(spec).split(".");
  const el = element(head.split("#")[0] || "div");
  el.className = classes.join(" ");
  if (props && props.constructor === Object) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  } else if (props !== undefined) kids.unshift(props);
  el.append(...kids.filter((k) => k != null));
  return el;
}

const PAGES = [{ id: "home", name: "Home", uid: "u1nvented-home" }, { id: "home/Specs", name: "Specs", uid: "u1nvented-specs" }];

/** The Agent screen, stood up against doubles. */
async function stand(/** @type {{ route?: any, panel?: boolean, chat?: string | null, chatList?: boolean, confirm?: (q: any) => Promise<boolean>, answers?: Record<string, (req: any) => any>, known?: any[] }} */ at = {}) {
  /** @type {any[]} */
  const frames = [];
  /** @type {any[]} */
  const posted = [];
  /** @type {any[]} */
  const mounts = [];
  const frameHost = {
    for(/** @type {string} */ key, /** @type {string} */ html, /** @type {any} */ ctx) {
      const el = element("iframe");
      const frame = { el, post: (/** @type {any} */ ev) => posted.push(ev), drop() {} };
      mounts.push({ key, html, ctx, frame });
      return frame;
    },
    broadcast() { throw new Error("broadcast"); },
    setShim() {}, drop() {}, refresh() {}, compliance: () => null, keep() {},
  };
  const { transport, calls } = transportOf({
    "page.read": (req) => ({ id: req.page, name: "Agent", plugin: "biom-agent", html: "<!doctype html><html><head></head><body><main id=\"g-agent\"></main></body></html>", input: {} }),
    "chat.read": (req) => ({ chat: summary({ id: req.chat }), updates: [up(1, "prompt", { text: "Invented" })] }),
    ...(at.answers ?? {}),
  });
  const chats = makeChatStore({ transport });
  chats.takeChat({ chat: summary(), updates: [] });
  chats.takeChat({ chat: summary({ id: OTHER, updated: 5 }), updates: [] });
  const ui = makeUi({ route: at.route ?? { view: "agent", id: "", screen: "page" }, panel: at.panel ?? false, chat: at.chat ?? null, chatList: at.chatList ?? false });
  /** @type {any[]} */
  const said = [];
  const input = {
    el: element("div"),
    sync() {},
    measure: () => ({ at: /** @type {const} */ (ui.get().chat === null ? "center" : "bottom"), height: 90 }),
    onMove: () => () => {},
    forPage: (/** @type {any} */ page) => said.push(["forPage", page]),
    focus: () => said.push(["focus"]),
    fresh: () => said.push(["fresh"]),
    say: (/** @type {string} */ words) => said.push(["say", words]),
  };
  /** @type {(() => void)[]} */
  const raf = [];
  const win = /** @type {any} */ ({ addEventListener() {}, innerWidth: 1400, requestAnimationFrame: (/** @type {() => void} */ fn) => { raf.push(fn); } });
  const history = { get: () => /** @type {any[]} */ ([{ entry: { kind: "view", window: "w1nvented-window", place: { view: "page", uid: "u1nvented-specs", screen: "page" } } }]), on: () => () => {} };
  // THE WINDOW'S DIRECTORY, as far as the look reads it: the pages it knows,
  // and `want` recording what was asked for by name.
  const known = [...(at.known ?? PAGES)];
  /** @type {Set<() => void>} */
  const wsHears = new Set();
  /** @type {any[]} */
  const wanted = [];
  let knownView = [...known];
  const ws = {
    get: () => ({ pages: knownView }),
    on: (/** @type {() => void} */ fn) => { wsHears.add(fn); return () => { wsHears.delete(fn); }; },
    refOf: (/** @type {string} */ id) => known.find((p) => p.id === id) ?? null,
    idOfUid: (/** @type {string} */ uid) => known.find((p) => p.uid === uid)?.id ?? null,
    want: async (/** @type {any} */ q) => { wanted.push(q); },
    /** The directory learning a page, and the store's emit. @param {any} ref */
    learn(ref) { known.push(ref); knownView = [...known]; for (const fn of [...wsHears]) fn(); },
  };
  const view = makeAgentView({
    h, frameHost: /** @type {any} */ (frameHost), ui, ws: /** @type {any} */ (ws),
    chats, switcher: null, history: /** @type {any} */ (history), window: "w1nvented-window", input, vault: "/invented/vault", win,
    ...(at.confirm ? { confirm: at.confirm } : {}),
  });
  // The look's document is read, and the box mounted.
  for (let i = 0; i < 20 && mounts.length === 0; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  const frame = () => mounts[mounts.length - 1]?.frame;
  const hello = () => view.slot.fire("biom:notice", { detail: { kind: "hello" }, target: frame().el });
  const tick = () => { for (const fn of raf.splice(0)) fn(); };
  return { view, ui, chats, posted, mounts, frame, hello, tick, said, calls, ws, wanted };
}

test("A PAGE THE LOOK NAMES THAT THE WINDOW DOES NOT KNOW is asked for by uid, and its name arrives as a patch when the answer lands", async () => {
  const s = await stand({ route: { view: "agent", id: "", screen: "page" } });
  s.chats.takeChat({ chat: summary({ id: OTHER, updated: 30, page: { view: "page", uid: "u1nvented-new", screen: "page" } }), updates: [] });
  s.hello();
  const state = s.posted.find((p) => p.kind === "look.state");
  expect(state.state.names["u1nvented-new"]).toBeUndefined();
  expect(s.wanted.flatMap((q) => q.uids ?? [])).toContain("u1nvented-new");
  s.posted.length = 0;
  s.ws.learn({ id: "home/New", name: "Invented new", uid: "u1nvented-new" });
  s.tick();
  const patch = s.posted.find((p) => p.kind === "look.patch" && p.names);
  expect(patch?.names["u1nvented-new"]).toEqual({ id: "home/New", name: "Invented new" });
});

test("the look's box is mounted once, under a key no page view mounts, with a context it alone holds, and is appended once", async () => {
  const s = await stand();
  expect(s.mounts.length).toBe(1);
  expect(s.mounts[0].key).toBe(LOOK_KEY);
  expect(s.mounts[0].key).not.toBe(AGENT_PAGE);
  expect(s.mounts[0].ctx).toEqual({ page: AGENT_PAGE });
  expect(s.frame().el.moved).toBe(1);
  // A box with the same page but not the context the view mounted is refused.
  expect(s.view.answer(/** @type {any} */ (look("look.list", { open: true })), { page: AGENT_PAGE })).toMatchObject({ code: ERRORS.IDENTITY });
  expect(s.view.answer(/** @type {any} */ (look("look.list", { open: true })), s.mounts[0].ctx)).toBe(null);
  expect(s.ui.get().chatList).toBe(true);
});

test("hello is answered with the whole state through that box's own post, and nothing is broadcast", async () => {
  const s = await stand({ route: { view: "agent", id: "", screen: "page" } });
  expect(s.posted).toEqual([]);
  s.hello();
  expect(s.posted.length).toBe(1);
  const st = s.posted[0];
  expect(st.kind).toBe("look.state");
  expect(st.state).toMatchObject({ mode: "screen", chat: null, list: false, updates: [], input: { at: "center", height: 90 }, beside: { id: "home/Specs", name: "Specs" } });
  expect(st.state.chats.map((/** @type {any} */ c) => c.id)).toEqual([CHAT, OTHER]);
  // The whole of it: how the chat is drawn is the look's, so no view rides along.
  expect(Object.keys(st.state).sort()).toEqual(["beside", "chat", "chats", "input", "list", "mode", "names", "updates"]);
});

test("another chat is handed over whole once its stream is read; the stream after it goes as patches, coalesced to one a frame", async () => {
  const s = await stand();
  s.hello();
  s.view.answer(/** @type {any} */ (look("look.open", { chat: CHAT })), s.mounts[0].ctx);
  expect(s.ui.get().route).toEqual({ view: "agent", id: CHAT, screen: "page" });
  await new Promise((r) => setTimeout(r, 0));
  const state = s.posted.filter((p) => p.kind === "look.state").at(-1);
  expect(state.state.chat).toBe(CHAT);
  expect(state.state.updates.map((/** @type {any} */ u) => u.kind)).toEqual(["prompt"]);
  s.posted.length = 0;
  s.chats.takeChat({ chat: summary({ updated: 11, phase: "running", light: "working" }), updates: [up(2, "turn", { phase: "running", stop: null, reason: null })] });
  s.chats.takeChat({ chat: summary({ updated: 12, phase: "running", light: "working" }), updates: [up(3, "reply", { text: "a" })] });
  s.chats.takeChat({ chat: summary({ updated: 13, phase: "running", light: "working" }), updates: [up(4, "reply", { text: "b" })] });
  expect(s.posted).toEqual([]);
  s.tick();
  expect(s.posted.length).toBe(1);
  expect(s.posted[0]).toMatchObject({ kind: "look.patch", chat: CHAT });
  expect(s.posted[0].updates.map((/** @type {any} */ u) => u.seq)).toEqual([2, 3, 4]);
  expect(s.posted[0].chats[0].light).toBe("working");
  // A chat in the background streaming changes the list and adds no words.
  s.posted.length = 0;
  s.chats.takeChat({ chat: summary({ id: OTHER, updated: 14, light: "working", phase: "running" }), updates: [up(9, "reply", { text: "not this chat's" })] });
  s.tick();
  expect(s.posted[0].updates).toBeUndefined();
  expect(s.posted[0].chats.map((/** @type {any} */ c) => c.id)).toEqual([OTHER, CHAT]);
});

test("A LOOK ASKING TO DELETE A CHAT GETS BIOM'S OWN QUESTION, and only the person's Delete there deletes it: Cancel, and no answer at all, delete nothing", async () => {
  /** @type {any[]} */
  const asked = [];
  /** @type {((yes: boolean) => void)[]} */
  const answers = [];
  const s = await stand({
    confirm: (q) => { asked.push(q); return new Promise((r) => answers.push(r)); },
    answers: { "chat.delete": () => null },
  });
  s.hello();
  const ctx = s.mounts[0].ctx;
  const deletes = () => s.calls.filter((c) => c.kind === "chat.delete");
  // Asked: the question, and nothing deleted while it is unanswered.
  expect(s.view.answer(/** @type {any} */ (look("look.delete", { chat: OTHER })), ctx)).toBe(null);
  expect(asked).toEqual([{ title: "Delete this chat?", line: "It can’t be undone.", yes: "Delete", no: "Cancel" }]);
  await new Promise((r) => setTimeout(r, 0));
  expect(deletes()).toEqual([]);
  // Cancel: nothing.
  answers.shift()?.(false);
  await new Promise((r) => setTimeout(r, 0));
  expect(deletes()).toEqual([]);
  expect(s.chats.get().chats.map((c) => c.id)).toEqual([CHAT, OTHER]);
  // A look asking again and again gets a question each time, and no deletion.
  for (let i = 0; i < 3; i++) s.view.answer(/** @type {any} */ (look("look.delete", { chat: OTHER })), ctx);
  await new Promise((r) => setTimeout(r, 0));
  expect(asked.length).toBe(4);
  expect(deletes()).toEqual([]);
  // Delete: the chat, by its id, once.
  answers.pop()?.(true);
  await new Promise((r) => setTimeout(r, 0));
  expect(deletes().map((c) => c.chat)).toEqual([OTHER]);
  expect(s.chats.get().chats.map((c) => c.id)).toEqual([CHAT]);
  // A chat nobody has is refused, and asks nothing.
  expect(s.view.answer(/** @type {any} */ (look("look.delete", { chat: "c1nvented-no-such-chat" })), ctx)).toMatchObject({ code: ERRORS.NOT_FOUND });
  expect(asked.length).toBe(4);
});

test("a look.delete from anything but the Agent screen's own box is refused, and one with no question to ask deletes nothing", async () => {
  const s = await stand({ answers: { "chat.delete": () => null } });
  expect(s.view.answer(/** @type {any} */ (look("look.delete", { chat: CHAT })), { page: AGENT_PAGE })).toMatchObject({ code: ERRORS.IDENTITY });
  expect(s.view.answer(/** @type {any} */ (look("look.delete", { chat: CHAT })), s.mounts[0].ctx)).toMatchObject({ code: "unsupported" });
  await new Promise((r) => setTimeout(r, 0));
  expect(s.calls.filter((c) => c.kind === "chat.delete")).toEqual([]);
});

test("THE CHAT ON SCREEN DELETED — here or in another window — sends the full screen to the start screen and shuts the panel", async () => {
  const s = await stand({ route: { view: "agent", id: CHAT, screen: "page" }, chat: CHAT });
  await new Promise((r) => setTimeout(r, 0));
  s.chats.takeChat({ chat: summary(), updates: [], deleted: true });
  expect(s.ui.get().route).toEqual({ view: "agent", id: "", screen: "page" });
  expect(s.ui.get().chat).toBe(null);
  expect(s.chats.get().chats.map((c) => c.id)).toEqual([OTHER]);
  // Beside a page.
  const p = await stand({ route: { view: "page", id: "home/Specs", screen: "page" }, panel: true, chat: OTHER });
  await new Promise((r) => setTimeout(r, 0));
  p.chats.takeChat({ chat: summary({ id: OTHER }), updates: [], deleted: true });
  expect(p.ui.get()).toMatchObject({ chat: null, panel: false, route: { view: "page", id: "home/Specs", screen: "page" } });
  // Another chat deleted elsewhere moves nothing.
  const q = await stand({ route: { view: "agent", id: CHAT, screen: "page" }, chat: CHAT });
  await new Promise((r) => setTimeout(r, 0));
  q.chats.takeChat({ chat: summary({ id: OTHER }), updates: [], deleted: true });
  expect(q.ui.get().route.id).toBe(CHAT);
});

test("a queued message's × takes it out through the chat store, for the look's own box alone", async () => {
  const s = await stand({ answers: { "chat.unqueue": () => summary({ queued: 0 }) } });
  expect(s.view.answer(/** @type {any} */ (look("look.unqueue", { chat: CHAT, queued: "q1nvented-queued-01" })), { page: AGENT_PAGE })).toMatchObject({ code: ERRORS.IDENTITY });
  expect(s.view.answer(/** @type {any} */ (look("look.unqueue", { chat: CHAT, queued: "q1nvented-queued-01" })), s.mounts[0].ctx)).toBe(null);
  await new Promise((r) => setTimeout(r, 0));
  expect(s.calls.filter((c) => c.kind === "chat.unqueue").map((c) => [c.chat, c.queued])).toEqual([[CHAT, "q1nvented-queued-01"]]);
  expect(s.view.answer(/** @type {any} */ (look("look.unqueue", { chat: "c1nvented-no-such-chat", queued: "q1nvented-queued-01" })), s.mounts[0].ctx)).toMatchObject({ code: ERRORS.NOT_FOUND });
});

test("a flood too big for a patch is handed over whole instead", async () => {
  const s = await stand({ route: { view: "agent", id: CHAT, screen: "page" } });
  await new Promise((r) => setTimeout(r, 0));
  s.hello();
  s.posted.length = 0;
  const many = Array.from({ length: PATCH_MAX + 5 }, (_, i) => up(i + 10, "reply", { text: "x" }));
  s.chats.takeChat({ chat: summary({ updated: 20 }), updates: many });
  s.tick();
  expect(s.posted.map((p) => p.kind)).toEqual(["look.state"]);
  // Held folded: a run of chunks is one update, not thousands.
  expect(s.posted[0].state.updates.map((/** @type {any} */ u) => u.kind)).toEqual(["prompt", "reply"]);
  expect(s.posted[0].state.updates[1].text.length).toBe(many.length);
});

test("THE LOOK NEVER MOVES THE CARET out of wherever the person is: only the rail's Agent does", async () => {
  const s = await stand({ route: { view: "agent", id: "", screen: "page" } });
  const ctx = s.mounts[0].ctx;
  s.view.answer(/** @type {any} */ (look("look.open", { chat: CHAT })), ctx);
  s.view.answer(/** @type {any} */ (look("look.new")), ctx);
  s.ui.open("page", "home", "page", true);
  s.view.answer(/** @type {any} */ (look("look.panel", { to: "screen" })), ctx);
  expect(s.said.filter((x) => x[0] === "focus")).toEqual([]);
  s.view.open();
  expect(s.said.filter((x) => x[0] === "focus")).toEqual([["focus"]]);
});

test("a chat come back to after another is handed over whole again, not patched across what it missed", async () => {
  const s = await stand({ route: { view: "agent", id: CHAT, screen: "page" } });
  await new Promise((r) => setTimeout(r, 0));
  s.hello();
  const states = () => s.posted.filter((p) => p.kind === "look.state").length;
  const before = states();
  s.ui.open("agent", OTHER);
  s.ui.open("agent", CHAT);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  expect(states()).toBeGreaterThan(before);
  expect(s.posted.filter((p) => p.kind === "look.state").at(-1).state.chat).toBe(CHAT);
});

test("a new thread leaves the list as it was; the panel goes to the screen, beside the last page, or shut", async () => {
  const s = await stand({ route: { view: "agent", id: CHAT, screen: "page" }, chatList: true });
  const ctx = s.mounts[0].ctx;
  expect(s.view.answer(/** @type {any} */ (look("look.new")), ctx)).toBe(null);
  expect(s.ui.get().route.id).toBe("");
  expect(s.ui.get().chatList).toBe(true);
  expect(s.said).toContainEqual(["fresh"]);

  s.ui.set({ chat: CHAT });
  expect(s.view.answer(/** @type {any} */ (look("look.panel", { to: "beside" })), ctx)).toBe(null);
  expect(s.ui.get().route).toEqual({ view: "page", id: "home/Specs", screen: "page" });
  expect(s.ui.get().panel).toBe(true);
  expect(s.ui.get().chat).toBe(CHAT);

  // In the panel a chat opened stays in the panel; the page does not move.
  expect(s.view.answer(/** @type {any} */ (look("look.open", { chat: OTHER })), ctx)).toBe(null);
  expect(s.ui.get().route.view).toBe("page");
  expect(s.ui.get().chat).toBe(OTHER);
  expect(s.view.answer(/** @type {any} */ (look("look.open", { chat: "c1nvented-chat-none" })), ctx)).toMatchObject({ code: ERRORS.NOT_FOUND });

  expect(s.view.answer(/** @type {any} */ (look("look.panel", { to: "screen" })), ctx)).toBe(null);
  expect(s.ui.get().route).toEqual({ view: "agent", id: OTHER, screen: "page" });
  expect(s.ui.get().panel).toBe(false);

  s.ui.open("page", "home", "page", true);
  expect(s.view.answer(/** @type {any} */ (look("look.panel", { to: "closed" })), ctx)).toBe(null);
  expect(s.ui.get().panel).toBe(false);
  expect(s.ui.get().route.id).toBe("home");
});

test("Edit opens a new chat beside the page, the input made ready for that page with nothing typed; the rail's Agent goes to the full screen with the chat last open", async () => {
  const s = await stand({ route: { view: "page", id: "home/Specs", screen: "page" }, chat: CHAT });
  s.view.edit("home/Specs");
  expect(s.ui.get()).toMatchObject({ panel: true, chat: null });
  expect(s.ui.get().route.id).toBe("home/Specs");
  expect(s.said).toContainEqual(["forPage", "home/Specs"]);
  s.ui.set({ chat: OTHER });
  s.view.open();
  expect(s.ui.get().route).toEqual({ view: "agent", id: OTHER, screen: "page" });
  expect(s.ui.get().panel).toBe(false);
  expect(s.ui.cause().mover).toEqual({ by: "you" });
});

test("the slot's shape follows the window: the screen, the panel, or nothing", async () => {
  const s = await stand({ route: { view: "page", id: "home", screen: "page" } });
  expect(s.view.slot.getAttribute("data-mode")).toBe("none");
  // Nothing is mounted until the Agent screen is first shown.
  expect(s.mounts.length).toBe(0);
  s.ui.set({ panel: true });
  expect(s.view.slot.getAttribute("data-mode")).toBe("panel");
  await new Promise((r) => setTimeout(r, 0));
  expect(s.mounts.length).toBe(1);
  expect(s.view.slot.props["--look-head"]).toBe("46px");
  s.ui.open("agent", CHAT);
  expect(s.view.slot.getAttribute("data-mode")).toBe("screen");
  expect(s.view.slot.props["--look-threads"]).toBe("268px");
  expect(s.view.slot.props["--look-head"]).toBe("0px");
  // The box never moved while the shape did.
  expect(s.frame().el.moved).toBe(1);
});

test("the chrome hears a chat start and end work, and not every word it streams", async () => {
  const s = await stand();
  let heard = 0;
  s.view.onChrome(() => heard++);
  s.chats.takeChat({ chat: summary({ updated: 20, light: "working", phase: "running" }), updates: [] });
  expect(s.view.chrome().busy).toBe(1);
  expect(heard).toBe(1);
  s.chats.takeChat({ chat: summary({ updated: 21, light: "working", phase: "running" }), updates: [] });
  s.chats.takeChat({ chat: summary({ updated: 22, light: "working", phase: "running" }), updates: [] });
  expect(heard).toBe(1);
  s.chats.takeChat({ chat: summary({ updated: 23, light: "done", phase: "idle", stop: "end_turn" }), updates: [] });
  expect(s.view.chrome().busy).toBe(0);
  expect(heard).toBe(2);
});
