// SPDX-License-Identifier: AGPL-3.0-only
// LAYER ONE, THE OTHER HALF: the server started against a workspace that has
// gone wrong, walked in a real browser.
//
// `server.e2e.ts` walks the happy path once, end to end, against one server. This
// file walks the UNHAPPY ones, and it cannot share that server: every state here
// is about what the process does ON THE WAY UP, so each one is its own launch
// with its own data directory and its own remembered list.
//
// THE OWNER'S DECISION, ON 2026-09-14, in their words: *"opening an old vault
// shouldn't be a crash; we should be a lot more fault tolerant than this."*
// Every state below was measured against a real `server/main.ts` before it was
// fixed, and three of them ended the process:
//
//   · the remembered vault is GONE            →  it was recreated and seeded,
//     so the application opened an empty workspace wearing the lost one's name
//   · the remembered vault is a FILE now      →  EEXIST out of `mkdir`, exit 1,
//     a stack trace, no window at all
//   · the remembered vault cannot be READ     →  SQLITE_CANTOPEN, the same
//   · its `workspace.db` is not a DATABASE    →  SQLITE_NOTADB, the same
//   · it was written for an older FORMAT      →  the format gate threw out of
//     the composition root, the same
//   · the remembered LIST will not parse      →  survived, and said so twice
//
// WHAT EVERY ONE OF THEM HAS TO PRODUCE IS THE SAME THREE THINGS, and they are
// what this file asserts: a server that answers, the PICKER on the screen with
// one plain sentence on it, and not one stack frame on stderr. Plus the fourth,
// which is what the two silent writes cost: whatever was on disk is still
// exactly what was on disk.
//
// A SCREENSHOT PER STATE goes into `dist/e2e/`, gitignored, named for the state.

import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, chmodSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser } from "playwright";

import { HERE, SHOTS, BOUNDS, sandbox, outside, freePort, until, step, stackTraces, shotsDir } from "./harness.ts";

shotsDir();
import type { Sandbox } from "./harness.ts";

/** One browser for the whole file. Each state gets a fresh page — a document
 *  that has already decided which folder it is on must never be reused. */
let browser: Browser | null = null;

/** Every sandbox this file makes, dropped at the end whatever happened. A
 *  permission bit is put back first: `rm -rf` cannot walk a folder it was the
 *  point of the test to make unreadable. */
const boxes: Sandbox[] = [];

afterAll(async () => {
  try {
    await browser?.close();
  } catch {
    // Closing a browser that already went is not a failure of anything.
  }
  for (const box of boxes) {
    // EVERY DIRECTORY, ALL THE WAY DOWN. One state here makes a folder
    // unreadable on purpose, and `rm -rf` cannot walk into what it cannot read —
    // so the bits go back before anything is dropped, or a passing run leaves a
    // directory in the system temp that nothing can remove.
    openUp(box.root);
    try {
      box.clean();
    } catch {
      // A temporary directory that will not go is not a failure of anything
      // under test, and it must never be what turns a green run red.
    }
  }
});

/** Put the read and traverse bits back on every directory under `at`. */
function openUp(at: string): void {
  try {
    chmodSync(at, 0o700);
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) openUp(join(at, entry.name));
    }
  } catch {
    // A path that has already gone, or was never ours.
  }
}

async function theBrowser(): Promise<Browser> {
  if (browser !== null) return browser;
  // `--no-sandbox` is an env knob and off by default, for the same reason the
  // packaged launch has one: a container without user namespaces needs it and a
  // developer's machine must not have it quietly turned on.
  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
  return browser;
}

/** Whether a permission bit can stop this process at all. Root ignores them and
 *  so does Windows, so the unreadable-folder state SKIPS BY NAME rather than
 *  passing vacuously or failing on somebody's CI. */
const PERMISSIONS_BITE = process.platform !== "win32" && process.getuid?.() !== 0;

/* ── one launch, against one bad state ──────────────────────────────────── */

