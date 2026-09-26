// SPDX-License-Identifier: AGPL-3.0-only
// JEV: the engine that speaks the API, the schedule that says when to ask, and
// the loop between them. Every network call is a fake `fetch` and every timer a
// fake clock, so a ninety-second turn and four backed-off retries run in none;
// nothing here reaches TypeSafe. The key, the chats and the thinking below are
// invented and stand for nothing real.

import { test, expect } from "bun:test";
import {
  JEV_ENDPOINT,
  JEV_MODEL,
  JEV_PAUSE_MS,
  JEV_STATE_MAX,
  JEV_STREAM_KEEP,
  NAME_FACES,
  STATUS_FACES,
  faceOf,
  makeJev,
  makeJevStatus,
  makeJevTurn,
} from "../server/domain/jev.ts";

const KEY = "tsk-INVENTED-0f9c3b7e1a2d4c5b8e6f";
const THINK = { emoji: "🤔", art: "/vendor/noto/1f914.webp" };
const MONOCLE = { emoji: "🧐", art: "/vendor/noto/1f9d0.webp" };

/* ── fakes ──────────────────────────────────────────────────────────────── */

/** A clock whose timers run only when told to, in order of when they fall. */
function fakeClock(start = 0) {
  let t = start;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer(fn: () => void, ms: number) {
      const id = next++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer(handle: unknown) {
      timers.delete(handle as number);
    },
    get pending() {
      return timers.size;
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

type Reply = Response | Error | ((init: RequestInit) => Promise<Response>);

/** A `fetch` that answers from a script, one reply per call, and records every
 *  call. Past the end of the script it answers the last reply again. */
function fakeFetch(...script: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const reply = script[Math.min(calls.length - 1, script.length - 1)];
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") return reply(init);
    return (reply as Response).clone();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const answer = (choice: string) =>
  new Response(JSON.stringify({ answers: { answer: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } }, usage: { input_tokens: 120 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const status = (code: number, body = "", headers: Record<string, string> = {}) => new Response(body, { status: code, headers });

/** Jev over a fake network, with its waits recorded and taken instantly. */
function jevWith(fetch: typeof globalThis.fetch, over: Partial<Parameters<typeof makeJev>[0]> = {}) {
  const logs: string[] = [];
  const waits: number[] = [];
  let now = 1_000_000;
  const jev = makeJev({
    fetch,
    key: () => KEY,
    endpoint: JEV_ENDPOINT,
    now: () => now,
    log: (line) => logs.push(line),
    wait: async (ms) => {
      waits.push(ms);
    },
    ...over,
  });
  return { jev, logs, waits, later: (ms: number) => (now += ms) };
}

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));
const flush = () => new Promise((done) => setTimeout(done, 0));

/* ── the engine ─────────────────────────────────────────────────────────── */

test("one choice question, to the endpoint, with the bearer key, over the state", async () => {
  const net = fakeFetch(answer("weighing"));
  const { jev } = jevWith(net.fetch);
  expect(await jev.classifyTurn("the agent is thinking about the board")).toEqual(THINK);

  expect(net.calls.length).toBe(1);
  const { url, init } = net.calls[0]!;
  expect(url).toBe(JEV_ENDPOINT);
  expect(init.method).toBe("POST");
  expect(init.redirect).toBe("error");
  const headers = init.headers as Record<string, string>;
  expect(headers.authorization).toBe(`Bearer ${KEY}`);
  expect(headers["content-type"]).toBe("application/json");
  const body = bodyOf(init);
  expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
  expect(body.model).toBe(JEV_MODEL);
  expect(body.state).toBe("the agent is thinking about the board");
  const q = body.questions.answer;
  expect(q.type).toBe("choice");
  expect(typeof q.instructions).toBe("string");
  expect(Object.keys(q.criteria)).toEqual([...STATUS_FACES.map((f) => f.label), "other"]);
  for (const f of STATUS_FACES) expect(q.criteria[f.label]).toBe(f.criterion);
  // The key rides in the header and nowhere else.
  expect(String(init.body)).not.toContain(KEY);
});

test("`other` and an answer off the list both keep the face; an unknown answer is said", async () => {
  const { jev, logs } = jevWith(fakeFetch(answer("other")).fetch);
  expect(await jev.classifyTurn("state")).toBe("other");
  expect(logs).toEqual([]);
  const off = jevWith(fakeFetch(answer("dancing")).fetch);
  expect(await off.jev.classifyTurn("state")).toBe("other");
  expect(off.logs.length).toBe(1);
  const empty = jevWith(fakeFetch(new Response("{}", { status: 200 })).fetch);
  expect(await empty.jev.classifyTurn("state")).toBe("other");
});

test("NO KEY, NO CALL: Jev is off, and says so by answering null", async () => {
  for (const key of [null, "", "   "]) {
    const net = fakeFetch(answer("weighing"));
    const { jev, logs } = jevWith(net.fetch, { key: () => key });
    expect(await jev.classifyTurn("state")).toBeNull();
    expect(await jev.nameFace("Tidy the Boards page")).toBeNull();
    expect(net.calls.length).toBe(0);
    expect(logs).toEqual([]);
  }
});

test("a key that is not one word of printable characters is Jev off, said once, never sent", async () => {
  for (const key of [`${KEY}\nX-Injected: 1`, "tsk INVENTED", "tsk-INVENTED-é"]) {
    const net = fakeFetch(answer("weighing"));
    const { jev, logs, waits } = jevWith(net.fetch, { key: () => key });
    expect(await jev.classifyTurn("state")).toBeNull();
    expect(await jev.nameFace("a name")).toBeNull();
    expect(net.calls.length).toBe(0);
    expect(waits).toEqual([]);
    expect(logs.length).toBe(1);
    expect(logs[0]).not.toContain(key.trim());
  }
});

test("an empty state or name asks nothing", async () => {
  const net = fakeFetch(answer("weighing"));
  const { jev } = jevWith(net.fetch);
  expect(await jev.classifyTurn("  \n ")).toBe("other");
  expect(await jev.nameFace("   ")).toBeNull();
  expect(net.calls.length).toBe(0);
});

test("a 429 is retried after its Retry-After, and a 5xx with backoff", async () => {
  const a = jevWith(fakeFetch(status(429, "", { "retry-after": "3" }), answer("reading")).fetch);
  expect(await a.jev.classifyTurn("state")).toEqual(MONOCLE);
  expect(a.waits).toEqual([3000]);

  const net = fakeFetch(status(503), status(502), answer("reading"));
  const b = jevWith(net.fetch);
  expect(await b.jev.classifyTurn("state")).toEqual(MONOCLE);
  expect(net.calls.length).toBe(3);
  expect(b.waits).toEqual([500, 1000]);
  expect(b.logs).toEqual([]);

  // A Retry-After of an hour is not waited for: the next ask is 30 s away.
  const c = jevWith(fakeFetch(status(429, "", { "retry-after": "3600" }), answer("reading")).fetch);
  await c.jev.classifyTurn("state");
  expect(c.waits).toEqual([30_000]);
});

test("a dropped connection is retried like a 5xx", async () => {
  const net = fakeFetch(new TypeError("fetch failed"), answer("weighing"));
  const { jev, waits } = jevWith(net.fetch);
  expect(await jev.classifyTurn("state")).toEqual(THINK);
  expect(waits).toEqual([500]);
});

test("retries spent: one line, `other`, and every chat stops asking for a minute", async () => {
  const net = fakeFetch(status(500));
  const { jev, logs, waits, later } = jevWith(net.fetch);
  expect(await jev.classifyTurn("state")).toBe("other");
  expect(net.calls.length).toBe(5);
  expect(waits).toEqual([500, 1000, 2000, 4000]);
  expect(logs.length).toBe(1);
  expect(logs[0]).toContain("4 retries");

  // Paused: no call, no line.
  expect(await jev.classifyTurn("state")).toBeNull();
  expect(await jev.nameFace("a name")).toBeNull();
  expect(net.calls.length).toBe(5);
  expect(logs.length).toBe(1);

  later(JEV_PAUSE_MS);
  await jev.classifyTurn("state");
  expect(net.calls.length).toBe(10);
});

test("any other 4xx is a refusal: asked once, said once, not retried", async () => {
  for (const code of [400, 404, 413, 422]) {
    const net = fakeFetch(status(code, `{"error":"bad question"}`));
    const { jev, logs, waits } = jevWith(net.fetch);
    expect(await jev.classifyTurn("state")).toBe("other");
    expect(net.calls.length).toBe(1);
    expect(waits).toEqual([]);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain(String(code));
  }
});

test("a refused KEY turns Jev off until the key changes, without sending it again", async () => {
  let key = KEY;
  const net = fakeFetch(status(401), answer("weighing"));
  const { jev, logs } = jevWith(net.fetch, { key: () => key });
  expect(await jev.classifyTurn("state")).toBeNull();
  expect(await jev.classifyTurn("state")).toBeNull();
  expect(await jev.nameFace("a name")).toBeNull();
  expect(net.calls.length).toBe(1);
  expect(logs.length).toBe(1);

  key = "tsk-INVENTED-another-key-7d3a";
  expect(await jev.classifyTurn("state")).toEqual(THINK);
  expect(net.calls.length).toBe(2);
});

test("THE KEY NEVER REACHES A LOG LINE OR AN ERROR, whatever comes back", async () => {
  const echo = `{"error":{"message":"bad key ${KEY}","header":"Bearer ${KEY}"}}`;
  const modes: Reply[][] = [
    [status(401, echo)],
    [status(403, echo)],
    [status(400, echo)],
    [status(500, echo)],
    [status(429, echo, { "retry-after": "1" })],
    [new Error(`connect ECONNREFUSED while sending Authorization: Bearer ${KEY}`)],
    [new Response(`not json ${KEY}`, { status: 200 })],
    [answer(KEY)],
  ];
  const everything: string[] = [];
  const spied = { warn: console.warn, error: console.error, log: console.log };
  console.warn = console.error = console.log = (...args: unknown[]) => everything.push(args.map(String).join(" "));
  try {
    for (const script of modes) {
      const { jev, logs } = jevWith(fakeFetch(...script).fetch);
      // Neither call may throw: a rejected promise is an error somebody prints.
      await expect(jev.classifyTurn("state")).resolves.toBeDefined();
      await expect(jev.nameFace("a name")).resolves.toBeDefined();
      everything.push(...logs);
    }
    // The default log is console.warn: the same modes through it.
    for (const script of modes) {
      const jev = makeJev({ fetch: fakeFetch(...script).fetch, key: () => KEY, endpoint: JEV_ENDPOINT, now: () => 0, wait: async () => {} });
      await jev.classifyTurn("state");
    }
    // An endpoint that would carry the key in the clear.
    const plain = makeJev({ fetch: fakeFetch(answer("weighing")).fetch, key: () => KEY, endpoint: `http://example.invalid/${KEY}`, now: () => 0 });
    await plain.classifyTurn("state");
  } finally {
    Object.assign(console, spied);
  }
  expect(everything.length).toBeGreaterThan(5);
  for (const line of everything) expect(line).not.toContain(KEY);
  for (const line of everything) expect(line).not.toContain(KEY.slice(4, 20));
});

test("the key goes only to https, or to http on this machine", async () => {
  for (const endpoint of ["http://api.example.invalid/v1/systemone", "ftp://127.0.0.1/", "not a url", "https://user:pw@api.example.invalid/"]) {
    const net = fakeFetch(answer("weighing"));
    const { jev, logs } = jevWith(net.fetch, { endpoint });
    expect(await jev.classifyTurn("state")).toBeNull();
    expect(await jev.classifyTurn("state")).toBeNull();
    expect(net.calls.length).toBe(0);
    expect(logs.length).toBe(1);
  }
  for (const endpoint of ["http://127.0.0.1:8123/v1/systemone", "http://localhost/v1/systemone", "http://[::1]:9/x", "https://kev.example.invalid/v1/systemone"]) {
    const net = fakeFetch(answer("weighing"));
    const { jev } = jevWith(net.fetch, { endpoint });
    expect(await jev.classifyTurn("state")).toEqual(THINK);
    expect(net.calls[0]!.url).toBe(new URL(endpoint).href);
  }
});

test("an attempt that hangs is given up and retried", async () => {
  const hang = (init: RequestInit) =>
    new Promise<Response>((_, fail) => init.signal!.addEventListener("abort", () => fail(new DOMException("gave up", "AbortError"))));
  const net = fakeFetch(hang, answer("weighing"));
  const { jev, waits } = jevWith(net.fetch, { attemptMs: 5 });
  expect(await jev.classifyTurn("state")).toEqual(THINK);
  expect(net.calls.length).toBe(2);
  expect(waits).toEqual([500]);
});

test("ABANDONED: an aborted ask stops at once — no call, no retry, no timer left", async () => {
  const before = fakeFetch(answer("weighing"));
  const a = jevWith(before.fetch);
  const done = new AbortController();
  done.abort();
  expect(await a.jev.classifyTurn("state", done.signal)).toBe("other");
  expect(await a.jev.nameFace("a name", done.signal)).toBeNull();
  expect(before.calls.length).toBe(0);

  // Aborted during the backoff, with the REAL wait: it ends when the signal
  // does, not half a second later, and asks nothing more.
  const net = fakeFetch(status(503));
  const jev = makeJev({ fetch: net.fetch, key: () => KEY, endpoint: JEV_ENDPOINT, now: () => 0, log: () => {} });
  const stop = new AbortController();
  const t0 = performance.now();
  const asked = jev.classifyTurn("state", stop.signal);
  setTimeout(() => stop.abort(), 20);
  expect(await asked).toBe("other");
  expect(performance.now() - t0).toBeLessThan(400);
  expect(net.calls.length).toBe(1);

  // Aborted mid-flight: the request itself is cancelled.
  const hang = (init: RequestInit) =>
    new Promise<Response>((_, fail) => init.signal!.addEventListener("abort", () => fail(new DOMException("gave up", "AbortError"))));
  const flight = fakeFetch(hang);
  const b = jevWith(flight.fetch);
  const mid = new AbortController();
  const pending = b.jev.classifyTurn("state", mid.signal);
  await flush();
  mid.abort();
  expect(await pending).toBe("other");
  expect(flight.calls.length).toBe(1);
  expect(b.waits).toEqual([]);
});

test("a state past Jev's limit is sent as its head and its latest tail", async () => {
  const net = fakeFetch(answer("weighing"));
  const { jev } = jevWith(net.fetch);
  const state = "HEAD " + "x".repeat(200_000) + " TAIL";
  await jev.classifyTurn(state);
  const sent: string = bodyOf(net.calls[0]!.init).state;
  expect(sent.length).toBeLessThanOrEqual(JEV_STATE_MAX);
  expect(sent.startsWith("HEAD ")).toBe(true);
  expect(sent.endsWith(" TAIL")).toBe(true);
});

test("the name: one call on the name alone, a topic, and talk for `other`", async () => {
  const net = fakeFetch(answer("tidy"));
  const { jev } = jevWith(net.fetch);
  expect(await jev.nameFace("  Boards tidy-up ")).toEqual({ emoji: "🧹", art: "/vendor/noto/1f9f9.webp" });
  const body = bodyOf(net.calls[0]!.init);
  expect(body.state).toBe("Boards tidy-up");
  expect(Object.keys(body.questions.answer.criteria)).toEqual([...NAME_FACES.map((f) => f.label), "other"]);

  expect(await jevWith(fakeFetch(answer("other")).fetch).jev.nameFace("Hello")).toEqual({ emoji: "💬", art: "/vendor/noto/1f4ac.webp" });
  const off = jevWith(fakeFetch(answer("weighing")).fetch);
  expect(await off.jev.nameFace("Hello")).toEqual({ emoji: "💬", art: "/vendor/noto/1f4ac.webp" });
  expect(off.logs.length).toBe(1);
  // A failure names nothing: a name with no face is a name Jev never answered.
  expect(await jevWith(fakeFetch(status(400)).fetch).jev.nameFace("Hello")).toBeNull();
});

/* ── the schedule ───────────────────────────────────────────────────────── */

const start = (turn = 1, chat = "c1", text = "Tidy up the Boards page") => ({ kind: "start" as const, chat, turn, text });
const thought = (text: string, turn = 1, chat = "c1") => ({ kind: "thought" as const, chat, turn, text });
const reply = (text: string, turn = 1, chat = "c1") => ({ kind: "reply" as const, chat, turn, text });
const tool = (text: string, turn = 1, chat = "c1") => ({ kind: "tool" as const, chat, turn, text });
const end = (turn = 1, chat = "c1") => ({ kind: "end" as const, chat, turn });

function schedule() {
  const clock = fakeClock();
  const moments: { at: number; chat: string; turn: number; state: string; final: boolean }[] = [];
  const turn = makeJevTurn((m) => moments.push({ at: clock.now(), ...m }), clock);
  return { clock, moments, turn };
}

test("ASKED AT 10 s, THEN EVERY 30 s, THEN ONCE AT THE END", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(start());
  clock.advance(1_000);
  turn.signal(thought("Looking at the board's columns. "));
  clock.advance(8_999);
  expect(moments).toEqual([]);
  clock.advance(1);
  turn.signal(thought("Two columns drifted. "));
  clock.advance(30_000);
  turn.signal(thought("Moving the cards back. "));
  clock.advance(30_000);
  turn.signal(thought("Checking the result. "));
  clock.advance(5_000);
  turn.signal(end());
  expect(moments.map((m) => m.at)).toEqual([10_000, 40_000, 70_000, 75_000]);
  expect(moments.map((m) => m.final)).toEqual([false, false, false, true]);
  expect(moments.every((m) => m.chat === "c1" && m.turn === 1)).toBe(true);
  // The turn over, nothing is left ticking.
  expect(clock.pending).toBe(0);
  clock.advance(300_000);
  expect(moments.length).toBe(4);
});

test("a turn shorter than 10 s is asked once, at its end", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(start());
  turn.signal(thought("Quick one."));
  clock.advance(4_000);
  turn.signal(end());
  expect(moments.map((m) => [m.at, m.final])).toEqual([[4_000, true]]);
  expect(clock.pending).toBe(0);
});

test("nothing said yet keeps the loader up: no question until the agent speaks", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(start());
  clock.advance(10_000);
  expect(moments).toEqual([]);
  clock.advance(2_000);
  turn.signal(reply("On it."));
  clock.advance(28_000);
  expect(moments.map((m) => m.at)).toEqual([40_000]);
  // A turn that ends having said nothing is not asked about.
  const other = schedule();
  other.turn.signal(start());
  other.clock.advance(15_000);
  other.turn.signal(end());
  expect(other.moments).toEqual([]);
});

test("the same state is not asked twice — the answer, and the face, could not move", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(start());
  turn.signal(thought("Reading."));
  clock.advance(40_000);
  expect(moments.length).toBe(1);
  turn.signal(thought(" More."));
  clock.advance(30_000);
  expect(moments.length).toBe(2);
  turn.signal(end());
  expect(moments.length).toBe(2);
  expect(clock.pending).toBe(0);
});

test("the state is the request and the thinking; with no thinking, the reply and the tools", () => {
  const a = schedule();
  a.turn.signal(start(1, "c1", "Tidy up the Boards page"));
  a.turn.signal(reply("I will tidy it."));
  a.turn.signal(thought("The columns drifted."));
  a.turn.signal(tool("Read pages/boards/content.yaml"));
  a.clock.advance(10_000);
  const withThinking = a.moments[0]!.state;
  expect(withThinking).toContain("Tidy up the Boards page");
  expect(withThinking).toContain("The columns drifted.");
  expect(withThinking).not.toContain("I will tidy it.");

  const b = schedule();
  b.turn.signal(start(1, "c1", "Tidy up the Boards page"));
  b.turn.signal(reply("I will "));
  b.turn.signal(reply("tidy it."));
  b.turn.signal(tool("Read pages/boards/content.yaml"));
  b.turn.signal(tool("Read pages/boards/content.yaml"));
  b.turn.signal(tool("Edit pages/boards/content.yaml"));
  b.turn.signal(reply("Done."));
  b.turn.signal(tool("Edit pages/boards/content.yaml"));
  b.clock.advance(10_000);
  const without = b.moments[0]!.state;
  expect(without).toContain("Tidy up the Boards page");
  expect(without).toContain("I will tidy it.");
  // One line per call: an update repeating the title is not a second call,
  // and the same title after the agent spoke again is.
  expect(without.split("[Read pages/boards/content.yaml]").length - 1).toBe(1);
  expect(without.split("[Edit pages/boards/content.yaml]").length - 1).toBe(2);
  expect(without.indexOf("I will tidy it.")).toBeLessThan(without.indexOf("[Read"));
});

test("a long turn is held as its latest words, not its whole length", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(start(1, "c1", "r".repeat(10_000)));
  for (let i = 0; i < 2_000; i++) turn.signal(thought("t".repeat(500)));
  turn.signal(thought("THE LATEST"));
  clock.advance(10_000);
  const state = moments[0]!.state;
  expect(state.endsWith("THE LATEST")).toBe(true);
  expect(state.length).toBeLessThan(JEV_STREAM_KEEP + 2_500);
});

