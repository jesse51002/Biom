// SPDX-License-Identifier: AGPL-3.0-only
// JEV'S FACES: the two fixed lists, and the art each one ships with.
//
// The lists live in `server/domain/jev.ts`; the art in `vendor/noto/`, one
// animated WebP per face, credited in `vendor/noto/LICENSE` and `NOTICE` and
// recorded by hash in `vendor/README.md`. What this holds is that the three
// agree: every face on a list has its file, every file is a face on a list,
// every file is the one the README says was shipped, and the whole is inside
// the budget it was given. A face without its art would draw as a broken
// picture on somebody's message, and a file nobody names is weight nobody uses.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carried } from "../tools/app.ts";
import {
  JEV_LABEL_LIMIT,
  NAME_FACES,
  NAME_FALLBACK,
  NOTO_ROUTE,
  STATUS_FACES,
  emojiOf,
  faceOf,
} from "../server/domain/jev.ts";

const HERE = join(import.meta.dir, "..");
const NOTO = join(HERE, "vendor", "noto");
const EVERY = [...STATUS_FACES, ...NAME_FACES, NAME_FALLBACK];
/** The budget the faces were given: about 3 MB for the whole set. */
const BUDGET = 3_000_000;

test("each list fits Jev's limit, `other` included, and no label is spent twice", () => {
  for (const list of [STATUS_FACES, NAME_FACES]) {
    expect(list.length + 1).toBeLessThanOrEqual(JEV_LABEL_LIMIT);
    const labels = list.map((f) => f.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("other");
    const codes = list.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const f of list) {
      expect(f.label).toMatch(/^[a-z]+$/);
      // One line Jev chooses on: a sentence, not a paragraph.
      expect(f.criterion.trim()).toBe(f.criterion);
      expect(f.criterion).not.toContain("\n");
      expect(f.criterion.length).toBeGreaterThan(10);
      expect(f.criterion.length).toBeLessThan(160);
    }
  }
  expect(NAME_FACES.map((f) => f.code)).not.toContain(NAME_FALLBACK.code);
});

test("the mockup's ten faces are all on the status list, and the spec's figure's name face is a topic", () => {
  const status = new Set(STATUS_FACES.map((f) => emojiOf(f.code)));
  for (const face of ["🤔", "🧐", "🤓", "😬", "😅", "🫡", "😌", "🤩", "😵‍💫", "😶"]) expect([face, status.has(face)]).toEqual([face, true]);
  expect(NAME_FACES.map((f) => emojiOf(f.code))).toContain("🧹");
});

test("a Face's emoji and art are one emoji, spelled from Google's code", () => {
  expect(emojiOf("1f914")).toBe("🤔");
  expect(emojiOf("1f635_200d_1f4ab")).toBe("😵‍💫");
  expect(emojiOf("270d_fe0f")).toBe("✍️");
  for (const f of EVERY) {
    const face = faceOf(f);
    expect(face.art).toBe(`${NOTO_ROUTE}${f.code}.webp`);
    expect(face.emoji.length).toBeGreaterThan(0);
    expect(f.code).toMatch(/^[0-9a-f]{4,5}(_[0-9a-f]{4,5})*$/);
  }
});

/** The facts of an animated WebP a browser would draw: RIFF/WEBP, an extended
 *  header saying animation and alpha, its canvas, and its frames. */
function webpFacts(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  const out = { riff: tag(0) === "RIFF" && tag(8) === "WEBP", animated: false, alpha: false, width: 0, height: 0, anim: false, frames: 0 };
  expect(dv.getUint32(4, true) + 8).toBe(bytes.length);
  let o = 12;
  while (o + 8 <= bytes.length) {
    const kind = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (kind === "VP8X") {
      const flags = bytes[o + 8]!;
      out.animated = (flags & 0x02) !== 0;
      out.alpha = (flags & 0x10) !== 0;
      out.width = 1 + (bytes[o + 12]! | (bytes[o + 13]! << 8) | (bytes[o + 14]! << 16));
      out.height = 1 + (bytes[o + 15]! | (bytes[o + 16]! << 8) | (bytes[o + 17]! << 16));
    }
    if (kind === "ANIM") out.anim = true;
    if (kind === "ANMF") out.frames++;
    o += 8 + size + (size & 1);
  }
  return out;
}

