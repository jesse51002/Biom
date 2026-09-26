// SPDX-License-Identifier: AGPL-3.0-only
// THE CHATS, THE AGENTS AND THE HISTORY, ASSEMBLED — the server run the way
// `make dev` runs it, over HTTP and the live stream, with a scripted agent.
//
// No browser: what is walked here is the wire the Agent screen and the
// switcher will stand on, and nothing a person sees yet. A spawned
// `server/main.ts` on a free port with a data directory of this run's own, a
// vault named by `VAULT`, and on the front of its PATH the fake ACP agent
// (`tests/fake-acp-agent.ts`) under the command name Biom knows Claude Code's
// adapter by — found the way any agent is, through the login shell's
// environment, which keeps the server's own PATH entries after its own. The
// capability cookie is taken off `/` exactly as the client gets it. Jev is a
// stub on this machine, named by `BIOM_JEV_ENDPOINT`, with an invented key.
//
// WHAT IT WALKS, in order:
//
//   1. The stream opens for this machine's window, and the window's report
//      makes it one `window.list` answers.
//   2. `agents.list` finds the fake and probes it Active.
//   3. A chat started with words streams the reply and ends `end_turn`, green.
//   4. The agent's `fs/write_text_file` onto a page is the page changed on
//      disk, a `change` on the stream, and ONE history edit stamped with the
//      chat's agent id.
//   5. Stop ends a turn `cancelled`.
//   5b. A plain shell write the agent makes in its own shell is one edit by
//      `shell` — and that shell had the person's LOGIN environment, a marker
//      only their `~/.bash_profile` sets.
//   6. Jev names the chat and faces its turn, asked with the key from the
//      login environment — and the key is in nothing the server says.
//   7. An agent that refuses a session asks to be signed in; the sign-in's
//      ticket runs its command once in the pop-up's terminal and the agent is
//      Active again — and the same ticket a second time runs nothing.
//   8. Closing the stream forgets the window.
//   9. The server stopping leaves no agent process behind.
//  10. Nor does the application going away: a server whose parent's pipe
//      closes — the desktop window gone — ends its agents on the way out.
//
// Every page, word, key and id here is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { HERE, BOUNDS, sandbox, outside, freePort, until, step, stackTraces } from "./harness.ts";
import type { Sandbox } from "./harness.ts";
import { installFakeAgent } from "../fake-acp-agent.ts";
import type { AgentInfo, ChatPush, ChatSummary, ChatUpdate, HistoryEntry, HistoryRead, SignIn, WindowContext } from "../../contracts/types.ts";

const unix = process.platform !== "win32";
const WINDOW = "window-invented-e2e-01";
const KEY = "invented-jev-key-0123456789";
const AGENT = "claude-acp";

let box: Sandbox;
let before = "";
let port = 0;
let base = "";
let vault = "";
let cookie = "";
let server: ReturnType<typeof Bun.spawn> | null = null;
let said = { out: "", err: "" };
/** The file whose presence is the fake's sign-in: it refuses a session
 *  without it, and its sign-in command makes it. */
let signedIn = "";
/** Where the fake logs every message it hears, and every pid it started as. */
let fakeLog = "";

/** Jev, on this machine: what it was asked, and with which header. */
let jev: ReturnType<typeof Bun.serve> | null = null;
const jevAsked: { auth: string | null; name: boolean }[] = [];

/** The live stream, read as it arrives. */
let stream: { frames: { event: string; data: unknown }[]; opened: () => boolean; close: () => void } | null = null;

let broke: string | null = null;
const log = (): string => said.err;

function walk(name: string, run: () => Promise<void>, ms = 60000): void {
  test.if(unix)(name, async () => {
    if (broke !== null) throw new Error(`skipped: an earlier step failed — ${broke}`);
    try {
      await step(name, null, log, run);
    } catch (e) {
      broke = name;
      throw e;
    }
  }, ms);
}

function drain(s: ReadableStream<Uint8Array> | undefined, into: "out" | "err"): void {
  if (s === undefined) return;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of s) said[into] += decoder.decode(chunk);
  })();
}

const api = () => `${base}/v/${encodeURIComponent(vault)}/api/call`;
let n = 0;
async function call<T = unknown>(kind: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(api(), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ id: `e${++n}`, g: 1, kind, window: WINDOW, ...body }),
  });
  const env = (await res.json()) as { ok: boolean; value?: T; error?: { code: string; message: string } };
  if (!env.ok) throw new Error(`${kind} refused: ${env.error?.code} ${env.error?.message}`);
  return env.value as T;
}

