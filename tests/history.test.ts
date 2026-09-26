// SPDX-License-Identifier: AGPL-3.0-only
// THE HISTORY, SERVER SIDE — `server/domain/history.ts`, for the workspace's
// *History and View Switcher* spec: the order entries are appended in, the
// ring they are kept in, a page named by its `uid`, what a window's report
// appends and when its context goes, typing coalesced into one edit per
// burst, one agent write reported twice recorded once, and the address table
// every edit's place comes from. Every page id, uid, window, chat and agent
// here is invented and says nothing about any real workspace.

import { test, expect } from "bun:test";

import { addressOfPath, makeHistory, normalPath, placeOfPath } from "../server/domain/history.ts";
import type { EditReport, History, HistoryDeps } from "../server/domain/history.ts";
import { pageDir, PAGE_DOC } from "../server/domain/pages.ts";
import { pageAt } from "../server/domain/mirror.ts";
import { address } from "../contracts/address.js";
import type { AgentId, ChatId, PageId, Place, WindowReport, Writer } from "../contracts/types.ts";

/* ── the world ──────────────────────────────────────────────────────────── */

/** Invented: three pages and their uids, as the disk would answer them. */
const UIDS: Record<PageId, string> = {
  home: "uidhome0001",
  "home/Specs": "uidspecs0002",
  "home/Specs/Chat": "uidchat00003",
};

const W1 = "window-one-0001";
const W2 = "window-two-0002";
const CHAT = "chat-invented-01";
const AGENT = "agent-invented-01";

function world(over: Partial<HistoryDeps> & { uids?: Record<PageId, string> } = {}) {
  let clock = 1_000_000;
  const uids = { ...(over.uids ?? UIDS) };
  const chats = new Map<ChatId, { agent: AgentId; harness: string; turn: number }>([[CHAT, { agent: AGENT, harness: "Claude Code", turn: 1 }]]);
  const deps: HistoryDeps = {
    now: () => clock,
    uidOf: async (id) => uids[id] ?? null,
    agentOfChat: (chat) => chats.get(chat) ?? null,
    ...over,
  };
  const history = makeHistory(deps);
  return {
    history,
    uids,
    chats,
    tick: (ms: number) => { clock += ms; },
  };
}

const you = (window = W1): Writer => ({ kind: "you", window });
const agent = (turn = 1, id: AgentId = AGENT, chat: ChatId = CHAT): Writer => ({ kind: "agent", agent: id, chat, harness: "Claude Code", turn });
const doc = (id: PageId) => `${pageDir(id)}/${PAGE_DOC}`;
const page = (uid: string, screen: "page" | "instructions" | "automation" = "page"): Place => ({ view: "page", uid, screen });
const report = (id: PageId, over: Partial<WindowReport> = {}): WindowReport => ({ address: address("page", id), panel: false, chat: null, agent: null, ...over });
const seqs = (h: History, since?: number) => h.read(since).entries.map((e) => e.seq);

/* ── order, since, the ring ─────────────────────────────────────────────── */

test("seq counts from 1 in the order calls were MADE, even when a later lookup finishes first", async () => {
  // The first page's uid takes a while to read; the second's is instant.
  let release!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  const w = world({
    uidOf: async (id) => {
      if (id === "home") await slow;
      return UIDS[id] ?? null;
    },
  });
  const first = w.history.edit({ path: doc("home"), via: "shell", writer: agent() });
  const second = w.history.edit({ path: doc("home/Specs"), via: "shell", writer: agent() });
  // The second cannot be appended before the first, however fast it resolved.
  await Promise.resolve();
  expect(w.history.read().head).toBe(0);
  release();
  const [a, b] = await Promise.all([first, second]);
  expect([a?.seq, b?.seq]).toEqual([1, 2]);
  expect(a?.place).toEqual(page(UIDS.home!));
  expect(b?.place).toEqual(page(UIDS["home/Specs"]!));
});

