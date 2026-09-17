// SPDX-License-Identifier: AGPL-3.0-only
// Layer 16 — the composition root. The only module in the client that
// constructs anything, and nothing imports it.
//
// Everything below receives its dependencies as arguments, which is what makes
// "replace a module without touching others" literally true: every swap named in
// the build plan is one changed line in here. fetch → postMessage is a different
// `makeHttp`. iframe → webview is a different `makeFrameHost`. A render written
// this afternoon joins the registry on the same line as the four shipped ones.
//
// So it is kept flat and in order, and it reads as the list it is.
//
//   make dev   →   http://localhost:4400

/** @import { Theme, VaultInfo } from "../contracts/types.ts" */

import { API_ROUTE, ERRORS, PROTOCOL, SHIM_ROUTE, vaultBase } from "../contracts/wire.js";
import { h, fill, remembered } from "./platform/dom.js";
import { useAssets } from "./platform/markdown.js";
import { makeHttp, TOKEN_PARAM } from "./transport/http.js";
import { makeEvents } from "./transport/events.js";
import { makeWorkspace } from "./store/workspace.js";
import { applyTheme, paperOf } from "./theme/theme.js";
import { faceCss } from "./theme/faces.js";
import { makeUi } from "./store/ui.js";
import { makeBridge } from "./bridge/bridge.js";
import { makeFrameHost } from "./frame/frame.js";
import { makePageView, makeDesignView, makeMapView } from "./views/page.js";
import { makeConfigView } from "./views/config.js";
import { makeInstructionsView } from "./views/instructions.js";
import { makeAutomationView } from "./views/automation.js";
import { makeRunsView } from "./views/runs.js";
import { makeTableView } from "./views/table.js";
import { makeTreeView } from "./views/tree.js";
import { makeVaultView } from "./views/vault.js";
import { makeShell, parseHash } from "./shell/shell.js";

/* ── which build this is ────────────────────────────────────────────────── */

// THE ONE READ ON THIS SIDE OF THE WIRE, and there is exactly one channel it
// could come down. The client has no build step, ever — this file is served off
// `/js/boot.js` exactly as it sits on disk — so the compile-time `--define` that
// reaches `server/main.ts` cannot reach here, and the document the server hands
// back is the only thing that can carry the value. `server/main.ts` writes it
// into the one meta tag in `client/index.html` on the way out.
//
// WHAT DESCENDS IS A BOOLEAN, not the word. Every screen below asks the same
// question — is this row put in the list — and a three-valued string handed
// down would be three comparisons in each of them and a fourth value the day
// somebody adds one. The vocabulary stays here; what the views get is an answer.
//
// A document with no meta tag at all — a raw `client/index.html` opened off
// disk, a test that built its own page — reads as development, which is the
// direction that shows everything rather than the one that hides it.
const environment =
  (typeof document !== "undefined" && document.querySelector
    ? document.querySelector('meta[name="biom-env"]')?.getAttribute("content")
    : null) ?? "development";

/** Whether this is the built application a stranger downloaded, rather than a
 *  source tree with a server in front of it. The ONLY thing anything below
 *  knows about the environment. */
const production = environment === "production";

/** WHY THIS LAUNCH HAS NO WORKSPACE, or "" when there is nothing to say.
 *
 *  It comes down the same channel the environment does, and for the same reason:
 *  the client has no build step and the document is the one thing the server
 *  composes. The wire cannot carry it — the only call this tab makes before it
 *  has a folder is `vault.recent`, and `VaultInfo` has no field for it, so it
 *  would be a `contracts/` edit for a sentence.
 *
 *  The server leaves the tag OFF when there is nothing to say and stops writing
 *  it the moment any folder opens, so an empty read here is a first launch —
 *  which needs no explaining — rather than a failure it lost the words for. */
const startupTrouble =
  (typeof document !== "undefined" && document.querySelector
    ? document.querySelector('meta[name="biom-trouble"]')?.getAttribute("content")
    : null) ?? "";

/* ── which folder this tab is ───────────────────────────────────────────── */

// SETTLED BEFORE ANYTHING IS CONSTRUCTED, and it never moves again. The server
// holds several vaults open at once, so a tab has to say which one it means on
// every request — and the honest place for that is the url, because it is the
// one piece of state a reload keeps and two tabs cannot share.
//
// Everything below is built against the answer. A store that could switch vaults
// is a store that can be caught half-switched; a store that cannot switch cannot.
// Opening a different folder is therefore a navigation, not a mutation.

