// SPDX-License-Identifier: AGPL-3.0-only
// The agents this machine has, found and probed with nothing real run: the
// PATH is a table the test writes, the login environment is invented, the
// network is a function, and every agent is a scripted fake `AcpConnection`
// answering `initialize`, `session/new` and — only where a sign-in was asked
// for — `authenticate`. Every agent, key, command and session here is invented.
//
// What is held: an agent on the PATH is listed and probed Active with its
// pickers and commands; one that is not there is not listed; one Biom
// installed is found in its own folder; Claude Code is its CLI plus an adapter
// npx runs, and says so plainly when there is no Node; OpenClaw is reached only
// through a Gateway on this machine, and Start Gateway starts it; a refused
// session is Inactive with the ways to sign in listed, a crash and a hang are
// Inactive with a sentence, and NO PROBE EVER SENDS `authenticate`; a sign-in
// runs `authenticate` only when asked and believes the session after it; a
// terminal sign-in answers the pop-up's command and a single-use ticket; a
// refusal is sticky until a sign-in; and no key of the person's is ever in
// what the client is handed.

import { test, expect, afterAll } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeAgents } from "../server/workspace/agents.ts";
import type { Agents, AgentsDeps } from "../server/workspace/agents.ts";
import type { AcpConnection, AcpExit } from "../server/platform/acp.ts";
import { initializeParams, toConfigOptions } from "../server/platform/acp-wire.ts";
import type { AgentInfo, AgentLaunch, ProcessRunner } from "../contracts/types.ts";

const scratch = mkdtempSync(join(tmpdir(), "biom-agents-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const freshHome = (): string => {
  const at = join(scratch, `home-${++n}`);
  mkdirSync(at, { recursive: true });
  return at;
};

const SECRET = "sk-invented-0123456789";
const LOGIN = { PATH: "/invented/bin:/usr/bin", HOME: "/home/someone", ANTHROPIC_API_KEY: SECRET };

/* ── the fake agent ───────────────────────────────────────────────────── */

type Handler = (params: unknown, agent: { notify(method: string, params: unknown): void; exit(code: number): void }) => unknown;
type Script = Record<string, Handler>;

interface Call {
  launch: AgentLaunch;
  cwd: string;
  methods: string[];
  params: Record<string, unknown>;
  closed: boolean;
  killed: boolean;
}

const acpError = (code: number, message: string): Error => Object.assign(new Error(message), { code });

/** A connection per launch, answering from `script(launch)`. */
function agentsOnFake(script: (launch: AgentLaunch) => Script) {
  const calls: Call[] = [];
  const connect = (launch: AgentLaunch, cwd: string): AcpConnection => {
    const call: Call = { launch, cwd, methods: [], params: {}, closed: false, killed: false };
    calls.push(call);
    const heard = new Set<(method: string, params: unknown) => void>();
    let finish!: (e: AcpExit) => void;
    const closed = new Promise<AcpExit>((r) => {
      finish = r;
    });
    const sc = script(launch);
    const agent = {
      notify: (m: string, p: unknown) => {
        for (const fn of heard) fn(m, p);
      },
      exit: (code: number) => finish({ code, signal: null }),
    };
    return {
      async request(method, params) {
        call.methods.push(method);
        call.params[method] = params;
        const h = sc[method];
        if (h === undefined) throw acpError(-32601, "Method not found");
        return await h(params, agent);
      },
      notify() {},
      handle() {},
      onNotification(fn) {
        heard.add(fn);
        return () => {
          heard.delete(fn);
        };
      },
      stderr: () => "an invented stderr line",
      async close() {
        call.closed = true;
        finish({ code: 0, signal: null });
        return closed;
      },
      kill() {
        call.killed = true;
        finish({ code: null, signal: "SIGKILL" });
      },
      closed,
    };
  };
  return { connect, calls };
}

/** An agent that opens a session, with a model picker and two commands. */
const healthy = (version = "1.2.3"): Script => ({
  initialize: () => ({
    protocolVersion: 1,
    agentInfo: { name: "invented", version },
    authMethods: [{ id: "login", name: "Log in", description: "In a browser" }],
  }),
  authenticate: () => ({}),
  "session/new": (_p, agent) => {
    setTimeout(() => agent.notify("session/update", {
      sessionId: "s-1",
      update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "/review", description: "Review a diff", input: { hint: "what" } }, { name: "init", description: "Start" }] },
    }), 1);
    return {
      sessionId: "s-1",
      configOptions: [{
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "m-small",
        options: [{ group: "fast", name: "Fast ones", options: [{ value: "m-small", name: "Small" }] }, { group: "big", name: "Big ones", options: [{ value: "m-large", name: "Large", description: "Slow" }] }],
      }],
    };
  },
});

/** Refuses a session until signed in, and offers every kind of sign-in. */
function gated(): { script: Script; signedIn: () => boolean } {
  let signed = false;
  return {
    signedIn: () => signed,
    script: {
      initialize: () => ({
        protocolVersion: 1,
        authMethods: [
          { id: "browser", name: "Browser", description: "Opens a browser" },
          { id: "tui", name: "Terminal", type: "terminal", args: ["auth", "login"], env: { LOGIN_MODE: "tty" } },
          { id: "legacy", name: "Old terminal", _meta: { "terminal-auth": { command: "/invented/bin/old-login", args: ["login"], env: { OLD: "1" } } } },
          { id: "key", name: "API key", type: "env_var", vars: [{ name: "INVENTED_API_KEY" }] },
        ],
      }),
      authenticate: () => {
        signed = true;
        return {};
      },
      "session/new": () => {
        if (!signed) throw acpError(-32000, "Authentication required: " + SECRET);
        return { sessionId: "s-2" };
      },
    },
  };
}

/* ── the machine ──────────────────────────────────────────────────────── */

interface Machine {
  agents: Agents;
  calls: Call[];
  fetched: string[];
  started: { cmd: string[]; env: Record<string, string> }[];
  heard: AgentInfo[][];
  home: string;
}