interface Launch {
  /** What the picker must say, as a fragment of the sentence. */
  says: RegExp;
  /** Make the mess, and answer the path the remembered list should name — or
   *  null to leave the list saying nothing this run can use. */
  setup(box: Sandbox): string | null;
  /** Whatever must still be true of the disk afterwards. The two silent writes
   *  are what this is for: a folder recreated, or a file replaced. */
  after?(box: Sandbox, remembered: string | null): void;
}

/** START THE SERVER, LOOK AT THE SCREEN, AND STOP IT. Everything is bounded and
 *  nothing is left running: a state that hangs must fail with a sentence rather
 *  than take the suite down with it.
 *
 *  The picker is the assertion because it is the OUTCOME. A server that answers
 *  proves only that the process lived; a picker on the screen with a sentence on
 *  it is what the person actually gets, and it is the thing none of these states
 *  produced before. */
function walk(name: string, spec: Launch, ms = 90000): void {
  test(name, async () => {
    const shot = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const box = sandbox(`startup-${shot}`.slice(0, 40));
    boxes.push(box);
    const before = outside();

    mkdirSync(box.data, { recursive: true });
    const remembered = spec.setup(box);
    if (remembered !== null) {
      writeFileSync(join(box.data, "vaults.json"), JSON.stringify({ recent: [remembered] }, null, 2) + "\n", "utf8");
    }

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const said = { out: "", err: "" };
    const server = Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
      cwd: HERE,
      env: { ...box.env, PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    for (const [stream, into] of [[server.stdout, "out"], [server.stderr, "err"]] as const) {
      void (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of stream as ReadableStream<Uint8Array>) {
          said[into as "out" | "err"] += decoder.decode(chunk);
        }
      })();
    }

    const page = await (await theBrowser()).newPage({ viewport: { width: 1280, height: 860 } });
    try {
      await step(name, `${shot}.png`, () => said.err, async () => {
        // IT ANSWERS AT ALL, which three of these did not. The process used to
        // exit 1 on the way up, so there was never a port to connect to.
        await until("the server answered", BOUNDS.serve, async () => {
          if (server.exitCode !== null) throw new Error(`the server exited ${String(server.exitCode)}`);
          try {
            return (await fetch(`${base}/`)).ok;
          } catch {
            return false;
          }
        });

        await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
        await until("the picker was drawn", BOUNDS.draw, async () => (await page.locator("div.ports.vault").count()) > 0);
        await page.screenshot({ path: join(SHOTS, `${shot}.png`), fullPage: false }).catch(() => {});

        // AND IT SAYS WHAT HAPPENED. The picker alone is not the outcome: a
        // folder chooser that appears for no stated reason is the program
        // pretending the workspace never existed.
        const screen = await page.locator("div.vaulttrouble, div.ports.vault").first().innerText();
        const terminal = said.out + said.err;
        expect([name, spec.says.test(screen) || spec.says.test(terminal)]).toEqual([name, true]);

        // NOT ONE FRAME. A refusal is a sentence here; a stack frame on stderr
        // means something threw where nothing should.
        expect(stackTraces(said.err)).toEqual([]);

        spec.after?.(box, remembered);

        // And nothing reached the person's own data directory on the way.
        expect(outside()).toBe(before);
      });
    } finally {
      await page.close().catch(() => {});
      server.kill();
    }
  }, ms);
}

/* ── the states ─────────────────────────────────────────────────────────── */

walk("a remembered workspace that was deleted opens the picker, and is not recreated", {
  says: /no folder there|pick or create/i,
  setup: (box) => join(box.root, "folders", "Gone"),
  after(box, remembered) {
    // THE FIRST OF THE TWO SILENT WRITES. `initVault` creates the directory it
    // is handed, recursively, so the old path mounted the lost workspace back
    // into existence and the seeder filled it — an empty workspace with the
    // right name on it, and nothing on screen to tell the two apart.
    expect(existsSync(remembered ?? "")).toBe(false);
    expect(existsSync(join(box.root, "folders"))).toBe(false);
  },
});

