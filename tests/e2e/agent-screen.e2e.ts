// SPDX-License-Identifier: AGPL-3.0-only
// THE AGENT SCREEN'S HOST SIDE, ON A SCREEN — the server run the way `make dev`
// runs it, with the scripted ACP agent on its PATH, driven in a headless
// Chromium: Biom's own input box over the look's box, the pickers, the / menu,
// Stop, Edit and the panel beside a page, one box for the screen and the
// panel, a first message held until its agent is signed in, and the window
// remembering its chat.
//
// WHAT IT WALKS, in order:
//
//   1. A window with no hash opens on the Agent screen: the look draws in its
//      box, the input is the host's and not a touch, and the pickers are the
//      agent's own options.
//   2. The / menu narrows as it is typed and is worked from the keyboard.
//   3. A first message is the words typed, and nothing else; the chat is
//      handed to the look through its own box.
//   4. Send is Stop while a turn runs, the rail counts the chat working, and
//      Stop ends the turn cancelled.
//   5. A long list shows five and More models, grouped as the agent groups it;
//      a choice picked is the agent's option set.
//   6. Home from the Agent screen brings its chat along beside the page; Edit
//      opens a new chat there with its location typed in, and the chat is
//      started for that page.
//   7. The panel maximises to the Agent screen and minimises beside the page
//      with the same box — never reloaded — and the context follows.
//   8. The window remembers its chat and its panel across a reload, and the
//      rail's Agent returns to that chat.
//   9. A first message to an agent that is not signed in waits: More agents
//      says so, Sign in runs the agent's own command in the pop-up, and the
//      message goes out the moment the agent is Active.
//  10. A page the agent MAKES from the full Agent screen is brought up, with
//      the chat beside it and Go back to over it — though the history names
//      it before this window's tree lists it.
//
// Every page, word, key and id here is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import type { Browser, Frame, Page } from "playwright";

import { HERE, SHOTS, BOUNDS, sandbox, outside, freePort, until, step, shotsDir } from "./harness.ts";
import type { Sandbox } from "./harness.ts";
import { installFakeAgent } from "../fake-acp-agent.ts";
import type { AgentInfo, ChatRead, ChatSummary, WindowContext } from "../../contracts/types.ts";

const unix = process.platform !== "win32";
const AGENT = "claude-acp";

let box: Sandbox;
let before = "";
let port = 0;
let base = "";
let vault = "";
let signedIn = "";
let server: ReturnType<typeof Bun.spawn> | null = null;
let said = { out: "", err: "" };
let browser: Browser | null = null;
let page: Page;
/** The chat the walk is in. */
let chat = "";
/** The chat Edit started, beside the root page. */
let edited = "";

let broke: string | null = null;
const log = (): string => said.err;

function walk(name: string, shot: string | null, run: () => Promise<void>, ms = 90000): void {
  test.if(unix)(name, async () => {
    if (broke !== null) throw new Error(`skipped: an earlier step failed — ${broke}`);
    try {
      await step(name, shot, log, run);
    } catch (e) {
      if (shot !== null) await page?.screenshot({ path: join(SHOTS, shot) }).catch(() => {});
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
      body: JSON.stringify({ id: "e2e", g: 1, kind: k, ...(b as object) }),
    });
    return await res.json();
  }, [vault, kind, body] as const) as { ok: boolean; value?: T; error?: { code: string; message: string } };
  if (!env.ok) throw new Error(`${kind} refused: ${env.error?.code} ${env.error?.message}`);
  return env.value as T;
}

const at = (hash: string) => `${base}/?vault=${encodeURIComponent(vault)}${hash}`;
const hash = async (): Promise<string> => page.evaluate(() => location.hash);
/** The look's box, whichever frame it is: the one inside `.agentbox`. */
async function lookFrame(): Promise<Frame> {
  const handle = await page.locator("div.agentbox iframe").elementHandle();
  const f = handle ? await handle.contentFrame() : null;
  if (!f) throw new Error("the look's box has no frame yet");
  return f;
}
/** Whether the look says these words anywhere — it draws in a shadow root of
 *  its own, which a locator pierces and `innerText` does not. */