function machine(opts: {
  bins: Record<string, string>;
  script?: (launch: AgentLaunch) => Script;
  routes?: Record<string, () => Response>;
  env?: Record<string, string>;
  home?: string;
  onStart?: (cmd: string[]) => void;
  timing?: AgentsDeps["timing"];
  onSignedIn?: AgentsDeps["onSignedIn"];
  now?: () => number;
  /** The login environment as the server keeps it — read once and kept — in
   *  place of `env`, and the way to drop that reading. */
  readEnv?: () => Promise<Record<string, string>>;
  forgetEnv?: () => void;
}): Machine {
  const { connect, calls } = agentsOnFake(opts.script ?? (() => healthy()));
  const fetched: string[] = [];
  const started: { cmd: string[]; env: Record<string, string> }[] = [];
  const routes = opts.routes ?? {};
  const processes: ProcessRunner = {
    start(spec) {
      started.push({ cmd: spec.cmd, env: spec.env });
      opts.onStart?.(spec.cmd);
      return { pid: 4242, pgid: 4242, born: null, done: new Promise(() => {}) };
    },
    async end() {},
    killNow() {},
    alive: () => false,
  };
  const home = opts.home ?? freshHome();
  const agents = makeAgents({
    connect,
    env: opts.readEnv ?? (async () => ({ ...(opts.env ?? LOGIN) })),
    ...(opts.forgetEnv === undefined ? {} : { forgetEnv: opts.forgetEnv }),
    which: async (c) => opts.bins[c] ?? null,
    fetch: (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      fetched.push(url);
      const route = routes[url];
      if (route === undefined) throw new TypeError("fetch failed");
      return route();
    }) as typeof fetch,
    home,
    cwd: "/invented/vault",
    now: opts.now ?? (() => Date.now()),
    processes,
    onSignedIn: opts.onSignedIn,
    timing: { initialize: 300, session: 300, commands: 50, gatewayPoll: 5, gatewayWait: 500, ...opts.timing },
  });
  const heard: AgentInfo[][] = [];
  agents.on((list) => heard.push(list));
  return { agents, calls, fetched, started, heard, home };
}

const byKey = (list: AgentInfo[], key: string): AgentInfo | undefined => list.find((a) => a.key === key);

/* ── finding and probing ──────────────────────────────────────────────── */

test("an agent on the PATH is listed and probed Active, with its pickers and commands; one not there is not listed", async () => {
  const m = machine({ bins: { opencode: "/invented/bin/opencode" } });
  expect(m.agents.list()).toEqual([]); // nothing waits: finding has only started
  await m.agents.settled();
  const list = m.agents.list();
  expect(list.map((a) => a.key)).toEqual(["opencode"]);
  const a = list[0] as AgentInfo;
  expect(a.state).toBe("active");
  expect(a.reason).toBeNull();
  expect(a.source).toBe("path");
  expect(a.name).toBe("OpenCode");
  expect(a.version).toBe("1.2.3");
  expect(a.options).toEqual([{
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    value: "m-small",
    choices: [
      { value: "m-small", name: "Small", description: null, group: "Fast ones" },
      { value: "m-large", name: "Large", description: "Slow", group: "Big ones" },
    ],
  }]);
  expect(a.commands).toEqual([
    { name: "review", description: "Review a diff", hint: "what", source: "agent", skill: null },
    { name: "init", description: "Start", hint: null, source: "agent", skill: null },
  ]);
  // It was started as the table says, in the vault, with the login environment.
  const call = m.calls[0] as Call;
  expect(call.launch.command).toBe("/invented/bin/opencode");
  expect(call.launch.args).toEqual(["acp"]);
  expect(call.launch.env.ANTHROPIC_API_KEY).toBe(SECRET);
  expect(call.cwd).toBe("/invented/vault");
  // Offered exactly what a chat offers — the one reading of the protocol:
  // files both ways, no terminal, both sign-in flags.
  expect(call.params.initialize).toEqual(initializeParams());
  expect(call.params.initialize).toMatchObject({
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true }, _meta: { "terminal-auth": true } },
  });
  expect(call.params["session/new"]).toEqual({ cwd: "/invented/vault", mcpServers: [] });
  expect(call.methods).not.toContain("authenticate");
  expect(call.closed).toBe(true);
  // The subscribers heard it land.
  expect(byKey(m.heard.at(-1) ?? [], "opencode")?.state).toBe("active");
  // And a chat can start it.
  const launch = await m.agents.launch("opencode");
  expect(launch).toEqual({ command: "/invented/bin/opencode", args: ["acp"], env: { ...LOGIN } });
  expect(await m.agents.launch("gemini")).toBeNull();
});

test("an agent Biom installed is found in its own folder, run with node where it is JavaScript", async () => {
  const home = freshHome();
  // One the known-agents table does not name, and one it does.
  mkdirSync(join(home, "dirac", "0.5.16"), { recursive: true });
  writeFileSync(join(home, "dirac", "0.5.16", "cli.js"), "// invented");
  writeFileSync(join(home, "dirac", "installed.json"), JSON.stringify({ key: "dirac", version: "0.5.16", via: "npx", file: "0.5.16/cli.js", node: true, args: ["--acp"], env: { DIRAC: "1" } }));
  mkdirSync(join(home, "kimi", "1.52.0"), { recursive: true });
  writeFileSync(join(home, "kimi", "1.52.0", "kimi"), "#!/bin/sh\n");
  chmodSync(join(home, "kimi", "1.52.0", "kimi"), 0o755);
  writeFileSync(join(home, "kimi", "installed.json"), JSON.stringify({ key: "kimi", version: "1.52.0", via: "binary", file: "1.52.0/kimi", node: false, args: ["acp"], env: {} }));
  // A manifest that points outside the folder is not believed.
  mkdirSync(join(home, "cline"), { recursive: true });
  writeFileSync(join(home, "cline", "installed.json"), JSON.stringify({ key: "cline", version: "1.0.0", via: "binary", file: "../../etc/passwd", node: false, args: [], env: {} }));
  const m = machine({ bins: { node: "/invented/bin/node" }, home });
  m.agents.list();
  await m.agents.settled();
  const list = m.agents.list();
  expect(list.map((a) => a.key).sort()).toEqual(["dirac", "kimi"]);
  for (const a of list) {
    expect(a.source).toBe("installed");
    expect(a.state).toBe("active");
  }
  expect(byKey(list, "dirac")?.name).toBe("dirac");
  const dirac = m.calls.find((c) => c.launch.args.includes("--acp")) as Call;
  expect(dirac.launch.command).toBe("/invented/bin/node");
  expect(dirac.launch.args).toEqual([join(home, "dirac", "0.5.16", "cli.js"), "--acp"]);
  expect(dirac.launch.env.DIRAC).toBe("1");
  const kimi = await m.agents.launch("kimi");
  expect(kimi?.command).toBe(join(home, "kimi", "1.52.0", "kimi"));
});

