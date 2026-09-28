// SPDX-License-Identifier: AGPL-3.0-only
// THE INPUT BOX'S AGENT MENU AND MORE AGENTS, on a DOM that is a tree of plain objects: the
// real `h` from `client/platform/dom.js`, the real ui and chat stores, and a
// document just big enough for `makeAgentInput` — elements, a focus, the
// document's own key listeners, and a selector engine for the few selectors
// the input box asks with. What a real browser does with a key that is not the
// menu's own — Enter on a focused button clicking it — is done here by hand,
// and said where.
//
// Every agent, key and word here is invented.

import { test, expect, beforeEach, afterAll } from "bun:test";

import { PROTOCOL } from "../contracts/wire.js";
import { h } from "../client/platform/dom.js";
import { makeUi } from "../client/store/ui.js";
import { makeChatStore } from "../client/store/chats.js";
import { makeAgentInput } from "../client/views/agent-input.js";
import { makeAgentDialogs } from "../client/views/agent-dialogs.js";

/* ── a DOM that is a tree ──────────────────────────────────────────────── */

/** One compound selector: a tag, classes, attributes present, attributes
 *  absent — `.mi:not([disabled])`, `[data-act]`, `button.mact`.
 *  @param {string} sel */
function compound(sel) {
  const m = /^([a-z]*)((?:\.[\w-]+)*)((?:\[[\w-]+\])*)((?::not\(\[[\w-]+\]\))*)$/i.exec(sel.trim());
  if (!m) throw new Error("the fake DOM does not read the selector " + sel);
  const tag = (m[1] ?? "").toUpperCase();
  const classes = (m[2] ?? "").split(".").filter(Boolean);
  const has = [...(m[3] ?? "").matchAll(/\[([\w-]+)\]/g)].map((x) => x[1]);
  const not = [...(m[4] ?? "").matchAll(/\[([\w-]+)\]/g)].map((x) => x[1]);
  /** @param {El} el */
  return (el) => (!tag || el.tagName === tag) && classes.every((c) => el.classes().includes(c))
    && has.every((a) => el.hasAttribute(a)) && not.every((a) => !el.hasAttribute(a));
}
/** @param {string} sel */
const matcher = (sel) => { const all = sel.split(",").map(compound); return (/** @type {El} */ el) => all.some((f) => f(el)); };

