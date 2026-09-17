// SPDX-License-Identifier: AGPL-3.0-only
// Layer 5 — the composition root. The only module in the server that constructs
// anything, and nothing in the server or the client imports it.
//
// Everything below receives its dependencies as arguments, which is what makes
// "replace a module without touching others" literally true: a swap is one
// changed line in this file. Read it as the list it is.
//
// It builds that list ONCE PER FOLDER, and that is the one thing here worth
// reading slowly. The workspace folder is chosen in the UI, and this process
// holds every one that has been asked for — a Files, a Db and everything above
// them, per vault, kept beside each other rather than replacing each other.
// Nothing below this layer can do that, which is why `Vault` is implemented
// here and handed down rather than reached for.
//
// THE MAP HOLDS PROMISES, NOT MOUNTS, and that is not a detail. Two requests for
// the same folder arriving together must share one mount: two would mean two
// database handles on one file, two seeders writing the same tree, and — worst —
// two format migrations walking it at once, which is the one thing migrate.ts is
// not safe against. Storing the promise makes the second caller await the first
// rather than start a second, so the race cannot be lost because it is never
// run. Nothing is ever evicted: a handle is cheap, a vault somebody opened is
// one they are working in, and a cache with a lifetime is a bug with a schedule.
//
//   make dev      →  http://localhost:4400
//   make fresh    →  drop the per-user default vault; the next run reseeds

import { hasHistory, initVault, makeFiles, makeSeen, within } from "./platform/files.ts";
import type { Seen } from "./platform/files.ts";
import { SETTLE, insideOf, watchTree, watched } from "./platform/watch.ts";
import type { Watcher } from "./platform/watch.ts";
import {
  NOTHING_EMBEDDED,
  isEmbedded,
  makeEmbeddedFiles,
  readEmbedded,
} from "./platform/embedded.ts";
import type { EmbeddedMap } from "./platform/embedded.ts";
import { NOTHING_SHIPPED, shippedHashes } from "./platform/shipped.ts";
import type { Shipped } from "./platform/shipped.ts";
import { SHIPPED_DIRS, mirrorPlugins, rewriteOwned, sweepOldSkills, sweepShipped } from "./workspace/framework.ts";
import { makeDb } from "./platform/db.ts";
import { parse, parseAny, format } from "./platform/yaml.ts";
import { scaleOf } from "../contracts/scale.ts";
import { makeDesign } from "./domain/design.ts";
import { DEFAULT_SECTION, DEFAULT_SECTION_FILE, DOC_PLUGIN_DOCUMENT, PAGE_DOC, PAGE_DOCUMENT, PLUGINS_DIR, PLUGINS_DIR_VAULT, ROOT_PAGE_FILE, ROOT_PAGE_STANDIN, makePages } from "./domain/pages.ts";
import { makeDocs } from "./domain/docs.ts";
import { follow, makeMirror, pageAt, rebuild } from "./domain/mirror.ts";
import { makeTables } from "./domain/tables.ts";
import { checkVaultFormat } from "./workspace/migrate.ts";
import { makePresets, makeTheme } from "./workspace/presets.ts";
import {
  bootVault,
  browse,
  createVault,
  infoOf,
  makeVaultMemory,
  memoryFile,
  nearest,
  openable,
  seeded,
  usable,
} from "./workspace/vault.ts";
import { mirrored, route } from "./api/routes.ts";
import type { Deps } from "./api/routes.ts";
import type { Db } from "../contracts/types.ts";
import type { Files } from "../contracts/types.ts";
import type { DirListing } from "../contracts/types.ts";
import type { PageId } from "../contracts/types.ts";
import type { Vault } from "../contracts/types.ts";
import type { VaultInfo } from "../contracts/types.ts";
import { API_ROUTE, ERRORS, EVENTS_ROUTE, PROTOCOL, SHIM_ROUTE, fail, vaultOf } from "../contracts/wire.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// NOTHING THE SERVER RUNS IS A DEPENDENCY, and that is deliberate: what
// package.json declares is build and test tooling — typescript, Playwright,
// Electron and the packager — which `types`, `browser`, `test` and `app` fetch
// and the server touches none of. So the bun globals this file uses are declared
// here rather than pulled in as types.
declare const Bun: {
  env: Record<string, string | undefined>;
  file(path: string): { exists(): Promise<boolean>; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> };
  // Read for its ENDING rather than its content — see `exitWhenTheParentGoes`.
  stdin: { stream(): AsyncIterable<Uint8Array> };
  serve(options: {
    port: number;
    idleTimeout: number;
    fetch: (request: Request) => Promise<Response> | Response;
  }): { port: number };
};
// READ FOR EXACTLY ONE KEY, and the expression below is the whole mechanism. A
// compiled build substitutes that member expression at compile time with
// `--define`, so the binary carries a string literal there and consults no
// environment at all; a source run finds nothing substituted and reads the real
// process environment. One spelling, both sources, and nothing else anywhere in
// the server may name the key.
// `exit` is beside it because the one thing this process does about a parent
// that has gone is stop being a process.
declare const process: { env: Record<string, string | undefined>; exit(code: number): never };

/* ── which build this is ────────────────────────────────────────────────── */

/** The three values, and nothing else is one. `development` and `test` show
 *  everything and refuse nothing; `production` is the only one that hides or
 *  refuses anything at all. */
export type Environment = "development" | "test" | "production";

/** Read a `BIOM_ENV` into one of the three.
 *
 *  UNSET IS `development`, because a source tree is where this file is read
 *  without a define and a stranger's binary always carries one. Anything else
 *  that is not one of the three is `production`: a typo in a build script must
 *  fail towards hiding rather than towards shipping a developer's screens to
 *  somebody who cannot use them. It says so once, on stderr, because a build
 *  that silently meant something other than what it said is the failure this
 *  direction trades for. */
export function environment(named: string | undefined): Environment {
  const value = (named ?? "").trim();
  if (value === "") return "development";
  if (value === "development" || value === "test" || value === "production") return value;
  console.warn(`BIOM_ENV is "${value}", which is none of development, test or production — reading it as production`);
  return "production";
}

// THE ONE READ. Below this line the value is an ordinary dependency: `Deps`
// carries it into the API layer and the document served at `/` carries it to the
// client, and no other module in the server asks an environment a question.
const ENV = environment(process.env.BIOM_ENV);
const PRODUCTION = ENV === "production";

// THE INSTALL DIRECTORY, AND IT IS A PATH RATHER THAN A URL. `.pathname` off a
// `file:` URL is percent-ENCODED, so an install under `/My Documents/` came out
// as `/My%20Documents/` and every read of the client, the guest modules and the
// vendored scripts missed; on Windows it is `/C:/…`, which no filesystem call
// takes. `fileURLToPath` answers both, and every join below goes through `path`
// for the same reason. It keeps its trailing separator, which `join` absorbs.
const HERE = fileURLToPath(new URL("../", import.meta.url));

/** The specifier `carriedFiles` imports, spelled a second time so the catch can
 *  tell "there is no manifest" from "the manifest is broken". It cannot be read
 *  off the import, because the import has to stay a literal. */
export const MANIFEST_MODULE = "../dist/embedded.ts";

/** Is this failure "there is no manifest", which is a clone that has never built
 *  the application and is the ordinary case?
 *
 *  ANYTHING ELSE IS A BROKEN BUILD AND MUST NOT LOOK LIKE THIS ONE. A manifest
 *  whose own `./files/…` imports are gone raises the SAME `ERR_MODULE_NOT_FOUND`
 *  about a different specifier, and a half-written one raises a build error with
 *  no code at all; swallowed, both come back as "nothing is carried" and a
 *  binary that can serve nothing boots quietly and stays quiet. */
export function noManifest(why: unknown): boolean {
  const it = why as { code?: string; specifier?: string } | null;
  return it?.code === "ERR_MODULE_NOT_FOUND" && it.specifier === MANIFEST_MODULE;
}

/** WHAT THIS PROGRAM CARRIES, or nothing at all.
 *
 *  A compiled binary has no directory beside it, so everything the server serves
 *  travels inside it — `tools/app.ts` generates `dist/embedded.ts` and
 *  `bun build --compile` swallows it. Run from source there is no such file, and
 *  that is the ordinary case: a stranger's first `make dev` has
 *  generated nothing and must serve every file off disk exactly as it does today.
 *
 *  THE ONE DYNAMIC IMPORT. `AGENTS.md` allows exactly this case — an
 *  optional bundle loaded on demand, reported by the layering gate rather than
 *  failed — and this is the case it was written for. `tools/layers.mjs` names
 *  this specifier, so `make check` prints a note saying which bundle it is.
 *
 *  THE SPECIFIER IS A LITERAL AND HAS TO BE. `bun build --compile` bundles what
 *  it can SEE, so a computed specifier is a module it silently leaves out — and
 *  the binary that comes back carries nothing, serves nothing, and says so only
 *  at boot. What that costs is paid in `tools/app.ts` instead: every carried file
 *  is copied under `dist/files/` with a suffix, so this literal reaches a module
 *  that imports nothing `tsc` will follow.
 *
 *  THE SPECIFIER IS SPELLED TWICE, and it has to be. The import is a literal for
 *  the reason above; the constant beside it is what the catch compares against,
 *  and the two are one string apart. A test holds them equal.
 *
 *  Nothing below asks an environment variable whether it is compiled. The
 *  composition root asks whether anything is embedded, which is a fact about the
 *  build rather than a flag somebody has to know to set. */
async function carriedFiles(): Promise<{ files: EmbeddedMap; shipped: Shipped }> {
  try {
    const mod = (await import("../dist/embedded.ts")) as { FILES?: EmbeddedMap; SHIPPED?: Shipped };
    return { files: mod.FILES ?? NOTHING_EMBEDDED, shipped: mod.SHIPPED ?? NOTHING_SHIPPED };
  } catch (why) {
    // ONE FAILURE IS THE ORDINARY CASE AND EVERY OTHER ONE IS A BROKEN BUILD.
    // There is no such module, which is a clone that has never built the
    // application — the common path, and the one this whole `try` exists for.
    //
    // A bare `catch` made the rest indistinguishable from it: a manifest whose
    // own `./files/…` imports are gone, or one left half-written, came back as
    // "nothing is carried" and the compiled binary that produced it went on to
    // serve nothing while reporting nothing. The SPECIFIER is what separates the
    // two, because both arrive as `ERR_MODULE_NOT_FOUND` and only one of them is
    // about this import.
    if (noManifest(why)) return { files: NOTHING_EMBEDDED, shipped: NOTHING_SHIPPED };
    throw why;
  }
}

/** WHICH FRAMEWORK THIS IS, for a commit message and nothing else. Read out of
 *  `package.json` beside the program in a checkout; a compiled binary has no
 *  such file beside it and says so in the one word it has. It is not `BIOM_ENV`
 *  and must not become a switch: nothing below asks it a question. */
async function frameworkVersion(): Promise<string> {
  try {
    const text = await Bun.file(join(HERE, "package.json")).text();
    const version = (JSON.parse(text) as { version?: unknown }).version;
    return typeof version === "string" && version !== "" ? `framework ${version}` : "the framework";
  } catch {
    return "the framework";
  }
}

const BUILT = await carriedFiles();
const CARRIED = BUILT.files;
/** EVERY VERSION OF EVERY PLUGIN THIS BUILD'S REPOSITORY EVER SHIPPED, by blob
 *  hash, generated by `tools/app.ts` beside the manifest and carried the same
 *  way — a binary has no `.git` to ask. A run from source has one, and asks it
 *  instead; see `shipped()` in `makeHost`. */
const SHIPPED_BUILT = BUILT.shipped;

/** WHICH MAP A HOST READS ITS OWN FILES OUT OF. One question, one answer, and
 *  every reader below takes it — the default section, the shipped plugin
 *  documents, and the seed root all used to be handed the raw manifest while
 *  the static routes asked this.
 *
 *  A DIRECTORY BESIDE THE PROGRAM WINS OVER ANYTHING THE BUILD LEFT BEHIND, and
 *  that is the whole of it. A checkout that has run `make app` — or, since the
 *  manifest became part of `make check`, one that has merely typechecked — has a
 *  map in `dist/` pointing at the COPIES that build took. Reading those in
 *  `make dev` means editing `guest/sections/default.html`, pressing reload, and
 *  seeing yesterday's file, silently, which is the one failure this repository
 *  refuses to have.
 *
 *  @param named the map a caller handed in. A test stands a host up on carried
 *    files without compiling anything by naming one, and it always wins.
 *  @param beside is there a directory beside this program — `!STANDALONE`.
 *  @param built what the build carried, which may be a stale development
 *    artifact rather than a compiled binary's cargo. */
export function hostFiles(named: EmbeddedMap | undefined, beside: boolean, built: EmbeddedMap): EmbeddedMap {
  if (named !== undefined) return named;
  return beside ? NOTHING_EMBEDDED : built;
}

