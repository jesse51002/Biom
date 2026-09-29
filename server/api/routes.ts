// SPDX-License-Identifier: AGPL-3.0-only
// Layer 4 — one HTTP request in, one ApiRequest and one ApiResponse out.
//
// There is ONE API route: POST /api/call, carrying the ApiRequest tagged union.
// Not REST, and the reason matters: the same envelope has to travel over HTTP
// today and postMessage tomorrow, and a URL vocabulary does not survive that
// move while a tagged union is already the message. It also collapses the client
// transport to one function with one type, and it makes `handle` testable with
// no server running at all — which is why the two halves are exported separately.
//
// This module constructs nothing. It receives Deps and may not import
// server/platform/: it has never seen a filesystem path, a SQL string or a
// database handle, and the only thing above it that has is main.ts.

import type { ApiRequest } from "../../contracts/types.ts";
import type { ApiResponse } from "../../contracts/types.ts";
import type { Envelope } from "../../contracts/types.ts";
import type { HostError } from "../../contracts/types.ts";
import type { HostErrorCode } from "../../contracts/types.ts";
import type { Design } from "../../contracts/types.ts";
import type { Docs } from "../../contracts/types.ts";
import type { HostFetchResult } from "../../contracts/types.ts";
import type { PageId } from "../../contracts/types.ts";
import type { PageRef } from "../../contracts/types.ts";
import type { Pages } from "../../contracts/types.ts";
import type { RunRow } from "../../contracts/types.ts";
import type { Presets } from "../../contracts/types.ts";
import type { Runs } from "../../contracts/types.ts";
import type { Tables } from "../../contracts/types.ts";
import type { Vault } from "../../contracts/types.ts";
import type { WindowId } from "../../contracts/types.ts";
import type { Writer } from "../../contracts/types.ts";
import type { ThemeStore } from "../workspace/presets.ts";
import type { Mirror } from "../domain/mirror.ts";
import type { Sharer } from "../domain/share.ts";
import type { EditReport, History } from "../domain/history.ts";
import type { Agents } from "../workspace/agents.ts";
import type { Chats } from "../workspace/chats.ts";
import type { Settings } from "../workspace/settings.ts";
import type { PageIndex } from "../domain/pageindex.ts";
import type { PageOnScreen } from "../domain/pagenote.ts";
import { PAGE_DOC, pageDir } from "../domain/pages.ts";
import { AUTOMATIONS_DIR, MANIFEST } from "../domain/runs.ts";

/** THE MIRROR NEVER FAILS A WRITE, AND NEVER FAILS A REDRAW. It is derived: the
 *  page is already saved when this runs, and the next draw of that page rewrites
 *  its file anyway. So a failure is logged where somebody running the server sees
 *  it and swallowed everywhere else — an editor that refused a keystroke because
 *  a projection could not be written would be trading the thing for its shadow,
 *  and so would a page that refused to redraw.
 *
 *  Exported because the composition root refreshes the mirror on the watcher's
 *  path and has to do it under exactly this policy. It is one statement and it
 *  lives here, with the other calls it governs. */
export const mirrored = (what: Promise<unknown>): Promise<void> =>
  what.then(() => {}, (e: unknown) => { console.warn("the markdown mirror", e); });
import { PROTOCOL } from "../../contracts/wire.js";
import { fail } from "../../contracts/wire.js";
import { DESIGN_PAGE } from "../../contracts/wire.js";
import { LOCATE_MAX, SEARCH_MAX, foldId } from "../../contracts/wire.js";
import { isChatRequest, isHistoryRequest, isPageRequest, isWindowId } from "../../contracts/guards.js";

// Undo is deliberately absent from this file. The vault is a git repo and the
// server commits ahead of every write, but that belongs to the layer that knows
// what it is about to write: pages.ts commits before a file write and before a
// removal, docs.ts commits before a hand edit and deliberately not before a
// slot losing focus. Adding a commit here would put the same policy in two
// layers, and the one further from the disk would be the one that got it wrong.
export interface Deps {
  pages: Pages;
  /** The design doc — one page at `design/` in the vault root, beside `pages/`
   *  rather than inside it. Its own dependency for the same reason it has its
   *  own wire kinds: it is not addressed by a `PageId` and `Pages` is rooted
   *  somewhere else. */
  design: Design;
  /** THE DOCUMENT A PAGE IS. It was `sidecars`, and the rename is the change:
   *  there is nothing beside the file any more, because `content.yaml` carries
   *  the page's prose as well as its shape. */
  docs: Docs;
  tables: Tables;
  /** CONSTRUCTED AND NOT CALLED FROM HERE. Seeding happens in the composition
   *  root on mount, and the two other members are dead on the wire — see the
   *  note on `Presets` in `contracts/types.ts`. */
  presets: Presets;
  theme: ThemeStore;
  /** THE MARKDOWN MIRROR. It is touched from this layer and not from `pages.ts`
   *  for the reason `restack` is: the mirror READS a page through `Pages`, so a
   *  page write cannot call it without a cycle, and this is the lowest layer
   *  holding both. Every mutation below ASKS its queue to re-project the page
   *  it changed and answers without waiting: the projection lands within a
   *  moment, in the background, and rides the next commit. Nothing a request
   *  answers waits on the mirror. */
  mirror: Mirror;
  /** SHARE A PAGE — the stop-gap. Built by the composition root against the
   *  folder, because the rewrite reads the folder's own assets. Answered in
   *  every build: the compiled application captures in its own window and
   *  hands the document over, and a development server can draw the page in
   *  a browser of its own when nothing was handed over. */
  share: Sharer;
  /** WHICH BUILD THIS IS, and it is here rather than in `contracts/` on purpose.
   *  The kinds still exist: `ApiRequest` goes on spelling `sql`, `fetch` and
   *  `vault.browse`, the guards go on admitting them, and one server answers
   *  where another refuses. A type narrowed by environment would be a type that
   *  means two different things.
   *
   *  Optional, and absent means development — which is what keeps every existing
   *  caller, this layer's own tests included, saying exactly what it said before.
   *  `server/main.ts` sets it the way it sets every other member here. */
  production?: boolean;
  /** WHICH FOLDER this workspace is, and how to make it a different one.
   *  Implemented by the composition root and by nothing else: opening a vault
   *  rebuilds every module beside this one, and this layer constructs nothing.
   *
   *  Note what the other five have in common and this one does not — they are
   *  built AGAINST a vault, and this one outlives every swap. It is the only
   *  member of Deps that is the same object from one request to the next. */
  vault: Vault;
  /** AUTOMATIONS AND RUNS: the folder reader, the registry, the run directory,
   *  the logs served and never read. Built against a vault like `pages`. */
  runs: Runs;
  /** HOW MANY RUNS ARE ALIVE ACROSS EVERY MOUNTED FOLDER — the shell's one
   *  question before it closes a window. Answered on the unprefixed route as
   *  well, because it is about runs rather than in a vault; like `vault` it is
   *  the root's and outlives every swap. */
  live: () => number;
  /** THE NAMES IN THE SERVER'S ENVIRONMENT, and nothing else about them, for
   *  the manifest form's picker. The root reads the environment; this layer
   *  never does, and no value ever reaches the wire. */
  envNames: () => string[];
  /** THE HISTORY — what each window has open, what changed and who changed
   *  it. Built against a vault like `pages`. Every write a WINDOW makes through
   *  this route is one edit in it, stamped `you` by `app`: see `handle`.
   *  Optional, and absent records nothing — every caller from before it. */
  history?: History;
  /** WHAT AGENTS THIS MACHINE HAS, as this workspace sees them — found,
   *  probed, installed and signed in. Built against a vault, because a probe
   *  runs in its folder. Optional, and absent answers every `agents.*` kind
   *  `unsupported`: every caller from before the chats. */
  agents?: Agents;
  /** THE CHATS: one agent process per chat, and Biom's own copy of each
   *  stream. Built against a vault like `pages`. Optional for the reason
   *  `agents` is. */
  chats?: Chats;
  /** THE CHAT'S KEPT CHOICES — `.biom/settings.json`. Optional, and absent
   *  answers `settings.*` `unsupported`: every caller from before them. */
  settings?: Settings;
  /** THE PAGE ON SCREEN IN A WINDOW, which a message that window sends
   *  carries to its agent: read off the window's context the moment it is
   *  asked — so a report that lands after the message cannot change it — and
   *  then named from the page's head. Null where no page is on screen.
   *  Optional, and absent no message carries one: every caller from before
   *  it. */
  onScreen?: (window: WindowId | undefined) => Promise<PageOnScreen | null>;
  /** THE INDEX OF PAGE HEADS — what a window asks about pages it has not
   *  loaded: by id or identity (`page.locate`), by name (`page.search`), and
   *  what a `[[wikilink]]` names. Built against a vault like `pages`, and told
   *  here of every page the app moves or renames, so the page is found at its
   *  new id without a sweep. Optional, and absent answers the three
   *  `unsupported`: every caller from before it. */
  index?: Pick<PageIndex, "locate" | "search" | "resolveLink" | "moved" | "invalidate">;
}

