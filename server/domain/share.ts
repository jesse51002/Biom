// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — SHARE A PAGE: the drawn page, as one file, somewhere a link reaches.
//
// THIS IS A STOP-GAP AND IS WRITTEN TO BE THROWN AWAY. The hosted server makes
// every page viewable at a URL, and the moment that lands this module is
// obsolete. So it does the least that gives somebody a link to the content:
// the page is captured as it is drawn, made to stand alone, and put in a
// bucket under a random id. No data is recorded, no runtime is bundled, no
// nested page is followed, and the id is the whole of the security. The spec
// is `Specs/2026-09-16-Share_A_Page` in the internal workspace.
//
// THE HOST CANNOT SEE INTO THE BOX, AND THAT IS WHY THE SERVER CAPTURES. The
// page is drawn in a sandboxed frame with an opaque origin — `boundary-guide`
// says why — so the tab that shows it cannot read it. The server opens the
// page itself in a headless browser and reads the frame through the driver,
// which the boundary does not bind. That drive is `server/platform/capture.ts`;
// this file is handed it as a function and never sees a browser.
//
// WHAT THIS FILE OWNS IS THE REWRITE, and it is pure so a test can hold it. A
// capture out of the box points at the server three ways: every `@font-face`
// names `<origin>/fonts/<file>`, every relative `src` resolves against the
// `<base href>` the frame was woven with, and the `<base>` tag is what makes
// that resolution happen. Each becomes a data url out of a file the server
// already holds; the base tag is removed; anything that cannot be resolved is
// left as it was and NAMED in the answer, because a link that silently shows a
// stranger a broken picture is worse than one that says so.

import type { PageId, Pages, Share } from "../../contracts/types.ts";

/** The document as text plus the resources it could not fold in. */
export interface Standalone {
  html: string;
  left: string[];
}

/** What the rewrite reads. Both answer null for a file that is not there. */
export interface Sources {
  /** The server's own origin as the box saw it, `http://localhost:4400`. */
  origin: string;
  /** One shipped font, by file name. */
  font(name: string): Promise<Uint8Array | null>;
  /** One file out of the vault's `assets/`, by the relative path the markup wrote. */
  asset(rel: string): Promise<Uint8Array | null>;
}

const TYPES: Record<string, string> = {
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
};

const typeOf = (name: string): string => {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
};

const dataUrl = (name: string, bytes: Uint8Array): string =>
  `data:${typeOf(name)};base64,${Buffer.from(bytes).toString("base64")}`;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Is this something a relative resolution would have sent to the base? A
 *  scheme, a root-relative path, a fragment and a data url all resolve on
 *  their own and are left alone. */
const relative = (src: string): boolean =>
  src !== "" && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

/**
 * Make a captured document stand alone.
 *
 * Runs in three passes over the text — fonts, then the base and every
 * relative `src`, then nothing else — because the capture is markup the
 * runtime built and an HTML parser would re-serialise it differently from
 * how the browser will read the original. Text in, text out.
 */
