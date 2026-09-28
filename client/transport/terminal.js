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

/** @typedef {"connecting" | "open" | "closed"} SocketState */
/**
 * What the socket hands up, in order: `open` once, then events and bytes, then
 * `closed` exactly once — whether the server closed it, the network did, or it
 * never opened at all.
 * @typedef {{ kind: "open" }
 *   | { kind: "event", event: Record<string, any> }
 *   | { kind: "bytes", data: Uint8Array }
 *   | { kind: "closed" }} SocketMessage
 */
/**
 * @typedef {object} TerminalSocket
 * @property {(msg: Record<string, unknown>) => boolean} send False when the
 *   socket is not open, in which case nothing was sent and nothing will be.
 * @property {() => void} close Close it. Closing is how the command is ended.
 * @property {() => SocketState} state
 */

/**
 * ONE SIGN-IN'S SOCKET, opened once and NEVER REOPENED. The command on the other
 * end lives exactly as long as this socket: a drop has already ended it on the
 * server, so a reconnect would find nothing to reattach to and would need a new
 * ticket besides. It keeps nothing to send later — a keystroke typed while the
 * socket is not open is refused here, not queued, because typing into a
 * command at a moment nobody chose is typing nobody did.
 *
 * @param {{ url: string, hear: (m: SocketMessage) => void, WebSocket?: any }} opts
 * @returns {TerminalSocket}
 */
export function openTerminalSocket(opts) {
  const Socket = opts.WebSocket ?? (typeof WebSocket === "function" ? WebSocket : null);
  /** @type {SocketState} */
  let state = "connecting";
  /** @param {SocketMessage} m */
  const tell = (m) => {
    try {
      opts.hear(m);
    } catch (e) {
      console.warn("a terminal listener threw", e);
    }
  };
  const closed = () => {
    if (state === "closed") return;
    state = "closed";
    tell({ kind: "closed" });
  };

  /** @type {any} */
  let ws = null;
  try {
    if (Socket === null) throw new Error("this window has no WebSocket");
    ws = new Socket(opts.url);
  } catch {
    // Said on the next turn, so the caller has its handle before it hears.
    queueMicrotask(closed);
    return { send: () => false, close: () => {}, state: () => state };
  }
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    if (state !== "connecting") return;
    state = "open";
    tell({ kind: "open" });
  };
  ws.onmessage = (/** @type {{ data: unknown }} */ e) => {
    if (state !== "open") return;
    if (typeof e.data === "string") {
      /** @type {unknown} */
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event && typeof event === "object") tell({ kind: "event", event: /** @type {Record<string, any>} */ (event) });
      return;
    }
    if (e.data instanceof ArrayBuffer) tell({ kind: "bytes", data: new Uint8Array(e.data) });
  };
  // `onclose` always follows an error, and is where it is said.
  ws.onerror = () => {};
  ws.onclose = closed;

  return {
    send(msg) {
      if (state !== "open") return false;
      try {
        ws.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      closed();
    },
    state: () => state,
  };
}