walk("a remembered workspace on a volume that is not mounted opens the picker", {
  says: /no folder there|pick or create/i,
  setup: (box) => join(box.root, "not-mounted", "deep", "Vault"),
  after(box) {
    // THE SECOND. The whole missing path was created inside the empty mount
    // point — which on a real machine is a workspace written into the folder the
    // volume mounts over, invisible the moment it is plugged back in.
    expect(existsSync(join(box.root, "not-mounted"))).toBe(false);
  },
});

walk("a remembered workspace that is now a file opens the picker", {
  says: /file, not a folder/i,
  setup(box) {
    const at = join(box.root, "folders");
    mkdirSync(at, { recursive: true });
    const file = join(at, "Work");
    writeFileSync(file, "a file where a workspace used to be", "utf8");
    return file;
  },
  after(_box, remembered) {
    expect(readFileSync(remembered ?? "", "utf8")).toBe("a file where a workspace used to be");
  },
});

walk("a remembered workspace whose database is not a database opens the picker", {
  says: /not a database/i,
  setup(box) {
    const at = join(box.root, "folders", "Work");
    mkdirSync(join(at, "pages", "home"), { recursive: true });
    writeFileSync(join(at, "pages", "home", "content.yaml"), "name: Home\nplugin: biom-doc\ncontents: []\n", "utf8");
    writeFileSync(join(at, "workspace.db"), "this is not a sqlite file at all", "utf8");
    return at;
  },
  after(_box, remembered) {
    // LEFT EXACTLY WHERE IT IS. It holds the person's rows, and the rows are the
    // one thing in a vault that is not also in git.
    expect(readFileSync(join(remembered ?? "", "workspace.db"), "utf8")).toBe("this is not a sqlite file at all");
  },
});

walk("a remembered workspace in an older vault format opens the picker", {
  says: /vault format|pick or create/i,
  setup(box) {
    // FORMAT 2: `kind:`, `render:` and `order:` at column zero. There is no
    // converter and there will not be one — a section IS its markup, and that
    // markup lived in a render layer that no longer exists.
    const at = join(box.root, "folders", "Old");
    mkdirSync(join(at, "pages", "clients"), { recursive: true });
    writeFileSync(
      join(at, "pages", "clients", "content.yaml"),
      "name: Clients\nkind: doc\norder: [title]\nparent: null\nrender: null\ncontents: []\n",
      "utf8",
    );
    return at;
  },
  after(_box, remembered) {
    // REFUSED MEANS UNTOUCHED. Nothing a workspace would have gained is there.
    for (const gained of ["workspace.db", "AGENTS.md", "plugins", "design", "theme.json"]) {
      expect([gained, existsSync(join(remembered ?? "", gained))]).toEqual([gained, false]);
    }
  },
});

walk("a remembered list that will not parse opens the picker, and is left on disk", {
  says: /pick or create/i,
  setup(box) {
    // The middle of a write, which is what a crash between `open` and `write`
    // leaves behind. It is NOT rewritten by reading it: whatever somebody was in
    // the middle of stays there until the next folder is opened.
    writeFileSync(join(box.data, "vaults.json"), '{\n  "recent": [\n    "/some/pa', "utf8");
    return null;
  },
  after(box) {
    expect(readFileSync(join(box.data, "vaults.json"), "utf8")).toBe('{\n  "recent": [\n    "/some/pa');
  },
});

if (PERMISSIONS_BITE) {
  walk("a remembered workspace whose folder cannot be read opens the picker", {
    says: /cannot be read/i,
    setup(box) {
      const at = join(box.root, "folders", "Locked");
      mkdirSync(join(at, "pages"), { recursive: true });
      chmodSync(at, 0o000);
      return at;
    },
  });
} else {
  test.skip("a remembered workspace whose folder cannot be read opens the picker (no permission bits bite as this user)", () => {});
}

// THE HAPPY PATH IS NOT REPEATED HERE. `server.e2e.ts` already walks a
// remembered workspace opening straight onto its root — that is its ninth step,
// and it is the one this file's every state is the failure of.
