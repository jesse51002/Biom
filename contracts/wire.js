// SPDX-License-Identifier: AGPL-3.0-only
// Protocol constants. Layer 0: imports nothing.
//
// Both sides of every boundary read these, including guest/biom.js, which
// is inlined into the artifact's frame and therefore cannot import — so this
// file's values are duplicated there deliberately and must be kept in step.
// It is the one duplication in the framework and it is why this file is tiny.

/** @import { HostError, HostErrorCode } from "./types.ts" */

/** The protocol major, on every frame. An unknown major is dropped silently
 *  rather than answered, and at most two majors are ever live at once. */
export const PROTOCOL = 1;

/** WHERE A SLOT IS, in a section's own HTML. One `data-g-part="<id>"` per entry
 *  in that section's `parts`, and the id is the key it sits under there — so a
 *  section's markup and its document name the same slots without either
 *  restating the other.
 *
 *  It used to be `data-g-slot`, and it named a VARIABLE rather than a slot: a
 *  block's editable regions were keys in a flat sidecar, and the shim hydrated
 *  each one from that dictionary. A section holds parts now — prose, a table, a
 *  child — and a part is a thing the runtime FILLS rather than a string it
 *  substitutes, so the attribute names what goes in the hole instead of which
 *  value to print in it. The spelling moved with the meaning.
 *
 *  The host cannot read an opaque-origin frame's DOM, so what is in there is
 *  self-reported. The `ready` notice carries the SECTION count, which is a
 *  different number: the runtime knows how many sections it drew, and this
 *  attribute is how a section says where its parts go. */
export const SLOT_ATTR = "data-g-part";

/** Closed enumeration. A contract whose error case is "it throws something"
 *  is not a contract. `message` is a leak channel and never carries a path,
 *  a table name or a query. */
/** Spelled out rather than inferred, so each value carries its literal type and
 *  a HostError can be built without a cast at every call site.
 *  @type {{
 *    UNKNOWN_KIND: "unknown_kind", BAD_REQUEST: "bad_request",
 *    NOT_FOUND: "not_found", FLATNESS: "flatness", SQL_ERROR: "sql_error",
 *    FETCH_FAILED: "fetch_failed", LIMIT: "limit", TIMEOUT: "timeout",
 *    IDENTITY: "identity", INTERNAL: "internal",
 *  }} */
export const ERRORS = Object.freeze({
  UNKNOWN_KIND: "unknown_kind",
  BAD_REQUEST: "bad_request",
  NOT_FOUND: "not_found",
  FLATNESS: "flatness",
  SQL_ERROR: "sql_error",
  FETCH_FAILED: "fetch_failed",
  LIMIT: "limit",
  TIMEOUT: "timeout",
  IDENTITY: "identity",
  UNSUPPORTED: "unsupported",
  INTERNAL: "internal",
});

/** `retryable` says the call is worth attempting again, not that it should be
 *  attempted immediately — backing off is the caller's job. All three of these
 *  are transient: a limit is backpressure and clears as calls drain, a timeout
 *  is a slow answer rather than a broken one, and an upstream fetch may simply
 *  have been unlucky. Everything else is a fault in the request itself, which
 *  repeating cannot fix.
 *  @type {ReadonlySet<HostErrorCode>} */
export const RETRYABLE = new Set([ERRORS.LIMIT, ERRORS.TIMEOUT, ERRORS.FETCH_FAILED]);

/** A MessagePort has no backpressure, so the host caps in-flight calls per
 *  mount and answers `limit`. Cheap, but it has to be written down or the
 *  first artifact with a loop takes the host down. */
export const MAX_INFLIGHT = 32;

/** How long the host waits before abandoning a call, in ms. */
export const CALL_TIMEOUT = 15000;

/** The single API route. Not REST: the same envelope travels over HTTP today
 *  and postMessage tomorrow, and a URL vocabulary does not survive that move
 *  while a tagged union is already the message. */
