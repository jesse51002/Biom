// SPDX-License-Identifier: AGPL-3.0-only
// Installing an agent from the ACP Registry, with nothing fetched and nothing
// installed for real: the registry is an invented document, every download is
// bytes this file builds — a tar, a gzip, a zip, a bare program — the network
// is a function answering them, and `npm`, `uv` and `bzip2` are a fake runner
// that writes what each would have written. Every agent, package, url and
// checksum here is invented; only Biom's own folder under a temporary
// directory is touched.
//
// What is held: a download whose SHA-256 is not the registry's is refused and
// leaves nothing; each distribution kind installs into Biom's own folder at the
// pinned version, writes the record discovery reads, and is then probed Active;
// a binary the registry lists no checksum for is installed on first use —
// https all the way, its SHA-256 recorded, and a later download of that same
// version with other bytes refused — while a checksum the registry does list
// still decides; npx without
// Node and uvx without uv are said plainly; the registry is read once within
// its lifetime, a stale copy stands in when the network will not answer, and
// nothing at all is a refusal in words. And an archive is judged before a byte
// of it is written: a name that climbs out, an absolute name, a link that
// points out — lexically or by a chain of links — an entry beneath a link, a
// name given twice, a device and a damaged header each refuse it, and nothing
// lands outside.

import { test, expect, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gzipSync } from "node:zlib";

import { makeAgents } from "../server/workspace/agents.ts";
import type { AgentsDeps } from "../server/workspace/agents.ts";
import { ArchiveError, judge, linkLands, tarEntries, zipEntries } from "../server/domain/agents-archive.ts";
import { REGISTRY_URL, archiveKind, parseRegistry, safeRelPath } from "../server/domain/agents-registry.ts";
import type { AcpConnection, AcpExit } from "../server/platform/acp.ts";
import type { AgentInfo, AgentLaunch, ProcessRunner, RegistryAgent } from "../contracts/types.ts";

const scratch = mkdtempSync(join(tmpdir(), "biom-install-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => {
  const at = join(scratch, `h${++n}`);
  mkdirSync(at, { recursive: true });
  return at;
};

/* ── invented archives ───────────────────────────────────────────────── */

const enc = new TextEncoder();
const bytes = (s: string): Uint8Array => enc.encode(s);
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function field(h: Uint8Array, at: number, len: number, value: string): void {
  h.set(enc.encode(value).subarray(0, len), at);
}
function octal(h: Uint8Array, at: number, len: number, value: number): void {
  field(h, at, len, value.toString(8).padStart(len - 1, "0") + "\u0000");
}

interface TarItem {
  name: string;
  type?: string;
  data?: Uint8Array;
  mode?: number;
  link?: string;
}

/** A ustar archive of `items`, each header's checksum right unless `corrupt`. */
function tar(items: TarItem[], corrupt = false): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const it of items) {
    const h = new Uint8Array(512);
    const data = it.data ?? new Uint8Array(0);
    field(h, 0, 100, it.name);
    octal(h, 100, 8, it.mode ?? 0o644);
    octal(h, 108, 8, 0);
    octal(h, 116, 8, 0);
    octal(h, 124, 12, (it.type ?? "0") === "0" ? data.length : 0);
    octal(h, 136, 12, 0);
    h.fill(0x20, 148, 156);
    h[156] = (it.type ?? "0").charCodeAt(0);
    field(h, 157, 100, it.link ?? "");
    field(h, 257, 6, "ustar\u0000");
    field(h, 263, 2, "00");
    let sum = 0;
    for (const b of h) sum += b;
    octal(h, 148, 7, corrupt ? sum + 1 : sum);
    parts.push(h);
    if ((it.type ?? "0") === "0") {
      const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
      padded.set(data);
      parts.push(padded);
    }
  }
  parts.push(new Uint8Array(1024));
  return concat(parts);
}

