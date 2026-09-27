// SPDX-License-Identifier: AGPL-3.0-only
// The ACP connection: JSON-RPC 2.0 over newline-delimited JSON, against a
// process in memory for the framing and the settling, and against the
// scripted fake agent (`tests/fake-acp-agent.ts`) for the pipes, the process
// group and its end. Every message here is invented.

import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ACP_CLOSED, ACP_TIMEOUT, AUTH_REQUIRED, MAX_LINE, METHOD_NOT_FOUND, connectAcp, isAcpError, isAuthRequired, isClosed, overProcess, spawnAgent,
} from "../server/platform/acp.ts";
import type { AcpExit, AcpProcess } from "../server/platform/acp.ts";
import { initializeParams } from "../server/platform/acp-wire.ts";
import { FILE_MAX } from "../server/workspace/chats.ts";
import { installFakeAgent } from "./fake-acp-agent.ts";
import type { Scenario } from "./fake-acp-agent.ts";

const POSIX = process.platform !== "win32";
const only = POSIX ? test : test.skip;
const FAKE = resolve(import.meta.dir, "fake-acp-agent.ts");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ms: number, ok: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await wait(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A process in memory: the test writes its stdout and reads its stdin. */
function memory() {
  const written: string[] = [];
  let out: (c: Uint8Array | null) => void = () => {};
  let err: (c: Uint8Array) => void = () => {};
  let settle!: (e: AcpExit & { error?: string }) => void;
  const exited = new Promise<AcpExit & { error?: string }>((r) => (settle = r));
  const signals: string[] = [];
  let inputEnded = false;
  const proc: AcpProcess = {
    pid: 4242,
    write: (t) => void written.push(t),
    endInput: () => void (inputEnded = true),
    onStdout: (fn) => void (out = fn),
    onStderr: (fn) => void (err = fn),
    exited,
    terminate: () => void signals.push("TERM"),
    kill: () => void signals.push("KILL"),
  };
  const enc = new TextEncoder();
  return {
    proc,
    written,
    signals,
    inputEnded: () => inputEnded,
    sent: () => written.join("").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>),
    stdout: (s: string | Uint8Array) => out(typeof s === "string" ? enc.encode(s) : s),
    eof: () => out(null),
    stderr: (s: string) => err(enc.encode(s)),
    exit: (e: AcpExit & { error?: string }) => settle(e),
  };
}

