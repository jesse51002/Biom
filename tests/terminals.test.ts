// SPDX-License-Identifier: AGPL-3.0-only
// The sign-in terminal: one command, from a ticket, for as long as one socket.
//
// What is held here is the security requirement and the lifetime, first
// against a spawner that starts nothing and a sign-in state that is a table,
// then against a real PTY:
//
//   · the command that runs is the one the ticket stands for, in the vault's
//     root, at the size asked — and never anything the socket names;
//   · a ticket is spent once: a replay, a made-up ticket and one the minter
//     refuses all start nothing, and say one sentence whichever it was;
//   · the command exiting says how and closes the socket; the socket closing
//     first ends the command's whole tree, and no process survives either;
//   · a socket that never names a ticket is not kept open for one.
//
// Every ticket, path and command here is invented for the test.

import { test, expect } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeTerminals } from "../server/workspace/terminals.ts";
import type { Client, Tickets } from "../server/workspace/terminals.ts";
import { spawnPty } from "../server/platform/pty.ts";
import type { Pty, PtyExit, PtyOptions } from "../server/platform/pty.ts";
import type { AgentLaunch } from "../contracts/types.ts";

const unix = process.platform !== "win32";
const VAULT = "/vaults/one";
const LAUNCH: AgentLaunch = { command: "/opt/agent/bin/agent", args: ["auth", "login"], env: { PATH: "/opt/agent/bin", HOME: "/home/someone" } };

interface Fake {
  opts: PtyOptions;
  pty: Pty;
  written: string[];
  resized: [number, number][];
  ended: number;
  killed: number;
  exit(e: PtyExit): void;
  endWorks: boolean;
}

function spawner() {
  const made: Fake[] = [];
  let failWith: string | null = null;
  /** Hold the next spawn until `release` is called, to close a socket mid-start. */
  let hold: Promise<void> | null = null;
  return {
    made,
    failNext(message: string) {
      failWith = message;
    },
    holdNext() {
      let release!: () => void;
      hold = new Promise<void>((r) => (release = r));
      return release;
    },
    async spawn(opts: PtyOptions): Promise<Pty> {
      if (hold !== null) {
        const h = hold;
        hold = null;
        await h;
      }
      if (failWith !== null) {
        const m = failWith;
        failWith = null;
        throw new Error(m);
      }
      let resolve!: (e: PtyExit) => void;
      const exited = new Promise<PtyExit>((r) => (resolve = r));
      const fake: Fake = {
        opts,
        written: [],
        resized: [],
        ended: 0,
        killed: 0,
        exit: (e) => resolve(e),
        endWorks: true,
        pty: undefined as unknown as Pty,
      };
      fake.pty = {
        pid: 1000 + made.length,
        command: opts.command[0] ?? "",
        cwd: opts.cwd,
        write: (d) => void fake.written.push(d),
        resize: (c, r) => void fake.resized.push([c, r]),
        exited,
        end: async () => {
          fake.ended++;
          if (!fake.endWorks) return false;
          resolve({ code: null, signal: "SIGHUP" });
          await exited;
          return true;
        },
        kill: () => {
          fake.killed++;
          resolve({ code: null, signal: "SIGKILL" });
        },
      };
      made.push(fake);
      return fake.pty;
    },
  };
}

/** A sign-in state that is a table: each ticket once, unless `reusable`. */
function signIns(table: Record<string, AgentLaunch>, opts: { reusable?: boolean } = {}) {
  const asked: string[] = [];
  const ended: string[] = [];
  const t: Tickets = {
    redeem(ticket) {
      asked.push(ticket);
      const launch = table[ticket] ?? null;
      if (!opts.reusable) delete table[ticket];
      return launch;
    },
    ended: (ticket) => void ended.push(ticket),
  };
  return { t, asked, ended };
}

