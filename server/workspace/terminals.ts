// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — the terminal sessions of each workspace, and the only thing that
// owns one.
//
// A session is a shell started in a vault's root, with an identity of its own
// that has nothing to do with the page anybody is looking at, its label or the
// tab it was opened from. This module holds every one, per vault: their ids,
// their lifecycle, the bounded output they have produced, and which connected
// clients hear about them. It spawns through what it is handed and knows no
// PTY, no socket and no HTTP — `server/platform/pty.ts` is the process and
// `server/main.ts` is the wire.
//
// ─────────────────────────────────────────────────────────────────────────────
// VISIBILITY IS NOT LIFETIME
// ─────────────────────────────────────────────────────────────────────────────
//
// Nothing a client does to its dock reaches this file. Hiding the terminal,
// moving it to another edge, going full screen, switching page or tab, reloading
// the window — none of those is a message, so none of them can stop a process.
// Exactly three things end a session: `end`, the shell exiting by itself, and
// the process holding all of them going away. A fourth is the ORPHAN rule below.
//
// WHAT A RECONNECT GETS IS A REPLAY, AND IT SAYS WHETHER IT IS WHOLE. Output is
// kept in a ring of at most `LIMITS.buffer` bytes. A session that has never
// overflowed it replays from its first byte, which is a coherent screen: the
// emulator on the other end starts from the same blank state the shell did. One
// that has overflowed replays a tail, which may begin inside an escape sequence
// or halfway through a full-screen redraw — so the session says `truncated`, the
// client says so on screen, and the PTY is nudged with a resize so a TUI
// repaints itself. Input is never kept and never replayed.
//
// A CLIENT THAT CANNOT KEEP UP STOPS BEING SENT OUTPUT. A flood into a hidden tab
// must not grow the socket's buffer without bound, so past `LIMITS.lag` bytes
// queued the client is marked behind; when the socket drains it gets a resync —
// a replay of the ring — rather than every byte it missed. The ring is the bound.
// What this cannot do is slow the producer: the PTY's reader is Bun's, and it
// offers no pause. A shell printing forever costs one ring and a CPU, not memory.
//
// THE WIRE IS SPELLED HERE AND IN `client/transport/terminal.js`, and a test
// holds the two equal. It is not in `contracts/`: that directory is frozen, and
// the terminal is host UI talking to its own server — no artifact can reach
// either end, and a type a page could name is the one thing this must not be.

import type { Pty, PtyExit, PtyOptions } from "../platform/pty.ts";

/** Under a vault prefix: `/v/<url-encoded path>/terminal`, so a socket is bound
 *  to one folder by its address before it says a word. */
export const TERMINAL_ROUTE = "/terminal";

/** What a client may say. Anything else is answered with an `error`. */
export const TERMINAL_OPS = ["hello", "create", "input", "resize", "end", "label", "dismiss"] as const;

/** What the server says back, as JSON text frames. Output travels as binary. */
export const TERMINAL_EVENTS = ["sessions", "created", "failed", "state", "removed", "resync", "error"] as const;

/** The first byte of a binary frame. Then one byte of id length, the id, and the
 *  bytes — so output never goes through a string, and a UTF-8 sequence split
 *  across two reads arrives split and is joined by the emulator rather than
 *  replaced by two question marks here. */
export const FRAME_OUTPUT = 1;
export const FRAME_REPLAY = 2;

/** Every bound, in one place. Measured against nothing yet — the spec asks for
 *  resource limits to be measured before shipping, and these are the numbers
 *  that measurement starts from. */
export const LIMITS = {
  /** Live sessions in one workspace. */
  sessions: 12,
  /** Output kept per session for a reconnect, in bytes. */
  buffer: 2 * 1024 * 1024,
  /** One `input` message, in characters. A paste larger than this is refused
   *  whole rather than cut, because half a paste is a different command. */
  input: 256 * 1024,
  /** A tab's label, in characters. */
  label: 80,
  /** Bytes queued on one socket before that client is marked behind. */
  lag: 4 * 1024 * 1024,
  /** How long a workspace's sessions outlive their last connected client. */
  grace: 120_000,
  /** Create requests remembered for deduplication, per workspace. */
  nonces: 64,
} as const;

export type SessionState = "running" | "ending" | "exited" | "failed";