interface ZipItem {
  name: string;
  data?: Uint8Array;
  deflate?: boolean;
  mode?: number;
  symlink?: boolean;
  badCrc?: boolean;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A zip of `items`, made on "Unix" so modes and links carry. */
function zip(items: ZipItem[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const it of items) {
    const data = it.data ?? new Uint8Array(0);
    const stored = it.deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const crc = it.badCrc ? 0x1234 : Bun.hash.crc32(data) >>> 0;
    const name = enc.encode(it.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, it.deflate ? 8 : 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, it.deflate ? 8 : 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    const kind = it.name.endsWith("/") ? 0o040000 : it.symlink ? 0o120000 : 0o100000;
    cv.setUint32(38, ((kind | (it.mode ?? 0o644)) << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, stored);
    centrals.push(central);
    offset += local.length + stored.length;
  }
  const cd = concat(centrals);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, items.length, true);
  ev.setUint16(10, items.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, cd, end]);
}

const reader = (b: Uint8Array) => (offset: number, length: number): Uint8Array => b.slice(offset, offset + length);

/* ── the archive, judged ──────────────────────────────────────────────── */

test("a tar's table of contents: names made safe, links and modes read, the root skipped", () => {
  const b = tar([
    { name: "./", type: "5" },
    { name: "./bin/", type: "5", mode: 0o755 },
    { name: "./bin/agent", data: bytes("#!/bin/sh\n"), mode: 0o4755 },
    { name: "bin/alias", type: "2", link: "agent" },
    { name: "bin/copy", type: "1", link: "./bin/agent" },
  ]);
  const list = judge(tarEntries(reader(b), b.length));
  expect(list.map((e) => [e.path, e.type])).toEqual([["bin", "dir"], ["bin/agent", "file"], ["bin/alias", "symlink"], ["bin/copy", "hardlink"]]);
  // setuid is never unpacked.
  expect(list[1]?.mode).toBe(0o755);
});

test("an archive that climbs out, names an absolute path, or is damaged is refused whole", () => {
  const refuse = (b: Uint8Array) => expect(() => judge(tarEntries(reader(b), b.length))).toThrow(ArchiveError);
  refuse(tar([{ name: "fine", data: bytes("x") }, { name: "../../evil", data: bytes("x") }]));
  refuse(tar([{ name: "/etc/evil", data: bytes("x") }]));
  refuse(tar([{ name: "a\\..\\..\\evil", data: bytes("x") }]));
  refuse(tar([{ name: "C:/evil", data: bytes("x") }]));
  refuse(tar([{ name: "fine", data: bytes("x") }], true));
  refuse(tar([{ name: "dev", type: "3" }]));
  refuse(tar([{ name: "fifo", type: "6" }]));
  // Links that land outside, and names given twice.
  refuse(tar([{ name: "out", type: "2", link: "../outside" }]));
  refuse(tar([{ name: "abs", type: "2", link: "/etc/passwd" }]));
  refuse(tar([{ name: "a", data: bytes("1") }, { name: "a", data: bytes("2") }]));
  refuse(tar([{ name: "Readme", data: bytes("1") }, { name: "README", data: bytes("2") }]));
  // An entry beneath a link the archive makes, even under another case.
  refuse(tar([{ name: "sub/", type: "5" }, { name: "l", type: "2", link: "sub" }, { name: "l/x", data: bytes("x") }]));
  refuse(tar([{ name: "L", type: "2", link: "sub" }, { name: "l/x", data: bytes("x") }]));
  // A hard link to nothing earlier in the archive.
  refuse(tar([{ name: "h", type: "1", link: "missing" }]));
  // Truncated.
  const whole = tar([{ name: "f", data: new Uint8Array(2000) }]);
  refuse(whole.subarray(0, 1024));
});

test("the pure path rules", () => {
  expect(safeRelPath("./a//b/./c")).toBe("a/b/c");
  expect(safeRelPath("./")).toBe("");
  expect(safeRelPath("a/../b")).toBeNull();
  expect(safeRelPath("/a")).toBeNull();
  expect(safeRelPath("a\u0000b")).toBeNull();
  expect(linkLands("bin/x", "../lib/y")).toBe("lib/y");
  expect(linkLands("x", "../y")).toBeNull();
  expect(linkLands("a/b", "/y")).toBeNull();
  expect(archiveKind("https://h/x/agent-1.0-linux.tar.gz")).toBe("tar.gz");
  expect(archiveKind("https://h/x/coco-1.0.73%2B1.e6-linux-amd64.tar.gz")).toBe("tar.gz");
  expect(archiveKind("https://h/x/a.tar.bz2")).toBe("tar.bz2");
  expect(archiveKind("https://h/x/a.zip")).toBe("zip");
  expect(archiveKind("https://h/x/sigit-linux-amd64")).toBe("raw");
  expect(archiveKind("https://h/x/tool.exe")).toBe("raw");
  expect(archiveKind("https://h/x/tool.tar.xz")).toBeNull();
  expect(archiveKind("https://h/x/tool.dmg")).toBeNull();
});

test("a zip's table of contents: modes, links and folders; a climbing name, a bad checksum and encryption refuse it", () => {
  const b = zip([{ name: "dir/" }, { name: "dir/run", data: bytes("#!/bin/sh\n"), mode: 0o755, deflate: true }, { name: "dir/l", data: bytes("run"), symlink: true }]);
  const list = zipEntries(reader(b), b.length);
  expect(list.map((e) => [e.path, e.type, e.mode])).toEqual([["dir", "dir", 0o644], ["dir/run", "file", 0o755], ["dir/l", "symlink", 0o644]]);
  const bad = zip([{ name: "../evil", data: bytes("x") }]);
  expect(() => zipEntries(reader(bad), bad.length)).toThrow(ArchiveError);
  const junk = bytes("PK not really a zip at all, just words long enough");
  expect(() => zipEntries(reader(junk), junk.length)).toThrow(ArchiveError);
  const locked = zip([{ name: "x", data: bytes("x") }]);
  // Set the encrypted flag in the central directory entry.
  const cdAt = locked.length - 22 - (46 + 1);
  locked[cdAt + 8] = 1;
  expect(() => zipEntries(reader(locked), locked.length)).toThrow("encrypted");
});

/* ── the registry ─────────────────────────────────────────────────────── */

const PLATFORM = "linux-x86_64";

function registryDoc(extra: Record<string, unknown>[] = []): Record<string, unknown> {
  return { version: "1.0.0", agents: extra, extensions: [] };
}

test("the registry is read as untrusted: a bad id, a url spec, an unpinned spec and a climbing cmd are dropped, and a plain-http download is kept only to be refused", () => {
  const entries = parseRegistry(registryDoc([
    { id: "good", name: "Good", version: "1.0.0", description: "Invented", distribution: { npx: { package: "good-agent@1.0.0" } } },
    { id: "../bad", name: "Bad", version: "1.0.0", distribution: { npx: { package: "x@1.0.0" } } },
    { id: "urlspec", name: "U", version: "1.0.0", distribution: { npx: { package: "git+https://example.invalid/x.git" } } },
    { id: "flagspec", name: "F", version: "1.0.0", distribution: { npx: { package: "--prefix=/@1.0.0" } } },
    { id: "unpinned", name: "P", version: "1.0.0", distribution: { npx: { package: "some-agent@latest" }, uvx: { package: "some-agent" } } },
    { id: "climb", name: "C", version: "1.0.0", distribution: { binary: { [PLATFORM]: { archive: "https://example.invalid/a.tar.gz", cmd: "../../bin/sh", sha256: "a".repeat(64) } } } },
    { id: "plain", name: "H", version: "1.0.0", distribution: { binary: { [PLATFORM]: { archive: "http://example.invalid/a.tar.gz", cmd: "./a", sha256: "a".repeat(64) } } } },
    { id: "badversion", name: "V", version: "../1", distribution: { npx: { package: "v@1.0.0" } } },
  ]));
  const byId = Object.fromEntries(entries.map((e) => [e.key, e]));
  expect(Object.keys(byId).sort()).toEqual(["climb", "flagspec", "good", "plain", "unpinned", "urlspec"]);
  expect(byId.good?.npx?.spec).toBe("good-agent@1.0.0");
  for (const k of ["urlspec", "flagspec", "unpinned"]) {
    expect(byId[k]?.npx).toBeNull();
    expect(byId[k]?.uvx).toBeNull();
  }
  expect(byId.climb?.binary).toEqual({});
  expect(byId.plain?.binary[PLATFORM]?.archive).toBe("http://example.invalid/a.tar.gz");
  expect(() => parseRegistry({ nope: true })).toThrow();
});

/* ── installing ───────────────────────────────────────────────────────── */

const SECRET = "sk-invented-install";

interface Rig {
  deps: AgentsDeps;
  ran: { cmd: string[]; cwd: string; env: Record<string, string>; stdout: string }[];
  fetched: string[];
  probes: AgentLaunch[];
  home: string;
}

function rig(opts: {
  entries: Record<string, unknown>[];
  files?: Record<string, Uint8Array>;
  bins?: Record<string, string>;
  /** What the fake `npm`, `uv` or `bzip2` does, given its command. */
  tool?: (spec: { cmd: string[]; cwd: string; env: Record<string, string>; stdout: string }) => number;
  registryDown?: boolean;
  now?: () => number;
  home?: string;
  /** Answers by url ahead of `files` — a redirect, say. */
  routes?: Record<string, () => Response>;
}): Rig {
  const ran: Rig["ran"] = [];
  const fetched: string[] = [];
  const probes: AgentLaunch[] = [];
  const home = opts.home ?? fresh();
  const doc = registryDoc(opts.entries);
  const processes: ProcessRunner = {
    start(spec) {
      ran.push({ cmd: spec.cmd, cwd: spec.cwd, env: spec.env, stdout: spec.stdout });
      const exit = opts.tool ? opts.tool(spec) : 1;
      return { pid: 5000 + ran.length, pgid: 5000 + ran.length, born: null, done: Promise.resolve({ exit, signal: null }) };
    },
    async end() {},
    killNow() {},
    alive: () => false,
  };
  const connect = (launch: AgentLaunch): AcpConnection => {
    probes.push(launch);
    let finish!: (e: AcpExit) => void;
    const closed = new Promise<AcpExit>((r) => {
      finish = r;
    });
    return {
      async request(method) {
        if (method === "initialize") return { protocolVersion: 1, agentInfo: { name: "x", version: "9.9.9" } };
        if (method === "session/new") return { sessionId: "s" };
        throw Object.assign(new Error("no"), { code: -32601 });
      },
      notify() {},
      handle() {},
      onNotification: () => () => {},
      stderr: () => "",
      async close() {
        finish({ code: 0, signal: null });
        return closed;
      },
      kill() {
        finish({ code: null, signal: "SIGKILL" });
      },
      closed,
    };
  };
  const deps: AgentsDeps = {
    connect,
    env: async () => ({ PATH: "/invented/bin", SECRET_KEY: SECRET }),
    which: async (c) => (opts.bins ?? { node: "/invented/bin/node", npm: "/invented/bin/npm", uv: "/invented/bin/uv", bzip2: "/invented/bin/bzip2" })[c] ?? null,
    fetch: (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      fetched.push(url);
      if (url === REGISTRY_URL) {
        if (opts.registryDown) throw new TypeError("offline");
        return new Response(JSON.stringify(doc));
      }
      const route = opts.routes?.[url];
      if (route !== undefined) return route();
      const body = opts.files?.[url];
      if (body === undefined) return new Response("missing", { status: 404 });
      return new Response(body);
    }) as typeof fetch,
    home,
    cwd: "/invented/vault",
    now: opts.now ?? (() => Date.now()),
    processes,
    platform: "linux",
    arch: "x64",
    timing: { commands: 10, initialize: 300, session: 300 },
  };
  return { deps, ran, fetched, probes, home };
}