/** A seeded generator, so a failure names a stream that can be replayed. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("framing survives any chunking: split lines, split UTF-8, several per chunk, CRLF, blank lines, garbage", async () => {
  // A recorded stream, invented: notifications with multi-byte text, an
  // agent's own request, a banner, blank lines and CRLF endings, and the
  // answer to the one request the client made.
  const messages: Record<string, unknown>[] = [];
  for (let i = 0; i < 12; i++) {
    messages.push({ jsonrpc: "2.0", method: "session/update", params: { n: i, text: `chunk ${i}: café ☕ — 🙂 ${"x".repeat(i * 37)}` } });
  }
  const stream =
    "banner: not json at all\n\n" +
    messages.slice(0, 6).map((m) => `${JSON.stringify(m)}\r\n`).join("") +
    "\n   \n" +
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: "done ✓" } })}\n` +
    messages.slice(6).map((m) => `${JSON.stringify(m)}\n`).join("") +
    `${JSON.stringify({ jsonrpc: "2.0", id: 77, method: "fs/read_text_file", params: { path: "/v/a.md" } })}\n`;
  const bytes = new TextEncoder().encode(stream);

  for (let seed = 1; seed <= 150; seed++) {
    const rand = prng(seed);
    const m = memory();
    const conn = overProcess(m.proc, { log: () => {} });
    const heard: unknown[] = [];
    conn.onNotification((method, params) => heard.push({ method, params }));
    conn.handle("fs/read_text_file", async () => ({ content: "hello" }));
    const answer = conn.request("initialize", {});
    let at = 0;
    while (at < bytes.length) {
      const n = 1 + Math.floor(rand() * (rand() < 0.2 ? 400 : 9));
      m.stdout(bytes.slice(at, at + n));
      at += n;
    }
    expect(await answer, `seed ${seed}`).toEqual({ ok: "done ✓" });
    expect(heard, `seed ${seed}`).toEqual(messages.map((x) => ({ method: x.method, params: x.params })));
    await wait(0);
    const reply = m.sent().find((x) => x.id === 77);
    expect(reply, `seed ${seed}`).toEqual({ jsonrpc: "2.0", id: 77, result: { content: "hello" } });
  }
});

test("a last message with no newline still arrives when stdout ends", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { log: () => {} });
  const heard: unknown[] = [];
  conn.onNotification((method) => heard.push(method));
  m.stdout(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} }));
  expect(heard).toEqual([]);
  m.eof();
  expect(heard).toEqual(["session/update"]);
});

test("an oversized line fails the connection: every pending request rejects and the process is killed", async () => {
  const m = memory();
  const lines: string[] = [];
  const conn = overProcess(m.proc, { maxLine: 100, log: (l) => lines.push(l) });
  const a = conn.request("session/prompt", {});
  const b = conn.request("initialize", {});
  m.stdout("x".repeat(60));
  m.stdout("y".repeat(60));
  for (const p of [a, b]) {
    const e = await p.catch((x: unknown) => x);
    expect(isClosed(e)).toBe(true);
  }
  expect(m.signals).toContain("KILL");
  expect(lines.some((l) => l.includes("longer than 100"))).toBe(true);
  // And whatever comes after is not read.
  const heard: unknown[] = [];
  conn.onNotification((x) => heard.push(x));
  m.stdout(`\n${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} })}\n`);
  expect(heard).toEqual([]);
  const late = await conn.request("x", {}).catch((x: unknown) => x);
  expect(isClosed(late)).toBe(true);
});

test("a complete line over the bound fails the connection too", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { maxLine: 50, log: () => {} });
  const a = conn.request("initialize", {});
  m.stdout(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { t: "z".repeat(80) } })}\n`);
  expect(isClosed(await a.catch((x: unknown) => x))).toBe(true);
});

test("A WHOLE FILE AS LARGE AS THE CHATS TAKE, in one fs/write_text_file, reaches its handler — and the bound on a line stays above such a file escaped at JSON's worst", async () => {
  // Exactly FILE_MAX characters, which the chats' own size check accepts, as
  // short lines each with a quote: JSON escapes the quote and the newline to
  // two characters each, so the line is longer than the file. Invented text.
  const m = memory();
  const lines: string[] = [];
  const conn = overProcess(m.proc, { log: (l) => lines.push(l) });
  let got = -1;
  conn.handle("fs/write_text_file", async (params) => {
    got = (params as { content: string }).content.length;
    return {};
  });
  const unit = `${"x".repeat(38)}"\n`;
  const content = unit.repeat(Math.floor(FILE_MAX / unit.length)).padEnd(FILE_MAX, "y");
  const line = `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "fs/write_text_file", params: { sessionId: "invented", path: "notes/invented.md", content } })}\n`;
  expect(content.length).toBe(FILE_MAX);
  expect(line.length).toBeGreaterThan(FILE_MAX);
  const bytes = new TextEncoder().encode(line);
  for (let i = 0; i < bytes.length; i += 1 << 20) m.stdout(bytes.subarray(i, i + (1 << 20)));
  await until("the write to reach its handler", 5000, () => got >= 0 || m.signals.length > 0);
  expect(lines).toEqual([]);
  expect(m.signals).toEqual([]);
  expect(got).toBe(FILE_MAX);
  await until("the answer", 2000, () => m.sent().some((s) => s.id === 7));
  expect(m.sent().find((s) => s.id === 7)).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  // Whatever the chats accept fits, escaped at JSON's worst — `\u0001`, six
  // characters for one — with room for the envelope and the path. A write
  // too large is then refused in words by its handler, never by ending the
  // agent.
  expect(MAX_LINE).toBeGreaterThan(6 * FILE_MAX + 64 * 1024);
}, 30_000);

test("every pending request rejects with ONE closed error when the process exits, and later requests reject at once", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { log: () => {} });
  const pending = [conn.request("a", {}), conn.request("b", {}), conn.request("c", {})];
  m.exit({ code: 1, signal: null });
  const errors = await Promise.all(pending.map((p) => p.catch((e: unknown) => e)));
  expect(errors.every((e) => isAcpError(e) && e.code === ACP_CLOSED)).toBe(true);
  expect(new Set(errors).size).toBe(1);
  expect(await conn.closed).toEqual({ code: 1, signal: null });
  const later = await conn.request("d", {}).catch((e: unknown) => e);
  expect(isClosed(later)).toBe(true);
});

test("stdout ending rejects what is pending and ends the process", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { log: () => {}, graceMs: 5 });
  const p = conn.request("session/prompt", {});
  m.eof();
  expect(isClosed(await p.catch((e: unknown) => e))).toBe(true);
  await until("the process is asked to end", 1000, () => m.signals.includes("TERM"));
  expect(m.inputEnded()).toBe(true);
  m.exit({ code: 0, signal: null });
  await conn.closed;
});

test("an agent's request to a method nobody handles is answered -32601, never left hanging", async () => {
  const m = memory();
  overProcess(m.proc, { log: () => {} });
  m.stdout(`${JSON.stringify({ jsonrpc: "2.0", id: "abc", method: "terminal/create", params: {} })}\n`);
  await wait(0);
  const r = m.sent().find((x) => x.id === "abc") as { error: { code: number } };
  expect(r.error.code).toBe(METHOD_NOT_FOUND);
});

test("a handler's thrown code is the agent's answer; a plain throw is -32603", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { log: () => {} });
  conn.handle("fs/write_text_file", async () => {
    throw Object.assign(new Error("outside the workspace"), { code: -32602 });
  });
  conn.handle("fs/read_text_file", async () => {
    throw new Error("boom");
  });
  m.stdout(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "fs/write_text_file", params: {} })}\n`);
  m.stdout(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "fs/read_text_file", params: {} })}\n`);
  await wait(5);
  const sent = m.sent();
  expect(sent.find((x) => x.id === 1)).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "outside the workspace" } });
  expect((sent.find((x) => x.id === 2) as { error: { code: number } }).error.code).toBe(-32603);
});

test("an agent's error answer rejects with its code — auth-required is recognised", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { log: () => {} });
  const p = conn.request("session/new", {});
  m.stdout(`${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: AUTH_REQUIRED, message: "Authentication required" } })}\n`);
  const e = await p.catch((x: unknown) => x);
  expect(isAuthRequired(e)).toBe(true);
  expect(isClosed(e)).toBe(false);
});

test("a request with a deadline rejects on it and asks the agent to cancel; one without has none", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { log: () => {} });
  const quick = conn.request("initialize", {}, { timeoutMs: 20 });
  const slow = conn.request("session/prompt", {});
  const e = await quick.catch((x: unknown) => x);
  expect(isAcpError(e) && e.code === ACP_TIMEOUT).toBe(true);
  expect(m.sent().some((x) => x.method === "$/cancel_request" && (x.params as { requestId: number }).requestId === 1)).toBe(true);
  // The late answer to the timed-out request is ignored; the turn still waits.
  m.stdout(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n`);
  let settled = false;
  void slow.then(() => (settled = true), () => (settled = true));
  await wait(30);
  expect(settled).toBe(false);
  m.stdout(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } })}\n`);
  expect(await slow).toEqual({ stopReason: "end_turn" });
});

test("stderr is kept as a bounded tail", () => {
  const m = memory();
  const conn = overProcess(m.proc, { stderrTail: 50, log: () => {} });
  for (let i = 0; i < 20; i++) m.stderr(`line ${i} of noise\n`);
  expect(conn.stderr().length).toBeLessThanOrEqual(50);
  expect(conn.stderr().endsWith("line 19 of noise\n")).toBe(true);
});

test("close rejects what is pending, TERMs, and KILLs after the grace", async () => {
  const m = memory();
  const conn = overProcess(m.proc, { graceMs: 20, log: () => {} });
  const p = conn.request("session/prompt", {});
  const closing = conn.close();
  expect(isClosed(await p.catch((e: unknown) => e))).toBe(true);
  expect(m.signals).toEqual(["TERM"]);
  await until("KILL", 1000, () => m.signals.includes("KILL"));
  m.exit({ code: null, signal: "SIGKILL" });
  expect(await closing).toEqual({ code: null, signal: "SIGKILL" });
  expect(conn.close()).toBe(closing);
});

/* ── a real process ───────────────────────────────────────────────────── */

