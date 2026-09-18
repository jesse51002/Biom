// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — every version of a file the framework has ever shipped, as git
// knows it, and the hash that says whether a file somewhere else is one of them.
//
// WHAT THIS ANSWERS. A vault holds a plugin file at a path the framework also
// has. Was it ever edited by anybody, or is it a copy the seeder made that has
// simply fallen behind? Git already knows: every commit that touched
// `guest/plugins/` left a blob for each file it held, and a vault file whose
// blob hash is among them is byte for byte a version the framework shipped —
// nobody changed it. `server/workspace/framework.ts` asks that question on every
// open; this module is the half that can answer it, because it is the half
// that runs git.
//
// THE HASH IS GIT'S OWN. A blob's id is `sha1("blob <bytes>\0" + content)`, so
// a file on disk can be checked against history without git being asked about
// the file — one hash, one set lookup — and the list can be generated at build
// time by `tools/app.ts` and carried into a binary that has no `.git` beside it.
//
// It runs git the way `files.ts` does: no shell, an argument is an argument,
// and a machine with no git answers an empty history rather than a failure.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

/** Framework-relative path → every blob hash it has ever had. Keyed the way
 *  the repository spells a path — `guest/plugins/biom-markdown.js`,
 *  `vault/.agents/skills/biom-pages/SKILL.md` — so one map answers for every
 *  directory the framework owns inside a vault. */
export type Shipped = Readonly<Record<string, readonly string[]>>;

/** Nothing shipped. What a binary built without a history, or a checkout with
 *  no git on the machine, answers — and against it nothing is ever a match. */
export const NOTHING_SHIPPED: Shipped = Object.freeze({});

/** The id git would give `text` as a blob. Bytes, not characters: the header
 *  counts what is on disk. */
export function blobHash(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Every blob hash each file under any of `dirs` has ever had in the history
 *  of the repository at `root`, keyed by framework-relative path.
 *
 *  EVERY COMMIT, NOT ONLY THE TIP. A vault seeded three releases ago holds the
 *  file as it was then; the tip alone would call that an edit. `--all` so a
 *  branch that shipped and was merged still counts. Renames are not followed:
 *  a file that moved is a different path, and a copy of it in a vault is a copy
 *  of the old path, which is still in history under the old name — which is
 *  exactly what lets a skill directory a release renamed be recognised in a
 *  vault under the name it had. */
export async function shippedHashes(root: string, dirs: readonly string[]): Promise<Shipped> {
  const out: Record<string, string[]> = {};
  for (const dir of dirs) {
    const commits = await git(root, ["rev-list", "--all", "--", dir]);
    if (commits.code !== 0) continue;
    for (const sha of commits.out.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const tree = await git(root, ["ls-tree", "-r", sha, "--", dir]);
      if (tree.code !== 0) continue;
      for (const line of tree.out.split("\n")) {
        // `<mode> blob <hash>\t<path>`
        const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
        if (m === null) continue;
        const had = (out[m[2]!] ??= []);
        if (!had.includes(m[1]!)) had.push(m[1]!);
      }
    }
  }
  return out;
}

/** Is `text`, sitting at framework-relative `path`, a version the framework
 *  shipped at that path? */
export function isShipped(shipped: Shipped, path: string, text: string): boolean {
  const had = shipped[path];
  if (had === undefined || had.length === 0) return false;
  return had.includes(blobHash(text));
}

interface GitResult {
  code: number;
  out: string;
}

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise<GitResult>((done) => {
    const ps = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    ps.stdout.on("data", (d: unknown) => {
      out += String(d);
    });
    ps.on("error", () => done({ code: -1, out }));
    ps.on("close", (code: number | null) => done({ code: code ?? -1, out }));
  });
}