const lookSays = async (words: string): Promise<boolean> => {
  try {
    return (await (await lookFrame()).getByText(words, { exact: false }).count()) > 0;
  } catch {
    return false;
  }
};
const summaryOf = async (id: string): Promise<ChatSummary | undefined> => (await call<ChatSummary[]>("chat.list")).find((c) => c.id === id);
const myWindow = async (): Promise<WindowContext | undefined> => {
  const id = await page.evaluate(() => sessionStorage.getItem("biom-window"));
  return (await call<WindowContext[]>("window.list")).find((w) => w.window === id);
};
const agentState = async (): Promise<AgentInfo | undefined> => (await call<AgentInfo[]>("agents.list")).find((a) => a.key === AGENT);

beforeAll(async () => {
  if (!unix) return;
  shotsDir();
  box = sandbox("agent-screen");
  before = outside();
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  vault = join(box.root, "vault");
  const bin = join(box.root, "bin");
  signedIn = join(box.root, "signed-in");
  writeFileSync(signedIn, "invented\n");
  const group = (name: string, rows: [string, string, string][]) => ({ name, options: rows.map(([value, n, description]) => ({ value, name: n, description })) });
  installFakeAgent(bin, {
    scenario: {
      authMethods: [{ id: "invented-login", name: "Sign in (invented)", _meta: { "terminal-auth": { command: "/bin/sh", args: ["-c", `touch '${signedIn}'`] } } }],
      session: {
        refuseUnless: signedIn,
        configOptions: [
          {
            id: "model", name: "Model", category: "model", type: "select", currentValue: "opus", options: [
              group("Invented Labs", [["opus", "Opus (invented)", "Most capable"], ["sonnet", "Sonnet (invented)", "Fast"], ["haiku", "Haiku (invented)", "Fastest"]]),
              group("Elsewhere", [["pro", "Pro (invented)", "Long context"], ["flash", "Flash (invented)", "Cheap"], ["reasoner", "Reasoner (invented)", "Thinks longer"]]),
              group("On this machine", [["local-30b", "local-30b (invented)", "Big"], ["local-8b", "local-8b (invented)", "Small"]]),
            ],
          },
          { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }, { value: "plan", name: "Plan" }] },
          { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
        ],
        commands: [
          { name: "code-review", description: "Review the current diff (invented)" },
          { name: "compact", description: "Summarise the chat so far (invented)" },
        ],
      },
    },
  });

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
  // WHAT THE HOST POSTS INTO BOXES, counted by kind, and every hello a box
  // says — read, never changed.
  await page.addInitScript(() => {
    const w = window as unknown as { __posted: Record<string, number>; __hellos: number };
    w.__posted = {};
    w.__hellos = 0;
    const orig = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (this: MessagePort, m: unknown, t?: unknown) {
      const kind = m && typeof m === "object" ? (m as { kind?: unknown }).kind : undefined;
      if (typeof kind === "string" && kind.startsWith("look.")) w.__posted[kind] = (w.__posted[kind] ?? 0) + 1;
      return (orig as (m: unknown, t?: unknown) => void).call(this, m, t as never);
    } as typeof MessagePort.prototype.postMessage;
    // Only the look's own box: a page box reloading as the route comes back
    // to it is the page view's business.
    addEventListener("message", (e) => {
      const box = document.querySelector("div.agentbox iframe") as HTMLIFrameElement | null;
      if (box && e.source === box.contentWindow && e.data && typeof e.data === "object" && (e.data as { kind?: unknown }).kind === "hello") w.__hellos++;
    });
  });
}, 120000);

// THE TEARDOWN IS BOUNDED, EVERY PART OF IT, and the hook's own bound is past
// the sum, as app.e2e.ts's is — bun's default for a hook is five seconds.
// Closing the browser is raced against ten seconds because it was MEASURED not
// to settle: in full `make e2e` runs, after every step of this walk had passed,
// the page closed at once and `browser.close()` never returned, which failed
// the file as a hook timeout. Why is not known — Playwright settles a close on
// the browser's pipes closing, not on its exit — and a browser left running is
// killed by Playwright's own handler when this process exits. The server is
// waited on for twelve seconds, past its own graceful end of the agents
// (`AGENTS_ENDING_MS`).
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