/** IS THERE A DIRECTORY BESIDE THIS PROGRAM? That is the whole question, and it
 *  is asked of the disk rather than of an environment variable or a build flag.
 *  A compiled binary's own `import.meta.url` resolves inside bun's virtual
 *  filesystem, so nothing of the framework is next to it; a checkout has
 *  `client/` sitting right there.
 *
 *  IT IS NOT THE SAME QUESTION AS "is anything embedded", and the difference is a
 *  developer who ran `make app` once. That leaves a manifest in `dist/`, so the
 *  next `make dev` reads its files through the map — which is harmless, because
 *  every value in it is a path on disk — and it must NOT also move the port and
 *  mint a token, because the development server is the one somebody opens by
 *  typing a url. Port 0 and the token hang off this line and off nothing else. */
const STANDALONE = !existsSync(join(HERE, "client"));
// A DEVELOPMENT SERVER KEEPS ITS PORT, and the built application never has one.
// A bookmark that works twice is the whole of the argument for 4400 here; a
// collision nobody can predict is the whole of the argument for 0 there, where
// the shell is told the answer rather than guessing it.
const PORT = Number(Bun.env.PORT ?? (STANDALONE ? 0 : 4400));
// NOTHING IS WRITTEN BESIDE THE INSTALL. The remembered list is the only path
// this server writes that is not inside a vault somebody named, and it lives in
// the per-user data directory `vault.ts` resolves — because a program in
// `/Applications` cannot write next to itself, and one that can has just seeded
// a workspace into somebody's source tree.
const PRESETS = join(HERE, "presets");
// What a vault gets at its ROOT, mirroring the vault root layout: `AGENTS.md`,
// `.agents/skills/` and `design/`. A Biom vault is a folder somebody points Claude
// Code, Cursor or Codex at directly, so the format guide has to be IN the
// folder — a guide that lives in this repo is one the agent working in
// somebody else's vault never sees.
const VAULT_SEED = join(HERE, "vault");
// The checker stays here as the source of truth — the repo's own tests import it
// from `skill/` — and a copy travels into each vault as `.agents/skills/check.ts` so an
// agent working in one can run it.
const SKILL = join(HERE, "skill");
// THE FRAMEWORK'S OWN PLUGINS, as the fallback rung rather than a seed root.
// `guest/plugins/` is read for any plugin a vault's own `plugins/` has not got,
// served to the box at `/v/<enc>/plugin/…` behind the vault's own files, and
// mirrored into every vault's `docs/plugins/` on open so a person can read it.
// `/guest/plugins/` itself is still not served: one url per plugin.
const PLUGIN_ROOT = join(HERE, PLUGINS_DIR);
// In the per-user data directory and never inside a vault: it is about vaults,
// so it cannot live in one. `VAULTS` stays the override, because a test must
// never write the developer's own list.
const MEMORY = Bun.env.VAULTS ?? memoryFile();
/** The workspace-wide markdown type scale, at the vault root beside `theme.json`. */
const HOUSE_SCALE = "markdown.yaml";

/* ── what a host is made of ─────────────────────────────────────────────── */

export interface HostPaths {
  /** The vault to open on boot, or nothing at all. Created and seeded if it is
   *  not there yet — that is not the ordinary first run any more and it is still
   *  why this one is not checked the way a folder somebody PICKED is: it is
   *  `VAULT=` in the environment, or the folder this machine was last in.
   *
   *  OMITTED IS A FIRST LAUNCH. Nothing is mounted, nothing is written anywhere
   *  on disk, and the unprefixed route answers the three kinds that are about
   *  vaults rather than in one — which is exactly the state the picker opens on.
   *  There is no invented folder to fall back to: a path chosen for somebody is a
   *  decision made about a directory they have not looked at. */
  vault?: string;
  /** Where the choice is remembered. One small JSON file in the per-user data
   *  directory — never beside the install, and never inside a vault. */
  memory: string;
  /** `presets/` as it ships. Read, never written. Nothing ships one right now —
   *  the catalogue that used to fill it went with the render layer it was
   *  written against — but `install` is still how a page gets made out of a
   *  directory somebody wrote. */
  presets: string;
  /** `vault/` as it ships — `AGENTS.md`, `.agents/skills/` and `design/`, mirroring the
   *  vault root layout. Defaulted rather than required so a caller that stood a
   *  host up before any of this existed still compiles and still gets it. */
  vaultSeed?: string;
  /** `skill/` as it ships. Only `check.ts` travels, as `.agents/skills/check.ts`. */
  skill?: string;
  /** The framework root, read for the two modules `check.ts` imports so the copy
   *  in a vault can actually load. Defaults to this directory. */
  checkerLib?: string;
  /** `guest/plugins/` as it ships: the fallback rung a page's document and a
   *  slot plugin are resolved from when the vault has no file at that path, and
   *  what `docs/plugins/` is mirrored from on open. Defaulted for the same
   *  reason the roots above are. */
  pluginRoot?: string;
  /** Every version of every plugin the framework ever shipped, by blob hash —
   *  what the sweep on open checks a vault's copies against. Defaults to what
   *  this build carried, or to the git history beside a source run. A test
   *  hands one in to say exactly what counts as shipped. */
  shipped?: Shipped;
  /** WHAT THE PROGRAM CARRIES, when it was compiled with its files inside it.
   *  Given one, every path above is ignored and the seed roots are read out of
   *  the map instead. Defaults to whatever this build embedded, which is nothing
   *  at all when it was run from source. */
  carried?: EmbeddedMap;
  /** WHICH BUILD THIS IS, as the only thing the API layer needs to know about
   *  it: production refuses kinds that every other build answers. Which ones is
   *  not stated here and must not be — `server/api/routes.ts` is where the
   *  refusals are written, one `deps.production` arm each, and one of them is
   *  held behind `NATIVE_DIALOG` there, so a count copied into this comment
   *  would be wrong on the day that constant flips. Not required, so a caller
   *  that stood a host up before this existed still compiles and still gets the
   *  development behaviour. */
  production?: boolean;
}

export interface Host {
  /** WHY THE FOLDER THIS RUN WAS POINTED AT DID NOT OPEN, or null when it opened
   *  or when there was none to open.
   *
   *  A HOST IS ALWAYS BUILT. It used to reject — the boot mount was an unguarded
   *  `await` in the composition root — so a workspace in an older format, one
   *  whose folder had become a file, one that could not be read and one whose
   *  `workspace.db` was not a database each killed the process on the way up,
   *  with a stack trace on stderr and no window. None of those is a reason for
   *  the program not to run: the picker is reachable with nothing mounted, and
   *  it is the one screen that can fix any of them. So the failure is a value
   *  now, said once by whoever is holding a terminal, and everything else about
   *  the run is exactly a first launch. */
  trouble: string | null;
  /** The three questions that are ABOUT vaults rather than in one, answerable
   *  before any folder has been chosen — which is what makes the picker
   *  reachable on a first run. `info()` is not among them and fails here. */
  vault: Vault;
  /** The modules built against ONE folder, mounting it if this is the first ask.
   *  Rejects for a folder that cannot be a workspace, carrying the domain's own
   *  sentence, so a bad address 404s rather than seeding somebody's directory.
   *
   *  WITH NO PATH it hands back the set that refuses everything except the three
   *  kinds that are about vaults rather than in one. That is not a degraded
   *  mode — it is the request that has not chosen a folder yet, which is how the
   *  picker is reachable on a first run. */
  deps(path?: string): Promise<Deps>;
  /** THE FRAMEWORK'S OWN PLUGINS, read-only, the same set every mount falls back
   *  to. The routes read it for the loader's bundle and for a plugin file the
   *  vault has not got. */
  pluginRoot: Files;
  /** THE BACKGROUND WORK OF ONE MOUNT — the mirror into `docs/plugins/` and the
   *  sweep of unedited copies — as a promise a caller can wait on. Nothing a
   *  page draws waits on it; a test does. Resolves for a folder that is not
   *  mounted, because there is nothing to wait for. */
  settled(path: string): Promise<void>;
  /** The vaults mounted right now, absolute. The tests read it to prove that
   *  asking for one folder did not quietly mount another. */
  open(): string[];
  /** LISTEN FOR AN OUTSIDE CHANGE to one folder. `hear` is called after a burst
   *  of filesystem notifications has settled and at least one of them turned out
   *  to be content this process did not write. It carries nothing: the client
   *  answers by rereading disk, because a payload naming files would be a
   *  second, faster description of the workspace that can disagree with the
   *  first.
   *
   *  THE WATCHER'S LIFETIME IS THE SUBSCRIPTION'S, not the mount's. Mounting
   *  does not unmount — nothing is ever evicted from the registry — so there is
   *  no moment at which a vault closes and no event to hang a release on. The
   *  subscriber count is the one lifetime this code can actually offer, and it
   *  makes the requirement testable: open a stream, close it, assert the handles
   *  are gone.
   *
   *  Answers the function that unsubscribes. Calling it twice is harmless. */
  watch(path: string, hear: () => void): Promise<() => void>;
  /** The vaults with a live watcher on them right now, absolute, and the
   *  directories each one holds open. The tests read it; nothing else does. */
  watching(): { path: string; handles: string[] }[];
  /** Release every database handle. The server never calls it; a test that
   *  stood a host up does. */
  close(): void;
}

/** Everything one vault needs, and the handle that has to be closed when the
 *  process is done with it. */
interface Mounted {
  path: string;
  db: Db;
  /** THIS VAULT'S CONTENT BASELINE — what this process last wrote into, or last
   *  read out of, every file under it. It is how the watcher tells an agent's
   *  write from the app's own: `files.ts` keeps it current, and the settle below
   *  is the only thing that compares. */
  seen: Seen;
  deps: Omit<Deps, "vault" | "production">;
  /** See `Host.settled`. Set by `hold` once the mount has answered. */
  settled: Promise<void>;
  /** The vault's own files, held for the work `hold` starts after the mount. */
  files: Files;
}

/** Does this file parse? A half-written `content.yaml` is a normal intermediate
 *  state of somebody else's editor, and the rule for one is that the drawn page
 *  is left alone AND the baseline is left unchanged — so the completed write
 *  reads as changed on the next notification rather than as more of the same.
 *
 *  Only the two formats the host actually parses are checked. Everything else —
 *  a section's html, a picture, a markdown part inside a page's directory — has
 *  no parse to fail and counts as changed on its content alone. */
