// SPDX-License-Identifier: AGPL-3.0-only
// The chats, against the scripted fake agent (`tests/fake-acp-agent.ts`) run
// as a real process over the real connection: a turn, one message at a time,
// Stop, permission answered and never shown, the agent's files confined to the
// vault, each write reported once, a switch that mints a new agent and hands
// it the chat, a held message, a sign-in refusal, a crash, the kept log read
// back after a restart, and reopening by resume, by load, or by handing the
// chat over. Every agent, page, skill and message here is invented.

import { test, expect, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { AgentInfo, ChatPush, ChatSummary, ChatUpdate, EditVia, Writer } from "../contracts/types.ts";
import { connectAcp } from "../server/platform/acp.ts";
import { initializeParams } from "../server/platform/acp-wire.ts";
import { makeFiles } from "../server/platform/files.ts";
import { GREEN_MS, makeChats, readSkills } from "../server/workspace/chats.ts";
import type { Chats, ChatsDeps, Skill } from "../server/workspace/chats.ts";
import { makeSettings } from "../server/workspace/settings.ts";
import type { TurnSignal } from "../server/domain/jev.ts";
import type { Scenario } from "./fake-acp-agent.ts";

const POSIX = process.platform !== "win32";
/** Each of these starts real agent processes, some several: a bound of its
 *  own rather than the runner's five seconds. */
const only = (name: string, fn: () => Promise<void>) => (POSIX ? test : test.skip)(name, fn, 30_000);
const FAKE = resolve(import.meta.dir, "fake-acp-agent.ts");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ms: number, ok: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await wait(15);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const info = (key: string, name: string, over: Partial<AgentInfo> = {}): AgentInfo => ({
  key, name, line: `${name}, invented for a test`, icon: null, source: "path", version: "0.0.0",
  state: "active", reason: null, message: null, auth: [], options: [], commands: [], ...over,
});

const SKILLS: Skill[] = [
  { name: "biom-pages", description: "How a page is written", path: ".agents/skills/biom-pages/SKILL.md" },
  { name: "office-hours", description: "Pressure-test an idea", path: ".agents/skills/office-hours/SKILL.md" },
];

const live: Chats[] = [];
afterEach(async () => {
  for (const c of live.splice(0)) await c.endAll();
});

/** A vault, a fake agent per key, and the chats over them. */
function world(opts: {
  root?: string;
  agents?: AgentInfo[];
  scenarios?: Record<string, Scenario>;
  /** The sign-in method an agent wants in every process, by key. */
  signedInWith?: (key: string) => string | null;
  /** The chats open in a window now. */
  openIn?: () => string[];
  /** After Stop, how long an agent has to answer before it is ended. */
  cancelGraceMs?: number;
  /** Where the chosen agent and pickers are kept, and read back. */
  keep?: Pick<ChatsDeps, "saved" | "picked" | "chose">;
} = {}) {
  const root = opts.root ?? realpathSync(mkdtempSync(join(tmpdir(), "biom-chats-")));
  const logs = realpathSync(mkdtempSync(join(tmpdir(), "biom-heard-")));
  const scenarios: Record<string, Scenario> = opts.scenarios ?? { fake: {} };
  let agents = opts.agents ?? [info("fake", "Fake Agent")];
  const hear = new Set<(a: AgentInfo[]) => void>();
  const edits: { path: string; via: EditVia; writer: Writer }[] = [];
  const signals: TurnSignal[] = [];
  const pushes: ChatPush[] = [];
  const refused: string[] = [];
  const said: string[] = [];
  let skew = 0;
  const heardPath = (key: string) => join(logs, `${key}.jsonl`);

  const make = () => {
    const chats = makeChats({
      launch: async (key) => {
        const s = scenarios[key];
        if (!s) return null;
        return { command: process.execPath, args: ["run", FAKE], env: { ...(process.env as Record<string, string>), FAKE_ACP_SCENARIO: JSON.stringify({ ...s, log: heardPath(key) }) } };
      },
      agents: () => agents,
      onAgents: (fn) => {
        hear.add(fn);
        return () => void hear.delete(fn);
      },
      refused: (key) => void refused.push(key),
      signedInWith: opts.signedInWith ?? (() => null),
      openIn: opts.openIn ?? (() => []),
      connect: (launch, cwd) => connectAcp(launch, cwd, undefined, { log: () => {}, graceMs: 500 }),
      root,
      logDir: join(root, ".biom"),
      files: makeFiles(root),
      skills: async () => SKILLS,
      placeOf: async (p) => (p.startsWith("pages/") ? { view: "page", uid: `uid-${p.split("/")[1]}`, screen: "page" } : null),
      uidOf: async (id) => `uid-${id}`,
      onEdit: (path, via, writer) => void edits.push({ path, via, writer }),
      onTurn: (s) => void signals.push(s),
      now: () => Date.now() + skew,
      log: (l) => void said.push(l),
      ...(opts.cancelGraceMs === undefined ? {} : { cancelGraceMs: opts.cancelGraceMs }),
      ...(opts.keep ?? {}),
    });
    chats.on((p) => void pushes.push(p));
    live.push(chats);
    return chats;
  };

  return {
    root,
    scenarios,
    edits,
    signals,
    pushes,
    refused,
    said,
    make,
    chats: make(),
    skewBy: (ms: number) => void (skew += ms),
    setAgents(list: AgentInfo[]) {
      agents = list;
      for (const fn of hear) fn(list);
    },
    heard(key = "fake"): Record<string, unknown>[] {
      if (!existsSync(heardPath(key))) return [];
      return readFileSync(heardPath(key), "utf8").trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
    },
  };
}

const summaryOf = (chats: Chats, id: string): ChatSummary => chats.list().find((c) => c.id === id) as ChatSummary;

async function settled(chats: Chats, id: string, turn: number): Promise<ChatSummary> {
  await until(`turn ${turn} of ${id} to end`, 15_000, () => {
    const s = summaryOf(chats, id);
    return s.turn === turn && s.phase === "idle";
  });
  return summaryOf(chats, id);
}

const replyOf = (updates: ChatUpdate[], turn: number): string =>
  updates.filter((u): u is ChatUpdate & { kind: "reply"; text: string } => u.kind === "reply" && u.turn === turn).map((u) => u.text).join("");

const prompts = (heard: Record<string, unknown>[]): string[] =>
  heard.filter((h) => h.method === "session/prompt").map((h) => ((h.params as { prompt: { text: string }[] }).prompt[0] as { text: string }).text);

only("a full turn: the agent starts in the vault, thinks, answers, and the light turns green", async () => {
  const w = world();
  const s0 = await w.chats.create({ agent: "fake", text: "Hello there\nsecond line" });
  expect(s0.agent).toBe("fake");
  expect(s0.name).toBe("Hello there");
  expect(["starting", "running"]).toContain(s0.phase);
  expect(s0.light).toBe("working");

  const s = await settled(w.chats, s0.id, 1);
  expect(s.stop).toBe("end_turn");
  expect(s.light).toBe("done");
  expect(s.harness).toBe("Fake Agent");
  expect(s.agentId).toMatch(/^[0-9a-f-]{36}$/);

  const { updates } = await w.chats.read(s0.id);
  expect(replyOf(updates, 1)).toBe("echo: Hello there\nsecond line");
  const kinds = updates.map((u) => u.kind);
  for (const k of ["prompt", "name", "agent", "thought", "reply", "turn"]) expect(kinds).toContain(k);
  // The reply's two chunks arrived together and are one update.
  expect(updates.filter((u) => u.kind === "reply").length).toBe(1);
  const turns = updates.filter((u): u is ChatUpdate & { kind: "turn" } => u.kind === "turn").map((u) => u.phase);
  expect(turns).toEqual(["starting", "running", "idle"]);
  const seqs = updates.map((u) => u.seq);
  expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  expect(new Set(seqs).size).toBe(seqs.length);
  expect((updates.find((u) => u.kind === "agent") as { agentId: string }).agentId).toBe(s.agentId as string);

  const heard = w.heard();
  expect((heard.find((h) => h.method === "initialize") as { params: unknown }).params).toEqual(initializeParams());
  expect((heard.find((h) => h.method === "session/new") as { params: unknown }).params).toEqual({ cwd: w.root, mcpServers: [] });

  const sig = w.signals.filter((x) => x.chat === s0.id);
  expect(sig[0]).toEqual({ kind: "start", chat: s0.id, turn: 1, text: "Hello there\nsecond line" });
  expect(sig.some((x) => x.kind === "thought")).toBe(true);
  expect(sig.filter((x) => x.kind === "reply").map((x) => (x as { text: string }).text).join("")).toBe("echo: Hello there\nsecond line");
  expect(sig[sig.length - 1]).toEqual({ kind: "end", chat: s0.id, turn: 1 });

  await until("the pushes to catch up", 2000, () => w.pushes.some((p) => p.chat.phase === "idle" && p.chat.id === s0.id));
  const pushed = w.pushes.filter((p) => p.chat.id === s0.id).flatMap((p) => p.updates.map((u) => u.seq));
  expect(new Set(pushed)).toEqual(new Set(seqs));

  // Read after a seq answers what came after it.
  const later = await w.chats.read(s0.id, seqs[seqs.length - 3]);
  expect(later.updates.map((u) => u.seq)).toEqual(seqs.slice(-2));
});

only("one message at a time: a second send while a turn runs is refused with limit", async () => {
  const w = world({ scenarios: { fake: { turns: [[{ thought: "slow" }, { sleep: 400 }, { reply: "done" }]] } } });
  const s = await w.chats.create({ agent: "fake", text: "first" });
  const e = await w.chats.send(s.id, "second").catch((x: unknown) => x);
  expect((e as { code: string }).code).toBe("limit");
  await settled(w.chats, s.id, 1);
  await w.chats.send(s.id, "third");
  const after = await settled(w.chats, s.id, 2);
  expect(after.stop).toBe("end_turn");
});

only("Stop is session/cancel, the turn ends cancelled with no light, and the agent heard it", async () => {
  const w = world({ scenarios: { fake: { turns: [[{ thought: "thinking hard" }, { waitCancel: 8000 }]] } } });
  const s = await w.chats.create({ agent: "fake", text: "take your time" });
  await until("the turn to run", 10_000, () => summaryOf(w.chats, s.id).phase === "running");
  await until("a thought", 5000, async () => (await w.chats.read(s.id)).updates.some((u) => u.kind === "thought"));
  await w.chats.cancel(s.id);
  const done = await settled(w.chats, s.id, 1);
  expect(done.stop).toBe("cancelled");
  expect(done.light).toBe("none");
  expect(w.heard().some((h) => h.method === "session/cancel")).toBe(true);
  // A cancel with nothing running changes nothing.
  expect((await w.chats.cancel(s.id)).stop).toBe("cancelled");
});

only("permission is answered allow_always, else allow_once, and never shown", async () => {
  const w = world({
    scenarios: {
      fake: {
        turns: [
          [{ permission: {} }, { reply: "allowed" }],
          [{ permission: { options: [{ optionId: "once", name: "Once", kind: "allow_once" }, { optionId: "no", name: "No", kind: "reject_once" }] } }, { reply: "ok" }],
        ],
      },
    },
  });
  const s = await w.chats.create({ agent: "fake", text: "one" });
  await settled(w.chats, s.id, 1);
  await w.chats.send(s.id, "two");
  await settled(w.chats, s.id, 2);
  const answers = w.heard().filter((h) => h.fake === "permission").map((h) => (h.answer as { result: { outcome: unknown } }).result.outcome);
  expect(answers).toEqual([{ outcome: "selected", optionId: "yes-always" }, { outcome: "selected", optionId: "once" }]);
  const { updates } = await w.chats.read(s.id);
  expect(JSON.stringify(updates)).not.toContain("permission");
});

only("the agent's files are confined to the vault: .., a symlink out, .git refused; inside written atomically and read", async () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "biom-outside-")));
  writeFileSync(join(outside, "secret.txt"), "not yours\n");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "biom-chats-")));
  symlinkSync(outside, join(root, "link"));
  // Past what Biom reads into memory for an agent — sparse, so it costs no disk.
  spawnSync("truncate", ["-s", String(33 * 1024 * 1024), join(root, "big.bin")]);
  const w = world({
    root,
    scenarios: {
      fake: {
        turns: [[
          { write: { path: "notes/a.md", content: "hello\n" } },
          { write: { path: "../escape.txt", content: "x" } },
          { write: { path: "link/planted.txt", content: "x" } },
          { write: { path: ".git/config", content: "x" } },
          { write: { path: ".BIOM/chats/x.jsonl", content: "x" } },
          { read: { path: "big.bin" } },
          { write: { path: "big.bin", content: "small now\n" } },
          { write: { path: "/etc/biom-should-not-exist", content: "x" } },
          { read: { path: "notes/a.md" } },
          { read: { path: "link/secret.txt" } },
          { read: { path: "../../etc/hostname" } },
          { read: { path: "nope.md" } },
          { reply: "done" },
        ]],
      },
    },
  });
  const s = await w.chats.create({ agent: "fake", text: "write things" });
  await settled(w.chats, s.id, 1);
  expect(readFileSync(join(root, "notes/a.md"), "utf8")).toBe("hello\n");
  expect(existsSync(join(root, "..", "escape.txt"))).toBe(false);
  expect(existsSync(join(outside, "planted.txt"))).toBe(false);
  expect(existsSync(join(root, ".git/config"))).toBe(false);
  expect(existsSync("/etc/biom-should-not-exist")).toBe(false);

  const heard = w.heard();
  const writes = heard.filter((h) => h.fake === "write").map((h) => h.answer as { result?: unknown; error?: { code: number } });
  expect(writes[0]?.result).toEqual({});
  // .., a symlink out, .git, .biom by another case: refused; big.bin: written; /etc: refused.
  for (const r of writes.slice(1, 5)) expect(r.error?.code).toBe(-32602);
  expect(writes[5]?.result).toEqual({});
  expect(writes[6]?.error?.code).toBe(-32602);
  const reads = heard.filter((h) => h.fake === "read").map((h) => h.answer as { result?: { content: string }; error?: { code: number } });
  expect(reads[0]?.error?.code).toBe(-32602);
  expect(reads[1]?.result).toEqual({ content: "hello\n" });
  expect(reads[2]?.error?.code).toBe(-32602);
  expect(reads[3]?.error?.code).toBe(-32602);
  expect(reads[4]?.error?.code).toBe(-32002);
  expect(readFileSync(join(root, "big.bin"), "utf8")).toBe("small now\n");
  expect(w.edits.map((e) => [e.path, e.via])).toEqual([["notes/a.md", "fs"], ["big.bin", "fs"]]);
  const changed = (await w.chats.read(s.id)).updates.find((u) => u.kind === "changed") as { edits: unknown[] };
  // Too large to have been read, so edited with no count.
  expect(changed.edits).toEqual([
    { path: "notes/a.md", place: null, op: "created", added: 1, removed: 0 },
    { path: "big.bin", place: null, op: "edited" },
  ]);
});

