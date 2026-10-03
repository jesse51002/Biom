// SPDX-License-Identifier: AGPL-3.0-only
// THIS WINDOW'S COPY OF THE HISTORY: `client/store/history.js`.
//
// Against a transport stood in for, with answers the test releases by hand, so
// what goes out, in which order and when is what is asserted — a report that
// overtook the one before it, or a catch-up that kept an entry from a server
// that has since restarted, would each be a history that has the screen wrong.
//
// Every window, chat, agent and page id here is invented.

import { test, expect } from "bun:test";

import { makeHistoryStore } from "../client/store/history.js";

const WINDOW = "window-0001-invented";
const PLACE = { view: "page", uid: "u-notes-invented", screen: "page" };

/** @param {number} seq @param {Partial<Record<string, unknown>>} [more] */
const view = (seq, more = {}) => ({ kind: "view", seq, at: 1000 + seq, window: WINDOW, place: PLACE, writer: { kind: "you", window: WINDOW }, ...more });
/** @param {number} seq */
const edit = (seq) => ({
  kind: "edit", seq, at: 1000 + seq, place: PLACE, path: "pages/notes/content.yaml", via: "fs", snapshot: null,
  writer: { kind: "agent", agent: "agent-0001-invented", chat: "chat-0001-invented", harness: "Claude Code", turn: 1 },
});

/** A transport whose every call waits until the test answers it. */
function fakeTransport() {
  /** @type {{ req: any, answer: (value: unknown, ok?: boolean) => void }[]} */
  const calls = [];
  return {
    calls,
    /** @param {any} req */
    call(req) {
      return new Promise((resolve) => {
        calls.push({
          req,
          answer: (value, ok = true) => resolve(ok
            ? { id: req.id, g: 1, ok: true, value }
            : { id: req.id, g: 1, ok: false, error: { code: "unknown_kind", message: String(value), retryable: false } }),
        });
      });
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Keep console.warn quiet for one test and say what it would have said. */
function quiet() {
  const warn = console.warn;
  /** @type {string[]} */
  const said = [];
  console.warn = (/** @type {unknown} */ m) => said.push(String(m));
  return { said, done: () => { console.warn = warn; } };
}

test("entries are held once, in seq order, each with when THIS window got it and whether it came live", () => {
  let clock = 5;
  const history = makeHistoryStore({ transport: fakeTransport(), now: () => clock });
  /** @type {number[][]} */
  const heard = [];
  history.on((added) => heard.push(added.map((r) => r.entry.seq)));

  history.take([view(1), view(2)], true);
  clock = 9;
  history.take([view(2), view(3)]);
  expect(history.get().map((r) => r.entry.seq)).toEqual([1, 2, 3]);
  expect(history.get().map((r) => r.got)).toEqual([5, 5, 9]);
  expect(history.get().map((r) => r.live)).toEqual([true, true, false]);
  expect(history.head()).toBe(3);
  // The second batch told only what was new.
  expect(heard).toEqual([[1, 2], [3]]);
});

test("an entry that lands ahead of the one before it is put in its place, and head waits for the hole", () => {
  const history = makeHistoryStore({ transport: fakeTransport(), now: () => 0 });
  history.take([view(1)]);
  history.take([view(3)]);
  expect(history.head()).toBe(1);
  history.take([view(2)]);
  expect(history.get().map((r) => r.entry.seq)).toEqual([1, 2, 3]);
  expect(history.head()).toBe(3);
});

test("a hole in the LIVE feed is filled from head; a report's answer landing early is not a hole", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  history.take([view(1)], true);
  history.take([view(4)], false);
  expect(transport.calls).toHaveLength(0);

  history.take([view(5)], true);
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]?.req).toMatchObject({ kind: "history.read", since: 1 });
  transport.calls[0]?.answer({ entries: [view(2), view(3), view(4), view(5)], head: 5 });
  await tick();
  expect(history.get().map((r) => r.entry.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(history.head()).toBe(5);
  // What the fill read back is the past, and nothing follows the past.
  expect(history.get().find((r) => r.entry.seq === 2)?.live).toBe(false);
});

test("a server whose head is behind ours restarted, and the fill becomes a whole catch-up", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  history.take([view(1), view(2), view(3)]);
  history.take([view(9)], true);
  transport.calls[0]?.answer({ entries: [], head: 1 });
  await tick();
  expect(transport.calls[1]?.req.kind).toBe("history.read");
  expect(transport.calls[1]?.req.since).toBe(undefined);
});

test("a catch-up replaces everything, and keeps only what the stream brought while it read", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  // Held from a server that has since restarted: seq 7 and 8 mean other things now.
  history.take([view(7), view(8)]);
  const caught = history.catchUp();
  expect(transport.calls[0]?.req).toMatchObject({ kind: "history.read" });
  // The new server's stream, live, while the read is in flight.
  history.take([edit(4)], true);
  transport.calls[0]?.answer({ entries: [view(1), view(2), view(3)], head: 3 });
  await caught;
  expect(history.get().map((r) => r.entry.seq)).toEqual([1, 2, 3, 4]);
  expect(history.get()[3]?.live).toBe(true);
  expect(history.head()).toBe(4);
});

