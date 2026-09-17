// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — AUTOMATIONS AND RUNS. The folder reader over `<page>/automations/`,
// the registry in `<vault>/.biom/runs.db`, the run directory's assembly, start,
// list, read-from-offset, kill, and the reconcile pass on mount.
//
// THE ONE MODULE BESIDE `tables.ts` THAT MAY IMPORT `db.ts`. The rule on that
// file is that every statement of SQL in the framework lives in one of the
// files it names, so swapping the database is a known number of files; this
// one is the third, and the header on `db.ts` says so.
//
// WHAT THE FRAMEWORK KNOWS ABOUT A RUN IS THE ROW, AND NOTHING ELSE. It starts
// a command, keeps a row for it, serves what the command printed byte for byte
// and never reads it. It knows no agent by name: `agent` in a manifest is a
// label for people, there are no adapters, no vendor's stream is parsed, and a
// session is a page's business to resume out of the log it can read. What
// makes that honest is that every harness the workspace uses is a command on
// the server's own PATH with a flag that grants it the vault — see the guide.
//
// THE RUN DIRECTORY IS THE INTERFACE. `.biom/runs/<id>/` is assembled from the
// automation's folder and its page — copies of what is the record of what ran,
// links to what an environment built later would belong to — and the process
// starts there. It is already the shape of a container: the working directory
// is the run's, the `vault` link is a bind mount, the environment is the
// environment, and the two logs are the two streams. A runner that takes the
// same directory into an image changes nothing above this line.

import type { Automation, AutomationInput, AutomationManifest, Db, Files, PageId, PageRef, ProcessRunner, RunRead, RunRow, RunStatus, Runs, Template, VarScalar, VaultFile } from "../../contracts/types.ts";
import type { HostErrorCode } from "../../contracts/types.ts";
import type { RunFs } from "../platform/rundir.ts";

const bad = (code: HostErrorCode, message: string) => Object.assign(new Error(message), { code });

/** Where a page's automations live, under its directory. */
export const AUTOMATIONS_DIR = "automations";
export const MANIFEST = "automation.yaml";
export const KICKOFF = "kickoff.md";
/** THE PERSON'S FILE, at every level: the workspace's beside the vault's
 *  `AGENTS.md`, the page's beside `content.yaml`, the automation's beside its
 *  manifest. `AGENTS.md` is the framework's at every level and is never one a
 *  person edits: the vault's is seeded and rewritten, the run's is generated. */
export const INSTRUCTIONS = "INSTRUCTIONS.md";
export const SKILLS_DIR = "skills";
export const CODE_DIR = "code";
/** The framework's own folder inside a vault, and it ignores itself: a registry
 *  of what ran on one machine is that machine's, and never in git. */
export const BIOM_DIR = ".biom";
export const RUNS_DB = "runs.db";
export const RUNS_DIR = "runs";
export const STDOUT = "stdout.log";
export const STDERR = "stderr.log";
/** The workspace's own skills, and the folder the vault's instructions sit beside. */
export const VAULT_SKILLS = ".agents/skills";

/** Sorted the way a directory listing reads: by code unit, so the order is the
 *  same on every machine and the same whatever the locale. */
const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** A folder name under `automations/`: lowercase, digits, dashes. The same
 *  grammar a plugin id has, because it is the same kind of thing — a name in a
 *  file that is typed once and then read by everything. */
export const FOLDER = /^[a-z][a-z0-9-]*$/;

/** How long `kill` waits between TERM and KILL. A number the build picks, as
 *  the spec left it, and measured against the workspace's four pipelines when
 *  they run from the screen. */
export const KILL_GRACE = 5000;
/** How much of a log one `run.read` hands back when the caller names no `max`. */
export const READ_MAX = 64 * 1024;

/** THE FLOOR OF EVERY ENVIRONMENT, and the one deliberate exception to *nothing
 *  else of the server's*. A harness finds its login, its settings and its
 *  cache under the person's home, a shell needs to know which one it is, and a
 *  process writing a temporary file needs somewhere to put it. Without these a
 *  run cannot authenticate as the person, which is the whole premise. Nothing
 *  here is a secret and nothing here is `BIOM_SHELL`, which never crosses. */
export const ENV_FLOOR: readonly string[] = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TZ", "TERM", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "COMSPEC"];

