// SPDX-License-Identifier: AGPL-3.0-only
// Hand-written narrowing predicates. Layer 0: imports only wire.js constants.
//
// Only three things cross a trust boundary in the framework, and these guard
// exactly those. Nothing else is validated, because nothing else crosses one —
// a validation library here would be larger than the thing it validated and
// would imply the rest of the codebase is checked, which it is not.

/** @import { VarScalar, VarValue, VarPatch, RowInput, HostRequest, RuntimeRequest, GuestNotice } from "./types.ts" */

import { PROTOCOL } from "./wire.js";

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * @param {unknown} v
 * @returns {v is VarScalar}
 */
export const isScalar = (v) =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/**
 * A sidecar value is a scalar or a list of scalars. Nothing else, ever —
 * flatness is what makes one key map onto one editable region, which is what
 * makes the slot convention and its raw fallback work at all.
 * @param {unknown} v
 * @returns {v is VarValue}
 */
export const isVarValue = (v) => isScalar(v) || (Array.isArray(v) && v.every(isScalar));

/**
 * @param {unknown} v
 * @returns {v is VarPatch}
 */
export function isVarPatch(v) {
  return isObj(v) && Object.values(v).every(isVarValue);
}

/**
 * A cell is a scalar. Categories arrive as a JSON string and are widened by
 * the table layer, not here — this guard sits at the wire and knows nothing
 * about column types.
 * @param {unknown} v
 * @returns {v is RowInput}
 */
export function isRowInput(v) {
  return isObj(v) && Object.values(v).every(isScalar);
}

/** Every kind an artifact may send. The bridge switches on this and refuses
 *  anything absent, so adding a capability is one line here and one there. */
const HOST_KINDS = new Set([
  "data.get", "data.set",
  "doc.get", "doc.list",
  "children",
  "table.get", "table.schema", "table.list",
  "row.insert", "row.update", "row.remove",
  "sql", "fetch", "theme.get",
  // Not data. It asks the host to change what the person is looking at, which
  // is the only request here that does.
  "open",
  // ANOTHER PAGE'S VARIABLES — the local-first join, and the THIRD time a kind
  // has been added to HostRequest and to the bridge's switch while this set was
  // left alone. The guard refuses before the case can run, so the call is dead
  // and the only symptom is a request that never resolves. `children` did it,
  // `open` was caught by the typechecker, this one was caught by an agent
  // reading the file. Adding a capability is one line in HostRequest, one case
  // in the bridge, AND ONE LINE HERE.
  "variables",
  // The other half of `open`: what a `[[wikilink]]` names. Added here in the
  // same edit as the type and the bridge case, because the note above this line
  // is the record of what happens when it is not.
  "link.resolve",
  // ANOTHER PAGE, DRAWN. The host answers with that page's woven document and
  // TWO TRANSFERRED PORTS minted for it, so a box can draw a child page in a
  // nested iframe and relay the handshake — the nested frame's `parent` is the
  // box, not the host. Same three-place rule: HostRequest, the bridge case, and
  // this line.
  "page.embed",
  // WHICH FOLDER THIS IS — the absolute path, the name, seeded, history. It
  // takes NO argument, which is the whole of the restriction: the vault is an
  // address rather than a message, so this asks about the folder the request
  // was already addressed to and there is no field with which to name another.
  // The other four `vault.*` kinds each name a folder that is not this one and
  // stay in the outer ring. Same three-place rule as every line above it.
  "vault.info",
  // AUTOMATIONS AND RUNS — the sixth contracts edit, 2026-09-17. A page may
  // list every automation, start one, list and read every run and end one.
  // The ring is not the wall: the row's `page` is where a view permission will
  // filter when the sync engine has one, and nothing filters today. Same
  // three-place rule: HostRequest, the bridge case, and this line.
  "automation.list", "run.start", "run.list", "run.get", "run.read", "run.kill",
]);

/** THE MIDDLE RING. Everything a HostRequest may be, plus what the SECTION
 *  RUNTIME needs in order to draw a page and save an edit to it.
 *
 *  Why it exists: the runtime has to read the page and write its shape back,
 *  and a section must never be able to do either — a generated page that could
 *  call `section.order` could restructure the workspace it was asked to
 *  decorate. So the frame is handed two ports at the handshake and this set is
 *  what the privileged one accepts.
 *
 *  SAME WARNING AS ABOVE, and it now applies twice over: a kind added to
 *  `RuntimeRequest` and to the runtime's switch but NOT here is refused before
 *  the case can run, and the only symptom is a call that never resolves.
 *  Adding one is one line in `RuntimeRequest`, one case at the server, AND ONE
 *  LINE HERE. */
const RUNTIME_KINDS = new Set([
  ...HOST_KINDS,
  "page.read",
  "section.write",
  "section.order",
  "section.remove",
  "variables.patch",
  "page.projection",
]);

/**
 * True when `v` is a well-formed request an artifact is allowed to make.
 *
 * This is the chokepoint, and it is deliberately a type narrowing rather than
 * a permission check: there is no allow-list to keep in sync with a second
 * place, and no branch that can be got wrong. An artifact cannot ask to create
 * a page for the same reason it cannot ask in French.
 *
 * @param {unknown} v
 * @returns {v is HostRequest}
 */
export function isHostRequest(v) {
  return wellFormed(v, HOST_KINDS);
}

/**
 * True when `v` is a well-formed request the SECTION RUNTIME is allowed to
 * make. Strictly wider than `isHostRequest` and strictly narrower than the
 * server's own surface, which is the whole point of there being three rings.
 *
 * @param {unknown} v
 * @returns {v is RuntimeRequest}
 */
