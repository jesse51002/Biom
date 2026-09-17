// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — WHAT THE FRAMEWORK OWNS INSIDE A VAULT, kept current on every open.
//
// Three jobs, none on the mount path. A page draws from the framework's own
// plugins the moment the vault is open — `pages.ts` reads the vault's file and
// falls back to the framework's — so nothing a page needs waits on any of them,
// and a vault whose background work has not finished draws exactly as it will
// a second later. `main.ts` runs all three once the mount has returned.
//
// THE SKILLS. `.agents/skills/biom-<skill>/` for every skill the framework
// ships, with `check.ts` and its `_lib/` beside them, are REWRITTEN WHOLE on
// every open. They cannot take the plugin design below, because an agent reads the
// folder and not the server: a skill is a file Claude Code, Cursor or Codex
// opens directly, before the server has been asked anything and in a clone the
// server has never opened — so it has to be on disk, in the vault, current. And
// they cannot be overridden: a workspace adds skills under names of its own and
// never edits the framework's. The rewrite is what makes that a fact rather
// than a request — a change to a framework skill made in a vault is gone on
// the next open, and what is wanted everywhere goes into the framework's
// `vault/.agents/skills/` first. A directory under any other name is the
// workspace's and is never touched — WHICH IS WHAT THE PREFIX IS FOR: a
// workspace that wrote a `pages` skill of its own would otherwise have it
// rewritten as the framework's on the next open, so every framework skill wears
// `biom-` and a workspace's names are free. Nothing is ever removed, with one
// bridge: a copy under the name a skill had BEFORE the prefix, byte for byte a
// version the framework shipped, goes — a vault must not carry a skill twice,
// and an unedited copy is the framework's to take back. When anything changed,
// `main.ts` commits it as one diff naming the framework version.
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
// sunset and the fallback rung is the whole mechanism. The mirror and the
// skills rewrite stay.

import type { FileEntry, Files } from "../../contracts/types.ts";
import { isShipped } from "../platform/shipped.ts";
import type { Shipped } from "../platform/shipped.ts";

/* ── the skills ─────────────────────────────────────────────────────────── */

/** `.agents/skills/`, which is the CROSS-CLIENT convention in the Agent Skills
 *  spec — the path a compliant client scans alongside its own `.<client>/skills/`.
 *  A vendor-shaped directory would make one agent first-class and the rest
 *  guests in a folder that is supposed to be neither. `presets.ts` spells the
 *  same path to leave it OUT of the vault-root walk, and a test holds the two
 *  equal. */
export const SKILLS_DIR = ".agents/skills";
/** WHAT EVERY FRAMEWORK SKILL DIRECTORY STARTS WITH, and why: a framework skill
 *  is rewritten in every vault on open, and a workspace's own skill is never
 *  touched, so the two sets of names must not be able to meet. `pages` is a
 *  name anybody would give a skill; `biom-pages` is not. The frontmatter
 *  `name:` of each shipped skill is the directory, so the name an agent routes
 *  on carries the prefix too. Spelled here and in `tests/skill.test.ts`, which
 *  holds the two equal and refuses a shipped skill without it. */
export const SKILL_PREFIX = "biom-";
/** The directories the framework owns inside a vault, framework-relative —
 *  what `tools/app.ts` reads the shipped hashes for, and what a source run asks
 *  its own history about. */
export const SHIPPED_DIRS: readonly string[] = ["guest/plugins", "vault/.agents/skills"];
/** The checker, beside the skills so an agent working in a vault can run it
 *  against a page it just wrote. */
export const CHECK = "check.ts";
/** `_` is reserved for the host by the vault format, so nothing a person writes
 *  can collide with it. */