test("a second catch-up asked for while one reads runs once more after it, not alongside it", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  const one = history.catchUp();
  const two = history.catchUp();
  expect(transport.calls).toHaveLength(1);
  transport.calls[0]?.answer({ entries: [view(1)], head: 1 });
  await tick();
  expect(transport.calls).toHaveLength(2);
  transport.calls[1]?.answer({ entries: [view(1), view(2)], head: 2 });
  await Promise.all([one, two]);
  expect(history.head()).toBe(2);
});

test("REPORTS GO ONE AT A TIME, in order, each answer taken before the next leaves", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  const context = { address: { view: "page", id: "notes", screen: "page" }, panel: false, chat: null, agent: null };
  const first = history.report(context, { by: "you" });
  const second = history.report({ ...context, panel: true });
  await tick();
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]?.req).toMatchObject({ kind: "window.report", moved: { by: "you" } });
  expect(history.unanswered()).toHaveLength(1);

  transport.calls[0]?.answer([{ ...view(1), kind: "open" }, view(2)]);
  expect(await first).toHaveLength(2);
  expect(history.get().map((r) => r.entry.seq)).toEqual([1, 2]);
  expect(history.unanswered()).toHaveLength(0);
  await tick();
  // A plain report moves nothing and is not in flight as a move.
  expect(transport.calls[1]?.req).not.toHaveProperty("moved");
  transport.calls[1]?.answer([]);
  expect(await second).toEqual([]);
});

test("A CALL RUN IN LINE WITH THE REPORTS leaves once every report made before it is answered, and a report made after it waits for its answer", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  const at = (/** @type {string} */ id) => ({ address: { view: "page", id, screen: "page" }, panel: true, chat: null, agent: null });
  /** @type {string[]} */
  const order = [];
  /** @type {() => void} */
  let release = () => {};
  const ids = () => transport.calls.map((c) => c.req.context.address.id);

  history.report(at("notes"), { by: "you" });
  const sent = history.inLine(async () => {
    order.push("sent");
    await new Promise((r) => { release = () => r(undefined); });
    return "answered";
  });
  const after = history.report(at("other"), { by: "you" });
  await tick();
  // Only the report made before it is out, and the call waits for its answer.
  expect(ids()).toEqual(["notes"]);
  expect(order).toEqual([]);
  transport.calls[0]?.answer([]);
  await tick();
  expect(order).toEqual(["sent"]);
  // The report made after it waits for the call's own answer.
  expect(ids()).toEqual(["notes"]);
  release();
  expect(await sent).toBe("answered");
  await tick();
  expect(ids()).toEqual(["notes", "other"]);
  transport.calls[1]?.answer([]);
  await after;

  // A call that fails is its caller's to hear, and the reports go on.
  await expect(history.inLine(async () => { throw new Error("refused"); })).rejects.toThrow("refused");
  history.report(at("third"));
  await tick();
  expect(ids()).toEqual(["notes", "other", "third"]);
});

test("a refused report is said once, however many follow it, and stops being in flight", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  const context = { address: { view: "page", id: "notes", screen: "page" }, panel: false, chat: null, agent: null };
  const shh = quiet();
  try {
    const a = history.report(context, { by: "claim" });
    await tick();
    transport.calls[0]?.answer("not a request this host answers", false);
    await a;
    const b = history.report(context, { by: "claim" });
    await tick();
    transport.calls[1]?.answer("not a request this host answers", false);
    await b;
  } finally {
    shh.done();
  }
  expect(history.unanswered()).toHaveLength(0);
  expect(shh.said).toHaveLength(1);
});

test("an entry that is not the contract's shape is skipped, and the rest are taken", () => {
  const history = makeHistoryStore({ transport: fakeTransport(), now: () => 0 });
  const shh = quiet();
  try {
    history.take([view(1), /** @type {any} */ ({ kind: "view", seq: 2 }), view(3)]);
  } finally {
    shh.done();
  }
  expect(history.get().map((r) => r.entry.seq)).toEqual([1, 3]);
});

test("a window keeps no more than its limit, oldest out first", () => {
  const history = makeHistoryStore({ transport: fakeTransport(), now: () => 0, limit: 3 });
  history.take([view(1), view(2), view(3), view(4), view(5)]);
  expect(history.get().map((r) => r.entry.seq)).toEqual([3, 4, 5]);
  expect(history.head()).toBe(5);
});

test("a catch-up tells what it read back, and never again what the stream told while it read", async () => {
  const transport = fakeTransport();
  const history = makeHistoryStore({ transport, now: () => 0 });
  /** @type {[number, boolean][][]} */
  const heard = [];
  history.on((added) => heard.push(added.map((r) => [r.entry.seq, r.live])));
  const caught = history.catchUp();
  history.take([edit(3)], true);
  transport.calls[0]?.answer({ entries: [view(1), view(2)], head: 2 });
  await caught;
  expect(heard).toEqual([[[3, true]], [[1, false], [2, false]]]);
});
