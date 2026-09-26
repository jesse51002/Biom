// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — READING A DOWNLOADED ARCHIVE'S TABLE OF CONTENTS, and deciding
// whether it is safe to unpack at all, before a byte of it touches a disk.
// Pure: every function here is handed a `read(offset, length)` over the bytes
// and answers entries; `server/workspace/agents.ts` does the writing.
//
// A TAR OR A ZIP IS A LIST OF NAMES SOMEBODY ELSE CHOSE, and each name is a
// path on this machine the moment it is unpacked. So every entry is refused,
// and the whole archive with it, where its name is absolute, carries a drive,
// a backslash, a NUL or a `..`; where two entries are the same path (a later
// one would write through whatever the earlier one made); where an entry
// lies beneath a symbolic link the archive also makes; and where a link
// points outside what was unpacked, absolute or by climbing. Links are made
// LAST by the writer, after every file, so no file is ever written through
// one; and the writer checks each link's real path once all of them exist,
// because a chain of links that each look inside can still leave. Only files,
// directories, symbolic links and hard links to a file already in the archive
// are unpacked — a device, a fifo or a sparse file refuses the archive.
//
// It is sized as well as named: more entries, or more bytes in total, than a
// coding agent's release has any reason to hold refuses it, so an archive that
// expands forever is refused from its table of contents rather than when the
// disk is full.

import { crc32, inflateRawSync } from "node:zlib";

import { safeRelPath } from "./agents-registry.ts";

/** A refusal whose message is a sentence a person can read. */
export class ArchiveError extends Error {
  override name = "ArchiveError";
}

export const MAX_ENTRIES = 200_000;
export const MAX_TOTAL = 4 * 1024 * 1024 * 1024;

/** One entry as the writer needs it. `offset` is where its bytes start —
 *  for a zip, where its LOCAL HEADER starts, which `zipDataOffset` reads. */
export interface Entry {
  path: string;
  type: "file" | "dir" | "symlink" | "hardlink";
  /** Permission bits only: setuid, setgid and sticky are never unpacked. */
  mode: number;
  size: number;
  offset: number;
  /** A link's target, as the archive wrote it. */
  target: string | null;
  /** Zip only: how the bytes are stored, and their checksum. */
  method?: 0 | 8;
  compressed?: number;
  crc?: number;
}

export type Read = (offset: number, length: number) => Uint8Array;

const shortName = (name: string): string => (name.length > 80 ? `${name.slice(0, 77)}...` : name);

/** An entry's name, made safe, or a refusal naming it. `""` is the archive's
 *  own root, which a writer skips. */
function pathOf(name: string): string {
  const p = safeRelPath(name);
  if (p === null) throw new ArchiveError(`the archive names a path outside itself (${JSON.stringify(shortName(name))}), so nothing was unpacked`);
  return p;
}

/* ── tar ──────────────────────────────────────────────────────────────── */

const decoder = new TextDecoder("utf-8", { fatal: false });

function cstr(b: Uint8Array, at: number, len: number): string {
  let end = at;
  while (end < at + len && b[end] !== 0) end++;
  return decoder.decode(b.subarray(at, end));
}

/** A tar number: octal text, or GNU's base-256 when the top bit is set. */
function num(b: Uint8Array, at: number, len: number): number {
  const first = b[at] ?? 0;
  if (first & 0x80) {
    let n = first & 0x7f;
    for (let i = 1; i < len; i++) {
      n = n * 256 + (b[at + i] ?? 0);
      if (n > Number.MAX_SAFE_INTEGER) throw new ArchiveError("the archive holds an entry too large to unpack");
    }
    return n;
  }
  const s = cstr(b, at, len).trim();
  if (s === "") return 0;
  if (!/^[0-7]+$/.test(s)) throw new ArchiveError("the archive is not a tar archive, or it is damaged");
  return parseInt(s, 8);
}

