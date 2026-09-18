// SPDX-License-Identifier: AGPL-3.0-only
/* THE UPDATE CHECK, WITHOUT A NETWORK.
 *
 * A production build asks `biom.dev/version.json` once per launch and the
 * document served at `/` carries the answer. Three things are worth holding
 * still: the compare, which decides what "newer" means for a build between
 * tags; the fetch, which must never throw and never say anything on a bad
 * answer; and the tag, which is absent — not empty — when there is nothing to
 * say, so a current build's document is byte-identical to the file.
 *
 * And who names the two environment variables: `server/main.ts` once each, the
 * way `tests/environment.test.ts` holds `BIOM_ENV`, because a second reader is
 * a second place the switch can be forgotten. */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchNewer, newerThan, versionTriple, withUpdate } from "../server/main.ts";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));

/* ── the compare ────────────────────────────────────────────────────────── */

test("a version parses to its triple, with or without the v and whatever follows", () => {
  expect(versionTriple("v0.1.1")).toEqual([0, 1, 1]);
  expect(versionTriple("0.1.1")).toEqual([0, 1, 1]);
  expect(versionTriple("v0.1.1-2-gf8759a0")).toEqual([0, 1, 1]);
  expect(versionTriple("v0.1.1-dirty")).toEqual([0, 1, 1]);
  expect(versionTriple("development")).toBeNull();
  expect(versionTriple("")).toBeNull();
});

test("newer means a higher triple, and a build between tags compares as its tag", () => {
  expect(newerThan("v0.1.1", "v0.1.2")).toBe(true);
  expect(newerThan("v0.1.1", "v0.2.0")).toBe(true);
  expect(newerThan("v0.1.1", "v1.0.0")).toBe(true);
  expect(newerThan("v0.1.1", "v0.1.1")).toBe(false);
  expect(newerThan("v0.1.2", "v0.1.1")).toBe(false);
  expect(newerThan("v0.1.1-2-gf8759a0", "v0.1.1")).toBe(false);
  expect(newerThan("v0.1.1-2-gf8759a0", "v0.1.2")).toBe(true);
  // A development build is never told to update, and a malformed file says nothing.
  expect(newerThan("development", "v9.9.9")).toBe(false);
  expect(newerThan("v0.1.1", "latest")).toBe(false);
});

/* ── the fetch ──────────────────────────────────────────────────────────── */

type Seen = { method: string; search: string; agent: string | null };

async function serving(body: string, status = 200): Promise<{ url: string; seen: Seen[]; stop(): void }> {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      // Copied out here: the request is the server's and is gone once answered.
      seen.push({ method: req.method, search: new URL(req.url).search, agent: req.headers.get("user-agent") });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    },
  });
  return { url: `http://localhost:${server.port}/version.json`, seen, stop: () => server.stop(true) };
}

test("the fetch names the newer version, carries the version and platform, and nothing else", async () => {
  const s = await serving(JSON.stringify({ version: "v0.1.2" }));
  try {
    expect(await fetchNewer("v0.1.1", s.url, "linux")).toBe("v0.1.2");
    expect(s.seen.length).toBe(1);
    expect(s.seen[0]).toEqual({ method: "GET", search: "", agent: "Biom/v0.1.1 (linux)" });
  } finally {
    s.stop();
  }
});

test("the fetch is silent on the same version, a malformed file, a bad status and a dead host", async () => {
  const same = await serving(JSON.stringify({ version: "v0.1.1" }));
  const junk = await serving("not json");
  const shape = await serving(JSON.stringify({ latest: "v9.0.0" }));
  const gone = await serving("", 404);
  try {
    expect(await fetchNewer("v0.1.1", same.url)).toBeNull();
    expect(await fetchNewer("v0.1.1", junk.url)).toBeNull();
    expect(await fetchNewer("v0.1.1", shape.url)).toBeNull();
    expect(await fetchNewer("v0.1.1", gone.url)).toBeNull();
  } finally {
    same.stop(); junk.stop(); shape.stop(); gone.stop();
  }
  // A port nobody is listening on: a refused connection, not a thrown one.
  expect(await fetchNewer("v0.1.1", "http://127.0.0.1:9/version.json")).toBeNull();
});

/* ── the document ───────────────────────────────────────────────────────── */

const DOC = '<!doctype html>\n<html><head>\n<meta name="biom-env" content="production">\n<title>x</title></head><body></body></html>\n';

test("the update tag is written after the environment tag, and only when there is something to say", () => {
  expect(withUpdate(DOC, null)).toBe(DOC);
  expect(withUpdate(DOC, "")).toBe(DOC);
  const out = withUpdate(DOC, "v0.1.2");
  expect(out).toContain('<meta name="biom-env" content="production">\n<meta name="biom-update" content="v0.1.2">');
  expect(out.replace('\n<meta name="biom-update" content="v0.1.2">', "")).toBe(DOC);
});

/* ── who names the switches ─────────────────────────────────────────────── */

test("server/main.ts reads BIOM_VERSION and BIOM_NO_UPDATE_CHECK once each, and nothing else names them", () => {
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
  for (const name of ["BIOM_VERSION", "BIOM_NO_UPDATE_CHECK"]) {
    const named = sources.filter((f) => readFileSync(f, "utf8").includes(name));
    expect(named.map((f) => f.slice(HERE.length + 1))).toEqual(["server/main.ts"]);
    const main = readFileSync(join(HERE, "server", "main.ts"), "utf8");
    expect(main.match(new RegExp(`process\\.env\\.${name}`, "g"))?.length).toBe(1);
  }
  // The client's half is the meta tag, and boot.js is the only module that reads it.
  const readers = sources.filter((f) => readFileSync(f, "utf8").includes('meta[name="biom-update"]'));
  expect(readers.map((f) => f.slice(HERE.length + 1))).toEqual(["client/boot.js"]);
});