function parses(rel: string, text: string): boolean {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  const yaml = /\.ya?ml$/.test(name);
  const json = /\.json$/.test(name);
  if (!yaml && !json) return true;
  // An empty file is the first half of every write-then-flush, and YAML reads
  // one as a valid empty document — which would let the torn state through.
  if (text.trim() === "") return false;
  try {
    if (yaml) parseAny(text);
    else JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** ONE SENTENCE OUT OF WHATEVER WAS THROWN, for the two places a mount failure
 *  is REPORTED rather than propagated: the boot line, and the answer to a
 *  request that named a folder which will not open.
 *
 *  The domain's own refusals carry a sentence written for the person and one of
 *  the contract's closed codes. Everything else is node, bun:sqlite or git
 *  arriving with an errno and a stack, and the honest thing to say about one of
 *  those is that it did not open — the detail is on stderr, where the frames
 *  are, and a `SQLITE_CANTOPEN` on a screen is a person deciding the program is
 *  broken and they cannot tell why. The first line only: `checkVaultFormat`
 *  throws a paragraph with a command in it, which belongs in a terminal and not
 *  on a strip. */
function sentenceOf(e: unknown): string {
  const generic = "that folder could not be opened as a workspace";
  // A CLOSED CODE IS WHAT MAKES A MESSAGE SAYABLE. Everything this framework
  // refuses on purpose carries one, and carries a sentence written for the
  // person beside it; everything else is node, bun:sqlite or git arriving with
  // an errno, a path and a stack, and none of that is a sentence — `EEXIST:
  // file already exists, mkdir '/home/…'` on a screen is somebody deciding the
  // program is broken and being unable to say why.
  const code = (e as { code?: unknown })?.code;
  if (typeof code !== "string" || !CODES.has(code)) return generic;
  // COLLAPSED RATHER THAN TRUNCATED. The format gate's refusal is a paragraph
  // with the converter's command in it — the one actionable thing in it — so
  // taking the first line would drop exactly the half worth reading. A strip is
  // one line of wrapping text, so what it needs is a string with no newlines in
  // it, not a shorter string.
  const message = (e instanceof Error ? e.message : "").replace(/\s+/g, " ").trim();
  return message === "" ? generic : message;
}

/** The contract's closed error codes, as a set, for the one question
 *  `sentenceOf` asks: is this a refusal this framework wrote, or is it an errno
 *  wearing the same field name? */
const CODES: ReadonlySet<string> = new Set(Object.values(ERRORS));

/** The modules, for a request that named no folder. Every one of them refuses.
 *
 *  A kind that reads or writes a workspace cannot be answered without one, and
 *  answering it out of the most recently opened folder would be answering about
 *  somebody else's tab — which is the exact bug this whole change removes. So
 *  the unprefixed route carries a set that says no to everything, and the only
 *  member that is real is `vault`, which is precisely the three kinds that are
 *  about vaults rather than in one.
 *
 *  A proxy rather than six hand-written stubs, because the alternative is sixty
 *  methods that have to be kept in step with six interfaces and would be a list
 *  of ways to forget one. Reaching for any of them throws before it can touch a
 *  disk, which is the only property this needs to have. */
function refuses<T extends object>(why: string, code = "bad_request"): T {
  const deny = (): never => {
    throw Object.assign(new Error(why), { code });
  };
  return new Proxy({} as T, { get: () => deny });
}

/** Every module refusing with one sentence. `NO_VAULT` is this with the sentence
 *  for a request that named no folder; a folder that WILL not mount gets the
 *  same shape carrying the reason it would not.
 *
 *  ONE SENTENCE FOR THE WHOLE SET, and that is the point of building it here
 *  rather than per module: whichever call a screen happens to make first, it
 *  gets the same words, so a person is never shown two different accounts of one
 *  failure. */
const refusing = (why: string, code?: string): Omit<Deps, "vault" | "production"> => ({
  pages: refuses(why, code),
  design: refuses(why, code),
  docs: refuses(why, code),
  tables: refuses(why, code),
  presets: refuses(why, code),
  theme: refuses(why, code),
  mirror: refuses(why, code),
});

const NO_VAULT = refusing("this request names no workspace");

/**
 * Build the whole server against `at.vault`, and hand back the thing that can
 * do it again against a different folder.
 */
export async function makeHost(at: HostPaths): Promise<Host> {
  const memory = makeVaultMemory(at.memory);
  // Carried once into every Deps this host hands out, development by default.
  const production = at.production === true;
  // THE SHIPPED DEFAULT SECTION, read once. It belongs to the framework rather
  // than to any vault — nothing may import `guest/`, so the composition root is
  // what fetches it and hands it down, and both readers of the format get the
  // same string from the same place.
  //
  // Read once and not per request, so editing it needs a restart. That is the
  // deal every server file has, and it is not the client's reload loop: this
  // file is never served, it is INLINED into the `page.read` answer, because the
  // runtime that draws it lives in an opaque-origin frame and cannot fetch.
  // WHAT THIS HOST READS ITS OWN FILES OUT OF, decided ONCE and read by every
  // reader below. `hostFiles` is the same question the static routes ask, asked
  // in one place: a directory beside the program means the disk, whatever a
  // previous `make app` happened to leave in `dist/`.
  const carried = hostFiles(at.carried, !STANDALONE, CARRIED);
  // Falls out of the map rather than being decided a second time. It used to be
  // its own expression, and the two disagreed in exactly the case this whole
  // mechanism exists to get right — a checkout that has built the application
  // once served the default section and every shipped plugin document out of
  // `dist/files/`, so editing one and pressing reload showed yesterday's file.
  const embedded = isEmbedded(carried);
  const section = await defaultSection(carried);
  const rootPage = await rootPageMarkup(carried);

  /** A READ-ONLY SEED ROOT, out of the binary or off the disk. This is the one
   *  line the whole "seed a vault out of a compiled program" story comes down
   *  to: `presets.ts` is handed `Files` and never touches a disk itself, so
   *  which implementation it gets is the composition root's business and
   *  nothing of the seeder's. `seedVaultRoot`, `walk` and `seedChecker` go on
   *  reading what they are given. */
  const seedRoot = (root: string, path: string) =>
    embedded ? makeEmbeddedFiles(carried, root) : makeFiles(path);

  /** THE FRAMEWORK'S OWN PLUGINS, one read-only root for every mount. Built
   *  once here rather than per vault because it is the same set whichever
   *  folder is open — the routes read it too, through `Host.pluginRoot`. */
  const pluginRoot = seedRoot(PLUGINS_DIR, at.pluginRoot ?? PLUGIN_ROOT);

  /** WHAT COUNTS AS SHIPPED, asked once and late. A build carries the list; a
   *  run from source asks the git history beside it, which costs a few `git`
   *  calls and is why it is not asked until the first mount's background work
   *  wants it. A caller that handed a list in gets that list. */
  let shippedOnce: Promise<Shipped> | null = null;
  const shipped = (): Promise<Shipped> => {
    if (shippedOnce === null) {
      shippedOnce = at.shipped !== undefined
        ? Promise.resolve(at.shipped)
        : embedded ? Promise.resolve(SHIPPED_BUILT) : shippedHashes(HERE, SHIPPED_DIRS);
    }
    return shippedOnce;
  };

  /** THE THREE ROOTS THE FRAMEWORK OWNS INSIDE A VAULT, read-only, built once.
   *  `vaultSeed` for the skills as they ship, `skill` for the checker, and the
   *  framework itself for the modules the checker imports. The seeder is handed
   *  the first for everything else at the vault root. */
  const skillsSeed = seedRoot("vault", at.vaultSeed ?? VAULT_SEED);
  const checkerSeed = seedRoot("skill", at.skill ?? SKILL);
  const checkerLibSeed = seedRoot("", at.checkerLib ?? HERE);

  /** THE WORK AFTER A MOUNT, off the mount path on purpose: a page draws from
   *  the framework's plugins the instant the vault is open, so nothing here is
   *  anything a page waits for. First the skills, so an agent pointed at the
   *  folder reads the framework's current ones; then the mirror, so what a
   *  person can read is current; then the sweep, so what they never edited
   *  stops being a stale copy. Each failure is a sentence in the log and never
   *  a mount that did not happen — a folder whose `docs/` cannot be written is
   *  still a workspace. */
  async function afterMount(files: Files): Promise<void> {
    try {
      const written = await rewriteOwned(files, skillsSeed, checkerSeed, checkerLibSeed, await shipped());
      // A copy under the name a skill had before it wore the prefix, unedited,
      // goes with the same commit — otherwise a vault carries the skill twice.
      const gone = await sweepOldSkills(files, skillsSeed, await shipped());
      for (const rel of gone) console.log(`skills  →  ${rel} was the framework's own under its old name, unedited, and is gone`);
      if (written || gone.length > 0) {
        await files.commit(`The framework's guide, docs, skills and checker, as ${await frameworkVersion()} ships them`);
      }
    } catch (e) {
      console.warn("the framework's skills could not be written into .agents/skills/", e);
    }
    try {
      await mirrorPlugins(files, pluginRoot);
    } catch (e) {
      console.warn("the plugin mirror in docs/plugins/ could not be written", e);
    }
    try {
      const gone = await sweepShipped(files, await shipped());
      if (gone.length > 0) {
        for (const rel of gone) console.log(`plugins  →  ${rel} was the framework's own, unedited, and now follows the framework`);
        await files.commit("The framework's unedited plugin copies removed; the framework's own draw instead");
      }
    } catch (e) {
      console.warn("the vault's plugins could not be checked against the framework's history", e);
    }
  }

  /** THE LIST. Every module in the server, constructed against one folder.
   *  Called once on boot and once per `open`, which is what makes the vault
   *  swappable at all — there is no state above this to migrate, because
   *  everything above is built out of what this returns. */
  async function mount(where: string): Promise<Mounted> {
    // Absolute from here down. `VAULT=./somewhere` is a perfectly ordinary
    // thing to type, and the path is compared against a resolved one every time
    // a vault is opened — two spellings of one folder would swap it for itself.
    const path = resolve(where);
    // Asked BEFORE anything is written, because seeding is what makes it true
    // and the answer decides whether this run gets a base commit.
    const fresh = !seeded(path);

    // The vault is a git repo, so undo exists without an undo mechanism being
    // built. This runs first because it creates the directory, and both
    // makeFiles and makeDb want one to exist.
    await initVault(path);

    // ONE BASELINE PER FOLDER, handed to every `Files` rooted inside it — the
    // vault's own and the design doc's, which is rooted a level down and would
    // otherwise keep a second, disagreeing memory of the same disk.
    const seen = makeSeen();
    const files = makeFiles(path, seen);

    // THE FORMAT GATE, AND ITS PLACE IN THE LIST IS THE WHOLE OF IT: after
    // `initVault`, so there is a directory to walk, and BEFORE a single module
    // that reads the vault is constructed. A workspace in an older format must
    // never be observable — not by a page read, not by the seeder, not by the
    // checker — so nothing that could look is built until this returns.
    //
    // It converts nothing and it writes nothing. There is no path from the
    // format that had a render to the one that has sections, because a section
    // IS its markup and that markup lived in the render layer rather than in the
    // vault; so an old workspace refuses out loud instead of half-opening.
    // migrate.ts carries the whole of that argument.
    try {
      await checkVaultFormat(path);
    } catch (e) {
      // Named here rather than in the message, which crosses into the API and
      // must never carry a path. This is the log, and the log is where somebody
      // finds out WHICH page gave the vault away.
      const where = (e as { where?: unknown }).where;
      if (Array.isArray(where)) for (const rel of where) console.error(`vault format  →  ${String(rel)}`);
      throw e;
    }

    const db = makeDb(join(path, "workspace.db"));
    try {
      return await build(path, db, seen, files, fresh);
    } catch (e) {
      // THE HANDLE GOES BACK WHEN THE MOUNT DOES NOT HAPPEN. Everything below
      // this line can throw — a database locked by another process, one written
      // by a newer build, a disk that filled between two writes — and an open
      // SQLite handle on a file nobody is serving is a lock held for the life of
      // the process against a folder the person is about to try again.
      db.close();
      throw e;
    }
  }

  /** THE REST OF THE MOUNT, once the database is open. It is a function of its
   *  own for one reason: everything in it may throw, and the one thing that has
   *  to happen when it does is above. */
  async function build(path: string, db: Db, seen: Seen, files: Files, fresh: boolean): Promise<Mounted> {
    const yaml = { parse, parseAny, format };
    const tables = makeTables(db);
    const pages = makePages(files, yaml, () => tables.list(), section, basename(path), rootPage, pluginRoot);
    // Rooted at `design/` rather than at the vault: the design doc is ONE page
    // and it sits beside `pages/`, so the module reads its `content.yaml` and
    // its sections from the root of what it is handed. That placement is what
    // keeps it out of the page tree without a reserved id anywhere.
    // THE HOUSE MARKDOWN SCALE, read at the vault root and handed to the design
    // reader, whose own `files` is rooted a level down and correctly cannot
    // reach it. `makePages` reads the same file itself, because its files ARE
    // the vault root.
    const houseScale = async () => {
      const text = await files.read(HOUSE_SCALE);
      if (text === null) return {};
      try {
        return scaleOf(parseAny(text));
      } catch {
        return {};
      }
    };
    // THE `doc` PLUGIN'S DOCUMENT, resolved the way `pages.ts` resolves every
    // plugin document: this vault's own `plugins/doc/index.html` if it has one,
    // the framework's otherwise. The design module's files are rooted at
    // `design/` and correctly cannot reach either, so it is handed a way to ask
    // — read live, so editing the plugin changes the design doc on the next
    // draw exactly as it changes every other doc page.
    const docDocument = async () =>
      (await files.read(DOC_PLUGIN_DOCUMENT)) ?? (await pluginRoot.read(DOC_PLUGIN_DOCUMENT.slice(PLUGINS_DIR_VAULT.length + 1))) ?? "";
    // THE SAME BASELINE AS THE VAULT'S OWN FILES, rooted a level down. A write
    // into `design/` is this process's write wherever it was made from, and two
    // baselines over one tree would make half of them look like somebody else's.
    const design = makeDesign(makeFiles(join(path, "design"), seen), yaml, section, houseScale, docDocument);
    // It was `makeSidecars`, and the rename is the change: there is no sidecar,
    // because there is nothing beside the file. `content.yaml` carries the
    // page's prose as well as its shape.
    const docs = makeDocs(files, yaml);
    const theme = makeTheme(files);
    const presets = makePresets({
      pages, tables, files, yaml,
      seed: seedRoot("presets", at.presets),
      // The vault's own furniture: `INSTRUCTIONS.md`, `design/` and `base/`,
      // copied file by file and never over anything already there. The same
      // root's `AGENTS.md`, `docs/` and `.agents/skills/` are the framework's
      // and go through `rewriteOwned` in `afterMount` instead.
      vaultSeed: skillsSeed,
    });

    // The rows live in SQLite and the pages live in git. A binary file rewritten
    // on every keystroke would make every commit huge and every diff unreadable,
    // which is the one property the vault-as-a-repo decision exists for.
    //
    // THE CONDITION IS *THIS FOLDER IS NEW*, NOT *A REPO WAS MADE HERE*, and the
    // difference is a machine with no git on it. `initVault` there creates no
    // repo, so a gate on that left the vault with no `.gitignore` at all — and
    // the moment git is installed and the folder is opened again, the database
    // is tracked and every keystroke is a binary commit. Still written once, on
    // the run that seeds the vault, so a hand-edited one is never clobbered.
    if (fresh) await files.write(".gitignore", "workspace.db\nworkspace.db-*\n");

    // THE MARKDOWN MIRROR. `_markdown/` is deliberately NOT in that .gitignore:
    // the whole point of it is to be readable by something that reads a repo of
    // markdown, and a mirror nobody clones is a mirror of nothing.
    const mirror = makeMirror(files, pages);

    // Idempotent by observation: a folder with a page or a table in it has been
    // used, and re-seeding would overwrite somebody's work with fixtures. So
    // opening an EMPTY folder sets it up, and opening a workspace touches
    // nothing.
    await presets.seedIfEmpty();
    // The base revision everything a stranger does is a diff against — and only
    // on the run that seeded it. A vault opened for the second time already has
    // its history and does not need a commit named after a seeding that
    // happened months ago.
    if (fresh) await files.commit("The workspace as it was seeded");

    // EVERY PAGE'S PROJECTION, REBUILT. A doc page is pure data, so the local
    // process can render one without the box — which is what answers the page
    // nobody has opened since the mirror shipped, and the page removed while
    // this process was not running. It commits only where something changed,
    // because a mount that writes nothing should leave no trace: `git add -A`
    // here would otherwise sweep whatever the person was in the middle of.
    try {
      const changed = await rebuild(mirror, await pages.list());
      if (changed) await files.commit("The markdown mirror, rebuilt on mount");
    } catch (e) {
      // A mirror that cannot be written is not a workspace that cannot be
      // opened. It is derived, and the next draw of any page rewrites its file.
      console.warn("the markdown mirror could not be rebuilt", e);
    }

    await memory.remember(path);
    return { path, db, seen, deps: { pages, design, docs, tables, presets, theme, mirror }, settled: Promise.resolve(), files };
  }

  /** THE REGISTRY. One entry per folder this process has been asked for, holding
   *  the PROMISE of its mount rather than the mount — see the note at the top of
   *  the file for why that difference is the whole of the concurrency story.
   *  Keyed by resolved absolute path, so two spellings of one folder are one
   *  entry and never two database handles on one file. */
  const mounted = new Map<string, Promise<Mounted>>();

  /** Mount `where` if it is not up, and hand back what it is made of.
   *
   *  The two gates run BEFORE the map is touched: `usable` says the folder is
   *  there, is a folder, can be read, can be written and does not hold a
   *  `workspace.db` that is not a database, and `openable` says it is free to
   *  become a workspace. A folder that fails either must not leave an entry
   *  behind — a rejected promise cached here would make the second attempt fail
   *  without ever looking at the disk again, so a folder somebody then created
   *  would go on being refused until the process restarted. */
  async function acquire(where: string): Promise<Mounted> {
    return await hold(await openable(await usable(where)));
  }

  /** The registry half, with no gate in front of it — which is why it is
   *  separate. The boot vault is CREATED if it is not there, because that is the
   *  ordinary first run and nobody picked it; a folder somebody picked in a
   *  picker is checked first, because seeding a directory that is already
   *  somebody's is the incident this codebase has already had once. */
  async function hold(abs: string): Promise<Mounted> {
    const had = mounted.get(abs);
    if (had) return await had;

    const started = mount(abs).then((m) => {
      // AFTER THE MOUNT HAS ANSWERED AND NOT AS PART OF IT. The promise every
      // caller awaits resolves with the mount; the mirror and the sweep start
      // from here and are reachable through `settled` for whoever has to wait.
      m.settled = afterMount(m.files);
      return m;
    });
    mounted.set(abs, started);
    try {
      return await started;
    } catch (e) {
      // Only if it is still ours. A retry that succeeded while this one was
      // failing owns the entry now, and dropping it would strand a live mount.
      if (mounted.get(abs) === started) mounted.delete(abs);
      throw e;
    }
  }

  /* ── watching a folder for changes made outside the app ────────────────── */

  /** One live watcher and the subscribers it exists for. Keyed by the same
   *  resolved absolute path the mount registry uses, and — unlike that one —
   *  EVICTED, because this is the one thing in the process with a lifetime
   *  somebody can actually observe. */
  interface Live {
    watcher: Watcher;
    hears: Set<() => void>;
    /** The burst being coalesced. Absolute paths, deduplicated by the set. */
    pending: Set<string>;
    timer: ReturnType<typeof setTimeout> | null;
    /** One settle at a time. A second burst arriving mid-settle is coalesced
     *  into the next one rather than read against a disk that is still moving. */
    busy: boolean;
  }
  const live = new Map<string, Live>();

  /** WHAT ONE CHANGED PATH TURNS OUT TO BE. Null means nothing happened: the
   *  bytes are what this process last wrote or last read, or the file does not
   *  parse and is therefore mid-write, or the path names nothing that draws.
   *
   *  THE BASELINE IS THE WHOLE MECHANISM. Equal to it, the event is dropped and
   *  the baseline is unchanged. Different, something outside wrote it: the
   *  baseline becomes the new hash and the page redraws. A file this process has
   *  never seen has no baseline and counts as changed; a deleted path drops its
   *  baseline, so a file written again under that name reads as changed too. A
   *  reread that does not parse leaves the drawn page alone AND leaves the
   *  baseline where it was, which is what makes the completed write read as
   *  changed on the next notification rather than as more of the same. */
  async function consider(held: Mounted, abs: string, rel: string): Promise<{ structural: boolean } | null> {
    const page = pageAt(rel);
    let text: string | null = null;
    try {
      text = await Bun.file(abs).text();
    } catch {
      text = null;
    }

    if (text === null) {
      const doc = `${abs}/${PAGE_DOC}`;
      // A DIRECTORY, or a path that is gone. The two are told apart by whether
      // anything is still there, and only one of them is a change.
      if (await Bun.file(doc).exists()) {
        // A page directory. One this process already knows reports through its
        // own files; one it has never seen is a page that has just arrived.
        return held.seen.known(doc) ? null : { structural: true };
      }
      // GONE — and the question asked here has to be one the baseline can
      // answer. It is keyed by FILE and is never noted for a bare directory, so
      // asking whether this process knows `abs` answers no for every directory
      // that ever existed, and a page directory moved away in ONE rename — which
      // is all the notification a move gives — was dropped as nothing that
      // happened. So the page document is probed as well, exactly as the branch
      // above probes it: what this process knew about a departed directory is
      // whatever was inside it.
      if (!held.seen.known(abs) && !held.seen.known(doc)) return null;
      // Recursive, so forgetting a page directory forgets its document with it.
      held.seen.forget(abs);
      return { structural: true };
    }

    if (held.seen.matches(abs, text)) return null;
    if (!parses(rel, text)) return null;
    const fresh = !held.seen.known(abs);
    held.seen.note(abs, text);
    return { structural: fresh || (page !== null && page.rest === "") };
  }

  /** The burst has stopped. Read what it named, refresh the mirror for whatever
   *  turned out to be a page, and tell the subscribers once. */
  async function settle(held: Mounted, now: Live): Promise<void> {
    if (now.busy) return;
    now.busy = true;
    try {
      const burst = [...now.pending];
      now.pending.clear();

      // EVERY VERDICT IN THE BURST IS TAKEN BEFORE ANY PROJECTION RUNS, and that
      // ordering is the whole of this loop rather than a tidy-up. The baseline
      // is what this process last wrote or last READ, and projecting a page
      // reads: `follow` re-projects the PARENT, because a parent lists its
      // children, and reading a parent reads every child's `content.yaml`. Taken
      // one path at a time, the first of two siblings created in the same burst
      // rebaselines the second before it has been considered — so the second
      // reads as nothing that happened, and its markdown is never written.
      // Measured on two pages created together.
      //
      // Deduplicated by page id in the same pass: a burst touching three files
      // of one page is one projection rather than three.
      const touched = new Map<PageId, { structural: boolean; dir: string }>();
      let moved = false;
      for (const abs of burst) {
        const rel = insideOf(held.path, abs);
        if (rel === null || rel === "" || !watched(rel)) continue;
        const verdict = await consider(held, abs, rel);
        if (verdict === null) continue;
        moved = true;
        const page = pageAt(rel);
        if (page === null) continue;
        // THE PAGE'S OWN DIRECTORY, taken off the path that named it rather than
        // rebuilt from the id: `rest` is what `pageAt` left over, so cutting it
        // off is the inverse of that walk without a second spelling of how the
        // tree is laid out. Sliced by LENGTH, which is separator-agnostic —
        // every `/` in `rest` is one separator character in `abs`.
        const dir = page.rest === "" ? abs : abs.slice(0, abs.length - page.rest.length - 1);
        const had = touched.get(page.id);
        touched.set(page.id, {
          structural: (had?.structural ?? false) || verdict.structural,
          dir: had?.dir ?? dir,
        });
      }

      // THE MIRROR RIDES THE WATCHER, through the path that already exists and
      // exactly as the API layer calls it. This is what closes the one case
      // `_markdown/` goes stale: a file edited outside the app.
      for (const [id, what] of touched) {
        // A PAGE DELETED FROM OUTSIDE LOSES ITS MARKDOWN. `project` returns on a
        // page it cannot read, so `follow` on its own leaves a file about
        // nothing behind — the app's own path in `server/api/routes.ts` drops
        // first for exactly this reason, and this one has to do the same. Asked
        // of DISK rather than of the baseline, so the answer cannot depend on
        // which of a deleted page's paths the burst happened to report first.
        const gone = !(await Bun.file(`${what.dir}/${PAGE_DOC}`).exists());
        if (gone) await mirrored(held.deps.mirror.drop(id));
        // A page arriving or leaving changes the page above it as much as
        // itself, so a departure is structural whatever named it.
        await mirrored(follow(held.deps.mirror, id, what.structural || gone));
      }
      if (!moved) return;
      for (const hear of [...now.hears]) {
        try {
          hear();
        } catch (e) {
          console.warn("a live-change subscriber threw", e);
        }
      }
    } finally {
      now.busy = false;
      // A burst that arrived while this one was settling still has to be read.
      if (now.pending.size > 0 && live.get(held.path) === now) arm(held, now);
    }
  }

  function arm(held: Mounted, now: Live): void {
    if (now.timer !== null) clearTimeout(now.timer);
    now.timer = setTimeout(() => {
      now.timer = null;
      void settle(held, now);
    }, SETTLE);
  }

  async function subscribe(where: string, hear: () => void): Promise<() => void> {
    const held = await acquire(where);
    let now = live.get(held.path);
    if (now === undefined) {
      const made: Live = {
        watcher: { handles: () => [], close: () => {} },
        hears: new Set(),
        pending: new Set(),
        timer: null,
        busy: false,
      };
      live.set(held.path, made);
      made.watcher = watchTree(held.path, (abs) => {
        if (live.get(held.path) !== made) return;
        made.pending.add(abs);
        arm(held, made);
      });
      now = made;
    }
    const mine = now;
    mine.hears.add(hear);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      mine.hears.delete(hear);
      if (mine.hears.size > 0) return;
      if (live.get(held.path) !== mine) return;
      live.delete(held.path);
      if (mine.timer !== null) clearTimeout(mine.timer);
      mine.timer = null;
      mine.watcher.close();
    };
  }

  /** The three questions about vaults, plus the one about THIS vault. `here` is
   *  the folder the request named, or null when it named none — which is a
   *  legal state and not an error, because the picker has to be reachable
   *  before anything has been chosen. */
  function vaultAt(here: string | null): Vault {
    return {
      async info(): Promise<VaultInfo> {
        // No default, deliberately. "Which folder is this" has no answer when
        // the request did not say, and falling back to the most recent would
        // hand this tab an answer about somebody else's.
        if (here === null) {
          throw Object.assign(new Error("this request names no workspace"), { code: "bad_request" });
        }
        return infoOf(here);
      },

      /** Where the picker starts is beside the vault you are in, because the
       *  next workspace is nearly always a sibling of the last one. With no
       *  vault in hand — a first run, or a tab that has not chosen — it starts
       *  beside the last one anybody opened, which is the same reasoning one
       *  step further out. */
      async browse(path?: string): Promise<DirListing> {
        if (path !== undefined) return await browse(path);
        // Beside the vault you are in, because the next workspace is nearly
        // always a sibling of the last one. WITH NOTHING REMEMBERED AT ALL it is
        // the home directory itself rather than its parent: a first launch has
        // no sibling to be beside, and the one thing a person knows on one is
        // where they keep their own work.
        //
        // AND WHERE IT STARTS HAS TO EXIST, which is the half that was missed
        // and that only shows once a bad vault stops being mounted. `here` is
        // null on this screen, so the candidate is the REMEMBERED folder — and
        // the whole reason the picker is what opened may be that the remembered
        // folder is gone, or that the volume it was on is not plugged in. Its
        // parent is then gone too, `check` refuses a path that is not there, and
        // what the person got on the one screen that could fix their problem was
        // a refusal and a stack trace on stderr. `nearest` walks up to the first
        // directory that is actually there, which for a missing drive is the
        // mount point and for a deleted workspace is the folder it was in —
        // both of which are where somebody would have started looking anyway.
        const near = here ?? (await memory.last()) ?? at.vault;
        return await browse(near === undefined ? homedir() : nearest(dirname(near)));
      },

      /** Mounting does not unmount. A folder already up is the same object
       *  rather than a second copy, so opening the one you are in is genuinely
       *  nothing rather than a teardown of the handle answering this request. */
      async open(path: string): Promise<VaultInfo> {
        const held = await acquire(path);
        return infoOf(held.path);
      },

      /** MAKE ONE, THEN OPEN IT, and the order is the whole of it: `createVault`
       *  decides and acts — the name rule, the ancestor walk, a sentence per row
       *  of the collision table — and what comes back is a folder that exists
       *  and holds nothing. `acquire` then does to it exactly what opening any
       *  empty folder does, which is why there is no second seeding path here
       *  and no way for a created vault to come up differently from a chosen
       *  one. The answer is read off the mount rather than off the path that was
       *  made, so it carries what actually happened — whether git took, in
       *  particular. */
      async create(parent: string, name: string): Promise<VaultInfo> {
        const abs = await createVault(parent, name);
        const held = await acquire(abs);
        return infoOf(held.path);
      },

      recent: () => memory.recent(),
    };
  }

  // Mounted on the way up so `make dev` can print a vault, so `VAULT=` still
  // means something, and so the ordinary first run has a workspace before
  // anybody asks for one. It is not "the" vault — it is simply the first entry
  // in the map, and every other one arrives the same way.
  //
  // Through `hold` and not `acquire`, which is the one asymmetry in this file:
  // the boot vault is created if it is not there. The default vault in the
  // per-user data directory does not exist until a first run makes it, and
  // `make fresh` deletes it on purpose, so a gate that refused a missing folder
  // would make the ordinary first run fail.
  // A FIRST LAUNCH MOUNTS NOTHING. `at.vault` is `VAULT=` or the folder this
  // machine was last in; with neither there is no folder to open, and inventing
  // one would write a workspace somewhere nobody chose. The picker is what the
  // client shows instead, and it is already reachable with no folder named.
  //
  // A MOUNT THAT FAILS ON THE WAY UP IS A SENTENCE AND NOT A DEAD PROCESS. This
  // runs inside a top-level await in the composition root, so an exception here
  // has nowhere to go: the process exits non-zero having printed a stack trace,
  // the shell never gets its ready line, and what a person sees is an
  // application that did not start. Measured on three states — a remembered
  // vault that is now a file, one whose folder cannot be read, one whose
  // `workspace.db` is not a database. `bootVault` refuses two of those before
  // they are ever tried; this catches every one that is left, including the ones
  // nobody has thought of yet, and the answer to all of them is the same: mount
  // nothing, say one sentence, and let the picker be what opens.
  let trouble: string | null = null;
  if (at.vault !== undefined) {
    const abs = resolve(at.vault);
    try {
      // CHECKED IF IT IS THERE, CREATED IF IT IS NOT, and that pair is the whole
      // of the boot vault's asymmetry with a folder somebody picked. `VAULT=` on
      // a folder that does not exist yet is the ordinary headless first run and
      // must go on working — but `VAULT=` on a folder that IS there and is a
      // file, or cannot be read, or holds a `workspace.db` that is not a
      // database, has an answer worth saying, and without this it arrived as
      // whichever errno happened to escape first.
      if (existsSync(abs)) await usable(abs);
      await hold(abs);
    } catch (e) {
      // CARRIED RATHER THAN PRINTED, so there is one place that says it and one
      // place that decides it. The run below prints this in the same shape as
      // `bootVault`'s own refusal, and a test reads it rather than scraping a
      // console.
      trouble = sentenceOf(e);
    }
  }

  return {
    // A GETTER, BECAUSE IT DECAYS. It is the reason this launch has nothing
    // open, and it stops being a reason the moment something opens — a picker
    // that went on saying *there is no folder there* after somebody had chosen
    // one would be describing a state that has passed.
    get trouble() {
      return mounted.size > 0 ? null : trouble;
    },
    vault: vaultAt(null),
    pluginRoot,
    async settled(path: string): Promise<void> {
      const held = mounted.get(resolve(path));
      if (held === undefined) return;
      await (await held).settled;
    },
    async deps(path?: string): Promise<Deps> {
      if (path === undefined) return { ...NO_VAULT, production, vault: vaultAt(null) };
      let held;
      try {
        held = await acquire(path);
      } catch (e) {
        // A FOLDER THAT WILL NOT MOUNT STILL ANSWERS THE KINDS THAT ARE ABOUT
        // VAULTS, and that is not a courtesy — it is what makes the picker
        // usable in the one tab that needs it.
        //
        // This used to reject, and the route turned it into a refusal of
        // EVERYTHING the tab asked for. So a window addressed at a workspace
        // that would not open drew the picker and then watched the picker's own
        // three reads fail: `vault.info`, `vault.recent` and `vault.browse` all
        // went down the same vault-prefixed route, and the screen that exists to
        // fix the problem could not list a folder or offer a recent one. What
        // the person saw was the reason printed twice — once by the shell, once
        // by the first of the picker's reads to fail — over an empty chooser.
        //
        // Those kinds never needed the mount: `vault.browse`, `vault.recent`,
        // `vault.open` and `vault.create` are ABOUT vaults rather than in one,
        // which is exactly what the unprefixed route already says. So the answer
        // is `vaultAt(null)` — the same set that route carries — and everything
        // that genuinely does need the folder refuses with the mount's own
        // sentence, so `page.list` tells the tab why rather than reciting a
        // generic one.
        return { ...refusing(sentenceOf(e), ERRORS.NOT_FOUND), production, vault: vaultAt(null) };
      }
      return { ...held.deps, production, vault: vaultAt(held.path) };
    },
    open: () => [...mounted.keys()],
    watch: subscribe,
    watching: () => [...live.entries()].map(([path, now]) => ({ path, handles: now.watcher.handles() })),
    close: () => {
      for (const now of live.values()) {
        if (now.timer !== null) clearTimeout(now.timer);
        now.watcher.close();
      }
      live.clear();
      for (const held of mounted.values()) void held.then((m) => m.db.close()).catch(() => {});
      mounted.clear();
    },
  };
}

/* ── everything else the server serves is static ────────────────────────── */

// FRAMEWORK-RELATIVE, and that is the change the compiled build asked for. A
// static route used to name an absolute directory and `locate` answered an
// absolute path; a binary has no such directory, so the routes name the key
// space instead — `client/index.html` — and `source()` below turns a key into
// either a path on disk or the path the carried copy answers to.
const CLIENT = "client";
const CONTRACTS = "contracts";
const GUEST = "guest";
const VENDOR = "vendor";
/** The one document the server composes rather than serves. A key like every
 *  other, so the composition is decided by which key was asked for. */
const INDEX = `${CLIENT}/index.html`;

/** THE SHIPPED DEFAULT SECTION, off disk. A section that names no `data` draws
 *  with this, and it is a real file rather than a branch in the runtime so that
 *  the default is the same mechanism every other section uses — legible,
 *  copyable, replaceable — instead of the one shape nothing else can reach.
 *
 *  The composition root is what reads it because nothing may import `guest/`,
 *  and because pages.ts and design.ts must both draw the SAME default: one
 *  string, from one place, handed to both.
 *
 *  Missing, it falls back to the stand-in in pages.ts and says so once. A page
 *  that drew nothing at all would look like a page with no words in it. */
async function defaultSection(carried: EmbeddedMap): Promise<string> {
  // Carried first and disk second, which is the shape every read in this file
  // takes: `readEmbedded` answers null when nothing is embedded, so the source
  // build never asks a second question and the compiled one never touches a
  // disk that is not there.
  const held = await readEmbedded(carried, DEFAULT_SECTION_FILE);
  if (held !== null) return held;
  try {
    if (isEmbedded(carried)) throw new Error("not carried");
    return await Bun.file(join(HERE, DEFAULT_SECTION_FILE)).text();
  } catch {
    console.warn(`guest: ${DEFAULT_SECTION_FILE} is missing — sections that name no file draw the stand-in`);
    return DEFAULT_SECTION;
  }
}

/** THE ROOT PAGE'S OWN MARKUP, off disk or out of the binary, read exactly the
 *  way the default section is and for the same two reasons: nothing under
 *  `server/` may import `guest/`, and one string read once is handed to the one
 *  module that writes it.
 *
 *  It is copied into a new vault's root page as that page's own `index.html`
 *  and never read again, so this is a first-launch file rather than a runtime
 *  one. Missing, the root is born with the stand-in in pages.ts and says so
 *  once: a first page that drew nothing at all is the worst screen this
 *  program has. */
async function rootPageMarkup(carried: EmbeddedMap): Promise<string> {
  const held = await readEmbedded(carried, ROOT_PAGE_FILE);
  if (held !== null) return held;
  try {
    if (isEmbedded(carried)) throw new Error("not carried");
    return await Bun.file(join(HERE, ROOT_PAGE_FILE)).text();
  } catch {
    console.warn(`guest: ${ROOT_PAGE_FILE} is missing — a new vault's root page draws the stand-in`);
    return ROOT_PAGE_STANDIN;
  }
}

// /js/* maps onto client/* rather than client/js/*, which is what makes a
// module's relative imports resolve identically on disk and over the wire —
// client/views/page.js importing ../../contracts/wire.js works unchanged.
const STATIC: [string, string][] = [
  ["/js/", CLIENT],
  ["/css/", `${CLIENT}/css`],
  ["/fonts/", `${CLIENT}/fonts`],
  ["/contracts/", CONTRACTS],
  // THE BOX'S OWN CODE: the shim, the section runtime and the shipped plugins.
  // It is served rather than inlined because the frame loads it with a CLASSIC
  // <script src>, which is the one thing a sandboxed opaque-origin frame is
  // still allowed to do — `fetch` and a MODULE script are both blocked, so the
  // box can RUN host-served code without being able to READ anything back and
  // the chokepoint, which is about data, still holds.
  //
  // What it may NOT be used for is the section markup a page draws with. That
  // arrives inline in the `page.read` answer, because loading it would be a
  // fetch and a fetch is exactly what the frame cannot do.
  ["/guest/", GUEST],
  // Third-party code, served rather than bundled. The host imports from here
  // through an import map, so `import MarkdownIt from "markdown-it"` stays a
  // BARE specifier — which the layering gate already skips as a package, so
  // vendoring cost the architecture nothing.
  //
  // An artifact reaches it too, and that is only possible because a CLASSIC
  // <script src> is permitted from the sandboxed frame while `fetch` and a
  // MODULE script are not. That asymmetry is measured, not assumed: subresource
  // loading is a different mechanism from a same-origin data read, so the frame
  // can RUN host-served code without being able to READ anything back. The
  // chokepoint is about data, and it still holds.
  ["/vendor/", VENDOR],
];

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
};