test("Claude Code is its CLI plus an adapter npx runs, pinned — or its adapter on the PATH — and says plainly when there is no Node", async () => {
  const withNode = machine({ bins: { claude: "/invented/bin/claude", npx: "/invented/bin/npx" } });
  withNode.agents.list();
  await withNode.agents.settled();
  const a = byKey(withNode.agents.list(), "claude-acp") as AgentInfo;
  expect(a.name).toBe("Claude Code");
  expect(a.state).toBe("active");
  expect(withNode.calls[0]?.launch.command).toBe("/invented/bin/npx");
  expect(withNode.calls[0]?.launch.args).toEqual(["--yes", "@agentclientprotocol/claude-agent-acp@0.81.2"]);

  const noNode = machine({ bins: { claude: "/invented/bin/claude" } });
  noNode.agents.list();
  await noNode.agents.settled();
  const b = byKey(noNode.agents.list(), "claude-acp") as AgentInfo;
  expect(b.state).toBe("inactive");
  expect(b.reason).toBe("failed");
  expect(b.message).toContain("Node.js");
  expect(noNode.calls).toEqual([]);
  expect(await noNode.agents.launch("claude-acp")).toBeNull();

  // The adapter's own command on the PATH is Claude Code, run as it is —
  // which is how the end-to-end suite's fake agent is found.
  const adapter = machine({ bins: { "claude-agent-acp": "/sandbox/bin/claude-agent-acp" } });
  adapter.agents.list();
  await adapter.agents.settled();
  expect(byKey(adapter.agents.list(), "claude-acp")?.state).toBe("active");
  expect(adapter.calls[0]?.launch).toEqual({ command: "/sandbox/bin/claude-agent-acp", args: [], env: { ...LOGIN } });
});

test("OpenClaw is reached only through a Gateway on this machine, and Start Gateway starts it", async () => {
  // The person's own settings name a Gateway on another machine; it is never asked.
  const env = { ...LOGIN, OPENCLAW_GATEWAY_URL: "wss://gateway.invented.example:18789" };
  let up = false;
  const m = machine({
    bins: { openclaw: "/invented/bin/openclaw" },
    env,
    routes: { "http://127.0.0.1:18789/": () => {
      if (!up) throw new TypeError("connection refused");
      return new Response("ok");
    } },
    onStart: (cmd) => {
      if (cmd[1] === "gateway") up = true;
    },
  });
  m.agents.list();
  await m.agents.settled();
  const down = byKey(m.agents.list(), "openclaw") as AgentInfo;
  expect(down.state).toBe("inactive");
  expect(down.reason).toBe("gateway");
  expect(m.calls).toEqual([]); // no bridge started against no Gateway
  expect(await m.agents.launch("openclaw")).toBeNull();

  const answered = m.agents.start("openclaw");
  expect(answered.reason).toBe("checking");
  await m.agents.settled();
  expect(m.started[0]?.cmd).toEqual(["/invented/bin/openclaw", "gateway", "--port", "18789"]);
  const on = byKey(m.agents.list(), "openclaw") as AgentInfo;
  expect(on.state).toBe("active");
  // The bridge is pointed at the local Gateway by address, whatever the settings say.
  expect(m.calls[0]?.launch.args).toEqual(["acp", "--url", "ws://127.0.0.1:18789"]);
  expect(m.fetched.every((u) => u.startsWith("http://127.0.0.1:18789/"))).toBe(true);
  expect(m.fetched.some((u) => u.includes("invented.example"))).toBe(false);
  expect(() => m.agents.start("opencode")).toThrow();
});

test("a Gateway that does not come up is said so", async () => {
  const m = machine({ bins: { openclaw: "/invented/bin/openclaw" }, timing: { gatewayWait: 30 } });
  m.agents.list();
  await m.agents.settled();
  m.agents.start("openclaw");
  await m.agents.settled();
  const a = byKey(m.agents.list(), "openclaw") as AgentInfo;
  expect(a.reason).toBe("gateway");
  expect(a.message).toContain("did not start");
});

test("a probe deletes the session it opened where the agent offers that, so looking leaves no empty chat behind", async () => {
  const deleted: unknown[] = [];
  const tidy = machine({
    bins: { opencode: "/invented/bin/opencode", gemini: "/invented/bin/gemini" },
    script: (launch) => launch.command.endsWith("opencode")
      ? {
        ...healthy(),
        initialize: () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { delete: {} } } }),
        "session/delete": (p) => {
          deleted.push(p);
          return {};
        },
      }
      : healthy(),
  });
  tidy.agents.list();
  await tidy.agents.settled();
  expect(deleted).toEqual([{ sessionId: "s-1" }]);
  const gemini = tidy.calls.find((c) => c.launch.command.endsWith("gemini")) as Call;
  expect(gemini.methods).not.toContain("session/delete");
  for (const c of tidy.calls) expect(c.closed).toBe(true);
  expect(tidy.agents.list().every((a) => a.state === "active")).toBe(true);
});

/* ── Inactive, and why ────────────────────────────────────────────────── */

test("a refused session is Inactive with every way to sign in listed, and the probe never sent authenticate", async () => {
  const g = gated();
  const m = machine({ bins: { gemini: "/invented/bin/gemini" }, script: () => g.script });
  m.agents.list();
  await m.agents.settled();
  const a = byKey(m.agents.list(), "gemini") as AgentInfo;
  expect(a.state).toBe("inactive");
  expect(a.reason).toBe("signin");
  expect(a.auth).toEqual([
    { id: "browser", name: "Browser", description: "Opens a browser", type: "agent", vars: [] },
    { id: "tui", name: "Terminal", description: null, type: "terminal", vars: [] },
    { id: "legacy", name: "Old terminal", description: null, type: "terminal", vars: [] },
    { id: "key", name: "API key", description: null, type: "env_var", vars: ["INVENTED_API_KEY"] },
  ]);
  // Looked at again, still no authenticate: only a sign-in the person asks for sends one.
  m.agents.probe("gemini");
  await m.agents.settled();
  for (const c of m.calls) expect(c.methods).not.toContain("authenticate");
  expect(g.signedIn()).toBe(false);
  // The agent's own words, which carried a secret, never reach the list.
  expect(JSON.stringify(m.agents.list())).not.toContain(SECRET);
});