async function installed(r: Rig, key: string): Promise<AgentInfo> {
  const agents = makeAgents(r.deps);
  const answered = agents.install(key);
  expect(answered.reason).toBe("installing");
  expect(answered.source).toBe("installed");
  await agents.settled();
  const a = agents.list().find((x) => x.key === key);
  if (a === undefined) throw new Error(`${key} is not listed`);
  return a;
}

const binaryEntry = (id: string, url: string, sum: string | null, cmd = "./agent"): Record<string, unknown> => ({
  id,
  name: `Invented ${id}`,
  version: "2.0.0",
  description: "An invented agent",
  distribution: { binary: { [PLATFORM]: { archive: url, cmd, args: ["acp"], ...(sum === null ? {} : { sha256: sum }) } } },
});

const program = bytes("#!/bin/sh\necho invented\n");

test("a download whose SHA-256 is not the registry's is refused, and nothing is left", async () => {
  const body = gzipSync(tar([{ name: "agent", data: program, mode: 0o755 }]));
  const r = rig({ entries: [binaryEntry("liar", "https://dl.invented.example/liar.tar.gz", "0".repeat(64))], files: { "https://dl.invented.example/liar.tar.gz": body } });
  const a = await installed(r, "liar");
  expect(a.state).toBe("inactive");
  expect(a.reason).toBe("failed");
  expect(a.message).toContain("did not match the checksum");
  expect(existsSync(join(r.home, "liar", "2.0.0"))).toBe(false);
  expect(existsSync(join(r.home, "liar", "installed.json"))).toBe(false);
  expect(r.probes).toEqual([]);
});