function checksumOk(h: Uint8Array): boolean {
  const want = num(h, 148, 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const byte = i >= 148 && i < 156 ? 0x20 : (h[i] as number);
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return want === unsigned || want === signed;
}

/** A pax extended header's records: `<len> <key>=<value>\n`. */
function paxOf(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < b.length) {
    let sp = at;
    while (sp < b.length && b[sp] !== 0x20) sp++;
    const len = parseInt(decoder.decode(b.subarray(at, sp)), 10);
    if (!Number.isFinite(len) || len <= 0 || at + len > b.length) break;
    const record = decoder.decode(b.subarray(sp + 1, at + len - 1));
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    at += len;
  }
  return out;
}

/** EVERY ENTRY OF A TAR, in order. Throws `ArchiveError` on a damaged
 *  header, a truncated archive, an unsafe name or a kind it will not unpack. */
export function tarEntries(read: Read, size: number): Entry[] {
  const out: Entry[] = [];
  let off = 0;
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = {};
  while (off + 512 <= size) {
    const h = read(off, 512);
    if (h.every((b) => b === 0)) break;
    if (!checksumOk(h)) throw new ArchiveError("the archive is not a tar archive, or it is damaged");
    let length = num(h, 124, 12);
    const flag = String.fromCharCode(h[156] as number);
    const data = off + 512;
    const skip = (n: number): number => data + Math.ceil(n / 512) * 512;
    if (flag === "x" || flag === "g" || flag === "L" || flag === "K") {
      if (length > 1024 * 1024 || skip(length) > size) throw new ArchiveError("the archive is damaged: an extended header runs past its end");
      const body = read(data, length);
      if (flag === "x") pax = paxOf(body);
      else if (flag === "L") longName = cstr(body, 0, body.length);
      else if (flag === "K") longLink = cstr(body, 0, body.length);
      // `g` is a global header: nothing in it names a path worth honouring.
      off = skip(length);
      continue;
    }
    // POSIX ustar's magic is `ustar\0`, and only it has a name prefix: GNU's
    // is `ustar ` and keeps times where the prefix would be.
    const posix = cstr(h, 257, 6) === "ustar";
    const prefix = posix ? cstr(h, 345, 155) : "";
    const plain = cstr(h, 0, 100);
    const name = pax.path ?? longName ?? (prefix !== "" ? `${prefix}/${plain}` : plain);
    const link = pax.linkpath ?? longLink ?? cstr(h, 157, 100);
    if (pax.size !== undefined) {
      const n = Number(pax.size);
      if (!Number.isSafeInteger(n) || n < 0) throw new ArchiveError("the archive is damaged: an entry's size cannot be read");
      length = n;
    }
    pax = {};
    longName = null;
    longLink = null;
    if (skip(length) > size) throw new ArchiveError("the archive ends in the middle of an entry, so nothing was unpacked");
    const mode = num(h, 100, 8) & 0o777;
    let type: Entry["type"];
    if (flag === "0" || flag === "\u0000" || flag === "7") type = name.endsWith("/") ? "dir" : "file";
    else if (flag === "5") type = "dir";
    else if (flag === "2") type = "symlink";
    else if (flag === "1") type = "hardlink";
    else if (flag === "V") {
      off = skip(length);
      continue;
    } else {
      throw new ArchiveError(`the archive holds an entry Biom does not unpack (${JSON.stringify(shortName(name))}), so nothing was unpacked`);
    }
    const path = pathOf(name);
    if (path === "" && type === "dir") {
      off = skip(length);
      continue;
    }
    if (path === "") throw new ArchiveError("the archive holds an entry with no name, so nothing was unpacked");
    out.push({
      path,
      type,
      mode,
      size: type === "file" ? length : 0,
      offset: data,
      target: type === "symlink" || type === "hardlink" ? link : null,
    });
    if (out.length > MAX_ENTRIES) throw new ArchiveError("the archive holds more entries than an agent's release would, so nothing was unpacked");
    off = skip(type === "file" ? length : 0);
  }
  return out;
}

/* ── zip ──────────────────────────────────────────────────────────────── */

