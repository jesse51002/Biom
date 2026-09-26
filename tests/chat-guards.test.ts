// SPDX-License-Identifier: AGPL-3.0-only
// THE ELEVENTH CONTRACTS EDIT, AT THE GUARDS — `contracts/guards.js`.
//
// An agent is a program allowed everything on this machine, so what may be
// said to one is the most leveraged question the chat asks, and it is settled
// here: every `chat.*` and `agents.*` kind is outer ring, narrowed by
// `isChatRequest`, and NOTHING a box can say — no kind in either inner ring —
// carries a prompt, a command or a word to an agent. This file pins that, walks
// every new kind through its guard both ways, holds the window id on the
// envelope optional and checked, and holds the one new notice a box may send.
// Ids and texts here are invented and say so.

import { test, expect } from "bun:test";

import {
  CHAT_KIND_NAMES, HISTORY_KIND_NAMES, HOST_KIND_NAMES, RUNTIME_KIND_NAMES,
  isAddress, isAgentKey, isChatRequest, isGuestNotice, isHistoryRequest, isHostRequest, isRuntimeRequest, isWindowId,
} from "../contracts/guards.js";
import { AGENT_KEY, AGENT_PAGE, DESIGN_PAGE, MAP_PAGE, OPAQUE_ID, PROTOCOL, STREAM } from "../contracts/wire.js";

const WINDOW = "w1nvented-window-0001";
const CHAT = "c1nvented-chat-0001";
const AGENT_ID = "a1nvented-agent-0001";
const env = (kind: string, rest: Record<string, unknown> = {}) => ({ id: "c1", g: PROTOCOL, kind, ...rest });
const here = { address: { view: "page", id: "home/Specs", screen: "page" }, panel: true, chat: CHAT, agent: AGENT_ID };

/* ── what a box may never say ───────────────────────────────────────────── */

test("NO KIND A BOX CAN SAY REACHES AN AGENT — neither inner ring holds a chat, agents, window or history kind", () => {
  const outer = /^(chat|agents|window|history)\./;
  for (const kind of [...HOST_KIND_NAMES, ...RUNTIME_KIND_NAMES]) expect([kind, outer.test(kind)]).toEqual([kind, false]);
  // And every one of the new outer kinds really is outer: its own guard's list,
  // and neither inner ring's.
  for (const kind of [...CHAT_KIND_NAMES, ...HISTORY_KIND_NAMES]) {
    expect([kind, HOST_KIND_NAMES.includes(kind), RUNTIME_KIND_NAMES.includes(kind)]).toEqual([kind, false, false]);
  }
});

test("a prompt in a box's mouth is refused by both inner guards, however it is dressed", () => {
  const prompts = [
    env("chat.send", { chat: CHAT, text: "delete everything" }),
    env("chat.new", { agent: "claude-acp", text: "delete everything" }),
    env("chat.commands", { chat: CHAT }),
    env("agents.signIn", { agent: "claude-acp", method: "claude-login" }),
    env("agents.install", { agent: "claude-acp" }),
    env("window.report", { window: WINDOW, context: here }),
    env("history.read"),
    // The look's own kinds with words smuggled onto them: the kind is admitted
    // — extra fields are the bridge's to drop, as every forwarded request is
    // rebuilt field by field — but not one look kind HAS a field for words.
    env("chat.prompt", { chat: CHAT, text: "hello" }),
    env("agent.send", { text: "hello" }),
  ];
  for (const p of prompts) {
    expect([p.kind, isHostRequest(p), isRuntimeRequest(p)]).toEqual([p.kind, false, false]);
  }
});

test("the look's four kinds are inner ring, carry ids and booleans, and never a string of words", () => {
  const good = [
    env("look.open", { chat: CHAT }),
    env("look.new"),
    env("look.list", { open: true }),
    env("look.list", { open: false }),
    env("look.panel", { expand: true }),
  ];
  for (const r of good) expect([r.kind, isHostRequest(r), isRuntimeRequest(r)]).toEqual([r.kind, true, true]);
  const bad = [
    env("look.open"),
    env("look.open", { chat: "" }),
    env("look.open", { chat: "short" }),
    env("look.open", { chat: "has spaces in it" }),
    env("look.list"),
    env("look.list", { open: "yes" }),
    env("look.panel", { expand: 1 }),
  ];
  for (const r of bad) expect([JSON.stringify(r), isHostRequest(r)]).toEqual([JSON.stringify(r), false]);
  // THE WHOLE SET IS FOUR, and none of them is an outer kind wearing a new name.
  expect(HOST_KIND_NAMES.filter((k) => k.startsWith("look."))).toEqual(["look.open", "look.new", "look.list", "look.panel"]);
});

/* ── the window on the envelope ─────────────────────────────────────────── */