function client(buffered = () => 0) {
  const events: any[] = [];
  const bytes: Uint8Array[] = [];
  let closed = 0;
  const c: Client = {
    send: (text) => void events.push(JSON.parse(text)),
    sendBinary: (b) => void bytes.push(b),
    buffered,
    close: () => void closed++,
  };
  return { c, events, bytes, closed: () => closed, last: (ev: string) => events.filter((e) => e.ev === ev).at(-1) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const create = (ticket: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ op: "create", ticket, cols: 100, rows: 30, ...extra });

function setup(limits: Record<string, number> = {}) {
  const sp = spawner();
  const terms = makeTerminals({ spawn: sp.spawn, limits: { settle: 0, ...limits } });
  return { sp, terms };
}

/* ── which command runs ──────────────────────────────────────────────────── */

test("the ticket's own command runs, in the vault's root, at the size asked, with its environment", async () => {
  const { sp, terms } = setup();
  const s = signIns({ "ticket-one": LAUNCH });
  const a = client();
  terms.attach(VAULT, s.t, a.c).receive(create("ticket-one"));
  await tick();
  expect(sp.made).toHaveLength(1);
  expect(sp.made[0]?.opts).toMatchObject({ command: ["/opt/agent/bin/agent", "auth", "login"], cwd: VAULT, cols: 100, rows: 30, env: LAUNCH.env });
  expect(a.last("started")).toEqual({ ev: "started" });
  expect(terms.live()).toBe(1);
});

test("A CLIENT NEVER NAMES A COMMAND: a command, arguments or environment in the message are never read", async () => {
  const { sp, terms } = setup();
  const s = signIns({ "ticket-one": LAUNCH });
  const named = { command: "/bin/sh", args: ["-c", "echo pwned"], env: { EVIL: "1" }, cwd: "/" };

  // With no ticket at all, or one nobody minted: nothing starts.
  for (const ticket of [undefined, "", 42, { command: "/bin/sh" }, "made-up", "x".repeat(300)]) {
    const a = client();
    terms.attach(VAULT, s.t, a.c).receive(create(ticket, named));
    await tick();
    expect([ticket, sp.made.length]).toEqual([ticket, 0]);
    expect(a.last("error")?.message).toContain("already used or has expired");
    expect(a.closed()).toBe(1);
  }

  // With a real ticket: the ticket's command, and not one word of the message's.
  const b = client();
  terms.attach(VAULT, s.t, b.c).receive(create("ticket-one", named));
  await tick();
  expect(sp.made).toHaveLength(1);
  expect(sp.made[0]?.opts.command).toEqual([LAUNCH.command, ...LAUNCH.args]);
  expect(sp.made[0]?.opts.env).toEqual(LAUNCH.env);
  expect(sp.made[0]?.opts.cwd).toBe(VAULT);
  // No other op starts anything either.
  const c = client();
  const at = terms.attach(VAULT, s.t, c.c);
  for (const op of ["spawn", "run", "exec", "start", "hello"]) at.receive(JSON.stringify({ op, ...named }));
  await tick();
  expect(sp.made).toHaveLength(1);
  expect(c.last("error")?.message).toContain("not one a terminal understands");
  at.detach();
});

test("A TICKET IS SPENT ONCE: a replay is refused even when the minter would answer it again", async () => {
  const { sp, terms } = setup();
  // A minter that forgot to make its tickets single-use.
  const s = signIns({ "ticket-one": LAUNCH }, { reusable: true });
  const first = client();
  terms.attach(VAULT, s.t, first.c).receive(create("ticket-one"));
  await tick();
  const again = client();
  terms.attach(VAULT, s.t, again.c).receive(create("ticket-one"));
  await tick();
  expect(sp.made).toHaveLength(1);
  // Refused here, without asking the minter a second time.
  expect(s.asked).toEqual(["ticket-one"]);
  expect(again.last("error")?.message).toContain("already used or has expired");
  expect(again.closed()).toBe(1);
  // A second create on the SAME socket starts nothing either.
  const same = client();
  const at = terms.attach(VAULT, signIns({ "ticket-two": LAUNCH, "ticket-three": LAUNCH }).t, same.c);
  at.receive(create("ticket-two"));
  await tick();
  at.receive(create("ticket-three"));
  await tick();
  expect(sp.made).toHaveLength(2);
  expect(same.last("error")?.message).toContain("already started");
});

test("a ticket the minter refuses starts nothing and is told the same sentence, and nothing is looked at again", async () => {
  const { sp, terms } = setup();
  const s = signIns({});
  const a = client();
  terms.attach(VAULT, s.t, a.c).receive(create("expired-ticket"));
  await tick();
  expect(sp.made).toHaveLength(0);
  expect(a.last("error")?.message).toBe("that sign-in was already used or has expired — ask to sign in again");
  expect(a.closed()).toBe(1);
  expect(s.ended).toEqual([]);
});

test("a minter that throws is a refusal, and a re-probe that throws does not escape", async () => {
  const { sp, terms } = setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const a = client();
    const throwing: Tickets = { redeem: () => { throw new Error("boom"); }, ended: () => {} };
    terms.attach(VAULT, throwing, a.c).receive(create("ticket-one"));
    await tick();
    expect(sp.made).toHaveLength(0);
    expect(a.closed()).toBe(1);

    const b = client();
    const loud: Tickets = { redeem: () => LAUNCH, ended: () => { throw new Error("probe failed"); } };
    terms.attach(VAULT, loud, b.c).receive(create("ticket-two"));
    await tick();
    sp.made[0]?.exit({ code: 0, signal: null });
    await Bun.sleep(5);
    expect(b.last("exited")).toEqual({ ev: "exited", exit: { code: 0, signal: null } });
  } finally {
    console.warn = warn;
  }
});