only("every write is reported once — fs and the tool call that made it are one edit — and the turn keeps what it changed", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "biom-chats-")));
  // A vault with versions: the turn's first write is committed before.
  const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  writeFileSync(join(root, "seed.md"), "seed\n");
  mkdirSync(join(root, "pages/p"), { recursive: true });
  writeFileSync(join(root, "pages/p/content.yaml"), "a\n");
  const P = (p: string) => join(root, p);
  const w = world({
    root,
    scenarios: {
      fake: {
        turns: [[
          { tool: { toolCallId: "e1", title: "Write a.md", kind: "edit", status: "pending", content: [{ type: "diff", path: P("a.md"), oldText: null, newText: "one\n" }], locations: [{ path: P("a.md") }] } },
          { write: { path: "a.md", content: "one\n" } },
          { toolUpdate: { toolCallId: "e1", status: "completed" } },
          { write: { path: "b.md", content: "b\n" } },
          { tool: { toolCallId: "e2", title: "Write b.md", kind: "edit", status: "completed", content: [{ type: "diff", path: P("b.md"), oldText: null, newText: "b\n" }] } },
          { tool: { toolCallId: "e3", title: "Edit the page", kind: "edit", status: "in_progress", content: [{ type: "diff", path: P("pages/p/content.yaml"), oldText: "a\n", newText: "b\n" }] } },
          { toolUpdate: { toolCallId: "e3", status: "completed" } },
          { toolUpdate: { toolCallId: "e3", status: "completed" } },
          { exec: "echo hi > c.md", run: true },
          { tool: { toolCallId: "e4", title: "Edit d.md", kind: "edit", status: "failed", locations: [{ path: P("d.md") }] } },
          { tool: { toolCallId: "e5", title: "Delete seed.md", kind: "delete", status: "completed", locations: [{ path: P("seed.md") }] } },
          { tool: { toolCallId: "e6", title: "Scratch", kind: "edit", status: "completed", locations: [{ path: "/tmp/biom-scratch.md" }] } },
          { reply: "done" },
        ]],
      },
    },
  });
  git("add", "-A");
  git("commit", "-qm", "start");
  const s = await w.chats.create({ agent: "fake", text: "edit things" });
  const done = await settled(w.chats, s.id, 1);

  expect(w.edits.map((e) => [e.path, e.via])).toEqual([
    ["a.md", "fs"],
    ["b.md", "fs"],
    ["pages/p/content.yaml", "tool"],
    ["c.md", "shell"],
    ["seed.md", "tool"],
  ]);
  const writer = w.edits[0]?.writer;
  expect(writer).toEqual({ kind: "agent", agent: done.agentId as string, chat: s.id, harness: "Fake Agent", turn: 1 });

  const { updates } = await w.chats.read(s.id);
  const changed = updates.filter((u): u is ChatUpdate & { kind: "changed" } => u.kind === "changed");
  expect(changed.length).toBe(1);
  expect(changed[0]?.turn).toBe(1);
  expect(changed[0]?.edits).toEqual([
    { path: "a.md", place: null, op: "created", added: 1, removed: 0 },
    { path: "b.md", place: null, op: "created", added: 1, removed: 0 },
    { path: "pages/p/content.yaml", place: { view: "page", uid: "uid-p", screen: "page" }, op: "edited", added: 1, removed: 1 },
    { path: "c.md", place: null, op: "edited" },
    { path: "seed.md", place: null, op: "deleted" },
  ]);
  // The turn's end comes after what it changed.
  const endAt = updates.findIndex((u) => u.kind === "turn" && u.phase === "idle");
  expect(updates.findIndex((u) => u.kind === "changed")).toBeLessThan(endAt);
  // Tool lines are one each, at their last state.
  const lines = updates.filter((u): u is ChatUpdate & { kind: "tool" } => u.kind === "tool");
  expect(lines.map((l) => l.tool.id)).toEqual(["e1", "e2", "e3", "exec-1-1", "e4", "e5", "e6"]);
  expect(lines.find((l) => l.tool.id === "e3")?.tool.status).toBe("completed");
  expect(lines.find((l) => l.tool.id === "e1")?.tool.diffs[0]?.path).toBe("a.md");

  const log = git("log", "--format=%s").stdout.trim().split("\n");
  expect(log[0]).toBe("Before Fake Agent wrote in a chat");
  // ONCE for the turn, before its first write — though it wrote through Biom
  // twice (a.md, b.md).
  expect(log.filter((m) => m === "Before Fake Agent wrote in a chat").length).toBe(1);
  expect(log.length).toBe(2);
});