test("a binary the registry lists no checksum for installs on first use, and its SHA-256 is recorded and logged", async () => {
  const body = gzipSync(tar([{ name: "agent", data: program, mode: 0o755 }]));
  const url = "https://dl.invented.example/tofu.tar.gz";
  const r = rig({ entries: [binaryEntry("tofu", url, null)], files: { [url]: body } });
  const a = await installed(r, "tofu");
  expect(a.state).toBe("active");
  // Nothing alarming is said on the screen: the log is the record.
  expect(a.message).toBeNull();
  expect(a.line).toBe("An invented agent");
  const record = JSON.parse(readFileSync(join(r.home, "tofu", "installed.json"), "utf8"));
  expect(record.downloads).toEqual({ "2.0.0": sha(body) });
  expect(readFileSync(join(r.home, "tofu", "install.log"), "utf8")).toContain(
    `2.0.0: the registry lists no checksum for this download; recorded ${sha(body)} on first install`,
  );
  expect(statSync(join(r.home, "tofu", "installed.json")).mode & 0o077).toBe(0);
  // A later server finds it, called what the registry it kept calls it — no network asked.
  const later = rig({ entries: [], home: r.home, registryDown: true });
  const agents = makeAgents(later.deps);
  agents.list();
  await agents.settled();
  const found = agents.list().find((x) => x.key === "tofu");
  expect(found?.name).toBe("Invented tofu");
  expect(found?.line).toBe("An invented agent");
  expect(found?.state).toBe("active");
  expect(later.fetched).toEqual([]);
});

/** A later server, whose registry has changed: the copy the last one kept is
 *  within its lifetime, so it is dropped to make this one read the new one. */
const laterRegistry = (home: string): void => rmSync(join(home, "registry.json"), { force: true });

test("a same-version reinstall whose bytes differ from the first is refused and the installed one stands; a new version is a new first use", async () => {
  const home = fresh();
  const url = "https://dl.invented.example/pinned.tar.gz";
  const first = gzipSync(tar([{ name: "agent", data: program, mode: 0o755 }]));
  const changed = gzipSync(tar([{ name: "agent", data: bytes("#!/bin/sh\necho changed\n"), mode: 0o755 }]));
  await installed(rig({ entries: [binaryEntry("pinned", url, null)], files: { [url]: first }, home }), "pinned");

  // The same bytes again: fine, and said so in the log.
  const again = await installed(rig({ entries: [binaryEntry("pinned", url, null)], files: { [url]: first }, home }), "pinned");
  expect(again.state).toBe("active");
  expect(readFileSync(join(home, "pinned", "install.log"), "utf8")).toContain(`it matches ${sha(first)}, recorded on first install`);

  // Other bytes under the same version: refused, and what was installed is untouched.
  laterRegistry(home);
  const swapped = rig({ entries: [binaryEntry("pinned", url, null)], files: { [url]: changed }, home });
  const b = await installed(swapped, "pinned");
  expect(b.reason).toBe("failed");
  expect(b.message).toBe("The download for Invented pinned 2.0.0 is not the file Biom installed for that version before, so nothing was installed.");
  expect(readFileSync(join(home, "pinned", "2.0.0", "agent"), "utf8")).toBe("#!/bin/sh\necho invented\n");
  expect(swapped.probes).toEqual([]);

  // A new version is a new first use.
  laterRegistry(home);
  const next = { ...binaryEntry("pinned", url, null), version: "2.1.0" };
  const c = await installed(rig({ entries: [next], files: { [url]: changed }, home }), "pinned");
  expect(c.state).toBe("active");
  expect(JSON.parse(readFileSync(join(home, "pinned", "installed.json"), "utf8")).downloads).toEqual({ "2.0.0": sha(first), "2.1.0": sha(changed) });
});

test("a checksum the registry lists still decides: a mismatch is refused whatever was recorded, and a match wins over the record", async () => {
  const home = fresh();
  const url = "https://dl.invented.example/listed.tar.gz";
  const first = gzipSync(tar([{ name: "agent", data: program, mode: 0o755 }]));
  const changed = gzipSync(tar([{ name: "agent", data: bytes("#!/bin/sh\necho changed\n"), mode: 0o755 }]));
  await installed(rig({ entries: [binaryEntry("listed", url, null)], files: { [url]: first }, home }), "listed");
  // The registry now lists a checksum, and the download matches the RECORD but not it.
  laterRegistry(home);
  const refused = await installed(rig({ entries: [binaryEntry("listed", url, sha(changed))], files: { [url]: first }, home }), "listed");
  expect(refused.message).toContain("did not match the checksum the ACP Registry lists");
  // It matches the registry and not the record: the registry wins, and the record follows it.
  laterRegistry(home);
  const taken = await installed(rig({ entries: [binaryEntry("listed", url, sha(changed))], files: { [url]: changed }, home }), "listed");
  expect(taken.state).toBe("active");
  expect(JSON.parse(readFileSync(join(home, "listed", "installed.json"), "utf8")).downloads).toEqual({ "2.0.0": sha(changed) });
});

