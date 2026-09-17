// SPDX-License-Identifier: AGPL-3.0-only
// Picking the folder, and what happens when the folder is empty.
//
// Two halves, and they are tested differently on purpose.
//
//   · `server/workspace/vault.ts` looks at the filesystem and remembers what was
//     opened. Real temp directories, because the one thing it does is read a
//     disk and a fake disk would be testing the fake.
//
//   · `makeHost` in `server/main.ts` is the REGISTRY — one set of server modules
//     per folder, kept beside each other rather than replacing each other, so
//     two tabs on two workspaces are two answers and not a race. It is exported
//     so this can be a test rather than a paragraph; running the file still
//     starts the server, because `import.meta.main` is false here.
//
// The assertions worth reading are the two that are easy to get wrong the other
// way round: opening an EMPTY folder sets it up, and opening a folder that
// already holds a workspace does not touch one byte of it.
//
// AND THE ONE THIS FILE EXISTS FOR NOW: two vaults open at once, and a write
// through one of them landing in that one and nowhere near the other. The old
// shape could not express that — there was one workspace and `open` replaced it,
// so "the other one" was a folder nothing was holding.
//
// AND ONE MORE: `makeHost` runs the vault FORMAT GATE, after `initVault` and
// before a single module that reads the vault is built. There is no converter
// and there will not be one, so the assertion is a refusal rather than a
// conversion — a legacy folder is turned away by name before anything can ask it
// a question, and nothing that could read a page is ever constructed over it.

import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { VAULT_FORMAT } from "../server/workspace/migrate.ts";
import { makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { browse, check, makeVaultMemory, seeded } from "../server/workspace/vault.ts";
import { handle } from "../server/api/routes.ts";
import { isHostRequest } from "../contracts/guards.js";
import { PROTOCOL } from "../contracts/wire.js";
import { ROOT_PAGE } from "../contracts/types.ts";
import type { ApiRequest, ApiResponse, DirListing, PageRef, VaultInfo } from "../contracts/types.ts";

const FRAMEWORK = join(import.meta.dir, "..");

let seq = 0;
const req = (o: Record<string, unknown>): ApiRequest => ({ id: `v${++seq}`, g: PROTOCOL, ...o }) as ApiRequest;

const value = (res: ApiResponse): unknown => {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.value;
};

const code = (res: ApiResponse): string => (res.ok ? "ok" : res.error.code);

/** A temp directory to put vaults in, and the memory file beside them — never
 *  the developer's own, which is why `makeHost` takes the path rather than
 *  finding it. */
async function ground() {
  const root = await mkdtemp(join(tmpdir(), "biom-open-"));
  return {
    root,
    memory: join(root, "vaults.json"),
    at: (name: string) => join(root, name),
    async drop() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** A host over one boot vault. `presets` is still on `HostPaths` and still names
 *  a directory nothing ships — the catalogue that used to fill it went with the
 *  render layer it was written against — so it is a root that is simply not
 *  there, which is the state `install` is written to survive. There is no
 *  `market` any more: the marketplace is deleted, not empty. */
const stand = (vault: string, memory: string): Promise<Host> =>
  makeHost({ vault, memory, presets: join(FRAMEWORK, "presets") });

/** One request, against one folder. Every call here names the vault it means,
 *  which is the whole change: there is no "current" one to leave out. */
const call = async (host: Host, at: string, o: Record<string, unknown>): Promise<ApiResponse> =>
  await handle(req(o), await host.deps(at));

/** A request that names NO folder — what the picker sends before anything has
 *  been chosen. */
const plain = async (host: Host, o: Record<string, unknown>): Promise<ApiResponse> =>
  await handle(req(o), await host.deps());

const pageNames = async (host: Host, at: string): Promise<string[]> =>
  ((value(await call(host, at, { kind: "page.list" })) as PageRef[]).map((p) => p.name)).sort();

/** Every file in a vault and what is in it, so "nothing was touched" is an
 *  assertion rather than a hope. `.git` is skipped because a commit's own
 *  bookkeeping moves, and the database because SQLite rewrites its header on
 *  open — neither is what a reseed would have damaged. */
async function snapshot(dir: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name.startsWith("workspace.db")) continue;
    const here = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await snapshot(dir, here));
    else out[here] = await readFile(join(dir, here), "utf8");
  }
  return out;
}

/* ── browsing ───────────────────────────────────────────────────────────── */

