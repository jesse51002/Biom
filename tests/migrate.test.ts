// SPDX-License-Identifier: AGPL-3.0-only
// The vault format GATE. It runs before anything reads, and it does not convert.
//
// THIS FILE USED TO TEST A CONVERTER, and the deletion of that converter is the
// change rather than a regression in it. `migrateVault` read the flat sidecar,
// pulled every `<id>.md` into the document, turned `order:` into `contents:`,
// rewrote a dotted key into the section it belonged to and moved every page
// under its parent's `children/`. All of that was written against a format that
// held `kind:`, `render:` and a heterogeneous `contents` list, and all three are
// gone: a page holds SECTIONS now, and a section IS its markup.
//
// **There is no converter to format 3 and there will not be one**, because the
// thing a conversion would have to produce cannot be derived from what an old
// vault says. The markup a section draws with lived in the RENDER layer rather
// than in the vault, so a converter could only put every entry into the shipped
// default section and call it migrated — silently flattening every page in
// somebody's workspace into one treatment, with nothing left saying what it used
// to be. Refusing is the honest answer and it is cheap: a vault is a git repo, so
// an old one is still there, readable, and openable by an older checkout.
//
// SO THE OLD-FORMAT FIXTURES BELOW ARE KEPT AND THEIR ROLE IS INVERTED. Every
// firm, rate and job name in them is INVENTED and represents nothing real; they
// exist because a refusal is only tested by a vault that actually has words in
// it. What each one is now is an INPUT TO A REFUSAL rather than to a conversion.
//
// The three properties worth more than the rest:
//
//   · It refuses BY NAME. A workspace that will not open has to say which format
//     it is in and which key gave it away, or "this does not work" is the whole
//     of what the person is told.
//   · It writes NOTHING, ever. There is no commit to take, no half-done state to
//     resume from, and a refused vault is byte-for-byte what it was.
//   · It says nothing about a vault that is already in this format, however deep
//     the tree goes — it runs on every start, so a false positive is a workspace
//     nobody can open.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VAULT_FORMAT, VaultFormatError, checkVaultFormat } from "../server/workspace/migrate.ts";

let ROOT = "";

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "biom-migrate-"));
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/* ── an old vault, invented ─────────────────────────────────────────────── */

const put = (rel: string, text: string): void => {
  const at = join(ROOT, rel);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text, "utf8");
};

/** The flat vault as it shipped — FORMAT 1: one directory per page under
 *  `pages/`, the prose in `.md` files beside the sidecar, `order:` naming the
 *  sections and `parent:` saying where each page belonged. A value never spanned
 *  a line, which is why this format could not write a `contents:` key and why
 *  its absence is what tells format 1 from format 2. */
function oldVault(): void {
  put("pages/home/content.yaml", ["name: Home", "kind: doc", "order: [@page-Rates-note]", "parent: null", "render: null"].join("\n") + "\n");

  put(
    "pages/rates-note/content.yaml",
    [
      "name: Rendering rates",
      "kind: doc",
      "order: [intro, calc, shape]",
      "parent: home",
      "render: null",
      "rate: 62",
      "calc.title: What a job costs",
      "calc.months: [Jan, Feb, Mar]",
      "intro.heading: Rates",
    ].join("\n") + "\n",
  );
  put("pages/rates-note/intro.md", "# Rendering rates\n\nThe base rate is {{rate}}.\n");
  put("pages/rates-note/calc.html", "<p data-g-slot=\"title\">What a job costs</p>\n");
  put("pages/rates-note/shape.mermaid", "flowchart TD\n  a --> b\n");

  // A child of a child, so the walk has to reach a page that is nested rather
  // than only the ones directly under `pages/`.
  put(
    "pages/site-visit/content.yaml",
    ["name: Site visit", "kind: doc", "order: [note]", "parent: rates-note", "render: null"].join("\n") + "\n",
  );
  put("pages/site-visit/note.md", "Two hours on site, invented.\n");

  // A page that took the whole sheet: no sections, and its slots are addressed
  // by the dotted names its own HTML carries.
  put(
    "pages/job-board/content.yaml",
    [
      "kind: artifact",
      "name: Job board",
      "order: []",
      "parent: home",
      "render: null",
      "board.title: Job board",
      "opt.title: name",
      "opt.table: jobs",
    ].join("\n") + "\n",
  );
  put("pages/job-board/index.html", "<h1 data-g-slot=\"board.title\">Job board</h1>\n");

  // The design doc, which is page-shaped and sits beside `pages/` rather than in
  // it. It is read by exactly the same check, which is the whole reason it is
  // here: a gate that walked only `pages/` would open a workspace whose design
  // doc is still in the old format.
  put("design/content.yaml", ["name: Design", "kind: doc", "order: [title]", "parent: null", "render: null"].join("\n") + "\n");
  put("design/title.md", "# Design\n");
}

