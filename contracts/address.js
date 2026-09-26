// SPDX-License-Identifier: AGPL-3.0-only
// EVERY SCREEN HAS AN ADDRESS. Layer 0: imports nothing, does no I/O.
//
// The eleventh contracts edit, for the workspace's *History and View Switcher*
// spec. The switcher routes to addresses, the history records them and the
// context holds the current one — so the address is a value three modules on
// two tiers read, and this file is its one spelling: the vocabulary of views,
// a page's own screens, which screens are held, and the two pure functions
// between an address and the url fragment that carries it.
//
// IT IS ITS OWN FILE AND NOT PART OF `wire.js`, because `wire.js` is what
// `guest/biom.js` copies by hand into the box, and the box never needs an
// address: it is told its own page and nothing else. Keeping this apart keeps
// that copy as small as it has always been.

/** @import { Address, PageId, PageScreen, Place, ViewName } from "./types.ts" */

/** THE ROUTE VOCABULARY, and it is typed so that it cannot drift from
 *  `ViewName`: an object whose keys are exactly the union's members fails to
 *  typecheck with one missing or one extra, so the list a hash is checked
 *  against and the type every route carries are one statement in two forms.
 *  @type {{ readonly [K in ViewName]: true }} */
const VIEWS = {
  page: true,
  table: true,
  vault: true,
  design: true,
  map: true,
  runs: true,
  instructions: true,
  agent: true,
};

/** Every view a url may name. A hash is user input — the one thing in the
 *  client that arrives from outside without passing the server — so an
 *  unknown view falls back rather than routing to nothing.
 *  @type {ReadonlySet<ViewName>} */
export const VIEW_NAMES = new Set(/** @type {ViewName[]} */ (Object.keys(VIEWS)));

/** THE VIEWS AN ADDRESS NAMES SOMETHING IN: a page, a table, a chat. Every
 *  other view is one screen with nothing in it to name, so an id there is a
 *  stray and is dropped — `#/design/x` is Design.
 *  @type {ReadonlySet<ViewName>} */
const ID_VIEWS = new Set(/** @type {ViewName[]} */ (["page", "table", "agent"]));

/** @type {{ readonly [K in PageScreen]: true }} */
const SCREENS = { page: true, instructions: true, automation: true };

/** A page's own screens. `page` is the page itself and is never written into a
 *  url — an address with no screen after the id IS the page.
 *  @type {ReadonlySet<PageScreen>} */
export const PAGE_SCREENS = new Set(/** @type {PageScreen[]} */ (Object.keys(SCREENS)));

/** THE HELD SCREENS: the ones the switcher never leaves for an agent, however
 *  long since the person last touched it. A page's Automations is a form over
 *  an automation's manifest and files, where a switch mid-edit takes the
 *  person's place in it. THIS IS THE LIST — the spec's address table marks
 *  the column and this is that column — and plain text that saves itself, like
 *  the Instructions, is not on it.
 *  @type {ReadonlyArray<{ readonly view: ViewName, readonly screen: PageScreen }>} */
export const HELD = Object.freeze([Object.freeze({ view: /** @type {ViewName} */ ("page"), screen: /** @type {PageScreen} */ ("automation") })]);

/** THE ADDRESS WHERE NOTHING WAS NAMED: a page with no id, which boot fills
 *  with the first page in the workspace. It carries no id on purpose: an
 *  unknown view landing on a page with an id taken from its route would open
 *  whatever page happened to share the name. */
const NOWHERE = Object.freeze(/** @type {Address} */ ({ view: "page", id: "", screen: "page" }));

/**
 * An address, normalised: `screen` is a page's own screen only where there is
 * a page — every other view, and a page with no id, is `page` — and an id only
 * where the view names something. Every address anything builds goes through
 * here, so two spellings of one place compare equal.
 * @param {ViewName} view
 * @param {string} [id]
 * @param {PageScreen} [screen]
 * @returns {Address}
 */
export function address(view, id = "", screen = "page") {
  const named = ID_VIEWS.has(view) ? id : "";
  return { view, id: named, screen: view === "page" && named !== "" && PAGE_SCREENS.has(screen) ? screen : "page" };
}

/**
 * The same address, normalised — and THE SAME OBJECT when it already was, so a
 * store that normalises on every write does not repaint on a no-op. A route
 * from before the screen joined it — `{ view, id }` — is read as the page.
 * @param {{ view: ViewName, id: string, screen?: PageScreen }} a
 * @returns {Address}
 */
