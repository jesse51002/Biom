// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE HISTORY: what each window opened and had on screen, what
// changed in the workspace and who changed it. One per mounted workspace, in
// memory, gone when the server stops.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; track B1 builds it, and may reshape
// anything here nothing else has started to call.
//
// It records and it answers; it decides nothing. Nobody asks it anything
// either: agents, runs and the person write, it records each write Biom can
// see, and the switcher in each window reads it from above. What it owes
// (*History and View Switcher*, `log`, `context`, `door`, `yours`):
//
//   - `seq` counting from 1 and never repeating while the server is up; `at`
//     the server's clock;
//   - an edit's `place` from its path by `placeOfPath` below — the address
//     table's *write the switcher looks for* column — and null where no screen
//     shows the file. THE SWITCHER NEVER READS THE TABLE: it reads `place` off
//     the entry, which is why the table is here and not in `contracts/`;
//   - a table's schema or rows are an edit with `path` null and the table's
//     place;
//   - `page.projection` and `vault.commit` are NOT edits: the framework
//     writing for itself is nobody's change;
//   - an agent's write arrives only through the chats' `onEdit` — never
//     through the writer callback the app's own writes come by — and the same
//     write reported twice (an `fs/write_text_file`, then the tool call that
//     made it) is recorded ONCE;
//   - a window's report kept as its context, with the context's `agent`
//     derived from its `chat`, never taken from the window; an open and a view
//     appended when the person moved the screen, a view by the switcher's
//     agent when it did, a view by the person alone for a `claim`;
//   - a window's context dropped when its stream closes (`forget`, called by
//     the stream's route with the `window` its address names);
//   - a bound on what it keeps, the oldest dropped first.

import type { AgentId, ChatId, EditVia, HistoryEntry, HistoryRead, Move, PageId, Place, WindowContext, WindowId, WindowReport, Writer } from "../../contracts/types.ts";

/** What the history is handed. */
export interface HistoryDeps {
  now: () => number;
  /** A page's `uid` by its id; null where it has none. */
  uidOf: (page: PageId) => Promise<string | null>;
  /** The agent running for a chat, with its harness — to name the switcher's
   *  views and to derive a report's `agent`; null for a chat running none. */
  agentOfChat: (chat: ChatId) => { agent: AgentId; harness: string; turn: number } | null;
  /** How many entries are kept. */
  limit?: number;
}

/** One write, as the history is told it. `path` is vault-relative, or null
 *  for a write that is no file, whose `place` is then given. */
export interface EditReport {
  path: string | null;
  place?: Place | null;
  via: EditVia;
  writer: Writer;
}

export interface History {
  /** A window's report: its context kept; an open and a view appended when
   *  the person moved the screen, a view when the switcher did or the screen
   *  became theirs. Answers what it appended. */
  report(window: WindowId, context: WindowReport, moved?: Move): Promise<HistoryEntry[]>;
  /** Forget a window — its stream closed. */
  forget(window: WindowId): void;
  /** A write Biom saw. Null where it was the same write already recorded. */
  edit(write: EditReport): Promise<HistoryEntry | null>;
  read(since?: number): HistoryRead;
  windows(): WindowContext[];
  /** Hear every batch appended. Answers the unsubscribe. */
  on(fn: (entries: HistoryEntry[]) => void): () => void;
}

/** NOT BUILT: throws. */
export function makeHistory(_deps: HistoryDeps): History {
  throw new Error("server/domain/history.ts: the history is not built yet");
}

/**
 * THE SCREEN THAT SHOWS A VAULT-RELATIVE PATH, as the History spec's address
 * table maps it: a page's files → the page; its `INSTRUCTIONS.md` → its
 * Instructions; a file under its `automations/` → its Automations; a file
 * under `design/` → Design; the root `INSTRUCTIONS.md` or `.agents/skills/` →
 * the workspace's Instructions; anything else → null. Pure — the page a path
 * is in is the format's rule, `pages/<a>/children/<b>/…` being `a/b`, and its
 * `uid` is looked up by the caller. NOT BUILT: answers null.
 * @param _path vault-relative, forward-slashed
 * @param _uidOf a page's `uid` by its id
 */
export function placeOfPath(_path: string, _uidOf: (page: PageId) => string | null): Place | null {
  return null;
}
