// SPDX-License-Identifier: AGPL-3.0-only
// THE FRAMEWORK RUNS FROM ANYWHERE, and these are the three facts that make
// that sentence true rather than hopeful.
//
//   · It writes nothing beside its own files. The default vault and the
//     remembered list both live in this machine's data directory, because a
//     program in `/Applications` cannot write next to itself — and one that can
//     has just seeded a workspace into the middle of somebody's source tree.
//     This framework did exactly that to its own repository.
//   · Its paths are PATHS. `.pathname` off a `file:` URL is percent-encoded and,
//     on Windows, prefixed with a slash — so an install under `/My Documents/`
//     served nothing at all, silently, and every read missed.
//   · A machine with no git still gets a working workspace. Pages read and
//     write, the mirror is rebuilt, the vault gets its `.gitignore`; the only
//     thing missing is undo, and saying so is the UI's job rather than a
//     refusal's.
//
// The no-git run shadows PATH rather than injecting a failing runner, because
// `spawn("git", …)` with no shell is exactly what resolves through PATH — so a
// PATH holding one empty directory reproduces the real machine rather than a
// model of it.

import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import { makeHost, under } from "../server/main.ts";
import { hasHistory } from "../server/platform/files.ts";
import { dataHome, defaultVault, insideDataHome, memoryFile } from "../server/workspace/vault.ts";
import { VAULT_PREFIX, vaultOf } from "../contracts/wire.js";

const HERE = join(import.meta.dir, "..");

/* ── nothing is written beside the install ──────────────────────────────── */

test("the two written paths are in this machine's data directory, not beside the framework", () => {
  const home = dataHome();
  expect(isAbsolute(home)).toBe(true);
  // The whole point: neither path is under the checkout. A relative comparison
  // would pass on a machine where the framework happened to live in $HOME, so
  // this is the resolved install directory against the resolved data one.
  expect(home.startsWith(resolve(HERE) + sep)).toBe(false);

  for (const path of [defaultVault(), memoryFile()]) {
    expect([path, path.startsWith(resolve(home) + sep)]).toEqual([path, true]);
    expect([path, path.startsWith(resolve(HERE) + sep)]).toEqual([path, false]);
  }
});

test("only a folder strictly inside the data directory may be dropped", () => {
  // `fresh` used to be `rm -rf $(VAULT)` with VAULT defaulting to this repo's
  // own workspace. These are the two answers that stop that being possible.
  expect(insideDataHome(defaultVault())).toBe(true);
  expect(insideDataHome(join(HERE, "..", "workspace"))).toBe(false);
  expect(insideDataHome(HERE)).toBe(false);
  // The data directory ITSELF is not deletable: it holds the remembered list,
  // and dropping one vault is not forgetting every vault.
  expect(insideDataHome(dataHome())).toBe(false);
  // `..` does not buy a way out, because both sides are resolved first.
  expect(insideDataHome(join(defaultVault(), "..", "..", "..", "elsewhere"))).toBe(false);
});

/** The environment a `fresh` run is given: a data directory planted inside
 *  `root` rather than this machine's own. Every variable `dataHome()` can read
 *  is set, because which one it reads is the platform's answer and a test that
 *  set only the Linux one would pass on macOS by not running. */
