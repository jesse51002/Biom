// SPDX-License-Identifier: AGPL-3.0-only
// The sign-in terminal's wire. Layer 7, beside `http.js` and `events.js`, and
// not either of them: the API route is one request and one answer, the events
// stream is one-way, and a terminal is bytes in both directions for as long as
// one command runs.
//
// THE WIRE IS SPELLED TWICE. `server/workspace/terminals.ts` is the other copy,
// and `tests/terminal-wire.test.ts` holds the two equal. Not `contracts/`: no
// box may ever be able to name a terminal kind.

/** Under the vault prefix. */
export const TERMINAL_ROUTE = "/terminal";
/** What this side says: `create` once with the ticket and a size, then `input`
 *  and `resize`. Closing the socket is how the command is ended. */
export const TERMINAL_OPS = ["create", "input", "resize"];
/** What the server says: `started`, `exited` with the exit, and `error` with a
 *  sentence. Output arrives as raw binary. */
export const TERMINAL_EVENTS = ["started", "exited", "error"];

/**
 * The socket address for a vault. The per-launch token rides as a query exactly
 * as it does on the API route, because a WebSocket cannot carry a header.
 * @param {{ protocol: string, host: string }} where this window's own location
 * @param {string} baseUrl the vault prefix
 * @param {string | null} token
 */
export function terminalUrl(where, baseUrl, token) {
  const scheme = where.protocol === "https:" ? "wss:" : "ws:";
  const query = token === null || token === "" ? "" : `?token=${encodeURIComponent(token)}`;
  return `${scheme}//${where.host}${baseUrl}${TERMINAL_ROUTE}${query}`;
}
