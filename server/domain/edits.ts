// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — WHAT AN AGENT WROTE, as Biom saw it: the no-door interim of
// *History and View Switcher*, `door`, and DECISIONS §1. Pure, and the one
// place that says which of an agent's actions is an edit and to which file.
//
// Three things a chat's agent does are edits, and nothing else is:
//
//   - `fs` — an `fs/write_text_file` Biom carried out itself. Exact: Biom
//     read the file before and wrote it after, so what happened and how many
//     lines moved is known, not reported;
//   - `tool` — a tool call of kind `edit`, `delete` or `move` once its status
//     is `completed`, by the paths in its `diff` content and its
//     `locations`. What a diff says is the agent's word for it;
//   - `shell` — the plain writes `shellwrites.ts` reads from a completed
//     `execute` tool call's command line — its raw input's, never its title.
//
// A PATH IS THE VAULT'S OR IT IS NOTHING. Every path is made vault-relative
// and forward-slashed, and one outside the vault — or the vault's root itself,
// or inside `.git/` or the framework's own `.biom/` — is dropped: the history
// is the workspace's, and an agent's scratch file in `/tmp` moves no screen.
// The vault may be reached through a symlink and an agent may report either
// spelling, so both are tried.
//
// WHAT THE LOOK IS SHOWN IS BOUNDED; WHAT THE HISTORY READS IS NOT. A tool
// call's state is kept whole by the caller, and `toolLineOf` cuts it for the
// wire — an output, each side of a diff, the number of diffs and locations —
// saying `truncated` where it cut.

import { relative, resolve, sep } from "node:path";

import type { ChangedFile, EditVia, ToolDiff, ToolLine, ToolLocation } from "../../contracts/types.ts";
import type { ToolState } from "../platform/acp-wire.ts";
import { toolCommand, toolDiffs, toolText } from "../platform/acp-wire.ts";
import { within } from "../platform/files.ts";
import { shellWrites } from "./shellwrites.ts";

/** The vault's root as given, and its real path where that differs. */
export interface VaultRoots {
  root: string;
  real: string | null;
}

/** Directories inside a vault whose files are nobody's edit. */
const NOT_EDITS = [".git", ".biom"];

/** A path an agent named, as the vault's own: relative, forward-slashed.
 *  Relative input is taken against the root, which is every agent's `cwd`.
 *  Null outside the vault, for the root itself, and inside `.git/` or
 *  `.biom/`. */
export function vaultPath(p: string, roots: VaultRoots): string | null {
  if (typeof p !== "string" || p === "" || p.includes("\u0000")) return null;
  const abs = resolve(roots.root, p);
  let rel: string | null = null;
  for (const base of [roots.root, roots.real]) {
    if (base === null) continue;
    if (within(base, abs, true)) {
      rel = relative(resolve(base), abs);
      break;
    }
  }
  if (rel === null || rel === "") return null;
  const fwd = sep === "/" ? rel : rel.split(sep).join("/");
  const top = fwd.split("/")[0] as string;
  if (NOT_EDITS.includes(top)) return null;
  return fwd;
}

/** ONE EDIT: which file, how Biom saw it, what happened, and the lines added
 *  and removed where a diff says. */
export interface Edit {
  path: string;
  via: EditVia;
  op: ChangedFile["op"];
  added?: number;
  removed?: number;
}

/** What an edit is read from. */
export type EditEvent =
  /** An `fs/write_text_file` Biom performed: the file before (`old`, null for
   *  a file that was not there) and after. */
  | { kind: "fs"; path: string; old: string | null; text: string }
  /** A tool call's merged state, as it stands. */
  | { kind: "tool"; tool: ToolState };

/** The tool kinds whose completion is an edit by what they report. */
export const TOOL_EDIT_KINDS: ReadonlySet<string> = new Set(["edit", "delete", "move"]);

/** THE EDITS AN EVENT MAKES, each path once. A tool call makes none until it
 *  is `completed`, and none at all unless it is an edit, a delete, a move or
 *  an `execute` whose command line writes; a path outside the vault makes
 *  none. */
export function editsOf(event: EditEvent, roots: VaultRoots): Edit[] {
  if (event.kind === "fs") {
    const path = vaultPath(event.path, roots);
    if (path === null) return [];
    const { added, removed } = lineDelta(event.old, event.text);
    return [{ path, via: "fs", op: event.old === null ? "created" : "edited", added, removed }];
  }

  const tool = event.tool;
  if (tool.status !== "completed") return [];
  if (tool.kind === "execute") return shellEdits(tool, roots);
  if (!TOOL_EDIT_KINDS.has(tool.kind)) return [];
  const byPath = new Map<string, Edit>();
  const op: Edit["op"] = tool.kind === "delete" ? "deleted" : tool.kind === "move" ? "moved" : "edited";
  for (const d of toolDiffs(tool)) {
    const path = vaultPath(d.path, roots);
    if (path === null) continue;
    const { added, removed } = lineDelta(d.oldText, d.newText);
    const had = byPath.get(path);
    if (had) {
      had.added = (had.added ?? 0) + added;
      had.removed = (had.removed ?? 0) + removed;
      continue;
    }
    const diffOp = tool.kind === "edit" && d.oldText === null ? "created" : op;
    byPath.set(path, { path, via: "tool", op: diffOp, added, removed });
  }
  for (const l of tool.locations) {
    const path = vaultPath(l.path, roots);
    if (path === null || byPath.has(path)) continue;
    byPath.set(path, { path, via: "tool", op });
  }
  return [...byPath.values()];
}

