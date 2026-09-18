// SPDX-License-Identifier: AGPL-3.0-only
// The session registry, against a spawner that starts nothing.
//
// Every rule in `server/workspace/terminals.ts` that is about ownership rather
// than about a process is held here: a retried create is not a second terminal,
// the limit counts creates still in flight, output is bounded and says when it
// is not whole, a client that cannot keep up gets a resync instead of a growing
// buffer, an end that did not take stays visible, and a workspace nobody is
// connected to does not keep a hidden shell running forever.

import { test, expect } from "bun:test";

import { FRAME_OUTPUT, FRAME_REPLAY, frame, makeTerminals } from "../server/workspace/terminals.ts";
import type { Client } from "../server/workspace/terminals.ts";
import type { Pty, PtyExit, PtyOptions } from "../server/platform/pty.ts";

interface Fake {
  opts: PtyOptions;
  pty: Pty;
  written: string[];
  resized: [number, number][];
  exit(e: PtyExit): void;
  endWorks: boolean;
}

function spawner() {
  const made: Fake[] = [];
  let failWith: string | null = null;
  return {
    made,
    failNext(message: string) {
      failWith = message;
    },
    async spawn(opts: PtyOptions): Promise<Pty> {
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
        exit: (e) => resolve(e),
        endWorks: true,
        pty: undefined as unknown as Pty,
      };
      fake.pty = {
        pid: 1000 + made.length,
        shell: "/bin/fake",
        cwd: opts.cwd,
        write: (d) => void fake.written.push(d),
        resize: (c, r) => void fake.resized.push([c, r]),
        exited,
        end: async () => {
          if (!fake.endWorks) return false;
          resolve({ code: null, signal: "SIGHUP" });
          await exited;
          return true;
        },
        kill: () => resolve({ code: null, signal: "SIGKILL" }),
      };
      made.push(fake);
      return fake.pty;
    },
  };
}