/** The closed enumeration, as a set, so a `code` thrown by a lower layer can be
 *  believed only when it is one of ours. */
const CODES = new Set<string>([
  "unknown_kind", "bad_request", "not_found", "flatness",
  "sql_error", "fetch_failed", "limit", "timeout", "identity", "unsupported", "internal",
]);

const ok = (id: string, value: unknown): ApiResponse => ({ id, g: PROTOCOL, ok: true, value });

/** WHAT A BUILD THAT DOES NOT OFFER A KIND SAYS BACK.
 *
 *  IT SPENDS ITS OWN WORD NOW. This used to answer `not_found`, which was the
 *  least wrong member of a closed enumeration that had no right one: the kind
 *  is known, so `unknown_kind` was a lie; the request was correct, so
 *  `bad_request` blamed the caller; and the retryable codes would have had an
 *  artifact backing off and asking forever. `unsupported` joined
 *  `HostErrorCode` at the barrier and says the thing itself — the kind exists,
 *  this build does not offer it, and asking again will not change that. The
 *  SENTENCE is still what a page author actually reads, so it goes on saying
 *  plainly that the build refuses them rather than that they got it wrong. */
const refused = (id: string, what: string): ApiResponse =>
  err(id, "unsupported", `this build does not offer ${what}`);

/** WHETHER THE NATIVE DIRECTORY DIALOG IS BUILT. It is, so this is true, and
 *  the refusal below is live.
 *
 *  `vault.browse` is the server walking its own filesystem for the picker's
 *  Browse group, and Browse WAS the only way to reach a workspace that is on
 *  disk and not in `Recent` — so refusing it before there was another way would
 *  have left a built application that could not reach a folder at all. The other
 *  way is `app/preload.js`: the shell injects one function, the operating
 *  system's folder dialog, and the picker uses it for Open as well as for
 *  Create's parent. This constant is what released the held refusal.
 *
 *  DEVELOPMENT STILL ANSWERS IT, because `make dev` is a browser
 *  and a browser has no dialog. It has a twin in `client/views/vault.js`, which
 *  hides the group, and the two cannot be one: `contracts/` is the only file
 *  both could import from and it is frozen. A test holds the two literals
 *  equal. */
const NATIVE_DIALOG = true;

// `fail` lives in wire.js, which is JavaScript and so cannot type its own return
// as the closed enum. One cast, here, rather than a second copy of the retryable
// table in TypeScript.
const err = (id: string, code: HostErrorCode, message: string): ApiResponse => ({
  id,
  g: PROTOCOL,
  ok: false,
  error: fail(code, message) as HostError,
});

/** A lower layer's error is trusted only for its code, never for its message:
 *  `message` is a leak channel and never carries a path, a table name or a
 *  query, so every string a caller sees is written here. */
function codeOf(e: unknown, fallback: HostErrorCode): HostErrorCode {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === "string" && CODES.has(c) ? (c as HostErrorCode) : fallback;
}

/**
 * Resolve one ApiRequest. Never throws: every failure comes back as an
 * `ok: false` carrying a code from the closed enumeration, because a contract
 * whose error case is "it throws something" is not a contract.
 *
 * AND A WRITE A WINDOW MADE IS ONE EDIT IN THE HISTORY, recorded HERE and
 * nowhere below. The envelope's `window` — the transport's to write, over
 * whatever a request carried — is the one fact that says a person's window
 * made it, and this is the one layer holding both that and what the request
 * named: one request is one edit, however many files the domain touched to
 * carry it out — a page moved is every file under it copied, and that is
 * still one thing somebody did. So the writer is stamped here, on the way
 * out, once the answer is `ok`, and never threaded through `Files`: the
 * domain's interfaces are the frozen contract's, and a write counted file by
 * file would be counted wrong. A request with no `window` — a test, a tool, a
 * run's script over the API — is nobody's and records nothing. The history is
 * awaited, so a window that has its answer has its edit in the history too; a
 * history that fails is logged and never fails the write, which has already
 * happened.
 */
export async function handle(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  const res = await answer(req, deps);
  if (res.ok && deps.history !== undefined) await recorded(req, res.value, deps.history);
  return res;
}

/** What `writeOf` answers: `EditReport` less who wrote it and how. */
export type Written = Omit<EditReport, "via" | "writer">;

/**
 * WHAT A WRITE CHANGED, as the history is told it: the file the request
 * wrote, vault-relative — the format's vocabulary rather than the
 * filesystem's — or, for a table's schema or rows, no file and the table's
 * place. The page itself — made, moved, renamed, removed — is its directory.
 * A keystroke's save is a `burst`, which the history coalesces into one edit
 * per bout of typing: a slot, a variable, a table's rows, and the editors'
 * quiet saves. Nothing else is, so a page made and then removed is two edits.
 * Read off the request and, where the request cannot say, off the answer: the
 * id a made, moved or renamed page has now, the folder a new automation was
 * given. The screen each path is shown on is the history's address table,
 * not this.
 *
 * Null for every kind that is not a write, and for the ones that are nobody's
 * change or cannot be named:
 *   - `page.projection` and `vault.commit` are the framework writing for
 *     itself — the markdown mirror, the editors' one commit;
 *   - `sql` is a query nothing here reads for what it writes, and a write Biom
 *     cannot name is left out rather than guessed at;
 *   - `run.start` and `run.kill`: a run writes its own files, and runs wait for
 *     the door;
 *   - `theme.set`: no screen shows the theme and none writes it, and naming it
 *     would take a file name this layer has never been handed.
 * Exported so its table is tested on its own.
 */