test("a crash and a hang are Inactive with a sentence of Biom's own, and the connection is closed", async () => {
  const crash = machine({
    bins: { opencode: "/invented/bin/opencode" },
    script: () => ({
      initialize: (_p, agent) => {
        agent.exit(3);
        throw new Error("the agent's process ended: " + SECRET);
      },
    }),
  });
  crash.agents.list();
  await crash.agents.settled();
  const a = byKey(crash.agents.list(), "opencode") as AgentInfo;
  expect(a.reason).toBe("failed");
  expect(a.message).toBe("It stopped (exit code 3) before answering.");

  const hang = machine({
    bins: { opencode: "/invented/bin/opencode" },
    script: () => ({ initialize: () => new Promise(() => {}) }),
    timing: { initialize: 40 },
  });
  const t0 = Date.now();
  hang.agents.list();
  await hang.agents.settled();
  expect(Date.now() - t0).toBeLessThan(3000);
  const b = byKey(hang.agents.list(), "opencode") as AgentInfo;
  expect(b.reason).toBe("failed");
  expect(b.message).toContain("did not answer");
  expect(hang.calls[0]?.closed).toBe(true);

  const slowSession = machine({
    bins: { opencode: "/invented/bin/opencode" },
    script: () => ({ ...healthy(), "session/new": () => new Promise(() => {}) }),
    timing: { session: 40 },
  });
  slowSession.agents.list();
  await slowSession.agents.settled();
  expect(byKey(slowSession.agents.list(), "opencode")?.message).toContain("did not open a session");
  expect(JSON.stringify([crash.agents.list(), hang.agents.list()])).not.toContain(SECRET);
});

test("an agent that will not even connect is Inactive, and killAll closes a probe in flight", async () => {
  const m = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ initialize: () => new Promise(() => {}) }), timing: { initialize: 60_000 } });
  m.agents.list();
  for (let i = 0; i < 50 && m.calls.length === 0; i++) await Bun.sleep(5);
  expect(m.calls.length).toBe(1);
  m.agents.killAll();
  // KILL at once, for an exit handler that runs no timer again.
  expect(m.calls[0]?.killed).toBe(true);
});

test("the probe reads its pickers as a chat does, so an option id from the probe is one a chat's session knows", async () => {
  const modes = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code", description: "Writes" }] };
  const configOptions = [{ id: "mode", name: "Style", category: "other", type: "boolean", currentValue: false }];
  const m = machine({
    bins: { opencode: "/invented/bin/opencode" },
    script: () => ({ ...healthy(), "session/new": () => ({ sessionId: "s-9", configOptions, modes }) }),
  });
  m.agents.list();
  await m.agents.settled();
  const a = byKey(m.agents.list(), "opencode") as AgentInfo;
  expect(a.options).toEqual(toConfigOptions(configOptions, modes).options);
  // The older modes are a mode option, under "_mode" because "mode" is taken.
  expect(a.options.map((o) => o.id)).toEqual(["mode", "_mode"]);
});

test("an agent answering another major of ACP is Inactive, as a chat would refuse it", async () => {
  const m = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ ...healthy(), initialize: () => ({ protocolVersion: 2 }) }) });
  m.agents.list();
  await m.agents.settled();
  const a = byKey(m.agents.list(), "opencode") as AgentInfo;
  expect(a.reason).toBe("failed");
  expect(a.message).toBe("It speaks ACP version 2, and Biom speaks 1.");
  expect(m.calls[0]?.methods).toEqual(["initialize"]);
});

test("the sign-in retry handshake the chats wait on: refused is heard Inactive at once, and only a sign-in is heard Active again", async () => {
  const states = (m: Machine): string[] => m.heard.map((l) => {
    const a = byKey(l, "opencode");
    return a === undefined ? "absent" : a.state === "active" ? "active" : `inactive:${a.reason}`;
  });
  // A terminal sign-in, ended by ticket.
  const t = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ ...healthy(), initialize: () => ({ protocolVersion: 1, authMethods: [{ id: "t", name: "T", type: "terminal", args: ["login"] }] }) }) });
  t.agents.list();
  await t.agents.settled();
  t.heard.length = 0;
  t.agents.refused("opencode");
  // Synchronously, in refused() itself.
  expect(states(t)).toEqual(["inactive:signin"]);
  // A look again in between opens a session and is still not heard Active.
  t.agents.probe("opencode");
  await t.agents.settled();
  const s = await t.agents.signIn("opencode", "t");
  if (s.kind !== "terminal") throw new Error("expected a terminal sign-in");
  t.agents.redeem(s.ticket);
  t.agents.signedIn(s.ticket);
  await t.agents.settled();
  const seen = states(t);
  expect(seen[0]).toBe("inactive:signin");
  expect(seen.at(-1)).toBe("active");
  expect(seen.indexOf("active")).toBe(seen.length - 1);

  // An agent-type sign-in.
  const g = machine({ bins: { opencode: "/invented/bin/opencode" } });
  g.agents.list();
  await g.agents.settled();
  g.heard.length = 0;
  g.agents.refused("opencode");
  expect(states(g)).toEqual(["inactive:signin"]);
  await g.agents.signIn("opencode", "login");
  await g.agents.settled();
  const heard = states(g);
  expect(heard.at(-1)).toBe("active");
  expect(heard.slice(0, -1).every((x) => x.startsWith("inactive:"))).toBe(true);
});

/* ── signing in ───────────────────────────────────────────────────────── */

