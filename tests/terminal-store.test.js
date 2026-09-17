// SPDX-License-Identifier: AGPL-3.0-only
// The terminal store and the dock's pure half, against a link that is a list.
//
// What the spec calls required is held here as transitions: hide and reopen keep
// every session, full screen and restore return to the edge and size the dock
// had, hiding from full screen returns to the workspace, a drag to an edge moves
// the dock and nothing else, a cancelled drag changes nothing, a create whose
// answer was lost goes again with the SAME nonce, and nothing a dock does is
// ever sent to the server.

import { test, expect } from "bun:test";

import { DOCK_DEFAULT, DOCK_MIN, FONT_DEFAULT, FONT_MAX, FONT_MIN, clampSize, dockAfter, dockFrom, makeTerminals, reconcile } from "../client/store/terminals.js";
import { exitText, sideAt, stateText, tabText } from "../client/shell/dock.js";
import { makeTerminalLink } from "../client/transport/terminal.js";

function fakeLink() {
  const sent = [];
  const hears = new Set();
  let state = "idle";
  return {
    sent,
    connect() {
      this.connects = (this.connects ?? 0) + 1;
    },
    close() {},
    send(msg) {
      if (state !== "open") return false;
      sent.push(msg);
      return true;
    },
    state: () => state,
    on(fn) {
      hears.add(fn);
      return () => hears.delete(fn);
    },
    become(next) {
      state = next;
      for (const h of hears) h({ kind: "link", state: next });
    },
    event(event) {
      for (const h of hears) h({ kind: "event", event });
    },
  };
}

const info = (id, patch = {}) => ({ id, label: `Terminal ${id}`, state: "running", exit: null, cwd: "/v", shell: "/bin/sh", truncated: false, message: null, ...patch });

/* ── the dock, pure ────────────────────────────────────────────────────── */

test("full screen and restore return to the same edge and size", () => {
  const moved = dockAfter(dockAfter({ ...DOCK_DEFAULT, visible: true }, { type: "side", side: "left" }), { type: "size", px: 520, room: 1400 });
  const full = dockAfter(moved, { type: "full" });
  expect(full).toMatchObject({ full: true, visible: true, side: "left" });
  expect(dockAfter(full, { type: "restore" })).toEqual(moved);
});

test("hiding from full screen returns to the workspace, and reopening to the remembered edge", () => {
  const right = dockAfter({ ...DOCK_DEFAULT, visible: true }, { type: "side", side: "right" });
  const hidden = dockAfter(dockAfter(right, { type: "full" }), { type: "hide" });
  expect(hidden).toMatchObject({ visible: false, full: false, side: "right" });
  expect(dockAfter(hidden, { type: "open" })).toEqual(right);
});

test("a size is kept inside the room, and an unchanged transition is the same object", () => {
  expect(clampSize(10, 900)).toBe(DOCK_MIN);
  expect(clampSize(5000, 900)).toBe(900 - DOCK_MIN);
  expect(clampSize(Number.NaN, 0)).toBe(DOCK_MIN);
  const d = { ...DOCK_DEFAULT, visible: true };
  expect(dockAfter(d, { type: "open" })).toBe(d);
  expect(dockAfter(d, { type: "side", side: "bottom" })).toBe(d);
  expect(dockAfter(d, { type: "side", side: "diagonal" })).toBe(d);
});

test("a remembered dock is read back defensively", () => {
  expect(dockFrom(null)).toEqual(DOCK_DEFAULT);
  expect(dockFrom({ side: "nowhere", sizes: { left: "x" }, visible: "yes" })).toEqual(DOCK_DEFAULT);
  expect(dockFrom({ side: "top", sizes: { top: 333 }, visible: true, full: true })).toMatchObject({ side: "top", visible: true, full: true, sizes: { top: 333 } });
});

test("a drop target is an edge band, and the middle is not one", () => {
  expect(sideAt(10, 300, 1000, 600)).toBe("left");
  expect(sideAt(990, 300, 1000, 600)).toBe("right");
  expect(sideAt(500, 5, 1000, 600)).toBe("top");
  expect(sideAt(500, 595, 1000, 600)).toBe("bottom");
  expect(sideAt(500, 300, 1000, 600)).toBeNull();
  expect(sideAt(1, 1, 0, 0)).toBeNull();
});