/** Resolve `rel` under `base`, or null if it escapes. No route may leave its
 *  root, and `..` is the whole of the attack.
 *
 *  PATHS, NOT URLS, AND THE DIFFERENCE IS THREE BUGS. This built `file://${base}`
 *  and compared the result as a string: an install path with a space in it came
 *  back percent-encoded and matched no file on disk; a `#` or a `?` anywhere in
 *  it truncated the base at that character, so the comparison passed on a prefix
 *  of the wrong folder; and on Windows the whole thing was `/C:/…`, which is not
 *  a path any filesystem call accepts.
 *
 *  The containment itself is `within` in `platform/files.ts` — one answer to
 *  "is this inside that" for the whole server, rather than a copy here, a copy
 *  in the vault guard and a copy in front of `fresh`'s `rm -rf`. What is left
 *  here is the part that is this function's own: a route is rooted, so a leading
 *  slash is stripped rather than taken as the filesystem root.
 *
 *  `rel` arrives ALREADY DECODED: every caller runs `decodeURIComponent` on the
 *  request path first, because a url is encoded and a filename is not. */
export function under(base: string, rel: string): string | null {
  const abs = resolve(base, rel.replace(/^[/\\]+/, ""));
  return within(base, abs) ? abs : null;
}

/* -- the loader: a vault's own slot plugins, as one script ---------------- */

