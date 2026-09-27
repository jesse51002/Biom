// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — WHAT AGENTS THIS MACHINE HAS: finding them, probing them,
// installing one from the ACP Registry and signing one in (*Chat*, `picker`,
// `install`, `credentials`, and the *Agent sign-in* research under it).
//
// FINDING IS LOOKING. An agent is listed when this machine has it: a command
// the known-agents table names (`server/domain/agents-known.ts`) on the login
// shell's `PATH`, an agent Biom installed into its own folder, or — for Claude
// Code and Codex — the agent's own CLI plus a way to run its ACP adapter, said
// plainly to be missing Node where there is none. OpenClaw is found by its
// command and is only ever reached through a Gateway on THIS machine: its
// bridge is started pointed at the local address, the check asks the local
// address and nothing else, and **Start Gateway** is `start`. The first `list`
// looks, and a `list` read once the last look is `TIMING.rediscover` old looks
// again, probing what it finds new and what it knew whose last probe FAILED
// (O34) — so an agent put on this machine or mended while Biom runs is found
// without a restart, and a list read often is not a probe storm. An agent
// waiting for a sign-in is not looked at again unasked.
//
// ACTIVE MEANS THE SESSION OPENED, and nothing short of it: the agent started,
// answered `initialize` and answered `session/new`. Anything less is Inactive
// with a reason word and a sentence of Biom's own — never the agent's stderr,
// never its error text. The probe speaks through the one reading of the
// protocol the chats use, `server/platform/acp-wire.ts` — the same
// `initialize`, the same `session/new`, the same pickers with the same option
// ids, so a `chat.config` made before a chat has a session names an option the
// chat's own session knows — and it never calls `authenticate` unasked: on an
// agent already signed in that can sign it out, or open a browser for nothing.
// The one exception is `AUTH_EVERY_PROCESS` below — three agents unusable in a
// process that has not called it — and those are sent the method that last
// signed them in, on a look as on a chat. The probe
// session's config options and commands are kept on the agent, so the start
// screen's pickers and the / menu are full before a chat has a session; and
// where the agent offers `session/delete`, the probe's own session is deleted
// once read, so looking leaves no empty chat in the person's own history.
//
// SIGN-IN IS ASKED FOR ONLY WHEN IT IS NEEDED: when a probe's session, or a
// chat's session or message, was refused as *authentication required* — the
// chats report theirs through `refused`. An agent-type method is `authenticate`
// followed by `session/new` on the same connection, and the verdict is the
// session opening, never `authenticate`'s answer. A terminal method answers
// what the sign-in pop-up runs and a TICKET, single-use and short-lived, which
// the terminal redeems for exactly that command — so the pop-up runs what this
// module resolved and never a command line a page wrote. A refusal is STICKY:
// an agent that opens a session and then refuses the first message stays
// signed out until somebody signs it in, rather than flipping back to Active on
// the next probe. The one exception is an agent that offers NO way to sign in:
// Biom cannot sign it in, so a `probe` the person asks for — Check again,
// after signing in from its own command — is believed (O35).
//
// INSTALLING reads the ACP Registry (`server/domain/agents-registry.ts`),
// cached with a lifetime in memory and in Biom's own folder, and installs into
// that folder — under the per-user data directory, never a vault — at the
// registry's pinned version: `npm install --prefix`, `uv tool install` into
// directories of its own, or a binary for this platform fetched over https at
// every hop, whose SHA-256 must match the registry's before a byte of it is
// unpacked (`server/domain/agents-archive.ts` judges the archive; this file
// writes it). WHERE THE REGISTRY LISTS NO CHECKSUM the download is trusted on
// first use: the registry is still what names the url, the SHA-256 of what
// came is recorded in `installed.json` by version and said in the agent's
// install log, and a later download of that same version with other bytes is
// refused — so a changed file for a pinned version is never run. A new version
// is a new first use, and a checksum the registry does list always decides.
// EVERY WORKSPACE OPEN ON THIS MACHINE SHARES THAT FOLDER, so one install of
// an agent and version runs at a time across all of them, by a lock file
// beside its tree (O29): a second waits, says so, and then uses what the
// first installed, or installs it itself where the first failed.
//
// NOTHING WAITS. A probe, an install, a sign-in and a Gateway start each answer
// the agent as it stands and say the verdict to every subscriber when it
// lands. Every step is bounded in time, one job runs per agent at a time, and
// `killAll` ends every probe and install process on the way out.
//
// NOTHING OF THE PERSON'S LEAVES. The login environment an agent is launched
// with is in `AgentLaunch`, which is server-side only; an `AgentInfo` carries
// names, sentences and the agent's own lists; a `SignIn` carries the METHOD's
// environment and nothing of the person's; and nothing here logs an
// environment, a key or what an agent said.
//
// E2E FINDS ITS FAKE AGENT BY THIS MODULE'S REAL PATH, and nothing else: the
// test sandbox puts a scripted ACP agent on the `PATH` it hands the server,
// under a command name the known-agents table already lists —
// `claude-agent-acp`. No environment variable changes how anything here loads.

import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, constants as fsConstants, copyFileSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import type { AgentInfo, AgentKey, AgentLaunch, AgentReason, ConfigOption, ProcessRunner, RegistryAgent, SignIn, SlashCommand } from "../../contracts/types.ts";
import { AGENT_KEY, OPAQUE_ID } from "../../contracts/wire.js";
import type { AcpConnection } from "../platform/acp.ts";
import { isAuthRequired } from "../platform/acp.ts";
import { ACP_PROTOCOL_VERSION, initializeParams, newSessionParams, readInitialize, readSession, readUpdate, toConfigOptions, toSlashCommands } from "../platform/acp-wire.ts";
import { authInfo, readAuthMethods, terminalCommand } from "../domain/agents-auth.ts";
import type { AuthMethod } from "../domain/agents-auth.ts";
import { ArchiveError, MAX_TOTAL, judge, tarEntries, zipData, zipEntries } from "../domain/agents-archive.ts";
import type { Entry } from "../domain/agents-archive.ts";
import { KNOWN_AGENTS, knownAgent } from "../domain/agents-known.ts";
import type { Gateway, KnownAgent } from "../domain/agents-known.ts";
import { REGISTRY_URL, VERSION, installPlans, isHttps, noPlanReason, parseRegistry, platformKey, safeRelPath, uvSpec } from "../domain/agents-registry.ts";
import type { InstallPlan, PackageDist, RegistryEntry } from "../domain/agents-registry.ts";

/** EVERYTHING THE AGENTS ARE HANDED. The probe speaks ACP through `connect`,
 *  the same seam the chats use — `connectAcp` in the running server, and in a
 *  test a fake `AcpConnection` (`server/platform/acp.ts`) that answers
 *  `initialize` and `session/new` from a script, so no agent is ever run. */
export interface AgentsDeps {
  connect: (launch: AgentLaunch, cwd: string) => AcpConnection;
  /** The person's login environment, read once per server — `makeLoginEnv`. */
  env: () => Promise<Record<string, string>>;
  /** Where a command is on that environment's `PATH`, or null — `whichIn`. */
  which: (command: string, env: Record<string, string>) => Promise<string | null>;
  /** The network, for the registry, a binary's download and the local
   *  Gateway's check. */
  fetch: typeof fetch;
  /** Biom's own folder of installed agents, under the per-user data
   *  directory and never in a vault. Shared by every vault. */
  home: string;
  /** Where a probe runs: a vault's root. */
  cwd: string;
  now: () => number;
  /** What runs `npm`, `uv` and `bzip2` for an install, and OpenClaw's
   *  Gateway — the one runner the composition root already holds. */
  processes: ProcessRunner;
  /** A SIGN-IN SUCCEEDED HERE: an agent-type sign-in, or the look after a
   *  sign-in pop-up's command, opened a session. Sign-in is the person's and
   *  not a workspace's, so the composition root tells every other workspace's
   *  agents (`signedInElsewhere`). `method` is what an agent that wants
   *  `authenticate` in every process was signed in with, else null. Never
   *  said for a look `signedInElsewhere` asked for, so the news cannot echo. */
  onSignedIn?: (key: AgentKey, method: string | null) => void;
  /** Absent: this process's. A test names another machine. */
  platform?: string;
  arch?: string;
  /** Absent: the bounds below. A test shortens them. */
  timing?: Partial<AgentsTiming>;
}

