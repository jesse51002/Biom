// SPDX-License-Identifier: AGPL-3.0-only
// LAYER ONE: the server, run the way `make dev` runs it, walked in a real
// browser.
//
// It is a spawned `server/main.ts` on a free port with no `VAULT` and a data
// directory of this run's own, and a headless Chromium pointed at it. Nothing is
// stubbed, nothing is constructed in process, and the only thing this file knows
// about the application is what a person at the screen knows: the class on a
// button, the words on a page, and what the terminal said.
//
// WHAT IT WALKS, in the order a first launch does it:
//
//   1. Nothing is mounted, so the picker is what opens — and the server says
//      nothing on stderr while it does. Both halves are one of the owner's bugs:
//      a remembered scratch vault opened instead of the picker, and `vault.info`
//      with nothing mounted printed a stack trace on every launch.
//   2. A workspace is created from a parent and a name, through the wire. The
//      OS dialog does not exist in a browser, so the CALL is what is driven —
//      through the page's own `fetch`, at the page's own origin, which is the
//      same request the picker's Create button makes.
//   3. The root page draws itself with the copy it was seeded with, prints the
//      folder it asked the host for, and the rail has a Dashboard row — which is the third of the owner's bugs: the row was in
//      the source and not in the build.
//   4. A page made by name through New opens.
//   5. That page's `content.yaml` is edited FROM OUTSIDE and the page redraws
//      with nobody pressing Reload.
//   6. A directory written under `children/` appears in the rail.
//   7. A half-written file does not break the page, and the finished save
//      recovers it.
//   8. `_markdown/` carries the words.
//   9. The picker is returned to with nothing mounted, the workspace made in
//      step 2 is in Recent, and opening it through `vault.open` lands on its
//      root — which is every launch after the first one.
//  10. Across all of it: no stack trace on stderr, and not one byte written into
//      the person's own data directory.
//
// A SCREENSHOT IS TAKEN AT EVERY STEP into `dist/e2e/`, gitignored, for a human
// to look at. A failing step names its own picture and the server's stderr.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { HERE, SHOTS, BOUNDS, sandbox, outside, freePort, until, step, stackTraces, shotsDir } from "./harness.ts";
import type { Sandbox } from "./harness.ts";

/* ── the run ────────────────────────────────────────────────────────────── */

let box: Sandbox;
let before = "";
let port = 0;
let base = "";
let server: ReturnType<typeof Bun.spawn> | null = null;
let said = { out: "", err: "" };
let browser: Browser | null = null;
let page: Page;

/** The workspace this run makes, filled in by step 2 and read by every step
 *  after it. */
let vault = "";
/** A second workspace, made in step 9 and never mounted until the picker opens
 *  it — which is what makes it a folder that was *already on disk*. */
let second = "";
/** The page step 4 makes, as the route reports it, and where its document is. */
let made = "";
let madeDoc = "";

/** Whichever step went wrong first. Every step after it says so rather than
 *  failing again for a reason that is really the first one's. */
let broke: string | null = null;

/** The server's stderr, for a failing step to attach. */
const log = (): string => said.err;

/** Take one, named for the step. The number in front is so a directory listing
 *  reads in the order the walk happened. */
async function shot(name: string): Promise<string> {
  const file = `${name}.png`;
  try {
    await page.screenshot({ path: join(SHOTS, file), fullPage: false });
  } catch {
    // A screenshot that cannot be taken must never be why a step failed.
  }
  return file;
}

/** One step of the walk. Guards on the first failure, takes the picture, and
 *  hands `step()` the three things a failure has to say. */
function walk(name: string, run: () => Promise<void>, ms = 60000): void {
  test(name, async () => {
    if (broke !== null) throw new Error(`skipped: an earlier step failed — ${broke}`);
    const file = await shot(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    try {
      await step(name, file, log, async () => {
        await run();
        await shot(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
      });
    } catch (e) {
      broke = name;
      throw e;
    }
  }, ms);
}

/** Drain a stream into a string as it arrives, so a failure has the whole of
 *  what was said rather than whatever happened to be buffered. */
function drain(stream: ReadableStream<Uint8Array> | undefined, into: "out" | "err"): void {
  if (stream === undefined) return;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) said[into] += decoder.decode(chunk);
  })();
}

