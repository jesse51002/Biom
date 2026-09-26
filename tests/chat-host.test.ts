// SPDX-License-Identifier: AGPL-3.0-only
// THE COMPOSITION ROOT, WITH A REAL AGENT PROCESS — `makeHost` in
// `server/main.ts` wiring the history, the agents and the chats per folder.
//
// In process, over a temporary vault, with the scripted fake ACP agent
// (`tests/fake-acp-agent.ts`) installed on a PATH of this test's own under the
// command name Biom knows Claude Code's adapter by. The agent environment is
// handed in, so no login shell is asked and no agent of the machine's is found;
// the folder of installed agents is a temporary one. What is held:
//
//   - the agents list finds the fake and probes it Active;
//   - a chat's `fs/write_text_file` lands on disk and is ONE history edit,
//     stamped with that chat's agent id and turn, by `fs` — never `you`;
//   - no agent process outlives the host: `close()` kills a chat's, and the
//     exit's KILL reaches an agent that is still on its way out after its chat
//     closed — which the chats module no longer holds, and the root does.
//
// Every page, word and id here is invented.

import { test, expect, afterAll } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { handle } from "../server/api/routes.ts";
import { installFakeAgent } from "./fake-acp-agent.ts";
import { PROTOCOL } from "../contracts/wire.js";
import type { AgentInfo, ApiRequest, ApiResponse, ChatSummary, HistoryRead } from "../contracts/types.ts";

const FRAMEWORK = join(import.meta.dir, "..");
const unix = process.platform !== "win32";
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A folder of this test's own, gone at the end. */
function scratch(label: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `biom-chat-host-${label}-`)));
  made.push(dir);
  return dir;
}

/** The environment every agent is started with here: this machine's own
 *  basics and a PATH of only the test's agent, bun and the system — never
 *  the person's agents, and never a Jev key. */
function agentEnv(bin: string, home: string): () => Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("BIOM_")) env[k] = v;
  delete env.TYPESAFE_API_KEY;
  env.HOME = home;
  env.PATH = [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  return async () => ({ ...env });
}

async function stand(bin: string): Promise<{ host: Host; vault: string }> {
  const root = scratch("root");
  const vault = join(root, "vault");
  const host = await makeHost({
    vault,
    memory: join(root, "vaults.json"),
    presets: join(FRAMEWORK, "presets"),
    agentsHome: join(root, "agents"),
    agentEnv: agentEnv(bin, join(root, "home")),
  });
  return { host, vault };
}

let n = 0;
const call = async (host: Host, vault: string, o: Record<string, unknown>): Promise<ApiResponse> =>
  await handle({ id: `r${++n}`, g: PROTOCOL, ...o } as ApiRequest, await host.deps(vault));
const value = (r: ApiResponse): unknown => {
  if (!r.ok) throw new Error(`refused: ${r.error.code} ${r.error.message}`);
  return r.value;
};

async function until(ok: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (await ok()) return true;
    await Bun.sleep(25);
  }
  return await ok();
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Every pid the fake logged starting, from its scenario's log. */
const pidsIn = (log: string): number[] =>
  existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter((l) => l.includes('"started"')).map((l) => (JSON.parse(l) as { pid: number }).pid)
    : [];

async function active(host: Host, vault: string): Promise<void> {
  expect(await until(async () => {
    const list = value(await call(host, vault, { kind: "agents.list" })) as AgentInfo[];
    return list.some((a) => a.key === "claude-acp" && a.state === "active");
  }, 20000)).toBe(true);
}

async function turnEnded(host: Host, vault: string, chat: string): Promise<ChatSummary> {
  let now: ChatSummary | undefined;
  expect(await until(async () => {
    const list = value(await call(host, vault, { kind: "chat.list" })) as ChatSummary[];
    now = list.find((c) => c.id === chat);
    return now !== undefined && now.phase === "idle" && now.stop !== null;
  }, 20000)).toBe(true);
  return now as ChatSummary;
}

