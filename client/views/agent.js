// SPDX-License-Identifier: AGPL-3.0-only
// Layer 14 — THE AGENT SCREEN, HOST SIDE: the box the look is drawn in, and
// the one thing over it that is not the look's — the INPUT BOX.
//
// The start screen, a chat and the list of chats are drawn by the plugin a
// workspace can replace, in a box on `AGENT_PAGE`, and this view mounts that
// box — on the Agent screen, or in the resizable panel beside a page — and
// feeds it `look.state` when it says hello and whenever what it shows changes
// shape (another chat, the list opened or shut, the panel maximised), and
// `look.patch`, coalesced to one a frame, as the chats stream. ONLY through
// the `Frame.post` of the frame it mounted: never a broadcast, which throws,
// and never a scan of sessions by page. It hands the look `names`, the pages
// its places name, because the look cannot resolve a `uid`; `input`, where
// Biom's input box sits and how much of the look it covers; and `beside`, the
// page the panel sits beside or the Agent screen would minimise to. It answers
// the look's four `look.*` kinds for that box alone, which it knows by the
// identity of the context it mounted the box with.
//
// ONE BOX SERVES THE FULL SCREEN AND THE PANEL, AND IT IS NEVER MOVED. Moving
// an iframe to another parent reloads it — the look would lose its place and
// everything it had drawn — so the box sits in ONE element, `slot`, which the
// shell places once in the bed beside the canvas and never again, and the
// three shapes — the whole screen, the panel on the right, nowhere — are the
// bed's grid and this slot's `data-mode`. Shut, the slot is `display: none`:
// the box keeps running and comes back as it was.
//
// THE PANEL'S HEAD IS THE LOOK'S (its list of chats, expand, close); its
// width is this view's grip, kept for this browser.

/** @import { Address, BridgeContext, ChatId, ChatSummary, ChatUpdate, Frame, FrameHost, HostErrorCode, LookInput, LookState, PageId, PageName, WindowId } from "../../contracts/types.ts" */
/** @import { ChatStore } from "../store/chats.js" */
/** @import { HistoryStore } from "../store/history.js" */
/** @import { Switcher } from "../store/switcher.js" */
/** @import { Ui } from "../store/ui.js" */
/** @import { Workspace } from "../store/workspace.js" */
/** @import { LookRequest } from "../bridge/bridge.js" */
/** @import { AgentInput } from "./agent-input.js" */

import { AGENT_PAGE, DEFAULT_VIEW, ERRORS } from "../../contracts/wire.js";
import { addressOfPlace } from "../../contracts/address.js";
import { remember, remembered } from "../platform/dom.js";
import { weaveRuntime } from "../platform/document.js";
import { agentMode, showChat } from "../store/chats.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** A short fixed-width mark of a string, to tell two apart — not a secret.
 *  @param {string} text */
