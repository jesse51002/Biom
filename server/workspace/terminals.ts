// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — THE SIGN-IN TERMINAL: one command, the one an agent's own sign-in
// asked for, run in a PTY for as long as one socket is open, and nothing else.
//
// It is all that is left of the agent terminal. A person talks to an agent on
// the Agent screen now, over ACP; what still needs a terminal is an agent whose
// only way to sign in is a command of its own — Claude Code's
// `auth login --claudeai`, GitHub Copilot's, OpenCode's — and a browser that
// cannot call back, over SSH or in a container, which is where a code is
// pasted. So this runs that command, in the vault's root, at the pop-up's size,
// streams what it prints, takes what is typed, says how it ended and closes.
//
// ─────────────────────────────────────────────────────────────────────────────
// A CLIENT NEVER NAMES A COMMAND
// ─────────────────────────────────────────────────────────────────────────────
//
// The socket's `create` carries a TICKET and nothing that could be a program.
// The server minted that ticket when it answered `agents.signIn` with a
// terminal method, and `redeem` turns it back into exactly the command it
// stood for — ONCE: a ticket redeemed, refused or never minted is refused here
// and nothing starts. The minter makes tickets single-use and expiring; this
// module keeps its own record of every ticket it has spent as well, so a
// replay is refused whatever the minter answers. A `command`, `args` or `env`
// in a message is never read.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE SOCKET, ONE COMMAND, NO REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// There is no session to come back to. The socket IS the run's lifetime: the
// command exiting says `exited` and closes the socket, and the socket closing
// first — the pop-up's Close, a reload, the window gone — ends the command's
// whole process tree the way `server/platform/pty.ts` ends one. A command that
// exits BY ITSELF is not chased: what it deliberately left running, like the
// browser a sign-in opened, is the person's and no longer its. So there is no
// replay, no orphan grace and nothing a second window could attach to. A
// socket that names no ticket within `LIMITS.wait` is closed. The server's own
// exit takes every tree still running, synchronously, in `killAll`.
//
// When the command has gone, however it went, `ended` is told the ticket, so
// the agent it signed in is looked at again: whether it is signed in now is a
// session opening, never the command's exit code.
//
// THE WIRE IS SPELLED HERE AND IN `client/transport/terminal.js`, and a test
// holds the two equal. It is not in `contracts/`, on purpose: the terminal is
// host UI talking to its own server, and no box may ever be able to name a
// terminal kind.

import type { AgentLaunch } from "../../contracts/types.ts";
import type { Pty, PtyExit, PtyOptions } from "../platform/pty.ts";

/** Under a vault prefix: `/v/<url-encoded path>/terminal`, so a socket is bound
 *  to one folder by its address before it says a word. */
export const TERMINAL_ROUTE = "/terminal";

/** What a client may say, as JSON text. Anything else is answered `error`.
 *    create  { ticket, cols, rows } — once, and first
 *    input   { data }               — what the person typed or pasted
 *    resize  { cols, rows }
 *  There is no `end`: closing the socket is how a window ends the command. */
export const TERMINAL_OPS = ["create", "input", "resize"] as const;

/** What the server says back, as JSON text. Output travels as raw binary.
 *    started  {}                    — the command is running
 *    exited   { exit: PtyExit }     — it has gone, and the socket closes next
 *    error    { message }           — a sentence; when nothing started, the
 *                                     socket closes next */
export const TERMINAL_EVENTS = ["started", "exited", "error"] as const;

/** Every bound, in one place. */
export const LIMITS = {
  /** One `input` message, in characters. A paste larger than this is refused
   *  whole rather than cut, because half a paste is a different answer. */
  input: 256 * 1024,
  /** Bytes queued on the socket past which output is dropped rather than
   *  queued: the bound on the memory a command printing forever can cost. */
  lag: 4 * 1024 * 1024,
  /** How long a socket may stay open without naming a ticket, in ms. */
  wait: 10_000,
  /** How long after the command exits its last output may still arrive, in ms:
   *  `pty.ts` closes the master 100 ms after the exit for the same reason. */
  settle: 150,
  /** Tickets remembered as spent, for refusing a replay. */
  spent: 256,
} as const;

