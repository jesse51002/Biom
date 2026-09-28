// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — ONE ACP CONNECTION: JSON-RPC 2.0, one message per line, over an
// agent process's stdin and stdout. Raw capability, no vocabulary: it knows no
// chat, no vault and no agent by name, and no ACP method but the one it must
// answer itself — a request nobody handles. What the methods MEAN — the
// handshake's parameters, a session update's shapes — is `acp-wire.ts`, beside
// this file; what a chat does with them is `server/workspace/chats.ts`.
//
// FRAMING. Bytes arrive in chunks that respect nothing: a chunk may end inside
// a line, inside a UTF-8 sequence, or hold several lines at once. The reader
// decodes with a streaming decoder, keeps the unfinished tail as a list of
// pieces — joined once, when its newline comes, so a long line costs one join
// and not one per chunk — drops a trailing CR and a blank line, and ignores a
// line that is not a JSON object: an agent that prints a banner on stdout is
// careless, not hostile. A line longer than `maxLine` is neither: the
// connection fails, the process is ended, and every pending request is
// rejected, because the alternative is holding however much a runaway process
// cares to write.
//
// EVERY REQUEST SETTLES. A request is answered, times out on its own deadline
// where it named one, or is rejected with `ACP_CLOSED` when the connection
// ends — stdout reaching its end, the process exiting, `close()` — and that
// one error rejects every request still pending. There is no deadline on a
// turn: `session/prompt` can legitimately run for hours, so it names none. A
// request FROM the agent to a method nobody registered is answered -32601
// rather than left hanging, since an agent waiting on it would wait for ever.
//
// STDERR IS A DIAGNOSTIC, NEVER A MESSAGE. It is kept as a bounded tail for a
// person reading the server's log and is never relayed to a client: it is
// wherever an agent prints a token, a path or a stack.
//
// THE PROCESS. The spawner is injected, so a test hands the connection a
// process in memory. The real one starts the agent as the leader of a group of
// its own (`detached`, as `process.ts` does it), and ending it walks the
// process table for every descendant and group first — as `pty.ts` does —
// because an agent runs its tools as children, some in groups of their own,
// and a signal to one pid would orphan them. TERM, a grace, then KILL; and
// `kill()` is the same KILL at once, for an exit handler that runs no timer
// again. The walk is `pty.ts`'s own, `parsePs` and `treeOf`.
//
// ACP'S OWN MESSAGE TYPES LIVE BESIDE THIS FILE AND NOT IN `contracts/`: they
// are the protocol's, the server is the only side that speaks it, and what
// reaches the client is Biom's own `ChatUpdate`.

import { spawn as spawnChild, spawnSync } from "node:child_process";

import type { AgentLaunch } from "../../contracts/types.ts";
import { parsePs, treeOf } from "./pty.ts";

/* ── errors ───────────────────────────────────────────────────────────── */

/** A JSON-RPC error, as either side sends one. `code` is JSON-RPC's own —
 *  -32601 for a method nobody handles — or ACP's, `-32000` being the agent's
 *  *authentication required* — or one of this module's two below, which sit
 *  outside JSON-RPC's reserved range so no agent's own code is mistaken for
 *  them. */
export interface AcpError extends Error {
  code: number;
  data?: unknown;
}

export const INVALID_PARAMS = -32602;
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;
/** ACP: *authentication required*. A session or a first message refused with
 *  it is the one moment Biom asks the person to sign in. */
export const AUTH_REQUIRED = -32000;
/** ACP: *resource not found* — a file the agent asked to read is not there. */
export const RESOURCE_NOT_FOUND = -32002;
/** Biom's: the connection ended before this request was answered. The ONE
 *  error every pending request is rejected with, however it ended. */
export const ACP_CLOSED = -33000;
/** Biom's: the request's own deadline passed with no answer. */
export const ACP_TIMEOUT = -33001;