export interface RunsDeps {
  /** `<vault>/.biom/runs.db`, opened by the composition root through `db.ts`. */
  db: Db;
  /** The vault's own text files, relative to its root. */
  files: Files;
  /** The disk under the vault, absolute, for links, copies and byte slices. */
  fs: RunFs;
  yaml: { parseAny(text: string): unknown; formatAny(value: unknown): string };
  process: ProcessRunner;
  /** Where a page's directory is, relative to the vault. `pages.ts` owns the
   *  walk and this module is its sibling, so the root hands it down. */
  dirOf: (id: PageId) => string;
  /** The page, if it is one: its name and its uid. */
  refOf: (id: PageId) => Promise<PageRef | null>;
  /** The server's own environment, read at start and never stored. */
  env: () => Record<string, string | undefined>;
  /** The templates New copies: one folder per harness, read-only, the
   *  framework's own and never in the vault. */
  templates: Files;
  /** Where the running server answers this vault, for `BIOM_API`. */
  api: () => { url: string; token: string | null };
  /** Is a skill under `.agents/skills/` one the seeder wrote? The server knows
   *  its own roster; nothing here carries a list. */
  seededSkill: (name: string) => Promise<boolean>;
  /** A run started or ended. The root turns it into one payload-free event on
   *  the vault's stream, exactly as a changed file becomes one. */
  onChange: (what: "start" | "end", row: RunRow) => void;
  now?: () => number;
  grace?: number;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  page TEXT NOT NULL,
  uid TEXT,
  automation TEXT NOT NULL,
  started_by TEXT,
  command TEXT NOT NULL,
  inputs TEXT NOT NULL,
  pid INTEGER,
  pgid INTEGER,
  started INTEGER NOT NULL,
  ended INTEGER,
  status TEXT NOT NULL,
  exit INTEGER,
  signal TEXT,
  ended_by TEXT
)`;

interface Raw {
  id: string; page: string; uid: string | null; automation: string; started_by: string | null;
  command: string; inputs: string; pid: number | null; pgid: number | null;
  started: number; ended: number | null; status: string; exit: number | null; signal: string | null; ended_by: string | null;
}

const rowOf = (r: Raw): RunRow => ({
  id: r.id,
  page: r.page,
  uid: r.uid,
  automation: r.automation,
  by: r.started_by,
  command: JSON.parse(r.command) as string[],
  inputs: JSON.parse(r.inputs) as Record<string, VarScalar>,
  pid: r.pid,
  pgid: r.pgid,
  started: r.started,
  ended: r.ended,
  status: r.status as RunStatus,
  exit: r.exit,
  signal: r.signal,
  endedBy: r.ended_by as RunRow["endedBy"],
});

/** A run id: twelve characters, lowercase letters and digits, and the name of
 *  its directory under `.biom/runs/`. Random rather than a counter, because a
 *  counter is a claim about ordering the registry already states with
 *  `started`. */
function mintId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/* ── the manifest ──────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const isScalar = (v: unknown): v is VarScalar =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** Narrow a parsed `automation.yaml` into the manifest, or throw the one
 *  sentence that says what is wrong with it. Absent keys take the thinnest
 *  default; a key that is the wrong shape is refused, because a manifest that
 *  is not a manifest is a broken one and not a quiet one. */
export function manifestOf(value: unknown, folder: string): AutomationManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("the manifest is not a map");
  const raw = value as Record<string, unknown>;
  const name = str(raw.name) ?? folder;
  const description = str(raw.description) ?? "";
  const agent = str(raw.agent) ?? "";
  const env = raw.env === undefined || raw.env === null ? [] : raw.env;
  if (!Array.isArray(env) || !env.every((e) => typeof e === "string" && e !== "")) throw new Error("env is a list of names");
  const command = raw.command;
  if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === "string" || typeof c === "number")) {
    throw new Error("command is a list of arguments, and it needs at least one");
  }
  const inputsRaw = raw.inputs === undefined || raw.inputs === null ? [] : raw.inputs;
  if (!Array.isArray(inputsRaw)) throw new Error("inputs is a list of fields");
  const inputs: AutomationInput[] = [];
  const seen = new Set<string>();
  for (const one of inputsRaw) {
    if (typeof one !== "object" || one === null || Array.isArray(one)) throw new Error("an input is a map with a name");
    const field = one as Record<string, unknown>;
    const n = str(field.name);
    if (n === null || n === "" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error("an input needs a name that could be a word");
    if (seen.has(n)) throw new Error(`the input ${n} is declared twice`);
    seen.add(n);
    const type = field.type === undefined ? "text" : field.type;
    if (type !== "text" && type !== "number" && type !== "boolean") throw new Error(`the input ${n} has a type that is not text, number or boolean`);
    const input: AutomationInput = { name: n, type };
    if (field.default !== undefined && isScalar(field.default)) input.default = field.default;
    if (field.required === true) input.required = true;
    inputs.push(input);
  }
  return { name, description, agent, env: env as string[], command: command.map(String), inputs };
}

/** The manifest as it is written back: keys in reading order, the empty lists
 *  left out, so a file the form saved reads like one a person wrote. */
function manifestShape(m: AutomationManifest): Record<string, unknown> {
  const out: Record<string, unknown> = { name: m.name };
  if (m.description !== "") out.description = m.description;
  if (m.agent !== "") out.agent = m.agent;
  if (m.env.length > 0) out.env = m.env;
  out.command = m.command;
  if (m.inputs.length > 0) out.inputs = m.inputs;
  return out;
}

/* ── substitution ──────────────────────────────────────────────────────── */

/** Coerce and check what a caller passed against what the manifest declares.
 *  Every declared input ends up present — the value given, the default, or a
 *  refusal by name — and an input nobody declared is refused too, because a
 *  misspelled name on a form should not vanish quietly. */
export function settleInputs(declared: AutomationInput[], given: Record<string, VarScalar>): Record<string, VarScalar> {
  const names = new Set(declared.map((d) => d.name));
  for (const k of Object.keys(given)) if (!names.has(k)) throw bad("bad_request", `no input called ${k}`);
  const out: Record<string, VarScalar> = {};
  for (const d of declared) {
    let v: VarScalar | undefined = given[d.name];
    if (v === undefined || v === null || v === "") v = d.default;
    if (v === undefined || v === null || v === "") {
      if (d.required) throw bad("bad_request", `the input ${d.name} is required`);
      out[d.name] = d.type === "boolean" ? false : d.type === "number" ? 0 : "";
      continue;
    }
    if (d.type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) throw bad("bad_request", `the input ${d.name} is a number`);
      out[d.name] = n;
    } else if (d.type === "boolean") {
      out[d.name] = v === true || v === "true" || v === "yes" || v === 1 || v === "1";
    } else {
      out[d.name] = String(v);
    }
  }
  return out;
}

/** `{name}` → its value, everywhere in a string. A name that is not an input
 *  and not one of the four the framework fills is left as it was: a kickoff
 *  that says `{like this}` in prose is not a template error. */
export function substitute(text: string, values: Record<string, string>): string {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] ?? whole : whole);
}

const asWord = (v: VarScalar): string => (v === null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v));

/* ── the run's own AGENTS.md ───────────────────────────────────────────── */

/** THE FRAMEWORK'S FILE IN THE RUN DIRECTORY, the same every run, which every
 *  harness that walks parents finds first because it is in the working
 *  directory. It says where the vault is and which `INSTRUCTIONS.md` to read
 *  in what order — so no author has to remember to say so, and nothing is
 *  prepended to the prompt. The kickoff is the author's, substituted and
 *  nothing more. */
export function runAgentsMd(spec: { automation: string; page: PageId; runDir: string; vault: string; pageDir: string; inputs: Record<string, VarScalar>; kickoff: boolean }): string {
  const inputs = Object.entries(spec.inputs).map(([k, v]) => `${k} = ${asWord(v)}`).join(", ");
  return [
    "# This run",
    `You are running unattended as the automation \`${spec.automation}\` of the page \`${spec.page}\` in a Biom workspace.`,
    `Your working directory is this run's own: ${spec.runDir}/. Scratch here is yours.`,
    `The workspace is at ./vault/ (${spec.vault}/). Every page is under vault/pages/.`,
    "Read, in this order, and let each outrank the one before it:",
    `  vault/${INSTRUCTIONS}      the workspace's, beside its docs/ and ${VAULT_SKILLS}/`,
    `  ./page/${INSTRUCTIONS}     the page's — vault/${spec.pageDir}/`,
    `  ./${INSTRUCTIONS}          this automation's, with its skills at ./${SKILLS_DIR}/`,
    "Rows live in the workspace's tables and are written through the API at $BIOM_API,",
    "never by opening workspace.db.",
    (inputs === "" ? "There are no inputs." : `Inputs: ${inputs}.`) + (spec.kickoff ? ` The prompt is ./${KICKOFF}.` : ""),
    "",
  ].join("\n");
}

