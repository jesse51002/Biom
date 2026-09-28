// SPDX-License-Identifier: AGPL-3.0-only
// A SCRIPTED ACP AGENT, for tests. A real stdio process speaking ACP v1 —
// newline-delimited JSON-RPC 2.0 — run with `bun run tests/fake-acp-agent.ts`,
// so everything between the chats and an agent is exercised for real: the
// framing, the pipes, the process group and its end. Everything it says is
// invented and says so.
//
// DRIVEN BY A SCENARIO, as JSON, from `FAKE_ACP_SCENARIO` (the JSON itself, or
// a path to it) or `--scenario <json|path>`. With none it is a plain agent that
// signs nobody out, opens any session and answers every message with a thought
// and an echo — which is what an end-to-end run wants of it. A message may
// also steer it: a line `!write <path> <text>` writes a file through
// `fs/write_text_file`, `!sh <command>` reports an `execute` tool call that ran
// it, `!edit <path> <from>=><to>` rewrites a file itself and reports it as an
// `edit` tool call carrying the diff (a `\n` in `<to>` is a new line),
// `!sleep <ms>` waits, and `!crash` exits in the middle of the turn.
//
// WHAT IT HEARD is appended, one JSON message per line, to the scenario's `log`
// where it names one — which is how a test asserts the permission it was
// answered with, the prompt it was handed, or that it was asked to cancel.
//
// INSTALLED ON A PATH by `installFakeAgent`, as an executable under a command
// name an agent Biom knows is found by — `claude-agent-acp` by default, the
// Claude Code adapter's own — so discovery finds it in an end-to-end sandbox.
// This file is not a test: its name has no `.test.`, and `bun test` walks past.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** One thing a turn does, in order. */
export type Step =
  | { thought: string }
  | { reply: string }
  /** A `tool_call`; `sessionUpdate` is added. */
  | { tool: Record<string, unknown> }
  /** A `tool_call_update`; `sessionUpdate` is added. */
  | { toolUpdate: Record<string, unknown> }
  /** `fs/write_text_file`, waiting for the answer; the answer is logged. */
  | { write: { path: string; content: string } }
  /** `fs/read_text_file`, waiting for the answer; the answer is logged. */
  | { read: { path: string; line?: number; limit?: number } }
  /** `session/request_permission`; the chosen option is logged. */
  | { permission: { toolCallId?: string; options?: { optionId: string; name: string; kind: string }[] } }
  /** An `execute` tool call that completed, with this command line; `run`
   *  runs it with `sh -c` in the agent's folder first, as a real agent's own
   *  shell would. */
  | { exec: string; run?: boolean; cwd?: string }
  /** An `edit` tool call over a file the agent rewrites ITSELF, as a real
   *  agent's own edit tool does rather than through `fs/write_text_file`: the
   *  call pending with its diff and its location, the write, then the call
   *  completed with the same diff. `from` is replaced once by `to`; a file
   *  that is not there is made, folders and all, holding `to`. */
  | { editFile: { path: string; from: string; to: string } }
  | { commands: unknown[] }
  | { config: unknown[] }
  | { mode: string }
  | { title: string }
  | { usage: { used: number; size: number; cost?: { amount: number; currency: string } } }
  | { plan: unknown[] }
  | { sleep: number }
  /** Exit now, with this code, in the middle of whatever it was doing. */
  | { crash: number }
  /** A line on stdout that is not JSON. */
  | { garbage: string }
  /** A session update written in pieces, with a pause between. */
  | { partial: Record<string, unknown> }
  /** Answer the prompt with this error instead of a stop reason. */
  | { error: { code: number; message: string } }
  /** Wait until Stop arrives, bounded, and end `cancelled`. */
  | { waitCancel: number }
  /** A grandchild in a group of its own that outlives nothing: a `sleep`
   *  started detached, for the test that no process survives. Its pid is
   *  logged. */
  | { spawnSleeper: number }
  /** A `sleep` started in the agent's own group, as a tool it ran would be.
   *  Its pid is logged. */
  | { spawnChild: number }
  /** The stop reason; `end_turn` where no step names one. */
  | { stop: string };