/** A page in the format this server reads: one document naming the reader that
 *  draws it, with `contents` a list of SECTIONS and nothing else. */
const nowFormat = (name: string): string =>
  ["name: " + name, "plugin: doc", "contents:", "  - name: intro", "    parts:", "      body: Invented.", ""].join("\n");

/** Every file in the vault and its bytes, so "nothing changed" is a comparison
 *  rather than a spot check. */
function snapshot(at = ROOT, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, snapshot(join(at, entry.name), rel));
    else out[rel] = readFileSync(join(at, entry.name), "utf8");
  }
  return out;
}

/** The error a refusal throws, or a failure saying it did not throw at all. */
async function refusal(): Promise<VaultFormatError> {
  try {
    await checkVaultFormat(ROOT);
  } catch (e) {
    expect(e).toBeInstanceOf(VaultFormatError);
    return e as VaultFormatError;
  }
  throw new Error("checkVaultFormat opened a workspace it should have refused");
}

/* ── the refusal ────────────────────────────────────────────────────────── */

test("an old vault is refused, and the sentence names the format and the key", async () => {
  oldVault();
  const why = await refusal();

  // WHICH FORMAT IT IS IN, and which one this server reads. Without both, the
  // person is told "this does not work" and nothing else.
  expect(why.message).toMatch(/vault format 1\b/);
  expect(why.message).toContain("format " + String(VAULT_FORMAT));
  expect(VAULT_FORMAT).toBe(4);

  // AND THE KEY THAT GAVE IT AWAY, quoted the way it is written on the line the
  // reader has to go and delete.
  expect(why.message).toMatch(/"(?:kind|render|order|parent|sections):"/);

  // WHY THERE IS NOTHING TO PRESS. A refusal that reads as a bug is a refusal
  // somebody files rather than acts on.
  expect(why.message).toMatch(/no converter/i);
  expect(why.message).toMatch(/section carries its own html/i);
  // AND WHAT TO DO INSTEAD — the two things that actually work.
  expect(why.message).toMatch(/older build/i);
  expect(why.message).toMatch(/new workspace/i);
});

test("the key it names is the one on the page, whichever of them a vault carries", async () => {
  // One page and one retired key at a time, because the message names the FIRST
  // key found and a vault carrying four cannot say which of them it picked.
  for (const key of ["kind", "render", "order", "parent", "sections"]) {
    rmSync(join(ROOT, "pages"), { recursive: true, force: true });
    put("pages/home/content.yaml", "name: Home\n" + key + ": whatever\n");

    const why = await refusal();
    expect(why.message, `a vault carrying ${key}: is not named for it`).toContain('"' + key + ':"');
    // Each one is named for WHAT IT USED TO MEAN, which is what turns "this page
    // will not open" into "this page was written for the format before this one".
    expect(why.message.length).toBeGreaterThan(200);
  }
});

