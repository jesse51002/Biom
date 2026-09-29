// SPDX-License-Identifier: AGPL-3.0-only
// THE OPT-IN SMOKE AGAINST THE REAL CLAUDE CODE — the person's own, through
// its ACP adapter `@agentclientprotocol/claude-agent-acp` run by `npx` exactly
// as Biom launches it, on their own login and subscription.
//
// RUN BY NAME, AND ONLY ON PURPOSE:
//
//   BIOM_REAL_AGENT=1 bun test ./tests/e2e/real-agent.e2e.ts
//
// It is NOT in `make e2e` and never runs in CI: without `BIOM_REAL_AGENT=1`
// every step is skipped. It spends the person's subscription — the probe's
// session, one short turn and one stopped seconds in — so it is kept to that.
//
// WHY `sandbox()` IS NOT USED, AND WHAT IS ISOLATED INSTEAD. The agent is the
// person's own Claude Code, signed in with what lives in their HOME, so HOME
// stays real — and with it their login shell, their PATH and their `claude`.
// What would be written into the person's own things by Biom is moved out of
// the way instead: the workspace is a throwaway folder under the system's temp
// directory, and Biom's own data directory — where the remembered-workspace
// list lives, which a scratch vault once polluted so the desktop app opened it
// instead of the picker — is moved with `XDG_DATA_HOME`. That only moves it on
// Linux: elsewhere the data directory hangs off HOME itself, so this smoke
// refuses to run there rather than remember a throwaway workspace in the
// person's own list. Because HOME is real, `outside()` cannot mean "nothing
// outside the sandbox" here — Claude Code writes its own session files in
// HOME, as it would in a terminal — so that assertion is NOT made for HOME; it
// IS made for Biom's data directory, which is the one the harness guards.
//
// Jev is pointed at a stub on this machine (`BIOM_JEV_ENDPOINT`), so the
// person's Jev key, if their login shell carries one, reaches nothing outside.
//
// SKIPPED, WITH THE REASON PRINTED, when `claude` or `npx` is not on the login
// shell's PATH, or when the probe says Claude Code needs signing in.
//
// WHAT IT WALKS:
//
//   1. Claude Code is found and probed Active.
//   2. The / menu carries the SDK's own commands, `compact` among them, and a
//      workspace skill.
//   3. ONE short turn, from Edit beside the root page, asks it to create a
//      tiny page file in the throwaway workspace: the file is there, and the
//      history has the edit stamped with the chat's agent id.
//   3b. The switcher moves the screen to the new page with the chat still
//      beside it.
//   4. Stop, a few seconds into a second turn asked to run long, ends it
//      `cancelled` — so the turn costs a few seconds of output, not a minute.
//   5. The server stopping leaves no agent process in the workspace.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { HERE, SHOTS, BOUNDS, outside, freePort, until, step, stackTraces, shotsDir } from "./harness.ts";
import type { AgentInfo, ChatRead, ChatSummary, HistoryEntry, HistoryRead, WindowContext } from "../../contracts/types.ts";

const wanted = process.env.BIOM_REAL_AGENT === "1";
const linux = process.platform === "linux";
const AGENT = "claude-acp";
/** The page the turn asks for, and its identity, so the history can name it. */
const SMOKE_UID = "realsmokepage001";
const SMOKE_ID = "home/smoke";
const SMOKE_FILE = join("pages", "home", "children", "smoke", "content.yaml");

let root = "";
let vault = "";
let data = "";
let before = "";
let port = 0;
let base = "";
let server: ReturnType<typeof Bun.spawn> | null = null;
const said = { out: "", err: "" };
let browser: Browser | null = null;
let page: Page;
let jev: ReturnType<typeof Bun.serve> | null = null;
/** Why the walk does not run on this machine, said once, or null. */
let skipWhy: string | null = null;
let chat = "";

const log = (): string => said.err;

function drain(s: ReadableStream<Uint8Array> | undefined, into: "out" | "err"): void {
  if (s === undefined) return;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of s) said[into] += decoder.decode(chunk);
  })();
}

function walk(n: string, name: string, run: () => Promise<void>, ms: number): void {
  test.if(wanted)(`${n}. ${name}`, async () => {
    if (skipWhy !== null) {
      console.log(`[real-agent] skipped: ${skipWhy}`);
      return;
    }
    const file = `real-agent-${n}`;
    try {
      await step(`${n}. ${name}`, `${file}.png`, log, run);
    } finally {
      await page?.screenshot({ path: join(SHOTS, `${file}.png`) }).catch(() => {});
    }
  }, ms);
}

const at = (hash: string): string => `${base}/?vault=${encodeURIComponent(vault)}${hash}`;
const hash = async (): Promise<string> => page.evaluate(() => location.hash);