/** Open the stream as the client does: its url, this machine's cookie. */
async function openStream(window: string | null): Promise<NonNullable<typeof stream>> {
  const ctl = new AbortController();
  const q = window === null ? "" : `?window=${encodeURIComponent(window)}`;
  const res = await fetch(`${base}/v/${encodeURIComponent(vault)}/events${q}`, { headers: { cookie }, signal: ctl.signal });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let opened = false;
  const frames: { event: string; data: unknown }[] = [];
  void (async () => {
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) return;
        text += decoder.decode(r.value, { stream: true });
        for (let at = text.indexOf("\n\n"); at >= 0; at = text.indexOf("\n\n")) {
          const f = text.slice(0, at);
          text = text.slice(at + 2);
          if (f === ": open") opened = true;
          if (!f.startsWith("event: ")) continue;
          const [head, data] = f.split("\n");
          const event = (head as string).slice("event: ".length);
          const raw = (data ?? "data: 1").slice("data: ".length);
          frames.push({ event, data: event === "change" || event === "run" ? 1 : JSON.parse(raw) });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, opened: () => opened, close: () => ctl.abort() };
}

/** Every update the stream has carried for one chat, and its latest summary. */
function chatSeen(chat: string): { updates: ChatUpdate[]; last: ChatSummary | null } {
  const pushes = (stream?.frames ?? []).filter((f) => f.event === "chat").map((f) => f.data as ChatPush).filter((p) => p.chat.id === chat);
  return { updates: pushes.flatMap((p) => p.updates), last: pushes.at(-1)?.chat ?? null };
}

const agentState = async (): Promise<AgentInfo | undefined> => (await call<AgentInfo[]>("agents.list")).find((a) => a.key === AGENT);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const fakePids = (): number[] =>
  existsSync(fakeLog)
    ? readFileSync(fakeLog, "utf8").split("\n").filter((l) => l.includes('"fake":"started"')).map((l) => (JSON.parse(l) as { pid: number }).pid)
    : [];

beforeAll(async () => {
  if (!unix) return;
  box = sandbox("chat");
  before = outside();
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  vault = join(box.root, "vault");
  const bin = join(box.root, "bin");
  signedIn = join(box.root, "signed-in");
  fakeLog = join(box.root, "fake.log");
  writeFileSync(signedIn, "invented\n");
  // What only a login shell reads: the agent must be started with it.
  writeFileSync(join(box.env.HOME as string, ".bash_profile"), "export INVENTED_LOGIN_MARK=from-the-login-shell\n");
  installFakeAgent(bin, {
    scenario: {
      log: fakeLog,
      // The legacy terminal sign-in: a command of the agent's own, which here
      // makes the file its sessions need.
      authMethods: [{ id: "invented-login", name: "Sign in (invented)", _meta: { "terminal-auth": { command: "/bin/sh", args: ["-c", `touch '${signedIn}'`] } } }],
      session: { refuseUnless: signedIn },
    },
  });

  // JEV, ON THIS MACHINE. The name's question lists topics, the turn's lists
  // faces; each is answered with one off its own list.
  jev = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { questions?: { answer?: { criteria?: Record<string, string> } } };
      const name = "tidy" in (body.questions?.answer?.criteria ?? {});
      jevAsked.push({ auth: req.headers.get("authorization"), name });
      return Response.json({ answers: { answer: { choice: name ? "tidy" : "success", confidence: 0.9 } } });
    },
  });

  server = Bun.spawn([process.execPath, "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: {
      ...box.env,
      PORT: String(port),
      VAULT: vault,
      // Only the fake, bun and the system: no agent of this machine's is found.
      PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      BIOM_JEV_ENDPOINT: `http://127.0.0.1:${jev.port}/v1/systemone`,
      // The person's key, as their login shell would carry it — invented.
      TYPESAFE_API_KEY: KEY,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(server.stdout as ReadableStream<Uint8Array>, "out");
  drain(server.stderr as ReadableStream<Uint8Array>, "err");

  await until("the server answered with this machine's capability", BOUNDS.serve, async () => {
    try {
      const res = await fetch(`${base}/`);
      cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      await res.text();
      return res.ok && cookie !== "";
    } catch {
      return false;
    }
  });
});

afterAll(async () => {
  stream?.close();
  if (server !== null && server.exitCode === null) {
    server.kill("SIGKILL");
    await server.exited;
  }
  // Whatever a failed run left behind goes with it.
  for (const pid of fakePids()) if (alive(pid)) process.kill(pid, "SIGKILL");
  jev?.stop(true);
  if (box) {
    expect(outside()).toBe(before);
    box.clean();
  }
});