/** The one concrete `AcpError`. */
export class AcpRpcError extends Error implements AcpError {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "AcpRpcError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** Is this an error carrying a JSON-RPC code — ours, or one an agent sent? */
export function isAcpError(e: unknown): e is AcpError {
  return e instanceof Error && typeof (e as { code?: unknown }).code === "number";
}

/** The agent refused for want of a sign-in. */
export function isAuthRequired(e: unknown): boolean {
  return isAcpError(e) && e.code === AUTH_REQUIRED;
}

/** The connection ended under the request. */
export function isClosed(e: unknown): boolean {
  return isAcpError(e) && e.code === ACP_CLOSED;
}

/* ── the connection ───────────────────────────────────────────────────── */

/** How a connection ended: the process's exit code or signal. */
export interface AcpExit {
  code: number | null;
  signal: string | null;
}

/** ONE LIVE CONNECTION TO ONE AGENT PROCESS. */
export interface AcpConnection {
  /** Send a request and settle with its result, or reject with an `AcpError`
   *  — and reject when the connection ends first. */
  request(method: string, params: unknown, opts?: { timeoutMs?: number }): Promise<unknown>;
  /** Send a notification: `session/cancel`, and nothing waits for it. */
  notify(method: string, params: unknown): void;
  /** Answer the agent's requests to one method — `session/request_permission`,
   *  `fs/read_text_file`, `fs/write_text_file`. One handler per method; one
   *  that throws answers the agent an error, with the thrown `code` where it
   *  carries one and -32603 where it does not. */
  handle(method: string, fn: (params: unknown) => Promise<unknown>): void;
  /** Hear the agent's notifications — `session/update`. Answers the
   *  unsubscribe. */
  onNotification(fn: (method: string, params: unknown) => void): () => void;
  /** The tail of what the agent wrote to stderr, bounded, for a diagnostic a
   *  person running the server reads. Never relayed to a client. */
  stderr(): string;
  /** End it: the process tree TERM, a grace, then KILL. Every pending request
   *  is rejected at once; settles when the process is gone. */
  close(): Promise<AcpExit>;
  /** KILL the process tree now and wait for nothing — for the server's exit
   *  handler, which runs no timer again. */
  kill(): void;
  /** Settles when the process has gone, however it went. Never rejects. */
  readonly closed: Promise<AcpExit>;
}

/** ONE AGENT PROCESS, as the connection needs it — the real one from
 *  `spawnAgent`, or one in memory in a test. */
export interface AcpProcess {
  /** Null where it never started. */
  readonly pid: number | null;
  /** To its stdin. Dropped once the pipe is closed. */
  write(text: string): void;
  /** Close its stdin: a well-behaved agent exits on end of input. */
  endInput(): void;
  /** Its stdout, chunk by chunk, and `null` once, at the end. */
  onStdout(fn: (chunk: Uint8Array | null) => void): void;
  onStderr(fn: (chunk: Uint8Array) => void): void;
  /** Settles when the process has gone and its stdout has been read — or a
   *  short grace after the exit, where something it started still holds the
   *  pipe. `error` is why it never started, where it did not. */
  readonly exited: Promise<AcpExit & { error?: string }>;
  /** TERM the whole tree. */
  terminate(): void;
  /** KILL the whole tree. */
  kill(): void;
}

/** What starts the process — injected, so a test can hand a connection a
 *  scripted agent without a real one on the machine. The launch is resolved
 *  by the agents module; the chats module adds the folder it runs in. */
export type AcpSpawner = (launch: AgentLaunch, cwd: string) => AcpProcess;

export interface AcpOptions {
  /** The longest line the agent may write, in characters. */
  maxLine?: number;
  /** How much of stderr's tail is kept, in characters. */
  stderrTail?: number;
  /** Between TERM and KILL on `close()`. */
  graceMs?: number;
  /** Where a diagnostic line goes — the server's log. Never a client. */
  log?: (line: string) => void;
}

/** THE LONGEST LINE AN AGENT MAY WRITE, in characters: above the largest
 *  message a handler over this connection is built to take, so a request too
 *  large is refused in words by its handler and never by ending the agent.
 *  The largest is a whole file in one `fs/write_text_file` — the chats take
 *  up to 32 Mi characters (`FILE_MAX` in `chats.ts`) — which JSON may escape
 *  to six characters each (`\u0001`), with a mebibyte for its envelope and
 *  path; an ordinary text file's whole diff in one `tool_call_update` fits
 *  too. Still a bound: a process printing without a newline is ended here,
 *  not left to take the server's memory. */
export const MAX_LINE = 6 * 32 * 1024 * 1024 + 1024 * 1024;
const STDERR_TAIL = 16 * 1024;
const GRACE_MS = 2000;
const KILL_WAIT_MS = 2000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Pending = {
  method: string;
  resolve: (v: unknown) => void;
  reject: (e: AcpError) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type Json = Record<string, unknown>;

/** Start an agent and speak ACP to it. Never throws: an agent that cannot be
 *  started is a connection already closed, whose every request rejects with
 *  `ACP_CLOSED` and whose `closed` has settled. */
export function connectAcp(launch: AgentLaunch, cwd: string, spawner: AcpSpawner = spawnAgent, opts: AcpOptions = {}): AcpConnection {
  let proc: AcpProcess;
  try {
    proc = spawner(launch, cwd);
  } catch (e) {
    proc = deadProcess(`${launch.command} could not be started: ${e instanceof Error ? e.message : String(e)}`);
  }
  return overProcess(proc, opts);
}

/** The connection over a process already started: what `connectAcp` builds,
 *  and what a test hands a process in memory to. */
export function overProcess(proc: AcpProcess, opts: AcpOptions = {}): AcpConnection {
  const maxLine = opts.maxLine ?? MAX_LINE;
  const tailMax = opts.stderrTail ?? STDERR_TAIL;
  const grace = opts.graceMs ?? GRACE_MS;
  const log = opts.log ?? ((text: string) => console.error(text));

  let nextId = 1;
  let closing: Promise<AcpExit> | null = null;
  const pending = new Map<number, Pending>();
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  const listeners = new Set<(method: string, params: unknown) => void>();
  /** Once set the connection is over: every pending request was rejected with
   *  it, and every new one is. */
  let ended: AcpError | null = null;
  let tail = "";

  const send = (msg: Json): void => {
    if (ended) return;
    try {
      proc.write(`${JSON.stringify(msg)}\n`);
    } catch {
      // A pipe that broke under the write: the exit says what happened.
    }
  };

  const end = (why: AcpError): void => {
    if (ended) return;
    ended = why;
    const all = [...pending.values()];
    pending.clear();
    for (const p of all) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(why);
    }
  };

  /* ── what arrives ──────────────────────────────────────────────────── */

  const answer = (id: unknown, method: string, params: unknown): void => {
    const fn = handlers.get(method);
    if (!fn) {
      send({ jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Biom does not offer ${method}` } });
      return;
    }
    let run: Promise<unknown>;
    try {
      run = Promise.resolve(fn(params));
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(
      (result) => send({ jsonrpc: "2.0", id, result: result === undefined ? null : result }),
      (e: unknown) => {
        const code = isAcpError(e) && Number.isInteger(e.code) ? e.code : INTERNAL_ERROR;
        const message = e instanceof Error && e.message ? e.message : "the request failed";
        send({ jsonrpc: "2.0", id, error: { code, message } });
      },
    );
  };

  const dispatch = (msg: Json): void => {
    const method = msg.method;
    const hasId = msg.id !== undefined && msg.id !== null;
    if (typeof method === "string") {
      if (hasId) {
        answer(msg.id, method, msg.params);
        return;
      }
      for (const fn of [...listeners]) {
        try {
          fn(method, msg.params);
        } catch (e) {
          log(`acp: a listener for ${method} threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (p.timer) clearTimeout(p.timer);
    if (msg.error !== undefined && msg.error !== null) {
      const err = (typeof msg.error === "object" ? msg.error : {}) as { code?: unknown; message?: unknown; data?: unknown };
      const code = typeof err.code === "number" ? err.code : INTERNAL_ERROR;
      const message = typeof err.message === "string" && err.message !== "" ? err.message : `the agent answered ${p.method} with an error`;
      p.reject(new AcpRpcError(code, message, err.data));
      return;
    }
    p.resolve(msg.result === undefined ? null : msg.result);
  };

  const line = (text: string): void => {
    const trimmed = text.endsWith("\r") ? text.slice(0, -1) : text;
    if (trimmed.trim() === "") return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Not ours to answer: a banner or a log line on the wrong stream.
      return;
    }
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return;
    dispatch(msg as Json);
  };

  /* ── framing ───────────────────────────────────────────────────────── */

  const decoder = new TextDecoder("utf-8");
  const errDecoder = new TextDecoder("utf-8");
  let pieces: string[] = [];
  let pieceLen = 0;
  let overflowed = false;
  let drained = false;

  const feed = (text: string): void => {
    if (overflowed) return;
    let rest = text;
    for (;;) {
      const at = rest.indexOf("\n");
      if (at < 0) {
        if (rest.length > 0) {
          pieces.push(rest);
          pieceLen += rest.length;
        }
        if (pieceLen > maxLine) overflow();
        return;
      }
      const head = rest.slice(0, at);
      if (pieceLen + head.length > maxLine) {
        overflow();
        return;
      }
      const whole = pieces.length > 0 ? pieces.join("") + head : head;
      pieces = [];
      pieceLen = 0;
      line(whole);
      rest = rest.slice(at + 1);
    }
  };

  /** The end of stdout: what the decoder held and an unterminated last line
   *  are the last of it, and nothing more can be answered. */
  const drain = (why: string): void => {
    if (drained) return;
    drained = true;
    feed(decoder.decode());
    if (!overflowed && pieceLen > 0) {
      const last = pieces.join("");
      pieces = [];
      pieceLen = 0;
      line(last);
    }
    end(new AcpRpcError(ACP_CLOSED, why));
  };

  const overflow = (): void => {
    overflowed = true;
    pieces = [];
    pieceLen = 0;
    log(`acp: the agent wrote a line longer than ${maxLine} characters, so it was ended`);
    end(new AcpRpcError(ACP_CLOSED, `the agent wrote a line longer than ${maxLine} characters`));
    proc.endInput();
    proc.kill();
  };

  proc.onStdout((chunk) => {
    if (chunk === null) {
      drain("the agent closed its output");
      // A process that closed its output and lives on is no use to anybody.
      // A microtask later, so a process that ends its output from inside the
      // registration finds the connection whole.
      queueMicrotask(() => void close());
      return;
    }
    if (!drained) feed(decoder.decode(chunk, { stream: true }));
  });
  proc.onStderr((chunk) => {
    tail += errDecoder.decode(chunk, { stream: true });
    if (tail.length > tailMax) tail = tail.slice(tail.length - tailMax);
  });

  const closed: Promise<AcpExit> = proc.exited.then((exit) => {
    const how = exit.error ?? (exit.signal ? `it was ended by ${exit.signal}` : `it exited with code ${exit.code}`);
    drain(`the agent's connection ended: ${how}`);
    if (exit.error) log(`acp: ${exit.error}`);
    return { code: exit.code, signal: exit.signal };
  });

  function close(): Promise<AcpExit> {
    if (closing) return closing;
    closing = (async () => {
      end(new AcpRpcError(ACP_CLOSED, "the connection was closed"));
      proc.endInput();
      proc.terminate();
      const within = (ms: number) => Promise.race([closed.then(() => true), sleep(ms).then(() => false)]);
      if (!(await within(grace))) {
        proc.kill();
        if (!(await within(KILL_WAIT_MS))) return { code: null, signal: "SIGKILL" };
      }
      return closed;
    })();
    return closing;
  }

  return {
    request(method, params, o) {
      if (ended) return Promise.reject(ended);
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        const entry: Pending = { method, resolve, reject, timer: null };
        const ms = o?.timeoutMs;
        if (typeof ms === "number" && ms > 0) {
          entry.timer = setTimeout(() => {
            if (pending.get(id) !== entry) return;
            pending.delete(id);
            // Polite: the agent may stop working on what nobody waits for.
            send({ jsonrpc: "2.0", method: "$/cancel_request", params: { requestId: id } });
            reject(new AcpRpcError(ACP_TIMEOUT, `${method} had no answer within ${ms} ms`));
          }, ms);
        }
        pending.set(id, entry);
        send({ jsonrpc: "2.0", id, method, params: params ?? {} });
      });
    },

    notify(method, params) {
      send({ jsonrpc: "2.0", method, params: params ?? {} });
    },

    handle(method, fn) {
      handlers.set(method, fn);
    },

    onNotification(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    stderr() {
      return tail;
    },

    close,

    kill() {
      end(new AcpRpcError(ACP_CLOSED, "the connection was closed"));
      proc.kill();
    },

    closed,
  };
}

/* ── the real process ─────────────────────────────────────────────────── */

const WINDOWS = process.platform === "win32";

/** Start the agent: a group of its own, three pipes, and the environment the
 *  agents module resolved — nothing of this server's own. */
export function spawnAgent(launch: AgentLaunch, cwd: string): AcpProcess {
  const child = spawnChild(launch.command, launch.args, {
    cwd,
    env: launch.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: !WINDOWS,
    windowsHide: true,
  });
  const pid = typeof child.pid === "number" && child.pid > 0 ? child.pid : null;

  let startError: string | undefined;
  let exitInfo: AcpExit | null = null;
  let exitedAt = 0;
  let stdoutEnded = false;
  let settle!: (v: AcpExit & { error?: string }) => void;
  const exited = new Promise<AcpExit & { error?: string }>((r) => (settle = r));
  let settled = false;
  const finish = (): void => {
    if (settled || exitInfo === null) return;
    settled = true;
    settle(startError ? { ...exitInfo, error: startError } : exitInfo);
  };

  child.on("error", (e: Error) => {
    // A command that is not there arrives as `error`, and may bring no `exit`.
    startError = `${launch.command} could not be started: ${e.message}`;
    if (exitInfo === null) exitInfo = { code: null, signal: null };
    stdoutEnded = true;
    finish();
  });
  child.on("exit", (code: number | null, sig: string | null) => {
    exitInfo = { code, signal: sig };
    exitedAt = Date.now();
    // WHAT IT LEFT IN ITS GROUP GOES WITH IT. An agent that exits on its own —
    // done, or crashed — leaves the tools it started in its group as orphans,
    // and none of them outlives the agent it ran for. The group keeps its id
    // while anything is in it, so the signal reaches only what it left.
    if (!WINDOWS && pid !== null) {
      const group = (s: NodeJS.Signals) => {
        try {
          process.kill(-pid, s);
        } catch {
          /* nothing left in it */
        }
      };
      group("SIGTERM");
      const later = setTimeout(() => group("SIGKILL"), 1000);
      (later as { unref?: () => void }).unref?.();
    }
    if (stdoutEnded) finish();
    // Something the agent started may still hold its stdout; whatever the
    // agent itself wrote has arrived by now or never will.
    else setTimeout(finish, 500);
  });
  child.stdout?.on("end", () => {
    stdoutEnded = true;
    finish();
  });
  child.stdin?.on("error", () => {
    /* a pipe the agent closed first; the exit says what happened */
  });

  /** Every process and group the agent has made, as seen at any walk: one
   *  that exits first reparents its children, which are nobody's descendants
   *  after that, so what was once seen is kept. */
  const knownPids = new Set<number>();
  const knownGroups = new Set<number>();
  const walk = (): void => {
    if (pid === null || WINDOWS) return;
    knownGroups.add(pid);
    try {
      const ps = spawnSync("ps", ["-Ao", "pid=,ppid=,pgid="], { encoding: "utf8" });
      const tree = treeOf(parsePs(typeof ps.stdout === "string" ? ps.stdout : ""), pid);
      for (const p of tree.pids) knownPids.add(p);
      for (const g of tree.groups) knownGroups.add(g);
    } catch {
      /* no `ps`: the group is what there is */
    }
  };
  const signal = (sig: NodeJS.Signals): void => {
    if (pid === null) return;
    // Long after it went, its numbers may be somebody else's: what it left
    // was ended when it exited.
    if (exitInfo !== null && Date.now() - exitedAt > 2000) return;
    if (WINDOWS) {
      try {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } catch {
        /* gone already */
      }
      return;
    }
    walk();
    for (const g of knownGroups) {
      try {
        process.kill(-g, sig);
      } catch {
        /* that group has gone */
      }
    }
    for (const p of [pid, ...knownPids]) {
      try {
        process.kill(p, sig);
      } catch {
        /* that process has gone */
      }
    }
  };

  return {
    pid,
    write(text) {
      const stdin = child.stdin;
      if (!stdin || stdin.destroyed || !stdin.writable) return;
      stdin.write(text);
    },
    endInput() {
      try {
        child.stdin?.end();
      } catch {
        /* closed already */
      }
    },
    onStdout(fn) {
      child.stdout?.on("data", (b: Uint8Array) => fn(b));
      child.stdout?.on("end", () => fn(null));
    },
    onStderr(fn) {
      child.stderr?.on("data", (b: Uint8Array) => fn(b));
    },
    exited,
    terminate() {
      signal("SIGTERM");
    },
    kill() {
      signal("SIGKILL");
    },
  };
}

/** A process that never started: its exit is the reason. */
function deadProcess(why: string): AcpProcess {
  return {
    pid: null,
    write() {},
    endInput() {},
    onStdout() {},
    onStderr() {},
    exited: Promise.resolve({ code: null, signal: null, error: why }),
    terminate() {},
    kill() {},
  };
}