export interface Scenario {
  protocolVersion?: number;
  authMethods?: unknown[];
  agentCapabilities?: Record<string, unknown>;
  agentInfo?: Record<string, unknown>;
  /** `initialize` itself: exit instead of answering, never answer, or wait. */
  initialize?: { crash?: boolean; hang?: boolean; delayMs?: number };
  session?: {
    /** Refuse `session/new` with ACP's auth-required error. */
    refuse?: boolean;
    /** Refuse unless this file exists — a sign-in done elsewhere. */
    refuseUnless?: string;
    /** Refuse `session/new`, `session/load` and `session/resume` in any
     *  process that has not called `authenticate` with one of `authMethods`
     *  — as Grok Build, Cursor and Junie do even when signed in. */
    requireAuthenticate?: boolean;
    configOptions?: unknown[];
    modes?: unknown;
    /** Sent as `available_commands_update` just after the session opens. */
    commands?: unknown[];
    /** What `session/load` replays before it answers. */
    replay?: { user: string; agent: string }[];
    /** Exit with code 1 instead of answering these — `session/new`,
     *  `session/resume`, `session/load` — leaving a child in its group that
     *  holds its stdout a moment longer, as a wrapper's child or a tool it
     *  started would: so its exit is seen no later than its output's end. */
    exitOn?: string[];
  };
  /** Refuse `session/prompt` with auth-required on this many first prompts. */
  refusePrompts?: number;
  /** One list of steps per prompt, in order; past the end, `echo`. */
  turns?: Step[][];
  /** A line on stdout that is not JSON, before anything else. */
  banner?: string;
  /** Where every message it hears is appended. */
  log?: string;
}

type Json = Record<string, unknown>;

/** Put the fake on a PATH: an executable `name` in `dir` that runs this file
 *  with `bun`, carrying a scenario where one is given. Answers its path. */
