// SPDX-License-Identifier: AGPL-3.0-only
// THE WHOLE PRODUCT, ON A SCREEN — the Chat spec and the History and View
// Switcher spec, walked end to end in a real headless Chromium against a real
// server, with the scripted ACP agent (`tests/fake-acp-agent.ts`) as the only
// agent on its PATH.
//
// `agent-screen.e2e.ts` walks the Agent screen's host side — the input box,
// the pickers, one box for screen and panel — and `chat-server.e2e.ts` the wire
// without a browser. This walks what a person does with both, and above all
// what only the assembled program can show: the SWITCHER, deciding on this
// window's own clock whether an agent's write brings its page up, is offered in
// Go to page, or does nothing. Playwright's page clock moves that window's time
// (the switcher reads only `Date.now` and `setTimeout`, by design), so its two
// minutes and five seconds are walked without waiting them out.
//
// The server is run the way `make dev` runs it, with no VAULT, and the
// workspace is made THROUGH THE PAGE, as `server.e2e.ts` makes one. The fake
// agent is NOT on the machine when the walk starts: the first message is the
// fresh machine's, held until an agent is found and Active.
//
// WHAT IT WALKS — each a step, each bounded, a picture before and after:
//
//    0. A workspace made through the page, with four invented pages.
//    1. The rail and the page bar: Agent where Dashboard was, Home the tree's
//       heading, the amber Edit on the bar, no Agent Terminal and no dock.
//    3. A first message with no agent on the machine is held; More agents says
//       so; it goes out on its own once an agent is found and Active.
//    3b. The same with an agent still being checked: not Active, so held.
//    2. The start screen: the turning line, View chat history, Ask anything,
//       and the harness's name on the chip, never a model.
//    4. A turn: the loader on the message, the light amber then green, the
//       chat named in the history, one message at a time, Stop while it runs;
//       4a, its reply's words drawn live though they came with the turn's end.
//    5. Stop: cancelled, and the light goes out.
//    6. A red turn: red, with the reason, until the next turn starts.
//    7. Tool lines: an edit tool call opens to its diff, the pages changed
//       name the page, and a write off the full Agent screen brings the page
//       up with the chat beside it — its run of tool calls one line, drawn
//       as the chat is always drawn, with no ⋯ in the panel's head.
//    8. The / menu: the agent's commands and the workspace's skills, once each.
//    9. Edit: a new chat beside the page with the input empty and the caret
//       in it. Its first message carries the page to the agent, after the
//       words and as Biom's own block, and the bubble shows the words alone;
//       the same page again carries nothing, another page does. Maximised
//       and minimised back.
//    9b. A page opened from the full Agent screen keeps the chat beside it.
//   10–16. The switcher: follow (with the pages changed saying Edited for a
//       new file in a page that was there, 10b), offer, idle, a send handing
//       the screen over, five minutes on screen making it the person's
//       (13b), a held screen (14; Go to page clear of the chat's last line in
//       14a, and taken in 14b), a chat in the background, and no bounce.
//   17. A shell write: one history edit by `shell`, followed.
//   17b. A page the agent CREATES is one edit naming it, and is followed;
//   17c. and one written with no uid gets one, kept, and is followed too.
//   18. Every screen's address survives a reload and Back.
//   19. Sign-in in the pop-up terminal: a command that exits 0 closes it and
//       the agent is Active; one that exits 1 leaves it open with the reason.
//   20. A page's own code cannot move the screen; a wikilink click can.
//   20b. `#/page/@agent`, `@map` and `@design` are no page.
//   20c. A page on another localhost port gets nothing with the cookie.
//   20d. The choices kept: a mode picked in a chat holds across a reload, a
//       new chat and a server restart.
//   20e. A chat deleted from its row's three dots, asked in Biom's own
//       dialog: Cancel deletes nothing, Delete takes it for good.
//   20f. The queue: a message sent mid-turn waits under it and goes out when
//       the turn ends; two queued behind a turn and then Stop both go out, in
//       order, with nothing held and no Send queued.
//   20g. Send now: two queued behind a turn, Send now pressed on the second,
//       and the turn stops, the second goes out first, then the first.
//   21. No stack trace, nothing outside the sandbox, no agent left running.
//
// EVERY PRODUCT BUG THIS WALK FOUND is fixed and asserted as a plain step:
// 4a, 3b, 20b, 17b, 14a and 10b each hold one. A bug found later is kept as
// `test.failing`, named for what it gets wrong, until it is fixed — green
// while the product is wrong, red the day it is right, which is the prompt to
// make it a plain step.
//
// Every page, word, key, face and id here is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import type { Browser, Frame, Page } from "playwright";

import { HERE, SHOTS, BOUNDS, sandbox, withoutAgents, outside, freePort, until, step, stackTraces, shotsDir } from "./harness.ts";
import type { Sandbox } from "./harness.ts";
import { installFakeAgent } from "../fake-acp-agent.ts";
import type { Scenario } from "../fake-acp-agent.ts";
import type { AgentInfo, ChatRead, ChatSettings, ChatSummary, HistoryEntry, HistoryRead, WindowContext } from "../../contracts/types.ts";

const unix = process.platform !== "win32";
const AGENT = "claude-acp";
/** The person's Jev key, as their login shell would carry it — invented. */
const KEY = "invented-jev-key-for-the-chat-walk";

/** The four invented pages, by id, and where each one's folder is. */
const A = "home/alpha";
const B = "home/beta";
const C = "home/gamma";
const MOVER = "home/mover";
const dirOf = (id: string): string => join("pages", ...id.split("/").flatMap((s, i) => (i === 0 ? [s] : ["children", s])));
/** A file of B's, and of C's, that no page draws: the agent's writes land
 *  there, so the page itself is never broken by a write. */
const B_NOTES = `${dirOf(B)}/notes.md`;
const C_NOTES = `${dirOf(C)}/notes.md`;

let box: Sandbox;
let before = "";
let port = 0;
let base = "";
let vault = "";
let bin = "";
let fakeLog = "";
let signedIn = "";
let server: ReturnType<typeof Bun.spawn> | null = null;
const said = { out: "", err: "" };
let browser: Browser | null = null;
let page: Page;
let jev: ReturnType<typeof Bun.serve> | null = null;

/** The chats the walk makes: the held first message, the one that turns,
 *  stops and crashes, the one Edit makes and the switcher follows, and one
 *  that works in the background. */
let heldChat = "";
let turnChat = "";
let X = "";
let Y = "";

/** Set when the walk cannot begin at all, so every step after says so rather
 *  than failing for a reason that is really the first one's. */
let fatal: string | null = null;
const log = (): string => said.err;

/* ── the agent on the machine ────────────────────────────────────────────── */

/** The fake's terminal sign-in: a command of its own that prints, waits long
 *  enough to be seen, and makes the file its sessions need. */
const signInOk = (): unknown[] => [{
  id: "invented-login", name: "Sign in (invented)",
  _meta: { "terminal-auth": { command: "/bin/sh", args: ["-c", `echo 'Signing in to the invented agent'; sleep 2; touch '${signedIn}'`] } },
}];
/** The same sign-in, failing: it prints why and exits 1. */
const signInFails = (): unknown[] => [{
  id: "invented-login", name: "Sign in (invented)",
  _meta: { "terminal-auth": { command: "/bin/sh", args: ["-c", "echo 'The invented sign-in was refused'; exit 1"] } },
}];

/** THE AGENT THIS WALK TALKS TO: it echoes, obeys `!write`, `!sh`, `!edit`,
 *  `!sleep` and `!crash`, refuses a session while `signedIn` is missing, has a
 *  model list and a mode list, and sends three commands — one of them the name of a workspace
 *  skill, which the / menu must show once. */
function scenario(auth: unknown[] = signInOk(), extra: Partial<Scenario> = {}): Scenario {
  return {
    log: fakeLog,
    authMethods: auth,
    session: {
      refuseUnless: signedIn,
      configOptions: [
        { id: "model", name: "Model", category: "model", type: "select", currentValue: "opus", options: [
          { value: "opus", name: "Opus (invented)", description: "Most capable" },
          { value: "haiku", name: "Haiku (invented)", description: "Fastest" },
        ] },
        { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "ask", options: [
          { value: "ask", name: "Ask (invented)" },
          { value: "plan", name: "Plan (invented)" },
        ] },
      ],
      commands: [
        { name: "code-review", description: "Review the current diff (invented)" },
        { name: "compact", description: "Summarise the chat so far (invented)" },
        { name: "biom-pages", description: "The agent's own copy of a workspace skill (invented)" },
      ],
    },
    ...extra,
  };
}

/** Put the fake on the machine, or change what it does next time it starts —
 *  written beside and renamed over, so a look or a start in between never
 *  reads half a script. A process already running keeps what it started with. */
function putFake(s: Scenario): void {
  const next = installFakeAgent(bin, { name: "claude-agent-acp.next", scenario: s });
  renameSync(next, join(bin, "claude-agent-acp"));
}

/** A process's state letter as `ps` says it — `Z` for one that has exited and
 *  not been reaped — or "" for one that is not there at all. */
const stateOf = (pid: number): string =>
  (spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout ?? "").trim();
/** It has stopped running: gone, or a zombie waiting for its parent. */
const ended = (pid: number): boolean => {
  const st = stateOf(pid);
  return st === "" || st.startsWith("Z");
};

const fakePids = (): number[] =>
  existsSync(fakeLog)
    ? readFileSync(fakeLog, "utf8").split("\n").filter((l) => l.includes('"fake":"started"')).map((l) => (JSON.parse(l) as { pid: number }).pid)
    : [];
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/* ── the walk's own furniture ────────────────────────────────────────────── */

function drain(s: ReadableStream<Uint8Array> | undefined, into: "out" | "err"): void {
  if (s === undefined) return;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of s) said[into] += decoder.decode(chunk);
  })();
}

async function shot(file: string): Promise<void> {
  try {
    // On its own short leash, as the harness's own pictures are: a picture
    // must never be what a step spends its time on.
    await page.screenshot({ path: join(SHOTS, file), timeout: 8000 });
  } catch {
    // A picture that cannot be taken must never be why a step failed.
  }
}

/** ONE STEP: a picture before, the step, a picture after — the after picture
 *  taken whether it passed or not, and named in the failure. */
function walk(n: string, name: string, run: () => Promise<void>, ms = 120000): void {
  const file = `chat-${n.padStart(2, "0")}`;
  test.if(unix)(`${n}. ${name}`, async () => {
    if (fatal !== null) throw new Error(`skipped: the walk could not begin — ${fatal}`);
    await shot(`${file}-before.png`);
    try {
      await step(`${n}. ${name}`, `${file}-after.png`, log, run);
    } finally {
      await shot(`${file}-after.png`);
    }
  }, ms);
}

const at = (hash: string): string => `${base}/?vault=${encodeURIComponent(vault)}${hash}`;
const hash = async (): Promise<string> => page.evaluate(() => location.hash);
const routeOf = (id: string, screen = ""): string => `#/page/${encodeURIComponent(id)}${screen === "" ? "" : "/" + screen}`;

/** A call made FROM THE PAGE, with its own cookie, as the app makes one — and
 *  with no window, so nothing it does is stamped as the person's. */