/* ── while it runs ───────────────────────────────────────────────────────── */

test("output reaches the socket as raw bytes; input and resize reach the command; an oversized paste is refused whole", async () => {
  const { sp, terms } = setup({ input: 10 });
  const s = signIns({ "ticket-one": LAUNCH });
  const a = client();
  const at = terms.attach(VAULT, s.t, a.c);
  // Nothing typed before the command runs goes anywhere.
  at.receive(JSON.stringify({ op: "input", data: "early" }));
  at.receive(create("ticket-one"));
  await tick();
  const fake = sp.made[0] as Fake;
  fake.opts.onData(new TextEncoder().encode("Paste code here > "));
  expect(new TextDecoder().decode(a.bytes[0])).toBe("Paste code here > ");
  at.receive(JSON.stringify({ op: "input", data: "code-123\r" }));
  at.receive(JSON.stringify({ op: "input", data: "x".repeat(11) }));
  at.receive(JSON.stringify({ op: "input", data: 7 }));
  at.receive(JSON.stringify({ op: "resize", cols: 120, rows: 40 }));
  at.receive(JSON.stringify({ op: "resize", cols: 0, rows: 40 }));
  at.receive(JSON.stringify({ op: "resize", cols: 1001, rows: 40 }));
  expect(fake.written).toEqual(["code-123\r"]);
  expect(a.last("error")?.message).toContain("larger than a terminal accepts");
  expect(fake.resized).toEqual([[120, 40]]);
  // A message that is not JSON, or not an object, is answered and changes nothing.
  at.receive("not json");
  at.receive("[1,2]");
  expect(a.last("error")?.message).toContain("not one a terminal understands");
  expect(a.closed()).toBe(0);
});

test("a window that cannot keep up is sent no more output than the bound, and told once", async () => {
  let queued = 0;
  const { sp, terms } = setup({ lag: 100 });
  const s = signIns({ "ticket-one": LAUNCH });
  const a = client(() => queued);
  terms.attach(VAULT, s.t, a.c).receive(create("ticket-one"));
  await tick();
  const fake = sp.made[0] as Fake;
  queued = 101;
  fake.opts.onData(new Uint8Array(10));
  fake.opts.onData(new Uint8Array(10));
  expect(a.bytes).toHaveLength(0);
  expect(a.events.filter((e) => e.ev === "error")).toHaveLength(1);
  queued = 0;
  fake.opts.onData(new Uint8Array(10));
  expect(a.bytes).toHaveLength(1);
});

test("a spawn failure is the spawner's own sentence; the socket closes and the agent is looked at again", async () => {
  const { sp, terms } = setup();
  const s = signIns({ "ticket-one": LAUNCH });
  const a = client();
  sp.failNext("/opt/agent/bin/agent is not a program on this machine, so it was not started");
  terms.attach(VAULT, s.t, a.c).receive(create("ticket-one"));
  await tick();
  expect(a.last("error")?.message).toContain("is not a program on this machine");
  expect(a.closed()).toBe(1);
  expect(s.ended).toEqual(["ticket-one"]);
  expect(terms.live()).toBe(0);
});