beforeAll(async () => {
  shotsDir();
  box = sandbox("server");
  before = outside();
  port = await freePort();
  base = `http://127.0.0.1:${port}`;

  server = Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: { ...box.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(server.stdout as ReadableStream<Uint8Array>, "out");
  drain(server.stderr as ReadableStream<Uint8Array>, "err");

  await until("the server answered", BOUNDS.serve, async () => {
    try {
      const res = await fetch(`${base}/`);
      return res.ok;
    } catch {
      return false;
    }
  });

  // `--no-sandbox` is an env knob and is off by default, for the same reason the
  // packaged launch has one: a container without user namespaces needs it and a
  // developer's machine must not have it quietly turned on.
  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  browser = await chromium.launch({ headless: true, args });
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  // THE CLIPBOARD IS A PERMISSION AND A HEADLESS RUN IS ASKED NOBODY. The root
  // page's Copy controls do a real `navigator.clipboard.writeText` from inside
  // the box, so the step that reads one back has to be allowed to — granted on
  // the page's own origin rather than on the box's, which is opaque and has no
  // origin to name.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
}, 120000);

afterAll(async () => {
  try {
    await browser?.close();
  } catch {
    // Closing a browser that already went is not a failure of anything.
  }
  server?.kill();
  box?.clean();
});

/* ── the walk ───────────────────────────────────────────────────────────── */

walk("a first launch mounts nothing and opens the picker", async () => {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await until("the picker was drawn", BOUNDS.draw, async () => (await page.locator("div.ports.vault").count()) > 0);

  // The picker, and not a page in a folder somebody's earlier test run left
  // behind. The rail's own screens are not the tell — the words on the picker
  // are, and so is what the server said it mounted.
  // THE ONE REAL LINE ON THE SCREEN, which is the company's own headline. The
  // picker has no heading of its own any more — with no workspace open there is
  // nothing to explain and nothing to rank — so this is the words that prove it
  // is the start page rather than a page in a folder an earlier run left behind.
  expect(await page.locator("div.ports.vault h1.vline").first().innerText())
    .toBe("Visual Workspace for AI Automations");
  expect(said.out).toContain("none yet");

  // NOT ONE FRAME ON STDERR. `vault.info` with nothing mounted is the request
  // the client makes on this very screen, and it used to throw its way out.
  expect(stackTraces(said.err)).toEqual([]);
});

walk("a workspace is a parent and a name, and creating one opens it", async () => {
  const parent = join(box.root, "folders");
  mkdirSync(parent, { recursive: true });

  // THROUGH THE PAGE'S OWN ORIGIN, which is the point of driving it here rather
  // than from the test process: this is the request the Create button makes,
  // over the same route, with the same envelope, from the same document.
  const answer = (await page.evaluate(async ([at, name]) => {
    const res = await fetch("/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "e2e-create", g: 1, kind: "vault.create", parent: at, name }),
    });
    return await res.json();
  }, [parent, "Walkthrough"])) as { ok: boolean; value?: { path?: string }; error?: { message?: string } };

  expect([answer.ok, answer.error?.message ?? ""]).toEqual([true, ""]);
  vault = answer.value?.path ?? join(parent, "Walkthrough");
  expect(existsSync(join(vault, "pages", "home", "content.yaml"))).toBe(true);

  await page.goto(`${base}/?vault=${encodeURIComponent(vault)}#/page/home`, { waitUntil: "domcontentloaded" });
});

walk("the root page draws its seeded copy, and the rail has a Dashboard row", async () => {
  // THE WORDS INSIDE THE BOX, which is the only honest signal that the page is
  // up rather than merely requested: the host cannot read an opaque-origin
  // frame, so nothing outside it knows what it says. The strip's Drawn count is
  // not the tell any more — the root draws ITSELF now, and a page with no
  // sections has no declared number for that pair to disagree with.
  await until("the root page said its piece", BOUNDS.draw, async () => {
    const said = await page.frameLocator("iframe.artifact").locator("body").innerText().catch(() => "");
    return said.includes("Point your agent at this folder");
  });

  // The words the seeder puts on a new workspace's root, read INSIDE the box.
  const body = await page.frameLocator("iframe.artifact").locator("body").innerText();
  expect(body).toContain("Ask for any of these");
  // AND THE FOLDER, which the page ASKS the host for where it is drawn rather
  // than carrying: this is `biom.vault()` answering over a real port, in a real
  // frame, which is a thing only this layer can prove.
  expect(await page.frameLocator("iframe.artifact").locator("#where").innerText()).toBe(vault);

  // THE ROW THAT WAS IN THE SOURCE AND NOT IN THE BUILD. Layer two asserts it
  // again in the packaged application, which is where it went missing.
  expect(await page.locator("button.dashboardlink").count()).toBe(1);
  expect(await page.locator("button.dashboardlink").innerText()).toContain("Dashboard");
});