export function writeOf(req: ApiRequest, value: unknown): Written | null {
  const page = (id: PageId, file?: string, burst = false): Written =>
    ({ path: file === undefined ? pageDir(id) : `${pageDir(id)}/${file}`, ...(burst ? { burst } : {}) });
  const table = (name: string, burst = false): Written => ({ path: null, place: { view: "table", id: name }, ...(burst ? { burst } : {}) });
  switch (req.kind) {
    case "section.write":
    case "variables.patch":
      return page(req.page, PAGE_DOC, true);
    case "section.order":
    case "section.remove":
    case "doc.writeRaw":
      return page(req.page, PAGE_DOC);
    case "page.writeFile":
      return page(req.page, req.file, req.quiet === true);
    case "page.remove":
      return page(req.page);
    case "page.create":
      return typeof value === "object" && value !== null && typeof (value as PageRef).id === "string" ? page((value as PageRef).id) : null;
    case "page.move":
    case "page.rename":
      return typeof value === "string" ? page(value) : null;
    case "design.patch":
      return page(DESIGN_PAGE, PAGE_DOC);
    case "design.writeFile":
      return page(DESIGN_PAGE, req.file);
    case "automation.set":
      return page(req.page, `${AUTOMATIONS_DIR}/${req.automation}/${MANIFEST}`, req.quiet === true);
    case "automation.create": {
      const folder = typeof value === "object" && value !== null ? (value as { folder?: unknown }).folder : undefined;
      return typeof folder === "string" ? page(req.page, `${AUTOMATIONS_DIR}/${folder}`) : null;
    }
    case "vault.writeFile":
      return { path: req.file, ...(req.quiet === true ? { burst: true } : {}) };
    // A TABLE'S ROWS ARE A BURST, all three: the history says the table changed
    // and not how, so two such lines a moment apart say nothing one does not —
    // and a page's code adding rows in a loop would otherwise be a line a row.
    case "row.insert":
    case "row.update":
    case "row.remove":
      return table(req.name, true);
    case "table.remove":
    case "table.setParent":
    case "table.importCsv":
      return table(req.name);
    case "table.create":
    case "table.alter":
      // The name the table has NOW: an alter may rename it.
      return table(req.schema.name);
    default:
      return null;
  }
}

/** One edit for one write, stamped with the window that made it. */
async function recorded(req: ApiRequest, value: unknown, history: History): Promise<void> {
  // Checked by `answer` already: absent, or a window id.
  const window = (req as Envelope).window;
  if (window === undefined) return;
  let write: Written | null;
  try {
    write = writeOf(req, value);
  } catch (e) {
    console.warn("the history could not name a write", String(req.kind), e);
    return;
  }
  if (write === null) return;
  const writer: Writer = { kind: "you", window };
  try {
    await history.edit({ ...write, via: "app", writer });
  } catch (e) {
    console.warn("the history", e);
  }
}

