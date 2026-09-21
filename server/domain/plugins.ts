// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE PLUGIN FOLDER: one shape, in the three places a plugin can sit.
//
// `plugins/<id>/` IS A PLUGIN, AND THERE IS NO OTHER SHAPE. Directly inside it:
// every `.js` is the plugin's own script, loaded in name order and wrapped per
// file by the loader; `index.html`, if there is one, is the document a page
// names with `plugin: <id>`; `plugin.yaml` is its variables with their
// defaults — flat, a key and a default and nothing around them; `extensions.yaml`
// is a RUNG over a plugin of that id; and `plugins/` holds inner plugins, each
// a folder of the same shape, to any depth. The shape is the same under the
// framework's `guest/plugins/`, the vault's `plugins/` and a page's own
// `plugins/` beside its `content.yaml`, and this module is the one walk that
// reads it. A loose `plugins/reveal.js` is refused here, in a sentence naming
// the folder to move it into: a breaking change made once, and
// `mkdir plugins/reveal && mv plugins/reveal.js plugins/reveal/` is the whole
// migration.
//
// THE FOLDER IS THE ID. A folder under the framework's root is its name with
// `biom-` put on where it is missing — `frameworkPlugin` in `pages.ts` does the
// same for a document — so `biom-doc/plugins/holds/` is the contract of
// `biom-holds`; a vault's or a page's folder is its name as written. Inner ids
// are otherwise free: a script registers whatever it registers, and the folder
// is organisation rather than a namespace. Two folders of one id, at any depth
// and from any root, meet in the registry inside the box, which refuses the
// second by name.
//
// A VAULT FOLDER WEARING `biom-` IS AN EXTENSION, NOT A COPY. It holds
// `extensions.yaml` and nothing else; a script or a document in it is refused
// by name, because there are no file-based overrides any more. A workspace that
// wants a document of its own writes a plugin of its own under a bare name.
//
// THREE RUNGS, ONE KEY AT A TIME. A plugin's variables are its `plugin.yaml`
// defaults, then the vault's `plugins/<id>/extensions.yaml`, then the same
// file in the page's own `plugins/` — reaching that page only — and the
// NEAREST RUNG WINS PER KEY: a rung naming one variable changes that one and
// every other keeps the rung beneath. A variable is a scalar or a list of
// scalars, never a map, so there is nothing deeper to merge. `mergeRungs` is
// pure and `tests/plugin-folders.test.ts` walks every refusal.
//
// A VALUE IS TYPED BY ITS DEFAULT'S OWN TYPE. `true` makes a boolean, `3` a
// number, a list a list of scalars; a string is a string, and whether a string
// is a plugin id is the business of whoever reads it — the `doc` document
// refuses a `head` that is not a legal id before it mounts anything. A null or
// absent default accepts any value. A rung writing the wrong type is refused by
// name with the plugin and the key, and the page draws with the rung beneath.
//
// THE FRAMEWORK CARRIES THE VALUES AND READS NONE OF THEM. Nothing here knows
// what `head` means. The merge is handed to `pages.ts` by the composition root
// and put on the page read; a plugin reads what it wants through
// `biom.plugin.extensions()` in the box. Nothing enforces the contract at run
// time — the file is read to merge, by the checker to catch a typo, and by a
// person to know what a plugin can be told.

import type { FileEntry, Files, PluginExtension, PluginRung, VarValue, Variables } from "../../contracts/types.ts";
import { PLUGIN_NAME } from "../../contracts/types.ts";

/** A plugin's variables with their defaults — the plugin's own rung. */
export const CONTRACT = "plugin.yaml";
/** A rung over a plugin of the folder's id, in a vault or a page. */
export const EXTENSIONS = "extensions.yaml";
/** Inner plugins, and the name of every plugins root. */
export const INNER = "plugins";
/** The document a page names with `plugin: <id>`. `PAGE_DOCUMENT` in
 *  `pages.ts` is the same spelling, said there for a page's own. */
export const DOCUMENT = "index.html";
/** What the framework's own plugins are called: `OURS` in `pages.ts`, said
 *  again here because a domain module may not import its sibling. A test
 *  holds the two equal. */
export const OURS = "biom-";

/** Where a folder was read from. `framework` is `guest/plugins/`; `vault` is
 *  `<vault>/plugins/`; `page` is a page's own `plugins/` beside its
 *  `content.yaml`. */