/** THE DIRECTORY ITSELF, on the route that already serves what is in it.
 *  `/v/<enc>/plugin/` with nothing after it is the one url a vault's plugins
 *  can be asked for as a SET, and it needs no wire kind: the frame already
 *  spells `vaultBase(path) + "/plugin/"` to reach a single file, so asking for
 *  the FOLDER is that same string with nothing appended. A `plugin.list` kind on
 *  `ApiRequest`, or a field on `VaultInfo`, were the alternatives and both are
 *  `contracts/` edits — this is not. */
export const PLUGIN_DIR_ROUTE = "/plugin/";

/** WHY ONE SCRIPT AND NOT ONE TAG EACH. N tags is N round trips and an execution
 *  order that depends on which of them arrives first; one file is one request,
 *  one order — id order, stated here rather than emergent — and one place to
 *  report a failure from.
 *
 *  EVERY SOURCE GETS A FUNCTION OF ITS OWN, and that is three properties rather
 *  than tidiness. A failure is NAMED BY ITS FILE — a plugin that throws while it
 *  is registering used to reach the page as `no plugin named "…" is registered`
 *  at the node that wanted it, which reads as the PAGE AUTHOR's bug and is the
 *  plugin's. A top-level `var` or `function` in one file stays in that file
 *  rather than aliasing the same name in the next one, which a shared `try`
 *  BLOCK does not give: a block is not a scope for either. And a file's own
 *  `"use strict"` is its function's directive prologue and therefore live, where
 *  in a shared block it was an expression statement doing nothing at all.
 *
 *  WHICH FILE IS RUNNING IS ALSO WHAT THE REGISTRY READS. The whole bundle is one
 *  `<script>`, so `document.currentScript` cannot tell two plugins apart; `file()`
 *  in the preamble sets `rt.pluginFile` around each call, and that is how a part
 *  kind is bound to `plugins/<kind>.js` rather than to whoever sorted first.
 *
 *  A FILE THAT DOES NOT PARSE IS THE CASE A `try` CANNOT CATCH, because a syntax
 *  error is thrown when the bundle is parsed and would take every other plugin in
 *  the vault with it. So each source is parsed HERE, on the server, with
 *  `new Function` — which compiles it and runs none of it — and a file that fails
 *  is replaced by the sentence saying so. One broken plugin is one broken plugin.
 *
 *  @param vault the absolute path of the folder being served */