export const LIB_DIR = "_lib";
/** Framework path → the name it takes beside the checker. The checker's own
 *  `./_lib/` imports are what fix the names on the right; changing one means
 *  changing the import in `skill/check.ts` and the shim beside it, together.
 *
 *  IT IS EXACTLY WHAT `check.ts` IMPORTS, and this list is the only thing that
 *  says so — a row nothing imports is a file in every vault forever.
 *  `server/platform/yaml.ts` used to be here and is not, because the checker
 *  stopped borrowing the server's parser and carries its own reader. Copying it
 *  anyway would be worse than dead weight: it imports the bare specifier `yaml`,
 *  which this repo resolves through `paths` at a vendored file that no vault
 *  has, so the copy would sit there ready to turn `bun run .agents/skills/check.ts`
 *  into an unpinned install off npm the moment anything imported it — and it
 *  would fail offline, in the folder whose whole promise is that it is just
 *  files. Everything here imports nothing at all, which is the bar for landing.
 *  That is what let `scale.ts` join: the checker reports what the page reader
 *  threw away out of a `markdown.yaml`, and it can only do that honestly by
 *  calling the same walk the reader calls. */
export const CHECK_LIB: readonly (readonly [string, string])[] = [
  ["contracts/wire.js", "wire.js"],
  ["contracts/types.ts", "types.ts"],
  ["contracts/scale.ts", "scale.ts"],
];

/** What the framework owns under `.agents/skills/`, as it should be on disk:
 *  vault-relative path → text. Every skill directory the framework ships, the
 *  checker, and the modules it imports. */
async function ownedSkills(vaultSeed: Files, skill: Files | null, checkerLib: Files | null): Promise<Map<string, string>> {
  const want = new Map<string, string>();
  for (const rel of await filesUnder(vaultSeed, SKILLS_DIR)) {
    const text = await vaultSeed.read(`${SKILLS_DIR}/${rel}`);
    if (text !== null) want.set(`${SKILLS_DIR}/${rel}`, text);
  }
  if (skill !== null) {
    const checker = await skill.read(CHECK);
    if (checker !== null) want.set(`${SKILLS_DIR}/${CHECK}`, checker);
  }
  if (checkerLib !== null) {
    for (const [from, to] of CHECK_LIB) {
      const text = await checkerLib.read(from);
      if (text !== null) want.set(`${SKILLS_DIR}/${LIB_DIR}/${to}`, text);
    }
  }
  return want;
}

/** The top-level names the framework owns under `.agents/skills/`: each skill
 *  directory, `check.ts` and `_lib`. A vault entry under any other name is the
 *  workspace's own. */
function ownedNames(want: Map<string, string>): Set<string> {
  const names = new Set<string>();
  for (const path of want.keys()) {
    const rest = path.slice(SKILLS_DIR.length + 1);
    const cut = rest.indexOf("/");
    names.add(cut < 0 ? rest : rest.slice(0, cut));
  }
  return names;
}

/** REWRITE THE FRAMEWORK'S SKILLS, WHOLE. For each name the framework owns,
 *  what is in the vault is compared with what the framework ships — every file
 *  under it, by content — and rewritten only when the two differ, so an open
 *  that changes nothing writes nothing. A name the framework owns is emptied
 *  before it is written, so a file somebody added inside `sections/` goes with
 *  the edit; a name it does not own is never looked at. Answers whether
 *  anything was written, so the caller can commit it as one diff. */
export async function rewriteSkills(vault: Files, vaultSeed: Files, skill: Files | null = null, checkerLib: Files | null = null): Promise<boolean> {
  const want = await ownedSkills(vaultSeed, skill, checkerLib);
  if (want.size === 0) return false;
  let changed = false;
  for (const name of ownedNames(want)) {
    const at = `${SKILLS_DIR}/${name}`;
    const wanted = new Map<string, string>();
    for (const [path, text] of want) if (path === at || path.startsWith(at + "/")) wanted.set(path, text);
    if (await same(vault, at, wanted)) continue;
    await vault.remove(at);
    for (const [path, text] of wanted) await vault.write(path, text);
    changed = true;
  }
  return changed;
}