async function call<T = unknown>(kind: string, body: Record<string, unknown> = {}): Promise<T> {
  const env = await page.evaluate(async ([v, k, b]) => {
    const res = await fetch("/v/" + encodeURIComponent(v as string) + "/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "e2e-chat", g: 1, kind: k, ...(b as object) }),
    });
    return await res.json();
  }, [vault, kind, body] as const) as { ok: boolean; value?: T; error?: { code: string; message: string } };
  if (!env.ok) {
    const e = new Error(`${kind} refused: ${env.error?.code} ${env.error?.message}`) as Error & { code?: string };
    e.code = env.error?.code;
    throw e;
  }
  return env.value as T;
}

const summaryOf = async (id: string): Promise<ChatSummary | undefined> => (await call<ChatSummary[]>("chat.list")).find((c) => c.id === id);
/** The last prompt the scripted agent was handed, block by block, as its log
 *  heard it — empty before the first. */
const lastPrompt = (): string[] => {
  const heard = existsSync(fakeLog) ? readFileSync(fakeLog, "utf8").split("\n").filter((l) => l.includes('"method":"session/prompt"')) : [];
  const last = heard.at(-1);
  return last === undefined ? [] : (JSON.parse(last) as { params: { prompt: { text: string }[] } }).params.prompt.map((b) => b.text);
};
const readChat = (id: string): Promise<ChatRead> => call<ChatRead>("chat.read", { chat: id });
const promptsOf = async (id: string): Promise<string[]> =>
  (await readChat(id)).updates.filter((u) => u.kind === "prompt").map((u) => (u as { text: string }).text);
const agentState = async (): Promise<AgentInfo | undefined> => (await call<AgentInfo[]>("agents.list")).find((a) => a.key === AGENT);
const myWindow = async (): Promise<WindowContext | undefined> => {
  const id = await page.evaluate(() => sessionStorage.getItem("biom-window"));
  return (await call<WindowContext[]>("window.list")).find((w) => w.window === id);
};
const editsTo = async (path: string): Promise<Extract<HistoryEntry, { kind: "edit" }>[]> =>
  (await call<HistoryRead>("history.read")).entries.filter((e): e is Extract<HistoryEntry, { kind: "edit" }> => e.kind === "edit" && e.path === path);
/** Edits to a path by one chat's agent. */
const editsBy = async (path: string, chat: string): Promise<Extract<HistoryEntry, { kind: "edit" }>[]> =>
  (await editsTo(path)).filter((e) => e.writer.kind === "agent" && e.writer.chat === chat);

/** The look's box — whichever shape it is in, it is the one inside `.agentbox`.
 *  THE HANDLE IS LET GO AT ONCE: this is asked a few times a second for the
 *  whole walk, and every element handle kept is a remote object held in the
 *  runner for as long as the browser lives. */
async function lookFrame(): Promise<Frame> {
  const handle = await page.locator("div.agentbox iframe").elementHandle();
  try {
    const f = handle ? await handle.contentFrame() : null;
    if (!f) throw new Error("the look's box has no frame yet");
    return f;
  } finally {
    await handle?.dispose().catch(() => {});
  }
}
/** Read the look — it draws in a shadow root, which a locator pierces — or
 *  answer `fallback` while it is not there. */
async function inLook<T>(fn: (f: Frame) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn(await lookFrame());
  } catch {
    return fallback;
  }
}
const lookSays = (words: string): Promise<boolean> => inLook(async (f) => (await f.getByText(words, { exact: false }).count()) > 0, false);
/** The latest turn the look drew. */
const lastTurn = (f: Frame) => f.locator(".col > .turnw").last();
/** A chat's row in the look's list, and its lamp's class. */
const rowLamp = (name: string): Promise<string> =>
  inLook(async (f) => (await f.locator(".tlist .trow", { hasText: name }).first().locator(".led").getAttribute("class")) ?? "", "");
/** The lamp the host's own bar draws beside the chat on the Agent screen, or
 *  "" where it draws none — which is the light out. */
const crumbLamp = async (): Promise<string> => {
  const led = page.locator("button.crumb[aria-current=page] span.led");
  return (await led.count()) === 0 ? "" : ((await led.first().getAttribute("class")) ?? "").replace(/\s+/g, " ").trim();
};

/** The page on screen drew, and says these words. */
const pageSays = async (words: string): Promise<boolean> => {
  const text = await page.frameLocator("div.plate iframe.artifact").locator("body").innerText().catch(() => "");
  return text.includes(words);
};

/** Open a page as the person does: its row in the rail's tree. */
async function openByTree(name: string, id: string): Promise<void> {
  await page.locator("nav.rack li.treerow a", { hasText: name }).first().click();
  await until(`the tree opened ${name}`, 10000, async () => (await hash()) === routeOf(id));
}

/** THE PERSON'S HAND ON THE PAGE: a wheel over the page's own box, which is a
 *  trusted event inside it, which the shim reports as a touch — and never a
 *  click, which on a document page would open a paragraph for editing. */
async function touchPage(): Promise<void> {
  const r = await page.locator("div.plate iframe.artifact").boundingBox();
  if (r === null) throw new Error("no page box to touch");
  await page.mouse.move(r.x + r.width / 2, r.y + Math.min(160, r.height / 2));
  await page.mouse.wheel(0, 90);
  // The shim says it at once for the first of a kind in a second; the frame
  // host hands it to the switcher in the same task. A breath for the posts.
  await Bun.sleep(300);
}

/** Type into Biom's own input box and press Enter, as the person does. What
 *  is typed while a turn runs is queued behind it. */
async function typeAndEnter(words: string): Promise<void> {
  const input = page.locator("#agentta");
  await input.fill(words);
  await input.press("Enter");
}

/** Send a message that starts a turn — once this window's button is Send,
 *  with nothing typed. A turn the server has ended reaches the window a push
 *  later; typed in that gap the message still goes, but a step that means to
 *  start a turn waits until the window agrees there is none, so what it sends
 *  is never taken for a message queued behind one. */
async function send(words: string): Promise<void> {
  await until("this window's button is Send, not Stop", 10000, async () =>
    (await page.evaluate(() => document.querySelector(".agentdock .send")?.getAttribute("aria-label") ?? null)) === "Send");
  await typeAndEnter(words);
}

/** Wait for a chat's turn to be running, which is after this window sent. */
const running = (id: string, ms = 15000): Promise<void> =>
  until(`chat ${id}'s turn is running`, ms, async () => (await summaryOf(id))?.phase === "running");
/** Wait for a chat to be at rest after a turn. */
const idle = (id: string, ms = 30000): Promise<void> =>
  until(`chat ${id} came to rest`, ms, async () => (await summaryOf(id))?.phase === "idle");

/** Put chat X in the panel beside page A, as the person would: the rail's
 *  Agent (the full screen, with the chat this window last had open), then
 *  Minimize, which goes back beside the last page the history shows — and
 *  open A from the tree if that was another page. */
async function besideA(): Promise<void> {
  const w = await myWindow();
  if (!(w?.panel === true && w.chat === X)) {
    await page.locator("button.agentlink").click();
    await until("the Agent screen, with chat X", 10000, async () => (await hash()) === `#/agent/${X}`);
    await until("the look offers to minimise", 10000, async () => inLook(async (f) => (await f.locator("button.minbtn:not([hidden])").count()) === 1, false));
    await (await lookFrame()).locator("button.minbtn").click();
    await until("the chat is in the panel", 10000, async () => (await page.locator("div.bed").getAttribute("data-agent")) === "panel");
  }
  if ((await hash()) !== routeOf(A)) await openByTree("Alpha", A);
  await until("the context says X is in the panel beside A", 10000, async () => {
    const c = await myWindow();
    return c?.panel === true && c.chat === X && c.address.view === "page" && c.address.id === A && c.address.screen === "page";
  });
  await until("A drew", BOUNDS.draw, () => pageSays("Alpha"));
}

/** Everything the address bar showed, sampled until `done` or `ms`. Real time
 *  and the page's time run at one rate here: the clock is installed and only
 *  moved forward where a step says so. */
async function hashesUntil(done: (h: string) => boolean, ms: number): Promise<{ h: string; t: number }[]> {
  const seen: { h: string; t: number }[] = [];
  const stop = Date.now() + ms;
  for (;;) {
    const h = await hash();
    if (seen.length === 0 || (seen[seen.length - 1] as { h: string }).h !== h) seen.push({ h, t: Date.now() });
    if (done(h) || Date.now() >= stop) return seen;
    await Bun.sleep(60);
  }
}

/** One page document with a markdown body, whole, uid and all. */
function pageDoc(name: string, uid: string, body: string): string {
  return [
    `name: ${name}`,
    `uid: ${uid}`,
    "plugin: biom-doc",
    "contents:",
    "  - name: body",
    "    parts:",
    "      body: |",
    ...body.split("\n").map((l) => (l === "" ? "" : `        ${l}`)),
    "",
  ].join("\n");
}

/* ── the run ─────────────────────────────────────────────────────────────── */

/** THE SERVER, run as `make dev` runs it, on this walk's port — at the start,
 *  and again after a restart, which is a step of its own. */
async function startServer(): Promise<void> {
  const env = {
    // No agent of this machine's — bun and the system only, and /bin/sh as
    // the login shell (`withoutAgents`) — with the fake's place first.
    ...withoutAgents(box.env),
    PORT: String(port),
    PATH: [bin, withoutAgents(box.env).PATH].join(":"),
    BIOM_JEV_ENDPOINT: `http://127.0.0.1:${jev?.port}/v1/systemone`,
    TYPESAFE_API_KEY: KEY,
  };
  server = Bun.spawn([process.execPath, "run", join(HERE, "server", "main.ts")], { cwd: HERE, env, stdout: "pipe", stderr: "pipe" });
  drain(server.stdout as ReadableStream<Uint8Array>, "out");
  drain(server.stderr as ReadableStream<Uint8Array>, "err");
  await until("the server answered", BOUNDS.serve, async () => {
    try {
      return (await fetch(`${base}/`)).ok;
    } catch {
      return false;
    }
  });
}

/** The server stopped as the person's Ctrl-C stops it — asked of the system,
 *  not of Bun's handle, for the reason step 21 gives. */
async function stopServer(): Promise<void> {
  const pid = server!.pid;
  server!.kill("SIGTERM");
  await until("the server stopped", 20000, () => ended(pid));
}

beforeAll(async () => {
  if (!unix) return;
  shotsDir();
  box = sandbox("chat-walk");
  before = outside();
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  // THE MACHINE'S PATH HAS A PLACE FOR THE AGENT AND NO AGENT IN IT YET: the
  // fake is put there in step 3, which is the fresh machine's first minute.
  bin = join(box.root, "bin");
  mkdirSync(bin, { recursive: true });
  fakeLog = join(box.root, "fake.log");
  signedIn = join(box.root, "signed-in");
  writeFileSync(signedIn, "invented\n");

  // JEV, ON THIS MACHINE: the name's question lists topics and the turn's
  // lists faces; each is answered with one off its own list.
  jev = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { questions?: { answer?: { criteria?: Record<string, string> } } };
      const name = "tidy" in (body.questions?.answer?.criteria ?? {});
      return Response.json({ answers: { answer: { choice: name ? "tidy" : "success", confidence: 0.9 } } });
    },
  });

  await startServer();

  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  page = await context.newPage();
  // THIS WINDOW'S CLOCK, installed before anything loads: it runs at the rate
  // real time does until a step moves it forward.
  await page.clock.install();
}, 120000);

