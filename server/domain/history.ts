// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE HISTORY: what each window opened and had on screen, what
// changed in the workspace and who changed it. One per mounted workspace, in
// memory, gone when the server stops, and nothing in it is saved or committed.
//
// It records and it answers; it decides nothing. Nobody asks it anything
// either: agents, runs and the person write, it records each write Biom can
// see, and the switcher in each window reads it from above
// (*History and View Switcher*, `log`, `context`, `door`, `yours`).
//
// WHERE ITS LINES COME FROM, and there are exactly two doors in:
//
//   - `edit`, called by the API route once per write a window made through
//     the app (`you`, `app`), by what the request named — and by the chats'
//     `onEdit` for an agent's write (`agent`, `fs`/`tool`/`shell`), by path.
//     Nothing else calls it: the file watcher sees writes nobody can name and
//     is NOT a source, and the framework writing for itself — the markdown
//     mirror, the editors' one commit — is nobody's change;
//   - `report`, a window saying what it has open, which appends an open and a
//     view when the person moved the screen, a view under an agent when the
//     switcher did, and a view by the person alone for a `claim`.
//
// ONE ORDER. Both doors resolve a page's `uid` off the disk before they can
// append, and a lookup may finish out of turn; so each call takes its place
// in the order it was MADE — the lookup starts at once, the append waits its
// turn — and `seq` is that order. Every decision that depends on what came
// before (typing coalesced, one agent write reported twice, a claim already
// true) is taken at call time too, against state kept in call order, so a
// lookup in flight can never make two calls disagree about which came first.
//
// WHAT IT KEEPS IS BOUNDED, every part of it: the entries are a ring of
// `LIMIT`, the oldest dropped first — a reader that fell behind sees the gap in
// `seq` — the memory coalescing needs is a small LRU, and a window's context
// lives while its stream is open (`attach`) and goes when the last one closes,
// with a cap under that for a window that reported and never opened one.

import type {
  Address, AgentId, ChatId, EditVia, HistoryEntry, HistoryRead, Move, PageId, Place, WindowContext, WindowId, WindowReport, Writer,
} from "../../contracts/types.ts";
import { address, formatAddress, normalAddress, placeOf } from "../../contracts/address.js";

/** HOW MANY ENTRIES ARE KEPT: five thousand. An entry is a couple of hundred
 *  bytes, so the ring is about a megabyte — and a window catching up reads all
 *  of it once, on open, so that is also the largest answer `history.read`
 *  gives. Five thousand is days of ordinary work: typing is one entry per burst
 *  per file, a navigation two, an agent's edit one. What reads the far end is
 *  **Go back to**, looking for the person's last screen of their own, and a
 *  person with none in five thousand lines has been away from the keys a long
 *  while. */
const LIMIT = 5000;

/** ONE BURST OF TYPING IS ONE EDIT. A slot saves after every 350 ms pause, so
 *  a paragraph typed is dozens of writes. A keystroke's save — a write its
 *  caller marks `burst` — by the same writer, to the same file, within two
 *  seconds of that writer's last write there, with nobody else's edit to that
 *  screen in between, is the same edit and appends nothing. The window slides:
 *  somebody who never pauses for two seconds is one burst, which is what keeps
 *  a morning's typing from flushing a day's agent edits out of the ring. Only
 *  a burst coalesces, and only INTO what came before it: a page made and then
 *  removed is two things somebody did, and so are two edits by an agent. */
const COALESCE_MS = 2000;

/** ONE AGENT WRITE, SEEN TWICE. An agent's edit tool asks Biom to write the
 *  file (`fs/write_text_file`, which Biom carries out) and then reports the
 *  tool call complete with the same path (`tool`). The chats report each write
 *  once, and this is the guard under that: a `tool` report IS the `fs` write it
 *  follows when it is the same agent, in the same turn, to the same file, that
 *  write is still the latest edit of its screen, it has not been paired yet,
 *  and it was within ten seconds. Every clause narrows it, because the failure
 *  the other way — a real second edit dropped — costs the switcher a page it
 *  should have followed, where a duplicate costs it nothing it had not already
 *  done. */
const SAME_WRITE_MS = 10_000;

/** How many screens coalescing and pairing remember, the most recently
 *  written. Each only has to outlive the ten seconds above. */
const TARGETS = 1024;

/** How many windows' contexts are held, streams open or not. A context goes
 *  when its window's last stream closes; this is the floor under a window that
 *  reported and never opened one, or reported after its stream had gone. */
const CONTEXTS = 256;