/** One socket, as `main.ts` wraps it. */
export interface Client {
  send(text: string): void;
  sendBinary(bytes: Uint8Array): void;
  /** Bytes queued and not yet written to the socket. */
  buffered(): number;
  /** Close the socket. Harmless on one already closed. */
  close(): void;
}

export interface Attachment {
  receive(message: string | Uint8Array): void;
  /** The socket closed, from either end. Idempotent. */
  detach(): void;
}

/** THE SIGN-IN STATE THE COMMAND COMES FROM, per vault — the vault's `Agents`
 *  in the running server, whose `redeem` this is. */
export interface Tickets {
  /** The command a ticket stands for, ONCE, or null for a ticket never minted,
   *  already spent or expired. `env` is the whole environment the command runs
   *  in: the person's login environment plus the method's own variables. */
  redeem(ticket: string): AgentLaunch | null;
  /** The command a redeemed ticket stood for has gone, however it went — it
   *  exited, it was ended, or it never started: look at its agent again. */
  ended(ticket: string): void;
}

export interface Terminals {
  /** One socket, opened on a vault whose root is `cwd` — absolute, and the
   *  mount's own path, resolved by the caller. */
  attach(cwd: string, tickets: Tickets, client: Client): Attachment;
  /** Commands started and not yet gone, for a test or a log. */
  live(): number;
  /** SIGKILL every tree now, synchronously — for a process in its `exit`
   *  handler, where no timer will run again. */
  killAll(): void;
}

export interface TerminalDeps {
  spawn(opts: PtyOptions): Promise<Pty>;
  /** Overrides for tests. */
  limits?: Partial<typeof LIMITS>;
}

const size = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 2 && (n as number) <= 1000;

/** A ticket is an opaque word the server minted. Anything else is not one. */
const ticketOf = (t: unknown): string | null => (typeof t === "string" && t.length > 0 && t.length <= 256 ? t : null);

/** What a refused ticket is told — one sentence whichever way it failed, so a
 *  caller learns nothing about which tickets exist. */
const REFUSED = "that sign-in was already used or has expired — ask to sign in again";