afterAll(async () => {
  await Promise.race([browser?.close().catch(() => {}), Bun.sleep(10000)]);
  if (server !== null && !ended(server.pid)) {
    const pid = server.pid;
    server.kill("SIGTERM");
    await until("the server stopped", 12000, () => ended(pid)).catch(() => server?.kill("SIGKILL"));
  }
  // Whatever a failed run left behind goes with it.
  for (const pid of fakePids()) if (alive(pid) && !ended(pid)) process.kill(pid, "SIGKILL");
  jev?.stop(true);
  if (box) {
    expect(outside()).toBe(before);
    box.clean();
  }
}, 60000);

/* ── 0 · a workspace, made through the page ──────────────────────────────── */

walk("0", "a throwaway workspace is made through the page, with four invented pages in it", async () => {
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await until("the picker was drawn", BOUNDS.draw, async () => (await page.locator("div.ports.vault").count()) > 0);
    const parent = join(box.root, "folders");
    mkdirSync(parent, { recursive: true });
    const answer = (await page.evaluate(async ([where, name]) => {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "e2e-create", g: 1, kind: "vault.create", parent: where, name }),
      });
      return await res.json();
    }, [parent, "Chat walk"])) as { ok: boolean; value?: { path?: string }; error?: { message?: string } };
    expect([answer.ok, answer.error?.message ?? ""]).toEqual([true, ""]);
    vault = answer.value?.path ?? "";
    expect(existsSync(join(vault, "pages", "home", "content.yaml"))).toBe(true);

    // FOUR PAGES, INVENTED, written as an agent outside the app would — each
    // with its identity, so the history can name it by its uid. Alpha links
    // Beta; Mover is a page whose own code tries to move the screen.
    const put = (id: string, file: string, text: string) => {
      const dir = join(vault, dirOf(id));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), text, "utf8");
    };
    put(A, "content.yaml", pageDoc("Alpha", "inventedalpha001", "# Alpha\n\ninvented-alpha-line\n\nAn invented page. Its neighbour is [[home/beta|Beta]]."));
    put(B, "content.yaml", pageDoc("Beta", "inventedbeta0001", "# Beta\n\ninvented-beta-line\n\nAn invented page the agent writes to."));
    put(C, "content.yaml", pageDoc("Gamma", "inventedgamma001", "# Gamma\n\nAn invented third page."));
    put(MOVER, "content.yaml", "name: Mover\nuid: inventedmover001\nplugin: html\n");
    put(MOVER, "index.html", [
      "<!doctype html><html><body>",
      '<p id="said">waiting</p>',
      "<script>",
      "  const say = (t) => { document.getElementById('said').textContent = t; };",
      "  biom.ready.then(() => biom.open({ kind: 'page', id: 'home/alpha' }))",
      "    .then(() => say('moved by itself'), (e) => say('refused: ' + e.code));",
      "</script></body></html>",
    ].join("\n"));

    // A window whose address names no screen opens on the Agent screen.
    await page.goto(at(""), { waitUntil: "domcontentloaded" });
    await until("the window opened on the Agent screen", BOUNDS.draw, async () => (await hash()) === "#/agent");
    await until("the tree lists the invented pages", BOUNDS.redraw, async () => {
      const rail = await page.locator("nav.rack").innerText().catch(() => "");
      return rail.includes("Alpha") && rail.includes("Beta") && rail.includes("Gamma");
    });
    await until("the look drew its start screen", BOUNDS.draw, () => lookSays("What should we"));
  } catch (e) {
    fatal = String((e as Error)?.message ?? e).split("\n")[0] ?? "step 0";
    throw e;
  }
});

/* ── 1 · the rail and the page bar ───────────────────────────────────────── */

walk("1", "the rail has Agent where Dashboard was and Home as the tree's heading; the page bar has the amber Edit, and no Agent Terminal and no dock", async () => {
  expect(await page.locator("button.dashboardlink").count()).toBe(0);
  expect(await page.locator("button.agentlink").count()).toBe(1);
  expect(await page.locator("button.agentlink").innerText()).toContain("Agent");
  // In Dashboard's slot: the rail's first row, above Home.
  expect(await page.evaluate(() => {
    const agent = document.querySelector("button.agentlink");
    const home = document.querySelector("div.railhead button.homerow");
    return agent !== null && home !== null && (agent.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  })).toBe(true);
  expect(await page.locator("div.railhead button.homerow").innerText()).toBe("Home");
  expect(await page.locator("button.agentlink").getAttribute("aria-current")).toBe("page");

  // A page's bar: Edit, amber — the palette's lamp — and nothing of the
  // terminal that was there.
  await openByTree("Alpha", A);
  await until("Alpha drew", BOUNDS.draw, () => pageSays("invented-alpha-line"));
  const edit = page.locator("span.tools button.tool.edit");
  expect(await edit.count()).toBe(1);
  expect((await edit.innerText()).trim()).toBe("Edit");
  const [ground, lamp] = await edit.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--led)";
    document.body.append(probe);
    const led = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).backgroundColor, led];
  });
  expect(ground).toBe(lamp);
  expect(await page.locator("span.tools").innerText()).not.toContain("Agent Terminal");
  expect(await page.locator("section.dock, div.work, div.dock").count()).toBe(0);
  // Home is the tree's own heading, and opens the root.
  await page.locator("div.railhead button.homerow").click();
  await until("Home opened the root page", 10000, async () => (await hash()) === "#/page/home");
  // From the start screen there is no chat to bring along.
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("none");
  await page.locator("button.agentlink").click();
  await until("Agent went back to the Agent screen", 10000, async () => (await hash()) === "#/agent");
});

/* ── 3 · the fresh machine's first message ───────────────────────────────── */

const FIRST = "An invented first message, sent before this machine has any agent";