only("a switch mints a new agent id, and the new session is handed the chat so far", async () => {
  const w = world({ agents: [info("fake", "Fake Agent"), info("fake2", "Second Fake")], scenarios: { fake: {}, fake2: {} } });
  const s = await w.chats.create({ agent: "fake", text: "first question" });
  const one = await settled(w.chats, s.id, 1);
  const switched = await w.chats.switchAgent(s.id, "fake2");
  expect(switched.agent).toBe("fake2");
  expect(switched.harness).toBe("Second Fake");
  expect(switched.agentId).toBeNull();
  await w.chats.send(s.id, "second question");
  const two = await settled(w.chats, s.id, 2);
  expect(two.agentId).not.toBeNull();
  expect(two.agentId).not.toBe(one.agentId);
  const sent = prompts(w.heard("fake2"));
  expect(sent.length).toBe(1);
  expect(sent[0]).toContain("The person: first question");
  expect(sent[0]).toContain("Fake Agent: echo: first question");
  expect(sent[0]?.endsWith("second question")).toBe(true);
  const { updates } = await w.chats.read(s.id);
  expect(updates.filter((u) => u.kind === "agent").map((u) => (u as { agent: string }).agent)).toEqual(["fake", "fake2"]);
  // The old agent's id still names its chat for the history.
  expect(w.chats.agentOf(one.agentId as string)).toEqual({ chat: s.id, harness: "Fake Agent", turn: 2 });
  expect(w.chats.agentOfChat(s.id)).toBe(two.agentId);
});

only("A HANDOFF THE NEW AGENT REFUSED FOR WANT OF A SIGN-IN is handed over again once it is signed in, even to the session it resumes", async () => {
  const resume = { sessionCapabilities: { resume: {} } };
  const w = world({
    agents: [info("fake", "Fake Agent"), info("fake2", "Second Fake")],
    scenarios: { fake: {}, fake2: { refusePrompts: 1, agentCapabilities: resume } },
  });
  const s = await w.chats.create({ agent: "fake", text: "first question" });
  await settled(w.chats, s.id, 1);
  await w.chats.switchAgent(s.id, "fake2");
  await w.chats.send(s.id, "second question");
  await until("the refusal", 10_000, () => summaryOf(w.chats, s.id).phase === "held");
  // Signed in: seen Inactive, then Active, and it refuses nothing now.
  w.scenarios.fake2 = { agentCapabilities: resume };
  w.setAgents([info("fake", "Fake Agent"), info("fake2", "Second Fake", { state: "inactive", reason: "signin" })]);
  w.setAgents([info("fake", "Fake Agent"), info("fake2", "Second Fake")]);
  expect((await settled(w.chats, s.id, 2)).stop).toBe("end_turn");
  const heard = w.heard("fake2");
  // The session the refused prompt was meant for is the one reopened.
  expect(heard.map((h) => h.method).filter((m) => typeof m === "string")).toEqual([
    "initialize", "session/new", "session/prompt", "initialize", "session/resume", "session/prompt",
  ]);
  const sent = prompts(heard);
  // It never took the first, so the one it took carries the chat so far.
  for (const p of sent) {
    expect(p).toContain("The person: first question");
    expect(p.endsWith("second question")).toBe(true);
  }
});

only("a switch is refused while a turn runs", async () => {
  const w = world({ agents: [info("fake", "Fake Agent"), info("fake2", "Second Fake")], scenarios: { fake: { turns: [[{ sleep: 300 }]] }, fake2: {} } });
  const s = await w.chats.create({ agent: "fake", text: "slow" });
  const e = await w.chats.switchAgent(s.id, "fake2").catch((x: unknown) => x);
  expect((e as { code: string }).code).toBe("limit");
  await settled(w.chats, s.id, 1);
});

only("Stop while the agent is still starting withdraws the message and ends the start", async () => {
  const w = world({ scenarios: { fake: { initialize: { delayMs: 3000 } } } });
  const s = await w.chats.create({ agent: "fake", text: "never mind" });
  await until("the agent to start", 10_000, () => w.heard().some((h) => h.fake === "started"));
  const pid = (w.heard().find((h) => h.fake === "started") as { pid: number }).pid;
  const t0 = Date.now();
  await w.chats.cancel(s.id);
  const done = summaryOf(w.chats, s.id);
  expect([done.phase, done.stop, done.light, done.agentId]).toEqual(["idle", "cancelled", "none", null]);
  expect(Date.now() - t0).toBeLessThan(1000);
  await until("the start to be ended", 5000, () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
  expect(w.heard().some((h) => h.method === "session/prompt")).toBe(false);
  // And the next message starts afresh.
  w.scenarios.fake = {};
  await w.chats.send(s.id, "now then");
  expect((await settled(w.chats, s.id, 2)).stop).toBe("end_turn");
});

only("a first message with no agent is held, and goes out the moment one is Active", async () => {
  const w = world({ agents: [info("fake", "Fake Agent", { state: "inactive", reason: "checking" })] });
  const s = await w.chats.create({ text: "anyone there?" });
  expect(s.phase).toBe("held");
  expect(s.agent).toBeNull();
  expect(s.light).toBe("none");
  await wait(50);
  expect(summaryOf(w.chats, s.id).phase).toBe("held");
  w.setAgents([info("fake", "Fake Agent")]);
  const done = await settled(w.chats, s.id, 1);
  expect(done.agent).toBe("fake");
  expect(done.stop).toBe("end_turn");
  expect(replyOf((await w.chats.read(s.id)).updates, 1)).toBe("echo: anyone there?");
});

only("A MESSAGE TO AN AGENT THAT IS NOT ACTIVE — its Gateway down, installing, failed, checking — is held, starts nothing, and goes out the moment that agent is Active", async () => {
  for (const reason of ["gateway", "installing", "failed", "checking"] as const) {
    // No scenario until it is Active: it cannot be started before, as the
    // agents module's launch answers null for a Gateway that is down or an
    // install not yet landed.
    const w = world({ agents: [info("fake", "Fake Agent", { state: "inactive", reason })], scenarios: {} });
    const s = await w.chats.create({ agent: "fake", text: `wait for me (${reason})` });
    expect([s.phase, s.light, s.agent, s.stop]).toEqual(["held", "none", "fake", null]);
    await wait(150);
    const still = summaryOf(w.chats, s.id);
    expect([still.phase, still.stop, still.agentId]).toEqual(["held", null, null]);
    // The list moving with it still not Active sends nothing.
    w.setAgents([info("fake", "Fake Agent", { state: "inactive", reason })]);
    await wait(50);
    expect(summaryOf(w.chats, s.id).phase).toBe("held");
    expect(w.heard().some((h) => h.fake === "started")).toBe(false);
    w.scenarios.fake = {};
    w.setAgents([info("fake", "Fake Agent")]);
    const done = await settled(w.chats, s.id, 1);
    expect(done.stop).toBe("end_turn");
    expect(replyOf((await w.chats.read(s.id)).updates, 1)).toBe(`echo: wait for me (${reason})`);
  }
});

only("a later message is held the same way when its agent has no session open, and goes out on the session it has when it does", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "one" });
  await settled(w.chats, s.id, 1);
  // Its own session open: the list saying Checking — somebody pressed Look
  // again — holds nothing, because this chat's agent evidently answers.
  w.setAgents([info("fake", "Fake Agent", { state: "inactive", reason: "checking" })]);
  await w.chats.send(s.id, "two");
  expect((await settled(w.chats, s.id, 2)).stop).toBe("end_turn");
  // Closed, and its Gateway down: the next message waits for it.
  await w.chats.close(s.id);
  w.setAgents([info("fake", "Fake Agent", { state: "inactive", reason: "gateway" })]);
  const held = await w.chats.send(s.id, "three");
  expect([held.phase, held.agentId]).toEqual(["held", null]);
  w.setAgents([info("fake", "Fake Agent")]);
  expect((await settled(w.chats, s.id, 3)).stop).toBe("end_turn");
  expect(prompts(w.heard()).at(-1)).toContain("three");
});

only("a switch on a held chat re-targets it and mints nothing until that agent is Active", async () => {
  const w = world({
    agents: [info("fake", "Fake Agent", { state: "inactive", reason: "signin" }), info("fake2", "Second Fake", { state: "inactive", reason: "checking" })],
    scenarios: { fake: {}, fake2: {} },
  });
  const s = await w.chats.create({ text: "hold me" });
  const re = await w.chats.switchAgent(s.id, "fake2");
  expect(re.agent).toBe("fake2");
  expect(re.agentId).toBeNull();
  expect(re.phase).toBe("held");
  expect((await w.chats.read(s.id)).updates.some((u) => u.kind === "agent")).toBe(false);
  w.setAgents([info("fake", "Fake Agent", { state: "inactive" }), info("fake2", "Second Fake")]);
  const done = await settled(w.chats, s.id, 1);
  expect(done.agent).toBe("fake2");
  expect(prompts(w.heard("fake2"))).toEqual(["hold me"]);
});

