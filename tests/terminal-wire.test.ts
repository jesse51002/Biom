// SPDX-License-Identifier: AGPL-3.0-only
// THE TERMINAL'S WIRE IS SPELLED TWICE, and this is what holds the two equal.
//
// `server/workspace/terminals.ts` and `client/transport/terminal.js` cannot share
// a module: `contracts/` is the only thing both tiers may import and it is frozen
// — and a terminal kind is the one thing no artifact may ever be able to name. So
// the route, the ops, the events and the frame kinds are written in both and
// compared here, and a frame encoded by one is decoded by the other.
//
// It also holds the gate in front of the socket: `terminalRefusal` in
// `server/main.ts`, as a table of the requests that must be refused.

import { test, expect } from "bun:test";

import * as server from "../server/workspace/terminals.ts";
import * as client from "../client/transport/terminal.js";
import { cookieValue, isLoopback, terminalCookie, terminalRefusal } from "../server/main.ts";

test("the route, the ops, the events and the frame kinds are the same on both sides", () => {
  expect(client.TERMINAL_ROUTE).toBe(server.TERMINAL_ROUTE);
  expect([...client.TERMINAL_OPS]).toEqual([...server.TERMINAL_OPS]);
  expect([...client.TERMINAL_EVENTS]).toEqual([...server.TERMINAL_EVENTS]);
  expect(client.FRAME_OUTPUT).toBe(server.FRAME_OUTPUT);
  expect(client.FRAME_REPLAY).toBe(server.FRAME_REPLAY);
});

test("a frame the server encodes is the frame the client decodes", () => {
  const bytes = new TextEncoder().encode("héllo [31mred[0m");
  const id = crypto.randomUUID();
  const out = client.decodeFrame(server.frame(server.FRAME_OUTPUT, id, bytes));
  expect(out).toEqual({ replay: false, id, data: bytes });
  expect(client.decodeFrame(server.frame(server.FRAME_REPLAY, "x", new Uint8Array()))?.replay).toBe(true);
  expect(client.decodeFrame(new Uint8Array([9, 0]))).toBeNull();
  expect(client.decodeFrame(new Uint8Array([1, 40, 65]))).toBeNull();
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
  expect(terminalCookie(4401)).toBe("biom-terminal-4401");
  expect(cookieValue("a=1; biom-terminal-4400=xyz; b=2", "biom-terminal-4400")).toBe("xyz");
  expect(cookieValue("biom-terminal-44000=no", "biom-terminal-4400")).toBeNull();
  expect(cookieValue(null, "x")).toBeNull();
});
