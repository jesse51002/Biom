// SPDX-License-Identifier: AGPL-3.0-only
// The contract's own tests. These guard the chokepoint, so they are the most
// load-bearing tests in the framework: a guard that typechecks but accepts a bad
// request is worse than no guard, because it reads as enforcement.

import { test, expect } from "bun:test";
import { isHostRequest, isRuntimeRequest, isVarValue, isVarPatch, isRowInput, isGuestNotice } from "../contracts/guards.js";
import { PROTOCOL, fail, ERRORS, nextId } from "../contracts/wire.js";
import { emitter } from "../contracts/emitter.js";

const req = (o) => ({ id: "c1", g: PROTOCOL, ...o });

test("accepts what an artifact may say", () => {
  expect(isHostRequest(req({ kind: "data.get" }))).toBe(true);
  expect(isHostRequest(req({ kind: "doc.list" }))).toBe(true);
  expect(isHostRequest(req({ kind: "theme.get" }))).toBe(true);
  expect(isHostRequest(req({ kind: "table.get", name: "jobs" }))).toBe(true);
  expect(isHostRequest(req({ kind: "row.update", name: "jobs", row: 3, patch: { stage: "Done" } }))).toBe(true);
  // A slot key is a variable name in this content's own scope. The dot the host
  // used to add is gone with the flat sidecar, but a NAME may still hold one —
  // a page that took the whole sheet has no contents to group by and names its
  // variables `board.title` — so nothing here refuses it.
  expect(isHostRequest(req({ kind: "data.set", patch: { heading: "This week" } }))).toBe(true);
  expect(isHostRequest(req({ kind: "data.set", patch: { "board.heading": "This week" } }))).toBe(true);
  expect(isHostRequest(req({ kind: "fetch", url: "https://example.com" }))).toBe(true);

  // `children` is layer one of the child contract — the normalised read every
  // page may make whether or not it draws any of what it holds. It was in
  // HostRequest and in the bridge's switch, but missing from HOST_KINDS, so the
  // guard refused it one line before the case that handles it ever ran. That
  // made R38 unsatisfiable: a `@page-<id>.html` file is REQUIRED to call this,
  // and the rule the checker enforces mandated a call the chokepoint refused.
  expect(isHostRequest(req({ kind: "children" }))).toBe(true);
  expect(isHostRequest(req({ kind: "children", page: "team-hub" }))).toBe(true);
});

test("refuses what only the workspace UI may say", () => {
  // The chokepoint. These are ApiRequest kinds absent from HostRequest, and an
  // artifact must not be able to express any of them.
  for (const kind of [
    "page.list", "page.create", "page.remove", "page.writeFile",
    "page.move", "doc.raw", "doc.writeRaw",
    "table.create", "table.alter", "table.remove", "table.setParent", "table.importCsv",
    // `vault.info` is NOT in this list and the four beside it are, which is the
    // whole of the line between them: *which folder is this* is about the folder
    // the request already named and carries no path, while browsing, opening,
    // making and remembering each name a folder that is not this one.
    "theme.set", "vault.browse", "vault.open", "vault.create", "vault.recent",
    "design.read", "design.patch", "design.writeFile",
  ]) {
    expect(isHostRequest(req({ kind }))).toBe(false);
  }
});

// The FIFTH kind added to the inner ring, and the first that was already a kind
// somewhere else — it has been in `ApiRequest` since the picker existed, and
// what changed is which ring a page can reach it from. So this asserts the ring
// rather than the spelling: reachable from a section, and the four vault kinds
// that NAME a folder still unsayable on either port.
test("vault.info is in the inner ring, and the vault kinds that name a folder are not", () => {
  expect(isHostRequest(req({ kind: "vault.info" }))).toBe(true);
  expect(isRuntimeRequest(req({ kind: "vault.info" }))).toBe(true);

  // A page may know where it lives because a person reading it has to be able to
  // point an agent at it. It may not look around and it may not move.
  for (const r of [
    req({ kind: "vault.browse", path: "/" }),
    req({ kind: "vault.open", path: "/tmp/other" }),
    req({ kind: "vault.create", parent: "/tmp", name: "other" }),
    req({ kind: "vault.recent" }),
  ]) {
    expect(isHostRequest(r)).toBe(false);
    expect(isRuntimeRequest(r)).toBe(false);
  }
});

test("refuses what only the SECTION RUNTIME may say", () => {
  // The middle ring, and the reason there are three: the runtime has to read
  // the page and write its shape back, and a section must never be able to —
  // a generated page that could call `section.order` could restructure the
  // workspace it was asked to decorate. Well-formed for the middle ring and
  // still refused by the inner one, which is what makes this a ring boundary
  // rather than a spelling check.
  const runtimeOnly = [
    req({ kind: "page.read", page: "notes" }),
    req({ kind: "section.write", page: "notes", section: "intro", part: "body", data: "hi" }),
    req({ kind: "section.order", page: "notes", sections: [] }),
    req({ kind: "section.remove", page: "notes", section: "intro" }),
    req({ kind: "variables.patch", page: "notes", section: null, patch: { rate: 62 } }),
  ];
  for (const r of runtimeOnly) {
    expect(isRuntimeRequest(r)).toBe(true);
    expect(isHostRequest(r)).toBe(false);
  }
});