walk("1. the stream opens for this machine's window, and its report makes it one the server lists", async () => {
  stream = await openStream(WINDOW);
  await until("the stream said it was open", 5000, () => stream!.opened());
  const appended = await call<HistoryEntry[]>("window.report", {
    context: { address: { view: "page", id: "home", screen: "page" }, panel: false, chat: null, agent: null },
    moved: { by: "you" },
  });
  expect(appended.map((e) => e.kind)).toEqual(["open", "view"]);
  expect(appended[0]!.writer).toEqual({ kind: "you", window: WINDOW });
  const windows = await call<WindowContext[]>("window.list");
  expect(windows.map((w) => w.window)).toContain(WINDOW);
  // The report reached the stream as the history's own event.
  await until("the report's entries reached the stream", 5000, () =>
    stream!.frames.some((f) => f.event === "history" && (f.data as HistoryEntry[]).some((e) => e.kind === "open" && e.window === WINDOW)));
});

walk("2. agents.list finds the fake on the login shell's PATH and probes it Active", async () => {
  await until("the fake agent is Active", 30000, async () => (await agentState())?.state === "active");
  const me = (await agentState())!;
  expect(me.name).toBe("Claude Code");
  expect(me.source).toBe("path");
  // The list reached every window watching, as the agents event.
  await until("the agents event carried it", 5000, () =>
    stream!.frames.some((f) => f.event === "agents" && (f.data as AgentInfo[]).some((a) => a.key === AGENT && a.state === "active")));
});

let chat = "";
let agentId = "";

walk("3. a chat started with words streams the reply, and ends end_turn with the green light", async () => {
  const made = await call<ChatSummary>("chat.new", { agent: AGENT, text: "Hello from the end-to-end walk." });
  chat = made.id;
  await until("the turn ended", 30000, () => {
    const s = chatSeen(chat);
    return s.updates.some((u) => u.kind === "turn" && u.phase === "idle");
  });
  const s = chatSeen(chat);
  const reply = s.updates.filter((u): u is Extract<ChatUpdate, { kind: "reply" }> => u.kind === "reply").map((u) => u.text).join("");
  expect(reply).toContain("echo: Hello from the end-to-end walk.");
  const end = s.updates.find((u): u is Extract<ChatUpdate, { kind: "turn" }> => u.kind === "turn" && u.phase === "idle")!;
  expect(end.stop).toBe("end_turn");
  expect(s.last!.light).toBe("done");
  agentId = s.updates.find((u): u is Extract<ChatUpdate, { kind: "agent" }> => u.kind === "agent")!.agentId;
  expect(typeof agentId).toBe("string");
});

walk("4. the agent's write onto a page changes it on disk, redraws it, and is ONE history edit stamped with the chat's agent", async () => {
  const page = "pages/home/index.html";
  const words = "<!doctype html><main><p>Invented words the fake agent wrote.</p></main>";
  const changesBefore = stream!.frames.filter((f) => f.event === "change").length;
  await call<ChatSummary>("chat.send", { chat, text: `Rewrite the page.\n!write ${page} ${words}` });
  await until("the second turn ended", 30000, () =>
    chatSeen(chat).updates.some((u) => u.kind === "turn" && u.phase === "idle" && u.turn === 2));
  expect(readFileSync(join(vault, page), "utf8")).toBe(words);
  // The watcher took it for what it is — a write this process did not make.
  await until("the page's change reached the stream", BOUNDS.redraw, () =>
    stream!.frames.filter((f) => f.event === "change").length > changesBefore);
  const edits = (await call<HistoryRead>("history.read")).entries.filter((e) => e.kind === "edit" && e.path === page);
  expect(edits.length).toBe(1);
  const edit = edits[0] as Extract<HistoryEntry, { kind: "edit" }>;
  expect(edit.via).toBe("fs");
  expect(edit.writer).toMatchObject({ kind: "agent", agent: agentId, chat, turn: 2 });
  expect(edit.place).toMatchObject({ view: "page", screen: "page" });
  // And the stream carried that one edit, once.
  const streamed = stream!.frames.filter((f) => f.event === "history").flatMap((f) => f.data as HistoryEntry[])
    .filter((e) => e.kind === "edit" && e.path === page);
  expect(streamed.map((e) => e.seq)).toEqual([edit.seq]);
  // The turn said what it changed, kept.
  const changed = chatSeen(chat).updates.find((u): u is Extract<ChatUpdate, { kind: "changed" }> => u.kind === "changed" && u.turn === 2);
  expect(changed?.edits.map((e) => e.path)).toEqual([page]);
});