export const API_ROUTE = "/api/call";

/** Served to the frame and inlined ahead of the artifact's own HTML. */
export const SHIM_ROUTE = "/biom.js";

/** WHERE A TAB LISTENS, and it hangs off a vault prefix rather than standing on
 *  its own: `GET /v/<url-encoded path>/events`, so an event about one folder
 *  cannot reach a tab looking at another. The separation is structural — the
 *  client settles its vault before a module is constructed and the server keys
 *  subscribers by mount — rather than a check somebody has to remember.
 *
 *  It is here for the same reason `API_ROUTE` and `SHIM_ROUTE` are: both tiers
 *  read one spelling of it, and `contracts/` is the only module both may import
 *  from. The stream itself is not a message and has no envelope — the event
 *  says *something under this vault changed* and the client answers by reading
 *  disk — so the route is the whole of what the two sides have to agree on. */
export const EVENTS_ROUTE = "/events";

/* ── which vault a request is for ───────────────────────────────────────── */

/** WHICH FOLDER, and it is an ADDRESS rather than a message — which is the whole
 *  reason it is here and not a field on `Envelope`.
 *
 *  The server holds several vaults open at once, so every request has to say
 *  which one it means. Putting it in the envelope would have contradicted the
 *  paragraph above it and cost far more than a URL: `ApiRequest` is a strict
 *  superset of `HostRequest`, so a `vault` field on the envelope is a field an
 *  ARTIFACT could set, and an artifact has no business knowing the workspace is
 *  a folder, let alone naming a different one. Prefixing the route instead
 *  leaves the tagged union exactly as it was — it still survives the move to
 *  postMessage, where the port IS the vault and the prefix simply has no
 *  counterpart to survive.
 *
 *  The path is the key. Not a hash and not a registry id: `vaults.json` caps
 *  its list, so a short id can age out from under a tab that bookmarked it,
 *  while a path resolves for as long as the folder is there. It is also legible
 *  in the address bar, which is what makes two tabs on two folders tell you so. */
export const VAULT_PREFIX = "/v/";

/** The base url every call to `path`'s vault hangs off. `makeHttp` already takes
 *  a base and concatenates, so this is the entire client-side change.
 *  @param {string} path absolute, as `VaultInfo.path` gives it
 *  @returns {string} */
export const vaultBase = (path) => VAULT_PREFIX + encodeURIComponent(path);

/** The two shapes an absolute path takes: a leading slash, or a drive letter and
 *  a separator. The second is Windows, where `path.resolve` answers
 *  `C:\Users\…` and a leading-slash test alone read every address on that
 *  machine as no vault at all. */
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/])/;

/** The vault a pathname names and what is left after it, or null when the
 *  pathname carries no vault at all — which is a legal state, not an error: the
 *  four `vault.*` kinds are about vaults rather than in one, and the picker has
 *  to be reachable before any folder has been chosen.
 *
 *  A prefix that decodes to something that is not an absolute path is treated as
 *  no vault rather than as a bad one, so a stray `/v/` in a static url cannot be
 *  mistaken for an address.
 *  @param {string} pathname
 *  @returns {{ path: string, rest: string } | null}
 */
export function vaultOf(pathname) {
  if (!pathname.startsWith(VAULT_PREFIX)) return null;
  const after = pathname.slice(VAULT_PREFIX.length);
  const cut = after.indexOf("/");
  if (cut < 0) return null;
  let path;
  try {
    path = decodeURIComponent(after.slice(0, cut));
  } catch {
    return null;
  }
  // Absolute, and no null byte — the same two things `Files` refuses, checked
  // here so a malformed address never reaches a filesystem call at all.
  //
  // ABSOLUTE MEANS TWO SHAPES, because the application is built for Windows as
  // well. A leading slash, or a drive letter and a separator: `C:\Users\…` and
  // `C:/Users/…` are both spellings Windows answers to, and `path.resolve` on
  // that machine produces the first. Without the second test every address on
  // Windows read as no vault at all, which is the picker for every deep link.
  if (!ABSOLUTE.test(path) || path.includes("\u0000")) return null;
  return { path, rest: after.slice(cut) };
}

