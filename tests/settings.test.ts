// SPDX-License-Identifier: AGPL-3.0-only
// THE CHAT'S KEPT CHOICES — `server/domain/choices.ts`, the shape and which
// kept value an agent's list still offers, and `server/workspace/settings.ts`,
// the file: `.biom/settings.json`, read once, written whole through the
// framework's atomic write, a broken one put aside rather than written over,
// and every field bounded. Every agent, model and value here is invented.

import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConfigOption, Files } from "../contracts/types.ts";
import { makeFiles } from "../server/platform/files.ts";
import { WIRE_BOUNDS } from "../server/platform/acp-wire.ts";
import { MAX_AGENTS, SETTINGS_VERSION, defaults, offeredChoices, pickerCategoryOf, readChoices, writeChoices } from "../server/domain/choices.ts";
import { SETTINGS_ASIDE, SETTINGS_FILE, makeSettings } from "../server/workspace/settings.ts";

/** A workspace's `.biom/`, empty, and the `Files` over it the server builds. */
function folder(): { dir: string; files: Files; said: string[]; make: () => ReturnType<typeof makeSettings> } {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "biom-settings-"))), ".biom");
  mkdirSync(dir, { recursive: true });
  const files = makeFiles(dir);
  const said: string[] = [];
  return { dir, files, said, make: () => makeSettings({ files, log: (l) => void said.push(l) }) };
}

const select = (id: string, category: ConfigOption["category"], values: string[], value = values[0] ?? ""): ConfigOption => ({
  id, name: id, category, type: "select", value,
  choices: values.map((v) => ({ value: v, name: v.toUpperCase(), description: null, group: null })),
});
const toggle = (id: string, category: ConfigOption["category"]): ConfigOption => ({ id, name: id, category, type: "boolean", value: false, choices: [] });

/* ── the shape ──────────────────────────────────────────────────────────── */

test("a workspace that has kept nothing opens on Plain, with no agent and no choices", () => {
  expect(defaults()).toEqual({ view: "plain", agent: null, agents: {} });
});

test("a view a workspace kept before Plain was the default is kept as it was", () => {
  for (const view of ["tools", "thinking", "plain"] as const) {
    expect(readChoices(JSON.parse(writeChoices({ view, agent: null, agents: {} })))?.view).toBe(view);
  }
});

test("the file reads back what it wrote, and is two-space JSON a person can open", () => {
  const s = { view: "thinking" as const, agent: "claude-acp", agents: { "claude-acp": { model: "invented-opus", mode: "plan" }, "codex-acp": { thought_level: "high" } } };
  const text = writeChoices(s);
  expect(text.endsWith("\n")).toBe(true);
  expect(text).toContain('\n  "version": 1,');
  expect(readChoices(JSON.parse(text))).toEqual(s);
});

test("a field out of bounds is left out, and a file that is not a settings file of this version reads as none", () => {
  const long = "m".repeat(WIRE_BOUNDS.id + 1);
  const read = readChoices({
    version: SETTINGS_VERSION,
    chat: {
      view: "fancy",
      agent: "Not A Key",
      agents: {
        "claude-acp": { model: long, mode: "", thought_level: 3, other: "x", effort: "high" },
        "codex-acp": { mode: "auto", thought_level: true },
        "Bad Key": { model: "m" },
        "gemini": "not an object",
        constructor: { model: "invented" },
      },
    },
  });
  expect(read).toEqual({ view: "plain", agent: null, agents: { "codex-acp": { mode: "auto", thought_level: true }, constructor: { model: "invented" } } });
  for (const bad of [null, [], "text", 7, { version: 2, chat: {} }, { chat: { view: "plain" } }]) expect([bad, readChoices(bad)]).toEqual([bad, null]);
  // No more agents than the bound, however many the file lists.
  const many: Record<string, unknown> = {};
  for (let i = 0; i < MAX_AGENTS + 20; i++) many[`agent-${i}`] = { mode: "auto" };
  expect(Object.keys(readChoices({ version: 1, chat: { agents: many } })?.agents ?? {}).length).toBe(MAX_AGENTS);
});

