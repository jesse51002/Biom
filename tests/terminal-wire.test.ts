// SPDX-License-Identifier: AGPL-3.0-only
// THE SIGN-IN TERMINAL'S WIRE IS SPELLED TWICE, and this is what holds the two
// equal.
//
// `server/workspace/terminals.ts` and `client/transport/terminal.js` cannot share
// a module: `contracts/` is the only thing both tiers may import, and a terminal
// kind is the one thing no box may ever be able to name. So the route, the ops
// and the events are written in both and compared here.
//
// It also holds the gate in front of the socket: `terminalRefusal` in
// `server/main.ts`, as a table of the requests that must be refused.

import { test, expect } from "bun:test";

import * as server from "../server/workspace/terminals.ts";
import * as client from "../client/transport/terminal.js";
import { cookieValue, isLoopback, localCookie, terminalRefusal } from "../server/main.ts";

test("the route, the ops and the events are the same on both sides", () => {
  expect(client.TERMINAL_ROUTE).toBe(server.TERMINAL_ROUTE);
  expect([...client.TERMINAL_OPS]).toEqual([...server.TERMINAL_OPS]);
  expect([...client.TERMINAL_EVENTS]).toEqual([...server.TERMINAL_EVENTS]);
  // No op names a command: the ticket is the only thing that says what runs.
  for (const op of server.TERMINAL_OPS) expect([op, /spawn|exec|run|command|shell/.test(op)]).toEqual([op, false]);
});

test("the socket address carries the vault prefix and the launch token", () => {
  expect(client.terminalUrl({ protocol: "http:", host: "127.0.0.1:5000" }, "/v/%2Fa", "t k")).toBe("ws://127.0.0.1:5000/v/%2Fa/terminal?token=t%20k");
  expect(client.terminalUrl({ protocol: "https:", host: "h" }, "/v/x", null)).toBe("wss://h/v/x/terminal");
});

/* ── the gate ───────────────────────────────────────────────────────────── */

const PORT = 4400;
const CAP = "capability";
const good = {
  upgrade: "websocket",
  tokenOk: true,
  address: "127.0.0.1",
  host: `localhost:${PORT}`,
  origin: `http://localhost:${PORT}`,
  cookie: CAP,
};
const refuse = (patch: Partial<typeof good> & Record<string, unknown>) =>
  terminalRefusal({ ...good, ...patch } as typeof good, { port: PORT, capability: CAP });

test("a loopback page of this server, with the capability, is let in", () => {
  expect(refuse({})).toBeNull();
  expect(refuse({ address: "::1", host: `[::1]:${PORT}`, origin: `http://[::1]:${PORT}` })).toBeNull();
  expect(refuse({ address: "::ffff:127.0.0.1", host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` })).toBeNull();
});

test("EVERY OTHER REQUEST IS REFUSED, and each check stops its own attack", () => {
  const cases: [string, Partial<typeof good> & Record<string, unknown>][] = [
    ["a plain fetch — the page proxy cannot upgrade", { upgrade: null }],
    ["the built application without its token", { tokenOk: false }],
    ["a machine on the same network", { address: "192.168.1.20" }],
    ["no peer address at all", { address: null }],
    ["a DNS-rebinding name that resolves to 127.0.0.1", { host: `attacker.example:${PORT}`, origin: `http://attacker.example:${PORT}` }],
    ["this machine on another port", { host: "localhost:9999", origin: "http://localhost:9999" }],
    ["a page in the box, whose origin is opaque", { origin: "null" }],
    ["no Origin at all", { origin: null }],
    ["a site in another tab", { origin: "https://example.com" }],
    ["a same-machine origin on another port", { origin: "http://localhost:3000" }],
    ["no capability cookie", { cookie: null }],
    ["a guessed capability", { cookie: "guess" }],
  ];
  for (const [what, patch] of cases) expect([what, refuse(patch) !== null]).toEqual([what, true]);
});

test("loopback is the peer address, and a cookie is read by its exact name", () => {
  expect(isLoopback("127.0.0.1")).toBe(true);
  expect(isLoopback("127.1.2.3")).toBe(true);
  expect(isLoopback("::1")).toBe(true);
  expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
  expect(isLoopback("10.0.0.1")).toBe(false);
  expect(isLoopback("")).toBe(false);
  expect(localCookie(4401)).toBe("biom-local-4401");
  expect(cookieValue("a=1; biom-local-4400=xyz; b=2", "biom-local-4400")).toBe("xyz");
  expect(cookieValue("biom-local-44000=no", "biom-local-4400")).toBeNull();
  expect(cookieValue(null, "x")).toBeNull();
});
