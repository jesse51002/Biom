// SPDX-License-Identifier: AGPL-3.0-only
// The authoring skills' tests. Four jobs, and the second is the load-bearing one.
//
//  1. **The pages that ship pass the checker that describes them.** Everything
//     under `vault/base/` and the design doc beside it are real pages, copied
//     into every workspace and read as the reference a generated section is
//     written from. Each is run through `checkDir` and asserted free of FAILs —
//     hard, not conditionally. A shipped page that fails its own checker is
//     either a skill describing something nobody has done or a page that is
//     wrong, and both are worth a red test.
//
//     THE TWO SEEDED PRESETS AND THE TWO WORKED EXAMPLES ARE GONE FROM HERE.
//     `presets/` went with the render layer — the pages in it were
//     written against `kind:`, `render:` and a heterogeneous `contents`, none of
//     which parse now — and no SKILL.md carries an `<!-- example: -->` marker
//     any more, so there is nothing in the prose left to lift out and check. The
//     property both tests bought is the one above, against the pages that do
//     still ship.
//
//  2. **The checker's reader agrees with the server's.** `skill/check.ts` has to
//     run inside a vault, where there is no `vendor/`, no `node_modules/` and —
//     the case that actually bites — no network, so it reads `content.yaml` with
//     a parser of its own rather than reaching at the vendored one through
//     `_lib/`. A second implementation is a second opinion unless something
//     holds the two together, and THIS FILE IS THAT THING: both readers are run
//     over every real document in the repo and must answer identically, and both
//     are held to refusing the same retired keys by name.
//
//  3. **The split has not rotted.** One 870-line SKILL.md became one skill per
//     concept under `vault/.agents/skills/`, which is what a vault ships so that an agent
//     pointed at somebody's folder can read the format. Splitting a document is
//     how a number ends up with prose in no file, or prose in a file no checker
//     knows about, so: every rule check.ts cites has prose in some skill, every
//     rule number written in a skill is one check.ts cites OR one the index has
//     RETIRED, and the rule index in `.agents/skills/biom-pages` names all of them and points
//     each at the skill that actually carries it.
//
//     **The numbers are the join, and a retired number is never reused.** The
//     format changed underneath fourteen of them. Four described the flat
//     sidecar; the rest described the render — the layer that owned the whole
//     sheet and drew every block on it. Two of the fourteen INVERTED rather than
//     merely died: there is one filling frame per page now, so `vh`,
//     `height: 100%` and `position: fixed` are what an author writing them
//     expects, and R22 and R27 stayed spent rather than being rewritten in
//     place. The retired list is read out of `.agents/skills/biom-pages` rather than written
//     here, because the prose is what an agent reads.
//
//  4. **Every rule actually catches its violation.** A checker that typechecks
//     and reports nothing is worse than no checker, because it reads as a pass.
//     There is one small bad page per rule below, and each asserts the rule
//     fires. There is no second sizing mode to be conditional on any more, so
//     the inverted pair is asserted the other way round: the declarations that
//     used to fail are asserted SILENT.

import { test, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

import {
  check, checkDir, checkVault, contractsOf, findVault, formatReport, namesOf, readVault, readYaml,
  type PageSource, type Report, type VaultSource,
} from "../skill/check.ts";
import { parse } from "../server/platform/yaml.ts";

const HERE = fileURLToPath(new URL("..", import.meta.url));

/** What a vault gets at its root. `skill/check.ts` stays in the repo — it is the
 *  source of truth and other tests import it — but the prose that cites its
 *  numbers ships with the vault, because the agent working in somebody's folder
 *  never sees this repository. */
const SKILLS = HERE + "vault/.agents/skills/";
/** What every framework skill directory starts with. Spelled once here and once
 *  in `server/workspace/framework.ts`; the test below holds them equal. */
const SKILL_PREFIX = "biom-";

/** The blocks every workspace is seeded with, and the design doc beside them.
 *  Real pages, in the format, read as data. */
const BASE = HERE + "vault/base/";

/* ── helpers ────────────────────────────────────────────────────────────── */

/** The rule ids a report cited, so a test asserts on the rule rather than on a
 *  sentence that is allowed to be reworded. */
const rules = (r: Report): Set<string> => new Set(r.findings.map((f) => f.rule));

const said = (r: Report): string =>
  r.findings.map((f) => `${f.severity} ${f.rule} ${f.file}:${f.line} ${f.says}`).join("\n");

/** A minimal complete section file, one piece at a time. Everything is spelled
 *  out — a fixture that shares a builder with the thing it is testing tests the
 *  builder. The one slot is `body`, which is also the shipped default section's
 *  one slot, so the same `parts` map works with a file and without one.
 *
 *  IT CARRIES NO WORDS, AND THE SLOT IS A `<div>`. Both are R56: all text is
 *  markdown in `content.yaml` behind a slot, so a section file carries the
 *  visuals and the structure and none of the words — and the slot element is a
 *  NEUTRAL container, because markdown renders block-level and a `<p>` slot
 *  filled with a paragraph is a `<p>` inside a `<p>`. The fixture used to be
 *  `<p data-g-part="body">Hello</p>`, which is one word nobody could edit and
 *  the nesting trap in three characters, and every test that asserted a page
 *  reports NOTHING was asserting it against a page the rule now warns about.
 *
 *  IT CARRIES NO SCRIPT UNLESS ONE IS ASKED FOR. It used to assign
 *  `biom.toMarkdown` in every fixture, because R34 WARNed on a file that
 *  did not — and R34 is retired: the hook is PAGE-wide and was being checked
 *  once per section FILE, so a six-section page collected six warnings for a
 *  thing it can only do once. A section with nothing to run is the ordinary
 *  case, and the fixture says so. */
const html = (parts: { body?: string; style?: string; script?: string; head?: string }): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    ...(parts.head === undefined ? [] : [parts.head]),
    "<style>",
    parts.style ?? "",
    "</style>",
    "</head>",
    "<body>",
    parts.body ?? '<div data-g-part="body"></div>',
    ...(parts.script === undefined ? [] : ["<script>", parts.script, "</" + "script>"]),
    "</body>",
    "</html>",
    "",
  ].join("\n");

/** ONE FILE HOLDS EVERYTHING THE PAGE SAYS. `contents` is a list of SECTIONS and
 *  nothing else: no `kind:`, no `render:`, no `order:` and no `type:` on an
 *  entry. A section names its markup in `data:` and its `parts` map says what
 *  goes in each slot that markup declares — the key IS the slot's id. */
const PAGE_YAML = [
  "name: Rates",
  "plugin: biom-doc",
  "contents:",
  "  - name: hero",
  "    data: hero.html",
  "    parts:",
  "      body: Hello",
  "",
].join("\n");

/** A page whose one section is drawn by `hero.html`. */
const page = (file: string, doc = PAGE_YAML): PageSource => ({
  id: "rates-note",
  doc,
  files: { "hero.html": file },
});

/** A doc whose `contents` are exactly these lines. */
const withContents = (...lines: string[]): string =>
  ["name: Rates", "plugin: biom-doc", "contents:", ...lines, ""].join("\n");

/** One section with its own file and one markdown part in it, so a template can
 *  be checked against the three scopes it resolves in — the part's own values,
 *  then the section's, then the page's — over a page made of
 *  nothing but default sections. */
const prose = (
  text: string,
  vars: { part?: string[]; section?: string[]; page?: string[] } = {},
): PageSource => ({
  id: "rates-note",
  doc: [
    "name: Rates",
    "plugin: biom-doc",
    ...(vars.page === undefined ? [] : ["variables:", ...vars.page.map((v) => "  " + v)]),
    "contents:",
    "  - name: intro",
    "    data: intro.html",
    ...(vars.section === undefined ? [] : ["    variables:", ...vars.section.map((v) => "      " + v)]),
    "    parts:",
    "      body:",
    "        type: markdown",
    ...(vars.part === undefined ? [] : ["        variables:", ...vars.part.map((v) => "          " + v)]),
    "        data: |",
    ...text.split("\n").map((line) => "          " + line),
    "",
  ].join("\n"),
  files: { "intro.html": html({}) },
});

/* ── the reader is not a second opinion ─────────────────────────────────── */

/** Every YAML document the repo actually ships, wherever it is. The checker's
 *  reader and the vendored parser the server writes through are run over each
 *  one and must agree — which is the only thing that makes it safe for check.ts
 *  to carry a reader of its own rather than import the server's. */
async function documents(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // `dist/` is generated and gitignored, and it is where `make app` stages a
    // build and where a try-out vault may sit; neither is a document the
    // framework ships.
    if (entry.name === "node_modules" || entry.name === "vendor" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const at = join(dir, entry.name);
    if (entry.isDirectory()) await documents(at, out);
    else if (/\.(?:yaml|yml)$/.test(entry.name)) out.push(at);
  }
  return out;
}

test("the checker's own reader answers exactly what the vendored parser answers", async () => {
  const files = await documents(HERE);
  // A guard on the guard: a walk that found nothing would pass silently.
  //
  // THE NUMBER COUNTS WHAT THE FRAMEWORK SHIPS AND NOTHING ELSE. It was `> 10`,
  // which this repository met only because a seeded vault used to sit at
  // `workspace` and threw in dozens of untracked `content.yaml` files.
  // Nothing is written beside the install any more, so the walk sees `vault/` —
  // the vault root as it ships — and a fresh clone was failing a test that had
  // been measuring somebody's local folder all along.
  expect(files.length).toBeGreaterThanOrEqual(6);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    expect(readYaml(text), `${file} reads differently in check.ts than in the server`)
      .toEqual(parseDocument(text, { version: "1.2" }).toJS());
  }
});

test("the reader refuses what the server refuses, and says which line", () => {
  const bad = check(page(html({}), "name: Rates\n  contents: []\n"));
  expect(rules(bad).has("R1")).toBe(true);
  expect(bad.findings[0]?.line).toBeGreaterThan(0);
  // And the server's parser will not have it either.
  expect(() => parse("name: Rates\n  contents: []\n")).toThrow();
});

/** THE RETIRED KEYS ARE REFUSED BY BOTH READERS, BY NAME. A file still carrying
 *  one was written for a format neither reader has, and dropping it silently
 *  would throw away whatever that format put there. `server/platform/yaml.ts`
 *  throws; `check.ts` reports R1 and names the key. A key that stopped being
 *  refused in one of them and not the other is exactly the drift this file
 *  exists to catch. */
test("both readers refuse a retired page key, and the finding names it", () => {
  for (const key of ["kind: doc", "render: null", "order: [hero]", "parent: home", "sections: [hero]"]) {
    const doc = PAGE_YAML + key + "\n";
    expect(() => parse(doc), `the server accepts ${key}`).toThrow();

    const report = check(page(html({}), doc));
    expect(rules(report).has("R1"), `${key} is not reported`).toBe(true);
    expect(report.ok).toBe(false);
    expect(said(report)).toContain(key.split(":")[0] ?? "");
    expect(said(report)).toContain("old format");
  }
});

/** `uid` IS THE ONE HOST KEY THE FRAMEWORK WRITES IN ITSELF — minted on the
 *  mount, written into every page that has none — so a page the server has
 *  opened carries it, and a checker that did not know the key failed R1 on
 *  every page of every workspace. Both readers take the one the framework
 *  mints and refuse anything else under the name. */
test("both readers accept the framework's uid and refuse one that is not its shape", () => {
  const good = PAGE_YAML + "uid: qm4vxbco4bt2xruw\n";
  expect(() => parse(good)).not.toThrow();
  expect(rules(check(page(html({}), good))).has("R1")).toBe(false);

  for (const key of ["uid: Kitchen", "uid: 12", "uid: [a, b]"]) {
    const doc = PAGE_YAML + key + "\n";
    expect(() => parse(doc), `the server accepts ${key}`).toThrow();
    const report = check(page(html({}), doc));
    expect(rules(report).has("R1"), `${key} is not reported`).toBe(true);
    expect(said(report)).toContain("not a thing to type");
  }
});

test("both readers refuse a retired key on a section, and an unknown key anywhere", () => {
  // `type:` on a `contents` entry is the biggest of them: an entry used to BE a
  // content and carried one. An entry is a SECTION now and the four types moved
  // down into its `parts`.
  for (const key of ["    type: html", "    order: 1", "    render: plain"]) {
    const doc = withContents("  - name: hero", "    data: hero.html", key);
    expect(() => parse(doc), `the server accepts ${key.trim()}`).toThrow();
    expect(rules(check(page(html({}), doc))).has("R1"), `${key.trim()} is not reported`).toBe(true);
  }

  // An unknown key is refused rather than dropped, at both levels, by both.
  for (const doc of [PAGE_YAML + "colour: red\n", withContents("  - name: hero", "    data: hero.html", "    colour: red")]) {
    expect(() => parse(doc)).toThrow();
    expect(rules(check(page(html({}), doc))).has("R1")).toBe(true);
  }
});

/* ── the pages that ship ────────────────────────────────────────────────── */

/** Every directory under `vault/base/` that holds a page. Read off disk rather
 *  than listed here: a block added to the vault is a block this test picks up. */
async function shipped(): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(BASE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    out.push(BASE + entry.name);
  }
  return out;
}

test("every page that ships in a vault passes the checker that describes it", async () => {
  const dirs = await shipped();
  expect(dirs.length, "vault/base/ holds no pages").toBeGreaterThan(2);
  for (const dir of [...dirs, HERE + "vault/design"]) {
    const report = await checkDir(dir);
    const fails = report.findings
      .filter((f) => f.severity === "FAIL")
      .map((f) => `${f.rule} ${f.file}:${f.line} ${f.says}`);
    expect(fails, `${dir} does not pass the checker that describes it`).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.sections, `${dir} has no sections`).toBeGreaterThan(0);
  }
});