walk("3", "a first message on a machine with no agent is held, More agents says it waits, and it goes out on its own once an agent is found and Active", async () => {
  await until("the agents are known, and there are none", 30000, async () =>
    (await call<AgentInfo[]>("agents.list")).length === 0 && (await page.locator(".agentdock .agentchip").innerText()).includes("No agent yet"));
  await send(FIRST);
  await until("the message made a chat", 10000, async () => /^#\/agent\/[A-Za-z0-9_-]{8,}$/.test(await hash()));
  heldChat = (await hash()).split("/")[2] as string;
  expect((await summaryOf(heldChat))?.phase).toBe("held");
  await until("More agents opened, saying the message waits", 15000, async () =>
    (await page.locator(".amodal p.why").innerText().catch(() => "")) === "Your message is waiting. Install an agent and it goes out.");
  await until("the look says it waits", 10000, () => lookSays("Waiting for an agent to be ready"));
  await Bun.sleep(800);
  await shot("chat-03-held.png");

  // THE MACHINE GETS AN AGENT. Nobody presses anything: discovery looks again
  // on a list once its last look is thirty seconds old, finds the new
  // command, probes it, and the held message goes out the moment it is Active.
  putFake(scenario());
  await until("the new agent was found and is Active", 90000, async () => {
    await Bun.sleep(900);
    return (await agentState())?.state === "active";
  });
  await until("the held message went out, and its turn ended", 45000, async () => (await summaryOf(heldChat))?.stop === "end_turn");
  await until("More agents shut when it went", 10000, async () => (await page.locator(".amodal").count()) === 0);
  expect(await promptsOf(heldChat)).toEqual([FIRST]);
  // Sent once.
  const reply = (await readChat(heldChat)).updates.filter((u) => u.kind === "reply").map((u) => (u as { text: string }).text).join("");
  expect(reply).toBe(`echo: ${FIRST}`);
}, 200000);

const CHECKING = "An invented message sent while the agent is still being checked";

walk("3b", "a first message to an agent still being checked is held with More agents saying so, and goes out once it is Active", async () => {
  // THE AGENT IS LOOKED AT AGAIN, AND SLOWLY: its `initialize` answers after
  // five seconds, so for that long it is Inactive and being checked.
  putFake(scenario(signInOk(), { initialize: { delayMs: 5000 } }));
  try {
    await (await lookFrame()).locator("button.newthread").click();
    await until("the start screen", 10000, async () => (await hash()) === "#/agent");
    await call("agents.probe", { agent: AGENT });
    await until("the agent is being checked", 10000, async () => (await agentState())?.reason === "checking");
    await send(CHECKING);
    await until("the message made a chat", 10000, async () => /^#\/agent\/[A-Za-z0-9_-]{8,}$/.test(await hash()));
    const id = (await hash()).split("/")[2] as string;
    // Held — not started past the check — and More agents says it waits.
    const phases: string[] = [];
    await until("More agents opened, saying the message waits for the agent", 6000, async () => {
      const p = (await summaryOf(id))?.phase ?? "?";
      if (phases.at(-1) !== p) phases.push(p);
      return (await page.locator(".amodal p.why").innerText().catch(() => "")).startsWith("Your message is waiting for Claude Code to be ready");
    });
    // Held from the first look, and never started while the check ran: the
    // chat's own process begins only once the probe has made the agent Active.
    expect(phases[0]).toBe("held");
    await until("the agent turned Active", 15000, async () => (await agentState())?.state === "active");
    await until("the message went out once the agent was Active", 45000, async () => (await summaryOf(id))?.stop === "end_turn");
    await until("More agents shut when it went", 10000, async () => (await page.locator(".amodal").count()) === 0);
  } finally {
    putFake(scenario());
    await page.keyboard.press("Escape").catch(() => {});
    await until("the agent is Active again", 30000, async () => (await agentState())?.state === "active").catch(() => {});
  }
});

/* ── 2 · the start screen ────────────────────────────────────────────────── */

walk("2", "the start screen has the turning line, View chat history and Ask anything, and the chip names the harness, never a model", async () => {
  // A new thread, from the look's own list, onto the start screen.
  if ((await hash()) !== "#/agent") {
    await (await lookFrame()).locator("button.newthread").click();
    await until("the start screen", 10000, async () => (await hash()) === "#/agent");
  }
  await until("the look drew the start screen's line", 10000, () => lookSays("What should we"));
  const f = await lookFrame();
  const word = async () => ((await f.locator("h1.line .swap > span").last().textContent()) ?? "").trim();
  const first = await word();
  expect(["automate", "plan", "create", "visualize"]).toContain(first);
  // The word turns, on this window's clock.
  await page.clock.fastForward(2800);
  await until("the line's last word turned", 5000, async () => (await word()) !== first);
  expect(["automate", "plan", "create", "visualize"]).toContain(await word());
  expect(((await f.locator("button.histlink").textContent()) ?? "").trim()).toMatch(/^View chat history/);
  const input = page.locator("#agentta");
  expect(await input.getAttribute("placeholder")).toBe("Ask anything");
  await until("the agent chip names the harness, lit", 15000, async () =>
    (await page.locator(".agentdock .agentchip").innerText()).trim() === "Claude Code" &&
    (await page.locator(".agentdock .agentchip .led").getAttribute("class")) === "led lit");
  expect(await page.locator(".agentdock .agentchip").innerText()).not.toContain("Opus");
  // The model is a chip of its own, with the agent's own name for it.
  expect((await page.locator(".agentdock .chip[data-category=model]").innerText()).trim()).toBe("Opus (invented)");
});

/* ── 4 · a turn ──────────────────────────────────────────────────────────── */

walk("4", "a turn: the loader on the message, the light amber then green, the chat named in the history, one message at a time with the next queued, and Stop while it runs", async () => {
  await send("hello\n!sleep 2500");
  await until("the message made a chat", 10000, async () => /^#\/agent\/[A-Za-z0-9_-]{8,}$/.test(await hash()));
  turnChat = (await hash()).split("/")[2] as string;
  // WHILE IT RUNS: the loader on the person's message, the amber lamp on the
  // bar, Stop where Send was.
  await until("the loader shows on the message", 8000, () =>
    inLook(async (f) => (await lastTurn(f).locator(".u .mood .dm").count()) === 1, false));
  await until("the light is amber on the bar", 8000, async () => (await crumbLamp()) === "led lit pulse");
  expect((await page.locator(".agentdock .send").getAttribute("aria-label"))).toBe("Stop");
  await shot("chat-04-running.png");
  // ONE MESSAGE AT A TIME: a second send while it runs waits in the chat's
  // queue — and is taken out again here, so this turn stays the only one.
  const second = await call<{ queued: { id: string; place: number } | null }>("chat.send", { chat: turnChat, text: "A second invented message" });
  expect(second.queued?.place).toBe(1);
  await call("chat.unqueue", { chat: turnChat, queued: second.queued?.id });
  expect((await summaryOf(turnChat))?.queued).toBe(0);

  await until("the turn ended", 20000, async () => (await summaryOf(turnChat))?.stop === "end_turn");
  await until("the light is green on the bar", 8000, async () => (await crumbLamp()) === "led green");
  const name = (await summaryOf(turnChat))?.name ?? "";
  expect(name).not.toBe("");
  // The chat is in the look's history, by its name, lit green.
  await until("the chat is listed by its name, green", 8000, async () => (await rowLamp(name)) === "led green");
  expect((await page.locator(".agentdock .send").getAttribute("aria-label"))).toBe("Send");
  // The server has the reply; the look drawing its words is step 4a.
  const reply = (await readChat(turnChat)).updates.filter((u) => u.kind === "reply").map((u) => (u as { text: string }).text).join("");
  expect(reply.startsWith("echo: hello")).toBe(true);
  expect(await promptsOf(turnChat)).toEqual(["hello\n!sleep 2500"]);
});

walk("4a", "the words of a reply that arrives with the end of its turn are drawn in the look, live, with no reload", async () => {
  // Step 4's turn slept, then streamed its reply and ended a moment later, so
  // both reached the look in one patch — as a short reply from a real agent
  // does. It once failed exactly here: the prose finished empty and stayed so.
  await until("the look drew the reply's words", 5000, async () =>
    inLook(async (f) => ((await lastTurn(f).locator(".prose").textContent()) ?? "").includes("echo: hello"), false));
  // And again for the shortest turn that shows it, drawn live.
  await send("x\n!sleep 1500");
  await until("the second turn ended", 20000, async () => {
    const c = await summaryOf(turnChat);
    return c?.turn === 2 && c.stop === "end_turn";
  });
  await until("the look drew that reply's words too", 5000, async () =>
    inLook(async (f) => ((await lastTurn(f).locator(".prose").textContent()) ?? "").includes("echo: x"), false));
});

walk("4b", "Jev's faces: the chat's name gets one, and the finished turn's message keeps the last one", async () => {
  await until("the turn's face reached the message", 20000, () =>
    inLook(async (f) => (await lastTurn(f).locator(".u .mood .face").count()) === 1 && (await lastTurn(f).locator(".u .mood .dm").count()) === 0, false));
  const src = await inLook(async (f) => (await lastTurn(f).locator(".u .mood img").getAttribute("src")) ?? "", "");
  expect(src).toMatch(/^\/vendor\/noto\/[0-9a-f_]+\.webp$/);
  const name = (await summaryOf(turnChat))?.name ?? "";
  await until("the chat's row carries the name's face", 20000, () =>
    inLook(async (f) => (((await f.locator(".tlist .trow", { hasText: name }).first().locator(".emo").textContent()) ?? "").trim()) === "\u{1F9F9}", false));
  // The key is in nothing the server said.
  expect(said.out + said.err).not.toContain(KEY);
});

/* ── 5 · Stop ────────────────────────────────────────────────────────────── */

walk("5", "Stop: a long turn stopped from the input ends cancelled, and the light goes out", async () => {
  await send("Take your invented time\n!sleep 5000");
  await until("Send became Stop", 10000, async () => (await page.locator(".agentdock .send").getAttribute("aria-label")) === "Stop");
  await until("the light is amber", 8000, async () => (await crumbLamp()) === "led lit pulse");
  await page.locator(".agentdock .send").click();
  await until("the turn ended cancelled", 20000, async () => (await summaryOf(turnChat))?.stop === "cancelled");
  await until("the light went out", 8000, async () => (await crumbLamp()) === "");
  expect((await summaryOf(turnChat))?.light).toBe("none");
  await until("the look says it stopped", 8000, () => lookSays("Stopped. Nothing after this point was done."));
  const name = (await summaryOf(turnChat))?.name ?? "";
  expect(await rowLamp(name)).toBe("led none");
});

/* ── 6 · a red turn ──────────────────────────────────────────────────────── */

walk("6", "a red turn: an agent that crashes mid-turn turns the light red with the reason, and red stays until the next turn starts", async () => {
  await send("An invented turn that will not finish\n!crash");
  await until("the turn ended crashed", 20000, async () => (await summaryOf(turnChat))?.stop === "crashed");
  await until("the light is red on the bar", 8000, async () => (await crumbLamp()) === "led red");
  const name = (await summaryOf(turnChat))?.name ?? "";
  await until("the light is red in the history", 8000, async () => (await rowLamp(name)) === "led red");
  await until("the look says why", 8000, () => lookSays("The agent stopped answering mid-turn."));
  // RED STAYS: however long the window waits, until a turn starts.
  await page.clock.fastForward("11:00");
  await Bun.sleep(1500);
  expect(await crumbLamp()).toBe("led red");
  expect((await summaryOf(turnChat))?.light).toBe("error");
  await shot("chat-06-red.png");
  // The next turn starts — on a new agent, the last one having gone — and the
  // red goes with it.
  await send("Carry on, invented\n!sleep 1500");
  await until("the light is amber again", 15000, async () => (await crumbLamp()) === "led lit pulse");
  await until("the turn ended", 30000, async () => (await summaryOf(turnChat))?.stop === "end_turn");
  await until("the light is green", 8000, async () => (await crumbLamp()) === "led green");
});

/* ── 7 · tool lines ──────────────────────────────────────────────────────── */

walk("7", "tool lines: an edit tool call opens to its diff, the pages changed name the page with Edited and +N −M, and the write brings the page up beside the chat", async () => {
  expect(await hash()).toBe(`#/agent/${turnChat}`);
  const path = `${dirOf(A)}/content.yaml`;
  await send(`Tidy the invented Alpha page\n!edit ${path} invented-alpha-line=>rewritten-alpha-line`);
  await until("the turn ended", 30000, async () => (await summaryOf(turnChat))?.stop === "end_turn" && (await summaryOf(turnChat))?.turn === 6);
  expect(readFileSync(join(vault, path), "utf8")).toContain("rewritten-alpha-line");
  // ONE HISTORY EDIT, by the tool call, stamped with the chat's agent.
  const edits = await editsBy(path, turnChat);
  expect(edits.map((e) => e.via)).toEqual(["tool"]);
  // A MOVE OFF THE FULL AGENT SCREEN brings the page up with the chat in the
  // panel beside it — never a bare page with the chat gone.
  await until("the page came up beside the chat", 15000, async () => (await hash()) === routeOf(A));
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  await until("the context says the chat is in the panel", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === turnChat;
  });
  // THE CHAT IS DRAWN ONE WAY: the panel's head is its own controls, and
  // nothing in it picks how the chat is shown.
  const head = await inLook((f) => f.locator(".panelhead button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") || b.className)), [] as string[]);
  expect(head).toEqual(["tswitch", "New thread", "Open full size", "Close the chat"]);
  expect(await inLook((f) => f.locator(".g-look[data-view], .chatmore").count(), -1)).toBe(0);
  // THE TOOL LINE, closed, then open to its diff.
  const f = await lookFrame();
  const act = lastTurn(f).locator(".acts button.act").first();
  await until("the tool line drew", 10000, async () => (await act.count()) === 1 && (await act.getAttribute("data-state")) === "done");
  // Read as written, not as laid out: a turn is `content-visibility: auto`,
  // and one scrolled out of view for a frame has no rendered text.
  const said = async (sel: string) => ((await act.locator(sel).textContent()) ?? "").trim();
  expect(await said(".verb")).toBe("Edited");
  expect(await said(".obj")).toBe(path);
  expect(await said(".meta")).toBe("+1 −1");
  // The run is one line, shut; it opens to the line, which opens to its diff.
  const run = lastTurn(f).locator(".acts button.grp").first();
  expect(((await run.locator(".glabel").textContent()) ?? "").trim()).toBe("Used 1 tool");
  await run.click();
  await act.click();
  const detail = lastTurn(f).locator(".acts .detail").first();
  await until("the line opened to its diff", 5000, async () => !(await detail.isHidden()));
  // The rows keep the file's own indentation; what they say is the line.
  const squeeze = (rows: string[]) => rows.map((r) => r.replace(/\s+/g, ""));
  expect(squeeze(await detail.locator(".dl.del").allTextContents())).toEqual(["-invented-alpha-line"]);
  expect(squeeze(await detail.locator(".dl.add").allTextContents())).toEqual(["+rewritten-alpha-line"]);
  // THE PAGES THE TURN CHANGED, named.
  const changes = lastTurn(f).locator(".changes");
  await until("the pages changed drew", 8000, async () => (await changes.locator(".crow").count()) === 1);
  // Their words as written — the sheet sets the head in capitals.
  const words = async (sel: string) => ((await changes.locator(sel).textContent()) ?? "").trim();
  expect(await words(".chead")).toBe("1 page changed");
  expect(await words(".crow .pg")).toBe("Alpha");
  expect(await words(".crow .cverb")).toBe("Edited");
  expect(await words(".crow .cmeta")).toBe("+1 −1");
});

/* ── 8 · the / menu ──────────────────────────────────────────────────────── */

walk("8", "/ opens one list of the agent's commands and the workspace's skills, each once; /co narrows it with the first row lit; Enter puts /name in the input", async () => {
  const input = page.locator("#agentta");
  const sent = (await promptsOf(turnChat)).length;
  await input.click();
  await input.fill("");
  await input.pressSequentially("/");
  await until("the / menu opened", 10000, async () => (await page.locator("#agentslash .srow").count()) > 0);
  const all = await page.locator("#agentslash .srow .sn").allInnerTexts();
  expect(all).toContain("/code-review");
  expect(all).toContain("/compact");
  // A workspace skill the agent did not list is there; one it did is there once.
  expect(all).toContain("/biom-sections");
  expect(all.filter((n) => n === "/biom-pages")).toEqual(["/biom-pages"]);
  expect(new Set(all).size).toBe(all.length);
  await input.pressSequentially("co");
  await until("it narrowed to /co", 5000, async () => {
    const now = await page.locator("#agentslash .srow .sn").allInnerTexts();
    return now.length > 0 && now.every((n) => n.startsWith("/co"));
  });
  expect(await page.locator("#agentslash .srow").first().getAttribute("aria-selected")).toBe("true");
  const firstName = (await page.locator("#agentslash .srow .sn").first().innerText()).trim();
  await input.press("Enter");
  expect(await input.inputValue()).toBe(`${firstName} `);
  expect(await page.locator("#agentslash").isHidden()).toBe(true);
  // Nothing was sent.
  await Bun.sleep(500);
  expect((await promptsOf(turnChat)).length).toBe(sent);
  await input.fill("");
});

