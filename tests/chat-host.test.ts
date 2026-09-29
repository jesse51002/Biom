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
//   - an idle agent is ended only when no window with a stream open has its
//     chat open — the root's `openIn`, read off the history's windows;
//   - no agent process outlives the host: `close()` kills a chat's, and the
//     exit's KILL reaches an agent that is still on its way out after its chat
//     closed — which the chats module no longer holds, and the root does.
//
// Every page, word and id here is invented.

import { test, expect, afterAll, setSystemTime } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { events, makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { handle } from "../server/api/routes.ts";
import { installFakeAgent } from "./fake-acp-agent.ts";
import { PROTOCOL } from "../contracts/wire.js";
import { address } from "../contracts/address.js";
import { IDLE_MS } from "../server/workspace/chats.ts";
import type { AgentInfo, ApiRequest, ApiResponse, ChatSummary, HistoryRead, WindowContext } from "../contracts/types.ts";

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
  const gone = await until(() => pids.every((p) => !alive(p)), 3000);
  // A failing run leaves nothing either — ended now, while the pids are still
  // the ones this test started.
  for (const p of pids) if (alive(p)) process.kill(p, "SIGKILL");
  expect(gone).toBe(true);
  expect(await until(() => host.agentProcesses() === 0, 3000)).toBe(true);
}, 60000);