class El {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.id = "";
    this.className = "";
    /** @type {Record<string, string>} */
    this.attrs = {};
    /** @type {any[]} */
    this.children = [];
    /** @type {El | null} */
    this.parentElement = null;
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    /** @type {Record<string, string> & { setProperty: (k: string, v: string) => void }} */
    this.style = /** @type {any} */ ({ setProperty(/** @type {string} */ k, /** @type {string} */ v) { this[k] = v; } });
    this.textContent = "";
    this.value = "";
    this.placeholder = "";
    this.readOnly = false;
    this.title = "";
    this.scrollHeight = 20;
    /** @type {El | null} */
    this.firstElementChild = null;
    /** @type {{ top: number, bottom: number, left: number, right: number, width: number, height: number } | null} */
    this.rect = null;
  }
  classes() { return this.className.split(" ").filter(Boolean); }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(on) { if (on) this.attrs.hidden = ""; else delete this.attrs.hidden; }
  get isConnected() { let at = /** @type {El | null} */ (this); while (at && at !== doc.body) at = at.parentElement; return at === doc.body; }
  /** @param {string} markup */
  set innerHTML(markup) { this.children = []; const svg = new El("svg"); svg.parentElement = this; this.children.push(svg); this.firstElementChild = svg; void markup; }
  /** @param {string} k @param {unknown} v */
  setAttribute(k, v) { this.attrs[k] = String(v); }
  /** @param {string} k */
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  /** @param {string} k */
  hasAttribute(k) { return k in this.attrs; }
  /** @param {string} k */
  removeAttribute(k) { delete this.attrs[k]; }
  /** @param {string} k @param {boolean} [on] */
  toggleAttribute(k, on) { if (on ?? !this.hasAttribute(k)) this.attrs[k] = ""; else delete this.attrs[k]; }
  /** @param {...any} kids */
  append(...kids) {
    for (const k of kids) {
      if (k instanceof El) { k.remove(); k.parentElement = this; }
      this.children.push(k);
    }
  }
  /** @param {...any} kids */
  replaceChildren(...kids) {
    for (const c of this.children) if (c instanceof El) c.parentElement = null;
    this.children = [];
    this.append(...kids);
  }
  remove() {
    const p = this.parentElement;
    if (!p) return;
    p.children = p.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  /** @param {any} node */
  contains(node) { for (let at = node; at; at = at.parentElement) if (at === this) return true; return false; }
  /** @param {string} sel */
  matches(sel) { return matcher(sel)(this); }
  /** @param {string} sel */
  closest(sel) { const ok = matcher(sel); for (let at = /** @type {El | null} */ (this); at; at = at.parentElement) if (ok(at)) return at; return null; }
  /** @param {string} sel @returns {El[]} */
  querySelectorAll(sel) {
    const ok = matcher(sel);
    /** @type {El[]} */
    const out = [];
    /** @param {El} el */
    const walk = (el) => { for (const c of el.children) if (c instanceof El) { if (ok(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  /** @param {string} sel */
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  /** @param {string} type @param {Function} fn */
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  /** @param {string} type @param {Function} fn */
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== fn); }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  /** Where it is drawn: `rect` where a test placed it, a small box otherwise
   *  — and nothing at all while it is hidden, as `display: none` draws. */
  getBoundingClientRect() {
    if (this.hidden) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    return this.rect ?? { top: 0, bottom: 30, left: 0, right: 200, width: 200, height: 30 };
  }
  setSelectionRange() {}
  scrollIntoView() {}
  /** Everything said inside, as a reader would hear it. @returns {string} */
  get text() { return this.children.map((c) => (c instanceof El ? c.text : String(c.textContent ?? c))).join("") + this.textContent; }
  /** A click, bubbling from here to the document, as a browser's does.
   *  @param {string} type @param {Record<string, unknown>} [extra] */
  fire(type, extra = {}) {
    let stopped = false;
    const e = { type, target: this, stopPropagation: () => { stopped = true; }, preventDefault() {}, ...extra };
    for (let at = /** @type {any} */ (this); at && !stopped; at = at.parentElement ?? (at === doc.body ? doc : null)) for (const fn of [...(at.listeners[type] ?? [])]) fn(e);
  }
}

class Text {
  /** @param {string} text */
  constructor(text) { this.textContent = text; this.parentElement = null; }
}

/** @type {any} */
let doc;

function freshDocument() {
  const body = new El("body");
  doc = {
    body,
    activeElement: body,
    /** @type {Record<string, Function[]>} */
    listeners: {},
    /** @param {string} tag */
    createElement: (tag) => new El(tag),
    /** @param {string} text */
    createTextNode: (text) => new Text(text),
    /** @param {string} type @param {Function} fn */
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    /** @param {string} type @param {Function} fn */
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((/** @type {Function} */ x) => x !== fn); },
  };
  return doc;
}

/** A key pressed wherever the caret is: the document's capture listeners
 *  hear it first, as the menu's do. @param {string} key */
function press(key) {
  const e = { key, target: doc.activeElement, shiftKey: false, preventDefault() {}, stopPropagation() {} };
  for (const fn of [...(doc.listeners.keydown ?? [])]) fn(e);
}

const g = /** @type {any} */ (globalThis);
const had = { document: g.document, Node: g.Node, HTMLElement: g.HTMLElement, requestAnimationFrame: g.requestAnimationFrame };
beforeEach(() => {
  g.document = freshDocument();
  g.Node = El;
  g.HTMLElement = El;
  // More agents puts the caret in its search a frame after it opens.
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => { fn(); return 0; };
});
afterAll(() => {
  for (const [k, v] of Object.entries(had)) if (v === undefined) delete g[k]; else g[k] = v;
});

/* ── the input box, stood up ───────────────────────────────────────────── */

/** @param {Record<string, unknown>} [over] */
const agent = (over = {}) => ({
  key: "codex-acp", name: "Codex", line: "Invented line", icon: null, source: "path", version: null,
  state: "active", reason: null, message: null, auth: [], options: [], commands: [], ...over,
});

/** @param {any[]} agents @param {{ switcher?: any, route?: any, answers?: Record<string, (req: any) => any> }} [at] */
function stand(agents, at = {}) {
  /** @type {any[]} */
  const calls = [];
  const transport = {
    /** @param {any} req */
    async call(req) {
      calls.push(req);
      const answer = at.answers?.[req.kind];
      if (answer) {
        try {
          return { id: req.id, g: PROTOCOL, ok: true, value: await answer(req) };
        } catch (e) {
          return { id: req.id, g: PROTOCOL, ok: false, error: { code: /** @type {any} */ (e).code ?? "internal", message: String(/** @type {any} */ (e).message) } };
        }
      }
      return { id: req.id, g: PROTOCOL, ok: true, value: agents.find((a) => a.key === req.agent) ?? null };
    },
  };
  const chats = makeChatStore({ transport });
  chats.takeAgents(agents);
  const ui = makeUi({ route: at.route ?? { view: "agent", id: "", screen: "page" } });
  /** @type {any[]} */
  const said = [];
  const dialogs = {
    agents: () => { said.push(["agents"]); },
    models: () => { said.push(["models"]); },
    signIn: (/** @type {any} */ a) => { said.push(["signIn", a.key]); },
    close: () => { said.push(["close"]); },
    shown: () => null,
  };
  const win = /** @type {any} */ ({ innerWidth: 1400, innerHeight: 900, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: true }) });
  const input = makeAgentInput({ h, ui, chats, switcher: at.switcher ?? null, dialogs: /** @type {any} */ (dialogs), doc, win });
  doc.body.append(input.el);
  const chip = /** @type {El} */ (input.el.querySelector("button.agentchip"));
  const menu = () => /** @type {El | null} */ (doc.body.querySelector(".agentmenu"));
  return { input, chats, ui, said, calls, chip, menu };
}