test("read(since) answers what came after it, and head says where the history is", async () => {
  const w = world();
  for (let i = 0; i < 5; i++) {
    await w.history.edit({ path: doc("home"), via: "shell", writer: agent(i) });
  }
  expect(seqs(w.history)).toEqual([1, 2, 3, 4, 5]);
  expect(seqs(w.history, 0)).toEqual([1, 2, 3, 4, 5]);
  expect(seqs(w.history, 2)).toEqual([3, 4, 5]);
  expect(w.history.read(5)).toEqual({ entries: [], head: 5 });
  // Past the head — a reader from before a restart — is nothing, and head
  // being BELOW what it asked for is how it knows.
  expect(w.history.read(99)).toEqual({ entries: [], head: 5 });
  // Garbage reads as "everything".
  expect(seqs(w.history, -3)).toEqual([1, 2, 3, 4, 5]);
  expect(seqs(w.history, Number.NaN)).toEqual([1, 2, 3, 4, 5]);
});

test("THE RING keeps the newest `limit`, and a reader that fell behind sees the gap in seq", async () => {
  const w = world({ limit: 3 });
  for (let i = 0; i < 7; i++) await w.history.edit({ path: doc("home"), via: "shell", writer: agent(i) });
  expect(seqs(w.history)).toEqual([5, 6, 7]);
  expect(seqs(w.history, 1)).toEqual([5, 6, 7]);
  expect(seqs(w.history, 5)).toEqual([6, 7]);
  expect(w.history.read().head).toBe(7);
});

test("the ring's default bound is five thousand", async () => {
  const w = world();
  const all: Promise<unknown>[] = [];
  for (let i = 0; i < 5003; i++) all.push(w.history.edit({ path: doc("home"), via: "tool", writer: agent(i) }));
  await Promise.all(all);
  const read = w.history.read();
  expect(read.entries.length).toBe(5000);
  expect(read.entries[0]?.seq).toBe(4);
  expect(read.head).toBe(5003);
});

/* ── pages by uid ───────────────────────────────────────────────────────── */

test("an edit names its page by uid: a renamed page still resolves, a deleted one keeps its line and a null place after", async () => {
  const w = world();
  const before = await w.history.edit({ path: doc("home/Specs/Chat"), via: "fs", writer: agent() });
  expect(before?.place).toEqual(page(UIDS["home/Specs/Chat"]!));

  // Renamed: the same uid, somewhere else now. A path under the new id names it.
  delete w.uids["home/Specs/Chat"];
  w.uids["home/Specs/Talk"] = UIDS["home/Specs/Chat"]!;
  const after = await w.history.edit({ path: doc("home/Specs/Talk"), via: "fs", writer: agent() });
  expect(after?.place).toEqual(before?.place ?? null);

  // Deleted: a write to where it was names no page. It is still an edit a
  // reader can list, with its path — and the line before it keeps its uid.
  delete w.uids["home/Specs/Talk"];
  const gone = await w.history.edit({ path: "pages/home/children/Specs/children/Talk", via: "shell", writer: agent() });
  expect(gone?.place).toBeNull();
  expect(gone?.path).toBe("pages/home/children/Specs/children/Talk");
  expect(w.history.read().entries[0]?.place).toEqual(page(UIDS["home/Specs/Chat"]!));
});

test("a uid lookup that throws is a page with no place, never a lost edit", async () => {
  const w = world({ uidOf: async () => { throw new Error("the disk said no"); } });
  const e = await w.history.edit({ path: doc("home"), via: "fs", writer: agent() });
  expect(e?.place).toBeNull();
  expect(e?.path).toBe("pages/home/content.yaml");
});

test("a uid lookup that never answers holds nothing up for long: the line goes in without a place", async () => {
  const w = world({ patience: 30, uidOf: () => new Promise(() => {}) });
  const stuck = await w.history.edit({ path: doc("home"), via: "fs", writer: agent() });
  expect(stuck?.place).toBeNull();
  // And the next one is not queued behind it forever.
  const next = await w.history.edit({ path: "design/content.yaml", via: "fs", writer: agent() });
  expect(next?.seq).toBe(2);
});

test("every edit carries the shape the contract names: snapshot null, the path as normalised, the writer and via", async () => {
  const w = world();
  const e = await w.history.edit({ path: "./pages\\home\\content.yaml", via: "tool", writer: agent(3) });
  expect(e).toEqual({
    kind: "edit", seq: 1, at: 1_000_000, place: page(UIDS.home!), path: "pages/home/content.yaml",
    writer: agent(3), via: "tool", snapshot: null,
  });
});

/* ── what is not an edit ────────────────────────────────────────────────── */

