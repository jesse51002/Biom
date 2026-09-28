// SPDX-License-Identifier: AGPL-3.0-only
// A PAGE THE AGENT MAKES, ON A WORKSPACE THE SIZE OF A REAL ONE — the server
// run the way `make dev` runs it, the scripted ACP agent on its PATH, and a
// headless Chromium on the Agent screen, as `agent-screen.e2e.ts` runs them;
// what is different is the vault.
//
// WHY THIS FILE EXISTS. Every other walk runs on a vault of about four pages,
// and on one of those the window's tree lists a page an agent has just made a
// fraction of a second after the history names it. On the owner's workspace,
// about 1,870 pages, it took twelve: the history named the page about 40 ms
// after the write, the tree listed it only after the watcher's settle and a
// re-read of the whole tree, and the switcher had already dropped the write at
// five seconds — so "make me a page" never brought the page up. Nothing at
// four pages could see that. This walk makes the same shape of workspace and
// asks the same thing of it.
//
// THE VAULT IS WRITTEN STRAIGHT TO DISK BEFORE THE SERVER MOUNTS IT, because
// making two thousand pages through the wire would be most of the run. It is
// nested as a real one is — a few top-level pages, children, grandchildren and
// two levels of dated notes below them, each a plain `content.yaml` about the
// size of a real page, with an identity already in it — and it holds tables
// an agent made with its own SQL, as the owner's does: every page's children
// are read with the tables counted, which is part of why a real tree is slow.
//
// WHAT IT WALKS, in order:
//
//   1. A window on that workspace opens on the Agent screen, the agent Active
//      and the tree read.
//   2. A first message makes the chat, and its turn ends.
//   3. A page the agent makes in that chat, three levels down, is brought up
//      with the chat beside it and Go back to over it — within the bound
//      below, and the time it took is printed.
//
// Every page, word, table and id here is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { HERE, SHOTS, BOUNDS, sandbox, outside, freePort, until, step, shotsDir } from "./harness.ts";
import type { Sandbox } from "./harness.ts";
import { installFakeAgent } from "../fake-acp-agent.ts";
import type { AgentInfo, ChatSummary, WindowContext } from "../../contracts/types.ts";

const unix = process.platform !== "win32";
const AGENT = "claude-acp";

/** HOW LONG THE WINDOW MAY TAKE TO FOLLOW THE PAGE, from the write. The
 *  switcher's own ceiling on a write waiting for the tree, and generous on
 *  purpose: what this walk proves is that the page is followed at all on a
 *  workspace this size, and the time it took is printed beside it. A tree that
 *  stops reading the whole workspace on every change is what tightens it. */
const FOLLOW_MS = 60_000;

/** MOUNTING TWO THOUSAND PAGES the first time — the markdown mirror of every
 *  one, and the vault's first commit — is past `BOUNDS.serve`, which is a
 *  bound for a server answering and not for this. */
const MOUNT_MS = 180_000;

/* ── the invented workspace ──────────────────────────────────────────────── */

/** How many pages each level holds under every page of the one above it:
 *  eight top-level pages, eleven under each, then three, three and one — 1,944
 *  pages and the root, deepest where a real workspace is deepest. */
const SHAPE = [8, 11, 3, 3, 1] as const;
const TOPS = ["Ledger", "Harbour", "Orchard", "Foundry", "Almanac", "Lantern", "Quarry", "Meadow"];
const WORDS = "amber basalt cedar delta ember fjord granite harbour indigo juniper kestrel lantern meadow nimbus orchard pebble quartz river saffron thistle umber willow yarrow zephyr".split(" ");
/** Agent-made tables, as the owner's workspace holds twenty-six. */
const TABLES = 25;

const word = (i: number): string => WORDS[i % WORDS.length] as string;
const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const words = (seed: number, n: number): string => Array.from({ length: n }, (_, i) => word(seed * 7 + i * 3)).join(" ");

/** One page's document: a name, an identity, a doc page with a summary, a
 *  list of notes and one section — about twelve kilobytes, between the median
 *  page of the workspace this was measured on (nine) and its mean (sixteen). */
function docOf(name: string, n: number): string {
  const notes = Array.from({ length: 40 }, (_, i) => `    - ${JSON.stringify(words(n + i, 40))}`).join("\n");
  return [
    `name: ${name}`,
    `uid: invented${String(n).padStart(6, "0")}`,
    "plugin: biom-doc",
    "variables:",
    `  summary: ${JSON.stringify(words(n, 24))}`,
    "  notes:",
    notes,
    "contents:",
    "  - name: body",
    "    parts:",
    `      body: ${JSON.stringify(`# ${name}\n\n${words(n, 80)}`)}`,
    "",
  ].join("\n");
}

/** WRITE THE WORKSPACE, answering how many pages it holds and the id of one
 *  page two levels down, under which the agent will make its own. */
