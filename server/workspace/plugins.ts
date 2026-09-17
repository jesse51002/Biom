// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — the two things a vault's `plugins/` gets on every open, after the
// mount has answered: a MIRROR of the framework's set to read, and a SWEEP of
// the copies that fell behind.
//
// NOTHING HERE IS ON THE MOUNT PATH. A page draws from the framework's own
// plugins the moment the vault is open — `pages.ts` reads the vault's file and
// falls back to the framework's — so nothing a page needs waits on either job
// below, and a vault whose background work has not finished draws exactly as
// it will a second later. `main.ts` runs both once the mount has returned.
//
// THE MIRROR is `docs/plugins/`: the framework's whole plugin set, written out
// of the same `Files` the fallback rung reads, so the folder a person opens is
// byte for byte what draws their page. It is EMPTIED AND WRITTEN WHOLE every
// time rather than filled, which is the one-word difference from the seeder
// this replaced: `fill` skipped a file that was there, and that is exactly
// what let a copy drift. Nothing serves the mirror, nothing resolves a page
// against it, and a file edited there is gone on the next open. `docs/` is
// not a watched directory, so writing it redraws nothing.
//
// THE SWEEP is a bridge and says so. It walks `plugins/`, and every file that
// is byte for byte a version the framework ever shipped — the blob hash is in
// git's history for that path — is a seeded copy nobody edited, and it goes,
// committed first so the deletion is one readable diff and one revert away.
// One changed byte keeps a file. What it costs: a person who kept an OLD
// version on purpose, unedited, loses it, and the framework's current one
// draws instead. That is the stale-copy problem the framework used to have,
// taken away when it was silent, and it exists so that no vault seeded before
// this — or whose owner never reads about it — goes on carrying stale copies.
// Once every vault on this side of the change has been opened once, it is
// sunset and the fallback rung is the whole mechanism. The mirror stays.

import type { Files } from "../../contracts/types.ts";
import { isShipped } from "../platform/shipped.ts";
import type { Shipped } from "../platform/shipped.ts";

/** Where the mirror is written, vault-relative. Beside `docs/*.md`, which is
 *  where a person reading about the format already is. */
export const MIRROR_DIR = "docs/plugins";

/** The line that keeps the mirror out of the vault's history: a framework
 *  release rewrites every file in it, and a diff of that in every vault is a
 *  diff nobody asked for. Ensured on every open rather than written once,
 *  because vaults made before this existed have a `.gitignore` already. */
export const MIRROR_IGNORE = `${MIRROR_DIR}/`;

/** Every file under `dir` in `root`, relative to `dir`, forward-slashed. */
async function filesUnder(root: Files, dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string, prefix: string): Promise<void> => {
    for (const entry of await root.list(at === "" ? "." : at)) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const abs = at === "" ? entry.name : `${at}/${entry.name}`;
      if (entry.dir) await walk(abs, rel);
      else out.push(rel);
    }
  };
  await walk(dir, "");
  return out.sort();
}

/** Rewrite `docs/plugins/` from the framework's set. Whole, every time. */
export async function mirrorPlugins(vault: Files, framework: Files): Promise<void> {
  await vault.remove(MIRROR_DIR);
  for (const rel of await filesUnder(framework, "")) {
    const text = await framework.read(rel);
    if (text === null) continue;
    await vault.write(`${MIRROR_DIR}/${rel}`, text);
  }
  await ignoreMirror(vault);
}

/** Add the mirror to `.gitignore` if it is not there. Appends, never rewrites:
 *  a hand-edited ignore file is the person's. */
async function ignoreMirror(vault: Files): Promise<void> {
  const had = (await vault.read(".gitignore")) ?? "";
  const lines = had.split("\n").map((l) => l.trim());
  if (lines.includes(MIRROR_IGNORE) || lines.includes(MIRROR_DIR)) return;
  const joined = had === "" || had.endsWith("\n") ? had : had + "\n";
  await vault.write(".gitignore", `${joined}${MIRROR_IGNORE}\n`);
}

/** Delete every file in `plugins/` that is byte for byte a version the
 *  framework shipped at that path. Answers what went, vault-relative, so the
 *  caller can say so. Commits BEFORE the first deletion, exactly as every
 *  agent write does, and only when there is something to delete. */
export async function sweepShipped(vault: Files, shipped: Shipped): Promise<string[]> {
  const gone: string[] = [];
  const candidates: string[] = [];
  for (const rel of await filesUnder(vault, "plugins")) {
    if (!(rel in shipped)) continue;
    const text = await vault.read(`plugins/${rel}`);
    if (text === null) continue;
    if (isShipped(shipped, rel, text)) candidates.push(rel);
  }
  if (candidates.length === 0) return gone;
  await vault.commit("Before the framework's unedited plugin copies are removed");
  for (const rel of candidates) {
    await vault.remove(`plugins/${rel}`);
    gone.push(`plugins/${rel}`);
  }
  // A page plugin's directory with nothing left in it is an empty folder that
  // reads as a plugin with no document. Take it with the last file.
  for (const rel of candidates) {
    const cut = rel.indexOf("/");
    if (cut < 0) continue;
    const dir = `plugins/${rel.slice(0, cut)}`;
    if ((await vault.list(dir)).length === 0) await vault.remove(dir);
  }
  return gone;
}
