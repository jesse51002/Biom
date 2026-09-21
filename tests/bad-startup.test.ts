// SPDX-License-Identifier: AGPL-3.0-only
// EVERY WAY STARTING UP CAN GO WRONG, and what each one does instead of dying.
//
// The owner's decision, on 2026-09-14, in their words: *"opening an old vault
// shouldn't be a crash; we should be a lot more fault tolerant than this."*
//
// The application trusted whatever it remembered. Measured against a real
// `server/main.ts`, that produced three dead processes and two silent writes:
//
//   · a remembered vault that had become a FILE      →  EEXIST out of `mkdir`,
//     exit 1, a stack trace, no window
//   · a remembered vault whose folder could not be READ  →  SQLITE_CANTOPEN,
//     the same
//   · a `workspace.db` that was not a database       →  SQLITE_NOTADB, the same
//   · a remembered vault that had been DELETED       →  recreated by
//     `initVault`'s `mkdir -p` and seeded from scratch, so the program opened an
//     empty workspace wearing the name of the one the person had lost
//   · a remembered vault on a volume that was not mounted  →  its whole missing
//     path created inside the empty mount point, and seeded there
//
// WHAT REPLACES ALL FIVE IS ONE SHAPE. Nothing is mounted, one plain sentence
// says what was wrong, and the picker is what opens — the only screen that can
// open a different folder or make a new one. Three pieces do it, and this file
// is about those three:
//
//   · `usable` in `server/workspace/vault.ts` — the ONE place a folder is
//     validated before it is mounted, by everything that mounts.
//   · `bootVault` beside it — the ONE place a bad REMEMBERED entry is decided,
//     and the asymmetry it holds: `VAULT=` is trusted because somebody typed it
//     on this launch, a remembered path is checked because it is a claim about
//     the past and the past goes stale.
//   · `Host.trouble` in `server/main.ts` — the boot mount is guarded, so a
//     failure nobody has thought of yet is still a sentence and a picker.
//
// Fixtures are invented and say so.

import { test, expect } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { makeHost } from "../server/main.ts";
import { makeDb } from "../server/platform/db.ts";
import { makeTables } from "../server/domain/tables.ts";
import {
  bootVault,
  makeVaultMemory,
  mountable,
  openable,
  usable,
} from "../server/workspace/vault.ts";

const HERE = join(import.meta.dir, "..");

/** A throwaway directory, and the whole of it goes afterwards. */
async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "biom-bad-startup-"));
}

/** A host with every seed root the real composition root uses, and its
 *  remembered list inside the scratch directory — so no test here ever writes
 *  the developer's own. */
async function hostAt(root: string, vault?: string) {
  return await makeHost({
    vault,
    memory: join(root, "vaults.json"),
    presets: join(HERE, "presets"),
    vaultSeed: join(HERE, "vault"),
    skill: join(HERE, "skill"),
    checkerLib: HERE,
  });
}

/** A folder that looks enough like a workspace to be mounted: `pages/` with a
 *  root page in it. Written by hand rather than seeded, because what is under
 *  test is the gate in front of the seeder. */
async function workspaceAt(at: string): Promise<string> {
  await mkdir(join(at, "pages", "home"), { recursive: true });
  await writeFile(join(at, "pages", "home", "content.yaml"), "name: Home\nplugin: biom-doc\ncontents: []\n");
  return at;
}

/** Whether this process can be stopped by a permission bit at all. Root ignores
 *  them, and so does Windows for a directory's write bit, so the two tests that
 *  turn on an unreadable folder skip themselves BY NAME rather than passing
 *  vacuously or failing on somebody's CI. */
const PERMISSIONS_BITE = process.platform !== "win32" && process.getuid?.() !== 0;

const message = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
};

/* ══ one place a folder is validated before it is mounted ════════════════ */