/* ── how it ends ─────────────────────────────────────────────────────────── */

test("THE COMMAND EXITING says how, closes the socket, and has its agent looked at again", async () => {
  const { sp, terms } = setup();
  const s = signIns({ "ticket-one": LAUNCH });
  const a = client();
  terms.attach(VAULT, s.t, a.c).receive(create("ticket-one"));
  await tick();
  sp.made[0]?.exit({ code: 0, signal: null });
  await Bun.sleep(5);
  expect(a.last("exited")).toEqual({ ev: "exited", exit: { code: 0, signal: null } });
  expect(a.closed()).toBe(1);
  expect(s.ended).toEqual(["ticket-one"]);
  expect(terms.live()).toBe(0);
  // Nothing ended the tree: a command that left by itself is not chased.
  expect(sp.made[0]?.ended).toBe(0);
});

test("THE SOCKET CLOSING FIRST ends the command's tree; an end that does not take is followed by the kill", async () => {
  const { sp, terms } = setup();
  const s = signIns({ "ticket-one": LAUNCH, "ticket-two": LAUNCH });
  const a = client();
  const at = terms.attach(VAULT, s.t, a.c);
  at.receive(create("ticket-one"));
  await tick();
  at.detach();
  at.detach();
  await Bun.sleep(5);
  expect(sp.made[0]?.ended).toBe(1);
  expect(terms.live()).toBe(0);
  expect(s.ended).toEqual(["ticket-one"]);
  // Nothing is said to a socket that has gone.
  expect(a.last("exited")).toBeUndefined();

  const warn = console.warn;
  console.warn = () => {};
  try {
    const b = client();
    const bt = terms.attach(VAULT, s.t, b.c);
    bt.receive(create("ticket-two"));
    await tick();
    (sp.made[1] as Fake).endWorks = false;
    bt.detach();
    await Bun.sleep(5);
    expect(sp.made[1]?.ended).toBe(1);
    expect(sp.made[1]?.killed).toBe(1);
    expect(terms.live()).toBe(0);
  } finally {
    console.warn = warn;
  }
});

test("a socket that closes while its command is starting ends the command once it has started", async () => {
  const { sp, terms } = setup();
  const s = signIns({ "ticket-one": LAUNCH });
  const a = client();
  const at = terms.attach(VAULT, s.t, a.c);
  const release = sp.holdNext();
  at.receive(create("ticket-one"));
  await tick();
  at.detach();
  release();
  await Bun.sleep(5);
  expect(sp.made).toHaveLength(1);
  expect(sp.made[0]?.ended).toBe(1);
  expect(terms.live()).toBe(0);
  expect(a.last("started")).toBeUndefined();
});

test("a socket that names no ticket is closed after the wait, and one that does is not", async () => {
  const { terms } = setup({ wait: 20 });
  const idle = client();
  terms.attach(VAULT, signIns({}).t, idle.c);
  const busy = client();
  terms.attach(VAULT, signIns({ "ticket-one": LAUNCH }).t, busy.c).receive(create("ticket-one"));
  await Bun.sleep(60);
  expect(idle.closed()).toBe(1);
  expect(busy.closed()).toBe(0);
});

test("killAll takes every running command, synchronously", async () => {
  const { sp, terms } = setup();
  const s = signIns({ "ticket-one": LAUNCH, "ticket-two": LAUNCH });
  terms.attach(VAULT, s.t, client().c).receive(create("ticket-one"));
  terms.attach(VAULT, s.t, client().c).receive(create("ticket-two"));
  await tick();
  expect(terms.live()).toBe(2);
  terms.killAll();
  expect(sp.made.map((f) => f.killed)).toEqual([1, 1]);
});

/* ── a real command in a real PTY ────────────────────────────────────────── */