test("a path outside the vault is not an edit, and neither is a write naming nothing", async () => {
  const w = world();
  for (const path of ["/etc/passwd", "../elsewhere/x.md", "pages/../../x", "C:/Users/x", "C:\\x", "a\u0000b", "", ".", "./"]) {
    expect(await w.history.edit({ path, via: "shell", writer: agent() })).toBeNull();
  }
  expect(await w.history.edit({ path: null, via: "app", writer: you() })).toBeNull();
  expect(await w.history.edit({ path: null, place: null, via: "app", writer: you() })).toBeNull();
  expect(w.history.read()).toEqual({ entries: [], head: 0 });
});

test("a file no screen shows is still an edit, with a null place", async () => {
  const w = world();
  for (const path of ["_markdown/home.md", "theme.json", "plugins/mine/mine.js", "assets/cat.jpg", "AGENTS.md", "notes.txt"]) {
    const e = await w.history.edit({ path, via: "shell", writer: agent() });
    expect([path, e?.place]).toEqual([path, null]);
  }
});

test("a table's schema or rows are an edit with no file and the table's place", async () => {
  const w = world();
  const e = await w.history.edit({ path: null, place: { view: "table", id: "jobs" }, via: "app", writer: you() });
  expect(e).toMatchObject({ kind: "edit", path: null, place: { view: "table", id: "jobs" }, via: "app", writer: you() });
});

/* ── typing coalesced ───────────────────────────────────────────────────── */

test("TYPING IS ONE EDIT PER BURST: the same window, the same file, through the app, inside two seconds", async () => {
  const w = world();
  const at = doc("home");
  const first = await w.history.edit({ path: at, via: "app", burst: true, writer: you() });
  expect(first?.seq).toBe(1);
  // A save after every 350 ms pause, for ten seconds: the window slides, so it
  // is still the one burst.
  for (let i = 0; i < 28; i++) {
    w.tick(350);
    expect(await w.history.edit({ path: at, via: "app", burst: true, writer: you() })).toBeNull();
  }
  // Exactly two seconds after the last save is still the burst …
  w.tick(2000);
  expect(await w.history.edit({ path: at, via: "app", burst: true, writer: you() })).toBeNull();
  // … and a pause longer than that starts another.
  w.tick(2001);
  expect((await w.history.edit({ path: at, via: "app", burst: true, writer: you() }))?.seq).toBe(2);
  expect(w.history.read().head).toBe(2);
});

test("coalescing never swallows somebody else's edit in between, nor another window's, nor another file", async () => {
  const w = world();
  const at = doc("home");
  await w.history.edit({ path: at, via: "app", burst: true, writer: you() });
  w.tick(300);
  // An agent writes the same page between two of the person's saves.
  await w.history.edit({ path: `${pageDir("home")}/hero.html`, via: "tool", writer: agent() });
  w.tick(300);
  // The person's next save is a NEW edit: the page changed hands in between.
  expect((await w.history.edit({ path: at, via: "app", burst: true, writer: you() }))?.seq).toBe(3);
  // Another window typing on the same page is its own writer.
  w.tick(100);
  expect((await w.history.edit({ path: at, via: "app", burst: true, writer: you(W2) }))?.seq).toBe(4);
  // The same window, another file on the same page: another edit.
  w.tick(100);
  expect((await w.history.edit({ path: `${pageDir("home")}/INSTRUCTIONS.md`, via: "app", burst: true, writer: you(W2) }))?.seq).toBe(5);
  // Tables coalesce by their place.
  const jobs: Place = { view: "table", id: "jobs" };
  expect((await w.history.edit({ path: null, place: jobs, via: "app", burst: true, writer: you() }))?.seq).toBe(6);
  w.tick(500);
  expect(await w.history.edit({ path: null, place: jobs, via: "app", burst: true, writer: you() })).toBeNull();
  expect((await w.history.edit({ path: null, place: { view: "table", id: "other" }, via: "app", burst: true, writer: you() }))?.seq).toBe(7);
});