/** The answer itself: the envelope, then one case per kind. */
async function answer(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  // The envelope is checked at runtime even though the parameter is typed: this
  // is where JSON off the wire arrives, and a type is not a parse. `null` and a
  // bare string are both valid JSON and both arrive here.
  const shape = typeof req === "object" && req !== null ? req : {};
  const env = shape as Partial<Envelope> & { kind?: unknown };
  const id = typeof env.id === "string" && env.id !== "" ? env.id : "";
  if (id === "") return err("", "bad_request", "the envelope carries no correlation id");
  if (env.g !== PROTOCOL) return err(id, "bad_request", "unknown protocol major");
  if (typeof env.kind !== "string") return err(id, "bad_request", "the envelope names no kind");
  // WHICH WINDOW ASKED. Absent is every caller from before it, and a write
  // nobody in a window made; malformed is refused, as every guard refuses it,
  // because this is the field the history stamps a person's writes with.
  if (env.window !== undefined && !isWindowId(env.window)) return err(id, "bad_request", "the envelope names a window that is not one");

  try {
    switch (req.kind) {
      /* ── what an artifact may say ────────────────────────────────────── */

      // data.get and data.set are scoped to the page an artifact is mounted on,
      // and a mount is a client-side fact: the bridge holds the context and
      // resolves both against the workspace store. Nothing addresses them here,
      // because an HTTP request carries no mount and the server must never guess
      // which page — or which SECTION — a variables patch was meant for.
      case "data.get":
      case "data.set":
        return err(id, "bad_request", "scoped to a mount, and a mount is not addressable over this route");

      case "doc.get": {
        const page = await deps.pages.read(req.page);
        if (page === null) return err(id, "not_found", "no such page");
        // A doc read by a plugin is the page's prose: every markdown slot, in
        // section order and then in the order the section's own html declares
        // its slots. A page drawn by its own document has no sections, and its
        // words are the page-level `input` slots the box fills into its
        // `data-g-part`s — a string, or a list of strings — so those come first,
        // in the order the page wrote them: the H1 a runs bar names a slide by
        // is as often there as in a section. A page with no prose in either
        // honestly returns none.
        const own = Object.values(page.input)
          .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) && v.every((one) => typeof one === "string") ? v : []));
        const md = own
          .concat(
            page.sections
              .flatMap((s) => Object.values(s.parts))
              .filter((p): p is Extract<typeof p, { kind: "markdown" }> => p.kind === "markdown")
              .map((p) => p.md),
          )
          .join("\n\n");
        return ok(id, md);
      }

      case "doc.list":
      case "page.list":
        return ok(id, await deps.pages.list());

      // Layer one: what a page holds, pages and tables alike, normalised. An
      // artifact may ask this — it is how a page draws its own children its own
      // way — and an artifact omits `page`, meaning the page it is mounted on.
      // A mount is a client-side fact, so the bridge fills that in against its
      // BridgeContext and this route refuses the unaddressed form for exactly
      // the reason `data.get` above does: an HTTP request carries no mount and
      // the server must never guess which page was meant.
      case "children": {
        if (typeof req.page !== "string" || req.page === "") {
          return err(id, "bad_request", "scoped to a mount, and a mount is not addressable over this route");
        }
        return ok(id, await deps.pages.children(req.page));
      }

      case "children.all":
        return ok(id, await deps.pages.childrenAll());

      /* ── pages the window has not loaded ─────────────────────────────── */

      // ANSWERED FROM THE INDEX OF PAGE HEADS, never from a list of every page:
      // a window over a two-thousand-page workspace holds the levels it has
      // open and asks for anything else by id, by identity or by name. The
      // guard narrows both first, so its bounds are the only ones.
      case "page.locate":
      case "page.search": {
        if (!isPageRequest(req)) {
          return err(id, "bad_request", (req as { kind: string }).kind === "page.locate"
            ? `a locate names ids or uids, and at most ${LOCATE_MAX} of each`
            : `a search is a few words, and asks for at most ${SEARCH_MAX} pages`);
        }
        const index = deps.index;
        if (index === undefined) return refused(id, "finding a page by its id, identity or name");
        if (req.kind === "page.locate") return ok(id, await index.locate({ ids: req.ids, uids: req.uids }));
        return ok(id, await index.search(req.query, req.limit ?? SEARCH_MAX));
      }

      // WHAT A `[[wikilink]]` NAMES, asked by a box through the window, which
      // no longer holds every page to answer it from. A page first — the
      // design doc, the id exactly, folded, by its tail, by its name, each
      // only where it is unambiguous — and then a table, by its name exactly
      // and then folded. Null where nothing is named, which is a dead link
      // and not an error.
      case "link.resolve": {
        if (typeof req.target !== "string" || req.target === "") return err(id, "bad_request", "a link names a page or a table");
        const index = deps.index;
        if (index === undefined) return refused(id, "following a link");
        const page = await index.resolveLink(req.target);
        if (page !== null) return ok(id, page);
        const want = req.target.trim().replace(/^\/+|\/+$/g, "");
        if (want === "") return ok(id, null);
        const tables = deps.tables.list();
        const only = (test: (name: string) => boolean): { kind: "table"; id: string } | null => {
          const hits = tables.filter((t) => test(t.name));
          return hits.length === 1 ? { kind: "table", id: hits[0]!.name } : null;
        };
        return ok(id, only((name) => name === want) ?? only((name) => foldId(name) === foldId(want)));
      }

      // ANOTHER PAGE'S VARIABLES — the local-first join. A page can read what
      // another page knows and draw something richer than a table with it, and
      // reaching across a page boundary is a CALL rather than a template so that
      // `{{name}}` stays inside one page and a dependency on a page somebody may
      // rename fails visibly instead of leaving a blank in a paragraph.
      //
      // IT HAD NO CASE HERE AT ALL until this rewrite, and that is the FOURTH
      // time this seam has bitten: the kind was in `HostRequest`, in HOST_KINDS
      // and forwarded by the bridge, and fell through to `unknown_kind` — so the
      // join has never once worked and nothing said why. Adding a capability is
      // one line in `HostRequest`, one in the guard's set, one case in the
      // bridge AND ONE CASE HERE.
      //
      // Unaddressed it is refused for the same reason `children` is: an artifact
      // omits `page` meaning the one it is mounted on, a mount is a client-side
      // fact, and the server must never guess which page was meant.
      case "variables": {
        if (typeof req.page !== "string" || req.page === "") {
          return err(id, "bad_request", "scoped to a mount, and a mount is not addressable over this route");
        }
        try {
          const doc = await deps.docs.read(req.page);
          return ok(id, doc.variables);
        } catch (e) {
          console.error("variables", e);
          return err(id, codeOf(e, "not_found"), "no such page");
        }
      }

      case "table.get":
        return ok(id, deps.tables.rows(req.name, req.query));

      case "table.schema": {
        const schema = deps.tables.schema(req.name);
        if (schema === null) return err(id, "not_found", "no such table");
        return ok(id, schema);
      }

      case "table.list":
        return ok(id, deps.tables.list());

      case "row.insert":
        return ok(id, deps.tables.insert(req.name, req.row));

      case "row.update":
        deps.tables.update(req.name, req.row, req.patch);
        return ok(id, null);

      case "row.remove":
        deps.tables.remove(req.name, req.row);
        return ok(id, null);

      case "sql":
        // A page that calls `biom.sql` works in development and stops working in
        // the built application, and that is the one place this build DOES less
        // rather than merely showing less. `Architecture/Egress` is what this
        // stands in for — a declared, approved, recorded grant per artifact —
        // and none of it is built; a flat refusal is the floor under a mechanism
        // that is specified and absent, not the design.
        if (deps.production) return refused(id, "SQL from a page");
        try {
          return ok(id, deps.tables.sql(req.query, req.params));
        } catch (e) {
          console.error("sql", e);
          return err(id, codeOf(e, "sql_error"), "the query did not run");
        }

      case "fetch":
        // The other half of the same sentence. Refusing both costs the shipped
        // screens nothing: the workspace's own chrome is client zero of the
        // artifact contract and issues `table.get` and `row.insert`, never
        // either of these.
        if (deps.production) return refused(id, "calling out to the internet from a page");
        return await proxy(id, req.url, req.init);

      case "theme.get":
        return ok(id, await deps.theme.get());

      /* ── what only the workspace UI may say ──────────────────────────── */

      case "page.read": {
        const page = await deps.pages.read(req.page);
        if (page === null) return err(id, "not_found", "no such page");
        return ok(id, page);
      }

      case "page.share":
        return ok(id, await deps.share.share(req.page, req.html));
      case "page.create": {
        const made = await deps.pages.create(req.init);
        deps.mirror.queue.follow(made.id, true);
        return ok(id, made);
      }

      case "page.remove":
        await deps.pages.remove(req.page);
        // THE INDEX LETS GO OF IT NOW, and everything under it: the watcher's
        // settle would otherwise find the rows' folder gone and take the app's
        // own remove for a page deleted from outside.
        await forgotten(deps, req.page);
        // The page is gone, so its projection is a file about nothing. The
        // parent is re-projected because it lists its children and has just lost
        // one.
        deps.mirror.queue.drop(req.page);
        deps.mirror.queue.follow(req.page, true);
        return ok(id, null);

      case "page.rename":
        // A RENAME IS A MOVE: the last segment of an id is spelled from the
        // name, so the directory follows it and the answer is the NEW id. So
        // everything `page.move` does for the ids beneath a page is done here
        // too — the tables re-pointed, the mirror carried — and the one parent
        // is re-projected because it lists its children by name.
        try {
          const to = await deps.pages.rename(req.page, req.name);
          if (to !== req.page) restack(deps, req.page, to);
          if (to !== req.page) relocated(deps, req.page, to);
          if (to !== req.page) indexed(deps, req.page, to);
          if (to !== req.page) deps.mirror.queue.rename(req.page, to);
          deps.mirror.queue.follow(to, true);
          return ok(id, to);
        } catch (e) {
          console.error("page.rename", e);
          const code = codeOf(e, "internal");
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "no such page"
              : said !== "" ? said
              : "that page could not be renamed",
          );
        }

      case "page.writeFile":
        // The agent seam. Claude Code writes into the vault directly today and
        // this route exists for the day it does not; the markdown editor and the
        // raw-YAML fallback are its first consumers, so it is exercised by the
        // UI before an agent is ever built.
        await deps.pages.writeFile(req.page, req.file, req.text, req.quiet === true);
        return ok(id, null);

      // A section is its entry in `contents` — which carries its own variables
      // and its slots — plus its own html file and the file of every `html` slot
      // in it. So it is one kind and the server does all of it or none. Two
      // requests would leave the failure modes half-done and put two commits in
      // the vault for one thing the user did.
      //
      // THE MIDDLE RING, and checked rather than assumed: `section.remove` is in
      // `RuntimeRequest` and not in `HostRequest`, so `isHostRequest` refuses it
      // and a section cannot restructure the page it is drawn on — only the
      // runtime that draws the page can.
      case "section.remove":
        try {
          const left = await deps.pages.removeSection(req.page, req.section);
          deps.mirror.queue.follow(req.page);
          return ok(id, left);
        } catch (e) {
          console.error("section.remove", e);
          const code = codeOf(e, "internal");
          // The domain's own sentence, when it has one — the refusals here are
          // written FOR A PERSON and carry no path or id, and the one that
          // matters says what DOES remove a child. Flattened to "that could not
          // be removed" it reads as the button being broken.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "no such page"
              : said !== "" ? said
              : "that section could not be removed",
          );
        }

      // WRITING A PARAGRAPH BACK, which is the exit condition of the whole
      // framework and the one thing the format change nearly took with it: the
      // prose used to live in `<id>.md` and go back through `page.writeFile`,
      // and once it moved inside the document nothing on the wire could put a
      // typed paragraph on disk.
      //
      // ONE SLOT'S TEXT AND NOTHING ELSE, which is why it names a page, a
      // section AND a part. It fires on a debounce while somebody is typing, so
      // a kind that carried the whole document would make every keystroke a
      // chance to overwrite a change that arrived in between.
      //
      // THE MIDDLE RING: it is in `RuntimeRequest` and not in `HostRequest`, so
      // `isHostRequest` refuses it. The runtime owns editing the page it drew; a
      // section drawn on that page must not be able to rewrite its neighbours.
      case "section.write":
        try {
          await deps.pages.writeSlot(req.page, req.section, req.part, req.data);
          deps.mirror.queue.follow(req.page);
          return ok(id, null);
        } catch (e) {
          console.error("section.write", e);
          // The domain's own sentence, which is the only one that can tell "no
          // such page" from "no such section" from "no such slot" — and all
          // three are written for a person and carry no path or id.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            codeOf(e, "internal"),
            said !== "" ? said : "that text could not be written",
          );
        }

      // THE PAGE'S OWN MARKDOWN, reported by whatever drew it, on its way to
      // `_markdown/`. This is the only write on this route whose CONTENT the
      // server did not compute: the box runs the page's code, so the box is the
      // only half that knows what a board or a hand-written document says in
      // words, and it cannot write a file.
      //
      // THE MIDDLE RING, and that matters here: a section drawn on a page must
      // not be able to rewrite the archive copy of the page it sits on. The
      // runtime that drew the whole page is what may speak for it.
      case "page.projection":
        try {
          // IN ITS TURN ON THE MIRROR'S QUEUE, after the projections already
          // asked for this page: one of them under way when these words
          // arrived would otherwise land after them, and a page only its box
          // can project would be left with the host's empty file.
          await deps.mirror.queue.write(req.page, req.markdown);
          return ok(id, null);
        } catch (e) {
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          // A SENTENCE AND NOT A STACK, which is the one arm on this route where
          // the difference is visible in ordinary use. `@design` and `@map` are
          // pages the framework itself mounts and neither is mirrored — a page
          // id with an `@` in it cannot be a path segment — so the runtime
          // projects, `mirror.write` refuses by name, and this printed a full
          // stack trace every single time anybody opened the design doc or the
          // map. A frame on stderr is supposed to mean something threw where a
          // refusal was meant to be a sentence; printing one for a refusal is
          // what makes that signal unreadable. The code and the sentence are
          // still said here, and the box logs its own.
          console.warn("page.projection", codeOf(e, "internal"), said !== "" ? said : "that projection could not be stored");
          return err(id, codeOf(e, "internal"), said !== "" ? said : "that projection could not be stored");
        }

      // THE ORDER, AND WHAT IS IN IT. Adding, reordering, duplicating and
      // removing are one kind because they are one edit to one list — `contents`
      // IS the order, so there is no second place for a name to be in a
      // different position and no way for the two to disagree. Entries are
      // matched by name.
      case "section.order":
        try {
          const now = await deps.pages.setSections(req.page, req.sections);
          deps.mirror.queue.follow(req.page);
          return ok(id, now);
        } catch (e) {
          console.error("section.order", e);
          // The domain's own sentence, which is written for a person and carries
          // no path or id — and the one that matters says what a child key is
          // and why it is not the caller's to place.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            codeOf(e, "internal"),
            said !== "" ? said : "that page could not be reordered",
          );
        }

      // MOVE A PAGE, WHICH IS NOW MOVING A DIRECTORY, and the answer is the NEW
      // id. There is no `parent:` to patch: the folder is the hierarchy, so the
      // page's id becomes `<parent>/<its own segment>` and every id beneath it
      // changes with it.
      //
      // NOTHING FORWARDS. A caller holding the old id gets `not_found` on its
      // next read rather than somebody else's page, which is a visible failure
      // instead of a quiet substitution — so the client re-routes on what comes
      // back here.
      case "page.move":
        try {
          const to = await deps.pages.move(req.page, req.parent);
          // A TABLE PARENTED UNDER THE PAGE THAT MOVED WOULD GO STALE. A table
          // has no directory, so its parent is registry state rather than a
          // fact the filesystem restates — the move renames the pages and the
          // registry goes on naming an id that no longer exists, and the table
          // disappears from the tree while still claiming a parent.
          //
          // It is fixed HERE and it belongs here: pages.ts and tables.ts are
          // siblings and there is no sideways, so this layer is the lowest one
          // holding both. Every table under the moved subtree is re-pointed at
          // the same position under the new id, in the same request, so the
          // move is one thing that happened rather than two.
          if (to !== req.page) restack(deps, req.page, to);
          // AND THE RUNS UNDER IT, by the same prefix rule and for the same
          // reason: a run's row names its page, a page's id is where it sits,
          // and the registry is not told by the filesystem.
          if (to !== req.page) relocated(deps, req.page, to);
          // AND THE INDEX'S ROWS, which are keyed by folder.
          if (to !== req.page) indexed(deps, req.page, to);
          // The old path names nothing now and the new one names a page nobody
          // has drawn yet, so both halves are done here rather than waiting for
          // somebody to open it. The mirror is CARRIED rather than dropped and
          // re-projected: a file in it is named by its id, and every id under
          // the page that moved has just changed — dropping the old path and
          // projecting only the new one deletes the whole subtree's markdown.
          // Both parents are re-projected too, because a parent lists its
          // children and one has just left while another arrived.
          if (to !== req.page) deps.mirror.queue.rename(req.page, to);
          deps.mirror.queue.follow(req.page, true);
          deps.mirror.queue.follow(to, true);
          return ok(id, to);
        } catch (e) {
          console.error("page.move", e);
          const code = codeOf(e, "internal");
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "no such page"
              : said !== "" ? said
              : "that page could not be moved",
          );
        }

      case "doc.raw":
        return ok(id, await deps.docs.readRaw(req.page));

      case "variables.patch":
        // The addressed merge. `data.set` above refuses precisely because it
        // carries no page and this route has no mount to resolve one from; this
        // kind supplies both halves explicitly — the page, and WHICH SCOPE on it
        // — so the merge happens server-side against the file on disk rather
        // than as a lossy client-side read-modify-write two writers can
        // interleave.
        //
        // `section` null is the page's own variables; a name is that section's,
        // which is where a slot writes. The nearest one wins when a template is
        // resolved, so landing a slot write one scope out would quietly change
        // what every other section on the page says.
        try {
          const merged = await deps.docs.merge(req.page, req.section, req.patch);
          deps.mirror.queue.follow(req.page);
          return ok(id, merged);
        } catch (e) {
          console.error("variables.patch", e);
          return err(id, codeOf(e, "flatness"), "a variable is a scalar or a list of scalars");
        }

      case "doc.writeRaw":
        // The ugly, always-available fallback, and it MATTERS MORE THAN IT DID:
        // the prose lives in this file now, so one bad character takes the
        // page's words with its shape and this is the only way back to them.
        try {
          const doc = await deps.docs.writeRaw(req.page, req.text);
          deps.mirror.queue.follow(req.page);
          return ok(id, doc);
        } catch (e) {
          console.error("doc.writeRaw", e);
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            codeOf(e, "flatness"),
            // The parser's own sentence, which carries the line — that is the
            // difference between a fallback somebody can repair a file with and
            // one that says "something broke". It names no path: yaml.ts writes
            // these for a person and about the document alone.
            said !== "" ? said : "that is not a page document",
          );
        }

      case "table.create":
        deps.tables.create(req.schema);
        return ok(id, null);

      case "table.alter":
        deps.tables.alter(req.name, req.schema);
        return ok(id, null);

      case "table.setParent":
        deps.tables.setParent(req.name, req.parent);
        return ok(id, null);

      case "table.remove":
        deps.tables.drop(req.name);
        return ok(id, null);

      case "table.importCsv":
        return ok(id, deps.tables.importCsv(req.name, req.csv));

      case "theme.set":
        return ok(id, await deps.theme.set(req.theme));

      /* ── the design doc, which is workspace-level and never an artifact's ── */
      //
      // Checked rather than assumed: `HostRequest` does not carry these three
      // kinds, so the bridge — which accepts only a HostRequest — refuses them
      // with no allow-list anywhere. An artifact has no business rewriting the
      // workspace's own design language; it is the thing the agent reads BEFORE
      // it writes an artifact.
      //
      // Their own kinds rather than `page.*` with a reserved id, because the doc
      // lives at `design/` and a user is free to keep a page of their own called
      // `design` under `pages/`. One id space cannot hold both.

      case "design.read":
        return ok(id, await deps.design.read());

      case "design.patch":
        // Same two scopes the addressed `variables.patch` has, and the same
        // code: `section` null is the doc's own variables, a name is that
        // section's, and a value that could not be read back is refused rather
        // than written.
        try {
          return ok(id, await deps.design.patch(req.section, req.patch));
        } catch (e) {
          console.error("design.patch", e);
          return err(id, codeOf(e, "flatness"), "a variable is a scalar or a list of scalars");
        }

      case "design.writeFile":
        // The agent seam again, and the raw fallback: `doc.raw` addresses a
        // page under `pages/` and cannot reach `design/`, so writing
        // `content.yaml` through here is how a broken one gets repaired.
        await deps.design.writeFile(req.file, req.text);
        return ok(id, null);

      /* ── the vault, which is workspace-level and never an artifact's ──── */
      //
      // An artifact cannot say any of these, and the mechanism is the type
      // rather than a check here: `HostRequest` does not carry them, and the
      // bridge accepts only a HostRequest. An artifact has no business knowing
      // the workspace is a folder, let alone which one, let alone changing it.

      case "vault.info":
        return ok(id, await deps.vault.info());

      // `path` omitted means "wherever is sensible", and where that is belongs
      // to the root — it is the module that knows which vault is open.
      case "vault.browse":
        // Refused in the built application, where the picker's chooser is the
        // operating system's own dialog and nothing on screen asks for this.
        // Hiding the Browse group without refusing the kind would only move the
        // listing out of sight, and it is reachable by a typed request.
        if (deps.production && NATIVE_DIALOG) return refused(id, "listing folders");
        try {
          return ok(id, await deps.vault.browse(req.path));
        } catch (e) {
          console.error("vault.browse", e);
          return err(id, codeOf(e, "not_found"), "that folder cannot be listed");
        }

      // THE ONE REQUEST THAT REPLACES EVERYTHING. Every module below this line
      // is rebuilt against a different folder before the answer comes back, so
      // the client's whole snapshot is stale the moment it does — which is why
      // the store re-reads the shell rather than patching it.
      case "vault.open":
        try {
          return ok(id, await deps.vault.open(req.path));
        } catch (e) {
          console.error("vault.open", e);
          const code = codeOf(e, "internal");
          // The domain's own sentence, when it has one. It writes these FOR A
          // PERSON and never puts the path in them, which is what makes passing
          // one through safe — and the commonest refusal is now "that folder is
          // not empty", where a flattened "cannot be a workspace" reads as the
          // picker being broken rather than as the answer to what to do next.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "there is no folder there"
              : said !== "" ? said
              : "that folder cannot be a workspace",
          );
        }

      // A FOLDER THAT DOES NOT EXIST YET, which is what separates this from
      // `vault.open` beside it: open walks to something already there, and this
      // makes the thing. The parent and the name stay apart all the way down —
      // the domain joins them, after the name has satisfied the name rule, so a
      // name carrying a separator cannot become a folder somewhere else.
      case "vault.create":
        try {
          return ok(id, await deps.vault.create(req.parent, req.name));
        } catch (e) {
          console.error("vault.create", e);
          const code = codeOf(e, "internal");
          // The domain's own sentence, as `vault.open` above takes it and for
          // the same reason: `creatable` writes one per row of the collision
          // table, for a person, with no path in it, and a flattened "cannot be
          // a workspace" is what makes a picker read as broken.
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(
            id,
            code,
            code === "not_found" ? "there is no folder there"
              : said !== "" ? said
              : "that folder cannot be a workspace",
          );
        }

      case "vault.recent":
        return ok(id, await deps.vault.recent());

      /* ── automations and runs ────────────────────────────────────────── */

      // EVERY ONE OF THESE IS ANSWERED IN FULL: there is no access model in
      // the workspace yet, and the build carries no filter and no seam for
      // one. What will narrow a list, a row and a log is the asker's VIEW
      // permission on the row's `page`, from the sync engine's model, written
      // here when that model lands. The refusals below carry the domain's own
      // sentence, which is written for a person and names an automation or an
      // input by the name they typed — never a path.
      case "automation.list":
        return ok(id, await deps.runs.automations(req.page));

      case "run.start":
        try {
          return ok(id, await deps.runs.start(req.page, req.automation, req.inputs ?? {}, req.by ?? null));
        } catch (e) {
          const said = e instanceof Error && e.message !== "" ? e.message : "";
          return err(id, codeOf(e, "internal"), said !== "" ? said : "that automation could not be started");
        }

      // A PAGE MOVED SINCE A RUN STARTED STILL OWNS IT, and the row already
      // says so: the moves this route performs re-point the rows beside the
      // tables (`restack` and `relocate` below), and the root re-points by
      // identity on mount and after a change from outside. So a list is one
      // query and never a walk of the page tree — which it was, once a second
      // while a run was followed.
      case "run.list":
        return ok(id, deps.runs.list({ page: req.page, automation: req.automation }));

      case "run.get": {
        const row = deps.runs.get(req.run);
        if (row === null) return err(id, "not_found", "no such run");
        return ok(id, row);
      }

      case "run.read":
        return ok(id, await deps.runs.read(req.run, req.stream, req.from, req.max));

      // WHO ENDED IT. The workspace's own screens say `screen`; a box says
      // nothing, because the bridge drops the field, and is recorded as a
      // page's. A request off the wire that says neither is a page's too.
      case "run.kill":
        return ok(id, await deps.runs.kill(req.run, req.by === "screen" ? "screen" : "page"));

      // The one kind about runs rather than in a vault: answered with or
      // without a folder named, because the shell asking it has no folder in
      // mind — it is closing the window over every one of them.
      case "run.live":
        return ok(id, deps.live());

      case "page.files":
        return ok(id, await deps.runs.pageFiles(req.page));

      case "page.readFile": {
        const text = await deps.runs.readPageFile(req.page, req.file);
        return ok(id, text);
      }

      case "automation.get":
        return ok(id, await deps.runs.manifest(req.page, req.automation));

      case "automation.set":
        await deps.runs.setManifest(req.page, req.automation, req.manifest, req.quiet === true);
        return ok(id, null);

      case "automation.templates":
        return ok(id, await deps.runs.templates());

      case "automation.create":
        return ok(id, await deps.runs.create(req.page, req.name, req.template));

      case "env.names":
        return ok(id, deps.envNames());

      case "vault.files":
        return ok(id, await deps.runs.vaultFiles());

      case "vault.readFile":
        return ok(id, await deps.runs.readVaultFile(req.file));

      case "vault.writeFile":
        await deps.runs.writeVaultFile(req.file, req.text, req.quiet === true);
        return ok(id, null);

      // THE EDITORS' ONE COMMIT, before their quiet saves start: what the
      // vault held when the file was opened is one revert away, and the
      // pauses in typing after it are not each a version.
      case "vault.commit":
        if (typeof req.message !== "string" || req.message.trim() === "") return err(id, "bad_request", "a commit needs a message");
        await deps.runs.commit(req.message);
        return ok(id, null);

      /* ── the agents and the chats: this machine's own window only ────── */
      //
      // Only this machine's own window reaches these: the composition root's
      // `gate` on `route` refused everything else before the body was answered.
      // Each is narrowed by the contract's own guard before a field is read,
      // because this is where words reach a program allowed everything on this
      // machine. NOTHING WAITS ON AN AGENT: each answers the state as it now
      // stands, and a probe's verdict, an install, a reply and a light arrive
      // on the stream.
      case "agents.list":
      case "agents.probe":
      case "agents.start":
      case "agents.registry":
      case "agents.install":
      case "agents.signIn":
      case "chat.new":
      case "chat.list":
      case "chat.read":
      case "chat.send":
      case "chat.cancel":
      case "chat.config":
      case "chat.switchAgent":
      case "chat.close":
      case "chat.commands":
      case "chat.delete":
      case "chat.sendQueued":
      case "chat.unqueue":
      case "settings.read":
        return await chatAnswer(id, req, deps);

      /* ── what each window has open, and the history ─────────────────── */
      case "window.report":
      case "window.list":
      case "history.read":
        return await historyAnswer(id, req, deps);
    }
  } catch (e) {
    // A thrown error carrying one of the closed codes is a REFUSAL the domain
    // chose to make — `vault.info` with nothing mounted, a name that cannot be
    // a folder — and it goes back as its own sentence, without a stack trace on
    // the server's stderr, because nothing failed. Only an error carrying no
    // code (or `internal`) is the host not answering, and that one is logged.
    const code = codeOf(e, "internal");
    if (code !== "internal") return err(id, code, e instanceof Error ? e.message : String(e));
    console.error(String(env.kind), e);
    return err(id, code, "the host could not answer that");
  }

  // `open` IS IN THE TYPE AND HAS NO CASE HERE ON PURPOSE, and this note exists
  // because its absence has already been diagnosed once as the same seam bug
  // that `variables` really was. It is not. `open` asks the HOST to change what
  // the person is looking at, which is a client-side fact the server cannot know
  // and has no business acting on — `client/bridge/bridge.js` answers it locally
  // by calling `ui.go` and never forwards it, so it does not reach here from the
  // product at all. It is in `ApiRequest` only because that type is a superset of
  // `HostRequest`. If you are here because a test called `handle` with it
  // directly: the refusal below is correct, and implementing navigation on the
  // server would be the bug.
  //
  // Otherwise: unreachable through the type and reachable off the wire, which is
  // the whole reason the enumeration has this member.
  return err(id, "unknown_kind", "not a request this host answers");
}