/* ── 9 · Edit ────────────────────────────────────────────────────────────── */

walk("9", "Edit on a page opens a new chat beside it with the input empty and the caret in it; the page goes to the agent with the first message and never into the bubble, not again for the same page, and again for another; the panel maximises to the Agent screen and minimises back beside the page", async () => {
  if ((await hash()) !== routeOf(A)) await openByTree("Alpha", A);
  await page.locator("span.tools button.tool.edit").click();
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  const input = page.locator("#agentta");
  await until("the input is empty, with the caret in it", 5000, async () =>
    (await input.inputValue()) === "" && (await input.evaluate((el) => document.activeElement === el)));
  await until("the panel is on a new thread", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === null;
  });
  const typed = "give it an invented subtitle";
  await input.pressSequentially(typed);
  await input.press("Enter");
  await until("the chat began beside the page", 10000, async () => ((await myWindow())?.chat ?? null) !== null);
  X = (await myWindow())?.chat as string;
  expect(X).not.toBe(turnChat);
  expect(await hash()).toBe(routeOf(A));
  expect((await summaryOf(X))?.page).toEqual({ view: "page", uid: "inventedalpha001", screen: "page" });
  expect(await promptsOf(X)).toEqual([typed]);

  // THE AGENT WAS HANDED THE PAGE: the words, then Biom's note naming Alpha.
  await until("the agent was handed the first message", 15000, () => lastPrompt()[0] === typed);
  const [, note] = lastPrompt();
  expect(lastPrompt().length).toBe(2);
  expect(note?.startsWith("<biom-context>")).toBe(true);
  expect(note?.endsWith("</biom-context>")).toBe(true);
  expect(note).toContain("“Alpha”");
  expect(note).toContain(dirOf(A));
  expect(note).toContain("the page itself");
  await idle(X);
  // THE PERSON NEVER SEES IT: the bubble's words are the words typed, and
  // nothing the look drew says the note. The bubble's own text, and not its
  // Jev face beside it, which may be an emoji.
  const bubble = () => inLook(async (f) => lastTurn(f).locator(".u").evaluate((el) => el.firstChild?.nodeValue ?? ""), "");
  await until("the look drew the message", 10000, async () => (await bubble()) !== "");
  expect(await bubble()).toBe(typed);
  const drawn = await inLook(async (f) => f.locator(".col").first().innerText(), null as string | null);
  expect(drawn).toContain(typed);
  expect(drawn).not.toContain("A note from Biom");
  expect(drawn).not.toContain("biom-context");

  // The same page again: the words alone.
  await send("and an invented second line");
  await until("the agent was handed the second message", 15000, () => lastPrompt()[0] === "and an invented second line");
  expect(lastPrompt()).toEqual(["and an invented second line"]);
  await idle(X);

  // Another page, the chat beside it: the note again, naming that page.
  await openByTree("Beta", B);
  await until("the context says X is beside Beta", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === X && w.address.id === B;
  });
  await send("and one about this page");
  await until("the agent was handed the third message", 15000, () => lastPrompt()[0] === "and one about this page");
  expect(lastPrompt().length).toBe(2);
  expect(lastPrompt()[1]).toContain("“Beta”");
  expect(lastPrompt()[1]).toContain(dirOf(B));
  await idle(X);
  expect(await promptsOf(X)).toEqual([typed, "and an invented second line", "and one about this page"]);
  await openByTree("Alpha", A);
  // Maximised to the Agent screen, with the chat; minimised back beside A.
  await (await lookFrame()).getByRole("button", { name: "Open full size" }).click();
  await until("the Agent screen, with the chat", 10000, async () => (await hash()) === `#/agent/${X}`);
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("screen");
  await until("the look offers to minimise beside Alpha", 10000, () =>
    inLook(async (f) => (await f.locator("button.minbtn").getAttribute("aria-label")) === "Minimize beside Alpha", false));
  await (await lookFrame()).locator("button.minbtn").click();
  await until("back beside Alpha", 10000, async () => (await hash()) === routeOf(A));
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  await until("the context says X is beside Alpha", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === X && w.address.id === A;
  });
});

walk("9b", "opening a page from the full Agent screen brings the open chat along in the panel beside it", async () => {
  await page.locator("button.agentlink").click();
  await until("the Agent screen, with chat X", 10000, async () => (await hash()) === `#/agent/${X}`);
  await page.locator("div.railhead button.homerow").click();
  await until("Home opened the root page", 10000, async () => (await hash()) === "#/page/home");
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  await until("the context says X came along", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === X && w.address.id === "home";
  });
  // And from the tree, the same.
  await page.locator("button.agentlink").click();
  await until("the Agent screen again", 10000, async () => (await hash()) === `#/agent/${X}`);
  await openByTree("Alpha", A);
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  expect((await myWindow())?.chat).toBe(X);
});

/* ── 10–16 · the switcher ────────────────────────────────────────────────── */

walk("10", "the switcher follows: the open chat's agent writes B while A is untouched since the message, and B comes up with the chat still beside it; Go back to A returns and goes", async () => {
  await besideA();
  await send(`Write the invented Beta notes\n!write ${B_NOTES} invented words from step ten`);
  await until("the screen moved to B", 20000, async () => (await hash()) === routeOf(B));
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  await until("the context says X is beside B", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === X && w.address.id === B;
  });
  // The write is one edit by fs, and the switcher's view is under X's agent.
  const edits = await editsBy(B_NOTES, X);
  expect(edits.map((e) => e.via)).toEqual(["fs"]);
  const agentId = (edits[0]?.writer as { agent?: string }).agent;
  const views = (await call<HistoryRead>("history.read")).entries.filter((e) => e.kind === "view" && e.writer.kind === "agent" && e.writer.chat === X);
  expect(views.length).toBeGreaterThan(0);
  expect((views.at(-1)?.writer as { agent?: string }).agent).toBe(agentId);
  // GO BACK TO, top left, naming the person's work.
  const back = page.locator("button.goback");
  await until("Go back to shows", 5000, async () => (await back.count()) === 1);
  expect((await back.innerText()).replace(/\s+/g, " ")).toContain("Go back to Alpha");
  // At the top left of the screen under the rail, not over the chat.
  const [b, canvas] = await Promise.all([back.boundingBox(), page.locator("div.canvas").boundingBox()]);
  expect(b !== null && canvas !== null && b.x - canvas.x < 120 && b.y < canvas.y + 60).toBe(true);
  await shot("chat-10-moved.png");
  await back.click();
  await until("back on A", 10000, async () => (await hash()) === routeOf(A));
  await until("Go back to went", 5000, async () => (await back.count()) === 0);
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
});

walk("10b", "a new file inside a page that was already there makes the pages changed say the page was Edited, not Created", async () => {
  // Step 10's turn wrote Beta's notes.md, new, beside Beta's own document.
  await until("the turn's pages changed name Beta, Edited", 5000, () =>
    inLook(async (f) => {
      const row = lastTurn(f).locator(".changes .crow");
      return ((await row.locator(".pg").textContent()) ?? "").trim() === "Beta" && ((await row.locator(".cverb").textContent()) ?? "").trim() === "Edited";
    }, false));
});

walk("11", "the switcher offers: A touched after the message, the agent writes B within two minutes, the screen stays and Go to B shows above the input; pressing it opens B", async () => {
  await besideA();
  await send(`Write the invented Beta notes after a while\n!sleep 4000\n!write ${B_NOTES} invented words from step eleven`);
  await running(X);
  await touchPage();
  await until("the write landed", 15000, async () => (await editsBy(B_NOTES, X)).length === 2);
  const follow = page.locator(".agentdock button.follow");
  await until("Go to page shows above the input", 5000, async () => !(await follow.isHidden()));
  expect((await follow.innerText()).replace(/\s+/g, " ")).toMatch(/Editing Beta\s*Go to page/);
  const [fb, composer] = await Promise.all([follow.boundingBox(), page.locator(".agentdock .composer").boundingBox()]);
  expect(fb !== null && composer !== null && fb.y + fb.height <= composer.y + 1).toBe(true);
  // It stays put: past the settle, still A.
  await Bun.sleep(1500);
  expect(await hash()).toBe(routeOf(A));
  await shot("chat-11-offered.png");
  await follow.click();
  await until("B opened", 10000, async () => (await hash()) === routeOf(B));
  await until("Go to page went", 5000, async () => follow.isHidden());
  expect(await page.locator("button.goback").count()).toBe(0);
});

walk("12", "the switcher after two idle minutes: A touched after the message, the window's clock moved on past two minutes, the write to B moves the screen", async () => {
  await besideA();
  await send(`Write the invented Beta notes after a long while\n!sleep 5000\n!write ${B_NOTES} invented words from step twelve`);
  await running(X);
  await touchPage();
  // TWO MINUTES AND TEN SECONDS, ON THIS WINDOW'S CLOCK, while the agent
  // sleeps: the touch is old by the time its write lands.
  await page.clock.fastForward("02:10");
  await until("the write landed", 15000, async () => (await editsBy(B_NOTES, X)).length === 3);
  await until("the screen moved to B", 10000, async () => (await hash()) === routeOf(B));
  expect(await page.locator(".agentdock button.follow").isHidden()).toBe(true);
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
});

walk("13", "sending hands the screen over: A touched, then a message sent, and the agent's write to B moves the screen", async () => {
  await besideA();
  await touchPage();
  await send(`Write the invented Beta notes now\n!write ${B_NOTES} invented words from step thirteen`);
  await until("the write landed", 15000, async () => (await editsBy(B_NOTES, X)).length === 4);
  await until("the screen moved to B", 15000, async () => (await hash()) === routeOf(B));
  expect(await page.locator(".agentdock button.follow").isHidden()).toBe(true);
});

walk("13b", "five minutes on screen with the window in front make the switcher's screen the person's: Go back to goes, and the history says so", async () => {
  expect(await hash()).toBe(routeOf(B));
  const back = page.locator("button.goback");
  await until("Go back to shows on the screen the switcher brought up", 5000, async () => (await back.count()) === 1);
  await page.bringToFront();
  expect(await page.evaluate(() => document.visibilityState === "visible" && document.hasFocus())).toBe(true);
  // FIVE MINUTES AND A LITTLE, on this window's clock.
  await page.clock.fastForward("05:05");
  await until("Go back to went: the screen is the person's now", 5000, async () => (await back.count()) === 0);
  const me = await page.evaluate(() => sessionStorage.getItem("biom-window"));
  await until("the history's latest view of this window is the person's, on B", 5000, async () => {
    const views = (await call<HistoryRead>("history.read")).entries.filter((e) => e.kind === "view" && e.window === me);
    const last = views.at(-1) as Extract<HistoryEntry, { kind: "view" }> | undefined;
    return last !== undefined && last.writer.kind === "you" && last.place.view === "page" && (last.place as { uid?: string }).uid === "inventedbeta0001";
  });
});