const AGENTS = [
  agent(),
  agent({ key: "claude-acp", name: "Claude Code", state: "inactive", reason: "signin", message: "Sign in to use it." }),
  agent({ key: "openclaw", name: "OpenClaw", state: "inactive", reason: "gateway", message: "Its Gateway is not running." }),
];

/** Arrow down through the open menu until the caret is on a control saying
 *  `words`, a bounded walk. @param {string} words @returns {El | null} */
function arrowTo(words) {
  for (let i = 0; i < 12; i++) {
    const at = /** @type {El} */ (doc.activeElement);
    if (at instanceof El && at.text.trim() === words) return at;
    press("ArrowDown");
  }
  return null;
}

test("the Sign in and Start Gateway pills in the agent menu are reached by the arrow keys, are buttons of their own, and Enter on one does its act", async () => {
  const s = stand(AGENTS);
  s.chip.fire("click");
  expect(s.menu()).not.toBe(null);

  const signIn = arrowTo("Sign in");
  expect(signIn).not.toBe(null);
  const pill = /** @type {El} */ (signIn);
  expect(pill.tagName).toBe("BUTTON");
  // Never an interactive control inside another one.
  expect(pill.parentElement?.closest("button")).toBe(null);
  expect(pill.getAttribute("aria-label")).toBe("Sign in to Claude Code");
  // ENTER ON A FOCUSED BUTTON IS ITS CLICK — the browser's doing, done by hand.
  pill.fire("click");
  expect(s.said).toEqual([["agents"], ["signIn", "claude-acp"]]);
  expect(s.menu()).toBe(null);

  s.said.length = 0;
  s.chip.fire("click");
  const gateway = arrowTo("Start Gateway");
  expect(gateway).not.toBe(null);
  /** @type {El} */ (gateway).fire("click");
  await Promise.resolve();
  expect(s.calls.filter((c) => c.kind === "agents.start").map((c) => c.agent)).toEqual(["openclaw"]);
  expect(s.said).toEqual([["agents"]]);
});

test("the row of an Inactive agent opens More agents and runs nothing; the row of an Active one picks it", () => {
  const s = stand(AGENTS);
  s.chip.fire("click");
  const row = /** @type {El} */ (s.menu()?.querySelector('button.mi[data-agent]'));
  expect(row.getAttribute("data-agent")).toBe("codex-acp");
  const claude = /** @type {El} */ (s.menu()?.querySelectorAll("button.mi").find((b) => b.getAttribute("data-agent") === "claude-acp"));
  claude.fire("click");
  expect(s.said).toEqual([["agents"]]);
  // Reading what the workspace kept is not running anything.
  expect(s.calls.filter((c) => c.kind !== "settings.read")).toEqual([]);
});