test("signals of another turn, another chat, or with no start are not this turn's", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(thought("orphan"));
  turn.signal(end());
  expect(moments).toEqual([]);
  expect(clock.pending).toBe(0);

  turn.signal(start(2));
  turn.signal(thought("stale", 1));
  turn.signal(thought("foreign", 2, "c2"));
  turn.signal(start(1, "c2"));
  turn.signal(end(1));
  turn.signal(end(2, "c2"));
  clock.advance(10_000);
  expect(moments).toEqual([]);
  turn.signal(thought("mine", 2));
  turn.signal(end(2));
  expect(moments.length).toBe(1);
  expect(moments[0]!.state).toContain("mine");
  expect(moments[0]!.state).not.toContain("stale");
  expect(moments[0]!.state).not.toContain("foreign");
});

test("a new turn starts its own schedule from its own start", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(start(1));
  turn.signal(thought("one"));
  clock.advance(5_000);
  turn.signal(end(1));
  clock.advance(2_000);
  turn.signal(start(2));
  turn.signal(thought("two", 2));
  clock.advance(10_000);
  expect(moments.map((m) => [m.at, m.turn, m.final])).toEqual([
    [5_000, 1, true],
    [17_000, 2, false],
  ]);
});

test("STOPPED: every timer cancelled, and nothing heard after", () => {
  const { clock, moments, turn } = schedule();
  turn.signal(start());
  turn.signal(thought("Reading."));
  clock.advance(10_000);
  expect(clock.pending).toBe(1);
  turn.stop();
  expect(clock.pending).toBe(0);
  turn.signal(thought("more"));
  turn.signal(end());
  turn.signal(start(2));
  clock.advance(120_000);
  expect(moments.length).toBe(1);
  expect(clock.pending).toBe(0);
});

