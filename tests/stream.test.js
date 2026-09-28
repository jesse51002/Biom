// SPDX-License-Identifier: AGPL-3.0-only
// THE TRANSPORT'S HALF OF THE WINDOW AND THE STREAM: `client/transport/http.js`
// writing this window's id onto every call, `events.js` handing up a named
// event's data and saying every time it opens, and `chat.js` turning the three
// JSON events into the shapes the contract says they carry.
//
// There is no network here: `fetch` and `EventSource` are stood in for, and
// what is asserted is what left and what was heard. Ids and entries are
// invented.

import { test, expect, afterEach } from "bun:test";

import { makeHttp } from "../client/transport/http.js";
import { makeEvents } from "../client/transport/events.js";
import { decodeStream, isHistoryEntry, makeChatStream } from "../client/transport/chat.js";

const WINDOW = "window-0001-invented";
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
const realSource = g.EventSource;

afterEach(() => {
  g.fetch = realFetch;
  if (realSource === undefined) delete g.EventSource; else g.EventSource = realSource;
});

/* ── the window on the envelope ────────────────────────────────────────── */

/** A fetch that records the body it was given and answers ok. */
function recordFetch() {
  /** @type {any[]} */
  const sent = [];
  g.fetch = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    return { status: 200, json: async () => ({ id: body.id, g: 1, ok: true, value: null }) };
  };
  return sent;
}

test("every call leaves with this window's id, written over whatever the request carried", async () => {
  const sent = recordFetch();
  const http = makeHttp("", null, WINDOW);
  await http.call({ id: "a", g: 1, kind: "vault.info" });
  await http.call(/** @type {any} */ ({ id: "b", g: 1, kind: "vault.info", window: "someone-else-000" }));
  expect(sent.map((b) => b.window)).toEqual([WINDOW, WINDOW]);
});

test("with no window, a window a request carried is taken off rather than passed on", async () => {
  const sent = recordFetch();
  const http = makeHttp("", null);
  await http.call(/** @type {any} */ ({ id: "a", g: 1, kind: "vault.info", window: "someone-else-000" }));
  await http.call({ id: "b", g: 1, kind: "vault.info" });
  expect(sent.map((b) => "window" in b)).toEqual([false, false]);
});

/* ── the stream ────────────────────────────────────────────────────────── */

/** An EventSource that records what was listened for and can be told to fire. */
function fakeSources() {
  /** @type {any[]} */
  const made = [];
  g.EventSource = class {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      /** @type {Map<string, Function[]>} */
      this.listeners = new Map();
      this.closed = false;
      made.push(this);
    }
    /** @param {string} name @param {Function} fn */
    addEventListener(name, fn) {
      const list = this.listeners.get(name) ?? [];
      list.push(fn);
      this.listeners.set(name, list);
    }
    close() { this.closed = true; }
    /** @param {string} name @param {unknown} [data] */
    fire(name, data) { for (const fn of this.listeners.get(name) ?? []) fn({ data }); }
  };
  return made;
}

test("a named event's raw data reaches its listeners, and only its own", () => {
  const made = fakeSources();
  const events = makeEvents("/v/x", "?window=" + WINDOW);
  /** @type {string[]} */
  const history = [];
  /** @type {string[]} */
  const chat = [];
  events.onNamed("history", (d) => history.push(d));
  events.onNamed("chat", (d) => chat.push(d));
  expect(made).toHaveLength(1);
  expect(made[0].url).toBe("/v/x/events?window=" + WINDOW);

  made[0].fire("history", "[1]");
  made[0].fire("chat", "{}");
  made[0].fire("agents", "[]");
  expect(history).toEqual(["[1]"]);
  expect(chat).toEqual(["{}"]);
});

test("a name first asked for after the stream opened is still heard, and a listener that throws stops nobody", () => {
  const made = fakeSources();
  const events = makeEvents("/v/x");
  events.on(() => {});
  /** @type {string[]} */
  const heard = [];
  events.onNamed("agents", () => { throw new Error("a listener that throws"); });
  events.onNamed("agents", (d) => heard.push(d));
  const warn = console.warn;
  console.warn = () => {};
  try { made[0].fire("agents", "[]"); } finally { console.warn = warn; }
  expect(heard).toEqual(["[]"]);
});

test("onOpen hears every open, the first included; the change listeners hear only a reconnect", () => {
  const made = fakeSources();
  const events = makeEvents("/v/x");
  let opens = 0;
  let changes = 0;
  events.onOpen(() => opens++);
  events.on(() => changes++);
  made[0].fire("open");
  expect([opens, changes]).toEqual([1, 0]);
  made[0].fire("open");
  expect([opens, changes]).toEqual([2, 1]);
});

test("the stream closes when the last listener of any kind lets go", () => {
  const made = fakeSources();
  const events = makeEvents("/v/x");
  const a = events.onNamed("history", () => {});
  const b = events.onOpen(() => {});
  a();
  expect(made[0].closed).toBe(false);
  b();
  expect(made[0].closed).toBe(true);
});

test("a tab with no folder opens nothing", () => {
  const made = fakeSources();
  const events = makeEvents("");
  events.onNamed("history", () => {});
  events.onOpen(() => {});
  expect(made).toHaveLength(0);
});

/* ── the three JSON events ─────────────────────────────────────────────── */