test("the design doc a vault ships with reports nothing at all", async () => {
  // Not only no FAILs. It is the first page an agent reads in somebody's
  // workspace and the file this skill's own rules are argued from, so a warning
  // on it is a warning every reader learns to step over.
  const report = await checkDir(HERE + "vault/design");
  expect(report.findings.map((f) => `${f.rule} ${f.file}:${f.line} ${f.says}`)).toEqual([]);
  // It DRAWS: the bands carry their own markup and the prose under them does not.
  expect(report.defaults).toBeLessThan(report.sections);
  expect(report.defaults).toBeGreaterThan(0);
});

test("the shipped blocks are the reference a section is written from, and use real sections", async () => {
  // `base/child` is the exception and is named as one: it is not a section at
  // all but a `child.html` — how a page looks inside somebody else's — so its
  // one `index.html` is markup for a slot rather than a section's own file.
  for (const dir of await shipped()) {
    const report = await checkDir(dir);
    if (dir.endsWith("/child")) continue;
    expect(report.defaults, `${dir} is nothing but default sections`).toBeLessThan(report.sections);
    expect(report.slots.length, `${dir} declares no slots`).toBeGreaterThan(0);
  }
});

/* ── the split has not rotted ───────────────────────────────────────────── */

/** Every SKILL.md the vault ships, by concept — the directory name with the
 *  framework's `biom-` prefix taken off, which is how the rule index names a
 *  skill. A directory with no SKILL.md in it is not a skill and is passed over
 *  rather than failed — the folder is what an agent reads, not a manifest
 *  anybody maintains. EVERY SHIPPED SKILL CARRIES THE PREFIX: it is what keeps
 *  the framework's names from colliding with a skill a workspace wrote, since a
 *  framework skill is rewritten in every vault on open and a workspace's own is
 *  never touched — so a directory here without it is a finding. */
async function skills(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const text = await readFile(SKILLS + entry.name + "/SKILL.md", "utf8");
      expect(entry.name.startsWith(SKILL_PREFIX), `vault/.agents/skills/${entry.name} ships without the ${SKILL_PREFIX} prefix`).toBe(true);
      found[entry.name.slice(SKILL_PREFIX.length)] = text;
    } catch {
      // not a skill
    }
  }
  return found;
}

/** The rule numbers check.ts actually reports on. */
async function cited(): Promise<Set<string>> {
  const code = await readFile(HERE + "skill/check.ts", "utf8");
  const out = new Set<string>();
  for (const m of code.matchAll(/say\("(R\d+)"|rule: "(R\d+)"/g)) out.add(m[1] ?? m[2] ?? "");
  return out;
}

/** The numbers the index has RETIRED, read out of the prose rather than written
 *  here. A retired number is spent: the rule it named described a format that is
 *  gone, and whatever replaced it took a NEW number so that a finding cited in
 *  an old diff still means what it meant. */
async function retired(): Promise<Set<string>> {
  const index = (await skills())["pages"] ?? "";
  const from = index.indexOf("## Retired numbers");
  expect(from, ".agents/skills/biom-pages/SKILL.md carries no retired-number list").toBeGreaterThan(0);
  const out = new Set<string>();
  for (const m of index.slice(from).matchAll(/^\|\s*(R\d+)\s*\|/gm)) out.add(m[1] ?? "");
  return out;
}

/** THE TEST THAT STOPS THE SPLIT FROM ROTTING. One file doing four jobs became
 *  seven, and the failure that buys is a rule whose prose went to a skill nobody
 *  kept — a number in the checker that no page a person can read explains, or a
 *  number explained in prose that the checker no longer has. Either way the
 *  finding cites a rule and the rule is not there. */
test("every rule check.ts cites has prose in some skill, and every rule in a skill is cited or retired", async () => {
  const rulesCited = await cited();
  const gone = await retired();

  const documented = new Set<string>();
  for (const text of Object.values(await skills())) {
    for (const m of text.matchAll(/\bR\d+\b/g)) documented.add(m[0]);
  }

  // R50 is prose here and code elsewhere: a vault plugin may never claim a
  // shipped id, which is checked where plugins are REGISTERED rather than where
  // pages are read, so `.agents/skills/biom-plugins` carries it and check.ts never cites it.
  expect([...rulesCited].filter((r) => !documented.has(r)).sort()).toEqual([]);
  expect([...documented].filter((r) => r !== "R50" && !rulesCited.has(r) && !gone.has(r)).sort()).toEqual([]);
  // A number cannot be both spent and live.
  expect([...gone].filter((r) => rulesCited.has(r)).sort()).toEqual([]);
});

test("every spent number is retired and not reused", async () => {
  const gone = await retired();
  // Four went with the flat sidecar, and most of the rest with the render layer
  // — the one treatment the whole sheet took, which is what a section replaced.
  for (const rule of ["R0", "R2", "R3", "R4", "R5", "R7", "R8", "R10", "R11", "R12", "R22", "R27", "R36", "R39"]) {
    expect(gone.has(rule), `${rule} is spent and must stay retired`).toBe(true);
  }
  // R34 went for a different reason and it is the one worth naming: it WARNed
  // that a file had not assigned `biom.toMarkdown`, which is a PAGE-wide
  // hook checked once per section FILE — so it fired on correct work, and a rule
  // that fires on correct work teaches people to stop reading the report.
  // Whatever replaces it belongs to the runtime and takes a NEW number.
  expect(gone.has("R34")).toBe(true);
});

/** The index is the map from a finding to the file that explains it, and it is
 *  the only thing holding seven skills together as one document. A row pointing
 *  at a skill that does not carry the rule is worse than no row: it sends the
 *  reader to a file that will not answer. */
test("the rule index in .agents/skills/biom-pages names every rule and points each at the skill that carries it", async () => {
  const found = await skills();
  const index = found["pages"] ?? "";
  expect(index, ".agents/skills/biom-pages/SKILL.md is missing").not.toBe("");
  const live = index.slice(0, index.indexOf("## Retired numbers"));

  const owner = new Map<string, string>();
  for (const m of live.matchAll(/^\|\s*(R\d+)\s*\|[^|]*\|\s*([a-z-]+)\s*\|[^|]*\|\s*$/gm)) {
    owner.set(m[1] ?? "", m[2] ?? "");
  }

  // R50 belongs to the plugin registry rather than to the page reader, and the
  // index still has to say where its prose is.
  expect(owner.get("R50"), "R50 is checked where plugins register and still belongs in the index").toBe("plugins");
  expect([...(await cited())].filter((r) => !owner.has(r)).sort()).toEqual([]);

  // EVERY OFFENDER AT ONCE, rather than failing on the first: a row pointing at
  // a skill that does not carry the rule sends the reader to a file that will
  // not answer, and a reader chasing one broken row wants the rest of them named
  // in the same breath.
  const missing: string[] = [];
  for (const [rule, skill] of owner) {
    expect(found[skill], `the index gives ${rule} to .agents/skills/${skill}, which has no SKILL.md`).toBeDefined();
    if (!new RegExp("\\b" + rule + "\\b").test(found[skill] ?? "")) missing.push(`${rule} -> .agents/skills/${skill}`);
  }
  expect(missing, "the index sends a reader to a skill whose prose never mentions the rule").toEqual([]);
});

/** Frontmatter is how a Claude Code agent decides whether to open a file at all.
 *  A skill without it is a file nobody loads on demand, which is the whole point
 *  of having split them. */
test("every skill carries frontmatter an agent can route on", async () => {
  const found = await skills();
  expect(Object.keys(found).length).toBeGreaterThan(3);
  for (const [name, text] of Object.entries(found)) {
    const head = /^---\nname: ([a-z0-9-]+)\ndescription: ([\s\S]*?)\n---\n/.exec(text);
    expect(head, `.agents/skills/${SKILL_PREFIX}${name}/SKILL.md does not open with name: and description: frontmatter`).not.toBeNull();
    expect((head?.[2] ?? "").length, `.agents/skills/${SKILL_PREFIX}${name} has a description too short to route on`).toBeGreaterThan(120);
    // The name a skill routes on is the directory it is in.
    expect(head?.[1]).toBe(`${SKILL_PREFIX}${name}`);
  }
});

test("the framework's skill prefix is spelled the same here and in the rewrite that relies on it", async () => {
  const source = await readFile(HERE + "server/workspace/framework.ts", "utf8");
  const spelled = /export const SKILL_PREFIX = "([^"]+)"/.exec(source);
  expect(spelled?.[1]).toBe(SKILL_PREFIX);
});

/* ── the baseline the bad pages are one edit away from ──────────────────── */

test("a minimal compliant page reports nothing at all", () => {
  const report = check(page(html({})));
  expect(said(report)).toBe("");
  expect(report.artifacts).toEqual(["hero.html"]);
  expect(report.slots).toEqual(["hero.body"]);
  // The report says what the page is made of, and there is no `mode` left to
  // say: there is one sizing mode, so nothing branches on one.
  expect(report.sections).toBe(1);
  expect(report.defaults).toBe(0);
});

test("a page of nothing but the shipped default section draws, and says nothing", () => {
  const report = check({
    id: "rates-note",
    doc: withContents("  - name: intro", "    parts:", "      body: |", "        # Rates"),
    files: {},
  });
  expect([...rules(report)]).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.sections).toBe(1);
  expect(report.defaults).toBe(1);
  expect(report.artifacts).toEqual([]);
});

/** TWO SECTIONS MAY SHARE ONE FILE, and doing so is the point of a section being
 *  a file at all — a page with three bands of the same shape writes `band.html`
 *  once and names it three times. This was a bug found by fixture: the map from
 *  file to section held one value, so every section but the last fell out of R51
 *  entirely and the rule reported nothing on exactly the page that reuses its own
 *  layout. The file is READ once; the answer is shared out. */
test("two sections may name one file, and both are held to what it declares", () => {
  const doc = withContents(
    "  - name: one", "    data: band.html", "    parts:", "      body: One",
    "  - name: two", "    data: band.html", "    parts:", "      body: Two",
  );
  const clean = check({ id: "rates-note", doc, files: { "band.html": html({}) } });
  expect(said(clean)).toBe("");
  expect(clean.artifacts).toEqual(["band.html"]);
  expect(clean.slots).toEqual(["one.body", "two.body"]);

  // And the second section is held to the same file: a part with no slot in it
  // is a FAIL wherever it sits.
  const bad = check({
    id: "rates-note",
    doc: withContents(
      "  - name: one", "    data: band.html", "    parts:", "      body: One",
      "  - name: two", "    data: band.html", "    parts:", "      caption: Two",
    ),
    files: { "band.html": html({}) },
  });
  expect(rules(bad).has("R51")).toBe(true);
  expect(said(bad)).toContain("two.caption");
});

/* ── the vault format ───────────────────────────────────────────────────── */

test("R1 — a directory with no content.yaml is not a page", () => {
  const report = check({ id: "rates-note", doc: null, files: { "hero.html": html({}) } });
  expect(rules(report).has("R1")).toBe(true);
  expect(report.ok).toBe(false);
  // The premise never changed: a directory is a page if and only if it holds
  // one, and `content.yaml` is REQUIRED — the words, the sections and the name
  // that would have been in it exist nowhere else.
  expect(said(report)).toContain("content.yaml");
});

test("R1 — a document that will not parse is refused at the same door the host uses", () => {
  const report = check(page(html({}), "name: Rates\nplugin: biom-doc\ncontents:\n  - name: hero\n   data: hero.html\n"));
  expect(rules(report).has("R1")).toBe(true);
  expect(report.ok).toBe(false);
});

test("R1 — a page that is not a map, and a contents that is not a list", () => {
  expect(rules(check(page(html({}), "- hero\n"))).has("R1")).toBe(true);
  expect(rules(check(page(html({}), "name: Rates\nplugin: biom-doc\ncontents: hero\n"))).has("R1")).toBe(true);
  expect(rules(check(page(html({}), withContents("  - hero")))).has("R1")).toBe(true);
});

test("R1 — parts are a map of slot id to what goes in it, never a list", () => {
  const report = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:", "      - body: Hello",
  )));
  expect(rules(report).has("R1")).toBe(true);
  expect(report.ok).toBe(false);
});

/** R1 — WHICH READER DRAWS A PAGE. `plugin:` names it; leave it out and the page
 *  draws its own `index.html`. Everything besides the keys the host reads is
 *  that plugin's own input, and the host never validates it. */
test("R1 — plugin: names the reader, and a plugin page's own keys are its input", () => {
  // A doc page has a closed shape and an unknown key stops it parsing.
  expect(rules(check(page(html({}), "name: Rates\nplugin: biom-doc\nwidget: 3\n" + PAGE_YAML.slice("name: Rates\n".length)))).has("R1")).toBe(true);
  // A plugin declares what it reads, under `input:`, and the host has no way to
  // know whether one of its keys is missing — so they pass through unremarked.
  expect(said(check({
    id: "plants-board",
    doc: "name: Plants\nplugin: biom-kanban\ninput:\n  table: plants\n  lanes: status\n  name: species\n",
    // `index.html` is exempt from the stray-file rule: it IS the page, so no
    // document anywhere names it.
    files: { "index.html": "<main></main>" },
  }))).toBe("");
  // The name is a name.
  expect(rules(check(page(html({}), "name: Rates\nplugin: Doc\n"))).has("R1")).toBe(true);
  // `page:` was the list of plugins mounting on the whole page. One page, one
  // plugin now, so the old key is refused by name.
  expect(rules(check(page(html({}), "name: Rates\npage:\n  - plugin: progress\n" + PAGE_YAML.slice("name: Rates\n".length)))).has("R1")).toBe(true);
});

