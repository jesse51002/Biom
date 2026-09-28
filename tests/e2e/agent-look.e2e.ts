// SPDX-License-Identifier: AGPL-3.0-only
// THE AGENT SCREEN'S LOOK, IN A REAL BOX, IN A REAL BROWSER.
//
// The host side of the Agent screen is a module of its own with tests of its
// own, so this does not go through the app. It builds the box exactly as the app does — the real shim
// woven in by `weave`, the real runtime by `weaveRuntime`, the real plugin
// bundle by `pluginBundle` over the framework's `guest/plugins/` — puts it in
// a `sandbox="allow-scripts"` srcdoc frame at an opaque origin, and stands in
// for the host with a page that answers the handshake, `page.read` and
// `theme.get`, records every request the box makes, and posts `look.state` and
// `look.patch` from the fixtures in `tests/agent-look-fixtures.js`, which are
// invented. Every request is served by Playwright from this checkout; nothing
// listens on a port.
//
// WHAT IT HOLDS: the start screen, and its line frame by frame — the word
// turning as one word on one centre, the swap as wide as its word at any size,
// nothing restarted by the start screen handed over again and again, and its
// two lines holding their place as the input goes to the foot and fading as
// they lift away into a chat every time; a chat mid-turn, a finished one, a
// red one and the panel draw; a patch appends where it belongs and leaves the
// rest of the thread's nodes alone, and a stale one is dropped; the chat's ⋯
// and its View menu, worked from the keyboard, fit on a desktop, at the
// panel's narrowest and at a phone's width; an agent's words never become
// markup; the look asks for nothing but its own kinds and `open`; reduced
// motion rests still with faces as text; and a pagehide leaves nothing behind.
// Pictures of each land in `dist/e2e/`, or in `LOOK_SHOTS` if set.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

import { HERE, SHOTS } from "./harness.ts";
import { pluginBundle } from "../../server/main.ts";
import { makeFiles } from "../../server/platform/files.ts";
import { weave } from "../../client/frame/frame.js";
import { weaveRuntime } from "../../client/platform/document.js";
import { faceCss } from "../../client/theme/faces.js";
import { DEFAULT_THEME } from "../../client/theme/palettes.js";
import { lookState, chatState, cid } from "../agent-look-fixtures.js";

const ORIGIN = "http://look.test";
const OUT = process.env.LOOK_SHOTS || SHOTS;
/** Every wait in here is bounded, and this is the bound. */
const BOUND = 15000;

/** The owner's palette, Dot matrix, which carries the LED tokens. Invented
 *  as a fixture from the shape `Theme` has; the values are the vault's own. */
const DOT_MATRIX = {
  palette: {
    name: "Dot matrix",
    colors: {
      stock: "#0E0F11", stockHi: "#16181B", stockLo: "#0A0B0C", stockEdge: "#2C3036", field: "#16181B",
      ink: "#EDE6D6", ink2: "#B9B3A5", ink3: "#7E7A70", rule: "#2C3036", ruleSoft: "#23262B",
      led: "#FFB020", ledDim: "#5A3E0E", ledRed: "#FF4A3D", ledGreen: "#5BE37D", dotOff: "#23262B", flap: "#EDE6D6",
      cyan: "#FFB020", magenta: "#FF4A3D", yellow: "#FFB020", cyanT: "#B8780F", magentaT: "#A8302A",
      nonrepro: "#3A3F47", nonreproT: "#55606B", onSpot: "#16181B",
    },
    extra: [],
  },
  fonts: {
    roles: { sheet: "Atkinson Hyperlegible Next", furniture: "Workbench", gauge: "Cascadia Code" },
    available: DEFAULT_THEME.fonts.available,
  },
};

const TYPES: Record<string, string> = { ".js": "text/javascript", ".woff2": "font/woff2", ".webp": "image/webp", ".html": "text/html", ".css": "text/css" };

let browser: Browser | null = null;
let vault = "";
let srcdoc = "";
let bundle = "";

/** The stand-in host: one frame, the handshake, the two ports, and a record
 *  of every request the box made on its guest port. */
/** JSON that is safe inside a `<script>`: the srcdoc is full of `</script>`. */
const inline = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c");