/** How many agents' latest writers are remembered, to name the switcher's
 *  views. */
const AGENTS = 256;

/** HOW LONG A PAGE'S `uid` MAY TAKE before the line goes in without it. The
 *  app's own write waits on its edit, and every append waits on the one before
 *  it, so a lookup that never answered would hold every write in the workspace
 *  with it. Reading one small file is milliseconds; five seconds is a disk, or
 *  a lookup, that has gone wrong, and a place left null is the cheaper loss. */
const PATIENCE_MS = 5000;

/** What the history is handed. */
export interface HistoryDeps {
  now: () => number;
  /** A page's `uid` by its id; null where it has none or is not there.
   *  READ OFF A `Files` WITH NO BASELINE — `makeFiles(root)`, never the vault's
   *  own — because a read through the vault's makes the path KNOWN, and the
   *  watcher then takes a page an agent has just made for one it already had:
   *  the rail never learns that it arrived. */
  uidOf: (page: PageId) => Promise<string | null>;
  /** The agent running for a chat, with its harness and turn: to derive a
   *  report's `agent`, and to name a switcher's view when the history holds no
   *  edit of that agent's to name it by. Null for a chat running none. */
  agentOfChat: (chat: ChatId) => { agent: AgentId; harness: string; turn: number } | null;
  /** How many entries are kept; `LIMIT` when absent. */
  limit?: number;
  /** How long a `uid` may take to read; `PATIENCE_MS` when absent. */
  patience?: number;
}

/** ONE WRITE, AS THE HISTORY IS TOLD IT. `path` is vault-relative and
 *  forward-slashed — a backslash is read as a separator, and a path that is
 *  absolute or climbs out of the vault is not an edit — or null for a write
 *  that is no file. `place` is the screen that shows it, where the caller knows
 *  that better than the path does: a table's, for its schema or its rows.
 *  Absent, it is the address table's answer for the path. A write naming
 *  neither is not recorded. `burst` marks a keystroke's save, which coalesces
 *  with the same writer's last write to that file (`COALESCE_MS`); absent, the
 *  write is one edit of its own. */
export interface EditReport {
  path: string | null;
  place?: Place | null;
  via: EditVia;
  writer: Writer;
  burst?: boolean;
}

export interface History {
  /** A window's report. Its context is kept — `agent` derived from `chat`, and
   *  whatever the window sent there ignored — and, when the screen moved, an
   *  open and a view appended for the person, a view under the agent for the
   *  switcher, and a view by the person for a `claim`, unless the window's
   *  latest view is already theirs at that address. Answers what it appended. */
  report(window: WindowId, context: WindowReport, moved?: Move): Promise<HistoryEntry[]>;
  /** A window's stream opened. Its context is answered by `windows` while at
   *  least one is open and forgotten when the last one closes — which is what
   *  the answer, called on close, does. Calling that answer twice is once. */
  attach(window: WindowId): () => void;
  /** Drop a window's context now, whatever streams it has. */
  forget(window: WindowId): void;
  /** A write Biom saw. Null where nothing was appended: a keystroke's save in
   *  a burst already recorded, the same agent write reported twice, or a write
   *  naming nothing in the vault. */
  edit(write: EditReport): Promise<HistoryEntry | null>;
  /** The place a vault-relative path is shown at, exactly as an edit of it
   *  would record it now — the address table, and a page's `uid` looked up —
   *  for a reader that has to agree with the history: a turn's `changed`. */
  placeOf(path: string): Promise<Place | null>;
  /** The entries after `since` (a `seq`, exclusive), or every one still held. */
  read(since?: number): HistoryRead;
  /** Every window with a stream open that has said what it has open, the most
   *  recently heard first. */
  windows(): WindowContext[];
  /** WHAT ONE WINDOW LAST SAID IT HAS OPEN, kept the moment its report
   *  arrived — before the report's lookups land — and whether or not a
   *  stream of its is open, because the one asking is that window, plainly
   *  there: the page a message it sent goes with. Null for a window never
   *  heard from, or forgotten. */
  contextOf(window: WindowId): WindowContext | null;
  /** Hear every batch appended — each entry exactly once, in `seq` order.
   *  Answers the unsubscribe. */
  on(fn: (entries: HistoryEntry[]) => void): () => void;
}

type AgentWriter = Extract<Writer, { kind: "agent" }>;

/** What coalescing and pairing remember about one screen: who last wrote it,
 *  how, which file, when, and whether that `fs` write has met its `tool`. */