export type PluginRoot = "framework" | "vault" | "page";

/** One plugin folder as the walk found it. */
export interface PluginFolder {
  /** The id the folder stands for: its name, `biom-`-prefixed under the
   *  framework root. */
  id: string;
  root: PluginRoot;
  /** The folder, relative to its root's plugins directory, forward-slashed:
   *  `biom-doc/plugins/holds`. */
  path: string;
  /** Script file names directly inside, in name order. */
  scripts: string[];
  /** Holds `plugin.yaml`. */
  contract: boolean;
  /** Holds `extensions.yaml`. */
  extensions: boolean;
  /** Holds `index.html`. */
  document: boolean;
  /** Wears `biom-` outside the framework: an extension folder, which holds a
   *  rung and nothing else. */
  extension: boolean;
}

/** Something in a plugins root that is not the shape, said as the sentence a
 *  person acts on. `path` is relative to the root's plugins directory; the
 *  sentence spells it under the root's words. */
export interface PluginFault {
  root: PluginRoot;
  path: string;
  message: string;
}

/** The walk of one plugins root: every folder in load order — a folder's own
 *  scripts before its inner plugins, siblings in name order — every refusal
 *  met on the way, and the words a path under this root is written with in a
 *  sentence. */
export interface PluginWalk {
  folders: PluginFolder[];
  faults: PluginFault[];
  words: string;
}