test.if(unix)("AN IDLE AGENT IS NEVER ENDED WHILE A WINDOW HAS ITS CHAT OPEN: the root's `openIn` reads the windows with a stream attached", async () => {
  const bin = scratch("idle-bin");
  const log = join(scratch("idle-log"), "fake.log");
  installFakeAgent(bin, { scenario: { log } });
  const { host, vault } = await stand(bin);
  const W = "window-invented-idle-01";
  let stream: Response | null = null;
  try {
    await active(host, vault);
    const chat = value(await call(host, vault, { kind: "chat.new", agent: "claude-acp", text: "Say something." })) as ChatSummary;
    await turnEnded(host, vault, chat.id);
    expect(host.agentProcesses()).toBeGreaterThan(0);

    // A window with its stream open — as the live route opens it — reports
    // that it has this chat open.
    stream = events(host, vault, W);
    const open = async (): Promise<boolean> => {
      value(await call(host, vault, { kind: "window.report", window: W, context: { address: address("agent", chat.id), panel: false, chat: chat.id, agent: null } }));
      const list = value(await call(host, vault, { kind: "window.list" })) as WindowContext[];
      return list.some((c) => c.window === W && c.chat === chat.id);
    };
    expect(await until(open, 5000)).toBe(true);

    // Every clock the chats read, well past the idle bound.
    setSystemTime(new Date(Date.now() + IDLE_MS + 60_000));
    const chats = (await host.deps(vault)).chats!;
    // Open in a window: kept.
    expect(chats.reap()).toBe(0);
    // The stream closes, so the window is gone, and the agent is ended.
    await stream.body!.cancel();
    stream = null;
    expect(await until(async () => ((value(await call(host, vault, { kind: "window.list" })) as WindowContext[]).length === 0), 5000)).toBe(true);
    expect(chats.reap()).toBe(1);
  } finally {
    setSystemTime();
    if (stream !== null) await stream.body?.cancel().catch(() => {});
    host.close();
    for (const pid of pidsIn(log)) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
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
  const logged = (): number[] => readFileSync(pidFile, "utf8").split("\n").filter(Boolean).map(Number);
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
    // A FAILING RUN MUST NOT LEAVE THIS AGENT BEHIND: it ignores TERM by
    // design, and nothing else would ever end it.
    for (const pid of logged()) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
}, 60000);

test.if(unix)("A PER-PROCESS SIGN-IN, ASSEMBLED: signed in once as Cursor, a chat's own process authenticates with the same method and its turn ends end_turn", async () => {
  // The fake under Cursor's command name, refusing a session in any process
  // that has not called `authenticate` — invented method.
  const bin = scratch("cursor-bin");
  const log = join(scratch("cursor-log"), "fake.log");
  installFakeAgent(bin, {
    name: "cursor-agent",
    scenario: { log, authMethods: [{ id: "invented-login", name: "Invented login" }], session: { requireAuthenticate: true } },
  });
  const { host, vault } = await stand(bin);
  try {
    expect(await until(async () => {
      const list = value(await call(host, vault, { kind: "agents.list" })) as AgentInfo[];
      return list.some((a) => a.key === "cursor" && a.reason === "signin");
    }, 20000)).toBe(true);
    expect(value(await call(host, vault, { kind: "agents.signIn", agent: "cursor", method: "invented-login" }))).toEqual({ kind: "agent" });
    expect(await until(async () => {
      const list = value(await call(host, vault, { kind: "agents.list" })) as AgentInfo[];
      return list.some((a) => a.key === "cursor" && a.state === "active");
    }, 20000)).toBe(true);
    const chat = value(await call(host, vault, { kind: "chat.new", agent: "cursor", text: "Are you signed in?" })) as ChatSummary;
    const ended = await turnEnded(host, vault, chat.id);
    expect(ended.stop).toBe("end_turn");
    // Every process that opened a session called `authenticate` first.
    const heard = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { method?: string; params?: { methodId?: string } });
    const auths = heard.filter((h) => h.method === "authenticate");
    expect(auths.length).toBeGreaterThanOrEqual(2);
    expect(auths.every((h) => h.params?.methodId === "invented-login")).toBe(true);
  } finally {
    host.close();
    for (const pid of pidsIn(log)) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
}, 60000);

test.if(unix)("SIGN-IN IS PER PERSON: signed in through one workspace, the agent is Active in every other one open — and the news does not echo back", async () => {
  // A sign-in the fake believes in: a file its sign-in command makes, and a
  // session refused without it. Both invented.
  const bin = scratch("person-bin");
  const where = scratch("person-state");
  const signedIn = join(where, "signed-in");
  const log = join(where, "fake.log");
  installFakeAgent(bin, {
    scenario: {
      log,
      authMethods: [{ id: "invented-login", name: "Invented login", _meta: { "terminal-auth": { command: "/bin/sh", args: ["-c", `touch '${signedIn}'`] } } }],
      session: { refuseUnless: signedIn },
    },
  });
  const { host, vault } = await stand(bin);
  // A second workspace, open in the same server.
  const other = join(scratch("person-other"), "vault");
  mkdirSync(other, { recursive: true });
  const state = async (at: string): Promise<AgentInfo | undefined> =>
    (value(await call(host, at, { kind: "agents.list" })) as AgentInfo[]).find((a) => a.key === "claude-acp");
  try {
    // Refused in both, and sticky in both.
    for (const at of [vault, other]) expect(await until(async () => (await state(at))?.reason === "signin", 20000)).toBe(true);

    // Signed in through the first: its pop-up's ticket, redeemed and run as
    // the terminal would, and the command's end reported.
    const agents = (await host.deps(vault)).agents!;
    const signIn = value(await call(host, vault, { kind: "agents.signIn", agent: "claude-acp", method: "invented-login" })) as { kind: string; ticket: string };
    expect(signIn.kind).toBe("terminal");
    const launch = agents.redeem(signIn.ticket)!;
    expect(spawnSync(launch.command, launch.args, { env: launch.env }).status).toBe(0);
    agents.signedIn(signIn.ticket);

    expect(await until(async () => (await state(vault))?.state === "active", 20000)).toBe(true);
    // AND IN THE OTHER WORKSPACE, whose refusal was sticky and which nobody
    // signed in through.
    expect(await until(async () => (await state(other))?.state === "active", 20000)).toBe(true);

    // No echo: once both are Active, nothing looks again.
    await Bun.sleep(300);
    const settledCount = pidsIn(log).length;
    await Bun.sleep(1500);
    expect(pidsIn(log).length).toBe(settledCount);
  } finally {
    host.close();
    for (const pid of pidsIn(log)) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
}, 60000);