/* ── Active or Inactive, and nothing else ──────────────────────────────── */

const BUSY = [
  agent(),
  agent({ key: "gemini", name: "Gemini CLI", state: "inactive", reason: "checking", message: null }),
  agent({ key: "goose", name: "goose", state: "inactive", reason: "installing", message: "Installing from the ACP Registry." }),
  agent({ key: "droid", name: "Droid", state: "inactive", reason: "failed", message: "It could not be started." }),
  agent({ key: "claude-acp", name: "Claude Code", state: "inactive", reason: "signin", message: "Sign in to use it." }),
];

test("the agent menu says Active or Inactive and nothing else: work under way is the lamp pulsing, and only Sign in or Start Gateway is a button", () => {
  const s = stand(BUSY);
  s.chip.fire("click");
  const rows = /** @type {El[]} */ (s.menu()?.querySelectorAll("button.mi[data-agent]"));
  const said = Object.fromEntries(rows.map((r) => [r.getAttribute("data-agent"), /** @type {El} */ (r.querySelector(".sub")).text]));
  expect(said).toEqual({ "codex-acp": "Active", gemini: "Inactive", goose: "Inactive", droid: "Inactive", "claude-acp": "Inactive" });
  const lamp = (/** @type {string} */ key) => /** @type {El} */ (rows.find((r) => r.getAttribute("data-agent") === key)?.children[0]).classes().join(" ");
  expect(lamp("gemini")).toBe("led lit pulse");
  expect(lamp("goose")).toBe("led lit pulse");
  expect(lamp("droid")).toBe("led");
  expect(s.menu()?.querySelectorAll(".mact").map((b) => b.text)).toEqual(["Sign in"]);
});

test("More agents says Active or Inactive and nothing else; a failed agent carries no button, and work under way is its button held", () => {
  const s = stand(BUSY);
  const dialogs = makeAgentDialogs({ h, chats: s.chats, signInTerminal: null, doc });
  dialogs.agents({ why: () => null, current: () => "codex-acp", use: () => {} });
  const rows = /** @type {El[]} */ (doc.body.querySelectorAll(".arow")).filter((r) => BUSY.some((a) => a.key === r.getAttribute("data-agent")));
  expect(rows.length).toBe(BUSY.length);
  /** @param {string} key */
  const row = (key) => /** @type {El} */ (rows.find((r) => r.getAttribute("data-agent") === key));
  for (const r of rows) expect(["Active", "Inactive"]).toContain(/** @type {El} */ (r.querySelector(".st")).text);
  /** What a row's buttons say, and which of them can be pressed. @param {string} key */
  const buttons = (key) => row(key).querySelectorAll("button").map((b) => (b.hasAttribute("disabled") ? "held " : "") + b.text);
  expect(buttons("droid")).toEqual([]);
  expect(row("droid").text).toContain("It could not be started.");
  expect(buttons("gemini")).toEqual(["held Checking…"]);
  expect(buttons("goose")).toEqual(["held Installing…"]);
  expect(buttons("claude-acp")).toEqual(["Sign in"]);
});

/* ── an agent Biom cannot sign in ──────────────────────────────────────── */