export async function pluginBundle(vault: string, framework: Files | null = null): Promise<Response> {
  const dir = join(vault, PLUGINS_DIR_VAULT);
  let files: { name: string; mtimeMs: number; size: number }[];
  try {
    const names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => e.name)
      .sort();
    files = await Promise.all(
      names.map(async (name) => {
        const s = await stat(join(dir, name));
        return { name, mtimeMs: s.mtimeMs, size: s.size };
      }),
    );
  } catch {
    // NO `plugins/` AT ALL IS AN EMPTY SCRIPT AND NEVER AN ERROR. A vault whose
    // folder has not been seeded yet, or one somebody emptied, still draws every
    // page it has — a 404 here would be a script tag failing in every box.
    files = [];
  }

  // THE FRAMEWORK'S OWN, MINUS EVERY NAME THE VAULT ALSO HAS. The union is
  // computed here by filename and nowhere else: a vault `markdown.js` means the
  // framework's `markdown.js` never enters the script, so the registry never
  // sees two registrations of one id and its refusal never fires for this. The
  // framework's go FIRST, so a vault plugin that `ctx.use`s one finds it
  // registered. Read by content rather than stat'd — `Files` has no stat, the
  // set is a handful of small files, and reading them is what keeps the
  // edit-and-reload loop live for `guest/plugins/` in a checkout.
  const mine = new Set(files.map((f) => f.name));
  const theirs: { name: string; source: string }[] = [];
  if (framework !== null) {
    const entries = (await framework.list(".")).filter((e) => !e.dir && e.name.endsWith(".js") && !mine.has(e.name));
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const source = await framework.read(e.name);
      if (source !== null) theirs.push({ name: e.name, source });
    }
  }

  // THE FOLDER AS IT STANDS, AS ONE STRING. Every page in a vault carries this
  // tag, so a rail of twenty pages is twenty requests that read and compile every
  // plugin in the folder on a server with one thread. The key is the listing plus
  // each file's mtime and size, so a write through the app, an editor save, a
  // delete and a reseed all miss the memo and nothing else does — and the
  // framework's half by a hash of what was read, for the same reason.
  const key = files.map((f) => `${f.name}:${f.mtimeMs}:${f.size}`).join("\n")
    + "\n--\n" + theirs.map((t) => `${t.name}:${createHash("sha1").update(t.source).digest("hex")}`).join("\n");
  const had = bundles.get(vault);
  if (had !== undefined && had.key === key) return pluginResponse(had.body);

  const parts: string[] = [PLUGIN_BUNDLE_HEAD];
  for (const { name, source } of theirs) {
    parts.push(`/* framework/${name} */`);
    parts.push(compiled(name, "framework", source, null));
  }
  for (const { name, size } of files) {
    parts.push(`/* plugins/${name} */`);
    let broken: string | null = null;
    let source = "";
    if (size > PLUGIN_MAX_BYTES) {
      // A CAP, BECAUSE THE WHOLE FOLDER IS READ INTO ONE STRING. A file this big
      // is a mistake — a bundled library pasted in, a log written into `plugins/`
      // — and taking the vault's every page down with it while the server holds
      // it in memory is the wrong answer to it.
      broken = `${Math.round(size / 1024)}KB is larger than a plugin may be (${Math.round(PLUGIN_MAX_BYTES / 1024)}KB) — a plugin is a file you can read, and a library belongs in its own script`;
    } else {
      source = await Bun.file(join(dir, name)).text();
    }
    parts.push(compiled(name, "plugins", source, broken));
  }
  parts.push("})();");

  const body = parts.join("\n");
  bundles.set(vault, { key, body });
  return pluginResponse(body);
}

/** ONE PLUGIN'S SEGMENT OF THE BUNDLE. Compiled here with `new Function` —
 *  which parses and runs nothing — so a file that does not parse is replaced by
 *  the sentence saying so instead of taking every other plugin down with it.
 *  `root` is what the failure names, `plugins/` or `framework/`, so a reader
 *  knows which copy broke; the bare file name is what the registry reads to
 *  bind a part kind, and it is the same whichever root it came from. */
function compiled(name: string, root: "plugins" | "framework", source: string, broken: string | null): string {
  if (broken === null) {
    try {
      new Function(source);
    } catch (e) {
      broken = e instanceof Error ? e.message : String(e);
    }
  }
  if (broken === null) return `file(${JSON.stringify(name)}, ${JSON.stringify(root)}, function () {\n${source}\n});`;
  return `fail(${JSON.stringify(name)}, ${JSON.stringify(root)}, ${JSON.stringify(broken)});`;
}

/** The largest a single `plugins/*.js` may be. Generous for a file somebody is
 *  meant to read and far under what would sit in memory unnoticed. */
const PLUGIN_MAX_BYTES = 512 * 1024;

/** The last bundle built for a vault, by absolute vault path. One entry per
 *  folder this process has served, which is one or two in an app and a handful in
 *  a test run — there is nothing here to evict. */
const bundles = new Map<string, { key: string; body: string }>();

/** `no-store` STAYS, and the memo is what makes it affordable. The change loop is
 *  writing a plugin file and pressing reload, so a cached bundle in the box is a
 *  person editing a file and seeing the old one; the memo removes the cost that
 *  made caching tempting — the folder is stat'd, not read and recompiled. */
function pluginResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": TYPES.js ?? "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** The bundle's preamble. `fail` is late-bound against `rt.report` for the same
 *  reason `say()` in the registry is: `report` belongs to `boot.js`, and a plugin
 *  script can sit ahead of it in the document.
 *
 *  `file` RUNS ONE PLUGIN AND SAYS WHICH ONE IS RUNNING. The name on
 *  `rt.pluginFile` is what `whereFrom()` in the registry reads, and it is restored
 *  afterwards rather than cleared, so a plugin that registers another from inside
 *  its own body is still attributed to the file it is in. */
const PLUGIN_BUNDLE_HEAD = `/* The slot plugins this workspace draws with: the framework's own, then
   <vault>/plugins/ — each in id order, and a vault file shadows the framework's
   of the same name. Served whole by the server that read both; every file gets
   a function of its own, so one plugin that fails is one plugin that fails. */
(function () {
  var rt = globalThis.__gRuntime || (globalThis.__gRuntime = {});
  function fail(file, root, e) {
    var message = root + "/" + file + " did not load: " + ((e && e.message) || e);
    if (typeof rt.report === "function") rt.report(message);
    else console.error("[biom] " + message);
  }
  function file(name, root, run) {
    var was = rt.pluginFile;
    rt.pluginFile = name;
    try { run(); } catch (e) { fail(name, root, e); } finally { rt.pluginFile = was; }
  }`;

/** The routes that resolve INSIDE a vault, so they only exist on a request that
 *  named one. Everything else is framework-rooted and answers the same whichever
 *  folder is being looked at, which is what lets a module be fetched and cached
 *  once rather than once per vault.
 *
 *  `assets/` is a root sibling of `pages/` rather than a folder inside it,
 *  because a picture is usually wanted on more than one page and a copy per page
 *  is a set of files that drift. It is served and never parsed: nothing here
 *  reads an asset, so nothing here can be fooled by one.
 *
 *  `plugins/` is this WORKSPACE's own plugins, served to the box as classic
 *  scripts exactly as `/guest/` and `/vendor/` are. It is per-vault for the
 *  obvious reason the other two are not: a plugin somebody wrote for their
 *  workspace lives in it. A path under it the vault has NOT got falls back to
 *  the framework's own file of that name — see `pluginFile` — which is the same
 *  nearest-first walk `pages.ts` makes for a page's document, applied per file:
 *  a vault holding only `plugins/kanban/index.html` still gets the framework's
 *  `kanban/kanban.js` underneath it. */
function inVault(rest: string, vault: string): string | null {
  if (rest.startsWith(PLUGIN_DIR_ROUTE)) return under(join(vault, PLUGINS_DIR_VAULT), rest.slice(PLUGIN_DIR_ROUTE.length));
  if (rest.startsWith("/asset/")) return under(join(vault, "assets"), rest.slice("/asset/".length));
  return null;
}

/** ONE PLUGIN FILE, the vault's if it has it and the framework's if not.
 *  Answered as text through the read-only root rather than as a path, because
 *  a carried file has no path a route may hand out and a plugin is text. */
export async function pluginFile(rel: string, vault: string, framework: Files): Promise<Response> {
  const mine = under(join(vault, PLUGINS_DIR_VAULT), rel);
  if (mine !== null && (await Bun.file(mine).exists())) return await deliver(mine);
  let theirs: string | null = null;
  try {
    theirs = await framework.read(rel);
  } catch {
    theirs = null;
  }
  if (theirs === null) return new Response("Not found", { status: 404 });
  const ext = rel.slice(rel.lastIndexOf(".") + 1);
  return new Response(theirs, {
    headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" },
  });
}

/** THE ONE THING IN THE DOCUMENT THE CLIENT CANNOT WORK OUT FOR ITSELF.
 *
 *  The client has no build step, ever — `client/boot.js` is served exactly as it
 *  sits on disk — so `--define` cannot reach it and the only channel that can is
 *  the document the server hands back. It is one meta tag, written into
 *  `client/index.html` with `development` in it, so a raw file opened off disk
 *  reads as development and the development server's answer is byte-identical to
 *  the file. `client/boot.js` is the only module on the other side that reads it.
 *
 *  The name is duplicated in `client/index.html` and in `client/boot.js` and
 *  cannot be shared: `contracts/` is the only place all three could import from
 *  and it is frozen, and an HTML attribute cannot import anything at all. */
const ENV_META = "meta name=\"biom-env\" content=";

/** Built once rather than per request: the pattern is constant, and `/` is a
 *  route somebody reloads. */
const ENV_META_RE = new RegExp(`${ENV_META}"[^"]*"`);

/** The served document: the file, with the environment written into its meta
 *  tag. In development the substitution is the value already there, so the bytes
 *  are the file's own.
 *
 *  Exported because it is the whole of the composition and it is pure — the only
 *  half of `/` worth testing without a server up. */
export function withEnvironment(html: string, env: Environment): string {
  return html.replace(ENV_META_RE, `${ENV_META}"${env}"`);
}

/** THE SECOND THING THE CLIENT CANNOT WORK OUT FOR ITSELF, and it travels the
 *  same channel for the same reason: why this launch has no workspace open.
 *
 *  A LAUNCH THAT MOUNTED NOTHING IS TWO DIFFERENT STATES. It is a first launch,
 *  which needs no explaining — or it is somebody whose workspace did not open,
 *  and a picker that appears with no reason given is the program pretending
 *  their folder never existed. The terminal already says which; nobody using the
 *  built application is looking at a terminal.
 *
 *  IT CANNOT COME DOWN THE WIRE. The client's one call before it has a folder is
 *  `vault.recent`, and `VaultInfo` carries no such field — adding one, or adding
 *  a kind, is a `contracts/` edit and this is not worth a barrier. The document
 *  is the channel that is already there, the value is a fact about this launch
 *  exactly as the environment is, and `client/boot.js` is again the only module
 *  that reads it.
 *
 *  THE TAG IS ABSENT WHEN THERE IS NOTHING TO SAY, rather than present and
 *  empty: a first launch's document is then byte-identical to the file, which is
 *  the property the environment tag is written to keep. */