function invent(vault: string): { pages: number; under: string } {
  let n = 0;
  let under = "";
  const put = (dir: string, name: string): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "content.yaml"), docOf(name, n++), "utf8");
  };
  const down = (dir: string, id: string, depth: number): void => {
    const count = SHAPE[depth];
    if (count === undefined) return;
    for (let i = 0; i < count; i++) {
      // Top-level pages by name; the two levels below by a word and a number;
      // below those, dated notes, as a folder of decisions is kept.
      const name = depth === 0 ? (TOPS[i] as string)
        : depth < 3 ? `${title(word(n))} ${i + 1}`
        : `2026-${String((n % 12) + 1).padStart(2, "0")}-${String((n % 28) + 1).padStart(2, "0")} ${title(word(n))} ${title(word(n + 5))} ${i + 1}`;
      const seg = name.replace(/ /g, "_");
      const at = join(dir, "children", seg);
      put(at, name);
      if (depth === 1 && under === "") under = `${id}/${seg}`;
      down(at, `${id}/${seg}`, depth + 1);
    }
  };
  const home = join(vault, "pages", "home");
  put(home, "Home");
  down(home, "home", 0);

  // THE TABLES AN AGENT MADE WITH ITS OWN SQL, in the workspace's database
  // before the server has opened it; the server lists them as the agent's.
  const db = new Database(join(vault, "workspace.db"));
  try {
    for (let t = 0; t < TABLES; t++) {
      const name = `invented_${word(t)}_${t}`;
      db.run(`CREATE TABLE "${name}" (id INTEGER PRIMARY KEY, label TEXT, amount REAL)`);
      const row = db.prepare(`INSERT INTO "${name}" (label, amount) VALUES (?, ?)`);
      db.transaction(() => {
        for (let i = 0; i < 200; i++) row.run(`${word(t + i)} ${i}`, i * 1.5);
      })();
    }
  } finally {
    db.close();
  }
  return { pages: n, under };
}

/* ── the walk's furniture ────────────────────────────────────────────────── */

let box: Sandbox;
let before = "";
let base = "";
let vault = "";
let made = { pages: 0, under: "" };
let server: ReturnType<typeof Bun.spawn> | null = null;
const said = { out: "", err: "" };
let browser: Browser | null = null;
let page: Page;
/** The chat the walk is in. */
let chat = "";
/** Every tree read the window makes, `page.list` and `children.all`, with when
 *  it went and when its answer was in — printed beside the time it took. */
const reads: { kind: string; went: number; back: number | null }[] = [];

let broke: string | null = null;
const log = (): string => said.err;