export function normalAddress(a) {
  const want = address(a.view, a.id, a.screen);
  return a.screen === want.screen && a.id === want.id ? /** @type {Address} */ (a) : want;
}

/**
 * THE ADDRESS A URL FRAGMENT NAMES. `#/<view>/<id>`, and for a page's own
 * screens `#/page/<id>/<screen>`.
 *
 * THE ID IS ONE ENCODED SEGMENT when this module wrote it — a page id's slashes
 * are `%2F` — so a screen after it is never ambiguous. A hash somebody TYPED
 * with the slashes left in, `#/page/home/Specs`, still reads as the page
 * `home/Specs`, as it always has: every segment is decoded and joined. The
 * one reading that costs is a typed page whose last segment is a screen's
 * word, which names that screen of its parent — a url this module writes can
 * never say that, because it encodes.
 *
 * `page` is never read as a screen: the page itself has no suffix, and a page
 * called `page` is a page.
 *
 * A malformed escape is user input reaching the router, not a crash, and an
 * unknown view is nonsense like any other: both are the address of nothing.
 * @param {string} hash
 * @returns {Address}
 */
export function parseAddress(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const parts = raw.split("/");
  const view = parts[0] ?? "";
  if (!VIEW_NAMES.has(/** @type {ViewName} */ (view))) return NOWHERE;
  let rest = parts.slice(1);
  /** @type {PageScreen} */
  let screen = "page";
  const last = rest[rest.length - 1];
  if (view === "page" && rest.length >= 2 && last !== undefined && last !== "page" && PAGE_SCREENS.has(/** @type {PageScreen} */ (last))) {
    screen = /** @type {PageScreen} */ (last);
    rest = rest.slice(0, -1);
  }
  let id;
  try {
    id = rest.map((one) => decodeURIComponent(one)).join("/");
  } catch {
    return NOWHERE;
  }
  return address(/** @type {ViewName} */ (view), id, screen);
}

/**
 * The url fragment for an address, which `parseAddress` reads back as the same
 * address for every address `address()` can build.
 * @param {{ view: ViewName, id: string, screen?: PageScreen }} a
 * @returns {string}
 */
export function formatAddress(a) {
  const n = normalAddress(a);
  return "#/" + n.view + (n.id ? "/" + encodeURIComponent(n.id) : "") + (n.screen !== "page" ? "/" + n.screen : "");
}

/**
 * Whether two addresses are one place.
 * @param {{ view: ViewName, id: string, screen?: PageScreen }} a
 * @param {{ view: ViewName, id: string, screen?: PageScreen }} b
 */
export function sameAddress(a, b) {
  const x = normalAddress(a);
  const y = normalAddress(b);
  return x.view === y.view && x.id === y.id && x.screen === y.screen;
}

/**
 * Whether the switcher must never leave this screen for an agent.
 * @param {{ view: ViewName, id: string, screen?: PageScreen }} a
 */
export function isHeld(a) {
  const n = normalAddress(a);
  return HELD.some((h) => h.view === n.view && h.screen === n.screen);
}

/**
 * An address AS THE HISTORY KEEPS IT: a page by its `uid`, looked up by the
 * caller, which is the side that holds the page list. Null where the page has
 * no `uid`, or where the address names no page at all — neither is a place.
 * @param {Address} a
 * @param {(id: PageId) => string | null} uidOf
 * @returns {Place | null}
 */
export function placeOf(a, uidOf) {
  const n = normalAddress(a);
  if (n.view === "page") {
    const uid = n.id === "" ? null : uidOf(n.id);
    return uid ? { view: "page", uid, screen: n.screen } : null;
  }
  return { view: n.view, id: n.id };
}

/**
 * A place BACK TO AN ADDRESS: a page's `uid` to wherever the page is now,
 * looked up by the caller. Null for a page that is gone, which a reader skips.
 * @param {Place} p
 * @param {(uid: string) => PageId | null} idOf
 * @returns {Address | null}
 */
export function addressOfPlace(p, idOf) {
  if (p.view === "page") {
    const id = idOf(p.uid);
    return id ? address("page", id, p.screen) : null;
  }
  return address(p.view, p.id);
}

/**
 * Whether two places are one.
 * @param {Place} a
 * @param {Place} b
 */
export function samePlace(a, b) {
  if (a.view === "page" || b.view === "page") {
    return a.view === "page" && b.view === "page" && a.uid === b.uid && a.screen === b.screen;
  }
  return a.view === b.view && a.id === b.id;
}
