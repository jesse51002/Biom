// SPDX-License-Identifier: AGPL-3.0-only
// What an agent wrote, as Biom saw it (the no-door interim): the vault's own
// paths, the edits an fs write, a tool call and a command line make, lines
// added and removed, and the bounded action line the look is shown. The vault
// `/v` and every file in it are invented.

import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOOL_LINE_BOUNDS, editsOf, lineDelta, toolLineOf, toolPaths, vaultPath } from "../server/domain/edits.ts";
import type { VaultRoots } from "../server/domain/edits.ts";
import { mergeTool } from "../server/platform/acp-wire.ts";
import type { ToolState } from "../server/platform/acp-wire.ts";

const V: VaultRoots = { root: "/v", real: null };

const toolOf = (u: Record<string, unknown>): ToolState => mergeTool(null, { toolCallId: "t1", title: "a tool", ...u }) as ToolState;

test("a path is the vault's own — relative, forward-slashed — or nothing", () => {
  expect(vaultPath("/v/pages/home/content.yaml", V)).toBe("pages/home/content.yaml");
  expect(vaultPath("pages/a.md", V)).toBe("pages/a.md");
  expect(vaultPath("/v/./pages/../design/x.md", V)).toBe("design/x.md");
  expect(vaultPath("/v", V)).toBeNull();
  expect(vaultPath("/v/", V)).toBeNull();
  expect(vaultPath("/vault-next-door/a.md", V)).toBeNull();
  expect(vaultPath("/v/../etc/passwd", V)).toBeNull();
  expect(vaultPath("/tmp/scratch.md", V)).toBeNull();
  expect(vaultPath("/v/.git/HEAD", V)).toBeNull();
  expect(vaultPath("/v/.biom/chats/x.jsonl", V)).toBeNull();
  expect(vaultPath("/v/.gitignore", V)).toBe(".gitignore");
  expect(vaultPath("", V)).toBeNull();
  expect(vaultPath("/v/a\u0000b", V)).toBeNull();
});

test("a vault reached through a symlink is the vault by either spelling", () => {
  const base = mkdtempSync(join(tmpdir(), "biom-edits-"));
  const real = join(base, "real");
  mkdirSync(real);
  const link = join(base, "link");
  symlinkSync(real, link);
  const roots: VaultRoots = { root: link, real: realpathSync(link) };
  expect(vaultPath(join(link, "a.md"), roots)).toBe("a.md");
  expect(vaultPath(join(realpathSync(link), "b.md"), roots)).toBe("b.md");
});

test("an fs write is exact: created or edited, and its lines counted", () => {
  expect(editsOf({ kind: "fs", path: "notes.md", old: null, text: "a\nb\n" }, V)).toEqual([{ path: "notes.md", via: "fs", op: "created", added: 2, removed: 0 }]);
  expect(editsOf({ kind: "fs", path: "/v/notes.md", old: "a\nb\nc\n", text: "a\nB\nc\nd\n" }, V)).toEqual([
    { path: "notes.md", via: "fs", op: "edited", added: 2, removed: 1 },
  ]);
  expect(editsOf({ kind: "fs", path: "/elsewhere/notes.md", old: null, text: "x" }, V)).toEqual([]);
});

test("a tool call is an edit only once it completes, and only as an edit, a delete, a move or a command that writes", () => {
  const diff = { type: "diff", path: "/v/pages/a/content.yaml", oldText: "x: 1\n", newText: "x: 2\ny: 3\n" };
  expect(editsOf({ kind: "tool", tool: toolOf({ kind: "edit", status: "in_progress", content: [diff] }) }, V)).toEqual([]);
  expect(editsOf({ kind: "tool", tool: toolOf({ kind: "edit", status: "failed", content: [diff] }) }, V)).toEqual([]);
  expect(editsOf({ kind: "tool", tool: toolOf({ kind: "read", status: "completed", locations: [{ path: "/v/a.md" }] }) }, V)).toEqual([]);
  expect(editsOf({ kind: "tool", tool: toolOf({ kind: "edit", status: "completed", content: [diff] }) }, V)).toEqual([
    { path: "pages/a/content.yaml", via: "tool", op: "edited", added: 2, removed: 1 },
  ]);
});

test("a tool call's paths come from its diffs and its locations, each once, a new file created", () => {
  const tool = toolOf({
    kind: "edit",
    status: "completed",
    content: [
      { type: "diff", path: "/v/new.md", oldText: null, newText: "one\ntwo\n" },
      { type: "diff", path: "/v/a.md", oldText: "a", newText: "b" },
      { type: "diff", path: "/v/a.md", oldText: "c", newText: "d\ne" },
      { type: "content", content: { type: "text", text: "done" } },
    ],
    locations: [{ path: "/v/a.md", line: 3 }, { path: "/v/only-located.md" }, { path: "/outside/x.md" }],
  });
  expect(editsOf({ kind: "tool", tool }, V)).toEqual([
    { path: "new.md", via: "tool", op: "created", added: 2, removed: 0 },
    { path: "a.md", via: "tool", op: "edited", added: 3, removed: 2 },
    { path: "only-located.md", via: "tool", op: "edited" },
  ]);
  expect(toolPaths(tool, V).sort()).toEqual(["a.md", "new.md", "only-located.md"]);
});

