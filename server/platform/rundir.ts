// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — what assembling a run directory needs of a disk that `Files`
// deliberately cannot do: a symlink, a copy of a tree, a directory made, a
// slice of a file read by byte offset, and every path checked to lie under
// one root. Knows nothing about runs, manifests or pages; `runs.ts` is what
// knows those and is handed this.
//
// `Files` stays what it is — text under one root, refusing every path that
// escapes it — because it is the right surface for a page. A run directory
// is a different thing: it holds links to folders elsewhere in the vault, and
// its logs are bytes the framework serves without reading, from an offset.

import { cpSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

/** The one containment answer this file needs, spelled the way `files.ts`
 *  spells `within` and for the same reason: both sides resolved and compared
 *  as paths, never as strings. */
const under = (root: string, abs: string): boolean => {
  const base = resolve(root);
  const path = resolve(abs);
  return path === base || path.startsWith(base + sep);
};

export interface RunFs {
  /** Absolute. Every other member refuses a path outside it by name. */
  root: string;
  mkdir(abs: string): void;
  /** A symlink at `at` pointing at `target`. `target` is written as given —
   *  absolute, always, here — so a harness that resolves it lands on the real
   *  path. */
  link(target: string, at: string): void;
  /** Copy a file or a whole tree. */
  copy(from: string, to: string): void;
  writeText(abs: string, text: string): void;
  readText(abs: string): string | null;
  exists(abs: string): boolean;
  isDir(abs: string): boolean;
  /** Names in a directory, sorted, or empty where there is none. */
  names(abs: string): string[];
  /** `max` bytes of a file from `from`, and the file's size now. Empty for a
   *  file that is not there. */
  slice(abs: string, from: number, max: number): { bytes: Uint8Array; size: number };
  remove(abs: string): void;
}

export function makeRunFs(root: string): RunFs {
  const base = resolve(root);
  const inside = (abs: string): string => {
    if (!under(base, abs)) throw Object.assign(new Error("that path is not inside the workspace"), { code: "bad_request" });
    return resolve(abs);
  };
  return {
    root: base,
    mkdir(abs) {
      mkdirSync(inside(abs), { recursive: true });
    },
    link(target, at) {
      const to = inside(at);
      mkdirSync(dirname(to), { recursive: true });
      // A directory link on Windows wants to say so; elsewhere the kind is
      // ignored. `junction` needs no privilege where `dir` does.
      const dir = existsSync(target) && statSync(target).isDirectory();
      symlinkSync(target, to, dir && process.platform === "win32" ? "junction" : dir ? "dir" : "file");
    },
    copy(from, to) {
      const dst = inside(to);
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(from, dst, { recursive: true, dereference: false });
    },
    writeText(abs, text) {
      const to = inside(abs);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, text, "utf8");
    },
    readText(abs) {
      const at = inside(abs);
      try {
        return Bun.file(at).size >= 0 && existsSync(at) ? readSlice(at, 0, Number.MAX_SAFE_INTEGER).text : null;
      } catch {
        return null;
      }
    },
    exists(abs) {
      return existsSync(inside(abs));
    },
    isDir(abs) {
      try {
        return lstatSync(inside(abs)).isDirectory();
      } catch {
        return false;
      }
    },
    names(abs) {
      try {
        return readdirSync(inside(abs)).sort();
      } catch {
        return [];
      }
    },
    slice(abs, from, max) {
      const at = inside(abs);
      if (!existsSync(at)) return { bytes: new Uint8Array(0), size: 0 };
      const { bytes, size } = readSlice(at, from, max);
      return { bytes, size };
    },
    remove(abs) {
      rmSync(inside(abs), { recursive: true, force: true });
    },
  };
}

/** Read `max` bytes from `from` with one descriptor, opened and closed here,
 *  so a log being appended to by a child is never held open by this side. */
function readSlice(at: string, from: number, max: number): { bytes: Uint8Array; size: number; text: string } {
  const size = statSync(at).size;
  const start = Math.min(Math.max(0, from), size);
  const want = Math.max(0, Math.min(max, size - start));
  const bytes = new Uint8Array(want);
  if (want > 0) {
    const fd = openSync(at, "r");
    try {
      let got = 0;
      while (got < want) {
        const n = readSync(fd, bytes, got, want - got, start + got);
        if (n <= 0) break;
        got += n;
      }
    } finally {
      closeSync(fd);
    }
  }
  return { bytes, size, text: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
}
