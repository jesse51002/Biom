// SPDX-License-Identifier: AGPL-3.0-only
// The sign-in pop-up, against a fake emulator, a fake socket and a DOM that is
// a list — so what is held is the pop-up's own rules and nothing of xterm's:
//
//   · what it sends is the ticket and the size it fitted, and nothing that
//     could name a command; nothing typed goes anywhere until the command runs;
//   · a clean exit takes the pop-up down; a failure or a refusal stays on
//     screen with its sentence until the person closes it;
//   · Close while the command runs closes the socket, which is how the server
//     is told to end it;
//   · one pop-up at a time in a window, and every key pressed in it stays in it.
//
// Every ticket and sentence here is invented for the test.

import { test, expect } from "bun:test";

import { makeSignInTerminal, exitText, SIGNIN_SUB } from "../client/views/terminal.js";

/* ── a DOM that is a list ─────────────────────────────────────────────── */

class El {
  constructor(tag) {
    this.tag = tag;
    this.id = "";
    this.className = "";
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.parent = null;
    this.textContent = "";
    this.focused = 0;
  }
  append(...kids) {
    for (const k of kids) {
      if (k instanceof El) k.parent = this;
      this.children.push(k);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  focus() {
    this.focused++;
  }
  fire(type, event = {}) {
    let stopped = false;
    const e = { type, target: this, stopPropagation: () => { stopped = true; }, preventDefault() {}, ...event };
    // Bubble to the root, as a browser would, until something stops it.
    for (let at = this; at && !stopped; at = at.parent) for (const fn of at.listeners[type] ?? []) fn(e);
    return { stopped };
  }
}

function h(spec, props, ...kids) {
  const [head, ...classes] = spec.split(".");
  const [tag, id] = head.split("#");
  const el = new El(tag || "div");
  if (id) el.id = id;
  el.className = classes.join(" ");
  if (props && props.constructor === Object) {
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith("on") && typeof v === "function") (el.listeners[k.slice(2)] ??= []).push(v);
      else el.setAttribute(k, v);
    }
  } else if (props !== undefined) kids.unshift(props);
  el.append(...kids.filter((k) => k !== null && k !== undefined));
  return el;
}

const find = (root, cls) => {
  if (!(root instanceof El)) return null;
  if (root.className.split(" ").includes(cls)) return root;
  for (const c of root.children) {
    const hit = find(c, cls);
    if (hit) return hit;
  }
  return null;
};
const text = (el) => (el instanceof El ? el.textContent + el.children.map(text).join("") : String(el));

/* ── a fake emulator and a fake socket ────────────────────────────────── */

const made = [];
class Terminal {
  constructor(options) {
    this.options = { ...options };
    this.cols = 80;
    this.rows = 24;
    this.written = [];
    this.disposed = false;
    this.focused = 0;
    made.push(this);
  }
  loadAddon() {}
  attachCustomKeyEventHandler(fn) { this.keys = fn; }
  onData(fn) { this.type = fn; }
  open(el) { this.host = el; }
  resize(c, r) { this.cols = c; this.rows = r; }
  write(d) { this.written.push(d); }
  focus() { this.focused++; }
  dispose() { this.disposed = true; }
}
class FitAddon {
  proposeDimensions() { return { cols: 90, rows: 20 }; }
}

