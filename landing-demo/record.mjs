// Films the real tool running in the real app, and exports the GIFs.
//
//   node landing-demo/record.mjs            desktop and mobile
//   node landing-demo/record.mjs desktop    one
//
// Nothing here is drawn by hand. It makes a scratch workspace, puts the Inbound
// tool in it (tool/Inbound: a page with its own interface and a `triage`
// automation), fills the `inbound` table with twelve invented requests, starts
// Biom on it, opens the page in Chromium, presses Run triage, and films the
// screen while the automation does its four steps per request and the page
// draws them. Then it frames the film — the whole window first, then the tool
// filling the frame — and writes a GIF.
//
// Needs `make install` (Playwright), Chromium (`make browser`, or
// PLAYWRIGHT_CHROMIUM), ffmpeg and bun on the PATH. Writes landing-demo/out/.

import { spawn, execFileSync } from "node:child_process";
import { mkdir, rm, cp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(HERE, "out");
const WORK = join(OUT, ".rec");
const PORT = 4410;
/** The folder's name is the workspace's name in the breadcrumb. */
const VAULT_NAME = "Fernway";
const FPS = 12;

/** Each composition. `wide` is the opening framing (null for none); the
 *  film then eases into the page's canvas, which is what fills the GIF while
 *  the tool works. `aspect` is the GIF's, and the canvas is cropped to it
 *  around its centre — the tool's own padding is what the crop takes. */
const LAYOUTS = {
  // 820 tall makes the canvas 16:10 itself, so the close shot crops nothing
  desktop: { viewport: { width: 1440, height: 820 }, scale: 1.25, rack: 260, out: { width: 1280, height: 800 }, wide: true, runAt: 1.25 },
  mobile: { viewport: { width: 596, height: 737 }, scale: 2.5, rack: 176, out: { width: 780, height: 1238 }, wide: false, runAt: 0.7 },
};
const HOLD = 3.0;        // seconds the finished tool holds before the loop
/** The opening: the whole workspace for a moment, then a quick push into the
 *  tool. Quick on purpose — every frame of a camera move is a whole new
 *  picture to a GIF, and these few cost as much as the whole workflow. The
 *  loop is a plain cut back to the start, for the same reason. */
const ZOOM_IN = [0.45, 0.95];

function browserPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const pinned = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  return existsSync(pinned) ? pinned : undefined;
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/* ── a workspace with the tool in it ─────────────────────────────────────── */

async function workspace(name) {
  const dir = join(WORK, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, VAULT_NAME), { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });
  return dir;
}

async function serve(dir) {
  const env = {
    ...process.env, PORT: String(PORT), VAULT: join(dir, VAULT_NAME), VAULTS: join(dir, "data", "vaults.json"),
    XDG_DATA_HOME: join(dir, "data"), BIOM_ENV: "production", BIOM_NO_UPDATE_CHECK: "1",
  };
  const proc = spawn("bun", ["run", join(ROOT, "server/main.ts")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (b) => { log += b; });
  proc.stderr.on("data", (b) => { log += b; });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch {}
    await sleep(250);
  }
  return { proc, log: () => log };
}

function api(dir) {
  const url = `http://127.0.0.1:${PORT}/v/${encodeURIComponent(join(dir, VAULT_NAME))}/api/call`;
  let n = 0;
  return async (kind, body = {}) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: `r${++n}`, g: 1, kind, ...body }) });
    const j = await res.json();
    if (!j.ok) throw new Error(`${kind}: ${j.error?.message}`);
    return j.value;
  };
}

/** Pages a startup's workspace would already hold, so the rail is lived in. */
const NEIGHBOURS = ["Customer calls", "Pipeline", "Hiring", "Investor updates"];

async function install(dir) {
  const vault = join(dir, VAULT_NAME);
  const call = api(dir);
  await call("vault.info");                      // waits for the mount
  const home = join(vault, "pages/home/children");
  await mkdir(home, { recursive: true });
  for (const name of NEIGHBOURS) {
    const d = join(home, name.replace(/ /g, "_"));
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "content.yaml"), `name: ${name}\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body: |\n        # ${name}\n`);
  }
  await cp(join(HERE, "tool/Inbound"), join(home, "Inbound"), { recursive: true });
  await call("table.create", { schema: { name: "inbound", kind: "basic", columns: [
    { name: "Company", type: "text" }, { name: "Contact", type: "text" }, { name: "Ask", type: "text" },
    { name: "Arrived", type: "number" }, { name: "Status", type: "text" },
    { name: "People", type: "number" }, { name: "Funding", type: "text" }, { name: "Stack", type: "text" },
    { name: "Fit", type: "number" }, { name: "Why", type: "text" }, { name: "Reply", type: "text" },
  ] } });
  const requests = JSON.parse(await readFile(join(HERE, "tool/requests.json"), "utf8"));
  for (const [i, r] of requests.entries()) await call("row.insert", { name: "inbound", row: { ...r, Arrived: i + 1, Status: "new" } });
  await call("table.setParent", { name: "inbound", parent: "home/Inbound" });
  await sleep(1500);                              // the watcher sees the new pages
}