test("browse lists folders, marks the workspaces, and hides the machinery", async () => {
  const g = await ground();
  try {
    await mkdir(join(g.at("used"), "pages"), { recursive: true });
    await mkdir(g.at("spare"), { recursive: true });
    await mkdir(g.at(".cache"), { recursive: true });
    await writeFile(g.at("notes.txt"), "not a workspace\n");

    const listing: DirListing = await browse(g.root);
    expect(listing.at).toBe(g.root);
    // A file is never a workspace, and a dot-directory is machinery — one of
    // them is a vault's own history.
    expect(listing.dirs.map((d) => d.name)).toEqual(["spare", "used"]);
    // Marked, so the picker can show the one you have used before rather than
    // making every folder look alike.
    expect(listing.dirs.find((d) => d.name === "used")?.vault).toBe(true);
    expect(listing.dirs.find((d) => d.name === "spare")?.vault).toBe(false);
    expect(listing.dirs[0]?.path).toBe(g.at("spare"));
    expect(listing.up).toBe(dirname(g.root));

    // Somewhere there is a top, and it says so rather than looping.
    expect((await browse("/")).up).toBeNull();
  } finally {
    await g.drop();
  }
});

test("a folder that is missing, or is not a folder, is refused by name", async () => {
  const g = await ground();
  const why = async (path: unknown): Promise<string> => {
    try {
      await check(path);
      return "ok";
    } catch (e) {
      return String((e as { code?: string }).code);
    }
  };
  try {
    await writeFile(g.at("notes.txt"), "not a workspace\n");
    await mkdir(g.at("real"), { recursive: true });

    expect(await why(g.at("real"))).toBe("ok");
    expect(await why(g.at("nowhere"))).toBe("not_found");
    expect(await why(g.at("notes.txt"))).toBe("bad_request");
    expect(await why("")).toBe("bad_request");
    expect(await why(null)).toBe("bad_request");
    // A NUL truncates a path at the system call, so what was checked and what
    // would be opened are two different folders.
    expect(await why(`${g.root}\u0000/etc`)).toBe("bad_request");
  } finally {
    await g.drop();
  }
});

/* ── the memory ─────────────────────────────────────────────────────────── */

test("the recent list is most-recent-first and survives a rebuild", async () => {
  const g = await ground();
  try {
    for (const name of ["one", "two", "three"]) await mkdir(g.at(name), { recursive: true });
    const memory = makeVaultMemory(g.memory);

    expect(await memory.last()).toBeNull();
    expect(await memory.recent()).toEqual([]);

    await memory.remember(g.at("one"));
    await memory.remember(g.at("two"));
    await memory.remember(g.at("one"));

    // Opened twice is remembered once, at the top.
    expect((await memory.recent()).map((v) => v.name)).toEqual(["one", "two"]);
    expect(await memory.last()).toBe(g.at("one"));

    // A second reader over the same file — which is what a restart is.
    const again = makeVaultMemory(g.memory);
    expect((await again.recent()).map((v) => v.path)).toEqual([g.at("one"), g.at("two")]);

    // A vault that has been deleted is not listed, and is not forgotten either:
    // an unmounted volume is not the same as a folder you never opened.
    await rm(g.at("two"), { recursive: true, force: true });
    expect((await again.recent()).map((v) => v.name)).toEqual(["one"]);
    expect(JSON.parse(await readFile(g.memory, "utf8")).recent).toContain(g.at("two"));

    // Garbage in the file is a forgotten list, never a framework that will not
    // start.
    await writeFile(g.memory, "{ not json");
    expect(await makeVaultMemory(g.memory).recent()).toEqual([]);
  } finally {
    await g.drop();
  }
});

/* ── opening ────────────────────────────────────────────────────────────── */

