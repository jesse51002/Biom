// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — WHAT THE FRAMEWORK OWNS INSIDE A VAULT, kept current on every open.
//
// Two jobs, neither on the mount path. A page draws from the framework's own
// plugins the moment the vault is open — `pages.ts` reads the vault's file and
// falls back to the framework's — so nothing a page needs waits on either of
// them, and a vault whose background work has not finished draws exactly as it
// will a second later. `main.ts` runs both once the mount has returned.
//
// WHAT THE FRAMEWORK OWNS IN A VAULT: `.agents/skills/biom-<skill>/` for every
// skill it ships, with `check.ts` and its `_lib/` beside them; `AGENTS.md`; and
// every doc under `docs/`. All of it is REWRITTEN WHOLE on every open. They
// cannot take the plugin design below, because an agent reads the folder and
// not the server: a skill is a file Claude Code, Cursor or Codex opens
// directly, before the server has been asked anything and in a clone the
// server has never opened — so it has to be on disk, in the vault, current. And
// they cannot be overridden: a workspace adds skills under names of its own and
// never edits the framework's. The rewrite is what makes that a fact rather
// than a request — a change to a framework skill made in a vault is gone on
// the next open, and what is wanted everywhere goes into the framework's
// `vault/.agents/skills/` first. A directory under any other name is the
// workspace's and is never touched — WHICH IS WHAT THE PREFIX IS FOR: a
// workspace that wrote a `pages` skill of its own would otherwise have it
// rewritten as the framework's on the next open, so every framework skill wears
// `biom-` and a workspace's names are free. NOTHING IS EVER REMOVED. A vault
// seeded before the prefix holds `pages/` and `sections/` beside `biom-pages/`
// and `biom-sections/`; those are under names the framework no longer uses, so
// they are the workspace's now, and whoever owns the folder deletes them. The
// same goes for a copy of a framework plugin under `plugins/`: it is the
// workspace's own, it draws in place of the framework's, and it stays until
// somebody deletes it. Telling an unedited copy from an edited one would mean
// carrying every version the framework ever shipped, and the framework does
// not: this is a breaking change. When anything changed, `main.ts` commits it
// as one diff naming the framework version.
//
// `AGENTS.md` IS THE FRAMEWORK'S, AND `INSTRUCTIONS.md` IS THE PERSON'S. The
// guide used to be one file with two owners — the framework's paragraphs seeded
// once and then somebody's own text around them — so the framework's half went
// stale exactly as a skill did and the person's half could never be rewritten.
// Now `AGENTS.md` is the format, rewritten like a skill, and its first line
// sends the agent to `INSTRUCTIONS.md`, which the seeder fills once as a stub
// and nothing here ever touches. A vault that already had an `AGENTS.md` of
// its own gets the framework's written over it, like any unit — the vault is
// committed first, so what was there is one `git show` away, and whoever owns
// the folder moves what was theirs into `INSTRUCTIONS.md` by hand. That is
// the breaking change again, and it is not carved around: the framework does
// not read a guide to decide whose it is. `docs/` takes the skills rule
// outright — it is the manual, written for the person and not by them.
//
// THE MIRROR is `docs/plugins/`: the framework's whole plugin set, written out
// of the same `Files` the fallback rung reads, so the folder a person opens is
// byte for byte what draws their page. It is EMPTIED AND WRITTEN WHOLE every
// time rather than filled, which is the one-word difference from the seeder
// this replaced: `fill` skipped a file that was there, and that is exactly
// what let a copy drift. Nothing serves the mirror, nothing resolves a page
// against it, and a file edited there is gone on the next open. `docs/` is
// not a watched directory, so writing it redraws nothing.

import type { FileEntry, Files } from "../../contracts/types.ts";

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
/** The guide every agent reads first, and it is the framework's: the format,
 *  rewritten on every open. */
