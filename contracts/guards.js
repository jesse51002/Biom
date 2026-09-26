// SPDX-License-Identifier: AGPL-3.0-only
// Hand-written narrowing predicates. Layer 0: imports only wire.js constants.
//
// Only a few things cross a trust boundary in the framework, and these guard
// exactly those: what a box may ask, what a box may say unprompted, and — since
// the eleventh contracts edit — what may be said to an agent or about a window,
// because an agent is a program allowed everything on this machine. Nothing
// else is validated, because nothing else crosses one — a validation library
// here would be larger than the thing it validated and would imply the rest of
// the codebase is checked, which it is not.

/** @import { VarScalar, VarValue, VarPatch, RowInput, HostRequest, RuntimeRequest, GuestNotice, ChatRequest, HistoryRequest, Address, WindowReport, Move, ConfigValue } from "./types.ts" */

import { AGENT_KEY, OPAQUE_ID, PROTOCOL } from "./wire.js";
import { PAGE_SCREENS, VIEW_NAMES } from "./address.js";

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

/**
 * A grid's rows: a list of lists of strings. An empty list is a grid with no
 * rows, which is what a grid holds before the first row is added — the same
 * reason an empty list slot is kept. One row that is not a list, or one cell
 * that is not a string, is refused whole.
 * @param {unknown} v
 * @returns {v is string[][]}
 */