test("an agent refusing for a sign-in with no way to sign in from here says to sign in from its own command, and Check again asks the server to look again", async () => {
  const bare = agent({ key: "claude-acp", name: "Claude Code", state: "inactive", reason: "signin", message: "Sign in to use it.", auth: [] });
  const s = stand([agent(), bare, agent({ key: "droid", name: "Droid", state: "inactive", reason: "failed", message: "It could not be started." })]);
  const dialogs = makeAgentDialogs({ h, chats: s.chats, signInTerminal: null, doc });
  dialogs.agents({ why: () => null, current: () => "codex-acp", use: () => {} });
  /** @param {string} key */
  const row = (key) => /** @type {El} */ (doc.body.querySelectorAll(".arow").find((r) => r.getAttribute("data-agent") === key));
  /** @param {string} key */
  const ways = (key) => doc.body.querySelectorAll(".aways").find((r) => r.getAttribute("data-agent") === key) ?? null;
  /** @param {El} el @param {string} words */
  const button = (el, words) => el.querySelectorAll("button").find((b) => b.text === words) ?? null;

  /** @type {El} */ (button(row("claude-acp"), "Sign in")).fire("click");
  // No sign-in is started — there is none Biom could run — and nothing names
  // a button that is not there.
  expect(s.calls.filter((c) => c.kind === "agents.signIn")).toEqual([]);
  const shown = /** @type {El} */ (ways("claude-acp"));
  expect(shown).not.toBe(null);
  expect(shown.text).toContain("Sign in from its own command in a terminal");
  expect(row("claude-acp").text).not.toContain("Check again");
  const again = button(shown, "Check again");
  expect(again).not.toBe(null);
  expect(again?.hasAttribute("disabled")).toBe(false);

  /** @type {El} */ (again).fire("click");
  await Promise.resolve();
  expect(s.calls.filter((c) => c.kind === "agents.probe").map((c) => c.agent)).toEqual(["claude-acp"]);

  // A failed agent is looked at again by the server on its own, on the list's
  // half-minute look: nothing here offers to.
  expect(button(row("droid"), "Check again")).toBe(null);
  expect(ways("droid")).toBe(null);
});

/* ── what the input covers of the look ─────────────────────────────────── */

test("the height the look leaves the input covers Go to page above it: it grows by the pill when an offer shows, and gives it back when it goes", () => {
  const CHAT = "c1nvented-chat-0001";
  /** @type {{ to: any, name: string } | null} */
  let offer = null;
  const switcher = { get: () => ({ back: null, offer }), on: () => () => {} };
  const s = stand(AGENTS, { switcher, route: { view: "agent", id: CHAT, screen: "page" } });
  s.chats.takeChat({ chat: { id: CHAT, name: "Invented chat", face: null, agent: "codex-acp", harness: "Codex", agentId: null, page: null, phase: "idle", turn: 1, light: "none", stop: null, reason: null, created: 1, updated: 10 }, updates: [] });
  // THE DOCK AS A BROWSER LAYS IT OUT at the foot of a chat: the look's stage
  // ends at 800, the composer stands from 600 to 700 with the line under it
  // below that, and Go to page hangs 12 px over the composer, 34 px tall.
  /** @type {El} */ (doc.body).rect = { top: 0, bottom: 800, left: 0, right: 900, width: 900, height: 800 };
  const composer = /** @type {El} */ (s.input.el.querySelector(".composer"));
  composer.rect = { top: 600, bottom: 700, left: 90, right: 810, width: 720, height: 100 };
  const pill = /** @type {El} */ (s.input.el.querySelector("button.follow"));
  pill.rect = { top: 554, bottom: 588, left: 90, right: 330, width: 240, height: 34 };
  let told = 0;
  s.input.onMove(() => { told++; });

  s.input.sync();
  expect(pill.hidden).toBe(true);
  expect(s.input.measure()).toEqual({ at: "bottom", height: 200 });

  offer = { to: { view: "page", id: "home", screen: "page" }, name: "Home" };
  const before = told;
  s.input.sync();
  expect(pill.hidden).toBe(false);
  expect(s.input.measure()).toEqual({ at: "bottom", height: 246 });
  // The look is told, so it makes room for the pill as the pill appears.
  expect(told).toBe(before + 1);

  offer = null;
  s.input.sync();
  expect(s.input.measure()).toEqual({ at: "bottom", height: 200 });
  expect(told).toBe(before + 2);
});

/* ── the kept choices and the view ─────────────────────────────────────── */