interface Last {
  writer: string;
  via: EditVia;
  path: string | null;
  at: number;
  paired: boolean;
}

/** A writer as a key: the window, the agent in its turn, the run. */
function writerKey(w: Writer): string {
  switch (w.kind) {
    case "you":
      return `you:${w.window}`;
    case "agent":
      return `agent:${w.agent}:${w.turn}`;
    case "run":
      return `run:${w.session}`;
  }
}

/** A place as a key. */
function placeKey(p: Place): string {
  return p.view === "page" ? `page:${p.uid}:${p.screen}` : `${p.view}:${p.id}`;
}

/** Most recently used last; the oldest goes past the cap. */
function touch<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > cap) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
}

/** AN ENTRY OF ITS OWN, frozen: copied rather than kept, because a caller may
 *  go on using the writer or the place it handed in, and frozen because a
 *  reader that changed one would be rewriting what every other reader was
 *  told. */
function sealed(e: HistoryEntry): HistoryEntry {
  const writer = Object.freeze({ ...e.writer });
  if (e.kind === "edit") {
    return Object.freeze({ ...e, writer, place: e.place === null ? null : Object.freeze({ ...e.place }) });
  }
  return Object.freeze({ ...e, writer, place: Object.freeze({ ...e.place }) });
}

export function makeHistory(deps: HistoryDeps): History {
  const limit = typeof deps.limit === "number" && deps.limit >= 1 ? Math.floor(deps.limit) : LIMIT;
  const patience = typeof deps.patience === "number" && deps.patience >= 0 ? deps.patience : PATIENCE_MS;

  const ring: HistoryEntry[] = [];
  let head = 0;
  const listeners = new Set<(entries: HistoryEntry[]) => void>();

  /** Contexts in the order they were last heard, the oldest first. */
  const contexts = new Map<WindowId, WindowContext>();
  /** Each window's open streams, a token each. */
  const attached = new Map<WindowId, Set<object>>();
  /** Each window's latest view as it was decided, for `claim`. */
  const lastView = new Map<WindowId, { address: Address; yours: boolean }>();
  /** Coalescing and pairing, per screen, in call order. */
  const targets = new Map<string, Last>();
  /** Each agent's writer as of its latest edit, to name a switcher's view. */
  const lastAgent = new Map<AgentId, AgentWriter>();

  /** THE ORDER CALLS ARE MADE IN. Each append waits on the one before it, and
   *  one that fails does not hold up the next. */
  let tail: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const append = (made: HistoryEntry[]): HistoryEntry[] => {
    if (made.length === 0) return made;
    const out = made.map((e) => sealed({ ...e, seq: ++head }));
    ring.push(...out);
    if (ring.length > limit) ring.splice(0, ring.length - limit);
    for (const fn of [...listeners]) {
      try {
        fn(out);
      } catch (e) {
        // One reader failing is that reader's problem, and the next still hears.
        console.warn("a history listener", e);
      }
    }
    return out;
  };

  /** An address as the history keeps it: a page by its `uid`, looked up now. */
  const placeFor = async (a: Address | null): Promise<Place | null> => {
    if (a === null) return null;
    if (a.view !== "page") return placeOf(a, () => null);
    if (a.id === "") return null;
    let uid: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((done) => { timer = setTimeout(() => done(null), patience); });
    try {
      uid = await Promise.race([deps.uidOf(a.id), late]);
    } catch {
      uid = null;
    } finally {
      clearTimeout(timer);
    }
    const found = typeof uid === "string" && uid !== "" ? uid : null;
    return placeOf(a, () => found);
  };

  const agentOfChat = (chat: ChatId): { agent: AgentId; harness: string; turn: number } | null => {
    try {
      return deps.agentOfChat(chat);
    } catch {
      return null;
    }
  };

  /** THE WRITER OF A SWITCHER'S VIEW: the agent it followed, as that agent's
   *  latest edit named it — an edit is what the switcher follows — and failing
   *  that the chat's agent now, when it is the same one. Null when neither
   *  names that agent in that chat, and then the view is not appended: a view
   *  under an agent nobody can name is a line no reader can place. */
  const followed = (agent: AgentId, chat: ChatId): AgentWriter | null => {
    const was = lastAgent.get(agent);
    if (was !== undefined && was.chat === chat) return was;
    const now = agentOfChat(chat);
    if (now !== null && now.agent === agent) return { kind: "agent", agent, chat, harness: now.harness, turn: now.turn };
    return null;
  };

  const forget = (window: WindowId): void => {
    attached.delete(window);
    contexts.delete(window);
    lastView.delete(window);
  };

  return {
    report(window, context, moved) {
      const at = deps.now();
      const where = normalAddress(context.address);
      const shown: Address = Object.freeze({ view: where.view, id: where.id, screen: where.screen });
      const chat = context.chat ?? null;
      const agent = chat === null ? null : agentOfChat(chat)?.agent ?? null;
      // Deleted first, so the map's order is the order windows were last heard.
      contexts.delete(window);
      contexts.set(window, Object.freeze({ window, address: shown, panel: context.panel === true, chat, agent, at }));
      // THE CAP, OLDEST FIRST, and never a window with a stream open — those go
      // when their stream does — nor the one reporting now.
      if (contexts.size > CONTEXTS) {
        for (const w of [...contexts.keys()]) {
          if (contexts.size <= CONTEXTS) break;
          if (attached.has(w) || w === window) continue;
          contexts.delete(w);
          lastView.delete(w);
        }
      }

      if (moved === undefined) return Promise.resolve([]);
      let writer: Writer;
      let kinds: readonly ("open" | "view")[];
      if (moved.by === "you") {
        writer = { kind: "you", window };
        kinds = ["open", "view"];
      } else if (moved.by === "claim") {
        const was = lastView.get(window);
        if (was !== undefined && was.yours && was.address.view === shown.view && was.address.id === shown.id && was.address.screen === shown.screen) {
          return Promise.resolve([]);
        }
        writer = { kind: "you", window };
        kinds = ["view"];
      } else {
        const by = followed(moved.agent, moved.chat);
        if (by === null) return Promise.resolve([]);
        writer = by;
        kinds = ["view"];
      }
      lastView.set(window, { address: shown, yours: writer.kind === "you" });

      const place = placeFor(shown);
      return inOrder(async () => {
        const p = await place;
        // AN ADDRESS THAT NAMES NO PLACE IS NOT RECORDED — a page with no
        // `uid`, or one that is not there — because a line naming nothing is
        // a line no reader can do anything with.
        if (p === null) return [];
        return append(kinds.map((kind): HistoryEntry => ({ kind, seq: 0, at, window, place: p, writer })));
      });
    },

    attach(window) {
      const token = {};
      let open = attached.get(window);
      if (open === undefined) {
        open = new Set();
        attached.set(window, open);
      }
      open.add(token);
      return () => {
        const now = attached.get(window);
        // A token of a set `forget` already dropped, or one already spent,
        // says nothing about the streams open now.
        if (now === undefined || !now.delete(token)) return;
        if (now.size === 0) forget(window);
      };
    },

    forget,

    edit(write) {
      const path = write.path === null ? null : normalPath(write.path);
      // A PATH THAT IS NOT IN THE VAULT IS NOT AN EDIT, and neither is a write
      // that names nothing at all.
      if (write.path !== null && path === null) return Promise.resolve(null);
      const given = write.place ?? null;
      if (path === null && given === null) return Promise.resolve(null);

      const shown = given === null && path !== null ? addressOfPath(path) : null;
      const key = given !== null ? placeKey(given) : shown !== null ? `@${formatAddress(shown)}` : `/${path}`;
      const who = writerKey(write.writer);
      const at = deps.now();

      const was = targets.get(key);
      if (was !== undefined && was.writer === who && was.path === path) {
        if (write.burst === true && was.via === write.via && at - was.at <= COALESCE_MS) {
          was.at = at;
          touch(targets, key, was, TARGETS);
          return Promise.resolve(null);
        }
        if (write.via === "tool" && was.via === "fs" && !was.paired && at - was.at <= SAME_WRITE_MS) {
          was.paired = true;
          return Promise.resolve(null);
        }
      }
      touch(targets, key, { writer: who, via: write.via, path, at, paired: false }, TARGETS);
      const writer: Writer = { ...write.writer };
      if (writer.kind === "agent") touch(lastAgent, writer.agent, writer, AGENTS);

      const via = write.via;
      const place = given !== null ? Promise.resolve(given) : placeFor(shown);
      return inOrder(async () => {
        const p = await place;
        const [entry] = append([{ kind: "edit", seq: 0, at, place: p, path, writer, via, snapshot: null }]);
        return entry ?? null;
      });
    },

    placeOf(path) {
      const rel = normalPath(path);
      return rel === null ? Promise.resolve(null) : placeFor(addressOfPath(rel));
    },

    read(since) {
      const from = typeof since === "number" && Number.isFinite(since) ? Math.floor(since) : 0;
      const first = ring[0]?.seq ?? head + 1;
      return { entries: ring.slice(Math.max(0, from - first + 1)), head };
    },

    windows() {
      return [...contexts.values()].filter((c) => attached.has(c.window)).sort((a, b) => b.at - a.at);
    },

    contextOf(window) {
      return contexts.get(window) ?? null;
    },

    on(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

/* ── the address table ─────────────────────────────────────────────────── */

/** ONE SEGMENT of a page id, and the two words the page tree is laid out
 *  with, as `pages.ts` writes them. Repeated here for the reason `mirror.ts`
 *  repeats them: this module turns a real path into a page id, `pages.ts` is a
 *  sibling it may not import, and a name that is not a legal segment is not a
 *  page. `tests/history.test.ts` holds the walk equal to `pageDir` and to
 *  `pageAt`. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PAGES_DIR = "pages";
const CHILDREN = "children";
/** The design doc's folder, beside `pages/`. */
const DESIGN_DIR = "design";
/** A page's own instructions, and the workspace's at the root. */
const INSTRUCTIONS = "INSTRUCTIONS.md";
/** A page's automations, a folder each. */
const AUTOMATIONS = "automations";
/** The workspace's skills: `.agents/skills/<name>/…`. */
const SKILLS = ".agents/skills";

/**
 * A PATH, VAULT-RELATIVE AND FORWARD-SLASHED, or null for one that is not in
 * the vault. A backslash is a separator — a relative path made on Windows —
 * and `.` and empty segments go; `..` is walked, and one that climbs out of
 * the root is refused, as are an absolute path, a drive letter and a NUL.
 * @param path as a writer reported it
 */
export function normalPath(path: string): string | null {
  if (typeof path !== "string" || path.includes("\u0000")) return null;
  const p = path.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return null;
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length === 0 ? null : out.join("/");
}

/**
 * THE SCREEN THAT SHOWS A FILE, BY ITS PATH — the History spec's address
 * table, its column *a write the switcher looks for*, and the one statement
 * of it: a file of a page's under `pages/` is that page; the page's
 * `INSTRUCTIONS.md` is its Instructions; a file under its `automations/` is
 * its Automations; a file under `design/` is Design; the root
 * `INSTRUCTIONS.md`, or anything under `.agents/skills/`, is the workspace's
 * Instructions. Anything else — the mirror, the theme, `plugins/`, `assets/`,
 * a name under `pages/` that is no page's — is null: no screen shows it, and
 * a write to it is still an edit a reader can list.
 *
 * Pure: a page is named by its id, which is where it sits now, and the
 * history turns that into its `uid`. THE SWITCHER NEVER READS THIS TABLE — it
 * reads an edit's `place` off the entry — which is why it lives here and not
 * in `contracts/`.
 * @param path vault-relative
 */
export function addressOfPath(path: string): Address | null {
  const rel = normalPath(path);
  if (rel === null) return null;
  const parts = rel.split("/");

  if (parts[0] === DESIGN_DIR) return address("design");
  if (rel === INSTRUCTIONS || rel === SKILLS || rel.startsWith(`${SKILLS}/`)) return address("instructions");
  if (parts[0] !== PAGES_DIR) return null;

  // The walk `pages.ts` spells one way and `mirror.ts` the other:
  // `pages/a/children/b/children/c` is `a/b/c`, and what is left below it is
  // the page's own.
  const head = parts[1];
  if (head === undefined || !SEGMENT.test(head)) return null;
  const ids = [head];
  let at = 2;
  for (;;) {
    const next = parts[at + 1];
    if (parts[at] !== CHILDREN || next === undefined || !SEGMENT.test(next)) break;
    ids.push(next);
    at += 2;
  }
  const id = ids.join("/");
  const rest = parts.slice(at);
  if (rest.length === 1 && rest[0] === INSTRUCTIONS) return address("page", id, "instructions");
  if (rest[0] === AUTOMATIONS) return address("page", id, "automation");
  return address("page", id);
}

/**
 * THE SCREEN THAT SHOWS A VAULT-RELATIVE PATH, as the history keeps it — the
 * address table above, with a page named by its `uid`. Null where no screen
 * shows the file, and for a page with no `uid`.
 * @param path vault-relative, forward-slashed
 * @param uidOf a page's `uid` by its id
 */
export function placeOfPath(path: string, uidOf: (page: PageId) => string | null): Place | null {
  const a = addressOfPath(path);
  return a === null ? null : placeOf(a, uidOf);
}
