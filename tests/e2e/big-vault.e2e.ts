// SPDX-License-Identifier: AGPL-3.0-only
// A WORKSPACE THE SIZE OF A REAL ONE, TIMED — the server run the way `make dev`
// runs it, the scripted ACP agent on its PATH, and a headless Chromium, as
// `agent-screen.e2e.ts` runs them; what is different is the vault, and that
// every step is timed against a bound.
//
// WHY THIS FILE EXISTS. Every other walk runs on a vault of about four pages,
// where anything that reads the whole workspace is instant. On the owner's,
// about 1,870 pages, the server was silent for twenty seconds while it mounted,
// the window read and parsed every page before it drew its tree and again
// after every write, every write anywhere tore the open page down, and a page
// an agent made reached the tree twelve seconds after the history named it —
// by which time the switcher had stopped waiting for it. None of that shows at
// four pages. This walk makes the same shape of workspace
// (`bigvault-fixture.ts`) and asks each of those things of it.
//
// EVERY STEP IS TIMED WITH `performance.now()` AND HELD TO A BOUND about three
// times what the design expects, so a slow runner does not flake; the file
// prints a table of step, measured and bound when it ends, pass or fail, so a
// slowdown shows before it fails. A step over its bound fails and the walk
// goes on to the next, so the table is always whole; a step whose state never
// comes at all stops the walk there.
//
// AND IT PINS THE RULE THE TIMES COME FROM: every request the window sends in
// the whole walk is recorded, none may ask for the whole tree (`page.list`,
// `children.all`), and the counts by kind are printed with the table.
//
// WHAT IT WALKS, in order:
//
//   1. The server answers `/`, from its spawn.
//   2. A cold window on a page three levels down: the rail's top level after
//      the document loads, and the page drawn.
//   3. The wide level, 228 pages, opened in the rail.
//   4. Five of its pages opened from the rail, one after another.
//   5. The Agent screen, a first message, and the level the agent will write
//      into opened in the rail.
//   6. A page the agent makes three levels down, brought up by the switcher
//      with the chat beside it and Go back to over it;
//   6b. and its row in the level the rail already holds — kept failing, for a
//      bug this walk found (the step says which).
//   7. A write from outside to ANOTHER page redraws its row and leaves the open
//      page's box standing, unread.
//   8. A name typed in the finder, to its hits.
//   9. No request of the walk asked for the whole tree.
//
// Every page, word, table and id here is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { HERE, SHOTS, BOUNDS, sandbox, outside, freePort, until, step, shotsDir } from "./harness.ts";
import type { Sandbox } from "./harness.ts";
import { TOPS, WIDE, dirOf, invent } from "./bigvault-fixture.ts";
import type { Invented, InventedPage } from "./bigvault-fixture.ts";
import { installFakeAgent } from "../fake-acp-agent.ts";
import { TIMING } from "../../client/store/switcher.js";
import { WHOLE_TREE_KINDS } from "../scale-helpers.ts";
import type { AgentInfo, ChatSummary, WindowContext } from "../../contracts/types.ts";

const unix = process.platform !== "win32";
const AGENT = "claude-acp";

/** THE BOUNDS, in ms: about three times what the design expects of each step
 *  on a workspace this size. Not loosened to make a run pass — a step that
 *  needs more is a regression or a slow runner, and the table says which. */
const BOUND = {
  serve: 2000,
  drawn: 3000,
  rail: 1000,
  wide: 1000,
  switch: 1000,
  row: 1500,
  follow: 2000,
  find: 1000,
} as const;

/** How long a step's state may take to come AT ALL before the walk stops —
 *  far past its bound, so a slow step is measured and reported rather than
 *  cutting the walk short. */
const NEVER = 60_000;
/** One settle of the watcher and then some: how long the open page is watched
 *  after a write elsewhere has visibly landed. */
const AFTER_SETTLE = 600;
/** How long the agent's new page's row is waited for: four times its bound,
 *  past which it is not coming. */
