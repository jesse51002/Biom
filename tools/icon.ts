// SPDX-License-Identifier: AGPL-3.0-only
// THE ICON, IN THE THREE CONTAINERS THREE OPERATING SYSTEMS INSIST ON.
//
// There is ONE picture — `app/icon.png`, the logo at 512 — and it is the only
// one committed. Linux and the Electron window take that file as it is. The
// packager's bundle does not: macOS wants `.icns` and Windows wants `.ico`, so
// both are GENERATED at build time into `dist/` and neither is committed. A
// generated icon in the repository is a second copy of the logo that goes stale
// the day somebody redraws the first one.
//
// WHY THIS IS WRITTEN OUT RATHER THAN SHELLED OUT. `png2icns`, `icotool` and
// `sips` are three different programs on three different systems, and Pillow is
// a Python dependency this build does not have and must not grow — a build that
// needs an interpreter it did not declare is a build that works on the machine
// it was written on. Both containers are trivial: an ICO is a directory in front
// of a run of whole PNG files, and an ICNS with a PNG payload is the same idea
// with a four-letter type per entry. What is NOT trivial is that an ICO entry
// records its size in ONE BYTE, so 512 cannot be spelled at all and the picture
// has to be made smaller before it can be written down — which is why there is a
// PNG decoder and a box filter in here and not just two container writers.
//
// The decoder handles 8-bit RGBA, non-interlaced, and refuses everything else by
// name rather than by drawing something wrong. That is what `app/icon.png` is,
// and a replacement that is not gets a sentence at build time.

import { deflateSync, inflateSync } from "node:zlib";

/** A decoded picture: straight RGBA, four bytes a pixel, row-major. */
export type Image = { width: number; height: number; rgba: Uint8Array };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* ── png in ─────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The one filter step the format has, run backwards. Each row says how it was
 *  predicted from the row above and the pixel to its left; undoing it is the
 *  whole of what stands between the inflated bytes and the pixels. */
function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  const bpp = 4;
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const type = raw[at++];
    const row = at;
    at += stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[row + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let add = 0;
      if (type === 1) add = a;
      else if (type === 2) add = b;
      else if (type === 3) add = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (type !== 0) throw new Error(`icon.png row ${y} uses filter ${type}, which is not a filter`);
      out[y * stride + x] = (value + add) & 0xff;
    }
  }
  return out;
}

/** Read a PNG. 8-bit RGBA and non-interlaced, which is what the logo is; every
 *  other shape is refused with the reason rather than half-drawn. */
export function decodePng(bytes: Uint8Array): Image {
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) throw new Error("icon.png is not a PNG at all");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = bytes[at + 16];
      const colour = bytes[at + 17];
      const interlace = bytes[at + 20];
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error(
          `icon.png is ${depth}-bit colour type ${colour}${interlace ? " interlaced" : ""}; ` +
            "this build reads 8-bit RGBA, non-interlaced, and nothing else",
        );
      }
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (width === 0 || height === 0) throw new Error("icon.png carries no IHDR");
  const joined = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let write = 0;
  for (const part of idat) {
    joined.set(part, write);
    write += part.length;
  }
  return { width, height, rgba: unfilter(new Uint8Array(inflateSync(joined)), width, height) };
}

/* ── png out ────────────────────────────────────────────────────────────── */

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Write a PNG. Every row filtered 0 — the pictures are small, the containers
 *  care about correctness rather than bytes, and a filter here would be a second
 *  implementation of the one above to get wrong. */
export function encodePng(image: Image): Uint8Array {
  const { width, height, rgba } = image;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const head = new DataView(ihdr.buffer);
  head.setUint32(0, width);
  head.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array(PNG_MAGIC),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A box filter, because every size asked for divides the source and this is a
 *  logo rather than a photograph: averaging the block a pixel came from is what
 *  keeps a thin stroke visible at 16 across, and nearest-neighbour is what makes
 *  it disappear. Premultiplied over alpha, so a transparent edge does not drag
 *  its own colour into the average. */
export function resize(image: Image, size: number): Image {
  const rgba = new Uint8Array(size * size * 4);
  const sx = image.width / size;
  const sy = image.height / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const at = (py * image.width + px) * 4;
          const alpha = image.rgba[at + 3];
          r += image.rgba[at] * alpha;
          g += image.rgba[at + 1] * alpha;
          b += image.rgba[at + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const to = (y * size + x) * 4;
      rgba[to] = a === 0 ? 0 : Math.round(r / a);
      rgba[to + 1] = a === 0 ? 0 : Math.round(g / a);
      rgba[to + 2] = a === 0 ? 0 : Math.round(b / a);
      rgba[to + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, rgba };
}

/* ── the two containers ─────────────────────────────────────────────────── */

/** What a Windows `.ico` holds, smallest first is conventional and largest first
 *  is what every writer actually does; the order is not read by anything. 256 is
 *  the ceiling the format can SPELL — the width and height are one byte each and
 *  0 means 256 — which is the reason the 512 has to be made smaller at all. */
export const ICO_SIZES = [256, 128, 64, 48, 32, 16];

export function ico(images: Image[]): Uint8Array {
  const pngs = images.map(encodePng);
  const head = 6 + images.length * 16;
  const out = new Uint8Array(head + pngs.reduce((n, png) => n + png.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon rather than cursor
  view.setUint16(4, images.length, true);
  let at = head;
  images.forEach((image, i) => {
    if (image.width > 256 || image.height > 256) {
      throw new Error(`an ICO entry is ${image.width} across, and the format's field is one byte`);
    }
    const e = 6 + i * 16;
    out[e] = image.width === 256 ? 0 : image.width;
    out[e + 1] = image.height === 256 ? 0 : image.height;
    out[e + 2] = 0; // palette colours: none, it is direct colour
    out[e + 3] = 0; // reserved
    view.setUint16(e + 4, 1, true); // colour planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, pngs[i].length, true);
    view.setUint32(e + 12, at, true);
    out.set(pngs[i], at);
    at += pngs[i].length;
  });
  return out;
}

/** The macOS types, each a size. `ic09` is the 512 the logo already is, which is
 *  why the ICNS is the container that carries the picture at full size and the
 *  ICO is the one that cannot. */
export const ICNS_TYPES: ReadonlyArray<{ type: string; size: number }> = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "icp6", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
];

export function icns(entries: ReadonlyArray<{ type: string; image: Image }>): Uint8Array {
  const parts = entries.map(({ type, image }) => {
    const png = encodePng(image);
    const part = new Uint8Array(8 + png.length);
    for (let i = 0; i < 4; i++) part[i] = type.charCodeAt(i);
    new DataView(part.buffer).setUint32(4, part.length);
    part.set(png, 8);
    return part;
  });
  const total = 8 + parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  "icns".split("").forEach((c, i) => (out[i] = c.charCodeAt(0)));
  new DataView(out.buffer).setUint32(4, total);
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** One picture in, the two bundle containers out. The caller writes them; this
 *  decides nothing about where they go. */
export function containers(png: Uint8Array): { ico: Uint8Array; icns: Uint8Array } {
  const source = decodePng(png);
  const at = (size: number): Image => (size === source.width && size === source.height ? source : resize(source, size));
  return {
    ico: ico(ICO_SIZES.map(at)),
    icns: icns(ICNS_TYPES.map(({ type, size }) => ({ type, image: at(size) }))),
  };
}