test("EVERY FACE ON EVERY LIST HAS ITS ANIMATED ART ON DISK", () => {
  for (const f of EVERY) {
    const path = join(NOTO, `${f.code}.webp`);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(path));
    } catch {
      throw new Error(`${f.label} (${emojiOf(f.code)}) has no vendor/noto/${f.code}.webp`);
    }
    const facts = webpFacts(bytes);
    expect([f.code, facts]).toEqual([f.code, { riff: true, animated: true, alpha: true, width: 64, height: 64, anim: true, frames: facts.frames }]);
    expect(facts.frames).toBeGreaterThan(1);
  }
});

test("every file in vendor/noto/ is a face on a list, or its licence", () => {
  const named = new Set(EVERY.map((f) => `${f.code}.webp`));
  for (const name of readdirSync(NOTO)) {
    if (name === "LICENSE") continue;
    expect([name, named.has(name)]).toEqual([name, true]);
  }
});

test("what ships is what the README recorded, source and result, inside the budget", () => {
  const readme = readFileSync(join(HERE, "vendor", "README.md"), "utf8");
  let total = 0;
  for (const f of EVERY) {
    const bytes = readFileSync(join(NOTO, `${f.code}.webp`));
    total += bytes.length;
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect([f.code, readme.includes(`sha256  ${sha}  noto/${f.code}.webp`)]).toEqual([f.code, true]);
    expect([f.code, new RegExp(`sha256  [0-9a-f]{64}  ${f.code}/512\\.gif`).test(readme)]).toEqual([f.code, true]);
  }
  const files = readdirSync(NOTO).filter((n) => n.endsWith(".webp"));
  expect(files.length).toBe(EVERY.length);
  expect(files.reduce((sum, n) => sum + statSync(join(NOTO, n)).size, 0)).toBe(total);
  expect(total).toBeLessThan(BUDGET);
  // The README's own sentence about the size is the size.
  expect(readme).toContain(`**${EVERY.length} files, ${total.toLocaleString("en-US")} bytes`);
  expect(readme).toContain("| `noto/*.webp` |");
});

test("CC BY 4.0 is credited, with the change it asks to be told of", () => {
  const licence = readFileSync(join(NOTO, "LICENSE"), "utf8");
  expect(licence).toContain("© Google");
  expect(licence).toContain("CC BY 4.0");
  expect(licence).toContain("https://creativecommons.org/licenses/by/4.0/");
  expect(licence).toContain("https://fonts.gstatic.com/s/e/notoemoji/latest/");
  expect(licence).toContain("CHANGED");
  const notice = readFileSync(join(HERE, "NOTICE"), "utf8");
  expect(notice).toContain("Noto Emoji animations — CC BY 4.0");
  expect(notice).toContain("vendor/noto/LICENSE");
});

/* ── how the art reaches a screen ───────────────────────────────────────── */

test("the compiled application carries every face, because it walks vendor/ whole", async () => {
  const keys = new Set(await carried(HERE));
  for (const f of EVERY) expect([f.code, keys.has(`vendor/noto/${f.code}.webp`)]).toEqual([f.code, true]);
  expect(keys.has("vendor/noto/LICENSE")).toBe(true);
});

let vault = "";
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "biom-jev-faces-"));
  const port = 4400 + Math.floor(Math.random() * 400) + 500;
  base = `http://127.0.0.1:${port}`;
  proc = Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: { ...process.env, PORT: String(port), VAULT: vault, VAULTS: join(vault, ".vaults.json") },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/`);
      return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("the framework did not come up");
});

afterAll(() => {
  proc?.kill();
  rmSync(vault, { recursive: true, force: true });
});

test("the server serves every face at the url its Face names, byte for byte", async () => {
  for (const f of EVERY) {
    const res = await fetch(`${base}${faceOf(f).art}`);
    expect([f.code, res.status]).toEqual([f.code, 200]);
    expect(Buffer.from(await res.arrayBuffer()).equals(readFileSync(join(NOTO, `${f.code}.webp`)))).toBe(true);
  }
  expect((await fetch(`${base}/vendor/noto/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
});
