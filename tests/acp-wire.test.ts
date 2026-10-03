// SPDX-License-Identifier: AGPL-3.0-only
// What ACP says, read into Biom's shapes at the edge: the handshake Biom
// sends, what an agent's answers say, the pickers, the / menu, the permission
// answer, and a tool call merged from its updates. Every agent answer here is
// invented, in the schema's shapes.

import { test, expect } from "bun:test";

import {
  choosePermission, initializeParams, mergeTool, newSessionParams, promptParams, quoteWord, readInitialize, readStop, readUpdate, setConfigRequest, toConfigOptions,
  toSlashCommands, toolCommand, toolDiffs, toolText, toPlan, toUsage,
} from "../server/platform/acp-wire.ts";
import type { ToolState } from "../server/platform/acp-wire.ts";

test("initialize offers fs both ways, no terminal, and terminal sign-in both ways the protocol has spelled it", () => {
  expect(initializeParams()).toEqual({
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
      auth: { terminal: true },
      _meta: { "terminal-auth": true },
    },
    clientInfo: { name: "biom", title: "Biom", version: "0.1.0" },
  });
  expect(newSessionParams("/v")).toEqual({ cwd: "/v", mcpServers: [] });
});

test("a prompt is the person's words as the first text block, and each block Biom adds after them as one of its own", () => {
  expect(promptParams("s1", "hello")).toEqual({ sessionId: "s1", prompt: [{ type: "text", text: "hello" }] });
  expect(promptParams("s1", "/compact", [])).toEqual({ sessionId: "s1", prompt: [{ type: "text", text: "/compact" }] });
  expect(promptParams("s1", "hello", ["<biom-context>\ninvented\n</biom-context>"])).toEqual({
    sessionId: "s1",
    prompt: [{ type: "text", text: "hello" }, { type: "text", text: "<biom-context>\ninvented\n</biom-context>" }],
  });
});

test("an initialize answer: the version, load, resume and delete, the sign-in methods as sent", () => {
  const facts = readInitialize({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, delete: {} } },
    authMethods: [{ id: "login", name: "Log in", type: "terminal", args: ["--login"] }],
    agentInfo: { name: "fake", version: "1.2.3" },
  });
  expect(facts).toEqual({
    protocolVersion: 1,
    loadSession: true,
    resume: true,
    deleteSession: true,
    authMethods: [{ id: "login", name: "Log in", type: "terminal", args: ["--login"] }],
    agentInfo: { name: "fake", title: null, version: "1.2.3" },
  });
  expect(readInitialize({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: null } } }).resume).toBe(false);
  // `{}` is support; absent, null or anything but an object is none.
  for (const del of [undefined, null, true, "yes"]) {
    expect(readInitialize({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { delete: del } } }).deleteSession).toBe(false);
  }
  expect(readInitialize(null)).toEqual({ protocolVersion: null, loadSession: false, resume: false, deleteSession: false, authMethods: [], agentInfo: null });
});