test("a folder that is not there, and one that is a file, are two different sentences", async () => {
  const root = await scratch();
  try {
    await writeFile(join(root, "notes.txt"), "a file where a workspace used to be");

    // THE FOLDER IS GONE. It is the commonest of these by far — a workspace
    // moved, renamed, or on a drive that is not plugged in this morning.
    expect(await message(() => usable(join(root, "missing")))).toBe("there is no folder there");

    // AND A FILE IS NOT A FOLDER, which used to be `mkdir` throwing EEXIST out
    // of the composition root and taking the process with it.
    expect(await message(() => usable(join(root, "notes.txt")))).toBe("that is a file, not a folder");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.if(PERMISSIONS_BITE)("a folder that cannot be written to is refused before anything tries", async () => {
  const root = await scratch();
  const locked = join(root, "read-only");
  try {
    await workspaceAt(locked);
    await chmod(locked, 0o500);

    // A WORKSPACE KEEPS EVERYTHING INSIDE ITSELF — the pages, the git history,
    // the database, the markdown mirror — so a folder it cannot write is not a
    // workspace it can serve. Unguarded, this reached `makeDb`, which CREATES
    // the database file, and came out as SQLITE_CANTOPEN with a stack trace.
    expect(await message(() => mountable(locked))).toContain("cannot be written to");
  } finally {
    await chmod(locked, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("a workspace.db that is not a database is refused, and is not touched", async () => {
  const root = await scratch();
  try {
    const at = await workspaceAt(join(root, "ws"));
    const db = join(at, "workspace.db");
    const rubbish = "this is not a sqlite file at all, not even close";
    await writeFile(db, rubbish);

    const why = await message(() => mountable(at));
    expect(why).toContain("not a database");
    // AND IT SAYS WHAT TO DO. A refusal that names no act is a person deciding
    // the program is broken; the way back is moving the file aside, because the
    // rows are the only thing in a vault that is not in git.
    expect(why).toContain("move it aside");

    // NOTHING WAS WRITTEN, TRIED OR REPAIRED. It holds somebody's rows, and a
    // framework that moved it aside itself to get started would be the one
    // outcome worse than refusing.
    expect(readFileSync(db, "utf8")).toBe(rubbish);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an absent database, an empty one and a real one all pass", async () => {
  const root = await scratch();
  try {
    // ABSENT is the ordinary state of a folder that has never been opened.
    const fresh = await workspaceAt(join(root, "fresh"));
    expect(await mountable(fresh)).toBe(fresh);

    // EMPTY is what a crash between `open` and the first statement leaves, and
    // SQLite reads a zero-length file as a new database — so this must not be
    // read as damage.
    const empty = await workspaceAt(join(root, "empty"));
    await writeFile(join(empty, "workspace.db"), "");
    expect(await mountable(empty)).toBe(empty);

    // AND A REAL ONE, made the way the server makes it, so the header check is
    // asserted against the thing it will actually meet rather than against a
    // constant this test also wrote.
    const real = await workspaceAt(join(root, "real"));
    const db = makeDb(join(real, "workspace.db"));
    makeTables(db);
    db.close();
    expect(await mountable(real)).toBe(real);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a folder inside a workspace says which workspace, rather than that it is not empty", async () => {
  const root = await scratch();
  try {
    const vault = await workspaceAt(join(root, "Work"));
    const inside = join(vault, "pages", "home", "children", "Notes");
    await mkdir(inside, { recursive: true });
    await writeFile(join(inside, "content.yaml"), "name: Notes\nplugin: biom-doc\ncontents: []\n");

    // IT WAS TRUE AND USELESS. `<vault>/pages/home/children/Notes` is not empty,
    // so the refusal was "pick an empty one, or one that already holds a
    // workspace" — which invites somebody who has opened their own page tree to
    // go and make a SECOND workspace inside the first, and that is two
    // databases, two mirrors and two git repositories over one set of files.
    const why = await message(() => openable(inside));
    expect(why).toContain("inside the workspace at");
    // The ancestor by name, which is the one exception to this module's rule
    // that a message carries no path: the whole point of the walk is that the
    // workspace it found is somewhere the person did not look.
    expect(why).toContain(vault);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ one place a bad remembered entry is decided ═════════════════════════ */

test("a remembered vault that was deleted is not recreated — it is a sentence and no mount", async () => {
  const root = await scratch();
  try {
    const gone = join(root, "folders", "Gone");

    const choice = await bootVault(undefined, gone);
    expect(choice.path).toBe(null);
    expect(choice.why).toBe("the workspace you had open did not open — there is no folder there");

    // THE WHOLE OF THE BUG, AS ONE ASSERTION. `initVault` creates the directory
    // it is handed — recursively — so the old path mounted it into existence
    // and the seeder filled it, and what opened was an empty workspace with the
    // lost one's name on it. Nothing was said, and there was nothing on screen
    // to tell the two apart.
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(join(root, "folders"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("VAULT= is trusted and a remembered path is checked, and that asymmetry is the rule", async () => {
  const root = await scratch();
  try {
    const named = join(root, "TypedThisLaunch");

    // TYPED ON THIS LAUNCH. A folder that is not there yet is a folder somebody
    // is asking for — the ordinary headless first run — so it comes back to be
    // created, unchecked, exactly as it always did.
    expect((await bootVault(named, null)).path).toBe(named);
    // And it wins over anything remembered, which is what `VAULT=` has always
    // meant.
    const good = await workspaceAt(join(root, "Remembered"));
    expect((await bootVault(named, good)).path).toBe(named);

    // REMEMBERED AND STILL A WORKSPACE opens, which is every launch after the
    // first.
    expect(await bootVault(undefined, good)).toEqual({ path: good, why: null });

    // Blank is not a name. `VAULT=` set to nothing at all is an unset variable
    // with a typo in the build script, not a request for a folder called "".
    expect((await bootVault("   ", good)).path).toBe(good);
    expect(await bootVault(undefined, null)).toEqual({ path: null, why: null });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a remembered folder that is still there and no longer a workspace is not re-seeded", async () => {
  const root = await scratch();
  try {
    // Somebody emptied it, or moved their pages out of it. It is a folder that
    // belongs to them, and this program deciding on its own that an emptied
    // folder wants a fresh workspace in it is the same act as recreating a
    // deleted one.
    const emptied = join(root, "Emptied");
    await mkdir(emptied, { recursive: true });

    const choice = await bootVault(undefined, emptied);
    expect(choice.path).toBe(null);
    expect(choice.why).toContain("no longer holds one");
    expect(existsSync(join(emptied, "pages"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ the boot mount is guarded, whatever goes wrong inside it ════════════ */

test("a boot vault that is a file is a sentence and a first launch, not a dead process", async () => {
  const root = await scratch();
  try {
    const file = join(root, "AFile");
    await writeFile(file, "not a folder");

    // IT USED TO REJECT. `makeHost`'s boot mount was an unguarded `await` in a
    // top-level await, so the exception ended the process: exit 1, a stack
    // trace, no ready line for the shell to read, and an application that
    // appeared not to start.
    const host = await hostAt(root, file);
    expect(host.open()).toEqual([]);
    expect(host.trouble).toBe("that is a file, not a folder");
    host.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a boot vault whose database is not a database is a sentence, and the file is left alone", async () => {
  const root = await scratch();
  try {
    const at = await workspaceAt(join(root, "ws"));
    const rubbish = "this is not a sqlite file at all";
    await writeFile(join(at, "workspace.db"), rubbish);

    const host = await hostAt(root, at);
    expect(host.open()).toEqual([]);
    expect(host.trouble ?? "").toContain("not a database");
    host.close();

    expect(readFileSync(join(at, "workspace.db"), "utf8")).toBe(rubbish);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a database written by a newer build refuses rather than being migrated in place", async () => {
  const root = await scratch();
  try {
    const at = await workspaceAt(join(root, "ws"));
    const file = join(root, "ws", "workspace.db");
    // A REAL DATABASE, made by this build and then stamped ahead of it. That is
    // the honest shape of "written by a newer Biom": the file opens, the tables
    // are there, and the schema is not one this build has ever seen.
    {
      const db = makeDb(file);
      makeTables(db);
      db.run(`UPDATE _meta SET value = '99' WHERE key = 'format'`);
      db.close();
    }

    const host = await hostAt(root, at);
    expect(host.open()).toEqual([]);
    expect(host.trouble ?? "").toContain("written by a newer Biom");
    host.close();

    // NOTHING BELOW THE GATE RAN. `makeTables` widens `_tables` in place and
    // reconciles the registry against what is physically there — a guess acting
    // on somebody's rows, against a schema this build cannot read.
    {
      const db = makeDb(file);
      expect(db.all<{ value: string }>(`SELECT value FROM _meta WHERE key = 'format'`)[0]?.value).toBe("99");
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a workspace made by an older build gains what it lacks and keeps what it has", async () => {
  const root = await scratch();
  try {
    // A VAULT FROM BEFORE ANY OF THE FURNITURE EXISTED: pages and nothing else.
    // No `docs/`, no `.agents/`, no `design/`, no theme. It gains all of those;
    // it does NOT gain a `plugins/`, because the framework's plugins are the
    // rung under the vault's rather than a copy inside it.
    const at = await workspaceAt(join(root, "OldBuild"));
    const rootDoc = join(at, "pages", "home", "content.yaml");
    const asWritten = readFileSync(rootDoc, "utf8");

    const host = await hostAt(root, at);
    expect(host.open()).toEqual([at]);
    await host.settled(at);
    host.close();

    for (const gained of ["docs", ".agents", "design", "base", "theme.json", "AGENTS.md"]) {
      expect([gained, existsSync(join(at, gained))]).toEqual([gained, true]);
    }
    expect(existsSync(join(at, "plugins"))).toBe(false);
    // AND THE PAGE IS WHAT IT WAS, PLUS ITS IDENTITY. Every write the seeder
    // makes is additive file by file: an old workspace gains a skill or a
    // plugin on the next start, and anything edited stays edited. The ONE line
    // a mount writes into a page is `uid:` under `name:`, once, for a page that
    // has none — a page made before identities existed gains one the first
    // time this build opens the folder, and nothing else in the file moves.
    const after = readFileSync(rootDoc, "utf8");
    expect(after).not.toBe(asWritten);
    const lines = after.split("\n");
    const uidAt = lines.findIndex((l) => l.startsWith("uid: "));
    expect(uidAt).toBe(1);
    expect(lines[uidAt]).toMatch(/^uid: [a-z0-9]{16}$/);
    expect([...lines.slice(0, uidAt), ...lines.slice(uidAt + 1)].join("\n")).toBe(asWritten);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ the remembered list itself ══════════════════════════════════════════ */

test("a remembered list that is empty, truncated or not json is a forgotten list", async () => {
  const root = await scratch();
  try {
    const cases: [string, string][] = [
      // The first half of every write-then-flush, and what a crash in the middle
      // of one leaves behind.
      ["empty", ""],
      ["truncated", '{\n  "recent": [\n    "/some/pa'],
      ["garbage", "{{{ not json"],
      // It parses and says nothing this reader understands, which is a list of
      // no vaults rather than a failure.
      ["wrong shape", '{"recent": "not a list"}'],
      ["not an object", "[1, 2, 3]"],
    ];
    for (const [name, text] of cases) {
      const file = join(root, `${name}.json`);
      await writeFile(file, text);
      const memory = makeVaultMemory(file);
      expect([name, await memory.last()]).toEqual([name, null]);
      expect([name, await memory.recent()]).toEqual([name, []]);
      // READING DOES NOT REWRITE. Whatever somebody was in the middle of is
      // still on disk; the next `remember` is what replaces it.
      expect([name, readFileSync(file, "utf8")]).toEqual([name, text]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a list that cannot be written is a choice that is not remembered, and nothing else", async () => {
  const root = await scratch();
  try {
    // THE DATA DIRECTORY IS NOT A WORKSPACE AND CANNOT STOP ONE OPENING. It
    // holds the answer to "where were we", which is a convenience — failing to
    // remember which folder you opened must never be what stops you opening it.
    // A FILE where the directory should be is the cheapest way to make `mkdir`
    // and `writeFile` both fail for a reason nobody can do anything about.
    await writeFile(join(root, "in-the-way"), "not a directory");
    const memory = makeVaultMemory(join(root, "in-the-way", "biom", "vaults.json"));
    await memory.remember(join(root, "somewhere"));
    expect(await memory.last()).toBe(null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ and the picker still works in the tab that needs it ═════════════════ */

test("a folder that will not mount still answers the kinds that are about vaults", async () => {
  const root = await scratch();
  try {
    const file = join(root, "AFile");
    await writeFile(file, "not a folder");
    const host = await hostAt(root);

    // IT USED TO REJECT, and the route turned that into a refusal of everything
    // the tab asked for. A window addressed at a workspace that would not open
    // drew the picker and then watched the picker's own three reads fail down
    // the same vault-prefixed route — so the one screen that exists to fix the
    // problem could not list a folder or offer a recent one, and the reason was
    // printed twice over an empty chooser.
    const deps = await host.deps(file);

    // THE FOUR KINDS THAT NEVER NEEDED THE MOUNT. They are about vaults rather
    // than in one, which is exactly what the unprefixed route already says.
    expect(await deps.vault.recent()).toEqual([]);
    expect((await deps.vault.browse(root)).at).toBe(root);

    // AND *WHICH FOLDER IS THIS* HAS NO ANSWER, because nothing is open — the
    // picker reads that as "None" rather than as a workspace it could offer.
    expect(await message(() => deps.vault.info())).toBe("this request names no workspace");

    // EVERYTHING THAT DOES NEED THE FOLDER REFUSES WITH THE MOUNT'S OWN
    // SENTENCE, so whichever call a screen makes first it gets the same words.
    expect(await message(() => deps.pages.list())).toBe("that is a file, not a folder");
    expect(await message(() => deps.theme.get())).toBe("that is a file, not a folder");

    // And nothing was mounted on the way through.
    expect(host.open()).toEqual([]);
    host.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ══ what a vault can lose and get back ══════════════════════════════════ */

test("a plugins/doc/ of the vault's own is kept across opens, is the vault's and never the framework's, and goes when removed", async () => {
  const root = await scratch();
  try {
    const at = join(root, "ws");
    (await hostAt(root, at)).close();
    const doc = join(at, "plugins", "doc", "index.html");
    // NOTHING IS IN `plugins/` UNTIL THE PERSON PUTS SOMETHING THERE. The
    // framework's own `biom-doc` draws every doc page in this workspace from
    // its own root, and the copy to read is in `docs/plugins/`.
    expect(existsSync(doc)).toBe(false);

    // A FOLDER UNDER A BARE NAME IS A PLUGIN OF THE VAULT'S OWN — `doc` here
    // has nothing to do with `biom-doc` — and it is the person's: never
    // written over, whatever the framework does next.
    const theirs = "<!doctype html><p>mine</p>";
    await mkdir(dirname(doc), { recursive: true });
    await writeFile(doc, theirs);
    const held = await hostAt(root, at);
    await held.settled(at);
    held.close();
    expect(readFileSync(doc, "utf8")).toBe(theirs);

    // AND THE OTHER HALF: deleting it is how you go back. There is no seeder to
    // write it again, so the framework's own draws on the next open.
    await rm(doc);
    const after = await hostAt(root, at);
    await after.settled(at);
    try {
      expect(existsSync(doc)).toBe(false);
      const deps = await after.deps(at);
      expect((await deps.pages.read("home"))!.html).not.toContain("Nothing draws this page");
      expect((await deps.pages.read("home"))!.html).not.toContain("mine");
    } finally {
      after.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a root page whose document is gone is written again, and the workspace opens", async () => {
  const root = await scratch();
  try {
    const at = join(root, "ws");
    (await hostAt(root, at)).close();
    const rootDoc = join(at, "pages", "home", "content.yaml");

    // THE ROOT IS NOT SEEDED, IT IS GUARANTEED. The top level is its children,
    // so it has to exist before anything can ask what is at the top — and a
    // workspace whose root document has gone would otherwise open on a tree with
    // no top and no way back to one.
    await rm(rootDoc);
    const host = await hostAt(root, at);
    expect(host.trouble).toBe(null);
    expect(host.open()).toEqual([at]);
    host.close();
    expect(existsSync(rootDoc)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
