// SPDX-License-Identifier: AGPL-3.0-only
// Layer 9 — THE SWITCHER: one per window, watching the history and the
// context from above and deciding, on its own, whether an agent's write
// brings its screen up, is offered in **Go to page**, or does nothing.
//
// Nobody asks it anything. What it owes (*History and View Switcher*,
// `yours`, `switcher`, `moves`, `popups`):
//
//   - it follows an agent only while that agent's chat is open in this window
//     — on the Agent screen or in the panel — and only its WRITES, to a file a
//     screen shows; a chat in the background and a run never move the screen,
//     and when two chats write at once only the open one's is looked at;
//   - a screen is the person's when they opened it, touched it, or kept it on
//     screen `adopt` with the window in front; the person's work is the latest
//     screen in the history that is theirs;
//   - it moves when the screen is not the person's, or their last touch was
//     MORE than `idle` ago, touches before their latest message not counting;
//     otherwise it offers **Go to page**; never off a held screen; never
//     sooner than `settle` after the last move, and an edit that lands inside
//     that is followed when it ends rather than dropped;
//   - **Go back to** names the person's work while an agent has the screen;
//   - a screen becoming the person's without an open — touched, or `adopt` on
//     screen — is reported as a `claim`, once, so the history says so;
//   - A MOVE OFF THE FULL AGENT SCREEN brings the page up with the chat in
//     the panel beside it, never a bare page with the chat gone (the owner's
//     decision of 2026-09-26): every move opens the panel, because the chat it
//     follows is by definition the one open on screen or in the panel;
//   - it reads an edit's `place` off the entry and never maps a path itself.
//
// IT IS ALSO WHAT REPORTS THE CONTEXT. Every change to the address, the panel
// or the chat in it goes to the server as `window.report`, with `moved` saying
// who moved the screen — because the switcher is the one module that knows:
// `ui.cause()` says who made the move, and a claim is the switcher's own
// judgement. The reports go through the history store, which sends them one
// at a time and takes each answer into the mirror.
//
// WHOSE THE SCREEN IS IS KEPT HERE, SYNCHRONOUSLY, and the history only seeds
// it. The mirror is a round trip behind: an open reported a moment ago may not
// have come back yet, and a decision taken against the mirror alone would move
// the screen away from a page the person opened a millisecond before. So the
// window's own knowledge — who made the last move, when it was touched — is
// held here as it happens, and the history is read for two things only: on
// start, whose the screen was before a reload, and for **Go back to**, the
// person's work, which is theirs across reloads and renames because the
// history names a page by its `uid`.
//
// ITS CLOCK AND ITS TIMES ARE INJECTED AND THERE IS NO OTHER SWITCH. The
// factory takes `now`, `after` and `timing`; `client/boot.js` passes
// `Date.now`, `setTimeout` and five minutes, two minutes and five seconds, and
// a test passes its own. It reads only this window's clock — never the
// server's `at` — so Playwright's page clock fast-forwards it end to end.
// `decide` is pure, so every rule above is a row in a table of cases.

/** @import { Address, AgentId, ChatId, HistoryEntry, Move, PageId, PageRef, Place, WindowId, WindowReport } from "../../contracts/types.ts" */
/** @import { Mover, Ui } from "./ui.js" */
/** @import { HistoryStore, Received, Unanswered } from "./history.js" */

import { AGENT_PAGE, DESIGN_PAGE, MAP_PAGE } from "../../contracts/wire.js";
import { addressOfPlace, isHeld, placeOf, sameAddress, samePlace } from "../../contracts/address.js";

/** THE MARK A HOST ELEMENT WEARS TO SAY THAT WHAT HAPPENS IN IT IS NOT A
 *  TOUCH — the chat's input box above all, because typing to an agent is
 *  talking to it and not touching the page (*History and View Switcher*,
 *  `yours`). The shell's watcher skips anything inside an element carrying it.
 *  Here, below both the shell and the views, so the Agent view can put it on
 *  its input and the shell can read it without either importing the other. */
