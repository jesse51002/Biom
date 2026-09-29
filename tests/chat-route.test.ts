// SPDX-License-Identifier: AGPL-3.0-only
// THE AGENT, CHAT AND HISTORY KINDS ON THE API ROUTE — `server/api/routes.ts`.
//
// Every case is walked against recording fakes of the three modules: a
// well-formed request reaches exactly the one call its kind is, with exactly
// the fields the guard checked; a malformed one is refused `bad_request`
// before any module is touched; a refusal a module throws with a closed code
// is said in its own sentence, and anything else is `internal` with none of
// its words; a build with no agents answers `unsupported`. The gate half —
// every local kind refused without this machine's capability — is walked
// here through `route`'s own `gate`, and on a real server in
// `local-gate.test.ts`. Every id, key and word here is invented.

import { test, expect } from "bun:test";

import { handle, route } from "../server/api/routes.ts";
import type { Deps } from "../server/api/routes.ts";
import { CHAT_KIND_NAMES, HISTORY_KIND_NAMES, isLocalKind } from "../contracts/guards.js";
import { PROTOCOL } from "../contracts/wire.js";
import type { ApiRequest, ApiResponse } from "../contracts/types.ts";

const CHAT = "chat-invented-0001";
const WINDOW = "window-invented-01";
const AGENT = "claude-acp";
const HERE = { address: { view: "page", id: "home", screen: "page" }, panel: true, chat: CHAT, agent: null };

type Call = [string, ...unknown[]];

/** Fakes that record every call and answer something recognisable. */
function world(over: { throwWith?: unknown; onScreen?: Deps["onScreen"] } = {}) {
  const calls: Call[] = [];
  const answer = (name: string, value: unknown) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    if (over.throwWith !== undefined) throw over.throwWith;
    return value;
  };
  const later = (name: string, value: unknown) => async (...args: unknown[]) => answer(name, value)(...args);
  const agents = {
    list: answer("agents.list", [{ key: AGENT }]),
    probe: answer("agents.probe", { key: AGENT, reason: "checking" }),
    start: answer("agents.start", { key: "openclaw", reason: "checking" }),
    registry: later("agents.registry", [{ key: "gemini" }]),
    install: answer("agents.install", { key: AGENT, reason: "installing" }),
    signIn: later("agents.signIn", { kind: "agent" }),
  };
  const chats = {
    loaded: Promise.resolve(),
    create: later("chat.create", { id: CHAT }),
    list: answer("chat.list", [{ id: CHAT }]),
    read: later("chat.read", { chat: { id: CHAT }, updates: [] }),
    send: later("chat.send", { chat: { id: CHAT, phase: "running" }, queued: { id: "q1nvented-queued-01", place: 1 } }),
    sendQueued: later("chat.sendQueued", { id: CHAT }),
    unqueue: later("chat.unqueue", { id: CHAT }),
    sendNow: later("chat.sendNow", { id: CHAT }),
    cancel: later("chat.cancel", { id: CHAT }),
    config: later("chat.config", { id: CHAT }),
    switchAgent: later("chat.switchAgent", { id: CHAT }),
    close: later("chat.close", { id: CHAT }),
    commands: later("chat.commands", [{ name: "review" }]),
    delete: later("chat.delete", undefined),
  };
  const settings = {
    read: answer("settings.read", { agent: null, agents: {} }),
  };
  const history = {
    report: later("history.report", [{ kind: "view", seq: 1 }]),
    windows: answer("history.windows", [{ window: WINDOW }]),
    read: answer("history.read", { entries: [], head: 7 }),
    edit: later("history.edit", null),
  };
  const deps = { agents, chats, history, settings, ...(over.onScreen ? { onScreen: over.onScreen } : {}) } as unknown as Deps;
  let n = 0;
  const call = (o: Record<string, unknown>): Promise<ApiResponse> => handle({ id: `r${++n}`, g: PROTOCOL, ...o } as ApiRequest, deps);
  return { calls, call, deps };
}

const value = (r: ApiResponse): unknown => {
  if (!r.ok) throw new Error(`refused: ${r.error.code} ${r.error.message}`);
  return r.value;
};
const code = (r: ApiResponse): string | null => (r.ok ? null : r.error.code);