function freshEnv(root: string): Record<string, string> {
  const home = join(root, "home");
  return {
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: join(home, ".local", "share"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
  };
}

/** What `dataHome()` answers under that environment. Asked of the function the
 *  command itself uses rather than rebuilt here, so a change to the platform
 *  rules moves the test with it. */
function dataHomeUnder(root: string): string {
  const before = { ...process.env };
  try {
    Object.assign(process.env, freshEnv(root));
    return dataHome();
  } finally {
    for (const key of Object.keys(freshEnv(root))) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

/** Run `tools/fresh.ts` the way the Makefile does — a real process, because the
 *  refusal is an exit code and a module import has none. */
function runFresh(root: string, target: string | null) {
  const args = ["bun", "run", join(HERE, "tools", "fresh.ts")];
  if (target !== null) args.push(target);
  const ran = Bun.spawnSync(args, {
    env: { ...process.env, ...freshEnv(root) },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: ran.exitCode, said: ran.stdout.toString() + ran.stderr.toString() };
}

test("fresh drops a vault inside the data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-fresh-"));
  try {
    const vault = join(dataHomeUnder(root), "workspace");
    await mkdir(join(vault, "pages"), { recursive: true });
    await writeFile(join(vault, "pages", "keep.yaml"), "name: keep\n", "utf8");

    // No argument at all is the ordinary `make fresh`: the default vault, which
    // is inside the data directory and is therefore this framework's to delete.
    const ran = runFresh(root, null);
    expect([ran.said, ran.code]).toEqual([ran.said, 0]);
    expect(existsSync(vault)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

test("fresh refuses a vault outside the data directory, by name and non-zero", async () => {
  // THE ONE THIS COMMAND EXISTS FOR. `fresh` was `rm -rf $(VAULT)` with VAULT
  // defaulting to a workspace beside the checkout, so the command whose help
  // line promises a throwaway folder deleted every page and every board in a
  // real one. `insideDataHome` is unit-tested above; this is the entry point
  // around it, which is the half that does the deleting.
  const root = await mkdtemp(join(tmpdir(), "biom-fresh-"));
  try {
    const mine = join(root, "somebody else's work");
    await mkdir(join(mine, "pages"), { recursive: true });
    await writeFile(join(mine, "pages", "keep.yaml"), "name: keep\n", "utf8");

    const ran = runFresh(root, mine);
    expect([ran.said, ran.code]).not.toEqual([ran.said, 0]);
    // It says WHICH path it refused, because "fresh refuses" with no path is a
    // message you cannot act on.
    expect(ran.said).toContain(mine);
    // And nothing went.
    expect(existsSync(join(mine, "pages", "keep.yaml"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

/* ── the paths are paths ────────────────────────────────────────────────── */

test("a served path is resolved and compared as a path, spaces and all", () => {
  const base = "/home/a person/Biom Framework/client";

  // A SPACE. Built as a URL this came back `/home/a%20person/…` and matched no
  // file on disk — the client, the guest modules and the vendored scripts all
  // failed to load, on any machine whose install path had a space in it.
  expect(under(base, "boot.js")).toBe(join(base, "boot.js"));
  expect(under(base, "/boot.js")).toBe(join(base, "boot.js"));
  expect(under(base, "views/page.js")).toBe(join(base, "views", "page.js"));

  // A `#` OR A `?` ANYWHERE IN THE INSTALL PATH truncated the base at that
  // character, so the comparison passed against a prefix of the wrong folder.
  const hashed = "/home/a#person/biom?v2/client";
  expect(under(hashed, "boot.js")).toBe(join(hashed, "boot.js"));

  // `..` is the whole of the attack, and it is refused rather than clamped.
  expect(under(base, "../../etc/passwd")).toBe(null);
  expect(under(base, "views/../../secrets.txt")).toBe(null);

  // A SIBLING WHOSE NAME STARTS WITH THE ROOT'S is outside it. A plain
  // `startsWith` on the string would have served `/…/clientele/x`.
  expect(under("/srv/client", "../clientele/x")).toBe(null);

  // The root itself resolves to the root, which is a directory and 404s above.
  expect(under(base, "")).toBe(resolve(base));
});

/* ── the Makefile survives a checkout path with a space in it ───────────── */

/** Is the character at `at` inside a double-quoted run of this shell line? An
 *  odd number of unescaped `"` before it means yes, which is the whole rule —
 *  and it is why `echo "… $(HERE).run/server.log"` passes while a bare
 *  `bun run $(HERE)server/main.ts` does not. */
function quoted(line: string, at: number): boolean {
  let open = false;
  for (let i = 0; i < at; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === '"') open = !open;
  }
  return open;
}

test("every path the framework Makefile hands to a shell is quoted", async () => {
  // A CHECKOUT WITH A SPACE IN ITS PATH IS AN ENTIRELY ORDINARY THING TO HAVE,
  // and an unquoted `$(HERE)` splits it into two arguments — so `make dev` in
  // `/home/a person/Biom` ran `bun run /home/a` and never started. Every recipe
  // line is checked rather than the ones that were wrong, because the next one
  // written is the one that will be wrong.
  const text = await readFile(join(HERE, "Makefile"), "utf8");
  const bad: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("\t")) continue; // a recipe line, and nothing else is
    for (const name of ["$(HERE)", "$(VAULT)"]) {
      for (let at = line.indexOf(name); at !== -1; at = line.indexOf(name, at + 1)) {
        if (!quoted(line, at)) bad.push(`${name} in: ${line.trim().slice(0, 60)}…`);
      }
    }
  }
  expect(bad).toEqual([]);
});

test("a target that joins its own directory runs from a path with a space in it", async () => {
  // The static check above reads the file; this one proves the property on a
  // real path, through make, end to end. A symlink rather than a copy: `abspath`
  // is lexical and does not resolve one, so `HERE` really is the spaced path and
  // every join below it goes through the spaces.
  const root = await mkdtemp(join(tmpdir(), "biom-spaced-"));
  const dir = join(root, "a person", "Biom Framework");
  try {
    await mkdir(join(root, "a person"), { recursive: true });
    await symlink(resolve(HERE), dir, "dir");

    // `layers` is the cheapest target that joins `HERE` twice — once for the
    // tool, once for the tree it reads — and it fetches nothing.
    const ran = Bun.spawnSync(["make", "-C", dir, "layers"], { stdout: "pipe", stderr: "pipe" });
    const said = ran.stdout.toString() + ran.stderr.toString();
    expect([said, ran.exitCode]).toEqual([said, 0]);
    expect(said).toContain("layering ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

/* ── a machine with no git ──────────────────────────────────────────────── */

test("with git absent the vault still reads, writes, mirrors and gets its .gitignore", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-nogit-"));
  const vault = join(root, "vault");
  // MADE BEFORE PATH IS TOUCHED, and the order is the point: an `mkdir` that
  // threw between the shadow and the `try` left every later test in this process
  // running without a PATH, which is a failure somewhere else entirely. Nothing
  // that can throw now sits outside the block that restores it.
  await mkdir(join(root, "empty"), { recursive: true });
  const path = process.env.PATH;
  try {
    // PATH POINTED AT AN EMPTY DIRECTORY, so `spawn("git", …)` fails to resolve
    // exactly as it does on a machine that has never had git on it. Nothing else
    // in this stack shells out.
    //
    // NOT THE EMPTY STRING, which looks like the stronger version and is not
    // one: `execvp` falls back to a built-in default path — `/usr/bin:/bin` —
    // when PATH is empty, so the test found the machine's own git and passed
    // while proving nothing.
    process.env.PATH = join(root, "empty");
    const host = await makeHost({
      vault,
      memory: join(root, "vaults.json"),
      presets: join(HERE, "presets"),
      vaultSeed: join(HERE, "vault"),
      skill: join(HERE, "skill"),
      checkerLib: HERE,
    });
    try {
      // NO REPO, AND THAT IS NOT A REFUSAL. The vault is a git repo when it can
      // be; when it cannot, everything except undo goes on working.
      expect(hasHistory(vault)).toBe(false);
      expect(existsSync(join(vault, ".git"))).toBe(false);

      const deps = await host.deps(vault);

      // Seeded: the root page is there and reads.
      const tree = await deps.pages.list();
      expect(tree.length).toBeGreaterThan(0);

      // And writes. Every write commits first, and a `commit()` with no repo
      // under it is a silent no-op by contract — so the write goes through and
      // the page is there afterwards.
      const made = await deps.pages.create({ name: "A note", parent: tree[0]?.id ?? null });
      expect((await deps.pages.read(made.id))?.name).toBe("A note");

      // The mirror is rebuilt: it is derived from the pages and owes git nothing.
      expect(existsSync(join(vault, "_markdown"))).toBe(true);

      // THE ONE THIS REPLACES. The `.gitignore` used to be written only when a
      // repo had just been created — so on a machine with no git the vault had
      // none, and the day git was installed and the folder reopened, a SQLite
      // file rewritten on every keystroke was tracked. The condition is now
      // "this folder is new".
      expect(existsSync(join(vault, ".gitignore"))).toBe(true);
    } finally {
      host.close();
    }
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

// AND THE ADDRESS IS A PATH TOO, on the machine where a path does not start with
// a slash. The application is built for Windows, where `path.resolve` answers
// `C:\Users\…` — and `vaultOf` tested for a leading slash alone, so every vault
// address on that machine decoded to no vault at all and every deep link landed
// on the picker. `client/boot.js`'s `vaultInUrl` makes the same test and is
// held here by the same cases.
test("[wire] a Windows absolute path is a vault address", () => {
  const win = (p: string) => vaultOf(VAULT_PREFIX + encodeURIComponent(p) + "/api/call");

  for (const path of ["C:\\Users\\sam\\notes", "C:/Users/sam/notes", "d:\\work"]) {
    const named = win(path);
    expect([path, named === null]).toEqual([path, false]);
    expect(named?.path).toBe(path);
    expect(named?.rest).toBe("/api/call");
  }

  // The posix shape goes on working, which is the half that was never broken.
  expect(vaultOf(VAULT_PREFIX + encodeURIComponent("/home/sam/notes") + "/events")?.path)
    .toBe("/home/sam/notes");

  // AND NOTHING ELSE BECAME AN ADDRESS. A relative path, a bare word and a drive
  // letter with no separator after it are all still no vault rather than a bad
  // one — a stray `/v/` in a static url must not be mistaken for a folder.
  for (const path of ["notes", "./notes", "C:", "CC:\\work", ":\\work"]) {
    expect([path, win(path)]).toEqual([path, null]);
  }
});