test("format 1 and format 2 are told apart by the one key format 1 could not write", async () => {
  // FORMAT 2 — one document per page, `contents` a list of entries each with a
  // `type`, plus `kind:` for what the page was and `render:` for the treatment
  // the whole sheet took.
  put(
    "pages/home/content.yaml",
    ["name: Home", "kind: doc", "render: null", "contents:", "  - name: intro", "    type: markdown", "    data: Invented."].join("\n") + "\n",
  );
  expect((await refusal()).message).toMatch(/vault format 2\b/);

  // A vault holding both answers for the OLDER of them: the migration a person
  // has to do is the one that reaches furthest back.
  put("pages/rates-note/content.yaml", "name: Rates\nkind: doc\norder: [intro]\nparent: home\nrender: null\n");
  expect((await refusal()).message).toMatch(/vault format 1\b/);
});

test("the refusal carries the pages rather than putting them in the message", async () => {
  oldVault();
  const why = await refusal();

  // A MESSAGE IS A LEAK CHANNEL: it crosses into the API and is shown to
  // whoever asked, so the path stays off it and rides on the error instead.
  expect(why.message).not.toContain(ROOT);
  expect(why.message).not.toContain(tmpdir());

  // VAULT-RELATIVE, and every page-shaped document that gave the vault away —
  // the design doc among them, because it is read by the same check.
  expect(why.where.every((w) => !w.startsWith("/"))).toBe(true);
  expect(why.where).toContain(join("pages", "home", "content.yaml"));
  expect(why.where).toContain(join("pages", "rates-note", "content.yaml"));
  expect(why.where).toContain(join("pages", "site-visit", "content.yaml"));
  expect(why.where).toContain(join("pages", "job-board", "content.yaml"));
  expect(why.where).toContain(join("design", "content.yaml"));
});

test("it carries the contract's own error code, so the API never falls back to internal", async () => {
  oldVault();
  const why = await refusal();
  // A refusal the picker cannot act on is a picker that looks broken. The code
  // is one of the closed set the wire has, so the message reaches the person.
  expect(why.code).toBe("bad_request");
  expect(why.name).toBe("VaultFormatError");
  expect(why).toBeInstanceOf(Error);
});

test("a refused vault is byte-for-byte what it was: nothing is written and nothing is committed", async () => {
  oldVault();
  const before = snapshot();

  await refusal();

  // THERE IS NO COMMIT TO TAKE AND NO HALF-DONE STATE TO RESUME FROM, which is
  // what makes this safe to run on every start. The old converter needed a
  // `commit` callback and a resumable order of writes; a gate needs neither.
  expect(snapshot()).toEqual(before);
  expect(existsSync(join(ROOT, ".git"))).toBe(false);
  // And in particular the old format's own files are still where they were —
  // a file nobody can convert is one somebody opens with an older build.
  expect(existsSync(join(ROOT, "pages/rates-note/intro.md"))).toBe(true);
  expect(existsSync(join(ROOT, "pages/rates-note/shape.mermaid"))).toBe(true);
  expect(existsSync(join(ROOT, "pages/home/children"))).toBe(false);
});

test("it refuses the same vault every time, because it never changes it", async () => {
  oldVault();
  await refusal();
  await refusal();
  const why = await refusal();
  expect(why.where.length).toBeGreaterThan(3);
});

/* ── the page-shaped roots that are not pages ───────────────────────────── */

test("the design doc and the bundled blocks are read by the same check", async () => {
  // Only the design doc is old. A gate that walked `pages/` alone would open
  // this workspace and then fail on the first read of `design/`.
  put("pages/home/content.yaml", nowFormat("Home"));
  put("design/content.yaml", "name: Design\nkind: doc\norder: [title]\nparent: null\nrender: null\n");
  expect((await refusal()).where).toEqual([join("design", "content.yaml")]);

  // The same for `base/`, the starter sections every workspace is seeded with.
  put("design/content.yaml", nowFormat("Design"));
  put("base/diagram/content.yaml", "name: Diagram\nplugin: doc\nkind: doc\nrender: null\ncontents: []\n");
  expect((await refusal()).where).toEqual([join("base", "diagram", "content.yaml")]);
});