/** One session as a client sees it. */
export interface SessionInfo {
  id: string;
  label: string;
  state: SessionState;
  exit: PtyExit | null;
  /** The folder the shell was STARTED in. Not where it is now — a `cd` is the
   *  shell's business and this module does not ask. */
  cwd: string;
  shell: string;
  started: number;
  /** Set when the ring has dropped output, so a replay is a tail. */
  truncated: boolean;
  /** Why a session is `failed`: a termination that did not take. */
  message: string | null;
}

/** One connected client, as `main.ts` wraps a socket. */
export interface Client {
  send(text: string): void;
  sendBinary(bytes: Uint8Array): void;
  /** Bytes queued and not yet written to the socket. */
  buffered(): number;
}

export interface Attachment {
  receive(message: string | Uint8Array): void;
  /** The socket has room again. */
  drained(): void;
  detach(): void;
}

export interface Terminals {
  /** Connect a client to one workspace. `vault` is absolute and mounted — the
   *  caller resolved it, and it is the directory every shell starts in. */
  attach(vault: string, client: Client): Attachment;
  /** Every session of a workspace, for a test or a log. */
  sessions(vault: string): SessionInfo[];
  /** End every session everywhere, awaiting each. */
  shutdown(): Promise<void>;
  /** SIGKILL every tree now, synchronously — for a process in its `exit`
   *  handler, where no timer will run again. */
  killAll(): void;
}

export interface TerminalDeps {
  spawn(opts: PtyOptions): Promise<Pty>;
  env: Record<string, string | undefined>;
  /** Overrides for tests. */
  limits?: Partial<typeof LIMITS>;
  newId?: () => string;
  now?: () => number;
}

interface Session {
  info: SessionInfo;
  pty: Pty;
  chunks: Uint8Array[];
  bytes: number;
  cols: number;
  rows: number;
}

interface Held {
  client: Client;
  behind: boolean;
}

interface Workspace {
  path: string;
  sessions: Map<string, Session>;
  clients: Set<Held>;
  /** nonce → the session it made, or the sentence it failed with. */
  nonces: Map<string, { id: string } | { failed: string }>;
  /** Creates in flight, counted against the limit before they land. */
  starting: number;
  made: number;
  orphan: ReturnType<typeof setTimeout> | null;
}

const encoder = new TextEncoder();

/** A binary frame: kind, id length, id, bytes. */
export function frame(kind: number, id: string, bytes: Uint8Array): Uint8Array {
  const idBytes = encoder.encode(id);
  const out = new Uint8Array(2 + idBytes.length + bytes.length);
  out[0] = kind;
  out[1] = idBytes.length;
  out.set(idBytes, 2);
  out.set(bytes, 2 + idBytes.length);
  return out;
}

const size = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 2 && (n as number) <= 1000;