/** The folder in the address bar, or null when this tab has not chosen one.
 *
 *  ABSOLUTE MEANS TWO SHAPES, the same two `vaultOf` in `contracts/wire.js`
 *  takes: a leading slash, or a drive letter and a separator. The application
 *  is built for Windows, where `C:\Users\…` is what a resolved path looks
 *  like — and a leading-slash test alone read every one of them as no folder
 *  chosen, which is the picker on every launch. */
function vaultInUrl() {
  const named = new URLSearchParams(location.search).get("vault");
  return named !== null && /^(\/|[A-Za-z]:[\\/])/.test(named) ? named : null;
}

/** THE PER-LAUNCH TOKEN, read out of this window's own address.
 *
 *  The built application's server mints one at boot, tells the shell, and the
 *  shell opens the window at an address carrying it. A server run from source
 *  mints none, this is null, and every call below is exactly what it was.
 *
 *  It is read here and handed to the transport, which is the one place every API
 *  call is built. Nothing else in the client learns it exists. */
const token = new URLSearchParams(location.search).get(TOKEN_PARAM);

/** Ask the server for the last folder anybody opened. This is the ONLY thing the
 *  unprefixed route is for — three kinds that are about vaults rather than in
 *  one — and it is how a tab opened at `/` lands somewhere rather than nowhere.
 *  @returns {Promise<string | null>} */
async function lastOpened() {
  try {
    // The unprefixed route is still the API route, so it is still behind the
    // token when there is one. This call is made before the transport exists —
    // it is what decides which folder the transport will be built against — so
    // it builds the address itself, out of the same two names `makeHttp` uses.
    const query = token === null ? "" : `?${TOKEN_PARAM}=${encodeURIComponent(token)}`;
    const res = await fetch(API_ROUTE + query, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "boot", g: PROTOCOL, kind: "vault.recent" }),
    });
    const body = await res.json();
    const list = /** @type {VaultInfo[]} */ (body && body.ok ? body.value : []);
    const head = list[0];
    return head ? head.path : null;
  } catch {
    return null;
  }
}

/** WHETHER THE ADDRESS MEANS *NO WORKSPACE*, said in the hash because the query
 *  cannot say it: a missing `vault` is what a fresh launch looks like too, and
 *  that one is meant to land in the folder last used. `#/vault` is the window
 *  saying it means the start page — which is what `Close workspace` in the
 *  rail's foot navigates to, and what somebody typing it by hand asks for.
 *  Read off the raw hash rather than through `parseHash`, because this runs
 *  before anything is constructed and the answer decides what gets built. */
const wantsPicker = /^#\/?vault(\/|$)/.test(location.hash);

let vault = vaultInUrl();
if (vault === null && !wantsPicker) {
  vault = await lastOpened();
  // Written into the url rather than kept in a variable, so this tab's address
  // is true from here on: reload it, bookmark it, or open a second one beside
  // it, and all three mean the folder they say.
  if (vault !== null) {
    // EVERY PARAMETER THIS WINDOW WAS OPENED WITH SURVIVES. Writing the folder
    // in used to rewrite the whole query, which in the built application would
    // have thrown away the token in the same breath as reading it — and the
    // first API call after it would have been refused by the server that had
    // just handed the window the key.
    const query = new URLSearchParams(location.search);
    query.set("vault", vault);
    history.replaceState(null, "", "?" + query.toString() + location.hash);
  }
}

/* ── construction ───────────────────────────────────────────────────────── */

// The vault is the BASE URL, which is why transport did not have to change: it
// has always taken one so that pointing the client at another host is a change
// here rather than in there. Another folder turns out to be the same shape of
// move as another host, which is the sign the seam was in the right place.
//
// With no folder chosen the base is "", and the unprefixed route answers the
// three vault kinds and refuses everything else — so the picker works and
// nothing else pretends to.
const base = vault === null ? "" : vaultBase(vault);
// WHERE THIS WORKSPACE'S PICTURES ARE, absolute, and given to both realms that
// draw one. A page names a FILE — `kitchen.jpg` — because a filename is the only
// portable thing to write down: the url carries the folder's absolute path, and
// a page that hardcoded that would break the moment the same workspace was
// opened from another machine. Resolving it is therefore the host's job, and it
// is done twice because there are two documents: `useAssets` rewrites a picture
// in prose, and every artifact frame is woven with this as its `<base>`.
const assets = vault === null ? "" : location.origin + base + "/asset/";
useAssets(assets);

