// SPDX-License-Identifier: AGPL-3.0-only
// THE SWITCHER: `client/store/switcher.js`, the rules of the *History and View
// Switcher* spec's `yours`, `switcher`, `moves` and `popups` sections.
//
// TWO HALVES. `decide` is pure, so every rule and every edge of it is a row in
// a table on a fake clock: the open chat and nothing else, a held screen, the
// two minutes exactly, a touch before and after the latest message, the settle
// after a move. `makeSwitcher` is then walked end to end against the REAL ui
// store and the REAL history store, over a server stood in for by a transport
// that appends exactly what the server's history appends — so the reports it
// makes, the claims, Go back to and Go to page are what a window would see.
//
// Every window, chat, agent and page id here is invented.

import { test, expect } from "bun:test";

import { decide, makeSwitcher, screenName, boxOf, TIMING } from "../client/store/switcher.js";
import { makeUi } from "../client/store/ui.js";
import { makeHistoryStore } from "../client/store/history.js";
import { placeOf } from "../contracts/address.js";

const WINDOW = "window-0001-invented";
const CHAT = "chat-0001-invented";
const OTHER = "chat-0002-invented";
const AGENT = "agent-0001-invented";
const AGENT2 = "agent-0002-invented";

const MIN = 60_000;
const T = { adopt: 5 * MIN, idle: 2 * MIN, settle: 5_000 };

/** @param {string} id @param {"page" | "instructions" | "automation"} [screen] */
const page = (id, screen = "page") => ({ view: /** @type {const} */ ("page"), id, screen });

/* ══ decide(): one row per rule, and every edge ════════════════════════════ */

const NOW = 10 * MIN;
/** The base: the open chat, in the panel beside Log, writing Boards; nothing
 *  touched, nothing sent, nothing moved. */
const BASE = {
  now: NOW,
  edit: { chat: CHAT, agent: AGENT, to: page("boards") },
  screen: page("log"),
  panel: true,
  chat: CHAT,
  mine: true,
  touched: /** @type {number | null} */ (null),
  sent: /** @type {number | null} */ (null),
  moved: /** @type {number | null} */ (null),
};

/** @type {[string, Partial<typeof BASE>, string, (string | number)?][]} */
const ROWS = [
  // 1. ONLY THE OPEN CHAT, WHILE IT IS ON SCREEN.
  ["a chat in the background never moves the screen", { edit: { ...BASE.edit, chat: OTHER, agent: AGENT2 } }, "none"],
  ["a chat whose panel is shut never moves the screen", { panel: false }, "none"],
  ["no chat open, nothing followed", { chat: null }, "none"],
  ["the Agent start screen has no chat, and nothing is followed", { screen: { view: "agent", id: "", screen: "page" }, chat: null, panel: false }, "none"],
  ["on the full Agent screen the open chat is followed, and the page comes up with the panel", { screen: { view: "agent", id: CHAT, screen: "page" }, panel: false }, "move"],
  // 2. ALREADY THERE.
  ["a write to what is on screen changes nothing", { edit: { ...BASE.edit, to: page("log") } }, "none"],
  ["a write to the page's own Instructions is another screen", { edit: { ...BASE.edit, to: page("log", "instructions") } }, "move"],
  // 3. NEVER OFF A HELD SCREEN.
  ["a held screen offers instead of moving", { screen: page("log", "automation"), mine: false }, "offer"],
  ["a held screen offers however long since the last touch", { screen: page("log", "automation"), touched: NOW - 60 * MIN }, "offer"],
  ["a held screen is not held against moving TO it", { edit: { ...BASE.edit, to: page("boards", "automation") } }, "move"],
  // 4. THE PERSON'S SCREEN AND THE TWO MINUTES.
  ["the person's screen touched half a minute ago stays, and the write is offered", { touched: NOW - 30_000 }, "offer"],
  ["a touch EXACTLY two minutes ago still holds — it must be MORE than two", { touched: NOW - 2 * MIN }, "offer"],
  ["a touch two minutes and a millisecond ago lets it move", { touched: NOW - 2 * MIN - 1 }, "move"],
  ["a touch BEFORE the latest message does not count", { touched: NOW - 30_000, sent: NOW - 10_000 }, "move"],
  ["a touch AFTER the latest message does", { touched: NOW - 10_000, sent: NOW - 30_000 }, "offer"],
  ["a touch at the same instant as the message is the act that sent it", { touched: NOW - 10_000, sent: NOW - 10_000 }, "move"],
  ["a screen that is not the person's moves however recently it was touched", { mine: false, touched: NOW - 1_000 }, "move"],
  ["the person's screen never touched is the chat's to move", {}, "move"],
  // 5. NO BOUNCING.
  ["inside the settle after a move, the write waits for it to end", { mine: false, moved: NOW - 1_000 }, "wait", NOW + 4_000],
  ["exactly the settle after a move, it moves", { mine: false, moved: NOW - 5_000 }, "move"],
  ["a touch that holds is offered even inside the settle — offer before wait", { touched: NOW - 1_000, moved: NOW - 1_000 }, "offer"],
  ["held and inside the settle is still an offer", { screen: page("log", "automation"), moved: NOW - 1_000 }, "offer"],
];