async function call<T = unknown>(kind: string, body: Record<string, unknown> = {}): Promise<T> {
  const env = await page.evaluate(async ([v, k, b]) => {
    const res = await fetch("/v/" + encodeURIComponent(v as string) + "/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "e2e-real", g: 1, kind: k, ...(b as object) }),
    });
    return await res.json();
  }, [vault, kind, body] as const) as { ok: boolean; value?: T; error?: { code: string; message: string } };
  if (!env.ok) throw new Error(`${kind} refused: ${env.error?.code} ${env.error?.message}`);
  return env.value as T;
}
const agentState = async (): Promise<AgentInfo | undefined> => (await call<AgentInfo[]>("agents.list")).find((a) => a.key === AGENT);
const summaryOf = async (id: string): Promise<ChatSummary | undefined> => (await call<ChatSummary[]>("chat.list")).find((c) => c.id === id);
const myWindow = async (): Promise<WindowContext | undefined> => {
  const id = await page.evaluate(() => sessionStorage.getItem("biom-window"));
  return (await call<WindowContext[]>("window.list")).find((w) => w.window === id);
};

/** Every process whose working directory is inside the throwaway workspace —
 *  an agent Biom started there, or anything it left behind. Linux's `/proc`. */
function processesIn(dir: string): number[] {
  const out: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cwd = readlinkSync(`/proc/${name}/cwd`);
      if (cwd === dir || cwd.startsWith(dir + "/")) out.push(Number(name));
    } catch {
      /* gone, or not ours to read */
    }
  }
  return out;
}

