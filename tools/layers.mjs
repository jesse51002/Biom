#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
// The layering gate.
//
// A module may import only from a strictly lower layer, plus layer 0. No sibling
// imports, ever. The layer of a module IS the directory it sits in, so there is
// no per-file judgement and no exceptions list — `layers.json` is the whole map.
//
// This is the mechanism the modularity requirement rests on. A layering rule
// nobody checks is a comment.
//
//   bun run tools/layers.mjs [root] [--graph]
//
// --graph prints the dependency diagram derived from the real imports, so the
// architecture picture cannot drift from the code.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const ROOT = resolve(process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]) || ".");
const LAYERS = JSON.parse(readFileSync(join(ROOT, "layers.json"), "utf8"));
const SKIP = new Set(["node_modules", "vendor", ".git", "dist", "tools", "skill", "vault"]);

// Longest prefix wins, so "server/domain" beats "server" if both were listed.
const ENTRIES = Object.entries(LAYERS)
  .filter(([k]) => !k.startsWith("_"))
  .sort((a, b) => b[0].length - a[0].length);

/** contracts | server | client | guest — the tier a path belongs to. */
const tierOf = (rel) =>
  rel.startsWith("contracts/") ? "contracts"
  : rel.startsWith("server/") ? "server"
  : rel.startsWith("client/") ? "client"
  : rel.startsWith("guest/") ? "guest"
  : null;

function layerOf(abs) {
  const rel = relative(ROOT, abs).replaceAll("\\", "/");
  for (const [prefix, n] of ENTRIES) {
    if (rel === prefix || rel.startsWith(prefix + "/")) return { name: prefix, n, rel, tier: tierOf(rel) };
  }
  return null;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|ts)$/.test(p) && !/\.d\.ts$/.test(p)) yield p;
  }
}

// House style: static imports only, one per line, at the top of the file. That
// rule is what makes a regex sufficient here and a parser unnecessary.
const STATIC = /^\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']/g;

// THE ONE GENERATED BUNDLE, and the one dynamic import allowed to name a file
// that is not on the stack. `tools/app.ts` writes `dist/embedded.ts` — every
// file the compiled server carries instead of the directory it no longer has
// beside it — and the composition root imports it dynamically, because a clone
// that has never run `make app` does not have one and must still start.
//
// It is named rather than pattern-matched: this is an allow-list of exactly one,
// and a second entry should have to be argued for. It is still REPORTED with the
// other dynamic imports, which is the whole deal that rule strikes.

const GENERATED = "../dist/embedded.ts";

const violations = [];

// A literal NUL in source is legal JavaScript and completely invisible: it makes
// grep and ripgrep treat the whole file as binary, so every search of it comes
// back silently empty. It has now cost two wrong diagnoses — once a bug reported
// that was not there, once a regression reported that was not there — and it was
// fixed once already before a later rewrite put another one back. Use the escape.
const nuls = [];
const dynamics = [];
const edges = new Set();

const resolveSpec = (fromFile, spec) => {
  const base = resolve(dirname(fromFile), spec);
  for (const c of [base, base + ".ts", base + ".js", join(base, "index.ts"), join(base, "index.js")]) {
    const hit = layerOf(c);
    if (hit) return hit;
  }
  return null;
};

for (const file of walk(ROOT)) {
  const from = layerOf(file);
  if (!from) continue;
  const src = readFileSync(file, "utf8");
  const here = relative(ROOT, file);
  if (src.includes("\u0000")) nuls.push(here);

  const fail = (spec, why) => violations.push({ file: here, spec, why });

  const check = (spec, isDynamic) => {
    if (!spec.startsWith(".")) return;                 // a bare specifier is a package
    if (isDynamic && spec === GENERATED) {              // the generated bundle; see above
      dynamics.push({ file: here, spec, from: from.name, to: "dist (generated, gitignored)" });
      return;
    }
    const to = resolveSpec(file, spec);
    if (!to) return fail(spec, "resolves outside the framework, or to no layer");
    if (to.name === from.name) return;                 // same module, same directory
    edges.add(`${from.name} --> ${to.name}`);

    if (from.tier === "contracts") return fail(spec, "contracts imports nothing");
    if (to.tier === "guest") return fail(spec, "nothing may import guest — it runs in the artifact's realm");
    if (from.tier === "guest") return fail(spec, "guest imports nothing; it is served as one self-contained file");
    if (from.tier !== to.tier && to.tier !== "contracts")
      return fail(spec, `${from.tier} may not import ${to.tier} — they are separate processes`);

    if (isDynamic) { dynamics.push({ file: here, spec, from: from.name, to: to.name }); return; }
    if (to.n === 0) return;                            // everyone may speak the types
    if (to.n >= from.n)
      fail(spec, `${from.name} (${from.n}) -> ${to.name} (${to.n}) is not strictly downward`);
  };

  for (const m of src.matchAll(STATIC)) check(m[1], false);
  for (const m of src.matchAll(DYNAMIC)) check(m[1], true);
}

if (process.argv.includes("--graph")) {
  console.log("flowchart TB");
  for (const e of [...edges].sort()) console.log("  " + e);
  console.log("");
}

for (const d of dynamics)
  console.log(`note  ${d.file}  dynamic import of ${d.spec}  (${d.from} -> ${d.to})`);

for (const f of nuls) {
  console.error(`LITERAL NUL  ${f}\n  makes grep treat this file as binary, so searches of it come back empty.\n  write \\u0000 instead.`);
}

if (violations.length === 0 && nuls.length === 0) {
  const n = new Set([...edges].map((e) => e.split(" --> ")[0])).size;
  console.log(`layering ok — ${n} importing modules, ${edges.size} distinct edges`);
  process.exit(0);
}

for (const v of violations)
  console.error(`UPWARD IMPORT  ${v.file}\n  imports ${v.spec}\n  ${v.why}`);
if (violations.length)
  console.error(`\n${violations.length} layering violation(s). A module may import only from a strictly lower layer, plus contracts.`);
if (nuls.length)
  console.error(`\n${nuls.length} file(s) carry a literal NUL.`);
process.exit(1);