for (const [name, patch, kind, until] of ROWS) {
  test("decide: " + name, () => {
    const v = decide({ ...BASE, ...patch }, T);
    expect(v.kind).toBe(kind);
    if (v.kind === "wait") expect(v.until).toBe(/** @type {number} */ (until));
    if (v.kind === "move") {
      // EVERY MOVE BRINGS THE CHAT BESIDE THE PAGE (DECISIONS §7), and names
      // the agent and the chat it followed.
      expect(v.panel).toBe(true);
      expect(v.agent).toBe(AGENT);
      expect(v.chat).toBe(CHAT);
    }
    if (v.kind === "offer") expect(v.chat).toBe(CHAT);
    expect(typeof v.why).toBe("string");
  });
}

test("decide: two chats writing at once — only the open one's write does anything", () => {
  const open = decide({ ...BASE, edit: { chat: CHAT, agent: AGENT, to: page("boards") } }, T);
  const background = decide({ ...BASE, edit: { chat: OTHER, agent: AGENT2, to: page("docs") } }, T);
  expect([open.kind, background.kind]).toEqual(["move", "none"]);
});

test("the spec's three numbers are the defaults", () => {
  expect(TIMING).toEqual(T);
});

test("a screen is named as the rail names it; a page by its name now", () => {
  const pages = [{ id: "home/log", name: "Log", uid: "u1" }];
  expect(screenName(page("home/log"), pages)).toBe("Log");
  expect(screenName(page("home/log", "instructions"), pages)).toBe("Log · Instructions");
  expect(screenName(page("home/gone"), pages)).toBe("gone");
  expect(screenName({ view: "design", id: "", screen: "page" }, pages)).toBe("Design");
  expect(screenName({ view: "table", id: "jobs", screen: "page" }, pages)).toBe("jobs");
});

test("a screen's box is its page's, and a host screen has none", () => {
  expect(boxOf(page("log"))).toBe("log");
  expect(boxOf(page("log", "instructions"))).toBe(null);
  expect(boxOf({ view: "design", id: "", screen: "page" })).toBe("@design");
  expect(boxOf({ view: "runs", id: "", screen: "page" })).toBe(null);
});

test("a page route naming a framework screen has no box, so the chat's own box beside it is nobody's touch of it", async () => {
  expect(boxOf(page("@agent"))).toBe(null);
  expect(boxOf(page("@map"))).toBe(null);
  // `#/page/@agent`, with the chat in the panel beside it.
  const w = windowOn(page("@agent"));
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  // Scrolling the chat in the panel is talking to the agent, not touching the
  // screen — so it does not hold the screen against the chat's own write.
  w.switcher.touched("@agent");
  w.stream(w.server.edit("boards"));
  expect(w.ui.get().route).toEqual(page("boards"));
});

/* ══ makeSwitcher(): end to end over the real stores ════════════════════════ */

const PAGES = [
  { id: "log", name: "Log", uid: "u-log" },
  { id: "boards", name: "Boards", uid: "u-boards" },
  { id: "docs", name: "Docs", uid: "u-docs" },
  { id: "specs", name: "Specs", uid: "u-specs" },
];