/** A real terminal over `spawnPty`, and a client that collects what it says. */
function real(dir: string, launch: AgentLaunch) {
  const terms = makeTerminals({ spawn: spawnPty });
  const ended: string[] = [];
  const s: Tickets = { redeem: (t) => (t === "real-ticket" ? launch : null), ended: (t) => void ended.push(t) };
  const events: any[] = [];
  let out = "";
  let closed = false;
  let at: ReturnType<typeof terms.attach> | null = null;
  const c: Client = {
    send: (text) => void events.push(JSON.parse(text)),
    sendBinary: (b) => void (out += new TextDecoder().decode(b)),
    buffered: () => 0,
    // As `main.ts` wires it: a socket that closes is detached.
    close: () => {
      closed = true;
      at?.detach();
    },
  };
  at = terms.attach(dir, s, c);
  return { terms, at, events, ended, said: () => out, closed: () => closed };
}

async function until(what: string, ok: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`never: ${what}`);
    await Bun.sleep(25);
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir() };

test.if(unix)("a real sign-in: the command runs in the vault's folder, reads what is typed, and its exit closes the socket", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "biom-signin-")));
  try {
    const script = 'pwd; stty size; printf "Paste code here > "; read code; echo "got-$code"; exit 3';
    const r = real(dir, { command: "sh", args: ["-c", script], env: ENV });
    r.at!.receive(JSON.stringify({ op: "create", ticket: "real-ticket", cols: 91, rows: 27 }));
    await until("the prompt", () => r.said().includes("Paste code here"));
    expect(r.events[0]).toEqual({ ev: "started" });
    expect(r.said()).toContain(dir);
    expect(r.said()).toContain("27 91");
    r.at!.receive(JSON.stringify({ op: "input", data: "abc-42\r" }));
    await until("the exit", () => r.closed());
    expect(r.said()).toContain("got-abc-42");
    expect(r.events.at(-1)).toEqual({ ev: "exited", exit: { code: 3, signal: null } });
    expect(r.ended).toEqual(["real-ticket"]);
    expect(r.terms.live()).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.if(unix)("NO PROCESS SURVIVES: closing the socket takes the command and a job it put in a group of its own", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "biom-signin-")));
  try {
    // `set -m` gives the background job a process group of its own, which is
    // what a group kill alone misses. The marker tells this run's pids apart.
    const marker = `biom-${process.pid}-${Date.now()}`;
    const script = `set -m; sleep 300 & echo ${marker}-$$-$!; sleep 300`;
    const r = real(dir, { command: "sh", args: ["-c", script], env: ENV });
    r.at!.receive(JSON.stringify({ op: "create", ticket: "real-ticket", cols: 80, rows: 24 }));
    await until("the job started", () => new RegExp(`${marker}-\\d+-\\d+`).test(r.said()));
    const [, shell, job] = (new RegExp(`${marker}-(\\d+)-(\\d+)`).exec(r.said()) ?? []).map(Number);
    expect(alive(shell as number)).toBe(true);
    expect(alive(job as number)).toBe(true);

    // The pop-up closed, or the window went: the socket detaches.
    r.at!.detach();
    await until("the command went", () => !alive(shell as number), 6000);
    await until("its job went with it", () => !alive(job as number), 6000);
    await until("the run is over", () => r.terms.live() === 0, 2000);
    await until("its agent is looked at again", () => r.ended.length > 0, 2000);
    expect(r.ended).toEqual(["real-ticket"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.if(unix)("a replayed ticket against a real PTY starts nothing", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "biom-signin-")));
  try {
    const terms = makeTerminals({ spawn: spawnPty });
    const launch: AgentLaunch = { command: "sh", args: ["-c", "sleep 300"], env: ENV };
    const s: Tickets = { redeem: () => launch, ended: () => {} };
    const first = client();
    const a = terms.attach(dir, s, first.c);
    a.receive(create("real-ticket"));
    await until("the first started", () => first.last("started") !== undefined);
    const second = client();
    terms.attach(dir, s, second.c).receive(create("real-ticket"));
    await tick();
    expect(second.last("error")?.message).toContain("already used or has expired");
    expect(terms.live()).toBe(1);
    a.detach();
    await until("the first went", () => terms.live() === 0, 6000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