walk("every ask carries its module and a prompt that really copies", async () => {
  const box0 = page.frameLocator("iframe.artifact");

  // ONE MODULE PER ASK, DRAWN. The counts are read rather than spelled: the
  // words are a list in `content.yaml` and the drawings are templates in the
  // page's own markup, and the page is only honest when the two agree.
  const asks = await box0.locator('[data-g-part="asks"] > [data-g-item]').count();
  expect(asks).toBeGreaterThan(1);
  expect([await box0.locator(".tile").count(), await box0.locator(".pcopy").count()]).toEqual([asks, asks]);

  // A REAL CLIPBOARD WRITE, FROM INSIDE THE BOX. The frame has an opaque origin
  // and permissions policy refuses it the clipboard unless the container
  // delegates `clipboard-write` — which is a fact about the assembled program
  // and about nothing a unit test can see. The control says so when it worked,
  // because a copy leaves nothing else on the screen.
  const first = box0.locator(".pcopy").first();
  await first.click();
  await until("the prompt Copy said it had copied", 10000, async () =>
    (await first.innerText()).trim().toLowerCase() === "copied");
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt.length).toBeGreaterThan(120);
  expect(await box0.locator('[data-g-part="asks"] > [data-g-item]').first().innerText()).toContain(prompt.slice(0, 60));

  // AND THE FOLDER, which the band prints and the same control copies.
  await box0.locator("#copy").click();
  await until("the folder Copy said it had copied", 10000, async () =>
    (await box0.locator("#copy").innerText()).trim().toLowerCase() === "copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(vault);
});

walk("the first thing the root page says to do is open the design doc, and the link goes there", async () => {
  // THE ONE PAGE NO SNAPSHOT HOLDS. `design/` is outside `pages/`, so following
  // this link is the bridge naming the reserved id in both halves — resolve and
  // open — and a route that did not change is the whole symptom when it stops.
  const link = page.frameLocator("iframe.artifact").locator(".about a");
  expect(await link.innerText()).toBe("Design");
  await link.click();

  await until("the design doc was routed to", BOUNDS.draw, async () =>
    (await page.evaluate(() => location.hash)) === "#/design");

  // Back to the root, because everything after this walk is standing on it.
  await page.goto(`${base}/?vault=${encodeURIComponent(vault)}#/page/home`, { waitUntil: "domcontentloaded" });
  await until("the root page came back", BOUNDS.draw, async () => {
    const said = await page.frameLocator("iframe.artifact").locator("body").innerText().catch(() => "");
    return said.includes("Ask for any of these");
  });
});