test("config options: select, grouped select with display names in the agent's order, boolean, and the unknown left out", () => {
  const { options, legacyMode } = toConfigOptions(
    [
      {
        id: "model", name: "Model", category: "model", type: "select", currentValue: "m2",
        options: [
          { group: "fast", name: "Fast models", options: [{ value: "m1", name: "Model One", description: "quick" }] },
          { group: "deep", name: "Deep models", options: [{ value: "m2", name: "Model Two" }, { value: "m3", name: "Model Three" }] },
        ],
      },
      { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
      { id: "fast", name: "Fast mode", category: "model_config", type: "boolean", currentValue: true },
      { id: "odd", name: "Odd", type: "slider", currentValue: 3 },
      { name: "no id", type: "boolean", currentValue: false },
    ],
    null,
  );
  expect(legacyMode).toBeNull();
  expect(options).toEqual([
    {
      id: "model", name: "Model", category: "model", type: "select", value: "m2",
      choices: [
        { value: "m1", name: "Model One", description: "quick", group: "Fast models" },
        { value: "m2", name: "Model Two", description: null, group: "Deep models" },
        { value: "m3", name: "Model Three", description: null, group: "Deep models" },
      ],
    },
    {
      id: "effort", name: "Effort", category: "thought_level", type: "select", value: "high",
      choices: [{ value: "low", name: "Low", description: null, group: null }, { value: "high", name: "High", description: null, group: null }],
    },
    { id: "fast", name: "Fast mode", category: "other", type: "boolean", value: true, choices: [] },
  ]);
});

test("the older modes are one mode option, unless the agent already lists one of that category", () => {
  const modes = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code", description: "writes" }] };
  const read = toConfigOptions([], modes);
  expect(read.legacyMode).toBe("mode");
  expect(read.options).toEqual([
    {
      id: "mode", name: "Mode", category: "mode", type: "select", value: "ask",
      choices: [{ value: "ask", name: "Ask", description: null, group: null }, { value: "code", name: "Code", description: "writes", group: null }],
    },
  ]);
  const clash = toConfigOptions([{ id: "mode", name: "Style", category: "other", type: "boolean", currentValue: false }], modes);
  expect(clash.legacyMode).toBe("_mode");
  const has = toConfigOptions([{ id: "m", name: "Mode", category: "mode", type: "select", currentValue: "a", options: [{ value: "a", name: "A" }] }], modes);
  expect(has.legacyMode).toBeNull();
  expect(has.options.length).toBe(1);

  expect(setConfigRequest("s", "mode", "code", "mode")).toEqual({ method: "session/set_mode", params: { sessionId: "s", modeId: "code" } });
  expect(setConfigRequest("s", "model", "m1", "mode")).toEqual({ method: "session/set_config_option", params: { sessionId: "s", configId: "model", value: "m1" } });
  expect(setConfigRequest("s", "fast", false, null)).toEqual({
    method: "session/set_config_option", params: { sessionId: "s", configId: "fast", type: "boolean", value: false },
  });
});

test("the agent's / commands: name without a slash, a hint where there is one, each once", () => {
  expect(toSlashCommands([
    { name: "/compact", description: "Summarise the chat so far" },
    { name: "review", description: "Review the diff", input: { hint: "what to review" } },
    { name: "review", description: "again" },
    { description: "no name" },
    "junk",
  ])).toEqual([
    { name: "compact", description: "Summarise the chat so far", hint: null, source: "agent", skill: null },
    { name: "review", description: "Review the diff", hint: "what to review", source: "agent", skill: null },
  ]);
});

test("permission is allow_always, else allow_once, else cancelled — never a rejection", () => {
  const opt = (optionId: string, kind: string) => ({ optionId, name: optionId, kind });
  expect(choosePermission({ options: [opt("a", "allow_once"), opt("b", "allow_always"), opt("c", "reject_once")] })).toEqual({
    outcome: { outcome: "selected", optionId: "b" },
  });
  expect(choosePermission({ options: [opt("r", "reject_always"), opt("a", "allow_once")] })).toEqual({ outcome: { outcome: "selected", optionId: "a" } });
  expect(choosePermission({ options: [opt("r", "reject_once")] })).toEqual({ outcome: { outcome: "cancelled" } });
  expect(choosePermission(null)).toEqual({ outcome: { outcome: "cancelled" } });
});

test("a tool call merges: absent fields unchanged, content and locations replaced whole", () => {
  let s = mergeTool(null, { toolCallId: "t", title: "Edit a.md", kind: "edit", status: "pending", locations: [{ path: "/v/a.md", line: 2 }] }) as ToolState;
  s = mergeTool(s, { toolCallId: "t", status: "in_progress", content: [{ type: "diff", path: "/v/a.md", oldText: "a", newText: "b" }] }) as ToolState;
  s = mergeTool(s, { toolCallId: "t", status: "completed", kind: "nonsense", title: null }) as ToolState;
  expect(s.title).toBe("Edit a.md");
  expect(s.kind).toBe("edit");
  expect(s.status).toBe("completed");
  expect(s.locations).toEqual([{ path: "/v/a.md", line: 2 }]);
  expect(toolDiffs(s)).toEqual([{ path: "/v/a.md", oldText: "a", newText: "b" }]);
  s = mergeTool(s, { toolCallId: "t", content: [{ type: "content", content: { type: "text", text: "one" } }, { type: "content", content: { type: "text", text: "two" } }] }) as ToolState;
  expect(toolDiffs(s)).toEqual([]);
  expect(toolText(s)).toBe("one\ntwo");
  expect(mergeTool(null, { title: "no id" })).toBeNull();
});

test("an execute call's command: a string, a shell's -c script, or words quoted back — never a title", () => {
  const t = (rawInput: unknown) => ({ id: "x", title: "rm -rf everything", kind: "execute", status: "completed", content: [], locations: [], rawInput, rawOutput: undefined }) as ToolState;
  expect(toolCommand(t({ command: "ls -la" }))).toEqual({ command: "ls -la", cwd: null });
  expect(toolCommand(t({ command: ["bash", "-lc", "echo x > y"], cwd: "/v/sub" }))).toEqual({ command: "echo x > y", cwd: "/v/sub" });
  expect(toolCommand(t({ command: ["/bin/zsh", "-c", "touch a"] }))).toEqual({ command: "touch a", cwd: null });
  expect(toolCommand(t({ command: ["touch", "a b.md", "it's"] }))).toEqual({ command: "touch 'a b.md' 'it'\\''s'", cwd: null });
  expect(toolCommand(t(undefined))).toBeNull();
  expect(toolCommand(t({ command: "  " }))).toBeNull();
  expect(quoteWord("")).toBe("''");
});

test("stop reasons, updates, plans and usage read loosely", () => {
  expect(readStop({ stopReason: "end_turn" })).toBe("end_turn");
  expect(readStop({ stopReason: "max_turn_requests" })).toBe("max_turn_requests");
  expect(readStop({ stopReason: "exploded" })).toBeNull();
  expect(readUpdate({ sessionId: "s", update: { sessionUpdate: "plan", entries: [] } })).toEqual({ sessionId: "s", update: { sessionUpdate: "plan", entries: [] } });
  expect(readUpdate({ sessionId: "s", update: {} })).toBeNull();
  expect(readUpdate({ update: { sessionUpdate: "plan" } })).toBeNull();
  expect(toPlan([{ content: "a", priority: "high", status: "completed" }, { content: "b" }, { nope: 1 }])).toEqual([
    { content: "a", priority: "high", status: "completed" },
    { content: "b", priority: "medium", status: "pending" },
  ]);
  expect(toUsage({ used: 10, size: 100, cost: { amount: 0.5, currency: "USD" } })).toEqual({ used: 10, size: 100, cost: { amount: 0.5, currency: "USD" } });
  expect(toUsage({ used: 10 })).toBeNull();
});