test.if(unix)("A CHAT'S WRITE IS ONE HISTORY EDIT, stamped with its agent — and closing the host leaves no agent running", async () => {
  const bin = scratch("bin");
  const log = join(scratch("log"), "fake.log");
  installFakeAgent(bin, { scenario: { log } });
  const { host, vault } = await stand(bin);
  try {
    await active(host, vault);
    const chat = value(await call(host, vault, {
      kind: "chat.new",
      agent: "claude-acp",
      text: "Write the notes.\n!write pages/home/notes.md Invented notes, written by the fake.",
    })) as ChatSummary;
    const ended = await turnEnded(host, vault, chat.id);
    expect([ended.stop, ended.light]).toEqual(["end_turn", "done"]);
    expect(readFileSync(join(vault, "pages/home/notes.md"), "utf8")).toBe("Invented notes, written by the fake.");

    // The chat's agent, as the chat said it started.
    const read = value(await call(host, vault, { kind: "chat.read", chat: chat.id })) as { updates: { kind: string; agentId?: string }[] };
    const agentId = read.updates.find((u) => u.kind === "agent")?.agentId;
    expect(typeof agentId).toBe("string");

    const history = value(await call(host, vault, { kind: "history.read" })) as HistoryRead;
    const edits = history.entries.filter((e) => e.kind === "edit" && e.path === "pages/home/notes.md");
    expect(edits.length).toBe(1);
    const edit = edits[0]!;
    expect(edit.kind === "edit" && edit.via).toBe("fs");
    expect(edit.writer).toMatchObject({ kind: "agent", agent: agentId, chat: chat.id, turn: 1, harness: "Claude Code" });
    // Nothing of it is the person's.
    expect(history.entries.some((e) => e.writer.kind === "you")).toBe(false);

    // The chat's agent is still running for its next message; the host
    // closing takes it, whatever it was doing.
    const pids = pidsIn(log);
    expect(pids.length).toBeGreaterThan(0);
    expect(host.agentProcesses()).toBeGreaterThan(0);
  } finally {
    host.close();
  }
  const pids = pidsIn(log);
  expect(await until(() => pids.every((p) => !alive(p)), 3000)).toBe(true);
  expect(await until(() => host.agentProcesses() === 0, 3000)).toBe(true);
}, 60000);

test.if(unix)("THE EXIT'S KILL REACHES AN AGENT STILL ON ITS WAY OUT after its chat closed, which the chats no longer hold", async () => {
  // An agent that ignores TERM and the end of its input — the kind whose end
  // takes the whole grace — written for this test and invented.
  const bin = scratch("stubborn-bin");
  const pidFile = join(scratch("stubborn-log"), "pids");
  const script = join(bin, "stubborn.js");
  writeFileSync(script, `
process.on("SIGTERM", () => {});
require("node:fs").appendFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  for (let i = buf.indexOf("\\n"); i >= 0; i = buf.indexOf("\\n")) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === "initialize") out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    else if (m.method === "session/new") out({ jsonrpc: "2.0", id: m.id, result: { sessionId: "stubborn-" + process.pid } });
    else if (m.method === "session/prompt") {
      out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: m.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "still here" } } } });
      out({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } });
    } else if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "not offered" } });
  }
});
process.stdin.on("end", () => {});
setInterval(() => {}, 1 << 30);
`);
  const launcher = join(bin, "claude-agent-acp");
  writeFileSync(launcher, `#!/bin/sh\n# An invented agent for Biom's tests that will not stop when asked.\nexec ${JSON.stringify(process.execPath)} run ${JSON.stringify(script)} "$@"\n`);
  chmodSync(launcher, 0o755);
  mkdirSync(dirname(pidFile), { recursive: true });
  appendFileSync(pidFile, "");

  const { host, vault } = await stand(bin);
  try {
    await active(host, vault);
    const chat = value(await call(host, vault, { kind: "chat.new", agent: "claude-acp", text: "Say something." })) as ChatSummary;
    await turnEnded(host, vault, chat.id);
    const pids = readFileSync(pidFile, "utf8").split("\n").filter(Boolean).map(Number);
    const chatPid = pids.at(-1)!;
    expect(alive(chatPid)).toBe(true);

    // Closing the chat asks its agent to stop, and this one does not: it is
    // TERMed, and KILLed only after the grace. The chat has let go of it.
    const closed = Date.now();
    value(await call(host, vault, { kind: "chat.close", chat: chat.id }));
    await Bun.sleep(100);
    expect(alive(chatPid)).toBe(true);
    expect(host.agentProcesses()).toBeGreaterThan(0);

    // The exit handler's KILL, now — well inside the grace, so it is this and
    // not the ladder that ends it.
    host.killAgents();
    expect(await until(() => !alive(chatPid), 1500)).toBe(true);
    expect(Date.now() - closed).toBeLessThan(1900);
    expect(await until(() => pids.every((p) => !alive(p)), 3000)).toBe(true);
  } finally {
    host.close();
  }
}, 60000);