walk("14", "a held screen: on A's Automations, the agent's write to B never moves the screen, and is only offered", async () => {
  await besideA();
  await page.locator("span.tools button.tool", { hasText: "Automations" }).first().click();
  await until("A's Automations", 10000, async () => (await hash()) === routeOf(A, "automation"));
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  await send(`Write the invented Beta notes from the automations\n!write ${B_NOTES} invented words from step fourteen`);
  await until("the write landed", 15000, async () => (await editsBy(B_NOTES, X)).length === 5);
  const follow = page.locator(".agentdock button.follow");
  await until("Go to page shows", 5000, async () => !(await follow.isHidden()));
  expect((await follow.innerText()).replace(/\s+/g, " ")).toMatch(/Editing Beta\s*Go to page/);
  // PAST THE SETTLE AND PAST TWO MINUTES: still held.
  await Bun.sleep(1000);
  await page.clock.fastForward("02:30");
  await Bun.sleep(1500);
  expect(await hash()).toBe(routeOf(A, "automation"));
  await shot("chat-14-held.png");
});

walk("14a", "Go to page never covers the chat: the look is told the room the pill takes above the input, so its last line stays readable", async () => {
  const follow = page.locator(".agentdock button.follow");
  expect(await follow.isHidden()).toBe(false);
  const pill = await follow.boundingBox();
  // Both boxes in the page's own coordinates: Playwright measures an element
  // in a frame against the top page.
  const foot = await inLook(async (f) => lastTurn(f).locator(".tfoot").boundingBox(), null);
  expect(pill !== null && foot !== null).toBe(true);
  const p = pill as { x: number; y: number; width: number; height: number };
  const t = foot as { x: number; y: number; width: number; height: number };
  const overlaps = p.y < t.y + t.height && t.y < p.y + p.height && p.x < t.x + t.width && t.x < p.x + p.width;
  expect({ pill: p, lastLine: t, overlaps }).toEqual({ pill: p, lastLine: t, overlaps: false });
});

walk("14b", "Go to page, pressed on a held screen, opens the page it offers", async () => {
  const follow = page.locator(".agentdock button.follow");
  await follow.click();
  await until("B opened", 10000, async () => (await hash()) === routeOf(B));
  await until("Go to page went", 5000, async () => follow.isHidden());
});

walk("15", "a chat in the background never moves the screen or offers it; nor does the open chat once its panel is shut", async () => {
  await besideA();
  // CHAT Y, begun in the panel and then put in the background by opening X
  // again from the panel's own list.
  const f = await lookFrame();
  await f.getByRole("button", { name: "New thread" }).first().click();
  await until("the panel is on a new thread", 10000, async () => (await myWindow())?.chat === null);
  await send(`Invented background work\n!sleep 5000\n!write ${B_NOTES} invented words from chat Y`);
  await until("chat Y began in the panel", 10000, async () => {
    const c = (await myWindow())?.chat ?? null;
    return c !== null && c !== X;
  });
  Y = (await myWindow())?.chat as string;
  await running(Y);
  const xName = (await summaryOf(X))?.name ?? "";
  await (await lookFrame()).locator("button.tswitch").click();
  await until("the panel's list opened", 5000, () => inLook(async (g) => (await g.locator(".menu .mi", { hasText: xName }).count()) > 0, false));
  await (await lookFrame()).locator(".menu .mi", { hasText: xName }).first().click();
  await until("X is in the panel again", 10000, async () => (await myWindow())?.chat === X);
  const follow = page.locator(".agentdock button.follow");
  await until("Y's write landed", 15000, async () => (await editsBy(B_NOTES, Y)).length === 1);
  // PAST THE SETTLE: nothing moved, nothing offered.
  await Bun.sleep(1500);
  await page.clock.fastForward("00:06");
  await Bun.sleep(1000);
  expect(await hash()).toBe(routeOf(A));
  expect(await follow.isHidden()).toBe(true);
  expect(await page.locator("button.goback").count()).toBe(0);

  // X WRITES WITH ITS PANEL SHUT.
  await send(`Write the invented Beta notes with the panel shut\n!sleep 4000\n!write ${B_NOTES} invented words from step fifteen`);
  await running(X);
  await (await lookFrame()).getByRole("button", { name: "Close the chat" }).click();
  await until("the panel shut", 10000, async () => (await page.locator("div.bed").getAttribute("data-agent")) === "none");
  await until("X's write landed", 15000, async () => (await editsBy(B_NOTES, X)).length === 6);
  await Bun.sleep(1500);
  await page.clock.fastForward("00:06");
  await Bun.sleep(1000);
  expect(await hash()).toBe(routeOf(A));
  expect(await page.locator("button.goback").count()).toBe(0);
});

walk("16", "no bounce: two writes a second apart move the screen once, the second is decided when five seconds have passed, and Back never walks through the moves", async () => {
  await besideA();
  // The settle after the person's own last move is spent first, so the first
  // write is followed at once.
  await page.clock.fastForward("00:06");
  // Watched from before the send: the first move can land within a breath of it.
  const watching = hashesUntil((h) => h === routeOf(C), 25000);
  await send(`Write two invented notes\n!write ${B_NOTES} invented words from step sixteen\n!sleep 1000\n!write ${C_NOTES} invented words from step sixteen`);
  const seen = await watching;
  const hashes = seen.map((s) => s.h);
  expect(hashes).toEqual([routeOf(A), routeOf(B), routeOf(C)]);
  const tB = (seen[1] as { t: number }).t;
  const tC = (seen[2] as { t: number }).t;
  // The second write came a second after the first and waited out the settle.
  expect(tC - tB).toBeGreaterThanOrEqual(4500);
  expect((await editsBy(C_NOTES, X)).length).toBe(1);
  // BACK LANDS ON THE PERSON'S WORK, never on B, which the switcher brought up.
  await page.evaluate(() => history.back());
  const after = await hashesUntil((h) => h === routeOf(A), 10000);
  expect(after.map((s) => s.h).at(-1)).toBe(routeOf(A));
  expect(after.map((s) => s.h)).not.toContain(routeOf(B));
});

/* ── 17 · a shell write ──────────────────────────────────────────────────── */

walk("17", "a shell write: `sed -i` in the agent's own shell is one history edit by `shell`, and the switcher follows it", async () => {
  await besideA();
  const path = `${dirOf(B)}/content.yaml`;
  await send(`Rename a line with the shell\n!sh sed -i 's/invented-beta-line/rewritten-beta-line/' ${path}`);
  await until("the file changed", 15000, () => readFileSync(join(vault, path), "utf8").includes("rewritten-beta-line"));
  await idle(X);
  const edits = await editsTo(path);
  expect(edits.map((e) => [e.via, e.writer.kind === "agent" ? e.writer.chat : e.writer.kind])).toEqual([["shell", X]]);
  await until("the screen moved to B", 15000, async () => (await hash()) === routeOf(B));
  await until("B drew its new line", BOUNDS.redraw, () => pageSays("rewritten-beta-line"));
});

const D = "home/delta";
const E = "home/epsilon";

walk("17b", "a page the agent creates is one history edit naming it by its uid, reads Created, and the switcher brings it up beside the chat", async () => {
  await besideA();
  const path = `${dirOf(D)}/content.yaml`;
  await send(`Make an invented page\n!write ${path} {name: Delta, uid: inventeddelta001, plugin: biom-doc, contents: [{name: body, parts: {body: "# Delta"}}]}`);
  await until("the page is on disk", 15000, () => existsSync(join(vault, path)));
  await idle(X);
  const edits = await editsBy(path, X);
  expect(edits.map((e) => [e.via, e.place])).toEqual([["fs", { view: "page", uid: "inventeddelta001", screen: "page" }]]);
  // THE SWITCHER FOLLOWS IT, once the window's tree has listed the page.
  await until("the screen moved to the new page", 15000, async () => (await hash()) === routeOf(D));
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  expect((await myWindow())?.chat).toBe(X);
  await until("Delta drew", BOUNDS.draw, () => pageSays("Delta"));
  expect(await page.locator("nav.rack").innerText()).toContain("Delta");
  await until("the turn's pages changed name it, Created", 10000, () =>
    inLook(async (f) => {
      const row = lastTurn(f).locator(".changes .crow");
      return ((await row.locator(".pg").textContent()) ?? "").trim() === "Delta" && ((await row.locator(".cverb").textContent()) ?? "").trim() === "Created";
    }, false));
});

walk("17c", "a page the agent creates with its own edit tool and no uid gets one at once, written in as one line, and is followed all the same", async () => {
  await besideA();
  const path = `${dirOf(E)}/content.yaml`;
  // The agent's own edit tool makes the file, with a comment of its own and
  // no identity; `\\n` is a new line to the fake.
  const written = "name: Epsilon\n# an invented comment the agent keeps\nplugin: biom-doc\n";
  await send(`Make another invented page, with no identity\n!edit ${path} =>${written.replace(/\n/g, "\\n")}`);
  await until("the page is on disk", 15000, () => existsSync(join(vault, path)));
  await idle(X);
  await until("the screen moved to the new page", 15000, async () => (await hash()) === routeOf(E));
  // ITS IDENTITY IS WRITTEN BACK AS ONE LINE under its name, and every other
  // byte the agent wrote is where it wrote it.
  const now = readFileSync(join(vault, path), "utf8");
  const uid = /^uid:\s*(\S+)$/m.exec(now)?.[1] ?? "";
  expect(uid).toMatch(/^[a-z0-9]{8,32}$/);
  expect(now).toBe(written.replace("name: Epsilon\n", `name: Epsilon\nuid: ${uid}\n`));
  const edits = await editsBy(path, X);
  expect(edits.map((e) => [e.via, e.place])).toEqual([["tool", { view: "page", uid, screen: "page" }]]);
});

/* ── 18 · addresses ──────────────────────────────────────────────────────── */

walk("18", "a reload and Back land on a page, its Instructions, its Automations, the Agent screen with a chat, and Design", async () => {
  await openByTree("Alpha", A);
  const reloadLands = async (want: string, drawn: () => Promise<boolean>, what: string) => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await until(`the reload landed on ${what}`, BOUNDS.draw, async () => (await hash()) === want && (await drawn()));
  };
  const pressed = (word: string) => async () =>
    (await page.locator("span.tools button.tool[aria-pressed='true']", { hasText: word }).count()) === 1;

  await reloadLands(routeOf(A), () => pageSays("Alpha"), "the page");
  await page.locator("span.tools button.tool", { hasText: "Instructions" }).first().click();
  await until("A's Instructions", 10000, async () => (await hash()) === routeOf(A, "instructions"));
  await reloadLands(routeOf(A, "instructions"), pressed("Instructions"), "the page's Instructions");
  await page.locator("span.tools button.tool", { hasText: "Automations" }).first().click();
  await until("A's Automations", 10000, async () => (await hash()) === routeOf(A, "automation"));
  await reloadLands(routeOf(A, "automation"), pressed("Automations"), "the page's Automations");
  await page.locator("button.agentlink").click();
  await until("the Agent screen, with chat X", 10000, async () => (await hash()) === `#/agent/${X}`);
  await reloadLands(`#/agent/${X}`, async () =>
    (await page.locator("div.bed").getAttribute("data-agent")) === "screen" && (await lookSays("give it an invented subtitle")), "the Agent screen with its chat");
  await page.locator("nav.rack div.rackfoot li.treerow a", { hasText: "Design" }).first().click();
  await until("Design", 10000, async () => (await hash()) === "#/design");
  await reloadLands("#/design", () => pageSays("How this workspace looks is decided here"), "Design");

  // BACK, through every one of them, in the order they were opened.
  for (const [want, what] of [[`#/agent/${X}`, "the Agent screen"], [routeOf(A, "automation"), "Automations"], [routeOf(A, "instructions"), "Instructions"], [routeOf(A), "the page"]] as const) {
    await page.evaluate(() => history.back());
    await until(`Back landed on ${what}`, BOUNDS.draw, async () => (await hash()) === want);
  }
  await until("A drew", BOUNDS.draw, () => pageSays("Alpha"));
});