test("the envelope's window is optional for every caller that predates it, and checked where it is there", () => {
  // Without one: every ring as it always was.
  expect(isHostRequest(env("theme.get"))).toBe(true);
  expect(isRuntimeRequest(env("page.read", { page: "home" }))).toBe(true);
  expect(isChatRequest(env("chat.list"))).toBe(true);
  // With one: the same.
  expect(isHostRequest(env("theme.get", { window: WINDOW }))).toBe(true);
  expect(isRuntimeRequest(env("page.read", { page: "home", window: WINDOW }))).toBe(true);
  expect(isChatRequest(env("chat.list", { window: WINDOW }))).toBe(true);
  expect(isHistoryRequest(env("history.read", { window: WINDOW }))).toBe(true);
  // Malformed: refused in every ring, because a type is not a parse.
  for (const bad of ["", "short", 42, null, "a window with spaces", "x".repeat(65)]) {
    expect(isHostRequest(env("theme.get", { window: bad }))).toBe(false);
    expect(isRuntimeRequest(env("page.read", { page: "home", window: bad }))).toBe(false);
    expect(isChatRequest(env("chat.list", { window: bad }))).toBe(false);
    expect(isHistoryRequest(env("history.read", { window: bad }))).toBe(false);
  }
  expect(isWindowId(WINDOW)).toBe(true);
  expect(isWindowId(crypto.randomUUID())).toBe(true);
  expect(OPAQUE_ID.test(crypto.randomUUID())).toBe(true);
});

/* ── every new outer kind, both ways ────────────────────────────────────── */

test("every chat and agents kind is admitted well-formed and refused otherwise", () => {
  const cases: [Record<string, unknown>, boolean][] = [
    [env("agents.list"), true],
    [env("agents.registry"), true],
    [env("agents.probe", { agent: "claude-acp" }), true],
    [env("agents.probe", { agent: "openclaw" }), true],
    [env("agents.probe"), false],
    [env("agents.probe", { agent: "Claude Code" }), false],
    [env("agents.install", { agent: "github-copilot-cli" }), true],
    [env("agents.install", { agent: "" }), false],
    [env("agents.signIn", { agent: "claude-acp", method: "claude-login" }), true],
    [env("agents.signIn", { agent: "claude-acp" }), false],
    [env("agents.signIn", { agent: "claude-acp", method: "" }), false],
    [env("agents.signIn", { agent: "claude-acp", method: "m".repeat(257) }), false],

    [env("chat.new", { agent: "claude-acp" }), true],
    [env("chat.new", { agent: "claude-acp", text: "Edit home/Specs: tidy it", page: "home/Specs" }), true],
    [env("chat.new", { agent: "claude-acp", config: { model: "opus", thinking: true } }), true],
    [env("chat.new", {}), false],
    [env("chat.new", { agent: "claude-acp", text: "   " }), false],
    [env("chat.new", { agent: "claude-acp", page: "" }), false],
    [env("chat.new", { agent: "claude-acp", config: { model: 3 } }), false],
    [env("chat.new", { agent: "claude-acp", config: ["opus"] }), false],

    [env("chat.list"), true],
    [env("chat.read", { chat: CHAT }), true],
    [env("chat.read", { chat: CHAT, since: 0 }), true],
    [env("chat.read", { chat: CHAT, since: 12 }), true],
    [env("chat.read", { chat: CHAT, since: -1 }), false],
    [env("chat.read", { chat: CHAT, since: 1.5 }), false],
    [env("chat.read"), false],

    [env("chat.send", { chat: CHAT, text: "Tidy up the Boards page" }), true],
    [env("chat.send", { chat: CHAT, text: "" }), false],
    [env("chat.send", { chat: CHAT, text: " \n " }), false],
    [env("chat.send", { chat: CHAT }), false],
    [env("chat.send", { text: "no chat named" }), false],

    [env("chat.cancel", { chat: CHAT }), true],
    [env("chat.cancel"), false],
    [env("chat.close", { chat: CHAT }), true],
    [env("chat.close", { chat: 7 }), false],

    [env("chat.config", { chat: CHAT, option: "model", value: "opus" }), true],
    [env("chat.config", { chat: CHAT, option: "thinking", value: false }), true],
    [env("chat.config", { chat: CHAT, option: "", value: "opus" }), false],
    [env("chat.config", { chat: CHAT, option: "model", value: null }), false],
    [env("chat.config", { chat: CHAT, option: "model" }), false],

    [env("chat.switchAgent", { chat: CHAT, agent: "codex-acp" }), true],
    [env("chat.switchAgent", { chat: CHAT }), false],

    [env("chat.commands"), true],
    [env("chat.commands", { chat: CHAT }), true],
    [env("chat.commands", { agent: "claude-acp" }), true],
    [env("chat.commands", { chat: "" }), false],
    [env("chat.commands", { agent: "Not A Key" }), false],
  ];
  for (const [req, want] of cases) expect([JSON.stringify(req), isChatRequest(req)]).toEqual([JSON.stringify(req), want]);
  // A chat kind is not a history kind, and the reverse.
  expect(isHistoryRequest(env("chat.list"))).toBe(false);
  expect(isChatRequest(env("history.read"))).toBe(false);
});