/* ── filming ─────────────────────────────────────────────────────────────── */

async function film(browser, dir, L) {
  const ctx = await browser.newContext({ viewport: L.viewport, deviceScaleFactor: L.scale });
  await ctx.addInitScript((w) => { try { localStorage.setItem("biom.rack.width", String(w)); } catch {} }, L.rack);
  const page = await ctx.newPage();
  const vault = join(dir, VAULT_NAME);
  await page.goto(`http://127.0.0.1:${PORT}/?vault=${encodeURIComponent(vault)}#/page/${encodeURIComponent("home/Inbound")}`);

  // the tool's own frame, once it has drawn
  let tool = null;
  for (let i = 0; i < 120 && !tool; i++) {
    for (const f of page.frames()) {
      if (await f.locator("body[data-ready]").count().catch(() => 0)) { tool = f; break; }
    }
    if (!tool) await sleep(250);
  }
  if (!tool) throw new Error("the Inbound page never drew");
  await page.mouse.move(L.viewport.width - 4, L.viewport.height - 4);
  await sleep(1200);                              // fonts, and the rail settling
  const canvas = await page.locator(".canvas").boundingBox();

  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
  });
  // at the device pixel ratio, or the camera has nothing to zoom into
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: Math.round(L.viewport.width * L.scale), maxHeight: Math.round(L.viewport.height * L.scale) });
  const t0 = Date.now() / 1000;
  await sleep(L.runAt * 1000);
  await tool.locator("#run").click();
  await tool.locator("body[data-done]").waitFor({ timeout: 60000 });
  const doneAt = Date.now() / 1000 - t0;
  await sleep(HOLD * 1000);
  await cdp.send("Page.stopScreencast");
  await ctx.close();
  const length = Date.now() / 1000 - t0;

  // resample to a constant 15 fps: each tick takes the newest frame at or before it
  frames.sort((a, b) => a.t - b.t);
  const start = frames[0].t;
  const ticks = Math.round(length * FPS);
  let j = 0;
  const files = [];
  for (let k = 0; k < ticks; k++) {
    const at = start + k / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= at) j++;
    files.push(frames[j].data);
  }
  return { files, canvas, length, doneAt };
}

/* ── framing: wide, then the canvas, then back ──────────────────────────── */

/** The crop rect for each output frame, in CSS pixels of the filmed window. */
function camera(L, canvas, count) {
  const A = L.out.width / L.out.height;
  // the canvas, cropped to the GIF's shape around its centre
  let cw = canvas.width, ch = cw / A;
  if (ch > canvas.height) { ch = canvas.height; cw = ch * A; }
  const close = { x: canvas.x + (canvas.width - cw) / 2, y: canvas.y + (canvas.height - ch) / 2, w: cw, h: ch };
  // the whole window, letterboxed into the same shape: nothing of it is cut,
  // so the opening shows every part of the workspace before the push
  let ww = L.viewport.width, wh = ww / A;
  if (wh < L.viewport.height) { wh = L.viewport.height; ww = wh * A; }
  const wide = { x: (L.viewport.width - ww) / 2, y: (L.viewport.height - wh) / 2, w: ww, h: wh };
  const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, w: a.w + (b.w - a.w) * u, h: a.h + (b.h - a.h) * u });
  const rects = [];
  for (let k = 0; k < count; k++) {
    const t = k / FPS;
    rects.push(L.wide ? lerp(wide, close, ease((t - ZOOM_IN[0]) / (ZOOM_IN[1] - ZOOM_IN[0]))) : close);
  }
  return rects;
}

async function compose(browser, L, shot, frameDir) {
  const page = await browser.newPage({ viewport: L.out, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:#0E0F11"><canvas id="c" width="${L.out.width}" height="${L.out.height}"></canvas></body></html>`);
  const rects = camera(L, shot.canvas, shot.files.length);
  for (let k = 0; k < shot.files.length; k++) {
    const r = rects[k];
    const png = await page.evaluate(async ({ data, r, vw, W, H }) => {
      const load = (d) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + d; });
      const c = document.getElementById("c"), g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      const img = await load(data);
      const scale = img.width / vw;       // what the screencast actually delivered
      g.fillStyle = "#0E0F11";
      g.fillRect(0, 0, W, H);
      // a source rect past the film's edge (the letterbox) is clipped, and the
      // destination with it, so the bars are the ground
      g.drawImage(img, r.x * scale, r.y * scale, r.w * scale, r.h * scale, 0, 0, W, H);
      return c.toDataURL("image/png").slice(22);
    }, { data: shot.files[k], r, vw: L.viewport.width, W: L.out.width, H: L.out.height });
    await writeFile(join(frameDir, `${String(k).padStart(4, "0")}.png`), Buffer.from(png, "base64"));
  }
  await page.close();
}

/** The hold at the end is identical frames, which the encoder drops, and a
 *  GIF's last frame then shows for one tick. So the last frame's delay — the
 *  two bytes in its Graphic Control Extension — is set to cover the rest. */