test("a listener that throws is said, and stops neither the schedule nor the caller", () => {
  const clock = fakeClock();
  const at: number[] = [];
  const logs: string[] = [];
  const turn = makeJevTurn(
    () => {
      at.push(clock.now());
      throw new Error("listener fault");
    },
    clock,
    (line) => logs.push(line),
  );
  turn.signal(start());
  turn.signal(thought("a"));
  clock.advance(10_000);
  turn.signal(thought("b"));
  clock.advance(30_000);
  turn.signal(thought("c"));
  expect(() => turn.signal(end())).not.toThrow();
  expect(at).toEqual([10_000, 40_000, 40_000]);
  expect(logs.length).toBe(3);
  expect(clock.pending).toBe(0);
});

/* ── the loop ───────────────────────────────────────────────────────────── */

/** A Jev whose every answer is handed out by the test, in whatever order. */
function scriptedJev() {
  const asks: { state: string; signal: AbortSignal; answer: (a: unknown) => void }[] = [];
  const names: { name: string; signal: AbortSignal; answer: (a: unknown) => void }[] = [];
  const jev = {
    classifyTurn: (state: string, signal: AbortSignal) => new Promise((answer) => asks.push({ state, signal, answer })),
    nameFace: (name: string, signal: AbortSignal) => new Promise((answer) => names.push({ name, signal, answer })),
  };
  return { jev, asks, names };
}

