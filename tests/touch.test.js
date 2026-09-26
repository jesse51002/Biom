// SPDX-License-Identifier: AGPL-3.0-only
// THE TOUCH, from the person's hand to the two things that hear it.
//
//   · `guest/biom.js` says `touch` — only for events the browser says a person
//     made, a scroll only as the gesture and never the `scroll` event, one of
//     each a second with the latest said when the second is up.
//   · `client/frame/frame.js` hands it to the bridge, keyed by THAT realm, and
//     up to the switcher by the page of the box on screen — the outermost one,
//     for a page drawn inside another.
//   · `client/bridge/bridge.js` honours a box's `open` only shortly after its
//     own touch: a page's code never moves the screen.
//
// The shim is evaluated here against a stand-in window, the same source the box
// loads byte for byte. Page ids are invented.

import { test, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";

import { makeBridge, OPEN_AFTER_TOUCH, OPEN_GRACE } from "../client/bridge/bridge.js";
import { PROTOCOL, ERRORS } from "../contracts/wire.js";

const SHIM = readFileSync(new URL("../guest/biom.js", import.meta.url), "utf8");
const g = /** @type {any} */ (globalThis);
const saved = { window: g.window, document: g.document, setTimeout: g.setTimeout, now: Date.now, activation: Object.getOwnPropertyDescriptor(g.navigator, "userActivation") };

afterEach(() => {
  g.window = saved.window;
  g.document = saved.document;
  g.setTimeout = saved.setTimeout;
  Date.now = saved.now;
  if (saved.activation) Object.defineProperty(g.navigator, "userActivation", saved.activation);
  else delete g.navigator.userActivation;
});

const tick = () => new Promise((r) => saved.setTimeout(r, 5));

/** THE SHIM IN A STAND-IN WINDOW, its ports handed over, the host's end of the
 *  ordinary port listening. Calls it makes are answered empty; what it SAYS
 *  unprompted is what `said` holds. */
async function box() {
  /** @type {Map<string, Function[]>} */
  const on = new Map();
  /** @type {Map<string, Function[]>} */
  const docOn = new Map();
  const add = (/** @type {Map<string, Function[]>} */ map) => (/** @type {string} */ name, /** @type {Function} */ fn) => {
    map.set(name, [...(map.get(name) ?? []), fn]);
  };
  let selection = { isCollapsed: true };
  g.window = {
    addEventListener: add(on),
    removeEventListener() {},
    parent: { postMessage() {} },
  };
  g.document = {
    addEventListener: add(docOn),
    documentElement: { style: { setProperty() {} } },
    querySelectorAll: () => [],
    getSelection: () => selection,
  };
  new Function(SHIM)();

  const runtime = new MessageChannel();
  const guest = new MessageChannel();
  /** @type {any[]} */
  const said = [];
  guest.port1.onmessage = (ev) => {
    const m = ev.data;
    if (typeof m.id === "string") guest.port1.postMessage({ id: m.id, g: PROTOCOL, ok: true, value: null });
    else said.push(m);
  };
  for (const fn of on.get("message") ?? []) fn({ data: { kind: "ports", g: PROTOCOL, page: "notes" }, ports: [runtime.port2, guest.port2] });
  await tick();
  return {
    said: () => said.filter((m) => m.kind === "touch").map((m) => m.what),
    /** @param {string} name @param {boolean} trusted */
    fire(name, trusted = true) { for (const fn of on.get(name) ?? []) fn({ isTrusted: trusted }); },
    select(/** @type {boolean} */ some) { selection = { isCollapsed: !some }; for (const fn of docOn.get("selectionchange") ?? []) fn({}); },
    close() { runtime.port1.close(); guest.port1.close(); },
  };
}

test("the shim says which way the person touched the page, and nothing else", async () => {
  const b = await box();
  b.fire("pointerdown");
  b.fire("keydown");
  b.fire("wheel");
  await tick();
  expect(b.said()).toEqual(["click", "key", "scroll"]);
  b.close();
});

test("an event page code dispatched is not the person's, and neither is a scroll the box made itself", async () => {
  const b = await box();
  b.fire("pointerdown", false);
  b.fire("keydown", false);
  // `scroll` fires for the box putting the reader back, for a nested page held
  // level, and for any page code that scrolls: never a touch.
  b.fire("scroll");
  await tick();
  expect(b.said()).toEqual([]);
  b.fire("touchmove");
  await tick();
  expect(b.said()).toEqual(["scroll"]);
  b.close();
});

test("a selection is a touch only while the page has a fresh user activation", async () => {
  const b = await box();
  Object.defineProperty(g.navigator, "userActivation", { value: { isActive: false }, configurable: true });
  b.select(true);
  Object.defineProperty(g.navigator, "userActivation", { value: { isActive: true }, configurable: true });
  b.select(false);
  await tick();
  expect(b.said()).toEqual([]);
  b.select(true);
  await tick();
  expect(b.said()).toEqual(["select"]);
  b.close();
});

test("one of each a second: the first at once, and the latest of the rest when the second is up", async () => {
  const b = await box();
  let clock = 10_000;
  Date.now = () => clock;
  /** @type {{ fn: Function, ms: number }[]} */
  const timers = [];
  g.setTimeout = (/** @type {Function} */ fn, /** @type {number} */ ms) => { timers.push({ fn, ms }); return timers.length; };

  b.fire("wheel");
  clock += 100;
  b.fire("wheel");
  clock += 100;
  b.fire("wheel");
  // Another kind has its own second.
  b.fire("pointerdown");
  g.setTimeout = saved.setTimeout;
  await tick();
  expect(b.said()).toEqual(["scroll", "click"]);
  // ONE trailing scroll was set, by the second wheel, for the rest of the
  // second after the first — the third found it already set.
  expect(timers.map((t) => t.ms)).toEqual([900]);
  clock += 800;
  timers[0]?.fn();
  await tick();
  expect(b.said()).toEqual(["scroll", "click", "scroll"]);
  b.close();
});

/* ── the frame host: where a touch goes ─────────────────────────────────── */

function fakeDom() {
  /** @type {Map<string, Function>} */
  const listeners = new Map();
  g.document = {
    createElement() {
      const el = { style: {}, attrs: {}, srcdoc: "", title: "", className: "", contentWindow: { postMessage() {} },
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { /** @type {any} */ (this).attrs[k] = v; }, remove() {}, dispatchEvent() { return true; } };
      return el;
    },
  };
  g.window = {
    addEventListener(/** @type {string} */ name, /** @type {Function} */ fn) { listeners.set(name, fn); },
    removeEventListener() {},
  };
  return listeners;
}

/** Open a box: say hello from it and take the ports it is handed.
 *  @param {Map<string, Function>} listeners @param {any} frame */
function hello(listeners, frame) {
  /** @type {any} */
  let taken = null;
  const win = { postMessage: (/** @type {any} */ msg, /** @type {string} */ _o, /** @type {MessagePort[]} */ ports) => { taken = { msg, ports }; } };
  frame.el.contentWindow = win;
  listeners.get("message")?.({ source: win, data: { kind: "hello", g: PROTOCOL } });
  return { runtime: taken.ports[0], guest: taken.ports[1] };
}

test("a box's touch reaches the bridge keyed by that realm, and the switcher by the page on screen", async () => {
  const listeners = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  /** @type {any[]} */
  const bridged = [];
  /** @type {string[]} */
  const heard = [];
  const bridge = {
    resolve: async (/** @type {any} */ r) => ({ id: r.id, g: PROTOCOL, ok: true, value: { page: "inner", html: "<main></main>" } }),
    runtime: async () => ({ id: "x", g: PROTOCOL, ok: true, value: null }),
    touched: (/** @type {any} */ ctx) => bridged.push(ctx),
  };
  const host = makeFrameHost(/** @type {any} */ (bridge), "", "", { touched: (page, what) => heard.push(page + ":" + what) });
  host.setShim("");
  const ctx = { page: "notes" };
  const frame = host.for("notes", "<main>n</main>", ctx);
  const ports = hello(listeners, frame);
  ports.guest.postMessage({ kind: "touch", g: PROTOCOL, what: "click" });
  await tick();
  expect(heard).toEqual(["notes:click"]);
  expect(bridged).toEqual([ctx]);
  expect(bridged[0]).toBe(ctx);

  // A PAGE DRAWN INSIDE IT: its own realm, its own context for the bridge,
  // and the OUTER box's page for the switcher — that is the screen touched.
  /** @type {any} */
  let grant = null;
  ports.guest.onmessage = (/** @type {MessageEvent} */ ev) => { grant = { value: ev.data.value, ports: ev.ports }; };
  ports.guest.postMessage({ id: "e1", g: PROTOCOL, kind: "page.embed", page: "inner" });
  await tick();
  const nestedGuest = grant.ports[1];
  nestedGuest.postMessage({ kind: "touch", g: PROTOCOL, what: "scroll" });
  await tick();
  expect(heard).toEqual(["notes:click", "notes:scroll"]);
  expect(bridged[1]).not.toBe(ctx);
  expect(bridged[1]).toEqual({ page: "inner" });
  // A touch is never a DOM event on the canvas.
  host.drop("notes");
});

test("a bridge that predates the touch still takes a box's touch without failing", async () => {
  const listeners = fakeDom();
  const { makeFrameHost } = await import("../client/frame/frame.js");
  const host = makeFrameHost(/** @type {any} */ ({ resolve: async () => ({}), runtime: async () => ({}) }));
  host.setShim("");
  const frame = host.for("notes", "<main>n</main>", { page: "notes" });
  const ports = hello(listeners, frame);
  ports.guest.postMessage({ kind: "touch", g: PROTOCOL, what: "key" });
  await tick();
  host.drop("notes");
});

/* ── the bridge: a page's code never moves the screen ───────────────────── */

function bridgeWith(/** @type {number} */ start = 0) {
  let clock = start;
  /** @type {string[]} */
  const went = [];
  /** @type {number[]} */
  const waited = [];
  const ws = /** @type {any} */ ({ get: () => ({ pages: [{ id: "notes", name: "Notes" }], tables: [] }) });
  const transport = /** @type {any} */ ({ call: async () => ({ ok: true, value: null }) });
  /** @type {(() => void) | null} */
  let during = null;
  const bridge = makeBridge(ws, transport, { open: (view, id) => { went.push(view + ":" + id); } }, "", {
    now: () => clock,
    wait: async (ms) => { waited.push(ms); clock += ms; if (during) during(); },
  });
  return {
    bridge, went, waited,
    /** @param {number} ms */ advance(ms) { clock += ms; },
    /** @param {() => void} fn */ whileWaiting(fn) { during = fn; },
  };
}

const open = (/** @type {string} */ id) => ({ id: "o1", g: PROTOCOL, kind: /** @type {const} */ ("open"), target: { kind: /** @type {const} */ ("page"), id } });

test("an open with no touch from that box is refused in words, and the screen stays", async () => {
  const b = bridgeWith();
  const warn = console.warn;
  /** @type {string[]} */
  const said = [];
  console.warn = (m) => said.push(String(m));
  try {
    const res = /** @type {any} */ (await b.bridge.resolve(open("notes"), { page: "board" }));
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERRORS.IDENTITY);
  } finally {
    console.warn = warn;
  }
  expect(b.went).toEqual([]);
  expect(b.waited).toEqual([OPEN_GRACE]);
  expect(said.join("\n")).toContain("board");
  expect(said.join("\n")).toContain("only the person moves the screen");
});