beforeAll(async () => {
  if (!wanted) return;
  if (!linux) {
    skipWhy = "Biom's data directory can be moved away from the person's own only on Linux (XDG_DATA_HOME); elsewhere this smoke would remember its throwaway workspace in their list";
    return;
  }
  // WHAT THE PERSON'S LOGIN SHELL FINDS, which is what Biom's discovery reads.
  const shell = process.env.SHELL && process.env.SHELL.startsWith("/") ? process.env.SHELL : "/bin/sh";
  const found = spawnSync(shell, ["-l", "-c", "command -v claude; command -v npx"], { encoding: "utf8", timeout: 15000 });
  const lines = (found.stdout ?? "").split("\n").filter(Boolean);
  if (!lines.some((l) => l.endsWith("/claude"))) { skipWhy = "`claude` is not on the login shell's PATH, so there is no Claude Code to talk to"; return; }
  if (!lines.some((l) => l.endsWith("/npx"))) { skipWhy = "`npx` is not on the login shell's PATH, and Claude Code's ACP adapter runs on Node through it"; return; }

  shotsDir();
  root = mkdtempSync(join(tmpdir(), "biom-real-agent-"));
  vault = join(root, "vault");
  data = join(root, "data");
  before = outside();
  port = await freePort();
  base = `http://127.0.0.1:${port}`;

  // Jev, on this machine: it answers `other`, which keeps whatever face there
  // is, and hears nothing it keeps.
  jev = Bun.serve({ port: 0, fetch: () => Response.json({ answers: { answer: { choice: "other", confidence: 0.5 } } }) });

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.VAULTS;
  server = Bun.spawn([process.execPath, "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: {
      ...env,
      PORT: String(port),
      VAULT: vault,
      // Biom's own data — the remembered-workspace list, the agents it
      // installs — in this run's folder, not the person's.
      XDG_DATA_HOME: data,
      BIOM_JEV_ENDPOINT: `http://127.0.0.1:${jev.port}/v1/systemone`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(server.stdout as ReadableStream<Uint8Array>, "out");
  drain(server.stderr as ReadableStream<Uint8Array>, "err");
  await until("the server answered", BOUNDS.serve, async () => {
    try {
      return (await fetch(`${base}/`)).ok;
    } catch {
      return false;
    }
  });
  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
  page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  await page.goto(at(""), { waitUntil: "domcontentloaded" });
  await until("the window opened on the Agent screen", BOUNDS.draw, async () => (await hash()) === "#/agent");
}, 120000);

afterAll(async () => {
  try {
    await browser?.close();
  } catch {
    /* already gone */
  }
  if (server !== null && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([server.exited, Bun.sleep(12000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  jev?.stop(true);
  if (root !== "") {
    for (const pid of processesIn(root)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    // Biom's data directory, the one the harness guards, was never touched.
    expect(outside()).toBe(before);
    rmSync(root, { recursive: true, force: true });
  }
});

walk("1", "Claude Code is found on this machine and probed Active", async () => {
  // THE FIRST PROBE MAY FETCH THE ADAPTER through npx, which is minutes on a
  // cold cache; Biom's own bound for that is three.
  await until("Claude Code was probed", 200000, async () => {
    await Bun.sleep(1000);
    const a = await agentState();
    return a !== undefined && a.reason !== "checking" && a.reason !== "installing";
  });
  const a = (await agentState()) as AgentInfo;
  if (a.state !== "active" && a.reason === "signin") {
    skipWhy = "the probe says Claude Code needs signing in; run `claude` in a terminal and sign in, then run this again";
    console.log(`[real-agent] skipped from here: ${skipWhy}`);
    return;
  }
  expect([a.state, a.message ?? ""]).toEqual(["active", ""]);
  expect(a.name).toBe("Claude Code");
  await until("the chip names Claude Code", 15000, async () => (await page.locator(".agentdock .agentchip").innerText()).trim() === "Claude Code");
}, 240000);

walk("2", "the / menu carries the SDK's own commands, `compact` among them, and a workspace skill", async () => {
  const input = page.locator("#agentta");
  await input.click();
  await input.pressSequentially("/");
  await until("the / menu opened", 15000, async () => (await page.locator("#agentslash .srow").count()) > 0);
  const all = await page.locator("#agentslash .srow .sn").allInnerTexts();
  expect(all).toContain("/compact");
  expect(all.some((n) => n.startsWith("/biom-"))).toBe(true);
  expect(new Set(all).size).toBe(all.length);
  await input.press("Escape");
  await input.fill("");
}, 60000);

walk("3", "one short turn creates a page file: it is on disk, and the history has the edit under the chat's agent id", async () => {
  // BESIDE THE ROOT PAGE, from Edit, and then left alone: the page untouched.
  await page.locator("div.railhead button.homerow").click();
  await until("the root page", BOUNDS.draw, async () => (await hash()) === "#/page/home");
  await page.locator("span.tools button.tool.edit").click();
  const input = page.locator("#agentta");
  await until("the input is empty, with the caret in it", 5000, async () =>
    (await input.inputValue()) === "" && (await input.evaluate((el) => document.activeElement === el)));
  await input.pressSequentially(
    `create the file ${SMOKE_FILE} (relative to the working directory) with exactly these four lines and nothing else: ` +
    `"name: Smoke", "uid: ${SMOKE_UID}", "plugin: biom-doc", "contents: []". Do not read or change any other file, and do not run commands. Reply with one word when it is written.`,
  );
  await input.press("Enter");
  await until("the chat began beside the page", 15000, async () => ((await myWindow())?.chat ?? null) !== null);
  chat = (await myWindow())?.chat as string;
  await until("the turn ended", 180000, async () => {
    await Bun.sleep(1000);
    return (await summaryOf(chat))?.phase === "idle";
  });
  expect((await summaryOf(chat))?.stop).toBe("end_turn");
  expect(existsSync(join(vault, SMOKE_FILE))).toBe(true);
  expect(readFileSync(join(vault, SMOKE_FILE), "utf8")).toContain(`uid: ${SMOKE_UID}`);

  // THE HISTORY: the edit, under this chat's agent — the id minted when its
  // agent started, which the chat's stream said.
  const read = await call<ChatRead>("chat.read", { chat });
  const agentId = (read.updates.filter((u) => u.kind === "agent").at(-1) as { agentId?: string } | undefined)?.agentId;
  expect(typeof agentId).toBe("string");
  const path = SMOKE_FILE.split("\\").join("/");
  const edits = (await call<HistoryRead>("history.read")).entries
    .filter((e): e is Extract<HistoryEntry, { kind: "edit" }> => e.kind === "edit" && e.path === path);
  console.log(`[real-agent] history edits to ${path}: ${edits.map((e) => e.via).join(", ")}`);
  expect(edits.length).toBeGreaterThanOrEqual(1);
  for (const e of edits) expect(e.writer).toMatchObject({ kind: "agent", chat, agent: agentId });
  expect(edits.every((e) => e.place !== null && e.place.view === "page" && e.place.uid === SMOKE_UID)).toBe(true);
}, 240000);

// A STEP OF ITS OWN, so a failure here says the switcher and nothing else:
// following a page the agent CREATES is the case the fake-agent walk once
// found broken (`chat.e2e.ts` 17b holds it now).
walk("3b", "the switcher brings the new page up with the chat still beside it", async () => {
  await until("the screen moved to the new page", 20000, async () => (await hash()) === `#/page/${encodeURIComponent(SMOKE_ID)}`);
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  expect((await myWindow())?.chat).toBe(chat);
}, 60000);

walk("4", "Stop a few seconds into a second, long turn ends it cancelled", async () => {
  const input = page.locator("#agentta");
  // Long enough that it is still going when Stop lands: a reply that would
  // take a minute, stopped a few seconds in.
  await input.fill("Write a two-thousand-word essay on the history of paper maps. Do not use any tools.");
  await input.press("Enter");
  await until("Send became Stop", 30000, async () => (await page.locator(".agentdock .send").getAttribute("aria-label")) === "Stop");
  await until("the turn is running", 60000, async () => (await summaryOf(chat))?.phase === "running");
  await Bun.sleep(4000);
  await page.locator(".agentdock .send").click();
  await until("the turn ended", 60000, async () => (await summaryOf(chat))?.phase === "idle");
  expect((await summaryOf(chat))?.stop).toBe("cancelled");
}, 120000);

walk("5", "the server stopping leaves no agent process in the workspace, and said no stack trace", async () => {
  expect(processesIn(root).length).toBeGreaterThan(0);
  try {
    await browser?.close();
  } catch {
    /* already gone */
  }
  browser = null;
  server!.kill("SIGTERM");
  await Promise.race([server!.exited, Bun.sleep(15000)]);
  expect(server!.exitCode).not.toBeNull();
  await until("every process in the workspace is gone", 10000, () => processesIn(root).length === 0);
  expect(stackTraces(said.err)).toEqual([]);
}, 60000);