function walk(name: string, shot: string, run: () => Promise<void>, ms = 120000): void {
  test.if(unix)(name, async () => {
    if (broke !== null) throw new Error(`skipped: an earlier step failed — ${broke}`);
    try {
      await step(name, shot, log, run);
    } catch (e) {
      await page?.screenshot({ path: join(SHOTS, shot), timeout: 8000 }).catch(() => {});
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

/** A call made FROM THE PAGE, with its own cookie, as the input box makes one. */
async function call<T = unknown>(kind: string, body: Record<string, unknown> = {}): Promise<T> {
  const env = await page.evaluate(async ([v, k, b]) => {
    const res = await fetch("/v/" + encodeURIComponent(v as string) + "/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "e2e-big", g: 1, kind: k, ...(b as object) }),
    });
    return await res.json();
  }, [vault, kind, body] as const) as { ok: boolean; value?: T; error?: { code: string; message: string } };
  if (!env.ok) throw new Error(`${kind} refused: ${env.error?.code} ${env.error?.message}`);
  return env.value as T;
}

const at = (hash: string) => `${base}/?vault=${encodeURIComponent(vault)}${hash}`;
const hash = async (): Promise<string> => page.evaluate(() => location.hash);
const summaryOf = async (id: string): Promise<ChatSummary | undefined> => (await call<ChatSummary[]>("chat.list")).find((c) => c.id === id);
const myWindow = async (): Promise<WindowContext | undefined> => {
  const id = await page.evaluate(() => sessionStorage.getItem("biom-window"));
  return (await call<WindowContext[]>("window.list")).find((w) => w.window === id);
};
const agentState = async (): Promise<AgentInfo | undefined> => (await call<AgentInfo[]>("agents.list")).find((a) => a.key === AGENT);
/** A tree read still waiting for its answer. */
const reading = (): boolean => reads.some((r) => r.back === null);

beforeAll(async () => {
  if (!unix) return;
  shotsDir();
  box = sandbox("big-vault");
  before = outside();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  vault = join(box.root, "vault");
  made = invent(vault);
  const bin = join(box.root, "bin");
  installFakeAgent(bin, {});

  server = Bun.spawn([process.execPath, "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: {
      ...box.env,
      PORT: String(port),
      VAULT: vault,
      PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      SHELL: "/bin/sh",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(server.stdout as ReadableStream<Uint8Array>, "out");
  drain(server.stderr as ReadableStream<Uint8Array>, "err");
  await until("the server answered, with the workspace mounted", MOUNT_MS, async () => {
    try {
      return (await fetch(`${base}/`)).ok;
    } catch {
      return false;
    }
  });

  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
  page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const pending = new Map<unknown, (typeof reads)[number]>();
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/call")) return;
    let kind = "";
    try {
      kind = String((JSON.parse(r.postData() ?? "{}") as { kind?: unknown }).kind ?? "");
    } catch {
      return;
    }
    if (kind !== "page.list" && kind !== "children.all") return;
    const read = { kind, went: Date.now(), back: null };
    reads.push(read);
    pending.set(r, read);
  });
  const back = (r: unknown): void => {
    const read = pending.get(r);
    if (read === undefined) return;
    read.back = Date.now();
    pending.delete(r);
  };
  page.on("requestfinished", back);
  page.on("requestfailed", back);
}, MOUNT_MS + 60000);

// Bounded, every part of it, as `agent-screen.e2e.ts`'s teardown is and for
// the same reasons.
afterAll(async () => {
  try {
    await Promise.race([browser?.close(), new Promise((r) => setTimeout(r, 10000))]);
  } catch {
    /* a browser that already went is not a failure */
  }
  if (server !== null && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([server.exited, new Promise((r) => setTimeout(r, 12000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (box) {
    expect(outside()).toBe(before);
    box.clean();
  }
}, 30000);

walk("1. a window on a workspace of about two thousand pages opens on the Agent screen, the agent Active and the tree read", "big-1.png", async () => {
  expect(made.pages).toBeGreaterThan(1900);
  await page.goto(at("#/agent"), { waitUntil: "domcontentloaded" });
  await until("the input is up", BOUNDS.draw, async () => (await page.locator("#agentta").count()) === 1);
  await until("the fake agent is Active", 30000, async () => (await agentState())?.state === "active");
  // THE TREE READ AND NOTHING OF IT STILL ON THE WAY, so the one the agent's
  // page sets off is the only one the next step times.
  await until("the tree lists the top-level pages", 60000, async () => {
    const rows = await page.locator("ul.tree li.treerow").allInnerTexts();
    return TOPS.every((t) => rows.some((r) => r.includes(t)));
  });
  await until("no read of the tree is on the way", 60000, () => reads.length > 0 && !reading());
});

walk("2. a first message makes the chat, and its turn ends", "big-2.png", async () => {
  const input = page.locator("#agentta");
  await input.fill("Look over the invented ledger");
  await input.press("Enter");
  await until("the chat has an address", 10000, async () => /^#\/agent\/[A-Za-z0-9_-]{8,}$/.test(await hash()));
  chat = (await hash()).split("/")[2] as string;
  await until("the turn ended", 30000, async () => (await summaryOf(chat))?.stop === "end_turn");
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("screen");
});

walk("3. a page the agent makes three levels down is brought up beside the chat, with Go back to over it, and the time it took is printed", "big-3.png", async () => {
  const id = `${made.under}/Invented_Brief`;
  const rel = join("pages", ...id.split("/").flatMap((s, i) => (i === 0 ? [s] : ["children", s])), "content.yaml");
  const route = "#/page/" + encodeURIComponent(id);
  await until("no read of the tree is on the way", 60000, () => !reading());
  // IDLE IN THIS WINDOW, and not only on the server, as the Agent screen
  // walk's step 10 waits: step 2 ended on the server's word, the window hears
  // it a push later, and Enter while its button is still Stop sends nothing.
  await until("this window heard the first turn end: its button is Send, not Stop", 10000, async () =>
    (await page.locator(".agentdock .send").getAttribute("aria-label")) === "Send");
  const input = page.locator("#agentta");
  await input.fill(`Make an invented brief\n!write ${rel} name: Invented Brief`);
  await input.press("Enter");
  await until("the page is on disk", 30000, () => existsSync(join(vault, rel)));
  const written = Date.now();
  const since = reads.length;

  // Timed closer than `until` polls, since the time is what is printed.
  let followed: number | null = null;
  while (Date.now() - written < FOLLOW_MS) {
    if ((await hash()) === route) {
      followed = Date.now() - written;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const tree = reads.slice(since).map((r) => `${r.kind} ${r.went - written}..${r.back === null ? "?" : r.back - written} ms`);
  console.log(`big vault, ${made.pages} pages: the window followed the agent's new page ${followed === null ? `not at all in ${FOLLOW_MS} ms` : `${followed} ms`} after the write; the tree's reads since: ${tree.join(", ") || "none"}`);
  if (followed === null) throw new Error(`the window did not follow the page the agent made within ${FOLLOW_MS} ms of the write (tree reads since: ${tree.join(", ") || "none"})`);

  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  expect(await page.locator("div.agentbox iframe").count()).toBe(1);
  await until("Go back to shows", 10000, async () => (await page.locator(".backslot button").count()) === 1);
  await until("the context names the switcher's screen with the chat beside it", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === chat && w.address.view === "page" && w.address.id === id;
  });
}, FOLLOW_MS + 60000);