/** What a refusal from the agents or the chats says when it brought no
 *  sentence of its own. Theirs are written for a person and name an agent or
 *  a chat, never a path, a command or a value — so where one is given it is
 *  said as it is, the way `vault.open` passes its domain's. */
const CHAT_SENTENCES: Partial<Record<HostErrorCode, string>> = {
  not_found: "there is no such chat or agent",
  bad_request: "that is not something an agent or a chat can be asked",
  limit: "that is more than this chat takes at once",
  unsupported: "that cannot be done now",
  fetch_failed: "the ACP Registry could not be reached",
};

/** Answer one agent or chat kind. The guard first — every field read below is
 *  one it has checked — then the one module call the kind is. A throw carrying
 *  one of the closed codes is a refusal the module chose to make, said in its
 *  own sentence; anything else is the host failing, and is logged. */
async function chatAnswer(id: string, req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  if (!isChatRequest(req)) return err(id, "bad_request", CHAT_SENTENCES.bad_request as string);
  // THE KEPT CHOICES need neither the agents nor the chats: what the next
  // chat starts on is read with no agent anywhere.
  if (req.kind === "settings.read") {
    const settings = deps.settings;
    if (settings === undefined) return refused(id, "the chat's kept choices");
    return ok(id, settings.read());
  }
  const agents = deps.agents;
  const chats = deps.chats;
  if (agents === undefined || chats === undefined) return refused(id, "agents or chats");
  try {
    switch (req.kind) {
      case "agents.list":
        return ok(id, agents.list());
      case "agents.probe":
        return ok(id, agents.probe(req.agent));
      case "agents.start":
        return ok(id, agents.start(req.agent));
      case "agents.registry":
        return ok(id, await agents.registry());
      case "agents.install":
        return ok(id, agents.install(req.agent));
      case "agents.signIn":
        return ok(id, await agents.signIn(req.agent, req.method));
      case "chat.new": {
        // Field by field, so nothing the guard did not name rides along.
        const init: Parameters<Chats["create"]>[0] = {};
        if (req.agent !== undefined) init.agent = req.agent;
        if (req.text !== undefined) init.text = req.text;
        if (req.page !== undefined) init.page = req.page;
        if (req.config !== undefined) init.config = { ...req.config };
        // A first message goes with the page on screen where it was typed.
        if (req.text !== undefined) {
          const onScreen = await pageOnScreen(deps, req);
          if (onScreen !== null) init.onScreen = onScreen;
        }
        return ok(id, await chats.create(init));
      }
      case "chat.list":
        // Whole once every kept log is scanned, which the root awaits at
        // mount; awaited again here so a caller can never see half a list.
        await chats.loaded;
        return ok(id, chats.list());
      case "chat.read":
        return ok(id, await chats.read(req.chat, req.since));
      case "chat.send":
        // Out now to an idle chat, or into its queue: the answer says which.
        // Either way with the page on screen in the window that sent it.
        return ok(id, await chats.send(req.chat, req.text, await pageOnScreen(deps, req)));
      case "chat.sendQueued":
        return ok(id, await chats.sendQueued(req.chat));
      case "chat.unqueue":
        return ok(id, await chats.unqueue(req.chat, req.queued));
      case "chat.cancel":
        return ok(id, await chats.cancel(req.chat));
      case "chat.config":
        return ok(id, await chats.config(req.chat, req.option, req.value));
      case "chat.switchAgent":
        return ok(id, await chats.switchAgent(req.chat, req.agent));
      case "chat.close":
        return ok(id, await chats.close(req.chat));
      case "chat.commands": {
        const q: { chat?: string; agent?: string } = {};
        if (req.chat !== undefined) q.chat = req.chat;
        if (req.agent !== undefined) q.agent = req.agent;
        return ok(id, await chats.commands(q));
      }
      case "chat.delete":
        // Said only after the person's Delete in Biom's own dialog: the look
        // can ask for that dialog and never for this.
        await chats.delete(req.chat);
        return ok(id, null);
    }
  } catch (e) {
    const code = codeOf(e, "internal");
    if (code === "internal") {
      // The kind and the error's NAME, never its message: an agent's own
      // words can be anywhere in one.
      console.error(`${req.kind} failed`, e instanceof Error ? e.name : typeof e);
      return err(id, "internal", "the host could not answer that");
    }
    const said = e instanceof Error ? e.message.replace(/\s+/g, " ").trim() : "";
    return err(id, code, said !== "" ? said : CHAT_SENTENCES[code] ?? "that could not be done");
  }
  return err(id, "unknown_kind", "not a request this host answers");
}

