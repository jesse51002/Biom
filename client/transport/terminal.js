// SPDX-License-Identifier: AGPL-3.0-only
// The terminal's own socket. Layer 7, beside `http.js` and `events.js`, and not
// either of them: the API route is one request and one answer, the events
// stream is one-way and carries nothing, and a terminal is bytes in both
// directions for as long as a shell runs.
//
// IT IS A PIPE WITH A RECONNECT. It opens one WebSocket to this vault's
// `/terminal`, says `hello` every time it opens, hands up every server event and
// every output frame, and reopens after a drop with a backoff. It keeps NOTHING
// to send later: a keystroke typed while the socket is down is refused here, not
// queued, because replaying input into a shell is typing a command nobody typed
// at the moment it lands. The one thing that IS resent — a create whose answer
// was lost — is the store's decision, and it goes with the same nonce so the
// server can tell a retry from a second terminal.
//
// THE WIRE IS SPELLED TWICE. `server/workspace/terminals.ts` is the other copy,
// and `tests/terminal-wire.test.ts` holds the two equal. Not `contracts/`: that
// directory is frozen, and no artifact may ever be able to name a terminal kind.

/** Under the vault prefix. */
export const TERMINAL_ROUTE = "/terminal";
export const TERMINAL_OPS = ["hello", "create", "input", "resize", "end", "label", "dismiss"];
export const TERMINAL_EVENTS = ["sessions", "created", "failed", "state", "removed", "resync", "error"];
export const FRAME_OUTPUT = 1;
export const FRAME_REPLAY = 2;

/** @typedef {"idle" | "connecting" | "open" | "closed"} LinkState */
/**
 * @typedef {{ kind: "link", state: LinkState }
 *   | { kind: "event", event: Record<string, any> }
 *   | { kind: "bytes", replay: boolean, id: string, data: Uint8Array }} LinkMessage
 */
/**
 * @typedef {object} TerminalLink
 * @property {() => void} connect Open the socket if it is not; idempotent.
 * @property {() => void} close Close it and stop reconnecting.
 * @property {(msg: Record<string, unknown>) => boolean} send False when there is
 *   no open socket, in which case nothing was sent and nothing will be.
 * @property {() => LinkState} state
 * @property {(hear: (m: LinkMessage) => void) => () => void} on
 */

const decoder = new TextDecoder();

/**
 * A binary frame back into its parts: kind, id length, id, bytes.
 * @param {ArrayBuffer | Uint8Array} buf
 * @returns {{ replay: boolean, id: string, data: Uint8Array } | null}
 */
export function decodeFrame(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 2) return null;
  const kind = bytes[0];
  const len = bytes[1] ?? 0;
  if (kind !== FRAME_OUTPUT && kind !== FRAME_REPLAY) return null;
  if (bytes.length < 2 + len) return null;
  return {
    replay: kind === FRAME_REPLAY,
    id: decoder.decode(bytes.subarray(2, 2 + len)),
    data: bytes.subarray(2 + len),
  };
}

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

/** How long to wait before the nth reopen, in ms. */
export const backoff = (/** @type {number} */ n) => Math.min(5000, 400 * 2 ** Math.min(n, 4));

/**
 * @param {{ url: string, WebSocket?: any, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} opts
 * @returns {TerminalLink}
 */
export function makeTerminalLink(opts) {
  const Socket = opts.WebSocket ?? (typeof WebSocket === "function" ? WebSocket : null);
  const later = opts.setTimeout ?? setTimeout;
  const cancel = opts.clearTimeout ?? clearTimeout;
  /** @type {Set<(m: LinkMessage) => void>} */
  const hears = new Set();
  /** @type {any} */
  let socket = null;
  /** @type {LinkState} */
  let state = "idle";
  let wanted = false;
  let tries = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  /** @param {LinkMessage} m */
  const tell = (m) => {
    for (const hear of [...hears]) {
      try {
        hear(m);
      } catch (e) {
        console.warn("a terminal listener threw", e);
      }
    }
  };
  /** @param {LinkState} next */
  const become = (next) => {
    if (state === next) return;
    state = next;
    tell({ kind: "link", state });
  };

  function open() {
    if (!wanted || socket !== null || Socket === null) return;
    become("connecting");
    /** @type {any} */
    let ws;
    try {
      ws = new Socket(opts.url);
    } catch {
      retry();
      return;
    }
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if (socket !== ws) return;
      tries = 0;
      become("open");
      ws.send(JSON.stringify({ op: "hello" }));
    };
    ws.onmessage = (/** @type {{ data: unknown }} */ e) => {
      if (socket !== ws) return;
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
      if (e.data instanceof ArrayBuffer) {
        const f = decodeFrame(e.data);
        if (f) tell({ kind: "bytes", replay: f.replay, id: f.id, data: f.data });
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      become("closed");
      retry();
    };
    // `onclose` always follows an error, and is where the retry is armed.
    ws.onerror = () => {};
  }

  function retry() {
    socket = null;
    if (!wanted || timer !== null) return;
    if (state !== "closed") become("closed");
    timer = later(() => {
      timer = null;
      open();
    }, backoff(tries++));
  }

  return {
    connect() {
      wanted = true;
      open();
    },
    close() {
      wanted = false;
      if (timer !== null) cancel(timer);
      timer = null;
      const ws = socket;
      socket = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      }
      become("idle");
    },
    send(msg) {
      if (socket === null || state !== "open") return false;
      try {
        socket.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    },
    state: () => state,
    on(hear) {
      hears.add(hear);
      return () => hears.delete(hear);
    },
  };
}