const byName = (a: FileEntry, b: FileEntry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The id a folder stands for under a root. */
export function idOf(folder: string, root: PluginRoot): string {
  return root === "framework" && !folder.startsWith(OURS) ? OURS + folder : folder;
}

/** Where a root's plugins directory is, as the words a refusal prints: the
 *  vault's is `plugins/`, a page's is its directory's `plugins/`, and the
 *  framework's is `framework/`. */
export function rootWords(root: PluginRoot, pageDir: string | null = null): string {
  if (root === "framework") return "framework";
  if (root === "page" && pageDir !== null) return `${pageDir}/${INNER}`;
  return INNER;
}

/**
 * Walk one plugins root. `files` is rooted such that `base` names the plugins
 * directory in it — `""` for the framework's own `Files`, which is rooted at
 * `guest/plugins/` already; `plugins` for a vault; `<pageDir>/plugins` for a
 * page. `words` is what a path under this root is called in a sentence —
 * `plugins`, `framework`, `pages/…/plugins`. A root that is not there is an
 * empty walk and never an error.
 */
export async function walkPlugins(files: Files, base: string, root: PluginRoot, words: string = rootWords(root)): Promise<PluginWalk> {
  const folders: PluginFolder[] = [];
  const faults: PluginFault[] = [];
  const said = (path: string): string => `${words}/${path}`;
  const rel = (path: string): string => (base === "" ? path : path === "" ? base : `${base}/${path}`);
  const listed = async (path: string): Promise<FileEntry[]> => {
    try {
      return (await files.list(rel(path) === "" ? "." : rel(path))).slice().sort(byName);
    } catch {
      return [];
    }
  };

  /** One plugins directory: `at` is its path relative to the root's own
   *  plugins directory (`""` for the root itself). */
  const level = async (at: string): Promise<void> => {
    const entries = await listed(at);
    for (const entry of entries) {
      const path = at === "" ? entry.name : `${at}/${entry.name}`;
      if (!entry.dir) {
        // A LOOSE SCRIPT IS THE OLD SHAPE, and the sentence names the folder to
        // move it into. Anything else loose — a README, a note — is left alone.
        if (entry.name.endsWith(".js")) {
          const stem = entry.name.slice(0, -3);
          faults.push({ root, path, message: `${said(path)} is a loose script — a plugin is a folder: move it into ${said(at === "" ? stem : at + "/" + stem)}/` });
        }
        continue;
      }
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      if (!PLUGIN_NAME.test(entry.name)) {
        faults.push({ root, path, message: `${said(path)}/ is not a plugin folder — a plugin's folder is its id: lowercase letters, digits and dashes` });
        continue;
      }
      await folder(path, entry.name);
    }
  };

  /** One plugin folder. */
  const folder = async (path: string, name: string): Promise<void> => {
    const inside = await listed(path);
    const has = (file: string): boolean => inside.some((e) => !e.dir && e.name === file);
    const extension = root !== "framework" && name.startsWith(OURS);
    const found: PluginFolder = {
      id: idOf(name, root),
      root,
      path,
      scripts: [],
      contract: has(CONTRACT),
      extensions: has(EXTENSIONS),
      document: has(DOCUMENT),
      extension,
    };
    if (extension) {
      // AN EXTENSION FOLDER HOLDS A RUNG AND NOTHING ELSE. There are no
      // file-based overrides: a script or a document here is a copy by another
      // name, and it is refused naming the file rather than drawn in place of
      // the framework's.
      for (const entry of inside) {
        if (!entry.dir && entry.name === EXTENSIONS) continue;
        if (entry.name.startsWith(".")) continue;
        faults.push({
          root,
          path: `${path}/${entry.name}`,
          message: `${said(path)}/ extends the framework's ${name} and may hold ${EXTENSIONS} alone — ${said(path)}/${entry.name}${entry.dir ? "/" : ""} is refused`,
        });
      }
      folders.push(found);
      return;
    }
    for (const entry of inside) if (!entry.dir && entry.name.endsWith(".js")) found.scripts.push(entry.name);
    folders.push(found);
    // ITS OWN SCRIPTS FIRST, THEN ITS INNER PLUGINS, so an inner plugin that
    // `ctx.use`s the folder's own finds it registered.
    if (inside.some((e) => e.dir && e.name === INNER)) await level(`${path}/${INNER}`);
  };

  await level("");
  return { folders, faults, words };
}

/* ── the rungs ──────────────────────────────────────────────────────────── */

/** A rung as read off disk: the values a file holds, and the sentences it
 *  earned on the way. */
export interface Rung {
  rung: PluginRung;
  values: Variables;
  faults: string[];
}

const isScalar = (v: unknown): boolean =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const isValue = (v: unknown): v is VarValue => isScalar(v) || (Array.isArray(v) && v.every(isScalar));

/** The type a default gives its key, as the word a refusal prints. Null is no
 *  type: it accepts anything. */
export function typeOf(v: VarValue): "string" | "number" | "boolean" | "list" | null {
  if (v === null) return null;
  if (Array.isArray(v)) return "list";
  return typeof v === "string" ? "string" : typeof v === "number" ? "number" : "boolean";
}

/**
 * Read a contract or a rung file's text into values. `declared` is the
 * contract this file writes over — null when the file IS the contract — and
 * decides which keys are taken and what type each may hold. Every refusal is a
 * sentence naming `file`, the plugin and the key, and the key it is about is
 * dropped rather than the file.
 */
export function readRung(
  text: string | null,
  parse: (text: string) => unknown,
  file: string,
  plugin: string,
  rung: PluginRung,
  declared: Variables | null,
): Rung {
  const out: Rung = { rung, values: {}, faults: [] };
  // AN ABSENT FILE IS AN EMPTY RUNG; so is an empty one.
  if (text === null || text.trim() === "") return out;
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    // A FILE THAT DOES NOT PARSE IS SKIPPED AND REPORTED, and the page draws
    // with the rungs beneath — as a broken `content.yaml` degrades to
    // something that opens.
    out.faults.push(`${file} could not be read: ${e instanceof Error ? e.message : String(e)} — ${declared === null ? "the plugin has no defaults" : "the rung beneath stands"}`);
    return out;
  }
  if (raw === null || raw === undefined) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    out.faults.push(`${file} is not a map of variables — a key and its value, one per line`);
    return out;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "" || key === "__proto__") continue;
    if (!isValue(value)) {
      out.faults.push(`${file}: "${key}" holds a map — a variable is a scalar or a list of scalars`);
      continue;
    }
    if (declared !== null) {
      if (!(key in declared)) {
        // A KEY THE CONTRACT DOES NOT DECLARE IS A TYPO, and it draws nothing.
        const keys = Object.keys(declared);
        out.faults.push(`${file} names "${key}", which ${plugin} does not declare — its ${CONTRACT} holds ${keys.length === 0 ? "no variables" : keys.join(", ")}`);
        continue;
      }
      const want = typeOf(declared[key] ?? null);
      const got = typeOf(value);
      if (want !== null && got !== null && want !== got) {
        out.faults.push(`${file}: "${key}" is a ${got} where ${plugin}'s ${CONTRACT} holds a ${want} — the rung beneath stands`);
        continue;
      }
    }
    out.values[key] = value;
  }
  return out;
}

