// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — the files the program CARRIES, as opposed to the ones it finds.
//
// A compiled binary has no directory next to it. Everything the server serves
// off disk today — the client, the box's own code, the vendored scripts, the
// vault seed, the checker and the contracts — is read relative to `server/`,
// which is the one thing that stops existing the moment `bun build --compile`
// runs. So every one of those files travels INSIDE the binary instead, and this
// module is the half that reads them back.
//
// It does not generate the manifest and it does not know where one comes from.
// `tools/app.ts` writes `dist/embedded.ts`, the composition root imports it —
// dynamically, because a stranger's `make dev` has no such file — and hands the
// map down to here. That keeps this module ordinary: a map in, a `Files` out.
//
// WHAT A VALUE IN THE MAP IS: a path `Bun.file` reads. `import x from "./a.txt"
// with { type: "file" }` answers the path on disk when bun runs the source and
// the path inside the executable when bun compiled it, which is precisely why
// `deliver()` upstairs needed no change at all — an embedded file arrives as a
// path, exactly as a file on disk does.
//
// WHAT A KEY IS: the file's path relative to the framework root, forward-
// slashed — `client/index.html`, `vault/.agents/skills/biom-pages/SKILL.md`. One key
// space, spelled the way the repository spells it, so the static routes and the
// seed roots below are two views of one map rather than two conventions.

import type { FileEntry, Files } from "../../contracts/types.ts";

// The framework has one runtime and declares the globals it uses rather than
// depending on a types package, exactly as `server/main.ts` does.
declare const Bun: {
  file(path: string): { exists(): Promise<boolean>; text(): Promise<string> };
};

/** Framework-relative path → the path the embedded copy answers to. */
export type EmbeddedMap = Readonly<Record<string, string>>;

/** Nothing embedded. The value the composition root gets when the manifest was
 *  never generated, which is every run from source. */
export const NOTHING_EMBEDDED: EmbeddedMap = Object.freeze({});

/** Refused in a key for the same two reasons `files.ts` refuses them in a path:
 *  a `..` segment is an escape and a null byte is a truncation. There is nothing
 *  to escape FROM in a map — that whole class of fault leaves the compiled build
 *  rather than being defended twice — but a lookup built out of a url should
 *  still never be spelled with one. */
function clean(rel: string): string | null {
  if (typeof rel !== "string" || rel.includes("\u0000")) return null;
  const parts = [];
  for (const part of rel.split(/[/\\]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.join("/");
}

/** The key `rel` names under `root`, or null if it is not a name at all.
 *  `root` is a framework-relative directory — `vault`, `skill`, or `""` for the
 *  framework root itself. */
export function keyUnder(root: string, rel: string): string | null {
  const tail = clean(rel);
  if (tail === null) return null;
  const head = clean(root);
  if (head === null) return null;
  if (head === "") return tail;
  return tail === "" ? head : `${head}/${tail}`;
}

/** Is anything carried at all? The composition root asks this and nothing else
 *  — embedded or on disk is one question with one answer, and it is decided by
 *  what the build put here rather than by an environment variable somebody has
 *  to know to set. */
export const isEmbedded = (map: EmbeddedMap): boolean => Object.keys(map).length > 0;

/** The embedded file `key` names, read as text, or null when nothing is carried
 *  under that name. */
export async function readEmbedded(map: EmbeddedMap, key: string): Promise<string | null> {
  const at = map[key];
  if (at === undefined) return null;
  try {
    return await Bun.file(at).text();
  } catch {
    return null;
  }
}

/** Every embedded key directly inside `dir`, as `list` reports them: a name and
 *  whether something deeper carries it. */
export function entriesUnder(map: EmbeddedMap, dir: string): FileEntry[] {
  const prefix = dir === "" ? "" : dir + "/";
  const names = new Map<string, boolean>();
  for (const key of Object.keys(map)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (rest === "") continue;
    const cut = rest.indexOf("/");
    if (cut < 0) names.set(rest, false);
    else names.set(rest.slice(0, cut), true);
  }
  return [...names]
    .map(([name, dir]) => ({ name, dir }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * A read-only `Files` over the carried map, rooted at one framework-relative
 * directory.
 *
 * THIS IS WHY THE SEEDER IS NOT EDITED. `server/workspace/presets.ts` never
 * touches a disk: it is handed `Files` and walks whatever it is given, so the
 * whole of "seed a vault out of the binary" is which implementation the
 * composition root constructs — one changed line in a root, which is what the
 * layering rule promises and this is the first place it is cashed in.
 *
 * `write`, `remove` and `commit` refuse rather than no-op. A seed root has never
 * been written to and never will be; a silent no-op would turn the day somebody
 * tries into a file that mysteriously is not there.
 */
export function makeEmbeddedFiles(map: EmbeddedMap, root: string): Files {
  const at = (rel: string, allowRoot = false): string => {
    const key = keyUnder(root, rel);
    if (key === null) throw new Error("a path may not leave the embedded root");
    if (!allowRoot && key === clean(root)) throw new Error("the root is not a file");
    return key;
  };
  // ASYNC, so the refusal is a rejected promise rather than a synchronous throw.
  // Every method of `Files` answers a promise, and a caller that awaits one is
  // entitled to be able to catch what comes back.
  const refuse = async (): Promise<never> => {
    throw new Error("the embedded files are read-only");
  };

  return {
    read: async (rel: string) => await readEmbedded(map, at(rel)),
    list: async (rel: string) => entriesUnder(map, at(rel, true)),
    write: refuse,
    remove: refuse,
    commit: refuse,
  };
}
