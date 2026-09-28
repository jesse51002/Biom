// SPDX-License-Identifier: AGPL-3.0-only
// The sign-in terminal's route, on a real server.
//
// Spawned rather than imported, as `vendor.test.ts` is, because the route table
// and the cookie on the composed document are exactly what is being checked.
// What this proves that the unit tests cannot: the document served to this
// machine carries the capability, a socket without it or from another origin
// gets nothing, and a socket WITH both still runs nothing it names — the only
// command the route runs is one a server-minted ticket stands for, and a vault
// with no agents has minted none. That the ticket's own command runs, and how
// it ends, is `tests/terminals.test.ts`, against a real PTY.
//
// The vault is a temporary folder, and every ticket and command here is
// invented for the test.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = join(import.meta.dir, "..");
const unix = process.platform !== "win32";

let vault = "";
let data = "";
let port = 0;
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = "";
let cookie = "";

beforeAll(async () => {
  if (!unix) return;
  vault = realpathSync(mkdtempSync(join(tmpdir(), "biom-term-vault-")));
  data = mkdtempSync(join(tmpdir(), "biom-term-data-"));
  rmSync(vault, { recursive: true, force: true });
  port = 4900 + Math.floor(Math.random() * 500);
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
      const set = res.headers.get("set-cookie") ?? "";
      cookie = set.split(";")[0] ?? "";
      await res.text();
      return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("the framework did not come up");
  // BOUNDED BY ITS OWN LOOP, not bun's five-second default for a hook: the
  // loop above gives a cold server ten seconds to answer, and a machine
  // running other suites beside this one has taken more than five.
}, 20_000);

afterAll(() => {
  proc?.kill();
  if (vault) rmSync(vault, { recursive: true, force: true });
  if (data) rmSync(data, { recursive: true, force: true });
});

const route = () => `ws://127.0.0.1:${port}/v/${encodeURIComponent(vault)}/terminal`;

/** Open a socket, and answer whether it opened. */
function tryOpen(headers: Record<string, string>): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(route(), { headers } as unknown as string[]);
    ws.binaryType = "arraybuffer";
    const t = setTimeout(() => resolve(null), 4000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
  });
}

test.if(unix)("the composed document hands this machine the capability, HttpOnly and SameSite=Strict", async () => {
  const res = await fetch(`${base}/`);
  const set = res.headers.get("set-cookie") ?? "";
  await res.text();
  expect(set).toContain(`biom-local-${port}=`);
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Strict");
  // A static file carries nothing.
  const css = await fetch(`${base}/css/terminal.css`);
  expect(css.headers.get("set-cookie")).toBeNull();
  await css.text();
});

test.if(unix)("without the capability, or from another origin, no socket opens", async () => {
  const origin = `http://127.0.0.1:${port}`;
  expect(await tryOpen({ origin })).toBeNull();
  expect(await tryOpen({ origin: "null", cookie })).toBeNull();
  expect(await tryOpen({ origin: "https://example.com", cookie })).toBeNull();
  // A plain request to the route is not an upgrade.
  const plain = await fetch(route().replace("ws:", "http:"), { headers: { origin, cookie } });
  expect(plain.status).toBe(403);
  await plain.text();
});

test.if(unix)("with both, a socket opens — and a ticket nobody minted runs nothing, whatever command the message names", async () => {
  const ws = await tryOpen({ origin: `http://127.0.0.1:${port}`, cookie });
  expect(ws).not.toBeNull();
  const socket = ws as WebSocket;
  const events: any[] = [];
  let closed = false;
  socket.onmessage = (e) => {
    if (typeof e.data === "string") events.push(JSON.parse(e.data));
  };
  socket.onclose = () => {
    closed = true;
  };
  const pwned = join(vault, "pwned");
  socket.send(JSON.stringify({
    op: "create",
    ticket: "made-up-ticket",
    cols: 80,
    rows: 24,
    command: "/bin/sh",
    args: ["-c", `touch ${pwned}`],
  }));
  for (let i = 0; i < 200 && !closed; i++) await Bun.sleep(25);
  expect(closed).toBe(true);
  expect(events).toEqual([{ ev: "error", message: "that sign-in was already used or has expired — ask to sign in again" }]);
  await Bun.sleep(200);
  expect(existsSync(pwned)).toBe(false);
});