export const AGENTS = "AGENTS.md";
/** The person's own guide, which `AGENTS.md` sends the agent to before
 *  anything else. Filled once by the seeder; never read or written here —
 *  named so the pair is spelled in one place. */
export const INSTRUCTIONS = "INSTRUCTIONS.md";
/** The manual for the format, for the person whose folder this is — the
 *  framework's, rewritten file by file. `docs/plugins/` inside it is the mirror
 *  below, and is not a doc. */
export const DOCS_DIR = "docs";
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

/** What the framework owns in a vault, as it should be on disk: vault-relative
 *  path → text. Every skill directory the framework ships, the checker and the
 *  modules it imports, the guide, and every doc — the docs at their top level
 *  only, because `docs/plugins/` is the mirror and not a doc. */
async function owned(vaultSeed: Files, skill: Files | null, checkerLib: Files | null): Promise<Map<string, string>> {
  const want = new Map<string, string>();
  for (const rel of await filesUnder(vaultSeed, SKILLS_DIR)) {
    const text = await vaultSeed.read(`${SKILLS_DIR}/${rel}`);
    if (text !== null) want.set(`${SKILLS_DIR}/${rel}`, text);
  }
  const guide = await vaultSeed.read(AGENTS);
  if (guide !== null) want.set(AGENTS, guide);
  let docs: FileEntry[] = [];
  try {
    docs = await vaultSeed.list(DOCS_DIR);
  } catch {
    docs = [];
  }
  for (const entry of docs) {
    if (entry.dir) continue;
    const text = await vaultSeed.read(`${DOCS_DIR}/${entry.name}`);
    if (text !== null) want.set(`${DOCS_DIR}/${entry.name}`, text);
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

/** THE UNITS THE REWRITE WORKS IN — each one compared and rewritten whole. A
 *  skill directory, `check.ts` and `_lib/` under `.agents/skills/`; the guide;
 *  and each doc by itself, so a doc the framework stops shipping stays and
 *  nothing beside the docs is ever removed. A vault entry under any other
 *  name is the workspace's own. */
function units(want: Map<string, string>): Set<string> {
  const names = new Set<string>();
  for (const path of want.keys()) {
    if (path.startsWith(SKILLS_DIR + "/")) {
      const rest = path.slice(SKILLS_DIR.length + 1);
      const cut = rest.indexOf("/");
      names.add(`${SKILLS_DIR}/${cut < 0 ? rest : rest.slice(0, cut)}`);
    } else {
      names.add(path);
    }
  }
  return names;
}

/** REWRITE WHAT THE FRAMEWORK OWNS, WHOLE. For each unit, what is in the vault
 *  is compared with what the framework ships — every file under it, by content
 *  — and rewritten only when the two differ, so an open that changes nothing
 *  writes nothing. A unit is emptied before it is written, so a file somebody
 *  added inside `biom-sections/` goes with the edit; a name the framework does
 *  not own is never looked at. The vault is COMMITTED BEFORE THE FIRST WRITE,
 *  exactly as every agent write is, so whatever stood at a framework name —
 *  an `AGENTS.md` somebody wrote before it was the framework's — is in the
 *  history rather than gone. Answers whether anything was written, so the
 *  caller can commit it as one diff. */
export async function rewriteOwned(
  vault: Files,
  vaultSeed: Files,
  skill: Files | null = null,
  checkerLib: Files | null = null,
): Promise<boolean> {
  const want = await owned(vaultSeed, skill, checkerLib);
  if (want.size === 0) return false;
  let changed = false;
  for (const at of units(want)) {
    const wanted = new Map<string, string>();
    for (const [path, text] of want) if (path === at || path.startsWith(at + "/")) wanted.set(path, text);
    if (await same(vault, at, wanted)) continue;
    if (!changed) await vault.commit("Before the framework's guide, docs, skills and checker are rewritten");
    await vault.remove(at);
    for (const [path, text] of wanted) await vault.write(path, text);
    changed = true;
  }
  return changed;
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