test("EVERY AGENT AND CHAT KIND reaches exactly its one call, with the fields the guard checked and nothing else", async () => {
  const cases: [Record<string, unknown>, Call][] = [
    [{ kind: "agents.list" }, ["agents.list"]],
    [{ kind: "agents.probe", agent: AGENT }, ["agents.probe", AGENT]],
    [{ kind: "agents.start", agent: "openclaw" }, ["agents.start", "openclaw"]],
    [{ kind: "agents.registry" }, ["agents.registry"]],
    [{ kind: "agents.install", agent: AGENT }, ["agents.install", AGENT]],
    [{ kind: "agents.signIn", agent: AGENT, method: "invented-login" }, ["agents.signIn", AGENT, "invented-login"]],
    // A field the guard does not name does not ride along into the chat.
    [{ kind: "chat.new", agent: AGENT, text: "hello", page: "home", config: { model: "fast" }, smuggled: "x" },
      ["chat.create", { agent: AGENT, text: "hello", page: "home", config: { model: "fast" } }]],
    [{ kind: "chat.new" }, ["chat.create", {}]],
    [{ kind: "chat.list" }, ["chat.list"]],
    [{ kind: "chat.read", chat: CHAT, since: 4 }, ["chat.read", CHAT, 4]],
    [{ kind: "chat.read", chat: CHAT }, ["chat.read", CHAT, undefined]],
    [{ kind: "chat.send", chat: CHAT, text: "go on" }, ["chat.send", CHAT, "go on", null]],
    [{ kind: "chat.cancel", chat: CHAT }, ["chat.cancel", CHAT]],
    [{ kind: "chat.config", chat: CHAT, option: "model", value: "fast" }, ["chat.config", CHAT, "model", "fast"]],
    [{ kind: "chat.config", chat: CHAT, option: "thinking", value: true }, ["chat.config", CHAT, "thinking", true]],
    [{ kind: "chat.switchAgent", chat: CHAT, agent: "gemini" }, ["chat.switchAgent", CHAT, "gemini"]],
    [{ kind: "chat.close", chat: CHAT }, ["chat.close", CHAT]],
    [{ kind: "chat.commands", chat: CHAT }, ["chat.commands", { chat: CHAT }]],
    [{ kind: "chat.commands", agent: AGENT }, ["chat.commands", { agent: AGENT }]],
    [{ kind: "chat.commands" }, ["chat.commands", {}]],
    [{ kind: "chat.delete", chat: CHAT, confirmed: true }, ["chat.delete", CHAT]],
    [{ kind: "chat.sendQueued", chat: CHAT }, ["chat.sendQueued", CHAT]],
    [{ kind: "chat.unqueue", chat: CHAT, queued: "q1nvented-queued-01", text: "smuggled" }, ["chat.unqueue", CHAT, "q1nvented-queued-01"]],
    // The words are the queued message's own: none ride along on Send now.
    [{ kind: "chat.sendNow", chat: CHAT, queued: "q1nvented-queued-01", text: "smuggled" }, ["chat.sendNow", CHAT, "q1nvented-queued-01"]],
    [{ kind: "settings.read" }, ["settings.read"]],
  ];
  const seen = new Set<string>();
  for (const [req, want] of cases) {
    const w = world();
    const r = await w.call(req);
    expect([req.kind, r.ok]).toEqual([req.kind, true]);
    expect([req.kind, w.calls]).toEqual([req.kind, [want]]);
    seen.add(String(req.kind));
  }
  // Every kind in the contract's list is walked above.
  expect([...seen].sort()).toEqual([...CHAT_KIND_NAMES].sort());
});