function hostPage(theme: unknown): string {
  const page = {
    sections: [], variables: {}, markdown: {}, plugin: "biom-agent", input: {}, name: "Agent",
    extensions: { "biom-agent": { values: { look: (globalThis as any).__lookName ?? "biom-agent-look" }, from: {}, faults: [] } },
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;display:block;width:100%;height:100%}</style></head><body>
<iframe id="box" sandbox="allow-scripts"></iframe>
<script>
(() => {
  const PAGE = ${inline(page)};
  const THEME = ${inline(theme)};
  const box = document.getElementById("box");
  let runtime = null, guest = null;
  const host = window.__host = { calls: [], said: [], ready: 0, post(m) { if (guest) guest.postMessage(m); } };
  const ok = (port, id, value) => port.postMessage({ id, g: 1, ok: true, value });
  window.addEventListener("message", (ev) => {
    if (ev.source !== box.contentWindow || !ev.data || ev.data.kind !== "hello") return;
    const r = new MessageChannel(), g = new MessageChannel();
    runtime = r.port1; guest = g.port1;
    runtime.onmessage = (e) => {
      const m = e.data || {};
      if (m.kind === "ready") { host.ready++; return; }
      if (m.kind === "error") { host.said.push(String(m.message)); return; }
      if (typeof m.id !== "string") return;
      if (m.kind === "page.read") ok(runtime, m.id, PAGE); else ok(runtime, m.id, null);
    };
    guest.onmessage = (e) => {
      const m = e.data || {};
      if (m.kind === "error") { host.said.push(String(m.message)); return; }
      if (typeof m.id !== "string") return;
      if (m.kind === "theme.get") return ok(guest, m.id, THEME);
      if (m.kind === "data.get") return ok(guest, m.id, {});
      host.calls.push(m);
      ok(guest, m.id, null);
    };
    box.contentWindow.postMessage({ kind: "ports", g: 1, page: "@agent" }, "*", [r.port2, g.port2]);
  });
  box.srcdoc = ${inline(srcdoc)};
})();
</script></body></html>`;
}

async function open(opts: { theme?: unknown; reduced?: boolean; width?: number; height?: number } = {}): Promise<{ ctx: BrowserContext; page: Page; box: Frame }> {
  if (!browser) throw new Error("no browser");
  // THE BROWSER'S TIME ZONE IS THIS PROCESS'S — bun's test runner is UTC — so
  // the day the fixtures were built on is the day the look groups them by.
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1180, height: opts.height ?? 780 },
    reducedMotion: opts.reduced ? "reduce" : "no-preference",
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const page = await ctx.newPage();
  const theme = opts.theme ?? DOT_MATRIX;
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const p = decodeURIComponent(url.pathname);
    if (p === "/") return route.fulfill({ status: 200, contentType: "text/html", body: hostPage(theme) });
    if (p.startsWith("/v/") && p.endsWith("/plugin/")) return route.fulfill({ status: 200, contentType: "text/javascript", body: bundle });
    const roots: [string, string][] = [["/guest/", "guest/"], ["/vendor/", "vendor/"], ["/fonts/", "client/fonts/"]];
    for (const [prefix, dir] of roots) {
      if (!p.startsWith(prefix)) continue;
      const file = join(HERE, dir, p.slice(prefix.length));
      if (!file.startsWith(join(HERE, dir)) || !existsSync(file)) break;
      return route.fulfill({ status: 200, headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" }, body: readFileSync(file) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => (window as any).__host && (window as any).__host.ready > 0, null, { timeout: BOUND });
  const box = page.frames().find((f) => f !== page.mainFrame());
  if (!box) throw new Error("no box");
  await box.waitForFunction(() => {
    const host = document.querySelector("#g-agent .g-look-host");
    return !!(host && host.shadowRoot && host.shadowRoot.querySelector(".g-look"));
  }, null, { timeout: BOUND });
  return { ctx, page, box };
}

/** Post a message as the host would, and give the box a frame to draw it. */
async function post(page: Page, box: Frame, m: unknown): Promise<void> {
  await page.evaluate((msg) => (window as any).__host.post(msg), m as any);
  await box.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Evaluate against the look's shadow root inside the box. */
async function inLook<T>(box: Frame, fn: string): Promise<T> {
  return await box.evaluate((src) => {
    const root = document.querySelector("#g-agent .g-look-host")!.shadowRoot!;
    return new Function("root", src)(root);
  }, fn) as T;
}

/** The requests the box has made, once `n` of them have crossed the port —
 *  a click posts at once and the host hears it a task later. */
async function calls(page: Page, n: number): Promise<any[]> {
  await page.waitForFunction((want) => (window as any).__host.calls.length >= want, n, { timeout: BOUND }).catch(() => {});
  return await page.evaluate(() => (window as any).__host.calls.map((c: any) => { const { id, g, ...rest } = c; return rest; }));
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `agent-look-${name}.png`) });
}

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "biom-look-"));
  bundle = await (await pluginBundle(vault, makeFiles(join(HERE, "guest/plugins")))).text();
  const shim = readFileSync(join(HERE, "guest/biom.js"), "utf8");
  const doc = readFileSync(join(HERE, "guest/plugins/biom-agent/index.html"), "utf8");
  srcdoc = weave(shim, weaveRuntime(doc, { id: "@agent", name: "Agent", plugin: "biom-agent", input: {} }, vault), "", faceCss(`${ORIGIN}/fonts/`));
  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
}, 60000);

afterAll(async () => {
  try { await browser?.close(); } catch { /* already gone */ }
  if (vault) rmSync(vault, { recursive: true, force: true });
});

test("the start screen: the line, its turning word, the ribbon behind it, and the history link", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: lookState({ input: { at: "center", height: 118 } }) });
    const seen = await inLook<any>(box, `
      const look = root.querySelector(".g-look");
      const c = root.querySelector(".fx canvas");
      const g = c.getContext("2d");
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
      return { state: look.getAttribute("data-state"), line: root.querySelector(".line").textContent, hist: root.querySelector(".histlink").textContent, lit, threads: look.hasAttribute("data-threads") };`);
    expect(seen.state).toBe("empty");
    expect(seen.line).toBe("What should we automate?");
    expect(seen.hist).toContain("View chat history");
    expect(seen.hist).toContain("1 working");
    expect(seen.lit).toBeGreaterThan(100);
    expect(seen.threads).toBe(false);
    await shot(page, "start");
    // The word turns.
    await box.waitForFunction(() => document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".line")!.textContent !== "What should we automate?", null, { timeout: BOUND });
    // View chat history opens the history beside it, and says so to the host.
    await box.locator(".histlink").click();
    expect(await calls(page, 1)).toEqual([{ kind: "look.list", open: true }]);
    expect(await inLook<boolean>(box, `return root.querySelector(".g-look").hasAttribute("data-threads");`)).toBe(true);
  } finally { await ctx.close(); }
}, 60000);

/** ONE TURN OF THE START LINE'S WORD, frame by frame, read inside the box:
 *  from the frame the next word arrives until the one it replaced is gone.
 *  Each frame has the line's lead-in ("What should we "), the swap's width,
 *  and each word's line boxes, padding and colour, in the box's pixels. */
async function turnFrames(box: Frame): Promise<any[]> {
  return await box.evaluate((bound) => new Promise((done, fail) => {
    const root = document.querySelector("#g-agent .g-look-host")!.shadowRoot!;
    const swap = root.querySelector(".swap")!;
    const lead = root.querySelector(".line")!.firstChild!;
    const lines = (n: Node) => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()].map((q) => ({ x: q.x, y: q.y, w: q.width })); };
    const frames: any[] = [];
    const sample = () => frames.push({
      lead: lines(lead)[0], swap: swap.getBoundingClientRect().width, size: parseFloat(getComputedStyle(swap).fontSize),
      words: [...swap.children].map((s) => { const cs = getComputedStyle(s); return { word: s.textContent, cls: s.className, lines: lines(s), padding: cs.paddingLeft + " " + cs.paddingRight, colour: cs.color }; }),
    });
    const late = setTimeout(() => fail(new Error("no word turned within " + bound + "ms")), bound);
    const watch = new MutationObserver(() => {
      if (swap.children.length !== 2) return;
      watch.disconnect();
      const tick = () => { sample(); if (swap.children.length > 1) requestAnimationFrame(tick); else { clearTimeout(late); done(frames); } };
      tick();
    });
    watch.observe(swap, { childList: true });
  }), BOUND) as any[];
}

test("THE WORD TURNS AS ONE WORD: the leaving word takes no rule of the thread's, stays on its line in its colour, and the arriving one never leaves the line", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: lookState({ input: { at: "center", height: 118 } }) });
    const frames = await turnFrames(box);
    expect(frames.length).toBeGreaterThan(10);
    const led = frames[0].words.at(-1).colour;
    for (const f of frames) {
      for (const w of f.words) {
        // `.out` is the tool output's rule, and a word named `out` took its
        // padding and its wrapping: the leaving word broke over lines.
        expect([w.word, w.cls, w.padding, w.lines.length, w.colour]).toEqual([w.word, w.cls, "0px 0px", 1, led]);
        // Each word moves three tenths of its size up or down as it turns, and
        // no further: never lifted off the line by the other one.
        expect([w.word, Math.abs(w.lines[0].y - f.lead.y) <= f.size * 0.3 + 1]).toEqual([w.word, true]);
      }
    }
  } finally { await ctx.close(); }
}, 60000);

test("THE TWO WORDS OF A TURN SHARE ONE CENTRE in every frame, the wider leaving and the wider arriving, while the line opens or closes round them", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: lookState({}) });
    // automate → plan, the one leaving wider; plan → create, the one arriving.
    for (const turn of [await turnFrames(box), await turnFrames(box)]) {
      const centre = (w: any) => w.lines[0].x + w.lines[0].w / 2;
      const pairs = turn.filter((f) => f.words.length === 2);
      expect(pairs.length).toBeGreaterThan(10);
      const which = pairs[0].words.map((w: any) => w.word).join(" → ");
      const apart = Math.max(...pairs.map((f) => Math.abs(centre(f.words[0]) - centre(f.words[1]))));
      expect([which, apart <= 1 ? "one centre" : `${Math.round(apart)}px apart`]).toEqual([which, "one centre"]);
    }
  } finally { await ctx.close(); }
}, 60000);

test("THE SWAP IS ITS WORD'S WIDTH, and follows the word's size between turns: narrower than 620 pixels and wide again, without waiting for the next word", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: lookState({}) });
    /** The swap and the word in it once the swap has come to rest: two
     *  frames for a change of size to be seen, then its width's transition. */
    const fit = async () => {
      await box.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await box.waitForFunction(() => document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".swap")!.getAnimations().length === 0, null, { timeout: BOUND });
      return await inLook<any>(box, `
        const swap = root.querySelector(".swap");
        const r = document.createRange(); r.selectNodeContents(swap.lastElementChild);
        return { word: swap.lastElementChild.textContent, words: swap.children.length, size: getComputedStyle(swap).fontSize, swap: swap.getBoundingClientRect().width, text: r.getBoundingClientRect().width };`);
    };
    // Each step is taken just after a turn, well inside the rest before the
    // next, and holds the same word throughout: nothing here waits on a turn.
    for (const width of [560, 1180]) {
      await turnFrames(box);
      const before = await fit();
      expect(Math.abs(before.swap - before.text)).toBeLessThanOrEqual(1);
      await page.setViewportSize({ width, height: 780 });
      await box.waitForFunction((was) => getComputedStyle(document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".swap")!).fontSize !== was, before.size, { timeout: BOUND });
      const after = await fit();
      expect([after.word, after.words]).toEqual([before.word, 1]);
      expect([width, after.size, Math.abs(after.swap - after.text) <= 1 ? "fits" : `${Math.round(after.swap - after.text)}px off`]).toEqual([width, after.size, "fits"]);
    }
  } finally { await ctx.close(); }
}, 60000);

test("INTO A CHAT THE START SCREEN'S LINES FADE AS THEY LIFT AWAY, the second time as the first", async () => {
  const { ctx, page, box } = await open();
  try {
    /** The top line's opacity in each frame from the chat's state landing
     *  until it is gone. */
    const leave = async (): Promise<number[]> => {
      const seen = box.evaluate((bound) => new Promise<number[]>((done, fail) => {
        const root = document.querySelector("#g-agent .g-look-host")!.shadowRoot!;
        const look = root.querySelector(".g-look")!;
        const hero = root.querySelector(".hero-top")!;
        const late = setTimeout(() => fail(new Error("the chat never drew")), bound);
        const was: number[] = [];
        const watch = new MutationObserver(() => {
          if (look.getAttribute("data-state") !== "live") return;
          watch.disconnect();
          const tick = () => { const cs = getComputedStyle(hero); if (cs.display === "none") { clearTimeout(late); done(was); return; } was.push(parseFloat(cs.opacity)); requestAnimationFrame(tick); };
          tick();
        });
        watch.observe(look, { attributes: true, attributeFilter: ["data-state"] });
      }), BOUND);
      await page.evaluate((m) => (window as any).__host.post(m), { kind: "look.state", state: chatState("done") } as any);
      return await seen;
    };
    await post(page, box, { kind: "look.state", state: lookState({}) });
    const first = await leave();
    await post(page, box, { kind: "look.state", state: lookState({}) });
    // The lines come back in, and have finished coming in.
    await box.waitForFunction(() => document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".hero-top")!.getAnimations().every((a) => a.playState === "finished"), null, { timeout: BOUND });
    const second = await leave();
    for (const [which, was] of [["first", first], ["second", second]] as const) {
      expect([which, was.some((o) => o > 0.05 && o < 0.95)]).toEqual([which, true]);
    }
  } finally { await ctx.close(); }
}, 60000);

test("THE START SCREEN'S LINES HOLD THEIR PLACE while the input goes to the foot ahead of the chat", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: lookState({ input: { at: "center", height: 118 } }) });
    const where = () => inLook<number[]>(box, `return [".hero-top", ".hero-bot"].map((s) => Math.round(root.querySelector(s).getBoundingClientRect().top));`);
    const before = await where();
    // The host moves the input to the foot the moment a chat is picked, and
    // hands the chat over once its stream is read: the start screen is still up.
    await post(page, box, { kind: "look.patch", chat: null, input: { at: "bottom", height: 300 } });
    expect(await where()).toEqual(before);
  } finally { await ctx.close(); }
}, 60000);

test("THE START SCREEN HANDED OVER WHOLE AGAIN AND AGAIN, as the host does whenever its shape moves, leaves the word turning on time and the ribbon drawn in every frame", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: lookState({}) });
    // Inside the box: each word that arrives, and after each frame is painted
    // whether the middle of the ribbon, which it always crosses, is dark.
    await box.evaluate(() => {
      const root = document.querySelector("#g-agent .g-look-host")!.shadowRoot!;
      const w = window as any;
      w.__turns = 0;
      w.__dark = 0;
      w.__frames = 0;
      new MutationObserver((ms) => { for (const m of ms) w.__turns += m.addedNodes.length; }).observe(root.querySelector(".swap")!, { childList: true });
      const c = root.querySelector(".fx canvas") as HTMLCanvasElement;
      const g = c.getContext("2d")!;
      const look = () => requestAnimationFrame(() => setTimeout(() => {
        const px = g.getImageData(Math.round(c.width * 0.5) - 40, Math.round(c.height * 0.58) - 40, 80, 80).data;
        let lit = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
        w.__frames++;
        if (lit === 0) w.__dark++;
        if (!w.__stop) look();
      }, 0));
      look();
    });
    // Every 700 milliseconds for 6.3 seconds: before the start screen took
    // only what changed, each one restarted the word's 2.6 second wait and
    // cleared the ribbon's canvas for the frame after.
    for (let i = 0; i < 9; i++) {
      await page.evaluate((m) => (window as any).__host.post(m), { kind: "look.state", state: lookState({ list: i % 2 === 0 }) } as any);
      await page.waitForTimeout(700);
    }
    const seen = await box.evaluate(() => { const w = window as any; w.__stop = true; return { turns: w.__turns, dark: w.__dark, frames: w.__frames }; });
    expect(seen.frames).toBeGreaterThan(100);
    expect(seen.turns).toBeGreaterThanOrEqual(2);
    expect(seen.dark).toBe(0);
  } finally { await ctx.close(); }
}, 60000);

test("a chat mid-turn: the history left, the finished turn whole, the running one with its loader, and room for the input", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: chatState("live") });
    const seen = await inLook<any>(box, `
      const look = root.querySelector(".g-look");
      const turns = [...root.querySelectorAll(".turnw")];
      const moods = turns.map((t) => { const m = t.querySelector(".mood"); return m.querySelector("img") ? "img:" + m.querySelector("img").getAttribute("src") : m.querySelector(".dm") ? "dm" : m.textContent; });
      const acts = [...root.querySelectorAll(".act")].map((a) => a.querySelector(".verb").textContent + "|" + a.querySelector(".obj").textContent + "|" + a.querySelector(".meta").textContent);
      const log = root.querySelector(".log");
      const input = parseFloat(getComputedStyle(log).bottom);
      return { state: look.getAttribute("data-state"), threads: look.hasAttribute("data-threads"), rows: root.querySelectorAll(".trow").length,
        groups: [...root.querySelectorAll(".tgroup")].map((g) => g.textContent), moods, acts,
        prose: root.querySelector(".prose").textContent, strong: root.querySelector(".prose strong")?.textContent,
        changes: [...root.querySelectorAll(".crow")].map((r) => r.textContent), foot: root.querySelector(".tfoot:not([hidden])")?.textContent,
        thinking: turns[1].querySelector(".think").textContent, input, selected: root.querySelector(".trow[aria-selected=true] .t").textContent,
        runs: [...root.querySelectorAll(".grp")].map((g) => g.querySelector(".glabel").textContent + "|" + g.querySelector(".gcur").textContent + "|" + g.getAttribute("aria-expanded")),
        shut: [...root.querySelectorAll(".grplist")].map((l) => getComputedStyle(l).display) };`);
    expect(seen.state).toBe("live");
    expect(seen.threads).toBe(true);
    expect(seen.rows).toBe(5);
    expect(seen.groups).toEqual(["Today", "Yesterday", "This week", "Earlier"]);
    expect(seen.moods).toEqual(["img:/vendor/noto/1f60c.webp", "dm"]);
    expect(seen.acts[0]).toBe("Read|pages/home/children/Boards/content.yaml|");
    expect(seen.acts[1]).toBe("Edited|pages/home/children/Boards/content.yaml|+1 −2");
    expect(seen.acts[2]).toContain("Ran|bun run .agents/skills/check.ts");
    expect(seen.acts[3]).toBe("Reading|pages/home/children/Specs/content.yaml|");
    expect(seen.strong).toBe("Someday");
    expect(seen.prose).toContain("same four columns");
    expect(seen.changes[0]).toContain("Boards");
    expect(seen.changes[0]).toContain("Edited");
    expect(seen.foot).toBe("Claude Code · Opus 5.5 · 21s");
    // The second turn thought, then reached for a tool: the thinking is
    // folded and timed, and the tool is what is running.
    expect(seen.thinking).toBe("Thought for 2s");
    // Each run of tool calls is ONE line, shut: what it used, and what is in
    // progress while the turn runs.
    expect(seen.runs).toEqual(["Used 3 tools||false", "Using 1 tool|Reading pages/home/children/Specs/content.yaml|false"]);
    expect(seen.shut).toEqual(["none", "none"]);
    expect(seen.input).toBe(132);
    expect(seen.selected).toBe("Tidy the Boards page");
    // The art loads: it is the vendored file, served, drawn at 26 px.
    await box.waitForFunction(() => { const i = document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".mood img") as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: BOUND });
    // The run opens to its lines, and a tool line to its diff.
    await box.locator(".grp").first().click();
    await box.locator(".act").nth(1).click();
    const diff = await inLook<string[]>(box, `return [...root.querySelectorAll(".detail:not([hidden]) .dl")].map((d) => d.className + "|" + d.textContent);`);
    expect(diff[0]).toContain("path|pages/home/children/Boards/content.yaml");
    expect(diff.some((d) => d.startsWith("dl del|-  - name: Someday"))).toBe(true);
    expect(diff.some((d) => d.startsWith("dl add|+  - name: Later"))).toBe(true);
    await shot(page, "chat-live");
  } finally { await ctx.close(); }
}, 60000);

test("a patch draws only what it adds: the thread's nodes stay, the words stream in, and a stale patch is dropped", async () => {
  const { ctx, page, box } = await open();
  try {
    const state = chatState("live");
    await post(page, box, { kind: "look.state", state });
    await inLook(box, `root.querySelectorAll(".turnw")[0].__kept = 1; root.querySelector(".prose").__kept = 2; return null;`);
    const now = Date.now();
    const turn = 2;
    await post(page, box, { kind: "look.patch", chat: cid("live"), updates: [
      { seq: 20, at: now, turn, kind: "thought", text: " the Specs page first." },
      { seq: 21, at: now, turn, kind: "face", face: { emoji: "🧐", art: "/vendor/noto/1f9d0.webp" } },
      { seq: 22, at: now, turn, kind: "tool", tool: { id: "tool-read-2", title: "Read pages/home/children/Specs/content.yaml", kind: "read", status: "completed", locations: [], diffs: [], output: "", truncated: false } },
      { seq: 23, at: now, turn, kind: "reply", text: "I read the Specs page and I will draw " },
    ] });
    // The same patch again, and a patch for another chat: neither may add a word.
    await post(page, box, { kind: "look.patch", chat: cid("live"), updates: [{ seq: 23, at: now, turn, kind: "reply", text: "I read the Specs page and I will draw " }] });
    await post(page, box, { kind: "look.patch", chat: cid("done"), updates: [{ seq: 99, at: now, turn, kind: "reply", text: "NOT THIS CHAT" }] });
    await post(page, box, { kind: "look.patch", chat: cid("live"), updates: [{ seq: 24, at: now, turn, kind: "reply", text: "the **four** columns." }] });
    // THE FACE FLIPS IN AFTER THE LOADER FOLDS AWAY, which is an animation of
    // its own (`paintMood` in look.js) and not the two frames `post` waits: so
    // it is waited for, bounded, rather than read the instant the patch landed.
    await box.waitForFunction(() => !!document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelectorAll(".turnw")[1]?.querySelector(".mood img"), null, { timeout: BOUND }).catch(() => {});
    const seen = await inLook<any>(box, `
      const turns = root.querySelectorAll(".turnw");
      const second = turns[1];
      return { kept: turns[0].__kept, keptProse: root.querySelector(".prose").__kept, acts: second.querySelectorAll(".act").length,
        verb: second.querySelector(".act .verb").textContent, words: second.querySelector(".prose").textContent,
        caret: !!second.querySelector(".prose .caret"), face: second.querySelector(".mood img") ? second.querySelector(".mood img").getAttribute("src") : null,
        thoughts: [...second.querySelectorAll(".thought")].map((t) => t.textContent) };`);
    expect(seen.kept).toBe(1);
    expect(seen.keptProse).toBe(2);
    expect(seen.acts).toBe(1);
    expect(seen.verb).toBe("Read");
    expect(seen.words).toBe("I read the Specs page and I will draw the four columns.");
    expect(seen.caret).toBe(true);
    expect(seen.face).toBe("/vendor/noto/1f9d0.webp");
    // Thinking after a tool is a block of its own, in the order it came.
    expect(seen.thoughts).toEqual(["The Specs page wants a figure of the four columns. I will read", " the Specs page first."]);
    // The turn ends: the caret goes, the face stays, the light turns green.
    const done = chatState("live").chats.map((c: any) => (c.id === cid("live") ? { ...c, phase: "idle", light: "done", stop: "end_turn" } : c));
    await post(page, box, { kind: "look.patch", chat: cid("live"), updates: [{ seq: 25, at: now + 2000, turn, kind: "turn", phase: "idle", stop: "end_turn", reason: null }], chats: done });
    const after = await inLook<any>(box, `
      const second = root.querySelectorAll(".turnw")[1];
      return { caret: !!second.querySelector(".caret"), strong: second.querySelector(".prose strong")?.textContent, lamp: root.querySelector(".trow[aria-selected=true] .led").className, who: second.querySelector(".who .led").hidden };`);
    expect(after.caret).toBe(false);
    expect(after.strong).toBe("four");
    expect(after.lamp).toBe("led green");
    expect(after.who).toBe(true);
  } finally { await ctx.close(); }
}, 60000);

test("a reply that arrives in the same patch as its turn's end is drawn, in either order", async () => {
  const { ctx, page, box } = await open();
  try {
    const now = Date.now();
    const idle = chatState("live").chats.map((c: any) => (c.id === cid("live") ? { ...c, phase: "idle", light: "done", stop: "end_turn" } : c));
    const reply = { seq: 20, at: now, turn: 2, kind: "reply", text: "Done." };
    const end = { seq: 21, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null };
    for (const updates of [[reply, end], [{ ...end, seq: 20 }, { ...reply, seq: 21 }]]) {
      await post(page, box, { kind: "look.state", state: lookState({ chat: null }) });
      await post(page, box, { kind: "look.state", state: chatState("live") });
      await post(page, box, { kind: "look.patch", chat: cid("live"), updates, chats: idle });
      const words = await inLook<string>(box, `return [...root.querySelectorAll(".turnw")][1].querySelector(".prose")?.textContent ?? "";`);
      expect([updates[0]!.kind, words]).toEqual([updates[0]!.kind, "Done."]);
    }
  } finally { await ctx.close(); }
}, 60000);

test("a turn that ended red says why, a handover is a line in the thread, and a held message waits in words", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: chatState("red") });
    const seen = await inLook<any>(box, `return { notes: [...root.querySelectorAll(".note")].map((n) => n.textContent), hand: root.querySelector(".handover")?.textContent, failed: root.querySelectorAll(".act .led.red").length, emoji: [...root.querySelectorAll(".turnw")].pop().querySelector(".mood").textContent };`);
    expect(seen.notes[0]).toBe("The reply ran out of room. It hit the agent's limit on how long one reply may be.");
    expect(seen.notes[1]).toContain("Codex stopped mid-reply");
    expect(seen.hand).toContain("Codex took over from Claude Code");
    expect(seen.failed).toBe(1);
    expect(seen.emoji).toBe("😵‍💫");
    await shot(page, "chat-red");
    await post(page, box, { kind: "look.state", state: chatState("held") });
    const held = await inLook<any>(box, `return { waits: root.querySelector(".stopped")?.textContent, dm: !!root.querySelector(".mood .dm"), row: root.querySelector(".trow[aria-selected=true] .emo .dm") !== null };`);
    expect(held.waits).toBe("Waiting for an agent to be ready");
    expect(held.dm).toBe(true);
  } finally { await ctx.close(); }
}, 60000);

test("THE THREE VIEWS, as a browser lays them out — a ladder: Plain the words with the thinking folded, Thinking the thinking written out and no tool calls, Tool calls both and one shut line a run — and a failure shows while its run is shut", async () => {
  const { ctx, page, box } = await open();
  try {
    const shown = (sel: string) => `[...root.querySelectorAll(${JSON.stringify(sel)})].map((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0)`;
    const look = () => inLook<any>(box, `return {
      view: root.querySelector(".g-look").getAttribute("data-view"),
      runs: ${shown(".grp")}, lists: ${shown(".grplist")}, folds: ${shown(".think")}, thoughts: ${shown(".thought")},
      style: (() => { const t = root.querySelector(".thought"); if (!t) return ""; const c = getComputedStyle(t); return c.fontStyle + "|" + c.borderLeftStyle + "|" + c.borderLeftWidth; })(),
      failed: [...root.querySelectorAll(".grp .gfail")].map((f) => getComputedStyle(f).display !== "none" ? f.textContent : ""),
    };`);
    await post(page, box, { kind: "look.state", state: chatState("live", { view: "plain" }) });
    let seen = await look();
    expect(seen.view).toBe("plain");
    expect(seen.runs).toEqual([false, false]);
    expect(seen.folds).toEqual([true, true]);
    expect(seen.thoughts).toEqual([false, false]);
    await shot(page, "view-plain");
    await post(page, box, { kind: "look.patch", chat: cid("live"), view: "thinking" });
    seen = await look();
    expect(seen.view).toBe("thinking");
    expect(seen.runs).toEqual([false, false]);
    expect(seen.folds).toEqual([false, false]);
    expect(seen.thoughts).toEqual([true, true]);
    expect(seen.style).toBe("italic|solid|1px");
    await shot(page, "view-thinking");
    await post(page, box, { kind: "look.patch", chat: cid("live"), view: "tools" });
    seen = await look();
    expect(seen.view).toBe("tools");
    expect(seen.runs).toEqual([true, true]);
    expect(seen.lists).toEqual([false, false]);
    expect(seen.folds).toEqual([false, false]);
    expect(seen.thoughts).toEqual([true, true]);
    expect(seen.style).toBe("italic|solid|1px");
    await shot(page, "view-tools");
    // The red chat's run holds a failed call: marked on the shut line.
    await post(page, box, { kind: "look.state", state: chatState("red", { view: "tools" }) });
    seen = await look();
    expect(seen.failed).toEqual(["1 failed"]);
    expect(seen.lists).toEqual([false]);
    // Opened by the keyboard as well as the pointer: Tab reaches it, Enter opens it.
    await box.locator(".grp").first().focus();
    await page.keyboard.press("Enter");
    expect((await look()).lists).toEqual([true]);
    await page.keyboard.press(" ");
    expect((await look()).lists).toEqual([false]);
  } finally { await ctx.close(); }
}, 60000);

test("THE CHAT'S ⋯ AND ITS VIEW MENU, as a browser lays them out: worked from the keyboard, and inside the look on a desktop, at the panel's narrowest and at a phone's width", async () => {
  for (const at of [
    { name: "desktop", width: 1180, height: 780, mode: "screen" },
    { name: "panel-narrowest", width: 320, height: 760, mode: "panel" },
    { name: "phone", width: 375, height: 812, mode: "screen" },
  ]) {
    const { ctx, page, box } = await open({ width: at.width, height: at.height });
    try {
      await post(page, box, { kind: "look.state", state: chatState("done", { mode: at.mode, view: "thinking" }) });
      // Laid out where it comes to rest: the panel's head and the list of
      // chats slide in when the shape changes.
      await box.waitForFunction(() => document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".g-look")!.getAnimations().length === 0, null, { timeout: BOUND });
      // Enter on the ⋯ opens the menu with the caret on its first view; the
      // arrows move; Escape shuts it and hands the caret back to the ⋯.
      await box.locator("button.chatmore").focus();
      await page.keyboard.press("Enter");
      const menu = box.locator(".viewmenu");
      await menu.waitFor({ state: "visible", timeout: BOUND });
      const focused = () => inLook<string>(box, `const a = root.activeElement; return a ? (a.getAttribute("data-view") || a.getAttribute("aria-label") || "") : "";`);
      expect(await focused()).toBe("plain");
      await page.keyboard.press("ArrowDown");
      expect(await focused()).toBe("thinking");
      await box.evaluate(() => Promise.all(document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".viewmenu")!.getAnimations().map((a) => a.finished)));
      const seen = await inLook<any>(box, `
        const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
        const more = root.querySelector("button.chatmore");
        const menu = root.querySelector(".viewmenu");
        const bar = [...more.parentElement.children].filter((e) => getComputedStyle(e).display !== "none").map(r);
        // The thread scrolled to its top: its first message, and the box it
        // scrolls in, whose edge is where anything scrolled is cut.
        const log = root.querySelector(".log");
        log.scrollTop = 0;
        return { w: innerWidth, h: innerHeight, bar, more: r(more), menu: r(menu), log: r(log), first: r(root.querySelector(".u")),
          head: menu.querySelector(".mlabel").textContent, style: getComputedStyle(menu.querySelector(".mlabel")).display,
          views: [...menu.querySelectorAll("button.mi")].map((b) => [b.dataset.view, b.querySelector(".nm").textContent, b.querySelector(".sub").textContent, b.getAttribute("aria-checked"), getComputedStyle(b.querySelector(".sub")).display !== "none"]) };`);
      const inside = (b: any) => b.l >= 0 && b.t >= 0 && b.r <= seen.w && b.b <= seen.h;
      expect([at.name, seen.bar.every(inside), seen.bar.every((b: any, i: number) => i === 0 || seen.bar[i - 1].r <= b.l)]).toEqual([at.name, true, true]);
      expect([at.name, inside(seen.menu)]).toEqual([at.name, true]);
      // It hangs under the ⋯, their right edges together wherever the look
      // has the room, and pulled in from the look's edge where it has not.
      expect([at.name, seen.menu.t >= seen.more.b]).toEqual([at.name, true]);
      if (seen.more.r - (seen.menu.r - seen.menu.l) >= 6) expect([at.name, Math.abs(seen.menu.r - seen.more.r) <= 1]).toEqual([at.name, true]);
      // NOTHING IN THE THREAD RUNS UNDER THE ⋯ OR MINIMIZE: the thread's box
      // starts under the bar they sit in, so a message scrolled to the top is
      // cut at its edge, and the first one starts below it.
      const clear = (a: any, b: any) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
      expect([at.name, seen.bar.every((b: any) => clear(b, seen.log))]).toEqual([at.name, true]);
      expect([at.name, seen.first.t >= seen.log.t, seen.log.t >= Math.max(...seen.bar.map((b: any) => b.b))]).toEqual([at.name, true, true]);
      expect(seen.head).toBe("View");
      expect(seen.style).not.toBe("none");
      expect(seen.views).toEqual([
        ["plain", "Plain", "Just the words", "false", true],
        ["thinking", "Thinking", "Adds the agent's thinking", "true", true],
        ["tools", "Tool calls", "Adds the tools it used", "false", true],
      ]);
      await shot(page, "view-menu-" + at.name);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached", timeout: BOUND });
      expect(await focused()).toBe("Chat options");
      // Space opens it too, and a press elsewhere in the look shuts it.
      await page.keyboard.press(" ");
      await menu.waitFor({ state: "visible", timeout: BOUND });
      const logBox = await box.locator(".log").boundingBox();
      await box.locator(".log").click({ position: { x: 5, y: (logBox?.height ?? 20) - 10 } });
      await menu.waitFor({ state: "detached", timeout: BOUND });
      // A pick asks for the view and draws nothing until the host posts it.
      await box.locator("button.chatmore").click();
      await box.locator(".viewmenu button.mi[data-view=tools]").click();
      expect((await calls(page, 1)).filter((c) => c.kind === "look.view")).toEqual([{ kind: "look.view", view: "tools" }]);
      expect(await inLook<string>(box, `return root.querySelector(".g-look").getAttribute("data-view");`)).toBe("thinking");
      // A picture of each view with its menu open, on the desktop and in the
      // panel: a chat mid-turn, which has thinking and tool calls to show.
      if (at.name === "phone") continue;
      for (const v of ["plain", "thinking", "tools"]) {
        await post(page, box, { kind: "look.state", state: chatState("live", { mode: at.mode, view: v }) });
        await box.locator("button.chatmore").click();
        await box.locator(".viewmenu").waitFor({ state: "visible", timeout: BOUND });
        await box.evaluate(() => Promise.all(document.querySelector("#g-agent .g-look-host")!.shadowRoot!.querySelector(".viewmenu")!.getAnimations().map((a) => a.finished)));
        expect(await inLook<string>(box, `return root.querySelector(".viewmenu button.mi[aria-checked=true]").dataset.view;`)).toBe(v);
        await shot(page, "view-menu-" + at.name + "-" + v);
        await page.keyboard.press("Escape");
      }
    } finally { await ctx.close(); }
  }
}, 120000);

test("beside a page: the panel's head, the history as a dropdown, and only the look's own kinds asked for", async () => {
  const { ctx, page, box } = await open({ width: 460, height: 760 });
  try {
    await post(page, box, { kind: "look.state", state: chatState("done", { mode: "panel" }) });
    expect(await inLook<string>(box, `return root.querySelector(".tswitch .nm").textContent;`)).toBe("Summarise what the Socials run did today");
    await box.locator(".tswitch").click();
    expect(await inLook<number>(box, `return root.querySelectorAll(".menu .mi").length;`)).toBe(6);
    await shot(page, "panel-menu");
    await box.locator(".menu .mi").nth(1).click();
    await box.locator("button.iconbtn[aria-label='Open full size']").click();
    await box.locator("button.iconbtn[aria-label='Close the chat']").click();
    await box.locator("button.iconbtn[aria-label='New thread']").click();
    expect(await calls(page, 6)).toEqual([
      { kind: "look.list", open: true },
      { kind: "look.list", open: false },
      { kind: "look.open", chat: cid("live") },
      { kind: "look.panel", to: "screen" },
      { kind: "look.panel", to: "closed" },
      { kind: "look.new" },
    ]);
  } finally { await ctx.close(); }
}, 60000);

test("AN AGENT'S WORDS NEVER BECOME MARKUP: not in a reply, a thought, a tool, a diff, a path, a page's name or a face", async () => {
  const { ctx, page, box } = await open();
  try {
    // In Tool calls, which draws everything: the thought written out, and
    // each run and call opened.
    await post(page, box, { kind: "look.state", state: chatState("evil", { view: "tools" }) });
    await box.locator(".grp").first().click();
    await box.locator(".act").first().click();
    await box.waitForTimeout(400);
    const seen = await inLook<any>(box, `
      const all = [...root.querySelectorAll("*")];
      const tags = [...new Set(all.map((e) => e.localName))].sort();
      const on = all.filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length;
      const srcs = [...root.querySelectorAll("[src]")].map((e) => e.getAttribute("src"));
      const hrefs = root.querySelectorAll("[href]").length;
      return { pwned: window.__pwned, tags, on, srcs, hrefs, text: root.querySelector(".log").textContent, list: root.querySelector(".tlist").textContent };`);
    expect(seen.pwned).toBeUndefined();
    expect(seen.on).toBe(0);
    expect(seen.hrefs).toBe(0);
    expect(seen.srcs).toEqual([]);
    for (const tag of ["script", "iframe", "img", "a", "div[onclick]", "object", "embed"]) expect(seen.tags).not.toContain(tag);
    // The markup is there as words, which is what it is.
    expect(seen.text).toContain("<script>window.__pwned=7</script>");
    expect(seen.text).toContain("<img src=x onerror=");
    expect(seen.text).toContain("<div onclick=");
    expect(seen.list).toContain("<img src=n onerror=");
    // A link is its words; the page named in markup opens as the id it is.
    await box.locator(".crow button.pg").first().click();
    expect(await calls(page, 1)).toEqual([{ kind: "open", target: { kind: "page", id: "home/<img src=q onerror=window.__pwned=14>" } }]);
    expect(await box.evaluate(() => (window as any).__pwned)).toBeUndefined();
    await shot(page, "hostile");
  } finally { await ctx.close(); }
}, 60000);

test("under reduced motion the look rests: nothing animates, the ribbon is still, and a face is its emoji as text", async () => {
  const { ctx, page, box } = await open({ reduced: true });
  try {
    await post(page, box, { kind: "look.state", state: lookState({}) });
    await box.waitForTimeout(3000);
    const start = await inLook<any>(box, `return { still: root.querySelector(".g-look").hasAttribute("data-still"), anims: root.getAnimations().length, line: root.querySelector(".line").textContent };`);
    expect(start.still).toBe(true);
    expect(start.anims).toBe(0);
    expect(start.line).toBe("What should we automate?");
    await post(page, box, { kind: "look.state", state: chatState("live") });
    const chat = await inLook<any>(box, `return { anims: root.getAnimations().length, imgs: root.querySelectorAll(".mood img").length, face: root.querySelector(".mood").textContent };`);
    expect(chat.anims).toBe(0);
    expect(chat.imgs).toBe(0);
    expect(chat.face).toBe("😌");
    await shot(page, "reduced");
  } finally { await ctx.close(); }
}, 60000);

test("the look the variable names is what draws, and a look nobody registered is refused in words", async () => {
  (globalThis as any).__lookName = "no-such-look";
  try {
    if (!browser) throw new Error("no browser");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route(`${ORIGIN}/**`, async (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname);
      if (p === "/") return route.fulfill({ status: 200, contentType: "text/html", body: hostPage(DOT_MATRIX) });
      if (p.startsWith("/v/")) return route.fulfill({ status: 200, contentType: "text/javascript", body: bundle });
      if (p.startsWith("/guest/")) return route.fulfill({ status: 200, contentType: "text/javascript", body: readFileSync(join(HERE, "guest", p.slice(7))) });
      return route.fulfill({ status: 404, body: "" });
    });
    try {
      await page.goto(`${ORIGIN}/`);
      const box = await (async () => { await page.waitForFunction(() => (window as any).__host && (window as any).__host.ready > 0, null, { timeout: BOUND }); return page.frames().find((f) => f !== page.mainFrame())!; })();
      await box.waitForFunction(() => document.getElementById("g-agent")!.hasAttribute("data-g-failed"), null, { timeout: BOUND });
      const said = await box.evaluate(() => document.getElementById("g-agent")!.textContent);
      expect(said).toContain("no-such-look");
      expect(said).toContain("plugins/biom-agent/extensions.yaml");
    } finally { await ctx.close(); }
  } finally { delete (globalThis as any).__lookName; }
}, 60000);

test("a pagehide takes the look down whole: its node, its frames and its timers", async () => {
  const { ctx, page, box } = await open();
  try {
    await post(page, box, { kind: "look.state", state: lookState({}) });
    await box.evaluate(() => {
      const w = window as any;
      w.__live = 0;
      const raf = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (fn: any) => raf((t: number) => { w.__live++; fn(t); });
      const si = w.setInterval.bind(w);
      w.__ticks = 0;
      w.setInterval = (fn: any, ms: number) => si(() => { w.__ticks++; fn(); }, ms);
    });
    // Restart the start screen's motion under the counting stand-ins.
    await post(page, box, { kind: "look.state", state: chatState("done") });
    await post(page, box, { kind: "look.state", state: lookState({}) });
    await box.waitForTimeout(400);
    expect(await box.evaluate(() => (window as any).__live)).toBeGreaterThan(0);
    await box.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await box.waitForTimeout(100);
    const before = await box.evaluate(() => ({ raf: (window as any).__live, ticks: (window as any).__ticks }));
    await box.waitForTimeout(3000);
    const after = await box.evaluate(() => ({ raf: (window as any).__live, ticks: (window as any).__ticks, host: !!document.querySelector("#g-agent .g-look-host") }));
    expect(after.host).toBe(false);
    expect(after.raf).toBe(before.raf);
    expect(after.ticks).toBe(before.ticks);
  } finally { await ctx.close(); }
}, 60000);