test("R6 — a directory name that is not a page segment", () => {
  expect(rules(check({ ...page(html({})), id: "Rates Note" })).has("R6")).toBe(true);
});

test("R6 — a section with no name, and a name the host cannot read", () => {
  expect(rules(check(page(html({}), withContents("  - data: hero.html")))).has("R6")).toBe(true);
  expect(rules(check(page(html({}), PAGE_YAML.replace("- name: hero", "- name: Hero One")))).has("R6")).toBe(true);
});

test("R6 — a slot id is written twice, as a key and as an attribute, so it is narrow", () => {
  const report = check({
    id: "rates-note",
    doc: withContents("  - name: hero", "    data: hero.html", "    parts:", "      Body One: Hello"),
    files: { "hero.html": html({ body: '<div data-g-part="Body One"></div>' }) },
  });
  expect(rules(report).has("R6")).toBe(true);
  expect(report.ok).toBe(false);
});

/* ── R47: the keys a page states itself ─────────────────────────────────── */

test("R47 — a page states its name and its contents", () => {
  const noName = check(page(html({}), PAGE_YAML.replace("name: Rates\n", "")));
  expect(rules(noName).has("R47")).toBe(true);
  // Advice on an ordinary page: the host falls back to the directory's own
  // segment, which is an id and not a title.
  expect(noName.ok).toBe(true);
  expect(said(noName)).toContain("directory");

  // ON A DOC PAGE, because `contents` is the doc plugin's input: on a page drawn
  // by anything else its absence is the correct shape rather than a lost spine.
  const noContents = check({ id: "rates-note", doc: "name: Rates\nplugin: biom-doc\n", files: {} });
  expect(rules(noContents).has("R47")).toBe(true);
  expect(noContents.ok).toBe(true);

  // Present and empty is the same fallback and gets the same word.
  expect(rules(check(page(html({}), PAGE_YAML.replace("name: Rates", 'name: ""')))).has("R47")).toBe(true);
});

test("R47 — a preset that omits one of them FAILS, because install copies the file verbatim", () => {
  const without = PAGE_YAML.replace("name: Rates\n", "");
  const preset: PageSource = {
    id: "kanban",
    doc: without,
    files: { "hero.html": html({}), "preset.yaml": "name: X\n" },
  };
  const report = check(preset);
  expect(rules(report).has("R47")).toBe(true);
  expect(report.ok).toBe(false);
  expect(said(report)).toContain("verbatim");
});

/* ── R48 and R49: what a slot's value is ────────────────────────────────── */

test("R48 — a slot's value is a string, which is markdown, or a map, which is a Content", () => {
  // A bare string is markdown, and so is a bare number: `body: 2026` is prose
  // that YAML happens to read as a value, and refusing it would be the checker
  // enforcing a quoting convention nothing else has.
  expect(said(check(page(html({}), withContents("  - name: hero", "    data: hero.html", "    parts:", "      body: 2026"))))).toBe("");

  // AND A LIST OF THOSE IS A LIST OF ITEMS, which is how a repeating thing is
  // written. It is still one slot with one id, so nothing else changes — except
  // that a list is a thing the reader must be able to add to, so the section
  // carries the `ctx.write` R59 asks for and R59 has its own test below.
  expect(said(check(page(html({ script: 'ctx.write("body", ctx.read("body"));' }), withContents("  - name: hero", "    data: hero.html", "    parts:", "      body: [a, b]"))))).toBe("");

  // A list of lists is not: an item is a value, and there is nothing a slot
  // could draw for a list drawn inside one of its own items.
  const nested = check(page(html({}), withContents("  - name: hero", "    data: hero.html", "    parts:", "      body: [[a, b]]")));
  expect(rules(nested).has("R48")).toBe(true);
  expect(nested.ok).toBe(false);

  const empty = check(page(html({}), withContents("  - name: hero", "    data: hero.html", "    parts:", "      body:")));
  expect(rules(empty).has("R48")).toBe(true);
});

test("R48 — a Content has no name: the key it sits under already states the slot's id", () => {
  const doc = withContents(
    "  - name: hero", "    data: hero.html", "    parts:",
    "      body:", "        name: body", "        type: markdown", "        data: Hello",
  );
  const report = check(page(html({}), doc));
  expect(rules(report).has("R48")).toBe(true);
  expect(report.ok).toBe(false);
  expect(said(report)).toContain("second statement");
  // And the server will not read it either — the key is refused, not dropped.
  expect(() => parse(doc)).toThrow();
});

test("R48 — a key a Content does not have is refused rather than dropped", () => {
  const doc = withContents(
    "  - name: hero", "    data: hero.html", "    parts:",
    "      body:", "        type: markdown", "        data: Hello", "        render: plain",
  );
  expect(rules(check(page(html({}), doc))).has("R48")).toBe(true);
  expect(() => parse(doc)).toThrow();
});

test("R49 — a part is markdown, html, table or child, and nothing else", () => {
  const untyped = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:", "      body:", "        data: Hello",
  )));
  expect(rules(untyped).has("R49")).toBe(true);
  expect(untyped.ok).toBe(false);

  // THERE IS NO DIAGRAM TYPE. A diagram is a drawing in the section's own
  // markup — HTML, like every other figure — or a fence a plugin
  // this workspace carries upgrades in place. Either way it is not a part kind.
  const drawn = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:", "      body:", "        type: diagram", "        data: shape",
  )));
  expect(rules(drawn).has("R49")).toBe(true);
  expect(said(drawn)).toContain("there is no diagram type");
});

test("R49 — a part's data is text, whatever the type reads it as", () => {
  const report = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:",
    "      body:", "        type: markdown", "        data: [a, b]",
  )));
  expect(rules(report).has("R49")).toBe(true);
  expect(report.ok).toBe(false);
});

/* ── R51: the parts and the data-g-parts are one set stated twice ───────── */

test("R51 — a part with no slot to go in is words nothing renders", () => {
  const report = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:", "      headline: Ship faster",
  )));
  expect(rules(report).has("R51")).toBe(true);
  expect(report.ok).toBe(false);
  expect(said(report)).toContain("hero.headline");
});

/** THE SHIPPED DEFAULT SECTION IS A FILE, NOT A BRANCH, so a section that took it
 *  is checked by the same rule as every other one — against the one slot that
 *  file has, which is called `body`. */
test("R51 — a section that took the shipped default is held to its one slot", () => {
  const report = check({
    id: "rates-note",
    doc: withContents("  - name: intro", "    parts:", "      headline: Ship faster"),
    files: {},
  });
  expect(rules(report).has("R51")).toBe(true);
  expect(said(report)).toContain("body");
  expect(report.ok).toBe(false);

  // And `body` on the same section is correct without a file anywhere.
  const good = check({ id: "rates-note", doc: withContents("  - name: intro", "    parts:", "      body: Hello"), files: {} });
  expect([...rules(good)]).toEqual([]);
});

/** THE TWO DIRECTIONS ARE NOT THE SAME SEVERITY, and the asymmetry is the rule
 *  rather than a softening of it: a part with no node never draws, while a slot
 *  the document has not filled is where the `+` goes in edit mode. Only a section
 *  where EVERY slot is unfilled is worth a word. */
test("R51 — a section that filled none of its slots is advised, not refused", () => {
  const report = check(page(html({}), withContents("  - name: hero", "    data: hero.html")));
  expect(rules(report).has("R51")).toBe(true);
  expect(report.ok).toBe(true);
  expect(said(report)).toContain("body");
});

test("R51 — an empty data-g-part, and a slot id the checker cannot read", () => {
  const blank = check(page(html({ body: '<div data-g-part=""></div>' })));
  expect(rules(blank).has("R51")).toBe(true);
  expect(blank.ok).toBe(false);

  // A computed id is legal and invisible: the checker says so rather than
  // reporting every part on the section as having no slot.
  const computed = check(page(html({ script: 'el.setAttribute("data-g-part", key);' })));
  expect(rules(computed).has("R51")).toBe(true);
  expect(computed.ok).toBe(true);

  // Walking your own slots with a selector is reading them, not declaring one.
  expect(said(check(page(html({ script: 'document.querySelectorAll("[data-g-part]");' }))))).toBe("");
});

test("R9 — one element per part", () => {
  const report = check(page(html({ body: '<div data-g-part="body"></div>\n<b data-g-part="body"></b>' })));
  expect(rules(report).has("R9")).toBe(true);
  expect(report.ok).toBe(false);
});

/* ── contents: the order, and what data means for each part type ────────── */

test("R40 — contents IS the order, and a section with nothing in it keeps its place", () => {
  const empty = check({ id: "rates-note", doc: withContents("  - name: intro"), files: {} });
  expect(rules(empty).has("R40")).toBe(true);
  // Advice, not a refusal: emptying a section is a RECOVERABLE act and deleting
  // it takes the words with it.
  expect(empty.ok).toBe(true);

  const noProse = check(page(html({}), withContents("  - name: hero", "    data: hero.html", "    parts:", '      body: ""')));
  expect(rules(noProse).has("R40")).toBe(true);

  const blankFile: PageSource = { id: "rates-note", doc: PAGE_YAML, files: { "hero.html": "\n" } };
  expect(rules(check(blankFile)).has("R40")).toBe(true);
});

test("R42 — a section naming markup that is not here falls back to the default", () => {
  const report = check({ id: "rates-note", doc: PAGE_YAML, files: {} });
  expect(rules(report).has("R42")).toBe(true);
  // The slots still draw and the words are still on screen, so the fault reads
  // as a section that lost its layout rather than a page that lost a section.
  expect(report.ok).toBe(true);
  expect(said(report)).toContain("hero.html");

  const notAFile = check(page(html({}), PAGE_YAML.replace("data: hero.html", "data: ../hero.html")));
  expect(rules(notAFile).has("R42")).toBe(true);
});

test("R42 — an html part naming a file that is not there draws an empty slot", () => {
  const report = check({
    id: "rates-note",
    doc: withContents(
      "  - name: hero", "    data: hero.html", "    parts:",
      "      body:", "        type: html", "        data: panel.html",
    ),
    files: { "hero.html": html({}) },
  });
  expect(rules(report).has("R42")).toBe(true);
  expect(report.ok).toBe(false);
  expect(said(report)).toContain("panel.html");
});

test("R42 — a markdown part whose data is a filename rather than prose", () => {
  const report = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:", "      body: intro.md",
  )));
  expect(rules(report).has("R42")).toBe(true);
  expect(report.ok).toBe(false);
});

test("R42 — a table part naming no table, and a child named by a path", () => {
  const table = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:",
    "      body:", "        type: table", '        data: ""',
  )));
  expect(rules(table).has("R42")).toBe(true);

  const child = check(page(html({}), withContents(
    "  - name: '@page-Notes'", "    parts:",
    "      body:", "        type: child", "        data: team/notes",
  )));
  expect(rules(child).has("R42")).toBe(true);
  expect(said(child)).toContain("one segment");
});

test("R42 — an html file on disk that nothing in the document names is invisible", () => {
  const report = check({ id: "rates-note", doc: PAGE_YAML, files: { "hero.html": html({}), "spare.html": html({}) } });
  expect(rules(report).has("R42")).toBe(true);
  expect(said(report)).toContain("spare.html");
  // The document is the only thing the host reads, so this is advice rather than
  // a refusal — the page draws exactly what it says it draws.
  expect(report.ok).toBe(true);
});

test("R43 — two sections cannot share a name", () => {
  const report = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    parts:", "      body: One",
    "  - name: hero", "    parts:", "      body: Two",
  )));
  expect(rules(report).has("R43")).toBe(true);
  expect(report.ok).toBe(false);
});

test("R44 — a variable is a scalar or a list of scalars, and nothing else", () => {
  const nested = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    variables:", "      rates:", "        ground: 62",
    "    parts:", "      body: Hello",
  )));
  expect(rules(nested).has("R44")).toBe(true);
  expect(nested.ok).toBe(false);

  const listOfMaps = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html", "    variables:", "      rows: [{a: 1}]",
    "    parts:", "      body: Hello",
  )));
  expect(rules(listOfMaps).has("R44")).toBe(true);

  // Parallel lists sharing a stem are the shape that replaces a nested one, and
  // they are correct.
  const parallel = check(page(html({}), withContents(
    "  - name: hero", "    data: hero.html",
    "    variables:", "      access: [Ground, Stairs]", "      factors: [1, 1.15]",
    "    parts:", "      body: '{{access}} at {{factors}}'",
  )));
  expect(rules(parallel).has("R44")).toBe(false);
});

test("R45 — the page's words are in content.yaml and nowhere else", () => {
  const withMd = check({ id: "rates-note", doc: PAGE_YAML, files: { "hero.html": html({}), "title.md": "# Rates\n" } });
  expect(rules(withMd).has("R45")).toBe(true);
  expect(withMd.ok).toBe(false);

  // `.mermaid` went the same way and for the same reason: the file kind was a
  // mechanism for a case the section that holds the drawing already covered.
  // The extension stays RETIRED rather than merely unused — an old page that
  // still carries one has words nothing will ever read.
  const withMermaid = check({ id: "rates-note", doc: PAGE_YAML, files: { "hero.html": html({}), "shape.mermaid": "graph TD\n" } });
  expect(rules(withMermaid).has("R45")).toBe(true);
});

/* ── variables and the templates that read them ─────────────────────────── */