test("an agent-type sign-in runs authenticate, then believes the session it opens on the same connection", async () => {
  const g = gated();
  const m = machine({ bins: { gemini: "/invented/bin/gemini" }, script: () => g.script });
  m.agents.list();
  await m.agents.settled();
  expect(await m.agents.signIn("gemini", "browser")).toEqual({ kind: "agent" });
  await m.agents.settled();
  const a = byKey(m.agents.list(), "gemini") as AgentInfo;
  expect(a.state).toBe("active");
  const signing = m.calls.at(-1) as Call;
  expect(signing.methods).toEqual(["initialize", "authenticate", "session/new"]);
  expect(signing.params.authenticate).toEqual({ methodId: "browser" });
  // Gemini keeps its sign-in between processes, so nothing sends it
  // `authenticate` unasked: only an agent that wants it in every process has
  // a method here.
  expect(m.agents.signedInWith("gemini")).toBeNull();
  // Now Active, it is not waiting to be signed in, and asking again is refused
  // rather than risking signing the person out.
  await expect(m.agents.signIn("gemini", "browser")).rejects.toThrow("not waiting to be signed in");
});

test("a terminal sign-in answers the pop-up's command and a ticket, and the ticket is spent once", async () => {
  const g = gated();
  const m = machine({ bins: { gemini: "/invented/bin/gemini" }, script: () => g.script });
  m.agents.list();
  await m.agents.settled();
  const probes = m.calls.length;

  const native = await m.agents.signIn("gemini", "tui");
  if (native.kind !== "terminal") throw new Error("expected a terminal sign-in");
  // The agent's own command with the method's arguments; the METHOD's env only.
  expect(native.command).toBe("/invented/bin/gemini");
  expect(native.args).toEqual(["--acp", "auth", "login"]);
  expect(native.env).toEqual({ LOGIN_MODE: "tty" });
  expect(JSON.stringify(native)).not.toContain(SECRET);
  expect(native.ticket).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  // No agent was started for it: the pop-up runs it.
  expect(m.calls.length).toBe(probes);

  const legacy = await m.agents.signIn("gemini", "legacy");
  if (legacy.kind !== "terminal") throw new Error("expected a terminal sign-in");
  expect(legacy.command).toBe("/invented/bin/old-login");
  expect(legacy.args).toEqual(["login"]);
  expect(legacy.env).toEqual({ OLD: "1" });

  const redeemed = m.agents.redeem(native.ticket);
  expect(redeemed?.agent).toBe("gemini");
  expect(redeemed?.command).toBe("/invented/bin/gemini");
  expect(redeemed?.args).toEqual(["--acp", "auth", "login"]);
  // What the pop-up runs has the COMPLETE environment — the login shell's and
  // the method's — because the terminal takes it as the whole of it.
  expect(redeemed?.env).toEqual({ ...LOGIN, LOGIN_MODE: "tty" });
  expect(m.agents.redeem(native.ticket)).toBeNull();
  expect(m.agents.redeem("not a ticket at all")).toBeNull();
  expect(m.agents.redeem("AAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();

  // An env_var method is the person's to set; a name that is no method is refused.
  await expect(m.agents.signIn("gemini", "key")).rejects.toThrow("INVENTED_API_KEY");
  await expect(m.agents.signIn("gemini", "nope")).rejects.toThrow();
  for (const c of m.calls) expect(c.methods).not.toContain("authenticate");
});

test("a ticket expires", async () => {
  const g = gated();
  let now = 1_000_000;
  const { connect } = agentsOnFake(() => g.script);
  const agents = makeAgents({
    connect,
    env: async () => ({ ...LOGIN }),
    which: async (c) => (c === "gemini" ? "/invented/bin/gemini" : null),
    fetch: (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch,
    home: freshHome(),
    cwd: "/invented/vault",
    now: () => now,
    processes: { start: () => ({ pid: -1, pgid: -1, born: null, done: Promise.resolve({ exit: null, signal: "ENOENT" }) }), end: async () => {}, killNow() {}, alive: () => false },
    timing: { commands: 10, ticket: 1000 },
  });
  agents.list();
  await agents.settled();
  const s = await agents.signIn("gemini", "tui");
  if (s.kind !== "terminal") throw new Error("expected a terminal sign-in");
  now += 1001;
  expect(agents.redeem(s.ticket)).toBeNull();
});

test("a refusal from a chat is sticky until a sign-in, and the probe after the pop-up believes the session", async () => {
  const m = machine({ bins: { opencode: "/invented/bin/opencode" } });
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "opencode")?.state).toBe("active");
  // The session opened, and then the first message was refused.
  m.agents.refused("opencode");
  let a = byKey(m.agents.list(), "opencode") as AgentInfo;
  expect(a.reason).toBe("signin");
  expect(a.options).toEqual([]);
  // A plain look again opens a session — and it stays signed out.
  m.agents.probe("opencode");
  await m.agents.settled();
  expect(byKey(m.agents.list(), "opencode")?.reason).toBe("signin");
  // The person signs in in the pop-up; when its command exits, the probe believes the session.
  m.calls.length = 0;
  const methods = (await m.agents.signIn("opencode", "login"));
  expect(methods).toEqual({ kind: "agent" }); // "login" is an agent-type method here
  await m.agents.settled();
  expect(byKey(m.agents.list(), "opencode")?.state).toBe("active");

  // A sign-in that does not finish leaves it waiting to be signed in, so
  // another way can be tried.
  const failing = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ ...healthy(), authenticate: () => {
    throw acpError(-32603, "no browser: " + SECRET);
  } }) });
  failing.agents.list();
  await failing.agents.settled();
  failing.agents.refused("opencode");
  await failing.agents.signIn("opencode", "login");
  await failing.agents.settled();
  a = byKey(failing.agents.list(), "opencode") as AgentInfo;
  expect(a.reason).toBe("signin");
  expect(a.message).toBe("The sign-in did not finish.");

  const terminal = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ ...healthy(), initialize: () => ({ protocolVersion: 1, authMethods: [{ id: "t", name: "T", type: "terminal", args: ["login"] }] }) }) });
  terminal.agents.list();
  await terminal.agents.settled();
  terminal.agents.refused("opencode");
  const s = await terminal.agents.signIn("opencode", "t");
  if (s.kind !== "terminal") throw new Error("expected a terminal sign-in");
  expect(terminal.agents.redeem(s.ticket)?.agent).toBe("opencode");
  // A look again while the pop-up runs is still a plain probe: signed out.
  terminal.agents.probe("opencode");
  await terminal.agents.settled();
  expect(byKey(terminal.agents.list(), "opencode")?.reason).toBe("signin");
  // The pop-up's command ended: the terminal says so by ticket, and only this
  // module knows whose it was. The agent is checking at once, then Active.
  const before = terminal.calls.length;
  terminal.heard.length = 0;
  terminal.agents.signedIn(s.ticket);
  expect(terminal.heard[0]?.find((x) => x.key === "opencode")?.reason).toBe("checking");
  await terminal.agents.settled();
  expect(terminal.calls.length).toBe(before + 1);
  expect(terminal.calls.at(-1)?.methods).not.toContain("authenticate");
  a = byKey(terminal.agents.list(), "opencode") as AgentInfo;
  expect(a.state).toBe("active");
  expect(terminal.heard.at(-1)?.find((x) => x.key === "opencode")?.state).toBe("active");
  // Reported twice, or a ticket nobody minted: nothing happens.
  terminal.agents.signedIn(s.ticket);
  terminal.agents.signedIn("AAAAAAAAAAAAAAAAAAAAAAAA");
  terminal.agents.signedIn("../not a ticket");
  await terminal.agents.settled();
  expect(terminal.calls.length).toBe(before + 1);
});

