// SPDX-License-Identifier: AGPL-3.0-only
// The share rewrite, held against the three ways a capture points at the
// server, and the sharer's refusals in the order it makes them. No browser and
// no bucket: `standalone` is pure text-to-text, and `makeSharer` is handed a
// capture, a source and an upload that are all fakes — a test that launched
// Chromium to check a regex would be a slow test of the wrong thing.

import { test, expect } from "bun:test";
import { standalone, makeSharer } from "../server/domain/share.ts";
import { makeBucket } from "../server/platform/bucket.ts";
import type { Sources } from "../server/domain/share.ts";
import type { Page, Pages } from "../contracts/types.ts";

const ORIGIN = "http://localhost:4400";
const BASE = "/v/%2Fhome%2Fx%2Fvault/asset/";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const b64 = (s: string): string => Buffer.from(s).toString("base64");

function sources(have: Record<string, string> = {}): Sources {
  return {
    origin: ORIGIN,
    async font(name) { return name in have ? bytes(have[name] as string) : null; },
    async asset(rel) { return rel in have ? bytes(have[rel] as string) : null; },
  };
}

test("fonts written absolute by faceCss become data urls, once per face", async () => {
  const html = `<style>@font-face{font-family:A;src:url(${ORIGIN}/fonts/a.woff2)}` +
    `@font-face{font-family:B;src:url("${ORIGIN}/fonts/a.woff2") format("woff2")}</style>`;
  const out = await standalone(html, sources({ "a.woff2": "FONT" }));
  expect(out.left).toEqual([]);
  expect(out.html).not.toContain("/fonts/");
  const uri = `data:font/woff2;base64,${b64("FONT")}`;
  expect(out.html.split(uri).length - 1).toBe(2);
});

test("a font the server does not hold is left as it was and named", async () => {
  const html = `<style>src:url(${ORIGIN}/fonts/gone.woff2)</style>`;
  const out = await standalone(html, sources());
  expect(out.html).toContain(`${ORIGIN}/fonts/gone.woff2`);
  expect(out.left).toEqual(["fonts/gone.woff2"]);
});

test("the base tag goes, and every relative src under it is folded in", async () => {
  const html = `<html><head><base href="${BASE}"><title>t</title></head>` +
    `<body><img src="kitchen.jpg"><img src='pics/a b.png'><video src="${BASE}clip.mp4"></video>` +
    `<img src="https://elsewhere/x.png"><img src="data:image/png;base64,AAAA"><a href="notes.md">n</a></body></html>`;
  const out = await standalone(html, sources({ "kitchen.jpg": "JPG", "pics/a b.png": "PNG", "clip.mp4": "MP4" }));
  expect(out.html).not.toContain("<base");
  expect(out.html).toContain(`src="data:image/jpeg;base64,${b64("JPG")}"`);
  expect(out.html).toContain(`src='data:image/png;base64,${b64("PNG")}'`);
  expect(out.html).toContain(`src="data:video/mp4;base64,${b64("MP4")}"`);
  // Absolute, data and a link into the vault are all left alone.
  expect(out.html).toContain(`src="https://elsewhere/x.png"`);
  expect(out.html).toContain(`src="data:image/png;base64,AAAA"`);
  expect(out.html).toContain(`href="notes.md"`);
  expect(out.left).toEqual([]);
});

test("an asset that is not there is left pointing where it pointed and named once", async () => {
  const html = `<base href="${BASE}"><img src="a.png"><img src="a.png">`;
  const out = await standalone(html, sources());
  expect(out.html).toContain(`src="a.png"`);
  expect(out.left).toEqual(["assets/a.png"]);
});

/* ── the sharer ─────────────────────────────────────────────────────────── */

const fakePages = (has: boolean): Pages => ({
  async read() { return has ? ({ id: "home/x", name: "x" } as unknown as Page) : null; },
} as unknown as Pages);

function sharer(o: { has?: boolean; missing?: string | null; capture?: () => Promise<string> } = {}) {
  const puts: Array<{ key: string; html: string }> = [];
  const made = makeSharer({
    pages: fakePages(o.has ?? true),
    capture: o.capture ?? (async () => `<html><head><base href="${BASE}"></head><body><img src="a.png"></body></html>`),
    sources: () => sources({ "a.png": "PNG" }),
    upload: {
      missing: () => o.missing === undefined ? null : o.missing,
      async put(key, html) { puts.push({ key, html }); return `https://b.example/${key}`; },
    },
  });
  return { made, puts };
}

test("a share captures, rewrites, uploads under a fresh uuid and answers the link", async () => {
  const { made, puts } = sharer();
  const a = await made.share("home/x");
  const b = await made.share("home/x");
  expect(a.key).toMatch(/^[0-9a-f-]{36}\.html$/);
  expect(a.key).not.toBe(b.key);
  expect(a.url).toBe(`https://b.example/${a.key}`);
  expect(a.left).toEqual([]);
  expect(puts).toHaveLength(2);
  expect(puts[0]?.html).not.toContain("<base");
  expect(puts[0]?.html).toContain("data:image/png");
});

test("the bucket not being set up refuses before anything is captured, naming the variable", async () => {
  let captured = 0;
  const { made, puts } = sharer({ missing: "BIOM_SHARE_BUCKET", capture: async () => { captured++; return ""; } });
  await expect(made.share("home/x")).rejects.toMatchObject({ code: "unsupported", message: expect.stringContaining("BIOM_SHARE_BUCKET") });
  expect(captured).toBe(0);
  expect(puts).toHaveLength(0);
});

test("a page that is not there is not_found, and nothing is captured", async () => {
  let captured = 0;
  const { made } = sharer({ has: false, capture: async () => { captured++; return ""; } });
  await expect(made.share("home/nope")).rejects.toMatchObject({ code: "not_found" });
  expect(captured).toBe(0);
});

test("the bucket names the first missing variable and nothing when all five are set", () => {
  expect(makeBucket({}).missing()).toBe("AWS_ACCESS_KEY_ID");
  expect(makeBucket({ AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", AWS_REGION: "r" }).missing()).toBe("BIOM_SHARE_BUCKET");
  expect(makeBucket({
    AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", AWS_REGION: "r", BIOM_SHARE_BUCKET: "k", BIOM_SHARE_HOST: "h",
  }).missing()).toBeNull();
});