export const NOT_TOUCH = "data-no-touch";

/**
 * @typedef {object} SwitcherTiming
 * @property {number} adopt Kept on screen this long with the window in front,
 *   a screen is the person's. Five minutes.
 * @property {number} idle A touch this recent holds the screen. Two minutes.
 * @property {number} settle After a move the screen stays at least this long.
 *   Five seconds.
 */

/** Five minutes, two minutes and five seconds: the spec's three numbers.
 *  @type {Readonly<SwitcherTiming>} */
export const TIMING = Object.freeze({ adopt: 5 * 60_000, idle: 2 * 60_000, settle: 5_000 });

/** HOW LONG AN AGENT'S WRITE TO A PAGE THIS WINDOW DOES NOT KNOW IS KEPT. A
 *  page an agent has just made reaches the history with its `uid` before this
 *  window has heard of it, so the write is not dropped: its uid is asked for
 *  by name at once (`want`, which is `page.locate`), and the write is decided
 *  the moment the answer names the page — it never waits for the tree. A uid
 *  the server answers absent is asked again after the next change on disk,
 *  and a write whose page has not turned up within this is let go: a page
 *  that arrives later than this is not brought up for a write that long ago.
 *  Not one of the spec's times. */
export const UNLISTED_CAP_MS = 60_000;

/** How many of the person's newer views, whose pages this window does not
 *  know yet, one look for **Go back to** asks for by name. */
const WORK_ASKS = 16;

/**
 * One write, as the switcher looks at it: whose chat, which agent, and the
 * screen that shows what it wrote.
 * @typedef {{ chat: ChatId, agent: AgentId, to: Address }} Write
 */

/**
 * EVERYTHING ONE DECISION IS TAKEN FROM, every time on this window's clock.
 * @typedef {object} Facts
 * @property {number} now
 * @property {Write} edit
 * @property {Address} screen What is on screen.
 * @property {boolean} panel The chat panel is open beside it.
 * @property {ChatId | null} chat The chat this window has open.
 * @property {boolean} mine The screen is the person's.
 * @property {number | null} touched The person's last touch, opens included.
 * @property {number | null} sent When the person last sent a message in the
 *   open chat.
 * @property {number | null} moved When the screen last moved.
 */

/**
 * @typedef {{ kind: "move", to: Address, panel: boolean, agent: AgentId, chat: ChatId, why: string }
 *   | { kind: "offer", to: Address, chat: ChatId, why: string }
 *   | { kind: "wait", until: number, why: string }
 *   | { kind: "none", why: string }} Verdict `panel` is whether the chat's
 *   panel opens beside the page — always, since the switcher follows only a
 *   chat that is open, and a move off the full Agent screen must bring it
 *   beside the page. `wait` is an edit inside the settle after a move: taken
 *   again at `until`. `why` names the rule, for a test and for a reader.
 */

/**
 * WHAT ONE WRITE DOES TO THE SCREEN — pure, and every rule of the spec's
 * `switcher` and `moves` sections in the order they bind.
 *
 *   1. Only the open chat's writes, while it is on screen: the Agent screen,
 *      or the panel beside the page. A chat in the background, a chat whose
 *      panel is shut and a run are never followed and never offered.
 *   2. A write to what is already on screen changes nothing.
 *   3. Never off a held screen: offered instead, however long since a touch.
 *   4. The person's screen, touched in the last `idle`, stays; the write is
 *      offered. "More than two minutes ago" is what lets it move, so a touch
 *      exactly `idle` ago still holds. A touch counts only after the person's
 *      latest message — one at the same instant is the act that sent it.
 *   5. No bouncing: inside `settle` of the last move the write waits for the
 *      settle to end, and is taken again then. Exactly `settle` on, it moves.
 *   6. Otherwise it moves, with the chat in the panel beside the page.
 *
 * @param {Facts} facts
 * @param {SwitcherTiming} timing
 * @returns {Verdict}
 */