test("R41 — the nearest one wins: the part's own values, then the section's, then the page's", () => {
  expect(said(check(prose("The base rate is {{rate}}.", { part: ["rate: 62"] })))).toBe("");
  expect(said(check(prose("The base rate is {{rate}}.", { section: ["rate: 62"] })))).toBe("");
  expect(said(check(prose("The base rate is {{rate}}.", { page: ["rate: 62"] })))).toBe("");
});

test("R41 — a name that resolves to nothing in scope", () => {
  const report = check(prose("The base rate is {{rate}}."));
  expect(rules(report).has("R41")).toBe(true);
  expect(report.ok).toBe(false);
  // Reaching another PAGE is a call and never a template, and the finding says
  // so rather than leaving the reader to guess at a syntax that does not exist.
  expect(said(report)).toContain("biom.variables");
});

/** THE CROSS-SLOT FORM IS GONE. `{{rate::calc}}` was a mechanism for a flat file
 *  where every value shared one dictionary; the scopes nest now, so it names
 *  nothing and the runtime leaves it on the page with its braces still on. */
test("R41 — the cross-slot form names nothing now, and is reported as the typo it is", () => {
  const report = check(prose("The heading is {{title::calc}}.", { part: ["title: Hello"] }));
  expect(rules(report).has("R41")).toBe(true);
  expect(said(report)).toContain("cross-slot");
});

test("R41 — braces holding something that is not a name at all", () => {
  expect(rules(check(prose("Rate: {{ rate * 2 }}."))).has("R41")).toBe(true);
});

/** A SECTION'S MARKUP IS INTERPOLATED TOO, as text and before it is parsed —
 *  which is the only way `<img alt="{{caption}}">` can work at all, because an
 *  attribute value is not a node and cannot be filled after the fact. */
test("R41 — a {{name}} in the markup resolves against the section, not against a part", () => {
  const doc = withContents(
    "  - name: hero", "    data: hero.html",
    "    variables:", "      caption: A photograph",
    "    parts:", "      body: Hello",
  );
  const good = check({
    id: "rates-note",
    doc,
    files: { "hero.html": html({ body: '<img alt="{{caption}}">\n<div data-g-part="body"></div>' }) },
  });
  expect(said(good)).toBe("");

  const bad = check({
    id: "rates-note",
    doc,
    files: { "hero.html": html({ body: '<img alt="{{captoin}}">\n<div data-g-part="body"></div>' }) },
  });
  expect(rules(bad).has("R41")).toBe(true);
});

test("R46 — a variable nothing in its scope reads is dead weight", () => {
  const report = check(prose("The base rate is {{rate}}.", { section: ["rate: 62", "spare: 12"] }));
  expect(rules(report).has("R46")).toBe(true);
  // Advice: it may be about to be used, and taking it out is the reader's call.
  expect(report.ok).toBe(true);
});

test("R46 — a section's SCRIPT reads its variables too, and `ctx.vars` is not a template", () => {
  // THE FIGURE IS LAID OUT FROM THE DOCUMENT'S OWN WORDS. A drawing whose nodes
  // and edges are variables never writes `{{nodes}}` anywhere — the script is
  // what turns the list into geometry — and left to the braces alone R46 called
  // every one of those dead, which is the warning that teaches somebody to
  // delete the diagram. `base/diagram/` is the shipped worked example.
  const drawn = check({
    id: "rates-note",
    doc: withContents(
      "  - name: shape", "    data: shape.html",
      "    variables:", "      nodes: [one, two]", "      edgeFrom: [one]", "      edgeTo: [two]",
      "    parts:", "      body: Prose beside it.",
    ),
    files: {
      "shape.html": html({
        script: "const v = ctx.vars; draw(v.nodes, v.edgeFrom, v[\"edgeTo\"]);",
      }),
    },
  });
  expect(rules(drawn).has("R46")).toBe(false);

  // And a variable the script does NOT name is still dead weight, which is the
  // half that keeps the rule worth having.
  const spare = check({
    id: "rates-note",
    doc: withContents(
      "  - name: shape", "    data: shape.html",
      "    variables:", "      nodes: [one, two]", "      spare: 12",
      "    parts:", "      body: Prose beside it.",
    ),
    files: { "shape.html": html({ script: "draw(ctx.vars.nodes);" }) },
  });
  expect(said(spare)).toContain('"spare"');
  expect(said(spare)).not.toContain('"nodes"');

  // A file that never reaches `ctx.vars` is read by the braces alone, exactly as
  // before — the allowance is for a script that genuinely asks for them.
  const quiet = check({
    id: "rates-note",
    doc: withContents(
      "  - name: shape", "    data: shape.html",
      "    variables:", "      nodes: [one, two]",
      "    parts:", "      body: Prose beside it.",
    ),
    files: { "shape.html": html({ script: "const nodes = 1;" }) },
  });
  expect(rules(quiet).has("R46")).toBe(true);
});

/* ── children ───────────────────────────────────────────────────────────────
 * There is no folder, so there is no folder rule. A CHILD IS WHAT A SLOT HOLDS —
 * a part of type `child` inside an ordinary section — and the section's name is
 * derived from the child rather than chosen, which is the only reason an entry
 * already placed can be left where it is. */

const CHILD_YAML = withContents(
  "  - name: hero", "    data: hero.html", "    parts:", "      body: Hello",
  "  - name: '@page-Notes'", "    parts:",
  "      body:", "        type: child", "        data: notes",
);

/** A page holding one child whose drawing has been replaced by a file of the
 *  parent's own. */
const desk = (child: string, doc = CHILD_YAML): PageSource => ({
  id: "team-desk",
  doc,
  files: { "hero.html": html({}), "@page-Notes.html": child },
});

const READS_CHILD = 'g.children().then((kids) => draw(kids.find((c) => "@" + c.kind + "-" + c.id === g.block)));';

test("a child drawing that reads its child reports nothing at all", () => {
  const report = check(desk(html({ body: '<div id="notes"></div>', script: READS_CHILD })));
  expect(said(report)).toBe("");
  expect(report.artifacts.sort()).toEqual(["@page-Notes.html", "hero.html"]);
});

test("a child part with no file beside it is the built-in drawing, not an empty section", () => {
  const noFile: PageSource = { id: "team-desk", doc: CHILD_YAML, files: { "hero.html": html({}) } };
  expect(said(check(noFile))).toBe("");
});

test("R38 — a file named for a child that hardcodes it instead of reading it", () => {
  const report = check(desk(html({ body: '<div id="notes"></div>' })));
  expect(rules(report).has("R38")).toBe(true);
  expect(report.ok).toBe(false);
});

test("R37 — a section name that starts with @ and is not a child key", () => {
  const report = check(page(html({}), PAGE_YAML.replace("- name: hero", "- name: '@notes'")));
  expect(rules(report).has("R37")).toBe(true);
  expect(report.ok).toBe(false);
});

test("R37 — a file that starts with @ and is not a child key", () => {
  const report = check({
    id: "team-desk",
    doc: PAGE_YAML,
    files: { "hero.html": html({}), "@folder-notes.html": html({ body: '<div id="notes"></div>', script: READS_CHILD }) },
  });
  expect(rules(report).has("R37")).toBe(true);
  expect(report.ok).toBe(false);
});

/* ── the default section is counted and never complained about ──────────── */

// THERE ARE TWO KINDS OF PAGE and a doc is one of them: its words are the point,
// and most of a document is the shipped default section. A rule against that
// measured the wrong thing — pointed at the strategy vault it warned on a
// hundred and forty-nine correct notes — so the count is reported and nothing
// is said about it. A page whose SHAPE is the point is `plugin: html`.
test("a page of nothing but default sections is a document, not a finding", () => {
  const report = check({
    id: "rates-note",
    doc: withContents(
      "  - name: intro", "    parts:", "      body: Hello",
      "  - name: outro", "    parts:", "      body: Bye",
    ),
    files: {},
  });
  expect([...rules(report)]).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.sections).toBe(2);
  // Still COUNTED, because a reader of the report wants to know.
  expect(report.defaults).toBe(2);

  const mixed = check(page(html({}), withContents(
    "  - name: intro", "    parts:", "      body: Hello",
    "  - name: hero", "    data: hero.html", "    parts:", "      body: Ship faster",
  )));
  expect(mixed.defaults).toBe(1);
});

/* ── R53: the workspace, not the page ───────────────────────────────────── */

/** A vault whose design language is still the one it shipped with. `pages` is
 *  true because R53 is about a workspace that has STARTED — one with nothing in
 *  it has not skipped its design work, it has not begun. */
const untouched = (): VaultSource => ({
  design: "name: Design\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body: Write this.\n",
  designFiles: [],
  theme: JSON.stringify({ palette: { name: "Biom" } }),
  pages: true,
  scale: null,
});

test("R53 — pages exist and the workspace never chose a palette or wrote its own design doc", () => {
  const found = checkVault(untouched());
  expect(found.map((f) => f.rule)).toEqual(["R53"]);
  expect(found[0]?.severity).toBe("WARN");
  expect(found[0]?.file).toBe("design/");
  expect(found[0]?.says).toContain("Biom");
});

test("R53 — the shipped palette it compares against is the one presets.ts actually ships", async () => {
  // A NAME RATHER THAN A DIGEST, and this is the join that keeps the copy honest:
  // `SHIPPED_PALETTE` in check.ts is a copy of `BRAND.name` in presets.ts, and
  // a rename on one side without the other silences R53 on every vault.
  const source = await readFile(HERE + "server/workspace/presets.ts", "utf8");
  const shippedName = /const BRAND: Palette = \{\s*\n\s*name: "([^"]+)"/.exec(source)?.[1];
  expect(shippedName, "presets.ts no longer declares BRAND with a name").toBeDefined();

  const vault = untouched();
  expect(checkVault({ ...vault, theme: JSON.stringify({ palette: { name: shippedName } }) })).not.toEqual([]);
  expect(checkVault({ ...vault, theme: JSON.stringify({ palette: { name: shippedName + " II" } }) })).toEqual([]);
});

test("R53 — either half of the work started is enough to silence it", () => {
  const vault = untouched();
  // A palette of the workspace's own.
  expect(checkVault({ ...vault, theme: JSON.stringify({ palette: { name: "Ashgrove" } }) })).toEqual([]);
  // A section file in design/ — the clearest sign somebody has written this
  // workspace's design rather than kept the one it was handed.
  expect(checkVault({ ...vault, designFiles: ["cover.html"] })).toEqual([]);
  // Or a design doc whose section names its own markup.
  expect(checkVault({ ...vault, design: "name: Design\nplugin: biom-doc\ncontents:\n  - name: cover\n    data: cover.html\n" })).toEqual([]);
  // A workspace with no pages in it has not skipped the work; it has not begun.
  expect(checkVault({ ...vault, pages: false })).toEqual([]);
});

test("R53 — the design doc a vault SHIPS with is not a design somebody did", () => {
  // The seeded `design/` draws: it carries a masthead, a specimen of the shipped
  // palette and three worlds, so it arrives with `.html` files of its own and
  // with sections naming them. If R53 read those as work, it would never fire
  // again on any vault — so both halves are compared BY NAME against the shipped
  // set, exactly as the palette is.
  const vault = untouched();
  const shipped = ["masthead.html", "default.html", "news.html", "paper.html", "panel.html"];
  const seeded: VaultSource = {
    ...vault,
    designFiles: shipped,
    design: "name: Design\nplugin: biom-doc\ncontents:\n" +
      shipped.map((f) => "  - name: " + f.replace(".html", "") + "\n    data: " + f + "\n").join(""),
  };
  expect(checkVault(seeded).map((f) => f.rule)).toEqual(["R53"]);
  // One file of the workspace's own is enough, beside every shipped one.
  expect(checkVault({ ...seeded, designFiles: [...shipped, "cover.html"] })).toEqual([]);
  // And so is one section naming markup that did not ship here.
  expect(checkVault({ ...seeded, design: seeded.design + "  - name: cover\n    data: cover.html\n" })).toEqual([]);
});

test("R53 — the shipped design files it compares against are the ones vault ships", async () => {
  // The same join the palette has, for the same reason: `SHIPPED_DESIGN` in
  // check.ts is a copy of what is on disk under vault/design/, and a
  // band renamed on one side without the other silences R53 on every vault.
  const doc = await readFile(HERE + "vault/design/content.yaml", "utf8");
  const named = [...doc.matchAll(/^\s*data:\s*(\S+)$/gm)].map((m) => m[1]!);
  expect(named.length).toBeGreaterThan(0);
  const seeded: VaultSource = { ...untouched(), designFiles: named };
  expect(checkVault(seeded).map((f) => f.rule)).toEqual(["R53"]);
});

test("R53 — a theme.json that will not parse is the server's finding, not this one", () => {
  // It falls back to the shipped palette and says so in its own log, so the
  // workspace reads as undesigned rather than as designed by accident.
  expect(checkVault({ ...untouched(), theme: "{ not json" }).map((f) => f.rule)).toEqual(["R53"]);
  // And a vault with no theme.json at all has certainly never chosen one.
  expect(checkVault({ ...untouched(), theme: null }).map((f) => f.rule)).toEqual(["R53"]);
});

test("R53 — a page handed over on its own says nothing about the workspace", () => {
  // `vault` is optional on a PageSource, and the whole point of that is that a
  // directory checked in isolation cannot be judged for a workspace nobody
  // looked at.
  expect(rules(check(page(html({}))))).not.toContain("R53");
  expect(rules(check({ ...page(html({})), vault: untouched() })).has("R53")).toBe(true);
});