function loop() {
  const clock = fakeClock();
  const s = scriptedJev();
  const faces: [string, number | null, string][] = [];
  const logs: string[] = [];
  const status = makeJevStatus({
    jev: s.jev as never,
    clock,
    face: (chat, turn, face) => faces.push([chat, turn, face.emoji]),
    log: (line) => logs.push(line),
  });
  return { clock, status, faces, logs, ...s };
}

test("THE FACE FLIPS ONLY WHEN THE ANSWER CHANGES, `other` keeps it, and the last stays", async () => {
  const { clock, status, faces, asks } = loop();
  status.signal(start());
  status.signal(thought("a"));
  clock.advance(10_000);
  asks[0]!.answer(THINK);
  await flush();
  status.signal(thought("b"));
  clock.advance(30_000);
  asks[1]!.answer(THINK);
  await flush();
  status.signal(thought("c"));
  clock.advance(30_000);
  asks[2]!.answer("other");
  await flush();
  status.signal(thought("d"));
  status.signal(end());
  asks[3]!.answer(MONOCLE);
  await flush();
  expect(asks.length).toBe(4);
  expect(faces).toEqual([
    ["c1", 1, "🤔"],
    ["c1", 1, "🧐"],
  ]);
  expect(clock.pending).toBe(0);
});