async function holdLastFrame(file, seconds) {
  const buf = await readFile(file);
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString();
  const short = seconds - Number(probe);
  if (!(short > 0.01)) return;
  for (let i = buf.length - 9; i >= 0; i--) {
    // 21 F9 04 packed delay(2) transparent 00, then the image descriptor 2C
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04 && buf[i + 7] === 0x00 && buf[i + 8] === 0x2c) {
      const delay = buf.readUInt16LE(i + 4) + Math.round(short * 100);
      buf.writeUInt16LE(Math.min(delay, 0xffff), i + 4);
      await writeFile(file, buf);
      return;
    }
  }
  throw new Error("no frame found to hold in " + file);
}

function gif(frameDir, name) {
  const frames = ["-framerate", String(FPS), "-i", join(frameDir, "%04d.png")];
  const palette = join(frameDir, "palette.png");
  const out = join(OUT, `${name}.gif`);
  const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  ff([...frames, "-vf", "palettegen=max_colors=256:stats_mode=diff", palette]);
  ff([...frames, "-i", palette,
      "-lavfi", "[0:v]mpdecimate=hi=64*4:lo=64*2:frac=0.1:max=0[d];[d][1:v]paletteuse=dither=none:diff_mode=rectangle",
      "-fps_mode", "vfr", "-loop", "0", out]);
  return out;
}

/** out/preview-tool.html: section.html as it would be pasted, pointed at
 *  these GIFs, between a stand-in hero and a stand-in next section. */
async function preview() {
  const alt = "Biom, with a custom tool called Inbound open in a workspace. Run triage is pressed and an automation takes twelve demo requests through four steps: research, enrich, score and draft. The tool draws each step as it lands, marks three requests hot and the rest nurture, drafts a reply to the hottest one, and sorts the queue by fit. Illustrative demo, invented data.";
  const section = (await readFile(join(HERE, "section.html"), "utf8"))
    .replace(/demo-(desktop|mobile)(-still)?\.(gif|png)/g, (_, l, st, ext) => `demo-tool-${l}${st || ""}.${ext}`)
    .replace(/width="1920" height="1200"/g, 'width="1280" height="800"')
    .replace(/width="780" height="1240"/g, 'width="780" height="1238"')
    .replace(/alt="[^"]*"/, `alt="${alt}"`);
  await writeFile(join(OUT, "preview-tool.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo section preview · tool</title>
<style>
  html,body{margin:0; background:#0E0F11; color:#EDE6D6; font-family:Georgia,"Times New Roman",serif}
  .standin{min-height:72svh; display:grid; place-content:center; text-align:center; padding:48px 16px; box-sizing:border-box}
  .standin h1{margin:0; font-size:clamp(34px, 6vw, 72px); line-height:1.05; letter-spacing:-.01em; font-weight:700}
  .standin p{margin:18px 0 0; color:#B9B3A5; font-size:clamp(16px, 2vw, 20px)}
  .note{font:12px ui-monospace,monospace; color:#8F8A7C; letter-spacing:.04em}
  .next{min-height:60svh; display:grid; place-content:center; padding:48px 16px; border-top:1px solid #2C3036; text-align:center}
</style></head><body>
<header class="standin"><div class="note">STAND-IN HERO · not biom.dev's</div><h1>A living workspace<br>for humans and agents</h1><p>The demo section follows directly.</p></header>
${section}
<section class="next"><div class="note">STAND-IN · the rest of the page</div><p>Scrolling continues normally past the demo.</p></section>
</body></html>
`);
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const only = process.argv[2];
const browser = await chromium.launch({ executablePath: browserPath() });
try {
  for (const [name, L] of Object.entries(LAYOUTS)) {
    if (only && only !== name) continue;
    const dir = await workspace(name);
    const server = await serve(dir);
    try {
      await install(dir);
      const shot = await film(browser, dir, L);
      const frameDir = join(WORK, `${name}-frames`);
      await rm(frameDir, { recursive: true, force: true });
      await mkdir(frameDir, { recursive: true });
      await compose(browser, L, shot, frameDir);
      // the still: the finished tool, mid-hold
      const still = Math.min(shot.files.length - 1, Math.round((shot.doneAt + 1.6) * FPS));
      await cp(join(frameDir, `${String(still).padStart(4, "0")}.png`), join(OUT, `demo-tool-${name}-still.png`));
      const out = gif(frameDir, `demo-tool-${name}`);
      await holdLastFrame(out, shot.files.length / FPS);
      const kb = (execFileSync("stat", ["-c", "%s", out]).toString().trim() / 1024).toFixed(0);
      console.log(`demo-tool-${name}.gif  ${L.out.width}×${L.out.height}  ${kb} KB  ${shot.length.toFixed(1)} s  workflow done at ${shot.doneAt.toFixed(1)} s`);
    } catch (e) {
      console.error(server.log());
      throw e;
    } finally {
      server.proc.kill();
      await sleep(500);
    }
  }
  await preview();
} finally {
  await browser.close();
}