export function decide(facts, timing) {
  const { now, edit, screen } = facts;
  const open = facts.chat !== null && edit.chat === facts.chat && (screen.view === "agent" || facts.panel);
  if (!open) return { kind: "none", why: "its chat is not open in this window" };
  if (sameAddress(edit.to, screen)) return { kind: "none", why: "what it wrote is already on screen" };
  if (isHeld(screen)) return { kind: "offer", to: edit.to, chat: edit.chat, why: "the screen is held" };
  const touched = facts.touched;
  if (facts.mine && touched !== null && (facts.sent === null || touched > facts.sent) && now - touched <= timing.idle) {
    return { kind: "offer", to: edit.to, chat: edit.chat, why: "the person touched their screen too recently" };
  }
  if (facts.moved !== null && now - facts.moved < timing.settle) {
    return { kind: "wait", until: facts.moved + timing.settle, why: "the screen moved too recently" };
  }
  return { kind: "move", to: edit.to, panel: true, agent: edit.agent, chat: edit.chat, why: "the screen is the chat's to move" };
}

/**
 * WHAT A SCREEN IS CALLED, for **Go back to** and **Go to page**: a page by its
 * name as the window knows it now — the last segment of its id where it does
 * not yet — with its own screen after it; every other screen by the word the
 * rail gives it.
 * @param {Address} a
 * @param {(id: PageId) => PageRef | null} refOf the directory's lookup
 * @returns {string}
 */
export function screenName(a, refOf) {
  switch (a.view) {
    case "page": {
      const ref = refOf(a.id);
      const name = ref ? ref.name : a.id.slice(a.id.lastIndexOf("/") + 1);
      return a.screen === "instructions" ? name + " · Instructions" : a.screen === "automation" ? name + " · Automations" : name;
    }
    case "table": return a.id;
    case "design": return "Design";
    case "instructions": return "Instructions";
    case "runs": return "Automations";
    case "map": return "Map";
    case "agent": return "Agent";
    default: return "Workspaces";
  }
}

/**
 * THE BOX A SCREEN IS DRAWN IN, by the page id it was mounted on, or null for
 * a screen the host draws itself. A touch reported from a box is the person's
 * touch on THIS screen only when it came from this box — one arriving from the
 * box of the screen that was just left, or from the chat's own box in the
 * panel, is not. A page route naming a framework screen's `@` id draws no box
 * — the shell says there is no such page — so the chat's own box on `@agent`
 * is never mistaken for it.
 * @param {Address} a @returns {PageId | null}
 */
export function boxOf(a) {
  if (a.view === "page") return a.id !== "" && a.screen === "page" && !a.id.startsWith("@") ? a.id : null;
  if (a.view === "design") return DESIGN_PAGE;
  if (a.view === "map") return MAP_PAGE;
  if (a.view === "agent") return AGENT_PAGE;
  return null;
}

/**
 * @typedef {object} Named
 * @property {Address} to
 * @property {string} name
 */

/**
 * @typedef {object} SwitcherView What the screen shows because of the switcher.
 * @property {Named | null} back **Go back to**, top left: the person's work,
 *   while an agent has the screen.
 * @property {Named | null} offer **Go to page**, above the chat's input: the
 *   open chat's latest write the switcher did not bring up, while the chat is
 *   on screen.
 */

/**
 * @typedef {object} Switcher
 * @property {() => SwitcherView} get
 * @property {(fn: () => void) => () => void} on Hear the view change.
 * @property {(page?: PageId) => void} touched The person touched the screen:
 *   in a box mounted on `page`, or with no page, in the host's own screen.
 * @property {(front: boolean) => void} front The window came to the front,
 *   or left it.
 * @property {() => void} back **Go back to** was pressed.
 * @property {() => void} go **Go to page** was pressed.
 * @property {() => Promise<void>} start Read the history, and take from it
 *   whose the screen was before this window loaded.
 * @property {() => Promise<void>} resync The stream reopened: read again, and
 *   tell the server what it may have forgotten.
 */