only("an agent that refuses for want of a sign-in: told to the agents module, the message held, and sent once it is signed in", async () => {
  const marker = join(realpathSync(mkdtempSync(join(tmpdir(), "biom-signin-"))), "signed-in");
  const w = world({ scenarios: { fake: { session: { refuseUnless: marker } } } });
  const s = await w.chats.create({ agent: "fake", text: "please" });
  await until("the refusal", 10_000, () => summaryOf(w.chats, s.id).phase === "held");
  expect(w.refused).toEqual(["fake"]);
  expect(summaryOf(w.chats, s.id).agentId).toBeNull();
  const { updates } = await w.chats.read(s.id);
  expect(updates.some((u) => u.kind === "error" && u.message.includes("sign in"))).toBe(true);
  // The list it was refused against goes out again: that is no sign-in, and
  // nothing is retried.
  w.setAgents([info("fake", "Fake Agent")]);
  await wait(300);
  expect(summaryOf(w.chats, s.id).phase).toBe("held");
  expect(w.heard().filter((h) => h.method === "initialize").length).toBe(1);
  // Inactive with `signin`, then Active after the person signed in.
  w.setAgents([info("fake", "Fake Agent", { state: "inactive", reason: "signin" })]);
  writeFileSync(marker, "yes\n");
  w.setAgents([info("fake", "Fake Agent")]);
  const done = await settled(w.chats, s.id, 1);
  expect(done.stop).toBe("end_turn");
  expect(replyOf((await w.chats.read(s.id)).updates, 1)).toBe("echo: please");
});

only("a refusal of the message itself is held the same way", async () => {
  const w = world({ scenarios: { fake: { refusePrompts: 1 } } });
  const s = await w.chats.create({ agent: "fake", text: "try" });
  await until("the refusal", 10_000, () => summaryOf(w.chats, s.id).phase === "held");
  expect(w.refused).toEqual(["fake"]);
  // A new process, and it signs nobody out: the second prompt is answered.
  w.scenarios.fake = {};
  w.setAgents([info("fake", "Fake Agent", { state: "inactive", reason: "signin" })]);
  w.setAgents([info("fake", "Fake Agent")]);
  const done = await settled(w.chats, s.id, 1);
  expect(done.stop).toBe("end_turn");
});

only("a crash mid-turn is red with a sentence, stays red until the next turn starts, and the next message starts a new agent", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "go\n!crash" });
  const dead = await settled(w.chats, s.id, 1);
  expect(dead.stop).toBe("crashed");
  expect(dead.light).toBe("error");
  expect(dead.reason).toContain("stopped in the middle of the turn");
  const first = (await w.chats.read(s.id)).updates.find((u) => u.kind === "agent") as { agentId: string };
  await until("the dead agent to be let go", 3000, () => summaryOf(w.chats, s.id).agentId === null);
  expect(summaryOf(w.chats, s.id).light).toBe("error");
  w.skewBy(GREEN_MS * 3);
  expect(summaryOf(w.chats, s.id).light).toBe("error");
  const again = await w.chats.send(s.id, "again");
  expect(again.light).toBe("working");
  const ok = await settled(w.chats, s.id, 2);
  expect(ok.light).toBe("done");
  expect(ok.agentId).not.toBe(first.agentId);
});

only("AN AGENT THAT GOES WHILE ITS SESSION OPENS ends the turn red with a sentence, however late its output ends, and the next message starts it again", async () => {
  // It exits on `session/new` while a child of its group still holds its
  // stdout, so the exit is seen before the output's end — the order in which
  // a start was once left `starting` for ever.
  const w = world({ scenarios: { fake: { session: { exitOn: ["session/new"] } } } });
  const s = await w.chats.create({ agent: "fake", text: "hello" });
  const dead = await settled(w.chats, s.id, 1);
  expect([dead.stop, dead.light, dead.agentId]).toEqual(["crashed", "error", null]);
  expect(dead.reason).toBe("Fake Agent stopped before it was ready");
  expect(w.heard().some((h) => h.method === "session/prompt")).toBe(false);
  w.scenarios.fake = {};
  await w.chats.send(s.id, "again");
  const ok = await settled(w.chats, s.id, 2);
  expect(ok.stop).toBe("end_turn");
  expect(prompts(w.heard()).at(-1)?.endsWith("again")).toBe(true);
});

only("an agent that goes while its session is RESUMED ends the turn red the same way", async () => {
  const resume = { sessionCapabilities: { resume: {} } };
  const w = world({ scenarios: { fake: { agentCapabilities: resume } } });
  const s = await w.chats.create({ agent: "fake", text: "first" });
  await settled(w.chats, s.id, 1);
  await w.chats.close(s.id);
  w.scenarios.fake = { agentCapabilities: resume, session: { exitOn: ["session/resume"] } };
  await w.chats.send(s.id, "second");
  const dead = await settled(w.chats, s.id, 2);
  expect([dead.stop, dead.light]).toEqual(["crashed", "error"]);
  expect(dead.reason).toBe("Fake Agent stopped before it was ready");
  expect(w.heard().filter((h) => h.method === "session/resume").length).toBe(1);
});

only("green lasts ten minutes and then there is no light", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "hi" });
  expect((await settled(w.chats, s.id, 1)).light).toBe("done");
  w.skewBy(GREEN_MS + 1);
  expect(summaryOf(w.chats, s.id).light).toBe("none");
});

only("A GREEN LIGHT READ BACK AFTER A RESTART goes out when its ten minutes run out, with a push that says so", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "hi" });
  expect((await settled(w.chats, s.id, 1)).light).toBe("done");
  await w.chats.endAll();
  // The server comes back with less than half a second of the ten minutes left.
  w.skewBy(GREEN_MS - 400);
  const from = w.pushes.length;
  const again = w.make();
  await again.loaded;
  expect(summaryOf(again, s.id).light).toBe("done");
  await until("a push saying the light went out", 3000, () => w.pushes.slice(from).some((p) => p.chat.id === s.id && p.chat.light === "none"));
  expect(summaryOf(again, s.id).light).toBe("none");
});

only("A TURN'S END READ BACK FROM AHEAD OF THE CLOCK counts as now: its light is green for ten minutes and then goes out, and no timer past ten minutes is ever armed", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "hi" });
  await settled(w.chats, s.id, 1);
  await w.chats.endAll();
  // The clock is put back forty days — a reset RTC before NTP, a snapshot
  // restored — so the turn's recorded end is weeks ahead of it.
  w.skewBy(-40 * 24 * 60 * 60_000);
  const real = globalThis.setTimeout;
  let long = 0;
  const spy = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    if (typeof ms === "number" && ms > GREEN_MS) long++;
    return real(fn, ms, ...rest);
  }) as unknown as typeof setTimeout;
  globalThis.setTimeout = spy;
  let again: Chats;
  try {
    again = w.make();
    await again.loaded;
    await wait(300);
  } finally {
    globalThis.setTimeout = real;
  }
  expect(long).toBe(0);
  expect(summaryOf(again, s.id).light).toBe("done");
  w.skewBy(GREEN_MS + 1);
  expect(summaryOf(again, s.id).light).toBe("none");
});

only("an agent that cannot be started, or answers the message with an error, ends the turn red with a sentence", async () => {
  const w = world({ agents: [info("fake", "Fake Agent"), info("ghost", "Ghost Agent")], scenarios: { fake: { turns: [[{ error: { code: -32603, message: "the model is\nbusy" } }]] } } });
  const a = await w.chats.create({ agent: "ghost", text: "hello?" });
  const ghost = await settled(w.chats, a.id, 1);
  expect(ghost.stop).toBe("crashed");
  expect(ghost.reason).toBe("Ghost Agent could not be started on this machine");
  const b = await w.chats.create({ agent: "fake", text: "hello" });
  const err = await settled(w.chats, b.id, 1);
  expect(err.stop).toBe("crashed");
  expect(err.reason).toBe("Fake Agent answered with an error: the model is busy");
});

only("a refusal stop reason is red and says which", async () => {
  const w = world({ scenarios: { fake: { turns: [[{ reply: "no" }, { stop: "refusal" }], [{ stop: "max_tokens" }]] } } });
  const s = await w.chats.create({ agent: "fake", text: "do the bad thing" });
  const r = await settled(w.chats, s.id, 1);
  expect([r.stop, r.light]).toEqual(["refusal", "error"]);
  expect(r.reason).toBe("Fake Agent refused to carry on with this");
  await w.chats.send(s.id, "write a lot");
  const m = await settled(w.chats, s.id, 2);
  expect([m.stop, m.light]).toEqual(["max_tokens", "error"]);
});

only("the kept log survives a restart, and a turn the server died in is ended crashed", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "remember this" });
  await settled(w.chats, s.id, 1);
  w.chats.face(s.id, null, { emoji: "🧹", art: null });
  w.chats.face(s.id, 1, { emoji: "🤓", art: "/vendor/noto/1f913.webp" });
  const before = await w.chats.read(s.id);
  await w.chats.endAll();

  const again = w.make();
  await again.loaded;
  const back = again.list().find((c) => c.id === s.id) as ChatSummary;
  expect(back.name).toBe("remember this");
  expect(back.face).toEqual({ emoji: "🧹", art: null });
  expect(back.turn).toBe(1);
  expect(back.stop).toBe("end_turn");
  expect(back.agentId).toBeNull();
  expect(back.agent).toBe("fake");
  const read = await again.read(s.id);
  expect(read.updates).toEqual(before.updates);

  // A turn in flight when the server is killed outright.
  // Each process counts its own prompts, so the message steers this one.
  await again.send(s.id, "long one\n!sleep 5000");
  await until("the turn to run", 10_000, () => summaryOf(again, s.id).phase === "running");
  await wait(100);
  again.killAll();
  const third = w.make();
  await third.loaded;
  const cut = third.list().find((c) => c.id === s.id) as ChatSummary;
  expect(cut.stop).toBe("crashed");
  expect(cut.reason).toBe("Biom stopped during this turn");
  expect(cut.phase).toBe("idle");
  const r3 = await third.read(s.id);
  expect(r3.updates[r3.updates.length - 1]).toMatchObject({ kind: "turn", phase: "idle", stop: "crashed", turn: 2 });
  // And it goes on: the next message is turn three.
  await third.send(s.id, "and now");
  expect((await settled(third, s.id, 3)).stop).toBe("end_turn");
});

