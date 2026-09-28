// SPDX-License-Identifier: AGPL-3.0-only
// THE DRAWN PAGE DOES NOT MOVE WHEN THE WIRE STOPS COPYING SCOPES — the
// fourteenth contracts edit's equivalence suite, in a real browser. The server
// run the way `make dev` runs it, on a copy of the corpus in
// `../fixtures/scopes-vault/`, and a headless Chromium opening every page of it.
//
// WHAT IT HOLDS. For each corpus page, once the strip reads Drawn and the box
// has stopped changing, the box's `#g-page` — every section's markup with its
// `{{name}}` resolved, every slot as its plugin and the edit wave drew it, and
// what the corpus's two recorder plugins wrote onto their nodes: the scope and
// the content they were handed, the grid kind's included — serialised and
// compared with a golden captured from the code BEFORE the edit. And the
// markdown the box itself reported for the page, which is `project.js` run on
// the page the box holds, compared with the projection golden the unit half
// captured.
//
// `GOLDEN_CAPTURE=1` writes a DOM golden that is missing and never overwrites
// one; `scopes-fixture.ts` has the rule. What is normalised before comparing is
// only what differs between two runs of the same code — this run's scratch
// folder and port — and nothing a page was handed.
//
// Every page, word and number in the corpus is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, Frame, Page } from "playwright";

import { HERE, SHOTS, BOUNDS, sandbox, outside, withoutAgents, freePort, until, shotsDir } from "./harness.ts";
import type { Sandbox } from "./harness.ts";
import { CORPUS_PAGES, copyCorpus, fileOf, golden, held } from "../scopes-fixture.ts";

const unix = process.platform !== "win32";

let box: Sandbox;
let before = "";
let base = "";
let vault = "";
let server: ReturnType<typeof Bun.spawn> | null = null;
const said = { out: "", err: "" };
let browser: Browser | null = null;
let page: Page;
/** The markdown the box reported for each page, as the host forwarded it. */
const reported = new Map<string, string>();
let broke: string | null = null;

function drain(s: ReadableStream<Uint8Array> | undefined, into: "out" | "err"): void {
  if (s === undefined) return;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of s) said[into] += decoder.decode(chunk);
  })();
}

beforeAll(async () => {
  if (!unix) return;
  shotsDir();
  box = sandbox("scopes-dom");
  before = outside();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  vault = join(box.root, "vault");
  copyCorpus(vault);

  server = Bun.spawn([process.execPath, "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: { ...withoutAgents(box.env), PORT: String(port), VAULT: vault },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(server.stdout as ReadableStream<Uint8Array>, "out");
  drain(server.stderr as ReadableStream<Uint8Array>, "err");
  await until("the server answered, with the corpus mounted", BOUNDS.serve * 2, async () => {
    try {
      return (await fetch(`${base}/`)).ok;
    } catch {
      return false;
    }
  });

  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  // THE RESTING FRAME. A figure that plays is still where it starts, so the
  // DOM is the same on every run and on every machine.
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/call")) return;
    try {
      const body = JSON.parse(r.postData() ?? "{}") as { kind?: unknown; page?: unknown; markdown?: unknown };
      if (body.kind === "page.projection" && typeof body.page === "string" && typeof body.markdown === "string") {
        reported.set(body.page, body.markdown);
      }
    } catch {
      /* not a call this walk reads */
    }
  });
}, 120_000);

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

/** The box the page is drawn in. */
async function boxFrame(): Promise<Frame> {
  let found: Frame | null = null;
  await until("the page box is up", BOUNDS.draw, async () => {
    const handle = await page.$("iframe.artifact");
    found = handle ? await handle.contentFrame() : null;
    return found !== null;
  });
  return found as unknown as Frame;
}

/** `#g-page` as markup, or "" while it is not there. */
const drawn = async (frame: Frame): Promise<string> =>
  (await frame.evaluate(() => document.getElementById("g-page")?.outerHTML ?? "").catch(() => "")) as string;

/** Only what two runs of the same code differ in: this run's folder and port. */
const normalise = (html: string): string =>
  html.replaceAll(vault, "<vault>").replaceAll(encodeURIComponent(vault), "<vault>").replaceAll(base, "<base>");

for (const id of CORPUS_PAGES) {
  test.if(unix)(`${id} draws the DOM it drew before the fourteenth edit, and reports the markdown it did`, async () => {
    if (broke !== null) throw new Error(`skipped: an earlier page failed — ${broke}`);
    try {
      const route = id === "@design" ? "#/design" : `#/page/${encodeURIComponent(id)}`;
      reported.delete(id);
      await page.goto(`${base}/?vault=${encodeURIComponent(vault)}${route}`, { waitUntil: "domcontentloaded" });
      await until(`${id} drew`, BOUNDS.draw, async () => {
        const strip = await page.locator("span.status").innerText().catch(() => "");
        return /Drawn\s*\d+/.test(strip.replace(/\s+/g, " "));
      });
      const frame = await boxFrame();
      // SETTLED: the same markup twice, half a second apart. The edit wave
      // dresses the page after it is drawn, and a section script runs after
      // its slots are filled.
      let last = "";
      await until(`${id} stopped changing`, BOUNDS.draw, async () => {
        const html = await drawn(frame);
        const same = html !== "" && html === last;
        last = html;
        if (!same) await new Promise((r) => setTimeout(r, 500));
        return same;
      });
      const html = normalise(last);
      expect(html).toBe(golden(`dom/${fileOf(id)}.html`, html));

      // The design doc has no mirror file, so the box reports no markdown for it.
      if (id.startsWith("@")) return;
      await until(`${id} reported its markdown`, BOUNDS.draw, () => reported.has(id));
      expect(reported.get(id)).toBe(held(`projection/${fileOf(id)}.md`));
    } catch (e) {
      broke = id;
      await page.screenshot({ path: join(SHOTS, `scopes-${fileOf(id)}.png`), timeout: 8000 }).catch(() => {});
      throw new Error(`${String((e as Error).message ?? e)}\n--- server stderr ---\n${said.err.slice(-4000)}`);
    }
  }, 90_000);
}