test("Jev off (null) never sets a face", async () => {
  const { clock, status, faces, asks } = loop();
  status.signal(start());
  status.signal(thought("a"));
  clock.advance(10_000);
  asks[0]!.answer(null);
  status.signal(end());
  await flush();
  expect(faces).toEqual([]);
});

test("an earlier question answered after a later one is stale and dropped", async () => {
  const { clock, status, faces, asks } = loop();
  status.signal(start());
  status.signal(thought("a"));
  clock.advance(10_000);
  status.signal(thought("b"));
  clock.advance(30_000);
  asks[1]!.answer(MONOCLE);
  await flush();
  asks[0]!.answer(THINK);
  await flush();
  expect(faces).toEqual([["c1", 1, "🧐"]]);

  // `other` from the later question is the newer judgement too.
  const b = loop();
  b.status.signal(start());
  b.status.signal(thought("a"));
  b.clock.advance(10_000);
  b.status.signal(thought("b"));
  b.clock.advance(30_000);
  b.asks[1]!.answer("other");
  await flush();
  b.asks[0]!.answer(THINK);
  await flush();
  expect(b.faces).toEqual([]);
});

test("each message has its own face, and a turn's late answer lands on its own message", async () => {
  const { clock, status, faces, asks } = loop();
  status.signal(start(1));
  status.signal(thought("a"));
  clock.advance(10_000);
  asks[0]!.answer(MONOCLE);
  await flush();
  status.signal(thought("b"));
  status.signal(end(1));
  // The person sends again before turn 1's last answer is back.
  status.signal(start(2));
  status.signal(thought("c", 2));
  clock.advance(10_000);
  asks[2]!.answer(MONOCLE);
  asks[1]!.answer(THINK);
  await flush();
  expect(faces).toEqual([
    ["c1", 1, "🧐"],
    ["c1", 2, "🧐"],
    ["c1", 1, "🤔"],
  ]);
});