/**
 * @typedef {object} SwitcherDeps
 * @property {Ui} ui
 * @property {HistoryStore} history
 * @property {WindowId} window This window's own id: its views are the ones
 *   **Go back to** reads.
 * @property {(id: PageId) => PageRef | null} refOf THE PAGES THIS WINDOW
 *   KNOWS, by id — the workspace store's directory: a page's uid and its name.
 * @property {(uid: string) => PageId | null} idOfUid The same, by uid: where a
 *   page the history names by identity sits now.
 * @property {(q: { ids?: readonly PageId[], uids?: readonly string[] }) => Promise<void>} [want]
 *   ASK FOR PAGES THE DIRECTORY MISSES, by id or uid — batched, deduplicated
 *   and remembered as absent by the store — resolving once the answer is in.
 *   Absent, a miss is simply a miss.
 * @property {(hear: () => void) => () => void} [onPages] Hear the directory
 *   change — the workspace store's `on` — so a write to a page it had not
 *   named is decided once it does, and a name asked for is drawn once known.
 * @property {(chat: ChatId) => number | null} [lastSent] When the person last
 *   sent a message in that chat, BY THIS WINDOW'S CLOCK, or null. The chat
 *   store's; absent, no message has ever been sent.
 * @property {() => number} now
 * @property {SwitcherTiming} timing
 * @property {(ms: number, fn: () => void) => () => void} [after] A timer,
 *   answering its cancel. `setTimeout` when absent.
 * @property {boolean} [front] Whether the window is in front when this is
 *   built. True when absent; `front()` says when it changes.
 */

/**
 * ONE SCREEN AS THE SWITCHER HOLDS IT: where, whose, and — for a screen the
 * switcher brought up — which agent it followed, so a lost report can be
 * said again. `shown` and `since` time how long it has been on screen with the
 * window in front, which is what `adopt` counts.
 * @typedef {object} Screen
 * @property {Address} address
 * @property {Place | null} place Where it was when it went up, by `uid` — read
 *   then, because a rename re-lists the tree before the route is re-pointed,
 *   and the old id names nothing by the time the move is heard.
 * @property {boolean} mine
 * @property {{ agent: AgentId, chat: ChatId } | null} by
 * @property {number} shown Time in front banked before `since`.
 * @property {number | null} since In front since then, or null while not.
 */

/**
 * @param {SwitcherDeps} deps
 * @returns {Switcher}
 */
