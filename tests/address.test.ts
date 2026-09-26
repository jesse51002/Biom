// SPDX-License-Identifier: AGPL-3.0-only
// EVERY SCREEN HAS AN ADDRESS — `contracts/address.js`, the eleventh contracts
// edit. The switcher routes to addresses, the history records them and the
// context holds the current one, so this file holds the one spelling: every
// screen round-trips through its url fragment, ids with slashes included; a
// hash somebody typed still reads the way it always did; the held screens are
// data; and a page named by its `uid` in the history comes back to wherever
// the page is now. Page ids and chat ids here are invented and say so.

import { test, expect } from "bun:test";

import {
  HELD, PAGE_SCREENS, VIEW_NAMES,
  address, addressOfPlace, formatAddress, isHeld, normalAddress, parseAddress, placeOf, sameAddress, samePlace,
} from "../contracts/address.js";
import { VIEWS } from "../client/shell/shell.js";

/** Invented ids: a page deep in a tree, one with a space and a percent, one
 *  whose LAST SEGMENT is a screen's word, one in another script. */
const PAGE_IDS = [
  "home",
  "home/Specs",
  "home/Specs/2026-09-24-Chat",
  "home/Field notes/100% sure",
  "home/instructions",
  "home/automation",
  "home/page",
  "home/Café ☕/Ümlaut",
  "home/a#b?c&d=e",
];

test("the vocabulary is the type's: the Agent screen is in it, the retired Theme screen is not", () => {
  expect([...VIEW_NAMES].sort()).toEqual(["agent", "design", "instructions", "map", "page", "runs", "table", "vault"]);
  expect(VIEW_NAMES.has("theme" as never)).toBe(false);
  // The shell's list IS this one — the rail and a typed hash read one vocabulary.
  expect(VIEWS).toBe(VIEW_NAMES);
  expect([...PAGE_SCREENS]).toEqual(["page", "instructions", "automation"]);
});

test("EVERY SCREEN round-trips through its url fragment", () => {
  const every = [
    ...PAGE_IDS.flatMap((id) => [...PAGE_SCREENS].map((screen) => address("page", id, screen))),
    address("table", "jobs"),
    address("table", "a/b table"),
    address("design"),
    address("instructions"),
    address("runs"),
    address("map"),
    address("vault"),
    address("agent"),
    address("agent", "0f3c9d2e-invented-chat-id"),
  ];
  for (const a of every) {
    const hash = formatAddress(a);
    expect([hash, parseAddress(hash)]).toEqual([hash, a]);
  }
});

test("the url a page's screens are written at", () => {
  expect(formatAddress(address("page", "home/Specs"))).toBe("#/page/home%2FSpecs");
  expect(formatAddress(address("page", "home/Specs", "instructions"))).toBe("#/page/home%2FSpecs/instructions");
  expect(formatAddress(address("page", "home/Specs", "automation"))).toBe("#/page/home%2FSpecs/automation");
  expect(formatAddress(address("agent"))).toBe("#/agent");
  expect(formatAddress(address("agent", "chat-0001"))).toBe("#/agent/chat-0001");
  expect(formatAddress(address("design"))).toBe("#/design");
});

test("a hash somebody TYPED with the slashes left in still reads as the page it names", () => {
  expect(parseAddress("#/page/home/Specs")).toEqual(address("page", "home/Specs"));
  expect(parseAddress("#/page/home/Specs/instructions")).toEqual(address("page", "home/Specs", "instructions"));
  expect(parseAddress("#/page/home/Specs/automation")).toEqual(address("page", "home/Specs", "automation"));
  // `page` is never a screen word: a page called `page` is a page.
  expect(parseAddress("#/page/home/page")).toEqual(address("page", "home/page"));
  // One segment is always the id, even when it is a screen's word.
  expect(parseAddress("#/page/instructions")).toEqual(address("page", "instructions"));
  // A screen is a page's alone; on another view the rest is the id.
  expect(parseAddress("#/table/jobs/instructions")).toEqual(address("table", "jobs/instructions"));
  // No leading slash is forgiven, as it always was.
  expect(parseAddress("#page/home")).toEqual(address("page", "home"));
});

test("nonsense is the address of nothing, never a crash", () => {
  const nowhere = { view: "page", id: "", screen: "page" };
  for (const hash of ["", "#", "#/", "#/market", "#/theme", "#/nonsense/x", "#/page/%E0%A4%A", "#/agent/%"]) {
    expect([hash, parseAddress(hash)]).toEqual([hash, nowhere]);
  }
});

test("an address is normalised wherever it is built: a screen only where there is a page", () => {
  expect(address("page", "", "instructions")).toEqual({ view: "page", id: "", screen: "page" });
  expect(address("design", "", "automation")).toEqual({ view: "design", id: "", screen: "page" });
  expect(address("page", "home", "nonsense" as never)).toEqual({ view: "page", id: "home", screen: "page" });
  // A route from before the screen joined it reads as the page's own face…
  expect(normalAddress({ view: "page", id: "home" })).toEqual(address("page", "home"));
  // …and one that already was normal is the SAME object, so a store that
  // normalises every write repaints on nothing.
  const a = address("page", "home", "instructions");
  expect(normalAddress(a)).toBe(a);
  expect(formatAddress({ view: "page", id: "", screen: "automation" })).toBe("#/page");
});