test("a redeemed ticket's end past its bound re-probes nothing", async () => {
  let now = 5_000_000;
  const { connect, calls } = agentsOnFake(() => ({ ...healthy(), initialize: () => ({ protocolVersion: 1, authMethods: [{ id: "t", name: "T", type: "terminal", args: ["login"] }] }) }));
  const agents = makeAgents({
    connect,
    env: async () => ({ ...LOGIN }),
    which: async (c) => (c === "opencode" ? "/invented/bin/opencode" : null),
    fetch: (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch,
    home: freshHome(),
    cwd: "/invented/vault",
    now: () => now,
    processes: { start: () => ({ pid: -1, pgid: -1, born: null, done: Promise.resolve({ exit: null, signal: "ENOENT" }) }), end: async () => {}, killNow() {}, alive: () => false },
    timing: { commands: 10, signInRun: 1000 },
  });
  agents.list();
  await agents.settled();
  agents.refused("opencode");
  const s = await agents.signIn("opencode", "t");
  if (s.kind !== "terminal") throw new Error("expected a terminal sign-in");
  expect(agents.redeem(s.ticket)).not.toBeNull();
  now += 1001;
  const before = calls.length;
  agents.signedIn(s.ticket);
  await agents.settled();
  expect(calls.length).toBe(before);
  expect(agents.list()[0]?.reason).toBe("signin");
});

test("a refusal before any probe listed the ways to sign in looks, and stays refused", async () => {
  const m = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ ...healthy(), initialize: () => ({ protocolVersion: 1, authMethods: [] }) }) });
  m.agents.list();
  await m.agents.settled();
  const probes = m.calls.length;
  m.agents.refused("opencode"); // it listed no methods: look again for them
  await m.agents.settled();
  expect(m.calls.length).toBe(probes + 1);
  expect(byKey(m.agents.list(), "opencode")?.reason).toBe("signin");
});

test("a key that is no agent, or no agent here, is refused in words", async () => {
  const m = machine({ bins: {} });
  m.agents.list();
  await m.agents.settled();
  expect(() => m.agents.probe("../../etc")).toThrow("not an agent's name");
  expect(() => m.agents.probe("not-a-known-agent")).toThrow("No agent by that name");
  await expect(m.agents.signIn("opencode", "x")).rejects.toThrow("No agent by that name");
  expect(await m.agents.launch("../x")).toBeNull();
  m.agents.refused("opencode"); // nothing to mark, and nothing thrown
  expect(m.agents.list()).toEqual([]);
});

test("nothing the client is handed carries the login environment", async () => {
  const g = gated();
  const m = machine({ bins: { gemini: "/invented/bin/gemini", opencode: "/invented/bin/opencode" }, script: (launch) => (launch.command.endsWith("gemini") ? g.script : healthy()) });
  m.agents.list();
  await m.agents.settled();
  const s = await m.agents.signIn("gemini", "tui");
  const handed = JSON.stringify({ list: m.agents.list(), heard: m.heard, s });
  expect(handed).not.toContain(SECRET);
  expect(handed).not.toContain("/home/someone");
});

test("AN AGENT THAT WANTS AUTHENTICATE IN EVERY PROCESS keeps the method that signed it in, and a later look sends it too — without lifting a chat's refusal", async () => {
  // Cursor refuses a session in any process that has not called
  // `authenticate`, even signed in: every process has to, the probe's too.
  let signedOnce = false;
  const perProcess = (): Script => {
    let here = false;
    return {
      initialize: () => ({ protocolVersion: 1, authMethods: [{ id: "cursor_login", name: "Log in" }] }),
      authenticate: () => {
        here = true;
        signedOnce = true;
        return {};
      },
      "session/new": () => {
        if (!here) throw acpError(-32000, "Authentication required");
        return { sessionId: "s-c" };
      },
    };
  };
  const m = machine({ bins: { "cursor-agent": "/invented/bin/cursor-agent" }, script: () => perProcess() });
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "cursor")?.reason).toBe("signin");
  expect(m.agents.signedInWith("cursor")).toBeNull();
  expect(await m.agents.signIn("cursor", "cursor_login")).toEqual({ kind: "agent" });
  await m.agents.settled();
  expect(signedOnce).toBe(true);
  expect(byKey(m.agents.list(), "cursor")?.state).toBe("active");
  expect(m.agents.signedInWith("cursor")).toBe("cursor_login");

  // A look after it is a new process, and it signs in again before its session.
  m.agents.probe("cursor");
  await m.agents.settled();
  expect(m.calls.at(-1)!.methods).toEqual(["initialize", "authenticate", "session/new"]);
  expect(byKey(m.agents.list(), "cursor")?.state).toBe("active");

  // A chat that was refused anyway stays refused through such a look.
  m.agents.refused("cursor");
  await m.agents.settled();
  m.agents.probe("cursor");
  await m.agents.settled();
  expect(byKey(m.agents.list(), "cursor")?.reason).toBe("signin");
});

