// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE HISTORY: what each window opened and had on screen, what
// changed in the workspace and who changed it. One per mounted workspace, in
// memory, gone when the server stops.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the history track builds it, and may
// reshape anything here nothing else has started to call.
//
// It records and it answers; it decides nothing. Nobody asks it anything
// either: agents, runs and the person write, it records each write Biom can
// see, and the switcher in each window reads it from above. What it owes
// (*History and View Switcher*, `log`, `context`, `door`):
//
//   - `seq` counting from 1 and never repeating while the server is up; `at`
//     the server's clock;
//   - an edit's `place` from its path, as the address table maps it — a file
//     of a page's under `pages/` to that page by `uid`, its `INSTRUCTIONS.md`
//     to its Instructions, a file under its `automations/` to its Automations,
//     `design/` to Design, the root `INSTRUCTIONS.md` or `.agents/skills/` to
//     the workspace's Instructions — and null where no screen shows the file;
//   - the same write reported twice in quick succession (an `fs/write_text_file`
//     and then the tool call that made it) recorded ONCE;
//   - a window's report kept as its context, and an open and a view, or a
//     view, appended when it says the screen moved;
//   - a bound on what it keeps, the oldest dropped first.

import type { AgentId, ChatId, EditVia, HistoryEntry, HistoryRead, Move, PageId, Place, WindowContext, WindowId, WindowReport, Writer } from "../../contracts/types.ts";

/** What the history is handed. */
export interface HistoryDeps {
  now: () => number;
  /** The screen that shows a vault-relative path, or null. */
  placeOf: (path: string) => Promise<Place | null>;
  /** A page's `uid` by its id, for a window's report; null where it has none. */
  uidOf: (page: PageId) => Promise<string | null>;
  /** The chat and harness an agent id is running for, to name the switcher's
   *  views; null for an id nobody is running. */
  agentOf: (agent: AgentId) => { chat: ChatId; harness: string } | null;
  /** How many entries are kept. */
  limit?: number;
}

export interface History {
  /** A window's report: its context kept; an open and a view appended when
   *  the person moved the screen, a view when the switcher did. Answers what
   *  it appended. */
  report(window: WindowId, context: WindowReport, moved?: Move): Promise<HistoryEntry[]>;
  /** A write Biom saw. Null where it was the same write already recorded. */
  edit(path: string, via: EditVia, writer: Writer): Promise<HistoryEntry | null>;
  read(since?: number): HistoryRead;
  windows(): WindowContext[];
  /** Hear every batch appended. Answers the unsubscribe. */
  on(fn: (entries: HistoryEntry[]) => void): () => void;
}

/** NOT BUILT: throws. */
export function makeHistory(_deps: HistoryDeps): History {
  throw new Error("server/domain/history.ts: the history is not built yet");
}