const TROUBLE_META = "meta name=\"biom-trouble\" content=";

export function withTrouble(html: string, why: string | null): string {
  if (why === null || why.trim() === "") return html;
  // Into the head, straight after the tag that is always there — so there is one
  // anchor to find rather than a second place in the document to keep in step.
  const at = ENV_META_RE.exec(html);
  if (at === null) return html;
  // `ENV_META_RE` matches the tag's INSIDE, so the character after the match is
  // its `>`; the insertion point is one past that.
  const after = at.index + at[0].length + 1;
  return `${html.slice(0, after)}\n<${TROUBLE_META}"${escapeAttribute(why)}">${html.slice(after)}`;
}

/** A sentence written by this framework, made safe to sit in an HTML attribute.
 *  Nothing here is user input — every one of these strings is a literal in
 *  `server/workspace/vault.ts` or `server/workspace/migrate.ts` — and it is
 *  escaped anyway, because the day one of them carries a folder's name is the
 *  day that stops being true and nothing would say so. */
const escapeAttribute = (text: string): string =>
  // COLLAPSED AND NOT TRUNCATED, on `sentenceOf`'s argument: an attribute has to
  // be one line, and the way to make a paragraph one line is to fold it rather
  // than to throw away everything after the first break. Every sentence that
  // reaches here through the run has already been folded once; this is what
  // makes the function safe on its own rather than only in that company.
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The framework-relative KEY a url names, or null when it names nothing the
 *  framework serves. Exported so the one route this file REFUSES can be asserted
 *  as a refusal rather than inferred from a directory being absent. Still routed through `under()`, so `..` is refused in the
 *  build that has a directory to escape from; the compiled build has a map,
 *  which has nothing to escape from at all. */
export function locate(pathname: string): string | null {
  if (pathname === "/" || pathname === "") return INDEX;
  if (pathname === SHIM_ROUTE) return `${GUEST}/biom.js`;
  // `guest/plugins/` IS THE FALLBACK RUNG AND NOT A SERVED ROOT. A plugin is
  // reached at `/v/<enc>/plugin/…`, where the vault's own file answers first and
  // the framework's second; serving it here as well would leave two urls for
  // one plugin, and the one a page happened to name would decide whether the
  // person's override drew or the framework's did. It is refused explicitly
  // rather than by the directory simply being absent, because in a checkout it
  // is very much present.
  if (pathname.startsWith(`/${GUEST}/plugins/`)) return null;
  for (const [prefix, base] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    const abs = under(join(HERE, base), pathname.slice(prefix.length));
    return abs === null ? null : relative(HERE, abs).split(sep).join("/");
  }
  return null;
}

/** Where the file behind a key actually is: inside this program, or beside it.
 *  One question, asked in one place, answered by what the build carried.
 *
 *  A carried file answers to a path `Bun.file` reads, exactly as one on disk
 *  does, which is why `deliver()` below needed no second way to read anything.
 *
 *  IT IS `hostFiles` AND NOT A SECOND EXPRESSION, because the reload loop hangs
 *  on the two agreeing. A checkout that has built the application once still has
 *  a manifest in `dist/` pointing at the COPIES that build took; serving those
 *  from `make dev` would mean editing a client file, pressing reload and seeing
 *  yesterday's file, silently, which is the one failure this repository refuses
 *  to have. So the carried files are read when there is no directory beside the
 *  program — and a build with no directory AND nothing carried is a broken build
 *  that says so. */
const CARRYING = isEmbedded(hostFiles(undefined, !STANDALONE, CARRIED));
if (STANDALONE && !CARRYING) {
  console.error("this build carries no files and has no directory beside it — it can serve nothing");
}
function source(key: string | null): string | null {
  if (key === null) return null;
  if (CARRYING) return CARRIED[key] ?? null;
  return join(HERE, key);
}

/** `/` and nothing else: the file, with the environment written into its meta
 *  tag. Every other static file goes out untouched, which is why this is an
 *  argument to `deliver` rather than a route of its own — the existence check,
 *  the 404 and the headers are the same ones, and a second copy of them is a
 *  second thing to get right.
 *
 *  Read per request rather than once, because that is the deal every file the
 *  client loads already has: the change loop is somebody writing a file and
 *  pressing reload, and a document cached in this process would be the one file
 *  in the client that needed a restart. */
const composeRoot = (html: string) => withTrouble(withEnvironment(html, ENV), TROUBLE());

/** WHY THIS LAUNCH HAS NO WORKSPACE, read at the moment a document is composed
 *  rather than captured when the server started.
 *
 *  IT HAS TO DECAY. The sentence is true of a launch that mounted nothing, and
 *  it stops being the reason the picker is showing the instant anything does
 *  open — so a window opened later, or a reload after somebody has picked a
 *  folder, must not be told their workspace is gone. The run below replaces this
 *  with a reader over the host; a caller that stood the routes up without one
 *  gets nothing, which is the honest answer to a question nobody asked. */
let TROUBLE: () => string | null = () => null;

/** The framework's own files: the client, the box's code, the contracts, the
 *  fonts and the vendored scripts. One url whichever folder is being looked at,
 *  and one lookup whether they are carried or on disk.
 *
 *  THE ONE COMPOSED ROUTE IS DECIDED HERE, by which key was asked for rather
 *  than by which url arrived: `locate` answers the root document for a bare `/`
 *  and for a deep link into a vault alike, and both have to carry which build
 *  this is. */
async function serveStatic(pathname: string): Promise<Response> {
  const key = locate(pathname);
  return await deliver(source(key), key ?? undefined, key === INDEX ? composeRoot : undefined);
}

/**
 * @param path what to read — a path on disk, or the path a carried file answers
 *   to, which `Bun.file` reads identically.
 * @param name what to call it when deciding a content type. The carried copy of
 *   a file is named by the build rather than by the repository, so the type is
 *   read off the KEY the request asked for and never off the path it landed on.
 * @param rewrite applied to the file's TEXT when given, which is the one thing
 *   `/` needs and nothing else does.
 */
async function deliver(
  path: string | null,
  name?: string,
  rewrite?: (text: string) => string,
): Promise<Response> {
  if (path === null) return new Response("Not found", { status: 404 });

  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  const named = name ?? path;
  const ext = named.slice(named.lastIndexOf(".") + 1);
  const headers: Record<string, string> = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    // The change loop is Claude Code writing a file and this window re-reading
    // it. A cached module is that loop silently not working.
    "cache-control": "no-store",
  };
  // A FONT IS THE ONE STATIC FILE THE BOX FETCHES ACROSS ORIGINS. The artifact
  // frame has an opaque origin, and a `@font-face` src — unlike a classic
  // `<script src>` — is a CORS-gated subresource: the browser sends
  // `Origin: null` and refuses the file without this header. So the faces
  // `frame.js` weaves into a box would silently fall back to Georgia. Nothing
  // is exposed by it: these are the framework's own files, and a font cannot be
  // read back out of a stylesheet. Scoped to woff2 so it stays a statement
  // about fonts and never widens into data.
  if (ext === "woff2") headers["access-control-allow-origin"] = "*";
  if (rewrite) return new Response(rewrite(await file.text()), { headers });
  return new Response(await file.arrayBuffer(), { headers });
}

/* ── the token, and what it may be asked of ─────────────────────────────── */

/** WHERE THE TOKEN RIDES, and it is a query on the route rather than a field on
 *  the envelope. `contracts/wire.js` already argues this for the vault:
 *  `ApiRequest` is a strict superset of `HostRequest`, so a field on the
 *  envelope is a field an ARTIFACT could set — and an artifact has no business
 *  holding the key to the process hosting it. So the token is an ADDRESS, like
 *  the vault prefix, and `contracts/` is untouched by it.
 *
 *  IT IS SPELLED TWICE, HERE AND IN `client/transport/http.js`, and there is no
 *  third place to put it. `contracts/` is the only module both tiers may import
 *  — `layers.json` puts it at 0 and nothing else is reachable from both — and
 *  the token is deliberately not in `contracts/` at all, because a constant
 *  there is a constant an artifact's envelope could reach for. `client/boot.js`
 *  takes the client's copy from `http.js` rather than spelling a third. */
export const TOKEN_PARAM = "token";

/** One random value, minted at boot, held by the process that made it and the
 *  window it told. Not a password and not an account: it is what stops a stray
 *  tab, a script on a page somebody else opened, or another program on this
 *  machine reaching the workspace through a server that is, by design,
 *  answering on localhost. */
const mintToken = (): string => crypto.randomUUID().replaceAll("-", "");

/** Does this request carry the token the server minted?
 *
 *  WHAT IT IS ASKED OF IS THE HALF WORTH WRITING DOWN, AND IT IS ASKED OF ONE
 *  ROUTE. `API_ROUTE`, because the box cannot carry a token on anything it
 *  loads: the artifact frame has an opaque origin and pulls fonts, vendored
 *  scripts and the workspace's own plugins in by URL with no way to set a header
 *  or edit one. The framework's own read-only static roots therefore stay open,
 *  and they cost nothing to leave open — they are the published repository's
 *  files, and the chokepoint has always been about data rather than about code.
 *
 *  THE LIVE STREAM IS UNGUARDED TOO, and it is the cheapest of the three to
 *  say out loud: `/v/<vault>/events` carries no payload at all — the event says
 *  *something under this vault changed* and nothing else, and a reader has to
 *  come back through `API_ROUTE` to learn what. What it leaks is that a folder
 *  is being written to. It could carry the token, because nothing inside a box
 *  resolves its url relatively; it does not yet because the route itself only
 *  reaches `contracts/` at the barrier, and one change at a time.
 *
 *  THAT ARGUMENT DOES NOT COVER `/v/<vault>/asset/` AND `/v/<vault>/plugin/`,
 *  and saying so is the honest half. Those two serve the PERSON'S OWN FOLDER,
 *  not the repository's, and they are unguarded: any program on this machine
 *  that can guess a workspace path can read its pictures and its plugin scripts
 *  while the application is open. The data behind `API_ROUTE` — every page,
 *  every table, every file the API can write — is not reachable that way, which
 *  is why this is a hole rather than an open door.
 *
 *  IT IS NOT FIXED HERE BECAUSE THE TOKEN CANNOT RIDE THOSE URLS AS A QUERY. A
 *  page in the box writes `<img src="kitchen.jpg">` and the browser resolves it
 *  against the `<base href>` `client/boot.js` builds — and relative resolution
 *  REPLACES the base's query, so `…/asset/?token=…` resolves to
 *  `…/asset/kitchen.jpg` with the token gone. The token would have to be a path
 *  SEGMENT, which is an edit to `vaultBase` in `contracts/wire.js`; `contracts/`
 *  is frozen outside a barrier, and the spec's open questions name this exact
 *  choice as unsettled. `AGENTS.md` calls these two the unresolved
 *  half, and they are.
 *
 *  `expected` is null in every build run from source, where there is no shell to
 *  hand the value to and a token would only be a development server nobody can
 *  open in a browser. */
export function tokenOk(expected: string | null, url: URL): boolean {
  if (expected === null) return true;
  return url.searchParams.get(TOKEN_PARAM) === expected;
}

/* ── the live stream ────────────────────────────────────────────────────── */

// WHERE A TAB LISTENS: `GET /v/<url-encoded path>/events`, under the same vault
// prefix every other request carries, so an event from another folder cannot
// reach this tab — the client settles its vault before a module is constructed
// and the server keys subscribers by mount, which makes the separation
// structural rather than checked.
//
/** How often a comment frame is sent down an idle stream, in ms, and HOW LONG
 *  the server will let a connection sit silent, in seconds.
 *
 *  THESE TWO ARE ONE DECISION AND HAVE TO BE READ TOGETHER. `Bun.serve` closes
 *  an idle connection after ten seconds by default, which for a stream that
 *  exists to say nothing most of the time means a drop every ten seconds — and
 *  because a reconnect is itself a reason to reread, that is a redraw loop on a
 *  workspace nobody is touching. Measured, in a browser, before it was believed.
 *  So the server's patience is raised and a comment frame is sent well inside
 *  it; a proxy in front with its own idea about idle connections is the other
 *  reason for the beat. */
const KEEPALIVE = 20000;
const IDLE = 255;

/** One tab's stream over one vault.
 *
 *  THE EVENT CARRIES NOTHING. It says *something under this vault changed*; the
 *  client answers by reading disk. A payload naming files would be a second,
 *  faster description of the workspace that can disagree with the first.
 *
 *  THERE IS NO REPLAY AND NO EVENT ID. `EventSource` reconnects on its own and
 *  the client treats the reconnect itself as a reason to reread — the current
 *  state of disk is the whole of the answer, and a log would be a second
 *  description of it again.
 *
 *  Exported for the test that pins the cancel-before-the-watch-resolves
 *  ordering below. Nothing else calls it; the route in `fetch` does. */