/** THE PAGE ON SCREEN IN THE WINDOW A MESSAGE CAME FROM — the envelope's,
 *  which only this machine's own window can name here — or null. Never a
 *  refusal: a message that cannot say what was on screen goes without it
 *  rather than not at all. */
async function pageOnScreen(deps: Deps, req: ApiRequest): Promise<PageOnScreen | null> {
  if (deps.onScreen === undefined) return null;
  try {
    return await deps.onScreen((req as Envelope).window);
  } catch {
    return null;
  }
}

/** Answer a window's report, every window's context, or the history. The
 *  report names its window by the envelope — the guard refuses one that does
 *  not — and the context's `agent` is the history's to derive from its chat,
 *  whatever the window sent there. With no history, the two reads answer
 *  empty, and a report is refused: it has nowhere to go. */
async function historyAnswer(id: string, req: ApiRequest, deps: Deps): Promise<ApiResponse> {
  if (!isHistoryRequest(req)) {
    return err(id, "bad_request", (req as { kind: string }).kind === "window.report"
      ? "a report names its window and what that window has open"
      : "that is not a read of the history");
  }
  switch (req.kind) {
    case "window.report": {
      const history = deps.history;
      if (history === undefined) return refused(id, "a history");
      return ok(id, await history.report(req.window as string, req.context, req.moved));
    }
    case "window.list":
      return ok(id, deps.history?.windows() ?? []);
    case "history.read":
      return ok(id, deps.history?.read(req.since) ?? { entries: [], head: 0 });
  }
  return err(id, "unknown_kind", "not a request this host answers");
}