test("A MALFORMED AGENT OR CHAT REQUEST IS REFUSED before any module hears of it", async () => {
  const bad: Record<string, unknown>[] = [
    { kind: "agents.probe" },
    { kind: "agents.probe", agent: "Claude Code" },
    { kind: "agents.install", agent: "" },
    { kind: "agents.signIn", agent: AGENT },
    { kind: "chat.new", text: "   " },
    { kind: "chat.new", config: { model: { deep: true } } },
    { kind: "chat.read", chat: CHAT, since: -1 },
    { kind: "chat.read", chat: "short" },
    { kind: "chat.send", chat: CHAT, text: "" },
    { kind: "chat.send", chat: CHAT },
    { kind: "chat.config", chat: CHAT, option: "", value: "x" },
    { kind: "chat.config", chat: CHAT, option: "model", value: 3 },
    { kind: "chat.switchAgent", chat: CHAT },
    { kind: "chat.cancel" },
    { kind: "chat.commands", chat: 7 },
    { kind: "chat.delete" },
    { kind: "chat.delete", chat: "short" },
    { kind: "chat.sendQueued" },
    { kind: "chat.unqueue", chat: CHAT },
    { kind: "chat.unqueue", chat: CHAT, queued: "has spaces in it" },
    { kind: "chat.sendNow", chat: CHAT },
    { kind: "chat.sendNow", queued: "q1nvented-queued-01" },
    { kind: "chat.sendNow", chat: CHAT, queued: "short" },
  ];
  for (const req of bad) {
    const w = world();
    const r = await w.call(req);
    expect([req, code(r)]).toEqual([req, "bad_request"]);
    expect([req, w.calls]).toEqual([req, []]);
  }
});

test("NOTHING IS SET FROM A WINDOW: `settings.set`, which kept the view, is no kind the route answers, and no module hears of it", async () => {
  for (const req of [{ kind: "settings.set", view: "plain" }, { kind: "settings.set" }]) {
    const w = world();
    const r = await w.call(req);
    expect([req, code(r)]).toEqual([req, "unknown_kind"]);
    expect([req, w.calls]).toEqual([req, []]);
  }
});

test("a module's own refusal is said in its own sentence; anything else is `internal` and says none of its words", async () => {
  const refused = world({ throwWith: Object.assign(new Error("one message at a time: this chat's turn is still going"), { code: "limit" }) });
  const r = await refused.call({ kind: "chat.send", chat: CHAT, text: "again" });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.code).toBe("limit");
    expect(r.error.message).toBe("one message at a time: this chat's turn is still going");
  }

  const missing = world({ throwWith: Object.assign(new Error("No agent by that name is on this machine."), { code: "not_found" }) });
  expect(code(await missing.call({ kind: "agents.probe", agent: "gemini" }))).toBe("not_found");

  // An error with no code is the host failing, and an agent's words can be
  // anywhere in one — none of them reaches the caller.
  const broke = world({ throwWith: new Error("ENOENT /home/someone/.secret TOKEN=abc") });
  const said: unknown[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => { said.push(a); };
  let r2: ApiResponse;
  try {
    r2 = await broke.call({ kind: "chat.list" });
  } finally {
    console.error = was;
  }
  expect(code(r2)).toBe("internal");
  expect(JSON.stringify(r2)).not.toContain("TOKEN");
  expect(JSON.stringify(said)).not.toContain("TOKEN");
});

test("A MESSAGE CARRIES THE PAGE ON SCREEN IN THE WINDOW THAT SENT IT, asked by the envelope's window; one that cannot be said goes without it", async () => {
  const SEEN = { page: "home/Specs", name: "Invented Specs", folder: "pages/home/children/Specs", screen: "page" as const };
  const asked: unknown[] = [];
  const w = world({ onScreen: async (window) => { asked.push(window); return SEEN; } });
  expect(value(await w.call({ kind: "chat.send", chat: CHAT, text: "go on", window: WINDOW }))).toBeTruthy();
  expect(value(await w.call({ kind: "chat.new", agent: AGENT, text: "hello", page: "home", window: WINDOW }))).toBeTruthy();
  // A chat made with no message has nothing to carry it: nobody is asked.
  expect(value(await w.call({ kind: "chat.new", agent: AGENT, window: WINDOW }))).toBeTruthy();
  expect(asked).toEqual([WINDOW, WINDOW]);
  expect(w.calls).toEqual([
    ["chat.send", CHAT, "go on", SEEN],
    ["chat.create", { agent: AGENT, text: "hello", page: "home", onScreen: SEEN }],
    ["chat.create", { agent: AGENT }],
  ]);

  // No window named, or a lookup that fails: the message still goes, bare.
  const failing = world({ onScreen: async () => { throw new Error("the index is gone"); } });
  expect(value(await failing.call({ kind: "chat.send", chat: CHAT, text: "go on", window: WINDOW }))).toBeTruthy();
  expect(failing.calls).toEqual([["chat.send", CHAT, "go on", null]]);
});

