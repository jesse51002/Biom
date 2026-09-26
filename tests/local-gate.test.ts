// SPDX-License-Identifier: AGPL-3.0-only
// THIS MACHINE'S OWN WINDOW — the gate in front of every agent and chat kind, a
// window's report, and the live stream, on a real server.
//
// Spawned rather than imported, as `terminal-route.test.ts` is, because what is
// checked is the route table, the cookie on the composed document and the page
// proxy together. What this proves: a request that forges Host and Origin but
// has no cookie is refused, in a source run with no launch token at all; a
// request routed through the inner ring's `fetch` proxy can never carry the
// cookie, even when the page knows it; and with the cookie it is let through.
// The vault here is a temporary folder and every id in it is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOCAL_KIND_NAMES, CHAT_KIND_NAMES, isLocalKind } from "../contracts/guards.js";
import { localRefusal } from "../server/main.ts";

const HERE = join(import.meta.dir, "..");

let vault = "";
let data = "";
let port = 0;
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = "";
/** `biom-local-<port>=<capability>`, as the composed document set it. */
let cookie = "";

beforeAll(async () => {
  vault = realpathSync(mkdtempSync(join(tmpdir(), "biom-gate-vault-")));
  data = mkdtempSync(join(tmpdir(), "biom-gate-data-"));
  rmSync(vault, { recursive: true, force: true });
  port = 5400 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}`;
  proc = Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
    cwd: HERE,
    env: { ...process.env, PORT: String(port), VAULT: vault, VAULTS: join(data, "vaults.json"), HOME: data },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${base}/`);
      cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      await res.text();
      if (cookie !== "") return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("the framework did not come up");
});

afterAll(() => {
  proc?.kill();
  if (vault) rmSync(vault, { recursive: true, force: true });
  if (data) rmSync(data, { recursive: true, force: true });
});

const api = () => `${base}/v/${encodeURIComponent(vault)}/api/call`;
const stream = () => `${base}/v/${encodeURIComponent(vault)}/events`;
const FORGED = () => ({ host: `localhost:${port}`, origin: `http://localhost:${port}` });

/** One call, and the envelope it came back as. */
async function call(body: Record<string, unknown>, headers: Record<string, string>) {
  const res = await fetch(api(), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ id: "c1", g: 1, ...body }),
  });
  return (await res.json()) as { ok: boolean; error?: { code: string } };
}

const refusedAsStranger = (env: { ok: boolean; error?: { code: string } }) => env.ok === false && env.error?.code === "identity";

test("the composed document hands this machine the capability, HttpOnly and SameSite=Strict", async () => {
  const res = await fetch(`${base}/`);
  const set = res.headers.get("set-cookie") ?? "";
  await res.text();
  expect(set).toContain(`biom-local-${port}=`);
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Strict");
});

test("FORGED HOST AND ORIGIN WITH NO COOKIE are refused, for every agent and chat kind and a window's report", async () => {
  for (const kind of LOCAL_KIND_NAMES) {
    const env = await call({ kind, chat: "c1nvented-chat-0001", agent: "claude-acp", text: "hi" }, FORGED());
    expect([kind, refusedAsStranger(env)]).toEqual([kind, true]);
  }
  // A guessed capability is no capability.
  expect(refusedAsStranger(await call({ kind: "chat.list" }, { ...FORGED(), cookie: `biom-local-${port}=guess` }))).toBe(true);
});

test("with the cookie, from this machine, the gate lets it through", async () => {
  for (const kind of LOCAL_KIND_NAMES) {
    // AN ENVELOPE THE ROUTE ITSELF REFUSES, so getting past the gate is all
    // this asks: every one of these kinds is wired now, and `agents.list` or
    // `agents.registry` answered for real would look for — and probe — the
    // agents on this machine and reach the network. A `window` that is no
    // window's id is refused `bad_request` by the envelope check, after the gate.
    const env = await call({ kind, window: "!" }, { cookie });
    // Past the gate: whatever the route then says, it is not `identity`.
    expect([kind, refusedAsStranger(env)]).toEqual([kind, false]);
    expect([kind, env.error?.code]).toEqual([kind, "bad_request"]);
  }
});