only("reopening uses session/resume where the agent offers it — no new session, nothing handed over", async () => {
  const w = world({ scenarios: { fake: { agentCapabilities: { sessionCapabilities: { resume: {} } } } } });
  const s = await w.chats.create({ agent: "fake", text: "first" });
  await settled(w.chats, s.id, 1);
  await w.chats.close(s.id);
  expect(summaryOf(w.chats, s.id).agentId).toBeNull();
  await w.chats.send(s.id, "second");
  await settled(w.chats, s.id, 2);
  const heard = w.heard();
  const opened = heard.filter((h) => h.method === "session/new");
  const resumed = heard.filter((h) => h.method === "session/resume");
  expect(opened.length).toBe(1);
  expect(resumed.length).toBe(1);
  const logged = (await w.chats.read(s.id)).updates;
  expect(logged.filter((u) => u.kind === "agent").length).toBe(2);
  expect((resumed[0]?.params as { sessionId: string }).sessionId).toMatch(/^fake-session-/);
  expect(prompts(heard)).toEqual(["first", "second"]);
});

only("reopening uses session/load where only that is offered, and its replay is not recorded again", async () => {
  const w = world({ scenarios: { fake: { agentCapabilities: { loadSession: true }, session: { replay: [{ user: "first", agent: "an old reply from the replay" }] } } } });
  const s = await w.chats.create({ agent: "fake", text: "first" });
  await settled(w.chats, s.id, 1);
  await w.chats.close(s.id);
  await w.chats.send(s.id, "second");
  await settled(w.chats, s.id, 2);
  const heard = w.heard();
  expect(heard.filter((h) => h.method === "session/load").length).toBe(1);
  expect(heard.filter((h) => h.method === "session/new").length).toBe(1);
  expect(prompts(heard)).toEqual(["first", "second"]);
  expect(JSON.stringify((await w.chats.read(s.id)).updates)).not.toContain("an old reply from the replay");
});

only("an agent that can neither resume nor load gets a new session, handed the chat so far", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "first" });
  await settled(w.chats, s.id, 1);
  await w.chats.close(s.id);
  await w.chats.send(s.id, "second");
  await settled(w.chats, s.id, 2);
  const heard = w.heard();
  expect(heard.filter((h) => h.method === "session/new").length).toBe(2);
  const sent = prompts(heard);
  expect(sent[0]).toBe("first");
  expect(sent[1]).toContain("The person: first");
  expect(sent[1]).toContain("Fake Agent: echo: first");
  expect(sent[1]?.endsWith("\n\nsecond")).toBe(true);
});

only("config: a value picked before the agent starts is shown at once and applied before the first message", async () => {
  const model = {
    id: "model", name: "Model", category: "model", type: "select", currentValue: "m1",
    options: [{ value: "m1", name: "Model One" }, { value: "m2", name: "Model Two" }],
  };
  const probe = [{ id: "model", name: "Model", category: "model" as const, type: "select" as const, value: "m1", choices: [{ value: "m1", name: "Model One", description: null, group: null }, { value: "m2", name: "Model Two", description: null, group: null }] }];
  const w = world({ agents: [info("fake", "Fake Agent", { options: probe })], scenarios: { fake: { session: { configOptions: [model] } } } });
  const s = await w.chats.create({ agent: "fake", config: { model: "m2" } });
  let { updates } = await w.chats.read(s.id);
  const shown = updates.filter((u): u is ChatUpdate & { kind: "config" } => u.kind === "config");
  expect(shown[shown.length - 1]?.options[0]?.value).toBe("m2");
  expect(((await w.chats.config(s.id, "nope", "x").catch((e: unknown) => e)) as { code: string }).code).toBe("not_found");
  expect(((await w.chats.config(s.id, "model", "m9").catch((e: unknown) => e)) as { code: string }).code).toBe("bad_request");
  await w.chats.send(s.id, "hi");
  await settled(w.chats, s.id, 1);
  const heard = w.heard();
  const set = heard.findIndex((h) => h.method === "session/set_config_option");
  const prompt = heard.findIndex((h) => h.method === "session/prompt");
  expect(set).toBeGreaterThan(-1);
  expect(set).toBeLessThan(prompt);
  expect(heard[set]?.params).toMatchObject({ configId: "model", value: "m2" });
  ({ updates } = await w.chats.read(s.id));
  const last = updates.filter((u): u is ChatUpdate & { kind: "config" } => u.kind === "config").pop();
  expect(last?.options[0]?.value).toBe("m2");
  // Picked while idle with the agent running, it is applied at once — and the
  // call does not wait for the agent to answer.
  await w.chats.config(s.id, "model", "m1");
  await until("the second change to reach the agent", 5000, () => w.heard().filter((h) => h.method === "session/set_config_option").length === 2);
});

/* ── the kept choices ─────────────────────────────────────────────────── */

/** The fake's session options, as ACP sends them, and as the probe keeps them. */
const RAW_MODEL = {
  id: "model", name: "Model", category: "model", type: "select", currentValue: "m1",
  options: [{ value: "m1", name: "Model One" }, { value: "m2", name: "Model Two" }],
};
const RAW_MODE = {
  id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "ask",
  options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code" }],
};
const RAW_STYLE = { id: "style", name: "Style", category: "other", type: "select", currentValue: "plain", options: [{ value: "plain", name: "Plain" }, { value: "fancy", name: "Fancy" }] };
const probeOf = (raw: Record<string, unknown>[]) =>
  raw.map((o) => ({
    id: String(o.id), name: String(o.name), category: o.category as "model" | "mode" | "other", type: "select" as const, value: String(o.currentValue),
    choices: (o.options as { value: string; name: string }[]).map((c) => ({ value: c.value, name: c.name, description: null, group: null })),
  }));

/** The config set on the agent before its first prompt, in order. */
const setBeforePrompt = (heard: Record<string, unknown>[]): unknown[] => {
  const prompt = heard.findIndex((h) => h.method === "session/prompt");
  return heard.slice(0, prompt < 0 ? heard.length : prompt).filter((h) => h.method === "session/set_config_option").map((h) => h.params);
};
const lastConfig = (updates: ChatUpdate[]) => updates.filter((u): u is ChatUpdate & { kind: "config" } => u.kind === "config").pop()?.options ?? [];

only("THE CHOICES ARE KEPT: the agent a chat is made with or switched to, and each picker set, and nothing that is no picker", async () => {
  const kept: unknown[][] = [];
  const probe = probeOf([RAW_MODEL, RAW_MODE, RAW_STYLE]);
  const w = world({
    agents: [info("fake", "Fake Agent", { options: probe }), info("other", "Other Agent", { options: probe })],
    scenarios: { fake: { session: { configOptions: [RAW_MODEL, RAW_MODE, RAW_STYLE] } }, other: {} },
    keep: { saved: () => ({}), picked: (key) => void kept.push(["picked", key]), chose: (key, cat, value) => void kept.push(["chose", key, cat, value]) },
  });
  // A chat made from the start screen: its agent, and the pickers it was set
  // to there — one the list does not offer is not kept.
  const s = await w.chats.create({ agent: "fake", config: { mode: "code", style: "fancy", model: "m9" } });
  expect(kept).toEqual([["picked", "fake"], ["chose", "fake", "mode", "code"]]);
  kept.length = 0;
  // A picker set in the chat is kept; an option that is no picker is not.
  await w.chats.config(s.id, "model", "m2");
  await w.chats.config(s.id, "style", "plain");
  expect(kept).toEqual([["chose", "fake", "model", "m2"]]);
  kept.length = 0;
  // A switch keeps the agent switched to; a switch to the same one is none.
  await w.chats.switchAgent(s.id, "fake");
  expect(kept).toEqual([]);
  await w.chats.switchAgent(s.id, "other");
  expect(kept).toEqual([["picked", "other"]]);
  // A chat nobody named an agent for, which took the first Active one, kept
  // nothing: that was no pick.
  kept.length = 0;
  await w.chats.create({});
  expect(kept).toEqual([]);
});