test("A CLOSED CHAT: timers cancelled, the ask in flight abandoned, a late answer dropped", async () => {
  const { clock, status, faces, asks, names } = loop();
  status.signal(start());
  status.named("c1", "Boards tidy-up");
  status.signal(thought("a"));
  clock.advance(10_000);
  expect(clock.pending).toBe(1);
  status.close("c1");
  expect(clock.pending).toBe(0);
  expect(asks[0]!.signal.aborted).toBe(true);
  expect(names[0]!.signal.aborted).toBe(true);
  asks[0]!.answer(THINK);
  names[0]!.answer({ emoji: "🧹", art: "/vendor/noto/1f9f9.webp" });
  await flush();
  expect(faces).toEqual([]);
  // What the chat says as it dies does not bring it back.
  status.signal(thought("b"));
  status.signal(end());
  clock.advance(120_000);
  expect(asks.length).toBe(1);
  expect(clock.pending).toBe(0);
});

test("stop closes every chat", () => {
  const { clock, status, asks } = loop();
  for (const chat of ["c1", "c2", "c3"]) {
    status.signal(start(1, chat));
    status.signal(thought("a", 1, chat));
  }
  clock.advance(10_000);
  expect(clock.pending).toBe(3);
  status.stop();
  expect(clock.pending).toBe(0);
  expect(asks.every((a) => a.signal.aborted)).toBe(true);
});

