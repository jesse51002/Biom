// SPDX-License-Identifier: AGPL-3.0-only
// WHICH BUILD THIS IS: one value, read once on each side of the wire.
//
// `BIOM_ENV` governs two things and no others — what the built application SHOWS
// and what it REFUSES. What it never governs is how a file is loaded: the
// composition root chooses embedded-vs-disk by asking what is embedded, not by
// asking this.
//
// THE REFUSALS ARE NOT HERE. They are a property of the API layer and are tested
// where that layer is, by constructing a `Deps` that says which build it is —
// see the three tests at the foot of api.test.ts. What is here is the reading of
// the value, the one route the server composes out of it, and the fact that only
// two modules in the whole program name it.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { environment, withEnvironment, withTrouble } from "../server/main.ts";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(HERE, "client", "index.html");

/* ── reading it ─────────────────────────────────────────────────────────── */

test("unset is development, and a value that is none of the three is production", () => {
  // A SOURCE TREE IS WHERE THIS IS READ WITH NOTHING SUBSTITUTED, and a
  // stranger's binary always carries a define. So unset means development and
  // the existing suite is untouched by the whole change.
  expect(environment(undefined)).toBe("development");
  expect(environment("")).toBe("development");
  expect(environment("   ")).toBe("development");

  expect(environment("development")).toBe("development");
  expect(environment("test")).toBe("test");
  expect(environment("production")).toBe("production");

  // A typo in a build script fails towards HIDING rather than towards shipping
  // a developer's screens to somebody who cannot use them. It is said out loud
  // on stderr, which is the cost of choosing this direction.
  expect(environment("prodction")).toBe("production");
  expect(environment("prod")).toBe("production");
  // Case is not guessed at: three spellings, and anything else is the safe one.
  expect(environment("Production")).toBe("production");
});

/* ── the one route the server composes ──────────────────────────────────── */

test("the development document is byte-identical to the file on disk", () => {
  const html = readFileSync(INDEX, "utf8");
  // The file carries `development` already, so composing it in a development
  // build substitutes the value that is there and nothing moves. That is what
  // makes a raw `client/index.html` opened off disk honest as well.
  expect(withEnvironment(html, "development")).toBe(html);
  expect(html).toContain('<meta name="biom-env" content="development">');
});

test("composing it changes one attribute and nothing else", () => {
  const html = readFileSync(INDEX, "utf8");
  const built = withEnvironment(html, "production");
  expect(built).toContain('<meta name="biom-env" content="production">');
  expect(built).not.toContain('content="development"');
  // Exactly one attribute, and the rest of the document is the file's own —
  // including the import map, which is what keeps `markdown-it` a bare
  // specifier and is the one thing a substitution could plausibly break.
  expect(built.replace('content="production"', 'content="development"')).toBe(html);
  expect(built).toContain('"markdown-it": "/vendor/markdown-it.mjs"');
});

/* ── who is allowed to name it ──────────────────────────────────────────── */

test("two modules read BIOM_ENV, once each, and no third names it at all", () => {
  /** Every source file the program is made of. `tests/` is deliberately out:
   *  a test may say the name as often as it likes. */
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const at = join(dir, entry);
      if (statSync(at).isDirectory()) walk(at);
      else if (/\.(ts|js|mjs|html)$/.test(entry)) sources.push(at);
    }
  };
  for (const dir of ["server", "client", "guest", "contracts"]) walk(join(HERE, dir));

  const named = sources.filter((f) => readFileSync(f, "utf8").includes("BIOM_ENV"));
  expect(named.map((f) => f.slice(HERE.length + 1)).sort()).toEqual(["server/main.ts"]);

  // And it is read ONCE there. `process.env.BIOM_ENV` is the whole expression:
  // a compiled build substitutes it with a string literal at compile time and a
  // source run finds the real process environment, so one spelling serves both.
  const main = readFileSync(join(HERE, "server", "main.ts"), "utf8");
  expect(main.match(/process\.env\.BIOM_ENV/g)?.length).toBe(1);

  // The client's half is the meta tag, and boot.js is the only module that
  // reads it. It cannot share a constant with the HTML that carries it —
  // `contracts/` is the only file both could import from, and it is frozen —
  // so the pair is asserted here instead.
  const inClient = sources.filter((f) => readFileSync(f, "utf8").includes('meta[name="biom-env"]'));
  expect(inClient.map((f) => f.slice(HERE.length + 1))).toEqual(["client/boot.js"]);
});

/* ── the one constant that has to be flipped in two files ───────────────── */

