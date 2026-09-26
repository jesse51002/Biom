// SPDX-License-Identifier: AGPL-3.0-only
// THE LIVE STREAM'S THREE EVENTS THAT CARRY WORDS — `events()` in
// `server/main.ts`, against a host whose modules are recording fakes.
//
// What is held here: `history`, `chat` and `agents` are written as the
// contract names them; a storm of pushes is gathered into a frame or two
// rather than one event per chunk, a chat's pushes merged in order with a
// tool line's newer state in place of its older one, and only the latest
// agents list sent; the window the stream names is attached for as long as the
// stream is open and let go when it closes; nothing is written after the
// stream has gone, however late a module speaks; and a tab that goes while
// the modules are still being fetched leaves nothing subscribed. Every id and
// word is invented.

import { test, expect } from "bun:test";

import { GATHER_MS, events, gatherPush } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { STREAM } from "../contracts/wire.js";
import type { AgentInfo, ChatPush, ChatSummary, ChatUpdate, HistoryEntry } from "../contracts/types.ts";

const WINDOW = "window-invented-01";
const CHAT = "chat-invented-0001";
const OTHER = "chat-invented-0002";

/** A subscription a fake module hands out, and the record of it. */
function emitter<T>() {
  const fns = new Set<(v: T) => void>();
  let offs = 0;
  return {
    on: (fn: (v: T) => void) => {
      fns.add(fn);
      return () => {
        offs++;
        fns.delete(fn);
      };
    },
    say: (v: T) => {
      for (const fn of [...fns]) fn(v);
    },
    count: () => fns.size,
    offs: () => offs,
  };
}

function summary(id: string, turn = 1): ChatSummary {
  return {
    id, name: "Invented", face: null, agent: "claude-acp", harness: "Claude Code", agentId: null, page: null,
    phase: "running", turn, light: "working", stop: null, reason: null, created: 1, updated: 2,
  };
}
const reply = (seq: number, text: string): ChatUpdate => ({ seq, at: seq, turn: 1, kind: "reply", text });
const tool = (seq: number, id: string, status: "pending" | "completed"): ChatUpdate => ({
  seq, at: seq, turn: 1, kind: "tool",
  tool: { id, title: "Edit notes", kind: "edit", status, locations: [], diffs: [], output: "", truncated: false },
});

/** A host with one folder, whose modules are the fakes. `hold` makes the
 *  modules arrive only when the test says. */
function fakeHost(opts: { hold?: boolean } = {}) {
  const history = emitter<HistoryEntry[]>();
  const chats = emitter<ChatPush>();
  const agents = emitter<AgentInfo[]>();
  const attached: string[] = [];
  const detached: string[] = [];
  let watches = 0;
  let unwatched = 0;
  let giveDeps: (() => void) | null = null;
  const deps = {
    history: {
      on: history.on,
      attach: (w: string) => {
        attached.push(w);
        return () => void detached.push(w);
      },
    },
    chats: { on: chats.on },
    agents: { on: agents.on },
  };
  const host = {
    watch: async () => {
      watches++;
      return () => void unwatched++;
    },
    deps: () =>
      opts.hold
        ? new Promise((resolve) => {
          giveDeps = () => resolve(deps);
        })
        : Promise.resolve(deps),
  } as unknown as Host;
  return {
    host, history, chats, agents, attached, detached,
    watches: () => watches, unwatched: () => unwatched,
    giveDeps: () => giveDeps?.(),
  };
}

/** Read a stream as it arrives. */
function reading(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  let done = false;
  const pump = (async () => {
    for (;;) {
      const r = await reader.read();
      if (r.done) {
        done = true;
        return;
      }
      seen += decoder.decode(r.value);
    }
  })();
  return {
    text: () => seen,
    done: () => done,
    /** Every named event so far, parsed. */
    frames: () =>
      seen.split("\n\n").filter((f) => f.startsWith("event: ")).map((f) => {
        const [head, data] = f.split("\n");
        return { event: (head as string).slice("event: ".length), data: JSON.parse((data as string).slice("data: ".length)) as unknown };
      }),
    cancel: async () => {
      await reader.cancel();
      await pump;
    },
  };
}

const until = async (ok: () => boolean, ms = 3000): Promise<boolean> => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (ok()) return true;
    await Bun.sleep(10);
  }
  return ok();
};