/** The most timers one `advance` runs. A timer that re-arms itself at the
 *  instant it ran — a `wait` whose settle check slipped from `<` to `<=` —
 *  would otherwise spin inside `advance` for ever, synchronously, where no
 *  test timeout can reach it: the whole `bun test` run hangs instead of one
 *  test failing. Every wait bounded, this one included. */
const ADVANCE_MAX = 10_000;

/** A clock and the timers on it. `advance` runs every timer that falls due, in
 *  order, with the clock set to each one's time as it runs — and throws, naming
 *  the loop, past `ADVANCE_MAX` of them. */
function fakeClock(start = 1_000_000) {
  let t = start;
  /** @type {{ at: number, fn: () => void, live: boolean }[]} */
  const timers = [];
  return {
    now: () => t,
    /** @param {number} ms @param {() => void} fn */
    after(ms, fn) {
      const timer = { at: t + Math.max(0, ms), fn, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
    /** @param {number} ms */
    advance(ms) {
      const to = t + ms;
      for (let ran = 0; ; ran++) {
        const next = timers.filter((x) => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        if (ran >= ADVANCE_MAX) throw new Error(`the fake clock ran ${ADVANCE_MAX} timers in one advance: a timer is re-arming itself at the instant it runs`);
        next.live = false;
        t = next.at;
        next.fn();
      }
      t = to;
    },
    get pending() { return timers.filter((x) => x.live).length; },
  };
}

test("the fake clock fails a timer that re-arms itself at the instant it runs, rather than hanging the run", () => {
  const clock = fakeClock();
  let ran = 0;
  const again = () => { ran++; clock.after(0, again); };
  clock.after(0, again);
  expect(() => clock.advance(1)).toThrow(/re-arming itself/);
  expect(ran).toBe(ADVANCE_MAX);
});

/** THE SERVER'S HISTORY, as far as a window can see it: a report appends an
 *  open and a view for the person, a view for a claim or the switcher — none
 *  for a claim already standing at that address — and an agent's write is an
 *  edit the test puts on the stream. */
function fakeServer(pages = PAGES) {
  let seq = 0;
  /** @type {any[]} */
  const entries = [];
  /** @type {any[]} */
  const reports = [];
  /** @type {Map<string, { address: any, yours: boolean }>} */
  const last = new Map();
  /** @param {string} id */
  const uidOf = (id) => pages.find((p) => p.id === id)?.uid ?? null;
  const transport = {
    /** @param {any} req */
    async call(req) {
      await null;
      const ok = (/** @type {unknown} */ value) => ({ id: req.id, g: 1, ok: true, value });
      if (req.kind === "history.read") return ok({ entries: entries.filter((e) => e.seq > (req.since ?? 0)), head: seq });
      if (req.kind !== "window.report") return { id: req.id, g: 1, ok: false, error: { code: "unknown_kind", message: "no", retryable: false } };
      reports.push({ context: req.context, moved: req.moved, window: req.window });
      const m = req.moved;
      if (!m) return ok([]);
      const w = req.window ?? WINDOW;
      const a = req.context.address;
      const was = last.get(w);
      if (m.by === "claim" && was && was.yours && was.address.view === a.view && was.address.id === a.id && was.address.screen === a.screen) return ok([]);
      const place = placeOf(a, uidOf);
      last.set(w, { address: a, yours: m.by !== "switcher" });
      if (!place) return ok([]);
      const writer = m.by === "switcher"
        ? { kind: "agent", agent: m.agent, chat: m.chat, harness: "Fake agent", turn: 1 }
        : { kind: "you", window: w };
      const out = (m.by === "you" ? ["open", "view"] : ["view"]).map((kind) => ({ kind, seq: ++seq, at: 0, window: w, place, writer }));
      entries.push(...out);
      return ok(out);
    },
  };
  return {
    transport,
    reports,
    entries,
    /** An agent's write, appended and handed back for the stream.
     *  @param {string} id @param {string} [chat] @param {string} [agent] @param {"page" | "instructions" | "automation"} [screen] */
    edit(id, chat = CHAT, agent = AGENT, screen = "page") {
      const e = {
        kind: "edit", seq: ++seq, at: 0, place: { view: "page", uid: uidOf(id), screen }, path: `pages/${id}/content.yaml`,
        via: "fs", snapshot: null, writer: { kind: "agent", agent, chat, harness: "Fake agent", turn: 1 },
      };
      entries.push(e);
      return e;
    },
    /** A run's write, which the history cannot yet name as an agent's. @param {string} id */
    run(id) {
      const e = { kind: "edit", seq: ++seq, at: 0, place: { view: "page", uid: uidOf(id), screen: "page" }, path: null, via: "fs", snapshot: null, writer: { kind: "run", session: "session-0001-invented" } };
      entries.push(e);
      return e;
    },
    restart() { seq = 0; entries.length = 0; last.clear(); },
  };
}

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

/** A window: the real ui and history stores, the switcher over them, a fake
 *  clock and the fake server. */
function windowOn(route = page("log"), opts = {}) {
  const clock = fakeClock();
  const server = fakeServer();
  const ui = makeUi({ route, panel: true, chat: CHAT });
  const history = makeHistoryStore({ transport: server.transport, now: clock.now });
  let sent = /** @type {number | null} */ (null);
  const switcher = makeSwitcher({
    ui, history, window: WINDOW, pages: () => PAGES,
    lastSent: () => sent,
    now: clock.now, timing: T, after: clock.after,
    ...opts,
  });
  /** Moves the ui made, in order: who and where. @type {string[]} */
  const moves = [];
  ui.on(() => moves.push(ui.cause().mover.by + ":" + ui.get().route.id));
  return {
    clock, server, ui, history, switcher, moves,
    send() { sent = clock.now(); },
    /** @param {any[]} entries */
    stream(...entries) { history.take(entries, true); },
    moved: () => server.reports.filter((r) => r.moved).map((r) => r.moved.by + ":" + r.context.address.id + (r.moved.by === "switcher" ? "" : "")),
  };
}

test("the moves scene: send, a write moves the screen, a scroll takes it back, a write inside two minutes is offered, and after two minutes it moves", async () => {
  const w = windowOn(page("specs"));
  await w.switcher.start();
  // You open Log yourself: it is yours, and the history records the open.
  w.ui.open("page", "log");
  await settle();
  w.clock.advance(10_000);

  // YOU SEND A MESSAGE: touches before it stop holding the screen.
  w.send();
  w.clock.advance(1_000);
  w.stream(w.server.edit("boards"));
  expect(w.ui.get().route.id).toBe("boards");
  expect(w.ui.get().panel).toBe(true);
  // The person's own screen keeps its entry in the browser's history.
  expect(w.ui.cause()).toMatchObject({ mover: { by: "switcher", agent: AGENT, chat: CHAT }, replace: false });
  await settle();
  // GO BACK TO LOG lights top left.
  expect(w.switcher.get().back).toEqual({ to: page("log"), name: "Log" });

  // YOU SCROLL BOARDS: it is yours now, and the pop-up goes. Reported ONCE.
  w.clock.advance(6_000);
  w.switcher.touched("boards");
  w.switcher.touched("boards");
  await settle();
  expect(w.switcher.get().back).toBe(null);
  expect(w.server.reports.filter((r) => r.moved?.by === "claim" && r.context.address.id === "boards")).toHaveLength(1);

  // AN EDIT TO DOCS INSIDE 2 MINUTES OF THAT TOUCH: the screen stays, and Go to Docs lights in the chat.
  w.clock.advance(30_000);
  w.stream(w.server.edit("docs"));
  expect(w.ui.get().route.id).toBe("boards");
  expect(w.switcher.get().offer).toEqual({ to: page("docs"), name: "Docs" });

  // 2 MINUTES WITHOUT A TOUCH: the next edit moves the screen, and Go back to Boards lights.
  w.clock.advance(2 * MIN);
  w.stream(w.server.edit("specs"));
  expect(w.ui.get().route.id).toBe("specs");
  await settle();
  expect(w.switcher.get().back).toEqual({ to: page("boards"), name: "Boards" });
  // The offer went with the move: the latest write is on screen now.
  expect(w.switcher.get().offer).toBe(null);
});

test("no bouncing: a write inside the settle is followed when it ends, and a newer one takes its place", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.send();
  w.clock.advance(1_000);
  w.stream(w.server.edit("boards"));
  expect(w.ui.get().route.id).toBe("boards");

  w.clock.advance(1_000);
  w.stream(w.server.edit("docs"));
  expect(w.ui.get().route.id).toBe("boards");
  w.clock.advance(1_000);
  w.stream(w.server.edit("specs"));
  expect(w.ui.get().route.id).toBe("boards");

  // Exactly five seconds after the move, the LATEST write is followed, once.
  w.clock.advance(2_999);
  expect(w.ui.get().route.id).toBe("boards");
  w.clock.advance(1);
  expect(w.ui.get().route.id).toBe("specs");
  expect(w.moves.filter((m) => m.startsWith("switcher"))).toEqual(["switcher:boards", "switcher:specs"]);
  // A move off a screen the switcher brought up replaces its entry: Back from
  // here is the person's page, not the agent's previous one.
  expect(w.ui.cause().replace).toBe(true);
});

test("a wait taken over by the person opening a page becomes an offer, not a move against them", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.send();
  w.clock.advance(1_000);
  w.stream(w.server.edit("boards"));
  w.clock.advance(1_000);
  w.stream(w.server.edit("docs"));
  // The person opens Specs inside the settle.
  w.ui.open("page", "specs");
  w.clock.advance(10_000);
  expect(w.ui.get().route.id).toBe("specs");
  expect(w.switcher.get().offer?.to).toEqual(page("docs"));
});

test("a background chat, a shut panel and a run never move the screen", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards", OTHER, AGENT2));
  w.stream(w.server.run("docs"));
  expect(w.ui.get().route.id).toBe("log");
  w.ui.set({ panel: false });
  w.stream(w.server.edit("specs"));
  expect(w.ui.get().route.id).toBe("log");
  // And none of them is offered either: Go to page sits above an input that is not there.
  expect(w.switcher.get().offer).toBe(null);
});