/** What an `execute` call's command line wrote, read by `shellWrites` in the
 *  folder it ran in. A later operation on a path is what the path ends as. */
function shellEdits(tool: ToolState, roots: VaultRoots): Edit[] {
  const cmd = toolCommand(tool);
  if (!cmd) return [];
  const byPath = new Map<string, Edit>();
  for (const w of shellWrites(cmd.command, cmd.cwd ? resolve(roots.root, cmd.cwd) : roots.root)) {
    const path = vaultPath(w.path, roots);
    if (path === null) continue;
    byPath.set(path, { path, via: "shell", op: w.op === "delete" ? "deleted" : w.op === "move" ? "moved" : "edited" });
  }
  return [...byPath.values()];
}

/** Every path a tool call names — its diffs' and its locations' — as the
 *  vault's own. How an `fs` write is matched to the tool call that made it. */
export function toolPaths(tool: ToolState, roots: VaultRoots): string[] {
  const out = new Set<string>();
  for (const d of toolDiffs(tool)) {
    const p = vaultPath(d.path, roots);
    if (p !== null) out.add(p);
  }
  for (const l of tool.locations) {
    const p = vaultPath(l.path, roots);
    if (p !== null) out.add(p);
  }
  return [...out];
}

const splitLines = (t: string): string[] => {
  if (t === "") return [];
  const lines = t.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** Past this many cells the middle of a diff is counted whole rather than
 *  matched: a pathological rewrite is `all removed, all added`, which is what
 *  it looks like anyway. */
const LCS_CELLS = 250_000;

/** LINES ADDED AND REMOVED between two texts: the common head and tail set
 *  aside, and the middle matched by longest common subsequence where it is
 *  small enough. `old` null is a new file: every line added. */
export function lineDelta(old: string | null, next: string): { added: number; removed: number } {
  const b = splitLines(next);
  if (old === null) return { added: b.length, removed: 0 };
  const a = splitLines(old);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  if (x.length === 0 || y.length === 0 || x.length * y.length > LCS_CELLS) return { added: y.length, removed: x.length };
  let prev = new Array<number>(y.length + 1).fill(0);
  let cur = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? (prev[j - 1] as number) + 1 : Math.max(prev[j] as number, cur[j - 1] as number);
    }
    [prev, cur] = [cur, prev];
  }
  const common = prev[y.length] as number;
  return { added: y.length - common, removed: x.length - common };
}

/** How much of a tool call reaches the look. */
export const TOOL_LINE_BOUNDS = { title: 2000, output: 32 * 1024, diffSide: 64 * 1024, diffs: 50, locations: 100 } as const;

/** ONE ACTION LINE, WHOLE AND BOUNDED, from a tool call's merged state. Paths
 *  are the vault's own where they are inside it, and as the agent gave them
 *  otherwise. */
export function toolLineOf(state: ToolState, roots: VaultRoots): ToolLine {
  let truncated = false;
  const cut = (t: string, max: number): string => {
    if (t.length <= max) return t;
    truncated = true;
    return t.slice(0, max);
  };
  const shown = (p: string): string => vaultPath(p, roots) ?? p;

  const all = toolDiffs(state);
  if (all.length > TOOL_LINE_BOUNDS.diffs) truncated = true;
  const diffs: ToolDiff[] = all.slice(0, TOOL_LINE_BOUNDS.diffs).map((d) => ({
    path: shown(d.path),
    old: d.oldText === null ? null : cut(d.oldText, TOOL_LINE_BOUNDS.diffSide),
    new: cut(d.newText, TOOL_LINE_BOUNDS.diffSide),
  }));
  if (state.locations.length > TOOL_LINE_BOUNDS.locations) truncated = true;
  const locations: ToolLocation[] = state.locations.slice(0, TOOL_LINE_BOUNDS.locations).map((l) => ({ path: shown(l.path), line: l.line }));
  return {
    id: state.id,
    title: cut(state.title, TOOL_LINE_BOUNDS.title),
    kind: state.kind,
    status: state.status,
    locations,
    diffs,
    output: cut(toolText(state), TOOL_LINE_BOUNDS.output),
    truncated,
  };
}