/** Every bound this module keeps, in milliseconds. */
export interface AgentsTiming {
  /** `initialize`, for an agent that starts at once. */
  initialize: number;
  /** Deleting a probe's session, where the agent offers that. */
  tidy: number;
  /** `initialize` for one `npx` fetches first — an adapter that is not yet in
   *  npm's cache downloads before it can answer. */
  initializeFetching: number;
  session: number;
  /** How long a probe waits for `available_commands_update` after the session
   *  opened. The session is Active either way. */
  commands: number;
  /** An agent-type sign-in: usually a browser the person finishes. */
  authenticate: number;
  gatewayCheck: number;
  gatewayWait: number;
  gatewayPoll: number;
  registryFetch: number;
  registryTtl: number;
  /** How old the last look for agents may be before a list looks again. */
  rediscover: number;
  /** A download that sends nothing for this long is abandoned. */
  downloadIdle: number;
  download: number;
  /** One `npm`, `uv` or `bzip2` run. */
  install: number;
  /** How often an install waiting on another workspace's install of the
   *  same agent and version looks at its lock again. */
  installLockPoll: number;
  /** How often an install in flight says it is still going, by its lock
   *  file's time. */
  installLockBeat: number;
  /** A lock not said to be going for this long was left by a server that
   *  stopped in the middle of an install, and is taken over. */
  installLockStale: number;
  /** How long an unredeemed sign-in ticket lasts. */
  ticket: number;
  /** How long after a ticket is redeemed its command's end still re-probes
   *  the agent: a sign-in somebody finishes in a browser, or by pasting a
   *  code, takes as long as it takes. */
  signInRun: number;
}

export const TIMING: AgentsTiming = {
  initialize: 30_000,
  tidy: 2_000,
  initializeFetching: 180_000,
  session: 60_000,
  commands: 2_000,
  authenticate: 600_000,
  gatewayCheck: 1_500,
  gatewayWait: 20_000,
  gatewayPoll: 500,
  registryFetch: 15_000,
  registryTtl: 6 * 60 * 60 * 1000,
  rediscover: 30_000,
  downloadIdle: 60_000,
  download: 30 * 60 * 1000,
  install: 15 * 60 * 1000,
  installLockPoll: 1_000,
  installLockBeat: 10_000,
  installLockStale: 60_000,
  ticket: 5 * 60 * 1000,
  signInRun: 60 * 60 * 1000,
};

/** THE AGENTS THAT WANT `authenticate` IN EVERY PROCESS, even with the person
 *  signed in: Grok Build needs `cached_token` before a session, Cursor's
 *  session is unusable until `cursor_login`, and Junie's prompts fail until it
 *  succeeds (the *Agent sign-in* research, with a source on each row). For
 *  these, the method that last signed one in is `signedInWith`, and every
 *  process — a probe's, a chat's — sends it before `session/new`. For EVERY
 *  OTHER agent `signedInWith` is null and nothing sends `authenticate` unasked,
 *  because on an agent already signed in it can sign the person out or open a
 *  browser for nothing. By registry key. */
export const AUTH_EVERY_PROCESS: ReadonlySet<AgentKey> = new Set(["cursor", "junie", "grok-build"]);

/** What `redeem` answers: the command the sign-in pop-up runs, and whose
 *  sign-in it is. */
export type SignInLaunch = AgentLaunch & { agent: AgentKey };

export interface Agents {
  /** What is known now; probes still in flight are `checking`. The first
   *  call starts finding them. */
  list(): AgentInfo[];
  /** Look again at one agent. Answers it as `checking`. For an agent that
   *  offers no way to sign in, it lifts a sign-in refusal first (O35). */
  probe(key: AgentKey): AgentInfo;
  /** **Start Gateway**: OpenClaw's, on this machine. Answers it as `checking`. */
  start(key: AgentKey): AgentInfo;
  /** The ACP Registry's agents, and which this machine has or cannot run. */
  registry(): Promise<RegistryAgent[]>;
  /** Answers the agent as `installing`. */
  install(key: AgentKey): AgentInfo;
  signIn(key: AgentKey, method: string): Promise<SignIn>;
  /** The command a ticket stands for, once — what the sign-in pop-up runs,
   *  with the COMPLETE environment it runs in: the login shell's, the
   *  launch's own variables and the method's — and the agent it signs in.
   *  Null for a ticket that is unknown, spent or expired. */
  redeem(ticket: string): SignInLaunch | null;
  /** A redeemed ticket's command has ended: look at its agent again, now,
   *  and believe the session it opens — it is the probe after a sign-in.
   *  Answers nothing; the agent is `checking` and its verdict is pushed. A
   *  ticket that is unknown, already reported or past its bound is nothing. */
  signedIn(ticket: string): void;
  /** How to start an agent for a chat, or null where it cannot be started. */
  launch(key: AgentKey): Promise<AgentLaunch | null>;
  /** A chat's agent refused a session or a message for want of a sign-in:
   *  mark it Inactive with `signin`, and say so. */
  refused(key: AgentKey): void;
  /** The sign-in method that last made this agent's session open, for an
   *  agent that wants `authenticate` in every process before `session/new`
   *  (`AUTH_EVERY_PROCESS`: Grok Build, Cursor, Junie) — null for every other
   *  agent, and for one not yet signed in. */
  signedInWith(key: AgentKey): string | null;
  /** THE PERSON SIGNED THIS AGENT IN THROUGH ANOTHER WORKSPACE: the refusal
   *  this workspace heard is lifted and, unless the agent is already Active
   *  here, it is looked at again. `method` is the one an agent that wants
   *  `authenticate` in every process was signed in with. A look this asks
   *  for is never reported as a sign-in of its own. */
  signedInElsewhere(key: AgentKey, method?: string | null): void;
  /** Hear the whole list whenever any of it changes. Answers the unsubscribe. */
  on(fn: (agents: AgentInfo[]) => void): () => void;
  /** Settles when nothing is in flight: no finding, probe, install or
   *  sign-in. For a test, and for a caller that wants the verdicts. */
  settled(): Promise<void>;
  /** End every probe and install process, now: KILL, synchronously, for the
   *  server's exit handler. */
  killAll(): void;
}

/* ── the parts ─────────────────────────────────────────────────────────── */

/** How one agent is started on this machine, as found just now. */
interface Found {
  source: "path" | "installed";
  /** Null where it is here and cannot start — `cannot` says why. */
  launch: AgentLaunch | null;
  cannot: string | null;
  gateway: Gateway | null;
  /** Its launcher fetches before it answers: `npx` running an adapter. */
  fetching: boolean;
  version: string | null;
}

interface Slot {
  key: AgentKey;
  info: AgentInfo;
  found: Found | null;
  /** The methods `initialize` listed, with what a pop-up would run. */
  methods: AuthMethod[];
  /** The one job running for this agent, and the chain the next waits on. */
  tail: Promise<void>;
  probeQueued: boolean;
  installing: boolean;
  /** A session or a message was refused: stays signed out until a sign-in. */
  refusedSignIn: boolean;
  /** A sign-in has happened since the refusal, so the next session is
   *  believed. */
  trust: boolean;
  signedInWith: string | null;
}

type Verdict =
  | { state: "active"; version: string | null; methods: AuthMethod[]; options: ConfigOption[]; commands: SlashCommand[] }
  | { state: "inactive"; reason: "signin" | "failed"; message: string; version: string | null; methods: AuthMethod[] };

/** A refusal the route answers with its own sentence. */
function refusal(code: "bad_request" | "not_found" | "fetch_failed", message: string): Error {
  return Object.assign(new Error(message), { code });
}

class Timeout extends Error {
  override name = "Timeout";
}

/** A sentence of this module's own, for the person: an install that failed
 *  says one of these, and anything else is said without its detail. */
class Said extends Error {
  override name = "Said";
}

/** `s` as a sentence: a capital, and a full stop. */
const sentence = (s: string): string => {
  const cap = s.replace(/^./, (c) => c.toUpperCase());
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
};

/** `p`, or a `Timeout` after `ms` — whatever the other side promises about
 *  its own timeouts, nothing here waits longer than its own bound. */
function bounded<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(what)), ms);
  });
  return Promise.race([p, limit]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Hand every chunk of a body to `fn`, and let go of the body however it
 *  ends — a refusal part-way cancels the rest rather than leaving it open. */
async function eachChunk(body: ReadableStream<Uint8Array>, fn: (chunk: Uint8Array) => void): Promise<void> {
  const reader = body.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      if (value !== undefined) fn(value);
    }
  } finally {
    if (!finished) reader.cancel().catch(() => null);
  }
}

const seconds = (ms: number): string => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);

const SIGN_IN = "It needs you to sign in.";
const GATEWAY_DOWN = "OpenClaw's Gateway is not running on this machine.";

/** Does `initialize` offer `session/delete`? */
function offersDelete(init: unknown): boolean {
  const caps = typeof init === "object" && init !== null ? (init as { agentCapabilities?: unknown }).agentCapabilities : null;
  const sessions = typeof caps === "object" && caps !== null ? (caps as { sessionCapabilities?: unknown }).sessionCapabilities : null;
  const del = typeof sessions === "object" && sessions !== null ? (sessions as { delete?: unknown }).delete : null;
  return typeof del === "object" && del !== null;
}

/** The installed-agent record Biom writes beside what it installed. */
interface Installed {
  key: AgentKey;
  version: string;
  via: "binary" | "npx" | "uvx";
  /** Relative to the agent's folder under `home`. */
  file: string;
  /** Run with `node`: a JavaScript entry point. */
  node: boolean;
  args: string[];
  env: Record<string, string>;
  /** Version → SHA-256 of every binary download installed for this agent:
   *  the record a download the registry lists no checksum for is held to. */
  downloads?: Record<string, string>;
}