const ROW_NEVER = 4 * 1500;

/* ── the walk's furniture ────────────────────────────────────────────────── */

let box: Sandbox;
let before = "";
let base = "";
let vault = "";
let made: Invented = { pages: 0, under: "", wide: "", all: [] };
let server: ReturnType<typeof Bun.spawn> | null = null;
const said = { out: "", err: "" };
let browser: Browser | null = null;
let page: Page;
/** The chat the walk is in. */
let chat = "";
/** When the person last moved the screen — the chat taking its address. */
let movedAt = 0;
/** When the agent's new page was on disk, and when its row turned up in the
 *  rail, or null when it never did within `ROW_NEVER`. */
let wroteAt = 0;
let rowSeen: Promise<number | null> = Promise.resolve(null);

/** EVERY REQUEST THE WINDOW SENT, by kind, with the page it named and when —
 *  the walk's own calls (`call` below) left out. */
const sent: { kind: string; page: string | null; at: number }[] = [];
/** The walk's own calls carry this id, so they are not counted as the window's. */
const OWN = "e2e-big";

/** THE TABLE: one row per timed step, printed when the file ends. */
const table: { step: string; ms: number | null; bound: number }[] = [];
/** Rows over their bound, in the order they were measured. */
const over: string[] = [];

let broke: string | null = null;
const log = (): string => said.err;

/** One step. A step over a bound fails AFTER it has done everything it does,
 *  and the walk goes on; a step that throws for any other reason stops it. */
function walk(name: string, shot: string, run: () => Promise<void>, ms = 120000): void {
  test.if(unix)(name, async () => {
    if (broke !== null) throw new Error(`skipped: an earlier step failed — ${broke}`);
    const had = over.length;
    try {
      await step(name, shot, log, run);
    } catch (e) {
      await page?.screenshot({ path: join(SHOTS, shot), timeout: 8000 }).catch(() => {});
      broke = name;
      throw e;
    }
    if (over.length > had) {
      await page?.screenshot({ path: join(SHOTS, shot), timeout: 8000 }).catch(() => {});
      throw new Error(`over its bound: ${over.slice(had).join("; ")}`);
    }
  }, ms);
}

/** Put a measurement in the table, and say it now. */
function record(label: string, ms: number | null, bound: number): void {
  table.push({ step: label, ms, bound });
  const shown = ms === null ? "never" : `${Math.round(ms)} ms`;
  console.log(`[big vault] ${label}: ${shown} (bound ${bound} ms)`);
  if (ms === null || ms > bound) over.push(`${label} took ${shown}, bound ${bound} ms`);
}

/** WAIT IN THE PAGE for `fn` to hold, checked every frame, and answer the ms
 *  from `t0` — or throw, naming it, when it has not held within `NEVER`. */
async function held<A>(label: string, t0: number, fn: (arg: A) => unknown, arg: A, bound: number): Promise<number> {
  try {
    await page.waitForFunction(fn as (arg: unknown) => unknown, arg as unknown, { polling: "raf", timeout: NEVER });
  } catch {
    record(label, null, bound);
    throw new Error(`${label}: never, in ${NEVER} ms`);
  }
  const ms = performance.now() - t0;
  record(label, ms, bound);
  return ms;
}

function drain(s: ReadableStream<Uint8Array> | undefined, into: "out" | "err"): void {
  if (s === undefined) return;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of s) said[into] += decoder.decode(chunk);
  })();
}

/** A call made FROM THE PAGE, with its own cookie, as the input box makes one
 *  — carrying the walk's own id, so the pin does not count it. */
async function call<T = unknown>(kind: string, body: Record<string, unknown> = {}): Promise<T> {
  const env = await page.evaluate(async ([v, k, b, own]) => {
    const res = await fetch("/v/" + encodeURIComponent(v as string) + "/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: own, g: 1, kind: k, ...(b as object) }),
    });
    return await res.json();
  }, [vault, kind, body, OWN] as const) as { ok: boolean; value?: T; error?: { code: string; message: string } };
  if (!env.ok) throw new Error(`${kind} refused: ${env.error?.code} ${env.error?.message}`);
  return env.value as T;
}