test("A SIGN-IN IS ANNOUNCED ONCE, and a look another workspace's news asked for lifts the refusal here without announcing anything back", async () => {
  // Two workspaces' agents over one machine: a sign-in in the first is heard,
  // told to the second, and the second's look is not heard again.
  const g = gated();
  const said: { from: string; key: string; method: string | null }[] = [];
  const a = machine({ bins: { gemini: "/invented/bin/gemini" }, script: () => g.script, onSignedIn: (key, method) => void said.push({ from: "a", key, method }) });
  const b = machine({ bins: { gemini: "/invented/bin/gemini" }, script: () => g.script, onSignedIn: (key, method) => void said.push({ from: "b", key, method }) });
  for (const m of [a, b]) {
    m.agents.list();
    await m.agents.settled();
    expect(byKey(m.agents.list(), "gemini")?.reason).toBe("signin");
  }
  expect(await a.agents.signIn("gemini", "browser")).toEqual({ kind: "agent" });
  await a.agents.settled();
  expect(said).toEqual([{ from: "a", key: "gemini", method: null }]);

  // The root's fan-out, by hand: the second workspace hears it.
  b.agents.signedInElsewhere("gemini", null);
  await b.agents.settled();
  expect(byKey(b.agents.list(), "gemini")?.state).toBe("active");
  // And said nothing back: no echo.
  expect(said).toEqual([{ from: "a", key: "gemini", method: null }]);

  // Already Active, the news asks for no look at all.
  const looks = b.calls.length;
  b.agents.signedInElsewhere("gemini", null);
  await b.agents.settled();
  expect(b.calls.length).toBe(looks);
  // An agent this workspace never found is nothing to do.
  b.agents.signedInElsewhere("opencode", null);
  await b.agents.settled();
  expect(byKey(b.agents.list(), "opencode")).toBeUndefined();
});

test("a per-process sign-in told to another workspace carries its method there, so that workspace's chats can authenticate", async () => {
  let authed = new WeakSet<object>();
  const perProcess = (): Script => {
    const me = {};
    return {
      initialize: () => ({ protocolVersion: 1, authMethods: [{ id: "cursor_login", name: "Log in" }] }),
      authenticate: () => {
        authed.add(me);
        return {};
      },
      "session/new": () => {
        if (!authed.has(me)) throw acpError(-32000, "Authentication required");
        return { sessionId: "s-c" };
      },
    };
  };
  const b = machine({ bins: { "cursor-agent": "/invented/bin/cursor-agent" }, script: () => perProcess() });
  b.agents.list();
  await b.agents.settled();
  expect(byKey(b.agents.list(), "cursor")?.reason).toBe("signin");
  b.agents.signedInElsewhere("cursor", "cursor_login");
  await b.agents.settled();
  expect(byKey(b.agents.list(), "cursor")?.state).toBe("active");
  expect(b.agents.signedInWith("cursor")).toBe("cursor_login");
  authed = new WeakSet();
});

test("AN AGENT THAT ARRIVES LATER IS FOUND: a list more than 30 s after the last look looks again, probes only what is new, and never storms", async () => {
  let clock = 1_000_000;
  const bins: Record<string, string> = {};
  const m = machine({ bins, now: () => clock });
  m.agents.list();
  await m.agents.settled();
  expect(m.agents.list()).toEqual([]);

  // Installed on the PATH a moment later: not looked for again yet.
  bins.gemini = "/invented/bin/gemini";
  clock += 5_000;
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "gemini")).toBeUndefined();

  // Past thirty seconds, a list looks again and finds it — and probes it.
  clock += 30_000;
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "gemini")?.state).toBe("active");
  const geminiLooks = () => m.calls.filter((c) => c.launch.command === "/invented/bin/gemini").length;
  expect(geminiLooks()).toBe(1);

  // Another agent arrives; the next look probes it and NOT the one it knew.
  bins.opencode = "/invented/bin/opencode";
  clock += 31_000;
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "opencode")?.state).toBe("active");
  expect(geminiLooks()).toBe(1);

  // A hundred lists in the same half-minute are one look at most.
  bins.kimi = "/invented/bin/kimi";
  clock += 31_000;
  const before = m.calls.length;
  for (let i = 0; i < 100; i++) m.agents.list();
  await m.agents.settled();
  expect(m.calls.length - before).toBe(1);
  expect(byKey(m.agents.list(), "kimi")?.state).toBe("active");
});

test("A FAILED AGENT IS LOOKED AT AGAIN by a list past the half-minute, and turns Active when it opens a session; one waiting for a sign-in is not (O34)", async () => {
  let clock = 2_000_000;
  // Gemini crashes on its first start and is well after; OpenCode opens a
  // session and is then refused by a chat, so it waits for a sign-in.
  let geminiBroken = true;
  const m = machine({
    bins: { gemini: "/invented/bin/gemini", opencode: "/invented/bin/opencode" },
    now: () => clock,
    script: (launch) => (launch.command.endsWith("gemini") && geminiBroken
      ? { ...healthy(), "session/new": () => { throw acpError(-32603, "invented crash"); } }
      : healthy()),
  });
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "gemini")?.reason).toBe("failed");
  m.agents.refused("opencode");
  expect(byKey(m.agents.list(), "opencode")?.reason).toBe("signin");
  const looks = (bin: string) => m.calls.filter((c) => c.launch.command === `/invented/bin/${bin}`).length;
  const gemini0 = looks("gemini");
  const opencode0 = looks("opencode");

  // Mended — and within the half-minute nothing is looked at again.
  geminiBroken = false;
  clock += 5_000;
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "gemini")?.reason).toBe("failed");
  expect(looks("gemini")).toBe(gemini0);

  // Past it, the failed one is probed again and turns Active; the one
  // waiting for a sign-in is left alone.
  clock += 31_000;
  m.agents.list();
  await m.agents.settled();
  expect(byKey(m.agents.list(), "gemini")?.state).toBe("active");
  expect(looks("gemini")).toBe(gemini0 + 1);
  expect(byKey(m.agents.list(), "opencode")?.reason).toBe("signin");
  expect(looks("opencode")).toBe(opencode0);

  // Active now: not looked at again on the next half-minute.
  clock += 31_000;
  m.agents.list();
  await m.agents.settled();
  expect(looks("gemini")).toBe(gemini0 + 1);
});