/** ONE CONFIG FILE PER HARNESS, granting the vault's REAL path — never the
 *  `vault` link, because two of the sandboxes resolve it and one refuses it.
 *  Carried for the harnesses that honour a project file and as the written
 *  intent for the ones that only take the grant on the command line. The
 *  guide's table says which is which and keeps it current. */
export function harnessFiles(vault: string): Record<string, string> {
  return {
    ".claude/settings.json": JSON.stringify({ permissions: { additionalDirectories: [vault] } }, null, 2) + "\n",
    ".codex/config.toml": `[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(vault)}]\n`,
    "opencode.json": JSON.stringify({ $schema: "https://opencode.ai/config.json", permission: { external_directory: "allow" } }, null, 2) + "\n",
    ".gemini/settings.json": JSON.stringify({ context: { includeDirectories: [vault], fileName: ["AGENTS.md"] } }, null, 2) + "\n",
    ".cursor/cli.json": JSON.stringify({ permissions: { allow: [`Read(${vault}/**)`, `Write(${vault}/**)`] } }, null, 2) + "\n",
  };
}

/* ── utf-8 at a cut ────────────────────────────────────────────────────── */

/** How many of these bytes end on a character boundary. A `max` that lands
 *  inside a multibyte character would decode its head as one replacement and
 *  its tail as another on the next read; holding the head back makes the next
 *  read start on the character. At most three bytes are ever held. */