test("a delete and a move are what they say", () => {
  expect(editsOf({ kind: "tool", tool: toolOf({ kind: "delete", status: "completed", locations: [{ path: "/v/gone.md" }] }) }, V)).toEqual([
    { path: "gone.md", via: "tool", op: "deleted" },
  ]);
  expect(editsOf({ kind: "tool", tool: toolOf({ kind: "move", status: "completed", locations: [{ path: "/v/a.md" }, { path: "/v/b.md" }] }) }, V)).toEqual([
    { path: "a.md", via: "tool", op: "moved" },
    { path: "b.md", via: "tool", op: "moved" },
  ]);
});

test("a completed execute call's command line is read for its writes, by its raw input and never its title", () => {
  const ran = toolOf({ kind: "execute", status: "completed", title: "touch up the readme", rawInput: { command: "cd pages && echo x > a.md; rm old.md" } });
  expect(editsOf({ kind: "tool", tool: ran }, V)).toEqual([
    { path: "pages/a.md", via: "shell", op: "edited" },
    { path: "pages/old.md", via: "shell", op: "deleted" },
  ]);
  const titled = toolOf({ kind: "execute", status: "completed", title: "touch readme.md" });
  expect(editsOf({ kind: "tool", tool: titled }, V)).toEqual([]);
  const elsewhere = toolOf({ kind: "execute", status: "completed", rawInput: { command: "echo x > /tmp/scratch" } });
  expect(editsOf({ kind: "tool", tool: elsewhere }, V)).toEqual([]);
  const inCwd = toolOf({ kind: "execute", status: "completed", rawInput: { command: ["bash", "-lc", "touch x.md"], cwd: "/v/sub" } });
  expect(editsOf({ kind: "tool", tool: inCwd }, V)).toEqual([{ path: "sub/x.md", via: "shell", op: "edited" }]);
});

test("lines added and removed: a new file, a rewrite, an insertion, a pathological one", () => {
  expect(lineDelta(null, "")).toEqual({ added: 0, removed: 0 });
  expect(lineDelta(null, "a\nb")).toEqual({ added: 2, removed: 0 });
  expect(lineDelta("a\nb\nc\n", "a\nb\nc\n")).toEqual({ added: 0, removed: 0 });
  expect(lineDelta("a\nb\nc\n", "a\nx\nb\nc\n")).toEqual({ added: 1, removed: 0 });
  expect(lineDelta("a\nb\nc\n", "c\nb\na\n")).toEqual({ added: 2, removed: 2 });
  expect(lineDelta("a\nb\n", "")).toEqual({ added: 0, removed: 2 });
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
  const other = Array.from({ length: 2000 }, (_, i) => `other ${i}`).join("\n");
  expect(lineDelta(big, other)).toEqual({ added: 2000, removed: 2000 });
});

test("the action line is whole, vault-relative where it can be, and bounded — saying so where it cut", () => {
  const huge = "y".repeat(TOOL_LINE_BOUNDS.diffSide + 10);
  const tool = toolOf({
    kind: "edit",
    status: "completed",
    title: "Edit notes",
    content: [
      { type: "diff", path: "/v/notes.md", oldText: "a", newText: huge },
      { type: "content", content: { type: "text", text: "ok" } },
      { type: "terminal", terminalId: "t" },
    ],
    locations: [{ path: "/v/notes.md", line: 4 }, { path: "/outside.md" }],
  });
  const line = toolLineOf(tool, V);
  expect(line.id).toBe("t1");
  expect(line.title).toBe("Edit notes");
  expect(line.locations).toEqual([{ path: "notes.md", line: 4 }, { path: "/outside.md", line: null }]);
  expect(line.diffs[0]?.path).toBe("notes.md");
  expect(line.diffs[0]?.new.length).toBe(TOOL_LINE_BOUNDS.diffSide);
  expect(line.output).toBe("ok");
  expect(line.truncated).toBe(true);

  const small = toolLineOf(toolOf({ kind: "read", status: "pending" }), V);
  expect(small).toEqual({ id: "t1", title: "a tool", kind: "read", status: "pending", locations: [], diffs: [], output: "", truncated: false });

  const many = toolLineOf(toolOf({ kind: "edit", content: Array.from({ length: 80 }, (_, i) => ({ type: "diff", path: `/v/${i}.md`, newText: "x" })) }), V);
  expect(many.diffs.length).toBe(TOOL_LINE_BOUNDS.diffs);
  expect(many.truncated).toBe(true);
});