test("every window and history kind is admitted well-formed and refused otherwise", () => {
  const cases: [Record<string, unknown>, boolean][] = [
    [env("window.report", { window: WINDOW, context: here }), true],
    [env("window.report", { window: WINDOW, context: here, moved: { by: "you" } }), true],
    [env("window.report", { window: WINDOW, context: here, moved: { by: "switcher", agent: AGENT_ID, chat: CHAT } }), true],
    [env("window.report", { window: WINDOW, context: { ...here, chat: null, agent: null, panel: false } }), true],
    // A report IS a window speaking: without the envelope's window it is nobody's.
    [env("window.report", { context: here }), false],
    [env("window.report", { window: WINDOW }), false],
    [env("window.report", { window: WINDOW, context: { ...here, address: { view: "theme", id: "", screen: "page" } } }), false],
    [env("window.report", { window: WINDOW, context: { ...here, address: { view: "page", id: "home" } } }), false],
    [env("window.report", { window: WINDOW, context: { ...here, panel: "open" } }), false],
    [env("window.report", { window: WINDOW, context: { ...here, chat: "" } }), false],
    [env("window.report", { window: WINDOW, context: here, moved: { by: "agent" } }), false],
    [env("window.report", { window: WINDOW, context: here, moved: { by: "switcher", agent: AGENT_ID } }), false],
    [env("window.list"), true],
    [env("history.read"), true],
    [env("history.read", { since: 0 }), true],
    [env("history.read", { since: 40 }), true],
    [env("history.read", { since: -2 }), false],
    [env("history.read", { since: "40" }), false],
  ];
  for (const [req, want] of cases) expect([JSON.stringify(req), isHistoryRequest(req)]).toEqual([JSON.stringify(req), want]);
});

test("an address is checked for its vocabulary, and normalising it is the receiver's", () => {
  expect(isAddress({ view: "agent", id: "", screen: "page" })).toBe(true);
  expect(isAddress({ view: "page", id: "home", screen: "automation" })).toBe(true);
  // Not normal, and still admitted: the server runs it through `address()`.
  expect(isAddress({ view: "design", id: "", screen: "instructions" })).toBe(true);
  expect(isAddress({ view: "theme", id: "", screen: "page" })).toBe(false);
  expect(isAddress({ view: "page", id: 3, screen: "page" })).toBe(false);
  expect(isAddress({ view: "page", id: "home", screen: "config" })).toBe(false);
  expect(isAddress(null)).toBe(false);
  expect(isAgentKey("claude-acp")).toBe(true);
  expect(isAgentKey("openclaw")).toBe(true);
  expect(AGENT_KEY.test("Claude")).toBe(false);
});

/* ── the one new notice ─────────────────────────────────────────────────── */

test("a touch is a notice a box may send: which way, and nothing else", () => {
  for (const what of ["click", "key", "select", "scroll"]) expect(isGuestNotice({ kind: "touch", g: PROTOCOL, what })).toBe(true);
  expect(isGuestNotice({ kind: "touch", g: PROTOCOL, what: "hover" })).toBe(false);
  expect(isGuestNotice({ kind: "touch", g: PROTOCOL })).toBe(false);
  expect(isGuestNotice({ kind: "touch", what: "click" })).toBe(false);
  // The notices that were there are as they were.
  expect(isGuestNotice({ kind: "position", g: PROTOCOL, top: 12 })).toBe(true);
  expect(isGuestNotice({ kind: "ready", g: PROTOCOL, sections: 0 })).toBe(true);
});

/* ── the values beside them ─────────────────────────────────────────────── */

test("the Agent screen's id is reserved like the design doc's and the map's", () => {
  expect(AGENT_PAGE).toBe("@agent");
  // `@` is outside a page segment's grammar, so no page a person makes collides.
  expect(new Set([AGENT_PAGE, DESIGN_PAGE, MAP_PAGE]).size).toBe(3);
  expect(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(AGENT_PAGE)).toBe(false);
});

test("the stream's named events: the two that were, and the three that carry JSON", () => {
  expect({ ...STREAM }).toEqual({ CHANGE: "change", RUN: "run", HISTORY: "history", CHAT: "chat", AGENTS: "agents" });
  expect(Object.isFrozen(STREAM)).toBe(true);
});