export function completeUtf8(bytes: Uint8Array): number {
  const n = bytes.length;
  if (n === 0) return 0;
  // Walk back over continuation bytes (10xxxxxx) to the lead byte.
  let i = n - 1;
  let back = 0;
  while (i >= 0 && back < 3 && (bytes[i]! & 0xc0) === 0x80) { i--; back++; }
  if (i < 0) return n;
  const lead = bytes[i]!;
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  const have = n - i;
  return have < need ? i : n;
}

/* ── the module ────────────────────────────────────────────────────────── */

export function makeRuns(d: RunsDeps): Runs {
  const { db, files, fs, yaml } = d;
  const now = d.now ?? (() => Date.now());
  const grace = d.grace ?? KILL_GRACE;
  db.run(SCHEMA);

  const vaultAbs = fs.root;
  const abs = (rel: string): string => `${vaultAbs}/${rel}`;
  const runDirOf = (id: string): string => abs(`${BIOM_DIR}/${RUNS_DIR}/${id}`);

  /** What ends a run: the settled promise of its process, or a kill. Kept
   *  per run so a kill can record why before the exit lands. */
  const pendingEnd = new Map<string, "page" | "screen" | "shutdown">();

  const readRow = (id: string): RunRow | null => {
    const r = db.all<Raw>(`SELECT * FROM runs WHERE id = ?`, [id])[0];
    return r === undefined ? null : rowOf(r);
  };

  const finish = (id: string, exit: number | null, signal: string | null): void => {
    const was = readRow(id);
    if (was === null || was.status !== "running") return;
    const by = pendingEnd.get(id) ?? null;
    pendingEnd.delete(id);
    const status: RunStatus = by !== null ? "killed" : "exited";
    db.run(`UPDATE runs SET ended = ?, status = ?, exit = ?, signal = ?, ended_by = ? WHERE id = ?`,
      [now(), status, exit, signal, by, id]);
    const row = readRow(id);
    if (row !== null) d.onChange("end", row);
  };

  /** The automation folders under one page, with each manifest read or its
   *  trouble kept. */
  async function foldersOf(page: PageId, ref: PageRef): Promise<Automation[]> {
    const dir = `${d.dirOf(page)}/${AUTOMATIONS_DIR}`;
    let entries: { name: string; dir: boolean }[] = [];
    try {
      entries = await files.list(dir);
    } catch {
      return [];
    }
    const out: Automation[] = [];
    for (const e of entries.filter((x) => x.dir).sort(byName)) {
      const text = await files.read(`${dir}/${e.name}/${MANIFEST}`);
      if (text === null) continue; // a folder is an automation iff it holds the manifest
      let manifest: AutomationManifest | null = null;
      let trouble: string | null = null;
      try {
        manifest = manifestOf(yaml.parseAny(text), e.name);
      } catch (err) {
        trouble = err instanceof Error ? err.message : String(err);
      }
      out.push({ page, ...(typeof ref.uid === "string" ? { uid: ref.uid } : {}), folder: e.name, manifest, trouble });
    }
    return out;
  }

  /** Every page in the vault that holds an `automations/` directory, found by
   *  walking the pages tree by directory. Cheaper than reading every page and
   *  correct on the same grounds the tree is: the folder is the hierarchy. */
  async function pagesWithAutomations(): Promise<PageId[]> {
    const out: PageId[] = [];
    const walk = async (id: PageId): Promise<void> => {
      const dir = d.dirOf(id);
      let entries: { name: string; dir: boolean }[] = [];
      try {
        entries = await files.list(dir);
      } catch {
        return;
      }
      if (entries.some((e) => e.dir && e.name === AUTOMATIONS_DIR)) out.push(id);
      if (entries.some((e) => e.dir && e.name === "children")) {
        let kids: { name: string; dir: boolean }[] = [];
        try {
          kids = await files.list(`${dir}/children`);
        } catch {
          kids = [];
        }
        for (const k of kids.filter((x) => x.dir).sort(byName)) await walk(`${id}/${k.name}`);
      }
    };
    await walk("home");
    return out;
  }

  const manifestPath = (page: PageId, folder: string): string => {
    if (!FOLDER.test(folder)) throw bad("bad_request", "that is not an automation's name");
    return `${d.dirOf(page)}/${AUTOMATIONS_DIR}/${folder}/${MANIFEST}`;
  };

  async function readManifest(page: PageId, folder: string): Promise<AutomationManifest> {
    const text = await files.read(manifestPath(page, folder));
    if (text === null) throw bad("not_found", "no such automation");
    try {
      return manifestOf(yaml.parseAny(text), folder);
    } catch (e) {
      throw bad("bad_request", `the manifest will not read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Copy every file under `from` in `src` to `to` in `files`. Both are
   *  `Files`, so a template out of the compiled binary copies exactly as one
   *  off the disk does. */
  async function copyTree(src: Files, from: string, to: string): Promise<number> {
    let n = 0;
    let entries: { name: string; dir: boolean }[] = [];
    try {
      entries = await src.list(from);
    } catch {
      return 0;
    }
    for (const e of entries) {
      const a = from === "" ? e.name : `${from}/${e.name}`;
      const b = `${to}/${e.name}`;
      if (e.dir) {
        n += await copyTree(src, a, b);
      } else {
        const text = await src.read(a);
        if (text !== null) {
          await files.write(b, text);
          n += 1;
        }
      }
    }
    return n;
  }

  /** Every file under a directory, relative to the vault, depth first. */
  async function filesUnder(rel: string): Promise<string[]> {
    const out: string[] = [];
    let entries: { name: string; dir: boolean }[] = [];
    try {
      entries = await files.list(rel);
    } catch {
      return out;
    }
    for (const e of entries.sort(byName)) {
      const p = `${rel}/${e.name}`;
      if (e.dir) out.push(...(await filesUnder(p)));
      else out.push(p);
    }
    return out;
  }

  const runs: Runs = {
    async automations(page) {
      if (page !== undefined) {
        const ref = await d.refOf(page);
        if (ref === null) throw bad("not_found", "no such page");
        return await foldersOf(page, ref);
      }
      const out: Automation[] = [];
      for (const id of await pagesWithAutomations()) {
        const ref = await d.refOf(id);
        if (ref === null) continue;
        out.push(...(await foldersOf(id, ref)));
      }
      return out;
    },

    manifest: readManifest,

    async setManifest(page, folder, manifest) {
      const path = manifestPath(page, folder);
      if ((await files.read(path)) === null) throw bad("not_found", "no such automation");
      // Narrowed through the same reader the file goes through, so the form
      // cannot write what the folder reader would then refuse.
      const clean = manifestOf(manifestShape(manifest), folder);
      await files.commit(`Before the manifest of ${folder} was written`);
      await files.write(path, yaml.formatAny(manifestShape(clean)));
    },

    async templates() {
      let entries: { name: string; dir: boolean }[] = [];
      try {
        entries = await d.templates.list("");
      } catch {
        return [];
      }
      const out: Template[] = [];
      for (const e of entries.filter((x) => x.dir).sort(byName)) {
        const text = await d.templates.read(`${e.name}/${MANIFEST}`);
        if (text === null) continue;
        try {
          const m = manifestOf(yaml.parseAny(text), e.name);
          out.push({ id: e.name, name: m.name, agent: m.agent });
        } catch {
          // A template that will not read is the framework's own fault and is
          // left out rather than offered.
        }
      }
      return out;
    },

    async create(page, name, template) {
      const ref = await d.refOf(page);
      if (ref === null) throw bad("not_found", "no such page");
      const folder = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!FOLDER.test(folder)) throw bad("bad_request", "an automation needs a name that could be a folder");
      if (!FOLDER.test(template)) throw bad("bad_request", "that is not a template");
      const to = `${d.dirOf(page)}/${AUTOMATIONS_DIR}/${folder}`;
      let there: { name: string; dir: boolean }[] = [];
      try {
        there = await files.list(to);
      } catch {
        there = [];
      }
      if (there.length > 0) throw bad("bad_request", `there is already an automation called ${folder} on this page`);
      if ((await d.templates.read(`${template}/${MANIFEST}`)) === null) throw bad("not_found", "no such template");
      await files.commit(`Before the automation ${folder} was made`);
      await copyTree(d.templates, template, to);
      // The copy is named what the person called it; everything else in it
      // is the template's, and theirs from this moment.
      const m = await readManifest(page, folder);
      m.name = name.trim();
      await files.write(`${to}/${MANIFEST}`, yaml.formatAny(manifestShape(m)));
      return { page, ...(typeof ref.uid === "string" ? { uid: ref.uid } : {}), folder, manifest: m, trouble: null };
    },

    async start(page, folder, given, by) {
      const ref = await d.refOf(page);
      if (ref === null) throw bad("not_found", "no such page");
      const manifest = await readManifest(page, folder);
      const inputs = settleInputs(manifest.inputs, given);

      // EVERY NAME THE MANIFEST ASKS FOR, PRESENT, or the run is refused by
      // name before anything is written. The values are read here and go
      // into the process's environment and nowhere else — never a file, never
      // a row, never the wire.
      const serverEnv = d.env();
      for (const name of manifest.env) {
        if (serverEnv[name] === undefined || serverEnv[name] === "") throw bad("bad_request", `the environment has no ${name}`);
      }

      const id = mintId();
      const runDir = runDirOf(id);
      const pageRel = d.dirOf(page);
      const folderRel = `${pageRel}/${AUTOMATIONS_DIR}/${folder}`;
      const folderAbs = abs(folderRel);
      fs.mkdir(runDir);

      // The four names the framework fills, then every input, as words.
      const words: Record<string, string> = { vault: vaultAbs, run: runDir, kickoff: `${runDir}/${KICKOFF}` };
      for (const [k, v] of Object.entries(inputs)) words[k] = asWord(v);

      // THE COPIES ARE THE RECORD OF WHAT RAN. The manifest as it was, the
      // kickoff with its inputs written in and nothing else, the automation's
      // own instructions.
      fs.copy(`${folderAbs}/${MANIFEST}`, `${runDir}/${MANIFEST}`);
      const kickoffText = await files.read(`${folderRel}/${KICKOFF}`);
      if (kickoffText !== null) fs.writeText(`${runDir}/${KICKOFF}`, substitute(kickoffText, words));
      if (fs.exists(`${folderAbs}/${INSTRUCTIONS}`)) fs.copy(`${folderAbs}/${INSTRUCTIONS}`, `${runDir}/${INSTRUCTIONS}`);
      // THE LINKS ARE WHAT AN ENVIRONMENT BUILT LATER WOULD BELONG TO — the
      // automation's, not the run's — and what the vault's commit already
      // records the version of.
      if (fs.isDir(`${folderAbs}/${SKILLS_DIR}`)) {
        fs.link(`${folderAbs}/${SKILLS_DIR}`, `${runDir}/${SKILLS_DIR}`);
        // Where every harness looks for skills, both pointing at the one folder.
        fs.link(`../${SKILLS_DIR}`, `${runDir}/.agents/${SKILLS_DIR}`);
        fs.link(`../${SKILLS_DIR}`, `${runDir}/.claude/${SKILLS_DIR}`);
      }
      if (fs.isDir(`${folderAbs}/${CODE_DIR}`)) fs.link(`${folderAbs}/${CODE_DIR}`, `${runDir}/${CODE_DIR}`);
      // The page's instructions under `page/`, so nothing is merged and the
      // agent reads both.
      if (fs.exists(abs(`${pageRel}/${INSTRUCTIONS}`))) fs.link(abs(`${pageRel}/${INSTRUCTIONS}`), `${runDir}/page/${INSTRUCTIONS}`);
      // ONE LINK TO THE VAULT ROOT, never one per page: per-page links go
      // stale the moment a run makes a page.
      fs.link(vaultAbs, `${runDir}/vault`);
      // THE FRAMEWORK'S OWN FILE, and every harness's name for it.
      fs.writeText(`${runDir}/AGENTS.md`, runAgentsMd({ automation: folder, page, runDir, vault: vaultAbs, pageDir: pageRel, inputs, kickoff: kickoffText !== null }));
      fs.link("AGENTS.md", `${runDir}/CLAUDE.md`);
      for (const [rel, text] of Object.entries(harnessFiles(vaultAbs))) fs.writeText(`${runDir}/${rel}`, text);

      // THE ENVIRONMENT: the floor every process needs, what this run is, and
      // every name the manifest asked for with its value from the server's own
      // environment — and nothing else of the server's.
      //
      // DEPENDENCIES ARE THE FEATURE TO ADD HERE, per the Automations spec,
      // and they are deferred by decision rather than by oversight. This line
      // inherits PATH; what ships later is `runtime:` in the manifest naming
      // a language and version, a lockfile beside `code/`, an environment built
      // once under `.biom/envs/<hash>/` and put FIRST on this PATH, so a run
      // that starts in a container where nothing is ambient finds what it
      // needs. Until then every command runs on the machine it is on and is
      // hoped to work there.
      const env: Record<string, string> = {};
      for (const k of ENV_FLOOR) if (serverEnv[k] !== undefined) env[k] = serverEnv[k] as string;
      env.BIOM_VAULT = vaultAbs;
      env.BIOM_RUN = runDir;
      const where = d.api();
      env.BIOM_API = where.token === null ? where.url : `${where.url}?token=${encodeURIComponent(where.token)}`;
      for (const name of manifest.env) env[name] = serverEnv[name] as string;

      const command = manifest.command.map((arg) => substitute(arg, words));
      const started = now();
      let handle;
      try {
        handle = d.process.start({ cmd: command, cwd: runDir, env, stdout: `${runDir}/${STDOUT}`, stderr: `${runDir}/${STDERR}` });
      } catch (e) {
        fs.remove(runDir);
        throw bad("bad_request", `the command could not be started: ${e instanceof Error ? e.message : String(e)}`);
      }
      db.run(
        `INSERT INTO runs (id, page, uid, automation, started_by, command, inputs, pid, pgid, started, ended, status, exit, signal, ended_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'running', NULL, NULL, NULL)`,
        [id, page, ref.uid ?? null, folder, by, JSON.stringify(command), JSON.stringify(inputs),
          handle.pid > 0 ? handle.pid : null, handle.pgid > 0 ? handle.pgid : null, started],
      );
      const row = readRow(id);
      if (row === null) throw bad("internal", "the run was not recorded");
      d.onChange("start", row);
      void handle.done.then(({ exit, signal }) => finish(id, exit, signal));
      return row;
    },

    list(filter) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      // BY ID OR BY IDENTITY. A row keeps the id its page had when the run
      // started; a page moved since has a new id and the same uid, and its
      // runs are still its own.
      if (filter?.page !== undefined && filter.uid !== undefined) { where.push("(page = ? OR uid = ?)"); params.push(filter.page, filter.uid); }
      else if (filter?.page !== undefined) { where.push("page = ?"); params.push(filter.page); }
      else if (filter?.uid !== undefined) { where.push("uid = ?"); params.push(filter.uid); }
      if (filter?.automation !== undefined) { where.push("automation = ?"); params.push(filter.automation); }
      const sql = `SELECT * FROM runs${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY started DESC, id DESC`;
      return db.all<Raw>(sql, params).map(rowOf);
    },

    get: readRow,

    async read(id, stream, from = 0, max = READ_MAX) {
      const row = readRow(id);
      if (row === null) throw bad("not_found", "no such run");
      const file = `${runDirOf(id)}/${stream === "stdout" ? STDOUT : STDERR}`;
      const { bytes, size } = fs.slice(file, from, max);
      const ended = row.status !== "running";
      // A character cut by `max` is held back for the next read — unless the
      // file is finished and this is its end, where what is there is all there
      // will be.
      const atEnd = from + bytes.length >= size;
      const keep = ended && atEnd ? bytes.length : completeUtf8(bytes);
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, keep));
      return { text, next: from + keep, ended } satisfies RunRead;
    },

    async kill(id, by) {
      const row = readRow(id);
      if (row === null) throw bad("not_found", "no such run");
      if (row.status !== "running") return row;
      pendingEnd.set(id, by);
      if (row.pgid !== null) {
        await d.process.end(row.pgid, grace);
      }
      // The exit lands through `done` on a real process; a row whose process
      // this server never held — one reconciled after a restart — is finished
      // here, because nothing else will.
      const after = readRow(id);
      if (after !== null && after.status === "running" && (row.pid === null || !d.process.alive(row.pid))) finish(id, null, "SIGKILL");
      return readRow(id) ?? row;
    },

    reconcile() {
      let lost = 0;
      for (const r of db.all<Raw>(`SELECT * FROM runs WHERE status = 'running'`)) {
        if (r.pid !== null && d.process.alive(r.pid)) continue;
        db.run(`UPDATE runs SET status = 'lost', ended = ? WHERE id = ?`, [now(), r.id]);
        lost += 1;
      }
      return lost;
    },

    live() {
      const r = db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM runs WHERE status = 'running'`)[0];
      return r === undefined ? 0 : Number(r.n);
    },

    async endAll(by) {
      for (const r of db.all<Raw>(`SELECT * FROM runs WHERE status = 'running'`)) {
        await runs.kill(r.id, by);
      }
    },

    async pageFiles(page) {
      const ref = await d.refOf(page);
      if (ref === null) throw bad("not_found", "no such page");
      const dir = d.dirOf(page);
      const out: VaultFile[] = [{ path: INSTRUCTIONS, seeded: false }];
      const autos = `${dir}/${AUTOMATIONS_DIR}`;
      for (const p of await filesUnder(autos)) out.push({ path: p.slice(dir.length + 1), seeded: false });
      return out;
    },

    async readPageFile(page, file) {
      if (await d.refOf(page) === null) throw bad("not_found", "no such page");
      if (!pageFileOk(file)) throw bad("bad_request", "not a file this screen opens");
      return await files.read(`${d.dirOf(page)}/${file}`);
    },

    async vaultFiles() {
      const out: VaultFile[] = [{ path: INSTRUCTIONS, seeded: false }];
      let skills: { name: string; dir: boolean }[] = [];
      try {
        skills = await files.list(VAULT_SKILLS);
      } catch {
        skills = [];
      }
      // A SKILL IS A DIRECTORY HOLDING `SKILL.md`. `_lib/` and `check.ts` sit
      // beside the skills and are the checker's — the seeder's, never a
      // person's — so a leading underscore and a bare file are not listed.
      for (const s of skills.filter((x) => x.dir && !x.name.startsWith("_")).sort(byName)) {
        if ((await files.read(`${VAULT_SKILLS}/${s.name}/SKILL.md`)) === null) continue;
        const seeded = await d.seededSkill(s.name);
        for (const p of await filesUnder(`${VAULT_SKILLS}/${s.name}`)) out.push({ path: p, seeded });
      }
      return out;
    },

    async readVaultFile(file) {
      if (!vaultFileOk(file)) throw bad("bad_request", "not a file this screen opens");
      return await files.read(file);
    },

    async writeVaultFile(file, text) {
      if (!vaultFileOk(file)) throw bad("bad_request", "not a file this screen writes");
      await files.commit(`Before ${file} was written`);
      await files.write(file, text);
    },
  };

  return runs;
}

/** The files a page's two screens may open: its instructions, and under
 *  `automations/<folder>/` the manifest, the kickoff, the instructions, and
 *  anything under `skills/` or `code/`. Nothing above the page's directory,
 *  and nothing that walks. */
export function pageFileOk(file: string): boolean {
  if (file === INSTRUCTIONS) return true;
  if (file.split("/").some((s) => s === "" || s === "." || s === "..")) return false;
  const m = /^automations\/([a-z][a-z0-9-]*)\/(.+)$/.exec(file);
  if (m === null || !FOLDER.test(m[1] ?? "")) return false;
  const rest = m[2] ?? "";
  return rest === MANIFEST || rest === KICKOFF || rest === INSTRUCTIONS ||
    rest.startsWith(`${SKILLS_DIR}/`) || rest.startsWith(`${CODE_DIR}/`);
}

/** The vault's own: `INSTRUCTIONS.md` at the root, and files under
 *  `.agents/skills/`. Never `AGENTS.md`, which is the framework's. */
export function vaultFileOk(file: string): boolean {
  if (file === INSTRUCTIONS) return true;
  if (file.split("/").some((s) => s === "" || s === "." || s === "..")) return false;
  return file.startsWith(`${VAULT_SKILLS}/`) && file.length > VAULT_SKILLS.length + 1;
}