/* ── 19 · sign-in ────────────────────────────────────────────────────────── */

walk("19", "sign-in: the picker's Sign in runs the agent's own command in the pop-up, which closes on exit 0 with the agent Active; a command that exits 1 leaves it open with the reason", async () => {
  await page.locator("button.agentlink").click();
  await until("the Agent screen", 10000, async () => (await hash()).startsWith("#/agent"));
  await (await lookFrame()).locator("button.newthread").click();
  await until("the start screen", 10000, async () => (await hash()) === "#/agent");

  // SIGNED OUT, as the agent says when it refuses a session.
  rmSync(signedIn, { force: true });
  await call("agents.probe", { agent: AGENT });
  await until("the agent asks to be signed in", 30000, async () => (await agentState())?.reason === "signin");
  await until("the chip's lamp is out", 10000, async () => (await page.locator(".agentdock .agentchip .led").getAttribute("class")) === "led");
  await page.locator(".agentdock .agentchip").click();
  // A button of its own beside the agent's row, in the menu's arrow ring, so
  // the keyboard reaches it.
  const pill = page.locator(`.agentmenu .mipair:has(.mi[data-agent=${AGENT}]) button.mact[data-act=signin]`);
  await until("the picker shows Sign in", 5000, async () => (await pill.count()) === 1);
  expect((await pill.innerText()).trim()).toBe("Sign in");
  await pill.click();
  // THE POP-UP, running the agent's own command, which prints.
  const popup = page.locator("div.signterm");
  await until("the pop-up opened and the command printed", 15000, async () =>
    (await popup.count()) === 1 && (await popup.locator(".xterm-rows").innerText().catch(() => "")).includes("Signing in to the invented agent"));
  await shot("chat-19-signing-in.png");
  await until("the pop-up closed on its own when the command exited 0", 20000, async () => (await popup.count()) === 0);
  expect(existsSync(signedIn)).toBe(true);
  await until("the agent is Active", 30000, async () => (await agentState())?.state === "active");
  await until("the chip's lamp is lit", 10000, async () => (await page.locator(".agentdock .agentchip .led").getAttribute("class")) === "led lit");
  if ((await page.locator(".amodal").count()) > 0) await page.locator(".amodal button.x").click();

  // A SIGN-IN THAT FAILS: the pop-up stays with its output and the reason.
  putFake(scenario(signInFails()));
  try {
    rmSync(signedIn, { force: true });
    await call("agents.probe", { agent: AGENT });
    await until("the agent asks to be signed in again", 30000, async () => (await agentState())?.reason === "signin");
    await page.locator(".agentdock .agentchip").click();
    await until("the picker shows Sign in", 5000, async () => (await pill.count()) === 1);
    await pill.click();
    await until("the pop-up says the sign-in did not finish", 15000, async () =>
      (await popup.locator("p.signsaid").innerText().catch(() => "")) === "The sign-in did not finish: it exited with code 1.");
    expect(await popup.locator(".xterm-rows").innerText()).toContain("The invented sign-in was refused");
    await Bun.sleep(2000);
    expect(await popup.count()).toBe(1);
    await shot("chat-19-refused.png");
    await popup.locator("button.signclose").click();
    await until("Close took it down", 5000, async () => (await popup.count()) === 0);
    expect((await agentState())?.state).toBe("inactive");
  } finally {
    putFake(scenario());
    writeFileSync(signedIn, "invented\n");
    if ((await page.locator(".amodal").count()) > 0) await page.locator(".amodal button.x").click().catch(() => {});
    await call("agents.probe", { agent: AGENT }).catch(() => {});
    await until("the agent is Active again", 30000, async () => (await agentState())?.state === "active").catch(() => {});
  }
});

/* ── 20 · a page cannot move the screen ──────────────────────────────────── */

walk("20", "a page's own code cannot move the screen, and a wikilink the person clicks can", async () => {
  await page.goto(at(routeOf(MOVER)), { waitUntil: "domcontentloaded" });
  await until("the page's own open was refused", BOUNDS.draw, async () =>
    (await page.frameLocator("div.plate iframe.artifact").locator("#said").innerText().catch(() => "")) === "refused: identity");
  await Bun.sleep(500);
  expect(await hash()).toBe(routeOf(MOVER));

  await openByTree("Alpha", A);
  const link = page.frameLocator("div.plate iframe.artifact").locator("a[data-g-link]", { hasText: "Beta" });
  await until("Alpha drew its link", BOUNDS.draw, async () => (await link.count()) === 1);
  await link.click();
  await until("the person's click moved the screen", 10000, async () => (await hash()) === routeOf(B));
});

walk("20b", "a page route naming a framework screen's reserved id — @agent, @map, @design — is no page", async () => {
  for (const id of ["@agent", "@map", "@design"]) {
    await page.goto(at(routeOf(id)), { waitUntil: "domcontentloaded" });
    await until(`${id} is said to be no page, and no box is mounted for it`, BOUNDS.draw, async () =>
      (await page.locator("div.plate").innerText().catch(() => "")).includes(`There is no page called “${id}”.`) &&
      (await page.locator("div.plate iframe.artifact").count()) === 0);
    // The one Agent screen box is still the only one there is.
    expect(await page.locator("div.agentbox iframe").count()).toBeLessThanOrEqual(1);
  }
});

walk("20c", "a page on another localhost port gets nothing from this server with the person's cookie, while this window's own calls go through", async () => {
  // ANOTHER DEVELOPMENT SERVER ON THIS MACHINE. The browser hands it this
  // server's cookie, because a site ignores the port; the server has to refuse
  // it by what the browser will not let the page forge.
  const other = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(`<!doctype html><html><body><p id="said">waiting</p><script>
      const api = ${JSON.stringify(`${base}/v/${encodeURIComponent(vault)}`)};
      const said = [];
      // The stream, as a window: it would list this window if the server took it.
      const es = new EventSource(api + "/events?window=invented-foreign-window-0001", { withCredentials: true });
      es.onerror = () => { said.push("stream refused"); es.close(); };
      // A chat made with words, in the one form the browser lets a page send
      // across ports unasked.
      fetch(api + "/api/call", { method: "POST", mode: "no-cors", credentials: "include",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ id: "x", g: 1, kind: "chat.new", agent: "claude-acp", text: "invented words from another port" }) })
        .then(() => said.push("sent"), () => said.push("send failed"))
        .finally(() => { document.getElementById("said").textContent = said.join(", "); });
    </script></body></html>`, { headers: { "content-type": "text/html" } }),
  });
  try {
    const before = (await call<ChatSummary[]>("chat.list")).length;
    const foreign = await page.context().newPage();
    try {
      // The cookie is the person's: this very browser holds it for 127.0.0.1.
      expect((await page.context().cookies(base)).length).toBeGreaterThan(0);
      await foreign.goto(`http://127.0.0.1:${other.port}/`, { waitUntil: "domcontentloaded" });
      await until("the other page tried both", 10000, async () => (await foreign.locator("#said").innerText()).includes("sent") || (await foreign.locator("#said").innerText()).includes("failed"));
      await Bun.sleep(1500);
    } finally {
      await foreign.close();
    }
    expect((await call<WindowContext[]>("window.list")).some((w) => w.window === "invented-foreign-window-0001")).toBe(false);
    expect((await call<ChatSummary[]>("chat.list")).length).toBe(before);
    expect((await call<ChatSummary[]>("chat.list")).some((c) => c.name.includes("another port"))).toBe(false);
    // And this window is none the worse: its own call still answers.
    expect((await myWindow())?.window).toBe(await page.evaluate(() => sessionStorage.getItem("biom-window")));
  } finally {
    other.stop(true);
  }
});

/* ── 21 · lastly ─────────────────────────────────────────────────────────── */

/* ── 20d · the choices kept ──────────────────────────────────────────────── */

const modeChip = async (): Promise<string> => ((await page.locator(".agentdock .chip[data-category=mode]").innerText().catch(() => "")) ?? "").trim();

/** THE START SCREEN, and nothing else: a window just loaded may still put
 *  back the chat it had open for the session as it comes up, so the address
 *  is asked for again until the window shows the start screen's input. */
async function startScreen(): Promise<void> {
  await page.goto(at("#/agent"), { waitUntil: "domcontentloaded" });
  await until("the start screen", BOUNDS.draw, async () => {
    if ((await hash()) !== "#/agent") await page.goto(at("#/agent"), { waitUntil: "domcontentloaded" });
    return (await hash()) === "#/agent" && (await page.locator("#agentta").getAttribute("placeholder")) === "Ask anything";
  });
}

/** A new chat from the start screen, sent and come to rest: its id. */
async function newChat(words: string): Promise<string> {
  await startScreen();
  await until("the agent is Active", 30000, async () => (await agentState())?.state === "active");
  await until("the start screen is ready to send", BOUNDS.draw, async () =>
    (await page.locator("#agentta").isVisible()) && (await page.locator(".agentdock .agentchip").innerText()).includes("Claude Code"));
  const was = new Set((await call<ChatSummary[]>("chat.list")).map((c) => c.id));
  await send(words);
  let made = "";
  await until("the message made a chat", 10000, async () => {
    const h = await hash();
    const id = /^#\/agent\/([A-Za-z0-9_-]{8,})$/.exec(h)?.[1] ?? "";
    if (id !== "" && !was.has(id)) made = id;
    return made !== "";
  });
  await idle(made);
  return made;
}

walk("20d", "the choices are kept: a mode picked in a chat holds across a server restart and a new chat, and across a reload", async () => {
  // In a chat, as the person picks it.
  await page.goto(at(`#/agent/${X}`), { waitUntil: "domcontentloaded" });
  await until("chat X drew", BOUNDS.draw, () => lookSays("give it an invented subtitle"));
  await until("its mode chip shows", 15000, async () => (await modeChip()) === "Ask (invented)");
  await page.locator(".agentdock .chip[data-category=mode]").click();
  await page.locator(".agentmenu button.mi[data-value=plan]").click();
  await until("the server kept it", 8000, async () => {
    const kept = await call<ChatSettings>("settings.read");
    return kept.agents[AGENT]?.mode === "plan" && kept.agent === AGENT;
  });
  // What is kept names no view: a chat is drawn one way.
  expect(Object.keys(await call<ChatSettings>("settings.read")).sort()).toEqual(["agent", "agents"]);

  /** What a person sees after `what`: the start screen's mode chip on the
   *  kept mode, and a new chat started on it. */
  const holds = async (what: string): Promise<void> => {
    await startScreen();
    await until(`${what}: the start screen's mode chip is the kept one`, 30000, async () => (await modeChip()) === "Plan (invented)");
    const chat = await newChat(`An invented new chat after ${what}`);
    const config = (await readChat(chat)).updates.filter((u) => u.kind === "config").pop() as { options: { id: string; value: unknown }[] } | undefined;
    expect([what, config?.options.find((o) => o.id === "mode")?.value]).toEqual([what, "plan"]);
  };
  // THE SERVER STARTS AGAIN, and reads what it kept. First, because step 19
  // leaves the agent waiting for a sign-in — a refusal that holds until a
  // sign-in or a restart — and a new chat here wants it Active.
  await stopServer();
  await startServer();
  // The capability cookie is minted per launch, so the window takes the new
  // server's by loading the page again.
  await page.reload({ waitUntil: "domcontentloaded" });
  await holds("a restart");
  // THE WINDOW RELOADS, and what was kept is still what it shows.
  await page.reload({ waitUntil: "domcontentloaded" });
  await holds("a reload");
});