export function makeSwitcher(deps) {
  const { ui, history, now, timing } = deps;
  const after = deps.after ?? ((ms, fn) => {
    const t = setTimeout(fn, Math.max(0, ms));
    return () => clearTimeout(t);
  });
  const lastSent = deps.lastSent ?? (() => null);

  /** @type {Set<() => void>} */
  const hears = new Set();
  let front = deps.front !== false;

  /** THE DIRECTORY, FOR A UID: a page's id now, and a page's uid — map
   *  lookups in the store, never a walk of every page, so a history loop over
   *  thousands of entries stays a loop over entries. @param {string} uid */
  const idOf = (uid) => deps.idOfUid(uid);
  /** @param {PageId} id */
  const uidOf = (id) => deps.refOf(id)?.uid ?? null;
  /** Ask for what the directory misses; never throws. @param {{ ids?: PageId[], uids?: string[] }} q */
  const want = (q) => (deps.want ? deps.want(q).catch(() => {}) : Promise.resolve());

  /** @param {Address} address @param {boolean} mine @param {Screen["by"]} by @returns {Screen} */
  const fresh = (address, mine, by) => ({ address, place: placeOf(address, uidOf), mine, by, shown: 0, since: front ? now() : null });

  /** THE SCREEN AT BUILD TIME is the person's until the history says
   *  otherwise: a window that has just loaded is where somebody put it. */
  let screen = fresh(ui.get().route, true, null);
  /** The move this switcher last took account of. */
  let seq = ui.cause().seq;
  const built = seq;
  /** The last touch, opens included. @type {number | null} */
  let touched = null;
  /** When the screen last moved. A window loading is not a move: nobody moved
   *  anything, and a write a moment after a reload is not a bounce.
   *  @type {number | null} */
  let moved = null;
  /** Go to page. @type {{ to: Address, chat: ChatId } | null} */
  let offer = null;
  /** An edit waiting out the settle. @type {(() => void) | null} */
  let waiting = null;
  /** The open chat's latest write to a page this window does not know yet,
   *  and when this window got it. @type {{ chat: ChatId, agent: AgentId, place: Place, got: number } | null} */
  let unlisted = null;
  /** The adopt timer. @type {(() => void) | null} */
  let adopting = null;
  /** The context the server was last told. @type {WindowReport | null} */
  let told = null;
  let started = false;
  /** What `get()` last answered, so listeners hear a change and not a repaint. */
  let shown = "";

  /* ── one place ───────────────────────────────────────────────────────── */

  /** Whether an address is the screen's own place: the same page by `uid` —
   *  so a rename is not a move — and anything else by its address. The screen's
   *  uid is the one it went up with, or read now if the tree had not got it
   *  then. @param {Screen} s @param {Address} b */
  function onePlace(s, b) {
    const pa = s.place ?? placeOf(s.address, uidOf);
    const pb = placeOf(b, uidOf);
    return pa !== null && pb !== null ? samePlace(pa, pb) : sameAddress(s.address, b);
  }

  /* ── telling ─────────────────────────────────────────────────────────── */

  function tell() {
    const v = view();
    const key = JSON.stringify([v.back, v.offer]);
    if (key === shown) return;
    shown = key;
    for (const hear of [...hears]) {
      try {
        hear();
      } catch (e) {
        console.warn("a switcher listener threw", e);
      }
    }
  }

  /** @returns {WindowReport} */
  function context() {
    const u = ui.get();
    // `agent` is the server's to derive from the chat; what is sent is ignored.
    return { address: u.route, panel: u.panel, chat: u.chat, agent: null };
  }

  /** Say the context, and who moved the screen when somebody did.
   *  @param {Move} [move] */
  function report(move) {
    told = context();
    void history.report(told, move);
  }

  /** @param {WindowReport} a @param {WindowReport} b */
  const sameContext = (a, b) => sameAddress(a.address, b.address) && a.panel === b.panel && a.chat === b.chat;

  /* ── whose the screen is ─────────────────────────────────────────────── */

  /** Time in front on this screen so far. */
  const inFront = () => screen.shown + (screen.since !== null ? now() - screen.since : 0);

  /** THE SCREEN BECOMES THE PERSON'S without an open, and the history is told
   *  once — the flag is what makes a second touch, or the timer landing in the
   *  same tick, say nothing. */
  function claim() {
    if (screen.mine) return;
    screen.mine = true;
    screen.by = null;
    stopAdopting();
    report({ by: "claim" });
    tell();
  }

  function stopAdopting() {
    if (adopting !== null) { adopting(); adopting = null; }
  }

  /** Time the screen to `adopt`: only one that is not the person's, only with
   *  the window in front, and from what it has already had. */
  function adopt() {
    stopAdopting();
    if (screen.mine || !front) return;
    const left = timing.adopt - inFront();
    if (left <= 0) { claim(); return; }
    adopting = after(left, () => { adopting = null; adopt(); });
  }

  /** A claim that is due lands before anything is decided on it, however
   *  late a timer is. */
  function due() {
    if (!screen.mine && front && inFront() >= timing.adopt) claim();
  }

  /* ── the context moving ──────────────────────────────────────────────── */

  function changed() {
    const c = ui.cause();
    if (c.seq !== seq) {
      seq = c.seq;
      took(c.mover);
    } else if (told === null || !sameContext(context(), told)) {
      report();
    }
    tell();
  }

  /** A MOVE, by whoever made it. @param {Mover} mover */
  function took(mover) {
    const t = now();
    const route = ui.get().route;
    const was = screen;
    if (mover.by === "you") {
      // AN OPEN IS A TOUCH: the person's latest move is never moved against,
      // and a page opened a second ago is theirs to read.
      screen = fresh(route, true, null);
      touched = t;
      moved = t;
      if (offer !== null && sameAddress(offer.to, route)) offer = null;
      report({ by: "you" });
    } else if (mover.by === "switcher") {
      screen = fresh(route, false, { agent: mover.agent, chat: mover.chat });
      moved = t;
      // The latest write is on screen now; an older one waiting in Go to page
      // is not what the chat is doing any more.
      offer = null;
      report({ by: "switcher", agent: mover.agent, chat: mover.chat });
    } else if (onePlace(was, route)) {
      // THE SAME PLACE UNDER ANOTHER ID — a rename or a move re-pointing the
      // route. Nobody moved the screen, so whose it is does not change.
      screen = { ...was, address: route, place: was.place ?? placeOf(route, uidOf) };
      report();
    } else {
      // THE SYSTEM PUT A DIFFERENT SCREEN UP — a delete leaving, a cold start
      // landing, a workspace that did not open. Each is the consequence of
      // something the person did in this window, and nothing brought it up
      // for an agent, so it is theirs, and the history is told so.
      screen = fresh(route, true, null);
      moved = t;
      report({ by: "claim" });
    }
    adopt();
  }

  /* ── an edit ─────────────────────────────────────────────────────────── */

  /** @param {Write} edit @returns {Facts} */
  function factsOf(edit) {
    const u = ui.get();
    return {
      now: now(),
      edit,
      screen: u.route,
      panel: u.panel,
      chat: u.chat,
      mine: screen.mine,
      touched,
      sent: u.chat === null ? null : lastSent(u.chat),
      moved,
    };
  }

  /** @param {Write} edit */
  function consider(edit) {
    if (waiting !== null) { waiting(); waiting = null; }
    due();
    const v = decide(factsOf(edit), timing);
    switch (v.kind) {
      case "move":
        // THE BACK STACK: the person's own screen keeps its entry and the
        // switcher's replaces one of its own, so Back from anything it brought
        // up lands on the person's work and never walks through its moves.
        ui.follow(v.to, { agent: v.agent, chat: v.chat }, !screen.mine);
        return;
      case "offer":
        offer = { to: v.to, chat: v.chat };
        tell();
        return;
      case "wait":
        waiting = after(v.until - now(), () => { waiting = null; consider(edit); });
        return;
      default:
        return;
    }
  }

  /** THE OPEN CHAT'S LATEST WRITE IN A BATCH, if there is one a screen shows.
   *  Only live entries — one read back after a reload happened minutes ago —
   *  and only the open chat's, so a background chat writing in the same batch
   *  can never stand in front of it.
   *
   *  A WRITE TO A PAGE THIS WINDOW DOES NOT KNOW is still that write: a page
   *  the agent has just made is in the history, uid and all, before this
   *  window has heard of it. Its uid is asked for by name at once, and the
   *  write is kept — the latest one, a newer write of the chat's replacing
   *  it — and decided by `listed` the moment the answer names the page, as if
   *  it had been named on arrival. It never waits for the tree.
   *  @param {readonly Received[]} added */
  function heard(added) {
    const chat = ui.get().chat;
    if (chat !== null) {
      for (let i = added.length - 1; i >= 0; i--) {
        const r = /** @type {Received} */ (added[i]);
        const e = r.entry;
        if (!r.live || e.kind !== "edit" || e.writer.kind !== "agent" || e.place === null) continue;
        if (e.writer.chat !== chat) continue;
        const to = addressOfPlace(e.place, idOf);
        if (to === null) {
          unlisted = { chat: e.writer.chat, agent: e.writer.agent, place: e.place, got: r.got };
          if (e.place.view === "page") void want({ uids: [e.place.uid] });
          break;
        }
        unlisted = null;
        consider({ chat: e.writer.chat, agent: e.writer.agent, to });
        break;
      }
    }
    tell();
  }

  /** THE DIRECTORY CHANGED: a write kept for a page it did not name is
   *  decided the moment it does, with every rule as it stands — a touch since,
   *  a held screen, the settle — or asked for again (the store asks nothing
   *  for a uid it was just told is absent, until a change on disk), and let go
   *  past `UNLISTED_CAP_MS`. And the names on Go back to and Go to page are
   *  drawn again, since a name asked for may have landed. */
  function listed() {
    if (unlisted !== null) {
      const u = unlisted;
      if (now() - u.got > UNLISTED_CAP_MS) unlisted = null;
      else {
        const to = addressOfPlace(u.place, idOf);
        if (to !== null) {
          unlisted = null;
          consider({ chat: u.chat, agent: u.agent, to });
        } else if (u.place.view === "page") void want({ uids: [u.place.uid] });
      }
    }
    tell();
  }

  /* ── the two pop-ups ─────────────────────────────────────────────────── */

  /** THIS WINDOW'S LATEST VIEW in the history, read back.
   *  @returns {Extract<HistoryEntry, { kind: "view" }> | null} */
  function latestView() {
    const all = history.get();
    for (let i = all.length - 1; i >= 0; i--) {
      const e = /** @type {Received} */ (all[i]).entry;
      if (e.kind === "view" && e.window === deps.window) return e;
    }
    return null;
  }

  /** THE PERSON'S WORK, while the screen is not theirs: the latest screen in
   *  the history that is — reports still in flight first, then this window's
   *  views, newest first, skipping every one the switcher brought up and every
   *  page since deleted. The person standing on it already is nothing to go
   *  back to. @returns {Address | null} */
  function work() {
    if (screen.mine) return null;
    const here = ui.get().route;
    const flying = history.unanswered();
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = /** @type {Unanswered} */ (flying[i]);
      if (f.moved.by === "switcher") continue;
      return sameAddress(f.context.address, here) ? null : f.context.address;
    }
    const all = history.get();
    /** Newer views of the person's whose pages this window does not know yet:
     *  asked for by uid, and the answer is one more look. @type {string[]} */
    const unknown = [];
    /** @type {Address | null} */
    let found = null;
    for (let i = all.length - 1; i >= 0; i--) {
      const e = /** @type {Received} */ (all[i]).entry;
      if (e.kind !== "view" || e.window !== deps.window || e.writer.kind !== "you") continue;
      const a = addressOfPlace(e.place, idOf);
      if (a === null) {
        if (e.place.view === "page" && unknown.length < WORK_ASKS) unknown.push(e.place.uid);
        continue;
      }
      found = a;
      break;
    }
    if (unknown.length) void want({ uids: unknown });
    return found === null || sameAddress(found, here) ? null : found;
  }

  /** @returns {SwitcherView} */
  function view() {
    const back = work();
    const u = ui.get();
    const offered = offer !== null && offer.chat === u.chat && (u.route.view === "agent" || u.panel) && !sameAddress(offer.to, u.route)
      ? offer.to : null;
    // A NAME THE DIRECTORY LACKS reads as its segment until it is asked for
    // and lands — one more look, through `listed`.
    const nameless = [back, offered].filter((a) => a !== null && a.view === "page" && deps.refOf(a.id) === null).map((a) => /** @type {Address} */ (a).id);
    if (nameless.length) void want({ ids: nameless });
    return {
      back: back === null ? null : { to: back, name: screenName(back, deps.refOf) },
      offer: offered === null ? null : { to: offered, name: screenName(offered, deps.refOf) },
    };
  }

  /** THE PAGES A DECISION ABOUT THE SCREEN READS, asked for where this window
   *  does not know them — the route's own page and the history's latest view
   *  of this window — and waited for, so a reload decides against the page it
   *  is on and not against a miss. @param {Place | null | undefined} place */
  async function learn(place) {
    const route = ui.get().route;
    const ids = route.view === "page" && route.id !== "" && deps.refOf(route.id) === null ? [route.id] : [];
    const uids = place && place.view === "page" && idOf(place.uid) === null ? [place.uid] : [];
    if (ids.length || uids.length) await want({ ids, uids });
  }

  /* ── wiring ──────────────────────────────────────────────────────────── */

  ui.on(changed);
  history.on(heard);
  deps.onPages?.(listed);

  return {
    get: view,

    on(fn) {
      hears.add(fn);
      return () => { hears.delete(fn); };
    },

    touched(page) {
      const route = ui.get().route;
      // THE AGENT SCREEN IS THE CHAT, and nothing done in a chat — scrolling
      // it, typing to it — is a touch of the screen: that is talking to the
      // agent. And a touch from a box that is not this screen's — the chat's
      // own box in the panel, or the page just left still saying what
      // happened a moment before the move — is nobody's touch of this one.
      if (route.view === "agent") return;
      if (page !== undefined && page !== boxOf(route)) return;
      touched = now();
      if (!screen.mine) claim();
    },

    front(on) {
      if (on === front) return;
      const t = now();
      if (!on && screen.since !== null) { screen.shown += t - screen.since; screen.since = null; }
      if (on) screen.since = t;
      front = on;
      adopt();
    },

    back() {
      const to = work();
      if (to !== null) ui.open(to.view, to.id, to.screen);
    },

    go() {
      const v = view().offer;
      if (v === null) return;
      offer = null;
      // From the full Agent screen the page comes up with the chat beside it,
      // as a move would bring it: the person was in the chat and still is.
      ui.open(v.to.view, v.to.id, v.to.screen, ui.get().route.view === "agent");
    },

    async start() {
      if (started) return;
      await history.catchUp();
      started = true;
      // The route's page and this window's latest view, known before anything
      // is decided from them; a screen that went up before either has its uid.
      await learn(latestView()?.place);
      if (screen.place === null) screen.place = placeOf(screen.address, uidOf);
      // ONLY IF NOTHING HAS HAPPENED SINCE THE WINDOW LOADED. A move or a
      // touch since then said whose the screen is, and it is newer than
      // anything the history holds.
      if (ui.cause().seq === built && touched === null) {
        const v = latestView();
        const here = ui.get().route;
        const at = v === null ? null : addressOfPlace(v.place, idOf);
        if (v !== null && at !== null && sameAddress(at, here)) {
          // A RELOAD: the screen is whose it was — the agent's too, so a
          // reload in the middle of an agent's screen keeps Go back to.
          screen.mine = v.writer.kind === "you";
          screen.by = v.writer.kind === "agent" ? { agent: v.writer.agent, chat: v.writer.chat } : null;
          report();
        } else {
          // A NEW WINDOW, or an address the history has not got for this one:
          // somebody put it here themselves.
          screen.mine = true;
          screen.by = null;
          report({ by: "claim" });
        }
        adopt();
      } else if (told === null) {
        report();
      }
      tell();
    },

    async resync() {
      if (!started) return;
      await history.catchUp();
      // THE SERVER FORGETS A WINDOW WHOSE STREAM CLOSED, so the context is
      // said again whatever else is true — and where the history no longer
      // has this screen as this window has it (a server that restarted, a
      // report lost on the way), whose it is is said again too.
      await learn(latestView()?.place);
      const v = latestView();
      const here = ui.get().route;
      const at = v === null ? null : addressOfPlace(v.place, idOf);
      const agrees = v !== null && at !== null && sameAddress(at, here) && (v.writer.kind === "you") === screen.mine;
      if (agrees) report();
      else if (screen.mine) report({ by: "claim" });
      else if (screen.by !== null) report({ by: "switcher", agent: screen.by.agent, chat: screen.by.chat });
      else report();
      tell();
    },
  };
}
