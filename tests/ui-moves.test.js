// SPDX-License-Identifier: AGPL-3.0-only
// WHO MOVED THE SCREEN: the three moves of `client/store/ui.js` and the cause
// each one leaves beside the route.
//
// Only the person and the switcher move the screen (*History and View
// Switcher*, `switcher`), and the history records them differently — an open
// by the person, a view under an agent — so every route change says who made
// it. The switcher reports that and the shell decides the address bar from it;
// a cause that lied would be a history that lied.
//
// Chat ids here are invented.

import { test, expect } from "bun:test";

import { makeUi } from "../client/store/ui.js";

const CHAT = "chat-0001-invented";
const AGENT = "agent-0001-invented";

test("the route a window loads with is move 0, and it is nobody's", () => {
  const ui = makeUi({ route: { view: "page", id: "notes", screen: "page" } });
  expect(ui.cause()).toEqual({ seq: 0, mover: { by: "system" }, replace: true });
});

test("an open is the person's, a new entry in the browser's history, and it always emits", () => {
  const ui = makeUi({ route: { view: "page", id: "notes", screen: "page" } });
  let heard = 0;
  ui.on(() => heard++);

  ui.open("page", "board");
  expect(ui.get().route).toEqual({ view: "page", id: "board", screen: "page" });
  expect(ui.cause()).toEqual({ seq: 1, mover: { by: "you" }, replace: false });

  // THE PAGE THEY ARE ON, OPENED AGAIN, IS STILL AN OPEN. It makes a screen the
  // switcher brought up the person's, so it must reach the listeners.
  ui.open("page", "board");
  expect(heard).toBe(2);
  expect(ui.cause().seq).toBe(2);
});

test("an open closes the inserter and can open the chat panel in the same move", () => {
  const ui = makeUi({ route: { view: "agent", id: CHAT, screen: "page" }, inserting: 3 });
  ui.open("page", "notes", "page", true);
  const u = ui.get();
  expect(u.inserting).toBe(null);
  expect(u.panel).toBe(true);
  // The chat the window had open stays open, now in the panel.
  expect(u.chat).toBe(CHAT);
});

test("the switcher's move always opens the panel and says which agent it followed", () => {
  const ui = makeUi({ route: { view: "agent", id: CHAT, screen: "page" } });
  ui.follow({ view: "page", id: "board", screen: "page" }, { agent: AGENT, chat: CHAT }, false);
  const u = ui.get();
  expect(u.route).toEqual({ view: "page", id: "board", screen: "page" });
  // NEVER A BARE PAGE WITH THE CHAT GONE (the owner's decision of 2026-09-26).
  expect(u.panel).toBe(true);
  expect(u.chat).toBe(CHAT);
  expect(ui.cause()).toEqual({ seq: 1, mover: { by: "switcher", agent: AGENT, chat: CHAT }, replace: false });

  ui.follow({ view: "page", id: "notes", screen: "page" }, { agent: AGENT, chat: CHAT }, true);
  expect(ui.cause().replace).toBe(true);
});

test("a system move replaces the entry, and says nobody moved it", () => {
  const ui = makeUi({ route: { view: "page", id: "old", screen: "instructions" } });
  ui.go("page", "new", "instructions");
  expect(ui.get().route).toEqual({ view: "page", id: "new", screen: "instructions" });
  expect(ui.cause()).toEqual({ seq: 1, mover: { by: "system" }, replace: true });
});

test("a route written through set is counted as nobody's; a set that does not move the route is not a move", () => {
  const ui = makeUi({ route: { view: "page", id: "notes", screen: "page" } });
  ui.set({ dialog: true });
  expect(ui.cause().seq).toBe(0);
  ui.set({ route: { view: "page", id: "notes", screen: "instructions" } });
  expect(ui.cause()).toEqual({ seq: 1, mover: { by: "system" }, replace: true });
  // The same route object again is no move at all.
  ui.set({ route: ui.get().route });
  expect(ui.cause().seq).toBe(1);
});

test("the cause is written before the listeners hear the move", () => {
  const ui = makeUi();
  /** @type {string[]} */
  const seen = [];
  ui.on(() => seen.push(ui.cause().mover.by));
  ui.open("page", "a");
  ui.follow({ view: "page", id: "b", screen: "page" }, { agent: AGENT, chat: CHAT }, false);
  ui.go("page", "c");
  expect(seen).toEqual(["you", "switcher", "system"]);
});