/** THE BRIDGE FOR THE PREFIX. A vault seeded before the framework's skills wore
 *  `biom-` holds `pages/`, `sections/` and the rest under those bare names, and
 *  the rewrite above puts `biom-pages/` beside them rather than over them — so
 *  without this an agent finds every framework skill twice, once stale. For
 *  each skill the framework ships, the directory under its OLD name is removed
 *  if every file in it is byte for byte a version the framework shipped there:
 *  unedited, the framework's to take back. One changed byte, or a file the
 *  framework never shipped, keeps the directory — it is somebody's now, under a
 *  name the framework no longer uses, and the log says so. Answers what went. */
export async function sweepOldSkills(vault: Files, vaultSeed: Files, shipped: Shipped): Promise<string[]> {
  const gone: string[] = [];
  let shippedDirs: FileEntry[];
  try {
    shippedDirs = await vaultSeed.list(SKILLS_DIR);
  } catch {
    return gone;
  }
  for (const entry of shippedDirs) {
    if (!entry.dir || !entry.name.startsWith(SKILL_PREFIX)) continue;
    const old = entry.name.slice(SKILL_PREFIX.length);
    const at = `${SKILLS_DIR}/${old}`;
    const held = await filesUnder(vault, at);
    if (held.length === 0) continue;
    let unedited = true;
    for (const rel of held) {
      const text = await vault.read(`${at}/${rel}`);
      if (text === null || !isShipped(shipped, `vault/${at}/${rel}`, text)) {
        unedited = false;
        break;
      }
    }
    if (!unedited) {
      console.log(`skills  →  ${at} is a skill the framework now ships as ${entry.name}; it was edited here and is left alone`);
      continue;
    }
    await vault.remove(at);
    gone.push(at);
  }
  return gone;
}

/** Is what the vault holds at `at` exactly `wanted` — the same files, the same
 *  bytes, and nothing else? */
async function same(vault: Files, at: string, wanted: Map<string, string>): Promise<boolean> {
  const has = new Map<string, string | null>();
  const single = wanted.has(at);
  if (single) {
    has.set(at, await vault.read(at));
  } else {
    for (const rel of await filesUnder(vault, at)) has.set(`${at}/${rel}`, await vault.read(`${at}/${rel}`));
  }
  if (has.size !== wanted.size) return false;
  for (const [path, text] of wanted) if (has.get(path) !== text) return false;
  return true;
}

/* ── the mirror ─────────────────────────────────────────────────────────── */

/** Where the mirror is written, vault-relative. Beside `docs/*.md`, which is
 *  where a person reading about the format already is. */
export const MIRROR_DIR = "docs/plugins";

/** The line that keeps the mirror out of the vault's history: a framework
 *  release rewrites every file in it, and a diff of that in every vault is a
 *  diff nobody asked for. Ensured on every open rather than written once,
 *  because vaults made before this existed have a `.gitignore` already. */
export const MIRROR_IGNORE = `${MIRROR_DIR}/`;

/** Every file under `dir` in `root`, relative to `dir`, forward-slashed. A
 *  `dir` that is not there is an empty list, which is what `Files.list`
 *  answers for one. */
async function filesUnder(root: Files, dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string, prefix: string): Promise<void> => {
    let entries: FileEntry[];
    try {
      entries = await root.list(at === "" ? "." : at);
    } catch {
      return;
    }
    for (const entry of entries) {
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

/* ── the sweep ──────────────────────────────────────────────────────────── */

/** Delete every file in `plugins/` that is byte for byte a version the
 *  framework shipped at that path. Answers what went, vault-relative, so the
 *  caller can say so. Commits BEFORE the first deletion, exactly as every
 *  agent write does, and only when there is something to delete. */
export async function sweepShipped(vault: Files, shipped: Shipped): Promise<string[]> {
  const gone: string[] = [];
  const candidates: string[] = [];
  for (const rel of await filesUnder(vault, "plugins")) {
    const key = `guest/plugins/${rel}`;
    if (!(key in shipped)) continue;
    const text = await vault.read(`plugins/${rel}`);
    if (text === null) continue;
    if (isShipped(shipped, key, text)) candidates.push(rel);
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
