// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — A PAGE, DRAWN IN A BROWSER THE SERVER OWNS, AND READ BACK.
//
// The tab cannot read the box: the page is drawn in a sandboxed frame with an
// opaque origin, and that boundary is deliberate. A browser driver is not
// bound by it. So the server opens its own address in the Chromium that
// `make browser` installs, waits for the page to say it has drawn, and reads
// the frame's document through the driver.
//
// PLAYWRIGHT IS A DEVELOPMENT DEPENDENCY AND THIS IS THE ONE PLACE IT IS
// IMPORTED. It is imported late, inside the call, so a build without it — the
// compiled application — loads this module fine and fails only when asked to
// capture, with a sentence rather than a stack. The route refuses the kind in
// production anyway; this is the belt under that brace.
//
// THE WAIT IS FOR THE STATUS STRIP, and that is measured rather than chosen:
// a raw `--screenshot` fires before the handshake and captures an empty box,
// which the repository's own notes record. The strip reads `Drawn N` once the
// runtime has posted `ready`, and `tests/e2e/server.e2e.ts` waits for the same
// thing for the same reason.
//
// THE PAGE IS SCROLLED THROUGH ONCE before it is read, so a section that
// reveals itself on sight has been seen and captures revealed rather than
// hidden. Then the serializer runs inside the frame: every `<script>` out,
// every `<canvas>` turned into the picture it was showing, and the document
// as text. The theme needs nothing — the shim wrote the palette as an inline
// style on the root element, and that attribute serialises with the rest.

export interface CaptureAt {
  /** The server's own origin, `http://localhost:4400`. */
  origin: string;
  /** The vault's absolute path, which the address names. */
  vault: string;
  /** The launch token, or null when this build mints none. */
  token: string | null;
}

/** How long the page has to draw before the capture gives up. Generous,
 *  because a first launch of Chromium on a cold machine is most of it. */
const DRAW_MS = 45_000;
/** How long the page is given to settle after being scrolled through. */
const SETTLE_MS = 1_500;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const internal = (message: string): Error => Object.assign(new Error(message), { code: "internal" });

/**
 * Draw `page` and answer its document as text.
 */
export async function capturePage(at: CaptureAt, page: string): Promise<string> {
  // A COMPUTED SPECIFIER ON PURPOSE. `bun build --compile` bundles every import
  // it can see, and it can see a literal `import("playwright")` — which pulls
  // the whole driver and its optional dependencies into a binary that never
  // runs this line. A compiled build is handed no capture at all (the
  // composition root says so), so the import is hidden from the bundler and
  // resolved by the runtime, which is the one that will actually call it.
  const specifier = ["play", "wright"].join("");
  let pw: typeof import("playwright");
  try {
    pw = await import(specifier);
  } catch {
    throw internal("this server cannot capture a page: playwright is not installed");
  }

  const query = new URLSearchParams({ vault: at.vault });
  if (at.token !== null) query.set("token", at.token);
  const url = `${at.origin}/?${query.toString()}#/page/${encodeURIComponent(page)}`;

  // `--no-sandbox` is the same env knob the e2e run has, for the same reason: a
  // container without user namespaces needs it and a developer's machine must
  // not have it quietly turned on.
  const args = process.env.E2E_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [];
  let browser: import("playwright").Browser | null = null;
  try {
    browser = await pw.chromium.launch({ headless: true, args });
  } catch (e) {
    throw internal(`this server cannot capture a page: Chromium did not launch (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
  }

  try {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await tab.goto(url, { waitUntil: "domcontentloaded" });

    const t0 = Date.now();
    let drawn = false;
    while (Date.now() - t0 < DRAW_MS) {
      const strip = await tab.locator("span.status").innerText({ timeout: 1_000 }).catch(() => "");
      if (/Drawn\s*\d+/.test(strip.replace(/\s+/g, " "))) { drawn = true; break; }
      await sleep(250);
    }
    if (!drawn) throw internal("the page did not draw in time");

    const frame = tab.frames().find((f) => f !== tab.mainFrame());
    if (!frame) throw internal("the page drew but there is no box to read");

    // Seen once, end to end, then back to the top so the capture starts
    // where a reader will.
    await frame.evaluate(async () => {
      const doc = document.documentElement;
      const step = Math.max(200, window.innerHeight * 0.8);
      for (let y = 0; y < doc.scrollHeight; y += step) {
        doc.scrollTop = y;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      doc.scrollTop = 0;
    });
    await sleep(SETTLE_MS);

    // THE SHEET IS THE HOST'S. The box is transparent and the app paints
    // `--paper` on the document around it, so a capture with no ground would
    // open as cream ink on a white page. The value is read off the host, the
    // way the shim already wrote the rest of the palette onto the box's root.
    const paper = await tab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--paper").trim());

    return await frame.evaluate((paper: string) => {
      const root = document.documentElement.cloneNode(true) as HTMLElement;
      for (const s of Array.from(root.querySelectorAll("script"))) s.remove();
      // EVERY SCENE PLAYS. The `inview` plugin marks a section on screen and
      // clears it off screen, and the capture is taken scrolled to the top, so
      // without this every scene below the fold would rest paused forever.
      for (const el of Array.from(root.querySelectorAll("[data-g-section]"))) el.classList.add("in-view");
      if (paper) {
        root.style.setProperty("--paper", paper);
        const ground = document.createElement("style");
        ground.textContent = "html{background:var(--paper)}";
        (root.querySelector("head") ?? root).prepend(ground);
      }
      // A canvas holds nothing serialisable; the picture it was showing does.
      const live = Array.from(document.querySelectorAll("canvas"));
      const copies = Array.from(root.querySelectorAll("canvas"));
      copies.forEach((c, i) => {
        const src = live[i];
        const img = document.createElement("img");
        try { img.src = src ? src.toDataURL() : ""; } catch { img.src = ""; }
        img.width = src?.width ?? 0;
        img.height = src?.height ?? 0;
        img.setAttribute("class", c.getAttribute("class") ?? "");
        c.replaceWith(img);
      });
      return "<!doctype html>\n" + root.outerHTML;
    }, paper);
  } finally {
    await browser.close().catch(() => {});
  }
}