test("an open just after a touch from that same box is the person's", async () => {
  const b = bridgeWith();
  const ctx = { page: "board" };
  b.bridge.touched?.(ctx);
  b.advance(OPEN_AFTER_TOUCH);
  expect((await b.bridge.resolve(open("notes"), ctx)).ok).toBe(true);
  expect(b.went).toEqual(["page:notes"]);
  expect(b.waited).toEqual([]);
});

test("a touch from ANOTHER box — even one on the same page — does not let this one move the screen", async () => {
  const b = bridgeWith();
  b.bridge.touched?.({ page: "board" });
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect((await b.bridge.resolve(open("notes"), { page: "board" })).ok).toBe(false);
  } finally {
    console.warn = warn;
  }
  expect(b.went).toEqual([]);
});

test("a touch too long ago is not an ask", async () => {
  const b = bridgeWith();
  const ctx = { page: "board" };
  b.bridge.touched?.(ctx);
  b.advance(OPEN_AFTER_TOUCH + 1);
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect((await b.bridge.resolve(open("notes"), ctx)).ok).toBe(false);
  } finally {
    console.warn = warn;
  }
});

test("a touch still on its way on the other port lands inside the grace, and the open is honoured", async () => {
  const b = bridgeWith();
  const ctx = { page: "board" };
  b.whileWaiting(() => b.bridge.touched?.(ctx));
  expect((await b.bridge.resolve(open("notes"), ctx)).ok).toBe(true);
  expect(b.went).toEqual(["page:notes"]);
});