test("the middle ring is strictly WIDER than the inner one, not a different one", () => {
  // A runtime that could not also read a table would need a second channel to
  // do it on, so everything a section may say the runtime may say too.
  for (const r of [
    req({ kind: "data.get" }),
    req({ kind: "children" }),
    req({ kind: "table.get", name: "jobs" }),
    req({ kind: "open", target: { kind: "page", id: "notes" } }),
  ]) {
    expect(isHostRequest(r)).toBe(true);
    expect(isRuntimeRequest(r)).toBe(true);
  }
  // And strictly NARROWER than the server's own surface: a page created, a
  // table dropped or another folder opened stays unsayable on either port.
  for (const kind of ["page.create", "table.remove", "vault.open", "design.read"]) {
    expect(isRuntimeRequest(req({ kind }))).toBe(false);
  }
});

test("the runtime's own kinds are checked, not merely named", () => {
  // A guard that accepts a kind with the wrong payload reads as enforcement and
  // is not. `section.write` carries four strings and every one of them matters.
  expect(isRuntimeRequest(req({ kind: "page.read" }))).toBe(false);
  expect(isRuntimeRequest(req({ kind: "page.read", page: "" }))).toBe(false);
  expect(isRuntimeRequest(req({
    kind: "section.write", page: "notes", section: "intro", part: "body",
  }))).toBe(false);                                            // no data
  expect(isRuntimeRequest(req({
    kind: "section.write", page: "notes", section: "", part: "body", data: "x",
  }))).toBe(false);
  expect(isRuntimeRequest(req({ kind: "section.order", page: "notes" }))).toBe(false);
  expect(isRuntimeRequest(req({
    kind: "variables.patch", page: "notes", section: "intro", patch: { a: { b: 1 } },
  }))).toBe(false);                                            // not flat
});

// A GAP IN THE FROZEN CONTRACT, PINNED HERE RATHER THAN LEFT TO BE FOUND.
//
// `variables` — another page values, the call that exists so reaching across a
// page boundary is never a template.
//
// It shipped UNREACHABLE: in HostRequest, routed by the bridge, and missing from
// HOST_KINDS, so the guard refused it one line before the case could run. That is
// the THIRD kind to arrive that way — `children` cost a fifteen-second stall,
// `open` was caught by the typechecker, this one by an agent reading the file.
// The guard now names all three in a comment, and this asserts the fix.
test("variables reaches the bridge, which the first two of its kind did not", () => {
  expect(isHostRequest(req({ kind: "variables" }))).toBe(true);
  expect(isHostRequest(req({ kind: "variables", page: "home/Rates" }))).toBe(true);
});

// The FOURTH kind to be added to the inner ring, and the first added with the
// note above already in the file. Pinned the same way: reachable, and refused
// when it names nothing.
test("link.resolve reaches the bridge, and takes a target that is actually a target", () => {
  expect(isHostRequest(req({ kind: "link.resolve", target: "home/Companies/Airtable" }))).toBe(true);
  expect(isHostRequest(req({ kind: "link.resolve", target: "Airtable" }))).toBe(true);
  expect(isHostRequest(req({ kind: "link.resolve" }))).toBe(false);
  expect(isHostRequest(req({ kind: "link.resolve", target: "" }))).toBe(false);
  expect(isHostRequest(req({ kind: "link.resolve", target: 7 }))).toBe(false);
});

test("refuses malformed envelopes", () => {
  expect(isHostRequest({ kind: "data.get" })).toBe(false);              // no id, no major
  expect(isHostRequest(req({ kind: "data.get", g: 99 }))).toBe(false);  // unknown major
  expect(isHostRequest({ id: "", g: PROTOCOL, kind: "data.get" })).toBe(false);
  expect(isHostRequest(null)).toBe(false);
  expect(isHostRequest([])).toBe(false);
  expect(isHostRequest("data.get")).toBe(false);
  expect(isHostRequest(undefined)).toBe(false);
});

test("refuses bad params on a legal kind", () => {
  expect(isHostRequest(req({ kind: "table.get" }))).toBe(false);
  expect(isHostRequest(req({ kind: "table.get", name: "" }))).toBe(false);
  expect(isHostRequest(req({ kind: "row.update", name: "j", row: 1.5, patch: {} }))).toBe(false);
  expect(isHostRequest(req({ kind: "row.insert", name: "j", row: { a: [1] } }))).toBe(false);
  expect(isHostRequest(req({ kind: "sql", query: "SELECT 1", params: [{}] }))).toBe(false);
  expect(isHostRequest(req({ kind: "fetch" }))).toBe(false);
});