test("A BUILD WITH NO AGENTS answers every agent and chat kind `unsupported`, and the history reads answer empty", async () => {
  const deps = {} as unknown as Deps;
  let n = 0;
  const call = (o: Record<string, unknown>) => handle({ id: `r${++n}`, g: PROTOCOL, ...o } as ApiRequest, deps);
  expect(code(await call({ kind: "agents.list" }))).toBe("unsupported");
  expect(code(await call({ kind: "chat.new", text: "hi" }))).toBe("unsupported");
  expect(code(await call({ kind: "settings.read" }))).toBe("unsupported");
  expect(value(await call({ kind: "window.list" }))).toEqual([]);
  expect(value(await call({ kind: "history.read" }))).toEqual({ entries: [], head: 0 });
  expect(code(await call({ kind: "window.report", window: WINDOW, context: HERE }))).toBe("unsupported");
});

test("A WINDOW'S REPORT names its window by the envelope and carries the context and the move; the reads answer the history's", async () => {
  const w = world();
  const moved = { by: "switcher", agent: "agent-invented-0001", chat: CHAT };
  expect(value(await w.call({ kind: "window.report", window: WINDOW, context: HERE, moved }))).toEqual([{ kind: "view", seq: 1 }]);
  expect(w.calls).toEqual([["history.report", WINDOW, HERE, moved]]);

  // A report with no window, or a malformed one, never reaches the history.
  const w2 = world();
  expect(code(await w2.call({ kind: "window.report", context: HERE }))).toBe("bad_request");
  expect(code(await w2.call({ kind: "window.report", window: WINDOW, context: { ...HERE, panel: "yes" } }))).toBe("bad_request");
  expect(code(await w2.call({ kind: "window.report", window: WINDOW, context: HERE, moved: { by: "agent" } }))).toBe("bad_request");
  expect(code(await w2.call({ kind: "history.read", since: 1.5 }))).toBe("bad_request");
  expect(w2.calls).toEqual([]);

  const w3 = world();
  expect(value(await w3.call({ kind: "window.list" }))).toEqual([{ window: WINDOW }]);
  expect(value(await w3.call({ kind: "history.read", since: 3 }))).toEqual({ entries: [], head: 7 });
  expect(w3.calls).toEqual([["history.windows"], ["history.read", 3]]);
  // Every history kind is walked above.
  expect([...HISTORY_KIND_NAMES].sort()).toEqual(["history.read", "window.list", "window.report"]);
});

test("THROUGH THE ROUTE: every local kind is refused `identity` by the gate before a module is touched, and passes with it", async () => {
  const body = (kind: string, extra: Record<string, unknown> = {}) =>
    new Request("http://localhost/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "r1", g: PROTOCOL, kind, ...extra }),
    });
  const stranger = (kind: string) => (isLocalKind(kind) ? "no capability" : null);
  for (const kind of [...CHAT_KIND_NAMES, "window.report"]) {
    const w = world();
    const r = (await (await route(body(kind, { chat: CHAT, agent: AGENT, text: "hi", window: WINDOW, context: HERE }), w.deps, stranger, () => false)).json()) as ApiResponse;
    expect([kind, code(r)]).toEqual([kind, "identity"]);
    expect([kind, w.calls]).toEqual([kind, []]);
  }
  // The reads a run makes stay on the token: no gate refuses them.
  const w = world();
  const r = (await (await route(body("history.read"), w.deps, stranger, () => false)).json()) as ApiResponse;
  expect(r.ok).toBe(true);

  // THE WINDOW IS DROPPED FROM A REQUEST THAT IS NOT THIS MACHINE'S OWN, so a
  // report can only be made by a window that could make it: past a gate that
  // lets it through, a request `own` says is a stranger's loses its `window`,
  // and the report is refused for naming none.
  const open = () => null;
  const w4 = world();
  const r4 = (await (await route(body("window.report", { window: WINDOW, context: HERE }), w4.deps, open, () => false)).json()) as ApiResponse;
  expect(code(r4)).toBe("bad_request");
  expect(w4.calls).toEqual([]);
  const w5 = world();
  const r5 = (await (await route(body("window.report", { window: WINDOW, context: HERE }), w5.deps, open, () => true)).json()) as ApiResponse;
  expect(r5.ok).toBe(true);
  expect(w5.calls).toEqual([["history.report", WINDOW, HERE, undefined]]);
});