test("only a keystroke's save coalesces, and only INTO what came before: a page made and then removed is two edits", async () => {
  const w = world();
  const dir = pageDir("home/Specs");
  // Two writes that are not typing, to the same path, a moment apart.
  expect((await w.history.edit({ path: dir, via: "app", writer: you() }))?.seq).toBe(1);
  w.tick(100);
  expect((await w.history.edit({ path: dir, via: "app", writer: you() }))?.seq).toBe(2);
  // The sections reordered, and then the person types into one of them: the
  // typing is the same bout of work on the same file.
  const at = doc("home/Specs");
  expect((await w.history.edit({ path: at, via: "app", writer: you() }))?.seq).toBe(3);
  w.tick(300);
  expect(await w.history.edit({ path: at, via: "app", burst: true, writer: you() })).toBeNull();
  // A structural write after the typing is its own edit, burst or no burst before it.
  w.tick(300);
  expect((await w.history.edit({ path: at, via: "app", writer: you() }))?.seq).toBe(4);
});

test("an agent's edits are never coalesced: two edits are two things it did", async () => {
  const w = world();
  const at = doc("home");
  expect((await w.history.edit({ path: at, via: "tool", writer: agent() }))?.seq).toBe(1);
  w.tick(10);
  expect((await w.history.edit({ path: at, via: "tool", writer: agent() }))?.seq).toBe(2);
  w.tick(10);
  expect((await w.history.edit({ path: at, via: "shell", writer: agent() }))?.seq).toBe(3);
});

/* ── one agent write, reported twice ────────────────────────────────────── */

test("an fs write and the tool call that made it are ONE edit — and only that pair", async () => {
  const w = world();
  const at = doc("home");
  expect((await w.history.edit({ path: at, via: "fs", writer: agent(1) }))?.seq).toBe(1);
  w.tick(40);
  expect(await w.history.edit({ path: at, via: "tool", writer: agent(1) })).toBeNull();
  // A second completed edit of the same file is a real second edit.
  w.tick(40);
  expect((await w.history.edit({ path: at, via: "tool", writer: agent(1) }))?.seq).toBe(2);

  // Another turn is another agent writer: not the same write.
  expect((await w.history.edit({ path: at, via: "fs", writer: agent(1) }))?.seq).toBe(3);
  expect((await w.history.edit({ path: at, via: "tool", writer: agent(2) }))?.seq).toBe(4);

  // Too long after is not the same write.
  expect((await w.history.edit({ path: at, via: "fs", writer: agent(2) }))?.seq).toBe(5);
  w.tick(10_001);
  expect((await w.history.edit({ path: at, via: "tool", writer: agent(2) }))?.seq).toBe(6);

  // Somebody else's edit of that screen in between: not the same write.
  expect((await w.history.edit({ path: at, via: "fs", writer: agent(2) }))?.seq).toBe(7);
  expect((await w.history.edit({ path: at, via: "app", writer: you() }))?.seq).toBe(8);
  expect((await w.history.edit({ path: at, via: "tool", writer: agent(2) }))?.seq).toBe(9);

  // Another agent's tool report of the same file is that agent's.
  expect((await w.history.edit({ path: at, via: "fs", writer: agent(2) }))?.seq).toBe(10);
  expect((await w.history.edit({ path: at, via: "tool", writer: agent(2, "agent-invented-02") }))?.seq).toBe(11);
});

/* ── subscribers ────────────────────────────────────────────────────────── */

test("subscribers hear every entry exactly once, in seq order, and one that throws does not silence the rest", async () => {
  const w = world();
  const heard: number[][] = [];
  // The failing reader is logged; those lines are expected, and nothing else.
  const warn = console.warn;
  const warned: unknown[] = [];
  console.warn = (...args: unknown[]) => { warned.push(args[0]); };
  try {
    const quiet = w.history.on(() => { throw new Error("a reader that fails"); });
    const off = w.history.on((entries) => heard.push(entries.map((e) => e.seq)));
    await w.history.edit({ path: doc("home"), via: "fs", writer: agent() });
    await w.history.report(W1, report("home"), { by: "you" });
    // Coalesced and paired calls append nothing, and nobody hears anything.
    await w.history.edit({ path: doc("home"), via: "tool", writer: agent() });
    await w.history.edit({ path: doc("home/Specs"), via: "app", burst: true, writer: you() });
    await w.history.edit({ path: doc("home/Specs"), via: "app", burst: true, writer: you() });
    expect(heard).toEqual([[1], [2, 3], [4]]);
    expect(heard.flat()).toEqual(w.history.read().entries.map((e) => e.seq));
    off();
    quiet();
    await w.history.edit({ path: doc("home"), via: "fs", writer: agent(2) });
    expect(heard.flat()).toEqual([1, 2, 3, 4]);
  } finally {
    console.warn = warn;
  }
  expect(warned).toEqual(["a history listener", "a history listener", "a history listener"]);
});