const PAGE_PLACE = { view: "page", uid: "u-notes-invented", screen: "page" };
const OPEN = { kind: "open", seq: 1, at: 10, window: WINDOW, place: PAGE_PLACE, writer: { kind: "you", window: WINDOW } };
const EDIT = {
  kind: "edit", seq: 2, at: 11, place: PAGE_PLACE, path: "pages/notes/content.yaml", via: "fs", snapshot: null,
  writer: { kind: "agent", agent: "agent-0001-invented", chat: "chat-0001-invented", harness: "Claude Code", turn: 1 },
};
const TABLE_EDIT = { ...EDIT, seq: 3, place: { view: "table", id: "jobs" }, path: null, via: "app", writer: { kind: "you", window: WINDOW } };

test("a history entry is checked whole", () => {
  expect(isHistoryEntry(OPEN)).toBe(true);
  expect(isHistoryEntry(EDIT)).toBe(true);
  expect(isHistoryEntry(TABLE_EDIT)).toBe(true);
  expect(isHistoryEntry({ ...EDIT, place: null })).toBe(true);
  for (const bad of [
    { ...OPEN, seq: 0 }, { ...OPEN, seq: 1.5 }, { ...OPEN, kind: "look" }, { ...OPEN, place: null },
    { ...OPEN, window: "" }, { ...OPEN, writer: { kind: "someone" } }, { ...OPEN, place: { view: "page", uid: "", screen: "page" } },
    { ...OPEN, place: { view: "theme", id: "" } }, { ...EDIT, via: "magic" }, { ...EDIT, snapshot: undefined },
    { ...EDIT, writer: { ...EDIT.writer, turn: "one" } }, null, [], "entry",
  ]) {
    expect(isHistoryEntry(bad)).toBe(false);
  }
});

test("each named event decodes to what the contract says it carries, or to nothing", () => {
  expect(decodeStream("history", JSON.stringify([OPEN, EDIT]))).toEqual({ event: "history", data: [OPEN, EDIT] });
  // ONE BAD ENTRY DROPS THE BATCH: a reader that tracks seq would take a batch
  // with a hole in it as complete.
  expect(decodeStream("history", JSON.stringify([OPEN, { ...EDIT, via: "magic" }]))).toBe(null);
  expect(decodeStream("history", "not json")).toBe(null);
  expect(decodeStream("history", "{}")).toBe(null);

  const push = { chat: { id: "chat-0001-invented", name: "A chat" }, updates: [{ seq: 1, at: 1, turn: 1, kind: "prompt", text: "hi" }] };
  expect(decodeStream("chat", JSON.stringify(push))).toEqual({ event: "chat", data: push });
  expect(decodeStream("chat", JSON.stringify({ chat: {}, updates: [] }))).toBe(null);
  expect(decodeStream("chat", JSON.stringify({ ...push, updates: [{ kind: "prompt" }] }))).toBe(null);

  expect(decodeStream("agents", JSON.stringify([{ key: "claude-acp", name: "Claude Code" }]))).toEqual({ event: "agents", data: [{ key: "claude-acp", name: "Claude Code" }] });
  expect(decodeStream("agents", JSON.stringify([{ name: "no key" }]))).toBe(null);

  // The twelfth edit: `change` names what changed, ids only; anything else —
  // a bare `1` from before the edit, text that is not JSON — is `all`.
  expect(decodeStream("change", JSON.stringify({ pages: ["home/Specs"], levels: ["home"] })))
    .toEqual({ event: "change", data: { pages: ["home/Specs"], levels: ["home"] } });
  expect(decodeStream("change", JSON.stringify({ pages: [], levels: [], all: true })))
    .toEqual({ event: "change", data: { pages: [], levels: [], all: true } });
  expect(decodeStream("change", "1")).toEqual({ event: "change", data: { pages: [], levels: [], all: true } });
  expect(decodeStream("change", "not json")).toEqual({ event: "change", data: { pages: [], levels: [], all: true } });
  expect(decodeStream("change", JSON.stringify({ pages: [3], levels: [] }))).toEqual({ event: "change", data: { pages: [], levels: [], all: true } });
  expect(decodeStream("run", "")).toEqual({ event: "run", data: 1 });
  expect(decodeStream("nonsense", "[]")).toBe(null);
});

test("the chat stream hands each listener its own event, decoded, and drops what does not parse", () => {
  /** @type {Map<string, (data: string) => void>} */
  const named = new Map();
  const stream = makeChatStream({ onNamed: (name, hear) => { named.set(name, hear); return () => named.delete(name); } });
  /** @type {any[]} */
  const got = [];
  stream.onHistory((entries) => got.push(["history", entries.length]));
  stream.onChat((push) => got.push(["chat", push.chat.id]));
  stream.onAgents((agents) => got.push(["agents", agents.length]));

  const warn = console.warn;
  /** @type {string[]} */
  const said = [];
  console.warn = (m) => said.push(String(m));
  try {
    named.get("history")?.(JSON.stringify([OPEN]));
    named.get("history")?.("{ broken");
    named.get("chat")?.(JSON.stringify({ chat: { id: "chat-0001-invented" }, updates: [] }));
    named.get("agents")?.(JSON.stringify([]));
  } finally {
    console.warn = warn;
  }
  expect(got).toEqual([["history", 1], ["chat", "chat-0001-invented"], ["agents", 0]]);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain("history");
});