walk("5. Stop ends a turn cancelled", async () => {
  await call<ChatSummary>("chat.send", { chat, text: "Take your time.\n!sleep 2500" });
  await until("the turn is running", 15000, async () => (await call<ChatSummary[]>("chat.list")).find((c) => c.id === chat)?.phase === "running");
  await call<ChatSummary>("chat.cancel", { chat });
  await until("the turn ended", 20000, () =>
    chatSeen(chat).updates.some((u) => u.kind === "turn" && u.phase === "idle" && u.turn === 3));
  const end = chatSeen(chat).updates.find((u): u is Extract<ChatUpdate, { kind: "turn" }> => u.kind === "turn" && u.phase === "idle" && u.turn === 3)!;
  expect(end.stop).toBe("cancelled");
  expect(chatSeen(chat).last!.light).toBe("none");
});

walk("5b. a shell write is one edit by `shell`, from a shell that had the login environment", async () => {
  const file = "pages/home/login-env.txt";
  await call<ChatSummary>("chat.send", { chat, text: `Look around.\n!sh env > ${file}` });
  await until("the turn ended", 20000, () =>
    chatSeen(chat).updates.some((u) => u.kind === "turn" && u.phase === "idle" && u.turn === 4));
  expect(readFileSync(join(vault, file), "utf8")).toContain("INVENTED_LOGIN_MARK=from-the-login-shell");
  const edits = (await call<HistoryRead>("history.read")).entries.filter((e) => e.kind === "edit" && e.path === file);
  expect(edits.map((e) => (e as Extract<HistoryEntry, { kind: "edit" }>).via)).toEqual(["shell"]);
  expect(edits[0]!.writer).toMatchObject({ kind: "agent", agent: agentId, chat, turn: 4 });
  rmSync(join(vault, file), { force: true });
});

walk("6. Jev names the chat and faces its turns, asked with the login environment's key, which the server says nowhere", async () => {
  await until("the name's face arrived", 20000, () =>
    chatSeen(chat).updates.some((u) => u.kind === "name" && u.face !== null));
  const named = chatSeen(chat).updates.find((u): u is Extract<ChatUpdate, { kind: "name" }> => u.kind === "name" && u.face !== null)!;
  expect(named.face).toEqual({ emoji: "\u{1F9F9}", art: "/vendor/noto/1f9f9.webp" });
  await until("a turn's face arrived", 20000, () => chatSeen(chat).updates.some((u) => u.kind === "face"));
  const face = chatSeen(chat).updates.find((u): u is Extract<ChatUpdate, { kind: "face" }> => u.kind === "face")!;
  expect(face.face.emoji).toBe("\u{1F973}");
  expect(jevAsked.length).toBeGreaterThan(0);
  expect(jevAsked.every((a) => a.auth === `Bearer ${KEY}`)).toBe(true);
  // The art is served as a picture.
  const art = await fetch(`${base}/vendor/noto/1f9f9.webp`);
  expect(art.headers.get("content-type")).toBe("image/webp");
  await art.arrayBuffer();
  // The key is in nothing the server printed, and nothing the stream carried.
  expect(said.out + said.err).not.toContain(KEY);
  expect(JSON.stringify(stream!.frames)).not.toContain(KEY);
});