const CHAT_ID = "c1nvented-chat-0001";
/** @param {Record<string, unknown>} [over] */
const aChat = (over = {}) => ({ id: CHAT_ID, name: "Invented chat", face: null, agent: "codex-acp", harness: "Codex", agentId: null, page: null, phase: "idle", turn: 1, light: "none", stop: null, reason: null, created: 1, updated: 10, queued: 0, queueHeld: false, ...over });
/** @param {string} id @param {string} category @param {string[]} values */
const option = (id, category, values) => ({ id, name: id, category, type: "select", value: values[0], choices: values.map((v) => ({ value: v, name: v.toUpperCase(), description: null, group: null })) });
/** Let every answer in flight land. */
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("THE VIEW CHIP sits beside the effort in a chat and nowhere on the start screen, and a view picked is kept for the workspace and shown at once", async () => {
  /** @type {any} */
  let kept = { view: "tools", agent: null, agents: {} };
  const s = stand(AGENTS, {
    answers: {
      "settings.read": () => kept,
      "settings.set": (req) => { kept = { ...kept, view: req.view }; return kept; },
    },
  });
  await settle();
  const chip = /** @type {El} */ (s.input.el.querySelector("button.viewchip"));
  const cbar = /** @type {El} */ (s.input.el.querySelector(".cbar"));
  // After the pickers and before Send.
  expect(cbar.children.indexOf(chip)).toBe(cbar.children.length - 2);
  expect(chip.hidden).toBe(true);
  s.chats.takeChat({ chat: aChat(), updates: [] });
  s.ui.set({ chat: CHAT_ID });
  s.input.sync();
  expect(chip.hidden).toBe(false);
  expect(chip.text).toBe("Tool calls");
  // Worked from the keyboard like the other chips: its menu takes the caret
  // and the arrows, and Enter on a row is that row's click.
  chip.fire("click");
  expect(chip.getAttribute("aria-expanded")).toBe("true");
  const rows = /** @type {El[]} */ (s.menu()?.querySelectorAll("button.mi"));
  expect(rows.map((r) => r.getAttribute("data-view"))).toEqual(["plain", "thinking", "tools"]);
  expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  expect(doc.activeElement).toBe(rows[0]);
  press("ArrowDown");
  expect(doc.activeElement).toBe(rows[1]);
  /** @type {El} */ (doc.activeElement).fire("click");
  // Shown at once, before the server answers, and kept by it.
  expect(s.chats.get().settings?.view).toBe("thinking");
  expect(chip.text).toBe("Thinking");
  await settle();
  expect(s.calls.filter((c) => c.kind === "settings.set").map((c) => c.view)).toEqual(["thinking"]);
  expect(s.menu()).toBe(null);
});

test("a view the server will not keep is put back, with a sentence", async () => {
  const s = stand(AGENTS, {
    answers: {
      "settings.read": () => ({ view: "plain", agent: null, agents: {} }),
      "settings.set": () => { throw Object.assign(new Error("the kept choices could not be written"), { code: "internal" }); },
    },
  });
  await settle();
  s.chats.takeChat({ chat: aChat(), updates: [] });
  s.ui.set({ chat: CHAT_ID });
  s.input.sync();
  const chip = /** @type {El} */ (s.input.el.querySelector("button.viewchip"));
  expect(chip.text).toBe("Plain");
  chip.fire("click");
  /** @type {El} */ (s.menu()?.querySelectorAll("button.mi").find((r) => r.getAttribute("data-view") === "tools")).fire("click");
  expect(chip.text).toBe("Tool calls");
  await settle();
  expect(s.chats.get().settings?.view).toBe("plain");
  expect(chip.text).toBe("Plain");
  expect(/** @type {El} */ (s.input.el.querySelector(".said")).textContent).toBe("Not changed: the kept choices could not be written");
});

test("THE START SCREEN STARTS WHERE THE PERSON LEFT OFF: the kept agent while it is on this machine, and its kept values its list still offers", async () => {
  const opts = [option("model", "model", ["fast", "deep"]), option("mode", "mode", ["ask", "code"])];
  const list = [agent({ options: opts }), agent({ key: "gemini", name: "Gemini CLI", options: opts })];
  const s = stand(list, {
    answers: {
      "settings.read": () => ({ view: "tools", agent: "gemini", agents: { gemini: { model: "deep", mode: "retired" }, "codex-acp": { mode: "code" } } }),
    },
  });
  // Before the kept choices are read, the first Active agent, on its own values.
  const chips = () => /** @type {El[]} */ (s.input.el.querySelectorAll("button.chip")).filter((c) => !c.hidden).map((c) => c.text);
  expect(chips()[0]).toBe("Codex");
  await settle();
  s.input.sync();
  // Read: the agent the workspace kept, its kept model, and the mode it no
  // longer offers left at the agent's own.
  expect(chips()).toEqual(["Gemini CLI", "DEEP", "ASK"]);
  // Sent as the chat the first message makes: the kept values are the
  // server's to lay on, so nothing but the agent goes with it.
  const text = /** @type {El} */ (s.input.el.querySelector("textarea"));
  text.value = "Invented first message";
  text.fire("keydown", { key: "Enter", shiftKey: false, isComposing: false });
  await settle();
  expect(s.calls.filter((c) => c.kind === "chat.new").length).toBe(1);
  const made = s.calls.find((c) => c.kind === "chat.new");
  expect(made).toMatchObject({ agent: "gemini", text: "Invented first message" });
  expect(made.config).toBeUndefined();
});