test("an entry is the history's own: a caller changing what it handed in changes nothing, and nobody can change an entry", async () => {
  const w = world();
  const writer = { kind: "agent", agent: AGENT, chat: CHAT, harness: "Claude Code", turn: 1 } as { kind: "agent"; agent: string; chat: string; harness: string; turn: number };
  const place: Place = { view: "table", id: "jobs" };
  const e = (await w.history.edit({ path: null, place, via: "fs", writer }))!;
  writer.turn = 99;
  (place as { id: string }).id = "other";
  expect(e.writer).toEqual(agent(1));
  expect(e.place).toEqual({ view: "table", id: "jobs" });
  expect(Object.isFrozen(e) && Object.isFrozen(e.writer) && Object.isFrozen(e.place)).toBe(true);
  expect(Object.isFrozen(w.history.read().entries[0])).toBe(true);
});

/* ── windows: reports, opens, views, claims ─────────────────────────────── */

test("a report keeps the context — the agent from the chat, never from the window — and appends nothing unless the screen moved", async () => {
  const w = world();
  const leave = w.history.attach(W1);
  const sent = report("home/Specs", { panel: true, chat: CHAT, agent: "an-agent-the-window-made-up" });
  expect(await w.history.report(W1, sent)).toEqual([]);
  expect(w.history.windows()).toEqual([
    { window: W1, address: address("page", "home/Specs"), panel: true, chat: CHAT, agent: AGENT, at: 1_000_000 },
  ]);
  // A chat running nothing has no agent.
  expect(await w.history.report(W1, report("home", { chat: "chat-not-running-9" }))).toEqual([]);
  expect(w.history.windows()[0]?.agent).toBeNull();
  // An address is normalised on the way in: a screen only on a page.
  await w.history.report(W1, { address: { view: "design", id: "stray", screen: "automation" }, panel: false, chat: null, agent: null });
  expect(w.history.windows()[0]?.address).toEqual(address("design"));
  expect(w.history.read().head).toBe(0);
  leave();
});

test("the person moving the screen is an open and a view; a claim is a view alone, once", async () => {
  const w = world();
  const moved = await w.history.report(W1, report("home/Specs"), { by: "you" });
  const at = page(UIDS["home/Specs"]!);
  expect(moved).toEqual([
    { kind: "open", seq: 1, at: 1_000_000, window: W1, place: at, writer: you() },
    { kind: "view", seq: 2, at: 1_000_000, window: W1, place: at, writer: you() },
  ]);
  // Already theirs: a claim says nothing new.
  expect(await w.history.report(W1, report("home/Specs"), { by: "claim" })).toEqual([]);
  // Their page's own screen is another address, and the Instructions screen is a place too.
  const other = await w.history.report(W1, report("home/Specs", { address: address("page", "home/Specs", "instructions") }), { by: "claim" });
  expect(other).toEqual([{ kind: "view", seq: 3, at: 1_000_000, window: W1, place: page(UIDS["home/Specs"]!, "instructions"), writer: you() }]);
  expect(w.history.read().entries.filter((e) => e.kind === "open")).toHaveLength(1);
});

test("the switcher's view is under the agent it followed, named as that agent's edit named it; a claim after it is the person's", async () => {
  const w = world();
  await w.history.report(W1, report("home"), { by: "you" });
  // The agent writes in turn 4, and the switcher brings the page up.
  await w.history.edit({ path: doc("home/Specs/Chat"), via: "fs", writer: agent(4) });
  w.chats.set(CHAT, { agent: AGENT, harness: "Claude Code", turn: 5 });
  const view = await w.history.report(W1, report("home/Specs/Chat", { panel: true, chat: CHAT }), { by: "switcher", agent: AGENT, chat: CHAT });
  expect(view).toEqual([{ kind: "view", seq: 4, at: 1_000_000, window: W1, place: page(UIDS["home/Specs/Chat"]!), writer: agent(4) }]);
  // The person touches it: now it is theirs, which is a view by them.
  const claim = await w.history.report(W1, report("home/Specs/Chat", { panel: true, chat: CHAT }), { by: "claim" });
  expect(claim.map((e) => [e.kind, e.writer.kind])).toEqual([["view", "you"]]);
});