test("two chats writing in one batch: the open chat's write is followed even when the other's came after it", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"), w.server.edit("docs", OTHER, AGENT2));
  expect(w.ui.get().route.id).toBe("boards");
});

test("an entry read back rather than streamed is the past, and the past is never followed", async () => {
  const w = windowOn();
  w.server.edit("boards");
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.history.take([w.server.edit("docs")], false);
  expect(w.ui.get().route.id).toBe("log");
});

test("the full Agent screen: the move brings the page up with the chat beside it, and touches in the chat are not touches", async () => {
  const w = windowOn({ view: "agent", id: CHAT, screen: "page" });
  w.ui.set({ panel: false });
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  // Scrolling the chat's own box, and anything done on the Agent screen, is talking to the agent.
  w.switcher.touched("@agent");
  w.switcher.touched();
  w.stream(w.server.edit("boards"));
  expect(w.ui.get().route).toEqual(page("boards"));
  expect(w.ui.get().panel).toBe(true);
  expect(w.ui.get().chat).toBe(CHAT);
});

test("a touch from the box of the screen just left is nobody's touch of this one — the same tick as a move", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  // Log's box still saying what happened a moment before the move.
  w.switcher.touched("log");
  // The chat's own box in the panel.
  w.switcher.touched("@agent");
  await settle();
  expect(w.switcher.get().back?.to).toEqual(page("log"));
  expect(w.server.reports.filter((r) => r.moved?.by === "claim")).toHaveLength(1); // start's own
});

