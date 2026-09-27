// SPDX-License-Identifier: AGPL-3.0-only
// THIS MACHINE'S OWN WINDOW — the gate in front of every agent and chat kind, a
// window's report, and the live stream, on a real server.
//
// Spawned rather than imported, as `terminal-route.test.ts` is, because what is
// checked is the route table, the cookie on the composed document and the page
// proxy together. What this proves: a request that forges Host and Origin but
// has no cookie is refused, in a source run with no launch token at all; a
// request routed through the inner ring's `fetch` proxy can never carry the
// cookie, even when the page knows it; a page on ANOTHER LOCALHOST PORT, which
// the browser does hand the cookie, is refused by its Origin, its
// `Sec-Fetch-Site` and a content type that is JSON only by its essence; and
// this server's own page, with the cookie, is let through.
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

/** One call with every header the caller names, the content type included, and
 *  what came back: the status, and the envelope when the body was one. */
async function raw(body: Record<string, unknown>, headers: Record<string, string>): Promise<{ status: number; env: { ok: boolean; error?: { code: string } } | null }> {
  const res = await fetch(api(), { method: "POST", headers, body: JSON.stringify({ id: "c1", g: 1, ...body }) });
  const text = await res.text();
  try {
    return { status: res.status, env: JSON.parse(text) as { ok: boolean; error?: { code: string } } };
  } catch {
    return { status: res.status, env: null };
  }
}

/** Refused before the kind was answered: a status with no envelope (the
 *  content type), or the gate's `identity`. */
const neverAnswered = (r: { status: number; env: { ok: boolean; error?: { code: string } } | null }) =>
  r.status === 415 || (r.env !== null && refusedAsStranger(r.env));

/** A PAGE ON ANOTHER LOCALHOST PORT, in the person's own browser: a different
 *  origin and the SAME SITE, because a site ignores the port — so the browser
 *  sends it the `SameSite=Strict` cookie. What it can say is what a browser
 *  lets a page say: its own Origin, `Sec-Fetch-Site: same-site`, and a content
 *  type that needs no preflight. */
const CROSS_PORT = () => ({
  cookie,
  host: `localhost:${port}`,
  origin: `http://localhost:${port + 1}`,
  "sec-fetch-site": "same-site",
});

/** This server's own page, as a browser sends its POST: its own Origin and
 *  `Sec-Fetch-Site: same-origin`. */
const OWN_PAGE = () => ({
  cookie,
  host: `localhost:${port}`,
  origin: `http://localhost:${port}`,
  "sec-fetch-site": "same-origin",
});

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
    // A `window` that is no window's id, as below: the gate is asked before the
    // envelope is checked, so a working gate still answers `identity`, and a
    // broken one fails this at `bad_request` — never a real agent started, the
    // registry fetched or npm run on the machine running the tests.
    const env = await call({ kind, chat: "c1nvented-chat-0001", window: "!" }, FORGED());
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

test("A PAGE ON ANOTHER LOCALHOST PORT, CARRYING THE REAL COOKIE, is refused for every agent and chat kind and a window's report", async () => {
  // The attack as a browser makes it: `fetch(…, { mode: "no-cors", credentials:
  // "include" })` from http://localhost:<another port>, with a content type
  // that needs no preflight and still mentions JSON. Every body carries a
  // `window` that is no window's id, so a gate that let it through would die
  // at `bad_request` and never reach an agent, the registry or the network.
  for (const kind of LOCAL_KIND_NAMES) {
    const r = await raw({ kind, window: "!" }, { ...CROSS_PORT(), "content-type": "text/plain; x=application/json" });
    expect([kind, neverAnswered(r)]).toEqual([kind, true]);
  }
  // Each half stops it alone. The Origin, with a content type that is exactly
  // JSON — which a browser would have preflighted, and which a page's own
  // Origin must not get past the gate either:
  for (const kind of LOCAL_KIND_NAMES) {
    const r = await raw({ kind, window: "!" }, { ...CROSS_PORT(), "content-type": "application/json" });
    expect([kind, r.env !== null && refusedAsStranger(r.env)]).toEqual([kind, true]);
  }
  // `Sec-Fetch-Site` alone, where a browser sends no Origin (a no-cors GET does
  // not) — same-site, and cross-site, are both another page.
  for (const site of ["same-site", "cross-site"]) {
    const r = await raw({ kind: "chat.list", window: "!" }, { cookie, host: `localhost:${port}`, "sec-fetch-site": site, "content-type": "application/json" });
    expect([site, r.env !== null && refusedAsStranger(r.env)]).toEqual([site, true]);
  }
  // An opaque origin is no origin of this server's either: the route refuses
  // it by name before the gate is asked.
  const opaque = await raw({ kind: "chat.list", window: "!" }, { ...CROSS_PORT(), origin: "null", "sec-fetch-site": "cross-site", "content-type": "application/json" });
  expect(opaque.status).toBe(403);
});