only("A NEW CHAT STARTS ON THE KEPT CHOICES AFTER A RESTART: shown at once, and set on the agent before its first message", async () => {
  const biom = realpathSync(mkdtempSync(join(tmpdir(), "biom-kept-")));
  const keeper = () => {
    const settings = makeSettings({ files: makeFiles(biom), log: () => {} });
    return { settings, keep: { saved: (k: string) => settings.saved(k), picked: (k: string) => settings.picked(k), chose: settings.chose } };
  };
  const probe = probeOf([RAW_MODEL, RAW_MODE]);
  const agents = [info("fake", "Fake Agent", { options: probe })];
  const scenarios = { fake: { session: { configOptions: [RAW_MODEL, RAW_MODE] } } };

  const first = keeper();
  await first.settings.loaded;
  const w = world({ agents, scenarios, keep: first.keep });
  const a = await w.chats.create({ agent: "fake" });
  await w.chats.config(a.id, "model", "m2");
  await w.chats.config(a.id, "mode", "code");
  await first.settings.flushed();
  await w.chats.endAll();

  // THE SERVER STARTS AGAIN: new settings read from the same file, new chats.
  const second = keeper();
  await second.settings.loaded;
  expect(second.settings.read()).toMatchObject({ agent: "fake", agents: { fake: { model: "m2", mode: "code" } } });
  const w2 = world({ root: w.root, agents, scenarios: { fake: { session: { configOptions: [{ ...RAW_MODEL }, { ...RAW_MODE }] } } }, keep: second.keep });
  const b = await w2.chats.create({ agent: "fake", text: "hello" });
  const shown = lastConfig((await w2.chats.read(b.id)).updates);
  expect(shown.map((o) => [o.id, o.value])).toEqual([["model", "m2"], ["mode", "code"]]);
  await settled(w2.chats, b.id, 1);
  expect(setBeforePrompt(w2.heard())).toEqual([{ sessionId: expect.any(String), configId: "model", value: "m2" }, { sessionId: expect.any(String), configId: "mode", value: "code" }]);
  // What the person sets for a new chat wins over what was kept.
  const c = await w2.chats.create({ agent: "fake", config: { model: "m1" } });
  expect(lastConfig((await w2.chats.read(c.id)).updates).map((o) => [o.id, o.value])).toEqual([["model", "m1"], ["mode", "code"]]);
});

only("a kept value the agent no longer offers is skipped without a word, and the rest still apply", async () => {
  const w = world({
    agents: [info("fake", "Fake Agent", { options: probeOf([RAW_MODEL, RAW_MODE]) })],
    scenarios: { fake: { session: { configOptions: [RAW_MODEL, RAW_MODE] } } },
    keep: { saved: () => ({ model: "retired-model", mode: "code", thought_level: "high" }) },
  });
  const s = await w.chats.create({ agent: "fake", text: "hello" });
  await settled(w.chats, s.id, 1);
  const { updates } = await w.chats.read(s.id);
  expect(lastConfig(updates).map((o) => [o.id, o.value])).toEqual([["model", "m1"], ["mode", "code"]]);
  expect(setBeforePrompt(w.heard())).toEqual([{ sessionId: expect.any(String), configId: "mode", value: "code" }]);
  expect(updates.some((u) => u.kind === "error")).toBe(false);
});

only("an agent whose list was not known when the chat was made starts on its kept choices once its own session says what it offers", async () => {
  const w = world({
    // The probe has not said what the agent offers yet.
    agents: [info("fake", "Fake Agent", { options: [] })],
    scenarios: { fake: { session: { configOptions: [RAW_MODEL, RAW_MODE] } } },
    keep: { saved: () => ({ model: "m2", mode: "no-such-mode" }) },
  });
  const s = await w.chats.create({ agent: "fake", text: "hello" });
  await settled(w.chats, s.id, 1);
  expect(setBeforePrompt(w.heard())).toEqual([{ sessionId: expect.any(String), configId: "model", value: "m2" }]);
  expect(lastConfig((await w.chats.read(s.id)).updates).map((o) => [o.id, o.value])).toEqual([["model", "m2"], ["mode", "ask"]]);
  // Owed once: the next message sets nothing again.
  await w.chats.send(s.id, "again");
  await settled(w.chats, s.id, 2);
  expect(w.heard().filter((h) => h.method === "session/set_config_option").length).toBe(1);
});

only("a switch to another agent starts it on that agent's kept choices", async () => {
  const probe = probeOf([RAW_MODEL]);
  const w = world({
    agents: [info("fake", "Fake Agent", { options: probe }), info("other", "Other Agent", { options: probe })],
    scenarios: { fake: {}, other: { session: { configOptions: [RAW_MODEL] } } },
    keep: { saved: (key) => (key === "other" ? { model: "m2" } : {}) },
  });
  const s = await w.chats.create({ agent: "fake", text: "first" });
  await settled(w.chats, s.id, 1);
  await w.chats.switchAgent(s.id, "other");
  expect(lastConfig((await w.chats.read(s.id)).updates).map((o) => [o.id, o.value])).toEqual([["model", "m2"]]);
  await w.chats.send(s.id, "second");
  await settled(w.chats, s.id, 2);
  expect(setBeforePrompt(w.heard("other"))).toEqual([{ sessionId: expect.any(String), configId: "model", value: "m2" }]);
});

only("the / menu: the probe's commands, then the session's, and every workspace skill the agent did not list; a skill it did not list goes out as a pointer", async () => {
  const probeCommands = [
    { name: "compact", description: "Summarise the chat so far", hint: null, source: "agent" as const, skill: null },
    { name: "biom-pages", description: "the agent's own copy", hint: null, source: "agent" as const, skill: null },
  ];
  const w = world({
    agents: [info("fake", "Fake Agent", { commands: probeCommands })],
    scenarios: { fake: { session: { commands: [{ name: "review", description: "Review the diff", input: { hint: "what" } }] } } },
  });
  const s = await w.chats.create({ agent: "fake" });
  expect((await w.chats.commands({ chat: s.id })).map((c) => [c.name, c.source])).toEqual([
    ["compact", "agent"], ["biom-pages", "agent"], ["office-hours", "skill"],
  ]);
  expect((await w.chats.commands({})).map((c) => c.name)).toEqual(["biom-pages", "office-hours"]);
  await w.chats.send(s.id, "/office-hours is this any good");
  await settled(w.chats, s.id, 1);
  await until("the session's own commands", 3000, async () => (await w.chats.commands({ chat: s.id })).some((c) => c.name === "review"));
  const menu = await w.chats.commands({ chat: s.id });
  expect(menu).toEqual([
    { name: "review", description: "Review the diff", hint: "what", source: "agent", skill: null },
    { name: "biom-pages", description: "How a page is written", hint: null, source: "skill", skill: ".agents/skills/biom-pages/SKILL.md" },
    { name: "office-hours", description: "Pressure-test an idea", hint: null, source: "skill", skill: ".agents/skills/office-hours/SKILL.md" },
  ]);
  const { updates } = await w.chats.read(s.id);
  const lastMenu = updates.filter((u): u is ChatUpdate & { kind: "commands" } => u.kind === "commands").pop();
  expect(lastMenu?.commands).toEqual(menu);
  expect(prompts(w.heard())[0]).toBe('Use the workspace skill "office-hours": read .agents/skills/office-hours/SKILL.md and follow it.\n\nis this any good');
  // The person's words are kept as typed.
  expect(updates.find((u) => u.kind === "prompt")).toMatchObject({ text: "/office-hours is this any good" });
});

only("the agent's own title does not rename the chat — named once, from its first message — usage and plan are kept, and a face is kept per turn", async () => {
  const w = world({
    scenarios: {
      fake: { turns: [[{ title: "Tidying the boards page" }, { usage: { used: 10, size: 100 } }, { plan: [{ content: "look", priority: "high", status: "pending" }] }, { garbage: "not json" }, { partial: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "in pieces" } } }]] },
    },
  });
  const s = await w.chats.create({ agent: "fake", text: "tidy up" });
  const done = await settled(w.chats, s.id, 1);
  // `session_info_update` arrives and is not drawn yet (*Chat*, `acp`); the
  // name's face was picked for the name the chat was given.
  expect(done.name).toBe("tidy up");
  w.chats.face(s.id, 1, { emoji: "😌", art: null });
  w.chats.face(s.id, 9, { emoji: "😌", art: null });
  const { updates } = await w.chats.read(s.id);
  expect(updates.filter((u) => u.kind === "name").map((u) => (u as { name: string }).name)).toEqual(["tidy up"]);
  expect(updates.find((u) => u.kind === "usage")).toMatchObject({ used: 10, size: 100, cost: null });
  expect(updates.find((u) => u.kind === "plan")).toMatchObject({ entries: [{ content: "look", priority: "high", status: "pending" }] });
  expect(replyOf(updates, 1)).toBe("in pieces");
  expect(updates.filter((u) => u.kind === "face")).toMatchObject([{ turn: 1, face: { emoji: "😌", art: null } }]);
});