test("a touch that lands first holds the screen: the write in the same tick is offered", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.switcher.touched("log");
  w.stream(w.server.edit("boards"));
  expect(w.ui.get().route.id).toBe("log");
  expect(w.switcher.get().offer?.name).toBe("Boards");
});

test("five minutes on screen with the window in front makes it the person's — counted across the window leaving and coming back", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  await settle();
  expect(w.switcher.get().back).not.toBe(null);

  w.clock.advance(3 * MIN);
  w.switcher.front(false);
  // Twenty minutes behind another window count for nothing.
  w.clock.advance(20 * MIN);
  await settle();
  expect(w.switcher.get().back).not.toBe(null);
  w.switcher.front(true);
  w.clock.advance(2 * MIN - 1);
  await settle();
  expect(w.switcher.get().back).not.toBe(null);
  w.clock.advance(1);
  await settle();
  expect(w.switcher.get().back).toBe(null);
  expect(w.server.reports.filter((r) => r.moved?.by === "claim" && r.context.address.id === "boards")).toHaveLength(1);
});

test("a claim that is due lands before a write is decided on it, however late its timer", async () => {
  // TIMERS THAT NEVER RUN: the adopt timer is as late as a timer can be.
  const w = windowOn(page("log"), { after: () => () => {} });
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  await settle();
  expect(w.switcher.get().back?.name).toBe("Log");
  w.clock.advance(5 * MIN);
  w.stream(w.server.edit("docs"));
  await settle();
  // Boards was the person's by the time Docs was decided: claimed first, kept
  // in the browser's history by the move, and named by Go back to.
  expect(w.server.reports.filter((r) => r.moved?.by === "claim" && r.context.address.id === "boards")).toHaveLength(1);
  expect(w.ui.get().route.id).toBe("docs");
  expect(w.ui.cause().replace).toBe(false);
  expect(w.switcher.get().back?.name).toBe("Boards");
});