const launchOf = (scenario: Scenario) => ({
  command: process.execPath,
  args: ["run", FAKE],
  env: { ...process.env, FAKE_ACP_SCENARIO: JSON.stringify(scenario) } as Record<string, string>,
});

async function groupPids(pgid: number): Promise<number[]> {
  const p = Bun.spawn(["pgrep", "-g", String(pgid)], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.split("\n").filter((l) => l.trim() !== "").map(Number);
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

only("a real agent: the handshake, a turn, and the whole tree gone after close — its group and a grandchild in a group of its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biom-acp-"));
  const log = join(dir, "heard.jsonl");
  const spawned: number[] = [];
  const conn = connectAcp(launchOf({ log, turns: [[{ spawnSleeper: 60 }, { reply: "ok" }]] }), dir, (launch, cwd) => {
    // The real spawner, watched for the pid it made.
    const p = spawnAgent(launch, cwd);
    if (p.pid) spawned.push(p.pid);
    return p;
  });
  const init = (await conn.request("initialize", initializeParams(), { timeoutMs: 10_000 })) as { protocolVersion: number };
  expect(init.protocolVersion).toBe(1);
  const s = (await conn.request("session/new", { cwd: dir, mcpServers: [] }, { timeoutMs: 10_000 })) as { sessionId: string };
  const r = await conn.request("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text: "hi" }] });
  expect(r).toEqual({ stopReason: "end_turn" });

  const heard = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  const sleeper = (heard.find((h) => h.fake === "sleeper") as { pid: number }).pid;
  const pid = spawned[0] as number;
  expect(alive(sleeper)).toBe(true);
  expect((await groupPids(pid)).length).toBeGreaterThan(0);

  await conn.close();
  await until("the group is empty", 5000, async () => (await groupPids(pid)).length === 0);
  await until("the grandchild is gone", 5000, () => !alive(sleeper));
});