test("a download is https all the way: an http url, or a redirect to http, is refused before it is fetched; an https redirect is followed", async () => {
  const body = gzipSync(tar([{ name: "agent", data: program, mode: 0o755 }]));
  const plain = rig({ entries: [binaryEntry("plainhttp", "http://dl.invented.example/p.tar.gz", null)], files: { "http://dl.invented.example/p.tar.gz": body } });
  const a = await installed(plain, "plainhttp");
  expect(a.reason).toBe("failed");
  expect(a.message).toBe("Its download is not https, so Biom will not fetch it.");
  expect(plain.fetched.some((u) => u.startsWith("http:"))).toBe(false);

  const url = "https://dl.invented.example/r.tar.gz";
  const downgraded = rig({
    entries: [binaryEntry("downgrade", url, null)],
    routes: { [url]: () => new Response(null, { status: 302, headers: { location: "http://mirror.invented.example/r.tar.gz" } }) },
    files: { "http://mirror.invented.example/r.tar.gz": body },
  });
  const b = await installed(downgraded, "downgrade");
  expect(b.reason).toBe("failed");
  expect(b.message).toBe("The download left https, so nothing was installed.");
  expect(downgraded.fetched).not.toContain("http://mirror.invented.example/r.tar.gz");
  expect(existsSync(join(downgraded.home, "downgrade", "installed.json"))).toBe(false);

  // Even with a registry checksum, the chain must stay https.
  const listed = rig({
    entries: [binaryEntry("downgrade2", url, sha(body))],
    routes: { [url]: () => new Response(null, { status: 301, headers: { location: "http://mirror.invented.example/r.tar.gz" } }) },
    files: { "http://mirror.invented.example/r.tar.gz": body },
  });
  expect((await installed(listed, "downgrade2")).message).toBe("The download left https, so nothing was installed.");

  // https to https, the second hop relative, is followed.
  const hopped = rig({
    entries: [binaryEntry("hopped", url, null)],
    routes: {
      [url]: () => new Response(null, { status: 302, headers: { location: "https://objects.invented.example/store/r" } }),
      "https://objects.invented.example/store/r": () => new Response(null, { status: 307, headers: { location: "/store/r.tar.gz?sig=invented" } }),
    },
    files: { "https://objects.invented.example/store/r.tar.gz?sig=invented": body },
  });
  const c = await installed(hopped, "hopped");
  expect(c.state).toBe("active");
  expect(hopped.fetched.filter((u) => u !== REGISTRY_URL)).toEqual([url, "https://objects.invented.example/store/r", "https://objects.invented.example/store/r.tar.gz?sig=invented"]);

  // A redirect that never ends is refused.
  const loop = rig({ entries: [binaryEntry("loop", url, null)], routes: { [url]: () => new Response(null, { status: 302, headers: { location: url } }) } });
  expect((await installed(loop, "loop")).message).toBe("The download was redirected too many times, so nothing was installed.");
});

test("a .tar.gz installs into Biom's own folder at the pinned version, and is probed Active from there", async () => {
  const body = gzipSync(tar([
    { name: "pkg/", type: "5" },
    { name: "pkg/bin/", type: "5" },
    { name: "pkg/bin/agent", data: program, mode: 0o755 },
    { name: "pkg/lib/", type: "5" },
    { name: "pkg/lib/data.txt", data: bytes("invented") },
    { name: "pkg/agent", type: "2", link: "bin/agent" },
  ]));
  const url = "https://dl.invented.example/good.tar.gz";
  const r = rig({ entries: [binaryEntry("good", url, sha(body), "./pkg/agent")], files: { [url]: body } });
  const a = await installed(r, "good");
  expect(a.state).toBe("active");
  expect(a.source).toBe("installed");
  expect(a.version).toBe("9.9.9");
  const dir = join(r.home, "good", "2.0.0");
  // The agent's folder is private: its install and Gateway logs are the person's.
  expect(statSync(join(r.home, "good")).mode & 0o777).toBe(0o700);
  expect(readFileSync(join(dir, "pkg", "lib", "data.txt"), "utf8")).toBe("invented");
  expect(readlinkSync(join(dir, "pkg", "agent"))).toBe("bin/agent");
  expect(statSync(join(dir, "pkg", "bin", "agent")).mode & 0o111).not.toBe(0);
  expect(JSON.parse(readFileSync(join(r.home, "good", "installed.json"), "utf8"))).toEqual({
    key: "good", version: "2.0.0", via: "binary", file: "2.0.0/pkg/agent", node: false, args: ["acp"], env: {}, downloads: { "2.0.0": sha(body) },
  });
  expect(r.probes[0]?.command).toBe(join(dir, "pkg", "agent"));
  expect(r.probes[0]?.args).toEqual(["acp"]);
  // Nothing was staged anywhere but Biom's folder, and nothing is left staged.
  expect(readdirNames(join(r.home, "good")).filter((x) => x.startsWith(".part-"))).toEqual([]);
});

function readdirNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

test("a .zip installs, deflated entries and links included", async () => {
  const body = zip([{ name: "bin/" }, { name: "bin/agent", data: program, mode: 0o755, deflate: true }, { name: "agent", data: bytes("bin/agent"), symlink: true }]);
  const url = "https://dl.invented.example/z.zip";
  const r = rig({ entries: [binaryEntry("zipped", url, sha(body))], files: { [url]: body } });
  const a = await installed(r, "zipped");
  expect(a.state).toBe("active");
  expect(readFileSync(join(r.home, "zipped", "2.0.0", "bin", "agent"), "utf8")).toBe("#!/bin/sh\necho invented\n");
  expect(lstatSync(join(r.home, "zipped", "2.0.0", "agent")).isSymbolicLink()).toBe(true);
});

test("a .tar.bz2 is decompressed by bzip2, and a raw download is the program itself", async () => {
  const inner = tar([{ name: "agent", data: program, mode: 0o755 }]);
  const bzUrl = "https://dl.invented.example/b.tar.bz2";
  const bzBody = bytes("an invented bzip2 stream");
  const r = rig({
    entries: [binaryEntry("bz", bzUrl, sha(bzBody))],
    files: { [bzUrl]: bzBody },
    tool: (spec) => {
      // The fake `bzip2 -dc`: what the stream decompresses to, on stdout.
      if (spec.cmd[0]?.endsWith("bzip2")) {
        writeFileSync(spec.stdout, inner);
        return 0;
      }
      return 1;
    },
  });
  const a = await installed(r, "bz");
  expect(a.state).toBe("active");
  expect(r.ran[0]?.cmd).toEqual(["/invented/bin/bzip2", "-dc", expect.stringContaining("download")]);
  expect(readFileSync(join(r.home, "bz", "2.0.0", "agent"), "utf8")).toContain("invented");

  const rawUrl = "https://dl.invented.example/raw-agent-linux-amd64";
  const raw = rig({ entries: [binaryEntry("raw", rawUrl, sha(program), "./raw-agent-linux-amd64")], files: { [rawUrl]: program } });
  const b = await installed(raw, "raw");
  expect(b.state).toBe("active");
  expect(raw.probes[0]?.command).toBe(join(raw.home, "raw", "2.0.0", "raw-agent-linux-amd64"));
  expect(statSync(raw.probes[0]?.command as string).mode & 0o111).not.toBe(0);

  const noBzip = rig({ entries: [binaryEntry("bz2", bzUrl, sha(bzBody))], files: { [bzUrl]: bzBody }, bins: { node: "/n", npm: "/m" } });
  const c = await installed(noBzip, "bz2");
  expect(c.reason).toBe("failed");
  expect(c.message).toContain("bzip2");
});