test("a switcher's view with no edit to name it by falls back to the chat's agent, and one nobody can name is not recorded", async () => {
  const w = world();
  const view = await w.history.report(W1, report("home", { chat: CHAT }), { by: "switcher", agent: AGENT, chat: CHAT });
  expect(view.map((e) => e.writer)).toEqual([agent(1)]);
  // An agent the chat is not running, in a chat nobody has: nothing appended,
  // and the context is still kept.
  const leave = w.history.attach(W1);
  expect(await w.history.report(W1, report("home/Specs"), { by: "switcher", agent: "agent-gone-000009", chat: CHAT })).toEqual([]);
  expect(await w.history.report(W1, report("home/Specs"), { by: "switcher", agent: AGENT, chat: "chat-other-00001" })).toEqual([]);
  expect(w.history.windows()[0]?.address).toEqual(address("page", "home/Specs"));
  leave();
});

test("an address that names no place is kept as the context and not recorded", async () => {
  const w = world();
  const leave = w.history.attach(W1);
  // A page with no uid, and the address of nothing.
  expect(await w.history.report(W1, report("home/Unknown"), { by: "you" })).toEqual([]);
  expect(await w.history.report(W1, report(""), { by: "you" })).toEqual([]);
  expect(w.history.read().head).toBe(0);
  expect(w.history.windows()).toHaveLength(1);
  // The framework's own screens are places without a uid.
  const design = await w.history.report(W1, { address: address("design"), panel: false, chat: null, agent: null }, { by: "you" });
  expect(design.map((e) => e.place)).toEqual([{ view: "design", id: "" }, { view: "design", id: "" }]);
  const agentScreen = await w.history.report(W1, { address: address("agent", CHAT), panel: false, chat: CHAT, agent: null }, { by: "you" });
  expect(agentScreen[0]?.place).toEqual({ view: "agent", id: CHAT });
  leave();
});

/* ── windows: attach and forget ─────────────────────────────────────────── */

test("a window's context lives while a stream of its is open, and goes when the last one closes", async () => {
  const w = world();
  // Reported before its stream opened — boot races the two — and answered
  // once it does.
  await w.history.report(W1, report("home"));
  expect(w.history.windows()).toEqual([]);
  const first = w.history.attach(W1);
  expect(w.history.windows().map((c) => c.window)).toEqual([W1]);

  // A reload whose new stream opens before the old one is seen to close.
  const second = w.history.attach(W1);
  first();
  expect(w.history.windows().map((c) => c.window)).toEqual([W1]);
  // Closing twice is closing once.
  first();
  expect(w.history.windows().map((c) => c.window)).toEqual([W1]);
  second();
  expect(w.history.windows()).toEqual([]);

  // Opened again with no new report: nothing to answer until it says.
  const third = w.history.attach(W1);
  expect(w.history.windows()).toEqual([]);
  await w.history.report(W1, report("home/Specs"));
  expect(w.history.windows().map((c) => c.address.id)).toEqual(["home/Specs"]);

  // forget drops it whatever is open, and a close after that is nothing.
  w.history.forget(W1);
  expect(w.history.windows()).toEqual([]);
  third();
  const fourth = w.history.attach(W1);
  await w.history.report(W1, report("home"));
  expect(w.history.windows()).toHaveLength(1);
  fourth();
});

test("windows() answers every open window, the most recently heard first", async () => {
  const w = world();
  const a = w.history.attach(W1);
  const b = w.history.attach(W2);
  await w.history.report(W1, report("home"));
  w.tick(5);
  await w.history.report(W2, report("home/Specs"));
  expect(w.history.windows().map((c) => c.window)).toEqual([W2, W1]);
  w.tick(5);
  await w.history.report(W1, report("home/Specs/Chat"));
  expect(w.history.windows().map((c) => c.window)).toEqual([W1, W2]);
  a();
  b();
});