test("LOOK AGAIN LIFTS A SIGN-IN REFUSAL ONLY FOR AN AGENT THAT OFFERS NO WAY TO SIGN IN: signed in from its own command, it is Active again; one with a way stays at Sign in (O35)", async () => {
  // Lists no sign-in method at all: Biom cannot sign it in, so the person
  // does it in a terminal of their own and presses Check again.
  const bare = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ ...healthy(), initialize: () => ({ protocolVersion: 1, authMethods: [] }) }) });
  bare.agents.list();
  await bare.agents.settled();
  bare.agents.refused("opencode");
  await bare.agents.settled();
  // The look refused() asks for, for its ways to sign in, lifts nothing.
  expect(byKey(bare.agents.list(), "opencode")?.reason).toBe("signin");
  expect(byKey(bare.agents.list(), "opencode")?.auth).toEqual([]);
  expect(bare.agents.probe("opencode").reason).toBe("checking");
  await bare.agents.settled();
  expect(byKey(bare.agents.list(), "opencode")?.state).toBe("active");
  expect(bare.calls.at(-1)?.methods).not.toContain("authenticate");

  // Still refusing when looked at again: back to Sign in, and sticky again.
  const still = machine({ bins: { opencode: "/invented/bin/opencode" }, script: () => ({ ...healthy(), initialize: () => ({ protocolVersion: 1, authMethods: [] }), "session/new": () => { throw acpError(-32000, "Authentication required"); } }) });
  still.agents.list();
  await still.agents.settled();
  still.agents.probe("opencode");
  await still.agents.settled();
  expect(byKey(still.agents.list(), "opencode")?.reason).toBe("signin");

  // Offers a way to sign in — and opens a session while signed out, which is
  // why the refusal is sticky: a look again does not lift it.
  const withWay = machine({ bins: { opencode: "/invented/bin/opencode" } });
  withWay.agents.list();
  await withWay.agents.settled();
  withWay.agents.refused("opencode");
  expect(byKey(withWay.agents.list(), "opencode")?.auth.length).toBeGreaterThan(0);
  withWay.agents.probe("opencode");
  await withWay.agents.settled();
  expect(byKey(withWay.agents.list(), "opencode")?.reason).toBe("signin");
});

/** A login environment kept as the server keeps it: read once, and read
 *  again only after it is dropped. `vars` is what the person's shell would
 *  print now. Invented. */
function keptLogin() {
  const vars: Record<string, string> = { ...LOGIN };
  let kept: Promise<Record<string, string>> | null = null;
  let reads = 0;
  return {
    vars,
    reads: () => reads,
    read: (): Promise<Record<string, string>> => {
      if (kept === null) {
        reads++;
        kept = Promise.resolve({ ...vars });
      }
      return kept;
    },
    forget: (): void => {
      kept = null;
    },
  };
}

/** Opens a session only where its launch carries `INVENTED_AGENT_KEY`, and
 *  lists these ways to sign in. */
const keyed = (authMethods: unknown[]) => (launch: AgentLaunch): Script => ({
  ...healthy(),
  initialize: () => ({ protocolVersion: 1, agentInfo: { name: "invented", version: "1.0.0" }, authMethods }),
  "session/new": (p, agent) => {
    if (launch.env.INVENTED_AGENT_KEY === undefined) throw acpError(-32000, "Authentication required");
    return (healthy()["session/new"] as Handler)(p, agent);
  },
});

const envVarOnly = [{ id: "key", name: "An invented key", type: "env_var", vars: [{ name: "INVENTED_AGENT_KEY" }] }];

test("CHECK AGAIN ON AN AGENT SIGNED IN BY A VARIABLE reads the login shell again — once — lifts the refusal, and finds it Active once the person set the variable (O37)", async () => {
  const login = keptLogin();
  const m = machine({ bins: { opencode: "/invented/bin/opencode" }, script: keyed(envVarOnly), readEnv: login.read, forgetEnv: login.forget });
  m.agents.list();
  await m.agents.settled();
  const a = byKey(m.agents.list(), "opencode") as AgentInfo;
  expect(a.reason).toBe("signin");
  expect(a.auth.map((x) => x.type)).toEqual(["env_var"]);
  // Looking needs no second reading: it is kept.
  const before = login.reads();
  expect(before).toBe(1);

  // Pressed before the variable is set: read again, and still refused.
  m.agents.probe("opencode");
  await m.agents.settled();
  expect(login.reads()).toBe(before + 1);
  expect(byKey(m.agents.list(), "opencode")?.reason).toBe("signin");

  // The person sets it in their login shell and presses Check again.
  login.vars.INVENTED_AGENT_KEY = "invented-value";
  expect(m.agents.probe("opencode").reason).toBe("checking");
  await m.agents.settled();
  expect(login.reads()).toBe(before + 2);
  expect(byKey(m.agents.list(), "opencode")?.state).toBe("active");
  expect(m.calls.at(-1)?.launch.env.INVENTED_AGENT_KEY).toBe("invented-value");
  expect(m.calls.at(-1)?.methods).not.toContain("authenticate");
  // Nothing reads it again unasked: a launch uses the reading kept.
  await m.agents.launch("opencode");
  expect(login.reads()).toBe(before + 2);
});

test("an agent with a way to sign in besides a variable — agent or terminal — keeps its refusal on Check again, and nothing re-reads the login shell for it (O37)", async () => {
  for (const other of [{ id: "browser", name: "In a browser" }, { id: "tui", name: "In a terminal", type: "terminal", args: ["login"] }]) {
    const login = keptLogin();
    // It opens a session with the variable set, as one signed out may.
    login.vars.INVENTED_AGENT_KEY = "invented-value";
    const m = machine({ bins: { opencode: "/invented/bin/opencode" }, script: keyed([...envVarOnly, other]), readEnv: login.read, forgetEnv: login.forget });
    m.agents.list();
    await m.agents.settled();
    expect(byKey(m.agents.list(), "opencode")?.state).toBe("active");
    m.agents.refused("opencode");
    const before = login.reads();
    m.agents.probe("opencode");
    await m.agents.settled();
    expect(byKey(m.agents.list(), "opencode")?.reason).toBe("signin");
    expect(login.reads()).toBe(before);
  }
});