const MANIFEST = "installed.json";
const REGISTRY_CACHE = "registry.json";
const MAX_REGISTRY = 4 * 1024 * 1024;
const MAX_DOWNLOAD = 2 * 1024 * 1024 * 1024;
/** Redirects a download may take: a release host and its storage are two. */
const MAX_REDIRECTS = 10;
/** A staged install older than this was left by a server that stopped. */
const STALE_PART = 60 * 60 * 1000;
/** A decompressed tar: what the archive may unpack to, plus its headers. */
const MAX_TAR = MAX_TOTAL + 512 * 1024 * 1024;

/* ── the module ────────────────────────────────────────────────────────── */

export function makeAgents(deps: AgentsDeps): Agents {
  const t: AgentsTiming = { ...TIMING, ...deps.timing };
  const home = resolve(deps.home);
  const platform = deps.platform ?? process.platform;
  const plat = platformKey(platform, deps.arch ?? process.arch);

  const slots = new Map<AgentKey, Slot>();
  const listeners = new Set<(agents: AgentInfo[]) => void>();
  const inflight = new Set<Promise<unknown>>();
  /** Connections open now: probes and agent-type sign-ins. */
  const live = new Set<AcpConnection>();
  /** Process groups an install is running. */
  const running = new Set<number>();
  /** Sign-in tickets minted and not yet redeemed. */
  const tickets = new Map<string, { launch: SignInLaunch; expires: number }>();
  /** Tickets redeemed, whose command's end re-probes their agent. */
  const redeemed = new Map<string, { agent: AgentKey; until: number }>();
  let closed = false;
  /** A look for agents in flight, and when the last one began — by the
   *  injected clock. */
  let looking: Promise<void> | null = null;
  let lookedAt: number | null = null;
  let cache: { at: number; entries: RegistryEntry[] } | null = null;
  let cacheLoaded = false;

  const track = <T>(p: Promise<T>): Promise<T> => {
    inflight.add(p);
    p.then(() => inflight.delete(p), () => inflight.delete(p));
    return p;
  };

  const inside = (abs: string): boolean => {
    const p = resolve(abs);
    return p === home || p.startsWith(home + sep);
  };
  /** The agent's own folder: `home/<key>`, the key already `AGENT_KEY`. */
  const folderOf = (key: AgentKey): string => join(home, key);

  /* ── the list ─────────────────────────────────────────────────────── */

  const snapshot = (): AgentInfo[] => [...slots.values()].map((s) => structuredClone(s.info));

  function emit(): void {
    if (listeners.size === 0) return;
    const list = snapshot();
    for (const fn of listeners) {
      try {
        fn(list);
      } catch (e) {
        console.warn("agents: a listener threw", e instanceof Error ? e.name : typeof e);
      }
    }
  }

  function registryEntry(key: AgentKey): RegistryEntry | null {
    return cache?.entries.find((e) => e.key === key) ?? null;
  }

  function slotFor(key: AgentKey, source: "path" | "installed"): Slot {
    const had = slots.get(key);
    if (had !== undefined) return had;
    // The copy of the registry kept on disk, never the network: an agent the
    // table does not name is called what the registry calls it.
    loadCache();
    const known = knownAgent(key);
    const entry = registryEntry(key);
    const slot: Slot = {
      key,
      info: {
        key,
        name: known?.name ?? entry?.name ?? key,
        line: known?.line ?? entry?.line ?? "",
        icon: entry?.icon ?? null,
        source,
        version: null,
        state: "inactive",
        reason: "checking",
        message: null,
        auth: [],
        options: [],
        commands: [],
      },
      found: null,
      methods: [],
      tail: Promise.resolve(),
      probeQueued: false,
      installing: false,
      refusedSignIn: false,
      trust: false,
      signedInWith: null,
    };
    slots.set(key, slot);
    return slot;
  }

  /** The registry's picture for an agent, and its name and line where the
   *  known-agents table has none of its own. Answers whether anything moved. */
  function describe(slot: Slot, entry: RegistryEntry): boolean {
    const known = knownAgent(slot.key);
    const name = known?.name ?? entry.name;
    const line = known?.line ?? entry.line;
    if (slot.info.icon === entry.icon && slot.info.name === name && slot.info.line === line) return false;
    slot.info.icon = entry.icon;
    slot.info.name = name;
    slot.info.line = line;
    return true;
  }

  function set(slot: Slot, reason: AgentReason | null, message: string | null): void {
    slot.info.state = reason === null ? "active" : "inactive";
    slot.info.reason = reason;
    slot.info.message = message;
    if (reason !== null && reason !== "checking") {
      slot.info.options = [];
      slot.info.commands = [];
    }
  }

  /** The method an agent wants in every process, or null — see
   *  `AUTH_EVERY_PROCESS`. */
  function everyProcess(slot: Slot): string | null {
    return AUTH_EVERY_PROCESS.has(slot.key) ? slot.signedInWith : null;
  }

  /** One job at a time per agent, in the order asked. */
  function queue(slot: Slot, what: string, job: () => Promise<void>): void {
    const next = slot.tail.then(async () => {
      if (!closed) await job();
    }).catch((e) => {
      // Biom's own failure, never an agent's words: those never reach a log.
      console.warn(`agents: ${what} ${slot.key} failed:`, e instanceof Error && typeof (e as { code?: unknown }).code !== "number" ? e.message : "unexpectedly");
    });
    slot.tail = next;
    track(next);
  }

  function queueProbe(slot: Slot): void {
    if (slot.probeQueued || closed) return;
    slot.probeQueued = true;
    queue(slot, "probing", async () => {
      slot.probeQueued = false;
      await runProbe(slot);
    });
  }

  /* ── finding ──────────────────────────────────────────────────────── */

  function readInstalled(key: AgentKey): Installed | null {
    const path = join(folderOf(key), MANIFEST);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const file = typeof r.file === "string" ? safeRelPath(r.file) : null;
    if (r.key !== key || typeof r.version !== "string" || !VERSION.test(r.version) || file === null || file === "") return null;
    if (r.via !== "binary" && r.via !== "npx" && r.via !== "uvx") return null;
    const args = Array.isArray(r.args) && r.args.every((a) => typeof a === "string") ? (r.args as string[]) : null;
    const env = typeof r.env === "object" && r.env !== null && !Array.isArray(r.env) && Object.values(r.env).every((v) => typeof v === "string")
      ? (r.env as Record<string, string>)
      : null;
    if (args === null || env === null) return null;
    return { key, version: r.version, via: r.via, file, node: r.node === true, args, env };
  }

  /** Every key Biom has installed, by the folders under `home`. */
  function installedKeys(): AgentKey[] {
    try {
      return readdirSync(home).filter((k) => AGENT_KEY.test(k) && existsSync(join(home, k, MANIFEST))).sort();
    } catch {
      return [];
    }
  }

  /** The adapter's pinned spec: the registry's, where it lists the same
   *  package, else the table's. */
  function adapterSpec(known: KnownAgent): string {
    const a = known.adapter as NonNullable<KnownAgent["adapter"]>;
    const npx = registryEntry(known.key)?.npx;
    return npx !== null && npx !== undefined && npx.name === a.package ? npx.spec : `${a.package}@${a.version}`;
  }

  async function fromInstalled(key: AgentKey, env: Record<string, string>): Promise<Found | null> {
    const rec = readInstalled(key);
    if (rec === null) return null;
    const file = join(folderOf(key), rec.file);
    if (!inside(file)) return null;
    let isFile = false;
    try {
      isFile = statSync(file).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) return null;
    const base = { source: "installed" as const, gateway: knownAgent(key)?.gateway ?? null, fetching: false, version: rec.version };
    if (rec.node) {
      const node = await deps.which("node", env);
      if (node === null) {
        return { ...base, launch: null, cannot: "It was installed to run on Node.js, and this machine has no node on its PATH." };
      }
      return { ...base, launch: { command: node, args: [file, ...rec.args], env: { ...env, ...rec.env } }, cannot: null };
    }
    return { ...base, launch: { command: file, args: [...rec.args], env: { ...env, ...rec.env } }, cannot: null };
  }

  /** WHERE ONE AGENT IS ON THIS MACHINE, asked fresh: its own command on
   *  the `PATH`, then Biom's install of it, then — for an agent run through
   *  an adapter — its CLI and `npx`. Null where it is not here at all. */
  async function find(key: AgentKey, env: Record<string, string>): Promise<Found | null> {
    const known = knownAgent(key);
    if (known !== null) {
      for (const c of known.local) {
        const at = await deps.which(c.command, env);
        if (at !== null) {
          return { source: "path", launch: { command: at, args: [...c.args], env: { ...env, ...c.env } }, cannot: null, gateway: known.gateway, fetching: false, version: null };
        }
      }
    }
    const installed = await fromInstalled(key, env);
    if (installed !== null) return installed;
    if (known?.adapter) {
      const cli = await deps.which(known.adapter.cli, env);
      if (cli !== null) {
        const npx = await deps.which("npx", env);
        if (npx === null) {
          return {
            source: "path",
            launch: null,
            cannot: `${known.name} is here, but its ACP adapter runs on Node.js, and this machine has no npx. Install Node.js, then look again.`,
            gateway: null,
            fetching: false,
            version: null,
          };
        }
        return { source: "path", launch: { command: npx, args: ["--yes", adapterSpec(known), ...known.adapter.args], env: { ...env } }, cannot: null, gateway: null, fetching: true, version: null };
      }
    }
    return null;
  }

  /** LOOK FOR EVERY AGENT BIOM KNOWS, and probe each one found. A slot for an
   *  agent no longer here is dropped, unless something is running for it.
   *  `again`: the list's own half-minute look, which also probes again an
   *  agent still here whose last probe FAILED (O34) — nothing on the screen
   *  asks for that any more, and a failure is often a moment's. An agent
   *  waiting for a sign-in is not: that refusal stands until a sign-in. */
  async function lookAround(again: boolean): Promise<void> {
    const env = await deps.env();
    const keys = [...KNOWN_AGENTS.map((k) => k.key), ...installedKeys().filter((k) => knownAgent(k) === null)];
    const found = await Promise.all(keys.map(async (key) => [key, await find(key, env)] as const));
    let changed = false;
    for (const [key, f] of found) {
      if (f === null) {
        const slot = slots.get(key);
        if (slot !== undefined && !slot.installing && !slot.probeQueued && slot.info.reason !== "checking") {
          slots.delete(key);
          changed = true;
        }
        continue;
      }
      const known = slots.get(key);
      if (known === undefined) {
        const slot = slotFor(key, f.source);
        slot.found = f;
        changed = true;
        queueProbe(slot);
      } else if (again && known.info.reason === "failed" && !known.installing && !known.probeQueued) {
        known.found = f;
        queueProbe(known);
      }
    }
    if (changed) emit();
  }

  /** LOOK NOW, unless a look is already under way — then that one. Two
   *  looks never run at once. `again` is `lookAround`'s. */
  function lookNow(again = false): Promise<void> {
    if (looking !== null) return looking;
    lookedAt = deps.now();
    const run: Promise<void> = track(lookAround(again)).finally(() => {
      if (looking === run) looking = null;
    });
    looking = run;
    return run;
  }

  /** The first look, for whatever needs the agents found before it answers:
   *  a launch. After it, only a look already under way is waited for. */
  function discover(): Promise<void> {
    if (lookedAt === null) return lookNow();
    return looking ?? Promise.resolve();
  }

  /** AN AGENT PUT ON THIS MACHINE SINCE THE LAST LOOK IS FOUND: a list looks
   *  again once the last look is `rediscover` old. What a look finds new is
   *  probed, and so is one it knew whose last probe failed (O34); an Active
   *  agent, one waiting for a sign-in, one being installed or checked is not
   *  looked at again unasked — so however often the list is read, it is one
   *  look per half-minute and at most one probe per agent that arrived or
   *  had failed. */
  function rediscover(): void {
    const stale = lookedAt === null || (looking === null && deps.now() - lookedAt >= t.rediscover);
    if (stale) lookNow(true).catch(() => {});
  }

  /* ── the probe ────────────────────────────────────────────────────── */

  async function gatewayUp(g: Gateway): Promise<boolean> {
    try {
      // The host is the table's constant, never anything the person's
      // configuration or environment says: a Gateway elsewhere is not asked.
      const res = await deps.fetch(`http://${g.host}:${g.port}/`, { signal: AbortSignal.timeout(t.gatewayCheck), redirect: "manual" });
      try {
        await res.body?.cancel();
      } catch {
        // Nothing to drain.
      }
      return true;
    } catch {
      return false;
    }
  }

  /** ONE SESSION, OPENED AND CLOSED: `initialize`, then — only for a sign-in
   *  the person asked for — `authenticate`, then `session/new`, then a short
   *  wait for the commands. Never throws. */
  async function session(launch: AgentLaunch, fetching: boolean, auth: string | null): Promise<Verdict> {
    let conn: AcpConnection;
    try {
      conn = deps.connect(launch, deps.cwd);
    } catch {
      return { state: "inactive", reason: "failed", message: "It could not be started.", version: null, methods: [] };
    }
    live.add(conn);
    let exited: { code: number | null; signal: string | null } | null = null;
    conn.closed.then((e) => {
      exited = e;
    }, () => {
      exited = { code: null, signal: null };
    });
    // Commands may arrive before `session/new` has answered, so they are
    // kept by session until the id is known.
    const commandsBySession = new Map<string, SlashCommand[]>();
    let wake: (() => void) | null = null;
    const off = conn.onNotification((method, params) => {
      if (method !== "session/update") return;
      const u = readUpdate(params);
      if (u === null || u.update.sessionUpdate !== "available_commands_update") return;
      commandsBySession.set(u.sessionId, toSlashCommands(u.update.availableCommands));
      wake?.();
    });
    let methods: AuthMethod[] = [];
    let version: string | null = null;
    let stage = "initialize";
    // A session this probe opened, to delete where the agent offers that —
    // so looking does not leave an empty chat in the person's own history.
    let opened: string | null = null;
    let deletable = false;
    try {
      const init = await bounded(conn.request("initialize", initializeParams(), { timeoutMs: fetching ? t.initializeFetching : t.initialize }), fetching ? t.initializeFetching : t.initialize, "initialize");
      const facts = readInitialize(init);
      methods = readAuthMethods(facts.authMethods);
      version = facts.agentInfo?.version ?? null;
      if (version !== null && version.length > 64) version = version.slice(0, 64);
      deletable = offersDelete(init);
      // A chat refuses an agent answering another major, so the probe does too.
      if (facts.protocolVersion !== ACP_PROTOCOL_VERSION) {
        return { state: "inactive", reason: "failed", message: `It speaks ACP version ${facts.protocolVersion ?? "unknown"}, and Biom speaks ${ACP_PROTOCOL_VERSION}.`, version, methods };
      }
      if (auth !== null) {
        stage = "authenticate";
        await bounded(conn.request("authenticate", { methodId: auth }, { timeoutMs: t.authenticate }), t.authenticate, "authenticate");
      }
      stage = "session/new";
      const answer = await bounded(conn.request("session/new", newSessionParams(deps.cwd), { timeoutMs: t.session }), t.session, "session/new");
      const sess = readSession(answer);
      const id = sess.sessionId;
      if (id === null || id === "") return { state: "inactive", reason: "failed", message: "It answered without opening a session.", version, methods };
      opened = id;
      // The chats' own reading, so the option ids are the ones a chat's session reports.
      const options = toConfigOptions(sess.configOptions, sess.modes).options;
      if (!commandsBySession.has(id)) {
        await Promise.race([
          new Promise<void>((r) => {
            wake = () => {
              if (commandsBySession.has(id)) r();
            };
          }),
          sleep(t.commands),
          conn.closed.then(() => undefined, () => undefined),
        ]);
      }
      return { state: "active", version, methods, options, commands: commandsBySession.get(id) ?? [] };
    } catch (e) {
      if (isAuthRequired(e)) {
        return { state: "inactive", reason: "signin", message: SIGN_IN, version, methods };
      }
      // A sign-in the person asked for that did not finish leaves the agent
      // waiting to be signed in, so another way can be tried.
      if (stage === "authenticate") {
        const why = e instanceof Timeout ? `The sign-in did not finish within ${seconds(t.authenticate)}.` : "The sign-in did not finish.";
        return { state: "inactive", reason: "signin", message: why, version, methods };
      }
      // A request fails the moment the process goes, a beat before the
      // connection says how it went.
      if (!(e instanceof Timeout) && exited === null) await Promise.race([conn.closed.catch(() => null), sleep(100)]);
      return { state: "inactive", reason: "failed", message: failureOf(e, stage, exited, fetching), version, methods };
    } finally {
      off();
      const id = opened;
      const tidy = deletable && id !== null;
      // After the verdict, not before it: the list waits on nothing here.
      track((async () => {
        if (tidy && !closed) {
          await bounded(conn.request("session/delete", { sessionId: id }, { timeoutMs: t.tidy }), t.tidy, "session/delete").catch(() => null);
        }
        live.delete(conn);
        try {
          await conn.close();
        } catch {
          // Already gone.
        }
      })());
    }
  }

  /** What went wrong, in Biom's words: never the agent's. */
  function failureOf(e: unknown, stage: string, exited: { code: number | null; signal: string | null } | null, fetching: boolean): string {
    const starting = stage === "initialize";
    if (e instanceof Timeout) {
      return starting
        ? `It did not answer within ${seconds(fetching ? t.initializeFetching : t.initialize)} of starting.`
        : `It did not open a session within ${seconds(t.session)}.`;
    }
    if (exited !== null) {
      const how = exited.code !== null ? ` (exit code ${exited.code})` : exited.signal !== null ? ` (${exited.signal})` : "";
      return `It stopped${how} before ${starting ? "answering" : "opening a session"}.`;
    }
    if (typeof (e as { code?: unknown }).code === "number") {
      return `It refused to ${starting ? "start" : "open a session"} (error ${(e as { code: number }).code}).`;
    }
    return `It failed before ${starting ? "answering" : "opening a session"}.`;
  }

  function apply(slot: Slot, v: Verdict, afterSignIn: boolean): void {
    slot.methods = v.methods;
    slot.info.auth = v.methods.map(authInfo);
    slot.info.version = v.version ?? slot.found?.version ?? slot.info.version;
    if (v.state === "active") {
      if (afterSignIn) {
        slot.refusedSignIn = false;
      }
      if (slot.refusedSignIn) {
        set(slot, "signin", SIGN_IN);
        return;
      }
      set(slot, null, null);
      slot.info.options = v.options;
      slot.info.commands = v.commands;
      return;
    }
    if (v.reason === "signin") slot.refusedSignIn = true;
    set(slot, v.reason, v.message);
  }

  async function runProbe(slot: Slot, auth: string | null = null): Promise<void> {
    const env = await deps.env();
    const found = await find(slot.key, env);
    if (found === null) {
      if (!slot.installing) {
        slots.delete(slot.key);
        emit();
      }
      return;
    }
    slot.found = found;
    slot.info.source = found.source;
    if (found.version !== null) slot.info.version = found.version;
    set(slot, "checking", null);
    emit();
    if (found.launch === null) {
      set(slot, "failed", found.cannot);
      emit();
      return;
    }
    if (found.gateway !== null && !(await gatewayUp(found.gateway))) {
      set(slot, "gateway", GATEWAY_DOWN);
      emit();
      return;
    }
    const afterSignIn = auth !== null || slot.trust;
    slot.trust = false;
    // An agent that wants `authenticate` in every process is sent it on a
    // look as well, with the method that last signed it in — or a look after
    // a sign-in would find it refusing and put it back to Sign in. That is
    // not a new sign-in, so it does not lift a refusal a chat heard.
    const using = auth ?? everyProcess(slot);
    const verdict = await session(found.launch, found.fetching, using);
    if (closed) return;
    apply(slot, verdict, afterSignIn);
    if (verdict.state === "active") {
      if (auth !== null) slot.signedInWith = auth;
    }
    emit();
    // A SIGN-IN THAT WORKED is news for every other workspace open: the person
    // is signed in, not this folder. Only a sign-in's own look says so — never
    // a look another workspace's news asked for, which is how it stops.
    if (verdict.state === "active" && afterSignIn && slot.info.state === "active") {
      try {
        deps.onSignedIn?.(slot.key, everyProcess(slot));
      } catch (e) {
        console.warn("agents: a sign-in listener threw", e instanceof Error ? e.name : typeof e);
      }
    }
  }

  /* ── the registry ─────────────────────────────────────────────────── */

  function loadCache(): void {
    if (cacheLoaded) return;
    cacheLoaded = true;
    try {
      const raw = JSON.parse(readFileSync(join(home, REGISTRY_CACHE), "utf8")) as { at?: unknown; doc?: unknown };
      if (typeof raw.at === "number") cache = { at: raw.at, entries: parseRegistry(raw.doc) };
    } catch {
      // No cache, or not one this build can read: the network decides.
    }
  }

  async function fetchRegistry(): Promise<unknown> {
    const res = await deps.fetch(REGISTRY_URL, { signal: AbortSignal.timeout(t.registryFetch) });
    if (!res.ok || res.body === null) throw new Error(`the registry answered ${res.status}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    await eachChunk(res.body, (chunk) => {
      size += chunk.length;
      if (size > MAX_REGISTRY) throw new Error("the registry answered more than a registry");
      chunks.push(chunk);
    });
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** THE REGISTRY, fresh within its lifetime; a stale copy where the network
   *  will not answer; and a refusal in words where there is neither. */
  async function readRegistry(): Promise<RegistryEntry[]> {
    loadCache();
    if (cache !== null && deps.now() - cache.at < t.registryTtl) return cache.entries;
    try {
      const doc = await fetchRegistry();
      const entries = parseRegistry(doc);
      cache = { at: deps.now(), entries };
      try {
        mkdirSync(home, { recursive: true, mode: 0o700 });
        writeFileSync(join(home, REGISTRY_CACHE), JSON.stringify({ at: cache.at, doc }));
      } catch {
        // A cache that cannot be written is a fetch next time.
      }
      // Pictures, names and lines the list did not have before.
      let changed = false;
      for (const slot of slots.values()) {
        const entry = entries.find((e) => e.key === slot.key);
        if (entry !== undefined) changed = describe(slot, entry) || changed;
      }
      if (changed) emit();
      return entries;
    } catch {
      if (cache !== null) return cache.entries;
      throw refusal("fetch_failed", "The ACP Registry could not be reached, so its agents cannot be listed.");
    }
  }

  /** What an install plan needs that this machine lacks, in a sentence, or
   *  null where it has everything. */
  async function lacks(plan: InstallPlan, env: Record<string, string>): Promise<string | null> {
    if (plan.via === "npx") {
      const [node, npm] = await Promise.all([deps.which("node", env), deps.which("npm", env)]);
      return node === null || npm === null ? "It installs with npx, which needs Node.js, and this machine has none." : null;
    }
    if (plan.via === "uvx") {
      return (await deps.which("uv", env)) === null ? "It installs with uvx, which needs uv, and this machine has none." : null;
    }
    if (!isHttps(plan.target.archive)) return "Its download is not https, so Biom will not fetch it.";
    if (plan.target.kind === "tar.bz2" && (await deps.which("bzip2", env)) === null) {
      return "Its download is a .tar.bz2, and this machine has no bzip2 to unpack it.";
    }
    return null;
  }

  /* ── installing ───────────────────────────────────────────────────── */

  /** Run one command to its end, bounded; its output goes to the agent's
   *  install log and never to the server's. */
  async function run(cmd: string[], cwd: string, env: Record<string, string>, stdout: string, stderr: string, maxOut: number | null = null): Promise<boolean> {
    const started = deps.processes.start({ cmd, cwd, env, stdout, stderr });
    // A pid of -1 is a command that never started, whose `done` says so; it
    // is never signalled, because -(-1) is somebody else's process.
    const pgid = started.pgid > 0 ? started.pgid : null;
    if (pgid !== null) running.add(pgid);
    // What it writes is watched where that is bounded: a decompressor fed a
    // bomb fills a disk long before it exits.
    let over = false;
    const watch = maxOut === null ? null : setInterval(() => {
      let size = 0;
      try {
        size = statSync(stdout).size;
      } catch {
        size = 0;
      }
      if (size > maxOut && pgid !== null) {
        over = true;
        deps.processes.killNow(pgid);
      }
    }, 250);
    try {
      const done = await Promise.race([started.done, sleep(t.install).then(() => null)]);
      if (done === null) {
        if (pgid !== null) await deps.processes.end(pgid, 2000);
        return false;
      }
      return done.exit === 0 && !over;
    } finally {
      if (watch !== null) clearInterval(watch);
      if (pgid !== null) running.delete(pgid);
    }
  }

  /** Download `url` to `to`, hashing as it arrives. Answers the SHA-256.
   *  HTTPS ALL THE WAY: redirects are followed here rather than by `fetch`,
   *  so every hop is seen, and a url or a hop that is not https is refused
   *  before anything is asked of it. */
  async function download(url: string, to: string): Promise<string> {
    const ctrl = new AbortController();
    let idle = setTimeout(() => ctrl.abort(), t.downloadIdle);
    const whole = setTimeout(() => ctrl.abort(), t.download);
    const fd = openSync(to, "wx", 0o600);
    try {
      let at = url;
      let res: Response | null = null;
      for (let hop = 0; res === null; hop++) {
        if (!isHttps(at)) throw new Said("The download left https, so nothing was installed.");
        if (hop > MAX_REDIRECTS) throw new Said("The download was redirected too many times, so nothing was installed.");
        const answer = await deps.fetch(at, { signal: ctrl.signal, redirect: "manual" });
        const next = answer.status >= 300 && answer.status < 400 ? answer.headers.get("location") : null;
        if (next === null) {
          res = answer;
          break;
        }
        await answer.body?.cancel().catch(() => null);
        try {
          at = new URL(next, at).toString();
        } catch {
          throw new Said("The download was redirected somewhere that is not an address, so nothing was installed.");
        }
      }
      if (!res.ok || res.body === null) throw new Said(`The download failed (HTTP ${res.status}), so nothing was installed.`);
      const said = Number(res.headers.get("content-length") ?? "0");
      if (said > MAX_DOWNLOAD) throw new Said("The download is larger than an agent's release would be, so nothing was installed.");
      const hash = createHash("sha256");
      let size = 0;
      await eachChunk(res.body, (chunk) => {
        clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(), t.downloadIdle);
        size += chunk.length;
        if (size > MAX_DOWNLOAD) throw new Said("The download is larger than an agent's release would be, so nothing was installed.");
        hash.update(chunk);
        let at = 0;
        while (at < chunk.length) at += writeSync(fd, chunk, at, chunk.length - at);
      });
      return hash.digest("hex");
    } catch (e) {
      if (e instanceof Said) throw e;
      throw new Said(ctrl.signal.aborted ? "The download stalled, so nothing was installed." : "The download failed, so nothing was installed.");
    } finally {
      clearTimeout(idle);
      clearTimeout(whole);
      closeSync(fd);
    }
  }

  /** Make every folder from `root` down to `rel`, refusing one that is not a
   *  real folder — a link above an entry would carry the write elsewhere. */
  function realDirs(root: string, rel: string, known: Set<string>): void {
    if (rel === "" || known.has(rel)) return;
    let at = "";
    for (const seg of rel.split("/")) {
      at = at === "" ? seg : `${at}/${seg}`;
      if (known.has(at)) continue;
      const abs = join(root, at);
      let st: ReturnType<typeof lstatSync> | null = null;
      try {
        st = lstatSync(abs);
      } catch {
        st = null;
      }
      if (st === null) mkdirSync(abs, { mode: 0o755 });
      else if (!st.isDirectory() || st.isSymbolicLink()) throw new ArchiveError("the archive puts a file beneath something that is not a folder, so nothing was unpacked");
      known.add(at);
    }
  }

  /** UNPACK a judged archive into `root`, which exists and is empty: folders
   *  and files first, hard links as copies, symbolic links LAST, and then
   *  every link's real path checked to lie inside `root`. */
  function unpack(file: string, kind: "tar" | "zip", root: string): void {
    const fd = openSync(file, "r");
    try {
      const size = statSync(file).size;
      const read = (offset: number, length: number): Uint8Array => {
        const buf = new Uint8Array(length);
        let got = 0;
        while (got < length) {
          const n = readSync(fd, buf, got, length - got, offset + got);
          if (n <= 0) break;
          got += n;
        }
        if (got < length) throw new ArchiveError("the archive ends in the middle of an entry, so nothing was unpacked");
        return buf;
      };
      const entries: Entry[] = judge(kind === "tar" ? tarEntries(read, size) : zipEntries(read, size));
      const dirs = new Set<string>();
      const parent = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
      for (const e of entries) {
        if (e.type === "dir") realDirs(root, e.path, dirs);
      }
      for (const e of entries) {
        if (e.type !== "file") continue;
        realDirs(root, parent(e.path), dirs);
        const mode = (e.mode & 0o755) || 0o644;
        const out = openSync(join(root, e.path), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, mode);
        try {
          if (kind === "zip") {
            const bytes = zipData(read, size, e, 2 * 1024 * 1024 * 1024);
            let at = 0;
            while (at < bytes.length) at += writeSync(out, bytes, at, bytes.length - at);
          } else {
            const chunk = 1024 * 1024;
            for (let done = 0; done < e.size; done += chunk) {
              const piece = read(e.offset + done, Math.min(chunk, e.size - done));
              let at = 0;
              while (at < piece.length) at += writeSync(out, piece, at, piece.length - at);
            }
          }
        } finally {
          closeSync(out);
        }
        chmodSync(join(root, e.path), mode);
      }
      for (const e of entries) {
        if (e.type !== "hardlink" || e.target === null) continue;
        realDirs(root, parent(e.path), dirs);
        copyFileSync(join(root, safeRelPath(e.target) as string), join(root, e.path), fsConstants.COPYFILE_EXCL);
      }
      const links = entries.filter((e) => e.type === "symlink");
      for (const e of links) {
        realDirs(root, parent(e.path), dirs);
        try {
          symlinkSync(e.target as string, join(root, e.path));
        } catch {
          throw new ArchiveError("the archive holds a link this machine would not let Biom make, so nothing was unpacked");
        }
      }
      const real = realpathSync(root);
      for (const e of links) {
        let to: string;
        try {
          to = realpathSync(join(root, e.path));
        } catch {
          throw new ArchiveError("the archive holds a link to nothing, so nothing was unpacked");
        }
        if (to !== real && !to.startsWith(real + sep)) {
          throw new ArchiveError("the archive holds a link that points outside itself, so nothing was unpacked");
        }
      }
    } finally {
      closeSync(fd);
    }
  }

  /** The file a JavaScript package's bin runs, and whether `node` runs it. */
  function binOf(prefix: string, name: string): { file: string; node: boolean } | null {
    const pkgDir = join(prefix, "node_modules", ...name.split("/"));
    let pkg: { bin?: unknown };
    try {
      pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { bin?: unknown };
    } catch {
      return null;
    }
    let rel: string | null = null;
    const short = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
    if (typeof pkg.bin === "string") rel = pkg.bin;
    else if (typeof pkg.bin === "object" && pkg.bin !== null) {
      const bins = pkg.bin as Record<string, unknown>;
      const keys = Object.keys(bins).filter((k) => typeof bins[k] === "string").sort();
      const pick = keys.includes(short) ? short : keys[0];
      rel = pick === undefined ? null : (bins[pick] as string);
    }
    const safe = rel === null ? null : safeRelPath(rel);
    if (safe === null || safe === "") return null;
    const file = join(pkgDir, safe);
    if (!existsSync(file)) return null;
    let node = /\.(c|m)?js$/.test(file);
    if (!node) {
      try {
        const head = readFileSync(file).subarray(0, 128).toString("latin1");
        node = head.startsWith("#!") && head.split("\n")[0]?.includes("node") === true;
      } catch {
        node = false;
      }
    }
    return { file, node };
  }

  /** Every download recorded for this agent, by version — read from the
   *  record discovery reads, and nothing believed that is not a version and a
   *  SHA-256. */
  function downloadsOf(key: AgentKey): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      const raw = JSON.parse(readFileSync(join(folderOf(key), MANIFEST), "utf8")) as { downloads?: unknown };
      if (typeof raw.downloads === "object" && raw.downloads !== null) {
        for (const [v, sum] of Object.entries(raw.downloads as Record<string, unknown>)) {
          if (VERSION.test(v) && typeof sum === "string" && /^[0-9a-f]{64}$/.test(sum)) out[v] = sum;
        }
      }
    } catch {
      // No record, or none this build can read: every version is a first use.
    }
    return out;
  }

  /** One line in the agent's install log: the record a person can read. */
  function note(key: AgentKey, line: string): void {
    try {
      appendFileSync(join(folderOf(key), "install.log"), `${new Date(deps.now()).toISOString()} ${line}\n`, { mode: 0o600 });
    } catch {
      // The log is the record, not the gate: the recorded hash is in the manifest.
    }
  }

  /** Write the record discovery reads, keeping every download recorded before. */
  function writeManifest(rec: Installed): void {
    const at = join(folderOf(rec.key), MANIFEST);
    const full: Installed = { ...rec, downloads: { ...downloadsOf(rec.key), ...rec.downloads } };
    const tmp = `${at}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(full, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, at);
  }

  const rel = (key: AgentKey, abs: string): string => resolve(abs).slice(folderOf(key).length + 1).split(sep).join("/");

  async function installBinary(entry: RegistryEntry, target: Extract<InstallPlan, { via: "binary" }>["target"], env: Record<string, string>): Promise<Installed> {
    const folder = folderOf(entry.key);
    const stage = join(folder, `.part-${randomBytes(8).toString("hex")}`);
    const final = join(folder, entry.version);
    const log = join(folder, "install.log");
    mkdirSync(stage, { recursive: true });
    try {
      const archive = join(stage, "download");
      const sum = await download(target.archive, archive);
      // THE REGISTRY'S CHECKSUM, where it lists one, is the only one that
      // counts; where it lists none, the first download of a version is
      // recorded and every later one of that version must be the same bytes.
      if (target.sha256 !== null) {
        if (sum !== target.sha256) {
          throw new Said("The download did not match the checksum the ACP Registry lists for it, so nothing was installed.");
        }
      }
      const recorded = target.sha256 === null ? downloadsOf(entry.key)[entry.version] : undefined;
      if (recorded !== undefined && recorded !== sum) {
        throw new Said(`The download for ${entry.name} ${entry.version} is not the file Biom installed for that version before, so nothing was installed.`);
      }
      const root = join(stage, "root");
      mkdirSync(root);
      if (target.kind === "raw") {
        const to = join(root, target.cmd);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(archive, to, fsConstants.COPYFILE_EXCL);
      } else if (target.kind === "zip" || target.kind === "tar") {
        unpack(archive, target.kind, root);
      } else {
        const tar = join(stage, "payload.tar");
        if (target.kind === "tar.gz") {
          let seen = 0;
          const cap = new Transform({
            transform(chunk: Buffer, _enc, done) {
              seen += chunk.length;
              if (seen > MAX_TAR) done(new Said("The download unpacks to more than an agent's release would, so nothing was installed."));
              else done(null, chunk);
            },
          });
          try {
            await pipeline(createReadStream(archive), createGunzip(), cap, createWriteStream(tar, { flags: "wx", mode: 0o600 }));
          } catch (e) {
            throw e instanceof Said ? e : new Said("The download would not decompress, so nothing was installed.");
          }
        } else {
          const bzip2 = await deps.which("bzip2", env);
          if (bzip2 === null) throw new Said("Its download is a .tar.bz2, and this machine has no bzip2 to unpack it.");
          if (!(await run([bzip2, "-dc", archive], stage, env, tar, log, MAX_TAR))) throw new Said("The download would not decompress, so nothing was installed.");
        }
        unpack(tar, "tar", root);
      }
      const cmd = join(root, target.cmd);
      let isFile = false;
      try {
        isFile = statSync(cmd).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) throw new Said("The download does not hold the command the ACP Registry names, so nothing was installed.");
      chmodSync(cmd, (statSync(cmd).mode & 0o777) | 0o755);
      rmSync(final, { recursive: true, force: true });
      renameSync(root, final);
      // Said once it is installed, so the log never records a file that was not.
      if (target.sha256 === null) {
        note(entry.key, recorded === undefined
          ? `${entry.version}: the registry lists no checksum for this download; recorded ${sum} on first install`
          : `${entry.version}: the registry lists no checksum for this download; it matches ${sum}, recorded on first install`);
      }
      return { key: entry.key, version: entry.version, via: "binary", file: `${entry.version}/${target.cmd}`, node: false, args: target.args, env: target.env, downloads: { [entry.version]: sum } };
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  async function installPackage(entry: RegistryEntry, via: "npx" | "uvx", dist: PackageDist, env: Record<string, string>): Promise<Installed> {
    const folder = folderOf(entry.key);
    const final = join(folder, entry.version);
    const log = join(folder, "install.log");
    // Straight into its folder: a Python environment carries its own path in
    // every script, so it cannot be built somewhere and moved.
    rmSync(final, { recursive: true, force: true });
    mkdirSync(final, { recursive: true });
    try {
      if (via === "npx") {
        const npm = await deps.which("npm", env);
        if (npm === null) throw new Said("It installs with npx, which needs Node.js, and this machine has none.");
        const ok = await run([npm, "install", "--prefix", final, "--no-audit", "--no-fund", "--no-update-notifier", "--loglevel=error", "--", dist.spec], final, env, log, log);
        if (!ok) throw new Said("The npm install failed; what npm said is in Biom's install log for it.");
        const bin = binOf(final, dist.name);
        if (bin === null) throw new Said("It installed, but it names no command Biom can run.");
        return { key: entry.key, version: entry.version, via, file: rel(entry.key, bin.file), node: bin.node, args: dist.args, env: dist.env };
      }
      const uv = await deps.which("uv", env);
      if (uv === null) throw new Said("It installs with uvx, which needs uv, and this machine has none.");
      const bin = join(final, "bin");
      const ok = await run([uv, "tool", "install", "--", uvSpec(dist)], final, { ...env, UV_TOOL_DIR: join(final, "tools"), UV_TOOL_BIN_DIR: bin }, log, log);
      if (!ok) throw new Said("The uv install failed; what uv said is in Biom's install log for it.");
      const exe = platform === "win32" ? `${dist.name}.exe` : dist.name;
      let file = join(bin, exe);
      if (!existsSync(file)) {
        let names: string[] = [];
        try {
          names = readdirSync(bin);
        } catch {
          names = [];
        }
        if (names.length !== 1) throw new Said("It installed, but it names no command Biom can run.");
        file = join(bin, names[0] as string);
      }
      return { key: entry.key, version: entry.version, via, file: rel(entry.key, file), node: false, args: dist.args, env: dist.env };
    } catch (e) {
      rmSync(final, { recursive: true, force: true });
      throw e;
    }
  }

  /** THE LOCK ON ONE AGENT AND VERSION'S INSTALL, a file made with O_EXCL in
   *  the folder every workspace shares — never a lock in this process, which
   *  another workspace's server cannot see. Its holder touches it while it
   *  works; one nobody has touched for `installLockStale` was left by a server
   *  that stopped mid-install and is taken over. Waiting is bounded by the
   *  longest one install can take, and says so on the agent meanwhile.
   *  `waited`: another workspace held it first. */
  async function lockInstall(slot: Slot, path: string): Promise<{ waited: boolean; release: () => void }> {
    const until = Date.now() + t.download + t.install + t.installLockStale;
    let waited = false;
    for (;;) {
      if (closed) throw new Said("Biom is stopping.");
      let token: string | null = null;
      try {
        const fd = openSync(path, "wx", 0o600);
        token = randomBytes(8).toString("hex");
        try {
          writeSync(fd, `${JSON.stringify({ pid: process.pid, token })}\n`);
        } finally {
          closeSync(fd);
        }
      } catch (e) {
        if ((e as { code?: unknown }).code !== "EEXIST") throw e;
      }
      if (token !== null) {
        const beat = setInterval(() => {
          try {
            const at = new Date();
            utimesSync(path, at, at);
          } catch {
            // Taken over or gone: nothing to keep alive.
          }
        }, t.installLockBeat);
        (beat as { unref?: () => void }).unref?.();
        const mine = token;
        return {
          waited,
          release: () => {
            clearInterval(beat);
            try {
              // Only its own: a lock taken over after this one went stale is
              // the new holder's.
              if (readFileSync(path, "utf8").includes(mine)) rmSync(path, { force: true });
            } catch {
              // Gone already.
            }
          },
        };
      }
      let held: { mtimeMs: number; text: string } | null = null;
      try {
        held = { mtimeMs: statSync(path).mtimeMs, text: readFileSync(path, "utf8") };
      } catch {
        held = null;
      }
      if (held === null) continue;
      if (Date.now() - held.mtimeMs > t.installLockStale) {
        // Left by a server that stopped: taken over, unless somebody else
        // did that first.
        try {
          if (readFileSync(path, "utf8") === held.text) rmSync(path, { force: true });
        } catch {
          // Gone already.
        }
        continue;
      }
      if (!waited) {
        waited = true;
        slot.info.message = "It is being installed in another workspace.";
        emit();
      }
      if (Date.now() > until) throw new Said("It is being installed in another workspace, and that has not finished.");
      await sleep(t.installLockPoll);
    }
  }

  async function runInstall(slot: Slot): Promise<void> {
    // A probe that ran ahead of this in the queue may have said something
    // else since `install` answered.
    set(slot, "installing", "Installing from the ACP Registry.");
    emit();
    try {
      const entries = await readRegistry();
      const entry = entries.find((e) => e.key === slot.key);
      if (entry === undefined) throw new Said("The ACP Registry does not list it.");
      describe(slot, entry);
      const plans = installPlans(entry, plat);
      if (plans.length === 0) throw new Said(sentence(noPlanReason(entry)));
      const env = await deps.env();
      let plan: InstallPlan | null = null;
      let need: string | null = null;
      for (const p of plans) {
        const lack = await lacks(p, env);
        if (lack === null) {
          plan = p;
          break;
        }
        need ??= lack;
      }
      if (plan === null) throw new Said(need ?? "This machine cannot install it.");
      slot.info.message = `Installing ${entry.version} from the ACP Registry.`;
      emit();
      const folder = folderOf(slot.key);
      if (!inside(folder)) throw new Said("It cannot be installed under that name.");
      // Private: what npm, uv or a Gateway print into their logs is the person's.
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      // ONE INSTALL OF AN AGENT AND VERSION AT A TIME, ACROSS EVERY WORKSPACE
      // open on this machine (O29): they share this folder, and an install
      // deletes and rebuilds its version's tree — under another workspace's
      // npm, or under an agent already running from it.
      const lock = await lockInstall(slot, join(folder, `.install-${entry.version}.lock`));
      try {
        // What a server that stopped in the middle of an install left behind —
        // old enough that it is not another workspace's install in flight.
        for (const name of readdirSync(folder)) {
          if (!name.startsWith(".part-")) continue;
          try {
            if (lstatSync(join(folder, name)).mtimeMs < Date.now() - STALE_PART) rmSync(join(folder, name), { recursive: true, force: true });
          } catch {
            // Gone already.
          }
        }
        // Installed by the workspace this one waited on: used as it stands,
        // not rebuilt under an agent that workspace may be running from it.
        const theirs = lock.waited ? await fromInstalled(slot.key, env) : null;
        if (theirs === null || theirs.version !== entry.version) {
          if (lock.waited) {
            slot.info.message = `Installing ${entry.version} from the ACP Registry.`;
            emit();
          }
          const rec = plan.via === "binary"
            ? await installBinary(entry, plan.target, env)
            : await installPackage(entry, plan.via, plan.dist, env);
          writeManifest(rec);
        }
      } finally {
        lock.release();
      }
      slot.installing = false;
      await runProbe(slot);
    } catch (e) {
      slot.installing = false;
      if (closed) return;
      // Only this module's own sentences are shown; anything else is a fault
      // of the machine's — a disk, a permission — said without its detail and
      // logged with it, since it names no secret of the person's.
      const own = e instanceof Said || e instanceof ArchiveError || (e as { code?: unknown }).code === "fetch_failed";
      if (!own) console.warn(`agents: installing ${slot.key} failed:`, e instanceof Error ? e.message : String(e));
      set(slot, "failed", own ? sentence((e as Error).message) : "It could not be installed.");
      emit();
    }
  }

  /* ── the answer ───────────────────────────────────────────────────── */

  const known = (key: AgentKey): Slot => {
    if (typeof key !== "string" || !AGENT_KEY.test(key)) throw refusal("bad_request", "That is not an agent's name.");
    const slot = slots.get(key);
    if (slot === undefined) throw refusal("not_found", "No agent by that name is on this machine.");
    return slot;
  };

  /** Forget what has run out, and keep each map to a handful — every pop-up
   *  anybody has open — dropping the oldest. */
  function prune(): void {
    const now = deps.now();
    for (const [k, v] of tickets) if (v.expires <= now) tickets.delete(k);
    for (const [k, v] of redeemed) if (v.until <= now) redeemed.delete(k);
    for (const m of [tickets, redeemed] as Map<string, unknown>[]) {
      while (m.size > 16) {
        const oldest = m.keys().next().value;
        if (oldest === undefined) break;
        m.delete(oldest);
      }
    }
  }

  function mint(): string {
    prune();
    return randomBytes(24).toString("base64url");
  }

  return {
    list() {
      rediscover();
      return snapshot();
    },

    probe(key) {
      if (typeof key !== "string" || !AGENT_KEY.test(key)) throw refusal("bad_request", "That is not an agent's name.");
      let slot = slots.get(key);
      if (slot === undefined) {
        // Perhaps it arrived since Biom last looked: a known agent, or one
        // Biom installed, gets a look; anything else is not this machine's.
        if (knownAgent(key) === null && readInstalled(key) === null) throw refusal("not_found", "No agent by that name is on this machine.");
        slot = slotFor(key, "path");
      }
      // An install probes what it installed when it lands.
      if (slot.installing) return structuredClone(slot.info);
      // AN AGENT THAT OFFERS NO WAY TO SIGN IN — no method to press, no
      // variable to set — cannot be signed in by Biom: the person does it in a
      // terminal of their own and asks for this look, so it is believed
      // (O35). Only for such an agent: one that offers a way may open a
      // session while signed out, and its refusal stays until a sign-in.
      if (slot.refusedSignIn && slot.methods.length === 0) slot.refusedSignIn = false;
      set(slot, "checking", null);
      emit();
      queueProbe(slot);
      return structuredClone(slot.info);
    },

    start(key) {
      const slot = known(key);
      const gateway = slot.found?.gateway ?? knownAgent(key)?.gateway ?? null;
      if (gateway === null) throw refusal("bad_request", "That agent has no Gateway to start.");
      set(slot, "checking", null);
      emit();
      queue(slot, "starting the Gateway of", async () => {
        if (!(await gatewayUp(gateway))) {
          const env = await deps.env();
          const command = slot.found?.launch?.command ?? null;
          if (command === null) {
            set(slot, "failed", slot.found?.cannot ?? "It cannot be started.");
            emit();
            return;
          }
          const folder = folderOf(key);
          mkdirSync(folder, { recursive: true, mode: 0o700 });
          const log = join(folder, "gateway.log");
          // The Gateway is the person's service and outlives this server: the
          // runner starts it in a group of its own and lets it go.
          deps.processes.start({ cmd: [command, ...gateway.start], cwd: folder, env, stdout: log, stderr: log });
          const until = deps.now() + t.gatewayWait;
          let up = false;
          while (!up && !closed && deps.now() < until) {
            await sleep(t.gatewayPoll);
            up = await gatewayUp(gateway);
          }
          if (!up) {
            set(slot, "gateway", "OpenClaw's Gateway did not start on this machine.");
            emit();
            return;
          }
        }
        await runProbe(slot);
      });
      return structuredClone(slot.info);
    },

    async registry() {
      const entries = await readRegistry();
      // Look again: an agent installed outside Biom since the last look is
      // here now, and the list learns it too.
      await lookNow();
      const env = await deps.env();
      const out: RegistryAgent[] = [];
      for (const e of entries) {
        const plans = installPlans(e, plat);
        let needs: string | null = null;
        if (plans.length === 0) {
          needs = sentence(noPlanReason(e));
        } else {
          let first: string | null = null;
          let any = false;
          for (const p of plans) {
            const lack = await lacks(p, env);
            if (lack === null) {
              any = true;
              break;
            }
            first ??= lack;
          }
          needs = any ? null : first;
        }
        const via = plans[0]?.via ?? (e.npx !== null ? "npx" : e.uvx !== null ? "uvx" : "binary");
        out.push({ key: e.key, name: e.name, line: e.line, version: e.version, icon: e.icon, via, here: (slots.get(e.key)?.found ?? null) !== null, needs });
      }
      return out;
    },

    install(key) {
      if (typeof key !== "string" || !AGENT_KEY.test(key)) throw refusal("bad_request", "That is not an agent's name.");
      const slot = slotFor(key, "installed");
      if (slot.installing) return structuredClone(slot.info);
      slot.installing = true;
      slot.info.source = "installed";
      set(slot, "installing", "Installing from the ACP Registry.");
      emit();
      queue(slot, "installing", () => runInstall(slot));
      return structuredClone(slot.info);
    },

    async signIn(key, methodId) {
      const slot = known(key);
      if (slot.info.reason !== "signin") throw refusal("bad_request", `${slot.info.name} is not waiting to be signed in.`);
      const method = slot.methods.find((m) => m.id === methodId);
      if (method === undefined) throw refusal("not_found", `${slot.info.name} offers no sign-in by that name.`);
      if (method.type === "env_var") {
        throw refusal("bad_request", `That sign-in is a key you set in your own environment, which Biom never holds: ${method.vars.join(", ")}.`);
      }
      const launch = slot.found?.launch ?? null;
      if (launch === null) throw refusal("bad_request", `${slot.info.name} cannot be started, so it cannot be signed in.`);
      if (method.type === "terminal") {
        const run = terminalCommand(method, launch);
        if (run === null) throw refusal("bad_request", `${slot.info.name} offers no command for that sign-in.`);
        const ticket = mint();
        tickets.set(ticket, {
          launch: { agent: key, command: run.command, args: run.args, env: { ...launch.env, ...run.env } },
          expires: deps.now() + t.ticket,
        });
        return { kind: "terminal", ticket, command: run.command, args: [...run.args], env: { ...run.env } };
      }
      set(slot, "checking", null);
      emit();
      queue(slot, "signing in", () => runProbe(slot, method.id));
      return { kind: "agent" };
    },

    redeem(ticket) {
      if (typeof ticket !== "string" || !OPAQUE_ID.test(ticket)) return null;
      const held = tickets.get(ticket);
      tickets.delete(ticket);
      if (held === undefined || held.expires <= deps.now()) return null;
      redeemed.set(ticket, { agent: held.launch.agent, until: deps.now() + t.signInRun });
      prune();
      return { ...held.launch, args: [...held.launch.args], env: { ...held.launch.env } };
    },

    signedIn(ticket) {
      if (typeof ticket !== "string" || !OPAQUE_ID.test(ticket)) return;
      const run = redeemed.get(ticket);
      redeemed.delete(ticket);
      if (run === undefined || run.until <= deps.now() || closed) return;
      const slot = slots.get(run.agent);
      if (slot === undefined) return;
      // The person signed in, or tried: the next session is believed.
      slot.trust = true;
      set(slot, "checking", null);
      emit();
      queueProbe(slot);
    },

    async launch(key) {
      if (typeof key !== "string" || !AGENT_KEY.test(key)) return null;
      await discover();
      const env = await deps.env();
      const found = await find(key, env);
      if (found === null || found.launch === null) return null;
      if (found.gateway !== null && !(await gatewayUp(found.gateway))) return null;
      return { command: found.launch.command, args: [...found.launch.args], env: { ...found.launch.env } };
    },

    refused(key) {
      const slot = slots.get(key);
      if (slot === undefined) return;
      slot.refusedSignIn = true;
      slot.trust = false;
      set(slot, "signin", SIGN_IN);
      emit();
      // Refused before any probe listed its ways to sign in: look, so the
      // pop-up has them. The refusal stands whatever the look says.
      if (slot.methods.length === 0) queueProbe(slot);
    },

    signedInWith(key) {
      const slot = slots.get(key);
      return slot === undefined ? null : everyProcess(slot);
    },

    signedInElsewhere(key, method = null) {
      if (closed || typeof key !== "string") return;
      const slot = slots.get(key);
      // Not found here yet: the first look will find it signed in.
      if (slot === undefined) return;
      slot.refusedSignIn = false;
      if (typeof method === "string" && method !== "" && AUTH_EVERY_PROCESS.has(key)) slot.signedInWith = method;
      // Already Active here, or being installed — whose landing looks anyway.
      if (slot.installing || slot.info.state === "active") return;
      set(slot, "checking", null);
      emit();
      queueProbe(slot);
    },

    on(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async settled() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },

    killAll() {
      closed = true;
      // KILL, now: an exit handler runs no timer again, so TERM and a grace
      // would never reach their KILL.
      for (const conn of live) {
        try {
          conn.kill();
        } catch {
          // Already gone.
        }
      }
      live.clear();
      for (const pgid of running) deps.processes.killNow(pgid);
      running.clear();
    },
  };
}