// This is an incident, written down. An agent pointed the framework at the repo
// root; `initVault` saw a `.git` already there, declined to create one, and then
// USED IT — so twelve "Before a write to …" commits and a whole seeded vault
// landed on the project's own main branch, along with 25MB of untracked assets
// swept in by the same `add`. Nothing refused, nothing warned.
//
// The rule that stops it is not about git at all: SEED ONLY AN EMPTY FOLDER.
// A folder with anything in it that is not already a workspace is somebody's,
// and a workspace picker that writes into somebody's folder is a bug however
// good its reason. Browsing still walks through non-empty folders, because that
// is how you reach an empty one.
test("a folder that is not empty and not a workspace is refused, not adopted", async () => {
  const g = await ground();
  const host = await stand(g.at("first"), g.memory);
  try {
    const before = host.open();

    // Somebody's project: a git repo with source in it, no `pages/` anywhere.
    const theirs = g.at("their-project");
    await mkdir(join(theirs, "src"), { recursive: true });
    await mkdir(join(theirs, ".git"), { recursive: true });
    await writeFile(join(theirs, "README.md"), "# not a workspace\n");

    await expect(host.vault.open(theirs)).rejects.toThrow(/not empty/i);

    // Refused means UNTOUCHED. Not a file added, not a page, not a commit.
    expect((await readdir(theirs)).sort()).toEqual([".git", "README.md", "src"]);
    expect(existsSync(join(theirs, "pages"))).toBe(false);
    expect(existsSync(join(theirs, "workspace.db"))).toBe(false);
    expect(existsSync(join(theirs, "AGENTS.md"))).toBe(false);

    // And nothing was mounted. A refusal that left an entry in the registry
    // would be a folder the process is holding open without ever having made
    // one — and the next ask would be answered out of the cache rather than
    // re-checked, so a folder somebody then emptied would go on being refused.
    expect(host.open()).toEqual(before);

    // THROUGH THE ROUTE, because a refusal the user cannot act on is a picker
    // that looks broken. The reason survives the API layer, and the path still
    // does not: the message is a leak channel, and the caller already knows
    // what it asked for.
    const said = await plain(host, { kind: "vault.open", path: theirs });
    expect(said.ok).toBe(false);
    const why = (said as { error: { code: string; message: string } }).error;
    expect(why.code).toBe("bad_request");
    expect(why.message).toMatch(/not empty/i);
    expect(why.message).not.toContain(theirs);
    expect(why.message).not.toContain("their-project");

    // A folder holding only a dotfile is still theirs — emptiness is emptiness.
    const dotted = g.at("dotted");
    await mkdir(dotted, { recursive: true });
    await writeFile(join(dotted, ".DS_Store"), "");
    await expect(host.vault.open(dotted)).rejects.toThrow(/not empty/i);

    // But an EXISTING workspace opens, however much is in it — that is the
    // whole distinction, and it is `pages/` that draws the line.
    const second = g.at("second");
    await mkdir(second, { recursive: true });
    const opened = await host.vault.open(second);
    expect(opened.seeded).toBe(true);
    await writeFile(join(second, "stray.txt"), "written after seeding");
    expect((await host.vault.open(g.at("first"))).path).toBe(g.at("first"));
    expect((await host.vault.open(second)).path).toBe(second);
    // Both, at the same time, and the refused one still not among them.
    expect(host.open().sort()).toEqual([g.at("first"), second].sort());
  } finally {
    host.close();
    await g.drop();
  }
});

