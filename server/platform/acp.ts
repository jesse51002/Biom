// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — ONE ACP CONNECTION: JSON-RPC 2.0, one message per line, over an
// agent process's stdin and stdout. Raw capability, no vocabulary: it knows no
// chat, no vault and no agent by name.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET. The names are real so the chats and
// the agents can be built against them; the bodies are the ACP connection
// track's to write, and that track may reshape anything here that nothing else
// has started to call. What it owes:
//
//   - framing that survives a partial line, several messages in one chunk,
//     CRLF, a blank line and an oversized line (capped, then the connection
//     fails);
//   - requests both ways, correlated by id, and notifications;
//   - an agent's request to a method nobody handles answered -32601, never
//     silence;
//   - every pending request rejected, with one typed error, when stdout ends
//     or the process exits or crashes;
//   - stderr kept in a bounded ring for diagnostics and never forwarded raw;
//   - a timeout per request where the protocol allows one, and none on a turn;
//   - the spawner injected, each agent in a process group of its own, ended
//     TERM then KILL as `pty.ts` does it, and no child outliving its chat or
//     the server.
//
// ACP'S OWN MESSAGE TYPES LIVE HERE AND NOT IN `contracts/`: they are the
// protocol's, the server is the only side that speaks it, and what reaches the
// client is Biom's own `ChatUpdate`. So an agent changing what it streams is a
// change to this module and the chats, and to no screen.

import type { AgentLaunch } from "../../contracts/types.ts";

/** A JSON-RPC error, as either side sends one. `code` is JSON-RPC's own —
 *  -32601 for a method nobody handles — or ACP's, `-32000` being the agent's
 *  *authentication required*. */
export interface AcpError extends Error {
  code: number;
  data?: unknown;
}

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
   *  `fs/read_text_file`, `fs/write_text_file`. One handler per method. */
  handle(method: string, fn: (params: unknown) => Promise<unknown>): void;
  /** Hear the agent's notifications — `session/update`. Answers the
   *  unsubscribe. */
  onNotification(fn: (method: string, params: unknown) => void): () => void;
  /** The tail of what the agent wrote to stderr, bounded, for a diagnostic a
   *  person running the server reads. Never relayed to a client. */
  stderr(): string;
  /** End it: the process group TERM, a grace, then KILL. Settles when it is
   *  gone. */
  close(): Promise<AcpExit>;
  /** Settles when the process has gone, however it went. */
  readonly closed: Promise<AcpExit>;
}

/** What starts the process — injected, so a test can hand a connection a
 *  scripted agent without a real one on the machine. The launch is resolved
 *  by the agents module; the chats module adds the folder it runs in. */
export type AcpSpawner = (launch: AgentLaunch, cwd: string) => unknown;

/** Start an agent and speak ACP to it. NOT BUILT: throws. */
export function connectAcp(_launch: AgentLaunch, _cwd: string, _spawner?: AcpSpawner): AcpConnection {
  throw new Error("server/platform/acp.ts: the ACP connection is not built yet");
}