test("a DNS-rebinding page that holds the cookie is still refused by its Host", async () => {
  expect(refusedAsStranger(await call({ kind: "chat.list" }, { cookie, host: `attacker.example:${port}` }))).toBe(true);
});

test("the history and every window's context stay on the token, for runs — no cookie asked", async () => {
  expect(refusedAsStranger(await call({ kind: "history.read" }, {}))).toBe(false);
  expect(refusedAsStranger(await call({ kind: "window.list" }, {}))).toBe(false);
  // And every kind that was there before stays exactly as open as it was.
  expect(refusedAsStranger(await call({ kind: "page.list" }, {}))).toBe(false);
});

test("A PROXIED REQUEST CAN NEVER CARRY THE COOKIE, even when the page knows it", async () => {
  // The inner ring's `fetch` — what a box's `biom.fetch` becomes — pointed at
  // this server's own API, with the real capability, a loopback Host and this
  // server's Origin. The server makes the request from a loopback peer; the
  // proxy drops the cookie on the way out, so the gate refuses it.
  const outer = await call({
    kind: "fetch",
    url: api(),
    init: {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: cookie, ...FORGED() },
      body: JSON.stringify({ id: "p1", g: 1, kind: "chat.new", agent: "claude-acp", text: "delete everything" }),
    },
  }, {}) as { ok: boolean; value?: { status: number; body: string } };
  expect(outer.ok).toBe(true);
  const inner = JSON.parse(outer.value!.body) as { ok: boolean; error?: { code: string } };
  expect(refusedAsStranger(inner)).toBe(true);
});

test("the live stream answers only this machine's own window", async () => {
  const bare = await fetch(stream());
  expect(bare.status).toBe(403);
  await bare.text();
  const forged = await fetch(stream(), { headers: FORGED() });
  expect(forged.status).toBe(403);
  await forged.text();

  const ctl = new AbortController();
  const ok = await fetch(stream(), { headers: { cookie }, signal: ctl.signal });
  expect(ok.status).toBe(200);
  const reader = ok.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain(": open");
  ctl.abort();
});

test("the list of local kinds is every agent and chat kind and a window's report, and a new chat kind is local by its name", () => {
  expect([...LOCAL_KIND_NAMES].sort()).toEqual([...CHAT_KIND_NAMES, "window.report"].sort());
  expect(isLocalKind("chat.somethingNew")).toBe(true);
  expect(isLocalKind("agents.somethingNew")).toBe(true);
  expect(isLocalKind("history.read")).toBe(false);
  expect(isLocalKind("window.list")).toBe(false);
  expect(isLocalKind("page.list")).toBe(false);
});

test("the refusal, as a table: peer, Host and cookie each stop their own case", () => {
  const cap = "capability";
  const good = { address: "127.0.0.1", host: "localhost:4400", cookie: cap };
  const ask = (patch: Partial<typeof good> & Record<string, unknown>) =>
    localRefusal({ ...good, ...patch } as typeof good, { port: 4400, capability: cap });
  expect(ask({})).toBeNull();
  expect(ask({ address: "::1", host: "[::1]:4400" })).toBeNull();
  for (const [what, patch] of [
    ["a machine on the network", { address: "192.168.1.20" }],
    ["no peer at all", { address: null }],
    ["a rebinding name", { host: "attacker.example:4400" }],
    ["another port", { host: "localhost:9999" }],
    ["no Host", { host: null }],
    ["no cookie", { cookie: null }],
    ["a guessed cookie", { cookie: "guess" }],
  ] as const) {
    expect([what, ask(patch as Record<string, unknown>) !== null]).toEqual([what, true]);
  }
});