test("a kept agent no longer on this machine is passed over, and a pick in this window wins over the kept one", async () => {
  const s = stand(AGENTS, { answers: { "settings.read": () => ({ view: "tools", agent: "gone-agent", agents: {} }) } });
  await settle();
  s.input.sync();
  const name = () => /** @type {El} */ (s.chip.querySelector(".nm")).textContent;
  expect(name()).toBe("Codex");
  const t = stand([agent(), agent({ key: "gemini", name: "Gemini CLI" })], { answers: { "settings.read": () => ({ view: "tools", agent: "gemini", agents: {} }) } });
  await settle();
  t.input.sync();
  expect(/** @type {El} */ (t.chip.querySelector(".nm")).textContent).toBe("Gemini CLI");
  t.chip.fire("click");
  /** @type {El} */ (t.menu()?.querySelectorAll("button.mi").find((b) => b.getAttribute("data-agent") === "codex-acp")).fire("click");
  await settle();
  expect(/** @type {El} */ (t.chip.querySelector(".nm")).textContent).toBe("Codex");
});

/* ── Biom's own question ───────────────────────────────────────────────── */

const QUESTION = { title: "Delete this chat?", line: "It can’t be undone.", yes: "Delete", no: "Cancel" };

test("BIOM'S OWN QUESTION: the heading and the line, Cancel holding the caret, and only Delete answering yes", async () => {
  const s = stand(AGENTS);
  const dialogs = makeAgentDialogs({ h, chats: s.chats, signInTerminal: null, doc });
  const before = /** @type {El} */ (s.input.el.querySelector("textarea"));
  before.focus();
  const asked = dialogs.confirm(QUESTION);
  const dialog = /** @type {El} */ (doc.body.querySelector(".cdialog"));
  expect(dialog.getAttribute("role")).toBe("alertdialog");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(/** @type {El} */ (dialog.querySelector("b")).text).toBe("Delete this chat?");
  expect(/** @type {El} */ (dialog.querySelector("p")).text).toBe("It can’t be undone.");
  const [no, yes] = /** @type {El[]} */ (dialog.querySelectorAll("button"));
  expect([no?.text, yes?.text]).toEqual(["Cancel", "Delete"]);
  expect(doc.activeElement).toBe(no);
  // Tab stays between the two answers.
  dialog.fire("keydown", { key: "Tab" });
  expect(doc.activeElement).toBe(yes);
  dialog.fire("keydown", { key: "Tab" });
  expect(doc.activeElement).toBe(no);
  /** @type {El} */ (yes).fire("click");
  expect(await asked).toBe(true);
  expect(doc.body.querySelector(".cdialog")).toBe(null);
  // The caret goes back where it was.
  expect(doc.activeElement).toBe(before);
});

test("Cancel, Escape, a press outside and a second question are each no", async () => {
  const s = stand(AGENTS);
  const dialogs = makeAgentDialogs({ h, chats: s.chats, signInTerminal: null, doc });
  const answers = [];
  const one = dialogs.confirm(QUESTION);
  // The first answer is Cancel.
  /** @type {El} */ (doc.body.querySelector("button[data-answer]")).fire("click");
  answers.push(await one);
  const two = dialogs.confirm(QUESTION);
  /** @type {El} */ (doc.body.querySelector(".cdialog")).fire("keydown", { key: "Escape" });
  answers.push(await two);
  const three = dialogs.confirm(QUESTION);
  /** @type {El} */ (doc.body.querySelector(".ascrim")).fire("pointerdown");
  answers.push(await three);
  const four = dialogs.confirm(QUESTION);
  const five = dialogs.confirm(QUESTION);
  answers.push(await four);
  expect(doc.body.querySelectorAll(".cdialog").length).toBe(1);
  /** @type {El} */ (/** @type {El} */ (doc.body.querySelector(".cdialog")).querySelectorAll("button").find((b) => b.text === "Delete")).fire("click");
  answers.push(await five);
  expect(answers).toEqual([false, false, false, false, true]);
  expect(doc.body.querySelector(".aask")).toBe(null);
});