test("a system move to the same page under a new id keeps whose it was; to another page makes it the person's", async () => {
  const pages = [...PAGES];
  const w = windowOn(page("log"), { pages: () => pages });
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  await settle();
  expect(w.switcher.get().back?.name).toBe("Log");

  // Boards renamed to Plans: the same uid, so the same place — still the agent's.
  pages[1] = { id: "plans", name: "Plans", uid: "u-boards" };
  w.ui.go("page", "plans");
  await settle();
  expect(w.switcher.get().back?.name).toBe("Log");

  // Deleted, and the route leaves for Specs: nothing brought that up for an agent.
  w.ui.go("page", "specs");
  await settle();
  expect(w.switcher.get().back).toBe(null);
  expect(w.server.reports.at(-1)?.moved).toEqual({ by: "claim" });
});

test("Go back to and Go to page are the person's opens", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  await settle();
  w.switcher.back();
  expect(w.ui.cause().mover).toEqual({ by: "you" });
  expect(w.ui.get().route).toEqual(page("log"));

  w.clock.advance(1_000);
  w.stream(w.server.edit("docs"));
  expect(w.switcher.get().offer?.name).toBe("Docs");
  w.switcher.go();
  expect(w.ui.cause().mover).toEqual({ by: "you" });
  expect(w.ui.get().route).toEqual(page("docs"));
  expect(w.switcher.get().offer).toBe(null);
});

test("Go to page from the full Agent screen opens the page with the chat beside it", async () => {
  const w = windowOn({ view: "agent", id: CHAT, screen: "page" });
  w.ui.set({ panel: false });
  await w.switcher.start();
  // Opened a moment ago: the open counts as a touch, so the write is offered.
  w.ui.open("agent", CHAT);
  w.stream(w.server.edit("boards"));
  expect(w.switcher.get().offer?.name).toBe("Boards");
  w.switcher.go();
  expect(w.ui.get().route).toEqual(page("boards"));
  expect(w.ui.get().panel).toBe(true);
});

test("the offer belongs to its chat: another chat in the panel does not show it", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.ui.open("page", "log");
  w.stream(w.server.edit("boards"));
  expect(w.switcher.get().offer).not.toBe(null);
  w.ui.set({ chat: OTHER });
  expect(w.switcher.get().offer).toBe(null);
  w.ui.set({ chat: CHAT });
  expect(w.switcher.get().offer).not.toBe(null);
});