test("an archive that would write outside, or link outside by a chain, is refused and nothing lands outside", async () => {
  const cases: [string, Uint8Array][] = [
    ["climb", gzipSync(tar([{ name: "agent", data: program }, { name: "../../escaped", data: bytes("x") }]))],
    ["linkout", gzipSync(tar([{ name: "agent", data: program }, { name: "out", type: "2", link: "../../.." }]))],
    // Each link looks inside on its own; together they climb out.
    ["chain", gzipSync(tar([{ name: "agent", data: program }, { name: "t", type: "2", link: "." }, { name: "u", type: "2", link: "t/.." }]))],
    ["beneath", gzipSync(tar([{ name: "agent", data: program }, { name: "l", type: "2", link: "." }, { name: "l/escaped", data: bytes("x") }]))],
  ];
  for (const [id, body] of cases) {
    const url = `https://dl.invented.example/${id}.tar.gz`;
    const r = rig({ entries: [binaryEntry(id, url, sha(body))], files: { [url]: body } });
    const a = await installed(r, id);
    expect(a.reason).toBe("failed");
    expect(a.message?.startsWith("The archive")).toBe(true);
    expect(existsSync(join(r.home, id, "2.0.0"))).toBe(false);
    expect(existsSync(join(r.home, "escaped"))).toBe(false);
    expect(existsSync(join(r.home, id, "escaped"))).toBe(false);
    expect(existsSync(join(scratch, "escaped"))).toBe(false);
    expect(r.probes).toEqual([]);
  }
  const damaged = zip([{ name: "agent", data: program, badCrc: true }]);
  const url = "https://dl.invented.example/crc.zip";
  const r = rig({ entries: [binaryEntry("crc", url, sha(damaged))], files: { [url]: damaged } });
  const a = await installed(r, "crc");
  expect(a.message).toContain("checksum");
});

test("npx installs with npm into Biom's folder, pinned, and runs the package's bin with node", async () => {
  const entry = { id: "jsagent", name: "JS agent", version: "3.1.0", description: "Invented", distribution: { npx: { package: "@invented/js-agent@3.1.0", args: ["--acp"], env: { NO_UPDATE: "1" } } } };
  const r = rig({
    entries: [entry],
    tool: (spec) => {
      const prefix = spec.cmd[spec.cmd.indexOf("--prefix") + 1] as string;
      const pkg = join(prefix, "node_modules", "@invented", "js-agent");
      mkdirSync(join(pkg, "dist"), { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@invented/js-agent", bin: { "js-agent": "dist/index.js", other: "dist/other.js" } }));
      writeFileSync(join(pkg, "dist", "index.js"), "// invented");
      return 0;
    },
  });
  const a = await installed(r, "jsagent");
  expect(a.state).toBe("active");
  const final = join(r.home, "jsagent", "3.1.0");
  expect(r.ran[0]?.cmd).toEqual(["/invented/bin/npm", "install", "--prefix", final, "--no-audit", "--no-fund", "--no-update-notifier", "--loglevel=error", "--", "@invented/js-agent@3.1.0"]);
  expect(r.probes[0]?.command).toBe("/invented/bin/node");
  expect(r.probes[0]?.args).toEqual([join(final, "node_modules", "@invented", "js-agent", "dist", "index.js"), "--acp"]);
  expect(r.probes[0]?.env.NO_UPDATE).toBe("1");
});

test("uvx installs with uv into directories of Biom's own", async () => {
  const entry = { id: "pyagent", name: "Py agent", version: "0.4.0", description: "Invented", distribution: { uvx: { package: "py-agent@0.4.0", args: ["acp"] } } };
  const r = rig({
    entries: [entry],
    tool: (spec) => {
      const bin = spec.env.UV_TOOL_BIN_DIR as string;
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "py-agent"), "#!/bin/sh\n");
      return 0;
    },
  });
  const a = await installed(r, "pyagent");
  expect(a.state).toBe("active");
  const final = join(r.home, "pyagent", "0.4.0");
  expect(r.ran[0]?.cmd).toEqual(["/invented/bin/uv", "tool", "install", "--", "py-agent==0.4.0"]);
  expect(r.ran[0]?.env.UV_TOOL_DIR).toBe(join(final, "tools"));
  expect(r.ran[0]?.env.UV_TOOL_BIN_DIR).toBe(join(final, "bin"));
  expect(r.probes[0]?.command).toBe(join(final, "bin", "py-agent"));
});

test("npx without Node and uvx without uv are said plainly, and a failed npm leaves nothing", async () => {
  const js = { id: "jsonly", name: "JS only", version: "1.0.0", distribution: { npx: { package: "js-only@1.0.0" } } };
  const py = { id: "pyonly", name: "Py only", version: "1.0.0", distribution: { uvx: { package: "py-only==1.0.0" } } };
  const bare = rig({ entries: [js, py], bins: {} });
  const a = await installed(bare, "jsonly");
  expect(a.reason).toBe("failed");
  expect(a.message).toBe("It installs with npx, which needs Node.js, and this machine has none.");
  const b = await installed(bare, "pyonly");
  expect(b.message).toBe("It installs with uvx, which needs uv, and this machine has none.");
  expect(bare.ran).toEqual([]);

  const agents = makeAgents(bare.deps);
  agents.install("jsonly");
  await agents.settled();
  const list: RegistryAgent[] = await agents.registry();
  // A failed install is not this machine having it: Install is still offered.
  expect(list.find((x) => x.key === "jsonly")?.here).toBe(false);
  expect(list.find((x) => x.key === "jsonly")?.needs).toContain("Node.js");
  expect(list.find((x) => x.key === "pyonly")?.needs).toContain("uv");

  const broken = rig({ entries: [js], tool: () => 1 });
  const c = await installed(broken, "jsonly");
  expect(c.message).toContain("The npm install failed");
  expect(existsSync(join(broken.home, "jsonly", "1.0.0"))).toBe(false);
});