walk("1. a window with no hash opens on the Agent screen: the look in its box, Biom's own input over it, the agent's own pickers", "agent-1.png", async () => {
  await page.goto(at(""), { waitUntil: "domcontentloaded" });
  await until("the window went to the Agent screen", BOUNDS.draw, async () => (await hash()) === "#/agent");
  await until("the look drew its start screen in its box", BOUNDS.draw, async () => await lookSays("What should we"));
  // THE INPUT IS THE HOST'S: in this document, not the box's, and marked so
  // typing to the agent is never a touch of the screen.
  const input = page.locator("#agentta");
  expect(await input.count()).toBe(1);
  expect(await input.getAttribute("placeholder")).toBe("Ask anything");
  expect(await input.evaluate((el) => el.closest("[data-no-touch]") !== null)).toBe(true);
  expect(await (await lookFrame()).locator("textarea").count()).toBe(0);
  // The rail: the Agent row lit, Home as the tree's heading, no Dashboard.
  expect(await page.locator("button.agentlink[aria-current=page]").count()).toBe(1);
  expect(await page.locator("button.dashboardlink").count()).toBe(0);
  // The agent is found and probed, and its own options are the pickers.
  await until("the fake agent is Active", 30000, async () => (await agentState())?.state === "active");
  await until("the pickers show the agent's options", 15000, async () =>
    (await page.locator(".agentdock .chip").allInnerTexts()).map((t) => t.trim()).join("|") === "Claude Code|Opus (invented)|Default|High");
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("screen");
});

walk("2. / opens one list, narrowed as it is typed and worked from the keyboard; a pick puts /name in the input and sends nothing", "agent-2.png", async () => {
  const input = page.locator("#agentta");
  await input.click();
  await input.pressSequentially("/");
  await until("the / menu opened", 10000, async () => (await page.locator("#agentslash .srow").count()) > 0);
  const all = await page.locator("#agentslash .srow .sn").allInnerTexts();
  expect(all).toContain("/code-review");
  expect(all).toContain("/compact");
  // The workspace's own skills the agent did not list are on it too.
  expect(all.some((n) => n.startsWith("/biom-"))).toBe(true);
  expect([...all].sort((a, b) => a.slice(1).localeCompare(b.slice(1)))).toEqual(all);
  await input.pressSequentially("co");
  await until("it narrowed", 5000, async () => (await page.locator("#agentslash .srow .sn").allInnerTexts()).every((n) => n.startsWith("/co")));
  expect(await page.locator("#agentslash .srow").first().getAttribute("aria-selected")).toBe("true");
  await input.press("ArrowDown");
  expect(await page.locator("#agentslash .srow").nth(1).getAttribute("aria-selected")).toBe("true");
  await input.press("ArrowUp");
  await input.press("Enter");
  expect(await input.inputValue()).toBe("/code-review ");
  expect(await page.locator("#agentslash").isHidden()).toBe(true);
  expect(await hash()).toBe("#/agent");
  expect(await call<ChatSummary[]>("chat.list")).toEqual([]);
  // Escape shuts it without a pick.
  await input.fill("");
  await input.pressSequentially("/c");
  await until("the / menu opened again", 5000, async () => !(await page.locator("#agentslash").isHidden()));
  await input.press("Escape");
  expect(await page.locator("#agentslash").isHidden()).toBe(true);
  await input.fill("");
});