test("a variable is a scalar or a list of scalars, checked at the wire", () => {
  // The rule survived the format change and moved down a level with it: the
  // document nests — `variables` is a map and `contents` is a list of them —
  // but a VALUE is still something a person types into a field, so nothing
  // structured can be written where a variable goes.
  expect(isVarValue("x")).toBe(true);
  expect(isVarValue(["a", 2, null])).toBe(true);
  expect(isVarValue({ a: 1 })).toBe(false);
  expect(isVarValue([{ a: 1 }])).toBe(false);   // no objects inside lists
  expect(isVarValue([["a"]])).toBe(false);      // no nesting at all
  expect(isVarPatch({ title: "Quote", tiers: ["A", "B"] })).toBe(true);
  expect(isVarPatch({ calc: { title: "Quote" } })).toBe(false);
});

test("a row input is scalars only", () => {
  expect(isRowInput({ name: "Ash St", days: 4, done: false, when: null })).toBe(true);
  expect(isRowInput({ tags: ["a"] })).toBe(false);  // categories arrive as JSON text
  expect(isRowInput(null)).toBe(false);
});

test("guest notices, which are the only way the host learns about a frame", () => {
  // `hello` asks for the ports before the DOM exists; `ready` reports the
  // SECTION count once the runtime has drawn. Splitting them is what keeps a
  // top-level await alive.
  expect(isGuestNotice({ kind: "hello", g: 1 })).toBe(true);
  expect(isGuestNotice({ kind: "hello" })).toBe(false);
  expect(isGuestNotice({ kind: "ready", g: 1, sections: 4 })).toBe(true);
  // Zero is a real answer and means an empty page, not a failure.
  expect(isGuestNotice({ kind: "ready", g: 1, sections: 0 })).toBe(true);
  expect(isGuestNotice({ kind: "ready", g: 1 })).toBe(false);
  expect(isGuestNotice({ kind: "error", message: "boom" })).toBe(true);
  // THERE IS NO `size`, and its absence is load-bearing rather than an
  // omission: one box fills the canvas and scrolls inside itself, so it never
  // reports a height. A box that sized itself to its content would put the
  // scroller OUTSIDE it, and a section could not drive a scroll effect at all.
  expect(isGuestNotice({ kind: "size", height: 320 })).toBe(false);
  expect(isGuestNotice({ kind: "whatever" })).toBe(false);
  // A box letting go of a page it embedded, by the token the grant carried.
  expect(isGuestNotice({ kind: "unembed", g: 1, embed: "e1" })).toBe(true);
  expect(isGuestNotice({ kind: "unembed", g: 1 })).toBe(false);
  expect(isGuestNotice({ kind: "unembed", g: 1, embed: "" })).toBe(false);
  // WHERE THE BOX IS SCROLLED TO, in pixels, so a redraw can put it back. A
  // position and never a height: the run it is clamped against is measured in
  // the box, and nothing about the box's content crosses here.
  expect(isGuestNotice({ kind: "position", g: 1, top: 640 })).toBe(true);
  expect(isGuestNotice({ kind: "position", g: 1, top: 0 })).toBe(true);
  expect(isGuestNotice({ kind: "position", g: 1, top: 12.5 })).toBe(true);
  expect(isGuestNotice({ kind: "position", g: 1 })).toBe(false);
  expect(isGuestNotice({ kind: "position", g: 1, top: -1 })).toBe(false);
  expect(isGuestNotice({ kind: "position", g: 1, top: NaN })).toBe(false);
  expect(isGuestNotice({ kind: "position", g: 1, top: "640" })).toBe(false);
  expect(isGuestNotice({ kind: "position", top: 640 })).toBe(false);
});

// ANOTHER PAGE, DRAWN. The fourth kind added to HostRequest after the note on
// HOST_KINDS was written, and pinned the same way as the two before it.
test("page.embed reaches the bridge, and names a page", () => {
  expect(isHostRequest(req({ kind: "page.embed", page: "home/Demos/Astra" }))).toBe(true);
  expect(isRuntimeRequest(req({ kind: "page.embed", page: "home/Demos/Astra" }))).toBe(true);
  expect(isHostRequest(req({ kind: "page.embed" }))).toBe(false);
  expect(isHostRequest(req({ kind: "page.embed", page: "" }))).toBe(false);
});

test("wire helpers", () => {
  expect(fail(ERRORS.LIMIT, "too many").retryable).toBe(true);
  expect(fail(ERRORS.FETCH_FAILED, "upstream").retryable).toBe(true);
  expect(fail(ERRORS.BAD_REQUEST, "nope").retryable).toBe(false);
  expect(nextId()).not.toBe(nextId());
});

test("emitter unsubscribes, and survives a listener removing itself mid-emit", () => {
  const e = emitter();
  let n = 0;
  const off = e.on(() => { n++; off(); });
  e.on(() => { n += 10; });
  e.emit(1);
  e.emit(1);
  expect(n).toBe(21);      // first ran once then removed itself; second ran twice
  expect(e.size()).toBe(1);
});