test("gathering a chat's pushes keeps every update in order, with a tool line's newer state where its older one was", () => {
  let p = gatherPush(undefined, { chat: summary(CHAT, 1), updates: [reply(1, "a"), tool(2, "t1", "pending")] });
  p = gatherPush(p, { chat: summary(CHAT, 2), updates: [reply(3, "b"), tool(4, "t1", "completed"), tool(5, "t2", "pending")] });
  expect(p.chat.turn).toBe(2);
  expect(p.updates.map((u) => u.seq)).toEqual([1, 4, 3, 5]);
  expect((p.updates[1] as Extract<ChatUpdate, { kind: "tool" }>).tool.status).toBe("completed");
});

test("A STORM IS GATHERED: the history, every chat's pushes and the agents list each go out as a frame or two, not one event per chunk", async () => {
  const f = fakeHost();
  const s = reading(events(f.host, "/vault", WINDOW).body!);
  expect(await until(() => s.text().includes(": open"))).toBe(true);
  expect(f.attached).toEqual([WINDOW]);

  // Three hundred chunks of one reply, as fast as they come; a second chat;
  // twenty agents lists as a probe round moves; history in three bursts.
  for (let i = 1; i <= 300; i++) f.chats.say({ chat: summary(CHAT), updates: [reply(i, `w${i} `)] });
  f.chats.say({ chat: summary(OTHER), updates: [reply(1, "other")] });
  for (let i = 0; i < 20; i++) f.agents.say([{ key: `agent-${i}` } as unknown as AgentInfo]);
  const entry = (seq: number) => ({ kind: "edit", seq, at: seq, place: null, path: `notes-${seq}.md`, writer: { kind: "you", window: WINDOW }, via: "app", snapshot: null }) as HistoryEntry;
  f.history.say([entry(1)]);
  f.history.say([entry(2), entry(3)]);
  f.history.say([entry(4)]);

  await Bun.sleep(GATHER_MS * 4);
  const frames = s.frames();
  const chats = frames.filter((x) => x.event === STREAM.CHAT).map((x) => x.data as ChatPush);
  const mine = chats.filter((c) => c.chat.id === CHAT);
  // Gathered: everything said inside one window is one frame per chat.
  expect(mine.length).toBeLessThanOrEqual(2);
  expect(mine.flatMap((c) => c.updates.map((u) => u.seq))).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
  expect(chats.filter((c) => c.chat.id === OTHER).length).toBe(1);
  const agents = frames.filter((x) => x.event === STREAM.AGENTS);
  expect(agents.length).toBeLessThanOrEqual(2);
  expect((agents.at(-1)!.data as AgentInfo[])[0]!.key).toBe("agent-19");
  const history = frames.filter((x) => x.event === STREAM.HISTORY).flatMap((x) => x.data as HistoryEntry[]);
  expect(history.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  await s.cancel();
});

test("CLOSED MEANS CLOSED: every subscription is let go, the window forgotten, and a module speaking late writes nothing", async () => {
  const f = fakeHost();
  const s = reading(events(f.host, "/vault", WINDOW).body!);
  expect(await until(() => s.text().includes(": open"))).toBe(true);
  expect([f.history.count(), f.chats.count(), f.agents.count()]).toEqual([1, 1, 1]);

  // Something gathered and not yet written when the tab goes.
  f.chats.say({ chat: summary(CHAT), updates: [reply(1, "in flight")] });
  await s.cancel();
  expect([f.history.count(), f.chats.count(), f.agents.count()]).toEqual([0, 0, 0]);
  expect(f.detached).toEqual([WINDOW]);
  expect(f.unwatched()).toBe(1);
  const before = s.text();
  await Bun.sleep(GATHER_MS * 3);
  expect(s.text()).toBe(before);
  expect(before).not.toContain("in flight");
});

test("a stream naming no window attaches none, and still carries the chats", async () => {
  const f = fakeHost();
  const s = reading(events(f.host, "/vault").body!);
  expect(await until(() => s.text().includes(": open"))).toBe(true);
  expect(f.attached).toEqual([]);
  f.chats.say({ chat: summary(CHAT), updates: [reply(1, "hello")] });
  expect(await until(() => s.frames().some((x) => x.event === STREAM.CHAT))).toBe(true);
  await s.cancel();
  expect(f.detached).toEqual([]);
});

test("A TAB THAT GOES WHILE THE MODULES ARE BEING FETCHED leaves nothing subscribed and nothing attached", async () => {
  const f = fakeHost({ hold: true });
  const body = events(f.host, "/vault", WINDOW).body!;
  expect(await until(() => f.watches() === 1)).toBe(true);
  await body.cancel();
  f.giveDeps();
  await Bun.sleep(50);
  expect(f.unwatched()).toBe(1);
  expect([f.history.count(), f.chats.count(), f.agents.count()]).toEqual([0, 0, 0]);
  expect(f.attached).toEqual([]);
});
