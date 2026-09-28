// SPDX-License-Identifier: AGPL-3.0-only
// THE TWELFTH CONTRACTS EDIT, AT THE GUARDS — `contracts/guards.js` and
// `contracts/wire.js`, for the SCALE design: a workspace of two thousand pages.
//
// The window no longer holds every page. It lists the tree a level at a time,
// and asks for anything else by name: `page.locate` for ids and identities,
// `page.search` for names. This file walks both through `isPageRequest` both
// ways, holds their bounds, holds them out of both inner rings and off the
// local gate, and snapshots the list so a kind added to it is a decision
// somebody states. Every id, uid and name here is invented.

import { test, expect } from "bun:test";

import {
  HOST_KIND_NAMES, LOCAL_KIND_NAMES, PAGE_KIND_NAMES, RUNTIME_KIND_NAMES, CHAT_KIND_NAMES, HISTORY_KIND_NAMES,
  isChatRequest, isHistoryRequest, isHostRequest, isLocalKind, isPageRequest, isRuntimeRequest,
} from "../contracts/guards.js";
import { LOCATE_MAX, PROTOCOL, SEARCH_MAX, SEARCH_QUERY_MAX } from "../contracts/wire.js";

const env = (kind: string, rest: Record<string, unknown> = {}) => ({ id: "c1", g: PROTOCOL, kind, ...rest });
const UID = "u1nvented0001";
const many = (n: number, make: (i: number) => string) => Array.from({ length: n }, (_, i) => make(i));

test("THE PAGE KINDS, EXACTLY: a kind added here is a decision this snapshot makes somebody state", () => {
  expect([...PAGE_KIND_NAMES]).toEqual(["page.locate", "page.search"]);
  expect(LOCATE_MAX).toBe(256);
  expect(SEARCH_MAX).toBe(50);
  expect(SEARCH_QUERY_MAX).toBe(200);
});

test("page.locate names ids, identities or both, each bounded, and is refused otherwise", () => {
  const cases: [Record<string, unknown>, boolean][] = [
    [env("page.locate", { ids: ["home/Specs"] }), true],
    [env("page.locate", { uids: [UID] }), true],
    [env("page.locate", { ids: ["home", "home/Specs/2026-09-24-Chat"], uids: [UID, "a1b2c3d4e5"] }), true],
    [env("page.locate", { ids: [] }), true],
    [env("page.locate", { ids: many(LOCATE_MAX, (i) => `home/p${i}`) }), true],
    [env("page.locate", { uids: many(LOCATE_MAX, (i) => `u${String(i).padStart(9, "0")}`) }), true],
    // Neither list is a question with no subject.
    [env("page.locate"), false],
    [env("page.locate", { ids: many(LOCATE_MAX + 1, (i) => `home/p${i}`) }), false],
    [env("page.locate", { uids: many(LOCATE_MAX + 1, (i) => `u${String(i).padStart(9, "0")}`) }), false],
    [env("page.locate", { ids: "home/Specs" }), false],
    [env("page.locate", { ids: [""] }), false],
    [env("page.locate", { ids: [3] }), false],
    [env("page.locate", { ids: ["a".repeat(1025)] }), false],
    [env("page.locate", { ids: ["home\u0000x"] }), false],
    [env("page.locate", { uids: ["short"] }), false],
    [env("page.locate", { uids: ["has spaces in it"] }), false],
  ];
  for (const [req, want] of cases) expect([JSON.stringify(req).slice(0, 90), isPageRequest(req)]).toEqual([JSON.stringify(req).slice(0, 90), want]);
});

test("page.search takes a query with something in it and a bounded limit", () => {
  const cases: [Record<string, unknown>, boolean][] = [
    [env("page.search", { query: "specs" }), true],
    [env("page.search", { query: "Run 12", limit: 1 }), true],
    [env("page.search", { query: "x", limit: SEARCH_MAX }), true],
    [env("page.search", { query: "q".repeat(SEARCH_QUERY_MAX) }), true],
    [env("page.search"), false],
    [env("page.search", { query: "" }), false],
    [env("page.search", { query: "   " }), false],
    [env("page.search", { query: "q".repeat(SEARCH_QUERY_MAX + 1) }), false],
    [env("page.search", { query: "x", limit: 0 }), false],
    [env("page.search", { query: "x", limit: SEARCH_MAX + 1 }), false],
    [env("page.search", { query: "x", limit: 2.5 }), false],
    [env("page.search", { query: "x", limit: "10" }), false],
    [env("page.search", { query: 7 }), false],
  ];
  for (const [req, want] of cases) expect([JSON.stringify(req), isPageRequest(req)]).toEqual([JSON.stringify(req), want]);
});

test("the envelope's window is optional and checked on the page kinds, as on every other", () => {
  expect(isPageRequest(env("page.search", { query: "x", window: "w1nvented-window-0001" }))).toBe(true);
  expect(isPageRequest(env("page.search", { query: "x", window: "bad window" }))).toBe(false);
});

test("THE PAGE KINDS ARE OUTER RING AND NOTHING ELSE: no box asks them, and they are reads a run may make", () => {
  const good = [env("page.locate", { ids: ["home"] }), env("page.search", { query: "x" })];
  for (const req of good) {
    expect([req.kind, isHostRequest(req), isRuntimeRequest(req), isChatRequest(req), isHistoryRequest(req)])
      .toEqual([req.kind, false, false, false, false]);
    // Not local-gated: a read, on the launch token, like history.read.
    expect([req.kind, isLocalKind(req.kind)]).toEqual([req.kind, false]);
  }
  for (const kind of PAGE_KIND_NAMES) {
    expect([kind, HOST_KIND_NAMES.includes(kind), RUNTIME_KIND_NAMES.includes(kind), CHAT_KIND_NAMES.includes(kind),
      HISTORY_KIND_NAMES.includes(kind), LOCAL_KIND_NAMES.includes(kind)]).toEqual([kind, false, false, false, false, false]);
  }
  // And no other guard's kind is one of these.
  expect(isPageRequest(env("page.list"))).toBe(false);
  expect(isPageRequest(env("children.all"))).toBe(false);
  expect(isPageRequest(env("chat.list"))).toBe(false);
});