test("A TAB IS AN ICON AND A NUMBER unless somebody named it", () => {
  // The prompt icon already says what a tab is, so a default label is drawn as
  // its number — and a name a person gave it is drawn in full, because that is
  // the only thing telling two agents apart.
  expect(tabText("Terminal 1")).toBe("1");
  expect(tabText("Terminal 12")).toBe("12");
  expect(tabText("claude on the parser")).toBe("claude on the parser");
  expect(tabText("Terminal")).toBe("Terminal");
  expect(tabText("Terminal 1 (old)")).toBe("Terminal 1 (old)");
});

test("ZOOM IS THE DOCK'S, kept between its two ends and remembered with it", () => {
  const d = { ...DOCK_DEFAULT, visible: true };
  expect(d.font).toBe(FONT_DEFAULT);
  expect(dockAfter(d, { type: "font", px: d.font + 2 }).font).toBe(FONT_DEFAULT + 2);
  expect(dockAfter(d, { type: "font", px: 500 }).font).toBe(FONT_MAX);
  expect(dockAfter(d, { type: "font", px: 1 }).font).toBe(FONT_MIN);
  expect(dockAfter(d, { type: "font", px: Number.NaN }).font).toBe(FONT_DEFAULT);
  // An unchanged size is the same object, so nothing repaints for it.
  expect(dockAfter(d, { type: "font", px: FONT_DEFAULT })).toBe(d);
  // Zooming does not move the dock, and moving it does not resize the text.
  expect(dockAfter(d, { type: "font", px: 20 })).toMatchObject({ side: d.side, sizes: d.sizes, visible: true });
  expect(dockFrom({ font: 999 }).font).toBe(FONT_MAX);
  expect(dockFrom({ font: "big" }).font).toBe(FONT_DEFAULT);
  expect(dockFrom({ side: "top", font: 17 })).toMatchObject({ side: "top", font: 17 });
});

test("a tab says the socket's state or the server's, and never guesses at an agent's", () => {
  expect(stateText(info("a"), "open")).toBe("Running");
  expect(stateText(info("a"), "closed")).toBe("Disconnected");
  expect(stateText(info("a", { state: "exited", exit: { code: 2, signal: null } }), "closed")).toBe("Exited with code 2");
  expect(exitText({ code: null, signal: "SIGHUP" })).toBe("stopped by SIGHUP");
});

/* ── the store ─────────────────────────────────────────────────────────── */

test("OPENING CONNECTS, AND A SHELL STARTS ONLY WHEN THE WORKSPACE HAS NONE", () => {
  const link = fakeLink();
  const terms = makeTerminals({ link });
  terms.open();
  expect(link.connects).toBe(1);
  expect(terms.get().dock.visible).toBe(true);
  link.become("open");
  link.event({ ev: "sessions", sessions: [] });
  expect(link.sent.filter((m) => m.op === "create")).toHaveLength(1);

  // A second window on a workspace that has sessions opens none.
  const other = fakeLink();
  const second = makeTerminals({ link: other });
  second.open();
  other.become("open");
  other.event({ ev: "sessions", sessions: [info("a"), info("b")] });
  expect(other.sent.filter((m) => m.op === "create")).toHaveLength(0);
  expect(second.get().active).toBe("b");
});

test("HIDE AND ZOOM SEND NOTHING, and nothing about the dock ever reaches the server", () => {
  const link = fakeLink();
  const terms = makeTerminals({ link });
  link.become("open");
  link.event({ ev: "sessions", sessions: [info("a")] });
  const before = link.sent.length;
  terms.open();
  terms.hide();
  terms.open();
  terms.dockTo("left");
  terms.resize(400, 1200);
  terms.fullscreen();
  terms.restore();
  terms.zoom(3);
  terms.zoom(-1);
  terms.resetZoom();
  terms.hide();
  expect(link.sent.length).toBe(before);
  expect(terms.get().dock.font).toBe(FONT_DEFAULT);
  expect(terms.get().sessions.map((s) => s.id)).toEqual(["a"]);
});

