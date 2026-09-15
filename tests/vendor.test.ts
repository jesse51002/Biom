// SPDX-License-Identifier: AGPL-3.0-only
// The vendored libraries, and the facts everything above them rests on.
//
// All of these are surprising, and every one of them is the kind of thing
// somebody tidies away six months later because it looks like an accident.
//
//   · `mermaid.min.js` is SERVED BUT NOT SHIPPED. No plugin in `guest/plugins/`
//     draws a mermaid fence any more and a fresh vault gets none — a diagram in
//     this format is a custom drawing, HTML the section writes. The
//     ROUTE stays, because a workspace carrying its own `plugins/mermaid.js`
//     reaches this file exactly as any section reaches `three`, and deleting it
//     would break those vaults silently.
//   · It is the IIFE build ON PURPOSE. A sandboxed frame has an opaque origin: a
//     MODULE `<script src>` is CORS-gated there and blocked, while a CLASSIC one
//     loads. Swapping in the ESM build would break every artifact that loads it
//     and nothing in the framework would say so.
//   · `/vendor/` is a real route, serving a JavaScript content type. An artifact
//     reaches it too — that is R35 in the artifacts skill — which is only
//     tolerable because a subresource cannot carry anything back out.
//   · The route may not be walked out of. `..` is the whole of the attack.
//   · The versions in `vendor/README.md` are what is actually on disk.
//
// The server is spawned rather than imported: `serve` is not exported from
// main.ts, and the route table is exactly the thing being checked.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = join(import.meta.dir, "..");
const VENDOR = join(HERE, "vendor");

const readVendor = (name: string) => readFileSync(join(VENDOR, name), "utf8");

/* ── what is on disk ────────────────────────────────────────────────────── */

test("both libraries are vendored, with their licences beside them", () => {
  for (const name of ["markdown-it.mjs", "mermaid.min.js", "markdown-it.LICENSE", "mermaid.LICENSE"]) {
    expect([name, existsSync(join(VENDOR, name))]).toEqual([name, true]);
  }
  // 3.6MB is the reason nothing may load it eagerly, and the reason nothing
  // SHIPPED loads it at all. If this ever shrinks by an order of magnitude,
  // something was replaced rather than updated.
  expect(statSync(join(VENDOR, "mermaid.min.js")).size).toBeGreaterThan(1_000_000);
});

test("NOTHING SHIPPED REACHES MERMAID — a new vault has no diagram library on it", () => {
  // THE DECISION THIS FILE HAS TO HOLD. The whole point of the format is a
  // custom drawing: a figure is HTML a section writes, and a diagram of
  // relationships is that same drawing. So the shipped plugin set
  // draws with the platform and nothing else, and mermaid is a workspace's own
  // choice made in its own `plugins/mermaid.js`.
  const plugins = join(HERE, "guest", "plugins");
  expect(existsSync(join(plugins, "mermaid.js"))).toBe(false);
  for (const name of readdirSync(plugins, { recursive: true }) as string[]) {
    const file = join(plugins, name);
    if (!statSync(file).isFile()) continue;
    expect([name, readFileSync(file, "utf8").includes("mermaid")]).toEqual([name, false]);
  }
});

test("the versions in README.md are the versions on disk", () => {
  const readme = readVendor("README.md");
  // The table is the only record of what was packed, so a stale row is a
  // dependency nobody can audit.
  const rowOf = (name: string) => {
    const row = readme.split("\n").find((l) => l.includes(`\`${name}\``));
    expect([name, row !== undefined]).toEqual([name, true]);
    return /\|\s*([0-9]+\.[0-9]+\.[0-9]+)\s*\|/.exec(row ?? "")?.[1] ?? "";
  };

  expect(readVendor("mermaid.min.js")).toContain(`version:"${rowOf("mermaid.min.js")}"`);
  expect(readVendor("markdown-it.mjs")).toContain(`markdown-it ${rowOf("markdown-it.mjs")} `);
});

test("mermaid.min.js is the IIFE build, so a CLASSIC script tag can load it", () => {
  const src = readVendor("mermaid.min.js");

  // The decisive pair: no top-level import, no export. Either one would make a
  // classic <script> a syntax error, and the module build it would then need is
  // CORS-blocked from an artifact's opaque origin.
  expect(src).not.toMatch(/^\s*import[\s{*"']/m);
  expect(src).not.toMatch(/^\s*export[\s{*]/m);
  expect(src).not.toMatch(/\bexport\s*\{/);

  // And it says who it is on the global, which is what `globalThis.mermaid`
  // resolves to in both realms.
  expect(src).toContain('globalThis["mermaid"]');
});

test("markdown-it is reached as a BARE specifier, which is why layering cost nothing", () => {
  // The import map in client/index.html is the whole mechanism: the gate skips
  // a bare specifier as a package, so vendoring added no edge to the graph.
  const html = readFileSync(join(HERE, "client", "index.html"), "utf8");
  expect(html).toContain('"markdown-it": "/vendor/markdown-it.mjs"');
});

/* ── what is served ─────────────────────────────────────────────────────── */

let vault: string;
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "biom-vendor-"));
  // Port 0 is not offered by the framework, so a high one is picked and the wait
  // below is what proves it came up rather than a sleep that hopes.
  const port = 4400 + Math.floor(Math.random() * 400) + 100;
  base = `http://127.0.0.1:${port}`;
  proc = Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: { ...process.env, PORT: String(port), VAULT: vault, VAULTS: join(vault, ".vaults.json") },
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

test("both libraries are served, as JavaScript", async () => {
  for (const name of ["markdown-it.mjs", "mermaid.min.js"]) {
    const res = await fetch(`${base}/vendor/${name}`);
    expect([name, res.status]).toEqual([name, 200]);
    // A `<script src>` on a wrong content type is refused outright, and the
    // browser says nothing useful about why.
    expect([name, res.headers.get("content-type")]).toEqual([name, "text/javascript; charset=utf-8"]);
    await res.arrayBuffer();
  }
});

test("the route cannot be walked out of", async () => {
  // Encoded, because fetch normalises `..` out of a URL before it is sent and
  // the server is what has to refuse it.
  for (const path of [
    "/vendor/%2e%2e/package.json",
    "/vendor/%2e%2e/%2e%2e/etc/passwd",
    "/vendor/%2e%2e/server/main.ts",
  ]) {
    const res = await fetch(`${base}${path}`);
    expect([path, res.status]).toEqual([path, 404]);
  }
});

test("nothing else in the vendor directory is a route by accident", async () => {
  // The licences are served — they sit in the directory and a text file is
  // harmless — but a path that names no file is a 404 rather than a listing.
  const res = await fetch(`${base}/vendor/`);
  expect(res.status).toBe(404);
  expect((await fetch(`${base}/vendor/mermaid.esm.mjs`)).status).toBe(404);
});