walk("3. a first message is the words typed and nothing else, and the chat is handed to the look through its own box", "agent-3.png", async () => {
  const input = page.locator("#agentta");
  const before = await page.evaluate(() => ({ ...(window as unknown as { __posted: Record<string, number> }).__posted }));
  await input.fill("Tidy up the invented boards page");
  await input.press("Enter");
  await until("the chat has an address", 10000, async () => /^#\/agent\/[A-Za-z0-9_-]{8,}$/.test(await hash()));
  chat = (await hash()).split("/")[2] as string;
  await until("the turn ended", 30000, async () => (await summaryOf(chat))?.stop === "end_turn");
  const read = await call<ChatRead>("chat.read", { chat });
  const prompts = read.updates.filter((u) => u.kind === "prompt").map((u) => (u as { text: string }).text);
  expect(prompts).toEqual(["Tidy up the invented boards page"]);
  expect(read.chat.agent).toBe(AGENT);
  expect(await input.inputValue()).toBe("");
  expect(await input.getAttribute("placeholder")).toBe("Reply");
  // The input moved to the foot of the chat and told the look how much it covers.
  expect(await page.locator(".agentdock").getAttribute("data-at")).toBe("bottom");
  await until("the look drew the chat", 10000, async () => await lookSays("Tidy up the invented boards page"));
  const after = await page.evaluate(() => (window as unknown as { __posted: Record<string, number> }).__posted);
  expect((after["look.state"] ?? 0) + (after["look.patch"] ?? 0)).toBeGreaterThan((before["look.state"] ?? 0) + (before["look.patch"] ?? 0));
  // Once what moves has come to rest: the dock going down, the list opening.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, "agent-chat.png") });
});

walk("4. Send is Stop while a turn runs, the rail counts it working, and Stop ends it cancelled", "agent-4.png", async () => {
  const input = page.locator("#agentta");
  await input.fill("Wait a while\n!sleep 4000");
  await input.press("Enter");
  await until("Send became Stop", 10000, async () => (await page.locator(".agentdock .send").getAttribute("aria-label")) === "Stop");
  await until("the rail counts one chat working", 10000, async () => (await page.locator("button.agentlink .busy").innerText().catch(() => "")) === "1");
  // One message at a time: Enter while it runs sends nothing.
  await input.fill("A second invented message");
  await input.press("Enter");
  expect(await input.inputValue()).toBe("A second invented message");
  await page.locator(".agentdock .send").click();
  await until("the turn ended cancelled", 20000, async () => (await summaryOf(chat))?.stop === "cancelled");
  await until("Stop became Send", 10000, async () => (await page.locator(".agentdock .send").getAttribute("aria-label")) === "Send");
  expect(await page.locator("button.agentlink .busy").count()).toBe(0);
  const read = await call<ChatRead>("chat.read", { chat });
  expect(read.updates.filter((u) => u.kind === "prompt").length).toBe(2);
  await input.fill("");
});

walk("5. a long list shows five and More models, grouped as the agent groups it, and a pick is the agent's option", "agent-5.png", async () => {
  await page.locator(".agentdock .chip[data-category=model]").click();
  const rows = page.locator(".agentmenu .mi[role=menuitemradio]");
  expect(await rows.count()).toBe(5);
  expect(await rows.first().getAttribute("aria-checked")).toBe("true");
  await page.locator(".agentmenu .mi.addagent").click();
  await until("More models opened", 5000, async () => (await page.locator(".amodal .adialog").count()) === 1);
  expect(await page.locator(".amodal .agrp").allInnerTexts()).toEqual(["INVENTED LABS", "ELSEWHERE", "ON THIS MACHINE"].map((s) => s));
  await page.locator(".amodal .asearch input").fill("reason");
  expect(await page.locator(".amodal .arow").count()).toBe(1);
  await page.locator(".amodal .asearch input").press("Enter");
  await until("the dialog shut", 5000, async () => (await page.locator(".amodal").count()) === 0);
  await until("the agent's model is the one picked", 10000, async () => {
    const read = await call<ChatRead>("chat.read", { chat });
    const config = read.updates.filter((u) => u.kind === "config").at(-1) as { options: { id: string; value: unknown }[] } | undefined;
    return config?.options.find((o) => o.id === "model")?.value === "reasoner";
  });
  await until("the chip says it", 5000, async () => (await page.locator(".agentdock .chip[data-category=model]").innerText()).includes("Reasoner"));
});

walk("6. Edit opens a new chat beside the page with its location typed in, and the chat is for that page", "agent-6.png", async () => {
  await page.locator("div.railhead button.homerow").click();
  await until("the root page drew", BOUNDS.draw, async () => {
    const text = await page.frameLocator("div.plate iframe.artifact").locator("body").innerText().catch(() => "");
    return text.length > 0;
  });
  // Home from the full Agent screen brings the open chat along, in the panel
  // beside the page (DECISIONS O24(b)).
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  await page.locator("button.tool.edit").click();
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  const input = page.locator("#agentta");
  expect(await input.inputValue()).toBe("Edit home: ");
  expect(await input.evaluate((el) => (el as HTMLTextAreaElement).selectionStart)).toBe("Edit home: ".length);
  await until("the context says the panel is open, with no chat yet", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === null && w.address.view === "page";
  });
  await input.pressSequentially("tidy the invented headings");
  await input.press("Enter");
  await until("the chat began beside the page", 10000, async () => (await myWindow())?.chat !== null);
  edited = (await myWindow())?.chat as string;
  expect(await hash()).toBe("#/page/home");
  const uid = /^uid:\s*(\S+)/m.exec(readFileSync(join(vault, "pages", "home", "content.yaml"), "utf8"))?.[1];
  expect((await summaryOf(edited))?.page).toEqual({ view: "page", uid, screen: "page" });
  const read = await call<ChatRead>("chat.read", { chat: edited });
  expect(read.updates.filter((u) => u.kind === "prompt").map((u) => (u as { text: string }).text)).toEqual(["Edit home: tidy the invented headings"]);
  await until("the turn ended", 30000, async () => (await summaryOf(edited))?.phase === "idle");
  // Once what moves has come to rest: the dock going down, the list opening.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, "agent-panel.png") });
});