/* ── R54 and R55: the markdown type scale ───────────────────────────────── */

/** A page with a `markdown.yaml` of its own beside `content.yaml`. The scale is
 *  NOT a page and is not shaped like one: it is elements at the top level, plus
 *  `measure`, which is the page's rather than any one element's. */
const scaled = (scale: string): PageSource => ({
  ...page(html({})),
  files: { "hero.html": html({}), "markdown.yaml": scale },
});

/** THE CHECKER AND THE PAGE READER ARE ONE WALK, and this is the assertion that
 *  says so. `scaleOf` drops what it cannot use and stays silent for the reader;
 *  handed an array it keeps the same list for the report. A checker with its own
 *  idea of the grammar would eventually send somebody to fix a line that draws
 *  perfectly well — so the scale this vault actually ships has to be silent. */
test("R54 — the house scale that ships is a scale the checker has nothing to say about", async () => {
  const shipped = await readFile(HERE + "vault/markdown.yaml", "utf8");
  const report = check(scaled(shipped));
  expect(rules(report).has("R54"), said(report)).toBe(false);
  expect(rules(report).has("R55")).toBe(false);
});

test("R54 — a line the reader threw away is reported, and the page still draws", () => {
  const report = check(scaled("h1: { size: enormous }\n"));
  expect(rules(report).has("R54")).toBe(true);
  expect(said(report)).toContain("h1.size");
  // A WARN and never a FAIL: the reader drops that one line, the rest of the
  // scale applies, and the heading comes out at the browser's own size.
  expect(report.fails).toBe(0);
  expect(report.ok).toBe(true);
  // Pointed at the element's line, because a property written inside a flow map
  // has no line of its own to point at.
  expect(report.findings.find((f) => f.rule === "R54")?.line).toBe(1);
});

test("R54 — an element nobody draws, a property nobody has, a role that is a font name", () => {
  for (const [scale, named] of [
    ["h7: { size: 1rem }\n", "h7"],
    ["h1: { colour: red }\n", "h1.colour"],
    // `face:` takes a ROLE and never a family, which is the same rule as the one
    // that keeps a colour out: a scale may not pin a page to something the
    // workspace does not use.
    ["p: { face: Georgia }\n", "p.face"],
    ["measure: wide\n", "measure"],
  ] as const) {
    const report = check(scaled(scale));
    expect(rules(report).has("R54"), `${scale.trim()} is not reported`).toBe(true);
    expect(said(report)).toContain(named);
  }
  // And a scale that is not a map of elements at all loses everything in it,
  // which is still not fatal — the page draws as if the file were not there.
  const listed = check(scaled("- h1\n- h2\n"));
  expect(rules(listed).has("R54")).toBe(true);
  expect(listed.ok).toBe(true);
});

/** THE ONE LOUD ONE. A file that will not parse is not a dropped line, it is the
 *  whole scale gone in silence — every property somebody wrote, absent, with the
 *  page looking exactly as it would with no scale at all. */
test("R55 — a type scale that does not parse at all is a FAIL", () => {
  const report = check(scaled("h1:\n  size: 2rem\n   weight: 600\n"));
  expect(rules(report).has("R55")).toBe(true);
  expect(report.ok).toBe(false);
  expect(report.findings.find((f) => f.rule === "R55")?.line).toBeGreaterThan(0);
  // One finding and not two: nothing was read, so there is nothing to warn about
  // line by line.
  expect(rules(report).has("R54")).toBe(false);
});

test("a page with no markdown.yaml is the ordinary case and never a finding", () => {
  // Every property is optional and so is the file. Delete it and the workspace
  // looks exactly as it did before, so its absence cannot be a report.
  expect([...rules(check(page(html({}))))]).toEqual([]);
});

/** THE HOUSE SCALE IS THE WORKSPACE'S, so it is said once at the end of a run
 *  rather than once per page — the same argument R53 is here for. */
test("R54 and R55 — the workspace's own scale is checked with the workspace", () => {
  const said54 = checkVault({ ...untouched(), scale: "h1: { size: enormous }\n" });
  expect(said54.map((f) => f.rule)).toEqual(["R54", "R53"]);
  expect(said54[0]?.file).toBe("markdown.yaml");

  const broken = checkVault({ ...untouched(), scale: "h1:\n  size: 2rem\n   weight: 600\n" });
  expect(broken.map((f) => f.rule)).toEqual(["R55", "R53"]);

  // A workspace with nothing in `pages/` has still written its scale wrong, and
  // is still told — the two rules are independent of the one below them.
  expect(checkVault({ ...untouched(), pages: false, scale: "h7: {}\n" }).map((f) => f.rule)).toEqual(["R54"]);
  // And a house scale that reads is silent.
  expect(checkVault({ ...untouched(), scale: "measure: 34rem\n" }).map((f) => f.rule)).toEqual(["R53"]);
});