test("two spellings of one place are the same address", () => {
  expect(sameAddress({ view: "page", id: "home" }, address("page", "home"))).toBe(true);
  expect(sameAddress(address("page", "home"), address("page", "home", "instructions"))).toBe(false);
  expect(sameAddress(address("table", "x", "automation"), address("table", "x"))).toBe(true);
});

test("THE HELD SCREENS ARE DATA: a page's Automations and nothing else", () => {
  expect(HELD).toEqual([{ view: "page", screen: "automation" }]);
  expect(isHeld(address("page", "home/Specs", "automation"))).toBe(true);
  // Plain text that saves itself is not held.
  expect(isHeld(address("page", "home/Specs", "instructions"))).toBe(false);
  expect(isHeld(address("page", "home/Specs"))).toBe(false);
  // The workspace's own Automations screen is a list, not a form mid-edit.
  for (const view of VIEW_NAMES) if (view !== "page") expect([view, isHeld(address(view))]).toEqual([view, false]);
  expect(Object.isFrozen(HELD)).toBe(true);
});

test("the history names a page by its uid, and a place comes back to wherever the page is now", () => {
  // Invented: a page that was renamed from `home/Notes` to `home/Field-notes`.
  const uids = new Map([["home/Notes", "u1nvented0001"]]);
  const now = new Map([["u1nvented0001", "home/Field-notes"]]);
  const uidOf = (id: string) => uids.get(id) ?? null;
  const idOf = (uid: string) => now.get(uid) ?? null;

  const place = placeOf(address("page", "home/Notes", "instructions"), uidOf);
  expect(place).toEqual({ view: "page", uid: "u1nvented0001", screen: "instructions" });
  expect(addressOfPlace(place!, idOf)).toEqual(address("page", "home/Field-notes", "instructions"));

  // A page with no uid is not a place, and a deleted one is skipped.
  expect(placeOf(address("page", "home/Unparseable"), uidOf)).toBeNull();
  expect(placeOf(address("page"), uidOf)).toBeNull();
  expect(addressOfPlace({ view: "page", uid: "gone0000", screen: "page" }, idOf)).toBeNull();

  // Every other view is its own place.
  expect(placeOf(address("agent", "chat-0001"), uidOf)).toEqual({ view: "agent", id: "chat-0001" });
  expect(addressOfPlace({ view: "design", id: "" }, idOf)).toEqual(address("design"));

  expect(samePlace({ view: "page", uid: "a1b2c3d4", screen: "page" }, { view: "page", uid: "a1b2c3d4", screen: "page" })).toBe(true);
  expect(samePlace({ view: "page", uid: "a1b2c3d4", screen: "page" }, { view: "page", uid: "a1b2c3d4", screen: "automation" })).toBe(false);
  expect(samePlace({ view: "agent", id: "x" }, { view: "agent", id: "x" })).toBe(true);
  expect(samePlace({ view: "agent", id: "x" }, { view: "table", id: "x" })).toBe(false);
});

test("A GENERATED ROUND-TRIP: any id, of any characters, in any view that names one, comes back as it went", () => {
  // Deterministic, so a failure names a seed that reproduces it. The alphabet
  // is what trips a url: separators, escapes, reserved characters, spaces,
  // other scripts, and the screen words themselves.
  const alphabet = [..."aZ09-_ /%#?&=+.@~:;,'!*()[]", "é", "☕", "中", "instructions", "automation", "page", "%2F", "%"];
  let seed = 20260926;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const word = () => Array.from({ length: 1 + Math.floor(rand() * 6) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
  let n = 0;
  for (let i = 0; i < 2000; i++) {
    const view = (["page", "table", "agent"] as const)[Math.floor(rand() * 3)]!;
    const id = Array.from({ length: 1 + Math.floor(rand() * 4) }, word).join("/");
    const screen = ([...PAGE_SCREENS] as ("page" | "instructions" | "automation")[])[Math.floor(rand() * 3)]!;
    const a = address(view, id, screen);
    const back = parseAddress(formatAddress(a));
    if (JSON.stringify(back) !== JSON.stringify(a)) throw new Error(`seed ${i}: ${JSON.stringify(a)} came back as ${JSON.stringify(back)}`);
    n++;
  }
  expect(n).toBe(2000);
});

test("a stray id on a view that names nothing is dropped", () => {
  expect(address("design", "foo")).toEqual({ view: "design", id: "", screen: "page" });
  expect(address("runs", "x", "automation")).toEqual({ view: "runs", id: "", screen: "page" });
  expect(parseAddress("#/design/foo")).toEqual(address("design"));
  expect(parseAddress("#/map/anything/at/all")).toEqual(address("map"));
  // The views that name something keep it.
  expect(address("table", "jobs").id).toBe("jobs");
  expect(address("agent", "chat-0001").id).toBe("chat-0001");
  // And a route written with a stray id is normalised to a new object.
  const stray = { view: "design" as const, id: "foo", screen: "page" as const };
  expect(normalAddress(stray)).toEqual(address("design"));
  expect(normalAddress(stray)).not.toBe(stray);
});