export function makeTerminals(deps: TerminalDeps): Terminals {
  const limits = { ...LIMITS, ...deps.limits };
  /** Every command started and not yet gone, whichever socket it was for. */
  const running = new Set<Pty>();
  /** Every ticket this server has spent, oldest first. */
  const spent = new Set<string>();

  const spend = (ticket: string): void => {
    spent.add(ticket);
    while (spent.size > limits.spent) spent.delete(spent.values().next().value as string);
  };

  return {
    attach(cwd, tickets, client) {
      let state: "waiting" | "starting" | "running" | "done" = "waiting";
      /** The socket has closed. */
      let gone = false;
      let pty: Pty | null = null;
      let dropping = false;

      const say = (event: Record<string, unknown>): void => {
        if (gone) return;
        try {
          client.send(JSON.stringify(event));
        } catch {
          /* the socket went; `detach` follows */
        }
      };
      const hangUp = (): void => {
        try {
          client.close();
        } catch {
          /* already closed */
        }
      };

      // A SOCKET THAT NAMES NO TICKET IS NOT KEPT OPEN FOR ONE.
      let waiting: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        waiting = null;
        if (state !== "waiting") return;
        state = "done";
        hangUp();
      }, limits.wait);
      const stopWaiting = (): void => {
        if (waiting !== null) clearTimeout(waiting);
        waiting = null;
      };

      /** The injected half is another module's, and a throw from it must not
       *  take the server's event loop with it. */
      const tellEnded = (ticket: string): void => {
        try {
          tickets.ended(ticket);
        } catch (e) {
          console.warn(`sign-in terminal  →  looking at the agent again failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      /** THE WHOLE TREE, when the socket went first. An end that did not take is
       *  said in the log and followed by the synchronous kill: nobody is left to
       *  show it to, and a sign-in nobody can see must not go on running. */
      const endTree = (p: Pty): void => {
        void p.end().then((ok) => {
          if (ok) return;
          console.warn(`sign-in terminal  →  pid ${p.pid} did not stop when its window went; killing its tree`);
          p.kill();
        });
      };

      const output = (bytes: Uint8Array): void => {
        if (gone) return;
        if (client.buffered() > limits.lag) {
          if (!dropping) say({ ev: "error", message: "the window could not keep up, so some of what the command printed was not shown" });
          dropping = true;
          return;
        }
        dropping = false;
        try {
          client.sendBinary(bytes);
        } catch {
          /* the socket went */
        }
      };

      /** Nothing started, and nothing will on this socket. */
      const refuse = (message: string): void => {
        state = "done";
        say({ ev: "error", message });
        hangUp();
      };

      const create = async (msg: Record<string, unknown>): Promise<void> => {
        if (state !== "waiting") {
          say({ ev: "error", message: "this terminal has already started its sign-in" });
          return;
        }
        stopWaiting();
        const ticket = ticketOf(msg.ticket);
        if (ticket === null) {
          refuse(REFUSED);
          return;
        }
        // SPENT BEFORE IT IS ASKED ABOUT, so the same ticket on a second socket
        // is refused here whatever the minter would have answered.
        const replay = spent.has(ticket);
        spend(ticket);
        let launch: AgentLaunch | null = null;
        if (!replay) {
          try {
            launch = tickets.redeem(ticket);
          } catch (e) {
            console.warn(`sign-in terminal  →  redeeming a ticket failed: ${e instanceof Error ? e.message : String(e)}`);
            launch = null;
          }
        }
        if (launch === null) {
          refuse(REFUSED);
          return;
        }
        state = "starting";
        let p: Pty;
        try {
          p = await deps.spawn({
            command: [launch.command, ...launch.args],
            cwd,
            env: launch.env,
            cols: size(msg.cols) ? msg.cols : 80,
            rows: size(msg.rows) ? msg.rows : 24,
            onData: output,
          });
        } catch (e) {
          refuse(e instanceof Error && e.message ? e.message : "the sign-in could not be started");
          tellEnded(ticket);
          return;
        }
        pty = p;
        running.add(p);
        void p.exited.then((exit: PtyExit) => {
          running.delete(p);
          state = "done";
          // The last of what it printed may still be on its way.
          setTimeout(() => {
            say({ ev: "exited", exit });
            hangUp();
            tellEnded(ticket);
          }, limits.settle);
        });
        if (gone) {
          // The window went while the command was starting.
          endTree(p);
          return;
        }
        state = "running";
        say({ ev: "started" });
      };

      const receive = (raw: string | Uint8Array): void => {
        let msg: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
          msg = parsed as Record<string, unknown>;
        } catch {
          say({ ev: "error", message: "that message is not one a terminal understands" });
          return;
        }
        switch (msg.op) {
          case "create":
            void create(msg);
            return;
          case "input": {
            if (state !== "running" || pty === null || typeof msg.data !== "string") return;
            if (msg.data.length > limits.input) {
              say({ ev: "error", message: `that paste is larger than a terminal accepts at once (${Math.round(limits.input / 1024)}KB) and was not sent` });
              return;
            }
            pty.write(msg.data);
            return;
          }
          case "resize":
            if (state !== "running" || pty === null || !size(msg.cols) || !size(msg.rows)) return;
            pty.resize(msg.cols, msg.rows);
            return;
          default:
            say({ ev: "error", message: "that message is not one a terminal understands" });
        }
      };

      return {
        receive: (message) => {
          if (!gone) receive(message);
        },
        detach: () => {
          if (gone) return;
          gone = true;
          stopWaiting();
          if (state === "running" && pty !== null) endTree(pty);
        },
      };
    },
    live: () => running.size,
    killAll() {
      for (const p of running) p.kill();
    },
  };
}