test("THE CONTENT TYPE IS JSON BY ITS ESSENCE, not by containing the word — for every kind, local or not", async () => {
  // This server's own page, with the cookie: the gate would pass it, so what
  // stops it is the route's content type alone.
  for (const ct of ["text/plain; x=application/json", "text/plain;charset=application/json", "application/jsonx", "multipart/form-data; boundary=application/json"]) {
    const r = await raw({ kind: "chat.list", window: "!" }, { ...OWN_PAGE(), "content-type": ct });
    expect([ct, r.status]).toEqual([ct, 415]);
  }
  // And a kind that is not local, with no cookie at all: what a page on another
  // port used to reach with a simple request — `vault.create` included.
  const open = await raw({ kind: "page.list" }, { host: `localhost:${port}`, origin: `http://localhost:${port + 1}`, "content-type": "text/plain; x=application/json" });
  expect(open.status).toBe(415);
  // JSON with a parameter, or in capitals, is still JSON.
  for (const ct of ["application/json; charset=utf-8", "Application/JSON"]) {
    const r = await raw({ kind: "page.list" }, { "content-type": ct });
    expect([ct, r.env?.ok]).toEqual([ct, true]);
  }
});

test("THIS SERVER'S OWN PAGE STILL GETS THROUGH: its POST with its own Origin, and a typed address with Sec-Fetch-Site none", async () => {
  for (const kind of LOCAL_KIND_NAMES) {
    const r = await raw({ kind, window: "!" }, { ...OWN_PAGE(), "content-type": "application/json" });
    expect([kind, r.env?.error?.code]).toEqual([kind, "bad_request"]);
  }
  // At 127.0.0.1 as well as localhost: the Origin is whichever the Host is.
  const numeric = await raw({ kind: "chat.list", window: "!" }, {
    cookie, host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin", "content-type": "application/json",
  });
  expect(numeric.env?.error?.code).toBe("bad_request");
  const typed = await raw({ kind: "chat.list", window: "!" }, { cookie, host: `localhost:${port}`, "sec-fetch-site": "none", "content-type": "application/json" });
  expect(typed.env?.error?.code).toBe("bad_request");
});

test("the history and every window's context stay on the token, for runs — no cookie asked", async () => {
  expect(refusedAsStranger(await call({ kind: "history.read" }, {}))).toBe(false);
  expect(refusedAsStranger(await call({ kind: "window.list" }, {}))).toBe(false);
  // And every kind that was there before stays exactly as open as it was.
  expect(refusedAsStranger(await call({ kind: "page.list" }, {}))).toBe(false);
});

