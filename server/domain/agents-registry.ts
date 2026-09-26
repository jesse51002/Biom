// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE ACP REGISTRY, READ, and what installing one of its agents on
// this machine would take. Pure.
//
// The registry is a file off the network, so every field of it is untrusted:
// an id becomes a folder name and a version a second one, a package spec goes
// to `npm install` and `uv tool install`, and a binary's `cmd` is a path inside
// an archive somebody else built. So an id must be `AGENT_KEY`, a version a
// version, a package spec a PINNED spec from the registry's own index and never
// a url, a path, a tag or a flag, a download `https:` with a SHA-256 beside it,
// and a `cmd` a path that stays inside what was unpacked. An entry that fails
// any of it is dropped, not repaired.
//
// WHICH WAY AN AGENT IS INSTALLED is the plan: a binary built for this machine
// whose checksum the registry lists, else `npx`, else `uvx`. A binary with no
// checksum is never a plan — Biom will not run a download it cannot check —
// and an agent with nothing else says so rather than installing unchecked.

import type { AgentKey } from "../../contracts/types.ts";
import { AGENT_KEY } from "../../contracts/wire.js";

/** Where the registry is read from. */
export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

export type ArchiveKind = "tar.gz" | "tar.bz2" | "tar" | "zip" | "raw";

export interface BinaryTarget {
  archive: string;
  kind: ArchiveKind;
  /** Inside what was unpacked: relative, forward-slashed, never `..`. */
  cmd: string;
  args: string[];
  env: Record<string, string>;
  /** Lowercase hex, or null where the registry lists none. */
  sha256: string | null;
}

export interface PackageDist {
  /** As npm or uv takes it, pinned. */
  spec: string;
  /** The package's name, without its version. */
  name: string;
  args: string[];
  env: Record<string, string>;
}

export interface RegistryEntry {
  key: AgentKey;
  name: string;
  line: string;
  version: string;
  icon: string | null;
  npx: PackageDist | null;
  uvx: PackageDist | null;
  /** By platform, `linux-x86_64` and the like. */
  binary: Record<string, BinaryTarget>;
}

export type InstallPlan =
  | { via: "binary"; target: BinaryTarget }
  | { via: "npx"; dist: PackageDist }
  | { via: "uvx"; dist: PackageDist };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v !== "" && v.length <= max ? v : null);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A version, as a folder name: no separator, no dot-dot, not starting with a dot. */
export const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
/** An npm spec from the registry's own index, pinned to an exact version. */
const NPM_SPEC = /^((?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*)@(\d[0-9A-Za-z.+-]*)$/;
/** A Python package pinned the way `uvx` or PEP 508 spells it. */
const UV_SPEC = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:==|@)(\d[0-9A-Za-z.+!-]*)$/;
const SHA256 = /^[0-9a-f]{64}$/;

function argsOf(v: unknown): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 64) return null;
  const out: string[] = [];
  for (const a of v) {
    if (typeof a !== "string" || a.length > 4096 || a.includes("\u0000")) return null;
    out.push(a);
  }
  return out;
}

function envOf(v: unknown): Record<string, string> | null {
  if (v === undefined) return {};
  if (!isObj(v)) return null;
  const out: Record<string, string> = {};
  const entries = Object.entries(v);
  if (entries.length > 64) return null;
  for (const [k, value] of entries) {
    if (!NAME.test(k) || typeof value !== "string" || value.length > 8192 || value.includes("\u0000")) return null;
    out[k] = value;
  }
  return out;
}