const u16 = (b: Uint8Array, at: number): number => (b[at] as number) | ((b[at + 1] as number) << 8);
const u32 = (b: Uint8Array, at: number): number => (u16(b, at) + u16(b, at + 2) * 0x10000);
const u64 = (b: Uint8Array, at: number): number => {
  const n = u32(b, at) + u32(b, at + 4) * 0x1_0000_0000;
  if (!Number.isSafeInteger(n)) throw new ArchiveError("the archive holds an entry too large to unpack");
  return n;
};

const damaged = (): ArchiveError => new ArchiveError("the archive is not a zip archive, or it is damaged");

/** EVERY ENTRY OF A ZIP, from its central directory, a link's target read
 *  from its bytes as a zip keeps it. Zip64 is read; an encrypted entry, or
 *  one stored in any way but plain or deflated, refuses the archive. */
export function zipEntries(read: Read, size: number): Entry[] {
  if (size < 22) throw damaged();
  const tailLen = Math.min(size, 22 + 65535);
  const tail = read(size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw damaged();
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw damaged();
    const at = u64(tail, loc + 8);
    if (at + 56 > size) throw damaged();
    const rec = read(at, 56);
    if (u32(rec, 0) !== 0x06064b50) throw damaged();
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }
  if (count > MAX_ENTRIES) throw new ArchiveError("the archive holds more entries than an agent's release would, so nothing was unpacked");
  if (cdOffset + cdSize > size) throw damaged();
  const cd = read(cdOffset, cdSize);
  const out: Entry[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > cd.length || u32(cd, at) !== 0x02014b50) throw damaged();
    const madeBy = u16(cd, at + 4) >> 8;
    const flags = u16(cd, at + 8);
    const method = u16(cd, at + 10);
    const crc = u32(cd, at + 16) >>> 0;
    let compressed = u32(cd, at + 20);
    let length = u32(cd, at + 24);
    const nameLen = u16(cd, at + 28);
    const extraLen = u16(cd, at + 30);
    const commentLen = u16(cd, at + 32);
    const external = u32(cd, at + 38);
    let local = u32(cd, at + 42);
    const end = at + 46 + nameLen + extraLen + commentLen;
    if (end > cd.length) throw damaged();
    const name = decoder.decode(cd.subarray(at + 46, at + 46 + nameLen));
    // Zip64's extra field holds, in order, only the values that overflowed.
    let x = at + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(cd, x);
      const len = u16(cd, x + 2);
      if (x + 4 + len > xEnd) break;
      if (id === 0x0001) {
        let p = x + 4;
        const take = (): number => {
          if (p + 8 > x + 4 + len) throw damaged();
          const v = u64(cd, p);
          p += 8;
          return v;
        };
        if (length === 0xffffffff) length = take();
        if (compressed === 0xffffffff) compressed = take();
        if (local === 0xffffffff) local = take();
      }
      x += 4 + len;
    }
    at = end;
    if (flags & 0x1) throw new ArchiveError("the archive is encrypted, so nothing was unpacked");
    const unix = madeBy === 3 ? (external >>> 16) & 0xffff : 0;
    const kind = unix & 0o170000;
    let type: Entry["type"];
    if (name.endsWith("/") || kind === 0o040000) type = "dir";
    else if (kind === 0o120000) type = "symlink";
    else if (kind === 0 || kind === 0o100000) type = "file";
    else throw new ArchiveError(`the archive holds an entry Biom does not unpack (${JSON.stringify(shortName(name))}), so nothing was unpacked`);
    if (type !== "dir" && method !== 0 && method !== 8) {
      throw new ArchiveError("the archive is compressed in a way Biom does not unpack, so nothing was unpacked");
    }
    const path = pathOf(name);
    if (path === "") {
      if (type === "dir") continue;
      throw new ArchiveError("the archive holds an entry with no name, so nothing was unpacked");
    }
    if (local + 30 > size || local + compressed > size) throw damaged();
    const entry: Entry = {
      path,
      type,
      mode: unix & 0o777,
      size: type === "dir" ? 0 : length,
      offset: local,
      target: null,
      method: method === 8 ? 8 : 0,
      compressed: type === "dir" ? 0 : compressed,
      crc,
    };
    if (type === "symlink") entry.target = decoder.decode(zipData(read, size, entry, 4096));
    out.push(entry);
    if (out.length > MAX_ENTRIES) throw new ArchiveError("the archive holds more entries than an agent's release would, so nothing was unpacked");
  }
  return out;
}