/** Follow a page move with the runs that were started under it. THE REGISTRY
 *  NEVER FAILS A MOVE: the page has already moved when this runs, and a row
 *  left naming the old id is re-pointed by identity on the next settle or
 *  mount — so a registry that is absent or refuses is a line in the log and
 *  never a move that did not happen. */
function relocated(deps: Deps, from: PageId, to: PageId): void {
  try {
    deps.runs.relocate(from, to);
  } catch (e) {
    console.warn("the runs under a moved page", e);
  }
}

/** Follow a page move with the index of page heads, by the same prefix rule:
 *  its rows are keyed by folder, and a page found by its `uid` at the folder it
 *  left would otherwise wait on a sweep of the workspace to be found at the
 *  one it went to. THE INDEX NEVER FAILS A MOVE: a row it could not carry is
 *  read again from disk when it is next asked. */
function indexed(deps: Deps, from: PageId, to: PageId): void {
  try {
    deps.index?.moved(from, to);
  } catch (e) {
    console.warn("the page index, after a move", e);
  }
}

/** Tell the index a page the app removed is gone. NEVER FAILS A REMOVE: the
 *  page is already gone, and a row left behind is dropped the next time it is
 *  asked about. */
async function forgotten(deps: Deps, id: PageId): Promise<void> {
  try {
    await deps.index?.invalidate([pageDir(id)]);
  } catch (e) {
    console.warn("the page index, after a remove", e);
  }
}