walk("7. the panel maximises and minimises with the same box, never reloaded, and the context follows", "agent-7.png", async () => {
  const hellos = await page.evaluate(() => (window as unknown as { __hellos: number }).__hellos);
  await page.evaluate(() => { (window as unknown as { __box: Element | null }).__box = document.querySelector("div.agentbox iframe"); });
  const f = await lookFrame();
  await f.getByRole("button", { name: "Open full size" }).click();
  await until("the Agent screen, with the chat", 10000, async () => (await hash()) === `#/agent/${edited}`);
  await until("the context says the panel is shut", 10000, async () => (await myWindow())?.panel === false);
  await (await lookFrame()).locator("button.minbtn").click();
  await until("back beside the page", 10000, async () => (await hash()) === "#/page/home");
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  await until("the context says the panel is open with the chat", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === edited && w.address.view === "page";
  });
  expect(await page.evaluate(() => (window as unknown as { __hellos: number }).__hellos)).toBe(hellos);
  expect(await page.evaluate(() => (window as unknown as { __box: Element | null }).__box === document.querySelector("div.agentbox iframe"))).toBe(true);
  // THE PANEL'S WIDTH is pulled from its left edge, across the page's own box
  // without the box taking the pointer, and kept for this browser.
  const edge = await page.evaluate(() => document.querySelector("div.agentslot")!.getBoundingClientRect().x);
  const wide = await page.evaluate(() => document.querySelector("div.agentslot")!.getBoundingClientRect().width);
  await page.mouse.move(edge - 2, 400);
  await page.mouse.down();
  for (let x = edge - 2; x >= edge - 162; x -= 20) await page.mouse.move(x, 400);
  await page.mouse.up();
  const pulled = await page.evaluate(() => document.querySelector("div.agentslot")!.getBoundingClientRect().width);
  expect(Math.round(pulled - wide)).toBe(160);
  expect(await page.evaluate(() => localStorage.getItem("biom:agentPanel"))).toBe(String(Math.round(pulled)));
  expect(await page.evaluate(() => (window as unknown as { __box: Element | null }).__box === document.querySelector("div.agentbox iframe"))).toBe(true);
  // Close from the panel's own head.
  await (await lookFrame()).getByRole("button", { name: "Close the chat" }).click();
  await until("the panel shut", 10000, async () => (await page.locator("div.bed").getAttribute("data-agent")) === "none");
  await until("the context says so", 10000, async () => (await myWindow())?.panel === false);
});

