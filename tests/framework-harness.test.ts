// SPDX-License-Identifier: AGPL-3.0-only
// The harnesses' own names for the guide and the skills, kept at a vault's
// root: `CLAUDE.md` and `.claude/skills` as links, `.gemini/settings.json`
// naming `AGENTS.md`. Each folder here is a temporary one with invented files.
//
// What is held: they are made where nothing stands, and resolve to the
// vault's own guide and skills; a second pass makes nothing; and a person's
// own `CLAUDE.md`, `.claude/skills/`, settings or link under one of those names
// is left exactly as it was and reported — as is a `.claude` that is itself a
// link out of the vault, through which nothing is written.

import { test, expect, afterAll } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeRunFs } from "../server/platform/rundir.ts";
import { CLAUDE_GUIDE, CLAUDE_SKILLS, GEMINI_SETTINGS, GEMINI_SETTINGS_TEXT, keepHarness } from "../server/workspace/framework.ts";

const scratch = mkdtempSync(join(tmpdir(), "biom-harness-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;

/** A vault root as the framework's rewrite leaves it: the guide and one skill. */
function vault(): string {
  const root = join(scratch, `v${++n}`);
  mkdirSync(join(root, ".agents", "skills", "biom-pages"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# The invented guide\n");
  writeFileSync(join(root, ".agents", "skills", "biom-pages", "SKILL.md"), "---\nname: biom-pages\n---\n");
  return root;
}

test("made where nothing stands, and each resolves to the vault's own guide and skills", () => {
  const root = vault();
  const r = keepHarness(makeRunFs(root));
  expect(r).toEqual({ wrote: [CLAUDE_GUIDE, CLAUDE_SKILLS, GEMINI_SETTINGS], left: [], failed: [] });
  // Relative, so the vault can be moved and cloned.
  expect(readlinkSync(join(root, "CLAUDE.md"))).toBe("AGENTS.md");
  expect(readlinkSync(join(root, ".claude", "skills"))).toBe("../.agents/skills");
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("# The invented guide\n");
  expect(readdirSync(join(root, ".claude", "skills"))).toEqual(["biom-pages"]);
  expect(readFileSync(join(root, ".gemini", "settings.json"), "utf8")).toBe(GEMINI_SETTINGS_TEXT);
  expect(JSON.parse(GEMINI_SETTINGS_TEXT)).toEqual({ context: { fileName: ["AGENTS.md"] } });
});

test("a second pass makes nothing", () => {
  const root = vault();
  keepHarness(makeRunFs(root));
  expect(keepHarness(makeRunFs(root))).toEqual({ wrote: [], left: [], failed: [] });
  // An equivalent link spelled absolutely is ours too.
  rmSync(join(root, ".claude", "skills"));
  symlinkSync(join(root, ".agents", "skills"), join(root, ".claude", "skills"));
  expect(keepHarness(makeRunFs(root))).toEqual({ wrote: [], left: [], failed: [] });
});

test("the person's own CLAUDE.md, skills folder, settings and links are left exactly as they were, and reported", () => {
  const root = vault();
  writeFileSync(join(root, "CLAUDE.md"), "My own instructions, invented.\n");
  mkdirSync(join(root, ".claude", "skills", "mine"), { recursive: true });
  writeFileSync(join(root, ".claude", "skills", "mine", "SKILL.md"), "mine\n");
  writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
  mkdirSync(join(root, ".gemini"));
  writeFileSync(join(root, ".gemini", "settings.json"), "{\"theme\":\"invented\"}\n");
  const r = keepHarness(makeRunFs(root));
  expect(r).toEqual({ wrote: [], left: [CLAUDE_GUIDE, CLAUDE_SKILLS, GEMINI_SETTINGS], failed: [] });
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("My own instructions, invented.\n");
  expect(lstatSync(join(root, ".claude", "skills")).isDirectory()).toBe(true);
  expect(readdirSync(join(root, ".claude", "skills"))).toEqual(["mine"]);
  expect(readFileSync(join(root, ".gemini", "settings.json"), "utf8")).toBe("{\"theme\":\"invented\"}\n");

  const linked = vault();
  symlinkSync("INSTRUCTIONS.md", join(linked, "CLAUDE.md"));
  const s = keepHarness(makeRunFs(linked));
  expect(s.left).toEqual([CLAUDE_GUIDE]);
  expect(readlinkSync(join(linked, "CLAUDE.md"))).toBe("INSTRUCTIONS.md");
  expect(s.wrote).toEqual([CLAUDE_SKILLS, GEMINI_SETTINGS]);
});

test("a .claude or .gemini that is itself a link out of the vault is never written through", () => {
  const root = vault();
  const outside = join(scratch, `outside-${n}`);
  mkdirSync(outside);
  mkdirSync(join(outside, "gem"));
  symlinkSync(outside, join(root, ".claude"));
  symlinkSync(join(outside, "gem"), join(root, ".gemini"));
  const r = keepHarness(makeRunFs(root));
  expect(r.left).toEqual([".claude", ".gemini"]);
  expect(r.wrote).toEqual([CLAUDE_GUIDE]);
  expect(readdirSync(outside)).toEqual(["gem"]);
  expect(readdirSync(join(outside, "gem"))).toEqual([]);
  // And a `.claude` that is a file is the person's too.
  const file = vault();
  writeFileSync(join(file, ".claude"), "not a folder\n");
  expect(keepHarness(makeRunFs(file)).left).toEqual([".claude"]);
  expect(existsSync(join(file, ".gemini", "settings.json"))).toBe(true);
});