only("killAll ends every agent at once, and endAll ends a turn in flight crashed", async () => {
  const w = world({ scenarios: { fake: { turns: [[{ sleep: 10_000 }]] } } });
  const a = await w.chats.create({ agent: "fake", text: "one" });
  await until("the turn to run", 10_000, () => summaryOf(w.chats, a.id).phase === "running");
  const pid = (w.heard().find((h) => h.fake === "started") as { pid: number }).pid;
  w.chats.killAll();
  await until("the agent to be gone", 5000, () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
  const w2 = world({ scenarios: { fake: { turns: [[{ sleep: 10_000 }]] } } });
  const b = await w2.chats.create({ agent: "fake", text: "two" });
  await until("the turn to run", 10_000, () => summaryOf(w2.chats, b.id).phase === "running");
  await w2.chats.endAll();
  const s = summaryOf(w2.chats, b.id);
  expect([s.phase, s.stop, s.agentId]).toEqual(["idle", "crashed", null]);
  expect(((await w2.chats.send(b.id, "more").catch((e: unknown) => e)) as { code: string }).code).toBe("unsupported");
});

test("an unknown chat is not_found and an empty message is bad_request", async () => {
  const w = world();
  expect(((await w.chats.read("no-such-chat").catch((e: unknown) => e)) as { code: string }).code).toBe("not_found");
  const s = await w.chats.create({ agent: "fake" });
  expect(((await w.chats.send(s.id, "   ").catch((e: unknown) => e)) as { code: string }).code).toBe("bad_request");
  expect(s.phase).toBe("idle");
  expect(s.page).toBeNull();
  const onPage = await w.chats.create({ agent: "fake", page: "home/Specs" });
  expect(onPage.page).toEqual({ view: "page", uid: "uid-home/Specs", screen: "page" });
});

test("the workspace's skills: each folder's SKILL.md, named and described by its frontmatter", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "biom-skills-")));
  const put = (rel: string, text: string) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put(".agents/skills/plain/SKILL.md", "---\nname: plain\ndescription: A plain one, invented.\n---\n\n# Plain\n");
  put(".agents/skills/quoted/SKILL.md", '---\nname: quoted-name\ndescription: "Quoted: with a colon, invented."\n---\nbody\n');
  put(".agents/skills/folded/SKILL.md", "---\nname: folded\ndescription: >\n  Folded over\n  two lines.\n---\n");
  put(".agents/skills/bare/SKILL.md", "# No frontmatter at all\n");
  put(".agents/skills/broken/SKILL.md", "---\nname: [unclosed\n---\n");
  put(".agents/skills/empty-dir/README.md", "not a skill\n");
  put(".agents/skills/_lib/SKILL.md", "---\nname: lib\n---\n");
  put(".agents/skills/check.ts", "// the checker\n");
  const skills = await readSkills(makeFiles(root));
  expect(skills.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    { name: "bare", description: "", path: ".agents/skills/bare/SKILL.md" },
    { name: "broken", description: "", path: ".agents/skills/broken/SKILL.md" },
    { name: "folded", description: "Folded over two lines.", path: ".agents/skills/folded/SKILL.md" },
    { name: "plain", description: "A plain one, invented.", path: ".agents/skills/plain/SKILL.md" },
    { name: "quoted-name", description: "Quoted: with a colon, invented.", path: ".agents/skills/quoted/SKILL.md" },
  ]);
  expect(await readSkills(makeFiles(join(root, "nowhere")))).toEqual([]);
});

only("a line torn by a crash spoils only itself: the chat reads back, and the next line starts clean", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "before the tear" });
  await settled(w.chats, s.id, 1);
  await w.chats.endAll();
  const file = join(w.root, ".biom", "chats", `${s.id}.jsonl`);
  appendFileSync(file, '{"t":"u","u":{"seq":999,"kind":"reply","te');
  const again = w.make();
  await again.loaded;
  await again.send(s.id, "after the tear");
  await settled(again, s.id, 2);
  await again.endAll();
  const third = w.make();
  await third.loaded;
  const { updates } = await third.read(s.id);
  expect(updates.filter((u) => u.kind === "prompt").map((u) => (u as { text: string }).text)).toEqual(["before the tear", "after the tear"]);
  expect(updates.some((u) => u.seq === 999)).toBe(false);
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
  expect(lines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } }).length).toBe(1);
});

only("a tool line updated many times is one line in memory, and the log is rewritten compact at the turn's end", async () => {
  const steps: Record<string, unknown>[] = [{ tool: { toolCallId: "busy", title: "Counting", kind: "other", status: "in_progress" } }];
  for (let i = 0; i < 260; i++) steps.push({ toolUpdate: { toolCallId: "busy", content: [{ type: "content", content: { type: "text", text: `step ${i}` } }] } });
  steps.push({ sleep: 50 }, { toolUpdate: { toolCallId: "busy", status: "completed" } }, { reply: "counted" });
  const w = world({ scenarios: { fake: { turns: [steps as never] } } });
  const s = await w.chats.create({ agent: "fake", text: "count" });
  await settled(w.chats, s.id, 1);
  const { updates } = await w.chats.read(s.id);
  const lines = updates.filter((u) => u.kind === "tool");
  expect(lines.length).toBe(1);
  expect((lines[0] as { tool: { status: string; output: string } }).tool).toMatchObject({ status: "completed", output: "step 259" });
  await w.chats.endAll();
  const file = join(w.root, ".biom", "chats", `${s.id}.jsonl`);
  const kept = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
  expect(kept.filter((l) => l.includes('"kind":"tool"')).length).toBeLessThan(5);
  const again = w.make();
  await again.loaded;
  expect((await again.read(s.id)).updates).toEqual(updates);
});

/* ── an agent that wants `authenticate` in every process ───────────────── */

only("AN AGENT THAT WANTS AUTHENTICATE IN EVERY PROCESS is authenticated before its session, with the method that signed it in, and its chat works", async () => {
  // Grok Build, Cursor and Junie refuse a session in any process that has not
  // called `authenticate`, even when the person is signed in. Invented method.
  const w = world({
    scenarios: { fake: { authMethods: [{ id: "invented-account", name: "Invented account" }], session: { requireAuthenticate: true } } },
    signedInWith: (key) => (key === "fake" ? "invented-account" : null),
  });
  const made = await w.chats.create({ agent: "fake", text: "Are you there?" });
  const done = await settled(w.chats, made.id, 1);
  expect([done.stop, done.light]).toEqual(["end_turn", "done"]);
  expect(replyOf((await w.chats.read(made.id)).updates, 1)).toContain("echo: Are you there?");
  const methods = w.heard().map((h) => h.method).filter((m) => typeof m === "string");
  expect(methods.slice(0, 3)).toEqual(["initialize", "authenticate", "session/new"]);
  expect((w.heard().find((h) => h.method === "authenticate")!.params as { methodId: string }).methodId).toBe("invented-account");
  expect(w.refused).toEqual([]);
});

only("an agent that needs no authenticate is never sent one: a chat does not risk signing the person out", async () => {
  const w = world();
  const made = await w.chats.create({ agent: "fake", text: "Hello." });
  await settled(w.chats, made.id, 1);
  expect(w.heard().some((h) => h.method === "authenticate")).toBe(false);
});

only("an authenticate the agent refuses is a sign-in refusal, and the message waits for the person to sign in", async () => {
  const w = world({
    scenarios: { fake: { authMethods: [{ id: "invented-account", name: "Invented account" }], session: { requireAuthenticate: true } } },
    // A method the agent does not offer any more.
    signedInWith: () => "a-method-it-dropped",
  });
  const made = await w.chats.create({ agent: "fake", text: "Hello." });
  await until("the sign-in refusal", 15_000, () => w.refused.length > 0);
  expect(w.refused).toEqual(["fake"]);
  expect(summaryOf(w.chats, made.id).phase).toBe("held");
});

/* ── an idle agent is ended ───────────────────────────────────────────── */

const alivePid = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const startedPids = (heard: Record<string, unknown>[]): number[] =>
  heard.filter((h) => h.fake === "started").map((h) => h.pid as number);

only("AN IDLE AGENT IS ENDED: no turn for thirty minutes and open in no window, and the next message starts a new one handed the chat", async () => {
  const open = new Set<string>();
  const w = world({ openIn: () => [...open] });
  const made = await w.chats.create({ agent: "fake", text: "Remember the word heron." });
  await settled(w.chats, made.id, 1);
  const first = summaryOf(w.chats, made.id).agentId;
  expect(first).not.toBeNull();
  const [pid] = startedPids(w.heard());

  // Twenty-nine minutes is not idle enough.
  w.skewBy(29 * 60_000);
  expect(w.chats.reap()).toBe(0);
  // Past thirty, a chat open in a window keeps its agent.
  open.add(made.id);
  w.skewBy(2 * 60_000);
  expect(w.chats.reap()).toBe(0);
  expect(summaryOf(w.chats, made.id).agentId).toBe(first);
  // Open in no window, it is ended.
  open.delete(made.id);
  expect(w.chats.reap()).toBe(1);
  expect(summaryOf(w.chats, made.id).agentId).toBeNull();
  await until("the idle agent to be gone", 5_000, () => !alivePid(pid as number));
  // Nothing is ended twice.
  expect(w.chats.reap()).toBe(0);

  // The next message starts it again, under a new id, and hands it the chat.
  await w.chats.send(made.id, "What was the word?");
  const done = await settled(w.chats, made.id, 2);
  expect(done.stop).toBe("end_turn");
  const second = summaryOf(w.chats, made.id).agentId;
  expect(second).not.toBeNull();
  expect(second).not.toBe(first);
  const said = prompts(w.heard());
  expect(said.at(-1)).toContain("heron");
  expect(said.at(-1)).toContain("What was the word?");
});

only("IDLE IS COUNTED FROM THE LATER of the last turn's end and the process's start: an old process whose turn ended ten minutes ago is not idle", async () => {
  const w = world();
  const made = await w.chats.create({ agent: "fake", text: "One." });
  await settled(w.chats, made.id, 1);
  const first = summaryOf(w.chats, made.id).agentId;
  // Twenty-five minutes on, a second turn on the same process.
  w.skewBy(25 * 60_000);
  await w.chats.send(made.id, "Two.");
  await settled(w.chats, made.id, 2);
  expect(summaryOf(w.chats, made.id).agentId).toBe(first);
  // The process is thirty-five minutes old, and its last turn ended ten
  // minutes ago: not idle.
  w.skewBy(10 * 60_000);
  expect(w.chats.reap()).toBe(0);
  expect(summaryOf(w.chats, made.id).agentId).toBe(first);
  // Thirty minutes after that turn's end, it is.
  w.skewBy(21 * 60_000);
  expect(w.chats.reap()).toBe(1);
  expect(summaryOf(w.chats, made.id).agentId).toBeNull();
});