test("A WINDOW IS NAMED ONLY BY THIS MACHINE'S OWN WINDOW: the real `own` in main.ts drops `window` from a write without the cookie", async () => {
  // A write kind that is not local, so the launch token (none, in a source
  // run) is all it needs, naming a window the way a run could after reading
  // every window's id off `window.list`. Invented window ids and page names.
  const W = "window-invented-own-01";
  const youEdits = async (): Promise<{ window: string }[]> => {
    const read = await call({ kind: "history.read" }, {}) as unknown as { ok: boolean; value: { entries: { kind: string; writer: { kind: string; window?: string } }[] } };
    return read.value.entries.filter((e) => e.kind === "edit" && e.writer.kind === "you").map((e) => ({ window: e.writer.window ?? "" }));
  };
  const before = (await youEdits()).length;
  // No cookie: answered, and recorded as nobody's.
  const stranger = await call({ kind: "page.create", init: { name: "Invented stranger page" }, window: W }, {});
  expect(stranger.ok).toBe(true);
  // With the cookie but from another localhost port's page: the same.
  const other = await call({ kind: "page.create", init: { name: "Invented other port page" }, window: W }, {
    cookie, host: `localhost:${port}`, origin: `http://localhost:${port + 1}`,
  });
  expect(other.ok).toBe(true);
  expect((await youEdits()).length).toBe(before);
  // This machine's own window: exactly one edit, stamped with that window.
  const own = await call({ kind: "page.create", init: { name: "Invented own page" }, window: W }, { cookie });
  expect(own.ok).toBe(true);
  const after = await youEdits();
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)?.window).toBe(W);
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
      // No agent and no words, and a `window` that is no window's id: were
      // the cookie ever to get through, this dies at `bad_request` rather
      // than starting an agent answered `allow_always`.
      body: JSON.stringify({ id: "p1", g: 1, kind: "chat.new", window: "!" }),
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

test("THE STREAM REFUSES A PAGE ON ANOTHER PORT that carries the cookie, and still opens for this server's own EventSource", async () => {
  // Another port's EventSource is a CORS request and names its Origin; its
  // no-cors GET names none and says `same-site`. Either one is refused.
  for (const headers of [
    { ...CROSS_PORT() },
    { cookie, host: `localhost:${port}`, "sec-fetch-site": "same-site" },
    { cookie, host: `localhost:${port}`, origin: `http://localhost:${port + 1}` },
  ]) {
    const res = await fetch(stream(), { headers });
    expect([JSON.stringify(headers), res.status]).toEqual([JSON.stringify(headers), 403]);
    await res.text();
  }
  // The client's own: an `EventSource` at the same origin sends no Origin and
  // `Sec-Fetch-Site: same-origin`, and the cookie by itself.
  const ctl = new AbortController();
  const own = await fetch(stream(), { headers: { cookie, host: `localhost:${port}`, "sec-fetch-site": "same-origin" }, signal: ctl.signal });
  expect(own.status).toBe(200);
  const first = new TextDecoder().decode((await own.body!.getReader().read()).value);
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

test("the refusal, as a table: peer, Host, Origin, Sec-Fetch-Site and cookie each stop their own case", () => {
  const cap = "capability";
  const good = { address: "127.0.0.1", host: "localhost:4400", origin: null as string | null, site: null as string | null, cookie: cap };
  const ask = (patch: Partial<typeof good> & Record<string, unknown>) =>
    localRefusal({ ...good, ...patch } as typeof good, { port: 4400, capability: cap });
  expect(ask({})).toBeNull();
  expect(ask({ address: "::1", host: "[::1]:4400" })).toBeNull();
  // This server's own page, a same-origin EventSource, and an address typed.
  expect(ask({ origin: "http://localhost:4400", site: "same-origin" })).toBeNull();
  expect(ask({ origin: "http://[::1]:4400", host: "[::1]:4400", address: "::1" })).toBeNull();
  expect(ask({ site: "same-origin" })).toBeNull();
  expect(ask({ site: "none" })).toBeNull();
  for (const [what, patch] of [
    ["a machine on the network", { address: "192.168.1.20" }],
    ["no peer at all", { address: null }],
    ["a rebinding name", { host: "attacker.example:4400" }],
    ["another port", { host: "localhost:9999" }],
    ["no Host", { host: null }],
    ["a page on another localhost port", { origin: "http://localhost:3000" }],
    ["another loopback name's page", { origin: "http://127.0.0.1:4400" }],
    ["an opaque origin", { origin: "null" }],
    ["a same-site request with no Origin", { site: "same-site" }],
    ["a cross-site request with no Origin", { site: "cross-site" }],
    ["this server's Origin said by another site", { origin: "http://localhost:4400", site: "same-site" }],
    ["no cookie", { cookie: null }],
    ["a guessed cookie", { cookie: "guess" }],
  ] as const) {
    expect([what, ask(patch as Record<string, unknown>) !== null]).toEqual([what, true]);
  }
});
