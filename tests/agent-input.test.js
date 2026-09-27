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

/** @param {any[]} agents @param {{ switcher?: any, route?: any }} [at] */
function stand(agents, at = {}) {
  /** @type {any[]} */
  const calls = [];
  const transport = {
    /** @param {any} req */
    async call(req) {
      calls.push(req);
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
  expect(s.calls).toEqual([]);
});

/* ── Active or Inactive, and nothing else (DECISIONS O28) ──────────────── */

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

/* ── an agent Biom cannot sign in (DECISIONS O35) ──────────────────────── */

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

  // A failed agent is looked at again by the server on its own (O34): nothing
  // here offers to.
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