test("only the pickers are kept: the first option of each category, never `other` or a second of one", () => {
  const options = [select("model", "model", ["a", "b"]), select("model-2", "model", ["c"]), select("style", "other", ["x"]), toggle("think", "thought_level")];
  expect(pickerCategoryOf(options, "model")).toBe("model");
  expect(pickerCategoryOf(options, "model-2")).toBe(null);
  expect(pickerCategoryOf(options, "style")).toBe(null);
  expect(pickerCategoryOf(options, "think")).toBe("thought_level");
  expect(pickerCategoryOf(options, "nope")).toBe(null);
});

test("an agent's kept values are laid on only where its list still offers them, and a dropped one is skipped", () => {
  const options = [select("m", "model", ["opus", "sonnet"]), select("mode", "mode", ["ask", "code"]), toggle("think", "thought_level")];
  const kept = { model: "sonnet", mode: "retired-mode", thought_level: true } as const;
  expect([...offeredChoices(options, kept)]).toEqual([["m", "sonnet"], ["think", true]]);
  // A switch is not a word, and a word is not a switch.
  expect([...offeredChoices(options, { thought_level: "yes" })]).toEqual([]);
  expect([...offeredChoices([toggle("m", "model")], { model: "opus" })]).toEqual([]);
  // An agent with no picker of a category takes nothing for it.
  expect([...offeredChoices([], kept)]).toEqual([]);
  expect([...offeredChoices(options, undefined)]).toEqual([]);
});

/* ── the file ───────────────────────────────────────────────────────────── */

test("no file is the defaults, and nothing is written until a choice is made", async () => {
  const f = folder();
  const s = f.make();
  await s.loaded;
  expect(s.read()).toEqual(defaults());
  expect(s.saved("claude-acp")).toEqual({});
  await s.flushed();
  expect(existsSync(join(f.dir, SETTINGS_FILE))).toBe(false);
});

test("the view, the agent and each agent's pickers are kept, and a second start reads them back", async () => {
  const f = folder();
  const s = f.make();
  await s.loaded;
  expect(await s.set({ view: "plain" })).toMatchObject({ view: "plain" });
  s.picked("claude-acp");
  s.chose("claude-acp", "model", "invented-opus");
  s.chose("claude-acp", "mode", "plan");
  s.chose("codex-acp", "thought_level", true);
  s.chose("claude-acp", "model", "invented-sonnet");
  await s.flushed();
  const want = { view: "plain", agent: "claude-acp", agents: { "claude-acp": { model: "invented-sonnet", mode: "plan" }, "codex-acp": { thought_level: true } } };
  expect(s.read()).toEqual(want);
  expect(JSON.parse(readFileSync(join(f.dir, SETTINGS_FILE), "utf8"))).toEqual({ version: 1, chat: want });

  const again = f.make();
  await again.loaded;
  expect(again.read()).toEqual(want);
  expect(again.saved("claude-acp")).toEqual({ model: "invented-sonnet", mode: "plan" });
  // What `read` and `saved` answer is a copy: changing it keeps nothing.
  again.saved("claude-acp").model = "changed-by-a-caller";
  again.read().agents["codex-acp"] = {};
  expect(again.read()).toEqual(want);
});

test("a choice out of bounds is not kept, and neither is one past the last agent the file has room for", async () => {
  const f = folder();
  const s = f.make();
  await s.loaded;
  s.picked("Not A Key");
  s.chose("claude-acp", "model", "m".repeat(WIRE_BOUNDS.id + 1));
  s.chose("claude-acp", "model", "");
  s.chose("claude-acp", "other" as never, "x");
  await s.set({ view: "fancy" as never });
  for (let i = 0; i < MAX_AGENTS; i++) s.chose(`agent-${i}`, "mode", "auto");
  s.chose("one-too-many", "mode", "auto");
  s.chose("agent-0", "model", "still-kept");
  await s.flushed();
  const read = s.read();
  expect(read.agent).toBe(null);
  expect(read.view).toBe("plain");
  expect(read.agents["claude-acp"]).toBeUndefined();
  expect(read.agents["one-too-many"]).toBeUndefined();
  expect(Object.keys(read.agents).length).toBe(MAX_AGENTS);
  expect(read.agents["agent-0"]).toEqual({ mode: "auto", model: "still-kept" });
});