export function isRuntimeRequest(v) {
  return wellFormed(v, RUNTIME_KINDS);
}

/** The shared body. One envelope check and one payload switch for both rings,
 *  because a second copy is a second thing to forget to update — which is the
 *  exact failure the comment on HOST_KINDS is about.
 *  @param {unknown} v @param {Set<string>} allowed @returns {boolean} */
function wellFormed(v, allowed) {
  if (!isObj(v)) return false;

  const { id, g, kind } = v;
  if (typeof id !== "string" || id === "") return false;
  if (g !== PROTOCOL) return false;
  if (typeof kind !== "string" || !allowed.has(kind)) return false;

  switch (kind) {
    case "data.set":
      return isVarPatch(v.patch);
    case "link.resolve":
      return typeof v.target === "string" && v.target !== "";
    case "open": {
      // Shaped like what `children()` hands back, so `g.open(child)` needs no
      // translation — and narrowed here so the extra fields a Child carries
      // cannot smuggle anything past the chokepoint.
      const t = /** @type {{ kind?: unknown, id?: unknown } | null} */ (v.target);
      if (typeof t !== "object" || t === null) return false;
      return (t.kind === "page" || t.kind === "table") && typeof t.id === "string" && t.id !== "";
    }
    case "doc.get":
    case "page.embed":
      return typeof v.page === "string" && v.page !== "";
    case "automation.list":
      return v.page === undefined || (typeof v.page === "string" && v.page !== "");
    case "run.start":
      // The inputs are scalars by name — a form's values — and `by` is the
      // bridge's to write, so a box sending one is not refused: it is simply
      // overwritten with the truth.
      return typeof v.page === "string" && v.page !== "" &&
        typeof v.automation === "string" && v.automation !== "" &&
        (v.inputs === undefined || isRowInput(v.inputs)) &&
        (v.by === undefined || v.by === null || typeof v.by === "string");
    case "run.list":
      return (v.page === undefined || (typeof v.page === "string" && v.page !== "")) &&
        (v.automation === undefined || (typeof v.automation === "string" && v.automation !== ""));
    case "run.get":
    case "run.kill":
      return typeof v.run === "string" && v.run !== "";
    case "run.read":
      return typeof v.run === "string" && v.run !== "" &&
        (v.stream === "stdout" || v.stream === "stderr") &&
        (v.from === undefined || (typeof v.from === "number" && Number.isInteger(v.from) && v.from >= 0)) &&
        (v.max === undefined || (typeof v.max === "number" && Number.isInteger(v.max) && v.max > 0));
    case "table.get":
    case "table.schema":
      return typeof v.name === "string" && v.name !== "";
    case "row.insert":
      return typeof v.name === "string" && isRowInput(v.row);
    case "row.update":
      return typeof v.name === "string" && Number.isInteger(v.row) && isRowInput(v.patch);
    case "row.remove":
      return typeof v.name === "string" && Number.isInteger(v.row);
    case "sql":
      return typeof v.query === "string" &&
        (v.params === undefined || (Array.isArray(v.params) && v.params.every(isScalar)));
    case "fetch":
      return typeof v.url === "string" && v.url !== "";
    case "page.read":
      return typeof v.page === "string" && v.page !== "";
    case "section.write":
      return typeof v.page === "string" && v.page !== "" &&
        // Null names the page's own top-level keys, which is where an html
        // page's slots live. An empty string is still refused: that is a name
        // somebody failed to supply, not a statement that there is no section.
        (v.section === null || (typeof v.section === "string" && v.section !== "")) &&
        typeof v.part === "string" && v.part !== "" &&
        // A slot's markdown, or the whole ARRAY of it when the slot holds a
        // list. Every item is checked, because one number in a list of strings
        // reaches the writer as a value it has no case for.
        (typeof v.data === "string" ||
          (Array.isArray(v.data) && v.data.every((one) => typeof one === "string")));
    case "page.projection":
      // The markdown may be empty — a page with no words has an honest empty
      // projection, and refusing it would leave the last one on disk forever.
      return typeof v.page === "string" && v.page !== "" && typeof v.markdown === "string";
    case "section.order":
      return typeof v.page === "string" && v.page !== "" && Array.isArray(v.sections);
    case "section.remove":
      return typeof v.page === "string" && v.page !== "" &&
        typeof v.section === "string" && v.section !== "";
    case "variables.patch":
      return typeof v.page === "string" && v.page !== "" &&
        (v.section === null || (typeof v.section === "string" && v.section !== "")) &&
        isVarPatch(v.patch);
    default:
      // data.get, doc.list, table.list, theme.get — no parameters to check.
      return true;
  }
}

/**
 * guest → host, unprompted. The host cannot read a null-origin frame's DOM,
 * so anything it needs to know about an artifact arrives as one of these.
 * @param {unknown} v
 * @returns {v is GuestNotice}
 */
export function isGuestNotice(v) {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case "hello":
      return Number.isInteger(v.g);
    case "ready":
      return Number.isInteger(v.g) && Number.isInteger(v.sections);
    case "error":
      return typeof v.message === "string";
    case "unembed":
      // A box letting go of a session `page.embed` granted it. Named by the
      // token the grant carried; the host closes both ports and forgets it.
      return Number.isInteger(v.g) && typeof v.embed === "string" && v.embed !== "";
    case "position":
      // Where the box is scrolled to, in pixels, so a redraw can put it back.
      // A finite number at or above zero; the clamp to the new run is the
      // box's, because only the box can measure it.
      return Number.isInteger(v.g) && typeof v.top === "number" && Number.isFinite(v.top) && v.top >= 0;
    default:
      return false;
  }
}