export function isRows(v) {
  return Array.isArray(v) &&
    v.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"));
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
  // AUTOMATIONS AND RUNS — the eighth contracts edit, 2026-09-17. A page may
  // list every automation, start one, list and read every run and end one.
  // The ring is not the wall: the row's `page` is where a view permission will
  // filter when the sync engine has one, and nothing filters today. Same
  // three-place rule: HostRequest, the bridge case, and this line.
  "automation.list", "run.start", "run.list", "run.get", "run.read", "run.kill",
  // THE AGENT SCREEN'S LOOK — the eleventh contracts edit, 2026-09-25. A chat,
  // a new thread, the list of chats, the panel's size: the look may ask to be
  // SHOWN something and may never SAY anything, so not one of these carries
  // text, and no `chat.*` or `agents.*` kind is ever on this list — a test
  // holds both. The bridge answers them for the look's own box and refuses
  // every other. Same three-place rule as every line above it.
  "look.open", "look.new", "look.list", "look.panel",
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

/** THE AGENTS AND THE CHATS — outer ring, and the eleventh edit. Everything
 *  the host's input box, pickers and pop-ups say. Never on either list above,
 *  and never a box's to say: an agent does whatever it is told. */
const CHAT_KINDS = new Set([
  "agents.list", "agents.probe", "agents.registry", "agents.install", "agents.signIn",
  "chat.new", "chat.list", "chat.read", "chat.send", "chat.cancel", "chat.config",
  "chat.switchAgent", "chat.close", "chat.commands",
]);

/** WHAT EACH WINDOW HAS OPEN, AND THE HISTORY — outer ring, the same edit. */
const HISTORY_KINDS = new Set(["window.report", "window.list", "history.read"]);

/** THE KINDS THAT ANSWER ONLY THIS MACHINE'S OWN WINDOW, in every build: every
 *  agent and chat kind, and a window's report of what it has open. The server
 *  answers them only to a request carrying the capability cookie it minted for
 *  a loopback peer, with a loopback Host — `localRefusal` in `server/main.ts`.
 *  An agent answered `allow_always` does whatever it is told, so saying one of
 *  these is command execution, and the launch token alone — absent in every
 *  source run — is not enough. `history.read` and `window.list` are not here:
 *  they are reads a run may make, and they stay on the token. */
const LOCAL_KINDS = new Set([...CHAT_KINDS, "window.report"]);

/**
 * Whether a kind answers only this machine's own window. A kind nobody has
 * listed yet that starts `chat.` or `agents.` is local too, so a kind added
 * without this list still cannot reach an agent past the gate.
 * @param {unknown} kind
 */
export function isLocalKind(kind) {
  return typeof kind === "string" && (LOCAL_KINDS.has(kind) || kind.startsWith("chat.") || kind.startsWith("agents."));
}

/** Every kind the two inner rings admit, as a list nobody can change — for
 *  the test that pins what a box may never say. */
export const HOST_KIND_NAMES = Object.freeze([...HOST_KINDS]);
export const RUNTIME_KIND_NAMES = Object.freeze([...RUNTIME_KINDS]);
/** And the eleventh edit's outer-ring kinds, for the same test's other half. */
export const CHAT_KIND_NAMES = Object.freeze([...CHAT_KINDS]);
export const HISTORY_KIND_NAMES = Object.freeze([...HISTORY_KINDS]);
export const LOCAL_KIND_NAMES = Object.freeze([...LOCAL_KINDS]);

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

/**
 * True when `v` is a well-formed request to an agent or about one — the only
 * way anything reaches an agent, and it is the host's input box that says it.
 * The server narrows with this before it answers any of them.
 * @param {unknown} v
 * @returns {v is ChatRequest}
 */
export function isChatRequest(v) {
  return wellFormed(v, CHAT_KINDS);
}

/**
 * True when `v` is a well-formed report of a window's context, or a read of
 * the history or of every window's context.
 * @param {unknown} v
 * @returns {v is HistoryRequest}
 */
export function isHistoryRequest(v) {
  return wellFormed(v, HISTORY_KINDS);
}

/**
 * An id nobody typed: a window's, a chat's, a running agent's, a ticket's.
 * @param {unknown} v
 * @returns {v is string}
 */
export const isOpaqueId = (v) => typeof v === "string" && OPAQUE_ID.test(v);

/** A window's id is one of those; named for what the envelope carries. */
export const isWindowId = isOpaqueId;

/**
 * An agent's key: the registry's id, or Biom's own word for one it lacks.
 * @param {unknown} v
 * @returns {v is string}
 */
export const isAgentKey = (v) => typeof v === "string" && AGENT_KEY.test(v);

/**
 * An address as a window reports it: a view the vocabulary holds, an id, and
 * a page screen. Whether it is NORMAL is the receiver's to settle — the
 * server runs it through `address()` — because refusing a report over a
 * spelling it can correct would lose the window's place for nothing.
 * @param {unknown} v
 * @returns {v is Address}
 */
export function isAddress(v) {
  return isObj(v) &&
    typeof v.view === "string" && VIEW_NAMES.has(/** @type {Address["view"]} */ (v.view)) &&
    typeof v.id === "string" &&
    typeof v.screen === "string" && PAGE_SCREENS.has(/** @type {Address["screen"]} */ (v.screen));
}

/**
 * @param {unknown} v
 * @returns {v is WindowReport}
 */
function isWindowReport(v) {
  return isObj(v) && isAddress(v.address) && typeof v.panel === "boolean" &&
    (v.chat === null || isOpaqueId(v.chat)) &&
    (v.agent === null || isOpaqueId(v.agent));
}

/**
 * @param {unknown} v
 * @returns {v is Move}
 */
function isMove(v) {
  if (!isObj(v)) return false;
  if (v.by === "you") return true;
  return v.by === "switcher" && isOpaqueId(v.agent) && isOpaqueId(v.chat);
}

/**
 * @param {unknown} v
 * @returns {v is ConfigValue}
 */
const isConfigValue = (v) => typeof v === "string" || typeof v === "boolean";

/** Words to an agent: a string with something in it. @param {unknown} v */
const isWords = (v) => typeof v === "string" && v.trim() !== "";

/** An offset into a stream: a whole number, zero or more. @param {unknown} v */
const isSeq = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

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
  // WHICH WINDOW ASKED — the transport's to write, over whatever was there.
  // Absent is every caller from before it; malformed is refused, because a type
  // is not a parse and this one names who typed.
  if (v.window !== undefined && !isOpaqueId(v.window)) return false;

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
      return typeof v.page === "string" && v.page !== "";
    case "page.embed":
      // NEVER A RESERVED SCREEN. `@agent` is the Agent screen's look, `@map`
      // the rail's map, `@design` the design doc: each is a screen of the
      // framework's, and a page that could draw one inside itself would hold a
      // box the host treats as that screen's — the Agent screen's is fed the
      // chats. `@` is outside a page segment's grammar, so no page is refused.
      return typeof v.page === "string" && v.page !== "" && !v.page.startsWith("@");
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
      return typeof v.run === "string" && v.run !== "";
    case "run.kill":
      // `by` is the workspace's own screens' word; a box may say it and the
      // bridge drops it, the way it overwrites `by` on `run.start`.
      return typeof v.run === "string" && v.run !== "" &&
        (v.by === undefined || v.by === "page" || v.by === "screen");
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
        // list, or the whole ARRAY OF ARRAYS when it holds a grid. Every item
        // is checked, because one number in a list of strings reaches the
        // writer as a value it has no case for — and a grid is every row a list
        // and every cell a string, never a mix of rows and strings.
        (typeof v.data === "string" || isRows(v.data) ||
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
    /* ── the look (inner ring): ids and booleans, never words ─────────── */
    case "look.open":
      return isOpaqueId(v.chat);
    case "look.list":
      return typeof v.open === "boolean";
    case "look.panel":
      return typeof v.expand === "boolean";

    /* ── the agents and the chats (outer ring) ─────────────────────────── */
    case "agents.probe":
    case "agents.install":
      return isAgentKey(v.agent);
    case "agents.signIn":
      return isAgentKey(v.agent) && typeof v.method === "string" && v.method !== "" && v.method.length <= 256;
    case "chat.new":
      // A first message is optional — the start screen may make a chat before
      // anything is typed — and has something in it where it is there.
      return isAgentKey(v.agent) &&
        (v.text === undefined || isWords(v.text)) &&
        (v.page === undefined || (typeof v.page === "string" && v.page !== "")) &&
        (v.config === undefined || (isObj(v.config) && Object.values(v.config).every(isConfigValue)));
    case "chat.read":
      return isOpaqueId(v.chat) && (v.since === undefined || isSeq(v.since));
    case "chat.send":
      return isOpaqueId(v.chat) && isWords(v.text);
    case "chat.cancel":
    case "chat.close":
      return isOpaqueId(v.chat);
    case "chat.config":
      return isOpaqueId(v.chat) && typeof v.option === "string" && v.option !== "" && isConfigValue(v.value);
    case "chat.switchAgent":
      return isOpaqueId(v.chat) && isAgentKey(v.agent);
    case "chat.commands":
      return (v.chat === undefined || isOpaqueId(v.chat)) && (v.agent === undefined || isAgentKey(v.agent));

    /* ── the context and the history (outer ring) ──────────────────────── */
    case "window.report":
      // A report IS a window speaking, so the envelope has to say which one.
      return v.window !== undefined && isWindowReport(v.context) &&
        (v.moved === undefined || isMove(v.moved));
    case "history.read":
      return v.since === undefined || isSeq(v.since);

    default:
      // data.get, doc.list, table.list, theme.get, look.new, agents.list,
      // agents.registry, chat.list, window.list — no parameters to check.
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
    case "touch":
      // The person touched the page — which way, and nothing else: no place,
      // no key, no text. The eleventh edit, for the switcher.
      return Number.isInteger(v.g) && (v.what === "click" || v.what === "key" || v.what === "select" || v.what === "scroll");
    default:
      return false;
  }
}