test("readVault reads the house scale off disk, and checkVault reports it", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-scale-"));
  try {
    await mkdir(join(root, "pages", "home"), { recursive: true });
    await writeFile(join(root, "theme.json"), JSON.stringify({ palette: { name: "Ashgrove" } }));
    await writeFile(join(root, "markdown.yaml"), "h1: { size: enormous }\n");

    const source = await readVault(root);
    expect(source.scale).toContain("enormous");
    // The palette is the workspace's own, so R53 is quiet and the scale is all
    // that is left to say.
    expect(checkVault(source).map((f) => f.rule)).toEqual(["R54"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ── the host surface ───────────────────────────────────────────────────── */

/** ONE BAD PAGE PER BAN, and there is a ban here for every entry in check.ts's
 *  own table. A rule with no fixture is a rule nobody has ever watched fire, and
 *  a checker that reports nothing reads exactly like a pass. */
const banned: [string, string][] = [
  ["R13", 'localStorage.setItem("a", "b");'],
  ["R13", "sessionStorage.clear();"],
  ["R13", "indexedDB.open(name);"],
  ["R13", 'document.cookie = "a=b";'],
  ["R13", 'caches.open("v1");'],
  ["R14", 'fetch("https://example.com");'],
  ["R14", "new XMLHttpRequest();"],
  ["R14", 'new WebSocket("wss://example.com");'],
  ["R14", 'new EventSource("/stream");'],
  ["R14", "navigator.sendBeacon(url, body);"],
  ["R15", 'window.parent.postMessage({}, "*");'],
  ["R15", 'parent.postMessage({}, "*");'],
  ["R15", "const r = document.referrer;"],
  ["R17", 'eval("1 + 1");'],
  ["R17", 'new Function("return 1");'],
  ["R17", 'document.write("<p>");'],
  ["R19", 'biom.sql("SELECT 1");'],
  // The house shape aliases the shim — `const g = window.biom` is what
  // every worked section does — so a rule that only fired on the long spelling
  // is a rule that never fires. R38 is matched on `.children(` for exactly this
  // reason.
  ["R19", 'g.sql("SELECT 1");'],
  ["R20", "if (navigator.userAgent) draw();"],
  ["R21", "node.innerHTML = value;"],
  ["R21", "node.outerHTML = value;"],
  ["R21", "node.insertAdjacentHTML(where, value);"],
  ["R24", "if (window.innerWidth > 600) draw();"],
  ["R24", "if (screen.width > 600) draw();"],
  ["R24", 'matchMedia("(min-width: 40rem)");'],
  // R29 from script. A section can do far more than a block could, so there is
  // more script here to set an inline style in.
  ["R29", 'node.style.cssText = "color: red";'],
  ["R29", 'node.style.display = "none";'],
];

for (const [rule, line] of banned) {
  test(`${rule} — ${line}`, () => {
    expect(rules(check(page(html({ script: line })))).has(rule)).toBe(true);
  });
}

/** THE SAME BANS, SPELLED THROUGH THE GLOBAL OBJECT.
 *
 * A rule that matched only the bare identifier missed `window.fetch(...)` — the
 * exact call R14's own sentence names — because a dotted form is not a bare one.
 * That is worse than having no rule: a checker is trusted, so a false negative
 * reads as approval. */
const dotted: [string, string][] = [
  ["R13", 'window.localStorage.setItem("a", "b");'],
  ["R13", "globalThis.sessionStorage.clear();"],
  ["R13", "self.indexedDB.open(name);"],
  ["R13", 'window.caches.open("v1");'],
  ["R14", 'window.fetch("https://example.com");'],
  ["R14", 'globalThis.fetch("https://example.com");'],
  ["R14", 'self.fetch("https://example.com");'],
  ["R14", "new window.XMLHttpRequest();"],
  ["R14", 'new globalThis.WebSocket("wss://example.com");'],
  ["R14", 'new self.EventSource("/stream");'],
  ["R14", "window.navigator.sendBeacon(url, body);"],
  ["R15", 'globalThis.parent.postMessage({}, "*");'],
  ["R15", "self.top.location;"],
  ["R17", 'window.eval("1 + 1");'],
  ["R17", 'globalThis.eval("1 + 1");'],
  ["R17", 'new window.Function("return 1");'],
  ["R17", 'window.document.write("<p>");'],
  ["R20", "if (window.navigator.userAgent) draw();"],
  ["R24", "if (window.outerWidth > 600) draw();"],
  ["R24", "if (globalThis.screen.availWidth > 600) draw();"],
  ["R24", 'window.matchMedia("(min-width: 40rem)");'],
];

for (const [rule, line] of dotted) {
  test(`${rule} — ${line}`, () => {
    expect(rules(check(page(html({ script: line })))).has(rule)).toBe(true);
  });
}

test("R14 — the shim's own fetch is the sanctioned way out, however the shim is named", () => {
  expect(said(check(page(html({ script: 'biom.fetch("https://example.com");' }))))).toBe("");
  expect(said(check(page(html({ script: "const g = window.biom;\ng.fetch(url);" }))))).toBe("");
});

test("R14 — a banned name inside a comment or a string is not a finding", () => {
  const report = check(page(html({ script: '// never call fetch(url)\nconst why = "no localStorage in here";' })));
  expect(said(report)).toBe("");
});

test("R16 — a section is one file", () => {
  expect(rules(check(page(html({ head: '<script src="/x.js"></' + "script>" })))).has("R16")).toBe(true);
  expect(rules(check(page(html({ head: '<link rel="stylesheet" href="/host/artifact.css">' })))).has("R16")).toBe(true);
  expect(rules(check(page(html({ style: '@import url("/x.css");' })))).has("R16")).toBe(true);
  expect(rules(check(page(html({ script: 'import("https://example.com/x.js");' })))).has("R16")).toBe(true);
});

test("R35 — /vendor/ is the host handing you a library, and a module build never loads", () => {
  const classic = check(page(html({ head: '<script src="/vendor/three.min.js"></' + "script>" })));
  expect(rules(classic).has("R35")).toBe(true);
  expect(classic.ok).toBe(true); // wasteful, not wrong

  const module = check(page(html({ head: '<script type="module" src="/vendor/three.min.js"></' + "script>" })));
  expect(rules(module).has("R35")).toBe(true);
  expect(module.ok).toBe(false);
});

test("R18 — an inline handler", () => {
  const report = check(page(html({ body: '<div data-g-part="body" onclick="go()"></div>' })));
  expect(rules(report).has("R18")).toBe(true);
  expect(report.ok).toBe(false);
});

test("R23 — a top-level await is legal; DOMContentLoaded in a section script never fires", () => {
  expect(said(check(page(html({ script: "const data = await biom.table('jobs');" }))))).toBe("");

  // The runtime clones every section script into a fresh node at draw time,
  // which is long after DOMContentLoaded fired — so the listener never runs and
  // everything inside it is dead.
  const listened = check(page(html({ script: 'document.addEventListener("DOMContentLoaded", draw);' })));
  expect(rules(listened).has("R23")).toBe(true);
});

/* ── the one sizing mode ────────────────────────────────────────────────────
 * R22 AND R27 INVERTED. There is ONE frame per page, it is handed the canvas,
 * and it scrolls inside itself — so a viewport length, `height: 100%` and
 * `position: fixed` all mean what an author writing them expects. The numbers
 * stayed spent rather than being rewritten, because a finding cites its number
 * and R22 already means something to every report that carries it. */

test("a viewport length, height: 100% and position: fixed are correct in a section now", () => {
  expect(said(check(page(html({ style: ".band { min-height: 60vh }" }))))).toBe("");
  expect(said(check(page(html({ style: "html, body { height: 100% }" }))))).toBe("");
  expect(said(check(page(html({ style: ".band-top { position: fixed; inset-block-start: 0 }" }))))).toBe("");
  // And there is no `[data-g-fill]` guard left to write, because there is no
  // second mount for a file to have to tell itself apart in.
  expect(said(check(page(html({ style: ".band { block-size: 100dvh }" }))))).toBe("");
});

/* ── sizing across viewports ────────────────────────────────────────────── */

test("R25 — a fixed width in px", () => {
  const report = check(page(html({ style: ".band { width: 640px }" })));
  expect(rules(report).has("R25")).toBe(true);
  expect(report.ok).toBe(false);
  expect(rules(check(page(html({ body: '<div width="640"><div data-g-part="body"></div></div>' })))).has("R25")).toBe(true);
});

test("R25 — a length in px small enough to be an icon is not a layout decision", () => {
  expect(said(check(page(html({ style: ".band-mark { width: 12px }" }))))).toBe("");
});

test("R26 — a measure written in px", () => {
  expect(rules(check(page(html({ style: ".band-prose { max-width: 640px }" })))).has("R26")).toBe(true);
});

test("R28 — a table with nothing to scroll it", () => {
  const report = check(page(html({ body: '<div data-g-part="body"></div>\n<table><tbody></tbody></table>' })));
  expect(rules(report).has("R28")).toBe(true);
});

/* ── the house style ────────────────────────────────────────────────────── */

test("R29 — an inline style, in markup and from script", () => {
  expect(rules(check(page(html({ body: '<div data-g-part="body" style="color: red"></div>' })))).has("R29")).toBe(true);
  expect(rules(check(page(html({ script: 'node.setAttribute("style", "display:none");' })))).has("R29")).toBe(true);
  expect(rules(check(page(html({ script: 'node.style.setProperty("display", "none");' })))).has("R29")).toBe(true);
});

/** SETTING A CUSTOM PROPERTY IS THE ONE THING SCRIPT MAY WRITE onto an element's
 *  style: it is how a value computed at runtime reaches the stylesheet without a
 *  literal being written anywhere. */
test("R29 — setProperty on a custom property is the one exception", () => {
  expect(said(check(page(html({ script: 'node.style.setProperty("--accent", "var(--cyan)");' }))))).toBe("");
});

test("R30 — a raw colour, however it is spelled", () => {
  expect(rules(check(page(html({ style: ".band { color: #ff0055 }" })))).has("R30")).toBe(true);
  expect(rules(check(page(html({ style: ".band { background: rgb(20 20 20) }" })))).has("R30")).toBe(true);
  expect(rules(check(page(html({ style: ".band { border: 1px solid black }" })))).has("R30")).toBe(true);
  // A custom property is not a hiding place: the palette routed around one
  // indirection further out is still the palette routed around.
  expect(rules(check(page(html({ style: ".band { --panel: whitesmoke; background: var(--panel) }" })))).has("R30")).toBe(true);
  // And markup paints too — an inline SVG never reaches the stylesheet.
  expect(rules(check(page(html({ body: '<svg><circle fill="crimson"/></svg>\n<div data-g-part="body"></div>' })))).has("R30")).toBe(true);

  // A token, and a tint built from one, are the whole point.
  expect(said(check(page(html({ style: ".band { color: var(--ink); background: color-mix(in srgb, var(--cyan) 12%, transparent) }" }))))).toBe("");
});

test("R31 — a button with no type", () => {
  expect(rules(check(page(html({ body: '<div data-g-part="body"></div>\n<button id="go">Go</button>' })))).has("R31")).toBe(true);
});

test("R32 — a control nobody can name", () => {
  expect(rules(check(page(html({ body: '<div data-g-part="body"></div>\n<input id="area" type="number">' })))).has("R32")).toBe(true);
  const named = check(page(html({ body: '<div data-g-part="body"></div>\n<label for="area">Area</label>\n<input id="area" type="number">' })));
  expect(rules(named).has("R32")).toBe(false);
});

test("R33 — formatting a diff can read", () => {
  expect(rules(check(page(html({}).replace(/\n/g, "\r\n")))).has("R33")).toBe(true);
  expect(rules(check(page(html({}).trimEnd()))).has("R33")).toBe(true);
  expect(rules(check(page(html({ body: '<div>\n\t<div data-g-part="body"></div>\n</div>' })))).has("R33")).toBe(true);
  expect(rules(check(page(html({ style: "</" + "style>\n<style>\n.band { color: var(--ink) }" })))).has("R33")).toBe(true);
});

/* ── R56: the markup carries no words ───────────────────────────────────── */

/** THE RULE IS A CONSEQUENCE OF `edit.js` AND NOT A TASTE. A markdown part is
 *  the only region that opens under the caret, so a word written into a section
 *  file is a word nobody can ever edit in the app. It is a WARN because the page
 *  still draws and still reads — what is missing is the ability to change it —
 *  and the answer is a slot plus a `parts` entry rather than a rewrite.
 *
 *  THE NEGATIVE CONTROLS ARE THE HALF THAT MATTERS. A rule that fires on correct
 *  work teaches people to stop reading the report, which is how R34 died, so
 *  every hiding pass has a test that proves it hides: a comment, a `<style>`, a
 *  `<script>`, an `<svg>` — the deliberate artwork exception — and `{{name}}`,
 *  which is already something a person can change without opening the file. */
test("R56 — a word in a section file is a word nobody can edit", () => {
  const report = check(page(html({ body: '<div class="band"><h1>We shipped on time</h1><div data-g-part="body"></div></div>' })));
  expect(rules(report).has("R56")).toBe(true);
  // A WARN and never a FAIL: the page draws, and the words are on screen.
  expect(report.ok).toBe(true);
  // The finding names what it found, or it is a scolding rather than a fix.
  expect(said(report)).toContain("We shipped on time");
});

test("R56 — one finding per file, however many runs are in it", () => {
  const many = '<p>One</p>\n<p>Two</p>\n<p>Three</p>\n<p>Four</p>';
  const report = check(page(html({ body: many })));
  expect(report.findings.filter((f) => f.rule === "R56")).toHaveLength(1);
  // Three quoted, and the rest counted, so the report stays readable.
  expect(said(report)).toContain("and 1 more");
});

test("R56 — text inside an <svg> is the drawing, and is never a finding", () => {
  const chart = [
    '<div class="plate">',
    '  <svg viewBox="0 0 100 40" role="img" aria-label="Revenue by quarter">',
    "    <title>Revenue by quarter</title>",
    '    <text x="4" y="36">Q1</text>',
    '    <text x="52" y="36">Q2</text>',
    "  </svg>",
    "</div>",
    '<div data-g-part="body"></div>',
  ].join("\n");
  expect(rules(check(page(html({ body: chart })))).has("R56")).toBe(false);
});

test("R56 — a control's label is furniture, and is never a finding", () => {
  // WITHOUT THIS EVERY CONTROL A SECTION DRAWS HAD TO BE A BARE GLYPH, which is
  // the "three unlabelled marks in a corner" a page's own add and delete must
  // not be — and the add and the delete are not optional any more, R59 asks for
  // them. A button's label is furniture in exactly the sense `aria-label` and
  // `title` already were: nobody wants to click into "Delete this column" and
  // rewrite it, and putting it in content.yaml makes a section's own chrome a
  // thing the page can lose.
  const controls = '<div data-g-part="body"></div>'
    + '<button type="button" data-add>Another question</button>'
    + "<details><summary>What is on the wall</summary></details>";
  expect(rules(check(page(html({ body: controls })))).has("R56")).toBe(false);

  // And the exemption is the control, not the neighbourhood: a word outside it
  // in the same file is still a word nobody can edit.
  const leaked = controls + "<p>Four routes came off on Thursday.</p>";
  expect(rules(check(page(html({ body: leaked })))).has("R56")).toBe(true);
});

test("R56 — a nested <svg> does not release the outer one early", () => {
  const nested = '<svg><svg><text x="0" y="0">inner</text></svg><text x="0" y="8">outer</text></svg>';
  expect(rules(check(page(html({ body: nested })))).has("R56")).toBe(false);
});

test("R56 — comments, style and script are not words on the page", () => {
  const quiet = [
    "<!-- A band for the quarter's headline figures. Copy it and change the grid. -->",
    '<div class="band"><div data-g-part="body"></div></div>',
  ].join("\n");
  expect(rules(check(page(html({ body: quiet, style: '.band::after { content: " rows" }', script: 'const label = "Total";' })))).has("R56")).toBe(false);
});

test("R56 — whitespace, entities and decoration are not words", () => {
  const dressing = '<div class="rule">&mdash;</div>\n<div class="sep">&#183; &rarr;</div>\n<div data-g-part="body"></div>';
  expect(rules(check(page(html({ body: dressing })))).has("R56")).toBe(false);
});

test("R56 — a {{name}} in the markup is already editable, and is not a word here", () => {
  const doc = PAGE_YAML.replace("contents:", "variables:\n  quarter: Q3\ncontents:");
  const report = check(page(html({ body: '<div class="tag">{{quarter}}</div>\n<div data-g-part="body"></div>' }), doc));
  expect(rules(report).has("R56")).toBe(false);
});

/* R34 STOOD HERE and is retired, so there is no fixture for it. It WARNed on a
 * section file that had not assigned `biom.toMarkdown` — a PAGE-wide hook,
 * checked once per section FILE, so a six-section page collected six warnings
 * for a thing it can only do once and five of six assignments would have lost
 * silently. It fired on correct work, which is the one thing a checker must not
 * do. The number stays spent; whatever replaces it belongs to the runtime, which
 * owns the page, and takes a new one. */

/* ── reading a page off disk ────────────────────────────────────────────── */

/** A page directory on disk, cleaned up afterwards however the body ends. */
async function onDisk(id: string, files: Record<string, string>, body: (dir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "biom-page-"));
  // The directory name IS one segment of the page id, so the page lives one
  // level in: a temporary directory's own name is not one.
  const dir = join(root, id);
  try {
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), text);
    }
    await body(dir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("checkDir reads a page directory and never walks into children/", async () => {
  await onDisk("rates-note", {
    "content.yaml": PAGE_YAML,
    "hero.html": html({}),
    // A child is a page of its own and is checked as one. Reading its files as
    // this page's would report every child's markup against this page's
    // variables — several failures on a file the page never wrote.
    "children/notes/content.yaml": "name: Notes\nplugin: biom-doc\ncontents: []\n",
    "children/notes/hero.html": html({ style: ".band { color: red }" }),
  }, async (dir) => {
    const report = await checkDir(dir);
    expect(said(report)).toBe("");
    expect(report.artifacts).toEqual(["hero.html"]);
  });
});

/** `_assets/` IS THE ONE DIRECTORY THAT IS READ, one level down. An `html` part
 *  may name `_assets/<file>` and the server will find it, so a checker that could
 *  not see in there reported every one of them as a file that is not in this
 *  directory — a FAIL on a page that was right. Found by fixture, not by
 *  reasoning, which is why it is pinned here. */
test("checkDir walks _assets/, because an html part may name a file inside it", async () => {
  await onDisk("rates-note", {
    "content.yaml": withContents(
      "  - name: hero", "    data: hero.html", "    parts:",
      "      body:", "        type: html", "        data: _assets/panel.html",
    ) ,
    "hero.html": html({}),
    "_assets/panel.html": html({ body: '<div class="panel"></div>' }),
  }, async (dir) => {
    const report = await checkDir(dir);
    expect(said(report)).toBe("");
    expect(report.artifacts.sort()).toEqual(["_assets/panel.html", "hero.html"]);
  });
});

test("checkDir finds the old format's files, or R45 could never fire", async () => {
  await onDisk("rates-note", {
    "content.yaml": PAGE_YAML,
    "hero.html": html({}),
    "title.md": "# Rates\n",
  }, async (dir) => {
    const report = await checkDir(dir);
    expect(rules(report).has("R45")).toBe(true);
    expect(said(report)).toContain("title.md");
  });
});

test("a missing directory is a finding rather than a throw", async () => {
  const report = await checkDir(HERE + "vault/base/there-is-no-such-block");
  expect(report.ok).toBe(false);
  expect(rules(report).has("R1")).toBe(true);
  expect(report.sections).toBe(0);
  expect(report.defaults).toBe(0);
});

/* ── the workspace a page sits in ───────────────────────────────────────── */

test("findVault walks up to pages/ beside theme.json, and stops rather than guessing", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-vault-"));
  try {
    const deep = join(root, "vault", "pages", "home", "children", "Notes");
    await mkdir(deep, { recursive: true });
    await mkdir(join(root, "vault", "design"), { recursive: true });
    await writeFile(join(root, "vault", "theme.json"), JSON.stringify({ palette: { name: "Biom" } }));
    await writeFile(join(root, "vault", "design", "content.yaml"), "name: Design\nplugin: biom-doc\ncontents: []\n");

    expect(await findVault(deep)).toBe(join(root, "vault"));
    // A directory that is not in a workspace costs one walk and no findings,
    // which is why R53 says nothing about a page handed over on its own.
    expect(await findVault(root)).toBeNull();

    const source = await readVault(join(root, "vault"));
    expect(source.pages).toBe(true);
    expect(source.design).toContain("name: Design");
    expect(source.designFiles).toEqual([]);
    expect(checkVault(source).map((f) => f.rule)).toEqual(["R53"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readVault treats every part of a workspace as optional", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-bare-"));
  try {
    const source = await readVault(root);
    // `scale` joined this shape when `markdown.yaml` arrived, and it is as
    // optional as everything else here: a workspace with no type scale is one
    // that never wrote one, which is not a finding.
    expect(source).toEqual({ design: null, designFiles: [], theme: null, pages: false, scale: null, plugins: null, shipped: {} });
    // A vault that has not been seeded yet is not a vault that skipped its
    // design work.
    expect(checkVault(source)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ── plugin folders: R65 to R68 ─────────────────────────────────────────── */

/** A vault on disk with a `plugins/` shaped as given, a mirror in
 *  `docs/plugins/` holding the framework's `biom-doc` — its contract and a
 *  document — and one page carrying its own `plugins/`. */
async function pluginVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "biom-plugfold-"));
  const seed: Record<string, string> = {
    "theme.json": JSON.stringify({ palette: { name: "Biom" } }),
    "design/content.yaml": "name: Design\nplugin: biom-doc\ncontents: []\n",
    "docs/plugins/biom-doc/plugin.yaml": "head:\nfoot: biom-holds\nrows: false\n",
    "docs/plugins/biom-doc/index.html": FRAMEWORK_DOC,
    "docs/plugins/biom-doc/plugins/biom-holds/holds.js": "",
    "docs/plugins/biom-doc/plugins/biom-holds/plugin.yaml": "sort: name\n",
    "pages/home/content.yaml": "name: Home\nplugin: biom-doc\ncontents: []\n",
  };
  for (const [rel, text] of Object.entries({ ...seed, ...files })) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), text);
  }
  return root;
}

/** An invented framework document, long enough for a copy to be told from a
 *  document somebody wrote themselves. */
const FRAMEWORK_DOC = "<!doctype html>\n<html>\n<head>\n<title>Document</title>\n<style>\n" +
  Array.from({ length: 30 }, (_, i) => "  .frame-rule-" + String(i) + " { margin-block: " + String(i) + "rem; }").join("\n") +
  "\n</style>\n</head>\n<body><header id=\"g-head\"></header><main id=\"g-page\"></main><footer id=\"g-foot\"></footer></body>\n</html>\n";

test("R65 to R68 — the folder shape, a rung naming nothing, and the copy a warning is for, once for the vault", async () => {
  const root = await pluginVault({
    // R65: the old shape, and a folder that is not an id.
    "plugins/reveal.js": "",
    "plugins/My Plugin/x.js": "",
    // R66: an extension folder holding more than its rung.
    "plugins/biom-doc/extensions.yaml": "head: board-look\nsort: date\n",
    "plugins/biom-doc/index.html": "<main></main>",
    "plugins/biom-doc/doc.js": "",
    // R67: a rung over nothing, and one over the vault's own plugin's contract.
    "plugins/biom-nothing/extensions.yaml": "x: 1\n",
    "plugins/board-look/board-look.js": "",
    "plugins/board-look/plugin.yaml": "dots: true\n",
    "plugins/board-look/extensions.yaml": "dots: false\nsize: 3\n",
    // R68: a bare-named copy of the framework's document, and a document of
    // the workspace's own that shares nothing with it.
    "plugins/doc/index.html": FRAMEWORK_DOC.replace("Document", "Mine"),
    "plugins/timeline/index.html": "<!doctype html>\n<html><head><title>Timeline</title></head><body><main id=\"g-timeline\"></main></body></html>\n",
    // The inner plugin's contract is reached by the framework's prefix rule.
    "plugins/biom-holds/extensions.yaml": "sort: date\norder: up\n",
  });
  try {
    const source = await readVault(root);
    expect(source.plugins?.loose).toEqual(["reveal.js"]);
    expect(Object.keys(source.shipped ?? {}).sort()).toEqual(["biom-doc", "biom-holds"]);
    const found = checkVault(source).filter((f) => f.rule !== "R53");
    const by = (rule: string) => found.filter((f) => f.rule === rule).map((f) => f.file + " · " + f.says);
    expect(by("R65")).toEqual([
      "plugins/reveal.js · reveal.js is a loose script and nothing loads it — a plugin is a folder. mkdir plugins/reveal && mv plugins/reveal.js plugins/reveal/ is the whole fix.",
      "plugins/My Plugin/ · My Plugin/ is not a plugin folder — a plugin's folder is its id: lowercase letters, digits and dashes.",
    ]);
    expect(by("R66").map((s) => s.split(" · ")[0])).toEqual(["plugins/biom-doc/doc.js", "plugins/biom-doc/index.html"]);
    expect(by("R66")[1]).toContain("plugins/doc/, and every page saying plugin: doc draws with it");
    expect(by("R67")).toEqual([
      'plugins/biom-doc/extensions.yaml · plugins/biom-doc/extensions.yaml names "sort", which biom-doc does not declare — its plugin.yaml holds head, foot, rows. A key the plugin does not read draws nothing.',
      'plugins/biom-holds/extensions.yaml · plugins/biom-holds/extensions.yaml names "order", which biom-holds does not declare — its plugin.yaml holds sort. A key the plugin does not read draws nothing.',
      'plugins/biom-nothing/extensions.yaml · plugins/biom-nothing/extensions.yaml extends "biom-nothing", which declares no plugin.yaml — there is nothing to extend. Is the id spelled as the framework spells it? docs/plugins/ lists the framework\'s.',
      'plugins/board-look/extensions.yaml · plugins/board-look/extensions.yaml names "size", which board-look does not declare — its plugin.yaml holds dots. A key the plugin does not read draws nothing.',
    ]);
    const copies = by("R68");
    expect(copies).toHaveLength(1);
    expect(copies[0]).toContain("plugins/doc/index.html is shaped like the framework's own document");
    expect(copies[0]).toContain("plugins/biom-doc/extensions.yaml follows every release");
    expect(found.every((f) => (f.rule === "R68" ? f.severity === "WARN" : f.severity === "FAIL"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("without the mirror a rung over a framework plugin is not a FAIL: R67 skips the framework's side and says once why", async () => {
  const root = await pluginVault({
    "plugins/biom-doc/extensions.yaml": "head: board-look\nsort: date\n",
    "plugins/board-look/board-look.js": "",
    "plugins/board-look/plugin.yaml": "dots: true\n",
    "plugins/board-look/extensions.yaml": "size: 3\n",
  });
  try {
    await rm(join(root, "docs"), { recursive: true, force: true });
    const source = await readVault(root);
    expect(source.shipped).toEqual({});
    const found = checkVault(source).filter((f) => f.rule === "R67");
    // The vault's own contract is still held to — the checker can read that
    // one — and the framework's rung earns one WARN naming the mirror rather
    // than a FAIL naming a typo it cannot see.
    expect(found.map((f) => [f.severity, f.file])).toEqual([
      ["FAIL", "plugins/board-look/extensions.yaml"],
      ["WARN", "docs/plugins/"],
    ]);
    expect(found[1]?.says).toContain("plugins/biom-doc/extensions.yaml cannot be held against what the framework declares");
    // A page's rung the same way, through the CLI's path.
    const page = await checkDir(join(root, "pages", "home"), null, contractsOf(source));
    expect(page.findings.filter((f) => f.rule === "R67")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a page's own plugins/ takes R65 to R67 against the contracts the vault knows, and R68 does not apply there", async () => {
  const root = await pluginVault({
    "pages/home/children/notes/content.yaml": "name: Notes\nplugin: biom-doc\ncontents: []\n",
    "pages/home/children/notes/plugins/loose.js": "",
    "pages/home/children/notes/plugins/biom-doc/extensions.yaml": "foot:\nrows: true\ntypo: 1\n",
    "pages/home/children/notes/plugins/biom-doc/doc.js": "",
    "pages/home/children/notes/plugins/doc/index.html": FRAMEWORK_DOC,
    "pages/home/children/notes/plugins/own/own.js": "",
    "pages/home/children/notes/plugins/own/plugin.yaml": "lit: false\n",
    "pages/home/children/notes/plugins/own/extensions.yaml": "lit: true\nglow: 2\n",
  });
  try {
    const dir = join(root, "pages", "home", "children", "notes");
    const source = await readVault(root);
    // As the CLI does it: the vault's contracts travel with the page's read,
    // and the vault's own findings are not said per page.
    const report = await checkDir(dir, null, contractsOf(source));
    const rules = report.findings.map((f) => f.rule + " " + f.file);
    expect(rules).toEqual([
      "R65 plugins/loose.js",
      "R66 plugins/biom-doc/doc.js",
      "R67 plugins/biom-doc/extensions.yaml",
      "R67 plugins/own/extensions.yaml",
    ]);
    expect(report.findings.find((f) => f.file === "plugins/own/extensions.yaml")?.says).toContain('names "glow"');
    // Handed the directory alone, with nothing about the vault, R67 says
    // nothing about the framework's contract it never saw — and still holds
    // the page's own plugin to its own.
    const alone = await checkDir(dir);
    expect(alone.findings.map((f) => f.rule + " " + f.file)).toEqual([
      "R65 plugins/loose.js",
      "R66 plugins/biom-doc/doc.js",
    ]);
    // The reserved subdirectory is not a section file, and not a page.
    expect(report.findings.some((f) => f.file.startsWith("plugins/") && f.rule !== "R65" && f.rule !== "R66" && f.rule !== "R67")).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ── what a report is ───────────────────────────────────────────────────── */

test("WARNs never clear ok, and FAILs always do", () => {
  // A measure written in px: advice about a length that would be better in rem,
  // and nothing that stops the page drawing.
  const warned = check(page(html({ style: ".band-prose { max-width: 640px }" })));
  expect([...rules(warned)]).toEqual(["R26"]);
  expect(warned.warns).toBeGreaterThan(0);
  expect(warned.fails).toBe(0);
  expect(warned.ok).toBe(true);

  const failed = check(page(html({ script: 'localStorage.setItem("a", "b");' })));
  expect(failed.fails).toBeGreaterThan(0);
  expect(failed.ok).toBe(false);
});

test("the report counts sections and how many took the default, and says so", () => {
  const report = check(page(html({}), withContents(
    "  - name: intro", "    parts:", "      body: Hello",
    "  - name: hero", "    data: hero.html", "    parts:", "      body: Ship faster",
  )));
  expect(report.sections).toBe(2);
  expect(report.defaults).toBe(1);

  const line = formatReport(report).split("\n")[0] ?? "";
  expect(line).toContain("rates-note");
  expect(line).toContain("2 sections");
  expect(line).toContain("(1 default)");
  expect(line).toContain("1 slot");
});

/* ── R57, and the reason it asks about the container ───────────────────── */

/** A document whose one section fills three slots. */
const threeSlots = withContents(
  "  - name: hero",
  "    data: hero.html",
  "    parts:",
  "      one: First",
  "      two: Second",
  "      three: Third",
);

/** A document whose one section fills a single slot called `body`, which is what
 *  the `html` fixture draws when it is given no body of its own. */
const oneSlot = withContents(
  "  - name: hero",
  "    data: hero.html",
  "    parts:",
  "      body: Words",
);

/** A document whose one section fills exactly these slots. */
const twoSlots = withContents(
  "  - name: hero",
  "    data: hero.html",
  "    parts:",
  "      one: First",
  "      two: Second",
);

test("R57 reports a bare stack, and says nothing about a row", () => {
  // The rule went out reporting 40 runs across the reference workspace, and
  // eleven of the thirteen that survived its first narrowing were STILL wrong:
  // chart axis ticks in a twelve-track grid, totals in a flex row, chips in a
  // wrapping strip. A control run of one of those merges collapsed a twelve-tick
  // axis into three cells.
  //
  // A rule that is usually wrong does not merely waste a reader's time — it
  // teaches them to skip the warnings printed beside it. So a run whose parent
  // is laid out by flex or grid is not reported at all. That misses a real cut
  // inside a flex column now and then, which is the right way round to be wrong.
  const bare = '<div class="col"><div data-g-part="one"></div><div data-g-part="two"></div></div>';
  expect(rules(check(page(html({ body: bare }), twoSlots))).has("R57")).toBe(true);

  const flex = { body: bare, style: ".col { display: flex; gap: 1rem; }" };
  expect(rules(check(page(html(flex), twoSlots))).has("R57")).toBe(false);

  const grid = { body: bare, style: ".col { display: grid; grid-template-columns: 1fr 1fr; }" };
  expect(rules(check(page(html(grid), twoSlots))).has("R57")).toBe(false);
});

test("R57 leaves alone the tags whose adjacency already means something", () => {
  // A table cell sits BESIDE its neighbour rather than under it, and dt/dd are a
  // pair by definition. Merging either would destroy the row rather than tidy
  // it, so neither is ever a finding however bare the two elements are.
  const cells = "<table><tr><td data-g-part=\"one\"></td><td data-g-part=\"two\"></td></tr></table>";
  expect(rules(check(page(html({ body: cells }), twoSlots))).has("R57")).toBe(false);

  const pair = "<dl><dt data-g-part=\"one\"></dt><dd data-g-part=\"two\"></dd></dl>";
  expect(rules(check(page(html({ body: pair }), twoSlots))).has("R57")).toBe(false);
});

test("a data-g-part inside an HTML comment is not a slot, computed or otherwise", () => {
  // Found by an agent building a page from these skills, not by us. The scan
  // counts every mention of the attribute and compares it against the ones it
  // could read as literals; a mention inside a comment — an example in a banner,
  // a line somebody parked — counted as one nobody could read, and the file was
  // reported as declaring a slot from a computed value it does not have.
  const body = [
    "<!-- a worked example: <div data-g-part=\"headline\"></div> -->",
    '<div data-g-part="body"></div>',
  ].join("\n");
  const report = check(page(html({ body })));
  expect(rules(report).has("R51")).toBe(false);
});

test("a colour word inside url() is a reference, not a raw colour", () => {
  // Found by an agent drawing a four-colour press, where every gradient is
  // honestly called cyan, magenta or yellow. R30 stripped var() before looking
  // for a named colour and did not strip url(), so `fill: url(#plate-cyan)` —
  // which names an SVG gradient — was reported as a literal.
  const style = ".ink { fill: url(#plate-cyan); stroke: var(--magenta); }";
  expect(rules(check(page(html({ style })))).has("R30")).toBe(false);

  // And the rule still catches the thing it is for.
  expect(rules(check(page(html({ style: ".ink { color: cyan; }" })))).has("R30")).toBe(true);
});

test("R57 — PAINTED apart is not PLACED apart, and only placing excuses the cut", () => {
  // The case the rule was missing, found by reading a page an agent built from
  // the skill: three slots stacked in a plain box, one styled as a kicker, one
  // as a heading, one as a lede. It LOOKS deliberately cut and is not — markdown
  // already tells a heading from a paragraph, so one part draws the same page
  // and gives back a region somebody can restructure. A class each was the only
  // thing the cut bought.
  const painted = {
    style: ".head { min-inline-size: 0; } .mark { font-size: .7rem; }"
      + " .title h1 { font-size: 3rem; } .lede { max-inline-size: 34rem; }",
    body: '<div class="head"><div class="mark" data-g-part="one"></div>'
      + '<div class="title" data-g-part="two"></div>'
      + '<div class="lede" data-g-part="three"></div></div>',
  };
  expect(rules(check(page(html(painted), threeSlots))).has("R57")).toBe(true);

  // A measure is NOT placement: it can be re-aimed at the paragraph markdown
  // produces, so it is no reason to keep two slots apart. Having counted it as
  // placement is exactly what made the rule silent above.
  const placed = {
    style: ".head { min-inline-size: 0; } .one { grid-area: a; } .two { grid-area: b; }",
    body: '<div class="head"><div class="one" data-g-part="one"></div>'
      + '<div class="two" data-g-part="two"></div>'
      + '<div class="three" data-g-part="three"></div></div>',
  };
  expect(rules(check(page(html(placed), threeSlots))).has("R57")).toBe(false);
});

test("R57 — a single-column grid stacks, and is not a row", () => {
  // Skipping every flex and grid container was the previous over-correction. A
  // grid of one column and a flex column both stack; only a row is a row.
  const column = {
    style: ".head { display: grid; gap: 1rem; }",
    body: '<div class="head"><div data-g-part="one"></div>'
      + '<div data-g-part="two"></div><div data-g-part="three"></div></div>',
  };
  expect(rules(check(page(html(column), threeSlots))).has("R57")).toBe(true);

  const row = {
    style: ".head { display: grid; grid-template-columns: 1fr 1fr 1fr; }",
    body: '<div class="head"><div data-g-part="one"></div>'
      + '<div data-g-part="two"></div><div data-g-part="three"></div></div>',
  };
  expect(rules(check(page(html(row), threeSlots))).has("R57")).toBe(false);
});

test("a tag named inside an HTML comment is not a tag, and does not double a real one", () => {
  // A GUIDE-QUALITY SECTION FILE DESCRIBES ITS OWN MECHANISM, and the two halves
  // of doing that both went wrong. R35 read the sentence "append a
  // <script src=/vendor/…> on mount" as an unconditional load and warned about a
  // load that never happens.
  const described = {
    head: '<!-- append a <script src="/vendor/three.min.js"></' + 'script> when there is something to draw -->',
    script: "var ok = 1;",
  };
  expect(rules(check(page(html(described), oneSlot))).has("R35")).toBe(false);

  // AND WHERE THE MENTION HAD NO CLOSING TAG it was worse than a false positive:
  // the block ran from the comment to the REAL script's close, so the file's one
  // script was scanned twice and every finding in it was reported twice.
  const unclosed = {
    head: '<!-- append a <script src="/vendor/three.min.js"> on mount -->',
    script: 'section.querySelector("div").innerHTML = "<b>x</b>";',
  };
  const report = check(page(html(unclosed), oneSlot));
  expect(report.findings.filter((f) => f.rule === "R21")).toHaveLength(1);
  expect(rules(report).has("R35")).toBe(false);

  // A REAL TAG IS STILL REPORTED. The rule is not being turned off, it is being
  // pointed at the file rather than at the prose about the file. What R35 warns
  // about is the LITERAL tag in the markup, which loads on every mount; building
  // it in a script when the page needs it is the remedy the rule asks for, so
  // that form is silent and should be.
  const loads = { head: '<script src="/vendor/three.min.js"></' + 'script>' };
  expect(rules(check(page(html(loads), oneSlot))).has("R35")).toBe(true);
});

test("R60 — a container feature asked of @media fails, and a comment about it does not", () => {
  // IT SURVIVED IN FOUR FILES OF A SHIPPED PAGE with this exact trap described in
  // the guide those files were written against. A media query that never matches
  // looks exactly like a page that was never narrow, so nothing reports it and
  // nobody notices until somebody opens the page on a phone.
  const dead = { style: "@media (max-inline-size: 52rem) { .band { display: block } }" };
  expect(rules(check(page(html(dead), oneSlot))).has("R60")).toBe(true);

  // Both features, and past a first parenthesis that is perfectly valid.
  const second = { style: "@media (min-width: 20rem) and (max-block-size: 40rem) { .b { color: red } }" };
  expect(rules(check(page(html(second), oneSlot))).has("R60")).toBe(true);

  // THE CORRECT FORMS, and the property INSIDE a block, which is what
  // `inline-size` is for.
  const right = { style: "@container (width <= 52rem) { .band { inline-size: 100% } } @media (width <= 52rem) { .b { color: red } }" };
  expect(rules(check(page(html(right), oneSlot))).has("R60")).toBe(false);

  // AND A FILE MAY EXPLAIN THE TRAP. The first version of this rule failed the
  // two starters whose comments exist to describe it, which is a rule taking the
  // useful half out of a guide.
  const explained = { style: "/* never write @media (max-inline-size: 52rem) — it is not a media feature */\n.band { display: grid }" };
  expect(rules(check(page(html(explained), oneSlot))).has("R60")).toBe(false);
});

test("R58 — a section written against the mode that is gone fails, and says why", () => {
  // A FAIL and not a warning because the page still looks right. The rule that
  // was hiding the bar is valid CSS; it simply cannot match any more, so the
  // controls are gone from a page that renders perfectly and reports nothing.
  const dressed = {
    style: ".bar { display: none } :scope[data-g-editing] .bar { display: flex }",
    body: '<div data-g-part="body"></div>',
  };
  expect(rules(check(page(html(dressed), oneSlot))).has("R58")).toBe(true);

  // And the script half, which does not merely fail to match — it throws, and
  // takes everything after it at that script's top level with it.
  const subscribed = { script: "biom.onEdit(function () {});" };
  expect(rules(check(page(html(subscribed), oneSlot))).has("R58")).toBe(true);
  expect(rules(check(page(html({ script: "if (ctx.editing) paint();" }), oneSlot))).has("R58")).toBe(true);

  // A section that says nothing about any mode is the ordinary case.
  expect(rules(check(page(html({}), oneSlot))).has("R58")).toBe(false);
});

test("R59 — a list the reader can only retype is reported, and one they can add to is not", () => {
  // THE COMMONEST WAY A GENERATED PAGE TURNS OUT TO BE A PICTURE. Every word is
  // editable, the report is clean, and the one thing the person wanted to do —
  // put a fourth card in — needs an agent. Reordering is the runtime's; add and
  // remove are the section's, and nothing else can supply them.
  const listed = withContents(
    "  - name: hero", "    data: hero.html", "    parts:", "      cards: [one, two]",
  );
  const drawn = { body: '<div data-g-part="cards"></div>' };
  expect(rules(check(page(html(drawn), listed))).has("R59")).toBe(true);

  const withAdd = {
    body: '<div data-g-part="cards"></div>',
    script: 'ctx.write("cards", ctx.read("cards").concat(["### Another"]));',
  };
  expect(rules(check(page(html(withAdd), listed))).has("R59")).toBe(false);

  // A section with no list has nothing to grow, so the rule has nothing to say.
  expect(rules(check(page(html({}), oneSlot))).has("R59")).toBe(false);
});

test("a dotted name is not a name, because the runtime cannot resolve one", () => {
  // A silent hole: the checker's grammar allowed a dot and the runtime's did
  // not, so `{{brand.name}}` passed the gate and the reader saw the braces with
  // the name still in them. The checker's idea of a name must never be wider
  // than the runtime's.
  const doc = withContents(
    "  - name: hero", "    data: hero.html",
    "    variables:", "      brand: Kestrel",
    "    parts:", "      body: The maker is {{brand.name}}.",
  );
  expect(rules(check(page(html({}), doc))).has("R41")).toBe(true);

  // The undotted name it should have been still passes.
  const fine = withContents(
    "  - name: hero", "    data: hero.html",
    "    variables:", "      brand: Kestrel",
    "    parts:", "      body: The maker is {{brand}}.",
  );
  expect(rules(check(page(html({}), fine))).has("R41")).toBe(false);
});

test("R56 — a `>` inside an attribute does not end the tag", () => {
  // The scanner stopped at the first `>` anywhere, so an attribute holding one
  // was cut short and the remainder of the tag leaked out as prose. The obvious
  // case is an arrow in a graph source held on an attribute: R56 reported the
  // markup of a correct page as words.
  const body = '<div data-g-plugin="flow" data-g-src="graph TD; a-->b"></div>'
    + '<div data-g-part="body"></div>';
  const report = check(page(html({ body })));
  expect(rules(report).has("R56")).toBe(false);

  // Still catches a real word beside it.
  const words = '<div data-g-src="graph TD; a-->b"></div><p>We shipped on time</p>'
    + '<div data-g-part="body"></div>';
  expect(rules(check(page(html({ body: words })))).has("R56")).toBe(true);
});

test("two rules stop failing pages that were right all along", () => {
  // R38: a parent may keep the `child` part — which the child plugin draws,
  // reading the child's name and kind itself — and add slots of its own around
  // it for the words that belong to this page. Nothing there has to call
  // children(), and failing it failed a correct page. The rule was written for
  // the other shape, where the file replaces the drawing entirely.
  const kept = withContents(
    "  - name: \"@page-Notes\"",
    "    data: \"@page-Notes.html\"",
    "    parts:",
    "      body:",
    "        type: child",
    "        data: notes",
    "      note: A word from the parent",
  );
  const drawn = check({
    id: "rates-note",
    doc: kept,
    files: { "@page-Notes.html": html({ body: '<div data-g-part="note"></div>' }) },
  });
  expect(rules(drawn).has("R38")).toBe(false);

  // R57: only markdown can be merged into markdown. A run holding a table has
  // nowhere to go, and reporting it read as the rule not knowing what a slot
  // held — which is exactly what it did not.
  const mixed = withContents(
    "  - name: hero", "    data: hero.html",
    "    parts:",
    "      lede: Some prose.",
    "      figures:",
    "        type: table",
    "        data: jobs",
  );
  const body = '<div class="col"><div data-g-part="lede"></div>'
    + '<div data-g-part="figures"></div></div>';
  expect(rules(check(page(html({ body }), mixed))).has("R57")).toBe(false);
});

/* ── R69: the name is the folder ─────────────────────────────────────────── */

test("R69 — a framework plugin named by its bare word fails on the page and in markup, a word the workspace owns is left alone, and without names the checker says nothing", async () => {
  const root = await pluginVault({
    "docs/plugins/biom-reveal/reveal.js": "",
    "docs/plugins/biom-inview/inview.js": "",
    "docs/plugins/biom-items/items.js": "",
    // The old spelling on a page, and in its section.
    "pages/home/children/Old/content.yaml": "name: Old\nplugin: doc\ncontents:\n  - name: hero\n    data: hero.html\n    parts:\n      body: words\n",
    "pages/home/children/Old/hero.html": '<section data-g-part="body"></section>\n<span data-g-plugin="inview"></span>\n<span data-g-plugin="items" data-g-for="body"></span>\n',
    // The workspace's own `reveal`, so that word is its own; `cards` is nobody's.
    "plugins/reveal/reveal.js": "",
    "pages/home/children/Own/content.yaml": "name: Own\nplugin: biom-doc\ncontents:\n  - name: hero\n    data: hero.html\n    parts:\n      body: words\n",
    "pages/home/children/Own/hero.html": '<section data-g-part="body"></section>\n<span data-g-plugin="reveal"></span>\n<span data-g-plugin="cards"></span>\n',
    // A page's own plugin folder makes the word that page's.
    "pages/home/children/Mine/content.yaml": "name: Mine\nplugin: biom-doc\ncontents:\n  - name: hero\n    data: hero.html\n    parts:\n      body: words\n",
    "pages/home/children/Mine/hero.html": '<section data-g-part="body"></section>\n<span data-g-plugin="items" data-g-for="body"></span>\n',
    "pages/home/children/Mine/plugins/items/items.js": "",
  });
  try {
    const source = await readVault(root);
    const names = namesOf(source);
    expect(names.framework.sort()).toEqual(["biom-doc", "biom-holds", "biom-inview", "biom-items", "biom-reveal"]);
    expect(names.own).toEqual(["reveal"]);

    const old = await checkDir(join(root, "pages", "home", "children", "Old"), null, contractsOf(source), names);
    const r69 = old.findings.filter((f) => f.rule === "R69");
    expect(r69.map((f) => [f.file, f.line, f.severity])).toEqual([
      ["content.yaml", 2, "FAIL"],
      ["hero.html", 2, "FAIL"],
      ["hero.html", 3, "FAIL"],
    ]);
    expect(r69[0]!.says).toContain("say plugin: biom-doc");
    expect(r69[1]!.says).toContain('say data-g-plugin="biom-inview"');
    expect(r69[2]!.says).toContain("tools/migrate-format-5.ts");
    expect(old.ok).toBe(false);

    // The workspace's own `reveal` is its own; `cards` is not the framework's.
    const own = await checkDir(join(root, "pages", "home", "children", "Own"), null, contractsOf(source), names);
    expect(own.findings.filter((f) => f.rule === "R69")).toEqual([]);
    // The page's own `plugins/items/` makes `items` that page's.
    const mine = await checkDir(join(root, "pages", "home", "children", "Mine"), null, contractsOf(source), names);
    expect(mine.findings.filter((f) => f.rule === "R69")).toEqual([]);

    // Handed no names — a directory checked on its own — nothing is said,
    // because a bare word cannot be told from a plugin the workspace wrote.
    const alone = await checkDir(join(root, "pages", "home", "children", "Old"));
    expect(alone.findings.filter((f) => f.rule === "R69")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