test("A REPORT IN FLIGHT WHEN ITS WINDOW'S STREAM CLOSES does not bring the window back — and what it said still happened", async () => {
  let release!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  const w = world({ uidOf: async (id) => { await slow; return UIDS[id] ?? null; } });
  const leave = w.history.attach(W1);
  const pending = w.history.report(W1, report("home/Specs"), { by: "you" });
  // The tab closes while the page's uid is being read.
  leave();
  release();
  const appended = await pending;
  expect(appended.map((e) => e.kind)).toEqual(["open", "view"]);
  expect(w.history.windows()).toEqual([]);

  // A report arriving AFTER the close — sent just before it — is held but
  // not answered: no stream of that window is open.
  await w.history.report(W1, report("home"));
  expect(w.history.windows()).toEqual([]);
});

test("the contexts held for windows with no stream are bounded, the oldest first, and a window with a stream open is never dropped", async () => {
  const w = world();
  const kept = w.history.attach("window-kept-00001");
  await w.history.report("window-kept-00001", report("home"));
  await w.history.report("window-oldest-0001", report("home"));
  for (let i = 0; i < 300; i++) await w.history.report(`window-many-${String(i).padStart(4, "0")}`, report("home"));
  // The oldest unattached one went; attaching it now finds nothing to answer.
  const late = w.history.attach("window-oldest-0001");
  expect(w.history.windows().map((c) => c.window)).toEqual(["window-kept-00001"]);
  // The newest is still held.
  const newest = w.history.attach("window-many-0299");
  expect(w.history.windows().map((c) => c.window).sort()).toEqual(["window-kept-00001", "window-many-0299"]);
  kept();
  late();
  newest();
});

/* ── the address table ──────────────────────────────────────────────────── */

test("THE ADDRESS TABLE: every row of the spec's, the column a write is looked for in", () => {
  const rows: [string, ReturnType<typeof address> | null][] = [
    // A page: a file of the page's under `pages/`.
    ["pages/home/content.yaml", address("page", "home")],
    ["pages/home", address("page", "home")],
    ["pages/home/hero.html", address("page", "home")],
    ["pages/home/_assets/cat.jpg", address("page", "home")],
    ["pages/home/plugins/mine/mine.js", address("page", "home")],
    ["pages/home/children/Specs/content.yaml", address("page", "home/Specs")],
    ["pages/home/children/Specs/children/Chat/child.html", address("page", "home/Specs/Chat")],
    // A page's Instructions: the page's `INSTRUCTIONS.md`.
    ["pages/home/INSTRUCTIONS.md", address("page", "home", "instructions")],
    ["pages/home/children/Specs/INSTRUCTIONS.md", address("page", "home/Specs", "instructions")],
    // A page's Automations: a file under the page's `automations/`.
    ["pages/home/automations", address("page", "home", "automation")],
    ["pages/home/automations/daily/automation.yaml", address("page", "home", "automation")],
    ["pages/home/children/Specs/automations/daily/code/run.py", address("page", "home/Specs", "automation")],
    // …its automation's own INSTRUCTIONS.md is the automation's.
    ["pages/home/automations/daily/INSTRUCTIONS.md", address("page", "home", "automation")],
    // Design: a file under `design/`.
    ["design/content.yaml", address("design")],
    ["design", address("design")],
    ["design/worlds/dusk.html", address("design")],
    // The workspace's Instructions: the root `INSTRUCTIONS.md`, or a skill.
    ["INSTRUCTIONS.md", address("instructions")],
    [".agents/skills/biom-pages/SKILL.md", address("instructions")],
    [".agents/skills/mine/SKILL.md", address("instructions")],
    [".agents/skills", address("instructions")],
    // A table, Automations, the Map, Workspaces and the Agent screen show no
    // file: nothing is looked for, so nothing maps there.
  ];
  for (const [path, want] of rows) expect([path, addressOfPath(path)]).toEqual([path, want]);
});

test("the address table's negatives: no screen shows these", () => {
  const none = [
    "_markdown/home.md", "theme.json", "AGENTS.md", "workspace.db", ".gitignore", "plugins/mine/mine.js",
    "assets/cat.jpg", "base/hero.html", "docs/pages.md", ".biom/runs.db", ".agents/other/x.md",
    ".agents/skillsx/y.md", "instructions.md", "pages", "pages/", "pages/.trash/x", "pages/_hidden/content.yaml",
    "pages/x.md", "pages/@design/content.yaml", "designs/x", "", "/pages/home/content.yaml", "../pages/home/content.yaml",
  ];
  for (const path of none) expect([path, addressOfPath(path)]).toEqual([path, null]);
});