const at = (hash: string) => `${base}/?vault=${encodeURIComponent(vault)}${hash}`;
const routeOf = (id: string): string => "#/page/" + encodeURIComponent(id);
const hash = async (): Promise<string> => page.evaluate(() => location.hash);
const summaryOf = async (id: string): Promise<ChatSummary | undefined> => (await call<ChatSummary[]>("chat.list")).find((c) => c.id === id);
const myWindow = async (): Promise<WindowContext | undefined> => {
  const id = await page.evaluate(() => sessionStorage.getItem("biom-window"));
  return (await call<WindowContext[]>("window.list")).find((w) => w.window === id);
};
const agentState = async (): Promise<AgentInfo | undefined> => (await call<AgentInfo[]>("agents.list")).find((a) => a.key === AGENT);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};

/* ── what is on screen, asked in the page ────────────────────────────────── */

/** The route is `want` and the strip says the box reported what it drew. */
const drawnAt = (want: string): boolean => {
  const strip = (document.querySelector("span.status")?.textContent ?? "").replace(/\s+/g, " ");
  return location.hash === want && /Drawn ?\d+/.test(strip);
};
/** The rail holds a row reading exactly each of `names`. */
const railHas = (names: string[]): boolean => {
  const rows = new Set([...document.querySelectorAll("ul.tree li.treerow > a")].map((a) => (a.textContent ?? "").trim()));
  return names.every((n) => rows.has(n));
};
/** A rail row reading exactly `name`. */
const rowFor = (name: string) =>
  page.locator("ul.tree li.treerow > a").filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
/** The first rail row reading exactly `name` BELOW the row reading `above` —
 *  a page's own child, where another page elsewhere is called the same. */
const rowBelow = (above: string, name: string) =>
  page.locator(`xpath=//ul[contains(@class,"tree")]/li[a[normalize-space()=${JSON.stringify(above)}]]/following-sibling::li[a[normalize-space()=${JSON.stringify(name)}]][1]/a`);
/** Open a row's level in the rail, by its caret. */
async function expand(row: ReturnType<typeof rowFor>): Promise<void> {
  const caret = row.locator("span.caret");
  if ((await caret.getAttribute("aria-expanded")) !== "true") await caret.click();
}
/** The pages directly under `id`, as the fixture wrote them. */
const under = (id: string): InventedPage[] => made.all.filter((p) => p.id.slice(0, p.id.lastIndexOf("/")) === id);

/* ── setup and teardown ──────────────────────────────────────────────────── */

beforeAll(async () => {
  if (!unix) return;
  shotsDir();
  box = sandbox("big-vault");
  before = outside();
  base = `http://127.0.0.1:${await freePort()}`;
  vault = join(box.root, "vault");
  made = invent(vault);
  installFakeAgent(join(box.root, "bin"), {});

  // THE BROWSER BEFORE THE SERVER, so its launch is not in the first step's
  // time; the server is spawned by that step, which is what it times.
  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
  page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/call")) return;
    try {
      const body = JSON.parse(r.postData() ?? "{}") as { id?: unknown; kind?: unknown; page?: unknown };
      if (body.id === OWN) return;
      sent.push({ kind: String(body.kind ?? ""), page: typeof body.page === "string" ? body.page : null, at: performance.now() });
    } catch {
      /* not a call */
    }
  });
}, 120000);