test("opening an empty folder sets it up, furniture and all", async () => {
  const g = await ground();
  const host = await stand(g.at("first"), g.memory);
  try {
    // The boot vault did not exist at all a moment ago.
    const first = value(await call(host, g.at("first"), { kind: "vault.info" })) as VaultInfo;
    expect(first.path).toBe(g.at("first"));
    expect(first.name).toBe("first");
    expect(first.seeded).toBe(true);
    // A NEW VAULT IS EMPTY. The root page and nothing else — seeding somebody's
    // folder with invented pages was noise they had to delete before starting.
    expect(await pageNames(host, g.at("first"))).toEqual(["first"]);

    // An empty folder somebody picked: same result, no environment variable
    // anywhere near it.
    await mkdir(g.at("second"), { recursive: true });
    expect(seeded(g.at("second"))).toBe(false);

    const opened: VaultInfo = await host.vault.open(g.at("second"));
    expect(opened.path).toBe(g.at("second"));
    expect(opened.seeded).toBe(true);
    expect(await pageNames(host, g.at("second"))).toEqual(["second"]);

    // The whole vault, not just its pages. THE EMPTY EMPTY-STATE HAS NO ANSWER
    // RIGHT NOW and that is stated rather than papered over: the shop used to be
    // seeded here, and the catalogue was written against the render layer, the
    // page kinds and a heterogeneous `contents` list, all three of which are
    // gone. Until it is rebuilt, the only way to fill a new vault is to ask an
    // agent — so everything below is FURNITURE, and none of it is content.
    const second = g.at("second");
    expect(existsSync(join(second, "pages", ROOT_PAGE, "content.yaml"))).toBe(true);
    expect(existsSync(join(second, "theme.json"))).toBe(true);
    expect(existsSync(join(second, ".git"))).toBe(true);

    // The furniture that makes the folder legible to an agent pointed at it.
    // None of this is content, which is why it seeds when pages do not. The
    // skills and the checker land off the mount path, so they are waited on.
    await host.settled(second);
    expect(existsSync(join(second, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(second, ".agents", "skills", "biom-pages", "SKILL.md"))).toBe(true);
    expect(existsSync(join(second, "design", "content.yaml"))).toBe(true);
    // `base/`, the starter sections, on the same two-level walk as the rest —
    // and `base/child/index.html` in particular, because `pages.create` copies
    // it into every page as `child.html`.
    expect(existsSync(join(second, "base", "child", "index.html"))).toBe(true);
    // A page directory is what `pages/` holds; none of the furniture installed
    // itself as one.
    expect(existsSync(join(second, "pages", "design"))).toBe(false);
    expect(existsSync(join(second, "pages", "child"))).toBe(false);

    // AND THE CHECKER RUNS. Copying `check.ts` alone shipped a command that
    // could not run: it reaches for the wire constants and the types, and a
    // vault has neither, so `bun run .agents/skills/check.ts` — the one command
    // AGENTS.md tells every agent to run — died on module resolution while a
    // test asserting the file existed stayed green. Assert that it RUNS.
    expect(existsSync(join(second, ".agents", "skills", "check.ts"))).toBe(true);
    for (const lib of ["wire.js", "types.ts"]) {
      expect(existsSync(join(second, ".agents", "skills", "_lib", lib))).toBe(true);
    }
    const ran = Bun.spawnSync({
      cmd: ["bun", "run", join(".agents", "skills", "check.ts"), join("pages", ROOT_PAGE)],
      cwd: second,
    });
    const said = new TextDecoder().decode(ran.stderr) + new TextDecoder().decode(ran.stdout);
    expect(said).not.toContain("Cannot find module");
    expect(said).not.toContain("error: Cannot");

    // Two vaults, two workspaces, neither aware of the other.
    expect(existsSync(join(g.at("first"), "pages", ROOT_PAGE))).toBe(true);
  } finally {
    host.close();
    await g.drop();
  }
}, 60000);

test("two vaults are open at once, and neither disturbs the other", async () => {
  const g = await ground();
  const host = await stand(g.at("work"), g.memory);
  const work = g.at("work");
  const other = g.at("other");
  try {
    // Something of the user's, so a reseed would be visible as more than a
    // timestamp. The words go INTO the page's own document — there is no `.md`
    // beside it any more — which also makes this the strongest form of the
    // assertion below: a reseed that touched `content.yaml` would take somebody's
    // prose with it.
    const made = value(await call(host, work, { kind: "page.create", init: { name: "Site intake", kind: "doc" } })) as PageRef;
    await call(host, work, {
      kind: "doc.writeRaw",
      page: made.id,
      text: "name: Site intake\nplugin: doc\nkind: doc\nrender: null\ncontents:\n  - name: body\n    type: markdown\n    data: |\n      Four questions.\n",
    });
    // The first vault's own background work — the framework's skills, the
    // plugin mirror — has to have landed before its bytes are the baseline.
    await host.settled(work);
    const before = await snapshot(work);

    await mkdir(other, { recursive: true });
    await host.vault.open(other);

    // BOTH, AT ONCE. This is the whole point of the change: the second is not a
    // replacement for the first, and the first did not go anywhere.
    expect(host.open().sort()).toEqual([other, work].sort());

    // Two workspaces, two answers, from the same process at the same time.
    expect(await pageNames(host, work)).toContain("Site intake");
    expect(await pageNames(host, other)).not.toContain("Site intake");

    // A WRITE THROUGH ONE LANDS IN THAT ONE. The old shape could not be asked
    // this, because there was only ever one folder to write to.
    await call(host, other, { kind: "page.create", init: { name: "Quote", kind: "doc" } });
    expect(await pageNames(host, other)).toContain("Quote");
    expect(await pageNames(host, work)).not.toContain("Quote");
    // And on disk, which is the assertion that survives a caching mistake.
    expect(existsSync(join(other, "pages", ROOT_PAGE, "children", "Quote", "content.yaml"))).toBe(true);
    expect(existsSync(join(work, "pages", ROOT_PAGE, "children", "Quote"))).toBe(false);

    // The first is exactly the workspace it was — same files, same bytes. Not
    // reseeded by the second being opened, and not written to by a request that
    // named the second.
    expect(await snapshot(work)).toEqual(before);

    // ASKING FOR ONE ALREADY UP IS THE SAME MOUNT, NOT A SECOND. Two database
    // handles on one file is the failure this is guarding, and the visible
    // consequence would be the workspace answering out of a stale one — so the
    // test is that it still answers, and that the registry did not grow.
    const same = await host.vault.open(work);
    expect(same.path).toBe(work);
    expect(host.open().sort()).toEqual([other, work].sort());
    expect(await pageNames(host, work)).toContain("Site intake");
    expect(await snapshot(work)).toEqual(before);

    // Both are remembered, most recent first, and the memory outlives the host.
    // `last` is now only where a tab with no folder in its url starts — it is no
    // longer a claim about which one is open, because several are.
    expect((await host.vault.recent()).map((v) => v.name)).toEqual(["other", "work"]);
    expect(await makeVaultMemory(g.memory).last()).toBe(other);
  } finally {
    host.close();
    await g.drop();
  }
}, 60000);

// Concurrency, and it is the reason the registry holds PROMISES rather than
// mounts. Two requests for the same folder arriving together must share one
// mount: two would be two database handles on one file, two seeders writing the
// same tree, and two format migrations walking it at once — which is the one
// thing migrate.ts is not safe against. The assertion is that the folder ends up
// mounted once and answering, from calls that were never allowed to queue.
test("the same folder asked for twice at once is mounted once", async () => {
  const g = await ground();
  const host = await stand(g.at("boot"), g.memory);
  const shared = g.at("shared");
  try {
    await mkdir(shared, { recursive: true });

    const many = await Promise.all([
      host.deps(shared), host.deps(shared), host.deps(shared),
      host.deps(shared), host.deps(shared), host.deps(shared),
    ]);

    expect(host.open().sort()).toEqual([g.at("boot"), shared].sort());
    // Seeded exactly once: a second seeder over the same tree would have written
    // a second root page or overwritten the first.
    expect(await pageNames(host, shared)).toEqual(["shared"]);

    // Every one of them is a working set of modules over the same folder, so a
    // row written through the last is readable through the first.
    for (const deps of many) expect((await deps.vault.info()).path).toBe(shared);
  } finally {
    host.close();
    await g.drop();
  }
}, 60000);

test("a fresh host opens the one last opened, without being told", async () => {
  const g = await ground();
  const first = await stand(g.at("alpha"), g.memory);
  try {
    await mkdir(g.at("beta"), { recursive: true });
    await first.vault.open(g.at("beta"));

    const last = await makeVaultMemory(g.memory).last();
    expect(last).toBe(g.at("beta"));
    first.close();

    // What `main.ts` does on boot when VAULT is unset: the choice made in the
    // UI is the choice on the next run.
    const next = await stand(last!, g.memory);
    // ONE, and it is that one. A fresh process holds nothing it was not asked
    // for — the registry fills up as tabs arrive, not from the recent list.
    expect(next.open()).toEqual([g.at("beta")]);
    const info = value(await call(next, g.at("beta"), { kind: "vault.info" })) as VaultInfo;
    expect(info.name).toBe("beta");
    // Already a workspace, so this run seeded nothing.
    expect(info.seeded).toBe(true);
    next.close();
  } finally {
    await g.drop();
  }
}, 60000);

/* ── the format gate, and where it sits in the list ─────────────────────── */

// A vault in an older format is REFUSED ON THE WAY IN, and the ordering is the
// whole assertion: `checkVaultFormat` runs after `initVault` — so there is a
// directory to walk — and BEFORE a single module that reads the vault is
// constructed. A workspace in an older format must never be observable, not by
// a page read, not by the seeder and not by the checker, so nothing that could
// look is built until it returns.
//
// THERE IS NO CONVERTER AND THERE WILL NOT BE ONE. This test used to assert a
// conversion, and the deletion of that converter is the change: a section IS its
// markup, and the markup lived in the render layer rather than in the vault, so
// a conversion could only flatten every page into the default section and call
// it migrated. Refusing out loud is the honest answer, and it is cheap — the old
// vault is still there, readable, and openable by an older checkout.
//
// The old format, one last time: a flat `content.yaml` with `kind:`, `render:`,
// `order:` and `parent:`, the prose in `<id>.md` beside it, and every page in
// one directory under `pages/` however deep it claimed to be.
async function legacy(at: string): Promise<void> {
  const flat = join(at, "pages");
  await mkdir(join(flat, "clients"), { recursive: true });
  await mkdir(join(flat, "ashgrove"), { recursive: true });

  await writeFile(
    join(flat, "clients", "content.yaml"),
    "name: Clients\nkind: doc\norder: [title]\nparent: null\nrender: null\ntitle.heading: Who we work for\n",
  );
  await writeFile(join(flat, "clients", "title.md"), "# Clients\n");
  await writeFile(
    join(flat, "ashgrove", "content.yaml"),
    "name: Ashgrove\nkind: doc\norder: [note]\nparent: clients\nrender: null\nnote.label: Rates\n",
  );
  await writeFile(join(flat, "ashgrove", "note.md"), "Rates went up in March.\n");
}

test("a legacy vault is refused by name, and nothing that could read it is built", async () => {
  const g = await ground();
  const old = g.at("legacy");
  await legacy(old);
  const before = await snapshot(old);

  try {
    // THE HOST COMES UP AND THE VAULT DOES NOT. `makeHost` used to REJECT here,
    // which killed the process on the way up: a stack trace on stderr, no ready
    // line, no window, and a person with an old workspace deciding the
    // application is broken. The refusal is a value now — every bad startup
    // state answers the same way — and what it produces is a first launch with
    // a sentence, which is the picker: the one screen that can open a different
    // folder or make a new one.
    const host = await stand(old, g.memory);
    expect(host.open()).toEqual([]);
    expect(host.trouble ?? "").toMatch(/vault format/i);
    host.close();

    // REFUSED MEANS UNTOUCHED. `initVault` runs first and makes the folder a git
    // repo, which is the one write ahead of the gate; everything a workspace
    // would have gained is absent, and every page is byte-for-byte what it was.
    expect(await snapshot(old)).toEqual(before);
    expect(existsSync(join(old, "pages", ROOT_PAGE))).toBe(false);
    expect(existsSync(join(old, "workspace.db"))).toBe(false);
    expect(existsSync(join(old, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(old, ".agents"))).toBe(false);
    expect(existsSync(join(old, "design"))).toBe(false);
    expect(existsSync(join(old, "theme.json"))).toBe(false);
  } finally {
    await g.drop();
  }
}, 60000);

test("a legacy folder picked in the picker is refused, and leaves no mount behind", async () => {
  const g = await ground();
  const host = await stand(g.at("current"), g.memory);
  const old = g.at("legacy");
  try {
    await legacy(old);
    const before = host.open();

    await expect(host.vault.open(old)).rejects.toThrow(/vault format/i);
    // A rejected mount must not stay in the registry: a cached rejection would
    // make every later attempt fail without ever looking at the disk again.
    expect(host.open()).toEqual(before);

    // THROUGH THE ROUTE, because a refusal the user cannot act on is a picker
    // that looks broken. `VaultFormatError` carries `bad_request`, so the API
    // answers with it rather than falling back to `internal`, and the sentence
    // says which format this server reads and which key gave the vault away.
    const said = await plain(host, { kind: "vault.open", path: old });
    expect(said.ok).toBe(false);
    const why = (said as { error: { code: string; message: string } }).error;
    expect(why.code).toBe("bad_request");
    expect(why.message).toMatch(/vault format 1/i);
    expect(why.message).toContain("format " + String(VAULT_FORMAT));
    expect(why.message).toContain("kind:");
    expect(why.message).toMatch(/no converter/i);
    // A message is a leak channel: it names the KEY, never the folder.
    expect(why.message).not.toContain(old);
    expect(why.message).not.toContain("legacy");

    // And the vault this host was already on is untouched and still answering.
    expect(await pageNames(host, g.at("current"))).toEqual(["current"]);
  } finally {
    host.close();
    await g.drop();
  }
}, 60000);

/* ── the wire ───────────────────────────────────────────────────────────── */

test("the four vault kinds are the workspace's, and an artifact cannot say them", async () => {
  const g = await ground();
  const host = await stand(g.at("wired"), g.memory);
  const wired = g.at("wired");
  try {
    const ask = (o: Record<string, unknown>) => call(host, wired, o);

    const info = value(await ask({ kind: "vault.info" })) as VaultInfo;
    expect(info.path).toBe(wired);
    expect(info.seeded).toBe(true);

    // No path: the picker starts beside the folder the request named, because
    // the next workspace is nearly always a sibling of the last one.
    const near = value(await ask({ kind: "vault.browse" })) as DirListing;
    expect(near.at).toBe(g.root);
    expect(near.dirs.find((d) => d.name === "wired")?.vault).toBe(true);

    const there = value(await ask({ kind: "vault.browse", path: g.root })) as DirListing;
    expect(there.at).toBe(g.root);

    await mkdir(g.at("elsewhere"), { recursive: true });
    const opened = value(await ask({ kind: "vault.open", path: g.at("elsewhere") })) as VaultInfo;
    expect(opened.name).toBe("elsewhere");

    // AND THE ONE THIS REPLACES: opening did not move the folder this request is
    // about. `vault.info` answers for the vault the REQUEST named, not for the
    // last one anybody opened — which is the whole reason a second tab is safe.
    expect((value(await ask({ kind: "vault.info" })) as VaultInfo).path).toBe(wired);
    expect((value(await call(host, g.at("elsewhere"), { kind: "vault.info" })) as VaultInfo).path)
      .toBe(g.at("elsewhere"));

    const recent = value(await ask({ kind: "vault.recent" })) as VaultInfo[];
    expect(recent.map((v) => v.name)).toEqual(["elsewhere", "wired"]);

    // The guards, not the guesses.
    expect(code(await ask({ kind: "vault.open", path: g.at("nowhere") }))).toBe("not_found");
    expect(code(await ask({ kind: "vault.open", path: join(wired, "theme.json") }))).toBe("bad_request");
    expect(code(await ask({ kind: "vault.open" }))).toBe("bad_request");
    expect(code(await ask({ kind: "vault.browse", path: g.at("nowhere") }))).toBe("not_found");

    // A message is a leak channel, and these carry paths more than most.
    const missing = await ask({ kind: "vault.open", path: g.at("nowhere") });
    if (!missing.ok) expect(missing.error.message).not.toContain(g.root);

    // A REQUEST THAT NAMES NO FOLDER. Three of the four still answer, because
    // they are about vaults rather than in one — that is what makes the picker
    // reachable on a first run, before anything has been chosen.
    expect(code(await plain(host, { kind: "vault.recent" }))).toBe("ok");
    expect(code(await plain(host, { kind: "vault.browse", path: g.root }))).toBe("ok");
    expect(code(await plain(host, { kind: "vault.open", path: wired }))).toBe("ok");
    // `vault.info` is not among them: "which folder is this" has no answer when
    // the request did not say, and the most recent one is somebody else's tab.
    expect(code(await plain(host, { kind: "vault.info" }))).toBe("bad_request");
    // And nothing that reads or writes a workspace is answered without one.
    expect(code(await plain(host, { kind: "page.list" }))).toBe("bad_request");
    expect(code(await plain(host, { kind: "table.list" }))).toBe("bad_request");
    expect(code(await plain(host, { kind: "theme.get" }))).toBe("bad_request");

    // THE CHOKEPOINT, and it is the type rather than a check: `HostRequest` does
    // not carry these kinds, so the bridge refuses them without an allow-list
    // anywhere. Every one of them NAMES A FOLDER that is not the one the request
    // was addressed to, and with several open an artifact has no business
    // naming one.
    for (const kind of ["vault.browse", "vault.open", "vault.create", "vault.recent"]) {
      expect(isHostRequest({ id: "a", g: PROTOCOL, kind, path: "/" })).toBe(false);
    }
    // `vault.info` IS sayable from a page, and the two facts belong together. It
    // names no folder — it asks about the one already in the url — so a page can
    // say where it lives and cannot reach past it. That it is refused above with
    // no vault named is the same rule facing the other way: *which folder is
    // this* has no answer when the request did not say.
    expect(isHostRequest({ id: "a", g: PROTOCOL, kind: "vault.info" })).toBe(true);
    expect(isHostRequest({ id: "a", g: PROTOCOL, kind: "theme.get" })).toBe(true);
  } finally {
    host.close();
    await g.drop();
  }
}, 60000);

/* ── making one ─────────────────────────────────────────────────────────── */

// THE BARRIER'S OWN KIND, END TO END. `creatable` and `createVault` were built
// and tested before there was a wire kind to reach them by — the button was off
// and the picker said why — so what these two cover is the half that was
// missing: the route, the composition root's `create`, and the fact that what
// comes back is a MOUNTED vault rather than a path that was made.
test("vault.create makes the folder, seeds it and answers a mounted vault", async () => {
  const g = await ground();
  const host = await stand(g.at("first"), g.memory);
  try {
    const before = host.open();
    const made = value(
      await plain(host, { kind: "vault.create", parent: g.root, name: "notes" }),
    ) as VaultInfo;

    // The folder it said it made is the folder it made, under the parent it was
    // given and nowhere else.
    expect(made.path).toBe(g.at("notes"));
    expect(made.name).toBe("notes");
    // SEEDED, NOT MERELY CREATED. It goes through the same `acquire` an empty
    // folder goes through when somebody opens one, which is what makes a created
    // workspace indistinguishable from a chosen one.
    expect(made.seeded).toBe(true);
    expect(seeded(g.at("notes"))).toBe(true);
    expect(existsSync(join(g.at("notes"), "AGENTS.md"))).toBe(true);

    // And it is MOUNTED. A create that left the caller to open it afterwards
    // would be two round trips and a window in which the folder is a workspace
    // nothing is holding.
    expect(host.open()).toContain(g.at("notes"));
    expect(host.open().length).toBe(before.length + 1);

    // It reads as a workspace through the route it was made by, and its one page
    // is the root — named for the folder, which is where a new vault's root page
    // takes its name from.
    expect(await pageNames(host, made.path)).toEqual(["notes"]);
  } finally {
    await g.drop();
  }
});

// THE PARENT AND THE NAME STAY APART, which is the whole reason the kind carries
// two fields. Handed one joined string a name with a separator in it would land
// a workspace somewhere nobody chose; kept apart, the name has to satisfy the
// name rule and cannot become a path.
test("a name that is a path is refused, and nothing is made", async () => {
  const g = await ground();
  const host = await stand(g.at("first"), g.memory);
  try {
    for (const name of ["deep/notes", "..", "../escaped", "/absolute"]) {
      const said = await plain(host, { kind: "vault.create", parent: g.root, name });
      expect(said.ok).toBe(false);
      // The domain's own sentence, and never the path — the same rule every
      // other refusal on this screen follows.
      const why = (said as { error: { code: string; message: string } }).error;
      expect(why.code).toBe("bad_request");
      expect(why.message).not.toContain(g.root);
    }
    expect(existsSync(join(g.root, "deep"))).toBe(false);
    expect(existsSync(join(g.root, "escaped"))).toBe(false);
  } finally {
    await g.drop();
  }
});

// A WORKSPACE CANNOT HOLD ANOTHER ONE, checked through the route rather than
// only in the domain: the ancestor walk is what stops two databases, two mirrors
// and two git repositories over one set of files.
test("creating inside an open workspace is refused", async () => {
  const g = await ground();
  const host = await stand(g.at("first"), g.memory);
  try {
    const said = await plain(host, { kind: "vault.create", parent: g.at("first"), name: "inner" });
    expect(said.ok).toBe(false);
    expect(existsSync(join(g.at("first"), "inner"))).toBe(false);
  } finally {
    await g.drop();
  }
});

/* ── whether undo exists ────────────────────────────────────────────────── */

// `VaultInfo.history` IS THE ONE FACT THE UI USED TO GUESS. The status strip and
// the History panel both said versions were being kept, unconditionally, on a
// machine that might have no git at all. This is the wire half of that: the
// field is there, and it is read off disk rather than remembered from the mount.
test("vault.info carries whether the folder is keeping versions", async () => {
  const g = await ground();
  const host = await stand(g.at("first"), g.memory);
  try {
    const info = value(await call(host, g.at("first"), { kind: "vault.info" })) as VaultInfo;
    // Whatever this machine has, the answer is the `.git` that is actually there
    // — the same thing `commit()` and `initVault()` turn on.
    expect(typeof info.history).toBe("boolean");
    expect(info.history).toBe(existsSync(join(g.at("first"), ".git")));

    // AND IT CAN GO FALSE UNDER A LIVE VAULT, which is why it is read rather
    // than cached: a folder whose repository is removed is a folder with no undo
    // from that moment, and the next read has to say so.
    await rm(join(g.at("first"), ".git"), { recursive: true, force: true });
    const after = value(await call(host, g.at("first"), { kind: "vault.info" })) as VaultInfo;
    expect(after.history).toBe(false);
  } finally {
    await g.drop();
  }
});