test("the registry: read once in its lifetime, a stale copy when offline, a refusal in words with neither, and what this machine has", async () => {
  let now = 1_000_000;
  const home = fresh();
  const entries = [
    { id: "opencode", name: "OpenCode", version: "1.18.32", description: "The open source coding agent", icon: "https://cdn.invented.example/opencode.svg", distribution: { npx: { package: "opencode-ai@1.18.32" } } },
    binaryEntry("nochecksum", "https://dl.invented.example/n.tar.gz", null),
    binaryEntry("httponly", "http://dl.invented.example/h.tar.gz", "a".repeat(64)),
  ];
  const r = rig({ entries, now: () => now, home, bins: { node: "/n", npm: "/m", opencode: "/invented/bin/opencode" } });
  const agents = makeAgents(r.deps);
  const first = await agents.registry();
  expect(first.find((x) => x.key === "opencode")).toEqual({
    key: "opencode", name: "OpenCode", line: "The open source coding agent", version: "1.18.32", icon: "https://cdn.invented.example/opencode.svg", via: "npx", here: true, needs: null,
  });
  // No registry checksum is no longer a reason it cannot be installed: it is checked on first use.
  expect(first.find((x) => x.key === "nochecksum")?.needs).toBeNull();
  expect(first.find((x) => x.key === "nochecksum")?.via).toBe("binary");
  expect(first.find((x) => x.key === "nochecksum")?.here).toBe(false);
  expect(first.find((x) => x.key === "httponly")?.needs).toBe("Its download is not https, so Biom will not fetch it.");
  await agents.registry();
  expect(r.fetched.filter((u) => u === REGISTRY_URL).length).toBe(1);
  await agents.settled();
  // The list learned the registry's picture.
  expect(agents.list().find((x) => x.key === "opencode")?.icon).toBe("https://cdn.invented.example/opencode.svg");

  // A later server, offline, past the lifetime: the copy on disk stands in.
  now += 7 * 60 * 60 * 1000;
  const offline = rig({ entries, now: () => now, home, registryDown: true });
  expect((await makeAgents(offline.deps).registry()).length).toBe(3);
  // Offline with nothing on disk is a refusal in words.
  const nothing = rig({ entries, registryDown: true });
  await expect(makeAgents(nothing.deps).registry()).rejects.toThrow("could not be reached");
});

test("a machine's own fault — a folder that cannot be made — is said without its detail", async () => {
  const body = gzipSync(tar([{ name: "agent", data: program, mode: 0o755 }]));
  const url = "https://dl.invented.example/f.tar.gz";
  const blocked = join(fresh(), "not-a-folder");
  writeFileSync(blocked, "a file where Biom's folder would go\n");
  const r = rig({ entries: [binaryEntry("f", url, sha(body))], files: { [url]: body }, home: blocked });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const a = await installed(r, "f");
    expect(a.reason).toBe("failed");
    expect(a.message).toBe("It could not be installed.");
  } finally {
    console.warn = warn;
  }
});

test("installing refuses a name that is not an agent's, and the install's secrets stay out of what the client sees", async () => {
  const body = gzipSync(tar([{ name: "agent", data: program, mode: 0o755 }]));
  const url = "https://dl.invented.example/s.tar.gz";
  const r = rig({ entries: [binaryEntry("sec", url, sha(body))], files: { [url]: body } });
  const agents = makeAgents(r.deps);
  expect(() => agents.install("../../x")).toThrow("not an agent's name");
  const heard: AgentInfo[][] = [];
  agents.on((l) => heard.push(l));
  agents.install("sec");
  await agents.settled();
  expect(JSON.stringify(heard)).not.toContain(SECRET);
  expect(heard.some((l) => l.some((a) => a.reason === "installing"))).toBe(true);
  expect(heard.at(-1)?.find((a) => a.key === "sec")?.state).toBe("active");
});

test("A LOOK FOR NEW AGENTS DURING AN INSTALL leaves the install alone: the agent stays installing, is not dropped or probed early, and is probed once when it lands", async () => {
  let clock = 5_000_000;
  const entry = { id: "jsagent", name: "JS agent", version: "3.1.0", description: "Invented", distribution: { npx: { package: "@invented/js-agent@3.1.0", args: ["--acp"] } } };
  const r = rig({ entries: [entry], now: () => clock });
  // `npm`, held: it has not finished until the test says so.
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  r.deps.processes = {
    start(spec) {
      r.ran.push({ cmd: spec.cmd, cwd: spec.cwd, env: spec.env, stdout: spec.stdout });
      const done = held.then(() => {
        const prefix = spec.cmd[spec.cmd.indexOf("--prefix") + 1] as string;
        const pkg = join(prefix, "node_modules", "@invented", "js-agent");
        mkdirSync(join(pkg, "dist"), { recursive: true });
        writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@invented/js-agent", bin: { "js-agent": "dist/index.js" } }));
        writeFileSync(join(pkg, "dist", "index.js"), "// invented");
        return { exit: 0, signal: null };
      });
      return { pid: 6001, pgid: 6001, born: null, done };
    },
    async end() {},
    killNow() {},
    alive: () => false,
  };
  const agents = makeAgents(r.deps);
  agents.list();
  expect(agents.install("jsagent").reason).toBe("installing");
  // Well past the half-minute, again and again, while npm is still running.
  for (let i = 0; i < 5; i++) {
    clock += 31_000;
    agents.list();
    await Bun.sleep(5);
  }
  const during = agents.list().find((a) => a.key === "jsagent");
  expect(during?.reason).toBe("installing");
  expect(r.probes.length).toBe(0);
  release();
  await agents.settled();
  expect(agents.list().find((a) => a.key === "jsagent")?.state).toBe("active");
  // And one look after it landed, not one per list.
  clock += 31_000;
  agents.list();
  await agents.settled();
  expect(r.probes.length).toBe(1);
});