export function installFakeAgent(dir: string, opts: { name?: string; scenario?: Scenario } = {}): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, opts.name ?? "claude-agent-acp");
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const env = opts.scenario ? `FAKE_ACP_SCENARIO=${q(JSON.stringify(opts.scenario))} ` : "";
  writeFileSync(path, `#!/bin/sh\n# The scripted ACP agent of Biom's tests; invented, and it signs nobody in.\n${env}exec ${q(process.execPath)} run ${q(resolve(import.meta.dir, "fake-acp-agent.ts"))} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

/* ── the agent ────────────────────────────────────────────────────────── */

function scenarioFrom(argv: string[], env: Record<string, string | undefined>): Scenario {
  const at = argv.indexOf("--scenario");
  const raw = at >= 0 ? argv[at + 1] : env.FAKE_ACP_SCENARIO;
  if (!raw) return {};
  const text = raw.trimStart().startsWith("{") ? raw : readFileSync(raw, "utf8");
  return JSON.parse(text) as Scenario;
}

function run(scenario: Scenario): void {
  const cwdOf = new Map<string, string>();
  let nextId = 1;
  let sessions = 0;
  let prompts = 0;
  let cancelled = false;
  let refusedPrompts = 0;
  /** This process has called `authenticate` with a method it offers. */
  let authenticated = false;
  const needsAuth = (): boolean => scenario.session?.requireAuthenticate === true && !authenticated;
  const waiting = new Map<number, (msg: Json) => void>();

  const log = (msg: unknown) => {
    if (scenario.log) appendFileSync(scenario.log, `${JSON.stringify(msg)}\n`);
  };
  const out = (msg: Json) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const reply = (id: unknown, result: unknown) => out({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, code: number, message: string) => out({ jsonrpc: "2.0", id, error: { code, message } });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const update = (sessionId: string, u: Json) => out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });
  const ask = (method: string, params: Json): Promise<Json> => {
    const id = nextId++;
    return new Promise((res) => {
      waiting.set(id, res);
      out({ jsonrpc: "2.0", id, method, params });
    });
  };

  /** Exit in the middle of opening a session, where the scenario says to. */
  const dies = (method: string): boolean => {
    if (!(scenario.session?.exitOn ?? []).includes(method)) return false;
    spawn("sleep", ["30"], { stdio: ["ignore", "inherit", "ignore"] });
    setTimeout(() => process.exit(1), 50);
    return true;
  };

  const opened = (sessionId: string) => {
    const s = scenario.session ?? {};
    if (s.commands) setTimeout(() => update(sessionId, { sessionUpdate: "available_commands_update", availableCommands: s.commands }), 5);
  };

  const echoSteps = (text: string): Step[] => {
    const steps: Step[] = [{ thought: "Reading the message." }];
    // Only the new message steers it: a chat handed over carries the old ones.
    const marker = "The person's new message:\n\n";
    const own = text.includes(marker) ? text.slice(text.lastIndexOf(marker) + marker.length) : text;
    for (const line of own.split("\n")) {
      const m = /^!(\w+)\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const [, word, rest] = m as unknown as [string, string, string];
      if (word === "write") {
        const sp = rest.indexOf(" ");
        const path = sp < 0 ? rest : rest.slice(0, sp);
        steps.push({ write: { path, content: sp < 0 ? "" : rest.slice(sp + 1) } });
      } else if (word === "edit") {
        const sp = rest.indexOf(" ");
        const path = sp < 0 ? rest : rest.slice(0, sp);
        const spec = sp < 0 ? "" : rest.slice(sp + 1);
        const arrow = spec.indexOf("=>");
        const from = arrow < 0 ? spec : spec.slice(0, arrow);
        const to = (arrow < 0 ? "" : spec.slice(arrow + 2)).replace(/\\n/g, "\n");
        steps.push({ editFile: { path, from, to } });
      } else if (word === "sh") steps.push({ exec: rest, run: true });
      else if (word === "sleep") steps.push({ sleep: Number(rest) || 0 });
      else if (word === "crash") steps.push({ crash: 3 });
    }
    steps.push({ reply: `echo: ${text}` });
    return steps;
  };

  const turn = async (id: unknown, sessionId: string, text: string): Promise<void> => {
    const steps = scenario.turns?.[prompts - 1] ?? echoSteps(text);
    const cwd = cwdOf.get(sessionId) ?? process.cwd();
    let stop = "end_turn";
    let tools = 0;
    for (const step of steps) {
      if (cancelled) {
        reply(id, { stopReason: "cancelled" });
        return;
      }
      if ("thought" in step) update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: step.thought } });
      else if ("reply" in step) {
        // Two chunks, as an agent streams — IN ONE WRITE, so they arrive
        // together as the scenario means them to. Two writes are two reads at
        // the other end, and a host whose event loop stalled between them past
        // its push window sent the reply as two updates.
        const half = Math.ceil(step.reply.length / 2);
        const chunk = (text: string): Json => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
        process.stdout.write(`${JSON.stringify(chunk(step.reply.slice(0, half)))}\n${JSON.stringify(chunk(step.reply.slice(half)))}\n`);
      } else if ("tool" in step) update(sessionId, { sessionUpdate: "tool_call", ...step.tool });
      else if ("toolUpdate" in step) update(sessionId, { sessionUpdate: "tool_call_update", ...step.toolUpdate });
      else if ("write" in step) {
        const p = resolve(cwd, step.write.path);
        const r = await ask("fs/write_text_file", { sessionId, path: p, content: step.write.content });
        log({ fake: "write", path: p, answer: r });
      } else if ("read" in step) {
        const r = await ask("fs/read_text_file", { sessionId, path: resolve(cwd, step.read.path), line: step.read.line, limit: step.read.limit });
        log({ fake: "read", answer: r });
      } else if ("permission" in step) {
        const options = step.permission.options ?? [
          { optionId: "yes-once", name: "Allow once", kind: "allow_once" },
          { optionId: "yes-always", name: "Always allow", kind: "allow_always" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ];
        const r = await ask("session/request_permission", { sessionId, toolCall: { toolCallId: step.permission.toolCallId ?? "t-perm", title: "Something" }, options });
        log({ fake: "permission", answer: r });
      } else if ("exec" in step) {
        const tid = `exec-${prompts}-${++tools}`;
        update(sessionId, { sessionUpdate: "tool_call", toolCallId: tid, title: step.exec, kind: "execute", status: "pending", rawInput: { command: step.exec, ...(step.cwd ? { cwd: step.cwd } : {}) } });
        if (step.run) spawnSync("sh", ["-c", step.exec], { cwd });
        update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: tid, status: "completed", content: [{ type: "content", content: { type: "text", text: "(ran)" } }] });
      } else if ("editFile" in step) {
        const tid = `edit-${prompts}-${++tools}`;
        const p = resolve(cwd, step.editFile.path);
        const old = existsSync(p) ? readFileSync(p, "utf8") : null;
        const next = old === null ? step.editFile.to : old.replace(step.editFile.from, step.editFile.to);
        const diff = [{ type: "diff", path: p, oldText: old, newText: next }];
        update(sessionId, { sessionUpdate: "tool_call", toolCallId: tid, title: `Edit ${step.editFile.path}`, kind: "edit", status: "pending", locations: [{ path: p }], content: diff });
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, next);
        update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: tid, status: "completed", content: diff });
      } else if ("commands" in step) update(sessionId, { sessionUpdate: "available_commands_update", availableCommands: step.commands });
      else if ("config" in step) update(sessionId, { sessionUpdate: "config_option_update", configOptions: step.config });
      else if ("mode" in step) update(sessionId, { sessionUpdate: "current_mode_update", currentModeId: step.mode });
      else if ("title" in step) update(sessionId, { sessionUpdate: "session_info_update", title: step.title });
      else if ("usage" in step) update(sessionId, { sessionUpdate: "usage_update", ...step.usage });
      else if ("plan" in step) update(sessionId, { sessionUpdate: "plan", entries: step.plan });
      else if ("sleep" in step) await sleep(step.sleep);
      else if ("crash" in step) process.exit(step.crash);
      else if ("garbage" in step) process.stdout.write(`${step.garbage}\n`);
      else if ("partial" in step) {
        const text = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: step.partial } });
        const third = Math.ceil(text.length / 3);
        process.stdout.write(text.slice(0, third));
        await sleep(15);
        process.stdout.write(text.slice(third, 2 * third));
        await sleep(15);
        process.stdout.write(`${text.slice(2 * third)}\r\n`);
      } else if ("error" in step) {
        fail(id, step.error.code, step.error.message);
        return;
      } else if ("waitCancel" in step) {
        const until = Date.now() + step.waitCancel;
        while (!cancelled && Date.now() < until) await sleep(10);
        if (cancelled) {
          reply(id, { stopReason: "cancelled" });
          return;
        }
      } else if ("spawnSleeper" in step) {
        const child = spawn("sleep", [String(step.spawnSleeper)], { detached: true, stdio: "ignore" });
        log({ fake: "sleeper", pid: child.pid });
      } else if ("spawnChild" in step) {
        const child = spawn("sleep", [String(step.spawnChild)], { stdio: "ignore" });
        log({ fake: "child", pid: child.pid });
      } else if ("stop" in step) stop = step.stop;
    }
    reply(id, { stopReason: cancelled ? "cancelled" : stop });
  };

  const handle = async (msg: Json): Promise<void> => {
    log(msg);
    const method = msg.method;
    const id = msg.id;
    const params = (msg.params ?? {}) as Json;
    if (typeof method !== "string") {
      const got = typeof id === "number" ? waiting.get(id) : undefined;
      if (got) {
        waiting.delete(id as number);
        got(msg);
      }
      return;
    }
    switch (method) {
      case "initialize": {
        const i = scenario.initialize ?? {};
        if (i.crash) process.exit(4);
        if (i.hang) return;
        if (i.delayMs) await sleep(i.delayMs);
        reply(id, {
          protocolVersion: scenario.protocolVersion ?? 1,
          agentCapabilities: scenario.agentCapabilities ?? { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false } },
          authMethods: scenario.authMethods ?? [],
          agentInfo: scenario.agentInfo ?? { name: "fake-acp-agent", title: "Fake agent (invented, for tests)", version: "0.0.0" },
        });
        return;
      }
      case "authenticate": {
        const offered = (scenario.authMethods ?? []).map((m) => (m as Json).id);
        if (!offered.includes(params.methodId)) {
          fail(id, -32602, "the fake offers no sign-in by that name");
          return;
        }
        authenticated = true;
        reply(id, {});
        return;
      }
      case "session/new": {
        const s = scenario.session ?? {};
        if (dies(method)) return;
        if (s.refuse || needsAuth() || (s.refuseUnless && !existsSync(s.refuseUnless))) {
          fail(id, -32000, "Authentication required");
          return;
        }
        const sessionId = `fake-session-${process.pid}-${++sessions}`;
        cwdOf.set(sessionId, typeof params.cwd === "string" ? params.cwd : process.cwd());
        reply(id, { sessionId, configOptions: s.configOptions ?? null, modes: s.modes ?? null });
        opened(sessionId);
        return;
      }
      case "session/load":
      case "session/resume": {
        const s = scenario.session ?? {};
        if (dies(method)) return;
        if (needsAuth()) {
          fail(id, -32000, "Authentication required");
          return;
        }
        const sessionId = String(params.sessionId);
        cwdOf.set(sessionId, typeof params.cwd === "string" ? params.cwd : process.cwd());
        if (method === "session/load") {
          for (const r of s.replay ?? []) {
            update(sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text: r.user } });
            update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: r.agent } });
          }
        }
        reply(id, { configOptions: s.configOptions ?? null, modes: s.modes ?? null });
        opened(sessionId);
        return;
      }
      case "session/prompt": {
        const sessionId = String(params.sessionId);
        if (refusedPrompts < (scenario.refusePrompts ?? 0)) {
          refusedPrompts++;
          fail(id, -32000, "Authentication required");
          return;
        }
        prompts++;
        cancelled = false;
        const blocks = Array.isArray(params.prompt) ? (params.prompt as Json[]) : [];
        const text = blocks.map((b) => (typeof b.text === "string" ? b.text : "")).join("");
        await turn(id, sessionId, text);
        return;
      }
      case "session/cancel":
        cancelled = true;
        return;
      case "session/set_config_option": {
        const opts = (scenario.session?.configOptions ?? []) as Json[];
        const next = opts.map((o) => (o.id === params.configId ? { ...o, currentValue: params.value } : o));
        if (scenario.session) scenario.session.configOptions = next;
        reply(id, { configOptions: next });
        return;
      }
      case "session/set_mode":
        reply(id, {});
        return;
      case "session/delete": {
        // Only where `initialize` offered it, as a real agent's is.
        const caps = (scenario.agentCapabilities ?? {}) as Json;
        const sc = (caps.sessionCapabilities ?? {}) as Json;
        if (typeof sc.delete !== "object" || sc.delete === null) {
          if (id !== undefined) fail(id, -32601, "the fake does not offer session/delete");
          return;
        }
        reply(id, {});
        return;
      }
      default:
        if (id !== undefined) fail(id, -32601, `the fake does not offer ${method}`);
    }
  };

  log({ fake: "started", pid: process.pid });
  if (scenario.banner) process.stdout.write(`${scenario.banner}\n`);
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    for (;;) {
      const at = buf.indexOf("\n");
      if (at < 0) break;
      const line = buf.slice(0, at).trim();
      buf = buf.slice(at + 1);
      if (line === "") continue;
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        continue;
      }
      void handle(msg);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

if (import.meta.main) run(scenarioFrom(process.argv.slice(2), process.env));