test("A CREATE WHOSE ANSWER WAS LOST GOES AGAIN WITH THE SAME NONCE", () => {
  const link = fakeLink();
  const terms = makeTerminals({ link });
  link.become("open");
  link.event({ ev: "sessions", sessions: [] });
  terms.create();
  const first = link.sent.find((m) => m.op === "create");
  link.become("closed");
  link.become("open");
  const again = link.sent.filter((m) => m.op === "create");
  expect(again).toHaveLength(2);
  expect(again[1].nonce).toBe(first.nonce);
  link.event({ ev: "created", nonce: first.nonce, session: info("s1") });
  expect(terms.get().pending).toEqual([]);
  expect(terms.get().active).toBe("s1");
});

test("a create is refused while the socket is down, rather than queued", () => {
  const link = fakeLink();
  const terms = makeTerminals({ link });
  link.become("closed");
  expect(terms.create()).toBe(false);
  expect(link.sent).toEqual([]);
});

test("End asks first; a gone process is closed without asking; a spawn failure is kept to show", () => {
  const link = fakeLink();
  const terms = makeTerminals({ link });
  link.become("open");
  link.event({ ev: "sessions", sessions: [info("a"), info("b", { state: "exited", exit: { code: 0, signal: null } })] });
  terms.askEnd("a");
  expect(terms.get().confirming).toBe("a");
  expect(link.sent.some((m) => m.op === "end")).toBe(false);
  terms.cancelEnd();
  terms.askEnd("a");
  terms.confirmEnd();
  expect(link.sent.at(-1)).toEqual({ op: "end", id: "a" });
  terms.askEnd("b");
  expect(link.sent.at(-1)).toEqual({ op: "dismiss", id: "b" });

  terms.create();
  const nonce = link.sent.at(-1).nonce;
  link.event({ ev: "failed", nonce, message: "no shell could be started" });
  expect(terms.get().failures).toEqual([{ nonce, message: "no shell could be started" }]);
});

test("output and bells mark only a tab that is not in front, and replayed output is history", () => {
  const link = fakeLink();
  const terms = makeTerminals({ link });
  link.become("open");
  link.event({ ev: "sessions", sessions: [info("a"), info("b")] });
  terms.open();
  terms.select("b");
  terms.output("b", false);
  terms.output("a", true);
  expect(terms.get().sessions.map((s) => s.unread)).toEqual([false, false]);
  terms.output("a", false);
  terms.bell("a");
  expect(terms.get().sessions[0]).toMatchObject({ unread: true, bell: true });
  terms.select("a");
  expect(terms.get().sessions[0]).toMatchObject({ unread: false, bell: false });
});

test("a removed tab hands the front to its neighbour, and the server's list keeps what only the window knew", () => {
  const link = fakeLink();
  const terms = makeTerminals({ link });
  link.become("open");
  link.event({ ev: "sessions", sessions: [info("a"), info("b"), info("c")] });
  terms.select("b");
  terms.title("b", "vim\u0007 notes.md");
  link.event({ ev: "removed", id: "b" });
  expect(terms.get().active).toBe("c");
  const kept = reconcile([{ ...info("a"), title: "claude", unread: true, bell: false }], [info("a", { label: "agent" })]);
  expect(kept[0]).toMatchObject({ label: "agent", title: "claude", unread: true });
});

/* ── the socket ────────────────────────────────────────────────────────── */

test("the link says hello on every open, reconnects with backoff, and never queues input", () => {
  const made = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      made.push(this);
    }
    send(t) {
      this.sent.push(t);
    }
    close() {}
  }
  const timers = [];
  const link = makeTerminalLink({ url: "ws://x/terminal", WebSocket: FakeSocket, setTimeout: (fn) => (timers.push(fn), timers.length), clearTimeout: () => {} });
  const seen = [];
  link.on((m) => seen.push(m));
  expect(link.send({ op: "input", id: "a", data: "x" })).toBe(false);
  link.connect();
  made[0].onopen();
  expect(made[0].sent).toEqual([JSON.stringify({ op: "hello" })]);
  made[0].onclose();
  expect(link.state()).toBe("closed");
  expect(link.send({ op: "input", id: "a", data: "typed while down" })).toBe(false);
  timers.shift()();
  made[1].onopen();
  expect(made[1].sent).toEqual([JSON.stringify({ op: "hello" })]);
  expect(seen.filter((m) => m.kind === "link").map((m) => m.state)).toEqual(["connecting", "open", "closed", "connecting", "open"]);
});