/** Follow a page move with the tables that were parented under it.
 *
 *  A page's position is the folder it sits in, so moving the directory moves
 *  every page beneath it and renames every id in one act. A TABLE HAS NO
 *  DIRECTORY: it lives in SQLite and its parent is a row in the registry, which
 *  is the one piece of tree state the filesystem does not restate. Left alone it
 *  goes on naming an id that stopped existing, and the table vanishes out of the
 *  tree while still claiming a parent — invisible, and correct-looking.
 *
 *  Synchronous because `Tables` is: the registry is one SQLite file and the move
 *  above has already returned, so this cannot be the half that is awaited when
 *  something else reads.
 *
 *  It is a rename of a prefix and never a search: `a/b` moving to `c/b` takes
 *  `a/b` itself and everything under `a/b/`, and nothing else can match. */
function restack(deps: Deps, from: PageId, to: PageId): void {
  for (const table of deps.tables.list()) {
    const parent = table.parent;
    if (parent === null) continue;
    if (parent === from) {
      deps.tables.setParent(table.name, to);
      continue;
    }
    if (parent.startsWith(`${from}/`)) {
      deps.tables.setParent(table.name, to + parent.slice(from.length));
    }
  }
}

/** The one way out. The framework grants unrestricted access, so nothing is
 *  allow-listed and nothing is logged — but the call goes through the host, so
 *  an egress proxy later is a change here rather than a rewrite of every
 *  artifact that exists. */
async function proxy(id: string, url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<ApiResponse> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return err(id, "bad_request", "that is not a url");
  }
  // Not a permission check on data — a scheme check. `file:` would turn the one
  // way out into a way in, and reading the host's disk is not what "call any
  // public API" means.
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return err(id, "bad_request", "only http and https can be reached");
  }

  // NO COOKIE LEAVES THROUGH HERE EITHER. A page choosing its own headers may
  // set Host and Origin to anything — that is why neither is what this
  // server's own local kinds trust — but it must never be able to present a
  // cookie, least of all this server's capability to itself. Dropped whatever
  // its case.
  const sent = init?.headers === undefined
    ? undefined
    : Object.fromEntries(Object.entries(init.headers).filter(([k]) => k.toLowerCase() !== "cookie"));

  try {
    const res = await fetch(target, {
      method: init?.method ?? "GET",
      headers: sent,
      body: init?.body,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const headers: Record<string, string> = {};
    // NO COOKIE CROSSES BACK TO A PAGE. A page has no cookie jar to put one in,
    // and the one this server sets on its own document is the terminal's
    // capability — a page asking this proxy for `http://localhost:<port>/` must
    // not be able to read it off the answer.
    res.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
    const value: HostFetchResult = { status: res.status, headers, body: await res.text() };
    return ok(id, value);
  } catch (e) {
    console.error("fetch", e);
    return err(id, "fetch_failed", "the site did not answer");
  }
}

/**
 * The HTTP half. Everything it knows about HTTP stops here: `handle` above has
 * never seen a Request, which is what makes fetch → postMessage → an in-process
 * call a replacement of this function alone.
 */
/**
 * One HTTP request in, one response out.
 *
 * `gate` is the composition root's answer to *may this request say this kind* —
 * a sentence refusing it, or null — asked once the body is read and before
 * anything is answered. It exists for the kinds that answer only this
 * machine's own window (`isLocalKind` in `contracts/guards.js`): the facts it
 * needs — the peer address, the Host, the Origin, `Sec-Fetch-Site`, the
 * capability cookie — are the server's, and this layer never sees a socket. A refusal is `identity`, and
 * its sentence names no check: telling a caller which one failed is telling it
 * which to forge next. Absent, nothing is gated — every test of `handle` and
 * every caller that predates it.
 *
 * `own` is the same question without a kind: *is this request this machine's
 * own window* — the check a window's report must pass. A request that is not
 * has its `window` dropped before it is answered, so its write is answered as
 * ever and recorded as nobody's: A WINDOW IS NAMED ONLY BY A WINDOW THAT COULD
 * REPORT FOR IT. Without this, anything holding the launch token — a run's
 * script, which may read every window's id off `window.list` — could put its
 * writes in the history as the person's. Absent, a `window` is taken as sent.
 */
export async function route(request: Request, deps: Deps, gate?: (kind: string) => string | null, own?: () => boolean): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Use POST", { status: 405, headers: { allow: "POST" } });
  }

  // DELIBERATELY NO CORS HEADERS. This looks like an omission and it is the
  // opposite: the artifact frame is sandboxed without allow-same-origin, so it
  // has an opaque origin and cannot read a response from this route even though
  // the server is right there. That is the entire chokepoint — every path from
  // an artifact to workspace data is forced through postMessage and the bridge,
  // enforced by the browser for free. `Access-Control-Allow-Origin: *` or
  // `: null` would hand it back. Never add one.
  //
  // Two lines of belt to that brace, because a no-cors POST still executes on
  // the server even when its response is unreadable:
  const origin = request.headers.get("origin");
  if (origin === "null") {
    return new Response("Forbidden", { status: 403 });
  }
  // Requiring JSON forces a preflight this server never answers, so a simple
  // request cannot reach the switch above. BY THE TYPE'S ESSENCE, EXACTLY —
  // what comes before the first `;`, trimmed and in lower case — and never by
  // containing the word: `text/plain; x=application/json` is a simple request a
  // browser sends from any page without asking, and a substring check let it
  // through. From a page on another localhost port it carried the person's
  // capability cookie to every kind this route answers.
  const type = (request.headers.get("content-type") ?? "").split(";")[0] ?? "";
  if (type.trim().toLowerCase() !== "application/json") {
    return new Response("Expected application/json", { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ id: "", g: PROTOCOL, ok: false, error: fail("bad_request", "the body is not json") as HostError });
  }

  if (gate !== undefined && typeof body === "object" && body !== null) {
    const { id, kind } = body as { id?: unknown; kind?: unknown };
    if (typeof kind === "string" && gate(kind) !== null) {
      return json({
        id: typeof id === "string" ? id : "",
        g: PROTOCOL,
        ok: false,
        error: fail("identity", "this is answered only to this machine's own window") as HostError,
      });
    }
  }

  if (own !== undefined && typeof body === "object" && body !== null && "window" in body && !own()) {
    const { window: _named, ...rest } = body as Record<string, unknown>;
    body = rest;
  }

  return json(await handle(body as ApiRequest, deps));
}

function json(value: ApiResponse): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