/* ── one install at a time across workspaces (O29) ────────────────────── */

const jsEntry = { id: "jsagent", name: "JS agent", version: "3.1.0", description: "Invented", distribution: { npx: { package: "@invented/js-agent@3.1.0" } } };

/** A stand-in `npm` that marks the tree it is writing, waits until `held`
 *  settles, and fails — as a real one does — when that tree was deleted
 *  under it. Invented. */
function heldNpm(tag: string, runs: string[], held: Promise<void>, fails = false): ProcessRunner {
  return {
    start(spec) {
      runs.push(tag);
      const prefix = spec.cmd[spec.cmd.indexOf("--prefix") + 1] as string;
      const mark = join(prefix, "node_modules", `.${tag}-in-progress`);
      mkdirSync(join(prefix, "node_modules"), { recursive: true });
      writeFileSync(mark, "");
      const done = held.then(() => {
        if (fails || !existsSync(mark)) return { exit: 1, signal: null };
        const pkg = join(prefix, "node_modules", "@invented", "js-agent");
        mkdirSync(pkg, { recursive: true });
        writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@invented/js-agent", bin: "index.js" }));
        writeFileSync(join(pkg, "index.js"), "// invented");
        return { exit: 0, signal: null };
      });
      return { pid: 7000 + runs.length, pgid: 7000 + runs.length, born: null, done };
    },
    async end() {},
    killNow() {},
    alive: () => false,
  };
}

async function waitFor(what: string, ms: number, ok: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const lockTiming = { installLockPoll: 20, installLockBeat: 50, installLockStale: 5_000 };

test("TWO WORKSPACES INSTALLING ONE AGENT take turns by a lock in the folder they share: the second waits, finds it installed, and deletes nothing of the first's", async () => {
  const home = fresh();
  const runs: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const a = rig({ entries: [jsEntry], home });
  const b = rig({ entries: [jsEntry], home });
  a.deps.processes = heldNpm("A", runs, held);
  b.deps.processes = heldNpm("B", runs, held);
  a.deps.timing = { ...a.deps.timing, ...lockTiming };
  b.deps.timing = { ...b.deps.timing, ...lockTiming };
  const A = makeAgents(a.deps);
  const B = makeAgents(b.deps);
  A.install("jsagent");
  await waitFor("the first workspace's npm to start", 3000, () => runs.length === 1);
  B.install("jsagent");
  await waitFor("the second to say it is waiting", 3000, () => B.list().find((x) => x.key === "jsagent")?.message === "It is being installed in another workspace.");
  expect(B.list().find((x) => x.key === "jsagent")?.reason).toBe("installing");
  await Bun.sleep(100);
  expect(runs).toEqual(["A"]);
  release();
  await A.settled();
  await B.settled();
  expect(A.list().find((x) => x.key === "jsagent")?.state).toBe("active");
  expect(B.list().find((x) => x.key === "jsagent")?.state).toBe("active");
  // The second never ran npm: it found the first's install and used it.
  expect(runs).toEqual(["A"]);
  expect(existsSync(join(home, "jsagent", "3.1.0", "node_modules", "@invented", "js-agent", "index.js"))).toBe(true);
  expect(readdirSync(join(home, "jsagent")).filter((n) => n.endsWith(".lock"))).toEqual([]);
});

test("a workspace that waited on another's install installs the agent itself when that one failed", async () => {
  const home = fresh();
  const runs: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const a = rig({ entries: [jsEntry], home });
  const b = rig({ entries: [jsEntry], home });
  a.deps.processes = heldNpm("A", runs, held, true);
  b.deps.processes = heldNpm("B", runs, Promise.resolve());
  a.deps.timing = { ...a.deps.timing, ...lockTiming };
  b.deps.timing = { ...b.deps.timing, ...lockTiming };
  const A = makeAgents(a.deps);
  const B = makeAgents(b.deps);
  A.install("jsagent");
  await waitFor("the first workspace's npm to start", 3000, () => runs.length === 1);
  B.install("jsagent");
  await waitFor("the second to say it is waiting", 3000, () => B.list().find((x) => x.key === "jsagent")?.message === "It is being installed in another workspace.");
  release();
  await A.settled();
  await B.settled();
  expect(A.list().find((x) => x.key === "jsagent")?.reason).toBe("failed");
  expect(B.list().find((x) => x.key === "jsagent")?.state).toBe("active");
  expect(runs).toEqual(["A", "B"]);
  expect(readdirSync(join(home, "jsagent")).filter((n) => n.endsWith(".lock"))).toEqual([]);
});

test("a lock left by a server that stopped mid-install goes stale, and the next install goes ahead", async () => {
  const home = fresh();
  mkdirSync(join(home, "jsagent"), { recursive: true });
  const lock = join(home, "jsagent", ".install-3.1.0.lock");
  writeFileSync(lock, "{}\n");
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(lock, old, old);
  const runs: string[] = [];
  const r = rig({ entries: [jsEntry], home });
  r.deps.processes = heldNpm("A", runs, Promise.resolve());
  r.deps.timing = { ...r.deps.timing, ...lockTiming };
  const a = await installed(r, "jsagent");
  expect(a.state).toBe("active");
  expect(runs).toEqual(["A"]);
  expect(existsSync(lock)).toBe(false);
});
