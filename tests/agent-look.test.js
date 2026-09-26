// SPDX-License-Identifier: AGPL-3.0-only
// THE AGENT SCREEN'S LOOK, run outside the box.
//
// Four things are held here, against the same source the box loads:
//
//   · the shim's `look.state` / `look.patch` hook in `guest/biom.js`, driven
//     through a stand-in port exactly as the host posts to it;
//   · the mount in `guest/plugins/biom-agent/`, which picks the look from its
//     variable and refuses one it cannot mount in words;
//   · the look's pure half, `biom-agent-look/model.js` — every decision it
//     makes before it touches a node, the markdown reading above all;
//   · the look itself, `biom-agent-look/look.js`, mounted into a SMALL FAKE
//     DOM fed by the real shim. The look uses a deliberately narrow set of DOM
//     calls, and the fake is exactly that set — so what is held is what the
//     look builds and asks for, never how a browser lays it out. That half is
//     `tests/e2e/agent-look.e2e.ts`, in a real box in a real browser.
//
// The fixtures are `tests/agent-look-fixtures.js`, and they are invented.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { lookState, cid } from "./agent-look-fixtures.js";

const glob = /** @type {any} */ (globalThis);
const read = (/** @type {string} */ rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");

/* ══ the shim's hook ═════════════════════════════════════════════════════ */

/** THE REAL SHIM, in a stand-in window, handed its two ports. Returns its
 *  `biom` and a function that delivers a host event on the guest port. */
function shim() {
  /** @type {Record<string, Function[]>} */
  const listeners = {};
  const win = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    parent: { postMessage() {} },
  });
  const doc = { querySelectorAll: () => [], documentElement: { style: { setProperty() {} } }, scrollingElement: null };
  new Function("window", "document", read("guest/biom.js"))(win, doc);
  /** @type {any} */
  const port = { onmessage: null, close() {}, postMessage(/** @type {any} */ m) {
    // Answer the shim's own start-up reads at once, so no call is left waiting.
    if (m && typeof m.id === "string") queueMicrotask(() => port.onmessage({ data: { id: m.id, g: 1, ok: true, value: m.kind === "data.get" ? {} : null } }));
  } };
  const other = { onmessage: null, close() {}, postMessage() {} };
  for (const fn of listeners.message || []) fn({ data: { kind: "ports", g: 1, page: "@agent" }, ports: [other, port] });
  return { biom: win.biom, hear: (/** @type {any} */ m) => port.onmessage({ data: m }) };
}

/** @param {number} seq @param {string} kind @param {Record<string, any>} [rest] */
const u = (seq, kind, rest = {}) => ({ seq, at: seq, turn: 1, kind, ...rest });
const tool = (/** @type {number} */ seq, /** @type {string} */ id, /** @type {string} */ status) =>
  u(seq, "tool", { tool: { id, title: "t", kind: "read", status, locations: [], diffs: [], output: "", truncated: false } });

test("the shim folds the look's patches: a patch before any state is dropped, and a late listener is handed the state whole", () => {
  const s = shim();
  s.hear({ kind: "look.patch", chat: null, chats: [] });
  /** @type {any[]} */
  const heard = [];
  s.biom.onLook((/** @type {any} */ state, /** @type {any} */ patch) => heard.push({ chat: state.chat, patch }));
  expect(heard).toEqual([]);
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [u(1, "prompt", { text: "hi" })] }) });
  expect(heard).toEqual([{ chat: cid("live"), patch: null }]);
  /** @type {any[]} */
  const late = [];
  s.biom.onLook((/** @type {any} */ state, /** @type {any} */ patch) => late.push([state.updates.length, patch]));
  expect(late).toEqual([[1, null]]);
});

test("a patch's words append only to the chat held, so a stale one after a switch adds nothing", () => {
  const s = shim();
  /** @type {any} */
  let held = null;
  /** @type {any[]} */
  const patches = [];
  s.biom.onLook((/** @type {any} */ state, /** @type {any} */ patch) => { held = state; if (patch) patches.push(patch); });
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [u(1, "prompt", { text: "a" })] }) });
  // The host switched to another chat; a patch for the one before is late.
  s.hear({ kind: "look.state", state: lookState({ chat: cid("done"), updates: [u(1, "prompt", { text: "b" })] }) });
  s.hear({ kind: "look.patch", chat: cid("live"), updates: [u(2, "reply", { text: "STALE" })] });
  expect(held.chat).toBe(cid("done"));
  expect(held.updates.map((/** @type {any} */ x) => x.text)).toEqual(["b"]);
  expect(patches[0].updates).toEqual([]);
  s.hear({ kind: "look.patch", chat: cid("done"), updates: [u(2, "reply", { text: "yes" })] });
  expect(held.updates.map((/** @type {any} */ x) => x.text)).toEqual(["b", "yes"]);
  expect(patches[1].updates.map((/** @type {any} */ x) => x.text)).toEqual(["yes"]);
});

test("an update already held is dropped, and a tool line is replaced where it stood and only by a later state", () => {
  const s = shim();
  /** @type {any} */
  let held = null;
  s.biom.onLook((/** @type {any} */ state) => { held = state; });
  // A kept log compacts a tool line to its LAST state where it FIRST stood:
  // seq 9 early, the words after it numbered lower.
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [u(1, "prompt", { text: "p" }), tool(9, "t1", "completed"), u(3, "reply", { text: "a" }), u(4, "reply", { text: "b" })] }) });
  s.hear({ kind: "look.patch", chat: cid("live"), updates: [u(4, "reply", { text: "b" }), u(8, "reply", { text: "old" }), u(10, "reply", { text: "c" }), tool(5, "t1", "in_progress")] });
  expect(held.updates.filter((/** @type {any} */ x) => x.kind === "reply").map((/** @type {any} */ x) => x.text)).toEqual(["a", "b", "c"]);
  expect(held.updates[1].tool.status).toBe("completed");
  s.hear({ kind: "look.patch", chat: cid("live"), updates: [tool(11, "t1", "failed"), tool(12, "t2", "pending")] });
  expect(held.updates.map((/** @type {any} */ x) => x.kind + (x.tool ? ":" + x.tool.id + ":" + x.tool.status : ""))).toEqual(["prompt", "tool:t1:failed", "reply", "reply", "reply", "tool:t2:pending"]);
  // A state that repeats a line compacts it to one.
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [tool(1, "t9", "pending"), tool(2, "t9", "completed"), u(3, "reply", { text: "x" })] }) });
  expect(held.updates.map((/** @type {any} */ x) => x.seq)).toEqual([2, 3]);
});

test("chats, names, input and beside replace what is held", () => {
  const s = shim();
  /** @type {any} */
  let held = null;
  s.biom.onLook((/** @type {any} */ state) => { held = state; });
  s.hear({ kind: "look.state", state: lookState({}) });
  s.hear({ kind: "look.patch", chat: null, chats: [], names: { a: { id: "home", name: "home" } }, input: { at: "bottom", height: 90 }, beside: null });
  expect(held.chats).toEqual([]);
  expect(held.names).toEqual({ a: { id: "home", name: "home" } });
  expect(held.input).toEqual({ at: "bottom", height: 90 });
  expect(held.beside).toBe(null);
});