only("an agent that can reload its session is reopened with it after an idle end, not handed the chat", async () => {
  const w = world({ scenarios: { fake: { agentCapabilities: { loadSession: true } } } });
  const made = await w.chats.create({ agent: "fake", text: "First." });
  await settled(w.chats, made.id, 1);
  w.skewBy(31 * 60_000);
  expect(w.chats.reap()).toBe(1);
  await w.chats.send(made.id, "Second.");
  await settled(w.chats, made.id, 2);
  const methods = w.heard().map((h) => h.method).filter((m) => typeof m === "string");
  expect(methods.filter((m) => m === "session/load").length).toBe(1);
  expect(prompts(w.heard()).at(-1)).toBe("Second.");
});

only("A REAP RACING A SEND never ends an agent a turn is using: the send wins either way round, and its turn ends end_turn", async () => {
  const w = world();
  const made = await w.chats.create({ agent: "fake", text: "One." });
  await settled(w.chats, made.id, 1);
  w.skewBy(31 * 60_000);
  // The reap lands between the send being asked and its turn starting.
  const sending = w.chats.send(made.id, "Two.");
  w.chats.reap();
  await sending;
  expect((await settled(w.chats, made.id, 2)).stop).toBe("end_turn");

  // And with the turn under way: nothing a turn uses is idle.
  w.skewBy(31 * 60_000);
  await w.chats.send(made.id, "Three.\n!sleep 400");
  expect(w.chats.reap()).toBe(0);
  const three = await settled(w.chats, made.id, 3);
  expect(three.stop).toBe("end_turn");
  expect(replyOf((await w.chats.read(made.id)).updates, 3)).toContain("echo: Three.");
});

/* ── Stop that is not answered ────────────────────────────────────────── */

only("AN AGENT THAT DOES NOT ANSWER STOP within its grace is ended, the turn ends cancelled with no light, and the next message starts a new one", async () => {
  // A `sleep` step never looks at the cancel: this agent hears Stop and
  // carries on regardless.
  const w = world({ scenarios: { fake: { turns: [[{ thought: "busy" }, { sleep: 20_000 }, { reply: "late" }]] } }, cancelGraceMs: 300 });
  const s = await w.chats.create({ agent: "fake", text: "ignore Stop" });
  await until("the turn to run", 10_000, () => summaryOf(w.chats, s.id).phase === "running");
  await until("a thought", 5000, async () => (await w.chats.read(s.id)).updates.some((u) => u.kind === "thought"));
  const [pid] = startedPids(w.heard());
  await w.chats.cancel(s.id);
  // Within the grace it is still the agent's to answer.
  expect(summaryOf(w.chats, s.id).phase).toBe("running");
  await until("the turn to end once the grace is out", 3000, () => summaryOf(w.chats, s.id).phase === "idle");
  const done = summaryOf(w.chats, s.id);
  expect([done.stop, done.light, done.agentId]).toEqual(["cancelled", "none", null]);
  expect(w.heard().some((h) => h.method === "session/cancel")).toBe(true);
  await until("the agent that ignored Stop to be gone", 5000, () => !alivePid(pid as number));
  expect(replyOf((await w.chats.read(s.id)).updates, 1)).toBe("");
  // Nothing waits on it any more: the next message is accepted and answered.
  w.scenarios.fake = {};
  await w.chats.send(s.id, "next");
  const next = await settled(w.chats, s.id, 2);
  expect(next.stop).toBe("end_turn");
  expect(startedPids(w.heard()).length).toBe(2);
});

/* ── a chat deleted ───────────────────────────────────────────────────── */

const OFFERS_DELETE = { loadSession: false, sessionCapabilities: { delete: {} } };
const deletes = (heard: Record<string, unknown>[]): unknown[] => heard.filter((h) => h.method === "session/delete").map((h) => (h.params as { sessionId: string }).sessionId);

only("A CHAT DELETED AT REST is gone: from the list, from disk and from every window's stream, its agent ended, and the agent asked to delete its own record of the session where it offers to", async () => {
  const w = world({ scenarios: { fake: { agentCapabilities: OFFERS_DELETE } } });
  const s = await w.chats.create({ agent: "fake", text: "Remember the word heron." });
  await settled(w.chats, s.id, 1);
  const [pid] = startedPids(w.heard());
  const file = join(w.root, ".biom", "chats", `${s.id}.jsonl`);
  expect(existsSync(file)).toBe(true);
  const other = await w.chats.create({ agent: "fake" });
  w.pushes.length = 0;

  await w.chats.delete(s.id);
  expect(w.chats.list().map((c) => c.id)).toEqual([other.id]);
  expect(existsSync(file)).toBe(false);
  // Every window is told once, and nothing after it says the chat again.
  const said = w.pushes.filter((p) => p.chat.id === s.id);
  expect(said.map((p) => [p.deleted, p.updates.length])).toEqual([[true, 0]]);
  // The agent's own record of the session: deleted over the chat's own
  // process, which then goes.
  await until("the agent to delete its record", 5000, () => deletes(w.heard()).length === 1);
  const opened = w.heard().find((h) => h.method === "session/prompt") as { params: { sessionId: string } };
  expect(deletes(w.heard())).toEqual([opened.params.sessionId]);
  await until("the agent to be gone", 5000, () => !alivePid(pid as number));
  expect(startedPids(w.heard()).length).toBe(1);
  await wait(100);
  expect(w.pushes.filter((p) => p.chat.id === s.id).length).toBe(1);
  expect(existsSync(file)).toBe(false);
  // Asked for again, there is no such chat.
  for (const call of [() => w.chats.read(s.id), () => w.chats.send(s.id, "again"), () => w.chats.delete(s.id)]) {
    expect(((await call().catch((e: unknown) => e)) as { code?: string }).code).toBe("not_found");
  }
  // And a restart does not bring it back.
  const again = w.make();
  await again.loaded;
  expect(again.list().map((c) => c.id)).toEqual([other.id]);
});

only("a chat deleted mid-turn: its turn ends with it, its agent is ended, and a process is started to delete the session once that one has gone", async () => {
  const w = world({ scenarios: { fake: { agentCapabilities: OFFERS_DELETE, turns: [[{ thought: "busy" }, { sleep: 20_000 }, { reply: "late" }]] } } });
  const s = await w.chats.create({ agent: "fake", text: "a long one" });
  await until("the turn to run", 10_000, () => summaryOf(w.chats, s.id)?.phase === "running");
  await until("a thought", 5000, async () => (await w.chats.read(s.id)).updates.some((u) => u.kind === "thought"));
  const [first] = startedPids(w.heard());
  const sessionId = (w.heard().find((h) => h.method === "session/prompt") as { params: { sessionId: string } }).params.sessionId;
  await w.chats.delete(s.id);
  expect(w.chats.list()).toEqual([]);
  expect(existsSync(join(w.root, ".biom", "chats", `${s.id}.jsonl`))).toBe(false);
  await until("the running agent to be gone", 5000, () => !alivePid(first as number));
  await until("a second process to delete the session", 10_000, () => deletes(w.heard()).length === 1);
  expect(deletes(w.heard())).toEqual([sessionId]);
  const pids = startedPids(w.heard());
  expect(pids.length).toBe(2);
  await until("the process started to delete it to be gone", 5000, () => !alivePid(pids[1] as number));
  // Nothing of the deleted turn reached a window after the push that said so.
  const after = w.pushes.findIndex((p) => p.chat.id === s.id && p.deleted === true);
  expect(after).toBeGreaterThan(-1);
  expect(w.pushes.slice(after + 1).filter((p) => p.chat.id === s.id)).toEqual([]);
});

only("an agent that does not offer session/delete is never asked, and a chat that never started an agent starts none to be deleted", async () => {
  const w = world();
  const s = await w.chats.create({ agent: "fake", text: "hello" });
  await settled(w.chats, s.id, 1);
  const [pid] = startedPids(w.heard());
  await w.chats.delete(s.id);
  await until("the agent to be gone", 5000, () => !alivePid(pid as number));
  await wait(200);
  expect(deletes(w.heard())).toEqual([]);
  expect(w.heard().filter((h) => h.method === "session/delete").length).toBe(0);
  expect(w.said.some((l) => l.includes("own record"))).toBe(false);
  // A chat with no session at all.
  const bare = await w.chats.create({ agent: "fake" });
  await w.chats.delete(bare.id);
  await wait(200);
  expect(startedPids(w.heard()).length).toBe(1);
  expect(w.chats.list()).toEqual([]);
});

only("deleting a chat nobody has is refused not_found, and a failed session/delete is said in words and undoes nothing of Biom's", async () => {
  const w = world({ scenarios: { fake: { agentCapabilities: OFFERS_DELETE } } });
  expect(((await w.chats.delete("c1nvented-no-such-chat").catch((e: unknown) => e)) as { code?: string }).code).toBe("not_found");
  const s = await w.chats.create({ agent: "fake", text: "hello" });
  await settled(w.chats, s.id, 1);
  // The agent went while idle: a process is started to delete the session,
  // and this one cannot start at all.
  await w.chats.close(s.id);
  delete w.scenarios.fake;
  await w.chats.delete(s.id);
  expect(w.chats.list()).toEqual([]);
  await until("the failure to be said", 5000, () => w.said.some((l) => l.includes("own record")));
  expect(w.said.find((l) => l.includes("own record"))).toBe("chats: Fake Agent's own record of a deleted chat was left: it could not be started to delete it");
});