function world() {
  const body = new El("body");
  const sockets = [];
  const connect = (hear) => {
    const s = {
      sent: [],
      st: "connecting",
      hear,
      send(msg) {
        if (s.st !== "open") return false;
        s.sent.push(msg);
        return true;
      },
      close() {
        if (s.st === "closed") return;
        s.st = "closed";
        hear({ kind: "closed" });
      },
      state: () => s.st,
      // What the server does, from the test's side.
      opens() { s.st = "open"; hear({ kind: "open" }); },
      says(event) { hear({ kind: "event", event }); },
      prints(str) { hear({ kind: "bytes", data: new TextEncoder().encode(str) }); },
      ends() { if (s.st !== "closed") { s.st = "closed"; hear({ kind: "closed" }); } },
    };
    sockets.push(s);
    return s;
  };
  const pop = makeSignInTerminal({ h, connect, Terminal, FitAddon, body });
  return { body, sockets, pop, term: () => made.at(-1) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ── the tests ────────────────────────────────────────────────────────── */

test("it sends the ticket and the size it fitted, and nothing that names a command", async () => {
  const w = world();
  void w.pop.open({ ticket: "ticket-one", title: "Sign in to Claude Code" });
  const root = w.body.children[0];
  expect(root.className).toBe("signterm");
  expect(text(root)).toContain("Sign in to Claude Code");
  expect(text(root)).toContain(SIGNIN_SUB);
  const s = w.sockets[0];
  expect(s.sent).toEqual([]);
  s.opens();
  expect(s.sent).toEqual([{ op: "create", ticket: "ticket-one", cols: 90, rows: 20 }]);
  expect(w.term().cols).toBe(90);
  // The emulator starts with typing off, and nothing typed goes before the command runs.
  expect(w.term().options.disableStdin).toBe(true);
  w.term().type("early");
  expect(s.sent).toHaveLength(1);
  s.says({ ev: "started" });
  expect(w.term().options.disableStdin).toBe(false);
  expect(w.term().focused).toBeGreaterThan(0);
  w.term().type("code-123\r");
  expect(s.sent.at(-1)).toEqual({ op: "input", data: "code-123\r" });
  s.prints("Paste code here > ");
  expect(new TextDecoder().decode(w.term().written[0])).toBe("Paste code here > ");
  s.says({ ev: "exited", exit: { code: 0, signal: null } });
  s.ends();
});

test("A CLEAN EXIT takes the pop-up down and answers the code", async () => {
  const w = world();
  const done = w.pop.open({ ticket: "ticket-one", title: "Sign in" });
  const s = w.sockets[0];
  s.opens();
  s.says({ ev: "started" });
  s.says({ ev: "exited", exit: { code: 0, signal: null } });
  s.ends();
  expect(await done).toEqual({ exitCode: 0 });
  expect(w.body.children).toEqual([]);
  expect(w.term().disposed).toBe(true);
});

test("A FAILED SIGN-IN STAYS with its reason until Close, and answers its code", async () => {
  const w = world();
  let result = null;
  void w.pop.open({ ticket: "ticket-one", title: "Sign in" }).then((r) => { result = r; });
  const s = w.sockets[0];
  s.opens();
  s.says({ ev: "started" });
  s.prints("login failed: network unreachable\r\n");
  s.says({ ev: "exited", exit: { code: 1, signal: null } });
  s.ends();
  await tick();
  expect(result).toBeNull();
  const root = w.body.children[0];
  expect(find(root, "signsaid").textContent).toBe(`The sign-in did not finish: ${exitText({ code: 1, signal: null })}.`);
  expect(find(root, "signsaid").attrs["data-tone"]).toBe("bad");
  // Typing is off, and the Close control has the caret.
  expect(w.term().options.disableStdin).toBe(true);
  expect(find(root, "signclose").focused).toBe(1);
  find(root, "signclose").fire("click");
  await tick();
  expect(result).toEqual({ exitCode: 1 });
  expect(w.body.children).toEqual([]);
});

test("a refused ticket says the server's sentence as text, and Escape closes it once nothing runs", async () => {
  const w = world();
  const done = w.pop.open({ ticket: "spent-ticket", title: "Sign in" });
  const s = w.sockets[0];
  s.opens();
  s.says({ ev: "error", message: "that sign-in was already used or has expired — <b>ask</b> to sign in again" });
  s.ends();
  const root = w.body.children[0];
  const said = find(root, "signsaid");
  // Set as text, so markup in a sentence stays characters.
  expect(said.textContent).toBe("that sign-in was already used or has expired — <b>ask</b> to sign in again");
  expect(said.children).toEqual([]);
  find(root, "signclose").fire("keydown", { key: "Escape" });
  expect(await done).toEqual({ exitCode: null });
  expect(w.body.children).toEqual([]);
});

test("CLOSE WHILE IT RUNS closes the socket — which is how the server ends the command — and answers no code", async () => {
  const w = world();
  const done = w.pop.open({ ticket: "ticket-one", title: "Sign in" });
  const s = w.sockets[0];
  s.opens();
  s.says({ ev: "started" });
  // Escape while it runs is the program's, and the pop-up stays.
  const escape = w.term().host.fire("keydown", { key: "Escape" });
  expect(escape.stopped).toBe(true);
  expect(w.body.children).toHaveLength(1);
  find(w.body.children[0], "signclose").fire("click");
  expect(s.state()).toBe("closed");
  expect(await done).toEqual({ exitCode: null });
  expect(w.body.children).toEqual([]);
});

test("EVERY KEY PRESSED IN IT STAYS IN IT, so the shell's own Escape behind it never fires", () => {
  const w = world();
  void w.pop.open({ ticket: "ticket-one", title: "Sign in" });
  let heard = 0;
  (w.body.listeners.keydown ??= []).push(() => { heard++; });
  for (const key of ["Escape", "a", "Tab", "Enter"]) expect(w.term().host.fire("keydown", { key }).stopped).toBe(true);
  expect(heard).toBe(0);
  w.sockets[0].ends();
  find(w.body.children[0], "signclose").fire("click");
});

test("ONE AT A TIME: a second open is refused while one is up, and allowed once it has gone", async () => {
  const w = world();
  const first = w.pop.open({ ticket: "ticket-one", title: "Sign in" });
  await expect(w.pop.open({ ticket: "ticket-two", title: "Sign in" })).rejects.toThrow("already open");
  expect(w.sockets).toHaveLength(1);
  w.sockets[0].ends();
  find(w.body.children[0], "signclose").fire("click");
  await first;
  const second = w.pop.open({ ticket: "ticket-two", title: "Sign in" });
  expect(w.sockets).toHaveLength(2);
  w.sockets[1].ends();
  find(w.body.children[0], "signclose").fire("click");
  expect(await second).toEqual({ exitCode: null });
  // And no ticket, no pop-up.
  await expect(w.pop.open({ ticket: "", title: "Sign in" })).rejects.toThrow("needs the ticket");
  expect(w.sockets).toHaveLength(2);
});

test("a connection that never opens says so, and nothing is sent", async () => {
  const w = world();
  const done = w.pop.open({ ticket: "ticket-one", title: "Sign in" });
  w.sockets[0].ends();
  expect(find(w.body.children[0], "signsaid").textContent).toBe("The sign-in closed before it finished.");
  expect(w.sockets[0].sent).toEqual([]);
  find(w.body.children[0], "signclose").fire("click");
  expect(await done).toEqual({ exitCode: null });
});

test("exitText says how a command ended in words", () => {
  expect(exitText({ code: 2, signal: null })).toBe("it exited with code 2");
  expect(exitText({ code: null, signal: "SIGTERM" })).toBe("it was stopped by SIGTERM");
  expect(exitText(null)).toBe("it closed before it finished");
});