walk("7. an agent that refuses a session asks to be signed in, its ticket runs once in the terminal, and it is Active again", async () => {
  rmSync(signedIn, { force: true });
  await call<AgentInfo>("agents.probe", { agent: AGENT });
  await until("the agent asks to be signed in", 30000, async () => (await agentState())?.reason === "signin");
  const me = (await agentState())!;
  expect(me.state).toBe("inactive");
  expect(me.auth.map((m) => [m.id, m.type])).toEqual([["invented-login", "terminal"]]);

  const signIn = await call<SignIn>("agents.signIn", { agent: AGENT, method: "invented-login" });
  expect(signIn.kind).toBe("terminal");
  if (signIn.kind !== "terminal") return;
  // What the pop-up shows is the method's own command — and no value of the
  // person's environment.
  expect(signIn.command).toBe("/bin/sh");
  expect(JSON.stringify(signIn)).not.toContain(KEY);

  const socket = (ticket: string) => new Promise<{ events: { ev: string; exit?: { code: number | null } }[] }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v/${encodeURIComponent(vault)}/terminal`, { headers: { origin: base, cookie } } as unknown as string[]);
    const events: { ev: string; exit?: { code: number | null } }[] = [];
    const t = setTimeout(() => { ws.close(); reject(new Error(`the terminal said ${JSON.stringify(events)} and did not close`)); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ op: "create", ticket, cols: 80, rows: 24 }));
    ws.onmessage = (e) => { if (typeof e.data === "string") events.push(JSON.parse(e.data)); };
    ws.onclose = () => { clearTimeout(t); resolve({ events }); };
    ws.onerror = () => { /* the close says the rest */ };
  });

  const first = await socket(signIn.ticket);
  expect(first.events.map((e) => e.ev)).toEqual(["started", "exited"]);
  expect(first.events[1]!.exit?.code).toBe(0);
  expect(existsSync(signedIn)).toBe(true);
  // The command's end is the look after a sign-in, and the session opens.
  await until("the agent is Active again", 30000, async () => (await agentState())?.state === "active");

  // THE SAME TICKET AGAIN RUNS NOTHING.
  rmSync(signedIn, { force: true });
  const again = await socket(signIn.ticket);
  expect(again.events.map((e) => e.ev)).toEqual(["error"]);
  await Bun.sleep(300);
  expect(existsSync(signedIn)).toBe(false);
  writeFileSync(signedIn, "invented\n");
});

walk("8. closing the stream forgets the window", async () => {
  expect((await call<WindowContext[]>("window.list")).map((w) => w.window)).toContain(WINDOW);
  stream!.close();
  await until("the window is no longer listed", 5000, async () =>
    !(await call<WindowContext[]>("window.list")).some((w) => w.window === WINDOW));
});

walk("9. the server stopping leaves no agent process behind", async () => {
  const pids = fakePids();
  // At least the probes and the chat's own agent, which is still running.
  expect(pids.length).toBeGreaterThan(1);
  expect(pids.some(alive)).toBe(true);
  server!.kill("SIGTERM");
  await server!.exited;
  await until("every fake agent is gone", 5000, () => pids.every((p) => !alive(p)));
  const listed = spawnSync("pgrep", ["-f", "fake-acp-agent.ts"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  expect(listed.filter((p) => pids.includes(p))).toEqual([]);
  // The chat's log says the turn in flight — none — and the server's stderr
  // carries no stack trace.
  expect(stackTraces(said.err)).toEqual([]);
});

walk("10. a server whose parent's pipe closes ends its agents on the way out", async () => {
  const port2 = await freePort();
  const base2 = `http://127.0.0.1:${port2}`;
  const vault2 = join(box.root, "vault-two");
  const log2 = join(box.root, "fake-two.log");
  const bin2 = join(box.root, "bin-two");
  installFakeAgent(bin2, { scenario: { log: log2 } });
  const child = Bun.spawn([process.execPath, "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: {
      ...box.env,
      PORT: String(port2),
      VAULT: vault2,
      PATH: [bin2, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      // The shell's marker: the other end of stdin is its parent.
      BIOM_SHELL: "1",
    },
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    let cookie2 = "";
    await until("the second server answered", BOUNDS.serve, async () => {
      try {
        const res = await fetch(`${base2}/`);
        cookie2 = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        await res.text();
        return res.ok && cookie2 !== "";
      } catch {
        return false;
      }
    });
    const ask = async <T>(kind: string, body: Record<string, unknown> = {}): Promise<T> => {
      const res = await fetch(`${base2}/v/${encodeURIComponent(vault2)}/api/call`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie2 },
        body: JSON.stringify({ id: `p${++n}`, g: 1, kind, ...body }),
      });
      const env = (await res.json()) as { ok: boolean; value?: T };
      if (!env.ok) throw new Error(`${kind} refused`);
      return env.value as T;
    };
    await until("the fake is Active there", 30000, async () =>
      (await ask<AgentInfo[]>("agents.list")).some((a) => a.key === AGENT && a.state === "active"));
    const made = await ask<ChatSummary>("chat.new", { agent: AGENT, text: "Still going?\n!sleep 20000" });
    await until("its turn is running", 15000, async () => (await ask<ChatSummary[]>("chat.list")).find((c) => c.id === made.id)?.phase === "running");
    const pids = readFileSync(log2, "utf8").split("\n").filter((l) => l.includes('"fake":"started"')).map((l) => (JSON.parse(l) as { pid: number }).pid);
    expect(pids.some(alive)).toBe(true);
    // The application goes: its end of the pipe closes.
    (child.stdin as unknown as { end(): void }).end();
    await child.exited;
    await until("every fake agent of the second server is gone", 5000, () => pids.every((p) => !alive(p)));
    // The turn in flight was ended, and the log says so for the next launch.
    const kept = readFileSync(join(vault2, ".biom", "chats", `${made.id}.jsonl`), "utf8");
    expect(kept).toContain('"stop":"crashed"');
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