// Bounded, every part of it, as `agent-screen.e2e.ts`'s teardown is and for
// the same reasons. The table is printed first, whatever happened.
afterAll(async () => {
  if (table.length) {
    const w = Math.max(...table.map((r) => r.step.length));
    const lines = table.map((r) =>
      `  ${r.step.padEnd(w)}  ${(r.ms === null ? "never" : `${Math.round(r.ms)} ms`).padStart(9)}  ${`${r.bound} ms`.padStart(8)}  ${r.ms !== null && r.ms <= r.bound ? "ok" : "OVER"}`);
    const kinds = new Map<string, number>();
    for (const s of sent) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    const counted = [...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log([
      `[big vault] ${made.pages} invented pages, ${WIDE.count} of them in one level`,
      `  ${"step".padEnd(w)}  ${"measured".padStart(9)}  ${"bound".padStart(8)}`,
      ...lines,
      `  requests the window sent: ${sent.length} — ${counted || "none"}`,
    ].join("\n"));
  }
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

/* ── the walk ────────────────────────────────────────────────────────────── */

walk("1. the server answers / within its bound of being spawned, on a workspace of about two thousand pages", "big-1.png", async () => {
  expect(made.pages).toBeGreaterThan(2000);
  const t0 = performance.now();
  server = Bun.spawn([process.execPath, "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: {
      ...box.env,
      PORT: String(new URL(base).port),
      VAULT: vault,
      PATH: [join(box.root, "bin"), dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      SHELL: "/bin/sh",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(server.stdout as ReadableStream<Uint8Array>, "out");
  drain(server.stderr as ReadableStream<Uint8Array>, "err");
  let ms: number | null = null;
  while (performance.now() - t0 < NEVER) {
    try {
      if ((await fetch(`${base}/`)).ok) { ms = performance.now() - t0; break; }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  record("spawn → / answers", ms, BOUND.serve);
  if (ms === null) throw new Error(`the server did not answer / in ${NEVER} ms`);
});

walk("2. a cold window on a page three levels down: the rail's top level soon after the document, and the page drawn", "big-2.png", async () => {
  const deep = made.all.find((p) => p.depth === 3 && p.id.startsWith("home/Orchard/")) as InventedPage;
  const route = routeOf(deep.id);
  const t0 = performance.now();
  await page.goto(at(route), { waitUntil: "domcontentloaded" });
  const loaded = performance.now();
  const tops = [...TOPS, WIDE.name];
  await Promise.all([
    held("document → the rail's top level", loaded, railHas, tops, BOUND.rail),
    held("navigate → a page three levels down Drawn", t0, drawnAt, route, BOUND.drawn),
  ]);
});

walk(`3. the wide level of ${WIDE.count} pages opens in the rail within its bound`, "big-3.png", async () => {
  const names = under(made.wide).map((p) => p.name);
  expect(names.length).toBe(WIDE.count);
  const t0 = performance.now();
  await expand(rowFor(WIDE.name));
  await held(`expand ${WIDE.count} rows`, t0, railHas, names, BOUND.wide);
});

walk("4. five pages opened from the rail, one after another, are each drawn within the bound at the median", "big-4.png", async () => {
  const notes = under(made.wide);
  const five = [0, 45, 95, 150, 220].map((i) => notes[i] as InventedPage);
  const times: number[] = [];
  for (const p of five) {
    const row = rowFor(p.name);
    await row.scrollIntoViewIfNeeded();
    const t0 = performance.now();
    await row.click();
    try {
      await page.waitForFunction(drawnAt, routeOf(p.id), { polling: "raf", timeout: NEVER });
    } catch {
      record("rail row → Drawn, median of five", null, BOUND.switch);
      throw new Error(`${p.name} was never drawn`);
    }
    times.push(performance.now() - t0);
  }
  console.log(`[big vault] the five switches: ${times.map((t) => `${Math.round(t)} ms`).join(", ")}`);
  record("rail row → Drawn, median of five", median(times), BOUND.switch);
});

walk("5. the Agent screen, a first message, and the level the agent will write into opened in the rail", "big-5.png", async () => {
  await page.locator("button.agentlink").click();
  await until("the Agent screen", 10000, async () => (await hash()).startsWith("#/agent"));
  await until("the input is up", BOUNDS.draw, async () => (await page.locator("#agentta").count()) === 1);
  await until("the fake agent is Active", 30000, async () => (await agentState())?.state === "active");
  // THE LEVEL THE NEW PAGE WILL BE LISTED IN, open in the rail, so its row
  // can turn up there; the top-level page above it first.
  const top = made.under.split("/")[1] as string;
  const parent = made.all.find((p) => p.id === made.under) as InventedPage;
  await expand(rowFor(top));
  await until("the level under the top-level page is listed", 15000, async () => (await rowBelow(top, parent.name).count()) === 1);
  await expand(rowBelow(top, parent.name));
  const kids = under(made.under).map((p) => p.name);
  await until("the level the agent writes into is listed", 15000, () => page.evaluate(railHas, kids));

  const input = page.locator("#agentta");
  await input.fill("Look over the invented ledger");
  await input.press("Enter");
  await until("the chat has an address", 10000, async () => /^#\/agent\/[A-Za-z0-9_-]{8,}$/.test(await hash()));
  movedAt = performance.now();
  chat = (await hash()).split("/")[2] as string;
  await until("the turn ended", 30000, async () => (await summaryOf(chat))?.stop === "end_turn");
  // IDLE IN THIS WINDOW, and not only on the server, as the Agent screen
  // walk's step 10 waits: the window hears the turn end a push later, and
  // Enter while its button is still Stop sends nothing.
  await until("this window heard the turn end: its button is Send", 10000, async () =>
    (await page.locator(".agentdock .send").getAttribute("aria-label")) === "Send");
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("screen");
});

const BRIEF = { name: "Invented Brief", uid: "inventedbrief001" };

walk("6. a page the agent makes three levels down is brought up by the switcher within its bound, beside the chat with Go back to over it", "big-6.png", async () => {
  const id = `${made.under}/Invented_Brief`;
  const rel = join(dirOf(id), "content.yaml");
  const route = routeOf(id);
  // NOT INSIDE THE SWITCHER'S SETTLE: it never moves the screen sooner than
  // `settle` after the last move — here the chat taking its address, a moment
  // ago — and a write inside that waits for it by design. What is timed is
  // the switcher finding a page the window has never listed, so that rule is
  // waited out first.
  const left = TIMING.settle + 250 - (performance.now() - movedAt);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  const input = page.locator("#agentta");
  // WITH ITS IDENTITY, so nothing writes one back into it afterwards and the
  // open page is not changed under step 7.
  await input.fill(`Make an invented brief\n!write ${rel} {name: ${BRIEF.name}, uid: ${BRIEF.uid}, plugin: biom-doc, contents: [{name: body, parts: {body: "# ${BRIEF.name}"}}]}`);
  await input.press("Enter");
  const asked = performance.now();
  while (!existsSync(join(vault, rel))) {
    if (performance.now() - asked > 30000) throw new Error("the agent never wrote the page");
    await new Promise((r) => setTimeout(r, 5));
  }
  const t0 = performance.now();
  wroteAt = t0;
  rowSeen = page.waitForFunction(railHas, [BRIEF.name], { polling: "raf", timeout: ROW_NEVER })
    .then(() => performance.now() - t0, () => null);
  await held("agent's new page → the switcher follows", t0, (want: string) => location.hash === want, route, BOUND.follow);

  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  expect(await page.locator("div.agentbox iframe").count()).toBe(1);
  await until("Go back to shows", 10000, async () => (await page.locator(".backslot button").count()) === 1);
  await until("the context names the switcher's screen with the chat beside it", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === chat && w.address.view === "page" && w.address.id === id;
  });
  await until("the new page drew", BOUNDS.draw, () => page.evaluate(drawnAt, route));
});

// A BUG THIS WALK FOUND, kept as `test.failing` until it is fixed — green while
// the product is wrong, red the day it is right, which is the prompt to make it
// a plain step. The settle's change names the page and NO LEVEL
// (`{"pages":[…/Invented_Brief],"levels":[]}`, measured): the page is read
// before the watcher settles — the window drawing it the moment the switcher
// has brought it up — so the settle's baseline already knows its document and
// reads its arrival as an edit; and the history's `uidOf` has put the page in
// the index by then too, so `uidWas` would say the same. A level the rail
// already holds is never listed again, and the page is missing from it until
// something else relists it.
(unix ? test.failing : test.skip)("6b. the page the agent made is listed in its level, already open in the rail, within its bound — FAILING: the change names no level, because the page was read before the watcher's settle asked whether it was new", async () => {
  if (broke !== null) throw new Error(`skipped: an earlier step failed — ${broke}`);
  expect(wroteAt).toBeGreaterThan(0);
  const ms = await rowSeen;
  table.push({ step: "agent's new page → its row in the rail", ms, bound: BOUND.row });
  console.log(`[big vault] agent's new page → its row in the rail: ${ms === null ? "never" : `${Math.round(ms)} ms`} (bound ${BOUND.row} ms)`);
  expect(ms !== null && ms <= BOUND.row).toBe(true);
}, 30000);

walk("7. a write from outside to another page redraws that page's row and leaves the open page's box standing, unread", "big-7.png", async () => {
  const open = decodeURIComponent((await hash()).replace(/^#\/page\//, ""));
  expect(open.endsWith("Invented_Brief")).toBe(true);
  // THE BOX, MARKED: the same element after the write, or it was torn down.
  const mark = `kept-${Date.now()}`;
  expect(await page.evaluate((m) => {
    const el = document.querySelector("div.plate iframe.artifact") as (HTMLIFrameElement & { __e2e?: string }) | null;
    if (el === null) return false;
    el.__e2e = m;
    return true;
  }, mark)).toBe(true);

  // ANOTHER PAGE, renamed in its own file, as an editor or a shell would.
  const other = "home/Quarry";
  const file = join(vault, dirOf(other), "content.yaml");
  const text = readFileSync(file, "utf8");
  expect(text.startsWith("name: Quarry\n")).toBe(true);
  const since = performance.now();
  writeFileSync(file, text.replace(/^name: Quarry\n/, "name: Quarry Renamed\n"), "utf8");
  // HEARD: its row reads the new name, so the change reached this window.
  await until("the other page's row reads its new name", 30000, () => page.evaluate(railHas, ["Quarry Renamed"]));
  await new Promise((r) => setTimeout(r, AFTER_SETTLE));

  const kept = await page.evaluate((m) => {
    const el = document.querySelector("div.plate iframe.artifact") as (HTMLIFrameElement & { __e2e?: string }) | null;
    return el !== null && el.__e2e === m;
  }, mark);
  const reread = sent.filter((s) => s.at >= since && s.kind === "page.read" && s.page === open);
  expect({ kept, reread: reread.length }).toEqual({ kept: true, reread: 0 });
});

walk("8. a name typed in the finder, to its hits", "big-8.png", async () => {
  // A page five levels down, which nothing in this walk has listed.
  const target = made.all.find((p) => p.depth === 5 && p.id.startsWith("home/Almanac/")) as InventedPage;
  const finder = page.locator("input.railfind");
  const t0 = performance.now();
  await finder.fill(target.name);
  await held("finder: a name typed → its hits", t0, (name: string) =>
    [...document.querySelectorAll("a.foundrow span.nm")].some((s) => (s.textContent ?? "").trim() === name), target.name, BOUND.find);
  await finder.press("Escape");
});

walk("9. no request the window sent in the whole walk asked for the whole tree", "big-9.png", async () => {
  expect(sent.length).toBeGreaterThan(0);
  const whole = sent.filter((s) => WHOLE_TREE_KINDS.includes(s.kind)).map((s) => s.kind);
  expect(whole).toEqual([]);
});