/* ── 20e · a chat deleted ────────────────────────────────────────────────── */

walk("20e", "a chat deleted from its row's three dots, asked in Biom's own dialog: Cancel deletes nothing, Delete takes it from the history, from disk and from a reload", async () => {
  const keep = await newChat("An invented chat to keep");
  const gone = await newChat("An invented chat to delete");
  const goneName = (await summaryOf(gone))?.name ?? "";
  expect(goneName).not.toBe("");
  // The history is open beside the chat on the full screen.
  await until("both are listed", 8000, async () => (await rowLamp(goneName)) !== "" && (await summaryOf(keep)) !== undefined);
  const openMenu = async (): Promise<void> => {
    const f = await lookFrame();
    const row = f.locator(".tlist .trowbox", { hasText: goneName }).first();
    await row.hover();
    await row.locator("button.tmore").click();
    await f.locator(".rowmenu button.del").click();
    await until("Biom asks", 5000, async () => page.locator(".aask .cdialog").isVisible());
  };
  await openMenu();
  const dialog = page.locator(".aask .cdialog");
  expect((await dialog.locator("b").innerText()).trim()).toBe("Delete this chat?");
  expect((await dialog.locator("p").innerText()).trim()).toBe("It can’t be undone.");
  // Cancel holds the caret, and Cancel deletes nothing.
  expect(await page.evaluate(() => document.activeElement?.textContent ?? "")).toBe("Cancel");
  await shot("chat-20e-asked.png");
  await dialog.locator("button[data-answer=no]").click();
  await Bun.sleep(400);
  expect((await summaryOf(gone))?.id).toBe(gone);
  // Delete does.
  await openMenu();
  await page.locator(".aask .cdialog button[data-answer=yes]").click();
  await until("the chat is gone from the server", 8000, async () => (await summaryOf(gone)) === undefined);
  expect(existsSync(join(vault, ".biom", "chats", `${gone}.jsonl`))).toBe(false);
  expect(existsSync(join(vault, ".biom", "chats", `${keep}.jsonl`))).toBe(true);
  // The window had it open: the start screen, and the history without it.
  await until("the window went to the start screen", 8000, async () => (await hash()) === "#/agent");
  await until("the history no longer lists it", 8000, async () => (await rowLamp(goneName)) === "");
  await page.reload({ waitUntil: "domcontentloaded" });
  await until("after a reload, the kept chat is listed", BOUNDS.draw, async () => (await inLook(async (f) => f.locator(".tlist .trow").count(), 0)) > 0 || (await page.locator("#agentta").isVisible()));
  expect((await call<ChatSummary[]>("chat.list")).map((c) => c.id)).toContain(keep);
  expect((await call<ChatSummary[]>("chat.list")).map((c) => c.id)).not.toContain(gone);
  expect(await rowLamp(goneName)).toBe("");
});

/* ── 20f · the queue ─────────────────────────────────────────────────────── */

/** The queued messages the look draws under the running turn, as it words them. */
const bubbles = (): Promise<string[]> => inLook(async (f) => f.locator(".queue .qitem").allInnerTexts(), [] as string[]);
/** The latest turn of a chat is over, and it was this one. */
const turnEnded = async (id: string, turn: number): Promise<boolean> => {
  const s = await summaryOf(id);
  return s?.turn === turn && s.phase === "idle";
};

/** The chat the queue steps walk, made by 20f. */
let Q = "";

walk("20f", "a message sent while a turn runs waits in the queue under it and goes out when the turn ends; two queued and then Stop both go out, in order, with nothing held and no Send queued", async () => {
  await page.goto(at("#/agent"), { waitUntil: "domcontentloaded" });
  await until("the agent is Active", 30000, async () => (await agentState())?.state === "active");
  await until("the start screen is ready to send", BOUNDS.draw, async () => page.locator("#agentta").isVisible());
  await send("Queue walk a\n!sleep 3000");
  await until("the message made a chat", 10000, async () => /^#\/agent\/[A-Za-z0-9_-]{8,}$/.test(await hash()));
  Q = (await hash()).split("/")[2] as string;
  await running(Q);
  // B, sent while A runs: Queued, under the running turn.
  await typeAndEnter("Queue walk b\n!sleep 3000");
  await until("b shows Queued", 8000, async () => { const b = await bubbles(); return b.length === 1 && /Queued/i.test(b[0] ?? "") && (b[0] ?? "").includes("Queue walk b"); });
  expect(await promptsOf(Q)).toEqual(["Queue walk a\n!sleep 3000"]);
  await shot("chat-20f-queued.png");
  // A ends: B goes out on its own, and its bubble goes with it.
  await until("b went out when a ended", 20000, async () => (await promptsOf(Q)).length === 2 && (await bubbles()).length === 0);
  await running(Q);
  // C and D, queued behind B; then Stop, with nothing typed.
  await typeAndEnter("Queue walk c");
  await until("c shows Queued", 8000, async () => (await bubbles()).length === 1);
  await typeAndEnter("Queue walk d");
  await until("d shows Queued after c", 8000, async () => { const b = await bubbles(); return b.length === 2 && (b[0] ?? "").includes("Queue walk c") && (b[1] ?? "").includes("Queue walk d"); });
  await until("the button is Stop", 5000, async () => (await page.locator(".agentdock .send").getAttribute("aria-label")) === "Stop");
  await page.locator(".agentdock .send").click();
  // STOP ENDS THE TURN AND NOT THE QUEUE: B ends cancelled, and C then D go
  // out, one a turn, in the order they were queued — nothing held, no Send
  // queued at any point.
  const heldEver: boolean[] = [];
  await until("c and d went out after b, and d's turn ended", 30000, async () => {
    const s = await summaryOf(Q);
    heldEver.push(s?.queueHeld === true || (await page.locator(".agentdock .sendqueued").isVisible()));
    return turnEnded(Q, 4);
  });
  expect(heldEver.every((h) => !h)).toBe(true);
  expect(await promptsOf(Q)).toEqual(["Queue walk a\n!sleep 3000", "Queue walk b\n!sleep 3000", "Queue walk c", "Queue walk d"]);
  const ends = (await readChat(Q)).updates.filter((u) => u.kind === "turn" && (u as { phase: string }).phase === "idle").map((u) => (u as { stop: string }).stop);
  expect(ends).toEqual(["end_turn", "cancelled", "end_turn", "end_turn"]);
  expect([(await summaryOf(Q))?.queued, (await summaryOf(Q))?.queueHeld]).toEqual([0, false]);
  await until("no bubble is left", 5000, async () => (await bubbles()).length === 0);
  expect(await page.locator(".agentdock .sendqueued").isVisible()).toBe(false);
  await shot("chat-20f-stopped.png");
});

walk("20g", "Send now on the second of two queued messages stops the turn, sends that one first and then the other, with nothing held", async () => {
  expect(Q).not.toBe("");
  if ((await hash()) !== `#/agent/${Q}`) {
    await page.goto(at(`#/agent/${Q}`), { waitUntil: "domcontentloaded" });
    await until("the queue walk's chat drew", BOUNDS.draw, () => lookSays("Queue walk d"));
  }
  await send("Queue walk e\n!sleep 4000");
  await running(Q);
  await typeAndEnter("Queue walk f");
  await until("f shows Queued", 8000, async () => (await bubbles()).length === 1);
  await typeAndEnter("Queue walk g");
  await until("g shows Queued after f", 8000, async () => { const b = await bubbles(); return b.length === 2 && (b[0] ?? "").includes("Queue walk f") && (b[1] ?? "").includes("Queue walk g"); });
  // Each bubble carries its own Send now, a button beside its ×.
  const f = await lookFrame();
  const second = f.locator(".queue .qitem").nth(1);
  expect(await second.locator("button.qnow").getAttribute("aria-label")).toBe("Send now");
  expect(((await second.locator("button.qnow").textContent()) ?? "").trim()).toBe("Send now");
  expect(await f.locator(".queue button.qnow").count()).toBe(2);
  await shot("chat-20g-send-now.png");
  // SEND NOW ON THE SECOND: the turn stops as Stop stops it, g goes out the
  // moment it has ended, and f after it — nothing held on the way.
  await second.locator("button.qnow").click();
  const heldEver: boolean[] = [];
  await until("g then f went out, and f's turn ended", 30000, async () => {
    const s = await summaryOf(Q);
    heldEver.push(s?.queueHeld === true || (await page.locator(".agentdock .sendqueued").isVisible()));
    return turnEnded(Q, 7);
  });
  expect(heldEver.every((h) => !h)).toBe(true);
  expect((await promptsOf(Q)).slice(4)).toEqual(["Queue walk e\n!sleep 4000", "Queue walk g", "Queue walk f"]);
  const ends = (await readChat(Q)).updates.filter((u) => u.kind === "turn" && (u as { phase: string }).phase === "idle").map((u) => (u as { stop: string }).stop);
  expect(ends.slice(4)).toEqual(["cancelled", "end_turn", "end_turn"]);
  // Each went out once, g first.
  const out = (await readChat(Q)).updates.filter((u) => u.kind === "unqueued").map((u) => (u as { sent: boolean }).sent);
  expect(out.slice(-2)).toEqual([true, true]);
  await until("no bubble is left", 5000, async () => (await bubbles()).length === 0);
  await shot("chat-20g-sent.png");
});

walk("21", "nothing threw on stderr, nothing was written outside the sandbox, and no agent process is left once the server stops", async () => {
  expect(stackTraces(said.err)).toEqual([]);
  const pids = fakePids();
  // The probes, the held chat's, the turns', X's and Y's, at least.
  expect(pids.length).toBeGreaterThan(3);
  expect(pids.some(alive)).toBe(true);
  const t = Date.now();
  // Bounded: the stream closing is what matters, and a browser slow to go is
  // not what this step is about.
  const closed = await Promise.race([(browser?.close() ?? Promise.resolve()).then(() => true, () => true), Bun.sleep(10000).then(() => false)]);
  browser = null;
  console.log(`[chat.e2e] the browser ${closed ? "closed" : "had not closed"} in ${Date.now() - t}ms`);
  const t0 = Date.now();
  const pid = server!.pid;
  server!.kill("SIGTERM");
  // WHETHER IT STOPPED IS ASKED OF THE SYSTEM, not of Bun's handle: a process
  // that has exited and not yet been reaped is a zombie, and in a long run of
  // several files the runner was seen to hold its children's exits — the
  // browser's and the server's both — for tens of seconds after they went.
  await until("the server stopped on SIGTERM", 20000, () => ended(pid));
  const reaped = await Promise.race([server!.exited.then(() => true), Bun.sleep(3000).then(() => false)]);
  console.log(`[chat.e2e] the server stopped ${Date.now() - t0}ms after SIGTERM (${stateOf(pid) || "gone"}); the runner ${reaped ? "reaped it" : "had not reaped it yet"}`);
  await until("every fake agent is gone", 8000, () => pids.every((p) => !alive(p)));
  const listed = spawnSync("pgrep", ["-f", "fake-acp-agent.ts"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  expect(listed.filter((p) => pids.includes(p))).toEqual([]);
  expect(stackTraces(said.err)).toEqual([]);
  expect(outside()).toBe(before);
}, 60000);