function signature(text) {
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = ((a << 5) + a + c) | 0;
    b = ((b << 5) + b ^ c) | 0;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/** THE KEY THE BOX IS MOUNTED UNDER. Not `@agent` itself, which is the key
 *  the page view would mount a page of that id under: the shell refuses
 *  `#/page/@agent` as no page, and were a box ever mounted there it would be
 *  one of its own that this view never feeds, not this one taken over. */
export const LOOK_KEY = AGENT_PAGE + ":screen";

/** THE DEFAULT LOOK'S STAGE, which Biom's input box sits over: the list of
 *  chats down the left of the full screen while it or a chat shows, and the
 *  panel's head across its top. The contract carries where the input sits,
 *  not where a look's stage is, so a look someone else writes leaves these
 *  two regions to its own furniture as the default one does. */
export const LOOK_THREADS = 268;
export const LOOK_HEAD = 46;

/** The panel's width: the mockup's, and the least it goes to. */
export const PANEL_WIDTH = 460;
export const PANEL_MIN = 320;
/** One arrow key's step on the grip. */
const PANEL_STEP = 24;
/** How much of the window the page beside the panel always keeps. */
const PAGE_KEEPS = 420;
/** Where the dragged width is kept, per browser. */
const PANEL_KEY = "agentPanel";
/** Updates held for one patch past which the look is handed its state whole
 *  instead — a window hidden for an hour while a chat streamed. */
export const PATCH_MAX = 2000;
/** How long after the workspace changes on disk the look's document is read
 *  again: a rung over `biom-agent` may have named another look. */
const REREAD_AFTER = 600;

/**
 * WHAT THE HOST'S OWN CHROME SHOWS OF THE CHATS: the rail's busy count, the
 * bar's name and light for the open chat, and the strip's counts.
 * @typedef {object} AgentChrome
 * @property {number} busy Chats whose turn is working.
 * @property {ChatSummary | null} chat The chat this window has open.
 * @property {number} chats
 * @property {number} active Agents that are Active.
 */

/**
 * @typedef {object} AgentView
 * @property {HTMLElement} slot The Agent screen and the panel, one element.
 * @property {(req: LookRequest, ctx: BridgeContext) => null | { code: HostErrorCode, message: string }} answer
 *   The look's four kinds, for the box this view mounted and no other.
 * @property {() => void} open The rail's **Agent**: the full screen, with the
 *   chat this window last had open.
 * @property {(page: PageId) => void} edit **Edit**: a new chat beside the page,
 *   its location typed in.
 * @property {() => AgentChrome} chrome
 * @property {(fn: () => void) => () => void} onChrome What `chrome` answers moved.
 */

/**
 * @param {object} deps
 * @param {H} deps.h
 * @param {FrameHost} deps.frameHost
 * @param {Ui} deps.ui
 * @param {Pick<Workspace, "get" | "on">} deps.ws
 * @param {ChatStore} deps.chats
 * @param {Pick<Switcher, "on"> | null} deps.switcher
 * @param {Pick<HistoryStore, "get" | "on"> | null} deps.history
 * @param {WindowId} deps.window
 * @param {AgentInput} deps.input
 * @param {string} deps.vault
 * @param {{ on: (hear: () => void) => () => void }} [deps.events]
 * @param {Window} [deps.win]
 * @returns {AgentView}
 */
export function makeAgentView(deps) {
  const { h, frameHost, ui, ws, chats, input, vault } = deps;
  const win = deps.win ?? window;

  /** THE ONE CONTEXT THE BOX IS MOUNTED WITH, and its identity is the test:
   *  the frame host hands this very object to the bridge with every request
   *  the box makes, and nothing else holds it. @type {BridgeContext} */
  const CTX = { page: AGENT_PAGE };

  /* ── the slot, built once and placed once ──────────────────────────── */

  const say = h("p.agentsay", { hidden: "" });
  const box = h("div.agentbox", say);
  const grip = h("div.agentgrip", {
    role: "separator", "aria-orientation": "vertical", "aria-label": "Chat panel width",
    "aria-valuemin": String(PANEL_MIN), tabindex: "0",
    onpointerdown: (/** @type {PointerEvent} */ e) => dragStart(e),
    onpointermove: (/** @type {PointerEvent} */ e) => dragMove(e),
    onpointerup: () => dragStop(),
    onpointercancel: () => dragStop(),
    onkeydown: (/** @type {KeyboardEvent} */ e) => gripKey(e),
    ondblclick: () => { width = PANEL_WIDTH; applyWidth(); keepWidth(); },
  });
  const over = h("div.agentover", input.el);
  const slot = h("div.agentslot", { "data-mode": "none" }, grip, box, over);

  /* ── the box ───────────────────────────────────────────────────────── */

  /** @type {Frame | null} */
  let frame = null;
  /** The document the box was last woven from. @type {string | null} */
  let html = null;
  let reading = false;
  let rereadAgain = false;
  /** When the last read of the look's document failed, so a server that
   *  refuses it is not asked again on every push. */
  let readFailed = 0;
  /** The current realm holds its ports: it has said hello. */
  let helloed = false;

  /** @param {string} text */
  function saying(text) {
    say.textContent = text;
    say.hidden = text === "";
  }

  /** READ THE LOOK'S DOCUMENT and put it in the box. The frame host keeps the
   *  box while the document is the same, and reloads the SAME element with a
   *  new one — so the box is appended here once, the first time, and never
   *  moved after. */
  async function readLook() {
    if (reading) { rereadAgain = true; return; }
    reading = true;
    try {
      do {
        rereadAgain = false;
        const page = await chats.lookPage();
        // THE RUNGS ARE PART OF WHAT THE BOX DRAWS: a workspace naming another
        // look in `plugins/biom-agent/extensions.yaml` changes the read's
        // extensions and not its document, and the box reads them only as it
        // loads — so they are woven in as a mark, and a changed rung is a
        // changed document, reloaded in the same element.
        const next = weaveRuntime(page.html, { id: page.id, name: page.name, plugin: page.plugin, input: page.input }, vault) +
          "<!-- rungs " + signature(JSON.stringify(page.extensions ?? null)) + " -->";
        if (next !== html) {
          html = next;
          const f = frameHost.for(LOOK_KEY, next, CTX);
          f.el.setAttribute("title", "The Agent screen");
          if (f.el.parentElement !== box) box.append(f.el);
          frame = f;
          helloed = false;
          posted = null;
        }
        saying("");
        readFailed = 0;
      } while (rereadAgain);
    } catch (e) {
      readFailed = Date.now();
      console.warn("[biom] the Agent screen's look could not be read", e);
      saying("The Agent screen could not be drawn: " + (e instanceof Error && e.message ? e.message : "the server did not answer") + ". What you type below still reaches your agent.");
    } finally {
      reading = false;
    }
  }

  /** @type {ReturnType<typeof setTimeout> | null} */
  let rereadTimer = null;
  deps.events?.on(() => {
    if (html === null) return;
    if (rereadTimer !== null) clearTimeout(rereadTimer);
    rereadTimer = setTimeout(() => { rereadTimer = null; void readLook(); }, REREAD_AFTER);
  });

  // THE BOX SAYING HELLO is a new realm with fresh ports and nothing drawn:
  // it is handed its state whole, whatever it was handed before.
  slot.addEventListener("biom:notice", (ev) => {
    const notice = /** @type {CustomEvent} */ (ev).detail;
    if (!notice || notice.kind !== "hello" || frame === null || ev.target !== frame.el) return;
    helloed = true;
    posted = null;
    post();
  });

  /* ── what the look is told ─────────────────────────────────────────── */

  /** What the look was last handed whole — and which read of the chat's
   *  stream, so a chat read again from the start (another chat opened and
   *  this one come back to) is handed over whole again rather than patched
   *  across a gap. @type {{ mode: "screen" | "panel", list: boolean, chat: ChatId | null, epoch: number } | null} */
  let posted = null;
  /** Updates for the posted chat, waiting for the next patch. @type {ChatUpdate[]} */
  let queue = [];
  /** Page uids the posted chat's changes name. @type {Set<string>} */
  let uids = new Set();
  let sentChats = "";
  let sentNames = "";
  let sentInput = "";
  let sentBeside = "";
  let scheduled = false;

  /** The chats as the look draws them, minus what moves on every push of a
   *  streaming chat and draws nothing new — `updated` to the minute — so a
   *  reply streaming is not the whole list posted thirty times a second.
   *  @param {readonly ChatSummary[]} list */
  const chatsSig = (list) => JSON.stringify(list.map((c) => [c.id, c.name, c.face, c.agent, c.harness, c.phase, c.turn, c.light, c.stop, c.reason, c.page, Math.floor(c.updated / 60000)]));

  /** The pages a chat's changes name, off its stream.
   *  @param {readonly ChatUpdate[]} updates @param {Set<string>} into */
  function scan(updates, into) {
    for (const u of updates) {
      if (u.kind !== "changed" || !Array.isArray(u.edits)) continue;
      for (const e of u.edits) if (e && e.place && e.place.view === "page" && typeof e.place.uid === "string") into.add(e.place.uid);
    }
  }

  /** @returns {Record<string, PageName>} */
  function namesNow() {
    const want = new Set(uids);
    for (const c of chats.get().chats) if (c.page && c.page.view === "page") want.add(c.page.uid);
    /** @type {Record<string, PageName>} */
    const out = {};
    for (const p of ws.get().pages) if (typeof p.uid === "string" && want.has(p.uid)) out[p.uid] = { id: p.id, name: p.name };
    return out;
  }

  /** @param {string} uid */
  const idOf = (uid) => ws.get().pages.find((p) => p.uid === uid)?.id ?? null;
  /** @param {PageId} id @returns {PageName} */
  const nameOf = (id) => ({ id, name: ws.get().pages.find((p) => p.id === id)?.name ?? id.slice(id.lastIndexOf("/") + 1) });

  /** The last page this window showed, as the ui had it — what the history
   *  says before it has been read. @type {Address | null} */
  let lastRoute = null;

  /** THE LAST PAGE THE HISTORY SHOWS for this window: where the Agent screen
   *  minimises to (*History and View Switcher*, `popups`).
   *  @returns {Address | null} */
  function lastPage() {
    const all = deps.history?.get() ?? [];
    const pages = ws.get().pages;
    const key = all.length + ":" + (all.length ? /** @type {any} */ (all[all.length - 1]).entry.seq : 0);
    if (lastSeen.all !== all || lastSeen.key !== key || lastSeen.pages !== pages) {
      lastSeen = { all, key, pages, found: null };
      for (let i = all.length - 1; i >= 0; i--) {
        const e = /** @type {any} */ (all[i]).entry;
        if (e.kind !== "view" || e.window !== deps.window || e.place.view !== "page") continue;
        const a = addressOfPlace(e.place, idOf);
        if (a !== null && a.id !== "") { lastSeen.found = a; break; }
      }
    }
    return lastSeen.found ?? lastRoute;
  }
  /** The history as `lastPage` last walked it, so a patch a frame does not
   *  walk five thousand entries each time. @type {{ all: unknown, key: string, pages: unknown, found: Address | null }} */
  let lastSeen = { all: null, key: "", pages: null, found: null };

  /** @returns {PageName | null} */
  function besideNow() {
    const u = ui.get();
    if (agentMode(u) === "panel") return u.route.view === "page" && u.route.id !== "" ? nameOf(u.route.id) : null;
    const a = lastPage();
    return a === null ? null : nameOf(a.id);
  }

  /** @param {{ mode: "screen" | "panel", list: boolean, chat: ChatId | null, epoch: number }} want */
  function postState(want) {
    if (frame === null) return;
    const s = chats.get();
    const updates = want.chat === null ? [] : s.updates;
    uids = new Set();
    scan(updates, uids);
    const names = namesNow();
    const inputNow = input.measure();
    const beside = besideNow();
    /** @type {LookState} */
    const state = { mode: want.mode, chat: want.chat, list: want.list, chats: s.chats, updates, names, input: inputNow, beside, view: DEFAULT_VIEW };
    frame.post({ kind: "look.state", state });
    posted = want;
    queue = [];
    sentChats = chatsSig(s.chats);
    sentNames = JSON.stringify(names);
    sentInput = JSON.stringify(inputNow);
    sentBeside = JSON.stringify(beside);
  }

  /** A STATE WHEN THE SHAPE MOVED, a patch for anything else. The shape is
   *  where the look is drawn, whether its list shows, and which chat — and a
   *  chat is handed over only once its stream is read, so the look never draws
   *  a chat half there. */
  function post() {
    if (frame === null || !helloed) return;
    const u = ui.get();
    const mode = agentMode(u);
    const s = chats.get();
    const ready = u.chat === null || (s.open === u.chat && !s.loading);
    if (mode !== "none" && ready) {
      /** @type {{ mode: "screen" | "panel", list: boolean, chat: ChatId | null, epoch: number }} */
      const want = { mode: mode === "panel" ? "panel" : "screen", list: u.chatList, chat: u.chat, epoch: u.chat === null ? 0 : s.epoch };
      if (posted === null || posted.mode !== want.mode || posted.list !== want.list || posted.chat !== want.chat || posted.epoch !== want.epoch) {
        postState(want);
        return;
      }
    }
    schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    let done = false;
    const go = () => { if (done) return; done = true; flush(); };
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(go);
    // A hidden window runs no frames; a timer still flushes, throttled.
    setTimeout(go, 100);
  }

  /** ONE PATCH: what moved since the last one, and nothing else. */
  function flush() {
    scheduled = false;
    if (frame === null || !helloed || posted === null) { queue = []; return; }
    if (queue.length > PATCH_MAX) {
      // Too much to say as a patch: said whole instead, by the same rule as
      // any state, so it is never a stream the store no longer holds.
      queue = [];
      posted = null;
      post();
      return;
    }
    /** @type {{ kind: "look.patch", chat: ChatId | null, updates?: ChatUpdate[], chats?: ChatSummary[], names?: Record<string, PageName>, input?: LookInput, beside?: PageName | null }} */
    const patch = { kind: "look.patch", chat: posted.chat };
    let any = false;
    if (queue.length) { patch.updates = queue; queue = []; any = true; }
    const s = chats.get();
    const cs = chatsSig(s.chats);
    if (cs !== sentChats) { patch.chats = s.chats; sentChats = cs; any = true; }
    const names = namesNow();
    const ns = JSON.stringify(names);
    if (ns !== sentNames) { patch.names = names; sentNames = ns; any = true; }
    const inputNow = input.measure();
    const is = JSON.stringify(inputNow);
    if (is !== sentInput) { patch.input = inputNow; sentInput = is; any = true; }
    const beside = besideNow();
    const bs = JSON.stringify(beside);
    if (bs !== sentBeside) { patch.beside = beside; sentBeside = bs; any = true; }
    if (any) frame.post(patch);
  }

  chats.onUpdates((chat, updates) => {
    if (posted === null || posted.chat !== chat) return;
    for (const u of updates) queue.push(u);
    scan(updates, uids);
    schedule();
  });

  /* ── following the window ──────────────────────────────────────────── */

  /** A chat the window names that the server does not have: the start screen
   *  instead of a chat that never draws. @param {ChatId | null} chat @param {unknown} e */
  function lost(chat, e) {
    const code = e && typeof e === "object" ? /** @type {{ code?: unknown }} */ (e).code : undefined;
    if (code !== ERRORS.NOT_FOUND && code !== ERRORS.BAD_REQUEST) {
      console.warn("[biom] the chat could not be read", e);
      if (chat !== null) openFailed = { chat, at: Date.now() };
      return;
    }
    if (chat === null || ui.get().chat !== chat) return;
    if (ui.get().route.view === "agent") ui.go("agent", "");
    else ui.set({ chat: null });
  }

  /** A chat whose read failed for a reason that may pass, and when: it is
   *  not asked for again on every push, but after a pause. @type {{ chat: ChatId, at: number } | null} */
  let openFailed = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let retry = null;
  const RETRY_AFTER = 3000;

  let shownMode = "";
  function sync() {
    const u = ui.get();
    if (u.route.view === "page" && u.route.id !== "") lastRoute = u.route;
    const mode = agentMode(u);
    if (mode !== shownMode) { shownMode = mode; slot.setAttribute("data-mode", mode); }
    const threads = mode === "screen" && (u.chat !== null || u.chatList);
    slot.style.setProperty("--look-threads", (threads ? LOOK_THREADS : 0) + "px");
    slot.style.setProperty("--look-head", (mode === "panel" ? LOOK_HEAD : 0) + "px");
    // The store holds the stream of the chat this window has open.
    if (chats.get().open !== u.chat) {
      const chat = u.chat;
      const waited = openFailed !== null && openFailed.chat === chat ? Date.now() - openFailed.at : Infinity;
      if (waited >= RETRY_AFTER) {
        void chats.open(chat).then(() => { if (openFailed?.chat === chat) openFailed = null; }, (e) => lost(chat, e));
      } else if (retry === null) {
        retry = setTimeout(() => { retry = null; sync(); }, RETRY_AFTER - waited);
      }
    }
    if (mode !== "none" && html === null && !reading && Date.now() - readFailed >= RETRY_AFTER) void readLook();
    input.sync();
    post();
    chrome();
  }

  ui.on(sync);
  chats.on(sync);
  ws.on(() => schedule());
  deps.switcher?.on(() => input.sync());
  deps.history?.on(() => schedule());
  input.onMove(() => schedule());

  /* ── the panel's width ─────────────────────────────────────────────── */

  const stored = Number(remembered(PANEL_KEY, ""));
  let width = Number.isFinite(stored) && stored >= PANEL_MIN ? stored : PANEL_WIDTH;
  /** @type {{ x: number, w: number, id: number } | null} */
  let drag = null;

  function applyWidth() {
    const max = Math.max(PANEL_MIN, (win.innerWidth || 0) - PAGE_KEEPS);
    const w = Math.round(Math.max(PANEL_MIN, Math.min(width, max)));
    // What is kept is what is drawn, so an arrow held past the edge does not
    // bank width the panel cannot show.
    if (drag === null) width = w;
    slot.style.setProperty("--agent-w", w + "px");
    grip.setAttribute("aria-valuenow", String(w));
    grip.setAttribute("aria-valuemax", String(Math.round(max)));
  }
  const keepWidth = () => remember(PANEL_KEY, String(Math.round(width)));

  /** @param {PointerEvent} e */
  function dragStart(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, w: slot.getBoundingClientRect().width || width, id: e.pointerId };
    try { grip.setPointerCapture(e.pointerId); } catch { /* the grip's own events still carry it */ }
    grip.setAttribute("data-drag", "on");
    // Neither box may take the pointer while it is pulled: a pointer over an
    // iframe is the iframe's.
    document.documentElement.classList.add("agentdrag");
  }
  /** @param {PointerEvent} e */
  function dragMove(e) {
    if (drag === null) return;
    width = drag.w - (e.clientX - drag.x);
    applyWidth();
  }
  function dragStop() {
    if (drag === null) return;
    try { grip.releasePointerCapture(drag.id); } catch { /* already released */ }
    drag = null;
    grip.removeAttribute("data-drag");
    document.documentElement.classList.remove("agentdrag");
    width = slot.getBoundingClientRect().width || width;
    keepWidth();
  }
  /** @param {KeyboardEvent} e */
  function gripKey(e) {
    if (e.key === "ArrowLeft") width += PANEL_STEP;
    else if (e.key === "ArrowRight") width -= PANEL_STEP;
    else if (e.key === "Home") width = PANEL_WIDTH;
    else return;
    e.preventDefault();
    applyWidth();
    keepWidth();
  }
  win.addEventListener("resize", applyWidth);
  applyWidth();

  /* ── the host's own chrome ─────────────────────────────────────────── */

  /** @type {Set<() => void>} */
  const chromeHears = new Set();
  let chromeSig = "";

  /** @returns {AgentChrome} */
  function chromeNow() {
    const s = chats.get();
    const chat = ui.get().chat;
    return {
      busy: s.chats.filter((c) => c.light === "working").length,
      chat: chat === null ? null : s.chats.find((c) => c.id === chat) ?? null,
      chats: s.chats.length,
      active: s.agents.filter((a) => a.state === "active").length,
    };
  }

  function chrome() {
    const c = chromeNow();
    const sig = JSON.stringify([c.busy, c.chats, c.active, c.chat && [c.chat.id, c.chat.name, c.chat.light, c.chat.face]]);
    if (sig === chromeSig) return;
    chromeSig = sig;
    for (const fn of [...chromeHears]) fn();
  }

  /* ── moves ─────────────────────────────────────────────────────────── */

  /** THE CARET GOES TO THE INPUT only from the look's own box, which the person
   *  is in — never out of a page they are typing in beside the panel because
   *  the look asked, since the look's word for a click is not a wall and the
   *  input is where keystrokes reach an agent. */
  function focusFromLook() {
    const at = typeof document === "undefined" ? null : document.activeElement;
    if (frame !== null && at === frame.el) input.focus();
  }

  /** The full Agent screen, with the chat this window has open: the panel
   *  shuts first, so the window never says it is beside a page it left.
   *  @param {boolean} [fromLook] */
  function toScreen(fromLook = false) {
    const u = ui.get();
    if (u.panel) ui.set({ panel: false });
    ui.open("agent", u.chat ?? "");
    if (fromLook) focusFromLook();
    else input.focus();
  }

  sync();

  return {
    slot,

    answer(req, ctx) {
      if (ctx !== CTX) return { code: ERRORS.IDENTITY, message: "only the Agent screen's own look may ask that" };
      const u = ui.get();
      const mode = agentMode(u);
      switch (req.kind) {
        case "look.open": {
          if (chats.summary(req.chat) === null) return { code: ERRORS.NOT_FOUND, message: "there is no such chat" };
          if (u.chat !== req.chat) showChat(ui, req.chat, "open");
          focusFromLook();
          return null;
        }
        case "look.new": {
          // THE LIST IS LEFT AS IT IS: the look asks for it separately.
          if (mode === "screen") ui.open("agent", "");
          else ui.set({ chat: null });
          input.fresh();
          focusFromLook();
          return null;
        }
        case "look.list": {
          if (u.chatList !== req.open) ui.set({ chatList: req.open });
          return null;
        }
        case "look.panel": {
          if (req.to === "screen") {
            if (mode !== "screen") toScreen(true);
            return null;
          }
          if (req.to === "beside") {
            if (mode === "panel") return null;
            const a = lastPage();
            if (a === null) return { code: ERRORS.NOT_FOUND, message: "there is no page to sit beside yet" };
            ui.open(a.view, a.id, a.screen, true);
            return null;
          }
          if (u.panel) ui.set({ panel: false });
          return null;
        }
        default:
          return { code: ERRORS.UNKNOWN_KIND, message: "not something the look may ask" };
      }
    },

    open: () => toScreen(),

    edit(page) {
      ui.set({ panel: true, chat: null });
      input.prefill("Edit " + page + ": ", page);
    },

    chrome: chromeNow,

    onChrome(fn) {
      chromeHears.add(fn);
      return () => { chromeHears.delete(fn); };
    },
  };
}