test("market/ is not walked, because the catalogue went with the render layer", async () => {
  put("pages/home/content.yaml", nowFormat("Home"));
  // There is no `Listing`, no `listings()` and no `install` off a catalogue any
  // more. A directory somebody left behind is not a page this server reads, so
  // it is not a reason to refuse the whole workspace.
  put("market/week-ahead/content.yaml", "name: Week ahead\nkind: artifact\nrender: null\norder: []\n");
  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
});

/* ── what it opens ──────────────────────────────────────────────────────── */

test("a vault in the format this server reads opens, however deep the tree goes", async () => {
  put("pages/home/content.yaml", nowFormat("Home"));
  put("pages/home/children/Notes/content.yaml", nowFormat("Notes"));
  put("pages/home/children/Notes/children/Rates/content.yaml", nowFormat("Rates"));
  put("pages/home/children/Notes/hero.html", "<section data-g-part=\"body\"></section>\n");
  put("design/content.yaml", nowFormat("Design"));
  put("base/diagram/content.yaml", nowFormat("Diagram"));
  put("theme.json", JSON.stringify({ palette: { name: "Biom" } }));

  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
  // It runs on every start, so a false positive is a workspace nobody can open.
  // Nothing was written on the way through either.
  const before = snapshot();
  await checkVaultFormat(ROOT);
  expect(snapshot()).toEqual(before);
});

test("an empty vault is not a refusal", async () => {
  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
  mkdirSync(join(ROOT, "pages"), { recursive: true });
  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
});

test("a directory with no content.yaml in it is not a page and is walked past", async () => {
  put("pages/home/content.yaml", nowFormat("Home"));
  mkdirSync(join(ROOT, "pages/home/_assets"), { recursive: true });
  put("pages/home/_assets/panel.html", "<p>Invented.</p>\n");
  put("pages/home/assets/kitchen.txt", "not a page\n");
  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
});

/** WHAT IT DELIBERATELY DOES NOT CATCH, stated here because it is a decision
 *  rather than a hole. A hand-written page carrying only `name:` and a set of
 *  `.md` files beside it was expressible in format 1 and is a legal, empty page
 *  in format 3 — there is nothing in the file to tell the two apart. It opens
 *  with no sections, which is what it now says. Every file the OLD SERVER wrote
 *  carried `kind:` and `render:`, so every vault that was ever used is caught. */
test("a page carrying only name: and prose beside it is opened rather than guessed at", async () => {
  put("pages/home/content.yaml", "name: Home\n");
  put("pages/home/intro.md", "# Home\n\nInvented.\n");
  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
});

test("a retired word that is not a key at column zero is not a retired key", async () => {
  // The tell is a key at column zero, not the word anywhere in the file: a
  // section's own `parts` are indented, and prose is free to talk about the
  // format it was written for.
  put(
    "pages/home/content.yaml",
    [
      "name: Home",
      "plugin: doc",
      "contents:",
      "  - name: intro",
      "    parts:",
      "      body: |",
      "        This page used to carry a kind: and a render:, and it does not.",
      "        The order: of a page is its contents now.",
      "",
    ].join("\n"),
  );
  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
});

test("an unreadable page directory is walked past rather than thrown over", async () => {
  // `content.yaml` as a DIRECTORY: not a page, not readable, and not a reason
  // for a gate that runs on every start to throw something nobody expects.
  put("pages/home/content.yaml", nowFormat("Home"));
  mkdirSync(join(ROOT, "pages/broken/content.yaml"), { recursive: true });
  await expect(checkVaultFormat(ROOT)).resolves.toBeUndefined();
});