export async function standalone(html: string, from: Sources): Promise<Standalone> {
  const left: string[] = [];
  let out = html;

  // 1. FONTS. `faceCss` wrote them absolute — `url(http://host/fonts/x.woff2)`
  //    — so the match is on the origin the box was woven with.
  const fonts = new RegExp(`url\\((["']?)${escapeRe(from.origin)}/fonts/([^"')\\s]+)\\1\\)`, "g");
  const fontJobs = new Map<string, Promise<Uint8Array | null>>();
  for (const m of out.matchAll(fonts)) {
    const name = m[2] ?? "";
    if (name !== "" && !fontJobs.has(name)) fontJobs.set(name, from.font(name));
  }
  const fontData = new Map<string, Uint8Array | null>();
  for (const [name, job] of fontJobs) fontData.set(name, await job);
  out = out.replace(fonts, (whole, _q, name: string) => {
    const bytes = fontData.get(name);
    if (!bytes) { left.push(`fonts/${name}`); return whole; }
    return `url("${dataUrl(name, bytes)}")`;
  });

  // 2. THE BASE, AND EVERYTHING THAT LEANED ON IT. The tag is taken out — a
  //    standalone file resolves against wherever it is opened, which is not
  //    the vault — and every relative `src` that would have gone to the vault's
  //    assets folder is folded in. Absolute `/v/<enc>/asset/<rel>` forms, which
  //    a plugin can write, are folded the same way.
  const base = out.match(/<base\s[^>]*href=(["'])([^"']*)\1[^>]*>/i);
  out = out.replace(/<base\s[^>]*>\s*/gi, "");
  const assetPrefix = base && base[2] !== undefined ? base[2].replace(/\/$/, "") : null;

  const srcs = /(\s(?:src|href)=)(["'])([^"']*)\2/gi;
  const wanted = new Map<string, Promise<Uint8Array | null>>();
  /** The vault-relative path a `src` names, or null when it is not one. */
  const relOf = (src: string): string | null => {
    if (relative(src)) return decodeURIComponent(src);
    if (assetPrefix && src.startsWith(assetPrefix + "/")) return decodeURIComponent(src.slice(assetPrefix.length + 1));
    return null;
  };
  for (const m of out.matchAll(srcs)) {
    const rel = relOf(m[3] ?? "");
    if (rel !== null && !wanted.has(rel)) wanted.set(rel, from.asset(rel));
  }
  const assetData = new Map<string, Uint8Array | null>();
  for (const [rel, job] of wanted) assetData.set(rel, await job);
  out = out.replace(srcs, (whole, attr: string, q: string, src: string) => {
    const rel = relOf(src);
    if (rel === null) return whole;
    // Only a `src` is a resource; an `href` that is relative is a link into
    // the vault, which the file cannot follow and which is out of scope.
    if (!/src=$/i.test(attr)) return whole;
    const bytes = assetData.get(rel);
    if (!bytes) { left.push(`assets/${rel}`); return whole; }
    return `${attr}${q}${dataUrl(rel, bytes)}${q}`;
  });

  return { html: out, left: [...new Set(left)] };
}

/* ── the module ─────────────────────────────────────────────────────────── */

export interface Sharer {
  /** Capture `page` — or take `html` as the capture, when the caller could
   *  read the drawn page itself — and put it somewhere a link reaches. Throws
   *  with a closed code: `not_found` for a page that is not there,
   *  `unsupported` when the bucket is not configured or this build cannot
   *  capture, `internal` when the capture or the upload failed. */
  share(page: PageId, html?: string): Promise<Share>;
}

export interface ShareDeps {
  pages: Pages;
  /** Draw the page in a browser the server owns and hand back its document,
   *  or null when this build has no browser to draw it in. */
  capture: ((page: PageId) => Promise<string>) | null;
  /** What the rewrite reads from. `origin` is read late because the port is
   *  the operating system's answer and is not known when this is built. */
  sources(): Sources;
  /** Put one file in the bucket under `key`; answer the link. Null means the
   *  bucket is not configured, and the sentence says which variable is missing. */
  upload: { missing(): string | null; put(key: string, html: string): Promise<string> };
}

const bad = (code: string, message: string): Error => Object.assign(new Error(message), { code });

export function makeSharer(deps: ShareDeps): Sharer {
  return {
    async share(page, html) {
      // The cheap refusals first, before a browser is launched for nothing.
      const missing = deps.upload.missing();
      if (missing !== null) throw bad("unsupported", `sharing is not set up on this server: ${missing} is not set`);
      const held = await deps.pages.read(page);
      if (held === null) throw bad("not_found", "no such page");

      let drawn: string;
      if (typeof html === "string" && html.trim() !== "") {
        drawn = html;
      } else if (deps.capture !== null) {
        drawn = await deps.capture(page);
      } else {
        throw bad("unsupported", "this build cannot capture a page on its own; the window has to hand one over");
      }
      const made = await standalone(drawn, deps.sources());
      const key = `${crypto.randomUUID()}.html`;
      const url = await deps.upload.put(key, made.html);
      return { url, key, left: made.left };
    },
  };
}