test("the two NATIVE_DIALOG constants hold the same value", () => {
  // `vault.browse` is the one item on the production hide list that cannot go
  // alone: Browse is the only way to reach a workspace that is on disk and not
  // in `Recent`, so the hide is written and HELD until the native directory
  // dialog serves Open as well as Create. It is held in two places — the server
  // refuses the kind, the picker hides the group — and the two cannot be one
  // constant, because `contracts/` is the only file both could import from and
  // it is frozen.
  //
  // So nothing but this test stops one being flipped without the other, which
  // is a built application that either offers a Browse group the server refuses
  // or refuses a kind nothing asks. Source text is the only way to compare two
  // module-private constants, and this file already reads source for the same
  // reason.
  const read = (rel: string) => {
    const src = readFileSync(join(HERE, rel), "utf8");
    const found = src.match(/^const NATIVE_DIALOG = (true|false);$/m);
    if (found === null) throw new Error(`${rel} declares no NATIVE_DIALOG`);
    return found[1];
  };

  expect(read("client/views/vault.js")).toBe(read("server/api/routes.ts"));
});

/* ── end to end, with a server actually up ──────────────────────────────── */

let vault: string;
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "biom-env-"));
  const port = 4400 + Math.floor(Math.random() * 400) + 500;
  base = `http://127.0.0.1:${port}`;
  proc = Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: {
      ...process.env,
      PORT: String(port),
      VAULT: vault,
      VAULTS: join(vault, ".vaults.json"),
      // The only place in the whole suite where a value is set on a process,
      // and it is set on a CHILD one: nothing about the runner changes.
      BIOM_ENV: "production",
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/`);
      return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("the framework did not come up");
});

afterAll(() => {
  proc?.kill();
  rmSync(vault, { recursive: true, force: true });
});

test("the document served at / carries the build, and the rest of it is the file", async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");

  const served = await res.text();
  expect(served).toContain('<meta name="biom-env" content="production">');
  // The ONLY difference from the file on disk. `/` is composed; nothing else
  // the server hands out is touched.
  expect(served.replace('content="production"', 'content="development"'))
    .toBe(readFileSync(INDEX, "utf8"));
});

test("a deep link into a vault gets the same composed document", async () => {
  // `/v/<vault>/` is somebody opening a tab, and it answers with the app rather
  // than a 404 they cannot navigate out of — so it has to carry the build too.
  const res = await fetch(`${base}/v/${encodeURIComponent(vault)}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('<meta name="biom-env" content="production">');
});

test("every other static file is served exactly as it sits on disk", async () => {
  const res = await fetch(`${base}/js/boot.js`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe(readFileSync(join(HERE, "client", "boot.js"), "utf8"));
});

/* ── and why this launch has no workspace ───────────────────────────────── */

test("a launch with nothing to say about the vault composes the file itself", () => {
  const html = readFileSync(INDEX, "utf8");
  // THE TAG IS ABSENT RATHER THAN EMPTY, which is what keeps a first launch's
  // document byte-identical to the file — the same property the environment tag
  // is written to hold. A first launch needs no explaining; a tag saying nothing
  // would be a second thing for the client to decide the meaning of.
  expect(withTrouble(html, null)).toBe(html);
  expect(withTrouble(html, "   ")).toBe(html);
  expect(html).not.toContain("biom-trouble");
});

test("a launch whose workspace did not open carries the sentence in the document", () => {
  const html = readFileSync(INDEX, "utf8");
  // IT CANNOT COME DOWN THE WIRE. The client's one call before it has a folder
  // is `vault.recent`, and `VaultInfo` has no field for it — so the document,
  // which the server already composes for the environment, is the channel that
  // is there. `client/boot.js` is the only module that reads either.
  const built = withTrouble(html, "that is a file, not a folder");
  expect(built).toContain('<meta name="biom-trouble" content="that is a file, not a folder">');
  // Beside the tag that is always there, so there is one anchor in the document
  // rather than a second place to keep in step.
  expect(built).toMatch(/biom-env[^\n]*\n<meta name="biom-trouble"/);
  // And nothing else moved.
  expect(built.replace(/\n<meta name="biom-trouble"[^\n]*>/, "")).toBe(html);
});

test("a sentence is escaped on its way into an attribute, and arrives on one line", () => {
  const html = readFileSync(INDEX, "utf8");
  // NOTHING HERE IS USER INPUT — every one of these strings is a literal in
  // `server/workspace/vault.ts` or `server/workspace/migrate.ts`. It is escaped
  // anyway, because the day one of them carries a folder's name is the day that
  // stops being true and nothing would say so.
  const built = withTrouble(html, 'a "quoted" <b>name</b> & more\nand a second line');
  // FOLDED, NOT TRUNCATED. An attribute is one line — the format gate's refusal
  // is a paragraph, and a newline inside a tag is a document that parses into
  // something else — but the way to make a paragraph one line is to fold it,
  // not to throw away everything after the first break.
  expect(built).toContain('content="a &quot;quoted&quot; &lt;b&gt;name&lt;/b&gt; &amp; more and a second line">');
  expect(built.split("\n").filter((l) => l.includes("biom-trouble"))).toHaveLength(1);
});