/** Merge rungs, nearest last, one key at a time. The first rung is the
 *  plugin's own contract. Pure. */
export function mergeRungs(rungs: Rung[]): PluginExtension {
  const values: Variables = {};
  const from: Record<string, PluginRung> = {};
  const faults: string[] = [];
  for (const rung of rungs) {
    for (const [key, value] of Object.entries(rung.values)) {
      values[key] = value;
      from[key] = rung.rung;
    }
    for (const fault of rung.faults) faults.push(fault);
  }
  return { values, from, faults };
}

/* ── the three roots, composed ──────────────────────────────────────────── */

/** What the composition root builds once per mount: the walks, and the merge
 *  for one page. */
export interface Plugins {
  /** The framework's folders, the vault's, then the page's — in load order. */
  walks(pageDir: string | null): Promise<{ root: PluginRoot; base: string; files: Files; walk: PluginWalk }[]>;
  /** Every plugin that declares a contract, with its three rungs merged for
   *  this page: the contract, the vault's `extensions.yaml`, the page's. A
   *  vault rung over an id nothing declares is a fault under that id. */
  extensionsFor(pageDir: string | null): Promise<Record<string, PluginExtension>>;
}

/**
 * @param vault the vault's own files, rooted at the vault
 * @param framework the framework's plugins, rooted at `guest/plugins/`, or
 *   null for a module stood up alone
 * @param parse the YAML reader for a contract or a rung
 */
export function makePlugins(vault: Files, framework: Files | null, parse: (text: string) => unknown): Plugins {
  const walks: Plugins["walks"] = async (pageDir) => {
    const out: { root: PluginRoot; base: string; files: Files; walk: PluginWalk }[] = [];
    if (framework !== null) out.push({ root: "framework", base: "", files: framework, walk: await walkPlugins(framework, "", "framework") });
    out.push({ root: "vault", base: INNER, files: vault, walk: await walkPlugins(vault, INNER, "vault") });
    if (pageDir !== null) {
      const base = `${pageDir}/${INNER}`;
      out.push({ root: "page", base, files: vault, walk: await walkPlugins(vault, base, "page", base) });
    }
    return out;
  };

  const extensionsFor: Plugins["extensionsFor"] = async (pageDir) => {
    const roots = await walks(pageDir);
    // THE CONTRACTS FIRST, from every root: a page's own plugin has defaults
    // exactly as the framework's does.
    const contracts = new Map<string, { rung: Rung; where: string }>();
    for (const { root, base, files, walk } of roots) {
      for (const folder of walk.folders) {
        if (!folder.contract || folder.extension) continue;
        const file = `${walk.words}/${folder.path}/${CONTRACT}`;
        const text = await files.read(base === "" ? `${folder.path}/${CONTRACT}` : `${base}/${folder.path}/${CONTRACT}`);
        contracts.set(folder.id, { rung: readRung(text, parse, file, folder.id, "plugin", null), where: file });
      }
    }
    // THEN THE RUNGS, vault before page, so the page's wins.
    const rungs = new Map<string, Rung[]>();
    for (const [id, { rung }] of contracts) rungs.set(id, [rung]);
    const strays: Record<string, PluginExtension> = {};
    for (const { root, base, files, walk } of roots) {
      if (root === "framework") continue;
      const rung: PluginRung = root;
      for (const folder of walk.folders) {
        if (!folder.extensions) continue;
        const file = `${walk.words}/${folder.path}/${EXTENSIONS}`;
        const held = contracts.get(folder.id);
        if (held === undefined) {
          const message = `${file} extends "${folder.id}", which declares no ${CONTRACT} — there is nothing to extend`;
          const had = strays[folder.id];
          strays[folder.id] = { values: {}, from: {}, faults: [...(had ? had.faults : []), message] };
          continue;
        }
        const text = await files.read(base === "" ? `${folder.path}/${EXTENSIONS}` : `${base}/${folder.path}/${EXTENSIONS}`);
        rungs.get(folder.id)!.push(readRung(text, parse, file, folder.id, rung, held.rung.values));
      }
    }
    const out: Record<string, PluginExtension> = {};
    for (const [id, list] of rungs) out[id] = mergeRungs(list);
    for (const [id, stray] of Object.entries(strays)) out[id] = stray;
    return out;
  };

  return { walks, extensionsFor };
}
