// SPDX-License-Identifier: AGPL-3.0-only
// THE SERVER'S OWN CAPTURE, and which box in its tab it reads.
//
// `server/platform/capture.ts` is how a browser tab shares a page: the server
// opens its own address in a Chromium of its own and reads the page's box out
// of that tab. Which box is the question, because a window holds more than
// one — the Agent screen's look is a box of its own, kept beside every page
// once it has shown, and made before the page's on a launch that opens on the
// Agent screen. The tab the capture opens goes straight to the page today, so
// no look is built in it; the frame it reads must not depend on that staying
// true.
//
// A REAL CHROMIUM, where `make browser` has fetched it, in a process of its own:
// frames, their order and their names are the browser's facts, and a double of
// Playwright would be a test of the double. The window it draws is the shape
// the client draws — the look's box made first and sitting after the canvas,
// the page's box made second in the plate — and the look calls its own window
// by the page box's whole name, which is the most a box can do.

import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { PAGE_BOX } from "../contracts/wire.js";

const HERE = join(import.meta.dir, "..");

/** Chromium, where `make browser` has fetched it. */
const browserHere = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

/** THE BROWSER RUNS IN A PROCESS OF ITS OWN, as `local-gate.test.ts` says why:
 *  a browser launched inside this test process shares it with every other file
 *  `bun test` runs. This script draws the window, asks the capture's own
 *  `pageFrame` for the page's box, and prints what that box holds. */
const DRAW = `
import { chromium } from ${JSON.stringify(join(HERE, "node_modules", "playwright", "index.mjs"))};
import { pageFrame } from ${JSON.stringify(join(HERE, "server", "platform", "capture.ts"))};
const [name] = process.argv.slice(2);
const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
const browser = await chromium.launch({ headless: true, args });
try {
  const tab = await browser.newPage();
  await tab.setContent('<div class="bed"><div class="canvas"><div class="plate"></div></div><div class="agentslot"></div></div>');
  const box = async (into, attrs, srcdoc) => {
    await tab.evaluate(([into, attrs, srcdoc]) => {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts");
      for (const [k, v] of Object.entries(attrs)) f.setAttribute(k, v);
      f.srcdoc = srcdoc;
      document.querySelector(into).append(f);
    }, [into, attrs, srcdoc]);
  };
  const drawn = async (n) => {
    for (let i = 0; i < 100; i++) {
      const kids = tab.mainFrame().childFrames();
      const held = await Promise.all(kids.map((f) => f.content().catch(() => "")));
      if (kids.length === n && held.every((h) => h.includes("<main"))) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the boxes did not draw");
  };
  // The look first, and it calls its own window by the page box's whole name.
  await box(".agentslot", { title: "The Agent screen" }, "<main id=g-agent>the chats</main><script>window.name = " + JSON.stringify(name) + "</script>");
  await drawn(1);
  // Then the page's box, named by the window's document as the client names it.
  await box(".plate", { name }, "<main id=g-page>the page</main>");
  await drawn(2);
  const frames = tab.mainFrame().childFrames();
  const first = frames[0] ? await frames[0].content() : "";
  const frame = await pageFrame(tab);
  const read = frame ? await frame.content() : "";
  console.log(JSON.stringify({
    children: frames.length,
    lookMadeFirst: first.includes("g-agent"),
    page: read.includes('id="g-page"'),
    look: read.includes('id="g-agent"'),
  }));
} finally {
  await browser.close();
}
`;

test.if(browserHere)("the server's capture reads the page's box, found through its tab's own document, when the look's box was made first and calls itself by the page's name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "biom-capture-"));
  const script = join(dir, "draw.ts");
  writeFileSync(script, DRAW);
  try {
    const run = Bun.spawn([process.execPath, "run", script, `${PAGE_BOX}-5f0c2a9e41b7d3386ac2e917`], { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
    await run.exited;
    const line = out.trim().split("\n").at(-1) ?? "";
    expect([line === "" ? err.slice(0, 500) : "", run.exitCode]).toEqual(["", 0]);
    const saw = JSON.parse(line) as { children: number; lookMadeFirst: boolean; page: boolean; look: boolean };
    // The window is the one this is about: two boxes, the look listed first.
    expect([saw.children, saw.lookMadeFirst]).toEqual([2, true]);
    // And the capture read the page, not the look.
    expect([saw.page, saw.look]).toEqual([true, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

test("the capture draws through `pageFrame`, and never takes a box by where it falls in the tab", () => {
  const source = readFileSync(join(HERE, "server", "platform", "capture.ts"), "utf8");
  expect(source.includes("const frame = await pageFrame(tab);")).toBe(true);
  expect(source.includes("childFrames()[0]")).toBe(false);
});