walk("8. the window remembers its chat across a reload, and the rail's Agent returns to it", "agent-8.png", async () => {
  await page.locator("button.tool.edit").click();
  await until("the panel is open on a new thread", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === null;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await until("the panel came back", BOUNDS.draw, async () => (await page.locator("div.bed").getAttribute("data-agent")) === "panel");
  await page.locator("button.agentlink").click();
  await until("the Agent screen", 10000, async () => (await hash()).startsWith("#/agent"));
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("screen");
  // Edit left the window on a new thread, and that is what it had open.
  expect(await hash()).toBe("#/agent");
  await page.goto(at(`#/agent/${chat}`), { waitUntil: "domcontentloaded" });
  await page.locator("div.railhead button.homerow").click();
  await until("the root page", 10000, async () => (await hash()) === "#/page/home");
  await page.locator("button.agentlink").click();
  await until("the Agent screen came back to the chat that was open", 10000, async () => (await hash()) === `#/agent/${chat}`);
});

walk("9. a first message to an agent not signed in waits, says so, and goes out once Sign in has run the agent's own command", "agent-9.png", async () => {
  rmSync(signedIn, { force: true });
  await call("agents.probe", { agent: AGENT });
  await until("the agent asks to be signed in", 30000, async () => (await agentState())?.reason === "signin");
  await page.goto(at("#/agent"), { waitUntil: "domcontentloaded" });
  await until("the input is up", BOUNDS.draw, async () => (await page.locator("#agentta").count()) === 1);
  await until("the chip names the agent, Inactive", 15000, async () =>
    (await page.locator(".agentdock .agentchip").innerText()).includes("Claude Code") &&
    (await page.locator(".agentdock .agentchip .led").getAttribute("class")) === "led");
  const input = page.locator("#agentta");
  await input.fill("An invented message that waits");
  await input.press("Enter");
  await until("More agents opened, saying the message waits", 30000, async () =>
    (await page.locator(".amodal p.why").innerText().catch(() => "")).startsWith("Your message is waiting. Sign in to Claude Code"));
  const held = (await hash()).split("/")[2] as string;
  expect((await summaryOf(held))?.phase).toBe("held");
  // Once what moves has come to rest: the dock going down, the list opening.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, "agent-held.png") });
  await page.locator(`.amodal .arow[data-agent=${AGENT}] button.abtn.go`).click();
  // The agent's own sign-in, in the pop-up, from the ticket; it closes by
  // itself when the command exits.
  await until("the sign-in ran", 20000, async () => existsSync(signedIn));
  await until("the message went out and its turn ended", 45000, async () => (await summaryOf(held))?.stop === "end_turn");
  await until("More agents shut when it did", 10000, async () => (await page.locator(".amodal").count()) === 0);
  const read = await call<ChatRead>("chat.read", { chat: held });
  expect(read.updates.filter((u) => u.kind === "prompt").map((u) => (u as { text: string }).text)).toEqual(["An invented message that waits"]);
  // Sent once: one reply for the one prompt.
  expect(read.updates.filter((u) => u.kind === "reply").map((u) => (u as { text: string }).text).join("")).toBe("echo: An invented message that waits");
});

walk("10. a page the agent makes is brought up beside the chat, though the history names it before the tree lists it", "agent-10.png", async () => {
  // The chat from 9, on the full Agent screen, its agent signed in and idle.
  const made = (await hash()).split("/")[2] as string;
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("screen");
  const input = page.locator("#agentta");
  await input.fill("!write pages/home/children/Fresh/content.yaml name: Fresh");
  await input.press("Enter");
  await until("the turn that made Fresh ended", 30000, async () => (await summaryOf(made))?.turn === 2 && (await summaryOf(made))?.phase === "idle");
  await until("the window went to the page the agent made", 10000, async () => (await hash()) === "#/page/" + encodeURIComponent("home/Fresh"));
  expect(await page.locator("div.bed").getAttribute("data-agent")).toBe("panel");
  expect(await page.locator("div.agentbox iframe").count()).toBe(1);
  await until("Go back to shows", 10000, async () => (await page.locator(".backslot button").count()) === 1);
  await until("the context names the switcher's screen with the chat beside it", 10000, async () => {
    const w = await myWindow();
    return w?.panel === true && w.chat === made && w.address.view === "page" && w.address.id === "home/Fresh";
  });
});

afterAll(() => {
  // The three pictures a person looks at first, beside the run's own.
  for (const name of ["agent-chat.png", "agent-panel.png", "agent-held.png"]) {
    const from = join(SHOTS, name);
    const to = process.env.AGENT_SHOTS;
    if (to && existsSync(from)) copyFileSync(from, join(to, name));
  }
});