test("every context change is reported once; a change to nothing in the context is not", async () => {
  const w = windowOn();
  await w.switcher.start();
  await settle();
  const before = w.server.reports.length;
  w.ui.set({ dialog: true });
  w.ui.set({ expanded: new Set(["log"]) });
  await settle();
  expect(w.server.reports.length).toBe(before);
  w.ui.set({ panel: false });
  await settle();
  expect(w.server.reports.length).toBe(before + 1);
  expect(w.server.reports.at(-1)).toMatchObject({ context: { panel: false, chat: CHAT, agent: null } });
  expect(w.server.reports.at(-1)?.moved).toBe(undefined);
});

test("start after a reload in the middle of an agent's screen keeps it the agent's, and Go back to with it", async () => {
  const first = windowOn();
  await first.switcher.start();
  first.clock.advance(10 * MIN);
  first.stream(first.server.edit("boards"));
  await settle();

  // THE RELOAD: a new ui and a new switcher on the same window id and server.
  const ui = makeUi({ route: page("boards") });
  const history = makeHistoryStore({ transport: first.server.transport, now: first.clock.now });
  const again = makeSwitcher({ ui, history, window: WINDOW, pages: () => PAGES, now: first.clock.now, timing: T, after: first.clock.after });
  await again.start();
  expect(again.get().back).toEqual({ to: page("log"), name: "Log" });
});

test("start in a window the history has never seen claims the screen for the person", async () => {
  const w = windowOn(page("docs"));
  await w.switcher.start();
  await settle();
  expect(w.server.reports[0]?.moved).toEqual({ by: "claim" });
  expect(w.switcher.get().back).toBe(null);
});

test("a stream reopening after the server restarted says the context and whose it is again", async () => {
  const w = windowOn();
  await w.switcher.start();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  await settle();
  w.switcher.touched("boards");
  await settle();

  w.server.restart();
  const before = w.server.reports.length;
  await w.switcher.resync();
  await settle();
  const said = w.server.reports.slice(before);
  expect(said).toHaveLength(1);
  expect(said[0]).toMatchObject({ context: { address: page("boards") }, moved: { by: "claim" } });
});

test("a stream reopening onto a history that agrees says the context and nothing more", async () => {
  const w = windowOn();
  await w.switcher.start();
  await settle();
  const before = w.server.reports.length;
  await w.switcher.resync();
  await settle();
  expect(w.server.reports.slice(before).map((r) => r.moved)).toEqual([undefined]);
});

test("the view's listeners hear a change and not every repaint", async () => {
  const w = windowOn();
  let heard = 0;
  w.switcher.on(() => heard++);
  await w.switcher.start();
  const at = heard;
  w.ui.set({ dialog: true });
  w.ui.set({ dialog: false });
  expect(heard).toBe(at);
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  await settle();
  expect(heard).toBeGreaterThan(at);
});

test("a page deleted since is skipped: a write to it moves nothing, and Go back to names the work before it", async () => {
  const pages = [...PAGES];
  const w = windowOn(page("specs"), { pages: () => pages });
  await w.switcher.start();
  w.ui.open("page", "log");
  await settle();
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  await settle();
  expect(w.switcher.get().back?.name).toBe("Log");

  // Log is deleted: Go back to falls through to the work before it.
  pages.splice(0, 1);
  w.clock.advance(10_000);
  w.stream(w.server.edit("boards", CHAT, AGENT));
  await settle();
  expect(w.switcher.get().back?.name).toBe("Specs");

  // A write whose page is gone brings nothing up.
  const gone = w.server.edit("docs");
  pages.splice(pages.findIndex((p) => p.id === "docs"), 1);
  w.clock.advance(10_000);
  w.stream(gone);
  expect(w.ui.get().route.id).toBe("boards");
});

test("a page the person opens from the full Agent screen keeps the chat beside it, so the chat's next write is still followed", async () => {
  const w = windowOn({ view: "agent", id: CHAT, screen: "page" });
  w.ui.set({ panel: false });
  await w.switcher.start();
  // A click in the tree: nobody asked for the panel.
  w.ui.open("page", "log");
  expect(w.ui.get()).toMatchObject({ panel: true, chat: CHAT });
  w.clock.advance(10 * MIN);
  w.stream(w.server.edit("boards"));
  expect(w.ui.get().route).toEqual(page("boards"));
  expect(w.ui.get().panel).toBe(true);
});