walk("a page made by name through New opens", async () => {
  await page.locator("button.newpage").click();
  await until("the dialog opened", 10000, async () => (await page.locator("input.named").count()) > 0);
  await page.locator("input.named").fill("Kitchen");
  await page.locator("input.named").press("Enter");

  await until("the new page was routed to", BOUNDS.draw, async () => {
    const hash = await page.evaluate(() => location.hash);
    return hash.includes("Kitchen");
  });
  // THE ROUTE SAYS WHICH PAGE, and it is read rather than predicted — a test
  // that spelled the id itself would pass while the app put the page somewhere
  // else. The segment is percent-encoded on the hash, because a page id carries
  // slashes and the route is one segment.
  made = decodeURIComponent((await page.evaluate(() => location.hash)).replace(/^#\/page\//, ""));
  expect(made.endsWith("Kitchen")).toBe(true);

  madeDoc = join(vault, "pages", ...made.split("/").flatMap((seg, i) => (i === 0 ? [seg] : ["children", seg])), "content.yaml");
  expect([made, madeDoc, existsSync(madeDoc)]).toEqual([made, madeDoc, true]);

  await until("the new page drew", BOUNDS.draw, async () => {
    const strip = await page.locator("span.status").innerText().catch(() => "");
    return /Drawn\s*\d+/.test(strip.replace(/\s+/g, " "));
  });
});

walk("a file edited outside the app redraws the page, with nobody pressing Reload", async () => {
  const words = "the agent wrote this from outside the window";
  writeFileSync(madeDoc, doc("Kitchen", words), "utf8");

  await until("the page redrew with the new words", BOUNDS.redraw, async () => {
    const body = await page.frameLocator("iframe.artifact").locator("body").innerText().catch(() => "");
    return body.includes(words);
  });
});

walk("a directory written under children/ appears in the rail", async () => {
  const child = join(madeDoc, "..", "children", "Pantry");
  mkdirSync(child, { recursive: true });
  writeFileSync(join(child, "content.yaml"), doc("Pantry", "shelves, and what is on them"), "utf8");

  // THE ROW LEARNS IT HOLDS SOMETHING FIRST, AND THAT IS THE ASSERTION.
  // `nest()` walks only into what is expanded, so a child under a shut row is
  // correctly not on screen — a test that waited for the name would be waiting
  // for a bug. What the live redraw has to produce is the CARET: a row with no
  // children draws `span.caret.bare`, which is inert and has no `aria-expanded`,
  // and a row that holds something draws a real one. So the caret appearing on
  // Kitchen is the rail learning about a directory nobody told it about.
  const kitchen = page.locator("nav.rack li.treerow", { hasText: "Kitchen" }).first();
  await until("the Kitchen row grew a caret", BOUNDS.redraw, async () =>
    (await kitchen.locator("span.caret[aria-expanded]").count()) > 0);

  // And then it opens onto the page that was never created through the app.
  await kitchen.locator("span.caret[aria-expanded]").first().click();
  await until("the rail carried the new child", BOUNDS.redraw, async () => {
    const rail = await page.locator("nav.rack").innerText().catch(() => "");
    return rail.includes("Pantry");
  });
});

walk("a half-written file does not break the page, and the finished save recovers it", async () => {
  const kept = "the agent wrote this from outside the window";
  // THE MIDDLE OF SOMEBODY ELSE'S SAVE. An editor that writes in two goes leaves
  // exactly this on disk for a moment, and the rule is that the drawn page is
  // left alone rather than replaced by a parse error.
  writeFileSync(madeDoc, 'name: Kitchen\nplugin: doc\ncontents:\n  - "unterminated\n', "utf8");
  await new Promise((r) => setTimeout(r, 1500));

  const body = await page.frameLocator("iframe.artifact").locator("body").innerText().catch(() => "");
  expect(body).toContain(kept);

  const finished = "the save finished and the page came back";
  writeFileSync(madeDoc, doc("Kitchen", finished), "utf8");
  await until("the finished save redrew the page", BOUNDS.redraw, async () => {
    const now = await page.frameLocator("iframe.artifact").locator("body").innerText().catch(() => "");
    return now.includes(finished);
  });
});

walk("the markdown mirror carries the words", async () => {
  const mirror = join(vault, "_markdown", ...made.split("/")) + ".md";
  await until("the mirror was written", BOUNDS.redraw, () =>
    existsSync(mirror) && readFileSync(mirror, "utf8").includes("the save finished and the page came back"));
});

/* ── the design doc, read against the palette it ships with ───────────────
 *
 * THE FAULT THIS CATCHES IS INVISIBLE TO EVERY UNIT TEST AND OBVIOUS ON A
 * SCREEN. The shim writes the vault's palette onto `:root` as custom properties
 * and nothing else, so a browser's default black is what an element naming no
 * colour inherits — and the palette a new vault ships with is cream on charcoal.
 * The only place that said otherwise was `guest/plugins/biom-doc/index.html`, which
 * the design doc's box does not load: it is woven with no document at all. So
 * the design page drew its title and the whole of its shipped-default band in
 * black on charcoal, on a fresh vault, with every module passing its own
 * invariants.
 *
 * IT IS MEASURED AND NOT INSPECTED. The assertion is the WCAG contrast between
 * the title's computed colour and the ground actually behind it — walked up the
 * ancestors to the first one that paints a ground, and falling through to the
 * host's own `--paper` under the transparent box — because that is the property
 * a person cares about and the one no `toContain` can stand in for. */
walk("the design doc's title reads against the ground the vault ships", async () => {
  await page.goto(`${base}/?vault=${encodeURIComponent(vault)}#/design`, { waitUntil: "domcontentloaded" });

  await until("the design doc drew its masthead", BOUNDS.draw, async () => {
    const said = await page.frameLocator("iframe.artifact").locator("body").innerText().catch(() => "");
    return said.includes("How this workspace looks is decided here");
  });

  // THE SHEET UNDER THE TRANSPARENT BOX IS THE HOST'S. `boot.js` sets `--paper`
  // on the host root and the box paints nothing of its own behind a section that
  // declares no background, so the ground a title is read against can only be
  // found by asking both sides.
  const paper = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--paper").trim());

  const measured = await page.frameLocator("iframe.artifact").locator("h1").first().evaluate((h1, fallback) => {
    const solid = (c: string): boolean => c !== "" && c !== "transparent" && !/rgba\([^)]*,\s*0\s*\)/.test(c);
    let ground = fallback;
    for (let el: Element | null = h1; el !== null; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (solid(bg)) { ground = bg; break; }
    }
    return { ink: getComputedStyle(h1).color, ground, words: (h1.textContent ?? "").trim() };
  }, paper);

  /** One colour as three channels, from whichever spelling was answered.
   *  Written here rather than imported: `tests/theme.test.js` holds the same
   *  arithmetic over the palette FILE, and this is the same rule asked of what
   *  a browser actually painted. */
  const rgb = (c: string): [number, number, number] => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (hex !== null) {
      const raw = hex[1] as string;
      const h = raw.length === 3 ? raw.split("").map((d) => d + d).join("") : raw;
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    }
    const nums = c.match(/[\d.]+/g);
    if (nums === null || nums.length < 3) throw new Error(`not a colour this test can read: ${c}`);
    return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
  };
  const lum = (c: string): number => {
    const [r, g, b] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hi = Math.max(lum(measured.ink), lum(measured.ground));
  const lo = Math.min(lum(measured.ink), lum(measured.ground));
  const ratio = (hi + 0.05) / (lo + 0.05);

  expect(measured.words).toBe("Design");
  // The numbers ride in the expectation so a failure NAMES the two colours and
  // what they measured, rather than saying `false is not true`.
  expect({ ink: measured.ink, ground: measured.ground, ratio: Number(ratio.toFixed(2)), reads: ratio >= 4.5 })
    .toEqual({ ink: measured.ink, ground: measured.ground, ratio: Number(ratio.toFixed(2)), reads: true });

  // Back where the walk left off: every step after this one is about the vault
  // route and the second workspace, and a route left on the design doc would be
  // this step deciding where they start.
  await page.goto(`${base}/?vault=${encodeURIComponent(vault)}#/page/home`, { waitUntil: "domcontentloaded" });
});

walk("a workspace already on disk is opened from the picker and lands on its root", async () => {
  // A SECOND WORKSPACE, MADE AND LEFT ALONE. It is never mounted here, so it is
  // a folder that holds a workspace and that this browser has never opened —
  // which is the only honest version of *already on disk*.
  const answer = (await page.evaluate(async ([at, name]) => {
    const res = await fetch("/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "e2e-second", g: 1, kind: "vault.create", parent: at, name }),
    });
    return await res.json();
  }, [join(box.root, "folders"), "Cellar"])) as { ok: boolean; value?: { path?: string }; error?: { message?: string } };
  expect([answer.ok, answer.error?.message ?? ""]).toEqual([true, ""]);
  second = answer.value?.path ?? "";

  // A LAUNCH WITH NO FOLDER NAMED IS NOT THE PICKER ANY MORE, and that is the
  // design rather than the bug that looks like it: the server mounts `VAULT` if
  // it is named, else the folder last opened here, else one of its own. Step 1
  // saw the picker because this run's data directory was empty; it is not empty
  // now, so the same address goes straight to a workspace.
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await until("the remembered workspace was mounted", BOUNDS.draw, async () => {
    const hash = await page.evaluate(() => location.hash);
    return hash.includes("page/");
  });
  expect(await page.locator("div.ports.vault").count()).toBe(0);

  // AWAY FROM THE ROOT FIRST, or "lands on its root" is a sentence about a page
  // that was already on screen. On the hash, which is how a page is addressed —
  // the rail cannot be clicked for it, because a fresh load opens no branches
  // and the page step 4 made is a level down.
  await page.evaluate((id) => { location.hash = "#/page/" + encodeURIComponent(id); }, made);
  await until("the walk moved off the root", BOUNDS.draw, async () =>
    (await page.evaluate(() => location.hash)).includes("Kitchen"));

  // CLOSE WORKSPACE IS THE ONE RAIL ROW THAT LEAVES, and where it goes is the
  // start page — the same screen a first launch gets, rather than the picker
  // drawn inside the chrome that used to sit behind a Settings row. It is a real
  // address, so this is a navigation and the whole document is replaced.
  await page.locator("nav.rack div.rackfoot li.treerow", { hasText: "Close workspace" })
    .first().locator("a").click();
  await until("the start page was drawn", BOUNDS.draw, async () => (await page.locator("div.ports.vault").count()) > 0);

  // NO FOLDER IN THE ADDRESS, AND NO FURNITURE AROUND THE SCREEN. `#/vault` is
  // how the address says it means no workspace: without it the launch would open
  // the folder used last, which is the one just closed.
  expect(await page.evaluate(() => location.search)).not.toContain("vault=");
  expect(await page.evaluate(() => location.hash)).toBe("#/vault");
  expect(await page.locator("nav.rack div.rackfoot").count()).toBe(0);

  // AND THE WORKSPACE JUST CLOSED IS IN RECENT, which is where whoever closed it
  // will look for it. It used to be the one folder NOT in this list — it was
  // named in an "Open now" block above it instead, and offering it twice was the
  // one row that did nothing — and with nothing open there is nothing to filter.
  //
  // IN THE LIST RATHER THAN AT THE HEAD OF IT, and the difference is this walk
  // rather than the feature. The remembered list is ordered by MOUNT, and step 2
  // made a second workspace after this one was mounted — so Cellar is at the top
  // here. Close a workspace you have been working in and it is the last thing
  // mounted, which is the head.
  expect(await page.locator("div.vrecent").innerText()).toContain(vault);

  // THE SECOND WORKSPACE HAS NEVER BEEN OPENED, so Browse is the only way to it
  // — which is what Browse is for, and what the built application's folder
  // dialog does in its place. The listing already stands in the parent this
  // run made both folders in.
  const row = page.locator("div.vdirs div.vrow", { hasText: "Cellar" }).first();
  await until("Browse offered the folder on disk", BOUNDS.draw, async () => (await row.count()) > 0);
  // It is marked as one, which is `vault.browse` reading the folder rather than
  // the picker guessing from the name.
  expect(await row.locator("span.vtag").innerText()).toBe("workspace");

  // THE BUTTON, NOT A CONSTRUCTED ADDRESS. `a.vgo` calls `vault.open` first —
  // a folder that cannot be a workspace has to say so ON THIS SCREEN rather
  // than after a navigation — and goes there only once that answers.
  await row.locator("a.vgo").first().click();

  await until("the root page of the opened workspace drew", BOUNDS.draw, async () => {
    const hash = await page.evaluate(() => location.hash);
    if (!hash.includes("home")) return false;
    const said = await page.frameLocator("iframe.artifact").locator("body").innerText().catch(() => "");
    return said.includes("Point your agent at this folder");
  });

  // The folder that was opened is the folder that was asked for, and the page
  // is its root rather than whatever the previous screen was looking at.
  expect(decodeURIComponent(await page.evaluate(() => location.search))).toContain(second);
  const body = await page.frameLocator("iframe.artifact").locator("body").innerText();
  expect(body).toContain("Point your agent at this folder");
  // Its own root, freshly seeded — not the first workspace's, which by now
  // carries a Kitchen the seeder never wrote.
  expect(await page.locator("nav.rack").innerText()).not.toContain("Kitchen");
});

walk("nothing threw, and nothing was written outside this run's own folder", async () => {
  // THE WHOLE RUN'S STDERR, read once at the end. A frame anywhere in it means
  // something threw where a refusal was supposed to be a sentence.
  expect(stackTraces(said.err)).toEqual([]);

  // THE FIRST BUG ON THE OWNER'S LIST, as an assertion. Agents' test runs had
  // written a scratch vault into the real per-user data directory, and the
  // packaged application then opened it instead of the picker.
  expect(outside()).toBe(before);
  // And the redirect was real rather than vacuously satisfied: this run's own
  // data directory is where the remembered list landed.
  expect(existsSync(join(box.data, "vaults.json"))).toBe(true);
});

/** One page document, whole. The shortest way to say "this page is now these
 *  words" from outside the application, which is what an agent does. */
function doc(name: string, words: string): string {
  return [
    `name: ${name}`,
    "plugin: doc",
    "contents:",
    "  - name: body",
    "    parts:",
    `      body: ${JSON.stringify(words)}`,
    "",
  ].join("\n");
}