export function events(host: Host, path: string): Response {
  const bytes = new TextEncoder();
  /** @type {(() => void) | null} */
  let release: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let shut = false;

  const stop = () => {
    shut = true;
    if (beat !== null) clearInterval(beat);
    beat = null;
    if (release !== null) release();
    release = null;
  };

  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController<Uint8Array>) {
      const send = (text: string): void => {
        if (shut) return;
        try {
          controller.enqueue(bytes.encode(text));
        } catch {
          // The tab went away between the notification and the write. `cancel`
          // is what releases the watch; this is only the frame that missed.
          stop();
        }
      };
      let got: () => void;
      try {
        got = await host.watch(path, () => send("event: change\ndata: 1\n\n"));
      } catch {
        // A folder that cannot be a workspace. The stream ends rather than
        // hanging, and the tab's own reconnect will keep asking — which is
        // correct: the folder may be there in a moment.
        stop();
        try {
          controller.close();
        } catch {
          /* the tab had already gone; there is nothing left to close */
        }
        return;
      }
      // THE TAB MAY HAVE GONE WHILE THE WATCH WAS BEING SET UP, and that is the
      // one ordering in here worth reading twice. `cancel` fires the moment the
      // connection drops, which can be before this await resolves — and `stop`
      // had no watch to release when it ran. So the release is checked for here
      // rather than assumed to have happened: a watch that arrives after its
      // stream has gone is let go the moment it arrives, and NOTHING is armed
      // behind it. Without this the vault's watcher and a twenty-second
      // interval outlive the tab for the life of the process.
      if (shut) {
        got();
        return;
      }
      release = got;
      // A COMMENT, not an event. The browser reports the connection open on the
      // first byte, and a page must not redraw merely because it connected.
      send(": open\n\n");
      // `send` may have shut the stream down on a tab that went away mid-frame,
      // and a timer armed after that is one nothing will ever clear.
      if (shut) return;
      beat = setInterval(() => send(": beat\n\n"), KEEPALIVE);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // Nginx and friends buffer a response body by default, which turns a live
      // stream into a file that arrives when the server gives up.
      "x-accel-buffering": "no",
    },
  });
}

/* ── the run ────────────────────────────────────────────────────────────── */

/** THE NAME THE SHELL PUTS IN THIS PROCESS'S ENVIRONMENT to say that it is
 *  holding the other end of stdin. Spelled here and in `app/main.js`, and in no
 *  third place — the rule every channel between those two files is under. */
export const PARENT_ENV = "BIOM_SHELL";

/** EXIT WHEN THE PROCESS THAT STARTED THIS ONE GOES.
 *
 *  THE FAILURE IT ENDS. The shell quits the server when its window closes, and
 *  that covers every ordinary ending — but a main process that ABORTS runs none
 *  of its own handlers, and what is left behind is a `biom-server` holding a port
 *  and somebody's workspace open with nothing on screen to say so. The owner's
 *  machine had two of them after one crash.
 *
 *  STDIN'S END OF FILE IS THE SIGNAL, and it was chosen over watching a parent
 *  pid because it is the only one of the two that is the same thing on all three
 *  platforms. `getppid()` is not on Windows at all; `PR_SET_PDEATHSIG` is Linux's
 *  alone; a poll for "is that pid still there" answers wrongly the moment the
 *  number is reused, and needs a timer that is awake forever to answer at all.
 *  A pipe needs none of that: the operating system closes the write end when the
 *  process holding it dies, however it dies, and the read end reaches end of file
 *  — on Linux, on macOS and on Windows.
 *
 *  NOTHING IS EVER SENT DOWN IT. The pipe carries no messages and this reads
 *  none: the only fact it transmits is its own closing.
 *
 *  AND IT IS OFF UNLESS THE MARKER SAYS OTHERWISE, which is what keeps every
 *  other way of starting this program unchanged. A server run from a terminal
 *  would otherwise quit on Ctrl-D, and one started with its stdin pointed at
 *  `/dev/null` — which is what a great many launchers do — would read end of file
 *  immediately and exit before it had served a single request. Only a parent that
 *  actually holds the pipe sets it. */
function exitWhenTheParentGoes(): void {
  if (Bun.env[PARENT_ENV] !== "1") return;
  void (async () => {
    try {
      // Drained rather than read: anything that did arrive is not a message.
      for await (const chunk of Bun.stdin.stream()) void chunk;
    } catch {
      // A stdin that cannot be read is one this cannot watch, and a server that
      // refused to run over that would be worse than one that outlives a crash.
      return;
    }
    console.log("the application that started this server has gone — stopping");
    // The same abrupt ending `kill()` gives it today, and for the same reason:
    // there is nothing to flush and the window it was serving no longer exists.
    process.exit(0);
  })();
}

// Only when this file is what was RUN. `makeHost` above is importable, which is
// how the vault swap is tested without a port and without a subprocess.
if (import.meta.main) {
  const memory = makeVaultMemory(MEMORY);
  // VAULT still wins on first boot, and it is now the ONLY way a particular
  // folder is served from the command line — the Makefile names none, so an
  // unqualified `make dev` can never open somebody's real workspace by default.
  // Otherwise the last one opened, which is the choice made in the UI; otherwise
  // a vault of this machine's own, which is the ordinary headless first run.
  // Otherwise the last one opened, which is the choice made in the UI. AND
  // OTHERWISE NOTHING: a run with no folder to open mounts none and the client
  // opens on the picker. There used to be a vault of this machine's own here,
  // created on the way up — which made a first launch indistinguishable from a
  // second and put a workspace on disk in a folder nobody picked.
  //
  // THE DECISION IS `bootVault`'S AND NOT THIS FILE'S, because what to do with a
  // remembered folder that has gone bad is a rule rather than a line: `VAULT=`
  // is trusted and created because somebody typed it on this launch, and a
  // remembered entry is checked because it is a claim about the past. It used to
  // be one ternary here, and what that ternary did to a deleted workspace was
  // recreate it — empty, seeded from scratch, wearing its name.
  const start = await bootVault(Bun.env.VAULT, await memory.last());
  const host = await makeHost({
    vault: start.path ?? undefined,
    memory: MEMORY,
    presets: PRESETS,
    vaultSeed: VAULT_SEED,
    skill: SKILL,
    production: PRODUCTION,
    pluginRoot: PLUGIN_ROOT,
  });

  // THE ONE COMPOSED ROUTE LEARNS WHY THERE IS NO WORKSPACE. Read through the
  // host on every request rather than captured here, so it decays the moment a
  // folder opens — see the getter on `Host.trouble`. `start.why` is a remembered
  // entry refused before it was tried and never changes; `host.trouble` is a
  // mount that failed anyway and does.
  TROUBLE = () => (host.open().length > 0 ? null : start.why ?? host.trouble);

  // MINTED ONLY WHERE THERE IS SOMETHING TO TELL IT TO. The compiled build is
  // opened by the shell, which reads this off stdout and puts it in the window's
  // address; a server run from source is opened by a person typing a url, and a
  // secret they would have to copy out of a terminal is a development loop with
  // a step in it.
  const TOKEN = STANDALONE ? mintToken() : null;

  const server = Bun.serve({
    port: PORT,
    // See KEEPALIVE: the default is ten seconds and a live stream says nothing
    // most of the time.
    idleTimeout: IDLE,
    async fetch(request) {
      const url = new URL(request.url);
      // WHICH FOLDER, read off the front of the path. `null` means the request
      // named none, which is legal: the picker has to be reachable before
      // anything has been chosen, and `vault.browse`, `vault.open` and
      // `vault.recent` are about vaults rather than in one.
      const named = vaultOf(url.pathname);
      const rest = named === null ? url.pathname : named.rest;

      if (rest === API_ROUTE) {
        // THE CHOKEPOINT IS THE ONE THING GUARDED. Refused with a status and no
        // envelope: the transport reads the body and treats anything that is
        // not an envelope as a transport fault, which is exactly what a request
        // that never reached the workspace is.
        if (!tokenOk(TOKEN, url)) return new Response("Not authorised", { status: 401 });
        // A FOLDER THAT WILL NOT OPEN ANSWERS IN THE ENVELOPE, AND THAT IS THE
        // CHANGE. This used to be a bare 404 with a plain-text body, on the
        // reasoning that a tab with a stale url should fall back to the picker
        // rather than show a broken page in a folder that is not there — which
        // is right about where the tab should end up and wrong about what it
        // should say. Nothing on the client reads the status: the transport
        // treats a body that is not an envelope as a transport fault, so what a
        // person actually saw was *the server answered 404 with something that
        // was not a response*, which names neither their folder nor what was
        // wrong with it. `deps` no longer rejects — it answers a set that
        // refuses with the mount's own sentence and still answers the kinds that
        // are about vaults — so there is nothing left to catch here.
        return await route(request, await host.deps(named === null ? undefined : named.path));
      }

      if (request.method !== "GET") return new Response("Use GET", { status: 405, headers: { allow: "GET" } });

      // THE ONE LIVE STREAM, and it is served from here rather than from
      // `server/api/routes.ts`: that module's whole contract is one request in
      // and one response out, it constructs nothing, and a long-lived stream is
      // neither. This is already the layer that splits the vault prefix off a
      // pathname and the only one holding the mount registry, which is where the
      // subscriber list lives.
      if (rest === EVENTS_ROUTE) {
        // A stream with no folder has nothing to say. There is no "current"
        // vault — that is the whole point of the prefix — so this is a 404
        // rather than a stream that never fires.
        if (named === null) return new Response("This request names no workspace", { status: 404 });
        return events(host, named.path);
      }

      if (named !== null) {
        // Only the vault-relative routes are offered under a vault prefix. The
        // framework's own files keep one url whichever folder you are looking at,
        // so a module is fetched and cached once rather than once per vault.
        const rel = decodeURIComponent(named.rest);
        // THE FOLDER, BEFORE ANY FILE IN IT. `/plugin/` with nothing after it is
        // the loader's answer — every plugin this vault has, as one script — and
        // it has to be caught here, because `under()` resolves it to the folder
        // itself and `deliver` cannot read a directory.
        if (rel === PLUGIN_DIR_ROUTE) return await pluginBundle(named.path, host.pluginRoot);
        if (rel.startsWith(PLUGIN_DIR_ROUTE)) return await pluginFile(rel.slice(PLUGIN_DIR_ROUTE.length), named.path, host.pluginRoot);
        const inside = inVault(rel, named.path);
        if (inside !== null) return await deliver(inside);
        // Anything else under the prefix is the client itself: a deep link like
        // /v/<vault>/ is somebody opening a tab, and it must answer with the app
        // rather than a 404 they cannot navigate out of — and `serveStatic` is
        // what composes the root document, so a deep link into a vault carries
        // which build this is by the same path a bare `/` does.
        return await serveStatic(rel);
      }

      return await serveStatic(decodeURIComponent(url.pathname));
    },
  });

  // THE ONE LINE THE SHELL READS, before anything else this process says and
  // only in the build that has a shell. The port is the operating system's
  // answer to port 0 and the token is this launch's — neither is predictable,
  // and neither is written to a file, because a file is a thing left behind when
  // the application is killed.
  if (TOKEN !== null) console.log(`biom ready ${JSON.stringify({ port: server.port, token: TOKEN })}`);
  // AND THE LIFETIME, from this end. Armed after the port is open so a launch
  // that ends the moment it begins still says what it was — see
  // `exitWhenTheParentGoes`, which does nothing at all unless a parent said it
  // is holding the other end of stdin.
  exitWhenTheParentGoes();
  console.log(`Biom framework  →  http://localhost:${server.port}   (${ENV})`);
  // NOTHING OPEN IS A STATE AND IT SAYS SO. A first launch has no folder, and a
  // line saying which workspace is being served would be a line about nothing.
  //
  // IT IS TWO DIFFERENT STATES AND THEY READ DIFFERENTLY. A launch that had
  // nothing to open is a first launch; a launch that HAD something and could not
  // open it is a person whose workspace is not on their screen, and telling them
  // to pick one without saying what happened to theirs is the program pretending
  // the folder never existed. `bootVault` refuses a remembered folder before it
  // is tried and `Host.trouble` carries a mount that failed anyway; one of the
  // two is set at most, and the sentence is the same shape either way.
  const why = start.why ?? host.trouble;
  if (host.open().length === 0) {
    console.log(
      why === null
        ? "vault              →  none yet — pick or create one in the app"
        : `vault              →  ${why}\n` +
          "                      pick or create one in the app",
    );
  }
  for (const path of host.open()) {
    // A VAULT WITH NO HISTORY SAYS SO, once, next to its own path. It is not the
    // place this belongs — the person who needs to know is looking at the app,
    // not at a terminal — and the UI cannot be told until `VaultInfo` can carry
    // the fact, which is a `contracts/` edit and waits for a barrier. Until then
    // the strip claims nothing about git rather than claiming git it has not
    // got, and this line is the honest half that is available today.
    const history = hasHistory(path) ? "" : "   no versions are being kept — install git and reopen";
    console.log(`vault              →  ${path}${history}`);
  }
}