const transport = makeHttp(base, token);
// THE SERVER PRESSING RELOAD. One stream per tab, under this tab's vault
// prefix — which is what makes an event from another folder unable to reach
// this one: the vault is settled above before a single module is constructed,
// so opening another folder is a navigation and a fresh document with a stream
// of its own. With no folder chosen the base is "" and nothing is opened.
const events = makeEvents(base);
const ws = makeWorkspace(transport);
// A tab with no folder has one thing to show, and it is the picker. Not an empty
// workspace and not an error: there is genuinely nothing else to be looking at.
const ui = makeUi({
  route: vault === null ? { view: "vault", id: "" } : parseHash(location.hash, production),
  // The one piece of view state that outlives the tab, read here because the
  // store does no I/O. Anything other than "desc" is ascending, so a corrupted
  // value reads as the default rather than as a third state.
  treeOrder: remembered("treeOrder", "asc") === "desc" ? "desc" : "asc",
});

// DOM-free, and it never learns the artifact is in a frame. Writes go through
// the store, so an artifact inserting a row updates the grid on screen.
const bridge = makeBridge(ws, transport, ui, vault ?? "");
// THE FACES, DECLARED A SECOND TIME FOR THE BOX. Its origin is opaque, so the
// host's stylesheet is not its stylesheet and a font named in tokens.css does
// not exist in there; `frame.js` weaves these rules into every box's head, with
// absolute urls back to this origin's `/fonts/`, which the server answers with
// the CORS header an opaque origin needs.
const faces = faceCss(location.origin + "/fonts/");
const frameHost = makeFrameHost(bridge, assets, faces);

// THERE IS NO REGISTRY HERE ANY MORE, and its absence is the change. The client
// used to fill a render registry at this point, because the host drew the page
// and had to be told how. The host does not draw a page now: `views.page` builds
// one document that loads `guest/runtime/` into a box, and everything that used
// to be registered here is registered by that runtime on the other side of an
// opaque origin — where a workspace can add to it, which is the whole point.
const views = {
  tree: makeTreeView({ h, ws, ui }),
  page: makePageView({ h, frameHost, ws, ui, vault: vault ?? "" }),
  config: makeConfigView({ h, ws, ui, frameHost, production }),
  table: makeTableView({ ws, ui, production }),
  // Which folder the workspace IS, chosen here rather than in an environment
  // variable somebody has to be told about. It is workspace-level like the one
  // above it, so it is a route rather than a dialog.
  vault: makeVaultView({ h, ws, ui, production }),
  // The design doc, and it is the same mount as every other page: `@design` is
  // a reserved id, `pageDir` sends it to the `design/` root beside `pages/`, and
  // the same runtime draws it. What it does NOT get is a document of its own —
  // the box is woven empty, so a `design/index.html` never loads and the doc
  // plugin always draws it. See the comment on `makeDesignView`.
  design: makeDesignView({ h, frameHost, ws, ui, vault: vault ?? "" }),
  // The map of the whole workspace: the `mindmap` plugin's document, mounted on
  // `@map`, which the server answers as a bare plugin page. NOTHING IS SHIPPED
  // any more — every plugin is seeded into `<vault>/plugins/` and served from
  // there — so what this draws is the document `page.js` carries as
  // `MAP_DOCUMENT`, held equal to the seed root's own file by
  // `tests/mindmap.test.js`, and never a plugin the framework serves.
  map: makeMapView({ h, frameHost, ws, ui, vault: vault ?? "" }),
  // AUTOMATIONS AND INSTRUCTIONS: the rail's overview of every run and the
  // workspace's own instructions, and a page's two screens. Each reads the
  // registry on demand — none of it is in the snapshot — and the two that
  // watch runs are handed the stream, so a run starting or ending anywhere is
  // one reread.
  runs: makeRunsView({ h, ws, ui, events: { on: (hear) => events.onRun(hear) } }),
  instructions: makeInstructionsView({ h, ws, ui }),
  automation: makeAutomationView({ h, ws, ui, events: { on: (hear) => events.onRun(hear) } }),
};

const shell = makeShell({ h, fill, ws, ui, frameHost, views, production, events });

/* ── the wiring ─────────────────────────────────────────────────────────── */