test("EVERY WRITE IS WHOLE: it goes through the atomic write, lands in the order the choices were made, and leaves no temporary file", async () => {
  const f = folder();
  const writes: string[] = [];
  const files: Files = { ...f.files, write: async (rel, text) => { writes.push(rel); await f.files.write(rel, text); } };
  const s = makeSettings({ files });
  await s.loaded;
  // Many choices at once, none awaited: the last one made is the one on disk.
  for (let i = 0; i < 25; i++) s.chose("claude-acp", "model", `invented-${i}`);
  s.picked("codex-acp");
  await s.set({ view: "thinking" });
  await s.flushed();
  expect(writes.every((w) => w === SETTINGS_FILE)).toBe(true);
  expect(writes.length).toBeGreaterThan(0);
  expect(JSON.parse(readFileSync(join(f.dir, SETTINGS_FILE), "utf8"))).toEqual({
    version: 1, chat: { view: "thinking", agent: "codex-acp", agents: { "claude-acp": { model: "invented-24" } } },
  });
  expect(readdirSync(f.dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  // A choice that changes nothing writes nothing.
  const before = writes.length;
  s.picked("codex-acp");
  s.chose("claude-acp", "model", "invented-24");
  await s.set({ view: "thinking" });
  await s.flushed();
  expect(writes.length).toBe(before);
});

test("A BROKEN FILE IS PUT ASIDE, not written over: said once, moved to settings.json.bad, and the defaults used", async () => {
  const f = folder();
  const broken = '{ "version": 1, "chat": { "view": "pla';
  writeFileSync(join(f.dir, SETTINGS_FILE), broken);
  const s = f.make();
  await s.loaded;
  expect(s.read()).toEqual(defaults());
  expect(f.said.length).toBe(1);
  expect(f.said[0]).toContain(SETTINGS_ASIDE);
  expect(readFileSync(join(f.dir, SETTINGS_ASIDE), "utf8")).toBe(broken);
  expect(existsSync(join(f.dir, SETTINGS_FILE))).toBe(false);
  // The next choice writes a good file, and the one put aside stays.
  await s.set({ view: "thinking" });
  expect(readChoices(JSON.parse(readFileSync(join(f.dir, SETTINGS_FILE), "utf8")))?.view).toBe("thinking");
  expect(readFileSync(join(f.dir, SETTINGS_ASIDE), "utf8")).toBe(broken);
  // A file of another version is not this build's to write over either.
  const g = folder();
  writeFileSync(join(g.dir, SETTINGS_FILE), JSON.stringify({ version: 9, chat: { view: "plain" } }));
  const t = g.make();
  await t.loaded;
  expect(t.read()).toEqual(defaults());
  expect(JSON.parse(readFileSync(join(g.dir, SETTINGS_ASIDE), "utf8")).version).toBe(9);
});

test("a choice made before the file is read lands after it, so the read never undoes it", async () => {
  const f = folder();
  writeFileSync(join(f.dir, SETTINGS_FILE), writeChoices({ view: "plain", agent: "codex-acp", agents: { "codex-acp": { mode: "auto" } } }));
  const s = f.make();
  s.chose("codex-acp", "model", "invented-fast");
  await s.loaded;
  await s.flushed();
  expect(s.read()).toEqual({ view: "plain", agent: "codex-acp", agents: { "codex-acp": { mode: "auto", model: "invented-fast" } } });
});