test("an ask that rejects is said, by the error's name only", async () => {
  const clock = fakeClock();
  const logs: string[] = [];
  const failing = {
    classifyTurn: () => Promise.reject(new Error(`failed with ${KEY}`)),
    nameFace: () => Promise.reject(new Error(`failed with ${KEY}`)),
  };
  const status = makeJevStatus({ jev: failing as never, clock, face: () => {}, log: (line) => logs.push(line) });
  status.named("c1", "a name");
  status.signal(start());
  status.signal(thought("a"));
  status.signal(end());
  await flush();
  expect(logs.length).toBe(2);
  for (const line of logs) expect(line).not.toContain(KEY);
});

test("the name is asked once, whatever repeats it", async () => {
  const { status, faces, names } = loop();
  status.named("c1", "Boards tidy-up");
  status.named("c1", "Boards tidy-up");
  status.named("c1", "Renamed");
  expect(names.map((n) => n.name)).toEqual(["Boards tidy-up"]);
  names[0]!.answer({ emoji: "🧹", art: "/vendor/noto/1f9f9.webp" });
  await flush();
  expect(faces).toEqual([["c1", null, "🧹"]]);
  status.named("c2", "Another");
  names[1]!.answer(null);
  await flush();
  expect(faces.length).toBe(1);
});