/** The vault's theme, on this document AND as data inside every frame. Custom
 *  properties do not cross a document boundary, so a page is handed the theme
 *  over the wire and re-declares it; `var(--ink)` is not free in there. The
 *  chrome around the box follows the same palette and the vault's furniture
 *  face, which is what `applyTheme` writes — `css/tokens.css` still declares a
 *  scheme and it is the one painted until `theme.get` answers. The PAPER is set
 *  beside it because it is not the canvas: the box paints no background and the
 *  frame is transparent, so what shows through a page is the colour under it,
 *  and that is the palette's lightest stock rather than the workspace's.
 *  The broadcast is fired on identity, because every emit is not a change.
 *
 *  Declared here rather than at the foot of the file on purpose: `let` has a
 *  temporal dead zone, the subscription below fires during `loadTree`, and a
 *  binding read before its declaration has run throws — which is a blank
 *  workspace and one line in the console.
 *  @type {Theme | null} */
let last = null;
function theme() {
  const next = ws.get().theme;
  if (next === last) return;
  last = next;
  applyTheme(next);
  const paper = paperOf(next);
  if (paper) document.documentElement.style.setProperty("--paper", paper);
  // One broadcast is the whole of it now. Custom properties do not cross a
  // document boundary, so the box is handed the palette as data and re-declares
  // it — and anything inside that cannot read a custom property at all, a
  // `<canvas>` or a library writing its own literal fills, is redrawn by the
  // plugin that owns it rather than by a hook out here.
  frameHost.broadcast({ kind: "theme", theme: next });
}

// Both stores repaint the same shell. The shell decides what actually changed —
// it has to, because a repaint that re-inserts an unchanged page root reloads
// every artifact iframe on it.
ws.on(() => { theme(); shell.repaint(); });
ui.on(() => shell.repaint());

// The other half of the same signal. `on` says "redraw"; `onChange` says WHAT
// moved, which is what an artifact needs — it lives in an opaque-origin frame
// and cannot observe anything outside itself, so a section reordered or a row
// edited in the grid is invisible to it until the host says so. Without this
// every artifact on screen is quietly stale until someone reloads by hand.
ws.onChange((change) => frameHost.refresh(change));

// The shim is inlined ahead of every artifact's own markup, so it has to be in
// hand BEFORE the first frame mounts — and mounting the shell is what can mount
// a frame, because the route may already name a page. `guest/biom.js` is
// served verbatim at SHIM_ROUTE and imports nothing, which is why it can be.
await fetch(SHIM_ROUTE)
  .then((res) => res.text())
  .then((text) => frameHost.setShim(text))
  .catch((err) => console.error("the artifact shim did not load", err));

const root = document.getElementById("root");
if (root) shell.mount(root);
else console.error("no #root in the document — nothing was mounted");

// A tab with no folder reads nothing, because there is nothing to read: every
// kind but the three about vaults is refused without one, and asking anyway
// would put a shelf of failures on screen behind the picker. The picker is the
// whole of this tab until somebody chooses, and choosing navigates.
//
// WITH NO FOLDER AND A REASON, THE REASON IS SAID. Nothing failed in this tab —
// the failure was on the way up, before there was a tab, and the remembered
// folder was then dropped from `vault.recent` for being gone, which is why
// nothing here is even addressed at it. Without this the picker simply appears,
// and the person whose workspace was deleted, or is on a drive they have not
// plugged in, is shown a folder chooser with no explanation at all.
if (vault === null && startupTrouble !== "") shell.trouble(new Error(startupTrouble), true);

if (vault !== null) {
  try {
    await ws.loadTree();
    // Cold start: a tool for building tools has an empty empty-state, so the first
    // screen is never one. A hash that already names a page wins over this.
    const route = ui.get().route;
    const first = ws.get().pages[0];
    if (route.view === "page" && !route.id && first) ui.go("page", first.id);
  } catch (err) {
    // WHICH FAILURE THIS IS DECIDES WHERE THE TAB LANDS, and the two are not the
    // same screen. A folder that cannot be opened at all — gone, a file now,
    // unreadable, a `workspace.db` that is not a database, a format this build
    // does not read — is refused by the server with one of the contract's closed
    // codes and its own sentence, and the only act that helps is picking a
    // different folder: that goes to the picker, with the sentence above it.
    // Anything else — the server not answering, something throwing inside a
    // workspace that does open — is not a reason to tell somebody their
    // workspace is gone, and it stands where it always did.
    const code = /** @type {{ code?: unknown }} */ (err)?.code;
    const unopenable = code === ERRORS.NOT_FOUND || code === ERRORS.BAD_REQUEST;
    shell.trouble(err, unopenable);
  }
}