/* ── the queue ─────────────────────────────────────────────────────────── */

test("WHILE A TURN RUNS the button is Stop with nothing typed and Send with words, the text area stays open, and Enter queues what is typed", async () => {
  const s = stand(AGENTS, {
    answers: {
      "chat.send": () => ({ chat: aChat({ phase: "running", queued: 1 }), queued: { id: "q1nvented-queued-01", place: 1 } }),
      "chat.cancel": () => aChat({ phase: "running" }),
    },
  });
  s.chats.takeChat({ chat: aChat({ phase: "running", light: "working" }), updates: [] });
  s.ui.set({ chat: CHAT_ID });
  s.input.sync();
  const send = /** @type {El} */ (s.input.el.querySelector("button.send"));
  const text = /** @type {El} */ (s.input.el.querySelector("textarea"));
  expect(send.getAttribute("aria-label")).toBe("Stop");
  expect(send.hasAttribute("disabled")).toBe(false);
  expect(text.readOnly).toBe(false);
  // Words typed: Send, which queues them behind the turn.
  text.value = "Invented words for after";
  text.fire("input");
  expect(send.getAttribute("aria-label")).toBe("Send");
  expect(send.title).toBe("Queue it behind this turn");
  text.fire("keydown", { key: "Enter", shiftKey: false, isComposing: false });
  await settle();
  expect(s.calls.filter((c) => c.kind === "chat.send").map((c) => c.text)).toEqual(["Invented words for after"]);
  expect(text.value).toBe("");
  // Nothing typed again: Stop, and pressing it stops.
  s.input.sync();
  expect(send.getAttribute("aria-label")).toBe("Stop");
  send.fire("pointerdown");
  send.fire("click");
  await settle();
  expect(s.calls.filter((c) => c.kind === "chat.cancel").length).toBe(1);
});

test("Escape stops the turn, words typed or not", async () => {
  const s = stand(AGENTS, { answers: { "chat.cancel": () => aChat({ phase: "running" }) } });
  s.chats.takeChat({ chat: aChat({ phase: "running", light: "working" }), updates: [] });
  s.ui.set({ chat: CHAT_ID });
  s.input.sync();
  const text = /** @type {El} */ (s.input.el.querySelector("textarea"));
  text.value = "half a thought";
  text.fire("input");
  text.fire("keydown", { key: "Escape" });
  await settle();
  expect(s.calls.filter((c) => c.kind === "chat.cancel").length).toBe(1);
  expect(text.value).toBe("half a thought");
});

test("SEND QUEUED shows under the input while the queue is held, says how many, and sends it", async () => {
  const s = stand(AGENTS, { answers: { "chat.sendQueued": () => aChat({ phase: "starting", queued: 0, queueHeld: false, updated: 22 }) } });
  s.chats.takeChat({ chat: aChat({ phase: "running", queued: 2, queueHeld: false }), updates: [] });
  s.ui.set({ chat: CHAT_ID });
  s.input.sync();
  const button = /** @type {El} */ (s.input.el.querySelector("button.sendqueued"));
  // Waiting for the turn is not waiting for the person.
  expect(button.hidden).toBe(true);
  s.chats.takeChat({ chat: aChat({ phase: "idle", stop: "cancelled", queued: 2, queueHeld: true, updated: 20 }), updates: [] });
  s.input.sync();
  expect(button.hidden).toBe(false);
  expect(button.text).toBe("Send 2 queued");
  s.chats.takeChat({ chat: aChat({ phase: "idle", stop: "cancelled", queued: 1, queueHeld: true, updated: 21 }), updates: [] });
  s.input.sync();
  expect(button.text).toBe("Send queued");
  button.fire("click");
  await settle();
  expect(s.calls.filter((c) => c.kind === "chat.sendQueued").map((c) => c.chat)).toEqual([CHAT_ID]);
  s.input.sync();
  expect(button.hidden).toBe(true);
});