function client(buffered = () => 0) {
  const events: any[] = [];
  const frames: Uint8Array[] = [];
  const c: Client = {
    send: (t) => void events.push(JSON.parse(t)),
    sendBinary: (b) => void frames.push(b),
    buffered,
  };
  return { c, events, frames, last: (ev: string) => events.filter((e) => e.ev === ev).at(-1) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const VAULT = "/vaults/one";

function setup(limits: Record<string, number> = {}) {
  const sp = spawner();
  let n = 0;
  const terms = makeTerminals({ spawn: sp.spawn, env: {}, limits, newId: () => `s${++n}` });
  return { sp, terms };
}

test("a create starts a shell in the workspace root and tells every client", async () => {
  const { sp, terms } = setup();
  const a = client();
  const b = client();
  const at = terms.attach(VAULT, a.c);
  terms.attach(VAULT, b.c);
  at.receive(JSON.stringify({ op: "create", nonce: "n1", cols: 100, rows: 30 }));
  await tick();
  expect(sp.made).toHaveLength(1);
  expect(sp.made[0]?.opts).toMatchObject({ cwd: VAULT, cols: 100, rows: 30 });
  expect(a.last("created")).toMatchObject({ nonce: "n1", session: { id: "s1", label: "Terminal 1", state: "running", cwd: VAULT } });
  expect(b.last("created")?.session.id).toBe("s1");
});

test("A RETRIED CREATE IS NOT A SECOND TERMINAL", async () => {
  const { sp, terms } = setup();
  const a = client();
  const at = terms.attach(VAULT, a.c);
  at.receive(JSON.stringify({ op: "create", nonce: "same" }));
  await tick();
  // The answer was lost; the socket reopened; the same nonce goes again.
  const again = client();
  terms.attach(VAULT, again.c).receive(JSON.stringify({ op: "create", nonce: "same" }));
  await tick();
  expect(sp.made).toHaveLength(1);
  expect(again.last("created")?.session.id).toBe("s1");
});

test("the limit counts creates in flight, and a refusal says why", async () => {
  const { sp, terms } = setup({ sessions: 2 });
  const a = client();
  const at = terms.attach(VAULT, a.c);
  for (const n of ["a", "b", "c"]) at.receive(JSON.stringify({ op: "create", nonce: n }));
  await tick();
  expect(sp.made).toHaveLength(2);
  expect(a.last("failed")).toMatchObject({ nonce: "c" });
  expect(a.last("failed").message).toContain("at most 2");
});

test("a spawn failure is the spawner's own sentence, to the one who asked", async () => {
  const { sp, terms } = setup();
  const a = client();
  const other = client();
  terms.attach(VAULT, other.c);
  sp.failNext("the workspace folder /vaults/one is not there, so no terminal was started");
  terms.attach(VAULT, a.c).receive(JSON.stringify({ op: "create", nonce: "x" }));
  await tick();
  expect(a.last("failed")?.message).toContain("/vaults/one is not there");
  expect(other.last("failed")).toBeUndefined();
});

test("input, resize and label reach the session; an oversized paste is refused whole", async () => {
  const { sp, terms } = setup({ input: 10 });
  const a = client();
  const at = terms.attach(VAULT, a.c);
  at.receive(JSON.stringify({ op: "create", nonce: "n", cols: 80, rows: 24 }));
  await tick();
  at.receive(JSON.stringify({ op: "input", id: "s1", data: "ls\r" }));
  at.receive(JSON.stringify({ op: "input", id: "s1", data: "x".repeat(11) }));
  at.receive(JSON.stringify({ op: "resize", id: "s1", cols: 80, rows: 24 }));
  at.receive(JSON.stringify({ op: "resize", id: "s1", cols: 120, rows: 40 }));
  at.receive(JSON.stringify({ op: "resize", id: "s1", cols: 0, rows: 40 }));
  at.receive(JSON.stringify({ op: "label", id: "s1", label: "  agent\n one " }));
  expect(sp.made[0]?.written).toEqual(["ls\r"]);
  expect(a.last("error")?.message).toContain("larger than a terminal accepts");
  // The unchanged size and the invalid one never reach the PTY.
  expect(sp.made[0]?.resized).toEqual([[120, 40]]);
  expect(a.last("state")?.session.label).toBe("agent one");
  at.receive("not json");
  expect(a.last("error")?.message).toContain("not one a terminal understands");
});

test("output is framed with its id; a new client is replayed the whole ring", async () => {
  const { sp, terms } = setup();
  const a = client();
  const at = terms.attach(VAULT, a.c);
  at.receive(JSON.stringify({ op: "create", nonce: "n" }));
  await tick();
  sp.made[0]?.opts.onData(new TextEncoder().encode("hello "));
  sp.made[0]?.opts.onData(new TextEncoder().encode("world"));
  expect(a.frames[0]?.[0]).toBe(FRAME_OUTPUT);
  expect(a.frames[0]).toEqual(frame(FRAME_OUTPUT, "s1", new TextEncoder().encode("hello ")));

  const late = client();
  terms.attach(VAULT, late.c).receive(JSON.stringify({ op: "hello" }));
  expect(late.last("sessions")?.sessions.map((s: any) => s.id)).toEqual(["s1"]);
  expect(late.frames).toEqual([frame(FRAME_REPLAY, "s1", new TextEncoder().encode("hello world"))]);
});

test("THE RING IS BOUNDED, and a session that dropped output says so and is asked to redraw", async () => {
  const { sp, terms } = setup({ buffer: 10 });
  const a = client();
  const at = terms.attach(VAULT, a.c);
  at.receive(JSON.stringify({ op: "create", nonce: "n", cols: 80, rows: 24 }));
  await tick();
  const enc = new TextEncoder();
  for (const chunk of ["aaaa", "bbbb", "cccc", "dddd"]) sp.made[0]?.opts.onData(enc.encode(chunk));
  expect(terms.sessions(VAULT)[0]?.truncated).toBe(true);
  expect(a.last("state")?.session.truncated).toBe(true);

  const late = client();
  terms.attach(VAULT, late.c).receive(JSON.stringify({ op: "hello" }));
  const replayed = new TextDecoder().decode(late.frames[0]?.subarray(2 + 2));
  expect(replayed.length).toBeLessThanOrEqual(10);
  expect(replayed.endsWith("dddd")).toBe(true);
  // The nudge: one row shorter, then back.
  expect(sp.made[0]?.resized[0]).toEqual([80, 23]);
});

test("A CLIENT THAT CANNOT KEEP UP IS NOT SENT MORE, and gets a resync when it drains", async () => {
  const { sp, terms } = setup({ lag: 100 });
  let queued = 0;
  const slow = client(() => queued);
  const at = terms.attach(VAULT, slow.c);
  at.receive(JSON.stringify({ op: "create", nonce: "n" }));
  await tick();
  const emit = (s: string) => sp.made[0]?.opts.onData(new TextEncoder().encode(s));
  emit("one");
  queued = 500;
  emit("two");
  emit("three");
  expect(slow.frames).toHaveLength(1);
  queued = 0;
  at.drained();
  expect(slow.last("resync")).toMatchObject({ id: "s1", truncated: false });
  expect(new TextDecoder().decode(slow.frames.at(-1)?.subarray(4))).toBe("onetwothree");
});

test("end reports ending, then the exit; an end that did not take stays visible and cannot be dismissed", async () => {
  const { sp, terms } = setup();
  const a = client();
  const at = terms.attach(VAULT, a.c);
  at.receive(JSON.stringify({ op: "create", nonce: "n1" }));
  at.receive(JSON.stringify({ op: "create", nonce: "n2" }));
  await tick();

  at.receive(JSON.stringify({ op: "end", id: "s1" }));
  expect(a.events.some((e) => e.ev === "state" && e.session.id === "s1" && e.session.state === "ending")).toBe(true);
  await tick();
  await tick();
  expect(terms.sessions(VAULT).find((s) => s.id === "s1")).toMatchObject({ state: "exited", exit: { signal: "SIGHUP" } });
  // Its neighbour is untouched.
  expect(terms.sessions(VAULT).find((s) => s.id === "s2")?.state).toBe("running");

  sp.made[1]!.endWorks = false;
  at.receive(JSON.stringify({ op: "end", id: "s2" }));
  await tick();
  await tick();
  const failed = terms.sessions(VAULT).find((s) => s.id === "s2");
  expect(failed).toMatchObject({ state: "failed" });
  expect(failed?.message).toContain("did not stop");
  at.receive(JSON.stringify({ op: "dismiss", id: "s2" }));
  expect(terms.sessions(VAULT).some((s) => s.id === "s2")).toBe(true);

  at.receive(JSON.stringify({ op: "dismiss", id: "s1" }));
  expect(a.last("removed")).toEqual({ ev: "removed", id: "s1" });
});

test("a shell that exits by itself shows its real status and is not respawned", async () => {
  const { sp, terms } = setup();
  const a = client();
  terms.attach(VAULT, a.c).receive(JSON.stringify({ op: "create", nonce: "n" }));
  await tick();
  sp.made[0]?.exit({ code: 3, signal: null });
  await tick();
  expect(a.last("state")?.session).toMatchObject({ state: "exited", exit: { code: 3, signal: null } });
  expect(sp.made).toHaveLength(1);
});

test("workspaces do not see each other's sessions", async () => {
  const { terms } = setup();
  const a = client();
  terms.attach(VAULT, a.c).receive(JSON.stringify({ op: "create", nonce: "n" }));
  await tick();
  const other = client();
  terms.attach("/vaults/two", other.c).receive(JSON.stringify({ op: "hello" }));
  expect(other.last("sessions")?.sessions).toEqual([]);
  expect(other.events.some((e) => e.ev === "created")).toBe(false);
});

test("THE ORPHAN RULE — nobody connected for the grace period ends the sessions; a reconnect in time keeps them", async () => {
  const { terms } = setup({ grace: 60 });
  const a = client();
  const at = terms.attach(VAULT, a.c);
  at.receive(JSON.stringify({ op: "create", nonce: "keep" }));
  await tick();
  at.detach();
  // A reload: back within the grace.
  await Bun.sleep(20);
  const back = terms.attach(VAULT, client().c);
  await Bun.sleep(80);
  expect(terms.sessions(VAULT)[0]?.state).toBe("running");

  back.detach();
  await Bun.sleep(120);
  expect(terms.sessions(VAULT)[0]?.state).toBe("exited");
});

test("killAll reaches every live tree synchronously", async () => {
  const { terms } = setup();
  const a = client();
  const at = terms.attach(VAULT, a.c);
  at.receive(JSON.stringify({ op: "create", nonce: "1" }));
  at.receive(JSON.stringify({ op: "create", nonce: "2" }));
  await tick();
  terms.killAll();
  await tick();
  expect(terms.sessions(VAULT).map((s) => s.state)).toEqual(["exited", "exited"]);
});
