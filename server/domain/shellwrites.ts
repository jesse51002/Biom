// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — WHICH FILES A SHELL COMMAND LINE WRITES, read conservatively.
//
// A STUB: it answers nothing, which is the inert answer — a command it cannot
// read writes nothing the history records. The chats track builds it.
//
// Until the door is built, an agent's plain shell writes are one of the three
// ways Biom sees an edit (*History and View Switcher*, `door`): `sed -i`, `>`
// and `>>`, `tee [-a]`, `mv` and `cp` (the destination), `rm` (a deletion) and
// `touch`, through quotes, `&&`, `;`, `|` and a leading `cd dir &&`. ANYTHING
// NOT READ CONFIDENTLY IS IGNORED, NEVER GUESSED — `$(`, backticks, `eval`, a
// variable or a glob in a path, a loop — because a wrong name on an edit moves
// somebody's screen for a write that did not happen.

/** What a command did to one path. */
export type ShellWriteOp = "write" | "append" | "edit" | "delete" | "move" | "copy" | "touch";

/** One write a command line makes: an absolute path, resolved against the
 *  directory the command ran in. */
export interface ShellWrite {
  path: string;
  op: ShellWriteOp;
}

/** The files `command`, run in `cwd`, writes. NOT BUILT: answers none. */
export function shellWrites(_command: string, _cwd: string): ShellWrite[] {
  return [];
}