test("a receiver that throws is said, not an unhandled rejection", async () => {
  const clock = fakeClock();
  const s = scriptedJev();
  const logs: string[] = [];
  const status = makeJevStatus({
    jev: s.jev as never,
    clock,
    face: () => {
      throw new Error("no such chat");
    },
    log: (line) => logs.push(line),
  });
  status.signal(start());
  status.signal(thought("a"));
  status.signal(end());
  s.asks[0]!.answer(THINK);
  await flush();
  expect(logs.length).toBe(1);
});

test("END TO END over a fake network: a whole turn, faces on change, then nothing ticking", async () => {
  const clock = fakeClock();
  const net = fakeFetch(answer("reading"), answer("reading"), answer("making"));
  const jev = makeJev({ fetch: net.fetch, key: () => KEY, endpoint: JEV_ENDPOINT, now: clock.now, log: () => {} });
  const faces: unknown[] = [];
  const status = makeJevStatus({ jev, clock, face: (chat, turn, face) => faces.push([chat, turn, face]) });
  status.signal(start());
  status.signal(thought("Reading the board."));
  clock.advance(10_000);
  await flush();
  status.signal(thought("Still reading."));
  clock.advance(30_000);
  await flush();
  status.signal(thought("Writing the fix."));
  status.signal(end());
  await flush();
  expect(net.calls.length).toBe(3);
  expect(faces).toEqual([
    ["c1", 1, MONOCLE],
    ["c1", 1, faceOf(STATUS_FACES.find((f) => f.label === "making")!)],
  ]);
  expect(clock.pending).toBe(0);
});

test("END TO END with no key: a whole turn asks nothing and draws nothing", async () => {
  const clock = fakeClock();
  const net = fakeFetch(answer("reading"));
  const jev = makeJev({ fetch: net.fetch, key: () => null, endpoint: JEV_ENDPOINT, now: clock.now });
  const faces: unknown[] = [];
  const status = makeJevStatus({ jev, clock, face: (...f) => faces.push(f) });
  status.named("c1", "Boards tidy-up");
  status.signal(start());
  status.signal(thought("a"));
  clock.advance(10_000);
  status.signal(thought("b"));
  clock.advance(30_000);
  status.signal(end());
  await flush();
  expect(net.calls.length).toBe(0);
  expect(faces).toEqual([]);
  expect(clock.pending).toBe(0);
});