function httpsUrl(v: unknown): string | null {
  const s = text(v, 2048);
  if (s === null) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

/** What kind of download a url is, by its file name; null for one Biom cannot
 *  unpack. A name with no extension, or `.exe`, is the program itself. */
export function archiveKind(url: string): ArchiveKind | null {
  let file: string;
  try {
    file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").toLowerCase();
  } catch {
    return null;
  }
  if (file === "") return null;
  if (file.endsWith(".tar.gz") || file.endsWith(".tgz")) return "tar.gz";
  if (file.endsWith(".tar.bz2") || file.endsWith(".tbz2") || file.endsWith(".tbz")) return "tar.bz2";
  if (file.endsWith(".tar")) return "tar";
  if (file.endsWith(".zip")) return "zip";
  if (file.endsWith(".exe")) return "raw";
  // A dot in the name is an extension Biom does not read — `.tar.xz`, `.dmg`,
  // `.7z` — unless what follows it is a version's digits.
  const dot = file.lastIndexOf(".");
  if (dot < 0 || /^\d+$/.test(file.slice(dot + 1))) return "raw";
  return null;
}

/** A path inside a folder: relative, forward-slashed, no `.` or `..`
 *  segment, no drive, no backslash, no NUL. `""` is the folder itself, and
 *  null a path that would leave it. The one test every name from an archive,
 *  and every `cmd`, passes before it touches a disk. */
export function safeRelPath(name: string): string | null {
  if (name.length > 4096 || name.includes("\u0000") || name.includes("\\")) return null;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return null;
  const parts: string[] = [];
  for (const seg of name.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.join("/");
}

function packageOf(v: unknown, spell: RegExp): PackageDist | null {
  if (!isObj(v)) return null;
  const spec = text(v.package, 256);
  const m = spec === null ? null : spec.match(spell);
  const args = argsOf(v.args);
  const env = envOf(v.env);
  if (spec === null || m === null || args === null || env === null) return null;
  return { spec, name: m[1] as string, args, env };
}

function binaryOf(v: unknown): Record<string, BinaryTarget> {
  const out: Record<string, BinaryTarget> = {};
  if (!isObj(v)) return out;
  for (const [platform, t] of Object.entries(v)) {
    if (!/^[a-z0-9]+-[a-z0-9_]+$/.test(platform) || !isObj(t)) continue;
    const archive = httpsUrl(t.archive);
    const kind = archive === null ? null : archiveKind(archive);
    const rawCmd = text(t.cmd, 1024);
    const cmd = rawCmd === null ? null : safeRelPath(rawCmd);
    const args = argsOf(t.args);
    const env = envOf(t.env);
    if (archive === null || kind === null || cmd === null || cmd === "" || args === null || env === null) continue;
    const sum = typeof t.sha256 === "string" ? t.sha256.toLowerCase() : null;
    out[platform] = { archive, kind, cmd, args, env, sha256: sum !== null && SHA256.test(sum) ? sum : null };
  }
  return out;
}

/** THE REGISTRY, READ. Every entry that passes; an id listed twice is the
 *  first. Throws only when the document is not a registry at all. */
export function parseRegistry(doc: unknown): RegistryEntry[] {
  if (!isObj(doc) || !Array.isArray(doc.agents)) throw new Error("the ACP Registry answered something that is not a registry");
  const out: RegistryEntry[] = [];
  for (const a of doc.agents) {
    if (out.length >= 1000) break;
    if (!isObj(a)) continue;
    const key = typeof a.id === "string" && AGENT_KEY.test(a.id) ? a.id : null;
    const version = typeof a.version === "string" && VERSION.test(a.version) ? a.version : null;
    const name = text(a.name, 200);
    if (key === null || version === null || name === null || out.some((e) => e.key === key)) continue;
    const dist = isObj(a.distribution) ? a.distribution : {};
    out.push({
      key,
      name,
      line: typeof a.description === "string" ? a.description.slice(0, 500) : "",
      version,
      icon: httpsUrl(a.icon),
      npx: packageOf(dist.npx, NPM_SPEC),
      uvx: packageOf(dist.uvx, UV_SPEC),
      binary: binaryOf(dist.binary),
    });
  }
  return out;
}

/** The registry's name for this machine — `linux-x86_64`, `darwin-aarch64`,
 *  `windows-x86_64` — or null for one it has no word for. */
export function platformKey(platform: string, arch: string): string | null {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : null;
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : null;
  return os === null || cpu === null ? null : `${os}-${cpu}`;
}

/** Every way this entry could be installed here, best first, before asking
 *  whether this machine has Node or uv. */
export function installPlans(entry: RegistryEntry, platform: string | null): InstallPlan[] {
  const plans: InstallPlan[] = [];
  const target = platform === null ? undefined : entry.binary[platform];
  if (target !== undefined && target.sha256 !== null) plans.push({ via: "binary", target });
  if (entry.npx !== null) plans.push({ via: "npx", dist: entry.npx });
  if (entry.uvx !== null) plans.push({ via: "uvx", dist: entry.uvx });
  return plans;
}

/** Why an entry with no plan cannot be installed here, in a sentence. */
export function noPlanReason(entry: RegistryEntry, platform: string | null): string {
  const target = platform === null ? undefined : entry.binary[platform];
  if (target !== undefined && target.sha256 === null) {
    return `the ACP Registry lists no checksum for ${entry.name}'s download, so Biom will not install it`;
  }
  return `the ACP Registry has no build of ${entry.name} for this machine`;
}

/** `name@1.2.3` or `name==1.2.3` as `uv tool install` reads it. */
export function uvSpec(dist: PackageDist): string {
  const m = dist.spec.match(UV_SPEC);
  return m === null ? dist.spec : `${m[1]}==${m[2]}`;
}