/** A zip entry's bytes, inflated where they were deflated and held to the
 *  length and checksum the directory gives — never more than `max`. */
export function zipData(read: Read, size: number, entry: Entry, max: number): Uint8Array {
  if (entry.size > max) throw new ArchiveError("the archive holds an entry too large to unpack, so nothing was unpacked");
  const stored = read(zipDataOffset(read, size, entry), entry.compressed ?? 0);
  let bytes: Uint8Array;
  try {
    bytes = entry.method === 8 ? inflateRawSync(stored, { maxOutputLength: Math.max(1, entry.size) }) : stored;
  } catch {
    throw new ArchiveError("the archive is damaged: an entry will not inflate, so nothing was unpacked");
  }
  if (bytes.length !== entry.size || crc32(bytes) >>> 0 !== entry.crc) {
    throw new ArchiveError("the archive is damaged: an entry does not match its checksum, so nothing was unpacked");
  }
  return bytes;
}

/** Where a zip entry's bytes start: past its LOCAL header, whose extra field
 *  may differ in length from the central directory's. */
export function zipDataOffset(read: Read, size: number, entry: Entry): number {
  const h = read(entry.offset, 30);
  if (u32(h, 0) !== 0x04034b50) throw damaged();
  const start = entry.offset + 30 + u16(h, 26) + u16(h, 28);
  if (start + (entry.compressed ?? 0) > size) throw damaged();
  return start;
}

/* ── the whole list, judged ───────────────────────────────────────────── */

/** Where a link's target lands, relative to the root, or null where it
 *  climbs out or is absolute. Lexical: the writer checks the real path too. */
export function linkLands(at: string, target: string): string | null {
  if (target === "" || target.includes("\u0000") || target.includes("\\")) return null;
  if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) return null;
  const parts = at.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

/** THE LIST, JUDGED AS A WHOLE, before anything is written: no path twice —
 *  folded for case, because two names one letter apart are one file on the
 *  disks most people have — nothing beneath a link, every link landing
 *  inside, every hard link naming a file earlier in the archive, and the
 *  total within bounds. Answers the list unchanged, or throws. */
export function judge(entries: Entry[]): Entry[] {
  const folded = new Set<string>();
  const links = new Set<string>();
  const files = new Set<string>();
  let total = 0;
  for (const e of entries) {
    const key = e.path.toLowerCase();
    if (e.type !== "dir" && folded.has(key)) throw new ArchiveError(`the archive names ${JSON.stringify(shortName(e.path))} twice, so nothing was unpacked`);
    if (e.type === "dir" && (links.has(key) || files.has(key))) throw new ArchiveError(`the archive names ${JSON.stringify(shortName(e.path))} twice, so nothing was unpacked`);
    folded.add(key);
    if (e.type === "symlink") {
      if (e.target === null || linkLands(e.path, e.target) === null) {
        throw new ArchiveError(`the archive holds a link that points outside itself (${JSON.stringify(shortName(e.path))}), so nothing was unpacked`);
      }
      links.add(key);
    }
    if (e.type === "hardlink") {
      const to = e.target === null ? null : safeRelPath(e.target);
      if (to === null || to === "" || !files.has(to.toLowerCase())) {
        throw new ArchiveError(`the archive holds a hard link Biom will not follow (${JSON.stringify(shortName(e.path))}), so nothing was unpacked`);
      }
    }
    if (e.type === "file") files.add(key);
    total += e.size;
    if (total > MAX_TOTAL) throw new ArchiveError("the archive unpacks to more than an agent's release would, so nothing was unpacked");
  }
  for (const e of entries) {
    const parts = e.path.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) {
      if (links.has(parts.slice(0, i).join("/"))) {
        throw new ArchiveError(`the archive puts ${JSON.stringify(shortName(e.path))} beneath a link, so nothing was unpacked`);
      }
    }
  }
  return entries;
}
