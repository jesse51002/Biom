// Renders the demo GIFs and their still frames from stage.html.
//
//   node landing-demo/render.mjs                 every layout, both variants
//   node landing-demo/render.mjs desktop scheduled
//   node landing-demo/render.mjs --frame 1,4.6 [layout] [variant]   stills at those seconds
//
// Needs `make install` (for Playwright), the Chromium `make browser` fetches —
// or PLAYWRIGHT_CHROMIUM pointed at one — and ffmpeg on the PATH. Writes into
// landing-demo/out/. The stage is a pure function of t, so every frame is
// rendered by asking for it, never by waiting for it.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { FPS, DURATION, VARIANTS } from "./timeline.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(HERE, "out");

/** Each composition: the stage's layout, its CSS size, and the pixel ratio the
 *  GIF is drawn at. The narrow one is drawn at 2× so it stays legible on a
 *  phone, which is the point of having it. */
export const LAYOUTS = {
  desktop: { scale: 1.5 },
  mobile: { scale: 2 },
};
const VARIANT_NAMES = Object.keys(VARIANTS);
/** The still: the finished page, mid-hold. */
const STILL_AT = 6.4;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".gif": "image/gif" };

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = resolve(ROOT, "." + path);
    if (!file.startsWith(ROOT + "/")) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

function browserPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const pinned = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  return existsSync(pinned) ? pinned : undefined;
}

async function open(browser, base, layout, variant) {
  const { scale } = LAYOUTS[layout];
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: scale });
  await page.goto(`${base}/landing-demo/stage.html?layout=${layout}&variant=${variant}`);
  await page.waitForFunction(() => window.stageReady === true, null, { timeout: 15000 });
  const clip = await page.evaluate(() => window.stageSize());
  return { page, clip };
}

async function shoot(page, clip, t, path) {
  await page.evaluate((t) => window.renderAt(t), t);
  return page.screenshot({ path, clip, animations: "disabled", caret: "hide" });
}

/** Every frame is written; frames identical to the one before are then
 *  dropped by `mpdecimate` with a zero tolerance, and the GIF keeps the 1/15s
 *  timestamps of what is left, so the hold is one frame with a long delay —
 *  which is what keeps the GIF small — and every other delay is 1/15s. */
async function renderGif(browser, base, layout, variant) {
  const name = `demo-${layout}-${variant}`;
  const dir = join(OUT, ".frames", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const { page, clip } = await open(browser, base, layout, variant);
  const total = Math.round(DURATION * FPS);
  let distinct = 0, last = null;
  for (let f = 0; f < total; f++) {
    const buf = await shoot(page, clip, f / FPS, join(dir, `${String(f).padStart(3, "0")}.png`));
    if (!last || !buf.equals(last)) distinct++;
    last = buf;
  }
  await page.close();

  const frames = ["-framerate", String(FPS), "-i", join(dir, "%03d.png")];
  const palette = join(dir, "palette.png");
  const gif = join(OUT, `${name}.gif`);
  const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  ff([...frames, "-vf", "palettegen=max_colors=256:stats_mode=full", palette]);
  ff([...frames, "-i", palette,
      "-lavfi", "[0:v]mpdecimate=hi=1:lo=1:frac=0:max=0[d];[d][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
      "-fps_mode", "vfr", "-loop", "0", gif]);

  const still = join(OUT, `${name}-still.png`);
  const p2 = await open(browser, base, layout, variant);
  await shoot(p2.page, p2.clip, STILL_AT, still);
  await p2.page.close();
  const { size } = await import("node:fs").then((fs) => fs.statSync(gif));
  return { name, gif, still, kept: distinct, total, width: Math.round(clip.width * LAYOUTS[layout].scale), height: Math.round(clip.height * LAYOUTS[layout].scale), size };
}

/** out/preview-<variant>.html: section.html exactly as it would be pasted,
 *  pointed at this variant's files, between a stand-in hero and a stand-in
 *  next section — so the section's size, its reserved box and normal
 *  scrolling past it can be checked on a laptop and a phone. The hero is NOT
 *  biom.dev's: that page's source is not in this repository. */
async function writePreview(variant) {
  const section = (await readFile(join(HERE, "section.html"), "utf8"))
    .replace(/demo-(desktop|mobile)(-still)?\.(gif|png)/g, (_, l, st, ext) => `demo-${l}-${variant}${st || ""}.${ext}`)
    .replace(/alt="[^"]*"/, `alt="${VARIANTS[variant].alt.replace(/"/g, "&quot;")}"`);
  const other = Object.keys(VARIANTS).find((v) => v !== variant);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo section preview</title>
<style>
  html,body{margin:0; background:#0E0F11; color:#EDE6D6; font-family:Georgia,"Times New Roman",serif}
  .standin{min-height:72svh; display:grid; place-content:center; text-align:center; padding:48px 16px; box-sizing:border-box}
  .standin h1{margin:0; font-size:clamp(34px, 6vw, 72px); line-height:1.05; letter-spacing:-.01em; font-weight:700}
  .standin p{margin:18px 0 0; color:#B9B3A5; font-size:clamp(16px, 2vw, 20px)}
  .note{font:12px ui-monospace,monospace; color:#8F8A7C; letter-spacing:.04em}
  .next{min-height:60svh; display:grid; place-content:center; padding:48px 16px; border-top:1px solid #2C3036; text-align:center}
  .bar{position:fixed; right:12px; bottom:12px; z-index:9; font:12px ui-monospace,monospace; background:#16181B; border:1px solid #3A3F47; padding:6px 10px}
  .bar a{color:#FFC759}
</style></head><body>
<header class="standin"><div class="note">STAND-IN HERO · not biom.dev's</div><h1>A living workspace<br>for humans and agents</h1><p>The demo section follows directly.</p></header>
${section}
<section class="next"><div class="note">STAND-IN · the rest of the page</div><p>Scrolling continues normally past the demo.</p></section>
<div class="bar">variant: <b>${variant}</b> · <a href="preview-${other}.html">${other}</a></div>
</body></html>
`;
  await writeFile(join(OUT, `preview-${variant}.html`), html);
}

const args = process.argv.slice(2);
await mkdir(OUT, { recursive: true });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: browserPath() });
try {
  if (args[0] === "--preview") {
    for (const variant of Object.keys(VARIANTS)) await writePreview(variant);
  } else if (args[0] === "--frame") {
    const times = args[1].split(",").map(Number);
    const layouts = args[2] ? [args[2]] : Object.keys(LAYOUTS);
    const variants = args[3] ? [args[3]] : VARIANT_NAMES;
    for (const layout of layouts) for (const variant of variants) {
      const { page, clip } = await open(browser, base, layout, variant);
      for (const t of times) {
        const path = join(OUT, ".frames", `at-${t}-${layout}-${variant}.png`);
        await mkdir(dirname(path), { recursive: true });
        await shoot(page, clip, t, path);
        console.log(path);
      }
      await page.close();
    }
  } else {
    const layouts = args[0] ? [args[0]] : Object.keys(LAYOUTS);
    const variants = args[1] ? [args[1]] : VARIANT_NAMES;
    for (const layout of layouts) for (const variant of variants) {
      const r = await renderGif(browser, base, layout, variant);
      console.log(`${r.name}.gif  ${r.width}×${r.height}  ${(r.size / 1024).toFixed(0)} KB  ${r.kept} distinct of ${r.total} frames`);
    }
    for (const variant of variants) await writePreview(variant);
  }
} finally {
  await browser.close();
  server.close();
}