export function makeTerminals(deps: TerminalDeps): Terminals {
  const limits = { ...LIMITS, ...deps.limits };
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());
  const spaces = new Map<string, Workspace>();

  const space = (path: string): Workspace => {
    let ws = spaces.get(path);
    if (!ws) {
      ws = { path, sessions: new Map(), clients: new Set(), nonces: new Map(), starting: 0, made: 0, orphan: null };
      spaces.set(path, ws);
    }
    return ws;
  };

  const say = (held: Held, event: Record<string, unknown>): void => {
    try {
      held.client.send(JSON.stringify(event));
    } catch {
      /* the socket went; `detach` will follow */
    }
  };
  const tell = (ws: Workspace, event: Record<string, unknown>): void => {
    for (const held of ws.clients) say(held, event);
  };

  const live = (ws: Workspace): number =>
    [...ws.sessions.values()].filter((s) => s.info.state === "running" || s.info.state === "ending").length + ws.starting;

  /** The ring, whole, as one run of bytes. */
  const ring = (s: Session): Uint8Array => {
    const out = new Uint8Array(s.bytes);
    let at = 0;
    for (const c of s.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  };

  const replay = (held: Held, s: Session): void => {
    if (s.bytes === 0) return;
    try {
      held.client.sendBinary(frame(FRAME_REPLAY, s.info.id, ring(s)));
    } catch {
      /* the socket went */
    }
  };

  /** A tail begins wherever the ring cut it, so a full-screen program is asked
   *  to draw itself again. Two resizes, because the same size twice is not a
   *  change and sends no SIGWINCH. */
  const nudge = (s: Session): void => {
    if (s.info.state !== "running") return;
    try {
      s.pty.resize(s.cols, Math.max(2, s.rows - 1));
      setTimeout(() => {
        try {
          s.pty.resize(s.cols, s.rows);
        } catch {
          /* the shell has gone */
        }
      }, 40);
    } catch {
      /* the shell has gone */
    }
  };

  const output = (ws: Workspace, s: Session, bytes: Uint8Array): void => {
    s.chunks.push(bytes);
    s.bytes += bytes.length;
    while (s.bytes > limits.buffer && s.chunks.length > 1) {
      const dropped = s.chunks.shift() as Uint8Array;
      s.bytes -= dropped.length;
      if (!s.info.truncated) {
        s.info.truncated = true;
        tell(ws, { ev: "state", session: s.info });
      }
    }
    const framed = frame(FRAME_OUTPUT, s.info.id, bytes);
    for (const held of ws.clients) {
      if (held.behind) continue;
      if (held.client.buffered() > limits.lag) {
        held.behind = true;
        continue;
      }
      try {
        held.client.sendBinary(framed);
      } catch {
        /* the socket went */
      }
    }
  };

  const remove = (ws: Workspace, id: string): void => {
    if (!ws.sessions.delete(id)) return;
    tell(ws, { ev: "removed", id });
  };

  /** THE ORPHAN RULE. A workspace with live sessions and nobody connected to it
   *  is a browser tab that was closed, and a shell nobody can see is the hidden
   *  orphan the spec forbids. A reload reconnects in well under `grace`; a
   *  closed tab does not, and its sessions end. The desktop application never
   *  reaches this: closing its window ends the server, and every tree with it. */
  const armOrphan = (ws: Workspace): void => {
    if (ws.orphan !== null || ws.clients.size > 0) return;
    if (live(ws) === 0) return;
    ws.orphan = setTimeout(() => {
      ws.orphan = null;
      if (ws.clients.size > 0) return;
      for (const s of ws.sessions.values()) if (s.info.state === "running") void endSession(ws, s);
    }, limits.grace);
  };

  const endSession = async (ws: Workspace, s: Session): Promise<void> => {
    if (s.info.state !== "running" && s.info.state !== "failed") return;
    s.info.state = "ending";
    s.info.message = null;
    tell(ws, { ev: "state", session: s.info });
    const ok = await s.pty.end();
    if (!ok) {
      s.info.state = "failed";
      s.info.message = "the process did not stop — it may still be running";
      tell(ws, { ev: "state", session: s.info });
    }
    // Success is reported by the exit, which is the only thing that knows.
  };

  const create = async (ws: Workspace, held: Held, msg: Record<string, unknown>): Promise<void> => {
    const nonce = msg.nonce;
    if (typeof nonce !== "string" || nonce === "" || nonce.length > 64) {
      say(held, { ev: "error", message: "a new terminal needs a request id" });
      return;
    }
    // A RETRY IS NOT A SECOND TERMINAL. A create whose answer was lost on a
    // dropped socket is sent again with the same nonce, and gets the same answer.
    const had = ws.nonces.get(nonce);
    if (had) {
      if ("failed" in had) say(held, { ev: "failed", nonce, message: had.failed });
      else {
        const s = ws.sessions.get(had.id);
        if (s) say(held, { ev: "created", nonce, session: s.info });
      }
      return;
    }
    const remember = (answer: { id: string } | { failed: string }) => {
      ws.nonces.set(nonce, answer);
      while (ws.nonces.size > limits.nonces) ws.nonces.delete(ws.nonces.keys().next().value as string);
    };
    if (live(ws) >= limits.sessions) {
      const message = `at most ${limits.sessions} terminals can run in one workspace — end one first`;
      remember({ failed: message });
      say(held, { ev: "failed", nonce, message });
      return;
    }
    const cols = size(msg.cols) ? msg.cols : 80;
    const rows = size(msg.rows) ? msg.rows : 24;
    const id = newId();
    // Reserved before the await, so two creates at once cannot both slip under
    // the limit and the id is claimed before the shell prints its first byte.
    ws.nonces.set(nonce, { id });
    ws.starting++;
    let session: Session | null = null;
    const early: Uint8Array[] = [];
    let pty: Pty;
    try {
      pty = await deps.spawn({
        cwd: ws.path,
        cols,
        rows,
        env: deps.env,
        onData: (bytes) => {
          if (session) output(ws, session, bytes);
          else early.push(bytes);
        },
      });
    } catch (e) {
      ws.starting--;
      const message = e instanceof Error && e.message ? e.message : "the terminal could not be started";
      remember({ failed: message });
      say(held, { ev: "failed", nonce, message });
      armOrphan(ws);
      return;
    }
    ws.starting--;
    ws.made++;
    session = {
      info: {
        id,
        label: `Terminal ${ws.made}`,
        state: "running",
        exit: null,
        cwd: ws.path,
        shell: pty.shell,
        started: now(),
        truncated: false,
        message: null,
      },
      pty,
      chunks: [],
      bytes: 0,
      cols,
      rows,
    };
    const s = session;
    ws.sessions.set(id, s);
    remember({ id });
    tell(ws, { ev: "created", nonce, session: s.info });
    for (const bytes of early) output(ws, s, bytes);
    void pty.exited.then((exit) => {
      s.info.state = "exited";
      s.info.exit = exit;
      s.info.message = null;
      tell(ws, { ev: "state", session: s.info });
    });
    armOrphan(ws);
  };

  const receive = (ws: Workspace, held: Held, raw: string | Uint8Array): void => {
    let msg: Record<string, unknown>;
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      msg = parsed as Record<string, unknown>;
    } catch {
      say(held, { ev: "error", message: "that message is not one a terminal understands" });
      return;
    }
    const op = msg.op;
    const target = typeof msg.id === "string" ? ws.sessions.get(msg.id) : undefined;
    switch (op) {
      case "hello": {
        say(held, { ev: "sessions", sessions: [...ws.sessions.values()].map((s) => s.info) });
        for (const s of ws.sessions.values()) {
          replay(held, s);
          if (s.info.truncated) nudge(s);
        }
        return;
      }
      case "create":
        void create(ws, held, msg);
        return;
      case "input": {
        if (!target || target.info.state !== "running") return;
        if (typeof msg.data !== "string") return;
        if (msg.data.length > limits.input) {
          say(held, { ev: "error", message: `that paste is larger than a terminal accepts at once (${Math.round(limits.input / 1024)}KB) and was not sent` });
          return;
        }
        target.pty.write(msg.data);
        return;
      }
      case "resize": {
        if (!target || target.info.state !== "running") return;
        if (!size(msg.cols) || !size(msg.rows)) return;
        if (msg.cols === target.cols && msg.rows === target.rows) return;
        target.cols = msg.cols;
        target.rows = msg.rows;
        target.pty.resize(msg.cols, msg.rows);
        return;
      }
      case "end":
        if (target) void endSession(ws, target);
        return;
      case "label": {
        if (!target || typeof msg.label !== "string") return;
        const label = msg.label.replace(/\s+/g, " ").trim().slice(0, limits.label);
        if (label === "" || label === target.info.label) return;
        target.info.label = label;
        tell(ws, { ev: "state", session: target.info });
        return;
      }
      case "dismiss": {
        // Only an ended session goes quietly. A failed termination stays on
        // screen until it is ended for real, because its process may still be
        // there and a tab that vanished would say it was not.
        if (target && target.info.state === "exited") remove(ws, target.info.id);
        return;
      }
      default:
        say(held, { ev: "error", message: "that message is not one a terminal understands" });
    }
  };

  return {
    attach(vault, client) {
      const ws = space(vault);
      const held: Held = { client, behind: false };
      ws.clients.add(held);
      if (ws.orphan !== null) {
        clearTimeout(ws.orphan);
        ws.orphan = null;
      }
      let gone = false;
      return {
        receive: (message) => {
          if (!gone) receive(ws, held, message);
        },
        drained: () => {
          if (gone || !held.behind) return;
          if (client.buffered() > limits.lag / 4) return;
          held.behind = false;
          for (const s of ws.sessions.values()) {
            say(held, { ev: "resync", id: s.info.id, truncated: s.info.truncated });
            replay(held, s);
          }
        },
        detach: () => {
          if (gone) return;
          gone = true;
          ws.clients.delete(held);
          armOrphan(ws);
        },
      };
    },
    sessions: (vault) => [...(spaces.get(vault)?.sessions.values() ?? [])].map((s) => ({ ...s.info })),
    async shutdown() {
      const all: Promise<boolean>[] = [];
      for (const ws of spaces.values()) {
        if (ws.orphan !== null) clearTimeout(ws.orphan);
        ws.orphan = null;
        for (const s of ws.sessions.values()) if (s.info.state !== "exited") all.push(s.pty.end());
      }
      await Promise.all(all);
    },
    killAll() {
      for (const ws of spaces.values()) for (const s of ws.sessions.values()) if (s.info.state !== "exited") s.pty.kill();
    },
  };
}