only("a real agent that crashes mid-turn rejects the turn with the closed error and says how it ended", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biom-acp-"));
  const conn = connectAcp(launchOf({ turns: [[{ reply: "about to" }, { crash: 3 }]] }), dir);
  await conn.request("initialize", initializeParams(), { timeoutMs: 10_000 });
  const s = (await conn.request("session/new", { cwd: dir, mcpServers: [] }, { timeoutMs: 10_000 })) as { sessionId: string };
  const e = await conn.request("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text: "go" }] }).catch((x: unknown) => x);
  expect(isClosed(e)).toBe(true);
  expect(await conn.closed).toEqual({ code: 3, signal: null });
});

only("an agent that exits on its own takes what it left in its group with it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biom-acp-"));
  const log = join(dir, "heard.jsonl");
  const conn = connectAcp(launchOf({ log, turns: [[{ spawnChild: 60 }, { sleep: 50 }, { crash: 5 }]] }), dir);
  await conn.request("initialize", initializeParams(), { timeoutMs: 10_000 });
  const s = (await conn.request("session/new", { cwd: dir, mcpServers: [] }, { timeoutMs: 10_000 })) as { sessionId: string };
  await conn.request("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text: "go" }] }).catch(() => null);
  expect(await conn.closed).toEqual({ code: 5, signal: null });
  const heard = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  const child = (heard.find((h) => h.fake === "child") as { pid: number }).pid;
  await until("the orphan to be gone", 5000, () => !alive(child));
});

only("kill() ends a real agent at once, with nothing awaited", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biom-acp-"));
  const conn = connectAcp(launchOf({}), dir);
  await conn.request("initialize", initializeParams(), { timeoutMs: 10_000 });
  conn.kill();
  const exit = await conn.closed;
  expect(exit.signal).toBe("SIGKILL");
});

test("a command that is not there is a connection already closed, never a throw", async () => {
  const lines: string[] = [];
  const conn = connectAcp({ command: "/nonexistent/biom-no-such-agent", args: [], env: {} }, tmpdir(), undefined, { log: (l) => lines.push(l) });
  const e = await conn.request("initialize", {}).catch((x: unknown) => x);
  expect(isClosed(e)).toBe(true);
  const exit = await conn.closed;
  expect(exit.code).toBeNull();
  expect(lines.some((l) => l.includes("could not be started"))).toBe(true);
});

only("the fake installs onto a PATH under an agent's command name and answers there, scenario and all", async () => {
  const bin = mkdtempSync(join(tmpdir(), "biom-bin-"));
  const log = join(bin, "heard.jsonl");
  const path = installFakeAgent(bin, { scenario: { log, agentInfo: { name: "installed-fake", version: "9.9.9" } } });
  expect(path).toBe(join(bin, "claude-agent-acp"));
  const conn = connectAcp({ command: "claude-agent-acp", args: [], env: { ...(process.env as Record<string, string>), PATH: `${bin}:${process.env.PATH ?? ""}` } }, bin);
  const init = (await conn.request("initialize", initializeParams(), { timeoutMs: 10_000 })) as { agentInfo: { name: string } };
  expect(init.agentInfo.name).toBe("installed-fake");
  await conn.close();
  expect(readFileSync(log, "utf8")).toContain('"method":"initialize"');
});