let seq = 0;

/** Correlation id for one call. Monotonic within a realm, which is all that
 *  is needed — the port scopes it, so ids never have to be globally unique. */
export const nextId = () => `c${++seq}`;

/**
 * @param {HostErrorCode} code
 * @param {string} message never a path, a table name or a query — it crosses
 *   into artifact-land and is therefore a leak channel
 * @returns {HostError}
 */
export const fail = (code, message) => ({
  code,
  message,
  retryable: RETRYABLE.has(code),
});

/** THE DESIGN DOC'S ADDRESS, and the reason it is spelled with an `@`.
 *
 *  The design doc is a page. It has a name, variables and sections, it is read
 *  by the same reader and drawn by the same runtime — the only thing unlike a
 *  page about it is that it lives at `design/` rather than under `pages/`, so it
 *  is not in the tree and cannot be walked to.
 *
 *  It needs an id because everything the runtime can say names a page:
 *  `page.read`, `section.write`, `section.order`, `section.remove` and
 *  `variables.patch` all carry one. Given an id, the design doc is editable
 *  through machinery that already exists, and the alternative was a second set
 *  of wire kinds and a second implementation of every document operation to keep
 *  in step with the first.
 *
 *  A PAGE SEGMENT IS `^[A-Za-z0-9][A-Za-z0-9_-]*$`, so `@design` is not a legal page id
 *  and no page a person creates can collide with it. That is the whole
 *  mechanism. It also closes a hole that was open: the doc used to answer to the
 *  id `design`, which IS a legal page id, so a workspace holding a page of its
 *  own called `design` had two documents claiming one name.
 *
 *  IT IS HERE AND NOT IN `types.ts` because it is a VALUE. `types.ts` is erased
 *  at runtime and the client is plain JavaScript a browser loads directly, so a
 *  client module importing from it asks the browser for a `.ts` file and gets a
 *  MIME refusal. Both gates passed while the app would not boot. */
export const DESIGN_PAGE = "@design";

/** THE MAP'S ID, for the same reason and by the same mechanism. The rail's own
 *  Map row draws the whole workspace with the shipped `mindmap` plugin, and it
 *  needs a mount the runtime can `page.read`: this id answers a bare plugin
 *  page with no directory behind it, so no folder is ever made for it and no
 *  page a person creates can collide with it. A page that wants a map of its
 *  own says `plugin: mindmap` and is an ordinary page. */
export const MAP_PAGE = "@map";

/** AN ID FOLDED FOR COMPARISON, and the only place case is ever ignored.
 *
 *  A page id keeps the case it was given — `Companies/Airtable` is what somebody
 *  typed and it is what the URL, the folder and the mirror file all say. Two
 *  siblings that differ only in case are the one thing that cannot be allowed:
 *  on macOS or Windows they are ONE directory, so one page would silently
 *  overwrite the other on a machine that is not this one.
 *
 *  So folding exists for exactly two questions — IS THIS NAME ALREADY TAKEN,
 *  asked when a page is created and when one is moved, and DOES THIS LINK NAME A
 *  PAGE, asked when a `[[wikilink]]` is followed. It is called at those places
 *  and nowhere else. An id is never STORED folded, never compared folded
 *  anywhere else, and never lowercased on its way through: a `.toLowerCase()`
 *  down a call path is how two spellings of one id end up both half-working.
 *
 *  IT IS HERE AND NOT IN `types.ts` for the same reason `DESIGN_PAGE` is — it is
 *  a value, `types.ts` is erased at runtime, and the client is plain JavaScript
 *  a browser loads directly.
 *  @param {string} id */
export const foldId = (id) => String(id).toLowerCase();
