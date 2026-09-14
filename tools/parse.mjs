#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
// The syntax floor.
//
// There is no build step on the client, so nothing between `write the file` and
// `press reload` would catch a stray brace: the first person to know would be
// whoever opened the page. This parses every module the browser loads and never
// runs one.
//
//   bun run tools/parse.mjs [root]
//
// `Bun.Transpiler` rather than `node --check`, because this repo's one runtime
// is bun and a gate that needs a second one is a gate that does not run on a
// machine without it. It parses in-process, so the whole tree costs one spawn
// instead of one per file, and it reports early errors — a redeclared binding —
// as well as syntax.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.argv[2] || ".");
const ROOTS = ["client", "guest", "contracts"];
const SKIP = new Set(["node_modules", "vendor", ".git", "dist"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) yield* walk(abs);
    else if (name.endsWith(".js")) yield abs;
  }
}

const transpiler = new Bun.Transpiler({ loader: "js" });
const failures = [];
let seen = 0;

for (const top of ROOTS) {
  const dir = join(ROOT, top);
  try { statSync(dir); } catch { continue; }
  for (const abs of walk(dir)) {
    seen++;
    try {
      transpiler.transformSync(readFileSync(abs, "utf8"));
    } catch (err) {
      failures.push({ file: relative(ROOT, abs), why: String(err.message || err).trim() });
    }
  }
}

if (failures.length === 0) {
  console.log(`parse ok — ${seen} modules`);
  process.exit(0);
}

for (const f of failures) console.error(`SYNTAX  ${f.file}\n  ${f.why.replaceAll("\n", "\n  ")}`);
console.error(`\n${failures.length} of ${seen} module(s) do not parse. The browser loads these as written.`);
process.exit(1);