test("under `pages/`, what is not a page's is its nearest page's: a name that is no segment stops the walk", () => {
  expect(addressOfPath("pages/home/children/Not A Page/x.md")).toEqual(address("page", "home"));
  expect(addressOfPath("pages/home/children/.DS_Store")).toEqual(address("page", "home"));
  expect(addressOfPath("pages/home/children")).toEqual(address("page", "home"));
  expect(addressOfPath("pages/home/_assets/children/Specs/x")).toEqual(address("page", "home"));
  expect(addressOfPath("pages/home/automations/children/Specs")).toEqual(address("page", "home", "automation"));
  // A path is normalised first.
  expect(addressOfPath("./pages//home/./children/Specs/../Specs/INSTRUCTIONS.md")).toEqual(address("page", "home/Specs", "instructions"));
  expect(addressOfPath("pages\\home\\children\\Specs\\content.yaml")).toEqual(address("page", "home/Specs"));
});

test("the walk is the one pages.ts and mirror.ts spell: a page's own directory comes back as that page, both ways", () => {
  const ids = ["home", "home/Specs", "home/Specs/2026-09-24-Chat", "home/a/b/c/d/e", "Office_Hours", "x-1"];
  for (const id of ids) {
    expect(addressOfPath(`${pageDir(id)}/${PAGE_DOC}`)).toEqual(address("page", id));
    expect(addressOfPath(pageDir(id))).toEqual(address("page", id));
    expect(pageAt(`${pageDir(id)}/${PAGE_DOC}`)?.id).toBe(id);
  }
  // The design doc's reserved id is the design folder, which is Design.
  expect(addressOfPath(`${pageDir("@design")}/${PAGE_DOC}`)).toEqual(address("design"));
  // And a path mirror.ts reads as a page, the table reads as the same page.
  for (const path of ["pages/home/children/Specs/x.html", "pages/home/children/Specs/children/Chat", "pages/home/children/Bad Name/x"]) {
    expect(addressOfPath(path)?.id).toBe(pageAt(path)?.id);
  }
});

test("placeOfPath is the table with the page named by its uid, and no uid is no place", () => {
  const uidOf = (id: PageId) => UIDS[id] ?? null;
  expect(placeOfPath("pages/home/children/Specs/INSTRUCTIONS.md", uidOf)).toEqual(page(UIDS["home/Specs"]!, "instructions"));
  expect(placeOfPath("pages/home/automations/a/b", uidOf)).toEqual(page(UIDS.home!, "automation"));
  expect(placeOfPath("pages/home/children/Nobody/content.yaml", uidOf)).toBeNull();
  expect(placeOfPath("design/content.yaml", uidOf)).toEqual({ view: "design", id: "" });
  expect(placeOfPath(".agents/skills/x/SKILL.md", uidOf)).toEqual({ view: "instructions", id: "" });
  expect(placeOfPath("theme.json", uidOf)).toBeNull();
});

test("normalPath: forward-slashed and inside the vault, or null", () => {
  const rows: [string, string | null][] = [
    ["pages/home/content.yaml", "pages/home/content.yaml"],
    ["./pages//home/", "pages/home"],
    ["pages\\home\\x.md", "pages/home/x.md"],
    ["pages/home/../../design/x", "design/x"],
    ["pages/home/../x", "pages/x"],
    ["a/..", null],
    ["..", null],
    ["../x", null],
    ["/abs", null],
    ["\\abs", null],
    ["C:/x", null],
    ["c:x", null],
    ["x\u0000y", null],
    ["", null],
  ];
  for (const [path, want] of rows) expect([path, normalPath(path)]).toEqual([path, want]);
});

/* ── an EditReport's `place` wins over its path ─────────────────────────── */

test("a place handed in is the place, whatever the path says", async () => {
  const w = world();
  const write: EditReport = { path: "pages/home/content.yaml", place: { view: "table", id: "jobs" }, via: "app", writer: you() };
  const e = await w.history.edit(write);
  expect(e?.place).toEqual({ view: "table", id: "jobs" });
  expect(e?.path).toBe("pages/home/content.yaml");
});

